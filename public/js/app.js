// =====================================================================
// Vuoro frontend — kalenteri + varaus + sijais-chat, kytketty API:in.
// =====================================================================
import { api } from './api.js';
import {
  DEV_MODE, setDevUserId, newDevUid,
  onAuthChange, authReady, registerEmail, loginEmail, logout as fbLogout, authErrorMsg,
} from './auth.js';
import { DEFAULT_ORG } from './config.js';

// Demo-tenantit dev-vaihtajaan. Tuotannossa tenant on kiinteä (white-label-domain).
const DEMO_TENANTS = [
  { slug: 'trainwithmarjo', name: 'TrainWithMarjo' },
  { slug: 'studio-flow', name: 'Studio Flow' },
];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const FI_DOW = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
const FI_DOW_LONG = ['Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai', 'Sunnuntai'];
const FI_MON = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
  'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];
const dowIdx = (d) => (d.getDay() + 6) % 7;
const hhmm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const $ = (id) => document.getElementById(id);

const state = {
  orgSlug: localStorage.getItem('vuoro_org') || DEFAULT_ORG,
  org: null,
  allOrgs: null, // kaikki yritykset valitsimeen (haetaan /public/orgs)
  identity: 'public', // 'public' | 'coach' | 'customer'
  me: null, // { user, organization }
  view: 'week',
  anchor: startOfDay(new Date()),
  calSessions: [],
  cardSessions: [],
  openId: null,
  openSession: null,
  addingReg: false,
  invite: null, // { token, email, role, organization }
  mgOrgId: null, // superadminin porautuma yritys
  pending: [], // odottavat hyväksynnät (coach/owner)
  popupPending: false, // näytä hyväksyntä-popup kirjautuessa
  spotRequests: [], // avoimet asiakkaiden sijaispyynnöt
  openSpotId: null,
};

const loggedIn = () => state.identity !== 'public' && !!state.me;
const isCoachRole = (r) => r === 'coach' || r === 'owner';
const isCoach = () => loggedIn() && isCoachRole(state.me.user.role);

// Tuotannossa identiteetti johdetaan kirjautuneen käyttäjän roolista (/me).
async function applyLoggedInIdentity() {
  await loadMe();
  if (!state.me) { state.identity = 'public'; return; }
  state.identity = isCoachRole(state.me.user.role) ? 'coach' : 'customer';
  if (isCoachRole(state.me.user.role)) state.popupPending = true;
}
const myUid = () => state.me?.user?.uid;
const myName = () => state.me?.user?.name || 'Sinä';

function norm(s) {
  s._seeking = s.seekingSubstitute ?? (s.substitute && s.substitute.open) ?? false;
  return s;
}

/* ===================== DATA ===================== */
function calRange() {
  const a = state.anchor;
  if (state.view === 'month') {
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - dowIdx(first));
    return { from: start, to: addDays(start, 42) };
  }
  if (state.view === 'week') {
    const mon = new Date(a); mon.setDate(a.getDate() - dowIdx(a));
    return { from: mon, to: addDays(mon, 7) };
  }
  return { from: new Date(a), to: addDays(a, 1) };
}

async function loadData() {
  const { from, to } = calRange();
  const today = startOfDay(new Date());
  const cardsTo = addDays(today, 60);
  const fetcher = loggedIn()
    ? (f, t) => api.sessions(f, t)
    : (f, t) => api.publicSessions(state.orgSlug, f, t);
  try {
    const [cal, cards] = await Promise.all([
      fetcher(from.toISOString(), to.toISOString()),
      fetcher(today.toISOString(), cardsTo.toISOString()),
    ]);
    state.calSessions = cal.map(norm);
    state.cardSessions = cards.map(norm);
  } catch (e) {
    toast(e.message, true);
    state.calSessions = []; state.cardSessions = [];
  }
  renderCalendar();
  renderCards();
}

async function loadOrg() {
  try { state.org = await api.org(state.orgSlug); }
  catch { state.org = { name: state.orgSlug, brandColor: '#3b5bdb' }; }
  applyBrand();
}

async function loadMe() {
  try { state.me = await api.me(); }
  catch (e) { state.me = null; toast('Kirjautuminen epäonnistui: ' + e.message, true); }
}

async function refresh() {
  renderTopbar();
  await loadData();
  if (isCoach()) {
    try { state.pending = await api.pending(); } catch { state.pending = []; }
    renderTopbar();
    if (state.popupPending && state.pending.length) { state.popupPending = false; openApprovals(); }
    else state.popupPending = false;
  } else {
    state.pending = [];
  }
  if (loggedIn()) {
    try { state.spotRequests = await api.spotRequests(); } catch { state.spotRequests = []; }
  } else {
    state.spotRequests = [];
  }
  renderSpot();
}

/* ===================== IDENTITY (dev) ===================== */
async function setIdentity(kind) {
  if (kind === 'public') {
    state.identity = 'public'; setDevUserId(null); state.me = null;
    await refresh(); return;
  }
  if (kind === 'coach') {
    // Dev: owner-<slug> on seedattu. Tuotannossa: oikea valmentajatili.
    state.identity = 'coach'; setDevUserId('owner-' + state.orgSlug);
    await loadMe();
    if (!state.me) { state.identity = 'public'; setDevUserId(null); }
    else state.popupPending = true;
    await refresh(); return;
  }
  if (kind === 'customer') {
    const stored = localStorage.getItem('vuoro_cust_' + state.orgSlug);
    if (stored) {
      state.identity = 'customer'; setDevUserId(stored);
      await loadMe();
      if (!state.me) { localStorage.removeItem('vuoro_cust_' + state.orgSlug); openRegister(); return; }
      await refresh();
    } else {
      openRegister();
    }
  }
}

/* ===================== BRAND / TOPBAR ===================== */
// Väriapurit: johda tumma (hover) ja vaalea (täplä) sävy brändiväristä.
function hexToRgb(h) {
  h = String(h || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return h.length === 6 && !isNaN(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } : null;
}
const mixc = (c, t, a) => Math.round(c + (t - c) * a);
const rgbStr = (r, g, b) => `rgb(${r}, ${g}, ${b})`;

function applyBrand() {
  const t = state.org || {};
  const brand = t.brandColor || '#3b5bdb';
  const rgb = hexToRgb(brand) || { r: 59, g: 91, b: 219 };
  const root = document.documentElement.style;
  root.setProperty('--brand', brand);
  root.setProperty('--brand-d', rgbStr(mixc(rgb.r, 0, 0.22), mixc(rgb.g, 0, 0.22), mixc(rgb.b, 0, 0.22)));
  root.setProperty('--brand-soft', rgbStr(mixc(rgb.r, 255, 0.88), mixc(rgb.g, 255, 0.88), mixc(rgb.b, 255, 0.88)));
  const dot = $('brandDot');
  if (t.logoUrl) {
    dot.innerHTML = `<img src="${t.logoUrl}" alt="${esc(t.name || '')}" style="width:100%;height:100%;object-fit:contain;border-radius:inherit">`;
    dot.style.background = '#000';
  } else {
    dot.textContent = (t.name || 'V').slice(0, 1).toUpperCase();
    dot.style.background = '';
  }
  $('brandTenant').textContent = t.name || '—';
}

function renderTopbar() {
  // tenant-vaihtaja
  const tenants = state.allOrgs?.length ? state.allOrgs : DEMO_TENANTS;
  $('tenantSel').innerHTML = tenants.map(
    (t) => `<option value="${t.slug}" ${t.slug === state.orgSlug ? 'selected' : ''}>${esc(t.name)}</option>`,
  ).join('');
  // Näytä valitsin vain jos firmoja on enemmän kuin yksi (tai dev-tilassa).
  const tc = $('tenantCtrl');
  if (tc) tc.style.display = (DEV_MODE || tenants.length > 1) ? '' : 'none';
  // identiteettipainikkeet — vain DEV-tilassa (tuotannossa rooli tulee kirjautumisesta)
  $('roleSel').style.display = DEV_MODE ? '' : 'none';
  document.querySelectorAll('#roleSel button').forEach((b) =>
    b.classList.toggle('on', b.dataset.id === state.identity));
  $('devTag').style.display = DEV_MODE ? '' : 'none';
  // tili
  $('addBtn').style.display = isCoach() ? '' : 'none';
  const r = state.me?.user?.role;
  $('mgmtBtn').style.display = loggedIn() && (r === 'owner' || r === 'superadmin') ? '' : 'none';
  $('myBtn').style.display = loggedIn() && r === 'customer' ? '' : 'none';
  const n = state.pending.length;
  const ab = $('apprBtn');
  ab.style.display = isCoach() && n > 0 ? '' : 'none';
  ab.textContent = `✅ Hyväksynnät (${n})`;
  const acct = $('acct');
  if (loggedIn()) {
    const u = state.me.user;
    const icon = u.role === 'superadmin' ? '🛡' : isCoach() ? '👟' : '👤';
    const nm = u.role === 'customer' ? esc(u.name.split(' ')[0]) : esc(u.name);
    const label = `${icon} ${nm}`;
    acct.innerHTML = `<span class="who">${label}</span><button class="linklike" id="logoutBtn">Kirjaudu ulos</button>`;
  } else {
    acct.innerHTML = `<button class="btn small primary" id="loginBtn">Kirjaudu / Luo tunnus</button>`;
  }
}

/* ===================== CALENDAR ===================== */
function renderCalTitle() {
  const a = state.anchor; const el = $('calTitle');
  if (state.view === 'month') el.textContent = `${FI_MON[a.getMonth()]} ${a.getFullYear()}`;
  else if (state.view === 'day') el.textContent = `${FI_DOW_LONG[dowIdx(a)]} ${a.getDate()}. ${FI_MON[a.getMonth()]}`;
  else {
    const mon = new Date(a); mon.setDate(a.getDate() - dowIdx(a));
    const sun = addDays(mon, 6);
    el.textContent = `${mon.getDate()}.${mon.getMonth() + 1}. – ${sun.getDate()}.${sun.getMonth() + 1}.${sun.getFullYear()}`;
  }
}
const eventsOn = (ds) => state.calSessions
  .filter((s) => ymd(new Date(s.startsAt)) === ds)
  .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
const evClass = (s) => (s._seeking ? 'sub' : s.isFull ? 'full' : '');

function renderCalendar() {
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  renderCalTitle();
  if (state.view === 'month') renderMonth();
  else renderTimeGrid(state.view === 'week' ? 7 : 1);
}

function renderMonth() {
  const a = state.anchor;
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - dowIdx(first));
  let html = '<div class="month">';
  FI_DOW.forEach((d) => (html += `<div class="dow">${d}</div>`));
  const today = ymd(new Date());
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i); const ds = ymd(d);
    const dim = d.getMonth() !== a.getMonth();
    const evs = eventsOn(ds);
    html += `<div class="day ${dim ? 'dim' : ''} ${ds === today ? 'today' : ''}" data-date="${ds}"><span class="dnum">${d.getDate()}</span>`;
    evs.slice(0, 3).forEach((s) => (html += `<div class="chip ${evClass(s)}" data-ev="${s.id}">${hhmm(s.startsAt)} ${esc(s.title)}</div>`));
    if (evs.length > 3) html += `<span class="more">+${evs.length - 3} lisää</span>`;
    html += '</div>';
  }
  html += '</div>';
  $('calBody').innerHTML = html;
}

