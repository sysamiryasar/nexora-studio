'use strict';
/* ====================== app glue ====================== */
function structChanged(light) {
  if (selId && !selLayer()) selId = null;
  preloadNear();   // start buffering what is about to play
  renderTimeline(); if (!light) buildInspector(); requestRender(); uiTime(); graphRefresh();
}
const $ = id => document.getElementById(id);
function download(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
const safeName = () => (P.name || 'project').replace(/[^\w\- ]+/g, '').trim() || 'project';

/* ---- modal ---- */
function showModal(title, body, buttons) {
  const m = $('modal'); m.innerHTML = ''; m.classList.remove('hidden');
  m.append(el('div', { class: 'dlg' }, el('h3', {}, title), body, el('div', { class: 'btns' }, buttons.map(([t, fn, pri]) => el('button', { class: pri ? 'primary' : '', onclick: fn }, t)))));
}
const closeModal = () => $('modal').classList.add('hidden');
/** in-app replacement for window.prompt (which Electron does not implement). Resolves to the text, or null. */
function askText(title, value) {
  return new Promise(res => {
    const inp = el('input', { value: value || '', style: 'width:100%;margin:6px 0 2px' }), done = v => { closeModal(); res(v); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); else if (e.key === 'Escape') done(null); e.stopPropagation(); };
    showModal(title, inp, [['Cancel', () => done(null)], ['OK', () => done(inp.value.trim() || null), true]]);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

/* ---- menus ---- */
function menuItems(name) {
  const sepr = '-';
  const L = selLayer();
  return {
    file: [['New project', newProject, 'Ctrl+N'], ['Open project…', () => $('projIn').click(), ''], ['Save project', saveProject, 'Ctrl+S'], sepr, ['Import media…', () => $('fileIn').click(), 'Ctrl+I'], ['Import subtitles (.srt)…', () => $('srtIn').click(), ''], ['Record voiceover', toggleVoiceover, ''], sepr, ['Export video…', exportDialog, 'Ctrl+E'], ['Export current frame (PNG)', () => exportFrame('png'), ''], ['Export current frame (JPEG)', () => exportFrame('jpeg'), '']],
    edit: [['Undo', undo, 'Ctrl+Z'], ['Redo', redo, 'Ctrl+Y'], sepr, ['Split at playhead', doSplit, 'S'], ['Duplicate', () => { if (L) { duplicateLayer(L); commit(); } }, 'Ctrl+D'], ['Delete', doDelete, 'Del'], sepr, ['Set keyframes (position, scale, rotation, opacity)', keyAll, 'K']],
    layer: [['New text', () => { addLayer(mkLayer('text', { start: T, dur: Math.min(5, Math.max(2, P.dur - T)) })); commit(); }, ''], ['New solid', () => { addLayer(mkLayer('solid', { name: 'Solid', start: T })); commit(); }, ''], ['New adjustment layer', () => { addLayer(mkLayer('adjust', { name: 'Adjustment', start: 0, dur: P.dur })); commit(); }, ''], ['New paint layer', () => { addLayer(mkLayer('paint', { name: 'Paint', start: 0 })); commit(); setTool('brush'); }, ''], sepr,
      ['Bring forward', () => { if (L) { moveLayerZ(L, 1); commit(); } }, ''], ['Send backward', () => { if (L) { moveLayerZ(L, -1); commit(); } }, ''], ['Bring to front', () => { if (L) { moveLayerZ(L, P.layers.length); commit(); } }, ''], ['Send to back', () => { if (L) { moveLayerZ(L, -P.layers.length); commit(); } }, ''], sepr,
      ['Trim start to playhead', () => trimTo(true), '['], ['Trim end to playhead', () => trimTo(false), ']'], sepr,
      ['New null object (for parenting)', () => { addLayer(mkLayer('null', { start: 0, dur: P.dur })); commit(); }, ''], ['Precompose selected layer', () => { const s = selLayer(); if (s) { precompose(s); commit(); } else toast('Select a layer first.'); }, ''], ['Open selected composition', () => { const s = selLayer(); if (s && s.type === 'comp') enterComp(s); }, ''], ['Exit composition', exitComp, ''], sepr,
      ['Track motion…', () => { const s = selLayer(); if (s && s.type === 'video') trackDialog(s); else toast('Select a video layer.'); }, ''], ['Auto captions (AI)…', () => { const s = selLayer(); if (s && (s.type === 'video' || s.type === 'audio')) captionDialog(s); else toast('Select a video or audio layer.'); }, ''], ['Remove background (AI)…', () => { const s = selLayer(); if (s && s.type === 'image') removeBackgroundAI(s); else toast('Select an image layer.'); }, ''], ['Toggle keyframe graph editor', toggleGraph, ''], sepr,
      ['Freeze frame at playhead', freezeFrame, ''], ['Add marker at playhead', addMarker, 'M'], ['Clear all markers', () => { P.markers = []; commit(); renderTimeline(); }, '']],
    view: [['Fit to window', fitView, ''], ['Zoom 100%', () => { const r = stageWrap.getBoundingClientRect(); zoom = 1; panX = (r.width - P.w) / 2; panY = (r.height - P.h) / 2; applyView(); }, ''], ['Toggle guides', () => { showGuides = !showGuides; requestRender(); }, ''], ['Toggle loop', toggleLoop, ''], sepr, ['Timeline zoom in', () => zoomTl(1.4), '+'], ['Timeline zoom out', () => zoomTl(1 / 1.4), '-']]
  }[name];
}
function zoomTl(f) { pps = clamp(pps * f, 10, 400); $('tZoom').value = pps; renderTimeline(); }
function toggleLoop() { loopPlay = !loopPlay; $('bLoop').classList.toggle('on', loopPlay); }
function keyAll() { const L = selLayer(); if (!L) return toast('Select a layer first.'); ['x', 'y', 's', 'rot', 'op'].forEach(k => upsertKey(L, k, T - L.start, valueAt(L, k, T - L.start))); L.open = true; commit(); structChanged(); }
function trimTo(start) {
  const L = selLayer(); if (!L) return; const lt = T - L.start; if (lt <= .05 || lt >= L.dur - .05) return toast('Playhead must be inside the clip.');
  if (start) { L.start = T; L.dur -= lt; L.srcIn += lt * L.speed; for (const k in L.kf) L.kf[k].forEach(f => f.t -= lt); } else L.dur = lt;
  commit(); structChanged();
}
function openMenu(btn) {
  const pop = $('menuPop'); pop.innerHTML = '';
  menuItems(btn.dataset.menu).forEach(it => { if (it === '-') pop.append(el('hr')); else pop.append(el('button', { onclick: () => { closeMenu(); it[1](); } }, it[0], el('kbd', {}, it[2]))); });
  const r = btn.getBoundingClientRect(); pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 4 + 'px'; pop.classList.remove('hidden');
}
const closeMenu = () => $('menuPop').classList.add('hidden');
document.querySelectorAll('#menubar button').forEach(b => b.onclick = e => { e.stopPropagation(); $('menuPop').classList.contains('hidden') ? openMenu(b) : (closeMenu(), openMenu(b)); });
document.addEventListener('pointerdown', e => { if (!e.target.closest('#menuPop') && !e.target.closest('#menubar')) closeMenu(); });

/* ---- project IO ---- */
function resetProject(w, h) {
  pause(); els.forEach(e => { e.pause(); e.removeAttribute('src'); e.load(); }); els.clear(); for (const k in media) delete media[k];
  P = { name: 'Untitled Project', w, h, fps: 30, dur: 12, bg: '#000000', layers: [] }; selId = null; T = 0; hist.stack = []; hist.i = -1;
}
function newProject() {
  if (!confirm('Start a new empty project? Unsaved changes will be lost.')) return; exitAllComps();
  resetProject(1280, 720); $('projName').value = P.name; fitView(); buildLeft(); structChanged(); commit();
}
async function saveProject() {
  try { toast('Saving…'); const txt = await projectToJSON(); download(new Blob([txt], { type: 'application/json' }), safeName() + '.fusion'); toast('Project saved (media embedded).'); } catch (e) { toast('Save failed: ' + e.message); }
}
$('projIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { pause(); await loadProjectJSON(await f.text()); $('projName').value = P.name; fitView(); buildLeft(); toast('Project loaded.'); } catch (err) { toast('Could not open: ' + err.message); }
  e.target.value = '';
};
function exportFrame(fmt) {
  pause(); renderComp(vctx, T); view.toBlob(b => download(b, `${safeName()}-${tcFmt(T).replace(/:/g, '-')}.${fmt === 'jpeg' ? 'jpg' : 'png'}`), 'image/' + fmt, .95);
}

/* ---- export ---- */
let rec = null, chunks = [], expCancel = false, expTimer = null;
function exportDialog() {
  pause();
  const mp4ok = MP4_MIMES.some(t => MediaRecorder.isTypeSupported(t)), exact = offlineSupported();
  const io = P.io || {}, hasIO = io.in != null && io.out != null && io.out > io.in;
  const uhd = P.w * P.h >= 6e6, o = { mbps: uhd ? 45 : 16, fps: P.fps, audio: true, fmt: exact ? 'mp4x' : mp4ok ? 'mp4' : 'webm', codec: 'avc', engine: 'hw', range: hasIO ? 'io' : 'all', preset: uhd ? 'uhd' : 'web', master: 'prores_hq', seq: 'png_seq', audioK: 'mp3', size: 0 };
  // output size: the project's own size, or the long edge scaled (same aspect ratio, even dimensions) by FFmpeg's Lanczos filter
  const scaled = e => { const k = e / Math.max(P.w, P.h); return [Math.round(P.w * k / 2) * 2, Math.round(P.h * k / 2) * 2]; };
  const SIZE_NAME = { 1280: 'HD', 1920: 'Full HD', 2560: 'QHD', 3840: '4K', 7680: '8K' };
  // delivery presets; a preset whose codec this machine cannot encode (in hardware or with the bundled FFmpeg) is hidden
  const PRESETS = { uhd: ['4K delivery · H.264 45 Mbps', { fmt: 'mp4x', codec: 'avc', mbps: 45 }], uhdh: ['4K master · HEVC 100 Mbps', { fmt: 'mp4x', codec: 'hevc', mbps: 100 }], web: ['YouTube / web · H.264 16 Mbps', { fmt: 'mp4x', codec: 'avc', mbps: 16 }], hq: ['High quality · H.264 40 Mbps', { fmt: 'mp4x', codec: 'avc', mbps: 40 }], hevcm: ['Master · HEVC 60 Mbps', { fmt: 'mp4x', codec: 'hevc', mbps: 60 }],
    hevc10: ['YouTube HDR-ready · HEVC 10-bit 45 Mbps', { fmt: 'mp4x', codec: 'hevc10', mbps: 45 }], small: ['Small file · HEVC 6 Mbps', { fmt: 'mp4x', codec: 'hevc', mbps: 6 }], social: ['Social · H.264 10 Mbps 30 fps', { fmt: 'mp4x', codec: 'avc', mbps: 10, fps: 30 }],
    av1: ['Open web · AV1 8 Mbps', { fmt: 'mp4x', codec: 'av1', mbps: 8 }], vp9: ['Open web · VP9 12 Mbps', { fmt: 'mp4x', codec: 'vp9', mbps: 12 }],
    prores: ['Master · Apple ProRes 422 HQ (.mov)', { fmt: 'master', master: 'prores_hq' }], alpha: ['Overlay with alpha · ProRes 4444 (.mov)', { fmt: 'master', master: 'prores_4444' }], dnx: ['Avid / Resolve · DNxHR HQ (.mov)', { fmt: 'master', master: 'dnxhr_hq' }],
    pngseq: ['VFX hand-off · PNG sequence', { fmt: 'seq', seq: 'png_seq' }], wav: ['Audio stem · WAV 24-bit', { fmt: 'audio', audioK: 'wav' }], mp3: ['Audio · MP3 320 kbps', { fmt: 'audio', audioK: 'mp3' }], custom: ['Custom', {}] };
  const SW = ['avc', 'hevc', 'hevc10', 'vp9', 'av1'], NAMES = { ...CODEC_NAMES, hevc10: 'H.265 / HEVC 10-bit' };
  let hw = null, pro = { master: [], seq: [], mp4: [], audio: [] };
  const body = el('div', {});
  const render = () => {
    const sw = pro.mp4.length ? SW.filter(k => pro.mp4.includes(ProMedia.SOFT[k])) : [], codecs = [...new Set([...(hw || []), ...sw])].sort((a, b) => SW.indexOf(a) - SW.indexOf(b));
    const fmts = [...(exact || sw.length ? ['mp4x'] : []), ...(pro.master.length ? ['master'] : []), ...(pro.seq.length ? ['seq'] : []), ...(pro.audio.length ? ['audio'] : []), ...(mp4ok ? ['mp4'] : []), 'webm'];
    const okPreset = k => { const p = PRESETS[k][1]; if (!p.fmt) return true; if (!fmts.includes(p.fmt)) return false; if (p.fmt === 'mp4x') return codecs.includes(p.codec); if (p.fmt === 'master') return pro.master.includes(p.master); if (p.fmt === 'seq') return pro.seq.includes(p.seq); return true; };
    const probing = exact && hw === null, okP = Object.keys(PRESETS).filter(okPreset); if (!probing && !okP.includes(o.preset)) o.preset = 'custom';
    if (!fmts.includes(o.fmt)) o.fmt = fmts[0]; if (o.fmt === 'mp4x' && codecs.length && !codecs.includes(o.codec)) o.codec = codecs[0];
    const hwOk = (hw || []).includes(o.codec), swOk = sw.includes(o.codec); if (!probing) { if (!hwOk) o.engine = 'sw'; else if (!swOk) o.engine = 'hw'; }
    const custom = () => { o.preset = 'custom'; render(); };
    body.innerHTML = '';
    if (typeof Doctor !== 'undefined') body.append(Doctor.summary());
    body.append(el('div', { class: 'dim' }, `${P.w}×${P.h} · ${tcFmt(P.dur)}` + (ProMedia.on ? (pro.master.length ? ' · pro codecs by FFmpeg' : ' · FFmpeg not found — pro codecs unavailable') : '') + (mp4ok || exact ? '' : ' (This browser cannot record MP4 — use Chrome/Edge 126+ for MP4.)')),
      field('Preset', o, 'preset', 'select', { opts: okP, names: k => PRESETS[k][0], cb: () => { Object.assign(o, PRESETS[o.preset][1]); render(); } }),
      field('Format', o, 'fmt', 'select', { opts: fmts, names: v => ({ mp4x: 'MP4 — exact frames (delivery)', master: 'Master file — ProRes / DNxHR / CineForm (.mov)', seq: 'Image sequence — PNG / TIFF', audio: 'Audio only — MP3 / WAV / FLAC / M4A', mp4: 'MP4 — real-time capture', webm: 'WebM — real-time capture' }[v]), cb: custom }));
    if (o.fmt === 'mp4x') {
      if (hw === null && exact) body.append(el('div', { class: 'dim' }, 'Checking which codecs this computer can encode…'));
      else body.append(field('Codec', o, 'codec', 'select', { opts: codecs, names: k => NAMES[k] + (k === 'avc' ? ' (plays everywhere)' : k === 'hevc' ? ' (half the size)' : k === 'hevc10' ? ' (10-bit, HDR-ready)' : k === 'av1' ? ' (smallest)' : ''), cb: custom }));
      if (hwOk && swOk) body.append(field('Encoder', o, 'engine', 'select', { opts: ['hw', 'sw'], names: v => v === 'hw' ? 'Hardware — fastest (GPU / WebCodecs)' : 'Software — best quality per bit (FFmpeg)', cb: custom }));
      else if (codecs.length) body.append(el('div', { class: 'dim' }, o.engine === 'hw' ? 'Encoder: hardware (WebCodecs)' : 'Encoder: software (FFmpeg) — this PC has no hardware encoder for it'));
      body.append(field('Video bitrate', o, 'mbps', 'select', { opts: [4, 6, 8, 10, 12, 16, 20, 30, 40, 45, 60, 80, 100, 120, 160, 240], names: v => v + ' Mbps', cb: custom }));
    }
    if (o.fmt === 'master') body.append(field('Codec', o, 'master', 'select', { opts: pro.master, names: k => ProMedia.label(k), cb: custom }));
    if (o.fmt === 'seq') body.append(field('Format', o, 'seq', 'select', { opts: pro.seq, names: k => ProMedia.label(k), cb: custom }));
    if (o.fmt === 'audio') body.append(field('Audio format', o, 'audioK', 'select', { opts: pro.audio, names: k => ProMedia.label(k), cb: custom }));
    if ((o.fmt === 'master' && ProMedia.alphaCodec(o.master)) || o.fmt === 'seq') body.append(el('div', { class: 'dim' }, P.bg === 'transparent' ? 'Alpha channel: included (transparent background).' : 'Alpha channel: background is solid — set it to Transparent in Project settings to export alpha.'));
    if (ProMedia.on && pro.mp4.length && (o.fmt === 'mp4x' || o.fmt === 'master' || o.fmt === 'seq')) body.append(field('Output size', o, 'size', 'select', { opts: [0, ...[1280, 1920, 2560, 3840, 7680].filter(e => e !== Math.max(P.w, P.h))], names: e => { if (!e) return `Project size · ${P.w}×${P.h}`; const [w, h] = scaled(+e); return `${SIZE_NAME[e]} · ${w}×${h}` + (e > Math.max(P.w, P.h) ? ' (upscaled)' : ''); }, cb: render }));
    if (o.fmt !== 'audio') body.append(field('Frame rate', o, 'fps', 'select', { opts: [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].filter(v => v <= Math.max(60, P.fps)), names: v => v + ' fps' }));
    body.append(field('Range', o, 'range', 'select', { opts: hasIO ? ['all', 'io'] : ['all'], names: v => v === 'all' ? `Whole timeline (${tcFmt(P.dur)})` : `In to Out (${tcFmt(io.in)} – ${tcFmt(io.out)})` }));
    if (o.fmt !== 'audio' && o.fmt !== 'seq') body.append(field('Include audio', o, 'audio', 'check'));
  };
  render();
  Promise.all([exact ? supportedCodecs(P.w, P.h, P.fps) : Promise.resolve([]), ProMedia.probe()]).then(([c]) => { hw = c; pro = { master: ProMedia.available('master'), seq: ProMedia.available('seq'), mp4: ProMedia.available('mp4'), audio: ProMedia.available('audio') }; render(); });
  showModal('Export', body, [['Cancel', closeModal], ['Export frame as PNG', () => { closeModal(); exportFrame('png'); }], ...(ProMedia.on ? [['Add to queue', () => { const k = o.fmt === 'master' ? o.master : o.fmt === 'seq' ? o.seq : o.fmt === 'audio' ? o.audioK : o.fmt === 'mp4x' ? ProMedia.SOFT[o.codec] : null; if (!k) return toast('Real-time capture cannot be queued. Choose an exact-frame format.'); const out = +o.size ? scaled(+o.size) : null; RenderQueue.add({ codec: k, label: ProMedia.label(k), fps: +o.fps, audio: o.fmt === 'seq' ? false : o.audio, mbps: +o.mbps, from: o.range === 'io' ? io.in : 0, to: o.range === 'io' ? io.out : P.dur, outW: out ? out[0] : undefined, outH: out ? out[1] : undefined }); closeModal(); RenderQueue.open(); }]] : []), ['Start export', () => startExport({ out: +o.size ? scaled(+o.size) : null, mbps: +o.mbps, fps: +o.fps, audio: o.audio, fmt: o.fmt, codec: o.codec, engine: o.engine, master: o.master, seq: o.seq, audioK: o.audioK, from: o.range === 'io' ? io.in : 0, to: o.range === 'io' ? io.out : P.dur }), true]]);
}
const MP4_MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
const WEBM_MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
function startExport(o) {
  const pro = { from: o.from, to: o.to, fps: o.fps, audio: o.audio, mbps: o.mbps, outW: o.out ? o.out[0] : undefined, outH: o.out ? o.out[1] : undefined };
  if (o.fmt === 'master') { closeModal(); return ProMedia.exportPro({ ...pro, codec: o.master }); }
  if (o.fmt === 'seq') { closeModal(); return ProMedia.exportPro({ ...pro, codec: o.seq, audio: false }); }
  if (o.fmt === 'audio') { closeModal(); return ProMedia.exportPro({ ...pro, codec: o.audioK || 'wav' }); }
  if (o.fmt === 'mp4x' && (o.engine === 'sw' || o.codec === 'hevc10' || o.out)) { closeModal(); return ProMedia.exportPro({ ...pro, codec: ProMedia.SOFT[o.codec] }); }
  if (o.fmt === 'mp4x') return exportOffline(o);
  if (!window.MediaRecorder) return toast('MediaRecorder is not supported in this browser.');
  const bar = el('div', {}), msg = el('div', { class: 'dim' }, 'Rendering in real time…'); bar.append(el('div', { class: 'bar' }, el('div', { id: 'expBar' })));
  showModal('Exporting…', el('div', {}, msg, bar), [['Cancel', cancelExport]]);
  const stream = view.captureStream(o.fps);
  if (o.audio) { ensureAudio(); ACdest.stream.getAudioTracks().forEach(t => stream.addTrack(t)); }
  const isMp4 = o.fmt === 'mp4', mime = (isMp4 ? MP4_MIMES : WEBM_MIMES).find(t => MediaRecorder.isTypeSupported(t)) || WEBM_MIMES[2], ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: o.mbps * 1e6, audioBitsPerSecond: 192000 }); chunks = []; expCancel = false;
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => { clearInterval(expTimer); closeModal(); if (!expCancel) { download(new Blob(chunks, { type: 'video/' + ext }), safeName() + '.' + ext); toast('Export finished (' + ext.toUpperCase() + ').'); } };
  exporting = true; seek(0); setTimeout(() => { rec.start(250); play(); }, 150);
  expTimer = setInterval(() => { const b = $('expBar'); if (b) b.style.width = Math.min(100, T / P.dur * 100) + '%'; }, 120);
}
function onExportEnd() { exporting = false; T = Math.max(0, P.dur - 1 / P.fps); requestRender(); setTimeout(() => { if (rec && rec.state !== 'inactive') rec.stop(); }, 400); }
function cancelExport() { expCancel = true; exporting = false; clearInterval(expTimer); if (rec && rec.state !== 'inactive') rec.stop(); pause(); closeModal(); }

/* ---- file import / drag-drop ---- */
$('fileIn').onchange = async e => { for (const f of e.target.files) await importFile(f); e.target.value = ''; leftTab = 'media'; buildLeft(); };
let dragN = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragN++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async e => {
  dragN = 0; document.body.classList.remove('dragging');
  if (typeof Shell !== 'undefined' && Shell.active !== 'edit') return;   // other workspaces handle their own drops
  if (!e.dataTransfer.files.length) return; e.preventDefault();
  let t = T; for (const f of e.dataTransfer.files) { const m = await importFile(f); if (m) { const L = addMediaLayer(m, t); t = L.start + L.dur; } }
});

