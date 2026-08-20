// Drummer dashboard
const api = (method, path, body) =>
  fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json().then(d => ({ status: r.status, data: d })));

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => new Date(t).toLocaleString();

let me, campaigns = [], selectedCampaign = null;

// ---------- auth gate ----------
async function init() {
  const { status, data } = await api('GET', '/api/me');
  if (status !== 200) { window.location.href = '/login.html'; return; }
  me = data.user;
  $('userName').textContent = me ? `${me.firstName} ${me.lastName}` : 'User';
  $('userCompany').textContent = me?.company || '';
  $('userAvatar').textContent = ((me?.firstName || 'U')[0] + (me?.lastName || '')[0]).toUpperCase();
  if (data.engine === 'demo') $('engineBanner').hidden = false;
  $('accountInfo').textContent = me ? `${me.firstName} ${me.lastName} — ${me.email} (${me.company})` : '';

  bindNav();
  bindLogout();
  bindCampaignModal();
  bindAiGenerate();
  bindProspects();
  bindTools();
  loadAll();
}

// ---------- nav ----------
function bindNav() {
  $('appNav').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document.querySelectorAll('#appNav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.app-page').forEach(p => p.hidden = true);
    $('page-' + btn.dataset.page).hidden = false;
    if (btn.dataset.page === 'campaigns') loadCampaigns();
    if (btn.dataset.page === 'prospects') loadProspects();
    if (btn.dataset.page === 'activity') loadActivity();
    if (btn.dataset.page === 'overview') loadOverview();
    if (btn.dataset.page === 'settings') loadEngine();
  });
}

// ---------- logout ----------
async function logout() {
  await api('POST', '/api/logout');
  window.location.href = '/index.html';
}
function bindLogout() {
  $('logoutBtn').addEventListener('click', logout);
  $('logoutBtn2').addEventListener('click', logout);
}

// ---------- overview ----------
async function loadOverview() {
  const { data } = await api('GET', '/api/app/overview');
  if (!data.ok) return;
  const s = data.stats;
  const cards = [
    ['Campaigns', s.campaigns], ['Active', s.active], ['Prospects', s.prospects],
    ['Emails sent', s.sent], ['Open tasks', s.openTasks],
  ];
  $('statGrid').innerHTML = cards.map(([label, n]) =>
    `<div class="stat-card"><span>${label}</span><strong>${n}</strong></div>`).join('');
  const { data: act } = await api('GET', '/api/app/activity');
  $('overviewEvents').innerHTML = renderEvents(act.events?.slice(0, 8) || []);
}

function renderEvents(events) {
  if (!events.length) return '<li class="empty">No activity yet — activate a campaign to get going.</li>';
  return events.map(e => `
    <li>
      <span class="e-kind ${esc(e.type)}">${esc(e.type)}</span>
      <span>${esc(e.message)}${e.demo ? ' <em style="color:var(--ink-faint)">(demo)</em>' : ''}</span>
      <time>${fmtTime(e.at)}</time>
    </li>`).join('');
}

// ---------- campaigns ----------
function bindCampaignModal() {
  $('newCampaignBtn').addEventListener('click', () => {
    $('campaignModal').hidden = false;
    $('stepsEditor').innerHTML = '';
    addStepRow('email');
  });
  $('closeCampaignModal').addEventListener('click', () => $('campaignModal').hidden = true);
  $('addStepBtn').addEventListener('click', () => addStepRow('email'));
  $('saveCampaignBtn').addEventListener('click', saveCampaign);
}

