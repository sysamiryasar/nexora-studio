'use strict';
const { app, BrowserWindow, session, shell, Menu, ipcMain, dialog, protocol, desktopCapturer, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Readable } = require('stream');

/* nxmedia://f/<encoded absolute path> streams files from disk with HTTP Range support (video seeking) and CORS
   (so canvases that draw the media stay readable for effects/export). Registered before app ready. */
/* automated runs:
     --nx-selftest            run the whole test suite hidden, print the result and exit (0 = all passed)
     --nx-userdata=<folder>   keep settings and the project library in that folder instead of the user's own */
if (process.argv.includes('--nx-selftest') && !process.argv.includes('--nx-hidden')) process.argv.push('--nx-hidden');
{ const ud = process.argv.find(a => a.startsWith('--nx-userdata=')); if (ud) { const d = path.resolve(ud.slice(14)); fs.mkdirSync(d, { recursive: true }); app.setPath('userData', d); } }
// macOS 13+: let screen capture include system audio through ScreenCaptureKit
if (process.platform === 'darwin') app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
protocol.registerSchemesAsPrivileged([{ scheme: 'nxmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]);
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.onnx': 'application/octet-stream' };
async function serveMedia(req) {
  const u = new URL(req.url), file = decodeURIComponent(u.pathname.slice(1));
  let st; try { st = await fsp.stat(file); if (!st.isFile()) throw 0; } catch (e) { return new Response('not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', size = st.size;
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (m) {
    let start = m[1] === '' ? Math.max(0, size - +m[2]) : +m[1], end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(size) } });
}

/* sync clients (OneDrive, Dropbox) and antivirus briefly lock new files/folders on Windows → retry transient errors */
let tmpN = 0;
async function retry(fn, n = 12) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n || !['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 150 + i * 100)); } } }
/* file-system calls used by the project/media layer (see electron/preload.js) */
function registerIpc() {
  const h = (ch, fn) => ipcMain.handle('nxfs:' + ch, (_e, ...a) => fn(...a));
  // with --nx-userdata (test runs, CI) project folders stay inside that folder too, never in the user's Documents
  h('defaultRoot', () => process.argv.some(a => a.startsWith('--nx-userdata=')) ? path.join(app.getPath('userData'), 'NEXORA Projects') : path.join(app.getPath('documents'), 'NEXORA Projects'));
  h('pickFolder', async o => { const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { title: o.title || 'Choose folder', defaultPath: o.defaultPath, properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  h('pickFiles', async o => { const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { title: o.title || 'Choose file', defaultPath: o.defaultPath, filters: o.filters, properties: o.multi ? ['openFile', 'multiSelections'] : ['openFile'] }); return r.canceled ? [] : r.filePaths; });
  h('stat', async p => { try { const s = await fsp.stat(p); return { exists: true, size: s.size, mtime: s.mtimeMs, isDir: s.isDirectory() }; } catch (e) { return { exists: false }; } });
  h('readText', p => fsp.readFile(p, 'utf8'));
  // atomic write: temp file + rename, so a crash mid-save never leaves a half-written project
  h('writeText', async (p, t) => { await fsp.mkdir(path.dirname(p), { recursive: true }); const tmp = p + '.tmp-' + process.pid + '-' + (++tmpN) + Math.random().toString(36).slice(2, 6); await fsp.writeFile(tmp, t, 'utf8'); await retry(() => fsp.rename(tmp, p)); return true; });
  h('writeBytes', async (p, buf) => { await fsp.mkdir(path.dirname(p), { recursive: true }); const tmp = p + '.tmp-' + process.pid + '-' + (++tmpN) + Math.random().toString(36).slice(2, 6); await fsp.writeFile(tmp, Buffer.from(buf)); await retry(() => fsp.rename(tmp, p)); return true; });
  h('copyFile', async (a, b) => { await fsp.mkdir(path.dirname(b), { recursive: true }); await retry(() => fsp.copyFile(a, b)); return true; });
  h('rename', async (a, b) => { await retry(() => fsp.rename(a, b)); return true; });
  h('mkdir', async p => { await fsp.mkdir(p, { recursive: true }); return true; });
  // OneDrive marks synced folders read-only (placeholder reparse points), which makes rmdir fail with EPERM:
  // clear the read-only flag on the whole tree, then delete
  const writable = async p => { try { await fsp.chmod(p, 0o777); const s = await fsp.lstat(p); if (s.isDirectory()) for (const n of await fsp.readdir(p)) await writable(path.join(p, n)); } catch (e) { } };
  h('remove', async p => { try { await fsp.rm(p, { recursive: true, force: true }); } catch (e) { if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(e.code)) throw e; await writable(p); await retry(() => fsp.rm(p, { recursive: true, force: true })); } return true; });
  h('list', async d => { try { const out = []; for (const e of await fsp.readdir(d, { withFileTypes: true })) if (e.isFile()) { const s = await fsp.stat(path.join(d, e.name)); out.push({ name: e.name, size: s.size, mtime: s.mtimeMs }); } return out; } catch (e) { return []; } });
  h('free', async p => { for (let d = p; d; ) { try { const s = await fsp.statfs(d); return s.bavail * s.bsize; } catch (e) { const up = path.dirname(d); if (up === d) return 0; d = up; } } return 0; });
  h('reveal', p => { shell.showItemInFolder(p); return true; });
  h('join', (...p) => path.join(...p));
  h('rel', (a, b) => path.relative(a, b));
  // breadth-first search for files by base name (case-insensitive), used by "Relink › Search folder"
  h('find', async (dir, names, depth) => {
    const want = new Set(names.map(n => n.toLowerCase())), out = {}; let q = [[dir, 0]], seen = 0;
    // breadth-first, closest folders first; capped by entries and time so a whole-drive search cannot hang the app
    const deadline = Date.now() + 20000;
    while (q.length && seen < 400000 && Date.now() < deadline) {
      const [d, k] = q.shift(); let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of ents) {
        seen++; const p = path.join(d, e.name);
        if (e.isDirectory()) { if (k < depth && !e.name.startsWith('.') && e.name !== 'node_modules') q.push([p, k + 1]); }
        else if (want.has(e.name.toLowerCase())) { let s = null; try { s = (await fsp.stat(p)).size; } catch (x) { } (out[e.name.toLowerCase()] = out[e.name.toLowerCase()] || []).push({ path: p, size: s }); }
      }
    }
    return out;
  });
}

/* crash log: <userData>/logs/main.log — uncaught errors and renderer / GPU process crashes */
function logLine(...a) { try { const d = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, 'main.log'), new Date().toISOString() + ' ' + a.map(x => x && x.stack ? x.stack : typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ') + '\n'); } catch (e) { } }
process.on('uncaughtException', e => logLine('uncaughtException', e));
process.on('unhandledRejection', e => logLine('unhandledRejection', e));
app.on('render-process-gone', (_e, _wc, d) => logLine('render-process-gone', d));
app.on('child-process-gone', (_e, d) => logLine('child-process-gone', d));
app.on('will-quit', () => logLine('will-quit'));
function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1000, minHeight: 640,
    backgroundColor: '#050507', title: 'NEXORA Studio', autoHideMenuBar: true, icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    // --nx-hidden: automated test runs render off-screen instead of popping a window over the user's desktop
    show: !process.argv.includes('--nx-hidden'), paintWhenInitiallyHidden: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') }
  });
  const wc = win.webContents;
  wc.on('console-message', (_e, level, msg, line, src) => { if (level >= 3) logLine('console-error', msg, (src || '').split('/').pop() + ':' + line); });
  wc.on('did-fail-load', (_e, code, desc, url) => logLine('did-fail-load', code, desc, url));
  wc.on('will-navigate', (_e, url) => logLine('will-navigate', url));
  win.on('close', () => logLine('window close'));
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (!process.argv.includes('--nx-hidden')) win.maximize(); else win.setSize(1600, 960);
  if (process.argv.includes('--nx-selftest')) selfTest(wc);
}
/** --nx-skip=<prefix>|<prefix>: leave out tests that cannot work on that machine (e.g. screen capture on a virtual
    Linux display); they are listed in the output so nothing is skipped silently */
function skipRe() { const a = process.argv.find(x => x.startsWith('--nx-skip=')); if (!a) return null; const parts = a.slice(10).split('|').filter(Boolean).map(s => s.replace(/[.*+?^${}()[\]\\]/g, '\\$&')); process.stdout.write('NEXORA-SELFTEST skipping: ' + parts.join(' | ') + '\n'); return parts.length ? '^(?!(' + parts.join('|') + '))' : null; }
/** --nx-selftest: same suite as tests/run.html, inside the real app, in a throw-away project */
function selfTest(wc) {
  const done = (code, line) => { process.stdout.write(line + '\n'); logLine('selftest', line); setTimeout(() => app.exit(code), 200); };
  const limit = setTimeout(() => done(2, 'NEXORA-SELFTEST timeout after 30 min'), 30 * 60e3);
  wc.once('did-finish-load', () => setTimeout(async () => {
    try {
      const r = await wc.executeJavaScript(`(async () => {
        if (!window.NexoraTests) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'tests/tests.js'; s.onload = ok; s.onerror = () => no(new Error('tests.js did not load')); document.body.append(s); });
        await Shell.newProject('video', { name: '__selftest__' });
        const t = await NexoraTests.run(null, ${(r => r ? 'new RegExp(' + JSON.stringify(r) + ')' : 'null')(skipRe())});
        try { const id = Projects.current.id, f = Projects.current.folder; Shell.go('home'); await Projects.remove(id); if (f) await nxfs.remove(f); } catch (e) { }
        return { pass: t.pass, fail: t.fail, fails: t.lines.filter(l => l.startsWith('FAIL')) };
      })()`, true);
      clearTimeout(limit);
      for (const f of r.fails) process.stdout.write(f + '\n');
      done(r.fail ? 1 : 0, `NEXORA-SELFTEST ${r.pass}/${r.pass + r.fail} passed on ${process.platform}-${process.arch}`);
    } catch (e) { clearTimeout(limit); done(3, 'NEXORA-SELFTEST crashed: ' + (e && e.message || e)); }
  }, 2500));
}

app.whenReady().then(() => {
  logLine('ready', process.versions.electron);
  // allow microphone / camera (voice-over, facecam) and screen capture (gated again by the picker below); nothing else
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'audioCapture', 'videoCapture', 'display-capture'].includes(permission)));
  protocol.handle('nxmedia', serveMedia);
  /* screen / window capture (Gaming › Record): the page lists sources, the user picks one in NEXORA's own picker,
     then getDisplayMedia() is answered here with that source (+ system audio loopback on Windows). Nothing is
     captured unless the user started a recording and picked a source. */
  let capChoice = null;
  ipcMain.handle('nxcap:sources', async () => (await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })).map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() })));
  ipcMain.handle('nxcap:choose', (_e, id) => { capChoice = id; return true; });
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const id = capChoice; capChoice = null; if (!id) return cb({});                    // nothing chosen in NEXORA's picker → deny
    const src = (await desktopCapturer.getSources({ types: ['screen', 'window'] })).find(s => s.id === id) || { id, name: 'window' };
    // system audio: Windows (WASAPI loopback) and macOS 13+ (ScreenCaptureKit, enabled by the feature flags below); if the
    // platform refuses audio, fall back to picture-only instead of failing the recording
    try { cb({ video: src, audio: process.platform === 'linux' ? undefined : 'loopback' }); } catch (e) { logLine('loopback audio unavailable', e); cb({ video: src }); }
  });
  /* test mode only: a small solid-colour window off-screen, so automated tests can exercise real capture without
     recording anything the user has on screen */
  if (process.argv.includes('--nx-hidden')) {
    let target = null;
    ipcMain.handle('nxcap:testTarget', async () => { target = new BrowserWindow({ width: 320, height: 180, x: -4000, y: -4000, show: false, frame: false, skipTaskbar: true, focusable: false, backgroundColor: '#ff00ff', webPreferences: { sandbox: true } }); await target.loadURL('data:text/html,<body style="margin:0;background:%23ff00ff"></body>'); target.showInactive(); target.setPosition(-4000, -4000); await new Promise(r => setTimeout(r, 400)); return target.getMediaSourceId(); });
    ipcMain.handle('nxcap:testTargetClose', () => { if (target) target.destroy(); target = null; return true; });
  }
  registerIpc();
  require('./ffmpeg').register(ipcMain, app, logLine);
  require('./auth').create(app, shell, ipcMain, safeStorage, logLine);
  require('./ai').register(ipcMain, app, safeStorage, logLine);
  require('./music').register(ipcMain, logLine);
  require('./updates').register(ipcMain, app, logLine);
  // macOS needs an app menu for Cmd+C / V / X / Z / A to work in text fields; other platforms run without a menu bar
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
