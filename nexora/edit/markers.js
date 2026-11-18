'use strict';
/* ====================== NEXORA markers: names, colours, notes, list, chapters ======================
   P.markers stays a sorted list of times (everything that moves markers keeps working). Their names, colours and
   notes live in P.markerInfo, keyed by time; every place that shifts marker times goes through mapTimes(), which
   re-keys the info with the same function, so a ripple delete or a speed change carries the names along.
   The list (timeline toolbar › Markers) jumps, edits and deletes, and copies YouTube chapters / exports CSV. */
const Markers = (() => {
  const COLORS = { sky: ['Sky', '#4a9bd6'], ice: ['Ice', '#8fc9f0'], white: ['White', '#e6eaee'], azure: ['Azure', '#2f6fb8'], navy: ['Navy', '#1d3d73'], steel: ['Steel', '#6b8299'], frost: ['Frost', '#bfe3fa'], slate: ['Slate', '#4d5a66'] };
  const key = t => (+t).toFixed(4);
  const store = () => P.markerInfo || (P.markerInfo = {});
  const list = () => (P.markers || []).slice().sort((a, b) => a - b);
  function info(t) { return store()[key(t)] || { name: '', color: 'sky', note: '' }; }
  function setInfo(t, o) { const k = key(t), cur = Object.assign({ name: '', color: 'sky', note: '' }, store()[k], o); if (!cur.name && !cur.note && cur.color === 'sky') delete store()[k]; else store()[k] = cur; }
  /** move every marker with fn(t) → t' and carry its info along */
  function mapTimes(fn) {
    const old = store(), next = {}; P.markers = (P.markers || []).map(t => { const n = fn(t); if (old[key(t)]) next[key(n)] = old[key(t)]; return n; }); P.markerInfo = next;
  }
  function add(t, o) { P.markers = P.markers || []; const q = frameQ(t); let m = P.markers.find(x => Math.abs(x - q) < .02); if (m == null) { P.markers.push(q); P.markers.sort((a, b) => a - b); m = q; } if (o) setInfo(m, o); commit(); renderTimeline(); return m; }
  function remove(t) { const i = (P.markers || []).findIndex(x => Math.abs(x - t) < 1e-6); if (i < 0) return; P.markers.splice(i, 1); delete store()[key(t)]; commit(); renderTimeline(); }
  function clear() { P.markers = []; P.markerInfo = {}; commit(); renderTimeline(); }
  /** YouTube chapters: "0:00 Name" lines; the first chapter must start at 0:00 */
  function chapters() {
    const ms = list(); if (!ms.length) return ''; const fmt = t => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
    const rows = ms.map((t, i) => [t, info(t).name || 'Chapter ' + (i + 1)]); if (rows[0][0] > .5) rows.unshift([0, 'Intro']); return rows.map(([t, n]) => fmt(t) + ' ' + n).join('\n');
  }
  function csv() { const q = s => '"' + String(s).replace(/"/g, '""') + '"'; return ['Timecode,Seconds,Name,Colour,Note', ...list().map(t => { const i = info(t); return [tcFull(t), t.toFixed(3), q(i.name), COLORS[i.color] ? COLORS[i.color][0] : i.color, q(i.note)].join(','); })].join('\r\n'); }

  /* ---------- editor popover (double-click a marker) ---------- */
  function edit(t, x, y) {
    const pop = document.getElementById('menuPop'), i = info(t); pop.innerHTML = '';
    const name = el('input', { value: i.name, placeholder: 'Marker name', class: 'mk-name' }), note = el('textarea', { placeholder: 'Note', rows: 2 }, i.note); let col = i.color;
    const sw = el('div', { class: 'cm-sw' }, ...Object.entries(COLORS).map(([k, [n, c]]) => el('button', { class: 'cm-dot' + (k === col ? ' on' : ''), title: n, style: `background:${c}`, onclick: e => { col = k; sw.querySelectorAll('.cm-dot').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } })));
    const save = () => { setInfo(t, { name: name.value.trim(), note: note.value.trim(), color: col }); commit(); renderTimeline(); pop.classList.add('hidden'); if (S.list) openList(); };
    name.onkeydown = e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') pop.classList.add('hidden'); e.stopPropagation(); }; note.onkeydown = e => e.stopPropagation();
    pop.append(el('div', { class: 'cm-title' }, 'Marker at ' + tcFull(t)), el('div', { class: 'mk-edit' }, name, sw, note, el('div', { class: 'mk-btns' }, el('button', { onclick: () => { pop.classList.add('hidden'); remove(t); if (S.list) openList(); } }, 'Delete'), el('div', { class: 'spacer' }), el('button', { onclick: () => pop.classList.add('hidden') }, 'Cancel'), el('button', { class: 'primary', onclick: save }, 'Save'))));
    pop.classList.remove('hidden'); const r = pop.getBoundingClientRect(); pop.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; pop.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px'; name.focus(); name.select();
  }
  /* ---------- the list ---------- */
  const S = { list: false };
  function openList() {
    S.list = true; const ms = list();
    const rows = ms.length ? ms.map((t, n) => { const i = info(t), c = (COLORS[i.color] || COLORS.sky)[1];
      return el('div', { class: 'mk-row', onclick: () => seek(t) }, el('i', { style: `background:${c}` }), el('span', { class: 'mono' }, tcFull(t)), el('div', { class: 'mk-txt' }, el('b', {}, i.name || 'Marker ' + (n + 1)), i.note ? el('small', {}, i.note) : ''),
        el('button', { class: 'ibtn', title: 'Edit', onclick: e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); edit(t, r.left - 200, r.bottom + 4); } }, 'Edit'), el('button', { class: 'ibtn', title: 'Delete', onclick: e => { e.stopPropagation(); remove(t); openList(); } }, '✕')); })
      : [el('p', { class: 'dim' }, 'No markers yet. Press M at the playhead, then double-click a marker on the ruler to name it.')];
    showModal(`Markers (${ms.length})`, el('div', { class: 'mk-list' }, ...rows), [
      ['Copy YouTube chapters', () => { const c = chapters(); if (!c) return toast('Add markers first.'); navigator.clipboard.writeText(c).then(() => toast('Chapters copied: paste them into the video description.'), () => toast('Could not copy')); }],
      ['Export CSV', () => { if (!ms.length) return toast('Add markers first.'); download(new Blob([csv()], { type: 'text/csv' }), (P.name || 'markers').replace(/[^\w -]+/g, '') + ' markers.csv'); }],
      ['Clear all', () => { if (ms.length && confirm('Delete all markers?')) { clear(); openList(); } }],
      ['Done', () => { S.list = false; closeModal(); }, true]]);
  }
  // toolbar button
  setTimeout(() => { const bar = document.getElementById('tlbar'), ref = document.getElementById('tRowH'); if (bar && ref && !document.getElementById('tMarkers')) ref.before(el('button', { id: 'tMarkers', class: 'ibtn', title: 'Marker list: names, colours, notes, YouTube chapters', onclick: openList }, Icon('star', 14), 'Markers')); }, 0);
  return { COLORS, key, info, setInfo, mapTimes, add, remove, clear, chapters, csv, edit, openList, list, S };
})();
