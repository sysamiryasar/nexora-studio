'use strict';
/* ====================== viewport: pan/zoom, tools, gizmo ====================== */
const stageWrap = document.getElementById('stageWrap');
const over = document.getElementById('over'), octx = over.getContext('2d');
const checker = document.getElementById('checker');
let zoom = 1, panX = 0, panY = 0, tool = 'move', spaceDown = false, showGuides = false;
const brush = { size: 48, hard: 70, flow: 100, tol: 40 };
let fg = '#ffffff';
let gesture = null, stroke = null, hoverPt = { x: 0, y: 0 };

const TOOLS = [
  { id: 'move', icon: '⌖', key: 'V', name: 'Move / Transform' },
  { id: 'hand', icon: '✋', key: 'H', name: 'Hand (pan)' },
  { id: 'brush', icon: '🖌', key: 'B', name: 'Brush' },
  { id: 'eraser', icon: '⌫', key: 'E', name: 'Eraser' },
  { id: 'fill', icon: '🪣', key: 'G', name: 'Paint Bucket' },
  { id: 'eyedrop', icon: '💧', key: 'I', name: 'Eyedropper' },
  { id: 'text', icon: 'T', key: 'T', name: 'Text' },
  { id: 'rect', icon: '▭', key: 'R', name: 'Rectangle' },
  { id: 'ellipse', icon: '◯', key: 'O', name: 'Ellipse' }
];
function buildTools() {
  const box = document.getElementById('tools'); box.innerHTML = '';
  const IC = { move: 'move', hand: 'hand', brush: 'brush', eraser: 'eraser', fill: 'bucket', eyedrop: 'eyedrop', text: 'text', rect: 'rect', ellipse: 'circle' };
  TOOLS.forEach(t => { const b = document.createElement('button'); b.append(Icon(IC[t.id], 17)); b.title = `${t.name} (${t.key})`; b.dataset.tool = t.id; b.onclick = () => setTool(t.id); box.appendChild(b); });
}
function setTool(id) {
  tool = id; document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  over.style.cursor = { move: 'default', hand: 'grab', brush: 'crosshair', eraser: 'crosshair', fill: 'crosshair', eyedrop: 'crosshair', text: 'text', rect: 'crosshair', ellipse: 'crosshair' }[id];
  buildOptions(); requestRender();
}
function buildOptions() {
  const o = document.getElementById('optbar'); o.innerHTML = '';
  const lab = (t, el) => { const l = document.createElement('label'); l.append(t, el); o.appendChild(l); return el; };
  const rng = (min, max, val, cb) => { const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.value = val; r.oninput = () => { cb(+r.value); const s = r.nextSibling; if (s) s.textContent = r.value; }; return r; };
  const col = document.createElement('input'); col.type = 'color'; col.value = fg; col.oninput = () => { fg = col.value; tipCache = null; };
  const name = TOOLS.find(t => t.id === tool).name; const h = document.createElement('b'); h.textContent = name; o.appendChild(h);
  if (['brush', 'eraser', 'fill', 'text', 'rect', 'ellipse'].includes(tool) && tool !== 'eraser') lab('Color', col);
  if (tool === 'brush' || tool === 'eraser') {
    [['Size', 1, 400, 'size'], ['Hardness', 0, 100, 'hard'], ['Flow', 1, 100, 'flow']].forEach(([n, a, b, k]) => { const r = rng(a, b, brush[k], v => brush[k] = v), l = lab(n, r); const sp = document.createElement('span'); sp.textContent = brush[k]; sp.style.width = '28px'; r.after(sp); });
    const hint = document.createElement('span'); hint.className = 'dim'; hint.textContent = 'Paints on the selected paint layer (auto-creates one)  ·  [ ] change size'; o.appendChild(hint);
  }
  if (tool === 'fill') { const r = rng(0, 255, brush.tol, v => brush.tol = v); lab('Tolerance', r); const sp = document.createElement('span'); sp.textContent = brush.tol; r.after(sp); }
  if (tool === 'move') { const hint = document.createElement('span'); hint.className = 'dim'; hint.textContent = 'Click to select · drag to move · corners scale · top handle rotates · Shift = constrain · Wheel = zoom · Middle-drag or H = pan'; o.appendChild(hint); }
  if (tool === 'text') { const hint = document.createElement('span'); hint.className = 'dim'; hint.textContent = 'Click on the canvas to add text'; o.appendChild(hint); }
  if (tool === 'rect' || tool === 'ellipse') { const hint = document.createElement('span'); hint.className = 'dim'; hint.textContent = 'Drag on the canvas to draw a shape layer'; o.appendChild(hint); }
}

