'use strict';
/* ====================== NEXORA project library ======================
   Every project is autosaved to IndexedDB ('nexora-projects'): a light 'meta' record (name, kind, thumbnail,
   size, updated time) for the Home / Library grid, and a 'data' record holding the full .nexora envelope.
   Recovery.touch() → Projects.save() a few seconds after any edit, so there is no separate "unsaved work" step. */
const Projects = {
  current: null,               // { id, name, kind: 'video' | 'image', created }
  MAX_MEDIA_BYTES: 300e6,
  _db: null,
  open() {
    if (Projects._db) return Promise.resolve(Projects._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('nexora-projects', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('data', { keyPath: 'id' }); };
      r.onsuccess = () => res(Projects._db = r.result); r.onerror = () => rej(r.error);
    });
  },
  async _tx(stores, mode, fn) { const db = await Projects.open(); return new Promise((res, rej) => { const t = db.transaction(stores, mode); const out = fn(t); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); },
  async list() { const rows = await Projects._tx(['meta'], 'readonly', t => t.objectStore('meta').getAll()); const me = typeof Account !== 'undefined' ? Account.uid() : null; return (rows || []).filter(m => !m.owner || m.owner === me).sort((a, b) => b.updated - a.updated); },   // a project made while signed in is listed only for that account; older projects stay visible to everyone
  async get(id) { return Projects._tx(['data'], 'readonly', t => t.objectStore('data').get(id)); },
  name() {
    if (!Projects.current) return '';
    if (Projects.current.kind === 'image') { const d = NXI.ui.doc || Object.values(Assets.docs)[0]; return d ? d.name : Projects.current.name; }
    return Motion.editProject().name || Projects.current.name;
  },
  thumb() {
    try {
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); x.fillStyle = '#0b0b10'; x.fillRect(0, 0, 320, 180);
      if (Projects.current.kind === 'image') { const d = NXI.ui.doc || Object.values(Assets.docs)[0]; if (d) { const r = NXI.render(d), k = Math.min(320 / d.w, 180 / d.h); x.drawImage(r, (320 - d.w * k) / 2, (180 - d.h * k) / 2, d.w * k, d.h * k); } }
      else { const p = Motion.editProject(), full = document.createElement('canvas'); full.width = p.w; full.height = p.h; const f = full.getContext('2d'); if (p.bg !== 'transparent') { f.fillStyle = p.bg; f.fillRect(0, 0, p.w, p.h); } renderLayers(f, Math.min(p.dur / 2, 1.5), p.layers, p); const k = Math.min(320 / p.w, 180 / p.h); x.drawImage(full, (320 - p.w * k) / 2, (180 - p.h * k) / 2, p.w * k, p.h * k); }
      return c.toDataURL('image/jpeg', .75);
    } catch (e) { return null; }
  },
  /** saves are serialised: a save requested while one is running waits for it, so writes never interleave */
  save() { const run = Projects._queue.then(() => Projects._save(), () => Projects._save()); Projects._queue = run.catch(() => { }); return run; },
  _queue: Promise.resolve(),
  async _save() {
    const cur = Projects.current; if (!cur) return;
    // desktop: every project lives in its own folder; media stays where it is on disk and is referenced by path
    if (Disk.on && !cur.folder) cur.folder = await Disk.newFolder(Projects.name() || cur.name);
    if (cur.folder) { Disk.S.folder = cur.folder; await Disk.materialize(cur.folder); }
    const bytes = Object.values(media).reduce((a, m) => a + (m.blob && !m.path ? m.blob.size : 0), 0), withMedia = bytes < Projects.MAX_MEDIA_BYTES;
    const env = await Shell.buildEnvelope({ mediaData: withMedia }), json = JSON.stringify(env), p = Motion.editProject();
    if (Projects.current !== cur) return null;                 // project was closed/removed while this save was being built
    if (cur.folder) { await Disk.writeProject(cur.folder, json); if (typeof Versions !== 'undefined') await Versions.maybe(cur.folder, json); }
    const meta = { id: cur.id, name: Projects.name(), kind: cur.kind, created: cur.created, updated: Date.now(), thumb: Projects.thumb(), size: json.length, mediaIncluded: withMedia, folder: cur.folder || undefined, owner: cur.owner || (typeof Account !== 'undefined' && Account.uid()) || undefined,
      info: cur.kind === 'image' ? (() => { const d = NXI.ui.doc || Object.values(Assets.docs)[0]; return d ? `${d.w}×${d.h}` : ''; })() : `${p.w}×${p.h} · ${tcFmt(p.dur)}` };
    cur.name = meta.name;
    if (Projects.current !== cur) return null;
    await Projects._tx(['meta', 'data'], 'readwrite', t => { t.objectStore('meta').put(meta); t.objectStore('data').put({ id: cur.id, json }); });
    return meta;
  },
  async load(id) {
    const rec = await Projects.get(id), metas = await Projects.list(), meta = metas.find(m => m.id === id); if (!meta) throw new Error('Project not found');
    // the folder's project.nexora is the source of truth on desktop (it may have been edited, moved in or synced)
    let json = rec && rec.json;
    if (meta.folder && Disk.on) { const f = await Disk.readProject(meta.folder); if (f) json = f.json; else if (!json) throw new Error('Project folder not found: ' + meta.folder); }
    if (!json) throw new Error('Project data missing');
    Disk.S.folder = meta.folder || null;
    const probs = await Shell.loadEnvelope(JSON.parse(json));
    Projects.current = { id, name: meta.name, kind: meta.kind, created: meta.created, folder: meta.folder, owner: meta.owner }; return { meta, probs, env: JSON.parse(json) };
  },
  /** desktop: open a project folder (or its project.nexora) that is not in the library yet, or re-open one that is */
  async openFolder(folder) {
    const f = await Disk.readProject(folder); if (!f) throw new Error('No project.nexora in ' + folder);
    const known = (await Projects.list()).find(m => m.folder && m.folder.toLowerCase() === folder.toLowerCase());
    if (known) return Projects.load(known.id);
    const env = JSON.parse(f.json), name = Disk.base(folder); Disk.S.folder = folder;
    const probs = await Shell.loadEnvelope(env);
    const isImage = !(env.edit && env.edit.project && env.edit.project.layers && env.edit.project.layers.length) && Object.keys(env.images || {}).length > 0;
    Projects.current = { id: uid(), name, kind: isImage ? 'image' : 'video', created: Date.now(), folder };
    const meta = await Projects.save(); return { meta, probs, env };
  },
  /** removes the project from the library. On desktop the folder on disk is kept unless deleteFiles is true. */
  async remove(id) {
    // closing the open project: cancel a pending autosave and wait out one in flight, so it cannot resurrect the entry
    if (Projects.current && Projects.current.id === id) { clearTimeout(Recovery._t); Projects.current = null; while (Recovery.busy) await new Promise(r => setTimeout(r, 30)); }
    await Projects._tx(['meta', 'data'], 'readwrite', t => { t.objectStore('meta').delete(id); t.objectStore('data').delete(id); }); if (Projects.current && Projects.current.id === id) Projects.current = null; },
  /** renames the project; on desktop its folder is renamed too (media inside it is re-pointed; files outside are untouched) */
  async rename(id, name) {
    const all = await Projects.list(), m = all.find(x => x.id === id); if (!m) return; m.name = name;
    if (Disk.on && m.folder) {
      const old = m.folder.replace(/[\\/]+$/, ''), parent = old.replace(/[\\/][^\\/]+$/, ''), nf = Disk.join(parent, Disk.safe(name)), cur = Projects.current && Projects.current.id === id ? Projects.current : null;
      if (nf.toLowerCase() !== old.toLowerCase() && !(await Disk.fs.stat(nf)).exists) {
        const inside = cur ? Object.values(media).filter(x => x.path && x.path.toLowerCase().startsWith(old.toLowerCase() + Disk.fs.sep.toLowerCase())) : [];
        if (cur) { clearTimeout(Recovery._t); while (Recovery.busy) await new Promise(r => setTimeout(r, 30)); inside.forEach(x => Disk.dropEls(x)); }   // Windows locks files that players hold open
        try {
          await Disk.fs.rename(old, nf); m.folder = nf;
          if (cur) { cur.folder = nf; Disk.S.folder = nf; for (const x of inside) { x.path = nf + x.path.slice(old.length); x.url = Disk.urlOf(x.path); x.blob = Disk.lazyBlob(x.url, x.blob && x.blob.size); } if (cur.name !== undefined) cur.name = name; requestRender(); }
        } catch (e) { toast('Renamed in the library; the folder could not be renamed (' + (e.code || e.message) + ').'); }
      }
    }
    if (Projects.current && Projects.current.id === id) { Projects.current.name = name; const p = Motion.editProject(); if (Projects.current.kind !== 'image') p.name = name; }
    await Projects._tx(['meta'], 'readwrite', t => t.objectStore('meta').put(m));
  },
  async duplicate(id) { const rec = await Projects.get(id), m = (await Projects.list()).find(x => x.id === id); if (!rec || !m) return; const nid = uid();
    // desktop copies get their own folder (media paths stay absolute, so they still resolve to the originals)
    let folder; if (m.folder && Disk.on) { const f = await Disk.readProject(m.folder); folder = await Disk.newFolder(m.name + ' copy'); await Disk.writeProject(folder, f ? f.json : rec.json); }
    await Projects._tx(['meta', 'data'], 'readwrite', t => { t.objectStore('meta').put(Object.assign({}, m, { id: nid, name: m.name + ' copy', created: Date.now(), updated: Date.now(), folder })); t.objectStore('data').put({ id: nid, json: rec.json }); }); return nid; }
};
