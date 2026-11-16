'use strict';
/* =====================================================================
   WasteLog — waste KG log book for data-entry people.
   All data lives in the browser's localStorage. No server needed.
   ===================================================================== */

/* ---------------- helpers ---------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;

const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAYS_L = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => toISO(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = iso => { if (!iso) return ''; const d = parseISO(iso); return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_S[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDateShort = iso => { if (!iso) return ''; const d = parseISO(iso); return `${String(d.getDate()).padStart(2, '0')} ${MONTHS_S[d.getMonth()]}`; };
const dayName = (iso, long) => { const d = parseISO(iso); return (long ? DAYS_L : DAYS_S)[d.getDay()]; };

const monthKeyOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
function monthRangeOf(key) { const [y, m] = key.split('-').map(Number); return [toISO(new Date(y, m - 1, 1)), toISO(new Date(y, m, 0))]; }
function shiftMonth(key, dir) { const [y, m] = key.split('-').map(Number); return monthKeyOf(new Date(y, m - 1 + dir, 1)); }
const monthLabel = key => { const [y, m] = key.split('-').map(Number); return `${MONTHS_L[m - 1]} ${y}`; };

function weekRange(base = new Date()) {
  const dow = (base.getDay() + 6) % 7;              // Monday = 0
  const mon = new Date(base); mon.setDate(base.getDate() - dow);
  const sun = new Date(mon);  sun.setDate(mon.getDate() + 6);
  return [toISO(mon), toISO(sun)];
}

const kg = n => n.toLocaleString('en-NG', { maximumFractionDigits: 2 });
const money = n => state.settings.currency + n.toLocaleString('en-NG', { maximumFractionDigits: 2 });

/* ---------------- state / storage ---------------- */
const STORE_KEY = 'wastelog.v1';
const DEFAULT_SETTINGS = { company: '', currency: '₦', rate: 650, rememberReceivedBy: true, lastReceivedBy: '', welcomed: false };

function freshState() {
  return { facilities: [], entries: [], settings: { ...DEFAULT_SETTINGS } };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    return {
      facilities: Array.isArray(s.facilities) ? s.facilities : [],
      entries: Array.isArray(s.entries) ? s.entries : [],
      settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {})
    };
  } catch (e) { console.error(e); return freshState(); }
}
function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ facilities: state.facilities, entries: state.entries, settings: state.settings }));
}
let state = loadState();

const facName = id => { const f = state.facilities.find(f => f.id === id); return f ? f.name : '(deleted business)'; };
const sortedFacs = () => [...state.facilities].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

/* =====================================================================
   CLOUD MODE — records live in a Google Sheet (see SHEETS-SETUP.md).
   If CONFIGURED_SCRIPT_URL is empty the app runs in plain local mode.
   ===================================================================== */
const CONFIGURED_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyI1f5kiykIsjhdMHVYZrEWmxAA6hh6VOMlJpvUtaOVDkmfX50t72jgRBY3qqkgvMys3Q/exec';
const SCRIPT_URL = new URLSearchParams(location.search).get('script') || CONFIGURED_SCRIPT_URL;
const SESSION_KEY = 'wastelog.session';
const QUEUE_KEY = 'wastelog.queue';

const isCloud = () => SCRIPT_URL.length > 0;
const isAdmin = () => !isCloud() || (!!getSession() && getSession().role === 'admin');

function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
function setSession(s) { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }
function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; } }
function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

async function cloudCall(action, payload = {}) {
  const s = getSession();
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // keeps it a "simple request" (no CORS preflight)
    body: JSON.stringify({ action, token: s && s.token, ...payload })
  });
  const out = await res.json();
  if (out && out.error === 'AUTH') { setSession(null); updateAuthUI(); showLoginScreen(); throw new Error('AUTH'); }
  return out;
}

/** All flushes run one after another so nothing is ever sent twice. */
let flushChain = Promise.resolve();
function flushQueue() {
  if (!isCloud()) return Promise.resolve();
  flushChain = flushChain.then(async () => {
    const q = getQueue();
    if (!q.length) return;
    try {
      const out = await cloudCall('mutate', { ops: q });
      if (out && out.ok) saveQueue([]);
    } catch (e) { /* offline or session ended — the queue keeps the work safe */ }
  });
  return flushChain;
}

/** Every change to records goes through here: save locally + queue for the cloud. */
function commit(...ops) {
  saveState();
  if (!isCloud() || !ops.length) return;
  saveQueue(getQueue().concat(ops));
  flushQueue();
}
const replaceAllOp = () => ({ type: 'replace_all', facilities: state.facilities, entries: state.entries, settings: state.settings });

/* retry queued work now and then, in case of failed pushes */
setInterval(flushQueue, 30000);
window.addEventListener('online', flushQueue);

/* ---------------- toast + confirm ---------------- */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
}
function confirmDlg(msg, okLabel = 'Yes, continue') {
  return new Promise(resolve => {
    const dlg = $('#confirm-dialog');
    let okClicked = false;
    $('#confirm-msg').textContent = msg;
    $('#confirm-ok').textContent = okLabel;
    $('#confirm-ok').onclick = () => { okClicked = true; dlg.close(); };
    $('#confirm-cancel').onclick = () => dlg.close();
    dlg.onclose = () => resolve(okClicked);
    dlg.showModal();
  });
}

/* ---------------- view switching ---------------- */
function switchView(name) {
  $$('.maintab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $('#open-settings').classList.toggle('active', name === 'settings');
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
  if (name === 'register') renderRegister();
  if (name === 'summary')  renderSummary();
  if (name === 'facilities') renderFacilities();
  if (name === 'settings') renderSettings();
  if (name === 'entry') $('#f-facility').focus();
}
$('#open-settings').addEventListener('click', () => switchView('settings'));

/* ---------------- big confirmation banner (entry view) ---------------- */
function showBanner(html) {
  const b = $('#saved-banner');
  b.innerHTML = html;
  b.hidden = false;
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => { b.hidden = true; }, 6000);
}

/* ---------------- stats (entry view cards) ---------------- */
function kgInRange(from, to) {
  return state.entries.reduce((s, e) => (e.date >= from && e.date <= to ? s + e.boxKg + e.wasteKg : s), 0);
}
function renderStats() {
  const t = todayStr();
  const [ws, we] = weekRange();
  const [ms, me] = monthRangeOf(monthKeyOf());
  $('#stat-today').textContent = kg(round2(kgInRange(t, t))) + ' kg';
  $('#stat-week').textContent  = kg(round2(kgInRange(ws, we))) + ' kg';
  $('#stat-month').textContent = kg(round2(kgInRange(ms, me))) + ' kg';
  const amt = state.entries.filter(e => e.date >= ms && e.date <= me).reduce((s, e) => s + e.amount, 0);
  $('#stat-amt').textContent = money(round2(amt));
}

/* ---------------- facility combobox ---------------- */
const comboInput = $('#f-facility');
const comboId = $('#f-facility-id');
const comboList = $('#combo-list');
let comboItems = [];
let comboActiveIndex = 0;

