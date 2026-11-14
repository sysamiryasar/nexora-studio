'use strict';
/* ====================== NEXORA project schema ======================
   v1  { fusion: 1, project, media }                                               (Fusion Studio files)
   v2  { nexora: { schema: 2 }, edit: { project, media }, images: {}, assets: {} }
   v3  v2 + motion: { comps: [timeline…], active } + vfx: { graphs: [graph…], active }
   Migrations are pure functions; validate() returns a list of human-readable problems (empty = valid). */
const Schema = {
  CURRENT: 3,
  detect(o) { if (o && o.nexora && typeof o.nexora.schema === 'number') return o.nexora.schema; if (o && o.fusion) return 1; return 0; },
  envelope(parts) {
    return { nexora: { schema: Schema.CURRENT, app: 'NEXORA Studio', saved: new Date().toISOString() }, edit: parts.edit || null, images: parts.images || {}, motion: parts.motion || { comps: [], active: null }, vfx: parts.vfx || { graphs: [], active: null }, assets: parts.assets || {} };
  },
  migrations: {
    1: o => ({ nexora: { schema: 2, app: 'NEXORA Studio', migratedFrom: 1 }, edit: { fusion: 1, project: o.project, media: o.media || {} }, images: {}, assets: {} }),
    2: o => Object.assign({}, o, { nexora: Object.assign({}, o.nexora, { schema: 3 }), motion: { comps: [], active: null }, vfx: { graphs: [], active: null } })
  },
  migrate(o) {
    let v = Schema.detect(o); if (!v) throw new Error('Unrecognised file: not a NEXORA or Fusion project');
    if (v > Schema.CURRENT) throw new Error(`Project schema v${v} is newer than this app (v${Schema.CURRENT}). Update NEXORA Studio.`);
    while (v < Schema.CURRENT) { o = Schema.migrations[v](o); v = Schema.detect(o); }
    return o;
  },
  validate(o) {
    const err = [], isNum = x => typeof x === 'number' && isFinite(x), mediaIds = (o.edit && o.edit.media) || {};
    const comps = new Set(((o.motion || {}).comps || []).map(c => c.id)), graphs = new Set(((o.vfx || {}).graphs || []).map(g => g.id));
    if (Schema.detect(o) !== Schema.CURRENT) err.push('schema version is not current');
    const walk = (ls, path) => ls.forEach((l, i) => {
      const at = `${path}[${i}]`;
      if (!l.id || !l.type) err.push(at + ' missing id/type');
      if (!isNum(l.start) || !isNum(l.dur) || l.dur <= 0) err.push(at + ' invalid timing');
      if (l.media && !mediaIds[l.media]) err.push(at + ` references missing media ${l.media}`);
      if (l.compRef && !comps.has(l.compRef)) err.push(at + ` links to missing Motion composition ${l.compRef}`);
      if (l.graphRef && !graphs.has(l.graphRef)) err.push(at + ` links to missing VFX graph ${l.graphRef}`);
      if (l.type === 'comp' && !l.compRef) { if (!l.comp || !Array.isArray(l.comp.layers)) err.push(at + ' comp without layers'); else walk(l.comp.layers, at + '.comp'); }
    });
    const e = o.edit;
    if (e) {
      const p = e.project; if (!p || !Array.isArray(p.layers)) err.push('edit.project.layers missing');
      else { if (!isNum(p.w) || !isNum(p.h) || p.w < 1 || p.h < 1) err.push('edit.project has invalid size'); walk(p.layers, 'edit.layers'); }
      for (const id in (e.media || {})) { const m = e.media[id]; if (m.link && !(o.images || {})[m.link.doc]) err.push(`media ${id} links to missing image doc ${m.link.doc}`); }
    }
    for (const id in (o.images || {})) {
      const d = o.images[id];
      if (d.format !== 'nexora-image') err.push(`image ${id} has wrong format tag`);
      if (!isNum(d.w) || !isNum(d.h)) err.push(`image ${id} has invalid size`);
      if (!Array.isArray(d.layers)) err.push(`image ${id} has no layer list`);
    }
    ((o.motion || {}).comps || []).forEach(c => { if (!c.id || !Array.isArray(c.layers)) err.push(`motion comp ${c.name || '?'} is malformed`); else { if (!isNum(c.w) || !isNum(c.h) || !isNum(c.dur)) err.push(`motion comp ${c.name} has invalid settings`); walk(c.layers, `motion[${c.name}]`); } });
    ((o.vfx || {}).graphs || []).forEach(g => {
      if (!g.id || !g.nodes || !Array.isArray(g.links)) return err.push(`vfx graph ${g.name || '?'} is malformed`);
      const ids = new Set(Object.keys(g.nodes));
      g.links.forEach(l => { if (!ids.has(l.from) || !ids.has(l.to)) err.push(`vfx graph ${g.name}: link to a missing node`); });
      if (!Object.values(g.nodes).some(n => n.type === 'output')) err.push(`vfx graph ${g.name} has no Output node`);
      Object.values(g.nodes).forEach(n => { if (n.type === 'media' && n.p.media && !mediaIds[n.p.media]) err.push(`vfx graph ${g.name}: media node uses missing asset`); if (n.type === 'comp' && n.p.comp && !comps.has(n.p.comp)) err.push(`vfx graph ${g.name}: comp node uses missing composition`); });
    });
    return err;
  }
};
