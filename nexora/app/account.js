'use strict';
/* ====================== NEXORA accounts: sign-in screen and Profile ======================
   All security decisions live in electron/auth.js; this file only draws the forms and calls window.nxauth. */
const Account = (() => {
  const A = window.nxauth || null, S = { user: null, status: null, providers: [], view: 'signin', guest: false, offDevice: null, off2: null };
  const $$ = id => document.getElementById(id);
  const on = !!A, cloud = () => !!(S.status && S.status.cloud), ENABLED = ['github'], usable = () => S.providers.filter(p => ENABLED.includes(p.id) && p.configured), orRow = () => usable().length ? el('div', { class: 'au-or' }, el('span', {}, 'or')) : null;
  const uid = () => S.user ? S.user.id : null;
  const prefs = () => (S.user && S.user.prefs) || {};
  const LOGOS = {
    google: '<path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.3-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1V16A10 10 0 0 0 12 22zM6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9zM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z"/>',
    microsoft: '<path fill="currentColor" d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z"/>',
    github: '<path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.5-1.1-4.5-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.8 1a9.600 9.600 0 0 1 5 0c1.900-1.300 2.800-1 2.800-1 .6 1.400.2 2.400.1 2.700a3.900 3.900 0 0 1 1 2.700c0 3.900-2.300 4.700-4.500 5 .4.300.7.900.7 1.900V21c0 .3.200.6.700.5A10 10 0 0 0 12 2z"/>',
    oidc: '<path fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round" d="M14.500 9.500a4.500 4.500 0 1 0-1 2.800L21 20M18 17l2-2"/>'
  };
  const logo = id => { const s = el('span', { class: 'au-logo' }); s.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18">${LOGOS[id] || ''}</svg>`; return s; };
  const initials = n => String(n || '?').trim().split(/[\s@._-]+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
  const avatar = (u, size) => { const d = el('span', { class: 'au-avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * .4)}px` }); if (u && u.avatar) { const i = el('img', { alt: '' }); i.src = u.avatar; d.append(i); } else d.textContent = initials(u && u.name); return d; };
  const input = (o) => el('input', { spellcheck: 'false', ...o });

  /* a small form helper: disables its button while working and shows errors inline */
  function form(fields, label, submit, extra) {
    const err = el('div', { class: 'au-err hidden', role: 'alert' }), btn = el('button', { class: 'primary au-submit', type: 'submit' }, label);
    const f = el('form', { class: 'au-form', novalidate: '', onsubmit: async e => { e.preventDefault(); err.classList.add('hidden'); btn.disabled = true; try { await submit(msg => { err.textContent = msg; err.classList.remove('hidden'); }); } catch (x) { err.textContent = x.message || 'Something went wrong.'; err.classList.remove('hidden'); } finally { btn.disabled = false; } } }, ...fields, err, btn, ...(extra || []));
    return f;
  }
  const row = (label, node, hint) => el('label', { class: 'au-row' }, el('span', {}, label), node, hint ? el('small', { class: 'dim' }, hint) : null);
  const link = (t, fn) => el('button', { type: 'button', class: 'au-link', onclick: fn }, t);
  const must = (r, show) => { if (r.ok) return true; show(r.error); return false; };
  function meter(inp) { const bar = el('i', {}), box = el('div', { class: 'au-meter' }, bar); inp.addEventListener('input', () => { const p = inp.value; let s = Math.min(4, Math.floor(p.length / 5)); if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^\w]/.test(p)) s++; bar.style.width = (p.length < 10 ? Math.min(30, p.length * 3) : Math.min(100, s / 7 * 100)) + '%'; }); return box; }
  function downloadText(name, text) { download(new Blob([text], { type: 'text/plain' }), name); }

  /* ---------- sign-in gate ---------- */
  function gate() { let g = $$('authGate'); if (!g) { g = el('div', { id: 'authGate' }); document.body.append(g); } return g; }
  function shell(title, sub, ...content) {
    const g = gate(); g.classList.remove('hidden'); g.innerHTML = '';
    g.append(el('div', { class: 'au-card' }, el('div', { class: 'au-brand' }, el('div', { class: 'brand-mark' }), 'NEXORA Studio'), el('h1', {}, title), sub ? el('p', { class: 'au-sub' }, sub) : null, ...content));
    const first = g.querySelector('input:not([type=checkbox])'); if (first) first.focus();
  }
  function hideGate() { const g = $$('authGate'); if (g) g.classList.add('hidden'); }
  async function refreshProviders() { const r = await A.providers(); S.providers = r.list || []; }
  const remember = { v: true };
  const rememberBox = () => el('label', { class: 'au-check' }, el('input', { type: 'checkbox', checked: remember.v ? '' : undefined, onchange: e => remember.v = e.target.checked }), 'Keep me signed in on this computer');

  function providerButtons(link_) {
    if (!usable().length) return null; return el('div', { class: 'au-providers' }, usable().map(p => el('button', { type: 'button', class: 'au-prov', 'data-provider': p.id, onclick: () => p.configured ? startProvider(p, link_) : viewProviders(p.id) }, logo(p.id), 'Continue with ' + p.name)));
  }
  async function startProvider(p, link_) {
    if (S.offDevice) S.offDevice();
    shell(`Continue with ${p.name}`, p.flow === 'device' ? 'Waiting for GitHub…' : 'Finish signing in in your browser. This window will update by itself.', el('div', { class: 'au-wait' }), el('button', { type: 'button', onclick: () => A.oauthCancel() }, 'Cancel'));
    S.offDevice = A.onEvent((type, d) => { if (type === 'device') showDevice(d); });
    const r = await A.oauth(p.id, { remember: remember.v, link: !!link_ }); S.offDevice(); S.offDevice = null;
    if (link_) { hideGate(); if (r.ok) { S.user = r.user; toast(p.name + ' connected.'); } else toast(r.error); page(); return; }
    if (!r.ok) return signin(r.code === 'cancelled' ? '' : r.error);
    handle(r);
  }
  function showDevice(d) {
    const code = el('div', { class: 'au-devcode' }, d.code);
    shell('Continue with GitHub', 'Enter this code on the GitHub page that just opened.', code, el('div', { style: 'display:flex;gap:8px;justify-content:center' }, el('button', { type: 'button', onclick: () => navigator.clipboard.writeText(d.code).then(() => toast('Code copied')) }, 'Copy code'), el('button', { type: 'button', onclick: () => A.oauthCancel() }, 'Cancel')));
  }
  function handle(r) {
    if (r.twoFactor) return twoFactor(r);
    if (r.verifyEmail) return verifySignup(r.email);
    if (r.confirmEmail) return signin('Check ' + r.email + ' for a confirmation link, then sign in.');
    if (r.recovery) return showRecovery(r.recovery, () => done(r.user), r.verifySent);
    done(r.user);
  }
  function done(user) { S.user = user; S.guest = false; localStorage.removeItem('nexora.guest'); hideGate(); applied(); }
  function applied() { if (typeof Shell !== 'undefined' && Shell.refreshHome) Shell.refreshHome(); paintBadge(); }

  function signin(msg) {
    S.view = 'signin';
    const email = input({ type: 'email', placeholder: 'you@studio.com', autocomplete: 'username', id: 'auEmail' }), pass = input({ type: 'password', placeholder: 'Password', autocomplete: 'current-password', id: 'auPass' });
    const f = form([row('E-mail', email), row('Password', pass), rememberBox()], 'Sign in', async show => { if (!email.value || !pass.value) return show('Enter your e-mail and password.'); const r = await A.signIn({ email: email.value, password: pass.value, remember: remember.v }); if (r.code === 'not_verified') { await A.resendSignup({ email: email.value }); return verifySignup(email.value.trim()); } if (must(r, show)) handle(r); });
    shell('Sign in', 'Back to the cut.', providerButtons(), orRow(), msg ? el('div', { class: 'au-err' }, msg) : null, f,
      el('div', { class: 'au-links' }, link('Create an account', signup), link('Forgot password?', () => forgot(email.value)), S.status && S.status.smtp ? link('E-mail me a code', () => emailCode(email.value)) : null),
      el('div', { class: 'au-foot' }, link('Continue without an account', () => { S.guest = true; localStorage.setItem('nexora.guest', '1'); hideGate(); applied(); }), S.status && S.status.gasBuiltIn ? null : link(S.status && S.status.online ? 'Online accounts: on' : 'Connect online accounts', viewOnline)));
  }
  function signup() {
    const name = input({ placeholder: 'Your name', autocomplete: 'name' }), email = input({ type: 'email', placeholder: 'you@studio.com', autocomplete: 'username' }), pass = input({ type: 'password', placeholder: 'At least 10 characters', autocomplete: 'new-password' }), p2 = input({ type: 'password', placeholder: 'Repeat the password', autocomplete: 'new-password' });
    const f = form([row('Name', name), row('E-mail', email), row('Password', pass), meter(pass), row('Confirm password', p2), rememberBox()], 'Create account', async show => { if (pass.value !== p2.value) return show('The two passwords do not match.'); const r = await A.signUp({ name: name.value, email: email.value, password: pass.value, remember: remember.v }); if (must(r, show)) handle(r); });
    shell('Create your account', cloud() ? 'One account for every computer you work on. We will e-mail you a code.' : 'Your account stays on this computer, encrypted by Windows.', providerButtons(), orRow(), f, el('div', { class: 'au-links' }, link('Already have an account? Sign in', () => signin())));
  }
  function twoFactor(r) {
    let method = r.methods[0]; const codeIn = input({ inputmode: 'text', placeholder: '', autocomplete: 'one-time-code', id: 'au2fa', class: 'au-code' });
    const NAMES = { totp: ['Authenticator app', 'Enter the 6-digit code from your authenticator app.'], email: ['E-mail code', `We sent a 6-digit code to ${r.hint}.`], recovery: ['Recovery code', 'Enter one of your saved recovery codes. Each works once.'] };
    const hint = el('p', { class: 'au-sub' }), tabs = el('div', { class: 'au-tabs' });
    const pick = async m => { method = m; hint.textContent = NAMES[m][1]; codeIn.value = ''; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); codeIn.focus(); if (m === 'email') { const s = await A.send2faEmail(); if (!s.ok) toast(s.error); } };
    r.methods.forEach(m => tabs.append(el('button', { type: 'button', 'data-m': m, onclick: () => pick(m) }, NAMES[m][0])));
    const f = form([row('Code', codeIn)], 'Verify', async show => { const v = await A.verify2fa({ method, code: codeIn.value }); if (must(v, show)) done(v.user); });
    shell('Two-factor verification', null, r.methods.length > 1 ? tabs : null, hint, f, el('div', { class: 'au-links' }, link('Back to sign in', () => { A.cancel2fa(); signin(); })));
    pick(method);
  }
  function showRecovery(codes, next, verifySent) {
    const list = el('div', { class: 'au-codes' }, codes.map(c => el('code', {}, c))), text = 'NEXORA Studio recovery codes\nEach code works once.\n\n' + codes.join('\n') + '\n';
    const cont = el('button', { class: 'primary au-submit', disabled: '', onclick: next }, 'Continue');
    shell('Save your recovery codes', 'If you forget your password or lose your phone, these are the only way back in. They are shown only now.', list,
      el('div', { style: 'display:flex;gap:8px' }, el('button', { type: 'button', onclick: () => navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Copied')) }, 'Copy'), el('button', { type: 'button', onclick: () => downloadText('nexora-recovery-codes.txt', text) }, 'Save as file')),
      el('label', { class: 'au-check' }, el('input', { type: 'checkbox', id: 'auSaved', onchange: e => { cont.disabled = !e.target.checked; } }), 'I have saved these codes somewhere safe'), cont, verifySent ? el('p', { class: 'au-sub' }, 'We also sent a verification code to your e-mail. You can enter it under Profile.') : null);
  }
  function verifySignup(mail) {
    const code = input({ inputmode: 'numeric', placeholder: '6-digit code', class: 'au-code', autocomplete: 'one-time-code', id: 'auVerify' });
    const f = form([row('Code', code)], 'Verify e-mail', async show => { const r = await A.verifySignup({ email: mail, code: code.value, remember: remember.v }); if (must(r, show)) handle(r); });
    shell('Check your e-mail', `We sent a 6-digit code to ${mail}.`, f, el('div', { class: 'au-links' }, link('Send a new code', async () => { const r = await A.resendSignup({ email: mail }); toast(r.ok ? 'New code sent.' : r.error); }), link('Back to sign in', () => signin())));
  }
  async function viewOnline() {
    const g = await A.gasGet(), u = input({ value: g.url, placeholder: 'https://script.google.com/macros/s/.../exec', id: 'auGas' });
    const f = form([row('Web App address', u)], g.connected ? 'Save' : 'Connect', async show => { const r = await A.gasSet({ url: u.value }); if (!must(r, show)) return; S.status = await A.status(); await refreshProviders(); toast('Online accounts connected.'); signin(); });
    shell('Online accounts', 'Use your own Google Sheet, so accounts work on every computer and e-mails carry real codes.', el('ol', { class: 'au-steps' }, el('li', {}, 'Create a Google Sheet, then open Extensions > Apps Script.'), el('li', {}, 'Delete what is there, and paste the server script.'), el('li', {}, 'Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.'), el('li', {}, 'Approve the permissions, then copy the address ending in /exec.')), el('button', { type: 'button', style: 'margin-bottom:10px', onclick: async () => { const r = await A.gasScript(); await navigator.clipboard.writeText(r.code); toast('Server script copied.'); } }, 'Copy server script'), f, el('div', { class: 'au-links' }, g.connected ? link('Disconnect', async () => { await A.gasSet({ url: '' }); S.status = await A.status(); await refreshProviders(); signin('Back to accounts on this computer.'); }) : null, link('Back', () => signin())));
  }
  function forgot(prefill) {
    let via = cloud() ? 'email' : 'recovery'; const email = input({ type: 'email', value: prefill || '', placeholder: 'you@studio.com' }), code = input({ placeholder: 'XXXXX-XXXXX' }), pass = input({ type: 'password', placeholder: 'At least 10 characters', autocomplete: 'new-password' });
    const sendBtn = S.status && S.status.smtp ? el('button', { type: 'button', onclick: async () => { const r = await A.resetRequest({ email: email.value }); if (r.ok) { via = 'email'; code.placeholder = '6-digit code from your e-mail'; toast('If that account exists, a code is on its way.'); } else toast(r.error); } }, 'E-mail me a reset code') : null;
    const f = form([row('E-mail', email), row(cloud() ? 'Code from your e-mail' : 'Recovery code', code, cloud() ? 'Press the button above first.' : 'One of the codes you saved when you created the account.'), sendBtn, row('New password', pass), meter(pass)].filter(Boolean), 'Reset password', async show => { const r = await A.resetPassword({ email: email.value, code: code.value, password: pass.value, via }); if (must(r, show)) signin('Password changed. Sign in with your new password.'); });
    shell('Reset your password', null, f, el('div', { class: 'au-links' }, link('Back to sign in', () => signin())));
  }
  function emailCode(prefill) {
    const email = input({ type: 'email', value: prefill || '', placeholder: 'you@studio.com' }), code = input({ inputmode: 'numeric', placeholder: '6-digit code', class: 'au-code' });
    const f = form([row('E-mail', email), el('button', { type: 'button', onclick: async () => { const r = await A.emailCodeRequest({ email: email.value }); toast(r.ok ? 'If that account exists and is verified, a code is on its way.' : r.error); } }, 'Send code'), row('Code', code)], 'Sign in', async show => { const r = await A.emailCodeSignIn({ email: email.value, code: code.value, remember: remember.v }); if (must(r, show)) handle(r); });
    shell('Sign in with an e-mail code', null, f, el('div', { class: 'au-links' }, link('Back to sign in', () => signin())));
  }
  /* ---------- provider setup ---------- */
  async function viewProviders(focus) {
    await refreshProviders();
    const back = () => { if (S.user) { hideGate(); page('connected'); } else signin(); };
    const list = el('div', { class: 'au-provlist' });
    S.providers.filter(p => ENABLED.includes(p.id) && (!focus || p.id === focus)).forEach(p => {
      const id = input({ value: p.clientId, placeholder: 'Client ID' }), sec = input({ type: 'password', placeholder: p.hasSecret ? 'Saved (leave blank to keep)' : 'Client secret' }), iss = input({ value: p.issuer, placeholder: 'https://login.example.com' }), lab = input({ value: p.label, placeholder: 'Company name' });
      const f = form([p.id === 'oidc' ? row('Issuer URL', iss) : null, p.id === 'oidc' ? row('Button name', lab) : null, row('Client ID', id), p.needsSecret ? row(p.needsSecret === true ? 'Client secret' : 'Client secret (if any)', sec) : null].filter(Boolean), 'Save', async show => { const r = await A.providerSet(p.id, { clientId: id.value, clientSecret: sec.value, issuer: iss.value, label: lab.value }); if (must(r, show)) { toast(p.name + ' saved.'); viewProviders(focus); } });
      list.append(el('div', { class: 'au-provbox' }, el('div', { class: 'au-provhead' }, logo(p.id), el('b', {}, p.name), el('span', { class: 'pill' + (p.configured ? ' au-ready' : '') }, p.configured ? 'Ready' : 'Not set up')), el('p', { class: 'dim' }, p.help), p.redirect ? el('p', { class: 'dim' }, 'Redirect URI: ', el('code', {}, p.redirect)) : null, p.console ? el('p', {}, link('Open the developer console', () => window.open(p.console))) : null, f));
    });
    shell('Sign-in providers', 'GitHub only allows sign-in for apps registered with it. Registration is free and takes about two minutes.', list, el('div', { class: 'au-links' }, link('Back', back)));
  }

  /* ---------- Profile page ---------- */
  function pageRoot() { let p = $$('acctPage'); if (!p) { p = el('div', { id: 'acctPage', class: 'hidden' }); document.body.append(p); } return p; }
  const fmtTime = t => t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  let tab = 'profile';
  function page(which) {
    if (which) tab = which; if (!S.user) return; const p = pageRoot(); p.classList.remove('hidden'); p.innerHTML = '';
    const TABS = cloud() ? [['profile', 'Profile'], ['security', 'Security'], ['connected', 'Connected accounts'], ['ai', 'AI']] : [['profile', 'Profile'], ['security', 'Security'], ['connected', 'Connected accounts'], ['email', 'E-mail delivery'], ['ai', 'AI'], ['activity', 'Activity']];
    const main = el('div', { class: 'ap-main' });
    p.append(el('aside', { class: 'ap-side' }, el('div', { class: 'ap-me' }, avatar(S.user, 48), el('div', { style: 'min-width:0' }, el('b', {}, S.user.name), el('small', { class: 'dim' }, S.user.email))),
      TABS.map(([k, n]) => el('button', { class: 'ap-tab' + (tab === k ? ' on' : ''), onclick: () => page(k) }, n)), el('div', { class: 'spacer' }), el('button', { class: 'ap-tab', id: 'apSignOut', onclick: signOut }, 'Sign out'), el('button', { class: 'ap-tab', onclick: closePage }, 'Close')), main);
    ({ profile: tabProfile, security: tabSecurity, connected: tabConnected, email: tabEmail, ai: tabAI, activity: tabActivity }[tab])(main);
  }
  function closePage() { const p = $$('acctPage'); if (p) p.classList.add('hidden'); paintBadge(); if (typeof Shell !== 'undefined' && Shell.refreshHome) Shell.refreshHome(); }
  async function signOut() { if (typeof Recovery !== 'undefined' && Projects.current) await Recovery.flush(); await A.signOut(); S.user = null; localStorage.removeItem('nexora.guest'); closePage(); if (typeof Projects !== 'undefined') Projects.current = null; if (typeof Shell !== 'undefined') Shell.go('home'); const st = await A.status(); S.status = st; await refreshProviders(); signin(); }
  const block = (t, ...k) => el('section', { class: 'ap-block' }, el('h2', {}, t), ...k);
  const update = r => { if (r.user) S.user = r.user; };
  function tabProfile(m) {
    const name = input({ value: S.user.name }), title = input({ value: S.user.title, placeholder: 'Editor, colorist, motion designer…' }), RES = { '1280x720': 'HD 1280×720', '1920x1080': 'Full HD 1920×1080', '2560x1440': 'QHD 2560×1440', '3840x2160': '4K UHD 3840×2160', '4096x2160': 'DCI 4K 4096×2160', '7680x4320': '8K UHD 7680×4320', '1080x1920': 'Vertical 1080×1920', '2160x3840': 'Vertical 4K 2160×3840' };
    const pf = S.user.prefs || {}, res = el('select', {}, Object.keys(RES).map(k => el('option', { value: k, selected: k === `${pf.w || 1920}x${pf.h || 1080}` ? '' : undefined }, RES[k]))), fps = el('select', {}, [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map(v => el('option', { value: v, selected: v === (pf.fps || 30) ? '' : undefined }, v + ' fps')));
    const pick = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: '', onchange: async e => { const f = e.target.files[0]; if (!f) return; try { const b = await createImageBitmap(f), c = document.createElement('canvas'), k = 256 / Math.min(b.width, b.height); c.width = c.height = 256; c.getContext('2d').drawImage(b, (256 - b.width * k) / 2, (256 - b.height * k) / 2, b.width * k, b.height * k); const r = await A.updateProfile({ avatar: c.toDataURL('image/jpeg', .88) }); if (r.ok) { update(r); page(); } else toast(r.error); } catch (x) { toast('That image could not be read.'); } } });
    m.append(el('h1', {}, 'Profile'), block('Photo', el('div', { style: 'display:flex;align-items:center;gap:14px' }, avatar(S.user, 72), pick, el('button', { onclick: () => pick.click() }, 'Change photo'), S.user.avatar ? el('button', { onclick: async () => { update(await A.updateProfile({ avatar: '' })); page(); } }, 'Remove') : null)),
      block('Details', form([row('Display name', name), row('Role', title)], 'Save', async show => { const r = await A.updateProfile({ name: name.value, title: title.value }); if (must(r, show)) { update(r); toast('Saved'); page(); } })),
      block('New project defaults', form([row('Resolution', res), row('Frame rate', fps)], 'Save defaults', async show => { const [w, h] = res.value.split('x').map(Number), r = await A.updateProfile({ prefs: { w, h, fps: +fps.value } }); if (must(r, show)) { update(r); toast('Saved'); } })),
      block('E-mail', el('p', {}, S.user.email, ' ', el('span', { class: 'pill' + (S.user.emailVerified ? ' au-ready' : '') }, S.user.emailVerified ? 'Verified' : 'Not verified')), verifyBlock()),
      block('Your data', el('div', { style: 'display:flex;gap:8px' }, el('button', { onclick: async () => { const r = await A.exportData(); download(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }), 'nexora-account.json'); } }, 'Download my account data'), el('button', { class: 'ap-danger', onclick: deleteAccount }, 'Delete account'))));
  }
  function verifyBlock() {
    if (S.user.emailVerified) return el('div'); if (!S.status.smtp) return el('p', { class: 'dim' }, 'Set up e-mail delivery to verify this address.');
    const code = input({ placeholder: '6-digit code', class: 'au-code' });
    return form([el('button', { type: 'button', onclick: async () => { const r = await A.verifyEmailSend(); toast(r.ok ? 'Code sent' : r.error); } }, 'Send verification code'), row('Code', code)], 'Verify', async show => { const r = await A.verifyEmailConfirm({ code: code.value }); if (must(r, show)) { update(r); page(); } });
  }
  function deleteAccount() {
    const body = el('div', {}), o = { confirm: '', password: '', code: '' }, cf = input({ placeholder: S.user.email, oninput: e => o.confirm = e.target.value });
    body.append(el('p', {}, 'This removes your NEXORA account from this computer. It cannot be undone. Project folders on disk are not deleted.'), row('Type your e-mail to confirm', cf));
    if (S.user.totp) body.append(row('Authenticator or recovery code', input({ oninput: e => o.code = e.target.value }))); else if (S.user.hasPassword) body.append(row('Password', input({ type: 'password', oninput: e => o.password = e.target.value })));
    showModal('Delete account', body, [['Cancel', closeModal], ['Delete account', async () => { const r = await A.deleteAccount(o); if (!r.ok) return toast(r.error); closeModal(); S.user = null; closePage(); signin('Your account was deleted.'); }, true]]);
  }
  function tabSecurity(m) {
    m.append(el('h1', {}, 'Security'));
    const cur = input({ type: 'password', autocomplete: 'current-password' }), nx = input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 10 characters' });
    m.append(block(S.user.hasPassword ? 'Password' : 'Add a password', form([S.user.hasPassword ? row('Current password', cur) : null, row('New password', nx), meter(nx)].filter(Boolean), S.user.hasPassword ? 'Change password' : 'Add password', async show => { const r = await A.changePassword({ current: cur.value, next: nx.value }); if (must(r, show)) { update(r); toast('Password saved'); page(); } })));
    const twoF = block('Two-factor authentication');
    if (S.user.totp) {
      const code = input({ placeholder: 'Authenticator or recovery code', class: 'au-code' });
      twoF.append(el('p', {}, el('span', { class: 'pill au-ready' }, 'On'), ' Authenticator app. ', cloud() ? '' : `${S.user.recoveryLeft} recovery code${S.user.recoveryLeft === 1 ? '' : 's'} left.`), row('Code', code),
        el('div', { style: 'display:flex;gap:8px' }, cloud() ? null : el('button', { onclick: async () => { const r = await A.recoveryRegenerate({ code: code.value }); if (!r.ok) return toast(r.error); update(r); recoveryModal(r.recovery); page(); } }, 'New recovery codes'), el('button', { class: 'ap-danger', onclick: async () => { const r = await A.totpDisable({ code: code.value }); if (!r.ok) return toast(r.error); update(r); toast('Two-factor authentication is off'); page(); } }, 'Turn off')));
    } else twoF.append(el('p', { class: 'dim' }, 'Protect this account with a code from an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.'), el('button', { class: 'primary', id: 'apTotpStart', onclick: () => enroll(twoF) }, 'Set up authenticator app'));
    m.append(twoF);
    if (!cloud()) m.append(block('E-mail codes', el('p', { class: 'dim' }, S.status.smtp ? 'Also accept a code sent to your verified e-mail at sign-in.' : 'Needs e-mail delivery to be set up first.'), el('label', { class: 'au-check' }, el('input', { type: 'checkbox', checked: S.user.emailOtp ? '' : undefined, disabled: S.status.smtp ? undefined : '', onchange: async e => { const r = await A.setEmailOtp({ on: e.target.checked }); if (!r.ok) { toast(r.error); e.target.checked = false; } else update(r); } }), 'Require an e-mailed code')));
    if (!S.status.encrypted) m.append(el('div', { class: 'au-err' }, 'This computer has no secure key store, so account data is not encrypted on disk.'));
  }
  async function enroll(box) {
    const r = await A.totpBegin(); if (!r.ok) return toast(r.error); box.innerHTML = ''; box.append(el('h2', {}, 'Set up authenticator app'));
    const q = r.qr, cell = 5, quiet = 4, sz = (q.size + quiet * 2) * cell; let d = ''; q.rows.forEach((row_, y) => { for (let x = 0; x < q.size; x++) if (row_[x] === '1') d += `M${(x + quiet) * cell} ${(y + quiet) * cell}h${cell}v${cell}h-${cell}z`; });
    const qr = el('div', { class: 'au-qr', id: 'apQr' }); qr.innerHTML = `<svg viewBox="0 0 ${sz} ${sz}" width="${sz}" height="${sz}" shape-rendering="crispEdges"><rect width="${sz}" height="${sz}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    const code = input({ placeholder: '6-digit code', class: 'au-code', inputmode: 'numeric', id: 'apTotpCode' });
    box.append(el('div', { class: 'au-enroll' }, qr, el('div', {}, el('p', {}, '1. Scan this code with your authenticator app.'), el('p', { class: 'dim' }, 'Cannot scan? Enter this key by hand:'), el('code', { class: 'au-secret', id: 'apSecret' }, r.secret), el('p', {}, '2. Enter the 6-digit code it shows.'), form([row('Code', code)], 'Turn on', async show => { const v = await A.totpConfirm({ code: code.value }); if (must(v, show)) { update(v); if (v.recovery && v.recovery.length) recoveryModal(v.recovery); page(); } }, [el('button', { type: 'button', onclick: () => page() }, 'Cancel')]))));
  }
  function recoveryModal(codes) { showModal('Your new recovery codes', el('div', {}, el('p', { class: 'dim' }, 'Each works once. They are shown only now.'), el('div', { class: 'au-codes' }, codes.map(c => el('code', {}, c)))), [['Save as file', () => downloadText('nexora-recovery-codes.txt', codes.join('\n') + '\n')], ['Done', closeModal, true]]); }
  async function tabConnected(m) {
    await refreshProviders(); m.append(el('h1', {}, 'Connected accounts'), el('p', { class: 'dim' }, 'Optional. Your e-mail and password always work.'));
    const list = el('div', { class: 'ap-list' }); m.append(list);
    S.providers.filter(p => ENABLED.includes(p.id)).forEach(p => { const key = p.id === 'oidc' ? 'oidc:' + p.issuer.replace(/\/$/, '') : p.id, l = S.user.links[key]; if (p.id === 'oidc' && !p.configured) return; list.append(el('div', { class: 'ap-item' }, logo(p.id), el('div', { style: 'flex:1;min-width:0' }, el('b', {}, p.name), el('small', { class: 'dim' }, l ? (l.email || 'Connected') : p.configured ? 'Not connected' : 'Not set up on this computer')), l ? el('button', { onclick: async () => { const r = await A.unlink({ key }); if (!r.ok) return toast(r.error); update(r); page(); } }, 'Disconnect') : el('button', { onclick: () => p.configured ? (closeForLink(), startProvider(p, true)) : (closeForLink(), viewProviders(p.id)) }, p.configured ? 'Connect' : 'Set up'))); });

  }
  const closeForLink = () => { const p = $$('acctPage'); if (p) p.classList.add('hidden'); };
  async function tabEmail(m) {
    const c = await A.smtpGet(); m.append(el('h1', {}, 'E-mail delivery'), el('p', { class: 'dim' }, 'NEXORA has no mail service of its own. Enter an SMTP account (Gmail app password, Outlook, SendGrid, your own server) to enable verification e-mails, e-mail sign-in codes and password-reset e-mails.'));
    const host = input({ value: c.host, placeholder: 'smtp.example.com' }), port = input({ value: c.port, type: 'number' }), user = input({ value: c.user, placeholder: 'Username' }), pass = input({ type: 'password', placeholder: c.hasPass ? 'Saved (leave blank to keep)' : 'Password or app password' }), from = input({ value: c.from, placeholder: 'studio@example.com' }), sec = el('input', { type: 'checkbox', checked: c.secure ? '' : undefined });
    m.append(block('Mail server', form([row('Server', host), row('Port', port, '587 uses STARTTLS. 465 needs the option below.'), el('label', { class: 'au-check' }, sec, 'Connect with TLS from the start (port 465)'), row('Username', user), row('Password', pass), row('Send from', from)], 'Save', async show => { const r = await A.smtpSet({ host: host.value, port: +port.value, secure: sec.checked, user: user.value, pass: pass.value, from: from.value }); if (must(r, show)) { S.status = await A.status(); toast('Saved'); page(); } }, [el('button', { type: 'button', onclick: async () => { const r = await A.smtpTest(); toast(r.ok ? `Test e-mail sent to ${S.user.email}` : r.error); } }, 'Send test e-mail')])));
  }
  async function tabAI(m) { m.append(el('h1', {}, 'AI')); if (typeof Copilot !== 'undefined') await Copilot.settings(m); }
  async function tabActivity(m) { const r = await A.activity(); m.append(el('h1', {}, 'Activity'), el('p', { class: 'dim' }, 'Recent account events on this computer.'), el('div', { class: 'ap-list' }, (r.log || []).map(l => el('div', { class: 'ap-item' + (l.ok ? '' : ' bad') }, el('div', { style: 'flex:1' }, el('b', {}, l.ev), l.how ? el('small', { class: 'dim' }, ' · ' + l.how) : null), el('small', { class: 'dim' }, fmtTime(l.t)))))); }

  /* ---------- the badge in Home and in the Studio top bar ---------- */
  function badge() { const b = el('button', { class: 'au-badge', title: S.user ? `${S.user.name} · Profile` : 'Sign in', onclick: () => S.user ? page('profile') : openSignIn() }, avatar(S.user, 24)); return b; }
  function openSignIn() { signin(); }
  function paintBadge() { const t = $$('acctTop'); if (t) { t.innerHTML = ''; if (on) t.append(badge()); } }
  function navItem() { if (!on) return null; return el('button', { class: 'hn-item hn-user', onclick: () => S.user ? page('profile') : openSignIn() }, avatar(S.user, 22), el('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, S.user ? S.user.name : 'Sign in')); }

  async function init() {
    if (!on) return; gate().classList.remove('hidden');
    const st = S.status = await A.status();
    if (st.testMode) { hideGate(); return; }
    await refreshProviders();
    if (st.user) { S.user = st.user; hideGate(); applied(); }
    else if (localStorage.getItem('nexora.guest')) { S.guest = true; hideGate(); applied(); }
    else if (st.twoFactorPending) signin(); else signin();
  }
  return { S, on, init, uid, prefs, page, navItem, paintBadge, openSignIn, signin, avatar };
})();
