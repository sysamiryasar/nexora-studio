'use strict';
/* ====================== NEXORA Color page ======================
   Primary grading on the same timeline and viewer as Edit. The page hides the media/effects panel and the timeline,
   docks the video scopes on the right, and puts a clip strip plus four colour wheels where the timeline was:
     Lift (shadows) · Gamma (midtones) · Gain (highlights) · Offset (everything)
   Each wheel's puck pushes the colour balance of its range (puck direction = the hue it pushes towards, measured on
   the same circle as the vectorscope), the slider under it sets that range's master level.
   The grade is one "primaries" effect at the top of the clip's effect stack, so it is non-destructive, renders on the
   GPU, exports, and can be bypassed, copied to other clips or reset. */
const ColorPage = (() => {
  const S = { on: false, dock: null, prevScopes: false, clip: null, copied: null };
  const PIC = ['video', 'image', 'comp', 'vfx', 'gen', '3d', 'solid', 'shape', 'text', 'paint', 'particles'];
  // wheel axes: R, G and B 120° apart, oriented like the vectorscope (red up and to the left)
  const AX = [103, 223, 343].map(d => d * Math.PI / 180), REACH = 40;   // puck at the rim = ±40 on the channel sliders
  const WHEELS = [['l', 'Lift', 'Shadows'], ['g', 'Gamma', 'Midtones'], ['k', 'Gain', 'Highlights'], ['o', 'Offset', 'All tones']];
  const $$ = id => document.getElementById(id);

  const clips = () => P.layers.filter(L => PIC.includes(L.type) && L.visible !== false).sort((a, b) => a.start - b.start || P.layers.indexOf(b) - P.layers.indexOf(a));
  /** the clip being graded: the selection if it is a picture clip, else the top picture clip under the playhead */
  function target() {
    const s = typeof selLayer === 'function' ? selLayer() : null; if (s && PIC.includes(s.type)) return s;
    for (let i = P.layers.length - 1; i >= 0; i--) { const L = P.layers[i]; if (PIC.includes(L.type) && L.visible !== false && T >= L.start && T < L.start + L.dur) return L; }
    return null;
  }
  const gradeOf = L => L && L.fx.find(f => f.type === 'primaries');
  const curvesOf = L => L && L.fx.find(f => f.type === 'curves');
  S.view = 'prim'; S.stills = []; S.wipe = null;

  /* ---------- stills + split-screen wipe ----------
     A still is the viewer frame at the moment you grab it (kept for this session). Clicking a still lays it over the
     viewer on the left of a draggable wipe line, so the current grade shows on the right. */
  function grabStill() {
    renderComp(vctx, T); const s = mkCanvas(Math.min(view.width, 1920), Math.round(view.height * Math.min(view.width, 1920) / view.width)); s.getContext('2d').drawImage(view, 0, 0, s.width, s.height);
    const L = target(); S.stills.unshift({ id: uid(), url: s.toDataURL('image/jpeg', .9), name: (L ? L.name : 'Frame') + ' · ' + tcFull(T) }); if (S.stills.length > 16) S.stills.pop();
    strip(); toast('Still grabbed. Click it in the strip to compare.');
  }
  function wipe(still) {
    const host = $$('stageWrap'); let w = $$('wipe');
    if (!still || (S.wipe && S.wipe.id === still.id)) { S.wipe = null; if (w) w.remove(); strip(); return; }
    S.wipe = { id: still.id, pos: S.wipe ? S.wipe.pos : .5 };
    if (!w) { w = el('div', { id: 'wipe' }, el('img', { draggable: 'false' }), el('div', { class: 'wipe-line' }, el('span', {}, 'STILL'), el('i', {}), el('span', {}, 'LIVE'))); host.append(w);
      const line = w.querySelector('.wipe-line'); line.onpointerdown = e => { line.setPointerCapture(e.pointerId); line.onpointermove = ev => { const r = host.getBoundingClientRect(); S.wipe.pos = clamp((ev.clientX - r.left - panX) / (P.w * zoom), 0, 1); syncWipe(); }; line.onpointerup = () => line.onpointermove = null; }; }
    w.querySelector('img').src = still.url; syncWipe(); strip();
  }
  function syncWipe() {
    const w = $$('wipe'); if (!w || !S.wipe) return; const img = w.querySelector('img'), line = w.querySelector('.wipe-line');
    img.style.width = P.w + 'px'; img.style.height = P.h + 'px'; img.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`; img.style.clipPath = `inset(0 ${((1 - S.wipe.pos) * 100).toFixed(3)}% 0 0)`;
    line.style.left = (panX + S.wipe.pos * P.w * zoom) + 'px'; line.style.top = panY + 'px'; line.style.height = P.h * zoom + 'px';
  }
  new MutationObserver(syncWipe).observe(view, { attributes: true, attributeFilter: ['style'] });

  /* ---------- qualifier colour picker: click the viewer while "Pick colour" is on ----------
     Samples a 5×5 average of the frame WITHOUT the secondary itself, then centres the hue band and the saturation /
     luma ranges on it. A near-grey pick selects by brightness only (hue is meaningless there). */
  function pickAt(cx, cy) {
    const q = S.pending && S.pending.f, L = S.pending && S.pending.L; if (!q || q.type !== 'secondary') return null;
    // sample the graded clip on its own (titles or overlays above it must not be picked), at up to 960 px wide
    const p = toComp({ x: cx, y: cy }), k = Math.min(1, 960 / P.w), cw = Math.max(5, Math.round(P.w * k)), ch = Math.max(5, Math.round(P.h * k)), cv = mkCanvas(cw, ch), x = cv.getContext('2d', { willReadFrequently: true });
    const was = q.on; q.on = false; const rq0 = RQ; RQ = k; try { renderLayers(x, T, [L], P); } finally { RQ = rq0; q.on = was; }
    const x0 = clamp(Math.round(p.x * k) - 2, 0, cw - 5), y0 = clamp(Math.round(p.y * k) - 2, 0, ch - 5), d = x.getImageData(x0, y0, 5, 5).data;
    let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } r /= 25 * 255; g /= 25 * 255; b /= 25 * 255;
    const [h, s] = Secondary.hsv(r, g, b), l = .2126 * r + .7152 * g + .0722 * b, pct = v => Math.round(clamp(v, 0, 1) * 100);
    Object.assign(q.p, s < .12 ? { hue: 0, hw: 360, slo: 0, shi: pct(s + .2), llo: pct(l - .2), lhi: pct(l + .2) } : { hue: Math.round(h), hw: 40, hs: 20, slo: pct(s - .3), shi: 100, llo: pct(l - .4), lhi: pct(l + .4) });
    q.on = true; attach(); commit(); requestRender(); return { rgb: [r, g, b].map(v => Math.round(v * 255)), hue: Math.round(h), sat: pct(s), luma: pct(l) };
  }
  $$('stageWrap').addEventListener('pointerdown', e => {
    if (!S.on || !S.picking) return; e.preventDefault(); e.stopPropagation(); const r = $$('stageWrap').getBoundingClientRect(), res = pickAt(e.clientX - r.left, e.clientY - r.top);
    S.picking = false; document.body.classList.remove('cp-picking'); build(); if (res) toast(res.sat < 12 ? `Selected greys around ${res.luma} % brightness` : `Selected hue ${res.hue}° (sat ${res.sat} %, luma ${res.luma} %). Check it with Show matte.`);
  }, true);
  function ensureGrade(L) { let f = gradeOf(L); if (!f) { f = newFx('primaries'); L.fx.unshift(f); } return f; }
  const isGraded = L => { const sc = L.fx.find(f => f.type === 'secondary'); if (sc && sc.on && JSON.stringify(sc.p) !== JSON.stringify(newFx('secondary').p)) return true;
    const c = L.fx.find(f => f.type === 'curves'); if (c && c.on && typeof Curves !== 'undefined' && !Curves.isIdentity(c.p.pts)) return true;
    const f = gradeOf(L); if (!f || !f.on) return false; const d = newFx('primaries').p; return Object.keys(d).some(k => f.p[k] !== d[k]); };

  /* ---------- puck ↔ channel values ---------- */
  const toRGB = (x, y) => { const v = AX.map(a => (x * Math.cos(a) + y * Math.sin(a)) * REACH), m = (v[0] + v[1] + v[2]) / 3; return v.map(c => Math.round((c - m) * 10) / 10); };
  const toXY = (r, g, b) => { const v = [r, g, b], m = (r + g + b) / 3; let x = 0, y = 0; v.forEach((c, i) => { x += (c - m) * Math.cos(AX[i]); y += (c - m) * Math.sin(AX[i]); }); return [x * 2 / 3 / REACH, y * 2 / 3 / REACH]; };

  function wheel(k, name, sub, f, L) {
    const SZ = 132, cv = el('canvas', { width: SZ * 2, height: SZ * 2, class: 'cw-wheel', title: 'Drag to balance colour · double-click to reset' });
    const val = el('div', { class: 'cw-val' }), master = el('input', { type: 'range', min: -100, max: 100, step: 1, value: f.p[k + 'm'], title: name + ' master' });
    const draw = () => {
      const x = cv.getContext('2d'), c = SZ, R = SZ - 10; x.clearRect(0, 0, SZ * 2, SZ * 2);
      const g = x.createConicGradient(-Math.PI / 2, c, c);   // hue ring, desaturated so it reads as a control, not a picture
      for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + i / 12 * Math.PI * 2, rr = Math.cos(a - AX[0]), gg = Math.cos(a - AX[1]), bb = Math.cos(a - AX[2]); g.addColorStop(i / 12, `rgb(${120 + rr * 48},${120 + gg * 48},${120 + bb * 48})`); }
      x.beginPath(); x.arc(c, c, R, 0, 7); x.lineWidth = 8; x.strokeStyle = g; x.stroke();
      // the wheel's screen orientation: angle a measured counter-clockwise from +x, y up
      const bg = x.createRadialGradient(c, c, 0, c, c, R - 6); bg.addColorStop(0, '#2a2e33'); bg.addColorStop(1, '#14171a'); x.beginPath(); x.arc(c, c, R - 6, 0, 7); x.fillStyle = bg; x.fill();
      x.strokeStyle = '#ffffff1f'; x.lineWidth = 2; x.beginPath(); x.moveTo(c - R + 8, c); x.lineTo(c + R - 8, c); x.moveTo(c, c - R + 8); x.lineTo(c, c + R - 8); x.stroke();
      x.font = '600 18px Segoe UI, sans-serif'; x.fillStyle = '#ffffff59'; x.textAlign = 'center'; x.textBaseline = 'middle'; ['R', 'G', 'B'].forEach((n, i) => x.fillText(n, c + Math.cos(AX[i]) * (R - 24), c - Math.sin(AX[i]) * (R - 24)));
      const [px, py] = toXY(f.p[k + 'r'], f.p[k + 'g'], f.p[k + 'b']), sx = c + px * (R - 8), sy = c - py * (R - 8);
      x.beginPath(); x.moveTo(c, c); x.lineTo(sx, sy); x.strokeStyle = '#5cb8ff99'; x.lineWidth = 2; x.stroke();
      x.beginPath(); x.arc(sx, sy, 9, 0, 7); x.fillStyle = '#000'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke(); x.shadowColor = '#5cb8ff'; x.shadowBlur = 12; x.stroke(); x.shadowBlur = 0;
      val.textContent = ''; ['r', 'g', 'b'].forEach((c2, i) => val.append(el('span', { class: 'c' + i }, (f.p[k + c2] >= 0 ? '+' : '') + f.p[k + c2].toFixed(1))));
      val.append(el('span', { class: 'cm' }, (f.p[k + 'm'] >= 0 ? '+' : '') + f.p[k + 'm']));
    };
    const fromEv = e => { const r = cv.getBoundingClientRect(), R = (r.width / 2) * (SZ - 18) / SZ; let x = (e.clientX - r.left - r.width / 2) / R, y = -(e.clientY - r.top - r.height / 2) / R; const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; } return [x, y]; };
    let base = null;
    cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); const fine = e.shiftKey; base = fine ? { e: [e.clientX, e.clientY], p: toXY(f.p[k + 'r'], f.p[k + 'g'], f.p[k + 'b']) } : null; move(e); };
    const move = e => { if (!cv.hasPointerCapture(e.pointerId)) return; let xy = fromEv(e); if (base) { const r = cv.getBoundingClientRect(); xy = [base.p[0] + (e.clientX - base.e[0]) / r.width * .4, base.p[1] - (e.clientY - base.e[1]) / r.width * .4]; }
      const [r, g, b] = toRGB(xy[0], xy[1]); f.p[k + 'r'] = r; f.p[k + 'g'] = g; f.p[k + 'b'] = b; f.on = true; draw(); live(L); };
    cv.onpointermove = move; cv.onpointerup = () => { base = null; done(L); };
    cv.ondblclick = () => { f.p[k + 'r'] = f.p[k + 'g'] = f.p[k + 'b'] = 0; f.p[k + 'm'] = 0; master.value = 0; draw(); live(L); done(L); };
    master.oninput = () => { f.p[k + 'm'] = +master.value; f.on = true; draw(); live(L); }; master.onchange = () => done(L); master.ondblclick = () => { master.value = 0; master.oninput(); done(L); };
    draw();
    return el('div', { class: 'cw' }, el('div', { class: 'cw-head' }, el('b', {}, name), el('small', {}, sub)), cv, master, val);
  }
  function slider(L, f, key, label, min, max, unit) {
    const out = el('span', { class: 'cs-v' }), inp = el('input', { type: 'range', min, max, step: 1, value: f.p[key] });
    const sync = () => out.textContent = f.p[key] + (unit || ''); sync();
    inp.oninput = () => { f.p[key] = +inp.value; f.on = true; sync(); live(L); }; inp.onchange = () => done(L);
    inp.ondblclick = () => { inp.value = newFx(f.type).p[key]; inp.oninput(); done(L); };
    return el('label', { class: 'cs' }, el('span', {}, label), inp, out);
  }
  /** segmented choice for a 'sel' parameter */
  function choice(L, f, key, label, opts) {
    return el('div', { class: 'cs' }, el('span', {}, label), el('div', { class: 'seg cs-seg' }, ...opts.map(o => el('button', { class: f.p[key] === o ? 'on' : '', onclick: () => { f.p[key] = o; f.on = true; live(L); done(L); build(); } }, o))), el('span'));
  }
  let rq = 0;
  // a clip only gets a Color-page effect when something is actually changed; the page's effects keep a fixed order
  // at the top of the stack: primaries → curves → secondary
  const ORDER = ['primaries', 'curves', 'secondary'];
  const attach = () => { const q = S.pending; if (!q || q.L.fx.includes(q.f)) return; let i = 0; q.L.fx.forEach((x, j) => { const a = ORDER.indexOf(x.type); if (a >= 0 && a < ORDER.indexOf(q.f.type)) i = j + 1; }); q.L.fx.splice(i, 0, q.f); };
  const live = () => { attach(); if (rq) return; rq = requestAnimationFrame(() => { rq = 0; requestRender(); if (typeof Scopes !== 'undefined') Scopes.update(true); }); };
  const done = L => { attach(); commit(); strip(); if (typeof renderTimeline === 'function') renderTimeline(); };

  /* ---------- automatic balance from the measured frame ---------- */
  /** grey-world white balance on the offset wheel + a levels-style stretch on lift and gain, measured on the frame
      without this clip's grade. Returns what it changed, for the toast and for tests. */
  function autoBalance(L) {
    L = L || target(); if (!L) return null; const f = ensureGrade(L), was = f.on; f.on = false; renderComp(vctx, T);   // render-cache signatures include the effect stack, so this is a fresh frame
    const st = Scopes.analyse(view); f.on = true;
    if (!st || !st.n) { f.on = was; return null; }
    const mean = h => { let s = 0, n = 0; for (let v = 0; v < 256; v++) { s += v * h[v]; n += h[v]; } return n ? s / n : 0; };
    const m = [0, 1, 2].map(i => mean(st.hist[i])), grey = (m[0] + m[1] + m[2]) / 3;
    const pct = (h, q) => { let n = 0; for (let v = 0; v < 256; v++) n += h[v]; let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (a >= n * q) return v; } return 255; };
    const lo = pct(st.hist[3], .005) / 255, hi = pct(st.hist[3], .995) / 255;
    ['r', 'g', 'b'].forEach((c, i) => f.p['o' + c] = clamp(Math.round((grey - m[i]) / 255 / .25 * 100 * 10) / 10, -100, 100)); f.p.om = 0;
    // stretch luma so lo → 0 and hi → 1 with v' = v·G + Lf·(1 − v):  G = (1 − lo) / (hi − lo),  Lf = −lo / (hi − lo)
    f.p.km = 0; f.p.lm = 0;
    if (hi - lo > .1 && (lo > .02 || hi < .98)) { const G = (1 - lo) / (hi - lo), Lf = -lo / (hi - lo); f.p.km = clamp(Math.round((G - 1) * 100), -50, 100); f.p.lm = clamp(Math.round(Lf / .4 * 100), -100, 100); }
    commit(); requestRender(); build(); return { offset: ['r', 'g', 'b'].map(c => f.p['o' + c]), lift: f.p.lm, gain: f.p.km, range: [Math.round(lo * 100), Math.round(hi * 100)] };
  }

  /* ---------- page ---------- */
  /* thumbnails: the clip itself rendered alone at its middle frame (graded), 160×90, cached until the clip changes */
  const thumbs = new Map(); let thumbQ = [];
  const thumbKey = L => JSON.stringify([L.start, L.dur, L.srcIn, L.fx, L.color, L.gen, L.text && L.text.str, L.media, P.w, P.h]);
  function thumbFor(L) {
    const k = thumbKey(L), c = thumbs.get(L.id); if (c && c.k === k) return c.url;
    if (!thumbQ.includes(L)) thumbQ.push(L); if (thumbQ.length === 1) setTimeout(drain, 30); return c ? c.url : '';
  }
  function drain() {
    const L = thumbQ.shift(); if (!L) return;
    // same path as the reduced-resolution preview: a small canvas with RQ set, so effects scale correctly
    try { const q = 160 / P.w, cv = mkCanvas(160, Math.max(2, Math.round(P.h * q))), x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
      const was = RQ; RQ = q; try { renderLayers(x, L.start + L.dur / 2, [L], P); } finally { RQ = was; }
      thumbs.set(L.id, { k: thumbKey(L), url: cv.toDataURL('image/jpeg', .8) }); const b = S.dock && S.dock.querySelector(`[data-clip="${L.id}"] .cp-th`); if (b) { b.style.backgroundImage = `url(${thumbs.get(L.id).url})`; b.textContent = ''; } } catch (e) { thumbs.set(L.id, { k: thumbKey(L), url: '' }); }
    if (thumbQ.length) setTimeout(drain, 16);
  }
  function strip() {
    const host = S.dock && S.dock.querySelector('.cp-strip'); if (!host) return; host.innerHTML = ''; const cur = target();
    clips().forEach((L, i) => {
      const m = L.media && media[L.media], url = L.type === 'video' && m && m.thumb && !isGraded(L) ? m.thumb : (i < 80 ? thumbFor(L) : '');
      const th = el('div', { class: 'cp-th', style: url ? `background-image:url(${url})` : '' }, url ? '' : Icon(L.type === 'text' ? 'text' : L.type === '3d' ? 'cube' : 'image', 18));
      host.append(el('button', { class: 'cp-clip' + (L === cur ? ' on' : '') + (isGraded(L) ? ' graded' : ''), 'data-clip': L.id, title: `${L.name} · ${tcFull(L.start)}`, onclick: () => { selId = L.id; if (T < L.start || T >= L.start + L.dur) seek(L.start + Math.min(L.dur / 2, 1)); if (typeof uiSel === 'function') uiSel(); build(); } },
        th, el('span', { class: 'cp-n' }, String(i + 1).padStart(2, '0')), el('small', {}, L.name), el('i', { class: 'cp-dot', title: 'Graded' })));
    });
    if (!host.children.length) host.append(el('div', { class: 'dim', style: 'padding:14px' }, 'No picture clips yet. Add video or images in Edit, then grade them here.'));
    if (S.stills.length) { host.append(el('div', { class: 'cp-sep' }, 'Stills'));
      S.stills.forEach(s => host.append(el('button', { class: 'cp-clip still' + (S.wipe && S.wipe.id === s.id ? ' on' : ''), title: s.name + ' · click to compare (wipe)', onclick: () => wipe(s) },
        el('div', { class: 'cp-th', style: `background-image:url(${s.url})` }), el('small', {}, s.name),
        el('span', { class: 'cp-x', title: 'Delete still', onclick: e => { e.stopPropagation(); if (S.wipe && S.wipe.id === s.id) wipe(null); S.stills = S.stills.filter(x => x !== s); strip(); } }, '✕')))); }
  }
  function build() {
    if (!S.dock) return; const L = target(); S.clip = L; S.dock.innerHTML = '';
    const vsel = el('div', { class: 'seg cp-view' }, ...[['prim', 'Primaries'], ['curves', 'Curves'], ['sec', 'Secondary']].map(([k, n]) => el('button', { class: S.view === k ? 'on' : '', onclick: () => { S.view = k; build(); } }, n)));
    const head = el('div', { class: 'phead' }, vsel, el('span', { class: 'dim' }, L ? L.name : 'No clip under the playhead'), el('div', { class: 'spacer' }),
      el('button', { class: 'ibtn', title: 'Grab the viewer as a still to compare against', onclick: grabStill }, Icon('image', 14), 'Grab still'));
    S.dock.append(el('div', { class: 'cp-strip' }), head); strip();
    if (!L) { S.dock.append(el('div', { class: 'cp-empty dim' }, 'Select a clip in the strip above or move the playhead over one.')); return; }
    if (S.view === 'curves') {
      const c = curvesOf(L) || newFx('curves'); S.pending = { L, f: c };
      const ed = Curves.editor(c, () => live(), () => { attach(); commit(); strip(); });
      head.append(el('button', { class: 'ibtn' + (c.on ? '' : ' on'), onclick: () => { attach(); c.on = !c.on; commit(); requestRender(); build(); } }, c.on ? 'Bypass' : 'Bypassed'));
      S.dock.append(el('div', { class: 'cp-body cp-curves' }, ed.el)); S.redrawCurves = ed.redraw; return;
    }
    if (S.view === 'sec') {
      const q = L.fx.find(x => x.type === 'secondary') || newFx('secondary'); S.pending = { L, f: q };
      head.append(el('button', { class: 'ibtn' + (S.picking ? ' on' : ''), title: 'Click a colour in the viewer to select it', onclick: () => { S.picking = !S.picking; document.body.classList.toggle('cp-picking', S.picking); build(); } }, Icon('color', 14), S.picking ? 'Click the viewer…' : 'Pick colour'),
        el('button', { class: 'ibtn' + (q.p.view === 'Matte' ? ' on' : ''), title: 'Show the selection in black and white', onclick: () => { q.p.view = q.p.view === 'Matte' ? 'Result' : 'Matte'; live(L); done(L); build(); } }, 'Show matte'),
        el('button', { class: 'ibtn' + (q.on ? '' : ' on'), onclick: () => { attach(); q.on = !q.on; commit(); requestRender(); build(); } }, q.on ? 'Bypass' : 'Bypassed'),
        el('button', { class: 'ibtn', onclick: () => { attach(); Object.assign(q.p, newFx('secondary').p); commit(); requestRender(); build(); } }, 'Reset'));
      const col = (t, ...k) => el('div', { class: 'sec-col' }, el('h5', {}, t), ...k);
      S.dock.append(el('div', { class: 'cp-body cp-sec' },
        col('Qualifier', slider(L, q, 'hue', 'Hue', 0, 360, '°'), slider(L, q, 'hw', 'Width', 0, 360, '°'), slider(L, q, 'hs', 'Softness', 0, 90, '°'), slider(L, q, 'slo', 'Sat low', 0, 100, '%'), slider(L, q, 'shi', 'Sat high', 0, 100, '%'), slider(L, q, 'llo', 'Luma low', 0, 100, '%'), slider(L, q, 'lhi', 'Luma high', 0, 100, '%')),
        col('Window', choice(L, q, 'wm', 'Shape', Secondary.WM), slider(L, q, 'wx', 'Centre X', 0, 100, '%'), slider(L, q, 'wy', 'Centre Y', 0, 100, '%'), slider(L, q, 'ww', 'Width', 1, 200, '%'), slider(L, q, 'wh', 'Height', 1, 200, '%'), slider(L, q, 'wsf', 'Softness', 0, 100, '%'), choice(L, q, 'winv', 'Grade', Secondary.WI)),
        col('Adjust the selection', slider(L, q, 'ah', 'Hue shift', -180, 180, '°'), slider(L, q, 'as', 'Saturation', 0, 200, '%'), slider(L, q, 'ae', 'Exposure', -300, 300, ''),
          el('div', { class: 'cp-tip dim' }, 'Pick a colour (or set a hue band), check it with Show matte, then shift it. Add a window to keep it to one area, e.g. Ellipse + Outside + Exposure −60 for a vignette.'))));
      return;
    }
    const f = gradeOf(L) || newFx('primaries'); S.pending = { L, f };
    const by = el('button', { class: 'ibtn' + (f.on ? '' : ' on'), title: 'Bypass the grade on this clip', onclick: () => { attach(); f.on = !f.on; commit(); requestRender(); build(); } }, f.on ? 'Bypass' : 'Bypassed');
    head.append(
      el('button', { class: 'ibtn', title: 'White balance and levels from the current frame', onclick: () => { const r = autoBalance(L); if (r) toast(`Auto balance: luma range ${r.range[0]}–${r.range[1]} %, offset R ${r.offset[0]} G ${r.offset[1]} B ${r.offset[2]}`); } }, Icon('ai', 14), 'Auto'),
      el('button', { class: 'ibtn', title: 'Copy this grade', onclick: () => { S.copied = JSON.parse(JSON.stringify(f.p)); toast('Grade copied'); } }, 'Copy'),
      el('button', { class: 'ibtn', disabled: S.copied ? undefined : '', title: 'Paste the copied grade onto this clip', onclick: () => { Object.assign(ensureGrade(L).p, S.copied); commit(); requestRender(); build(); toast('Grade pasted'); } }, 'Paste'),
      el('button', { class: 'ibtn', title: 'Put this grade on every picture clip', onclick: () => { const all = clips().filter(c => c !== L); all.forEach(c => { const g = ensureGrade(c); Object.assign(g.p, JSON.parse(JSON.stringify(f.p))); g.on = true; }); commit(); requestRender(); build(); toast(`Grade applied to ${all.length} more clip${all.length === 1 ? '' : 's'}`); } }, 'Apply to all'),
      by, el('button', { class: 'ibtn', title: 'Reset every wheel and slider', onclick: () => { attach(); Object.assign(f.p, newFx('primaries').p); commit(); requestRender(); build(); } }, 'Reset'));
    const wheels = el('div', { class: 'cp-wheels' }, ...WHEELS.map(([k, n, s]) => wheel(k, n, s, f, L)));
    const side = el('div', { class: 'cp-side' }, slider(L, f, 'con', 'Contrast', 0, 200, '%'), slider(L, f, 'sat', 'Saturation', 0, 200, '%'), slider(L, f, 'temp', 'Temperature', -100, 100), slider(L, f, 'tint', 'Tint', -100, 100),
      el('div', { class: 'cp-tip dim' }, 'Shift-drag a wheel for fine control. Double-click any control to reset it.'));
    S.dock.append(el('div', { class: 'cp-body' }, wheels, side));
  }
  function set(on) {
    if (on === S.on) { if (on) build(); return; }
    S.on = on; document.body.classList.toggle('color-page', on);
    const host = $$('colorScopes'), sc = () => document.querySelector('.scopes');
    if (on) {
      if (!S.dock) { S.dock = el('section', { id: 'colorDock' }); $$('tl').after(S.dock); }
      S.prevScopes = Scopes.S.on; Scopes.toggle(true); const p = sc(); if (p && host) { host.append(p); p.classList.add('docked'); }
      if (Scopes.S.mode === 'histogram') Scopes.S.mode = 'parade';
      build();
    } else {
      const p = sc(); if (p) { p.classList.remove('docked'); $$('stageWrap').append(p); } Scopes.toggle(S.prevScopes);
      if (S.wipe) wipe(null); S.picking = false; document.body.classList.remove('cp-picking');
    }
    requestAnimationFrame(() => { resizeOverlay(); fitView(); });
  }
  // follow the playhead and selection while the page is open
  let lastKey = '';
  setInterval(() => { if (!S.on) return; const L = target(), k = (L ? L.id : '') + '|' + P.layers.length; if (k !== lastKey) { lastKey = k; build(); } }, 250);
  return { S, set, build, target, gradeOf, curvesOf, autoBalance, toRGB, toXY, isGraded, grabStill, wipe, pickAt };
})();
