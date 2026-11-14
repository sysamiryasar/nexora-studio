'use strict';
/* ====================== NEXORA connected editing ======================
   One project, one timeline. The other modes are tools you apply TO the timeline:
     · VFX on a clip     — a node graph attached to the clip (Timeline Clip → … → Output), rendered live in place
     · Design overlay    — a layered image document linked to an image layer; edits update the timeline
     · Motion title      — a composition linked to a comp layer
     · Audio             — the mixer, focused on the clip's track
   Opening a tool from a clip remembers where you came from; "Back to timeline" returns to the same clip and playhead. */
const Connect = (() => {
  const S = { ctx: null };                      // { layerId, mode, label }
  const layerById = id => (typeof Motion !== 'undefined' ? Motion.editProject().layers : P.layers).find(l => l.id === id) || null;

  function setCtx(L, mode, label) { S.ctx = L ? { layerId: L.id, mode, label: label || L.name, T } : null; chip(); }
  function chip() {
    const box = document.getElementById('ctxChip'); if (!box) return; box.innerHTML = '';
    const tab = typeof Shell !== 'undefined' ? Shell.tab : 'edit';
    if (!S.ctx || tab === 'edit' || !document.getElementById('studio') || S.ctx.mode !== tab) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.append(Icon('link', 13), el('span', {}, `${{ vfx: 'VFX on', image: 'Overlay', motion: 'Title', audio: 'Mixing' }[S.ctx.mode] || 'Editing'}: `), el('b', {}, S.ctx.label),
      el('button', { class: 'primary', onclick: back }, Icon('back', 13), 'Back to timeline'));
  }
  /** return to Edit with the clip selected and the playhead where it was */
  function back() {
    const c = S.ctx; S.ctx = null; Shell.go('edit');
    if (c) { const L = layerById(c.layerId); if (L) { selId = L.id; if (c.T !== undefined) seek(c.T); structChanged(); } }
    chip();
  }

  /* ---------- VFX on a clip ---------- */
  function clipSize(L) { const C = contentOfBase(L, Math.min(Math.max(T, L.start), L.start + L.dur - .001)); const m = media[L.media]; return { w: Math.round((C && C.w) || (m && m.w) || P.w), h: Math.round((C && C.h) || (m && m.h) || P.h) }; }
  function vfxForClip(L) {
    if (!L || L.type === 'audio') return toast('Select a visual clip first.');
    let g = L.fxGraph && VFX.graph(L.fxGraph);
    if (!g) {
      const sz = clipSize(L), k = Math.min(1, 4096 / Math.max(sz.w, sz.h));       // graphs run up to DCI 4K on the long side
      g = VFX.newGraph({ name: L.name + ' VFX', w: Math.round(sz.w * k), h: Math.round(sz.h * k), fps: P.fps, dur: L.dur, empty: true });
      g.host = L.id; const out = VFX.outputOf(g), cl = VFX.addNode(g, 'clip', 60, 120); out.x = 760; VFX.connect(g, cl.id, out.id, 0);
      L.fxGraph = g.id; commit();
    }
    g.dur = L.dur; setCtx(L, 'vfx'); VFX.ui.open(g.id); chip();
    if (VFX.ui.seekTo) VFX.ui.seekTo(clamp(T - L.start, 0, L.dur));
  }
  function removeVfx(L) { if (!L || !L.fxGraph) return; const id = L.fxGraph; delete L.fxGraph; const g = VFX.graph(id); if (g && !(VFX.usage()[id] > 0)) { delete VFX.S.graphs[id]; VFX.S.order = VFX.S.order.filter(x => x !== id); } commit(); structChanged(); toast('VFX removed from clip'); }

  /* ---------- Design overlays ---------- */
  function newOverlay() {
    const d = NXI.newDoc({ name: 'Overlay ' + (Object.keys(Assets.docs).length + 1), w: P.w, h: P.h, bg: 'transparent' });
    const L0 = NXI.mkLayer(d, 'raster', { name: 'Layer 1' }); NXI.insert(d, L0); NXI.push(d, 'New overlay');
    Assets.docs[d.id] = d; const m = Assets.publishDoc(d); Shell.go('edit'); const L = addMediaLayer(m, T); if (L) { L.dur = Math.max(1, Math.min(5, P.dur - T || 5)); commit(); structChanged(); }
    designForLayer(selLayer());
  }
  function designForLayer(L) {
    if (!L || L.type !== 'image') return newOverlay();
    setCtx(L, 'image'); Assets.openMediaInImage(L.media); chip();
  }

  /* ---------- Motion titles ---------- */
  function newTitle(templateName) {
    const t = Motion.TEMPLATES.find(x => x.name === templateName) || Motion.TEMPLATES[0];
    const at = T; Motion.createComp({ name: t.name, dur: t.dur, w: P.w, h: P.h, bg: 'transparent' }, t.build); Motion.placeInEdit();
    const L = selLayer(); if (L) { L.start = at; commit(); structChanged(); motionForLayer(L); }
  }
  function titlePicker() {
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:8px;min-width:420px' },
      Motion.TEMPLATES.map(t => el('button', { style: 'text-align:left;padding:10px', onclick: () => { closeModal(); newTitle(t.name); } }, el('b', {}, t.name), el('div', { class: 'dim', style: 'font-size:11px' }, (t.desc || '') + ` · ${t.dur}s`))));
    showModal('Add a title or animated graphic', grid, [['Cancel', closeModal]]);
  }
  function motionForLayer(L) {
    if (!L) return titlePicker();
    if (L.type === 'comp' && L.compRef) { setCtx(L, 'motion'); Motion.open(L.compRef); chip(); return; }
    if (L.type === 'comp') return toast('This is an inline precomp — double-click it on the timeline to edit.');
    titlePicker();
  }

  /* ---------- Audio ---------- */
  function audioForLayer(L) { setCtx(L, 'audio'); Shell.go('audio'); if (typeof AudioMix !== 'undefined' && L) AudioMix.focus(L.id); chip(); }

  /* ---------- UI: clip toolbar in the inspector + quick-add on the timeline bar ---------- */
  function clipBar(L) {
    const b = (icon, label, title, fn, cls) => el('button', { class: 'cbtn ' + (cls || ''), title, onclick: fn }, Icon(icon, 14), label);
    const row = el('div', { class: 'clipbar' });
    if (L.type !== 'audio') row.append(L.fxGraph ? b('vfx', 'Edit VFX', 'Open this clip\'s VFX graph', () => vfxForClip(L), 'on') : b('vfx', 'Add VFX', 'Build node effects on this clip (keying, glow, tracking, roto…)', () => vfxForClip(L)));
    if (L.type === 'image') row.append(b('design', 'Edit in Design', 'Paint, retouch and layer this image; the timeline updates live', () => designForLayer(L)));
    if (L.type === 'comp' && L.compRef) row.append(b('motion', 'Edit animation', 'Open this title / composition in Motion', () => motionForLayer(L)));
    if (L.type === 'video' || L.type === 'audio') row.append(b('audio', 'Mix audio', 'Volume, EQ, pan and loudness for this clip', () => audioForLayer(L)));
    if (L.fxGraph) row.append(el('button', { class: 'cbtn ghost', title: 'Remove the VFX graph from this clip', onclick: () => removeVfx(L) }, Icon('close', 13)));
    return row;
  }
  function quickAdd() {
    const bar = document.getElementById('tlbar'); if (!bar || bar.querySelector('.qadd')) return;
    const b = (icon, label, title, fn) => el('button', { class: 'qadd', title, onclick: fn }, Icon(icon, 14), label);
    const sep = el('span', { class: 'qsep' });
    const first = bar.firstChild; bar.insertBefore(sep, first);
    bar.insertBefore(b('motion', 'Title', 'Add an animated title at the playhead (Motion)', titlePicker), sep);
    bar.insertBefore(b('design', 'Overlay', 'Add a transparent design overlay at the playhead (Design)', newOverlay), sep);
    bar.insertBefore(b('vfx', 'Effect', 'Add VFX to the selected clip', () => vfxForClip(selLayer())), sep);
  }
  return { S, setCtx, chip, back, vfxForClip, removeVfx, newOverlay, designForLayer, newTitle, titlePicker, motionForLayer, audioForLayer, clipBar, quickAdd, layerById };
})();