function renderCombo() {
  const q = comboInput.value.trim().toLowerCase();
  let list = sortedFacs();
  if (q) list = list.filter(f => f.name.toLowerCase().includes(q));
  list = list.slice(0, 8);
  comboItems = list;
  comboActiveIndex = 0;
  const exact = state.facilities.some(f => f.name.toLowerCase() === q);
  let html = list.map((f, i) =>
    `<button type="button" class="combo-item${i === 0 ? ' active' : ''}" data-i="${i}">
       <span>${esc(f.name)}</span><small>${esc(f.category || '')}</small>
     </button>`).join('');
  if (q && !exact)
    html += `<button type="button" class="combo-item new${list.length === 0 ? ' active' : ''}" data-new="1">
               <span>➕ Add “${esc(comboInput.value.trim())}”</span><small>create new facility</small>
             </button>`;
  comboList.innerHTML = html || `<div class="combo-none">Start typing a facility name…</div>`;
}
comboInput.addEventListener('input', () => { comboId.value = ''; renderCombo(); comboList.hidden = false; });
comboInput.addEventListener('focus', () => { renderCombo(); comboList.hidden = false; });
comboInput.addEventListener('blur', () => setTimeout(() => comboList.hidden = true, 130));
comboInput.addEventListener('keydown', e => {
  if (comboList.hidden) return;
  const items = $$('.combo-item', comboList);
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    comboActiveIndex = e.key === 'ArrowDown'
      ? (comboActiveIndex + 1) % items.length
      : (comboActiveIndex - 1 + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === comboActiveIndex));
    items[comboActiveIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    // pick highlighted (or first) suggestion instead of submitting the form
    e.preventDefault();
    items[comboActiveIndex >= 0 ? comboActiveIndex : 0].click();
  } else if (e.key === 'Escape') {
    comboList.hidden = true;
  }
});
comboList.addEventListener('pointerdown', e => {
  const b = e.target.closest('.combo-item');
  if (!b) return;
  e.preventDefault();
  if (b.dataset.new) {
    comboId.value = '';                       // name stays -> created on save
  } else {
    const f = comboItems[+b.dataset.i];
    comboInput.value = f.name;
    comboId.value = f.id;
  }
  comboList.hidden = true;
  $('#f-box').focus();
});

/* ---------------- entry form ---------------- */
let editingId = null;

function recalc() {
  const box = num($('#f-box').value), waste = num($('#f-waste').value), rate = num($('#f-rate').value);
  const total = round2(box + waste);
  $('#f-total').textContent = kg(total);
  $('#f-amount').value = total ? round2(total * rate) : '';
}
['f-box', 'f-waste', 'f-rate'].forEach(id => $('#' + id).addEventListener('input', recalc));

function resetForm() {
  editingId = null;
  $('#form-title').textContent = 'New Entry';
  $('#save-btn').innerHTML = 'Save Entry';
  $('#cancel-edit-btn').classList.add('hidden');
  $('#f-date').value = todayStr();
  comboInput.value = ''; comboId.value = ''; comboList.hidden = true;
  $('#f-box').value = ''; $('#f-waste').value = '';
  $('#f-rate').value = state.settings.rate;
  $('#f-total').textContent = '0';
  $('#f-amount').value = '';
  $('#f-status').value = 'Paid';
  $('#f-received').value = state.settings.rememberReceivedBy ? state.settings.lastReceivedBy : '';
  $('#f-note').value = '';
}

function fillForm(e) {
  editingId = e.id;
  $('#form-title').textContent = 'Edit Entry';
  $('#save-btn').innerHTML = 'Update Entry';
  $('#cancel-edit-btn').classList.remove('hidden');
  $('#f-date').value = e.date;
  comboInput.value = facName(e.facilityId);
  comboId.value = e.facilityId;
  $('#f-box').value = e.boxKg; $('#f-waste').value = e.wasteKg;
  $('#f-rate').value = e.rate; $('#f-amount').value = e.amount;
  $('#f-total').textContent = kg(round2(e.boxKg + e.wasteKg));
  $('#f-status').value = e.status;
  $('#f-received').value = e.receivedBy;
  $('#f-note').value = e.note || '';
}

$('#entry-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = comboInput.value.trim();
  if (!name) { toast('Please enter a business name', 'err'); comboInput.focus(); return; }

  const ops = [];
  let fac = null;

  if (editingId) {
    const existingEntry = state.entries.find(x => x.id === editingId);
    const oldFac = existingEntry ? state.facilities.find(f => f.id === existingEntry.facilityId) : null;
    const sameNameFac = state.facilities.find(f => f.name.toLowerCase() === name.toLowerCase());

    if (sameNameFac) {
      // Picked or typed an existing business name
      fac = sameNameFac;
      // If the old business had only this entry, clean up the old business so it doesn't become 0.0
      if (oldFac && oldFac.id !== fac.id) {
        const remainingCount = state.entries.filter(x => x.facilityId === oldFac.id && x.id !== editingId).length;
        if (remainingCount === 0) {
          state.facilities = state.facilities.filter(f => f.id !== oldFac.id);
          ops.push({ type: 'facility_delete', id: oldFac.id });
        }
      }
    } else if (oldFac) {
      // Renamed the business directly on the entry: rename the business in place!
      oldFac.name = name;
      fac = oldFac;
      ops.push({ type: 'facility_upsert', facility: oldFac });
      toast(`Business renamed to “${name}” ✓`);
    } else {
      // New business
      fac = { id: uid(), name, category: '', createdAt: new Date().toISOString() };
      state.facilities.push(fac);
      ops.push({ type: 'facility_upsert', facility: fac });
      toast(`New business added: ${name}`);
    }
  } else {
    // New entry creation
    fac = (comboId.value && state.facilities.find(f => f.id === comboId.value))
       || state.facilities.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (!fac) {
      fac = { id: uid(), name, category: '', createdAt: new Date().toISOString() };
      state.facilities.push(fac);
      ops.push({ type: 'facility_upsert', facility: fac });
      toast(`New business added: ${name}`);
    }
  }

  const data = {
    date: $('#f-date').value || todayStr(),
    facilityId: fac.id,
    boxKg: num($('#f-box').value),
    wasteKg: num($('#f-waste').value),
    rate: num($('#f-rate').value),
    amount: round2(num($('#f-amount').value)),
    receivedBy: $('#f-received').value.trim(),
    status: $('#f-status').value,
    note: $('#f-note').value.trim()
  };

  let savedEntry, wasUpdate = false;
  if (editingId) {
    const i = state.entries.findIndex(x => x.id === editingId);
    if (i > -1) state.entries[i] = { ...state.entries[i], ...data };
    savedEntry = state.entries[i];
    wasUpdate = true;
    ops.push({ type: 'entry_upsert', entry: savedEntry });
  } else {
    savedEntry = { id: uid(), ...data, createdAt: new Date().toISOString() };
    state.entries.push(savedEntry);
    ops.push({ type: 'entry_upsert', entry: savedEntry });
  }

  if (state.settings.rememberReceivedBy && data.receivedBy) state.settings.lastReceivedBy = data.receivedBy;
  commit(...ops);
  resetForm();
  renderAll();
  comboInput.focus();
  if (isCloud()) await flushQueue();
  const offline = isCloud() && getQueue().length > 0;
  showBanner(`✓ ${wasUpdate ? 'Entry updated' : 'Saved'} — <strong>${esc(fac.name)}</strong>: ${kg(round2(data.boxKg + data.wasteKg))} kg, ${money(data.amount)}${offline ? ' <small>(offline — it will sync automatically)</small>' : ''}`);
});
$('#cancel-edit-btn').addEventListener('click', () => { resetForm(); renderAll(); toast('Edit cancelled'); });

