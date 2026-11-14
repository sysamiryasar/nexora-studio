'use strict';
/* ====================== NEXORA online accounts (Supabase Auth) ======================
   When electron/cloud.config.json exists ({ "url": "https://xxxx.supabase.co", "publishableKey": "…" }) sign-in goes to that
   one server, so an account works on every computer. Without it, the local account store in auth.js is used unchanged.
   Tokens stay in the main process; a remembered session is encrypted with the OS key store. */
const crypto = require('crypto'), fs = require('fs'), path = require('path'), http = require('http');
const b64u = b => Buffer.from(b).toString('base64url');
const PROV = { google: { p: 'google', name: 'Google' }, microsoft: { p: 'azure', name: 'Microsoft', scopes: 'email' }, github: { p: 'github', name: 'GitHub' } };

function install(api, x) {
  const { app, safeStorage, logLine, Fail, qrEncode, open, testMode } = x, fail = (m, c) => { throw new Fail(m, c); };
  let cfg = null; try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'cloud.config.json'), 'utf8')); if (j.url && j.publishableKey) cfg = { url: j.url.replace(/\/$/, ''), key: j.publishableKey }; } catch (e) { }
  const file = path.join(app.getPath('userData'), testMode ? 'cloud-test.bin' : 'cloud-session.bin');
  let tok = null, user = null, remember = false, pending = null, enroll = null, restored = false, flow = null, avatars = {};
  const enc = () => { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; } };
  function readDisk() { try { const o = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); avatars = o.avatars || {}; return o; } catch (e) { return {}; } }
  function writeDisk() { try { if (!enc()) return; const o = { avatars, refresh: remember && tok ? tok.refresh : null }; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(o)), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); } catch (e) { logLine('cloud store', e); } }

  async function req(p, o) {
    o = o || {}; let r; const bearer = o.auth ? (await token()) : cfg.key;
    try { r = await fetch(`${cfg.url}/auth/v1${p}`, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { apikey: cfg.key, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json', Accept: 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined }); }
    catch (e) { fail('Could not reach the sign-in service. Check your internet connection.', 'network'); }
    const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { }
    if (r.ok) return j;
    const code = j.error_code || j.code || j.error, msg = j.msg || j.message || j.error_description || '';
    if (r.status === 429) fail('Too many attempts. Please wait a little and try again.', 'locked');
    if (code === 'invalid_credentials' || /invalid login/i.test(msg)) fail('E-mail or password is incorrect.', 'bad_credentials');
    if (code === 'email_not_confirmed') fail('Confirm your e-mail first. Check your inbox for the link.', 'not_verified');
    if (code === 'user_already_exists') fail('An account with that e-mail already exists.', 'email_taken');
    if (code === 'weak_password') fail(msg || 'Choose a stronger password.', 'weak_password');
    if (code === 'mfa_verification_failed' || code === 'otp_expired') fail('That code is not correct.', 'bad_code');
    logLine('cloud auth', r.status, code || ''); fail(msg || 'The sign-in service refused the request.', 'error');
  }
  const setTok = j => { tok = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; if (j.user) user = j.user; };
  async function token() { if (!tok) fail('Please sign in first.', 'signed_out'); if (tok.exp - Date.now() < 60000) { setTok(await req('/token?grant_type=refresh_token', { body: { refresh_token: tok.refresh } })); writeDisk(); } return tok.access; }
  const aal = () => { try { return JSON.parse(Buffer.from(tok.access.split('.')[1], 'base64url')).aal; } catch (e) { return ''; } };
  const verifiedTotp = u => (u.factors || []).find(f => f.factor_type === 'totp' && f.status === 'verified');
  const pub = u => { const m = u.user_metadata || {}, ids = u.identities || [], links = {}; ids.filter(i => i.provider !== 'email').forEach(i => { const k = i.provider === 'azure' ? 'microsoft' : i.provider; links[k] = { email: (i.identity_data || {}).email || '', name: (i.identity_data || {}).name || '', at: Date.parse(i.created_at) || 0 }; }); return { id: u.id, email: u.email || '', name: m.display_name || m.full_name || m.name || (u.email || 'User').split('@')[0], title: m.title || '', avatar: avatars[u.id] || '', created: Date.parse(u.created_at) || 0, lastSignIn: Date.parse(u.last_sign_in_at) || 0, emailVerified: !!u.email_confirmed_at, hasPassword: ids.some(i => i.provider === 'email'), totp: !!verifiedTotp(u), emailOtp: false, recoveryLeft: 0, prefs: m.prefs || {}, links }; };
  const done = () => { writeDisk(); pending = null; return { user: pub(user) }; };
  function afterSession(j, rem) { setTok(j); remember = !!rem; if (verifiedTotp(user) && aal() !== 'aal2') { pending = { factor: verifiedTotp(user).id }; return { twoFactor: true, methods: ['totp'], hint: '' }; } return done(); }
  async function verifyFactor(factor, code) { const c = await req(`/factors/${factor}/challenge`, { body: {}, auth: true }); return req(`/factors/${factor}/verify`, { body: { challenge_id: c.id, code: String(code || '').replace(/\s/g, '') }, auth: true }); }
  async function refreshUser() { user = await req('/user', { auth: true }); return pub(user); }
  const SIMPLE = (t, m) => `<!doctype html><meta charset=utf-8><title>NEXORA Studio</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#050507;color:#fff;font:16px Segoe UI,sans-serif"><div style="padding:40px 56px;border:1px solid #5cb8ff55;border-radius:10px;box-shadow:0 0 60px #5cb8ff33;text-align:center"><h2 style="margin:0 0 8px;font-weight:600">${t}</h2><div style="color:#9fb4c8">${m}</div></div>`;
  async function oauth(id, o) {
    const P = PROV[id]; if (!P) fail('This provider is not available.', 'bad_provider'); if (o && o.link) fail('Sign out, then continue with ' + P.name + ' to use it.', 'bad_provider');
    if (flow) flow.cancel(); const verifier = b64u(crypto.randomBytes(48)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest()); let settle; const got = new Promise((res, rej) => { settle = { res, rej }; }); got.catch(() => { });
    const srv = http.createServer((q, s) => { const u = new URL(q.url, 'http://127.0.0.1'); if (u.pathname !== '/callback') { s.writeHead(404); return s.end(); } const code = u.searchParams.get('code'), err = u.searchParams.get('error_description') || u.searchParams.get('error'); s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(code ? SIMPLE('You are signed in', 'You can close this tab and return to NEXORA Studio.') : SIMPLE('Sign-in did not finish', 'You can close this tab and return to NEXORA Studio.')); code ? settle.res(code) : settle.rej(new Fail(err || 'Sign-in was cancelled.', 'denied')); });
    await new Promise((r, x_) => { srv.once('error', x_); srv.listen(0, '127.0.0.1', r); }); const timer = setTimeout(() => settle.rej(new Fail('Sign-in timed out.', 'timeout')), 5 * 60000), me_ = flow = { cancel: () => settle.rej(new Fail('Sign-in was cancelled.', 'cancelled')) };
    try { const q = new URLSearchParams({ provider: P.p, redirect_to: `http://127.0.0.1:${srv.address().port}/callback`, code_challenge: challenge, code_challenge_method: 's256' }); if (P.scopes) q.set('scopes', P.scopes); await open(`${cfg.url}/auth/v1/authorize?${q}`); const code = await got; return afterSession(await req('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: verifier } }), o && o.remember); }
    finally { clearTimeout(timer); srv.close(); if (flow === me_) flow = null; }
  }
  const unavailable = () => fail('This is not available with online accounts.', 'unavailable');
  const C = {
    async status(local) { if (!restored) { restored = true; const d = readDisk(); if (d.refresh) { try { tok = { access: '', refresh: d.refresh, exp: 0 }; remember = true; await token(); await refreshUser(); if (verifiedTotp(user) && aal() !== 'aal2') { tok = null; user = null; } } catch (e) { tok = null; user = null; writeDisk(); } } } return { ...local, user: user && tok && !pending ? pub(user) : null, smtp: true, hasUsers: true, twoFactorPending: !!pending, cloud: true }; },
    async signUp(o) { const j = await req('/signup', { body: { email: o.email, password: o.password, data: { display_name: String(o.name || '').slice(0, 80) } } }); if (!j.access_token) return { confirmEmail: true, email: o.email }; return afterSession(j, o.remember); },
    async signIn(o) { return afterSession(await req('/token?grant_type=password', { body: { email: String(o.email || '').trim(), password: o.password } }), o.remember); },
    async verify2fa(o) { if (!pending) fail('This sign-in has expired. Please start again.', 'expired'); if (o.method !== 'totp') fail('Use the code from your authenticator app.', 'bad_method'); const j = await verifyFactor(pending.factor, o.code); setTok(j); return done(); },
    cancel2fa() { pending = null; tok = null; user = null; return {}; },
    async emailCodeRequest(o) { await req('/otp', { body: { email: o.email, create_user: false } }); return {}; },
    async emailCodeSignIn(o) { return afterSession(await req('/verify', { body: { type: 'email', email: o.email, token: String(o.code || '').trim() } }), o.remember); },
    async resetRequest(o) { await req('/recover', { body: { email: o.email } }); return {}; },
    async resetPassword(o) { const j = await req('/verify', { body: { type: 'recovery', email: o.email, token: String(o.code || '').trim() } }); setTok(j); await req('/user', { method: 'PUT', body: { password: o.password }, auth: true }); await req('/logout', { body: {}, auth: true }).catch(() => { }); tok = null; user = null; writeDisk(); return {}; },
    async signOut() { if (tok) await req('/logout', { body: {}, auth: true }).catch(() => { }); tok = null; user = null; pending = null; enroll = null; remember = false; writeDisk(); return {}; },
    async updateProfile(o) { const m = {}; if (o.name !== undefined) { const n = String(o.name).trim().slice(0, 80); if (!n) fail('Enter a display name.', 'bad_name'); m.display_name = n; } if (o.title !== undefined) m.title = String(o.title).trim().slice(0, 80); if (o.prefs) m.prefs = { w: +o.prefs.w, h: +o.prefs.h, fps: +o.prefs.fps }; if (o.avatar !== undefined) { if (o.avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(o.avatar)) fail('That image cannot be used.', 'bad_avatar'); avatars[user.id] = o.avatar; writeDisk(); } if (Object.keys(m).length) user = await req('/user', { method: 'PUT', body: { data: m }, auth: true }); return { user: pub(user) }; },
    async changePassword(o) { if (pub(user).hasPassword) { try { await req('/token?grant_type=password', { body: { email: user.email, password: o.current } }); } catch (e) { fail('The current password is not correct.', 'bad_credentials'); } } user = await req('/user', { method: 'PUT', body: { password: o.next }, auth: true }); return { user: pub(user) }; },
    async changeEmail(o) { user = await req('/user', { method: 'PUT', body: { email: o.email }, auth: true }); return { user: pub(user) }; },
    async totpBegin() { const j = await req('/factors', { body: { factor_type: 'totp', friendly_name: 'NEXORA ' + Date.now() }, auth: true }), qr = qrEncode(j.totp.uri); enroll = j.id; return { secret: j.totp.secret.match(/.{1,4}/g).join(' '), uri: j.totp.uri, qr: { size: qr.size, rows: qr.rows } }; },
    async totpConfirm(o) { if (!enroll) fail('This setup has expired. Please start again.', 'expired'); setTok(await verifyFactor(enroll, o.code)); enroll = null; await refreshUser(); writeDisk(); return { user: pub(user), recovery: [] }; },
    async totpDisable(o) { const f = verifiedTotp(user); if (!f) fail('Two-factor authentication is off.', 'already'); setTok(await verifyFactor(f.id, o.code)); await req(`/factors/${f.id}`, { method: 'DELETE', auth: true }); await refreshUser(); writeDisk(); return { user: pub(user) }; },
    oauth, oauthCancel() { if (flow) flow.cancel(); return {}; },
    providers() { return { list: Object.keys(PROV).map(id => ({ id, name: PROV[id].name, flow: 'pkce', configured: true, clientId: '', hasSecret: false, needsSecret: false, issuer: '', label: '', help: '', console: '', redirect: '' })) }; },
    activity() { return { log: [] }; },
    exportData() { return { exported: new Date().toISOString(), account: pub(user), activity: [] }; },
    async deleteAccount(o) { if (String(o.confirm || '').trim().toLowerCase() !== (user.email || '').toLowerCase()) fail('Type your e-mail address to confirm.', 'bad_confirm'); const r = await fetch(`${cfg.url}/functions/v1/delete-account`, { method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + await token() } }).catch(() => null); if (!r || !r.ok) fail('The account could not be deleted right now. Please try again later.', 'error'); tok = null; user = null; writeDisk(); return {}; }
  };
  for (const n of Object.keys(api)) { if (['verifyPassword', 'proveFactor'].includes(n)) continue; const local = api[n]; api[n] = async (...a) => { if (!cfg) return local(...a); if (n === 'status') return C.status(await local()); if (!C[n]) unavailable(); return C[n](...a); }; }
  return { set(c) { cfg = c; tok = null; user = null; pending = null; enroll = null; restored = false; remember = false; try { fs.rmSync(file, { force: true }); } catch (e) { } avatars = {}; }, reload() { tok = null; user = null; restored = false; pending = null; } };
}
module.exports = { install };
