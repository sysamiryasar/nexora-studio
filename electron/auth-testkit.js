'use strict';
/* Loaded only with --nx-hidden (automated tests). A real local OpenID Connect provider (RS256 keys, discovery, JWKS, PKCE
   check), a GitHub-style device-flow server and an SMTP sink, so the actual sign-in code runs end to end over HTTP/SMTP. */
const crypto = require('crypto'), http = require('http'), net = require('net');
const b64u = b => Buffer.from(b).toString('base64url');

function register(ipcMain, kit) {
  const S = { idp: null, smtp: null, mails: [], mode: 'ok', sub: 'user-1', email: 'idp.user@example.com', verified: true, deviceCalls: 0, verifierOk: null };
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const codes = new Map();
  function idToken(claims, key) { const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })), p = b64u(JSON.stringify(claims)); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url')}`; }
  function startIdp() {
    return new Promise(res => {
      const srv = http.createServer(async (req, rs) => {
        const u = new URL(req.url, 'http://127.0.0.1'), base = `http://127.0.0.1:${srv.address().port}`, json = (o, c = 200) => { rs.writeHead(c, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
        let body = ''; for await (const c of req) body += c; const f = new URLSearchParams(body);
        if (u.pathname.startsWith('/auth/v1')) return goTrue(req, rs, u, body, json);
        if (u.pathname === '/.well-known/openid-configuration') return json({ issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', jwks_uri: base + '/jwks', userinfo_endpoint: base + '/userinfo' });
        if (u.pathname === '/jwks') return json({ keys: [jwk] });
        if (u.pathname === '/authorize') { const c = crypto.randomBytes(8).toString('hex'); codes.set(c, { nonce: u.searchParams.get('nonce'), challenge: u.searchParams.get('code_challenge'), client: u.searchParams.get('client_id'), redirect: u.searchParams.get('redirect_uri') }); rs.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?${new URLSearchParams(S.mode === 'badstate' ? { code: c, state: 'forged' } : S.mode === 'deny' ? { error: 'access_denied', state: u.searchParams.get('state') } : { code: c, state: u.searchParams.get('state') })}` }); return rs.end(); }
        if (u.pathname === '/token') {
          const c = codes.get(f.get('code')); if (!c) return json({ error: 'invalid_grant' }, 400); codes.delete(f.get('code'));
          S.verifierOk = b64u(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest()) === c.challenge && f.get('redirect_uri') === c.redirect; if (!S.verifierOk) return json({ error: 'invalid_grant', error_description: 'PKCE failed' }, 400);
          const now = Math.floor(Date.now() / 1000), claims = { iss: S.mode === 'badiss' ? 'https://evil.example' : base, aud: S.mode === 'badaud' ? 'someone-else' : c.client, sub: S.sub, exp: now + (S.mode === 'expired' ? -3600 : 3600), iat: now, nonce: S.mode === 'badnonce' ? 'x' : c.nonce, email: S.email, email_verified: S.verified, name: 'Idp User' };
          return json({ access_token: 'at', token_type: 'Bearer', id_token: idToken(claims, S.mode === 'badsig' ? other.privateKey : privateKey) });
        }
        if (u.pathname === '/device') return json({ device_code: 'dev1', user_code: 'ABCD-1234', verification_uri: base + '/activate', expires_in: 60, interval: 1 });
        if (u.pathname === '/device-token') { S.deviceCalls++; return json(S.deviceCalls < 2 ? { error: 'authorization_pending' } : { access_token: 'gh' }); }
        if (u.pathname === '/user') return json({ id: 4242, login: 'ghuser', name: 'Git Hub', avatar_url: '' });
        if (u.pathname === '/emails') return json([{ email: 'gh.user@example.com', primary: true, verified: true }]);
        rs.writeHead(200); rs.end('ok');
      });
      srv.listen(0, '127.0.0.1', () => { S.idp = srv; res(`http://127.0.0.1:${srv.address().port}`); });
    });
  }
  const follow = async url => { let r = await fetch(url, { redirect: 'manual' }); while (r.status >= 300 && r.status < 400) r = await fetch(r.headers.get('location'), { redirect: 'manual' }); return r.text(); };
  function startSmtp() {
    return new Promise(res => {
      const srv = net.createServer(sock => {
        sock.write('220 test\r\n'); let inData = false, data = '', buf = '', env = {};
        sock.on('data', d => { buf += d.toString('utf8'); let i;
          while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2);
            if (inData) { if (l === '.') { inData = false; S.mails.push({ ...env, data }); data = ''; sock.write('250 ok\r\n'); } else data += l + '\n'; continue; }
            if (/^EHLO/i.test(l)) sock.write('250-test\r\n250 AUTH PLAIN\r\n'); else if (/^AUTH/i.test(l)) sock.write('235 ok\r\n'); else if (/^MAIL/i.test(l)) { env.from = l; sock.write('250 ok\r\n'); } else if (/^RCPT/i.test(l)) { env.to = l; sock.write('250 ok\r\n'); } else if (/^DATA/i.test(l)) { inData = true; sock.write('354 go\r\n'); } else if (/^QUIT/i.test(l)) { sock.write('221 bye\r\n'); sock.end(); } else sock.write('250 ok\r\n'); } });
        sock.on('error', () => { });
      });
      srv.listen(0, '127.0.0.1', () => { S.smtp = srv; res(srv.address().port); });
    });
  }
  /* a small stand-in for Supabase Auth's REST API */
  const G = { users: [], codes: new Map(), calls: [] }, jwt = (u, aal) => `x.${b64u(JSON.stringify({ sub: u.id, aal }))}.y`, sess = (u, aal) => ({ access_token: jwt(u, aal), refresh_token: 'r' + u.id + aal, expires_in: 3600, user: view(u) }), view = u => ({ id: u.id, email: u.email, created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: u.meta, factors: u.factors, identities: u.identities });
  function who(req) { const m = /Bearer x\.([^.]+)\./.exec(req.headers.authorization || ''); if (!m) return null; const c = JSON.parse(Buffer.from(m[1], 'base64url')); const u = G.users.find(x => x.id === c.sub); if (u) u._aal = c.aal; return u; }
  function goTrue(req, rs, u, raw, json) {
    const p = u.pathname.slice(8), b = raw ? JSON.parse(raw) : {}, type = u.searchParams.get('grant_type'), err = (c, code, msg) => json({ error_code: code, msg }, c); G.calls.push({ p, key: req.headers.apikey });
    if (req.headers.apikey !== 'pk_test' && p !== '/authorize') return err(401, 'bad_key', 'no key');   // the browser step carries no key
    if (p === '/signup') { if (G.users.some(x => x.email === b.email)) return err(422, 'user_already_exists', 'exists'); const n = { id: 'c' + G.users.length, email: b.email, pass: b.password, meta: b.data || {}, factors: [], identities: [{ provider: 'email', created_at: '2026-01-01T00:00:00Z' }] }; G.users.push(n); return json(S.confirm ? { id: n.id, email: n.email } : sess(n, 'aal1')); }
    if (p === '/token' && type === 'password') { const n = G.users.find(x => x.email === b.email && x.pass === b.password); return n ? json(sess(n, 'aal1')) : err(400, 'invalid_credentials', 'Invalid login credentials'); }
    if (p === '/token' && type === 'refresh_token') { const n = G.users.find(x => b.refresh_token.startsWith('r' + x.id)); return n ? json(sess(n, b.refresh_token.endsWith('aal2') ? 'aal2' : 'aal1')) : err(400, 'refresh', 'bad'); }
    if (p === '/authorize') { const c = crypto.randomBytes(6).toString('hex'); G.codes.set(c, { ch: u.searchParams.get('code_challenge'), provider: u.searchParams.get('provider') }); rs.writeHead(302, { Location: u.searchParams.get('redirect_to') + '?code=' + c }); return rs.end(); }
    if (p === '/token' && type === 'pkce') { const c = G.codes.get(b.auth_code); if (!c || b64u(crypto.createHash('sha256').update(b.code_verifier).digest()) !== c.ch) return err(400, 'pkce', 'bad'); let n = G.users.find(x => x.oauth === c.provider); if (!n) { n = { id: 'c' + G.users.length, email: c.provider + '@example.com', oauth: c.provider, meta: { full_name: 'Provider User' }, factors: [], identities: [{ provider: c.provider, identity_data: { email: c.provider + '@example.com' }, created_at: '2026-01-01T00:00:00Z' }] }; G.users.push(n); } return json(sess(n, 'aal1')); }
    if (p === '/recover' || p === '/otp') return json({});
    if (p === '/verify') { const n = G.users.find(x => x.email === b.email); return n && b.token === '654321' ? json(sess(n, 'aal1')) : err(403, 'otp_expired', 'bad'); }
    const me = who(req); if (!me) return err(401, 'no_auth', 'no');
    if (p === '/user' && req.method === 'GET') return json(view(me));
    if (p === '/user' && req.method === 'PUT') { if (b.password) me.pass = b.password; if (b.data) Object.assign(me.meta, b.data); if (b.email) me.email = b.email; return json(view(me)); }
    if (p === '/logout') return json({});
    if (p === '/factors') { const id = 'f' + me.factors.length; me.factors.push({ id, factor_type: 'totp', status: 'unverified' }); return json({ id, totp: { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } }); }
    const f = /^\/factors\/([^/]+)(\/(challenge|verify))?$/.exec(p);
    if (f && f[3] === 'challenge') return json({ id: 'ch1' });
    if (f && f[3] === 'verify') { if (b.code !== '123456') return err(422, 'mfa_verification_failed', 'bad'); me.factors.find(x => x.id === f[1]).status = 'verified'; return json(sess(me, 'aal2')); }
    if (f && req.method === 'DELETE') { me.factors = me.factors.filter(x => x.id !== f[1]); return json({}); }
    return err(404, 'nf', 'nf');
  }
  /* the real Code.gs in a sandbox, with in-memory stand-ins for the Google services it calls */
  const GS = { srv: null, sheets: {}, mails: [], props: {}, ctx: null, replies: new Map(), bodies: [], htmlOnce: false };
  const signed = b => [...b].map(x => x > 127 ? x - 256 : x), bytes = a => Buffer.from(typeof a === 'string' ? Buffer.from(a, 'utf8') : a.map(x => x & 255));
  function gasContext() {
    const mkSheet = name => { const s = { name, data: [], appendRow(r) { s.data.push(r.map(v => (typeof v === 'string' && /^=/.test(v)) ? { formula: v } : v)); }, setFrozenRows() { }, getDataRange: () => ({ getValues: () => s.data.map(r => r.slice()) }), getRange: (row, col, nr, nc) => ({ setValues(v) { for (let j = 0; j < nc; j++) s.data[row - 1][col - 1 + j] = v[0][j]; } }), deleteRow(n) { s.data.splice(n - 1, 1); } }; return s; };
    const vm = require('vm'), fs = require('fs'), path = require('path');
    GS.sheets = {}; GS.mails = []; GS.props = {};
    const c = { console, Date, Math, JSON, String, parseInt, encodeURIComponent, SpreadsheetApp: (() => { const book = { getId: () => 'book1', getSheetByName: n => GS.sheets[n] || null, insertSheet: n => (GS.sheets[n] = mkSheet(n)) }; return { getActiveSpreadsheet: () => GS.standalone ? null : book, create: () => { GS.created = (GS.created || 0) + 1; return book; }, openById: () => book }; })(), ContentService: { MimeType: { JSON: 'j' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) }, LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) }, PropertiesService: { getScriptProperties: () => ({ getProperty: k => GS.props[k] === undefined ? null : GS.props[k], setProperty: (k, v) => { GS.props[k] = v; } }) }, MailApp: { getRemainingDailyQuota: () => 100, sendEmail: m => GS.mails.push(m) }, Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, MacAlgorithm: { HMAC_SHA_1: 'sha1' }, getUuid: () => crypto.randomUUID(), computeDigest: (a, s) => signed(crypto.createHash(a).update(s, 'utf8').digest()), computeHmacSignature: (a, v, k) => signed(crypto.createHmac(a, bytes(k)).update(bytes(v)).digest()) } };
    vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(__dirname, 'google-apps-script', 'Code.gs'), 'utf8'), c); GS.ctx = c;
  }
  function startGas() { return new Promise(res => { const srv = http.createServer(async (req, rs) => { const u = new URL(req.url, 'http://127.0.0.1'); if (u.pathname === '/echo') { const t = GS.replies.get(u.searchParams.get('id')) || '{}'; rs.writeHead(200, { 'Content-Type': 'application/json' }); return rs.end(t); } let body = ''; for await (const c of req) body += c; if (GS.htmlOnce) { GS.htmlOnce = false; rs.writeHead(200, { 'Content-Type': 'text/html' }); return rs.end('<html>Sign in to Google</html>'); } GS.bodies.push(body); const out = GS.ctx.doPost({ postData: { contents: body } }), id = crypto.randomBytes(4).toString('hex'); GS.replies.set(id, out.text); rs.writeHead(302, { Location: `http://127.0.0.1:${srv.address().port}/echo?id=${id}` }); rs.end(); }); srv.listen(0, '127.0.0.1', () => { GS.srv = srv; res(`http://127.0.0.1:${srv.address().port}/exec`); }); }); }
  const orig = JSON.parse(JSON.stringify(kit.PROVIDERS, (k, v) => typeof v === 'function' ? undefined : v));
  ipcMain.handle('nxauthtest', async (_e, op, a) => {
    switch (op) {
      case 'reset': kit.PROVIDERS.oidc.scope = orig.oidc.scope; await kit.reset(); S.mails = []; S.mode = 'ok'; S.sub = 'user-1'; S.email = 'idp.user@example.com'; S.verified = true; S.deviceCalls = 0; kit.setOpener(follow); return true;
      case 'idp': { if (S.idp) return `http://127.0.0.1:${S.idp.address().port}`; return startIdp(); }
      case 'smtp': { if (S.smtp) return S.smtp.address().port; return startSmtp(); }
      case 'set': Object.assign(S, a); return true;
      case 'mails': return S.mails;
      case 'verifierOk': return S.verifierOk;
      /* point a built-in provider's endpoints at the local provider, so its real code path (issuer rule included) runs */
      case 'cloud': G.users = []; G.codes.clear(); G.calls = []; S.confirm = false; kit.setOpener(follow); kit.cloud.set(a); return true;
      case 'cloudReload': kit.cloud.reload(); return true;
      case 'cloudCalls': return G.calls;
      case 'gasStart': { gasContext(); kit.gas.wipe(); const u = GS.srv ? `http://127.0.0.1:${GS.srv.address().port}/exec` : await startGas(); GS.bodies = []; return u; }
      case 'gasStandalone': GS.standalone = !!a; GS.created = 0; return true;
      case 'gasCreated': return GS.created;
      case 'gasMails': return GS.mails;
      case 'gasDump': return JSON.stringify(GS.sheets);
      case 'gasBodies': return GS.bodies;
      case 'gasHtml': GS.htmlOnce = true; return true;
      case 'gasReload': kit.gas.reload(); return true;
      case 'gasAge': { const s = GS.sheets.Codes; if (s) for (let i = 1; i < s.data.length; i++) { s.data[i][4] = 0; } const u = GS.sheets.Users; if (u) for (let i = 1; i < u.data.length; i++) u.data[i][11] = 0; return true; }
      case 'gasCap': GS.props['mail:' + new Date().toISOString().slice(0, 10)] = String(a); return true;
      case 'route': { const base = a.base, p = kit.PROVIDERS[a.id]; if (p.flow === 'device') Object.assign(p, { device: base + '/device', token: base + '/device-token', user: base + '/user', emails: base + '/emails' }); else Object.assign(p, { auth: base + '/authorize', token: base + '/token', jwks: base + '/jwks', iss: i => i === base }); S.deviceCalls = 0; return true; }
      case 'totp': return kit.totpNow(a);
      case 'totpAt': return kit.totpAt(a.secret, a.step);
      case 'step': return kit.step();
      case 'unlock': kit.expireLock(a); return true;
      case 'qr': return kit.qrEncode(a);
      case 'raw': return kit.rawFile();
      case 'reload': return kit.reload();
      case 'pwmeta': return kit.passwordMeta(a);
    }
  });
}
module.exports = { register };
