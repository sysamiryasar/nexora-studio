'use strict';
/* ====================== NEXORA on-disk media & project folders (desktop app) ======================
   In the Electron build, media is LINKED by file path instead of copied into the project:
     <Documents>/NEXORA Projects/<Project>/project.nexora   ← JSON envelope (no media bytes)
     <Documents>/NEXORA Projects/<Project>/Media/            ← recordings / generated files, "Collect files" copies
   Files are streamed through nxmedia:// (Range + CORS, see electron/main.js), so there is no size limit and nothing
   is held in memory. A media record keeps an absolute path plus a path relative to the project folder; on open the
   relative one wins, so a project folder moved or copied together with its Media/ still opens. Missing files show an
   "offline" card and can be relinked (pick a file, or search a folder by name).
   In a plain browser window.nxfs is absent and everything keeps working the old way (media embedded / IndexedDB). */
const Disk = (() => {
  const fs = window.nxfs || null, on = !!fs, sep = fs ? fs.sep : '/';
  const S = { folder: null };                                  // folder of the project being saved / loaded
  const urlOf = p => 'nxmedia://f/' + encodeURIComponent(p);
  const base = p => String(p).split(/[\\/]/).pop();
  const join = (...a) => a.filter(Boolean).join(sep).replace(/[\\/]+/g, sep);
  const KIND = { mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', mxf: 'video', avi: 'video', mts: 'video', m2ts: 'video', ts: 'video', wmv: 'video', flv: 'video', mpg: 'video', mpeg: 'video', '3gp': 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', aif: 'audio', aiff: 'audio', wma: 'audio', ac3: 'audio', opus: 'audio',
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', svg: 'image', tif: 'image', tiff: 'image', exr: 'image', dpx: 'image', tga: 'image', psd: 'image' };
  const kindOf = p => KIND[(p.split('.').pop() || '').toLowerCase()] || null;
  const safe = n => (String(n || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled').replace(/[. ]+$/, '');
  /** blob stand-in for a file on disk: size is known, bytes are fetched only when something asks for them */
  const lazyBlob = (url, size) => ({ _disk: true, size: size || 0, type: '', arrayBuffer: () => fetch(url).then(r => { if (!r.ok) throw new Error('file unavailable'); return r.arrayBuffer(); }), blob: () => fetch(url).then(r => r.blob()) });
  const realBlob = async m => m.blob && m.blob._disk ? await m.blob.blob() : m.blob;
  const relTo = (folder, p) => { if (!folder || !p) return null; const f = folder.replace(/[\\/]+$/, '') + sep; return p.toLowerCase().startsWith(f.toLowerCase()) ? p.slice(f.length) : null; };

  /** called by importFile(): a dropped / picked file that lives on disk is linked, not copied */
  function adopt(m, file) {
    if (!on || !file) return; const p = fs.pathForFile(file); if (!p) return;
    if (m.url && m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
    m.path = p; m.url = urlOf(p);                              // keep m.blob = the File (disk-backed, not in memory)
  }
  /** import a file by path (Electron dialogs, relink, tests) */
  async function importPath(p) {
    const k = kindOf(p); if (!k) throw new Error('Unsupported file type: ' + base(p));
    const st = await fs.stat(p); if (!st.exists) throw new Error('File not found: ' + p);
    const m = { id: uid(), name: base(p), kind: k, path: p, url: urlOf(p), w: 0, h: 0, dur: 5 }; m.blob = lazyBlob(m.url, st.size);
    await initMedia(m); media[m.id] = m; if (typeof uiMedia === 'function') uiMedia(); return m;
  }
  /** project JSON → media record. Tries <folder>/<rel> first, then the absolute path. */
  async function resolve(id, mm) {
    const tries = []; if (mm.rel && S.folder) tries.push(join(S.folder, mm.rel)); if (mm.path) tries.push(mm.path);
    for (const p of tries) {
      const st = on ? await fs.stat(p) : { exists: false };
      if (st.exists && !st.isDir) { const m = { id, name: mm.name, kind: mm.kind, path: p, url: urlOf(p), w: mm.w, h: mm.h, dur: mm.dur, link: mm.link, vec: mm.vec, source: mm.source }; m.blob = lazyBlob(m.url, st.size); await initMedia(m); if (!m.w && mm.w) { m.w = mm.w; m.h = mm.h; } return m; }
    }
    return { id, name: mm.name, kind: mm.kind, path: mm.path, rel: mm.rel, w: mm.w, h: mm.h, dur: mm.dur, link: mm.link, missing: true };
  }
  /** serialise a media record's location */
  const describe = m => m.path ? { path: m.path, rel: relTo(S.folder, m.path) || undefined, source: m.source || undefined } : {};

  /* ---------- project folders ---------- */
  const root = () => fs.defaultRoot();
  async function newFolder(name) {
    const r = await root(); let f = join(r, safe(name)), i = 2;
    while ((await fs.stat(f)).exists) f = join(r, safe(name) + ' ' + i++);
    await fs.mkdir(join(f, 'Media')); return f;
  }
  const projectFile = folder => join(folder, 'project.nexora');
  async function writeProject(folder, json) { await fs.writeText(projectFile(folder), json); }
  async function readProject(folder) { const st = await fs.stat(projectFile(folder)); if (!st.exists) return null; return { json: await fs.readText(projectFile(folder)), mtime: st.mtime }; }
  /** media that exists only in memory (voice-overs, captured frames) is written into <folder>/Media so the project file can reference it */
  async function materialize(folder) {
    let n = 0;
    for (const id in media) {
      const m = media[id]; if (m.path || m.link || m.missing || !m.blob || m.blob._disk) continue;
      const ext = (m.name.match(/\.[a-z0-9]{2,5}$/i) || [''])[0] || ({ video: '.webm', audio: '.webm', image: '.png' })[m.kind] || '';
      const p = join(folder, 'Media', safe(m.name.replace(/\.[^.]+$/, '')) + '-' + id + ext);
      await fs.writeBytes(p, await m.blob.arrayBuffer()); m.path = p; n++;
    }
    return n;
  }
  /** copy every linked file that lives outside the project folder into <folder>/Media (like "Collect files") */
  async function collect(folder, onProgress) {
    const list = Object.values(media).filter(m => m.path && !m.missing && !relTo(folder, m.path)); let i = 0;
    for (const m of list) {
      let dst = join(folder, 'Media', base(m.path)), k = 2; while ((await fs.stat(dst)).exists) dst = join(folder, 'Media', base(m.path).replace(/(\.[^.]+)?$/, ` ${k++}$1`));
      await fs.copyFile(m.path, dst); m.path = dst; m.url = urlOf(dst); m.blob = lazyBlob(m.url, m.blob && m.blob.size); dropEls(m); if (onProgress) onProgress(++i / list.length, m);
    }
    return list.length;
  }

  /* ---------- offline media + relink ---------- */
  const offline = {};
  function offlineCard(m) {
    const w = m.w || 1280, h = m.h || 720, key = m.id + w + 'x' + h; if (offline[key]) return offline[key];
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.fillStyle = '#1a0b10'; x.fillRect(0, 0, w, h); x.strokeStyle = '#ff4d6d'; x.lineWidth = Math.max(4, w / 200); x.strokeRect(x.lineWidth, x.lineWidth, w - 2 * x.lineWidth, h - 2 * x.lineWidth);
    x.fillStyle = '#ff4d6d'; x.textAlign = 'center'; x.font = `600 ${Math.round(h / 12)}px Inter, Segoe UI, sans-serif`; x.fillText('Media offline', w / 2, h / 2 - h / 40);
    x.fillStyle = '#d8c3c9'; x.font = `${Math.round(h / 28)}px Inter, Segoe UI, sans-serif`; x.fillText(m.name, w / 2, h / 2 + h / 14);
    return (offline[key] = c);
  }
  function dropEls(m) { for (const L of (typeof Motion !== 'undefined' ? [...Motion.editProject().layers, ...P.layers] : P.layers)) if (L.media === m.id) for (const k of [L.id, L.id + '#p']) { const e = els.get(k); if (e) { e.pause(); e.removeAttribute('src'); e.load(); els.delete(k); } } }
  const missing = () => Object.values(media).filter(m => m.missing && !m.link);
  async function relinkTo(m, p) {
    const st = await fs.stat(p); if (!st.exists) throw new Error('File not found');
    Object.assign(m, { path: p, url: urlOf(p), missing: false }); delete m.rel; m.blob = lazyBlob(m.url, st.size);
    await initMedia(m); dropEls(m); for (const k in offline) if (k.startsWith(m.id)) delete offline[k];
    if (typeof Proxies !== 'undefined') Proxies.restore(m);
    requestRender(); if (typeof structChanged === 'function') structChanged(); if (typeof Recovery !== 'undefined') Recovery.touch();
  }
  /** search a folder (recursively) for every missing file by name; prefer a same-size match */
  async function searchAndRelink(dir) {
    const miss = missing(); if (!miss.length) return 0;
    const found = await fs.find(dir, [...new Set(miss.map(m => base(m.path || m.name)))], 12); let n = 0;
    for (const m of miss) { const c = found[base(m.path || m.name).toLowerCase()]; if (!c || !c.length) continue; const pick = c.find(x => m.size && x.size === m.size) || c[0]; await relinkTo(m, pick.path); n++; }
    return n;
  }
  return { on, S, fs, urlOf, base, join, safe, kindOf, adopt, importPath, resolve, describe, lazyBlob, realBlob, relTo, newFolder, projectFile, writeProject, readProject, materialize, collect, offlineCard, missing, relinkTo, searchAndRelink, dropEls };
})();
