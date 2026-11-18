'use strict';
/* ====================== NEXORA custom keyboard shortcuts ======================
   View › Keyboard shortcuts lists the Edit page's commands. Click one, press the new keys, done. A command that has a
   built-in key is remapped by replaying that key (so every handler keeps working); its old key then does nothing
   unless something else is bound to it. Menu commands without a key can be given one too. Bindings are saved per
   computer (localStorage 'nx.keys'); Reset puts a command, or all of them, back. */
const Keymap = (() => {
  // [id, label, default combo]; ids that start with "menu:" run a menu command directly
  const ACTIONS = [
    ['undo', 'Undo', 'Ctrl+Z'], ['redo', 'Redo', 'Ctrl+Y'], ['save', 'Save project', 'Ctrl+S'], ['export', 'Export video', 'Ctrl+E'], ['import', 'Import media', 'Ctrl+I'],
    ['dup', 'Duplicate clip', 'Ctrl+D'], ['split', 'Split at playhead', 'S'], ['del', 'Delete clip', 'Delete'], ['keyall', 'Set keyframes', 'K'], ['marker', 'Add marker', 'M'],
    ['play', 'Play / pause', 'Space'], ['shJ', 'Shuttle reverse', 'J'], ['shL', 'Shuttle forward', 'L'], ['in', 'Mark In', 'I'], ['out', 'Mark Out', 'O'], ['goin', 'Go to In', 'Shift+I'], ['goout', 'Go to Out', 'Shift+O'],
    ['mclip', 'Mark clip', 'X'], ['clrio', 'Clear In–Out', 'Alt+X'], ['ins', 'Insert (three-point)', ','], ['ovr', 'Overwrite (three-point)', '.'], ['lift', 'Lift In–Out', ';'], ['extract', 'Extract In–Out', "'"],
    ['rts', 'Ripple trim start', 'Q'], ['rte', 'Ripple trim end', 'W'], ['rdel', 'Ripple delete', 'Shift+Delete'], ['cutall', 'Cut all clips at playhead', 'Shift+S'], ['roll', 'Roll edit to playhead', 'Shift+R'],
    ['pedit', 'Previous edit', 'ArrowUp'], ['nedit', 'Next edit', 'ArrowDown'], ['pmark', 'Previous marker', 'Shift+ArrowUp'], ['nmark', 'Next marker', 'Shift+ArrowDown'],
    ['tstart', 'Trim start to playhead', '['], ['tend', 'Trim end to playhead', ']'], ['zin', 'Timeline zoom in', '+'], ['zout', 'Timeline zoom out', '-'],
    ['menu:layer:Marker list…', 'Marker list', ''], ['menu:layer:Nest clips (In to Out)', 'Nest clips (In to Out)', ''], ['menu:layer:Create multicam from clips at playhead', 'Create multicam', ''],
    ['menu:layer:Freeze frame at playhead', 'Freeze frame', ''], ['menu:layer:New text', 'New text', ''], ['menu:file:Record voiceover', 'Record voiceover', ''], ['menu:view:Toggle loop', 'Toggle loop', ''], ['menu:view:Fit to window', 'Fit viewer to window', '']
  ];
  const BY = Object.fromEntries(ACTIONS.map(a => [a[0], a]));
  let user = {}; try { user = JSON.parse(localStorage.getItem('nx.keys') || '{}') || {}; } catch (e) { user = {}; }
  const save = () => { try { localStorage.setItem('nx.keys', JSON.stringify(user)); } catch (e) { } };
  /** "Ctrl+Shift+K" for a keyboard event (null for a lone modifier) */
  function combo(e) {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null; let k = e.key === ' ' ? 'Space' : e.key;
    if (k.length === 1) k = k.toUpperCase(); if (k === 'Del') k = 'Delete';
    return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && (k.length > 1 || /^[A-Z]$/.test(k)) && 'Shift', k].filter(Boolean).join('+');
  }
  const binding = id => id in user ? user[id] : BY[id][2];
  function set(id, c) { if (!BY[id]) return; for (const a of ACTIONS) if (a[0] !== id && c && binding(a[0]) === c) user[a[0]] = ''; if (c === BY[id][2]) delete user[id]; else user[id] = c || ''; save(); }
  function reset(id) { if (id) delete user[id]; else user = {}; save(); }
  function eventFor(c) { const p = c.split('+'), k = p.pop(), key = k === 'Space' ? ' ' : k.length === 1 ? (p.includes('Shift') ? k : k.toLowerCase()) : k; return new KeyboardEvent('keydown', { key, code: k.length === 1 && /[A-Z]/.test(k) ? 'Key' + k : k, ctrlKey: p.includes('Ctrl'), altKey: p.includes('Alt'), shiftKey: p.includes('Shift'), bubbles: true, cancelable: true }); }
  let replaying = false;
  function run(id) {
    if (id.startsWith('menu:')) { const [, menu, ...rest] = id.split(':'), label = rest.join(':'), it = (menuItems(menu) || []).find(x => Array.isArray(x) && x[0] === label); if (it) it[1](); return; }
    replaying = true; try { (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body).dispatchEvent(eventFor(BY[id][2])); } finally { replaying = false; }
  }
  window.addEventListener('keydown', e => {
    if (replaying || S.capture || (typeof Shell !== 'undefined' && Shell.active !== 'edit')) return;
    const tg = e.target; if (tg.matches && tg.matches('input:not([type=range]):not([type=checkbox]):not([type=color]),textarea,select,[contenteditable]')) return;
    const c = combo(e); if (!c) return; const hit = ACTIONS.find(a => a[0] in user && user[a[0]] === c);
    if (hit) { e.preventDefault(); e.stopImmediatePropagation(); run(hit[0]); return; }
    // the old key of a remapped command no longer runs it
    if (ACTIONS.some(a => a[2] === c && a[0] in user && user[a[0]] !== c)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  const S = { capture: null };
  function open() {
    const q = el('input', { placeholder: 'Search commands', class: 'km-q' }), list = el('div', { class: 'km-list' });
    const draw = () => { list.innerHTML = ''; const f = q.value.toLowerCase(); for (const [id, label, def] of ACTIONS) { if (f && !label.toLowerCase().includes(f) && !binding(id).toLowerCase().includes(f)) continue; const b = binding(id), changed = id in user;
      list.append(el('div', { class: 'km-row' + (changed ? ' changed' : '') }, el('span', {}, label), el('button', { class: 'km-key', title: 'Click, then press the new keys (Esc cancels, Backspace clears)', onclick: e => capture(id, e.currentTarget) }, b || '—'), el('button', { class: 'ibtn', title: 'Back to ' + (def || 'no key'), disabled: changed ? undefined : '', onclick: () => { reset(id); draw(); } }, '↺'))); } };
    function capture(id, btn) { btn.textContent = 'Press keys…'; btn.classList.add('on');
      S.capture = e => { if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; e.preventDefault(); e.stopImmediatePropagation(); window.removeEventListener('keydown', S.capture, true); const fn = S.capture; S.capture = null;
        if (e.key === 'Escape') return draw(); const c = e.key === 'Backspace' ? '' : combo(e), other = c && ACTIONS.find(a => a[0] !== id && binding(a[0]) === c);
        set(id, c); draw(); if (other) toast(`${c} was used by "${other[1]}"; that command now has no key.`); void fn; };
      window.addEventListener('keydown', S.capture, true); }
    q.oninput = draw; q.onkeydown = e => e.stopPropagation(); draw();
    showModal('Keyboard shortcuts', el('div', { class: 'km' }, q, list), [['Reset all', () => { if (confirm('Put every shortcut back to its default?')) { reset(); draw(); } }], ['Done', () => { if (S.capture) { window.removeEventListener('keydown', S.capture, true); S.capture = null; } closeModal(); }, true]]);
    setTimeout(() => q.focus(), 0);
  }
  return { ACTIONS, combo, binding, set, reset, run, open, S, get user() { return JSON.parse(JSON.stringify(user)); }, load(o) { user = Object.assign({}, o); save(); } };
})();
