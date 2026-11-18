'use strict';
/* ====================== NEXORA speed ramps ======================
   A ramp plays the same source footage at a speed that follows a curve (e.g. normal → slow motion → normal). The clip
   is cut into short constant-speed steps (about 8 per second of output, up to 32), so the result plays, scrubs,
   exports and mixes audio exactly like any other clip. Keyframes, markers inside the clip and later clips move with the
   new timing. The steps share L.ramp = { id, preset }, and Undo or "Remove ramp" puts the single clip back. */
const Ramp = (() => {
  const ease = u => u * u * (3 - 2 * u);
  // speed multiplier at source position u (0 … 1)
  const PRESETS = {
    hero: { name: 'Hero (normal › slow › normal)', f: u => 1 - .8 * Math.sin(Math.PI * u) ** 2 },
    montage: { name: 'Montage (fast › slow › fast)', f: u => .3 + 2.7 * (1 - Math.sin(Math.PI * u)) ** 2 },
    bullet: { name: 'Bullet (fast › very slow › fast)', f: u => .15 + 2.85 * (1 - Math.exp(-(((u - .5) / .14) ** 2))) },
    in: { name: 'Speed up', f: u => .5 + 2.5 * ease(u) },
    out: { name: 'Slow down', f: u => 3 - 2.6 * ease(u) },
    flash: { name: 'Flash (slow › fast › slow)', f: u => .4 + 3.6 * Math.sin(Math.PI * u) ** 2 }
  };
  /** steps for a source span: [{ s0, s1, v }] with v = base speed × curve at the step's middle */
  function plan(span, base, f, outDur) { const n = clamp(Math.round(outDur * 8), 4, 32), out = []; for (let i = 0; i < n; i++) { const u = (i + .5) / n; out.push({ s0: span * i / n, s1: span * (i + 1) / n, v: clamp(base * f(u), .0625, 16) }); } return out; }
  function apply(L, key, o = {}) {
    const pr = PRESETS[key]; if (!pr || !L || (L.type !== 'video' && L.type !== 'audio')) return null;
    if (L.ramp) L = unramp(L, true) || L;
    const base = o.base || L.speed || 1, span = L.dur * L.speed, steps = plan(span, base, pr.f, L.dur), id = uid(), start = L.start, oldEnd = L.start + L.dur;
    // timeline map: old local time → new local time
    const edges = [0]; for (const s of steps) edges.push(edges[edges.length - 1] + (s.s1 - s.s0) / s.v);
    const map = lt => { const s = lt * L.speed; for (let i = 0; i < steps.length; i++) if (s <= steps[i].s1 + 1e-9 || i === steps.length - 1) return edges[i] + (s - steps[i].s0) / steps[i].v; return edges[edges.length - 1]; };
    const fr = 1 / (P.fps || 30), parts = steps.map((s, i) => { const C = cloneLayer(L); C.id = uid(); C.start = +(start + edges[i]).toFixed(4); C.dur = Math.max(fr / 4, +(edges[i + 1] - edges[i]).toFixed(4)); C.srcIn = L.srcIn + s.s0; C.speed = +s.v.toFixed(4);
      for (const k in C.kf) C.kf[k] = C.kf[k].map(f => Object.assign({}, f, { t: map(f.t) - edges[i] }));
      C.ramp = { id, preset: key, i, n: steps.length, base, orig: i ? undefined : JSON.parse(ser(L)) }; if (i) C.tin = { type: 'none', dur: .6 }; if (i < steps.length - 1) C.tout = { type: 'none', dur: .6 }; C.name = L.name; return C; });
    const nd = edges[edges.length - 1], d = nd - L.dur, at = P.layers.indexOf(L);
    for (const X of P.layers) if (X !== L && X.start >= oldEnd - 1e-4) X.start = Math.max(0, +(X.start + d).toFixed(4));
    Markers.mapTimes(m => m >= oldEnd - 1e-4 ? m + d : m > start + 1e-4 ? start + map(m - start) : m);
    P.layers.splice(at, 1, ...parts); const end = Math.max(...P.layers.map(x => x.start + x.dur)); if (end > P.dur) P.dur = Math.ceil(end);
    selId = parts[0].id; commit(); structChanged(); toast(`${pr.name}: ${parts.length} steps, ${L.dur.toFixed(2)} s → ${nd.toFixed(2)} s`); return parts;
  }
  /** put the original single clip back (later clips move back too) */
  function unramp(L, quiet) {
    if (!L || !L.ramp) return null; const grp = P.layers.filter(x => x.ramp && x.ramp.id === L.ramp.id), first = grp.find(x => x.ramp.i === 0); if (!first || !first.ramp.orig) return null;
    const O = first.ramp.orig, s0 = Math.min(...grp.map(x => x.start)), e0 = Math.max(...grp.map(x => x.start + x.dur)), d = O.dur - (e0 - s0), at = P.layers.indexOf(first);
    P.layers = P.layers.filter(x => !grp.includes(x)); O.start = s0; P.layers.splice(Math.min(at, P.layers.length), 0, O);
    for (const X of P.layers) if (X !== O && X.start >= e0 - 1e-4) X.start = Math.max(0, +(X.start + d).toFixed(4));
    Markers.mapTimes(m => m >= e0 - 1e-4 ? m + d : m > s0 && m < e0 ? s0 + (m - s0) * O.dur / (e0 - s0) : m);
    selId = O.id; if (!quiet) { commit(); structChanged(); toast('Speed ramp removed'); } return O;
  }
  return { PRESETS, plan, apply, unramp };
})();
