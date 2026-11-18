'use strict';
/* ====================== project model ====================== */
let P = { name: 'Untitled Project', w: 1280, h: 720, fps: 30, dur: 12, bg: '#000000', layers: [], markers: [] };
const media = {};            // id -> media record
const els = new Map();       // layerId -> HTMLMediaElement
let T = 0, playing = false, loopPlay = false, exporting = false, dirty = true, offlineBusy = false;
let selId = null;
let playT0 = 0, wall0 = 0;
const view = document.getElementById('view');
const vctx = view.getContext('2d');

// size of the surface currently being rendered (project, a Motion composition, or a VFX graph)
let RS = null;
/* RQ: size of the frame being drawn relative to the project (1 except during a reduced-resolution preview). Layers keep working in
   project units: only the output is scaled, and every setting measured in pixels is scaled with it, so the look does not change. */
let RQ = 1, RQnext = 1;
const atFull = fn => { const q = RQ; RQ = 1; try { return fn(); } finally { RQ = q; } };
const RW = () => RS && RQ === 1 ? RS.w : P.w, RH = () => RS && RQ === 1 ? RS.h : P.h;
const PX_KEYS = { blur: ['amount'], shadow: ['x', 'y', 'blur'], glow: ['radius'], rgbsplit: ['amount'], pixelate: ['size'], wave: ['amp', 'freq'], motionblur: ['len'], scanlines: ['gap'], halftone: ['size'], shake: ['amount'] };
let renderReqs = 0;                                  // counts live changes (the render cache re-validates on change)
const requestRender = () => { dirty = true; renderReqs++; };
const selLayer = () => P.layers.find(l => l.id === selId) || null;
const ser = o => JSON.stringify(o, (k, v) => (k[0] === '_' ? undefined : v));
const frameQ = t => Math.round(t * P.fps) / P.fps;

function mkLayer(type, o = {}) {
  const L = {
    id: uid(), type, name: type[0].toUpperCase() + type.slice(1), start: 0, dur: 5, srcIn: 0, speed: 1,
    visible: true, locked: false, solo: false, open: false,
    tr: { x: P.w / 2, y: P.h / 2, s: 100, sx: 100, sy: 100, rot: 0, op: 100, rx: 0, ry: 0 }, parent: '',
    flipX: false, flipY: false, blend: 'source-over', fx: [], kf: {}, mask: null,
    tin: { type: 'none', dur: .6 }, tout: { type: 'none', dur: .6 }, vol: 100, muted: false,
    expr: {}, matte: { mode: 'none', src: '' }
  };
  if (type === 'comp') { L.comp = { layers: [], dur: 5 }; L.name = 'Composition'; }
  if (type === 'null') { L.name = 'Null'; L.dur = Math.max(P.dur, 5); }
  if (type === 'particles') { L.part = { kind: 'snow', count: 140, size: 10, speed: 1, c1: '#ffffff', c2: '#5cb8ff', seed: 1 }; L.dur = Math.max(5, P.dur); L.blend = 'screen'; }
  if (type === 'text') L.text = { str: 'Your Text', font: 'Segoe UI', size: 96, weight: '700', italic: false, color: '#ffffff', align: 'center', stroke: '#000000', strokeW: 0, shadow: false, shColor: '#000000', shBlur: 12, shX: 0, shY: 6, bgOn: false, bg: '#000000', bgPad: 18, lineH: 1.15, spacing: 0, typeOn: 0 };
  if (type === 'shape') L.shape = { kind: 'rect', w: 400, h: 240, fill: '#5cb8ff', grad: false, fill2: '#ffffff', angle: 45, stroke: '#ffffff', strokeW: 0, radius: 0, points: 5 };
  if (type === 'solid') L.color = '#101820';
  if (type === 'paint') { L._canvas = mkCanvas(P.w, P.h); L._ver = 0; L.dur = P.dur; }
  if (type === 'adjust') L.dur = Math.max(P.dur, 5);
  if (type === 'gen') { L.gen = { kind: 'aurora', c1: '#5cb8ff', c2: '#1b5e9e', c3: '#000000', speed: 1, scale: 1 }; L.dur = Math.max(P.dur, 5); L.name = 'Background'; }
  if (type === 'vfx') { L.graphRef = ''; L.name = 'VFX graph'; }
  return Object.assign(L, o);
}
function defaultMask() { return { on: true, shape: 'rect', x: P.w / 2, y: P.h / 2, w: P.w / 2, h: P.h / 2, feather: 0, invert: false }; }

function addLayer(L, noSel) { P.layers.push(L); if (L.start + L.dur > P.dur) P.dur = Math.ceil(L.start + L.dur); if (!noSel) selId = L.id; structChanged(); return L; }
function removeLayer(id) { const i = P.layers.findIndex(l => l.id === id); if (i < 0) return; P.layers.splice(i, 1); const e = els.get(id); if (e) { e.pause(); } if (selId === id) selId = null; structChanged(); }
function cloneLayer(L) {
  const B = JSON.parse(ser(L)); B.id = uid();
  if (L.type === 'paint') { B._canvas = cloneCanvas(L._canvas); B._ver = 0; }
  return B;
}
function cloneCanvas(c) { const n = mkCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; }
function duplicateLayer(L) { const B = cloneLayer(L); B.name = L.name + ' copy'; const i = P.layers.indexOf(L); P.layers.splice(i + 1, 0, B); selId = B.id; structChanged(); return B; }
function splitLayer(L, t) {
  const lt = t - L.start; if (lt <= .04 || lt >= L.dur - .04) return null;
  const B = cloneLayer(L); B.start = t; B.dur = L.dur - lt; B.srcIn = L.srcIn + lt * L.speed; B.tin = { type: 'none', dur: .6 };
  for (const k in B.kf) B.kf[k].forEach(f => f.t -= lt);
  L.dur = lt; L.tout = { type: 'none', dur: .6 };
  P.layers.splice(P.layers.indexOf(L) + 1, 0, B); selId = B.id; structChanged(); return B;
}
function moveLayerZ(L, d) { const i = P.layers.indexOf(L), j = i + d; if (j < 0 || j >= P.layers.length) return; P.layers.splice(i, 1); P.layers.splice(j, 0, L); structChanged(); }

