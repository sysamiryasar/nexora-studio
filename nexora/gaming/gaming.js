'use strict';
/* ====================== NEXORA Gaming ======================
   Record   — screen or a single window (+ system audio on Windows), optional webcam and microphone. Each source is
              recorded to its own WebM file with MediaRecorder and dropped on the timeline together at the playhead:
              gameplay full-frame, facecam scaled into the bottom-right corner, mic as its own audio clip — so every
              part stays editable (move the facecam, duck the mic, add VFX to the gameplay…).
   Overlays — gaming Motion templates (facecam frame, subscribe, kill feed, victory, starting soon, clip title).
   Montage  — beat markers from a music clip, cut a gameplay clip on the beat, and highlight markers at the loudest moments. */
const Gaming = (() => {
  const S = { root: null, rec: null, timer: 0 };
  const sel = () => typeof selLayer === 'function' ? selLayer() : null;
  const mime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';

  /* ---------- capture ---------- */
  async function pickScreen() {
    if (!window.nxcap) return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true });   // browser: its own picker
    const list = await nxcap.sources();
    const id = await new Promise(res => {
      const grid = el('div', { class: 'srcgrid' }, list.map(s => el('button', { class: 'src', onclick: () => { closeModal(); res(s.id); } }, el('img', { src: s.thumb }), el('span', {}, s.name))));
      showModal('Choose what to record', grid, [['Cancel', () => { closeModal(); res(null); }]]);
    });
    if (!id) return null; return captureSource(id);
  }
  /** desktop app: capture a specific screen / window source id (used by the picker and by tests) */
  async function captureSource(id) {
    await nxcap.choose(id);
    try { return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true }); }
    catch (e) { await nxcap.choose(id); return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false }); }   // platform without loopback audio
  }
  /** record any set of named MediaStreams in parallel; resolves to { name: File } after stop() */
  function recordStreams(streams) {
    const type = mime(), parts = {}, recs = [];
    for (const [name, stream] of Object.entries(streams)) {
      if (!stream) continue; const chunks = []; const kind = stream.getVideoTracks().length ? 'video' : 'audio';
      const r = new MediaRecorder(stream, kind === 'video' ? { mimeType: type, videoBitsPerSecond: name === 'screen' ? 12e6 : 4e6 } : { mimeType: 'audio/webm' });
      r.ondataavailable = e => e.data.size && chunks.push(e.data);
      recs.push(new Promise(res => { r.onstop = () => { parts[name] = new File([new Blob(chunks, { type: r.mimeType })], `${name}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.webm`, { type: kind + '/webm' }); res(); }; }));
      r.start(1000); recs.r = (recs.r || []).concat(r);
    }
    return { stop: async () => { (recs.r || []).forEach(r => r.state !== 'inactive' && r.stop()); await Promise.all(recs); Object.values(streams).forEach(s => s && s.getTracks().forEach(t => t.stop())); return parts; } };
  }
  /** put recorded files on the timeline at the playhead: screen full-frame, cam bottom-right, mic as audio */
  async function placeRecording(files, at) {
    const out = {}; at = at === undefined ? T : at;
    for (const name of ['screen', 'cam', 'mic']) {
      const f = files[name]; if (!f) continue; const m = await importFile(f); if (!m) continue; const L = addMediaLayer(m, at); out[name] = L;
      if (name === 'screen' && m.w) L.tr.s = +(Math.min(P.w / m.w, P.h / m.h) * 100).toFixed(2);
      if (name === 'cam' && m.w) { const k = (P.w * .26) / m.w; L.tr.s = +(k * 100).toFixed(2); L.tr.x = P.w - m.w * k / 2 - P.w * .03; L.tr.y = P.h - m.h * k / 2 - P.h * .04; L.name = 'Facecam'; }
      if (name === 'mic') L.name = 'Microphone';
    }
    if (out.screen && out.cam) { const P2 = P.layers, i = P2.indexOf(out.cam), j = P2.indexOf(out.screen); if (i < j) { P2.splice(i, 1); P2.splice(P2.indexOf(out.screen) + 1, 0, out.cam); } }   // cam above gameplay
    commit(); structChanged(); return out;
  }
  async function start(o) {
    if (S.rec) return; o = o || S.opts;
    try {
      const streams = {};
      if (o.screen) { streams.screen = await pickScreen(); if (!streams.screen) return; streams.screen.getVideoTracks()[0].addEventListener('ended', () => stop()); }
      if (o.cam) streams.cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
      if (o.mic) streams.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
      if (!Object.keys(streams).length) return toast('Pick at least one source.');
      S.rec = recordStreams(streams); S.t0 = performance.now(); S.at = T; render();
      S.timer = setInterval(() => { const e = S.root && S.root.querySelector('.rectime'); if (e) e.textContent = tcFmt((performance.now() - S.t0) / 1000); }, 250);
    } catch (e) { toast('Recording failed: ' + (e.message || e)); S.rec = null; render(); }
  }
  async function stop() {
    if (!S.rec) return; clearInterval(S.timer); const r = S.rec; S.rec = null; render(); toast('Saving recording…');
    const files = await r.stop(); const placed = await placeRecording(files, S.at); toast(`Recording added to the timeline (${Object.keys(placed).length} clip${Object.keys(placed).length > 1 ? 's' : ''})`); render();
  }

  /* ---------- montage ---------- */
  async function beatMarkers(L) { L = L || sel(); if (!L || !media[L.media]) return toast('Select a music clip on the timeline first.'); toast('Finding the beat…'); const r = await Analysis.beats(L); Analysis.addMarkers(r.beats); S.lastBpm = r.bpm; render(); toast(`${r.bpm} BPM · ${r.beats.length} beat markers added`); return r; }
  function cutOnBeats(L, every) {
    L = L || sel(); if (!L || L.type !== 'video') return toast('Select a video clip to cut.'); const mk = (P.markers || []).filter(t => t > L.start + .05 && t < L.start + L.dur - .05);
    if (!mk.length) return toast('Add beat markers first (from a music clip).'); const n = every || S.every || 1, pick = mk.filter((_, i) => i % n === n - 1);
    const parts = Analysis.splitAtTimes(L, pick); toast(`Cut into ${parts.length} clips on the beat`); return parts;
  }
  async function highlights(L) { L = L || sel(); if (!L || !media[L.media]) return toast('Select a gameplay clip with sound.'); toast('Scanning for loud moments…'); const r = await Analysis.loudMoments(L, 6); Analysis.addMarkers(r.map(x => x.t)); toast(`${r.length} highlight markers added`); return r; }

  /* ---------- UI ---------- */
  S.opts = { screen: true, cam: false, mic: true };
  function enter(root) { S.root = root; render(); }
  function render() {
    const R = S.root; if (!R) return; R.innerHTML = ''; const o = S.opts;
    const chk = (k, label) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: o[k] ? '' : undefined, disabled: S.rec ? '' : undefined, onchange: e => o[k] = e.target.checked }), label);
    const card = (title, ...kids) => el('section', { class: 'gcard' }, el('h4', {}, title), ...kids);
    const recCard = card('Record gameplay',
      el('div', { class: 'row' }, chk('screen', window.nxcap ? 'Screen or window (+ system audio)' : 'Screen or window'), chk('cam', 'Webcam (facecam)'), chk('mic', 'Microphone')),
      S.rec ? el('div', { class: 'row' }, el('span', { class: 'recdot' }), el('b', { class: 'rectime' }, '00:00:00'), el('button', { class: 'primary', onclick: stop }, 'Stop and add to timeline'))
        : el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => start() }, Icon('film', 14), 'Start recording'), el('span', { class: 'dim' }, `Clips land at the playhead (${tcFmt(T)}) as separate, editable layers.`)));
    const ov = Motion.TEMPLATES.filter(t => t.cat === 'gaming');
    const ovCard = card('Overlays', el('div', { class: 'ovgrid' }, ov.map(t => el('button', { class: 'ov', onclick: () => Connect.newTitle(t.name) }, el('b', {}, t.name), el('small', {}, t.desc || '')))),
      el('div', { class: 'dim' }, 'Each overlay is a Motion composition placed at the playhead — open it to change text, colours or timing.'));
    const L = sel(), name = L ? L.name : 'nothing selected';
    const mtCard = card('Montage tools',
      el('div', { class: 'dim' }, `Selected clip: ${name}`),
      el('div', { class: 'row' }, el('button', { onclick: () => beatMarkers() }, Icon('music', 14), 'Beat markers from selected music'), S.lastBpm ? el('span', { class: 'pill' }, S.lastBpm + ' BPM') : null),
      el('div', { class: 'row' }, el('button', { onclick: () => cutOnBeats() }, Icon('split', 14), 'Cut selected clip on beats'), el('label', {}, 'every ', el('select', { onchange: e => S.every = +e.target.value }, [1, 2, 4, 8].map(n => el('option', { value: n, selected: (S.every || 1) === n ? '' : undefined }, n === 1 ? 'beat' : n + ' beats'))))),
      el('div', { class: 'row' }, el('button', { onclick: () => highlights() }, Icon('star', 14), 'Mark loudest moments (highlights)')),
      el('div', { class: 'dim' }, 'Markers appear on the timeline ruler; Split / snap use them like any marker.'));
    R.append(el('div', { class: 'abar' }, el('b', {}, 'Capture'), el('div', { class: 'spacer' }), el('button', { class: 'ibtn', onclick: () => Shell.go('edit') }, Icon('back', 14), 'Timeline')), el('div', { class: 'gwrap' }, recCard, ovCard, mtCard));
  }
  return { S, enter, render, start, stop, recordStreams, placeRecording, beatMarkers, cutOnBeats, highlights, pickScreen, captureSource };
})();
