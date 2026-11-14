'use strict';
/* ====================== NEXORA proxy media ======================
   A proxy is a small H.264 copy (short side 720 px, with the original audio) used only for timeline playback.
   Export, frame grabs and the exact-frame renderer always use the original file (getEl checks offlineBusy/exporting).
   Proxies are cached in IndexedDB ('nexora-proxies', keyed by media id + source size) so they survive restarts.
   Built with WebCodecs: the source plays muted at 2× and requestVideoFrameCallback hands every presented frame
   to a VideoEncoder; audio is decoded once and re-encoded (AAC, Opus fallback). */
const Proxies = (() => {
  const pref = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const S = { use: pref('nx.proxy.use') !== '0', auto: pref('nx.proxy.auto') !== '0', short: 720, autoAbove: 1920 * 1080, jobs: {}, queue: [] };
  let db = null;
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => { const r = indexedDB.open('nexora-proxies', 1); r.onupgradeneeded = () => r.result.createObjectStore('p', { keyPath: 'key' }); r.onsuccess = () => res(db = r.result); r.onerror = () => rej(r.error); });
  }
  const keyOf = m => m.id + '@' + m.w + 'x' + m.h + '@' + (m.blob ? m.blob.size : 0);
  async function idb(mode, fn) { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('p', mode), r = fn(t.objectStore('p')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); }

  const supported = () => !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer && HTMLVideoElement.prototype.requestVideoFrameCallback);
  const has = m => !!(m && m.proxyUrl);
  const needs = m => m && m.kind === 'video' && m.w * m.h > S.autoAbove * .99;
  function attach(m, blob, w, h) { if (m.proxyUrl) URL.revokeObjectURL(m.proxyUrl); m.proxyBlob = blob; m.proxyUrl = URL.createObjectURL(blob); m.proxyW = w; m.proxyH = h; dropEls(m); requestRender(); }
  // force timeline elements of this media to be recreated so playback switches source
  function dropEls(m) { for (const L of allLayers()) if (L.media === m.id) for (const k of [L.id, L.id + '#p']) { const e = els.get(k); if (e) { e.pause(); e.removeAttribute('src'); e.load(); els.delete(k); } } }
  function allLayers() { const out = []; const walk = ls => { for (const L of ls || []) { out.push(L); if (L.comp) walk(L.comp.layers); } }; walk(typeof Motion !== 'undefined' ? Motion.editProject().layers : P.layers); return out; }

  /* Colour calibration. Chromium decodes untagged/limited H.264 with a different YUV matrix depending on version and
     frame size (e.g. Chrome 14x: <720 lines → BT.601; Electron 33: ≥720 lines → shifted). Rather than guess, encode a
     3-frame test clip at each candidate short side, decode it, and keep the first size whose colours round-trip (±3). */
  async function calibrate() {
    const ck = 'nx.proxy.short@' + (navigator.userAgent.match(/Chrome\/[\d.]+/) || ['?'])[0];
    const cached = +pref(ck); if (cached) return cached;
    const probe = [[126, 234, 10], [200, 40, 160]];
    for (const s of [720, 540, 576, 1080]) {
      const W = Math.round(s * 16 / 9 / 2) * 2, H = s;
      try {
        const cfg = { codec: 'avc1.640028', width: W, height: H, bitrate: 4e6, framerate: 30, avc: { format: 'avc' } }; if (!(await VideoEncoder.isConfigSupported(cfg)).supported) continue;
        const mux = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' }); const enc = new VideoEncoder({ output: (c, md) => mux.addVideoChunk(c, md), error: () => { } }); enc.configure(cfg);
        const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
        for (let i = 0; i < 6; i++) { const p = probe[i < 3 ? 0 : 1]; x.fillStyle = `rgb(${p})`; x.fillRect(0, 0, W, H); const f = new VideoFrame(c, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i === 0 }); f.close(); }
        await enc.flush(); mux.finalize();
        const url = URL.createObjectURL(new Blob([mux.target.buffer], { type: 'video/mp4' })), v = document.createElement('video'); v.muted = true; v.src = url;
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = j; });
        const cc = document.createElement('canvas'); cc.width = cc.height = 4; const xx = cc.getContext('2d', { willReadFrequently: true }); let worst = 0;
        for (const [t, p] of [[.05, probe[0]], [.15, probe[1]]]) { v.currentTime = t; await new Promise(r => { v.onseeked = r; setTimeout(r, 2000); }); xx.drawImage(v, 0, 0, 4, 4); const d = xx.getImageData(1, 1, 1, 1).data; worst = Math.max(worst, ...p.map((q, k) => Math.abs(q - d[k]))); }
        v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url);
        if (worst <= 3) { try { localStorage.setItem(ck, s); } catch (e) { } S.colorExact = true; return s; }
      } catch (e) { }
    }
    S.colorExact = false; return 720;                                       // nothing round-trips exactly: proxies still work, colours approximate
  }

  async function make(m, onProgress) {
    if (!m || m.kind !== 'video') throw new Error('Proxies are for video clips');
    if (!supported()) throw new Error('This browser has no WebCodecs video encoder');
    if (S.jobs[m.id]) return S.jobs[m.id];
    const job = (async () => {
      // short side from calibration (720 or 540 depending on how this runtime decodes colour)
      const short = S.short = await calibrate(), sc = Math.min(1, short / Math.max(1, Math.min(m.w, m.h))), w = Math.max(2, Math.round(m.w * sc / 2) * 2), h = Math.max(2, Math.round(m.h * sc / 2) * 2);
      let vcfg = null;
      for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.640033']) { const c = { codec, width: w, height: h, bitrate: 4e6, framerate: 30, avc: { format: 'avc' } }; try { if ((await VideoEncoder.isConfigSupported(c)).supported) { vcfg = c; break; } } catch (e) { } }
      if (!vcfg) throw new Error('No H.264 encoder for ' + w + '×' + h);
      let ab = null, acodec = null;
      try { if (m.blob && m.blob.size < 600e6) ab = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await m.blob.arrayBuffer()); } catch (e) { ab = null; }
      if (ab) for (const c of ['mp4a.40.2', 'opus']) { try { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported) { acodec = c; break; } } catch (e) { } }
      if (!acodec) ab = null;
      const mux = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h }, audio: ab ? { codec: acodec === 'opus' ? 'opus' : 'aac', numberOfChannels: 2, sampleRate: 48000 } : undefined, fastStart: 'in-memory' });
      let err = null; const enc = new VideoEncoder({ output: (c, md) => mux.addVideoChunk(c, md), error: e => err = e }); enc.configure(vcfg);
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; if (corsUrl(m.url)) v.crossOrigin = 'anonymous'; v.src = m.url;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('Cannot decode source video')); });
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d');
      // exact frame grid: seek to every 1/30 s and wait for the decoded frame (works in hidden windows, unlike
      // play-based capture, and every proxy frame lines up with the original's timeline position)
      const PFPS = 30, total = Math.max(1, Math.floor((m.dur || 0) * PFPS + 1e-6) + 1); let n = 0;   // +1: browsers often report duration without the last frame
      const seekTo = t => new Promise(res => { if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res(); const k = () => { v.removeEventListener('seeked', k); res(); }; v.addEventListener('seeked', k); v.currentTime = t; setTimeout(k, 4000); });
      for (let i = 0; i < total; i++) {
        if (S.cancel === m.id) { S.cancel = null; enc.close(); throw new Error('cancelled'); }
        await seekTo(Math.min((i + .5) / PFPS, Math.max(0, m.dur - 1e-3)));   // frame centre: a boundary seek can land on the previous frame
        x.drawImage(v, 0, 0, w, h); const f = new VideoFrame(cv, { timestamp: Math.round(i / PFPS * 1e6), duration: Math.round(1e6 / PFPS) });
        enc.encode(f, { keyFrame: i % PFPS === 0 }); f.close(); n++;
        if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
        if (onProgress && i % 10 === 0) onProgress(Math.min(.95, i / total));
      }
      v.removeAttribute('src'); v.load();
      await enc.flush(); enc.close();
      if (ab) {
        const aenc = new AudioEncoder({ output: (c, md) => mux.addAudioChunk(c, md), error: e => err = e }); aenc.configure({ codec: acodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
        const ch0 = ab.getChannelData(0), ch1 = ab.numberOfChannels > 1 ? ab.getChannelData(1) : ch0;
        for (let s = 0; s < ab.length; s += 4800) { const k = Math.min(4800, ab.length - s), b = new Float32Array(k * 2); b.set(ch0.subarray(s, s + k), 0); b.set(ch1.subarray(s, s + k), k); const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round(s / 48000 * 1e6), data: b }); aenc.encode(ad); ad.close(); }
        await aenc.flush(); aenc.close();
      }
      if (err) throw err; mux.finalize();
      const blob = new Blob([mux.target.buffer], { type: 'video/mp4' });
      attach(m, blob, w, h); m.proxyAudio = !!ab; m.proxyFrames = n;
      try { await idb('readwrite', s => s.put({ key: keyOf(m), blob, w, h, audio: !!ab, frames: n, made: Date.now() })); } catch (e) { }
      if (onProgress) onProgress(1);
      return m;
    })();
    S.jobs[m.id] = job;
    try { return await job; } finally { delete S.jobs[m.id]; }
  }
  async function restore(m) {
    if (!m || m.kind !== 'video' || m.proxyUrl) return false;
    try { const r = await idb('readonly', s => s.get(keyOf(m))); if (r && r.blob) { attach(m, r.blob, r.w, r.h); m.proxyAudio = r.audio; return true; } } catch (e) { }
    return false;
  }
  async function restoreAll() { let n = 0; for (const id in media) if (await restore(media[id])) n++; return n; }
  async function remove(m) { if (!m) return; dropEls(m); if (m.proxyUrl) URL.revokeObjectURL(m.proxyUrl); delete m.proxyUrl; delete m.proxyBlob; try { await idb('readwrite', s => s.delete(keyOf(m))); } catch (e) { } requestRender(); }
  /** queue proxies one at a time, with progress in the status line */
  function queue(list) {
    for (const m of list) if (m && m.kind === 'video' && !m.proxyUrl && !S.queue.includes(m)) S.queue.push(m);
    if (S.running) return; S.running = true;
    (async () => {
      while (S.queue.length) {
        const m = S.queue.shift();
        try { await make(m, p => status(`Proxy: ${m.name} ${Math.round(p * 100)}%`)); status(`Proxy ready: ${m.name}`); }
        catch (e) { status(''); if (typeof toast === 'function') toast('Proxy failed for ' + m.name + ': ' + (e.message || e)); }
      }
      S.running = false; if (typeof uiMedia === 'function') uiMedia();
    })();
  }
  function status(t) { if (typeof Shell !== 'undefined' && Shell.status) Shell.status(t); }
  /** should playback use the proxy for this media right now? Never while exporting / rendering exact frames. */
  const active = m => S.use && has(m) && !offlineBusy && !exporting;
  function setUse(v) { S.use = !!v; try { localStorage.setItem('nx.proxy.use', v ? '1' : '0'); } catch (e) { } requestRender(); }
  function setAuto(v) { S.auto = !!v; try { localStorage.setItem('nx.proxy.auto', v ? '1' : '0'); } catch (e) { } }
  return { S, calibrate, make, restore, restoreAll, remove, queue, active, has, needs, supported, setUse, setAuto, keyOf };
})();
