'use strict';
/* ====================== NEXORA Motion ======================
   A library of compositions edited with the shared compositor/timeline. Entering Motion swaps the live editing
   context (P, playhead, selection, undo history, view) to the active composition; leaving restores the Edit
   timeline. Compositions are placed into Edit as *linked* comp layers (compRef), so changes show up live.
   Also provides: per-character text animators, animated background generators and logo / title templates. */
const Motion = (() => {
  const S = { comps: {}, order: [], active: null, ctxs: {}, editCtx: null, inMotion: false, mounted: false };
  const $$ = id => document.getElementById(id);

  /* ---------- composition store ---------- */
  function newComp(o) {
    o = o || {};
    return { id: uid(), name: o.name || 'Comp ' + (S.order.length + 1), w: o.w || 1920, h: o.h || 1080, fps: o.fps || 30, dur: o.dur || 6, bg: o.bg || '#05050a', layers: [], markers: [], motionBlur: { on: true, shutter: 180, samples: 8 }, motion: true };
  }
  function addComp(c) { S.comps[c.id] = c; if (!S.order.includes(c.id)) S.order.push(c.id); return c; }
  /** the live object for a comp (the swapped-in P while it is being edited) */
  function getComp(id) { if (S.inMotion && S.active === id) return P; return S.comps[id] || null; }
  const list = () => S.order.map(getComp).filter(Boolean);

  /* ---------- editing contexts ---------- */
  function capture() { return { P, T, selId, hist: { stack: hist.stack, i: hist.i }, view: { zoom, panX, panY, userZoomed } }; }
  function apply(c) {
    exitAllComps(); pause();
    P = c.P; T = clamp(c.T || 0, 0, P.dur); selId = c.selId || null; hist.stack = c.hist.stack; hist.i = c.hist.i;
    if (!P.motionBlur) P.motionBlur = { on: false, shutter: 180, samples: 8 };
    structChanged(); if (c.view && c.view.userZoomed) { zoom = c.view.zoom; panX = c.view.panX; panY = c.view.panY; userZoomed = true; applyView(); } else requestAnimationFrame(fitView);
    if (!hist.stack.length) commit(); uiHistory();
  }
  function writeBack() { if (!S.inMotion || !S.active) return; if (!P.id) P.id = S.active; S.comps[S.active] = P; S.ctxs[S.active] = capture(); }
  function freshCtx(c) { return { P: c, T: 0, selId: null, hist: { stack: [], i: -1 } }; }
  function enter(id) {
    if (!S.order.length) addComp(newComp({ name: 'Main comp' }));
    if (!S.inMotion) { S.editCtx = capture(); S.inMotion = true; }
    else writeBack();
    S.active = id && S.comps[id] ? id : (S.active && S.comps[S.active] ? S.active : S.order[0]);
    apply(S.ctxs[S.active] || freshCtx(S.comps[S.active])); refreshBar();
  }
  function leave() { if (!S.inMotion) return; writeBack(); S.inMotion = false; apply(S.editCtx); S.editCtx = null; refreshBar(); }
  function switchTo(id) { if (!S.comps[id]) return; if (S.inMotion) enter(id); else { S.active = id; } }
  function onRestore() { if (S.inMotion && S.active) { if (!P.id) P.id = S.active; S.comps[S.active] = P; } }
  /** the Edit timeline object, wherever it currently lives */
  const editProject = () => S.inMotion && S.editCtx ? S.editCtx.P : P;
  function open(id) { Shell.go('motion'); switchTo(id); }

  /* ---------- library operations ---------- */
  function createComp(o, build) { const c = addComp(newComp(o)); if (!S.inMotion) Shell.go('motion'); enter(c.id); if (build) { build(c); commit(); structChanged(); } refreshBar(); return c; }
  function duplicateComp() { writeBack(); const src = getComp(S.active), d = JSON.parse(ser(src)); d.id = uid(); d.name = src.name + ' copy'; d.layers.forEach(l => l.id = uid()); restorePaint(d); addComp(d); enter(d.id); }
  function deleteComp(id) {
    const used = usage()[id] || 0; if (used) return toast(`"${getComp(id).name}" is used ${used}× (in Edit or other comps). Remove those layers first.`);
    if (S.order.length === 1) return toast('Keep at least one composition.'); if (!confirm(`Delete composition "${getComp(id).name}"?`)) return;
    const wasActive = id === S.active; S.order = S.order.filter(x => x !== id); delete S.comps[id]; delete S.ctxs[id];
    if (wasActive && S.inMotion) { S.active = S.order[0]; apply(S.ctxs[S.active] || freshCtx(S.comps[S.active])); } refreshBar();
  }
  function usage() { const n = {}, walk = ls => ls.forEach(l => { if (l.compRef) n[l.compRef] = (n[l.compRef] || 0) + 1; if (l.comp) walk(l.comp.layers); }); walk(editProject().layers); list().forEach(c => walk(c.layers)); return n; }
  function settingsDialog() {
    const c = P, o = { name: c.name, w: c.w, h: c.h, fps: c.fps, dur: c.dur, bg: c.bg === 'transparent' ? '#000000' : c.bg, transparent: c.bg === 'transparent' }, mb = c.motionBlur;
    const presets = { '1920×1080': [1920, 1080], '1280×720': [1280, 720], '3840×2160': [3840, 2160], '1080×1920 (vertical)': [1080, 1920], '1080×1080': [1080, 1080] };
    const ps = el('select', { onchange: e => { const v = presets[e.target.value]; if (v) { o.w = v[0]; o.h = v[1]; W.value = o.w; H.value = o.h; } } }, el('option', {}, 'Preset…'), Object.keys(presets).map(k => el('option', { value: k }, k)));
    const W = el('input', { type: 'number', value: o.w, style: 'width:80px', oninput: e => o.w = +e.target.value }), H = el('input', { type: 'number', value: o.h, style: 'width:80px', oninput: e => o.h = +e.target.value });
    showModal('Composition settings', el('div', {}, field('Name', o, 'name', 'text'), el('div', { class: 'frow' }, el('label', {}, 'Preset'), ps), el('div', { class: 'frow' }, el('label', {}, 'Size'), W, '×', H),
      field('Frame rate', o, 'fps', 'select', { opts: [24, 25, 30, 50, 60] }), field('Duration (s)', o, 'dur', 'num', { min: .5, max: 600, step: .5 }), field('Background', o, 'bg', 'color'), field('Transparent', o, 'transparent', 'check'),
      el('h4', {}, 'Motion blur'), field('Enabled', mb, 'on', 'check'), field('Shutter angle', mb, 'shutter', 'num', { min: 1, max: 720 }), field('Samples', mb, 'samples', 'num', { min: 2, max: 32 })),
      [['Cancel', closeModal], ['Apply', () => { closeModal(); c.name = o.name || c.name; c.fps = +o.fps; c.dur = Math.max(.5, +o.dur); c.bg = o.transparent ? 'transparent' : o.bg; if (o.w !== c.w || o.h !== c.h) setProjectSize(o.w, o.h); commit(); structChanged(); applyView(); refreshBar(); }, true]]);
  }
  function placeInEdit(id) {
    id = id || S.active; writeBack(); const c = getComp(id); Shell.go('edit');
    const L = mkLayer('comp', { name: c.name, compRef: id, start: T, dur: c.dur }); delete L.comp; L.tr.s = +(Math.min(P.w / c.w, P.h / c.h) * 100).toFixed(2);
    addLayer(L); commit(); toast('Placed as a linked composition — edits in NEXORA Motion update it.');
  }

  /* ---------- motion bar ---------- */
  function mount() {
    if (S.mounted) return; S.mounted = true;
    const bar = el('div', { id: 'motionBar', class: 'wsrow hidden' }); $$('ws-edit').prepend(bar);
  }
  function refreshBar() {
    mount(); const bar = $$('motionBar'); bar.classList.toggle('hidden', !S.inMotion); if (!S.inMotion) return; bar.innerHTML = '';
    const sel = el('select', { style: 'min-width:180px', onchange: e => enter(e.target.value) }, list().map(c => el('option', { value: c.id, selected: c.id === S.active ? '' : undefined }, c.name)));
    const ib = (icon, label, title, fn, cls) => el('button', { class: 'ibtn' + (label ? '' : ' only') + (cls ? ' ' + cls : ''), title, onclick: fn }, Icon(icon, 15), label || '');
    bar.append(el('span', { class: 'dim' }, 'Composition'), sel,
      ib('plus', 'New', 'New composition', () => createComp()), ib('duplicate', '', 'Duplicate composition', duplicateComp), ib('settings', 'Settings', 'Composition settings', settingsDialog), ib('trash', '', 'Delete composition', () => deleteComp(S.active)),
      el('button', { 'data-pop': '1', class: 'ibtn', onclick: e => PopMenu.at(e.currentTarget, TEMPLATES.map(t => ({ label: t.name, run: () => createComp({ name: t.name, dur: t.dur }, t.build) }))) }, Icon('templates', 15), 'Templates'),
      el('button', { 'data-pop': '1', class: 'ibtn', onclick: e => PopMenu.at(e.currentTarget, Object.keys(GEN).map(k => ({ label: GEN[k], run: () => { const L = mkLayer('gen', { start: 0, dur: P.dur, name: GEN[k] }); L.gen.kind = k; P.layers.unshift(L); selId = L.id; commit(); structChanged(); } }))) }, Icon('layers', 15), 'Background'),
      el('div', { class: 'spacer' }), el('span', { class: 'dim' }, `${P.w}×${P.h} · ${P.fps} fps · ${(+P.dur).toFixed(1)} s · motion blur ${P.motionBlur && P.motionBlur.on ? 'on' : 'off'}`),
      ib('export', 'Render', 'Render this composition to video', () => exportDialog()), ib('edit', 'Add to timeline', 'Place this composition on the Edit timeline (linked)', () => placeInEdit(), 'primary'));
  }

  /* ---------- per-character text animators ---------- */
  const ease = { out: EASE.out, inout: EASE.inout, back: EASE.back, linear: EASE.linear };
  const mctx = mkCanvas(1, 1).getContext('2d');
  function animText(L, t) {
    const X = L.text, A = X.anim, lt = t - L.start, key = JSON.stringify(X) + '|' + Math.round(lt * 120);
    if (L._tc && L._tc.key === key) return L._tc.v;
    const font = `${X.italic ? 'italic ' : ''}${X.weight} ${X.size}px "${X.font}", sans-serif`, set = c => { c.font = font; if ('letterSpacing' in c) c.letterSpacing = X.spacing + 'px'; c.textBaseline = 'middle'; c.lineJoin = 'round'; };
    set(mctx); const lines = X.str.split('\n'), widths = lines.map(l => mctx.measureText(l).width), lh = X.size * X.lineH;
    const pad = Math.ceil(X.size * .9 + X.strokeW * 2 + (X.shadow ? X.shBlur + Math.abs(X.shX) + Math.abs(X.shY) : 0) + (X.bgOn ? X.bgPad : 0));
    const W = Math.min(4096, Math.ceil(Math.max(X.size * .5, ...widths)) + pad * 2), H = Math.min(4096, Math.ceil(lines.length * lh) + pad * 2);
    const cv = L._tcv && L._tcv.width === W && L._tcv.height === H ? L._tcv : (L._tcv = mkCanvas(W, H)), c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); set(c);
    if (X.bgOn) { c.fillStyle = X.bg; c.beginPath(); const bx = pad - X.bgPad, by = pad - X.bgPad; c.roundRect(bx, by, W - bx * 2, H - by * 2, X.bgPad * .6); c.fill(); }
    // split into units with positions
    const units = [];
    lines.forEach((ln, li) => {
      const x0 = X.align === 'left' ? pad : X.align === 'right' ? W - pad - widths[li] : (W - widths[li]) / 2, y = pad + lh * (li + .5);
      const parts = A.by === 'line' ? [ln] : A.by === 'word' ? ln.split(/(?<= )/) : [...ln];
      let off = 0; for (const s of parts) { const w = mctx.measureText(s).width, wPre = mctx.measureText(ln.slice(0, off)).width; units.push({ s, x: x0 + wPre, w, y, lineCx: x0 + widths[li] / 2 }); off += s.length; }
    });
    const N = units.length, E = ease[A.ease] || ease.out, outStart = L.dur - (A.dur + Math.max(0, N - 1) * A.stagger);
    units.forEach((u, i) => {
      if (!u.s.trim()) return;
      let p = clamp((lt - i * A.stagger) / A.dur, 0, 1);
      if (A.out && lt > outStart) p = Math.min(p, 1 - clamp((lt - outStart - i * A.stagger) / A.dur, 0, 1));
      const e = A.preset === 'pop' ? EASE.back(p) : E(p); let alpha = 1, dx = 0, dy = 0, rot = 0, sc = 1, blur = 0;
      switch (A.preset) {
        case 'fade': alpha = e; break;
        case 'typewriter': alpha = p > 0 ? 1 : 0; break;
        case 'slide-up': alpha = e; dy = (1 - e) * X.size * .8; break;
        case 'slide-down': alpha = e; dy = -(1 - e) * X.size * .8; break;
        case 'pop': sc = Math.max(0, e); alpha = Math.min(1, p * 3); break;
        case 'rotate': alpha = e; rot = (1 - e) * -Math.PI / 2; dy = (1 - e) * X.size * .3; break;
        case 'blur': alpha = e; blur = (1 - e) * X.size * .3; break;
        case 'tracking': alpha = e; dx = (u.x + u.w / 2 - u.lineCx) * (1 - e) * .8; break;
        case 'wave': alpha = e; dy = Math.sin(lt * 4 - i * .45) * X.size * .12; break;
        case 'flicker': alpha = p >= 1 ? 1 : mulberry(i * 31 + Math.floor(lt * 24))() > .45 ? 1 : .12; if (p <= 0) alpha = 0; break;
      }
      if (alpha <= .002) return;
      c.save(); c.globalAlpha = alpha; c.translate(u.x + u.w / 2 + dx, u.y + dy); c.rotate(rot); c.scale(sc, sc); if (blur > .3) c.filter = `blur(${blur}px)`;
      if (X.shadow) { c.shadowColor = X.shColor; c.shadowBlur = X.shBlur; c.shadowOffsetX = X.shX; c.shadowOffsetY = X.shY; }
      if (X.strokeW > 0) { c.lineWidth = X.strokeW * 2; c.strokeStyle = X.stroke; c.strokeText(u.s, -u.w / 2, 0); c.shadowColor = 'transparent'; }
      c.fillStyle = X.color; c.fillText(u.s, -u.w / 2, 0); c.restore();
    });
    const v = { src: cv, w: W, h: H }; L._tc = { key, v }; return v;
  }

  /* ---------- animated background generators ---------- */
  const GEN = { aurora: 'Aurora glow', grid: 'Retro grid (synthwave)', waves: 'Layered waves', bokeh: 'Bokeh lights', sweep: 'Gradient sweep', stripes: 'Moving stripes' };
  function genCanvas(L, t, W, H) {
    const g = L.gen, lt = (t - L.start) * g.speed, k = g.scale;
    const cv = L._gc && L._gc.width === W && L._gc.height === H ? L._gc : (L._gc = mkCanvas(W, H)), c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.filter = 'none';
    c.clearRect(0, 0, W, H); c.fillStyle = g.c3; c.fillRect(0, 0, W, H); const D = Math.hypot(W, H);
    switch (g.kind) {
      case 'aurora': c.globalCompositeOperation = 'lighter'; for (let i = 0; i < 5; i++) { const x = W * (.5 + .38 * Math.sin(lt * .31 * (1 + i * .17) + i * 2.1)), y = H * (.5 + .35 * Math.cos(lt * .23 * (1 + i * .11) + i * 1.3)), r = D * .32 * k * (.8 + .3 * Math.sin(lt * .5 + i)); const gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(i % 2 ? g.c1 : g.c2, .55)); gr.addColorStop(1, rgba(i % 2 ? g.c1 : g.c2, 0)); c.fillStyle = gr; c.fillRect(0, 0, W, H); } break;
      case 'grid': {
        const hz = H * .56, sky = c.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, g.c3); sky.addColorStop(1, rgba(g.c1, .9)); c.fillStyle = sky; c.fillRect(0, 0, W, hz);
        const R = Math.min(W, H) * .22 * k, sun = c.createLinearGradient(0, hz - R * 2, 0, hz); sun.addColorStop(0, g.c2); sun.addColorStop(1, g.c1); c.fillStyle = sun; c.beginPath(); c.arc(W / 2, hz - R * .35, R, 0, Math.PI * 2); c.fill();
        c.fillStyle = g.c3; for (let i = 0; i < 6; i++) c.fillRect(W / 2 - R, hz - R * .35 + i * R * .16, R * 2, R * .05 + i * 1.2);
        c.fillStyle = g.c3; c.fillRect(0, hz, W, H - hz); c.strokeStyle = g.c2; c.lineWidth = 2; c.shadowColor = g.c2; c.shadowBlur = 10;
        for (let i = -20; i <= 20; i++) { c.beginPath(); c.moveTo(W / 2 + i * 6, hz); c.lineTo(W / 2 + i * W * .12 * k, H); c.stroke(); }
        for (let i = 0; i < 18; i++) { const z = ((i + (lt * .8) % 1) / 18), y = hz + (H - hz) * z * z; c.globalAlpha = Math.min(1, z * 2); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); } break;
      }
      case 'waves': for (let b = 0; b < 6; b++) { c.globalAlpha = .28; c.fillStyle = b % 2 ? g.c1 : g.c2; c.beginPath(); c.moveTo(0, H); const base = H * (.35 + b * .1), amp = H * .06 * k, f = (2 + b * .6) / W * Math.PI; for (let x = 0; x <= W; x += 8) c.lineTo(x, base + Math.sin(x * f + lt * (1 + b * .3) + b) * amp); c.lineTo(W, H); c.fill(); } break;
      case 'bokeh': for (let i = 0; i < 46; i++) { const r = mulberry(i * 97 + 3), x = (r() * W + Math.sin(lt * .2 + i) * 60 * k + lt * 12 * (r() - .5)) % W, y = (r() * H + Math.cos(lt * .17 + i) * 50 * k) % H, s = (20 + r() * 90) * k, col = r() > .5 ? g.c1 : g.c2, gr = c.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, rgba(col, .05 + r() * .35)); gr.addColorStop(.8, rgba(col, .12)); gr.addColorStop(1, rgba(col, 0)); c.fillStyle = gr; c.beginPath(); c.arc((x + W) % W, (y + H) % H, s, 0, Math.PI * 2); c.fill(); } break;
      case 'sweep': { const gr = c.createConicGradient(lt * .6, W / 2, H / 2); gr.addColorStop(0, g.c1); gr.addColorStop(.33, g.c2); gr.addColorStop(.66, g.c3); gr.addColorStop(1, g.c1); c.fillStyle = gr; c.fillRect(0, 0, W, H); const v = c.createRadialGradient(W / 2, H / 2, D * .1, W / 2, H / 2, D * .6); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, rgba(g.c3, .85)); c.fillStyle = v; c.fillRect(0, 0, W, H); break; }
      case 'stripes': { c.save(); c.translate(W / 2, H / 2); c.rotate(-Math.PI / 6); const sw = 60 * k, off = (lt * 80 * k) % (sw * 2); for (let x = -D; x < D; x += sw * 2) { c.fillStyle = g.c1; c.fillRect(x + off, -D, sw, D * 2); c.fillStyle = g.c2; c.fillRect(x + off + sw, -D, sw, D * 2); } c.restore(); break; }
    }
    c.globalAlpha = 1; c.shadowColor = 'transparent'; c.globalCompositeOperation = 'source-over'; return { src: cv, w: W, h: H };
  }

  /* ---------- logo animation & title-sequence templates (built from real keyframed layers) ---------- */
  const K = (L, key, pts) => { L.kf[key] = pts.map(([t, v, e]) => ({ t, v, e: e ? 'bezier' : 'linear', b: e || undefined })); L.open = true; };
  const txt = (str, o) => { const L = mkLayer('text', Object.assign({ name: str.split('\n')[0].slice(0, 24), start: 0, dur: P.dur }, o.layer || {})); Object.assign(L.text, { str, font: 'Segoe UI', weight: '900', size: 120 }, o.text || {}); if (o.anim) L.text.anim = Object.assign({ preset: 'fade', by: 'char', stagger: .04, dur: .5, out: false, ease: 'out' }, o.anim); return L; };
  const add = L => { P.layers.push(L); return L; };
  const bg = (kind, o) => { const L = mkLayer('gen', { start: 0, dur: P.dur, name: GEN[kind] }); Object.assign(L.gen, { kind }, o || {}); return add(L); };
  const TEMPLATES = [
    { name: 'Logo reveal — stroke draw-on', dur: 5, build() {
      bg('aurora', { c1: '#5cb8ff', c2: '#3b9bff', c3: '#05050a', speed: .6 });
      const out = add(mkLayer('shape', { name: 'Logo outline', start: 0, dur: P.dur })); Object.assign(out.shape, { kind: 'polygon', points: 6, w: 360, h: 400, fillOn: false, stroke: '#ffffff', strokeW: 10 }); out.tr.y = P.h * .42; out.mblur = true;
      K(out, 'trimE', [[0, 0, BEZ.easy], [1.4, 100]]); K(out, 'rot', [[0, -90, BEZ.snap], [1.4, 0]]);
      const fill = add(mkLayer('shape', { name: 'Logo fill', start: 0, dur: P.dur })); Object.assign(fill.shape, { kind: 'polygon', points: 6, w: 340, h: 380, grad: true, fill: '#5cb8ff', fill2: '#3b9bff', angle: 120 }); fill.tr.y = P.h * .42; fill.mblur = true;
      K(fill, 's', [[1.1, 0, BEZ.overshoot], [1.7, 100]]); K(fill, 'op', [[1.1, 0], [1.4, 100]]); const gf = newFx('glow'); gf.p.radius = 30; gf.p.amount = 80; fill.fx.push(gf);
      const mk = add(txt('NX', { text: { size: 170 } })); mk.tr.y = P.h * .42; K(mk, 's', [[1.4, 40, BEZ.overshoot], [1.9, 100]]); K(mk, 'op', [[1.4, 0], [1.7, 100]]); mk.mblur = true;
      const name = add(txt('NEXORA STUDIO', { text: { size: 64, weight: '800', spacing: 18 }, anim: { preset: 'tracking', stagger: .03, dur: .7 }, layer: { start: 1.8, dur: P.dur - 1.8 } })); name.tr.y = P.h * .75;
    } },
    { name: 'Cinematic title', dur: 6, build() {
      const b = bg('sweep', { c1: '#06122b', c2: '#0b2447', c3: '#030306', speed: .15 });
      const t = add(txt('THE LAST SIGNAL', { text: { size: 130, weight: '800', spacing: 10, shadow: true, shBlur: 30, shColor: '#3b9bff', shY: 0 }, anim: { preset: 'blur', stagger: .06, dur: .9, out: true } })); t.tr.y = P.h * .46; K(t, 's', [[0, 96], [P.dur, 106]]);
      add(txt('a NEXORA original', { text: { size: 40, weight: '400', spacing: 30, color: '#cfe9ff' }, anim: { preset: 'fade', by: 'word', stagger: .15, dur: .8, out: true }, layer: { start: 1.6, dur: P.dur - 1.6 } })).tr.y = P.h * .62;
      const adj = add(mkLayer('adjust', { name: 'Cinema bars + grain', start: 0, dur: P.dur })); [['letterbox', { amount: 11 }], ['grain', { amount: 18 }], ['vignette', { amount: 55, size: 45 }]].forEach(([k, p]) => { const f = newFx(k); Object.assign(f.p, p); adj.fx.push(f); });
    } },
    { name: 'Kinetic typography', dur: 6, build() {
      bg('stripes', { c1: '#0b0b14', c2: '#101022', c3: '#05050a', speed: .5 });
      [['MAKE', '#ffffff', .2], ['IT', '#3b9bff', .9], ['MOVE.', '#5cb8ff', 1.6]].forEach(([w, col, st], i) => { const L = add(txt(w, { text: { size: 200, color: col, weight: '900' }, anim: { preset: 'slide-up', stagger: .05, dur: .45, ease: 'back' }, layer: { start: st, dur: P.dur - st } })); L.tr.y = P.h * (.3 + i * .22); L.mblur = true; K(L, 'x', [[0, P.w / 2 - 40], [P.dur - st, P.w / 2 + 40]]); });
    } },
    { name: 'Lower third', dur: 5, build() {
      P.bg = 'transparent';
      const bar = add(mkLayer('shape', { name: 'Bar', start: 0, dur: P.dur })); Object.assign(bar.shape, { kind: 'rect', w: 760, h: 120, radius: 14, grad: true, fill: '#5cb8ff', fill2: '#3b9bff', angle: 0 }); bar.tr.x = 120 + 380; bar.tr.y = P.h * .8; K(bar, 'sx', [[0, 0, BEZ.snap], [.6, 100]]); K(bar, 'op', [[P.dur - .5, 100], [P.dur, 0]]); bar.mblur = true;
      const n = add(txt('ALEX MORGAN', { text: { size: 54, weight: '800', align: 'left' }, anim: { preset: 'slide-up', stagger: .02, dur: .35 }, layer: { start: .4, dur: P.dur - .4 } })); n.tr.x = 330; n.tr.y = P.h * .8 - 18;
      const r = add(txt('Creative Director · NEXORA', { text: { size: 30, weight: '600', align: 'left', color: '#e6e1ff' }, anim: { preset: 'fade', by: 'word', stagger: .08, dur: .4 }, layer: { start: .8, dur: P.dur - .8 } })); r.tr.x = 330; r.tr.y = P.h * .8 + 30;
    } },
    { name: 'Glitch intro', dur: 4, build() {
      bg('grid', { c1: '#0b2a4a', c2: '#3b9bff', c3: '#02060d', speed: 1 });
      const t = add(txt('GAME ON', { text: { size: 190, weight: '900', strokeW: 4, stroke: '#000000' }, anim: { preset: 'flicker', stagger: .05, dur: .6 } })); t.tr.y = P.h * .42; [['rgbsplit', { amount: 8 }], ['glitch', { amount: 45, rate: 12 }]].forEach(([k, p]) => { const f = newFx(k); Object.assign(f.p, p); t.fx.push(f); }); K(t, 's', [[0, 130, BEZ.snap], [.5, 100]]); t.mblur = true;
    } },
    { name: '3D flip title', dur: 4, build() {
      bg('bokeh', { c1: '#5cb8ff', c2: '#3b9bff', c3: '#06060c', speed: .5 });
      const t = add(txt('LEVEL UP', { text: { size: 170, weight: '900', shadow: true, shBlur: 24, shColor: '#000000' } })); t.tr.y = P.h * .48; t.mblur = true; K(t, 'rx', [[0, -85, BEZ.overshoot], [.9, 0]]); K(t, 'op', [[0, 0], [.25, 100]]); K(t, 'ry', [[1.2, 0, BEZ.easy], [P.dur, 12]]);
    } },
    /* ---- gaming overlays (transparent unless noted): ordinary layers + keyframes, fully editable ---- */
    { name: 'Facecam frame', cat: 'gaming', desc: 'Neon webcam border with LIVE badge', dur: 10, build() {
      P.bg = 'transparent'; const W = 520, H = 300, cx = P.w - W / 2 - 60, cy = P.h - H / 2 - 60;
      const fr = add(mkLayer('shape', { name: 'Frame', start: 0, dur: P.dur })); Object.assign(fr.shape, { kind: 'rect', w: W, h: H, radius: 18, fillOn: false, stroke: '#5cb8ff', strokeW: 8 }); fr.tr.x = cx; fr.tr.y = cy; const gl = newFx('glow'); gl.p.radius = 18; gl.p.amount = 120; fr.fx.push(gl); K(fr, 's', [[0, 80, BEZ.overshoot], [.5, 100]]); K(fr, 'op', [[0, 0], [.25, 100]]);
      const pill = add(mkLayer('shape', { name: 'LIVE badge', start: .3, dur: P.dur - .3 })); Object.assign(pill.shape, { kind: 'rect', w: 120, h: 44, radius: 22, fill: '#ff2d55' }); pill.tr.x = cx - W / 2 + 80; pill.tr.y = cy - H / 2; K(pill, 'op', [[0, 0], [.2, 100], [1, 100], [1.3, 60], [1.6, 100]]);
      const lt = add(txt('LIVE', { text: { size: 26, weight: '800', spacing: 4 }, layer: { start: .3, dur: P.dur - .3 } })); lt.tr.x = pill.tr.x; lt.tr.y = pill.tr.y;
    } },
    { name: 'Subscribe reminder', cat: 'gaming', desc: 'Slide-in subscribe pill, bottom left', dur: 5, build() {
      P.bg = 'transparent'; const y = P.h - 120;
      const b = add(mkLayer('shape', { name: 'Pill', start: 0, dur: P.dur })); Object.assign(b.shape, { kind: 'rect', w: 420, h: 86, radius: 43, grad: true, fill: '#ff2d55', fill2: '#5cb8ff', angle: 0 }); b.tr.y = y; K(b, 'x', [[0, -260, BEZ.snap], [.55, 290], [P.dur - .6, 290, BEZ.snap], [P.dur, -260]]); b.mblur = true;
      const t = add(txt('SUBSCRIBE', { text: { size: 40, weight: '900', spacing: 6 }, anim: { preset: 'slide-up', stagger: .03, dur: .35 }, layer: { start: .35, dur: P.dur - .95 } })); t.tr.y = y; t.tr.x = 290;
    } },
    { name: 'Kill feed callout', cat: 'gaming', desc: 'Top-right elimination banner', dur: 4, build() {
      P.bg = 'transparent'; const y = 110, x = P.w - 330;
      const b = add(mkLayer('shape', { name: 'Banner', start: 0, dur: P.dur })); Object.assign(b.shape, { kind: 'rect', w: 560, h: 64, radius: 8, fill: '#0b0b14' }); b.tr.y = y; b.tr.op = 85; K(b, 'x', [[0, P.w + 300, BEZ.snap], [.4, x], [P.dur - .5, x, BEZ.snap], [P.dur, P.w + 300]]);
      const acc = add(mkLayer('shape', { name: 'Accent', start: 0, dur: P.dur })); Object.assign(acc.shape, { kind: 'rect', w: 8, h: 64, fill: '#ff2d55' }); acc.tr.y = y; acc.parent = b.id; acc.tr.x = -276; acc.tr.y = 0;
      const t = add(txt('YOU  ✕  ENEMY', { text: { size: 30, weight: '800', spacing: 2 }, layer: { start: .35, dur: P.dur - .8 } })); t.parent = b.id; t.tr.x = 0; t.tr.y = 0;
    } },
    { name: 'Victory stinger', cat: 'gaming', desc: 'Full-screen VICTORY hit with confetti', dur: 3, build() {
      P.bg = 'transparent';
      const fl = add(mkLayer('shape', { name: 'Flash', start: 0, dur: .5 })); Object.assign(fl.shape, { kind: 'rect', w: P.w, h: P.h, fill: '#ffffff' }); fl.tr.x = P.w / 2; fl.tr.y = P.h / 2; K(fl, 'op', [[0, 80], [.5, 0]]);
      const t = add(txt('VICTORY', { text: { size: 220, weight: '900', spacing: 12, shadow: true, shBlur: 40, shColor: '#5cb8ff', shY: 0 } })); t.tr.y = P.h * .48; K(t, 's', [[0, 180, BEZ.overshoot], [.45, 100], [P.dur, 108]]); K(t, 'op', [[0, 0], [.12, 100], [P.dur - .3, 100], [P.dur, 0]]); t.mblur = true;
      const c = mkLayer('particles', { name: 'Confetti', start: .1, dur: P.dur - .1 }); Object.assign(c.part, { kind: 'confetti', c1: '#5cb8ff', c2: '#3b9bff', size: 16 }); add(c);
    } },
    { name: 'Stream starting soon', cat: 'gaming', desc: 'Looping full-screen starting screen', dur: 10, build() {
      bg('grid', { c1: '#0b2a4a', c2: '#3b9bff', c3: '#02060d', speed: .6 });
      const t = add(txt('STARTING SOON', { text: { size: 130, weight: '900', spacing: 14 }, anim: { preset: 'blur', stagger: .05, dur: .8 } })); t.tr.y = P.h * .45; K(t, 's', [[0, 100], [P.dur / 2, 104], [P.dur, 100]]);
      const s = add(txt('grab a drink — we go live in a moment', { text: { size: 34, weight: '400', spacing: 6, color: '#cfe9ff' }, anim: { preset: 'fade', by: 'word', stagger: .12, dur: .6 }, layer: { start: 1, dur: P.dur - 1 } })); s.tr.y = P.h * .6;
    } },
    { name: 'Clip title card', cat: 'gaming', desc: 'Punchy highlight title with glitch', dur: 2.5, build() {
      P.bg = 'transparent';
      const bar = add(mkLayer('shape', { name: 'Slash', start: 0, dur: P.dur })); Object.assign(bar.shape, { kind: 'rect', w: P.w * 1.2, h: 170, grad: true, fill: '#5cb8ff', fill2: '#3b9bff', angle: 0 }); bar.tr.x = P.w / 2; bar.tr.y = P.h / 2; bar.tr.rot = -6; K(bar, 'sx', [[0, 0, BEZ.snap], [.35, 100], [P.dur - .35, 100, BEZ.snap], [P.dur, 0]]);
      const t = add(txt('INSANE CLUTCH', { text: { size: 110, weight: '900', spacing: 4 }, layer: { start: .2, dur: P.dur - .5 } })); t.tr.y = P.h / 2; t.tr.rot = -6; [['rgbsplit', { amount: 6 }], ['glitch', { amount: 30, rate: 10 }]].forEach(([k, p]) => { const f = newFx(k); Object.assign(f.p, p); t.fx.push(f); });
    } },
    { name: 'Animated background loop', dur: 8, build() { bg('aurora', { c1: '#5cb8ff', c2: '#3b9bff', c3: '#04040a', speed: .8 }); bg('bokeh', { c1: '#ffffff', c2: '#5cb8ff', c3: 'rgba(0,0,0,0)', speed: .3 }).blend = 'screen'; } }
  ];

  /* ---------- serialization ---------- */
  function toJSON() { return { comps: list().map(c => projectData(c)), active: S.active }; }
  async function fromJSON(o) {
    reset(); if (!o || !Array.isArray(o.comps)) return;
    for (const c of o.comps) { c.markers = c.markers || []; c.motionBlur = c.motionBlur || { on: false, shutter: 180, samples: 8 }; await restorePaint(c); addComp(c); }
    S.active = o.active && S.comps[o.active] ? o.active : S.order[0] || null;
  }
  function reset() { if (S.inMotion) leave(); S.comps = {}; S.order = []; S.ctxs = {}; S.active = null; refreshBar(); }
  function thumb(c, size) {
    const k = size / Math.max(c.w, c.h), cv = mkCanvas(Math.max(1, Math.round(c.w * k)), Math.max(1, Math.round(c.h * k))), full = mkCanvas(c.w, c.h), x = full.getContext('2d');
    if (c.bg !== 'transparent') { x.fillStyle = c.bg; x.fillRect(0, 0, c.w, c.h); } renderLayers(x, Math.min(c.dur * .6, 2.5), c.layers, c); cv.getContext('2d').drawImage(full, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', .8);
  }
  return { S, newComp, addComp, getComp, list, enter, leave, switchTo, open, onRestore, editProject, createComp, deleteComp, duplicateComp, usage, placeInEdit, refreshBar, animText, genCanvas, GEN, TEMPLATES, toJSON, fromJSON, reset, thumb, settingsDialog };
})();
