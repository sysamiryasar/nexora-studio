'use strict';
/* ====================== timeline ====================== */
const HD = 210;
let pps = 80, snapOn = true;
const tlc = document.getElementById('tlc'), tlscroll = document.getElementById('tlscroll');
let tlPending = false, lastTC = -1, lastProps = 0;
function uiTimelineLite() { if (tlPending) return; tlPending = true; requestAnimationFrame(() => { tlPending = false; renderTimeline(); }); }

const tcFmt = t => { const f = Math.floor(t * P.fps + 1e-6), fr = f % Math.round(P.fps), s = Math.floor(f / P.fps), m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(fr).padStart(2, '0')}`; };
/* full timecode for the viewer, timeline and ruler: hours:minutes:seconds:frames */
const tcFull = t => { const fps = Math.round(P.fps) || 30, f = Math.floor(t * P.fps + 1e-6), fr = f % fps, s = Math.floor(f / P.fps), p = n => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(fr)}`; };
let tcEls = null;
function uiTime() {
  if (!tcEls) tcEls = ['tc', 'tcDur', 'tlTC'].map(id => document.getElementById(id));
  const now = tcFull(T), put = (e, v) => { if (e && !e.firstElementChild) e.textContent = v; };   // a readout being typed into (go to timecode) is left alone
  put(tcEls[0], now); put(tcEls[1], tcFull(P.dur)); put(tcEls[2], now);
  const ph = document.getElementById('ph');
  if (ph) { ph.style.transform = `translateX(${T * pps}px)`; if (playing) { const x = HD + T * pps, v = tlscroll.scrollLeft, w = tlscroll.clientWidth; if (x > v + w - 40 || x < v + HD) tlscroll.scrollLeft = x - HD - 60; } }
  if (T !== lastTC) { lastTC = T; const now = performance.now(); if (!playing || now - lastProps > 120) { lastProps = now; uiProps(); drawGraph(); } }   // the inspector does not need 60 updates a second during playback
}
function uiPlayState() { const b = document.getElementById('bPlay'); b.innerHTML = ''; b.append(Icon(playing ? 'tpause' : 'tplay', 16)); }
function uiHistory() { document.getElementById('btnUndo').disabled = hist.i <= 0; document.getElementById('btnRedo').disabled = hist.i >= hist.stack.length - 1; }