/* entry edit / delete (shared by recent + register) */
async function handleEntryAction(id, act) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  if (act === 'edit') {
    resetForm();
    fillForm(e);
    switchView('entry');
    toast(`Editing entry — ${facName(e.facilityId)}, ${fmtDate(e.date)}`);
  } else if (act === 'del') {
    const ok = await confirmDlg(`Delete the entry for “${facName(e.facilityId)}” on ${fmtDate(e.date)}? This cannot be undone.`, 'Yes, delete it');
    if (!ok) return;
    state.entries = state.entries.filter(x => x.id !== id);
    commit({ type: 'entry_delete', id });
    renderAll(); toast('Entry deleted');
  }
}

/* ---------------- recent entries (entry view) ---------------- */
function renderRecent() {
  const rows = [...state.entries].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 7);
  $('#recent-empty').hidden = rows.length > 0;
  $('#recent-body').innerHTML = rows.map(e => `
    <tr data-id="${e.id}">
      <td class="muted">${fmtDateShort(e.date)}</td>
      <td><strong>${esc(facName(e.facilityId))}</strong><br><small>${kg(round2(e.boxKg + e.wasteKg))} kg · ${money(e.amount)}</small></td>
      <td class="acts">
        <button class="tbtn" data-act="edit">Edit</button>
        <button class="tbtn danger" data-act="del">Delete</button>
      </td>
    </tr>`).join('');
}
$('#recent-body').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  handleEntryAction(b.closest('tr').dataset.id, b.dataset.act);
});

/* ---------------- log book (register) ---------------- */
const regState = {
  q: '', range: 'month', from: '', to: '', facility: '', status: '',
  sortKey: 'date', sortDir: -1,
  pageSize: 20,
  page: 1,
  selected: new Set()
};

function regRange() {
  const t = todayStr();
  switch (regState.range) {
    case 'today':     return [t, t];
    case 'week':      return weekRange();
    case 'month':     return monthRangeOf(monthKeyOf());
    case 'lastmonth': return monthRangeOf(shiftMonth(monthKeyOf(), -1));
    case 'custom':    return [regState.from || '0000-01-01', regState.to || '9999-12-31'];
    default:          return null;               // all time
  }
}
function regLabel() {
  const r = regRange();
  if (!r) return 'All time';
  const span = `${fmtDate(r[0])} – ${fmtDate(r[1])}`;
  const names = { today: 'Today', week: 'This week', month: 'This month', lastmonth: 'Last month' };
  return regState.range === 'custom' ? span : `${names[regState.range]} (${span})`;
}

