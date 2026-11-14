/* NEXORA Studio accounts server (Google Apps Script, bound to a Google Sheet).
   Paste this into Extensions > Apps Script in a new Google Sheet, then Deploy > New deployment > Web app:
   Execute as: Me. Who has access: Anyone. Copy the /exec address into NEXORA.

   What is stored: e-mail, display name, and a hash of a key derived from the password on the user's computer. The password itself
   never reaches this script. Do not share this Sheet: it holds e-mail addresses and 2FA secrets. */
var VERSION = 1, DAILY_MAIL_CAP = 80, SESSION_DAYS = 30, CODE_MINUTES = 10, RESEND_SECONDS = 45;
var USERS = ['id', 'email', 'name', 'title', 'prefs', 'salt', 'verifier', 'verified', 'created', 'lastLogin', 'fails', 'lockUntil', 'totpSecret', 'totpOn', 'totpStep', 'recovery', 'log'];
var SESSIONS = ['hash', 'uid', 'exp'], CODES = ['key', 'hash', 'exp', 'tries', 'sent', 'data'];

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function Fail_(message, code) { this.message = message; this.code = code; this.expose = true; }
function fail_(m, c) { throw new Fail_(m, c || 'error'); }
function doGet() { return json_({ ok: true, nexora: 'accounts', version: VERSION }); }
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (x) { return json_({ ok: false, error: 'The server is busy. Please try again.', code: 'busy' }); }
  try {
    var b = JSON.parse(e.postData.contents), fn = A_[b.action]; if (!fn) fail_('Unknown request.', 'bad_action');
    var r = fn(b) || {}; r.ok = true; return json_(r);
  } catch (x) { if (x && x.expose) return json_({ ok: false, error: x.message, code: x.code }); console.error(x); return json_({ ok: false, error: 'Something went wrong on the server.', code: 'server' }); }
  finally { lock.releaseLock(); }
}

/* ---------- storage ---------- */
/* works from a Sheet's own script, or from a stand-alone project (which then creates and remembers its own Sheet) */
function book_() { var a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; var p = PropertiesService.getScriptProperties(), id = p.getProperty('sheetId'); if (id) return SpreadsheetApp.openById(id); var made = SpreadsheetApp.create('NEXORA Studio Accounts'); p.setProperty('sheetId', made.getId()); return made; }
function sheet_(name, head) { var ss = book_(), s = ss.getSheetByName(name); if (!s) { s = ss.insertSheet(name); s.appendRow(head); s.setFrozenRows(1); } return s; }
function rows_(name, head) { var s = sheet_(name, head), v = s.getDataRange().getValues(), out = []; for (var i = 1; i < v.length; i++) { var o = { _row: i + 1 }; head.forEach(function (k, j) { o[k] = v[i][j]; }); out.push(o); } return out; }
/* a value starting with = + - @ would run as a formula in the Sheet */
function cell_(v) { if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v; return v === undefined || v === null ? '' : v; }
function write_(name, head, o) { sheet_(name, head).getRange(o._row, 1, 1, head.length).setValues([head.map(function (k) { return cell_(o[k]); })]); }
function add_(name, head, o) { sheet_(name, head).appendRow(head.map(function (k) { return cell_(o[k]); })); }
function del_(name, head, row) { sheet_(name, head).deleteRow(row); }
function byEmail_(email) { return rows_('Users', USERS).filter(function (u) { return String(u.email) === email; })[0] || null; }

