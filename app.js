// Outrovo dashboard
const api = (method, path, body) =>
  fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json().then(d => ({ status: r.status, data: d })));

// Non-blocking toast notifications (replaces alert()). Dismissible via ✕.
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = msg;
  const close = document.createElement('button');
  close.className = 'toast-x';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  el.append(text, close);
  document.body.appendChild(el);
  const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  close.addEventListener('click', dismiss);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(dismiss, 5000);
}

// ---------- custom selects ----------
// Native <select> dropdowns look different (and dated) on every OS/browser.
// This wraps each one in a styled button + popover while keeping the original
// element as the source of truth: picking an option sets select.value and
// fires a real 'change' event, so no other code needs to know.
function enhanceSelect(select) {
  if (select.dataset.fancy || select.hidden) return;
  select.dataset.fancy = '1';
  const wrap = document.createElement('div');
  wrap.className = 'fselect';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fselect-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  const label = document.createElement('span');
  label.className = 'fselect-label';
  const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chev.setAttribute('viewBox', '0 0 24 24');
  chev.innerHTML = '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  btn.append(label, chev);
  const pop = document.createElement('div');
  pop.className = 'fselect-pop';
  pop.setAttribute('role', 'listbox');
  pop.hidden = true;
  wrap.append(btn, pop);
  select.after(wrap);
  wrap.appendChild(select);

  const syncLabel = () => {
    const opt = select.options[select.selectedIndex];
    label.textContent = opt ? opt.textContent : '';
    wrap.classList.toggle('empty', !opt);
  };
  const buildOptions = () => {
    pop.innerHTML = '';
    [...select.options].forEach((opt, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'fselect-opt' + (i === select.selectedIndex ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.textContent = opt.textContent;
      item.addEventListener('click', () => {
        select.selectedIndex = i;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      });
      pop.appendChild(item);
    });
  };
  const open = () => { buildOptions(); syncLabel(); pop.hidden = false; wrap.classList.add('open'); };
  const close = () => { pop.hidden = true; wrap.classList.remove('open'); };
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  btn.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' && pop.hidden) { e.preventDefault(); open(); }
  });
  select.addEventListener('change', syncLabel);
  // Options are often filled async after page load — re-sync when they change.
  new MutationObserver(syncLabel).observe(select, { childList: true });
  syncLabel();
}
function enhanceAllSelects(root = document) {
  root.querySelectorAll('select').forEach(enhanceSelect);
}

const $ = id => document.getElementById(id);

// Swap a button's content for a spinning gear while async work runs, then
// restore the exact original markup (industry-standard busy affordance).
// Industry-standard loader: 8 stroke-dash tapered ticks on a circle,
// rotated stepwise (30°/frame). Rotating gears were a dead end — every
// quality loader (iOS/Material/Tailwind/SpinKit) uses dash tapers on a
// plain circle, so the whole SVG rotates as a rigid point (no axis drift,
// no centroid wobble). steps(8) makes frames discrete, removing linear-
// interpolation drift entirely.
const TICKS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map(a => `<use href="#ov-tick" transform="rotate(${a} 12 12)"/>`).join('');
const GEAR_SVG = '<span class="spin-gear" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><defs><line id="ov-tick" x1="12" y1="3.5" x2="12" y2="6.5"/></defs>' + TICKS + '</svg></span>';
function setBtnLoading(btn, loading, label = 'Working…') {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
    btn.classList.add('is-loading');
    btn.disabled = true;
    // Freeze the button's size so swapping the label doesn't reflow it
    // mid-click (the "jitter" the user saw as the button resized).
    if (!btn.style.minWidth) btn.style.minWidth = btn.offsetWidth + 'px';
    btn.innerHTML = `${GEAR_SVG} ${label}`;
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.style.minWidth = '';
    if (btn.dataset.origHtml) { btn.innerHTML = btn.dataset.origHtml; delete btn.dataset.origHtml; }
  }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = t => new Date(t).toLocaleString();

let me, campaigns = [], selectedCampaign = null;
const AV_COLORS = ['#F2501E', '#16a34a', '#a855f7', '#0e1626', '#b3762e', '#d15554', '#2563eb'];
function avColor(name) { const h = [...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0); return AV_COLORS[h % AV_COLORS.length]; }
function dayOfWeekLetter(d) { return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(d).getDay()]; }
function greetingName() {
  return (me?.firstName || me?.name || me?.company || '').split(/[ .]/)[0] || '';
}
function greeting() {
  const h = new Date().getHours();
  const w = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const n = greetingName();
  return n ? `Good ${w}, ${n}` : `Good ${w}`;
}
function smallDisc(data) {
  if (data == null || data === 0) return '—';
  const v = Number(data);
  if (v > 0) return `<span class="sd-up">▲ ${v.toFixed(1)}</span>`;
  if (v < 0) return `<span class="sd-dn">▼ ${Math.abs(v).toFixed(1)}</span>`;
  return '—';
}
// Remembered from the last successful Scan & fill / prefill — used to
// personalize each lead's ✦ Intel research angle.
let servicePitch = '';

// ---------- auth gate ----------
async function init() {
  const { status, data } = await api('GET', '/api/me');
  if (status !== 200) { window.location.href = '/login.html'; return; }
  me = data.user;
  enhanceAllSelects();
  $('userName').textContent = me ? `${me.firstName} ${me.lastName}` : 'User';
  $('userAvatar').textContent = ((me?.firstName || 'U')[0] + (me?.lastName || '')[0]).toUpperCase();
  if (data.plan?.name) {
    $('planPill').textContent = data.plan.name;
    $('planPill').hidden = false;
  }
  // Nothing above Agency to upgrade to — retire the upsell button.
  if (data.plan?.id === 'agency') document.querySelector('.app-upsell')?.remove();
  // Returning from checkout (?upgraded=<planId>).
  const upgraded = new URLSearchParams(location.search).get('upgraded');
  if (upgraded) {
    history.replaceState(null, '', location.pathname);
    const banner = $('engineBanner');
    const aliases = { pro: 'growth' };
    const applied = data.plan?.id === (aliases[upgraded] || upgraded);
    banner.hidden = false;
    banner.innerHTML = applied
      ? `<strong>You're on ${esc(data.plan.name)} now</strong> — higher limits are active immediately.`
      : '⏳ <strong>Payment received</strong> — your plan will activate once the billing confirmation arrives. If it doesn\u2019t update within a few minutes, contact support.';
  }
  if (data.engine === 'demo') $('engineBanner').hidden = false;
  const planLine = data.plan
    ? `Plan: ${data.plan.name}${data.plan.id === 'trial' && data.plan.trialEnds ? ` (trial ends ${new Date(data.plan.trialEnds).toLocaleDateString()})` : ''}`
    : '';
  $('accountInfo').textContent = (me ? `${me.firstName} ${me.lastName} — ${me.email} (${me.company})` : '') + (planLine ? ` · ${planLine}` : '');
  if (data.plan?.expired) {
    const banner = $('engineBanner');
    banner.hidden = false;
    banner.innerHTML = '<strong>Trial ended</strong> — upgrade on the <a href="/pricing.html" style="color:inherit;text-decoration:underline;">pricing page</a> to keep sending.';
  }

  bindNav();
  bindLogout();
  bindCampaignModal();
  bindCampaignDetail();
  bindProspects();
  bindSenders();
  bindSettingsHero();
  bindByokApollo();
  bindAccount();
  bindAgency();
  bindWhiteLabel();
  bindTopup();
  bindBulkTools();
  bindDeveloper();
  loadCredits();
  // Agency plan → reveal the Agency nav
  if (data.plan?.id === 'agency' || me?.owner) $('agencyNavBtn').hidden = false;
  loadAll();
}

// ---------- nav ----------