function stepRowHtml(type) {
  const delay = `<input type="number" class="delay" min="0" placeholder="Delay (min)" value="0" style="max-width:130px" />`;
  let fields = '';
  if (type === 'email') {
    fields = `<input class="subject" placeholder="Subject — e.g. Quick question, {{firstName}}" />
              <textarea class="body" placeholder="Hi {{firstName}}, noticed {{company}}…">{{company}} caught my eye — quick idea.</textarea>`;
  } else if (type === 'task') {
    fields = `<textarea class="note" placeholder="LinkedIn action — e.g. Send connection request to {{firstName}}">Send LinkedIn connection request to {{firstName}} {{lastName}}</textarea>`;
  }
  return `<div class="step-row" data-type="${type}">
      <div>
        <select class="step-type">
          <option value="email" ${type === 'email' ? 'selected' : ''}>Email</option>
          <option value="task" ${type === 'task' ? 'selected' : ''}>LinkedIn task</option>
          <option value="wait" ${type === 'wait' ? 'selected' : ''}>Wait</option>
        </select>
        ${delay}
        <button class="remove-step">remove</button>
      </div>
      <div class="step-fields">${fields}</div>
    </div>`;
}

function addStepRow(type, data = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = stepRowHtml(type);
  const row = wrap.firstElementChild;
  $('stepsEditor').appendChild(row);
  row.querySelector('.remove-step').addEventListener('click', () => row.remove());
  row.querySelector('.step-type').addEventListener('change', e => {
    row.querySelector('.step-fields').innerHTML = e.target.value === 'email'
      ? `<input class="subject" placeholder="Subject — e.g. Quick question, {{firstName}}" /><textarea class="body" placeholder="Hi {{firstName}}, noticed {{company}}…"></textarea>`
      : e.target.value === 'task'
      ? `<textarea class="note" placeholder="LinkedIn action — e.g. Send connection request to {{firstName}}"></textarea>`
      : '';
  });
  if (data.delayMinutes != null) row.querySelector('.delay').value = data.delayMinutes;
  if (data.subject) row.querySelector('.subject') && (row.querySelector('.subject').value = data.subject);
  if (data.body && row.querySelector('.body')) row.querySelector('.body').value = data.body;
  if (data.note && row.querySelector('.note')) row.querySelector('.note').value = data.note;
}

function bindAiGenerate() {
  $('aiGenerateBtn').addEventListener('click', async () => {
    const status = $('aiStatus');
    const product = $('aiProduct').value.trim();
    if (!product) {
      status.className = 'ai-status err';
      status.textContent = 'Tell the AI what you are selling first.';
      return;
    }
    const btn = $('aiGenerateBtn');
    btn.disabled = true;
    btn.style.opacity = '0.65';
    status.className = 'ai-status loading';
    status.textContent = '✦ Writing your sequence…';
    try {
      const { data } = await api('POST', '/api/app/ai/generate-sequence', {
        product,
        audience: $('aiAudience').value,
        goal: $('aiGoal').value,
        tone: $('aiTone').value,
      });
      if (!data.ok) throw new Error(data.error || 'Generation failed');
      $('stepsEditor').innerHTML = '';
      data.steps.forEach(step => addStepRow(step.type, step));
      if (!$('cName').value) $('cName').value = `${product.split(' ').slice(0, 3).join(' ')} outreach`;
      status.className = 'ai-status ok';
      status.textContent = data.ai
        ? `✦ Done — generated by ${data.model}. Edit anything below, then create.`
        : '✦ Done — built-in engine wrote this (set LLM_API_KEY for full AI). Edit and create.';
    } catch (err) {
      status.className = 'ai-status err';
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
    }
  });
}

async function saveCampaign() {
  const steps = [...document.querySelectorAll('.step-row')].map(row => {
    const type = row.querySelector('.step-type').value;
    const delayMinutes = Number(row.querySelector('.delay').value || 0);
    if (type === 'email') return { type, subject: row.querySelector('.subject').value, body: row.querySelector('.body').value, delayMinutes };
    if (type === 'task') return { type, note: row.querySelector('.note').value, delayMinutes };
    return { type, delayMinutes };
  }).filter(s => (s.type !== 'email' || (s.subject && s.body)) && (s.type !== 'task' || s.note));

  const { data } = await api('POST', '/api/app/campaigns', { name: $('cName').value, steps });
  if (!data.ok) { alert(data.error || 'Could not create campaign'); return; }
  $('campaignModal').hidden = true;
  $('cName').value = '';
  loadCampaigns();
}

