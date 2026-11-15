'use strict';
/* ====================== advanced features ======================
   motion tracking · keyframe graph editor · AI captions / background removal · offline MP4 export */
let trackArm = null;
const gid = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function seekEl(el, t) {
  return new Promise(res => {
    if (Math.abs(el.currentTime - t) < .0005 && el.readyState >= 2) return res();
    let done = false; const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); res(); };
    el.addEventListener('seeked', fin); el.currentTime = t; setTimeout(fin, 2500);
  });
}
function progressModal(title, cancelFn) {
  const bar = el('div', { id: 'pmBar' }), msg = el('div', { class: 'dim' }, 'Starting…');
  showModal(title, el('div', {}, msg, el('div', { class: 'bar' }, bar)), [['Cancel', () => { if (cancelFn) cancelFn(); closeModal(); }]]);
  return { set(text, pct) { msg.textContent = text; if (pct != null) bar.style.width = Math.min(100, pct) + '%'; } };
}

/* ====================== motion tracking ====================== */
function trackDialog(L) {
  const o = { mode: 'attach', target: '__new', r: 16 };
  const others = P.layers.filter(l => l !== L && l.type !== 'audio');
  const tgt = el('select', {}, el('option', { value: '__new' }, 'New null object'), others.map(l => el('option', { value: l.id }, l.name))); tgt.onchange = () => o.target = tgt.value;
  const body = el('div', {}, el('div', { class: 'dim' }, 'Pick what to do, then click the feature you want to follow in the preview (at the current playhead frame). Tracking runs forward to the end of the clip.'),
    field('Mode', o, 'mode', 'select', { opts: ['attach', 'stabilize'], names: v => v === 'attach' ? 'Attach a layer to the point' : 'Stabilize this clip' }),
    el('div', { class: 'frow' }, el('label', {}, 'Attach to'), tgt),
    field('Patch size', o, 'r', 'select', { opts: [10, 16, 24, 34], names: v => ({ 10: 'Small', 16: 'Medium', 24: 'Large', 34: 'Extra large' }[v]) }));
  showModal('Track motion — ' + L.name, body, [['Cancel', closeModal], ['Pick tracking point', () => { closeModal(); trackArm = { L, mode: o.mode, target: o.target, r: +o.r }; seek(Math.max(L.start, Math.min(T, L.start + L.dur - .05))); toast('Click the feature to track in the preview…'); }, true]]);
}
function trackClick(p) {
  const a = trackArm; trackArm = null; const L = a.L, C = contentOf(L, T); if (!C) return toast('Video frame not ready.');
  const q = localPt(L, p); runTrack(a, { x: q.x + C.w / 2, y: q.y + C.h / 2 });
}
async function runTrack(a, pt0) {
  const L = a.L, el_ = getEl(L), m = media[L.media]; if (!el_ || !m) return;
  let cancel = false; const pm = progressModal('Tracking…', () => cancel = true);
  const vw = m.w, vh = m.h, sc = Math.min(1, 480 / vw), w = Math.round(vw * sc), h = Math.round(vh * sc), cv = mkCanvas(w, h), cx = cv.getContext('2d', { willReadFrequently: true });
  const srcT = t => L.srcIn + (t - L.start) * L.speed, fps = P.fps, r = Math.round(a.r * (sc < 1 ? sc * 1.5 : 1)) + 4, R = Math.round(r * 1.7), n = 2 * r + 1;
  const grab = async t => { await seekEl(el_, srcT(t)); cx.drawImage(el_, 0, 0, w, h); const d = cx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h); for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; return g; };
  const patch = (g, x, y) => { const o = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) o[j * n + i] = g[(y - r + j) * w + (x - r + i)]; return o; };
  offlineBusy = true;
  try {
    const t0 = Math.max(L.start, T), tEnd = L.start + L.dur; let pos = { x: Math.round(pt0.x * sc), y: Math.round(pt0.y * sc) };
    if (pos.x < r + R || pos.y < r + R || pos.x > w - r - R || pos.y > h - r - R) throw new Error('Pick a point farther from the frame edge.');
    let g = await grab(t0), tpl = patch(g, pos.x, pos.y); const res = [{ t: t0, x: pos.x / sc, y: pos.y / sc }], total = Math.max(1, Math.round((tEnd - t0) * fps));
    for (let k = 1; t0 + k / fps < tEnd - 1e-6 && !cancel; k++) {
      const t = t0 + k / fps; g = await grab(t); let best = 1e18, bx = pos.x, by = pos.y;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = pos.x + dx, y = pos.y + dy; if (x < r || y < r || x >= w - r || y >= h - r) continue;
        let s = 0; for (let j = 0; j < n && s < best; j++) { const row = (y - r + j) * w + x - r; for (let i = 0; i < n; i++) s += Math.abs(g[row + i] - tpl[j * n + i]); }
        if (s < best) { best = s; bx = x; by = y; }
      }
      pos = { x: bx, y: by }; const np = patch(g, bx, by); for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * .88 + np[i] * .12;
      res.push({ t, x: bx / sc, y: by / sc }); if (k % 3 === 0) { pm.set(`Frame ${k} / ${total}`, k / total * 100); await sleep(0); }
    }
    if (cancel) return;
    // convert tracked video-pixel positions to comp-space and write keyframes
    const world = res.map(s => { const M = worldMat(L, s.t); return matApply(M, s.x - vw / 2, s.y - vh / 2); });
    if (a.mode === 'stabilize') {
      for (const k of ['x', 'y']) delete L.kf[k]; const bx = L.tr.x, by = L.tr.y;
      res.forEach((s, i) => { upsertKey(L, 'x', s.t - L.start, bx - (world[i].x - world[0].x), 'linear'); upsertKey(L, 'y', s.t - L.start, by - (world[i].y - world[0].y), 'linear'); });
      L.open = true;
    } else {
      let tg = P.layers.find(l => l.id === a.target);
      if (!tg) { tg = mkLayer('null', { name: 'Track point', start: 0, dur: P.dur }); P.layers.push(tg); }
      for (const k of ['x', 'y']) delete tg.kf[k];
      res.forEach((s, i) => { const q = tg.parent ? matApply(matInv(parentMat(tg, s.t)), world[i].x, world[i].y) : world[i]; upsertKey(tg, 'x', s.t - tg.start, q.x, 'linear'); upsertKey(tg, 'y', s.t - tg.start, q.y, 'linear'); });
      tg.open = true; selId = tg.id;
    }
    commit(); toast(`Tracked ${res.length} frames — keyframes written.`);
  } catch (e) { toast('Tracking failed: ' + e.message); }
  finally { offlineBusy = false; closeModal(); structChanged(); requestRender(); }
}