/* ---- header / transport wiring ---- */
$('btnUndo').onclick = undo; $('btnRedo').onclick = redo; $('btnExport').onclick = exportDialog;
$('btnSettings').onclick = () => { selId = null; uiSel(); };
$('projName').oninput = e => P.name = e.target.value;
$('bPlay').onclick = togglePlay; $('bStart').onclick = () => seek(0); $('bEnd').onclick = () => seek(P.dur);
$('bPrev').onclick = () => seek(T - 1 / P.fps); $('bNext').onclick = () => seek(T + 1 / P.fps);
$('bLoop').onclick = toggleLoop; $('bFit').onclick = fitView;
$('b100').onclick = () => { const r = stageWrap.getBoundingClientRect(); zoom = 1; panX = (r.width - P.w) / 2; panY = (r.height - P.h) / 2; applyView(); };

/* ---- keyboard ---- */
window.addEventListener('keydown', e => {
  if (typeof Shell !== 'undefined' && Shell.active !== 'edit') return;   // shortcuts only apply while NEXORA Edit is visible
  const tg = e.target, typing = tg.matches && tg.matches('input:not([type=range]):not([type=checkbox]):not([type=color]),textarea,select');
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    if (k === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y' && !typing) { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); saveProject(); }
    else if (k === 'e') { e.preventDefault(); exportDialog(); }
    else if (k === 'i') { e.preventDefault(); $('fileIn').click(); }
    else if (k === 'd' && !typing) { e.preventDefault(); const L = selLayer(); if (L) { duplicateLayer(L); commit(); } }
    return;
  }
  if (typing) { if (k === 'escape') tg.blur(); return; }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(T - (e.shiftKey ? 1 : 1 / P.fps)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(T + (e.shiftKey ? 1 : 1 / P.fps)); }
  else if (e.key === 'Home') seek(0); else if (e.key === 'End') seek(P.dur);
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); doDelete(); }
  else if (k === 's') doSplit();
  else if (k === 'k') keyAll();
  else if (k === 'm') addMarker();
  else if (k === 'escape') { selId = null; uiSel(); }
  else if (e.key === '[' && (tool === 'brush' || tool === 'eraser')) { brush.size = Math.max(1, Math.round(brush.size * .85)); buildOptions(); }
  else if (e.key === ']' && (tool === 'brush' || tool === 'eraser')) { brush.size = Math.min(400, Math.round(brush.size * 1.18) + 1); buildOptions(); }
  else if (e.key === '[') trimTo(true); else if (e.key === ']') trimTo(false);
  else if (e.key === '+' || e.key === '=') zoomTl(1.3); else if (e.key === '-') zoomTl(1 / 1.3);
  else { const t = TOOLS.find(t => t.key.toLowerCase() === k); if (t) setTool(t.id); }
});

