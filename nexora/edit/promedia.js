'use strict';
/* ====================== NEXORA pro media: FFmpeg masters + optimized media (desktop app) ======================
   Uses window.nxff (electron/preload.js → electron/ffmpeg.js). In a plain browser nxff is absent and everything here
   reports "not available"; the WebCodecs MP4 export keeps working as before.
   Export: frames are rendered exactly like the MP4 export (every video element seeked to the frame, VFX graphs
   prepared, renderComp), read back as straight-alpha RGBA and streamed to FFmpeg; the audio mix is the same offline
   mix (EQ / pan / compressor / master) written as a 32-bit float WAV. */
const ProMedia = (() => {
  const ff = window.nxff || null;
  let info = null;
  async function probe() { if (!ff) return { available: false }; if (!info) { try { info = await ff.probe(); } catch (e) { info = { available: false, error: e.message }; } } return info; }
  const has = enc => !!(info && info.available && info.encoders.includes(enc));

  /* ---------- codec catalogue for the export dialog ---------- */
  // key → [label, ffmpeg codec key, encoder name, group]
  const LIST = {
    prores_proxy: ['Apple ProRes 422 Proxy', 'prores_ks', 'master'], prores_lt: ['Apple ProRes 422 LT', 'prores_ks', 'master'], prores_422: ['Apple ProRes 422', 'prores_ks', 'master'],
    prores_hq: ['Apple ProRes 422 HQ', 'prores_ks', 'master'], prores_4444: ['Apple ProRes 4444 (with alpha)', 'prores_ks', 'master'], prores_4444xq: ['Apple ProRes 4444 XQ (with alpha)', 'prores_ks', 'master'],
    dnxhr_lb: ['Avid DNxHR LB', 'dnxhd', 'master'], dnxhr_sq: ['Avid DNxHR SQ', 'dnxhd', 'master'], dnxhr_hq: ['Avid DNxHR HQ', 'dnxhd', 'master'], dnxhr_hqx: ['Avid DNxHR HQX (10-bit)', 'dnxhd', 'master'], dnxhr_444: ['Avid DNxHR 444 (10-bit)', 'dnxhd', 'master'],
    cineform: ['GoPro CineForm (10-bit)', 'cfhd', 'master'],
    x264: ['H.264 (x264)', 'libx264', 'mp4'], x265: ['HEVC (x265)', 'libx265', 'mp4'], x265_10: ['HEVC 10-bit (x265 Main10)', 'libx265', 'mp4'], vpx_vp9: ['VP9 (libvpx)', 'libvpx-vp9', 'mp4'], aom_av1: ['AV1 (libaom)', 'libaom-av1', 'mp4'],
    png_seq: ['PNG sequence (with alpha)', 'png', 'seq'], tiff_seq: ['TIFF sequence (Deflate, with alpha)', 'tiff', 'seq'],
    wav: ['WAV 24-bit 48 kHz', 'pcm_s24le', 'audio'], mp3: ['MP3 320 kbps', 'libmp3lame', 'audio'], flac: ['FLAC lossless', 'flac', 'audio'], aac: ['M4A (AAC 320 kbps)', 'aac', 'audio']
  };
  const SOFT = { avc: 'x264', hevc: 'x265', hevc10: 'x265_10', vp9: 'vpx_vp9', av1: 'aom_av1' };   // WebCodecs key → FFmpeg key
  const available = group => Object.keys(LIST).filter(k => LIST[k][2] === group && has(LIST[k][1]));
  const label = k => (LIST[k] || [k])[0];
  const alphaCodec = k => /4444|png|tiff/.test(k);

  /** 32-bit float stereo WAV of an AudioBuffer */
  function wav(buf) {
    const ch = Math.min(2, buf.numberOfChannels), n = buf.length, sr = buf.sampleRate, bytes = n * ch * 4, ab = new ArrayBuffer(44 + bytes), v = new DataView(ab);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 4, true); v.setUint16(32, ch * 4, true); v.setUint16(34, 32, true); s(36, 'data'); v.setUint32(40, bytes, true);
    const out = new Float32Array(ab, 44), d = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    for (let i = 0, j = 0; i < n; i++) for (let c = 0; c < ch; c++) out[j++] = d[c][i];
    return ab;
  }
  /** rough size of an export in bytes, for the disk-space check */
  const MASTER_MBPS = { prores_proxy: 45, prores_lt: 102, prores_422: 147, prores_hq: 220, prores_4444: 330, prores_4444xq: 500, dnxhr_lb: 45, dnxhr_sq: 145, dnxhr_hq: 220, dnxhr_hqx: 220, dnxhr_444: 440, cineform: 200 };
  function estimate(k, w, h, fps, secs, mbps) { const px = w * h / 2073600, f = fps / 30; if (LIST[k][2] === 'audio') return secs * 288000; if (k === 'png_seq') return secs * fps * px * 3e6; if (k === 'tiff_seq') return secs * fps * px * 5e6; const rate = MASTER_MBPS[k] ? MASTER_MBPS[k] * px * f : (mbps || 16); return secs * rate * 1e6 / 8; }
  const isAudio = k => LIST[k][2] === 'audio', extOf = k => isAudio(k) ? (k === 'aac' ? 'm4a' : k) : LIST[k][2] === 'master' ? 'mov' : 'mp4';
  async function pickOut(k, base) {
    const folder = typeof Disk !== 'undefined' && Disk.S.folder ? Disk.join(Disk.S.folder, 'Exports') : await nxfs.join(await nxfs.defaultRoot(), 'Exports');
    if (LIST[k][2] === 'seq') { const f = await nxfs.pickFolder({ title: 'Folder for the image sequence', defaultPath: folder }); return f ? await nxfs.join(f, base) : null; }
    const ext = extOf(k); return ff.saveDialog({ title: 'Export ' + label(k), defaultPath: await nxfs.join(folder, base + '.' + ext), filters: [{ name: label(k), extensions: [ext] }] });
  }

  /** o: { codec (LIST key), fps, from, to, audio, mbps, crf, out? (absolute path; asks when missing) } */
  async function exportPro(o) {
    await probe(); const k = o.codec; if (!LIST[k]) throw new Error('Unknown codec ' + k);
    if (!has(LIST[k][1])) throw new Error(label(k) + ' is not available (FFmpeg missing).');
    exitAllComps(); pause();
    const W = P.w & ~1, H = P.h & ~1, fps = +o.fps || P.fps, from = clamp(o.from || 0, 0, P.dur), to = clamp(o.to == null ? P.dur : o.to, from + 1 / fps, P.dur), N = Math.max(1, Math.round((to - from) * fps));
    const base = o.base || safeName() + (from > 0 || to < P.dur ? ` (${tcFmt(from).replace(/:/g, '.')}-${tcFmt(to).replace(/:/g, '.')})` : '');
    const out = o.out || await pickOut(k, base); if (!out) return null;
    if (alphaCodec(k) && P.bg !== 'transparent' && !o.quiet) toast('Tip: set the project background to Transparent to export an alpha channel.');
    let cancel = false, job = null; const savedT = T; offlineBusy = true;
    const pm = o.quiet ? { set(m, p) { if (o.onProgress) o.onProgress(m, p); } } : progressModal('Exporting ' + label(k), () => cancel = true); let finished = null;
    const t0 = performance.now();
    try {
      const need = estimate(k, o.outW || W, o.outH || H, fps, to - from, o.mbps), free = await nxfs.free(out); if (free && free < need * 1.1) throw new Error(`Not enough disk space: this needs about ${(need / 1073741824).toFixed(1)} GB and ${(free / 1073741824).toFixed(1)} GB is free.`);
      pm.set('Mixing audio…', 1); let mix = null;
      if (o.audio !== false || isAudio(k)) { try { mix = await mixAudio(P.dur); if (mix && (from > 0 || to < P.dur)) mix = sliceBuffer(mix, from, to); } catch (e) { mix = null; } }
      if (isAudio(k) && !mix) throw new Error('This timeline has no audio.');
      job = await ff.start({ codec: k, w: W, h: H, outW: o.outW, outH: o.outH, fps, mbps: o.mbps || 40, crf: o.crf, out, base }, mix ? wav(mix) : null);
      if (!isAudio(k)) {
        const inflight = [];
        for (let i = 0; i < N && !cancel; i++) {
          if (o.shouldCancel && o.shouldCancel()) { cancel = true; break; }
          const t = from + i / fps; T = t;
          await Promise.all(collectMedia(P.layers, t, []).filter(a => a.L.type === 'video').map(a => { const e = getEl(a.L); if (!e) return null; if (!e.paused) e.pause(); return seekEl(e, a.L.srcIn + (a.t - a.L.start) * a.L.speed); }));
          if (typeof VFX !== 'undefined') await VFX.prepareLayers(P.layers, t);
          renderComp(vctx, t);
          const px = vctx.getImageData(0, 0, W, H).data;   // straight (un-premultiplied) RGBA, as ProRes 4444 / PNG expect
          inflight.push(ff.frame(job.id, px)); if (inflight.length >= 3) await inflight.shift();
          if (i % 3 === 0) { const el = (performance.now() - t0) / 1000, eta = i ? el / i * (N - i) : 0; pm.set(`Frame ${i + 1} / ${N}` + (i > 6 ? ` · ${(i / el).toFixed(1)} fps · ${Math.ceil(eta)} s left` : ''), 2 + i / N * 94); await sleep(0); }
        }
        await Promise.all(inflight);
      }
      if (cancel) { await ff.cancel(job.id); job = null; return null; }
      pm.set('Finishing file…', 97); const r = await ff.finish(job.id); job = null;
      if (!o.quiet) toast(`Exported ${label(k)} · ${isAudio(k) ? 'audio' : N + ' frames'}${r.size ? ' · ' + (r.size / 1048576).toFixed(1) + ' MB' : ''}${mix || isAudio(k) ? '' : ' · no audio'} → ${Disk.base(r.out)}`, 6000);
      if (!o.quiet) finished = { ...r, frames: isAudio(k) ? 0 : N, secs: (performance.now() - t0) / 1000, label: label(k) };
      return { ...r, frames: N };
    } catch (e) { if (job) try { await ff.cancel(job.id); } catch (x) { } if (o.quiet) throw e; toast('Export failed: ' + (e.message || e)); console.error(e); return null; }
    finally { offlineBusy = false; T = savedT; requestRender(); if (!o.quiet) closeModal(); if (finished && typeof Persona !== 'undefined') Persona.exportDone(finished); }
  }

  /* ---------- optimized media ---------- */
  const canOptimize = m => !!(ff && m && (m.source || m.path) && !m._optimizing);
  async function optimize(m) {
    await probe(); if (!info.available) throw new Error('This file type needs FFmpeg, which is not available.');
    const src = m.source || m.path, dir = typeof Disk !== 'undefined' && Disk.S.folder ? Disk.join(Disk.S.folder, 'Media', 'Optimized') : await ff.cacheDir();
    const ext = m.kind === 'image' ? '.png' : m.kind === 'audio' ? '.flac' : '.mp4', out = await nxfs.join(dir, Disk.safe(Disk.base(src).replace(/\.[^.]+$/, '')) + '-' + m.id + ext);
    m._optimizing = true; let stop = null, cancelled = false;
    const pm = progressModal('Preparing ' + m.name, () => { cancelled = true; ff.cancelOptimize(out); });
    pm.set('This format cannot be played directly — creating an edit-friendly copy (H.264 / FLAC / PNG)…', 2);
    stop = ff.onProgress((o, p) => { if (o === out) pm.set(`Converting ${m.name}: ${Math.round(p * 100)} %`, 2 + p * 96); });
    try {
      const st = await nxfs.stat(out); if (!st.exists) await ff.optimize(src, out, m.kind);
      m.source = src; m.path = out; m.url = Disk.urlOf(out); m.blob = Disk.lazyBlob(m.url, (await nxfs.stat(out)).size);
    } finally { stop && stop(); m._optimizing = false; if (!cancelled) closeModal(); }
    return m;
  }
  return { estimate, extOf, probe, has, LIST, SOFT, available, label, alphaCodec, wav, exportPro, canOptimize, optimize, get on() { return !!ff; } };
})();
