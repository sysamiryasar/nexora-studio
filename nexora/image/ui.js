'use strict';
/* ====================== shared popup menus (nested) ====================== */
const PopMenu = (() => {
  let stack = [];
  function closeFrom(level) { while (stack.length > level) stack.pop().remove(); }
  function open(x, y, items, level) {
    level = level || 0; closeFrom(level);
    const box = el('div', { class: 'npop' }); stack.push(box); document.body.append(box);
    items.forEach(it => {
      if (it === '-') return box.append(el('div', { class: 'ctx-sep' }));
      const b = el('button', { disabled: it.disabled ? '' : undefined }, el('span', {}, (it.check ? '' : '') + it.label), el('kbd', {}, it.sub ? '▸' : (it.kbd || '')));
      b.onmouseenter = () => { closeFrom(level + 1); if (it.sub) { const r = b.getBoundingClientRect(); open(r.right - 2, r.top - 4, typeof it.sub === 'function' ? it.sub() : it.sub, level + 1); } };
      b.onclick = e => { e.stopPropagation(); if (it.sub) return; closeFrom(0); try { it.run && it.run(); } catch (err) { toast(err.message); console.error(err); } };
      box.append(b);
    });
    const r = box.getBoundingClientRect(); box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px'; box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
  }
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.npop') && !e.target.closest('[data-pop]')) closeFrom(0); });
  return { open, close: () => closeFrom(0), at(btn, items) { const r = btn.getBoundingClientRect(); open(r.left, r.bottom + 3, items); } };
})();

