'use strict';
/* ====================== Project Doctor, system check, render queue ======================
   Doctor reads the timeline and reports what would embarrass you after export, each with a one-click fix where one is safe. */
const Doctor = (() => {
  const PIC = ['video', 'image', 'comp', 'vfx', 'gen', 'solid'], SEV = { error: 0, warn: 1, info: 2 }, LOOK = ['audio', 'adjust', 'null'];   // layers that add no picture of their own
  const goTo = L => { selId = L.id; seek(L.start); renderTimeline(); };
  function check() {
    const out = [], add = (sev, title, detail, o) => out.push(Object.assign({ sev, title, detail }, o || {})), fps = P.fps || 30, fr = 1 / fps, L_ = P.layers;
    const miss = Object.values(media).filter(m => m.missing); if (miss.length) add('error', `${miss.length} offline file${miss.length > 1 ? 's' : ''}`, 'These clips will export as offline cards: ' + miss.slice(0, 3).map(m => m.name).join(', '), { kind: 'offline' });
    if (!L_.length) { add('info', 'The timeline is empty', 'Nothing to export yet.'); return out; }
    if (P.w % 2 || P.h % 2) add('warn', 'Odd canvas size', `${P.w}×${P.h}: video encoders need even dimensions, so the last pixel row or column would be dropped.`, { kind: 'odd', fix: () => setProjectSize(P.w & ~1, P.h & ~1) });
    for (const L of L_) {
      const m = media[L.media];
      if (L.visible && PIC.includes(L.type) && L.dur <= fr * 2.5) add('warn', 'Flash frame', `"${L.name}" lasts ${Math.round(L.dur * fps)} frame${Math.round(L.dur * fps) === 1 ? '' : 's'} at ${tcFmt(L.start)}.`, { kind: 'flash', L, fix: () => removeLayer(L.id) });
      if (m && m.dur && (L.type === 'video' || L.type === 'audio') && L.srcIn + L.dur * L.speed > m.dur + .08) add('error', 'Clip runs past its source', `"${L.name}" asks for ${(L.srcIn + L.dur * L.speed - m.dur).toFixed(2)} s more than the file has, so it will freeze or go silent.`, { kind: 'overrun', L, fix: () => { L.dur = Math.max(fr, (m.dur - L.srcIn) / L.speed); } });
      if (m && m.peaks && (L.type === 'video' || L.type === 'audio') && !L.muted && !(L.kf.vol && L.kf.vol.length)) { const a = Math.floor(L.srcIn * 50), z = Math.min(m.peaks.length, Math.ceil((L.srcIn + L.dur * L.speed) * 50)); let pk = 0; for (let i = a; i < z; i++) if (m.peaks[i] > pk) pk = m.peaks[i]; if (pk * L.vol / 100 > 1.001) add('warn', 'Audio will clip', `"${L.name}" peaks ${(20 * Math.log10(pk * L.vol / 100)).toFixed(1)} dB over full scale.`, { kind: 'clip', L, fix: () => { L.vol = Math.floor(89 / pk); } }); }
      if (m && m.w && (L.type === 'video' || L.type === 'image') && !(L.kf.s && L.kf.s.length)) { const k = L.tr.s / 100 * L.tr.sx / 100; if (k > 1.15) add('warn', 'Soft picture', `"${L.name}" is ${m.w}×${m.h} shown at ${Math.round(k * 100)}%. It will look soft at ${P.w}×${P.h}.`, { kind: 'soft', L }); }
      if (L.type === 'text' && !(L.kf.x && L.kf.x.length) && !(L.kf.y && L.kf.y.length) && (L.tr.x < P.w * .03 || L.tr.x > P.w * .97 || L.tr.y < P.h * .03 || L.tr.y > P.h * .97)) add('warn', 'Text outside the safe area', `"${L.text.str.slice(0, 40)}" sits at the edge of the frame.`, { kind: 'safe', L });
      if (!L.visible) add('info', 'Hidden clip', `"${L.name}" is switched off and will not export.`, { kind: 'hidden', L });
      if ((L.type === 'video' || L.type === 'audio') && L.vol === 0 && !L.muted && !(L.kf.vol && L.kf.vol.length)) add('info', 'Silent clip', `"${L.name}" has its volume at 0.`, { kind: 'silent', L });
    }
    const pics = L_.filter(l => l.visible && !LOOK.includes(l.type)).map(l => [l.start, l.start + l.dur]).sort((a, b) => a[0] - b[0]), full = L_.reduce((e, l) => Math.max(e, l.start + l.dur), 0);
    if (pics.length) { let end = 0; const gaps = []; for (const [a, b] of pics) { if (a - end > fr * 1.5) gaps.push([end, a]); end = Math.max(end, b); } gaps.slice(0, 5).forEach(([a, b]) => add('warn', 'Black gap', `${(b - a).toFixed(2)} s with no picture at ${tcFmt(a)}.`, { kind: 'gap', at: a })); }
    if (P.dur - full > .5) add('warn', 'Empty tail', `The timeline runs ${(P.dur - full).toFixed(1)} s past the last clip.`, { kind: 'tail', fix: () => { P.dur = Math.max(fr, frameQ(full)); } });
    return out.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
  }
  const verdict = l => { const e = l.filter(x => x.sev === 'error').length, w = l.filter(x => x.sev === 'warn').length; return e ? `${e} problem${e > 1 ? 's' : ''} to fix before this goes out.` : w ? `${w} thing${w > 1 ? 's' : ''} worth a look.` : 'Clean cut. Ship it.'; };
  function applyFix(it) { if (!it.fix) return false; it.fix(); commit(); structChanged(); requestRender(); return true; }
  function fixAll() { let n = 0; for (const it of check().reverse()) if (applyFix(it)) n++; return n; }
  function open() {
    const body = el('div', { style: 'width:480px;max-width:100%;max-height:62vh;overflow:auto' });
    const draw = () => { const l = check(); body.innerHTML = ''; body.append(el('p', { class: 'doc-verdict' }, verdict(l))); l.forEach(it => body.append(el('div', { class: 'doc-row ' + it.sev }, el('i', {}), el('div', { style: 'flex:1;min-width:0' }, el('b', {}, it.title), el('small', { class: 'dim' }, it.detail)), it.L ? el('button', { onclick: () => { closeModal(); goTo(it.L); } }, 'Show') : it.at != null ? el('button', { onclick: () => { closeModal(); seek(it.at); } }, 'Show') : null, it.kind === 'offline' ? el('button', { onclick: () => { closeModal(); Shell.commands().find(c => c.title.startsWith('Media: Relink')).run(); } }, 'Relink') : null, it.fix ? el('button', { class: 'primary', onclick: () => { applyFix(it); draw(); } }, 'Fix') : null))); };
    draw(); showModal('Project Doctor', body, [['Fix everything fixable', () => { const n = fixAll(); draw(); toast(n ? `${n} fixed. Undo brings them back.` : 'Nothing automatic to fix.'); }], ['Done', closeModal, true]]);
  }
  /** one line for the export dialog */
  function summary() { const l = check().filter(x => x.sev !== 'info'); return l.length ? el('div', { class: 'doc-sum' }, el('span', {}, verdict(l)), el('a', { onclick: () => { closeModal(); open(); } }, 'Review')) : el('div', { class: 'doc-sum ok' }, 'Project Doctor: clean cut.'); }

  /* ---------- system check ---------- */
  async function system() {
    const rows = [], put = (n, v, good) => rows.push([n, v, good]), root = window.nxfs ? await nxfs.defaultRoot() : null;
    put('GPU effects', GPU.available ? GPU.status() : 'Not available: effects run on the processor', GPU.available);
    let codecs = []; if (window.VideoEncoder) { codecs = await supportedCodecs(3840, 2160, 30); put('Hardware encoding at 4K', codecs.length ? codecs.map(c => CODEC_NAMES[c]).join(', ') : 'None: exports use software', codecs.length > 0); }
    const ff = await ProMedia.probe(); put('FFmpeg', ff.available ? 'Version ' + ff.version : window.nxff ? 'Not bundled in this build' : 'Desktop app only', !!ff.available);
    if (root) { const f = await nxfs.free(root); put('Free disk space', f ? (f / 1073741824).toFixed(0) + ' GB' : 'Unknown', f > 2e10); }
    if (performance.memory) put('Memory used by NEXORA', (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB of ' + (performance.memory.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB', performance.memory.usedJSHeapSize < performance.memory.jsHeapSizeLimit * .8);
    if (window.nxauth) { const s = await nxauth.status(); put('Account data', s.encrypted ? 'Encrypted by the system' : 'Not encrypted on this computer', s.encrypted); }
    return rows;
  }
  async function systemDialog() { const r = await system(); showModal('System check', el('div', { style: 'min-width:440px' }, r.map(([n, v, g]) => el('div', { class: 'doc-row ' + (g ? 'ok' : 'warn') }, el('i', {}), el('div', { style: 'flex:1' }, el('b', {}, n), el('small', { class: 'dim' }, v))))), [['Done', closeModal, true]]); }
  return { check, verdict, fixAll, open, summary, system, systemDialog, applyFix };
})();

const RenderQueue = (() => {
  const S = { items: [], running: false, stop: false }; let nextId = 1, drawFn = null;
  const redraw = () => { if (drawFn) drawFn(); };
  /** o: { codec, label, fps, from, to, audio, mbps, outW, outH, out? } */
  function add(o) { const it = Object.assign({ id: nextId++, state: 'waiting', pct: 0, msg: '' }, o); S.items.push(it); redraw(); return it; }
  async function outPath(it) {
    const dir = await nxfs.join(Disk.S.folder || await nxfs.defaultRoot(), 'Exports'), res = it.outW ? ` ${it.outW}x${it.outH}` : '', base = Disk.safe(`${safeName()} ${it.label}${res}`), ext = ProMedia.LIST[it.codec][2] === 'seq' ? '' : '.' + ProMedia.extOf(it.codec);
    for (let n = 0; ; n++) { const p = await nxfs.join(dir, base + (n ? ` ${n + 1}` : '') + ext); if (!(await nxfs.stat(p)).exists) return p; }
  }
  async function run() {
    if (S.running) return; S.running = true; S.stop = false; redraw(); let done = 0;
    try {
      for (const it of S.items) {
        if (it.state !== 'waiting') continue; if (S.stop) break; it.state = 'rendering'; redraw();
        try { const out = it.out || await outPath(it), t0 = performance.now(), r = await ProMedia.exportPro({ codec: it.codec, fps: it.fps, from: it.from, to: it.to, audio: it.audio, mbps: it.mbps, outW: it.outW, outH: it.outH, out, quiet: true, shouldCancel: () => S.stop, onProgress: (m, p) => { it.msg = m; it.pct = p; redraw(); } }); if (r) { it.state = 'done'; it.out = r.out; it.size = r.size; it.secs = (performance.now() - t0) / 1000; done++; if (typeof Persona !== 'undefined') Persona.stat('exports'); } else { it.state = 'cancelled'; } }
        catch (e) { it.state = 'failed'; it.msg = e.message || String(e); }
        redraw();
      }
    } finally { S.running = false; redraw(); }
    return done;
  }
  function open() {
    const body = el('div', { style: 'width:480px;max-width:100%;max-height:60vh;overflow:auto' }); const start = () => run();
    drawFn = () => { body.innerHTML = ''; if (!S.items.length) body.append(el('p', { class: 'dim' }, 'Queue is empty. In Export, choose your settings and press Add to queue.')); S.items.forEach(it => body.append(el('div', { class: 'doc-row ' + (it.state === 'failed' ? 'error' : it.state === 'done' ? 'ok' : 'info') }, el('i', {}), el('div', { style: 'flex:1;min-width:0' }, el('b', {}, it.label), el('small', { class: 'dim' }, it.state === 'done' ? `Done in ${it.secs.toFixed(0)} s${it.size ? ' · ' + (it.size / 1048576).toFixed(1) + ' MB' : ''}` : it.state === 'rendering' ? it.msg : it.state === 'failed' ? it.msg : it.state[0].toUpperCase() + it.state.slice(1)), it.state === 'rendering' ? el('div', { class: 'bar', style: 'margin:4px 0 0;height:3px' }, el('div', { style: `width:${it.pct}%` })) : null), it.state === 'done' && it.out ? el('button', { onclick: () => nxfs.reveal(it.out) }, 'Show') : null, it.state !== 'rendering' ? el('button', { onclick: () => { S.items = S.items.filter(x => x !== it); redraw(); } }, 'Remove') : null))); body.append(el('p', { class: 'dim', style: 'margin:10px 0 0' }, 'Each job renders the timeline as it is when that job starts.')); };
    drawFn(); showModal('Render queue', body, [['Close', () => { drawFn = null; closeModal(); }], [S.running ? 'Stop after this' : 'Start', () => { if (S.running) { S.stop = true; } else start(); }, true]]);
  }
  return { S, add, run, open };
})();