function renderTimeGrid(nDays) {
  const a = state.anchor;
  const mon = new Date(a); if (nDays === 7) mon.setDate(a.getDate() - dowIdx(a));
  const days = Array.from({ length: nDays }, (_, i) => addDays(mon, i));
  const today = ymd(new Date());
  const H0 = 7, H1 = 21; const colTmpl = `60px repeat(${nDays},1fr)`;
  let head = `<div class="tg-head" style="grid-template-columns:${colTmpl}"><div class="cell"></div>`;
  days.forEach((d) => (head += `<div class="cell ${ymd(d) === today ? 'today' : ''}">${FI_DOW[dowIdx(d)]}<div class="dn">${d.getDate()}</div></div>`));
  head += '</div>';
  let body = `<div class="tg-body">`;
  for (let h = H0; h <= H1; h++) {
    body += `<div class="tg-row" style="grid-template-columns:${colTmpl}"><div class="hr">${pad(h)}:00</div>`;
    days.forEach((d) => {
      const ds = ymd(d);
      const evs = eventsOn(ds).filter((s) => new Date(s.startsAt).getHours() === h);
      body += `<div class="tg-col" data-date="${ds}">`;
      evs.forEach((s) => (body += `<div class="ev ${evClass(s) === 'sub' ? 'sub' : ''}" data-ev="${s.id}"><b>${esc(s.title)}</b><span class="t">${hhmm(s.startsAt)}–${hhmm(s.endsAt)} · ${esc(s.instructorName || '')}</span></div>`));
      body += `</div>`;
    });
    body += `</div>`;
  }
  body += `</div>`;
  $('calBody').innerHTML = `<div class="tg">${head}${body}</div>`;
}

function renderCards() {
  const up = state.cardSessions.slice().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  $('cardCount').textContent = up.length;
  const wrap = $('cards');
  if (!up.length) { wrap.innerHTML = `<div class="empty">Ei tulevia treenejä.</div>`; return; }
  wrap.innerHTML = up.map((s) => {
    const d = new Date(s.startsAt);
    return `<div class="ecard ${s._seeking ? 'sub' : ''}" data-ev="${s.id}">
      <h3>${esc(s.title)}</h3>
      <div class="date">📅 ${FI_DOW_LONG[dowIdx(d)]} ${d.getDate()}.${d.getMonth() + 1}. · ${hhmm(s.startsAt)}</div>
      <div class="badges">
        ${s.myStatus === 'booked' ? '<span class="badge b-mine">✓ Varattu</span>'
          : s.myStatus === 'pending' ? '<span class="badge b-sub">🟡 Odottaa</span>'
          : s.myStatus === 'promoted' ? '<span class="badge b-sub">🔔 Vahvista</span>'
          : s.myStatus === 'waitlisted' ? '<span class="badge b-sub">⏳ Jonossa</span>' : ''}
        ${isCoach() && s.pendingCount ? `<span class="badge b-sub">🟡 ${s.pendingCount} odottaa</span>` : ''}
        ${s._seeking ? '<span class="badge b-sub">🔁 Etsii sijaista</span>' : ''}
        ${s.isFull ? `<span class="badge b-full">Täynnä${s.waitlistCount ? ` · jono ${s.waitlistCount}` : ''}</span>` : `<span class="badge b-cap">${s.bookedCount}/${s.capacity} paikkaa</span>`}
      </div></div>`;
  }).join('');
}

/* ===================== DETAIL MODAL ===================== */
async function openSession(id) {
  state.openId = id; state.addingReg = false;
  try {
    if (loggedIn()) state.openSession = norm(await api.session(id));
    else state.openSession = state.calSessions.concat(state.cardSessions).find((x) => x.id === id);
  } catch (e) { toast(e.message, true); return; }
  if (!state.openSession) { toast('Treeniä ei löytynyt', true); return; }
  renderModal();
  $('overlay').classList.add('on');
}

