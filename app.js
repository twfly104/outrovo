// Outrovo dashboard
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
  const planLine = data.plan
    ? `Plan: ${data.plan.name}${data.plan.id === 'trial' && data.plan.trialEnds ? ` (trial ends ${new Date(data.plan.trialEnds).toLocaleDateString()})` : ''}`
    : '';
  $('accountInfo').textContent = (me ? `${me.firstName} ${me.lastName} — ${me.email} (${me.company})` : '') + (planLine ? ` · ${planLine}` : '');
  if (data.plan?.expired) {
    const banner = $('engineBanner');
    banner.hidden = false;
    banner.innerHTML = '⚠️ <strong>Trial ended</strong> — upgrade on the <a href="/pricing.html" style="color:inherit;text-decoration:underline;">pricing page</a> to keep sending.';
  }

  bindNav();
  bindLogout();
  bindCampaignModal();
  bindAiGenerate();
  bindProspects();
  bindTools();
  bindSenders();
  bindDomainDiag();
  bindLinkedInSafety();
  bindIntegration();
  bindSuppression();
  loadAll();
}

// ---------- nav ----------
function bindNav() {
  $('appNav').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    showPage(btn.dataset.page);
  });

  // Action cards on overview jump to sections
  document.querySelectorAll('.action-card[data-goto]').forEach(card => {
    card.addEventListener('click', () => showPage(card.dataset.goto));
  });
}