/* ====================== keyframes / properties ====================== */
function getStatic(L, k) {
  if (k in L.tr) return L.tr[k];
  if (k === 'vol') return L.vol;
  if (k.startsWith('fx.')) { const [, id, pk] = k.split('.'); const f = L.fx.find(f => f.id === id); return f ? f.p[pk] : 0; }
  if (k.startsWith('mask.')) return L.mask ? L.mask[k.slice(5)] : 0;
  if (k === 'trimS') return L.shape ? (L.shape.trimS || 0) : 0;
  if (k === 'trimE') return L.shape ? (L.shape.trimE == null ? 100 : L.shape.trimE) : 100;
  return 0;
}
function setStatic(L, k, v) {
  if (k in L.tr) L.tr[k] = v;
  else if (k === 'vol') L.vol = v;
  else if (k.startsWith('fx.')) { const [, id, pk] = k.split('.'); const f = L.fx.find(f => f.id === id); if (f) f.p[pk] = v; }
  else if (k.startsWith('mask.')) { if (L.mask) L.mask[k.slice(5)] = v; }
  else if ((k === 'trimS' || k === 'trimE') && L.shape) L.shape[k] = v;
}
/** CSS-style cubic-bezier(x1,y1,x2,y2) evaluated at x (0..1) */
function cubicBezier(b, x) {
  const [x1, y1, x2, y2] = b, cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = s => ((ax * s + bx) * s + cx) * s, dX = s => (3 * ax * s + 2 * bx) * s + cx;
  let s = x; for (let i = 0; i < 8; i++) { const e = X(s) - x, d = dX(s); if (Math.abs(e) < 1e-6) break; if (Math.abs(d) < 1e-6) break; s -= e / d; }
  if (s < 0 || s > 1 || Math.abs(X(s) - x) > 1e-4) { let lo = 0, hi = 1; s = x; for (let i = 0; i < 30; i++) { if (X(s) < x) lo = s; else hi = s; s = (lo + hi) / 2; } }
  return ((ay * s + by) * s + cy) * s;
}
const BEZ = { easy: [.33, 0, .67, 1], in: [.42, 0, 1, 1], out: [0, 0, .58, 1], snap: [.7, 0, .1, 1], overshoot: [.34, 1.56, .64, 1] };
/* After Effects-style expressions: value, time, wiggle(freq,amp), sin/cos/abs/min/max/clamp/lerp/random(seed), PI */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
function valueAt(L, key, lt) {
  const v = valueRaw(L, key, lt), src = L.expr && L.expr[key];
  if (!src) return v;
  try {
    let c = L._ex && L._ex[key]; if (!c || c.src !== src) { (L._ex = L._ex || {})[key] = c = { src, fn: new Function('value', 'time', 'wiggle', 'sin', 'cos', 'abs', 'min', 'max', 'clamp', 'lerp', 'random', 'PI', 'Math', 'return (' + src + ');') }; }
    const ph = hashStr(key + L.id) * 100, wig = (f, a) => a * (Math.sin(lt * f * 6.2832 + ph) * .6 + Math.sin(lt * f * 10.7 + ph * 1.7) * .3 + Math.sin(lt * f * 3.1 + ph * .4) * .1);
    const r = c.fn(v, lt, wig, Math.sin, Math.cos, Math.abs, Math.min, Math.max, clamp, lerp, s => mulberry(Math.floor(s * 1000) + 1)(), Math.PI, Math);
    return typeof r === 'number' && isFinite(r) ? r : v;
  } catch (e) { return v; }
}
function valueRaw(L, key, lt) {
  const k = L.kf[key];
  if (!k || !k.length) return getStatic(L, key);
  if (lt <= k[0].t) return k[0].v;
  const last = k[k.length - 1]; if (lt >= last.t) return last.v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (lt < b.t) { if (a.e === 'hold') return a.v; const u = (lt - a.t) / (b.t - a.t); return a.v + (b.v - a.v) * (a.e === 'bezier' && a.b ? cubicBezier(a.b, u) : (EASE[a.e] || EASE.inout)(u)); }
  }
  return last.v;
}
const isAnimated = (L, key) => !!(L.kf[key] && L.kf[key].length);
function upsertKey(L, key, lt, v, e) {
  const arr = L.kf[key] || (L.kf[key] = []); lt = frameQ(lt);
  const f = arr.find(x => Math.abs(x.t - lt) < .5 / P.fps);
  if (f) { f.v = v; if (e) f.e = e; } else { arr.push({ t: lt, v, e: e || 'inout' }); arr.sort((a, b) => a.t - b.t); }
}
function setProp(L, key, v, t) { if (isAnimated(L, key)) upsertKey(L, key, (t === undefined ? T : t) - L.start, v); else setStatic(L, key, v); }
function toggleAnim(L, key) {
  if (isAnimated(L, key)) { const v = valueAt(L, key, T - L.start); delete L.kf[key]; setStatic(L, key, v); }
  else upsertKey(L, key, T - L.start, getStatic(L, key));
}
function keyAtPlayhead(L, key) { const k = L.kf[key]; return !!k && k.some(f => Math.abs(f.t - frameQ(T - L.start)) < .5 / P.fps); }
function toggleKeyHere(L, key) {
  const lt = frameQ(T - L.start), k = L.kf[key];
  if (k && k.length) { const i = k.findIndex(f => Math.abs(f.t - lt) < .5 / P.fps); if (i >= 0) { k.splice(i, 1); if (!k.length) delete L.kf[key]; } else upsertKey(L, key, lt, valueAt(L, key, lt)); }
  else upsertKey(L, key, lt, getStatic(L, key));
}
function fxParams(L, f, lt) { const d = FX[f.type], p = {}; for (const q of d.params) p[q.k] = q.type === 'num' ? valueAt(L, `fx.${f.id}.${q.k}`, lt) : f.p[q.k]; if (RQ !== 1 && PX_KEYS[f.type]) for (const k of PX_KEYS[f.type]) p[k] *= RQ; return p; }
function propLabel(L, key) {
  const names = { x: 'Position X', y: 'Position Y', s: 'Scale', sx: 'Width %', sy: 'Height %', rot: 'Rotation', op: 'Opacity', vol: 'Volume', rx: '3D Tilt X', ry: '3D Turn Y', trimS: 'Trim start', trimE: 'Trim end' };
  if (names[key]) return names[key];
  if (key.startsWith('fx.')) { const [, id, pk] = key.split('.'); const f = L.fx.find(f => f.id === id); if (f) { const q = FX[f.type].params.find(q => q.k === pk); return FX[f.type].name.split(' ')[0] + ' · ' + (q ? q.label : pk); } }
  if (key.startsWith('mask.')) return 'Mask ' + key.slice(5);
  return key;
}