function bindNav() {
  $('appNav').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || !btn.dataset.page) return;
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
  if (name === 'campaigns') { backToList(); loadCampaigns(); }
  if (name === 'leads') loadLeadFinderStatus();
  if (name === 'overview') { loadOverview(); loadOvExtras(); }
  if (name === 'settings') { loadSenders(); loadSettingsHero(); loadDeveloper(); }
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
  $('ovGreeting').textContent = greeting();
  const { data } = await api('GET', '/api/app/overview');
  if (!data.ok) return;
  const s = data.stats;
  const openRate = s.sent ? ((s.replies || 0) / Math.max(1, s.sent) * 100).toFixed(1) + '%' : '—';
  const replyRate = s.sent ? ((s.replies || 0) / Math.max(1, s.sent) * 100).toFixed(1) + '%' : '—';
  const stats = [
    ['Emails sent', s.sent || 0, smallDisc(s.sent)],
    ['Open rate', openRate, smallDisc(s.replies)],
    ['Reply rate', replyRate, smallDisc(s.replies)],
    ['Active leads', s.prospects || 0, smallDisc(s.prospects)],
  ];
  $('statGrid').innerHTML = stats.map(([label, val, trend]) => `
    <div class="stat-card ov-stat">
      <span class="ov-label">${label}</span>
      <strong>${val}</strong>
      <span class="ov-trend">${trend}</span>
    </div>`).join('');
}
async function loadOvExtras() {
  const [{ data: replies }, { data: events }] = await Promise.all([
    api('GET', '/api/app/inbox'),
    api('GET', '/api/app/activity'),
  ]);
  const nameCounts = {};
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 864e5);
    return { date: d.toISOString().slice(0, 10), label: dayOfWeekLetter(d), count: 0 };
  });
  (events.events || []).forEach(e => {
    const d = e.at?.slice(0, 10);
    days.forEach(dd => { if (dd.date === d && (e.type === 'sent' || e.type === 'campaign_started')) dd.count += 1; });
  });
  const maxCount = Math.max(...days.map(d => d.count), 1);
  $('ovChart').innerHTML = days.map(d => `
    <div class="ov-bar"><div class="ov-bar-fill" style="height:${Math.round(d.count / maxCount * 100)}%"></div><span>${d.label}</span></div>`).join('');
  const recentReplies = (replies.replies || []).slice(0, 5).map(r => {
    const label = r.prospect || r.from || r.subject || 'Reply';
    const color = avColor(label);
    const init = label.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const subject = (r.body || '').slice(0, 60);
    return `<li>
      <span class="ov-avatar" style="background:${color}">${init}</span>
      <div class="ov-replies-body">
        <div class="ov-replies-name"><strong>${esc(label)}</strong><span>${esc(subject)}</span></div>
        <span class="ov-replies-campaign">${esc(r.campaign || '')}</span>
      </div>
      <time>${fmtTime(r.at)}</time>
    </li>`;
  });
  $('ovReplies').innerHTML = recentReplies.length ? recentReplies.join('') : '<li class="empty">No replies yet — when someone answers your campaign, it shows up here.</li>';
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
  $('newCampaignBtn').addEventListener('click', startNewCampaign);
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
              <textarea class="body" placeholder="{Hi|Hello|Hey} {{firstName}}, noticed {{company}}… — variables, {spintax|variants} and {{bookingLink}} all work here">{Hi|Hello|Hey} {{firstName}}, {{company}} caught my eye — quick idea.</textarea>
              <button type="button" class="ab-toggle">A/B test this step</button>
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
    btn.textContent = box.hidden ? 'A/B test this step' : 'Remove variant B';
    if (box.hidden) { row.querySelector('.subject-b').value = ''; row.querySelector('.body-b').value = ''; }
  });
}