function filteredEntries() {
  const r = regRange();
  const q = regState.q.trim().toLowerCase();
  let rows = state.entries.filter(e => {
    if (r && (e.date < r[0] || e.date > r[1])) return false;
    if (regState.facility && e.facilityId !== regState.facility) return false;
    if (regState.status && e.status !== regState.status) return false;
    if (q) {
      const hay = `${facName(e.facilityId)} ${e.receivedBy} ${e.note || ''} ${e.date} ${e.status}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const d = regState.sortDir;
  const key = regState.sortKey;
  rows.sort((a, b) => {
    let va, vb;
    if (key === 'name')            { va = facName(a.facilityId).toLowerCase(); vb = facName(b.facilityId).toLowerCase(); }
    else if (key === 'box')        { va = a.boxKg; vb = b.boxKg; }
    else if (key === 'waste')      { va = a.wasteKg; vb = b.wasteKg; }
    else if (key === 'total')      { va = a.boxKg + a.wasteKg; vb = b.boxKg + b.wasteKg; }
    else if (key === 'amount')     { va = a.amount; vb = b.amount; }
    else                           { va = a.date + (a.createdAt || ''); vb = b.date + (b.createdAt || ''); }
    if (va < vb) return -1 * d;
    if (va > vb) return  1 * d;
    return facName(a.facilityId).localeCompare(facName(b.facilityId));
  });
  return rows;
}

function updateBatchBar() {
  const bar = $('#batch-bar');
  const count = regState.selected.size;
  if (!bar) return;
  if (count > 0) {
    bar.classList.remove('hidden');
    $('#batch-selected-count').textContent = `${count} ${count === 1 ? 'entry' : 'entries'} selected`;
  } else {
    bar.classList.add('hidden');
  }
}

function renderRegister() {
  // facility filter options
  const sel = $('#reg-facility');
  sel.innerHTML = '<option value="">All businesses</option>' +
    sortedFacs().map(f => `<option value="${f.id}"${f.id === regState.facility ? ' selected' : ''}>${esc(f.name)}</option>`).join('');

  // sort indicators
  $$('#reg-table th.sortable').forEach(th => {
    $('.dir', th).textContent = th.dataset.sort === regState.sortKey ? (regState.sortDir === 1 ? '▲' : '▼') : '';
  });

  const allRows = filteredEntries();
  const totalCount = allRows.length;
  $('#reg-empty').hidden = totalCount > 0;

  // Pagination calculation
  const isAll = regState.pageSize === 'all';
  const size = isAll ? Math.max(1, totalCount) : Number(regState.pageSize || 20);
  const totalPages = Math.max(1, Math.ceil(totalCount / size));
  if (regState.page > totalPages) regState.page = totalPages;
  if (regState.page < 1) regState.page = 1;

  const startIdx = isAll ? 0 : (regState.page - 1) * size;
  const endIdx = isAll ? totalCount : Math.min(startIdx + size, totalCount);
  const pageRows = isAll ? allRows : allRows.slice(startIdx, endIdx);

  // Clean selected set of deleted/missing entries
  const currentIds = new Set(state.entries.map(e => e.id));
  for (const id of regState.selected) {
    if (!currentIds.has(id)) regState.selected.delete(id);
  }

  $('#reg-body').innerHTML = pageRows.map((e, idx) => {
    const isChecked = regState.selected.has(e.id);
    return `
    <tr data-id="${e.id}" class="${isChecked ? 'selected-row' : ''}">
      <td class="chk-col no-print">
        <input type="checkbox" class="reg-row-chk" data-id="${e.id}" ${isChecked ? 'checked' : ''}/>
      </td>
      <td class="num muted">${startIdx + idx + 1}</td>
      <td style="white-space:nowrap">${fmtDate(e.date)}</td>
      <td>${dayName(e.date)}</td>
      <td><strong>${esc(facName(e.facilityId))}</strong>${e.note ? `<div class="note">📝 ${esc(e.note)}</div>` : ''}</td>
      <td class="num">${kg(e.boxKg)}</td>
      <td class="num">${kg(e.wasteKg)}</td>
      <td class="num"><strong>${kg(round2(e.boxKg + e.wasteKg))}</strong></td>
      <td class="num muted">${e.rate ? money(e.rate) : ''}</td>
      <td class="num"><strong>${money(e.amount)}</strong></td>
      <td>${esc(e.receivedBy)}</td>
      <td><span class="st ${e.status.toLowerCase()}">${esc(e.status)}</span></td>
      <td class="acts">
        <button class="tbtn" data-act="edit">Edit</button>
        <button class="tbtn danger" data-act="del">Delete</button>
      </td>
    </tr>`;
  }).join('');

  // Update header checkbox
  const chkAll = $('#reg-select-all');
  if (chkAll) {
    const allPageChecked = pageRows.length > 0 && pageRows.every(e => regState.selected.has(e.id));
    const somePageChecked = pageRows.some(e => regState.selected.has(e.id));
    chkAll.checked = allPageChecked;
    chkAll.indeterminate = !allPageChecked && somePageChecked;
  }

  // totals (filtered sum across all pages)
  const box = allRows.reduce((s, e) => s + e.boxKg, 0);
  const waste = allRows.reduce((s, e) => s + e.wasteKg, 0);
  const amt = allRows.reduce((s, e) => s + e.amount, 0);
  $('#reg-cnt').textContent = `${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`;
  $('#t-box').textContent = kg(round2(box));
  $('#t-waste').textContent = kg(round2(waste));
  $('#t-total').textContent = kg(round2(box + waste));
  $('#t-amount').textContent = money(round2(amt));

  // Pagination UI controls
  $('#reg-page-size').value = String(regState.pageSize);
  $('#reg-page-info').textContent = totalCount ? `Showing ${startIdx + 1}–${endIdx} of ${totalCount}` : 'Showing 0–0 of 0';
  $('#reg-pg-current').textContent = `Page ${regState.page} of ${totalPages}`;
  $('#reg-pg-prev').disabled = regState.page <= 1;
  $('#reg-pg-next').disabled = regState.page >= totalPages;

  updateBatchBar();
}

/* register events */
$('#reg-search').addEventListener('input', e => { regState.q = e.target.value; regState.page = 1; renderRegister(); });
$('#reg-range').addEventListener('change', e => {
  regState.range = e.target.value;
  regState.page = 1;
  $('#reg-custom').classList.toggle('hidden', regState.range !== 'custom');
  renderRegister();
});
$('#reg-from').addEventListener('change', e => { regState.from = e.target.value; regState.page = 1; renderRegister(); });
$('#reg-to').addEventListener('change', e => { regState.to = e.target.value; regState.page = 1; renderRegister(); });
$('#reg-facility').addEventListener('change', e => { regState.facility = e.target.value; regState.page = 1; renderRegister(); });
$('#reg-status').addEventListener('change', e => { regState.status = e.target.value; regState.page = 1; renderRegister(); });

$('#reg-page-size').addEventListener('change', e => {
  regState.pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value);
  regState.page = 1;
  renderRegister();
});
$('#reg-pg-prev').addEventListener('click', () => {
  if (regState.page > 1) { regState.page--; renderRegister(); }
});
$('#reg-pg-next').addEventListener('click', () => {
  regState.page++;
  renderRegister();
});

// Selection handling
$('#reg-select-all').addEventListener('change', e => {
  const allRows = filteredEntries();
  const isAll = regState.pageSize === 'all';
  const size = isAll ? Math.max(1, allRows.length) : Number(regState.pageSize || 20);
  const startIdx = isAll ? 0 : (regState.page - 1) * size;
  const pageRows = isAll ? allRows : allRows.slice(startIdx, startIdx + size);

  if (e.target.checked) {
    pageRows.forEach(r => regState.selected.add(r.id));
  } else {
    pageRows.forEach(r => regState.selected.delete(r.id));
  }
  renderRegister();
});

$('#reg-table').addEventListener('change', e => {
  if (e.target.classList.contains('reg-row-chk')) {
    const id = e.target.dataset.id;
    if (e.target.checked) regState.selected.add(id);
    else regState.selected.delete(id);
    renderRegister();
  }
});

$('#batch-clear-btn').addEventListener('click', () => {
  regState.selected.clear();
  renderRegister();
});

// Batch Delete
$('#batch-delete-btn').addEventListener('click', async () => {
  const ids = Array.from(regState.selected);
  if (!ids.length) return;
  const ok = await confirmDlg(`Delete ${ids.length} selected ${ids.length === 1 ? 'entry' : 'entries'}? This cannot be undone.`, 'Yes, delete all');
  if (!ok) return;

  const idSet = new Set(ids);
  state.entries = state.entries.filter(e => !idSet.has(e.id));
  const ops = ids.map(id => ({ type: 'entry_delete', id }));
  regState.selected.clear();
  commit(...ops);
  renderAll();
  if (isCloud()) await flushQueue();
  toast(`Deleted ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} ✓`);
});

// Batch Edit Dialog
$('#batch-edit-btn').addEventListener('click', () => {
  if (!regState.selected.size) return;
  $('#be-date').value = '';
  $('#be-status').value = '';
  $('#be-rate').value = '';
  $('#be-received').value = '';
  $('#be-note').value = '';
  $('#batch-edit-dialog').showModal();
});
$('#be-cancel').addEventListener('click', () => $('#batch-edit-dialog').close());

$('#batch-edit-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const ids = Array.from(regState.selected);
  if (!ids.length) { $('#batch-edit-dialog').close(); return; }

  const newDate = $('#be-date').value;
  const newStatus = $('#be-status').value;
  const rateVal = $('#be-rate').value.trim();
  const newRate = rateVal !== '' ? num(rateVal) : null;
  const receivedVal = $('#be-received').value.trim();
  const noteVal = $('#be-note').value.trim();

  if (!newDate && !newStatus && newRate === null && !receivedVal && !noteVal) {
    toast('No fields were changed', 'err');
    return;
  }

  const ops = [];
  let updatedCount = 0;
  state.entries = state.entries.map(e => {
    if (!regState.selected.has(e.id)) return e;
    const updated = { ...e };
    if (newDate) updated.date = newDate;
    if (newStatus) updated.status = newStatus;
    if (newRate !== null) {
      updated.rate = newRate;
      updated.amount = round2((updated.boxKg + updated.wasteKg) * newRate);
    }
    if (receivedVal) updated.receivedBy = receivedVal;
    if (noteVal) updated.note = noteVal;
    ops.push({ type: 'entry_upsert', entry: updated });
    updatedCount++;
    return updated;
  });

  commit(...ops);
  $('#batch-edit-dialog').close();
  regState.selected.clear();
  renderAll();
  if (isCloud()) await flushQueue();
  toast(`Updated ${updatedCount} ${updatedCount === 1 ? 'entry' : 'entries'} ✓`);
});

$('#reg-table').addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (th) {
    const k = th.dataset.sort;
    if (regState.sortKey === k) regState.sortDir *= -1;
    else { regState.sortKey = k; regState.sortDir = k === 'date' ? -1 : 1; }
    renderRegister();
    return;
  }
  const b = e.target.closest('button[data-act]');
  if (b) handleEntryAction(b.closest('tr').dataset.id, b.dataset.act);
});

/* ---------------- month end summary ---------------- */
const sumState = { month: monthKeyOf(), mode: 'facility' };

function renderSummary() {
  $('#sum-month').value = sumState.month;
  const [from, to] = monthRangeOf(sumState.month);
  const list = state.entries.filter(e => e.date >= from && e.date <= to);
  const label = monthLabel(sumState.month);
  $('#sum-title').textContent = `Month Report — ${label} (${sumState.mode === 'facility' ? 'per business, A–Z' : 'per day'})`;

  const box = list.reduce((s, e) => s + e.boxKg, 0);
  const waste = list.reduce((s, e) => s + e.wasteKg, 0);
  const total = box + waste;
  const amt = list.reduce((s, e) => s + e.amount, 0);
  const days = new Set(list.map(e => e.date));
  $('#sum-kg').textContent = kg(round2(total));
  $('#sum-box').textContent = kg(round2(box));
  $('#sum-waste').textContent = kg(round2(waste));
  $('#sum-amt').textContent = money(round2(amt));
  $('#sum-entries').textContent = list.length;
  $('#sum-facs').textContent = new Set(list.map(e => e.facilityId)).size;
  $('#sum-avg').textContent = days.size ? kg(round2(total / days.size)) : '0';

  let head, body, totals;
  if (sumState.mode === 'facility') {
    const map = new Map();
    list.forEach(e => {
      const k = e.facilityId;
      if (!map.has(k)) map.set(k, { name: facName(k), n: 0, box: 0, waste: 0, amt: 0 });
      const g = map.get(k);
      g.n++; g.box += e.boxKg; g.waste += e.wasteKg; g.amt += e.amount;
    });
    const groups = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    head = ['S/N', 'Business', 'Entries', 'Box kg', 'Waste kg', 'Total kg', 'Amount'];
    body = groups.map((g, i) => [i + 1, esc(g.name), g.n, kg(round2(g.box)), kg(round2(g.waste)), `<strong>${kg(round2(g.box + g.waste))}</strong>`, `<strong>${money(round2(g.amt))}</strong>`]);
    totals = ['', 'TOTAL', list.length, kg(round2(box)), kg(round2(waste)), kg(round2(total)), money(round2(amt))];
    sumState.lastTable = groups.map(g => [g.name, g.n, round2(g.box), round2(g.waste), round2(g.box + g.waste), round2(g.amt)]);
    sumState.lastHead = ['Business', 'Entries', 'Box KG', 'Waste KG', 'Total KG', 'Amount'];
  } else {
    const map = new Map();
    list.forEach(e => {
      if (!map.has(e.date)) map.set(e.date, { n: 0, box: 0, waste: 0, amt: 0 });
      const g = map.get(e.date);
      g.n++; g.box += e.boxKg; g.waste += e.wasteKg; g.amt += e.amount;
    });
    const groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    head = ['Date', 'Day', 'Entries', 'Box kg', 'Waste kg', 'Total kg', 'Amount'];
    body = groups.map(([date, g]) => [fmtDate(date), dayName(date, true), g.n, kg(round2(g.box)), kg(round2(g.waste)), `<strong>${kg(round2(g.box + g.waste))}</strong>`, `<strong>${money(round2(g.amt))}</strong>`]);
    totals = ['TOTAL', '', list.length, kg(round2(box)), kg(round2(waste)), kg(round2(total)), money(round2(amt))];
    sumState.lastTable = groups.map(([date, g]) => [date, dayName(date, true), g.n, round2(g.box), round2(g.waste), round2(g.box + g.waste), round2(g.amt)]);
    sumState.lastHead = ['Date', 'Day', 'Entries', 'Box KG', 'Waste KG', 'Total KG', 'Amount'];
  }

  const wrap = $('#sum-table-wrap');
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">No entries in ${label}.<br>Add entries in “New Entry”, then come back here.</div>`;
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr>${head.map(h => `<th${['Box kg','Waste kg','Total kg','Amount','Entries'].includes(h) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
    <tbody>${body.map(r => `<tr>${r.map((c, i) => `<td${i >= 2 ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr>${totals.map((c, i) => `<td${i >= 2 ? ' class="num"' : ''}><strong>${c}</strong></td>`).join('')}</tr></tfoot>
  </table>`;
}
$('#sum-prev').addEventListener('click', () => { sumState.month = shiftMonth(sumState.month, -1); renderSummary(); });
$('#sum-next').addEventListener('click', () => { sumState.month = shiftMonth(sumState.month, 1); renderSummary(); });
$('#sum-month').addEventListener('change', e => { if (e.target.value) { sumState.month = e.target.value; renderSummary(); } });
$('#sum-mode-facility').addEventListener('click', () => { sumState.mode = 'facility'; setSumMode(); renderSummary(); });
$('#sum-mode-day').addEventListener('click', () => { sumState.mode = 'day'; setSumMode(); renderSummary(); });
function setSumMode() {
  $('#sum-mode-facility').classList.toggle('active', sumState.mode === 'facility');
  $('#sum-mode-day').classList.toggle('active', sumState.mode === 'day');
}

/* ---------------- facilities ---------------- */
function facStats() {
  const map = new Map();
  state.entries.forEach(e => {
    if (!map.has(e.facilityId)) map.set(e.facilityId, { n: 0, kg: 0, amt: 0, last: '' });
    const g = map.get(e.facilityId);
    g.n++; g.kg += e.boxKg + e.wasteKg; g.amt += e.amount;
    if (e.date > g.last) g.last = e.date;
  });
  return map;
}
function renderFacilities() {
  const q = $('#fac-search').value.trim().toLowerCase();
  const stats = facStats();
  const list = sortedFacs().filter(f =>
    !q || f.name.toLowerCase().includes(q) || (f.category || '').toLowerCase().includes(q));

  const wrap = $('#fac-list');
  if (!list.length) {
    wrap.innerHTML = `<div class="empty">${q ? 'No businesses match your search.' : 'No businesses yet.<br>Click “Add New Business”, or just type a new name when writing an entry.'}</div>`;
    return;
  }
  let letter = '', html = '';
  list.forEach(f => {
    const L = (f.name[0] || '#').toUpperCase();
    if (L !== letter) { letter = L; html += `<h3 class="letter">${esc(L)}</h3>`; }
    const s = stats.get(f.id) || { n: 0, kg: 0, amt: 0, last: '' };
    html += `
      <div class="fac-row" data-id="${f.id}">
        <div class="fac-main"><strong>${esc(f.name)}</strong><small>${esc(f.category || '—')}</small></div>
        <div class="fac-stats">
          <span><b>${s.n}</b> entries</span>
          <span><b>${kg(round2(s.kg))}</b> kg</span>
          <span><b>${money(round2(s.amt))}</b></span>
          <span>last: <b>${s.last ? fmtDate(s.last) : '—'}</b></span>
        </div>
        <div class="fac-actions">
          <button class="tbtn" data-act="edit">Edit</button>
          <button class="tbtn danger" data-act="del">Delete</button>
        </div>
      </div>`;
  });
  wrap.innerHTML = html;
}
$('#fac-search').addEventListener('input', renderFacilities);
$('#fac-add').addEventListener('click', () => openFacDialog(null));
$('#fac-clean-empty').addEventListener('click', async () => {
  const unused = state.facilities.filter(f => !state.entries.some(e => e.facilityId === f.id));
  if (!unused.length) {
    toast('No unused (0.0) businesses found', 'ok');
    return;
  }
  const ok = await confirmDlg(`Remove ${unused.length} unused ${unused.length === 1 ? 'business' : 'businesses'} with 0 entries?`, 'Yes, clean up');
  if (!ok) return;
  const ops = unused.map(f => ({ type: 'facility_delete', id: f.id }));
  state.facilities = state.facilities.filter(f => state.entries.some(e => e.facilityId === f.id));
  commit(...ops);
  renderAll();
  if (isCloud()) await flushQueue();
  toast(`Cleaned up ${unused.length} unused business${unused.length === 1 ? '' : 'es'} ✓`);
});

let editingFac = null;
function openFacDialog(fac) {
  editingFac = fac;
  $('#fac-dialog-title').textContent = fac ? 'Edit Business' : 'Add Business';
  $('#fac-name').value = fac ? fac.name : '';
  $('#fac-category').value = fac ? (fac.category || '') : '';
  $('#fac-dialog').showModal();
  $('#fac-name').focus();
}
$('#fac-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#fac-name').value.trim();
  if (!name) { toast('Business name is required', 'err'); return; }
  const dupe = state.facilities.find(f => f.name.toLowerCase() === name.toLowerCase() && f.id !== (editingFac && editingFac.id));
  if (dupe) { toast('A business with this name already exists', 'err'); return; }
  const category = $('#fac-category').value.trim();
  if (editingFac) {
    editingFac.name = name; editingFac.category = category;
    toast('Business updated ✓');
  } else {
    state.facilities.push({ id: uid(), name, category, createdAt: new Date().toISOString() });
    toast(`Business added: ${name} ✓`);
  }
  commit({ type: 'facility_upsert', facility: editingFac || state.facilities[state.facilities.length - 1] });
  renderAll();
  $('#fac-dialog').close();
});
$('#fac-cancel').addEventListener('click', () => $('#fac-dialog').close());

$('#fac-list').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('.fac-row').dataset.id;
  const fac = state.facilities.find(f => f.id === id);
  if (!fac) return;
  if (b.dataset.act === 'edit') openFacDialog(fac);
  else {
    const count = state.entries.filter(en => en.facilityId === id).length;
    if (count > 0) { toast(`Cannot delete “${fac.name}” — it has ${count} logged ${count === 1 ? 'entry' : 'entries'}.`, 'err'); return; }
    const ok = await confirmDlg(`Delete business “${fac.name}”? It has no entries.`, 'Yes, delete it');
    if (!ok) return;
    state.facilities = state.facilities.filter(f => f.id !== id);
    commit({ type: 'facility_delete', id });
    renderAll(); toast('Business deleted');
  }
});

/* ---------------- CSV / backup / print ---------------- */
function csvOf(rows) {
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
const csvCell = v => {
  v = String(v ?? '');
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
function download(name, content, type) {
  const blob = new Blob([content], { type: type || 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}
function entriesRows(list) {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''))
    .map((e, i) => [i + 1, e.date, dayName(e.date), facName(e.facilityId), e.boxKg, e.wasteKg, round2(e.boxKg + e.wasteKg), e.rate, e.amount, e.receivedBy, e.status, e.note || '']);
}
function entriesCsv(list) {
  const head = ['S/N', 'Date', 'Day', 'Business', 'Box KG', 'Waste KG', 'Total KG', 'Rate', 'Amount', 'Received By', 'Status', 'Notes'];
  return csvOf([head, ...entriesRows(list)]);
}
function monthEntries() {
  const [from, to] = monthRangeOf(sumState.month);
  return state.entries.filter(e => e.date >= from && e.date <= to);
}

$('#reg-export').addEventListener('click', () => {
  const rows = filteredEntries();
  if (!rows.length) { toast('Nothing to export — no entries match the current filters', 'err'); return; }
  download(`wastelog-entries-${todayStr()}.csv`, entriesCsv(rows));
  toast(`CSV downloaded — ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`);
});
$('#sum-export').addEventListener('click', () => {
  const label = monthLabel(sumState.month);
  if (!monthEntries().length) { toast('No entries for this month', 'err'); return; }
  download(`wastelog-summary-${sumState.month}.csv`, summaryCsv());
  toast(`Report CSV downloaded — ${label}`);
});

/* ---------------- WhatsApp sharing ---------------- */
function summaryCsv() {
  const rows = [sumState.lastHead, ...sumState.lastTable];
  // totals row: sum every numeric column of the current summary table
  if (sumState.lastTable.length) {
    const rows2 = sumState.lastTable;
    const totals = sumState.lastHead.map((h, i) => {
      if (i === 0) return 'TOTAL';
      if (rows2.every(r => typeof r[i] === 'number')) return round2(rows2.reduce((s, r) => s + r[i], 0));
      return '';
    });
    rows.push(totals);
  }
  return csvOf(rows);
}

/** Share a CSV file through the phone's share menu (WhatsApp, etc.).
 *  Works on Android + iOS. Falls back to a plain download on desktop. */
async function shareCsvFile(fileName, csv, title) {
  const file = new File([csv], fileName, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      toast('Shared ✓');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // user closed the share menu
      /* real share error → fall through to download */
    }
  }
  download(fileName, csv);
  toast('This device cannot share files directly — CSV downloaded instead. You can attach it in WhatsApp Web.', 'err');
}

function summaryText() {
  const list = monthEntries();
  const totalKg = list.reduce((s, e) => s + e.boxKg + e.wasteKg, 0);
  const amt = list.reduce((s, e) => s + e.amount, 0);
  const facs = new Set(list.map(e => e.facilityId)).size;
  return `Waste Log — ${monthLabel(sumState.month)}\n` +
         `Collected: ${kg(round2(totalKg))} kg from ${facs} businesses (${list.length} entries)\n` +
         `Amount: ${money(round2(amt))}`;
}

/** "0803 123 4567" / "+234803..." / "234803..." → "2348031234567" */
function waNumber(raw) {
  let d = String(raw).replace(/[^\d]/g, '');
  if (/^0\d{10}$/.test(d)) d = '234' + d.slice(1);   // Nigerian local format → country code
  return d;
}

$('#reg-share').addEventListener('click', () => {
  const rows = filteredEntries();
  if (!rows.length) { toast('Nothing to send — no entries match the current filters', 'err'); return; }
  shareCsvFile(`wastelog-entries-${todayStr()}.csv`, entriesCsv(rows), 'Waste Log entries');
});
$('#sum-share').addEventListener('click', () => {
  if (!monthEntries().length) { toast('No entries for this month', 'err'); return; }
  shareCsvFile(`wastelog-summary-${sumState.month}.csv`, summaryCsv(), 'Waste Log month report');
});
$('#wa-form').addEventListener('submit', e => {
  e.preventDefault();
  const d = waNumber($('#wa-number').value);
  if (d.length < 10) { toast('Enter a valid WhatsApp number, e.g. 0803 123 4567', 'err'); return; }
  window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(summaryText()), '_blank');
  toast('Opening their WhatsApp chat…');
});
$('#sum-export-entries').addEventListener('click', () => {
  const rows = monthEntries();
  if (!rows.length) { toast('No entries for this month', 'err'); return; }
  download(`wastelog-entries-${sumState.month}.csv`, entriesCsv(rows));
  toast(`Entries CSV downloaded — ${monthLabel(sumState.month)}`);
});
$('#csv-all').addEventListener('click', () => {
  if (!state.entries.length) { toast('No entries to export yet', 'err'); return; }
  download(`wastelog-entries-all-${todayStr()}.csv`, entriesCsv(state.entries));
  toast('All-entries CSV downloaded');
});
$('#csv-facilities').addEventListener('click', () => {
  if (!state.facilities.length) { toast('No facilities to export yet', 'err'); return; }
  const stats = facStats();
  const rows = [['Business', 'Kind', 'Entries', 'Total KG', 'Total Amount', 'Last Entry']];
  sortedFacs().forEach(f => {
    const s = stats.get(f.id) || { n: 0, kg: 0, amt: 0, last: '' };
    rows.push([f.name, f.category || '', s.n, round2(s.kg), round2(s.amt), s.last]);
  });
  download(`wastelog-facilities-${todayStr()}.csv`, csvOf(rows));
  toast('Facilities CSV downloaded');
});

$('#backup-export').addEventListener('click', () => {
  download(`wastelog-backup-${todayStr()}.json`,
    JSON.stringify({ app: 'WasteLog', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2),
    'application/json');
  toast('Backup downloaded — keep it somewhere safe!');
});
$('#backup-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.facilities) || !Array.isArray(data.entries)) throw new Error('bad file');
      const ok = await confirmDlg(`Restore backup? This replaces everything currently in the log book with the backup from ${file.name}.`, 'Yes, restore it');
      if (!ok) return;
      state = { facilities: data.facilities, entries: data.entries, settings: Object.assign({}, DEFAULT_SETTINGS, data.settings || {}) };
      saveQueue([]);
      commit(replaceAllOp());
      resetForm();
      sumState.month = monthKeyOf();
      renderAll();
      toast('Backup restored ✓');
    } catch (err) {
      console.error(err);
      toast('That file is not a valid WasteLog backup', 'err');
    }
  };
  reader.readAsText(file);
});

function setPrintHeader(title) {
  const c = state.settings.company || 'WasteLog';
  $('#print-header').innerHTML = `<strong>${esc(c)}</strong> — ${esc(title)}<br><small>Printed ${new Date().toLocaleString('en-GB')}</small>`;
}
$('#reg-print').addEventListener('click', () => {
  renderRegister();
  setPrintHeader(`Log Book — ${regLabel()} — sorted by ${regState.sortKey === 'name' ? 'facility name' : regState.sortKey}`);
  window.print();
});
$('#sum-print').addEventListener('click', () => {
  setPrintHeader(`Month End Summary — ${monthLabel(sumState.month)} (${sumState.mode === 'facility' ? 'by facility' : 'by day'})`);
  window.print();
});

/* ---------------- settings ---------------- */
function updateBrand() {
  $('#brand-sub').textContent = state.settings.company || 'Kilograms of waste collected from businesses';
}
const commitSettingsSoon = (() => {
  let t;
  return () => { clearTimeout(t); t = setTimeout(() => commit({ type: 'settings_save', settings: state.settings }), 700); };
})();
function renderSettings() {
  $('#set-company').value = state.settings.company;
  $('#set-rate').value = state.settings.rate;
  $('#set-currency').value = state.settings.currency;
  $('#set-remember').checked = state.settings.rememberReceivedBy;
  renderUsers();   // staff list only loads in cloud mode for admins
}
$('#set-company').addEventListener('input', e => { state.settings.company = e.target.value.trim(); commitSettingsSoon(); updateBrand(); });
$('#set-rate').addEventListener('change', e => {
  state.settings.rate = Math.max(0, num(e.target.value));
  commitSettingsSoon();
  if (!editingId) { $('#f-rate').value = state.settings.rate; recalc(); }
  toast('Default rate updated');
});
$('#set-currency').addEventListener('input', e => {
  state.settings.currency = e.target.value || '₦';
  commitSettingsSoon(); renderAll();
});
$('#set-remember').addEventListener('change', e => { state.settings.rememberReceivedBy = e.target.checked; commitSettingsSoon(); });

$('#clear-all').addEventListener('click', async () => {
  const ok = await confirmDlg('Delete ALL businesses and entries? This cannot be undone. Download a backup first!', 'Yes, delete everything');
  if (!ok) return;
  state = freshState();
  saveQueue([]);
  commit(replaceAllOp());
  resetForm(); sumState.month = monthKeyOf(); renderAll();
  toast('All data deleted');
});

/* ---------------- sample data ---------------- */
$('#sample-load').addEventListener('click', async () => {
  if (state.entries.length) {
    const ok = await confirmDlg('This adds example entries on top of your current data. Continue?', 'Yes, add samples');
    if (!ok) return;
  }
  loadSampleData();
});

function loadSampleData() {
  const now = new Date();
  const dayCap = now.getDate();
  const facDefs = [
    ['B-Rock Hospital', 'Hospital'], ['Dr Lab', 'Laboratory'], ['Adebayo Specialist', 'Hospital'],
    ['St Mary Hospital', 'Hospital'], ['Dream Lab', 'Laboratory'], ['Blueshore Hospital', 'Hospital'],
    ['Blue Sky Hospital', 'Hospital'], ['Maedonant Hospital', 'Hospital'], ['Healing Vessel', 'Hospital'],
    ['Nikad Hospital', 'Hospital'], ['Afrique Hospital', 'Hospital'], ["O'Kem Lab", 'Laboratory']
  ];
  const ids = facDefs.map(([name, category]) => {
    let f = state.facilities.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!f) { f = { id: uid(), name, category, createdAt: new Date().toISOString() }; state.facilities.push(f); }
    return f.id;
  });
  const receivers = ['Sofiat', 'Grace', 'Precious', 'Zainab', 'Celestina', 'Tola'];
  // [facIndex, day, boxKg, wasteKg]
  const rows = [
    [0, 3, 6, 10], [1, 4, 1, 3], [2, 5, 10, 36], [2, 5, 24, 0], [4, 6, 2, 6],
    [6, 7, 6, 20], [11, 7, 0, 6], [7, 10, 2, 2], [8, 5, 0, 8], [8, 12, 2, 8],
    [9, 9, 1, 4], [10, 16, 8, 0], [11, 18, 4, 0], [3, 20, 5, 5], [5, 22, 3, 3]
  ];
  rows.forEach(([fi, day, box, waste], i) => {
    const d = Math.min(day, dayCap);
    const date = `${monthKeyOf(now)}-${String(d).padStart(2, '0')}`;
    const total = box + waste;
    state.entries.push({
      id: uid(), date, facilityId: ids[fi], boxKg: box, wasteKg: waste,
      rate: state.settings.rate, amount: round2(total * state.settings.rate),
      receivedBy: receivers[i % receivers.length], status: 'Paid', note: '',
      createdAt: new Date(date + 'T10:0' + (i % 10) + ':00').toISOString()
    });
  });
  saveQueue([]);
  commit(replaceAllOp());
  resetForm(); renderAll();
  toast('Example entries loaded ✓');
}

