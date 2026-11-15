'use strict';
/* ====================== NEXORA updates (Electron main process) ======================
   1. Check: asks GitHub for the latest published release of this app's repository and compares it with the running
      version. Only public release information is read: no account, no identifiers, a generic User-Agent.
   2. Update (installed Windows copies): downloads the release's NEXORA-Studio-Setup-win-x64.exe to a private temp
      folder, checks its SHA-256 against SHA256SUMS.txt from the same release (a file that does not match is deleted
      and never run), then starts it silently (/S) with --force-run and quits. The installer replaces the old version
      in place (same app id, same folder) and starts the new one, which then shows What's new.
   Portable copies (zip), macOS and Linux are told where to download instead: they cannot replace themselves. */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const SETUP = 'NEXORA-Studio-Setup-win-x64.exe', SUMS = 'SHA256SUMS.txt';

/** "v2.10.0" → [2, 10, 0]; pre-releases ("2.1.0-beta.1") sort before the release */
function parse(v) { const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.]+))?/); return m ? { n: [+m[1], +(m[2] || 0), +(m[3] || 0)], pre: m[4] || '' } : null; }
function newer(a, b) {   // is a newer than b?
  const x = parse(a), y = parse(b); if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i];
  return !x.pre && !!y.pre;   // 2.1.0 is newer than 2.1.0-beta
}
function repoSlug() {
  try { const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')), u = typeof p.repository === 'string' ? p.repository : (p.repository || {}).url; const m = String(u || '').match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/); return m ? m[1] : null; } catch (e) { return null; }
}
/** SHA256SUMS.txt ("<hex>  <name>" per line) → { name: hex } */
function parseSums(text) { const o = {}; for (const l of String(text || '').split(/\r?\n/)) { const m = /^([0-9a-f]{64})\s+\*?(\S.*?)\s*$/i.exec(l.trim()); if (m) o[m[2]] = m[1].toLowerCase(); } return o; }

function register(ipcMain, app, logLine) {
  const testMode = process.argv.includes('--nx-hidden'); let testRelease = null, testFetch = null, ran = null;
  const dir = path.join(app.getPath('temp'), 'nexora-update');
  // leftovers from an earlier update (the installer has run by the time the new version starts)
  try { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); } catch (e) { }
  /** installed by the NEXORA installer (not the portable zip / dev): the NSIS uninstaller sits next to the exe */
  const installed = () => process.platform === 'win32' && fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall NEXORA Studio.exe'));
  const get = (url, o) => (testFetch || fetch)(url, Object.assign({ headers: { 'User-Agent': 'NEXORA-Studio-update' }, redirect: 'follow' }, o));
  let last = null;   // the release from the latest check

  ipcMain.handle('nxupdate:check', async (_e, automatic) => {
    if (testMode && automatic && !testRelease) return { ok: false, skipped: true };   // automated test runs never call GitHub on their own
    const current = app.getVersion(), slug = repoSlug(); if (!slug) return { ok: false, error: 'No repository is set for this build.' };
    let rel;
    if (testMode && testRelease) rel = testRelease;
    else {
      try {
        const r = await get(`https://api.github.com/repos/${slug}/releases/latest`, { headers: { 'User-Agent': 'NEXORA-Studio-update-check', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
        if (r.status === 404) return { ok: true, current, latest: null, newer: false };   // no release published yet
        if (!r.ok) return { ok: false, error: 'GitHub answered ' + r.status };
        rel = await r.json();
      } catch (e) { logLine('update check failed', e.message); return { ok: false, error: 'Could not reach GitHub.' }; }
    }
    last = rel;
    const latest = String(rel.tag_name || '').replace(/^v/i, '');
    const notes = String(rel.body || '').split(/\r?\n/).filter(l => /^\s*[-*] /.test(l)).slice(0, 8).map(l => l.replace(/^\s*[-*] /, '').replace(/\*\*/g, ''));
    const assets = (rel.assets || []).map(a => ({ name: a.name, size: a.size, url: a.browser_download_url }));
    const canInstall = (installed() || (testMode && !!testRelease)) && assets.some(a => a.name === SETUP) && assets.some(a => a.name === SUMS);
    return { ok: true, current, latest, newer: !rel.draft && !rel.prerelease && newer(latest, current), url: rel.html_url || `https://github.com/${slug}/releases/latest`, name: rel.name || 'NEXORA Studio ' + latest, published: rel.published_at || null, notes, canInstall, platform: process.platform };
  });

  /* download + verify; progress goes to the page as nxupdate:progress { got, total } */
  let busy = null;
  ipcMain.handle('nxupdate:download', async e => {
    if (busy) return { ok: false, error: 'An update is already downloading.' };
    const rel = last, assets = (rel && rel.assets) || [], setup = assets.find(a => a.name === SETUP), sums = assets.find(a => a.name === SUMS);
    if (!setup || !sums) return { ok: false, error: 'This release has no installer to update with.' };
    const ac = new AbortController(); busy = ac; const send = d => { try { e.sender.send('nxupdate:progress', d); } catch (x) { } };
    const file = path.join(dir, `NEXORA-Setup-${String(rel.tag_name).replace(/[^\w.-]/g, '')}.exe`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const s = await get(sums.browser_download_url, { signal: ac.signal }); if (!s.ok) throw new Error('Could not read the checksums (' + s.status + ').');
      const want = parseSums(await s.text())[SETUP]; if (!want) throw new Error('The release has no checksum for the installer.');
      const r = await get(setup.browser_download_url, { signal: ac.signal }); if (!r.ok || !r.body) throw new Error('Download failed (' + r.status + ').');
      const total = +r.headers.get('content-length') || setup.size || 0, hash = crypto.createHash('sha256'), out = fs.createWriteStream(file); let got = 0, lastSend = 0;
      const reader = r.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; hash.update(value); got += value.length; if (!out.write(value)) await new Promise(res => out.once('drain', res)); const now = Date.now(); if (now - lastSend > 120) { lastSend = now; send({ got, total }); } }
      await new Promise((res, rej) => out.end(err => err ? rej(err) : res())); send({ got, total });
      const have = hash.digest('hex');
      if (have !== want) { fs.rmSync(file, { force: true }); logLine('update checksum mismatch', have, want); throw new Error('The download did not match the published checksum, so it was deleted and not run. Try again later.'); }
      if (setup.size && got !== setup.size) { fs.rmSync(file, { force: true }); throw new Error('The download was incomplete.'); }
      logLine('update downloaded', rel.tag_name, got); return { ok: true, file, version: String(rel.tag_name).replace(/^v/i, ''), sha256: have };
    } catch (err) { try { fs.rmSync(file, { force: true }); } catch (x) { } return { ok: false, error: err.name === 'AbortError' ? 'Cancelled.' : err.message }; }
    finally { busy = null; }
  });
  ipcMain.handle('nxupdate:cancel', () => { if (busy) busy.abort(); return true; });

  /* run the verified installer silently, then quit so it can replace this version; it starts the new one itself */
  ipcMain.handle('nxupdate:install', async (_e, file) => {
    const ok = typeof file === 'string' && path.dirname(path.resolve(file)) === path.resolve(dir) && fs.existsSync(file);
    if (!ok) return { ok: false, error: 'No verified installer to run.' };
    const args = ['/S', '--force-run'];
    if (testMode) { ran = { file, args }; return { ok: true, test: true }; }   // tests check what would run, they never install
    logLine('update installing', file); spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    setTimeout(() => app.quit(), 400); return { ok: true };
  });

  if (testMode) ipcMain.handle('nxupdatetest', (_e, rel, opt) => {
    testRelease = rel || null; ran = null;
    // optional fake downloads: { files: { url: { status, text | base64 } } }
    testFetch = opt && opt.files ? async url => { const f = opt.files[url]; if (!f) return new Response('nope', { status: 404 }); const body = f.base64 != null ? Buffer.from(f.base64, 'base64') : f.text; return new Response(body, { status: f.status || 200, headers: { 'content-length': String(Buffer.byteLength(body)) } }); } : null;
    return { dir };
  });
  if (testMode) ipcMain.handle('nxupdatetestran', () => ran);
}
module.exports = { register, newer, parse, parseSums };