/* ---- subtitles (.srt / .vtt) ---- */
function parseSubs(txt) {
  const out = [], tm = s => { const m = s.trim().replace(',', '.').split(':').map(Number); return m.length === 3 ? m[0] * 3600 + m[1] * 60 + m[2] : m[0] * 60 + m[1]; };
  txt.replace(/\r/g, '').split(/\n\s*\n/).forEach(b => { const ln = b.split('\n').filter(Boolean), i = ln.findIndex(l => l.includes('-->')); if (i < 0) return; const [a, c] = ln[i].split('-->'); const text = ln.slice(i + 1).join('\n').replace(/<[^>]+>/g, ''); if (text) out.push({ s: tm(a), e: tm(c.split(' ')[0]), text }); });
  return out;
}
$('srtIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; const subs = parseSubs(await f.text()); e.target.value = '';
  if (!subs.length) return toast('No subtitles found in that file.');
  subs.forEach(s => { const L = mkLayer('text', { name: s.text.slice(0, 24), start: s.s, dur: Math.max(.3, s.e - s.s), tin: { type: 'fade', dur: .12 }, tout: { type: 'fade', dur: .12 } }); Object.assign(L.text, { str: s.text, size: 48, weight: '700', bgOn: true, bg: '#000000', bgPad: 14 }); L.tr.y = P.h * .87; P.layers.push(L); if (s.e > P.dur) P.dur = Math.ceil(s.e); });
  commit(); structChanged(); toast(subs.length + ' subtitles imported as text layers.');
};
/* ---- voiceover recording ---- */
let recording = false, vo = null;
async function toggleVoiceover() {
  if (recording) { vo.rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), start = T, chs = [];
    const rec = new MediaRecorder(stream); vo = { rec, stream };
    rec.ondataavailable = e => e.data.size && chs.push(e.data);
    rec.onstop = async () => { recording = false; pause(); stream.getTracks().forEach(t => t.stop()); const m = await importFile(new File([new Blob(chs, { type: 'audio/webm' })], 'Voiceover.webm', { type: 'audio/webm' })); if (m) addMediaLayer(m, start); buildLeft(); };
    recording = true; rec.start(); seek(start); play(); buildLeft(); toast('Recording… press ■ to stop (video plays along).');
  } catch (e) { recording = false; toast('Microphone unavailable: ' + e.message); }
}
/* ---- markers ---- */
function addMarker() { P.markers = P.markers || []; if (!P.markers.some(m => Math.abs(m - T) < .02)) P.markers.push(frameQ(T)); P.markers.sort((a, b) => a - b); commit(); renderTimeline(); }
/* ---- freeze frame ---- */
async function freezeFrame() {
  const L = selLayer(); if (!L || L.type !== 'video') return toast('Select a video layer, then put the playhead on the frame to freeze.');
  const el_ = getEl(L), C = contentOf(L, T); if (!C) return toast('Frame not ready yet.');
  const cv = mkCanvas(C.w, C.h); cv.getContext('2d').drawImage(el_, 0, 0, C.w, C.h);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png')), m = await importFile(new File([blob], 'Freeze ' + tcFmt(T) + '.png', { type: 'image/png' }));
  const F = mkLayer('image', { name: 'Freeze frame', media: m.id, start: T, dur: 2 }); Object.assign(F.tr, L.tr); F.tr.s = L.tr.s * (L.tr.sx / 100); F.tr.sx = 100; F.tr.sy = L.tr.sy / L.tr.sx * 100; F.flipX = L.flipX; F.flipY = L.flipY; addLayer(F); commit();
}
/* ---- demo project ---- */
function buildDemo() {
  const W = P.w, H = P.h; P.name = 'Welcome Demo'; $('projName').value = P.name; P.dur = 10;
  const sh = (name, o, s, set) => { const L = mkLayer('shape', Object.assign({ name, start: 0, dur: 10 }, o || {})); Object.assign(L.shape, s); if (set) set(L); return L; };
  const addFx = (L, t, p) => { const f = newFx(t); Object.assign(f.p, p); L.fx.push(f); return f; };
  P.layers.push(sh('Background', {}, { kind: 'rect', w: W, h: H, grad: true, fill: '#000000', fill2: '#07243d', angle: 35 }));
  P.layers.push(sh('Orb pink', { blend: 'screen' }, { kind: 'ellipse', w: 460, h: 460, fill: '#5cb8ff' }, L => { L.tr.y = H * .35; addFx(L, 'blur', { amount: 70 }); upsertKey(L, 'x', 0, -150, 'inout'); upsertKey(L, 'x', 10, W + 150, 'inout'); }));
  P.layers.push(sh('Orb cyan', { blend: 'screen' }, { kind: 'ellipse', w: 560, h: 560, fill: '#7cc8ff' }, L => { L.tr.y = H * .7; addFx(L, 'blur', { amount: 80 }); upsertKey(L, 'x', 0, W + 150, 'inout'); upsertKey(L, 'x', 10, -150, 'inout'); }));
  P.layers.push(sh('Star', { tin: { type: 'pop', dur: .8 } }, { kind: 'star', w: 170, h: 170, fill: '#3b82f6', points: 5 }, L => { L.tr.x = W * .84; L.tr.y = H * .22; addFx(L, 'shadow', { x: 0, y: 10, blur: 22, op: 60 }); upsertKey(L, 'rot', 0, 0, 'linear'); upsertKey(L, 'rot', 10, 360, 'linear'); }));
  P.layers.push(sh('Heart', { tin: { type: 'pop', dur: .8 }, start: .5, dur: 9.5 }, { kind: 'heart', w: 120, h: 110, fill: '#5cb8ff' }, L => { L.tr.x = W * .13; L.tr.y = H * .78; addFx(L, 'glow', { radius: 20, amount: 90 }); for (let t = 0, i = 0; t <= 9.5; t += .5, i++) upsertKey(L, 's', t, i % 2 ? 118 : 100, 'inout'); }));
  const title = mkLayer('text', { name: 'Title', start: .4, dur: 9.2, tin: { type: 'zoom-in', dur: .9 }, tout: { type: 'fade', dur: .6 } });
  Object.assign(title.text, { str: 'NEXORA STUDIO', size: 132, weight: '900', shadow: true, shBlur: 24, shY: 10, shColor: '#000000' }); title.tr.y = H * .43; addFx(title, 'glow', { radius: 26, amount: 55 }); upsertKey(title, 's', 0, 100, 'linear'); upsertKey(title, 's', 9.2, 108, 'linear'); P.layers.push(title);
  const sub = mkLayer('text', { name: 'Subtitle', start: 1.3, dur: 8.3, tin: { type: 'slide-up', dur: .7 }, tout: { type: 'fade', dur: .5 } });
  Object.assign(sub.text, { str: 'Video  ·  Motion  ·  Photo  —  one editor', size: 44, weight: '600', color: '#cfe9ff', spacing: 3 }); sub.tr.y = H * .6; P.layers.push(sub);
  const hint = mkLayer('text', { name: 'Hint', start: 2.4, dur: 7, tin: { type: 'wipe-left', dur: .7 }, tout: { type: 'wipe-left', dur: .5 } });
  Object.assign(hint.text, { str: 'Drop your media anywhere to start editing', size: 34, weight: '700', bgOn: true, bg: '#5cb8ff', bgPad: 20 }); hint.tr.y = H * .82; P.layers.push(hint);
  const adj = mkLayer('adjust', { name: 'Cinematic look', start: 0, dur: 10 }); addFx(adj, 'vignette', { amount: 60, size: 48 }); addFx(adj, 'grain', { amount: 22 }); P.layers.push(adj);
  selId = null;
}

/* ====================== boot ====================== */
buildTools(); setTool('move'); buildLeft();
buildDemo(); fitView(); commit(); structChanged();
new ResizeObserver(() => { resizeOverlay(); if (!userZoomed) fitView(); }).observe(stageWrap);
window.addEventListener('resize', () => { resizeOverlay(); if (!userZoomed) fitView(); });
resizeOverlay(); fitView(); uiPlayState();
requestAnimationFrame(tick);
window.__app = { get P() { return P; }, media, seek, play, pause, addLayer, mkLayer };

