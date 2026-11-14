'use strict';
/* ====================== NEXORA online accounts (Google Apps Script) ======================
   When a Web App address is connected, sign-in goes to the owner's Google Sheet (electron/google-apps-script/Code.gs), so one
   account works on every computer and e-mails carry real codes. The password is turned into a key here with scrypt and only that
   key is sent; the Sheet stores a hash of the key. Tokens stay in the main process. */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const VALID = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

function install(api, x) {
  const { app, safeStorage, logLine, Fail, qrEncode, testMode, scrypt, SC, checkPassword } = x, fail = (m, c) => { throw new Fail(m, c); };
  const cfgFile = path.join(app.getPath('userData'), testMode ? 'gas-test.json' : 'gas.json'), file = path.join(app.getPath('userData'), testMode ? 'gas-test.bin' : 'gas-session.bin');
  let url = null, token = null, user = null, remember = false, ticket = null, restored = false, avatars = {};
  const readCfg = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'gas.config.json'), 'utf8')).url || null; } catch (e) { } try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')).url || null; } catch (e) { return null; } };
  const builtIn = () => { try { return !!JSON.parse(fs.readFileSync(path.join(__dirname, 'gas.config.json'), 'utf8')).url; } catch (e) { return false; } };
  url = testMode ? null : readCfg();
  const enc = () => { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; } };
  const readDisk = () => { try { const o = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); avatars = o.avatars || {}; return o; } catch (e) { return {}; } };
  const writeDisk = () => { try { if (!enc()) return; const o = { avatars, token: remember ? token : null }; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(o)), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); } catch (e) { logLine('gas store', e); } };
  const validUrl = u => { u = String(u || '').trim(); if (VALID.test(u) || (testMode && /^http:\/\/127\.0\.0\.1:\d+\/exec$/.test(u))) return u; fail('Paste the Web App address that ends in /exec.', 'bad_url'); };
  async function call(action, body, target) {
    let r; try { r = await fetch(target || url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...body }), redirect: 'follow' }); } catch (e) { fail('Could not reach the sign-in server. Check your internet connection.', 'network'); }
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { }
    if (!j) { logLine('gas bad reply', r.status); fail('The sign-in server is not set up correctly. In Apps Script, check that "Who has access" is Anyone, and deploy a new version.', 'not_deployed'); }
    if (!j.ok) fail(j.error || 'The sign-in server refused the request.', j.code || 'error'); return j;
  }
  const deriveHex = async (pw, salt) => (await scrypt(String(pw || ''), salt, SC)).toString('hex');
  const newSalt = () => 's_' + crypto.randomBytes(16).toString('hex');
  const view = u => u && ({ ...u, avatar: avatars[u.id] || '' });
  const done = (j, rem) => { token = j.token; user = j.user; remember = !!rem; ticket = null; writeDisk(); return { user: view(user) }; };
  const after = (j, rem) => { if (j.twoFactor) { ticket = { id: j.ticket, rem }; return { twoFactor: true, methods: j.methods, hint: '' }; } return done(j, rem); };
  const need = () => { if (!token) fail('Please sign in first.', 'signed_out'); };
  const C = {
    async status(local) { if (!restored) { restored = true; const d = readDisk(); if (d.token) { try { const j = await call('me', { token: d.token }); token = d.token; user = j.user; remember = true; } catch (e) { if (e.code !== 'network') { token = null; writeDisk(); } } } } return { ...local, user: token && user ? view(user) : null, smtp: true, hasUsers: true, twoFactorPending: !!ticket, cloud: true, online: 'gas', gasBuiltIn: builtIn() }; },
    async signUp(o) { checkPassword(o.password, o.email); const salt = newSalt(); const j = await call('signUp', { email: o.email, name: o.name, salt, key: await deriveHex(o.password, salt) }); return { verifyEmail: true, email: j.email }; },
    async verifySignup(o) { return after(await call('verifySignup', { email: o.email, code: o.code }), o.remember); },
    async resendSignup(o) { await call('resendVerify', { email: o.email }); return {}; },
    async signIn(o) { const { salt } = await call('salt', { email: o.email }); return after(await call('signIn', { email: o.email, key: await deriveHex(o.password, salt) }), o.remember); },
    async verify2fa(o) { if (!ticket) fail('This sign-in has expired. Please start again.', 'expired'); return done(await call('verify2fa', { ticket: ticket.id, method: o.method, code: o.code }), ticket.rem); },
    cancel2fa() { ticket = null; return {}; },
    async emailCodeRequest(o) { await call('emailCodeRequest', { email: o.email }); return {}; },
    async emailCodeSignIn(o) { return after(await call('emailCodeSignIn', { email: o.email, code: o.code }), o.remember); },
    async resetRequest(o) { await call('resetRequest', { email: o.email }); return {}; },
    async resetPassword(o) { checkPassword(o.password, o.email); const salt = newSalt(); await call('resetPassword', { email: o.email, code: o.code, salt, key: await deriveHex(o.password, salt) }); return {}; },
    async signOut() { if (token) await call('signOut', { token }).catch(() => { }); token = null; user = null; ticket = null; remember = false; writeDisk(); return {}; },
    async updateProfile(o) { need(); if (o.avatar !== undefined) { if (o.avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(o.avatar)) fail('That image cannot be used.', 'bad_avatar'); avatars[user.id] = o.avatar; writeDisk(); } if (o.name !== undefined || o.title !== undefined || o.prefs) { const j = await call('update', { token, name: o.name, title: o.title, prefs: o.prefs }); user = j.user; } return { user: view(user) }; },
    async changePassword(o) { need(); checkPassword(o.next, user.email); const { salt } = await call('salt', { email: user.email }), ns = newSalt(), j = await call('changePassword', { token, key: await deriveHex(o.current, salt), newSalt: ns, newKey: await deriveHex(o.next, ns) }); user = j.user; return { user: view(user) }; },
    async totpBegin() { need(); const j = await call('totpBegin', { token }), qr = qrEncode(j.uri); return { secret: j.secret.match(/.{1,4}/g).join(' '), uri: j.uri, qr: { size: qr.size, rows: qr.rows } }; },
    async totpConfirm(o) { need(); const j = await call('totpConfirm', { token, code: o.code }); user = j.user; return { user: view(user), recovery: j.recovery }; },
    async totpDisable(o) { need(); const j = await call('totpDisable', { token, code: o.code }); user = j.user; return { user: view(user) }; },
    async recoveryRegenerate(o) { need(); const j = await call('recoveryRegenerate', { token, code: o.code }); user = j.user; return { user: view(user), recovery: j.recovery }; },
    async activity() { need(); return { log: (await call('activity', { token })).log }; },
    exportData() { need(); return { exported: new Date().toISOString(), account: user, activity: [] }; },
    async deleteAccount(o) { need(); const body = { token, confirm: o.confirm, code: o.code }; if (!user.totp) { const { salt } = await call('salt', { email: user.email }); body.key = await deriveHex(o.password, salt); } await call('deleteAccount', body); token = null; user = null; remember = false; writeDisk(); return {}; },
    providers() { return { list: [] }; }, oauthCancel() { return {}; }
  };
  const unavailable = () => fail('This is not available with online accounts.', 'unavailable');
  for (const n of Object.keys(api)) { if (['verifyPassword', 'proveFactor'].includes(n)) continue; const prev = api[n]; api[n] = async (...a) => { if (!url) return prev(...a); if (n === 'status') return C.status(await prev()); if (!C[n]) unavailable(); return C[n](...a); }; }
  api.verifySignup = o => url ? C.verifySignup(o) : unavailable();
  api.resendSignup = o => url ? C.resendSignup(o) : unavailable();
  api.gasGet = () => ({ url: url || '', connected: !!url });
  api.gasScript = () => ({ code: fs.readFileSync(path.join(__dirname, 'google-apps-script', 'Code.gs'), 'utf8') });
  api.gasSet = async o => { if (!o.url) { url = null; token = null; user = null; ticket = null; restored = false; try { fs.rmSync(cfgFile, { force: true }); } catch (e) { } return { connected: false }; } const u = validUrl(o.url), j = await call('ping', {}, u); if (j.nexora !== 'accounts') fail('That address is not a NEXORA accounts server.', 'bad_url'); url = u; token = null; user = null; ticket = null; restored = false; fs.mkdirSync(path.dirname(cfgFile), { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify({ url: u })); return { connected: true }; };
  return { reload() { token = null; user = null; ticket = null; restored = false; remember = false; }, wipe() { try { fs.rmSync(file, { force: true }); } catch (e) { } avatars = {}; } };
}
module.exports = { install };