function renderModal() {
  const s = state.openSession;
  const d = new Date(s.startsAt);
  const pct = Math.min(100, Math.round((s.bookedCount / s.capacity) * 100));
  const isSub = s._seeking;

  let actions = '';
  if (isCoach()) {
    actions = isSub
      ? `<button class="btn" data-act="closesub">Peru sijaispyyntö</button>`
      : `<button class="btn primary" data-act="opensub">🔁 Etsi sijainen</button>`;
    actions += ` <button class="btn" data-act="addcal">📅 Omaan kalenteriin</button>`;
    if (s.seriesId) {
      actions += ` <button class="btn danger" data-act="del" data-scope="one">Poista tämä</button>`;
      actions += ` <button class="btn danger" data-act="del" data-scope="series">Poista sarja</button>`;
    } else {
      actions += ` <button class="btn danger" data-act="del">Poista treeni</button>`;
    }
  } else {
    // asiakas tai julkinen
    if (s.myStatus === 'booked') actions = `<button class="btn" data-act="cancel">Peru varaus</button>`;
    else if (s.myStatus === 'pending') actions = `<button class="btn" disabled>🟡 Odottaa hyväksyntää</button> <button class="btn" data-act="cancel">Peru</button>`;
    else if (s.myStatus === 'promoted') actions = `<button class="btn primary" data-act="confirm">✅ Vahvista osallistuminen</button> <button class="btn" data-act="cancel">Peru</button>`;
    else if (s.myStatus === 'waitlisted') actions = `<button class="btn" data-act="cancel">Poistu jonosta</button>`;
    else if (s.isFull) actions = `<button class="btn primary" data-act="book">⏳ Liity jonoon</button>`;
    else actions = `<button class="btn primary" data-act="book">Varaa paikka</button>`;
    actions += ` <button class="btn" data-act="addcal">📅 Lisää kalenteriin</button>`;
    if (['booked', 'pending', 'promoted'].includes(s.myStatus)) actions += ` <button class="btn" data-act="spotreq">🔁 En pääse</button>`;
  }

  let regHtml = '';
  if (isCoach()) {
    const regs = s.registrants || [];
    regHtml = `<div class="reglist"><div class="reglist-h"><span>Ilmoittautuneet · ${s.bookedCount}/${s.capacity}${s.waitlistCount ? ` · jono ${s.waitlistCount}` : ''}</span>
      <button class="mini" data-act="toggleadd">${state.addingReg ? '– Sulje' : '+ Lisää ilmoittautuja'}</button></div>`;
    if (!regs.length) regHtml += `<div class="reg-empty">Ei ilmoittautuneita vielä.</div>`;
    const stTag = {
      pending: '<span class="pill-role pending">odottaa</span>',
      promoted: '<span class="pill-role pending">⏳ ei vahvistanut</span>',
      waitlisted: '<span class="pill-role customer">jonossa</span>',
      booked: '',
    };
    regs.forEach((b) => {
      const approve = b.status === 'pending' ? `<button class="mini" data-act="approvebook" data-bid="${b.id}">Hyväksy</button>` : '';
      regHtml += `<div class="reg"><div>
        <b>${esc(b.name)}</b>${b.source === 'coach' ? '<span class="tag-coach">valmentaja lisäsi</span>' : ''}${stTag[b.status] || ''}
        <div class="reg-c">📞 ${esc(b.phone || '–')} · ✉️ ${esc(b.email || '–')}</div></div>
        <div style="display:flex;gap:6px;align-items:center">${approve}
          <button class="rmx" data-act="rmbook" data-bid="${b.id}" title="${b.status === 'pending' ? 'Hylkää' : 'Poista'}">✕</button></div></div>`;
    });
    if (state.addingReg) regHtml += `<div class="addreg">
        <input id="ar_name" placeholder="Nimi *" autocomplete="off">
        <input id="ar_phone" placeholder="Puhelin" autocomplete="off">
        <input id="ar_email" placeholder="Sähköposti" autocomplete="off">
        <button class="btn primary" data-act="addbook" style="grid-column:3;grid-row:1/3">Lisää</button>
      </div><div class="hint" style="padding:0 14px 12px">💡 Esim. kun asiakas ilmoittaa WhatsAppilla tulostaan.</div>`;
    regHtml += `</div>`;
  }

  let subHtml = '';
  if (isSub && s.substitute) {
    subHtml = `<div class="subbox"><div class="subbox-head">🔁 Sijaisuuspyyntö avoinna</div>
      <div class="reason">${esc(s.substitute.reason || 'Ohjaaja etsii sijaista tälle tunnille.')}</div>
      <div class="chat" id="chat">${renderChat(s.substitute)}</div>
      <div class="chat-in"><input id="chatInput" placeholder="Kirjoita viesti…" autocomplete="off">
        <button class="btn primary" data-act="send">Lähetä</button></div></div>`;
  } else if (isSub && !loggedIn()) {
    subHtml = `<div class="subbox"><div class="subbox-head">🔁 Ohjaaja etsii sijaista</div>
      <div class="reason">Kirjaudu sisään osallistuaksesi keskusteluun.</div></div>`;
  }

  $('modal').innerHTML = `
    <div class="modal-head ${isSub ? 'sub-h' : ''}"><button class="x" data-act="close">×</button>
      <h3>${esc(s.title)}</h3>
      <div class="meta"><span>📅 ${FI_DOW_LONG[dowIdx(d)]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}</span>
        <span>🕑 ${hhmm(s.startsAt)}–${hhmm(s.endsAt)}</span>${s.seriesId ? '<span>🔁 toistuva</span>' : ''}</div></div>
    <div class="modal-body">
      <div class="row">👤 <b>${esc(s.instructorName || '—')}</b> ${isSub ? '<span style="color:var(--warn)">· etsii sijaista</span>' : ''}</div>
      <div class="row">📍 ${s.locationUrl ? `<a href="${esc(s.locationUrl)}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:700">${esc(s.locationName || 'Avaa kartta')} ↗</a>` : `<b>${esc(s.locationName || '—')}</b>`}</div>
      ${s.price ? `<div class="row">💶 <b>${esc(s.price)}</b></div>` : ''}
      ${s.description ? `<div class="row" style="align-items:flex-start">📝 <span style="color:var(--ink-soft)">${esc(s.description)}</span></div>` : ''}
      <div class="row">👥 ${s.bookedCount}/${s.capacity} varattu${s.waitlistCount ? ` · ⏳ jonossa ${s.waitlistCount}` : ''}</div>
      <div class="capbar"><i class="${s.isFull ? 'full' : ''}" style="width:${pct}%"></i></div>
      <div class="actions">${actions}</div>
      ${regHtml}${subHtml}
    </div>`;
  const ci = $('chatInput'); if (ci) { const c = $('chat'); c.scrollTop = c.scrollHeight; }
  if (state.addingReg) { const n = $('ar_name'); if (n) n.focus(); }
}

function renderChat(sub) {
  const msgs = sub.messages || [];
  if (!msgs.length) return `<div class="msg sys">Ei viestejä vielä.</div>`;
  return msgs.map((m) => {
    const isSys = m.text && m.text.includes('avasi sijaisuuspyynnön');
    if (isSys) return `<div class="msg sys">${esc(m.text)}</div>`;
    const mine = m.authorId === myUid();
    return `<div class="msg ${mine ? 'me' : 'them'}">${mine ? '' : `<div class="who">${esc(m.authorName)}</div>`}${esc(m.text)}</div>`;
  }).join('');
}

function closeModal() { $('overlay').classList.remove('on'); state.openId = null; state.openSession = null; state.addingReg = false; }

async function reopenAndRefresh() {
  await loadData();
  if (isCoach()) { try { state.pending = await api.pending(); } catch (e) {} renderTopbar(); }
  if (state.openId) await openSession(state.openId);
}

async function handleAct(act, el) {
  const s = state.openSession;
  if (act === 'close') return closeModal();
  if (!s) return;
  try {
    if (act === 'book') {
      if (!loggedIn()) { openRegister(() => doBook(s.id)); return; }
      await doBook(s.id);
    } else if (act === 'cancel') {
      const wasWl = s.myStatus === 'waitlisted';
      if (s.myBookingId) await api.removeBooking(s.myBookingId);
      toast(wasWl ? 'Poistuit jonosta' : 'Varaus peruttu'); await reopenAndRefresh();
    } else if (act === 'addcal') {
      askCalendar(s, isCoach() ? 'coach-event' : 'self');
    } else if (act === 'opensub') {
      const reason = prompt('Miksi etsit sijaista? (näkyy muille)', 'Olen estynyt, kuka voisi tuurata?');
      if (reason === null) return;
      await api.openSubstitute(s.id, reason); toast('Sijaispyyntö avattu 🔁'); await reopenAndRefresh();
    } else if (act === 'closesub') {
      await api.closeSubstitute(s.substitute.id); toast('Sijaispyyntö suljettu'); await reopenAndRefresh();
    } else if (act === 'del') {
      const scope = el?.dataset?.scope === 'series' ? 'series' : undefined;
      const msg = scope === 'series'
        ? 'Poistetaanko TÄMÄ ja kaikki tulevat saman sarjan treenit?'
        : 'Poistetaanko tämä treeni?';
      if (confirm(msg)) {
        const r = await api.deleteSession(s.id, scope);
        toast(scope === 'series' ? `${(r && r.deleted) || ''} treeniä poistettu` : 'Treeni poistettu');
        closeModal();
        await loadData();
      }
    } else if (act === 'send') {
      await sendMsg(s);
    } else if (act === 'toggleadd') {
      state.addingReg = !state.addingReg; renderModal();
    } else if (act === 'rmbook') {
      if (confirm('Poistetaanko ilmoittautuminen?')) { await api.removeBooking(el.dataset.bid); toast('Ilmoittautuminen poistettu'); await reopenAndRefresh(); }
    } else if (act === 'approvebook') {
      await api.approveBooking(el.dataset.bid); toast('Hyväksytty ✓'); await reopenAndRefresh();
    } else if (act === 'confirm') {
      await api.confirmAttendance(s.myBookingId); toast('Osallistuminen vahvistettu ✓'); await reopenAndRefresh();
    } else if (act === 'spotreq') {
      const msg = prompt('Kerro lyhyesti (näkyy muille):', 'En pääse, kuka ottaisi paikkani?');
      if (msg === null) return;
      await api.openSpotRequest(s.id, msg.trim()); toast('Sijaispyyntö lähetetty 🔁'); await reopenAndRefresh();
    } else if (act === 'addbook') {
      const name = $('ar_name').value.trim();
      if (!name) { toast('Anna vähintään nimi', true); return; }
      await api.book(s.id, { name, phone: $('ar_phone').value.trim(), email: $('ar_email').value.trim() });
      state.addingReg = false; toast('Ilmoittautuja lisätty ✓');
      await reopenAndRefresh(); askCalendar(s, 'on-behalf');
    }
  } catch (e) { toast(e.message, true); }
}

