'use strict';
/* ====================== NEXORA Image — tools ======================
   Each tool: { id, icon, name, key, cursor, down(p,e), move(p,e), up(p,e), dbl?(p,e), overlay?(ctx,U), cancel?(), enter?() }
   p = document coordinates (float). Painting happens in layer-local coordinates (doc − layer offset). */
NXI.tools = (() => {
  const U = () => NXI.ui;
  const doc = () => NXI.ui.doc;
  const O = NXI.toolOpts = Object.assign({
    selMode: 'replace', feather: 0, wandTol: 32, contiguous: true, sampleAll: false, quickSize: 30, cropRatio: 'free', eyeSize: 1, autoSelect: false,
    brush: { preset: 'Soft Round', size: 40, hardness: 0, opacity: 100, flow: 100, spacing: 12, angle: 0, roundness: 100, scatter: 0, sizeJitter: 0, texture: 'none', textureScale: 100, pressureSize: true, pressureOpacity: false, smoothing: 20, tip: null },
    pencil: { size: 3, opacity: 100 }, eraser: { size: 50, hardness: 60, opacity: 100, flow: 100 },
    clone: { size: 60, hardness: 50, opacity: 100, aligned: true }, heal: { size: 50 }, spot: { size: 40 },
    retouch: { size: 60, strength: 50 }, dodge: { size: 70, exposure: 30, range: 'mid' }, sponge: { size: 70, flow: 40, mode: 'desat' },
    liquify: { size: 140, strength: 50, mode: 'push' },
    gradient: { type: 'linear', preset: 'fg-bg', opacity: 100, reverse: false },
    bucket: { tol: 32, contiguous: true, sampleAll: false, opacity: 100 },
    text: { font: 'Segoe UI', size: 120, weight: '800' },
    shape: { kind: 'rect', strokeW: 0, radius: 24, points: 5 }
  }, JSON.parse(localStorage.getItem('nexora.toolOpts') || '{}'));
  const saveOpts = () => { try { const o = JSON.parse(JSON.stringify(O)); o.brush.tip = null; localStorage.setItem('nexora.toolOpts', JSON.stringify(o)); } catch (e) { } };

  /* ---------- shared helpers ---------- */
  const lum = (r, g, b) => r * .299 + g * .587 + b * .114;
  const falloff = (d, r, hard) => { if (d >= r) return 0; const h = Math.min(.99, hard); if (d <= r * h) return 1; const t = (d - r * h) / (r * (1 - h)); return 1 - t * t * (3 - 2 * t); };
  const modeFromEvent = e => e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'sub' : O.selMode;
  function paintTarget(create, label) {
    const d = doc(); let L = NXI.active(d);
    if (L && L.locked) { U().toast('Layer is locked.'); return null; }
    if (L && d.target === 'mask' && L.mask) return { L, canvas: L.mask.canvas, kind: 'mask' };
    if (!L || L.type !== 'raster') {
      if (!create) { U().toast(L && (L.type === 'text' || L.type === 'shape') ? 'This is a vector layer — use Layer › Rasterize first.' : 'Select a pixel layer.'); return null; }
      L = NXI.insert(d, NXI.mkLayer(d, 'raster', { name: label || 'Layer ' + (NXI.countLayers(d) + 1) })); U().refreshLayers();
    }
    return { L, canvas: L.canvas, kind: 'layer' };
  }
  const local = (t, p) => ({ x: p.x - t.L.x, y: p.y - t.L.y });
  const isDark = hex => { const [r, g, b] = hexToRgb(hex); return lum(r, g, b) < 128; };
  const pressure = e => e && e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1;

  /* ---------- brush tips & textures ---------- */
  const TEX = {};
  function texture(name) {
    if (name === 'none') return null; if (TEX[name]) return TEX[name];
    const n = 256, c = NXI.newCanvas(n, n), x = c.getContext('2d'), id = x.createImageData(n, n), d = id.data; let s = name.length * 99;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let y = 0; y < n; y++) for (let i = 0; i < n; i++) {
      let v = 1; if (name === 'noise') v = .35 + rnd() * .65; else if (name === 'canvas') v = .55 + .45 * Math.abs(Math.sin(i * .9) * Math.sin(y * .9)) + rnd() * .1; else if (name === 'paper') v = .6 + rnd() * .25 + .15 * Math.sin((i + y * .3) * .15);
      else if (name === 'stipple') v = rnd() > .55 ? 1 : .1;
      const k = (y * n + i) * 4; d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.min(255, v * 255);
    }
    x.putImageData(id, 0, 0); return TEX[name] = c;
  }
  const tipCache = new Map(); const tipImgs = {};
  function tipImage(dataURL) { if (!dataURL) return null; if (tipImgs[dataURL]) return tipImgs[dataURL].ready ? tipImgs[dataURL].c : null; const im = new Image(), rec = { ready: false, c: null }; tipImgs[dataURL] = rec; im.onload = () => { rec.c = im; rec.ready = true; }; im.src = dataURL; return null; }
  function getTip(o, color, size, hardOverride) {
    const d = Math.max(1, Math.ceil(size)), hard = hardOverride != null ? hardOverride : o.hardness / 100, key = [d, hard, color, o.angle || 0, o.roundness || 100, o.tip ? o.tip.length + o.tip.slice(-24) : '', o.pixel ? 1 : 0].join('|');
    if (tipCache.has(key)) return tipCache.get(key);
    const c = NXI.newCanvas(d, d), x = c.getContext('2d'), custom = tipImage(o.tip);
    x.translate(d / 2, d / 2); x.rotate((o.angle || 0) * Math.PI / 180); x.scale(1, (o.roundness || 100) / 100);
    if (custom) { x.drawImage(custom, -d / 2, -d / 2, d, d); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, d, d); }
    else if (o.pixel) {   // pencil: a pixel-exact disc (no anti-aliasing on any platform), honouring roundness
      x.setTransform(1, 0, 0, 1, 0, 0); const id = x.createImageData(d, d), [r, g, b] = hexToRgb(color), R = d / 2, ry = R * (o.roundness || 100) / 100, a = (o.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      for (let py = 0; py < d; py++) for (let px = 0; px < d; px++) { const dx = px + .5 - R, dy = py + .5 - R, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; if (d === 1 || (u * u) / (R * R) + (v * v) / Math.max(.25, ry * ry) <= 1) { const i = (py * d + px) * 4; id.data[i] = r; id.data[i + 1] = g; id.data[i + 2] = b; id.data[i + 3] = 255; } }
      x.putImageData(id, 0, 0);
    }
    else { const g = x.createRadialGradient(0, 0, 0, 0, 0, d / 2); g.addColorStop(0, color); g.addColorStop(Math.min(.98, Math.max(0, hard)), color); g.addColorStop(1, rgba(color, 0)); x.fillStyle = g; x.beginPath(); x.arc(0, 0, d / 2, 0, Math.PI * 2); x.fill(); }
    if (tipCache.size > 200) tipCache.clear(); tipCache.set(key, c); return c;
  }
  const BRUSH_PRESETS = {
    'Soft Round': { hardness: 0, spacing: 12, texture: 'none', scatter: 0, roundness: 100 },
    'Hard Round': { hardness: 95, spacing: 8, texture: 'none', scatter: 0, roundness: 100 },
    'Airbrush': { hardness: 0, spacing: 4, flow: 12, texture: 'none', scatter: 0, roundness: 100 },
    'Chalk': { hardness: 70, spacing: 14, texture: 'paper', scatter: 4, roundness: 100 },
    'Marker': { hardness: 85, spacing: 5, roundness: 35, angle: 35, texture: 'none', scatter: 0 },
    'Canvas Oil': { hardness: 60, spacing: 10, texture: 'canvas', scatter: 0, roundness: 80 },
    'Spatter': { hardness: 90, spacing: 60, scatter: 120, sizeJitter: 70, texture: 'none', roundness: 100 },
    'Stipple': { hardness: 40, spacing: 18, texture: 'stipple', scatter: 10, roundness: 100 }
  };
  const userBrushes = JSON.parse(localStorage.getItem('nexora.brushes') || '{}');

  /* ---------- painting strokes (brush / pencil / eraser) ---------- */
  let S = null; // active stroke
  function strokeOpts(kind) {
    if (kind === 'pencil') return Object.assign({}, O.brush, { size: O.pencil.size, hardness: 100, opacity: O.pencil.opacity, flow: 100, spacing: 5, texture: 'none', scatter: 0, sizeJitter: 0, pixel: true, tip: null, angle: 0, roundness: 100, smoothing: 0 });
    if (kind === 'eraser') return Object.assign({}, O.brush, O.eraser, { texture: 'none', scatter: 0, sizeJitter: 0, tip: null });
    return O.brush;
  }
  function paintStart(kind, p, e) {
    const t = paintTarget(kind !== 'eraser'); if (!t) return;
    const o = strokeOpts(kind), d = doc(), color = t.kind === 'mask' ? '#ffffff' : d.fg;
    const erase = kind === 'eraser' || (t.kind === 'mask' && isDark(d.fg));
    t.L._stroke = { canvas: NXI.newCanvas(t.canvas.width, t.canvas.height), opacity: o.opacity / 100, erase, target: t.kind };
    S = { kind, t, o, color, last: null, rem: 0, sm: { x: p.x, y: p.y }, tex: texture(o.texture) };
    paintTo(p, e);
  }
  function stamp(x, y, e) {
    const o = S.o, pr = pressure(e); let size = o.size * (o.pressureSize ? pr : 1);
    if (o.sizeJitter) size *= 1 - Math.random() * o.sizeJitter / 100;
    if (o.scatter) { const a = Math.random() * Math.PI * 2, r = Math.random() * o.scatter / 100 * size; x += Math.cos(a) * r; y += Math.sin(a) * r; }
    if (o.pixel) { x = Math.round(x - .5) + .5; y = Math.round(y - .5) + .5; }
    const tip = getTip(o, S.color, size), c = S.t.L._stroke.canvas.getContext('2d'), alpha = o.flow / 100 * (o.pressureOpacity ? pr : 1);
    if (S.tex) {
      const tt = NXI.take(tip.width, tip.height), tc = tt._ctx; tc.drawImage(tip, 0, 0); tc.globalCompositeOperation = 'destination-in';
      const k = o.textureScale / 100, pat = tc.createPattern(S.tex, 'repeat'); pat.setTransform(new DOMMatrix().translate(-(x - tip.width / 2), -(y - tip.height / 2)).scale(k)); tc.fillStyle = pat; tc.fillRect(0, 0, tip.width, tip.height);
      c.globalAlpha = alpha; c.drawImage(tt, x - tip.width / 2, y - tip.height / 2); NXI.give(tt);
    } else if (o.pixel) { c.globalAlpha = alpha; c.drawImage(tip, Math.round(x - tip.width / 2), Math.round(y - tip.height / 2)); }   // whole pixels: no resampling blur
    else { c.globalAlpha = alpha; c.drawImage(tip, x - tip.width / 2, y - tip.height / 2); }
  }
  function paintTo(p, e) {
    if (!S) return; const o = S.o, sm = o.smoothing ? 1 - Math.min(.9, o.smoothing / 100) : 1;
    S.sm.x += (p.x - S.sm.x) * sm; S.sm.y += (p.y - S.sm.y) * sm; const q = local(S.t, S.sm);
    const step = Math.max(.5, o.size * o.spacing / 100);
    if (!S.last) { stamp(q.x, q.y, e); S.last = q; S.rem = step; }
    else { const dx = q.x - S.last.x, dy = q.y - S.last.y, dist = Math.hypot(dx, dy); let s = S.rem; for (; s <= dist; s += step) stamp(S.last.x + dx * s / dist, S.last.y + dy * s / dist, e); S.rem = s - dist; S.last = q; }
    doc()._compDirty = true; U().render();
  }
  function paintEnd() {
    if (!S) return; const d = doc(), L = S.t.L, st = L._stroke; let src = st.canvas;
    const sel = NXI.selLocal(d, L); if (sel) { const c = src.getContext('2d'); c.globalAlpha = 1; c.globalCompositeOperation = 'destination-in'; c.drawImage(sel, 0, 0); }
    const c = S.t.canvas.getContext('2d'); c.save(); c.globalAlpha = st.opacity; c.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'; c.drawImage(src, 0, 0); c.restore();
    L._stroke = null; const label = { brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser' }[S.kind] + (S.t.kind === 'mask' ? ' (mask)' : ''); S = null;
    NXI.dirty(d, L); U().push(label);
  }

  /* ---------- pixel-region tools (retouching, liquify) ---------- */
  let R = null, cloneSrc = null, cloneOffset = null;
  const K = () => NXI.filters.kernels;
  function regionStart(kind, p, e) {
    const t = paintTarget(false); if (!t) return;
    const o = { blur: O.retouch, sharpen: O.retouch, smudge: O.retouch, dodge: O.dodge, burn: O.dodge, sponge: O.sponge, clone: O.clone, heal: O.heal, spot: O.spot, liquify: O.liquify }[kind];
    if ((kind === 'clone' || kind === 'heal') && e.altKey) { cloneSrc = { x: p.x, y: p.y }; cloneOffset = null; U().toast('Source set — now paint where you want to copy to.'); return; }
    if ((kind === 'clone' || kind === 'heal') && !cloneSrc) { U().toast('Alt+click to set the source point first.'); return; }
    const d = doc(), sel = NXI.selLocal(d, t.L);
    R = { kind, t, o, orig: NXI.clone(t.canvas), sel: sel ? sel.getContext('2d', { willReadFrequently: true }) : null, last: null, rem: 0, carry: null, prev: local(t, p) };
    if (kind === 'clone' || kind === 'heal') { if (!cloneOffset || !O.clone.aligned) cloneOffset = { x: cloneSrc.x - p.x, y: cloneSrc.y - p.y }; }
    if (kind === 'spot') R.offset = findSpotSource(R, local(t, p), o.size / 2);
    regionTo(p, e);
  }
  function regionTo(p, e) {
    if (!R) return; const q = local(R.t, p), step = Math.max(1, R.o.size * (R.kind === 'liquify' ? .08 : .2));
    if (!R.last) { regionStamp(q, { x: 0, y: 0 }); R.last = q; R.ls = q; R.rem = step; }
    else { const dx = q.x - R.last.x, dy = q.y - R.last.y, dist = Math.hypot(dx, dy); let s = R.rem; for (; s <= dist; s += step) { const c = { x: R.last.x + dx * s / dist, y: R.last.y + dy * s / dist }; regionStamp(c, { x: c.x - R.ls.x, y: c.y - R.ls.y }); R.ls = c; } R.rem = s - dist; R.last = q; }
    NXI.dirty(doc(), R.t.L); U().render();
  }
  function regionEnd() { if (!R) return; const names = { blur: 'Blur', sharpen: 'Sharpen', smudge: 'Smudge', dodge: 'Dodge', burn: 'Burn', sponge: 'Sponge', clone: 'Clone Stamp', heal: 'Healing Brush', spot: 'Spot Healing', liquify: 'Liquify' }; U().push(names[R.kind]); R = null; }
  function regionStamp(c, delta) {
    const cv = R.t.canvas, r = R.o.size / 2, x0 = Math.max(0, Math.floor(c.x - r - 2)), y0 = Math.max(0, Math.floor(c.y - r - 2)), x1 = Math.min(cv.width, Math.ceil(c.x + r + 2)), y1 = Math.min(cv.height, Math.ceil(c.y + r + 2)), w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return;
    const ctx = cv.getContext('2d', { willReadFrequently: true }), id = ctx.getImageData(x0, y0, w, h), d = id.data, sd = R.sel ? R.sel.getImageData(x0, y0, w, h).data : null;
    const hard = R.kind === 'clone' ? O.clone.hardness / 100 : R.kind === 'liquify' ? 0 : .3, str = (R.o.strength || 50) / 100;
    const weight = (i, j) => { const f = falloff(Math.hypot(x0 + i + .5 - c.x, y0 + j + .5 - c.y), r, hard); return sd ? f * sd[(j * w + i) * 4 + 3] / 255 : f; };
    const sampleFrom = (sx, sy) => R.orig.getContext('2d', { willReadFrequently: true }).getImageData(sx, sy, w, h).data;
    switch (R.kind) {
      case 'blur': case 'sharpen': {
        const b = new Uint8ClampedArray(d); K().gauss(b, w, h, { r: Math.max(2, r / 6) });
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const wt = weight(i, j) * str * .5; if (!wt) continue; const k = (j * w + i) * 4; for (let ch = 0; ch < 4; ch++) d[k + ch] = R.kind === 'blur' ? d[k + ch] + (b[k + ch] - d[k + ch]) * wt : d[k + ch] + (d[k + ch] - b[k + ch]) * wt * 1.5; }
        break;
      }
      case 'smudge': {
        if (!R.carry) { R.carry = { data: new Uint8ClampedArray(d), w, h, x0, y0 }; return; }
        const cr = R.carry; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const wt = weight(i, j) * str; if (!wt) continue; const ci = Math.min(cr.w - 1, i), cj = Math.min(cr.h - 1, j), k = (j * w + i) * 4, kc = (cj * cr.w + ci) * 4; for (let ch = 0; ch < 4; ch++) { const v = d[k + ch] + (cr.data[kc + ch] - d[k + ch]) * wt; cr.data[kc + ch] = cr.data[kc + ch] + (v - cr.data[kc + ch]) * (1 - str * .85); d[k + ch] = v; } }
        break;
      }
      case 'dodge': case 'burn': {
        const ex = R.o.exposure / 100 * .35, rng = R.o.range;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const wt = weight(i, j); if (!wt) continue; const k = (j * w + i) * 4, l = lum(d[k], d[k + 1], d[k + 2]) / 255, rw = rng === 'shadows' ? (1 - l) ** 2 : rng === 'highlights' ? l * l : 1 - Math.abs(2 * l - 1) * .7; for (let ch = 0; ch < 3; ch++) d[k + ch] = R.kind === 'dodge' ? d[k + ch] + (255 - d[k + ch]) * ex * wt * rw : d[k + ch] * (1 - ex * wt * rw); }
        break;
      }
      case 'sponge': {
        const f = R.o.flow / 100 * .25 * (R.o.mode === 'sat' ? 1 : -1);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const wt = weight(i, j); if (!wt) continue; const k = (j * w + i) * 4, l = lum(d[k], d[k + 1], d[k + 2]); for (let ch = 0; ch < 3; ch++) d[k + ch] = l + (d[k + ch] - l) * (1 + f * wt); }
        break;
      }
      case 'clone': {
        const s = sampleFrom(x0 + Math.round(cloneOffset.x), y0 + Math.round(cloneOffset.y)), op = R.o.opacity / 100;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const wt = weight(i, j) * op; if (!wt) continue; const k = (j * w + i) * 4; if (!s[k + 3] && !d[k + 3]) continue; for (let ch = 0; ch < 4; ch++) d[k + ch] = d[k + ch] + (s[k + ch] - d[k + ch]) * wt; }
        break;
      }
      case 'heal': case 'spot': {
        // texture from the source; tone from the destination's brush boundary (least-squares plane through
        // the colour differences sampled on the edge ring) — a cheap stand-in for a Poisson membrane.
        const off = R.kind === 'spot' ? R.offset : cloneOffset, s = sampleFrom(x0 + Math.round(off.x), y0 + Math.round(off.y)), rr = r * .95, ring = [];
        for (let a = 0; a < 48; a++) { const t = a / 48 * Math.PI * 2, i = Math.round(c.x + Math.cos(t) * rr - x0), j = Math.round(c.y + Math.sin(t) * rr - y0); if (i >= 0 && j >= 0 && i < w && j < h) ring.push([i, j]); }
        const fit = [];
        for (let ch = 0; ch < 3; ch++) {
          let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, sv = 0, sxv = 0, syv = 0;
          for (const [i, j] of ring) { const k = (j * w + i) * 4, x = i + x0 + .5 - c.x, y = j + y0 + .5 - c.y, v = d[k + ch] - s[k + ch]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; sv += v; sxv += x * v; syv += y * v; }
          const det = n * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
          if (!n || Math.abs(det) < 1e-6) { fit.push([n ? sv / n : 0, 0, 0]); continue; }
          const a = (sv * (sxx * syy - sxy * sxy) - sx * (sxv * syy - sxy * syv) + sy * (sxv * sxy - sxx * syv)) / det, b = (n * (sxv * syy - sxy * syv) - sv * (sx * syy - sxy * sy) + sy * (sx * syv - sxv * sy)) / det, cc = (n * (sxx * syv - sxv * sxy) - sx * (sx * syv - sxv * sy) + sv * (sx * sxy - sxx * sy)) / det;
          fit.push([a, b, cc]);
        }
        // Poisson (seamless) healing: result = source + C, where C is harmonic inside the brush (ΔC = 0) and equals
        // destination − source on its edge. Solved with SOR, starting from the plane fit (which is already exact for
        // linear tone changes), so a few dozen sweeps converge.
        const N = w * h, inside = new Uint8Array(N), C = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], idx = [];
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const q = j * w + i, x = i + x0 + .5 - c.x, y = j + y0 + .5 - c.y, k = q * 4, inn = x * x + y * y < rr * rr && i > 0 && j > 0 && i < w - 1 && j < h - 1;
          inside[q] = inn ? 1 : 0; if (inn) idx.push(q); for (let ch = 0; ch < 3; ch++) { const [a, b, cc] = fit[ch]; C[ch][q] = inn ? a + b * x + cc * y : d[k + ch] - s[k + ch]; } }
        const sweeps = Math.min(140, 30 + Math.round(r * 1.2)), om = 1.85;
        for (let it = 0; it < sweeps; it++) for (let ch = 0; ch < 3; ch++) { const X = C[ch]; for (const q of idx) { const v = (X[q - 1] + X[q + 1] + X[q - w] + X[q + w]) * .25; X[q] += om * (v - X[q]); } }
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const wt = weight(i, j); if (!wt) continue; const q = j * w + i, k = q * 4, x = i + x0 + .5 - c.x, y = j + y0 + .5 - c.y; for (let ch = 0; ch < 3; ch++) { const [a, b, cc] = fit[ch], v = s[k + ch] + (inside[q] ? C[ch][q] : a + b * x + cc * y); d[k + ch] = d[k + ch] + (v - d[k + ch]) * wt; } }
        break;
      }
      case 'liquify': {
        const src = new Uint8ClampedArray(d), mode = R.o.mode, k0 = str;
        const samp = (sx, sy, k) => { sx -= x0; sy -= y0; if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) return false; const xa = Math.floor(sx), ya = Math.floor(sy), xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1), fx = sx - xa, fy = sy - ya; for (let ch = 0; ch < 4; ch++) { const a = src[(ya * w + xa) * 4 + ch], b = src[(ya * w + xb) * 4 + ch], e = src[(yb * w + xa) * 4 + ch], f = src[(yb * w + xb) * 4 + ch]; d[k + ch] = (a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy; } return true; };
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const wt = weight(i, j); if (!wt) continue; const px = x0 + i + .5, py = y0 + j + .5, dx = px - c.x, dy = py - c.y, k = (j * w + i) * 4; let sx, sy;
          if (mode === 'push') { sx = px - delta.x * wt * k0 * 1.6; sy = py - delta.y * wt * k0 * 1.6; }
          else if (mode === 'bloat' || mode === 'pucker') { const f = 1 + (mode === 'bloat' ? -1 : 1) * wt * k0 * .06; sx = c.x + dx * f; sy = c.y + dy * f; }
          else { const a = (mode === 'twirl' ? 1 : -1) * wt * k0 * .08, ca = Math.cos(a), sa = Math.sin(a); sx = c.x + dx * ca - dy * sa; sy = c.y + dx * sa + dy * ca; }
          samp(sx - .5, sy - .5, k);
        }
        break;
      }
    }
    ctx.putImageData(id, x0, y0);
  }
  function findSpotSource(Rr, c, r) {
    const cv = Rr.orig, ctx = cv.getContext('2d', { willReadFrequently: true }), ring = (cx, cy) => { const out = []; for (let a = 0; a < 32; a++) { const t = a / 32 * Math.PI * 2; for (const rr of [r + 1, r + 3]) out.push([Math.round(cx + Math.cos(t) * rr), Math.round(cy + Math.sin(t) * rr)]); } return out; };
    const W = cv.width, H = cv.height, full = ctx.getImageData(0, 0, W, H).data, px = (x, y) => { x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y)); const k = (y * W + x) * 4; return lum(full[k], full[k + 1], full[k + 2]); };
    const target = ring(c.x, c.y).map(([x, y]) => px(x, y)); let best = { x: r * 2.2, y: 0 }, bs = 1e18;
    for (let a = 0; a < 16; a++) for (const dist of [2.2, 3, 4]) { const t = a / 16 * Math.PI * 2, ox = Math.cos(t) * r * dist, oy = Math.sin(t) * r * dist; const cand = ring(c.x + ox, c.y + oy); let s = 0; cand.forEach(([x, y], i) => s += Math.abs(px(x, y) - target[i])); const inside = c.x + ox - r > 0 && c.y + oy - r > 0 && c.x + ox + r < W && c.y + oy + r < H; if (!inside) s *= 4; if (s < bs) { bs = s; best = { x: ox, y: oy }; } }
    return best;
  }

  /* ---------- flood fill (bucket, magic wand) ---------- */
  function floodMask(src, w, h, sx, sy, tol, contiguous) {
    const d = src, m = new Uint8Array(w * h); sx = Math.floor(sx); sy = Math.floor(sy); if (sx < 0 || sy < 0 || sx >= w || sy >= h) return m;
    const i0 = (sy * w + sx) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3], lim = tol * 4;
    const match = q => Math.abs(d[q] - tr) + Math.abs(d[q + 1] - tg) + Math.abs(d[q + 2] - tb) + Math.abs(d[q + 3] - ta) <= lim;
    if (!contiguous) { for (let q = 0, j = 0; j < m.length; q += 4, j++) if (match(q)) m[j] = 255; return m; }
    const stack = [sx, sy];
    while (stack.length) {
      let y = stack.pop(); const x = stack.pop(); while (y >= 0 && !m[y * w + x] && match((y * w + x) * 4)) y--; y++; let l = false, r = false;
      for (; y < h && !m[y * w + x] && match((y * w + x) * 4); y++) { m[y * w + x] = 255;
        if (x > 0) { const ok = !m[y * w + x - 1] && match((y * w + x - 1) * 4); if (!l && ok) { stack.push(x - 1, y); l = true; } else if (l && !ok) l = false; }
        if (x < w - 1) { const ok = !m[y * w + x + 1] && match((y * w + x + 1) * 4); if (!r && ok) { stack.push(x + 1, y); r = true; } else if (r && !ok) r = false; } }
    }
    return m;
  }
  function sampleData(useAll, L) { const d = doc(); if (useAll || !L || L.type !== 'raster') { const c = NXI.render(d); return { data: c._ctx.getImageData(0, 0, d.w, d.h).data, ox: 0, oy: 0, w: d.w, h: d.h }; } return { data: L.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, L.canvas.width, L.canvas.height).data, ox: L.x, oy: L.y, w: L.canvas.width, h: L.canvas.height }; }

  /* ---------- free transform / perspective / warp ---------- */
  let X = null; // active transform session
  function transformBegin(mode) {
    const d = doc(), L = NXI.active(d); if (!L) return;
    if (L.locked) return U().toast('Layer is locked.');
    if (L.type === 'text' || L.type === 'shape') { if (mode !== 'free') return U().toast('Perspective / Warp need a pixel layer — rasterize it first.'); X = { vec: true, L, start: JSON.parse(JSON.stringify(L.tr)) }; U().setTool('move', true); U().render(); return; }
    if (L.type !== 'raster') return U().toast('Select a pixel, text or shape layer.');
    const sb = NXI.selBounds(d), b = sb ? { x: sb.x - L.x, y: sb.y - L.y, w: sb.w, h: sb.h } : NXI.contentBounds(L.canvas); if (!b) return U().toast('The layer is empty.');
    const orig = NXI.clone(L.canvas), fc = NXI.newCanvas(b.w, b.h), fx = fc.getContext('2d'); fx.drawImage(L.canvas, -b.x, -b.y);
    const sel = NXI.selLocal(d, L), lc = L.canvas.getContext('2d');
    if (sel) { fx.globalCompositeOperation = 'destination-in'; fx.drawImage(sel, -b.x, -b.y); lc.globalCompositeOperation = 'destination-out'; lc.drawImage(sel, 0, 0); lc.globalCompositeOperation = 'source-over'; } else lc.clearRect(b.x, b.y, b.w, b.h);
    const n = 3, grid = []; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid.push({ x: b.x + b.w * i / n, y: b.y + b.h * j / n });
    L._float = { canvas: fc, mode, m: { tx: b.x + b.w / 2, ty: b.y + b.h / 2, sx: 1, sy: 1, rot: 0 }, quad: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }], grid, n, b };
    X = { L, orig, mode }; NXI.dirty(d, L); U().render(); U().refreshOptions();
  }
  function transformCommit() {
    if (!X) return; const d = doc();
    if (X.vec) { X = null; U().push('Transform'); U().refreshOptions(); return; }
    const L = X.L, f = L._float; L._float = null; const c = L.canvas.getContext('2d'); NXI.drawFloat(c, f); NXI.selNone(d); X = null; NXI.dirty(d, L); U().push({ free: 'Free Transform', perspective: 'Perspective', warp: 'Warp' }[f.mode]); U().refreshOptions();
  }
  function transformCancel() { if (!X) return; const d = doc(); if (X.vec) Object.assign(X.L.tr, X.start); else { X.L.canvas = X.orig; X.L._float = null; } NXI.dirty(d, X.L); X = null; U().render(); U().refreshOptions(); }
  function xfHandles() { // handle points in document coordinates
    if (!X) return null; const L = X.L;
    if (X.vec) { const c = NXI.vectorCanvas(L), m = NXI.vecMatrix(L), ap = (u, v) => ({ x: m[0] * u + m[2] * v + m[4], y: m[1] * u + m[3] * v + m[5] }), w = c.width / 2, h = c.height / 2; return { corners: [ap(-w, -h), ap(w, -h), ap(w, h), ap(-w, h)], center: ap(0, 0), top: ap(0, -h) }; }
    const f = L._float, ox = L.x, oy = L.y;
    if (f.mode === 'perspective') return { pts: f.quad.map(q => ({ x: q.x + ox, y: q.y + oy })) };
    if (f.mode === 'warp') return { pts: f.grid.map(q => ({ x: q.x + ox, y: q.y + oy })), n: f.n };
    const m = f.m, w = f.canvas.width / 2, h = f.canvas.height / 2, ap = (u, v) => ({ x: ox + m.tx + (u * m.sx) * Math.cos(m.rot) - (v * m.sy) * Math.sin(m.rot), y: oy + m.ty + (u * m.sx) * Math.sin(m.rot) + (v * m.sy) * Math.cos(m.rot) });
    return { corners: [ap(-w, -h), ap(w, -h), ap(w, h), ap(-w, h)], center: ap(0, 0), top: ap(0, -h) };
  }
  function xfDown(p, e) {
    const H = xfHandles(), z = U().view.zoom, near = (a, rad) => Math.hypot(a.x - p.x, a.y - p.y) < (rad || 9) / z;
    if (H.pts) { const i = H.pts.findIndex(q => near(q, 10)); X.drag = i >= 0 ? { type: 'pt', i } : { type: 'none' }; return; }
    const ci = H.corners.findIndex(q => near(q)); const top = { x: H.top.x + (H.top.x - H.center.x) / (Math.hypot(H.top.x - H.center.x, H.top.y - H.center.y) || 1) * 24 / z, y: H.top.y + (H.top.y - H.center.y) / (Math.hypot(H.top.x - H.center.x, H.top.y - H.center.y) || 1) * 24 / z };
    const st = X.vec ? Object.assign({}, X.L.tr) : Object.assign({}, X.L._float.m);
    if (near(top, 11) || (ci < 0 && !insideQuad(H.corners, p) && distToQuad(H.corners, p) < 30 / z)) X.drag = { type: 'rot', a0: Math.atan2(p.y - H.center.y, p.x - H.center.x), st, c: H.center };
    else if (ci >= 0) X.drag = { type: 'scale', st, c: H.center, d0x: p.x - H.center.x, d0y: p.y - H.center.y, corner: H.corners[ci] };
    else X.drag = { type: 'move', st, p0: p };
  }
  function insideQuad(q, p) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); s += Math.sign(cr); } return Math.abs(s) === 4; }
  function distToQuad(q, p) { let m = 1e9; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2, t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l2 || 1))); m = Math.min(m, Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y))); } return m; }
  function xfMove(p, e) {
    const g = X.drag; if (!g || g.type === 'none') return; const d = doc(), L = X.L;
    if (g.type === 'pt') { const f = L._float, arr = f.mode === 'perspective' ? f.quad : f.grid; arr[g.i] = { x: p.x - L.x, y: p.y - L.y }; }
    else {
      const T = X.vec ? L.tr : L._float.m, isVec = X.vec;
      if (g.type === 'move') { const dx = p.x - g.p0.x, dy = p.y - g.p0.y; if (isVec) { T.x = g.st.x + dx; T.y = g.st.y + dy; } else { T.tx = g.st.tx + dx; T.ty = g.st.ty + dy; } }
      else if (g.type === 'rot') { let a = Math.atan2(p.y - g.c.y, p.x - g.c.x) - g.a0; if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); if (isVec) T.rot = g.st.rot + a * 180 / Math.PI; else T.rot = g.st.rot + a; }
      else if (g.type === 'scale') {
        const rot = isVec ? g.st.rot * Math.PI / 180 : g.st.rot, ca = Math.cos(-rot), sa = Math.sin(-rot), lx = (p.x - g.c.x) * ca - (p.y - g.c.y) * sa, ly = (p.x - g.c.x) * sa + (p.y - g.c.y) * ca, l0x = g.d0x * ca - g.d0y * sa, l0y = g.d0x * sa + g.d0y * ca;
        let kx = lx / (l0x || 1), ky = ly / (l0y || 1); if (!e.shiftKey) { const k = Math.abs(kx) > Math.abs(ky) ? kx : ky; kx = ky = k; }
        if (isVec) { T.sx = g.st.sx * kx; T.sy = g.st.sy * ky; } else { T.sx = g.st.sx * kx; T.sy = g.st.sy * ky; }
      }
    }
    if (X.vec) { NXI.dirty(d, L); U().refreshProps(); } else d._compDirty = true; U().render();
  }

  /* ---------- tool table ---------- */
  let G = null; // generic gesture state for simple tools
  const MARQ = shape => ({
    down(p, e) { G = { p0: p, p1: p, mode: modeFromEvent(e), shape }; },
    move(p, e) { if (!G) return; let x = p.x, y = p.y; if (e.shiftKey && G.mode === O.selMode) { const s = Math.max(Math.abs(x - G.p0.x), Math.abs(y - G.p0.y)); x = G.p0.x + Math.sign(x - G.p0.x) * s; y = G.p0.y + Math.sign(y - G.p0.y) * s; } G.p1 = { x, y }; U().render(); },
    up() {
      if (!G) return; const d = doc(), a = G.p0, b = G.p1, x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w < 2 && h < 2) { if (G.mode === 'replace') { NXI.selNone(d); U().push('Deselect'); } G = null; U().render(); return; }
      NXI.selFromPath(d, c => shape === 'ellipse' ? c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2) : c.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)), G.mode, O.feather);
      G = null; U().push(shape === 'ellipse' ? 'Elliptical Marquee' : 'Rectangular Marquee');
    },
    overlay(c) { if (!G) return; const a = U().toScreen(G.p0), b = U().toScreen(G.p1); c.strokeStyle = '#fff'; c.setLineDash([5, 4]); c.beginPath(); if (shape === 'ellipse') c.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); else c.rect(a.x, a.y, b.x - a.x, b.y - a.y); c.stroke(); c.setLineDash([]); }
  });
  const PAINT = kind => ({ down(p, e) { paintStart(kind, p, e); }, move(p, e) { paintTo(p, e); }, up() { paintEnd(); }, brushCursor: true });
  const REGION = kind => ({ down(p, e) { regionStart(kind, p, e); }, move(p, e) { regionTo(p, e); }, up() { regionEnd(); }, brushCursor: true });
  let crop = null, pen = null;
  function gradCanvas(t, a, b) {
    const o = O.gradient, d = doc(), c = NXI.newCanvas(t.canvas.width, t.canvas.height), x = c.getContext('2d'), A = local(t, a), B = local(t, b), len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let g; if (o.type === 'radial') g = x.createRadialGradient(A.x, A.y, 0, A.x, A.y, len); else if (o.type === 'angle') g = x.createConicGradient(Math.atan2(B.y - A.y, B.x - A.x), A.x, A.y); else g = x.createLinearGradient(A.x, A.y, B.x, B.y);
    let c1 = t.kind === 'mask' ? '#ffffff' : d.fg, c2 = t.kind === 'mask' ? 'rgba(255,255,255,0)' : o.preset === 'fg-transparent' ? rgba(d.fg, 0) : d.bg; if (o.reverse) [c1, c2] = [c2, c1];
    if (o.type === 'reflected') { g = x.createLinearGradient(A.x - (B.x - A.x), A.y - (B.y - A.y), B.x, B.y); g.addColorStop(0, c2); g.addColorStop(.5, c1); g.addColorStop(1, c2); } else { g.addColorStop(0, c1); g.addColorStop(1, c2); }
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height); return c;
  }
  const T = {
    move: { icon: '✥', name: 'Move', key: 'V',
      down(p, e) {
        if (X) return xfDown(p, e);
        const d = doc(); let L = NXI.active(d);
        if (O.autoSelect || e.ctrlKey) { const hit = U().hitLayer(p); if (hit) { d.activeId = hit.id; L = hit; U().refreshLayers(); } }
        if (!L || L.locked) return;
        if (d.sel && L.type === 'raster') { transformBegin('free'); X.autoCommit = true; X.drag = { type: 'move', st: Object.assign({}, L._float.m), p0: p }; return; }
        const start = []; NXI.walk([L], q => start.push([q, q.tr ? { x: q.tr.x, y: q.tr.y } : { x: q.x, y: q.y }])); G = { p0: p, start, moved: false };
      },
      move(p, e) {
        if (X) return xfMove(p, e); if (!G) return; let dx = p.x - G.p0.x, dy = p.y - G.p0.y; if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } G.moved = true;
        for (const [q, s] of G.start) { if (q.tr) { q.tr.x = s.x + dx; q.tr.y = s.y + dy; } else if (q.type === 'raster') { q.x = Math.round(s.x + dx); q.y = Math.round(s.y + dy); } q.v++; }
        NXI.dirty(doc()); U().render(); U().refreshProps();
      },
      up() { if (X) { X.drag = null; if (X.autoCommit) transformCommit(); return; } if (G && G.moved) U().push('Move'); G = null; },
      overlay(c) { if (!X) return; const H = xfHandles(), S2 = q => U().toScreen(q); c.strokeStyle = '#3b9bff'; c.lineWidth = 1.5;
        if (H.pts) { if (H.n) { const n = H.n; for (let j = 0; j <= n; j++) { c.beginPath(); for (let i = 0; i <= n; i++) { const s = S2(H.pts[j * (n + 1) + i]); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); } c.stroke(); } for (let i = 0; i <= n; i++) { c.beginPath(); for (let j = 0; j <= n; j++) { const s = S2(H.pts[j * (n + 1) + i]); j ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); } c.stroke(); } } else { c.beginPath(); H.pts.forEach((q, i) => { const s = S2(q); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.closePath(); c.stroke(); }
          c.fillStyle = '#fff'; H.pts.forEach(q => { const s = S2(q); c.fillRect(s.x - 4, s.y - 4, 8, 8); c.strokeRect(s.x - 4, s.y - 4, 8, 8); }); return; }
        c.beginPath(); H.corners.forEach((q, i) => { const s = S2(q); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.closePath(); c.stroke();
        c.fillStyle = '#fff'; H.corners.forEach(q => { const s = S2(q); c.fillRect(s.x - 5, s.y - 5, 10, 10); c.strokeRect(s.x - 5, s.y - 5, 10, 10); });
        const ce = S2(H.center), tp = S2(H.top), dl = Math.hypot(tp.x - ce.x, tp.y - ce.y) || 1, rx = tp.x + (tp.x - ce.x) / dl * 24, ry = tp.y + (tp.y - ce.y) / dl * 24; c.beginPath(); c.moveTo(tp.x, tp.y); c.lineTo(rx, ry); c.stroke(); c.beginPath(); c.arc(rx, ry, 5, 0, 6.283); c.fill(); c.stroke(); }
    },
    marquee: Object.assign(MARQ('rect'), { icon: '⬚', name: 'Rectangular Marquee', key: 'M' }),
    ellipse: Object.assign(MARQ('ellipse'), { icon: '◯', name: 'Elliptical Marquee', key: 'M' }),
    lasso: { icon: '➰', name: 'Lasso', key: 'L',
      down(p, e) { G = { pts: [p], mode: modeFromEvent(e) }; }, move(p) { if (G) { G.pts.push(p); U().render(); } },
      up() { if (!G) return; if (G.pts.length > 2) { const pts = G.pts; NXI.selFromPath(doc(), c => { pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath(); }, G.mode, O.feather); U().push('Lasso'); } G = null; U().render(); },
      overlay(c) { if (!G) return; c.strokeStyle = '#fff'; c.setLineDash([4, 3]); c.beginPath(); G.pts.forEach((q, i) => { const s = U().toScreen(q); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.stroke(); c.setLineDash([]); }
    },
    poly: { icon: '⬠', name: 'Polygonal Lasso', key: 'L',
      down(p, e) {
        if (!G) G = { pts: [], mode: modeFromEvent(e), hover: p };
        const z = U().view.zoom; if (G.pts.length > 2 && Math.hypot(p.x - G.pts[0].x, p.y - G.pts[0].y) < 8 / z) return T.poly.finish();
        G.pts.push(p); U().render();
      },
      move(p) { if (G) { G.hover = p; U().render(); } }, hover(p) { if (G) { G.hover = p; U().render(); } }, up() { },
      dbl() { T.poly.finish(); },
      finish() { if (!G) return; const pts = G.pts; if (pts.length > 2) { NXI.selFromPath(doc(), c => { pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath(); }, G.mode, O.feather); U().push('Polygonal Lasso'); } G = null; U().render(); },
      cancel() { G = null; U().render(); }, enter() { T.poly.finish(); },
      overlay(c) { if (!G || !G.pts.length) return; c.strokeStyle = '#fff'; c.setLineDash([4, 3]); c.beginPath(); [...G.pts, G.hover].forEach((q, i) => { const s = U().toScreen(q); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.stroke(); c.setLineDash([]); const s0 = U().toScreen(G.pts[0]); c.strokeRect(s0.x - 4, s0.y - 4, 8, 8); }
    },
    wand: { icon: '✦', name: 'Magic Wand', key: 'W',
      down(p, e) { const d = doc(), L = NXI.active(d), s = sampleData(O.sampleAll, L), m = floodMask(s.data, s.w, s.h, p.x - s.ox, p.y - s.oy, O.wandTol, O.contiguous);
        let full = m; if (s.ox || s.oy || s.w !== d.w || s.h !== d.h) { full = new Uint8Array(d.w * d.h); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const X2 = x + s.ox, Y = y + s.oy; if (X2 >= 0 && Y >= 0 && X2 < d.w && Y < d.h) full[Y * d.w + X2] = m[y * s.w + x]; } }
        NXI.selFromMask(d, full, modeFromEvent(e)); if (O.feather) NXI.selFeather(d, O.feather); U().push('Magic Wand'); },
      move() { }, up() { }
    },
    quick: { icon: '◍', name: 'Quick Selection', key: 'W', brushCursor: true,
      down(p, e) { const d = doc(); if (!d.sel) { d.sel = NXI.newCanvas(d.w, d.h); } G = { sub: e.altKey, comp: NXI.render(d)._ctx.getImageData(0, 0, d.w, d.h).data }; T.quick.paint(p); },
      move(p) { if (G) T.quick.paint(p); },
      paint(p) {
        const d = doc(), r = O.quickSize / 2, x0 = Math.max(0, Math.floor(p.x - r)), y0 = Math.max(0, Math.floor(p.y - r)), x1 = Math.min(d.w, Math.ceil(p.x + r)), y1 = Math.min(d.h, Math.ceil(p.y + r)); if (x1 <= x0 || y1 <= y0) return;
        const sc = d.sel.getContext('2d', { willReadFrequently: true }), id = sc.getImageData(x0, y0, x1 - x0, y1 - y0), sd = id.data, cd = G.comp, k0 = (Math.floor(Math.min(d.h - 1, Math.max(0, p.y))) * d.w + Math.floor(Math.min(d.w - 1, Math.max(0, p.x)))) * 4, lim = O.wandTol * 3;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (Math.hypot(x - p.x, y - p.y) > r) continue; const k = (y * d.w + x) * 4; if (Math.abs(cd[k] - cd[k0]) + Math.abs(cd[k + 1] - cd[k0 + 1]) + Math.abs(cd[k + 2] - cd[k0 + 2]) > lim) continue; const q = ((y - y0) * (x1 - x0) + (x - x0)) * 4; sd[q] = sd[q + 1] = sd[q + 2] = 255; sd[q + 3] = G.sub ? 0 : 255; }
        sc.putImageData(id, x0, y0); d.selV++; d._selBounds = null; U().render();
      },
      up() { if (!G) return; G = null; const d = doc(); if (!NXI.selBounds(d)) NXI.selNone(d); U().push('Quick Selection'); }
    },
    crop: { icon: '⛶', name: 'Crop', key: 'C',
      activate() { const d = doc(); crop = { x: 0, y: 0, w: d.w, h: d.h }; U().render(); }, deactivate() { crop = null; },
      down(p) { if (!crop) T.crop.activate(); const z = U().view.zoom, near = (x, y) => Math.abs(p.x - x) < 10 / z && Math.abs(p.y - y) < 10 / z, c = crop;
        const hs = [['tl', c.x, c.y], ['tr', c.x + c.w, c.y], ['bl', c.x, c.y + c.h], ['br', c.x + c.w, c.y + c.h]]; const h = hs.find(q => near(q[1], q[2]));
        G = h ? { type: h[0], st: Object.assign({}, c) } : (p.x > c.x && p.y > c.y && p.x < c.x + c.w && p.y < c.y + c.h) ? { type: 'move', st: Object.assign({}, c), p0: p } : { type: 'new', p0: p }; },
      move(p, e) { if (!G) return; const c = crop, st = G.st, ratio = { free: 0, '1:1': 1, '16:9': 16 / 9, '4:3': 4 / 3, '9:16': 9 / 16, '4:5': .8 }[O.cropRatio];
        if (G.type === 'move') { c.x = st.x + p.x - G.p0.x; c.y = st.y + p.y - G.p0.y; }
        else { let ax, ay; if (G.type === 'new') { ax = G.p0.x; ay = G.p0.y; } else { ax = G.type.includes('l') ? st.x + st.w : st.x; ay = G.type.includes('t') ? st.y + st.h : st.y; }
          let w = p.x - ax, h = p.y - ay; if (ratio) { if (Math.abs(w) / ratio > Math.abs(h)) h = Math.sign(h || 1) * Math.abs(w) / ratio; else w = Math.sign(w || 1) * Math.abs(h) * ratio; }
          c.x = Math.min(ax, ax + w); c.y = Math.min(ay, ay + h); c.w = Math.abs(w); c.h = Math.abs(h); }
        U().render(); },
      up() { G = null; },
      enter() { if (!crop || crop.w < 2 || crop.h < 2) return; NXI.crop(doc(), crop); crop = { x: 0, y: 0, w: doc().w, h: doc().h }; U().push('Crop'); U().fit(); },
      cancel() { T.crop.activate(); },
      overlay(c) { if (!crop) return; const a = U().toScreen({ x: crop.x, y: crop.y }), b = U().toScreen({ x: crop.x + crop.w, y: crop.y + crop.h }), W = c.canvas.width, H = c.canvas.height;
        c.fillStyle = '#000a'; c.beginPath(); c.rect(0, 0, W, H); c.rect(a.x, a.y, b.x - a.x, b.y - a.y); c.fill('evenodd'); c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        c.strokeStyle = '#ffffff55'; for (let k = 1; k < 3; k++) { c.beginPath(); c.moveTo(a.x + (b.x - a.x) * k / 3, a.y); c.lineTo(a.x + (b.x - a.x) * k / 3, b.y); c.moveTo(a.x, a.y + (b.y - a.y) * k / 3); c.lineTo(b.x, a.y + (b.y - a.y) * k / 3); c.stroke(); }
        c.fillStyle = '#fff'; [[a.x, a.y], [b.x, a.y], [a.x, b.y], [b.x, b.y]].forEach(([x, y]) => c.fillRect(x - 5, y - 5, 10, 10)); c.fillStyle = '#fff'; c.font = '12px Segoe UI'; c.fillText(`${Math.round(crop.w)} × ${Math.round(crop.h)}  ·  Enter to apply`, a.x + 4, a.y - 6); }
    },
    eyedrop: { icon: '💧', name: 'Eyedropper', key: 'I',
      down(p, e) { T.eyedrop.pick(p, e); }, move(p, e) { if (e.buttons) T.eyedrop.pick(p, e); }, up() { },
      pick(p, e) { const d = doc(), c = NXI.render(d), s = O.eyeSize, x = Math.max(0, Math.min(d.w - s, Math.floor(p.x - s / 2))), y = Math.max(0, Math.min(d.h - s, Math.floor(p.y - s / 2))), dd = c._ctx.getImageData(x, y, s, s).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < dd.length; i += 4) { r += dd[i]; g += dd[i + 1]; b += dd[i + 2]; n++; } const hex = '#' + [r, g, b].map(v => Math.round(v / n).toString(16).padStart(2, '0')).join(''); if (e.altKey) d.bg = hex; else d.fg = hex; U().refreshColor(); }
    },
    spot: Object.assign(REGION('spot'), { icon: '✚', name: 'Spot Healing Brush', key: 'J' }),
    heal: Object.assign(REGION('heal'), { icon: '✙', name: 'Healing Brush (Alt+click source)', key: 'J' }),
    brush: Object.assign(PAINT('brush'), { icon: '🖌', name: 'Brush', key: 'B' }),
    pencil: Object.assign(PAINT('pencil'), { icon: '✏', name: 'Pencil', key: 'B' }),
    clone: Object.assign(REGION('clone'), { icon: '⎘', name: 'Clone Stamp (Alt+click source)', key: 'S' }),
    eraser: Object.assign(PAINT('eraser'), { icon: '⌫', name: 'Eraser', key: 'E' }),
    gradient: { icon: '▤', name: 'Gradient', key: 'G',
      down(p) { const t = paintTarget(true, 'Gradient'); if (!t) return; G = { t, a: p, b: p }; },
      move(p) { if (!G) return; G.b = p; G.t.L._stroke = { canvas: gradCanvas(G.t, G.a, G.b), opacity: O.gradient.opacity / 100, erase: false, target: G.t.kind }; NXI.dirty(doc()); U().render(); },
      up() { if (!G) return; const { t } = G; G = null; if (!t.L._stroke) return; const d = doc(), st = t.L._stroke, sel = NXI.selLocal(d, t.L), src = st.canvas; if (sel) { const c = src.getContext('2d'); c.globalCompositeOperation = 'destination-in'; c.drawImage(sel, 0, 0); } const c = t.canvas.getContext('2d'); c.save(); c.globalAlpha = st.opacity; c.drawImage(src, 0, 0); c.restore(); t.L._stroke = null; NXI.dirty(d, t.L); U().push('Gradient'); },
      overlay(c) { if (!G) return; const a = U().toScreen(G.a), b = U().toScreen(G.b); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.fillStyle = '#fff'; c.fillRect(a.x - 3, a.y - 3, 6, 6); c.fillRect(b.x - 3, b.y - 3, 6, 6); }
    },
    bucket: { icon: '🪣', name: 'Paint Bucket', key: 'G',
      down(p) {
        const t = paintTarget(false); if (!t) return; const d = doc(), s = sampleData(O.bucket.sampleAll, t.L), m = floodMask(s.data, s.w, s.h, p.x - s.ox, p.y - s.oy, O.bucket.tol, O.bucket.contiguous);
        const c = NXI.newCanvas(t.canvas.width, t.canvas.height), x = c.getContext('2d'), id = x.createImageData(c.width, c.height), [r, g, b] = hexToRgb(t.kind === 'mask' ? (isDark(d.fg) ? '#000000' : '#ffffff') : d.fg);
        for (let yy = 0; yy < s.h; yy++) for (let xx = 0; xx < s.w; xx++) { const v = m[yy * s.w + xx]; if (!v) continue; const X2 = xx + s.ox - t.L.x, Y = yy + s.oy - t.L.y; if (X2 < 0 || Y < 0 || X2 >= c.width || Y >= c.height) continue; const k = (Y * c.width + X2) * 4; id.data[k] = r; id.data[k + 1] = g; id.data[k + 2] = b; id.data[k + 3] = v; }
        x.putImageData(id, 0, 0); const sel = NXI.selLocal(d, t.L); if (sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sel, 0, 0); }
        const tc = t.canvas.getContext('2d'); tc.save(); tc.globalAlpha = O.bucket.opacity / 100; tc.globalCompositeOperation = t.kind === 'mask' && isDark(d.fg) ? 'destination-out' : 'source-over'; tc.drawImage(c, 0, 0); tc.restore(); NXI.dirty(d, t.L); U().push('Paint Bucket');
      }, move() { }, up() { }
    },
    blur: Object.assign(REGION('blur'), { icon: '◌', name: 'Blur', key: 'R' }),
    sharpen: Object.assign(REGION('sharpen'), { icon: '△', name: 'Sharpen', key: 'R' }),
    smudge: Object.assign(REGION('smudge'), { icon: '☝', name: 'Smudge', key: 'R' }),
    dodge: Object.assign(REGION('dodge'), { icon: '◐', name: 'Dodge', key: 'O' }),
    burn: Object.assign(REGION('burn'), { icon: '◑', name: 'Burn', key: 'O' }),
    sponge: Object.assign(REGION('sponge'), { icon: '⊚', name: 'Sponge', key: 'O' }),
    liquify: Object.assign(REGION('liquify'), { icon: '〰', name: 'Liquify (push / bloat / pucker / twirl)', key: 'Q' }),
    pen: { icon: '✒', name: 'Pen (paths)', key: 'P',
      down(p, e) {
        const d = doc(), z = U().view.zoom; if (!d.path || d.path.done) d.path = { pts: [], closed: false };
        const pts = d.path.pts, hit = pts.findIndex(q => Math.hypot(q.x - p.x, q.y - p.y) < 7 / z);
        if (hit === 0 && pts.length > 2 && !d.path.closed) { d.path.closed = true; d.path.done = true; U().push('Close path'); U().refreshOptions(); return; }
        if (hit > 0 || (hit === 0 && d.path.closed)) { G = { drag: pts[hit], moveAnchor: true, p0: p, st: Object.assign({}, pts[hit]) }; return; }
        const a = { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y }; pts.push(a); G = { drag: a }; U().render();
      },
      move(p) { if (!G) return; const a = G.drag; if (G.moveAnchor) { const dx = p.x - G.p0.x, dy = p.y - G.p0.y; a.x = G.st.x + dx; a.y = G.st.y + dy; a.ix = G.st.ix + dx; a.iy = G.st.iy + dy; a.ox = G.st.ox + dx; a.oy = G.st.oy + dy; } else { a.ox = p.x; a.oy = p.y; a.ix = 2 * a.x - p.x; a.iy = 2 * a.y - p.y; } U().render(); },
      up() { if (G) U().push(G.moveAnchor ? 'Move anchor' : 'Add anchor'); G = null; },
      enter() { const d = doc(); if (d.path) { d.path.done = true; U().render(); U().refreshOptions(); } },
      cancel() { const d = doc(); d.path = null; U().render(); U().refreshOptions(); },
      overlay(c) { const d = doc(); if (!d.path || !d.path.pts.length) return; const s = q => U().toScreen(q); c.strokeStyle = '#3b9bff'; c.lineWidth = 1.5; c.beginPath(); const pts = d.path.pts.map(q => ({ x: s(q).x, y: s(q).y, ix: s({ x: q.ix, y: q.iy }).x, iy: s({ x: q.ix, y: q.iy }).y, ox: s({ x: q.ox, y: q.oy }).x, oy: s({ x: q.ox, y: q.oy }).y })); NXI.tracePath(c, pts, d.path.closed); c.stroke();
        pts.forEach(q => { c.strokeStyle = '#5cb8ff'; c.beginPath(); c.moveTo(q.ix, q.iy); c.lineTo(q.ox, q.oy); c.stroke(); c.fillStyle = '#fff'; c.fillRect(q.x - 3.5, q.y - 3.5, 7, 7); c.fillStyle = '#5cb8ff'; c.beginPath(); c.arc(q.ox, q.oy, 2.5, 0, 6.283); c.arc(q.ix, q.iy, 2.5, 0, 6.283); c.fill(); }); }
    },
    text: { icon: 'T', name: 'Text', key: 'T',
      down(p) { const d = doc(), hit = U().hitLayer(p); if (hit && hit.type === 'text') { d.activeId = hit.id; U().refreshLayers(); U().editText(hit); return; }
        const L = NXI.mkLayer(d, 'text', { name: 'Text', text: { str: 'Text', font: O.text.font, size: O.text.size, weight: O.text.weight, color: d.fg }, tr: { x: p.x, y: p.y } }); NXI.insert(d, L); U().push('New text layer'); U().refreshLayers(); U().editText(L, true); }, move() { }, up() { }
    },
    shape: { icon: '▢', name: 'Shape', key: 'U',
      down(p) { const d = doc(), o = O.shape; const L = NXI.mkLayer(d, 'shape', { name: o.kind[0].toUpperCase() + o.kind.slice(1), shape: { kind: o.kind, w: 1, h: 1, fill: d.fg, stroke: d.bg, strokeW: o.kind === 'line' ? Math.max(2, o.strokeW) : o.strokeW, radius: o.radius, points: o.points }, tr: { x: p.x, y: p.y } }); NXI.insert(d, L); G = { L, p0: p }; U().refreshLayers(); },
      move(p, e) { if (!G) return; let w = p.x - G.p0.x, h = p.y - G.p0.y; if (e.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; } const S2 = G.L.shape; S2.w = Math.max(1, Math.abs(w)); S2.h = S2.kind === 'line' ? 1 : Math.max(1, Math.abs(h)); if (S2.kind === 'line') { G.L.tr.rot = Math.atan2(h, w) * 180 / Math.PI; S2.w = Math.hypot(w, h); G.L.tr.x = G.p0.x + w / 2; G.L.tr.y = G.p0.y + h / 2; } else { G.L.tr.x = G.p0.x + w / 2; G.L.tr.y = G.p0.y + h / 2; } NXI.dirty(doc(), G.L); U().render(); },
      up() { if (!G) return; const S2 = G.L.shape; if (S2.w < 3 && S2.h < 3) { S2.w = 300; S2.h = S2.kind === 'line' ? 1 : 300; NXI.dirty(doc(), G.L); } G = null; U().push('New shape'); U().refreshProps(); }
    },
    hand: { icon: '✋', name: 'Hand', key: 'H', down() { }, move() { }, up() { } },
    zoom: { icon: '🔍', name: 'Zoom (Alt = out)', key: 'Z', down(p, e) { U().zoomAt(p, e.altKey ? 1 / 1.5 : 1.5); }, move() { }, up() { } }
  };
  for (const id in T) T[id].id = id;
  const ORDER = ['move', 'marquee', 'ellipse', 'lasso', 'poly', 'wand', 'quick', 'crop', 'eyedrop', 'spot', 'heal', 'brush', 'pencil', 'clone', 'eraser', 'gradient', 'bucket', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'liquify', 'pen', 'text', 'shape', 'hand', 'zoom'];

  /* ---------- path operations (pen) ---------- */
  function pathOps(op) {
    const d = doc(), P2 = d.path; if (!P2 || P2.pts.length < 2) return U().toast('Draw a path with the Pen tool first.');
    const trace = c => NXI.tracePath(c, P2.pts, P2.closed || op !== 'stroke');
    if (op === 'select') { NXI.selFromPath(d, trace, 'replace', O.feather); U().push('Path to selection'); }
    else if (op === 'fill' || op === 'stroke') {
      const t = paintTarget(true, op === 'fill' ? 'Path fill' : 'Path stroke'); if (!t) return; const c = NXI.newCanvas(t.canvas.width, t.canvas.height), x = c.getContext('2d'); x.translate(-t.L.x, -t.L.y); x.beginPath(); trace(x);
      if (op === 'fill') { x.fillStyle = d.fg; x.fill(); } else { x.strokeStyle = d.fg; x.lineWidth = Math.max(1, O.brush.size / 4); x.lineCap = x.lineJoin = 'round'; x.stroke(); }
      const sel = NXI.selLocal(d, t.L); if (sel) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(sel, 0, 0); }
      t.canvas.getContext('2d').drawImage(c, 0, 0); NXI.dirty(d, t.L); U().push(op === 'fill' ? 'Fill path' : 'Stroke path');
    } else if (op === 'shape') {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; P2.pts.forEach(q => [[q.x, q.y], [q.ix, q.iy], [q.ox, q.oy]].forEach(([a, b]) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b); }));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, pts = P2.pts.map(q => ({ x: q.x - cx, y: q.y - cy, ix: q.ix - cx, iy: q.iy - cy, ox: q.ox - cx, oy: q.oy - cy }));
      const L = NXI.mkLayer(d, 'shape', { name: 'Path shape', shape: { kind: 'path', w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), pts, closed: !!P2.closed, fill: d.fg, fillOn: !!P2.closed, stroke: d.fg, strokeW: P2.closed ? 0 : 4 }, tr: { x: cx, y: cy } });
      NXI.insert(d, L); d.path = null; U().push('Path to shape layer'); U().refreshLayers();
    } else if (op === 'clear') { d.path = null; U().render(); }
    U().refreshOptions();
  }

  return { T, ORDER, O, saveOpts, BRUSH_PRESETS, userBrushes, getTip, texture, transformBegin, transformCommit, transformCancel, pathOps, get transforming() { return !!X; }, get cropRect() { return crop; }, floodMask, falloff, cancelGesture() { if (S) { S.t.L._stroke = null; S = null; } R = null; G = null; } };
})();
