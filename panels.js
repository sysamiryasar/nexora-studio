'use strict';
/* ====================== DOM helper ====================== */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) e[k] = attrs[k]; else if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]); }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Verdana', 'Trebuchet MS', 'Comic Sans MS', 'Tahoma', 'Palatino Linotype', 'Lucida Console', 'Candara', 'Calibri', 'Cambria', 'Bahnschrift', 'Helvetica', 'system-ui'];
const TRANS_NAMES = { none: 'None', fade: 'Fade', 'slide-left': 'Slide from left', 'slide-right': 'Slide from right', 'slide-up': 'Slide from top', 'slide-down': 'Slide from bottom', 'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out', pop: 'Pop', spin: 'Spin', blur: 'Blur', 'wipe-left': 'Wipe from left', 'wipe-right': 'Wipe from right', 'wipe-up': 'Wipe from top', 'wipe-down': 'Wipe from bottom' };
let CTL = [], leftTab = 'media', looksAdj = false, selMedia = null;

function uiProps() { CTL.forEach(f => f()); }
function uiSel() { buildInspector(); renderTimeline(); requestRender(); }

/* ====================== reusable controls ====================== */
function propRow(L, key, label, min, max, step, unit) {
  const lab = el('label', { title: label }, label);
  const rng = el('input', { type: 'range', min, max, step });
  const num = el('input', { type: 'number', step });
  const kb = el('button', { class: 'kfb', title: 'Animate this property (stopwatch)' }, '⏱');
  const kd = el('button', { class: 'kfd', title: 'Add / remove keyframe at playhead' }, '◆');
  const ref = () => {
    const v = valueAt(L, key, T - L.start), r = +(+v).toFixed(3); if (document.activeElement !== num) num.value = r; rng.value = r;
    const an = isAnimated(L, key); kb.classList.toggle('act', an); kd.classList.toggle('act', keyAtPlayhead(L, key)); kd.style.visibility = an ? 'visible' : 'hidden';
  };
  const set = v => { setProp(L, key, v); ref(); requestRender(); if (isAnimated(L, key)) uiTimelineLite(); };
  rng.oninput = () => set(+rng.value); rng.onchange = commit;
  num.oninput = () => { if (num.value !== '' && isFinite(+num.value)) set(+num.value); }; num.onchange = commit;
  kb.onclick = () => { toggleAnim(L, key); L.open = true; ref(); renderTimeline(); commit(); };
  kd.onclick = () => { toggleKeyHere(L, key); L.open = true; ref(); renderTimeline(); commit(); };
  CTL.push(ref); ref();
  return el('div', { class: 'prow' }, lab, rng, num, kb, kd);
}
function field(label, obj, key, kind, o = {}) {
  const row = el('div', { class: 'frow' }, el('label', {}, label)); let inp;
  const done = () => { requestRender(); if (o.cb) o.cb(); };
  if (kind === 'check') { inp = el('input', { type: 'checkbox' }); inp.checked = !!obj[key]; inp.onchange = () => { obj[key] = inp.checked; done(); commit(); if (o.rebuild) buildInspector(); }; }
  else if (kind === 'select') {
    inp = el('select', {}, (o.opts || []).map(v => el('option', { value: v }, o.names ? o.names(v) : v))); inp.value = obj[key];
    inp.onchange = () => { obj[key] = inp.value; done(); commit(); if (o.rebuild) buildInspector(); };
  } else if (kind === 'color') { inp = el('input', { type: 'color' }); inp.value = obj[key]; inp.oninput = () => { obj[key] = inp.value; done(); }; inp.onchange = commit; }
  else if (kind === 'num') { inp = el('input', { type: 'number', step: o.step || 1 }); if (o.min !== undefined) inp.min = o.min; if (o.max !== undefined) inp.max = o.max; inp.value = obj[key]; inp.oninput = () => { if (inp.value !== '' && isFinite(+inp.value)) { obj[key] = +inp.value; done(); } }; inp.onchange = commit; inp.style.maxWidth = '90px'; }
  else if (kind === 'area') { inp = el('textarea', { id: o.id }); inp.value = obj[key]; inp.oninput = () => { obj[key] = inp.value; done(); }; inp.onchange = commit; }
  else { inp = el('input', { type: 'text', list: o.list }); inp.value = obj[key]; inp.oninput = () => { obj[key] = inp.value; done(); }; inp.onchange = commit; }
  row.append(inp); return row;
}
function section(title, ...kids) { const d = el('details', { open: '' }, el('summary', {}, title), el('div', { class: 'sec' }, kids.flat().filter(Boolean))); return d; }

