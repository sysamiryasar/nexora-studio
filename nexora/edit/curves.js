'use strict';
/* ====================== NEXORA curves ======================
   Custom curves: a luma (master) curve and R, G, B curves, each a monotone cubic (Fritsch–Carlson, so it never
   overshoots) through freely placed points. The four curves are combined into one 256-entry table per channel
   (channel ∘ master), applied on the GPU through a 256×1 float texture and on the CPU from the same table.
   Points are stored as a JSON string on the effect, so undo, copy/paste and saving treat them like any value. */
const Curves = (() => {
  const CH = ['m', 'r', 'g', 'b'], NAMES = { m: 'Luma', r: 'Red', g: 'Green', b: 'Blue' };
  const DEF = JSON.stringify({ m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });
  const parse = s => { try { const o = typeof s === 'string' ? JSON.parse(s) : s; return CH.every(k => Array.isArray(o[k]) && o[k].length >= 2) ? o : JSON.parse(DEF); } catch (e) { return JSON.parse(DEF); } };
  /** monotone cubic through points (sorted by x) → function on [0, 1] */
  function spline(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0]), n = p.length, x = p.map(q => q[0]), y = p.map(q => q[1]);
    if (n === 2) return v => y[0] + (y[1] - y[0]) * clamp((v - x[0]) / Math.max(1e-6, x[1] - x[0]), 0, 1);
    const d = [], m = new Array(n); for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / Math.max(1e-6, x[i + 1] - x[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2]; for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    return v => {
      if (v <= x[0]) return y[0]; if (v >= x[n - 1]) return y[n - 1]; let i = 0; while (i < n - 2 && v > x[i + 1]) i++;
      const h = x[i + 1] - x[i], t = (v - x[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }
  const cache = new Map();
  /** combined table: 256 × RGBA floats, out_c = curve_c(curve_luma(v)) */
  function table(s) {
    const key = typeof s === 'string' ? s : JSON.stringify(s); let t = cache.get(key); if (t) return t;
    const o = parse(key), f = CH.map(k => spline(o[k])); t = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++) { const v = clamp(f[0](i / 255), 0, 1); for (let c = 0; c < 3; c++) t[i * 4 + c] = clamp(f[c + 1](v), 0, 1); t[i * 4 + 3] = 1; }
    cache.set(key, t); if (cache.size > 64) cache.delete(cache.keys().next().value); return t;
  }
  const isIdentity = s => { const t = table(s); for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) if (Math.abs(t[i * 4 + c] * 255 - i) > .5) return false; return true; };

  FX.curves = { id: 'curves', name: 'Curves', cat: 'Color', hidden: true, params: [{ k: 'pts', label: 'Curve points', type: 'hidden', def: DEF }, N('amount', 'Mix', 0, 100, 100, 1, '%')],
    px(ctx, cv, p) { const t = table(p.pts), a = clamp(p.amount / 100, 0, 1); pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const v = d[i + c]; d[i + c] = v + (t[v * 4 + c] * 255 - v) * a; } }); } };
  if (typeof GPU !== 'undefined') GPU.register('curves', { src: `#version 300 es
precision highp float; uniform sampler2D src; uniform sampler2D lut; uniform vec2 size; uniform float amt; out vec4 o;
float tc(float v) { return (v * 255.0 + 0.5) / 256.0; }
void main() { vec4 c = texelFetch(src, ivec2(gl_FragCoord.xy), 0); vec3 r = vec3(texture(lut, vec2(tc(c.r), .5)).r, texture(lut, vec2(tc(c.g), .5)).g, texture(lut, vec2(tc(c.b), .5)).b); o = vec4(mix(c.rgb, r, amt), c.a); }`,
    uniforms: { amt: 'f' }, uni: p => ({ amt: clamp(p.amount / 100, 0, 1), _pts: typeof p.pts === 'string' ? p.pts : DEF }),
    tex: v => ({ key: 'curves:' + v._pts, w: 256, h: 1, data: table(v._pts) }) });

  /* ---------- editor ---------- */
  /** f = a curves effect; onLive() while dragging, onDone() on release */
  function editor(f, onLive, onDone) {
    const S = { ch: 'm', drag: -1 }; let o = parse(f.p.pts);
    const cv = el('canvas', { class: 'cv-edit', width: 520, height: 520, title: 'Click to add a point · drag to move · double-click a point to remove it' });
    const tabs = el('div', { class: 'seg cv-tabs' }), save = () => { f.p.pts = JSON.stringify(o); };
    const COL = { m: '#ffffff', r: '#ff8a8a', g: '#8fe3a0', b: '#8ab8ff' };
    const draw = () => {
      const x = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 14, w = W - pad * 2, h = H - pad * 2, X = v => pad + v * w, Y = v => pad + (1 - v) * h;
      x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, W, H);
      const st = typeof Scopes !== 'undefined' && Scopes.S.stats; if (st) { const hi = st.hist[{ m: 3, r: 0, g: 1, b: 2 }[S.ch]], mx = Math.max(1, ...Array.from(hi).slice(2, 254)); x.fillStyle = '#ffffff14'; x.beginPath(); x.moveTo(X(0), Y(0)); for (let i = 0; i < 256; i++) x.lineTo(X(i / 255), Y(Math.min(1, hi[i] / mx) * .9)); x.lineTo(X(1), Y(0)); x.fill(); }
      x.strokeStyle = '#ffffff12'; x.lineWidth = 2; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(X(i / 4), Y(0)); x.lineTo(X(i / 4), Y(1)); x.moveTo(X(0), Y(i / 4)); x.lineTo(X(1), Y(i / 4)); x.stroke(); }
      x.strokeStyle = '#ffffff26'; x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(1), Y(1)); x.stroke();
      for (const k of CH) if (k !== S.ch) { const s = spline(o[k]); if (o[k].length === 2 && o[k][0][1] === 0 && o[k][1][1] === 1) continue; x.strokeStyle = COL[k] + '55'; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 128; i++) { const v = i / 128; i ? x.lineTo(X(v), Y(clamp(s(v), 0, 1))) : x.moveTo(X(v), Y(clamp(s(v), 0, 1))); } x.stroke(); }
      const s = spline(o[S.ch]); x.strokeStyle = COL[S.ch]; x.lineWidth = 3; x.beginPath(); for (let i = 0; i <= 256; i++) { const v = i / 256; i ? x.lineTo(X(v), Y(clamp(s(v), 0, 1))) : x.moveTo(X(v), Y(clamp(s(v), 0, 1))); } x.stroke();
      o[S.ch].forEach((q, i) => { x.beginPath(); x.arc(X(q[0]), Y(q[1]), i === S.drag ? 9 : 7, 0, 7); x.fillStyle = '#000'; x.fill(); x.strokeStyle = i === S.drag ? '#5cb8ff' : COL[S.ch]; x.lineWidth = 3; x.stroke(); });
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.ch === S.ch));
    };
    CH.forEach(k => tabs.append(el('button', { 'data-ch': k, onclick: () => { S.ch = k; draw(); } }, NAMES[k])));
    const pos = e => { const r = cv.getBoundingClientRect(), pad = 14 * r.width / cv.width; return [clamp((e.clientX - r.left - pad) / (r.width - 2 * pad), 0, 1), clamp(1 - (e.clientY - r.top - pad) / (r.height - 2 * pad), 0, 1)]; };
    const near = p => { const pts = o[S.ch]; let bi = -1, bd = .045; pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
    cv.onpointerdown = e => { const p = pos(e), pts = o[S.ch]; let i = near(p);
      if (i < 0) { pts.push([p[0], clamp(spline(pts)(p[0]), 0, 1)]); pts.sort((a, b) => a[0] - b[0]); i = pts.findIndex(q => q[0] === p[0]); }
      S.drag = i; cv.setPointerCapture(e.pointerId); save(); draw(); onLive(); };
    cv.onpointermove = e => { if (S.drag < 0) { cv.style.cursor = near(pos(e)) >= 0 ? 'grab' : 'crosshair'; return; } const p = pos(e), pts = o[S.ch], i = S.drag, last = pts.length - 1;
      const lo = i === 0 ? 0 : pts[i - 1][0] + .01, hi = i === last ? 1 : pts[i + 1][0] - .01; pts[i] = [i === 0 || i === last ? (i === 0 ? Math.min(p[0], pts[1][0] - .01) : Math.max(p[0], pts[last - 1][0] + .01)) : clamp(p[0], lo, hi), p[1]]; save(); draw(); onLive(); };
    cv.onpointerup = () => { if (S.drag >= 0) { S.drag = -1; draw(); onDone(); } };
    cv.ondblclick = e => { const i = near(pos(e)), pts = o[S.ch]; if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); save(); draw(); onLive(); onDone(); } };
    const reset = el('button', { class: 'ibtn', onclick: () => { o[S.ch] = [[0, 0], [1, 1]]; save(); draw(); onLive(); onDone(); } }, 'Reset channel');
    const resetAll = el('button', { class: 'ibtn', onclick: () => { o = JSON.parse(DEF); save(); draw(); onLive(); onDone(); } }, 'Reset all');
    draw();
    return { el: el('div', { class: 'cv-wrap' }, cv, el('div', { class: 'cv-side' }, tabs, el('div', { class: 'cv-btns' }, reset, resetAll), el('div', { class: 'cp-tip dim' }, 'Click the curve to add a point, drag to shape it, double-click a point to remove it. The faint shape behind is this frame\'s histogram.'))), redraw: draw };
  }
  return { DEF, parse, spline, table, isIdentity, editor };
})();