async function loadCampaigns() {
  const { data } = await api('GET', '/api/app/campaigns');
  if (!data.ok) return;
  campaigns = data.campaigns;
  const list = $('campaignList');
  if (!campaigns.length) {
    list.innerHTML = '<div class="app-card-block" style="color:var(--ink-faint)">No campaigns yet. Create your first one — the engine does the rest.</div>';
  } else {
    list.innerHTML = campaigns.map(c => `
      <div class="campaign-item">
        <span class="status ${esc(c.status)}">${esc(c.status)}</span>
        <div>
          <h3>${esc(c.name)}</h3>
          <div class="meta">${c.steps.length} steps · ${c.prospects} prospects · ${c.finished} finished</div>
        </div>
        <div class="actions">
          ${c.status === 'active'
            ? `<button class="icon-btn icon-btn-text" data-act="pause" data-id="${c.id}" title="Pause campaign">Pause</button>`
            : `<button class="icon-btn icon-btn-text" data-act="activate" data-id="${c.id}" title="Activate campaign">Run</button>`}
          <button class="icon-btn icon-btn-text" data-act="delete" data-id="${c.id}" title="Delete campaign">Delete</button>
        </div>
      </div>`).join('');
  }

  list.querySelectorAll('button[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const { id, act } = btn.dataset;
    if (act === 'delete' && !confirm('Delete this campaign and its prospects?')) return;
    await api(act === 'delete' ? 'DELETE' : 'POST', `/api/app/campaigns/${id}${act === 'delete' ? '' : '/' + act}`);
    loadCampaigns();
    fillProspectSelect();
  }));

  fillProspectSelect();
}

function fillProspectSelect() {
  const sel = $('prospectCampaign');
  sel.innerHTML = '<option value="">Select campaign…</option>' +
    campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (selectedCampaign && campaigns.some(c => c.id === selectedCampaign)) sel.value = selectedCampaign;
}

// ---------- prospects ----------
function bindProspects() {
  $('prospectCampaign').addEventListener('change', e => {
    selectedCampaign = e.target.value || null;
    loadProspects();
  });
  $('addProspectBtn').addEventListener('click', addSingleProspect);
  $('importBtn').addEventListener('click', importCsv);
}

