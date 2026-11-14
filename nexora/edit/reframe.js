'use strict';
/* ====================== NEXORA reframe ======================
   Change an edit's aspect (16:9 ⇄ 9:16, 1:1, 4:5 …) without rebuilding it:
     · picture clips (video, images, compositions, 3D, VFX) are scaled to COVER the new frame, keeping their offset
       from the centre in proportion, so full-frame shots stay full-frame;
     · overlays (titles, shapes, stickers) keep their place relative to the frame edges (a lower third stays low) and
       are scaled to FIT, so text that fitted the old width still fits the new one;
     · position and scale keyframes are converted the same way; paint layers are re-centred.
   "Create … version" first duplicates the project, so the original edit is never changed. */
const Reframe = (() => {
  // FULL layers draw at the frame's own size (backgrounds, solids, particles): they only need re-centring
  const PIC = ['video', 'image', 'comp', 'vfx', '3d'], OVER = ['text', 'shape'], FULL = ['gen', 'solid', 'particles'];
  const ASPECTS = { '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5] };
  /** target size for an aspect, keeping the long side of the current frame (1920×1080 → 1080×1920) */
  function sizeFor(a) { const [x, y] = ASPECTS[a], long = Math.max(P.w, P.h); return x >= y ? [long, Math.round(long * y / x / 2) * 2] : [Math.round(long * x / y / 2) * 2, long]; }
  function apply(w, h) {
    const W = P.w, H = P.h; if (w === W && h === H) return 0;
    const fit = Math.min(1, Math.min(w / W, h / H) * 1.3);
    let n = 0;
    for (const L of P.layers) {
      if (!L.tr || L.type === 'paint' || L.type === 'adjust' || L.type === 'audio' || L.type === 'null') continue;
      let k, mx, my;
      if (PIC.includes(L.type)) { const m = L.media && media[L.media], mw = (m && m.w) || W, mh = (m && m.h) || H; k = Math.max(w / mw, h / mh) / Math.max(W / mw, H / mh); mx = my = k; }
      else if (OVER.includes(L.type)) { k = fit; mx = w / W; my = h / H; }
      else if (FULL.includes(L.type)) { k = 1; mx = w / W; my = h / H; }
      else continue;
      const X = v => w / 2 + (v - W / 2) * mx, Y = v => h / 2 + (v - H / 2) * my;
      L.tr.x = X(L.tr.x); L.tr.y = Y(L.tr.y); L.tr.s = +(L.tr.s * k).toFixed(3);
      const kf = L.kf || {}; (kf.x || []).forEach(f => f.v = X(f.v)); (kf.y || []).forEach(f => f.v = Y(f.v)); (kf.s || []).forEach(f => f.v = +(f.v * k).toFixed(3));
      n++;
    }
    setProjectSize(w, h); commit(); structChanged(); requestRender(); return n;
  }
  /** duplicate the open project, open the copy and reframe it */
  async function version(a) {
    if (!Projects.current) return toast('Open a project first.'); const [w, h] = sizeFor(a);
    if (w === P.w && h === P.h) return toast(`This edit is already ${a}.`);
    await Recovery.flush(); const src = Projects.current, nid = await Projects.duplicate(src.id); if (!nid) return toast('Could not copy the project.');
    await Shell.openProject(nid); const name = src.name + ` (${a})`; await Projects.rename(nid, name); P.name = name; const pn = document.getElementById('projName'); if (pn) pn.value = name; const vn = document.getElementById('viewName'); if (vn) vn.textContent = name;
    const n = apply(w, h); await Recovery.flush(); toast(`${a} version created (${w}×${h}): ${n} clip${n === 1 ? '' : 's'} reframed. The original edit is unchanged.`);
    return nid;
  }
  const commands = () => Object.keys(ASPECTS).map(a => ({ title: `Project: Create ${a} version (reframe a copy)`, run: () => version(a) }));
  return { ASPECTS, sizeFor, apply, version, commands };
})();
