// Outrovo dashboard
const api = (method, path, body) =>
  fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json().then(d => ({ status: r.status, data: d })));

// Non-blocking toast notifications (replaces alert()).
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => new Date(t).toLocaleString();

let me, campaigns = [], selectedCampaign = null;
// Remembered from the last successful Scan & fill / prefill — used to
// personalize each lead's ✦ Intel research angle.
let servicePitch = '';

// ---------- auth gate ----------
async function init() {
  const { status, data } = await api('GET', '/api/me');
  if (status !== 200) { window.location.href = '/login.html'; return; }
  me = data.user;
  $('userName').textContent = me ? `${me.firstName} ${me.lastName}` : 'User';
  $('userAvatar').textContent = ((me?.firstName || 'U')[0] + (me?.lastName || '')[0]).toUpperCase();
  if (data.engine === 'demo') $('engineBanner').hidden = false;
  const planLine = data.plan
    ? `Plan: ${data.plan.name}${data.plan.id === 'trial' && data.plan.trialEnds ? ` (trial ends ${new Date(data.plan.trialEnds).toLocaleDateString()})` : ''}`
    : '';
  $('accountInfo').textContent = (me ? `${me.firstName} ${me.lastName} — ${me.email} (${me.company})` : '') + (planLine ? ` · ${planLine}` : '');
  $('mailAddr').value = me?.mailingAddress || '';
  if (!me?.mailingAddress) {
    $('mailAddrResult').innerHTML = '<span class="no-tag">⚠ No mailing address saved</span> — one is legally required (CAN-SPAM) in every campaign email you send.';
  }
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
  bindSetup();
  bindDomainDiag();
  bindAccount();
  bindLinkedInSafety();
  bindIntegration();
  bindSuppression();
  bindAgency();
  bindWhiteLabel();
  bindWebhooks();
  bindBulkTools();
  // Agency plan → reveal the Agency nav
  if (data.plan?.id === 'agency' || me?.owner) $('agencyNavBtn').hidden = false;
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
  if (name === 'overview') { loadOverview(); loadActivity(); }
  if (name === 'settings') { loadEngine(); loadSenders(); refreshSetup(); loadDomainDiag(); loadLinkedInSafety(); loadIntegrationStatus(); loadSuppression(); loadWebhooks(); }
  if (name === 'agency') { loadClients(); loadBilling(); loadWhiteLabel(); }
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
    ['Emails sent', s.sent], ['Replies', s.replies ?? 0], ['Bounces', s.bounces ?? 0], ['Open to-dos', s.openTasks],
  ];
  $('statGrid').innerHTML = cards.map(([label, n]) =>
    `<div class="stat-card"><span>${label}</span><strong>${n}</strong></div>`).join('');
}

function renderEvents(events) {
  if (!events.length) return '<li class="empty">Nothing here yet — start a campaign and everything you do lands in this feed.</li>';
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
    // Pre-fill timezone from the browser so the send window makes sense.
    try { $('cTimezone').value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch {}
  });
  $('closeCampaignModal').addEventListener('click', () => $('campaignModal').hidden = true);
  $('addStepBtn').addEventListener('click', () => addStepRow('email'));
  $('saveCampaignBtn').addEventListener('click', saveCampaign);
}

function stepRowHtml(type) {
  const delay = `<input type="number" class="delay" min="0" placeholder="Delay (min)" value="0" style="max-width:130px" />`;
  const branch = `<div class="branch-row" title="Jump to a labeled step when an event fires after this one. Leave blank to continue in order.">
      <input class="step-label" placeholder="Label (e.g. opener)" style="max-width:120px" />
      <input class="br-replied" placeholder="if replied → label" style="max-width:140px" />
      <input class="br-clicked" placeholder="if clicked → label" style="max-width:140px" />
      <input class="br-noreply" placeholder="if no reply → label" style="max-width:140px" />
    </div>`;
  let fields = '';
  if (type === 'email') {
    fields = `<input class="subject" placeholder="Subject — e.g. Quick question, {{firstName}}" />
              <textarea class="body" placeholder="{Hi|Hello|Hey} {{firstName}}, noticed {{company}}… — variables and {spintax|variants} work here">{Hi|Hello|Hey} {{firstName}}, {{company}} caught my eye — quick idea.</textarea>
              <button type="button" class="ab-toggle">⇄ A/B test this step</button>
              <div class="ab-b" hidden>
                <input class="subject-b" placeholder="Variant B subject" />
                <textarea class="body-b" placeholder="Variant B body — half your prospects get this version"></textarea>
              </div>${branch}`;
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

function bindAbToggle(row) {
  const btn = row.querySelector('.ab-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const box = row.querySelector('.ab-b');
    box.hidden = !box.hidden;
    btn.textContent = box.hidden ? '⇄ A/B test this step' : '✕ Remove variant B';
    if (box.hidden) { row.querySelector('.subject-b').value = ''; row.querySelector('.body-b').value = ''; }
  });
}

function addStepRow(type, data = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = stepRowHtml(type);
  const row = wrap.firstElementChild;
  $('stepsEditor').appendChild(row);
  row.querySelector('.remove-step').addEventListener('click', () => row.remove());
  row.querySelector('.step-type').addEventListener('change', e => {
    row.querySelector('.step-fields').innerHTML = e.target.value === 'email'
      ? `<input class="subject" placeholder="Subject — e.g. Quick question, {{firstName}}" /><textarea class="body" placeholder="{Hi|Hello|Hey} {{firstName}}, noticed {{company}}…"></textarea><button type="button" class="ab-toggle">⇄ A/B test this step</button><div class="ab-b" hidden><input class="subject-b" placeholder="Variant B subject" /><textarea class="body-b" placeholder="Variant B body — half your prospects get this version"></textarea></div>`
      : e.target.value === 'task'
      ? `<select class="task-kind"><option value="connect">Connection request</option><option value="message">Direct message</option><option value="view">Profile view</option></select><textarea class="note" placeholder="LinkedIn action — e.g. Send connection request to {{firstName}}"></textarea>`
      : '';
    bindAbToggle(row);
  });
  bindAbToggle(row);
  if (data.delayMinutes != null) row.querySelector('.delay').value = data.delayMinutes;
  if (data.subject) row.querySelector('.subject') && (row.querySelector('.subject').value = data.subject);
  if (data.body && row.querySelector('.body')) row.querySelector('.body').value = data.body;
  if (data.note && row.querySelector('.note')) row.querySelector('.note').value = data.note;
  if (data.taskKind && row.querySelector('.task-kind')) row.querySelector('.task-kind').value = data.taskKind;
  if (data.label && row.querySelector('.step-label')) row.querySelector('.step-label').value = data.label;
  if (data.branchNext && row.querySelector('.br-replied')) {
    if (data.branchNext.onReplied) row.querySelector('.br-replied').value = data.branchNext.onReplied;
    if (data.branchNext.onClicked) row.querySelector('.br-clicked').value = data.branchNext.onClicked;
    if (data.branchNext.onNoReply) row.querySelector('.br-noreply').value = data.branchNext.onNoReply;
  }
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
    const label = row.querySelector('.step-label')?.value.trim() || undefined;
    if (type === 'email') {
      const step = { type, subject: row.querySelector('.subject').value, body: row.querySelector('.body').value, delayMinutes, label };
      const subjectB = row.querySelector('.subject-b')?.value.trim();
      const bodyB = row.querySelector('.body-b')?.value.trim();
      if (subjectB && bodyB) step.variantB = { subject: subjectB, body: bodyB };
      const onReplied = row.querySelector('.br-replied')?.value.trim();
      const onClicked = row.querySelector('.br-clicked')?.value.trim();
      const onNoReply = row.querySelector('.br-noreply')?.value.trim();
      if (onReplied || onClicked || onNoReply) step.branchNext = { ...(onReplied && { onReplied }), ...(onClicked && { onClicked }), ...(onNoReply && { onNoReply }) };
      return step;
    }
    if (type === 'task') return { type, note: row.querySelector('.note').value, taskKind: row.querySelector('.task-kind')?.value || 'connect', delayMinutes, label };
    return { type, delayMinutes, label };
  }).filter(s => (s.type !== 'email' || (s.subject && s.body)) && (s.type !== 'task' || s.note));

  const { data } = await api('POST', '/api/app/campaigns', {
    name: $('cName').value,
    steps,
    dailyCap: Number($('cDailyCap').value) || 25,
    sendWindowStart: Number($('cWindowStart').value ?? 9),
    sendWindowEnd: Number($('cWindowEnd').value ?? 17),
    timezone: $('cTimezone').value || 'UTC',
  });
  if (!data.ok) { toast(data.error || 'Could not create campaign', 'err'); return; }
  $('campaignModal').hidden = true;
  $('cName').value = '';
  loadCampaigns();
}