function addStepRow(type, data = {}, container) {
  const wrap = document.createElement('div');
  wrap.innerHTML = stepRowHtml(type);
  const row = wrap.firstElementChild;
  (container || $('cdStepEditorRows')).appendChild(row);
  row.querySelector('.remove-step').addEventListener('click', () => row.remove());
  row.querySelector('.step-type').addEventListener('change', e => {
    row.querySelector('.step-fields').innerHTML = e.target.value === 'email'
      ? `<input class="subject" placeholder="Subject — e.g. Quick question, {{firstName}}" /><textarea class="body" placeholder="{Hi|Hello|Hey} {{firstName}}, noticed {{company}}… — {{bookingLink}} drops in your calendar link"></textarea><button type="button" class="ab-toggle">A/B test this step</button><div class="ab-b" hidden><input class="subject-b" placeholder="Variant B subject" /><textarea class="body-b" placeholder="Variant B body — half your prospects get this version"></textarea></div>`
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

function collectSteps(container) {
  return [...container.querySelectorAll('.step-row')].map(row => {
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
}

function startNewCampaign() {
  selectedCampaign = null;
  $('campaignListView').hidden = true;
  $('campaignDetail').hidden = false;
  $('cdName').textContent = '';
  $('cdStatus').hidden = true;
  $('cdValidateBtn').hidden = true;
  $('cdRunBtn').hidden = true;
  $('cdTabs').hidden = true;
  $('cdStats').innerHTML = '';
  $('cdSteps').innerHTML = '';
  $('cdAddStepBtn').hidden = false;
  $('cdAiStepBtn').hidden = false;
  $('cdAiPanel').hidden = true;
  $('cdStepEditor').hidden = true;
  $('cdAbBlock').hidden = true;
  $('cdNewBlock').hidden = false;
  $('cdNewNote').textContent = '';
  $('cdNewStepRows').innerHTML = '';
  addStepRow('email', {}, $('cdNewStepRows'));
  document.querySelector('#ctab-steps .seq-divider').hidden = true;
  document.querySelector('#ctab-steps .seq-stats').hidden = true;
  $('cdName').focus();
}

async function createCampaign() {
  const name = $('cdName').textContent.trim();
  const steps = collectSteps($('cdNewStepRows'));
  if (!name) { $('cdNewNote').textContent = 'Give the campaign a name (click the title above).'; return; }
  if (!steps.length) { $('cdNewNote').textContent = 'Write the email subject and body first.'; return; }
  $('cdCreateBtn').disabled = true;
  const { data } = await api('POST', '/api/app/campaigns', { name, steps });
  $('cdCreateBtn').disabled = false;
  if (!data.ok) { $('cdNewNote').textContent = data.error || 'Could not create campaign.'; return; }
  await loadCampaigns();
  openCampaign(data.campaign.id);
}

const CLOCK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

function waitLabel(delayMinutes) {
  const m = Math.max(0, Number(delayMinutes || 0));
  if (m >= 1440 && m % 1440 === 0) return `Wait ${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m >= 60 && m % 60 === 0) return `Wait ${m / 60} hour${m === 60 ? '' : 's'}`;
  return `Wait ${m} min`;
}

const waitPillHtml = delayMinutes => `
  <div class="seq-item seq-item-wait">
    <div class="seq-node"><span class="seq-ico wait">${CLOCK_SVG}</span></div>
    <div class="seq-wait-pill">${CLOCK_SVG} ${waitLabel(delayMinutes)}</div>
  </div>`;

function campaignStepsHtml(c) {
  const totalEmails = c.steps.filter(s => s.type === 'email').length;
  let emailIdx = 0;
  const out = [];
  c.steps.forEach((s, i) => {
    // delayMinutes lives on the step it precedes — render it as a wait pill
    // between cards, like the sequence mockups.
    if (s.type !== 'wait' && i > 0 && Number(s.delayMinutes) > 0) out.push(waitPillHtml(s.delayMinutes));
    if (s.type === 'wait') { out.push(waitPillHtml(s.delayMinutes)); return; }
    if (s.type === 'task') {
      const kind = ({ connect: 'Connection request', message: 'Direct message', view: 'Profile view' })[s.taskKind] || 'Manual action';
      out.push(`
        <div class="seq-item">
          <div class="seq-node"><span class="seq-ico li">in</span></div>
          <div class="seq-card">
            <div class="seq-card-head"><strong>LinkedIn task</strong><span class="status task">MANUAL</span><span class="seq-when">${esc(kind)}</span></div>
            <div class="seq-preview">${esc(s.note)}</div>
          </div>
        </div>`);
      return;
    }
    emailIdx++;
    const badge = c.status === 'active'
      ? '<span class="status active"><i></i>LIVE</span>'
      : '<span class="status draft"><i></i>DRAFT</span>';
    const when = (c.sentCount || 0) ? `${c.sentCount} sent so far` : 'not sent yet';
    const preview = (s.body || '').replace(/\s+/g, ' ').trim();
    out.push(`
      <div class="seq-item">
        <div class="seq-node"><span class="seq-num">${emailIdx}</span></div>
        <div class="seq-card">
          <div class="seq-card-head"><strong>Email ${emailIdx} of ${totalEmails}</strong>${badge}${s.variantB ? '<span class="status task">A/B</span>' : ''}<span class="seq-when">${when}</span></div>
          <div class="seq-subject">Subject: ${esc(s.subject || '—')}</div>
          <div class="seq-preview">${esc(preview.slice(0, 110))}${preview.length > 110 ? '…' : ''}</div>
        </div>
      </div>`);
  });
  return out.join('');
}

function campaignStatsHtml(c) {
  const sent = c.sentCount || 0;
  const bounced = c.bounced || 0;
  const replied = c.replied || 0;
  const opened = c.opened || 0;
  const placed = sent ? Math.round((Math.max(0, sent - bounced) / sent) * 100) : null;
  const openRate = sent ? Math.round((opened / sent) * 100) : null;
  const replyRate = sent ? Math.round((replied / sent) * 100) : null;
  const days = Array.isArray(c.repliesPastWeek) ? c.repliesPastWeek : [];
  const peak = Math.max(1, ...days);
  const bars = days.length
    ? `<div class="cp-bars">${days.map((n, i) => `<i style="height:${Math.max(12, Math.round((n / peak) * 100))}%" class="${i % 2 ? 'b' : 'a'}" title="${n} repl${n === 1 ? 'y' : 'ies'}"></i>`).join('')}</div>`
    : '';
  return `
    <div class="cp-kpi"><span>Landing in inbox</span><strong>${placed === null ? '—' : placed + '%'}</strong></div>
    <div class="cp-kpi"><span>Open rate</span><strong>${openRate === null ? '—' : openRate + '%'}</strong></div>
    <div class="cp-kpi"><span>Reply rate</span><strong>${replyRate === null ? '—' : replyRate + '%'}</strong></div>
    <div><span class="cp-kpi-label">Replies · 7 days</span>${bars}</div>`;
}

function campaignRowHtml(c) {
  const emails = c.steps.filter(s => s.type === 'email').length;
  const sent = c.sentCount || 0;
  const openRate = sent ? Math.round(((c.opened || 0) / sent) * 100) : null;
  const replyRate = sent ? Math.round(((c.replied || 0) / sent) * 1000) / 10 : null;
  const progress = c.prospects ? Math.round(((c.finished || 0) / c.prospects) * 100) : 0;
  return `
    <tr class="campaign-row" data-open="${c.id}" tabindex="0">
      <td><span class="c-name"><span class="c-dot ${esc(c.status)}"></span><strong>${esc(c.name)}</strong></span></td>
      <td><span class="status ${esc(c.status)}"><i></i>${esc(c.status)}</span></td>
      <td>${emails} email${emails === 1 ? '' : 's'}</td>
      <td>${c.prospects}</td>
      <td>${sent}</td>
      <td>${openRate === null ? '—' : openRate + '%'}</td>
      <td>${replyRate === null ? '—' : replyRate + '%'}</td>
      <td><span class="c-progress"><span class="c-bar"><i style="width:${progress}%"></i></span><span class="c-pct">${progress}%</span></span></td>
    </tr>`;
}

async function loadCampaigns() {
  const { data } = await api('GET', '/api/app/campaigns');
  if (!data.ok) return;
  campaigns = data.campaigns;
  const list = $('campaignList');
  if (!campaigns.length) {
    list.innerHTML = '<div class="empty-state"><h3>No campaigns yet</h3><p>Press <strong>+ New Campaign</strong> above and the step builder opens. Emails go out automatically once you hit Run.</p></div>';
  } else {
    list.innerHTML = `<table class="campaign-table">
      <thead><tr><th>Campaign</th><th>Status</th><th>Steps</th><th>Contacts</th><th>Sent</th><th>Open</th><th>Reply</th><th>Progress</th></tr></thead>
      <tbody>${campaigns.map(c => campaignRowHtml(c)).join('')}</tbody>
    </table>`;
  }

  list.querySelectorAll('[data-open]').forEach(card => {
    const open = () => openCampaign(card.dataset.open);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });

  // Keep an open detail view in sync (status, steps, stats).
  if (selectedCampaign && !$('campaignDetail').hidden) {
    const c = campaigns.find(x => x.id === selectedCampaign);
    if (c) renderCampaignDetail(c); else backToList();
  }
}

// ---------- campaign detail ----------
function switchCampaignTab(name) {
  document.querySelectorAll('#cdTabs .settings-tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === name));
  document.querySelectorAll('.ctab-pane').forEach(p => p.hidden = p.id !== 'ctab-' + name);
}

function renderCampaignDetail(c) {
  $('cdNewBlock').hidden = true;
  document.querySelector('#ctab-steps .seq-divider').hidden = false;
  document.querySelector('#ctab-steps .seq-stats').hidden = false;
  $('cdStatus').hidden = false;
  $('cdValidateBtn').hidden = false;
  $('cdRunBtn').hidden = false;
  $('cdTabs').hidden = false;
  $('cdAddStepBtn').hidden = false;
  $('cdName').textContent = c.name;
  const status = $('cdStatus');
  status.className = `status ${c.status}`;
  status.innerHTML = `<i></i>${esc(c.status)}`;
  const active = c.status === 'active';
  $('cdRunBtn').innerHTML = `${active ? '<svg class="tab-ico" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4.5" height="16" rx="1"/><rect x="15" y="4" width="4.5" height="16" rx="1"/></svg>Pause campaign'
    : '<svg class="tab-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Run campaign'}`;
  $('cdSteps').innerHTML = campaignStepsHtml(c);
  $('cdStats').innerHTML = campaignStatsHtml(c);
  $('cdStepEditor').hidden = true;
  $('cdAiPanel').hidden = true;
  $('cdStepNote').textContent = '';
  // Settings tab — every control mirrors the saved campaign settings.
  $('cdDailyCap').value = c.dailyCap ?? 25;
  $('cdDailyCapVal').textContent = c.dailyCap ?? 25;
  $('cdGapMin').value = c.gapMin ?? 4;
  $('cdGapMax').value = c.gapMax ?? 9;
  $('cdWindowStart').value = String(c.sendWindowStart ?? 9).padStart(2, '0');
  $('cdWindowEnd').value = String(c.sendWindowEnd ?? 17).padStart(2, '0');
  $('cdTimezone').value = c.timezone || 'UTC';
  const days = Array.isArray(c.sendDays) ? c.sendDays.map(Number) : [0, 1, 2, 3, 4, 5, 6];
  $('cdDays').querySelectorAll('button').forEach(b => b.classList.toggle('on', days.includes(Number(b.dataset.day))));
  $('cdStopOnReply').checked = c.stopOnReply !== false;
  $('cdTrackOpens').checked = c.trackOpens !== false;
  $('cdStopOnBounce').checked = c.stopOnBounce !== false;
  $('cdSettingsNote').textContent = '';
  loadAbResults(c);
}

async function loadAbResults(c) {
  const block = $('cdAbBlock');
  const box = $('cdAbResults');
  if (!c.steps.some(s => s.variantB)) { block.hidden = true; return; }
  const { data: ab } = await api('GET', `/api/app/campaigns/${c.id}/ab-results`);
  if (!ab?.ok || !ab.results.length) { block.hidden = true; return; }
  block.hidden = false;
  box.innerHTML = ab.results.map(r => `
    <div class="ab-row">
      <span class="ab-label">${esc(r.label)}</span>
      <span class="ab-cell ${r.winner === 'A' ? 'ab-winner' : ''}">A — ${esc(r.variantA.subject.slice(0, 34))}: ${r.variantA.sent} sent · ${r.variantA.replied} replies (${r.variantA.replyRate}%)</span>
      <span class="ab-cell ${r.winner === 'B' ? 'ab-winner' : ''}">B — ${esc(r.variantB.subject.slice(0, 34))}: ${r.variantB.sent} sent · ${r.variantB.replied} replies (${r.variantB.replyRate}%)</span>
    </div>`).join('');
}

function openCampaign(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  selectedCampaign = id;
  $('campaignListView').hidden = true;
  $('campaignDetail').hidden = false;
  renderCampaignDetail(c);
  switchCampaignTab('steps');
  $('bulkToolResult').innerHTML = '';
  loadProspects();
}

function backToList() {
  selectedCampaign = null;
  $('campaignDetail').hidden = true;
  $('campaignListView').hidden = false;
  $('addLeadsModal').hidden = true;
  $('cdNewBlock').hidden = true;
  document.querySelector('#ctab-steps .seq-divider').hidden = false;
  document.querySelector('#ctab-steps .seq-stats').hidden = false;
  $('cdStatus').hidden = false;
  $('cdValidateBtn').hidden = false;
  $('cdRunBtn').hidden = false;
  $('cdTabs').hidden = false;
  $('cdAddStepBtn').hidden = false;
  $('cdAiStepBtn').hidden = false;
  $('cdAiPanel').hidden = true;
}

function bindCampaignDetail() {
  // Hour dropdowns for the send window (00:00–23:00).
  for (const id of ['cdWindowStart', 'cdWindowEnd']) {
    $(id).innerHTML = Array.from({ length: 24 }, (_, h) => {
      const v = String(h).padStart(2, '0');
      return `<option value="${v}">${v}:00</option>`;
    }).join('');
  }
  $('cdBackBtn').addEventListener('click', () => { backToList(); loadCampaigns(); });
  $('cdCreateBtn').addEventListener('click', createCampaign);
  const cdName = $('cdName');
  cdName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cdName.blur(); } });
  cdName.addEventListener('blur', async () => {
    const name = cdName.textContent.trim();
    if (!selectedCampaign) return;
    const c = campaigns.find(x => x.id === selectedCampaign);
    if (!c || !name || name === c.name) { if (c) cdName.textContent = c.name; return; }
    const { data } = await api('PATCH', `/api/app/campaigns/${selectedCampaign}`, { name });
    if (data.ok) { c.name = name; cdName.textContent = name; toast('Renamed.'); }
    else cdName.textContent = c.name;
  });
  $('cdTabs').addEventListener('click', e => {
    const tab = e.target.closest('.settings-tab');
    if (tab) switchCampaignTab(tab.dataset.ctab);
  });
  $('cdRunBtn').addEventListener('click', async () => {
    const c = campaigns.find(x => x.id === selectedCampaign);
    if (!c) return;
    const act = c.status === 'active' ? 'pause' : 'activate';
    $('cdRunBtn').disabled = true;
    await api('POST', `/api/app/campaigns/${selectedCampaign}/${act}`);
    $('cdRunBtn').disabled = false;
    loadCampaigns();
  });
  $('cdValidateBtn').addEventListener('click', validateCampaign);
  $('cdDeleteBtn').addEventListener('click', async () => {
    if (!confirm('Delete this campaign and its prospects?')) return;
    await api('DELETE', `/api/app/campaigns/${selectedCampaign}`);
    backToList();
    loadCampaigns();
  });
  // Settings tab interactivity
  $('cdDailyCap').addEventListener('input', () => { $('cdDailyCapVal').textContent = $('cdDailyCap').value; });
  $('cdDays').addEventListener('click', e => {
    const btn = e.target.closest('button[data-day]');
    if (btn) btn.classList.toggle('on');
  });
  $('cdSaveSettings').addEventListener('click', async () => {
    const sendDays = [...$('cdDays').querySelectorAll('button.on')].map(b => Number(b.dataset.day));
    if (!sendDays.length) { $('cdSettingsNote').textContent = 'Pick at least one active day.'; return; }
    const { data } = await api('PATCH', `/api/app/campaigns/${selectedCampaign}`, {
      dailyCap: Number($('cdDailyCap').value) || 25,
      gapMin: Number($('cdGapMin').value ?? 4),
      gapMax: Number($('cdGapMax').value ?? 9),
      sendWindowStart: Number($('cdWindowStart').value ?? 9),
      sendWindowEnd: Number($('cdWindowEnd').value ?? 17),
      timezone: $('cdTimezone').value || 'UTC',
      sendDays,
      stopOnReply: $('cdStopOnReply').checked,
      trackOpens: $('cdTrackOpens').checked,
      stopOnBounce: $('cdStopOnBounce').checked,
    });
    $('cdSettingsNote').textContent = data.ok ? 'Saved.' : (data.error || 'Could not save.');
    if (data.ok) loadCampaigns();
  });
  // Inline "+ Add step" editor — appends to the live sequence via PATCH.
  $('cdAddStepBtn').addEventListener('click', () => {
    $('cdStepEditorRows').innerHTML = '';
    addStepRow('email', {}, $('cdStepEditorRows'));
    $('cdStepNote').textContent = '';
    $('cdAiPanel').hidden = true;
    $('cdStepEditor').hidden = false;
    $('cdStepEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  // "Add step with AI" — AI drafts the next step, user reviews it in the
  // normal step editor before saving.
  const openAiPanel = () => {
    $('cdStepEditor').hidden = true;
    $('cdAiNote').textContent = '';
    $('cdAiPanel').hidden = false;
    $('cdAiPrompt').focus();
  };
  $('cdAiStepBtn').addEventListener('click', openAiPanel);
  $('cdNewAiBtn').addEventListener('click', openAiPanel);
  $('cdAiGenerateBtn').addEventListener('click', async () => {
    const c = campaigns.find(x => x.id === selectedCampaign);
    $('cdAiGenerateBtn').disabled = true;
    $('cdAiNote').textContent = 'Writing…';
    const { data } = await api('POST', '/api/app/ai/generate-step', {
      campaignName: c ? c.name : ($('cdName').textContent.trim() || 'Untitled campaign'),
      existingSteps: c ? c.steps : collectSteps($('cdNewStepRows')),
      instruction: $('cdAiPrompt').value.trim(),
    });
    $('cdAiGenerateBtn').disabled = false;
    if (!data.ok || !data.step) { $('cdAiNote').textContent = data.error || 'Could not write a step — try again.'; return; }
    $('cdAiNote').textContent = data.ai
      ? 'Drafted — review it below, then Save step.'
      : `AI call failed (${(data.aiError || 'unknown').slice(0, 140)}) — template step below, edit it, then Save step.`;
    $('cdStepEditorRows').innerHTML = '';
    addStepRow(data.step.type, data.step, $('cdStepEditorRows'));
    $('cdStepNote').textContent = '';
    $('cdStepEditor').hidden = false;
    $('cdStepEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('cdCancelStepBtn').addEventListener('click', () => { $('cdStepEditor').hidden = true; });
  $('cdSaveStepBtn').addEventListener('click', async () => {
    const c = campaigns.find(x => x.id === selectedCampaign);
    const newSteps = collectSteps($('cdStepEditorRows'));
    if (!newSteps.length) { $('cdStepNote').textContent = 'Fill in the step first — emails need a subject and body.'; return; }
    $('cdSaveStepBtn').disabled = true;
    if (selectedCampaign) {
      const { data } = await api('PATCH', `/api/app/campaigns/${selectedCampaign}`, { steps: [...c.steps, ...newSteps] });
      $('cdSaveStepBtn').disabled = false;
      if (!data.ok) { $('cdStepNote').textContent = data.error || 'Could not save the step.'; return; }
      $('cdStepEditor').hidden = true;
      toast('Step added to the sequence');
      loadCampaigns();
    } else {
      $('cdSaveStepBtn').disabled = false;
      newSteps.forEach(s => addStepRow(s.type, s, $('cdNewStepRows')));
      $('cdStepEditor').hidden = true;
      toast('Step added — create the campaign to save it');
    }
  });
  const openAddLeads = () => {
    $('importNote').textContent = '';
    $('addLeadsModal').hidden = false;
  };
  $('addLeadsBtn').addEventListener('click', openAddLeads);
  $('emptyAddLeadsBtn').addEventListener('click', openAddLeads);
  $('closeAddLeadsModal').addEventListener('click', () => { $('addLeadsModal').hidden = true; });
  $('addLeadsModal').addEventListener('click', e => { if (e.target === $('addLeadsModal')) $('addLeadsModal').hidden = true; });
  $('goFindLeadsBtn').addEventListener('click', () => { $('addLeadsModal').hidden = true; showPage('leads'); });
}

// Pre-flight check: steps complete, contacts enrolled, window sane, inbox connected.
async function validateCampaign() {
  const c = campaigns.find(x => x.id === selectedCampaign);
  if (!c) return;
  const issues = [];
  if (!c.steps?.length) issues.push('add at least one step');
  const incomplete = c.steps.filter(s => (s.type === 'email' && (!s.subject || !s.body)) || (s.type === 'task' && !s.note));
  if (incomplete.length) issues.push(`${incomplete.length} step${incomplete.length > 1 ? 's are' : ' is'} missing content`);
  if (Number(c.sendWindowStart ?? 9) === Number(c.sendWindowEnd ?? 17)) issues.push('send window is 00:00–00:00 (sends any hour — set a window if that is not intended)');
  const [{ data: pr }, { data: sn }] = await Promise.all([
    api('GET', `/api/app/prospects?campaignId=${selectedCampaign}`),
    api('GET', '/api/app/senders'),
  ]);
  if (pr?.ok && !pr.prospects.length) issues.push('no contacts enrolled yet');
  if (sn?.ok && !(sn.senders || []).length) issues.push('no sender inbox connected — sends run in demo mode until you connect one in Settings');
  if (issues.length) toast(`Not ready: ${issues.join(' · ')}`, 'err');
  else toast('All good — this campaign is ready to run.');
}

// ---------- prospects ----------
function bindProspects() {
  $('addProspectBtn').addEventListener('click', addSingleProspect);
  $('importBtn').addEventListener('click', importCsv);
}

async function loadProspects() {
  if (!selectedCampaign) return;
  const { data } = await api('GET', `/api/app/prospects?campaignId=${selectedCampaign}`);
  if (!data.ok) return;
  const empty = !data.prospects.length;
  $('prospectEmpty').hidden = !empty;
  $('prospectTableWrap').hidden = empty;
  $('cdContactCount').textContent = data.prospects.length;
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
  }).join('') || '<tr><td colspan="6" style="color:var(--ink-faint)">No one here yet — press <strong>+ Add leads</strong> to add people or import a list.</td></tr>';
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
let inboxThreads = [];
let activeThread = null;

const INTENT_LABEL = { interested: 'Interested', question: 'Question', not_now: 'Not now', not_interested: 'Not interested', out_of_office: 'Out of office', unsubscribe: 'Unsubscribe', bounce: 'Bounce' };
function intentPill(intent) {
  const label = INTENT_LABEL[intent];
  if (!label) return '';
  return `<span class="intent-pill intent-${esc(intent)}">${esc(label)}</span>`;
}
function inboxTime(t) {
  const d = new Date(t), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now - d < 7 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function initials(name) {
  return (name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

async function loadInbox(selectEmail) {
  const { data } = await api('GET', '/api/app/inbox/threads');
  if (!data.ok) return;
  inboxThreads = data.threads || [];
  if (selectEmail) activeThread = inboxThreads.find(t => t.email === selectEmail) || null;
  else if (activeThread) activeThread = inboxThreads.find(t => t.email === activeThread.email) || null;
  renderThreadList();
  renderConvo();
  if (!$('simulateReplyBtn').hasListener) {
    $('simulateReplyBtn').hasListener = true;
    $('simulateReplyBtn').addEventListener('click', async () => {
      await api('POST', '/api/app/inbox/simulate');
      loadInbox();
    });
  }
}

function renderThreadList() {
  const el = $('inboxThreads');
  if (!inboxThreads.length) {
    el.innerHTML = `<div class="inbox-threads-empty">No replies yet — when someone answers a campaign, their message lands here.</div>`;
    return;
  }
  el.innerHTML = inboxThreads.map(t => `
    <button class="inbox-thread ${activeThread?.email === t.email ? 'active' : ''} ${t.unread ? 'unread' : ''}" data-email="${esc(t.email)}">
      <span class="it-top">
        <strong>${esc(t.prospect)}</strong>
        ${intentPill(t.intent)}
        <time>${inboxTime(t.lastAt)}</time>
      </span>
      <span class="it-preview">${esc(t.preview)}</span>
      <span class="it-meta">${esc([t.company, t.campaign].filter(Boolean).join('  ·  '))}</span>
      <span class="it-close" data-del="${esc(t.email)}" title="Delete conversation" role="button" aria-label="Delete conversation">✕</span>
    </button>`).join('');
  el.querySelectorAll('.inbox-thread').forEach(btn => btn.addEventListener('click', () => {
    activeThread = inboxThreads.find(t => t.email === btn.dataset.email) || null;
    renderThreadList();
    renderConvo();
  }));
  el.querySelectorAll('[data-del]').forEach(x => x.addEventListener('click', async e => {
    e.stopPropagation();
    const email = x.dataset.del;
    const { data: d } = await api('DELETE', `/api/app/inbox/thread/${encodeURIComponent(email)}`);
    if (d.ok) {
      if (activeThread?.email === email) activeThread = null;
      toast('Conversation deleted');
      loadInbox();
    } else toast('Could not delete', 'err');
  }));
}

function renderConvo() {
  const body = $('inboxConvoBody'), empty = $('inboxConvoEmpty'), composer = $('inboxComposer');
  if (!activeThread) {
    body.hidden = true; composer.hidden = true; empty.hidden = false;
    return;
  }
  empty.hidden = true; body.hidden = false; composer.hidden = false;
  const t = activeThread;
  body.innerHTML = t.messages.map(m => m.dir === 'in' ? `
    <div class="msg msg-in">
      <span class="msg-av" style="background:${avColor(t.prospect)}">${esc(initials(t.prospect))}</span>
      <div class="msg-side">
        <div class="msg-head"><strong>${esc(t.prospect)}</strong><time>${inboxTime(m.at)}</time></div>
        <div class="msg-bubble">${esc(m.body).replace(/\n/g, '<br>')}</div>
        ${m.draft ? `<div class="msg-draft"><em>✦ AI draft (${esc(m.draft.source)})</em>${esc(m.draft.text).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
    </div>` : `
    <div class="msg msg-out">
      <div class="msg-side">
        <div class="msg-head"><strong>You</strong><time>${inboxTime(m.at)}</time></div>
        <div class="msg-bubble">${esc(m.body).replace(/\n/g, '<br>')}</div>
      </div>
      <span class="msg-av msg-av-you">YOU</span>
    </div>`).join('');
  body.scrollTop = body.scrollHeight;
  if (t.unread) {
    const latest = t.messages.filter(m => m.dir === 'in').pop();
    if (latest) api('POST', `/api/app/inbox/${latest.id}/read`).then(() => {
      inboxThreads.forEach(x => { if (x.email === t.email) x.unread = false; });
      renderThreadList();
    });
  }
  $('replyBox').value = '';
  if (!$('sendReplyBtn').hasListener) {
    $('sendReplyBtn').hasListener = true;
    $('sendReplyBtn').addEventListener('click', sendReply);
    $('aiDraftBtn').addEventListener('click', aiDraftReply);
  }
}

async function sendReply() {
  if (!activeThread) return;
  const text = $('replyBox').value.trim();
  if (!text) return toast('Write something first', 'err');
  const btn = $('sendReplyBtn');
  btn.disabled = true; btn.textContent = 'Sending…';
  const { data: d } = await api('POST', `/api/app/inbox/${activeThread.replyId}/send-reply`, { body: text });
  btn.disabled = false; btn.textContent = 'Send reply';
  if (d.ok) {
    toast(d.demo ? 'Reply logged (demo mode — connect an inbox to send for real)' : 'Reply sent');
    loadInbox(activeThread.email);
  } else toast(d.error || 'Send failed', 'err');
}

async function aiDraftReply() {
  if (!activeThread) return;
  const btn = $('aiDraftBtn');
  btn.disabled = true; btn.textContent = '… drafting';
  const { data: d } = await api('POST', `/api/app/inbox/${activeThread.replyId}/draft`, {});
  btn.disabled = false; btn.textContent = '✦ AI draft';
  if (d.ok && d.draft) $('replyBox').value = d.draft;
  else if (!d.ok) toast(d.error || 'Draft failed', 'err');
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
    $('fwdStep1')?.classList.add('done');
    setTimeout(() => { $('copyInboundBtn').textContent = 'Copy address'; }, 1500);
  });
  document.querySelector('.fwd-inbox-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('[data-page="inbox"]')?.click();
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
  if (e.data.ok) { loadSenders(); $('inboundGuide').open = true; }
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
  renderMailboxHero(data.senders);
  $('senderList').querySelectorAll('[data-del-sender]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this inbox from the rotation?')) return;
    await api('DELETE', `/api/app/senders/${btn.dataset.delSender}`);
    loadSenders();
  }));
  $('senderList').querySelectorAll('[data-test-sender]').forEach(btn => btn.addEventListener('click', async () => {
    const to = me?.email;
    if (!to) return;
    btn.textContent = 'Sending…';
    btn.disabled = true;
    const { data: r } = await api('POST', '/api/app/tools/test-email', { to, senderId: btn.dataset.testSender });
    btn.textContent = 'Send test';
    btn.disabled = false;
    $('senderResult').innerHTML = r.ok
      ? `<span class="ok-tag">✓ Sent</span> to ${esc(to)} via ${esc(r.sender || 'rotation')}${r.demo ? ' (demo — logged, not sent)' : ''}.`
      : `<span class="no-tag">✗ ${esc(r.error || 'Failed')}</span>`;
  }));
}

