'use strict';
/* ====================== NEXORA proxy & cache manager ======================
   One place to see and free the space NEXORA keeps for speed: proxy copies of big videos (IndexedDB 'nexora-proxies',
   one per source file, also for files in other projects), rendered preview segments (memory, this session) and AI
   models downloaded on first use (Cache Storage). Deleting any of them is safe: proxies and previews are rebuilt
   when needed and models download again; your projects and media files are never touched. */
const CacheMgr = (() => {
  const fmt = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
  function idb(mode, fn) { return new Promise((res, rej) => { const r = indexedDB.open('nexora-proxies', 1); r.onupgradeneeded = () => r.result.createObjectStore('p', { keyPath: 'key' }); r.onerror = () => rej(r.error);
    r.onsuccess = () => { const d = r.result, t = d.transaction('p', mode), q = fn(t.objectStore('p')); t.oncomplete = () => { d.close(); res(q && q.result); }; t.onerror = () => { d.close(); rej(t.error); }; }; }); }
  /** proxies on disk: [{ key, bytes, made, media (in this project) }] */
  async function proxies() {
    const rows = await idb('readonly', s => s.getAll()) || []; const byId = {}; for (const id in media) byId[id] = media[id];
    return rows.map(r => ({ key: r.key, bytes: r.blob ? r.blob.size : 0, made: r.made || 0, w: r.w, h: r.h, media: byId[r.key.split('@')[0]] || null }));
  }
  async function deleteProxy(key) { const m = media[key.split('@')[0]]; if (m && Proxies.keyOf(m) === key) await Proxies.remove(m); else await idb('readwrite', s => s.delete(key)); }
  async function models() { if (!window.caches) return { names: [], bytes: 0 }; let bytes = 0, n = 0; const names = await caches.keys();
    for (const nm of names) { const c = await caches.open(nm); for (const req of await c.keys()) { const r = await c.match(req); if (r) { const b = await r.clone().blob(); bytes += b.size; n++; } } } return { names, bytes, files: n }; }
  async function clearModels() { if (window.caches) for (const nm of await caches.keys()) await caches.delete(nm); }
  function render() { let bytes = 0, n = 0; for (const s of RenderCache.segs.values()) { bytes += s.bytes || 0; n++; } return { bytes, segments: n }; }
  async function scan() { const [p, m] = await Promise.all([proxies(), models()]); let est = null; try { est = navigator.storage && await navigator.storage.estimate(); } catch (e) { } return { proxies: p, models: m, render: render(), usage: est && est.usage, quota: est && est.quota }; }
  async function open() {
    const body = el('div', { class: 'cachem' }, el('p', { class: 'dim' }, 'Scanning…')); showModal('Proxies & cache', body, [['Done', closeModal, true]]);
    const r = await scan(); body.innerHTML = ''; const sum = a => a.reduce((x, y) => x + y.bytes, 0), used = r.proxies.filter(x => x.media), other = r.proxies.filter(x => !x.media);
    const row = (name, info, act) => el('div', { class: 'cm-row' }, el('div', { class: 'cm-txt' }, el('b', {}, name), el('small', {}, info)), act || '');
    const btn = (t, fn) => el('button', { onclick: async () => { await fn(); open(); } }, t);
    body.append(el('p', { class: 'dim' }, 'Everything here is rebuilt or downloaded again when needed. Projects and media files are never deleted.'),
      el('h4', {}, `Proxies · ${fmt(sum(r.proxies))}`),
      ...used.map(x => row(x.media.name, `${x.w}×${x.h} proxy · ${fmt(x.bytes)} · in this project`, btn('Delete', () => deleteProxy(x.key)))),
      other.length ? row(`${other.length} from other projects or removed media`, fmt(sum(other)), btn('Delete', async () => { for (const x of other) await deleteProxy(x.key); })) : '',
      !r.proxies.length ? el('p', { class: 'dim' }, 'No proxies. Big videos (above 1080p) get one automatically.') : '',
      el('h4', {}, `Rendered previews · ${fmt(r.render.bytes)}`), row(`${r.render.segments} segment(s) of 4 s`, 'kept until NEXORA closes', r.render.segments ? btn('Delete', () => RenderCache.clear()) : ''),
      el('h4', {}, `Downloaded AI models · ${fmt(r.models.bytes)}`), row(`${r.models.files || 0} file(s)`, 'loaded or downloaded again the next time an AI tool needs them', r.models.bytes ? btn('Delete', clearModels) : ''),
      r.usage != null ? el('p', { class: 'dim' }, `NEXORA app storage in total: ${fmt(r.usage)}.`) : '');
    const btns = document.querySelector('#modal .btns'); if (btns && !btns.querySelector('.cm-all')) btns.prepend(el('button', { class: 'cm-all', onclick: async () => { if (!confirm('Delete all proxies, rendered previews and downloaded AI models?')) return; for (const x of r.proxies) await deleteProxy(x.key); RenderCache.clear(); await clearModels(); open(); } }, 'Delete all'));
  }
  return { fmt, proxies, deleteProxy, models, clearModels, render, scan, open };
})();
