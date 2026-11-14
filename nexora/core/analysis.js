'use strict';
/* ====================== NEXORA media analysis (local, no network) ======================
   Signal-processing tools shared by Gaming and AI modes. All times returned are TIMELINE seconds for the given
   layer (they account for the clip's start, source in-point and speed).
     beats(L)          onset envelope (log-energy flux, 10 ms hop) → tempo by autocorrelation (60–180 BPM) → beat grid
     loudMoments(L,n)  the n loudest 1-second moments (short-term RMS), for highlight reels
     silences(L,o)     spans quieter than o.threshold dBFS for at least o.minDur
     removeSilences    splits the clip around silences and ripples later clips left
     scenes(L,o)       hard cuts from colour-histogram differences of sampled frames */
const Analysis = (() => {
  const cache = new Map();
  async function decode(m) {
    if (cache.has(m.id)) return cache.get(m.id);
    const ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await m.blob.arrayBuffer());
    const n = ab.length, d = new Float32Array(n); for (let c = 0; c < ab.numberOfChannels; c++) { const s = ab.getChannelData(c); for (let i = 0; i < n; i++) d[i] += s[i] / ab.numberOfChannels; }
    const r = { data: d, sr: ab.sampleRate }; cache.set(m.id, r); if (cache.size > 6) cache.delete(cache.keys().next().value); return r;
  }
  /** per-window RMS (dBFS) over the part of the source the clip actually uses; returns [{t (timeline), db}] */
  async function envelope(L, win) {
    const m = media[L.media]; if (!m || !m.blob) throw new Error('This clip has no audio data'); const { data, sr } = await decode(m), out = [];
    for (let lt = 0; lt < L.dur - 1e-6; lt += win) { const s0 = Math.floor((L.srcIn + lt * L.speed) * sr), s1 = Math.min(data.length, s0 + Math.max(1, Math.floor(win * L.speed * sr))); let a = 0; for (let i = Math.max(0, s0); i < s1; i++) a += data[i] * data[i]; const rms = Math.sqrt(a / Math.max(1, s1 - s0)); out.push({ t: L.start + lt, db: rms > 0 ? 20 * Math.log10(rms) : -120 }); }
    return out;
  }

  /* ---------- beats / tempo ---------- */
  async function beats(L) {
    const m = media[L.media]; const { data, sr } = await decode(m), hop = Math.round(sr * .01), n = Math.floor(data.length / hop), le = new Float32Array(n);
    for (let i = 0; i < n; i++) { let a = 0; for (let j = i * hop, e = Math.min(data.length, j + hop * 2); j < e; j++) a += data[j] * data[j]; le[i] = Math.log10(a + 1e-9); }
    const o = new Float32Array(n); for (let i = 1; i < n; i++) o[i] = Math.max(0, le[i] - le[i - 1]);
    const i0 = Math.floor(L.srcIn * 100), i1 = Math.min(n, Math.ceil((L.srcIn + L.dur * L.speed) * 100)), seg = o.subarray(i0, i1);
    // ±1 frame tolerance: real beat periods are rarely a whole number of 10 ms frames (90 BPM = 66.7 frames), so an exact
    // lag match would miss most hits and let an accidental integer multiple (e.g. 1.5 beats = 100 frames) win
    const sm = new Float32Array(seg.length); for (let i = 0; i < seg.length; i++) sm[i] = Math.max(seg[i - 1] || 0, seg[i], seg[i + 1] || 0);
    const ac = l => { let s = 0; for (let i = 0; i + l < seg.length; i++) s += seg[i] * sm[i + l]; return s; };
    let best = 0, lag = 50;
    for (let l = Math.round(6000 / 180); l <= Math.round(6000 / 60); l++) { const s = ac(l) * (1 - .08 * Math.abs(Math.log2(6000 / l / 120))); if (s > best) { best = s; lag = l; } }
    // tempo-octave check: patterns that repeat every 2 beats (kick on 1 and 3) make the half tempo win; if the
    // half-length period is also strongly periodic and still a plausible tempo, the real beat is the faster one
    // (rule used by perceptual tempo estimators: below 80 BPM, prefer the double tempo when it is a clear periodic peak)
    let base = 0, nb = 0; for (let l = Math.round(6000 / 180); l <= Math.round(6000 / 60); l++) { base += ac(l); nb++; } base /= nb;
    while (6000 / lag < 80) { const h = Math.round(lag / 2), a = ac(h); if (6000 / h > 160 || a < 2 * base || a < Math.max(ac(h - 2), ac(h + 2))) break; lag = h; }   /* peak test over ±2: the tolerant measure turns peaks into small plateaus */
    // refine period (0.02-frame steps around the winning lag) and phase together: the beat grid that collects the most onset energy
    let period = lag, ph = 0, pbest = -1;
    for (let p = lag - 1.5; p <= lag + 1.5; p += .02) for (let f = 0; f < p; f++) { let s = 0; for (let k = f; k < seg.length; k += p) s += seg[Math.round(k)] || 0; if (s > pbest)   /* exact onsets here: the fine grid already absorbs fractional periods */ { pbest = s; period = p; ph = f; } }
    const out = []; for (let k = ph; k < seg.length; k += period) { const lt = k / 100 / L.speed; if (lt < L.dur) out.push(+(L.start + lt).toFixed(3)); }
    return { bpm: +(6000 / period * L.speed).toFixed(1), beats: out };
  }
  /* ---------- highlights ---------- */
  async function loudMoments(L, count) {
    const env = await envelope(L, .25), win = 4, sc = [];                            // 1 s sliding average
    for (let i = 0; i + win <= env.length; i++) { let a = 0; for (let j = i; j < i + win; j++) a += Math.pow(10, env[j].db / 10); sc.push({ t: env[i].t, db: 10 * Math.log10(a / win) }); }
    sc.sort((a, b) => b.db - a.db); const out = [];
    for (const s of sc) { if (out.length >= (count || 5)) break; if (out.every(o => Math.abs(o.t - s.t) > 3)) out.push(s); }
    return out.sort((a, b) => a.t - b.t).map(s => ({ t: +s.t.toFixed(2), db: +s.db.toFixed(1) }));
  }
  /* ---------- silence ---------- */
  async function silences(L, o) {
    o = Object.assign({ threshold: -40, minDur: .5, pad: .08 }, o || {}); const step = .02, env = await envelope(L, step), spans = []; let s = null;
    for (const p of env) { if (p.db < o.threshold) { if (s == null) s = p.t; } else if (s != null) { spans.push([s, p.t]); s = null; } }
    if (s != null) spans.push([s, L.start + L.dur]);
    return spans.filter(([a, b]) => b - a >= o.minDur).map(([a, b]) => [+(a === L.start ? a : a + o.pad).toFixed(3), +(b >= L.start + L.dur - 1e-6 ? b : b - o.pad).toFixed(3)]).filter(([a, b]) => b > a);
  }
  /** cut the silent spans out of a clip; later clips move left by the time removed (ripple). Returns seconds removed. */
  async function removeSilences(L, o) {
    const sp = await silences(L, o); if (!sp.length) return { removed: 0, cuts: 0 };
    const end0 = L.start + L.dur, keep = []; let cur = L.start;
    for (const [a, b] of sp) { if (a > cur + .04) keep.push([cur, a]); cur = b; } if (end0 > cur + .04) keep.push([cur, end0]);
    const list = P.layers, i = list.indexOf(L), parts = []; let at = L.start;
    for (const [a, b] of keep) { const C = cloneLayer(L); C.srcIn = L.srcIn + (a - L.start) * L.speed; C.start = at; C.dur = b - a; for (const k in C.kf) C.kf[k] = C.kf[k].map(f => Object.assign({}, f, { t: f.t - (a - L.start) })); if (parts.length) C.tin = { type: 'none', dur: .6 }; if (keep.length > 1 && parts.length < keep.length - 1) C.tout = { type: 'none', dur: .6 }; parts.push(C); at += b - a; }
    const removed = +(L.dur - (at - L.start)).toFixed(3);
    list.splice(i, 1, ...parts);
    for (const X of list) if (!parts.includes(X) && X.start >= end0 - 1e-6) X.start = +(X.start - removed).toFixed(3);   // ripple
    selId = parts[0] ? parts[0].id : null; P.dur = Math.max(1, Math.ceil(Math.max(...list.map(l => l.start + l.dur)))); structChanged(); commit();
    return { removed, cuts: sp.length, parts: parts.length };
  }
  /* ---------- scene cuts ---------- */
  async function scenes(L, o) {
    o = Object.assign({ step: .1, threshold: .3 }, o || {}); const m = media[L.media]; if (!m || m.kind !== 'video') throw new Error('Pick a video clip');
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; if (corsUrl(m.url)) v.crossOrigin = 'anonymous'; v.src = m.url; await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('cannot decode')); });
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d', { willReadFrequently: true }), cuts = []; let prev = null;
    try {
      for (let lt = 0; lt < L.dur; lt += o.step) {
        v.currentTime = Math.min(m.dur - .001, L.srcIn + lt * L.speed); await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
        x.drawImage(v, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data, h = new Float32Array(48);
        for (let i = 0; i < d.length; i += 4) { h[d[i] >> 4]++; h[16 + (d[i + 1] >> 4)]++; h[32 + (d[i + 2] >> 4)]++; }
        if (prev) { let diff = 0; for (let k = 0; k < 48; k++) diff += Math.abs(h[k] - prev[k]); diff /= 64 * 36 * 6; if (diff > o.threshold && (!cuts.length || L.start + lt - cuts[cuts.length - 1] > .3)) cuts.push(+(L.start + lt).toFixed(3)); }
        prev = h; if (o.onProgress) o.onProgress(lt / L.dur);
      }
    } finally { v.removeAttribute('src'); v.load(); }
    return cuts;
  }
  /** split a clip at the given timeline times (left to right); returns the pieces */
  function splitAtTimes(L, times) { const parts = [L]; let cur = L; for (const t of times.slice().sort((a, b) => a - b)) { const B = splitLayer(cur, t); if (B) { parts.push(B); cur = B; } } commit(); structChanged(); return parts; }
  function addMarkers(times) { P.markers = P.markers || []; for (const t of times) if (!P.markers.some(m => Math.abs(m - t) < .02)) P.markers.push(frameQ(t)); P.markers.sort((a, b) => a - b); commit(); renderTimeline(); }
  return { decode, envelope, beats, loudMoments, silences, removeSilences, scenes, splitAtTimes, addMarkers };
})();