/* ====================== keyframe graph editor ====================== */
const G = { on: false, key: null, sel: null, drag: null, vr: null };
function toggleGraph() { G.on = !G.on; gid('graph').classList.toggle('hidden', !G.on); gid('tGraph').classList.toggle('on', G.on); if (G.on) buildGraph(); }
function graphRefresh() { if (G.on) buildGraph(); }
function graphKeys(L) { return Object.keys(L.kf).filter(k => L.kf[k].length); }
function buildGraph() {
  const box = gid('graph'); box.innerHTML = ''; const L = selLayer(), keys = L ? graphKeys(L) : [];
  if (!keys.length) { box.append(el('div', { class: 'gbar dim' }, L ? 'This layer has no keyframes. Click the ⏱ stopwatch next to a property in the inspector.' : 'Select a layer that has keyframes.')); return; }
  if (!keys.includes(G.key)) G.key = keys[0];
  const prop = el('select', { onchange: ev => { G.key = ev.target.value; G.sel = null; G.vr = null; drawGraph(); } }, keys.map(k => el('option', { value: k, selected: k === G.key ? '' : undefined }, propLabel(L, k))));
  const ease = el('select', { id: 'gEase', onchange: ev => { if (G.sel) { G.sel.e = ev.target.value; if (G.sel.e === 'bezier' && !G.sel.b) G.sel.b = BEZ.easy.slice(); commit(); requestRender(); drawGraph(); } } }, ['bezier', 'inout', 'linear', 'in', 'out', 'back', 'bounce', 'hold'].map(e => el('option', { value: e }, 'Ease: ' + (e === 'bezier' ? 'Bézier (handles)' : e))));
  // Easy Ease (After Effects-style): Bézier on the segments entering and leaving the selected key
  const easyEase = () => { if (!G.sel) return toast('Select a keyframe first.'); const arr = L.kf[G.key], i = arr.indexOf(G.sel); const out = G.sel.b || BEZ.easy.slice(); G.sel.e = 'bezier'; G.sel.b = [.33, 0, out[2] ?? .67, out[3] ?? 1]; if (i > 0) { const p = arr[i - 1], pb = p.e === 'bezier' && p.b ? p.b : BEZ.easy; p.e = 'bezier'; p.b = [pb[0], pb[1], .67, 1]; } commit(); requestRender(); G.draw(); };
  G.easyEase = easyEase;
  box.append(el('div', { class: 'gbar' }, el('b', {}, 'Graph'), prop, ease, el('button', { title: 'Easy Ease (F9)', onclick: easyEase }, 'Easy Ease'), el('span', { class: 'dim' }, 'Drag keys or Bézier handles · double-click to add/delete · right-click = next easing'), el('div', { class: 'spacer' }), el('button', { onclick: toggleGraph }, '✕ Close')));
  const cv = el('canvas', {}); box.append(cv); G.cv = cv;
  const geo = () => { const w = cv.clientWidth, h = cv.clientHeight, pad = 34, arr = L.kf[G.key], t0 = Math.min(0, arr[0].t), t1 = Math.max(L.dur, arr[arr.length - 1].t) * 1.02; return { w, h, pad, t0, t1, arr }; };
  const range = () => { const { arr, t0, t1 } = geo(); let lo = 1e18, hi = -1e18; for (let i = 0; i <= 120; i++) { const v = valueRaw(L, G.key, t0 + (t1 - t0) * i / 120); lo = Math.min(lo, v); hi = Math.max(hi, v); } arr.forEach(f => { lo = Math.min(lo, f.v); hi = Math.max(hi, f.v); }); if (hi - lo < 1e-6) { hi += 1; lo -= 1; } const p = (hi - lo) * .18; return [lo - p, hi + p]; };
  const X = (t, g) => g.pad + (t - g.t0) / (g.t1 - g.t0) * (g.w - g.pad * 1.5), Y = (v, g, vr) => g.h - g.pad * .7 - (v - vr[0]) / (vr[1] - vr[0]) * (g.h - g.pad * 1.4);
  const invT = (x, g) => g.t0 + (x - g.pad) / (g.w - g.pad * 1.5) * (g.t1 - g.t0), invV = (y, g, vr) => vr[0] + (g.h - g.pad * .7 - y) / (g.h - g.pad * 1.4) * (vr[1] - vr[0]);
  G.draw = () => {
    const g = geo(), d = window.devicePixelRatio || 1; if (!g.w) return; cv.width = g.w * d; cv.height = g.h * d; const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
    const vr = G.drag ? G.vr : (G.vr = range()); c.fillStyle = '#030308'; c.fillRect(0, 0, g.w, g.h); c.font = '10px Segoe UI'; c.lineWidth = 1;
    for (let i = 0; i <= 5; i++) { const v = vr[0] + (vr[1] - vr[0]) * i / 5, y = Y(v, g, vr); c.strokeStyle = '#17142d'; c.beginPath(); c.moveTo(g.pad, y); c.lineTo(g.w, y); c.stroke(); c.fillStyle = '#8b88ad'; c.fillText(v.toFixed(Math.abs(vr[1] - vr[0]) < 10 ? 2 : 0), 2, y + 3); }
    const ts = Math.max(.25, Math.round((g.t1 - g.t0) / 10 * 4) / 4); for (let t = Math.ceil(g.t0 / ts) * ts; t <= g.t1; t += ts) { const x = X(t, g); c.strokeStyle = '#17142d'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, g.h - 12); c.stroke(); c.fillStyle = '#8b88ad'; c.fillText(t.toFixed(2) + 's', x + 2, g.h - 2); }
    c.strokeStyle = '#8b5cf6'; c.lineWidth = 2; c.beginPath(); for (let px = g.pad; px <= g.w; px += 2) { const t = invT(px, g), y = Y(valueRaw(L, G.key, t), g, vr); px === g.pad ? c.moveTo(px, y) : c.lineTo(px, y); } c.stroke();
    const ph = X(T - L.start, g); c.strokeStyle = '#22e58b'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(ph, 0); c.lineTo(ph, g.h - 12); c.stroke();
    handles(g).forEach(h => { const a = { x: X(h.ax, g), y: Y(h.av, g, vr) }, p = { x: X(h.t, g), y: Y(h.v, g, vr) }; c.strokeStyle = '#8d8da3'; c.lineWidth = 1; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(p.x, p.y); c.stroke(); c.fillStyle = '#ececf4'; c.fillRect(p.x - 4, p.y - 4, 8, 8); });
    g.arr.forEach(f => { const x = X(f.t, g), y = Y(f.v, g, vr); c.fillStyle = f === G.sel ? '#fff' : '#3b9bff'; c.strokeStyle = '#000'; c.beginPath(); c.arc(x, y, f === G.sel ? 7 : 5.5, 0, 6.283); c.fill(); c.stroke(); });
    const es = gid('gEase'); if (es && G.sel) es.value = G.sel.e || 'inout';
  };
  // Bézier handles of every bezier segment, in (time, value) space
  const handles = g => { const out = []; for (let i = 0; i < g.arr.length - 1; i++) { const a = g.arr[i], b = g.arr[i + 1]; if (a.e !== 'bezier' || !a.b) continue; const dt = b.t - a.t, dv = b.v - a.v; out.push({ seg: a, which: 0, ax: a.t, av: a.v, t: a.t + a.b[0] * dt, v: a.v + a.b[1] * dv, dt, dv }); out.push({ seg: a, which: 1, ax: b.t, av: b.v, t: a.t + a.b[2] * dt, v: a.v + a.b[3] * dv, dt, dv }); } return out; };
  const pickKey = e => { const g = geo(), r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, vr = G.vr || range(); return { g, vr, x, y, f: g.arr.find(f => Math.hypot(X(f.t, g) - x, Y(f.v, g, vr) - y) < 10), h: handles(g).find(h => Math.hypot(X(h.t, g) - x, Y(h.v, g, vr) - y) < 8) }; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); const k = pickKey(e); if (k.h && !k.f) { G.drag = { h: k.h }; G.vr = k.vr; } else if (k.f) { G.sel = k.f; G.drag = { f: k.f }; G.vr = k.vr; } else { G.sel = null; seek(L.start + Math.max(0, invT(k.x, k.g))); } G.draw(); };
  cv.onpointermove = e => {
    if (!G.drag) return; const k = pickKey(e);
    if (G.drag.h) { const h = G.drag.h, a = h.seg, ux = clamp((invT(k.x, k.g) - a.t) / (h.dt || 1), 0, 1), uy = h.dv ? clamp((invV(k.y, k.g, G.vr) - a.v) / h.dv, -2, 3) : a.b[h.which * 2 + 1]; a.b[h.which * 2] = +ux.toFixed(3); a.b[h.which * 2 + 1] = +uy.toFixed(3); G.drag.moved = true; requestRender(); G.draw(); return; }
    const f = G.drag.f; f.t = frameQ(clamp(invT(k.x, k.g), k.g.t0, k.g.t1)); f.v = +invV(k.y, k.g, G.vr).toFixed(3); L.kf[G.key].sort((a, b) => a.t - b.t); G.drag.moved = true; requestRender(); G.draw(); uiProps();
  };
  cv.onpointerup = () => { if (G.drag && G.drag.moved) { commit(); renderTimeline(); } G.drag = null; G.draw(); };
  cv.ondblclick = e => { const k = pickKey(e), arr = L.kf[G.key]; if (k.f) { arr.splice(arr.indexOf(k.f), 1); if (!arr.length) { delete L.kf[G.key]; commit(); renderTimeline(); buildGraph(); return; } } else upsertKey(L, G.key, invT(k.x, k.g), valueRaw(L, G.key, invT(k.x, k.g))); commit(); renderTimeline(); G.vr = null; requestRender(); G.draw(); };
  cv.oncontextmenu = e => { e.preventDefault(); const k = pickKey(e); if (!k.f) return; const o = ['bezier', 'inout', 'linear', 'in', 'out', 'back', 'bounce', 'hold']; k.f.e = o[(o.indexOf(k.f.e) + 1) % o.length]; if (k.f.e === 'bezier' && !k.f.b) k.f.b = BEZ.easy.slice(); G.sel = k.f; commit(); requestRender(); G.draw(); };
  requestAnimationFrame(G.draw);
}
function drawGraph() { if (G.on && G.draw) G.draw(); }
gid('tGraph').onclick = toggleGraph;
gid('tExit').onclick = exitComp;

