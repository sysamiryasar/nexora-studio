'use strict';
/* ====================== NEXORA GPU effects (WebGL2) ======================
   The per-pixel effects in fx.js (the ones that used getImageData loops) have GLSL twins here.
   runFx() hands each run of consecutive GPU-capable effects to GPU.run(): the layer surface is uploaded once,
   ping-pongs through one shader pass per effect, and is drawn back once. Values are kept un-premultiplied in
   8-bit textures between passes, exactly like the CPU path, so results match within rounding (see tests).
   If WebGL2 is missing, fails to compile, or the context is lost, everything silently falls back to the CPU path. */
const GPU = (() => {
  let gl = null, cv = null, failed = false, vao = null, buf = null;
  const progs = {}, tex = [], fbo = [];
  let W = 0, H = 0;
  const pref = (() => { try { return localStorage.getItem('nx.gpu'); } catch (e) { return null; } })();
  const S = { enabled: pref !== '0', stats: { gpuPasses: 0, cpuPasses: 0, batches: 0 }, reason: '' };

  const HEAD = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D src, src2; uniform vec2 size; uniform float u0, u1, u2, u3, u4; uniform vec3 c0, c1, c2; uniform vec3 st[24];
out vec4 o;
vec4 at(ivec2 q) { return texelFetch(src, clamp(q, ivec2(0), ivec2(size) - 1), 0) * 255.0; }
vec4 at2(ivec2 q) { return texelFetch(src2, clamp(q, ivec2(0), ivec2(size) - 1), 0) * 255.0; }
bool inside(ivec2 q) { return q.x >= 0 && q.y >= 0 && float(q.x) < size.x && float(q.y) < size.y; }
// premultiplied tap (0…255), transparent outside the frame — what canvas drawImage / CSS filters see
vec4 tap(ivec2 q) { if (!inside(q)) return vec4(0.0); vec4 t = texelFetch(src, q, 0) * 255.0; return vec4(t.rgb * t.a / 255.0, t.a); }
vec4 bilP(vec2 p) { p -= 0.5; ivec2 i = ivec2(floor(p)); vec2 f = p - floor(p); return mix(mix(tap(i), tap(i + ivec2(1, 0)), f.x), mix(tap(i + ivec2(0, 1)), tap(i + ivec2(1, 1)), f.x), f.y); }
vec4 unP(vec4 p) { return p.a > 0.001 ? vec4(min(p.rgb * 255.0 / p.a, vec3(255.0)), p.a) : vec4(0.0); }
float gw(int k, float s) { return exp(-float(k * k) / (2.0 * s * s)); }
float lum(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy); vec4 c = at(q);
  bool inner = q.x > 0 && q.y > 0 && float(q.x) < size.x - 1.0 && float(q.y) < size.y - 1.0;
`;
  const TAIL = `
  o = clamp(c, 0.0, 255.0) / 255.0;
}`;
  // remap helper shared by swirl / bulge (nearest sample, Math.round semantics, alpha 0 outside)
  const REMAP = m => `vec2 d = vec2(q) - size / 2.0; float r = length(d);
  if (r < u1) { ${m} ivec2 s = ivec2(floor(size / 2.0 + m + 0.5));
    if (s.x < 0 || s.y < 0 || float(s.x) >= size.x || float(s.y) >= size.y) c.a = 0.0; else c = at(s); }`;
  const SRC = {
    temperature: `c.r += u0; c.b -= u0; c.g -= u1;`,
    levels: `vec3 v = clamp((c.rgb - u0) / (max(u1, u0 + 1.0) - u0), 0.0, 1.0); v = pow(v, vec3(1.0 / u2)); c.rgb = u3 + v * (u4 - u3);`,
    duotone: `float l = lum(c.rgb) / 255.0; c.rgb = mix(c.rgb, mix(c0, c1, l), u0);`,
    posterize: `c.rgb = floor(c.rgb / 255.0 * u0 + 0.5) / u0 * 255.0;`,
    chroma: `float dd = distance(c.rgb, c0); if (dd < u0) c.a = 0.0; else if (dd < u0 + u1) c.a *= (dd - u0) / u1;`,
    sharpen: `if (inner) c.rgb = c.rgb * (1.0 + 4.0 * u0) - u0 * (at(q + ivec2(-1, 0)).rgb + at(q + ivec2(1, 0)).rgb + at(q + ivec2(0, -1)).rgb + at(q + ivec2(0, 1)).rgb);`,
    grain: `if (c.a > 0.0) c.rgb += (floor(hash(vec2(q) + u1) * 255.0) - 127.0) * u0;`,
    rgbsplit: `int a = int(u0); vec4 lr = at(q - ivec2(a, 0)), rb = at(q + ivec2(a, 0)); c.a = max(c.a, max(lr.a, rb.a)); c.r = lr.r; c.b = rb.b;`,
    swirl: REMAP(`float an = u0 * pow(1.0 - r / u1, 2.0); vec2 m = vec2(d.x * cos(an) - d.y * sin(an), d.x * sin(an) + d.y * cos(an));`),
    bulge: REMAP(`float f = 1.0 - u0 * (1.0 - (r / u1) * (r / u1)); vec2 m = d * f;`),
    edge: `if (inner) {
      #define L(x, y) lum(at(q + ivec2(x, y)).rgb)
      float gx = L(1, -1) + 2.0 * L(1, 0) + L(1, 1) - L(-1, -1) - 2.0 * L(-1, 0) - L(-1, 1);
      float gy = L(-1, 1) + 2.0 * L(0, 1) + L(1, 1) - L(-1, -1) - 2.0 * L(0, -1) - L(1, -1);
      float g = min(1.0, length(vec2(gx, gy)) * u0); c.rgb = mix(c.rgb, c0 * g, u1); }`,
    vibrance: `float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sat = mx > 0.0 ? (mx - mn) / mx : 0.0, l = lum(c.rgb), b = u0 * (1.0 - sat) * 1.6; c.rgb = l + (c.rgb - l) * (1.0 + b);`,
    colorgrade: `float l = lum(c.rgb) / 255.0, ws = (1.0 - l) * (1.0 - l), wh = l * l, wm = max(0.0, 1.0 - ws - wh); c.rgb += ((c0 - 128.0) * ws + (c1 - 128.0) * wm + (c2 - 128.0) * wh) * u0;`,
    primaries: `vec3 v = c.rgb / 255.0; v = (pow(max(v * c2 + c0 * (1.0 - v), 0.0), c1) + vec3(u0, u1, u2) - 0.435) * u3 + 0.435; float l = dot(v, vec3(.2126, .7152, .0722)); c.rgb = clamp(l + (v - l) * u4, 0.0, 1.0) * 255.0;`,
    autokey: `float dd = distance(c.rgb, c0); if (dd < u0) c.a = 0.0; else if (dd < u0 + u1) c.a *= (dd - u0) / u1;`,
    _out: `c = texelFetch(src, ivec2(q.x, int(size.y) - 1 - q.y), 0) * 255.0; c.rgb *= c.a / 255.0;`,
    /* ---- milestone 10: the rest of the Edit effects on the GPU ---- */
    // CSS colour filters (Filter Effects spec matrices, un-premultiplied sRGB, like canvas ctx.filter): v' = M·v + off
    cmat: `vec3 v = c.rgb / 255.0; c.rgb = clamp(vec3(dot(c0, v), dot(c1, v), dot(c2, v)) + vec3(u0, u1, u2), 0.0, 1.0) * 255.0;`,
    // separable Gaussian (σ = u0), transparent outside: H reads straight alpha and writes premultiplied, V the reverse
    blurH: `int R = int(ceil(u0 * 3.0)); vec4 acc = vec4(0.0); float ws = 0.0; for (int k = -R; k <= R; k++) { float w = gw(k, u0); acc += tap(q + ivec2(k, 0)) * w; ws += w; } c = acc / ws;`,
    blurV: `int R = int(ceil(u0 * 3.0)); vec4 acc = vec4(0.0); float ws = 0.0; for (int k = -R; k <= R; k++) { float w = gw(k, u0); ivec2 r = q + ivec2(0, k); acc += (inside(r) ? texelFetch(src, r, 0) * 255.0 : vec4(0.0)) * w; ws += w; } c = unP(acc / ws);`,
    // Glow: original (src2) + brightened blur, 'lighter' blend in premultiplied space
    glowmix: `vec4 f = at2(q); vec3 gP = min(c.rgb * 1.25, vec3(255.0)) * c.a / 255.0, fP = f.rgb * f.a / 255.0; float A = min(255.0, f.a + c.a * u0); c = unP(vec4(min(fP + gP * u0, vec3(255.0)), A));`,
    // Drop shadow: shifted alpha in the shadow colour, then (after the blur) the original drawn over it
    shprep: `vec4 s = tap(q - ivec2(int(u0), int(u1))); c = vec4(c0, s.a);`,
    over: `vec4 f = at2(q); vec4 sP = vec4(c.rgb * c.a / 255.0, c.a) * u0, fP = vec4(f.rgb * f.a / 255.0, f.a); c = unP(fP + sP * (1.0 - f.a / 255.0));`,
    // Pixelate: each block = premultiplied average of a 4×4 grid of samples (same rule as the CPU path)
    pixelate: `/* pixel centres: 42.0 / 14.0 can round below 3 */ vec2 b = floor((vec2(q) + 0.5) / u0) * u0; vec4 acc = vec4(0.0); for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) { vec2 s = min(b + (vec2(i, j) + 0.5) / 4.0 * u0, size - 1.0); acc += tap(ivec2(s)); } c = unP(acc / 16.0);`,
    // Wave warp: 2-px rows shifted by sin(row / wavelength · 2 + t · speed) · amplitude, bilinear horizontally
    wave: `float ys = floor(float(q.y) / 2.0) * 2.0, off = sin(ys / u1 * 2.0 + u2) * u0; c = unP(bilP(vec2(float(q.x) + 0.5 - off, float(q.y) + 0.5)));`,
    mirror: `int m = int(u0), X = q.x, Y = q.y, w = int(size.x), h = int(size.y);
      if (m == 0 || m == 4) { if (X >= w / 2) X = w - 1 - X; } else if (m == 1) { if (X < w / 2) X = w - 1 - X; }
      if (m == 2 || m == 4) { if (Y >= h / 2) Y = h - 1 - Y; } else if (m == 3) { if (Y < h / 2) Y = h - 1 - Y; }
      c = at(ivec2(X, Y));`,
    // Zoom / directional blur: average of shifted or scaled copies (the CPU path's alpha 1/(i+1) overlay is that average)
    zoomblur: `vec2 ce = size / 2.0, p = vec2(q) + 0.5; vec4 acc = vec4(0.0); for (int i = 0; i < 16; i++) { float z = 1.0 + u0 * float(i) / 15.0; acc += bilP(ce + (p - ce) / z); } c = unP(acc / 16.0);`,
    motionblur: `vec2 p = vec2(q) + 0.5, d = vec2(cos(u1), sin(u1)); vec4 acc = vec4(0.0); for (int i = 0; i < 14; i++) { float of = (float(i) / 13.0 - 0.5) * u0; acc += bilP(p - d * of); } c = unP(acc / 14.0);`,
    // Halftone: one disc per cell (colour = bilinear sample of the cell), discs may overlap neighbours, raster order wins
    halftone: `vec2 cell = floor((vec2(q) + 0.5) / u0), p = vec2(q) + 0.5; vec2 gsz = ceil(size / u0); vec4 acc = vec4(0.0);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = cell + vec2(i, j); if (g.x < 0.0 || g.y < 0.0 || g.x >= gsz.x || g.y >= gsz.y) continue;
        vec4 s = unP(bilP((g + 0.5) * size / gsz)); if (s.a < 12.0) continue; float l = lum(s.rgb) / 255.0, r = u0 * 0.6 * sqrt(0.15 + 0.85 * l);
        float cov = clamp(r - distance(p, g * u0 + u0 / 2.0) + 0.5, 0.0, 1.0); acc = vec4(s.rgb * cov, 255.0 * cov) + acc * (1.0 - cov); }
      c = unP(acc);`,
    // Digital glitch: strips (y, h, dx) precomputed with the CPU's exact random sequence; the last strip covering a row wins
    glitch: `int n = int(u0), hit = -1; float y = float(q.y) + 0.5; for (int k = 0; k < 24; k++) { if (k >= n) break; if (y >= st[k].x && y < st[k].x + st[k].y) hit = k; }
      if (hit >= 0) { vec3 s = st[0]; for (int k = 0; k < 24; k++) if (k == hit) s = st[k]; c = unP(bilP(vec2(float(q.x) + 0.5 - s.z, y))); }`
  };
  // CSS colour filter → 3×3 matrix rows + offset (Filter Effects Module Level 1)
  function cssMat(type, a) {
    const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (type === 'brightness') return { m: I.map(r => r.map(v => v * a)), o: [0, 0, 0] };
    if (type === 'contrast') return { m: I.map(r => r.map(v => v * a)), o: [.5 - .5 * a, .5 - .5 * a, .5 - .5 * a] };
    if (type === 'invert') return { m: I.map(r => r.map(v => v * (1 - 2 * a))), o: [a, a, a] };
    if (type === 'saturate') { const s = a; return { m: [[.213 + .787 * s, .715 - .715 * s, .072 - .072 * s], [.213 - .213 * s, .715 + .285 * s, .072 - .072 * s], [.213 - .213 * s, .715 - .715 * s, .072 + .928 * s]], o: [0, 0, 0] }; }
    if (type === 'hue') { const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { m: [[.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928], [.213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283], [.213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072]], o: [0, 0, 0] }; }
    if (type === 'grayscale') { const k = 1 - Math.min(1, a); return { m: [[.2126 + .7874 * k, .7152 - .7152 * k, .0722 - .0722 * k], [.2126 - .2126 * k, .7152 + .2848 * k, .0722 - .0722 * k], [.2126 - .2126 * k, .7152 - .7152 * k, .0722 + .9278 * k]], o: [0, 0, 0] }; }
    if (type === 'sepia') { const k = 1 - Math.min(1, a); return { m: [[.393 + .607 * k, .769 - .769 * k, .189 - .189 * k], [.349 - .349 * k, .686 + .314 * k, .168 - .168 * k], [.272 - .272 * k, .534 - .534 * k, .131 + .869 * k]], o: [0, 0, 0] }; }
  }
  const cmatUni = type => p => { const a = type === 'hue' ? p.amount : p.amount / 100, r = cssMat(type, type === 'grayscale' || type === 'sepia' || type === 'invert' ? Math.min(1, a) : a); return { c0: r.m[0], c1: r.m[1], c2: r.m[2], u0: r.o[0], u1: r.o[1], u2: r.o[2] }; };
  const ALIAS = { brightness: 'cmat', contrast: 'cmat', saturate: 'cmat', hue: 'cmat', grayscale: 'cmat', sepia: 'cmat', invert: 'cmat' };
  // multi-pass effects: (f, cur, free) → index of the texture holding the result
  const MACRO = {
    blur(f, cur, free) { const s = +f.p.amount || 0; if (s < .3) return cur; const a = free(cur); pass('blurH', cur, fbo[a], { u0: s }); const b = free(a); pass('blurV', a, fbo[b], { u0: s }); return b; },
    glow(f, cur, free) {
      const s = Math.max(.3, +f.p.radius || 1), k = Math.min(1, f.p.amount / 100) + Math.max(0, (f.p.amount - 100) / 100);
      const a = free(cur); pass('blurH', cur, fbo[a], { u0: s }); const b = free(cur, a); pass('blurV', a, fbo[b], { u0: s }); const c = free(cur, b); pass('glowmix', b, fbo[c], { u0: k }, cur); return c;
    },
    shadow(f, cur, free) {
      const p = f.p, s = Math.max(.3, +p.blur || 0), a = free(cur); /* canvas drop-shadow: σ = blur length (measured against Chromium) */ pass('shprep', cur, fbo[a], { u0: Math.round(p.x), u1: Math.round(p.y), c0: hexToRgb(p.color) });
      const b = free(cur, a); pass('blurH', a, fbo[b], { u0: s }); pass('blurV', b, fbo[a], { u0: s }); const c = free(cur, a); pass('over', a, fbo[c], { u0: p.op / 100 }, cur); return c;
    }
  };
  // uniforms per effect, from the same params the CPU path receives
  const UNI = {
    temperature: p => ({ u0: p.temp * .5, u1: p.tint * .35 }),
    levels: p => ({ u0: p.ib, u1: p.iw, u2: p.g, u3: p.ob, u4: p.ow }),
    duotone: p => ({ c0: hexToRgb(p.dark), c1: hexToRgb(p.light), u0: p.amount / 100 }),
    posterize: p => ({ u0: p.n - 1 }),
    chroma: p => ({ c0: hexToRgb(p.color), u0: p.tol * 4.41, u1: Math.max(1, p.soft * 4.41) }),
    sharpen: p => ({ u0: p.amount / 100 }),
    grain: p => ({ u0: p.amount / 100 * .45, u1: Math.random() * 1000 }),
    rgbsplit: p => ({ u0: Math.round(p.amount) }),
    swirl: (p, w, h) => ({ u0: p.amount, u1: Math.min(w, h) * p.radius / 100 }),
    bulge: (p, w, h) => ({ u0: p.amount / 100, u1: Math.min(w, h) * p.radius / 100 }),
    edge: p => ({ u0: p.strength / 100 / 255 * 2, u1: p.mix / 100, c0: hexToRgb(p.color) }),
    vibrance: p => ({ u0: p.amount / 100 }),
    colorgrade: p => ({ c0: hexToRgb(p.sh), c1: hexToRgb(p.mid), c2: hexToRgb(p.hi), u0: p.amount / 100 * .6 }),
    primaries: p => primUni(p),
    autokey: p => ({ u0: p.tol * 4.41, u1: Math.max(1, p.soft * 4.41) }),
    brightness: cmatUni('brightness'), contrast: cmatUni('contrast'), saturate: cmatUni('saturate'), hue: cmatUni('hue'), grayscale: cmatUni('grayscale'), sepia: cmatUni('sepia'), invert: cmatUni('invert'),
    blur: () => ({}), glow: () => ({}), shadow: () => ({}),
    pixelate: p => ({ u0: Math.max(1, Math.round(p.size)) }),
    wave: (p, w, h, f) => ({ u0: p.amp, u1: p.freq, u2: (f && f.T != null ? f.T : f && f.t || 0) * p.speed }),
    mirror: p => ({ u0: Math.max(0, ['Left → Right', 'Right → Left', 'Top → Bottom', 'Bottom → Top', 'Quad'].indexOf(p.mode)) }),
    zoomblur: p => ({ u0: p.amount / 100 }),
    motionblur: p => ({ u0: p.len, u1: p.angle * Math.PI / 180 }),
    halftone: p => ({ u0: Math.max(1, Math.round(p.size)) }),
    glitch: (p, W, H, f) => {   // the exact random sequence of FX.glitch.px (mulberry seeded by the frame of the rate)
      const t = f && f.T != null ? f.T : f && f.t || 0, rnd = mulberry(Math.floor(t * p.rate) + 7), n = Math.floor(p.amount / 6) + 1, st = [];
      for (let i = 0; i < n; i++) { if (rnd() > p.amount / 100 + .15) continue; const y = rnd() * H, h = 4 + rnd() * H * .09, dx = (rnd() - .5) * W * .25 * p.amount / 100; st.push([y, h, dx]); }
      return { u0: st.length, st };
    }
  };

  function init() {
    if (gl || failed) return !!gl;
    try {
      cv = document.createElement('canvas'); cv.width = cv.height = 1;
      gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL2 not available');
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; failed = true; S.reason = 'GPU context lost — using CPU'; });
      const vs = sh(gl.VERTEX_SHADER, `#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`);
      for (const k in SRC) {
        const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, HEAD + SRC[k] + TAIL)); gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(k + ': ' + gl.getProgramInfoLog(pr));
        const u = {}; for (const n of ['src', 'src2', 'size', 'u0', 'u1', 'u2', 'u3', 'u4', 'c0', 'c1', 'c2', 'st']) u[n] = gl.getUniformLocation(pr, n);
        progs[k] = { pr, u };
      }
      vao = gl.createVertexArray(); gl.bindVertexArray(vao); buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      for (let i = 0; i < 3; i++) { tex[i] = gl.createTexture(); fbo[i] = gl.createFramebuffer(); }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      return true;
    } catch (e) { failed = true; gl = null; S.reason = 'GPU unavailable: ' + (e.message || e); console.warn('[GPU]', S.reason); return false; }
  }
  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function resize(w, h) {
    if (w === W && h === H) return; W = w; H = h; cv.width = w; cv.height = h;
    for (let i = 0; i < 3; i++) {
      gl.bindTexture(gl.TEXTURE_2D, tex[i]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[i], 0);
    }
  }
  function pass(name, srcIdx, dstFbo, uni, src2Idx) {
    const P_ = progs[ALIAS[name] || name]; gl.useProgram(P_.pr); gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo); gl.viewport(0, 0, W, H);
    if (src2Idx != null) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex[src2Idx]); gl.uniform1i(P_.u.src2, 2); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[srcIdx]); gl.uniform1i(P_.u.src, 0); gl.uniform2f(P_.u.size, W, H);
    for (const k of ['u0', 'u1', 'u2', 'u3', 'u4']) gl.uniform1f(P_.u[k], uni[k] || 0);
    for (const k of ['c0', 'c1', 'c2']) { const v = uni[k] || [0, 0, 0]; gl.uniform3f(P_.u[k], v[0], v[1], v[2]); }
    if (uni.st && P_.u.st) { const a = new Float32Array(72); uni.st.slice(0, 24).forEach((s, i) => a.set(s, i * 3)); gl.uniform3fv(P_.u.st, a); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (src2Idx != null) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0); }
  }
  // average colour of the four 10×10 corners (same sample as the CPU Smart Key)
  function corners(idx) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[idx]); const px = new Uint8Array(400); let r = 0, g = 0, b = 0, n = 0;
    for (const [x, y] of [[2, 2], [W - 12, 2], [2, H - 12], [W - 12, H - 12]]) { gl.readPixels(Math.max(0, x), Math.max(0, y), 10, 10, gl.RGBA, gl.UNSIGNED_BYTE, px); for (let i = 0; i < 400; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; } }
    return [r / n, g / n, b / n];
  }

  /* ---- extension programs (e.g. the effects library uber-shader): full fragment source + typed uniforms ----
     def = { src, uniforms: { name: 'f'|'v2'|'v3'|'i' }, uni(p, w, h, t) → values, linear: bool } */
  const EXT = {}, auxTex = new Map();
  function register(name, def) { EXT[name] = def; delete progs[name]; }
  function extProg(name) {
    if (progs[name]) return progs[name]; const d = EXT[name];
    const vs = sh(gl.VERTEX_SHADER, `#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`), pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, d.src)); gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(pr));
    const u = { src: gl.getUniformLocation(pr, 'src'), size: gl.getUniformLocation(pr, 'size') }; for (const n in d.uniforms) u[n] = gl.getUniformLocation(pr, n);
    return (progs[name] = { pr, u, ext: d });
  }
  function extPass(name, srcIdx, dstFbo, vals) {
    const P_ = extProg(name), d = P_.ext; gl.useProgram(P_.pr); gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo); gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[srcIdx]); const f = d.linear ? gl.LINEAR : gl.NEAREST; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    const pq = P_.pq === undefined ? (P_.pq = gl.getUniformLocation(P_.pr, 'pq')) : P_.pq, sc = pq ? RQ : 1; if (pq) gl.uniform1f(pq, RQ); gl.uniform1i(P_.u.src, 0); gl.uniform2f(P_.u.size, W / sc, H / sc);   // shaders with "pq" work in project pixels during a reduced preview
    // optional second texture (e.g. a 3D LUT packed as slices): d.tex(vals) → { key, w, h, data: Float32Array RGBA } on unit 1, uniform 'lut'
    if (d.tex) { const t = d.tex(vals); if (t) { gl.activeTexture(gl.TEXTURE1); let e = auxTex.get(t.key); if (!e) { e = gl.createTexture();   /* unit 1: never disturb the frame on unit 0 */ gl.bindTexture(gl.TEXTURE_2D, e); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, t.w, t.h, 0, gl.RGBA, gl.FLOAT, t.data); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); auxTex.set(t.key, e); if (auxTex.size > 16) { const [k0, t0] = auxTex.entries().next().value; gl.deleteTexture(t0); auxTex.delete(k0); } }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, e); gl.uniform1i(gl.getUniformLocation(P_.pr, 'lut'), 1); gl.activeTexture(gl.TEXTURE0); } }
    for (const n in d.uniforms) { const v = vals[n], loc = P_.u[n]; if (loc === null) continue; const ty = d.uniforms[n];
      if (ty === 'f') gl.uniform1f(loc, v || 0); else if (ty === 'i') gl.uniform1i(loc, v | 0); else if (ty === 'v2') { const a = v || [0, 0]; gl.uniform2f(loc, a[0], a[1]); } else { const a = v || [0, 0, 0]; gl.uniform3f(loc, a[0], a[1], a[2]); } }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (d.linear) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); }
  }
  const can = type => !!UNI[type] || !!EXT[type];
  const on = () => S.enabled && !failed && init();
  /** run a list of {type, p} effects on canvas S (comp-sized scratch). Returns false if the GPU could not do it. */
  function run(Sc, list) {
    if (!on() || !list.length) return false;
    if (gl.isContextLost()) { failed = true; return false; }
    try {
      resize(Sc.width, Sc.height);
      gl.bindTexture(gl.TEXTURE_2D, tex[0]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, Sc);
      let cur = 0; const free = (...used) => [0, 1, 2].find(i => !used.includes(i));
      for (const f of list) {
        if (MACRO[f.type]) { cur = MACRO[f.type](f, cur, free); S.stats.gpuPasses++; continue; }
        const dst = free(cur);
        if (EXT[f.type]) extPass(f.type, cur, fbo[dst], EXT[f.type].uni(f.p, W, H, f.t || 0, f));
        else { const uni = UNI[f.type](f.p, W, H, f); if (f.type === 'autokey') uni.c0 = corners(cur); pass(f.type, cur, fbo[dst], uni); }
        cur = dst; S.stats.gpuPasses++;
      }
      pass('_out', cur, null, {});
      const x = Sc._ctx || Sc.getContext('2d'); resetCtx(x); x.clearRect(0, 0, Sc.width, Sc.height); x.drawImage(cv, 0, 0); S.stats.batches++;
      return true;
    } catch (e) { console.warn('[GPU] falling back to CPU', e); failed = true; S.reason = 'GPU error — using CPU'; return false; }
  }
  function setEnabled(v) {
    S.enabled = !!v; try { localStorage.setItem('nx.gpu', v ? '1' : '0'); } catch (e) { }
    for (const k in _scratch) delete _scratch[k];            // scratch surfaces switch between GPU- and CPU-backed canvases
    if (typeof requestRender === 'function') requestRender();
  }
  const status = () => !S.enabled ? 'CPU (GPU off)' : failed ? 'CPU' : init() ? 'GPU' : 'CPU';
  // exact twins (bit-for-bit within 1/255 of the CPU path) vs ports of canvas-drawn effects (resampling differs slightly)
  const PORTS = ['brightness', 'contrast', 'saturate', 'hue', 'grayscale', 'sepia', 'invert', 'blur', 'glow', 'shadow', 'pixelate', 'wave', 'mirror', 'zoomblur', 'motionblur', 'halftone', 'glitch'];
  return { S, run, can, on, register, setEnabled, status, cssMat, types: Object.keys(UNI).filter(k => !PORTS.includes(k)), ports: PORTS, get available() { return init(); } };
})();