function niceStep() { const fr = 1 / (P.fps || 30); for (const s of [fr, 2 * fr, 5 * fr, 10 * fr, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pps >= 96) return s; return 600; }
function fmtRuler(t) { return tcFull(t + 1e-4); }
function snapTime(v, dur, ex) {
  snapHit = null; if (!snapOn) return v;
  const pts = [0, T, P.dur, ...(P.markers || []), ...(typeof BeatGrid !== 'undefined' ? BeatGrid.snapTimes() : [])]; P.layers.forEach(l => { if (l !== ex) { pts.push(l.start, l.start + l.dur); } });
  const th = 8 / pps; let best = null, bd = th, hit = null;
  for (const p of pts) { let d = Math.abs(v - p); if (d < bd) { bd = d; best = p; hit = p; } if (dur) { d = Math.abs(v + dur - p); if (d < bd) { bd = d; best = p - dur; hit = p; } } }
  snapHit = hit; return best === null ? v : best;
}
const laneX = (e, lane) => (e.clientX - lane.getBoundingClientRect().left) / pps;

/* The timeline only builds what is on screen: rows outside the viewport become spacers and clips outside it are skipped,
   so an edit with thousands of clips costs the same to redraw as a small one.
   Tracks view stacks clips that do not overlap onto one row. Stacking order is preserved: a clip always sits on a row above
   anything it overlaps and is in front of. Audio gets its own rows under the picture. */
/* track height: S / M / L (remembered); large rows give thumbnails and waveforms room */
const ROW_SIZES = { S: 26, M: 38, L: 62 };
let ROW_H = (() => { try { return ROW_SIZES[localStorage.getItem('nx.tl.rowh')] || 38; } catch (e) { return 38; } })();
const SUB_H = 20, RULER_H = 24;
{ const k = Object.keys(ROW_SIZES).find(x => ROW_SIZES[x] === ROW_H) || 'M'; document.body.dataset.rowh = k; const b = document.getElementById('tRowH'); if (b) b.textContent = 'Rows ' + k; }
function setRowHeight(k) { if (!ROW_SIZES[k]) return; ROW_H = ROW_SIZES[k]; try { localStorage.setItem('nx.tl.rowh', k); } catch (e) { } document.body.dataset.rowh = k; const b = document.getElementById('tRowH'); if (b) b.textContent = 'Rows ' + k; renderTimeline(); }
let compactTracks = (() => { try { return localStorage.getItem('nx.tl.tracks') !== '0'; } catch (e) { return true; } })(), tlDrag = false, tlWin = null, snapHit = null, phEl = null, snapEl = null;
const isCompact = () => compactTracks && !compStack.length && !(typeof Motion !== 'undefined' && Motion.S.inMotion);
function assignLanes(list) {
  const lanes = [], eps = 1e-6;
  const hits = (lane, L) => { let lo = 0, hi = lane.length; while (lo < hi) { const m = (lo + hi) >> 1; if (lane[m].start < L.start) lo = m + 1; else hi = m; } const prev = lane[lo - 1], next = lane[lo]; return { lo, hit: !!((prev && prev.start + prev.dur > L.start + eps) || (next && next.start < L.start + L.dur - eps)) }; };
  for (const L of list) { let k = lanes.length - 1; while (k >= 0 && !hits(lanes[k], L).hit) k--; k++; const lane = lanes[k] || (lanes[k] = []); lane.splice(hits(lane, L).lo, 0, L); }
  return lanes;
}
const laneGroups = () => ({ v: assignLanes(P.layers.filter(l => l.type !== 'audio')), a: assignLanes(P.layers.filter(l => l.type === 'audio')) });
function laneIndex(L) { const g = laneGroups(), set = L.type === 'audio' ? g.a : g.v; return set.findIndex(l => l.includes(L)); }
function buildRows() {
  const rows = [], subs = L => { if (L.open) Object.keys(L.kf).filter(k => L.kf[k].length).forEach(k => rows.push({ h: SUB_H, L, k })); };
  if (!isCompact()) { for (let i = P.layers.length - 1; i >= 0; i--) { rows.push({ h: ROW_H, L: P.layers[i], clips: [P.layers[i]] }); subs(P.layers[i]); } return rows; }
  const g = laneGroups(), add = (clips, label) => { rows.push({ h: ROW_H, label, clips }); const s = clips.find(c => c.id === selId); if (s) subs(s); };
  for (let i = g.v.length - 1; i >= 0; i--) add(g.v[i], 'V' + (i + 1));
  g.a.forEach((c, i) => add(c, 'A' + (i + 1)));
  return rows;
}
function drawRuler(W, t0, t1) {
  const rl = el('div', { class: 'lane rl', style: `width:${W}px` }), step = niceStep(), minor = step / (step >= 1 ? 5 : 2), end = Math.min(W / pps, t1);
  if (minor * pps >= 10 || true) for (let n = Math.max(0, Math.floor(t0 / minor)), t = n * minor; t <= end; n++, t = n * minor) { const major = Math.abs(t / step - Math.round(t / step)) < 1e-6; if (!major && minor * pps < 10) continue; const tk = el('div', { class: 'tick' + (major ? ' major' : ''), style: `left:${t * pps}px` }); if (major) tk.append(el('span', {}, fmtRuler(Math.round(t * 100) / 100))); rl.append(tk); }
  rl.append(el('div', { style: `position:absolute;top:0;bottom:0;left:${P.dur * pps}px;width:2px;background:#7cc8ff55` }));
  if (typeof RenderCache !== 'undefined' && RenderCache.segs.size) rl.append(...RenderCache.marks(pps));
  { const r = P.io || {}; if (r.in != null || r.out != null) { const a = r.in ?? 0, b = r.out ?? P.dur; rl.append(el('div', { class: 'iorange', style: `left:${a * pps}px;width:${Math.max(2, (b - a) * pps)}px`, title: `In ${tcFmt(a)} · Out ${tcFmt(b)} (Alt+X clears)` })); } }
  if (typeof BeatGrid !== 'undefined' && P.beatGrid) BeatGrid.draw(rl, t0, t1, pps);
  (P.markers || []).forEach(mt => { if (mt < t0 || mt > t1) return; const mi = typeof Markers !== 'undefined' ? Markers.info(mt) : { name: '', color: 'sky' }, mc = typeof Markers !== 'undefined' && Markers.COLORS[mi.color] ? Markers.COLORS[mi.color][1] : '';
    const mk = el('div', { class: 'mk', 'data-t': mt, style: `left:${mt * pps}px` + (mc ? `;--mkc:${mc}` : ''), title: (mi.name ? mi.name + ' · ' : 'Marker ') + tcFmt(mt) + (mi.note ? '\n' + mi.note : '') + '\n(double-click to name, colour or delete)' }, mi.name ? el('span', { class: 'mk-lbl' }, mi.name) : '');
    mk.onpointerdown = e => e.stopPropagation(); mk.onclick = () => seek(mt); mk.ondblclick = e => { if (typeof Markers !== 'undefined') Markers.edit(mt, e.clientX, e.clientY + 10); else { P.markers.splice(P.markers.indexOf(mt), 1); commit(); renderTimeline(); } }; rl.append(mk); });
  const scrub = e => { seek(Math.max(0, laneX(e, rl))); };
  rl.onpointerdown = e => { rl.setPointerCapture(e.pointerId); scrub(e); rl._d = true; }; rl.onpointermove = e => { if (rl._d) scrub(e); }; rl.onpointerup = () => rl._d = false;
  return rl;
}
function layerHeader(L, sel, keys) {
  const hd = el('div', { class: 'hd' + (sel ? ' sel' : ''), style: `height:${ROW_H}px`, draggable: 'true' });
  hd.append(
    el('button', { class: keys.length ? 'act' : '', title: 'Show keyframes', style: keys.length ? '' : 'visibility:hidden', onclick: ev => { ev.stopPropagation(); L.open = !L.open; renderTimeline(); } }, L.open ? '▾' : '▸'),
    el('span', { style: `width:8px;height:8px;border-radius:2px;background:var(--${L.type});flex:none` }),
    el('span', { class: 'nm', title: L.name }, L.name),
    el('button', { class: L.muted ? '' : 'act', title: 'Mute', style: L.type === 'video' || L.type === 'audio' ? '' : 'display:none', onclick: ev => { ev.stopPropagation(); L.muted = !L.muted; commit(); renderTimeline(); requestRender(); } }, Icon(L.muted ? 'mute' : 'volume', 14)),
    el('button', { class: L.solo ? 'act' : '', title: 'Solo', onclick: ev => { ev.stopPropagation(); L.solo = !L.solo; renderTimeline(); requestRender(); } }, 'S'),
    el('button', { class: L.visible ? 'act' : '', title: 'Show / hide', onclick: ev => { ev.stopPropagation(); L.visible = !L.visible; commit(); renderTimeline(); requestRender(); } }, Icon(L.visible ? 'eye' : 'eyeOff', 14)),
    el('button', { class: L.locked ? 'act' : '', title: 'Lock', onclick: ev => { ev.stopPropagation(); L.locked = !L.locked; commit(); renderTimeline(); } }, Icon(L.locked ? 'lock' : 'unlock', 14)));
  hd.onclick = () => { selId = L.id; uiSel(); };
  hd.ondragstart = e => e.dataTransfer.setData('text/layer-id', L.id);
  hd.ondragover = e => { if (e.dataTransfer.types.includes('text/layer-id')) { e.preventDefault(); hd.classList.add('dragover'); } };
  hd.ondragleave = () => hd.classList.remove('dragover');
  hd.ondrop = e => { const id = e.dataTransfer.getData('text/layer-id'); if (!id) return; e.preventDefault(); const M = P.layers.find(l => l.id === id); if (!M || M === L) return; P.layers.splice(P.layers.indexOf(M), 1); P.layers.splice(P.layers.indexOf(L) + 1, 0, M); commit(); renderTimeline(); requestRender(); };
  return hd;
}
/* a track's buttons act on every clip on that row */
function trackHeader(r) {
  const cl = r.clips, A = cl.filter(c => c.type === 'video' || c.type === 'audio'), s = cl.find(c => c.id === selId), keys = s ? Object.keys(s.kf).filter(k => s.kf[k].length) : [], every = f => cl.every(f);
  const flip = (list, key, push) => ev => { ev.stopPropagation(); const v = !list.every(c => c[key]); list.forEach(c => c[key] = v); if (push) commit(); renderTimeline(); requestRender(); };
  const showing = every(c => c.visible), locked = every(c => c.locked), solo = every(c => c.solo), muted = A.length && A.every(c => c.muted);
  return el('div', { class: 'hd' + (s ? ' sel' : ''), style: `height:${ROW_H}px` },
    el('button', { class: keys.length ? 'act' : '', title: 'Show keyframes of the selected clip', style: keys.length ? '' : 'visibility:hidden', onclick: ev => { ev.stopPropagation(); s.open = !s.open; renderTimeline(); } }, s && s.open ? '▾' : '▸'),
    el('b', { class: 'tk-tag' }, r.label), el('span', { class: 'nm', title: s ? s.name : '' }, s ? s.name : `${cl.length} clip${cl.length === 1 ? '' : 's'}`),
    el('button', { class: muted ? '' : 'act', title: 'Mute track', style: A.length ? '' : 'display:none', onclick: flip(A, 'muted', true) }, Icon(muted ? 'mute' : 'volume', 14)),
    el('button', { class: solo ? 'act' : '', title: 'Solo track', onclick: flip(cl, 'solo') }, 'S'),
    el('button', { class: showing ? 'act' : '', title: 'Show / hide track', onclick: flip(cl, 'visible', true) }, Icon(showing ? 'eye' : 'eyeOff', 14)),
    el('button', { class: locked ? 'act' : '', title: 'Lock track', onclick: flip(cl, 'locked', true) }, Icon(locked ? 'lock' : 'unlock', 14)));
}
function renderTimeline() {
  const W = Math.max(P.dur + 6, 12) * pps; tlc.style.width = (HD + W) + 'px';
  const vw = tlscroll.clientWidth || 1200, vh = tlscroll.clientHeight || 400, sl = tlscroll.scrollLeft, st = tlscroll.scrollTop, t0 = Math.max(0, (sl - vw) / pps), t1 = (sl + vw * 2) / pps, rows = buildRows(), f = document.createDocumentFragment();
  let y = 0, a = -1, b = -1; const lo = st - RULER_H - 300, hi = st + vh + 300; rows.forEach((r, i) => { r.y = y; y += r.h; if (y > lo && a < 0) a = i; if (r.y < hi) b = i; }); if (a < 0) a = 0;
  f.append(el('div', { class: 'row ruler' }, el('div', { class: 'hd' }, isCompact() ? 'Tracks' : 'Layers  (top = front)'), drawRuler(W, t0, t1)));
  if (rows[a] && rows[a].y > 0) f.append(el('div', { style: `height:${rows[a].y}px` }));
  for (let i = a; i <= b && i < rows.length; i++) {
    const r = rows[i];
    if (r.k) { const sl_ = el('div', { class: 'lane sub', style: `width:${W}px;height:20px` }); r.L.kf[r.k].forEach(k => sl_.append(makeKf(r.L, r.k, k, sl_))); f.append(el('div', { class: 'row' }, el('div', { class: 'hd sub', style: 'height:20px' }, propLabel(r.L, r.k)), sl_)); continue; }
    const lane = el('div', { class: 'lane', style: `width:${W}px;height:${ROW_H}px` });
    lane.onpointerdown = e => { if (e.target === lane) { selId = null; uiSel(); } };
    for (const L of r.clips) if (L.id === selId || (L.start + L.dur >= t0 && L.start <= t1)) lane.append(makeClip(L, lane, L.id === selId));
    f.append(el('div', { class: 'row' + (r.label ? ' tk' : '') }, r.label ? trackHeader(r) : layerHeader(r.L, r.L.id === selId, Object.keys(r.L.kf).filter(k => r.L.kf[k].length)), lane));
  }
  const last = rows[Math.min(b, rows.length - 1)]; if (last && y - (last.y + last.h) > 0) f.append(el('div', { style: `height:${y - (last.y + last.h)}px` }));
  if (!phEl) { phEl = el('div', { id: 'ph' }); snapEl = el('div', { id: 'snapLine', class: 'hidden' }); }
  phEl.style.left = HD + 'px'; phEl.style.transform = `translateX(${T * pps}px)`; f.append(phEl, snapEl);
  tlc.replaceChildren(f); tlWin = { st, sl, vw }; uiHistory();
}
tlscroll.addEventListener('scroll', () => { if (tlScrollQ) return; tlScrollQ = true; requestAnimationFrame(() => { tlScrollQ = false; if (tlDrag || !tlWin) return; if (Math.abs(tlscroll.scrollTop - tlWin.st) > 200 || Math.abs(tlscroll.scrollLeft - tlWin.sl) > tlWin.vw * .7) renderTimeline(); }); }, { passive: true });
let tlScrollQ = false;
/* one waveform per clip and size, drawn once. Widths are rounded up to powers of two so zooming reuses them. */
const WAVES = new Map();
function waveFor(L, m) {
  const px = Math.max(8, L.dur * pps), w = Math.min(2048, 1 << Math.ceil(Math.log2(px))), key = `${L.id}|${L.media}|${L.srcIn.toFixed(3)}|${L.dur.toFixed(3)}|${L.speed}|${w}|${m.peaks.length}`; let cv = WAVES.get(key);
  if (cv) { WAVES.delete(key); WAVES.set(key, cv); return cv; }
  cv = mkCanvas(w, 20); const x = cv.getContext('2d'); x.fillStyle = '#fff'; const a = L.srcIn * 50, b = (L.srcIn + L.dur * L.speed) * 50;
  for (let i = 0; i < w; i++) { const v = m.peaks[Math.floor(a + (b - a) * i / w)] || 0, h = Math.max(1, v * 20); x.fillRect(i, (20 - h) / 2, 1, h); }
  WAVES.set(key, cv); if (WAVES.size > 500) WAVES.delete(WAVES.keys().next().value); return cv;
}
/** moves a clip to another track by changing its stacking order. rowsDown: positive = lower on screen. */
function moveToTrack(L, rowsDown) {
  const isA = L.type === 'audio', delta = isA ? rowsDown : -rowsDown, cur = laneIndex(L), target = Math.max(0, cur + delta), dir = delta > 0 ? 1 : -1, i0 = P.layers.indexOf(L); if (!delta || target === cur) return false;
  for (let g = P.layers.length; g > 0; g--) { const lane = laneIndex(L); if (dir > 0 ? lane >= target : lane <= target) break; const i = P.layers.indexOf(L), j = i + dir; if (j < 0 || j >= P.layers.length) break; P.layers[i] = P.layers[j]; P.layers[j] = L; }
  if (laneIndex(L) === cur) { const i = P.layers.indexOf(L); P.layers.splice(i, 1); P.layers.splice(i0, 0, L); return false; }
  return true;
}
function setCompactTracks(on) { compactTracks = !!on; try { localStorage.setItem('nx.tl.tracks', on ? '1' : '0'); } catch (e) { } const b = document.getElementById('tTracks'); if (b) b.classList.toggle('on', compactTracks); renderTimeline(); }
function zoomTo(v, clientX) { const box = tlscroll.getBoundingClientRect(), x = clientX === undefined ? Math.max(HD + 40, Math.min(box.width - 40, HD + T * pps - tlscroll.scrollLeft)) : clientX - box.left, t = (x + tlscroll.scrollLeft - HD) / pps; pps = clamp(v, 2, 400); const s = document.getElementById('tZoom'); if (s) s.value = pps; tlc.style.width = (HD + Math.max(P.dur + 6, 12) * pps) + 'px'; tlscroll.scrollLeft = Math.max(0, t * pps + HD - x); renderTimeline(); }
function zoomFit() { const end = P.layers.reduce((e, l) => Math.max(e, l.start + l.dur), 0) || P.dur; pps = clamp((tlscroll.clientWidth - HD - 40) / Math.max(1, end), 2, 400); const s = document.getElementById('tZoom'); if (s) s.value = pps; tlscroll.scrollLeft = 0; renderTimeline(); }

function makeClip(L, lane, sel) {
  const c = el('div', { class: `clip t-${L.type}` + (sel ? ' sel' : '') + (L.visible ? '' : ' dis'), 'data-id': L.id, style: `left:${L.start * pps}px;width:${Math.max(6, L.dur * pps)}px` + (L.label && typeof CLIP_LABELS !== 'undefined' && CLIP_LABELS[L.label] ? `;background-color:${CLIP_LABELS[L.label][1]}` : '') });
  const m = media[L.media];
  if (m && m.thumb && L.type !== 'audio') { c.style.backgroundImage = `url(${m.thumb})`; c.style.backgroundRepeat = 'repeat-x'; }
  if (m && m.peaks) c.append(waveFor(L, m));
  if (L.tin.type !== 'none') c.append(el('div', { style: `position:absolute;left:0;top:0;bottom:0;width:${L.tin.dur * pps}px;background:linear-gradient(90deg,#000a,transparent);pointer-events:none` }));
  if (L.tout.type !== 'none') c.append(el('div', { style: `position:absolute;right:0;top:0;bottom:0;width:${L.tout.dur * pps}px;background:linear-gradient(270deg,#000a,transparent);pointer-events:none` }));
  c.append(el('div', { class: 'lbl' }, (L.mask ? '◐ ' : '') + (L.fx.length ? 'fx ' : '') + L.name), el('div', { class: 'h l' }), el('div', { class: 'h r' }));
  c.onpointerdown = e => {
    e.stopPropagation(); if (e.button !== 0) return;
    const wasSel = selId === L.id; selId = L.id; if (!wasSel) { buildInspector(); document.querySelectorAll('.clip.sel').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); document.querySelectorAll('.hd.sel').forEach(x => x.classList.remove('sel')); requestRender(); }
    if (L.locked) return;
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm';
    const x0 = e.clientX, y0 = e.clientY, s0 = L.start, d0 = L.dur, in0 = L.srcIn, kf0 = JSON.stringify(L.kf); let moved = false, rowsD = 0; tlDrag = true;
    const mv = ev => {
      const dx = (ev.clientX - x0) / pps; if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 8) return; moved = true; if (mode === 'm' && isCompact()) { rowsD = Math.round((ev.clientY - y0) / ROW_H); c.style.transform = rowsD ? `translateY(${rowsD * ROW_H}px)` : ''; }
      if (mode === 'm') { L.start = Math.max(0, snapTime(s0 + dx, d0, L)); }
      else if (mode === 'l') {
        let ns = snapTime(s0 + dx, 0, L); const end = s0 + d0; ns = Math.min(ns, end - .1);
        if (L.type === 'video' || L.type === 'audio') ns = Math.max(ns, s0 - in0 / L.speed); ns = Math.max(0, ns);
        const delta = ns - s0; L.start = ns; L.dur = d0 - delta; L.srcIn = in0 + delta * L.speed; L.kf = JSON.parse(kf0); for (const k in L.kf) L.kf[k].forEach(f => f.t -= delta);
      } else {
        let ne = snapTime(s0 + d0 + dx, 0, L); let nd = Math.max(.1, ne - s0);
        if ((L.type === 'video' || L.type === 'audio') && media[L.media]) nd = Math.min(nd, (media[L.media].dur - in0) / L.speed);
        L.dur = nd;
      }
      if (L.start + L.dur > P.dur) P.dur = Math.ceil(L.start + L.dur);
      c.style.left = L.start * pps + 'px'; c.style.width = Math.max(6, L.dur * pps) + 'px'; requestRender(); uiTime(); if (snapEl) { snapEl.classList.toggle('hidden', snapHit === null); if (snapHit !== null) snapEl.style.left = HD + snapHit * pps + 'px'; }
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); tlDrag = false; if (snapEl) snapEl.classList.add('hidden'); if (moved) { if (rowsD) moveToTrack(L, rowsD); commit(); renderTimeline(); buildInspector(); requestRender(); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return c;
}
function makeKf(L, key, f, lane) {
  const k = el('div', { class: 'kf' + (Math.abs(L.start + f.t - T) < .5 / P.fps ? ' on' : ''), style: `left:${(L.start + f.t) * pps}px`, title: `${propLabel(L, key)} = ${(+f.v).toFixed(2)}  ·  ease: ${f.e}\nDrag to retime · double-click to delete · right-click to change easing` });
  k.onpointerdown = e => {
    e.stopPropagation(); if (e.button !== 0) return; selId = L.id; seek(L.start + f.t);
    const x0 = e.clientX, t0 = f.t; let moved = false;
    const mv = ev => { const dt = (ev.clientX - x0) / pps; if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true; f.t = frameQ(Math.max(-L.start, t0 + dt)); k.style.left = (L.start + f.t) * pps + 'px'; requestRender(); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) { L.kf[key].sort((a, b) => a.t - b.t); commit(); renderTimeline(); } buildInspector(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  k.ondblclick = e => { e.stopPropagation(); const a = L.kf[key]; a.splice(a.indexOf(f), 1); if (!a.length) delete L.kf[key]; commit(); renderTimeline(); buildInspector(); requestRender(); };
  k.oncontextmenu = e => { e.preventDefault(); const order = ['inout', 'linear', 'in', 'out', 'back', 'bounce', 'hold']; f.e = order[(order.indexOf(f.e) + 1) % order.length]; toast('Easing → ' + f.e); commit(); renderTimeline(); requestRender(); };
  return k;
}

/* ====================== timeline controls ====================== */
document.getElementById('tZoom').oninput = e => zoomTo(+e.target.value);
document.getElementById('tTracks').onclick = () => setCompactTracks(!compactTracks); document.getElementById('tTracks').classList.toggle('on', compactTracks);
document.getElementById('tFit').onclick = zoomFit;
window.addEventListener('keydown', e => { if (typeof Shell !== 'undefined' && Shell.active !== 'edit') return; const tg = e.target; if (tg.matches && tg.matches('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]')) return; if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === '=' || e.key === '+') zoomTo(pps * 1.3); else if (e.key === '-') zoomTo(pps / 1.3); else if (e.key === '\\') zoomFit(); else return; e.preventDefault(); e.stopImmediatePropagation(); }, true);
tlscroll.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoomTo(pps * Math.exp(-e.deltaY * .002), e.clientX); } else if (e.shiftKey) { e.preventDefault(); tlscroll.scrollLeft += e.deltaY; } }, { passive: false });
tlscroll.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/media-id')) e.preventDefault(); });
tlscroll.addEventListener('drop', e => {
  const id = e.dataTransfer.getData('text/media-id'); if (!id || !media[id]) return; e.preventDefault();
  const x = e.clientX - tlc.getBoundingClientRect().left - HD; addMediaLayer(media[id], Math.max(0, snapTime(x / pps, media[id].dur)));
});
document.getElementById('tSplit').onclick = doSplit;
document.getElementById('tDup').onclick = () => { const L = selLayer(); if (L) { duplicateLayer(L); commit(); } };
document.getElementById('tDel').onclick = doDelete;
document.getElementById('tSnap').onclick = e => { snapOn = !snapOn; e.currentTarget.classList.toggle('on', snapOn); };
function doSplit() {
  const L = selLayer() || P.layers.slice().reverse().find(l => T > l.start + .04 && T < l.start + l.dur - .04);
  if (!L) return toast('Place the playhead inside a clip to split it.');
  if (!splitLayer(L, T)) toast('Playhead must be inside the clip.'); else commit();
}
function doDelete() { const L = selLayer(); if (!L) return; removeLayer(L.id); commit(); }