/* ====================== AI: captions + background removal (transformers.js, runs locally) ====================== */
let _tf = null;
/* transformers.js, its WASM runtime and the default models (Whisper tiny.en, MODNet) ship in vendor/ai, so captions and
   cut-outs work offline. Desktop app: files are served through nxmedia:// (module + fetch capable); dev server: plain
   relative URLs. Models that are not bundled (Whisper base) still download once from the model hub. */
function aiBase() {
  // per-segment encoding keeps real '/' separators, so the runtime's relative URLs (wasm loader next to the library) resolve
  if (location.protocol === 'file:') { const dir = decodeURIComponent(location.pathname.replace(/^\/([A-Za-z]:)/, '$1')).replace(/\/[^/]*$/, ''); const base = 'nxmedia://f/' + dir.split(/[\\/]/).map(encodeURIComponent).join('/') + '/vendor/ai/'; return f => base + f.split('/').map(encodeURIComponent).join('/'); }
  return f => new URL('vendor/ai/' + f, location.href).href;
}
async function loadTF() {
  if (_tf) return _tf; const at = aiBase();
  try { _tf = await import(at('transformers.min.js')); }
  catch (e) { console.warn('bundled transformers.js unavailable, using CDN', e); _tf = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3'); return _tf; }
  const env = _tf.env; env.allowLocalModels = true; env.allowRemoteModels = true; env.localModelPath = at('models') + '/'; env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = at('') ; return _tf;
}
function progressCb(pm, label) { const seen = {}; return d => { if (d.status === 'progress' && d.file) { seen[d.file] = d.progress || 0; const v = Object.values(seen); pm.set(`${label}: downloading model… ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}%`, v.reduce((a, b) => a + b, 0) / v.length); } else if (d.status === 'ready') pm.set(label + ': model ready'); }; }
function captionDialog(L) {
  const o = { model: 'Xenova/whisper-tiny.en', lang: 'english' };
  showModal('Auto captions — ' + L.name, el('div', {}, el('div', { class: 'dim' }, 'Speech is transcribed on your computer with Whisper (the model downloads once, then is cached). Results become timed text layers you can restyle.'),
    field('Model', o, 'model', 'select', { opts: ['Xenova/whisper-tiny.en', 'Xenova/whisper-base.en', 'Xenova/whisper-base'], names: v => ({ 'Xenova/whisper-tiny.en': 'Fast · English (built in, works offline)', 'Xenova/whisper-base.en': 'Better · English (downloads ~145 MB once)', 'Xenova/whisper-base': 'Multilingual — 99 languages (built in, works offline)' }[v]) }),
    field('Language', o, 'lang', 'text')), [['Cancel', closeModal], ['Transcribe', () => runCaptions(L, o), true]]);
}
async function runCaptions(L, o) {
  let cancel = false; const pm = progressModal('Auto captions', () => cancel = true);
  try {
    const m = media[L.media]; pm.set('Decoding audio…', 3);
    const ab = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await m.blob.arrayBuffer()), all = ab.getChannelData(0);
    const audio = all.slice(Math.floor(L.srcIn * 16000), Math.min(all.length, Math.floor((L.srcIn + L.dur * L.speed) * 16000)));
    pm.set('Loading speech model…', 6); const tf = await loadTF();
    const asr = await tf.pipeline('automatic-speech-recognition', o.model, { progress_callback: progressCb(pm, 'Captions') });
    if (cancel) return; pm.set('Transcribing… (this can take a while on CPU)', 60);
    const opts = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 }; if (!o.model.endsWith('.en')) { opts.language = o.lang || 'english'; opts.task = 'transcribe'; }
    const out = await asr(audio, opts); if (cancel) return;
    const chunks = (out.chunks || []).filter(c => c.text && c.text.trim()); if (!chunks.length) throw new Error('No speech detected.');
    chunks.forEach(c => {
      const s = c.timestamp[0] || 0, e = c.timestamp[1] == null ? s + 2.5 : c.timestamp[1], txt = c.text.trim();
      const T_ = mkLayer('text', { name: txt.slice(0, 24), start: L.start + s / L.speed, dur: Math.max(.5, (e - s) / L.speed), tin: { type: 'fade', dur: .12 }, tout: { type: 'fade', dur: .12 } });
      Object.assign(T_.text, { str: txt, size: 46, weight: '700', bgOn: true, bg: '#000000', bgPad: 14 }); T_.tr.y = P.h * .87; P.layers.push(T_);
    });
    commit(); structChanged(); toast(chunks.length + ' caption layers created.');
  } catch (e) { toast('Captions failed: ' + (e.message || e)); } finally { closeModal(); }
}
/** subject matte for an image (URL or canvas): returns a canvas of the same size whose ALPHA is the matte (MODNet, on-device).
    window.__matteOverride (tests only) can stand in for the model. */
