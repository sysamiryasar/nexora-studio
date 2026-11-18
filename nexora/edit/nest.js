'use strict';
/* ====================== NEXORA nested clips ======================
   Nest turns a stretch of the edit into one clip (a composition inside the project): every clip that lies wholly
   between In and Out (or, with no In/Out, the selected clip and everything stacked over the same time) moves inside,
   keeping its track order, timing, effects, parenting and mattes. The nest can be trimmed, moved, graded, sped up and
   given effects like any clip; double-click opens it, Unpack puts the clips back. */
const Nest = (() => {
  const eps = 1e-4;
  function pick(a, b) { return P.layers.filter(x => x.start >= a - eps && x.start + x.dur <= b + eps); }
  function nest(layers, name) {
    layers = P.layers.filter(x => layers.includes(x)); if (!layers.length) { toast('Nothing to nest: set In and Out around the clips first.'); return null; }
    const a = Math.min(...layers.map(x => x.start)), b = Math.max(...layers.map(x => x.start + x.dur)), at = P.layers.indexOf(layers[0]), ids = new Set(layers.map(x => x.id));
    // links that cross the nest boundary cannot survive: drop them rather than point at a layer in another timeline
    for (const x of P.layers) { const inside = ids.has(x.id); if (x.parent && ids.has(x.parent) !== inside) setParent(x, ''); if (x.matte && x.matte.src && ids.has(x.matte.src) !== inside) x.matte = { mode: 'none', src: '' }; }
    const C = mkLayer('comp', { name: name || `Nest (${layers.length} clip${layers.length > 1 ? 's' : ''})`, start: +a.toFixed(4), dur: +(b - a).toFixed(4) });
    C.comp = { layers: layers.map(x => { x.start = +(x.start - a).toFixed(4); return x; }), dur: C.dur }; C.nest = true;
    P.layers = P.layers.filter(x => !ids.has(x.id)); P.layers.splice(Math.min(at, P.layers.length), 0, C); selId = C.id; commit(); structChanged();
    toast(`Nested ${layers.length} clip(s) into one: double-click to open, Unpack to undo`); return C;
  }
  function fromIO() {
    const r = Pro.io(); if (r.in != null && r.out != null) return nest(pick(r.in, r.out));
    const s = P.layers.find(x => x.id === selId); if (!s) return toast('Set In and Out (I / O) around the clips, or select a clip.');
    return nest(P.layers.filter(x => x === s || (x.start < s.start + s.dur - eps && x.start + x.dur > s.start + eps && x.start >= s.start - eps && x.start + x.dur <= s.start + s.dur + eps)));
  }
  return { pick, nest, fromIO };
})();
