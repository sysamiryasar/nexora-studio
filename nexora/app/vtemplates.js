'use strict';
/* ====================== NEXORA project starters ======================
   Home › Templates › Project starters: a new video project already set to the right size and frame rate, with
   editable title, lower-third and end-card layers and named chapter markers where they help. "Save as template"
   (Edit page, File menu) keeps the current project's settings, text, shapes, solids, adjustment layers, effects and
   markers, without media, so your own intro / outro layout starts every new project. Saved on this computer. */
const VTemplates = (() => {
  const txt = (str, o) => { const L = mkLayer('text', Object.assign({ name: str.slice(0, 24), start: 0, dur: 4 }, o)); Object.assign(L.text, { str, size: 72, weight: '800', color: '#ffffff' }, o.text || {}); if (o.y != null) L.tr.y = P.h * o.y; if (o.x != null) L.tr.x = P.w * o.x; return L; };
  const BUILTIN = [
    { id: 'youtube', name: 'YouTube video', desc: '1920 × 1080 · 30 fps · title, lower third, end card, chapters', w: 1920, h: 1080, fps: 30, dur: 60,
      build() { P.layers.push(txt('Your title', { start: 0, dur: 4, y: .45, tin: { type: 'fade', dur: .4 }, tout: { type: 'fade', dur: .4 }, text: { size: 110 } }), txt('Name · role', { start: 4, dur: 5, x: .26, y: .82, tin: { type: 'slide-right', dur: .35 }, tout: { type: 'fade', dur: .3 }, text: { size: 44, bgOn: true, bg: '#0b1a2b', bgPad: 16 } }), txt('Thanks for watching', { start: 52, dur: 8, y: .3, tin: { type: 'fade', dur: .5 }, text: { size: 80 } }));
        [[0, 'Intro'], [10, 'Main part'], [52, 'Outro']].forEach(([t, n]) => Markers.add(t, { name: n })); } },
    { id: 'shorts', name: 'Short / Reel / TikTok', desc: '1080 × 1920 · 30 fps · hook title, caption area', w: 1080, h: 1920, fps: 30, dur: 30,
      build() { P.layers.push(txt('THE HOOK', { start: 0, dur: 2.5, y: .2, tin: { type: 'pop', dur: .15 }, text: { size: 120, weight: '900', stroke: '#000000', strokeW: 8 } })); Markers.add(0, { name: 'Hook' }); Markers.add(2.5, { name: 'Story' }); Markers.add(25, { name: 'Call to action' }); } },
    { id: 'square', name: 'Instagram post', desc: '1080 × 1350 (4:5) · 30 fps · title', w: 1080, h: 1350, fps: 30, dur: 20,
      build() { P.layers.push(txt('Title', { start: 0, dur: 3, y: .5, tin: { type: 'fade', dur: .3 }, tout: { type: 'fade', dur: .3 }, text: { size: 96 } })); } },
    { id: 'cinema', name: 'Cinematic 4K', desc: '3840 × 2160 · 24 fps · 2.39:1 bars, title card', w: 3840, h: 2160, fps: 24, dur: 60,
      build() { const bar = h => mkLayer('solid', { name: 'Letterbox bar', start: 0, dur: P.dur }); const t = bar(), b = bar(), bh = Math.round((P.h - P.w / 2.39) / 2);
        for (const [L, y] of [[t, bh / 2], [b, P.h - bh / 2]]) { L.color = '#000000'; L.tr.y = y; L.tr.sx = 100; L.tr.sy = bh / P.h * 100; L.locked = true; }
        P.layers.push(txt('A FILM BY', { start: 0, dur: 4, y: .46, tin: { type: 'fade', dur: 1 }, tout: { type: 'fade', dur: 1 }, text: { size: 64, weight: '300', spacing: 18 } }), t, b); } },
    { id: 'podcast', name: 'Podcast / interview', desc: '1920 × 1080 · 30 fps · two name tags, topic chapters', w: 1920, h: 1080, fps: 30, dur: 600,
      build() { P.layers.push(txt('Host name', { start: 2, dur: 6, x: .2, y: .85, tin: { type: 'slide-right', dur: .3 }, tout: { type: 'fade', dur: .3 }, text: { size: 42, bgOn: true, bg: '#0b1a2b', bgPad: 14 } }), txt('Guest name', { start: 10, dur: 6, x: .8, y: .85, tin: { type: 'slide-left', dur: .3 }, tout: { type: 'fade', dur: .3 }, text: { size: 42, bgOn: true, bg: '#0b1a2b', bgPad: 14 } }));
        [[0, 'Intro'], [60, 'Topic 1'], [240, 'Topic 2'], [420, 'Topic 3'], [570, 'Outro']].forEach(([t, n]) => Markers.add(t, { name: n })); } }
  ];
  const KEY = 'nx.vtemplates', MEDIA = new Set(['video', 'audio', 'image']);
  const user = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; } };
  const store = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { toast('Could not save the template: ' + e.message); return false; } };
  /** the current project as a template: no media layers, nothing that points at media */
  function snapshot(name) {
    const keep = JSON.parse(ser(P.layers.filter(L => !MEDIA.has(L.type) && L.type !== 'paint' && !(L.type === 'comp' && L.compRef))));
    const ids = new Set(keep.map(L => L.id)); keep.forEach(L => { if (L.parent && !ids.has(L.parent)) L.parent = ''; if (L.matte && L.matte.src && !ids.has(L.matte.src)) L.matte = { mode: 'none', src: '' }; delete L.fxGraph; });
    return { id: 'u' + uid(), name: name || P.name, w: P.w, h: P.h, fps: P.fps, dur: P.dur, bg: P.bg, layers: keep, markers: (P.markers || []).slice(), markerInfo: JSON.parse(JSON.stringify(P.markerInfo || {})), made: Date.now() };
  }
  async function saveCurrent() { const name = await askText('Template name', P.name + ' template'); if (!name) return null; const t = snapshot(name), list = user(); list.unshift(t); if (store(list)) toast(`Saved "${name}": Home › Templates › Project starters`); return t; }
  function remove(id) { store(user().filter(t => t.id !== id)); }
  /** fill the (new, empty) project from a template */
  function apply(t) {
    P.w = t.w; P.h = t.h; P.fps = t.fps; P.dur = t.dur || P.dur; if (t.bg) P.bg = t.bg;
    if (t.build) t.build(); else { for (const L of JSON.parse(JSON.stringify(t.layers))) { L.id = uid(); P.layers.push(Object.assign(mkLayer(L.type), L)); } P.markers = (t.markers || []).slice(); P.markerInfo = JSON.parse(JSON.stringify(t.markerInfo || {})); }
    structChanged(); commit();
  }
  async function create(id) { const t = BUILTIN.find(x => x.id === id) || user().find(x => x.id === id); if (!t) return null; await Shell.newProject('video', { w: t.w, h: t.h, fps: t.fps, name: t.name + ' ' + new Date().toLocaleDateString() }); apply(t); if (typeof fitView === 'function') fitView(); await Projects.save(); return t; }
  /** Home › Templates section */
  function section() {
    const card = t => el('div', { class: 'scard vt', onclick: () => create(t.id) }, el('div', { class: 'sth vt-th', style: `aspect-ratio:${t.w}/${t.h}` }, el('span', {}, `${t.w}×${t.h}`)), el('div', { class: 'sm' }, el('b', {}, t.name), el('small', {}, t.desc || `${t.w} × ${t.h} · ${t.fps} fps · ${t.layers.length} layer(s) · yours`)),
      t.build ? '' : el('button', { class: 'ibtn vt-del', title: 'Delete this template', onclick: e => { e.stopPropagation(); if (confirm(`Delete the template "${t.name}"?`)) { remove(t.id); Shell.showTemplates(); } } }, '✕'));
    return [el('div', { class: 'hsec' }, el('h3', {}, 'Project starters')), el('div', { class: 'suite' }, ...BUILTIN.map(card), ...user().map(card))];
  }
  return { BUILTIN, user, snapshot, saveCurrent, remove, apply, create, section };
})();
