'use strict';
/* ====================== NEXORA 3D LUTs (.cube) ======================
   Import: Adobe / Resolve .cube 3D LUTs (any size, DOMAIN_MIN/MAX honoured), stored in the project (P.luts) so the
   project stays portable. Applied as the 'lut' effect: GPU path = LUT packed as N blue-slices in an RGBA16F texture,
   trilinear interpolation in the shader; CPU path = the same trilinear maths in JS (used without WebGL2, and by tests).
   Export: any library filter can be baked to a 33-point .cube by rendering the identity lattice through it. */
const LUT = (() => {
  // kept out of P so undo snapshots stay small; saved in the project envelope by Shell (toJSON / fromJSON)
  let LUTS = {}; const store = () => LUTS;
  const cache = new Map();   // id → { n, f32 (RGBA), min, max }
  function parse(text) {
    let n = 0, min = [0, 0, 0], max = [1, 1, 1], title = ''; const vals = [];
    for (const raw of text.split(/\r?\n/)) { const line = raw.trim(); if (!line || line[0] === '#') continue; const p = line.split(/\s+/);
      if (p[0] === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, ''); else if (p[0] === 'LUT_3D_SIZE') n = +p[1]; else if (p[0] === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported — use a 3D .cube');
      else if (p[0] === 'DOMAIN_MIN') min = p.slice(1, 4).map(Number); else if (p[0] === 'DOMAIN_MAX') max = p.slice(1, 4).map(Number); else if (/^[-\d.]/.test(p[0])) vals.push(+p[0], +p[1], +p[2]); }
    if (!n || n < 2 || n > 129) throw new Error('Missing or invalid LUT_3D_SIZE'); if (vals.length !== n * n * n * 3) throw new Error(`Expected ${n * n * n} entries, found ${vals.length / 3}`);
    return { n, vals, min, max, title };
  }
  function packed(id) {
    if (cache.has(id)) return cache.get(id); const L = store()[id]; if (!L) return null; const n = L.n, v = L.vals, f = new Float32Array(n * n * n * 4);
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) { const s = (r + g * n + b * n * n) * 3, o = ((g) * n * n + b * n + r) * 4; f[o] = v[s]; f[o + 1] = v[s + 1]; f[o + 2] = v[s + 2]; f[o + 3] = 1; }
    const e = { n, f32: f, min: L.min, max: L.max }; cache.set(id, e); return e;
  }
  /** import a .cube File into the project; returns the LUT id */
  async function importFile(file) { const t = parse(await file.text()), id = 'lut' + uid(); store()[id] = { name: t.title || file.name.replace(/\.cube$/i, ''), n: t.n, vals: t.vals, min: t.min, max: t.max }; return id; }
  function list() { return Object.entries(store()).map(([id, l]) => ({ id, name: l.name, n: l.n })); }
  /* CPU reference: trilinear lookup on 0–255 input */
  function lookup(e, r, g, b, out) {
    const n = e.n, s = (x, k) => clamp((x / 255 - e.min[k]) / (e.max[k] - e.min[k]), 0, 1) * (n - 1);
    const fr = s(r, 0), fg = s(g, 1), fb = s(b, 2), r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb), r1 = Math.min(n - 1, r0 + 1), g1 = Math.min(n - 1, g0 + 1), b1 = Math.min(n - 1, b0 + 1), dr = fr - r0, dg = fg - g0, db = fb - b0, F = e.f32;
    const at = (ri, gi, bi, c) => F[((gi) * n * n + bi * n + ri) * 4 + c];
    for (let c = 0; c < 3; c++) { const c00 = at(r0, g0, b0, c) * (1 - dr) + at(r1, g0, b0, c) * dr, c10 = at(r0, g1, b0, c) * (1 - dr) + at(r1, g1, b0, c) * dr, c01 = at(r0, g0, b1, c) * (1 - dr) + at(r1, g0, b1, c) * dr, c11 = at(r0, g1, b1, c) * (1 - dr) + at(r1, g1, b1, c) * dr; out[c] = ((c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db) * 255; }
    return out;
  }
  const SRC = `#version 300 es
precision highp float; uniform sampler2D src; uniform sampler2D lut; uniform vec2 size; uniform float n, amt; uniform vec3 dmin, dmax; out vec4 o;
vec3 look(vec3 c) { c = clamp((c - dmin) / (dmax - dmin), 0.0, 1.0) * (n - 1.0); float b0 = floor(c.b), b1 = min(b0 + 1.0, n - 1.0), f = c.b - b0;
  vec2 a = vec2((b0 * n + c.r + .5) / (n * n), (c.g + .5) / n), b = vec2((b1 * n + c.r + .5) / (n * n), (c.g + .5) / n); return mix(texture(lut, a).rgb, texture(lut, b).rgb, f); }
void main() { vec4 c = texelFetch(src, ivec2(gl_FragCoord.xy), 0); o = vec4(mix(c.rgb, look(c.rgb), amt), c.a); }`;
  FX.lut = { id: 'lut', name: 'LUT (.cube)', cat: 'Color', hidden: true, params: [{ k: 'lut', label: 'LUT', type: 'hidden' }, N('amount', 'Intensity', 0, 100, 100, 1, '%')],
    px(ctx, cv, p) { const e = packed(p.lut); if (!e) return; const a = clamp(p.amount / 100, 0, 1), o = [0, 0, 0]; pix(ctx, cv, d => { for (let i = 0; i < d.length; i += 4) { lookup(e, d[i], d[i + 1], d[i + 2], o); d[i] += (o[0] - d[i]) * a; d[i + 1] += (o[1] - d[i + 1]) * a; d[i + 2] += (o[2] - d[i + 2]) * a; } }); } };
  if (typeof GPU !== 'undefined') GPU.register('lut', { src: SRC, uniforms: { n: 'f', amt: 'f', dmin: 'v3', dmax: 'v3' },
    uni: p => { const e = packed(p.lut); return e ? { n: e.n, amt: clamp(p.amount / 100, 0, 1), dmin: e.min, dmax: e.max, _id: p.lut } : { n: 2, amt: 0, dmin: [0, 0, 0], dmax: [1, 1, 1], _id: '' }; },
    tex: v => { const e = v._id && packed(v._id); return e ? { key: v._id, w: e.n * e.n, h: e.n, data: e.f32 } : { key: '__id', w: 4, h: 2, data: new Float32Array(32) }; } });

  /** bake a library filter (or any preset) into a 33³ .cube text */
  function bake(presetId, n) {
    n = n || 33; const w = n * n, cv = document.createElement('canvas'); cv.width = w; cv.height = n; cv._ctx = cv.getContext('2d', { willReadFrequently: true }); const id = cv._ctx.createImageData(w, n);
    for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) for (let r = 0; r < n; r++) { const o = (g * w + b * n + r) * 4; id.data[o] = Math.round(r / (n - 1) * 255); id.data[o + 1] = Math.round(g / (n - 1) * 255); id.data[o + 2] = Math.round(b / (n - 1) * 255); id.data[o + 3] = 255; }
    cv._ctx.putImageData(id, 0, 0); if (!GPU.run(cv, [{ type: 'lib', p: { preset: presetId, amount: 100, speed: 1 }, t: 0, ld: 1 }])) throw new Error('Baking needs GPU acceleration');
    const d = cv._ctx.getImageData(0, 0, w, n).data, lines = [`TITLE "${Library.name(presetId).replace(/"/g, "'")}"`, `# baked by NEXORA Studio`, `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) { const o = (g * w + b * n + r) * 4; lines.push(`${(d[o] / 255).toFixed(6)} ${(d[o + 1] / 255).toFixed(6)} ${(d[o + 2] / 255).toFixed(6)}`); }
    return lines.join('\n') + '\n';
  }
  function apply(id, L) { L = L || selLayer(); const f = newFx('lut'); f.p.lut = id; if (L && L.type !== 'audio') { L.fx.push(f); } else { const A = mkLayer('adjust', { name: 'LUT · ' + store()[id].name, start: 0, dur: P.dur }); A.fx.push(f); addLayer(A); } commit(); structChanged(); if (typeof buildInspector === 'function') buildInspector(); }
  const toJSON = () => JSON.parse(JSON.stringify(LUTS)), fromJSON = o => { LUTS = o && typeof o === 'object' ? o : {}; cache.clear(); }, reset = () => fromJSON({});
  return { parse, importFile, list, packed, lookup, bake, apply, store, toJSON, fromJSON, reset, invalidate: id => cache.delete(id) };
})();