async function doBook(id) {
  const b = await api.book(id);
  const st = b && b.status;
  toast(
    st === 'waitlisted' ? 'Lisätty jonoon ⏳'
    : st === 'pending' ? 'Varaus lähetetty — odottaa valmentajan hyväksyntää 🟡'
    : 'Paikka varattu ✓',
  );
  await reopenAndRefresh();
  if (st !== 'waitlisted' && state.openSession) askCalendar(state.openSession, 'self');
}

async function sendMsg(s) {
  const inp = $('chatInput'); const txt = inp.value.trim(); if (!txt) return;
  try {
    await api.sendMessage(s.substitute.id, txt);
    inp.value = '';
    state.openSession = norm(await api.session(s.id));
    $('chat').innerHTML = renderChat(state.openSession.substitute);
    const c = $('chat'); c.scrollTop = c.scrollHeight; inp.focus();
  } catch (e) { toast(e.message, true); }
}

/* ===================== CALENDAR ADD (.ics + URL) ===================== */
function gcalStamp(iso) {
  const d = new Date(iso);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
}
function googleUrl(s) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: s.title,
    dates: gcalStamp(s.startsAt) + '/' + gcalStamp(s.endsAt),
    details: 'Ohjaaja: ' + (s.instructorName || ''), location: s.locationName || '' });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function outlookUrl(s) {
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: s.title,
    startdt: new Date(s.startsAt).toISOString(), enddt: new Date(s.endsAt).toISOString(),
    location: s.locationName || '', body: 'Ohjaaja: ' + (s.instructorName || '') });
  return 'https://outlook.live.com/calendar/0/deeplink/compose?' + p.toString();
}
let calSess = null;
function askCalendar(s, ctx) {
  calSess = s;
  const heads = { self: 'Varaus tehty ✓', 'coach-event': 'Treeni', 'on-behalf': 'Ilmoittautuja lisätty ✓' };
  const subs = {
    self: 'Lisätäänkö treeni omaan kalenteriisi?',
    'coach-event': 'Lisätäänkö treeni omaan kalenteriisi?',
    'on-behalf': 'Lataa kalenterimerkintä, jonka voit lähettää asiakkaalle (esim. WhatsAppissa).',
  };
  $('calModal').innerHTML = `
    <div class="modal-head"><button class="x" data-cal="skip">×</button>
      <h3>${heads[ctx]}</h3><div class="meta">${esc(s.title)} · ${hhmm(s.startsAt)}</div></div>
    <div class="modal-body"><p style="font-size:.92rem;color:var(--ink-soft);margin-bottom:14px">${subs[ctx]}</p>
      <div class="calbtns">
        <button class="calbtn" data-cal="apple"><span class="ic apple"></span>Apple-kalenteri (lataa .ics)</button>
        <button class="calbtn" data-cal="google"><span class="ic google">📆</span>Google-kalenteri</button>
        <button class="calbtn" data-cal="outlook"><span class="ic outlook">O</span>Outlook</button>
      </div>
      <div class="switchline"><button class="linklike" data-cal="skip">Ei kiitos, ohita</button></div>
    </div>`;
  $('calOverlay').classList.add('on');
}
function handleCal(which) {
  const o = $('calOverlay');
  if (which === 'skip') { o.classList.remove('on'); return; }
  if (!calSess) return;
  if (which === 'apple') window.location.href = api.icsUrl(calSess.id);
  if (which === 'google') window.open(googleUrl(calSess), '_blank');
  if (which === 'outlook') window.open(outlookUrl(calSess), '_blank');
  o.classList.remove('on');
}

/* ===================== AUTH / REGISTER ===================== */
let pendingCb = null;
let authMode = 'register'; // 'register' | 'login'

function openRegister(cb, mode) {
  pendingCb = cb || null;
  authMode = mode || 'register';
  renderAuthModal();
  $('authOverlay').classList.add('on');
  const first = $('au_name') || $('au_email');
  if (first) first.focus();
}

function renderAuthModal() {
  const reg = authMode === 'register';
  const inv = state.invite;
  const roleFi = { coach: 'valmentajaksi', owner: 'omistajaksi' };
  const banner = inv
    ? `<div style="background:var(--brand-soft);color:var(--brand-d);border-radius:10px;padding:10px 12px;font-size:.85rem;font-weight:600;margin-bottom:14px">🎟 Sinut on kutsuttu <b>${esc(roleFi[inv.role] || inv.role)}</b> yritykseen <b>${esc(inv.organization.name)}</b>.</div>`
    : '';
  const emailVal = inv ? esc(inv.email) : '';
  const pwField = !DEV_MODE
    ? `<div class="field"><label>Salasana <span class="req">*</span></label><input id="au_pass" type="password" placeholder="väh. 6 merkkiä" autocomplete="${reg ? 'new-password' : 'current-password'}"></div>`
    : '';
  const body = reg
    ? `${banner}
      <div class="field"><label>Nimi <span class="req">*</span></label><input id="au_name" placeholder="Etunimi Sukunimi"></div>
      <div class="grid2">
        <div class="field"><label>Puhelin <span class="req">*</span></label><input id="au_phone" inputmode="tel" placeholder="040 123 4567"></div>
        <div class="field"><label>Sähköposti <span class="req">*</span></label><input id="au_email" inputmode="email" placeholder="nimi@email.fi" value="${emailVal}"></div>
      </div>
      ${pwField}
      <button class="btn primary" data-auth="register" style="width:100%;padding:11px;margin-top:4px">${inv ? 'Liity & jatka' : 'Luo tunnus & jatka'}</button>
      ${DEV_MODE || inv ? '' : '<div class="switchline">Onko jo tunnus? <button class="linklike" data-auth="tologin">Kirjaudu</button></div>'}`
    : `
      <div class="field"><label>Sähköposti</label><input id="au_email" inputmode="email" placeholder="nimi@email.fi"></div>
      ${pwField}
      <button class="btn primary" data-auth="login" style="width:100%;padding:11px;margin-top:4px">Kirjaudu</button>
      <div class="switchline">Ei tunnusta? <button class="linklike" data-auth="toreg">Luo tunnus</button></div>`;
  $('authModal').innerHTML = `
    <div class="modal-head"><button class="x" data-auth="close">×</button>
      <h3>${reg ? (inv ? 'Liity tiimiin' : 'Luo tunnus') : 'Kirjaudu sisään'}</h3>
      <div class="meta">${reg ? (inv ? '' : 'Varaaminen vaatii tunnukset.') : 'Tervetuloa takaisin.'}</div></div>
    <div class="modal-body">${body}
      <div class="hint">🔒 ${DEV_MODE ? 'Dev-tila: ei oikeaa salasanaa (imitointi). Tuotannossa Firebase-kirjautuminen.' : 'Tiedot suojataan Firebase Authilla.'}</div>
    </div>`;
}

async function doRegister() {
  const name = $('au_name').value.trim();
  const phone = $('au_phone').value.trim();
  const email = $('au_email').value.trim();
  const pass = DEV_MODE ? null : ($('au_pass') ? $('au_pass').value : '');
  if (!name) return toast('Nimi puuttuu', true);
  if (!phone) return toast('Puhelinnumero on pakollinen', true);
  if (!email || !email.includes('@')) return toast('Anna kelvollinen sähköposti', true);
  if (!DEV_MODE && (!pass || pass.length < 6)) return toast('Salasana väh. 6 merkkiä', true);
  try {
    let devUid = null;
    if (DEV_MODE) { devUid = newDevUid(); setDevUserId(devUid); }
    else await registerEmail(email, pass); // Firebase luo tilin + kirjaa sisään
    const payload = { name, phone, email };
    if (state.invite) payload.inviteToken = state.invite.token; // kutsu → org + rooli
    else payload.orgSlug = state.orgSlug;
    await api.register(payload);
    if (state.invite) { state.invite = null; cleanInviteUrl(); }
    await applyLoggedInIdentity();
    if (DEV_MODE && devUid && state.me?.user?.role === 'customer') {
      localStorage.setItem('vuoro_cust_' + state.orgSlug, devUid);
    }
    $('authOverlay').classList.remove('on');
    toast('Tervetuloa, ' + name.split(' ')[0] + '!');
    await refresh();
    const cb = pendingCb; pendingCb = null; if (cb) cb();
  } catch (e) { toast(DEV_MODE ? e.message : authErrorMsg(e), true); }
}
function cleanInviteUrl() { try { history.replaceState({}, '', location.pathname); } catch (e) {} }