function campaignCardHtml(c) {
  const mins = s => Math.max(0, Number(s.delayMinutes || 0));
  const waitText = s => {
    const m = mins(s);
    if (m >= 1440 && m % 1440 === 0) return `Wait ${m / 1440} day${m === 1440 ? '' : 's'}`;
    if (m >= 60 && m % 60 === 0) return `Wait ${m / 60} hour${m === 60 ? '' : 's'}`;
    return `Wait ${m} min`;
  };
  const stepTitle = (s, i) => s.label || (
    s.type === 'email' ? `Email ${c.steps.slice(0, i + 1).filter(x => x.type === 'email').length} — ${s.subject || 'No subject'}`
    : s.type === 'task' ? `LinkedIn to-do`
    : waitText(s));
  const stepSub = s =>
    s.type === 'email' ? (s.variantB ? 'A/B test running' : 'Sends through your connected inbox')
    : s.type === 'task' ? ({ connect: 'Connection request', message: 'Direct message', view: 'Profile view' })[s.taskKind] || 'Manual action'
    : 'Smart schedule — not spam pace';
  const ico = s => s.type === 'email'
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>`
    : s.type === 'task' ? 'in'
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  const badge = s =>
    s.type === 'email' ? (c.status === 'active' ? '<span class="step-bdg sent">Auto</span>' : '<span class="step-bdg">Queued</span>')
    : s.type === 'task' ? '<span class="step-bdg check">Manual</span>'
    : '<span class="step-bdg done">Auto</span>';

  const sent = c.sentCount || 0;
  const bounced = c.bounced || 0;
  const replied = c.replied || 0;
  const placed = sent ? Math.round((Math.max(0, sent - bounced) / sent) * 100) : null;
  const replyRate = sent ? Math.round((replied / sent) * 100) : null;
  const days = Array.isArray(c.repliesPastWeek) ? c.repliesPastWeek : [];
  const peak = Math.max(1, ...days);
  const bars = days.length
    ? `<div class="cp-bars">${days.map((n, i) => `<i style="height:${Math.max(12, Math.round((n / peak) * 100))}%" class="${i % 2 ? 'b' : 'a'}" title="${n} repl${n === 1 ? 'y' : 'ies'}"></i>`).join('')}</div>`
    : '';
  return `
    <div class="campaign-card">
      <div class="cp-head">
        <div>
          <h3>${esc(c.name)}</h3>
          <div class="meta">${c.steps.length} steps · ${c.prospects} prospects · ${c.finished} finished · today ${c.sentToday ?? 0}/${c.capToday ?? 25}</div>
        </div>
        <span class="status ${esc(c.status)}">${esc(c.status)}</span>
      </div>
      <div class="cp-body">
        <div class="cp-steps">
          ${c.steps.map((s, i) => `
            <div class="cp-step">
              <span class="cp-ico ${s.type}">${ico(s)}</span>
              <div class="cp-stinfo"><strong>${esc(stepTitle(s, i))}</strong><span>${esc(stepSub(s))}</span></div>
              ${badge(s)}
            </div>`).join('')}
        </div>
        <div class="cp-stats">
          <div class="cp-kpi"><span>Landing in inbox</span><strong>${placed === null ? '—' : placed + '%'}</strong></div>
          <div class="cp-kpi"><span>Reply rate</span><strong>${replyRate === null ? '—' : replyRate + '%'}</strong></div>
          <div><span class="cp-kpi-label">Replies · 7 days</span>${bars}</div>
        </div>
      </div>
      ${c.steps.some(s => s.variantB) ? `<div class="ab-results" data-campaign="${c.id}"></div>` : ''}
      <div class="cp-foot">
        ${c.status === 'active'
          ? `<button class="icon-btn icon-btn-text" data-act="pause" data-id="${c.id}" title="Pause campaign">Pause</button>`
          : `<button class="icon-btn icon-btn-text" data-act="activate" data-id="${c.id}" title="Activate campaign">Run</button>`}
        <button class="icon-btn icon-btn-text" data-act="delete" data-id="${c.id}" title="Delete campaign">Delete</button>
      </div>
    </div>`;
}

async function loadCampaigns() {
  const { data } = await api('GET', '/api/app/campaigns');
  if (!data.ok) return;
  campaigns = data.campaigns;
  const list = $('campaignList');
  if (!campaigns.length) {
    list.innerHTML = '<div class="app-card-block" style="color:var(--ink-faint)">No campaigns yet — press <strong>New campaign</strong> above and the step builder opens. Emails go out automatically once you hit Run.</div>';
  } else {
    list.innerHTML = campaigns.map(c => campaignCardHtml(c)).join('');
  }

  list.querySelectorAll('button[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const { id, act } = btn.dataset;
    if (act === 'delete' && !confirm('Delete this campaign and its prospects?')) return;
    await api(act === 'delete' ? 'DELETE' : 'POST', `/api/app/campaigns/${id}${act === 'delete' ? '' : '/' + act}`);
    loadCampaigns();
    fillProspectSelect();
  }));

  list.querySelectorAll('.ab-results').forEach(async box => {
    const { data: ab } = await api('GET', `/api/app/campaigns/${box.dataset.campaign}/ab-results`);
    if (!ab?.ok || !ab.results.length) return;
    box.innerHTML = ab.results.map(r => `
      <div class="ab-row">
        <span class="ab-label">⇄ ${esc(r.label)}</span>
        <span class="ab-cell ${r.winner === 'A' ? 'ab-winner' : ''}">A — ${esc(r.variantA.subject.slice(0, 34))}: ${r.variantA.sent} sent · ${r.variantA.replied} replies (${r.variantA.replyRate}%)</span>
        <span class="ab-cell ${r.winner === 'B' ? 'ab-winner' : ''}">B — ${esc(r.variantB.subject.slice(0, 34))}: ${r.variantB.sent} sent · ${r.variantB.replied} replies (${r.variantB.replyRate}%)</span>
      </div>`).join('');
  });

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
      : p.verified?.catchAll === true
      ? '<span class="v-pill warming">accept-all</span>'
      : v ? `<span class="v-pill ${v}">${v}</span>` : '<span class="v-pill unverified">not checked</span>';
    const step = p.finished ? 'done' : (p.stepIndex != null ? `#${p.stepIndex + 1}` : 'queued');
    const enriched = p.enriched ? ` <span title="enriched via ${esc(p.enriched.provider)}">✦</span>` : '';
    return `<tr>
      <td>${esc(p.email)}${enriched}</td><td>${esc(p.firstName)} ${esc(p.lastName)}</td><td>${esc(p.company)}</td>
      <td>${step}</td><td>${pill}</td>
      <td>
        <button class="link" data-verify="${p.id}">Verify</button>
        <button class="link" data-enrich="${p.id}">Enrich</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="color:var(--ink-faint)">Pick a campaign above and add people below — they\'ll appear here.</td></tr>';
  tbody.querySelectorAll('[data-verify]').forEach(btn => btn.addEventListener('click', async () => {
    btn.textContent = '…';
    await api('POST', `/api/app/prospects/${btn.dataset.verify}/verify`);
    loadProspects();
  }));
  tbody.querySelectorAll('[data-enrich]').forEach(btn => btn.addEventListener('click', async () => {
    btn.textContent = '…';
    await api('POST', `/api/app/prospects/${btn.dataset.enrich}/enrich`);
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
  const intentChip = r => r.intent ? `<span class="intent-chip intent-${esc(r.intent)}">${esc(r.intent.replace('_', ' '))}</span>` : '';
  list.innerHTML = replies.length ? replies.map(r => `
    <li class="${r.read ? 'read' : 'unread'}">
      <div class="inbox-meta">
        <strong>${esc(r.subject)}</strong> ${intentChip(r)}
        <span>${esc(r.from)} · ${esc(r.prospect)} · ${esc(r.campaign)}</span>
      </div>
      <p>${esc((r.body || '').slice(0, 160))}${(r.body || '').length > 160 ? '…' : ''}</p>
      <time>${fmtTime(r.at)}</time>
      <div class="inbox-actions">
        ${r.read ? '' : `<button class="link" data-read="${r.id}">Mark read</button>`}
        <button class="link" data-draft="${r.id}">✦ AI draft</button>
      </div>
      ${r.draft ? `<div class="draft-box"><em>AI draft (${esc(r.draft.source)}):</em><br>${esc(r.draft.text).replace(/\n/g, '<br>')}</div>` : `<div class="draft-box" id="draft-${r.id}" hidden></div>`}
    </li>`).join('') : '<li class="empty">No replies yet — when someone answers a campaign, their message lands here.</li>';
  list.querySelectorAll('[data-read]').forEach(btn => btn.addEventListener('click', async () => {
    await api('POST', `/api/app/inbox/${btn.dataset.read}/read`);
    loadInbox();
  }));
  list.querySelectorAll('[data-draft]').forEach(btn => btn.addEventListener('click', async () => {
    btn.textContent = '… drafting';
    const { data: d } = await api('POST', `/api/app/inbox/${btn.dataset.draft}/draft`, {});
    if (d.ok) loadInbox();
    else { btn.textContent = '✦ AI draft'; toast(d.error || 'Draft failed', 'err'); }
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
      <div class="score ${r.verdict === 'deliverable' ? 'ok-tag' : 'no-tag'}">${esc(r.verdict)}</div>
      <ul>
        <li><span class="${r.syntax ? 'ok-tag' : 'no-tag'}">${r.syntax ? '✓' : '✗'}</span><div>Syntax valid</div></li>
        <li><span class="${r.mx?.length ? 'ok-tag' : 'no-tag'}">${r.mx?.length ? '✓' : '✗'}</span><div>MX records ${r.mx?.length ? esc(r.mx.join(', ')) : 'none'}</div></li>
      </ul>`;
  });
  $('auditBtn').addEventListener('click', async () => {
    $('auditResult').innerHTML = 'Running DNS checks…';
    const { data } = await api('GET', `/api/app/tools/domain-audit?domain=${encodeURIComponent($('dDomain').value)}`);
    const r = data.result;
    $('auditResult').innerHTML = r ? `
      <div class="score">${r.score}/100</div>
      <ul>${r.checks.map(c => `<li><span class="${c.ok ? 'ok-tag' : 'no-tag'}">${c.ok ? '✓' : '✗'}</span><div><strong>${esc(c.name)}</strong> — ${esc(c.detail)}</div></li>`).join('')}</ul>` : 'No result';
  });
}

