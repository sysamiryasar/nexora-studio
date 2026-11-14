'use strict';
/* ====================== autosave ======================
   Any edit in any mode calls Recovery.touch(); 3 s after the last change the open project is written to the
   project library (IndexedDB, see projects.js). Projects therefore survive crashes and reloads without a
   separate save step. Explicit "Export project file" still writes a portable .nexora file. */
const Recovery = {
  _t: null, busy: false, lastSaved: 0, suspended: false,
  touch() { if (Recovery.suspended) return; clearTimeout(Recovery._t); Recovery._t = setTimeout(Recovery.save, 3000); },
  async save() {
    if (!Projects.current) return;
    if (Recovery.busy || compStack.length || exporting || offlineBusy) return Recovery.touch(); // don't disturb an open precomp or an export
    Recovery.busy = true;
    try { await Projects.save(); Recovery.lastSaved = Date.now(); Shell.status && Shell.status('Saved ' + new Date().toLocaleTimeString()); }
    catch (e) { console.warn('autosave failed', e); Shell.status && Shell.status('Autosave failed'); }
    finally { Recovery.busy = false; }
  },
  /** save now (used when leaving a project) */
  async flush() { clearTimeout(Recovery._t); while (Recovery.busy) await new Promise(r => setTimeout(r, 50)); await Recovery.save(); }
};