/* ---- view transform ---- */
function applyView() {
  const t = `translate(${panX}px,${panY}px) scale(${zoom})`;
  view.style.transform = t; checker.style.transform = t; checker.style.width = P.w + 'px'; checker.style.height = P.h + 'px';
  checker.style.display = P.bg === 'transparent' ? 'block' : 'none';
  document.getElementById('zoomRead').textContent = Math.round(zoom * 100) + '%'; requestRender();
}
function resizeOverlay() {
  const r = stageWrap.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  over.width = Math.max(1, r.width * d); over.height = Math.max(1, r.height * d); octx.setTransform(d, 0, 0, d, 0, 0); requestRender();
}
let userZoomed = false;
function fitView() {
  userZoomed = false; const r = stageWrap.getBoundingClientRect(); zoom = Math.max(.05, Math.min((r.width - 40) / P.w, (r.height - 40) / P.h));
  panX = (r.width - P.w * zoom) / 2; panY = (r.height - P.h * zoom) / 2; applyView();
}
const scr = e => { const r = over.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const toComp = s => ({ x: (s.x - panX) / zoom, y: (s.y - panY) / zoom });
const toScr = p => ({ x: p.x * zoom + panX, y: p.y * zoom + panY });
function zoomAt(s, f) { userZoomed = true; const nz = clamp(zoom * f, .05, 16), p = toComp(s); zoom = nz; panX = s.x - p.x * zoom; panY = s.y - p.y * zoom; applyView(); }

/* ---- geometry ---- */
function layerBox(L, t) {
  const C = contentOf(L, t || T); if (!C || !C.w) return null;
  const X = xform(L, t || T), M = worldMat(L, t || T), pt = (u, v) => matApply(M, u * C.w / 2, v * C.h / 2);
  return { c: pt(0, 0), tl: pt(-1, -1), tr: pt(1, -1), br: pt(1, 1), bl: pt(-1, 1), tm: pt(0, -1), X, C, M };
}
function localPt(L, p, t) { return matApply(matInv(worldMat(L, t || T)), p.x, p.y); }
function hitLayer(p) {
  for (let i = P.layers.length - 1; i >= 0; i--) {
    const L = P.layers[i]; if (!L.visible || L.locked || ['audio', 'adjust', 'paint', 'particles'].includes(L.type)) continue;    if (T < L.start || T >= L.start + L.dur) continue;
    const C = contentOf(L, T); if (!C) continue; const q = localPt(L, p);
    if (Math.abs(q.x) <= C.w / 2 && Math.abs(q.y) <= C.h / 2) return L;
  }
  return null;
}
function handles(L) {
  const b = layerBox(L); if (!b || L.type === 'paint') return null;
  const S = { tl: toScr(b.tl), tr: toScr(b.tr), br: toScr(b.br), bl: toScr(b.bl), c: toScr(b.c), tm: toScr(b.tm) };
  const dx = S.tm.x - S.c.x, dy = S.tm.y - S.c.y, len = Math.hypot(dx, dy) || 1; S.rot = { x: S.tm.x + dx / len * 28, y: S.tm.y + dy / len * 28 };
  return { b, S };
}

/* ---- overlay drawing ---- */
/* viewer guides: action safe 93 % and title safe 90 % (SMPTE ST 2046-1), rule of thirds, centre cross, and the frame a
   different delivery aspect would crop to (e.g. a 9:16 cut-down of a 16:9 edit), with the outside dimmed */
const guides = (() => { try { return Object.assign({ safe: true, thirds: false, center: true, crop: '' }, JSON.parse(localStorage.getItem('nx.guides') || '{}')); } catch (e) { return { safe: true, thirds: false, center: true, crop: '' }; } })();
const saveGuides = () => { try { localStorage.setItem('nx.guides', JSON.stringify(guides)); } catch (e) { } };
const GUIDE_CROPS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '2.39:1': 2.39, '4:3': 4 / 3 };
/** largest centred rectangle of aspect `ar` inside the frame, in project pixels */
function cropRect(ar) { let w = P.w, h = w / ar; if (h > P.h) { h = P.h; w = h * ar; } return { x: (P.w - w) / 2, y: (P.h - h) / 2, w, h }; }
function drawGuides() {
  const box = (x0, y0, x1, y1) => { const a = toScr({ x: x0, y: y0 }), b = toScr({ x: x1, y: y1 }); octx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(b.x - a.x), Math.round(b.y - a.y)); return [a, b]; };
  const line = (x0, y0, x1, y1) => { const a = toScr({ x: x0, y: y0 }), b = toScr({ x: x1, y: y1 }); octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke(); };
  octx.save(); octx.lineWidth = 1;
  if (guides.crop && GUIDE_CROPS[guides.crop]) {
    const r = cropRect(GUIDE_CROPS[guides.crop]), a = toScr({ x: 0, y: 0 }), b = toScr({ x: P.w, y: P.h }), c0 = toScr({ x: r.x, y: r.y }), c1 = toScr({ x: r.x + r.w, y: r.y + r.h });
    octx.fillStyle = '#000000a6'; octx.beginPath(); octx.rect(a.x, a.y, b.x - a.x, b.y - a.y); octx.rect(c1.x, c0.y, c0.x - c1.x, c1.y - c0.y); octx.fill('evenodd');
    octx.strokeStyle = '#5cb8ff'; octx.setLineDash([]); box(r.x, r.y, r.x + r.w, r.y + r.h); octx.fillStyle = '#5cb8ff'; octx.font = '11px Segoe UI, sans-serif'; octx.fillText(guides.crop, c0.x + 6, c0.y + 15);
  }
  if (guides.safe) { octx.strokeStyle = '#ffffff66'; octx.setLineDash([5, 4]); box(P.w * .035, P.h * .035, P.w * .965, P.h * .965); octx.strokeStyle = '#ffffff40'; box(P.w * .05, P.h * .05, P.w * .95, P.h * .95); }
  if (guides.thirds) { octx.strokeStyle = '#ffffff40'; octx.setLineDash([]); for (const f of [1 / 3, 2 / 3]) { line(P.w * f, 0, P.w * f, P.h); line(0, P.h * f, P.w, P.h * f); } }
  if (guides.center) { octx.strokeStyle = '#ffffff80'; octx.setLineDash([]); const s = Math.min(P.w, P.h) * .025; line(P.w / 2 - s, P.h / 2, P.w / 2 + s, P.h / 2); line(P.w / 2, P.h / 2 - s, P.w / 2, P.h / 2 + s); }
  octx.restore();
}
function guidesMenu(anchor) {
  const r = anchor.getBoundingClientRect(), tick = v => v ? '✓ ' : '  ', set = (k, v) => { guides[k] = v; showGuides = true; saveGuides(); requestRender(); uiGuides(); };
  showPop(r.right - 240, r.bottom + 4, [
    [tick(showGuides) + 'Show guides', () => { showGuides = !showGuides; requestRender(); uiGuides(); }], null,
    [tick(guides.safe) + 'Action & title safe', () => set('safe', !guides.safe)], [tick(guides.thirds) + 'Rule of thirds', () => set('thirds', !guides.thirds)], [tick(guides.center) + 'Centre cross', () => set('center', !guides.center)], null,
    [tick(!guides.crop) + 'No crop frame', () => set('crop', '')], ...Object.keys(GUIDE_CROPS).map(k => [tick(guides.crop === k) + 'Crop frame ' + k, () => set('crop', k)])], () => guidesMenu(anchor));
}
/** small popup menu at (x, y): items are [label, fn, shortcut] or null for a divider; `again` re-opens it after a pick (toggle lists) */
function showPop(x, y, items, again) {
  const pop = document.getElementById('menuPop'); pop.innerHTML = '';
  items.forEach(it => { if (!it) return pop.append(el('hr')); pop.append(el('button', { onclick: () => { pop.classList.add('hidden'); it[1](); if (again) again(); } }, it[0], el('kbd', {}, it[2] || ''))); });
  pop.style.left = Math.min(x, innerWidth - 240) + 'px'; pop.style.top = y + 'px'; pop.classList.remove('hidden');
}
function uiGuides() { const b = document.getElementById('bGuides'); if (b) b.classList.toggle('on', showGuides); }
function drawOverlay() {
  const r = stageWrap.getBoundingClientRect(); octx.clearRect(0, 0, r.width, r.height);
  if (showGuides) drawGuides();
  const L = selLayer();
  if (L && L.visible && T >= L.start && T < L.start + L.dur) {
    if (L.mask && L.mask.on) {
      const lt = T - L.start, mv = k => valueAt(L, 'mask.' + k, lt), c = toScr({ x: mv('x'), y: mv('y') }), w = mv('w') * zoom, h = mv('h') * zoom;
      octx.strokeStyle = '#7cc8ff'; octx.setLineDash([6, 4]); octx.lineWidth = 1.5; octx.beginPath();
      if (L.mask.shape === 'ellipse') octx.ellipse(c.x, c.y, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2); else octx.rect(c.x - w / 2, c.y - h / 2, w, h);
      octx.stroke(); octx.setLineDash([]);
    }
    const H = handles(L);
    if (H && !L.locked) {
      const { S } = H; octx.strokeStyle = '#5cb8ff'; octx.lineWidth = 1.5; octx.beginPath(); octx.moveTo(S.tl.x, S.tl.y); [S.tr, S.br, S.bl].forEach(q => octx.lineTo(q.x, q.y)); octx.closePath(); octx.stroke();
      octx.beginPath(); octx.moveTo(S.tm.x, S.tm.y); octx.lineTo(S.rot.x, S.rot.y); octx.stroke();
      octx.fillStyle = '#fff'; [S.tl, S.tr, S.br, S.bl].forEach(q => { octx.fillRect(q.x - 5, q.y - 5, 10, 10); octx.strokeRect(q.x - 5, q.y - 5, 10, 10); });
      octx.beginPath(); octx.arc(S.rot.x, S.rot.y, 6, 0, Math.PI * 2); octx.fill(); octx.stroke();
      octx.beginPath(); octx.arc(S.c.x, S.c.y, 3, 0, Math.PI * 2); octx.stroke();
    }
  }
  if (gesture && gesture.type === 'create') {
    const a = toScr(gesture.p0), b = toScr(gesture.p1); octx.strokeStyle = '#27d3c3'; octx.setLineDash([5, 4]);
    if (tool === 'ellipse') { octx.beginPath(); octx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); octx.stroke(); } else octx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    octx.setLineDash([]);
  }
  if ((tool === 'brush' || tool === 'eraser') && hoverPt.show) {
    const s = toScr(hoverPt); octx.strokeStyle = '#fff'; octx.lineWidth = 1; octx.beginPath(); octx.arc(s.x, s.y, brush.size * zoom / 2, 0, Math.PI * 2); octx.stroke();
    octx.strokeStyle = '#000'; octx.beginPath(); octx.arc(s.x, s.y, brush.size * zoom / 2 + 1, 0, Math.PI * 2); octx.stroke();
  }
}

