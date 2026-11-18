'use strict';
/* ====================== NEXORA Blocks page (UI) ======================
   Textures: pixel editor (pencil, eraser, fill, picker, line, rectangle, mirror, wrap-shift, flip / rotate),
   palette + recent colours, 3×3 tiling preview, undo / redo.   Models: Minecraft-style boxes with a live 3D
   preview (three.js, pixel-exact textures, drag to orbit).   Pack & export: resource pack, atlas, OBJ, PNGs. */
const BlocksMode = (() => {
  const B = Blocks, S = { root: null, tab: 'tex', tex: null, model: null, el: null, tool: 'pencil', color: '#5cb8ff', alpha: 255, mirror: false, grid: true, zoom: 0, recent: [], undo: [], redo: [], hover: null, drag: null, three: null };
  const PALETTE = ['#000000', '#1d1d21', '#3a3f47', '#6b737d', '#a6adb6', '#e6eaee', '#ffffff', '#5cb8ff', '#2f6fb8', '#1d3d73', '#9ad6ff', '#7a4a2a', '#a8743f', '#d9a066', '#3f7f3a', '#6fbf4a', '#b7e07a', '#8a1c1c', '#d23c3c', '#ff8a5c', '#e8c547', '#6a3fa0', '#c06cff', '#ff7ab8'];
  const TOOLS = [['pencil', 'Pencil', 'B'], ['eraser', 'Eraser', 'E'], ['fill', 'Fill', 'G'], ['picker', 'Pick colour', 'I'], ['line', 'Line', 'L'], ['rect', 'Rectangle', 'R'], ['rectf', 'Filled rectangle', 'Shift+R']];
  const st = () => B.store(), texs = () => Object.values(st().textures), models = () => Object.values(st().models);
  const touch = () => { if (typeof Recovery !== 'undefined') Recovery.touch(); };

  function enter(root) {
    S.root = root; root.classList.add('bk-ws');
    if (!S.tex || !st().textures[S.tex.id]) S.tex = texs()[0] || null;
    if (!S.model || !st().models[S.model.id]) S.model = models()[0] || null;
    B.onLoaded = () => { drawPix(); drawTile(); redraw3d(); list(); };
    render();
  }
  /* ---------- layout ---------- */
  function render() {
    const r = S.root; if (!r) return; r.innerHTML = '';
    // keep a valid selection even when textures / models were added or removed elsewhere (undo, AI, another tab)
    if (!S.tex || !st().textures[S.tex.id]) S.tex = texs()[0] || null;
    if (!S.model || !st().models[S.model.id]) S.model = models()[0] || null;
    const tab = (k, n) => el('button', { class: S.tab === k ? 'on' : '', onclick: () => { S.tab = k; render(); } }, n);
    r.append(el('div', { class: 'abar bk-bar' }, el('b', {}, 'Blocks'), el('div', { class: 'seg bk-tabs' }, tab('tex', 'Textures'), tab('model', 'Models'), tab('pack', 'Pack & export')), el('div', { class: 'spacer' }),
      el('span', { class: 'dim' }, `${texs().length} texture${texs().length === 1 ? '' : 's'} · ${models().length} model${models().length === 1 ? '' : 's'}`)));
    const body = el('div', { class: 'bk-body bk-' + S.tab }); r.append(body);
    if (S.tab === 'tex') texPage(body); else if (S.tab === 'model') modelPage(body); else packPage(body);
  }
  function list() {
    const h = S.root && S.root.querySelector('.bk-list'); if (!h) return; h.innerHTML = '';
    if (!texs().length) h.append(el('div', { class: 'dim bk-empty' }, 'No textures yet. Create one above or import a PNG.'));
    for (const t of texs()) {
      const th = el('canvas', { width: 32, height: 32, class: 'bk-th' }), x = th.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(B.canvasOf(t), 0, 0, 32, 32);
      h.append(el('div', { class: 'bk-item' + (S.tex === t ? ' on' : ''), onclick: () => { S.tex = t; S.undo = []; S.redo = []; S.zoom = 0; render(); } }, th, el('div', {}, el('b', {}, t.name), el('small', {}, `${t.path}.png · ${t.w}×${t.h}`)),
        el('button', { class: 'bk-x', title: 'Delete texture', onclick: e => { e.stopPropagation(); if (!confirm(`Delete "${t.name}"?`)) return; B.removeTexture(t.id); if (S.tex === t) S.tex = texs()[0] || null; render(); } }, '✕')));
    }
  }
  /* ---------- textures ---------- */
  function texPage(body) {
    const size = el('select', { title: 'Size in pixels' }, ...[16, 32, 64, 128, 256].map(n => el('option', { value: n }, `${n}×${n}`))), tpl = el('select', { title: 'Start from' }, ...['blank', 'stone', 'planks', 'ore', 'grass', 'metal', 'skin'].map(n => el('option', { value: n }, n === 'skin' ? 'Player skin (64×64)' : n[0].toUpperCase() + n.slice(1))));
    const file = el('input', { type: 'file', accept: 'image/png,image/*', multiple: '', hidden: '' }); file.onchange = async () => { for (const f of file.files) { try { S.tex = await B.importPNG(f); } catch (e) { toast(e.message); } } file.value = ''; render(); };
    const left = el('div', { class: 'bk-side' }, el('div', { class: 'bk-new' }, size, tpl, el('button', { class: 'primary', onclick: () => { S.tex = B.newTexture({ w: tpl.value === 'skin' ? 64 : +size.value, path: tpl.value === 'skin' ? 'entity/skin_' + (Date.now() % 1e5) : undefined, template: tpl.value, seed: Math.random() * 1e6 | 0, name: tpl.value === 'blank' ? undefined : tpl.value[0].toUpperCase() + tpl.value.slice(1) }); S.undo = []; S.redo = []; S.zoom = 0; render(); } }, 'New')),
      el('button', { class: 'ibtn bk-imp', onclick: () => file.click() }, Icon('import', 14), 'Import PNG'), file, el('div', { class: 'bk-list' }));
    const stage = el('div', { class: 'bk-stage' }); S.cv = el('canvas', { class: 'bk-pix' }); stage.append(S.cv);
    body.append(left, stage, texPanel()); list(); bindPix(stage); requestAnimationFrame(() => { fitZoom(); drawPix(); drawTile(); });
    new ResizeObserver(() => { if (S.tab === 'tex') { fitZoom(true); drawPix(); } }).observe(stage);
  }
  function texPanel() {
    const t = S.tex, p = el('div', { class: 'bk-panel' }); if (!t) { p.append(el('div', { class: 'dim' }, 'Create or import a texture to start painting.')); return p; }
    p.append(el('h5', {}, 'Tools'), el('div', { class: 'bk-tools' }, ...TOOLS.map(([k, n, key]) => el('button', { class: S.tool === k ? 'on' : '', title: `${n} (${key})`, onclick: () => { S.tool = k; render(); } }, n))),
      el('label', { class: 'au-check' }, el('input', { type: 'checkbox', checked: S.mirror ? '' : undefined, onchange: e => S.mirror = e.target.checked }), 'Mirror left ↔ right'),
      el('label', { class: 'au-check' }, el('input', { type: 'checkbox', checked: S.grid ? '' : undefined, onchange: e => { S.grid = e.target.checked; drawPix(); } }), 'Pixel grid'),
      el('h5', {}, 'Colour'), el('div', { class: 'bk-color' }, el('input', { type: 'color', value: S.color, oninput: e => { S.color = e.target.value; swatch(); } }), el('label', {}, 'Alpha ', el('input', { type: 'range', min: 0, max: 255, value: S.alpha, oninput: e => S.alpha = +e.target.value }))),
      el('div', { class: 'bk-pal' }, ...PALETTE.map(c => el('button', { style: `background:${c}`, title: c, onclick: () => { S.color = c; S.alpha = 255; render(); } }))),
      S.recent.length ? el('div', { class: 'bk-pal bk-recent' }, ...S.recent.map(c => el('button', { style: `background:${c}`, title: 'Recent ' + c, onclick: () => { S.color = c; render(); } }))) : '',
      el('h5', {}, 'Texture'), el('div', { class: 'bk-ops' }, ...[['flipH', 'Flip ↔'], ['flipV', 'Flip ↕'], ['rotate', 'Rotate 90°'], ['shiftL', '←'], ['shiftR', '→'], ['shiftU', '↑'], ['shiftD', '↓']].map(([op, n]) => el('button', { title: op.startsWith('shift') ? 'Shift by one pixel, wrapping around (shows tiling seams)' : n, disabled: op === 'rotate' && t.w !== t.h ? '' : undefined, onclick: () => { snap(); B.transform(B.canvasOf(t), op); commitTex(); } }, n))),
      el('div', { class: 'bk-ops' }, el('button', { onclick: undo, title: 'Undo (Ctrl+Z)' }, 'Undo'), el('button', { onclick: redo, title: 'Redo (Ctrl+Y)' }, 'Redo'), el('button', { onclick: () => download(dataBlob(B.canvasOf(t)), B.slug(t.name) + '.png') }, 'Save PNG')),
      el('div', { class: 'vrow' }, el('span', {}, 'Name'), el('input', { value: t.name, onchange: e => { t.name = e.target.value; touch(); list(); } })),
      el('div', { class: 'vrow' }, el('span', {}, 'Path'), el('input', { value: t.path, title: 'Where it goes in a pack, e.g. block/stone or item/ruby', onchange: e => { t.path = e.target.value.replace(/\.png$/i, '').replace(/^\/+/, ''); touch(); list(); } })),
      el('h5', {}, 'Tiling preview'), S.tile = el('canvas', { class: 'bk-tile', width: 192, height: 192 }), animPanel(t),
      t.w === 64 && (t.h === 64 || t.h === 32) ? el('button', { class: 'bk-skin', title: 'Show this texture on a player-shaped model', onclick: () => { S.model = BlocksX.skinPreview(t.id); S.tab = 'model'; touch(); render(); } }, 'Preview as player skin') : '');
    return p;
  }
  /* animation: frames stacked top to bottom, a live preview at the game's speed (20 ticks a second) */
  function animPanel(t) {
    clearInterval(S.animTimer); const n = BlocksX.frames(t), sq = t.h % t.w === 0, box = el('div', { class: 'bk-anim' }, el('h5', {}, 'Animation'));
    if (!sq) { box.append(el('div', { class: 'dim bk-note' }, 'Animated textures are square frames stacked top to bottom; this one is not a whole number of frames.')); return box; }
    const pv = el('canvas', { class: 'bk-tile bk-apv', width: 96, height: 96 }), x = pv.getContext('2d');
    const set = k => { try { S.undo = []; S.redo = []; BlocksX.setFrames(t, k); S.zoom = 0; render(); } catch (e) { toast(e.message); } };
    box.append(el('div', { class: 'bk-ops' }, el('span', { class: 'dim' }, n > 1 ? n + ' frames' : 'Still'), el('button', { onclick: () => set(n + 1), title: 'Add a frame below (a copy of the last one)' }, '+ Frame'), el('button', { disabled: n > 1 ? undefined : '', onclick: () => set(n - 1), title: 'Remove the last frame' }, '− Frame')));
    if (n > 1) { box.append(el('div', { class: 'vrow' }, el('span', {}, 'Frame time'), el('input', { type: 'number', min: 1, max: 200, value: t.anim.frametime, title: 'Game ticks per frame (20 ticks = 1 second)', onchange: e => { t.anim.frametime = clamp(+e.target.value | 0, 1, 200); touch(); render(); } })),
      el('label', { class: 'au-check' }, el('input', { type: 'checkbox', checked: t.anim.interpolate ? '' : undefined, onchange: e => { t.anim.interpolate = e.target.checked; touch(); } }), 'Blend between frames'), pv);
      let tick = 0; S.animTimer = setInterval(() => { if (!pv.isConnected) return clearInterval(S.animTimer); tick++; const ft = Math.max(1, t.anim.frametime | 0); BlocksX.drawFrame(t, x, Math.floor(tick / ft), (tick % ft) / ft); }, 50); }
    return box;
  }
  const dataBlob = c => { const s = atob(c.toDataURL('image/png').split(',')[1]), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Blob([u], { type: 'image/png' }); };
  function swatch() { }
  function fitZoom(keep) { const t = S.tex, st_ = S.cv && S.cv.parentElement; if (!t || !st_) return; const r = st_.getBoundingClientRect(), fit = Math.max(1, Math.floor(Math.min((r.width - 40) / t.w, (r.height - 40) / t.h))); if (!keep || !S.zoom) S.zoom = fit; }
  function drawPix() {
    const t = S.tex, cv = S.cv; if (!t || !cv) return; const z = S.zoom || 8, W = t.w * z, H = t.h * z; if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; const ck = Math.max(4, z / 2);
    for (let yy = 0; yy < H; yy += ck) for (let xx = 0; xx < W; xx += ck) { x.fillStyle = ((xx / ck + yy / ck) & 1) ? '#2a2f36' : '#1c2026'; x.fillRect(xx, yy, ck, ck); }
    x.drawImage(previewCanvas(), 0, 0, W, H);
    if (S.grid && z >= 6) { x.strokeStyle = '#ffffff1a'; x.lineWidth = 1; x.beginPath(); for (let i = 1; i < t.w; i++) { x.moveTo(i * z + .5, 0); x.lineTo(i * z + .5, H); } for (let j = 1; j < t.h; j++) { x.moveTo(0, j * z + .5); x.lineTo(W, j * z + .5); } x.stroke(); }
    if (S.hover) { x.strokeStyle = '#5cb8ff'; x.lineWidth = 2; x.strokeRect(S.hover[0] * z + 1, S.hover[1] * z + 1, z - 2, z - 2); if (S.mirror) { x.strokeStyle = '#5cb8ff77'; x.strokeRect((t.w - 1 - S.hover[0]) * z + 1, S.hover[1] * z + 1, z - 2, z - 2); } }
  }
  /** the texture plus an in-progress line / rectangle preview */
  function previewCanvas() {
    const c = B.canvasOf(S.tex); if (!S.drag || !['line', 'rect', 'rectf'].includes(S.tool)) return c;
    const p = mkCanvas(c.width, c.height), x = p.getContext('2d'); x.drawImage(c, 0, 0); const id = x.getImageData(0, 0, c.width, c.height), col = curRGBA(), [a, b] = [S.drag.from, S.drag.to];
    if (S.tool === 'line') B.stroke(id, a[0], a[1], b[0], b[1], col, S.mirror); else B.rect(id, a[0], a[1], b[0], b[1], col, S.tool === 'rectf', S.mirror); x.putImageData(id, 0, 0); return p;
  }
  function drawTile() { const t = S.tex, c = S.tile; if (!t || !c) return; const x = c.getContext('2d'), k = Math.min(c.width / (t.w * 3), c.height / (t.h * 3)); x.clearRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) x.drawImage(B.canvasOf(t), i * t.w * k, j * t.h * k, t.w * k, t.h * k); }
  const curRGBA = () => { if (S.tool === 'eraser') return [0, 0, 0, 0]; const c = B.rgbaOf(S.color); c[3] = S.alpha; return c; };
  function snap() { const c = B.canvasOf(S.tex); S.undo.push(c._ctx.getImageData(0, 0, c.width, c.height)); if (S.undo.length > 60) S.undo.shift(); S.redo = []; }
  function undo() { const c = S.tex && B.canvasOf(S.tex); if (!c || !S.undo.length) return; S.redo.push(c._ctx.getImageData(0, 0, c.width, c.height)); c._ctx.putImageData(S.undo.pop(), 0, 0); commitTex(); }
  function redo() { const c = S.tex && B.canvasOf(S.tex); if (!c || !S.redo.length) return; S.undo.push(c._ctx.getImageData(0, 0, c.width, c.height)); c._ctx.putImageData(S.redo.pop(), 0, 0); commitTex(); }
  function commitTex() { B.save(S.tex); drawPix(); drawTile(); list(); if (!S.recent.includes(S.color) && S.tool !== 'eraser') { S.recent.unshift(S.color); S.recent = S.recent.slice(0, 12); } }
  function bindPix(stage) {
    const at = e => { const r = S.cv.getBoundingClientRect(), z = r.width / S.tex.w; return [Math.floor((e.clientX - r.left) / z), Math.floor((e.clientY - r.top) / z)]; };
    S.cv.onpointerdown = e => {
      if (!S.tex) return; e.preventDefault(); S.cv.setPointerCapture(e.pointerId); const p = at(e), c = B.canvasOf(S.tex), tool = e.button === 2 ? 'picker' : S.tool;
      if (tool === 'picker') { if (p[0] >= 0 && p[1] >= 0 && p[0] < S.tex.w && p[1] < S.tex.h) { const v = c._ctx.getImageData(p[0], p[1], 1, 1).data; S.color = '#' + [v[0], v[1], v[2]].map(n => n.toString(16).padStart(2, '0')).join(''); S.alpha = v[3] || 255; render(); } return; }
      snap();
      if (tool === 'fill') { const id = c._ctx.getImageData(0, 0, c.width, c.height); B.fill(id, p[0], p[1], curRGBA()); c._ctx.putImageData(id, 0, 0); commitTex(); return; }
      S.drag = { from: p, to: p, last: p };
      if (tool === 'pencil' || tool === 'eraser') { const id = c._ctx.getImageData(0, 0, c.width, c.height); B.stroke(id, p[0], p[1], p[0], p[1], curRGBA(), S.mirror); c._ctx.putImageData(id, 0, 0); drawPix(); }
    };
    S.cv.onpointermove = e => {
      if (!S.tex) return; const p = at(e); S.hover = p;
      if (S.drag) { S.drag.to = p; if (S.tool === 'pencil' || S.tool === 'eraser') { const c = B.canvasOf(S.tex), id = c._ctx.getImageData(0, 0, c.width, c.height); B.stroke(id, S.drag.last[0], S.drag.last[1], p[0], p[1], curRGBA(), S.mirror); c._ctx.putImageData(id, 0, 0); S.drag.last = p; } }
      drawPix();
    };
    S.cv.onpointerup = () => { if (!S.drag) return; const d = S.drag; S.drag = null; if (['line', 'rect', 'rectf'].includes(S.tool)) { const c = B.canvasOf(S.tex), id = c._ctx.getImageData(0, 0, c.width, c.height); if (S.tool === 'line') B.stroke(id, d.from[0], d.from[1], d.to[0], d.to[1], curRGBA(), S.mirror); else B.rect(id, d.from[0], d.from[1], d.to[0], d.to[1], curRGBA(), S.tool === 'rectf', S.mirror); c._ctx.putImageData(id, 0, 0); } commitTex(); };
    S.cv.onpointerleave = () => { S.hover = null; drawPix(); }; S.cv.oncontextmenu = e => e.preventDefault();
    stage.onwheel = e => { if (!S.tex) return; e.preventDefault(); S.zoom = clamp((S.zoom || 8) + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round((S.zoom || 8) / 8)), 1, 64); drawPix(); };
  }
  window.addEventListener('keydown', e => {
    if (!S.root || S.root.classList.contains('hidden') || S.tab !== 'tex' || (e.target.matches && e.target.matches('input,textarea,select'))) return;
    const k = e.key.toLowerCase(); if (e.ctrlKey && k === 'z') { e.preventDefault(); undo(); } else if (e.ctrlKey && k === 'y') { e.preventDefault(); redo(); }
    else if (!e.ctrlKey && !e.altKey) { const t = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker', l: 'line', r: e.shiftKey ? 'rectf' : 'rect' }[k]; if (t) { S.tool = t; render(); } }
  });
  /* ---------- models ---------- */
  function modelPage(body) {
    const left = el('div', { class: 'bk-side' }, el('div', { class: 'bk-new' }, el('button', { class: 'primary', onclick: () => { S.model = B.newModel({ kind: 'block', tex: S.tex && S.tex.id }); S.el = S.model.elements[0]; render(); } }, '+ Block model'), el('button', { onclick: () => { S.model = B.newModel({ kind: 'item', tex: S.tex && S.tex.id, path: 'item/' + B.slug((S.tex && S.tex.name) || 'item') }); render(); } }, '+ Item')));
    const ml = el('div', { class: 'bk-list' }); left.append(ml);
    for (const m of models()) ml.append(el('div', { class: 'bk-item' + (S.model === m ? ' on' : ''), onclick: () => { S.model = m; S.el = m.elements[0] || null; render(); } }, el('div', {}, el('b', {}, m.name), el('small', {}, `${m.path}.json · ${m.kind === 'item' ? 'flat item' : m.elements.length + ' box' + (m.elements.length === 1 ? '' : 'es')}`)),
      el('button', { class: 'bk-x', title: 'Delete model', onclick: e => { e.stopPropagation(); if (!confirm(`Delete "${m.name}"?`)) return; delete st().models[m.id]; if (S.model === m) S.model = models()[0] || null; touch(); render(); } }, '✕')));
    if (!models().length) ml.append(el('div', { class: 'dim bk-empty' }, 'No models yet. A block model starts as one full cube with the selected texture.'));
    const stage = el('div', { class: 'bk-stage bk-3d' }); S.v3 = el('canvas', { class: 'bk-view' }); stage.append(S.v3, el('div', { class: 'bk-hint dim' }, 'Drag to orbit · wheel to zoom'));
    body.append(left, stage, modelPanel()); bind3d(); setup3d();
  }
  function texSelect(val, on, none) { return el('select', { onchange: e => on(e.target.value) }, el('option', { value: '' }, none || '— none —'), ...texs().map(t => el('option', { value: t.id, selected: t.id === val ? '' : undefined }, t.name))); }
  function modelPanel() {
    const m = S.model, p = el('div', { class: 'bk-panel' }); if (!m) { p.append(el('div', { class: 'dim' }, 'Create a model on the left.')); return p; }
    const chg = () => { touch(); redraw3d(); };
    p.append(el('div', { class: 'vrow' }, el('span', {}, 'Name'), el('input', { value: m.name, onchange: e => { m.name = e.target.value; chg(); render(); } })), el('div', { class: 'vrow' }, el('span', {}, 'Path'), el('input', { value: m.path, onchange: e => { m.path = e.target.value.replace(/\.json$/i, ''); chg(); render(); } })));
    if (m.kind === 'item') { p.append(el('h5', {}, 'Item texture'), texSelect(m.item, v => { m.item = v; chg(); })); return p; }
    if (m.skin) { const re = o => { BlocksX.skinPreview(null, o); chg(); render(); };
      p.append(el('div', { class: 'dim bk-note' }, 'Preview only: this model is not exported. Paint the skin on the Textures tab and it updates here.'), el('h5', {}, 'Skin'), texSelect(m.skin.skin, v => re({ skin: v })),
        el('label', { class: 'au-check' }, el('input', { type: 'checkbox', checked: m.skin.slim ? '' : undefined, onchange: e => re({ slim: e.target.checked }) }), 'Slim arms (3 px)'),
        el('label', { class: 'au-check' }, el('input', { type: 'checkbox', checked: m.skin.outer !== false ? '' : undefined, onchange: e => re({ outer: e.target.checked }) }), 'Outer layer (hat, jacket, sleeves)'),
        el('h5', {}, 'Armour'), texSelect(m.skin.armour, v => re({ armour: v }), 'No armour'), el('div', { class: 'dim bk-note' }, 'A 64×32 armour texture (helmet, chestplate, boots layout), drawn 1 px out.')); return p; }
    if (!S.el || !m.elements.includes(S.el)) S.el = m.elements[0] || null;
    p.append(el('h5', {}, 'Boxes'), el('div', { class: 'bk-els' }, ...m.elements.map(e => el('button', { class: e === S.el ? 'on' : '', onclick: () => { S.el = e; render(); } }, e.name))),
      el('div', { class: 'bk-ops' }, el('button', { onclick: () => { const e = B.newElement({ name: 'Box ' + (m.elements.length + 1), from: [4, 0, 4], to: [12, 8, 12], tex: S.el && S.el.faces.north.tex }); m.elements.push(e); S.el = e; chg(); render(); } }, '+ Box'),
        el('button', { disabled: S.el ? undefined : '', onclick: () => { const e = JSON.parse(JSON.stringify(S.el)); e.id = 'el' + uid(); e.name += ' copy'; m.elements.push(e); S.el = e; chg(); render(); } }, 'Duplicate'),
        el('button', { disabled: S.el && m.elements.length > 1 ? undefined : '', onclick: () => { m.elements.splice(m.elements.indexOf(S.el), 1); S.el = m.elements[0]; chg(); render(); } }, 'Delete')));
    const e = S.el; if (!e) return p;
    const num = (arr, i, lab) => el('label', { class: 'bk-num' }, lab, el('input', { type: 'number', step: .5, min: -16, max: 32, value: arr[i], onchange: ev => { arr[i] = clamp(+ev.target.value || 0, -16, 32); chg(); } }));
    p.append(el('div', { class: 'vrow' }, el('span', {}, 'Box name'), el('input', { value: e.name, onchange: ev => { e.name = ev.target.value; chg(); render(); } })),
      el('h5', {}, 'From (x, y, z)'), el('div', { class: 'bk-xyz' }, num(e.from, 0, 'X'), num(e.from, 1, 'Y'), num(e.from, 2, 'Z')),
      el('h5', {}, 'To (x, y, z)'), el('div', { class: 'bk-xyz' }, num(e.to, 0, 'X'), num(e.to, 1, 'Y'), num(e.to, 2, 'Z')),
      el('div', { class: 'dim bk-note' }, 'A full block is 0 to 16 on each axis.'),
      el('h5', {}, 'Textures'), el('div', { class: 'vrow' }, el('span', {}, 'All faces'), texSelect('', v => { for (const f of B.FACES) e.faces[f].tex = v; chg(); render(); }, 'Set all…')),
      ...B.FACES.map(f => el('div', { class: 'vrow' }, el('span', {}, f[0].toUpperCase() + f.slice(1)), texSelect(e.faces[f].tex, v => { e.faces[f].tex = v; chg(); }))));
    return p;
  }
  /* three.js preview */
  async function setup3d() {
    if (typeof ThreeD === 'undefined') return; await ThreeD.load(); const T3 = window.THREE; if (!S.v3) return;
    if (!S.three || S.three.canvas !== S.v3) {
      const r = new T3.WebGLRenderer({ canvas: S.v3, antialias: true, alpha: true }); r.setPixelRatio(devicePixelRatio || 1);
      const sc = new T3.Scene(), cam = new T3.PerspectiveCamera(40, 1, .01, 100); sc.add(new T3.AmbientLight(0xffffff, .75)); const dl = new T3.DirectionalLight(0xffffff, .9); dl.position.set(3, 5, 4); sc.add(dl);
      const grid = new T3.GridHelper(1, 16, 0x5cb8ff, 0x2a3442); grid.position.y = -.5; sc.add(grid);
      S.three = { canvas: S.v3, r, sc, cam, group: null, az: 35, el: 25, dist: 2.6, texs: new Map() };
    }
    redraw3d();
  }
  function texFor(id) {
    const T3 = window.THREE, t = st().textures[id]; if (!t) return null; let e = S.three.texs.get(id); const c = B.canvasOf(t);
    if (!e || e.c !== c) { const tx = new T3.CanvasTexture(c); tx.magFilter = tx.minFilter = T3.NearestFilter; tx.generateMipmaps = false; if ('colorSpace' in tx) tx.colorSpace = T3.SRGBColorSpace; e = { tx, c, v: -1 }; S.three.texs.set(id, e); }
    if (e.v !== t.v) { e.tx.needsUpdate = true; e.v = t.v; } return e.tx;
  }
  function redraw3d() {
    const k = S.three, T3 = window.THREE; if (!k || !T3 || !S.v3 || S.tab !== 'model') return;
    const box = S.v3.parentElement.getBoundingClientRect(); k.r.setSize(Math.max(50, box.width), Math.max(50, box.height), false); S.v3.style.width = box.width + 'px'; S.v3.style.height = box.height + 'px'; k.cam.aspect = box.width / Math.max(1, box.height); k.cam.updateProjectionMatrix();
    if (k.group) { k.sc.remove(k.group); k.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); }
    k.group = new T3.Group(); const m = S.model;
    if (m) {
      const els = m.kind === 'item' ? [Object.assign(B.newElement({ tex: m.item }), { from: [0, 0, 7.5], to: [16, 16, 8.5] })] : m.elements;
      const ORDER = ['east', 'west', 'up', 'down', 'south', 'north'];   // BoxGeometry material groups
      for (const e of els) {
        const s = [0, 1, 2].map(i => Math.max(.001, (e.to[i] - e.from[i]) / 16)), g = new T3.BoxGeometry(s[0], s[1], s[2]), uv = g.attributes.uv;
        ORDER.forEach((f, gi) => { const [u1, v1, u2, v2] = B.faceUV(e, f), q = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]]; q.forEach(([u, v], j) => uv.setXY(gi * 4 + j, u / 16, 1 - v / 16)); });
        uv.needsUpdate = true;
        const mats = ORDER.map(f => { const tx = e.faces[f] && e.faces[f].tex ? texFor(e.faces[f].tex) : null; return tx ? new T3.MeshLambertMaterial({ map: tx, transparent: true, alphaTest: .05, side: m.kind === 'item' ? T3.DoubleSide : T3.FrontSide }) : new T3.MeshLambertMaterial({ color: e === S.el ? 0x2f6fb8 : 0x3a4552, transparent: m.kind === 'item', opacity: m.kind === 'item' ? 0 : 1 }); });
        const mesh = new T3.Mesh(g, mats); mesh.position.set((e.from[0] + e.to[0]) / 32 - .5, (e.from[1] + e.to[1]) / 32 - .5, (e.from[2] + e.to[2]) / 32 - .5); k.group.add(mesh);
        if (e === S.el && m.kind !== 'item' && m.elements.length > 1) { const edges = new T3.LineSegments(new T3.EdgesGeometry(g), new T3.LineBasicMaterial({ color: 0x9ad6ff })); edges.position.copy(mesh.position); k.group.add(edges); }
      }
    }
    if (m && m.skin) { k.group.scale.setScalar(.5); k.group.position.y = -.25; }
    k.sc.add(k.group);
    const a = k.az * Math.PI / 180, b = k.el * Math.PI / 180; k.cam.position.set(Math.sin(a) * Math.cos(b) * k.dist, Math.sin(b) * k.dist, Math.cos(a) * Math.cos(b) * k.dist); k.cam.lookAt(0, 0, 0); k.r.render(k.sc, k.cam);
  }
  function bind3d() {
    let d = null; S.v3.onpointerdown = e => { d = { x: e.clientX, y: e.clientY, az: S.three ? S.three.az : 35, el: S.three ? S.three.el : 25 }; S.v3.setPointerCapture(e.pointerId); };
    S.v3.onpointermove = e => { if (!d || !S.three) return; S.three.az = d.az - (e.clientX - d.x) * .5; S.three.el = clamp(d.el + (e.clientY - d.y) * .4, -85, 85); redraw3d(); };
    S.v3.onpointerup = () => d = null; S.v3.onwheel = e => { e.preventDefault(); if (!S.three) return; S.three.dist = clamp(S.three.dist * (e.deltaY > 0 ? 1.1 : .9), .8, 12); redraw3d(); };
    new ResizeObserver(() => redraw3d()).observe(S.v3.parentElement);
  }
  /* ---------- pack & export ---------- */
  function packPage(body) {
    const pk = st().pack, chg = () => touch();
    const known = B.PACK_FORMATS.some(([, n]) => n === +pk.format);
    const fmt = el('div', { class: 'bk-fmt' }, el('select', { onchange: e => { if (e.target.value) { pk.format = +e.target.value; chg(); render(); } } },
      ...B.PACK_FORMATS.map(([v, n]) => el('option', { value: n, selected: +pk.format === n ? '' : undefined }, `Java ${v}`)), el('option', { value: '', selected: known ? undefined : '' }, 'Other version')),
      el('input', { type: 'number', min: 1, max: 999, value: pk.format, title: 'pack_format number', onchange: e => { const v = Math.round(+e.target.value); if (v > 0) { pk.format = v; chg(); render(); } } }));
    const busy = async (fn, name) => { try { const r = await fn(); if (r) download(r.blob || r, name); } catch (e) { toast(e.message || String(e)); } };
    const files = el('pre', { class: 'bk-files' }, 'Building file list…');
    B.resourcePack().then(r => files.textContent = r.files.join('\n')).catch(e => files.textContent = e.message);
    body.append(el('div', { class: 'bk-pack' },
      el('section', {}, el('h4', {}, 'Minecraft resource pack'), el('p', { class: 'dim' }, 'Texture packs work as-is: put the zip in .minecraft/resourcepacks. Use the namespace minecraft to replace the game\'s own textures, or your mod id for a mod\'s assets (the mod\'s code is up to you).'),
        el('div', { class: 'vrow' }, el('span', {}, 'Pack name'), el('input', { value: pk.name, onchange: e => { pk.name = e.target.value; chg(); } })),
        el('div', { class: 'vrow' }, el('span', {}, 'Description'), el('input', { value: pk.description, onchange: e => { pk.description = e.target.value; chg(); } })),
        el('div', { class: 'vrow' }, el('span', {}, 'Game version'), fmt), el('div', { class: 'dim bk-note' }, 'The number is the pack_format. Newer game versions use higher numbers: type it in (the Minecraft wiki lists them).'),
        el('div', { class: 'vrow' }, el('span', {}, 'Namespace'), el('input', { value: pk.namespace, title: 'minecraft (override the game) or your mod id', onchange: e => { pk.namespace = B.slug(e.target.value).replace(/[\/]/g, '') || 'minecraft'; chg(); render(); } })),
        el('div', { class: 'vrow' }, el('span', {}, 'Pack icon'), texSelect(pk.icon, v => { pk.icon = v; chg(); }, 'First texture')),
        el('button', { class: 'primary', onclick: () => busy(() => B.resourcePack(), B.slug(pk.name) + '.zip') }, 'Export resource pack (.zip)'), files),
      el('section', {}, el('h4', {}, 'Minecraft Bedrock'), el('p', { class: 'dim' }, 'A .mcpack resource pack: open it and Minecraft imports it. Textures go to textures/blocks and textures/items (by their path), animations become flipbook textures, and block models are included as Bedrock geometry for custom blocks (the behaviour pack that uses them is up to you).'),
        el('button', { class: 'primary', onclick: () => busy(() => BlocksX.bedrockPack(), B.slug(pk.name) + '.mcpack') }, 'Export Bedrock pack (.mcpack)')),
      el('section', {}, el('h4', {}, 'Any game or engine'), el('p', { class: 'dim' }, 'For Godot, Unity, Unreal, Phaser, PixiJS, Roblox and others.'),
        el('button', { onclick: () => busy(async () => { const a = await B.atlas(B.slug(pk.name) + '_atlas'); return Zip.build([{ name: a.json.meta.image, data: Uint8Array.from(atob(a.canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)) }, { name: a.json.meta.image.replace(/\.png$/, '.json'), data: JSON.stringify(a.json, null, 2) }]); }, B.slug(pk.name) + '_atlas.zip') }, 'Sprite atlas (PNG + JSON)'),
        el('button', { disabled: S.model ? undefined : '', onclick: () => busy(() => B.objZip(S.model), B.slug(S.model.name) + '_obj.zip') }, `Model as OBJ + MTL${S.model ? ' (' + S.model.name + ')' : ''}`),
        el('button', { onclick: () => busy(() => B.texturesZip(), B.slug(pk.name) + '_textures.zip') }, 'All textures as PNG (.zip)'),
        el('p', { class: 'dim bk-note' }, 'The atlas JSON uses the TexturePacker "hash" layout. OBJ models are 1 unit per block, Y up, with textures beside them.'))));
  }
  return { S, enter, render, redraw3d };
})();
