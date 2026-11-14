'use strict';
/* ====================== version history (desktop) ======================
   Autosave overwrites project.nexora; this keeps earlier states beside it in <project>/.versions/, at most one automatic
   version every 5 minutes, plus any you name. Restoring first saves the current state, so a restore can itself be undone. */
const Versions = (() => {
  const GAP = 5 * 60000, S = { last: {}, hash: {} };
  const dirOf = f => Disk.join(f, '.versions');
  const hashOf = t => { let h = 2166136261; for (let i = 0; i < t.length; i += 7) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h + ':' + t.length; };
  const clean = l => String(l || 'auto').replace(/[^\w ()-]+/g, ' ').trim().slice(0, 60) || 'auto';
  async function list(folder) {
    if (!Disk.on || !folder) return []; const r = await Disk.fs.list(dirOf(folder));
    return r.map(f => { const m = /^(\d+)-(.*)\.nexora$/.exec(f.name); return m && { file: Disk.join(dirOf(folder), f.name), t: +m[1], label: m[2], size: f.size }; }).filter(Boolean).sort((a, b) => b.t - a.t);
  }
  /* keeps the newest 20 automatic versions and one per day before that; named versions are never thinned out */
  async function prune(folder) { const all = (await list(folder)).filter(v => v.label === 'auto' || v.label === 'before restore'), days = new Set(); for (const [i, v] of all.entries()) { if (i < 20) continue; const d = new Date(v.t).toDateString(); if (days.has(d) || days.size >= 30) await Disk.fs.remove(v.file); else days.add(d); } }
  async function snap(folder, json, label) { const t = Date.now(); await Disk.fs.writeText(Disk.join(dirOf(folder), `${t}-${clean(label)}.nexora`), json); S.last[folder] = t; S.hash[folder] = hashOf(json); await prune(folder); return t; }
  async function maybe(folder, json) { if (!Disk.on || !folder) return false; const h = hashOf(json); if (S.hash[folder] === h || Date.now() - (S.last[folder] || 0) < GAP) return false; try { await snap(folder, json, 'auto'); return true; } catch (e) { console.warn('version', e); return false; } }
  async function saveNamed(label) { const cur = Projects.current; if (!cur || !cur.folder) throw new Error('Open a project first.'); await Recovery.flush(); const f = await Disk.readProject(cur.folder); if (!f) throw new Error('The project has not been saved yet.'); return snap(cur.folder, f.json, label); }
  async function restore(v) {
    const cur = Projects.current; if (!cur || !cur.folder) throw new Error('Open a project first.');
    await Recovery.flush(); const now = await Disk.readProject(cur.folder); if (now) await snap(cur.folder, now.json, 'before restore');
    const json = await Disk.fs.readText(v.file), tab = Shell.tab; await Shell.loadEnvelope(JSON.parse(json)); Projects.current = cur; await Projects.save(); if (Shell.MODES[tab]) Shell.go(tab); requestRender(); return true;
  }
  const when = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  async function dialog() {
    if (!Disk.on) return toast('Version history needs the desktop app.'); const cur = Projects.current; if (!cur || !cur.folder) return toast('Open a project first.');
    const body = el('div', { style: 'width:460px;max-width:100%;max-height:60vh;overflow:auto' });
    const draw = async () => { const l = await list(cur.folder); body.innerHTML = ''; if (!l.length) return body.append(el('p', { class: 'dim' }, 'No earlier versions yet. NEXORA keeps one every five minutes while you work.')); l.forEach(v => body.append(el('div', { class: 'vh-row' }, el('div', { style: 'flex:1;min-width:0' }, el('b', {}, v.label === 'auto' ? 'Autosaved' : v.label === 'before restore' ? 'Before a restore' : v.label), el('small', { class: 'dim' }, `${when(v.t)} · ${(v.size / 1024).toFixed(0)} KB`)), el('button', { onclick: async () => { if (!confirm(`Go back to the version from ${when(v.t)}?\nThe current state is saved first, so you can return to it.`)) return; closeModal(); try { await restore(v); toast('Back to ' + when(v.t)); } catch (e) { toast('Could not restore: ' + e.message); } } }, 'Restore')))); };
    await draw(); showModal('Version history', body, [['Save this version…', async () => { const n = await askText('Name this version', ''); if (!n) return; try { await saveNamed(n); await draw(); toast('Version saved'); } catch (e) { toast(e.message); } }], ['Close', closeModal, true]]);
  }
  return { S, list, snap, maybe, saveNamed, restore, dialog, prune };
})();
