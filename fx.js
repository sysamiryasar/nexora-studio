'use strict';
/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
let _uid = 0;
const uid = () => 'i' + (++_uid).toString(36) + Math.random().toString(36).slice(2, 6);
function mkCanvas(w, h, rf) { const c = document.createElement('canvas'); c.width = w; c.height = h; if (rf) c._rf = true; return c; }
function hexToRgb(h) { h = (h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const _scratch = {};
// scratch surfaces are keyed by name AND size, so nested renders (Motion comps, VFX graphs) at other sizes don't thrash them
function getScratch(name) {
  const w = RS ? RS.w : P.w, h = RS ? RS.h : P.h, key = name + '@' + w + 'x' + h;
  let c = _scratch[key];
  if (!c) {
    c = _scratch[key] = document.createElement('canvas'); c.width = w; c.height = h;
    // with GPU effects on, scratch surfaces stay GPU-backed (fast drawImage / filters); CPU mode keeps them readback-friendly
    c._ctx = c.getContext('2d', { willReadFrequently: !(typeof GPU !== 'undefined' && GPU.on()) });
  }
  return c;
}
function resetCtx(c) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none'; }
function clearScratch(c) { const x = c._ctx; resetCtx(x); x.clearRect(0, 0, c.width, c.height); return x; }
function copyTo(name, cv) { const s = getScratch(name); const x = clearScratch(s); x.drawImage(cv, 0, 0); return s; }
function pix(ctx, cv, fn) { const d = ctx.getImageData(0, 0, cv.width, cv.height); fn(d.data, cv.width, cv.height); ctx.putImageData(d, 0, 0); }

/* ---------- param constructors ---------- */
const N = (k, label, min, max, def, step = 1, unit = '') => ({ k, label, type: 'num', min, max, def, step, unit });
const C = (k, label, def) => ({ k, label, type: 'color', def });
const S = (k, label, opts, def) => ({ k, label, type: 'sel', opts, def });

const noiseTbl = new Int8Array(1 << 20); for (let i = 0; i < noiseTbl.length; i++) noiseTbl[i] = (Math.random() * 255 - 127) | 0;

/* ---------- effects ---------- */
// css: returns a CSS filter fragment. px: pixel-pass on a comp-sized scratch canvas.
const FX = {
  blur:       { name: 'Gaussian Blur', cat: 'Blur', params: [N('amount', 'Radius', 0, 100, 12, .5, 'px')], css: p => `blur(${p.amount}px)` },
  brightness: { name: 'Brightness', cat: 'Color', params: [N('amount', 'Amount', 0, 300, 120, 1, '%')], css: p => `brightness(${p.amount}%)` },
  contrast:   { name: 'Contrast', cat: 'Color', params: [N('amount', 'Amount', 0, 300, 130, 1, '%')], css: p => `contrast(${p.amount}%)` },
  saturate:   { name: 'Saturation', cat: 'Color', params: [N('amount', 'Amount', 0, 400, 140, 1, '%')], css: p => `saturate(${p.amount}%)` },
  hue:        { name: 'Hue Rotate', cat: 'Color', params: [N('amount', 'Degrees', 0, 360, 90, 1, '°')], css: p => `hue-rotate(${p.amount}deg)` },
  grayscale:  { name: 'Black & White', cat: 'Color', params: [N('amount', 'Amount', 0, 100, 100, 1, '%')], css: p => `grayscale(${p.amount}%)` },
  sepia:      { name: 'Sepia', cat: 'Color', params: [N('amount', 'Amount', 0, 100, 80, 1, '%')], css: p => `sepia(${p.amount}%)` },
  invert:     { name: 'Invert', cat: 'Color', params: [N('amount', 'Amount', 0, 100, 100, 1, '%')], css: p => `invert(${p.amount}%)` },
  shadow:     { name: 'Drop Shadow', cat: 'Stylize', params: [N('x', 'Offset X', -300, 300, 8), N('y', 'Offset Y', -300, 300, 10), N('blur', 'Blur', 0, 120, 14), C('color', 'Color', '#000000'), N('op', 'Opacity', 0, 100, 70, 1, '%')], css: p => `drop-shadow(${p.x}px ${p.y}px ${p.blur}px ${rgba(p.color, p.op / 100)})` },

  temperature: { name: 'Temperature / Tint', cat: 'Color', params: [N('temp', 'Temperature', -100, 100, 25), N('tint', 'Tint', -100, 100, 0)],
    px(ctx, cv, p) { const t = p.temp * .5, ti = p.tint * .35; pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { d[i] += t; d[i + 2] -= t; d[i + 1] -= ti; } }); } },
  levels: { name: 'Levels', cat: 'Color', params: [N('ib', 'Input Black', 0, 254, 0), N('iw', 'Input White', 1, 255, 255), N('g', 'Gamma', .1, 3, 1, .01), N('ob', 'Output Black', 0, 255, 0), N('ow', 'Output White', 0, 255, 255)],
    px(ctx, cv, p) { const lut = new Uint8ClampedArray(256); const ib = p.ib, iw = Math.max(p.iw, ib + 1); for (let i = 0; i < 256; i++) { let v = clamp((i - ib) / (iw - ib), 0, 1); v = Math.pow(v, 1 / p.g); lut[i] = p.ob + v * (p.ow - p.ob); } pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; } }); } },
  duotone: { name: 'Duotone', cat: 'Color', params: [C('dark', 'Shadows', '#1b0b4a'), C('light', 'Highlights', '#ff8a5c'), N('amount', 'Mix', 0, 100, 100, 1, '%')],
    px(ctx, cv, p) { const a = hexToRgb(p.dark), b = hexToRgb(p.light), m = p.amount / 100; pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { const l = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / 255; d[i] = lerp(d[i], lerp(a[0], b[0], l), m); d[i + 1] = lerp(d[i + 1], lerp(a[1], b[1], l), m); d[i + 2] = lerp(d[i + 2], lerp(a[2], b[2], l), m); } }); } },
  posterize: { name: 'Posterize', cat: 'Stylize', params: [N('n', 'Levels', 2, 16, 5)],
    px(ctx, cv, p) { const n = p.n - 1; pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / 255 * n) / n * 255; d[i + 1] = Math.round(d[i + 1] / 255 * n) / n * 255; d[i + 2] = Math.round(d[i + 2] / 255 * n) / n * 255; } }); } },
  chroma: { name: 'Chroma Key (Green Screen)', cat: 'Keying', params: [C('color', 'Key Color', '#00ff00'), N('tol', 'Tolerance', 0, 100, 38, 1, '%'), N('soft', 'Softness', 0, 100, 14, 1, '%')],
    px(ctx, cv, p) { const [kr, kg, kb] = hexToRgb(p.color), tol = p.tol * 4.41, soft = Math.max(1, p.soft * 4.41); pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { const dr = d[i] - kr, dg = d[i + 1] - kg, db = d[i + 2] - kb; const dist = Math.sqrt(dr * dr + dg * dg + db * db); if (dist < tol) d[i + 3] = 0; else if (dist < tol + soft) d[i + 3] *= (dist - tol) / soft; } }); } },
  sharpen: { name: 'Sharpen', cat: 'Stylize', params: [N('amount', 'Amount', 0, 200, 60, 1, '%')],
    px(ctx, cv, p) { const a = p.amount / 100; pix(ctx, cv, (d, W, H) => { const s = new Uint8ClampedArray(d), r = W * 4; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) { const j = i + c; d[j] = s[j] * (1 + 4 * a) - a * (s[j - 4] + s[j + 4] + s[j - r] + s[j + r]); } } }); } },
  grain: { name: 'Film Grain', cat: 'Stylize', params: [N('amount', 'Amount', 0, 100, 30, 1, '%')],
    px(ctx, cv, p) { const k = p.amount / 100 * .45, off = (Math.random() * noiseTbl.length) | 0, m = noiseTbl.length - 1; pix(ctx, cv, d => { for (let i = 0, j = off; i < d.length; i += 4, j += 3) { if (!d[i + 3]) continue; const n = noiseTbl[j & m] * k; d[i] += n; d[i + 1] += n; d[i + 2] += n; } }); } },
  vignette: { name: 'Vignette', cat: 'Stylize', params: [N('amount', 'Darkness', 0, 100, 65, 1, '%'), N('size', 'Size', 0, 100, 45, 1, '%')],
    px(ctx, cv, p) { const W = cv.width, H = cv.height, r1 = Math.hypot(W, H) / 2, r0 = r1 * p.size / 100 * .9; const g = ctx.createRadialGradient(W / 2, H / 2, r0, W / 2, H / 2, r1); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${p.amount / 100})`); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; } },
  glow: { name: 'Glow', cat: 'Stylize', params: [N('radius', 'Radius', 1, 100, 20), N('amount', 'Intensity', 0, 200, 70, 1, '%')],
    px(ctx, cv, p) { const s = getScratch('f1'), x = clearScratch(s); x.filter = `blur(${p.radius}px) brightness(1.25)`; x.drawImage(cv, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(p.amount / 100, 0, 1); ctx.drawImage(s, 0, 0); if (p.amount > 100) { ctx.globalAlpha = (p.amount - 100) / 100; ctx.drawImage(s, 0, 0); } ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } },
  rgbsplit: { name: 'Chromatic Aberration', cat: 'Distort', params: [N('amount', 'Shift', 0, 60, 6, 1, 'px')],
    px(ctx, cv, p) { const a = Math.round(p.amount); if (!a) return; pix(ctx, cv, (d, W, H) => { const s = new Uint8ClampedArray(d); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, ir = (y * W + Math.max(0, x - a)) * 4, ib = (y * W + Math.min(W - 1, x + a)) * 4; d[i] = s[ir]; d[i + 2] = s[ib + 2]; d[i + 3] = Math.max(s[i + 3], s[ir + 3], s[ib + 3]); } }); } },
  pixelate: { name: 'Pixelate / Mosaic', cat: 'Distort', params: [N('size', 'Block Size', 2, 100, 14)],
    // each block = premultiplied average of a 4×4 grid of samples inside it (the GPU twin uses the same rule)
    px(ctx, cv, p) { const sz = Math.max(1, Math.round(p.size)); pix(ctx, cv, (d, W, H) => { const s = new Uint8ClampedArray(d);
      for (let by = 0; by < H; by += sz) for (let bx = 0; bx < W; bx += sz) { let r = 0, g = 0, b = 0, a = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const x = Math.min(W - 1, Math.floor(bx + (i + .5) / 4 * sz)), y = Math.min(H - 1, Math.floor(by + (j + .5) / 4 * sz)), k = (y * W + x) * 4, al = s[k + 3]; r += s[k] * al; g += s[k + 1] * al; b += s[k + 2] * al; a += al; }
        const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / 16;
        for (let y = by; y < Math.min(H, by + sz); y++) for (let x = bx; x < Math.min(W, bx + sz); x++) { const k = (y * W + x) * 4; d[k] = R; d[k + 1] = G; d[k + 2] = B; d[k + 3] = A; } } }); } },
  glitch: { name: 'Digital Glitch', cat: 'Distort', params: [N('amount', 'Intensity', 0, 100, 50, 1, '%'), N('rate', 'Rate (fps)', 1, 30, 10)],
    px(ctx, cv, p, env) { const W = cv.width, H = cv.height, rnd = mulberry(Math.floor(env.t * p.rate) + 7), s = copyTo('f1', cv), n = Math.floor(p.amount / 6) + 1; for (let i = 0; i < n; i++) { if (rnd() > p.amount / 100 + .15) continue; const y = rnd() * H, h = 4 + rnd() * H * .09, dx = (rnd() - .5) * W * .25 * p.amount / 100; ctx.clearRect(0, y, W, h); ctx.drawImage(s, 0, y, W, h, dx, y, W, h); } } },
  wave: { name: 'Wave Warp', cat: 'Distort', params: [N('amp', 'Amplitude', 0, 120, 14), N('freq', 'Wavelength', 4, 200, 40), N('speed', 'Speed', -10, 10, 3, .1)],
    px(ctx, cv, p, env) { const W = cv.width, H = cv.height, s = copyTo('f1', cv); ctx.clearRect(0, 0, W, H); for (let y = 0; y < H; y += 2) ctx.drawImage(s, 0, y, W, 2, Math.sin(y / p.freq * 2 + env.t * p.speed) * p.amp, y, W, 2); } },
  mirror: { name: 'Mirror', cat: 'Distort', params: [S('mode', 'Mode', ['Left → Right', 'Right → Left', 'Top → Bottom', 'Bottom → Top', 'Quad'], 'Left → Right')],
    px(ctx, cv, p) { const W = cv.width, H = cv.height, s = copyTo('f1', cv), m = p.mode; const flipH = (sx, dx) => { ctx.save(); ctx.translate(dx + W / 2, 0); ctx.scale(-1, 1); ctx.drawImage(s, sx, 0, W / 2, H, 0, 0, W / 2, H); ctx.restore(); }; const flipV = (sy, dy) => { ctx.save(); ctx.translate(0, dy + H / 2); ctx.scale(1, -1); ctx.drawImage(s, 0, sy, W, H / 2, 0, 0, W, H / 2); ctx.restore(); };
      if (m === 'Left → Right') { ctx.clearRect(W / 2, 0, W / 2, H); flipH(0, W / 2); } else if (m === 'Right → Left') { ctx.clearRect(0, 0, W / 2, H); flipH(W / 2, 0); } else if (m === 'Top → Bottom') { ctx.clearRect(0, H / 2, W, H / 2); flipV(0, H / 2); } else if (m === 'Bottom → Top') { ctx.clearRect(0, 0, W, H / 2); flipV(H / 2, 0); } else { ctx.clearRect(W / 2, 0, W / 2, H); flipH(0, W / 2); const s2 = copyTo('f2', cv); ctx.clearRect(0, H / 2, W, H / 2); ctx.save(); ctx.translate(0, H); ctx.scale(1, -1); ctx.drawImage(s2, 0, 0, W, H / 2, 0, 0, W, H / 2); ctx.restore(); } } },
  motionblur: { name: 'Directional Blur', cat: 'Blur', params: [N('len', 'Length', 0, 200, 40, 1, 'px'), N('angle', 'Angle', 0, 360, 0, 1, '°')],
    // true average of 14 shifted copies (additive 1/N), so edges fade the way real motion blur does
    px(ctx, cv, p) { const W = cv.width, H = cv.height, s = copyTo('f1', cv), n = 14, a = p.angle * Math.PI / 180; ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 / n; for (let i = 0; i < n; i++) { const o = (i / (n - 1) - .5) * p.len; ctx.drawImage(s, 0, 0, W, H, Math.cos(a) * o, Math.sin(a) * o, W, H); } ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } },
  scanlines: { name: 'CRT Scanlines', cat: 'Stylize', params: [N('amount', 'Darkness', 0, 100, 35, 1, '%'), N('gap', 'Line Gap', 2, 12, 4)],
    px(ctx, cv, p) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${p.amount / 100})`; for (let y = 0; y < cv.height; y += p.gap) ctx.fillRect(0, y, cv.width, Math.max(1, p.gap / 3)); ctx.globalCompositeOperation = 'source-over'; } }
};
function remap(ctx, cv, fn) {
  pix(ctx, cv, (d, W, H) => {
    const s = new Uint8ClampedArray(d), cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy, m = fn(dx, dy, Math.hypot(dx, dy)); if (!m) continue;
      const sx = Math.round(cx + m[0]), sy = Math.round(cy + m[1]), i = (y * W + x) * 4;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) { d[i + 3] = 0; continue; }
      const j = (sy * W + sx) * 4; d[i] = s[j]; d[i + 1] = s[j + 1]; d[i + 2] = s[j + 2]; d[i + 3] = s[j + 3];
    }
  });
}
Object.assign(FX, {
  swirl: { name: 'Twirl / Swirl', cat: 'Distort', params: [N('amount', 'Amount', -8, 8, 2, .1), N('radius', 'Radius', 5, 100, 45, 1, '%')],
    px(ctx, cv, p) { const R = Math.min(cv.width, cv.height) * p.radius / 100; remap(ctx, cv, (dx, dy, r) => { if (r >= R) return null; const a = p.amount * Math.pow(1 - r / R, 2), c = Math.cos(a), s = Math.sin(a); return [dx * c - dy * s, dx * s + dy * c]; }); } },
  bulge: { name: 'Bulge / Pinch', cat: 'Distort', params: [N('amount', 'Amount', -100, 100, 55, 1, '%'), N('radius', 'Radius', 5, 100, 40, 1, '%')],
    px(ctx, cv, p) { const R = Math.min(cv.width, cv.height) * p.radius / 100, k = p.amount / 100; remap(ctx, cv, (dx, dy, r) => { if (r >= R) return null; const f = 1 - k * (1 - (r / R) * (r / R)); return [dx * f, dy * f]; }); } },
  edge: { name: 'Edge Detect / Outline', cat: 'Stylize', params: [N('strength', 'Strength', 0, 300, 100, 1, '%'), N('mix', 'Mix', 0, 100, 100, 1, '%'), C('color', 'Edge Color', '#22e58b')],
    px(ctx, cv, p) { const [er, eg, eb] = hexToRgb(p.color), k = p.strength / 100 / 255 * 2, m = p.mix / 100; pix(ctx, cv, (d, W, H) => { const L = new Float32Array(W * H); for (let i = 0, j = 0; i < d.length; i += 4, j++) L[j] = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114); const o = new Uint8ClampedArray(d); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const j = y * W + x, gx = L[j - W + 1] + 2 * L[j + 1] + L[j + W + 1] - L[j - W - 1] - 2 * L[j - 1] - L[j + W - 1], gy = L[j + W - 1] + 2 * L[j + W] + L[j + W + 1] - L[j - W - 1] - 2 * L[j - W] - L[j - W + 1], g = Math.min(1, Math.hypot(gx, gy) * k), i = j * 4; d[i] = lerp(o[i], er * g, m); d[i + 1] = lerp(o[i + 1], eg * g, m); d[i + 2] = lerp(o[i + 2], eb * g, m); } }); } },
  halftone: { name: 'Halftone Dots', cat: 'Stylize', params: [N('size', 'Dot Spacing', 4, 60, 12)],
    px(ctx, cv, p) { const W = cv.width, H = cv.height, sz = Math.round(p.size), w = Math.ceil(W / sz), h = Math.ceil(H / sz), s = getScratch('f1'), x = clearScratch(s); x.drawImage(cv, 0, 0, w, h); const dd = x.getImageData(0, 0, w, h).data; ctx.clearRect(0, 0, W, H); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = (j * w + i) * 4; if (dd[k + 3] < 12) continue; const l = (dd[k] * .299 + dd[k + 1] * .587 + dd[k + 2] * .114) / 255; ctx.fillStyle = `rgb(${dd[k]},${dd[k + 1]},${dd[k + 2]})`; ctx.beginPath(); ctx.arc(i * sz + sz / 2, j * sz + sz / 2, sz * .6 * Math.sqrt(.15 + .85 * l), 0, 6.283); ctx.fill(); } } },
  zoomblur: { name: 'Zoom Blur', cat: 'Blur', params: [N('amount', 'Amount', 0, 60, 12, 1, '%')],
    px(ctx, cv, p) { const W = cv.width, H = cv.height, s = copyTo('f1', cv), n = 16; ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 / n; for (let i = 0; i < n; i++) { const z = 1 + p.amount / 100 * i / (n - 1); ctx.drawImage(s, 0, 0, W, H, W / 2 - W * z / 2, H / 2 - H * z / 2, W * z, H * z); } ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } },
  tint: { name: 'Color Tint', cat: 'Color', params: [C('color', 'Color', '#8b5cf6'), N('amount', 'Amount', 0, 100, 35, 1, '%')],
    px(ctx, cv, p) { ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = p.amount / 100; ctx.fillStyle = p.color; ctx.fillRect(0, 0, cv.width, cv.height); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } },
  vibrance: { name: 'Vibrance', cat: 'Color', params: [N('amount', 'Amount', -100, 100, 50, 1, '%')],
    px(ctx, cv, p) { const a = p.amount / 100; pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), sat = mx ? (mx - mn) / mx : 0, lum = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114, b = a * (1 - sat) * 1.6; d[i] = lum + (d[i] - lum) * (1 + b); d[i + 1] = lum + (d[i + 1] - lum) * (1 + b); d[i + 2] = lum + (d[i + 2] - lum) * (1 + b); } }); } },
  colorgrade: { name: 'Color Wheels (Shadows/Mids/Highlights)', cat: 'Color', params: [C('sh', 'Shadows', '#3b2a8a'), C('mid', 'Midtones', '#808080'), C('hi', 'Highlights', '#ffb86b'), N('amount', 'Strength', 0, 100, 60, 1, '%')],
    px(ctx, cv, p) { const S = hexToRgb(p.sh), M = hexToRgb(p.mid), H = hexToRgb(p.hi), k = p.amount / 100 * .6; pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { const l = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / 255, ws = (1 - l) * (1 - l), wh = l * l, wm = Math.max(0, 1 - ws - wh); for (let c = 0; c < 3; c++) d[i + c] += ((S[c] - 128) * ws + (M[c] - 128) * wm + (H[c] - 128) * wh) * k; } }); } },
  shake: { name: 'Camera Shake', cat: 'Distort', params: [N('amount', 'Amount', 0, 80, 14, 1, 'px'), N('speed', 'Speed', 1, 30, 10)],
    px(ctx, cv, p, env) { const W = cv.width, H = cv.height, s = copyTo('f1', cv), u = env.t * p.speed, i = Math.floor(u), f = u - i, r = n => mulberry(n * 31 + 5)(), ox = lerp(r(i) - .5, r(i + 1) - .5, f) * 2 * p.amount, oy = lerp(r(i + 99) - .5, r(i + 100) - .5, f) * 2 * p.amount, z = 1 + p.amount / RQ / 300; ctx.clearRect(0, 0, W, H); ctx.drawImage(s, W / 2 - W * z / 2 + ox, H / 2 - H * z / 2 + oy, W * z, H * z); } },
  autokey: { name: 'Smart Key (auto background color)', cat: 'Keying', params: [N('tol', 'Tolerance', 0, 100, 30, 1, '%'), N('soft', 'Softness', 0, 100, 18, 1, '%')],
    px(ctx, cv, p) {
      pix(ctx, cv, (d, W, H) => {
        let r = 0, g = 0, b = 0, n = 0; for (const [cx, cy] of [[2, 2], [W - 12, 2], [2, H - 12], [W - 12, H - 12]]) for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { const i = ((cy + y) * W + cx + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        r /= n; g /= n; b /= n; const tol = p.tol * 4.41, soft = Math.max(1, p.soft * 4.41);
        for (let i = 0; i < d.length; i += 4) { const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b, dist = Math.sqrt(dr * dr + dg * dg + db * db); if (dist < tol) d[i + 3] = 0; else if (dist < tol + soft) d[i + 3] *= (dist - tol) / soft; }
      });
    } },
  letterbox: { name: 'Cinematic Bars', cat: 'Stylize', params: [N('amount', 'Bar Height', 0, 40, 12, 1, '%')],
    px(ctx, cv, p) { const h = cv.height * p.amount / 100; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, h); ctx.fillRect(0, cv.height - h, cv.width, h); } },
  /* Primary grade (the Color page): lift / gamma / gain / offset per channel plus a master for each, contrast about a
     mid-grey pivot, saturation, temperature and tint. Same maths on the GPU (gpu.js "primaries") and here. */
  primaries: { name: 'Primary Grade (Lift / Gamma / Gain)', cat: 'Color', params: [
      ...[['l', 'Lift'], ['g', 'Gamma'], ['k', 'Gain'], ['o', 'Offset']].flatMap(([k, n]) => [N(k + 'm', n + ' Master', -100, 100, 0), N(k + 'r', n + ' R', -100, 100, 0), N(k + 'g', n + ' G', -100, 100, 0), N(k + 'b', n + ' B', -100, 100, 0)]),
      N('con', 'Contrast', 0, 200, 100, 1, '%'), N('sat', 'Saturation', 0, 200, 100, 1, '%'), N('temp', 'Temperature', -100, 100, 0), N('tint', 'Tint', -100, 100, 0)],
    px(ctx, cv, p) { const u = primUni(p), L = u.c0, G = u.c1, K = u.c2, O = [u.u0, u.u1, u.u2], con = u.u3, sat = u.u4;
      pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { const v = [0, 0, 0]; for (let c = 0; c < 3; c++) { const x = d[i + c] / 255; v[c] = (Math.pow(Math.max(x * K[c] + L[c] * (1 - x), 0), G[c]) + O[c] - PIVOT) * con + PIVOT; }
        const l = v[0] * .2126 + v[1] * .7152 + v[2] * .0722; for (let c = 0; c < 3; c++) d[i + c] = clamp(l + (v[c] - l) * sat, 0, 1) * 255; } }); } }
});
const PIVOT = .435;
/** primary-grade parameters → shader values: c0 lift, c1 gamma exponent, c2 gain (temperature/tint folded in), u0-u2 offset, u3 contrast, u4 saturation */
function primUni(p) {
  const ch = (k, c) => ((p[k + 'm'] || 0) + (p[k + c] || 0)) / 100, t = (p.temp || 0) / 100, ti = (p.tint || 0) / 100;
  const tg = [1 + t * .18, 1 - ti * .14, 1 - t * .18];
  return { c0: ['r', 'g', 'b'].map(c => ch('l', c) * .4), c1: ['r', 'g', 'b'].map(c => Math.exp(-ch('g', c) * 1.1)), c2: ['r', 'g', 'b'].map((c, i) => Math.max(0, 1 + ch('k', c)) * tg[i]),
    u0: ch('o', 'r') * .25, u1: ch('o', 'g') * .25, u2: ch('o', 'b') * .25, u3: (p.con ?? 100) / 100, u4: (p.sat ?? 100) / 100 };
}
for (const k in FX) FX[k].id = k;