async function doLogin() {
  const email = $('au_email').value.trim();
  const pass = $('au_pass') ? $('au_pass').value : '';
  if (!email || !pass) return toast('Anna sähköposti ja salasana', true);
  try {
    await loginEmail(email, pass);
    await applyLoggedInIdentity();
    $('authOverlay').classList.remove('on');
    toast('Kirjauduit sisään');
    await refresh();
    const cb = pendingCb; pendingCb = null; if (cb) cb();
  } catch (e) { toast(authErrorMsg(e), true); }
}

/* ===================== NEW SESSION FORM ===================== */
function openForm(presetDate) {
  $('formModal').innerHTML = `
    <div class="modal-head"><button class="x" data-fact="close">×</button><h3>Uusi treeni</h3></div>
    <div class="modal-body">
      <div class="field"><label>Otsikko</label><input id="f_title" placeholder="esim. Aamujooga"></div>
      <div class="field"><label>Kuvaus</label><textarea id="f_desc" rows="3" placeholder="Kerro treenistä, tasosta, varusteista…" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;font-family:inherit;font-size:.9rem;resize:vertical"></textarea></div>
      <div class="grid2">
        <div class="field"><label>Päivä</label><input id="f_date" type="date" value="${presetDate || ymd(state.anchor)}"></div>
        <div class="field"><label>Kello</label><input id="f_time" type="time" value="09:00"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Kesto (min)</label><input id="f_dur" type="number" value="60" min="15" step="15"></div>
        <div class="field"><label>Paikkoja</label><input id="f_cap" type="number" value="12" min="1"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Ohjaaja</label><input id="f_instr" value="${esc(state.me?.user?.name || '')}"></div>
        <div class="field"><label>Paikka / sali</label><input id="f_loc" value="Sali A"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Karttalinkki (valinnainen)</label><input id="f_locurl" placeholder="https://maps.app.goo.gl/…"></div>
        <div class="field"><label>Hinta (valinnainen)</label><input id="f_price" placeholder="esim. 15 €"></div>
      </div>
      <div class="field" style="background:var(--bg);border-radius:10px;padding:10px 12px">
        <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;cursor:pointer">
          <input type="checkbox" id="f_repeat" style="width:auto"> 🔁 Toistuva ryhmä
        </label>
        <div id="f_repeatRow" style="display:none;margin-top:10px">
          <div style="font-size:.82rem;color:var(--ink-soft);margin-bottom:6px">Viikonpäivät <span style="color:var(--ink-faint)">(valitse esim. ma + to = 2×/vko)</span></div>
          <div class="daypick" id="f_days">${['Ma','Ti','Ke','To','Pe','La','Su'].map((d,i)=>`<button type="button" data-d="${i}">${d}</button>`).join('')}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
            <span style="font-size:.85rem;color:var(--ink-soft)">Kuinka monta viikkoa:</span>
            <input id="f_weeks" type="number" value="8" min="1" max="52" style="width:80px">
          </div>
        </div>
      </div>
      <div class="actions" style="margin-top:8px">
        <button class="btn primary" data-fact="save">Tallenna treeni</button>
        <button class="btn" data-fact="close">Peruuta</button>
      </div>
    </div>`;
  $('formOverlay').classList.add('on');
  $('f_title').focus();
}

async function saveForm() {
  const v = (id) => $(id).value;
  const title = v('f_title').trim(); if (!title) return toast('Anna otsikko', true);
  const [Y, M, D] = v('f_date').split('-').map(Number);
  const [h, m] = v('f_time').split(':').map(Number);
  const start = new Date(Y, M - 1, D, h, m, 0, 0);
  const end = new Date(start); end.setMinutes(end.getMinutes() + (+v('f_dur') || 60));
  const repeating = $('f_repeat')?.checked;
  const weeks = repeating ? Math.max(1, +v('f_weeks') || 8) : 1;
  const days = repeating ? [...$('f_days').querySelectorAll('button.on')].map((b) => +b.dataset.d) : [];
  try {
    const payload = {
      title, startsAt: start.toISOString(), endsAt: end.toISOString(),
      capacity: +v('f_cap') || 10, instructorName: v('f_instr') || null, locationName: v('f_loc') || null,
      description: v('f_desc').trim() || null, locationUrl: v('f_locurl').trim() || null, price: v('f_price').trim() || null,
    };
    if (repeating) {
      payload.repeatWeekly = weeks;
      if (days.length) payload.repeatDays = days;
    }
    const created = await api.createSession(payload);
    $('formOverlay').classList.remove('on');
    state.anchor = startOfDay(start);
    await loadData();
    if (created && created.seriesId) {
      toast(`${created.count} toistuvaa treeniä luotu ✓`);
    } else {
      toast('Treeni luotu ✓');
      askCalendar(norm(created), 'coach-event');
    }
  } catch (e) { toast(e.message, true); }
}

/* ===================== MANAGEMENT (owner / superadmin) ===================== */
const mgmtData = { orgs: null, team: null, orgTeam: null };
let pendingLogo; // undefined = ei muutosta, null = poista, string = uusi logo (dataURI)
const inviteLink = (token) => `${location.origin}/?invite=${token}`;

// Lue kuvatiedosto, skaalaa ≤256px ja palauta PNG-dataURI (säilyttää läpinäkyvyyden).
function fileToLogoDataUri(file, maxPx = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kuvan luku epäonnistui')); };
    img.src = url;
  });
}
const roleBadge = (role) => `<span class="pill-role ${role}">${esc(role)}</span>`;
const isSuper = () => state.me?.user?.role === 'superadmin';
// Hallittavan yrityksen id superadminin porautuessa (null = oma org / owner).
const managedOrgId = () => (isSuper() ? state.mgOrgId : null);

async function openMgmt() {
  state.mgOrgId = null;
  $('mgmtOverlay').classList.add('on');
  await loadMgmt();
}
async function loadMgmt() {
  pendingLogo = undefined; // nollaa logon muutostila kun näkymä ladataan uudelleen
  try {
    if (isSuper()) {
      if (state.mgOrgId) mgmtData.orgTeam = await api.adminOrgTeam(state.mgOrgId);
      else mgmtData.orgs = await api.adminOrgs();
    } else {
      mgmtData.team = await api.team();
    }
  } catch (e) { toast(e.message, true); }
  renderMgmt();
}
function renderMgmt() {
  let inner;
  let title = state.org?.name || '';
  if (isSuper()) {
    if (state.mgOrgId && mgmtData.orgTeam) { inner = renderOrgManage(); title = mgmtData.orgTeam.org.name; }
    else { inner = renderOrgsList(); title = 'Kaikki yritykset'; }
  } else {
    inner = renderTeamBody(mgmtData.team, state.me?.organization || {});
  }
  $('mgmtModal').innerHTML = `
    <div class="modal-head"><button class="x" data-mg="close">×</button>
      <h3>Hallinta</h3><div class="meta">${esc(title)}</div></div>
    <div class="modal-body">${inner}</div>`;
}

// Superadmin: yrityslista (porautuminen "Hallinnoi"-napista).
function renderOrgsList() {
  const d = mgmtData.orgs;
  if (!d) return `<div class="loading">Ladataan…</div>`;
  const orgs = d.map((o) => `
    <div class="mrow"><div>
      <div class="mname">${esc(o.name)} <span class="msub">/${esc(o.slug)}</span>${o.active === false ? ' <span class="pill-role pending">ei aktiivinen</span>' : ''}</div>
      <div class="msub">${o.users} käyttäjää · ${o.sessions} treeniä</div></div>
      <button class="mini" data-mg="manageorg" data-id="${o.id}">Hallinnoi →</button>
    </div>`).join('');
  return `
    <div class="sec-h">Yritykset (${d.length})</div>${orgs || '<div class="reg-empty">Ei yrityksiä.</div>'}
    <div class="sec-h">Luo uusi yritys</div>
    <div class="inviteform" style="grid-template-columns:1fr 1fr auto">
      <input id="org_slug" placeholder="slug (esim. studio-x)">
      <input id="org_name" placeholder="Yrityksen nimi">
      <button class="btn primary" data-mg="createorg">Luo</button>
    </div>
    <div class="hint">Slug = osoitteessa käytettävä tunnus (pienet kirjaimet, numerot, viivat). Luonnin jälkeen "Hallinnoi →" ja kutsu omistaja.</div>`;
}