/* ---------- crypto helpers ---------- */
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s))); }
function pepper_() { var p = PropertiesService.getScriptProperties(), v = p.getProperty('pepper'); if (!v) { v = sha_(Utilities.getUuid() + Utilities.getUuid()); p.setProperty('pepper', v); } return v; }
function seal_(s) { return 'h_' + sha_(pepper_() + '|' + s); }
function eq_(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function random_() { return sha_(Utilities.getUuid() + Utilities.getUuid() + Date.now()); }
function six_() { return ('00000' + (parseInt(random_().slice(0, 12), 16) % 1000000)).slice(-6); }

/* ---------- validation ---------- */
function email_(v) { var e = String(v || '').trim().toLowerCase(); if (e.length > 254 || !/^[^\s@"'<>,;:\\()\[\]]+@[^\s@"'<>,;:\\()\[\]]+\.[a-z]{2,}$/.test(e)) fail_('Enter a valid e-mail address.', 'bad_email'); return e; }
function key_(v) { var k = String(v || ''); if (!/^[0-9a-f]{64}$/.test(k)) fail_('Invalid request.', 'bad_key'); return k; }
function salt_(v) { var s = String(v || ''); if (!/^s_[0-9a-f]{32}$/.test(s)) fail_('Invalid request.', 'bad_key'); return s; }
function text_(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

/* ---------- mail ---------- */
function mail_(to, subject, body) {
  var day = 'mail:' + new Date().toISOString().slice(0, 10), p = PropertiesService.getScriptProperties(), n = +(p.getProperty(day) || 0);
  if (n >= DAILY_MAIL_CAP || MailApp.getRemainingDailyQuota() < 1) fail_('Too many e-mails were sent today. Please try again tomorrow.', 'mail_quota');
  MailApp.sendEmail({ to: to, subject: subject, body: body, name: 'NEXORA Studio' }); p.setProperty(day, String(n + 1));
}
function codeKey_(uid, purpose) { return purpose + ':' + uid; }
function sendCode_(u, purpose, subject, intro) {
  var key = codeKey_(u.id, purpose), now = Date.now(), old = rows_('Codes', CODES).filter(function (c) { return c.key === key; })[0];
  if (old && now - old.sent < RESEND_SECONDS * 1000) fail_('Please wait a moment before asking for another code.', 'cooldown');
  var code = six_(), rec = { key: key, hash: seal_(key + code), exp: now + CODE_MINUTES * 60000, tries: 0, sent: now, data: '' };
  mail_(u.email, subject, intro + '\n\n    ' + code + '\n\nThis code expires in ' + CODE_MINUTES + ' minutes. If you did not ask for it, you can ignore this message.\n\nNEXORA Studio');
  if (old) { rec._row = old._row; write_('Codes', CODES, rec); } else add_('Codes', CODES, rec);
}
function useCode_(u, purpose, code) {
  var key = codeKey_(u.id, purpose), c = rows_('Codes', CODES).filter(function (x) { return x.key === key; })[0];
  if (!c || c.exp < Date.now()) fail_('That code has expired. Ask for a new one.', 'code_expired');
  c.tries = +c.tries + 1;
  if (c.tries > 5) { del_('Codes', CODES, c._row); fail_('Too many wrong codes. Ask for a new one.', 'code_expired'); }
  if (!eq_(c.hash, seal_(key + String(code || '').trim()))) { write_('Codes', CODES, c); fail_('That code is not correct.', 'bad_code'); }
  del_('Codes', CODES, c._row);
}

/* ---------- accounts ---------- */
function checkLock_(u) { if (+u.lockUntil > Date.now()) fail_('Too many attempts. Try again in ' + Math.ceil((u.lockUntil - Date.now()) / 1000) + ' seconds.', 'locked'); }
function log_(u, ev, how, ok) { var l = []; try { l = JSON.parse(u.log || '[]'); } catch (x) { } l.unshift({ t: Date.now(), ev: ev, how: how || '', ok: ok !== false }); u.log = JSON.stringify(l.slice(0, 40)); }
function noteFail_(u, how) { u.fails = +u.fails + 1; if (u.fails >= 5) u.lockUntil = Date.now() + Math.min(900, 30 * Math.pow(2, u.fails - 5)) * 1000; log_(u, 'Failed sign-in', how, false); write_('Users', USERS, u); }
function pub_(u) { var p = {}, r = []; try { p = JSON.parse(u.prefs || '{}'); } catch (x) { } try { r = JSON.parse(u.recovery || '[]'); } catch (x) { } return { id: String(u.id), email: String(u.email), name: String(u.name), title: String(u.title || ''), avatar: '', created: +u.created, lastSignIn: +u.lastLogin || 0, emailVerified: !!u.verified, hasPassword: true, totp: !!u.totpOn, emailOtp: false, recoveryLeft: r.length, prefs: p, links: {} }; }
function session_(u, how) {
  var token = 't_' + random_() + random_().slice(0, 16), now = Date.now(); add_('Sessions', SESSIONS, { hash: seal_(token), uid: u.id, exp: now + SESSION_DAYS * 864e5 });
  u.fails = 0; u.lockUntil = 0; u.lastLogin = now; log_(u, 'Signed in', how); write_('Users', USERS, u); return { token: token, user: pub_(u) };
}
function me_(b) {
  var h = seal_(String(b.token || '')), now = Date.now(), s = rows_('Sessions', SESSIONS).filter(function (x) { return eq_(x.hash, h); })[0];
  if (!s || s.exp < now) fail_('Please sign in again.', 'signed_out');
  var u = rows_('Users', USERS).filter(function (x) { return String(x.id) === String(s.uid); })[0]; if (!u) fail_('Please sign in again.', 'signed_out'); u._session = s; return u;
}
function firstFactor_(u, how) {
  if (!u.totpOn) return session_(u, how);
  var ticket = 'k_' + random_(), key = codeKey_(ticket, '2fa'); add_('Codes', CODES, { key: key, hash: String(u.id), exp: Date.now() + 5 * 60000, tries: 0, sent: Date.now(), data: how });
  return { twoFactor: true, methods: ['totp', 'recovery'], ticket: ticket, hint: '' };
}
function issueRecovery_(u) { var list = []; for (var i = 0; i < 10; i++) { var r = random_().slice(0, 10).toUpperCase(); list.push(r.slice(0, 5) + '-' + r.slice(5)); } u.recovery = JSON.stringify(list.map(function (c) { return seal_(u.id + c.replace(/[^0-9A-F]/g, '')); })); return list; }
function useRecovery_(u, code) { var a = JSON.parse(u.recovery || '[]'), h = seal_(u.id + String(code || '').toUpperCase().replace(/[^0-9A-F]/g, '')), i = a.indexOf(h); if (i < 0) return false; a.splice(i, 1); u.recovery = JSON.stringify(a); return true; }

/* ---------- TOTP (RFC 6238) ---------- */
var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32_(hex) { var bits = '', o = ''; for (var i = 0; i < hex.length; i += 2) bits += ('0000000' + parseInt(hex.substr(i, 2), 16).toString(2)).slice(-8); for (var j = 0; j + 5 <= bits.length; j += 5) o += B32[parseInt(bits.substr(j, 5), 2)]; return o; }
function b32d_(s) { var bits = '', o = []; s = String(s); for (var i = 0; i < s.length; i++) bits += ('0000' + B32.indexOf(s[i]).toString(2)).slice(-5); for (var j = 0; j + 8 <= bits.length; j += 8) { var v = parseInt(bits.substr(j, 8), 2); o.push(v > 127 ? v - 256 : v); } return o; }
function hotp_(secret, step) { var msg = [0, 0, 0, 0, 0, 0, 0, 0], n = step; for (var i = 7; i >= 0; i--) { var v = n % 256; msg[i] = v > 127 ? v - 256 : v; n = Math.floor(n / 256); } var h = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, msg, b32d_(secret)), o = h[19] & 15, c = ((h[o] & 127) * 16777216 + (h[o + 1] & 255) * 65536 + (h[o + 2] & 255) * 256 + (h[o + 3] & 255)) % 1000000; return ('00000' + c).slice(-6); }
function totpOk_(u, code) { var s = Math.floor(Date.now() / 30000), c = String(code || '').replace(/\s/g, ''); for (var d = -1; d <= 1; d++) if (s + d > +u.totpStep && eq_(hotp_(u.totpSecret, s + d), c)) { u.totpStep = s + d; return true; } return false; }
function proveSecond_(u, code) { return totpOk_(u, code) || useRecovery_(u, code); }

/* ---------- requests ---------- */
var A_ = {
  ping: function () { return { nexora: 'accounts', version: VERSION }; },
  /* unknown addresses get a stable made-up salt, so this cannot be used to discover who has an account */
  salt: function (b) { var e = email_(b.email), u = byEmail_(e); return { salt: u ? String(u.salt) : 's_' + sha_(pepper_() + e).slice(0, 32) }; },
  signUp: function (b) {
    var e = email_(b.email), k = key_(b.key), s = salt_(b.salt); if (byEmail_(e)) fail_('An account with that e-mail already exists.', 'email_taken');
    var id = 'u_' + random_().slice(0, 24), u = { id: id, email: e, name: text_(b.name, 80) || e.split('@')[0], title: '', prefs: '{}', salt: s, verifier: seal_(k), verified: '', created: Date.now(), lastLogin: 0, fails: 0, lockUntil: 0, totpSecret: '', totpOn: '', totpStep: 0, recovery: '[]', log: '[]' };
    log_(u, 'Account created', 'password'); add_('Users', USERS, u); sendCode_(u, 'verify', 'Verify your NEXORA Studio e-mail', 'Your verification code is:'); return { verifyEmail: true, email: e };
  },
  resendVerify: function (b) { var u = byEmail_(email_(b.email)); if (u && !u.verified) sendCode_(u, 'verify', 'Verify your NEXORA Studio e-mail', 'Your verification code is:'); return {}; },
  verifySignup: function (b) { var u = byEmail_(email_(b.email)); if (!u) fail_('That code is not correct.', 'bad_code'); checkLock_(u); try { useCode_(u, 'verify', b.code); } catch (x) { if (x.code === 'bad_code') noteFail_(u, 'verification code'); throw x; } u.verified = 1; log_(u, 'E-mail verified'); return firstFactor_(u, 'password'); },
  signIn: function (b) {
    var u = byEmail_(email_(b.email)); if (u) checkLock_(u);
    if (!u || !eq_(u.verifier, seal_(key_(b.key)))) { if (u) noteFail_(u, 'password'); fail_('E-mail or password is incorrect.', 'bad_credentials'); }
    if (!u.verified) fail_('Verify your e-mail first.', 'not_verified');
    return firstFactor_(u, 'password');
  },
  verify2fa: function (b) {
    var key = codeKey_(String(b.ticket || ''), '2fa'), c = rows_('Codes', CODES).filter(function (x) { return x.key === key; })[0]; if (!c || c.exp < Date.now()) fail_('This sign-in has expired. Please start again.', 'expired');
    var u = rows_('Users', USERS).filter(function (x) { return String(x.id) === String(c.hash); })[0]; if (!u) fail_('This sign-in has expired. Please start again.', 'expired'); checkLock_(u);
    if (!(b.method === 'recovery' ? useRecovery_(u, b.code) : totpOk_(u, b.code))) { noteFail_(u, b.method === 'recovery' ? 'recovery code' : 'authenticator'); fail_('That code is not correct.', 'bad_code'); }
    if (b.method === 'recovery') log_(u, 'Recovery code used'); del_('Codes', CODES, c._row); return session_(u, c.data || 'password');
  },
  emailCodeRequest: function (b) { var u = byEmail_(email_(b.email)); if (u && u.verified) { checkLock_(u); sendCode_(u, 'login', 'Your NEXORA Studio sign-in code', 'Your sign-in code is:'); } return {}; },
  emailCodeSignIn: function (b) { var u = byEmail_(email_(b.email)); if (!u) fail_('That code is not correct.', 'bad_code'); checkLock_(u); try { useCode_(u, 'login', b.code); } catch (x) { if (x.code === 'bad_code') noteFail_(u, 'e-mail code'); throw x; } return firstFactor_(u, 'email-code'); },
  resetRequest: function (b) { var u = byEmail_(email_(b.email)); if (u && u.verified) sendCode_(u, 'reset', 'Reset your NEXORA Studio password', 'Your password reset code is:'); return {}; },
  resetPassword: function (b) { var u = byEmail_(email_(b.email)); if (!u) fail_('That code is not valid.', 'bad_code'); checkLock_(u); try { useCode_(u, 'reset', b.code); } catch (x) { if (x.code === 'bad_code') noteFail_(u, 'password reset'); throw x; } u.salt = salt_(b.salt); u.verifier = seal_(key_(b.key)); u.fails = 0; u.lockUntil = 0; log_(u, 'Password reset'); write_('Users', USERS, u); dropSessions_(u.id); return {}; },
  me: function (b) { return { user: pub_(me_(b)) }; },
  signOut: function (b) { var u = me_(b); del_('Sessions', SESSIONS, u._session._row); return {}; },
  update: function (b) { var u = me_(b); if (b.name !== undefined) { var n = text_(b.name, 80); if (!n) fail_('Enter a display name.', 'bad_name'); u.name = n; } if (b.title !== undefined) u.title = text_(b.title, 80); if (b.prefs) u.prefs = JSON.stringify({ w: +b.prefs.w || 0, h: +b.prefs.h || 0, fps: +b.prefs.fps || 0 }); write_('Users', USERS, u); return { user: pub_(u) }; },
  changePassword: function (b) { var u = me_(b); checkLock_(u); if (!eq_(u.verifier, seal_(key_(b.key)))) { noteFail_(u, 'change password'); fail_('The current password is not correct.', 'bad_credentials'); } u.salt = salt_(b.newSalt); u.verifier = seal_(key_(b.newKey)); log_(u, 'Password changed'); write_('Users', USERS, u); return { user: pub_(u) }; },
  totpBegin: function (b) { var u = me_(b); if (u.totpOn) fail_('Two-factor authentication is already on.', 'already'); u.totpSecret = b32_(random_().slice(0, 40)); u.totpStep = 0; write_('Users', USERS, u); return { secret: String(u.totpSecret), uri: 'otpauth://totp/' + encodeURIComponent('NEXORA Studio:' + u.email) + '?secret=' + u.totpSecret + '&issuer=' + encodeURIComponent('NEXORA Studio') + '&algorithm=SHA1&digits=6&period=30' }; },
  totpConfirm: function (b) { var u = me_(b); if (!u.totpSecret || u.totpOn) fail_('This setup has expired. Please start again.', 'expired'); if (!totpOk_(u, b.code)) fail_('That code is not correct. Check that your phone\'s clock is right.', 'bad_code'); u.totpOn = 1; var recovery = issueRecovery_(u); log_(u, 'Two-factor authentication turned on'); write_('Users', USERS, u); return { user: pub_(u), recovery: recovery }; },
  totpDisable: function (b) { var u = me_(b); checkLock_(u); if (!proveSecond_(u, b.code)) { noteFail_(u, 'turn off 2FA'); fail_('That could not be verified.', 'bad_code'); } u.totpOn = ''; u.totpSecret = ''; log_(u, 'Two-factor authentication turned off'); write_('Users', USERS, u); return { user: pub_(u) }; },
  recoveryRegenerate: function (b) { var u = me_(b); checkLock_(u); if (!totpOk_(u, b.code) && !useRecovery_(u, b.code)) { noteFail_(u, 'new recovery codes'); fail_('That could not be verified.', 'bad_code'); } var recovery = issueRecovery_(u); log_(u, 'New recovery codes'); write_('Users', USERS, u); return { user: pub_(u), recovery: recovery }; },
  activity: function (b) { var l = []; try { l = JSON.parse(me_(b).log || '[]'); } catch (x) { if (x.expose) throw x; } return { log: l }; },
  deleteAccount: function (b) { var u = me_(b); checkLock_(u); if (String(b.confirm || '').trim().toLowerCase() !== String(u.email)) fail_('Type your e-mail address to confirm.', 'bad_confirm'); if (u.totpOn ? !proveSecond_(u, b.code) : !eq_(u.verifier, seal_(key_(b.key)))) { noteFail_(u, 'delete account'); fail_('That could not be verified.', 'bad_code'); } dropSessions_(u.id); del_('Users', USERS, u._row); return {}; }
};
function dropSessions_(uid) { var r = rows_('Sessions', SESSIONS).filter(function (s) { return String(s.uid) === String(uid); }).map(function (s) { return s._row; }).sort(function (a, b) { return b - a; }); r.forEach(function (n) { del_('Sessions', SESSIONS, n); }); }
