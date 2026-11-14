'use strict';
/* ====================== NEXORA music ======================
   · Library: 1,000+ original tracks (funk, phonk, baile…) composed and synthesised on this computer from a seed when you
     preview or add them, so they take no disk space and carry no licence restrictions.
   · Free online: search of Creative Commons music through Openverse; the licence and credit travel with the clip.
   · My music: your own folders of MP3 / WAV / FLAC / M4A.
   · Clip tools: extract audio from video, fit music to the timeline, beat sync, voice ducking. */
const Music = (() => {
  const rngOf = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], minpent: [0, 3, 5, 7, 10], mixo: [0, 2, 4, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11] };
  const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  /* n: tracks in the catalogue. kick/snare: 16-step patterns. Everything else picks a synth voice. */
  const STYLES = {
    'Phonk': { n: 230, bpm: [128, 150], swing: 0, kicks: [[0, 6, 10], [0, 3, 8, 11], [0, 7, 10, 14]], snare: [4, 12], hat: 'roll', bass: '808', lead: 'cowbell', scale: ['phrygian', 'minor'], drive: 2.6, vinyl: .012, dark: true, moods: ['Dark', 'Aggressive', 'Menacing', 'Night'] },
    'Drift Phonk': { n: 230, bpm: [150, 178], swing: 0, kicks: [[0, 4, 8, 12], [0, 4, 7, 8, 12], [0, 3, 4, 8, 11, 12]], snare: [4, 12], hat: 'sixteen', bass: '808', lead: 'cowbell', scale: ['phrygian', 'minpent'], drive: 3.6, vinyl: .006, duck: .5, dark: true, moods: ['Aggressive', 'Hype', 'Fast', 'Dark'] },
    'Brazilian Phonk': { n: 120, bpm: [125, 135], swing: 0, kicks: [[0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14]], snare: [], hat: 'none', perc: 'tamborzao', bass: '808', lead: 'cowbell', scale: ['phrygian', 'minor'], drive: 3, vinyl: 0, dark: true, moods: ['Hype', 'Aggressive', 'Party'] },
    'Funk': { n: 200, bpm: [98, 118], swing: .12, kicks: [[0, 7, 10], [0, 3, 10], [0, 6, 8, 11]], snare: [4, 12], ghost: [7, 9, 15], hat: 'sixteen', bass: 'slap', lead: 'clav', stabs: true, scale: ['dorian', 'mixo'], drive: 1.2, moods: ['Groovy', 'Upbeat', 'Smooth', 'Confident'] },
    'Disco Funk': { n: 100, bpm: [112, 126], swing: .06, kicks: [[0, 4, 8, 12]], snare: [4, 12], hat: 'off', bass: 'octave', lead: 'clav', stabs: true, pad: true, scale: ['dorian', 'major'], drive: 1.1, duck: .75, moods: ['Upbeat', 'Party', 'Retro', 'Bright'] },
    'G-Funk': { n: 80, bpm: [86, 100], swing: .18, kicks: [[0, 7, 10], [0, 3, 7, 10]], snare: [4, 12], ghost: [15], hat: 'eight', bass: 'sine', lead: 'whine', pad: true, scale: ['minor', 'dorian'], drive: 1.2, vinyl: .004, moods: ['Smooth', 'Laid-back', 'Sunset', 'Groovy'] },
    'Baile Funk': { n: 100, bpm: [128, 132], swing: 0, kicks: [[0, 3, 6, 10, 12]], snare: [], hat: 'none', perc: 'tamborzao', bass: 'sub', lead: 'stab', scale: ['minor', 'minpent'], drive: 1.8, moods: ['Party', 'Hype', 'Street'] },
    'Trap': { n: 40, bpm: [130, 150], swing: 0, kicks: [[0, 7, 10], [0, 6, 11]], snare: [8], hat: 'roll', bass: '808', lead: 'pluck', pad: true, halftime: true, scale: ['minor', 'phrygian'], drive: 1.7, moods: ['Dark', 'Confident', 'Night'] },
    'House': { n: 40, bpm: [120, 128], swing: 0, kicks: [[0, 4, 8, 12]], snare: [4, 12], hat: 'off', bass: 'octave', lead: 'pluck', pad: true, scale: ['minor', 'dorian'], drive: 1.2, duck: .55, moods: ['Upbeat', 'Bright', 'Party'] },
    'Lo-fi': { n: 40, bpm: [70, 88], swing: .2, kicks: [[0, 7, 10], [0, 10]], snare: [4, 12], hat: 'eight', bass: 'sine', lead: 'pluck', pad: true, scale: ['dorian', 'major'], drive: 1.1, vinyl: .018, lofi: true, moods: ['Chill', 'Warm', 'Calm'] },
    'Synthwave': { n: 40, bpm: [96, 116], swing: 0, kicks: [[0, 8], [0, 4, 8, 12]], snare: [4, 12], hat: 'eight', bass: 'octave', lead: 'saw', pad: true, scale: ['minor'], drive: 1.2, moods: ['Retro', 'Night', 'Driving'] },
    'Cinematic': { n: 40, bpm: [70, 96], swing: 0, kicks: [[0, 10]], snare: [], hat: 'none', perc: 'taiko', bass: 'sine', lead: 'saw', pad: true, scale: ['minor', 'phrygian'], drive: 1.1, moods: ['Epic', 'Tense', 'Dramatic'] },
    'Montagem': { n: 150, bpm: [126, 134], swing: 0, kicks: [[0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14], [0, 4, 6, 10, 13]], snare: [], hat: 'none', perc: 'tamborzao', bass: '808', lead: 'vox', scale: ['phrygian', 'minor'], drive: 4.6, vinyl: 0, dark: true, moods: ['Hype', 'Aggressive', 'Menacing', 'Party'] },
    'Slowed Phonk': { n: 100, bpm: [92, 112], swing: 0, kicks: [[0, 6, 10], [0, 7, 10, 14]], snare: [4, 12], hat: 'roll', bass: '808', lead: 'cowbell', scale: ['phrygian', 'minor'], drive: 2.4, vinyl: .016, dark: true, verb: .42, moods: ['Dark', 'Night', 'Melancholic', 'Menacing'] },
    'Epic Orchestral': { n: 80, bpm: [76, 100], swing: 0, kicks: [[0, 10], [0, 6, 10]], snare: [], hat: 'none', perc: 'taiko', bass: 'sine', lead: 'horn', pad: true, scale: ['minor', 'phrygian'], drive: 1.1, verb: .34, moods: ['Epic', 'Dramatic', 'Tense', 'Heroic'] }
  };
  const ADJ = ['Midnight', 'Crimson', 'Velvet', 'Hollow', 'Neon', 'Static', 'Burning', 'Silent', 'Chrome', 'Phantom', 'Golden', 'Broken', 'Electric', 'Shadow', 'Frozen', 'Savage', 'Lunar', 'Rusted', 'Black', 'Wicked', 'Liquid', 'Solar', 'Ghost', 'Iron', 'Smooth', 'Heavy', 'Distant', 'Violent', 'Sapphire', 'Cold', 'Sunset', 'Concrete', 'Obsidian', 'Fading', 'Rapid', 'Twisted', 'Royal', 'Dusty', 'Infinite', 'Red'];
  const NOUN = ['Drift', 'Avenue', 'Engine', 'Horizon', 'Mirage', 'Empire', 'Pulse', 'Vendetta', 'Boulevard', 'Serpent', 'Reaper', 'Motion', 'Voltage', 'Requiem', 'Skyline', 'Cartel', 'District', 'Fever', 'Protocol', 'Throttle', 'Paradox', 'Mercury', 'Tunnel', 'Riot', 'Groove', 'Sermon', 'Circuit', 'Altitude', 'Omen', 'Getaway', 'Harbor', 'Nomad', 'Rhythm', 'Asphalt', 'Blade', 'Monarch', 'Overdrive', 'Dynasty', 'Vapor', 'Signal'];
  const CATALOG = [], BYID = {};
  { const used = new Set(); let g = 0;
    for (const genre of Object.keys(STYLES)) { const st = STYLES[genre]; g++;
      for (let i = 0; i < st.n; i++) {
        const seed = g * 100003 + i * 7919, r = rngOf(seed); let title; do { title = ADJ[Math.floor(r() * ADJ.length)] + ' ' + NOUN[Math.floor(r() * NOUN.length)]; } while (used.has(title) && used.size < ADJ.length * NOUN.length * .9 && r() < .995); if (used.has(title)) title += ' ' + (i + 2); used.add(title);
        const t = { id: 'm' + g + '_' + i, genre, seed, title, bpm: Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0])), root: 33 + Math.floor(r() * 12), scale: st.scale[Math.floor(r() * st.scale.length)], mood: st.moods[Math.floor(r() * st.moods.length)], bars: 28 + Math.floor(r() * 6) * 8 };
        t.key = NOTE[t.root % 12] + 'm'; t.dur = t.bars * 240 / t.bpm; CATALOG.push(t); BYID[t.id] = t;
      } } }

  /* ---------- arrangement ---------- */
  function sections(t) {
    const S0 = [{ b: 4, lead: 1, pad: 1, vinyl: 1 }, { b: 8, kick: 1, snare: 1, hat: 1, perc: 1, bass: 1, lead: 1, pad: 1, stab: 0 }, { b: 8, kick: 1, snare: 1, hat: 1, perc: 1, bass: 1, lead: 2, pad: 1, stab: 1 }, { b: 4, hat: 1, lead: 1, pad: 1, perc: 0, riser: 1 }];
    const main = [{ b: 8, kick: 1, snare: 1, hat: 1, perc: 1, bass: 1, lead: 1, pad: 1, stab: 1 }, { b: 8, kick: 1, snare: 1, hat: 1, perc: 1, bass: 1, lead: 2, pad: 1, stab: 1 }, { b: 4, bass: 1, lead: 1, pad: 1 }];
    const out = S0.slice(); let used = 24, k = 0; while (used < t.bars - 4) { const s = main[k++ % main.length], b = Math.min(s.b, t.bars - 4 - used); out.push({ ...s, b }); used += b; } out.push({ b: 4, lead: 1, pad: 1, kick: 0, vinyl: 1, end: 1 }); return out;
  }
  /* ---------- synthesis: one bar at a time into an OfflineAudioContext ---------- */
  const m2f = m => 440 * Math.pow(2, (m - 69) / 12);
  async function render(t, o) {
    o = o || {}; const st = STYLES[t.genre], sr = 44100, secs = sections(t), stepD = 60 / t.bpm / 4, barD = stepD * 16, rnd = rngOf(t.seed + 11);
    let from = 0; if (o.preview) from = (secs[0].b) * barD;
    const len = o.preview ? Math.min(o.preview, t.dur - from) : t.bars * barD, ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
    const noise = ctx.createBuffer(1, sr * 2, sr), nd = noise.getChannelData(0), nr = rngOf(t.seed + 5); for (let i = 0; i < nd.length; i++) nd[i] = nr() * 2 - 1;
    const shaper = k => { const w = ctx.createWaveShaper(), c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } w.curve = c; w.oversample = '2x'; return w; };
    /* headroom first: the buses sum well below full scale, so the master only shapes peaks instead of flattening the whole song */
    const out = ctx.createGain(); out.gain.value = .5; const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .2; const mast = shaper(1.1); out.connect(comp); comp.connect(mast);
    let end = mast; if (st.lofi) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; mast.connect(lp); end = lp; } end.connect(ctx.destination);
    const drum = ctx.createGain(); drum.connect(out); const duckG = ctx.createGain(); duckG.connect(out); const bass = ctx.createGain(); bass.gain.value = .55; const bassD = shaper(1 + (st.drive - 1) * .45), bassOut = ctx.createGain(); bassOut.gain.value = .7; bass.connect(bassD); bassD.connect(bassOut); bassOut.connect(duckG);   /* saturated 808, not a square wave */
    const lead = ctx.createGain(); lead.gain.value = .35; const leadD = shaper(Math.max(1, 1 + (st.drive - 1) * .35)); lead.connect(leadD); if (st.dark) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; leadD.connect(lp); lp.connect(duckG); } else leadD.connect(duckG);
    const delay = ctx.createDelay(1), fb = ctx.createGain(), send = ctx.createGain(); delay.delayTime.value = stepD * 3; fb.gain.value = .32; send.gain.value = .22; leadD.connect(send); send.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(duckG);
    const padB = ctx.createGain(); padB.gain.value = .32; padB.connect(duckG);
    const nz = (t0, d) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(t0, nr() * 1.5, d + .05); return s; };
    /* every hit and note is rendered once into a small buffer, then replayed: far fewer live nodes, so a whole song renders in seconds */
    const SY = (cx, out_) => {
      const env = (p, t0, peak, d, a) => { p.setValueAtTime(.0001, t0); p.exponentialRampToValueAtTime(Math.max(.0001, peak), t0 + (a || .002)); p.exponentialRampToValueAtTime(.0001, t0 + d); }, nn = d => { const s = cx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(0, nr() * 1.5, d + .05); return s; }, osc = (ty, f) => { const o = cx.createOscillator(); o.type = ty; o.frequency.value = f; return o; }, flt = (ty, f, q) => { const l = cx.createBiquadFilter(); l.type = ty; l.frequency.value = f; if (q) l.Q.value = q; return l; }, gn = () => cx.createGain();
      return {
        kick() { const os = cx.createOscillator(), g = gn(); os.frequency.setValueAtTime(st.dark ? 190 : 150, 0); os.frequency.exponentialRampToValueAtTime(46, .09); env(g.gain, 0, 1, .28); os.connect(g); g.connect(out_); os.start(0); },
        snare() { const s = nn(.22), f = flt('bandpass', 2000, .7), g = gn(); env(g.gain, 0, .9, .19); s.connect(f); f.connect(g); g.connect(out_); const os = cx.createOscillator(), g2 = gn(); os.type = 'triangle'; os.frequency.setValueAtTime(220, 0); os.frequency.exponentialRampToValueAtTime(150, .1); env(g2.gain, 0, .55, .12); os.connect(g2); g2.connect(out_); os.start(0); },
        hat(open) { const d = open ? .24 : .05, s = nn(d), f = flt('highpass', 7600), g = gn(); env(g.gain, 0, .34, d); s.connect(f); f.connect(g); g.connect(out_); },
        tom(f0) { const os = cx.createOscillator(), g = gn(); os.frequency.setValueAtTime(f0 * 1.5, 0); os.frequency.exponentialRampToValueAtTime(f0, .05); env(g.gain, 0, 1, .2); os.connect(g); g.connect(out_); os.start(0); },
        taiko() { const os = cx.createOscillator(), g = gn(); os.frequency.setValueAtTime(93, 0); os.frequency.exponentialRampToValueAtTime(62, .05); env(g.gain, 0, 1, .22); os.connect(g); g.connect(out_); os.start(0); const s = nn(.3), f = flt('lowpass', 500), g2 = gn(); env(g2.gain, 0, .6, .26); s.connect(f); f.connect(g2); g2.connect(out_); },
        b808(d, m, glide) { const os = cx.createOscillator(), g = gn(), f = m2f(m); os.frequency.setValueAtTime(glide ? m2f(glide) : f, 0); if (glide) os.frequency.exponentialRampToValueAtTime(f, .07); g.gain.setValueAtTime(1, 0); g.gain.setValueAtTime(1, Math.max(.01, d - .08)); g.gain.exponentialRampToValueAtTime(.0001, d); os.connect(g); g.connect(out_); os.start(0); },
        slap(d, m) { const f = m2f(m); for (const [ty, a] of [['sawtooth', 1], ['square', .5]]) { const os = osc(ty, f), l = flt('lowpass', 2600, 7), g = gn(); l.frequency.setValueAtTime(2600, 0); l.frequency.exponentialRampToValueAtTime(240, .12); env(g.gain, 0, a * .55, Math.max(.09, d)); os.connect(l); l.connect(g); g.connect(out_); os.start(0); } },
        cowbell(m) { const f = m2f(m + 24), bp = flt('bandpass', f * 1.3, 1.4), g = gn(); env(g.gain, 0, 1, .2); for (const k of [1, 1.482]) { const os = osc('square', f * k); os.connect(bp); os.start(0); } bp.connect(g); g.connect(out_); },
        clav(m) { const os = osc('square', m2f(m + 24)), l = flt('bandpass', 3000, 3), g = gn(); l.frequency.setValueAtTime(3000, 0); l.frequency.exponentialRampToValueAtTime(600, .09); env(g.gain, 0, 1, .11); os.connect(l); l.connect(g); g.connect(out_); os.start(0); },
        vox(d, m) { const f = m2f(m + 12), os = osc('sawtooth', f), o2 = osc('square', f * 1.005), g = gn(); os.frequency.setValueAtTime(f, 0); os.frequency.linearRampToValueAtTime(f * .84, d); o2.frequency.linearRampToValueAtTime(f * .84, d); g.gain.setValueAtTime(.0001, 0); g.gain.linearRampToValueAtTime(1, .012); g.gain.setValueAtTime(1, Math.max(.02, d - .05)); g.gain.linearRampToValueAtTime(.0001, d); for (const [ff, q, a] of [[720, 9, 1], [1180, 11, .75], [2500, 12, .3]]) { const b = flt('bandpass', ff, q), h = gn(); h.gain.value = a * 2.4; os.connect(b); o2.connect(b); b.connect(h); h.connect(g); } g.connect(out_); os.start(0); o2.start(0); },
        pluck(m) { const os = osc('triangle', m2f(m + 24)), g = gn(); env(g.gain, 0, 1, .36); os.connect(g); g.connect(out_); os.start(0); },
        saw(d, m) { for (const det of [-7, 7]) { const os = osc('sawtooth', m2f(m + 24)), l = flt('lowpass', 3200), g = gn(); os.detune.value = det; g.gain.setValueAtTime(.0001, 0); g.gain.linearRampToValueAtTime(.6, .02); g.gain.setValueAtTime(.6, Math.max(.03, d - .05)); g.gain.linearRampToValueAtTime(.0001, d); os.connect(l); l.connect(g); g.connect(out_); os.start(0); } },
        whine(d, m, from_) { const f = m2f(m + 24), os = osc('sine', f), lfo = osc('sine', 5.5), lg = gn(), g = gn(); os.frequency.setValueAtTime(from_ ? m2f(from_ + 24) : f, 0); os.frequency.linearRampToValueAtTime(f, .1); lg.gain.value = f * .012; lfo.connect(lg); lg.connect(os.frequency); g.gain.setValueAtTime(.0001, 0); g.gain.linearRampToValueAtTime(1, .03); g.gain.setValueAtTime(1, Math.max(.04, d - .06)); g.gain.linearRampToValueAtTime(.0001, d); os.connect(g); g.connect(out_); os.start(0); lfo.start(0); },
        chord(d, notes, ty) { for (const m of notes) { const os = osc(ty || 'sawtooth', m2f(m)), l = flt('lowpass', ty ? 2600 : 1100), g = gn(); os.detune.value = (nr() - .5) * 12; g.gain.setValueAtTime(.0001, 0); g.gain.linearRampToValueAtTime(1, ty ? .01 : .25); g.gain.setValueAtTime(1, Math.max(.02, d - (ty ? .02 : .3))); g.gain.linearRampToValueAtTime(.0001, d); os.connect(l); l.connect(g); g.connect(out_); os.start(0); } }
      };
    };
    const LEN = { kick: () => .3, snare: () => .25, hat: a => a[0] ? .26 : .06, tom: () => .22, taiko: () => .32, b808: a => a[0] + .01, slap: a => Math.max(.09, a[0]) + .02, cowbell: () => .22, clav: () => .13, vox: a => a[0] + .01, pluck: () => .38, saw: a => a[0] + .01, whine: a => a[0] + .01, chord: a => a[0] + .01 };
    const events = [], BUS = { d: drum, b: bass, l: lead, p: padB }, rd = d => Math.round(d * 100) / 100, E = (name, bus, t0, gain, args) => events.push({ name, bus, t0, gain, args, key: name + JSON.stringify(args) });
    const V = {
      kick: (t0, v) => E('kick', 'd', t0, v, []), snare: (t0, v) => E('snare', 'd', t0, v, []), hat: (t0, v, o) => E('hat', 'd', t0, v, [!!o]), tom: (t0, f, v) => E('tom', 'd', t0, v, [f]), taiko: (t0, v) => E('taiko', 'd', t0, v, []),
      bass808: (t0, d, m, v, gl) => E('b808', 'b', t0, v, [rd(d), m, gl || 0]), slap: (t0, d, m, v) => E('slap', 'b', t0, v, [rd(d), m]), cowbell: (t0, m, v) => E('cowbell', 'l', t0, v, [m]), clav: (t0, m, v) => E('clav', 'l', t0, v, [m]), vox: (t0, d, m, v) => E('vox', 'l', t0, v, [rd(d), m]), pluck: (t0, m, v) => E('pluck', 'l', t0, v, [m]), saw: (t0, d, m, v) => E('saw', 'l', t0, v, [rd(d), m]), whine: (t0, d, m, v, f) => E('whine', 'l', t0, v, [rd(d), m, f || 0]), chord: (t0, d, n, v, ty) => E('chord', ty ? 'l' : 'p', t0, v, [rd(d), n, ty || ''])
    };
    const scale = SCALES[t.scale], degree = (d, oct) => { const n = scale.length, q = Math.floor(d / n), r_ = ((d % n) + n) % n; return t.root + scale[r_] + 12 * (q + (oct || 0)); };
    const prog = [[0, 0, 5, 4], [0, 3, 0, 4], [0, 5, 3, 4], [0, 2, 3, 1]][Math.floor(rnd() * 4)], kickP = st.kicks[Math.floor(rnd() * st.kicks.length)];
    /* a two-bar motif: rhythm and notes come from the seed, the second bar answers the first */
    const motifOf = (density, span) => { const m = []; for (let i = 0; i < 32; i++) if (i < 16 ? (i % 4 === 0 ? rnd() < .75 : rnd() < density) : false) m.push({ s: i, d: Math.floor(rnd() * span) }); const a = m.map(x => ({ s: x.s + 16, d: x.s > 11 ? x.d + (rnd() < .5 ? 2 : -1) : x.d })); return m.concat(a); };
    const LD = { cowbell: .5, clav: .45, whine: .3, pluck: .36, saw: .3, stab: .4, vox: .62, horn: .3 }, motif = motifOf(st.lead === 'whine' ? .1 : st.lead === 'cowbell' ? .38 : .3, 5), motifB = motifOf(.45, 7);
    const bassM = (() => { const o2 = []; for (let i = 0; i < 16; i++) { const k = kickP.includes(i); if (st.bass === 'slap') { if (k || rnd() < .34) o2.push({ s: i, oct: i % 4 === 2 && rnd() < .6 ? 1 : 0 }); } else if (st.bass === 'octave') { if (i % 2 === 0 || i % 4 === 3) o2.push({ s: i, oct: i % 4 === 2 ? 1 : 0 }); } else if (k) o2.push({ s: i, oct: 0 }); } return o2; })();
    const hatStep = (t0, s, bar, sw) => { if (st.hat === 'sixteen') V.hat(t0 + sw, s % 4 === 2 ? .85 : s % 2 ? .35 : .6); else if (st.hat === 'eight') { if (s % 2 === 0) V.hat(t0 + sw, s % 4 === 2 ? .8 : .5); } else if (st.hat === 'off') { if (s % 4 === 2) V.hat(t0 + sw, .8, true); else if (s % 2 === 0) V.hat(t0 + sw, .32); } else if (st.hat === 'roll') { if (s % 2 === 0) V.hat(t0, .55); if ((bar + 1) % 2 === 0 && s >= 12) { V.hat(t0 + stepD / 2, .4); } if (bar % 4 === 3 && s >= 8 && s < 12) for (let k = 1; k < 3; k++) V.hat(t0 + stepD * k / 3, .35); } };
    const tamb = [[0, 96, .9], [3, 150, .75], [6, 96, .85], [8, 220, .55], [10, 150, .8], [12, 96, .7], [14, 220, .6]];
    let barIdx = 0, tt = 0; const lim = len + .01;
    for (const sec of secs) for (let b = 0; b < sec.b; b++, barIdx++, tt += barD) {
      const barT = tt - from; if (barT + barD < 0 || barT > lim) continue;
      const root = prog[barIdx % 4], fill = b === sec.b - 1 && sec.b > 3;
      for (let s = 0; s < 16; s++) {
        const t0 = barT + s * stepD; if (t0 < 0 || t0 > lim) continue; const sw = s % 2 ? st.swing * stepD * 2 : 0;
        if (sec.kick && kickP.includes(s) && !(fill && s > 11)) V.kick(t0, .95);
        if (sec.snare) { if (st.snare.includes(s) && !st.halftime) V.snare(t0, .8); if (st.halftime && s === 8) V.snare(t0, .85); if (st.ghost && st.ghost.includes(s)) V.snare(t0 + sw, .16); if (fill && s >= 12 && st.snare.length) V.snare(t0 + sw, .32 + (s - 12) * .12); }
        if (sec.hat) hatStep(t0, s, barIdx, sw);
        if (sec.perc && st.perc === 'tamborzao') for (const [p, f, v] of tamb) if (p === s) V.tom(t0, f, v * .75);
        if (sec.perc && st.perc === 'taiko' && (s === 0 || s === 6 || s === 10)) V.taiko(t0, .85);
        if (sec.bass) for (const n of bassM) if (n.s === s) { const m_ = degree(root) + 12 * n.oct, next = bassM.find(x => x.s > s), gap = ((next ? next.s : 16) - s) * stepD; if (st.bass === '808') V.bass808(t0, Math.min(gap, .55), m_, .9, rnd() < .12 ? m_ + 5 : 0); else if (st.bass === 'slap') V.slap(t0 + sw, Math.min(gap, .14), m_ + 12, n.oct ? 1 : .8); else if (st.bass === 'octave') V.slap(t0, Math.min(gap, .14), m_ + 12, .7); else V.bass808(t0, Math.min(gap, st.bass === 'sub' ? .3 : .5), m_ + (st.bass === 'sine' ? 12 : 0), .7); }
        if (sec.lead) for (const n of (sec.lead === 2 ? motifB : motif)) if (n.s % 16 === s && (n.s < 16) === (barIdx % 2 === 0)) { const m_ = degree(n.d + (sec.lead === 2 ? 2 : 0), 0) + (st.lead === 'whine' ? 12 : 0), v = LD[st.lead]; if (st.lead === 'cowbell') V.cowbell(t0, m_, v); else if (st.lead === 'clav') V.clav(t0 + sw, m_, v); else if (st.lead === 'pluck') V.pluck(t0 + sw, m_, v); else if (st.lead === 'saw') V.saw(t0, stepD * 3, m_, v); else if (st.lead === 'whine') V.whine(t0, stepD * 6, m_, v, m_ - 2); else if (st.lead === 'vox') V.vox(t0, stepD * 1.6, m_, v); else if (st.lead === 'horn') V.chord(t0, stepD * 6, [m_ + 24, m_ + 31], .24); else if (st.lead === 'stab') V.chord(t0, stepD * 1.5, [m_ + 12, m_ + 15, m_ + 19], .16, 'square'); }
        if (st.stabs && sec.stab && (s === 2 || s === 11) && barIdx % 2 === 1) V.chord(t0 + sw, stepD * 1.6, [degree(root + 2, 2), degree(root + 4, 2), degree(root + 6, 2)], .13, 'sawtooth');
      }
      if (st.pad && sec.pad && barT >= 0) V.chord(barT, barD, [degree(root, 1), degree(root + 2, 1), degree(root + 4, 1)], .22);
      if (sec.riser && barT >= 0 && b === sec.b - 1) { const s_ = nz(barT, barD), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, barT); f.frequency.exponentialRampToValueAtTime(9000, barT + barD); g.gain.setValueAtTime(.001, barT); g.gain.exponentialRampToValueAtTime(.22, barT + barD); s_.connect(f); f.connect(g); g.connect(duckG); }
    }
    if (st.verb) { const n_ = Math.floor(2.6 * sr), ir = ctx.createBuffer(2, n_, sr); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n_; i++) d[i] = (nr() * 2 - 1) * Math.pow(1 - i / n_, 3.2); } const cv = ctx.createConvolver(), wet = ctx.createGain(); cv.buffer = ir; wet.gain.value = st.verb; duckG.connect(cv); cv.connect(wet); wet.connect(out); }
    if (st.vinyl) { const s_ = ctx.createBufferSource(); s_.buffer = noise; s_.loop = true; const f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 2400; g.gain.value = st.vinyl; s_.connect(f); f.connect(g); g.connect(out); s_.start(0); s_.stop(len); }
    const shots = new Map(); for (const e of events) if (!shots.has(e.key)) shots.set(e.key, e);
    const cache = new Map(); await Promise.all([...shots.values()].map(async e => { const oc = new OfflineAudioContext(1, Math.ceil(LEN[e.name](e.args) * sr), sr); SY(oc, oc.destination)[e.name](...e.args); cache.set(e.key, await oc.startRendering()); }));
    /* mix every hit straight into one buffer per bus; the buses then run through the mastering chain as four plain sources */
    const frames = Math.ceil(len * sr), mixes = { d: new Float32Array(frames), b: new Float32Array(frames), l: new Float32Array(frames), p: new Float32Array(frames) };
    for (const e of events) { if (e.t0 < 0 || e.t0 > lim) continue; const d = cache.get(e.key).getChannelData(0), o_ = Math.round(e.t0 * sr), m_ = mixes[e.bus], n_ = Math.min(d.length, frames - o_), v = e.gain; for (let i = 0; i < n_; i++) m_[o_ + i] += d[i] * v; if (e.name === 'kick' && st.duck) { duckG.gain.setValueAtTime(st.duck, e.t0); duckG.gain.linearRampToValueAtTime(1, e.t0 + stepD * 1.7); } }
    for (const k of Object.keys(mixes)) { const b_ = ctx.createBuffer(1, frames, sr); b_.copyToChannel(mixes[k], 0); const s_ = ctx.createBufferSource(); s_.buffer = b_; s_.connect(BUS[k]); s_.start(0); }
    return ctx.startRendering().then(buf => { let pk = 0; const n = buf.length, fade = Math.floor(Math.min(3, len / 8) * sr); for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) { if (i > n - fade) d[i] *= (n - i) / fade; const a = Math.abs(d[i]); if (a > pk) pk = a; } } /* every track lands at the same loudness (about -14 LUFS, what streaming platforms play at); a soft limiter catches the peaks */
      let ss = 0, cnt = 0; for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i += 4) { ss += d[i] * d[i]; cnt++; } } const rmsDb = 10 * Math.log10(ss / Math.max(1, cnt) + 1e-12), k = pk > 0 ? Math.pow(10, (-15 - rmsDb) / 20) : 1, Tq = .6, Cq = .89;
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) { const x = d[i] * k, a = Math.abs(x); d[i] = a <= Tq ? x : Math.sign(x) * (Tq + (Cq - Tq) * Math.tanh((a - Tq) / (Cq - Tq))); } } return buf; });
  }
  function wav16(buf) { const ch = 2, n = buf.length, sr = buf.sampleRate, bytes = n * ch * 2, ab = new ArrayBuffer(44 + bytes), v = new DataView(ab), s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }; s(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, bytes, true); const L = buf.getChannelData(0), R = buf.getChannelData(1), o = new Int16Array(ab, 44); for (let i = 0, j = 0; i < n; i++) { o[j++] = Math.max(-1, Math.min(1, L[i])) * 32767; o[j++] = Math.max(-1, Math.min(1, R[i])) * 32767; } return ab; }

  /* ---------- player (one sound at a time) ---------- */
  const Pl = { ac: null, src: null, el: null, id: null, onChange: null };
  function stop() { try { Pl.src && Pl.src.stop(); } catch (e) { } if (Pl.el) { Pl.el.pause(); Pl.el.removeAttribute('src'); Pl.el.load(); } Pl.src = null; Pl.el = null; Pl.id = null; Pl.onChange && Pl.onChange(); }
  const previews = new Map();
  async function preview(t) {
    if (Pl.id === t.id) return stop(); stop(); Pl.id = t.id; Pl.onChange && Pl.onChange();
    let b = previews.get(t.id); if (!b) { b = await render(t, { preview: 20 }); previews.set(t.id, b); if (previews.size > 12) previews.delete(previews.keys().next().value); }
    if (Pl.id !== t.id) return; Pl.ac = Pl.ac || new AudioContext(); if (Pl.ac.state === 'suspended') Pl.ac.resume(); const s = Pl.ac.createBufferSource(); s.buffer = b; s.connect(Pl.ac.destination); s.onended = () => { if (Pl.src === s) stop(); }; s.start(); Pl.src = s;
  }
  function previewUrl(id, url) { if (Pl.id === id) return stop(); stop(); Pl.id = id; const a = new Audio(url); Pl.el = a; a.onended = () => stop(); a.onerror = () => { stop(); toast('This preview cannot be played.'); }; a.play().catch(() => { }); Pl.onChange && Pl.onChange(); }

  /* ---------- placing music ---------- */
  function fit(L, o) {
    o = Object.assign({ fade: 2 }, o || {}); const room = P.dur - L.start; if (room > .1 && L.dur > room) L.dur = room; const f = Math.min(o.fade, L.dur / 3), base = L.vol; L.kf.vol = (L.kf.vol || []).filter(k => k.t < L.dur - f - .01); L.kf.vol.push({ t: +(L.dur - f).toFixed(3), v: base, e: 'linear' }, { t: +L.dur.toFixed(3), v: 0, e: 'linear' }); commit(); structChanged(); return L;
  }
  /** places audio; with fit, it is cut to the length the edit already had (an empty timeline simply takes the song's length) */
  function place(m, o) { const d0 = P.dur, hasEdit = P.layers.some(l => l.type !== 'audio'), L = addMediaLayer(m, o.start === undefined ? T : o.start); if (o.fit && hasEdit) { P.dur = d0; fit(L); } return L; }
  async function addTrack(t, o) {
    o = o || {}; const buf = await render(t), f = new File([wav16(buf)], `${t.title} (${t.genre}).wav`, { type: 'audio/wav' }), m = await importFile(f); if (!m) return null;
    const L = place(m, o); L.name = t.title; commit(); structChanged(); return L;
  }
  function credit(c) { P.credits = P.credits || []; if (!P.credits.some(x => x.url === c.url)) P.credits.push(c); commit(); }
  const creditLine = c => `"${c.title}" by ${c.creator} (${c.license}) ${c.url}`;

  /* ---------- extract audio from video ---------- */
  function detach(L) {
    if (!L || L.type !== 'video') throw new Error('Select a video clip first.');
    const A = mkLayer('audio', { name: L.name + ' (audio)', media: L.media, start: L.start, dur: L.dur, srcIn: L.srcIn, speed: L.speed }); A.vol = L.vol; if (L.kf.vol) A.kf.vol = JSON.parse(JSON.stringify(L.kf.vol)); L.muted = true; P.layers.splice(P.layers.indexOf(L), 0, A); selId = A.id; structChanged(); commit(); return A;
  }
  const AFMT = { mp3: 'MP3 (320 kbps)', wav: 'WAV (24-bit)', flac: 'FLAC (lossless)', aac: 'M4A (AAC)' };
  /** saves the clip's audio as its own file. o: { format, out?, addToProject? } */
  async function saveAudio(L, o) {
    if (!window.nxff) throw new Error('Saving audio files needs the desktop app.'); const m = media[L.media]; if (!m) throw new Error('This clip has no media.');
    const fmt = o.format || 'mp3', ext = fmt === 'aac' ? 'm4a' : fmt, base = L.name.replace(/\.[^.]+$/, '').replace(/ \(audio\)$/, '');
    const out = o.out || await nxff.saveDialog({ title: 'Save audio', defaultPath: await nxfs.join(await nxfs.join(Disk.S.folder || await nxfs.defaultRoot(), 'Exports'), Disk.safe(base) + '.' + ext), filters: [{ name: AFMT[fmt], extensions: [ext] }] }); if (!out) return null;
    let input = m.source || m.path, temp = null; if (!input) { temp = await nxfs.join(await nxff.cacheDir(), 'extract-' + m.id); await nxfs.writeBytes(temp, await m.blob.arrayBuffer()); input = temp; }
    try { const r = await nxff.extractAudio({ input, out, format: fmt, from: L.srcIn, dur: L.dur * L.speed, speed: L.speed }); if (o.addToProject) { const nm = await Disk.importPath(out); if (nm) media[nm.id] = nm; uiMedia(); r.media = nm; } return r; } finally { if (temp) nxfs.remove(temp); }
  }
  function extractDialog(L) {
    L = L || selLayer(); if (!L || L.type !== 'video') return toast('Select a video clip on the timeline first.');
    const o = { format: 'mp3' }; const save = window.nxff ? field('File format', o, 'format', 'select', { opts: Object.keys(AFMT), names: k => AFMT[k] }) : el('div', { class: 'dim' }, 'Saving a separate file needs the desktop app.');
    showModal('Extract audio', el('div', { style: 'min-width:360px' }, el('p', { class: 'dim', style: 'margin-top:0' }, `From "${L.name}", ${fmtDur(L.dur)}.`), save), [['Cancel', closeModal], ...(window.nxff ? [['Save as file…', async () => { closeModal(); try { const r = await saveAudio(L, o); if (r) { toast(`Saved ${Disk.base(r.out)}`); nxfs.reveal(r.out); } } catch (e) { toast(e.message); } }]] : []), ['Detach to timeline', () => { closeModal(); detach(L); toast('Audio is now its own clip. The video clip is muted.'); buildInspector(); }, true]]);
  }

  /* ---------- workflow ---------- */
  /** finds the beat, marks it, and cuts every video clip under the music on every n-th beat */
  async function beatSync(L, every) {
    if (!L || !media[L.media]) throw new Error('Select a music clip first.'); const r = await Analysis.beats(L), n = Math.max(1, every || 2), times = r.beats.filter((_, i) => i % n === n - 1); Analysis.addMarkers(r.beats); let cuts = 0;
    for (const v of P.layers.filter(x => x.type === 'video' && x.id !== L.id)) { const inside = times.filter(t => t > v.start + .05 && t < v.start + v.dur - .05); if (inside.length) { Analysis.splitAtTimes(v, inside); cuts += inside.length; } }
    commit(); structChanged(); return { bpm: r.bpm, beats: r.beats.length, cuts };
  }
  async function duckUnderVoice(L) { const voices = P.layers.filter(x => x.id !== L.id && (x.type === 'video' || x.type === 'audio') && !x.muted && media[x.media]); if (!voices.length) throw new Error('There is no other clip with sound to duck under.'); return AudioMix.duck(L, voices, {}); }

  /* ---------- online search (Creative Commons, through the main process) ---------- */
  const Web = { q: 'phonk', page: 1, rows: [], total: 0, busy: false, full: true, err: '' };
  async function addWeb(r, o) {
    o = o || {}; const d = await nxmusic.download(r.id); if (!d.ok) throw new Error(d.error); const f = new File([d.bytes], d.name, { type: d.mime }), m = await importFile(f); if (!m) throw new Error('This file could not be read.');
    const L = place(m, o); L.name = r.title; credit({ title: r.title, creator: r.creator, license: r.licenseName, url: r.page }); return L;
  }

  /* ---------- panel ---------- */
  const U = { tab: 'library', genre: 'All', q: '', mood: 'All', sort: 'name', fit: true, fav: new Set(), recent: [] };
  try { const j = JSON.parse(localStorage.getItem('nx.music') || '{}'); U.fav = new Set(j.fav || []); U.recent = j.recent || []; U.fit = j.fit !== false; } catch (e) { }
  const keep = () => { try { localStorage.setItem('nx.music', JSON.stringify({ fav: [...U.fav], recent: U.recent.slice(0, 40), fit: U.fit })); } catch (e) { } };
  function clipTools(b) {
    const L = selLayer(); if (!L || (L.type !== 'video' && L.type !== 'audio')) return;
    const run = (label, fn) => async () => { toast(label + '…'); try { const m = await fn(); if (m) toast(m); buildLeft(); } catch (e) { toast(e.message || String(e)); } };
    const box = el('div', { class: 'mu-clip' }, el('small', { class: 'dim' }, 'Selected clip: ' + L.name));
    if (L.type === 'video') box.append(el('button', { id: 'muExtract', onclick: () => extractDialog(L) }, Icon('music', 13), 'Extract audio'));
    if (L.type === 'audio') { box.append(el('button', { onclick: () => { fit(L); toast('Fitted to the timeline with a fade-out'); } }, 'Fit to timeline'), el('button', { onclick: run('Finding the beat', async () => { const r = await beatSync(L, 2); return `${r.bpm} BPM · ${r.cuts} cuts on the beat`; }) }, 'Cut video to the beat'), el('button', { onclick: run('Listening for voices', async () => { const n = await duckUnderVoice(L); return n ? `Music lowered under ${n} spoken section(s)` : 'No speech found'; }) }, 'Duck under voice')); if (window.nxff) box.append(el('button', { onclick: () => { const o = { format: 'mp3' }; showModal('Save audio', field('File format', o, 'format', 'select', { opts: Object.keys(AFMT), names: k => AFMT[k] }), [['Cancel', closeModal], ['Save…', async () => { closeModal(); try { const r = await saveAudio(L, o); if (r) { toast('Saved ' + Disk.base(r.out)); nxfs.reveal(r.out); } } catch (e) { toast(e.message); } }, true]]); } }, 'Save as MP3…')); }
    b.append(box);
  }
  function panel(b) {
    clipTools(b);
    b.append(el('div', { class: 'seg mu-tabs' }, [['library', 'Library'], ['web', 'Free online'], ['mine', 'My music']].map(([k, n]) => el('button', { class: U.tab === k ? 'on' : '', onclick: () => { U.tab = k; buildLeft(); } }, n))));
    ({ library: tabLibrary, web: tabWeb, mine: tabMine })[U.tab](b);
  }
  const fitBox = () => el('label', { class: 'mu-fit' }, el('input', { type: 'checkbox', checked: U.fit ? '' : undefined, onchange: e => { U.fit = e.target.checked; keep(); } }), 'Fit to timeline with a fade-out');
  function filtered() {
    const w = U.q.toLowerCase().split(/\s+/).filter(Boolean); let l = U.genre === 'All' ? CATALOG : U.genre === 'Favorites' ? CATALOG.filter(t => U.fav.has(t.id)) : U.genre === 'Recent' ? U.recent.map(id => BYID[id]).filter(Boolean) : CATALOG.filter(t => t.genre === U.genre);
    if (U.mood !== 'All') l = l.filter(t => t.mood === U.mood); if (w.length) l = l.filter(t => { const s = `${t.title} ${t.genre} ${t.mood} ${t.key} ${t.bpm}`.toLowerCase(); return w.every(x => s.includes(x)); });
    if (U.sort === 'bpm') l = l.slice().sort((a, c) => a.bpm - c.bpm); else if (U.sort === 'name' && U.genre !== 'Recent') l = l.slice().sort((a, c) => a.title.localeCompare(c.title)); return l;
  }
  function row(id, name, meta, onPlay, onAdd, star) {
    const play = el('button', { class: 'mu-play', title: 'Preview', onclick: onPlay }, Icon(Pl.id === id ? 'tpause' : 'tplay', 12)), add = el('button', { class: 'mu-add', title: 'Add at playhead', onclick: async () => { add.disabled = true; add.textContent = '…'; try { await onAdd(); } catch (e) { toast(e.message || String(e)); } finally { add.disabled = false; add.textContent = '+'; } } }, '+');
    return el('div', { class: 'mu-row', 'data-id': id }, play, el('div', { class: 'mu-txt' }, el('b', { title: name }, name), el('small', { title: meta }, meta)), star || null, add);
  }
  function tabLibrary(b) {
    const genres = ['All', 'Favorites', 'Recent', ...Object.keys(STYLES)], moods = ['All', ...new Set(Object.values(STYLES).flatMap(s => s.moods))].sort((a, c) => a === 'All' ? -1 : c === 'All' ? 1 : a.localeCompare(c)), host = el('div', { class: 'vhost' }), info = el('div', { class: 'dim lcount' });
    const q = el('input', { class: 'lsearch', id: 'muSearch', placeholder: `Search ${CATALOG.length.toLocaleString()} tracks: phonk, 150, dark…`, value: U.q, oninput: () => { U.q = q.value; fill(); } });
    b.append(q, el('div', { class: 'chips' }, genres.map(g => el('button', { class: U.genre === g ? 'on' : '', onclick: () => { U.genre = g; buildLeft(); } }, g))), el('div', { class: 'mu-opts' }, el('select', { onchange: e => { U.mood = e.target.value; fill(); } }, moods.map(m => el('option', { value: m, selected: m === U.mood ? '' : undefined }, m === 'All' ? 'Any mood' : m))), el('select', { onchange: e => { U.sort = e.target.value; fill(); } }, [['name', 'Name'], ['bpm', 'BPM']].map(([k, n]) => el('option', { value: k, selected: k === U.sort ? '' : undefined }, n))), fitBox()), info, host);
    const card = t => { const star = el('button', { class: 'star mu-star' + (U.fav.has(t.id) ? ' on' : ''), title: 'Favorite', onclick: () => { U.fav.has(t.id) ? U.fav.delete(t.id) : U.fav.add(t.id); keep(); star.classList.toggle('on'); } }, '★'); return row(t.id, t.title, `${t.genre} · ${t.bpm} BPM · ${t.key} · ${t.mood} · ${fmtDur(t.dur)}`, () => preview(t), async () => { await addTrack(t, { fit: U.fit }); U.recent = [t.id, ...U.recent.filter(x => x !== t.id)]; keep(); toast(`${t.title} added`); }, star); };
    const fill = () => { const l = filtered(); info.textContent = l.length ? `${l.length.toLocaleString()} tracks · made on this computer, free to use anywhere` : 'No match. Commercial songs are not included: try a genre like Montagem, or add your own file under My music.'; host.innerHTML = ''; Browser.vgrid(host, l, card, { cw: 240, ch: 46, gap: 2 }); }; fill();
    Pl.onChange = () => { document.querySelectorAll('.mu-row').forEach(r => { const p = r.querySelector('.mu-play'); p.innerHTML = ''; p.append(Icon(Pl.id === r.dataset.id ? 'tpause' : 'tplay', 12)); }); };
  }
  function tabWeb(b) {
    if (!window.nxmusic) return b.append(el('p', { class: 'dim' }, 'Online search needs the desktop app.'));
    const q = el('input', { class: 'lsearch', id: 'muWeb', placeholder: 'Search Creative Commons music', value: Web.q, onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') { Web.q = q.value; Web.page = 1; search(); } } }), host = el('div', { class: 'vhost' }), info = el('div', { class: 'dim lcount' });
    const search = async () => { Web.busy = true; info.textContent = 'Searching…'; const r = await nxmusic.search({ q: Web.q, page: Web.page }); Web.busy = false; if (!r.ok) { Web.rows = []; info.textContent = r.error; host.innerHTML = ''; return; } Web.rows = r.results; Web.total = r.total; draw(); };
    const draw = () => { const rows = Web.rows.filter(r => !Web.full || r.seconds >= 30); info.textContent = `${Web.total.toLocaleString()} results for "${Web.q}" · showing ${rows.length} on page ${Web.page}`; host.innerHTML = ''; Browser.vgrid(host, rows, r => row(r.id, r.title, `${r.creator} · ${r.licenseName}${r.seconds ? ' · ' + fmtDur(r.seconds) : ''}`, () => previewUrl(r.id, r.preview), async () => { await addWeb(r, { fit: U.fit }); toast(r.attribution ? `Added. Credit required: use "Copy credits".` : 'Added.'); }), { cw: 240, ch: 46, gap: 2 }); };
    b.append(q, el('div', { class: 'mu-opts' }, el('label', { class: 'mu-fit' }, el('input', { type: 'checkbox', checked: Web.full ? '' : undefined, onchange: e => { Web.full = e.target.checked; draw(); } }), 'Over 30 seconds'), el('button', { onclick: () => { if (Web.page > 1) { Web.page--; search(); } } }, 'Prev'), el('button', { onclick: () => { Web.page++; search(); } }, 'Next'), el('button', { title: 'Copy the credits of the online music used in this project', onclick: () => { const c = P.credits || []; if (!c.length) return toast('No online music in this project yet.'); navigator.clipboard.writeText(c.map(creditLine).join('\n')); toast('Credits copied'); } }, 'Copy credits')), fitBox(), info, host);
    if (Web.rows.length) draw(); else search();
    b.append(el('div', { class: 'dim mu-note' }, 'Search by Openverse. Only licences that allow commercial use are shown. Check each track\'s licence before publishing.'));
  }
  function folders() { try { return JSON.parse(localStorage.getItem('nx.musicFolders') || '[]'); } catch (e) { return []; } }
  async function tabMine(b) {
    b.append(el('button', { class: 'big', onclick: () => document.getElementById('fileIn').click() }, Icon('import', 14), 'Import MP3, WAV, FLAC or M4A'));
    const aud = Object.values(media).filter(m => m.kind === 'audio'); if (aud.length) { b.append(el('h4', {}, 'In this project')); aud.forEach(m => b.append(el('div', { class: 'arow' }, Icon('music', 14), el('span', {}, m.name), el('small', { class: 'dim' }, fmtDur(m.dur)), el('button', { onclick: () => place(m, { fit: U.fit }) }, '+')))); }
    if (!window.nxmusic) return; const fs_ = folders(), host = el('div', { class: 'vhost' }), info = el('div', { class: 'dim lcount' });
    b.append(el('div', { class: 'mu-opts' }, el('button', { id: 'muAddFolder', onclick: async () => { const d = await nxfs.pickFolder({ title: 'Add a music folder' }); if (d && !fs_.includes(d)) { localStorage.setItem('nx.musicFolders', JSON.stringify([...fs_, d])); buildLeft(); } } }, 'Add music folder'), fs_.length ? el('button', { onclick: () => { localStorage.removeItem('nx.musicFolders'); buildLeft(); } }, 'Forget folders') : null), info, host);
    if (!fs_.length) { info.textContent = 'Add a folder and its music stays here for every project.'; return; }
    info.textContent = 'Reading folders…'; const r = await nxmusic.scan(fs_); info.textContent = `${r.files.length.toLocaleString()} files in ${fs_.length} folder${fs_.length > 1 ? 's' : ''}`; Browser.vgrid(host, r.files, f => row(f.path, f.name.replace(/\.[^.]+$/, ''), Disk.base(f.dir), () => previewUrl(f.path, Disk.urlOf(f.path)), async () => { const m = await Disk.importPath(f.path); if (!m) throw new Error('This file could not be read.'); media[m.id] = m; uiMedia(); place(m, { fit: U.fit }); toast(f.name + ' added'); }), { cw: 240, ch: 46, gap: 2 });
  }
  return { CATALOG, BYID, STYLES, render, wav16, addTrack, addWeb, fit, detach, saveAudio, extractDialog, beatSync, duckUnderVoice, panel, preview, stop, filtered, U, AFMT, credit, creditLine, sections };
})();