function newFx(type) { const d = FX[type], p = {}; d.params.forEach(q => p[q.k] = q.def); return { id: uid(), type, on: true, p }; }

const LOOKS = {
  'Cinematic':   [['contrast', { amount: 118 }], ['saturate', { amount: 115 }], ['temperature', { temp: -12, tint: 6 }], ['vignette', { amount: 55, size: 50 }]],
  'Vintage':     [['sepia', { amount: 55 }], ['contrast', { amount: 108 }], ['grain', { amount: 35 }], ['vignette', { amount: 50, size: 45 }]],
  'Noir':        [['grayscale', { amount: 100 }], ['contrast', { amount: 150 }], ['vignette', { amount: 70, size: 40 }], ['grain', { amount: 25 }]],
  'Cyberpunk':   [['duotone', { dark: '#20064d', light: '#00f0ff', amount: 70 }], ['saturate', { amount: 160 }], ['rgbsplit', { amount: 5 }], ['glow', { radius: 18, amount: 60 }]],
  'Warm Glow':   [['temperature', { temp: 45, tint: 5 }], ['brightness', { amount: 108 }], ['glow', { radius: 24, amount: 55 }]],
  'Teal & Orange': [['duotone', { dark: '#0b4a5a', light: '#ffa45c', amount: 45 }], ['contrast', { amount: 118 }], ['saturate', { amount: 120 }]],
  'VHS':         [['rgbsplit', { amount: 7 }], ['scanlines', { amount: 40, gap: 4 }], ['grain', { amount: 40 }], ['saturate', { amount: 130 }], ['glitch', { amount: 25, rate: 8 }]],
  'Dreamy':      [['glow', { radius: 40, amount: 110 }], ['brightness', { amount: 108 }], ['saturate', { amount: 115 }]],
  'Comic':       [['posterize', { n: 5 }], ['saturate', { amount: 170 }], ['contrast', { amount: 130 }], ['sharpen', { amount: 90 }]],
  'Faded Matte': [['levels', { ib: 0, iw: 255, g: 1.1, ob: 28, ow: 235 }], ['saturate', { amount: 85 }]]
};

LOOKS['Neon Night'] = [['colorgrade', { sh: '#2a1a8a', mid: '#808080', hi: '#22e58b', amount: 70 }], ['vibrance', { amount: 60 }], ['glow', { radius: 22, amount: 70 }], ['vignette', { amount: 60, size: 45 }]];
LOOKS['Sketch'] = [['edge', { strength: 140, mix: 100, color: '#ffffff' }], ['contrast', { amount: 120 }]];
LOOKS['Cinema 2.39'] = [['letterbox', { amount: 12 }], ['colorgrade', { sh: '#16365a', mid: '#808080', hi: '#ffb070', amount: 45 }], ['contrast', { amount: 112 }]];
/* ---------- transitions / animation presets ---------- */
const TRANS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out', 'pop', 'spin', 'blur', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down'];
const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'lighter'];
const BLEND_NAMES = { 'source-over': 'Normal', 'lighter': 'Add' };
const blendName = b => BLEND_NAMES[b] || b.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
const EASE = {
  linear: t => t, inout: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, in: t => t * t * t, out: t => 1 - Math.pow(1 - t, 3),
  back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  bounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; },
  hold: t => 0
};