// ---------- sender accounts (one-click connect) ----------
const SENDER_HINTS = {
  gmail: 'Paste your email and a <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Google app password</a> — takes 30 seconds.',
  microsoft: 'Paste your email and your Microsoft 365 mailbox password (or app password).',
  custom: 'Any SMTP inbox works — host and port appear under Advanced options.',
};

function bindSenders() {
  $('connectGoogle').addEventListener('click', () => startConnect('google', 'gmail'));
  $('connectMicrosoft').addEventListener('click', () => startConnect('microsoft', 'microsoft'));
  $('connectOther').addEventListener('click', () => openSenderForm('custom'));
  $('advToggle').addEventListener('click', () => {
    const panel = $('advPanel');
    panel.hidden = !panel.hidden;
    $('advToggle').textContent = panel.hidden ? 'Advanced options ▾' : 'Advanced options ▴';
    $('sCustomFields').hidden = !panel.hidden && $('sProvider').value !== 'custom';
  });
  $('addSenderBtn').addEventListener('click', addSender);
  $('copyInboundBtn').addEventListener('click', async () => {
    const addr = $('inboundAddr').textContent;
    if (!addr || addr === '…') return;
    try {
      await navigator.clipboard.writeText(addr);
      $('copyInboundBtn').textContent = 'Copied ✓';
    } catch {
      window.prompt('Copy your forwarding address:', addr);
    }
    setTimeout(() => { $('copyInboundBtn').textContent = 'Copy'; }, 1500);
  });
}

