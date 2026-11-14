'use strict';
/* ====================== NEXORA update check (Electron main process) ======================
   Asks GitHub for the latest published release of this app's repository and compares it with the running version.
   It only reads public release information: no account, no identifiers, nothing about the user is sent (the request
   carries a generic User-Agent, which GitHub's API requires). Downloading stays with the user: the page opens the
   release in the browser. */
const fs = require('fs'), path = require('path');

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
function register(ipcMain, app, logLine) {
  const testMode = process.argv.includes('--nx-hidden'); let testRelease = null;
  ipcMain.handle('nxupdate:check', async (_e, automatic) => {
    if (testMode && automatic && !testRelease) return { ok: false, skipped: true };   // automated test runs never call GitHub on their own
    const current = app.getVersion(), slug = repoSlug(); if (!slug) return { ok: false, error: 'No repository is set for this build.' };
    let rel;
    if (testMode && testRelease) rel = testRelease;
    else {
      try {
        const r = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, { headers: { 'User-Agent': 'NEXORA-Studio-update-check', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
        if (r.status === 404) return { ok: true, current, latest: null, newer: false };   // no release published yet
        if (!r.ok) return { ok: false, error: 'GitHub answered ' + r.status };
        rel = await r.json();
      } catch (e) { logLine('update check failed', e.message); return { ok: false, error: 'Could not reach GitHub.' }; }
    }
    const latest = String(rel.tag_name || '').replace(/^v/i, '');
    const notes = String(rel.body || '').split(/\r?\n/).filter(l => /^\s*[-*] /.test(l)).slice(0, 6).map(l => l.replace(/^\s*[-*] /, '').replace(/\*\*/g, ''));
    return { ok: true, current, latest, newer: !rel.draft && !rel.prerelease && newer(latest, current), url: rel.html_url || `https://github.com/${slug}/releases/latest`, name: rel.name || 'NEXORA Studio ' + latest, published: rel.published_at || null, notes };
  });
  if (testMode) ipcMain.handle('nxupdatetest', (_e, rel) => { testRelease = rel || null; return true; });
}
module.exports = { register, newer, parse };