/* ====================== inspector ====================== */
function buildInspector() {
  const box = document.getElementById('inspector'); box.innerHTML = ''; CTL = [];
  const L = selLayer();
  if (!L) { box.append(projectSection()); return; }
  const dl = el('datalist', { id: 'fontlist' }, FONTS.map(f => el('option', { value: f }))); box.append(dl);
  const head = el('div', { class: 'sec', style: 'background:var(--bg2);border-bottom:1px solid var(--line)' },
    el('div', { class: 'frow' }, el('b', {}, L.type.toUpperCase()), field('', L, 'name', 'text', { cb: uiTimelineLite }).querySelector('input')),
    el('div', { class: 'frow' }, el('label', {}, 'Start'), el('input', { type: 'number', step: .1, value: +L.start.toFixed(2), style: 'width:70px', onchange: ev => { L.start = Math.max(0, +ev.target.value); structChanged(); commit(); } }),
      el('label', { style: 'width:auto' }, 'Duration'), el('input', { type: 'number', step: .1, value: +L.dur.toFixed(2), style: 'width:70px', onchange: ev => { L.dur = Math.max(.1, +ev.target.value); if (L.start + L.dur > P.dur) P.dur = Math.ceil(L.start + L.dur); structChanged(); commit(); } })));
  if (typeof Connect !== 'undefined') head.append(Connect.clipBar(L));
  box.append(head);
  const vis = L.type !== 'audio';
  if (vis && L.type !== 'adjust') {
    box.append(section('Transform',
      propRow(L, 'x', 'Position X', -P.w, P.w * 2, 1), propRow(L, 'y', 'Position Y', -P.h, P.h * 2, 1),
      propRow(L, 's', 'Scale %', 0, 400, .5), propRow(L, 'sx', 'Width %', 1, 300, .5), propRow(L, 'sy', 'Height %', 1, 300, .5),
      propRow(L, 'rot', 'Rotation °', -360, 360, .5), propRow(L, 'rx', '3D Tilt X °', -85, 85, .5), propRow(L, 'ry', '3D Turn Y °', -85, 85, .5), propRow(L, 'op', 'Opacity %', 0, 100, 1),
      el('div', { class: 'frow' }, el('label', {}, 'Parent'), el('select', { onchange: ev => { if (!setParent(L, ev.target.value)) toast('A layer cannot be its own ancestor.'); commit(); structChanged(); } },
        el('option', { value: '' }, 'None'), P.layers.filter(l => l !== L && l.type !== 'audio').map(l => el('option', { value: l.id, selected: l.id === L.parent ? '' : undefined }, l.name)))),
      el('div', { class: 'frow' }, el('label', {}, 'Flip'), el('label', {}, field('', L, 'flipX', 'check').querySelector('input'), ' Horizontal'), el('label', {}, field('', L, 'flipY', 'check').querySelector('input'), ' Vertical')),
      field('Blend mode', L, 'blend', 'select', { opts: BLENDS, names: blendName }),
      field('Motion blur', L, 'mblur', 'check', { cb: () => { if (L.mblur && !(P.motionBlur && P.motionBlur.on)) toast('Also enable motion blur for the composition (Canvas / composition settings).'); } })));
  } else if (L.type === 'adjust') {
    box.append(section('Adjustment Layer', el('div', { class: 'dim' }, 'Effects below apply to everything under this layer.'), propRow(L, 'op', 'Strength %', 0, 100, 1)));
  }
  const ts = typeSection(L); if (ts) box.append(ts);
  if (L.type === 'video' || L.type === 'audio') box.append(section('Audio', propRow(L, 'vol', 'Volume %', 0, 200, 1), field('Mute', L, 'muted', 'check')));
  if (vis) {
    box.append(effectsSection(L));
    box.append(maskSection(L));
    if (L.type !== 'adjust') box.append(matteSection(L));
    box.append(exprSection(L));
    box.append(section('Transitions (in / out)',
      field('In', L.tin, 'type', 'select', { opts: TRANS, names: v => TRANS_NAMES[v], cb: () => { } }), field('In length', L.tin, 'dur', 'num', { step: .1, min: .1 }),
      field('Out', L.tout, 'type', 'select', { opts: TRANS, names: v => TRANS_NAMES[v] }), field('Out length', L.tout, 'dur', 'num', { step: .1, min: .1 })));
  } else box.append(section('Transitions', field('Fade in', L.tin, 'type', 'select', { opts: ['none', 'fade'], names: v => TRANS_NAMES[v] }), field('Length', L.tin, 'dur', 'num', { step: .1 }), field('Fade out', L.tout, 'type', 'select', { opts: ['none', 'fade'], names: v => TRANS_NAMES[v] }), field('Length', L.tout, 'dur', 'num', { step: .1 })));
}
/* per-character / per-word text animator (After Effects-style range animators, preset based) */
const TEXT_ANIMS = { none: 'None', fade: 'Fade in', typewriter: 'Typewriter', 'slide-up': 'Slide up', 'slide-down': 'Drop in', pop: 'Scale pop', rotate: 'Rotate in', blur: 'Blur in', tracking: 'Tracking expand', wave: 'Wave (loop)', flicker: 'Flicker on' };
function textAnimatorRows(L) {
  const A = L.text.anim || (L.text.anim = { preset: 'none', by: 'char', stagger: .05, dur: .5, out: false, ease: 'out' });
  return el('div', {}, el('h4', {}, 'Text animator'),
    field('Animation', A, 'preset', 'select', { opts: Object.keys(TEXT_ANIMS), names: k => TEXT_ANIMS[k], rebuild: true }),
    A.preset === 'none' ? null : el('div', {}, field('Based on', A, 'by', 'select', { opts: ['char', 'word', 'line'], names: v => ({ char: 'Characters', word: 'Words', line: 'Lines' }[v]) }), field('Stagger (s)', A, 'stagger', 'num', { step: .01, min: 0, max: 2 }), field('Duration (s)', A, 'dur', 'num', { step: .05, min: .05, max: 5 }), field('Easing', A, 'ease', 'select', { opts: ['out', 'inout', 'back', 'linear'] }), field('Animate out too', A, 'out', 'check')));
}
function typeSection(L) {
  if (L.type === 'text') {
    const X = L.text;
    return section('Text',
      field('', X, 'str', 'area', { id: 'textEdit' }),
      field('Font', X, 'font', 'text', { list: 'fontlist' }), field('Size', X, 'size', 'num', { min: 4, max: 600 }),
      field('Weight', X, 'weight', 'select', { opts: ['300', '400', '600', '700', '800', '900'] }), field('Italic', X, 'italic', 'check'),
      field('Align', X, 'align', 'select', { opts: ['left', 'center', 'right'] }), field('Color', X, 'color', 'color'),
      field('Outline', X, 'stroke', 'color'), field('Outline px', X, 'strokeW', 'num', { min: 0, max: 40 }),
      field('Shadow', X, 'shadow', 'check'), field('Shadow color', X, 'shColor', 'color'), field('Shadow blur', X, 'shBlur', 'num', { min: 0, max: 80 }),
      field('Box', X, 'bgOn', 'check'), field('Box color', X, 'bg', 'color'), field('Box pad', X, 'bgPad', 'num', { min: 0, max: 100 }),
      field('Line height', X, 'lineH', 'num', { step: .05, min: .6, max: 3 }), field('Spacing', X, 'spacing', 'num', { step: .5, min: -20, max: 60 }),
      field('Type-on (s)', X, 'typeOn', 'num', { step: .1, min: 0, max: 30 }),
      textAnimatorRows(L));
  }
  if (L.type === 'shape') {
    const S = L.shape; return section('Shape',
      field('Kind', S, 'kind', 'select', { opts: ['rect', 'ellipse', 'triangle', 'star', 'polygon', 'heart'] }),
      field('Width', S, 'w', 'num', { min: 1, max: 4000 }), field('Height', S, 'h', 'num', { min: 1, max: 4000 }),
      field('Fill', S, 'fill', 'color'), field('Gradient', S, 'grad', 'check'), field('Fill 2', S, 'fill2', 'color'), field('Angle', S, 'angle', 'num', { min: 0, max: 360 }),
      field('Stroke', S, 'stroke', 'color'), field('Stroke px', S, 'strokeW', 'num', { min: 0, max: 100 }),
      field('Corner radius', S, 'radius', 'num', { min: 0, max: 500 }), field('Points', S, 'points', 'num', { min: 3, max: 20 }),
      field('Fill on', S, 'fillOn', 'check'),
      el('div', { class: 'dim' }, 'Trim paths (stroke draw-on; needs Stroke px > 0)'), propRow(L, 'trimS', 'Trim start %', 0, 100, .5), propRow(L, 'trimE', 'Trim end %', 0, 100, .5),
      el('div', { class: 'frow' }, el('button', { onclick: () => { if (!S.strokeW) S.strokeW = 6; S.fillOn = false; delete L.kf.trimS; L.kf.trimE = [{ t: 0, v: 0, e: 'bezier', b: BEZ.easy }, { t: Math.min(1.5, L.dur), v: 100, e: 'linear' }]; L.open = true; commit(); buildInspector(); renderTimeline(); requestRender(); } }, 'Draw-on animation')));
  }
  if (L.type === 'solid') return section('Solid', field('Color', L, 'color', 'color'));
  if (L.type === 'particles') { const Q = L.part; return section('Particles', field('Kind', Q, 'kind', 'select', { opts: ['snow', 'confetti', 'sparkle', 'bubbles', 'hearts', 'embers'] }), field('Count', Q, 'count', 'num', { min: 1, max: 600 }), field('Size', Q, 'size', 'num', { min: 1, max: 80 }), field('Speed', Q, 'speed', 'num', { step: .1, min: 0, max: 8 }), field('Color 1', Q, 'c1', 'color'), field('Color 2', Q, 'c2', 'color'), field('Seed', Q, 'seed', 'num', { min: 1, max: 9999 })); }
  if (L.type === 'paint') return section('Paint Layer',
    el('div', { class: 'dim' }, 'Use Brush (B), Eraser (E), Bucket (G). Blend modes + effects work on painted pixels.'),
    el('div', { class: 'frow' }, el('button', { onclick: () => { const c = L._canvas.getContext('2d'); c.clearRect(0, 0, P.w, P.h); L._ver++; requestRender(); commit(); } }, 'Clear'),
      el('button', { onclick: () => { const c = L._canvas.getContext('2d'); c.fillStyle = fg; c.fillRect(0, 0, P.w, P.h); L._ver++; requestRender(); commit(); } }, 'Fill with color')));
  if (L.type === 'null') return section('Null Object', el('div', { class: 'dim' }, 'Invisible controller. Set other layers\' Parent to this to move, rotate and scale them together.'));
  if (L.type === 'comp' && L.compRef) { const c = typeof Motion !== 'undefined' && Motion.getComp(L.compRef); return section('Motion composition (linked)', el('div', { class: 'dim' }, c ? `${c.name} · ${c.w}×${c.h} · ${c.layers.length} layer(s) · ${(+c.dur).toFixed(1)} s — edits in NEXORA Motion update this layer.` : 'The linked composition is missing.'), c ? el('div', { class: 'frow' }, el('button', { class: 'primary', onclick: () => Motion.open(L.compRef) }, 'Open in NEXORA Motion')) : null, field('Speed', L, 'speed', 'num', { step: .05, min: .1, max: 8 }), field('Offset in', L, 'srcIn', 'num', { step: .1, min: 0 })); }
  if (L.type === 'vfx') { const g = typeof VFX !== 'undefined' && VFX.graph(L.graphRef); return section('VFX graph (linked)', el('div', { class: 'dim' }, g ? `${g.name} · ${g.w}×${g.h} · ${Object.keys(g.nodes).length} nodes — edits in NEXORA VFX update this layer.` : 'The linked VFX graph is missing.'), g ? el('div', { class: 'frow' }, el('button', { class: 'primary', onclick: () => VFX.ui.open(L.graphRef) }, 'Open in NEXORA VFX')) : null, field('Offset in', L, 'srcIn', 'num', { step: .1, min: 0 })); }
  if (L.type === 'gen') { const G2 = L.gen; return section('Animated background', field('Kind', G2, 'kind', 'select', { opts: Object.keys(Motion.GEN), names: k => Motion.GEN[k] }), field('Color 1', G2, 'c1', 'color'), field('Color 2', G2, 'c2', 'color'), field('Base color', G2, 'c3', 'color'), field('Speed', G2, 'speed', 'num', { step: .1, min: 0, max: 8 }), field('Scale', G2, 'scale', 'num', { step: .1, min: .2, max: 5 })); }
  if (L.type === 'comp') return section('Composition', el('div', { class: 'dim' }, `${L.comp.layers.length} layer(s) · ${L.comp.dur.toFixed(1)} s`), el('div', { class: 'frow' }, el('button', { class: 'primary', onclick: () => enterComp(L) }, 'Open composition'), el('button', { onclick: () => { unprecompose(L); } }, 'Unpack')), field('Speed', L, 'speed', 'num', { step: .05, min: .1, max: 8 }), field('Offset in', L, 'srcIn', 'num', { step: .1, min: 0 }));
  if (L.type === 'image') return section('Image', el('div', { class: 'frow' }, el('button', { class: 'primary', onclick: () => Assets.openMediaInImage(L.media) }, (media[L.media] && media[L.media].link ? 'Edit linked image in NEXORA Image' : 'Open in NEXORA Image (linked)'))), el('div', { class: 'frow' }, el('button', { onclick: () => removeBackgroundAI(L) }, 'Remove background (AI)')), el('div', { class: 'dim' }, 'Downloads a small model on first use (needs internet once).'));
  if (L.type === 'video') return section('Clip', field('Speed', L, 'speed', 'num', { step: .05, min: .0625, max: 16, cb: () => { const m = media[L.media]; if (m) { L.dur = Math.max(.1, (m.dur - L.srcIn) / L.speed); } structChanged(); } }),
    el('div', { class: 'frow' }, el('button', { onclick: () => trackDialog(L) }, 'Track motion…'), el('button', { onclick: () => captionDialog(L) }, 'Auto captions')),
    el('div', { class: 'frow' }, el('button', { onclick: () => keyAutoBg(L) }, 'Smart key (auto bg color)')));
  if (L.type === 'audio') return section('Clip', field('Speed', L, 'speed', 'num', { step: .05, min: .0625, max: 16, cb: () => { const m = media[L.media]; if (m) { L.dur = Math.max(.1, (m.dur - L.srcIn) / L.speed); } structChanged(); } }), el('div', { class: 'frow' }, el('button', { onclick: () => captionDialog(L) }, 'Auto captions')));
  if (L.type === 'video' || L.type === 'audio') return section('Clip', field('Speed', L, 'speed', 'num', { step: .05, min: .0625, max: 16, cb: () => { const m = media[L.media]; if (m) { L.dur = Math.max(.1, (m.dur - L.srcIn) / L.speed); } structChanged(); } }));
  return null;
}
function effectsSection(L) {
  const sel = el('select', { onchange: ev => { if (!ev.target.value) return; L.fx.push(newFx(ev.target.value)); commit(); buildInspector(); requestRender(); } },
    el('option', { value: '' }, 'Add effect…'), Object.values(FX).filter(f => !f.hidden).map(f => el('option', { value: f.id }, `${f.cat} · ${f.name}`)));
  const boxes = L.fx.map((f, i) => {
    const d = FX[f.type], lib = f.type === 'lib' && typeof Library !== 'undefined' ? Library.BYID[f.p.preset] : null, lut = f.type === 'lut' && typeof LUT !== 'undefined' ? LUT.store()[f.p.lut] : null;
    const bake = lib && lib.k === 'filter' ? el('button', { title: 'Export this filter as a 33-point .cube LUT (for Resolve, Premiere, cameras…)', onclick: () => { try { download(new Blob([LUT.bake(lib.id)], { type: 'text/plain' }), lib.n.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim() + '.cube'); } catch (e) { toast(e.message); } } }, '.cube') : null;
    const head = el('div', { class: 'fxhead' }, field('', f, 'on', 'check', { cb: () => { } }).querySelector('input'), el('b', { title: lib ? lib.c : '' }, lib ? lib.n : lut ? 'LUT · ' + lut.name : d.name), bake,
      el('button', { title: 'Move up', onclick: () => { if (i > 0) { [L.fx[i - 1], L.fx[i]] = [L.fx[i], L.fx[i - 1]]; commit(); buildInspector(); requestRender(); } } }, '▲'),
      el('button', { title: 'Move down', onclick: () => { if (i < L.fx.length - 1) { [L.fx[i + 1], L.fx[i]] = [L.fx[i], L.fx[i + 1]]; commit(); buildInspector(); requestRender(); } } }, '▼'),
      el('button', { title: 'Remove', onclick: () => { Object.keys(L.kf).filter(k => k.startsWith('fx.' + f.id + '.')).forEach(k => delete L.kf[k]); L.fx.splice(i, 1); commit(); buildInspector(); renderTimeline(); requestRender(); } }, '✕'));
    const params = d.params.filter(q => q.type !== 'hidden' && !(f.type === 'lib' && q.k === 'td' && !(lib && (lib.k === 'tin' || lib.k === 'tout'))));
    const body = el('div', { class: 'sec' }, params.map(q => q.type === 'num' ? propRow(L, `fx.${f.id}.${q.k}`, q.label, q.min, q.max, q.step) : field(q.label, f.p, q.k, q.type === 'color' ? 'color' : 'select', { opts: q.opts })));
    return el('div', { class: 'fxbox' }, head, body);
  });
  return section('Effects', sel, boxes.length ? boxes : el('div', { class: 'dim' }, 'No effects yet. Try Looks or FX tabs on the left.'));
}
function matteSection(L) {
  if (!L.matte) L.matte = { mode: 'none', src: '' };
  const others = P.layers.filter(l => l !== L && l.type !== 'audio' && l.type !== 'adjust');
  const names = { none: 'None', alpha: 'Alpha matte', alphaInv: 'Inverted alpha matte', luma: 'Luma matte', lumaInv: 'Inverted luma matte' };
  const srcSel = el('div', { class: 'frow' }, el('label', {}, 'Matte layer'), el('select', { onchange: ev => { L.matte.src = ev.target.value; requestRender(); commit(); } }, el('option', { value: '' }, '— choose layer —'), others.map(l => el('option', { value: l.id, selected: l.id === L.matte.src ? '' : undefined }, l.name))));
  return section('Track Matte', field('Mode', L.matte, 'mode', 'select', { opts: Object.keys(names), names: v => names[v] }), srcSel, el('div', { class: 'dim' }, 'The matte layer is hidden and used as this layer\'s alpha/luminance (e.g. text-filled video).'));
}
function exprSection(L) {
  if (!L.expr) L.expr = {};
  const keys = [['x', 'Position X'], ['y', 'Position Y'], ['s', 'Scale'], ['rot', 'Rotation'], ['op', 'Opacity']];
  return section('Expressions', el('div', { class: 'dim' }, 'JavaScript per property. Variables: value, time, wiggle(freq, amp), sin, cos, abs, min, max, clamp, lerp, random(seed), PI'),
    keys.map(([k, n]) => { const i = el('input', { type: 'text', placeholder: k === 'x' ? 'value + wiggle(2, 30)' : k === 's' ? 'value * (1 + 0.1*sin(time*6))' : k === 'rot' ? 'time * 90' : '', value: L.expr[k] || '' }); i.oninput = () => { if (i.value.trim()) L.expr[k] = i.value; else delete L.expr[k]; requestRender(); }; i.onchange = commit; return el('div', { class: 'frow' }, el('label', {}, n), i); }));
}
function maskSection(L) {
  const m = L.mask;
  const tog = el('div', { class: 'frow' }, el('label', {}, 'Mask'), el('button', { onclick: () => { if (L.mask) { L.mask = null; Object.keys(L.kf).filter(k => k.startsWith('mask.')).forEach(k => delete L.kf[k]); } else L.mask = defaultMask(); commit(); buildInspector(); renderTimeline(); requestRender(); } }, m ? 'Remove mask' : 'Add mask'));
  if (!m) return section('Mask', tog);
  return section('Mask', tog, field('Enabled', m, 'on', 'check'), field('Shape', m, 'shape', 'select', { opts: ['rect', 'ellipse'] }), field('Invert', m, 'invert', 'check'),
    propRow(L, 'mask.x', 'Center X', -P.w, P.w * 2, 1), propRow(L, 'mask.y', 'Center Y', -P.h, P.h * 2, 1), propRow(L, 'mask.w', 'Width', 1, P.w * 2, 1), propRow(L, 'mask.h', 'Height', 1, P.h * 2, 1), propRow(L, 'mask.feather', 'Feather', 0, 200, 1));
}