// ---------- settings hero (mailboxes / integrations / notifications) ----------
const MAILBOX_PROVIDERS = {
  gmail: { letter: 'G', cls: 'mb-google', label: 'Google Workspace' },
  microsoft: { letter: 'M', cls: 'mb-ms', label: 'Microsoft 365' },
};

function renderMailboxHero(senders) {
  const el = $('mailboxHeroList');
  if (!el) return;
  if (!senders.length) {
    el.innerHTML = '<p class="settings-note" style="padding:14px 0;">No inboxes connected yet.</p>';
    return;
  }
  el.innerHTML = senders.map(s => {
    const p = MAILBOX_PROVIDERS[s.provider] || { letter: (s.email || '?')[0].toUpperCase(), cls: 'mb-other', label: 'SMTP inbox' };
    const warming = Boolean(s.warmup?.isWarming);
    const pct = s.warmup ? Math.min(100, Math.round((s.capToday / Math.max(1, Number(s.dailyLimit) || 50)) * 100)) : 100;
    return `<div class="mailbox-row">
      <div class="mailbox-main">
        <span class="mb-avatar ${p.cls}">${p.letter}</span>
        <div>
          <div class="mailbox-email">${esc(s.email)}</div>
          <div class="mailbox-meta">${p.label} · warmup ${pct}%</div>
        </div>
      </div>
      <span class="status-pill ${warming ? 'pill-amber' : 'pill-green'}"><i></i>${warming ? 'Warming' : 'Healthy'}</span>
    </div>`;
  }).join('');
}

