/**
 * ============================================================
 *  THE WASTE LOG BOOK — Google Sheets backend (Apps Script)
 * ============================================================
 *  Where the data lives: this spreadsheet (your Google Drive).
 *
 *  SETUP — see SHEETS-SETUP.md for the illustrated version:
 *  1. Edit the two values below (your owner login).
 *  2. Save, run the function `setup` once, approve permissions.
 *  3. Deploy → New deployment → Web app
 *       Execute as: Me      Who has access: Anyone
 *  4. Copy the /exec URL into the website (app.js → CONFIGURED_SCRIPT_URL).
 * ============================================================
 */

// ★★★ CHANGE THESE BEFORE THE FIRST RUN ★★★
const ADMIN_NAME     = 'Owner';
const ADMIN_EMAIL    = 'owner@example.com';   // ← your email
const ADMIN_PASSWORD = 'change-me-123';       // ← pick a password (6+ characters)
// ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

const TOKEN_DAYS = 30;

const SHEETS = {
  Entries:    ['id','date','facilityId','boxKg','wasteKg','rate','amount','receivedBy','status','note','createdAt'],
  Facilities: ['id','name','category','createdAt'],
  Settings:   ['key','value'],
  Users:      ['email','name','role','passHash','salt','createdAt'],
  Tokens:     ['token','email','expiresAt'],
};

/* ---------------- infrastructure ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
  const head = SHEETS[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  }
  // Text format for every data cell so IDs and dates never get mangled by Sheets.
  ensureRows_(sh);
  sh.getRange(2, 1, sh.getMaxRows() - 1, head.length).setNumberFormat('@');
  return sh;
}

function ensureRows_(sh) {
  if (sh.getMaxRows() < 100) sh.insertRowsAfter(sh.getMaxRows(), 100 - sh.getMaxRows());
}

function read_(name) {
  const sh = sheet_(name);
  const head = SHEETS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, head.length).getValues()
    .filter(r => String(r[0]) !== '')
    .map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
}

function write_(name, objects) {
  const sh = sheet_(name);
  const head = SHEETS[name];
  sh.getRange(2, 1, sh.getMaxRows() - 1, head.length).clearContent();
  ensureRows_(sh);
  if (objects.length) {
    if (objects.length + 1 > sh.getMaxRows()) {
      sh.insertRowsAfter(sh.getMaxRows(), objects.length + 2 - sh.getMaxRows());
    }
    const rows = objects.map(o => head.map(h => o[h] === undefined ? '' : o[h]));
    sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  }
}

function hash_(pw, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw);
  return raw.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- one-time setup ---------------- */

/** Run this ONCE from the Apps Script editor (Run ▸ setup). */
function setup() {
  Object.keys(SHEETS).forEach(n => sheet_(n));
  const users = read_('Users');
  const email = ADMIN_EMAIL.toLowerCase();
  if (!users.some(u => String(u.email).toLowerCase() === email)) {
    const salt = Utilities.getUuid();
    users.push({ email, name: ADMIN_NAME, role: 'admin', passHash: hash_(ADMIN_PASSWORD, salt), salt, createdAt: new Date().toISOString() });
    write_('Users', users);
  }
}

/* ---------------- web app entry point ---------------- */

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    switch (req.action) {
      case 'login':      return json_(login_(req));
      case 'getData':    return json_(auth_(req, () => ({ ok: true, data: allData_() })));
      case 'mutate':     return json_(auth_(req, () => { applyOps_(req.ops || []); return { ok: true }; }));
      case 'listUsers':  return json_(auth_(req, u => admin_(u) ? { ok: true, users: read_('Users').map(publicUser_) } : { ok: false, error: 'Only administrators can do that' }));
      case 'addUser':    return json_(auth_(req, u => admin_(u) ? addUser_(req)      : { ok: false, error: 'Only administrators can do that' }));
      case 'deleteUser': return json_(auth_(req, u => admin_(u) ? deleteUser_(req)   : { ok: false, error: 'Only administrators can do that' }));
      default:           return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  return json_({ ok: true, app: 'The Waste Log Book — backend is running' });
}

/* ---------------- auth ---------------- */

function auth_(req, fn) {
  const t = read_('Tokens').find(t => String(t.token) === String(req.token));
  if (!t || new Date(t.expiresAt) < new Date()) return { ok: false, error: 'AUTH' };
  const user = read_('Users').find(u => String(u.email).toLowerCase() === String(t.email).toLowerCase());
  if (!user) return { ok: false, error: 'AUTH' };
  return fn(user);
}