/* ====================== project settings ====================== */
const SIZE_PRESETS = { '1280×720 · HD 16:9': [1280, 720], '1920×1080 · Full HD': [1920, 1080], '2048×1080 · DCI 2K': [2048, 1080], '2560×1440 · QHD': [2560, 1440], '3840×2160 · 4K UHD': [3840, 2160], '4096×2160 · DCI 4K': [4096, 2160], '5120×2880 · 5K': [5120, 2880], '7680×4320 · 8K UHD': [7680, 4320], '2160×3840 · Vertical 4K': [2160, 3840], '1080×1920 · 9:16 Reels/TikTok': [1080, 1920], '1080×1080 · 1:1 Square': [1080, 1080], '1080×1350 · 4:5 Portrait': [1080, 1350], '854×480 · SD': [854, 480] };
function setProjectSize(w, h) {
  w = clamp(Math.round(w), 16, 8192); h = clamp(Math.round(h), 16, 8192); if (w === P.w && h === P.h) return;
  for (const L of P.layers) if (L.type === 'paint') { const n = mkCanvas(w, h); n.getContext('2d').drawImage(L._canvas, (w - L._canvas.width) / 2, (h - L._canvas.height) / 2); L._canvas = n; L._ver++; }
  P.w = w; P.h = h; view.width = w; view.height = h; fitView(); structChanged();
}
function projectSection() {
  const wrap = el('div', {});
  const preset = el('select', {}, Object.keys(SIZE_PRESETS).map(k => el('option', { value: k }, k)), el('option', { value: 'custom' }, 'Custom'));
  const cur = Object.keys(SIZE_PRESETS).find(k => SIZE_PRESETS[k][0] === P.w && SIZE_PRESETS[k][1] === P.h); preset.value = cur || 'custom';
  preset.onchange = () => { if (preset.value !== 'custom') { const [w, h] = SIZE_PRESETS[preset.value]; setProjectSize(w, h); commit(); buildInspector(); } };
  const bgT = { v: P.bg === 'transparent' };
  wrap.append(section('Project / Canvas', el('div', { class: 'frow' }, el('label', {}, 'Preset'), preset),
    el('div', { class: 'frow' }, el('label', {}, 'Size'), el('input', { type: 'number', value: P.w, style: 'width:70px', onchange: ev => { setProjectSize(+ev.target.value, P.h); commit(); buildInspector(); } }), '×', el('input', { type: 'number', value: P.h, style: 'width:70px', onchange: ev => { setProjectSize(P.w, +ev.target.value); commit(); buildInspector(); } })),
    field('Frame rate', P, 'fps', 'select', { opts: [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120], cb: () => { P.fps = +P.fps; uiTime(); } }),
    field('Duration (s)', P, 'dur', 'num', { min: 1, max: 3600, cb: () => { structChanged(); } }),
    field('Background', P, 'bg', 'color', { cb: applyView }),
    el('div', { class: 'frow' }, el('label', {}, 'Transparent'), el('input', { type: 'checkbox', checked: bgT.v ? '' : undefined, onchange: ev => { P.bg = ev.target.checked ? 'transparent' : '#000000'; applyView(); commit(); buildInspector(); } })),
    el('div', { class: 'dim' }, 'Select a layer to edit it. Everything is non-destructive: effects, masks and keyframes can be changed any time.')));
  if (!P.motionBlur) P.motionBlur = { on: false, shutter: 180, samples: 8 };
  wrap.append(section('Motion blur', field('Enabled', P.motionBlur, 'on', 'check'), field('Shutter angle °', P.motionBlur, 'shutter', 'num', { min: 1, max: 720 }), field('Samples', P.motionBlur, 'samples', 'num', { min: 2, max: 32 }),
    el('div', { class: 'dim' }, 'Applies to layers with "Motion blur" ticked (Transform section). More samples = smoother but slower.')));
  wrap.append(section('Shortcuts', el('div', { class: 'dim', style: 'line-height:1.7' },
    'Space play · S split · Del delete · Ctrl+D duplicate', el('br'), '← → frame · Shift+← → 1s · Home/End', el('br'), 'V move · B brush · E eraser · G bucket · I eyedrop', el('br'), 'T text · R rect · O ellipse · H hand · [ ] brush size', el('br'), 'Ctrl+Z/Y undo/redo · Ctrl+S save · Ctrl+E export', el('br'), 'K keyframe selected property group · +/- timeline zoom')));
  return wrap;
}