// OAuth availability is cached for the session — one fetch per Settings visit.
let oauthProviders = null;
async function oauthStatus() {
  if (oauthProviders) return oauthProviders;
  const { data } = await api('GET', '/api/app/oauth/status');
  oauthProviders = data.ok ? data.providers : {};
  return oauthProviders;
}

// Tiles: when the server has OAuth app credentials, one click opens the
// provider consent in a popup and the inbox lands in the rotation. Without
// them the tile falls back to the minimal email + app password form.
async function startConnect(oauthName, providerValue) {
  const providers = await oauthStatus();
  if (providers[oauthName]) return startOAuth(oauthName);
  openSenderForm(providerValue);
  $('senderResult').innerHTML = '<span class="settings-note">One-click sign-in isn\'t enabled on this server yet — an app password works today.</span>';
}

function startOAuth(name) {
  const popup = window.open(`/api/app/oauth/${name}/start`, 'ov-oauth', 'width=640,height=760,menubar=no,toolbar=no');
  if (!popup) {
    $('senderResult').innerHTML = '<span class="no-tag">Popup blocked</span> — allow popups for one-click authorize, or use the form below.';
    $('senderForm').hidden = false;
    return;
  }
  $('senderResult').innerHTML = 'Waiting for authorization…';
}

// The OAuth callback page postMessages its result back to this tab.
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.data?.type !== 'outrovo-oauth') return;
  $('senderResult').innerHTML = e.data.ok
    ? `<span class="ok-tag">✓ Connected</span> — ${esc(e.data.email)} added to the rotation.`
    : `<span class="no-tag">✗ ${esc(e.data.error || 'Authorization failed')}</span>`;
  if (e.data.ok) { loadSenders(); refreshSetup(); $('inboundGuide').open = true; }
});

function openSenderForm(provider) {
  const form = $('senderForm');
  form.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('sProvider').value = provider;
  $('sFormHint').innerHTML = SENDER_HINTS[provider] || '';
  $('sCustomFields').hidden = provider !== 'custom' || $('advPanel').hidden;
  if (provider === 'custom' && $('advPanel').hidden) $('advToggle').click();
  ['connectGoogle', 'connectMicrosoft', 'connectOther'].forEach(id => $(id).classList.remove('selected'));
  ({ gmail: 'connectGoogle', microsoft: 'connectMicrosoft', custom: 'connectOther' }[provider] || '') &&
    $({ gmail: 'connectGoogle', microsoft: 'connectMicrosoft', custom: 'connectOther' }[provider]).classList.add('selected');
  $('sEmail').focus();
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
    refreshSetup();
  }
}