/* ---- painting ---- */
let tipCache = null;
function getTip(size, hard, color) {
  const key = size + '|' + hard + '|' + color; if (tipCache && tipCache.key === key) return tipCache.c;
  const d = Math.max(2, Math.ceil(size)), c = mkCanvas(d, d), x = c.getContext('2d'), h = hard / 100;
  const g = x.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2); g.addColorStop(0, rgba(color, 1)); g.addColorStop(Math.min(.99, h), rgba(color, 1)); g.addColorStop(1, rgba(color, 0));
  x.fillStyle = g; x.fillRect(0, 0, d, d); tipCache = { key, c }; return c;
}
function ensurePaintLayer() {
  let L = selLayer();
  if (L && L.type === 'paint') return L.locked ? null : L;
  const n = P.layers.filter(l => l.type === 'paint').length + 1;
  return addLayer(mkLayer('paint', { name: 'Paint ' + n, start: 0, dur: P.dur }));
}
function paintSeg(p) {
  const L = stroke.L, c = L._canvas.getContext('2d'), WM = worldMat(L, T), kx = Math.hypot(WM[0], WM[1]) || 1;
  const q = localPt(L, p); q.x += P.w / 2; q.y += P.h / 2;
  const size = brush.size / Math.abs(kx), tip = getTip(size, brush.hard, tool === 'eraser' ? '#000000' : fg);
  c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; c.globalAlpha = brush.flow / 100 * (tool === 'eraser' ? 1 : .6 + .4 * brush.flow / 100);
  const stamp = (x, y) => c.drawImage(tip, x - tip.width / 2, y - tip.height / 2);
  const step = Math.max(1, size * .12);
  if (!stroke.last) { stamp(q.x, q.y); stroke.rem = step; }
  else {
    const dx = q.x - stroke.last.x, dy = q.y - stroke.last.y, d = Math.hypot(dx, dy); let s = stroke.rem;
    for (; s <= d; s += step) stamp(stroke.last.x + dx * s / d, stroke.last.y + dy * s / d);
    stroke.rem = s - d;
  }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; stroke.last = q; L._ver++; requestRender();
}
function floodFill(L, p, color, tol) {
  const c = L._canvas, x = c.getContext('2d'), W = c.width, H = c.height, sx = Math.floor(p.x + W / 2), sy = Math.floor(p.y + H / 2);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
  const id = x.getImageData(0, 0, W, H), d = id.data, [fr, fgc, fb] = hexToRgb(color), i0 = (sy * W + sx) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
  if (tr === fr && tg === fgc && tb === fb && ta === 255) return;
  const lim = tol * 4, seen = new Uint8Array(W * H), match = i => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) + Math.abs(d[i + 3] - ta) <= lim;
  const stack = [sx, sy];
  while (stack.length) {
    let y = stack.pop(), xx = stack.pop();
    while (y >= 0 && !seen[y * W + xx] && match((y * W + xx) * 4)) y--; y++;
    let l = false, r = false;
    for (; y < H && !seen[y * W + xx] && match((y * W + xx) * 4); y++) {
      const i = y * W + xx; seen[i] = 1; d[i * 4] = fr; d[i * 4 + 1] = fgc; d[i * 4 + 2] = fb; d[i * 4 + 3] = 255;
      if (xx > 0) { const ok = !seen[i - 1] && match((i - 1) * 4); if (!l && ok) { stack.push(xx - 1, y); l = true; } else if (l && !ok) l = false; }
      if (xx < W - 1) { const ok = !seen[i + 1] && match((i + 1) * 4); if (!r && ok) { stack.push(xx + 1, y); r = true; } else if (r && !ok) r = false; }
    }
  }
  x.putImageData(id, 0, 0); L._ver++;
}

