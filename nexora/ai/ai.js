'use strict';
/* ====================== NEXORA AI ======================
   Tools that understand the footage, applied to the selected timeline clip. Everything runs on this computer:
     · Auto captions        — Whisper speech recognition (transformers.js; the model downloads once, then works offline)
     · Remove background    — MODNet portrait matting on an image layer (same download-once model loader)
     · Remove silences      — cuts quiet gaps out of a talking clip and closes the gaps (ripple)
     · Detect scene cuts    — finds hard cuts in a video and splits the clip there (or adds markers)
     · Find highlights      — markers at the loudest moments
   No project data is sent anywhere; only the model files are fetched from the public model hub on first use. */
const AIMode = (() => {
  const S = { root: null, busy: '' };
  const sel = () => typeof selLayer === 'function' ? selLayer() : null;
  const need = (L, kinds, what) => { if (!L || !kinds.includes(L.type)) { toast(`Select ${what} on the timeline first.`); return false; } return true; };
  async function run(label, fn) { if (S.busy) return; S.busy = label; render(); try { return await fn(); } catch (e) { toast(label + ' failed: ' + (e.message || e)); } finally { S.busy = ''; render(); } }

  const tools = [
    { id: 'captions', icon: 'text', name: 'Auto captions', d: 'Transcribe speech into timed caption layers (Whisper, on-device).', kinds: ['video', 'audio'], what: 'a clip with speech',
      go: L => { captionDialog(L); } },
    { id: 'bg', icon: 'sparkle', name: 'Remove background', d: 'Cut out the person in an image layer (MODNet matting, on-device).', kinds: ['image'], what: 'an image layer',
      go: L => run('Remove background', () => removeBackgroundAI(L)) },
    { id: 'silence', icon: 'mute', name: 'Remove silences', d: 'Cut out pauses quieter than the threshold and close the gaps.', kinds: ['video', 'audio'], what: 'a clip with speech',
      go: L => { const o = { threshold: -40, minDur: .5 }; showModal('Remove silences', el('div', { style: 'min-width:360px' }, field('Quieter than (dBFS)', o, 'threshold', 'num', { min: -70, max: -15, step: 1 }), field('Longer than (s)', o, 'minDur', 'num', { min: .2, max: 5, step: .1 }), el('div', { class: 'dim' }, 'Later clips move left by the removed time. Undo restores everything.')), [['Cancel', closeModal], ['Preview', async () => { const sp = await Analysis.silences(L, { threshold: +o.threshold, minDur: +o.minDur }); toast(sp.length ? `${sp.length} silent gap(s), ${sp.reduce((a, [x, y]) => a + y - x, 0).toFixed(1)} s total` : 'No silences found with these settings'); }], ['Remove', () => { closeModal(); run('Remove silences', async () => { const r = await Analysis.removeSilences(L, { threshold: +o.threshold, minDur: +o.minDur }); toast(r.cuts ? `Removed ${r.removed.toFixed(1)} s in ${r.cuts} cut(s)` : 'No silences found'); }); }, true]]); } },
    { id: 'scenes', icon: 'split', name: 'Detect scene cuts', d: 'Find hard cuts in a video and split the clip at each one.', kinds: ['video'], what: 'a video clip',
      go: L => run('Scene detection', async () => { const cuts = await Analysis.scenes(L, { onProgress: p => { S.busy = `Scanning ${Math.round(p * 100)}%`; const b = S.root && S.root.querySelector('.busy'); if (b) b.textContent = S.busy; } }); if (!cuts.length) return toast('No scene cuts found'); showModal(`${cuts.length} scene cut(s) found`, el('div', { class: 'dim' }, cuts.map(t => tcFmt(t)).join(' · ')), [['Add markers', () => { closeModal(); Analysis.addMarkers(cuts); }], ['Split clip', () => { closeModal(); Analysis.splitAtTimes(L, cuts); toast(`Split into ${cuts.length + 1} clips`); }, true]]); }) },
    { id: 'hl', icon: 'star', name: 'Find highlights', d: 'Mark the loudest moments of a clip for a quick highlight reel.', kinds: ['video', 'audio'], what: 'a clip with sound',
      go: L => run('Highlights', async () => { const r = await Analysis.loudMoments(L, 6); Analysis.addMarkers(r.map(x => x.t)); toast(`${r.length} highlight markers added`); }) }
  ];
  /* the same models applied to the active pixel layer of the open Design document */
  const designTools = [
    { icon: 'sparkle', name: 'Remove background', d: 'Hide the background with an editable layer mask (MODNet, on-device).', go: () => run('Remove background', () => designRemoveBackground()) },
    { icon: 'marquee', name: 'Select subject', d: 'Turn the person into a selection for adjustments, copy or fill.', go: () => run('Select subject', () => designSelectSubject()) },
    { icon: 'crop', name: 'Crop to subject', d: 'Crop the canvas tightly around the subject with a little padding.', go: () => run('Crop to subject', () => designCropToSubject()) }
  ];
  function enter(root) { S.root = root; render(); }
  function render() {
    const R = S.root; if (!R) return; R.innerHTML = ''; const L = sel(), imageProject = Projects.current && Projects.current.kind === 'image', doc = NXI.ui.doc, lay = doc && NXI.active(doc);
    const tile = (t, ok, forTxt, fn) => el('button', { class: 'aitool' + (ok ? '' : ' na'), disabled: S.busy ? '' : undefined, onclick: fn }, el('div', { class: 'ic' }, Icon(t.icon, 22)), el('b', {}, t.name), el('small', {}, t.d), el('span', { class: 'for' }, forTxt));
    R.append(el('div', { class: 'ai-launch', style: 'margin-top:14px' }, el('div', {}, el('b', {}, 'AI Editor'), el('small', { class: 'dim' }, 'Describe the edit. The AI cuts, trims, grades, titles and reviews your project on the real timeline.')), el('button', { class: 'primary', onclick: () => Copilot.toggle(true) }, 'Open AI Editor')));
    R.append(el('div', { class: 'abar' }, el('b', {}, 'On-device tools'), el('span', { class: 'dim' }, imageProject ? (lay ? `Design layer: ${lay.name}` : 'Open a design') : (L ? `Selected: ${L.name} (${L.type})` : 'Select a clip in the timeline')), el('div', { class: 'spacer' }), S.busy ? el('span', { class: 'busy pill' }, S.busy + '…') : null, el('button', { class: 'ibtn', onclick: () => Shell.go(imageProject ? 'image' : 'edit') }, Icon('back', 14), imageProject ? 'Design' : 'Timeline')),
      imageProject ? null : el('h4', { class: 'aisec' }, 'Timeline clip'),
      imageProject ? null : el('div', { class: 'aigrid' }, tools.map(t => tile(t, L && t.kinds.includes(L.type), 'for ' + t.what, () => { const cur = sel(); if (need(cur, t.kinds, t.what)) t.go(cur); }))),
      el('h4', { class: 'aisec' }, 'Design layer'),
      el('div', { class: 'aigrid' }, designTools.map(t => tile(t, lay && lay.type === 'raster', 'for the active pixel layer in Design', t.go))),
      el('div', { class: 'dim foot' }, 'Runs on this computer. Captions and background removal download their model once (needs internet that first time); silences, scenes and highlights need no download.'));
  }
  return { S, enter, render, tools };
})();