// Superadmin: yhden yrityksen hallinta (porautuneena).
function renderOrgManage() {
  const { org, members, invitations } = mgmtData.orgTeam;
  return `<button class="linklike" data-mg="backorgs">← Takaisin yrityksiin</button>
    ${renderTeamBody({ members, invitations }, org)}`;
}

// Jaettu tiimirunko: jäsenet, asetukset, kutsut. Owner = oma org; superadmin = porautunut org.
function renderTeamBody(data, settings) {
  if (!data) return `<div class="loading">Ladataan…</div>`;
  const members = (data.members || []).map((m) => `
    <div class="mrow"><div>
      <div class="mname">${esc(m.name)} ${roleBadge(m.role)}</div>
      <div class="msub">${esc(m.email)} · ${esc(m.phone || '')}</div></div>
      ${m.id === myUid()
        ? '<span class="msub">sinä</span>'
        : `<div style="display:flex;gap:6px;align-items:center">
            <select class="pill" data-role-for="${m.id}">
              <option value="coach" ${m.role === 'coach' ? 'selected' : ''}>coach</option>
              <option value="owner" ${m.role === 'owner' ? 'selected' : ''}>owner</option>
            </select>
            <button class="rmx" data-mg="rmmember" data-id="${m.id}" title="Poista käytöstä">✕</button></div>`}
    </div>`).join('');
  const invites = (data.invitations || []).length
    ? data.invitations.map((i) => `
      <div class="mrow"><div style="flex:1">
        <div class="mname">${esc(i.email)} ${roleBadge('pending')} ${roleBadge(i.role)}</div>
        <div class="codebox"><code>${inviteLink(i.token)}</code>
          <button class="mini" data-mg="copy" data-link="${inviteLink(i.token)}">Kopioi</button></div></div>
        <button class="rmx" data-mg="revoke" data-id="${i.id}" title="Peru kutsu">✕</button>
      </div>`).join('')
    : `<div class="reg-empty">Ei odottavia kutsuja.</div>`;
  return `
    <div class="sec-h">Jäsenet</div>${members || '<div class="reg-empty">Ei jäseniä vielä.</div>'}
    <div class="sec-h">Asetukset</div>
    <div class="field"><label>Peruutusaikaraja (tuntia)</label>
      <input id="set_cutoff" type="number" min="0" max="168" value="${settings.cancelCutoffHours ?? 0}"></div>
    <div class="field"><label>Sähköpostin lähettäjä</label>
      <input id="set_from" placeholder="esim. TrainWithMarjo &lt;noreply@withmarjo.fi&gt;" value="${esc(settings.emailFrom || '')}"></div>
    <div class="field"><label>Vastausosoite (Reply-To)</label>
      <input id="set_replyto" placeholder="esim. marjo.hirvensalo@gmail.com" value="${esc(settings.replyTo || '')}"></div>
    <div class="sec-h">Ulkoasu</div>
    <div class="grid2">
      <div class="field"><label>Brändiväri</label>
        <input id="set_brand" type="color" value="${esc(settings.brandColor || '#1a1a1a')}" style="height:42px;padding:4px;cursor:pointer"></div>
      <div class="field"><label>Logo</label>
        <input id="set_logo_file" type="file" accept="image/*" style="font-size:.78rem">
        <div id="set_logo_prev" style="margin-top:6px;display:flex;align-items:center;gap:8px">${settings.logoUrl
          ? `<img src="${settings.logoUrl}" style="height:38px;background:#000;border-radius:8px;padding:4px"><button class="linklike" data-mg="rmlogo" style="font-size:.8rem">Poista</button>`
          : '<span class="msub">Ei logoa</span>'}</div>
      </div>
    </div>
    <div class="hint">Brändiväri värittää napit ja korostukset. Logo näkyy yläpalkissa ja asiakkaan etusivulla (musta tausta sopii vaaleaan/valkoiseen logoon).</div>
    ${state.me?.user?.role === 'superadmin' ? `
    <div class="field"><label><input type="checkbox" id="set_active" ${settings.active !== false ? 'checked' : ''}> Yritys aktiivinen</label>
      <div class="hint">Pois päältä = yritystä ei näytetä asiakkaan yritysvalitsimessa.</div></div>` : ''}
    <button class="btn primary" data-mg="savesettings">Tallenna asetukset</button>
    <div class="hint">Peruutusaikaraja: asiakas ei voi perua alle X h ennen alkua (0 = ei rajaa).<br>Lähettäjän domain on <b>vahvistettava Resendissä</b> (tyhjä = alustan oletus). Reply-To = minne asiakkaiden vastaukset menevät (esim. gmail).</div>
    <div class="sec-h">Kutsu uusi jäsen</div>
    <div class="inviteform">
      <input id="inv_email" type="email" placeholder="sähköposti@esimerkki.fi">
      <select id="inv_role"><option value="coach">Valmentaja</option><option value="owner">Omistaja</option></select>
      <button class="btn primary" data-mg="invite">Kutsu</button>
    </div>
    <div class="sec-h">Odottavat kutsut</div>${invites}`;
}

async function handleMg(act, el) {
  const oid = managedOrgId(); // null = oma org (owner) ; asetettu = superadmin porautunut
  try {
    if (act === 'close') return $('mgmtOverlay').classList.remove('on');
    if (act === 'copy') { await navigator.clipboard.writeText(el.dataset.link); return toast('Linkki kopioitu'); }
    if (act === 'manageorg') { state.mgOrgId = el.dataset.id; return loadMgmt(); }
    if (act === 'backorgs') { state.mgOrgId = null; return loadMgmt(); }
    if (act === 'createorg') {
      const slug = $('org_slug').value.trim(); const name = $('org_name').value.trim();
      if (!slug || !name) return toast('Anna slug ja nimi', true);
      await api.createOrg({ slug, name }); toast('Yritys luotu ✓'); return loadMgmt();
    }
    if (act === 'invite') {
      const email = $('inv_email').value.trim(); const role = $('inv_role').value;
      if (!email) return toast('Anna sähköposti', true);
      await (oid ? api.adminInvite(oid, email, role) : api.invite(email, role));
      toast('Kutsu luotu — kopioi linkki alta'); return loadMgmt();
    }
    if (act === 'revoke') {
      await (oid ? api.adminRevokeInvite(el.dataset.id) : api.revokeInvite(el.dataset.id));
      toast('Kutsu peruttu'); return loadMgmt();
    }
    if (act === 'rmmember') {
      if (confirm('Poistetaanko jäsen käytöstä?')) {
        await (oid ? api.adminDeactivate(el.dataset.id) : api.deactivateMember(el.dataset.id));
        toast('Jäsen poistettu'); return loadMgmt();
      }
      return;
    }
    if (act === 'savesettings') {
      const payload = { cancelCutoffHours: +$('set_cutoff').value || 0, emailFrom: $('set_from').value.trim() || null, replyTo: $('set_replyto').value.trim() || null };
      if ($('set_active')) payload.active = $('set_active').checked;
      if ($('set_brand')) payload.brandColor = $('set_brand').value;
      if (pendingLogo !== undefined) payload.logoUrl = pendingLogo; // string = uusi, null = poista
      const o = await (oid ? api.adminOrgSettings(oid, payload) : api.saveSettings(payload));
      if (!oid && state.me?.organization) { Object.assign(state.me.organization, o); }
      if (oid && mgmtData.orgTeam) { Object.assign(mgmtData.orgTeam.org, o); }
      // Päivitä näkyvä brändi/logo heti jos muokattiin parhaillaan näytettävää organisaatiota.
      const editedSlug = oid ? mgmtData.orgTeam?.org?.slug : state.me?.organization?.slug;
      if (state.org && editedSlug === state.org.slug) {
        state.org.brandColor = o.brandColor; state.org.logoUrl = o.logoUrl;
        applyBrand();
      }
      pendingLogo = undefined;
      loadMgmt(); // päivitä esikatselu
      return toast('Asetukset tallennettu ✓');
    }
    if (act === 'rmlogo') {
      pendingLogo = null;
      $('set_logo_prev').innerHTML = '<span class="msub">Logo poistetaan tallennettaessa</span>';
      return;
    }
  } catch (e) { toast(e.message, true); }
}