/* ---------------- boot ---------------- */
function renderAll() {
  renderStats();
  renderRecent();
  renderRegister();
  renderSummary();
  renderFacilities();
  updateBrand();
  $$('.cur-sym').forEach(el => el.textContent = state.settings.currency);
}

$('#tabs').addEventListener('click', e => {
  const t = e.target.closest('.maintab');
  if (t) switchView(t.dataset.view);
});

function showLoginScreen() { $('#login-screen').hidden = false; }

function enterApp() {
  $('#login-screen').hidden = true;
  updateAuthUI();
  renderAll();
  switchView('entry');
  if (document.activeElement) document.activeElement.blur();
}

async function bootCloud() {
  await flushQueue();                       // push anything saved while offline
  try {
    const out = await cloudCall('getData');
    if (out && out.ok && out.data) {
      state.facilities = out.data.facilities || [];
      state.entries = out.data.entries || [];
      state.settings = Object.assign({}, DEFAULT_SETTINGS, out.data.settings || {});
      saveState();
      resetForm();
      $('#sum-month').value = sumState.month = monthKeyOf();
    }
  } catch (e) {
    if (e && e.message === 'AUTH') return;  // login screen already showing
    toast('Working offline — changes will sync when the connection returns', 'err');
  }
  enterApp();
}

