'use strict';
/* ====================== NEXORA multicam ======================
   Stack the camera angles at the playhead into one multicam clip, lined up by their sound (onset envelopes, 10 ms
   steps, cross-correlated within ±maxLag seconds) or by where they already sit. The clip is a composition whose
   angles all keep playing; L.mc.cuts says which angle is on screen from each time on, and only the angle chosen in
   L.mc.audio is heard. While the playhead is on a multicam clip, keys 1–9 cut to that angle (live while playing).
   Flatten turns the cuts into ordinary trimmed clips. */
const Multicam = (() => {
  const HOP = .01;
  /** onset envelope of a whole media file: positive log-energy flux per 10 ms */
  async function onsets(m) {
    const ab = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(await m.blob.arrayBuffer()), sr = ab.sampleRate, hop = Math.round(sr * HOP), n = Math.floor(ab.length / hop);
    const d = new Float32Array(ab.length); for (let c = 0; c < ab.numberOfChannels; c++) { const s = ab.getChannelData(c); for (let i = 0; i < s.length; i++) d[i] += s[i]; }
    const le = new Float32Array(n); for (let i = 0; i < n; i++) { let a = 0; for (let j = i * hop, e = j + hop; j < e; j++) a += d[j] * d[j]; le[i] = Math.log10(a + 1e-9); }
    const o = new Float32Array(n); for (let i = 1; i < n; i++) o[i] = Math.max(0, le[i] - le[i - 1]); return o;
  }
  /** lag (seconds) that best lines b up with a: b's sound at source time s + lag matches a's at s */
  function bestLag(a, b, maxLag = 60) {
    const L = Math.round(maxLag / HOP), n = Math.min(a.length, Math.round(120 / HOP)); let best = -Infinity, at = 0;
    const norm = x => { let m = 0; for (const v of x) m += v; m /= x.length || 1; return x.map(v => v - m); }, A = norm(a.subarray(0, n)), B = norm(b);
    for (let k = -L; k <= L; k++) { let s = 0, c = 0; for (let i = Math.max(0, -k), e = Math.min(n, B.length - k); i < e; i++) { s += A[i] * B[i + k]; c++; } if (c > n * .25 && s > best) { best = s; at = k; } }
    return at * HOP;
  }
  const isMc = L => L && L.type === 'comp' && L.mc;
  const angles = L => compSource(L).layers.filter(x => x.type === 'video' || x.type === 'image');
  function angleAt(L, lt) { const cs = L.mc.cuts; let a = cs[0] ? cs[0].a : 0; for (const c of cs) { if (c.t <= lt + 1e-6) a = c.a; else break; } return a; }
  /** what the comp draws at comp time lt: the live angle plus anything that is not an angle (titles, adjustments) */
  function visible(L, lt) { const A = angles(L), on = A[angleAt(L, lt)] || A[0]; return compSource(L).layers.filter(x => !A.includes(x) || x === on); }
  /** build a multicam clip from video layers; o.sync = 'audio' | 'start' */
  async function create(layers, o = {}) {
    layers = layers.filter(x => x && x.type === 'video' && media[x.media]); if (layers.length < 2) { toast('Multicam needs two or more video clips stacked at the playhead.'); return null; }
    const ref = layers[0], pos = layers.map(x => x.start), lags = [];
    if ((o.sync || 'audio') === 'audio') {
      const env = []; for (const x of layers) { try { env.push(await onsets(media[x.media])); } catch (e) { env.push(null); } }
      for (let i = 0; i < layers.length; i++) { const x = layers[i]; if (!i || !env[0] || !env[i]) { lags.push(0); continue; } const lag = bestLag(env[0], env[i], o.maxLag || 60); lags.push(lag);
        // x's source at (ref source + lag) must play at the same moment as ref's source
        pos[i] = ref.start + (x.srcIn - ref.srcIn - lag) / (x.speed || 1); }
    }
    for (let i = 0; i < layers.length; i++) if (pos[i] < 0) { layers[i].srcIn += -pos[i] * (layers[i].speed || 1); layers[i].dur += pos[i]; pos[i] = 0; }
    const t0 = Math.min(...pos), t1 = Math.max(...layers.map((x, i) => pos[i] + x.dur)), at = Math.min(...layers.map(x => P.layers.indexOf(x)));
    const C = mkLayer('comp', { name: o.name || 'Multicam (' + layers.length + ' angles)', start: +t0.toFixed(4), dur: +(t1 - t0).toFixed(4) });
    C.comp = { layers: layers.map((x, i) => { x.start = +(pos[i] - t0).toFixed(4); x.parent = ''; x.muted = i !== 0; x.name = x.name.replace(/^Angle \d+ · /, ''); x.name = `Angle ${i + 1} · ${x.name}`; return x; }), dur: C.dur };
    C.mc = { cuts: [{ t: 0, a: 0 }], audio: 0, lags };
    P.layers = P.layers.filter(x => !layers.includes(x)); P.layers.splice(Math.min(at, P.layers.length), 0, C); selId = C.id; commit(); structChanged();
    toast(`Multicam: ${layers.length} angles` + (lags.some(Boolean) ? ', synced by sound (' + lags.slice(1).map(l => (l >= 0 ? '+' : '') + l.toFixed(2) + ' s').join(', ') + ')' : '') + '. Press 1–' + layers.length + ' to cut.'); return C;
  }
  function fromPlayhead(o) { const vs = P.layers.filter(x => x.type === 'video' && x.visible && T >= x.start && T < x.start + x.dur); return create(vs, o); }
  /** cut to angle a at timeline time t (default the playhead) */
  function cut(L, a, t = T) {
    if (!isMc(L)) return; const A = angles(L); if (a < 0 || a >= A.length) return; const lt = +(L.srcIn + (t - L.start) * L.speed).toFixed(4), cs = L.mc.cuts.filter(c => Math.abs(c.t - lt) > 1 / (P.fps || 30) / 2);
    cs.push({ t: Math.max(0, lt), a }); cs.sort((x, y) => x.t - y.t); L.mc.cuts = cs.filter((c, i) => !i || c.a !== cs[i - 1].a); if (!L.mc.cuts.length || L.mc.cuts[0].t > 0) L.mc.cuts.unshift({ t: 0, a: 0 });
    if (!playing) commit(); requestRender(); renderTimeline(); flash(`Angle ${a + 1}`);
  }
  function setAudio(L, a) { if (!isMc(L)) return; angles(L).forEach((x, i) => x.muted = i !== a); L.mc.audio = a; commit(); requestRender(); }
  /** replace the multicam clip by one trimmed clip per cut */
  function flatten(L) {
    if (!isMc(L)) return null; const A = angles(L), cs = L.mc.cuts, out = [], fr = 1 / (P.fps || 30), at = P.layers.indexOf(L);
    cs.forEach((c, i) => { const e = i + 1 < cs.length ? cs[i + 1].t : L.comp.dur, X = A[c.a]; if (!X) return; const s = Math.max(c.t, X.start), f = Math.min(e, X.start + X.dur); if (f - s < fr / 2) return;
      const K = cloneLayer(X); K.srcIn = X.srcIn + (s - X.start) * X.speed; K.start = +(L.start + (s - L.srcIn) / L.speed).toFixed(4); K.dur = +((f - s) / L.speed).toFixed(4); K.speed = X.speed * L.speed; K.muted = false; K.name = X.name.replace(/^Angle \d+ · /, '');
      for (const k in K.kf) K.kf[k] = K.kf[k].map(q => Object.assign({}, q, { t: q.t - (s - X.start) })); out.push(K); });
    const aud = A[L.mc.audio]; if (aud && cs.some(c => c.a !== L.mc.audio)) { out.forEach(K => K.muted = true); const S_ = mkLayer('audio', { name: aud.name.replace(/^Angle \d+ · /, '') + ' (sound)', media: aud.media, start: +(L.start + (aud.start - L.srcIn) / L.speed).toFixed(4), dur: +(aud.dur / L.speed).toFixed(4), srcIn: aud.srcIn, speed: aud.speed * L.speed }); S_.vol = aud.vol; out.push(S_); }
    P.layers.splice(at, 1, ...out); selId = out[0] ? out[0].id : null; commit(); structChanged(); toast(`Flattened into ${out.length} clips`); return out;
  }
  function flash(msg) { const e = document.getElementById('perfRead'); if (e) e.textContent = msg; }
  const under = () => { const s = P.layers.find(x => x.id === selId); if (isMc(s) && T >= s.start && T < s.start + s.dur) return s; return P.layers.find(x => isMc(x) && T >= x.start && T < x.start + x.dur); };
  window.addEventListener('keydown', e => {
    if (typeof Shell !== 'undefined' && Shell.active !== 'edit') return; const tg = e.target; if (tg.matches && tg.matches('input,textarea,select,[contenteditable]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return; const L = under(); if (!L) return; e.preventDefault(); e.stopPropagation(); cut(L, +e.key - 1);
  }, true);
  /** inspector section for a multicam clip */
  function panel(L) {
    const A = angles(L), cur = angleAt(L, L.srcIn + (T - L.start) * L.speed);
    return el('div', { class: 'mc-panel' }, el('div', { class: 'dim' }, `${A.length} angles · ${L.mc.cuts.length} cut(s). Press 1–${A.length} on the timeline to cut at the playhead, live while playing.`),
      el('div', { class: 'mc-angles' }, ...A.map((x, i) => el('button', { class: i === cur ? 'on' : '', title: x.name, onclick: () => { cut(L, i); buildInspector(); } }, el('b', {}, String(i + 1)), el('span', {}, x.name.replace(/^Angle \d+ · /, ''))))),
      el('div', { class: 'frow' }, el('label', {}, 'Sound from'), el('select', { onchange: e => setAudio(L, +e.target.value) }, ...A.map((x, i) => el('option', { value: i, selected: i === L.mc.audio ? '' : undefined }, 'Angle ' + (i + 1))))),
      el('div', { class: 'frow' }, el('button', { onclick: () => { L.mc.cuts = [{ t: 0, a: angleAt(L, 0) }]; commit(); requestRender(); buildInspector(); } }, 'Clear cuts'), el('button', { onclick: () => flatten(L) }, 'Flatten to clips')));
  }
  return { onsets, bestLag, create, fromPlayhead, cut, angleAt, visible, setAudio, flatten, panel, isMc };
})();
