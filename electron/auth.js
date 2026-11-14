'use strict';
/* ====================== NEXORA accounts (Electron main process) ======================
   The page never sees a password hash, a 2FA secret or a provider token: it only calls the nxauth:* handlers below.
   · Store: one file, <userData>/accounts/accounts.db, encrypted with the OS key store (safeStorage / DPAPI), atomic writes.
   · Passwords: scrypt (N=2^17, r=8, p=1, 16-byte salt), failed attempts lock the account with an increasing delay.
   · 2FA: RFC 6238 TOTP (any authenticator app) with replay protection, single-use recovery codes, optional e-mailed codes.
   · Google / Microsoft / custom OpenID Connect: authorization code + PKCE in the system browser with a loopback redirect
     (RFC 8252); the ID token's signature, issuer, audience, expiry and nonce are all verified. GitHub: device flow.
     Provider tokens are used once to read the identity and then discarded.
   · E-mail (verification, sign-in codes, password reset) goes through the SMTP server the user configures; there is no
     NEXORA cloud service, so accounts live on this computer. */
const crypto = require('crypto'), fs = require('fs'), fsp = fs.promises, path = require('path'), http = require('http'), net = require('net'), tls = require('tls');
const { encode: qrEncode } = require('./qr');

const SC = { N: 1 << 17, r: 8, p: 1 };
const scrypt = (pw, salt, o) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, { N: o.N, r: o.r, p: o.p, maxmem: 512 * 1024 * 1024 }, (e, k) => e ? rej(e) : res(k)));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const b64u = b => Buffer.from(b).toString('base64url');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
class Fail extends Error { constructor(msg, code) { super(msg); this.expose = true; this.code = code || 'error'; } }
const fail = (msg, code) => { throw new Fail(msg, code); };
const normEmail = e => String(e || '').trim().toLowerCase();
const okEmail = e => e.length <= 254 && /^[^\s@"'<>,;:\\()\[\]]+@[^\s@"'<>,;:\\()\[\]]+\.[a-z]{2,}$/i.test(e);
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'password1234', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345', 'iloveyou123', 'letmein1234', 'adminadmin', 'administrator', 'welcome1234', 'nexorastudio', '0123456789', '1111111111', 'abcdefghij', 'abcd123456']);
function checkPassword(pw, email) {
  if (typeof pw !== 'string' || pw.length < 10) fail('Use at least 10 characters for the password.', 'weak_password');
  if (pw.length > 256) fail('That password is too long (256 characters at most).', 'weak_password');
  const l = pw.toLowerCase(); if (COMMON.has(l) || /^(.)\1+$/.test(l)) fail('That password is too common. Choose something harder to guess.', 'weak_password');
  if (email && l === normEmail(email).split('@')[0]) fail('The password cannot be the same as your e-mail name.', 'weak_password');
}

/* ---------- TOTP ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = 0, v = 0, o = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= (1 << bits) - 1; } if (bits) o += B32[(v << (5 - bits)) & 31]; return o; }
function b32dec(s) { let bits = 0, v = 0; const o = []; for (const c of s.replace(/[\s=-]/g, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) throw new Error('bad base32'); v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } v &= (1 << bits) - 1; } return Buffer.from(o); }
function hotp(key, counter, digits = 6) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', key).update(c).digest(), o = h[19] & 15, n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits; return String(n).padStart(digits, '0'); }
const nowStep = () => Math.floor(Date.now() / 30000);
/** returns the matching time step, or -1. Accepts one step of clock drift either way; steps at or before `last` are replays. */
function totpMatch(secret, code, last) { const key = b32dec(secret), s = nowStep(); let hit = -1; for (const d of [0, -1, 1]) if (s + d > (last || 0) && eq(hotp(key, s + d), code)) hit = s + d; return hit; }

const RC = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const newRecovery = () => [...Array(10)].map(() => { let s = ''; for (let i = 0; i < 10; i++) s += RC[crypto.randomInt(RC.length)]; return s.slice(0, 5) + '-' + s.slice(5); });
const normRecovery = c => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/* ---------- providers ---------- */
const PROVIDERS = {
  google: { name: 'Google', flow: 'pkce', auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs', iss: i => i === 'https://accounts.google.com' || i === 'accounts.google.com', scope: 'openid email profile', host: '127.0.0.1', secret: true, extra: { prompt: 'select_account' }, console: 'https://console.cloud.google.com/apis/credentials', help: 'Create an OAuth client of type "Desktop app". Paste its Client ID and Client secret.' },
  microsoft: { name: 'Microsoft', flow: 'pkce', auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys', iss: i => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(i), scope: 'openid email profile', host: 'localhost', extra: { prompt: 'select_account' }, console: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', help: 'Register an application, add the platform "Mobile and desktop applications" with redirect URI http://localhost, and allow personal accounts. Paste its Application (client) ID.' },
  github: { name: 'GitHub', flow: 'device', device: 'https://github.com/login/device/code', token: 'https://github.com/login/oauth/access_token', user: 'https://api.github.com/user', emails: 'https://api.github.com/user/emails', console: 'https://github.com/settings/developers', help: 'Create an OAuth App, tick "Enable Device Flow", and paste its Client ID.' },
  oidc: { name: 'Single sign-on', flow: 'pkce', discover: true, scope: 'openid email profile', host: '127.0.0.1', secret: 'optional', console: '', help: 'Any OpenID Connect provider (Okta, Auth0, Keycloak, Entra tenant…). Register a native / public app with a loopback redirect, then enter its issuer URL and Client ID.' }
};

function create(app, shell, ipcMain, safeStorage, logLine) {
  const testMode = process.argv.includes('--nx-hidden');
  const dir = path.join(app.getPath('userData'), testMode ? 'accounts-test' : 'accounts'), file = path.join(dir, 'accounts.db');
  let db = null, session = null, pending = null, pendingTotp = null, flow = null, opener = url => shell.openExternal(url), sendEvent = () => { };
  const codes = new Map();
  const encrypted = () => { try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; } };

  /* ---------- store ---------- */
  function load() {
    if (db) return db; let raw = null;
    try { raw = fs.readFileSync(file); } catch (e) { }
    if (raw) { try { db = raw[0] === 123 /* { */ ? JSON.parse(raw.toString('utf8')) : JSON.parse(safeStorage.decryptString(raw)); } catch (e) { logLine('accounts.db unreadable', e); try { fs.renameSync(file, file + '.unreadable-' + Date.now()); } catch (x) { } db = null; } }
    if (!db) db = { v: 1, users: {}, providers: {}, smtp: null, session: null };
    if (db.session && db.session.exp > Date.now() && db.users[db.session.uid]) session = { uid: db.session.uid, how: db.session.how }; else if (db.session) db.session = null;
    return db;
  }
  let writing = Promise.resolve();
  function save() {
    const json = JSON.stringify(db), body = encrypted() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
    return writing = writing.then(async () => { await fsp.mkdir(dir, { recursive: true }); const tmp = file + '.tmp-' + process.pid; await fsp.writeFile(tmp, body, { mode: 0o600 }); await fsp.rename(tmp, file); });
  }
  const users = () => Object.values(load().users);
  const byEmail = e => users().find(u => u.email === normEmail(e)) || null;
  const me = () => { load(); const u = session && db.users[session.uid]; if (!u) fail('Please sign in first.', 'signed_out'); return u; };
  const log = (u, ev, how, ok = true) => { u.log = u.log || []; u.log.unshift({ t: Date.now(), ev, how: how || '', ok }); u.log.length = Math.min(u.log.length, 60); };
  const smtpOn = () => !!(load().smtp && db.smtp.host);
  const pub = u => u && ({ id: u.id, email: u.email, name: u.name, title: u.title || '', avatar: u.avatar || '', created: u.created, lastSignIn: u.lastSignIn || 0, emailVerified: !!u.emailVerified, hasPassword: !!u.password, totp: !!(u.totp && u.totp.on), emailOtp: !!u.emailOtp, recoveryLeft: (u.recovery || []).length, prefs: u.prefs || {}, links: Object.fromEntries(Object.entries(u.links || {}).map(([k, v]) => [k, { email: v.email || '', name: v.name || '', at: v.at }])) });

  /* ---------- lockout ---------- */
  function checkLock(u) { const l = u.lock; if (l && l.until > Date.now()) fail(`Too many attempts. Try again in ${Math.ceil((l.until - Date.now()) / 1000)} seconds.`, 'locked'); }
  async function noteFail(u, how) { const l = u.lock = u.lock || { fails: 0, until: 0 }; l.fails++; if (l.fails >= 5) l.until = Date.now() + Math.min(900, 30 * 2 ** (l.fails - 5)) * 1000; log(u, 'Failed sign-in', how, false); await save(); }
  const clearFails = u => { u.lock = null; };

  /* ---------- finishing a sign-in ---------- */
  async function finish(u, how, remember) {
    session = { uid: u.id, how }; pending = null; u.lastSignIn = Date.now(); clearFails(u); log(u, 'Signed in', how);
    db.session = remember ? { uid: u.id, how, exp: Date.now() + 30 * 864e5 } : null; await save();
    return { user: pub(u) };
  }
  async function firstFactorDone(u, how, remember) {
    const methods = []; if (u.totp && u.totp.on) methods.push('totp'); if (u.emailOtp && smtpOn() && how !== 'email-code') methods.push('email');
    if (!methods.length) return finish(u, how, remember);
    if ((u.recovery || []).length) methods.push('recovery');
    pending = { uid: u.id, how, remember, exp: Date.now() + 5 * 60000 };
    return { twoFactor: true, methods, hint: u.email.replace(/^(.).*(@.*)$/, '$1•••$2') };
  }

  /* ---------- e-mail ---------- */
  const clean = s => String(s).replace(/[\r\n]+/g, ' ').trim();
  function smtpSend(cfg, to, subject, text) {
    return new Promise((resolve, reject) => {
      const local = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(cfg.host); let sock, buf = '', waiter = null, done = false;
      const end = (e, v) => { if (done) return; done = true; clearTimeout(tmr); try { sock.destroy(); } catch (x) { } e ? reject(e) : resolve(v); };
      const tmr = setTimeout(() => end(new Fail('The mail server did not answer in time.', 'smtp')), 20000);
      const onData = d => { buf += d.toString('utf8'); pump(); };
      const pump = () => { const lines = buf.split('\r\n'); if (lines.length < 2) return; for (let i = 0; i < lines.length - 1; i++) if (/^\d{3}( |$)/.test(lines[i])) { const reply = lines.slice(0, i + 1); buf = lines.slice(i + 1).join('\r\n'); const w = waiter; waiter = null; if (w) w(reply); return; } };
      const next = () => new Promise(r => { waiter = r; pump(); });
      const expect = async ok => { const r = await next(), c = +r[r.length - 1].slice(0, 3); if (!ok.includes(c)) throw new Fail('Mail server said: ' + r[r.length - 1], 'smtp'); return r; };
      const cmd = (l, ok) => { sock.write(l + '\r\n'); return expect(ok); };
      const wire = () => { sock.on('data', onData); sock.on('error', e => end(new Fail('Could not reach the mail server: ' + e.code, 'smtp'))); };
      (async () => {
        const name = 'nexora.local', connected = new Promise(r => { if (cfg.secure) { sock = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, r); } else sock = net.connect({ host: cfg.host, port: cfg.port }, r); });
        wire(); await connected; await expect([220]);
        let caps = await cmd('EHLO ' + name, [250]), secure = !!cfg.secure;
        if (!secure && caps.some(l => /STARTTLS/i.test(l))) {
          await cmd('STARTTLS', [220]); sock.removeListener('data', onData);
          sock = await new Promise((r, x) => { const t = tls.connect({ socket: sock, servername: cfg.host }, () => r(t)); t.once('error', x); }); wire(); secure = true; buf = '';
          caps = await cmd('EHLO ' + name, [250]);
        }
        if (!secure && !local) throw new Fail('This mail server does not offer encryption, so NEXORA will not send through it.', 'smtp');
        if (cfg.user) await cmd('AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass || ''}`).toString('base64'), [235]);
        const from = clean(cfg.from || cfg.user);
        await cmd(`MAIL FROM:<${from}>`, [250]); await cmd(`RCPT TO:<${clean(to)}>`, [250, 251]); await cmd('DATA', [354]);
        const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
        await cmd([`From: NEXORA Studio <${from}>`, `To: <${clean(to)}>`, `Subject: ${clean(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@nexora.local>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body, '.'].join('\r\n'), [250]);
        try { sock.write('QUIT\r\n'); } catch (e) { } end(null, true);
      })().catch(e => end(e.expose ? e : new Fail('Could not send the e-mail: ' + (e.code || e.message), 'smtp')));
    });
  }
  async function sendCode(u, purpose, subject, intro) {
    if (!smtpOn()) fail('Set up e-mail delivery first.', 'no_smtp');
    const code = String(crypto.randomInt(1000000)).padStart(6, '0');
    codes.set(purpose + ':' + u.id, { hash: sha(u.id + code), exp: Date.now() + 10 * 60000, tries: 0 });
    await smtpSend(db.smtp, u.email, subject, `${intro}\n\n    ${code}\n\nThis code expires in 10 minutes. If you did not ask for it, you can ignore this message.\n\nNEXORA Studio`);
  }
  function useCode(u, purpose, code) {
    const k = purpose + ':' + u.id, c = codes.get(k);
    if (!c || c.exp < Date.now()) fail('That code has expired. Ask for a new one.', 'code_expired');
    if (++c.tries > 5) { codes.delete(k); fail('Too many wrong codes. Ask for a new one.', 'code_expired'); }
    if (!eq(c.hash, sha(u.id + String(code || '').trim()))) fail('That code is not correct.', 'bad_code');
    codes.delete(k);
  }
  function useRecovery(u, code) { const h = sha(u.id + normRecovery(code)), i = (u.recovery || []).findIndex(x => eq(x, h)); if (i < 0) return false; u.recovery.splice(i, 1); return true; }
  function issueRecovery(u) { const list = newRecovery(); u.recovery = list.map(c => sha(u.id + normRecovery(c))); return list; }

  /* ---------- external sign-in ---------- */
  const cfgOf = id => { let base = {}; try { base = (JSON.parse(fs.readFileSync(path.join(__dirname, 'auth.config.json'), 'utf8')) || {})[id] || {}; } catch (e) { } return Object.assign({}, base, load().providers[id] || {}); };
  const configured = id => { const p = PROVIDERS[id], c = cfgOf(id); return !!(c.clientId && (p.secret !== true || c.clientSecret) && (id !== 'oidc' || c.issuer)); };
  const secureUrl = u => { const x = new URL(u); if (x.protocol !== 'https:' && !(testMode && x.hostname === '127.0.0.1')) throw new Fail('Only https:// addresses are allowed here.', 'bad_url'); return x.href; };
  async function jsonFetch(url, opt) { let r; try { r = await fetch(url, opt); } catch (e) { fail('Could not reach the sign-in service. Check your internet connection.', 'network'); } const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { } return { ok: r.ok, status: r.status, json: j, text: t }; }
  async function verifyIdToken(tok, ep, clientId, nonce) {
    const [h, p, s] = String(tok).split('.'); if (!s) fail('The provider returned an invalid identity token.', 'bad_token');
    const head = JSON.parse(Buffer.from(h, 'base64url')), claims = JSON.parse(Buffer.from(p, 'base64url'));
    const algs = { RS256: 'RSA-SHA256', ES256: 'SHA256' }; if (!algs[head.alg]) fail('The provider used an unsupported signature.', 'bad_token');
    const r = await jsonFetch(ep.jwks), key = r.json && (r.json.keys || []).find(k => k.kid === head.kid); if (!key) fail('The provider\'s signing key was not found.', 'bad_token');
    const pk = crypto.createPublicKey({ key, format: 'jwk' }), data = Buffer.from(h + '.' + p), sig = Buffer.from(s, 'base64url');
    const good = head.alg === 'RS256' ? crypto.verify(algs.RS256, data, pk, sig) : crypto.verify(algs.ES256, data, { key: pk, dsaEncoding: 'ieee-p1363' }, sig);
    if (!good) fail('The identity token signature is invalid.', 'bad_token');
    const now = Date.now() / 1000, aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!ep.iss(claims.iss)) fail('The identity token came from the wrong issuer.', 'bad_token');
    if (!aud.includes(clientId)) fail('The identity token was issued for a different app.', 'bad_token');
    if (!(claims.exp > now - 60)) fail('The identity token has expired.', 'bad_token');
    if (!eq(claims.nonce || '', nonce)) fail('The identity token does not match this sign-in.', 'bad_token');
    return claims;
  }
  async function fetchAvatar(url) { try { const r = await fetch(secureUrl(url)), type = (r.headers.get('content-type') || '').split(';')[0]; if (!r.ok || !/^image\/(png|jpeg|webp)$/.test(type)) return ''; const b = Buffer.from(await r.arrayBuffer()); return b.length < 400000 ? `data:${type};base64,${b.toString('base64')}` : ''; } catch (e) { return ''; } }
  const SUCCESS_PAGE = (title, msg) => `<!doctype html><meta charset=utf-8><title>NEXORA Studio</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#050507;color:#fff;font:16px Segoe UI,system-ui,sans-serif"><div style="text-align:center;padding:40px 56px;border:1px solid #5cb8ff55;border-radius:10px;box-shadow:0 0 60px #5cb8ff33"><h2 style="margin:0 0 8px;font-weight:600">${title}</h2><div style="color:#9fb4c8">${msg}</div></div>`;

  async function pkceFlow(id, c, ctl) {
    const p = PROVIDERS[id]; let ep = p;
    if (p.discover) {
      const issuer = secureUrl(c.issuer).replace(/\/$/, ''), d = await jsonFetch(issuer + '/.well-known/openid-configuration');
      if (!d.ok || !d.json || !d.json.authorization_endpoint) fail('That issuer has no OpenID Connect configuration.', 'bad_issuer');
      if (String(d.json.issuer).replace(/\/$/, '') !== issuer) fail('The issuer\'s configuration names a different issuer.', 'bad_issuer');
      ep = { ...p, auth: secureUrl(d.json.authorization_endpoint), token: secureUrl(d.json.token_endpoint), jwks: secureUrl(d.json.jwks_uri), userinfo: d.json.userinfo_endpoint && secureUrl(d.json.userinfo_endpoint), iss: i => String(i).replace(/\/$/, '') === issuer };
    }
    const state = b64u(crypto.randomBytes(24)), nonce = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(48)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
    let settle; const got = new Promise((res, rej) => { settle = { res, rej }; }); got.catch(() => { });
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1'); if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      if (!eq(u.searchParams.get('state') || '', state)) { res.writeHead(400, { 'Content-Type': 'text/html' }); res.end(SUCCESS_PAGE('Sign-in failed', 'This request did not come from NEXORA Studio.')); return; }
      const err = u.searchParams.get('error'); res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(err ? SUCCESS_PAGE('Sign-in cancelled', 'You can close this tab and return to NEXORA Studio.') : SUCCESS_PAGE('You are signed in', 'You can close this tab and return to NEXORA Studio.'));
      err ? settle.rej(new Fail(err === 'access_denied' ? 'Sign-in was cancelled.' : 'The provider reported: ' + err, 'denied')) : settle.res(u.searchParams.get('code'));
    });
    await new Promise((r, x) => { srv.once('error', x); srv.listen(0, '127.0.0.1', r); });
    const timer = setTimeout(() => settle.rej(new Fail('Sign-in timed out.', 'timeout')), 5 * 60000);
    ctl.cancel = () => settle.rej(new Fail('Sign-in was cancelled.', 'cancelled'));
    try {
      const redirect = `http://${p.host}:${srv.address().port}/callback`;
      const q = new URLSearchParams({ response_type: 'code', client_id: c.clientId, redirect_uri: redirect, scope: p.scope, state, nonce, code_challenge: challenge, code_challenge_method: 'S256', ...(p.extra || {}) });
      await opener(ep.auth + (ep.auth.includes('?') ? '&' : '?') + q);
      const code = await got;
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: c.clientId, code_verifier: verifier }); if (c.clientSecret) body.set('client_secret', c.clientSecret);
      const t = await jsonFetch(ep.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
      if (!t.ok || !t.json || !t.json.id_token) { logLine('oauth token error', id, t.status, (t.json && t.json.error) || ''); fail('The provider refused the sign-in: ' + ((t.json && (t.json.error_description || t.json.error)) || t.status), 'token'); }
      const claims = await verifyIdToken(t.json.id_token, ep, c.clientId, nonce);
      let info = claims;
      if (!claims.email && ep.userinfo && t.json.access_token) { const ui = await jsonFetch(ep.userinfo, { headers: { Authorization: 'Bearer ' + t.json.access_token } }); if (ui.ok && ui.json && ui.json.sub === claims.sub) info = { ...claims, ...ui.json }; }
      return { sub: String(claims.sub), email: normEmail(info.email || info.preferred_username || ''), emailVerified: info.email_verified === true || info.email_verified === 'true', name: info.name || '', picture: info.picture || '' };
    } finally { clearTimeout(timer); srv.close(); }
  }
  async function deviceFlow(id, c, ctl) {
    const p = PROVIDERS[id], headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
    const d = await jsonFetch(p.device, { method: 'POST', headers, body: new URLSearchParams({ client_id: c.clientId, scope: 'read:user user:email' }) });
    if (!d.ok || !d.json || !d.json.device_code) fail('GitHub refused the request. Check the Client ID and that Device Flow is enabled.', 'token');
    const j = d.json; let cancelled = false, interval = (j.interval || 5) * 1000; ctl.cancel = () => { cancelled = true; };
    sendEvent('device', { provider: id, code: j.user_code, url: j.verification_uri });
    await opener(j.verification_uri);
    const deadline = Date.now() + Math.min(900, j.expires_in || 900) * 1000; let tok = null;
    while (!tok) {
      await new Promise(r => setTimeout(r, testMode ? Math.min(interval, 50) : interval));
      if (cancelled) fail('Sign-in was cancelled.', 'cancelled'); if (Date.now() > deadline) fail('Sign-in timed out.', 'timeout');
      const t = await jsonFetch(p.token, { method: 'POST', headers, body: new URLSearchParams({ client_id: c.clientId, device_code: j.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
      if (t.json && t.json.access_token) tok = t.json.access_token;
      else if (t.json && t.json.error === 'slow_down') interval += 5000;
      else if (!(t.json && t.json.error === 'authorization_pending')) fail(t.json && t.json.error === 'access_denied' ? 'Sign-in was cancelled.' : 'GitHub refused the sign-in.', 'denied');
    }
    const auth = { Authorization: 'Bearer ' + tok, 'User-Agent': 'NEXORA-Studio', Accept: 'application/vnd.github+json' };
    const u = await jsonFetch(p.user, { headers: auth }), em = await jsonFetch(p.emails, { headers: auth });
    if (!u.ok || !u.json || !u.json.id) fail('Could not read your GitHub profile.', 'token');
    const primary = Array.isArray(em.json) ? em.json.find(e => e.primary) : null;
    return { sub: String(u.json.id), email: normEmail((primary && primary.email) || u.json.email || ''), emailVerified: !!(primary && primary.verified), name: u.json.name || u.json.login || '', picture: u.json.avatar_url || '' };
  }
  /* an external identity only signs in to the account it was connected to: matching e-mail addresses are never merged
     automatically, because that would let whoever controls a provider account take over a local one */
  const linkKey = id => id === 'oidc' ? 'oidc:' + String(cfgOf('oidc').issuer || '').replace(/\/$/, '') : id;
  async function external(id, o) {
    o = o || {}; load(); const p = PROVIDERS[id]; if (!p) fail('Unknown provider.', 'bad_provider');
    if (!configured(id)) fail(`${p.name} sign-in has not been set up yet.`, 'not_configured');
    if (flow) { try { flow.cancel && flow.cancel(); } catch (e) { } }
    const ctl = flow = {};
    let idn; try { idn = await (p.flow === 'device' ? deviceFlow : pkceFlow)(id, cfgOf(id), ctl); } finally { if (flow === ctl) flow = null; }
    const key = linkKey(id), owner = users().find(u => u.links && u.links[key] && u.links[key].sub === idn.sub);
    if (o.link) {
      const u = me(); if (owner && owner.id !== u.id) fail(`That ${p.name} account is already connected to another NEXORA account.`, 'link_taken');
      u.links = u.links || {}; u.links[key] = { provider: id, sub: idn.sub, email: idn.email, name: idn.name, at: Date.now() }; log(u, 'Connected ' + p.name); await save(); return { user: pub(u) };
    }
    if (owner) { checkLock(owner); return firstFactorDone(owner, id, o.remember); }
    if (idn.email && byEmail(idn.email)) fail(`An account already uses ${idn.email}. Sign in with its password, then connect ${p.name} under Profile.`, 'email_taken');
    const email = idn.email || `${id}-${sha(idn.sub).slice(0, 12)}@users.nexora.local`;
    const u = { id: crypto.randomUUID(), email, name: (idn.name || email.split('@')[0]).slice(0, 80), created: Date.now(), password: null, emailVerified: idn.emailVerified, avatar: idn.picture ? await fetchAvatar(idn.picture) : '', recovery: [], links: { [key]: { provider: id, sub: idn.sub, email: idn.email, name: idn.name, at: Date.now() } }, log: [], prefs: {} };
    db.users[u.id] = u; log(u, 'Account created', id); const recovery = issueRecovery(u);
    return { ...(await finish(u, id, o.remember)), recovery, created: true };
  }

  /* ---------- API ---------- */
  const api = {
    status() { load(); return { user: session && db.users[session.uid] ? pub(db.users[session.uid]) : null, testMode: testMode && !process.argv.includes('--nx-gate'), encrypted: encrypted(), smtp: smtpOn(), hasUsers: users().length > 0, twoFactorPending: !!(pending && pending.exp > Date.now()) }; },
    async signUp(o) {
      load(); const email = normEmail(o.email); if (!okEmail(email)) fail('Enter a valid e-mail address.', 'bad_email');
      if (byEmail(email)) fail('An account with that e-mail already exists on this computer.', 'email_taken');
      checkPassword(o.password, email);
      const salt = crypto.randomBytes(16), hash = await scrypt(o.password, salt, SC), name = String(o.name || '').trim().slice(0, 80) || email.split('@')[0];
      const u = { id: crypto.randomUUID(), email, name, created: Date.now(), password: { salt: salt.toString('base64'), hash: hash.toString('base64'), ...SC }, emailVerified: false, recovery: [], links: {}, log: [], prefs: {} };
      db.users[u.id] = u; log(u, 'Account created', 'password'); const recovery = issueRecovery(u), r = await finish(u, 'password', o.remember);
      let verifySent = false; if (smtpOn()) { try { await sendCode(u, 'verify', 'Verify your NEXORA Studio e-mail', 'Your verification code is:'); verifySent = true; } catch (e) { logLine('verify mail', e.message); } }
      return { ...r, recovery, verifySent };
    },
    async signIn(o) {
      load(); const u = byEmail(o.email); if (u) checkLock(u);
      const stored = u && u.password, salt = stored ? Buffer.from(stored.salt, 'base64') : Buffer.alloc(16), hash = await scrypt(String(o.password || ''), salt, stored || SC);     // same work for unknown e-mails
      if (!stored || !eq(hash.toString('base64'), stored.hash)) { if (u) await noteFail(u, 'password'); fail('E-mail or password is incorrect.', 'bad_credentials'); }
      return firstFactorDone(u, 'password', o.remember);
    },
    async verify2fa(o) {
      if (!pending || pending.exp < Date.now()) { pending = null; fail('This sign-in has expired. Please start again.', 'expired'); }
      const u = db.users[pending.uid]; checkLock(u); const code = String(o.code || '').replace(/\s/g, '');
      if (o.method === 'totp') { const s = u.totp && u.totp.on ? totpMatch(u.totp.secret, code, u.totp.step) : -1; if (s < 0) { await noteFail(u, 'authenticator'); fail('That code is not correct.', 'bad_code'); } u.totp.step = s; }
      else if (o.method === 'recovery') { if (!useRecovery(u, code)) { await noteFail(u, 'recovery code'); fail('That recovery code is not valid.', 'bad_code'); } log(u, 'Recovery code used'); }
      else if (o.method === 'email') { try { useCode(u, '2fa', code); } catch (e) { await noteFail(u, 'e-mail code'); throw e; } }
      else fail('Unknown method.', 'bad_method');
      return finish(u, pending.how, pending.remember);
    },
    async send2faEmail() { if (!pending) fail('This sign-in has expired. Please start again.', 'expired'); await sendCode(db.users[pending.uid], '2fa', 'Your NEXORA Studio sign-in code', 'Your sign-in code is:'); return {}; },
    cancel2fa() { pending = null; return {}; },
    /* always answers the same, so this cannot be used to discover which addresses have accounts */
    async emailCodeRequest(o) { load(); if (!smtpOn()) fail('E-mail sign-in needs e-mail delivery to be set up. Sign in with your password and open Profile › E-mail delivery.', 'no_smtp'); const u = byEmail(o.email); if (u && u.emailVerified) { checkLock(u); await sendCode(u, 'login', 'Your NEXORA Studio sign-in code', 'Your sign-in code is:'); } return {}; },
    async emailCodeSignIn(o) { load(); const u = byEmail(o.email); if (!u) fail('That code is not correct.', 'bad_code'); checkLock(u); try { useCode(u, 'login', o.code); } catch (e) { await noteFail(u, 'e-mail code'); throw e; } return firstFactorDone(u, 'email-code', o.remember); },
    async verifyEmailSend() { const u = me(); await sendCode(u, 'verify', 'Verify your NEXORA Studio e-mail', 'Your verification code is:'); return {}; },
    async verifyEmailConfirm(o) { const u = me(); useCode(u, 'verify', o.code); u.emailVerified = true; log(u, 'E-mail verified'); await save(); return { user: pub(u) }; },
    async resetRequest(o) { load(); if (!smtpOn()) fail('E-mail delivery is not set up. Use one of your recovery codes instead.', 'no_smtp'); const u = byEmail(o.email); if (u && u.emailVerified) await sendCode(u, 'reset', 'Reset your NEXORA Studio password', 'Your password reset code is:'); return {}; },
    async resetPassword(o) {
      load(); const u = byEmail(o.email); if (!u) fail('That code is not valid.', 'bad_code'); checkLock(u); checkPassword(o.password, u.email);
      if (o.via === 'email') { try { useCode(u, 'reset', o.code); } catch (e) { await noteFail(u, 'password reset'); throw e; } }
      else if (!useRecovery(u, o.code)) { await noteFail(u, 'password reset'); fail('That code is not valid.', 'bad_code'); }
      const salt = crypto.randomBytes(16); u.password = { salt: salt.toString('base64'), hash: (await scrypt(o.password, salt, SC)).toString('base64'), ...SC }; clearFails(u); if (db.session && db.session.uid === u.id) db.session = null; log(u, 'Password reset', o.via || 'recovery'); await save(); return {};
    },
    async signOut() { const u = session && db.users[session.uid]; if (u) log(u, 'Signed out'); session = null; pending = null; pendingTotp = null; if (load().session) db.session = null; await save(); return {}; },
    async updateProfile(o) {
      const u = me(); if (o.name !== undefined) { const n = String(o.name).trim().slice(0, 80); if (!n) fail('Enter a display name.', 'bad_name'); u.name = n; } if (o.title !== undefined) u.title = String(o.title).trim().slice(0, 80);
      if (o.avatar !== undefined) { if (o.avatar && !(typeof o.avatar === 'string' && o.avatar.length < 700000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(o.avatar))) fail('That image cannot be used.', 'bad_avatar'); u.avatar = o.avatar; }
      if (o.prefs) { const p = u.prefs = u.prefs || {}, w = +o.prefs.w, h = +o.prefs.h, fps = +o.prefs.fps; if (w >= 16 && w <= 16384 && h >= 16 && h <= 16384) { p.w = w; p.h = h; } if (fps > 0 && fps <= 240) p.fps = fps; }
      await save(); return { user: pub(u) };
    },
    async verifyPassword(u, pw) { if (!u.password) return false; const h = await scrypt(String(pw || ''), Buffer.from(u.password.salt, 'base64'), u.password); return eq(h.toString('base64'), u.password.hash); },
    async changePassword(o) {
      const u = me(); checkLock(u); if (u.password && !(await api.verifyPassword(u, o.current))) { await noteFail(u, 'change password'); fail('The current password is not correct.', 'bad_credentials'); }
      checkPassword(o.next, u.email); const had = !!u.password, salt = crypto.randomBytes(16); u.password = { salt: salt.toString('base64'), hash: (await scrypt(o.next, salt, SC)).toString('base64'), ...SC }; clearFails(u); log(u, had ? 'Password changed' : 'Password added'); await save(); return { user: pub(u) };
    },
    async changeEmail(o) {
      const u = me(); const email = normEmail(o.email); if (!okEmail(email)) fail('Enter a valid e-mail address.', 'bad_email'); if (byEmail(email)) fail('Another account uses that e-mail.', 'email_taken');
      if (u.password && !(await api.verifyPassword(u, o.password))) { await noteFail(u, 'change e-mail'); fail('The password is not correct.', 'bad_credentials'); }
      u.email = email; u.emailVerified = false; log(u, 'E-mail changed'); await save(); return { user: pub(u) };
    },
    totpBegin() { const u = me(); if (u.totp && u.totp.on) fail('Two-factor authentication is already on.', 'already'); const secret = b32enc(crypto.randomBytes(20)), uri = `otpauth://totp/${encodeURIComponent('NEXORA Studio:' + u.email)}?secret=${secret}&issuer=${encodeURIComponent('NEXORA Studio')}&algorithm=SHA1&digits=6&period=30`, qr = qrEncode(uri); pendingTotp = { uid: u.id, secret, exp: Date.now() + 15 * 60000 }; return { secret: secret.match(/.{1,4}/g).join(' '), uri, qr: { size: qr.size, rows: qr.rows } }; },
    async totpConfirm(o) {
      const u = me(); if (!pendingTotp || pendingTotp.uid !== u.id || pendingTotp.exp < Date.now()) fail('This setup has expired. Please start again.', 'expired');
      const s = totpMatch(pendingTotp.secret, String(o.code || '').replace(/\s/g, ''), 0); if (s < 0) fail('That code is not correct. Check that your phone\'s clock is right.', 'bad_code');
      u.totp = { secret: pendingTotp.secret, on: true, step: s, at: Date.now() }; pendingTotp = null; const recovery = issueRecovery(u); log(u, 'Two-factor authentication turned on'); await save(); return { user: pub(u), recovery };
    },
    /** proves a second factor (authenticator or recovery code) or the password before a sensitive change */
    async proveFactor(u, o, what) {
      checkLock(u); const code = String(o.code || '').replace(/\s/g, ''); let good = false;
      if (u.totp && u.totp.on) { const s = totpMatch(u.totp.secret, code, u.totp.step); if (s >= 0) { u.totp.step = s; good = true; } else good = useRecovery(u, code); }
      else if (u.password) good = await api.verifyPassword(u, o.password);
      else good = useRecovery(u, code) || (o.confirm && normEmail(o.confirm) === u.email);
      if (!good) { await noteFail(u, what); fail('That could not be verified.', 'bad_code'); }
    },
    async totpDisable(o) { const u = me(); await api.proveFactor(u, o, 'turn off 2FA'); u.totp = null; log(u, 'Two-factor authentication turned off'); await save(); return { user: pub(u) }; },
    async recoveryRegenerate(o) { const u = me(); await api.proveFactor(u, o, 'new recovery codes'); const recovery = issueRecovery(u); log(u, 'New recovery codes'); await save(); return { user: pub(u), recovery }; },
    async setEmailOtp(o) { const u = me(); if (o.on && !smtpOn()) fail('Set up e-mail delivery first.', 'no_smtp'); if (o.on && !u.emailVerified) fail('Verify your e-mail first.', 'not_verified'); u.emailOtp = !!o.on; log(u, o.on ? 'E-mail codes turned on' : 'E-mail codes turned off'); await save(); return { user: pub(u) }; },
    oauth: (id, o) => external(id, o),
    oauthCancel() { if (flow && flow.cancel) flow.cancel(); return {}; },
    async unlink(o) { const u = me(), key = o.key; if (!u.links || !u.links[key]) fail('Not connected.', 'bad_provider'); if (!u.password && Object.keys(u.links).length < 2) fail('Add a password first, or you could not sign in any more.', 'last_method'); delete u.links[key]; log(u, 'Disconnected ' + key); await save(); return { user: pub(u) }; },
    activity() { return { log: me().log || [] }; },
    exportData() { const u = me(), p = pub(u); delete p.avatar; return { exported: new Date().toISOString(), account: p, activity: u.log || [] }; },
    async deleteAccount(o) {
      const u = me(); await api.proveFactor(u, o, 'delete account'); if (normEmail(o.confirm) !== u.email) fail('Type your e-mail address to confirm.', 'bad_confirm');
      delete db.users[u.id]; session = null; pending = null; db.session = null; await save(); return {};
    },
    providers() { load(); return { list: Object.keys(PROVIDERS).map(id => { const p = PROVIDERS[id], c = cfgOf(id); return { id, name: id === 'oidc' && c.label ? c.label : p.name, flow: p.flow, configured: configured(id), clientId: c.clientId || '', hasSecret: !!c.clientSecret, needsSecret: p.secret || false, issuer: c.issuer || '', label: c.label || '', help: p.help, console: p.console, redirect: p.flow === 'device' ? '' : `http://${p.host}` + (id === 'microsoft' ? '' : ':<any port>/callback') }; }) }; },
    async providerSet(id, o) {
      load(); if (!PROVIDERS[id]) fail('Unknown provider.', 'bad_provider'); const cur = db.providers[id] = db.providers[id] || {}, s = v => String(v || '').trim().slice(0, 500);
      cur.clientId = s(o.clientId); if (o.clientSecret !== undefined && o.clientSecret !== '') cur.clientSecret = s(o.clientSecret); if (o.clearSecret) delete cur.clientSecret;
      if (id === 'oidc') { if (o.issuer) secureUrl(o.issuer); cur.issuer = s(o.issuer); cur.label = s(o.label).slice(0, 40); }
      await save(); return api.providers();
    },
    smtpGet() { const c = me() && db.smtp; return c ? { host: c.host, port: c.port, secure: !!c.secure, user: c.user || '', from: c.from || '', hasPass: !!c.pass } : { host: '', port: 587, secure: false, user: '', from: '', hasPass: false }; },
    async smtpSet(o) {
      me(); if (!o.host) { db.smtp = null; await save(); return {}; }
      const port = +o.port; if (!(port > 0 && port < 65536)) fail('Enter a valid port.', 'bad_port'); if (!okEmail(normEmail(o.from || o.user))) fail('Enter the address mail should be sent from.', 'bad_email');
      const prev = db.smtp || {}; db.smtp = { host: String(o.host).trim().slice(0, 253), port, secure: !!o.secure, user: String(o.user || '').trim().slice(0, 254), pass: o.pass ? String(o.pass) : prev.pass || '', from: normEmail(o.from || o.user) }; await save(); return {};
    },
    async smtpTest() { const u = me(); if (!smtpOn()) fail('Save the mail server first.', 'no_smtp'); await smtpSend(db.smtp, u.email, 'NEXORA Studio e-mail test', 'E-mail delivery is working.'); return {}; }
  };
  const cloud = require('./cloud').install(api, { app, safeStorage, logLine, Fail, qrEncode, open: u => opener(u), testMode });
  const gas = require('./gas').install(api, { app, safeStorage, logLine, Fail, qrEncode, testMode, scrypt, SC, checkPassword });
  const PUBLIC = ['status', 'signUp', 'signIn', 'verify2fa', 'send2faEmail', 'cancel2fa', 'emailCodeRequest', 'emailCodeSignIn', 'verifyEmailSend', 'verifyEmailConfirm', 'resetRequest', 'resetPassword', 'signOut', 'updateProfile', 'changePassword', 'changeEmail', 'totpBegin', 'totpConfirm', 'totpDisable', 'recoveryRegenerate', 'setEmailOtp', 'oauth', 'oauthCancel', 'unlink', 'activity', 'exportData', 'deleteAccount', 'providers', 'providerSet', 'smtpGet', 'smtpSet', 'smtpTest', 'verifySignup', 'resendSignup', 'gasGet', 'gasSet', 'gasScript'];
  for (const n of PUBLIC) ipcMain.handle('nxauth:' + n, async (e, ...a) => {
    sendEvent = (type, data) => { try { e.sender.send('nxauth:event', type, data); } catch (x) { } };
    if (!/^file:/.test((e.senderFrame && e.senderFrame.url) || '')) return { ok: false, error: 'Not allowed.', code: 'forbidden' };
    try { return { ok: true, ...(await api[n](...a)) }; }
    catch (err) { if (!err.expose) logLine('auth error', n, err); return { ok: false, error: err.expose ? err.message : 'Something went wrong. Please try again.', code: err.code || 'error' }; }
  });
  /* automated tests only: everything uses the separate accounts-test store */
  if (testMode) require('./auth-testkit').register(ipcMain, { cloud, gas, PROVIDERS, smtpSend, setOpener: f => { opener = f; }, reset: async () => { db = { v: 1, users: {}, providers: {}, smtp: null, session: null }; session = null; pending = null; pendingTotp = null; codes.clear(); await save(); }, totpNow: uid => { const u = db.users[uid] || users().find(x => x.email === uid), s = nowStep(); return hotp(b32dec(pendingTotp && !u.totp ? pendingTotp.secret : u.totp.secret), s); }, totpAt: (b32, step) => hotp(b32dec(b32), step), expireLock: e => { const u = byEmail(e); if (u && u.lock) u.lock.until = 0; }, step: nowStep, qrEncode, rawFile: () => fs.readFileSync(file).toString('latin1'), reload: () => { db = null; session = null; load(); return !!session; }, passwordMeta: e => { const p = byEmail(e).password; return { N: p.N, r: p.r, p: p.p, saltLen: Buffer.from(p.salt, 'base64').length, hashLen: Buffer.from(p.hash, 'base64').length }; } });
  return api;
}
module.exports = { create };
