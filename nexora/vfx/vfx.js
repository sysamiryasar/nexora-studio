'use strict';
/* ====================== NEXORA VFX — node graph model + render engine ======================
   graph = { id, name, w, h, fps, dur, nodes: { id: { id, type, x, y, p } }, links: [{ from, to, port }], rev }
   Every node output is a W×H canvas (or null). Evaluation pulls from the Output node, memoises each node once
   per frame, detects cycles, and recycles intermediate surfaces from a pool. Group nodes hold a sub-graph whose
   'Group In' / 'Group Out' nodes connect to the outer graph. Video inputs are seeked asynchronously
   (prepare) before frame-accurate renders. */
const VFX = (() => {
  const S = { graphs: {}, order: [], active: null, epoch: 0 };
  /* ---------- surface pool ---------- */
  const pool = []; let leased = [], depth = 0;
  function alloc(W, H) {
    let i = pool.findIndex(c => c.width === W && c.height === H); const c = i >= 0 ? pool.splice(i, 1)[0] : Object.assign(document.createElement('canvas'), { width: W, height: H });
    if (!c._ctx) c._ctx = c.getContext('2d', { willReadFrequently: true }); const x = c._ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, W, H); leased.push(c); return c;
  }
  const releaseAll = () => { pool.push(...leased); leased = []; if (pool.length > 40) pool.splice(0, pool.length - 40); };
  const N = (k, label, min, max, def, step) => ({ k, label, type: 'num', min, max, def, step: step || 1 });
  const Cc = (k, label, def) => ({ k, label, type: 'color', def });
  const Sl = (k, label, opts, def, names) => ({ k, label, type: 'sel', opts, def, names });
  const Ck = (k, label, def) => ({ k, label, type: 'check', def });
  const fitDraw = (x, src, sw, sh, W, H, fit) => { let w = W, h = H; if (fit === 'fit' || fit === 'fill') { const k = fit === 'fit' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh); w = sw * k; h = sh * k; } else if (fit === 'none') { w = sw; h = sh; } x.drawImage(src, (W - w) / 2, (H - h) / 2, w, h); };
  const pixels = (c, fn) => { const id = c._ctx.getImageData(0, 0, c.width, c.height); fn(id.data, c.width, c.height); c._ctx.putImageData(id, 0, 0); };
  const ADJ_TYPES = ['brightness', 'exposure', 'hsl', 'vibrance', 'levels', 'photo', 'bw', 'invert', 'threshold', 'posterize'];
  const els = new Map(); // media node id -> video element
  function videoFor(n) {
    const m = media[n.p.media]; if (!m || m.kind !== 'video') return null; let v = els.get(n.id);
    if (!v || v._src !== m.url) { v = document.createElement('video'); if (corsUrl(m.url)) v.crossOrigin = 'anonymous'; v.src = m.url; v._src = m.url; v.muted = true; v.preload = 'auto'; v.playsInline = true; v.addEventListener('seeked', () => { S.epoch++; requestRender(); if (VFX.ui) VFX.ui.redraw(); }); v.addEventListener('loadeddata', () => { S.epoch++; if (VFX.ui) VFX.ui.redraw(); }); els.set(n.id, v); }
    return v;
  }
  const srcTime = (n, t) => { const m = media[n.p.media]; return clamp((t - n.p.start) * n.p.speed + n.p.offset, 0, Math.max(0, (m ? m.dur : 1) - .001)); };
  const rotoPts = (p, t) => { const k = p.keys; if (!k || !k.length) return []; if (t <= k[0].t) return k[0].pts; if (t >= k[k.length - 1].t) return k[k.length - 1].pts; for (let i = 0; i < k.length - 1; i++) if (t < k[i + 1].t) { const a = k[i], b = k[i + 1], u = EASE.inout((t - a.t) / (b.t - a.t)); return a.pts.map((q, j) => { const r = b.pts[j] || q; return [lerp(q[0], r[0], u), lerp(q[1], r[1], u)]; }); } return k[k.length - 1].pts; };
  function smoothPath(x, pts) { const n = pts.length; if (n < 3) return; x.moveTo(pts[0][0], pts[0][1]); for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]; x.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]); } x.closePath(); }
  function trackAt(p, t, fps) { const tr = p.track; if (!tr) return null; const f = Math.round(t * fps), keys = Object.keys(tr).map(Number).sort((a, b) => a - b); if (!keys.length) return null; if (tr[f]) return tr[f]; const k = f < keys[0] ? keys[0] : keys[keys.length - 1]; for (let i = 0; i < keys.length - 1; i++) if (f > keys[i] && f < keys[i + 1]) { const a = tr[keys[i]], b = tr[keys[i + 1]], u = (f - keys[i]) / (keys[i + 1] - keys[i]); return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)]; } return tr[k]; }

  /* ---------- node library ---------- */
  const DEFS = {
    media: { name: 'Media In', cat: 'Input', inputs: [], params: [{ k: 'media', label: 'Asset', type: 'media', def: '' }, Sl('fit', 'Fit', ['fit', 'fill', 'stretch', 'none'], 'fit'), N('start', 'Start at (s)', -60, 600, 0, .01), N('offset', 'Source in (s)', 0, 3600, 0, .01), N('speed', 'Speed', .1, 8, 1, .05)],
      render(x) { const n = x.n, m = media[n.p.media]; if (!m) return null; const c = x.alloc(); let src = null, sw = m.w, sh = m.h;
        if (m.missing && typeof Disk !== 'undefined') { src = Disk.offlineCard(m); sw = src.width; sh = src.height; } else if (m.kind === 'image') src = m.img; else if (m.kind === 'video') { const v = videoFor(n); if (v && v.readyState >= 2) { src = v; sw = v.videoWidth; sh = v.videoHeight; } }
        if (!src || !sw) return c; fitDraw(c._ctx, src, sw, sh, x.W, x.H, n.p.fit); return c; } },
    comp: { name: 'Motion Comp', cat: 'Input', inputs: [], params: [{ k: 'comp', label: 'Composition', type: 'comp', def: '' }, Sl('fit', 'Fit', ['fit', 'fill', 'stretch'], 'fit'), N('offset', 'Time offset (s)', -60, 600, 0, .01)],
      render(x) { const comp = typeof Motion !== 'undefined' && Motion.getComp(x.n.p.comp); if (!comp || x.depth > 4) return null; const full = alloc(comp.w, comp.h), f = full._ctx; if (comp.bg !== 'transparent') { f.fillStyle = comp.bg; f.fillRect(0, 0, comp.w, comp.h); } renderLayers(f, x.t + x.n.p.offset, comp.layers, comp); const c = x.alloc(); fitDraw(c._ctx, full, comp.w, comp.h, x.W, x.H, x.n.p.fit); return c; } },
    solid: { name: 'Solid Color', cat: 'Generate', inputs: [], params: [Cc('color', 'Color', '#1b1b2e')], render(x) { const c = x.alloc(); c._ctx.fillStyle = x.n.p.color; c._ctx.fillRect(0, 0, x.W, x.H); return c; } },
    gradient: { name: 'Gradient', cat: 'Generate', inputs: [], params: [Sl('kind', 'Type', ['linear', 'radial'], 'linear'), Cc('c1', 'Color 1', '#8b5cf6'), Cc('c2', 'Color 2', '#05050a'), N('angle', 'Angle', 0, 360, 90)],
      render(x) { const c = x.alloc(), g2 = c._ctx, p = x.n.p, W = x.W, H = x.H; let gr; if (p.kind === 'radial') gr = g2.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2); else { const a = p.angle * Math.PI / 180, dx = Math.cos(a) * W / 2, dy = Math.sin(a) * H / 2; gr = g2.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy); } gr.addColorStop(0, p.c1); gr.addColorStop(1, p.c2); g2.fillStyle = gr; g2.fillRect(0, 0, W, H); return c; } },
    background: { name: 'Animated Background', cat: 'Generate', inputs: [], params: [Sl('kind', 'Kind', ['aurora', 'grid', 'waves', 'bokeh', 'sweep', 'stripes'], 'aurora'), Cc('c1', 'Color 1', '#8b5cf6'), Cc('c2', 'Color 2', '#3b9bff'), Cc('c3', 'Base', '#05050a'), N('speed', 'Speed', 0, 8, 1, .1), N('scale', 'Scale', .2, 5, 1, .1)],
      render(x) { const n = x.n, fake = n._fake || (n._fake = { start: 0 }); fake.gen = n.p; const r = Motion.genCanvas(fake, x.t, x.W, x.H), c = x.alloc(); c._ctx.drawImage(r.src, 0, 0); return c; } },
    particles: { name: 'Particles', cat: 'Generate', inputs: [], params: [Sl('kind', 'Kind', ['snow', 'confetti', 'sparkle', 'bubbles', 'hearts', 'embers'], 'embers'), N('count', 'Count', 1, 800, 160), N('size', 'Size', 1, 80, 12), N('speed', 'Speed', 0, 8, 1, .1), Cc('c1', 'Color 1', '#3b9bff'), Cc('c2', 'Color 2', '#8b5cf6'), N('seed', 'Seed', 1, 9999, 1)],
      render(x) { const n = x.n, fake = n._fake || (n._fake = { start: 0 }); fake.part = n.p; const prev = RS; RS = { w: x.W, h: x.H }; try { const r = particleCanvas(fake, x.t), c = x.alloc(); c._ctx.drawImage(r.src, 0, 0); return c; } finally { RS = prev; } } },
    text: { name: 'Text', cat: 'Generate', inputs: [], params: [{ k: 'str', label: 'Text', type: 'text', def: 'NEXORA VFX' }, { k: 'font', label: 'Font', type: 'text', def: 'Segoe UI' }, N('size', 'Size', 6, 600, 140), Cc('color', 'Color', '#ffffff'), N('x', 'X %', -50, 150, 50, .5), N('y', 'Y %', -50, 150, 50, .5), Sl('anim', 'Animator', ['none', 'fade', 'slide-up', 'pop', 'blur', 'tracking', 'wave', 'flicker'], 'none')],
      render(x) { const n = x.n, p = n.p, fake = n._fake || (n._fake = { start: 0, dur: 1e6, text: {} }); Object.assign(fake.text, { str: p.str, font: p.font, size: p.size, weight: '800', italic: false, color: p.color, align: 'center', stroke: '#000', strokeW: 0, shadow: false, shColor: '#000', shBlur: 0, shX: 0, shY: 0, bgOn: false, bg: '#000', bgPad: 0, lineH: 1.15, spacing: 0, typeOn: 0, anim: { preset: p.anim, by: 'char', stagger: .05, dur: .6, out: false, ease: 'out' } }); fake.dur = g_dur(x);
        const r = textCanvas(fake, x.t), c = x.alloc(); c._ctx.drawImage(r.src, x.W * p.x / 100 - r.w / 2, x.H * p.y / 100 - r.h / 2); return c; } },
    transform: { name: 'Transform', cat: 'Transform', inputs: ['In'], params: [N('x', 'Offset X', -4000, 4000, 0), N('y', 'Offset Y', -4000, 4000, 0), N('scale', 'Scale %', 1, 1000, 100, .5), N('rot', 'Rotation', -360, 360, 0, .5), N('op', 'Opacity %', 0, 100, 100), Ck('flip', 'Flip horizontal', false)],
      render(x) { const i = x.ins[0]; if (!i) return null; const c = x.alloc(), g2 = c._ctx, p = x.n.p; g2.globalAlpha = p.op / 100; g2.translate(x.W / 2 + p.x, x.H / 2 + p.y); g2.rotate(p.rot * Math.PI / 180); g2.scale(p.scale / 100 * (p.flip ? -1 : 1), p.scale / 100); g2.drawImage(i, -x.W / 2, -x.H / 2); return c; } },
    color: { name: 'Color Correct', cat: 'Color', inputs: ['In'], params: [Sl('adj', 'Operation', ADJ_TYPES, 'hsl', k => ADJ.defs[k].name), { k: 'ap', label: 'Settings', type: 'adj' }, N('mix', 'Mix %', 0, 100, 100)],
      render(x) { const i = x.ins[0]; if (!i) return null; const c = x.alloc(), p = x.n.p; c._ctx.drawImage(i, 0, 0); if (!p.ap || p.ap._t !== p.adj) p.ap = Object.assign(ADJ.defs[p.adj].p(), { _t: p.adj }); pixels(c, d => ADJ.apply(d, p.adj, p.ap, p.mix / 100)); return c; } },
    blur: { name: 'Blur', cat: 'Filter', inputs: ['In'], params: [N('r', 'Radius', 0, 200, 8, .5)], render(x) { const i = x.ins[0]; if (!i) return null; const c = x.alloc(); if (x.n.p.r > 0) c._ctx.filter = `blur(${x.n.p.r}px)`; c._ctx.drawImage(i, 0, 0); c._ctx.filter = 'none'; return c; } },
    glow: { name: 'Glow', cat: 'Filter', inputs: ['In'], params: [N('r', 'Radius', 1, 200, 24), N('amount', 'Intensity %', 0, 300, 90), N('threshold', 'Threshold', 0, 255, 120)],
      render(x) { const i = x.ins[0]; if (!i) return null; const p = x.n.p, hi = x.alloc(); hi._ctx.drawImage(i, 0, 0); pixels(hi, d => { for (let k = 0; k < d.length; k += 4) { const l = d[k] * .299 + d[k + 1] * .587 + d[k + 2] * .114; if (l < p.threshold) d[k + 3] = 0; } }); const c = x.alloc(), g2 = c._ctx; g2.drawImage(i, 0, 0); g2.globalCompositeOperation = 'lighter'; g2.filter = `blur(${p.r}px)`; let a = p.amount / 100; while (a > 0) { g2.globalAlpha = Math.min(1, a); g2.drawImage(hi, 0, 0); a -= 1; } g2.filter = 'none'; return c; } },
    mask: { name: 'Mask', cat: 'Matte', inputs: ['In', 'Mask (optional)'], params: [Sl('shape', 'Shape', ['none', 'rect', 'ellipse'], 'ellipse'), N('cx', 'Center X %', -50, 150, 50, .5), N('cy', 'Center Y %', -50, 150, 50, .5), N('w', 'Width %', 0, 200, 60, .5), N('h', 'Height %', 0, 200, 60, .5), N('feather', 'Feather', 0, 300, 20), Sl('source', 'Mask input uses', ['alpha', 'luma'], 'alpha'), Ck('invert', 'Invert', false)],
      render(x) { const i = x.ins[0]; if (!i) return null; const p = x.n.p, m = x.alloc(), mc = m._ctx; if (p.shape === 'none') { mc.fillStyle = '#fff'; mc.fillRect(0, 0, x.W, x.H); } else { if (p.feather > 0) mc.filter = `blur(${p.feather}px)`; mc.fillStyle = '#fff'; mc.beginPath(); const cx = x.W * p.cx / 100, cy = x.H * p.cy / 100, w = x.W * p.w / 100, h = x.H * p.h / 100; if (p.shape === 'ellipse') mc.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); else mc.rect(cx - w / 2, cy - h / 2, w, h); mc.fill(); mc.filter = 'none'; }
        const mi = x.ins[1]; if (mi) { if (p.source === 'luma') { const l = x.alloc(); l._ctx.drawImage(mi, 0, 0); pixels(l, d => { for (let k = 0; k < d.length; k += 4) { d[k + 3] = (d[k] * .299 + d[k + 1] * .587 + d[k + 2] * .114) * d[k + 3] / 255; } }); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(l, 0, 0); } else { mc.globalCompositeOperation = 'destination-in'; mc.drawImage(mi, 0, 0); } mc.globalCompositeOperation = 'source-over'; }
        const c = x.alloc(), g2 = c._ctx; g2.drawImage(i, 0, 0); g2.globalCompositeOperation = p.invert ? 'destination-out' : 'destination-in'; g2.drawImage(m, 0, 0); return c; } },
    roto: { name: 'Roto (animated shape)', cat: 'Matte', inputs: ['In'], params: [N('feather', 'Feather', 0, 200, 4), Ck('invert', 'Invert', false), Ck('matte', 'Output matte only', false), Ck('smooth', 'Smooth curve', true), { k: 'keys', label: 'Shape keys', type: 'roto', def: [] }],
      render(x) { const p = x.n.p, pts = rotoPts(p, x.t), m = x.alloc(), mc = m._ctx; if (pts.length >= 3) { if (p.feather > 0) mc.filter = `blur(${p.feather}px)`; mc.fillStyle = '#fff'; mc.beginPath(); if (p.smooth) smoothPath(mc, pts); else { pts.forEach((q, j) => j ? mc.lineTo(q[0], q[1]) : mc.moveTo(q[0], q[1])); mc.closePath(); } mc.fill(); mc.filter = 'none'; }
        if (p.matte) { if (p.invert) { const c = x.alloc(); c._ctx.fillStyle = '#fff'; c._ctx.fillRect(0, 0, x.W, x.H); c._ctx.globalCompositeOperation = 'destination-out'; c._ctx.drawImage(m, 0, 0); return c; } return m; }
        const i = x.ins[0]; if (!i) return null; if (pts.length < 3) return p.invert ? i : x.alloc(); const c = x.alloc(), g2 = c._ctx; g2.drawImage(i, 0, 0); g2.globalCompositeOperation = p.invert ? 'destination-out' : 'destination-in'; g2.drawImage(m, 0, 0); return c; } },
    merge: { name: 'Merge', cat: 'Composite', inputs: ['Background', 'Foreground'], params: [Sl('blend', 'Blend mode', BLENDS, 'source-over', blendName), N('op', 'Opacity %', 0, 100, 100)],
      render(x) { const [b, f] = x.ins; if (!b && !f) return null; const c = x.alloc(), g2 = c._ctx; if (b) g2.drawImage(b, 0, 0); if (f) { g2.globalAlpha = x.n.p.op / 100; g2.globalCompositeOperation = x.n.p.blend; g2.drawImage(f, 0, 0); } return c; } },
    keyer: { name: 'Chroma Keyer', cat: 'Matte', inputs: ['In'], params: [Cc('key', 'Key color', '#00ff00'), N('tol', 'Tolerance %', 0, 100, 30), N('soft', 'Softness %', 0, 100, 15), N('spill', 'Spill suppression %', 0, 100, 60), Ck('matte', 'Show matte', false)],
      render(x) { const i = x.ins[0]; if (!i) return null; const p = x.n.p, c = x.alloc(); c._ctx.drawImage(i, 0, 0); const [kr, kg, kb] = hexToRgb(p.key), tol = p.tol * 4.41, soft = Math.max(1, p.soft * 4.41), dom = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0, sp = p.spill / 100;
        pixels(c, d => { for (let k = 0; k < d.length; k += 4) { const dr = d[k] - kr, dg = d[k + 1] - kg, db = d[k + 2] - kb, dist = Math.sqrt(dr * dr + dg * dg + db * db); let a = dist < tol ? 0 : dist < tol + soft ? (dist - tol) / soft : 1; d[k + 3] *= a;
          if (sp) { const o1 = d[k + (dom + 1) % 3], o2 = d[k + (dom + 2) % 3], lim = Math.max(o1, o2); if (d[k + dom] > lim) d[k + dom] -= (d[k + dom] - lim) * sp; }
          if (p.matte) { d[k] = d[k + 1] = d[k + 2] = d[k + 3]; d[k + 3] = 255; } } }); return c; } },
    tracker: { name: 'Tracker (match-move)', cat: 'Transform', inputs: ['Background (tracked)', 'Foreground'], params: [Sl('mode', 'Mode', ['match', 'stabilize'], 'match', v => v === 'match' ? 'Match-move foreground' : 'Stabilize background'), N('px', 'Point X', 0, 8000, 960), N('py', 'Point Y', 0, 8000, 540), N('t0', 'Reference time (s)', 0, 600, 0, .01), N('patch', 'Patch size', 6, 80, 16), N('search', 'Search range', 4, 120, 28), { k: 'track', label: 'Track data', type: 'track' }],
      render(x) { const [b, f] = x.ins, p = x.n.p, fps = x.g.fps, pos = trackAt(p, x.t, fps), ref = trackAt(p, p.t0, fps) || [p.px, p.py], dx = pos ? pos[0] - ref[0] : 0, dy = pos ? pos[1] - ref[1] : 0, c = x.alloc(), g2 = c._ctx;
        if (p.mode === 'stabilize') { if (b) g2.drawImage(b, -dx, -dy); if (f) g2.drawImage(f, 0, 0); } else { if (b) g2.drawImage(b, 0, 0); if (f) g2.drawImage(f, dx, dy); } return c; } },
    displace: { name: 'Displace', cat: 'Filter', inputs: ['In', 'Displacement map'], params: [N('ax', 'Amount X', -400, 400, 30), N('ay', 'Amount Y', -400, 400, 30)],
      render(x) { const [i, m] = x.ins; if (!i) return null; if (!m) return i; const p = x.n.p, W = x.W, H = x.H, c = x.alloc(), src = i._ctx.getImageData(0, 0, W, H).data, md = m._ctx.getImageData(0, 0, W, H).data, out = c._ctx.createImageData(W, H), o = out.data;
        for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const k = (y * W + xx) * 4, l = (md[k] * .299 + md[k + 1] * .587 + md[k + 2] * .114) / 255 - .5, sx = Math.round(xx + l * 2 * p.ax), sy = Math.round(y + l * 2 * p.ay); if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue; const s = (sy * W + sx) * 4; o[k] = src[s]; o[k + 1] = src[s + 1]; o[k + 2] = src[s + 2]; o[k + 3] = src[s + 3]; }
        c._ctx.putImageData(out, 0, 0); return c; } },
    output: { name: 'Output', cat: 'Output', inputs: ['In'], params: [], render(x) { return x.ins[0] || null; } },
    group: { name: 'Group', cat: 'Group', inputs: n => Array.from({ length: n.p.nIn || 1 }, (_, i) => 'In ' + (i + 1)), params: [],
      render(x) { const sub = x.n.p.graph; if (!sub) return null; const gout = Object.values(sub.nodes).find(m => m.type === 'gout'); if (!gout) return null; return evalIn(Object.assign({}, sub, { w: x.W, h: x.H, fps: x.g.fps, dur: x.g.dur }), gout.id, x.t, x.ins, x.depth + 1); } },
    /* the timeline clip this graph is attached to (graph.host = layer id): its frame, before VFX, at clip time t */
    clip: { name: 'Timeline Clip', cat: 'Input', inputs: [], params: [Sl('fit', 'Fit', ['fit', 'fill', 'stretch', 'none'], 'stretch')],
      render(x) { const L = hostLayer(x.g); if (!L) return null; const C = contentOfBase(L, L.start + x.t); if (!C || !C.src) return null; const c = x.alloc(); fitDraw(c._ctx, C.src, C.w, C.h, x.W, x.H, x.n.p.fit); return c; } },
    gin: { name: 'Group In', cat: 'Group', inputs: [], params: [N('index', 'Input #', 1, 16, 1)], render(x) { return (x.groupIns || [])[x.n.p.index - 1] || null; } },
    gout: { name: 'Group Out', cat: 'Group', inputs: ['In'], params: [], render(x) { return x.ins[0] || null; } }
  };
  const g_dur = x => x.g.dur;
  /** the Edit-timeline layer a clip-attached graph belongs to (searches the main timeline and nested comps) */
  function hostLayer(g) {
    if (!g || !g.host) return null; let hit = null;
    const walk = ls => { for (const L of ls || []) { if (hit) return; if (L.id === g.host) { hit = L; return; } if (L.comp) walk(L.comp.layers); } };
    walk(typeof Motion !== 'undefined' ? Motion.editProject().layers : P.layers); if (!hit && typeof Motion !== 'undefined') Motion.list().forEach(c => walk(c.layers)); return hit;
  }
  const insOf = n => { const d = DEFS[n.type]; return typeof d.inputs === 'function' ? d.inputs(n) : d.inputs; };
  function defaults(type) { const p = {}; for (const q of DEFS[type].params) if (q.def !== undefined) p[q.k] = JSON.parse(JSON.stringify(q.def)); if (type === 'group') p.nIn = 1; return p; }
  function addNode(g, type, x, y, p) { const n = { id: uid(), type, x: x || 0, y: y || 0, p: Object.assign(defaults(type), p || {}) }; g.nodes[n.id] = n; touch(g); return n; }
  function connect(g, from, to, port) { if (from === to || reaches(g, to, from)) return false; g.links = g.links.filter(l => !(l.to === to && l.port === port)); g.links.push({ from, to, port }); touch(g); return true; }
  function reaches(g, a, b) { const seen = new Set(), st = [a]; while (st.length) { const id = st.pop(); if (id === b) return true; if (seen.has(id)) continue; seen.add(id); g.links.filter(l => l.from === id).forEach(l => st.push(l.to)); } return false; }
  function removeNode(g, id) { if (!g.nodes[id] || g.nodes[id].type === 'output' || g.nodes[id].type === 'gout') return; delete g.nodes[id]; g.links = g.links.filter(l => l.from !== id && l.to !== id); touch(g); }
  const touch = g => { g.rev = (g.rev || 0) + 1; };
  const outputOf = g => Object.values(g.nodes).find(n => n.type === 'output') || null;

  /* ---------- evaluation ---------- */
  function evalIn(g, targetId, t, groupIns, d) {
    const memo = new Map(), stack = new Set();
    const ev = id => {
      if (memo.has(id)) return memo.get(id); if (stack.has(id)) return null; const n = g.nodes[id]; if (!n) return null; stack.add(id);
      const ins = insOf(n).map((_, port) => { const l = g.links.find(l => l.to === id && l.port === port); return l ? ev(l.from) : null; });
      let out = null; try { out = DEFS[n.type].render({ n, ins, t, g, W: g.w, H: g.h, alloc: () => alloc(g.w, g.h), groupIns, depth: d || 0 }); } catch (e) { console.error('VFX node', n.type, e); }
      stack.delete(id); memo.set(id, out); return out;
    };
    return ev(targetId);
  }
  /** synchronous render of a graph (or one node of it) at time t → persistent canvas */
  function renderSync(g, t, nodeId) {
    const target = nodeId || (outputOf(g) || {}).id; if (!target) return null;
    const key = g.rev + '|' + target + '|' + t.toFixed(4) + '|' + S.epoch + '|' + (typeof Motion !== 'undefined' ? Motion.S.order.length : 0);
    if (!g._out || g._out.width !== g.w || g._out.height !== g.h) { g._out = document.createElement('canvas'); g._out.width = g.w; g._out.height = g.h; g._outKey = null; }
    if (g._outKey === key && !depth && !g.host) return g._out;   // clip-attached graphs follow live video frames: never cached
    depth++; let res; try { res = evalIn(g, target, t, null, 0); const o = g._out.getContext('2d'); o.clearRect(0, 0, g.w, g.h); if (res) o.drawImage(res, 0, 0); } finally { depth--; if (!depth) releaseAll(); }
    g._outKey = key; return g._out;
  }
  /** seek every video used by the graph (incl. groups and Motion comps) to time t */
  async function prepare(g, t) {
    const jobs = [];
    const walk = (gr, tt) => { for (const n of Object.values(gr.nodes)) {
      if (n.type === 'media') { const v = videoFor(n); if (v) jobs.push(seekEl(v, srcTime(n, tt))); }
      if (n.type === 'group' && n.p.graph) walk(n.p.graph, tt);
      if (n.type === 'comp' && typeof Motion !== 'undefined') { const c = Motion.getComp(n.p.comp); if (c) collectMedia(c.layers, tt + n.p.offset, []).filter(a => a.L.type === 'video').forEach(a => { const e = getEl(a.L); if (e) jobs.push(seekEl(e, a.L.srcIn + (a.t - a.L.start) * a.L.speed)); }); }
    } };
    walk(g, t);
    const H = hostLayer(g); if (H && H.type === 'video') { const e = getEl(H); if (e) jobs.push(seekEl(e, H.srcIn + t * H.speed)); }
    await Promise.all(jobs);
  }
  /** fire-and-forget seek used during interactive preview */
  function ensure(g, t) { const walk = gr => { for (const n of Object.values(gr.nodes)) { if (n.type === 'media') { const v = videoFor(n); if (v) { const s = srcTime(n, t); if (Math.abs(v.currentTime - s) > .02 && !v.seeking) v.currentTime = s; } } if (n.type === 'group' && n.p.graph) walk(n.p.graph); } }; walk(g);
    const H = hostLayer(g); if (H && H.type === 'video' && !playing) { const e = getEl(H); if (e) { const s = H.srcIn + t * H.speed; if (Math.abs(e.currentTime - s) > .02 && !e.seeking) { e.currentTime = s; e.addEventListener('seeked', () => { S.epoch++; if (VFX.ui) VFX.ui.redraw(); }, { once: true }); } } } }
  async function prepareLayers(layers, t) { for (const L of layers) { if (t < L.start || t >= L.start + L.dur) continue; if (L.type === 'vfx') { const g = S.graphs[L.graphRef]; if (g) await prepare(g, L.srcIn + (t - L.start) * L.speed); } if (L.fxGraph && S.graphs[L.fxGraph]) await prepare(S.graphs[L.fxGraph], t - L.start); } }

  /* ---------- graphs ---------- */
  function newGraph(o) {
    o = o || {}; const g = { id: uid(), name: o.name || 'Graph ' + (S.order.length + 1), w: o.w || 1280, h: o.h || 720, fps: o.fps || 30, dur: o.dur || 5, nodes: {}, links: [], rev: 0, hist: [], histI: -1 };
    if (!o.empty) { const bgN = addNode(g, 'background', 40, 60), tx = addNode(g, 'text', 40, 260, { anim: 'tracking' }), gl = addNode(g, 'glow', 330, 260), mg = addNode(g, 'merge', 600, 120), out = addNode(g, 'output', 860, 120); connect(g, tx.id, gl.id, 0); connect(g, bgN.id, mg.id, 0); connect(g, gl.id, mg.id, 1); connect(g, mg.id, out.id, 0); }
    else addNode(g, 'output', 600, 120);
    S.graphs[g.id] = g; S.order.push(g.id); S.active = g.id; return g;
  }
  const graph = id => S.graphs[id] || null;
  const list = () => S.order.map(id => S.graphs[id]).filter(Boolean);
  /** collapse selected nodes into a Group node (external inputs → Group In, the node feeding outside → Group Out) */
  function groupNodes(g, ids) {
    ids = ids.filter(id => g.nodes[id] && !['output', 'gout', 'gin'].includes(g.nodes[id].type)); if (ids.length < 1) return null;
    const inSet = new Set(ids), sub = { nodes: {}, links: [] }; let cx = 0, cy = 0; ids.forEach(id => { cx += g.nodes[id].x; cy += g.nodes[id].y; }); cx /= ids.length; cy /= ids.length;
    ids.forEach(id => { sub.nodes[id] = g.nodes[id]; });
    const inbound = g.links.filter(l => inSet.has(l.to) && !inSet.has(l.from)), outbound = g.links.filter(l => inSet.has(l.from) && !inSet.has(l.to)), internal = g.links.filter(l => inSet.has(l.from) && inSet.has(l.to));
    sub.links.push(...internal); const srcs = [...new Set(inbound.map(l => l.from))], minX = Math.min(...ids.map(id => g.nodes[id].x)), maxX = Math.max(...ids.map(id => g.nodes[id].x));
    srcs.forEach((s, i) => { const gi = { id: uid(), type: 'gin', x: minX - 220, y: cy + i * 110, p: { index: i + 1 } }; sub.nodes[gi.id] = gi; inbound.filter(l => l.from === s).forEach(l => sub.links.push({ from: gi.id, to: l.to, port: l.port })); });
    const feeder = outbound.length ? outbound[0].from : ids[ids.length - 1], go = { id: uid(), type: 'gout', x: maxX + 260, y: cy, p: {} }; sub.nodes[go.id] = go; sub.links.push({ from: feeder, to: go.id, port: 0 });
    const G2 = addNode(g, 'group', cx, cy, { nIn: Math.max(1, srcs.length), graph: sub, label: 'Group' });
    ids.forEach(id => delete g.nodes[id]); g.links = g.links.filter(l => !(inSet.has(l.from) || inSet.has(l.to)));
    srcs.forEach((s, i) => g.links.push({ from: s, to: G2.id, port: i })); outbound.filter(l => l.from === feeder).forEach(l => g.links.push({ from: G2.id, to: l.to, port: l.port }));
    touch(g); return G2;
  }
  function ungroup(g, id) {
    const G2 = g.nodes[id]; if (!G2 || G2.type !== 'group') return; const sub = G2.p.graph, gins = Object.values(sub.nodes).filter(n => n.type === 'gin'), gout = Object.values(sub.nodes).find(n => n.type === 'gout');
    for (const n of Object.values(sub.nodes)) if (n.type !== 'gin' && n.type !== 'gout') g.nodes[n.id] = n;
    sub.links.forEach(l => { const fromGin = gins.find(n => n.id === l.from); if (l.to === gout.id) return; if (fromGin) { const ext = g.links.find(x => x.to === id && x.port === fromGin.p.index - 1); if (ext) g.links.push({ from: ext.from, to: l.to, port: l.port }); } else g.links.push(l); });
    const feed = sub.links.find(l => l.to === gout.id); g.links.filter(l => l.from === id).forEach(l => { if (feed) g.links.push({ from: feed.from, to: l.to, port: l.port }); });
    g.links = g.links.filter(l => l.from !== id && l.to !== id); delete g.nodes[id]; touch(g);
  }

  /* ---------- tracking (template matching, same algorithm as Edit's tracker) ---------- */
  async function analyzeTrack(g, node, onProgress, isCancelled) {
    const p = node.p, inLink = g.links.find(l => l.to === node.id && l.port === 0); if (!inLink) throw new Error('Connect footage to the tracker\'s Background input first.');
    const fps = g.fps, f0 = Math.round(p.t0 * fps), f1 = Math.round(g.dur * fps) - 1, sc = Math.min(1, 640 / g.w), w = Math.round(g.w * sc), h = Math.round(g.h * sc), r = Math.max(4, Math.round(p.patch * sc)), R = Math.max(3, Math.round(p.search * sc)), n = 2 * r + 1;
    const small = Object.assign(document.createElement('canvas'), { width: w, height: h }), sx = small.getContext('2d', { willReadFrequently: true });
    const grab = async f => { const t = f / fps; await prepare(g, t); depth++; try { const c = evalIn(g, inLink.from, t, null, 0); sx.clearRect(0, 0, w, h); if (c) sx.drawImage(c, 0, 0, w, h); } finally { depth--; releaseAll(); } const d = sx.getImageData(0, 0, w, h).data, gr = new Float32Array(w * h); for (let i = 0, j = 0; i < d.length; i += 4, j++) gr[j] = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; return gr; };
    const patch = (gr, x, y) => { const o = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) o[j * n + i] = gr[clamp(y - r + j, 0, h - 1) * w + clamp(x - r + i, 0, w - 1)]; return o; };
    let pos = { x: Math.round(p.px * sc), y: Math.round(p.py * sc) }; const track = {}; let gr = await grab(f0), tpl = patch(gr, pos.x, pos.y); track[f0] = [p.px, p.py];
    for (let f = f0 + 1; f <= f1; f++) {
      if (isCancelled && isCancelled()) break; gr = await grab(f); let best = 1e18, bx = pos.x, by = pos.y;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x0 = pos.x + dx, y0 = pos.y + dy; if (x0 < r || y0 < r || x0 >= w - r || y0 >= h - r) continue; let s = 0; for (let j = 0; j < n && s < best; j++) { const row = (y0 - r + j) * w + x0 - r; for (let i = 0; i < n; i++) s += Math.abs(gr[row + i] - tpl[j * n + i]); } if (s < best) { best = s; bx = x0; by = y0; } }
      pos = { x: bx, y: by }; const np = patch(gr, bx, by); for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * .85 + np[i] * .15; track[f] = [bx / sc, by / sc]; if (onProgress) onProgress((f - f0) / Math.max(1, f1 - f0));
    }
    p.track = track; touch(g); return Object.keys(track).length;
  }

  /* ---------- export ---------- */
  function mediaNodes(g, out) { out = out || []; Object.values(g.nodes).forEach(n => { if (n.type === 'media' && n.p.media) out.push(n); if (n.type === 'group' && n.p.graph) mediaNodes(n.p.graph, out); }); return out; }
  async function graphAudio(g) {
    const SR = 48000, ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(g.dur * SR)), SR); let used = 0;
    for (const n of mediaNodes(g)) {
      const m = media[n.p.media]; if (!m || m.missing || !m.blob || (m.kind !== 'video' && m.kind !== 'audio')) continue;
      let ab; try { ab = await ctx.decodeAudioData(await (typeof Disk !== 'undefined' ? Disk.realBlob(m) : m.blob).arrayBuffer()); } catch (e) { continue; }
      const sp = n.p.speed || 1, st = n.p.start || 0, lead = Math.max(0, -st), src = ctx.createBufferSource(); src.buffer = ab; src.playbackRate.value = sp; src.connect(ctx.destination);
      const off = (n.p.offset || 0) + lead * sp; if (off >= ab.duration) continue; src.start(Math.max(0, st), off, Math.min(ab.duration - off, (g.dur - Math.max(0, st)) * sp)); used++;
    }
    return used ? ctx.startRendering() : null;
  }
  async function exportMP4(g, opts, onProgress, isCancelled) {
    if (!window.VideoEncoder || !window.Mp4Muxer) throw new Error('WebCodecs not available in this browser.');
    const W = g.w & ~1, H = g.h & ~1, fps = g.fps, n = Math.max(1, Math.round(g.dur * fps)); let cfg = null;
    for (const codec of ['avc1.640033', 'avc1.4d0033', 'avc1.42003e']) { const c = { codec, width: W, height: H, bitrate: (opts.mbps || 12) * 1e6, framerate: fps, avc: { format: 'avc' } }; try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (e) { } }
    if (!cfg) throw new Error('H.264 encoding is not available.');
    // audio: every Media In node with sound, placed at its Start / Source in / Speed (same timing as the picture)
    let mix = opts.audio === false ? null : await graphAudio(g), acodec = null;
    if (mix) { for (const c of ['mp4a.40.2', 'opus']) { try { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) { acodec = c; break; } } catch (e) { } } if (!acodec) mix = null; }
    const mux = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, audio: mix ? { codec: acodec === 'opus' ? 'opus' : 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined, fastStart: 'in-memory' }); let err = null;
    const enc = new VideoEncoder({ output: (ch, m) => mux.addVideoChunk(ch, m), error: e => err = e }); enc.configure(cfg);
    if (mix) {
      const ae = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: e => err = e }); ae.configure({ codec: acodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
      const c0 = mix.getChannelData(0), c1 = mix.getChannelData(1); for (let s = 0; s < mix.length; s += 4800) { const k = Math.min(4800, mix.length - s), b = new Float32Array(k * 2); b.set(c0.subarray(s, s + k), 0); b.set(c1.subarray(s, s + k), k); const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round(s / 48 * 1000), data: b }); ae.encode(ad); ad.close(); }
      await ae.flush(); ae.close();
    }
    const frame = Object.assign(document.createElement('canvas'), { width: W, height: H }), fx = frame.getContext('2d');
    for (let i = 0; i < n; i++) { if (isCancelled && isCancelled()) { enc.close(); return null; } if (err) throw err; const t = i / fps; await prepare(g, t); const c = renderSync(g, t); fx.fillStyle = '#000'; fx.fillRect(0, 0, W, H); fx.drawImage(c, 0, 0); const vf = new VideoFrame(frame, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) }); enc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close(); while (enc.encodeQueueSize > 10) await new Promise(r => setTimeout(r, 2)); if (onProgress && i % 3 === 0) { onProgress(i / n); await new Promise(r => setTimeout(r, 0)); } }
    await enc.flush(); enc.close(); mux.finalize(); return new Blob([mux.target.buffer], { type: 'video/mp4' });
  }

  /* ---------- serialization + usage ---------- */
  const clean = g => JSON.parse(JSON.stringify({ id: g.id, name: g.name, w: g.w, h: g.h, fps: g.fps, dur: g.dur, host: g.host || undefined, nodes: g.nodes, links: g.links, rev: g.rev }, (k, v) => k[0] === '_' ? undefined : v));
  const toJSON = () => ({ graphs: list().map(clean), active: S.active });
  function fromJSON(o) { reset(); if (!o || !Array.isArray(o.graphs)) return; o.graphs.forEach(g => { g.hist = []; g.histI = -1; S.graphs[g.id] = g; S.order.push(g.id); }); S.active = o.active && S.graphs[o.active] ? o.active : S.order[0] || null; }
  function reset() { S.graphs = {}; S.order = []; S.active = null; els.forEach(v => { v.pause(); v.removeAttribute('src'); }); els.clear(); }
  function usage() { const n = {}, walk = ls => ls.forEach(l => { if (l.graphRef) n[l.graphRef] = (n[l.graphRef] || 0) + 1; if (l.fxGraph) n[l.fxGraph] = (n[l.fxGraph] || 0) + 1; if (l.comp) walk(l.comp.layers); }); walk(Motion.editProject().layers); Motion.list().forEach(c => walk(c.layers)); return n; }
  function mediaRefs(g, out) { out = out || new Set(); Object.values(g.nodes).forEach(n => { if (n.type === 'media' && n.p.media) out.add(n.p.media); if (n.type === 'group' && n.p.graph) mediaRefs(n.p.graph, out); }); return out; }
  function thumb(g, size) { const c = renderSync(g, Math.min(g.dur * .5, 2)); const k = size / Math.max(g.w, g.h), t = Object.assign(document.createElement('canvas'), { width: Math.round(g.w * k), height: Math.round(g.h * k) }); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', .8); }
  /* ---------- per-graph undo ---------- */
  function snap(g, label) { g.hist = g.hist || []; g.hist.length = (g.histI ?? -1) + 1; g.hist.push({ label, json: JSON.stringify({ nodes: g.nodes, links: g.links, w: g.w, h: g.h, fps: g.fps, dur: g.dur, name: g.name }, (k, v) => k[0] === '_' ? undefined : v) }); if (g.hist.length > 120) g.hist.shift(); g.histI = g.hist.length - 1; }
  function jump(g, i) { if (!g.hist || i < 0 || i >= g.hist.length) return false; g.histI = i; Object.assign(g, JSON.parse(g.hist[i].json)); touch(g); return true; }
  /** add a point to an animated roto shape: it goes on the nearest edge of the shape at time t (exactly where clicked,
      keyed at t), and every other key gets a point at the same position along its own version of that edge, so the
      animation of the rest of the shape is unchanged */
  function rotoInsert(p, t, x, y, fps) {
    const cur = rotoPts(p, t), n = cur.length; if (n < 2) { (p.keys[0] || (p.keys[0] = { t, pts: [] })).pts.push([x, y]); return; }
    let best = 1e18, e = n - 1, u = .5;
    for (let i = 0; i < n; i++) { const a = cur[i], b = cur[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, s = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)), d = Math.hypot(a[0] + dx * s - x, a[1] + dy * s - y); if (d < best) { best = d; e = i; u = s; } }
    const at = p.keys.find(k => Math.abs(k.t - t) < .5 / (fps || 30));
    for (const k of p.keys) { const a = k.pts[e], b = k.pts[(e + 1) % k.pts.length]; if (!a || !b) continue; k.pts.splice(e + 1, 0, k === at ? [x, y] : [lerp(a[0], b[0], u), lerp(a[1], b[1], u)]); }
    if (!at) { const pts = cur.map(q => q.slice()); pts.splice(e + 1, 0, [x, y]); p.keys.push({ t, pts }); p.keys.sort((a, b) => a.t - b.t); }
  }
  return { rotoInsert, graphAudio, S, DEFS, hostLayer, insOf, addNode, connect, removeNode, newGraph, graph, list, renderSync, evalIn, prepare, ensure, prepareLayers, groupNodes, ungroup, analyzeTrack, exportMP4, toJSON, fromJSON, reset, usage, mediaRefs, thumb, snap, jump, touch, outputOf, rotoPts, trackAt, ui: null };
})();