/* ===================== OMAT VARAUKSET (asiakas) ===================== */
async function openMyBookings() {
  $('myOverlay').classList.add('on');
  $('myModal').innerHTML = `<div class="modal-head"><button class="x" data-my="close">×</button><h3>Omat varaukset</h3></div><div class="modal-body"><div class="loading">Ladataan…</div></div>`;
  try {
    const list = await api.myBookings();
    const now = Date.now();
    const upcoming = list.filter((b) => new Date(b.session.endsAt).getTime() >= now);
    const past = list.filter((b) => new Date(b.session.endsAt).getTime() < now).reverse();
    const row = (b) => {
      const d = new Date(b.session.startsAt);
      const tag = { pending: '🟡 odottaa hyväksyntää', promoted: '🔔 vahvista osallistuminen', waitlisted: 'jonossa', booked: '' }[b.status];
      const confirmBtn = b.status === 'promoted' ? `<button class="btn small primary" data-my="confirm" data-id="${b.bookingId}">Vahvista</button>` : '';
      return `<div class="mrow"><div>
        <div class="mname">${esc(b.session.title)} ${tag ? `<span class="pill-role pending">${tag}</span>` : ''}</div>
        <div class="msub">${FI_DOW_LONG[dowIdx(d)]} ${d.getDate()}.${d.getMonth() + 1}. klo ${hhmm(b.session.startsAt)} · ${esc(b.session.instructorName || '')}${b.session.locationName ? ' · ' + esc(b.session.locationName) : ''}</div></div>
        <div style="display:flex;gap:6px">${confirmBtn}<button class="btn small danger" data-my="cancel" data-id="${b.bookingId}">${b.status === 'waitlisted' ? 'Poistu' : 'Peru'}</button></div></div>`;
    };
    const pastRow = (b) => {
      const d = new Date(b.session.startsAt);
      return `<div class="mrow" style="opacity:.6"><div><div class="mname">${esc(b.session.title)}</div><div class="msub">${d.getDate()}.${d.getMonth() + 1}. klo ${hhmm(b.session.startsAt)}</div></div></div>`;
    };
    $('myModal').querySelector('.modal-body').innerHTML = `
      <div class="sec-h">Tulevat (${upcoming.length})</div>
      ${upcoming.map(row).join('') || '<div class="reg-empty">Ei tulevia varauksia.</div>'}
      <div class="sec-h">Menneet</div>
      ${past.slice(0, 20).map(pastRow).join('') || '<div class="reg-empty">Ei menneitä.</div>'}
      <div class="sec-h">Tietosuoja (GDPR)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" data-my="export">⬇ Lataa tietoni</button>
        <button class="btn small danger" data-my="deleteacct">🗑 Poista tilini</button>
      </div>`;
  } catch (e) { toast(e.message, true); }
}
async function handleMy(act, el) {
  if (act === 'close') return $('myOverlay').classList.remove('on');
  if (act === 'cancel') {
    try { await api.removeBooking(el.dataset.id); toast('Peruttu'); await openMyBookings(); await loadData(); }
    catch (e) { toast(e.message, true); }
  }
  if (act === 'confirm') {
    try { await api.confirmAttendance(el.dataset.id); toast('Osallistuminen vahvistettu ✓'); await openMyBookings(); await loadData(); }
    catch (e) { toast(e.message, true); }
  }
  if (act === 'export') {
    try {
      const data = await api.myData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'vuoro-omat-tiedot.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Tiedot ladattu');
    } catch (e) { toast(e.message, true); }
  }
  if (act === 'deleteacct') {
    if (!confirm('Poistetaanko tilisi ja KAIKKI tietosi pysyvästi? Tätä ei voi perua.')) return;
    try {
      await api.deleteAccount();
      $('myOverlay').classList.remove('on');
      if (DEV_MODE) { setDevUserId(null); localStorage.removeItem('vuoro_cust_' + state.orgSlug); }
      else { await fbLogout(); }
      state.identity = 'public'; state.me = null;
      toast('Tilisi on poistettu');
      await refresh();
    } catch (e) { toast(e.message, true); }
  }
}

/* ===================== HYVÄKSYNNÄT (coach/owner) ===================== */
function openApprovals() {
  $('apprOverlay').classList.add('on');
  renderApprovals();
}
function renderApprovals() {
  const list = state.pending || [];
  const rows = list.length
    ? list.map((p) => {
        const d = new Date(p.session.startsAt);
        return `<div class="mrow"><div>
          <div class="mname">${esc(p.name)}</div>
          <div class="msub">${esc(p.session.title)} · ${FI_DOW_LONG[dowIdx(d)]} ${d.getDate()}.${d.getMonth() + 1}. klo ${hhmm(p.session.startsAt)}${p.phone ? ' · 📞 ' + esc(p.phone) : ''}</div></div>
          <div style="display:flex;gap:6px">
            <button class="btn small primary" data-appr="approve" data-id="${p.bookingId}">Hyväksy</button>
            <button class="btn small danger" data-appr="reject" data-id="${p.bookingId}">Hylkää</button>
          </div></div>`;
      }).join('')
    : '<div class="reg-empty">Ei odottavia hyväksyntöjä 🎉</div>';
  $('apprModal').innerHTML = `
    <div class="modal-head"><button class="x" data-appr="close">×</button>
      <h3>Hyväksynnät (${list.length})</h3><div class="meta">Odottavat varauspyynnöt</div></div>
    <div class="modal-body">${rows}</div>`;
}
async function handleAppr(act, el) {
  if (act === 'close') return $('apprOverlay').classList.remove('on');
  try {
    if (act === 'approve') await api.approveBooking(el.dataset.id);
    if (act === 'reject') await api.removeBooking(el.dataset.id);
    toast(act === 'approve' ? 'Hyväksytty ✓' : 'Hylätty');
    state.pending = await api.pending();
    renderApprovals(); renderTopbar(); await loadData();
    if (!state.pending.length) $('apprOverlay').classList.remove('on');
  } catch (e) { toast(e.message, true); }
}

/* ===================== ASIAKKAIDEN SIJAISPYYNNÖT ===================== */
function renderSpot() {
  const list = state.spotRequests || [];
  const sec = $('spotSec'); const wrap = $('spotCards');
  if (!loggedIn() || !list.length) { sec.style.display = 'none'; wrap.innerHTML = ''; return; }
  sec.style.display = '';
  $('spotCount').textContent = list.length;
  wrap.innerHTML = list.map((r) => {
    const d = new Date(r.session.startsAt);
    return `<div class="ecard sub" data-spot="${r.id}">
      <h3>${esc(r.session.title)}</h3>
      <div class="date">📅 ${FI_DOW_LONG[dowIdx(d)]} ${d.getDate()}.${d.getMonth() + 1}. · ${hhmm(r.session.startsAt)}</div>
      <div class="badges"><span class="badge b-sub">🔁 ${esc(r.requesterName)} etsii sijaista</span></div>
      ${r.message ? `<div style="margin-top:8px;color:var(--ink-soft);font-size:.84rem">"${esc(r.message)}"</div>` : ''}
    </div>`;
  }).join('');
}
async function openSpotDetail(id) {
  state.openSpotId = id;
  $('spotOverlay').classList.add('on');
  try { renderSpotDetail(await api.spotRequest(id)); } catch (e) { toast(e.message, true); }
}
function renderSpotDetail(r) {
  const d = new Date(r.session.startsAt);
  const canClose = r.requesterId === myUid() || isCoach();
  const msgs = (r.messages || []).length
    ? r.messages.map((m) => {
        const me = m.authorId === myUid();
        return `<div class="msg ${me ? 'me' : 'them'}">${me ? '' : `<div class="who">${esc(m.authorName)}</div>`}${esc(m.text)}</div>`;
      }).join('')
    : '<div class="msg sys">Ei viestejä vielä — vastaa jos voit tuurata.</div>';
  $('spotModal').innerHTML = `
    <div class="modal-head sub-h"><button class="x" data-spotact="close">×</button>
      <h3>🔁 Sijaispyyntö</h3>
      <div class="meta"><span>${esc(r.session.title)}</span><span>📅 ${FI_DOW_LONG[dowIdx(d)]} ${d.getDate()}.${d.getMonth() + 1}. klo ${hhmm(r.session.startsAt)}</span></div></div>
    <div class="modal-body">
      <div class="row">🙋 <b>${esc(r.requesterName)}</b> etsii sijaista paikalleen</div>
      <div class="subbox">
        <div class="chat" id="spotChat">${msgs}</div>
        <div class="chat-in"><input id="spotInput" placeholder="Vastaa…" autocomplete="off">
          <button class="btn primary" data-spotact="send">Lähetä</button></div>
      </div>
      ${canClose ? `<div class="actions" style="margin-top:12px"><button class="btn danger" data-spotact="closereq">Sulje sijaispyyntö</button></div>` : ''}
    </div>`;
  const c = $('spotChat'); if (c) c.scrollTop = c.scrollHeight;
}
async function handleSpot(act) {
  if (act === 'close') return $('spotOverlay').classList.remove('on');
  try {
    if (act === 'send') {
      const inp = $('spotInput'); const t = inp.value.trim(); if (!t) return;
      await api.spotMessage(state.openSpotId, t); inp.value = '';
      renderSpotDetail(await api.spotRequest(state.openSpotId));
    } else if (act === 'closereq') {
      await api.closeSpotRequest(state.openSpotId);
      $('spotOverlay').classList.remove('on'); toast('Sijaispyyntö suljettu'); await refresh();
    }
  } catch (e) { toast(e.message, true); }
}

