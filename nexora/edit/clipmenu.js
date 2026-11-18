'use strict';
/* ====================== NEXORA timeline clip menu ======================
   Right-click a clip: the editing commands that act on it, its colour label, and shortcuts into the other pages.
   Colour labels are stored on the clip (L.label) and saved with the project; they stay in the black / blue / white
   family so the timeline reads as one interface. */
const CLIP_LABELS = { ice: ['Ice', '#8fc9f0'], sky: ['Sky', '#4a9bd6'], azure: ['Azure', '#2f6fb8'], navy: ['Navy', '#1d3d73'], steel: ['Steel', '#4d6378'], slate: ['Slate', '#36404c'], graphite: ['Graphite', '#24292f'], white: ['White', '#c9d3dc'] };
const ClipMenu = (() => {
  const done = msg => { commit(); structChanged(); if (msg) toast(msg); };
  const SPEEDS = [.25, .5, .75, 1, 1.5, 2, 4];
  /** change speed keeping the same source range: the clip gets longer or shorter, keyframes stretch with it, and
      clips that start at or after its old end move by the same amount (ripple) so nothing overlaps or leaves a gap */
  function setSpeed(L, s) {
    s = clamp(s, .0625, 16); if (Math.abs(L.speed - s) < 1e-6) return;
    const oldEnd = L.start + L.dur, k = L.speed / s, nd = Math.max(1 / (P.fps || 30), L.dur * k), d = nd - L.dur;
    for (const key in L.kf) L.kf[key].forEach(f => f.t *= k);
    for (const X of P.layers) if (X !== L && X.start >= oldEnd - 1e-4) X.start = Math.max(0, +(X.start + d).toFixed(4));
    Markers.mapTimes(m => m >= oldEnd - 1e-4 ? m + d : m);
    L.speed = s; L.dur = +nd.toFixed(4); const end = Math.max(...P.layers.map(x => x.start + x.dur)); if (end > P.dur) P.dur = Math.ceil(end);
    done(`${L.name}: ${Math.round(s * 100)} % speed, now ${nd.toFixed(2)} s`);
  }
  function items(L) {
    const inside = T > L.start + 1e-3 && T < L.start + L.dur - 1e-3, av = L.type === 'video' || L.type === 'audio', pic = L.type !== 'audio';
    const it = [
      ['Split at playhead', () => { selId = L.id; doSplit(); }, 'S', !inside],
      ['Duplicate', () => { duplicateLayer(L); commit(); }, 'Ctrl+D'],
      ['Delete', () => { selId = L.id; doDelete(); }, 'Del'],
      ['Ripple delete', () => { selId = L.id; Pro.rippleDelete(); }, 'Shift+Del'],
      null,
      [L.visible ? 'Disable clip' : 'Enable clip', () => { L.visible = !L.visible; done(); requestRender(); }],
      av && [L.muted ? 'Unmute' : 'Mute', () => { L.muted = !L.muted; done(); requestRender(); }],
      [L.locked ? 'Unlock' : 'Lock', () => { L.locked = !L.locked; done(); }],
      ['Mark In / Out to clip', () => { selId = L.id; Pro.markClip(); }, 'X'],
      ['Nest clip', () => Nest.nest([L])],
      L.mc && ['Flatten multicam', () => Multicam.flatten(L)],
      av && media[L.media] && ['Clean up voice…', () => Cleanup.dialog(L)],
      L.cleanOf && ['Restore original sound', () => Cleanup.restore(L)],
      av && media[L.media] && [P.beatGrid && P.beatGrid.layer === L.id ? 'Find the beat again' : 'Beat grid (snap to beat)', () => BeatGrid.detect(L)],
      P.beatGrid && P.beatGrid.layer === L.id && ['Beats to markers', () => toast(BeatGrid.toMarkers() + ' markers added')],
      P.beatGrid && P.beatGrid.layer === L.id && ['Clear beat grid', () => BeatGrid.clear()],
      null,
      av && ['speed'],
      pic && ['Grade in Color', () => { selId = L.id; if (T < L.start || T >= L.start + L.dur) seek(L.start + Math.min(1, L.dur / 2)); Shell.go('color'); }],
      L.type === 'video' && ['Freeze frame at playhead', () => { selId = L.id; freezeFrame(); }, '', !inside],
      av && media[L.media] && ['Show in Media Pool', () => { if (typeof selMedia !== 'undefined') selMedia = L.media; leftTab = 'media'; buildLeft(); }]
    ].filter(x => x !== false && x !== undefined);
    while (it.length && it[it.length - 1] === null) it.pop();
    return it;
  }
  function open(L, x, y) {
    const pop = document.getElementById('menuPop'); pop.innerHTML = '';
    pop.append(el('div', { class: 'cm-title' }, L.name));
    for (const it of items(L)) {
      if (!it) { pop.append(el('hr')); continue; }
      if (it[0] === 'speed') { const row = el('div', { class: 'cm-speed' }, el('small', {}, 'Speed'));
        for (const s of SPEEDS) row.append(el('button', { class: Math.abs(L.speed - s) < 1e-6 ? 'on' : '', title: `${Math.round(s * 100)} % — later clips move to keep the cut`, onclick: () => { pop.classList.add('hidden'); setSpeed(L, s); } }, s < 1 ? Math.round(s * 100) + '%' : s + '×'));
        pop.append(row);
        const rr = el('div', { class: 'cm-speed cm-ramp' }, el('small', {}, 'Ramp'));
        for (const [k, p] of Object.entries(Ramp.PRESETS)) rr.append(el('button', { class: L.ramp && L.ramp.preset === k ? 'on' : '', title: p.name + ': same footage, the speed follows a curve; later clips move', onclick: () => { pop.classList.add('hidden'); Ramp.apply(L, k); } }, p.name.split(' (')[0]));
        if (L.ramp) rr.append(el('button', { title: 'Put the original clip back', onclick: () => { pop.classList.add('hidden'); Ramp.unramp(L); } }, 'Remove'));
        pop.append(rr); continue; }
      pop.append(el('button', { disabled: it[3] ? '' : undefined, onclick: () => { pop.classList.add('hidden'); it[1](); } }, it[0], el('kbd', {}, it[2] || '')));
    }
    const sw = el('div', { class: 'cm-labels' }, el('small', {}, 'Clip colour'));
    const row = el('div', { class: 'cm-sw' });
    row.append(el('button', { class: 'cm-dot none' + (L.label ? '' : ' on'), title: 'Default', onclick: () => { delete L.label; pop.classList.add('hidden'); done(); } }));
    for (const [k, [n, c]] of Object.entries(CLIP_LABELS)) row.append(el('button', { class: 'cm-dot' + (L.label === k ? ' on' : ''), title: n, style: `background:${c}`, onclick: () => { L.label = k; pop.classList.add('hidden'); done(); } }));
    sw.append(row); pop.append(sw);
    pop.classList.remove('hidden'); const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; pop.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  }
  document.addEventListener('contextmenu', e => {
    const c = e.target.closest && e.target.closest('#tlc .clip'); if (!c) return; e.preventDefault();
    const L = P.layers.find(l => l.id === c.dataset.id); if (!L) return;
    if (selId !== L.id) { selId = L.id; if (typeof uiSel === 'function') uiSel(); else { buildInspector(); renderTimeline(); } }
    open(L, e.clientX, e.clientY);
  });
  return { open, items, setSpeed, SPEEDS };
})();
