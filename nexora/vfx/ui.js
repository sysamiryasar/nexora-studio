'use strict';
/* ====================== NEXORA VFX workspace UI ====================== */
VFX.ui = (() => {
  const U = { mounted: false, path: [], sel: new Set(), view: null, t: 0, playing: false, mode: null, ne: { x: 40, y: 30, z: 1 }, dirty: true };
  let root, viewer, vctxV, overV, octxV, insp, ne, world, svg, bar, tbar, timeIn, tRead;
  const $$ = id => document.getElementById(id);
  const g0 = () => VFX.graph(VFX.S.active);                       // root graph (what renders)
  const cur = () => U.path.length ? U.path[U.path.length - 1].node.p.graph : g0();   // graph being edited (root or inside a group)
  const CAT_COL = { Input: '#2f63e0', Generate: '#0ea5b7', Transform: '#8fd0ff', Color: '#f59e0b', Filter: '#3b9bff', Matte: '#22c55e', Composite: '#5cb8ff', Output: '#ececf4', Group: '#5cb8ff' };
  const commit = label => { const g = g0(); if (!g) return; VFX.touch(g); VFX.snap(g, label); U.dirty = true; Recovery.touch(); };

  /* ---------- mount ---------- */
  function mount() {
    if (U.mounted) return; U.mounted = true; root = $$('ws-vfx');
    bar = el('div', { class: 'wsrow', id: 'vfxBar' }); root.append(bar);
    viewer = el('canvas', { class: 'vfxcv' }); overV = el('canvas', { class: 'vfxcv', style: 'pointer-events:auto' });
    tbar = el('div', { class: 'vfxtrans' });
    const vw = el('div', { class: 'vfxview' }, viewer, overV, tbar); insp = el('div', { class: 'vfxinsp' });
    ne = el('div', { class: 'ne', tabindex: '0' }); world = el('div', { class: 'ne-world' }); svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ne-links'); world.append(svg); ne.append(world);
    const split = el('div', { class: 'vfxsplit' });
    root.append(el('div', { class: 'vfxtop' }, vw, insp), split, ne);
    vctxV = viewer.getContext('2d'); octxV = overV.getContext('2d');
    split.onpointerdown = e => { split.setPointerCapture(e.pointerId); const y0 = e.clientY, h0 = ne.offsetHeight; split.onpointermove = ev => { ne.style.height = clamp(h0 - (ev.clientY - y0), 140, innerHeight * .75) + 'px'; }; split.onpointerup = () => split.onpointermove = null; };
    new ResizeObserver(() => { const r = vw.getBoundingClientRect(), d = devicePixelRatio || 1; for (const c of [viewer, overV]) { c.width = Math.max(1, r.width * d); c.height = Math.max(1, (r.height - 38) * d); c.style.height = (r.height - 38) + 'px'; } vctxV.setTransform(d, 0, 0, d, 0, 0); octxV.setTransform(d, 0, 0, d, 0, 0); U.dirty = true; }).observe(vw);
    bindEditor(); bindViewer(); buildTransport(); requestAnimationFrame(loop);
  }
  function enter() { mount(); if (!VFX.S.order.length) { VFX.newGraph({ name: 'Main graph' }); VFX.snap(g0(), 'New graph'); } if (!g0()) VFX.S.active = VFX.S.order[0]; refreshAll(); }
  function open(id) { Shell.go('vfx'); VFX.S.active = id; U.path = []; U.sel.clear(); U.view = null; refreshAll(); }
  function refreshAll() { if (!U.mounted) return; buildBar(); renderGraph(); buildInspector(); U.dirty = true; }

  /* ---------- toolbar ---------- */
  function addNodeMenu(atX, atY) {
    const cats = {}; for (const k in VFX.DEFS) { const d = VFX.DEFS[k]; if (['gin', 'gout', 'output'].includes(k) && !U.path.length) { if (k !== 'output') continue; } if (k === 'output' && U.path.length) continue; (cats[d.cat] = cats[d.cat] || []).push(k); }
    const place = type => { const g = cur(), r = ne.getBoundingClientRect(), x = atX != null ? atX : (r.width / 2 - U.ne.x) / U.ne.z - 80, y = atY != null ? atY : (r.height / 2 - U.ne.y) / U.ne.z - 30; const n = VFX.addNode(g, type, x, y); if (type === 'gin') n.p.index = Object.values(g.nodes).filter(m => m.type === 'gin').length; U.sel = new Set([n.id]); commit('Add ' + VFX.DEFS[type].name); renderGraph(); buildInspector(); };
    const lib = JSON.parse(localStorage.getItem('nexora.vfx.groups') || '[]');
    return [...Object.keys(cats).map(c => ({ label: c, sub: cats[c].map(k => ({ label: VFX.DEFS[k].name, run: () => place(k) })) })), '-', { label: 'Saved groups', sub: lib.length ? lib.map((it, i) => ({ label: it.name, run: () => { const g = cur(), n = VFX.addNode(g, 'group', atX || 200, atY || 200, { nIn: it.nIn, graph: JSON.parse(JSON.stringify(it.graph)), label: it.name }); U.sel = new Set([n.id]); commit('Insert group'); renderGraph(); } })) : [{ label: '(none saved yet)', disabled: true }] }];
  }
  function buildBar() {
    bar.innerHTML = ''; const g = g0(); if (!g) return;
    const sel = el('select', { style: 'min-width:160px', onchange: e => open(e.target.value) }, VFX.list().map(x => el('option', { value: x.id, selected: x.id === g.id ? '' : undefined }, x.name)));
    bar.append(el('b', { style: 'color:var(--acc2)' }, 'VFX'), sel, el('button', { onclick: () => { const n = VFX.newGraph({ name: 'Graph ' + (VFX.S.order.length + 1) }); VFX.snap(n, 'New graph'); open(n.id); } }, 'New'), el('button', { onclick: graphSettings }, 'Settings'),
      el('button', { onclick: () => { const u = VFX.usage()[g.id] || 0; if (u) return toast(`Used ${u}× in Edit/Motion — remove those layers first.`); if (VFX.S.order.length < 2) return toast('Keep at least one graph.'); if (!confirm(`Delete graph "${g.name}"?`)) return; delete VFX.S.graphs[g.id]; VFX.S.order = VFX.S.order.filter(i => i !== g.id); open(VFX.S.order[0]); } }, Icon('trash', 15)),
      el('span', { class: 'dim', style: 'margin-left:6px' }, '|'), el('button', { 'data-pop': '1', onclick: e => PopMenu.at(e.currentTarget, addNodeMenu()) }, 'Add node ▾'),
      el('button', { title: 'Group selected (Ctrl+G)', onclick: groupSel }, 'Group'), el('button', { title: 'Ungroup (Ctrl+Shift+G)', onclick: ungroupSel }, 'Ungroup'), el('button', { title: 'Save the selected group node to the library', onclick: saveGroup }, 'Save group'));
    if (U.path.length) bar.append(el('button', { class: 'primary', onclick: exitGroup }, '◂ Exit group'), el('span', { class: 'dim' }, 'Inside: ' + U.path.map(p => p.node.p.label || 'Group').join(' › ')));
    bar.append(el('div', { class: 'spacer' }), el('span', { class: 'dim' }, `${g.w}×${g.h} · ${g.fps} fps · ${g.dur}s · ${Object.keys(g.nodes).length} nodes`),
      el('button', { 'data-pop': '1', onclick: e => PopMenu.at(e.currentTarget, [{ label: 'Current frame (PNG)', run: exportPNG }, { label: 'Video (MP4, exact frames)', run: exportVideo }]) }, 'Export ▾'),
      el('button', { class: 'primary', onclick: placeInEdit }, 'Place in Edit'));
  }
  function graphSettings() {
    const g = g0(), o = { name: g.name, w: g.w, h: g.h, fps: g.fps, dur: g.dur };
    showModal('Graph settings', el('div', {}, field('Name', o, 'name', 'text'), field('Width', o, 'w', 'num', { min: 16, max: 4096 }), field('Height', o, 'h', 'num', { min: 16, max: 4096 }), field('Frame rate', o, 'fps', 'select', { opts: [24, 25, 30, 50, 60] }), field('Duration (s)', o, 'dur', 'num', { min: .5, max: 600, step: .5 })),
      [['Cancel', closeModal], ['Apply', () => { closeModal(); Object.assign(g, { name: o.name, w: clamp(o.w | 0, 16, 4096), h: clamp(o.h | 0, 16, 4096), fps: +o.fps, dur: Math.max(.5, +o.dur) }); U.t = Math.min(U.t, g.dur); commit('Graph settings'); refreshAll(); }, true]]);
  }
  function placeInEdit() { const g = g0(); Shell.go('edit'); const L = mkLayer('vfx', { name: g.name, graphRef: g.id, start: T, dur: g.dur }); L.tr.s = +(Math.min(P.w / g.w, P.h / g.h) * 100).toFixed(2); addLayer(L); commit(); toast('Placed as a linked VFX layer — graph edits update it.'); }
  async function exportPNG() { const g = g0(); await VFX.prepare(g, U.t); const c = VFX.renderSync(g, U.t, U.view); c.toBlob(b => download(b, g.name + '-' + U.t.toFixed(2) + 's.png'), 'image/png'); }
  async function exportVideo() {
    const g = g0(); let cancel = false; const pm = progressModal('Rendering ' + g.name, () => cancel = true);
    try { const b = await VFX.exportMP4(g, { mbps: 12 }, f => pm.set(`Frame ${Math.round(f * g.dur * g.fps)} / ${Math.round(g.dur * g.fps)}`, f * 100), () => cancel); closeModal(); if (b) { download(b, g.name + '.mp4'); toast('Exported ' + Math.round(b.size / 1024) + ' KB'); } }
    catch (e) { closeModal(); toast('Export failed: ' + e.message); }
  }

  /* ---------- groups ---------- */
  function groupSel() { const g = cur(); if (!U.sel.size) return toast('Select nodes to group (Shift+drag or Ctrl+click).'); const n = VFX.groupNodes(g, [...U.sel]); if (!n) return; U.sel = new Set([n.id]); commit('Group'); renderGraph(); buildInspector(); }
  function ungroupSel() { const g = cur(), id = [...U.sel][0]; if (!id || !g.nodes[id] || g.nodes[id].type !== 'group') return toast('Select a group node.'); VFX.ungroup(g, id); U.sel.clear(); commit('Ungroup'); renderGraph(); buildInspector(); }
  async function saveGroup() { const g = cur(), id = [...U.sel][0], n = id && g.nodes[id]; if (!n || n.type !== 'group') return toast('Select a group node first.'); const name = await askText('Save group as', n.p.label || 'My group'); if (!name) return; n.p.label = name; const lib = JSON.parse(localStorage.getItem('nexora.vfx.groups') || '[]'); lib.push({ name, nIn: n.p.nIn, graph: JSON.parse(JSON.stringify(n.p.graph, (k, v) => k[0] === '_' ? undefined : v)) }); localStorage.setItem('nexora.vfx.groups', JSON.stringify(lib)); renderGraph(); toast('Saved to library: Add node › Saved groups.'); }
  function enterGroup(n) { U.path.push({ node: n }); U.sel.clear(); refreshAll(); }
  function exitGroup() { U.path.pop(); U.sel.clear(); refreshAll(); }

  /* ---------- node editor ---------- */
  const portPos = (n, kind, port) => { const elx = world.querySelector(`[data-node="${n.id}"]`); if (!elx) return { x: n.x, y: n.y }; if (kind === 'out') { const o = elx.querySelector('.pout'); return { x: n.x + o.offsetLeft + 6, y: n.y + o.offsetTop + 6 }; } const i = elx.querySelector(`.nin[data-port="${port}"] .pdot`); return i ? { x: n.x + i.offsetLeft + i.parentElement.offsetLeft + 6, y: n.y + i.parentElement.offsetTop + i.offsetTop + 6 } : { x: n.x, y: n.y }; };
  const curve = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) * .5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
  function applyNE() { world.style.transform = `translate(${U.ne.x}px,${U.ne.y}px) scale(${U.ne.z})`; }
  function renderGraph() {
    const g = cur(); if (!g) return; world.querySelectorAll('.nnode').forEach(n => n.remove()); applyNE();
    for (const n of Object.values(g.nodes)) {
      const d = VFX.DEFS[n.type], ins = VFX.insOf(n), viewed = !U.path.length && (U.view ? U.view === n.id : n.type === 'output');
      const node = el('div', { class: 'nnode' + (U.sel.has(n.id) ? ' sel' : '') + (viewed ? ' viewed' : ''), 'data-node': n.id, style: `left:${n.x}px;top:${n.y}px` });
      const head = el('div', { class: 'nhead', style: `border-top:3px solid ${CAT_COL[d.cat] || '#888'}` }, el('span', { class: 'nt' }, n.p.label || d.name));
      if (!U.path.length && n.type !== 'gin' && n.type !== 'gout') head.append(el('span', { class: 'neye', title: 'View this node (1)', onclick: e => { e.stopPropagation(); U.view = n.type === 'output' ? null : n.id; renderGraph(); U.dirty = true; } }, Icon('eye', 13)));
      if (n.type !== 'output' && n.type !== 'gout') head.append(el('i', { class: 'pout', title: 'Output — drag to an input' }));
      node.append(head); const body = el('div', { class: 'nbody' }); ins.forEach((lab, i) => body.append(el('div', { class: 'nin', 'data-port': i }, el('i', { class: 'pdot' }), lab)));
      if (n.type === 'group') body.append(el('div', { class: 'dim', style: 'font-size:10px' }, `${Object.keys(n.p.graph.nodes).length - 1} nodes · double-click to open`));
      if (!ins.length && n.type !== 'gin') body.append(el('div', { class: 'dim', style: 'font-size:10px' }, d.cat));
      node.append(body); world.append(node);
    }
    drawLinks();
  }
  function drawLinks(temp) {
    const g = cur(); let html = '';
    for (const l of g.links) { const a = g.nodes[l.from], b = g.nodes[l.to]; if (!a || !b) continue; html += `<path d="${curve(portPos(a, 'out'), portPos(b, 'in', l.port))}" class="lk"/>`; }
    if (temp) html += `<path d="${curve(temp.a, temp.b)}" class="lk tmp"/>`;
    svg.innerHTML = html;
  }
  function toWorld(e) { const r = ne.getBoundingClientRect(); return { x: (e.clientX - r.left - U.ne.x) / U.ne.z, y: (e.clientY - r.top - U.ne.y) / U.ne.z }; }
  function bindEditor() {
    let drag = null;
    ne.addEventListener('pointerdown', e => {
      ne.focus(); const g = cur(), nodeEl = e.target.closest('.nnode');
      if (e.target.classList.contains('pout')) { const n = g.nodes[nodeEl.dataset.node]; drag = { type: 'link', from: n.id, a: portPos(n, 'out') }; ne.setPointerCapture(e.pointerId); return; }
      if (e.target.closest('.nin') && nodeEl) { const port = +e.target.closest('.nin').dataset.port, to = nodeEl.dataset.node, l = g.links.find(l => l.to === to && l.port === port); if (l) { g.links = g.links.filter(x => x !== l); drag = { type: 'link', from: l.from, a: portPos(g.nodes[l.from], 'out'), detached: true }; ne.setPointerCapture(e.pointerId); drawLinks(); return; } }
      if (nodeEl) { const id = nodeEl.dataset.node; if (e.ctrlKey || e.metaKey) { U.sel.has(id) ? U.sel.delete(id) : U.sel.add(id); } else if (!U.sel.has(id)) U.sel = new Set([id]); const p0 = toWorld(e); drag = { type: 'move', p0, start: [...U.sel].map(i => [i, g.nodes[i].x, g.nodes[i].y]), moved: false }; ne.setPointerCapture(e.pointerId); renderGraph(); buildInspector(); return; }
      if (e.button === 2) return;
      if (e.shiftKey) { drag = { type: 'box', p0: toWorld(e), box: el('div', { class: 'nebox' }) }; world.append(drag.box); }
      else { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, x: U.ne.x, y: U.ne.y }; if (U.sel.size) { U.sel.clear(); renderGraph(); buildInspector(); } }
      ne.setPointerCapture(e.pointerId);
    });
    ne.addEventListener('pointermove', e => {
      if (!drag) return; const g = cur();
      if (drag.type === 'pan') { U.ne.x = drag.x + e.clientX - drag.sx; U.ne.y = drag.y + e.clientY - drag.sy; applyNE(); }
      else if (drag.type === 'move') { const p = toWorld(e), dx = p.x - drag.p0.x, dy = p.y - drag.p0.y; drag.moved = true; drag.start.forEach(([id, x, y]) => { g.nodes[id].x = Math.round(x + dx); g.nodes[id].y = Math.round(y + dy); const n = world.querySelector(`[data-node="${id}"]`); n.style.left = g.nodes[id].x + 'px'; n.style.top = g.nodes[id].y + 'px'; }); drawLinks(); }
      else if (drag.type === 'link') drawLinks({ a: drag.a, b: toWorld(e) });
      else if (drag.type === 'box') { const p = toWorld(e), x = Math.min(p.x, drag.p0.x), y = Math.min(p.y, drag.p0.y); Object.assign(drag.box.style, { left: x + 'px', top: y + 'px', width: Math.abs(p.x - drag.p0.x) + 'px', height: Math.abs(p.y - drag.p0.y) + 'px' }); drag.rect = { x, y, w: Math.abs(p.x - drag.p0.x), h: Math.abs(p.y - drag.p0.y) }; }
    });
    ne.addEventListener('pointerup', e => {
      if (!drag) return; const g = cur(), d = drag; drag = null;
      if (d.type === 'move' && d.moved) commit('Move nodes');
      if (d.type === 'link') { const hit = document.elementFromPoint(e.clientX, e.clientY), inEl = hit && hit.closest('.nin'), nodeEl = hit && hit.closest('.nnode'); if (inEl && nodeEl) { if (!VFX.connect(g, d.from, nodeEl.dataset.node, +inEl.dataset.port)) toast('That connection would create a loop.'); commit('Connect'); } else if (d.detached) commit('Disconnect'); renderGraph(); }
      if (d.type === 'box') { d.box.remove(); if (d.rect) { U.sel = new Set(Object.values(g.nodes).filter(n => n.x + 80 > d.rect.x && n.x < d.rect.x + d.rect.w && n.y + 30 > d.rect.y && n.y < d.rect.y + d.rect.h).map(n => n.id)); renderGraph(); buildInspector(); } }
    });
    ne.addEventListener('dblclick', e => { const nodeEl = e.target.closest('.nnode'); if (!nodeEl) return; const n = cur().nodes[nodeEl.dataset.node]; if (n.type === 'group') enterGroup(n); else if (!U.path.length) { U.view = n.type === 'output' ? null : n.id; renderGraph(); U.dirty = true; } });
    ne.addEventListener('wheel', e => { e.preventDefault(); const r = ne.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, z = clamp(U.ne.z * Math.exp(-e.deltaY * .0015), .2, 2.5); U.ne.x = mx - (mx - U.ne.x) * z / U.ne.z; U.ne.y = my - (my - U.ne.y) * z / U.ne.z; U.ne.z = z; applyNE(); }, { passive: false });
    ne.addEventListener('contextmenu', e => { e.preventDefault(); const p = toWorld(e), nodeEl = e.target.closest('.nnode'); if (nodeEl) { const id = nodeEl.dataset.node; U.sel = new Set([id]); renderGraph(); PopMenu.open(e.clientX, e.clientY, [{ label: 'View this node', run: () => { U.view = cur().nodes[id].type === 'output' ? null : id; renderGraph(); U.dirty = true; } }, { label: 'Duplicate', run: dupSel }, { label: 'Group', run: groupSel }, { label: 'Delete', run: delSel }]); } else PopMenu.open(e.clientX, e.clientY, addNodeMenu(p.x - 80, p.y - 20)); });
    ne.addEventListener('keydown', e => {
      const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); delSel(); }
      else if (c && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); }
      else if (c && k === 'd') { e.preventDefault(); dupSel(); }
      else if (k === 'f') { fitGraph(); }
      else if (k === 'escape' && U.path.length) exitGroup();
    });
  }
  function delSel() { const g = cur(); [...U.sel].forEach(id => VFX.removeNode(g, id)); U.sel.clear(); commit('Delete nodes'); renderGraph(); buildInspector(); }
  function dupSel() { const g = cur(), map = {}; [...U.sel].forEach(id => { const n = g.nodes[id]; if (!n || n.type === 'output' || n.type === 'gout') return; const c = JSON.parse(JSON.stringify(n, (k, v) => k[0] === '_' ? undefined : v)); c.id = uid(); c.x += 30; c.y += 40; g.nodes[c.id] = c; map[id] = c.id; }); g.links.filter(l => map[l.from] && map[l.to]).forEach(l => g.links.push({ from: map[l.from], to: map[l.to], port: l.port })); U.sel = new Set(Object.values(map)); commit('Duplicate nodes'); renderGraph(); }
  function fitGraph() { const g = cur(), ns = Object.values(g.nodes); if (!ns.length) return; const r = ne.getBoundingClientRect(), x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x)) + 180, y1 = Math.max(...ns.map(n => n.y)) + 120; U.ne.z = clamp(Math.min(r.width / (x1 - x0 + 60), r.height / (y1 - y0 + 60)), .2, 1.4); U.ne.x = (r.width - (x1 - x0) * U.ne.z) / 2 - x0 * U.ne.z; U.ne.y = (r.height - (y1 - y0) * U.ne.z) / 2 - y0 * U.ne.z; applyNE(); }

  /* ---------- inspector ---------- */
  function buildInspector() {
    insp.innerHTML = ''; const g = cur(), id = U.sel.size === 1 ? [...U.sel][0] : null, n = id && g.nodes[id];
    if (!n) { const r = g0(); insp.append(el('div', { class: 'sec' }, el('b', {}, r.name), el('div', { class: 'dim' }, `${r.w}×${r.h} · ${r.fps} fps · ${r.dur}s`), el('div', { class: 'dim', style: 'margin-top:8px;line-height:1.6' }, 'Right-click the node area to add nodes · drag from a node\'s ● output to an input · Shift+drag to box-select · Ctrl+G group · double-click a group to open it · the eye icon views a node · F fits the graph'), el('button', { onclick: graphSettings, style: 'margin-top:8px' }, 'Graph settings'))); return; }
    const d = VFX.DEFS[n.type], ch = () => { VFX.touch(g0()); U.dirty = true; }, cm = () => commit('Edit ' + d.name);
    const box = el('div', { class: 'sec' }, el('b', {}, d.name), el('div', { class: 'dim' }, d.cat));
    for (const q of d.params) {
      if (q.type === 'num') box.append(nfield(q.label, n.p, q.k, q, ch, cm));
      else if (q.type === 'color') box.append(field(q.label, n.p, q.k, 'color', { cb: ch }));
      else if (q.type === 'check') box.append(field(q.label, n.p, q.k, 'check', { cb: () => { ch(); } }));
      else if (q.type === 'text') { const r = field(q.label, n.p, q.k, 'text', { cb: ch }); box.append(r); }
      else if (q.type === 'sel') box.append(field(q.label, n.p, q.k, 'select', { opts: q.opts, names: q.names, cb: () => { ch(); if (q.k === 'adj') { n.p.ap = null; buildInspector(); } } }));
      else if (q.type === 'media') box.append(el('div', { class: 'frow' }, el('label', {}, q.label), el('select', { onchange: e => { n.p.media = e.target.value; ch(); cm(); } }, el('option', { value: '' }, '— choose asset —'), Object.values(media).filter(m => m.kind !== 'audio').map(m => el('option', { value: m.id, selected: m.id === n.p.media ? '' : undefined }, m.name)))), el('button', { onclick: () => { $$('fileIn').click(); } }, 'Import media…'));
      else if (q.type === 'comp') box.append(el('div', { class: 'frow' }, el('label', {}, q.label), el('select', { onchange: e => { n.p.comp = e.target.value; ch(); cm(); } }, el('option', { value: '' }, '— choose composition —'), Motion.list().map(c => el('option', { value: c.id, selected: c.id === n.p.comp ? '' : undefined }, c.name)))));
      else if (q.type === 'adj') { if (!n.p.ap || n.p.ap._t !== n.p.adj) n.p.ap = Object.assign(ADJ.defs[n.p.adj].p(), { _t: n.p.adj }); const ap = n.p.ap; Object.keys(ap).filter(k => k !== '_t').forEach(k => { const v = ap[k]; if (typeof v === 'number') box.append(nfield(k, ap, k, { min: k === 'g' || k === 'gamma' ? .1 : k === 'n' ? 2 : -200, max: k === 'g' || k === 'gamma' ? 3 : k === 't' || k === 'ib' || k === 'iw' || k === 'ob' || k === 'ow' ? 255 : 200, step: k === 'g' || k === 'gamma' || k === 'ev' || k === 'offset' ? .01 : 1 }, ch, cm)); else if (typeof v === 'boolean') box.append(field(k, ap, k, 'check', { cb: ch })); else if (typeof v === 'string' && v[0] === '#') box.append(field(k, ap, k, 'color', { cb: ch })); }); }
      else if (q.type === 'roto') box.append(rotoTools(n));
      else if (q.type === 'track') box.append(trackTools(n));
    }
    if (n.type === 'group') box.append(field('Label', n.p, 'label', 'text', { cb: () => renderGraph() }), field('Inputs', n.p, 'nIn', 'num', { min: 1, max: 8, cb: () => { renderGraph(); ch(); } }), el('button', { class: 'primary', onclick: () => enterGroup(n) }, 'Open group'));
    insp.append(box);
  }
  function nfield(label, obj, key, q, on, commitFn) {
    const row = el('div', { class: 'prop' }, el('label', { title: label }, label)), r = el('input', { type: 'range', min: q.min, max: q.max, step: q.step || 1, value: obj[key] }), nI = el('input', { type: 'number', step: q.step || 1, value: obj[key] });
    r.oninput = () => { obj[key] = +r.value; nI.value = r.value; on(); }; nI.oninput = () => { if (nI.value !== '') { obj[key] = +nI.value; r.value = nI.value; on(); } }; r.onchange = nI.onchange = commitFn; row.append(r, nI); return row;
  }
  function rotoTools(n) {
    const p = n.p, keys = p.keys || (p.keys = []), at = keys.find(k => Math.abs(k.t - U.t) < .5 / g0().fps);
    return el('div', {}, el('div', { class: 'dim' }, `${keys.length} shape key(s)${keys.length ? ' · ' + keys[0].pts.length + ' points' : ''}`),
      el('div', { class: 'frow', style: 'flex-wrap:wrap' }, el('button', { class: U.mode === 'roto' ? 'primary' : '', onclick: () => { U.mode = U.mode === 'roto' ? null : 'roto'; U.dirty = true; buildInspector(); } }, U.mode === 'roto' ? 'Editing shape' : 'Edit shape in viewer'),
        el('button', { onclick: () => { const pts = VFX.rotoPts(p, U.t).map(q => q.slice()); if (!pts.length) return toast('Click in the viewer to place points first.'); if (at) at.pts = pts; else { keys.push({ t: U.t, pts }); keys.sort((a, b) => a.t - b.t); } commit('Roto key'); buildInspector(); } }, 'Key here'),
        el('button', { disabled: at ? undefined : '', onclick: () => { keys.splice(keys.indexOf(at), 1); commit('Delete roto key'); buildInspector(); U.dirty = true; } }, 'Delete key'), el('button', { onclick: () => { p.keys = []; commit('Clear roto'); buildInspector(); U.dirty = true; } }, 'Clear')),
      el('div', { class: 'dim' }, 'In edit mode: click to add points (first shape), drag points to move them — moving auto-keys at the current time. Shape animates between keys.'));
  }
  function trackTools(n) {
    const p = n.p, cnt = p.track ? Object.keys(p.track).length : 0;
    return el('div', {}, el('div', { class: 'dim' }, cnt ? `${cnt} tracked frames` : 'Not tracked yet'),
      el('div', { class: 'frow', style: 'flex-wrap:wrap' }, el('button', { class: U.mode === 'track' ? 'primary' : '', onclick: () => { U.mode = U.mode === 'track' ? null : 'track'; U.dirty = true; buildInspector(); } }, U.mode === 'track' ? 'Click the feature…' : 'Pick point in viewer'),
        el('button', { class: 'primary', onclick: async () => { let cancel = false; const pm = progressModal('Tracking…', () => cancel = true); try { const k = await VFX.analyzeTrack(g0(), n, f => pm.set(Math.round(f * 100) + '%', f * 100), () => cancel); closeModal(); commit('Track'); buildInspector(); toast(k + ' frames tracked.'); } catch (e) { closeModal(); toast(e.message); } } }, 'Analyze'),
        el('button', { onclick: () => { p.track = null; commit('Clear track'); buildInspector(); } }, 'Clear')));
  }

  /* ---------- viewer ---------- */
  function vgeo() { const g = g0(), r = overV.getBoundingClientRect(), k = Math.min((r.width - 20) / g.w, (r.height - 20) / g.h); return { k, x: (r.width - g.w * k) / 2, y: (r.height - g.h * k) / 2, r }; }
  function loop(now) {
    requestAnimationFrame(loop); if (!U.mounted || Shell.active !== 'vfx') return; const g = g0(); if (!g) return;
    if (U.playing) { const dt = (now - (U.last || now)) / 1000; U.t += dt; if (U.t >= g.dur) U.t = 0; U.dirty = true; } U.last = now;
    if (!U.dirty) return; U.dirty = false; VFX.ensure(g, U.t);
    const c = VFX.renderSync(g, U.t, U.path.length ? null : U.view), G = vgeo(), x = vctxV; x.clearRect(0, 0, G.r.width, G.r.height);
    x.fillStyle = '#0a0a0e'; x.fillRect(0, 0, G.r.width, G.r.height); for (let yy = 0; yy < g.h * G.k; yy += 12) for (let xx = 0; xx < g.w * G.k; xx += 12) { x.fillStyle = ((xx + yy) / 12) % 2 ? '#22222b' : '#1a1a21'; x.fillRect(G.x + xx, G.y + yy, 12, 12); }
    if (c) x.drawImage(c, G.x, G.y, g.w * G.k, g.h * G.k); drawOverlay(G); syncTransport();
  }
  function drawOverlay(G) {
    const o = octxV; o.clearRect(0, 0, G.r.width, G.r.height); const g = cur(), id = [...U.sel][0], n = id && g.nodes[id]; if (!n) return; const S2 = (px, py) => [G.x + px * G.k, G.y + py * G.k];
    if (n.type === 'roto') { const pts = VFX.rotoPts(n.p, U.t); o.strokeStyle = '#ffd23f'; o.lineWidth = 1.5; o.beginPath(); pts.forEach((q, i) => { const [a, b] = S2(q[0], q[1]); i ? o.lineTo(a, b) : o.moveTo(a, b); }); if (pts.length > 2) o.closePath(); o.stroke(); o.fillStyle = '#fff'; pts.forEach(q => { const [a, b] = S2(q[0], q[1]); o.fillRect(a - 4, b - 4, 8, 8); }); }
    if (n.type === 'tracker') { const pos = VFX.trackAt(n.p, U.t, g0().fps) || [n.p.px, n.p.py], [a, b] = S2(pos[0], pos[1]), r = n.p.patch * G.k, R2 = (n.p.patch + n.p.search) * G.k; o.strokeStyle = '#3b9bff'; o.strokeRect(a - r, b - r, r * 2, r * 2); o.setLineDash([4, 4]); o.strokeRect(a - R2, b - R2, R2 * 2, R2 * 2); o.setLineDash([]); if (n.p.track) { o.strokeStyle = '#5cb8ff'; o.beginPath(); Object.keys(n.p.track).map(Number).sort((p1, p2) => p1 - p2).forEach((f, i) => { const [x1, y1] = S2(...n.p.track[f]); i ? o.lineTo(x1, y1) : o.moveTo(x1, y1); }); o.stroke(); } }
  }
  function bindViewer() {
    let drag = null;
    const docPt = e => { const G = vgeo(), r = overV.getBoundingClientRect(); return [(e.clientX - r.left - G.x) / G.k, (e.clientY - r.top - G.y) / G.k, G.k]; };
    overV.addEventListener('pointerdown', e => {
      const g = cur(), n = g.nodes[[...U.sel][0]]; if (!n) return; const [px, py, k] = docPt(e);
      if (U.mode === 'track' && n.type === 'tracker') { n.p.px = Math.round(px); n.p.py = Math.round(py); n.p.t0 = U.t; n.p.track = null; U.mode = null; commit('Tracker point'); buildInspector(); U.dirty = true; return; }
      if (U.mode === 'roto' && n.type === 'roto') {
        const keys = n.p.keys, pts = VFX.rotoPts(n.p, U.t).map(q => q.slice()), hit = pts.findIndex(q => Math.hypot(q[0] - px, q[1] - py) < 8 / k);
        if (hit >= 0) { drag = { n, i: hit, pts }; overV.setPointerCapture(e.pointerId); return; }
        if (keys.length <= 1) { if (!keys.length) keys.push({ t: U.t, pts: [] }); keys[0].pts.push([px, py]); commit('Roto point'); buildInspector(); U.dirty = true; }
        else { VFX.rotoInsert(n.p, U.t, px, py, g0().fps); commit('Roto point'); buildInspector(); U.dirty = true; }
      }
    });
    overV.addEventListener('pointermove', e => { if (!drag) return; const [px, py] = docPt(e); drag.pts[drag.i] = [px, py]; const keys = drag.n.p.keys, fps = g0().fps, at = keys.find(k => Math.abs(k.t - U.t) < .5 / fps); if (at) at.pts = drag.pts.map(q => q.slice()); else { keys.push({ t: U.t, pts: drag.pts.map(q => q.slice()) }); keys.sort((a, b) => a.t - b.t); } VFX.touch(g0()); U.dirty = true; });
    overV.addEventListener('pointerup', () => { if (drag) { drag = null; commit('Move roto point'); buildInspector(); } });
  }
  function buildTransport() {
    timeIn = el('input', { type: 'range', min: 0, max: 1000, value: 0, style: 'flex:1' }); tRead = el('span', { class: 'dim', style: 'font:12px Consolas;min-width:110px' });
    const pb = el('button', { class: 'primary', onclick: () => { U.playing = !U.playing; pb.textContent = U.playing ? '⏸' : '▶'; } }, '▶');
    timeIn.oninput = () => { const g = g0(); U.t = +timeIn.value / 1000 * g.dur; U.dirty = true; if (U.mode || U.sel.size) buildInspectorSoft(); };
    tbar.append(el('button', { onclick: () => { U.t = 0; U.dirty = true; } }, '⏮'), el('button', { onclick: () => { U.t = Math.max(0, U.t - 1 / g0().fps); U.dirty = true; } }, '◂'), pb, el('button', { onclick: () => { U.t = Math.min(g0().dur, U.t + 1 / g0().fps); U.dirty = true; } }, '▸'), timeIn, tRead);
  }
  let softT = null; function buildInspectorSoft() { clearTimeout(softT); softT = setTimeout(buildInspector, 150); }
  function syncTransport() { const g = g0(); timeIn.value = Math.round(U.t / g.dur * 1000); tRead.textContent = `${U.t.toFixed(2)}s / ${g.dur}s · f${Math.round(U.t * g.fps)}`; }
  window.addEventListener('keydown', e => {
    if (Shell.active !== 'vfx') return; const tg = e.target; if (tg.matches && tg.matches('input:not([type=range]):not([type=checkbox]),textarea,select')) return;
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (c && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (c && k === 'y') { e.preventDefault(); redo(); }
    else if (e.key === ' ' && tg === document.body) { e.preventDefault(); U.playing = !U.playing; }
    else if (k === '1' && !c) { const id = [...U.sel][0]; if (id && !U.path.length) { U.view = id; renderGraph(); U.dirty = true; } } else if (k === '0' && !c) { U.view = null; renderGraph(); U.dirty = true; }
  });
  function undo() { const g = g0(); if (g && VFX.jump(g, g.histI - 1)) { U.path = []; refreshAll(); } }
  function redo() { const g = g0(); if (g && VFX.jump(g, g.histI + 1)) { U.path = []; refreshAll(); } }
  Object.assign(U, { enter, open, refreshAll, undo, redo, redraw: () => { U.dirty = true; }, renderGraph, buildInspector, placeInEdit, exitGroup, enterGroup, cur, fitGraph });
  return U;
})();