/* ===================== TOAST ===================== */
let toastT;
function toast(msg, isErr) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast on' + (isErr ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 2400);
}

/* ===================== WIRING ===================== */
$('tenantSel').addEventListener('change', async (e) => {
  state.orgSlug = e.target.value; localStorage.setItem('vuoro_org', state.orgSlug);
  // Asiakastili kuuluu vain yhteen firmaan → firman vaihto kirjaa ulos,
  // jotta näkyy valitun firman kalenteri (eikä tilin oman firman treenit).
  if (!DEV_MODE && state.me) { try { await fbLogout(); } catch {} }
  state.identity = 'public'; setDevUserId(null); state.me = null;
  await loadOrg(); await refresh();
});
$('roleSel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setIdentity(b.dataset.id); });
$('viewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.view = b.dataset.view; loadData(); } });
$('acct').addEventListener('click', async (e) => {
  if (e.target.id === 'loginBtn') openRegister(null, DEV_MODE ? 'register' : 'login');
  if (e.target.id === 'logoutBtn') {
    if (DEV_MODE) { setIdentity('public'); }
    else { await fbLogout(); /* onAuthChange hoitaa lopun */ }
  }
});
$('mgmtBtn').onclick = () => openMgmt();
$('myBtn').onclick = () => openMyBookings();
$('myOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'myOverlay') return $('myOverlay').classList.remove('on');
  const a = e.target.closest('[data-my]'); if (a) handleMy(a.dataset.my, a);
});
$('apprBtn').onclick = () => openApprovals();
$('apprOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'apprOverlay') return $('apprOverlay').classList.remove('on');
  const a = e.target.closest('[data-appr]'); if (a) handleAppr(a.dataset.appr, a);
});
$('mgmtOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'mgmtOverlay') return $('mgmtOverlay').classList.remove('on');
  const tab = e.target.closest('[data-mgtab]');
  if (tab) { state.mgmtTab = tab.dataset.mgtab; return loadMgmt(); }
  const a = e.target.closest('[data-mg]'); if (a) handleMg(a.dataset.mg, a);
});
$('mgmtOverlay').addEventListener('change', async (e) => {
  if (e.target.id === 'set_logo_file') {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      pendingLogo = await fileToLogoDataUri(file);
      $('set_logo_prev').innerHTML = `<img src="${pendingLogo}" style="height:38px;background:#000;border-radius:8px;padding:4px"><button class="linklike" data-mg="rmlogo" style="font-size:.8rem">Poista</button>`;
    } catch (err) { toast(err.message, true); }
    return;
  }
  const sel = e.target.closest('[data-role-for]');
  if (sel) {
    const oid = managedOrgId();
    try {
      await (oid ? api.adminSetMemberRole(sel.dataset.roleFor, sel.value) : api.setMemberRole(sel.dataset.roleFor, sel.value));
      toast('Rooli päivitetty'); loadMgmt();
    } catch (err) { toast(err.message, true); }
  }
});

function step(dir) {
  const a = state.anchor;
  if (state.view === 'month') a.setMonth(a.getMonth() + dir);
  else if (state.view === 'week') a.setDate(a.getDate() + 7 * dir);
  else a.setDate(a.getDate() + dir);
  loadData();
}
$('prevBtn').onclick = () => step(-1);
$('nextBtn').onclick = () => step(1);
$('todayBtn').onclick = () => { state.anchor = startOfDay(new Date()); loadData(); };
$('addBtn').onclick = () => openForm();

$('calBody').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-ev]'); if (chip) return openSession(chip.dataset.ev);
  const day = e.target.closest('[data-date]'); if (day && isCoach()) openForm(day.dataset.date);
});
$('cards').addEventListener('click', (e) => { const c = e.target.closest('[data-ev]'); if (c) openSession(c.dataset.ev); });
$('spotCards').addEventListener('click', (e) => { const c = e.target.closest('[data-spot]'); if (c) openSpotDetail(c.dataset.spot); });
$('spotOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'spotOverlay') return $('spotOverlay').classList.remove('on');
  const a = e.target.closest('[data-spotact]'); if (a) handleSpot(a.dataset.spotact);
});
$('spotModal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'spotInput') handleSpot('send'); });
$('overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') return closeModal();
  const a = e.target.closest('[data-act]'); if (a) handleAct(a.dataset.act, a);
});
$('modal').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'chatInput' && state.openSession?.substitute) sendMsg(state.openSession);
});
$('formOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'formOverlay') return $('formOverlay').classList.remove('on');
  // Viikonpäivä-napin valinta/poisto (ennen data-fact-tarkistusta, napeissa ei ole sitä)
  const dayBtn = e.target.closest('#f_days button');
  if (dayBtn) { dayBtn.classList.toggle('on'); return; }
  const a = e.target.closest('[data-fact]'); if (!a) return;
  if (a.dataset.fact === 'close') $('formOverlay').classList.remove('on');
  if (a.dataset.fact === 'save') saveForm();
});
$('formOverlay').addEventListener('change', (e) => {
  if (e.target.id === 'f_repeat') {
    $('f_repeatRow').style.display = e.target.checked ? 'block' : 'none';
    // Esivalitse alkupäivän viikonpäivä kun toisto laitetaan päälle.
    if (e.target.checked && !$('f_days').querySelector('button.on')) {
      const [Y, M, D] = ($('f_date').value || '').split('-').map(Number);
      if (Y) { const dow = (new Date(Y, M - 1, D).getDay() + 6) % 7; $('f_days').querySelector(`button[data-d="${dow}"]`)?.classList.add('on'); }
    }
  }
});
$('calOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'calOverlay') return $('calOverlay').classList.remove('on');
  const a = e.target.closest('[data-cal]'); if (a) handleCal(a.dataset.cal);
});
$('authOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'authOverlay') return $('authOverlay').classList.remove('on');
  const a = e.target.closest('[data-auth]'); if (!a) return;
  const m = a.dataset.auth;
  if (m === 'close') $('authOverlay').classList.remove('on');
  if (m === 'register') doRegister();
  if (m === 'login') doLogin();
  if (m === 'tologin') { authMode = 'login'; renderAuthModal(); }
  if (m === 'toreg') { authMode = 'register'; renderAuthModal(); }
});
$('authModal').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { authMode === 'login' ? doLogin() : doRegister(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); ['formOverlay', 'calOverlay', 'authOverlay', 'mgmtOverlay', 'myOverlay', 'apprOverlay', 'spotOverlay'].forEach((id) => $(id).classList.remove('on')); }
});

/* ===================== INIT ===================== */
(async function init() {
  try { state.allOrgs = await api.orgs(); } catch {}
  renderTopbar();
  // Kutsulinkki ?invite=token → esikatselu + aseta org kutsun mukaan.
  const params = new URLSearchParams(location.search);
  const invToken = params.get('invite');
  if (invToken) {
    try {
      const p = await api.invitePreview(invToken);
      state.invite = { ...p, token: invToken };
      state.orgSlug = p.organization.slug;
      localStorage.setItem('vuoro_org', state.orgSlug);
    } catch { toast('Kutsu ei ole voimassa', true); }
  }
  await loadOrg();
  if (!DEV_MODE) {
    onAuthChange(async (uid) => {
      if (uid) await applyLoggedInIdentity();
      else { state.identity = 'public'; state.me = null; }
      await refresh();
    });
    await authReady;
  }
  await refresh();
  // Avaa liittymismodaali jos saavuttiin kutsulinkillä eikä olla kirjautuneita.
  if (state.invite && !loggedIn()) openRegister(null, 'register');
})();
