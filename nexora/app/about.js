'use strict';
/* ====================== NEXORA About + What's new ======================
   The version history lives in nexora/app/changelog.js (also published as CHANGELOG.md and on the website).
   After an update, the first start shows what changed in the versions since the one last used; a fresh install
   shows nothing. Help › What's new and Help › About are always in the command palette. */
const About = (() => {
  const LOG = () => window.NX_CHANGELOG || [];
  const version = () => (LOG()[0] || {}).version || '';
  const SITE = 'https://nexora-editor.pages.dev', REPO = 'https://github.com/sysamiryasar/nexora-studio';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
  const fmtDate = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return d; } };
  function entry(r, open) {
    return el('details', { class: 'wn-rel', open: open ? '' : undefined }, el('summary', {}, el('b', {}, 'NEXORA ' + r.version), el('span', { class: 'dim' }, ' · ' + fmtDate(r.date) + ' · ' + r.title)),
      el('ul', {}, ...r.items.map(t => el('li', {}, t))));
  }
  /** What's new: the releases newer than `since` (or everything) */
  function whatsNew(since) {
    const list = since ? LOG().filter(r => cmp(r.version, since) > 0) : LOG(); if (!list.length) return;
    showModal(since ? `What's new in NEXORA ${version()}` : 'Changelog', el('div', { class: 'wn' }, ...list.map((r, i) => entry(r, i === 0 || !!since)),
      el('p', { class: 'dim wn-foot' }, 'Full history and downloads: ', el('a', { href: '#', onclick: e => { e.preventDefault(); window.open(SITE + '/#changelog'); } }, 'nexora-editor.pages.dev'))), [['Got it', closeModal, true]]);
  }
  function about() {
    const link = (t, u) => el('button', { class: 'ibtn', onclick: () => window.open(u) }, t);
    showModal('About NEXORA Studio', el('div', { class: 'ab' },
      el('img', { src: 'nexora/app/logo.svg', width: 88, height: 88, alt: '' }),
      el('div', {}, el('b', { class: 'ab-name' }, 'NEXORA Studio'), el('div', { class: 'ab-ver' }, 'Version ' + version()), el('p', { class: 'dim' }, 'Free, open-source editor for video, motion, VFX and design. MIT licensed. FFmpeg (Windows build) is GPL v3.'),
        el('div', { class: 'ab-links' }, link('Website', SITE), link('Source code', REPO), link('Releases', REPO + '/releases'), link('Licences', REPO + '/blob/main/THIRD_PARTY_NOTICES.md'), el('button', { class: 'ibtn', onclick: () => { closeModal(); whatsNew(); } }, 'Changelog')))),
      [['Close', closeModal, true]]);
  }
  /** first start after an update: show the changes since the version last used (never on a fresh install or in tests) */
  async function onStart() {
    try { if (window.nxauth && (await nxauth.status()).testMode) return null; } catch (e) { }   // automated test runs
    const v = version(), seen = get('nx.seenVersion'); if (!v) return null;
    set('nx.seenVersion', v); if (!seen || cmp(v, seen) <= 0) return null;
    setTimeout(() => { if (document.getElementById('modal').classList.contains('hidden') && !document.getElementById('authGate')) whatsNew(seen); }, 1600);
    return seen;
  }
  const commands = () => [{ title: "Help: What's new (changelog)", run: () => whatsNew() }, { title: 'Help: About NEXORA Studio', run: about }];
  return { version, whatsNew, about, onStart, commands, cmp };
})();
