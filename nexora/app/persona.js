'use strict';
/* ====================== NEXORA's character ======================
   The opening, the greeting on Home, what the app says when it is empty or finished, and the record of your own work.
   Stats are real and stay on this computer. */
const Persona = (() => {
  const LINES = ['Every frame earns its place.', 'Cut on the action.', 'If it drags, it goes.', 'Pacing is the whole job.', 'The best edit is the one nobody notices.', 'Trust your first instinct, then check it twice.', 'Rhythm first. Polish later.', 'Silence is a cut too.', 'Black, white, and one good idea.', 'Make it shorter than you think.'];
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const key = () => 'nx.stats.' + ((typeof Account !== 'undefined' && Account.uid()) || 'guest');
  const load = () => { try { return Object.assign({ days: {}, exports: 0 }, JSON.parse(localStorage.getItem(key()) || '{}')); } catch (e) { return { days: {}, exports: 0 }; } };
  const save = s => { try { localStorage.setItem(key(), JSON.stringify(s)); } catch (e) { } };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let lastMinute = 0;
  /** counts minutes in which you actually changed something */
  function activity(now) { now = now || Date.now(); const m = Math.floor(now / 60000); if (m === lastMinute) return; lastMinute = m; const s = load(), d = today(); s.days[d] = (s.days[d] || 0) + 1; const ks = Object.keys(s.days).sort(); while (ks.length > 120) delete s.days[ks.shift()]; save(s); }
  function stat(k) { const s = load(); s[k] = (s[k] || 0) + 1; save(s); }
  function summary() {
    const s = load(); let week = 0, streak = 0; const d = new Date();
    for (let i = 0; i < 7; i++) { const x = new Date(d - i * 864e5), k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); week += s.days[k] || 0; }
    for (let i = 0; i < 400; i++) { const x = new Date(d - i * 864e5), k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); if (s.days[k]) streak++; else if (i > 0) break; }
    return { week, streak, exports: s.exports || 0 };
  }
  const fmtMins = m => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`;
  function greeting() { const h = new Date().getHours(), part = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening', u = typeof Account !== 'undefined' && Account.S.user; return u ? `${part}, ${u.name.split(' ')[0]}.` : `${part}.`; }
  function homeHeader() {
    const s = summary(), stats = el('div', { class: 'ph-stats' }), act = el('div', { class: 'ph-resume' });
    const box = el('div', { class: 'ph-head' }, el('div', { style: 'flex:1;min-width:0' }, el('h1', {}, greeting()), el('p', {}, pick(LINES))), stats, act);
    if (s.week || s.exports) for (const [v, l] of [[fmtMins(s.week), 'this week'], [s.exports, s.exports === 1 ? 'export' : 'exports'], [s.streak, s.streak === 1 ? 'day streak' : 'day streak']]) stats.append(el('div', {}, el('b', {}, String(v)), el('small', {}, l)));
    Projects.list().then(l => { const m = l[0]; if (m) act.append(el('button', { class: 'primary ph-go', id: 'phResume', title: 'Open ' + m.name, onclick: () => Shell.openProject(m.id) }, 'Continue ', el('span', {}, m.name))); });
    return box;
  }
  /* ---------- opening ---------- */
  const MARK = `<svg viewBox="0 0 64 64" width="84" height="84"><path class="s1" d="M16 12v40"/><path class="s2" d="M16 12l32 40"/><path class="s3" d="M48 52V12"/><path class="cut" d="M6 40 58 22"/></svg>`;
  function opening() {
    if (/selftest/.test(location.search) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = el('div', { id: 'splash' }), m = el('div', {}); m.innerHTML = MARK; o.append(m, el('div', { class: 'sp-word' }, 'NEXORA'), el('small', {}, pick(LINES))); document.body.append(o);
    setTimeout(() => o.classList.add('out'), 1250); setTimeout(() => o.remove(), 1650);
  }
  /* ---------- the empty stage ---------- */
  function emptyStage() {
    let e = document.getElementById('emptyStage');
    if (!e) { const host = document.getElementById('stageWrap'); if (!host) return; e = el('div', { id: 'emptyStage', class: 'hidden' }, el('div', { class: 'es-card' }, el('h2', {}, 'Nothing cut yet.'), el('p', {}, 'Drop your footage anywhere, or start here.'), el('div', { class: 'es-row' }, el('button', { class: 'primary', onclick: () => document.getElementById('fileIn').click() }, 'Import media'), el('button', { onclick: () => { leftTab = 'audio'; Browser.S.audioPane = 'music'; buildLeft(); } }, 'Find music'), el('button', { onclick: () => Copilot.toggle(true) }, 'Ask the AI Editor')))); host.append(e); }
    e.classList.toggle('hidden', !!P.layers.length || (typeof compStack !== 'undefined' && compStack.length > 0));
  }
  /* ---------- finished export ---------- */
  function exportDone(r) {
    stat('exports'); const speed = r.frames && r.secs ? (r.frames / r.secs).toFixed(1) + ' fps' : '', line = pick(['That one is out the door.', 'Rendered clean.', 'Done. Go watch it once, all the way through.', 'Out of the timeline, into the world.']);
    showModal('Export complete', el('div', { style: 'min-width:400px' }, el('p', { class: 'doc-verdict' }, line), el('div', { class: 'ex-grid' }, [['File', Disk.base(r.out)], ['Format', r.label], r.frames ? ['Frames', r.frames.toLocaleString()] : null, ['Size', r.size ? (r.size / 1048576).toFixed(1) + ' MB' : 'Folder'], ['Time', r.secs < 60 ? r.secs.toFixed(1) + ' s' : Math.floor(r.secs / 60) + ' m ' + Math.round(r.secs % 60) + ' s'], speed ? ['Speed', speed] : null].filter(Boolean).map(([a, b]) => [el('small', {}, a), el('b', { title: b }, b)]).flat())), [['Show in folder', () => { nxfs.reveal(r.out); closeModal(); }], ['Done', closeModal, true]]);
  }
  /* ---------- keys ---------- */
  function shortcuts() {
    const G = [['Space', 'Play / pause'], ['S', 'Split at playhead'], ['Del', 'Delete'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['M', 'Add marker'], ['= / -', 'Zoom timeline'], ['\\', 'Fit the whole edit'], ['Ctrl+wheel', 'Zoom at the cursor'], ['Shift+wheel', 'Scroll sideways'], ['Enter', 'Render In to Out'], ['Shift+C', 'Scopes'], ['Ctrl+K', 'Commands'], ['?', 'This sheet']], row = ([k, d]) => el('div', { class: 'ks-row' }, el('kbd', {}, k), el('span', {}, d));
    showModal('Keyboard', el('div', { class: 'ks-grid' }, el('div', {}, el('h4', {}, 'Essentials'), G.map(row)), el('div', {}, el('h4', {}, 'Editing'), (typeof Pro !== 'undefined' ? Pro.KEYS : []).map(row))), [['Done', closeModal, true]]);
  }
  /* ---------- a failure in one tool must not take the session with it ---------- */
  let lastGuard = 0;
  function guard() {
    const report = (e, what) => { console.error('guarded', what, e); if (Date.now() - lastGuard < 20000) return; lastGuard = Date.now(); toast('Something failed behind the scenes. Your work is safe and autosave is still running.'); if (typeof Recovery !== 'undefined') Recovery.touch(); };
    window.addEventListener('error', e => { if (!e.message || /ResizeObserver/.test(e.message) || e.target !== window) return; report(e.error || e.message, 'error'); });
    window.addEventListener('unhandledrejection', e => report(e.reason, 'promise'));
    window.addEventListener('keydown', e => { if (e.key !== '?' || e.ctrlKey || e.metaKey) return; const t = e.target; if (t.matches && t.matches('input,textarea,select,[contenteditable]')) return; e.preventDefault(); shortcuts(); }, true);
  }
  return { LINES, activity, stat, summary, greeting, homeHeader, opening, emptyStage, exportDone, shortcuts, guard, fmtMins };
})();
