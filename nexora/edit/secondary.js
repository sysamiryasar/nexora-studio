'use strict';
/* ====================== NEXORA secondary grade ======================
   Grade only part of the picture:
     · HSL qualifier: a hue band (centre ± width, with soft edges) and saturation / luminance ranges select a colour,
       e.g. only the sky, only skin, everything except red;
     · window: an ellipse or rectangle (soft edge, inside or outside) limits it to an area, e.g. a vignette or a face;
   both multiply into one matte. Inside the matte: hue shift, saturation and exposure. "Matte" view shows the selection
   in black and white. All parameters are numbers, so they can be keyframed. Same maths on the GPU and the CPU. */
const Secondary = (() => {
  const WM = ['Off', 'Ellipse', 'Rectangle'], WI = ['Inside', 'Outside'], VIEW = ['Result', 'Matte'];
  FX.secondary = { id: 'secondary', name: 'Secondary (Qualifier / Window)', cat: 'Color', hidden: true, params: [
    N('hue', 'Hue centre', 0, 360, 0, 1, '°'), N('hw', 'Hue width', 0, 360, 360, 1, '°'), N('hs', 'Hue softness', 0, 90, 20, 1, '°'),
    N('slo', 'Saturation low', 0, 100, 0, 1, '%'), N('shi', 'Saturation high', 0, 100, 100, 1, '%'), N('llo', 'Luma low', 0, 100, 0, 1, '%'), N('lhi', 'Luma high', 0, 100, 100, 1, '%'), N('rs', 'Range softness', 0, 50, 10, 1, '%'),
    S('wm', 'Window', WM, 'Off'), N('wx', 'Window X', 0, 100, 50, .5, '%'), N('wy', 'Window Y', 0, 100, 50, .5, '%'), N('ww', 'Window width', 1, 200, 60, .5, '%'), N('wh', 'Window height', 1, 200, 60, .5, '%'), N('wsf', 'Window softness', 0, 100, 30, 1, '%'), S('winv', 'Grade', WI, 'Inside'),
    N('ah', 'Hue shift', -180, 180, 0, 1, '°'), N('as', 'Saturation', 0, 200, 100, 1, '%'), N('ae', 'Exposure (1/100 stop)', -300, 300, 0, 1), S('view', 'View', VIEW, 'Result')],
    px(ctx, cv, p) { const u = uni(p), W = cv.width, H = cv.height;
      pix(ctx, cv, d => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, o = shade(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, (x + .5) / W, (y + .5) / H, W / H, u); d[i] = o[0] * 255; d[i + 1] = o[1] * 255; d[i + 2] = o[2] * 255; } }); } };

  /** parameters → the values both the shader and the CPU use */
  function uni(p) {
    return { hc: (p.hue % 360 + 360) % 360, hw: p.hw / 2, hs: Math.max(.001, p.hs), sr: [p.slo / 100, p.shi / 100], lr: [p.llo / 100, p.lhi / 100], rs: Math.max(.001, p.rs / 100), qon: p.hw < 360 || p.slo > 0 || p.shi < 100 || p.llo > 0 || p.lhi < 100 ? 1 : 0,
      wm: Math.max(0, WM.indexOf(p.wm)), win: [p.wx / 100, p.wy / 100], wr: [Math.max(.005, p.ww / 200), Math.max(.005, p.wh / 200)], wsf: Math.max(.001, p.wsf / 100), winv: p.winv === 'Outside' ? 1 : 0,
      ah: p.ah, as: p.as / 100, gain: Math.pow(2, p.ae / 100), view: p.view === 'Matte' ? 1 : 0 };
  }
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const range = (x, lo, hi, s) => ss(lo - s, lo, x) * (1 - ss(hi, hi + s, x));
  function hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-6) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx > 1e-6 ? d / mx : 0, mx]; }
  function rgbOf(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
  /** matte at one pixel (0…1); px, py normalised from the top-left, asp = width / height */
  function matte(r, g, b, px, py, asp, u) {
    let m = 1;
    if (u.qon) { const [h, s] = hsv(r, g, b), l = .2126 * r + .7152 * g + .0722 * b; let dh = Math.abs(h - u.hc); dh = Math.min(dh, 360 - dh);
      const kh = u.hw >= 180 ? 1 : 1 - ss(u.hw, u.hw + u.hs, dh); m = kh * range(s, u.sr[0], u.sr[1], u.rs) * range(l, u.lr[0], u.lr[1], u.rs); }
    if (u.wm) {   // window size is a fraction of the frame width / height, so an ellipse follows the frame's shape
      const dx = (px - u.win[0]) / u.wr[0], dy = (py - u.win[1]) / u.wr[1], d = u.wm === 1 ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy));
      let k = 1 - ss(1 - u.wsf, 1, d); if (u.winv) k = 1 - k; m *= k; }
    return m;
  }
  function shade(r, g, b, px, py, asp, u) {
    const m = matte(r, g, b, px, py, asp, u); if (u.view) return [m, m, m];
    const [h, s, v] = hsv(r, g, b), a = rgbOf((h + u.ah + 360) % 360, clamp(s * u.as, 0, 1), clamp(v * u.gain, 0, 1));
    return [r + (a[0] - r) * m, g + (a[1] - g) * m, b + (a[2] - b) * m].map(x => clamp(x, 0, 1));
  }
  if (typeof GPU !== 'undefined') GPU.register('secondary', { src: `#version 300 es
precision highp float; uniform sampler2D src; uniform vec2 size; out vec4 o;
uniform float hc, hw, hs, rs, qon, wm, wsf, winv, ah, as_, gain, view; uniform vec2 sr, lr, win, wr;
float rng(float x, float lo, float hi, float s) { return smoothstep(lo - s, lo, x) * (1.0 - smoothstep(hi, hi + s, x)); }
vec3 hsv(vec3 c) { float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn, h = 0.0;
  if (d > 1e-6) { if (mx == c.r) h = mod((c.g - c.b) / d, 6.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0; h *= 60.0; if (h < 0.0) h += 360.0; }
  return vec3(h, mx > 1e-6 ? d / mx : 0.0, mx); }
vec3 rgbOf(vec3 q) { vec3 n = vec3(5.0, 3.0, 1.0); vec3 k = mod(n + q.x / 60.0, 6.0); return q.z - q.z * q.y * max(vec3(0.0), min(min(k, 4.0 - k), vec3(1.0))); }
float ss1(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
void main() {
  vec4 c = texelFetch(src, ivec2(gl_FragCoord.xy), 0); vec2 p = gl_FragCoord.xy / size; float m = 1.0;
  if (qon > 0.5) { vec3 q = hsv(c.rgb); float l = dot(c.rgb, vec3(.2126, .7152, .0722)), dh = abs(q.x - hc); dh = min(dh, 360.0 - dh);
    float kh = hw >= 180.0 ? 1.0 : 1.0 - ss1(hw, hw + hs, dh); m = kh * (ss1(sr.x - rs, sr.x, q.y) * (1.0 - ss1(sr.y, sr.y + rs, q.y))) * (ss1(lr.x - rs, lr.x, l) * (1.0 - ss1(lr.y, lr.y + rs, l))); }
  if (wm > 0.5) { float dy = (p.y - win.y) / wr.y, d = wm < 1.5 ? length(vec2((p.x - win.x) / wr.x, dy)) : max(abs((p.x - win.x) / wr.x), abs(dy));
    float k = 1.0 - ss1(1.0 - wsf, 1.0, d); if (winv > 0.5) k = 1.0 - k; m *= k; }
  vec3 outc;
  if (view > 0.5) outc = vec3(m);
  else { vec3 q = hsv(c.rgb); vec3 a = rgbOf(vec3(mod(q.x + ah + 360.0, 360.0), clamp(q.y * as_, 0.0, 1.0), clamp(q.z * gain, 0.0, 1.0))); outc = clamp(mix(c.rgb, a, m), 0.0, 1.0); }
  o = vec4(outc, c.a); }`,
    uniforms: { hc: 'f', hw: 'f', hs: 'f', rs: 'f', qon: 'f', wm: 'f', wsf: 'f', winv: 'f', ah: 'f', as_: 'f', gain: 'f', view: 'f', sr: 'v2', lr: 'v2', win: 'v2', wr: 'v2' },
    uni: p => { const u = uni(p); return Object.assign({}, u, { as_: u.as }); } });
  return { uni, matte, shade, hsv, rgbOf, WM, WI, VIEW };
})();
