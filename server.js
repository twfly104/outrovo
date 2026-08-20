// Drummer MVP server — zero dependencies (Node >= 18)
// Serves the static site and a small JSON API with real persistence.
//
//   GET  /api/health            -> { ok: true }
//   POST /api/signup            -> 201 { ok, user } | 409 duplicate | 400 invalid
//   POST /api/login             -> 200 { ok, user } | 401 wrong credentials
//   GET  /api/signups           -> admin list (requires x-admin-key header)
//
// Data lives in data/signups.json (gitignored). Passwords are scrypt-hashed.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 12000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'drummer-admin-key';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'signups.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------- storage ----------
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- helpers ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e5) req.destroy(); // 100KB cap
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const publicUser = u => ({ firstName: u.firstName, lastName: u.lastName, email: u.email, company: u.company });

// ---------- API ----------
async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return send(res, 200, { ok: true, users: loadUsers().length });
  }

  if (url.pathname === '/api/signup' && req.method === 'POST') {
    const body = await readBody(req);
    const { firstName, lastName, email, company, password } = body || {};
    const errors = {};
    if (!firstName?.trim()) errors.firstName = 'required';
    if (!lastName?.trim()) errors.lastName = 'required';
    if (!isEmail(email)) errors.email = 'invalid';
    if (!company?.trim()) errors.company = 'required';
    if (!password || password.length < 8) errors.password = 'min 8 chars';
    if (Object.keys(errors).length) return send(res, 400, { ok: false, errors });

    const users = loadUsers();
    const normalized = email.trim().toLowerCase();
    if (users.some(u => u.email === normalized)) {
      return send(res, 409, { ok: false, error: 'An account with this email already exists.' });
    }

    const { salt, hash } = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalized,
      company: company.trim(),
      salt,
      hash,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    return send(res, 201, { ok: true, user: publicUser(user) });
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const { email, password } = body || {};
    if (!isEmail(email) || !password) return send(res, 400, { ok: false, error: 'Email and password required.' });

    const user = loadUsers().find(u => u.email === email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return send(res, 401, { ok: false, error: 'Wrong email or password.' });
    }
    return send(res, 200, { ok: true, user: publicUser(user) });
  }

  if (url.pathname === '/api/signups' && req.method === 'GET') {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return send(res, 403, { ok: false, error: 'Forbidden' });
    const users = loadUsers().map(u => ({ ...publicUser(u), id: u.id, createdAt: u.createdAt }));
    return send(res, 200, { ok: true, count: users.length, users });
  }

  send(res, 404, { ok: false, error: 'Not found' });
}

// ---------- static ----------
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 — page not found</h1><p><a href="/">Back to homepage</a></p>');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'Method not allowed' });
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed' });
    serveStatic(req, res, url);
  } catch (err) {
    send(res, 400, { ok: false, error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Drummer server on http://0.0.0.0:${PORT}`);
});