async function matteFor(src, pm) {
  if (window.__matteOverride) return window.__matteOverride(src);
  pm && pm.set('Loading AI library…', 4); const tf = await loadTF();
  const model = await tf.AutoModel.from_pretrained('Xenova/modnet', { progress_callback: pm ? progressCb(pm, 'Background removal') : undefined }), processor = await tf.AutoProcessor.from_pretrained('Xenova/modnet');
  pm && pm.set('Finding the subject…', 85);
  const img = typeof src === 'string' ? await tf.RawImage.fromURL(src) : tf.RawImage.fromCanvas(src), { pixel_values } = await processor(img), { output } = await model({ input: pixel_values });
  const m = await tf.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(img.width, img.height), c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'), id = x.createImageData(img.width, img.height); for (let i = 0; i < m.data.length; i++) { id.data[i * 4 + 3] = m.data[i * m.channels]; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; } x.putImageData(id, 0, 0); return c;
}
/* ---- Design (NEXORA Image) versions: work on the active pixel layer of the open document ---- */
function designTarget() { const d = NXI.ui.doc, L = d && NXI.active(d); if (!d || !L || L.type !== 'raster') { toast('Select a pixel layer in Design first.'); return null; } return { d, L }; }
async function designRemoveBackground(o) {
  const t = designTarget(); if (!t) return; const { d, L } = t, pm = o && o.quiet ? null : progressModal('Remove background', () => { });
  try { const mt = await matteFor(L.canvas, pm); if (!L.mask) NXI.addMask(d, L, false); const mx = L.mask.canvas.getContext('2d'); mx.globalCompositeOperation = 'destination-in'; mx.drawImage(mt, 0, 0, L.mask.canvas.width, L.mask.canvas.height); mx.globalCompositeOperation = 'source-over'; NXI.dirty(d, L); NXI.push(d, 'Remove background'); NXI.ui.refreshAll && NXI.ui.refreshAll(); toast('Background hidden with a layer mask — paint the mask to refine it.'); return L; }
  catch (e) { toast('AI cutout unavailable: ' + (e.message || e)); } finally { if (pm) closeModal(); }
}
async function designSelectSubject(o) {
  const t = designTarget(); if (!t) return; const { d, L } = t, pm = o && o.quiet ? null : progressModal('Select subject', () => { });
  try { const mt = await matteFor(L.canvas, pm); const s = document.createElement('canvas'); s.width = d.w; s.height = d.h; s.getContext('2d').drawImage(mt, 0, 0, d.w, d.h); d.sel = s; d.selV = (d.selV || 0) + 1; NXI.ui.refreshAll && NXI.ui.refreshAll(); toast('Subject selected.'); return s; }
  catch (e) { toast('AI selection unavailable: ' + (e.message || e)); } finally { if (pm) closeModal(); }
}
async function designCropToSubject(o) {
  const t = designTarget(); if (!t) return; const { d, L } = t, pm = o && o.quiet ? null : progressModal('Crop to subject', () => { });
  try { const mt = await matteFor(L.canvas, pm), b = NXI.contentBounds(mt); if (!b) return toast('No subject found.'); const pad = Math.round(Math.max(b.w, b.h) * .06), r = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad) }; r.w = Math.min(d.w - r.x, b.w + 2 * pad); r.h = Math.min(d.h - r.y, b.h + 2 * pad); NXI.crop(d, r); NXI.push(d, 'Crop to subject'); NXI.ui.refreshAll && NXI.ui.refreshAll(); toast('Cropped to the subject.'); return r; }
  catch (e) { toast('AI crop unavailable: ' + (e.message || e)); } finally { if (pm) closeModal(); }
}
async function removeBackgroundAI(L) {
  let cancel = false; const pm = progressModal('Remove background', () => cancel = true);
  try {
    const m = media[L.media]; pm.set('Loading AI library…', 4); const tf = await loadTF();
    const model = await tf.AutoModel.from_pretrained('Xenova/modnet', { progress_callback: progressCb(pm, 'Background removal') }), processor = await tf.AutoProcessor.from_pretrained('Xenova/modnet');
    if (cancel) return; pm.set('Cutting out subject…', 85);
    const img = await tf.RawImage.fromURL(m.url), { pixel_values } = await processor(img), { output } = await model({ input: pixel_values });
    img.putAlpha(await tf.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(img.width, img.height));
    const cv = img.toCanvas(), blob = cv.convertToBlob ? await cv.convertToBlob({ type: 'image/png' }) : await new Promise(r => cv.toBlob(r, 'image/png')), nm = await importFile(new File([blob], m.name.replace(/\.[^.]+$/, '') + '-cutout.png', { type: 'image/png' }));
    L.media = nm.id; L.name += ' (cutout)'; commit(); structChanged(); toast('Background removed.');
  } catch (e) { toast('AI cutout unavailable: ' + (e.message || e) + ' — try the Smart Key effect instead.'); } finally { closeModal(); }
}
function keyAutoBg(L) { L.fx.push(newFx('autokey')); commit(); structChanged(); toast('Smart Key added — works best on a plain background.'); }

