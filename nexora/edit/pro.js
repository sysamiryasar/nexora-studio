'use strict';
/* ====================== NEXORA pro editing ======================
   Keyboard-driven editing in the style of Premiere / Resolve / Avid:
     J K L        shuttle (reverse / stop / forward; press again for 2×, 4×, 8×)
     I  O  X      mark In / Out / mark the selected clip   ·   Alt+X clear   ·   Shift+I / Shift+O go to In / Out
     ,  .         insert / overwrite the selected media at the playhead (or into the In–Out range: three-point edit)
     ;  '         lift / extract the In–Out range across all layers
     Q  W         ripple-trim the selected clip's start / end to the playhead
     Shift+Del    ripple delete         Shift+S   cut every clip at the playhead
     Alt+← / →    slip the selected clip one frame (Shift = 10)      Shift+R  roll the edit at the selected clip's end to the playhead
     ↑ / ↓        previous / next edit point      Shift+↑ / ↓  previous / next marker
   The previous meanings of I, O and K stay on Alt+I (eyedropper), Alt+O (ellipse) and Alt+K (keyframe all).
   "Ripple" moves later clips: every layer that starts at or after the edit point, so sync between layers is kept. */
const Pro = (() => {
  const io = () => P.io || (P.io = { in: null, out: null });
  const fr = () => 1 / (P.fps || 30), eps = 1e-4;
  const sel = () => selLayer();
  const done = msg => { commit(); structChanged(); if (msg) toast(msg); };
  /** shift every layer that starts at/after t by d seconds (except those in `skip`) */
  function ripple(t, d, skip) { for (const L of P.layers) if (!(skip && skip.includes(L)) && L.start >= t - eps) L.start = Math.max(0, +(L.start + d).toFixed(4)); P.markers = (P.markers || []).map(m => m >= t - eps ? Math.max(0, m + d) : m); grow(); }
  function grow() { const end = Math.max(1, ...P.layers.map(l => l.start + l.dur)); if (end > P.dur) P.dur = Math.ceil(end); }

  /* ---------- transport ---------- */
  function shuttle(dir) {
    if (dir === 0) { pause(); return; }
    const cur = playing ? playRate : 0, same = Math.sign(cur) === dir;
    const next = same ? Math.sign(cur) * Math.min(8, Math.abs(cur) * 2) : dir;
    if (playing) pause(); playRate = next; if (T >= P.dur - .02 && next > 0) T = 0; ensureAudio(); playing = true; playT0 = T; wall0 = performance.now(); uiPlayState(); status();
  }
  const status = () => { const e = document.getElementById('perfRead'); if (e && playing && Math.abs(playRate) !== 1) e.textContent = `${playRate > 0 ? '▶' : '◀'} ${Math.abs(playRate)}×`; };

  /* ---------- in / out ---------- */
  const markIn = () => { const r = io(); r.in = T; if (r.out != null && r.out <= r.in) r.out = null; done('In ' + tcFmt(T)); };
  const markOut = () => { const r = io(); r.out = T; if (r.in != null && r.in >= r.out) r.in = null; done('Out ' + tcFmt(T)); };
  const markClip = () => { const L = sel(); if (!L) return toast('Select a clip.'); Object.assign(io(), { in: L.start, out: L.start + L.dur }); done('In/Out = ' + L.name); };
  const clearIO = () => { P.io = { in: null, out: null }; done('In/Out cleared'); };
  const range = () => { const r = io(); return r.in != null && r.out != null && r.out > r.in ? [r.in, r.out] : null; };

  /* ---------- edit points ---------- */
  function editPoints() { const s = new Set([0, P.dur]); for (const L of P.layers) { s.add(+L.start.toFixed(4)); s.add(+(L.start + L.dur).toFixed(4)); } return [...s].sort((a, b) => a - b); }
  const nextEdit = d => { const pts = editPoints(), t = d > 0 ? pts.find(p => p > T + eps) : [...pts].reverse().find(p => p < T - eps); if (t != null) seek(t); };
  const nextMarker = d => { const m = (P.markers || []).slice().sort((a, b) => a - b), t = d > 0 ? m.find(p => p > T + eps) : [...m].reverse().find(p => p < T - eps); if (t != null) seek(t); else toast('No more markers'); };

  /* ---------- trimming ---------- */
  function rippleTrimStart() {   // Q: remove the part before the playhead, close the gap
    const L = sel(); if (!L || T <= L.start + eps || T >= L.start + L.dur - eps) return toast('Put the playhead inside the selected clip.');
    const cut = T - L.start, oldEnd = L.start + L.dur; L.srcIn += cut * L.speed; L.dur -= cut; for (const k in L.kf) L.kf[k] = L.kf[k].map(f => Object.assign({}, f, { t: f.t - cut })).filter(f => f.t >= -eps);
    ripple(oldEnd, -cut, [L]); seek(L.start); done('Ripple trim start');
  }
  function rippleTrimEnd() {     // W: remove the part after the playhead, close the gap
    const L = sel(); if (!L || T <= L.start + eps || T >= L.start + L.dur - eps) return toast('Put the playhead inside the selected clip.');
    const oldEnd = L.start + L.dur, cut = oldEnd - T; L.dur -= cut; ripple(oldEnd, -cut, [L]); done('Ripple trim end');
  }
  function rippleDelete() { const L = sel(); if (!L) return; const end = L.start + L.dur, d = L.dur; removeLayer(L.id); ripple(end, -d); done('Ripple delete'); }
  function slip(frames) {        // same place on the timeline, different part of the source
    const L = sel(); if (!L || !(L.type === 'video' || L.type === 'audio')) return toast('Slip needs a video or audio clip.');
    const m = media[L.media], max = Math.max(0, (m ? m.dur : 0) - L.dur * L.speed); L.srcIn = clamp(L.srcIn + frames * fr() * L.speed, 0, max); done(`Slip ${frames > 0 ? '+' : ''}${frames}f · source in ${tcFmt(L.srcIn)}`);
  }
  /** roll: move the edit point between the selected clip and the clip that starts where it ends, to the playhead */
  function roll() {
    const A = sel(); if (!A) return toast('Select the clip before the cut.'); const cut = A.start + A.dur, B = P.layers.find(l => l !== A && Math.abs(l.start - cut) < fr() / 2);
    if (!B) return toast('No clip starts where the selected clip ends.'); const d = T - cut; if (Math.abs(d) < eps) return;
    if (A.dur + d < fr() || B.dur - d < fr()) return toast('Roll would make a clip shorter than one frame.');
    if (B.type === 'video' || B.type === 'audio') { const m = media[B.media]; if (B.srcIn + d * B.speed < -eps || (m && B.srcIn + (B.dur - d) * B.speed + d * B.speed > m.dur + eps && d < 0)) return toast('Not enough source media for that roll.'); }
    A.dur += d; B.start += d; B.dur -= d; B.srcIn = Math.max(0, B.srcIn + d * B.speed); for (const k in B.kf) B.kf[k] = B.kf[k].map(f => Object.assign({}, f, { t: f.t - d })); done(`Roll edit ${d > 0 ? '+' : ''}${d.toFixed(2)}s`);
  }
  function cutAll() { const hits = P.layers.filter(L => T > L.start + eps && T < L.start + L.dur - eps); for (const L of hits.slice()) splitLayer(L, T); done(`Cut ${hits.length} clip(s) at ${tcFmt(T)}`); }

  /* ---------- three-point editing ---------- */
  function sourceMedia() { return typeof selMedia !== 'undefined' && selMedia && media[selMedia] ? media[selMedia] : Object.values(media).slice(-1)[0] || null; }
  /** remove the time range [a, b) from every layer that passes `keep`, splitting clips that cross a or b */
  function cutRange(a, b, which) {
    for (const L of P.layers.slice()) {
      if (which && !which(L)) continue; const s = L.start, e = L.start + L.dur; if (e <= a + eps || s >= b - eps) continue;
      if (s < a - eps && e > b + eps) { const B = splitLayer(L, a); splitLayer(B, b); removeLayer(B.id); }   // middle piece goes
      else if (s < a - eps) removeLayer(splitLayer(L, a).id);                                                // keep the head
      else if (e > b + eps) { splitLayer(L, b); removeLayer(L.id); }                                         // keep the tail
      else removeLayer(L.id);
    }
  }
  const sameTrack = m => L => m.kind === 'audio' ? L.type === 'audio' : (L.type === 'video' || L.type === 'image');
  function place(mode) {
    const m = sourceMedia(); if (!m) return toast('Import media and select it in the Media panel first.');
    const r = range(), at = r ? r[0] : T, srcDur = m.kind === 'image' ? 5 : m.dur, dur = r ? Math.min(r[1] - r[0], srcDur) : srcDur;
    if (mode === 'insert') { for (const L of P.layers.slice()) if (at > L.start + eps && at < L.start + L.dur - eps) splitLayer(L, at); ripple(at, dur); }   // cut through, push everything later
    else cutRange(at, at + dur, sameTrack(m));                                                                                                       // replace what was there
    const n0 = P.layers.length; addMediaLayer(m, at); const N = P.layers.length > n0 ? P.layers[P.layers.length - 1] : selLayer(); if (N) { N.start = at; N.dur = dur; selId = N.id; }
    grow(); done(`${mode === 'insert' ? 'Insert' : 'Overwrite'}: ${m.name} at ${tcFmt(at)}${r ? ' (In–Out)' : ''}`); return N;
  }
  /* ---------- lift / extract ---------- */
  function liftExtract(extract) {
    const r = range(); if (!r) return toast('Mark In and Out first (I / O).'); const [a, b] = r;
    cutRange(a, b); if (extract) ripple(b, -(b - a)); clearIOsilent(); seek(a); done(extract ? 'Extract (gap closed)' : 'Lift (gap left)');
  }
  const clearIOsilent = () => { P.io = { in: null, out: null }; };
  function closeGaps() {   // pull every clip left so nothing on the timeline is preceded by empty time
    const L = sel(); if (!L) return toast('Select a clip.'); const before = P.layers.filter(x => x !== L && x.start + x.dur <= L.start + eps), end = before.length ? Math.max(...before.map(x => x.start + x.dur)) : 0, gap = L.start - end; if (gap < eps) return toast('No gap before this clip.'); ripple(L.start, -gap); done(`Closed a ${gap.toFixed(2)}s gap`);
  }

  /* ---------- keyboard (capture phase: runs before the general Edit shortcuts) ---------- */
  window.addEventListener('keydown', e => {
    if (typeof Shell !== 'undefined' && Shell.active !== 'edit') return;
    const tg = e.target; if (tg.matches && tg.matches('input:not([type=range]):not([type=checkbox]):not([type=color]),textarea,select,[contenteditable]')) return;
    if (e.ctrlKey || e.metaKey) return; const k = e.key.toLowerCase(), S = e.shiftKey, A = e.altKey; let hit = true;
    if (A && k === 'i') setTool('eyedrop'); else if (A && k === 'o') setTool('ellipse'); else if (A && k === 'k') keyAll();
    else if (A && k === 'x') clearIO();
    else if (A && e.key === 'ArrowLeft') slip(S ? -10 : -1); else if (A && e.key === 'ArrowRight') slip(S ? 10 : 1);
    else if (A) hit = false;
    else if (k === 'j') shuttle(-1); else if (k === 'k') shuttle(0); else if (k === 'l') shuttle(1);
    else if (k === 'i') S ? (io().in != null && seek(io().in)) : markIn(); else if (k === 'o') S ? (io().out != null && seek(io().out)) : markOut();
    else if (k === 'x') markClip(); else if (k === 'q') rippleTrimStart(); else if (k === 'w') rippleTrimEnd();
    else if (e.key === ',') place('insert'); else if (e.key === '.') place('overwrite');
    else if (e.key === ';') liftExtract(false); else if (e.key === "'") liftExtract(true);
    else if (S && (e.key === 'Delete' || e.key === 'Backspace')) rippleDelete();
    else if (S && k === 's') cutAll(); else if (S && k === 'r') roll();
    else if (e.key === 'ArrowUp') S ? nextMarker(-1) : nextEdit(-1); else if (e.key === 'ArrowDown') S ? nextMarker(1) : nextEdit(1);
    else hit = false;
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  const KEYS = [['J / K / L', 'Shuttle reverse / stop / forward (repeat for 2× 4× 8×)'], ['I / O', 'Mark In / Out'], ['Shift+I / O', 'Go to In / Out'], ['X / Alt+X', 'Mark clip / clear In–Out'], [', / .', 'Insert / overwrite selected media (three-point)'], ['; / \'', 'Lift / extract In–Out'], ['Q / W', 'Ripple trim start / end to playhead'], ['Shift+Del', 'Ripple delete'], ['Shift+S', 'Cut all clips at playhead'], ['Shift+R', 'Roll edit to playhead'], ['Alt+← / →', 'Slip 1 frame (Shift: 10)'], ['↑ / ↓', 'Previous / next edit'], ['Shift+↑ / ↓', 'Previous / next marker'], ['Alt+I / Alt+O / Alt+K', 'Eyedropper / ellipse / keyframe all']];
  return { io, range, markIn, markOut, markClip, clearIO, shuttle, nextEdit, nextMarker, rippleTrimStart, rippleTrimEnd, rippleDelete, slip, roll, cutAll, place, liftExtract, closeGaps, editPoints, KEYS };
})();
