'use strict';
/* ====================== NEXORA effects & filters library ======================
   One GPU "uber" shader with ~40 building blocks (camera, 13 distortions, chromatic split, 3 blur modes, full colour
   grade, glow, neon edges, light leaks, scanlines, VHS, halftone, grain, vignette, flash). Every library item is a
   preset = base uniform values + time-based modulation curves (sin / saw / triangle / square / beat / decay / noise),
   so effects animate on their own, stay frame-exact on export, and differ visibly from each other.
   The catalogue is generated from families × parameter grids (+ combo recipes), de-duplicated by exact parameter set.
   Kinds:  fx (effects)  ·  filter (colour looks)  ·  tin / tout (transitions applied over the start / end of a clip). */
const Library = (() => {
  /* ---------------- shader ---------------- */
  const U = { time: 'f', zoom: 'f', rot: 'f', offx: 'f', offy: 'f', dmode: 'i', d1: 'f', d2: 'f', d3: 'f', rgb: 'f', rgbAng: 'f', bmode: 'i', bamt: 'f', bang: 'f',
    expo: 'f', contrast: 'f', sat: 'f', hue: 'f', temp: 'f', tint: 'f', fade: 'f', invert: 'f', poster: 'f', curveS: 'f', bw: 'f', duo: 'f', tintAmt: 'f', splitAmt: 'f', splitBal: 'f',
    lift: 'v3', gammaV: 'v3', gain: 'v3', bwMix: 'v3', duoA: 'v3', duoB: 'v3', tintCol: 'v3', shadowTint: 'v3', highTint: 'v3',
    flash: 'f', flashCol: 'v3', glow: 'f', glowThr: 'f', glowR: 'f', vig: 'f', vigSoft: 'f', vigCol: 'v3', leak: 'f', leakSize: 'f', leakCol: 'v3', leakPos: 'v2',
    scan: 'f', scanFreq: 'f', grain: 'f', vhs: 'f', halftone: 'f', htSize: 'f', edge: 'f', edgeCol: 'v3', mixAmt: 'f', gmode: 'i', g1: 'f', g2: 'f', g3: 'f', gc1: 'v3', gc2: 'v3' };
  const ID = { time: 0, zoom: 1, rot: 0, offx: 0, offy: 0, dmode: 0, d1: 0, d2: 0, d3: 0, rgb: 0, rgbAng: 0, bmode: 0, bamt: 0, bang: 0, expo: 0, contrast: 1, sat: 1, hue: 0, temp: 0, tint: 0, fade: 0, invert: 0, poster: 0, curveS: 0, bw: 0, duo: 0, tintAmt: 0, splitAmt: 0, splitBal: 0,
    lift: [0, 0, 0], gammaV: [1, 1, 1], gain: [1, 1, 1], bwMix: [.2126, .7152, .0722], duoA: [0, 0, 0], duoB: [1, 1, 1], tintCol: [1, 1, 1], shadowTint: [.5, .5, .5], highTint: [.5, .5, .5],
    flash: 0, flashCol: [1, 1, 1], glow: 0, glowThr: .6, glowR: 6, vig: 0, vigSoft: .5, vigCol: [0, 0, 0], leak: 0, leakSize: .5, leakCol: [1, .6, .3], leakPos: [.85, .15], scan: 0, scanFreq: 1, grain: 0, vhs: 0, halftone: 0, htSize: 8, edge: 0, edgeCol: [.5, .8, 1], mixAmt: 1, gmode: 0, g1: 0, g2: 1, g3: 1, gc1: [1, 1, 1], gc2: [1, 1, 1] };
  const SRC = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D src; uniform vec2 size; uniform float pq;
#define FC (gl_FragCoord.xy / pq)
${Object.entries(U).map(([n, t]) => `uniform ${t === 'f' ? 'float' : t === 'i' ? 'int' : t === 'v2' ? 'vec2' : 'vec3'} ${n};`).join('\n')}
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float lum(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
float vnoise(vec2 p);
vec4 S(vec2 uv) { return texture(src, uv); }
vec2 geom(vec2 uv) {
  float asp = size.x / size.y; vec2 p = uv - .5; p.x *= asp;
  float c = cos(rot), s = sin(rot); p = mat2(c, -s, s, c) * p; p /= max(zoom, .01); p += vec2(offx, offy);
  float r = length(p), a = atan(p.y, p.x);
  if (dmode == 1) p.x += d1 * sin(p.y * d2 * 6.2832 + time * d3);
  else if (dmode == 2) p.y += d1 * sin(p.x * d2 * 6.2832 + time * d3);
  else if (dmode == 3) p += (r > 0.0 ? p / r : vec2(0)) * d1 * sin(r * d2 * 6.2832 - time * d3);
  else if (dmode == 4) { float k = clamp(1.0 - r / max(d2, .01), 0.0, 1.0); float an = (d1 + time * d3) * k * k; float cc = cos(an), ss = sin(an); p = mat2(cc, -ss, ss, cc) * p; }
  else if (dmode == 5) { if (r < d2) p *= 1.0 - d1 * (1.0 - (r / d2) * (r / d2)); }
  else if (dmode == 6) { float seg = 6.2832 / max(d1, 2.0); float aa = mod(a + time * d3, seg); aa = abs(aa - seg * .5); p = vec2(cos(aa), sin(aa)) * r; }
  else if (dmode == 7) { int m = int(d1 + .5); if (m == 0) p.x = -abs(p.x); else if (m == 1) p.x = abs(p.x); else if (m == 2) p.y = -abs(p.y); else p = -abs(p); }
  else if (dmode == 8) { p.x /= asp; p = fract((p + .5) * max(d1, 1.0) + vec2(time * d3, 0.0)) - .5; p.x *= asp; }
  else if (dmode == 9) { vec2 px = vec2(max(d1, 1.0)) / size; p.x /= asp; vec2 q = (floor((p + .5) / px) + .5) * px; p = q - .5; p.x *= asp; }
  else if (dmode == 10) { float row = floor((p.y + .5) * size.y / max(d2, 2.0)); float tt = floor(time * d3); if (hash(vec2(row, tt)) < d1) p.x += (hash(vec2(tt, row + 7.0)) - .5) * .4; }
  else if (dmode == 11) p *= 1.0 + d1 * r * r;
  else if (dmode == 12) { p.x /= asp; p.x = fract((p.x + .5) * max(d1, 1.0)) - .5; p.x *= asp; }
  else if (dmode == 13) { float h = max(d1, .004); vec2 H = vec2(1.0, 1.732) * h, a1 = mod(p, H) - H * .5, b1 = mod(p - H * .5, H) - H * .5; p = dot(a1, a1) < dot(b1, b1) ? p - a1 : p - b1; }
  else if (dmode == 14) p += (vec2(vnoise(p * d2 + time * d3), vnoise(p * d2 + 7.3 - time * d3)) - .5) * d1 * 2.0;
  else if (dmode == 15) { float rr = max(r, .001); p = vec2(cos(a), sin(a)) * (fract(log(rr) * d1 + time * d3) * .42 + .06); }
  else if (dmode == 16) { float w = fract(time * d3) * 1.25, dd = r - w; if (abs(dd) < d2) p -= (r > 0.0 ? p / r : vec2(0)) * d1 * (1.0 - abs(dd) / d2) * sign(dd); }
  else if (dmode == 17) p += vec2(sin(p.y * d2 * 6.2832 + time * d3), cos(p.x * d2 * 6.2832 + time * d3 * 1.1)) * d1;
  else if (dmode == 18) { float b = floor((p.y + .5) * d2); p.x += sin(b * 3.7 + time * d3) * d1; }
  p.x /= asp; return p + .5;
}
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = .5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= .5; } return v; }
const float BAYER[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
float flake(vec2 q, float sc, float sp, float drift) { vec2 u = q * sc; u.y -= time * sp; u.x += sin(time * .7 + u.y) * drift; vec2 id = floor(u), f = fract(u) - .5, o = vec2(hash(id), hash(id + 3.1)) - .5; return smoothstep(.12, .0, length(f - o * .7)); }
/* looks painted over the picture: uv in 0..1 with y down, q centred and aspect-correct */
vec3 genFx(vec3 c, vec2 uv, vec2 g, float A) {
  vec2 q = (uv - .5) * vec2(A, 1.0); float T = time;
  if (gmode == 1) { float s = 0.0; for (int i = 0; i < 3; i++) { float fi = float(i); vec2 u = (q + vec2(q.y * .12, 0)) * vec2(46.0 + fi * 22.0, 3.0 + fi) * g2; u.y -= T * g3 * (7.0 + fi * 2.0) + hash(vec2(floor(u.x), fi)) * 20.0; s += step(.93, hash(vec2(floor(u.x), floor(u.y)))) * smoothstep(0.0, 1.0, fract(u.y)) * (1.0 - fi * .25); } return c + gc1 * s * g1 * .6; }
  if (gmode == 2) { float s = flake(q, 7.0 * g2, g3 * .5, .25) + flake(q + 3.3, 14.0 * g2, g3 * .8, .2) * .7 + flake(q + 7.1, 26.0 * g2, g3 * 1.2, .15) * .45; return mix(c, gc1, clamp(s * g1, 0.0, 1.0)); }
  if (gmode == 3) { float s = 0.0; for (int i = 0; i < 2; i++) { vec2 u = (q + float(i) * 4.7) * 11.0 * g2 * (1.0 + float(i)); vec2 id = floor(u), f = fract(u) - .5 - (vec2(hash(id), hash(id + 5.0)) - .5) * .6; float tw = pow(.5 + .5 * sin(T * g3 * 5.0 + hash(id + 9.0) * 6.28), 6.0); s += tw * (.012 / (abs(f.x * f.y) + .012)) * smoothstep(.5, .0, length(f)); } return c + mix(gc1, gc2, fract(s)) * s * g1; }
  if (gmode == 4) { float an = atan(q.y, q.x), rr = length(q), n = vnoise(vec2(an * 34.0 * g2, floor(T * g3 * 14.0) * 1.7)); return mix(c, gc1, smoothstep(.62, .78, n) * smoothstep(.2, .72, rr) * g1); }
  if (gmode == 5) { vec2 o = q - vec2(-.45 * A, -.62); float an = atan(o.y, o.x), ray = pow(vnoise(vec2(an * 14.0 * g2 + T * g3 * .35, T * g3 * .15)), 2.2) * smoothstep(2.0, .2, length(o)); return c + gc1 * ray * g1 * 2.2; }
  if (gmode == 6) { float tt = floor(T * g3 * 12.0), sc = smoothstep(.0022, .0, abs(fract(uv.x + hash(vec2(tt, 5.0))) - .5)) * step(.45, hash(vec2(tt, 9.0))), dust = step(.9975, hash(floor(FC / (2.0 * g2)) + tt)); c = mix(c, vec3(.92), dust * g1); return c * (1.0 - sc * .75 * g1) * (1.0 - .08 * g1 * hash(vec2(tt, 2.0))); }
  if (gmode == 7) { for (int i = 0; i < 16; i++) { float fi = float(i); vec2 ce = vec2((hash(vec2(fi, 1)) - .5) * A * 1.2 + sin(T * g3 * .3 + fi) * .06, (fract(hash(vec2(fi, 2)) - T * g3 * .03) - .5) * 1.2); float R = (.05 + .11 * hash(vec2(fi, 3))) * g2; c += mix(gc1, gc2, hash(vec2(fi, 4))) * smoothstep(R, R * .86, length(q - ce)) * g1 * .3; } return c; }
  if (gmode == 8) { float ed = 0.0, L0 = lum(S(g).rgb); for (int i = 0; i < 12; i++) { float a = float(i) * .5236; ed += abs(lum(S(g + vec2(cos(a), sin(a)) * 9.0 * g2 / size).rgb) - L0); } ed = clamp(ed / 12.0 * 7.0, 0.0, 1.0); float fl = fbm(vec2(q.x * 7.0 * g2, q.y * 7.0 * g2 + T * g3 * 1.8)); return c + mix(gc1, gc2, fl) * ed * (.35 + fl * 1.5) * g1 * 1.9; }
  if (gmode == 9) { float n = fbm(vec2(q.x * 5.0 * g2, uv.y * 4.0 + T * g3 * 2.0)), f = clamp(n * 1.7 - (1.0 - uv.y) * 2.9, 0.0, 1.0); return c + mix(gc1, gc2, f) * f * g1 * 2.2; }
  if (gmode == 10) { float n = fbm(q * 3.0 * g2 + vec2(T * g3 * .3, T * g3 * .1)); return mix(c, gc1, smoothstep(.34, .82, n) * g1); }
  if (gmode == 11) { float s = fract(T * g3 * .5) * 2.6 - 1.3, d = abs(q.x * .8 + q.y * .55 - s * A * .55); return c + gc1 * smoothstep(.22 * g2, 0.0, d) * g1 * 1.7; }
  if (gmode == 12) { float s = 0.0; for (int i = 0; i < 4; i++) { float z = fract(T * g3 * .22 + float(i) * .25); vec2 u = q / (.15 + z) * 5.0 * g2 + float(i) * 11.0; vec2 id = floor(u), f = fract(u) - .5; s += smoothstep(.06, .0, length(f - (vec2(hash(id), hash(id + 2.0)) - .5) * .7)) * smoothstep(0.0, .35, z) * step(.55, hash(id + 8.0)); } return c + gc1 * s * g1 * 1.6; }
  if (gmode == 13) { vec2 ce = mod(floor(FC / max(g2, 1.0)), 4.0); float b = (BAYER[int(ce.y) * 4 + int(ce.x)] + .5) / 16.0; vec3 d = floor(clamp(c, 0.0, 1.0) * g3 + b) / g3; return mix(c, d, g1); }
  if (gmode == 14) { float m = lum(c), l = 1.0; if (m < .78 && mod(FC.x + FC.y, g2) < 1.6) l = 0.0; if (m < .52 && mod(FC.x - FC.y, g2) < 1.6) l = 0.0; if (m < .3 && mod(FC.x + FC.y - g2 * .5, g2) < 1.6) l = 0.0; return mix(c, mix(gc1, gc2, l), g1); }
  if (gmode == 15) { vec2 fp = vec2(sin(T * g3 * .35) * .34 * A, -.22), o = q - fp; float st = exp(-abs(o.y) * 85.0) * exp(-abs(o.x) * 1.5), core = .018 / (length(o) + .018), gh = smoothstep(.05, .0, length(q + fp * .7)) * .5 + smoothstep(.09, .0, length(q + fp * 1.3)) * .25; return c + gc1 * (st + core + gh) * g1; }
  if (gmode == 16) { float fl = step(.28, hash(vec2(floor(T * g3 * 9.0), 1.0))), s = 0.0; for (int i = 0; i < 3; i++) { float fi = float(i), y = q.y + (fbm(vec2(q.x * 5.0 * g2 + fi * 9.0, T * g3 * 3.0)) - .5) * .9 + (fi - 1.0) * .22; s += .0055 / (abs(y) + .0012); } return c + gc1 * s * fl * g1; }
  if (gmode == 17) { return c * (1.0 - g1 * .32 + g1 * .64 * fbm(q * 120.0 * g2)); }
  if (gmode == 18) { vec2 u = q * 6.0 * g2, ip = floor(u), fp = fract(u); float F1 = 8.0, F2 = 8.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 n = vec2(float(x), float(y)), pt = vec2(hash(ip + n), hash(ip + n + 3.7)); float dd = length(n + pt - fp); if (dd < F1) { F2 = F1; F1 = dd; } else if (dd < F2) F2 = dd; } return c + gc1 * smoothstep(.05, .0, F2 - F1) * g1; }
  if (gmode == 19) { float cc = pow(1.0 - abs(sin(fbm(q * 4.0 * g2 + T * g3 * .4) * 11.0)), 7.0); return c + gc1 * cc * g1 * 1.4; }
  return c;
}
vec4 chroma(vec2 uv) { if (rgb <= 0.0) return S(uv); vec2 d = vec2(cos(rgbAng), sin(rgbAng)) * rgb / size; vec4 a = S(uv); return vec4(S(uv + d).r, a.g, S(uv - d).b, max(a.a, max(S(uv + d).a, S(uv - d).a))); }
vec4 blurred(vec2 uv) {
  if (bmode == 0 || bamt <= 0.0) return chroma(uv);
  vec4 acc = vec4(0);
  for (int i = 0; i < 12; i++) { float k = float(i) / 11.0 - .5; vec2 q = uv;
    if (bmode == 1) q += vec2(cos(bang), sin(bang)) * k * bamt * 80.0 / size;
    else if (bmode == 2) q = (uv - .5) * (1.0 + k * bamt * .3) + .5;
    else { vec2 d = uv - .5; float an = k * bamt * .4; float cc = cos(an), ss = sin(an); d.x *= size.x / size.y; d = mat2(cc, -ss, ss, cc) * d; d.x /= size.x / size.y; q = d + .5; }
    acc += chroma(q); }
  return acc / 12.0;
}
void main() {
  vec2 uv = FC / size; vec4 orig = S(uv); vec2 g = geom(uv); if (dmode >= 13) g = clamp(g, vec2(.0005), vec2(.9995));   /* newer distortions hold the edge instead of showing black */
  vec4 sm = (g.x < 0.0 || g.y < 0.0 || g.x > 1.0 || g.y > 1.0) ? vec4(0) : blurred(g); vec3 c = sm.rgb;
  if (glow > 0.0) { vec3 acc = vec3(0); for (int i = 0; i < 12; i++) { float a = float(i) * .5236; for (int j = 1; j <= 2; j++) { vec3 t = S(g + vec2(cos(a), sin(a)) * glowR * float(j) / size).rgb; acc += max(t - glowThr, 0.0); } } c += acc / 24.0 * glow * 2.0; }
  if (edge > 0.0) { vec2 e = 1.0 / size; float l1 = lum(S(g + vec2(e.x, 0)).rgb), l2 = lum(S(g - vec2(e.x, 0)).rgb), l3 = lum(S(g + vec2(0, e.y)).rgb), l4 = lum(S(g - vec2(0, e.y)).rgb); float ed = clamp(length(vec2(l1 - l2, l3 - l4)) * 4.0, 0.0, 1.0); c = mix(c, c * .25 + edgeCol * ed * 1.6, edge); }
  c *= exp2(expo);
  c += vec3(temp, -tint * .5, -temp) * .12;
  c = pow(max(c * gain + lift * (1.0 - c), 0.0), 1.0 / max(gammaV, vec3(.01)));
  c = (c - .5) * contrast + .5;
  vec3 cc = clamp(c, 0.0, 1.0); c = mix(c, cc * cc * (3.0 - 2.0 * cc), curveS);
  float L = lum(c); c = mix(vec3(L), c, sat);
  if (hue != 0.0) { mat3 toY = mat3(.299, .596, .211, .587, -.274, -.523, .114, -.322, .312); mat3 toR = mat3(1.0, 1.0, 1.0, .956, -.272, -1.106, .621, -.647, 1.703); vec3 y = toY * c; float hc = cos(hue), hs = sin(hue); y.yz = mat2(hc, -hs, hs, hc) * y.yz; c = toR * y; }
  L = lum(c); c += (mix(shadowTint, highTint, smoothstep(0.0, 1.0, L + splitBal)) - .5) * splitAmt;
  c = mix(c, vec3(dot(c, bwMix)), bw);
  c = mix(c, mix(duoA, duoB, clamp(lum(c), 0.0, 1.0)), duo);
  c = mix(c, c * tintCol * 1.3, tintAmt);
  c = c * (1.0 - fade) + fade * vec3(.16);
  if (poster > 1.5) c = floor(clamp(c, 0.0, 1.0) * poster + .5) / poster;
  c = mix(c, 1.0 - c, invert);
  if (leak > 0.0) { float d = length((g - leakPos) * vec2(size.x / size.y, 1.0)); c += leakCol * leak * smoothstep(leakSize, 0.0, d); }
  if (scan > 0.0) c *= 1.0 - scan * (.5 + .5 * sin(FC.y * scanFreq));
  if (vhs > 0.0) { float row = floor(FC.y / 3.0); c += (hash(vec2(row, floor(time * 24.0))) - .5) * vhs * .25; c.r += vhs * .06 * sin(FC.y * .05 + time * 8.0); }
  if (halftone > 0.0) { vec2 cell = mod(FC, htSize) - htSize * .5; float rr = length(cell) / (htSize * .5); c = mix(c, c * step(rr, sqrt(clamp(lum(c), 0.0, 1.0)) * 1.15), halftone); }
  if (grain > 0.0) c += (hash(FC + fract(time * 13.7) * 100.0) - .5) * grain;
  if (dmode == 16) { vec2 sq = (uv - .5) * vec2(size.x / size.y, 1.0); c += smoothstep(d2, 0.0, abs(length(sq) - fract(time * d3) * 1.25)) * d1 * 5.0; }   /* the bright rim makes the ring read on flat areas too */
  if (gmode > 0) c = genFx(c, uv, g, size.x / size.y);
  if (vig > 0.0) { vec2 q = (uv - .5) * vec2(size.x / size.y, 1.0); c = mix(c, vigCol, smoothstep(.85 - vigSoft, .85, length(q) * 1.2) * vig); }
  c = mix(c, flashCol, clamp(flash, 0.0, 1.0));
  o = mix(orig, vec4(clamp(c, 0.0, 1.0), sm.a), clamp(mixAmt, 0.0, 1.0));
}`;

  /* ---------------- modulation ---------------- */
  const TAU = Math.PI * 2, fr = x => x - Math.floor(x), nz = x => { const i = Math.floor(x), f = x - i, h = n => fr(Math.sin(n * 127.1 + 311.7) * 43758.5453) * 2 - 1, u = f * f * (3 - 2 * f); return h(i) * (1 - u) + h(i + 1) * u; };
  const WAVES = { sin: x => Math.sin(x * TAU), saw: x => fr(x) * 2 - 1, ramp: x => fr(x), tri: x => 1 - 4 * Math.abs(fr(x) - .5), square: x => fr(x) < .5 ? 1 : -1, beat: x => Math.exp(-fr(x) * 9), decay: x => Math.exp(-fr(x) * 4), noise: x => nz(x * 4), step: x => fr(Math.sin(Math.floor(x) * 91.7) * 977.3) * 2 - 1, lin: x => x };
  const isVec = n => U[n] === 'v3' || U[n] === 'v2';
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  /** uniforms for preset `pr` at clip time t. I = intensity 0..1, spd = speed multiplier, ld = clip length */
  function evaluate(pr, t, I, spd, ld, tdur) {
    const v = {}; for (const k in ID) v[k] = isVec(k) ? ID[k].slice() : ID[k];
    let k = I;
    if (pr.k === 'tin' || pr.k === 'tout') { const d = Math.max(.05, tdur || .5), x = pr.k === 'tin' ? t / d : ((ld || d) - t) / d; k = I * (1 - ease(clamp(x, 0, 1))); }
    for (const n in pr.u) { const b = pr.u[n]; if (n === 'dmode' || n === 'bmode' || n === 'poster' || n === 'htSize' || n === 'scanFreq' || n === 'glowR' || n === 'leakPos' || n === 'mixAmt' || n === 'glowThr' || n === 'vigSoft' || n === 'leakSize' || n === 'gmode' || n === 'g2' || n === 'g3' || n === 'gc1' || n === 'gc2') { v[n] = Array.isArray(b) ? b.slice() : b; continue; }
      if (Array.isArray(b)) v[n] = b.map((x, i) => ID[n][i] + (x - ID[n][i]) * k); else v[n] = ID[n] + (b - ID[n]) * k; }
    v.time = t * spd;
    for (const [n, w, amp, freq, ph] of pr.a || []) { const y = WAVES[w]((t * spd) * freq + (ph || 0)) * amp * k; if (isVec(n)) v[n] = v[n].map(x => x + y); else v[n] += y; }
    if (pr.u.poster) v.poster = k > .05 ? pr.u.poster : 0;
    if (pr.u.dmode && k < .001) v.dmode = 0;
    return v;
  }

  /* ---------------- catalogue ---------------- */
  const ITEMS = [], BYID = {}, seen = new Set(), NAMES = new Set();
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  function add(kind, cat, name, u, a, tags) {
    const key = kind + JSON.stringify(u) + JSON.stringify(a || []); if (seen.has(key)) return null; seen.add(key);
    let nm = name; for (let v = 2; NAMES.has(kind + nm); v++) nm = `${name} · v${v}`; NAMES.add(kind + nm);   // distinct parameters can share a description
    const id = kind[0] + ITEMS.length.toString(36), it = { id, k: kind, c: cat, n: nm, u, a: a || [], tags: tags || '' }; ITEMS.push(it); BYID[id] = it; return it;
  }
  const LV = ['Subtle', 'Light', 'Medium', 'Strong', 'Extreme'], SP = ['Slow', 'Normal', 'Fast', 'Hyper'];
  const COL = { White: '#ffffff', 'Ice Blue': '#9ad6ff', Blue: '#3b9bff', Warm: '#ffc27a', Gold: '#ffd166', Red: '#ff4d4d', Black: '#000000', Mint: '#8fffd2', Rose: '#ff9ec4', Violet: '#b9a6ff' };
  const fam = {};   // family → [{u, a, short}] variants, reused by combo recipes
  const put = (f, kind, cat, name, u, a, short) => { const it = add(kind, cat, name, u, a); if (it) (fam[f] = fam[f] || []).push({ u, a: a || [], short: short || name }); return it; };

  function buildEffects() {
    // --- camera shake ---
    [['Handheld', 'noise', 1, 0], ['Jitter', 'step', 1, 0], ['Earthquake', 'noise', 2.2, .02], ['Drift', 'sin', .8, 0], ['Bounce', 'tri', 0, 0]].forEach(([s, w, m, r]) => LV.forEach((l, li) => SP.forEach((sp, si) => {
      const A = .004 * (li + 1) * (m || 1), F = [.6, 1.2, 2.5, 5][si] * (w === 'step' ? 6 : 1), a = s === 'Bounce' ? [['offy', 'tri', A * 1.6, F * 2]] : [['offx', w, A, F], ['offy', w, A * .8, F * 1.13, .37]];
      if (r) a.push(['rot', w, r * (li + 1) * .5, F * .9, .7]); put('shake', 'fx', 'Shake', `${s} shake · ${l} · ${sp}`, { zoom: 1.04 + .01 * li }, a, `${s} ${l}`);
    })));
    // --- zoom ---
    [['Pulse', 'beat'], ['Breathe', 'sin'], ['Punch', 'decay'], ['Push', 'ramp'], ['Bounce', 'tri']].forEach(([s, w]) => LV.forEach((l, li) => [.5, 1, 2, 4, 8].forEach((f, fi) =>
      put('zoom', 'fx', 'Zoom', `${s} zoom · ${l} · ${['½×', '1×', '2×', '4×', '8×'][fi]}/s`, { zoom: 1 }, [['zoom', w, .04 + .05 * li, f]], `${s} zoom ${l}`))));
    // --- spin & roll ---
    [['Spin', 'lin'], ['Roll', 'sin'], ['Tilt sway', 'tri']].forEach(([s, w]) => [.25, .5, 1, 2].forEach((amp, ai) => SP.forEach((sp, si) => [1, 1.25].forEach(z =>
      put('spin', 'fx', 'Camera', `${s} ${['¼', '½', '1', '2'][ai]}${s === 'Spin' ? ' turn' : ''} · ${sp}${z > 1 ? ' · zoomed' : ''}`, { zoom: z }, [['rot', w, s === 'Spin' ? amp * TAU * [.25, .5, 1, 2][si] : amp * .2, s === 'Spin' ? 1 : [.3, .6, 1.2, 2.4][si]]], `${s} ${sp}`)))));
    // --- glitch ---
    [.1, .25, .4, .6, .8].forEach((p, pi) => [4, 8, 16, 32].forEach(bs => [6, 12, 24].forEach(rate => [0, 6].forEach(rg =>
      put('glitch', 'fx', 'Glitch', `Block glitch ${LV[pi]} · ${bs}px · ${rate}/s${rg ? ' · RGB' : ''}`, { dmode: 10, d1: p, d2: bs, d3: rate, rgb: rg }, [], `Glitch ${LV[pi]}`)))));
    [3, 6, 10, 16, 24].forEach((amt, ai) => [[0, 'Horizontal'], [Math.PI / 2, 'Vertical'], [Math.PI / 4, 'Diagonal'], [3 * Math.PI / 4, 'Cross']].forEach(([ang, an]) => ['sin', 'square', 'beat', 'noise'].forEach(w =>
      put('rgb', 'fx', 'Glitch', `RGB split ${an} · ${LV[ai]} · ${w}`, { rgbAng: ang }, [['rgb', w, amt, w === 'noise' ? 1.5 : 2]], `RGB ${an}`))));
    [4, 8, 16, 32, 64].forEach(s => ['square', 'beat', 'noise'].forEach(w => [0, 5].forEach(rg =>
      put('pixel', 'fx', 'Glitch', `Digital pixels ${s} · ${w}${rg ? ' · RGB' : ''}`, { dmode: 9, d1: 1, rgb: rg }, [['d1', w, s, 2]], `Pixels ${s}`))));
    [.3, .6, 1].forEach(v => [.2, .5].forEach(g => [0, .3].forEach(sc => [0, 1].forEach(fl =>
      put('signal', 'fx', 'Glitch', `Signal loss ${v} · glitch ${g}${sc ? ' · scanlines' : ''}${fl ? ' · flicker' : ''}`, { vhs: v, dmode: 10, d1: g, d2: 12, d3: 10, scan: sc, scanFreq: 1.4 }, fl ? [['expo', 'step', -.4, 12]] : [], 'Signal loss')))));
    // --- distort ---
    [[1, 'Wave X'], [2, 'Wave Y']].forEach(([m, n]) => [.005, .01, .02, .04, .07].forEach((amp, ai) => [1, 2, 4, 8].forEach(f => [0, 1, 3, 6].forEach(s =>
      put('wave', 'fx', 'Distort', `${n} · ${LV[ai]} · ${f} waves${s ? ' · moving ' + s : ''}`, { dmode: m, d1: amp, d2: f, d3: s }, [], `${n} ${LV[ai]}`)))));
    [.005, .01, .02, .035, .06].forEach((amp, ai) => [4, 8, 16, 32].forEach(f => [1, 3, 6, 10].forEach(s =>
      put('ripple', 'fx', 'Distort', `Ripple · ${LV[ai]} · ${f} rings · speed ${s}`, { dmode: 3, d1: amp, d2: f, d3: s }, [], `Ripple ${LV[ai]}`))));
    [-6, -3, -1.5, 1.5, 3, 6].forEach(a => [.3, .5, .8].forEach(r => ['static', 'pulse', 'spin'].forEach(m =>
      put('swirl', 'fx', 'Distort', `Swirl ${a > 0 ? '+' : ''}${a} · radius ${r} · ${m}`, { dmode: 4, d1: m === 'pulse' ? 0 : a, d2: r, d3: m === 'spin' ? a / 2 : 0 }, m === 'pulse' ? [['d1', 'sin', a, .8]] : [], `Swirl ${a}`))));
    [-.8, -.5, -.25, .25, .5, .8].forEach(a => [.3, .5, .8].forEach(r => ['static', 'sin', 'beat'].forEach(m =>
      put('bulge', 'fx', 'Distort', `${a > 0 ? 'Bulge' : 'Pinch'} ${Math.abs(a)} · radius ${r} · ${m}`, { dmode: 5, d1: m === 'static' ? a : 0, d2: r }, m === 'static' ? [] : [['d1', m, a, 1.5]], `${a > 0 ? 'Bulge' : 'Pinch'} ${Math.abs(a)}`))));
    [.2, .4, .7, 1, -.3, -.5].forEach(a => ['static', 'sin', 'beat'].forEach(m =>
      put('fisheye', 'fx', 'Distort', `${a > 0 ? 'Fisheye' : 'Barrel squeeze'} ${Math.abs(a)} · ${m}`, { dmode: 11, d1: m === 'static' ? a : 0 }, m === 'static' ? [] : [['d1', m, a, 1.2]], `Fisheye ${a}`)));
    // --- kaleidoscope, mirror, tiles ---
    for (let seg = 3; seg <= 12; seg++) [0, .3, .8, 1.5, 3].forEach(sp => [1, 1.3, .8].forEach(z =>
      put('kaleido', 'fx', 'Kaleidoscope', `Kaleidoscope ${seg} · ${sp ? 'spin ' + sp : 'still'}${z !== 1 ? ' · zoom ' + z : ''}`, { dmode: 6, d1: seg, d3: sp, zoom: z }, [], `Kaleido ${seg}`)));
    ['Left → Right', 'Right → Left', 'Top → Bottom', 'Quad'].forEach((n, m) => [1, 1.2].forEach(z => [0, 1].forEach(sp =>
      put('mirror', 'fx', 'Kaleidoscope', `Mirror ${n}${z > 1 ? ' · zoomed' : ''}${sp ? ' · rotating' : ''}`, { dmode: 7, d1: m, zoom: z }, sp ? [['rot', 'sin', .15, .3]] : [], `Mirror ${n}`))));
    [2, 3, 4, 5, 6].forEach(n => [0, .2, .5, 1].forEach(s => [0, 1].forEach(sp =>
      put('tile', 'fx', 'Kaleidoscope', `Tiles ${n}×${n}${s ? ' · scroll ' + s : ''}${sp ? ' · spin' : ''}`, { dmode: 8, d1: n, d3: s }, sp ? [['rot', 'lin', TAU * .25, 1]] : [], `Tiles ${n}`))));
    [2, 3, 4].forEach(n => [1, .8, 1.2].forEach(z => put('split', 'fx', 'Kaleidoscope', `Split screen ×${n}${z !== 1 ? ' · zoom ' + z : ''}`, { dmode: 12, d1: n, zoom: z }, [], `Split ×${n}`)));
    // --- blur ---
    [0, 45, 90, 135].forEach(ang => [.15, .3, .5, .8, 1.2].forEach((amt, ai) => ['static', 'sin', 'beat'].forEach(m =>
      put('dblur', 'fx', 'Blur', `Motion blur ${ang}° · ${LV[ai]} · ${m}`, { bmode: 1, bang: ang * Math.PI / 180, bamt: m === 'static' ? amt : 0 }, m === 'static' ? [] : [['bamt', m, amt, 1.5]], `Motion blur ${LV[ai]}`))));
    [.2, .4, .7, 1, 1.5, 2].forEach(amt => ['static', 'sin', 'beat', 'decay'].forEach(m =>
      put('zblur', 'fx', 'Blur', `Zoom blur ${amt} · ${m}`, { bmode: 2, bamt: m === 'static' ? amt : 0 }, m === 'static' ? [] : [['bamt', m, amt, 1.5]], `Zoom blur ${amt}`)));
    [.2, .5, 1, 2].forEach(amt => ['static', 'sin', 'beat'].forEach(m =>
      put('sblur', 'fx', 'Blur', `Spin blur ${amt} · ${m}`, { bmode: 3, bamt: m === 'static' ? amt : 0 }, m === 'static' ? [] : [['bamt', m, amt, 1.2]], `Spin blur ${amt}`)));
    [.3, .6, 1, 1.5].forEach(amt => ['still', 'sin', 'beat'].forEach(m =>
      put('dream', 'fx', 'Blur', `Dreamy glow ${amt} · ${m}`, { bmode: 2, bamt: amt * .4, glow: amt, glowThr: .45, glowR: 10, fade: .05 }, m === 'still' ? [] : [['glow', m, amt * .6, .8]], `Dreamy ${amt}`)));
    // --- light ---
    const flashCols = ['White', 'Ice Blue', 'Warm', 'Red', 'Black', 'Gold'];
    flashCols.forEach(cn => [.5, 1, 2, 4, 8].forEach(r => ['beat', 'square', 'sin', 'decay'].forEach(w =>
      put('flash', 'fx', 'Light', `${cn} flash · ${r}/s · ${w}`, { flashCol: hex(COL[cn]) }, [['flash', w, w === 'square' ? .35 : w === 'sin' ? .3 : .85, r]], `${cn} flash`))));
    [4, 6, 8, 12, 16].forEach(r => ['White', 'Ice Blue', 'Black', 'Red'].forEach(cn =>
      put('strobe', 'fx', 'Light', `Strobe ${cn} · ${r} Hz`, { flashCol: hex(COL[cn]) }, [['flash', 'square', .5, r]], `Strobe ${cn}`)));
    const leakCols = ['Warm', 'Gold', 'Red', 'Rose', 'Ice Blue', 'Blue', 'Mint', 'Violet', 'White'];
    const POS = [['top right', [.88, .12]], ['top left', [.12, .12]], ['bottom right', [.88, .88]], ['bottom left', [.12, .88]], ['centre', [.5, .5]]];
    leakCols.forEach(cn => POS.forEach(([pn, pos]) => [0, .5, 1.5].forEach(d => [.4, .8].forEach(sz =>
      put('leak', 'fx', 'Light Leaks', `${cn} leak · ${pn}${d ? ' · drifting ' + d : ''} · ${sz > .5 ? 'wide' : 'tight'}`, { leak: .9, leakCol: hex(COL[cn]), leakPos: pos, leakSize: sz }, d ? [['leak', 'sin', .4, d * .3], ['leakPos', 'sin', .08, d * .2]] : [], `${cn} leak`)))));
    [.4, .55, .7, .85].forEach(thr => [.4, .8, 1.2, 2, 3].forEach((g, gi) => ['still', 'sin', 'beat'].forEach(m =>
      put('glow', 'fx', 'Glow', `Glow ${LV[gi]} · threshold ${thr} · ${m}`, { glow: g, glowThr: thr, glowR: 8 }, m === 'still' ? [] : [['glow', m, g * .6, 1.2]], `Glow ${LV[gi]}`))));
    ['Ice Blue', 'Blue', 'White', 'Mint', 'Rose', 'Gold', 'Red', 'Violet'].forEach(cn => [.4, .6, .8, 1].forEach(e => [0, 1].forEach(gl =>
      put('neon', 'fx', 'Glow', `Neon edges ${cn} · ${e}${gl ? ' · glowing' : ''}`, { edge: e, edgeCol: hex(COL[cn]), glow: gl ? 1 : 0, glowThr: .3 }, [], `Neon ${cn}`))));
    // --- retro & film ---
    [.8, 1.2, 2, 3].forEach(f => [.15, .3, .5, .7].forEach(a => [0, 1].forEach(fl =>
      put('scan', 'fx', 'Retro', `Scanlines ${a} · density ${f}${fl ? ' · flicker' : ''}`, { scan: a, scanFreq: f }, fl ? [['expo', 'noise', .12, 3]] : [], 'Scanlines'))));
    [.2, .4, .6, .8].forEach(c => [2, 4, 6, 8].forEach(r =>
      put('crt', 'fx', 'Retro', `CRT TV ${c} · RGB ${r}`, { scan: c, scanFreq: 2, dmode: 11, d1: .15, vig: .6, rgb: r, contrast: 1.1 }, [], 'CRT')));
    [.2, .4, .7, 1].forEach(v => [0, 3, 6].forEach(r => [0, .2].forEach(g => [1, .6].forEach(s =>
      put('vhs', 'fx', 'VHS', `VHS ${v} · bleed ${r}${g ? ' · tracking' : ''}${s < 1 ? ' · washed' : ''}`, { vhs: v, rgb: r, dmode: g ? 10 : 0, d1: g, d2: 20, d3: 4, sat: s, fade: .05 }, [], `VHS ${v}`)))));
    [.4, .7, 1].forEach(sp => [.05, .1, .18, .25].forEach(gr => [0, .08, .15].forEach(fl => [.4, .8].forEach(vg =>
      put('oldfilm', 'fx', 'Retro', `Old film · sepia ${sp} · grain ${gr}${fl ? ' · flicker ' + fl : ''} · vignette ${vg}`, { duo: sp, duoA: hex('#2a1a0c'), duoB: hex('#f2dfb4'), grain: gr, vig: vg }, fl ? [['expo', 'noise', fl * 2, 4], ['offy', 'step', .002, 8]] : [], 'Old film')))));
    [.4, .7, 1].forEach(w => [.06, .1, .15, .2].forEach(gr => put('super8', 'fx', 'Retro', `Super 8 · warmth ${w} · grain ${gr}`, { temp: w, grain: gr, vig: .5, fade: .06, leak: .5, leakCol: hex('#ffb070'), leakSize: .6 }, [['offx', 'noise', .003, 2], ['leak', 'sin', .3, .2]], 'Super 8')));
    [4, 6, 8, 12, 16].forEach(s => [['colour', {}], ['B&W', { bw: 1 }], ['blue ink', { duo: 1, duoA: hex('#0a2540'), duoB: hex('#e8f4ff') }]].forEach(([n, x]) => [0, 1].forEach(p =>
      put('halftone', 'fx', 'Art', `Halftone ${s}px · ${n}${p ? ' · pulsing' : ''}`, Object.assign({ halftone: 1, htSize: s }, x), p ? [['halftone', 'sin', -.4, .8]] : [], `Halftone ${n}`))));
    [3, 4, 5, 6].forEach(l => [1.3, 1.8, 2.5].forEach(s => [0, 1].forEach(h =>
      put('pop', 'fx', 'Art', `Pop art ${l} levels · saturation ${s}${h ? ' · colour cycle' : ''}`, { poster: l, sat: s, contrast: 1.15 }, h ? [['hue', 'lin', TAU, .25]] : [], `Pop art ${l}`))));
    // --- colour fx ---
    [.1, .25, .5, 1, 2, 4].forEach(sp => [1, 1.4, 2].forEach(s => put('huecycle', 'fx', 'Color FX', `Colour cycle ${sp}/s · saturation ${s}`, { sat: s }, [['hue', 'lin', TAU, sp]], `Colour cycle ${sp}`)));
    [.5, 1, 2, 4, 8].forEach(r => ['square', 'beat'].forEach(w => put('invflash', 'fx', 'Color FX', `Invert flash ${r}/s · ${w}`, {}, [['invert', w, w === 'square' ? .5 : 1, r]], 'Invert flash')));
    [.3, .6, 1, 1.5].forEach(a => [.5, 1, 2, 4, 8].forEach(r => put('satpulse', 'fx', 'Color FX', `Saturation pulse ${a} · ${r}/s`, {}, [['sat', 'sin', a, r]], 'Sat pulse')));
    const DUOS = [['#0a2540', '#9ad6ff', 'Midnight'], ['#000000', '#ffffff', 'Ink'], ['#06122b', '#5cb8ff', 'Deep blue'], ['#1b0f2e', '#ffb3c7', 'Dusk'], ['#082a1e', '#b8ffd9', 'Mint'], ['#2b0b0b', '#ffcf7a', 'Ember'], ['#0b1d2b', '#ffe6a8', 'Harbour'], ['#1a1a1a', '#e7ff6b', 'Acid'], ['#121a3a', '#ff7aa2', 'Synth'], ['#062b2b', '#fff3d6', 'Sea glass'], ['#24140a', '#e9d2a6', 'Coffee'], ['#0d0d20', '#b0c4ff', 'Lilac'], ['#2a0016', '#ffd6e6', 'Berry'], ['#001a33', '#ffffff', 'Arctic'], ['#1c1c1c', '#ff4d4d', 'Signal'], ['#0f2a12', '#d8ff9e', 'Lime'], ['#2c1a00', '#ffe9b0', 'Honey'], ['#0b0b2e', '#7cf7ff', 'Cyan'], ['#200d00', '#ffb27a', 'Rust'], ['#141414', '#9ad6ff', 'Steel']];
    DUOS.forEach(([a, b, n]) => ['still', 'sin', 'beat'].forEach(m => put('duo', 'fx', 'Color FX', `Duotone ${n}${m !== 'still' ? ' · ' + (m === 'sin' ? 'breathing' : 'on beat') : ''}`, { duo: m === 'still' ? 1 : .5, duoA: hex(a), duoB: hex(b) }, m === 'still' ? [] : [['duo', m, .5, 1]], `Duotone ${n}`)));
    [.3, .6, 1, 1.5].forEach(a => [.25, .5, 1, 2].forEach(r => put('tempswing', 'fx', 'Color FX', `Temperature swing ${a} · ${r}/s`, {}, [['temp', 'sin', a, r]], 'Temp swing')));
    [1, 2, 4, 8].forEach(r => ['square', 'beat'].forEach(w => put('bwflash', 'fx', 'Color FX', `Black & white flash ${r}/s · ${w}`, {}, [['bw', w, 1, r]], 'B&W flash')));
    [3, 4, 6].forEach(l => [1, 2, 4].forEach(r => put('posterpulse', 'fx', 'Color FX', `Posterize ${l} · pulsing ${r}/s`, { poster: l }, [['contrast', 'beat', .4, r]], `Posterize ${l}`)));
    // --- frames, lens, atmosphere ---
    ['Black', 'White', 'Ice Blue', 'Blue', 'Warm', 'Rose'].forEach(cn => [.35, .55, .75, .95].forEach(a => [.2, .5, .8].forEach(sft =>
      put('frame', 'fx', 'Frames', `${cn} vignette frame ${a} · ${['hard', 'medium', 'soft'][[.2, .5, .8].indexOf(sft)]}`, { vig: a, vigSoft: sft, vigCol: hex(COL[cn]) }, [], `${cn} frame`))));
    [2, 4, 8, 14].forEach(ca => [.1, .25, .45, .7].forEach(fe => ['still', 'sin', 'beat'].forEach(m =>
      put('lens', 'fx', 'Lens', `Lens · chroma ${ca} · curve ${fe} · ${m}`, { rgb: ca, dmode: 11, d1: fe, vig: .45, glow: .3, glowThr: .7 }, m === 'still' ? [] : [['rgb', m, ca, 1.2]], 'Lens'))));
    [['Haze', { fade: .18, glow: .5, glowThr: .5, contrast: .9 }], ['Fog', { fade: .32, bmode: 2, bamt: .15, sat: .8 }], ['Mist', { fade: .22, temp: -.2, glow: .4, glowThr: .55 }], ['Golden dust', { temp: .4, glow: .8, glowThr: .5, grain: .05 }], ['Smog', { fade: .2, temp: .25, sat: .7, contrast: .9 }]].forEach(([n, u]) => [.6, .8, 1, 1.25].forEach(k => [0, 1].forEach(dr => {
      const uu = {}; for (const key in u) uu[key] = typeof u[key] === 'number' ? (ID[key] + (u[key] - ID[key]) * k) : u[key]; put('atmo', 'fx', 'Atmosphere', `${n} ${k}${dr ? ' · drifting' : ''}`, uu, dr ? [['fade', 'sin', .06, .2]] : [], n);
    })));
    // --- more camera moves ---
    LV.forEach((l, li) => SP.forEach((sp, si) => put('orbit', 'fx', 'Camera', `Orbit drift · ${l} · ${sp}`, { zoom: 1.05 + .01 * li }, [['offx', 'sin', .006 * (li + 1), [.2, .4, .8, 1.6][si]], ['offy', 'sin', .006 * (li + 1), [.2, .4, .8, 1.6][si], .25]], `Orbit ${l}`)));
    LV.forEach((l, li) => [.5, .75, 1, 1.5, 2].forEach(r => put('heart', 'fx', 'Zoom', `Heartbeat · ${l} · ${r}/s`, {}, [['zoom', 'beat', .03 + .03 * li, r], ['zoom', 'beat', .02 + .02 * li, r, .18]], `Heartbeat ${l}`)));
    LV.forEach((l, li) => [.25, .5, 1, 2, 4].forEach(r => put('dolly', 'fx', 'Zoom', `Dolly zoom · ${l} · ${r}/s`, { rgb: 2 + li }, [['zoom', 'tri', .08 + .06 * li, r * .5], ['rgb', 'tri', 2 + li, r * .5]], `Dolly ${l}`)));
    ['White', 'Ice Blue', 'Blue', 'Violet', 'Warm', 'Red'].forEach(cn => [1, 2, 4, 6].forEach(r => put('lightning', 'fx', 'Light', `Lightning ${cn} · ${r}/s`, { flashCol: hex(COL[cn]), glow: .6, glowThr: .6 }, [['flash', 'step', .45, r * 3], ['expo', 'step', .25, r * 3]], `Lightning ${cn}`)));
    ['White', 'Ice Blue', 'Warm', 'Gold', 'Rose', 'Mint'].forEach(cn => [.5, 1, 2].forEach(r => put('camflash', 'fx', 'Light', `Camera flash ${cn} · ${r}/s`, { flashCol: hex(COL[cn]), glow: .8, glowThr: .55 }, [['flash', 'decay', .9, r], ['glow', 'decay', 1, r]], `Camera flash ${cn}`)));
    const SIDES = [['left edge', [.02, .5]], ['right edge', [.98, .5]], ['top edge', [.5, .02]], ['bottom edge', [.5, .98]]];
    leakCols.forEach(cn => SIDES.forEach(([pn, pos]) => [0, .5, 1.5].forEach(d => [.5, .9].forEach(sz =>
      put('leak', 'fx', 'Light Leaks', `${cn} leak · ${pn}${d ? ' · drifting ' + d : ''} · ${sz > .6 ? 'wide' : 'tight'}`, { leak: .85, leakCol: hex(COL[cn]), leakPos: pos, leakSize: sz }, d ? [['leak', 'sin', .35, d * .3], ['leakPos', 'sin', .1, d * .2]] : [], `${cn} leak`)))));
    // --- retro looks & art ---
    [['Pocket green', '#0f380f', '#9bbc0f'], ['Pocket grey', '#222222', '#c4cfa1'], ['Pocket blue', '#0a1d3b', '#a8d8ff']].forEach(([n, a, b]) => [2, 3, 4, 6].forEach(px => put('pocket', 'fx', 'Retro', `${n} handheld · ${px}px`, { duo: 1, duoA: hex(a), duoB: hex(b), dmode: 9, d1: px, poster: 4 }, [], n)));
    [.5, .8, 1].forEach(k => [0, 1].forEach(m => put('thermal', 'fx', 'Color FX', `Thermal ${k}${m ? ' · shifting' : ''}`, { duo: k, duoA: hex('#10006b'), duoB: hex('#ffd000'), sat: 1.6, contrast: 1.2 }, m ? [['hue', 'sin', .6, .3]] : [], 'Thermal')));
    [.6, .8, 1].forEach(k => [.06, .12, .2].forEach(g => [0, 1].forEach(s => put('nvg', 'fx', 'Retro', `Night vision ${k} · noise ${g}${s ? ' · scanlines' : ''}`, { duo: k, duoA: hex('#001a00'), duoB: hex('#a6ff8f'), grain: g, vig: .8, scan: s * .3, scanFreq: 1.5, expo: .3 }, [], 'Night vision'))));
    [.6, .8, 1].forEach(k => [0, 1].forEach(gl => put('xray', 'fx', 'Color FX', `X-ray ${k}${gl ? ' · glowing' : ''}`, { invert: k, bw: 1, contrast: 1.3, glow: gl ? 1 : 0, glowThr: .5, duo: .3, duoA: hex('#000814'), duoB: hex('#cfe9ff') }, [], 'X-ray')));
    [.5, .75, 1].forEach(e => [['pencil', { bw: 1, invert: 1 }], ['ink', { bw: 1 }], ['blue ink', { duo: 1, duoA: hex('#0a2540'), duoB: hex('#ffffff') }], ['colour', {}]].forEach(([n, x]) => put('sketch', 'fx', 'Art', `Sketch ${n} ${e}`, Object.assign({ edge: e, edgeCol: [1, 1, 1], contrast: 1.2 }, x), [], `Sketch ${n}`)));
    [3, 4, 5, 6].forEach(l => [.5, 1, 1.5].forEach(g => put('oil', 'fx', 'Art', `Oil paint ${l} levels · glow ${g}`, { poster: l, glow: g, glowThr: .5, bmode: 2, bamt: .08, sat: 1.25 }, [], `Oil ${l}`)));
    [3, 4, 5].forEach(l => [6, 10].forEach(h => [0, 1].forEach(e => put('comic', 'fx', 'Art', `Comic ${l} levels · dots ${h}px${e ? ' · inked' : ''}`, { poster: l, halftone: .6, htSize: h, edge: e * .7, edgeCol: [0, 0, 0], sat: 1.4 }, [], `Comic ${l}`))));
    // --- combo recipes: two families merged (later family wins on shared uniforms; modulations add up) ---
    const pick = (f, n, off) => { const L = fam[f] || []; const out = []; for (let i = 0; i < n && L.length; i++) out.push(L[Math.floor((i * L.length) / n + (off || 0)) % L.length]); return out; };
    const RECIPES = [['Beat drop', 'shake', 25, 'flash', 6], ['Bass punch', 'zoom', 25, 'rgb', 6], ['Glitch zoom', 'glitch', 30, 'zoom', 5], ['Psychedelic', 'kaleido', 30, 'huecycle', 5], ['Film memory', 'leak', 60, 'oldfilm', 3], ['Dream wave', 'wave', 40, 'glow', 4], ['Vortex', 'swirl', 30, 'zblur', 5], ['Neon rave', 'neon', 32, 'huecycle', 4], ['Tape chaos', 'vhs', 48, 'shake', 3], ['Strobe invert', 'strobe', 20, 'invflash', 6], ['Liquid light', 'ripple', 40, 'leak', 4], ['Pixel storm', 'pixel', 30, 'glitch', 5], ['Tile flash', 'tile', 40, 'flash', 4], ['Mirror wave', 'mirror', 16, 'wave', 10], ['Warp speed', 'zblur', 24, 'flash', 6], ['Party spin', 'kaleido', 50, 'glow', 3], ['Projector', 'oldfilm', 72, 'shake', 2], ['Print shop', 'duo', 60, 'halftone', 2], ['CCTV', 'fisheye', 18, 'scan', 6], ['Bass bounce', 'bulge', 54, 'zoom', 3], ['Heat haze', 'wave', 25, 'super8', 4], ['Quake blur', 'shake', 25, 'dblur', 4]];
    for (const [name, fa, na, fb, nb] of RECIPES) for (const A of pick(fa, na)) for (const B of pick(fb, nb, 1)) {
      const u = Object.assign({}, A.u, B.u); if (A.u.dmode && B.u.dmode) { u.dmode = A.u.dmode; for (const k of ['d1', 'd2', 'd3']) if (k in A.u) u[k] = A.u[k]; }
      const a = A.a.concat(B.a.filter(x => !(A.u.dmode && B.u.dmode && /^d[123]$/.test(x[0])))); add('fx', 'Combos', `${name} · ${A.short} + ${B.short}`, u, a);
    }
  }

  function buildFilters() {
    const TONES = { Standard: {}, Soft: { contrast: .9, fade: .04, curveS: .1 }, Punchy: { contrast: 1.2, sat: 1.15, curveS: .25 }, Matte: { lift: [.06, .06, .06], contrast: .92 }, Faded: { fade: .14, sat: .85 }, 'High-key': { expo: .35, contrast: .9, lift: [.05, .05, .05] }, 'Low-key': { expo: -.35, contrast: 1.15, gain: [.95, .95, .95] }, Contrasty: { contrast: 1.35, curveS: .4 } };
    const C = (o) => o;
    const COLORS = {
      'True colour': ['Natural', C({})], Warm: ['Warm', C({ temp: .35 })], Cool: ['Cool', C({ temp: -.35 })], 'Golden hour': ['Warm', C({ temp: .55, tint: .1, highTint: hex('#ffd59a'), splitAmt: .25 })],
      'Teal & orange': ['Cinematic', C({ shadowTint: hex('#1f6f8b'), highTint: hex('#ffb070'), splitAmt: .45, sat: 1.1 })], 'Ice blue': ['Cool', C({ temp: -.5, tint: -.05, sat: .9, highTint: hex('#d8f1ff'), splitAmt: .2 })], Arctic: ['Cool', C({ temp: -.7, sat: .7, expo: .15 })], Ocean: ['Cool', C({ shadowTint: hex('#0b3d6b'), highTint: hex('#9ad6ff'), splitAmt: .35 })],
      Forest: ['Natural', C({ tint: -.25, shadowTint: hex('#123b23'), splitAmt: .25, sat: .95 })], Emerald: ['Creative', C({ hue: -.25, tint: -.3, sat: 1.15 })], Moss: ['Vintage', C({ tint: -.2, temp: .15, sat: .75, fade: .06 })], Desert: ['Warm', C({ temp: .45, tint: .12, sat: .85, highTint: hex('#ffe0b0'), splitAmt: .2 })],
      Amber: ['Warm', C({ temp: .6, sat: 1.05, shadowTint: hex('#4a2a00'), splitAmt: .2 })], Rose: ['Creative', C({ tint: .35, highTint: hex('#ffc2d6'), splitAmt: .25 })], Peach: ['Warm', C({ temp: .3, tint: .2, highTint: hex('#ffd2b8'), splitAmt: .25 })], Lavender: ['Creative', C({ tint: .25, temp: -.2, sat: .85 })],
      'Cinema blue': ['Cinematic', C({ temp: -.25, shadowTint: hex('#0a2a55'), highTint: hex('#e8f4ff'), splitAmt: .4, contrast: 1.05 })], 'Bleach bypass': ['Cinematic', C({ sat: .45, contrast: 1.35, curveS: .3 })], 'Cross process': ['Vintage', C({ shadowTint: hex('#1d4d2d'), highTint: hex('#ffe680'), splitAmt: .5, contrast: 1.15, sat: 1.2 })], Sepia: ['Vintage', C({ duo: .85, duoA: hex('#2a1a0c'), duoB: hex('#f2dfb4') })],
      'Black & white': ['B&W', C({ bw: 1 })], 'B&W blue tone': ['B&W', C({ bw: 1, duo: .4, duoA: hex('#06122b'), duoB: hex('#e8f4ff') })], Noir: ['B&W', C({ bw: 1, contrast: 1.45, curveS: .4, vig: .4 })], 'Night blue': ['Cinematic', C({ temp: -.6, expo: -.25, sat: .8, shadowTint: hex('#06122b'), splitAmt: .3 })],
      'Neon night': ['Creative', C({ shadowTint: hex('#2b0a4a'), highTint: hex('#7cf7ff'), splitAmt: .45, sat: 1.25, contrast: 1.1 })], 'Vintage green': ['Vintage', C({ tint: -.25, temp: .2, fade: .1, sat: .8, curveS: .15 })]
    };
    const VARIANTS = { '': {}, Warm: { temp: .25 }, Cool: { temp: -.25 }, Faded: { fade: .12 }, Punch: { contrast: .15, sat: .15 }, Grain: { grain: .06 }, Matte: { lift: [.06, .06, .06], contrast: -.08 }, Bright: { expo: .25 }, Dark: { expo: -.3, vig: .35 }, Vignette: { vig: .5 } };
    const merge = (base, d) => { const u = Object.assign({}, base); for (const k in d) { const v = d[k]; if (Array.isArray(v)) u[k] = (u[k] || ID[k]).map((x, i) => k === 'lift' ? x + v[i] : v[i]); else if (['contrast', 'sat'].includes(k)) u[k] = (u[k] ?? ID[k]) + v; else if (['temp', 'fade', 'expo', 'grain', 'vig'].includes(k)) u[k] = (u[k] ?? 0) + v; else u[k] = v; } return u; };
    for (const [cn, [group, cu]] of Object.entries(COLORS)) for (const [tn, tu] of Object.entries(TONES)) for (const [vn, vu] of Object.entries(VARIANTS)) {
      const u = merge(merge(Object.assign({}, cu), tu), vu); if (!Object.keys(u).length) continue;   // "Natural · Natural" is just the original image
      add('filter', group, `${cn} · ${tn}${vn ? ' · ' + vn : ''}`, u, [], cn);
    }
  }

  function buildTransitions() {
    const T = [];
    [3, 2, 1.5, .6, .3].forEach(z => [0, .8].forEach(b => [0, 1, -1].forEach(sp => T.push([`Zoom ${z > 1 ? 'in' : 'out'} ${z}×${b ? ' blur' : ''}${sp ? (sp > 0 ? ' spin' : ' spin back') : ''}`, { zoom: z, bmode: b ? 2 : 0, bamt: b, rot: sp * Math.PI }, 'Zoom']))));
    [['left', [.6, 0]], ['right', [-.6, 0]], ['up', [0, .6]], ['down', [0, -.6]]].forEach(([d, [x, y]]) => [.5, 1, 1.5].forEach(k => [0, 1].forEach(b => T.push([`Slide ${d} ${k}${b ? ' blur' : ''}`, { offx: x * k, offy: y * k, bmode: b ? 1 : 0, bamt: b * 1.2, bang: x ? 0 : Math.PI / 2 }, 'Slide']))));
    ['White', 'Black', 'Ice Blue', 'Warm'].forEach(c => [1, .7].forEach(k => T.push([`Flash ${c}${k < 1 ? ' soft' : ''}`, { flash: k, flashCol: hex(COL[c]) }, 'Flash'])));
    [.3, .6, 1].forEach(g => [0, 10].forEach(r => T.push([`Glitch ${g}${r ? ' RGB' : ''}`, { dmode: 10, d1: g, d2: 14, d3: 20, rgb: r }, 'Glitch'])));
    [8, 16, 32, 64].forEach(s => T.push([`Pixelate ${s}`, { dmode: 9, d1: s }, 'Pixel']));
    [-6, -3, 3, 6].forEach(a => T.push([`Swirl ${a}`, { dmode: 4, d1: a, d2: .8 }, 'Swirl']));
    [4, 6, 8].forEach(s => T.push([`Kaleido ${s}`, { dmode: 6, d1: s, zoom: .7 }, 'Kaleido']));
    [.03, .06].forEach(a => [4, 8].forEach(f => T.push([`Wave ${a} × ${f}`, { dmode: 1, d1: a, d2: f, d3: 4 }, 'Wave'])));
    [.5, 1, 2].forEach(b => { T.push([`Blur ${b}`, { bmode: 2, bamt: b * .6, fade: .3 }, 'Blur']); T.push([`Spin blur ${b}`, { bmode: 3, bamt: b, rot: b }, 'Blur']); });
    ['Warm', 'Gold', 'Ice Blue', 'White'].forEach(c => T.push([`Light burn ${c}`, { leak: 2, leakCol: hex(COL[c]), leakSize: 1.2, leakPos: [.5, .5], expo: .8 }, 'Light']));
    [.5, 1].forEach(k => { T.push([`Fade to black ${k}`, { expo: -4 * k }, 'Fade']); T.push([`Fade from white ${k}`, { flash: k }, 'Fade']); });
    T.push(['Invert flash', { invert: 1 }, 'Color'], ['Black & white fade', { bw: 1, expo: -.5 }, 'Color'], ['RGB split', { rgb: 30 }, 'Glitch'], ['Fisheye pop', { dmode: 11, d1: 1.2, zoom: 1.3 }, 'Zoom'], ['Tile shatter', { dmode: 8, d1: 4, zoom: .8 }, 'Pixel'], ['Mirror fold', { dmode: 7, d1: 3, zoom: 1.3 }, 'Kaleido']);
    for (const [n, u, cat] of T) { add('tin', 'In · ' + cat, n + ' in', u); add('tout', 'Out · ' + cat, n + ' out', u); }
  }

  /* text styles: fonts × looks × animations, created as editable text layers */
  const FONTS = ['Segoe UI', 'Impact', 'Arial Black', 'Georgia', 'Consolas', 'Trebuchet MS', 'Verdana', 'Times New Roman'];
  const LOOKS = { Clean: { color: '#ffffff' }, 'Blue glow': { color: '#e8f4ff', shadow: true, shBlur: 30, shColor: '#3b9bff', shY: 0 }, Outline: { color: '#ffffff', stroke: '#000000', strokeW: 10 }, 'Box caption': { color: '#ffffff', bgOn: true, bg: '#000000', bgPad: 18 }, 'Blue box': { color: '#000000', bgOn: true, bg: '#9ad6ff', bgPad: 18 }, 'Drop shadow': { color: '#ffffff', shadow: true, shBlur: 6, shY: 8, shColor: '#000000' } };
  const ANIMS = ['fade', 'typewriter', 'slide-up', 'pop', 'blur', 'tracking', 'wave', 'flicker'];
  const TEXTS = []; FONTS.forEach(f => Object.entries(LOOKS).forEach(([ln, lo]) => ANIMS.forEach(an => TEXTS.push({ id: 'x' + TEXTS.length.toString(36), n: `${ln} · ${f} · ${an}`, c: ln, font: f, look: lo, anim: an }))));

  /* sound effects, synthesised on demand (so every one is original) */
  const SFX = []; {
    [['Whoosh', [.3, .5, .8, 1.2, 1.8]], ['Riser', [1, 2, 3, 4]], ['Downer', [.6, 1, 1.6]], ['Impact', [.5, 1, 1.6, 2.4]], ['Boom', [1, 2, 3]], ['Pop', [.08, .12, .18]], ['Click', [.03, .05]], ['Glitch', [.2, .4, .7]], ['Beep', [.1, .2, .4]], ['Swoosh reverse', [.5, .8, 1.2]], ['Shutter', [.15, .25]], ['Notification', [.3, .5]]].forEach(([n, lens]) => lens.forEach(len => ['low', 'mid', 'high'].forEach(tone => SFX.push({ id: 's' + SFX.length.toString(36), n: `${n} · ${len}s · ${tone}`, c: n, kind: n, len, tone }))));
  }
  async function renderSfx(s) {
    const SR = 48000, ac = new OfflineAudioContext(2, Math.ceil((s.len + .2) * SR), SR), out = ac.createGain(); out.connect(ac.destination);
    const f0 = { low: .6, mid: 1, high: 1.8 }[s.tone], L = s.len, nb = (() => { const b = ac.createBuffer(1, SR, SR), d = b.getChannelData(0); let x = 9; for (let i = 0; i < d.length; i++) { x = (x * 16807) % 2147483647; d[i] = x / 1073741823.5 - 1; } return b; })();
    const noise = (filter, f1, f2, q, g1, g2, start, dur, loop) => { const src = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); src.buffer = nb; src.loop = true; fl.type = filter; fl.Q.value = q; fl.frequency.setValueAtTime(f1, start); fl.frequency.exponentialRampToValueAtTime(f2, start + dur); g.gain.setValueAtTime(g1, start); g.gain.linearRampToValueAtTime(g2, start + dur); src.connect(fl); fl.connect(g); g.connect(out); src.start(start); src.stop(start + dur); return g; };
    const tone = (type, f1, f2, a, start, dur) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f1, start); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), start + dur); g.gain.setValueAtTime(a, start); g.gain.exponentialRampToValueAtTime(.0001, start + dur); o.connect(g); g.connect(out); o.start(start); o.stop(start + dur + .02); };
    switch (s.kind) {
      case 'Whoosh': { const g = noise('bandpass', 300 * f0, 3000 * f0, 1.2, 0, 0, 0, L); g.gain.linearRampToValueAtTime(.8, L * .6); g.gain.linearRampToValueAtTime(0, L); break; }
      case 'Swoosh reverse': { const g = noise('bandpass', 3500 * f0, 300 * f0, 1.4, 0, 0, 0, L); g.gain.linearRampToValueAtTime(.8, L * .85); g.gain.linearRampToValueAtTime(0, L); break; }
      case 'Riser': noise('bandpass', 200 * f0, 8000 * f0, 2, .05, .7, 0, L); tone('sawtooth', 110 * f0, 880 * f0, .12, 0, L); break;
      case 'Downer': noise('lowpass', 6000 * f0, 150, 1, .6, 0, 0, L); tone('sine', 400 * f0, 40, .5, 0, L); break;
      case 'Impact': tone('sine', 160 * f0, 35, 1, 0, L); noise('lowpass', 4000 * f0, 200, .8, .8, 0, 0, L * .4); break;
      case 'Boom': tone('sine', 90 * f0, 25, 1, 0, L); noise('lowpass', 800 * f0, 60, .7, .9, 0, 0, L); break;
      case 'Pop': tone('sine', 900 * f0, 200 * f0, .8, 0, L); break;
      case 'Click': noise('highpass', 3000 * f0, 6000 * f0, .7, 1, 0, 0, L); break;
      case 'Glitch': for (let i = 0; i < L * 40; i++) { const t = i / 40; tone('square', (200 + (i * 997 % 1800)) * f0, (200 + (i * 613 % 1200)) * f0, .25, t, .02); } break;
      case 'Beep': tone('sine', 1000 * f0, 1000 * f0, .5, 0, L); break;
      case 'Shutter': noise('highpass', 2000, 5000, .8, .9, 0, 0, .05); noise('highpass', 2500, 5000, .8, .7, 0, L * .6, .05); break;
      case 'Notification': tone('sine', 880 * f0, 880 * f0, .4, 0, L * .45); tone('sine', 1320 * f0, 1320 * f0, .4, L * .4, L * .6); break;
    }
    const buf = await ac.startRendering(), n = buf.length, ab = new ArrayBuffer(44 + n * 4), v = new DataView(ab), w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
    const a = buf.getChannelData(0), b = buf.getChannelData(1); for (let i = 0, o = 44; i < n; i++, o += 4) { v.setInt16(o, clamp(a[i], -1, 1) * 32767, true); v.setInt16(o + 2, clamp(b[i], -1, 1) * 32767, true); }
    return new File([ab], s.n.replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() + '.wav', { type: 'audio/wav' });
  }

  buildEffects(); buildFilters(); buildTransitions();
  /* Added after every older item: an item's id is its position in the catalogue, and saved projects refer to it by id. */
  function buildExtra() {
    const ST = [['Soft', .55], ['Medium', .85], ['Bold', 1.25]], SPD = [['Slow', .5], ['Normal', 1], ['Fast', 2]], col = n => hex(COL[n]), mixW = (a, k) => a.map(x => x + (1 - x) * k);
    const fam_ = (cat, base, u, o) => { o = o || {}; for (const [cn, c1, c2] of o.cols || [['', [1, 1, 1], [1, 1, 1]]]) for (const [sn, g1] of ST) for (const [sp, g3] of SPD) for (const g2 of o.dens || [1]) add('fx', cat, `${base}${cn ? ' ' + cn : ''} · ${sn} · ${sp}${(o.dens || []).length > 1 ? ' · size ' + g2 : ''}`, Object.assign({ g1, g2, g3, gc1: c1, gc2: c2 }, u), [], base); };
    const cc = (...ns) => ns.map(n => [n, col(n), mixW(col(n), .7)]);
    fam_('Aura', 'Aura', { gmode: 8 }, { cols: cc('Ice Blue', 'Blue', 'White', 'Violet', 'Red', 'Gold', 'Mint', 'Rose'), dens: [.7, 1.2] });
    fam_('Energy', 'Electric arcs', { gmode: 16 }, { cols: cc('Ice Blue', 'White', 'Violet', 'Gold') });
    fam_('Energy', 'Fire', { gmode: 9 }, { cols: [['Warm', col('Red'), col('Gold')], ['Ice', col('Blue'), [.85, .95, 1]], ['Violet', col('Violet'), [1, .85, 1]]], dens: [.7, 1.3] });
    fam_('Anime', 'Speed lines', { gmode: 4 }, { cols: cc('White', 'Black', 'Ice Blue', 'Red'), dens: [.6, 1, 1.5] });
    fam_('Weather', 'Rain', { gmode: 1 }, { cols: [['', [.8, .9, 1], [1, 1, 1]]], dens: [.7, 1, 1.5] });
    fam_('Weather', 'Snow', { gmode: 2 }, { cols: [['', [1, 1, 1], [1, 1, 1]]], dens: [.7, 1, 1.5] });
    fam_('Weather', 'Fog', { gmode: 10 }, { cols: cc('White', 'Ice Blue', 'Warm', 'Black'), dens: [.6, 1.2] });
    fam_('Particles', 'Sparkles', { gmode: 3 }, { cols: cc('White', 'Ice Blue', 'Gold'), dens: [.7, 1.3] });
    fam_('Particles', 'Bokeh', { gmode: 7 }, { cols: [['Warm', col('Warm'), col('Gold')], ['Ice', col('Ice Blue'), col('Blue')], ['Rose', col('Rose'), col('Violet')]], dens: [.8, 1.4] });
    fam_('Particles', 'Starfield', { gmode: 12 }, { cols: cc('White', 'Ice Blue'), dens: [.7, 1.3] });
    fam_('Light', 'God rays', { gmode: 5 }, { cols: cc('Warm', 'Ice Blue', 'White', 'Gold'), dens: [.7, 1.2] });
    fam_('Light', 'Shine sweep', { gmode: 11 }, { cols: cc('White', 'Ice Blue', 'Gold'), dens: [.6, 1.2] });
    fam_('Light', 'Caustics', { gmode: 19 }, { cols: cc('Ice Blue', 'White', 'Mint'), dens: [.7, 1.3] });
    fam_('Lens', 'Lens flare', { gmode: 15 }, { cols: cc('Ice Blue', 'White', 'Warm', 'Red') });
    fam_('Retro', 'Film damage', { gmode: 6 }, { dens: [1, 2] });
    fam_('Stylize', 'Dither', { gmode: 13 }, { dens: [2, 3, 5] });
    fam_('Stylize', 'Crosshatch', { gmode: 14 }, { cols: [['Ink', [0, 0, 0], [1, 1, 1]], ['Blue', hex('#0a2540'), [.92, .97, 1]], ['Inverted', [1, 1, 1], [0, 0, 0]]], dens: [5, 8, 12] });
    fam_('Stylize', 'Paper texture', { gmode: 17 }, { dens: [.6, 1.2] });
    fam_('Stylize', 'Cracked glass', { gmode: 18 }, { cols: cc('White', 'Ice Blue'), dens: [.7, 1.3] });
    for (const [n, m, grid] of [['Hex mosaic', 13, [[.012, 0, 0], [.022, 0, 0], [.04, 0, 0], [.07, 0, 0]]], ['Glass refraction', 14, [[.03, 8, .3], [.06, 8, .3], [.1, 5, .6], [.15, 4, 1]]], ['Tunnel', 15, [[.8, 0, .4], [1.5, 0, .4], [1.5, 0, 1], [2.5, 0, 1]]], ['Shockwave', 16, [[.03, .08, .5], [.06, .12, .5], [.06, .12, 1], [.1, .18, 1]]], ['Liquid wobble', 17, [[.008, 9, 2], [.016, 9, 2], [.03, 6, 3], [.05, 5, 4]]], ['Slices', 18, [[.03, 12, 2], [.06, 18, 3], [.12, 26, 4], [.2, 40, 6]]]]) grid.forEach(([d1, d2, d3], i) => add('fx', 'Distort', `${n} · ${LV[i]}`, { dmode: m, d1, d2, d3 }, [], n));
  }
  buildExtra();

  /* ---------------- browsing: one card per look, its strengths and speeds kept inside ---------------- */
  const stemOf = it => { const s = it.n.split(' · ')[0]; if (it.c === 'Combos' || it.k === 'filter') return s; return s.replace(/\d+×\d+|×\d+/g, '').replace(/\b(Subtle|Light|Medium|Strong|Extreme)\b/g, '').replace(/[+-]?\d+(\.\d+)?(px)?|[¼½]/g, '').replace(/\s+levels\b|\s*\/s\b/g, '').replace(/\s+/g, ' ').trim() || it.n; };
  const CAT_ORDER = ['Aura', 'Energy', 'Anime', 'Weather', 'Particles', 'Light', 'Light Leaks', 'Glow', 'Glitch', 'Distort', 'Stylize', 'Art', 'Retro', 'VHS', 'Color FX', 'Blur', 'Kaleidoscope', 'Lens', 'Atmosphere', 'Frames', 'Zoom', 'Camera', 'Shake', 'Combos'];
  const PICKS = ['Aura Ice Blue', 'Speed lines White', 'Shine sweep White', 'Glass refraction', 'Block glitch', 'Fire Warm', 'God rays Warm', 'Rain', 'Hex mosaic', 'Neon edges Ice Blue', 'Lens flare Ice Blue', 'VHS', 'Shockwave', 'Electric arcs Ice Blue', 'Snow', 'Zoom blur', 'Kaleidoscope', 'Sparkles Gold', 'Halftone', 'Old film', 'Handheld shake', 'Caustics Ice Blue', 'Oil paint', 'Bokeh Warm', 'Cracked glass White', 'RGB split Horizontal', 'Pulse zoom', 'Duotone Midnight', 'Tunnel', 'Dither', 'Fog White', 'Comic', 'Liquid wobble', 'White flash', 'Warm leak', 'Sketch pencil', 'Slices', 'Night vision', 'Thermal', 'Dreamy glow', 'Crosshatch Ink', 'Film damage', 'Aura Red', 'Aura Violet', 'Starfield White', 'CRT TV', 'Ripple', 'Swirl', 'Beat drop', 'Psychedelic', 'Warp speed', 'Neon rave', 'Colour cycle', 'Glow', 'Pixel storm', 'Spin turn', 'Mirror Left → Right', 'Pop art'];
  const _groups = {};
  function groups(kind) {
    if (_groups[kind]) return _groups[kind]; const m = new Map();
    for (const it of ITEMS) if (it.k === kind) { const s = stemOf(it), g = m.get(s) || (m.set(s, { stem: s, c: it.c, items: [] }), m.get(s)); g.items.push(it); }
    const list = [...m.values()]; for (const g of list) { g.rep = kind === 'filter' ? g.items[0] : g.items.find(i => /· Medium · Normal/.test(i.n)) || g.items.find(i => /Medium/.test(i.n)) || g.items[Math.floor(g.items.length / 2)]; g.motion = !!g.rep.a.length && g.rep.a.every(x => ['offx', 'offy', 'rot', 'zoom'].includes(x[0])); }
    const rank = g => { const i = CAT_ORDER.indexOf(g.c); return i < 0 ? 99 : i; }, order = kind === 'filter' ? list : list.slice().sort((a, b) => rank(a) - rank(b));
    const byCat = new Map(); order.forEach(g => (byCat.get(g.c) || (byCat.set(g.c, []), byCat.get(g.c))).push(g)); const mixed = [], queues = [...byCat.entries()].filter(([c]) => c !== 'Combos').map(e => e[1]); for (let i = 0; mixed.length < order.length && i < 1000; i++) { let any = false; for (const q of queues) if (q[i]) { mixed.push(q[i]); any = true; } if (!any) break; }
    (byCat.get('Combos') || []).forEach(g => mixed.push(g));   // every category takes a turn, so no single family fills the page
    const named = kind === 'fx' ? PICKS.map(p => list.find(g => g.stem === p)).filter(Boolean) : mixed.slice(0, 40);
    return (_groups[kind] = { list: order, mixed, picks: named, cats: [...byCat.keys()] });
  }
  const count = k => ITEMS.filter(i => i.k === k).length;

  /* ---------------- engine registration ---------------- */
  FX.lib = { name: 'Library effect', cat: 'Library', hidden: true, params: [{ k: 'preset', label: 'Preset', type: 'hidden' }, N('amount', 'Intensity', 0, 100, 100, 1, '%'), N('speed', 'Speed', 0, 4, 1, .05), N('td', 'Transition length', .1, 3, .5, .05, 's')], id: 'lib',
    px() { if (!Library.warned) { Library.warned = true; if (typeof toast === 'function') toast('Library effects need GPU acceleration (WebGL2) — they are skipped on this computer.'); } } };
  if (typeof GPU !== 'undefined') GPU.register('lib', { src: SRC, uniforms: U, linear: true, uni: (p, w, h, t, item) => { const pr = BYID[p.preset]; return pr ? evaluate(pr, t, clamp((p.amount ?? 100) / 100, 0, 1.5), p.speed ?? 1, item && item.ld, p.td) : { mixAmt: 0 }; } });
  const fxFor = (id, o) => { const f = newFx('lib'); f.p.preset = id; Object.assign(f.p, o || {}); return f; };

  return { groups, stemOf, ITEMS, BYID, TEXTS, SFX, FONTS, count, evaluate, renderSfx, fxFor, SRC, U, ID, name: id => (BYID[id] || {}).n || 'Missing preset' };
})();
