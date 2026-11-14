'use strict';
/* ====================== NEXORA Audio — mixer ======================
   Every clip with sound (video / audio layers) is a channel strip:  source → 3-band EQ → pan → [compressor] → meter → master.
   Master bus: gain → [limiter] → meter → speakers (and the capture stream used by realtime export).
   The SAME chain is rebuilt inside the OfflineAudioContext used for MP4 export, so what you hear is what you export.
   Settings live on the layer (L.audio = { eq:[low,mid,high] dB, pan -1…1, comp, thr, ratio }) and on the project
   (P.audioMaster = { gain dB, limiter }). Loudness: integrated loudness per ITU-R BS.1770 / EBU R128 gating
   (K-weighting approximated with Web Audio biquads), sample peak. Auto-duck writes ordinary volume keyframes. */
const AudioMix = (() => {
  const DEF = () => ({ eq: [0, 0, 0], pan: 0, comp: false, thr: -18, ratio: 3, reverb: 0 });
  const conf = L => { if (!L.audio) L.audio = DEF(); return L.audio; };
  const master = () => { const p = typeof Motion !== 'undefined' ? Motion.editProject() : P; return p.audioMaster || (p.audioMaster = { gain: 0, limiter: true }); };
  const dB = v => Math.pow(10, v / 20), toDB = g => g > 0 ? 20 * Math.log10(g) : -Infinity;

  /* ---------- processing chain (works on AudioContext and OfflineAudioContext) ---------- */
  function strip(ctx, out, send) {
    const pre = ctx.createGain(), lo = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter(), pan = ctx.createStereoPanner(), comp = ctx.createDynamicsCompressor(), dry = ctx.createGain(), wet = ctx.createGain(), meter = ctx.createAnalyser();
    lo.type = 'lowshelf'; lo.frequency.value = 200; mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = .9; hi.type = 'highshelf'; hi.frequency.value = 5000;
    comp.knee.value = 6; comp.attack.value = .01; comp.release.value = .2; meter.fftSize = 1024;
    pre.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(pan); pan.connect(dry); pan.connect(comp); comp.connect(wet); dry.connect(meter); wet.connect(meter); meter.connect(out);
    const rv = ctx.createGain(); rv.gain.value = 0; meter.connect(rv); if (send) rv.connect(send);   // post-fader reverb send
    const s = { input: pre, meter, set(a, boost) { rv.gain.value = clamp(a.reverb || 0, 0, 1); pre.gain.value = boost || 1; lo.gain.value = a.eq[0]; mid.gain.value = a.eq[1]; hi.gain.value = a.eq[2]; pan.pan.value = clamp(a.pan, -1, 1); comp.threshold.value = a.thr; comp.ratio.value = a.ratio; dry.gain.value = a.comp ? 0 : 1; wet.gain.value = a.comp ? 1 : 0; } };
    return s;
  }
  /* algorithmic room: stereo impulse response of decorrelated noise with an exponential decay and early pre-delay */
  function roomIR(ctx, decay, pre) {
    const sr = ctx.sampleRate, n = Math.max(1, Math.round((decay + pre) * sr)), ir = ctx.createBuffer(2, n, sr), rnd = mulberry(1234);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = Math.round(pre * sr); i < n; i++) { const t = i / sr - pre; d[i] = (rnd() * 2 - 1) * Math.pow(10, -3 * t / decay); } }   // −60 dB at `decay` s
    return ir;
  }
  function masterBus(ctx, dests) {
    const g = ctx.createGain(), lim = ctx.createDynamicsCompressor(), dry = ctx.createGain(), wet = ctx.createGain(), meter = ctx.createAnalyser(); meter.fftSize = 2048;
    lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .002; lim.release.value = .08;
    g.connect(dry); g.connect(lim); lim.connect(wet); dry.connect(meter); wet.connect(meter); dests.forEach(d => meter.connect(d));
    // reverb return: strips send into `send`; the convolved signal joins the master bus before gain / limiter
    const send = ctx.createGain(), conv = ctx.createConvolver(), ret = ctx.createGain(); conv.normalize = true; send.connect(conv); conv.connect(ret); ret.connect(g); let irKey = '';
    return { input: g, send, meter, set(m) {
      g.gain.value = dB(m.gain); dry.gain.value = m.limiter ? 0 : 1; wet.gain.value = m.limiter ? 1 : 0;
      const rv = m.reverb || (m.reverb = { decay: 1.8, pre: .02, level: 0 }), k = rv.decay + '|' + rv.pre; if (k !== irKey) { conv.buffer = roomIR(ctx, clamp(rv.decay, .2, 8), clamp(rv.pre, 0, .2)); irKey = k; } ret.gain.value = dB(rv.level || 0);
    } };
  }

  /* ---------- live playback ---------- */
  let live = null;
  function liveMaster() { if (!live) { ensureAudio(); live = masterBus(AC, [AC.destination, ACdest]); } live.set(master()); return live; }
  /** called by connectEl(): route a media element through its own channel strip */
  function attach(el) { const m = liveMaster(); el._strip = strip(AC, m.input, m.send); el._node.connect(el._strip.input); }
  /** called from syncMedia() every frame for each sounding clip */
  function update(el, L) { if (el._strip) el._strip.set(conf(L), el._strip.boost); if (live) live.set(master()); if (L) meters.set(L.id, el._strip); }
  const meters = new Map();

  /* ---------- export (offline) ---------- */
  function offlineGraph(ctx) { const m = masterBus(ctx, [ctx.destination]); m.set(master()); return { input: L => { const s = strip(ctx, m.input, m.send); s.set(conf(L)); return s.input; } }; }

  /* ---------- loudness (BS.1770-style integrated, gated) ---------- */
  /* exact ITU-R BS.1770-4 K-weighting: pre-filter (high shelf) + RLB high-pass, coefficients derived for any sample
     rate from the standard's analog prototypes (identical to the published 48 kHz values) and run as direct-form biquads */
  function kCoeffs(fs) {
    let K = Math.tan(Math.PI * 1681.974450955533 / fs), Q = .7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, .4996667741545416), a0 = 1 + K / Q + K * K;
    const s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    K = Math.tan(Math.PI * 38.13547087602444 / fs); Q = .5003270373238773; a0 = 1 + K / Q + K * K;
    const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    return [s1, s2];
  }
  function biquad(x, { b, a }) { const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; }
  /* true peak (BS.1770-4 Annex 2): 4× oversampling with a windowed-sinc interpolator (48 taps per phase), peak of |x| */
  const TP_TAPS = 12, TP_OS = 4, tpKernel = (() => { const k = []; for (let p = 0; p < TP_OS; p++) { const row = []; for (let j = -TP_TAPS + 1; j <= TP_TAPS; j++) { const x = j - p / TP_OS, sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x), w = .5 * (1 + Math.cos(Math.PI * x / TP_TAPS)); row.push(sinc * w); } k.push(row); } return k; })();
  function truePeak(d) { let pk = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; for (let p = 1; p < TP_OS; p++) { const row = tpKernel[p]; let s = 0; for (let j = 0; j < row.length; j++) { const n = i + j - TP_TAPS + 1; if (n >= 0 && n < d.length) s += row[j] * d[n]; } const b = Math.abs(s); if (b > pk) pk = b; } } return pk; }
  async function measure(buf) {
    const sr = buf.sampleRate, [s1, s2] = kCoeffs(sr), chans = [...Array(buf.numberOfChannels)].map((_, c) => biquad(biquad(buf.getChannelData(c), s1), s2));
    const blk = Math.round(.4 * sr), hop = Math.round(.1 * sr), z = [];
    for (let s = 0; s + blk <= buf.length; s += hop) { let sum = 0; for (const d of chans.slice(0, 2)) { let a = 0; for (let i = s; i < s + blk; i++) a += d[i] * d[i]; sum += a / blk; } z.push(sum); }   // L + R (weight 1.0 each)
    const L = v => -0.691 + 10 * Math.log10(v || 1e-12), abs = z.filter(v => L(v) > -70);
    let peak = 0, tp = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } tp = Math.max(tp, truePeak(d)); }
    if (!abs.length) return { lufs: -Infinity, peak: toDB(peak), truePeak: toDB(tp) };
    const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10, gated = abs.filter(v => L(v) > rel);
    return { lufs: L(gated.reduce((a, b) => a + b, 0) / gated.length), peak: toDB(peak), truePeak: toDB(tp) };
  }
  async function analyze() { const p = typeof Motion !== 'undefined' ? Motion.editProject() : P; const buf = await mixAudio(p.dur); if (!buf) return null; const r = await measure(buf); S.last = Object.assign(r, { at: Date.now(), master: master().gain }); return S.last; }
  /** set master gain so the mix hits the target integrated loudness (limiter keeps peaks under -1 dBFS) */
  async function normalize(target) { const r = await analyze(); if (!r || !isFinite(r.lufs)) return null; const m = master(); m.gain = clamp(+(m.gain + (target - r.lufs)).toFixed(1), -24, 24); commit(); const after = await analyze(); return { before: r, after, gain: m.gain }; }

  /* ---------- auto-duck: lower music while voice clips are speaking ---------- */
  async function envelope(L, step) {
    const m = media[L.media]; if (!m || !m.blob) return null; let ab; try { ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await m.blob.arrayBuffer()); } catch (e) { return null; }
    const d = ab.getChannelData(0), sr = ab.sampleRate, out = [];
    for (let lt = 0; lt < L.dur; lt += step) { const s0 = Math.floor((L.srcIn + lt * L.speed) * sr), s1 = Math.min(d.length, s0 + Math.floor(step * L.speed * sr)); let a = 0; for (let i = Math.max(0, s0); i < s1; i++) a += d[i] * d[i]; out.push({ t: L.start + lt, db: toDB(Math.sqrt(a / Math.max(1, s1 - s0))) }); }
    return out;
  }
  async function duck(music, voices, o) {
    o = Object.assign({ amount: -12, threshold: -38, attack: .15, release: .45, step: .05 }, o || {});
    const active = [];
    for (const v of voices) { const e = await envelope(v, o.step); if (e) e.forEach(p => { if (p.db > o.threshold) active.push(p.t); }); }
    if (!active.length) return 0;
    active.sort((a, b) => a - b); const spans = []; for (const t of active) { const s = spans[spans.length - 1]; if (s && t - s[1] <= o.release + o.attack + o.step) s[1] = t + o.step;   /* gaps shorter than a full dip-and-recover stay ducked (no pumping) */ else spans.push([t, t + o.step]); }
    const base = music.kf.vol && music.kf.vol.length ? null : music.vol, low = (base == null ? 100 : base) * dB(o.amount), hiV = base == null ? 100 : base, keys = [];
    for (const [a, b] of spans) { const s = a - music.start, e = b - music.start; if (e < 0 || s > music.dur) continue; keys.push([s - o.attack, hiV], [s, low], [e, low], [e + o.release, hiV]); }
    keys.sort((p, q) => p[0] - q[0]);
    music.kf.vol = keys.filter(k => k[0] >= 0 && k[0] <= music.dur).map(([t, v]) => ({ t: +t.toFixed(3), v: +v.toFixed(2), e: 'linear' })).filter((k, i, a) => !i || k.t > a[i - 1].t);
    commit(); structChanged(); return spans.length;
  }

  /* ---------- UI ---------- */
  const S = { root: null, focus: null, raf: 0, last: null };
  const sounding = () => { const p = typeof Motion !== 'undefined' ? Motion.editProject() : P; return p.layers.filter(L => (L.type === 'video' || L.type === 'audio') && media[L.media]); };
  function focus(id) { S.focus = id; if (S.root) render(); setTimeout(() => { const e = S.root && S.root.querySelector('.strip.focus'); if (e) e.scrollIntoView({ block: 'nearest', inline: 'center' }); }, 30); }
  function enter(root) { S.root = root; render(); loop(); }
  const volToDb = v => v > 0 ? 20 * Math.log10(v / 100) : -60, dbToVol = d => d <= -59.5 ? 0 : 100 * dB(d);
  function slider(label, min, max, step, val, fmt, on, vertical) {
    const out = el('span', { class: 'v' }, fmt(val)), i = el('input', { type: 'range', min, max, step, value: val, class: vertical ? 'vert' : '', oninput: e => { out.textContent = fmt(+e.target.value); on(+e.target.value, false); }, onchange: e => on(+e.target.value, true) });
    i.ondblclick = () => { const d = min < 0 && max > 0 ? 0 : min; i.value = d; out.textContent = fmt(d); on(d, true); };
    return el('label', { class: 'ctl' + (vertical ? ' vctl' : '') }, el('span', { class: 'k' }, label), i, out);
  }
  function stripUI(L) {
    const a = conf(L), auto = L.kf.vol && L.kf.vol.length, fdb = v => v <= -59.5 ? '−∞' : (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', f1 = v => (v > 0 ? '+' : '') + v.toFixed(1);
    const touch = fin => { requestRender(); if (fin) commit(); };
    const box = el('div', { class: 'strip' + (S.focus === L.id ? ' focus' : ''), 'data-id': L.id },
      el('div', { class: 'sname', title: L.name }, Icon(L.type === 'video' ? 'film' : 'music', 13), el('span', {}, L.name)),
      el('div', { class: 'eq' }, el('div', { class: 'k' }, 'EQ'),
        slider('High', -12, 12, .5, a.eq[2], f1, (v, fin) => { a.eq[2] = v; touch(fin); }), slider('Mid', -12, 12, .5, a.eq[1], f1, (v, fin) => { a.eq[1] = v; touch(fin); }), slider('Low', -12, 12, .5, a.eq[0], f1, (v, fin) => { a.eq[0] = v; touch(fin); })),
      slider('Reverb', 0, 1, .01, a.reverb || 0, v => Math.round(v * 100) + '%', (v, fin) => { a.reverb = v; touch(fin); }),
      slider('Pan', -1, 1, .05, a.pan, v => Math.abs(v) < .01 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100), (v, fin) => { a.pan = v; touch(fin); }),
      el('div', { class: 'comp' }, el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: a.comp ? '' : undefined, onchange: e => { a.comp = e.target.checked; touch(true); } }), 'Compressor'),
        slider('Threshold', -60, 0, 1, a.thr, v => v + ' dB', (v, fin) => { a.thr = v; touch(fin); }), slider('Ratio', 1, 20, .5, a.ratio, v => v + ':1', (v, fin) => { a.ratio = v; touch(fin); })),
      el('div', { class: 'fader' }, el('canvas', { class: 'meter', width: 14, height: 160, 'data-meter': L.id }),
        auto ? el('div', { class: 'auto' }, 'Volume is', el('br'), 'automated', el('br'), el('small', {}, '(keyframes)')) : slider('', -60, 6, .5, volToDb(L.vol), fdb, (v, fin) => { L.vol = +dbToVol(v).toFixed(2); touch(fin); }, true)),
      el('div', { class: 'ms' }, el('button', { class: L.muted ? 'on' : '', title: 'Mute', onclick: () => { L.muted = !L.muted; commit(); structChanged(); render(); } }, 'M'), el('button', { class: L.solo ? 'on' : '', title: 'Solo', onclick: () => { L.solo = !L.solo; commit(); structChanged(); render(); } }, 'S')));
    box.onclick = e => { if (e.target === box || e.target.closest('.sname')) focus(L.id); };
    return box;
  }
  function masterUI() {
    const m = master(), r = S.last;
    return el('div', { class: 'strip master' }, el('div', { class: 'sname' }, Icon('volume', 13), el('span', {}, 'Master')),
      el('div', { class: 'lufs' }, el('div', { class: 'big' }, r && isFinite(r.lufs) ? r.lufs.toFixed(1) : '—'), el('div', { class: 'k' }, 'LUFS integrated'), el('div', { class: 'k' }, r ? `true peak ${isFinite(r.truePeak) ? r.truePeak.toFixed(1) : '−∞'} dBTP` : 'not measured')),
      el('div', { class: 'comp' }, el('div', { class: 'k' }, 'Reverb room'),
        slider('Decay', .2, 8, .1, (m.reverb || {}).decay || 1.8, v => v.toFixed(1) + ' s', (v, fin) => { (m.reverb || (m.reverb = { decay: 1.8, pre: .02, level: 0 })).decay = v; if (fin) { requestRender(); commit(); } }),
        slider('Pre-delay', 0, .2, .005, (m.reverb || {}).pre ?? .02, v => Math.round(v * 1000) + ' ms', (v, fin) => { (m.reverb || (m.reverb = { decay: 1.8, pre: .02, level: 0 })).pre = v; if (fin) { requestRender(); commit(); } })),
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: m.limiter ? '' : undefined, onchange: e => { m.limiter = e.target.checked; commit(); } }), 'Limiter (−1 dB)'),
      el('div', { class: 'fader' }, el('canvas', { class: 'meter', width: 14, height: 160, 'data-meter': 'master' }), slider('', -24, 12, .5, m.gain, v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB', (v, fin) => { m.gain = v; requestRender(); if (fin) commit(); }, true)));
  }
  function render() {
    const R = S.root; if (!R) return; R.innerHTML = '';
    const list = sounding(), tc = el('span', { class: 'tc' }, tcFmt(T));
    const bar = el('div', { class: 'abar' },
      el('b', {}, 'Mixer'), el('button', { class: 'ibtn', title: 'Play / pause (Space)', onclick: () => { togglePlay(); } }, Icon('play', 14)), tc,
      el('div', { class: 'spacer' }),
      el('button', { class: 'ibtn', onclick: async e => { e.target.disabled = true; toast('Measuring loudness…'); try { const r = await analyze(); toast(r ? `Integrated ${r.lufs.toFixed(1)} LUFS · true peak ${r.truePeak.toFixed(1)} dBTP` : 'No audio on the timeline'); } finally { render(); } } }, Icon('graph', 14), 'Measure loudness'),
      el('select', { id: 'lufsT' }, [['-14', '−14 LUFS (YouTube, Spotify)'], ['-16', '−16 LUFS (Apple, podcasts)'], ['-23', '−23 LUFS (EBU R128 broadcast)'], ['-24', '−24 LUFS (ATSC A/85)']].map(([v, t]) => el('option', { value: v }, t))),
      el('button', { class: 'ibtn primary', onclick: async () => { const t = +document.getElementById('lufsT').value; toast('Normalizing…'); const r = await normalize(t); toast(r ? `Master ${r.gain > 0 ? '+' : ''}${r.gain} dB → ${r.after.lufs.toFixed(1)} LUFS` : 'No audio on the timeline'); render(); } }, 'Normalize'),
      el('button', { class: 'ibtn', onclick: duckDialog }, Icon('music', 14), 'Auto-duck music'));
    const strips = el('div', { class: 'strips' }, list.length ? list.map(stripUI) : el('div', { class: 'empty' }, 'No clips with sound on the timeline yet. Import video or audio in Edit, or record a voice-over.'), masterUI());
    R.append(bar, strips, el('div', { class: 'dim foot' }, 'EQ, pan, compressor, volume and master settings apply to playback and to MP4 export. Double-click a control to reset it. Loudness follows ITU-R BS.1770-4 / EBU R128 (exact K-weighting and gating); true peak uses 4× oversampling. Reverb sends go to one shared room on the master bus.'));
    S.tc = tc;
  }
  function duckDialog() {
    const list = sounding(); if (list.length < 2) return toast('Add a music clip and at least one voice clip first.');
    const o = { music: (list.find(l => l.type === 'audio') || list[0]).id, amount: -12, threshold: -38 }, voice = new Set(list.filter(l => l.id !== o.music).map(l => l.id));
    const body = el('div', { style: 'min-width:420px' },
      el('div', { class: 'frow' }, el('label', {}, 'Music clip'), el('select', { onchange: e => o.music = e.target.value }, list.map(l => el('option', { value: l.id, selected: l.id === o.music ? '' : undefined }, l.name)))),
      el('div', { class: 'k', style: 'margin:8px 0 4px' }, 'Voice clips (music dips while these speak)'),
      ...list.map(l => el('label', { class: 'chk', style: 'display:block' }, el('input', { type: 'checkbox', checked: voice.has(l.id) ? '' : undefined, onchange: e => e.target.checked ? voice.add(l.id) : voice.delete(l.id) }), l.name)),
      field('Duck by (dB)', o, 'amount', 'num', { min: -40, max: -1, step: 1 }), field('Voice threshold (dBFS)', o, 'threshold', 'num', { min: -70, max: -10, step: 1 }),
      el('div', { class: 'dim' }, 'Writes volume keyframes on the music clip (replacing existing volume keyframes). Undo restores them.'));
    showModal('Auto-duck music under voice', body, [['Cancel', closeModal], ['Duck', async () => { closeModal(); const lay = sounding(), mus = lay.find(l => l.id === o.music), vs = lay.filter(l => voice.has(l.id) && l.id !== o.music); if (!mus || !vs.length) return toast('Pick a music clip and at least one voice clip.'); toast('Analyzing voice…'); const n = await duck(mus, vs, { amount: +o.amount, threshold: +o.threshold }); toast(n ? `Ducked music in ${n} place(s)` : 'No speech found above the threshold'); render(); }, true]]);
  }
  /* meters: peak level from each strip's analyser, ~30 fps while the mixer is visible */
  const buf = new Float32Array(2048);
  function level(an) { if (!an) return -Infinity; an.getFloatTimeDomainData(buf.subarray(0, an.fftSize)); let p = 0; for (let i = 0; i < an.fftSize; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; } return toDB(p); }
  function drawMeter(c, d) { const x = c.getContext('2d'), H = c.height, f = clamp((d + 60) / 66, 0, 1); x.clearRect(0, 0, c.width, H); x.fillStyle = '#16161e'; x.fillRect(0, 0, c.width, H); const g = x.createLinearGradient(0, H, 0, 0); g.addColorStop(0, '#3b9bff'); g.addColorStop(.75, '#5cb8ff'); g.addColorStop(.9, '#ffb020'); g.addColorStop(1, '#ff4d6d'); x.fillStyle = g; x.fillRect(0, H * (1 - f), c.width, H * f); x.fillStyle = '#ffffff22'; for (const m of [0, -6, -12, -24, -48]) x.fillRect(0, H * (1 - (m + 60) / 66), c.width, 1); }
  function loop() {
    cancelAnimationFrame(S.raf);
    const step = () => {
      if (!S.root || S.root.closest('.hidden')) { S.raf = 0; return; }
      S.root.querySelectorAll('canvas[data-meter]').forEach(c => { const id = c.dataset.meter, an = id === 'master' ? live && live.meter : (meters.get(id) || {}).meter; drawMeter(c, playing ? level(an) : -Infinity); });
      if (S.tc) S.tc.textContent = tcFmt(T);
      S.raf = requestAnimationFrame(step);
    };
    S.raf = requestAnimationFrame(step);
  }
  return { S, liveBus: () => live, conf, master, attach, update, offlineGraph, measure, analyze, normalize, duck, envelope, enter, render, focus, sounding };
})();
