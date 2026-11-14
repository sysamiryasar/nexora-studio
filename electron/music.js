'use strict';
/* Online Creative Commons music search (Openverse) and scanning the user's own music folders.
   The page gets result ids, never fetches arbitrary URLs through this module: only an address returned by a search can be downloaded. */
const fsp = require('fs').promises, path = require('path');
const API = 'https://api.openverse.org/v1/audio/', UA = 'NEXORA-Studio/2.0', MAX = 80 * 1048576;
const LIC = { cc0: 'CC0 (public domain)', pdm: 'Public domain', by: 'CC BY', 'by-sa': 'CC BY-SA' };
const AUDIO = /\.(mp3|wav|flac|m4a|aac|ogg|opus|aif|aiff|wma)$/i;
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', ogx: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg' };

function register(ipcMain, logLine) {
  const known = new Map();
  ipcMain.handle('nxmusic:search', async (_e, o) => {
    const q = String(o.q || '').trim().slice(0, 100); if (!q) return { ok: true, results: [], total: 0 };
    try {
      const u = `${API}?${new URLSearchParams({ q, license_type: 'commercial', page: String(Math.max(1, Math.min(50, +o.page || 1))), page_size: '20', mature: 'false' })}`;
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); if (!r.ok) return { ok: false, error: r.status === 429 ? 'Too many searches. Wait a minute and try again.' : 'The music search is unavailable right now.' };
      const j = await r.json(), results = (j.results || []).filter(x => x.url && /^https:/.test(x.url) && LIC[x.license]).map(x => {
        known.set(x.id, { url: x.url, title: x.title, ext: String(x.filetype || x.url.split('.').pop() || 'mp3').toLowerCase() });
        return { id: x.id, title: x.title || 'Untitled', creator: x.creator || 'Unknown', licenseName: LIC[x.license] + (x.license_version && x.license !== 'pdm' && x.license !== 'cc0' ? ' ' + x.license_version : ''), attribution: x.license === 'by' || x.license === 'by-sa', page: x.foreign_landing_url || x.url, source: x.source, seconds: Math.round((x.duration || 0) / 1000), preview: x.url };
      });
      if (known.size > 4000) [...known.keys()].slice(0, 2000).forEach(k => known.delete(k));
      return { ok: true, results, total: j.result_count || 0 };
    } catch (e) { logLine('music search', e.message); return { ok: false, error: 'Could not reach the music search. Check your internet connection.' }; }
  });
  ipcMain.handle('nxmusic:download', async (_e, id) => {
    const k = known.get(id); if (!k) return { ok: false, error: 'Search again and retry.' };
    try {
      const r = await fetch(k.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) }); if (!r.ok) return { ok: false, error: 'This track is no longer available from its source.' };
      if (+r.headers.get('content-length') > MAX) return { ok: false, error: 'This file is too large.' };
      const b = await r.arrayBuffer(); if (b.byteLength > MAX) return { ok: false, error: 'This file is too large.' };
      const ext = MIME[k.ext] ? (k.ext === 'ogx' || k.ext === 'oga' ? 'ogg' : k.ext) : 'mp3';
      return { ok: true, bytes: b, name: `${String(k.title || 'track').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 80)}.${ext}`, mime: MIME[ext] };
    } catch (e) { logLine('music download', e.message); return { ok: false, error: 'The download failed. Try again.' }; }
  });
  ipcMain.handle('nxmusic:scan', async (_e, dirs) => {
    const files = [], deadline = Date.now() + 15000;
    for (const root of (Array.isArray(dirs) ? dirs : []).slice(0, 20)) {
      const q = [[String(root), 0]];
      while (q.length && files.length < 20000 && Date.now() < deadline) {
        const [d, depth] = q.shift(); let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
        for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) { if (depth < 8 && !e.name.startsWith('.')) q.push([p, depth + 1]); } else if (AUDIO.test(e.name)) files.push({ path: p, name: e.name, dir: d }); }
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name)); return { files };
  });
}
module.exports = { register };