/* ====================== NEXORA Image workspace UI ====================== */
NXI.ui = (() => {
  const U = { doc: null, open: [], tool: 'brush', view: { zoom: 1, px: 0, py: 0 }, needs: true, hover: null, space: false, mounted: false };
  const TL = () => NXI.tools; const O = () => NXI.tools.O;
  let root, view, over, vctx2, octx, stage, optBar, toolBox, right, statusEl, tabsEl;

  /* ---------- small control builders ---------- */
  const ctl = {
    num(obj, key, o) {
      o = o || {}; const w = el('div', { style: 'display:flex;gap:5px;align-items:center;flex:1' });
      const r = o.noRange ? null : el('input', { type: 'range', min: o.min, max: o.max, step: o.step || 1, style: 'flex:1;min-width:50px' }), n = el('input', { type: 'number', step: o.step || 1, style: 'width:56px' });
      const sync = () => { if (r) r.value = obj[key]; if (document.activeElement !== n) n.value = +(+obj[key]).toFixed(3); };
      const set = v => { if (!isFinite(v)) return; obj[key] = v; sync(); o.on && o.on(v); };
      if (r) { r.oninput = () => set(+r.value); r.onchange = () => o.commit && o.commit(); w.append(r); }
      n.oninput = () => n.value !== '' && set(+n.value); n.onchange = () => o.commit && o.commit(); w.append(n); sync(); w._sync = sync; return w;
    },
    color(obj, key, o) { o = o || {}; const i = el('input', { type: 'color' }); i.value = obj[key]; i.oninput = () => { obj[key] = i.value; o.on && o.on(); }; i.onchange = () => o.commit && o.commit(); return i; },
    sel(obj, key, opts, o) { o = o || {}; const s = el('select', {}, opts.map(v => el('option', { value: v }, o.names ? o.names(v) : v))); s.value = obj[key]; s.onchange = () => { obj[key] = typeof obj[key] === 'number' ? +s.value : s.value; o.on && o.on(); o.commit && o.commit(); }; return s; },
    chk(obj, key, o) { o = o || {}; const i = el('input', { type: 'checkbox' }); i.checked = !!obj[key]; i.onchange = () => { obj[key] = i.checked; o.on && o.on(); o.commit && o.commit(); }; return i; },
    text(obj, key, o) { o = o || {}; const i = el(o.area ? 'textarea' : 'input', o.area ? { rows: 3 } : { type: 'text', list: o.list }); i.value = obj[key]; i.oninput = () => { obj[key] = i.value; o.on && o.on(); }; i.onchange = () => o.commit && o.commit(); return i; }
  };
  const row = (label, ...k) => el('div', { class: 'prop2' }, el('label', {}, label), ...k);
  const nrow = (label, obj, key, o) => row(label, ctl.num(obj, key, o));

  /* ---------- public API used by tools ---------- */
  U.toast = m => toast(m);
  U.render = () => { U.needs = true; };
  U.toScreen = p => ({ x: U.view.px + p.x * U.view.zoom, y: U.view.py + p.y * U.view.zoom });
  U.toDoc = (sx, sy) => ({ x: (sx - U.view.px) / U.view.zoom, y: (sy - U.view.py) / U.view.zoom });
  U.push = label => { if (!U.doc) return; NXI.push(U.doc, label); afterChange(); };
  function afterChange() { refreshLayers(); refreshHistory(); refreshProps(); U.render(); Recovery.touch(); scheduleLinkSync(); updateTabs(); }
  let linkT = null; function scheduleLinkSync() { const d = U.doc; if (!d || !Assets.linkedMedia(d.id).length) return; clearTimeout(linkT); linkT = setTimeout(() => Assets.syncDoc(d), 900); }
  U.refreshLayers = () => refreshLayers(); U.refreshProps = () => refreshProps(); U.refreshOptions = () => buildOptions(); U.refreshColor = () => refreshColor();
  U.setTool = (id, keep) => setTool(id, keep);
  U.zoomAt = (p, f) => { const s = U.toScreen(p); U.view.zoom = clamp(U.view.zoom * f, .02, 64); U.view.px = s.x - p.x * U.view.zoom; U.view.py = s.y - p.y * U.view.zoom; U.render(); status(); };
  U.fit = () => { if (!U.doc || !stage) return; const r = stage.getBoundingClientRect(); if (!r.width) return; const z = Math.min((r.width - 60) / U.doc.w, (r.height - 60) / U.doc.h, 4); U.view.zoom = Math.max(.02, z); U.view.px = (r.width - U.doc.w * z) / 2; U.view.py = (r.height - U.doc.h * z) / 2; U.render(); status(); };
  U.hitLayer = p => {
    const d = U.doc; let hit = null; const test = list => { for (let i = list.length - 1; i >= 0 && !hit; i--) { const L = list[i]; if (!L.visible || L.locked || L.type === 'adjust') continue; if (L.type === 'group') { test(L.children); if (hit) return; continue; }
      if (L.type === 'raster') { const x = Math.floor(p.x - L.x), y = Math.floor(p.y - L.y); if (x < 0 || y < 0 || x >= L.canvas.width || y >= L.canvas.height) continue; if (L.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data[3] > 10) hit = L; }
      else { const m = NXI.vecMatrix(L), c = NXI.vectorCanvas(L), det = m[0] * m[3] - m[1] * m[2], dx = p.x - m[4], dy = p.y - m[5], u = (m[3] * dx - m[2] * dy) / det, v = (-m[1] * dx + m[0] * dy) / det; if (Math.abs(u) <= c.width / 2 && Math.abs(v) <= c.height / 2) hit = L; } } };
    test(d.layers); return hit;
  };

  /* ---------- documents ---------- */
  U.openDoc = doc => {
    if (!Assets.docs[doc.id]) Assets.docs[doc.id] = doc; if (!U.open.includes(doc.id)) U.open.push(doc.id);
    if (!doc.hist.length) NXI.push(doc, 'Open');
    if (U.doc) U.doc._view = U.view;
    U.doc = doc; if (!doc._view) { U.view = { zoom: 1, px: 0, py: 0 }; doc._view = U.view; U.fit(); } else U.view = doc._view;
    requestAnimationFrame(() => { if (!doc._fitted) { U.fit(); doc._fitted = true; doc._view = U.view; } });
    refreshAll();
  };
  U.closeDoc = (doc, silent) => {
    if (!silent && Assets.linkedMedia(doc.id).length === 0 && doc.histI > 0 && !confirm(`Close "${doc.name}"? Unsaved changes are kept only in the autosave.`)) return;
    U.open = U.open.filter(id => id !== doc.id); if (!Assets.linkedMedia(doc.id).length && !silent) delete Assets.docs[doc.id];
    U.doc = U.open.length ? Assets.docs[U.open[U.open.length - 1]] : null; if (U.doc) U.view = U.doc._view || U.view; refreshAll();
  };
  function newDocDialog() {
    const o = { name: 'Untitled', w: 1920, h: 1080, bg: 'white', color: '#1b0b4a' }, presets = { 'HD 1920×1080': [1920, 1080], 'YouTube thumbnail 1280×720': [1280, 720], '4K UHD 3840×2160': [3840, 2160], 'DCI 4K 4096×2160': [4096, 2160], '8K UHD 7680×4320': [7680, 4320], 'Square 1080': [1080, 1080], 'Story 1080×1920': [1080, 1920], 'A4 300dpi 2480×3508': [2480, 3508], 'Logo 1024': [1024, 1024] };
    const W = ctl.num(o, 'w', { min: 1, max: 12000, noRange: true }), H = ctl.num(o, 'h', { min: 1, max: 12000, noRange: true });
    const ps = el('select', { onchange: e => { const v = presets[e.target.value]; if (v) { o.w = v[0]; o.h = v[1]; W._sync(); H._sync(); } } }, el('option', {}, 'Preset…'), Object.keys(presets).map(k => el('option', { value: k }, k)));
    showModal('New image', el('div', {}, row('Name', ctl.text(o, 'name')), row('Preset', ps), row('Width', W), row('Height', H), row('Background', ctl.sel(o, 'bg', ['white', 'black', 'transparent', 'custom'])), row('Custom', ctl.color(o, 'color')), el('div', { class: 'dim' }, 'Large canvases (above ~40 megapixels) use a lot of memory; history is capped automatically.')),
      [['Templates…', () => { closeModal(); Shell.go('home'); Shell.showTemplates(); }], ['Cancel', closeModal], ['Create', () => { closeModal(); const bg = o.bg === 'custom' ? o.color : o.bg === 'white' ? '#ffffff' : o.bg === 'black' ? '#000000' : 'transparent'; const d = NXI.newDoc({ name: o.name, w: clamp(o.w | 0, 1, 12000), h: clamp(o.h | 0, 1, 12000), bg }); NXI.push(d, 'New document'); U.openDoc(d); }, true]]);
  }
  async function openFiles(files, asLayers) {
    for (const f of files) {
      try {
        const r = await NXI.formats.decodeFile(f);
        if (r.doc) { U.openDoc(r.doc); continue; }
        if (asLayers && U.doc) { placeSource(r.src, r.name); continue; }
        const d = NXI.docFromImage(r.src, r.name); U.openDoc(d);
      } catch (e) { toast(e.message); }
    }
  }
  function placeSource(src, name) {
    const d = U.doc, L = NXI.mkLayer(d, 'raster', { name }), k = Math.min(1, d.w / src.width, d.h / src.height), w = src.width * k, h = src.height * k;
    L.canvas.getContext('2d').drawImage(src, (d.w - w) / 2, (d.h - h) / 2, w, h); NXI.insert(d, L); U.push('Place ' + name);
  }
  const pickFiles = (accept, multi) => new Promise(res => { const i = el('input', { type: 'file', accept, multiple: multi ? '' : undefined }); i.onchange = () => res([...i.files]); i.click(); });
  async function exportDialog() {
    if (!U.doc) return toast('Open or create an image first.');
    const o = { fmt: 'png', q: 92 }, names = { png: 'PNG (lossless, transparency)', jpeg: 'JPEG', webp: 'WebP', psd: 'Photoshop PSD (layers, groups, masks)', tiff: 'TIFF (uncompressed RGBA)', tiffz: 'TIFF (Deflate compressed)', bmp: 'BMP (32-bit)', svg: 'SVG (vector layers + embedded pixels)', nxi: 'NEXORA layered document (.nxi)' };
    showModal('Export image', el('div', {}, row('Format', ctl.sel(o, 'fmt', Object.keys(names), { names: v => names[v] })), nrow('Quality', o, 'q', { min: 10, max: 100 }), el('div', { class: 'dim' }, `${U.doc.w} × ${U.doc.h}px. PSD: text and shapes are written as pixel layers and layer effects are baked in; adjustment layers are not written as layers (their result is in the composite).`)),
      [['Cancel', closeModal], ['Export', async () => { closeModal(); try { const b = await NXI.formats.exportBlob(U.doc, o.fmt, o.q); download(b, U.doc.name.replace(/[^\w\- ]+/g, '') + '.' + ({ jpeg: 'jpg', tiff: 'tif', tiffz: 'tif' }[o.fmt] || o.fmt)); toast('Exported ' + (o.fmt === 'tiffz' ? 'TIFF' : o.fmt.toUpperCase()) + ' (' + Math.round(b.size / 1024) + ' KB)' + (b.skipped && b.skipped.length ? ` · ${b.skipped.length} adjustment layer(s) merged into the composite only` : '')); } catch (e) { toast('Export failed: ' + e.message); } }, true]]);
  }
  function placeInEdit() {
    if (!U.doc) return; const m = Assets.publishDoc(U.doc); Shell.go('edit'); addMediaLayer(m, T); toast('Placed as a linked layer — edits in NEXORA Image update it automatically.');
  }

  /* ---------- clipboard ---------- */
  let clip = null;
  function copy(merged, cut) {
    const d = U.doc, L = NXI.active(d); if (!merged && (!L || L.type !== 'raster')) return toast('Select a pixel layer (or use Copy Merged).');
    const src = merged ? NXI.render(d) : L.canvas, ox = merged ? 0 : L.x, oy = merged ? 0 : L.y, b = NXI.selBounds(d) || { x: 0, y: 0, w: d.w, h: d.h };
    const c = NXI.newCanvas(b.w, b.h), x = c.getContext('2d'); x.drawImage(src, ox - b.x, oy - b.y); if (d.sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(d.sel, -b.x, -b.y); }
    clip = { c, x: b.x, y: b.y }; try { c.toBlob(bl => navigator.clipboard && window.ClipboardItem && navigator.clipboard.write([new ClipboardItem({ 'image/png': bl })]).catch(() => { })); } catch (e) { }
    if (cut && !merged) { const lc = L.canvas.getContext('2d'); if (d.sel) { lc.globalCompositeOperation = 'destination-out'; lc.drawImage(NXI.selLocal(d, L), 0, 0); lc.globalCompositeOperation = 'source-over'; } else lc.clearRect(0, 0, L.canvas.width, L.canvas.height); NXI.dirty(d, L); U.push('Cut'); }
  }
  function paste() { if (!clip || !U.doc) return; const d = U.doc, L = NXI.mkLayer(d, 'raster', { name: 'Pasted' }); L.canvas.getContext('2d').drawImage(clip.c, clip.x, clip.y); NXI.insert(d, L); U.push('Paste'); }
  window.addEventListener('paste', e => { if (Shell.active !== 'image' || !U.doc) return; const f = [...(e.clipboardData || {}).files || []].find(f => f.type.startsWith('image/')); if (f) { e.preventDefault(); openFiles([f], true); } });

  /* ---------- edit operations ---------- */
  function need(fn) { return () => { if (!U.doc) return toast('Open or create an image first.'); try { fn(U.doc); } catch (e) { toast(e.message); } }; }
  function fillDialog(d) {
    const o = { use: 'fg', opacity: 100 };
    showModal('Fill', el('div', {}, row('Contents', ctl.sel(o, 'use', ['fg', 'bg', 'white', 'black', 'content-aware'], { names: v => ({ fg: 'Foreground color', bg: 'Background color', white: 'White', black: 'Black', 'content-aware': 'Content-Aware (PatchMatch)' }[v]) })), nrow('Opacity', o, 'opacity', { min: 1, max: 100 })), [['Cancel', closeModal], ['Fill', async () => {
      closeModal(); if (o.use === 'content-aware') { toast('Filling…'); try { await NXI.filters.contentAwareFill(d); afterChange(); } catch (e) { toast(e.message); } return; }
      const L = NXI.active(d); if (!L || L.type !== 'raster') return toast('Select a pixel layer.'); const tgt = d.target === 'mask' && L.mask ? L.mask.canvas : L.canvas, full = NXI.clone(tgt), x = full.getContext('2d');
      x.globalAlpha = o.opacity / 100; x.fillStyle = { fg: d.fg, bg: d.bg, white: '#fff', black: '#000' }[o.use]; x.fillRect(0, 0, full.width, full.height); NXI.commitMasked(d, L, tgt, full); NXI.dirty(d, L); U.push('Fill');
    }, true]]);
  }
  function strokeSelDialog(d) {
    if (!d.sel) return toast('Make a selection first.'); const o = { w: 6, color: d.fg };
    showModal('Stroke selection', el('div', {}, nrow('Width', o, 'w', { min: 1, max: 100 }), row('Color', ctl.color(o, 'color'))), [['Cancel', closeModal], ['Stroke', () => {
      closeModal(); const L = NXI.active(d); if (!L || L.type !== 'raster') return toast('Select a pixel layer.');
      const s = NXI.newCanvas(d.w, d.h), x = s.getContext('2d'); x.fillStyle = o.color; for (let a = 0; a < 24; a++) x.drawImage(tinted(d.sel, o.color), Math.cos(a / 24 * 6.283) * o.w / 2, Math.sin(a / 24 * 6.283) * o.w / 2);
      x.globalCompositeOperation = 'destination-out'; for (let a = 0; a < 24; a++) x.drawImage(d.sel, Math.cos(a / 24 * 6.283) * -o.w / 2 * 0, 0); x.globalCompositeOperation = 'source-over';
      const inner = NXI.newCanvas(d.w, d.h), ix = inner.getContext('2d'); ix.drawImage(d.sel, 0, 0); ix.globalCompositeOperation = 'destination-in'; for (let a = 0; a < 24; a++) ix.drawImage(d.sel, Math.cos(a / 24 * 6.283) * o.w / 2, Math.sin(a / 24 * 6.283) * o.w / 2);
      const ring = NXI.newCanvas(d.w, d.h), rx = ring.getContext('2d'); for (let a = 0; a < 24; a++) rx.drawImage(tinted(d.sel, o.color), Math.cos(a / 24 * 6.283) * o.w / 2, Math.sin(a / 24 * 6.283) * o.w / 2); rx.globalCompositeOperation = 'destination-out'; rx.drawImage(inner, 0, 0);
      L.canvas.getContext('2d').drawImage(ring, -L.x, -L.y); NXI.dirty(d, L); U.push('Stroke');
    }, true]]);
  }
  function tinted(c, color) { const t = NXI.newCanvas(c.width, c.height), x = t.getContext('2d'); x.drawImage(c, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, t.width, t.height); return t; }
  function numDialog(title, label, def, min, max, fn) { const o = { v: def }; showModal(title, el('div', {}, nrow(label, o, 'v', { min, max })), [['Cancel', closeModal], ['OK', () => { closeModal(); fn(o.v); }, true]]); }
  function imageSizeDialog(d) { const o = { w: d.w, h: d.h, keep: true }, ar = d.w / d.h; let H; const W = ctl.num(o, 'w', { noRange: true, on: () => { if (o.keep) { o.h = Math.round(o.w / ar); H._sync(); } } }); H = ctl.num(o, 'h', { noRange: true, on: () => { if (o.keep) { o.w = Math.round(o.h * ar); W._sync(); } } });
    showModal('Image size (resample)', el('div', {}, row('Width', W), row('Height', H), row('Constrain', ctl.chk(o, 'keep'))), [['Cancel', closeModal], ['Resample', () => { closeModal(); NXI.resample(d, clamp(o.w | 0, 1, 12000), clamp(o.h | 0, 1, 12000)); U.push('Image Size'); U.fit(); }, true]]); }
  function canvasSizeDialog(d) { const o = { w: d.w, h: d.h, anchor: 'center' }, A = { 'top-left': [0, 0], top: [.5, 0], 'top-right': [1, 0], left: [0, .5], center: [.5, .5], right: [1, .5], 'bottom-left': [0, 1], bottom: [.5, 1], 'bottom-right': [1, 1] };
    showModal('Canvas size', el('div', {}, nrow('Width', o, 'w', { noRange: true }), nrow('Height', o, 'h', { noRange: true }), row('Anchor', ctl.sel(o, 'anchor', Object.keys(A)))), [['Cancel', closeModal], ['Apply', () => { closeModal(); const [ax, ay] = A[o.anchor]; NXI.canvasSize(d, clamp(o.w | 0, 1, 12000), clamp(o.h | 0, 1, 12000), ax, ay); U.push('Canvas Size'); U.fit(); }, true]]); }
  function filterDialog(name) {
    const d = U.doc; if (!d) return; const def = NXI.filters.defs[name], p = {}; def.p.forEach(([k, , , , v]) => p[k] = v);
    const L = NXI.active(d); if (!L || L.type !== 'raster') return toast('Filters need a pixel layer (Layer › Rasterize for text/shapes).');
    let busy = false; const prev = async () => { if (busy) return; busy = true; try { L._preview = await NXI.filters.apply(d, name, p, true); NXI.dirty(d); U.render(); } catch (e) { toast(e.message); } busy = false; };
    const body = el('div', {}, def.p.map(([k, lab, mn, mx, , st]) => mx === 1 && mn === 0 && st === 1 ? row(lab, ctl.chk(p, k, { on: () => { p[k] = p[k] ? 1 : 0; } })) : nrow(lab, p, k, { min: mn, max: mx, step: st })), el('div', { class: 'dim' }, 'Runs in a background worker. Only the selection is affected when one exists.'));
    const done = () => { L._preview = null; NXI.dirty(d); U.render(); };
    showModal(def.name, body, [['Preview', prev], ['Cancel', () => { closeModal(); done(); }], ['Apply', async () => { closeModal(); done(); toast('Applying ' + def.name + '…'); try { await NXI.filters.apply(d, name, p); afterChange(); toast(def.name + ' applied.'); } catch (e) { toast(e.message); } }, true]]);
  }
  function adjustDialogDestructive(type) {
    const d = U.doc; if (!d) return; const L = NXI.active(d); if (!L || L.type !== 'raster') return toast('Select a pixel layer.');
    const p = ADJ.defs[type].p(), fake = { adj: { type, p }, opacity: 100 };
    const upd = () => { const full = NXI.clone(L.canvas), c = full.getContext('2d', { willReadFrequently: true }), id = c.getImageData(0, 0, full.width, full.height); ADJ.apply(id.data, type, p, 1); c.putImageData(id, 0, 0); L._preview = full; NXI.dirty(d); U.render(); };
    showModal(ADJ.defs[type].name + ' (destructive)', el('div', {}, adjEditor(fake, upd, () => { })), [['Cancel', () => { closeModal(); L._preview = null; NXI.dirty(d); U.render(); }], ['Apply', () => { closeModal(); L._preview = null; try { NXI.filters.adjustLayer(d, type, p); afterChange(); } catch (e) { toast(e.message); } }, true]]);
    upd();
  }
  function addAdjustLayer(type) { const d = U.doc; if (!d) return; const L = NXI.mkLayer(d, 'adjust', { name: ADJ.defs[type].name, adj: { type, p: ADJ.defs[type].p() } }); if (d.sel) { NXI.addMask(d, L, true); d.target = 'layer'; } NXI.insert(d, L); U.push('New ' + ADJ.defs[type].name + ' layer'); }

  /* ---------- menus ---------- */
  const adjSub = run => Object.keys(ADJ.defs).map(k => ({ label: ADJ.defs[k].name, run: () => run(k) }));
  const filterSub = () => { const cats = {}; for (const k in NXI.filters.defs) (cats[NXI.filters.defs[k].cat] = cats[NXI.filters.defs[k].cat] || []).push(k); return Object.keys(cats).map(c => ({ label: c, sub: cats[c].map(k => ({ label: NXI.filters.defs[k].name + '…', run: () => filterDialog(k) })) })); };
  const MENUS = {
    File: () => [{ label: 'New…', kbd: 'Ctrl+N', run: newDocDialog }, { label: 'New from template…', run: () => { Shell.go('home'); Shell.showTemplates(); } }, { label: 'Open…', kbd: 'Ctrl+O', run: async () => openFiles(await pickFiles('image/*,.nxi,.tif,.tiff,.psd', true)) }, { label: 'Place as layer…', run: need(async () => openFiles(await pickFiles('image/*,.tif,.tiff', true), true)) }, '-',
      { label: 'Save layered document (.nxi)', kbd: 'Ctrl+S', run: need(async d => download(await NXI.formats.exportBlob(d, 'nxi'), d.name + '.nxi')) }, { label: 'Export as…', kbd: 'Ctrl+Shift+S', run: exportDialog }, { label: 'Save whole NEXORA project (.nexora)', run: () => Shell.saveProject() }, '-',
      { label: 'Place in NEXORA Edit timeline (linked)', run: need(placeInEdit) }, { label: 'PSD import / export…', run: () => showModal('PSD interoperability', el('div', { class: 'lead', style: 'max-width:440px' }, 'PSD support is not implemented yet. NEXORA will not claim PSD compatibility until a reader/writer has been tested against real layered PSD files. For now, use TIFF or PNG to exchange with Photoshop, or keep layers in .nxi.'), [['OK', closeModal, true]]) }, '-',
      { label: 'Close document', run: need(d => U.closeDoc(d)) }],
    Edit: () => [{ label: 'Undo', kbd: 'Ctrl+Z', run: need(d => { NXI.undo(d); afterChange(); }) }, { label: 'Redo', kbd: 'Ctrl+Shift+Z', run: need(d => { NXI.redo(d); afterChange(); }) }, '-',
      { label: 'Cut', kbd: 'Ctrl+X', run: need(() => copy(false, true)) }, { label: 'Copy', kbd: 'Ctrl+C', run: need(() => copy(false)) }, { label: 'Copy merged', kbd: 'Ctrl+Shift+C', run: need(() => copy(true)) }, { label: 'Paste', kbd: 'Ctrl+V', run: need(paste) }, '-',
      { label: 'Fill…', kbd: 'Shift+F5', run: need(fillDialog) }, { label: 'Content-Aware Fill (selection)', run: need(async d => { toast('Filling…'); try { await NXI.filters.contentAwareFill(d); afterChange(); } catch (e) { toast(e.message); } }) }, { label: 'Stroke selection…', run: need(strokeSelDialog) }, { label: 'Clear selected pixels', kbd: 'Del', run: need(clearPixels) }, '-',
      { label: 'Free Transform', kbd: 'Ctrl+T', run: need(() => TL().transformBegin('free')) }, { label: 'Transform', sub: [{ label: 'Perspective', run: need(() => { setTool('move'); TL().transformBegin('perspective'); }) }, { label: 'Warp', run: need(() => { setTool('move'); TL().transformBegin('warp'); }) }] }],
    Image: () => [{ label: 'Adjustments (destructive)', sub: adjSub(adjustDialogDestructive) }, '-', { label: 'Image size…', run: need(imageSizeDialog) }, { label: 'Canvas size…', run: need(canvasSizeDialog) },
      { label: 'Rotate / flip', sub: [['Rotate 90° CW', 90], ['Rotate 90° CCW', -90], ['Rotate 180°', 180], ['Flip horizontal', 'h'], ['Flip vertical', 'v']].map(([l, a]) => ({ label: l, run: need(d => { NXI.rotateCanvas(d, a); U.push(l); U.fit(); }) })) },
      { label: 'Crop to selection', run: need(d => { const b = NXI.selBounds(d); if (!b) return toast('Make a selection first.'); NXI.crop(d, b); U.push('Crop'); U.fit(); }) }, { label: 'Trim transparent pixels', run: need(d => { const b = NXI.contentBounds(NXI.render(d)); if (b) { NXI.crop(d, b); U.push('Trim'); U.fit(); } }) }, '-',
      { label: 'Merge visible', kbd: 'Ctrl+Shift+E', run: need(d => { NXI.mergeVisible(d); U.push('Merge Visible'); }) }, { label: 'Flatten image', run: need(d => { NXI.flattenImage(d); U.push('Flatten'); }) }],
    Layer: () => [{ label: 'New pixel layer', kbd: 'Ctrl+Shift+N', run: need(d => { NXI.insert(d, NXI.mkLayer(d, 'raster', { name: 'Layer ' + (NXI.countLayers(d) + 1) })); U.push('New layer'); }) }, { label: 'New group', run: need(d => { NXI.insert(d, NXI.mkLayer(d, 'group')); U.push('New group'); }) }, { label: 'New adjustment layer', sub: adjSub(addAdjustLayer) }, '-',
      { label: 'Duplicate', kbd: 'Ctrl+J', run: need(d => { NXI.duplicate(d, d.activeId); U.push('Duplicate layer'); }) }, { label: 'Delete', run: need(d => { NXI.remove(d, d.activeId); U.push('Delete layer'); }) }, { label: 'Group layers', kbd: 'Ctrl+G', run: need(d => { NXI.groupLayers(d, d.multi.length ? d.multi : [d.activeId]); U.push('Group'); }) }, { label: 'Ungroup', kbd: 'Ctrl+Shift+G', run: need(d => { NXI.ungroup(d, d.activeId); U.push('Ungroup'); }) }, '-',
      { label: 'Merge down', kbd: 'Ctrl+E', run: need(d => { if (!NXI.mergeDown(d, d.activeId)) return toast('Nothing to merge into.'); U.push('Merge Down'); }) }, { label: 'Rasterize', run: need(d => { const L = NXI.active(d); if (L) { NXI.rasterize(d, L); U.push('Rasterize'); } }) }, '-',
      { label: 'Mask', sub: [{ label: 'Reveal all', run: need(d => { const L = NXI.active(d); if (L) { NXI.addMask(d, L, false); U.push('Add mask'); } }) }, { label: 'Reveal selection', run: need(d => { const L = NXI.active(d); if (!d.sel) return toast('Make a selection first.'); if (L) { NXI.addMask(d, L, true); U.push('Add mask'); } }) }, { label: 'Apply mask', run: need(d => { const L = NXI.active(d); if (L && L.mask) { NXI.applyMask(d, L); U.push('Apply mask'); } }) }, { label: 'Delete mask', run: need(d => { const L = NXI.active(d); if (L && L.mask) { L.mask = null; d.target = 'layer'; NXI.dirty(d, L); U.push('Delete mask'); } }) }, { label: 'Disable / enable mask', run: need(d => { const L = NXI.active(d); if (L && L.mask) { L.mask.on = !L.mask.on; NXI.dirty(d, L); U.push('Toggle mask'); } }) }] },
      { label: 'Create / release clipping mask', kbd: 'Ctrl+Alt+G', run: need(d => { const L = NXI.active(d); if (L) { L.clip = !L.clip; NXI.dirty(d, L); U.push(L.clip ? 'Clipping mask' : 'Release clipping'); } }) }, '-',
      { label: 'Bring forward', kbd: 'Ctrl+]', run: need(d => { NXI.moveBy(d, d.activeId, 1); U.push('Arrange'); }) }, { label: 'Send backward', kbd: 'Ctrl+[', run: need(d => { NXI.moveBy(d, d.activeId, -1); U.push('Arrange'); }) }],
    Select: () => [{ label: 'All', kbd: 'Ctrl+A', run: need(d => { NXI.selAll(d); U.push('Select All'); }) }, { label: 'Deselect', kbd: 'Ctrl+D', run: need(d => { NXI.selNone(d); U.push('Deselect'); }) }, { label: 'Inverse', kbd: 'Ctrl+Shift+I', run: need(d => { NXI.selInvert(d); U.push('Inverse'); }) }, '-',
      { label: 'Feather…', kbd: 'Shift+F6', run: need(d => numDialog('Feather selection', 'Radius px', 8, 1, 250, v => { NXI.selFeather(d, v); U.push('Feather'); })) }, { label: 'Grow…', run: need(d => numDialog('Grow selection', 'Pixels', 4, 1, 200, v => { NXI.selGrow(d, v); U.push('Grow'); })) }, { label: 'Shrink…', run: need(d => numDialog('Shrink selection', 'Pixels', 4, 1, 200, v => { NXI.selGrow(d, -v); U.push('Shrink'); })) }, '-',
      { label: 'Load layer transparency', run: need(d => { const L = NXI.active(d); if (L) { NXI.selFromLayerAlpha(d, L); U.push('Load selection'); } }) }, { label: 'Selection → layer mask', run: need(d => { const L = NXI.active(d); if (L && d.sel) { NXI.addMask(d, L, true); U.push('Add mask'); } }) }, { label: 'Pen path → selection', run: () => TL().pathOps('select') }],
    Filter: () => [...filterSub(), '-', { label: 'Liquify tool', run: () => setTool('liquify') }, { label: 'Content-Aware Fill', run: need(async d => { toast('Filling…'); try { await NXI.filters.contentAwareFill(d); afterChange(); } catch (e) { toast(e.message); } }) }],
    View: () => [{ label: 'Zoom in', kbd: 'Ctrl++', run: () => U.doc && U.zoomAt({ x: U.doc.w / 2, y: U.doc.h / 2 }, 1.25) }, { label: 'Zoom out', kbd: 'Ctrl+-', run: () => U.doc && U.zoomAt({ x: U.doc.w / 2, y: U.doc.h / 2 }, .8) }, { label: 'Fit on screen', kbd: 'Ctrl+0', run: U.fit }, { label: 'Actual pixels (100%)', kbd: 'Ctrl+1', run: () => setZoom(1) }, '-',
      { label: 'Workspace layout', sub: Object.keys(LAYOUTS).map(k => ({ label: k, run: () => applyLayout(k) })) }, { label: 'Reset panels', run: () => applyLayout('Essentials') }]
  };
  function clearPixels(d) { const L = NXI.active(d); if (!L || L.type !== 'raster') return; const t = d.target === 'mask' && L.mask ? L.mask.canvas : L.canvas, c = t.getContext('2d'); if (d.sel) { c.globalCompositeOperation = 'destination-out'; c.drawImage(NXI.selLocal(d, L), 0, 0); c.globalCompositeOperation = 'source-over'; } else c.clearRect(0, 0, t.width, t.height); NXI.dirty(d, L); U.push('Clear'); }
  function setZoom(z) { if (!U.doc) return; const r = stage.getBoundingClientRect(), c = U.toDoc(r.width / 2, r.height / 2); U.view.zoom = z; U.view.px = r.width / 2 - c.x * z; U.view.py = r.height / 2 - c.y * z; U.render(); status(); }

  /* ---------- mount ---------- */
  U.mount = () => {
    if (U.mounted) return; U.mounted = true; root = document.getElementById('ws-image');
    const menubar = el('nav', { class: 'imenus', style: 'display:flex;gap:2px' }, Object.keys(MENUS).map(k => { const b = el('button', { 'data-pop': '1', style: 'background:none;border-color:transparent' }, k); b.onclick = () => PopMenu.at(b, MENUS[k]()); return b; }));
    tabsEl = el('div', { class: 'doctabs' });
    root.append(el('div', { class: 'wsrow' }, menubar, tabsEl, el('div', { class: 'spacer' }), el('span', { id: 'imgLink', class: 'dim' }), el('button', { onclick: need(placeInEdit), title: 'Add this image to the Edit timeline as a linked layer' }, 'Place in Edit')));
    optBar = el('div', { id: 'imgOpt' }); root.append(optBar);
    toolBox = el('div', { id: 'imgTools' }); stage = el('div', { id: 'imgStage' });
    view = el('canvas', { id: 'imgView' }); over = el('canvas', { id: 'imgCanvas' }); stage.append(view, over); vctx2 = view.getContext('2d'); octx = over.getContext('2d');
    stage.append(el('div', { id: 'imgEmpty', class: 'page', style: 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:transparent' }, el('h1', {}, 'NEXORA Image'), el('p', { class: 'lead', style: 'text-align:center' }, 'Create a new image, open a file, pick a template, or drop images here.'), el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, el('button', { class: 'primary', onclick: newDocDialog }, 'New image'), el('button', { onclick: async () => openFiles(await pickFiles('image/*,.nxi,.tif,.tiff,.psd', true)) }, 'Open…'), el('button', { onclick: () => { Shell.go('home'); Shell.showTemplates(); } }, 'Templates'))));
    const split = el('div', { id: 'imgSplit' }); right = el('div', { id: 'imgRight' });
    root.append(el('div', { class: 'imgmain' }, toolBox, stage, split, right));
    statusEl = el('div', { id: 'imgStatus' }); root.append(statusEl);
    split.onpointerdown = e => { split.setPointerCapture(e.pointerId); const x0 = e.clientX, w0 = right.offsetWidth; split.onpointermove = ev => { right.style.width = clamp(w0 - (ev.clientX - x0), 240, 620) + 'px'; }; split.onpointerup = () => { split.onpointermove = null; savePanels(); }; };
    buildToolbox(); buildPanels(); bindStage(); setTool(U.tool, true);
    new ResizeObserver(() => { const r = stage.getBoundingClientRect(), d = devicePixelRatio || 1; for (const c of [view, over]) { c.width = Math.max(1, r.width * d); c.height = Math.max(1, r.height * d); } vctx2.setTransform(d, 0, 0, d, 0, 0); octx.setTransform(d, 0, 0, d, 0, 0); U.render(); }).observe(stage);
    NXI.listeners.push((doc, kind) => { if (doc === U.doc && kind !== 'hist') U.render(); });
    requestAnimationFrame(frame);
  };
  U.enter = () => { U.mount(); U.render(); refreshAll(); };

  /* ---------- tools palette ---------- */
  function buildToolbox() {
    toolBox.innerHTML = '';
    const groups = [['move', 'marquee', 'ellipse', 'lasso', 'poly', 'wand', 'quick', 'crop'], ['eyedrop', 'spot', 'heal', 'brush', 'pencil', 'clone', 'eraser', 'gradient', 'bucket'], ['blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'liquify'], ['pen', 'text', 'shape', 'hand', 'zoom']];
    groups.forEach((g, gi) => { if (gi) toolBox.append(el('hr')); g.forEach(id => { const t = TL().T[id]; toolBox.append(el('button', { 'data-tool': id, title: `${t.name} (${t.key})`, onclick: () => setTool(id) }, Icon.has(id) ? Icon(id, 16) : t.icon)); }); if (g.length % 2) toolBox.append(el('span')); });
    const fgbg = el('div', { class: 'fgbg' }); toolBox.append(fgbg); refreshColor();
  }
  function setTool(id, keep) {
    const prev = TL().T[U.tool]; if (!keep && prev && prev.deactivate && U.tool !== id) prev.deactivate();
    if (TL().transforming && id !== 'move') TL().transformCommit();
    U.tool = id; const t = TL().T[id]; if (t.activate && U.doc) t.activate();
    if (toolBox) toolBox.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
    if (over) over.style.cursor = { hand: 'grab', move: 'default', text: 'text', zoom: 'zoom-in' }[id] || 'crosshair';
    buildOptions(); U.render();
  }
  function refreshColor() {
    const box = toolBox && toolBox.querySelector('.fgbg'); if (!box) return; const d = U.doc || { fg: '#ffffff', bg: '#000000' }; box.innerHTML = '';
    const fg = el('div', { title: 'Foreground (click to edit)', style: `left:4px;top:2px;background:${d.fg};z-index:2` }), bg = el('div', { title: 'Background (click to edit)', style: `left:20px;top:16px;background:${d.bg}` });
    fg.onclick = () => { colorTarget = 'fg'; refreshColorPanel(); }; bg.onclick = () => { colorTarget = 'bg'; refreshColorPanel(); };
    box.append(fg, bg, el('span', { title: 'Swap (X)', style: 'position:absolute;right:2px;top:0;cursor:pointer;color:var(--dim)', onclick: () => { if (U.doc) { [U.doc.fg, U.doc.bg] = [U.doc.bg, U.doc.fg]; refreshColor(); } } }, '⇄'));
    refreshColorPanel();
  }

  /* ---------- contextual options bar ---------- */
  function buildOptions() {
    if (!optBar) return; optBar.innerHTML = ''; const o = O(), id = U.tool, t = TL().T[id], lab = (n, x) => el('label', {}, n, x), save = () => TL().saveOpts();
    optBar.append(el('b', {}, t.name));
    const selModes = () => { const s = el('div', { style: 'display:flex;gap:2px' }); [['replace', '▭', 'New selection'], ['add', '⊕', 'Add (Shift)'], ['sub', '⊖', 'Subtract (Alt)'], ['intersect', '⊗', 'Intersect (Shift+Alt)']].forEach(([m, ic, tt]) => s.append(el('button', { class: o.selMode === m ? 'on' : '', title: tt, onclick: () => { o.selMode = m; buildOptions(); } }, ic))); return s; };
    const brushSize = (obj, max) => lab('Size', ctl.num(obj, 'size', { min: 1, max: max || 1000, commit: save }));
    switch (id) {
      case 'move': optBar.append(lab('Auto-select', ctl.chk(o, 'autoSelect', { commit: save })), el('button', { onclick: need(() => TL().transformBegin('free')) }, 'Free Transform (Ctrl+T)'), el('button', { onclick: need(() => TL().transformBegin('perspective')) }, 'Perspective'), el('button', { onclick: need(() => TL().transformBegin('warp')) }, 'Warp'));
        if (TL().transforming) optBar.append(el('button', { class: 'primary', onclick: () => TL().transformCommit() }, 'Apply (Enter)'), el('button', { onclick: () => TL().transformCancel() }, '✕ Cancel (Esc)'));
        optBar.append(el('span', { class: 'dim' }, 'Align to canvas:'), ...[['⇤', 'l'], ['↔', 'c'], ['⇥', 'r'], ['⤒', 't'], ['↕', 'm'], ['⤓', 'b']].map(([ic, a]) => el('button', { title: 'Align ' + a, onclick: need(d => alignLayer(d, a)) }, ic))); break;
      case 'marquee': case 'ellipse': case 'lasso': case 'poly': optBar.append(selModes(), lab('Feather', ctl.num(o, 'feather', { min: 0, max: 200, commit: save }))); if (id === 'poly') optBar.append(el('span', { class: 'dim' }, 'Click points · click first point / double-click / Enter to close · Esc cancels')); break;
      case 'wand': optBar.append(selModes(), lab('Tolerance', ctl.num(o, 'wandTol', { min: 0, max: 255, commit: save })), lab('Contiguous', ctl.chk(o, 'contiguous', { commit: save })), lab('Sample all layers', ctl.chk(o, 'sampleAll', { commit: save }))); break;
      case 'quick': optBar.append(lab('Size', ctl.num(o, 'quickSize', { min: 4, max: 400, commit: save })), lab('Tolerance', ctl.num(o, 'wandTol', { min: 0, max: 255, commit: save })), el('span', { class: 'dim' }, 'Paint to add · Alt to subtract')); break;
      case 'crop': optBar.append(lab('Ratio', ctl.sel(o, 'cropRatio', ['free', '1:1', '16:9', '4:3', '9:16', '4:5'], { commit: save })), el('button', { class: 'primary', onclick: () => TL().T.crop.enter() }, 'Crop (Enter)'), el('button', { onclick: () => TL().T.crop.cancel() }, 'Reset')); break;
      case 'eyedrop': optBar.append(lab('Sample', ctl.sel(o, 'eyeSize', [1, 3, 5, 11], { names: v => v === 1 ? 'Point' : v + '×' + v + ' average', commit: save })), el('span', { class: 'dim' }, 'Alt-click sets background color')); break;
      case 'brush': { const b = o.brush; optBar.append(lab('Preset', presetSelect()), brushSize(b), lab('Hardness', ctl.num(b, 'hardness', { min: 0, max: 100, commit: save })), lab('Opacity', ctl.num(b, 'opacity', { min: 1, max: 100, commit: save })), lab('Flow', ctl.num(b, 'flow', { min: 1, max: 100, commit: save })), lab('Smoothing', ctl.num(b, 'smoothing', { min: 0, max: 90, commit: save }))); break; }
      case 'pencil': optBar.append(brushSize(o.pencil, 200), lab('Opacity', ctl.num(o.pencil, 'opacity', { min: 1, max: 100, commit: save }))); break;
      case 'eraser': optBar.append(brushSize(o.eraser), lab('Hardness', ctl.num(o.eraser, 'hardness', { min: 0, max: 100, commit: save })), lab('Opacity', ctl.num(o.eraser, 'opacity', { min: 1, max: 100, commit: save })), lab('Flow', ctl.num(o.eraser, 'flow', { min: 1, max: 100, commit: save }))); break;
      case 'clone': optBar.append(brushSize(o.clone), lab('Hardness', ctl.num(o.clone, 'hardness', { min: 0, max: 100, commit: save })), lab('Opacity', ctl.num(o.clone, 'opacity', { min: 1, max: 100, commit: save })), lab('Aligned', ctl.chk(o.clone, 'aligned', { commit: save })), el('span', { class: 'dim' }, 'Alt+click to set source')); break;
      case 'heal': optBar.append(brushSize(o.heal), el('span', { class: 'dim' }, 'Alt+click source · texture from source, color/light from destination')); break;
      case 'spot': optBar.append(brushSize(o.spot), el('span', { class: 'dim' }, 'Paint over blemishes — source is found automatically')); break;
      case 'blur': case 'sharpen': case 'smudge': optBar.append(brushSize(o.retouch), lab('Strength', ctl.num(o.retouch, 'strength', { min: 1, max: 100, commit: save }))); break;
      case 'dodge': case 'burn': optBar.append(brushSize(o.dodge), lab('Range', ctl.sel(o.dodge, 'range', ['shadows', 'mid', 'highlights'], { commit: save })), lab('Exposure', ctl.num(o.dodge, 'exposure', { min: 1, max: 100, commit: save }))); break;
      case 'sponge': optBar.append(brushSize(o.sponge), lab('Mode', ctl.sel(o.sponge, 'mode', ['desat', 'sat'], { names: v => v === 'sat' ? 'Saturate' : 'Desaturate', commit: save })), lab('Flow', ctl.num(o.sponge, 'flow', { min: 1, max: 100, commit: save }))); break;
      case 'liquify': optBar.append(brushSize(o.liquify, 800), lab('Mode', ctl.sel(o.liquify, 'mode', ['push', 'bloat', 'pucker', 'twirl', 'twirl-ccw'], { commit: save })), lab('Strength', ctl.num(o.liquify, 'strength', { min: 1, max: 100, commit: save }))); break;
      case 'gradient': optBar.append(lab('Type', ctl.sel(o.gradient, 'type', ['linear', 'radial', 'angle', 'reflected'], { commit: save })), lab('Colors', ctl.sel(o.gradient, 'preset', ['fg-bg', 'fg-transparent'], { names: v => v === 'fg-bg' ? 'Foreground → Background' : 'Foreground → Transparent', commit: save })), lab('Reverse', ctl.chk(o.gradient, 'reverse', { commit: save })), lab('Opacity', ctl.num(o.gradient, 'opacity', { min: 1, max: 100, commit: save }))); break;
      case 'bucket': optBar.append(lab('Tolerance', ctl.num(o.bucket, 'tol', { min: 0, max: 255, commit: save })), lab('Contiguous', ctl.chk(o.bucket, 'contiguous', { commit: save })), lab('Sample all layers', ctl.chk(o.bucket, 'sampleAll', { commit: save })), lab('Opacity', ctl.num(o.bucket, 'opacity', { min: 1, max: 100, commit: save }))); break;
      case 'pen': optBar.append(...[['select', 'Make selection'], ['fill', 'Fill path'], ['stroke', 'Stroke path'], ['shape', 'Shape layer'], ['clear', 'Clear path']].map(([k, n]) => el('button', { onclick: () => TL().pathOps(k) }, n)), el('span', { class: 'dim' }, 'Click = corner · drag = curve · click first point to close · drag anchors to edit')); break;
      case 'text': optBar.append(lab('Font', ctl.text(o.text, 'font', { list: 'nxFonts', commit: save })), lab('Size', ctl.num(o.text, 'size', { min: 4, max: 2000, commit: save })), lab('Weight', ctl.sel(o.text, 'weight', ['300', '400', '600', '700', '800', '900'], { commit: save })), el('span', { class: 'dim' }, 'Click to add · click existing text to edit')); break;
      case 'shape': optBar.append(lab('Shape', ctl.sel(o.shape, 'kind', ['rect', 'ellipse', 'polygon', 'star', 'line'], { commit: save })), lab('Corner radius', ctl.num(o.shape, 'radius', { min: 0, max: 500, commit: save })), lab('Points', ctl.num(o.shape, 'points', { min: 3, max: 24, commit: save })), lab('Stroke', ctl.num(o.shape, 'strokeW', { min: 0, max: 100, commit: save })), el('span', { class: 'dim' }, 'Fill = foreground, stroke = background · Shift = square')); break;
      case 'hand': case 'zoom': optBar.append(el('button', { onclick: U.fit }, 'Fit'), el('button', { onclick: () => setZoom(1) }, '100%'), el('button', { onclick: () => setZoom(2) }, '200%')); break;
    }
  }
  function presetSelect() {
    const all = Object.assign({}, TL().BRUSH_PRESETS, TL().userBrushes), s = el('select', {}, Object.keys(all).map(k => el('option', { value: k }, k))); s.value = O().brush.preset;
    s.onchange = () => { const b = O().brush; Object.assign(b, { scatter: 0, sizeJitter: 0, angle: 0, roundness: 100, tip: null, flow: 100 }, all[s.value]); b.preset = s.value; TL().saveOpts(); buildOptions(); refreshBrushPanel(); }; return s;
  }
  function alignLayer(d, a) {
    const L = NXI.active(d); if (!L) return; const img = NXI.layerImage(L, d), t = NXI.newCanvas(d.w, d.h); t.getContext('2d').drawImage(img.c, img.x, img.y); if (img.temp) NXI.give(img.c); const b = NXI.contentBounds(t); if (!b) return;
    const area = NXI.selBounds(d) || { x: 0, y: 0, w: d.w, h: d.h }; let dx = 0, dy = 0;
    if (a === 'l') dx = area.x - b.x; if (a === 'r') dx = area.x + area.w - (b.x + b.w); if (a === 'c') dx = area.x + area.w / 2 - (b.x + b.w / 2); if (a === 't') dy = area.y - b.y; if (a === 'b') dy = area.y + area.h - (b.y + b.h); if (a === 'm') dy = area.y + area.h / 2 - (b.y + b.h / 2);
    NXI.walk([L], q => { if (q.tr) { q.tr.x += dx; q.tr.y += dy; } else if (q.type === 'raster') { q.x += Math.round(dx); q.y += Math.round(dy); } q.v++; }); NXI.dirty(d); U.push('Align');
  }

  /* ---------- stage: rendering + input ---------- */
  let checker = null, lastAnts = 0, ants = null, antsV = -1, antsDoc = null;
  function computeAnts(d) {
    if (!d.sel) return null; const W = d.w, H = d.h, s = Math.max(1, Math.ceil(Math.max(W, H) / 1600)), a = d.sel.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, pts = [];
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && a[(y * W + x) * 4 + 3] >= 128;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { const v = on(x, y); if (v !== on(x + s, y) || v !== on(x, y + s) || (v && (x === 0 || y === 0 || x + s >= W || y + s >= H))) pts.push(x, y); }
    return { pts: new Float32Array(pts), s };
  }
  function frame(t) {
    requestAnimationFrame(frame);
    if (!U.mounted || Shell.active !== 'image') return;
    const d = U.doc; document.getElementById('imgEmpty').style.display = d ? 'none' : 'flex';
    const antsDue = d && d.sel && t - lastAnts > 140;
    if (!U.needs && !antsDue) return; U.needs = false; if (antsDue) lastAnts = t;
    const r = stage.getBoundingClientRect(); vctx2.clearRect(0, 0, r.width, r.height); octx.clearRect(0, 0, r.width, r.height); if (!d) return;
    const comp = NXI.render(d), z = U.view.zoom, x = U.view.px, y = U.view.py;
    if (!checker) { const c = NXI.newCanvas(16, 16), g = c.getContext('2d'); g.fillStyle = '#2a2a33'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#1e1e25'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8); checker = vctx2.createPattern(c, 'repeat'); }
    vctx2.save(); vctx2.shadowColor = '#000'; vctx2.shadowBlur = 24; vctx2.fillStyle = checker; vctx2.fillRect(x, y, d.w * z, d.h * z); vctx2.restore();
    vctx2.imageSmoothingEnabled = z < 2; vctx2.imageSmoothingQuality = 'high'; vctx2.drawImage(comp, x, y, d.w * z, d.h * z);
    // marching ants
    if (d.sel) { if (antsV !== d.selV || antsDoc !== d) { ants = computeAnts(d); antsV = d.selV; antsDoc = d; } if (ants) { const ph = Math.floor(t / 140) % 8, p = ants.pts, s = ants.s * z, sz = Math.max(1, Math.min(2, s)); for (let i = 0; i < p.length; i += 2) { octx.fillStyle = ((p[i] + p[i + 1]) / ants.s + ph) % 8 < 4 ? '#000' : '#fff'; octx.fillRect(x + p[i] * z, y + p[i + 1] * z, sz, sz); } } }
    const tool = TL().T[U.tool]; if (tool.overlay) { octx.save(); tool.overlay(octx, U); octx.restore(); }
    if (U.tool !== 'pen' && d.path && d.path.pts.length && TL().T.pen.overlay) { octx.save(); octx.globalAlpha = .55; TL().T.pen.overlay(octx); octx.restore(); }
    if (U.hover && tool.brushCursor !== undefined || ['brush', 'pencil', 'eraser'].includes(U.tool)) drawBrushCursor();
    if (navDirty) refreshNavigator();
  }
  function drawBrushCursor() {
    if (!U.hover) return; const o = O(), size = { brush: o.brush.size, pencil: o.pencil.size, eraser: o.eraser.size, clone: o.clone.size, heal: o.heal.size, spot: o.spot.size, blur: o.retouch.size, sharpen: o.retouch.size, smudge: o.retouch.size, dodge: o.dodge.size, burn: o.dodge.size, sponge: o.sponge.size, liquify: o.liquify.size, quick: o.quickSize }[U.tool];
    if (!size) return; const s = U.toScreen(U.hover), r = Math.max(1.5, size * U.view.zoom / 2); octx.lineWidth = 1; octx.strokeStyle = '#000'; octx.beginPath(); octx.arc(s.x, s.y, r + 1, 0, 6.283); octx.stroke(); octx.strokeStyle = '#fff'; octx.beginPath(); octx.arc(s.x, s.y, r, 0, 6.283); octx.stroke();
  }
  function bindStage() {
    let dragging = false, pan = null;
    const pos = e => { const r = over.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
    over.addEventListener('pointerdown', e => {
      if (!U.doc) return; over.setPointerCapture(e.pointerId); const { sx, sy } = pos(e), p = U.toDoc(sx, sy);
      if (e.button === 1 || U.space || U.tool === 'hand') { pan = { sx, sy, px: U.view.px, py: U.view.py }; over.style.cursor = 'grabbing'; return; }
      if (e.button !== 0) return; dragging = true;
      try { TL().T[U.tool].down(p, e); } catch (err) { console.error(err); toast(err.message); }
    });
    over.addEventListener('pointermove', e => {
      const { sx, sy } = pos(e); if (!U.doc) return; const p = U.toDoc(sx, sy); U.hover = p; status(p);
      if (pan) { U.view.px = pan.px + sx - pan.sx; U.view.py = pan.py + sy - pan.sy; U.render(); navDirty = true; return; }
      const t = TL().T[U.tool];
      if (dragging) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ev of evs.length ? evs : [e]) { const q = pos(ev); try { t.move(U.toDoc(q.sx, q.sy), ev); } catch (err) { console.error(err); } } }
      else if (t.hover) t.hover(p, e); else if (['brush', 'pencil', 'eraser', 'clone', 'heal', 'spot', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'liquify', 'quick'].includes(U.tool)) U.render();
    });
    const up = e => { if (pan) { pan = null; over.style.cursor = U.tool === 'hand' ? 'grab' : 'crosshair'; return; } if (!dragging) return; dragging = false; const { sx, sy } = pos(e); try { TL().T[U.tool].up(U.toDoc(sx, sy), e); } catch (err) { console.error(err); toast(err.message); } };
    over.addEventListener('pointerup', up); over.addEventListener('pointercancel', up);
    over.addEventListener('pointerleave', () => { U.hover = null; U.render(); });
    over.addEventListener('dblclick', e => { const { sx, sy } = pos(e), t = TL().T[U.tool]; if (t.dbl) t.dbl(U.toDoc(sx, sy), e); });
    over.addEventListener('wheel', e => { if (!U.doc) return; e.preventDefault(); const { sx, sy } = pos(e); if (e.ctrlKey || e.altKey || (!e.shiftKey && Math.abs(e.deltaY) > 0 && !e.deltaX)) U.zoomAt(U.toDoc(sx, sy), Math.exp(-e.deltaY * .0016)); else { U.view.px -= e.deltaX || e.deltaY; U.render(); } navDirty = true; }, { passive: false });
    over.addEventListener('contextmenu', e => { e.preventDefault(); if (!U.doc) return; PopMenu.open(e.clientX, e.clientY, [...MENUS.Select().slice(0, 3), '-', ...MENUS.Edit().slice(3, 7), '-', { label: 'Free Transform', run: () => TL().transformBegin('free') }]); });
    stage.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    stage.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); openFiles([...e.dataTransfer.files], !!U.doc); });
  }
  function status(p) {
    if (!statusEl) return; const d = U.doc; if (!d) { statusEl.textContent = ''; return; }
    const mem = NXI.histBytes(d), heap = performance.memory ? ' · JS heap ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : '';
    statusEl.innerHTML = ''; statusEl.append(el('span', {}, Math.round(U.view.zoom * 100) + '%'), el('span', {}, `${d.w} × ${d.h}px`), el('span', {}, p ? `x ${Math.floor(p.x)}  y ${Math.floor(p.y)}` : ''), el('span', {}, 'History ' + Math.round(mem / 1048576) + ' MB' + heap), el('span', {}, d.sel && NXI.selBounds(d) ? `Selection ${NXI.selBounds(d).w}×${NXI.selBounds(d).h}` : ''), el('div', { class: 'spacer' }), el('span', { id: 'imgAuto' }, Shell.lastStatus || ''));
  }

  /* ---------- panels ---------- */
  let colorTarget = 'fg', navDirty = true;
  const LAYOUTS = {
    'Essentials': { order: ['nav', 'color', 'props', 'fx', 'layers', 'history', 'brush', 'swatches'], closed: ['brush', 'swatches', 'fx', 'history'] },
    'Painting': { order: ['color', 'swatches', 'brush', 'layers', 'nav', 'props', 'fx', 'history'], closed: ['nav', 'props', 'fx', 'history'] },
    'Photo retouch': { order: ['nav', 'props', 'layers', 'history', 'color', 'fx', 'brush', 'swatches'], closed: ['color', 'fx', 'brush', 'swatches'] },
    'Design': { order: ['props', 'fx', 'layers', 'color', 'swatches', 'nav', 'history', 'brush'], closed: ['nav', 'history', 'brush', 'swatches'] }
  };
  const PANELS = { nav: 'Navigator', color: 'Color', swatches: 'Swatches', brush: 'Brush settings', props: 'Properties', fx: 'Layer effects', layers: 'Layers', history: 'History' };
  let layout = JSON.parse(localStorage.getItem('nexora.img.layout') || 'null') || JSON.parse(JSON.stringify(LAYOUTS.Essentials));
  const savePanels = () => { layout.width = right.offsetWidth; localStorage.setItem('nexora.img.layout', JSON.stringify(layout)); };
  function applyLayout(name) { layout = JSON.parse(JSON.stringify(LAYOUTS[name])); savePanels(); buildPanels(); refreshAll(); }
  const bodies = {};
  let floatHost = null;
  function buildPanels() {
    right.innerHTML = ''; if (layout.width) right.style.width = layout.width + 'px';
    // floating panels live in a host inside the Image workspace, so they hide with it
    if (!floatHost || !floatHost.isConnected) { floatHost = el('div', { class: 'pfloat-host' }); right.parentElement.append(floatHost); } floatHost.innerHTML = '';
    layout.float = layout.float || {};
    Object.keys(PANELS).forEach(k => { if (!layout.order.includes(k)) layout.order.push(k); });
    layout.order.forEach(k => {
      const fl = layout.float[k], body = el('div', { class: 'body' }), p = el('section', { class: 'pnl' + (layout.closed.includes(k) ? ' closed' : '') + (fl ? ' floating' : ''), 'data-p': k });
      const tog = el('span', { class: 'pbtn', title: fl ? 'Dock back into the panel column' : 'Float this panel (move and resize it anywhere)', onclick: e => { e.stopPropagation(); if (fl) delete layout.float[k]; else { const r = p.getBoundingClientRect(); layout.float[k] = { x: Math.max(8, r.left - 260), y: Math.max(48, r.top), w: Math.max(260, r.width), h: 0 }; } savePanels(); buildPanels(); refreshAll(); } }, fl ? '⇲' : '⧉');
      const head = el('header', { draggable: fl ? 'false' : 'true' }, fl ? null : el('span', { class: 'grip', title: 'Drag to reorder' }, '⋮⋮'), PANELS[k], el('span', { class: 'spacer' }), tog, el('span', { class: 'dim' }, layout.closed.includes(k) ? '▸' : '▾'));
      let moved = false;
      head.onclick = () => { if (moved) { moved = false; return; } const i = layout.closed.indexOf(k); if (i >= 0) layout.closed.splice(i, 1); else layout.closed.push(k); savePanels(); buildPanels(); refreshAll(); };
      if (fl) {
        Object.assign(p.style, { left: Math.min(innerWidth - 120, fl.x) + 'px', top: Math.min(innerHeight - 40, fl.y) + 'px', width: fl.w + 'px' }); if (fl.h) p.style.height = fl.h + 'px';
        head.onpointerdown = e => { if (e.target === tog) return; const sx = e.clientX, sy = e.clientY, ox = fl.x, oy = fl.y; head.setPointerCapture(e.pointerId);
          head.onpointermove = ev => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; fl.x = Math.max(0, Math.min(innerWidth - 80, ox + dx)); fl.y = Math.max(0, Math.min(innerHeight - 30, oy + dy)); p.style.left = fl.x + 'px'; p.style.top = fl.y + 'px'; };
          head.onpointerup = () => { head.onpointermove = head.onpointerup = null; savePanels(); }; };
        new ResizeObserver(() => { if (!p.isConnected) return; const r = p.getBoundingClientRect(); if (Math.abs(r.width - fl.w) > 2 || Math.abs(r.height - (fl.h || r.height)) > 2) { fl.w = Math.round(r.width); fl.h = Math.round(r.height); clearTimeout(p._t); p._t = setTimeout(savePanels, 300); } }).observe(p);
      } else {
        head.ondragstart = e => e.dataTransfer.setData('text/nx-panel', k);
        p.ondragover = e => { if (e.dataTransfer.types.includes('text/nx-panel')) { e.preventDefault(); p.classList.add('dragover'); } }; p.ondragleave = () => p.classList.remove('dragover');
        p.ondrop = e => { const src = e.dataTransfer.getData('text/nx-panel'); if (!src || src === k) return; delete layout.float[src]; layout.order.splice(layout.order.indexOf(src), 1); layout.order.splice(layout.order.indexOf(k), 0, src); savePanels(); buildPanels(); refreshAll(); };
      }
      p.append(head, body); (fl ? floatHost : right).append(p); bodies[k] = body;
    });
    if (!document.getElementById('nxFonts')) document.body.append(el('datalist', { id: 'nxFonts' }, ['Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Bahnschrift', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Segoe Script', 'Gabriola'].map(f => el('option', { value: f }))));
  }
  const isOpen = k => bodies[k] && !layout.closed.includes(k);
  function refreshAll() { if (!U.mounted) return; updateTabs(); refreshLayers(); refreshProps(); refreshHistory(); refreshColor(); refreshBrushPanel(); refreshSwatches(); navDirty = true; buildOptions(); U.render(); status(); const lk = document.getElementById('imgLink'); if (lk) lk.textContent = U.doc && Assets.linkedMedia(U.doc.id).length ? '🔗 Linked to Edit' : ''; }
  function updateTabs() {
    if (!tabsEl) return; tabsEl.innerHTML = '';
    U.open.forEach(id => { const d = Assets.docs[id]; if (!d) return; const t = el('div', { class: 'doctab' + (d === U.doc ? ' on' : '') }, d.name + (Assets.linkedMedia(id).length ? ' 🔗' : ''), el('i', { title: 'Close', onclick: e => { e.stopPropagation(); U.closeDoc(d); } }, '✕')); t.onclick = () => { if (U.doc) U.doc._view = U.view; U.doc = d; U.view = d._view || U.view; refreshAll(); }; tabsEl.append(t); });
    tabsEl.append(el('div', { class: 'doctab', title: 'New image', onclick: newDocDialog }, '＋'));
  }
  /* layers panel */
  let dragId = null;
  function refreshLayers() {
    if (!isOpen('layers')) return; const b = bodies.layers, d = U.doc; b.innerHTML = ''; if (!d) return b.append(el('div', { class: 'dim' }, 'No document.'));
    const A = NXI.active(d);
    if (A) b.append(el('div', { class: 'prop2' }, ctl.sel(A, 'blend', BLENDS, { names: blendName, on: () => { NXI.dirty(d, A); U.render(); }, commit: () => U.push('Blend mode') }), el('label', { style: 'min-width:0' }, 'Opacity'), ctl.num(A, 'opacity', { min: 0, max: 100, noRange: false, on: () => { NXI.dirty(d, A); U.render(); }, commit: () => U.push('Opacity') })),
      el('div', { class: 'prop2' }, el('label', { style: 'min-width:0' }, 'Lock'), ctl.chk(A, 'locked', { commit: () => U.push(A.locked ? 'Lock' : 'Unlock') }), el('label', { style: 'min-width:0' }, '↳ Clip to below'), ctl.chk(A, 'clip', { on: () => { NXI.dirty(d, A); U.render(); }, commit: () => U.push('Clipping mask') })));
    const list = el('div', {});
    const rowOf = (L, depth) => {
      const r = el('div', { class: 'lrow' + (L.id === d.activeId || d.multi.includes(L.id) ? ' on' : ''), draggable: 'true', style: `padding-left:${4 + depth * 14}px` });
      const eye = el('span', { class: 'eye', title: 'Visibility' }, Icon(L.visible ? 'eye' : 'eyeOff', 14)); eye.onclick = e => { e.stopPropagation(); L.visible = !L.visible; NXI.dirty(d, L); U.push(L.visible ? 'Show layer' : 'Hide layer'); };
      r.append(eye);
      if (L.type === 'group') r.append(el('span', { style: 'cursor:pointer;width:12px', onclick: e => { e.stopPropagation(); L.open = !L.open; refreshLayers(); } }, L.open ? '▾' : '▸'));
      if (L.clip) r.append(el('span', { class: 'clipm' }, '↳'));
      const th = el('canvas', { width: 68, height: 52, class: d.target === 'layer' && L.id === d.activeId && L.mask ? 'tgt' : '' }); NXI.layerThumb(L, d, th); r.append(th);
      th.onclick = e => { if (e.ctrlKey) { e.stopPropagation(); NXI.selFromLayerAlpha(d, L, e.shiftKey ? 'add' : 'replace'); U.push('Load selection'); return; } d.target = 'layer'; };
      if (L.mask) { const mt = el('canvas', { width: 68, height: 52, class: d.target === 'mask' && L.id === d.activeId ? 'tgt' : '', title: 'Layer mask — click to paint on it (white reveals, black hides). Shift+click to disable.', style: L.mask.on ? '' : 'opacity:.35' }); NXI.maskThumb(L, d, mt); mt.onclick = e => { e.stopPropagation(); if (e.shiftKey) { L.mask.on = !L.mask.on; NXI.dirty(d, L); U.push('Toggle mask'); return; } d.activeId = L.id; d.target = 'mask'; refreshLayers(); refreshProps(); }; r.append(mt); }
      const nm = el('span', { class: 'nm', title: 'Double-click to rename' }, L.name); nm.ondblclick = async e => { e.stopPropagation(); const v = await askText('Layer name', L.name); if (v) { L.name = v.slice(0, 60); U.push('Rename'); } }; r.append(nm);
      if (NXI.hasFx(L)) r.append(el('span', { class: 'dim', title: 'Layer effects' }, 'fx'));
      if (L.type === 'adjust') r.append(el('span', { class: 'dim', title: ADJ.defs[L.adj.type].name }, '◐'));
      if (L.locked) r.append(el('span', { class: 'lk' }, Icon('lock', 13)));
      r.onclick = e => { if (e.ctrlKey || e.metaKey) { const i = d.multi.indexOf(L.id); if (i >= 0) d.multi.splice(i, 1); else { if (!d.multi.length && d.activeId) d.multi.push(d.activeId); d.multi.push(L.id); } } else d.multi = []; if (d.activeId !== L.id) { d.activeId = L.id; if (!L.mask) d.target = 'layer'; } refreshLayers(); refreshProps(); buildOptions(); };
      r.oncontextmenu = e => { e.preventDefault(); d.activeId = L.id; refreshLayers(); PopMenu.open(e.clientX, e.clientY, MENUS.Layer()); };
      r.ondragstart = e => { dragId = L.id; e.dataTransfer.setData('text/nx-layer', L.id); };
      r.ondragover = e => { if (!dragId) return; e.preventDefault(); const rr = r.getBoundingClientRect(), f = (e.clientY - rr.top) / rr.height; r.classList.remove('drop-before', 'drop-after', 'drop-in'); r.classList.add(L.type === 'group' && f > .3 && f < .7 ? 'drop-in' : f < .5 ? 'drop-before' : 'drop-after'); };
      r.ondragleave = () => r.classList.remove('drop-before', 'drop-after', 'drop-in');
      r.ondrop = e => { e.preventDefault(); const pos = r.classList.contains('drop-in') ? 'in' : r.classList.contains('drop-before') ? 'before' : 'after'; r.classList.remove('drop-before', 'drop-after', 'drop-in'); if (dragId && dragId !== L.id) { NXI.moveTo(d, dragId, L.id, pos); U.push('Reorder layers'); } dragId = null; };
      list.append(r);
      if (L.type === 'group' && L.open) for (let i = L.children.length - 1; i >= 0; i--) rowOf(L.children[i], depth + 1);
    };
    for (let i = d.layers.length - 1; i >= 0; i--) rowOf(d.layers[i], 0);
    b.append(list);
    const btn = (ic, title, fn) => el('button', { title, onclick: need(fn), class: 'ibtn only' }, Icon.has(ic) ? Icon(ic, 15) : ic);
    b.append(el('div', { class: 'ltools' },
      btn('plus', 'New pixel layer', d => { NXI.insert(d, NXI.mkLayer(d, 'raster', { name: 'Layer ' + (NXI.countLayers(d) + 1) })); U.push('New layer'); }),
      btn('group', 'New group', d => { NXI.insert(d, NXI.mkLayer(d, 'group')); U.push('New group'); }),
      el('button', { title: 'New adjustment layer', class: 'ibtn only', 'data-pop': '1', onclick: e => PopMenu.at(e.currentTarget, adjSub(addAdjustLayer)) }, Icon('theme', 15)),
      btn('rect', 'Add layer mask (from selection if any)', d => { const L = NXI.active(d); if (L && !L.mask) { NXI.addMask(d, L, !!d.sel); U.push('Add mask'); } }),
      btn('sparkle', 'Layer effects', () => { layout.closed = layout.closed.filter(k => k !== 'fx'); savePanels(); buildPanels(); refreshAll(); }),
      btn('duplicate', 'Duplicate (Ctrl+J)', d => { NXI.duplicate(d, d.activeId); U.push('Duplicate layer'); }),
      btn('layers', 'Merge down (Ctrl+E)', d => { if (NXI.mergeDown(d, d.activeId)) U.push('Merge Down'); }),
      btn('↑', 'Move up', d => { NXI.moveBy(d, d.activeId, 1); U.push('Arrange'); }), btn('↓', 'Move down', d => { NXI.moveBy(d, d.activeId, -1); U.push('Arrange'); }),
      btn('trash', 'Delete layer', d => { NXI.remove(d, d.activeId); U.push('Delete layer'); })));
  }
  /* properties panel */
  function refreshProps() {
    if (!U.mounted) return; refreshFx(); if (!isOpen('props')) return; const b = bodies.props, d = U.doc; b.innerHTML = ''; if (!d) return;
    const L = NXI.active(d), live = () => { NXI.dirty(d, L); U.render(); }, commit = lbl => () => U.push(lbl);
    if (!L) { b.append(el('div', { class: 'dim' }, `${d.name} · ${d.w} × ${d.h}px · ${NXI.countLayers(d)} layers`)); return; }
    b.append(row('Name', ctl.text(L, 'name', { commit: commit('Rename') })));
    if (L.type === 'raster') b.append(nrow('Offset X', L, 'x', { noRange: true, on: live, commit: commit('Move') }), nrow('Offset Y', L, 'y', { noRange: true, on: live, commit: commit('Move') }), el('div', { class: 'dim' }, d.target === 'mask' ? 'Painting on the layer MASK (white reveals · black hides).' : 'Pixel layer. Use filters, adjustments and paint tools.'));
    if (L.mask) b.append(nrow('Mask density', L.mask, 'density', { min: 0, max: 100, on: live, commit: commit('Mask density') }), row('Mask enabled', ctl.chk(L.mask, 'on', { on: live, commit: commit('Toggle mask') })));
    if (L.tr) b.append(el('h4', {}, 'Transform'), nrow('X', L.tr, 'x', { noRange: true, on: live, commit: commit('Transform') }), nrow('Y', L.tr, 'y', { noRange: true, on: live, commit: commit('Transform') }), nrow('Rotation', L.tr, 'rot', { min: -180, max: 180, on: live, commit: commit('Transform') }), nrow('Scale X %', L.tr, 'sx', { min: -400, max: 400, on: live, commit: commit('Transform') }), nrow('Scale Y %', L.tr, 'sy', { min: -400, max: 400, on: live, commit: commit('Transform') }));
    if (L.type === 'text') { const X = L.text; if (X.boxW == null) X.boxW = 0; if (X.pathOffset == null) X.pathOffset = 0; if (X.baseline == null) X.baseline = 0; b.append(el('h4', {}, 'Character'), ctl.text(X, 'str', { area: true, on: live, commit: commit('Edit text') }),
      row('Font', ctl.text(X, 'font', { list: 'nxFonts', on: live, commit: commit('Font') })), nrow('Size', X, 'size', { min: 4, max: 1200, on: live, commit: commit('Font size') }), row('Weight', ctl.sel(X, 'weight', ['300', '400', '600', '700', '800', '900'], { on: live, commit: commit('Weight') }), el('label', { style: 'min-width:0' }, 'Italic'), ctl.chk(X, 'italic', { on: live, commit: commit('Italic') })),
      row('Color', ctl.color(X, 'color', { on: live, commit: commit('Text color') }), el('label', { style: 'min-width:0' }, 'Gradient'), ctl.chk(X, 'grad', { on: live, commit: commit('Text gradient') }), ctl.color(X, 'c2', { on: live, commit: commit('Text gradient') })), nrow('Gradient angle', X, 'gAngle', { min: 0, max: 360, on: live, commit: commit('Text gradient') }),
      el('h4', {}, 'Paragraph & path'), nrow('Box width (0 = point text)', X, 'boxW', { min: 0, max: 8000, on: live, commit: commit('Text box') }),
      el('div', { class: 'ltools' },
        el('button', { title: 'Run the text along the current pen path', onclick: () => { const P2 = d.path; if (!P2 || P2.pts.length < 2) return toast('Draw a path with the Pen tool (P) first.'); const tr = L.tr || { x: 0, y: 0, rot: 0, sx: 100, sy: 100 }, a = -(tr.rot || 0) * Math.PI / 180, kx = 100 / (tr.sx || 100), ky = 100 / (tr.sy || 100);
          const loc = (x, y) => { const dx = x - tr.x, dy = y - tr.y; return [(dx * Math.cos(a) - dy * Math.sin(a)) * kx, (dx * Math.sin(a) + dy * Math.cos(a)) * ky]; };
          X.path = P2.pts.map(q => { const [x, y] = loc(q.x, q.y), [ix, iy] = loc(q.ix ?? q.x, q.iy ?? q.y), [ox, oy] = loc(q.ox ?? q.x, q.oy ?? q.y); return { x, y, ix, iy, ox, oy }; }); X.pathClosed = !!P2.closed; X.boxW = 0; live(); U.push('Text on path'); U.refreshProps(); } }, 'Put on pen path'),
        X.path ? el('button', { onclick: () => { delete X.path; live(); U.push('Text off path'); U.refreshProps(); } }, 'Remove from path') : null),
      X.path ? nrow('Path offset %', X, 'pathOffset', { min: -100, max: 100, on: live, commit: commit('Path offset') }) : null,
      X.path ? nrow('Baseline shift', X, 'baseline', { min: -500, max: 500, on: live, commit: commit('Baseline') }) : null,
      row('Align', ctl.sel(X, 'align', ['left', 'center', 'right', 'justify'], { on: live, commit: commit('Align') }), el('label', { style: 'min-width:0' }, 'Case'), ctl.sel(X, 'case', ['none', 'upper', 'lower', 'cap'], { on: live, commit: commit('Case') })),
      nrow('Tracking', X, 'tracking', { min: -200, max: 1000, on: live, commit: commit('Tracking') }), row('Kerning', ctl.chk(X, 'kern', { on: live, commit: commit('Kerning') })), nrow('Line height', X, 'lineH', { min: .5, max: 3, step: .01, on: live, commit: commit('Leading') }),
      el('h4', {}, 'Outline & shadow'), row('Outline', ctl.color(X, 'stroke', { on: live, commit: commit('Outline') }), ctl.num(X, 'strokeW', { min: 0, max: 60, on: live, commit: commit('Outline') })),
      row('Shadow', ctl.chk(X, 'shadow', { on: live, commit: commit('Shadow') }), ctl.color(X, 'shColor', { on: live, commit: commit('Shadow') })), nrow('Shadow blur', X, 'shBlur', { min: 0, max: 100, on: live, commit: commit('Shadow') }), nrow('Shadow X', X, 'shX', { min: -100, max: 100, on: live, commit: commit('Shadow') }), nrow('Shadow Y', X, 'shY', { min: -100, max: 100, on: live, commit: commit('Shadow') }),
      el('div', { class: 'ltools' }, el('button', { onclick: () => U.editText(L) }, 'Edit on canvas'), el('button', { onclick: () => { NXI.rasterize(d, L); U.push('Rasterize'); } }, 'Rasterize'))); }
    if (L.type === 'shape') { const S2 = L.shape; b.append(el('h4', {}, 'Shape'), row('Kind', ctl.sel(S2, 'kind', S2.kind === 'path' ? ['path'] : ['rect', 'ellipse', 'polygon', 'star', 'line'], { on: live, commit: commit('Shape') })), nrow('Width', S2, 'w', { min: 1, max: 8000, on: live, commit: commit('Shape size') }), nrow('Height', S2, 'h', { min: 1, max: 8000, on: live, commit: commit('Shape size') }), nrow('Corner radius', S2, 'radius', { min: 0, max: 1000, on: live, commit: commit('Radius') }), nrow('Points', S2, 'points', { min: 3, max: 30, on: live, commit: commit('Points') }),
      row('Fill', ctl.chk(S2, 'fillOn', { on: live, commit: commit('Fill') }), ctl.color(S2, 'fill', { on: live, commit: commit('Fill') }), el('label', { style: 'min-width:0' }, 'Gradient'), ctl.chk(S2, 'grad', { on: live, commit: commit('Fill') }), ctl.color(S2, 'fill2', { on: live, commit: commit('Fill') })), nrow('Gradient angle', S2, 'gAngle', { min: 0, max: 360, on: live, commit: commit('Fill') }),
      row('Stroke', ctl.color(S2, 'stroke', { on: live, commit: commit('Stroke') }), ctl.num(S2, 'strokeW', { min: 0, max: 200, on: live, commit: commit('Stroke') })), el('div', { class: 'ltools' }, el('button', { onclick: () => { NXI.rasterize(d, L); U.push('Rasterize'); } }, 'Rasterize'))); }
    if (L.type === 'adjust') b.append(el('h4', {}, ADJ.defs[L.adj.type].name), row('Type', ctl.sel(L.adj, 'type', Object.keys(ADJ.defs), { names: k => ADJ.defs[k].name, on: () => { L.adj.p = ADJ.defs[L.adj.type].p(); L.name = ADJ.defs[L.adj.type].name; live(); refreshProps(); }, commit: commit('Adjustment type') })), adjEditor(L, live, commit('Adjust ' + ADJ.defs[L.adj.type].name)));
    if (L.type === 'group') b.append(el('div', { class: 'dim' }, `Group · ${L.children.length} layer(s). Opacity, blend, mask and effects apply to the whole group.`));
  }
  /* adjustment editors (also used by destructive dialogs) */
  function adjEditor(L, live, commit) {
    const p = L.adj.p, t = L.adj.type, box = el('div', {}), N = (lab, k, mn, mx, st) => nrow(lab, p, k, { min: mn, max: mx, step: st || 1, on: live, commit });
    switch (t) {
      case 'brightness': box.append(N('Brightness', 'b', -150, 150), N('Contrast', 'c', -100, 100)); break;
      case 'exposure': box.append(N('Exposure', 'ev', -5, 5, .01), N('Offset', 'offset', -.5, .5, .005), N('Gamma', 'gamma', .1, 3, .01)); break;
      case 'hsl': box.append(N('Hue', 'h', -180, 180), N('Saturation', 's', -100, 100), N('Lightness', 'l', -100, 100), row('Colorize', ctl.chk(p, 'colorize', { on: live, commit }))); break;
      case 'vibrance': box.append(N('Vibrance', 'v', -100, 100), N('Saturation', 's', -100, 100)); break;
      case 'threshold': box.append(N('Level', 't', 1, 255)); break;
      case 'posterize': box.append(N('Levels', 'n', 2, 32)); break;
      case 'photo': box.append(row('Color', ctl.color(p, 'color', { on: live, commit })), N('Density', 'density', 0, 100), row('Preserve luminosity', ctl.chk(p, 'preserve', { on: live, commit }))); break;
      case 'levels': box.append(histoCanvas(), N('Input black', 'ib', 0, 254), N('Input white', 'iw', 1, 255), N('Gamma', 'g', .1, 3, .01), N('Output black', 'ob', 0, 255), N('Output white', 'ow', 0, 255)); break;
      case 'balance': { const st = { tone: 'mid' }, holder = el('div', {}); const draw = () => { holder.innerHTML = ''; const arr = p[st.tone]; [['Cyan ↔ Red', 0], ['Magenta ↔ Green', 1], ['Yellow ↔ Blue', 2]].forEach(([lab, i]) => { const o = { v: arr[i] }; holder.append(nrow(lab, o, 'v', { min: -100, max: 100, on: () => { arr[i] = o.v; live(); }, commit })); }); };
        box.append(row('Tones', ctl.sel(st, 'tone', ['sh', 'mid', 'hi'], { names: v => ({ sh: 'Shadows', mid: 'Midtones', hi: 'Highlights' }[v]), on: draw })), holder, row('Preserve luminosity', ctl.chk(p, 'preserve', { on: live, commit }))); draw(); break; }
      case 'selective': { const st = { c: 'reds' }, holder = el('div', {}); const draw = () => { holder.innerHTML = ''; const arr = p[st.c]; [['Hue shift', 0, 180], ['Saturation', 1, 100], ['Lightness', 2, 100]].forEach(([lab, i, m]) => { const o = { v: arr[i] }; holder.append(nrow(lab, o, 'v', { min: -m, max: m, on: () => { arr[i] = o.v; live(); }, commit })); }); };
        box.append(row('Colors', ctl.sel(st, 'c', ADJ.HUES.map(h => h[0]), { on: draw })), holder); draw(); break; }
      case 'bw': box.append(...ADJ.HUES.map(([k]) => N(k[0].toUpperCase() + k.slice(1), k, -200, 300)), row('Tint', ctl.chk(p, 'tint', { on: live, commit }), ctl.color(p, 'tintColor', { on: live, commit }))); break;
      case 'gradmap': { const holder = el('div', { class: 'gstops' }), prev = el('div', { style: 'height:16px;border-radius:4px;margin:6px 0;border:1px solid var(--line)' });
        const draw = () => { holder.innerHTML = ''; prev.style.background = `linear-gradient(90deg,${p.stops.slice().sort((a, b) => a[0] - b[0]).map(s => s[1] + ' ' + s[0] * 100 + '%').join(',')})`; p.stops.forEach((s, i) => { const o = { pos: Math.round(s[0] * 100) }; const c = el('input', { type: 'color', value: s[1] }); c.oninput = () => { s[1] = c.value; live(); draw(); }; c.onchange = commit; holder.append(el('div', { style: 'display:flex;gap:3px;align-items:center' }, c, ctl.num(o, 'pos', { noRange: true, min: 0, max: 100, on: () => { s[0] = clamp(o.pos, 0, 100) / 100; live(); }, commit }), p.stops.length > 2 ? el('button', { onclick: () => { p.stops.splice(i, 1); live(); commit(); draw(); } }, '✕') : null)); }); holder.append(el('button', { onclick: () => { p.stops.push([.5, '#ffffff']); live(); commit(); draw(); } }, 'stop')); };
        box.append(prev, holder, row('Reverse', ctl.chk(p, 'reverse', { on: live, commit }))); draw(); break; }
      case 'curves': box.append(curvesWidget(p, live, commit)); break;
      case 'invert': box.append(el('div', { class: 'dim' }, 'Inverts colors (no settings).')); break;
    }
    return box;
  }
  function histoCanvas() { const c = el('canvas', { width: 256, height: 70, style: 'width:100%;height:70px;background:#0a0a0e;border:1px solid var(--line);border-radius:4px' }); if (U.doc) { const comp = NXI.render(U.doc), h = ADJ.histogram(comp._ctx.getImageData(0, 0, U.doc.w, U.doc.h).data), mx = Math.max(...h) || 1, x = c.getContext('2d'); x.fillStyle = '#8d8da3'; for (let i = 0; i < 256; i++) { const v = Math.sqrt(h[i] / mx) * 70; x.fillRect(i, 70 - v, 1, v); } } return c; }
  function curvesWidget(p, live, commit) {
    const st = { ch: 'rgb' }, cv = el('canvas', { width: 256, height: 256 }), wrap = el('div', { class: 'curvebox' }, row('Channel', ctl.sel(st, 'ch', ['rgb', 'r', 'g', 'b'], { names: v => v.toUpperCase(), on: () => draw() })), cv, el('div', { class: 'dim' }, 'Click to add a point · drag to shape · double-click a point to remove'));
    let hist = null; if (U.doc) { const comp = NXI.render(U.doc); hist = ADJ.histogram(comp._ctx.getImageData(0, 0, U.doc.w, U.doc.h).data); }
    const draw = () => { const x = cv.getContext('2d'); x.clearRect(0, 0, 256, 256); if (hist) { const mx = Math.max(...hist) || 1; x.fillStyle = '#2a2a36'; for (let i = 0; i < 256; i++) { const v = Math.sqrt(hist[i] / mx) * 256; x.fillRect(i, 256 - v, 1, v); } } x.strokeStyle = '#2c2c38'; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
      const lut = ADJ.curveLUT(p[st.ch]); x.strokeStyle = { rgb: '#ececf4', r: '#ff5c5c', g: '#4ade80', b: '#3b9bff' }[st.ch]; x.lineWidth = 2; x.beginPath(); for (let i = 0; i < 256; i++) i ? x.lineTo(i, 255 - lut[i]) : x.moveTo(i, 255 - lut[i]); x.stroke(); x.fillStyle = '#fff'; p[st.ch].forEach(([a, b]) => x.fillRect(a - 4, 255 - b - 4, 8, 8)); };
    const at = e => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width * 255, 0, 255), clamp(255 - (e.clientY - r.top) / r.height * 255, 0, 255)]; };
    let drag = null; cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); const [a, b] = at(e), pts = p[st.ch]; let i = pts.findIndex(q => Math.abs(q[0] - a) < 8 && Math.abs(q[1] - b) < 12); if (i < 0) { pts.push([Math.round(a), Math.round(b)]); pts.sort((m, n) => m[0] - n[0]); i = pts.findIndex(q => q[0] === Math.round(a)); } drag = pts[i]; live(); draw(); };
    cv.onpointermove = e => { if (!drag) return; const [a, b] = at(e); drag[0] = Math.round(a); drag[1] = Math.round(b); p[st.ch].sort((m, n) => m[0] - n[0]); live(); draw(); };
    cv.onpointerup = () => { if (drag) commit(); drag = null; };
    cv.ondblclick = e => { const [a, b] = at(e), pts = p[st.ch], i = pts.findIndex(q => Math.abs(q[0] - a) < 8 && Math.abs(q[1] - b) < 12); if (i >= 0 && pts.length > 2) { pts.splice(i, 1); live(); commit(); draw(); } };
    draw(); return wrap;
  }
  /* layer effects panel */
  function refreshFx() {
    if (!isOpen('fx')) return; const b = bodies.fx, d = U.doc; b.innerHTML = ''; const L = d && NXI.active(d); if (!L || L.type === 'adjust') return b.append(el('div', { class: 'dim' }, 'Select a layer to add effects.'));
    const live = () => { NXI.dirty(d, L); U.render(); }, commit = () => U.push('Layer effect'), F = NXI.fxOf(L);
    const sec = (title, f, ...rows) => el('div', { class: 'fxsec' }, el('div', {}, ctl.chk(f, 'on', { on: () => { live(); refreshLayers(); }, commit }), title), f.on ? el('div', {}, ...rows) : null);
    b.append(sec('Drop shadow', F.shadow, row('Color', ctl.color(F.shadow, 'color', { on: live, commit })), nrow('Opacity', F.shadow, 'opacity', { min: 0, max: 100, on: live, commit }), nrow('Angle', F.shadow, 'angle', { min: 0, max: 360, on: live, commit }), nrow('Distance', F.shadow, 'distance', { min: 0, max: 300, on: live, commit }), nrow('Size', F.shadow, 'size', { min: 0, max: 200, on: live, commit })),
      sec('Outer glow', F.glow, row('Color', ctl.color(F.glow, 'color', { on: live, commit })), nrow('Opacity', F.glow, 'opacity', { min: 0, max: 100, on: live, commit }), nrow('Size', F.glow, 'size', { min: 1, max: 250, on: live, commit })),
      sec('Stroke (outside)', F.stroke, row('Color', ctl.color(F.stroke, 'color', { on: live, commit })), nrow('Size', F.stroke, 'size', { min: 1, max: 60, on: live, commit }), nrow('Opacity', F.stroke, 'opacity', { min: 0, max: 100, on: live, commit })),
      sec('Color overlay', F.overlay, row('Color', ctl.color(F.overlay, 'color', { on: live, commit })), nrow('Opacity', F.overlay, 'opacity', { min: 0, max: 100, on: live, commit })),
      sec('Inner shadow', F.innerShadow, row('Color', ctl.color(F.innerShadow, 'color', { on: live, commit })), nrow('Opacity', F.innerShadow, 'opacity', { min: 0, max: 100, on: live, commit }), nrow('Angle', F.innerShadow, 'angle', { min: 0, max: 360, on: live, commit }), nrow('Distance', F.innerShadow, 'distance', { min: 0, max: 200, on: live, commit }), nrow('Size', F.innerShadow, 'size', { min: 0, max: 150, on: live, commit })),
      sec('Inner glow', F.innerGlow, row('Color', ctl.color(F.innerGlow, 'color', { on: live, commit })), nrow('Opacity', F.innerGlow, 'opacity', { min: 0, max: 100, on: live, commit }), nrow('Size', F.innerGlow, 'size', { min: 1, max: 150, on: live, commit })),
      sec('Bevel & emboss', F.bevel, row('Style', ctl.sel(F.bevel, 'style', ['inner', 'emboss'], { names: v => v === 'inner' ? 'Inner bevel' : 'Emboss', on: live, commit })), nrow('Depth', F.bevel, 'depth', { min: 1, max: 1000, on: live, commit }), nrow('Size', F.bevel, 'size', { min: 1, max: 100, on: live, commit }),
        nrow('Angle', F.bevel, 'angle', { min: 0, max: 360, on: live, commit }), nrow('Altitude', F.bevel, 'altitude', { min: 0, max: 90, on: live, commit }), row('Highlight', ctl.color(F.bevel, 'hi', { on: live, commit })), nrow('Highlight opacity', F.bevel, 'hiOp', { min: 0, max: 100, on: live, commit }), row('Shadow', ctl.color(F.bevel, 'sh', { on: live, commit })), nrow('Shadow opacity', F.bevel, 'shOp', { min: 0, max: 100, on: live, commit })));
  }
  /* history */
  function refreshHistory() {
    if (!isOpen('history')) return; const b = bodies.history, d = U.doc; b.innerHTML = ''; if (!d) return; const ul = el('ul', { class: 'histo' });
    d.hist.forEach((s, i) => ul.append(el('li', { class: i === d.histI ? 'on' : i > d.histI ? 'fut' : '', onclick: () => { NXI.jump(d, i); refreshAll(); } }, s.label)));
    b.append(ul, el('div', { class: 'dim', style: 'margin-top:4px' }, `${d.hist.length} states · ${Math.round(NXI.histBytes(d) / 1048576)} MB (capped at 768 MB)`)); ul.scrollTop = 1e6;
  }
  /* color + swatches */
  function refreshColorPanel() {
    if (!isOpen('color')) return; const b = bodies.color, d = U.doc || { fg: '#ffffff', bg: '#000000' }; b.innerHTML = ''; const cur = colorTarget === 'bg' ? d.bg : d.fg, [r, g, bb] = hexToRgb(cur), hsl = ADJ.rgb2hsl(r, g, bb, [0, 0, 0]);
    let mx = Math.max(r, g, bb) / 255, mn = Math.min(r, g, bb) / 255, hsv = [hsl[0], mx ? (mx - mn) / mx : 0, mx];
    const set = hex => { if (!U.doc) return; if (colorTarget === 'bg') U.doc.bg = hex; else U.doc.fg = hex; refreshColor(); };
    const sv = el('canvas', { width: 230, height: 120, style: 'width:100%;height:120px;border-radius:4px;cursor:crosshair' }), hue = el('canvas', { width: 230, height: 12, style: 'width:100%;height:12px;border-radius:3px;cursor:pointer;margin-top:4px' });
    const draw = () => { const x = sv.getContext('2d'); x.fillStyle = `hsl(${hsv[0] * 360},100%,50%)`; x.fillRect(0, 0, 230, 120); let g2 = x.createLinearGradient(0, 0, 230, 0); g2.addColorStop(0, '#fff'); g2.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g2; x.fillRect(0, 0, 230, 120); g2 = x.createLinearGradient(0, 0, 0, 120); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000'); x.fillStyle = g2; x.fillRect(0, 0, 230, 120); x.strokeStyle = hsv[2] > .5 ? '#000' : '#fff'; x.beginPath(); x.arc(hsv[1] * 230, (1 - hsv[2]) * 120, 5, 0, 6.283); x.stroke();
      const h = hue.getContext('2d'), hg = h.createLinearGradient(0, 0, 230, 0); for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`); h.fillStyle = hg; h.fillRect(0, 0, 230, 12); h.fillStyle = '#fff'; h.fillRect(hsv[0] * 230 - 1, 0, 3, 12); };
    const fromHSV = () => { const [h, s, v] = hsv, f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join(''); };
    const pick = (cv, fn) => { cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); fn(e); cv.onpointermove = ev => ev.buttons && fn(ev); }; };
    pick(sv, e => { const r2 = sv.getBoundingClientRect(); hsv[1] = clamp((e.clientX - r2.left) / r2.width, 0, 1); hsv[2] = clamp(1 - (e.clientY - r2.top) / r2.height, 0, 1); draw(); set(fromHSV()); hex.value = fromHSV(); });
    pick(hue, e => { const r2 = hue.getBoundingClientRect(); hsv[0] = clamp((e.clientX - r2.left) / r2.width, 0, .999); draw(); set(fromHSV()); hex.value = fromHSV(); });
    const hex = el('input', { type: 'text', value: cur, style: 'width:84px' }); hex.onchange = () => { if (/^#?[0-9a-f]{6}$/i.test(hex.value)) { set('#' + hex.value.replace('#', '').toLowerCase()); refreshColorPanel(); } };
    const tgt = el('div', { style: 'display:flex;gap:4px' }, ...['fg', 'bg'].map(k => el('button', { class: colorTarget === k ? 'on' : '', onclick: () => { colorTarget = k; refreshColorPanel(); } }, k === 'fg' ? 'Foreground' : 'Background')));
    b.append(tgt, sv, hue, el('div', { class: 'prop2' }, el('label', { style: 'min-width:0' }, 'Hex'), hex, el('input', { type: 'color', value: cur, oninput: e => { set(e.target.value); refreshColorPanel(); } }), el('span', { class: 'dim' }, `RGB ${r}, ${g}, ${bb}`))); draw();
  }
  const DEFAULT_SWATCHES = ['#000000', '#ffffff', '#5cb8ff', '#3b9bff', '#ff3b5c', '#ffd23f', '#22c55e', '#06b6d4', '#f97316', '#5cb8ff', '#1b0b4a', '#0a3a6b', '#7f1d1d', '#713f12', '#14532d', '#164e63', '#4c1d95', '#831843', '#9ca3af', '#4b5563', '#e5e7eb', '#fde68a', '#bbf7d0', '#bfdbfe'];
  function refreshSwatches() {
    if (!isOpen('swatches')) return; const b = bodies.swatches; b.innerHTML = ''; const user = JSON.parse(localStorage.getItem('nexora.swatches') || '[]'), g = el('div', { class: 'swatches' });
    [...DEFAULT_SWATCHES, ...user].forEach(c => g.append(el('div', { style: 'background:' + c, title: c + ' (click: foreground · alt-click: background)', onclick: e => { if (!U.doc) return; if (e.altKey) U.doc.bg = c; else U.doc.fg = c; refreshColor(); } })));
    b.append(g, el('div', { class: 'ltools' }, el('button', { onclick: () => { if (!U.doc) return; user.push(U.doc.fg); localStorage.setItem('nexora.swatches', JSON.stringify(user.slice(-48))); refreshSwatches(); } }, 'Add foreground'), el('button', { onclick: () => { localStorage.removeItem('nexora.swatches'); refreshSwatches(); } }, 'Reset')));
  }
  /* brush settings */
  function refreshBrushPanel() {
    if (!isOpen('brush')) return; const b = bodies.brush, B = O().brush, save = () => TL().saveOpts(), all = Object.assign({}, TL().BRUSH_PRESETS, TL().userBrushes); b.innerHTML = '';
    const grid = el('div', { class: 'bpresets' });
    Object.keys(all).forEach(k => { const pv = el('canvas', { width: 52, height: 40 }), x = pv.getContext('2d'), o = Object.assign({}, B, { size: 26, angle: 0, roundness: 100, scatter: 0, tip: null }, all[k]); const tip = TL().getTip(o, '#ececf4', 26); x.drawImage(tip, 26 - tip.width / 2, 20 - tip.height / 2);
      grid.append(el('button', { class: B.preset === k ? 'on' : '', title: k, onclick: () => { Object.assign(B, { scatter: 0, sizeJitter: 0, angle: 0, roundness: 100, tip: null, flow: 100 }, all[k]); B.preset = k; save(); refreshBrushPanel(); buildOptions(); } }, pv, k.slice(0, 11))); });
    b.append(grid);
    const N2 = (l, k, mn, mx) => nrow(l, B, k, { min: mn, max: mx, commit: () => { save(); buildOptions(); } });
    b.append(N2('Size', 'size', 1, 1000), N2('Hardness', 'hardness', 0, 100), N2('Opacity', 'opacity', 1, 100), N2('Flow', 'flow', 1, 100), N2('Spacing %', 'spacing', 1, 200), N2('Angle', 'angle', -180, 180), N2('Roundness %', 'roundness', 5, 100), N2('Scatter %', 'scatter', 0, 300), N2('Size jitter %', 'sizeJitter', 0, 100), N2('Smoothing', 'smoothing', 0, 90),
      row('Texture', ctl.sel(B, 'texture', ['none', 'noise', 'canvas', 'paper', 'stipple'], { commit: save })), N2('Texture scale %', 'textureScale', 10, 400),
      row('Pressure → size', ctl.chk(B, 'pressureSize', { commit: save }), el('label', { style: 'min-width:0' }, '→ opacity'), ctl.chk(B, 'pressureOpacity', { commit: save })), el('div', { class: 'dim' }, 'Pressure is read from pen/stylus input (PointerEvent.pressure) where the device supports it.'),
      el('div', { class: 'ltools' },
        el('button', { onclick: async () => { const n = await askText('Preset name', 'My brush'); if (!n) return; TL().userBrushes[n] = JSON.parse(JSON.stringify(B)); TL().userBrushes[n].preset = n; localStorage.setItem('nexora.brushes', JSON.stringify(TL().userBrushes)); B.preset = n; refreshBrushPanel(); } }, 'Save preset'),
        el('button', { onclick: async () => { const [f] = await pickFiles('image/*'); if (!f) return; const src = (await NXI.formats.decodeFile(f)).src, s = 128, c = NXI.newCanvas(s, s), x = c.getContext('2d'); x.drawImage(src, 0, 0, s, s); const id = x.getImageData(0, 0, s, s); for (let i = 0; i < id.data.length; i += 4) { const a = (255 - (id.data[i] * .299 + id.data[i + 1] * .587 + id.data[i + 2] * .114)) * id.data[i + 3] / 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = 0; id.data[i + 3] = a; } x.putImageData(id, 0, 0); B.tip = c.toDataURL(); B.preset = 'Custom tip'; refreshBrushPanel(); toast('Custom tip loaded (dark pixels = paint).'); } }, 'Tip from image…'),
        el('button', { onclick: async () => { const [f] = await pickFiles('.json,.nxbrush'); if (!f) return; try { const list = NXI.formats.brushFromJSON(JSON.parse(await f.text())); list.forEach(({ name, b: bb }) => TL().userBrushes[name] = Object.assign({}, B, bb, { preset: name })); localStorage.setItem('nexora.brushes', JSON.stringify(TL().userBrushes)); refreshBrushPanel(); toast(list.length + ' brush(es) imported.'); } catch (e) { toast(e.message); } } }, 'Import brush…'),
        el('button', { onclick: () => download(new Blob([JSON.stringify(NXI.formats.brushToJSON(B.preset, B), null, 1)], { type: 'application/json' }), B.preset.replace(/\W+/g, '_') + '.nxbrush') }, 'Export brush')));
  }
  /* navigator */
  function refreshNavigator() {
    navDirty = false; if (!isOpen('nav')) return; const b = bodies.nav, d = U.doc; b.innerHTML = ''; if (!d) return;
    const W = b.clientWidth || 300, k = Math.min(W / d.w, 150 / d.h), cv = el('canvas', { width: Math.round(d.w * k), height: Math.round(d.h * k), style: 'display:block;margin:auto;cursor:pointer;border:1px solid var(--line)' }), x = cv.getContext('2d');
    x.drawImage(NXI.render(d), 0, 0, cv.width, cv.height); const r = stage.getBoundingClientRect(), a = U.toDoc(0, 0), bb = U.toDoc(r.width, r.height); x.strokeStyle = '#ff3b5c'; x.lineWidth = 2; x.strokeRect(a.x * k, a.y * k, (bb.x - a.x) * k, (bb.y - a.y) * k);
    const go = e => { const rr = cv.getBoundingClientRect(), px = (e.clientX - rr.left) / k, py = (e.clientY - rr.top) / k; U.view.px = r.width / 2 - px * U.view.zoom; U.view.py = r.height / 2 - py * U.view.zoom; U.render(); navDirty = true; };
    cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); go(e); cv.onpointermove = ev => ev.buttons && go(ev); };
    const z = { v: Math.round(U.view.zoom * 100) }; b.append(cv, nrow('Zoom %', z, 'v', { min: 2, max: 3200, on: () => setZoom(z.v / 100) }));
  }
  setInterval(() => { if (U.mounted && Shell.active === 'image' && U.doc) navDirty = true; }, 600);

  /* ---------- inline text editing ---------- */
  U.editText = (L, isNew) => {
    const d = U.doc, s = U.toScreen({ x: L.tr.x, y: L.tr.y }), ta = el('textarea', { style: `position:absolute;left:${s.x - 160}px;top:${s.y - 40}px;width:320px;height:80px;z-index:20;background:#000c;color:#fff;border:2px solid var(--acc2);font:16px Segoe UI;padding:6px` });
    ta.value = L.text.str; stage.append(ta); setTimeout(() => { ta.focus(); ta.select(); }, 10);
    ta.oninput = () => { L.text.str = ta.value || ' '; NXI.dirty(d, L); U.render(); };
    const done = () => { ta.remove(); U.push(isNew ? 'Type' : 'Edit text'); refreshProps(); };
    ta.onblur = done; ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) ta.blur(); };
  };

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', e => {
    if (Shell.active !== 'image' || !U.mounted) return; const tg = e.target; if (tg.matches && tg.matches('input:not([type=range]):not([type=checkbox]):not([type=color]),textarea,select')) return;
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey, d = U.doc, run = (fn, ...a) => { e.preventDefault(); fn(...a); };
    if (e.key === ' ') { U.space = true; if (over) over.style.cursor = 'grab'; e.preventDefault(); return; }
    if (c && !e.shiftKey && k === 'n') return run(newDocDialog); if (c && k === 'o') return run(async () => openFiles(await pickFiles('image/*,.nxi,.tif,.tiff,.psd', true)));
    if (!d) return;
    if (c) {
      if (k === 'z') return run(() => { e.shiftKey ? NXI.redo(d) : NXI.undo(d); afterChange(); }); if (k === 'y') return run(() => { NXI.redo(d); afterChange(); });
      if (k === 's') return run(e.shiftKey ? exportDialog : async () => download(await NXI.formats.exportBlob(d, 'nxi'), d.name + '.nxi'));
      if (k === 'a') return run(() => { NXI.selAll(d); U.push('Select All'); }); if (k === 'd') return run(() => { NXI.selNone(d); U.push('Deselect'); }); if (k === 'i' && e.shiftKey) return run(() => { NXI.selInvert(d); U.push('Inverse'); });
      if (k === 'j') return run(() => { if (d.sel) { copy(false); paste(); } else { NXI.duplicate(d, d.activeId); U.push('Duplicate layer'); } });
      if (k === 'e') return run(() => { if (e.shiftKey) { NXI.mergeVisible(d); U.push('Merge Visible'); } else if (NXI.mergeDown(d, d.activeId)) U.push('Merge Down'); });
      if (k === 'g') return run(() => { if (e.altKey) { const L = NXI.active(d); if (L) { L.clip = !L.clip; NXI.dirty(d, L); U.push('Clipping mask'); } } else if (e.shiftKey) { NXI.ungroup(d, d.activeId); U.push('Ungroup'); } else { NXI.groupLayers(d, d.multi.length ? d.multi : [d.activeId]); U.push('Group'); } });
      if (k === 't') return run(() => { setTool('move', true); TL().transformBegin('free'); });
      if (k === 'c') return run(() => copy(e.shiftKey)); if (k === 'x') return run(() => copy(false, true)); if (k === 'v') return run(paste);
      if (k === '0') return run(U.fit); if (k === '1') return run(setZoom, 1); if (k === '=' || k === '+') return run(() => U.zoomAt({ x: d.w / 2, y: d.h / 2 }, 1.25)); if (k === '-') return run(() => U.zoomAt({ x: d.w / 2, y: d.h / 2 }, .8));
      if (e.shiftKey && k === 'n') return run(() => { NXI.insert(d, NXI.mkLayer(d, 'raster', { name: 'Layer ' + (NXI.countLayers(d) + 1) })); U.push('New layer'); });
      if (k === ']') return run(() => { NXI.moveBy(d, d.activeId, 1); U.push('Arrange'); }); if (k === '[') return run(() => { NXI.moveBy(d, d.activeId, -1); U.push('Arrange'); });
      if (k === 'backspace') return run(() => fillWith(d, d.bg)); return;
    }
    const tool = TL().T[U.tool];
    if (e.key === 'Enter') { if (TL().transforming) return run(() => TL().transformCommit()); if (tool.enter) return run(() => tool.enter()); return; }
    if (e.key === 'Escape') { if (TL().transforming) return run(() => TL().transformCancel()); if (tool.cancel) return run(() => tool.cancel()); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (e.altKey) return run(() => fillWith(d, d.fg)); return run(clearPixels, d); }
    if (e.key.startsWith('Arrow') && U.tool === 'move') { const st = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0; const L = NXI.active(d); if (L && !L.locked) return run(() => { NXI.walk([L], q => { if (q.tr) { q.tr.x += dx; q.tr.y += dy; } else if (q.type === 'raster') { q.x += dx; q.y += dy; } q.v++; }); NXI.dirty(d); U.push('Nudge'); }); }
    if (k === 'x') return run(() => { [d.fg, d.bg] = [d.bg, d.fg]; refreshColor(); }); if (k === 'd' && !e.shiftKey) return run(() => { d.fg = '#000000'; d.bg = '#ffffff'; refreshColor(); });
    if (k === '[' || k === ']') { const key = { brush: 'brush', pencil: 'pencil', eraser: 'eraser', clone: 'clone', heal: 'heal', spot: 'spot', blur: 'retouch', sharpen: 'retouch', smudge: 'retouch', dodge: 'dodge', burn: 'dodge', sponge: 'sponge', liquify: 'liquify' }[U.tool]; if (key) return run(() => { const o = O()[key]; o.size = clamp(Math.round(o.size * (k === ']' ? 1.2 : .83) + (k === ']' ? 1 : 0)), 1, 2000); buildOptions(); U.render(); }); }
    // tool keys: plain key picks the group's tool (keeping the current one if it is in the group); Shift+key cycles the group
    const group = TL().ORDER.filter(id => TL().T[id].key.toLowerCase() === k); if (group.length && !e.altKey) { const i = group.indexOf(U.tool); return run(setTool, i < 0 ? group[0] : e.shiftKey ? group[(i + 1) % group.length] : U.tool); }
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') { U.space = false; if (over) over.style.cursor = U.tool === 'hand' ? 'grab' : 'crosshair'; } });
  function fillWith(d, color) { const L = NXI.active(d); if (!L || L.type !== 'raster') return toast('Select a pixel layer.'); const tgt = d.target === 'mask' && L.mask ? L.mask.canvas : L.canvas, full = NXI.clone(tgt), x = full.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, full.width, full.height); NXI.commitMasked(d, L, tgt, full); NXI.dirty(d, L); U.push('Fill'); }

  U.commands = () => [
    { title: 'Image: New image…', run: () => { Shell.go('image'); newDocDialog(); } }, { title: 'Image: Open file…', run: async () => { Shell.go('image'); openFiles(await pickFiles('image/*,.nxi,.tif,.tiff,.psd', true)); } },
    { title: 'Image: Export as…', run: () => { Shell.go('image'); exportDialog(); } }, { title: 'Image: Place in Edit timeline', run: need(placeInEdit) },
    ...TL().ORDER.map(id => ({ title: 'Image tool: ' + TL().T[id].name, run: () => { Shell.go('image'); setTool(id); } })),
    ...Object.keys(NXI.filters.defs).map(k => ({ title: 'Image filter: ' + NXI.filters.defs[k].name, run: () => { Shell.go('image'); filterDialog(k); } })),
    ...Object.keys(ADJ.defs).map(k => ({ title: 'Image adjustment layer: ' + ADJ.defs[k].name, run: () => { Shell.go('image'); addAdjustLayer(k); } })),
    { title: 'Image: Free Transform', run: need(() => TL().transformBegin('free')) }, { title: 'Image: Content-Aware Fill', run: need(async d => { try { await NXI.filters.contentAwareFill(d); afterChange(); } catch (e) { toast(e.message); } }) },
    ...Object.keys(LAYOUTS).map(k => ({ title: 'Image layout: ' + k, run: () => { Shell.go('image'); applyLayout(k); } }))
  ];
  U.newDocDialog = newDocDialog; U.openFiles = openFiles; U.exportDialog = exportDialog; U.placeInEdit = placeInEdit; U.refreshAll = () => refreshAll(); U.undo = () => { if (U.doc) { NXI.undo(U.doc); afterChange(); } }; U.redo = () => { if (U.doc) { NXI.redo(U.doc); afterChange(); } };
  return U;
})();
