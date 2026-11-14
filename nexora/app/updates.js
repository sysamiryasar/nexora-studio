'use strict';
/* ====================== NEXORA update notice ======================
   Once a day (and on demand) the desktop app asks GitHub for the latest release. If it is newer than this copy, a
   slim bar offers What's new / Download / Later. "Later" hides that version only; the next release shows again.
   Automatic checks can be switched off from the command palette. Nothing is downloaded or installed by itself. */
const Updates = (() => {
  const S = { last: null, bar: null };
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } };
  const auto = () => get('nx.update.auto') !== '0';
  const has = () => typeof window.nxupdate !== 'undefined';
  async function check(manual) {
    if (!has()) { if (manual) toast('Update checks need the desktop app.'); return null; }
    const r = await nxupdate.check(!manual); S.last = r; if (r.skipped) return r; set('nx.update.at', String(Date.now()));
    if (!r.ok) { if (manual) toast('Could not check for updates: ' + r.error); return r; }
    if (r.newer && (manual || get('nx.update.skip') !== r.latest)) show(r);
    else if (manual) toast(r.latest ? `You have the latest version (${r.current}).` : `No release published yet. This is version ${r.current}.`);
    return r;
  }
  function show(r) {
    hide(); const notes = r.notes && r.notes.length ? el('ul', { class: 'up-notes' }, ...r.notes.map(n => el('li', {}, n))) : null;
    S.bar = el('div', { id: 'updateBar', role: 'status' },
      el('span', { class: 'up-dot' }), el('b', {}, `NEXORA ${r.latest} is available`), el('span', { class: 'dim' }, `You have ${r.current}.`),
      el('div', { class: 'spacer' }),
      notes ? el('button', { class: 'ibtn', onclick: () => S.bar.classList.toggle('open') }, "What's new") : '',
      el('button', { class: 'primary ibtn', onclick: () => window.open(r.url) }, Icon('export', 14), 'Download'),
      el('button', { class: 'ibtn', title: 'Hide until the next version', onclick: () => { set('nx.update.skip', r.latest); hide(); } }, 'Later'), notes || '');
    document.body.append(S.bar);
  }
  function hide() { if (S.bar) S.bar.remove(); S.bar = null; }
  function setAuto(on) { set('nx.update.auto', on ? null : '0'); toast(on ? 'Automatic update checks on (once a day).' : 'Automatic update checks off. Use "Help: Check for updates" any time.'); }
  const commands = () => [{ title: 'Help: Check for updates', run: () => check(true) }, { title: `Help: ${auto() ? 'Turn off' : 'Turn on'} automatic update checks`, run: () => setAuto(!auto()) }];
  // first check a little after start-up (never during automated test runs), then at most once a day
  setTimeout(() => { if (!has() || !auto()) return; const at = +get('nx.update.at') || 0; if (Date.now() - at > 20 * 3600e3) check(false); }, 8000);
  return { S, check, show, hide, commands, auto, setAuto };
})();