/* ====================== precompose helpers ====================== */
function unprecompose(C) {
  if (C.type !== 'comp') return; const i = P.layers.indexOf(C), inner = C.comp.layers;
  inner.forEach(l => { l.start += C.start; });
  P.layers.splice(i, 1, ...inner); selId = inner[0] ? inner[0].id : null; commit(); structChanged();
}
function uiComp() {
  const inside = compStack.length > 0; gid('tExit').classList.toggle('hidden', !inside);
  gid('compName').textContent = inside ? 'Editing: ' + compStack.map(s => s.layer.name).join(' › ') : '';
}

/* ====================== offline, frame-accurate MP4 export (WebCodecs + mp4-muxer) ====================== */
const offlineSupported = () => !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer);
function allMediaItems(layers, base, speed, out) {
  for (const L of layers) {
    if (L.type === 'comp') { const s = compSource(L); if (s && out.length < 500) allMediaItems(s.layers, base + (L.start - L.srcIn / L.speed) * speed, speed * L.speed, out); }
    else if ((L.type === 'video' || L.type === 'audio') && media[L.media] && L.visible && !L.muted) out.push({ L, abs: base + L.start * speed, k: speed });
  }
  return out;
}
async function mixAudio(dur) {
  const SR = 48000, ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * SR)), SR); let used = 0;
  const mix = typeof AudioMix !== 'undefined' ? AudioMix.offlineGraph(ctx) : null;     // same EQ / pan / comp / master chain as playback
  const proj = typeof Motion !== 'undefined' ? Motion.editProject() : P, solo = proj.layers.some(l => l.solo);
  for (const it of allMediaItems(proj.layers, 0, 1, [])) {
    const L = it.L; if (solo && !L.solo && proj.layers.includes(L)) continue;
    let ab; try { ab = await ctx.decodeAudioData(await media[L.media].blob.arrayBuffer()); } catch (e) { continue; }
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = ab; src.playbackRate.value = clamp(L.speed * it.k, .0625, 16); src.connect(g); g.connect(mix ? mix.input(L) : ctx.destination);
    const lead = Math.max(0, -it.abs), when = Math.max(0, it.abs), len = L.dur - lead;
    for (let t = 0; t <= len + .001; t += .05) { const lt = lead + t; g.gain.setValueAtTime(clamp(valueAt(L, 'vol', lt) / 100 * transMod(L, lt).a, 0, 4), when + t); }
    src.start(when, L.srcIn + lead * L.speed, Math.max(.01, len * L.speed)); used++;
  }
  return used ? ctx.startRendering() : null;
}
/* professional codecs: every candidate profile is checked with VideoEncoder.isConfigSupported on this machine */
const CODEC_NAMES = { avc: 'H.264', hevc: 'H.265 / HEVC', vp9: 'VP9', av1: 'AV1' };
const CODEC_STRINGS = { avc: ['avc1.640033', 'avc1.4d0033', 'avc1.42003e', 'avc1.640028', 'avc1.42001f'], hevc: ['hvc1.1.6.L153.B0', 'hvc1.1.6.L150.B0', 'hvc1.1.6.L123.B0', 'hev1.1.6.L153.B0'], vp9: ['vp09.00.51.08', 'vp09.00.41.08', 'vp09.00.31.08'], av1: ['av01.0.12M.08', 'av01.0.08M.08', 'av01.0.05M.08'] };
/* isConfigSupported() can say yes for an encoder that then fails on the first frame (seen with HEVC on virtual Macs
   without a hardware encoder). So a codec is only offered after it has really encoded one frame at that size; the
   answer is remembered for the session. */
