'use strict';
/* ====================== NEXORA Lab (experimental) ======================
   Four tools that are new and may change:
   · Time machine — a slider over the undo history: drag back through every version of the edit, see what changed
     at each step (clips added, removed, moved, trimmed), and keep the version you land on.
   · Edit replay — NEXORA keeps a small journal of the timeline layout after every change (clip boxes
     only, no pixels, kept for each project on this computer). Replay animates how the edit was built, with counters, and can save
     it as a WebM video ("making of" for your channel).
   · Pacing map — the rhythm of the edit: cuts per 10 seconds, shot lengths and the sound's energy on one chart, with
     the slow stretches (long shots in quiet parts) and frantic ones marked. Click to jump there.
   · Sound link — let a music or voice clip drive a property of the selected clip (scale, opacity, rotation, X, Y):
     the sound's level is written as ordinary keyframes, so you can edit them afterwards. */
const Lab = (() => {
  /* ---------- journal (for Edit replay) ---------- */
  const VIS = new Set(['video', 'image', 'text', 'shape', 'solid', 'comp', 'gen', '3d', 'vfx', 'particles', 'paint', 'adjust']);
  function entry() { return { t: Date.now(), d: +P.dur.toFixed(2), L: P.layers.slice(0, 120).map((l, i) => [l.type[0], +l.start.toFixed(2), +l.dur.toFixed(2), i, l.label || '']) }; }
  // kept per project on this computer (localStorage), not in the undo history, so it costs nothing while editing
  let jid = null, jr = [], jt = 0;
  function journal() { const id = (typeof Projects !== 'undefined' && Projects.current && Projects.current.id) || 'none'; if (jid !== id) { jid = id; try { jr = JSON.parse(localStorage.getItem('nx.journal.' + id) || '[]') || []; } catch (e) { jr = []; } } return jr; }
  function persist() { clearTimeout(jt); jt = setTimeout(() => { try { localStorage.setItem('nx.journal.' + jid, JSON.stringify(jr)); } catch (e) { jr = jr.filter((_, i) => i % 2 === 0); } }, 1500); }
  function record() {
    if (compStack.length) return; const j = journal(), e = entry(), last = j[j.length - 1];
    if (last && JSON.stringify(last.L) === JSON.stringify(e.L) && last.d === e.d) return; j.push(e); if (j.length > 400) { const keep = j.filter((_, i) => i === 0 || i % 2 === 1 || i > j.length - 100); j.length = 0; j.push(...keep); } persist();
  }
  const _commit = commit; commit = function () { try { record(); } catch (e) { } return _commit.apply(this, arguments); };

  /* ---------- time machine ---------- */
  function diff(a, b) {
    const A = new Map((a ? JSON.parse(a.json).layers : []).map(l => [l.id, l])), B = new Map(JSON.parse(b.json).layers.map(l => [l.id, l])); let add = 0, del = 0, mov = 0, trim = 0, chg = 0;
    for (const [id, l] of B) { const o = A.get(id); if (!o) add++; else { if (Math.abs(o.start - l.start) > 1e-3) mov++; if (Math.abs(o.dur - l.dur) > 1e-3) trim++; else if (Math.abs(o.start - l.start) <= 1e-3 && ser(o) !== ser(l)) chg++; } }
    for (const id of A.keys()) if (!B.has(id)) del++; return { add, del, mov, trim, chg };
  }
  const say = d => [d.add && `+${d.add} clip${d.add > 1 ? 's' : ''}`, d.del && `−${d.del} clip${d.del > 1 ? 's' : ''}`, d.mov && `${d.mov} moved`, d.trim && `${d.trim} trimmed`, d.chg && `${d.chg} changed`].filter(Boolean).join(' · ') || 'no clip changes';
  function goTo(i) { exitAllComps(); i = clamp(i | 0, 0, hist.stack.length - 1); if (i === hist.i) return; hist.i = i; restore(hist.stack[i]); uiHistory(); requestRender(); }
  function timeMachine() {
    if (hist.stack.length < 2) return toast('Make a few edits first: the time machine travels through them.');
    const start = hist.i, info = el('div', { class: 'lab-tm-info' }), mini = el('canvas', { class: 'lab-mini', width: 560, height: 90 });
    const slider = el('input', { type: 'range', min: 0, max: hist.stack.length - 1, value: hist.i, class: 'lab-tm' });
    const show = () => { const i = +slider.value; goTo(i); const d = diff(hist.stack[i - 1], hist.stack[i]); info.textContent = `Version ${i + 1} of ${hist.stack.length}${i === start ? ' (where you were)' : ''} · ${say(d)}`; drawLayout(mini.getContext('2d'), { d: P.dur, L: P.layers.map((l, k) => [l.type[0], l.start, l.dur, k, l.label || '']) }, 560, 90); };
    slider.oninput = show; slider.onkeydown = e => e.stopPropagation();
    showModal('Time machine (Lab)', el('div', { class: 'lab' }, el('p', { class: 'dim' }, 'Drag to travel through the last ' + hist.stack.length + ' versions of this edit. The viewer and timeline show each one. Keep this version, or go back to where you were.'), slider, info, mini),
      [['Back to where I was', () => { goTo(start); closeModal(); }], ['Keep this version', () => { closeModal(); toast('Kept version ' + (hist.i + 1) + '. Redo still goes forward.'); }, true]]);
    show();
  }

  /* ---------- edit replay ---------- */
  const COL = { v: '#4a9bd6', a: '#2f6fb8', i: '#8fc9f0', t: '#e6eaee', s: '#6b8299', c: '#1d3d73' };
  function drawLayout(x, e, W, H, o = {}) {
    x.fillStyle = '#05080c'; x.fillRect(0, 0, W, H); if (!e) return; const top = o.top || 4, rows = Math.max(1, Math.min(24, e.L.length)), rh = Math.max(2, (H - top - 4) / rows), dur = Math.max(1, o.dur || e.d), k = (W - 8) / dur;
    for (const [ty, s, d, i, lab] of e.L) { if (i >= 24) continue; x.fillStyle = (lab && typeof CLIP_LABELS !== 'undefined' && CLIP_LABELS[lab] ? CLIP_LABELS[lab][1] : COL[ty] || '#4d5a66'); x.fillRect(4 + s * k, top + i * rh + 1, Math.max(1.5, d * k - 1), Math.max(1, rh - 2)); }
  }
  function frames() { const j = journal().slice(); const now = entry(); if (!j.length || JSON.stringify(j[j.length - 1].L) !== JSON.stringify(now.L)) j.push(now); return j; }
  function replay(o = {}) {
    const j = frames(); if (j.length < 2) { toast('Edit a little more first: the replay is built from your changes.'); return null; }
    const W = 1280, H = 720, cv = el('canvas', { width: W, height: H, class: 'lab-replay' }), x = cv.getContext('2d'), maxD = Math.max(...j.map(e => e.d)), secs = clamp(j.length * .12, 4, 40), fps = 30, n = Math.round(secs * fps);
    const paint = f => { const k = Math.min(j.length - 1, Math.floor(f / n * j.length)), e = j[k]; drawLayout(x, e, W, H, { top: 120, dur: maxD }); x.fillStyle = '#e6eaee'; x.font = '600 34px "Segoe UI", sans-serif'; x.fillText(P.name || 'Untitled', 40, 60);
      x.fillStyle = '#8fc9f0'; x.font = '22px Consolas, monospace'; const mins = Math.round((e.t - j[0].t) / 60000); x.fillText(`edit ${k + 1} / ${j.length}   ·   ${e.L.length} clips   ·   ${e.d.toFixed(1)} s long   ·   ${mins} min in`, 40, 96);
      x.fillStyle = '#4a9bd6'; x.fillRect(0, H - 6, W * f / n, 6); x.fillStyle = '#6b8299'; x.font = '16px "Segoe UI", sans-serif'; x.fillText('made with NEXORA Studio', W - 220, H - 20); };
    let f = 0, raf = 0, rec = null; const loop = () => { paint(f); f = (f + 1) % (n + fps); raf = requestAnimationFrame(loop); };
    const save = async () => { if (!window.MediaRecorder) return toast('Recording is not available here.'); cancelAnimationFrame(raf); const st = cv.captureStream(fps), chunks = []; rec = new MediaRecorder(st, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: 6e6 });
      rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data); const done = new Promise(r => rec.onstop = r); rec.start(); for (f = 0; f <= n + fps; f++) { paint(Math.min(f, n)); await new Promise(r => setTimeout(r, 1000 / fps)); } rec.stop(); await done;
      download(new Blob(chunks, { type: 'video/webm' }), (P.name || 'edit').replace(/[^\w -]+/g, '') + ' - replay.webm'); toast('Replay saved'); f = 0; loop(); };
    if (o.paintOnly) { paint(o.paintOnly); return { cv, frames: j, n }; }
    showModal('Edit replay (Lab)', el('div', { class: 'lab' }, el('p', { class: 'dim' }, `How this edit was built, from ${j.length} recorded changes. The journal keeps clip boxes only, for each project, on this computer.`), cv),
      [['Save as video (WebM)', save], ['Close', () => { cancelAnimationFrame(raf); if (rec && rec.state === 'recording') rec.stop(); closeModal(); }, true]]);
    loop(); return { cv, frames: j, n };
  }

  /* ---------- pacing map ---------- */
  async function pacing(o = {}) {
    const vis = P.layers.filter(l => VIS.has(l.type) && l.visible !== false && !['text', 'adjust'].includes(l.type)), dur = Math.max(1, P.dur);
    const cuts = [...new Set(vis.flatMap(l => [l.start, l.start + l.dur]).map(t => +t.toFixed(2)))].filter(t => t > .05 && t < dur - .05).sort((a, b) => a - b);
    const edges = [0, ...cuts, dur], shots = edges.slice(1).map((e, i) => ({ a: edges[i], b: e, len: e - edges[i] })).filter(s => s.len > .02 && vis.some(l => l.start < (s.a + s.b) / 2 && l.start + l.dur > (s.a + s.b) / 2));   // empty stretches are not shots
    const win = 10, bins = Math.ceil(dur / win), cpm = Array.from({ length: bins }, (_, i) => cuts.filter(c => c >= i * win && c < (i + 1) * win).length);
    // energy: loudest sounding clip every half second
    const step = .5, en = new Float32Array(Math.ceil(dur / step)).fill(-90);
    if (o.audio !== false) for (const L of P.layers.filter(l => (l.type === 'audio' || l.type === 'video') && !l.muted && media[l.media] && media[l.media].blob)) { try { for (const p of await Analysis.envelope(L, step)) { const i = Math.floor(p.t / step); if (i >= 0 && i < en.length) en[i] = Math.max(en[i], p.db); } } catch (e) { } }
    const lens = shots.map(s => s.len).sort((a, b) => a - b), med = lens[Math.floor(lens.length / 2)] || dur, loud = [...en].filter(v => v > -80), quiet = loud.length ? loud.sort((a, b) => a - b)[Math.floor(loud.length * .3)] : -90;
    const lvl = (a, b) => { let m = -90; for (let i = Math.floor(a / step); i < Math.min(en.length, Math.ceil(b / step)); i++) m = Math.max(m, en[i]); return m; };
    const flags = [];
    for (const s of shots) { if (s.len > Math.max(4, med * 2.2) && lvl(s.a, s.b) <= quiet + 3) flags.push({ t: s.a, b: s.b, kind: 'slow', text: `${s.len.toFixed(1)} s shot in a quiet part: trim it, add B-roll or a zoom` }); }
    cpm.forEach((c, i) => { if (c >= 18) flags.push({ t: i * win, b: (i + 1) * win, kind: 'fast', text: `${c} cuts in 10 s: very frantic; on purpose?` }); });
    return { cuts, shots, cpm, win, en, step, median: med, flags, avgShot: shots.length ? dur / shots.length : dur };
  }
  async function pacingDialog() {
    const r = await pacing(), W = 640, H = 200, cv = el('canvas', { width: W, height: H, class: 'lab-pace' }), x = cv.getContext('2d'), dur = Math.max(1, P.dur), k = W / dur;
    x.fillStyle = '#05080c'; x.fillRect(0, 0, W, H);
    const mx = Math.max(1, ...r.cpm); r.cpm.forEach((c, i) => { x.fillStyle = '#2f6fb8'; const h = c / mx * 80; x.fillRect(i * r.win * k + 1, 100 - h, r.win * k - 2, h); });
    x.strokeStyle = '#8fc9f0'; x.lineWidth = 1.5; x.beginPath(); r.en.forEach((v, i) => { const y = 190 - clamp((v + 60) / 60, 0, 1) * 80; i ? x.lineTo(i * r.step * k, y) : x.moveTo(0, y); }); x.stroke();
    r.shots.forEach(s => { x.fillStyle = s.len > r.median * 2.2 ? '#e6eaee' : '#4d5a66'; x.fillRect(s.a * k, 104, Math.max(1, s.len * k - 1), 4); });
    for (const f of r.flags) { x.fillStyle = f.kind === 'slow' ? '#ffffff22' : '#4a9bd633'; x.fillRect(f.t * k, 0, (f.b - f.t) * k, H); }
    cv.onclick = e => { const b = cv.getBoundingClientRect(); seek(clamp((e.clientX - b.left) / b.width * dur, 0, dur)); };
    const list = el('div', { class: 'lab-flags' }, ...(r.flags.length ? r.flags.map(f => el('button', { onclick: () => seek(f.t) }, el('span', { class: 'mono' }, tcFull(f.t)), ' ', f.text)) : [el('p', { class: 'dim' }, 'No slow or frantic stretches found. Nice rhythm.')]));
    showModal('Pacing map (Lab)', el('div', { class: 'lab' }, el('p', { class: 'dim' }, `${r.shots.length} shots · average ${r.avgShot.toFixed(1)} s · median ${r.median.toFixed(1)} s. Bars: cuts per 10 s. Strip: shot lengths (white = long). Line: loudness. Click to jump.`), cv, list), [['Close', closeModal, true]]);
    return r;
  }

  /* ---------- sound link ---------- */
  const PROPS = { s: ['Scale', 100, 30], op: ['Opacity', 100, -60], rot: ['Rotation', 0, 15], x: ['X position', null, 60], y: ['Y position', null, -60] };
  /** write keyframes on L.kf[prop] from the level of sound clip A. o: { amount, smooth 0…1, rate } */
  async function soundLink(L, A, prop, o = {}) {
    if (!L || !A || !media[A.media]) throw new Error('Pick a clip and a sound clip.'); const pr = PROPS[prop]; if (!pr) throw new Error('Unknown property');
    const rate = o.rate || 15, env = await Analysis.envelope(A, 1 / rate), base = pr[1] == null ? L.tr[prop] : (prop === 's' ? L.tr.s : prop === 'op' ? L.tr.op : L.tr.rot), amt = o.amount == null ? pr[2] : o.amount, sm = clamp(o.smooth == null ? .5 : o.smooth, 0, .95);
    const vals = env.map(p => p.db); const sorted = vals.filter(v => v > -80).sort((a, b) => a - b), lo = sorted[Math.floor(sorted.length * .1)] ?? -60, hi = sorted[Math.floor(sorted.length * .98)] ?? -6;
    let s = 0; const keys = [];
    for (const p of env) { const lt = p.t - L.start; if (lt < -1e-6 || lt > L.dur + 1e-6) continue; const u = clamp((p.db - lo) / Math.max(1, hi - lo), 0, 1); s = u > s ? u * (1 - sm * .5) + s * sm * .5 : u * (1 - sm) + s * sm; keys.push({ t: +lt.toFixed(4), v: +(base + amt * s).toFixed(3), e: 'linear' }); }
    if (!keys.length) throw new Error('The sound clip does not overlap this clip.');
    L.kf[prop] = keys; L.open = true; commit(); structChanged(); requestRender(); return keys;
  }
  function soundLinkDialog() {
    const L = selLayer(); if (!L || L.type === 'audio') return toast('Select the clip that should move (a video, image, text …).');
    const snd = P.layers.filter(l => l !== L && (l.type === 'audio' || l.type === 'video') && media[l.media] && l.start < L.start + L.dur && l.start + l.dur > L.start); if (!snd.length) return toast('No sound clip overlaps this clip.');
    const o = { src: snd[0].id, prop: 's', amount: PROPS.s[2], smooth: 50 };
    showModal('Sound link (Lab)', el('div', { class: 'lab' }, el('p', { class: 'dim' }, `The sound's level drives ${L.name}. It is written as keyframes, so you can edit or delete them later.`),
      field('Sound from', o, 'src', 'select', { opts: snd.map(l => l.id), names: id => P.layers.find(l => l.id === id).name }),
      field('Property', o, 'prop', 'select', { opts: Object.keys(PROPS), names: k => PROPS[k][0], cb: () => { o.amount = PROPS[o.prop][2]; } }), field('Amount', o, 'amount', 'num', { step: 5 }), field('Smoothing (%)', o, 'smooth', 'num', { min: 0, max: 95, step: 5 })),
      [['Cancel', closeModal], ['Link', async () => { try { const k = await soundLink(L, P.layers.find(l => l.id === o.src), o.prop, { amount: +o.amount, smooth: o.smooth / 100 }); closeModal(); toast(`${k.length} keyframes from the sound`); } catch (e) { toast(e.message); } }, true]]);
  }
  return { record, entry, diff, say, goTo, timeMachine, drawLayout, frames, replay, pacing, pacingDialog, PROPS, soundLink, soundLinkDialog };
})();