async function loadSenders() {
  const { data } = await api('GET', '/api/app/senders');
  if (!data.ok) return;
  if (data.inboundAddress) $('inboundAddr').textContent = data.inboundAddress;
  const rows = data.senders.map(s => {
    const pct = Math.min(100, Math.round((s.usedToday / Math.max(1, s.capToday)) * 100));
    const warm = s.warmup?.isWarming
      ? `<span class="sender-pill warming">warmup · cap ${s.capToday}/day</span>`
      : `<span class="sender-pill">cap ${s.dailyLimit}/day</span>`;
    return `<div class="sender-row">
      <div class="sender-info">
        <strong>${esc(s.fromName ? `${s.fromName} <${s.email}>` : s.email)}</strong>
        <span>${s.oauth ? 'authorized' : esc(s.provider)} · used ${s.usedToday}/${s.capToday} today</span>
        <div class="warmup-bar"><i style="width:${pct}%"></i></div>
      </div>
      ${s.oauth ? '<span class="sender-pill oauth">✓ authorized</span>' : ''}
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
  $('senderList').innerHTML = rows.join('') || '<p class="settings-note" style="margin-bottom:16px">No inboxes connected yet — pick a provider below.</p>';
  $('senderList').querySelectorAll('[data-del-sender]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this inbox from the rotation?')) return;
    await api('DELETE', `/api/app/senders/${btn.dataset.delSender}`);
    loadSenders();
    refreshSetup();
  }));
  $('senderList').querySelectorAll('[data-test-sender]').forEach(btn => btn.addEventListener('click', async () => {
    const to = $('testEmailTo').value || me?.email;
    if (!to) { $('senderResult').innerHTML = 'Enter a test recipient in step 3 above.'; return; }
    btn.textContent = '…';
    const { data: r } = await api('POST', '/api/app/tools/test-email', { to, senderId: btn.dataset.testSender });
    btn.textContent = 'Send test';
    $('senderResult').innerHTML = r.ok
      ? `<span class="ok-tag">✓ Sent</span> via ${esc(r.sender || 'rotation')}${r.demo ? ' (demo — logged, not sent)' : ''}.`
      : `<span class="no-tag">✗ ${esc(r.error || 'Failed')}</span>`;
  }));
}

// ---------- quick-setup wizard ----------
const setupKey = () => `ov-setup:${me?.email || ''}`;
function loadSetupMarks() {
  try { return JSON.parse(localStorage.getItem(setupKey()) || '{}'); } catch { return {}; }
}
function markStepDone(step) {
  const marks = { ...loadSetupMarks(), [step]: true };
  localStorage.setItem(setupKey(), JSON.stringify(marks));
  applySetupMarks();
}
function applySetupMarks() {
  const marks = loadSetupMarks();
  $('setupDomainStep').classList.toggle('done', Boolean(marks.domain));
  $('setupTestStep').classList.toggle('done', Boolean(marks.test));
}

// Sender step derives from live server state; domain/test steps are marked
// locally once the user runs them (localStorage, per account).
async function refreshSetup() {
  const { data } = await api('GET', '/api/app/senders');
  if (!data.ok) return;
  const count = (data.senders?.length || 0) + (data.gateway ? 1 : 0);
  const st = $('setupSenderStatus');
  st.textContent = count ? `✓ ${count} inbox${count > 1 ? 'es' : ''} connected` : 'Not connected';
  st.classList.toggle('ok', count > 0);
  $('gotoSenderBtn').textContent = count ? 'Add another' : 'Connect';
  $('setupSenderStep').classList.toggle('done', count > 0);
  applySetupMarks();
}

function bindSetup() {
  $('gotoSenderBtn').addEventListener('click', () => {
    $('senderCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('connectGoogle').classList.add('pulse');
    $('connectMicrosoft').classList.add('pulse');
    setTimeout(() => ['connectGoogle', 'connectMicrosoft'].forEach(id => $(id).classList.remove('pulse')), 1600);
  });
  if (me?.email && !$('testEmailTo').value) $('testEmailTo').value = me.email;
}

// ---------- domain health (onboarding diagnostic) ----------
function bindDomainDiag() {
  $('sdAuditBtn').addEventListener('click', () => runDomainDiag($('sdDomain').value));
}

function renderAudit(target, r) {
  target.innerHTML = r ? `
    <div class="score">${r.score}/100</div>
    <ul>${r.checks.map(c => `<li><span class="${c.ok ? 'ok-tag' : 'no-tag'}">${c.ok ? '✓' : '✗'}</span><div><strong>${esc(c.name)}</strong> — ${esc(c.detail)}</div></li>`).join('')}</ul>
    ${r.score < 100 ? '<p class="settings-note">Fix the failing records in your DNS provider before sending at volume — otherwise most mail lands in spam.</p>' : ''}` : 'No result';
}

async function runDomainDiag(domain) {
  const out = $('sdAuditResult');
  out.innerHTML = 'Running DNS checks…';
  const { data } = await api('GET', `/api/app/tools/domain-audit?domain=${encodeURIComponent(domain || '')}`);
  renderAudit(out, data.result);
  if (data.result) markStepDone('domain');
}

const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'qq.com', '163.com', '126.com', 'yeah.net', 'foxmail.com', 'mail.com', 'gmx.com', 'gmx.net', 'zoho.com', 'yandex.com', 'yandex.ru']);

async function loadDomainDiag() {
  const domain = (me?.email.split('@')[1] || '').toLowerCase();
  // Gmail/Outlook etc. sign DKIM themselves — checking their domain here only
  // confuses users with a failing DKIM probe. Leave the field empty instead.
  if (domain && !FREE_MAIL_DOMAINS.has(domain) && !$('sdDomain').value) $('sdDomain').value = domain;
  // The signup-time diagnostic result is logged in the activity feed — show it
  // instantly instead of re-running DNS lookups.
  const { data } = await api('GET', '/api/app/activity');
  const audit = (data.events || []).find(e => e.type === 'domain-audit' && e.meta?.checks);
  if (audit) renderAudit($('sdAuditResult'), { score: audit.meta.score, checks: audit.meta.checks });
}

// ---------- Compliance & account data rights ----------
function bindAccount() {
  $('mailAddrBtn').addEventListener('click', async () => {
    const { data } = await api('POST', '/api/app/settings', { mailingAddress: $('mailAddr').value });
    $('mailAddrResult').innerHTML = data.ok
      ? (data.mailingAddress
        ? '<span class="ok-tag">✓ Saved</span> — this address now appears in every campaign email footer.'
        : '<span class="no-tag">⚠ Address cleared</span> — CAN-SPAM requires a postal address in every campaign email.')
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
  });
  $('exportBtn').addEventListener('click', () => { window.location.href = '/api/app/export'; });
  $('deleteAccountBtn').addEventListener('click', async () => {
    if (!confirm('Delete your account and ALL campaigns, prospects, replies, tasks and inboxes? This cannot be undone.')) return;
    const password = prompt('Confirm with your password:');
    if (password == null) return;
    const { data } = await api('DELETE', '/api/app/account', { password });
    if (data.ok) { window.location.href = '/index.html'; return; }
    $('accountResult').innerHTML = `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
  });
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

// ---------- agency: clients + billing ----------
function bindAgency() {
  $('addClientBtn').addEventListener('click', async () => {
    const out = $('clientResult');
    out.innerHTML = 'Creating…';
    const { data } = await api('POST', '/api/app/agency/clients', {
      firstName: $('clFirst').value, company: $('clCompany').value,
      email: $('clEmail').value, password: $('clPass').value || undefined,
    });
    out.innerHTML = data.ok
      ? `<span class="ok-tag">✓ Client created</span>${data.client.tempPassword ? ` — temp password: <code class="token-box">${esc(data.client.tempPassword)}</code> (share it securely)` : ''}`
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
    if (data.ok) { ['clFirst', 'clCompany', 'clEmail', 'clPass'].forEach(id => $(id).value = ''); loadClients(); loadBilling(); }
  });
}

async function loadClients() {
  const { data } = await api('GET', '/api/app/agency/clients');
  if (!data.ok) { $('clientList').innerHTML = `<p class="settings-note">${esc(data.error || 'Agency plan required.')}</p>`; return; }
  $('clientList').innerHTML = data.clients.length ? data.clients.map(c => `
    <div class="sender-row">
      <div class="sender-info">
        <strong>${esc(c.name)} — ${esc(c.company)}</strong>
        <span>${esc(c.email)} · ${esc(c.plan)}${c.expired ? ' (expired)' : ''} · ${c.campaigns} campaigns · ${c.prospects} prospects · ${c.sent} sent</span>
      </div>
      <select data-plan-client="${esc(c.email)}" style="max-width:130px">
        ${['trial', 'starter', 'growth', 'scale'].map(p => `<option value="${p}" ${c.planId === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <button class="link" data-detach="${esc(c.email)}">Detach</button>
    </div>`).join('') : '<p class="settings-note">No clients yet — add your first one above.</p>';
  $('clientList').querySelectorAll('[data-plan-client]').forEach(sel => sel.addEventListener('change', async () => {
    await api('POST', `/api/app/agency/clients/${encodeURIComponent(sel.dataset.planClient)}/plan`, { plan: sel.value });
    loadBilling();
  }));
  $('clientList').querySelectorAll('[data-detach]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm(`Detach ${btn.dataset.detach}? Their account keeps its data but leaves your agency.`)) return;
    await api('DELETE', `/api/app/agency/clients/${encodeURIComponent(btn.dataset.detach)}`);
    loadClients(); loadBilling();
  }));
}

async function loadBilling() {
  const { data } = await api('GET', '/api/app/agency/clients');
  if (!data.ok) return;
  const b = data.billing;
  $('billingSummary').innerHTML = `
    <table class="data-table" style="max-width:520px">
      <tr><td>Agency plan</td><td><strong>${esc(b.agencyPlan)}</strong> — $${b.agencyPrice}/mo</td></tr>
      <tr><td>Client seats</td><td>${b.seats} × $49 = <strong>$${b.seatChargeMonthly}/mo</strong></td></tr>
      <tr><td>Client-side MRR (informational)</td><td>$${b.clientMrr}/mo</td></tr>
      <tr><td><strong>Consolidated invoice</strong></td><td><strong>$${b.consolidatedTotal}/mo</strong></td></tr>
    </table>`;
}

// ---------- white-label ----------
function bindWhiteLabel() {
  $('saveWhiteLabelBtn').addEventListener('click', async () => {
    const out = $('whiteLabelResult');
    const { data } = await api('POST', '/api/app/white-label', {
      brandName: $('wlBrand').value, logoUrl: $('wlLogo').value,
      cname: $('wlCname').value, accentColor: $('wlColor').value,
    });
    out.innerHTML = data.ok
      ? `<span class="ok-tag">✓ Branding saved</span> — share the live report: <a href="/api/reports/branded" target="_blank" class="link">open branded report ↗</a>${data.whiteLabel.cname ? ` (or point ${esc(data.whiteLabel.cname)} via CNAME)` : ''}`
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
  });
}

async function loadWhiteLabel() {
  const wl = me?.whiteLabel;
  if (wl) {
    $('wlBrand').value = wl.brandName || '';
    $('wlLogo').value = wl.logoUrl || '';
    $('wlCname').value = wl.cname || '';
    $('wlColor').value = wl.accentColor || '';
  }
}

// ---------- CRM webhooks ----------
function bindWebhooks() {
  $('addWebhookBtn').addEventListener('click', async () => {
    const out = $('webhookResult');
    out.innerHTML = 'Adding…';
    const events = [...document.querySelectorAll('.whEvent:checked')].map(c => c.value);
    const { data } = await api('POST', '/api/app/integrations/webhooks', {
      provider: $('whProvider').value, url: $('whUrl').value, secret: $('whSecret').value || undefined, events,
    });
    out.innerHTML = data.ok
      ? `<span class="ok-tag">✓ Webhook added</span> — events will POST to ${esc(data.webhook.provider)}.`
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
    if (data.ok) { $('whUrl').value = ''; $('whSecret').value = ''; loadWebhooks(); }
  });
}

async function loadWebhooks() {
  const { data } = await api('GET', '/api/app/integrations/webhooks');
  if (!data.ok) return;
  $('webhookList').innerHTML = data.webhooks.length ? data.webhooks.map(w => `
    <div class="sender-row">
      <div class="sender-info">
        <strong>${esc(w.provider)}</strong>
        <span>${esc(w.url.slice(0, 60))}${w.url.length > 60 ? '…' : ''} · events: ${esc((w.events || []).join(', '))}</span>
      </div>
      <button class="link" data-test-hook="${w.id}">Test</button>
      <button class="link" data-del-hook="${w.id}">Remove</button>
    </div>`).join('') : '<p class="settings-note">No webhooks yet — add one below to sync your CRM.</p>';
  $('webhookList').querySelectorAll('[data-del-hook]').forEach(btn => btn.addEventListener('click', async () => {
    await api('DELETE', `/api/app/integrations/webhooks/${btn.dataset.delHook}`);
    loadWebhooks();
  }));
  $('webhookList').querySelectorAll('[data-test-hook]').forEach(btn => btn.addEventListener('click', async () => {
    btn.textContent = '…';
    const { data: r } = await api('POST', `/api/app/integrations/webhooks/${btn.dataset.testHook}/test`);
    btn.textContent = 'Test';
    $('webhookResult').innerHTML = r.ok
      ? `<span class="ok-tag">✓ Delivered</span> — endpoint returned ${r.status}.`
      : `<span class="no-tag">✗ ${esc(r.error || 'Failed')}</span>`;
  }));
}

// ---------- bulk tools: verify + enrich ----------
function bindBulkTools() {
  $('verifyAllBtn').addEventListener('click', async () => {
    if (!selectedCampaign) { $('bulkToolResult').innerHTML = 'Pick a campaign first.'; return; }
    const out = $('bulkToolResult');
    out.innerHTML = 'Verifying every prospect (MX + catch-all probe)…';
    const { data } = await api('POST', `/api/app/campaigns/${selectedCampaign}/verify-all`);
    out.innerHTML = data.ok
      ? `<span class="ok-tag">✓ Done</span> — ${data.checked} checked: ${data.deliverable} deliverable, ${data.acceptAll} accept-all (kept, risky), ${data.undeliverable} removed from the sequence.`
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
    loadProspects();
  });
  $('enrichAllBtn').addEventListener('click', async () => {
    if (!selectedCampaign) { $('bulkToolResult').innerHTML = 'Pick a campaign first.'; return; }
    const out = $('bulkToolResult');
    out.innerHTML = 'Enriching…';
    const { data } = await api('POST', `/api/app/campaigns/${selectedCampaign}/enrich-all`);
    out.innerHTML = data.ok
      ? `<span class="ok-tag">✓ Enriched ${data.enriched}</span> via ${esc(data.provider)}${data.remaining ? ` — ${data.remaining} remaining (run again to continue)` : ''}`
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
    loadProspects();
  });
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
  if (status === 200) markStepDone('test');
});

// ---------- lead finder ----------
let leadFinderLeads = [];

async function loadLeadFinderStatus() {
  const { data } = await api('GET', '/api/app/lead-finder/status');
  if (!data.ok) return;
  const src = data.provider === 'apollo' ? 'via Apollo' : data.provider === 'hunter' ? 'via Hunter' : 'built-in verify';
  const ap = data.autopilot;
  $('leadFinderStatus').textContent = `${data.used}/${data.quota} credits used this month · ${src}${ap?.enabled ? ' · ✦ auto-pilot on' : ''}`;
  const toggle = $('autopilotEnabled');
  toggle.checked = !!ap?.enabled;
  $('autopilotSettings').hidden = !ap?.enabled;
  $('apCampaign').innerHTML = campaigns.map(c => `<option value="${c.id}" ${ap?.campaignId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  if (ap?.dailyLimit) $('apDailyLimit').value = String(ap.dailyLimit);
  $('autopilotNote').textContent = ap?.enabled && ap.lastNote ? `Last run: ${ap.lastNote}` : '';
  // Auto-fill the search form from the saved autopilot criteria — only into
  // fields the user hasn't already typed into, so it never clobbers edits.
  const fill = (src) => {
    if (src?.keywords && !$('lfKeywords').value) $('lfKeywords').value = src.keywords;
    if (src?.title && !$('lfTitle').value) $('lfTitle').value = src.title;
    if (src?.size) $('lfSize').value = src.size;
    if (src?.location && !$('lfLocation').value) $('lfLocation').value = src.location;
  };
  fill(ap || data.seed);

  // Any field still empty → website-scan prefill fills what's left
  // (each field fills non-destructively, so user edits are never clobbered).
  if (data.seed?.website && !$('lfScanUrl').value) $('lfScanUrl').value = data.seed.website;
  const anyEmpty = !$('lfKeywords').value || !$('lfTitle').value || !$('lfSize').value || !$('lfLocation').value;
  if (anyEmpty && !applyLeadFinderPrefill.done) {
    applyLeadFinderPrefill.done = true;
    applyLeadFinderPrefill();
  }
}

// Scan & fill — explicit user action, so it OVERWRITES filled fields
// (unlike the auto prefill, which only fills empty ones).
function bindLeadFinderScan() {
  $('lfScanBtn').addEventListener('click', async () => {
    const status = $('lfScanStatus');
    const url = $('lfScanUrl').value.trim();
    if (!url) {
      status.className = 'ai-status err';
      status.textContent = 'Enter your company website first (e.g. yourcompany.com).';
      return;
    }
    const btn = $('lfScanBtn');
    btn.disabled = true;
    status.className = 'ai-status loading';
    status.textContent = '🔍 Reading your site…';
    try {
      const { data } = await api('POST', '/api/app/lead-finder/scan-fill', { url });
      if (!data.ok || !data.prefill) throw new Error(data.error || 'Scan failed');
      const p = data.prefill;
      if (p.service) $('lfService').value = p.service;
      if (p.valueProp) $('lfValue').value = p.valueProp;
      if (p.keywords) $('lfKeywords').value = p.keywords;
      if (p.title) $('lfTitle').value = p.title;
      if (p.size) $('lfSize').value = p.size;
      if (p.location) $('lfLocation').value = p.location;
      servicePitch = p.service || data.siteTitle || url;
      status.className = 'ai-status ok';
      const gaps = !p.keywords ? ' Could not infer the target industry — type it in step 2.' : '';
      status.textContent = (data.source === 'llm'
        ? `✦ Filled from ${url} — review, then hit ✦ Find leads.`
        : `✦ Filled from ${url} (heuristic — set LLM_API_KEY for AI-quality fills).`) + gaps;
    } catch (err) {
      status.className = 'ai-status err';
      status.textContent = `✕ ${err.message || 'Could not scan that site — fill manually.'}`;
    } finally {
      btn.disabled = false;
    }
  });
}

async function applyLeadFinderPrefill() {
  try {
    const { data } = await api('GET', '/api/app/lead-finder/prefill');
    const d = data;
    if (!d?.prefill) return;
    const p = d.prefill;
    let filled = 0;
    const fill = (id, val) => { const el = $(id); if (el && !el.value && val) { el.value = val; filled++; } };
    fill('lfService', p.service);
    fill('lfValue', p.valueProp);
    fill('lfKeywords', p.keywords);
    fill('lfTitle', p.title);
    fill('lfSize', p.size);
    fill('lfLocation', p.location);
    servicePitch = p.service || d.siteTitle || $('lfScanUrl').value || servicePitch;
    if (filled > 0 && $('lfPrefillNote')) {
      $('lfPrefillNote').textContent = `✨ Pre-filled from your website — tweak anything before searching.`;
    }
  } catch {}
}

async function saveAutopilot(enabled) {
  const body = {
    enabled,
    keywords: $('lfKeywords').value.trim(),
    title: $('lfTitle').value.trim(),
    size: $('lfSize').value,
    location: $('lfLocation').value.trim(),
    campaignId: $('apCampaign').value,
    dailyLimit: Number($('apDailyLimit').value || 5),
  };
  const { status, data } = await api('PUT', '/api/app/lead-finder/autopilot', body);
  if (status !== 200 || !data.ok) {
    $('autopilotEnabled').checked = false;
    $('autopilotSettings').hidden = true;
    $('autopilotNote').textContent = '';
    $('leadFindNote').textContent = data.error || 'Could not save autopilot.';
    return;
  }
  $('autopilotNote').textContent = enabled
    ? `✓ Auto-pilot on — up to ${data.autopilot.dailyLimit} verified leads/day into this campaign. First run on the next engine pass.`
    : 'Auto-pilot off.';
  loadLeadFinderStatus();
}

function intelCardHtml(d) {
  const list = (items, empty) => items && items.length
    ? `<ul>${items.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : `<p class="intel-empty">${empty}</p>`;
  return `
    <div class="intel-card">
      <div class="intel-head">
        <strong>${esc(d.domain)}</strong>
        <a href="https://${esc(d.domain)}" target="_blank" rel="noopener">visit site ↗</a>
        <span class="intel-src">${d.source === 'llm' ? '✦ AI research' : 'site scan'}</span>
      </div>
      <p class="intel-summary">${esc(d.summary)}</p>
      <div class="intel-grid">
        <div class="intel-sec">
          <h4>Services &amp; features</h4>
          ${list(d.features, 'No clear feature statements found on the site.')}
        </div>
        <div class="intel-sec">
          <h4>How they compare</h4>
          ${list(d.vsOthers, 'No explicit comparison claims found.')}
        </div>
        <div class="intel-sec">
          <h4>Why buyers choose them</h4>
          ${list(d.whyChoose, 'No proof points found on the site.')}
        </div>
      </div>
      <div class="intel-angle">
        <h4>✦ Your angle</h4>
        <p>${esc(d.angle)}</p>
      </div>
    </div>`;
}

async function toggleLeadIntel(btn, row) {
  const i = Number(btn.dataset.intel);
  const lead = leadFinderLeads[i];
  const tbody = row.parentNode;
  const existing = tbody.querySelector(`tr[data-intel-row="${i}"]`);
  if (existing) { existing.remove(); btn.textContent = '✦ Intel'; return; }
  btn.disabled = true;
  btn.textContent = '…';
  const { status, data } = await api('POST', '/api/app/lead-finder/intel', {
    company: lead.company, email: lead.email, pitch: servicePitch, title: lead.title,
  });
  btn.disabled = false;
  btn.textContent = '✦ Intel';
  const tr = document.createElement('tr');
  tr.dataset.intelRow = i;
  const content = status === 200 && data.ok
    ? intelCardHtml(data)
    : `<div class="intel-card"><p class="intel-empty">${esc(data.error || 'Research failed.')}</p></div>`;
  tr.innerHTML = `<td colspan="7">${content}</td>`;
  row.after(tr);
}

function renderLeadResults(leads) {
  leadFinderLeads = leads;
  const box = $('leadResults');
  if (!leads.length) { box.hidden = true; return; }
  box.hidden = false;
  const tbody = $('leadTable').querySelector('tbody');
  tbody.innerHTML = leads.map((l, i) => `
    <tr>
      <td><input type="checkbox" data-lead="${i}" checked /></td>
      <td>${esc(l.email)}</td>
      <td>${esc([l.firstName, l.lastName].filter(Boolean).join(' ')) || '—'}</td>
      <td>${esc(l.company) || '—'}</td>
      <td>${esc(l.title) || '—'}</td>
      <td>${l.verified === 'valid' ? '<span class="ok-tag">✓ deliverable</span>' : '<span class="warn-tag">unknown</span>'}</td>
      <td><button class="btn btn-ghost btn-xs" data-intel="${i}">✦ Intel</button></td>
    </tr>`).join('');
  tbody.onclick = e => {
    const btn = e.target.closest('[data-intel]');
    if (btn) toggleLeadIntel(btn, btn.closest('tr'));
  };
  $('leadEnrollCampaign').innerHTML = campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function bindLeadFinder() {
  $('autopilotEnabled').addEventListener('change', e => {
    $('autopilotSettings').hidden = !e.target.checked;
    if (e.target.checked) { $('apCampaign').innerHTML = campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); }
    saveAutopilot(e.target.checked);
  });
  $('apCampaign').addEventListener('change', () => { if ($('autopilotEnabled').checked) saveAutopilot(true); });
  $('apDailyLimit').addEventListener('change', () => { if ($('autopilotEnabled').checked) saveAutopilot(true); });
  $('leadFindBtn').addEventListener('click', async () => {
    const btn = $('leadFindBtn');
    const note = $('leadFindNote');
    btn.disabled = true;
    note.textContent = 'Searching and checking emails…';
    $('leadResults').hidden = true;
    const body = {
      keywords: $('lfKeywords').value.trim(),
      title: $('lfTitle').value.trim(),
      size: $('lfSize').value,
      location: $('lfLocation').value.trim(),
      limit: Number($('lfCount').value || 10),
    };
    if ($('lfService').value.trim()) servicePitch = $('lfService').value.trim();
    const { status, data } = await api('POST', '/api/app/lead-finder/search', body);
    btn.disabled = false;
    if (status !== 200 || !data.ok) {
      note.textContent = data.error || 'Search failed.';
      return;
    }
    note.textContent = data.leads.length
      ? `Found ${data.leads.length} — every address is checked before it lands here. (${data.used}/${data.quota} credits)`
      : (data.errors?.length
        ? `Search hit a provider error: ${data.errors.join('; ')}`
        : 'No leads matched — try broader keywords or a different title.');
    renderLeadResults(data.leads);
    loadLeadFinderStatus();
  });

  $('leadEnrollBtn').addEventListener('click', async () => {
    const selected = [...document.querySelectorAll('#leadTable input[data-lead]:checked')]
      .map(cb => leadFinderLeads[Number(cb.dataset.lead)]).filter(Boolean);
    const campaignId = $('leadEnrollCampaign').value;
    if (!campaignId) { $('leadFindNote').textContent = 'Pick a campaign to add them to.'; return; }
    if (!selected.length) { $('leadFindNote').textContent = 'Select at least one lead.'; return; }
    const { status, data } = await api('POST', '/api/app/lead-finder/enroll', { campaignId, leads: selected });
    $('leadFindNote').textContent = status === 200 && data.ok
      ? `✓ Added ${data.added} to “${data.campaignName}”${data.skippedSuppressed ? ` · ${data.skippedSuppressed} suppressed skipped` : ''}.`
      : (data.error || 'Enroll failed.');
    if (status === 200 && data.ok) {
      $('leadResults').hidden = true;
      leadFinderLeads = [];
      loadCampaigns();
      loadProspects();
    }
  });
}

async function loadAll() {
  await Promise.all([loadOverview(), loadCampaigns()]);
  loadActivity();
  loadLeadFinderStatus();
  bindLeadFinder();
  bindLeadFinderScan();
}

init();