function showPage(name) {
  document.querySelectorAll('#appNav button').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  document.querySelectorAll('.app-page').forEach(p => p.hidden = true);
  $('page-' + name).hidden = false;
  if (name === 'inbox') loadInbox();
  if (name === 'campaigns') loadCampaigns();
  if (name === 'prospects') loadProspects();
  if (name === 'activity') loadActivity();
  if (name === 'overview') loadOverview();
  if (name === 'settings') { loadEngine(); loadSenders(); loadDomainDiag(); loadLinkedInSafety(); loadIntegrationStatus(); loadSuppression(); }
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
    ['Campaigns', s.campaigns], ['Active', s.active], ['People', s.prospects],
    ['Emails sent', s.sent], ['Replies', s.replies ?? 0], ['Bounces', s.bounces ?? 0], ['To-dos', s.openTasks],
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
              <textarea class="body" placeholder="{Hi|Hello|Hey} {{firstName}}, noticed {{company}}… — variables and {spintax|variants} work here">{Hi|Hello|Hey} {{firstName}}, {{company}} caught my eye — quick idea.</textarea>`;
  } else if (type === 'task') {
    fields = `<select class="task-kind">
        <option value="connect">Connection request</option>
        <option value="message">Direct message</option>
        <option value="view">Profile view</option>
      </select>
      <textarea class="note" placeholder="LinkedIn action — e.g. Send connection request to {{firstName}}">Send LinkedIn connection request to {{firstName}} {{lastName}}</textarea>`;
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
      ? `<input class="subject" placeholder="Subject — e.g. Quick question, {{firstName}}" /><textarea class="body" placeholder="{Hi|Hello|Hey} {{firstName}}, noticed {{company}}…"></textarea>`
      : e.target.value === 'task'
      ? `<select class="task-kind"><option value="connect">Connection request</option><option value="message">Direct message</option><option value="view">Profile view</option></select><textarea class="note" placeholder="LinkedIn action — e.g. Send connection request to {{firstName}}"></textarea>`
      : '';
  });
  if (data.delayMinutes != null) row.querySelector('.delay').value = data.delayMinutes;
  if (data.subject) row.querySelector('.subject') && (row.querySelector('.subject').value = data.subject);
  if (data.body && row.querySelector('.body')) row.querySelector('.body').value = data.body;
  if (data.note && row.querySelector('.note')) row.querySelector('.note').value = data.note;
  if (data.taskKind && row.querySelector('.task-kind')) row.querySelector('.task-kind').value = data.taskKind;
}

function bindAiGenerate() {
  $('aiScanBtn').addEventListener('click', async () => {
    const status = $('aiScanStatus');
    const url = $('aiSiteUrl').value.trim();
    if (!url) {
      status.className = 'ai-status err';
      status.textContent = 'Enter your company website first (e.g. yourcompany.com).';
      return;
    }
    const btn = $('aiScanBtn');
    btn.disabled = true;
    status.className = 'ai-status loading';
    status.textContent = '🔍 Reading your site…';
    try {
      const { data } = await api('POST', '/api/app/ai/scan-site', { url });
      if (!data.ok) throw new Error(data.error || 'Scan failed');
      $('aiProduct').value = data.product || '';
      $('aiAudience').value = data.audience || '';
      $('aiGoal').value = data.goal || '';
      status.className = 'ai-status ok';
      status.textContent = data.ai
        ? `✦ Filled from ${data.site?.url} — review the fields, then generate.`
        : `✦ Filled from ${data.site?.url} (heuristic — set LLM_API_KEY for smarter fills).`;
    } catch (err) {
      status.className = 'ai-status err';
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

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
    if (type === 'task') return { type, note: row.querySelector('.note').value, taskKind: row.querySelector('.task-kind')?.value || 'connect', delayMinutes };
    return { type, delayMinutes };
  }).filter(s => (s.type !== 'email' || (s.subject && s.body)) && (s.type !== 'task' || s.note));

  const { data } = await api('POST', '/api/app/campaigns', {
    name: $('cName').value,
    steps,
    dailyCap: Number($('cDailyCap').value) || 25,
    sendWindowStart: Number($('cWindowStart').value ?? 9),
    sendWindowEnd: Number($('cWindowEnd').value ?? 17),
    timezone: $('cTimezone').value || 'UTC',
  });
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
          <div class="meta">✉️ ${c.sentCount || 0} sent${c.bounced ? ` · ❌ ${c.bounced} bounced` : ''} · today ${c.sentToday ?? 0}/${c.capToday ?? 25}${c.timezone ? ` · ${c.sendWindowStart ?? 9}:00–${c.sendWindowEnd ?? 17}:00 ${esc(c.timezone)}` : ''}</div>
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
    const pill = p.bounced
      ? '<span class="v-pill undeliverable">bounced</span>'
      : p.suppressed
      ? '<span class="v-pill undeliverable">opted out</span>'
      : p.replied
      ? '<span class="v-pill deliverable">replied</span>'
      : v ? `<span class="v-pill ${v}">${v}</span>` : '<span class="v-pill unverified">not checked</span>';
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
  $('importNote').textContent = data.ok
    ? `Imported ${data.added} (${data.total} total)`
      + (data.customVars?.length ? ` — custom variables: ${data.customVars.map(v => '{{' + v + '}}').join(' ')}` : '')
      + (data.skippedSuppressed ? ` — ${data.skippedSuppressed} skipped (suppression list)` : '')
    : (data.error || 'Error');
  if (data.ok) $('csvInput').value = '';
  loadProspects();
}

// ---------- inbox ----------
async function loadInbox() {
  const { data } = await api('GET', '/api/app/inbox');
  if (!data.ok) return;
  const list = $('inboxList');
  const replies = data.replies || [];
  list.innerHTML = replies.length ? replies.map(r => `
    <li class="${r.read ? 'read' : 'unread'}">
      <div class="inbox-meta">
        <strong>${esc(r.subject)}</strong>
        <span>${esc(r.from)} · ${esc(r.prospect)} · ${esc(r.campaign)}</span>
      </div>
      <p>${esc((r.body || '').slice(0, 160))}${(r.body || '').length > 160 ? '…' : ''}</p>
      <time>${fmtTime(r.at)}</time>
      ${r.read ? '' : `<button class="link" data-read="${r.id}">Mark read</button>`}
    </li>`).join('') : '<li class="empty">No replies yet — the unified inbox catches everything here.</li>';
  list.querySelectorAll('[data-read]').forEach(btn => btn.addEventListener('click', async () => {
    await api('POST', `/api/app/inbox/${btn.dataset.read}/read`);
    loadInbox();
  }));
  if (!$('simulateReplyBtn').hasListener) {
    $('simulateReplyBtn').hasListener = true;
    $('simulateReplyBtn').addEventListener('click', async () => {
      await api('POST', '/api/app/inbox/simulate');
      loadInbox();
    });
  }
}

// ---------- activity & tasks ----------
async function loadActivity() {
  const [{ data: act }, { data: tasks }] = await Promise.all([
    api('GET', '/api/app/activity'), api('GET', '/api/app/tasks'),
  ]);
  $('eventList').innerHTML = renderEvents(act.events || []);
  const li = tasks.linkedin;
  if (li) {
    const pct = Math.min(100, Math.round((li.usedToday / Math.max(1, li.budget)) * 100));
    $('liMeter').innerHTML = `<span class="li-meter-label">${li.usedToday}/${li.budget} actions today${li.scheduled ? ` · ${li.scheduled} scheduled` : ''}</span>
      <span class="warmup-bar li-bar"><i style="width:${pct}%"></i></span>`;
  }
  const now = Date.now();
  const open = (tasks.tasks || []).filter(t => !t.done)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
  $('taskList').innerHTML = open.length ? open.map(t => {
    const due = t.dueAt && t.dueAt > now
      ? `<em style="color:var(--ink-faint)">due ${new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</em> `
      : '';
    return `<li>
      <span class="e-kind task">${esc(t.taskKind || t.kind)}</span>
      <span>${due}<strong>${esc(t.prospect)}</strong> — ${esc(t.note)} <em style="color:var(--ink-faint)">(${esc(t.campaign)})</em></span>
      <button class="done-btn" data-done="${t.id}">Mark done</button>
    </li>`;
  }).join('') : '<li class="empty">No open LinkedIn tasks.</li>';
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

// ---------- sender accounts ----------
function bindSenders() {
  $('sProvider').addEventListener('change', e => {
    $('sCustomFields').hidden = e.target.value !== 'custom';
  });
  $('addSenderBtn').addEventListener('click', addSender);
}

async function addSender() {
  const out = $('senderResult');
  out.innerHTML = 'Connecting…';
  const payload = {
    provider: $('sProvider').value,
    email: $('sEmail').value,
    fromName: $('sFromName').value,
    pass: $('sPass').value,
    dailyLimit: Number($('sDailyLimit').value) || 50,
    warmup: $('sWarmup').checked,
  };
  if (payload.provider === 'custom') {
    payload.host = $('sHost').value;
    payload.port = Number($('sPort').value) || 587;
  }
  const { status, data } = await api('POST', '/api/app/senders', payload);
  out.innerHTML = data.ok
    ? `<span class="ok-tag">✓ Connected</span> — ${esc(data.sender.email)} added to the rotation.`
    : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
  if (data.ok) {
    ['sEmail', 'sFromName', 'sPass', 'sHost'].forEach(id => $(id).value = '');
    loadSenders();
  }
}

async function loadSenders() {
  const { data } = await api('GET', '/api/app/senders');
  if (!data.ok) return;
  const rows = data.senders.map(s => {
    const pct = Math.min(100, Math.round((s.usedToday / Math.max(1, s.capToday)) * 100));
    const warm = s.warmup?.isWarming
      ? `<span class="sender-pill warming">warmup · cap ${s.capToday}/day</span>`
      : `<span class="sender-pill">cap ${s.dailyLimit}/day</span>`;
    return `<div class="sender-row">
      <div class="sender-info">
        <strong>${esc(s.fromName ? `${s.fromName} <${s.email}>` : s.email)}</strong>
        <span>${esc(s.provider)} · used ${s.usedToday}/${s.capToday} today</span>
        <div class="warmup-bar"><i style="width:${pct}%"></i></div>
      </div>
      ${warm}
      <button class="link" data-test-sender="${s.id}">Send test</button>
      <button class="link" data-del-sender="${s.id}">Remove</button>
    </div>`;
  });
  if (data.gateway) {
    rows.push(`<div class="sender-row">
      <div class="sender-info">
        <strong>${esc(data.gateway.email)}</strong>
        <span>env-configured gateway (${data.gateway.resend ? 'Resend' : 'SMTP'}) · no daily cap</span>
      </div>
      <span class="sender-pill">gateway</span>
    </div>`);
  }
  $('senderList').innerHTML = rows.join('') || '<p class="settings-note" style="margin-bottom:16px">No inboxes connected yet — add your first sender below.</p>';
  $('senderList').querySelectorAll('[data-del-sender]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this inbox from the rotation?')) return;
    await api('DELETE', `/api/app/senders/${btn.dataset.delSender}`);
    loadSenders();
  }));
  $('senderList').querySelectorAll('[data-test-sender]').forEach(btn => btn.addEventListener('click', async () => {
    const to = $('testEmailTo').value || me?.email;
    if (!to) { $('senderResult').innerHTML = 'Enter a test recipient in "Send a test email" below.'; return; }
    btn.textContent = '…';
    const { data: r } = await api('POST', '/api/app/tools/test-email', { to, senderId: btn.dataset.testSender });
    btn.textContent = 'Send test';
    $('senderResult').innerHTML = r.ok
      ? `<span class="ok-tag">✓ Sent</span> via ${esc(r.sender || 'rotation')}${r.demo ? ' (demo — logged, not sent)' : ''}.`
      : `<span class="no-tag">✗ ${esc(r.error || 'Failed')}</span>`;
  }));
}

// ---------- domain health (onboarding diagnostic) ----------
function bindDomainDiag() {
  $('sdAuditBtn').addEventListener('click', () => runDomainDiag($('sdDomain').value));
}

function renderAudit(target, r) {
  target.innerHTML = r ? `
    <div class="score">${r.score}/100</div>
    <ul>${r.checks.map(c => `<li><span class="${c.ok ? 'ok-tag' : 'no-tag'}">${c.ok ? '✓' : '✗'}</span><strong>${esc(c.name)}</strong> — ${esc(c.detail)}</li>`).join('')}</ul>
    ${r.score < 100 ? '<p class="settings-note">Fix the failing records in your DNS provider before sending at volume — otherwise most mail lands in spam.</p>' : ''}` : 'No result';
}

async function runDomainDiag(domain) {
  const out = $('sdAuditResult');
  out.innerHTML = 'Running DNS checks…';
  const { data } = await api('GET', `/api/app/tools/domain-audit?domain=${encodeURIComponent(domain || '')}`);
  renderAudit(out, data.result);
}

async function loadDomainDiag() {
  if (me?.email && !$('sdDomain').value) $('sdDomain').value = me.email.split('@')[1];
  // The signup-time diagnostic result is logged in the activity feed — show it
  // instantly instead of re-running DNS lookups.
  const { data } = await api('GET', '/api/app/activity');
  const audit = (data.events || []).find(e => e.type === 'domain-audit' && e.meta?.checks);
  if (audit) renderAudit($('sdAuditResult'), { score: audit.meta.score, checks: audit.meta.checks });
}

// ---------- LinkedIn safety ----------
function bindLinkedInSafety() {
  $('liBudgetBtn').addEventListener('click', async () => {
    const { data } = await api('POST', '/api/app/settings', { linkedinBudget: Number($('liBudget').value) });
    $('liBudgetResult').innerHTML = data.ok
      ? `<span class="ok-tag">✓ Saved</span> — budget is now ${data.linkedinBudget} actions/day.`
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
  });
}

async function loadLinkedInSafety() {
  const { data } = await api('GET', '/api/app/tasks');
  if (data.ok && data.linkedin) $('liBudget').value = data.linkedin.budget;
}

// ---------- LinkedIn autopilot bridge ----------
function bindIntegration() {
  $('genTokenBtn').addEventListener('click', async () => {
    const out = $('integrationResult');
    const { data } = await api('POST', '/api/app/integrations/token');
    if (!data.ok) { out.innerHTML = `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`; return; }
    out.innerHTML = `
      <p><span class="ok-tag">✓ Token created</span> — copy it now, it won't be shown again:</p>
      <p><code class="token-box">${esc(data.token)}</code></p>
      <p class="settings-note">Callback URL: <code>${esc(data.callbackUrl)}</code><br>
      Example: <code>curl -X POST ${esc(data.callbackUrl)} -H "x-integration-token: YOUR_TOKEN" -H "Content-Type: application/json" -d '{"prospect":"sarah@acme.io","outcome":"done","note":"request sent"}'</code></p>`;
    loadIntegrationStatus();
  });
  $('revokeTokenBtn').addEventListener('click', async () => {
    if (!confirm('Revoke the integration token? Connected autopilots will stop working.')) return;
    await api('DELETE', '/api/app/integrations/token');
    $('integrationResult').innerHTML = '';
    loadIntegrationStatus();
  });
}

async function loadIntegrationStatus() {
  const { data } = await api('GET', '/api/app/integrations/status');
  if (!data.ok) return;
  $('integrationStatus').innerHTML = data.hasToken
    ? `<p>🟢 Token active. Callback URL: <code>${esc(data.callbackUrl)}</code></p>`
    : '<p style="color:var(--ink-faint)">No token yet — generate one to connect an autopilot.</p>';
  $('revokeTokenBtn').hidden = !data.hasToken;
}

// ---------- suppression list ----------
function bindSuppression() {
  $('suppAddBtn').addEventListener('click', async () => {
    const { data } = await api('POST', '/api/app/suppression', { email: $('suppEmail').value });
    if (data.ok) $('suppEmail').value = '';
    loadSuppression();
  });
}

async function loadSuppression() {
  const { data } = await api('GET', '/api/app/suppression');
  if (!data.ok) return;
  $('suppList').innerHTML = data.suppressed.length
    ? data.suppressed.map(s => `<div class="sender-row">
        <div class="sender-info"><strong>${esc(s.email)}</strong><span>${esc(s.reason)} · ${fmtTime(s.at)}</span></div>
        <button class="link" data-unsuppress="${esc(s.email)}">Remove</button>
      </div>`).join('')
    : '<p class="settings-note">Nobody blocked — good. Unsubscribes appear here automatically.</p>';
  $('suppList').querySelectorAll('[data-unsuppress]').forEach(btn => btn.addEventListener('click', async () => {
    await api('DELETE', `/api/app/suppression/${encodeURIComponent(btn.dataset.unsuppress)}`);
    loadSuppression();
  }));
}

// ---------- settings ----------
async function loadEngine() {
  const { data } = await api('GET', '/api/app/engine');
  $('engineInfo').innerHTML = data.mode === 'multi-inbox'
    ? `<p><strong>Multi-inbox rotation</strong> — ${data.inboxes} connected sender account${data.inboxes > 1 ? 's' : ''} load-balance campaign sends.</p>`
    : data.mode === 'resend'
    ? `<p><strong>Live — Resend</strong> (HTTP API), from <code>${esc(data.smtp.user)}</code>.</p>`
    : data.mode === 'smtp'
    ? `<p><strong>Live SMTP</strong> — sending via <code>${esc(data.smtp.host)}</code> as <code>${esc(data.smtp.user)}</code>.</p>`
    : '<p><strong>Demo mode</strong> — no sender inbox connected and no gateway credentials. Campaigns run fully, but sends are only logged to the activity feed.</p>';
}

$('testEmailBtn').addEventListener('click', async () => {
  const out = $('testEmailResult');
  out.innerHTML = 'Sending…';
  const { status, data } = await api('POST', '/api/app/tools/test-email', { to: $('testEmailTo').value });
  out.innerHTML = status === 200
    ? '<span class="ok-tag">✓ Sent</span> — check the inbox.'
    : `<span class="no-tag">✗ Failed</span> — ${esc(data.error || 'unknown error')}`;
});

async function loadAll() {
  await Promise.all([loadOverview(), loadCampaigns()]);
  loadActivity();
}

init();
