'use strict';
/* ====================== NEXORA beat grid ======================
   Right-click a music clip › Beat grid: NEXORA finds its beat (Analysis.beats) and draws the beats as ticks on the
   ruler, downbeats taller. Clips, the playhead and trims snap to beats while snapping is on. The beats are stored in
   the music's own time (P.beatGrid = { layer, src: [source seconds], bpm }), so moving or trimming the music clip
   moves the grid with it. "Beats to markers" turns them into ordinary markers; Clear removes the grid. */
const BeatGrid = (() => {
  const grid = () => P.beatGrid || null;
  const layer = () => { const g = grid(); return g && P.layers.find(x => x.id === g.layer) || null; };
  /** beat times on the timeline right now (only where the music clip is) */
  function times() { const g = grid(), L = layer(); if (!g || !L) return []; const out = []; for (const s of g.src) { const t = L.start + (s - L.srcIn) / (L.speed || 1); if (t >= L.start - 1e-6 && t <= L.start + L.dur + 1e-6) out.push(+t.toFixed(4)); } return out; }
  async function detect(L) {
    if (!L || !media[L.media] || (L.type !== 'audio' && L.type !== 'video')) { toast('Right-click a music clip to find its beat.'); return null; }
    toast('Finding the beat…'); const r = await Analysis.beats(L), sp = L.speed || 1;
    P.beatGrid = { layer: L.id, src: r.beats.map(t => +(L.srcIn + (t - L.start) * sp).toFixed(4)), bpm: r.bpm, snap: true }; commit(); renderTimeline();
    toast(`${r.bpm} BPM · ${r.beats.length} beats on the ruler; clips snap to them`); return P.beatGrid;
  }
  function clear() { delete P.beatGrid; commit(); renderTimeline(); }
  function toMarkers(every = 1) { const ts = times().filter((_, i) => i % every === 0); if (!ts.length) return 0; Analysis.addMarkers(ts); return ts.length; }
  /** snap targets for timeline.js */
  const snapTimes = () => { const g = grid(); return g && g.snap !== false ? times() : []; };
  /** ruler ticks (called by drawRuler) */
  function draw(rl, t0, t1, pps) { const ts = times(); if (!ts.length) return; ts.forEach((t, i) => { if (t < t0 || t > t1) return; rl.append(el('div', { class: 'bt' + (i % 4 === 0 ? ' down' : ''), style: `left:${t * pps}px` })); }); }
  return { grid, layer, times, detect, clear, toMarkers, snapTimes, draw };
})();