function updateAuthUI() {
  const s = getSession();
  $('#logout-link').hidden = !isCloud();
  if (isCloud() && s) $('#logout-link').textContent = 'Log out — ' + s.name;
  $('#open-settings').hidden = !isAdmin();
  if (!isAdmin() && !$('#view-settings').hidden) switchView('entry');
  $('#staff-panel').hidden = !(isCloud() && isAdmin());
}

function doLogout() { setSession(null); showLoginScreen(); }
$('#logout-link').addEventListener('click', doLogout);

/* ---------------- staff & access (admin, cloud mode) ---------------- */
async function renderUsers() {
  if (!isCloud() || !isAdmin()) return;
  const body = $('#users-body');
  body.innerHTML = '<tr><td>Loading…</td></tr>';
  try {
    const out = await cloudCall('listUsers');
    if (!out.ok) { body.innerHTML = `<tr><td class="muted">${esc(out.error || 'Error loading users')}</td></tr>`; return; }
    body.innerHTML = out.users.map(u => `
      <tr data-email="${esc(u.email)}">
        <td><strong>${esc(u.name)}</strong><br><small>${esc(u.email)}</small></td>
        <td class="muted">${u.role === 'admin' ? 'Administrator' : 'Staff'}</td>
        <td class="acts">${u.email === getSession().email ? '<small>you</small>' : `<button class="tbtn danger" data-email="${esc(u.email)}">Remove</button>`}</td>
      </tr>`).join('');
  } catch (e) {
    body.innerHTML = '<tr><td class="muted">Could not reach the log book — check the connection.</td></tr>';
  }
}
$('#users-body').addEventListener('click', async e => {
  const b = e.target.closest('button[data-email]');
  if (!b) return;
  const ok = await confirmDlg(`Remove access for ${b.dataset.email}? They will be signed out everywhere.`, 'Yes, remove access');
  if (!ok) return;
  const out = await cloudCall('deleteUser', { email: b.dataset.email });
  if (!out.ok) { toast(out.error || 'Could not remove that user', 'err'); return; }
  toast('Access removed');
  renderUsers();
});
$('#user-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#u-name').value.trim(), email = $('#u-email').value.trim().toLowerCase(), pass = $('#u-pass').value;
  if (pass.length < 6) { toast('Password must be at least 6 characters', 'err'); return; }
  const out = await cloudCall('addUser', { name, email, password: pass, role: 'staff' });
  if (!out.ok) { toast(out.error || 'Could not add that staff account', 'err'); return; }
  $('#u-name').value = $('#u-email').value = $('#u-pass').value = '';
  toast(`Staff account created for ${name} ✓`);
  renderUsers();
});

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login-btn'), err = $('#login-error');
  err.hidden = true;
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const out = await cloudCall('login', { email: $('#l-email').value.trim(), password: $('#l-password').value });
    if (!out.ok) throw new Error(out.error || 'Could not sign in');
    setSession({ token: out.token, email: out.email, name: out.name, role: out.role });
    $('#l-password').value = '';
    await bootCloud();
    toast(`Welcome, ${out.name}!`);
  } catch (ex) {
    err.textContent = (ex.message === 'AUTH') ? 'Your session expired — please sign in again.' : (ex.message || 'Could not sign in. Check the connection and try again.');
    err.hidden = false;
  }
  btn.disabled = false; btn.textContent = 'Sign In';
});

resetForm();
sumState.month = monthKeyOf();
$('#sum-month').value = sumState.month;
renderAll();

if (isCloud()) {
  const sess = getSession();
  if (sess && sess.token) bootCloud(); else showLoginScreen();
} else {
  enterApp();
}

if (!state.settings.welcomed) {
  state.settings.welcomed = true;
  saveState();
  if (!state.entries.length && !isCloud()) {
    setTimeout(() => toast('Welcome! Open “Settings & Backup” (top right) to load example entries and try it out.'), 600);
  }
}