/* ====================== content generation ====================== */
function shapePath(c, S, w, h) {
  c.beginPath();
  const poly = (n, star) => { const pts = star ? n * 2 : n; for (let i = 0; i < pts; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / pts, r = star && i % 2 ? .45 : 1; const x = Math.cos(a) * w / 2 * r, y = Math.sin(a) * h / 2 * r; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); };
  switch (S.kind) {
    case 'rect': if (S.radius > 0 && c.roundRect) c.roundRect(-w / 2, -h / 2, w, h, Math.min(S.radius, w / 2, h / 2)); else c.rect(-w / 2, -h / 2, w, h); break;
    case 'ellipse': c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'triangle': poly(3); break;
    case 'polygon': poly(Math.max(3, S.points | 0)); break;
    case 'star': poly(Math.max(3, S.points | 0), true); break;
    case 'heart': c.moveTo(0, h * .5); c.bezierCurveTo(-w * .15, h * .32, -w * .5, h * .2, -w * .5, -h * .12); c.bezierCurveTo(-w * .5, -h * .42, -w * .1, -h * .5, 0, -h * .2); c.bezierCurveTo(w * .1, -h * .5, w * .5, -h * .42, w * .5, -h * .12); c.bezierCurveTo(w * .5, h * .2, w * .15, h * .32, 0, h * .5); c.closePath(); break;
  }
}
/** path length of a shape (for trim paths): records the same path calls and flattens curves */
function shapeLength(S) {
  let len = 0, x0 = 0, y0 = 0, sx = 0, sy = 0; const seg = (x, y) => { len += Math.hypot(x - x0, y - y0); x0 = x; y0 = y; };
  const rec = {
    beginPath() { }, closePath() { seg(sx, sy); }, moveTo(x, y) { x0 = sx = x; y0 = sy = y; }, lineTo: seg,
    bezierCurveTo(a, b, c, d, x, y) { const px = x0, py = y0; for (let i = 1; i <= 24; i++) { const t = i / 24, u = 1 - t; seg(u * u * u * px + 3 * u * u * t * a + 3 * u * t * t * c + t * t * t * x, u * u * u * py + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * y); } },
    ellipse(cx, cy, rx, ry) { x0 = cx + rx; y0 = cy; for (let i = 1; i <= 96; i++) { const a = i / 96 * Math.PI * 2; seg(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); } },
    rect(x, y, w, h) { len += 2 * (Math.abs(w) + Math.abs(h)); }, roundRect(x, y, w, h, r) { len += 2 * (Math.abs(w) + Math.abs(h)) - (8 - 2 * Math.PI) * r; }
  };
  shapePath(rec, S, S.w, S.h); return Math.max(1, len);
}
function shapeCanvas(L, t) {
  const S = L.shape, lt = t === undefined ? 0 : t - L.start, tS = clamp(valueAt(L, 'trimS', lt), 0, 100), tE = clamp(valueAt(L, 'trimE', lt), 0, 100);
  const key = JSON.stringify(S) + '|' + tS.toFixed(2) + '|' + tE.toFixed(2); if (L._sc && L._sc.key === key) return L._sc.v;
  const pad = S.strokeW + 3, W = Math.ceil(clamp(S.w, 1, 4096) + pad * 2), H = Math.ceil(clamp(S.h, 1, 4096) + pad * 2);
  const cv = mkCanvas(Math.min(W, 4400), Math.min(H, 4400)), c = cv.getContext('2d'); c.translate(W / 2, H / 2);
  shapePath(c, S, S.w, S.h);
  if (S.grad) { const a = S.angle * Math.PI / 180, dx = Math.cos(a) * S.w / 2, dy = Math.sin(a) * S.h / 2; const g = c.createLinearGradient(-dx, -dy, dx, dy); g.addColorStop(0, S.fill); g.addColorStop(1, S.fill2); c.fillStyle = g; } else c.fillStyle = S.fill;
  if (S.fillOn !== false) c.fill();
  if (S.strokeW > 0 && tE > tS) {
    c.lineWidth = S.strokeW; c.strokeStyle = S.stroke; c.lineJoin = 'round'; c.lineCap = S.cap || 'round';
    if (tS > 0 || tE < 100) { const len = shapeLength(S), a = len * tS / 100, b = len * tE / 100; c.setLineDash([b - a, len * 2]); c.lineDashOffset = -a; }
    c.stroke();
  }
  const v = { src: cv, w: cv.width, h: cv.height }; L._sc = { key, v }; return v;
}
function solidCanvas(L) {
  const w = RW(), h = RH(), key = L.color + w + 'x' + h; if (L._so && L._so.key === key) return L._so.v;
  const cv = mkCanvas(w, h), c = cv.getContext('2d'); c.fillStyle = L.color; c.fillRect(0, 0, w, h);
  const v = { src: cv, w, h }; L._so = { key, v }; return v;
}
const _mctx = mkCanvas(1, 1).getContext('2d');
function textCanvas(L, t) {
  if (L.text.anim && L.text.anim.preset !== 'none' && typeof Motion !== 'undefined') return Motion.animText(L, t);
  const X = L.text, full = X.str; let vis = full.length;
  if (X.typeOn > 0) vis = Math.floor(clamp((t - L.start) / X.typeOn, 0, 1) * full.length);
  // social captions: X.words = [[t0, t1], …] (seconds from the clip start, one per word) colours the spoken word
  let hi = -1; if (X.words && X.hlColor) { const lt = t - L.start; hi = X.words.findIndex(w => lt >= w[0] && lt < w[1]); if (hi < 0 && X.words.length && lt >= X.words[X.words.length - 1][0]) hi = X.words.length - 1; }
  const key = JSON.stringify([X, vis, hi]); if (L._tc && L._tc.key === key) return L._tc.v;
  const font = `${X.italic ? 'italic ' : ''}${X.weight} ${X.size}px "${X.font}", sans-serif`;
  _mctx.font = font; if ('letterSpacing' in _mctx) _mctx.letterSpacing = X.spacing + 'px';
  const lines = full.split('\n'), widths = lines.map(l => _mctx.measureText(l).width), lh = X.size * X.lineH;
  const pad = Math.ceil(X.size * .25 + X.strokeW * 2 + (X.shadow ? X.shBlur + Math.abs(X.shX) + Math.abs(X.shY) : 0) + (X.bgOn ? X.bgPad : 0));
  const W = Math.min(4096, Math.ceil(Math.max(X.size * .5, ...widths)) + pad * 2), H = Math.min(4096, Math.ceil(lines.length * lh) + pad * 2);
  const cv = mkCanvas(W, H), c = cv.getContext('2d'); c.font = font; if ('letterSpacing' in c) c.letterSpacing = X.spacing + 'px';
  c.textBaseline = 'middle'; c.lineJoin = 'round';
  if (X.bgOn) { c.fillStyle = X.bg; c.beginPath(); const bx = pad - X.bgPad, by = pad - X.bgPad; if (c.roundRect) c.roundRect(bx, by, W - bx * 2, H - by * 2, X.bgPad * .6); else c.rect(bx, by, W - bx * 2, H - by * 2); c.fill(); }
  let rem = vis;
  lines.forEach((ln, i) => {
    const txt = ln.slice(0, Math.max(0, rem)); rem -= ln.length + 1; if (!txt) return;
    const x0 = X.align === 'left' ? pad : X.align === 'right' ? W - pad - widths[i] : (W - widths[i]) / 2, y = pad + lh * (i + .5);
    c.textAlign = 'left';
    if (X.shadow) { c.shadowColor = X.shColor; c.shadowBlur = X.shBlur; c.shadowOffsetX = X.shX; c.shadowOffsetY = X.shY; }
    if (X.strokeW > 0) { c.lineWidth = X.strokeW * 2; c.strokeStyle = X.stroke; c.strokeText(txt, x0, y); c.shadowColor = 'transparent'; }
    if (hi >= 0 && lines.length === 1 && vis === full.length) { const ws = txt.split(' '), sw = c.measureText(' ').width; let x = x0;
      ws.forEach((w, k) => { c.fillStyle = k === hi ? X.hlColor : X.color; c.fillText(w, x, y); x += c.measureText(w).width + sw; }); }
    else { c.fillStyle = X.color; c.fillText(txt, x0, y); }
    c.shadowColor = 'transparent';
  });
  const v = { src: cv, w: W, h: H }; L._tc = { key, v }; return v;
}
function particleCanvas(L, t) {
  const Q = L.part, W = RW(), H = RH(), lt = t - L.start;
  const cv = L._pc && L._pc.width === W && L._pc.height === H ? L._pc : (L._pc = mkCanvas(W, H)), c = cv.getContext('2d'); c.clearRect(0, 0, W, H);
  const col = (a, b, u) => { const A = hexToRgb(a), B = hexToRgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], u))).join(',')})`; };
  for (let i = 0; i < Q.count; i++) {
    const r = mulberry(i * 7919 + Q.seed * 104729), a = r(), b = r(), d = r(), e = r(), sz = Q.size * (.5 + b), sp = Q.speed * (40 + d * 90);
    c.save();
    switch (Q.kind) {
      case 'snow': { const x = (a * W + Math.sin(lt * .8 + e * 9) * 40) % W, y = (b * H + lt * sp * .6) % H; c.globalAlpha = .5 + e * .5; c.fillStyle = Q.c1; c.beginPath(); c.arc((x + W) % W, y, sz * .5, 0, 6.283); c.fill(); break; }
      case 'confetti': { const x = a * W + Math.sin(lt * 2 + e * 9) * 50, y = (b * H + lt * sp * 1.6) % (H + 40) - 20; c.translate(x, y); c.rotate(lt * (2 + e * 6) + e * 9); c.scale(1, Math.cos(lt * 5 + a * 9)); c.fillStyle = col(Q.c1, Q.c2, e * 1.0 > .5 ? 1 : (i % 3) / 2); c.fillRect(-sz / 2, -sz / 4, sz, sz / 2); break; }
      case 'sparkle': { const x = a * W, y = b * H, tw = Math.abs(Math.sin(lt * (1 + e * 3) + d * 9)); c.translate(x, y); c.rotate(.785 * e); c.globalAlpha = tw; c.fillStyle = col(Q.c1, Q.c2, e); const s = sz * (.5 + tw); c.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? s * .18 : s, an = k * .785; k ? c.lineTo(Math.cos(an) * rr, Math.sin(an) * rr) : c.moveTo(rr, 0); } c.closePath(); c.fill(); break; }
      case 'bubbles': { const x = a * W + Math.sin(lt + e * 9) * 25, y = H - ((b * H + lt * sp * .7) % (H + 60)) + 30; c.globalAlpha = .6; c.strokeStyle = Q.c1; c.lineWidth = 2; c.beginPath(); c.arc(x, y, sz, 0, 6.283); c.stroke(); c.globalAlpha = .12; c.fillStyle = Q.c2; c.fill(); break; }
      case 'hearts': { const x = a * W + Math.sin(lt * 1.3 + e * 9) * 30, y = H - ((b * H + lt * sp * .8) % (H + 60)) + 30; c.translate(x, y); c.globalAlpha = .85; c.fillStyle = col(Q.c1, Q.c2, e); const s = sz * .12; c.beginPath(); c.moveTo(0, 5 * s); c.bezierCurveTo(-8 * s, -1 * s, -6 * s, -8 * s, 0, -3 * s); c.bezierCurveTo(6 * s, -8 * s, 8 * s, -1 * s, 0, 5 * s); c.fill(); break; }
      case 'embers': { const life = ((lt * Q.speed * .5 + b) % 1), x = a * W + Math.sin(lt * 2 + e * 9) * 40 * life, y = H * (1.05 - life * 1.1); c.globalAlpha = (1 - life) * .9; c.fillStyle = col(Q.c1, Q.c2, life); c.shadowColor = Q.c1; c.shadowBlur = 12; c.beginPath(); c.arc(x, y, sz * .35 * (1 - life * .6), 0, 6.283); c.fill(); break; }
    }
    c.restore();
  }
  return { src: cv, w: W, h: H };
}
const corsUrl = u => typeof u === 'string' && u.startsWith('nxmedia:');
function getEl(L) {
  if (L.type !== 'video' && L.type !== 'audio') return null;
  const m = media[L.media]; if (!m) return null;
  // playback may use a low-res proxy; export / exact-frame rendering always get the original (Proxies.active checks that)
  const px = L.type === 'video' && typeof Proxies !== 'undefined' && Proxies.active(m), key = px ? L.id + '#p' : L.id;
  let el = els.get(key);
  if (!el) {
    if (m.missing) return null;
    el = document.createElement(L.type === 'video' ? 'video' : 'audio'); const src = px ? m.proxyUrl : m.url; if (corsUrl(src)) el.crossOrigin = 'anonymous'; el.src = src; el.preload = 'auto'; el.playsInline = true; el._proxy = px;
    el.addEventListener('seeked', requestRender); el.addEventListener('loadeddata', requestRender); els.set(key, el); if (els.size > MEDIA_POOL) evictMedia();
  }
  return el;
}
/** a layer's pixels after its clip VFX graph (if any). contentOfBase = the raw content, used as the graph's input. */
function contentOf(L, t) {
  const C = contentOfBase(L, t); if (!C || !L.fxGraph || typeof VFX === 'undefined' || compDepth > 6) return C;
  const g = VFX.graph(L.fxGraph); if (!g) return C;
  compDepth++; try { const out = atFull(() => VFX.renderSync(g, t - L.start)); return out ? { src: out, w: C.w, h: C.h } : C; } finally { compDepth--; }
}
function contentOfBase(L, t) {
  switch (L.type) {
    case 'video': { const m = media[L.media]; if (m && m.missing && typeof Disk !== 'undefined') return { src: Disk.offlineCard(m), w: m.w || 1280, h: m.h || 720 }; const el = getEl(L); if (!el) return null; if (el.readyState < 2) return L._last || null; return (L._last = { src: el, w: el._proxy ? m.w : (el.videoWidth || m.w), h: el._proxy ? m.h : (el.videoHeight || m.h) }); }
    case 'image': { const m = media[L.media]; if (m && m.missing && !m.link && typeof Disk !== 'undefined') return { src: Disk.offlineCard(m), w: m.w || 1280, h: m.h || 720 }; return m && m.img ? { src: m.img, w: m.w, h: m.h } : null; }
    case 'text': return textCanvas(L, t);
    case 'shape': return shapeCanvas(L, t);
    case 'solid': return solidCanvas(L);
    case 'paint': return { src: L._canvas, w: L._canvas.width, h: L._canvas.height };
    case 'particles': return particleCanvas(L, t);
    case 'null': return { src: null, w: 100, h: 100 };
    case 'gen': return typeof Motion !== 'undefined' ? Motion.genCanvas(L, t, RW(), RH()) : null;
    case '3d': return typeof ThreeD !== 'undefined' ? ThreeD.layerFrame(L, t) : null;
    case 'vfx': { if (typeof VFX === 'undefined' || compDepth > 6) return null; const g = VFX.graph(L.graphRef); if (!g) return null; compDepth++; try { const c = atFull(() => VFX.renderSync(g, L.srcIn + (t - L.start) * L.speed)); return c ? { src: c, w: c.width, h: c.height } : null; } finally { compDepth--; } }
    case 'comp': {
      const src = compSource(L); if (!src || compDepth > 6) return null;
      const w = src.w || RW(), h = src.h || RH(), cv = L._cc && L._cc.width === w && L._cc.height === h ? L._cc : (L._cc = mkCanvas(w, h)), c = cv.getContext('2d');
      compDepth++; try { resetCtx(c); c.clearRect(0, 0, w, h); const lt = L.srcIn + (t - L.start) * L.speed; atFull(() => renderLayers(c, lt, L.mc && typeof Multicam !== 'undefined' ? Multicam.visible(L, lt) : src.layers, src)); } finally { compDepth--; }
      return { src: cv, w, h };
    }
  }
  return null;
}
let compDepth = 0, mbActive = false;
/** layers + settings behind a comp layer: inline precomp, or a linked NEXORA Motion composition */
function compSource(L) { if (L.compRef) return typeof Motion !== 'undefined' ? Motion.getComp(L.compRef) : null; return L.comp || null; }
function xform(L, t) {
  const lt = t - L.start, v = k => valueAt(L, k, lt);
  return { x: v('x'), y: v('y'), s: v('s'), sx: v('sx'), sy: v('sy'), rot: v('rot'), op: v('op'), rx: v('rx'), ry: v('ry') };
}
const scaleXY = (L, X) => [X.s / 100 * X.sx / 100 * (L.flipX ? -1 : 1), X.s / 100 * X.sy / 100 * (L.flipY ? -1 : 1)];

/* ====================== transitions ====================== */
function transMod(L, lt) {
  const m = { a: 1, dx: 0, dy: 0, s: 1, r: 0, blur: 0, wipe: null };
  const ap = (type, u0) => {
    if (type === 'none') return;
    u0 = clamp(u0, 0, 1); const u = type === 'pop' ? EASE.back(u0) : EASE.out(u0), v = 1 - u;
    switch (type) {
      case 'fade': m.a *= u; break;
      case 'slide-left': m.dx -= v * RW(); break;
      case 'slide-right': m.dx += v * RW(); break;
      case 'slide-up': m.dy -= v * RH(); break;
      case 'slide-down': m.dy += v * RH(); break;
      case 'zoom-in': m.s *= Math.max(u, .001); m.a *= Math.min(1, u0 * 2); break;
      case 'zoom-out': m.s *= lerp(2.5, 1, u); m.a *= u; break;
      case 'pop': m.s *= Math.max(u, 0); m.a *= Math.min(1, u0 * 3); break;
      case 'spin': m.r -= v * 180; m.s *= Math.max(u, .001); m.a *= u; break;
      case 'blur': m.blur += v * 40; m.a *= u; break;
      default: if (type.startsWith('wipe-')) m.wipe = { dir: type.slice(5), u: Math.max(u, .0001) };
    }
  };
  if (L.tin.type !== 'none' && lt < L.tin.dur) ap(L.tin.type, lt / L.tin.dur);
  const rem = L.dur - lt; if (L.tout.type !== 'none' && rem < L.tout.dur) ap(L.tout.type, rem / L.tout.dur);
  return m;
}

/* ====================== rendering ====================== */
function applyCss(S, str) {
  const B = getScratch('B'), bx = clearScratch(B); bx.filter = str; bx.drawImage(S, 0, 0); resetCtx(bx);
  const c = clearScratch(S); c.drawImage(B, 0, 0);
}
function runFx(S, L, t, lt) {
  const list = L.fx.filter(f => f.on); let i = 0;
  while (i < list.length) {
    if (typeof GPU !== 'undefined' && GPU.can(list[i].type) && GPU.on()) {
      // one upload → every consecutive GPU-capable effect (colour filters, blurs, glow, distortions, library) → one download
      const batch = []; while (i < list.length && GPU.can(list[i].type)) { batch.push({ type: list[i].type, p: fxParams(L, list[i], lt), t: lt, T: t, ld: L.dur }); i++; }   /* clip time + length: animated library effects and transitions; T = comp time (CPU twins use it) */
      if (!GPU.run(S, batch)) for (const b of batch) { const c = S._ctx; resetCtx(c); if (FX[b.type].css) applyCss(S, FX[b.type].css(b.p)); else FX[b.type].px(c, S, b.p, { t }); resetCtx(c); GPU.S.stats.cpuPasses++; }
    }
    else if (FX[list[i].type].css) { const parts = []; while (i < list.length && FX[list[i].type].css && !(typeof GPU !== 'undefined' && GPU.can(list[i].type) && GPU.on())) { parts.push(FX[list[i].type].css(fxParams(L, list[i], lt))); i++; } applyCss(S, parts.join(' ')); }
    else { const f = list[i++], c = S._ctx; resetCtx(c); FX[f.type].px(c, S, fxParams(L, f, lt), { t }); resetCtx(c); if (typeof GPU !== 'undefined') GPU.S.stats.cpuPasses++; }
  }
}
function applyMask(S, L, lt) {
  const m = L.mask; if (!m || !m.on) return;
  const M = getScratch('M'), mc = clearScratch(M), mv = k => valueAt(L, 'mask.' + k, lt);
  const x = mv('x'), y = mv('y'), w = mv('w'), h = mv('h'), fe = mv('feather');
  if (RQ !== 1) mc.setTransform(RQ, 0, 0, RQ, 0, 0); mc.fillStyle = '#000'; if (fe > 0) mc.filter = `blur(${fe * RQ}px)`;
  mc.beginPath(); if (m.shape === 'ellipse') mc.ellipse(x, y, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2); else mc.rect(x - w / 2, y - h / 2, w, h);
  mc.fill(); mc.filter = 'none';
  const sc = S._ctx; resetCtx(sc); sc.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in'; sc.drawImage(M, 0, 0); resetCtx(sc);
}
function applyWipe(S, wipe) {
  const c = S._ctx, W = S.width, H = S.height, u = wipe.u; resetCtx(c); c.globalCompositeOperation = 'destination-in'; c.fillStyle = '#000';
  const r = { left: [0, 0, W * u, H], right: [W * (1 - u), 0, W * u, H], up: [0, 0, W, H * u], down: [0, H * (1 - u), W, H * u] }[wipe.dir];
  c.fillRect(...r); resetCtx(c);
}
function applyMatte(S, L, t) {
  const m = L.matte; if (!m || m.mode === 'none') return;
  const src = (curLayers || P.layers).find(l => l.id === m.src); if (!src || src === L) return;
  const MT = getScratch('MT'), mc = clearScratch(MT);
  if (t >= src.start && t < src.start + src.dur) { try { drawLayer(mc, src, t, 'A2', true); } catch (e) { } }
  resetCtx(mc);
  if (m.mode === 'luma' || m.mode === 'lumaInv') pix(mc, MT, d => { for (let i = 0; i < d.length; i += 4) { const l = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / 255 * d[i + 3]; d[i + 3] = m.mode === 'luma' ? l : 255 - l; d[i] = d[i + 1] = d[i + 2] = 0; } });
  const sc = S._ctx; resetCtx(sc); sc.globalCompositeOperation = m.mode === 'alphaInv' ? 'destination-out' : 'destination-in'; sc.drawImage(MT, 0, 0); resetCtx(sc);
}
function drawLayer(ctx, L, t, slot, asMatte) {
  const lt = t - L.start, mod = transMod(L, lt);
  if (mod.a <= 0 || L.type === 'null') return;
  if (L.type === 'adjust') {
    const op = valueAt(L, 'op', lt) / 100 * mod.a; if (op <= 0) return;
    const A = copyTo('A', ctx.canvas); runFx(A, L, t, lt); applyMask(A, L, lt);
    ctx.globalAlpha = op; ctx.drawImage(A, 0, 0); ctx.globalAlpha = 1; return;
  }
  const C = contentOf(L, t); if (!C || !C.w) return;
  const X = xform(L, t), op = X.op / 100 * mod.a; if (op <= 0) return;
  const k = mod.s, M = worldMat(L, t);
  const place = c => {
    if (RQ !== 1) c.scale(RQ, RQ); c.translate(mod.dx, mod.dy); c.transform(M[0], M[1], M[2], M[3], M[4], M[5]); c.rotate(mod.r * Math.PI / 180); c.scale(k, k);
    if (X.rx || X.ry) drawMesh(c, C.src, C.w, C.h, X.rx, X.ry); else c.drawImage(C.src, -C.w / 2, -C.h / 2, C.w, C.h);
  };
  const fx = L.fx.filter(f => f.on), hasMatte = !asMatte && L.matte && L.matte.mode !== 'none' && (curLayers || P.layers).some(l => l.id === L.matte.src);
  const needTmp = fx.some(f => !FX[f.type].css) || (L.mask && L.mask.on) || mod.wipe || hasMatte;
  if (!needTmp) {
    const css = fx.map(f => FX[f.type].css(fxParams(L, f, lt))); if (mod.blur > .5) css.push(`blur(${mod.blur * RQ}px)`);
    ctx.save(); ctx.globalAlpha = clamp(op, 0, 1); ctx.globalCompositeOperation = L.blend; if (css.length) ctx.filter = css.join(' ');
    place(ctx); ctx.restore(); return;
  }
  const A = getScratch(slot || 'A'), a = clearScratch(A); a.save(); place(a); a.restore(); resetCtx(a);
  runFx(A, L, t, lt); if (mod.blur > .5) applyCss(A, `blur(${mod.blur * RQ}px)`);
  applyMask(A, L, lt); if (mod.wipe) applyWipe(A, mod.wipe); if (hasMatte) applyMatte(A, L, t);
  if (asMatte) { ctx.drawImage(A, 0, 0); return; }
  ctx.save(); ctx.globalAlpha = clamp(op, 0, 1); ctx.globalCompositeOperation = L.blend; ctx.drawImage(A, 0, 0); ctx.restore();
}
/** render a layer list onto ctx. comp = owner settings ({fps, motionBlur}) of this list, if any */
function renderLayers(ctx, t, layers, comp) {
  const prev = curLayers, prevRS = RS; curLayers = layers; RS = { w: ctx.canvas.width, h: ctx.canvas.height };
  const mb = comp && comp.motionBlur && comp.motionBlur.on ? comp.motionBlur : null, fps = (comp && comp.fps) || P.fps;
  const solo = layers.some(l => l.solo), mattes = new Set(layers.filter(l => l.matte && l.matte.mode !== 'none').map(l => l.matte.src));
  try {
    for (const L of layers) {
      if (!L.visible || (solo && !L.solo) || mattes.has(L.id)) continue;
      if (t < L.start || t >= L.start + L.dur) continue;
      try { if (mb && L.mblur && L.type !== 'adjust' && !mbActive) drawLayerBlurred(ctx, L, t, mb, fps); else drawLayer(ctx, L, t); } catch (e) { console.error('layer render', L.name, e); }
    }
  } finally { curLayers = prev; RS = prevRS; }
}
/** motion blur: average N renders across the shutter interval (additive 1/N accumulation = true average) */
function drawLayerBlurred(ctx, L, t, mb, fps) {
  const N = clamp(mb.samples | 0, 2, 32), span = clamp(mb.shutter, 1, 720) / 360 / fps, acc = getScratch('MBacc'), sub = getScratch('MBsub'), ac = clearScratch(acc), blend = L.blend;
  L.blend = 'source-over'; mbActive = true;
  try { for (let i = 0; i < N; i++) { const ti = t + (i / (N - 1) - .5) * span; if (ti < L.start || ti >= L.start + L.dur) continue; const sc = clearScratch(sub); drawLayer(sc, L, ti); resetCtx(sc); ac.globalCompositeOperation = 'lighter'; ac.globalAlpha = 1 / N; ac.drawImage(sub, 0, 0); } }
  finally { L.blend = blend; mbActive = false; }
  resetCtx(ac); ctx.save(); ctx.globalCompositeOperation = blend; ctx.drawImage(acc, 0, 0); ctx.restore();
}
function renderComp(ctx, t) {
  if (view.width !== P.w || view.height !== P.h) { view.width = P.w; view.height = P.h; }
  if (ctx === vctx && RQnext < 1) return renderScaled(ctx, t, RQnext);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  if (P.bg === 'transparent') ctx.clearRect(0, 0, P.w, P.h); else { ctx.fillStyle = P.bg; ctx.fillRect(0, 0, P.w, P.h); }
  renderLayers(ctx, t, P.layers, P);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
}
/* reduced-resolution preview: draw into a smaller canvas, then fill the viewer. The viewer canvas keeps the project size, so
   scopes, the eyedropper and the on-canvas handles need no changes. Exports and frame grabs never pass through here. */
let pvC = null;
function renderScaled(ctx, t, q) {
  const w = Math.max(2, Math.round(P.w * q)), h = Math.max(2, Math.round(P.h * q)); if (!pvC || pvC.width !== w || pvC.height !== h) { pvC = mkCanvas(w, h); pvC._c = pvC.getContext('2d'); }
  const c = pvC._c; resetCtx(c); if (P.bg === 'transparent') c.clearRect(0, 0, w, h); else { c.fillStyle = P.bg; c.fillRect(0, 0, w, h); }
  RQ = q; try { renderLayers(c, t, P.layers, P); } finally { RQ = 1; }
  resetCtx(c); resetCtx(ctx); if (P.bg === 'transparent') ctx.clearRect(0, 0, P.w, P.h); ctx.drawImage(pvC, 0, 0, P.w, P.h);
}
/* Auto lowers the preview only when frames miss their time, and raises it again once there is clear headroom. A still frame is
   always redrawn at full resolution a moment after you stop. */
const Preview = {
  mode: (() => { try { return localStorage.getItem('nx.previewQ') || 'auto'; } catch (e) { return 'auto'; } })(), level: 1, full: false, timer: 0, hold: 0, last: 1,
  set(m) { Preview.mode = m; Preview.level = 1; try { localStorage.setItem('nx.previewQ', m); } catch (e) { } dirty = true; },
  q() { if (exporting || offlineBusy) return 1; if (Preview.full) { Preview.full = false; return 1; } const q = Preview.mode === 'auto' ? Preview.level : +Preview.mode; if (q < 1 && !playing) { clearTimeout(Preview.timer); Preview.timer = setTimeout(() => { Preview.full = true; dirty = true; }, 180); } return q; },
  adapt(ms, now) { if (Preview.mode !== 'auto' || !playing || now < Preview.hold) return; const b = 1000 / (P.fps || 30); if (ms > b * .95 && Preview.level > .25) { Preview.level /= 2; Preview.hold = now + 700; Perf.ms = 0; } else if (ms < b * .2 && Preview.level < 1) { Preview.level *= 2; Preview.hold = now + 2500; Perf.ms = 0; } }
};
/* ---- matrices: parenting + 3D ---- */
let curLayers = null;
const matMul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function localMat(L, t) { const X = xform(L, t), [kx, ky] = scaleXY(L, X), a = X.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c * kx, s * kx, -s * ky, c * ky, X.x, X.y]; }
function worldMat(L, t, list) {
  list = list || curLayers || P.layers; const chain = []; let c = L, g = 0;
  while (c && g++ < 20) { chain.push(c); c = c.parent ? list.find(l => l.id === c.parent) : null; }
  let m = [1, 0, 0, 1, 0, 0]; for (let i = chain.length - 1; i >= 0; i--) m = matMul(m, localMat(chain[i], t)); return m;
}
const matApply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
function matInv(m) { const det = m[0] * m[3] - m[1] * m[2] || 1e-9; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]; }
function parentMat(L, t, list) { list = list || curLayers || P.layers; const p = L.parent && list.find(l => l.id === L.parent); return p ? worldMat(p, t, list) : [1, 0, 0, 1, 0, 0]; }
function setParent(L, id) {
  const t = T, list = P.layers, W = worldMat(L, t, list), rotW = Math.atan2(W[1], W[0]) * 180 / Math.PI, sW = Math.hypot(W[0], W[1]);
  if (id) { let c = list.find(l => l.id === id); for (let g = 0; c && g < 20; g++) { if (c === L) return false; c = c.parent ? list.find(l => l.id === c.parent) : null; } }
  L.parent = id || '';
  const PM = parentMat(L, t, list), q = matApply(matInv(PM), W[4], W[5]), pr = Math.atan2(PM[1], PM[0]) * 180 / Math.PI, ps = Math.hypot(PM[0], PM[1]) || 1;
  for (const k of ['x', 'y', 'rot', 's']) delete L.kf[k];
  L.tr.x = +q.x.toFixed(2); L.tr.y = +q.y.toFixed(2); L.tr.rot = +(rotW - pr).toFixed(2); L.tr.s = +(sW / ps * 100 / (L.tr.sx / 100 || 1)).toFixed(2);
  return true;
}
/* perspective-mapped drawing for 3D rotation (affine triangle mesh) */
function drawMesh(c, src, w, h, rx, ry) {
  const N = 12, D = 900, ax = rx * Math.PI / 180, ay = ry * Math.PI / 180, cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  const proj = (x, y) => { const x1 = x * cy, z1 = -x * sy, y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx, f = D / (D + z2); return [x1 * f, y2 * f]; };
  const pts = []; for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const x = -w / 2 + w * i / N, y = -h / 2 + h * j / N; pts.push({ s: [x, y], d: proj(x, y) }); }
  const tri = (a, b, d) => {
    const [x0, y0] = a.s, [x1, y1] = b.s, [x2, y2] = d.s, [u0, v0] = a.d, [u1, v1] = b.d, [u2, v2] = d.d, den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1); if (Math.abs(den) < 1e-6) return;
    const A = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den, Cc = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den, E = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
    const B = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den, Dd = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den, F = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
    c.save(); c.beginPath(); const e = .6, mx = (u0 + u1 + u2) / 3, my = (v0 + v1 + v2) / 3, ex = (p, m) => p + Math.sign(p - m) * e;
    c.moveTo(ex(u0, mx), ex(v0, my)); c.lineTo(ex(u1, mx), ex(v1, my)); c.lineTo(ex(u2, mx), ex(v2, my)); c.closePath(); c.clip();
    c.transform(A, B, Cc, Dd, E, F); c.drawImage(src, -w / 2, -h / 2, w, h); c.restore();
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const p00 = pts[j * (N + 1) + i], p10 = pts[j * (N + 1) + i + 1], p01 = pts[(j + 1) * (N + 1) + i], p11 = pts[(j + 1) * (N + 1) + i + 1]; tri(p00, p10, p01); tri(p10, p11, p01); }
}
/* ---- nested compositions ---- */
const compStack = [];
function projectState() { return compStack.length ? Object.assign({}, P, { layers: compStack[0].parentLayers, dur: compStack[0].parentDur }) : P; }
function enterComp(L) { if (L.type !== 'comp') return; compStack.push({ layer: L, parentLayers: P.layers, parentDur: P.dur, parentT: T }); P.layers = L.comp.layers; P.dur = L.comp.dur; selId = null; T = 0; structChanged(); uiComp(); }
function exitComp() { const s = compStack.pop(); if (!s) return; s.layer.comp.dur = P.dur; P.layers = s.parentLayers; P.dur = s.parentDur; selId = s.layer.id; T = s.parentT; structChanged(); uiComp(); }
function exitAllComps() { while (compStack.length) exitComp(); }
function precompose(L) {
  if (!L || L.type === 'comp' && false) return; const list = P.layers, i = list.indexOf(L), start = L.start;
  list.forEach(o => { if (o.parent === L.id) { setParent(o, ''); } if (o.matte && o.matte.src === L.id) o.matte = { mode: 'none', src: '' }; });
  L.parent = ''; L.start = 0; const C = mkLayer('comp', { name: L.name + ' (comp)', start, dur: L.dur }); C.comp = { layers: [L], dur: L.dur };
  list[i] = C; selId = C.id; structChanged(); return C;
}

/* ====================== audio / media sync ====================== */
let AC = null, ACdest = null;
function ensureAudio() { if (!AC) { AC = new (window.AudioContext || window.webkitAudioContext)(); ACdest = AC.createMediaStreamDestination(); } if (AC.state === 'suspended') AC.resume(); }
function connectEl(el) {
  if (el._node) return; ensureAudio();
  try { el._node = AC.createMediaElementSource(el); if (typeof AudioMix !== 'undefined') AudioMix.attach(el); else { el._node.connect(AC.destination); el._node.connect(ACdest); } } catch (e) { }
}
/* Browsers cope badly with hundreds of open decoders, and every cut would otherwise keep its own. Only clips near the playhead
   hold one; the rest are released and reopen on demand. */
const MEDIA_POOL = 16;
function nearKeys() { const want = new Set(); for (let k = -1; k <= 8; k++) for (const a of collectMedia(P.layers, Math.max(0, T + k), [])) { want.add(a.L.id); want.add(a.L.id + '#p'); } return want; }
function evictMedia() {
  const want = nearKeys(), byId = new Map(P.layers.map(l => [l.id, l])); let n = els.size;
  for (const [key, e] of els) { if (n <= MEDIA_POOL - 6) break; if (want.has(key) || !e.paused) continue; try { if (e._node) e._node.disconnect(); e.removeAttribute('src'); e.load(); } catch (x) { } els.delete(key); n--; const L = byId.get(key.replace('#p', '')); if (L) L._last = null; }
}
function preloadNear() { let n = 0; const seen = new Set(); for (let k = 0; k <= 8 && n < 10; k += 2) for (const a of collectMedia(P.layers, T + k, [])) if (!seen.has(a.L.id)) { seen.add(a.L.id); getEl(a.L); n++; } }
/** seeks the clip that starts next to its first frame just before the cut, so the cut does not wait for a seek */
function prerollMedia(t) { for (const L of P.layers) { if ((L.type !== 'video' && L.type !== 'audio') || !L.visible) continue; const d = L.start - t; if (d <= 0 || d > 1.2) continue; const e = getEl(L); if (e && e.paused && !e.seeking && Math.abs(e.currentTime - L.srcIn) > .03) e.currentTime = L.srcIn; } }
let lastPreroll = 0;
function collectMedia(layers, t, out) {
  const solo = layers.some(l => l.solo);
  for (const L of layers) {
    if (!L.visible || (solo && !L.solo)) continue; const lt = t - L.start; if (lt < 0 || lt >= L.dur) continue;
    if (L.type === 'comp') { const s = compSource(L); if (s && out.length < 500) collectMedia(s.layers, L.srcIn + lt * L.speed, out); }
    else if (L.type === 'video' || L.type === 'audio') out.push({ L, t });
  }
  return out;
}
function syncMedia(t, play) {
  const act = collectMedia(P.layers, t, []), live = new Set();
  for (const a of act) { const e = getEl(a.L); if (e) live.add(e); }
  els.forEach(e => { if (!live.has(e) && !e.paused) e.pause(); });     // includes the original/proxy twin that is not in use
  for (const { L, t: tt } of act) {
    const el = getEl(L); if (!el) continue;
    const lt = tt - L.start;
    const target = L.srcIn + lt * L.speed;
    el.playbackRate = clamp(L.speed * Math.abs(playRate || 1), .0625, 16);
    // element volume is 0…1: the 100–200 % range is carried by a gain stage in the mixer strip
    const vol = valueAt(L, 'vol', lt) / 100 * transMod(L, lt).a;
    el.muted = !!L.muted; el.volume = clamp(vol, 0, 1); if (el._strip) el._strip.boost = Math.max(1, vol);
    if (typeof AudioMix !== 'undefined') AudioMix.update(el, L);
    if (play) {
      connectEl(el);
      if (el.paused) { if (Math.abs(el.currentTime - target) > .06) el.currentTime = target; el.play().catch(() => { }); }
      else if (Math.abs(el.currentTime - target) > .35) el.currentTime = target;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - target) > .012) el.currentTime = target;
    }
  }
}
function pauseAllMedia() { els.forEach(e => { if (!e.paused) e.pause(); }); }

/* ====================== transport ====================== */
let playRate = 1;
function seek(t) { T = clamp(frameQ(t), 0, P.dur); if (playing) { playT0 = T; wall0 = performance.now(); pauseAllMedia(); } requestRender(); uiTime(); }
function play() { if (playing) return; if (T >= P.dur - .02) T = 0; ensureAudio(); playing = true; playT0 = T; wall0 = performance.now(); uiPlayState(); }
function pause() { if (!playing) return; playing = false; playRate = 1; pauseAllMedia(); requestRender(); uiPlayState(); }
function togglePlay() { playing ? pause() : play(); }
/* render-time meter: smoothed ms per composited frame + delivered fps while playing */
const Perf = {
  ms: 0, fps: 0, last: 0, frames: [], el: null, shown: 0,
  frame(ms, now) {
    Perf.ms = Perf.ms ? Perf.ms * .85 + ms * .15 : ms;
    if (playing) { Perf.frames.push(now); while (Perf.frames.length && now - Perf.frames[0] > 1000) Perf.frames.shift(); Perf.fps = Perf.frames.length; } else { Perf.frames.length = 0; Perf.fps = 0; }
    if (now - Perf.shown > 250) { Perf.shown = now; Perf.paint(); }
  },
  paint() {
    const e = Perf.el || (Perf.el = document.getElementById('perfRead')); if (!e) return;
    const mode = typeof GPU !== 'undefined' ? GPU.status() : 'CPU', budget = 1000 / (P.fps || 30);
    e.textContent = `${mode} · ${Perf.ms.toFixed(1)} ms${Preview.last < 1 ? ' · 1/' + Math.round(1 / Preview.last) : ''}${playing ? ` · ${Perf.fps} fps` : ''}`;
    e.classList.toggle('warn', Perf.ms > budget); e.title = `Render time per frame (budget at ${P.fps} fps: ${budget.toFixed(1)} ms). Click to switch GPU effects ${typeof GPU !== 'undefined' && GPU.S.enabled ? 'off' : 'on'}.`;
  }
};
function tick(now) {
  if (playing) {
    T = playT0 + (now - wall0) / 1000 * playRate;          // J/K/L shuttle: ±1, 2, 4, 8×
    if (T < 0) { T = 0; pause(); }
    if (T >= P.dur) { if (loopPlay && !exporting) { T = 0; playT0 = 0; wall0 = now; pauseAllMedia(); } else { T = P.dur; pause(); if (exporting) onExportEnd(); } }
  }
  if (offlineBusy) { requestAnimationFrame(tick); return; }
  if (playing && now - lastPreroll > 200) { lastPreroll = now; prerollMedia(T); }
  if (playing || dirty) { dirty = false; syncMedia(T, playing && playRate > 0);   /* reverse = scrubbing (media elements cannot play backwards) */ const r0 = performance.now(), q = Preview.q(); RQnext = q; Preview.last = q; try { renderComp(vctx, T); } finally { RQnext = 1; } Perf.frame(performance.now() - r0, now); Preview.adapt(Perf.ms, now); uiTime(); drawOverlay(); }
  requestAnimationFrame(tick);
}

/* ====================== history ====================== */
const hist = { stack: [], i: -1 };
function snapshot() {
  const paints = {};
  for (const L of P.layers) if (L.type === 'paint') { if (!(L._snap && L._snapVer === L._ver)) { L._snap = cloneCanvas(L._canvas); L._snapVer = L._ver; } paints[L.id] = L._snap; }
  return { json: ser(projectState()), paints, sel: selId };
}
function commit() {
  hist.stack.length = hist.i + 1; hist.stack.push(snapshot()); if (hist.stack.length > 80) hist.stack.shift(); hist.i = hist.stack.length - 1; uiHistory();
}
function restore(s) {
  P = JSON.parse(s.json);
  for (const L of P.layers) if (L.type === 'paint') { L._canvas = cloneCanvas(s.paints[L.id]); L._ver = 1; L._snap = s.paints[L.id]; L._snapVer = 1; }
  selId = P.layers.some(l => l.id === s.sel) ? s.sel : null; T = clamp(T, 0, P.dur);
  if (typeof Motion !== 'undefined') Motion.onRestore();   // keep the composition library pointing at the restored object
  structChanged();
}
function undo() { exitAllComps(); if (hist.i > 0) { hist.i--; restore(hist.stack[hist.i]); uiHistory(); } }
function redo() { exitAllComps(); if (hist.i < hist.stack.length - 1) { hist.i++; restore(hist.stack[hist.i]); uiHistory(); } }

/* ====================== media import ====================== */
async function importFile(file) {
  let kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : null;
  if (typeof Disk !== 'undefined' && (!kind || /\.(mxf|mov|avi|mkv|mts|m2ts|ts|wmv|flv|mpg|mpeg|3gp)$/i.test(file.name))) kind = Disk.kindOf(file.name) || kind;   // .mxf/.mts etc. often have no MIME type
  if (!kind) { toast(file.name + ': unsupported file type'); return null; }
  const m = { id: uid(), name: file.name, kind, blob: file, url: URL.createObjectURL(file), w: 0, h: 0, dur: 5 };
  if (typeof Disk !== 'undefined') Disk.adopt(m, file);          // desktop: link the file on disk instead of copying it
  await initMedia(m); media[m.id] = m; uiMedia(); return m;
}
/* desktop app: a file Chromium cannot decode (ProRes, DNxHR, MXF, TIFF, EXR, AIFF…) is converted once by the bundled
   FFmpeg into an edit-friendly copy ("optimized media"); the original path is kept in m.source */
async function initMedia(m) {
  const ok = await initMediaRaw(m);
  if (!ok && typeof ProMedia !== 'undefined' && ProMedia.canOptimize(m)) { try { await ProMedia.optimize(m); await initMediaRaw(m); } catch (e) { toast(m.name + ': ' + (e.message || e)); } }
}
async function initMediaRaw(m) {
  if (m.kind === 'image') {
    const img = new Image(); if (corsUrl(m.url)) img.crossOrigin = 'anonymous'; img.src = m.url; await new Promise(r => { img.onload = r; img.onerror = r; }); m.img = img; m.w = img.naturalWidth; m.h = img.naturalHeight; m.thumb = m.url;
    return m.w > 0;
  } else if (m.kind === 'video') {
    const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; if (corsUrl(m.url)) v.crossOrigin = 'anonymous'; v.src = m.url;
    let failed = false; await new Promise(r => { v.onloadedmetadata = r; v.onerror = () => { failed = true; r(); }; });
    if (failed || !v.videoWidth) { v.removeAttribute('src'); v.load(); return false; }
    if (!isFinite(v.duration)) { v.currentTime = 1e7; await new Promise(r => { v.ontimeupdate = r; setTimeout(r, 2000); }); }
    m.w = v.videoWidth; m.h = v.videoHeight; m.dur = isFinite(v.duration) ? v.duration : 10;
    v.currentTime = Math.min(.3, m.dur / 3); await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
    try { const c = mkCanvas(160, Math.max(1, Math.round(160 * m.h / (m.w || 1)))); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); m.thumb = c.toDataURL('image/jpeg', .7); } catch (e) { }
    v.removeAttribute('src'); v.load();                          // release the decoder and the file handle (Windows locks open files)
    computePeaks(m); return true;
  } else {
    const a = document.createElement('audio'); a.preload = 'metadata'; if (corsUrl(m.url)) a.crossOrigin = 'anonymous'; a.src = m.url;
    let failed = false; await new Promise(r => { a.onloadedmetadata = r; a.onerror = () => { failed = true; r(); }; });
    if (failed) { a.removeAttribute('src'); a.load(); return false; }
    // MediaRecorder WebM has no duration header: seeking far past the end makes the browser compute the real length
    if (!isFinite(a.duration)) { a.currentTime = 1e7; await new Promise(r => { a.ontimeupdate = r; a.ondurationchange = () => isFinite(a.duration) && r(); setTimeout(r, 2000); }); }
    m.dur = isFinite(a.duration) ? a.duration : 10; a.removeAttribute('src'); a.load();
    computePeaks(m); return true;
  }
}
async function computePeaks(m) {
  try {
    if (m.blob.size > 150e6) return;
    const buf = await m.blob.arrayBuffer(); const ac = new OfflineAudioContext(1, 1, 44100); const ab = await ac.decodeAudioData(buf);
    const d = ab.getChannelData(0), n = Math.ceil(ab.duration * 50), step = Math.max(1, Math.floor(d.length / n)), pk = new Float32Array(n);
    for (let i = 0; i < n; i++) { let mx = 0; const s = i * step, e = Math.min(d.length, s + step), inc = Math.max(1, Math.floor(step / 24)); for (let j = s; j < e; j += inc) { const v = Math.abs(d[j]); if (v > mx) mx = v; } pk[i] = mx; }
    m.peaks = pk; structChanged(true);
  } catch (e) { }
}
function addMediaLayer(m, start) {
  start = start === undefined ? T : start;
  let L;
  if (m.kind === 'image') { const s = Math.min(P.w / m.w, P.h / m.h) * 100; L = mkLayer('image', { name: m.name, media: m.id, start, dur: 5 }); L.tr.s = +s.toFixed(2); }
  else if (m.kind === 'video') { const s = Math.min(P.w / m.w, P.h / m.h) * 100; L = mkLayer('video', { name: m.name, media: m.id, start, dur: m.dur }); L.tr.s = +s.toFixed(2); }
  else L = mkLayer('audio', { name: m.name, media: m.id, start, dur: m.dur });
  addLayer(L); commit(); return L;
}

/* ====================== project IO ====================== */
const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
function allMediaIds(layers, s) { s = s || new Set(); layers.forEach(l => { if (l.media) s.add(l.media); if (l.comp) allMediaIds(l.comp.layers, s); }); return s; }
/** plain-JSON copy of a timeline (project or Motion comp); paint layers carry their pixels as PNG */
function projectData(p) { const out = JSON.parse(ser(p)); out.layers.forEach((l, i) => { if (l.type === 'paint' && p.layers[i]._canvas) l.png = p.layers[i]._canvas.toDataURL('image/png'); }); return out; }
async function restorePaint(p) {
  for (const l of p.layers) if (l.type === 'paint') { l._canvas = mkCanvas(p.w, p.h); l._ver = 0; if (l.png) { const img = new Image(); img.src = l.png; await new Promise(r => { img.onload = r; img.onerror = r; }); l._canvas.getContext('2d').drawImage(img, 0, 0); delete l.png; } }
}
// Edit section of a project. opts.data=false skips embedding media bytes (used by crash-recovery when media is huge).
// opts.project serializes a timeline other than the live P (used while NEXORA Motion has swapped P to a composition).
async function projectToJSON(opts) {
  opts = opts || {}; const proj = opts.project || P; if (proj === P) exitAllComps();
  const out = projectData(proj), ids = new Set([...allMediaIds(proj.layers), ...Object.keys(media)]), med = {};
  for (const id of ids) {
    const m = media[id]; if (!m) continue;
    if (m.link && !m.blob && window.Assets) await Assets.ensureBlob(m);
    // desktop media linked by path is stored as a reference (path + project-relative path) unless a portable file embeds everything
    const ref = m.path && !opts.embedPaths && typeof Disk !== 'undefined' ? Disk.describe(m) : null;
    med[id] = Object.assign({ id, name: m.name, kind: m.kind, w: m.w, h: m.h, dur: m.dur, size: m.blob ? m.blob.size : m.size, link: m.link || undefined, vec: m.vec || undefined }, ref || (m.path ? { path: m.path } : {}),
      { data: ref || opts.data === false || !m.blob || m.missing ? null : await blobToDataURL(typeof Disk !== 'undefined' ? await Disk.realBlob(m) : m.blob) });
  }
  return JSON.stringify({ fusion: 1, project: out, media: med });
}
async function loadProjectJSON(src) {
  const d = typeof src === 'string' ? JSON.parse(src) : src; if (!d.fusion && !d.project) throw new Error('Not a NEXORA / Fusion project');
  for (const k in media) delete media[k];
  for (const id in d.media) {
    const mm = d.media[id];
    if (!mm.data && (mm.path || mm.rel) && typeof Disk !== 'undefined') { const m = await Disk.resolve(id, mm); m.size = mm.size; media[id] = m; continue; }
    if (!mm.data) { media[id] = { id, name: mm.name, kind: mm.kind, w: mm.w, h: mm.h, dur: mm.dur, link: mm.link, missing: !mm.link }; continue; }
    const blob = await (await fetch(mm.data)).blob(); const m = { id, name: mm.name, kind: mm.kind, blob, url: URL.createObjectURL(blob), w: mm.w, h: mm.h, dur: mm.dur, link: mm.link, vec: mm.vec };
    await initMedia(m); media[id] = m;
  }
  els.forEach(e => { e.pause(); e.removeAttribute('src'); e.load(); }); els.clear();
  P = d.project; P.markers = P.markers || [];
  await restorePaint(P);
  selId = null; T = 0; hist.stack = []; hist.i = -1; structChanged(); commit();
}