async function loadProspects() {
  if (!selectedCampaign) return;
  const { data } = await api('GET', `/api/app/prospects?campaignId=${selectedCampaign}`);
  if (!data.ok) return;
  $('prospectCount').textContent = `(${data.prospects.length})`;
  const tbody = $('prospectTable').querySelector('tbody');
  tbody.innerHTML = data.prospects.map(p => {
    const v = p.verified?.verdict;
    const pill = v ? `<span class="v-pill ${v}">${v}</span>` : '<span class="v-pill unverified">not checked</span>';
    const step = p.finished ? 'done' : (p.stepIndex != null ? `#${p.stepIndex + 1}` : 'queued');
    return `<tr>
      <td>${esc(p.email)}</td><td>${esc(p.firstName)} ${esc(p.lastName)}</td><td>${esc(p.company)}</td>
      <td>${step}</td><td>${pill}</td>
      <td><button class="link" data-verify="${p.id}">Verify</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="color:var(--ink-faint)">No prospects in this campaign yet.</td></tr>';
  tbody.querySelectorAll('[data-verify]').forEach(btn => btn.addEventListener('click', async () => {
    btn.textContent = '…';
    await api('POST', `/api/app/prospects/${btn.dataset.verify}/verify`);
    loadProspects();
  }));
}

async function addSingleProspect() {
  if (!selectedCampaign) { $('importNote').textContent = 'Pick a campaign first.'; return; }
  const { data } = await api('POST', '/api/app/prospects', {
    campaignId: selectedCampaign,
    list: [{ email: $('pEmail').value, firstName: $('pFirst').value, lastName: $('pLast').value, company: $('pCompany').value }],
  });
  $('importNote').textContent = data.ok ? `Added (${data.total} in campaign)` : (data.error || 'Error');
  ['pEmail', 'pFirst', 'pLast', 'pCompany'].forEach(id => $(id).value = '');
  loadProspects();
}

async function importCsv() {
  if (!selectedCampaign) { $('importNote').textContent = 'Pick a campaign first.'; return; }
  const { data } = await api('POST', '/api/app/prospects', { campaignId: selectedCampaign, csv: $('csvInput').value });
  $('importNote').textContent = data.ok ? `Imported ${data.added} (${data.total} total)` : (data.error || 'Error');
  if (data.ok) $('csvInput').value = '';
  loadProspects();
}

// ---------- activity & tasks ----------
async function loadActivity() {
  const [{ data: act }, { data: tasks }] = await Promise.all([
    api('GET', '/api/app/activity'), api('GET', '/api/app/tasks'),
  ]);
  $('eventList').innerHTML = renderEvents(act.events || []);
  const open = (tasks.tasks || []).filter(t => !t.done);
  $('taskList').innerHTML = open.length ? open.map(t => `
    <li>
      <span class="e-kind task">${esc(t.kind)}</span>
      <span><strong>${esc(t.prospect)}</strong> — ${esc(t.note)} <em style="color:var(--ink-faint)">(${esc(t.campaign)})</em></span>
      <button class="done-btn" data-done="${t.id}">Mark done</button>
    </li>`).join('') : '<li class="empty">No open LinkedIn tasks.</li>';
  $('taskList').querySelectorAll('[data-done]').forEach(btn => btn.addEventListener('click', async () => {
    await api('POST', `/api/app/tasks/${btn.dataset.done}/done`);
    loadActivity();
  }));
}

// ---------- tools ----------
function bindTools() {
  $('verifyBtn').addEventListener('click', async () => {
    const { data } = await api('POST', '/api/app/tools/verify', { email: $('vEmail').value });
    const r = data.result;
    $('verifyResult').innerHTML = r && `
      <div class="score">${r.verdict === 'deliverable' ? '✅' : '❌'} ${esc(r.verdict)}</div>
      <ul>
        <li><span class="${r.syntax ? 'ok-tag' : 'no-tag'}">${r.syntax ? '✓' : '✗'}</span> Syntax valid</li>
        <li><span class="${r.mx?.length ? 'ok-tag' : 'no-tag'}">${r.mx?.length ? '✓' : '✗'}</span> MX records ${r.mx?.length ? esc(r.mx.join(', ')) : 'none'}</li>
      </ul>`;
  });
  $('auditBtn').addEventListener('click', async () => {
    $('auditResult').innerHTML = 'Running DNS checks…';
    const { data } = await api('GET', `/api/app/tools/domain-audit?domain=${encodeURIComponent($('dDomain').value)}`);
    const r = data.result;
    $('auditResult').innerHTML = r ? `
      <div class="score">${r.score}/100</div>
      <ul>${r.checks.map(c => `<li><span class="${c.ok ? 'ok-tag' : 'no-tag'}">${c.ok ? '✓' : '✗'}</span><strong>${esc(c.name)}</strong> — ${esc(c.detail)}</li>`).join('')}</ul>` : 'No result';
  });
}

// ---------- settings ----------
async function loadEngine() {
  const { data } = await api('GET', '/api/app/engine');
  $('engineInfo').innerHTML = data.mode === 'smtp'
    ? `<p><strong>Live SMTP</strong> — sending via <code>${esc(data.smtp.host)}</code> as <code>${esc(data.smtp.user)}</code>, from <code>${esc(data.smtp.from)}</code>.</p>`
    : '<p><strong>Demo mode</strong> — no SMTP credentials found. Campaigns run fully, but sends are only logged to the activity feed.</p>';
}

async function loadAll() {
  await Promise.all([loadOverview(), loadCampaigns()]);
  loadActivity();
}

init();
