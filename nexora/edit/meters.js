'use strict';
/* ====================== NEXORA program audio meters ======================
   Stereo peak meters beside the Edit viewer, measured on the live master bus (after the limiter, i.e. what you hear
   and what exports): −60 to 0 dBFS scale, 1.5 s peak hold, a clip light that latches at 0 dBFS until clicked. */
const Meters = (() => {
  const S = { an: null, bus: null, hold: [-Infinity, -Infinity], holdAt: [0, 0], clip: false, lvl: [-Infinity, -Infinity] };
  let cv = null, buf = null;
  const FLOOR = -60, dbY = (db, h) => Math.round((1 - (Math.max(FLOOR, Math.min(0, db)) - FLOOR) / -FLOOR) * h);
  function hook() {
    const bus = typeof AudioMix !== 'undefined' && AudioMix.liveBus && AudioMix.liveBus(); if (!bus || bus === S.bus) return !!S.an;
    S.bus = bus; const ctx = bus.meter.context, sp = ctx.createChannelSplitter(2); bus.meter.connect(sp);
    S.an = [0, 1].map(i => { const a = ctx.createAnalyser(); a.fftSize = 1024; sp.connect(a, i); return a; }); buf = new Float32Array(1024); return true;
  }
  function measure() {
    const now = performance.now();
    for (let c = 0; c < 2; c++) {
      let pk = 0; if (S.an && playing) { S.an[c].getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; } }
      const db = pk > 0 ? 20 * Math.log10(pk) : -Infinity;
      S.lvl[c] = Math.max(db, (S.lvl[c] === -Infinity ? FLOOR : S.lvl[c]) - 1.2);   // ~70 dB/s fall
      if (db >= S.hold[c] || now - S.holdAt[c] > 1500) { S.hold[c] = db; S.holdAt[c] = now; }
      if (pk >= .999) S.clip = true;
    }
  }
  function draw() {
    if (!cv) return; const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1, W = Math.round(r.width * d), H = Math.round(r.height * d); if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const x = cv.getContext('2d'), top = 14 * d, h = H - top - 4 * d, bw = Math.round(7 * d), gap = Math.round(3 * d), x0 = W - 2 * bw - gap - 2 * d;
    x.clearRect(0, 0, W, H);
    x.fillStyle = S.clip ? '#ffffff' : '#2a2f35'; x.fillRect(x0, 2 * d, 2 * bw + gap, 6 * d);   // clip light
    x.font = `${9 * d}px Consolas, monospace`; x.textAlign = 'right'; x.textBaseline = 'middle';
    for (const db of [0, -6, -12, -18, -24, -36, -48, -60]) { const y = top + dbY(db, h); x.fillStyle = '#ffffff1a'; x.fillRect(x0 - 3 * d, y, 2 * bw + gap + 3 * d, 1); x.fillStyle = '#8f98a3'; x.fillText(db === 0 ? '0' : String(db), x0 - 5 * d, y); }
    for (let c = 0; c < 2; c++) {
      const bx = x0 + c * (bw + gap); x.fillStyle = '#0b0c0e'; x.fillRect(bx, top, bw, h);
      const y = top + dbY(S.lvl[c], h); if (S.lvl[c] > FLOOR) {
        const yw = top + dbY(-6, h); x.fillStyle = '#5cb8ff'; x.fillRect(bx, Math.max(y, yw), bw, top + h - Math.max(y, yw));
        if (y < yw) { x.fillStyle = '#e8f6ff'; x.fillRect(bx, y, bw, yw - y); }
      }
      if (S.hold[c] > FLOOR) { x.fillStyle = S.hold[c] > -.1 ? '#fff' : '#9ad6ff'; x.fillRect(bx, top + dbY(S.hold[c], h), bw, Math.max(1, d)); }
    }
  }
  function loop() {
    requestAnimationFrame(loop);
    if (!cv || cv.offsetParent === null) return;
    if (playing) hook(); measure(); draw();
  }
  function mount() {
    const host = document.getElementById('meters'); if (!host || cv) return;
    cv = el('canvas', { title: 'Program audio level (dBFS, after the master limiter). Click to reset the clip light.' }); cv.onclick = () => { S.clip = false; S.hold = [-Infinity, -Infinity]; };
    host.append(cv); requestAnimationFrame(loop);
  }
  setTimeout(mount, 0);
  return { S, hook, measure };
})();
