'use strict';
/* ====================== NEXORA shared asset registry ======================
   One store for every workspace:
   - `media`   (from the Edit engine): video / image / audio records. A record may carry `link: { doc, rev }`,
               meaning its pixels are produced by a NEXORA Image document and stay in sync with it.
   - `Assets.docs`: layered NEXORA Image documents.
   Workspaces exchange content only through this module (no exporting / re-importing). */
const Assets = {
  docs: {},
  /** reference counts: how many Edit layers (incl. nested comps) use each media id, and how many media records link each doc */
  usage() {
    const n = {}, add = id => n[id] = (n[id] || 0) + 1;
    const walk = ls => ls.forEach(l => { if (l.media) add(l.media); if (l.compRef) add(l.compRef); if (l.graphRef) add(l.graphRef); if (l.comp) walk(l.comp.layers); });
    walk(Motion.editProject().layers); Motion.list().forEach(c => walk(c.layers));
    for (const id in media) if (media[id].link) add(media[id].link.doc);
    VFX.list().forEach(g => { VFX.mediaRefs(g).forEach(add); Object.values(g.nodes).forEach(nd => { if (nd.type === 'comp' && nd.p.comp) add(nd.p.comp); }); });
    return n;
  },
  list() {
    const out = [];
    for (const id in media) { const m = media[id]; out.push({ id, kind: m.kind, name: m.name, thumb: m.thumb, w: m.w, h: m.h, dur: m.dur, link: m.link, missing: m.missing }); }
    for (const id in Assets.docs) { const d = Assets.docs[id]; out.push({ id, kind: 'image-doc', name: d.name, thumb: NXI.thumbURL(d, 220), w: d.w, h: d.h, layers: NXI.countLayers(d) }); }
    for (const c of Motion.list()) { let th = null; try { th = Motion.thumb(c, 220); } catch (e) { } out.push({ id: c.id, kind: 'motion-comp', name: c.name, thumb: th, w: c.w, h: c.h, dur: c.dur, layers: c.layers.length }); }
    for (const g of VFX.list()) { let th = null; try { th = VFX.thumb(g, 220); } catch (e) { } out.push({ id: g.id, kind: 'vfx-graph', name: g.name, thumb: th, w: g.w, h: g.h, dur: g.dur, layers: Object.keys(g.nodes).length }); }
    return out;
  },
  linkedMedia(docId) { return Object.values(media).filter(m => m.link && m.link.doc === docId); },
  async ensureBlob(m) {
    if (m.blob || !m.img || !m.img.toBlob) return m.blob;
    m.blob = await new Promise(r => m.img.toBlob(r, 'image/png'));
    return m.blob;
  },
  /** create (or reuse) the media record that mirrors an Image document */
  publishDoc(doc) {
    let m = Assets.linkedMedia(doc.id)[0];
    if (!m) { m = { id: uid(), name: doc.name + ' (Image)', kind: 'image', link: { doc: doc.id, rev: -1 }, w: doc.w, h: doc.h, dur: 5 }; media[m.id] = m; }
    Assets.syncDoc(doc, true); return m;
  },
  /** re-flatten a doc into every media record linked to it, if the doc changed since last sync */
  syncDoc(doc, force) {
    let changed = 0;
    for (const m of Assets.linkedMedia(doc.id)) {
      if (!force && m.link.rev === doc.rev && m.img) continue;
      const c = NXI.flatten(doc);
      m.img = c; m.w = c.width; m.h = c.height; m.blob = null; m.missing = false; m.link.rev = doc.rev;
      m.thumb = NXI.thumbURL(doc, 160); m.name = doc.name + ' (Image)'; changed++;
      Assets.ensureBlob(m);
    }
    if (changed) { requestRender(); renderTimeline(); uiMedia(); }
    return changed;
  },
  syncAll(force) { let n = 0; for (const id in Assets.docs) n += Assets.syncDoc(Assets.docs[id], force); return n; },
  /** open an Edit image asset in NEXORA Image; plain images become linked docs so edits flow back to the timeline */
  openMediaInImage(id) {
    const m = media[id]; if (!m) return;
    if (m.link && Assets.docs[m.link.doc]) { Shell.go('image'); NXI.ui.openDoc(Assets.docs[m.link.doc]); return; }
    if (m.kind !== 'image' || !m.img) return toast('Only image assets can be opened in NEXORA Image.');
    const doc = NXI.docFromImage(m.img, m.name.replace(/\.[^.]+$/, ''));
    Assets.docs[doc.id] = doc; m.link = { doc: doc.id, rev: doc.rev };
    Shell.go('image'); NXI.ui.openDoc(doc); toast('Linked: edits in NEXORA Image will update the Edit timeline.');
  },
  remove(id) {
    const u = Assets.usage()[id] || 0;
    if (u) { toast(`Can't delete: used ${u} time(s). Remove it from the timeline first.`); return false; }
    if (media[id]) { if (media[id].url && media[id].url.startsWith('blob:')) URL.revokeObjectURL(media[id].url); delete media[id]; }
    else if (Assets.docs[id]) { NXI.ui && NXI.ui.closeDoc(Assets.docs[id], true); delete Assets.docs[id]; }
    else if (Motion.S.comps[id]) { if (Motion.S.order.length < 2) { toast('Keep at least one composition.'); return false; } if (Motion.S.inMotion && Motion.S.active === id) { toast('Switch to another composition first.'); return false; } Motion.S.order = Motion.S.order.filter(x => x !== id); delete Motion.S.comps[id]; delete Motion.S.ctxs[id]; }
    else if (VFX.S.graphs[id]) { delete VFX.S.graphs[id]; VFX.S.order = VFX.S.order.filter(x => x !== id); if (VFX.S.active === id) VFX.S.active = VFX.S.order[0] || null; }
    uiMedia(); return true;
  },
  /** dangling references (for recovery/validation) */
  problems() {
    const out = [], walk = ls => ls.forEach(l => { if (l.media && !media[l.media]) out.push(`Layer "${l.name}" references missing media`); if (l.compRef && !Motion.getComp(l.compRef)) out.push(`Layer "${l.name}" links to a missing Motion composition`); if (l.graphRef && !VFX.graph(l.graphRef)) out.push(`Layer "${l.name}" links to a missing VFX graph`); if (l.comp) walk(l.comp.layers); });
    walk(Motion.editProject().layers); Motion.list().forEach(c => walk(c.layers));
    for (const id in media) { const m = media[id]; if (m.link && !Assets.docs[m.link.doc]) out.push(`"${m.name}" links to a missing image document`); if (m.missing) out.push(`"${m.name}" has no media data (relink needed)`); }
    return out;
  }
};