const admin_ = u => String(u.role) === 'admin';

function login_(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const u = read_('Users').find(u => String(u.email).toLowerCase() === email);
  if (!u || hash_(String(req.password || ''), String(u.salt)) !== String(u.passHash)) {
    return { ok: false, error: 'Wrong email or password' };
  }
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const expiresAt = new Date(Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const tokens = read_('Tokens');
  tokens.push({ token, email, expiresAt });
  write_('Tokens', tokens);
  return { ok: true, token, email, name: String(u.name), role: String(u.role) };
}

function publicUser_(u) {
  return {
    email: String(u.email).toLowerCase(),
    name: String(u.name),
    role: String(u.role),
    createdAt: String(u.createdAt)
  };
}

function addUser_(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const name = String(req.name || '').trim();
  const password = String(req.password || '');
  const role = (req.role === 'admin') ? 'admin' : 'staff';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'That email does not look right' };
  if (password.length < 6)                       return { ok: false, error: 'Password must be at least 6 characters' };
  const users = read_('Users');
  if (users.some(u => String(u.email).toLowerCase() === email)) return { ok: false, error: 'A user with that email already exists' };
  const salt = Utilities.getUuid();
  users.push({ email, name, role, passHash: hash_(password, salt), salt, createdAt: new Date().toISOString() });
  write_('Users', users);
  return { ok: true };
}

function deleteUser_(req) {
  const email = String(req.email || '').toLowerCase();
  const me = String((read_('Tokens').find(t => String(t.token) === String(req.token)) || {}).email || '').toLowerCase();
  if (email === me) return { ok: false, error: 'You cannot remove your own access' };
  write_('Users', read_('Users').filter(u => String(u.email).toLowerCase() !== email));
  write_('Tokens', read_('Tokens').filter(t => String(t.email).toLowerCase() !== email));
  return { ok: true };
}

/* ---------------- data ---------------- */

function allData_() {
  return {
    entries: read_('Entries').map(normalizeEntry_),
    facilities: read_('Facilities').map(normalizeFac_),
    settings: settings_(),
  };
}

function settings_() {
  const rows = read_('Settings');
  if (!rows.length) return {};
  try { return JSON.parse(rows[0].value) || {}; } catch (e) { return {}; }
}

function normalizeEntry_(e) {
  return {
    id: String(e.id),
    date: String(e.date).slice(0, 10),
    facilityId: String(e.facilityId),
    boxKg: Number(e.boxKg) || 0,
    wasteKg: Number(e.wasteKg) || 0,
    rate: Number(e.rate) || 0,
    amount: Number(e.amount) || 0,
    receivedBy: String(e.receivedBy || ''),
    status: String(e.status || 'Paid'),
    note: String(e.note || ''),
    createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString(),
  };
}

function normalizeFac_(f) {
  return {
    id: String(f.id),
    name: String(f.name || ''),
    category: String(f.category || ''),
    createdAt: f.createdAt ? new Date(f.createdAt).toISOString() : new Date().toISOString(),
  };
}

function applyOps_(ops) {
  let entries = read_('Entries');
  let facilities = read_('Facilities');
  let settings = settings_();
  let settingsChanged = false;

  for (const op of ops) {
    switch (op.type) {
      case 'entry_upsert': {
        const e = normalizeEntry_(op.entry);
        const i = entries.findIndex(x => String(x.id) === String(e.id));
        if (i > -1) entries[i] = e; else entries.push(e);
        break;
      }
      case 'entry_delete':
        entries = entries.filter(x => String(x.id) !== String(op.id));
        break;
      case 'facility_upsert': {
        const f = normalizeFac_(op.facility);
        const i = facilities.findIndex(x => String(x.id) === String(f.id));
        if (i > -1) facilities[i] = f; else facilities.push(f);
        break;
      }
      case 'facility_delete':
        facilities = facilities.filter(x => String(x.id) !== String(op.id));
        break;
      case 'settings_save':
        settings = op.settings || {};
        settingsChanged = true;
        break;
      case 'replace_all':
        entries = (op.entries || []).map(normalizeEntry_);
        facilities = (op.facilities || []).map(normalizeFac_);
        if (op.settings) { settings = op.settings; settingsChanged = true; }
        break;
    }
  }

  write_('Entries', entries);
  write_('Facilities', facilities);
  if (settingsChanged) write_('Settings', [{ key: 'settings', value: JSON.stringify(settings) }]);
}