/* ---- pointer handling ---- */
function moveDown(e, s, p) {
  const L = selLayer();
  if (L && !L.locked) {
    const H = handles(L);
    if (H) {
      const near = q => Math.hypot(q.x - s.x, q.y - s.y) < 11;
      if (near(H.S.rot)) { gesture = { type: 'rot', L, a0: Math.atan2(s.y - H.S.c.y, s.x - H.S.c.x), r0: H.b.X.rot, c: H.S.c }; return; }
      if ([H.S.tl, H.S.tr, H.S.br, H.S.bl].some(near)) { gesture = { type: 'scale', L, d0: Math.hypot(s.x - H.S.c.x, s.y - H.S.c.y) || 1, s0: H.b.X.s, c: H.S.c }; return; }
    }
  }
  const hit = hitLayer(p);
  if (hit) { selId = hit.id; uiSel(); const X = xform(hit, T), W = worldMat(hit, T); gesture = { type: 'move', L: hit, p0: p, x0: X.x, y0: X.y, wx0: W[4], wy0: W[5], pm: parentMat(hit, T), moved: false }; }
  else { selId = null; uiSel(); }
  requestRender();
}
over.addEventListener('pointerdown', e => {
  over.setPointerCapture(e.pointerId); const s = scr(e), p = toComp(s);
  if (e.button === 1 || tool === 'hand' || spaceDown) { gesture = { type: 'pan', s0: s, px: panX, py: panY }; over.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (trackArm) { trackClick(p); return; }
  if (tool === 'move') moveDown(e, s, p);
  else if (tool === 'brush' || tool === 'eraser') { const L = ensurePaintLayer(); if (!L) return; stroke = { L, last: null }; gesture = { type: 'paint' }; paintSeg(p); }
  else if (tool === 'fill') { const L = selLayer(); if (!L || L.type !== 'paint') { toast('Select a paint layer first (or paint something with the brush).'); return; } floodFill(L, localPt(L, p), fg, brush.tol); requestRender(); commit(); }
  else if (tool === 'eyedrop') { const d = vctx.getImageData(clamp(Math.floor(p.x), 0, P.w - 1), clamp(Math.floor(p.y), 0, P.h - 1), 1, 1).data; fg = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); tipCache = null; buildOptions(); }
  else if (tool === 'text') { const L = addLayer(mkLayer('text', { name: 'Text', dur: Math.max(2, Math.min(5, P.dur - T)), start: T })); L.text.color = fg; L.tr.x = p.x; L.tr.y = p.y; commit(); setTool('move'); setTimeout(() => { const ta = document.getElementById('textEdit'); if (ta) { ta.focus(); ta.select(); } }, 30); }
  else if (tool === 'rect' || tool === 'ellipse') gesture = { type: 'create', p0: p, p1: p };
});
over.addEventListener('pointermove', e => {
  const s = scr(e), p = toComp(s); hoverPt = { x: p.x, y: p.y, show: true };
  document.getElementById('hud').textContent = `${Math.round(p.x)}, ${Math.round(p.y)} px  ·  ${P.w}×${P.h}`;
  if (!gesture) { if (tool === 'brush' || tool === 'eraser') requestRender(); else if (tool === 'move') { const L = selLayer(), H = L && handles(L); if (H) { const near = q => Math.hypot(q.x - s.x, q.y - s.y) < 11; over.style.cursor = near(H.S.rot) ? 'alias' : [H.S.tl, H.S.tr, H.S.br, H.S.bl].some(near) ? 'nwse-resize' : 'default'; } } return; }
  const g = gesture;
  if (g.type === 'pan') { userZoomed = true; panX = g.px + s.x - g.s0.x; panY = g.py + s.y - g.s0.y; applyView(); }
  else if (g.type === 'move') {
    let dx = p.x - g.p0.x, dy = p.y - g.p0.y; if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (!g.moved && Math.hypot(dx, dy) * zoom < 2) return; g.moved = true;
    const q = g.L.parent ? matApply(matInv(g.pm), g.wx0 + dx, g.wy0 + dy) : { x: g.x0 + dx, y: g.y0 + dy };
    setProp(g.L, 'x', Math.round(q.x * 10) / 10); setProp(g.L, 'y', Math.round(q.y * 10) / 10); uiProps(); requestRender();
  } else if (g.type === 'scale') { const d = Math.hypot(s.x - g.c.x, s.y - g.c.y); setProp(g.L, 's', clamp(Math.round(g.s0 * d / g.d0 * 10) / 10, 1, 3000)); uiProps(); requestRender(); }
  else if (g.type === 'rot') { let r = g.r0 + (Math.atan2(s.y - g.c.y, s.x - g.c.x) - g.a0) * 180 / Math.PI; if (e.shiftKey) r = Math.round(r / 15) * 15; setProp(g.L, 'rot', Math.round(r * 10) / 10); uiProps(); requestRender(); }
  else if (g.type === 'paint') { paintSeg(p); }
  else if (g.type === 'create') { g.p1 = p; requestRender(); }
});
const endGesture = e => {
  const g = gesture; gesture = null; if (!g) return;
  over.style.cursor = { move: 'default', hand: 'grab' }[tool] || 'crosshair';
  if (g.type === 'move') { if (g.moved) commit(); }
  else if (g.type === 'scale' || g.type === 'rot') commit();
  else if (g.type === 'paint') { stroke = null; commit(); uiTimelineLite(); }
  else if (g.type === 'create') {
    let w = Math.abs(g.p1.x - g.p0.x), h = Math.abs(g.p1.y - g.p0.y), cx = (g.p1.x + g.p0.x) / 2, cy = (g.p1.y + g.p0.y) / 2;
    if (w < 6 && h < 6) { w = h = 240; cx = g.p0.x; cy = g.p0.y; }
    const L = mkLayer('shape', { name: tool === 'rect' ? 'Rectangle' : 'Ellipse', start: T, dur: Math.max(2, Math.min(5, P.dur - T)) });
    Object.assign(L.shape, { kind: tool === 'rect' ? 'rect' : 'ellipse', w: Math.round(w), h: Math.round(h), fill: fg }); L.tr.x = Math.round(cx); L.tr.y = Math.round(cy);
    addLayer(L); commit(); setTool('move');
  }
};
over.addEventListener('pointerup', endGesture); over.addEventListener('pointercancel', endGesture);
over.addEventListener('pointerleave', () => { hoverPt.show = false; requestRender(); });
over.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey || !e.shiftKey) zoomAt(scr(e), Math.exp(-e.deltaY * .0015)); else { panX -= e.deltaY; applyView(); } }, { passive: false });
over.addEventListener('dblclick', e => { if (tool !== 'move') return; const L = selLayer(); if (L && L.type === 'text') { const ta = document.getElementById('textEdit'); if (ta) { ta.focus(); ta.select(); } } });

function toast(msg) {
  let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;bottom:290px;transform:translateX(-50%);background:#000c;border:1px solid #5cb8ff;padding:8px 14px;border-radius:8px;z-index:200;transition:opacity .3s'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = 1; clearTimeout(t._h); t._h = setTimeout(() => t.style.opacity = 0, 2600);
}
