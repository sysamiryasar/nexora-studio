'use strict';
/* ====================== NEXORA social captions ======================
   Short-form captions: one to three words at a time, big bold capitals with an outline, the spoken word lit up in
   light blue and a small pop as each group appears. Word timing comes from Whisper's word timestamps; when the model
   only returns phrase timing, the words in a phrase share its time by length (the dialog says so). */
const Social = (() => {
  const STYLE = { size: 78, weight: '900', color: '#ffffff', hlColor: '#8fc9f0', stroke: '#000000', strokeW: 7, bgOn: false, upper: true, y: .72, maxWords: 3, maxChars: 18 };
  /** phrase chunks [{ text, timestamp: [s, e] }] → words with timing shared out by letter count */
  function fromChunks(chunks) {
    const out = []; for (const c of chunks) { const ws = String(c.text || '').trim().split(/\s+/).filter(Boolean); if (!ws.length) continue; const s = c.timestamp[0] || 0, e = c.timestamp[1] == null ? s + .4 * ws.length : c.timestamp[1], tot = ws.reduce((a, w) => a + w.length + 1, 0); let t = s;
      for (const w of ws) { const d = (e - s) * (w.length + 1) / tot; out.push({ text: w, t0: t, t1: t + d }); t += d; } }
    return out;
  }
  /** words → groups of up to maxWords / maxChars, breaking at sentence ends and pauses */
  function groups(words, o = {}) {
    const mw = o.maxWords || STYLE.maxWords, mc = o.maxChars || STYLE.maxChars, out = []; let cur = [];
    const flush = () => { if (cur.length) out.push(cur); cur = []; };
    words.forEach((w, i) => { const len = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length; if (cur.length && (cur.length >= mw || len > mc || w.t0 - cur[cur.length - 1].t1 > .45)) flush(); cur.push(w); if (/[.!?,;:]$/.test(w.text)) flush(); });
    flush(); return out;
  }
  /** text layers for the groups of a clip L (word times are relative to the clip's source in-point) */
  function build(L, words, o = {}) {
    const st = Object.assign({}, STYLE, o), sp = L.speed || 1, made = [], gs = groups(words, st);
    gs.forEach((g, gi) => {
      const a = L.start + g[0].t0 / sp, next = gs[gi + 1] ? L.start + gs[gi + 1][0].t0 / sp : Infinity, b = Math.min(next, L.start + g[g.length - 1].t1 / sp + .25), dur = Math.max(.2, b - a);
      const str = g.map(w => w.text.replace(/[,;:]$/, '')).join(' '), T_ = mkLayer('text', { name: str.slice(0, 24), start: +a.toFixed(3), dur: +dur.toFixed(3), tin: { type: o.pop === false ? 'fade' : 'pop', dur: .12 }, tout: { type: 'none', dur: .1 } });
      Object.assign(T_.text, { str: st.upper ? str.toUpperCase() : str, size: st.size, weight: st.weight, color: st.color, stroke: st.stroke, strokeW: st.strokeW, bgOn: st.bgOn, hlColor: st.hlColor, words: g.map(w => [+(w.t0 / sp + L.start - a).toFixed(3), +(w.t1 / sp + L.start - a).toFixed(3)]) });
      T_.tr.y = P.h * st.y; T_.social = true; P.layers.push(T_); made.push(T_);
    });
    return made;
  }
  return { STYLE, fromChunks, groups, build };
})();
