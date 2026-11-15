'use strict';
/* ====================== NEXORA shell ======================
   Home (launcher · templates · library)  ⟷  Studio (one open project; every mode on the left rail).
   A video project's rail switches Edit / Motion / VFX / Design / … on the SAME project; an image project
   gets a design-focused rail. Projects autosave to the library (projects.js). */
const Shell = (() => {
  const MODES = {
    edit: { name: 'Edit', icon: 'edit', st: 'ok' },
    motion: { name: 'Motion', icon: 'motion', st: 'ok' },
    vfx: { name: 'VFX', icon: 'vfx', st: 'ok' },
    color: { name: 'Color', icon: 'color', st: 'ok' },
    image: { name: 'Design', icon: 'design', st: 'ok' },
    audio: { name: 'Audio', icon: 'audio', st: 'ok' },
    vector: { name: 'Vector', icon: 'vector', st: 'ok' },
    '3d': { name: '3D', icon: 'cube', st: 'ok' },
    blocks: { name: 'Blocks', icon: 'blocks', st: 'ok' },
    gaming: { name: 'Capture', icon: 'capture', st: 'ok' },
    ai: { name: 'AI', icon: 'ai', st: 'ok' },
    assets: { name: 'Assets', icon: 'assets', st: 'ok' },
    export: { name: 'Export', icon: 'export', st: 'ok' }
  };
  const RAILS = { video: ['edit', 'motion', 'vfx', 'color', 'image', 'audio', 'vector', '3d', 'blocks', 'gaming', 'ai', '|', 'assets', 'export'], image: ['image', 'vector', 'blocks', 'ai', '|', 'assets', 'export'] };
  const HOME_PAGES = ['home', 'templates', 'library'];
  const WS = [{ id: 'home', name: 'Home', st: 'ok' }, ...Object.keys(MODES).map(id => Object.assign({ id }, MODES[id]))];
  const S = { active: 'home', tab: 'home', lastStatus: '' };
  const $$ = id => document.getElementById(id);
  const card = (icon, t, s, fn) => el('div', { class: 'ncard', onclick: fn }, el('div', { class: 'ic' }, Icon(icon, 22)), el('b', {}, t), el('small', {}, s));
  const kind = () => Projects.current ? Projects.current.kind : 'video';
  const MODS = () => ({ audio: typeof AudioMix !== 'undefined' && AudioMix, gaming: typeof Gaming !== 'undefined' && Gaming, ai: typeof AIMode !== 'undefined' && AIMode, vector: typeof VectorMode !== 'undefined' && VectorMode, '3d': typeof ThreeD !== 'undefined' && ThreeD, blocks: typeof BlocksMode !== 'undefined' && BlocksMode });

  /* ---------- routing ---------- */
  function go(id) {
    if (HOME_PAGES.includes(id)) return showHome(id);
    const m = MODES[id]; if (!m) return;
    if (S.active === 'image' && id !== 'image') Assets.syncAll();
    if (S.active === 'edit' && id !== S.tab) pause();
    if (S.tab === 'motion' && id !== 'motion') Motion.leave();
    if (S.active === 'vfx' && id !== 'vfx' && VFX.ui) VFX.ui.playing = false;
    $$('homeShell').classList.add('hidden'); $$('studio').classList.remove('hidden');
    let target = id; if (id === 'motion' || id === 'color') target = 'edit'; if (m.st === 'plan') target = 'planned';
    const mod = MODS()[target];                       // modes that mount their own workspace (Audio, Gaming, AI, Vector, 3D)
    if (mod && !$$('ws-' + target)) $$('wsHost').append(el('div', { id: 'ws-' + target, class: 'workspace hidden mode-ws' }));
    document.querySelectorAll('.workspace').forEach(e => e.classList.add('hidden')); $$('ws-' + target).classList.remove('hidden');
    if (mod) mod.enter($$('ws-' + target));
    S.active = target; S.tab = id; buildRail();
    if (id === 'motion') { Motion.enter(); leftTab = 'motion'; buildLeft(); } else Motion.refreshBar();
    if (typeof ColorPage !== 'undefined') ColorPage.set(id === 'color');
    if (target === 'edit') { Persona.emptyStage(); requestAnimationFrame(() => { resizeOverlay(); if (!userZoomed) fitView(); }); uiHistory(); }
    else { $$('btnUndo').disabled = false; $$('btnRedo').disabled = false; }
    if (target === 'image') NXI.ui.enter();
    if (target === 'vfx') VFX.ui.enter();
    if (target === 'assets') renderAssets(); if (target === 'export') renderExport(); if (target === 'planned') renderPlanned(m);
    $$('projName').value = Projects.current ? Projects.name() : Motion.editProject().name;
    if ($$('viewName')) $$('viewName').textContent = $$('projName').value;
    if (typeof Connect !== 'undefined') { if (id === 'edit' || (Connect.S.ctx && Connect.S.ctx.mode !== id)) Connect.S.ctx = id === 'edit' ? null : Connect.S.ctx; Connect.chip(); }
  }
  /** rail click from the timeline: if the selected clip already has something in that mode, open it directly */
  function railGo(id) {
    const L = S.tab === 'edit' && typeof selLayer === 'function' ? selLayer() : null;
    if (L && typeof Connect !== 'undefined') {
      if (id === 'vfx' && L.fxGraph) return Connect.vfxForClip(L);
      if (id === 'image' && L.type === 'image' && media[L.media] && media[L.media].link) return Connect.designForLayer(L);
      if (id === 'motion' && L.type === 'comp' && L.compRef) return Connect.motionForLayer(L);
      if (id === 'audio' && (L.type === 'video' || L.type === 'audio')) return Connect.audioForLayer(L);
    }
    go(id);
  }
  function buildRail() {
    const r = $$('rail'); r.innerHTML = '';
    for (const id of RAILS[kind()]) {
      if (id === '|') { r.append(el('div', { class: 'rsep' })); continue; }
      const m = MODES[id], b = el('button', { class: 'rbtn' + (S.tab === id ? ' on' : '') + (m.st === 'plan' ? ' soon' : ''), 'data-ws': id, title: m.st === 'plan' ? m.name + ' — in development' : m.name, onclick: () => railGo(id) }, Icon(m.icon, 20), m.name);
      if (m.st === 'plan') b.append(el('span', { class: 'st' }, 'soon')); r.append(b);
    }
  }

  /* ---------- project lifecycle ---------- */
  const SIZES = { 'HD · 1280×720': [1280, 720], 'Full HD · 1920×1080': [1920, 1080], 'QHD · 2560×1440': [2560, 1440], '4K UHD · 3840×2160': [3840, 2160], 'DCI 4K · 4096×2160': [4096, 2160], '8K UHD · 7680×4320': [7680, 4320], 'Vertical · 1080×1920': [1080, 1920], 'Vertical 4K · 2160×3840': [2160, 3840], 'Square · 1080×1080': [1080, 1080], 'Portrait · 1080×1350': [1080, 1350] };
  const FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const profile = () => typeof Account !== 'undefined' ? Account.prefs() : {};
  const stamp = () => new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  async function leaveProject() { if (Projects.current) await Recovery.flush(); Disk.S.folder = null; }
  function resetAll(w, h) {
    pause(); exitAllComps(); if (Motion.S.inMotion) Motion.leave(); Motion.reset(); VFX.reset(); if (typeof LUT !== 'undefined') LUT.reset();
    NXI.ui.open = []; NXI.ui.doc = null; for (const k in Assets.docs) delete Assets.docs[k];
    resetProject(w, h); buildLeft();
  }
  /** kind: 'video' | 'image'.  o: { name, w, h, mode, template (image template id), motion (Motion template), demo } */
  async function newProject(kindIn, o) {
    o = o || {}; await leaveProject(); Recovery.suspended = true;
    try {
      const pf = profile(), w = o.w || pf.w || 1920, h = o.h || pf.h || 1080, name = o.name || (kindIn === 'image' ? 'Design ' : 'Video ') + stamp();
      resetAll(w, h); P.name = name; P.fps = +o.fps || pf.fps || P.fps; structChanged(); commit();
      Projects.current = { id: uid(), name, kind: kindIn, created: Date.now() };
      if (kindIn === 'image') {
        const d = o.template ? NXI.templates.create(o.template) : NXI.newDoc({ name, w, h, bg: '#ffffff' }); if (!o.template) NXI.push(d, 'New document');
        d.name = o.template ? d.name : name; Assets.docs[d.id] = d; NXI.ui.open = [d.id]; NXI.ui.doc = d; Projects.current.name = d.name;
        enter('image');
      } else {
        if (o.demo) { buildDemo(); structChanged(); commit(); }
        enter(o.mode || 'edit');
        if (o.motion) { const t = Motion.TEMPLATES.find(x => x.name === o.motion); if (t) { Motion.createComp({ name: t.name, dur: t.dur, w, h }, t.build); Motion.placeInEdit(); P.dur = Math.max(t.dur, 1); structChanged(); commit(); } }
      }
    } finally { Recovery.suspended = false; }
    await Projects.save(); status('Saved');
  }
  async function openProject(id) {
    await leaveProject();
    try { afterOpen(await Projects.load(id)); }
    catch (e) { toast('Could not open: ' + e.message); console.error(e); }
  }
  function afterOpen(r) {
    Proxies.restoreAll(); const ws = r.env.assets && r.env.assets.workspace;
    enter(r.meta.kind === 'image' ? 'image' : (MODES[ws] && RAILS.video.includes(ws) && MODES[ws].st === 'ok' ? ws : 'edit'));
    const miss = Disk.missing(); if (miss.length) relinkDialog(); else if (r.probs.length) toast(`Opened with ${r.probs.length} warning(s): ${r.probs[0]}`);
  }
  /* ---------- desktop: project folders, relink, collect ---------- */
  async function openFolderDialog() {
    if (!Disk.on) return toast('Project folders need the desktop app.');
    const f = await Disk.fs.pickFolder({ title: 'Open NEXORA project folder', defaultPath: await Disk.fs.defaultRoot() }); if (!f) return;
    await leaveProject(); try { afterOpen(await Projects.openFolder(f)); } catch (e) { toast('Could not open: ' + e.message); }
  }
  function relinkDialog() {
    const body = el('div', { style: 'min-width:520px;max-height:60vh;overflow:auto' }), render = () => {
      const miss = Disk.missing(); body.innerHTML = '';
      if (!miss.length) { body.append(el('p', {}, 'All media is online.')); return; }
      body.append(el('p', { class: 'dim', style: 'margin:0 0 10px' }, `${miss.length} file${miss.length > 1 ? 's are' : ' is'} offline. Point NEXORA at the new location; offline clips show a red card until relinked.`));
      for (const m of miss) body.append(el('div', { style: 'display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)' },
        el('div', { style: 'flex:1;min-width:0' }, el('b', {}, m.name), el('div', { class: 'dim', style: 'font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: m.path || '' }, m.path || 'no path recorded')),
        el('button', { onclick: async () => { const [p] = await Disk.fs.pickFiles({ title: 'Locate ' + m.name }); if (!p) return; if (Disk.base(p).toLowerCase() !== m.name.toLowerCase() && !confirm(`"${Disk.base(p)}" has a different name than "${m.name}". Use it anyway?`)) return; try { await Disk.relinkTo(m, p); render(); } catch (e) { toast(e.message); } } }, 'Locate…')));
    };
    render();
    showModal('Relink media', body, [['Search folder…', async () => { const d = await Disk.fs.pickFolder({ title: 'Search this folder (and subfolders) for missing files' }); if (!d) return; const n = await Disk.searchAndRelink(d); toast(n ? `Relinked ${n} file(s)` : 'No matching files found'); render(); }], ['Done', closeModal, true]]);
  }
  async function collectFiles() {
    const cur = Projects.current; if (!Disk.on || !cur || !cur.folder) return toast('Open a desktop project first.');
    const n = await Disk.collect(cur.folder, (p, m) => status(`Collecting ${Math.round(p * 100)}% · ${m.name}`));
    await Projects.save(); status('Saved'); toast(n ? `Copied ${n} file(s) into ${cur.folder}${Disk.fs.sep}Media` : 'All media is already inside the project folder.');
  }
  async function clearCaches() {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (!confirm(`Clear the proxy cache?${est ? `\nApp storage in use: ${(est.usage / 1e6).toFixed(0)} MB.` : ''}\nProxies are rebuilt on demand; projects and media are not touched.`)) return;
    for (const m of Object.values(media)) if (m.proxyUrl) await Proxies.remove(m);
    await new Promise(r => { const q = indexedDB.deleteDatabase('nexora-proxies'); q.onsuccess = q.onerror = q.onblocked = r; }); toast('Proxy cache cleared');
  }
  function enter(mode) { $$('homeShell').classList.add('hidden'); $$('studio').classList.remove('hidden'); go(mode); }
  async function importProjectFile(f) {
    try {
      await leaveProject(); const env = JSON.parse(await f.text()), probs = await loadEnvelope(env);
      const hasVideo = P.layers.length > 0 || Motion.list().length > 0 || VFX.list().length > 0, isImage = !hasVideo && Object.keys(Assets.docs).length > 0;
      if (isImage && !NXI.ui.doc) { NXI.ui.doc = Object.values(Assets.docs)[0]; NXI.ui.open = [NXI.ui.doc.id]; }
      Projects.current = { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), kind: isImage ? 'image' : 'video', created: Date.now() };
      if (!isImage) P.name = Projects.current.name; enter(isImage ? 'image' : 'edit'); await Projects.save();
      toast('Project imported' + (probs.length ? ` with ${probs.length} warning(s)` : '.'));
    } catch (e) { toast('Could not open: ' + e.message); console.error(e); }
  }
  async function importImageFiles(files) {
    await newProject('image', {}); const d = NXI.ui.doc; delete Assets.docs[d.id]; NXI.ui.open = []; NXI.ui.doc = null;
    await NXI.ui.openFiles(files); if (NXI.ui.doc) { Projects.current.name = NXI.ui.doc.name; await Projects.save(); }
  }

  /* ---------- project envelope ---------- */
  async function buildEnvelope(o) {
    o = o || {}; const edit = JSON.parse(await projectToJSON({ data: o.mediaData !== false, embedPaths: !!o.embedPaths, project: Motion.editProject() })), images = {};
    for (const id in Assets.docs) images[id] = await NXI.toJSON(Assets.docs[id]);
    const env = Schema.envelope({ edit, images, motion: Motion.toJSON(), vfx: VFX.toJSON(), assets: { open: NXI.ui.open.slice(), active: NXI.ui.doc ? NXI.ui.doc.id : null, workspace: S.tab } });
    if (typeof LUT !== 'undefined') env.luts = LUT.toJSON(); return env;
  }
  /** "Export project file": a portable .nexora with all media embedded */
  async function saveProject() {
    try { toast('Exporting project file…'); const env = await buildEnvelope({ embedPaths: true }); /* portable: linked files are embedded */ const probs = Schema.validate(env); if (probs.length) console.warn('validation', probs); download(new Blob([JSON.stringify(env)], { type: 'application/json' }), (Projects.name() || safeName()).replace(/[^\w\- ]+/g, '') + '.nexora'); if (Projects.current) Recovery.save(); toast('Project file saved (.nexora · schema v' + Schema.CURRENT + ')'); }
    catch (e) { toast('Save failed: ' + e.message); console.error(e); }
  }
  async function loadEnvelope(raw) {
    const env = Schema.migrate(raw), probs = Schema.validate(env);
    Recovery.suspended = true;
    try {
      pause(); exitAllComps(); if (Motion.S.inMotion) { Motion.leave(); S.tab = 'edit'; } Motion.reset(); VFX.reset(); NXI.ui.open = []; NXI.ui.doc = null; for (const k in Assets.docs) delete Assets.docs[k];
      for (const id in env.images || {}) { const d = await NXI.fromJSON(env.images[id]); Assets.docs[d.id] = d; }
      await Motion.fromJSON(env.motion); VFX.fromJSON(env.vfx); if (typeof LUT !== 'undefined') LUT.fromJSON(raw.luts || env.luts);
      if (env.edit) { await loadProjectJSON(env.edit); buildLeft(); }
      Assets.syncAll(true);
      if (typeof VectorMode !== 'undefined') await VectorMode.relinkAll();   // re-render linked drawings from their vector data
      const a = env.assets || {}; (a.open || []).forEach(id => Assets.docs[id] && NXI.ui.open.push(id)); NXI.ui.doc = Assets.docs[a.active] || (NXI.ui.open[0] && Assets.docs[NXI.ui.open[0]]) || null;
      if (NXI.ui.mounted) NXI.ui.refreshAll();
    } finally { Recovery.suspended = false; }
    return probs;
  }
  const openProjectFile = importProjectFile;

  /* ---------- Home ---------- */
  function showHome(page) {
    if (S.tab === 'motion') Motion.leave(); if (S.active === 'edit') pause(); if (S.active === 'image') Assets.syncAll();
    if (VFX.ui) VFX.ui.playing = false;
    const wasStudio = !$$('studio').classList.contains('hidden');
    $$('studio').classList.add('hidden'); $$('homeShell').classList.remove('hidden'); S.active = 'home'; S.tab = page;
    renderNav(page);
    const draw = () => ({ home: renderHome, templates: renderTemplates, library: renderLibrary }[page] || renderHome)();
    if (wasStudio && Projects.current) { draw(); Recovery.flush().then(() => { if (S.active === 'home') draw(); }); } else draw();
  }
  function renderNav(page) {
    const n = $$('homeNav'); n.innerHTML = '';
    const item = (icon, label, fn, on) => el('button', { class: 'hn-item' + (on ? ' on' : ''), onclick: fn }, Icon(icon, 18), label);
    n.append(el('div', { class: 'hn-brand' }, el('div', { class: 'brand-mark' }), 'NEXORA'),
      item('home', 'Home', () => go('home'), page === 'home'), item('templates', 'Templates', () => go('templates'), page === 'templates'),
      el('div', { class: 'hn-sec' }, 'Create'),
      item('edit', 'Video Studio', () => newProject('video')), item('design', 'Design Studio', () => newProject('image')), item('motion', 'Motion Studio', () => newProject('video', { mode: 'motion' })), item('vfx', 'VFX Studio', () => newProject('video', { mode: 'vfx' })),
      el('div', { class: 'hn-sep' }), el('div', { class: 'hn-sec' }, 'Management'),
      item('library', 'Library', () => go('library'), page === 'library'), item('import', 'Import project file', () => $$('projIn').click()),
      el('div', { class: 'spacer' }),
      typeof About !== 'undefined' ? el('button', { class: 'hn-item hn-new', title: 'What changed in each version', onclick: () => About.whatsNew() }, Icon('star', 18), "What's new", el('span', { class: 'hn-ver' }, 'v' + About.version())) : null,
      item('command', 'Commands', openPalette), item('theme', 'Accent theme', toggleTheme), typeof Account !== 'undefined' ? Account.navItem() : null);
  }
  /** redraws Home after the account changes (per-account projects, name in the corner) */
  function refreshHome() { if (S.active === 'home' && !$$('homeShell').classList.contains('hidden')) showHome(HOME_PAGES.includes(S.tab) ? S.tab : 'home'); }
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : new Date(t).toLocaleDateString(); };
  function projectTile(m, refresh) {
    const tile = el('div', { class: 'ptile', onclick: () => openProject(m.id) });
    const acts = el('div', { class: 'pacts' },
      el('button', { title: 'Rename', onclick: async e => { e.stopPropagation(); const v = await askText('Rename project', m.name); if (v) { await Projects.rename(m.id, v.slice(0, 80)); refresh(); } } }, Icon('rename', 14)),
      el('button', { title: 'Duplicate', onclick: async e => { e.stopPropagation(); await Projects.duplicate(m.id); refresh(); } }, Icon('duplicate', 14)),
      m.folder && Disk.on ? el('button', { title: 'Show in folder', onclick: e => { e.stopPropagation(); Disk.fs.reveal(Disk.projectFile(m.folder)); } }, Icon('open', 14)) : null,
      el('button', { title: m.folder ? 'Remove from library (the folder on disk is kept)' : 'Delete', onclick: async e => { e.stopPropagation(); if (confirm(m.folder ? `Remove "${m.name}" from the library?\nThe project folder stays on disk:\n${m.folder}` : `Delete "${m.name}"? This cannot be undone.`)) { await Projects.remove(m.id); refresh(); } } }, Icon('trash', 14)));
    tile.append(el('div', { class: 'pth', style: m.thumb ? `background-image:url(${m.thumb})` : '' }, acts, el('span', { class: 'pkind' }, Icon(m.kind === 'image' ? 'design' : 'edit', 11), m.kind === 'image' ? 'Design' : 'Video')),
      el('b', { title: m.name }, m.name), el('small', {}, `${m.info || ''}${m.info ? ' · ' : ''}${ago(m.updated)}`));
    return tile;
  }
  async function renderHome() {
    const root = $$('homeMain'); root.innerHTML = '';
    root.append(Persona.homeHeader());
    const pf = profile(), curSize = Object.keys(SIZES).find(k => SIZES[k][0] === (pf.w || 1920) && SIZES[k][1] === (pf.h || 1080)) || 'Full HD · 1920×1080', q = { name: '', size: curSize, fps: pf.fps || 30 };
    const nameIn = el('input', { id: 'npName', placeholder: 'Untitled', oninput: e => q.name = e.target.value, onkeydown: e => { if (e.key === 'Enter') go2(); } });
    const sizeSel = el('select', { id: 'npSize', onchange: e => q.size = e.target.value }, Object.keys(SIZES).map(k => el('option', { value: k, selected: k === curSize ? '' : undefined }, k)));
    const fpsSel = el('select', { id: 'npFps', onchange: e => q.fps = +e.target.value }, FPS.map(v => el('option', { value: v, selected: v === q.fps ? '' : undefined }, v + ' fps')));
    const go2 = () => { const [w, h] = SIZES[q.size]; newProject('video', { name: q.name.trim() || undefined, w, h, fps: q.fps }); };
    const mode = (icon, t, fn) => el('button', { onclick: fn }, Icon(icon, 15), t);
    root.append(el('div', { class: 'np-bar' }, el('label', {}, 'New project', nameIn), el('label', {}, 'Resolution', sizeSel), el('label', {}, 'Frame rate', fpsSel), el('button', { class: 'primary', id: 'npCreate', onclick: go2 }, 'Create')),
      el('div', { class: 'np-modes' }, mode('design', 'Design', () => newProject('image')), mode('motion', 'Motion graphics', () => newProject('video', { mode: 'motion' })), mode('vfx', 'VFX compositing', () => newProject('video', { mode: 'vfx' })), mode('open', 'Open image', () => { const i = el('input', { type: 'file', accept: 'image/*,.nxi,.tif,.tiff,.psd', multiple: '' }); i.onchange = () => importImageFiles([...i.files]); i.click(); })));
    root.append(el('div', { class: 'hsec' }, el('h3', {}, 'Projects'), el('div', { class: 'spacer' }), el('div', { class: 'hsearch' }, Icon('search', 14), el('input', { id: 'projSearch', placeholder: 'Search projects', oninput: () => fillProjects() })), Disk.on ? el('button', { class: 'ibtn', onclick: openFolderDialog }, Icon('open', 14), 'Open folder') : null, el('button', { class: 'ibtn', onclick: () => $$('projIn').click() }, Icon('import', 14), 'Import'), el('a', { onclick: () => go('library') }, 'Library')));
    const grid = el('div', { class: 'pgrid', id: 'projGrid' }); root.append(grid); fillProjects();
  }
  async function fillProjects() {
    const grid = $$('projGrid'); if (!grid) return; const q = ($$('projSearch') || {}).value || ''; const list = (await Projects.list()).filter(m => m.name.toLowerCase().includes(q.toLowerCase()));
    grid.innerHTML = ''; grid.append(el('div', { class: 'ptile new', onclick: () => newProject('video') }, el('div', { class: 'pth' }, Icon('plus', 22), 'New project'), el('b', {}, ' '), el('small', {}, ' ')));
    list.forEach(m => grid.append(projectTile(m, () => S.tab === 'library' ? renderLibrary() : fillProjects())));
    if (!list.length && q) grid.append(el('div', { class: 'empty' }, 'No projects match.'));
  }
  const qcard = (icon, t, s, fn) => el('div', { class: 'qcard', onclick: fn }, el('div', { class: 'qi' }, Icon(icon, 19)), el('b', {}, t), el('small', {}, s));
  /* template cards: image templates build a doc for the thumbnail; motion templates build a comp in a temporary context */
  const tplThumbs = {}, thumbQ = []; let thumbBusy = false;
  function templateCard(kindT, id, name, desc) {
    const th = el('div', { class: 'sth', style: tplThumbs[kindT + id] ? `background-image:url(${tplThumbs[kindT + id]})` : '' });
    const c = el('div', { class: 'scard', onclick: () => kindT === 'image' ? newProject('image', { template: id }) : newProject('video', { motion: id, name: id }) }, th, el('div', { class: 'sm' }, el('b', {}, name), el('small', {}, desc)));
    if (!tplThumbs[kindT + id]) { thumbQ.push([kindT, id, th]); if (!thumbBusy) pump(); } return c;
  }
  function pump() {
    const j = thumbQ.shift(); if (!j) { thumbBusy = false; return; } thumbBusy = true;
    setTimeout(() => {
      const [k, id, th] = j;
      try {
        let url = null;
        if (k === 'image') url = NXI.thumbURL(NXI.templates.create(id), 360);
        else if (k === 'motion') { const t = Motion.TEMPLATES.find(x => x.name === id), saved = P; try { P = Motion.newComp({ w: 1280, h: 720, dur: t.dur }); t.build(); url = Motion.thumb(P, 360); } finally { P = saved; } }
        if (url) { tplThumbs[k + id] = url; th.style.backgroundImage = `url(${url})`; }
      } catch (e) { console.warn('template thumb', e); }
      pump();
    }, 20);
  }
  function renderTemplates() {
    const root = $$('homeMain'); root.innerHTML = '';
    root.append(el('div', { class: 'hsec', style: 'margin-top:4px' }, el('h3', { style: 'font-size:20px' }, 'Templates')), el('div', { class: 'dim', style: 'margin-top:-6px' }, 'Every template is built from editable layers and keyframes — nothing is flattened.'));
    root.append(el('div', { class: 'hsec' }, el('h3', {}, 'Video & motion')));
    const v = el('div', { class: 'suite' }); root.append(v);
    Motion.TEMPLATES.forEach(t => v.append(templateCard('motion', t.name, t.name.replace(' — stroke draw-on', ''), `${t.dur}s · keyframed composition`)));
    root.append(el('div', { class: 'hsec' }, el('h3', {}, 'Image & design')));
    const i = el('div', { class: 'suite' }); root.append(i);
    NXI.templates.list.filter(t => t.id !== 'minecraft').forEach(t => i.append(templateCard('image', t.id, t.name, `${t.w} × ${t.h}`)));
  }
  async function renderLibrary() {
    const root = $$('homeMain'); root.innerHTML = '';
    const sort = { by: localStorage.getItem('nexora.libSort') || 'updated' };
    root.append(el('div', { class: 'hsec', style: 'margin-top:4px' }, el('h3', { style: 'font-size:20px' }, 'Library'), el('div', { class: 'spacer' }),
      el('select', { onchange: e => { localStorage.setItem('nexora.libSort', e.target.value); renderLibrary(); } }, [['updated', 'Last edited'], ['name', 'Name'], ['size', 'Size']].map(([k, n]) => el('option', { value: k, selected: k === sort.by ? '' : undefined }, n))),
      el('button', { class: 'ibtn', onclick: () => $$('projIn').click() }, Icon('import', 14), 'Import .nexora')));
    let list = await Projects.list(); if (sort.by === 'name') list.sort((a, b) => a.name.localeCompare(b.name)); if (sort.by === 'size') list.sort((a, b) => b.size - a.size);
    const total = list.reduce((a, m) => a + (m.size || 0), 0);
    root.append(el('div', { class: 'dim', style: 'margin:-4px 0 14px' }, `${list.length} project(s) · ${(total / 1048576).toFixed(1)} MB stored in this browser / app. Projects save automatically while you work.`));
    const grid = el('div', { class: 'pgrid' }); root.append(grid);
    if (!list.length) grid.append(el('div', { class: 'empty' }, 'Nothing here yet. Your first cut goes here.'));
    list.forEach(m => grid.append(projectTile(m, renderLibrary)));
  }

  /* ---------- studio pages: Assets, Export, in-development modes ---------- */
  let assetFilter = 'all';
  function renderAssets() {
    const root = $$('ws-assets'); root.innerHTML = ''; const page = el('div', { class: 'page' }); root.append(page);
    const usage = Assets.usage(), list = Assets.list().filter(a => assetFilter === 'all' || a.kind === assetFilter);
    page.append(el('h1', {}, 'Assets'), el('div', { class: 'lead' }, 'Everything in this project. Linked assets update everywhere they are used.'));
    page.append(el('div', { style: 'display:flex;gap:6px;margin:14px 0;flex-wrap:wrap' }, ...[['all', 'All'], ['video', 'Video'], ['image', 'Images'], ['audio', 'Audio'], ['image-doc', 'Designs'], ['motion-comp', 'Compositions'], ['vfx-graph', 'VFX graphs']].map(([k, n]) => el('button', { class: assetFilter === k ? 'on' : '', onclick: () => { assetFilter = k; renderAssets(); } }, n)), el('div', { class: 'spacer' }), el('button', { class: 'primary ibtn', onclick: () => $$('fileIn').click() }, Icon('import', 14), 'Import media')));
    const probs = Assets.problems(); if (probs.length) page.append(el('div', { class: 'banner' }, el('b', {}, probs.length + ' asset problem(s)'), el('span', { class: 'dim' }, probs.slice(0, 3).join(' · '))));
    if (!list.length) page.append(el('div', { class: 'dim' }, 'No assets yet. Import media, or create a design.'));
    const g = el('div', { class: 'cards' }); page.append(g);
    list.forEach(a => {
      const u = usage[a.id] || 0, kindName = { video: 'Video', image: a.link ? 'Image (linked)' : 'Image', audio: 'Audio', 'image-doc': 'Design', 'motion-comp': 'Composition', 'vfx-graph': 'VFX graph' }[a.kind];
      const acts = el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;margin-top:8px' }), b = (t, fn) => el('button', { onclick: e => { e.stopPropagation(); fn(); } }, t);
      if (a.kind === 'motion-comp') acts.append(b('Open', () => Motion.open(a.id)), b('Add to timeline', () => Motion.placeInEdit(a.id)));
      if (a.kind === 'vfx-graph') acts.append(b('Open', () => VFX.ui.open(a.id)), b('Add to timeline', () => { VFX.S.active = a.id; VFX.ui.placeInEdit(); }));
      if (media[a.id]) acts.append(b('Add to timeline', () => { go('edit'); addMediaLayer(media[a.id], T); }));
      if (a.kind === 'image') acts.append(b('Edit in Design', () => Assets.openMediaInImage(a.id)));
      if (a.kind === 'image-doc') acts.append(b('Open', () => { go('image'); NXI.ui.openDoc(Assets.docs[a.id]); }), b('Add to timeline', () => { const m = Assets.publishDoc(Assets.docs[a.id]); go('edit'); addMediaLayer(m, T); }));
      acts.append(el('button', { title: u ? 'In use — cannot delete' : 'Delete', disabled: u ? '' : undefined, onclick: e => { e.stopPropagation(); if (confirm(`Delete "${a.name}"?`) && Assets.remove(a.id)) renderAssets(); } }, Icon('trash', 14)));
      g.append(el('div', { class: 'ncard dis' }, el('div', { class: 'thumb', style: a.thumb ? `background-image:url(${a.thumb})` : 'display:flex;align-items:center;justify-content:center;color:#777' }, a.thumb ? '' : Icon(a.kind === 'audio' ? 'music' : 'film', 30)),
        el('b', { title: a.name, style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, a.name), el('small', {}, `${kindName}${a.w ? ` · ${a.w}×${a.h}` : ''}${a.dur && a.kind !== 'image' && a.kind !== 'image-doc' ? ' · ' + fmtDur(a.dur) : ''}${a.layers ? ' · ' + a.layers + (a.kind === 'vfx-graph' ? ' nodes' : ' layers') : ''}`), el('small', {}, u ? `Used ${u}×` : 'Unused' + (a.missing ? ' · missing data' : '')), acts));
    });
  }
  function renderExport() {
    const root = $$('ws-export'); root.innerHTML = ''; const page = el('div', { class: 'page' }); root.append(page);
    page.append(el('h1', {}, 'Export'), el('div', { class: 'lead' }, 'Deliver the finished project.'));
    const docs = Object.values(Assets.docs), o = { doc: NXI.ui.doc ? NXI.ui.doc.id : (docs[0] || {}).id, fmt: 'png' }, p = Motion.editProject();
    const sel = el('select', { onchange: e => o.doc = e.target.value }, docs.map(d => el('option', { value: d.id, selected: d.id === o.doc ? '' : undefined }, d.name)));
    const cards = el('div', { class: 'cards', style: 'margin-top:16px' });
    if (kind() === 'video') cards.append(card('film', 'Video', `${p.w}×${p.h} · ${tcFmt(p.dur)} — exact-frame MP4, or MP4/WebM capture`, () => { go('edit'); exportDialog(); }), card('image', 'Current frame', 'PNG of the Edit frame at the playhead', () => { go('edit'); exportFrame('png'); }),
      ...(typeof Reframe !== 'undefined' ? [p.w >= p.h ? card('grid', 'Vertical 9:16 version', 'Copies this edit and reframes it for Reels, TikTok and Shorts. The original stays as it is.', () => Reframe.version('9:16')) : card('grid', 'Widescreen 16:9 version', 'Copies this edit and reframes it for YouTube and TV. The original stays as it is.', () => Reframe.version('16:9')), card('grid', 'Square 1:1 version', 'Copies this edit and reframes it square for feeds.', () => Reframe.version('1:1'))] : []));
    if (kind() === 'video' && ProMedia.on) cards.append(card('layers', 'Render queue', `${RenderQueue.S.items.length} job${RenderQueue.S.items.length === 1 ? '' : 's'} waiting. Line up several formats and walk away.`, () => RenderQueue.open()), card('settings', 'Project Doctor', 'Check for gaps, flash frames, clipping and offline media.', () => { go('edit'); Doctor.open(); }));
    cards.append(el('div', { class: 'ncard dis' }, el('div', { class: 'ic' }, Icon('design', 22)), el('b', {}, 'Design'), docs.length ? el('div', {}, sel, el('div', { style: 'height:6px' }), el('select', { onchange: e => o.fmt = e.target.value }, ['png', 'jpeg', 'webp', 'tiff', 'bmp', 'svg', 'nxi'].map(f => el('option', { value: f }, f.toUpperCase()))), el('div', { style: 'height:8px' }), el('button', { class: 'primary', onclick: async () => { const d = Assets.docs[o.doc]; if (!d) return; const b = await NXI.formats.exportBlob(d, o.fmt); download(b, d.name + '.' + ({ jpeg: 'jpg', tiff: 'tif' }[o.fmt] || o.fmt)); } }, 'Export')) : el('small', {}, 'No designs in this project.')),
      card('library', 'Project file', 'Portable .nexora with all media, designs, compositions and VFX graphs', saveProject));
    page.append(cards);
  }
  function renderPlanned(m) {
    const root = $$('ws-planned'); root.innerHTML = '';
    root.append(el('div', { class: 'page', style: 'display:flex;align-items:center;justify-content:center' }, el('div', { style: 'max-width:520px;text-align:center' },
      el('div', { style: 'color:#6f6f86;display:flex;justify-content:center;margin-bottom:14px' }, Icon(m.icon, 44)), el('h1', { style: 'font-size:22px' }, m.name), el('span', { class: 'pill' }, 'In development'),
      el('p', { class: 'lead', style: 'margin:16px auto' }, m.d),
      el('div', { style: 'display:flex;gap:8px;justify-content:center;margin-top:10px' }, el('button', { class: 'primary', onclick: () => go(kind() === 'image' ? 'image' : 'edit') }, kind() === 'image' ? 'Back to Design' : 'Back to Edit')))));
  }

  /* ---------- command palette ---------- */
  function syncProxyBtn() { const b = $$('bProxy'); if (!b) return; const n = Object.values(media).filter(m => m.proxyUrl).length; b.classList.toggle('on', Proxies.S.use); b.title = `Proxy playback ${Proxies.S.use ? 'on' : 'off'} · ${n} proxy clip(s) ready · export always uses originals`; }
  function commands() {
    const out = [{ title: 'Home', run: () => go('home') }, { title: 'Templates', run: () => go('templates') }, { title: 'Library', run: () => go('library') }, { title: 'New video project', run: () => newProject('video') }, { title: 'New design (image) project', run: () => newProject('image') }];
    if (!$$('studio').classList.contains('hidden')) RAILS[kind()].filter(id => id !== '|').forEach(id => out.push({ title: 'Mode: ' + MODES[id].name + (MODES[id].st === 'plan' ? ' (in development)' : ''), run: () => go(id) }));
    if (typeof Account !== 'undefined' && Account.on) out.push({ title: 'Account: Profile and security', run: () => Account.S.user ? Account.page('profile') : Account.openSignIn() });
    if (typeof Copilot !== 'undefined') out.push({ title: 'AI Editor: Open panel', run: () => Copilot.toggle(true) });
    out.push({ title: 'Project: Doctor (check before export)', run: () => { go('edit'); Doctor.open(); } }, { title: 'Project: Version history', run: () => Versions.dialog() }, ...(typeof Reframe !== 'undefined' && kind() === 'video' ? Reframe.commands() : []), { title: 'Export: Render queue', run: () => RenderQueue.open() }, { title: 'Help: Keyboard shortcuts', run: () => Persona.shortcuts() }, { title: 'Help: System check', run: () => Doctor.systemDialog() }, ...(typeof Updates !== 'undefined' ? Updates.commands() : []), ...(typeof About !== 'undefined' ? About.commands() : []));
    out.push({ title: 'Audio: Open music library', run: () => { go('edit'); leftTab = 'audio'; Browser.S.audioPane = 'music'; buildLeft(); } }, { title: 'Audio: Extract audio from selected clip', run: () => { go('edit'); Music.extractDialog(); } });
    out.push({ title: 'Project: Export project file (.nexora)', run: saveProject }, { title: 'Project: Import project file…', run: () => $$('projIn').click() }, { title: 'Theme: toggle accent (light blue ↔ white)', run: toggleTheme }, { title: 'Developer: Run automated self-tests', run: runSelfTests },
      { title: `Performance: ${GPU.S.enabled ? 'Disable' : 'Enable'} GPU effects (now ${GPU.status()})`, run: () => { GPU.setEnabled(!GPU.S.enabled); toast('Effects now render on ' + GPU.status()); } },
      { title: `Performance: ${Proxies.S.use ? 'Disable' : 'Enable'} proxy playback`, run: () => { Proxies.setUse(!Proxies.S.use); syncProxyBtn(); } },
      ...(Disk.on ? [
        { title: 'Project: Open project folder…', run: openFolderDialog },
        { title: 'Project: Show project folder', run: () => Projects.current && Projects.current.folder ? Disk.fs.reveal(Disk.projectFile(Projects.current.folder)) : toast('No project open') },
        { title: 'Media: Relink missing files…', run: relinkDialog },
        { title: 'Media: Collect files into project folder', run: collectFiles }] : []),
      { title: 'Storage: Clear proxy cache', run: clearCaches }, ...(typeof RenderCache !== 'undefined' ? RenderCache.commands() : []),
      { title: 'Performance: Create proxies for all video clips', run: () => { const v = Object.values(media).filter(m => m.kind === 'video' && !m.proxyUrl && Math.min(m.w, m.h) > Proxies.S.short); if (!v.length) return toast('No video above 720p without a proxy.'); Proxies.queue(v); toast(`Creating ${v.length} prox${v.length > 1 ? 'ies' : 'y'} in the background`); } },
      { title: `Performance: ${Proxies.S.auto ? 'Stop auto-creating' : 'Auto-create'} proxies for imported video above 1080p`, run: () => { Proxies.setAuto(!Proxies.S.auto); toast('Auto proxies ' + (Proxies.S.auto ? 'on' : 'off')); } }, { title: 'Assets: Re-sync linked designs', run: () => toast(Assets.syncAll(true) + ' linked asset(s) refreshed') });
    for (const m of ['file', 'edit', 'layer', 'view']) for (const it of menuItems(m)) if (it !== '-') out.push({ title: 'Edit › ' + it[0], run: () => { go('edit'); it[1](); }, kbd: it[2] });
    if (NXI.ui.commands) out.push(...NXI.ui.commands());
    out.push({ title: 'Motion: New composition', run: () => Motion.createComp() }, ...Motion.TEMPLATES.map(t => ({ title: 'Motion template: ' + t.name, run: () => Motion.createComp({ name: t.name, dur: t.dur }, t.build) })), { title: 'Motion: Composition settings', run: () => { go('motion'); Motion.settingsDialog(); } }, { title: 'Motion: Place composition in Edit', run: () => { go('motion'); Motion.placeInEdit(); } }, { title: 'Motion: Easy Ease selected keyframe (F9)', run: () => G.easyEase && G.easyEase() });
    out.push({ title: 'VFX: New node graph', run: () => { go('vfx'); const g = VFX.newGraph(); VFX.snap(g, 'New graph'); VFX.ui.open(g.id); } }, { title: 'VFX: Place graph in Edit', run: () => { go('vfx'); VFX.ui.placeInEdit(); } }, ...Object.keys(VFX.DEFS).filter(k => !['gin', 'gout', 'output', 'group'].includes(k)).map(k => ({ title: 'VFX node: ' + VFX.DEFS[k].name, run: () => { go('vfx'); VFX.addNode(VFX.ui.cur(), k, 100, 100); VFX.snap(VFX.graph(VFX.S.active), 'Add node'); VFX.ui.renderGraph(); } })));
    return out;
  }
  function openPalette() {
    const box = $$('palette'), cmds = commands(); box.innerHTML = ''; box.classList.remove('hidden'); let idx = 0, shown = cmds;
    const input = el('input', { placeholder: 'Type a command…  (e.g. "blur", "export", "new design")' }), list = el('div', { class: 'plist' });
    const draw = () => { const q = input.value.toLowerCase().split(/\s+/).filter(Boolean); shown = cmds.filter(c => q.every(w => c.title.toLowerCase().includes(w))).slice(0, 60); idx = Math.min(idx, Math.max(0, shown.length - 1)); list.innerHTML = ''; shown.forEach((c, i) => list.append(el('div', { class: 'pi' + (i === idx ? ' on' : ''), onclick: () => runC(c) }, c.title, el('small', {}, c.kbd || '')))); };
    const close = () => box.classList.add('hidden'), runC = c => { close(); try { c.run(); } catch (e) { toast(e.message); } };
    input.oninput = () => { idx = 0; draw(); };
    input.onkeydown = e => { if (e.key === 'ArrowDown') { idx = Math.min(shown.length - 1, idx + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') { if (shown[idx]) runC(shown[idx]); } else if (e.key === 'Escape') close(); e.stopPropagation(); };
    box.onclick = e => { if (e.target === box) close(); };
    box.append(el('div', { class: 'pbox' }, input, list)); draw(); input.focus();
  }
  function toggleTheme() { const h = document.documentElement, v = h.dataset.theme === 'mono' ? '' : 'mono'; if (v) h.dataset.theme = v; else delete h.dataset.theme; localStorage.setItem('nexora.theme', v); }
  function runSelfTests() {
    const done = () => NexoraTests.run().then(r => showModal('Self-tests: ' + r.pass + ' passed, ' + r.fail + ' failed', el('div', { style: 'max-height:60vh;overflow:auto;font:12px Consolas,monospace;white-space:pre-wrap' }, r.lines.join('\n')), [['Close', closeModal, true]]));
    if (window.NexoraTests) return done(); const s = document.createElement('script'); s.src = 'tests/tests.js'; s.onload = done; s.onerror = () => toast('tests/tests.js not found'); document.body.append(s);
  }
  function status(t) { S.lastStatus = t; const a = $$('imgAuto'); if (a) a.textContent = t; const s = $$('saveState'); if (s) s.textContent = t; }
  function showTemplates() { go('templates'); }

  /* ---------- boot ---------- */
  function boot() {
    if (localStorage.getItem('nexora.theme') === 'mono') document.documentElement.dataset.theme = 'mono';
    Icon.decorate(); Connect.quickAdd();
    $$('btnHome').onclick = () => go('home');
    $$('btnPalette').onclick = openPalette; $$('btnTheme').onclick = toggleTheme; $$('btnAI').onclick = () => Copilot.toggle();
    Persona.opening(); Persona.guard(); Account.init(); if (typeof About !== 'undefined') About.onStart(); Account.paintBadge(); $$('saveState').onclick = () => Versions.dialog(); $$('saveState').title = 'Version history';
    const _sc = window.structChanged; window.structChanged = function (...a) { const r = _sc.apply(this, a); Persona.emptyStage(); return r; };
    $$('bProxy').onclick = () => { Proxies.setUse(!Proxies.S.use); syncProxyBtn(); toast(Proxies.S.use ? 'Proxy playback on (export still uses originals)' : 'Proxy playback off'); };
    $$('perfRead').onclick = () => { GPU.setEnabled(!GPU.S.enabled); Perf.paint(); toast('Effects now render on ' + GPU.status()); };
    syncProxyBtn();
    { const q = $$('bPreviewQ'); q.value = Preview.mode; q.onchange = () => { Preview.set(q.value); q.blur(); }; }
    // auto-proxy large imports in the background
    const _imp = window.importFile; window.importFile = async f => { const m = await _imp(f); if (m && Proxies.S.auto && Proxies.needs(m) && Proxies.supported()) Proxies.restore(m).then(ok => { if (!ok) Proxies.queue([m]); }); return m; };
    $$('btnUndo').onclick = () => S.active === 'image' ? NXI.ui.undo() : S.active === 'vfx' ? VFX.ui.undo() : undo(); $$('btnRedo').onclick = () => S.active === 'image' ? NXI.ui.redo() : S.active === 'vfx' ? VFX.ui.redo() : redo();
    $$('btnExport').onclick = () => S.active === 'image' ? NXI.ui.exportDialog() : S.active === 'edit' ? exportDialog() : go('export');
    $$('projIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importProjectFile(f); };
    $$('projName').oninput = e => { const v = e.target.value; if (kind() === 'image' && NXI.ui.doc) { NXI.ui.doc.name = v; NXI.ui.refreshAll(); } else Motion.editProject().name = v; if (Projects.current) Projects.current.name = v; Recovery.touch(); };
    window.saveProject = saveProject;                       // Edit's File › Save and Ctrl+S export a portable project file
    window.newProject = () => newProject('video');           // Edit's File › New project creates a new library project
    const origHist = window.uiHistory; window.uiHistory = function () { if (S.active === 'edit') origHist(); };
    const origCommit = window.commit; window.commit = function () { origCommit(); Recovery.touch(); Persona.activity(); };
    NXI.listeners.push((doc, k) => { if (k === 'hist') Recovery.touch(); });
    window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } }, true);
    window.addEventListener('beforeunload', () => { if (Projects.current) Recovery.save(); });
    NXI.ui.mount();
    const start = new URLSearchParams(location.search).get('ws');
    if (start && MODES[start]) enter(start); else go(HOME_PAGES.includes(start) ? start : 'home');
    if (new URLSearchParams(location.search).get('selftest')) { const s = document.createElement('script'); s.src = 'tests/tests.js'; s.onload = () => NexoraTests.run().then(r => { window.__nexoraTestResults = r; if (parent !== window) parent.postMessage({ nexoraTests: r }, '*'); }); document.body.append(s); }
  }
  Object.assign(S, { refreshHome, commands, go, boot, buildEnvelope, saveProject, loadEnvelope, openProjectFile, importProjectFile, newProject, openProject, openPalette, showTemplates, status, WS, MODES, RAILS, kind });
  return S;
})();
Shell.boot();