async function loadSettingsHero() {
  const { data } = await api('GET', '/api/app/settings/integrations');
  if (!data.ok) return;
  $('apolloHeroPill').hidden = !data.apollo;
  $('llmHeroPill').hidden = !data.llm;
  $('llmHeroOff').hidden = data.llm;
  const n = me?.notifications || {};
  $('notifHotLead').checked = n.hotLead !== false;
  $('notifDailyDigest').checked = n.dailyDigest !== false;
  $('notifBounce').checked = Boolean(n.bounceWarnings);
  loadByokApollo();
}

// BYOK: Apollo key save/remove — the backend validates against Apollo before
// storing, so a typo here can't silently downgrade the user to the crawler.
async function loadByokApollo() {
  const { data } = await api('GET', '/api/app/integrations/apollo-key');
  if (!data.ok) return;
  const btn = $('apolloHeroBtn');
  if (data.set) {
    btn.textContent = `Key ${data.hint} — change`;
    $('byokApolloRemove').hidden = false;
  } else {
    btn.textContent = 'Connect your Apollo key';
    $('byokApolloRemove').hidden = true;
  }
}

function bindByokApollo() {
  const block = $('byokApolloBlock');
  const status = $('byokApolloStatus');
  const input = $('byokApolloKey');
  $('apolloHeroBtn').addEventListener('click', () => { block.hidden = !block.hidden; if (!block.hidden) input.focus(); });
  $('byokApolloSave').addEventListener('click', async () => {
    status.textContent = 'Validating with Apollo…';
    const { data } = await api('POST', '/api/app/integrations/apollo-key', { key: input.value.trim() });
    if (!data.ok) { status.textContent = data.error || 'Could not save'; return; }
    status.textContent = `Apollo key saved (${data.hint}) — searches now run through your account.`;
    input.value = '';
    loadSettingsHero();
  });
  $('byokApolloRemove').addEventListener('click', async () => {
    if (!confirm('Remove your Apollo key? Searches fall back to our shared Apollo/built-in pipeline.')) return;
    await api('DELETE', '/api/app/integrations/apollo-key');
    status.textContent = 'Key removed.';
    loadSettingsHero();
  });
}