/* ====================== left panel ====================== */
// one browser for everything you add while editing (CapCut-style); big catalogues live in nexora/fxlib
const LEFT_TABS = [['media', 'Media', 'film'], ['audio', 'Audio', 'music'], ['text', 'Text', 'text'], ['effects', 'Effects', 'sparkle'], ['transitions', 'Transitions', 'split'], ['filters', 'Filters', 'theme'], ['add', 'Elements', 'shape'], ['fx', 'Adjust', 'settings'], ['looks', 'Looks', 'layers'], ['motion', 'Animate', 'motion'], ['stickers', 'Stickers', 'star']];
function buildLeft() {
  const tabs = document.getElementById('leftTabs'); tabs.innerHTML = ''; tabs.classList.add('ltabs');
  if (!LEFT_TABS.some(t => t[0] === leftTab)) leftTab = 'media';
  { const h = document.getElementById('leftHead'), t = LEFT_TABS.find(t => t[0] === leftTab); if (h) h.textContent = ({ media: 'Media Pool', effects: 'Effects Library', add: 'Elements', fx: 'Adjustments' })[leftTab] || t[1]; }
  LEFT_TABS.forEach(([id, n, ic]) => tabs.append(el('button', { class: id === leftTab ? 'on' : '', title: n, onclick: () => { leftTab = id; buildLeft(); } }, Icon(ic, 17), el('span', {}, n))));
  const b = document.getElementById('leftBody'); b.innerHTML = '';
  const B = typeof Browser !== 'undefined' ? Browser : null;
  ({ media: leftMedia, add: leftAdd, fx: leftFx, looks: leftLooks, motion: leftMotion,
     audio: x => B.audioTab(x), text: x => B.textTab(x), stickers: x => B.stickerTab(x), effects: x => B.libTab(x, 'fx'), transitions: x => B.libTab(x, 'trans'), filters: x => B.libTab(x, 'filter') })[leftTab](b);
}
function uiMedia() { if (leftTab === 'media') buildLeft(); }
function leftMedia(b) {
  b.append(el('button', { class: 'big ibtn import', onclick: () => document.getElementById('fileIn').click() }, Icon('plus', 15), 'Import media'));
  let items = Object.values(media);
  if (!items.length) b.append(el('div', { class: 'dim' }, 'Drag & drop files anywhere, or click Import. Double-click an item (or press ＋) to put it on the timeline.'));
  // grid or list (metadata, sortable) — remembered per user
  const pref = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, setPref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const mode = pref('nx.pool.view') || 'grid', q = (leftMedia.q || '').toLowerCase();
  if (items.length) b.append(el('div', { class: 'mp-bar' },
    el('input', { class: 'lsearch', placeholder: `Search ${items.length} clip${items.length === 1 ? '' : 's'}`, value: leftMedia.q || '', oninput: e => { leftMedia.q = e.target.value; const pos = e.target.selectionStart; buildLeft(); const s = document.querySelector('#leftBody .mp-bar input'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } }),
    el('div', { class: 'seg' }, ...[['grid', 'Grid'], ['list', 'List']].map(([k, n]) => el('button', { class: mode === k ? 'on' : '', onclick: () => { setPref('nx.pool.view', k); buildLeft(); } }, n)))));
  if (q) items = items.filter(m => m.name.toLowerCase().includes(q) || m.kind.includes(q));
  if (mode === 'list' && items.length) {
    const uses = id => P.layers.filter(L => L.media === id).length, size = m => (m.blob && m.blob.size) || m.size || 0;
    const cols = [['name', 'Name', m => m.name], ['kind', 'Type', m => m.kind], ['dur', 'Duration', m => m.kind === 'image' ? -1 : m.dur], ['res', 'Resolution', m => (m.w || 0) * (m.h || 0)], ['size', 'Size', size], ['use', 'Used', m => uses(m.id)]];
    const sk = pref('nx.pool.sort') || 'name', dir = pref('nx.pool.dir') === 'desc' ? -1 : 1, get = cols.find(c => c[0] === sk)[2];
    items.sort((a, c) => { const x = get(a), y = get(c); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
    const t = el('table', { class: 'mp-list' }, el('thead', {}, el('tr', {}, ...cols.map(([k, n]) => el('th', { class: k === sk ? 'on' : '', onclick: () => { setPref('nx.pool.dir', k === sk && dir === 1 ? 'desc' : 'asc'); setPref('nx.pool.sort', k); buildLeft(); } }, n + (k === sk ? (dir === 1 ? ' ▴' : ' ▾') : ''))))));
    const tb = el('tbody'); items.forEach(m => {
      const tr = el('tr', { draggable: 'true', class: selMedia === m.id ? 'on' : '', title: 'Double-click to add at the playhead', onclick: () => { selMedia = m.id; buildLeft(); }, ondblclick: () => addMediaLayer(m) },
        el('td', { class: 'mp-n' }, m.missing ? '⚠ ' : '', m.name), el('td', {}, m.kind), el('td', { class: 'mono' }, m.kind === 'image' ? '—' : tcFull(m.dur || 0)), el('td', { class: 'mono' }, m.w ? `${m.w}×${m.h}` : '—'),
        el('td', { class: 'mono' }, size(m) ? (size(m) / 1048576).toFixed(1) + ' MB' : '—'), el('td', { class: 'mono' }, String(uses(m.id))));
      tr.ondragstart = ev => ev.dataTransfer.setData('text/media-id', m.id); tb.append(tr); });
    t.append(tb); b.append(t); return;
  }
  const g = el('div', { class: 'grid' });
  items.forEach(m => {
    const th = el('div', { class: 'th', style: m.thumb ? `background-image:url(${m.thumb})` : '' }, m.thumb ? '' : Icon('music', 26));
    const c = el('div', { class: 'card', draggable: 'true', ondblclick: () => addMediaLayer(m) }, th, el('small', { title: m.name }, m.name), el('small', {}, m.kind + (m.kind !== 'image' ? ' · ' + fmtDur(m.dur) : ''), ' ', el('button', { style: 'padding:0 6px;margin-left:4px', onclick: ev => { ev.stopPropagation(); addMediaLayer(m); } }, '＋')));
    c.ondragstart = ev => ev.dataTransfer.setData('text/media-id', m.id); g.append(c);
  });
  b.append(g);
}
const fmtDur = s => { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function textPreset(name, o) {
  return () => {
    const L = mkLayer('text', { name, start: T, dur: Math.max(2, Math.min(5, P.dur - T)) }); Object.assign(L.text, o.text || {});
    if (o.tin) L.tin = { type: o.tin, dur: .6 }; if (o.tout) L.tout = { type: o.tout, dur: .5 };
    (o.fx || []).forEach(([t, p]) => { const f = newFx(t); Object.assign(f.p, p); L.fx.push(f); });
    if (o.y) L.tr.y = P.h * o.y; addLayer(L); commit();
  };
}
function leftAdd(b) {
  b.append(el('h4', {}, 'Text styles'));
  const TP = [
    ['Title', { text: { str: 'BIG TITLE', size: 140, weight: '900', shadow: true, shBlur: 20, shY: 8, shColor: '#000000' }, tin: 'zoom-in', tout: 'fade' }],
    ['Subtitle', { text: { str: 'Subtitle goes here', size: 54, weight: '600', strokeW: 0, bgOn: true, bg: '#000000', bgPad: 16 }, y: .85, tin: 'slide-down', tout: 'fade' }],
    ['Neon', { text: { str: 'NEON', size: 150, weight: '800', color: '#e8fdff' }, fx: [['glow', { radius: 26, amount: 160 }], ['shadow', { x: 0, y: 0, blur: 24, color: '#27d3c3', op: 100 }]], tin: 'fade' }],
    ['Outline', { text: { str: 'OUTLINE', size: 140, weight: '900', color: '#ffe14d', stroke: '#1a1a1a', strokeW: 10 }, tin: 'pop' }],
    ['Typewriter', { text: { str: 'Typing in real time…', size: 72, weight: '600', font: 'Consolas', align: 'left', typeOn: 2 } }],
    ['Lower Third', { text: { str: 'NAME SURNAME\nRole · Company', size: 46, weight: '700', align: 'left', bgOn: true, bg: '#5cb8ff', bgPad: 22, lineH: 1.3 }, y: .8, tin: 'wipe-left', tout: 'wipe-left' }],
    ['Highlight', { text: { str: 'Highlight', size: 90, weight: '800', color: '#111111', bgOn: true, bg: '#ffe14d', bgPad: 20 }, tin: 'pop' }],
    ['Glitch', { text: { str: 'GLITCH', size: 150, weight: '900' }, fx: [['rgbsplit', { amount: 9 }], ['glitch', { amount: 55, rate: 12 }]] }]
  ];
  const g = el('div', { class: 'grid' }); TP.forEach(([n, o]) => g.append(el('div', { class: 'card', onclick: textPreset(n, o) }, el('div', { class: 'th', style: 'font-weight:800' }, 'Aa'), el('small', {}, n)))); b.append(g);
  b.append(el('h4', {}, 'Shapes'));
  const sh = el('div', { class: 'grid' });
  [['Rectangle', '▭', { kind: 'rect' }], ['Rounded', '▢', { kind: 'rect', radius: 60 }], ['Ellipse', '◯', { kind: 'ellipse' }], ['Triangle', '△', { kind: 'triangle' }], ['Star', '☆', { kind: 'star' }], ['Heart', '♡', { kind: 'heart' }], ['Hexagon', '⬡', { kind: 'polygon', points: 6 }], ['Gradient BG', '▦', { kind: 'rect', w: P.w, h: P.h, grad: true, fill: '#1b1b4b', fill2: '#0a6a8a', angle: 60 }]].forEach(([n, ic, o]) =>
    sh.append(el('div', { class: 'card', onclick: () => { const L = mkLayer('shape', { name: n, start: T, dur: Math.max(2, Math.min(5, P.dur - T)) }); Object.assign(L.shape, { fill: fg }, o); if (o.grad) L.shape.fill = o.fill; addLayer(L); commit(); } }, el('div', { class: 'th' }, ic), el('small', {}, n))));
  b.append(sh);
  b.append(el('h4', {}, 'Particles & overlays'));
  const pg = el('div', { class: 'grid' });
  [['Snow', Icon('sparkle', 20), { kind: 'snow', c1: '#ffffff' }], ['Confetti', Icon('star', 20), { kind: 'confetti', c1: '#5cb8ff', c2: '#3b9bff', size: 16 }], ['Sparkles', Icon('ai', 20), { kind: 'sparkle', c1: '#ffffff', c2: '#3b9bff', count: 70, size: 22 }], ['Bubbles', Icon('circle', 20), { kind: 'bubbles', c1: '#7dd3fc', c2: '#3b82f6', count: 60, size: 18 }], ['Hearts', Icon('motion', 20), { kind: 'hearts', c1: '#5cb8ff', c2: '#ff5da2', count: 40, size: 40 }], ['Embers', Icon('burn', 20), { kind: 'embers', c1: '#3b9bff', c2: '#5cb8ff', count: 140, size: 14 }]].forEach(([n, ic, o]) =>
    pg.append(el('div', { class: 'card', onclick: () => { const L = mkLayer('particles', { name: n, start: 0, dur: P.dur }); Object.assign(L.part, o); addLayer(L); commit(); } }, el('div', { class: 'th' }, ic), el('small', {}, n))));
  b.append(pg);
  b.append(el('h4', {}, 'Stickers (emoji)'));
  const eg = el('div', { style: 'display:grid;grid-template-columns:repeat(6,1fr);gap:4px' });
  '😀 😂 😍 🔥 💜 ✨ 🎉 👍 👀 💯 🚀 ⭐ 🎬 🎵 💥 ❤️ 😎 🤯 👑 🌈 ⚡ 🍿 🎯 ✅'.split(' ').forEach(e => eg.append(el('button', { style: 'font-size:18px;padding:3px', onclick: () => { const L = mkLayer('text', { name: e, start: T, dur: Math.max(2, Math.min(4, P.dur - T)), tin: { type: 'pop', dur: .5 } }); Object.assign(L.text, { str: e, size: 200 }); addLayer(L); commit(); } }, e)));
  b.append(eg);
  b.append(el('h4', {}, 'Captions & audio'));
  b.append(el('button', { class: 'big', onclick: () => document.getElementById('srtIn').click() }, 'Import subtitles (.srt)'));
  b.append(el('button', { class: 'big' + (recording ? ' rec' : ''), onclick: toggleVoiceover }, recording ? '■ Stop recording' : '● Record voiceover'));
  b.append(el('h4', {}, 'Layers'));
  const ly = el('div', { class: 'grid' });
  [['Solid color', '■', () => addLayer(mkLayer('solid', { name: 'Solid', start: T }))], ['Adjustment', '◐', () => addLayer(mkLayer('adjust', { name: 'Adjustment', start: 0, dur: P.dur }))], ['Paint layer', Icon('brush', 20), () => { addLayer(mkLayer('paint', { name: 'Paint', start: 0 })); setTool('brush'); }]].forEach(([n, ic, fn]) =>
    ly.append(el('div', { class: 'card', onclick: () => { fn(); commit(); } }, el('div', { class: 'th' }, ic), el('small', {}, n))));
  b.append(ly);
}
function needSel() { const L = selLayer(); if (!L) toast('Select a layer first.'); return L; }
function leftFx(b) {
  b.append(el('div', { class: 'dim' }, 'Click to add to the selected layer. Every parameter can be keyframed.'));
  const cats = {}; Object.values(FX).forEach(f => (cats[f.cat] = cats[f.cat] || []).push(f));
  for (const c in cats) {
    b.append(el('h4', {}, c)); const g = el('div', { class: 'grid' });
    cats[c].forEach(f => g.append(el('div', { class: 'card', onclick: () => { const L = needSel(); if (!L) return; L.fx.push(newFx(f.id)); commit(); buildInspector(); requestRender(); } }, el('small', { style: 'color:var(--txt)' }, f.name))));
    b.append(g);
  }
}
function leftLooks(b) {
  b.append(el('div', { class: 'frow' }, el('input', { type: 'checkbox', id: 'looksAdj', checked: looksAdj ? '' : undefined, onchange: ev => looksAdj = ev.target.checked }), el('label', { for: 'looksAdj', style: 'width:auto' }, 'Apply as new adjustment layer (affects everything below)')));
  b.append(el('div', { class: 'dim' }, 'One-click color grades (like CapCut filters). Edit every parameter after applying.'));
  const g = el('div', { class: 'grid' });
  Object.keys(LOOKS).forEach(n => g.append(el('div', { class: 'card', onclick: () => {
    let L = selLayer(); if (looksAdj || !L || L.type === 'audio') L = addLayer(mkLayer('adjust', { name: n + ' look', start: 0, dur: P.dur }));
    LOOKS[n].forEach(([t, p]) => { const f = newFx(t); Object.assign(f.p, p); L.fx.push(f); }); commit(); buildInspector(); renderTimeline(); requestRender();
  } }, el('div', { class: 'th', style: 'font-size:12px;color:var(--dim)' }, LOOKS[n].map(x => FX[x[0]].name.split(' ')[0]).join(' · ')), el('small', { style: 'color:var(--txt)' }, n)))); b.append(g);
}
/* ---- motion presets: write keyframes (After Effects style) ---- */
function clearKeys(L, keys) { keys.forEach(k => delete L.kf[k]); }
const MOTION = {
  'Ken Burns zoom': L => { clearKeys(L, ['s', 'x']); const s = L.tr.s; upsertKey(L, 's', 0, s, 'linear'); upsertKey(L, 's', L.dur, s * 1.25, 'linear'); upsertKey(L, 'x', 0, L.tr.x, 'linear'); upsertKey(L, 'x', L.dur, L.tr.x - 40, 'linear'); },
  'Zoom pulse': L => { clearKeys(L, ['s']); const s = L.tr.s; for (let t = 0; t <= L.dur + .01; t += .5) upsertKey(L, 's', t, (Math.round(t * 2) % 2 ? s * 1.12 : s), 'inout'); },
  'Shake': L => { clearKeys(L, ['x', 'y']); const r = mulberry(5); for (let t = 0; t <= Math.min(L.dur, 1.2); t += 1 / 15) { upsertKey(L, 'x', t, L.tr.x + (r() - .5) * 28, 'linear'); upsertKey(L, 'y', t, L.tr.y + (r() - .5) * 28, 'linear'); } },
  'Float': L => { clearKeys(L, ['y']); for (let t = 0, i = 0; t <= L.dur + .01; t += .75, i++) upsertKey(L, 'y', t, L.tr.y + (i % 2 ? 18 : -18), 'inout'); },
  'Spin (360°)': L => { clearKeys(L, ['rot']); upsertKey(L, 'rot', 0, L.tr.rot, 'linear'); upsertKey(L, 'rot', L.dur, L.tr.rot + 360, 'linear'); },
  'Swing': L => { clearKeys(L, ['rot']); for (let t = 0, i = 0; t <= L.dur + .01; t += .6, i++) upsertKey(L, 'rot', t, L.tr.rot + (i % 2 ? 12 : -12), 'inout'); },
  'Blink': L => { clearKeys(L, ['op']); for (let t = 0, i = 0; t <= L.dur + .01; t += .25, i++) upsertKey(L, 'op', t, i % 2 ? 15 : L.tr.op, 'hold'); },
  'Fly across': L => { clearKeys(L, ['x']); upsertKey(L, 'x', 0, -300, 'inout'); upsertKey(L, 'x', L.dur, P.w + 300, 'inout'); },
  'Bounce in': L => { clearKeys(L, ['y', 's']); upsertKey(L, 'y', 0, L.tr.y - 400, 'bounce'); upsertKey(L, 'y', .9, L.tr.y, 'inout'); },
  'Clear animation': L => { L.kf = {}; }
};
function leftMotion(b) {
  b.append(el('div', { class: 'dim' }, 'Animation presets that write keyframes on the selected layer — edit them on the timeline afterwards.'));
  const g = el('div', { class: 'grid' });
  Object.keys(MOTION).forEach(n => g.append(el('div', { class: 'card', onclick: () => { const L = needSel(); if (!L) return; MOTION[n](L); commit(); buildInspector(); renderTimeline(); requestRender(); } }, el('small', { style: 'color:var(--txt);padding:8px 0' }, n)))); b.append(g);
}

