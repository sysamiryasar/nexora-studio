'use strict';
/* ====================== NEXORA Image — document engine ======================
   Document = layer tree (bottom → top). Layer types: raster | text | shape | group | adjust.
   Raster layers own a doc-sized canvas + integer offset (x,y). Text/shape are vector, re-rendered from params.
   Every layer may have a mask (alpha canvas, layer-local), a clipping flag, blend mode, opacity and layer effects.
   History is copy-on-write: unchanged canvases are shared between snapshots (keyed by version counters). */
const NXI = (() => {
  /* ---------- canvas pool (scratch surfaces reused between frames) ---------- */
  const pool = [];
  function take(w, h) {
    const i = pool.findIndex(c => c.width === w && c.height === h);
    const c = i >= 0 ? pool.splice(i, 1)[0] : Object.assign(document.createElement('canvas'), { width: w, height: h });
    if (!c._ctx) c._ctx = c.getContext('2d', { willReadFrequently: true });
    const x = c._ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.shadowColor = 'transparent'; x.clearRect(0, 0, w, h);
    return c;
  }
  function give(c) { if (c && pool.length < 14 && !pool.includes(c)) pool.push(c); }
  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function clone(c) { const n = newCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; }
  const ctxOf = c => c._ctx || (c._ctx = c.getContext('2d', { willReadFrequently: true }));

  /* ---------- defaults ---------- */
  const FXDEF = () => ({
    shadow: { on: false, color: '#000000', opacity: 60, angle: 120, distance: 12, size: 16 },
    glow: { on: false, color: '#8b5cf6', opacity: 85, size: 24 },
    stroke: { on: false, color: '#ffffff', size: 4, opacity: 100 },
    overlay: { on: false, color: '#3b9bff', opacity: 100 },
    innerShadow: { on: false, color: '#000000', opacity: 70, angle: 120, distance: 8, size: 10 },
    innerGlow: { on: false, color: '#ffe9a8', opacity: 75, size: 16 },
    bevel: { on: false, style: 'inner', depth: 100, size: 10, angle: 120, altitude: 30, hi: '#ffffff', hiOp: 75, sh: '#000000', shOp: 75 }
  });
  /** effects of a layer with defaults filled in (documents saved before inner effects existed lack those keys) */
  const fxOf = L => { const d = FXDEF(), f = L.fx || {}; for (const k in d) f[k] = Object.assign(d[k], f[k] || {}); return (L.fx = f); };
  const TEXTDEF = () => ({ str: 'Text', font: 'Segoe UI', size: 120, weight: '800', italic: false, color: '#ffffff', align: 'center', tracking: 0, kern: true, lineH: 1.15, case: 'none', strokeW: 0, stroke: '#000000', shadow: false, shColor: '#000000', shBlur: 12, shX: 0, shY: 6, grad: false, c2: '#3b9bff', gAngle: 90, boxW: 0 });
  const SHAPEDEF = () => ({ kind: 'rect', w: 400, h: 260, radius: 0, points: 5, fillOn: true, fill: '#8b5cf6', grad: false, fill2: '#3b9bff', gAngle: 45, stroke: '#ffffff', strokeW: 0, pts: null, closed: true });

  function mkLayer(doc, type, o) {
    const L = { id: uid(), type, name: o && o.name || ({ raster: 'Layer', text: 'Text', shape: 'Shape', group: 'Group', adjust: 'Adjustment' })[type], visible: true, locked: false, opacity: 100, blend: 'source-over', clip: false, mask: null, fx: FXDEF(), x: 0, y: 0, v: 0 };
    if (type === 'raster') L.canvas = newCanvas(doc.w, doc.h);
    if (type === 'text') { L.text = TEXTDEF(); L.tr = { x: doc.w / 2, y: doc.h / 2, rot: 0, sx: 100, sy: 100 }; }
    if (type === 'shape') { L.shape = SHAPEDEF(); L.tr = { x: doc.w / 2, y: doc.h / 2, rot: 0, sx: 100, sy: 100 }; }
    if (type === 'group') { L.children = []; L.open = true; }
    if (type === 'adjust') L.adj = { type: 'curves', p: ADJ.defs.curves.p() };
    if (o) { const { name, text, shape, tr, adj, ...rest } = o; Object.assign(L, rest); if (text) Object.assign(L.text, text); if (shape) Object.assign(L.shape, shape); if (tr) Object.assign(L.tr, tr); if (adj) L.adj = adj; }
    return L;
  }
  function newDoc(o) {
    o = o || {};
    const doc = { id: uid(), name: o.name || 'Untitled', w: Math.round(o.w || 1920), h: Math.round(o.h || 1080), layers: [], activeId: null, multi: [], target: 'layer', sel: null, selV: 0, path: null, rev: 0, hist: [], histI: -1, fg: '#ffffff', bg: '#000000' };
    if (o.bg && o.bg !== 'transparent') { const L = mkLayer(doc, 'raster', { name: 'Background' }); const c = L.canvas.getContext('2d'); c.fillStyle = o.bg; c.fillRect(0, 0, doc.w, doc.h); doc.layers.push(L); doc.activeId = L.id; }
    return doc;
  }

  /* ---------- tree helpers ---------- */
  function walk(list, fn, parent) { for (const L of list) { fn(L, list, parent); if (L.children) walk(L.children, fn, L); } }
  function find(doc, id) { let r = null; walk(doc.layers, (L, list, parent) => { if (L.id === id) r = { L, list, i: list.indexOf(L), parent }; }); return r; }
  const active = doc => { const f = doc.activeId && find(doc, doc.activeId); return f ? f.L : null; };
  function countLayers(doc) { let n = 0; walk(doc.layers, () => n++); return n; }
  function insert(doc, L, refId) {
    const ref = refId ? find(doc, refId) : (doc.activeId && find(doc, doc.activeId));
    if (ref && ref.L.type === 'group' && ref.L.open && !refId) ref.L.children.push(L);
    else if (ref) ref.list.splice(ref.i + 1, 0, L); else doc.layers.push(L);
    doc.activeId = L.id; dirty(doc); return L;
  }

  /* ---------- change tracking ---------- */
  const listeners = [];
  function dirty(doc, L) { if (L) L.v++; doc.rev++; doc._compDirty = true; doc._thumb = null; listeners.forEach(f => f(doc)); }

  /* ---------- vector content ---------- */
  const fontStr = X => `${X.italic ? 'italic ' : ''}${X.weight} ${X.size}px "${X.font}", sans-serif`;
  const caseOf = (s, c) => c === 'upper' ? s.toUpperCase() : c === 'lower' ? s.toLowerCase() : c === 'cap' ? s.replace(/\b\w/g, m => m.toUpperCase()) : s;
  const mctx = document.createElement('canvas').getContext('2d');
  function textCanvas(L) {
    const X = L.text, key = JSON.stringify(X); if (L._cache && L._cache.key === key) return L._cache.c;
    const str = caseOf(X.str, X.case), sp = X.tracking / 1000 * X.size;
    const set = c => { c.font = fontStr(X); if ('letterSpacing' in c) c.letterSpacing = sp + 'px'; if ('fontKerning' in c) c.fontKerning = X.kern ? 'normal' : 'none'; c.textBaseline = 'middle'; };
    set(mctx);
    const pad = Math.ceil(X.size * .3 + X.strokeW * 2 + (X.shadow ? X.shBlur * 2 + Math.abs(X.shX) + Math.abs(X.shY) : 0));
    const paint = (c, W, H) => {
      let fill = X.color;
      if (X.grad) { const a = X.gAngle * Math.PI / 180, dx = Math.cos(a) * W / 2, dy = Math.sin(a) * H / 2, g = c.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy); g.addColorStop(0, X.color); g.addColorStop(1, X.c2); fill = g; }
      return (txt, x, y) => {
        if (X.shadow) { c.shadowColor = X.shColor; c.shadowBlur = X.shBlur; c.shadowOffsetX = X.shX; c.shadowOffsetY = X.shY; }
        if (X.strokeW > 0) { c.lineWidth = X.strokeW * 2; c.strokeStyle = X.stroke; c.strokeText(txt, x, y); c.shadowColor = 'transparent'; }
        c.fillStyle = fill; c.fillText(txt, x, y); c.shadowColor = 'transparent';
      };
    };
    /* text on a path: one glyph at a time, placed by arc length and rotated to the tangent (path in local coordinates,
       centred on the layer position) */
    if (X.path && X.path.length > 1) {
      const poly = flattenPath(X.path, !!X.pathClosed), R = Math.ceil(Math.max(...poly.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))) + X.size + pad), W = Math.min(8192, R * 2), H = W;
      const cv = newCanvas(W, H), c = cv.getContext('2d'); set(c); c.lineJoin = 'round'; c.textAlign = 'center'; if ('letterSpacing' in c) c.letterSpacing = '0px';
      const draw = paint(c, W, H), total = poly[poly.length - 1].d, chars = [...str.replace(/\n/g, ' ')], wid = chars.map(ch => mctx.measureText(ch).width + sp), len = wid.reduce((a, b) => a + b, 0);
      let s = (X.align === 'left' ? 0 : X.align === 'right' ? total - len : (total - len) / 2) + (X.pathOffset || 0) / 100 * total;
      chars.forEach((ch, i) => {
        const m = s + wid[i] / 2; s += wid[i]; if (m < 0 || m > total) return; let k = 1; while (k < poly.length - 1 && poly[k].d < m) k++;
        const a = poly[k - 1], b = poly[k], u = (m - a.d) / Math.max(1e-6, b.d - a.d), x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, ang = Math.atan2(b.y - a.y, b.x - a.x);
        c.save(); c.translate(W / 2 + x, H / 2 + y); c.rotate(ang); c.translate(0, -(X.baseline || 0)); draw(ch, 0, 0); c.restore();
      });
      L._cache = { key, c: cv }; return cv;
    }
    /* paragraph text: with a box width, lines wrap at word boundaries (long words break by character) */
    let lines = str.split('\n');
    if (X.boxW > 0) {
      const out = [], bw = X.boxW; lines.forEach(par => {
        const words = par.split(/(\s+)/); let line = '';
        for (const w of words) {
          if (!w) continue; const t = line + w;
          if (mctx.measureText(t.trimEnd()).width <= bw) { line = t; continue; }
          if (line.trim()) { out.push({ s: line.trimEnd(), soft: true }); line = ''; }
          let rest = w.replace(/^\s+/, ''); while (rest && mctx.measureText(rest).width > bw) { let n = rest.length; while (n > 1 && mctx.measureText(rest.slice(0, n)).width > bw) n--; out.push({ s: rest.slice(0, n), soft: true }); rest = rest.slice(n); }
          line = rest;
        }
        out.push({ s: line.trimEnd(), soft: false });
      }); lines = out;
    } else lines = lines.map(s => ({ s, soft: false }));
    const widths = lines.map(l => mctx.measureText(l.s).width), lh = X.size * X.lineH;
    const W = Math.min(8192, Math.ceil(X.boxW > 0 ? X.boxW : Math.max(4, ...widths)) + pad * 2), H = Math.min(8192, Math.ceil(lines.length * lh) + pad * 2);
    const cv = newCanvas(W, H), c = cv.getContext('2d'); set(c); c.lineJoin = 'round'; const draw = paint(c, W, H), inner = W - pad * 2;
    lines.forEach((ln, i) => {
      const y = pad + lh * (i + .5);
      if (X.align === 'justify' && ln.soft && X.boxW > 0 && /\s/.test(ln.s)) {   // full justification: extra space shared between the words of wrapped lines
        const ws = ln.s.split(/\s+/), wsum = ws.reduce((a, w) => a + mctx.measureText(w).width, 0), gap = (inner - wsum) / (ws.length - 1); let x = pad;
        ws.forEach(w => { draw(w, x, y); x += mctx.measureText(w).width + gap; }); return;
      }
      const al = X.align === 'justify' ? 'left' : X.align, x = al === 'left' ? pad : al === 'right' ? W - pad - widths[i] : (W - widths[i]) / 2;
      draw(ln.s, x, y);
    });
    L._cache = { key, c: cv }; return cv;
  }
  /** cubic Bézier path (same point format as shapes: x,y + in/out handles) → polyline with cumulative length .d */
  function flattenPath(pts, closed) {
    const out = [{ x: pts[0].x, y: pts[0].y, d: 0 }], seg = (a, b) => { for (let k = 1; k <= 24; k++) { const t = k / 24, u = 1 - t, x = u * u * u * a.x + 3 * u * u * t * (a.ox ?? a.x) + 3 * u * t * t * (b.ix ?? b.x) + t * t * t * b.x, y = u * u * u * a.y + 3 * u * u * t * (a.oy ?? a.y) + 3 * u * t * t * (b.iy ?? b.y) + t * t * t * b.y, p = out[out.length - 1]; out.push({ x, y, d: p.d + Math.hypot(x - p.x, y - p.y) }); } };
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]); if (closed && pts.length > 2) seg(pts[pts.length - 1], pts[0]); return out;
  }
  function tracePath(c, pts, closed) {
    if (!pts || !pts.length) return; c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; c.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y); }
    if (closed && pts.length > 2) { const a = pts[pts.length - 1], b = pts[0]; c.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y); c.closePath(); }
  }
  function shapePath(c, S) {
    const w = S.w, h = S.h; c.beginPath();
    const poly = (n, star) => { const k = star ? n * 2 : n; for (let i = 0; i < k; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / k, r = star && i % 2 ? .45 : 1; i ? c.lineTo(Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r) : c.moveTo(Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r); } c.closePath(); };
    switch (S.kind) {
      case 'rect': if (S.radius > 0) c.roundRect(-w / 2, -h / 2, w, h, Math.min(S.radius, w / 2, h / 2)); else c.rect(-w / 2, -h / 2, w, h); break;
      case 'ellipse': c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
      case 'polygon': poly(Math.max(3, S.points | 0)); break;
      case 'star': poly(Math.max(3, S.points | 0), true); break;
      case 'line': c.moveTo(-w / 2, 0); c.lineTo(w / 2, 0); break;
      case 'path': tracePath(c, S.pts, S.closed); break;
    }
  }
  function shapeCanvas(L) {
    const S = L.shape, key = JSON.stringify(S); if (L._cache && L._cache.key === key) return L._cache.c;
    const pad = Math.ceil(S.strokeW + 4), W = Math.min(8192, Math.ceil(S.w) + pad * 2), H = Math.min(8192, Math.ceil(Math.max(S.h, S.kind === 'line' ? 1 : S.h)) + pad * 2);
    const cv = newCanvas(Math.max(1, W), Math.max(1, H)), c = cv.getContext('2d'); c.translate(W / 2, H / 2); shapePath(c, S);
    if (S.fillOn && S.kind !== 'line') { if (S.grad) { const a = S.gAngle * Math.PI / 180, dx = Math.cos(a) * S.w / 2, dy = Math.sin(a) * S.h / 2, g = c.createLinearGradient(-dx, -dy, dx, dy); g.addColorStop(0, S.fill); g.addColorStop(1, S.fill2); c.fillStyle = g; } else c.fillStyle = S.fill; c.fill(); }
    if (S.strokeW > 0 || S.kind === 'line') { c.lineWidth = Math.max(1, S.strokeW); c.strokeStyle = S.stroke; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
    L._cache = { key, c: cv }; return cv;
  }
  const vectorCanvas = L => L.type === 'text' ? textCanvas(L) : shapeCanvas(L);
  function vecMatrix(L) { const t = L.tr, a = t.rot * Math.PI / 180, kx = t.sx / 100, ky = t.sy / 100; return [Math.cos(a) * kx, Math.sin(a) * kx, -Math.sin(a) * ky, Math.cos(a) * ky, t.x, t.y]; }

  /* ---------- mesh drawing (free transform, perspective, warp) ---------- */
  function meshDraw(ctx, src, sx, sy, sw, sh, map, N) {
    N = N || 16; const P = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const u = i / N, v = j / N; P.push({ s: [sx + u * sw, sy + v * sh], d: map(u, v) }); }
    const tri = (a, b, d) => {
      const [x0, y0] = a.s, [x1, y1] = b.s, [x2, y2] = d.s, [u0, v0] = a.d, [u1, v1] = b.d, [u2, v2] = d.d, den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1); if (Math.abs(den) < 1e-9) return;
      const A = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den, Cc = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den, E = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
      const B = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den, D = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den, F = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
      const mx = (u0 + u1 + u2) / 3, my = (v0 + v1 + v2) / 3, ex = (p, m) => p + Math.sign(p - m) * .7;
      ctx.save(); ctx.beginPath(); ctx.moveTo(ex(u0, mx), ex(v0, my)); ctx.lineTo(ex(u1, mx), ex(v1, my)); ctx.lineTo(ex(u2, mx), ex(v2, my)); ctx.closePath(); ctx.clip();
      ctx.transform(A, B, Cc, D, E, F); ctx.drawImage(src, 0, 0); ctx.restore();
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = P[j * (N + 1) + i], b = P[j * (N + 1) + i + 1], c = P[(j + 1) * (N + 1) + i], d = P[(j + 1) * (N + 1) + i + 1]; tri(a, b, c); tri(b, d, c); }
  }
  /** homography mapping the unit square onto quad [tl,tr,br,bl] */
  function quadMap(q) {
    const [p0, p1, p2, p3] = q, dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
    let g = 0, h = 0; const den = dx1 * dy2 - dx2 * dy1; if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
    const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;
    return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
  }
  /** bilinear patch over a (n+1)x(n+1) control grid (warp) */
  function gridMap(G, n) { return (u, v) => { const fx = Math.min(n - 1e-9, u * n), fy = Math.min(n - 1e-9, v * n), i = Math.floor(fx), j = Math.floor(fy), s = fx - i, t = fy - j, p = (a, b) => G[b * (n + 1) + a]; const A = p(i, j), B = p(i + 1, j), C2 = p(i, j + 1), D = p(i + 1, j + 1); return [(A.x * (1 - s) + B.x * s) * (1 - t) + (C2.x * (1 - s) + D.x * s) * t, (A.y * (1 - s) + B.y * s) * (1 - t) + (C2.y * (1 - s) + D.y * s) * t]; }; }

  /* ---------- compositing ---------- */
  function drawFloat(ctx, f) {
    if (f.mode === 'perspective') meshDraw(ctx, f.canvas, 0, 0, f.canvas.width, f.canvas.height, quadMap(f.quad), 14);
    else if (f.mode === 'warp') meshDraw(ctx, f.canvas, 0, 0, f.canvas.width, f.canvas.height, gridMap(f.grid, f.n), 20);
    else { const m = f.m; ctx.save(); ctx.translate(m.tx, m.ty); ctx.rotate(m.rot); ctx.scale(m.sx, m.sy); ctx.drawImage(f.canvas, -f.canvas.width / 2, -f.canvas.height / 2); ctx.restore(); }
  }
  function drawContent(ctx, L, doc) {
    if (L.type === 'raster') {
      ctx.drawImage(L._preview || L.canvas, L.x, L.y);
      const s = L._stroke;
      if (s && s.target === 'layer') {
        let src = s.canvas; if (doc.sel) { const t = take(s.canvas.width, s.canvas.height); t._ctx.drawImage(s.canvas, 0, 0); t._ctx.globalCompositeOperation = 'destination-in'; t._ctx.drawImage(doc.sel, -L.x, -L.y); src = t; }
        ctx.save(); ctx.globalAlpha = s.opacity; ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'; ctx.drawImage(src, L.x, L.y); ctx.restore(); if (src !== s.canvas) give(src);
      }
      if (L._float) { ctx.save(); ctx.translate(L.x, L.y); drawFloat(ctx, L._float); ctx.restore(); }
    } else if (L.type === 'text' || L.type === 'shape') {
      const c = vectorCanvas(L), m = vecMatrix(L); ctx.save(); ctx.transform(...m); ctx.drawImage(c, -c.width / 2, -c.height / 2); ctx.restore();
    } else if (L.type === 'group') {
      const t = take(doc.w, doc.h); composeList(L.children, doc, t); ctx.drawImage(t, 0, 0); give(t);
    }
  }
  function maskCanvasFor(L, doc) {
    const m = L.mask; let mc = m.canvas, temp = null;
    const s = L._stroke;
    if (s && s.target === 'mask') { temp = take(mc.width, mc.height); const t = temp._ctx; t.drawImage(mc, 0, 0); t.globalAlpha = s.opacity; t.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'; t.drawImage(s.canvas, 0, 0); mc = temp; }
    if (m.density < 100) { const d = take(mc.width, mc.height); d._ctx.fillStyle = `rgba(0,0,0,${1 - m.density / 100})`; d._ctx.fillRect(0, 0, d.width, d.height); d._ctx.drawImage(mc, 0, 0); if (temp) give(temp); temp = d; mc = d; }
    return { mc, temp };
  }
  const hasFx = L => { const f = L.fx; return !!f && ['shadow', 'glow', 'stroke', 'overlay', 'innerShadow', 'innerGlow', 'bevel'].some(k => f[k] && f[k].on); };
  /** colour everywhere OUTSIDE the layer's shape (optionally shifted), blurred — the source of inner shadow / inner glow */
  function insideEdge(src, W, H, color, dx, dy, blur) {
    const inv = take(W, H), c = inv._ctx; c.fillStyle = color; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'destination-out'; c.drawImage(src, dx, dy); c.globalCompositeOperation = 'source-over';
    if (blur <= 0) return inv; const b = take(W, H), bc = b._ctx; bc.filter = `blur(${blur / 2}px)`; bc.drawImage(inv, 0, 0); bc.filter = 'none'; give(inv); return b;
  }
  /** Bevel & Emboss: the layer's alpha is blurred into a height map; its slope, lit from angle/altitude, gives highlight
      (screen) and shadow (multiply) tones. Inner bevel stays inside the shape; emboss also shades just outside it. */
  function bevelOn(content, src, W, H, B) {
    const hm = take(W, H), hc = hm._ctx; hc.filter = `blur(${Math.max(.5, B.size / 2)}px)`; hc.drawImage(src, 0, 0); hc.filter = 'none';
    const A = hc.getImageData(0, 0, W, H).data; give(hm);
    const hi = hexToRgb(B.hi), sh = hexToRgb(B.sh), az = B.angle * Math.PI / 180, al = B.altitude * Math.PI / 180, lx = Math.cos(al) * Math.cos(az), ly = -Math.cos(al) * Math.sin(az), lz = Math.sin(al), k = B.depth / 100 * Math.max(1, B.size) / 64;
    const hiI = new ImageData(W, H), shI = new ImageData(W, H), hd = hiI.data, sd = shI.data;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, gx = (A[(i + 1) * 4 + 3] - A[(i - 1) * 4 + 3]) * k, gy = (A[(i + W) * 4 + 3] - A[(i - W) * 4 + 3]) * k; if (!gx && !gy) continue;
      const n = 1 / Math.hypot(gx, gy, 1), s = (-gx * lx - gy * ly + lz) * n - lz, j = i * 4;
      if (s > 0) { hd[j] = hi[0]; hd[j + 1] = hi[1]; hd[j + 2] = hi[2]; hd[j + 3] = Math.min(255, s * 255 * 1.6 * B.hiOp / 100); }
      else { sd[j] = sh[0]; sd[j + 1] = sh[1]; sd[j + 2] = sh[2]; sd[j + 3] = Math.min(255, -s * 255 * 1.6 * B.shOp / 100); }
    }
    const c = content._ctx;
    for (const [img, mode] of [[hiI, 'screen'], [shI, 'multiply']]) {
      const t = take(W, H), tc = t._ctx; tc.putImageData(img, 0, 0);
      if (B.style === 'inner') { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(src, 0, 0); tc.globalCompositeOperation = 'source-over'; }
      // where the backdrop is transparent (emboss, just outside the shape) screen / multiply act like normal painting
      c.globalCompositeOperation = mode; c.drawImage(t, 0, 0); c.globalCompositeOperation = 'source-over'; give(t);
    }
  }
  function applyEffects(src, L, doc) {
    const W = doc.w, H = doc.h, F = fxOf(L), out = take(W, H), o = out._ctx;
    let content = src;
    const own = () => { if (content === src) { content = take(W, H); content._ctx.drawImage(src, 0, 0); } return content._ctx; };
    if (F.overlay.on) { const c = own(); c.globalCompositeOperation = 'source-atop'; c.globalAlpha = F.overlay.opacity / 100; c.fillStyle = F.overlay.color; c.fillRect(0, 0, W, H); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
    // inner effects sit on top of the content, clipped to it (Photoshop order: overlay → inner glow → inner shadow → bevel)
    if (F.innerGlow.on) { const c = own(), g = insideEdge(src, W, H, F.innerGlow.color, 0, 0, F.innerGlow.size); c.globalCompositeOperation = 'source-atop'; c.globalAlpha = F.innerGlow.opacity / 100; c.drawImage(g, 0, 0); c.drawImage(g, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; give(g); }
    if (F.innerShadow.on) { const a = F.innerShadow.angle * Math.PI / 180, c = own(), g = insideEdge(src, W, H, F.innerShadow.color, -Math.cos(a) * F.innerShadow.distance, Math.sin(a) * F.innerShadow.distance, F.innerShadow.size); c.globalCompositeOperation = 'source-atop'; c.globalAlpha = F.innerShadow.opacity / 100; c.drawImage(g, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; give(g); }
    if (F.bevel.on) { own(); bevelOn(content, src, W, H, F.bevel); }
    const shadowOnly = (color, blur, dx, dy, alpha, times) => { o.save(); o.globalAlpha = alpha; o.shadowColor = color; o.shadowBlur = blur; o.shadowOffsetX = dx + W * 2; o.shadowOffsetY = dy; for (let k = 0; k < times; k++) o.drawImage(src, -W * 2, 0); o.restore(); };
    if (F.shadow.on) { const a = F.shadow.angle * Math.PI / 180; shadowOnly(F.shadow.color, F.shadow.size, -Math.cos(a) * F.shadow.distance, Math.sin(a) * F.shadow.distance, F.shadow.opacity / 100, 1); }
    if (F.glow.on) shadowOnly(F.glow.color, F.glow.size, 0, 0, F.glow.opacity / 100, 2);
    if (F.stroke.on && F.stroke.size > 0) {
      const tint = take(W, H), t = tint._ctx; t.drawImage(src, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = F.stroke.color; t.fillRect(0, 0, W, H);
      o.save(); o.globalAlpha = F.stroke.opacity / 100; const r = F.stroke.size, steps = Math.max(12, Math.ceil(r * 3));
      for (let rr = r; rr > 0; rr -= Math.max(1, r / 3)) for (let k = 0; k < steps; k++) { const a = k / steps * Math.PI * 2; o.drawImage(tint, Math.cos(a) * rr, Math.sin(a) * rr); }
      o.restore(); give(tint);
    }
    o.drawImage(content, 0, 0); if (content !== src) give(content);
    return out;
  }
  /** returns { c, x, y, temp } — a surface holding the layer's pixels (content + mask + effects), not yet opacity/blended */
  function layerImage(L, doc) {
    if (L.type === 'raster' && !L.mask && !hasFx(L) && !L._stroke && !L._float) return { c: L._preview || L.canvas, x: L.x, y: L.y, temp: false };
    const t = take(doc.w, doc.h); drawContent(t._ctx, L, doc);
    if (L.mask && L.mask.on) { const { mc, temp } = maskCanvasFor(L, doc), c = t._ctx; c.globalCompositeOperation = 'destination-in'; c.drawImage(mc, L.x, L.y); c.globalCompositeOperation = 'source-over'; if (temp) give(temp); }
    if (hasFx(L)) { const e = applyEffects(t, L, doc); give(t); return { c: e, x: 0, y: 0, temp: true }; }
    return { c: t, x: 0, y: 0, temp: true };
  }
  function applyAdjust(acc, L, base, doc) {
    const ctx = acc._ctx, W = acc.width, H = acc.height, id = ctx.getImageData(0, 0, W, H); let mask = null;
    if ((L.mask && L.mask.on) || (L.clip && base)) {
      const m = take(W, H), mc = m._ctx; mc.fillStyle = '#000'; mc.fillRect(0, 0, W, H);
      if (L.mask && L.mask.on) { const { mc: mm, temp } = maskCanvasFor(L, doc); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(mm, L.x, L.y); if (temp) give(temp); }
      if (L.clip && base) { mc.globalCompositeOperation = 'destination-in'; mc.drawImage(base.c, base.x, base.y); }
      const md = mc.getImageData(0, 0, W, H).data; mask = new Uint8ClampedArray(W * H); for (let i = 0, j = 3; i < mask.length; i++, j += 4) mask[i] = md[j]; give(m);
    }
    if (!L.blend || L.blend === 'source-over' || L.blend === 'normal') { ADJ.apply(id.data, L.adj.type, L.adj.p, L.opacity / 100, mask); ctx.putImageData(id, 0, 0); return; }
    // blend mode: the fully adjusted image is blended onto what is below with the layer's mode, weighted by opacity × mask
    const d = id.data, k = L.opacity / 100; ADJ.apply(d, L.adj.type, L.adj.p, 1, null);
    for (let i = 0, j = 3; j < d.length; i++, j += 4) d[j] = d[j] * k * (mask ? mask[i] / 255 : 1);
    const t = take(W, H); t._ctx.putImageData(id, 0, 0); ctx.save(); ctx.globalCompositeOperation = L.blend; ctx.drawImage(t, 0, 0); ctx.restore(); give(t);
  }
  function composeList(list, doc, out) {
    const ctx = out._ctx; let base = null, baseHidden = false;
    const drop = b => { if (b && b.temp) give(b.c); };
    for (const L of list) {
      if (!L.clip) { drop(base); base = null; baseHidden = !L.visible; }
      if (!L.visible || (L.clip && baseHidden)) continue;
      if (L.type === 'adjust') { applyAdjust(out, L, L.clip ? base : null, doc); continue; }
      const img = layerImage(L, doc);
      ctx.save(); ctx.globalAlpha = L.opacity / 100; ctx.globalCompositeOperation = L.blend;
      if (L.clip) {
        if (base) { const t = take(doc.w, doc.h), tc = t._ctx; tc.drawImage(img.c, img.x, img.y); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(base.c, base.x, base.y); ctx.drawImage(t, 0, 0); give(t); }
        if (img.temp) give(img.c);
      } else { ctx.drawImage(img.c, img.x, img.y); base = img; }
      ctx.restore();
    }
    drop(base);
  }
  function render(doc) {
    if (doc._comp && !doc._compDirty && doc._comp.width === doc.w && doc._comp.height === doc.h) return doc._comp;
    if (!doc._comp || doc._comp.width !== doc.w || doc._comp.height !== doc.h) { doc._comp = newCanvas(doc.w, doc.h); doc._comp._ctx = doc._comp.getContext('2d', { willReadFrequently: true }); }
    const c = doc._comp._ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, doc.w, doc.h);
    // composite cache: everything below the layer being edited is composited once and reused while only that layer
    // (or anything above it) changes — painting on a layer of a 40-layer document recomposites 1 layer, not 40.
    // The split is at a non-clipped layer so clipping groups stay intact; the cache key covers every layer below.
    const top = doc.layers, ai = doc.activeId ? top.findIndex(L => L.id === doc.activeId || (L.children && find({ layers: L.children }, doc.activeId))) : -1;
    let split = ai; while (split > 0 && top[split].clip) split--;
    if (split >= 2) {
      const sig = top.slice(0, split).map(layerSig).join('|');
      if (!doc._below || doc._below.sig !== sig || doc._below.c.width !== doc.w || doc._below.c.height !== doc.h) {
        const b = doc._below && doc._below.c.width === doc.w && doc._below.c.height === doc.h ? doc._below.c : newCanvas(doc.w, doc.h); b._ctx = b._ctx || b.getContext('2d', { willReadFrequently: true });
        b._ctx.setTransform(1, 0, 0, 1, 0, 0); b._ctx.globalAlpha = 1; b._ctx.globalCompositeOperation = 'source-over'; b._ctx.clearRect(0, 0, doc.w, doc.h); composeList(top.slice(0, split), doc, b); doc._below = { sig, c: b }; S_.belowMiss++;
      } else S_.belowHit++;
      c.drawImage(doc._below.c, 0, 0); composeList(top.slice(split), doc, doc._comp);
    } else composeList(doc.layers, doc, doc._comp);
    doc._compDirty = false; return doc._comp;
  }
  const S_ = { belowHit: 0, belowMiss: 0 };
  /** everything about a layer that affects how it composites (pixels via the version counter) */
  function layerSig(L) {
    const own = JSON.stringify(L, (k, v) => (k[0] === '_' || k === 'canvas' || k === 'children' || k === 'hist') ? undefined : v);
    return L.id + ':' + L.v + ':' + cid(L.canvas) + ':' + (L.mask ? L.mask.v + ':' + cid(L.mask.canvas) : '') + ':' + own.length + ':' + hashStr(own) + (L.children ? '[' + L.children.map(layerSig).join(',') + ']' : '');
  }
  // canvas identity: undo/redo restores cloned canvases, so (identity, version) never repeats for different pixels
  const CID = new WeakMap(); let cidN = 0; const cid = c => { if (!c) return 0; let v = CID.get(c); if (!v) CID.set(c, v = ++cidN); return v; };
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  /** render a sub-list (used by merge down) */
  function renderLayers(doc, list) { const out = newCanvas(doc.w, doc.h); out._ctx = out.getContext('2d', { willReadFrequently: true }); composeList(list, doc, out); return out; }
  function flatten(doc) { return clone(render(doc)); }
  function thumbURL(doc, size) {
    if (doc._thumb && doc._thumb.size === size) return doc._thumb.url;
    const c = render(doc), k = size / Math.max(doc.w, doc.h), t = newCanvas(Math.max(1, Math.round(doc.w * k)), Math.max(1, Math.round(doc.h * k))); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    const url = t.toDataURL('image/png'); doc._thumb = { size, url }; return url;
  }
  function layerThumb(L, doc, cv) {
    const x = cv.getContext('2d'), k = Math.min(cv.width / doc.w, cv.height / doc.h); x.clearRect(0, 0, cv.width, cv.height);
    const w = doc.w * k, h = doc.h * k, ox = (cv.width - w) / 2, oy = (cv.height - h) / 2;
    if (L.type === 'adjust') { x.fillStyle = '#8b5cf6'; x.font = '15px Segoe UI'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('◐', cv.width / 2, cv.height / 2); return; }
    const t = take(doc.w, doc.h); drawContent(t._ctx, L, doc); x.drawImage(t, ox, oy, w, h); give(t);
  }
  function maskThumb(L, doc, cv) { const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height); const k = Math.min(cv.width / doc.w, cv.height / doc.h), t = take(doc.w, doc.h); t._ctx.fillStyle = '#fff'; t._ctx.fillRect(0, 0, doc.w, doc.h); t._ctx.globalCompositeOperation = 'destination-in'; t._ctx.drawImage(L.mask.canvas, L.x, L.y); x.drawImage(t, (cv.width - doc.w * k) / 2, (cv.height - doc.h * k) / 2, doc.w * k, doc.h * k); give(t); }

  /* ---------- selection (alpha canvas, doc coordinates) ---------- */
  function selCombine(doc, shape, mode) {
    if (mode === 'replace' || (!doc.sel && mode === 'add')) doc.sel = shape;
    else if (!doc.sel) doc.sel = mode === 'intersect' ? null : null;
    else { const c = doc.sel.getContext('2d'); c.globalCompositeOperation = mode === 'sub' ? 'destination-out' : mode === 'intersect' ? 'destination-in' : 'source-over'; c.drawImage(shape, 0, 0); c.globalCompositeOperation = 'source-over'; }
    doc.selV++; doc._selBounds = null; if (doc.sel && !selBounds(doc)) doc.sel = null;
  }
  function selFromPath(doc, draw, mode, feather) {
    const s = newCanvas(doc.w, doc.h), c = s.getContext('2d'); if (feather > 0) c.filter = `blur(${feather}px)`; c.fillStyle = '#fff'; c.beginPath(); draw(c); c.fill(); selCombine(doc, s, mode || 'replace');
  }
  function selFromMask(doc, alpha, mode) { const s = newCanvas(doc.w, doc.h), c = s.getContext('2d'), id = c.createImageData(doc.w, doc.h); for (let i = 0, j = 0; j < alpha.length; i += 4, j++) { id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = alpha[j]; } c.putImageData(id, 0, 0); selCombine(doc, s, mode || 'replace'); }
  function selBounds(doc) {
    if (!doc.sel) return null; if (doc._selBounds && doc._selBoundsV === doc.selV) return doc._selBounds;
    const d = doc.sel.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, doc.w, doc.h).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < doc.h; y++) { const row = y * doc.w * 4; for (let x = 0; x < doc.w; x++) if (d[row + x * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
    doc._selBoundsV = doc.selV; return doc._selBounds = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  const selAll = doc => { const s = newCanvas(doc.w, doc.h), c = s.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, doc.w, doc.h); doc.sel = s; doc.selV++; doc._selBounds = null; };
  const selNone = doc => { doc.sel = null; doc.selV++; doc._selBounds = null; };
  function selInvert(doc) { const s = newCanvas(doc.w, doc.h), c = s.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, doc.w, doc.h); if (doc.sel) { c.globalCompositeOperation = 'destination-out'; c.drawImage(doc.sel, 0, 0); } doc.sel = s; doc.selV++; doc._selBounds = null; if (!selBounds(doc)) doc.sel = null; }
  function selFeather(doc, r) { if (!doc.sel || r <= 0) return; const s = newCanvas(doc.w, doc.h), c = s.getContext('2d'); c.filter = `blur(${r}px)`; c.drawImage(doc.sel, 0, 0); doc.sel = s; doc.selV++; doc._selBounds = null; }
  function selGrow(doc, r) { // r>0 grow, r<0 shrink: blur + threshold
    if (!doc.sel || !r) return; const s = newCanvas(doc.w, doc.h), c = s.getContext('2d', { willReadFrequently: true }); c.filter = `blur(${Math.abs(r) / 2}px)`; c.drawImage(doc.sel, 0, 0); c.filter = 'none';
    const id = c.getImageData(0, 0, doc.w, doc.h), d = id.data, th = r > 0 ? 6 : 249; for (let i = 3; i < d.length; i += 4) d[i] = d[i] > th ? 255 : 0; c.putImageData(id, 0, 0); doc.sel = s; doc.selV++; doc._selBounds = null; if (!selBounds(doc)) doc.sel = null;
  }
  function selFromLayerAlpha(doc, L, mode) { const t = take(doc.w, doc.h), img = layerImage(L, doc); t._ctx.drawImage(img.c, img.x, img.y); if (img.temp) give(img.c); const s = clone(t); give(t); selCombine(doc, s, mode || 'replace'); }
  /** selection as an alpha canvas aligned to a raster layer's local space */
  function selLocal(doc, L) { if (!doc.sel) return null; if (!L.x && !L.y) return doc.sel; const t = newCanvas(doc.w, doc.h); t.getContext('2d').drawImage(doc.sel, -L.x, -L.y); return t; }
  /** result = target outside the selection, replacement inside it */
  function commitMasked(doc, L, target, replacement) {
    const c = target.getContext('2d'), sel = selLocal(doc, L);
    if (!sel) { c.clearRect(0, 0, target.width, target.height); c.drawImage(replacement, 0, 0); return; }
    const t = take(target.width, target.height), tc = t._ctx; tc.drawImage(replacement, 0, 0); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(sel, 0, 0);
    c.globalCompositeOperation = 'destination-out'; c.drawImage(sel, 0, 0); c.globalCompositeOperation = 'source-over'; c.drawImage(t, 0, 0); give(t);
  }

  /* ---------- layer operations ---------- */
  function contentBounds(cv) {
    const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height).data, W = cv.width; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 4) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function cloneLayerDeep(L) {
    const C2 = JSON.parse(JSON.stringify(L, (k, v) => k === 'canvas' || k[0] === '_' ? undefined : v));
    const fix = (src, dst) => { dst.id = uid(); if (src.canvas) dst.canvas = clone(src.canvas); if (src.mask) dst.mask.canvas = clone(src.mask.canvas); if (src.children) src.children.forEach((c, i) => fix(c, dst.children[i])); };
    fix(L, C2); return C2;
  }
  function duplicate(doc, id) { const f = find(doc, id); if (!f) return null; const D = cloneLayerDeep(f.L); D.name = f.L.name + ' copy'; f.list.splice(f.i + 1, 0, D); doc.activeId = D.id; dirty(doc); return D; }
  function remove(doc, id) { const f = find(doc, id); if (!f) return; f.list.splice(f.i, 1); const n = f.list[Math.min(f.i, f.list.length - 1)] || f.parent; doc.activeId = n ? n.id : (doc.layers[doc.layers.length - 1] || {}).id || null; doc.multi = []; dirty(doc); }
  function moveBy(doc, id, d) { const f = find(doc, id); if (!f) return; const j = f.i + d; if (j < 0 || j >= f.list.length) return; f.list.splice(f.i, 1); f.list.splice(j, 0, f.L); dirty(doc); }
  function moveTo(doc, id, refId, pos) {
    if (id === refId) return; const f = find(doc, id), r = find(doc, refId); if (!f || !r) return;
    let p = r.L; while (p) { if (p === f.L) return; const pp = find(doc, p.id); p = pp && pp.parent; } // can't drop into own descendant
    f.list.splice(f.i, 1); const r2 = find(doc, refId);
    if (pos === 'in' && r2.L.type === 'group') r2.L.children.push(f.L); else r2.list.splice(r2.i + (pos === 'before' ? 1 : 0), 0, f.L); // list is bottom→top; panel shows top first
    dirty(doc);
  }
  function groupLayers(doc, ids) {
    ids = ids.filter(id => find(doc, id)); if (!ids.length) return null; const first = find(doc, ids[0]); const G = mkLayer(doc, 'group', { name: 'Group' });
    const items = ids.map(id => find(doc, id)).filter(f => f.list === first.list).sort((a, b) => a.i - b.i);
    const at = items[items.length - 1].i; first.list.splice(at + 1, 0, G); items.slice().reverse().forEach(f => f.list.splice(f.list.indexOf(f.L), 1)); G.children = items.map(f => f.L);
    doc.activeId = G.id; doc.multi = []; dirty(doc); return G;
  }
  function ungroup(doc, id) { const f = find(doc, id); if (!f || f.L.type !== 'group') return; f.list.splice(f.i, 1, ...f.L.children); doc.activeId = f.L.children.length ? f.L.children[f.L.children.length - 1].id : null; dirty(doc); }
  function rasterize(doc, L) {
    if (L.type === 'raster' || L.type === 'adjust') return L;
    const t = take(doc.w, doc.h); drawContent(t._ctx, L, doc); const c = clone(t); give(t);
    delete L.text; delete L.shape; delete L.tr; delete L.children; delete L._cache; L.type = 'raster'; L.canvas = c; L.x = L.y = 0; dirty(doc, L); return L;
  }
  function mergeDown(doc, id) {
    const f = find(doc, id); if (!f || f.i === 0) return null; const below = f.list[f.i - 1]; if (below.type === 'adjust') return null;
    const both = [below, f.L], merged = renderLayers(doc, both.map(l => Object.assign(Object.create(Object.getPrototypeOf(l)), l, { visible: true })));
    const R = mkLayer(doc, 'raster', { name: below.name }); R.canvas = merged; R.opacity = 100; f.list.splice(f.i - 1, 2, R); doc.activeId = R.id; dirty(doc); return R;
  }
  function flattenImage(doc) { const R = mkLayer(doc, 'raster', { name: 'Background' }); R.canvas = flatten(doc); doc.layers = [R]; doc.activeId = R.id; dirty(doc); return R; }
  function mergeVisible(doc) { const R = mkLayer(doc, 'raster', { name: 'Merged' }); R.canvas = flatten(doc); doc.layers = doc.layers.filter(l => !l.visible); doc.layers.push(R); doc.activeId = R.id; dirty(doc); return R; }
  function addMask(doc, L, fromSel) {
    const m = newCanvas(doc.w, doc.h), c = m.getContext('2d');
    if (fromSel && doc.sel) c.drawImage(doc.sel, -L.x, -L.y); else { c.fillStyle = '#fff'; c.fillRect(0, 0, doc.w, doc.h); }
    L.mask = { canvas: m, on: true, density: 100, v: 0 }; doc.target = 'mask'; dirty(doc, L);
  }
  function applyMask(doc, L) { if (!L.mask) return; if (L.type !== 'raster') rasterize(doc, L); const c = L.canvas.getContext('2d'); c.globalCompositeOperation = 'destination-in'; c.drawImage(L.mask.canvas, 0, 0); c.globalCompositeOperation = 'source-over'; L.mask = null; doc.target = 'layer'; dirty(doc, L); }

  /* ---------- whole-image operations ---------- */
  function forEachRaster(doc, fn) { walk(doc.layers, L => { if (L.canvas) fn(L, 'canvas'); if (L.mask) fn(L.mask, 'mask', L); }); }
  function crop(doc, r) {
    r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    walk(doc.layers, L => {
      if (L.canvas) { const n = newCanvas(r.w, r.h); n.getContext('2d').drawImage(L.canvas, L.x - r.x, L.y - r.y); if (L.mask) { const m = newCanvas(r.w, r.h); m.getContext('2d').drawImage(L.mask.canvas, L.x - r.x, L.y - r.y); L.mask.canvas = m; } L.canvas = n; L.x = L.y = 0; }
      else if (L.mask) { const m = newCanvas(r.w, r.h); m.getContext('2d').drawImage(L.mask.canvas, -r.x, -r.y); L.mask.canvas = m; }
      if (L.tr) { L.tr.x -= r.x; L.tr.y -= r.y; } L.v++;
    });
    doc.w = r.w; doc.h = r.h; selNone(doc); dirty(doc);
  }
  function canvasSize(doc, w, h, ax, ay) { const dx = Math.round((w - doc.w) * ax), dy = Math.round((h - doc.h) * ay); crop(doc, { x: -dx, y: -dy, w, h }); }
  function resample(doc, w, h) {
    const kx = w / doc.w, ky = h / doc.h, rs = (c, x, y) => { const n = newCanvas(w, h), g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, x * kx, y * ky, c.width * kx, c.height * ky); return n; };
    walk(doc.layers, L => {
      if (L.canvas) { L.canvas = rs(L.canvas, L.x, L.y); if (L.mask) L.mask.canvas = rs(L.mask.canvas, L.x, L.y); L.x = L.y = 0; }
      else if (L.mask) L.mask.canvas = rs(L.mask.canvas, 0, 0);
      if (L.tr) { L.tr.x *= kx; L.tr.y *= ky; L.tr.sx *= kx; L.tr.sy *= ky; } L.v++;
    });
    doc.w = w; doc.h = h; selNone(doc); dirty(doc);
  }
  function rotateCanvas(doc, deg) { // 90 | -90 | 180, or 'h' / 'v' flips
    const W = doc.w, H = doc.h, swap = Math.abs(deg) === 90, nw = swap ? H : W, nh = swap ? W : H;
    const xf = (c, x, y) => { const n = newCanvas(nw, nh), g = n.getContext('2d'); g.translate(nw / 2, nh / 2); if (deg === 'h') g.scale(-1, 1); else if (deg === 'v') g.scale(1, -1); else g.rotate(deg * Math.PI / 180); g.drawImage(c, x - W / 2, y - H / 2); return n; };
    const pt = (x, y) => { const dx = x - W / 2, dy = y - H / 2; if (deg === 'h') return [nw / 2 - dx, nh / 2 + dy]; if (deg === 'v') return [nw / 2 + dx, nh / 2 - dy]; const a = deg * Math.PI / 180; return [nw / 2 + dx * Math.cos(a) - dy * Math.sin(a), nh / 2 + dx * Math.sin(a) + dy * Math.cos(a)]; };
    walk(doc.layers, L => {
      if (L.canvas) { L.canvas = xf(L.canvas, L.x, L.y); if (L.mask) L.mask.canvas = xf(L.mask.canvas, L.x, L.y); L.x = L.y = 0; }
      else if (L.mask) L.mask.canvas = xf(L.mask.canvas, 0, 0);
      if (L.tr) { [L.tr.x, L.tr.y] = pt(L.tr.x, L.tr.y); if (deg === 'h') L.tr.sx *= -1; else if (deg === 'v') L.tr.sy *= -1; else L.tr.rot += deg; } L.v++;
    });
    doc.w = nw; doc.h = nh; selNone(doc); dirty(doc);
  }

  /* ---------- history (copy-on-write snapshots) ---------- */
  const HIST_LIMIT_BYTES = 768e6;
  const metaOf = doc => JSON.stringify(doc.layers, (k, v) => k === 'canvas' || k[0] === '_' ? undefined : v);
  function snap(doc, label) {
    const rasters = {}, masks = {};
    walk(doc.layers, L => {
      if (L.canvas) { if (L._snapV !== L.v || !L._snap || L._snap.width !== L.canvas.width) { L._snap = clone(L.canvas); L._snapV = L.v; } rasters[L.id] = L._snap; }
      if (L.mask) { if (L.mask._snapV !== L.v || !L.mask._snap) { L.mask._snap = clone(L.mask.canvas); L.mask._snapV = L.v; } masks[L.id] = L.mask._snap; }
    });
    if (doc.sel && (doc._selSnapV !== doc.selV || !doc._selSnap)) { doc._selSnap = clone(doc.sel); doc._selSnapV = doc.selV; }
    return { label, meta: metaOf(doc), rasters, masks, sel: doc.sel ? doc._selSnap : null, w: doc.w, h: doc.h, activeId: doc.activeId, time: Date.now() };
  }
  function histBytes(doc) { const seen = new Set(); let b = 0; for (const s of doc.hist) for (const c of [...Object.values(s.rasters), ...Object.values(s.masks), s.sel]) if (c && !seen.has(c)) { seen.add(c); b += c.width * c.height * 4; } return b; }
  function push(doc, label) {
    doc.hist.length = doc.histI + 1; doc.hist.push(snap(doc, label)); doc.histI = doc.hist.length - 1;
    while (doc.hist.length > 3 && (doc.hist.length > 100 || histBytes(doc) > HIST_LIMIT_BYTES)) { doc.hist.shift(); doc.histI--; }
    listeners.forEach(f => f(doc, 'hist'));
  }
  function restore(doc, s) {
    doc.layers = JSON.parse(s.meta); doc.w = s.w; doc.h = s.h;
    walk(doc.layers, L => {
      if (s.rasters[L.id]) { L.canvas = clone(s.rasters[L.id]); L._snap = s.rasters[L.id]; L._snapV = L.v; }
      if (L.mask && s.masks[L.id]) { L.mask.canvas = clone(s.masks[L.id]); L.mask._snap = s.masks[L.id]; L.mask._snapV = L.v; }
    });
    doc.sel = s.sel ? clone(s.sel) : null; doc.selV++; doc._selBounds = null; doc._selSnap = s.sel; doc._selSnapV = doc.selV;
    doc.activeId = s.activeId; if (doc.target === 'mask') { const a = active(doc); if (!a || !a.mask) doc.target = 'layer'; }
    dirty(doc);
  }
  function jump(doc, i) { if (i < 0 || i >= doc.hist.length || i === doc.histI) return; doc.histI = i; restore(doc, doc.hist[i]); listeners.forEach(f => f(doc, 'hist')); }
  const undo = doc => jump(doc, doc.histI - 1), redo = doc => jump(doc, doc.histI + 1);

  /* ---------- serialization (native .nxi, also embedded in .nexora projects) ---------- */
  const toPNG = c => c.toDataURL('image/png');
  async function toJSON(doc) {
    const layers = JSON.parse(metaOf(doc)), byId = {}; walk(doc.layers, L => byId[L.id] = L);
    walk(layers, L => { const src = byId[L.id]; if (src.canvas) L.png = toPNG(src.canvas); if (src.mask) L.mask.png = toPNG(src.mask.canvas); });
    return { format: 'nexora-image', version: 1, id: doc.id, name: doc.name, w: doc.w, h: doc.h, rev: doc.rev, activeId: doc.activeId, fg: doc.fg, bg: doc.bg, layers };
  }
  const loadImg = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image data')); i.src = url; });
  async function fromJSON(o) {
    if (o.format !== 'nexora-image') throw new Error('Not a NEXORA Image document');
    if (o.version > 1) throw new Error('Image document version ' + o.version + ' is newer than this app');
    const doc = newDoc({ name: o.name, w: o.w, h: o.h }); Object.assign(doc, { id: o.id || doc.id, rev: o.rev || 0, activeId: o.activeId, fg: o.fg || '#ffffff', bg: o.bg || '#000000' });
    doc.layers = o.layers; const jobs = [];
    walk(doc.layers, L => {
      L.fx = Object.assign(FXDEF(), L.fx || {});
      if (L.png !== undefined) { const c = newCanvas(o.w, o.h); L.canvas = c; jobs.push(loadImg(L.png).then(i => c.getContext('2d').drawImage(i, 0, 0))); delete L.png; }
      if (L.mask && L.mask.png) { const c = newCanvas(o.w, o.h); L.mask.canvas = c; jobs.push(loadImg(L.mask.png).then(i => c.getContext('2d').drawImage(i, 0, 0))); delete L.mask.png; }
    });
    await Promise.all(jobs); dirty(doc); doc.hist = []; doc.histI = -1; push(doc, 'Open'); return doc;
  }
  function docFromImage(img, name) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, doc = newDoc({ name, w, h });
    const L = mkLayer(doc, 'raster', { name: 'Background' }); L.canvas.getContext('2d').drawImage(img, 0, 0); doc.layers.push(L); doc.activeId = L.id; push(doc, 'Open image'); return doc;
  }

  /** a layer's own pixels as a new doc-sized canvas: content + layer effects, no mask / opacity / blend (PSD export) */
  function layerPixels(doc, L) {
    const c = newCanvas(doc.w, doc.h), x = c.getContext('2d', { willReadFrequently: true }), t = take(doc.w, doc.h); drawContent(t._ctx, L, doc);
    if (hasFx(L)) { const e = applyEffects(t, L, doc); x.drawImage(e, 0, 0); give(e); } else x.drawImage(t, 0, 0); give(t); return c;
  }
  return {
    layerPixels, compStats: S_, take, give, newCanvas, clone, ctxOf, FXDEF, TEXTDEF, SHAPEDEF, mkLayer, newDoc, walk, find, active, insert, countLayers, dirty, listeners,
    textCanvas, shapeCanvas, vectorCanvas, vecMatrix, tracePath, meshDraw, quadMap, gridMap, drawFloat, drawContent, layerImage, render, renderLayers, flatten, thumbURL, layerThumb, maskThumb,
    selCombine, selFromPath, selFromMask, selBounds, selAll, selNone, selInvert, selFeather, selGrow, selFromLayerAlpha, selLocal, commitMasked,
    contentBounds, duplicate, remove, moveBy, moveTo, groupLayers, ungroup, rasterize, mergeDown, flattenImage, mergeVisible, addMask, applyMask, forEachRaster,
    crop, canvasSize, resample, rotateCanvas, push, undo, redo, jump, histBytes, toJSON, fromJSON, docFromImage, hasFx, fxOf, ui: null
  };
})();
