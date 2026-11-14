'use strict';
/* ====================== NEXORA render cache ("Render In to Out", like preview files in Premiere / Resolve) ======================
   Heavy effect stacks can take longer than one frame to render live. Rendering a range pre-computes the program in
   4-second segments, encoded with the GPU's H.264 encoder at a high bitrate (WebCodecs, ≈ visually lossless). During
   normal forward playback a valid segment's frames are decoded (WebCodecs, a few frames ahead) instead of being rendered
   live, so it plays at full frame rate however heavy the effects are. Paused frames, scrubbing, reverse/fast shuttle and export are always
   rendered live and exactly — the cache is for preview only.
   Each segment's signature covers the layers that overlap it (plus project settings, the media they use, Motion /
   VFX / LUT data), so an edit only invalidates the segments it touches. Rendered segments show as a green bar on the
   ruler. Enter renders In–Out (or the whole timeline), Ctrl+K has "Render" and "Delete render files". */
const RenderCache = (() => {
  const SEG = 4, segs = new Map();            // index → { sig, url, a, b, v (video element), bytes }
  const S = { on: true, playing: null, bytes: 0, extSig: '', extAt: -1 };
  const hash = s => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36) + ':' + s.length; };
  const idxOf = t => Math.floor(t / SEG + 1e-9);
  function extSig() {
    // Motion compositions, VFX graphs and LUTs live outside P.layers; recomputed at most once per history state
    const k = hist.i + ':' + hist.stack.length; if (S.extAt === k) return S.extSig;
    let s = ''; try { if (typeof Motion !== 'undefined') s += ser(Motion.toJSON()); if (typeof VFX !== 'undefined') s += ser(VFX.toJSON()); if (typeof LUT !== 'undefined') s += Object.keys(LUT.store()).join(','); } catch (e) { s += Math.random(); }
    S.extAt = k; return (S.extSig = hash(s));
  }
  function sigOf(i) {
    const a = i * SEG, b = Math.min(P.dur, a + SEG), proj = projectState();
    const ls = proj.layers.filter(L => L.start < b && L.start + L.dur > a);
    const med = [...new Set(ls.map(L => L.media).filter(Boolean))].map(id => { const m = media[id]; return m ? [id, m.url, m.w, m.h, m.missing ? 1 : 0] : [id]; });
    const paint = ls.filter(L => L.type === 'paint').map(L => L._ver);
    return hash(ser({ w: P.w, h: P.h, fps: P.fps, bg: P.bg, a, b, ls, med, paint, gpu: typeof GPU !== 'undefined' && GPU.S.enabled, ext: extSig() }));
  }
  const valid = i => { const s = segs.get(i); return !!(s && s.sig === sigOf(i)); };
  function drop(i) { const s = segs.get(i); if (!s) return; closePlayer(s); S.bytes -= s.bytes; segs.delete(i); }
  function clear() { for (const i of [...segs.keys()]) drop(i); S.playing = null; uiMark(); }

  /** render [from, to) into cached segments; returns the number of segments rendered */
  async function render(from, to, opts = {}) {
    if (!(window.VideoEncoder && window.VideoDecoder)) { toast('Render cache needs WebCodecs (Chrome / Edge / desktop app).'); return 0; }
    exitAllComps(); pause(); from = clamp(from || 0, 0, P.dur); to = clamp(to == null ? P.dur : to, from, P.dur);
    const W = P.w & ~1, H = P.h & ~1, fps = P.fps, cfg = await pickCodec('avc', W, H, Math.min(80, Math.max(20, W * H * fps / 1.25e6)), fps);
    if (!cfg) { toast('No H.264 encoder available for the render cache.'); return 0; }
    const todo = []; for (let i = idxOf(from); i * SEG < to - 1e-6; i++) if (opts.force || !valid(i)) todo.push(i);
    if (!todo.length) { if (!opts.quiet) toast('Already rendered — plays in real time.'); return 0; }
    let cancel = false; const pm = opts.quiet ? { set() { } } : progressModal('Rendering preview', () => cancel = true), savedT = T, N0 = todo.reduce((n, i) => n + Math.round((Math.min(P.dur, (i + 1) * SEG) - i * SEG) * fps), 0); let done = 0;
    offlineBusy = true; const t0 = performance.now();
    try {
      for (const i of todo) {
        if (cancel) break; const a = i * SEG, b = Math.min(P.dur, a + SEG), n = Math.max(1, Math.round((b - a) * fps)), sig = sigOf(i);
        // the encoded chunks are kept as they are (no container): playback decodes them with WebCodecs, frame-exact
        const chunks = []; let dcfg = null, bytes = 0;
        let err = null; const enc = new VideoEncoder({ output: (c, m) => { if (m && m.decoderConfig && !dcfg) dcfg = m.decoderConfig; const data = new Uint8Array(c.byteLength); c.copyTo(data); bytes += data.length; chunks.push({ type: c.type, timestamp: c.timestamp, duration: c.duration, data }); }, error: e => err = e }); enc.configure(cfg);
        for (let f = 0; f < n && !cancel; f++) {
          if (err) throw err; const t = a + f / fps; T = t;
          await Promise.all(collectMedia(P.layers, t, []).filter(x => x.L.type === 'video').map(x => { const e = getEl(x.L); if (!e) return null; if (!e.paused) e.pause(); return seekEl(e, x.L.srcIn + (x.t - x.L.start) * x.L.speed); }));
          if (typeof VFX !== 'undefined') await VFX.prepareLayers(P.layers, t);
          renderComp(vctx, t);
          const vf = new VideoFrame(view, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps), visibleRect: { x: 0, y: 0, width: W, height: H } });
          enc.encode(vf, { keyFrame: f % Math.round(fps) === 0 }); vf.close(); while (enc.encodeQueueSize > 8) await sleep(1);
          if (++done % 4 === 0) { const el = (performance.now() - t0) / 1000; pm.set(`Rendering ${tcFmt(t)} · frame ${done} / ${N0}` + (done > 8 ? ` · ${Math.ceil(el / done * (N0 - done))} s left` : ''), done / N0 * 100); await sleep(0); }
        }
        if (cancel) { enc.close(); break; }
        await enc.flush(); enc.close(); if (err) throw err; if (!dcfg) throw new Error('encoder gave no decoder configuration');
        chunks.sort((x, y) => x.timestamp - y.timestamp);
        drop(i); segs.set(i, { sig, chunks, cfg: dcfg, fps, a, b, n, bytes, pl: null }); S.bytes += bytes;
      }
      return todo.length;
    } catch (e) { toast('Render failed: ' + (e.message || e)); console.error(e); return 0; }
    finally { offlineBusy = false; T = savedT; requestRender(); if (!opts.quiet) closeModal(); uiMark(); }
  }
  function renderIO() { const io = P.io || {}; const a = io.in != null ? io.in : 0, b = io.out != null ? io.out : P.dur; return render(a, b > a ? b : P.dur); }

  /* ---------- playback: decode the cached chunks a few frames ahead and draw the exact frame ---------- */
  function closePlayer(s) { const pl = s && s.pl; if (!pl) return; try { if (pl.dec.state !== 'closed') pl.dec.close(); } catch (e) { } pl.frames.forEach(f => f.close()); pl.frames.clear(); s.pl = null; }
  /** make sure frame f of segment s is (being) decoded, with up to 8 frames of look-ahead */
  function feed(s, f) {
    let pl = s.pl;
    if (pl && (f < pl.base || f > pl.fed + 24 || pl.dec.state === 'closed')) { closePlayer(s); pl = null; }
    if (!pl) {
      let key = 0; for (let k = Math.min(f, s.chunks.length - 1); k >= 0; k--) if (s.chunks[k].type === 'key') { key = k; break; }
      const frames = new Map(); pl = s.pl = { frames, base: key, fed: key - 1, cur: f, dec: null };
      pl.dec = new VideoDecoder({ output: fr => { const k = Math.round(fr.timestamp * s.fps / 1e6); if (k < pl.cur - 1 || frames.has(k)) fr.close(); else frames.set(k, fr); }, error: e => { why.decErr = String(e); } });
      pl.dec.configure(s.cfg);
    }
    pl.cur = f;
    for (const [k, fr] of pl.frames) if (k < f) { fr.close(); pl.frames.delete(k); }            // frames already shown
    while (pl.fed < Math.min(s.chunks.length - 1, f + 8) && pl.dec.decodeQueueSize < 8) { const c = s.chunks[++pl.fed]; pl.dec.decode(new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, duration: c.duration, data: c.data })); }
    return pl;
  }
  /** called from renderComp (wrapped below); returns true when the frame was drawn from the cache */
  const why = S.why = {}, no = k => { why[k] = (why[k] || 0) + 1; return false; };
  function tryDraw(ctx, t) {
    if (ctx === vctx && playing && !offlineBusy) why.calls = (why.calls || 0) + 1;
    if (!S.on || !playing || playRate !== 1 || offlineBusy || exporting || ctx !== vctx || compStack.length) { stopPlaying(); return false; }
    const i = idxOf(t), s = segs.get(i);
    // validity is checked once per segment and again after any edit (slider drags call requestRender before they commit)
    const hk = hist.i + ':' + hist.stack.length + ':' + renderReqs;
    if (!s) { stopPlaying(); return no('noseg'); }
    if (!(S.playing && S.playing.i === i && S.playing.hk === hk ? S.playing.ok : checkStart(i, hk))) { stopPlaying(); return no('stale'); }
    const f = Math.min(s.n - 1, Math.max(0, Math.floor((t - s.a) * s.fps + 1e-6))), pl = feed(s, f), fr = pl.frames.get(f);
    // pre-roll the next segment so the hand-over is seamless
    const nx = segs.get(i + 1); if (nx && t - s.a > SEG - .6 && !nx.pl && valid(i + 1)) feed(nx, 0);
    if (!fr) return no('decoding');                                          // not decoded yet: this frame renders live
    if (view.width !== P.w || view.height !== P.h) { view.width = P.w; view.height = P.h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(fr, 0, 0, P.w, P.h); ctx.globalCompositeOperation = 'source-over';
    S.hits = (S.hits || 0) + 1; return true;
  }
  function checkStart(i, hk) { if (S.playing && S.playing.i !== i) { const o = segs.get(S.playing.i); if (o) closePlayer(o); } const ok = valid(i); S.playing = { i, ok, hk }; if (!ok) drop(i); return ok; }
  function stopPlaying() { if (S.playing) { for (const s of segs.values()) closePlayer(s); S.playing = null; } }
  const _render = window.renderComp;
  window.renderComp = function (ctx, t) { if (tryDraw(ctx, t)) { if (typeof Scopes !== 'undefined' && Scopes.S && Scopes.S.on) Scopes.update(false); return; } return _render.apply(this, arguments); };

  /* ---------- ruler bar ---------- */
  function marks(pps) {
    const out = []; for (const [i, s] of segs) { const ok = valid(i); if (!ok) { drop(i); continue; } out.push(el('div', { class: 'rcache', style: `left:${s.a * pps}px;width:${Math.max(1, (s.b - s.a) * pps)}px`, title: `Rendered ${tcFmt(s.a)} – ${tcFmt(s.b)} · plays in real time` })); }
    return out;
  }
  function uiMark() { if (typeof renderTimeline === 'function') try { renderTimeline(); } catch (e) { } }
  const commands = () => [
    { title: 'Render: Render In to Out (Enter) — real-time preview of heavy effects', run: renderIO },
    { title: 'Render: Render entire timeline', run: () => render(0, P.dur) },
    { title: `Render: Delete render files (${segs.size} segment(s), ${(S.bytes / 1048576).toFixed(0)} MB)`, run: () => { clear(); toast('Render files deleted'); } },
    { title: `Render: ${S.on ? 'Stop using' : 'Use'} render files during playback`, run: () => { S.on = !S.on; toast('Render files ' + (S.on ? 'used' : 'ignored') + ' during playback'); } }];
  window.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (typeof Shell !== 'undefined' && Shell.active !== 'edit') return; const tg = e.target;
    if (tg.matches && tg.matches('input,textarea,select,button,[contenteditable]')) return; if (document.querySelector('#modal:not(.hidden)')) return;
    e.preventDefault(); e.stopImmediatePropagation(); renderIO();
  }, true);
  return { S, SEG, segs, render, renderIO, clear, valid, sigOf, marks, commands };
})();