const _encProbe = new Map();
function probeEncode(cfg) {
  const key = [cfg.codec, cfg.width, cfg.height].join('|'); if (_encProbe.has(key)) return _encProbe.get(key);
  const p = new Promise(res => {
    let ok = false, done = false; const finish = v => { if (!done) { done = true; res(v); } };
    try {
      const enc = new VideoEncoder({ output: () => { ok = true; }, error: () => finish(false) }); enc.configure(cfg);
      const w = cfg.width, h = cfg.height, data = new Uint8Array(w * h * 3 / 2); data.fill(128);
      const vf = new VideoFrame(data, { format: 'I420', codedWidth: w, codedHeight: h, timestamp: 0, duration: 33333 });
      enc.encode(vf, { keyFrame: true }); vf.close();
      enc.flush().then(() => { try { enc.close(); } catch (e) { } finish(ok); }, () => finish(false));
      setTimeout(() => finish(false), 8000);
    } catch (e) { finish(false); }
  });
  _encProbe.set(key, p); return p;
}
async function pickCodec(k, W, H, mbps, fps) {
  for (const codec of CODEC_STRINGS[k] || []) { const cfg = { codec, width: W, height: H, bitrate: mbps * 1e6, framerate: fps }; if (k === 'avc') cfg.avc = { format: 'avc' }; if (k === 'hevc') cfg.hevc = { format: 'hevc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported && await probeEncode(cfg)) return cfg; } catch (e) { } }
  return null;
}
async function supportedCodecs(W, H, fps) { const out = []; for (const k of Object.keys(CODEC_STRINGS)) if (await pickCodec(k, W & ~1, H & ~1, 12, fps)) out.push(k); return out; }
function sliceBuffer(buf, from, to) { const sr = buf.sampleRate, s = Math.floor(from * sr), e = Math.min(buf.length, Math.ceil(to * sr)), out = new AudioBuffer({ length: Math.max(1, e - s), numberOfChannels: buf.numberOfChannels, sampleRate: sr }); for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s, e), c); return out; }
async function exportOffline(o) {
  exitAllComps(); pause(); offlineBusy = true; let cancel = false;
  const pm = progressModal('Exporting MP4 (exact frames)', () => cancel = true);
  const W = P.w & ~1, H = P.h & ~1, fps = o.fps, from = clamp(o.from || 0, 0, P.dur), to = clamp(o.to == null ? P.dur : o.to, from + 1 / fps, P.dur), N = Math.max(1, Math.round((to - from) * fps)), savedT = T, codecK = o.codec || 'avc';
  try {
    const vcfg = await pickCodec(codecK, W, H, o.mbps, fps);
    if (!vcfg) throw new Error(`${CODEC_NAMES[codecK]} encoding is not available on this computer.`);
    pm.set('Mixing audio…', 1); let mix = null, acodec = null;
    if (o.audio) { try { mix = await mixAudio(P.dur); if (mix && (from > 0 || to < P.dur)) mix = sliceBuffer(mix, from, to); } catch (e) { mix = null; } }
    if (mix) {
      for (const c of ['mp4a.40.2', 'opus']) { try { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) { acodec = c; break; } } catch (e) { } }
      if (!acodec) mix = null;
    }
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: codecK, width: W, height: H, frameRate: fps }, audio: mix ? { codec: acodec === 'opus' ? 'opus' : 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined, fastStart: 'in-memory' });
    let encErr = null; const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => encErr = e }); venc.configure(vcfg);
    for (let i = 0; i < N && !cancel; i++) {
      if (encErr) throw encErr; const t = from + i / fps; T = t;   // timestamps restart at 0 for a ranged export
      await Promise.all(collectMedia(P.layers, t, []).filter(a => a.L.type === 'video').map(a => { const e = getEl(a.L); if (!e) return null; if (!e.paused) e.pause(); return seekEl(e, a.L.srcIn + (a.t - a.L.start) * a.L.speed); }));
      if (typeof VFX !== 'undefined') await VFX.prepareLayers(P.layers, t);   // VFX graphs used as layers: seek their media too
      renderComp(vctx, t);
      const vf = new VideoFrame(view, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps), visibleRect: { x: 0, y: 0, width: W, height: H } });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 }); vf.close();
      while (venc.encodeQueueSize > 12) await sleep(2);
      if (i % 3 === 0) { pm.set(`Rendering frame ${i + 1} / ${N}`, 2 + i / N * 88); await sleep(0); }
    }
    if (cancel) { venc.close(); return; }
    await venc.flush(); venc.close();
    if (mix) {
      pm.set('Encoding audio…', 92); const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => encErr = e });
      aenc.configure({ codec: acodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
      const ch0 = mix.getChannelData(0), ch1 = mix.getChannelData(1), step = 4800;
      for (let s = 0; s < mix.length; s += step) { const n = Math.min(step, mix.length - s), buf = new Float32Array(n * 2); buf.set(ch0.subarray(s, s + n), 0); buf.set(ch1.subarray(s, s + n), n); const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(s / 48000 * 1e6), data: buf }); aenc.encode(ad); ad.close(); if (aenc.encodeQueueSize > 20) await sleep(1); }
      await aenc.flush(); aenc.close();
    }
    if (encErr) throw encErr; muxer.finalize();
    download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), safeName() + (from > 0 || to < P.dur ? ` (${tcFmt(from).replace(/:/g, '.')}-${tcFmt(to).replace(/:/g, '.')})` : '') + '.mp4'); toast(`Exported ${N} frames · ${CODEC_NAMES[codecK]} · ${o.mbps} Mbps${mix ? '' : ' · no audio'}.`);
  } catch (e) { toast('Export failed: ' + (e.message || e)); console.error(e); }
  finally { offlineBusy = false; T = savedT; requestRender(); closeModal(); }
}
