'use strict';
/* ====================== NEXORA Vector (paper.js, MIT) ======================
   Resolution-independent artwork: Bézier pen, shapes, text, boolean operations (unite / subtract / intersect /
   exclude), align, arrange, fill / stroke / opacity, SVG import and export.
   Drawings live in the project (P.vectors[id] = { id, name, w, h, json }) and are placed on the timeline as a linked
   image: every edit re-renders the drawing from SVG at full resolution and the timeline updates live. */
const VectorMode = (() => {
  const S = { root: null, scope: null, doc: null, tool: 'select', hist: [], hi: -1, loading: null, sel: null };
  const proj = () => typeof Motion !== 'undefined' ? Motion.editProject() : P;
  const store = () => proj().vectors || (proj().vectors = {});
  const ps = () => S.scope;

  function load() {
    if (window.paper) return Promise.resolve();
    return S.loading || (S.loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/paper-core.min.js'; s.onload = res; s.onerror = () => rej(new Error('vendor/paper-core.min.js missing')); document.head.append(s); }));
  }
  /* ---------- documents ---------- */
  function newDoc(o) {
    o = o || {}; const id = uid(), d = { id, name: o.name || 'Vector ' + (Object.keys(store()).length + 1), w: o.w || proj().w, h: o.h || proj().h, json: null };
    store()[id] = d; return d;
  }
  function open(id) {
    const d = store()[id]; if (!d) return; S.doc = d; const sc = ps(); sc.activate(); sc.project.clear();
    if (d.json) sc.project.importJSON(d.json); if (!sc.project.activeLayer) new sc.Layer();
    S.hist = [d.json]; S.hi = 0; fit(); render();
  }
  function snapshot(label) { const d = S.doc; if (!d) return; d.json = ps().project.exportJSON(); S.hist.length = S.hi + 1; S.hist.push(d.json); if (S.hist.length > 100) S.hist.shift(); S.hi = S.hist.length - 1; sync(); if (typeof Recovery !== 'undefined') Recovery.touch(); refreshInspector(); }
  function undo() { if (S.hi <= 0) return; S.hi--; restore(); }
  function redo() { if (S.hi >= S.hist.length - 1) return; S.hi++; restore(); }
  function restore() { const sc = ps(); sc.project.clear(); if (S.hist[S.hi]) sc.project.importJSON(S.hist[S.hi]); if (!sc.project.activeLayer) new sc.Layer(); S.doc.json = S.hist[S.hi]; sync(); refreshInspector(); }

  /* ---------- rendering to the timeline ---------- */
  function svgOf(d) {
    // render any doc (not just the open one) through a scratch scope so SVG export never disturbs the editor
    const sc = new paper.PaperScope(); const cv = document.createElement('canvas'); cv.width = d.w; cv.height = d.h; sc.setup(cv); sc.view.viewSize = new sc.Size(d.w, d.h);
    if (d.json) sc.project.importJSON(d.json); sc.project.deselectAll();
    const svg = sc.project.exportSVG({ asString: true, bounds: new sc.Rectangle(0, 0, d.w, d.h) }); sc.remove(); if (S.scope) S.scope.activate(); return svg;
  }
  async function rasterize(d, canvas) {
    const svg = svgOf(d), url   /* paper already writes width / height / viewBox for the artboard bounds */ = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { const img = new Image(); img.src = url; await img.decode(); const c = canvas || document.createElement('canvas'); c.width = d.w; c.height = d.h; const x = c.getContext('2d'); x.clearRect(0, 0, d.w, d.h); x.drawImage(img, 0, 0); return c; }
    finally { URL.revokeObjectURL(url); }
  }
  const mediaFor = id => Object.values(media).find(m => m.vec === id) || null;
  /** create (or refresh) the linked image media for a drawing */
  async function publish(d) {
    let m = mediaFor(d.id); const c = await rasterize(d, m && m.img && m.img.getContext ? m.img : null); /* after a reload m.img is a decoded PNG, not a canvas */ const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if (!m) { m = { id: uid(), name: d.name + ' (Vector)', kind: 'image', vec: d.id, w: d.w, h: d.h, dur: 5, img: c, thumb: c.toDataURL('image/png') }; media[m.id] = m; }
    m.img = c; m.blob = blob; m.w = d.w; m.h = d.h; m.name = d.name + ' (Vector)'; if (typeof uiMedia === 'function') uiMedia(); requestRender(); return m;
  }
  let syncT = 0; function sync() { const d = S.doc; if (!d || !mediaFor(d.id)) return; clearTimeout(syncT); syncT = setTimeout(() => publish(d), 120); }
  async function place() { const d = S.doc; if (!d) return; snapshot(); const m = await publish(d); Shell.go('edit'); const L = addMediaLayer(m, T); commit(); toast('Placed on the timeline as a linked drawing — edits update it.'); return L; }
  /** after a project loads: rebuild linked drawings from P.vectors (the PNG in the file is only a fallback) */
  async function relinkAll() { if (!proj().vectors) return; await load(); for (const m of Object.values(media)) if (m.vec && store()[m.vec]) await publish(store()[m.vec]); }

  /* ---------- shapes & operations (also used by tests) ---------- */
  const style = () => ({ fillColor: S.fill, strokeColor: S.strokeOn ? S.stroke : null, strokeWidth: S.strokeW });
  S.fill = '#5cb8ff'; S.stroke = '#ffffff'; S.strokeW = 4; S.strokeOn = false;
  function addShape(kind, r) {
    const sc = ps(), R = new sc.Rectangle(r.x, r.y, r.w, r.h); let it;
    if (kind === 'rect') it = new sc.Path.Rectangle(R, r.radius || 0);
    else if (kind === 'ellipse') it = new sc.Path.Ellipse(R);
    else if (kind === 'polygon') { it = new sc.Path.RegularPolygon(R.center, r.sides || 6, Math.min(R.width, R.height) / 2); }
    else if (kind === 'star') { it = new sc.Path.Star(R.center, r.points || 5, Math.min(R.width, R.height) / 4, Math.min(R.width, R.height) / 2); }
    it.set(style()); return it;
  }
  function addText(str, at) { const sc = ps(), t = new sc.PointText({ point: at, content: str, fillColor: S.fill, fontFamily: 'Segoe UI, Inter, sans-serif', fontWeight: 'bold', fontSize: 96, justification: 'center' }); return t; }
  const selected = () => ps().project.selectedItems.filter(i => i.parent && i.parent.className === 'Layer');
  function boolean(op) {
    const items = selected().filter(i => i.className === 'Path' || i.className === 'CompoundPath'); if (items.length < 2) return toast('Select two or more shapes.');
    items.sort((a, b) => a.index - b.index); let acc = items[0];
    for (let i = 1; i < items.length; i++) { const r = acc[op](items[i], { insert: false }); if (acc !== items[0]) acc.remove(); acc = r; }
    acc.style = items[0].style; items[items.length - 1].parent.insertChild(items[0].index, acc); items.forEach(i => i.remove()); ps().project.deselectAll(); acc.selected = true; snapshot(op); return acc;
  }
  /** gradient fill; parameters kept in item.data.grad so the inspector can edit them again */
  function setGradient(item, g) {
    item.data.grad = g; if (!g || g.type === 'solid') { item.fillColor = g && g.c1 || S.fill; return; }
    const b = item.bounds, a = (g.angle || 0) * Math.PI / 180, r = Math.hypot(b.width, b.height) / 2, c = b.center, sc = ps();
    const origin = g.type === 'radial' ? c : c.subtract(new sc.Point(Math.cos(a), Math.sin(a)).multiply(r)), dest = g.type === 'radial' ? c.add(new sc.Point(r, 0)) : c.add(new sc.Point(Math.cos(a), Math.sin(a)).multiply(r));
    item.fillColor = { gradient: { stops: [[g.c1, 0], [g.c2, 1]], radial: g.type === 'radial' }, origin, destination: dest };
  }
  /** set text along a path: one glyph per character, positioned by arc length and rotated to the tangent */
  function textOnPath(str, path, o) {
    o = Object.assign({ size: 64, offset: 0, spacing: 0, color: S.fill, font: 'Segoe UI, Inter, sans-serif', weight: 'bold' }, o || {}); const sc = ps(), glyphs = [];
    let at = o.offset * path.length;
    for (const ch of str) {
      const probe = new sc.PointText({ content: ch === ' ' ? 'n' : ch, fontSize: o.size, fontFamily: o.font, fontWeight: o.weight, insert: false }), w = probe.bounds.width * (ch === ' ' ? .6 : 1) + o.spacing;
      const mid = at + w / 2; if (mid > path.length) break;
      if (ch !== ' ') { const pt = path.getPointAt(mid), tan = path.getTangentAt(mid), t = new sc.PointText({ point: [0, 0], content: ch, fontSize: o.size, fontFamily: o.font, fontWeight: o.weight, fillColor: o.color, justification: 'center' }); t.position = pt; t.rotate(tan.angle, pt); glyphs.push(t); }
      at += w;
    }
    const g = new sc.Group([path, ...glyphs]); g.data.textOnPath = { str, size: o.size }; path.data.isGuide = true; path.fillColor = null; path.strokeColor = null; return g;   /* the path becomes an invisible guide, like text-on-path in other editors */
  }
  function align(how) {
    const it = selected(); if (!it.length) return; const B = it.length > 1 ? it.reduce((a, i) => a.unite(i.bounds), it[0].bounds) : new (ps().Rectangle)(0, 0, S.doc.w, S.doc.h);
    for (const i of it) { const b = i.bounds; if (how === 'left') i.position.x += B.left - b.left; if (how === 'hcenter') i.position.x += B.center.x - b.center.x; if (how === 'right') i.position.x += B.right - b.right; if (how === 'top') i.position.y += B.top - b.top; if (how === 'vcenter') i.position.y += B.center.y - b.center.y; if (how === 'bottom') i.position.y += B.bottom - b.bottom; }
    snapshot('align');
  }
  function arrange(dir) { for (const i of selected()) dir > 0 ? i.bringToFront() : i.sendToBack(); snapshot('arrange'); }
  function group() { const it = selected(); if (it.length < 2) return; const g = new (ps().Group)(it); ps().project.deselectAll(); g.selected = true; snapshot('group'); }
  function ungroup() { for (const g of selected().filter(i => i.className === 'Group')) { const kids = g.removeChildren(); g.parent.insertChildren(g.index, kids); g.remove(); } snapshot('ungroup'); }
  function del() { selected().forEach(i => i.remove()); snapshot('delete'); }
  function importSVG(text) { const it = ps().project.importSVG(text, { expandShapes: true }); it.fitBounds(new (ps().Rectangle)(0, 0, S.doc.w, S.doc.h).scale(.8)); snapshot('import'); return it; }
  function exportSVG() { download(new Blob([svgOf(S.doc)], { type: 'image/svg+xml' }), S.doc.name.replace(/[^\w\- ]+/g, '') + '.svg'); }

  /* ---------- tools ---------- */
  let drag = null;
  const TOOLS = [['select', 'move', 'Select / move (V)'], ['node', 'pen', 'Edit points (A)'], ['pen', 'pen', 'Pen — click for corners, drag for curves, click the first point to close (P)'], ['rect', 'rect', 'Rectangle (M)'], ['ellipse', 'circle', 'Ellipse (L)'], ['polygon', 'shape', 'Polygon'], ['star', 'star', 'Star'], ['text', 'text', 'Text (T)']];
  function setupTool() {
    const sc = ps(), tool = new sc.Tool(); let pen = null, live = null, start = null, hitSeg = null;
    tool.onMouseDown = e => {
      const t = S.tool; start = e.point;
      if (t === 'select') { const h = sc.project.hitTest(e.point, { fill: true, stroke: true, tolerance: 6 }); let it = h && h.item; while (it && it.parent && it.parent.className !== 'Layer') it = it.parent; if (!e.modifiers.shift && !(it && it.selected)) sc.project.deselectAll(); if (it) it.selected = e.modifiers.shift ? !it.selected : true; drag = it ? 'move' : null; refreshInspector(); }
      else if (t === 'node') { const h = sc.project.hitTest(e.point, { segments: true, handles: true, fill: true, stroke: true, tolerance: 8 }); hitSeg = h; if (h && h.item) { sc.project.deselectAll(); h.item.fullySelected = true; } }
      else if (t === 'pen') { if (pen && pen.segments.length > 2 && e.point.getDistance(pen.firstSegment.point) < 10) { pen.closed = true; pen.fullySelected = false; pen = null; snapshot('pen'); return; } if (!pen) { pen = new sc.Path(style()); if (!pen.fillColor || !S.strokeOn) { pen.strokeColor = S.stroke; pen.strokeWidth = S.strokeW; } pen.fullySelected = true; } pen.add(e.point); }
      else if (t === 'text') { askText('Text', 'TITLE').then(s => { if (s) { addText(s, start); snapshot('text'); } }); }
    };
    tool.onMouseDrag = e => {
      const t = S.tool;
      if (t === 'select' && drag === 'move') sc.project.selectedItems.filter(i => i.parent && i.parent.className === 'Layer').forEach(i => i.position = i.position.add(e.delta));
      else if (t === 'node' && hitSeg) { if (hitSeg.type === 'segment') hitSeg.segment.point = hitSeg.segment.point.add(e.delta); else if (hitSeg.type === 'handle-in') hitSeg.segment.handleIn = hitSeg.segment.handleIn.add(e.delta); else if (hitSeg.type === 'handle-out') hitSeg.segment.handleOut = hitSeg.segment.handleOut.add(e.delta); else if (hitSeg.item) hitSeg.item.position = hitSeg.item.position.add(e.delta); }
      else if (t === 'pen' && pen) { const s = pen.lastSegment; s.handleOut = e.point.subtract(s.point); s.handleIn = s.handleOut.multiply(-1); }
      else if (['rect', 'ellipse', 'polygon', 'star'].includes(t)) { if (live) live.remove(); const r = new sc.Rectangle(start, e.point); if (e.modifiers.shift) { const m = Math.max(r.width, r.height); r.width = r.height = m; } live = addShape(t, { x: r.x, y: r.y, w: r.width, h: r.height }); }
    };
    tool.onMouseUp = () => { const t = S.tool; if (live) { sc.project.deselectAll(); live.selected = true; live = null; snapshot(t); } else if ((t === 'select' && drag) || (t === 'node' && hitSeg)) snapshot('edit'); drag = null; hitSeg = null; refreshInspector(); };
    tool.onKeyDown = e => { if (Shell.tab !== 'vector') return; if (e.key === 'enter' || e.key === 'escape') { if (pen) { pen.fullySelected = false; pen = null; snapshot('pen'); } } if ((e.key === 'delete' || e.key === 'backspace') && !document.activeElement.closest('input,textarea,select')) del(); };
    tool.activate();
  }

  /* ---------- UI ---------- */
  function fit() { const sc = ps(), d = S.doc; if (!sc || !d) return; const box = S.stage.getBoundingClientRect(), k = Math.min((box.width - 40) / d.w, (box.height - 40) / d.h, 1) || .5; S.cv.style.width = d.w * k + 'px'; S.cv.style.height = d.h * k + 'px'; sc.view.viewSize = new sc.Size(d.w, d.h); sc.view.zoom = 1; sc.view.center = new sc.Point(d.w / 2, d.h / 2); }
  async function enter(root) {
    S.root = root; if (!S.built) { root.innerHTML = '<div class="abar"><b>Vector</b><span class="dim">Loading engine…</span></div>'; }
    await load();
    if (!S.built) build(root);
    if (!S.doc || !store()[S.doc.id]) { const first = Object.values(store())[0] || newDoc({}); open(first.id); } else { fit(); render(); }
  }
  function build(root) {
    root.innerHTML = ''; S.built = true;
    S.bar = el('div', { class: 'abar' }); S.tools = el('div', { class: 'vtools' }); S.stage = el('div', { class: 'vstage' }); S.insp = el('div', { class: 'vinsp' });
    S.cv = el('canvas', { class: 'vcanvas', 'data-paper-resize': 'false' }); S.stage.append(S.cv);
    root.append(S.bar, el('div', { class: 'vbody' }, S.tools, S.stage, S.insp));
    S.scope = new paper.PaperScope(); S.scope.setup(S.cv); setupTool();
    for (const [id, icon, title] of TOOLS) S.tools.append(el('button', { class: 'vt', 'data-t': id, title, onclick: () => { S.tool = id; render(); } }, Icon(icon, 18)));
    new ResizeObserver(() => fit()).observe(S.stage);
    document.addEventListener('keydown', e => { if (Shell.tab !== 'vector' || e.target.closest('input,textarea,select')) return; const k = e.key.toLowerCase(), map = { v: 'select', a: 'node', p: 'pen', m: 'rect', l: 'ellipse', t: 'text' };
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); } else if (!e.ctrlKey && map[k]) { S.tool = map[k]; render(); } });
  }
  function render() {
    if (!S.bar) return; const d = S.doc, linked = d && mediaFor(d.id);
    S.bar.innerHTML = ''; const b = (icon, label, title, fn, cls) => el('button', { class: 'ibtn ' + (cls || ''), title, onclick: fn }, icon ? Icon(icon, 14) : null, label);
    S.bar.append(el('b', {}, 'Vector'),
      el('select', { onchange: e => e.target.value === '+' ? (open(newDoc({}).id)) : open(e.target.value) }, Object.values(store()).map(x => el('option', { value: x.id, selected: d && x.id === d.id ? '' : undefined }, x.name)), el('option', { value: '+' }, '+ New drawing')),
      b('rename', '', 'Rename drawing', async () => { const v = await askText('Drawing name', d.name); if (v) { d.name = v; render(); sync(); } }),
      el('span', { class: 'vsep' }), b(null, 'Unite', 'Merge selected shapes into one', () => boolean('unite')), b(null, 'Subtract', 'Cut the top shapes out of the bottom one', () => boolean('subtract')), b(null, 'Intersect', 'Keep only the overlap', () => boolean('intersect')), b(null, 'Exclude', 'Keep everything except the overlap', () => boolean('exclude')),
      el('span', { class: 'vsep' }), b(null, 'Group', '', group), b(null, 'Ungroup', '', ungroup), b(null, 'Front', 'Bring to front', () => arrange(1)), b(null, 'Back', 'Send to back', () => arrange(-1)),
      el('div', { class: 'spacer' }),
      b('import', 'SVG', 'Import an SVG file', () => { const i = el('input', { type: 'file', accept: '.svg,image/svg+xml' }); i.onchange = async () => { if (i.files[0]) importSVG(await i.files[0].text()); }; i.click(); }),
      b('export', 'SVG', 'Export this drawing as SVG', exportSVG),
      linked ? el('span', { class: 'pill' }, Icon('link', 12), 'Linked to timeline') : b('edit', 'Place on timeline', 'Add this drawing to the Edit timeline (linked)', place, 'primary'));
    S.tools.querySelectorAll('.vt').forEach(x => x.classList.toggle('on', x.dataset.t === S.tool));
    refreshInspector();
  }
  function refreshInspector() {
    if (!S.insp) return; const it = S.scope ? selected() : [], one = it[0]; S.insp.innerHTML = '';
    const col = (label, val, on) => el('label', { class: 'vrow' }, el('span', {}, label), el('input', { type: 'color', value: val, oninput: e => on(e.target.value), onchange: () => snapshot('style') }));
    const num = (label, val, on, step) => el('label', { class: 'vrow' }, el('span', {}, label), el('input', { type: 'number', value: Math.round(val * 100) / 100, step: step || 1, onchange: e => { on(+e.target.value); snapshot('edit'); } }));
    const hex = c => c ? c.toCSS(true) : '#000000';
    if (!one) {
      S.insp.append(el('h4', {}, 'New shapes'), col('Fill', S.fill, v => S.fill = v), el('label', { class: 'vrow' }, el('span', {}, 'Stroke'), el('input', { type: 'checkbox', checked: S.strokeOn ? '' : undefined, onchange: e => S.strokeOn = e.target.checked })), col('Stroke colour', S.stroke, v => S.stroke = v), num('Stroke width', S.strokeW, v => S.strokeW = v),
        el('h4', {}, 'Artboard'), el('div', { class: 'dim' }, S.doc ? `${S.doc.w} × ${S.doc.h} (project size)` : ''), el('div', { class: 'dim', style: 'margin-top:10px' }, 'Shift-drag for squares/circles. Shift-click to select several shapes for Unite / Subtract / Intersect / Exclude.'));
      return;
    }
    const bd = one.bounds, gr = one.data.grad || { type: one.fillColor && one.fillColor.gradient ? 'linear' : 'solid', c1: hex(one.fillColor && !one.fillColor.gradient ? one.fillColor : null) || S.fill, c2: '#3b9bff', angle: 0 };
    const regrad = () => it.forEach(i => setGradient(i, Object.assign({}, gr)));
    const textPath = it.length === 2 && it.some(i => i.className === 'PointText') && it.some(i => i.className === 'Path' || i.className === 'CompoundPath');
    S.insp.append(el('h4', {}, it.length > 1 ? `${it.length} items` : one.className),
      el('label', { class: 'vrow' }, el('span', {}, 'Fill type'), el('select', { onchange: e => { gr.type = e.target.value; if (!gr.c1 || gr.c1 === '#000000') gr.c1 = S.fill; regrad(); snapshot('fill'); refreshInspector(); } }, [['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient']].map(([v, n]) => el('option', { value: v, selected: gr.type === v ? '' : undefined }, n)))),
      gr.type !== 'solid' ? el('div', {}, col('From', gr.c1, v => { gr.c1 = v; regrad(); }), col('To', gr.c2, v => { gr.c2 = v; regrad(); }), gr.type === 'linear' ? num('Angle °', gr.angle || 0, v => { gr.angle = v; regrad(); }) : null) : null,
      gr.type === 'solid' ? col('Fill', hex(one.fillColor), v => it.forEach(i => { i.fillColor = v; delete i.data.grad; })) : null,
      textPath ? el('button', { class: 'primary', style: 'margin:6px 0', onclick: () => { const t = it.find(i => i.className === 'PointText'), p = it.find(i => i !== t); const g = textOnPath(t.content, p, { size: t.fontSize, color: hex(t.fillColor) }); t.remove(); ps().project.deselectAll(); g.selected = true; snapshot('text on path'); } }, 'Set text on path') : null, col('Stroke', hex(one.strokeColor), v => it.forEach(i => { i.strokeColor = v; if (!i.strokeWidth) i.strokeWidth = 2; })), num('Stroke width', one.strokeWidth || 0, v => it.forEach(i => i.strokeWidth = v)),
      num('Opacity %', one.opacity * 100, v => it.forEach(i => i.opacity = clamp(v / 100, 0, 1))),
      el('h4', {}, 'Geometry'), num('X', bd.x, v => one.position.x += v - one.bounds.x), num('Y', bd.y, v => one.position.y += v - one.bounds.y), num('Width', bd.width, v => one.scale(v / one.bounds.width, 1, one.bounds.topLeft)), num('Height', bd.height, v => one.scale(1, v / one.bounds.height, one.bounds.topLeft)), num('Rotate by °', 0, v => it.forEach(i => i.rotate(v))),
      el('h4', {}, 'Align'), el('div', { class: 'valign' }, [['left', 'Left'], ['hcenter', 'Center'], ['right', 'Right'], ['top', 'Top'], ['vcenter', 'Middle'], ['bottom', 'Bottom']].map(([k, n]) => el('button', { onclick: () => align(k) }, n))),
      el('button', { style: 'margin-top:12px', onclick: del }, Icon('trash', 13), 'Delete'));
  }
  return { S, load, enter, newDoc, open, snapshot, undo, redo, addShape, addText, setGradient, textOnPath, boolean, align, group, ungroup, importSVG, svgOf, rasterize, publish, place, relinkAll, mediaFor, store, selected };
})();
