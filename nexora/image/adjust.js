'use strict';
/* ====================== NEXORA Image — adjustment math ======================
   Pure per-pixel functions used by non-destructive adjustment layers and by destructive "Image › Adjustments".
   ADJ.apply(data, type, params, amount, maskAlpha) edits RGBA bytes in place. */
const ADJ = (() => {
  const C = v => v < 0 ? 0 : v > 255 ? 255 : v;
  const lum = (r, g, b) => r * .299 + g * .587 + b * .114;
  function rgb2hsl(r, g, b, o) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
    if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    o[0] = h; o[1] = s; o[2] = l; return o;
  }
  const h2 = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  function hsl2rgb(h, s, l, o) {
    if (!s) { o[0] = o[1] = o[2] = l * 255; return o; }
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; o[0] = h2(p, q, h + 1 / 3) * 255; o[1] = h2(p, q, h) * 255; o[2] = h2(p, q, h - 1 / 3) * 255; return o;
  }
  /** monotone cubic (Fritsch–Carlson) through curve points → 256-entry LUT */
  function curveLUT(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0]), n = p.length, lut = new Uint8ClampedArray(256);
    if (n === 1) { lut.fill(p[0][1]); return lut; }
    const dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]); dy[i] = p[i + 1][1] - p[i][1]; m[i] = dy[i] / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (!m[i]) { t[i] = t[i + 1] = 0; continue; } const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b; if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; } }
    for (let x = 0; x < 256; x++) {
      if (x <= p[0][0]) { lut[x] = p[0][1]; continue; } if (x >= p[n - 1][0]) { lut[x] = p[n - 1][1]; continue; }
      let i = 0; while (x > p[i + 1][0]) i++;
      const h = dx[i], u = (x - p[i][0]) / h, u2 = u * u, u3 = u2 * u;
      lut[x] = (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * h * t[i + 1];
    }
    return lut;
  }
  function levelsLUT(q) { const lut = new Uint8ClampedArray(256), ib = q.ib, iw = Math.max(q.iw, ib + 1); for (let i = 0; i < 256; i++) { const v = Math.pow(Math.min(1, Math.max(0, (i - ib) / (iw - ib))), 1 / q.g); lut[i] = q.ob + v * (q.ow - q.ob); } return lut; }
  const HUES = [['reds', 0], ['yellows', 60], ['greens', 120], ['cyans', 180], ['blues', 240], ['magentas', 300]];
  const hueW = (h, c) => { let d = Math.abs(h * 360 - c); if (d > 180) d = 360 - d; return Math.max(0, 1 - d / 60); };
  function gradLUT(stops, reverse) {
    const s = stops.slice().sort((a, b) => a[0] - b[0]).map(([p, c]) => [p, hexToRgb(c)]), lut = new Uint8ClampedArray(768);
    for (let i = 0; i < 256; i++) {
      let x = i / 255; if (reverse) x = 1 - x; let a = s[0], b = s[s.length - 1];
      for (let k = 0; k < s.length - 1; k++) if (x >= s[k][0] && x <= s[k + 1][0]) { a = s[k]; b = s[k + 1]; break; }
      const u = x <= a[0] ? 0 : x >= b[0] ? 1 : (x - a[0]) / Math.max(1e-6, b[0] - a[0]);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[1][c] + (b[1][c] - a[1][c]) * u;
    }
    return lut;
  }

  const defs = {
    brightness: { name: 'Brightness / Contrast', p: () => ({ b: 0, c: 0 }) },
    exposure:   { name: 'Exposure', p: () => ({ ev: 0, offset: 0, gamma: 1 }) },
    hsl:        { name: 'Hue / Saturation', p: () => ({ h: 0, s: 0, l: 0, colorize: false }) },
    balance:    { name: 'Color Balance', p: () => ({ sh: [0, 0, 0], mid: [0, 0, 0], hi: [0, 0, 0], preserve: true }) },
    curves:     { name: 'Curves', p: () => ({ rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }) },
    levels:     { name: 'Levels', p: () => ({ ib: 0, iw: 255, g: 1, ob: 0, ow: 255 }) },
    selective:  { name: 'Selective Color', p: () => ({ reds: [0, 0, 0], yellows: [0, 0, 0], greens: [0, 0, 0], cyans: [0, 0, 0], blues: [0, 0, 0], magentas: [0, 0, 0] }) },
    gradmap:    { name: 'Gradient Map', p: () => ({ stops: [[0, '#0d0221'], [.5, '#8b5cf6'], [1, '#ffe6a8']], reverse: false }) },
    bw:         { name: 'Black & White', p: () => ({ reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#c8a46e' }) },
    vibrance:   { name: 'Vibrance', p: () => ({ v: 0, s: 0 }) },
    photo:      { name: 'Photo Filter', p: () => ({ color: '#ec8a00', density: 25, preserve: true }) },
    invert:     { name: 'Invert', p: () => ({}) },
    threshold:  { name: 'Threshold', p: () => ({ t: 128 }) },
    posterize:  { name: 'Posterize', p: () => ({ n: 4 }) }
  };

  /** build a pixel function f(r,g,b,o) writing new RGB into o */
  function compile(type, q) {
    const o3 = [0, 0, 0];
    switch (type) {
      case 'brightness': { const c = q.c * 1.27, f = (259 * (c + 255)) / (255 * (259 - c)), lut = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) lut[i] = (i - 128) * f + 128 + q.b; return (r, g, b, o) => { o[0] = lut[r | 0]; o[1] = lut[g | 0]; o[2] = lut[b | 0]; }; }
      case 'exposure': { const k = Math.pow(2, q.ev), lut = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) lut[i] = Math.pow(Math.max(0, (i / 255 + q.offset) * k), 1 / q.gamma) * 255; return (r, g, b, o) => { o[0] = lut[r | 0]; o[1] = lut[g | 0]; o[2] = lut[b | 0]; }; }
      case 'levels': { const lut = levelsLUT(q); return (r, g, b, o) => { o[0] = lut[r | 0]; o[1] = lut[g | 0]; o[2] = lut[b | 0]; }; }
      case 'curves': { const M = curveLUT(q.rgb), R = curveLUT(q.r), G = curveLUT(q.g), B = curveLUT(q.b); return (r, g, b, o) => { o[0] = R[M[r | 0]]; o[1] = G[M[g | 0]]; o[2] = B[M[b | 0]]; }; }
      case 'invert': return (r, g, b, o) => { o[0] = 255 - r; o[1] = 255 - g; o[2] = 255 - b; };
      case 'threshold': return (r, g, b, o) => { o[0] = o[1] = o[2] = lum(r, g, b) >= q.t ? 255 : 0; };
      case 'posterize': { const n = Math.max(2, q.n) - 1; return (r, g, b, o) => { o[0] = Math.round(r / 255 * n) / n * 255; o[1] = Math.round(g / 255 * n) / n * 255; o[2] = Math.round(b / 255 * n) / n * 255; }; }
      case 'hsl': return (r, g, b, o) => {
        rgb2hsl(r, g, b, o3); let h = o3[0], s = o3[1], l = o3[2];
        if (q.colorize) { h = ((q.h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(1, .25 + q.s / 100)); }
        else { h = (h + q.h / 360 + 1) % 1; const k = q.s / 100; s = k > 0 ? s + (1 - s) * k : s * (1 + k); }
        const kl = q.l / 100; l = kl > 0 ? l + (1 - l) * kl : l * (1 + kl); hsl2rgb(h, Math.max(0, Math.min(1, s)), l, o);
      };
      case 'balance': return (r, g, b, o) => {
        const l = lum(r, g, b) / 255, ws = (1 - l) * (1 - l), wh = l * l, wm = Math.max(0, 1 - ws - wh), k = 1.1;
        let R = r + (q.sh[0] * ws + q.mid[0] * wm + q.hi[0] * wh) * k, G = g + (q.sh[1] * ws + q.mid[1] * wm + q.hi[1] * wh) * k, B = b + (q.sh[2] * ws + q.mid[2] * wm + q.hi[2] * wh) * k;
        if (q.preserve) { const d = lum(r, g, b) - lum(R, G, B); R += d; G += d; B += d; } o[0] = R; o[1] = G; o[2] = B;
      };
      case 'selective': return (r, g, b, o) => {
        rgb2hsl(r, g, b, o3); let dh = 0, ds = 0, dl = 0;
        for (const [k, c] of HUES) { const w = hueW(o3[0], c) * o3[1]; if (!w) continue; const v = q[k]; dh += v[0] * w; ds += v[1] * w; dl += v[2] * w; }
        hsl2rgb((o3[0] + dh / 360 + 1) % 1, Math.max(0, Math.min(1, o3[1] * (1 + ds / 100))), Math.max(0, Math.min(1, o3[2] + dl / 200)), o);
      };
      case 'gradmap': { const lut = gradLUT(q.stops, q.reverse); return (r, g, b, o) => { const i = Math.round(lum(r, g, b)) * 3; o[0] = lut[i]; o[1] = lut[i + 1]; o[2] = lut[i + 2]; }; }
      case 'bw': { const W = HUES.map(([k]) => q[k]), D = [40, 60, 40, 60, 20, 80], T = hexToRgb(q.tintColor), lt = Math.max(1, lum(...T)); return (r, g, b, o) => {
        rgb2hsl(r, g, b, o3); const chroma = Math.max(r, g, b) - Math.min(r, g, b); let adj = 0;
        for (let i = 0; i < 6; i++) adj += hueW(o3[0], HUES[i][1]) * (W[i] - D[i]) / 100;
        const y = C(lum(r, g, b) + chroma * adj);
        if (q.tint) { o[0] = y * T[0] / lt; o[1] = y * T[1] / lt; o[2] = y * T[2] / lt; } else o[0] = o[1] = o[2] = y;
      }; }
      case 'vibrance': return (r, g, b, o) => {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, l = lum(r, g, b), k = 1 + q.v / 100 * (1 - sat) * 1.5 + q.s / 100;
        o[0] = l + (r - l) * k; o[1] = l + (g - l) * k; o[2] = l + (b - l) * k;
      };
      case 'photo': { const F = hexToRgb(q.color), d = q.density / 100; return (r, g, b, o) => {
        let R = r + (r * F[0] / 255 - r) * d + (F[0] - r) * d * .35, G = g + (g * F[1] / 255 - g) * d + (F[1] - g) * d * .35, B = b + (b * F[2] / 255 - b) * d + (F[2] - b) * d * .35;
        if (q.preserve) { const k = lum(r, g, b) / Math.max(1, lum(R, G, B)); R *= k; G *= k; B *= k; } o[0] = R; o[1] = G; o[2] = B;
      }; }
    }
    return null;
  }
  /** apply in place. amount 0..1 (layer opacity), mask = Uint8ClampedArray alpha per pixel (optional) */
  function apply(d, type, q, amount, mask) {
    const f = compile(type, q); if (!f) return; const o = [0, 0, 0], a = amount === undefined ? 1 : amount;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      if (!d[i + 3]) continue; let w = a; if (mask) { w *= mask[j] / 255; if (!w) continue; }
      const r = d[i], g = d[i + 1], b = d[i + 2]; f(r, g, b, o);
      if (w === 1) { d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; } else { d[i] = r + (o[0] - r) * w; d[i + 1] = g + (o[1] - g) * w; d[i + 2] = b + (o[2] - b) * w; }
    }
  }
  /** luminance histogram (for Levels/Curves panels) */
  function histogram(d) { const h = new Uint32Array(256); for (let i = 0; i < d.length; i += 4) if (d[i + 3]) h[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++; return h; }
  return { defs, apply, compile, curveLUT, levelsLUT, histogram, rgb2hsl, hsl2rgb, HUES };
})();
