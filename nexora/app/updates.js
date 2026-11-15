'use strict';
/* ====================== NEXORA updates (page side) ======================
   On every start (and every 6 hours while open) the desktop app asks GitHub for the latest release. If it is newer,
   a popup offers it:
     · installed Windows copies: "Update now" downloads the new installer inside the app (progress, cancel), the main
       process checks its SHA-256 against the release's SHA256SUMS.txt, installs it over this version and restarts;
       the new version then shows What's new (about.js)
     · portable zip, macOS, Linux: "Download" opens the release page (they cannot replace themselves)
   "Later" hides it until the next start, "Skip this version" until a newer one. Checks can be turned off in the
   command palette. Nothing is downloaded until you press Update now. */
const Updates = (() => {
  const S = { last: null, bar: null, open: false, timer: null };
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } };
  const auto = () => get('nx.update.auto') !== '0';
  const has = () => typeof window.nxupdate !== 'undefined';
  const MB = n => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1);
  async function check(manual) {
    if (!has()) { if (manual) toast('Update checks need the desktop app.'); return null; }
    const r = await nxupdate.check(!manual); S.last = r; if (r.skipped) return r; set('nx.update.at', String(Date.now()));
    if (!r.ok) { if (manual) toast('Could not check for updates: ' + r.error); return r; }
    if (r.newer && (manual || (get('nx.update.skip') !== r.latest && S.later !== r.latest))) popup(r);
    else if (manual) toast(r.latest ? `You have the latest version (${r.current}).` : `No release published yet. This is version ${r.current}.`);
    return r;
  }
  /* ---------- the popup ---------- */
  function popup(r) {
    const m = document.getElementById('modal'); if (!m) return;
    if (!m.classList.contains('hidden') && !S.open) return bar(r);   // another dialog is open: a quiet bar instead
    S.open = true; hide();
    const notes = r.notes && r.notes.length ? el('ul', { class: 'up-list' }, ...r.notes.map(n => el('li', {}, n))) : el('p', { class: 'dim' }, 'Bug fixes and improvements.');
    const body = el('div', { class: 'up-pop' }, el('div', { class: 'up-head' }, el('img', { src: 'nexora/app/logo.svg', width: 56, height: 56, alt: '' }), el('div', {}, el('b', {}, `NEXORA ${r.latest} is available`), el('small', { class: 'dim' }, `You have ${r.current}.` + (r.published ? ' Released ' + new Date(r.published).toLocaleDateString() + '.' : '')))),
      el('h5', {}, "What's new"), notes,
      r.canInstall ? el('p', { class: 'dim up-small' }, 'Update now downloads the installer, checks it against the published checksum, installs it over this version and restarts NEXORA. Your projects are not touched.') : el('p', { class: 'dim up-small' }, r.platform === 'win32' ? 'This is the portable version: download the new one (or the installer, which can update itself from then on).' : 'Download the new version from the release page.'));
    const later = () => { S.later = r.latest; S.open = false; closeModal(); }, skip = () => { set('nx.update.skip', r.latest); S.open = false; closeModal(); };
    showModal('Update available', body, r.canInstall
      ? [['Skip this version', skip], ['Later', later], ['Update now', () => updateNow(r), true]]
      : [['Skip this version', skip], ['Later', later], ['Download', () => { window.open(r.url); later(); }, true]]);
  }
  async function updateNow(r) {
    const m = document.getElementById('modal'), dlg = m && m.querySelector('.dlg'); if (!dlg) return;
    const bar = el('div', { class: 'bar' }, el('div', {})), txt = el('div', { class: 'up-prog' }, 'Starting download…'), cancel = el('button', { onclick: () => nxupdate.cancel() }, 'Cancel');
    dlg.innerHTML = ''; dlg.append(el('h3', {}, `Updating to NEXORA ${r.latest}`), txt, bar, el('div', { class: 'btns' }, cancel));
    const off = nxupdate.onProgress(d => { const p = d.total ? d.got / d.total * 100 : 0; bar.firstChild.style.width = p.toFixed(1) + '%'; txt.textContent = d.total ? `Downloading… ${MB(d.got)} of ${MB(d.total)} MB (${Math.round(p)} %)` : `Downloading… ${MB(d.got)} MB`; });
    const d = await nxupdate.download(); off();
    if (!d.ok) { S.open = false; dlg.innerHTML = ''; dlg.append(el('h3', {}, 'Update not installed'), el('p', {}, d.error), el('div', { class: 'btns' }, el('button', { onclick: () => { window.open(r.url); closeModal(); } }, 'Download from the website'), el('button', { onclick: () => { closeModal(); } }, 'Close'), el('button', { class: 'primary', onclick: () => updateNow(r) }, 'Try again'))); return d; }
    txt.textContent = 'Verified. Installing… NEXORA will close and reopen in a moment.'; bar.firstChild.style.width = '100%'; cancel.disabled = true;
    try { if (typeof Recovery !== 'undefined' && Recovery.flush) await Recovery.flush(); } catch (e) { }   // save the open project first
    const i = await nxupdate.install(d.file); if (!i.ok) { txt.textContent = i.error; cancel.disabled = false; cancel.textContent = 'Close'; cancel.onclick = () => { S.open = false; closeModal(); }; }
    return Object.assign({}, d, { install: i });
  }
  /* quiet bar, used when another dialog is already open */
  function bar(r) {
    hide(); S.bar = el('div', { id: 'updateBar', role: 'status' }, el('span', { class: 'up-dot' }), el('b', {}, `NEXORA ${r.latest} is available`), el('div', { class: 'spacer' }),
      el('button', { class: 'primary ibtn', onclick: () => { hide(); popup(r); } }, 'See update'), el('button', { class: 'ibtn', onclick: () => { S.later = r.latest; hide(); } }, 'Later'));
    document.body.append(S.bar);
  }
  function hide() { if (S.bar) S.bar.remove(); S.bar = null; }
  function setAuto(on) { set('nx.update.auto', on ? null : '0'); toast(on ? 'Update checks on (at start and every 6 hours).' : 'Automatic update checks off. Use "Help: Check for updates" any time.'); }
  const commands = () => [{ title: 'Help: Check for updates', run: () => check(true) }, { title: `Help: ${auto() ? 'Turn off' : 'Turn on'} automatic update checks`, run: () => setAuto(!auto()) }];
  // at every start (a few seconds in, after What's new had its turn) and every 6 hours while open
  setTimeout(() => { if (!has() || !auto()) return; check(false); S.timer = setInterval(() => { if (auto() && !S.open) check(false); }, 6 * 3600e3); }, 9000);
  return { S, check, popup, updateNow, bar, hide, commands, auto, setAuto };
})();