function bindSettingsHero() {
  const gotoTab = stab => {
    $(`stab-${stab}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('connectMailboxBtn').addEventListener('click', () => {
    gotoTab('inboxes');
    $('connectGoogle').classList.add('pulse');
    $('connectMicrosoft').classList.add('pulse');
    setTimeout(() => ['connectGoogle', 'connectMicrosoft'].forEach(id => $(id).classList.remove('pulse')), 1600);
  });

  const bindNotif = (id, key, label) => $(id).addEventListener('change', async e => {
    const on = e.target.checked;
    const { data } = await api('POST', '/api/app/settings', { notifications: { [key]: on } });
    if (!data.ok) { e.target.checked = !on; return toast('Could not save notification setting', 'err'); }
    if (me?.notifications) me.notifications[key] = on;
    toast(`${label} ${on ? 'on' : 'off'}`);
  });
  bindNotif('notifHotLead', 'hotLead', 'Hot lead alert');
  bindNotif('notifDailyDigest', 'dailyDigest', 'Daily digest');
  bindNotif('notifBounce', 'bounceWarnings', 'Bounce warnings');
}

// ---------- Compliance & account data rights ----------
function bindAccount() {
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
// ---------- LinkedIn autopilot bridge ----------
// ---------- BYOK: Apollo lead data source ----------
// ---------- suppression list ----------
// ---------- developer: API key + webhooks + MCP/CLI ----------
async function bindDeveloper() {
  $('genApiKeyBtn').addEventListener('click', async () => {
    if (!confirm('Generate a new API key? Any existing key stops working immediately.')) return;
    const { data } = await api('POST', '/api/app/integrations/token');
    if (!data.ok) { $('apiKeyStatus').textContent = data.error || 'Error'; return; }
    $('apiKeyValue').textContent = data.token;
    $('apiKeyNew').hidden = false;
    $('apiKeyStatus').textContent = 'New key generated — copy it now, it won\'t be shown again.';
    $('revokeApiKeyBtn').hidden = false;
  });
  $('copyApiKeyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('apiKeyValue').textContent).then(() => {
      $('copyApiKeyBtn').textContent = 'Copied ✓';
      setTimeout(() => { $('copyApiKeyBtn').textContent = 'Copy'; }, 2000);
    });
  });
  $('revokeApiKeyBtn').addEventListener('click', async () => {
    if (!confirm('Revoke the API key? MCP, CLI and any integrations using it stop working.')) return;
    await api('DELETE', '/api/app/integrations/token');
    $('apiKeyNew').hidden = true;
    $('apiKeyStatus').textContent = 'No key — generate one to use the API, MCP or CLI.';
    $('revokeApiKeyBtn').hidden = true;
  });

  // Slack app install / disconnect
  const meData = await api('GET', '/api/me').then(r => r.data).catch(() => null);
  if (meData?.slackConnected) {
    $('slackStatus').textContent = 'Connected' + (meData.slackTeam ? ' · ' + meData.slackTeam : '');
    $('slackStatus').classList.add('ok');
    $('slackInstallBtn').hidden = true;
    $('slackRemoveBtn').hidden = false;
    $('slackDesc').textContent = 'Hot leads, daily digest and deliverability alerts post to your Slack workspace.';
  }
  $('slackRemoveBtn').addEventListener('click', async () => {
    if (!confirm('Disconnect Slack? Hot-lead alerts will stop posting to your channel.')) return;
    await api('DELETE', '/api/app/integrations/slack');
    location.reload();
  });
  $('webhookForm').addEventListener('submit', async e => {
    e.preventDefault();
    const events = [...document.querySelectorAll('#whEvents input:checked')].map(c => c.value);
    const { data } = await api('POST', '/api/app/integrations/webhooks', {
      url: $('whUrl').value.trim(),
      provider: $('whProvider').value,
      secret: $('whSecret').value.trim() || undefined,
      events: events.length ? events : undefined,
    });
    $('webhookResult').innerHTML = data.ok
      ? '<span class="ok-tag">✓ Webhook added</span>'
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
    if (data.ok) { $('whUrl').value = ''; $('whSecret').value = ''; loadWebhooks(); }
  });
  $('webhookList').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-wh-del]');
    if (!btn) return;
    if (!confirm('Delete this webhook?')) return;
    await api('DELETE', `/api/app/integrations/webhooks/${btn.dataset.whDel}`);
    loadWebhooks();
  });
}

async function loadDeveloper() {
  // API key status
  const { data: tok } = await api('GET', '/api/app/integrations/status');
  if (tok.ok) {
    $('apiKeyStatus').textContent = tok.hasToken
      ? 'A key is active. Generate a new one to rotate it.'
      : 'No key — generate one to use the API, MCP or CLI.';
    $('revokeApiKeyBtn').hidden = !tok.hasToken;
    $('apiKeyNew').hidden = true;
  }
  // MCP URL
  $('mcpUrl').textContent = `${location.origin}/api/mcp`;
  loadWebhooks();
}

async function loadWebhooks() {
  const { data } = await api('GET', '/api/app/integrations/webhooks');
  if (!data.ok) { $('webhookList').innerHTML = ''; return; }
  // Populate event checkboxes once
  const evBox = $('whEvents');
  if (evBox && !evBox.children.length && data.events) {
    evBox.innerHTML = data.events.map(ev =>
      `<label><input type="checkbox" value="${ev}" checked /> ${ev}</label>`
    ).join('');
  }
  $('webhookList').innerHTML = data.webhooks.length ? data.webhooks.map(h => `
    <div class="wh-item">
      <div>
        <span class="wh-provider">${esc(h.provider)}</span>
        <span class="wh-url">${esc(h.url)}</span>
        <div class="settings-note" style="margin-top:2px;">${(h.events || []).join(' · ')}</div>
      </div>
      <div class="wh-meta">
        <button type="button" data-wh-del="${h.id}">Delete</button>
      </div>
    </div>`).join('') : '<p class="settings-note">No webhooks yet — add one below to push events to your stack.</p>';
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
async function loadCredits() {
  const { data } = await api('GET', '/api/app/lead-finder/status');
  if (!data.ok) return;
  const remaining = Math.max(0, (data.quota || 0) - (data.used || 0));
  const count = $('creditCount');
  count.textContent = `${remaining.toLocaleString()} Credits`;
  const badge = $('creditBadge');
  badge.classList.toggle('low', remaining < 100 && remaining > 0);
  badge.classList.toggle('crit', remaining === 0);
}

function bindTopup() {
  const open = async () => {
    const { data } = await api('GET', '/api/plans');
    const packs = (data.ok && data.topups) ? data.topups.filter(t => !t.service) : [];
    $('topupGrid').innerHTML = packs.length ? packs.map(t => `
      <button type="button" class="topup-pack" data-pack="${t.id}">
        <strong>${(t.credits || 0).toLocaleString()}</strong>
        <span>credits</span>
        <span class="pack-price">$${t.price}</span>
      </button>`).join('') : '<span class="settings-note">Credit packs unavailable.</span>';
    $('topupResult').innerHTML = '';
    $('topupModal').hidden = false;
  };
  $('creditBadge').addEventListener('click', open);
  $('topupCloseBtn').addEventListener('click', () => { $('topupModal').hidden = true; });
  $('topupModal').addEventListener('click', e => { if (e.target === $('topupModal')) $('topupModal').hidden = true; });
  $('topupGrid').addEventListener('click', async e => {
    const packBtn = e.target.closest('.topup-pack');
    if (!packBtn) return;
    $('topupResult').innerHTML = 'Opening checkout…';
    const { data } = await api('POST', '/api/billing/checkout', { plan: packBtn.dataset.pack });
    if (data.ok && data.checkoutUrl) {
      const a = document.createElement('a');
      a.href = data.checkoutUrl; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      $('topupModal').hidden = true;
      return;
    }
    $('topupResult').innerHTML = data.manual
      ? '<span class="no-tag">Payments not configured yet</span> — your admin needs to connect Stripe before packs can be bought.'
      : `<span class="no-tag">✗ ${esc(data.error || 'Error')}</span>`;
  });
}

// ---------- lead finder ----------
let leadFinderLeads = [];

// Quick presets for "Target job title" — chip click fills the canonical
// group value; scan/prefill results snap to a group via TITLE_CANON so a
// site scan returning "Chief Executive Officer" still lands on CEO presets.
const TITLE_PRESETS = [
  { label: 'Founders & C-Level', value: 'founder, CEO, co-founder, owner', terms: ['founder', 'co-founder', 'cofounder', 'owner', 'ceo', 'chief executive', 'managing director', 'president'] },
  { label: 'Sales Leadership', value: 'VP of Sales, Head of Sales, CRO', terms: ['vp of sales', 'vice president of sales', 'head of sales', 'sales director', 'cro', 'chief revenue officer', 'head of revenue'] },
  { label: 'Marketing Leadership', value: 'CMO, Head of Marketing, Marketing Director', terms: ['cmo', 'chief marketing officer', 'head of marketing', 'marketing director', 'marketing lead', 'vp of marketing'] },
  { label: 'Tech & Product', value: 'CTO, VP of Engineering, Head of Product', terms: ['cto', 'chief technology officer', 'vp of engineering', 'head of engineering', 'engineering director', 'cpo', 'chief product officer', 'head of product', 'vp of product'] },
];
function canonTitle(raw) {
  const t = (raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return '';
  for (const p of TITLE_PRESETS) if (p.terms.some(term => t === term || t.includes(term))) return p.value;
  return raw.trim();
}
function fillTitleEl(val) { const el = $('lfTitle'); if (el && !el.value && val) { el.value = canonTitle(val); return true; } return false; }

// Tag inputs — chips backed by a hidden comma-joined input (the value the
// search code already reads). Enter/comma/paste adds; × removes.
// Country picker — every country built in, searchable. Region shortcuts sit
// on top for broad targeting ("Europe" was already a supported preset).
const REGION_PRESETS = ['Europe', 'North America', 'Latin America', 'Asia-Pacific', 'Middle East', 'Africa'];
const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina',
  'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus',
  'Czech Republic', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
  'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece',
  'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India',
  'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait',
  'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Mauritania', 'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria',
  'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
  'Portugal', 'Puerto Rico', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Singapore',
  'Slovakia', 'Slovenia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland', 'Taiwan', 'Tanzania',
  'Thailand', 'Togo', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Uruguay', 'Uzbekistan', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];
// Tag inputs that get a searchable picker popover instead of a bare datalist.
const TAG_PICKERS = { lfLocTags: [...REGION_PRESETS, ...COUNTRIES] };

function tagValues(wrap) {
  const hidden = $(wrap.dataset.target);
  return (hidden?.value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function setTagValues(wrap, values) {
  $(wrap.dataset.target).value = values.join(', ');
  renderTags(wrap);
}

function renderTags(wrap) {
  const values = tagValues(wrap);
  const inputId = wrap.dataset.input;
  const placeholder = values.length ? '+ add' : (wrap.dataset.placeholder || '+ add');
  const pop = wrap.querySelector('.cpop'); // picker popover survives re-renders
  wrap.innerHTML = values.map(v =>
    `<span class="lf-tag">${esc(v)}<button type="button" class="lf-tag-x" data-remove="${esc(v)}" aria-label="Remove ${esc(v)}">✕</button></span>`
  ).join('') + `<input id="${inputId}" class="lf-tag-input" list="${wrap.dataset.list || ''}" placeholder="${esc(placeholder)}" autocomplete="off" />`;
  if (pop) wrap.appendChild(pop);
  const input = wrap.querySelector('.lf-tag-input');
  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      addTag(wrap, (wrap._pickerPick && wrap._pickerPick()) || input.value);
    } else if (e.key === 'Backspace' && !input.value && values.length) {
      setTagValues(wrap, values.slice(0, -1));
    }
  });
  input.addEventListener('change', () => { if (input.value.trim()) addTag(wrap, input.value); });
  input.addEventListener('blur', () => { if (input.value.trim()) addTag(wrap, input.value); });
  const pickerItems = TAG_PICKERS[wrap.id];
  if (pickerItems) attachTagPicker(wrap, input, pickerItems);
}

// Searchable popover for tag inputs (used by the Countries field): focus
// shows the full list, typing filters, click/Enter picks, arrows navigate.
// Free text still works — Enter with no match adds whatever was typed.
function attachTagPicker(wrap, input, items) {
  let pop = wrap.querySelector('.cpop');
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'cpop';
    pop.hidden = true;
    wrap.appendChild(pop);
  }
  let hl = 0;
  const view = () => {
    const q = input.value.trim().toLowerCase();
    const taken = new Set(tagValues(wrap).map(v => v.toLowerCase()));
    const match = c => !taken.has(c.toLowerCase()) && (!q || c.toLowerCase().includes(q));
    const regions = items.filter(c => REGION_PRESETS.includes(c) && match(c));
    const countries = items.filter(c => !REGION_PRESETS.includes(c) && match(c));
    return { regions, countries, list: [...regions, ...countries] };
  };
  const renderPop = () => {
    const { regions, list } = view();
    const q = input.value.trim();
    hl = Math.min(hl, Math.max(list.length - 1, 0));
    if (!list.length) {
      pop.innerHTML = `<div class="cpop-empty">No match — press Enter to add “${esc(q)}”</div>`;
      return;
    }
    let html = '';
    list.forEach((c, i) => {
      if (!q && i === 0 && regions.length) html += '<div class="cpop-group">Regions</div>';
      if (!q && i === regions.length) html += '<div class="cpop-group">All countries</div>';
      html += `<button type="button" class="cpop-item${i === hl ? ' hl' : ''}" data-val="${esc(c)}">${esc(c)}</button>`;
    });
    pop.innerHTML = html;
  };
  const open = () => { renderPop(); pop.hidden = false; };
  const close = () => { pop.hidden = true; };
  wrap._pickerPick = () => (pop.hidden ? null : view().list[hl] || null);
  input.addEventListener('focus', open);
  input.addEventListener('input', () => { hl = 0; open(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (pop.hidden) { open(); return; }
      const list = view().list;
      if (!list.length) return;
      hl = e.key === 'ArrowDown' ? Math.min(hl + 1, list.length - 1) : Math.max(hl - 1, 0);
      renderPop();
      pop.querySelector('.hl')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') close();
  });
  pop.onmousedown = e => {
    const item = e.target.closest('.cpop-item');
    if (!item) return;
    e.preventDefault(); // keep focus; blur must not swallow the pick
    addTag(wrap, item.dataset.val);
    wrap.querySelector('.lf-tag-input')?.focus();
  };
  if (wrap._pickerDoc) document.removeEventListener('mousedown', wrap._pickerDoc);
  wrap._pickerDoc = e => { if (!wrap.contains(e.target)) close(); };
  document.addEventListener('mousedown', wrap._pickerDoc);
}

function addTag(wrap, raw) {
  const v = raw.trim().replace(/,+$/, '');
  if (!v) return;
  const values = tagValues(wrap);
  if (values.some(x => x.toLowerCase() === v.toLowerCase())) { renderTags(wrap); return; }
  setTagValues(wrap, [...values, v]);
}

function bindTagInput(wrapId, { listId, suggestions, placeholder }) {
  const wrap = $(wrapId);
  if (!wrap) return;
  wrap.dataset.placeholder = placeholder || '+ add';
  if (listId && suggestions?.length) {
    wrap.dataset.list = listId;
    const dl = $(listId);
    if (dl) dl.innerHTML = suggestions.map(s => `<option value="${esc(s)}">`).join('');
  }
  renderTags(wrap);
  wrap.addEventListener('click', e => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      setTagValues(wrap, tagValues(wrap).filter(v => v !== rm.dataset.remove));
      return;
    }
    wrap.querySelector('.lf-tag-input')?.focus();
  });
}

bindTagInput('lfTitleTags', {
  listId: 'lfTitleSugs',
  suggestions: TITLE_PRESETS.flatMap(p => p.value.split(', ')),
  placeholder: '+ add',
});
bindTagInput('lfLocTags', {
  placeholder: '+ add country',
});

// "Detected:" summary tag — shows the auto-filled offer profile as one glanceable
// line; the raw service/value fields stay tucked behind the Edit toggle.
function syncDetected() {
  const box = $('lfDetected');
  if (!box) return;
  const service = $('lfService').value.trim();
  const value = $('lfValue').value.trim();
  if (!service && !value) { box.hidden = true; return; }
  let text = `Detected: ${service}${value ? ` — ${value}` : ''}`;
  if (text.length > 140) text = `${text.slice(0, 137).trimEnd()}…`;
  $('lfDetectedTag').textContent = text;
  box.hidden = false;
}

// Programmatic fills (scan/prefill/seed) write to the hidden inputs behind
// the tags' backs — re-render so the chips always mirror the real value.
function syncChips() {
  if ($('lfTitleTags')) renderTags($('lfTitleTags'));
  if ($('lfLocTags')) renderTags($('lfLocTags'));
}
$('lfDetectedEdit')?.addEventListener('click', () => {
  const row = $('lfOfferFields');
  row.hidden = !row.hidden;
  $('lfDetectedEdit').textContent = row.hidden ? 'Edit' : 'Hide';
});

// Pay-as-you-go credit bundles — checkout rides the same billing endpoint
// as plan upgrades; packs arrive from GET /api/plans (topups).
$('lfTopupBtn')?.addEventListener('click', () => { $('creditBadge').click(); });

async function loadLeadFinderStatus() {
  const { data } = await api('GET', '/api/app/lead-finder/status');
  if (!data.ok) return;
  const src = data.provider === 'apollo'
    ? (data.apolloKeySet ? 'via your Apollo key' : 'via Apollo')
    : 'built-in verify';
  $('leadFinderStatus').textContent = `${data.used}/${data.quota} credits used this month · ${src}`;
  $('lfTopupBtn').hidden = false;
  syncDetected();
  syncChips();

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
// (unlike the auto prefill, which only fills empty ones). Blank scan
// results must clear the field too, or the previous site's values linger
// (scan sgidigi → "Taiwan", then scan vercel.com → location stayed
// "Taiwan" because the new scan legitimately returned "").
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
    setBtnLoading(btn, true, 'Scanning…');
    status.className = 'ai-status loading';
    status.textContent = 'Reading your site…';
    try {
      const { data } = await api('POST', '/api/app/lead-finder/scan-fill', { url });
      if (!data.ok || !data.prefill) throw new Error(data.error || 'Scan failed');
      const p = data.prefill;
      $('lfService').value = p.service || '';
      $('lfValue').value = p.valueProp || '';
      $('lfKeywords').value = p.keywords || '';
      $('lfTitle').value = p.title ? canonTitle(p.title) : '';
      $('lfSize').value = p.size || '';
      $('lfLocation').value = p.location || '';
      servicePitch = p.service || data.siteTitle || url;
      syncDetected();
      syncChips();
      status.className = 'ai-status ok';
      const gaps = !p.keywords ? ' Could not infer the target industry — type it in step 2.' : '';
      status.textContent = `Filled from ${url} — review, then hit Find Leads.` + gaps;
    } catch (err) {
      status.className = 'ai-status err';
      status.textContent = `✕ ${err.message || 'Could not scan that site — fill manually.'}`;
    } finally {
      setBtnLoading(btn, false);
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
    if (fillTitleEl(p.title)) filled++;
    fill('lfSize', p.size);
    fill('lfLocation', p.location);
    servicePitch = p.service || d.siteTitle || $('lfScanUrl').value || servicePitch;
    syncDetected();
    syncChips();
    if (filled > 0 && $('lfPrefillNote')) {
      $('lfPrefillNote').textContent = `Pre-filled from your website — tweak anything before searching.`;
      // It's a note, not a result — clear it once the user searches so it
      // doesn't linger next to the search outcome.
      $('leadFindBtn').addEventListener('click', () => { $('lfPrefillNote').textContent = ''; }, { once: true });
    }
  } catch {}
}

// Industry select + free-text ICP feed Apollo's single keywords field.
function leadSearchKeywords() {
  return [$('lfIndustry')?.value.trim(), $('lfKeywords').value.trim()].filter(Boolean).join(', ');
}

function intelCardHtml(d) {
  const list = (items, empty) => items && items.length
    ? `<ul>${items.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : `<p class="intel-empty">${empty}</p>`;
  return `
    <div class="intel-card">
      <div class="intel-head">
        <strong>${esc(d.domain)}</strong>
        <a href="https://${esc(d.domain)}" target="_blank" rel="noopener">visit site ↗</a>
        <span class="intel-src">${d.source === 'llm' ? 'AI research' : 'site scan'}</span>
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
        <h4>Your angle</h4>
        <p>${esc(d.angle)}</p>
      </div>
    </div>`;
}

let leadIntelCache = {};

async function openLeadIntel(btn) {
  const i = Number(btn.dataset.intel);
  const lead = leadFinderLeads[i];
  const drawer = $('intelDrawer');
  const body = $('intelDrawerBody');
  $('intelDrawerTitle').textContent = lead.company || lead.email;
  body.innerHTML = '<div class="intel-card"><p class="intel-empty">Researching…</p></div>';
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add('open'));
  let res = leadIntelCache[i];
  if (!res) {
    res = await api('POST', '/api/app/lead-finder/intel', {
      company: lead.company, email: lead.email, pitch: servicePitch, title: lead.title,
    });
    if (res.status === 200 && res.data.ok) leadIntelCache[i] = res;
  }
  body.innerHTML = res.status === 200 && res.data.ok
    ? intelCardHtml(res.data)
    : `<div class="intel-card"><p class="intel-empty">${esc(res.data.error || 'Research failed.')}</p></div>`;
}

function closeLeadIntel() {
  const drawer = $('intelDrawer');
  drawer.classList.remove('open');
  setTimeout(() => { if (!drawer.classList.contains('open')) drawer.hidden = true; }, 280);
}

const LEAD_AVATAR_COLORS = ['#7c3aed', '#db2777', '#0891b2', '#059669', '#d97706', '#4f46e5', '#dc2626', '#0d9488'];
function leadAvatar(name, email) {
  const src = (name || email || '?').trim();
  const initials = name
    ? name.split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('')
    : src.slice(0, 2).toUpperCase();
  let h = 0;
  for (const ch of src) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="lf-avatar" style="background:${LEAD_AVATAR_COLORS[h % LEAD_AVATAR_COLORS.length]}">${esc(initials)}</span>`;
}

function renderLeadResults(leads, keywords = '') {
  leadFinderLeads = leads;
  leadIntelCache = {};
  const box = $('leadResults');
  if (!leads.length) { box.hidden = true; return; }
  box.hidden = false;
  $('leadResultsMeta').textContent = `${leads.length} lead${leads.length === 1 ? '' : 's'} found${keywords ? ` · ${keywords}` : ''} · select leads to push into a campaign`;
  const tbody = $('leadTable').querySelector('tbody');
  tbody.innerHTML = leads.map((l, i) => {
    const name = [l.firstName, l.lastName].filter(Boolean).join(' ');
    return `
    <tr>
      <td class="lf-check-col"><input type="checkbox" data-lead="${i}" checked /></td>
      <td>
        <div class="lf-person">
          ${leadAvatar(name, l.email)}
          <div class="lf-person-info">
            <strong>${esc(name) || '—'}</strong>
            <span>${esc(l.email)}${l.verified === 'valid' ? ' <i class="lf-verified">✓ deliverable</i>' : ''}</span>
          </div>
        </div>
      </td>
      <td>${esc(l.title) || '—'}</td>
      <td><strong>${esc(l.company) || '—'}</strong></td>
      <td>${esc(l.size) || '—'}</td>
      <td>${esc(l.country) || '—'}</td>
      <td><button class="btn btn-intel" data-intel="${i}"><svg class="tab-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.8 6.2 6.2 1.8-6.2 1.8-1.8 6.2-1.8-6.2-6.2-1.8z"/></svg>Intel</button></td>
    </tr>`;
  }).join('');
  $('leadSelectAll').checked = true;
  tbody.onclick = e => {
    const btn = e.target.closest('[data-intel]');
    if (btn) openLeadIntel(btn);
  };
}

function bindLeadFinder() {
  $('closeIntelDrawer').addEventListener('click', closeLeadIntel);
  $('intelDrawerBackdrop').addEventListener('click', closeLeadIntel);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('intelDrawer').hidden) closeLeadIntel();
  });
  $('leadFindBtn').addEventListener('click', async () => {
    const btn = $('leadFindBtn');
    const note = $('leadFindNote');
    setBtnLoading(btn, true, 'Searching…');
    note.classList.add('busy');
    note.textContent = 'Searching and checking emails…';
    $('leadResults').hidden = true;
    const keywords = leadSearchKeywords();
    const body = {
      keywords,
      title: canonTitle($('lfTitle').value),
      size: $('lfSize').value,
      location: $('lfLocation').value.trim(),
      limit: Number($('lfCount').value || 10),
    };
    if ($('lfService').value.trim()) servicePitch = $('lfService').value.trim();
    let status, data;
    try {
      ({ status, data } = await api('POST', '/api/app/lead-finder/search', body));
    } catch {
      note.textContent = 'Search failed — check your connection and try again.';
      return;
    } finally {
      setBtnLoading(btn, false);
      note.classList.remove('busy');
    }
    if (status !== 200 || !data.ok) {
      note.textContent = data.error || 'Search failed.';
      return;
    }
    note.textContent = '';
    if (data.leads.length) {
      note.textContent = `Found ${data.leads.length} — every address is checked before it lands here. (${data.used}/${data.quota} credits)`;
    } else if (data.errors?.length) {
      note.textContent = `Search hit a provider error: ${data.errors.join('; ')} `;
      // Apollo Free-plan keys have no API access — give a direct way to fix it.
      if (data.errors.some(e => /plan doesn't include API access/i.test(e))) {
        const a = document.createElement('a');
        a.href = 'https://www.apollo.io/pricing'; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = 'Upgrade Apollo →';
        note.appendChild(a);
      }
    } else {
      const warnings = (data.warnings || []).filter(Boolean);
      const meaningfulWarning = warnings.find(w => !/apollo.*api access/i.test(w));
      // Industry-standard empty state: tell the user what was tried and what to broaden.
      const chain = ($('leadFinderStatus').textContent || '').includes('via your Apollo key')
        ? 'your Apollo key → free Apollo → public web'
        : 'Apollo → free Apollo → public web';
      note.textContent = meaningfulWarning
        ? `No verified leads after checking ${chain}. ${meaningfulWarning}`
        : `No verified leads after checking ${chain}. Try a broader title, use concrete domains (e.g. acme.com) as keywords, or loosen your filters.`;
    }
    renderLeadResults(data.leads, keywords);
    loadLeadFinderStatus();
  });

  // "Add selected to Campaign" — the button opens a campaign picker popover;
  // choosing one enrolls straight away (select stays as the value holder).
  // Feedback always goes to #leadEnrollHint (right next to the button) so the
  // user never wonders whether the click registered.
  const enrollHint = msg => { const h = $('leadEnrollHint'); if (h) { h.textContent = msg; } };
  $('leadEnrollBtn').addEventListener('click', () => {
    const selected = [...document.querySelectorAll('#leadTable input[data-lead]:checked')]
      .map(cb => leadFinderLeads[Number(cb.dataset.lead)]).filter(Boolean);
    if (!selected.length) { enrollHint('Select at least one lead below first.'); return; }
    const picker = $('leadCampaignPicker');
    if (!campaigns.length) {
      enrollHint('No campaigns yet — create one first, then push leads into it.');
      $('leadFindNote').textContent = 'Create a campaign first, then push leads into it.';
      return;
    }
    if (!picker.hidden) { picker.hidden = true; enrollHint(''); return; }
    picker.innerHTML = '<p>Push into…</p>' + campaigns.map(c =>
      `<button type="button" data-pick="${c.id}">${esc(c.name)}<span>${esc(c.status)}</span></button>`).join('');
    picker.hidden = false;
    enrollHint('Choose a campaign below ↓');
    picker.onclick = e => {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      picker.hidden = true;
      enrollHint('');
      enrollSelectedLeads(btn.dataset.pick);
    };
  });
  document.addEventListener('click', e => {
    const picker = $('leadCampaignPicker');
    if (picker && !picker.hidden && !e.target.closest('.lf-enroll')) picker.hidden = true;
  });

  async function enrollSelectedLeads(campaignId) {
    const selected = [...document.querySelectorAll('#leadTable input[data-lead]:checked')]
      .map(cb => leadFinderLeads[Number(cb.dataset.lead)]).filter(Boolean);
    if (!campaignId) { enrollHint('Choose a campaign first.'); return; }
    if (!selected.length) { enrollHint('Select at least one lead.'); return; }
    enrollHint('Adding…');
    try {
      const { status, data } = await api('POST', '/api/app/lead-finder/enroll', { campaignId, leads: selected });
      let msg;
      if (status === 200 && data.ok) {
        msg = data.added > 0
          ? `✓ Added ${data.added} to “${data.campaignName}”.`
          : `Already in “${data.campaignName}” — no duplicates added.`;
        if (data.skippedSuppressed) msg += ` · ${data.skippedSuppressed} suppressed skipped`;
      } else {
        msg = data.error || 'Enroll failed.';
      }
      $('leadFindNote').textContent = msg;
      enrollHint(status === 200 && data.ok ? '' : msg);
      if (status === 200 && data.ok) {
        toast(data.added > 0 ? `Added ${data.added} lead${data.added === 1 ? '' : 's'} to “${data.campaignName}”` : msg);
        $('leadResults').hidden = true;
        leadFinderLeads = [];
        loadCampaigns();
        loadProspects();
      }
    } catch (err) {
      enrollHint('Enroll failed — check your connection and try again.');
    }
  }

  $('leadSelectAll').addEventListener('change', e => {
    document.querySelectorAll('#leadTable input[data-lead]').forEach(cb => { cb.checked = e.target.checked; });
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
