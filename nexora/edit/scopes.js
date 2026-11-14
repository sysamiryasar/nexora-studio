'use strict';
/* ====================== NEXORA video scopes ======================
   Measured from the composited program frame (what you export), downsampled to 320 px wide:
     Waveform   luma (Rec.709) per column, 0–100 IRE graticule
     Parade     R, G, B waveforms side by side
     Vectorscope Cb/Cr (Rec.709) with 75 % colour-bar targets and the skin-tone line
     Histogram  R, G, B and luma distributions
   Updates ~15 times a second while playing and after every change while paused. Toggle with the Scopes button or Shift+C. */
const Scopes = (() => {
  const S = { on: false, mode: 'waveform', last: 0, stats: null };
  const W = 320, H = 180, sc = document.createElement('canvas'); sc.width = W; sc.height = H; const sx = sc.getContext('2d', { willReadFrequently: true });
  let panel = null, cv = null;
  const luma = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
  /** analyse an RGBA frame → accumulation buffers + simple stats (exposed for tests) */
  function analyse(src) {
    sx.clearRect(0, 0, W, H); sx.drawImage(src, 0, 0, W, H); const d = sx.getImageData(0, 0, W, H).data;
    const wf = new Uint32Array(W * 256), par = [new Uint32Array(W * 256), new Uint32Array(W * 256), new Uint32Array(W * 256)], vec = new Uint32Array(256 * 256), hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let lmin = 255, lmax = 0, sum = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (d[i + 3] < 8) continue; const r = d[i], g = d[i + 1], b = d[i + 2], l = Math.round(luma(r, g, b));
      wf[x * 256 + l]++; par[0][x * 256 + r]++; par[1][x * 256 + g]++; par[2][x * 256 + b]++; hist[0][r]++; hist[1][g]++; hist[2][b]++; hist[3][l]++;
      const cb = (b - l) / 1.8556, cr = (r - l) / 1.5748; vec[(128 - Math.round(cr)) * 256 + (128 + Math.round(cb))]++;   // Rec.709 colour difference, scaled to ±128
      if (l < lmin) lmin = l; if (l > lmax) lmax = l; sum += l; n++;
    }
    return (S.stats = { wf, par, vec, hist, lmin, lmax, mean: n ? sum / n : 0, n });
  }
  // 75 % colour bars in Cb/Cr (for the vectorscope targets)
  const BARS = [['R', [191, 0, 0]], ['Yl', [191, 191, 0]], ['G', [0, 191, 0]], ['Cy', [0, 191, 191]], ['B', [0, 0, 191]], ['Mg', [191, 0, 191]]].map(([n, [r, g, b]]) => { const l = luma(r, g, b); return [n, (b - l) / 1.8556, (r - l) / 1.5748]; });
  function draw() {
    if (!cv) return; const st = S.stats, x = cv.getContext('2d'), CW = cv.width, CH = cv.height; x.fillStyle = '#05070b'; x.fillRect(0, 0, CW, CH); if (!st) return;
    const plot = (buf, cols, x0, w, rgb) => { const img = x.getImageData(x0, 0, w, CH), o = img.data;
      for (let c = 0; c < cols; c++) for (let v = 0; v < 256; v++) { const k = buf[c * 256 + v]; if (!k) continue; const px = Math.floor(c * w / cols), py = Math.round((1 - v / 255) * (CH - 1)), a = Math.min(255, 40 + k * 22), j = (py * w + px) * 4; o[j] = Math.min(255, o[j] + rgb[0] * a / 255); o[j + 1] = Math.min(255, o[j + 1] + rgb[1] * a / 255); o[j + 2] = Math.min(255, o[j + 2] + rgb[2] * a / 255); o[j + 3] = 255; }
      x.putImageData(img, x0, 0); };
    const grat = (x0, w) => { x.strokeStyle = '#ffffff22'; x.fillStyle = '#ffffff55'; x.font = '9px sans-serif'; for (const ire of [0, 25, 50, 75, 100]) { const y = Math.round((1 - ire / 100) * (CH - 1)) + .5; x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + w, y); x.stroke(); if (x0 === 0) x.fillText(ire, 2, y - 2); } };
    if (S.mode === 'waveform') { plot(st.wf, W, 0, CW, [154, 214, 255]); grat(0, CW); }
    else if (S.mode === 'parade') { const w = Math.floor(CW / 3); [[255, 90, 90], [90, 255, 120], [100, 160, 255]].forEach((c, i) => plot(st.par[i], W, i * w, w, c)); grat(0, CW); }
    else if (S.mode === 'vectorscope') {
      const R = Math.min(CW, CH) / 2 - 6, cx = CW / 2, cy = CH / 2; x.strokeStyle = '#ffffff26'; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke(); x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
      const img = x.getImageData(0, 0, CW, CH), o = img.data;
      for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) { const k = st.vec[v * 256 + u]; if (!k) continue; const px = Math.round(cx + (u - 128) / 128 * R), py = Math.round(cy + (v - 128) / 128 * R); if (px < 0 || py < 0 || px >= CW || py >= CH) continue; const j = (py * CW + px) * 4, a = Math.min(255, 60 + k * 30); o[j] = Math.min(255, o[j] + a * .6); o[j + 1] = Math.min(255, o[j + 1] + a * .85); o[j + 2] = Math.min(255, o[j + 2] + a); }
      x.putImageData(img, 0, 0);
      x.strokeStyle = '#9ad6ff'; x.fillStyle = '#9ad6ff'; x.font = '9px sans-serif'; for (const [n, cb, cr] of BARS) { const px = cx + cb / 128 * R, py = cy - cr / 128 * R; x.strokeRect(px - 4, py - 4, 8, 8); x.fillText(n, px + 6, py + 3); }
      const sk = 123 * Math.PI / 180; x.strokeStyle = '#ffd8a855'; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(Math.PI - sk) * R, cy - Math.sin(Math.PI - sk) * R); x.stroke();
    } else {
      const max = Math.max(1, ...st.hist.flatMap(h => Array.from(h).slice(2, 254))); [[255, 90, 90, .5], [90, 255, 120, .5], [100, 160, 255, .5], [255, 255, 255, .8]].forEach(([r, g, b, a], i) => { x.strokeStyle = `rgba(${r},${g},${b},${a})`; x.beginPath(); for (let v = 0; v < 256; v++) { const px = v / 255 * (CW - 1), py = CH - 1 - Math.min(1, st.hist[i][v] / max) * (CH - 8); v ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); });
    }
    const info = panel && panel.querySelector('.scinfo'); if (info) info.textContent = `luma min ${Math.round(st.lmin / 2.55)} · avg ${Math.round(st.mean / 2.55)} · max ${Math.round(st.lmax / 2.55)} IRE${st.lmax >= 254 ? ' · clipping' : ''}`;
  }
  function update(force) { if (!S.on) return; const now = performance.now(); if (!force && now - S.last < 66) return; S.last = now; analyse(view); draw(); }
  function build() {
    const host = document.getElementById('stageWrap') || document.getElementById('viewer') || document.body;
    panel = el('div', { class: 'scopes' }, el('div', { class: 'schead' }, el('div', { class: 'seg' }, ['waveform', 'parade', 'vectorscope', 'histogram'].map(m => el('button', { class: S.mode === m ? 'on' : '', onclick: e => { S.mode = m; panel.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b === e.target)); update(true); } }, m[0].toUpperCase() + m.slice(1)))), el('button', { class: 'x', title: 'Close (Shift+C)', onclick: () => toggle(false) }, '✕')),
      cv = el('canvas', { width: 360, height: 200 }), el('div', { class: 'scinfo dim' }));
    // drag by the header
    const hd = panel.querySelector('.schead'); hd.onpointerdown = e => { if (e.target.tagName === 'BUTTON') return; const r = panel.getBoundingClientRect(), hr = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; hd.setPointerCapture(e.pointerId); hd.onpointermove = ev => { panel.style.left = (ev.clientX - hr.left - dx) + 'px'; panel.style.top = (ev.clientY - hr.top - dy) + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto'; }; hd.onpointerup = () => hd.onpointermove = null; };
    host.append(panel);
  }
  function toggle(v) { S.on = v === undefined ? !S.on : v; if (S.on && !panel) build(); if (panel) panel.classList.toggle('hidden', !S.on); const b = document.getElementById('bScopes'); if (b) b.classList.toggle('on', S.on); update(true); }
  // hook the render loop: refresh after each composited frame
  const _render = window.renderComp; window.renderComp = function (ctx, t) { const r = _render.apply(this, arguments); if (S.on && ctx === vctx) update(!playing); return r; };
  window.addEventListener('keydown', e => { if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c' && (typeof Shell === 'undefined' || Shell.active === 'edit') && !(e.target.matches && e.target.matches('input,textarea,select'))) { e.preventDefault(); toggle(); } });
  setTimeout(() => { const tr = document.getElementById('transport'), fit = document.getElementById('bFit'); if (tr && fit && !document.getElementById('bScopes')) tr.insertBefore(el('button', { id: 'bScopes', class: 'pill-btn', title: 'Video scopes (Shift+C)', onclick: () => toggle() }, 'Scopes'), fit); }, 0);
  return { S, analyse, toggle, update, BARS };
})();
