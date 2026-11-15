'use strict';
/* ====================== NEXORA go to timecode ======================
   Click either timecode readout (viewer or timeline) and type where to go:
     01:02:03:04   absolute hours:minutes:seconds:frames (groups fill from the right: 3:00 = 3 seconds, 1:00:00 = 1 minute)
     +2:00 / -15   relative to the playhead (here: 2 seconds forward / 15 frames back)
   Enter jumps, Esc cancels. */
const GotoTC = (() => {
  /** parse a typed timecode → seconds (absolute) or { rel: seconds }; null if it is not a timecode */
  function parse(str, fps) {
    const s = String(str || '').trim().replace(/[.;]/g, ':'); const m = /^([+-])?\s*(\d{1,3}(?::\d{1,3}){0,3})$/.exec(s); if (!m) return null;
    const g = m[2].split(':').map(Number).reverse(), f = Math.round(fps) || 30;
    const sec = (g[0] || 0) / f + (g[1] || 0) + (g[2] || 0) * 60 + (g[3] || 0) * 3600;
    return m[1] ? { rel: m[1] === '-' ? -sec : sec } : sec;
  }
  function edit(span) {
    if (!span || span.querySelector('input')) return; const prev = span.textContent, w = span.offsetWidth;
    const inp = el('input', { class: 'tc-edit', value: prev, spellcheck: 'false', style: `width:${Math.max(110, w)}px`, title: 'Type a timecode (01:02:03:04) or an offset (+2:00, -15) and press Enter' });
    span.textContent = ''; span.append(inp); inp.focus(); inp.select();
    let done = false; const finish = go => { if (done) return; done = true; const v = parse(inp.value, P.fps); inp.remove(); span.textContent = prev;
      if (go) { if (v == null) { toast('Not a timecode. Try 01:02:03:04 or +2:00'); return; } const t = typeof v === 'number' ? v : T + v.rel; seek(clamp(t, 0, P.dur)); } uiTime(); };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(false);
  }
  for (const id of ['tc', 'tlTC']) { const s = document.getElementById(id); if (s) { s.classList.add('tc-click'); s.title = 'Click to go to a timecode'; s.addEventListener('click', () => edit(s)); } }
  return { parse, edit };
})();
