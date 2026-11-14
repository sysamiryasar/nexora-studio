'use strict';
/* ====================== NEXORA asset browser (Edit › left panel) ======================
   One place to find everything while editing, CapCut-style: Media · Audio · Text · Stickers · Effects · Transitions ·
   Filters · Elements · Adjust · Animate. Large catalogues (thousands of items) use a virtual grid: only the visible cards
   exist in the DOM. Effect / filter / transition thumbnails are real renders of the selected clip (or a sample photo)
   through the GPU library, generated lazily; hovering a card animates its preview. Click applies to the selected clip;
   with nothing selected, effects and filters go on their own track (an adjustment layer) at the playhead. */
const Browser = (() => {
  const S = { q: {}, cat: {}, stem: {}, target: 'auto', fav: new Set(), recent: [], thumbs: new Map(), sampleKey: '' };
  try { S.fav = new Set(JSON.parse(localStorage.getItem('nx.fav') || '[]')); S.recent = JSON.parse(localStorage.getItem('nx.recent') || '[]'); } catch (e) { }
  const saveFav = () => { try { localStorage.setItem('nx.fav', JSON.stringify([...S.fav])); localStorage.setItem('nx.recent', JSON.stringify(S.recent.slice(0, 60))); } catch (e) { } };
  const visSel = () => { const L = typeof selLayer === 'function' ? selLayer() : null; return L && L.type !== 'audio' ? L : null; };

  /* ---------- sample image used for previews ---------- */
  let sample = null;
  function defaultSample() {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 90); g.addColorStop(0, '#7cc4ff'); g.addColorStop(.6, '#ffd7a8'); g.addColorStop(1, '#3a5a40'); x.fillStyle = g; x.fillRect(0, 0, 160, 90);
    x.fillStyle = '#fff6d0'; x.beginPath(); x.arc(118, 34, 13, 0, 7); x.fill(); x.fillStyle = '#2f4858'; x.beginPath(); x.moveTo(0, 70); x.lineTo(40, 40); x.lineTo(70, 62); x.lineTo(105, 30); x.lineTo(160, 68); x.lineTo(160, 90); x.lineTo(0, 90); x.fill();
    x.fillStyle = '#1b2a33'; x.fillRect(64, 52, 10, 26); x.beginPath(); x.arc(69, 47, 6, 0, 7); x.fill(); x.fillStyle = '#ffffff'; x.font = 'bold 15px Segoe UI'; x.fillText('Aa', 8, 20); return c;
  }
  function currentSample() {
    // only footage-like clips make useful previews; text / shapes on black would make every card look the same
    const L0 = visSel(), L = L0 && ['video', 'image', 'comp', '3d', 'vfx', 'gen'].includes(L0.type) ? L0 : null; const key = L ? L.id + '@' + Math.round(clamp(T, L.start, L.start + L.dur) * 4) : 'default';
    if (key === S.sampleKey && sample) return sample; S.sampleKey = key; S.thumbs.clear();
    if (L) { const C = contentOfBase(L, clamp(T, L.start, L.start + L.dur - .01)); if (C && C.src) { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 160, 90); const k = Math.min(160 / C.w, 90 / C.h); x.drawImage(C.src, (160 - C.w * k) / 2, (90 - C.h * k) / 2, C.w * k, C.h * k); return (sample = c); } }
    return (sample = defaultSample());
  }
  const work = (() => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; c._ctx = c.getContext('2d', { willReadFrequently: false }); return c; })();
  /** render one library item over the sample into `out` (a 160×90 canvas) at preview time t */
  function renderItem(it, t, out) {
    const x = work._ctx; resetCtx(x); x.clearRect(0, 0, 160, 90); x.drawImage(currentSample(), 0, 0);
    const lt = it.k === 'tin' ? (t % 1.2) * .6 : it.k === 'tout' ? 1 - .6 + (t % 1.2) * .5 : t, ok = GPU.run(work, [{ type: 'lib', p: { preset: it.id, amount: 100, speed: 1, td: .6 }, t: lt, ld: 1 }]);
    const o = out.getContext('2d'); o.clearRect(0, 0, 160, 90); o.drawImage(ok ? work : currentSample(), 0, 0); return ok;
  }
  // thumbnail queue: a few per animation frame so scrolling stays smooth
  const queue = []; let pumping = false;
  function pump() { if (pumping) return; pumping = true; requestAnimationFrame(function step() { const t0 = performance.now(); while (queue.length && performance.now() - t0 < 10) { const [it, cv] = queue.shift(); if (!cv.isConnected) continue; const k = it.id + '|' + S.sampleKey, hit = S.thumbs.get(k); if (hit) cv.getContext('2d').drawImage(hit, 0, 0); else { renderItem(it, .35, cv); const c = document.createElement('canvas'); c.width = 160; c.height = 90; c.getContext('2d').drawImage(cv, 0, 0); S.thumbs.set(k, c); if (S.thumbs.size > 600) S.thumbs.delete(S.thumbs.keys().next().value); } } if (queue.length) requestAnimationFrame(step); else pumping = false; }); }

  /* ---------- virtual grid ---------- */
  function vgrid(host, items, card, o) {
    o = Object.assign({ cw: 104, ch: o && o.ch || 92, gap: 6 }, o || {}); const box = el('div', { class: 'vgrid' }), inner = el('div', { class: 'vginner' }); box.append(inner); host.append(box);
    let shown = new Map();
    const layout = () => {
      const W = box.clientWidth || 300, cols = Math.max(1, Math.floor((W + o.gap) / (o.cw + o.gap))), cw = (W - (cols - 1) * o.gap) / cols, rows = Math.ceil(items.length / cols);
      inner.style.height = rows * (o.ch + o.gap) + 'px';
      const r0 = Math.max(0, Math.floor(box.scrollTop / (o.ch + o.gap)) - 2), r1 = Math.min(rows, Math.ceil((box.scrollTop + box.clientHeight) / (o.ch + o.gap)) + 2), keep = new Map();
      for (let r = r0; r < r1; r++) for (let c = 0; c < cols; c++) { const i = r * cols + c; if (i >= items.length) break; let e = shown.get(i); if (!e) { e = card(items[i], i); e.style.position = 'absolute'; inner.append(e); } e.style.left = c * (cw + o.gap) + 'px'; e.style.top = r * (o.ch + o.gap) + 'px'; e.style.width = cw + 'px'; e.style.height = o.ch + 'px'; keep.set(i, e); }
      for (const [i, e] of shown) if (!keep.has(i)) e.remove(); shown = keep;
    };
    box.addEventListener('scroll', () => requestAnimationFrame(layout)); new ResizeObserver(layout).observe(box); layout(); requestAnimationFrame(layout);   // immediate first layout (rAF may be throttled in background windows)
    return { box, layout };
  }

  /* ---------- applying ---------- */
  function apply(it) {
    const L = visSel(); S.recent = [it.id, ...S.recent.filter(x => x !== it.id)].slice(0, 60); saveFav();
    if (it.k === 'tin' || it.k === 'tout') {
      if (!L) return toast('Select a clip on the timeline to add a transition.');
      L.fx = L.fx.filter(f => !(f.type === 'lib' && Library.BYID[f.p.preset] && Library.BYID[f.p.preset].k === it.k));   // one in / one out per clip
      L.fx.push(Library.fxFor(it.id, { td: Math.min(.6, L.dur / 3) })); commit(); structChanged(); buildInspector(); return toast(`${it.n} on "${L.name}"`);
    }
    const toClip = S.target === 'clip' || (S.target === 'auto' && L);
    if (toClip) { if (!L) return toast('Select a clip first, or switch "Apply to" to New layer.'); L.fx.push(Library.fxFor(it.id)); commit(); structChanged(); buildInspector(); return toast(`${it.n} → "${L.name}"`); }
    const dur = Math.max(.5, Math.min(it.k === 'filter' ? 5 : 3, (P.dur - T) || 3)), A = mkLayer('adjust', { name: it.n, start: T, dur }); A.fx.push(Library.fxFor(it.id)); addLayer(A); commit(); structChanged(); toast(`${it.n} added as its own layer at ${tcFmt(T)}`);
  }

  /* ---------- library tab (effects / filters / transitions) ---------- */
  function libTab(b, kind) {
    const kinds = kind === 'trans' ? ['tin', 'tout'] : [kind], all = Library.ITEMS.filter(i => kinds.includes(i.k)), G = kind === 'trans' ? null : Library.groups(kind), cats = G ? G.cats : [...new Set(all.map(i => i.c))], defCat = G ? 'Top picks' : 'All';
    const label = { fx: 'effects', filter: 'filters', trans: 'transitions' }[kind], looks = G ? G.list.length : all.length;
    const q = el('input', { class: 'lsearch', placeholder: G ? `Search ${looks} ${label}…` : `Search ${all.length.toLocaleString()} ${label}…`, value: S.q[kind] || '', oninput: () => { S.q[kind] = q.value; S.stem[kind] = null; fill(); } });
    const target = kind === 'trans' ? el('div', { class: 'dim' }, 'Click to add to the selected clip (In = start, Out = end).') : el('div', { class: 'seg' }, ['auto', 'clip', 'layer'].map(v => el('button', { class: S.target === v ? 'on' : '', onclick: () => { S.target = v; buildLeft(); } }, { auto: 'Auto', clip: 'Selected clip', layer: 'New layer' }[v])));
    const chips = el('div', { class: 'chips' }, [...(G ? ['Top picks'] : []), 'All', '★ Favorites', 'Recent', ...cats].map(c => el('button', { class: (S.cat[kind] || defCat) === c ? 'on' : '', onclick: () => { S.cat[kind] = c; S.stem[kind] = null; buildLeft(); } }, c === 'All' ? `All ${looks.toLocaleString()}` : c)));
    const info = el('div', { class: 'dim lcount' }), host = el('div', { class: 'vhost' }), backRow = el('div', {});
    if (kind === 'filter' && typeof LUT !== 'undefined') {   // professional colour: your own .cube LUTs
      const luts = LUT.list(), pick = el('input', { type: 'file', accept: '.cube', multiple: '', hidden: '', onchange: async () => { for (const f of pick.files) { try { const id = await LUT.importFile(f); toast('LUT imported: ' + LUT.store()[id].name); } catch (e) { toast(f.name + ': ' + e.message); } } buildLeft(); } });
      b.append(el('div', { class: 'lutrow' }, el('button', { onclick: () => pick.click() }, Icon('import', 13), 'Import .cube LUT'), pick, ...luts.map(l => el('button', { class: 'lutchip', title: `${l.n}-point LUT · click to apply`, onclick: () => LUT.apply(l.id) }, l.name))));
    }
    b.append(q, target, chips, backRow, info, host);
    const card = x => {
      const g = x.rep ? x : null, it = g ? g.rep : x, cv = el('canvas', { width: 160, height: 90 }), star = el('button', { class: 'star' + (S.fav.has(it.id) ? ' on' : ''), title: 'Favorite', onclick: e => { e.stopPropagation(); S.fav.has(it.id) ? S.fav.delete(it.id) : S.fav.add(it.id); saveFav(); star.classList.toggle('on'); } }, '★');
      const c = el('div', { class: 'lcard', title: g ? g.stem : it.n, onclick: () => apply(it) }, cv, star, el('small', {}, g ? g.stem : it.n)); queue.push([it, cv]); pump();
      if (g && g.motion) c.append(el('span', { class: 'lmot' }, 'Motion'));
      if (g && g.items.length > 1) c.append(el('button', { class: 'lvar', title: `${g.items.length} strengths and speeds`, onclick: e => { e.stopPropagation(); S.stem[kind] = g.stem; fill(); } }, String(g.items.length)));
      let iv = 0, t = 0; c.onmouseenter = () => { iv = setInterval(() => { t += .08; renderItem(it, t, cv); }, 80); }; c.onmouseleave = () => { clearInterval(iv); const hit = S.thumbs.get(it.id + '|' + S.sampleKey); if (hit) cv.getContext('2d').drawImage(hit, 0, 0); };
      return c;
    };
    let grid = null;
    function fill() {
      const raw = (S.q[kind] || '').toLowerCase(), words = raw.split(/\s+/).filter(Boolean), c = S.cat[kind] || defCat, hit = i => { const s = (i.n + ' ' + i.c + ' ' + i.tags).toLowerCase(); return words.every(w => s.includes(w)); }, openG = G && S.stem[kind] ? G.list.find(g => g.stem === S.stem[kind]) : null;
      backRow.innerHTML = ''; if (openG) backRow.append(el('button', { class: 'lback', onclick: () => { S.stem[kind] = null; fill(); } }, Icon('back', 13), openG.stem));
      let list;
      if (openG) list = openG.items;
      else if (c === '★ Favorites') list = all.filter(i => S.fav.has(i.id) && hit(i));
      else if (c === 'Recent') list = S.recent.map(id => Library.BYID[id]).filter(i => i && kinds.includes(i.k) && hit(i));
      else if (!G) list = all.filter(i => (c === 'All' || i.c === c) && hit(i));
      else if (/\d/.test(raw)) list = all.filter(i => (c === 'All' || c === 'Top picks' || i.c === c) && hit(i));   // a number means one exact variation
      else { const src = words.length ? G.list : c === 'Top picks' ? G.picks : c === 'All' ? G.mixed : G.list.filter(g => g.c === c); list = words.length ? src.filter(g => g.items.some(hit)) : src; }
      currentSample(); info.textContent = `${list.length.toLocaleString()} ${openG ? 'variations' : label}${S.sampleKey !== 'default' && visSel() ? ` · previews show "${visSel().name}"` : ''}`; host.innerHTML = ''; grid = vgrid(host, list, card, { ch: 112 }); S.grid = grid; S.list = list.map(x => x.rep || x);
    }
    fill(); if (!GPU.available) b.prepend(el('div', { class: 'warnbox' }, 'GPU acceleration (WebGL2) is unavailable, so library effects cannot render on this computer.'));
  }

  /* ---------- text ---------- */
  function textTab(b) {
    const q = el('input', { class: 'lsearch', placeholder: `Search ${Library.TEXTS.length} text styles…`, value: S.q.text || '', oninput: () => { S.q.text = q.value; fill(); } }), host = el('div', { class: 'vhost' });
    b.append(el('button', { class: 'big primary', onclick: () => addText({ font: 'Segoe UI', look: {}, anim: 'fade', n: 'Text' }) }, Icon('text', 14), 'Add text'), q, host);
    const card = s => el('div', { class: 'lcard tcard', title: s.n, onclick: () => addText(s) }, el('div', { class: 'tprev', style: `font-family:'${s.font}';color:${s.look.color};${s.look.bgOn ? `background:${s.look.bg};` : ''}${s.look.shadow ? `text-shadow:0 ${s.look.shY || 0}px ${s.look.shBlur / 2}px ${s.look.shColor};` : ''}${s.look.strokeW ? '-webkit-text-stroke:1px #000;' : ''}` }, 'Title'), el('small', {}, s.n));
    function fill() { const w = (S.q.text || '').toLowerCase().split(/\s+/).filter(Boolean); host.innerHTML = ''; vgrid(host, Library.TEXTS.filter(s => w.every(x => s.n.toLowerCase().includes(x))), card, { ch: 78 }); }
    fill();
  }
  function addText(s) {
    const L = mkLayer('text', { name: s.n === 'Text' ? 'Text' : s.c + ' title', start: T, dur: Math.max(2, Math.min(5, (P.dur - T) || 5)) });
    Object.assign(L.text, { str: 'Your title', font: s.font, size: 120, weight: s.font === 'Segoe UI' ? '800' : '400' }, s.look); L.text.anim = { preset: s.anim, by: s.anim === 'wave' || s.anim === 'typewriter' ? 'char' : 'char', stagger: .04, dur: .45, out: false, ease: 'out' };
    addLayer(L); commit(); structChanged(); toast('Text added — edit it in the panel on the right');
  }

  /* ---------- stickers (every emoji the system font can draw) ---------- */
  const EMOJI = (() => { const out = [], rng = [[0x1F600, 0x1F64F, 'Smileys'], [0x1F910, 0x1F9FF, 'People & more'], [0x1F400, 0x1F4FF, 'Animals & objects'], [0x1F300, 0x1F3FF, 'Nature & places'], [0x1F680, 0x1F6FF, 'Travel'], [0x1FA70, 0x1FAFF, 'Extras'], [0x2600, 0x27BF, 'Symbols']];
    for (const [a, z, c] of rng) for (let cp = a; cp <= z; cp++) { const ch = String.fromCodePoint(cp); if (/\p{Extended_Pictographic}/u.test(ch)) out.push({ ch, c }); } return out; })();
  function stickerTab(b) {
    const cats = [...new Set(EMOJI.map(e => e.c))], c = S.cat.st || 'Smileys', host = el('div', { class: 'vhost' });
    b.append(el('div', { class: 'chips' }, cats.map(x => el('button', { class: x === c ? 'on' : '', onclick: () => { S.cat.st = x; buildLeft(); } }, x))), el('div', { class: 'dim lcount' }, `${EMOJI.length.toLocaleString()} stickers`), host);
    vgrid(host, EMOJI.filter(e => e.c === c), e => el('button', { class: 'emo', onclick: () => { const L = mkLayer('text', { name: 'Sticker ' + e.ch, start: T, dur: Math.max(2, Math.min(4, (P.dur - T) || 4)), tin: { type: 'pop', dur: .4 } }); Object.assign(L.text, { str: e.ch, size: 220 }); addLayer(L); commit(); structChanged(); } }, e.ch), { cw: 44, ch: 44, gap: 4 });
  }

  /* ---------- audio: project audio, voice-over, sound effects ---------- */
  function audioTab(b) {
    b.append(el('div', { class: 'seg mu-tabs' }, [['music', 'Music'], ['sfx', 'Sound effects']].map(([k, n]) => el('button', { class: (S.audioPane || 'music') === k ? 'on' : '', onclick: () => { S.audioPane = k; buildLeft(); } }, n))));
    b.append(el('button', { class: 'big' + (recording ? ' rec' : ''), onclick: toggleVoiceover }, recording ? 'Stop recording' : 'Record voice-over'));
    if ((S.audioPane || 'music') === 'music') return Music.panel(b);
    const cats = [...new Set(Library.SFX.map(s => s.c))]; b.append(el('h4', {}, `Sound effects (${Library.SFX.length}) — made on this computer, royalty-free`));
    let ac = null;
    cats.forEach(c => { const g = el('div', { class: 'sfxgrp' }, el('b', {}, c)); Library.SFX.filter(s => s.c === c).forEach(s => g.append(el('div', { class: 'arow' }, el('button', { title: 'Preview', onclick: async () => { const f = await Library.renderSfx(s); ac = ac || new AudioContext(); const buf = await ac.decodeAudioData(await f.arrayBuffer()), src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.start(); } }, Icon('play', 12)), el('span', {}, s.n.replace(c + ' · ', '')), el('button', { title: 'Add at playhead', onclick: async () => { const m = await importFile(await Library.renderSfx(s)); if (m) { addMediaLayer(m, T); commit(); toast(s.n + ' added'); } } }, '+')))); b.append(g); });
  }

  /* drag the panel edge to resize the browser (remembered per computer) */
  function resizable() {
    const left = document.getElementById('left'); if (!left || left.querySelector('.lresize')) return;
    try { const w = +localStorage.getItem('nx.leftW'); if (w) document.documentElement.style.setProperty('--leftW', w + 'px'); } catch (e) { }
    const h = el('div', { class: 'lresize', title: 'Drag to resize' }); left.append(h);
    h.onpointerdown = e => { h.setPointerCapture(e.pointerId); const x0 = e.clientX, w0 = left.getBoundingClientRect().width;
      h.onpointermove = ev => { const w = clamp(w0 + ev.clientX - x0, 240, 720); document.documentElement.style.setProperty('--leftW', w + 'px'); if (typeof resizeOverlay === 'function') resizeOverlay(); if (S.grid) S.grid.layout(); };
      h.onpointerup = () => { h.onpointermove = null; try { localStorage.setItem('nx.leftW', Math.round(left.getBoundingClientRect().width)); } catch (e) { } if (typeof fitView === 'function' && !window.userZoomed) fitView(); }; };
  }
  setTimeout(resizable, 0);
  return { S, apply, libTab, textTab, stickerTab, audioTab, renderItem, currentSample, vgrid, EMOJI, addText };
})();
