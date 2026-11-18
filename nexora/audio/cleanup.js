'use strict';
/* ====================== NEXORA voice cleanup ======================
   Removes steady background noise (hiss, hum, fans, room tone) from speech, on this computer:
     1. spectral noise reduction: a short-time Fourier transform (2048-point Hann, 75 % overlap) learns the noise
        from the quietest tenth of the clip, then turns each frequency down where it is not clearly above that noise
        (smoothed over time and frequency so it does not "warble"); Amount sets how far
     2. a high-pass filter (default 80 Hz) for rumble and handling noise
   The result is written as a new WAV file next to the project's media and the clip switches to it (a video clip
   keeps its picture and gets the clean sound as its own clip). The original file is not changed; Undo, or
   "Restore original sound", switches back. */
const Cleanup = (() => {
  function fft(re, im, inv) {
    const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) { const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr; re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  /** denoise one channel. o: { amount 0…1 (default .7) } → new Float32Array */
  function process(x, sr, o = {}) {
    const N = 2048, H = N / 4, amt = clamp(o.amount == null ? .7 : o.amount, 0, 1), over = 1 + amt * 1.5, floor = Math.pow(10, -(6 + amt * 24) / 20);
    const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
    const nf = Math.max(1, Math.ceil((x.length + N) / H)), half = N / 2 + 1, mags = new Float32Array(nf * half), en = new Float32Array(nf), re = new Float64Array(N), im = new Float64Array(N);
    const frame = f => { const s = f * H - N; for (let i = 0; i < N; i++) { const j = s + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[i] = 0; } fft(re, im); };
    for (let f = 0; f < nf; f++) { frame(f); let e = 0; for (let k = 0; k < half; k++) { const m = Math.hypot(re[k], im[k]); mags[f * half + k] = m; e += m * m; } en[f] = e; }
    // noise profile: per-bin mean over the quietest 10 % of frames (at least 4)
    const order = [...en.keys()].sort((a, b) => en[a] - en[b]), q = order.slice(0, Math.max(4, Math.floor(nf * .1))), noise = new Float32Array(half);
    for (const f of q) for (let k = 0; k < half; k++) noise[k] += mags[f * half + k] / q.length;
    const out = new Float32Array(x.length), norm = new Float32Array(x.length + 2 * N), prev = new Float32Array(half).fill(1), g = new Float32Array(half);
    for (let f = 0; f < nf; f++) {
      frame(f);
      for (let k = 0; k < half; k++) { const m = mags[f * half + k], raw = m > 0 ? Math.max(floor, 1 - over * noise[k] / m) : floor; g[k] = raw > prev[k] ? raw * .7 + prev[k] * .3 : raw * .25 + prev[k] * .75; }   // quick to open, slow to close
      for (let k = 0; k < half; k++) { const s = (g[Math.max(0, k - 1)] + 2 * g[k] + g[Math.min(half - 1, k + 1)]) / 4; prev[k] = g[k]; re[k] *= s; im[k] *= s; if (k > 0 && k < N / 2) { re[N - k] *= s; im[N - k] *= s; } }
      fft(re, im, true); const s0 = f * H - N; for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < x.length) { out[j] += re[i] * win[i]; norm[j] += win[i] * win[i]; } }
    }
    for (let i = 0; i < x.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0; return out;
  }
  async function highpass(buf, hz) {
    const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hz; f.Q.value = .707;
    s.buffer = buf; s.connect(f); f.connect(ctx.destination); s.start(); return ctx.startRendering();
  }
  /** clean the sound of clip L. o: { amount, hp (Hz, 0 = off) } → the clip that now plays the clean sound */
  async function clean(L, o = {}, pm) {
    const m = media[L.media]; if (!m || !m.blob || (L.type !== 'audio' && L.type !== 'video')) throw new Error('Select a video or audio clip with sound.');
    pm && pm.set('Decoding the sound…', 5);
    const ab = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await m.blob.arrayBuffer()), sr = ab.sampleRate;
    const a = Math.max(0, Math.floor((L.srcIn - .25) * sr)), b = Math.min(ab.length, Math.ceil((L.srcIn + L.dur * L.speed + .25) * sr)), n = Math.max(1, b - a);
    const outBuf = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: sr });
    for (let c = 0; c < 2; c++) { pm && pm.set(`Removing noise (channel ${c + 1} of 2)…`, 15 + c * 35); await new Promise(r => setTimeout(r, 0)); const src = ab.getChannelData(Math.min(c, ab.numberOfChannels - 1)).subarray(a, b); outBuf.copyToChannel(process(src, sr, o), c); }
    pm && pm.set('Filtering rumble…', 88); const fin = (o.hp ?? 80) > 0 ? await highpass(outBuf, o.hp ?? 80) : outBuf;
    const f = new File([Music.wav16(fin)], (m.name || 'sound').replace(/\.[^.]+$/, '') + ' (clean).wav', { type: 'audio/wav' }), nm = await importFile(f); if (!nm) throw new Error('Could not add the clean sound to the project.');
    const srcIn = L.srcIn - a / sr; let target = L;
    if (L.type === 'audio') { L.cleanOf = L.cleanOf || { media: L.media, srcIn: L.srcIn }; L.media = nm.id; L.srcIn = +srcIn.toFixed(5); }
    else { target = mkLayer('audio', { name: L.name + ' (clean voice)', media: nm.id, start: L.start, dur: L.dur, srcIn: +srcIn.toFixed(5), speed: L.speed }); target.vol = L.vol; if (L.kf.vol) target.kf.vol = JSON.parse(JSON.stringify(L.kf.vol)); target.audio = JSON.parse(JSON.stringify(L.audio || AudioMix.conf(L)));
      target.cleanOf = { video: L.id }; L.muted = true; P.layers.splice(P.layers.indexOf(L), 0, target); }
    selId = target.id; commit(); structChanged(); if (typeof uiMedia === 'function') uiMedia(); return target;
  }
  function restore(L) {
    if (!L || !L.cleanOf) return false;
    if (L.cleanOf.video) { const V = P.layers.find(x => x.id === L.cleanOf.video); if (V) V.muted = false; removeLayer(L.id); selId = V ? V.id : null; }
    else { L.media = L.cleanOf.media; L.srcIn = L.cleanOf.srcIn; delete L.cleanOf; }
    commit(); structChanged(); toast('Original sound restored'); return true;
  }
  function dialog(L) {
    const o = { amount: 70, hp: 80 };
    showModal('Clean up voice · ' + L.name, el('div', {}, el('div', { class: 'dim' }, 'Removes steady background noise (hiss, hum, fans, room tone) and low rumble. Works best when the clip has a few quiet moments between words. Your original file is kept.'),
      field('Amount (%)', o, 'amount', 'num', { min: 0, max: 100, step: 5 }), field('High-pass (Hz)', o, 'hp', 'num', { min: 0, max: 300, step: 10 })),
      [['Cancel', closeModal], ['Clean up', async () => { closeModal(); const pm = progressModal('Clean up voice'); try { await clean(L, { amount: o.amount / 100, hp: o.hp }, pm); toast('Clean sound ready. Undo or "Restore original sound" switches back.'); } catch (e) { toast('Clean up failed: ' + (e.message || e)); } finally { closeModal(); } }, true]]);
  }
  return { fft, process, clean, restore, dialog };
})();
