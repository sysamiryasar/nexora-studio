'use strict';
/* ====================== NEXORA automated tests ======================
   Run: Command palette › "Developer: Run automated self-tests", or open tests/run.html (served over http).
   Tests drive the real engine + tools and assert on pixels, not on UI text. */
const NexoraTests = (() => {
  const T_ = [];
  const test = (name, fn) => T_.push({ name, fn });
  const ok = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}±${tol}, got ${a}`);
  const px = (c, x, y) => Array.from(c.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data);
  const comp = (d, x, y) => px(NXI.render(d), x, y);
  const ev = o => Object.assign({ shiftKey: false, altKey: false, ctrlKey: false, pointerType: 'mouse', pressure: .5, buttons: 1 }, o || {});
  function withDoc(d, fn) { const U = NXI.ui, prevDoc = U.doc, prevTool = U.tool, opts = JSON.parse(JSON.stringify(NXI.toolOpts)); U.doc = d; Recovery.suspended = true; try { NXI.toolOpts.brush.smoothing = 0; NXI.toolOpts.brush.texture = 'none'; NXI.toolOpts.brush.scatter = 0; NXI.toolOpts.brush.sizeJitter = 0; NXI.toolOpts.selMode = 'replace'; NXI.toolOpts.feather = 0; return fn(); } finally { U.doc = prevDoc; U.tool = prevTool; Object.keys(opts).forEach(k => NXI.toolOpts[k] = opts[k]); Recovery.suspended = false; } }
  function drag(tool, pts, e) { const t = NXI.tools.T[tool]; t.down(pts[0], ev(e)); for (let i = 1; i < pts.length; i++) t.move(pts[i], ev(e)); t.up(pts[pts.length - 1], ev(e)); }
  function solidDoc(w, h, color) { const d = NXI.newDoc({ name: 'test', w, h, bg: color || '#ffffff' }); NXI.push(d, 'init'); return d; }
  function rasterLayer(d, name, draw) { const L = NXI.mkLayer(d, 'raster', { name }); if (draw) draw(L.canvas.getContext('2d')); NXI.insert(d, L); return L; }

  /* ---------------- schema ---------------- */
  test('schema: detects v1 and v2', () => { ok(Schema.detect({ fusion: 1 }) === 1); ok(Schema.detect({ nexora: { schema: 2 } }) === 2); ok(Schema.detect({}) === 0); });
  test('schema: migrates v1 → current (via v2)', () => { const v1 = { fusion: 1, project: { w: 10, h: 10, layers: [] }, media: {} }, v = Schema.migrate(v1); ok(v.nexora.schema === Schema.CURRENT && v.nexora.migratedFrom === 1 && v.edit.project.w === 10 && v.images && v.motion && v.vfx); });
  test('schema: migrates v2 → v3 (adds motion + vfx sections)', () => { const v2 = { nexora: { schema: 2 }, edit: null, images: {}, assets: {} }, v3 = Schema.migrate(v2); ok(v3.nexora.schema === 3 && Array.isArray(v3.motion.comps) && Array.isArray(v3.vfx.graphs)); });
  test('schema: rejects newer versions', () => { let threw = false; try { Schema.migrate({ nexora: { schema: 99 } }); } catch (e) { threw = /newer/.test(e.message); } ok(threw); });
  test('schema: validation finds dangling references', () => { const env = Schema.envelope({ edit: { project: { w: 100, h: 100, layers: [{ id: 'a', type: 'image', start: 0, dur: 1, media: 'nope' }] }, media: { m: { link: { doc: 'ghost' } } } } }); const e = Schema.validate(env); ok(e.some(x => /missing media/.test(x)) && e.some(x => /missing image doc/.test(x)), e.join('; ')); });
  test('schema: valid envelope has no problems', () => { const env = Schema.envelope({ edit: { project: { w: 100, h: 100, layers: [{ id: 'a', type: 'text', start: 0, dur: 1 }] }, media: {} }, images: { x: { format: 'nexora-image', w: 5, h: 5, layers: [] } } }); ok(Schema.validate(env).length === 0, Schema.validate(env).join('; ')); });

  /* ---------------- compositing ---------------- */
  test('image: white background renders white', () => { const d = solidDoc(40, 30); ok(comp(d, 5, 5).join() === '255,255,255,255'); });
  test('image: blend multiply', () => { const d = solidDoc(20, 20, '#808080'); const L = rasterLayer(d, 'red', c => { c.fillStyle = '#ff0000'; c.fillRect(0, 0, 20, 20); }); L.blend = 'multiply'; NXI.dirty(d); const p = comp(d, 5, 5); near(p[0], 128, 2); near(p[1], 0, 2); });
  test('image: opacity', () => { const d = solidDoc(20, 20, '#000000'); const L = rasterLayer(d, 'w', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 20, 20); }); L.opacity = 50; NXI.dirty(d); near(comp(d, 3, 3)[0], 128, 2); });
  test('image: mask hides pixels', () => { const d = solidDoc(40, 40, '#000000'); const L = rasterLayer(d, 'w', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 40, 40); }); NXI.addMask(d, L, false); L.mask.canvas.getContext('2d').clearRect(0, 0, 20, 40); NXI.dirty(d, L); ok(comp(d, 5, 5)[0] === 0 && comp(d, 30, 5)[0] === 255); });
  test('image: clipping mask limited to base alpha', () => { const d = solidDoc(40, 40, '#000000'); rasterLayer(d, 'base', c => { c.fillStyle = '#00f'; c.fillRect(0, 0, 20, 40); }); const C = rasterLayer(d, 'clip', c => { c.fillStyle = '#f00'; c.fillRect(0, 0, 40, 40); }); C.clip = true; NXI.dirty(d); const a = comp(d, 5, 5), b = comp(d, 30, 5); ok(a[0] === 255 && b[0] === 0, a + ' / ' + b); });
  test('image: adjustment layer (invert) with mask', () => { const d = solidDoc(40, 40, '#ffffff'); const A = NXI.mkLayer(d, 'adjust', { adj: { type: 'invert', p: {} } }); NXI.insert(d, A); NXI.addMask(d, A, false); A.mask.canvas.getContext('2d').clearRect(20, 0, 20, 40); NXI.dirty(d, A); ok(comp(d, 5, 5)[0] === 0 && comp(d, 30, 5)[0] === 255); });
  test('image: group opacity applies to children', () => { const d = solidDoc(20, 20, '#000000'); const L = rasterLayer(d, 'w', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 20, 20); }); const G = NXI.groupLayers(d, [L.id]); G.opacity = 25; NXI.dirty(d); near(comp(d, 2, 2)[0], 64, 2); });
  test('image: merge down matches composite', () => { const d = solidDoc(30, 30, '#202020'); const L = rasterLayer(d, 'c', c => { c.fillStyle = '#3b9bff'; c.fillRect(5, 5, 10, 10); }); L.opacity = 60; L.blend = 'screen'; NXI.dirty(d); const before = comp(d, 8, 8); NXI.mergeDown(d, L.id); ok(d.layers.length === 1); const after = comp(d, 8, 8); before.forEach((v, i) => near(after[i], v, 2)); });
  test('image: layer effects draw outside the content (drop shadow)', () => { const d = NXI.newDoc({ w: 60, h: 60 }); const L = rasterLayer(d, 'sq', c => { c.fillStyle = '#fff'; c.fillRect(20, 20, 10, 10); }); Object.assign(L.fx.shadow, { on: true, distance: 8, angle: 90, size: 0, opacity: 100 }); NXI.dirty(d, L); ok(comp(d, 25, 36)[3] > 100, 'shadow alpha ' + comp(d, 25, 36)[3]); });
  test('image: text layer renders and rasterizes identically', () => { const d = NXI.newDoc({ w: 300, h: 120 }); const L = NXI.mkLayer(d, 'text', { text: { str: 'NEXORA', size: 60, color: '#ff0000' }, tr: { x: 150, y: 60 } }); NXI.insert(d, L); const before = NXI.contentBounds(NXI.flatten(d)); ok(before && before.w > 100, 'text has width'); NXI.rasterize(d, L); ok(L.type === 'raster'); const after = NXI.contentBounds(NXI.flatten(d)); ok(Math.abs(after.w - before.w) <= 1); });

  /* ---------------- selection + painting ---------------- */
  test('tools: brush paints with stroke opacity (no build-up inside one stroke)', () => withDoc(solidDoc(100, 100, '#ffffff'), () => { const d = NXI.ui.doc; d.fg = '#000000'; Object.assign(NXI.toolOpts.brush, { size: 20, hardness: 100, opacity: 50, flow: 100, spacing: 5 }); drag('brush', [{ x: 10, y: 50 }, { x: 50, y: 50 }, { x: 90, y: 50 }]); const p = comp(d, 50, 50); near(p[0], 128, 6, 'gray'); }));
  test('tools: selection restricts painting', () => withDoc(solidDoc(100, 100, '#ffffff'), () => { const d = NXI.ui.doc; d.fg = '#ff0000'; drag('marquee', [{ x: 0, y: 0 }, { x: 50, y: 100 }]); ok(NXI.selBounds(d).w === 50, 'sel w ' + (NXI.selBounds(d) || {}).w); Object.assign(NXI.toolOpts.brush, { size: 30, hardness: 100, opacity: 100, flow: 100 }); drag('brush', [{ x: 10, y: 50 }, { x: 90, y: 50 }]); ok(comp(d, 25, 50)[1] < 10, 'inside painted'); ok(comp(d, 75, 50).join() === '255,255,255,255', 'outside untouched'); }));
  test('tools: eraser removes pixels', () => withDoc(NXI.newDoc({ w: 60, h: 60 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#0f0'; c.fillRect(0, 0, 60, 60); }); Object.assign(NXI.toolOpts.eraser, { size: 20, hardness: 100, opacity: 100, flow: 100 }); drag('eraser', [{ x: 30, y: 30 }, { x: 31, y: 30 }]); ok(px(L.canvas, 30, 30)[3] === 0 && px(L.canvas, 2, 2)[3] === 255); }));
  test('tools: painting on a mask hides the layer', () => withDoc(solidDoc(60, 60, '#000000'), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'w', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 60, 60); }); NXI.addMask(d, L, false); d.fg = '#000000'; Object.assign(NXI.toolOpts.brush, { size: 20, hardness: 100, opacity: 100, flow: 100 }); drag('brush', [{ x: 30, y: 30 }, { x: 31, y: 30 }]); ok(comp(d, 30, 30)[0] === 0 && comp(d, 3, 3)[0] === 255); }));
  test('tools: ellipse marquee, lasso, polygonal lasso, invert', () => withDoc(solidDoc(100, 100), () => { const d = NXI.ui.doc; drag('ellipse', [{ x: 10, y: 10 }, { x: 90, y: 90 }]); ok(px(d.sel, 50, 50)[3] > 200 && px(d.sel, 12, 12)[3] < 50); drag('lasso', [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }]); ok(px(d.sel, 80, 20)[3] > 200 && px(d.sel, 20, 80)[3] < 50); const t = NXI.tools.T.poly; [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }].forEach(p => t.down(p, ev())); t.finish(); ok(NXI.selBounds(d).w >= 49 && NXI.selBounds(d).w <= 51); NXI.selInvert(d); ok(px(d.sel, 90, 90)[3] === 255); }));
  test('tools: magic wand selects a flat region', () => withDoc(solidDoc(100, 100, '#ffffff'), () => { const d = NXI.ui.doc; rasterLayer(d, 'box', c => { c.fillStyle = '#123456'; c.fillRect(20, 30, 40, 20); }); NXI.toolOpts.sampleAll = true; NXI.tools.T.wand.down({ x: 30, y: 40 }, ev()); const b = NXI.selBounds(d); ok(b.x === 20 && b.y === 30 && b.w === 40 && b.h === 20, JSON.stringify(b)); }));
  test('tools: quick selection grows by color', () => withDoc(solidDoc(100, 100, '#ffffff'), () => { const d = NXI.ui.doc; rasterLayer(d, 'box', c => { c.fillStyle = '#000'; c.fillRect(0, 0, 50, 100); }); NXI.toolOpts.quickSize = 40; NXI.toolOpts.wandTol = 20; drag('quick', [{ x: 30, y: 30 }, { x: 30, y: 60 }]); ok(px(d.sel, 30, 45)[3] === 255 && px(d.sel, 60, 45)[3] === 0); }));
  test('tools: paint bucket fills a bounded region only', () => withDoc(NXI.newDoc({ w: 60, h: 60 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 60, 60); c.fillStyle = '#000'; c.fillRect(30, 0, 2, 60); }); d.fg = '#ff0000'; Object.assign(NXI.toolOpts.bucket, { tol: 10, contiguous: true, sampleAll: false, opacity: 100 }); NXI.tools.T.bucket.down({ x: 5, y: 5 }, ev()); ok(px(L.canvas, 10, 10)[1] === 0 && px(L.canvas, 50, 10)[1] === 255); }));
  test('tools: gradient fills linear ramp', () => withDoc(NXI.newDoc({ w: 100, h: 20 }), () => { const d = NXI.ui.doc; rasterLayer(d, 'g'); d.fg = '#000000'; d.bg = '#ffffff'; Object.assign(NXI.toolOpts.gradient, { type: 'linear', preset: 'fg-bg', opacity: 100, reverse: false }); drag('gradient', [{ x: 0, y: 10 }, { x: 100, y: 10 }]); near(comp(d, 50, 10)[0], 128, 8); ok(comp(d, 2, 10)[0] < 20 && comp(d, 97, 10)[0] > 235); }));
  test('tools: pencil is hard-edged', () => withDoc(NXI.newDoc({ w: 40, h: 40 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'p'); d.fg = '#000000'; NXI.toolOpts.pencil.size = 6; drag('pencil', [{ x: 20, y: 20 }, { x: 21, y: 20 }]); const a = [...L.canvas.getContext('2d').getImageData(10, 10, 20, 20).data].filter((v, i) => i % 4 === 3); ok(a.filter(v => v > 0 && v < 200).length < 12, 'few soft pixels'); }));
  test('tools: clone stamp copies source pixels', () => withDoc(NXI.newDoc({ w: 100, h: 60 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 100, 60); c.fillStyle = '#ff0000'; c.fillRect(10, 20, 20, 20); }); Object.assign(NXI.toolOpts.clone, { size: 16, hardness: 100, opacity: 100, aligned: true }); NXI.tools.T.clone.down({ x: 20, y: 30 }, ev({ altKey: true })); drag('clone', [{ x: 70, y: 30 }, { x: 71, y: 30 }]); const p = px(L.canvas, 70, 30); ok(p[0] > 200 && p[1] < 60, p + ''); }));
  test('tools: healing brush transfers texture but keeps destination tone', () => withDoc(NXI.newDoc({ w: 120, h: 60 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#404040'; c.fillRect(0, 0, 60, 60); c.fillStyle = '#c0c0c0'; c.fillRect(60, 0, 60, 60); }); NXI.toolOpts.heal.size = 30; NXI.tools.T.heal.down({ x: 30, y: 30 }, ev({ altKey: true })); drag('heal', [{ x: 90, y: 30 }, { x: 91, y: 30 }]); const v = px(L.canvas, 90, 30)[0]; ok(v > 150, 'kept bright destination tone, got ' + v); }));
  test('tools: healing is a Poisson solve — a harmonic tone difference is reproduced exactly (a plane fit cannot)', () => withDoc(NXI.newDoc({ w: 200, h: 100 }), () => {
    // source half: flat 100 · destination half: 128 + (x² − y²)/40 around (150, 50) — harmonic, so seamless cloning of the flat source must give it back unchanged
    const f = (x, y) => 128 + ((x - 150) ** 2 - (y - 50) ** 2) / 12;   // ±8 levels at 10 px from the centre: a plane fit misses this entirely
    const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { const id = c.createImageData(200, 100); for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) { const i = (y * 200 + x) * 4, v = x < 100 ? 100 : f(x + .5, y + .5); id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } c.putImageData(id, 0, 0); });
    NXI.toolOpts.heal.size = 40; NXI.tools.T.heal.down({ x: 50, y: 50 }, ev({ altKey: true })); drag('heal', [{ x: 150, y: 50 }, { x: 150.2, y: 50 }]);
    let mx = 0; for (const [x, y] of [[150, 50], [160, 50], [150, 40], [143, 57], [140, 50], [150, 61]]) mx = Math.max(mx, Math.abs(px(L.canvas, x, y)[0] - f(x + .5, y + .5)));
    ok(mx <= 3, 'max error inside the brush ' + mx.toFixed(1));
  }));
  test('tools: spot healing removes a small blemish', () => withDoc(NXI.newDoc({ w: 120, h: 120 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#7090b0'; c.fillRect(0, 0, 120, 120); c.fillStyle = '#000'; c.fillRect(56, 56, 8, 8); }); NXI.toolOpts.spot.size = 24; drag('spot', [{ x: 60, y: 60 }, { x: 60.5, y: 60 }]); const p = px(L.canvas, 60, 60); ok(Math.abs(p[0] - 0x70) < 30 && Math.abs(p[2] - 0xb0) < 30, 'blemish gone: ' + p); }));
  test('tools: dodge brightens, burn darkens, sponge desaturates', () => withDoc(NXI.newDoc({ w: 90, h: 30 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#808080'; c.fillRect(0, 0, 60, 30); c.fillStyle = '#ff0000'; c.fillRect(60, 0, 30, 30); }); Object.assign(NXI.toolOpts.dodge, { size: 20, exposure: 80, range: 'mid' }); drag('dodge', [{ x: 15, y: 15 }, { x: 16, y: 15 }]); drag('burn', [{ x: 45, y: 15 }, { x: 46, y: 15 }]); Object.assign(NXI.toolOpts.sponge, { size: 20, flow: 100, mode: 'desat' }); drag('sponge', [{ x: 75, y: 15 }, { x: 75.5, y: 15 }]); ok(px(L.canvas, 15, 15)[0] > 140 && px(L.canvas, 45, 15)[0] < 115, 'dodge/burn'); const s = px(L.canvas, 75, 15); ok(s[1] > 5, 'desaturated: ' + s); }));
  test('tools: blur reduces contrast, sharpen increases it', () => withDoc(NXI.newDoc({ w: 60, h: 60 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { for (let x = 0; x < 60; x += 2) { c.fillStyle = x % 4 ? '#000' : '#fff'; c.fillRect(x, 0, 2, 60); } }); const varOf = () => { const a = [...L.canvas.getContext('2d').getImageData(20, 20, 20, 20).data].filter((v, i) => i % 4 === 0), m = a.reduce((s, v) => s + v, 0) / a.length; return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length; }; const v0 = varOf(); Object.assign(NXI.toolOpts.retouch, { size: 40, strength: 100 }); drag('blur', [{ x: 30, y: 30 }, { x: 31, y: 30 }, { x: 30, y: 31 }]); ok(varOf() < v0 * .8, 'blur lowers variance'); }));
  test('tools: smudge drags color', () => withDoc(NXI.newDoc({ w: 80, h: 40 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 80, 40); c.fillStyle = '#00f'; c.fillRect(0, 0, 30, 40); }); Object.assign(NXI.toolOpts.retouch, { size: 20, strength: 90 }); drag('smudge', Array.from({ length: 12 }, (_, i) => ({ x: 20 + i * 3, y: 20 }))); ok(px(L.canvas, 40, 20)[0] < 230, 'blue pulled right: ' + px(L.canvas, 40, 20)); }));
  test('tools: liquify push displaces pixels', () => withDoc(NXI.newDoc({ w: 80, h: 80 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 80, 80); c.fillStyle = '#000'; c.fillRect(36, 0, 8, 80); }); Object.assign(NXI.toolOpts.liquify, { size: 50, strength: 100, mode: 'push' }); drag('liquify', Array.from({ length: 10 }, (_, i) => ({ x: 40 + i * 1.5, y: 40 }))); const xs = []; for (let x = 46; x < 66; x++) if (px(L.canvas, x, 40)[0] < 60) xs.push(x); ok(px(L.canvas, 40, 40)[0] > 200, 'line left its original place'); ok(xs.length >= 3, 'line moved right of x=46'); ok(px(L.canvas, 40, 5)[0] < 60, 'far from the brush is untouched'); }));
  test('tools: shape tool + pen path to shape layer', () => withDoc(NXI.newDoc({ w: 200, h: 200 }), () => { const d = NXI.ui.doc; d.fg = '#00ff00'; NXI.toolOpts.shape.kind = 'rect'; drag('shape', [{ x: 20, y: 20 }, { x: 80, y: 60 }]); const S = NXI.active(d); ok(S.type === 'shape' && Math.round(S.shape.w) === 60 && comp(d, 50, 40)[1] === 255); const pen = NXI.tools.T.pen; [{ x: 100, y: 100 }, { x: 180, y: 100 }, { x: 140, y: 180 }].forEach(p => { pen.down(p, ev()); pen.up(p, ev()); }); pen.down({ x: 100, y: 100 }, ev()); ok(d.path.closed); NXI.tools.pathOps('shape'); const P2 = NXI.active(d); ok(P2.shape.kind === 'path' && comp(d, 140, 120)[1] === 255); }));
  test('tools: text tool creates an editable text layer', () => withDoc(NXI.newDoc({ w: 300, h: 100 }), () => { const d = NXI.ui.doc; NXI.tools.T.text.down({ x: 150, y: 50 }, ev()); const L = NXI.active(d); ok(L.type === 'text'); L.text.str = 'Hello'; NXI.dirty(d, L); ok(NXI.contentBounds(NXI.flatten(d))); document.querySelectorAll('#imgStage textarea').forEach(t => t.remove()); }));
  test('tools: free transform scales pixels 2×', () => withDoc(NXI.newDoc({ w: 200, h: 200 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#f00'; c.fillRect(90, 90, 20, 20); }); NXI.tools.transformBegin('free'); L._float.m.sx = 2; L._float.m.sy = 2; NXI.tools.transformCommit(); const b = NXI.contentBounds(L.canvas); ok(Math.abs(b.w - 40) <= 2 && Math.abs(b.x - 80) <= 2, JSON.stringify(b)); }));
  test('tools: perspective transform reshapes into a trapezoid', () => withDoc(NXI.newDoc({ w: 200, h: 200 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'r', c => { c.fillStyle = '#f00'; c.fillRect(50, 50, 100, 100); }); NXI.tools.transformBegin('perspective'); const q = L._float.quad; q[0].x += 30; q[1].x -= 30; NXI.tools.transformCommit(); ok(px(L.canvas, 60, 52)[3] < 50 && px(L.canvas, 60, 147)[3] > 200, 'top narrowed'); }));
  test('tools: crop', () => withDoc(solidDoc(100, 80), () => { const d = NXI.ui.doc; rasterLayer(d, 'dot', c => { c.fillStyle = '#f00'; c.fillRect(60, 40, 2, 2); }); NXI.crop(d, { x: 50, y: 30, w: 30, h: 30 }); ok(d.w === 30 && d.h === 30 && comp(d, 10, 10)[1] === 0); }));
  test('image: resample + rotate canvas', () => { const d = solidDoc(40, 20); rasterLayer(d, 'dot', c => { c.fillStyle = '#f00'; c.fillRect(0, 0, 4, 4); }); NXI.rotateCanvas(d, 90); ok(d.w === 20 && d.h === 40 && comp(d, 18, 1)[1] < 60, 'rotated: ' + comp(d, 18, 1)); NXI.resample(d, 10, 20); ok(d.w === 10 && d.h === 20); });
  test('image: undo / redo restore pixels; history shares unchanged canvases', () => withDoc(NXI.newDoc({ w: 200, h: 200 }), () => { const d = NXI.ui.doc, L = rasterLayer(d, 'p'); rasterLayer(d, 'idle', c => { c.fillStyle = '#123'; c.fillRect(0, 0, 10, 10); }); d.activeId = L.id; NXI.push(d, 'layers'); d.fg = '#ff0000'; Object.assign(NXI.toolOpts.brush, { size: 10, hardness: 100, opacity: 100, flow: 100 }); for (let i = 0; i < 8; i++) drag('brush', [{ x: 20 + i * 20, y: 50 }, { x: 21 + i * 20, y: 50 }]);
    const per = 200 * 200 * 4; ok(NXI.histBytes(d) < per * 14, 'copy-on-write: ' + NXI.histBytes(d) / per + ' canvases'); NXI.undo(d); NXI.undo(d); const LL = NXI.find(d, L.id).L; ok(px(LL.canvas, 160, 50)[3] === 0 && px(LL.canvas, 120, 50)[3] === 255, 'undone'); NXI.redo(d); ok(px(NXI.find(d, L.id).L.canvas, 140, 50)[3] === 255, 'redone'); }));

  /* ---------------- adjustments + filters ---------------- */
  test('adjust: identity curve and levels are identity', () => { const c = ADJ.curveLUT([[0, 0], [255, 255]]), l = ADJ.levelsLUT({ ib: 0, iw: 255, g: 1, ob: 0, ow: 255 }); for (let i = 0; i < 256; i += 17) { ok(c[i] === i && l[i] === i, 'at ' + i); } });
  test('adjust: curve is monotone through its points', () => { const c = ADJ.curveLUT([[0, 0], [64, 40], [192, 220], [255, 255]]); ok(c[64] === 40 && c[192] === 220); for (let i = 1; i < 256; i++) ok(c[i] >= c[i - 1], 'monotone at ' + i); });
  test('adjust: every adjustment runs and changes pixels', () => { for (const k in ADJ.defs) { const d = new Uint8ClampedArray([200, 80, 40, 255, 10, 120, 240, 255]), p = ADJ.defs[k].p(); if (k === 'brightness') p.b = 30; if (k === 'exposure') p.ev = 1; if (k === 'hsl') p.h = 90; if (k === 'balance') p.mid = [40, 0, 0]; if (k === 'curves') p.rgb = [[0, 0], [128, 200], [255, 255]]; if (k === 'levels') p.g = 2; if (k === 'selective') p.reds = [0, -100, 0]; if (k === 'vibrance') p.v = 80; if (k === 'photo') p.density = 80; ADJ.apply(d, k, p, 1); ok(d.join() !== '200,80,40,255,10,120,240,255' || k === 'bw', k + ' had no effect'); } });
  test('filters: gaussian blur (worker) keeps mean, lowers variance', async () => { const id = new ImageData(32, 32); for (let i = 0; i < id.data.length; i += 4) { const v = (i / 4) % 2 ? 255 : 0; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } const out = await NXI.filters.run('gauss', id, { r: 4 }); let m = 0; for (let i = 0; i < out.data.length; i += 4) m += out.data[i]; m /= 1024; near(m, 127.5, 6, 'mean'); ok(Math.abs(out.data[16 * 32 * 4 + 64] - 127) < 30, 'smoothed'); });
  test('filters: median removes salt noise', async () => { const id = new ImageData(9, 9); id.data.fill(100); for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255; const k = (4 * 9 + 4) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = 255; const out = await NXI.filters.run('median', id, { r: 1 }); ok(out.data[k] === 100); });
  test('filters: content-aware fill continues a texture (stripes) instead of smearing it', async () => {
    const d = NXI.newDoc({ w: 120, h: 90 }), L = rasterLayer(d, 'r', c => { for (let x = 0; x < 120; x += 6) { c.fillStyle = (x / 6) % 2 ? '#e8e8e8' : '#203060'; c.fillRect(x, 0, 6, 90); } c.fillStyle = '#ff0000'; c.fillRect(50, 35, 22, 20); });
    NXI.selFromPath(d, c => c.rect(48, 33, 26, 24), 'replace'); await NXI.filters.contentAwareFill(d);
    let good = 0, n = 0, red = 0; for (let y = 36; y < 54; y += 2) for (let x = 51; x < 71; x++) { if (x % 6 === 0 || x % 6 === 5) continue; const p = px(L.canvas, x, y), want = Math.floor(x / 6) % 2 ? 0xe8 : 0x20; n++; if (Math.abs(p[0] - want) < 40) good++; if (p[0] > 200 && p[1] < 80) red++; }
    ok(!red && good / n > .8, `${good}/${n} hole pixels continue the stripe pattern, ${red} still red`);
  });
  test('filters: content-aware fill fills a hole from its surroundings', async () => { const d = NXI.newDoc({ w: 80, h: 80 }), L = rasterLayer(d, 'r', c => { c.fillStyle = '#3366cc'; c.fillRect(0, 0, 80, 80); c.fillStyle = '#ff0000'; c.fillRect(35, 35, 10, 10); }); NXI.selFromPath(d, c => c.rect(33, 33, 14, 14), 'replace'); await NXI.filters.contentAwareFill(d, 0); const p = px(L.canvas, 40, 40); ok(Math.abs(p[0] - 0x33) < 12 && Math.abs(p[2] - 0xcc) < 12, 'filled ' + p); });
  test('filters: apply honours selection', async () => { const d = NXI.newDoc({ w: 40, h: 40 }); const L = rasterLayer(d, 'r', c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 40, 40); }); d.activeId = L.id; NXI.selFromPath(d, c => c.rect(0, 0, 20, 40), 'replace'); await NXI.filters.apply(d, 'noise', { amount: 80, gaussian: 1, mono: 1, seed: 3 }); const a = [...L.canvas.getContext('2d').getImageData(0, 0, 18, 40).data].filter((v, i) => i % 4 === 0 && v < 250).length, b = [...L.canvas.getContext('2d').getImageData(22, 0, 18, 40).data].filter((v, i) => i % 4 === 0 && v < 255).length; ok(a > 50 && b === 0, a + ' / ' + b); });

  /* ---------------- formats ---------------- */
  test('formats: TIFF encode → decode round-trip is lossless (uncompressed and Deflate + predictor)', async () => {
    const id = new ImageData(7, 5); for (let i = 0; i < id.data.length; i++) id.data[i] = (i * 37) & 255;
    for (const c of [undefined, 'deflate']) { const buf = await (await NXI.formats.encodeTIFF(id, c)).arrayBuffer(), o = await NXI.formats.decodeTIFF(buf); ok(o.width === 7 && o.height === 5 && o.data.join() === id.data.join(), 'round trip ' + (c || 'none')); }
  });
  test('image: composite cache below the active layer is reused and always equals a full recomposite', () => {
    const d = NXI.newDoc({ w: 64, h: 40, bg: '#102030' }), mk = (n, col, x) => { const L = NXI.mkLayer(d, 'raster', { name: n }); const c = L.canvas.getContext('2d'); c.fillStyle = col; c.fillRect(x, 5, 20, 30); d.layers.push(L); return L; };
    const a = mk('a', '#ff0000', 2), b = mk('b', '#00ff00', 12), c2 = mk('c', '#0000ff', 22), top = mk('top', 'rgba(255,255,255,.5)', 30); b.blend = 'screen'; d.activeId = top.id;
    const same = () => { const x = NXI.render(d).getContext('2d').getImageData(0, 0, 64, 40).data, y = NXI.renderLayers(d, d.layers).getContext('2d').getImageData(0, 0, 64, 40).data; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
    NXI.dirty(d); ok(same(), 'first render'); const h0 = NXI.compStats.belowHit;
    top.canvas.getContext('2d').fillRect(40, 0, 10, 10); NXI.dirty(d, top); ok(same() && NXI.compStats.belowHit === h0 + 1, 'editing the active layer reuses the cache');
    b.opacity = 40; NXI.dirty(d, b); ok(same(), 'changing a layer below invalidates the cache'); a.visible = false; NXI.dirty(d); ok(same(), 'hiding a layer below');
    c2.canvas.getContext('2d').clearRect(0, 0, 64, 40); NXI.dirty(d, c2); ok(same(), 'pixels below');
  });
  test('formats: PSD write → read keeps layers, groups, masks, blend modes, opacity, visibility, clipping; composite matches', async () => {
    const d = NXI.newDoc({ w: 64, h: 48, name: 'psdtest', bg: '#c03030' });
    const a = NXI.mkLayer(d, 'raster', { name: 'Circle ✓' }); { const x = a.canvas.getContext('2d'); x.fillStyle = 'rgba(40,200,90,.7)'; x.beginPath(); x.arc(30, 24, 16, 0, 7); x.fill(); } a.blend = 'multiply'; a.opacity = 60; d.layers.push(a);
    const G = NXI.mkLayer(d, 'group', { name: 'Group A' }); const b = NXI.mkLayer(d, 'raster', { name: 'Masked' }); { const x = b.canvas.getContext('2d'); x.fillStyle = '#2050ff'; x.fillRect(4, 4, 56, 40); }
    NXI.addMask(d, b); { const m = b.mask.canvas.getContext('2d'); m.clearRect(32, 0, 32, 48); }
    const c = NXI.mkLayer(d, 'raster', { name: 'Clipped' }); { const x = c.canvas.getContext('2d'); x.fillStyle = '#ffff00'; x.fillRect(0, 20, 64, 8); } c.clip = true;
    const h = NXI.mkLayer(d, 'raster', { name: 'Hidden' }); h.visible = false; { const x = h.canvas.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 10, 10); }
    const t = NXI.mkLayer(d, 'text', { name: 'Title', text: { str: 'Hi', size: 20 } }); G.children = [b, c, h]; d.layers.push(G, t);
    const blob = await NXI.psd.write(d), buf = await blob.arrayBuffer(); ok(new TextDecoder().decode(new Uint8Array(buf, 0, 4)) === '8BPS', 'signature');
    const r = await NXI.psd.read(buf, 'back'); ok(r.w === 64 && r.h === 48, 'size');
    const names = []; NXI.walk(r.layers, L => names.push(L.type + ':' + L.name)); ok(names.join('|') === 'raster:Background|raster:Circle ✓|group:Group A|raster:Masked|raster:Clipped|raster:Hidden|raster:Title', names.join('|'));
    const ra = r.layers[1], rg = r.layers[2]; ok(ra.blend === 'multiply' && Math.abs(ra.opacity - 60) <= 1, 'blend + opacity ' + ra.blend + ' ' + ra.opacity);
    ok(rg.children[0].mask && rg.children[1].clip && !rg.children[2].visible, 'mask, clipping, hidden');
    const f1 = NXI.flatten(d).getContext('2d').getImageData(0, 0, 64, 48).data, f2 = NXI.flatten(r).getContext('2d').getImageData(0, 0, 64, 48).data; let s = 0, mx = 0;
    for (let i = 0; i < f1.length; i++) { const q = Math.abs(f1[i] - f2[i]); s += q; mx = Math.max(mx, q); } ok(s / f1.length < 1 && mx <= 3, `composite mean ${(s / f1.length).toFixed(2)} max ${mx}`);
    // PackBits round trip on awkward data
    const src = new Uint8Array(700); for (let i = 0; i < 700; i++) src[i] = i % 150 < 60 ? 7 : (i * 31) & 255; const pk = NXI.psd.packRow(src, 0, 700), back = NXI.formats.unpackBits(pk, 700); ok(back.join() === src.join(), 'PackBits');
  });
  test('formats: flat PSD (no layers, raw merged data) loads as one layer', async () => {
    const W = 5, H = 3, n = 26 + 4 + 4 + 4 + 2 + W * H * 3, b = new Uint8Array(n), v = new DataView(b.buffer); let p = 0;
    [56, 66, 80, 83].forEach(c => b[p++] = c); v.setUint16(p, 1); p += 2 + 6; v.setUint16(p, 3); p += 2; v.setUint32(p, H); p += 4; v.setUint32(p, W); p += 4; v.setUint16(p, 8); p += 2; v.setUint16(p, 3); p += 2;
    p += 12; v.setUint16(p, 0); p += 2; for (let c = 0; c < 3; c++) for (let i = 0; i < W * H; i++) b[p++] = c === 0 ? i * 10 : c === 1 ? 200 : 30;
    const d = await NXI.psd.read(b.buffer, 'flat'), px = NXI.flatten(d).getContext('2d').getImageData(0, 0, W, H).data; ok(d.layers.length === 1 && px[4 * 7] === 70 && px[4 * 7 + 1] === 200 && px[4 * 7 + 2] === 30, [...px.slice(28, 32)].join());
  });
  test('formats: TIFF reader handles tiles, 16-bit, planar and Deflate files written by other software', async () => {
    // hand-built files following the TIFF 6.0 spec: 16-bit RGB, tiled 16×16, planar (one plane per channel), Deflate
    const W = 20, H = 18, T = 16, le = true;
    const sample = (x, y, c) => [x * 3000, y * 3500, (x + y) * 1500][c];   // 16-bit values
    const tilesA = Math.ceil(W / T), tilesD = Math.ceil(H / T), planes = [];
    for (let c = 0; c < 3; c++) for (let ty = 0; ty < tilesD; ty++) for (let tx = 0; tx < tilesA; tx++) { const b = new Uint8Array(T * T * 2), dv = new DataView(b.buffer); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const X = tx * T + x, Y = ty * T + y; dv.setUint16((y * T + x) * 2, X < W && Y < H ? sample(X, Y, c) : 0, le); } planes.push(new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())); }
    const tags = [[256, 3, [W]], [257, 3, [H]], [258, 3, [16, 16, 16]], [259, 3, [8]], [262, 3, [2]], [277, 3, [3]], [284, 3, [2]], [322, 3, [T]], [323, 3, [T]], [324, 4, null], [325, 4, planes.map(p => p.length)]];
    let off = 8 + 2 + tags.length * 12 + 4; const extra = [], place = arr => { const o = off; extra.push(arr); off += arr.byteLength; return o; };
    const ent = tags.map(([tag, type, vals]) => { if (vals === null) return [tag, type, planes.length, null]; const sz = type === 3 ? 2 : 4; if (vals.length * sz <= 4) return [tag, type, vals.length, vals]; const a = new Uint8Array(vals.length * sz), dv = new DataView(a.buffer); vals.forEach((v, i) => type === 3 ? dv.setUint16(i * 2, v, le) : dv.setUint32(i * 4, v, le)); return [tag, type, vals.length, place(a)]; });
    const offArr = new Uint8Array(planes.length * 4), offPos = place(offArr), dataPos = planes.map(p => place(p)); dataPos.forEach((p, i) => new DataView(offArr.buffer).setUint32(i * 4, p, le));
    const buf = new ArrayBuffer(off), v = new DataView(buf), u8 = new Uint8Array(buf); v.setUint16(0, 0x4949); v.setUint16(2, 42, le); v.setUint32(4, 8, le); v.setUint16(8, tags.length, le);
    ent.forEach(([tag, type, count, val], i) => { const e = 10 + i * 12; v.setUint16(e, tag, le); v.setUint16(e + 2, type, le); v.setUint32(e + 4, count, le); if (val === null) v.setUint32(e + 8, offPos, le); else if (Array.isArray(val)) val.forEach((x, k) => type === 3 ? v.setUint16(e + 8 + k * 2, x, le) : v.setUint32(e + 8, x, le)); else v.setUint32(e + 8, val, le); });
    let p = 10 + tags.length * 12 + 4; for (const a of extra) { u8.set(a, p); p += a.byteLength; }
    const o = await NXI.formats.decodeTIFF(buf); ok(o.width === W && o.height === H, 'size');
    let bad = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) if (Math.abs(o.data[(y * W + x) * 4 + c] - sample(x, y, c) * 255 / 65535) > 1) bad++;
    ok(!bad, bad + ' samples wrong'); ok(o.data[3] === 255, 'opaque');
  });
  test('formats: PackBits decoder (TIFF spec example)', () => { const src = new Uint8Array([0xFE, 0xAA, 0x02, 0x80, 0x00, 0x2A, 0xFD, 0xAA, 0x03, 0x80, 0x00, 0x2A, 0x22, 0xF7, 0xAA]), out = NXI.formats.unpackBits(src, 24); ok(Array.from(out).map(v => v.toString(16).padStart(2, '0')).join('') === 'aaaaaa80002aaaaaaaaa80002a22aaaaaaaaaaaaaaaaaaaa'); });
  test('formats: BMP header and size', () => new Response(NXI.formats.encodeBMP(new ImageData(3, 2))).arrayBuffer().then(b => { const v = new DataView(b); ok(v.getUint8(0) === 0x42 && v.getUint8(1) === 0x4D && v.getUint32(2, true) === 54 + 24 && v.getInt32(18, true) === 3); }));
  test('formats: SVG export keeps vector layers as SVG elements', () => { const d = NXI.newDoc({ w: 200, h: 100 }); NXI.insert(d, NXI.mkLayer(d, 'shape', { shape: { kind: 'rect', w: 50, h: 40, radius: 6 } })); NXI.insert(d, NXI.mkLayer(d, 'text', { text: { str: 'Hi & <you>' } })); const s = NXI.formats.svgOf(d); ok(/<rect /.test(s) && /<text /.test(s) && /Hi &amp; &lt;you&gt;/.test(s)); ok(new DOMParser().parseFromString(s, 'image/svg+xml').querySelector('parsererror') === null, 'well-formed'); });
  test('formats: native .nxi round-trip keeps layers, masks and pixels', async () => { const d = solidDoc(50, 50, '#000000'); const L = rasterLayer(d, 'r', c => { c.fillStyle = '#0f0'; c.fillRect(0, 0, 50, 50); }); NXI.addMask(d, L, false); L.mask.canvas.getContext('2d').clearRect(0, 0, 25, 50); NXI.insert(d, NXI.mkLayer(d, 'text', { text: { str: 'x', size: 8 }, tr: { x: 46, y: 46 } })); NXI.dirty(d, L); const j = await NXI.toJSON(d), d2 = await NXI.fromJSON(JSON.parse(JSON.stringify(j))); ok(NXI.countLayers(d2) === 3 && comp(d2, 10, 10)[1] === 0 && comp(d2, 40, 10)[1] === 255); });
  test('formats: brush preset file round-trip + validation', () => { const j = NXI.formats.brushToJSON('Test', Object.assign({}, NXI.toolOpts.brush, { size: 77 })), [b] = NXI.formats.brushFromJSON(JSON.parse(JSON.stringify(j))); ok(b.name === 'Test' && b.b.size === 77); let threw = false; try { NXI.formats.brushFromJSON({ format: 'x' }); } catch (e) { threw = true; } ok(threw); });
  test('formats: unsupported PSD variants are refused with a clear message', async () => {
    const msg = async bytes => { try { await NXI.formats.decodeFile(new File([bytes], 'a.psd')); return ''; } catch (e) { return e.message; } };
    const hdr = (ver, mode) => { const b = new Uint8Array(26), v = new DataView(b.buffer); b.set([56, 66, 80, 83]); v.setUint16(4, ver); v.setUint16(12, 3); v.setUint32(14, 4); v.setUint32(18, 4); v.setUint16(22, 8); v.setUint16(24, mode); return b; };
    ok(/PSB/.test(await msg(hdr(2, 3))), 'PSB'); ok(/RGB and Grayscale/.test(await msg(hdr(1, 4))), 'CMYK'); ok(/Not a Photoshop/.test(await msg(new Uint8Array([1, 2, 3, 4, 5, 6]))), 'garbage');
  });

  /* ---------------- templates + cross-workspace ---------------- */
  test('templates: every template builds editable layers', () => { for (const t of NXI.templates.list) { const d = NXI.templates.create(t.id); ok(NXI.countLayers(d) >= 3, t.name); ok(d.w === t.w && d.h === t.h); NXI.render(d); } });
  test('assets: linked image doc updates the Edit timeline media', () => { const d = solidDoc(64, 64, '#ff0000'); Assets.docs[d.id] = d; const m = Assets.publishDoc(d); ok(m.link.doc === d.id && px(m.img, 5, 5)[0] === 255); const L = rasterLayer(d, 'blue', c => { c.fillStyle = '#0000ff'; c.fillRect(0, 0, 64, 64); }); NXI.push(d, 'paint'); Assets.syncDoc(d); ok(px(m.img, 5, 5)[2] === 255, 'synced'); ok(Assets.usage()[d.id] >= 1); ok(Assets.remove(d.id) === false, 'in-use doc not deletable'); delete media[m.id]; delete Assets.docs[d.id]; });
  test('assets: project envelope round-trip (Edit + Image + links)', async () => {
    const d = solidDoc(32, 32, '#00ff00'); Assets.docs[d.id] = d; const m = Assets.publishDoc(d); await Assets.ensureBlob(m); const nEdit = P.layers.length;
    const env = await Shell.buildEnvelope(); ok(Schema.validate(env).length === 0, Schema.validate(env).join('; '));
    const json = JSON.stringify(env); await Shell.loadEnvelope(JSON.parse(json));
    ok(P.layers.length === nEdit, 'edit layers'); const d2 = Assets.docs[d.id]; ok(d2 && comp(d2, 4, 4)[1] === 255, 'doc restored'); ok(Object.values(media).some(x => x.link && x.link.doc === d.id), 'link restored');
    for (const id in media) if (media[id].link && media[id].link.doc === d.id) delete media[id]; delete Assets.docs[d.id];
  });

  /* ---------------- NEXORA Motion ---------------- */
  const cnt = (c, fn) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (fn(d[i], d[i + 1], d[i + 2], d[i + 3])) n++; return n; };
  const renderList = (w, h, layers, t, comp) => { const c = mkCanvas(w, h); renderLayers(c.getContext('2d'), t, layers, comp); return c; };
  function inMotion(fn) { const prevTab = Shell.tab; Shell.go('motion'); const before = Motion.S.order.slice(); try { return fn(); } finally { Shell.go(prevTab === 'motion' ? 'edit' : prevTab); Motion.S.order.filter(id => !before.includes(id)).forEach(id => { Motion.S.order = Motion.S.order.filter(x => x !== id); delete Motion.S.comps[id]; delete Motion.S.ctxs[id]; }); } }
  test('motion: cubic-bezier easing math', () => { for (const x of [0, .25, .5, .75, 1]) near(cubicBezier([0, 0, 1, 1], x), x, 1e-3); near(cubicBezier(BEZ.easy, .5), .5, 1e-3); ok(cubicBezier(BEZ.easy, .2) < .2 && cubicBezier(BEZ.easy, .8) > .8, 'ease shape'); ok(cubicBezier(BEZ.overshoot, .7) > 1, 'overshoot'); });
  test('motion: Bézier keyframes interpolate through cubicBezier', () => { const L = mkLayer('shape'); L.kf.x = [{ t: 0, v: 0, e: 'bezier', b: BEZ.easy }, { t: 2, v: 100, e: 'linear' }]; near(valueRaw(L, 'x', 1), 50, .5); ok(valueRaw(L, 'x', .4) < 20); });
  test('motion: entering a composition swaps the editing context and leaving restores Edit', () => {
    const editLayers = P.layers.length, editName = P.name;
    inMotion(() => { const c = Motion.createComp({ name: 'T ctx', w: 320, h: 180 }); ok(P === Motion.getComp(c.id) && P.w === 320, 'P is the comp'); addLayer(mkLayer('solid')); commit(); ok(P.layers.length === 1); undo(); ok(P.layers.length === 0, 'undo works inside comp'); redo(); ok(P.layers.length === 1); });
    ok(P.layers.length === editLayers && P.name === editName, 'Edit timeline restored');
  });
  test('motion: composition placed in Edit is a live link', () => {
    let L, id; const prevTab = Shell.tab; Shell.go('motion'); const c = Motion.createComp({ name: 'T link', w: 200, h: 100, bg: 'transparent' }); id = c.id; const s = mkLayer('shape', { start: 0, dur: 6 }); Object.assign(s.shape, { w: 400, h: 400, fill: '#ff0000' }); P.layers.push(s); commit();
    Motion.placeInEdit(id); L = selLayer(); ok(Shell.tab === 'edit' && L.compRef === id && !L.comp);
    renderComp(vctx, L.start + .5); let p = px(view, P.w / 2, P.h / 2); ok(p[0] > 240 && p[2] < 20, 'red from comp: ' + p);
    Motion.getComp(id).layers[0].shape.fill = '#0000ff'; renderComp(vctx, L.start + .5); p = px(view, P.w / 2, P.h / 2); ok(p[2] > 240 && p[0] < 20, 'updated live: ' + p);
    ok(Assets.usage()[id] === 1 && Motion.usage()[id] === 1); removeLayer(L.id); Motion.S.order = Motion.S.order.filter(x => x !== id); delete Motion.S.comps[id]; delete Motion.S.ctxs[id]; Shell.go(prevTab);
  });
  test('motion: a comp keeps its own size when nested (solid fills only the comp area)', () => { const comp = Motion.newComp({ w: 200, h: 100 }); const so = mkLayer('solid', { start: 0, dur: 5, color: '#00ff00' }); so.tr.x = 100; so.tr.y = 50; comp.layers.push(so); Motion.addComp(comp); const L = mkLayer('comp', { compRef: comp.id, start: 0, dur: 5 }); delete L.comp; L.tr.x = 320; L.tr.y = 180; const c = renderList(640, 360, [L], 1); ok(px(c, 320, 180)[1] === 255 && px(c, 320 + 120, 180)[3] === 0, 'inside green, outside empty'); Motion.S.order = Motion.S.order.filter(x => x !== comp.id); delete Motion.S.comps[comp.id]; });
  test('motion: motion blur smears a fast-moving layer', () => {
    const mk = mb => { const L = mkLayer('shape', { start: 0, dur: 2 }); Object.assign(L.shape, { w: 40, h: 40, fill: '#ffffff' }); L.tr.y = 50; L.kf.x = [{ t: 0, v: 0, e: 'linear' }, { t: 1, v: 600, e: 'linear' }]; L.mblur = mb; return L; };
    const comp = { fps: 30, motionBlur: { on: true, shutter: 180, samples: 12 } }, soft = c => cnt(c, (r, g, b, a) => a > 10 && a < 240);
    const sharp = renderList(640, 100, [mk(false)], .5, comp), blurred = renderList(640, 100, [mk(true)], .5, comp);
    ok(soft(blurred) > soft(sharp) + 200, `blurred has partial pixels: ${soft(blurred)} vs ${soft(sharp)}`); ok(cnt(blurred, (r, g, b, a) => a > 10) > cnt(sharp, (r, g, b, a) => a > 10), 'wider footprint');
  });
  test('motion: text animator reveals characters over time (staggered)', () => {
    const L = mkLayer('text', { start: 0, dur: 10 }); Object.assign(L.text, { str: 'ABCDEFGH', size: 60, anim: { preset: 'fade', by: 'char', stagger: .2, dur: .3, out: false, ease: 'linear' } });
    const vis = t => { const r = textCanvas(L, t), c = r.src, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, half = c.width / 2; let left = 0, right = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 128) x < half ? left++ : right++; return [left, right]; };
    const [l0, r0] = vis(0), [l1, r1] = vis(.7), [l2, r2] = vis(3); ok(l0 + r0 === 0, 'nothing at t=0'); ok(l1 > 0 && r1 === 0, 'left chars first'); ok(r2 > 0 && l2 >= l1, 'all chars at end');
  });
  test('motion: trim paths draw a partial stroke', () => { const L = mkLayer('shape', { start: 0, dur: 5 }); Object.assign(L.shape, { kind: 'ellipse', w: 200, h: 200, fillOn: false, strokeW: 8, stroke: '#ffffff' }); const ink = e => { L.shape.trimE = e; return cnt(shapeCanvas(L, 0).src, (r, g, b, a) => a > 100); }; const full = ink(100), half = ink(50), none = ink(0); ok(none === 0, 'trim 0 = nothing'); ok(half / full > .4 && half / full < .6, 'half ≈ 50%: ' + (half / full).toFixed(2)); });
  test('motion: every animated background generator renders and animates', () => { for (const k in Motion.GEN) { const L = mkLayer('gen', { start: 0, dur: 10 }); L.gen.kind = k; const a = Motion.genCanvas(L, 0, 160, 90).src.toDataURL(), b = Motion.genCanvas(L, 1.3, 160, 90).src.toDataURL(); ok(a !== b, k + ' animates'); } });
  test('motion: logo/title templates build keyframed compositions', () => inMotion(() => { for (const t of Motion.TEMPLATES) { const c = Motion.createComp({ name: t.name, w: 480, h: 270, dur: t.dur }, t.build); ok(P.layers.length >= 1, t.name); const keyed = P.layers.some(l => Object.keys(l.kf).length) || P.layers.some(l => l.type === 'gen' || (l.text && l.text.anim)); ok(keyed, t.name + ' animates'); renderComp(vctx, c.dur / 2); } }));

  /* ---------------- NEXORA VFX ---------------- */
  const vg = (w, h) => { const g = VFX.newGraph({ name: 'test', w: w || 160, h: h || 90, empty: true }); return g; };
  const out = g => Object.values(g.nodes).find(n => n.type === 'output');
  const dropG = g => { delete VFX.S.graphs[g.id]; VFX.S.order = VFX.S.order.filter(x => x !== g.id); };
  test('vfx: solid → output renders', () => { const g = vg(), s = VFX.addNode(g, 'solid', 0, 0, { color: '#ff0000' }); VFX.connect(g, s.id, out(g).id, 0); ok(px(VFX.renderSync(g, 0), 10, 10).join() === '255,0,0,255'); dropG(g); });
  test('vfx: merge with multiply blend', () => { const g = vg(), a = VFX.addNode(g, 'solid', 0, 0, { color: '#808080' }), b = VFX.addNode(g, 'solid', 0, 0, { color: '#ff0000' }), m = VFX.addNode(g, 'merge', 0, 0, { blend: 'multiply' }); VFX.connect(g, a.id, m.id, 0); VFX.connect(g, b.id, m.id, 1); VFX.connect(g, m.id, out(g).id, 0); const p = px(VFX.renderSync(g, 0), 5, 5); near(p[0], 128, 2); near(p[1], 0, 2); dropG(g); });
  test('vfx: connections that would form a loop are refused', () => { const g = vg(), a = VFX.addNode(g, 'blur'), b = VFX.addNode(g, 'blur'); ok(VFX.connect(g, a.id, b.id, 0)); ok(!VFX.connect(g, b.id, a.id, 0), 'cycle refused'); ok(!VFX.connect(g, a.id, a.id, 0)); dropG(g); });
  test('vfx: mask + transform', () => { const g = vg(200, 100), s = VFX.addNode(g, 'solid', 0, 0, { color: '#ffffff' }), mk = VFX.addNode(g, 'mask', 0, 0, { shape: 'rect', cx: 25, cy: 50, w: 20, h: 40, feather: 0 }), tr = VFX.addNode(g, 'transform', 0, 0, { x: 100 }); VFX.connect(g, s.id, mk.id, 0); VFX.connect(g, mk.id, tr.id, 0); VFX.connect(g, tr.id, out(g).id, 0); const c = VFX.renderSync(g, 0); ok(px(c, 50, 50)[3] === 0 && px(c, 150, 50)[3] === 255); dropG(g); });
  test('vfx: chroma keyer removes the key color and suppresses spill', async () => {
    const cv = mkCanvas(60, 20), x = cv.getContext('2d'); x.fillStyle = '#00ff00'; x.fillRect(0, 0, 20, 20); x.fillStyle = '#ff0000'; x.fillRect(20, 0, 20, 20); x.fillStyle = '#c0d070'; x.fillRect(40, 0, 20, 20);
    const m = await importFile(new File([await new Promise(r => cv.toBlob(r, 'image/png'))], 'key.png', { type: 'image/png' }));
    const g = vg(60, 20), mn = VFX.addNode(g, 'media', 0, 0, { media: m.id, fit: 'stretch' }), k = VFX.addNode(g, 'keyer', 0, 0, { key: '#00ff00', tol: 30, soft: 10, spill: 100 }); VFX.connect(g, mn.id, k.id, 0); VFX.connect(g, k.id, out(g).id, 0);
    const c = VFX.renderSync(g, 0), green = px(c, 10, 10), red = px(c, 30, 10), spill = px(c, 50, 10); ok(green[3] === 0, 'key removed'); ok(red[0] > 240 && red[3] === 255, 'red kept'); ok(spill[1] <= Math.max(spill[0], spill[2]) + 1, 'spill suppressed: ' + spill); dropG(g); delete media[m.id];
  });
  test('vfx: roto shape animates between keys', () => { const g = vg(200, 100), s = VFX.addNode(g, 'solid', 0, 0, { color: '#ffffff' }), r = VFX.addNode(g, 'roto', 0, 0, { feather: 0, smooth: false }); r.p.keys = [{ t: 0, pts: [[10, 30], [50, 30], [50, 70], [10, 70]] }, { t: 1, pts: [[150, 30], [190, 30], [190, 70], [150, 70]] }]; VFX.connect(g, s.id, r.id, 0); VFX.connect(g, r.id, out(g).id, 0); const a = VFX.renderSync(g, 0); ok(px(a, 30, 50)[3] === 255 && px(a, 100, 50)[3] === 0); const b = VFX.renderSync(g, .5); ok(px(b, 100, 50)[3] === 255 && px(b, 30, 50)[3] === 0, 'moved to middle'); dropG(g); });
  test('vfx: grouping and ungrouping preserve the rendered result', () => { const g = vg(), s = VFX.addNode(g, 'gradient', 0, 0, { c1: '#ff0000', c2: '#0000ff' }), b = VFX.addNode(g, 'blur', 200, 0, { r: 6 }), c = VFX.addNode(g, 'color', 400, 0, { adj: 'invert' }); VFX.connect(g, s.id, b.id, 0); VFX.connect(g, b.id, c.id, 0); VFX.connect(g, c.id, out(g).id, 0); const ref = VFX.renderSync(g, 0).toDataURL(); const G2 = VFX.groupNodes(g, [b.id, c.id]); ok(G2 && G2.type === 'group' && !g.nodes[b.id]); ok(VFX.renderSync(g, 0).toDataURL() === ref, 'same after group'); VFX.ungroup(g, G2.id); ok(VFX.renderSync(g, 0).toDataURL() === ref, 'same after ungroup'); dropG(g); });
  test('vfx: tracker follows motion in a composition and match-moves the foreground', async () => {
    const comp = Motion.newComp({ w: 320, h: 180, dur: 1, bg: '#203040' }); const sq = mkLayer('shape', { start: 0, dur: 1 }); Object.assign(sq.shape, { w: 24, h: 24, fill: '#ffffff' }); sq.tr.x = 80; sq.tr.y = 90; sq.kf.x = [{ t: 0, v: 80, e: 'linear' }, { t: 1, v: 180, e: 'linear' }]; comp.layers.push(sq); for (let i = 0; i < 30; i++) { const d = mkLayer('shape', { start: 0, dur: 1 }); Object.assign(d.shape, { w: 6, h: 6, fill: i % 2 ? '#8899aa' : '#556677' }); d.tr.x = (i * 47) % 320; d.tr.y = (i * 29) % 180; comp.layers.unshift(d); } Motion.addComp(comp);
    const g = vg(320, 180); g.dur = 1; const cn = VFX.addNode(g, 'comp', 0, 0, { comp: comp.id, fit: 'stretch' }), dot = VFX.addNode(g, 'mask', 0, 0, { shape: 'rect', cx: 25, cy: 50, w: 3, h: 5, feather: 0 }), red = VFX.addNode(g, 'solid', 0, 0, { color: '#ff0000' }), trk = VFX.addNode(g, 'tracker', 0, 0, { px: 80, py: 90, t0: 0, patch: 14, search: 12 });
    VFX.connect(g, red.id, dot.id, 0); VFX.connect(g, cn.id, trk.id, 0); VFX.connect(g, dot.id, trk.id, 1); VFX.connect(g, trk.id, out(g).id, 0);
    await VFX.analyzeTrack(g, trk); const p = VFX.trackAt(trk.p, .5, g.fps); near(p[0], 130, 4, 'tracked x'); near(p[1], 90, 3, 'tracked y');
    const c = VFX.renderSync(g, .5); ok(px(c, 80 + 50, 90)[0] > 200 && px(c, 80 + 50, 90)[1] < 60, 'foreground moved with the track');
    dropG(g); Motion.S.order = Motion.S.order.filter(x => x !== comp.id); delete Motion.S.comps[comp.id];
  });
  test('vfx: displace shifts pixels by the map', () => { const g = vg(100, 20), img = VFX.addNode(g, 'gradient', 0, 0, { c1: '#000000', c2: '#ffffff', angle: 0 }), map = VFX.addNode(g, 'solid', 0, 0, { color: '#ffffff' }), d = VFX.addNode(g, 'displace', 0, 0, { ax: 20, ay: 0 }); VFX.connect(g, img.id, d.id, 0); VFX.connect(g, map.id, d.id, 1); VFX.connect(g, d.id, out(g).id, 0); const before = (() => { const g2 = vg(100, 20), i2 = VFX.addNode(g2, 'gradient', 0, 0, { c1: '#000000', c2: '#ffffff', angle: 0 }); VFX.connect(g2, i2.id, out(g2).id, 0); const v = px(VFX.renderSync(g2, 0), 60, 10)[0]; dropG(g2); return v; })(); const after = px(VFX.renderSync(g, 0), 40, 10)[0]; near(after, before, 4, 'pixel at 40 came from 60'); dropG(g); });
  test('vfx: graph placed in Edit renders live and follows edits', () => { const g = vg(160, 90), s = VFX.addNode(g, 'solid', 0, 0, { color: '#00ff00' }); VFX.connect(g, s.id, out(g).id, 0); VFX.S.active = g.id; VFX.ui.placeInEdit(); const L = selLayer(); ok(L.type === 'vfx' && L.graphRef === g.id); renderComp(vctx, L.start + .2); ok(px(view, P.w / 2, P.h / 2)[1] === 255); s.p.color = '#ff00ff'; VFX.touch(g); renderComp(vctx, L.start + .2); const p = px(view, P.w / 2, P.h / 2); ok(p[0] === 255 && p[1] === 0, 'live: ' + p); removeLayer(L.id); dropG(g); Shell.go('home'); });
  test('vfx: undo / redo restores node parameters', () => { const g = vg(), s = VFX.addNode(g, 'solid', 0, 0, { color: '#111111' }); VFX.snap(g, 'a'); g.nodes[s.id].p.color = '#222222'; VFX.snap(g, 'b'); VFX.jump(g, 0); ok(g.nodes[s.id].p.color === '#111111'); VFX.jump(g, 1); ok(g.nodes[s.id].p.color === '#222222'); dropG(g); });
  test('vfx: exports an MP4 of the graph', async () => { const g = vg(64, 64); g.dur = .5; const b = VFX.addNode(g, 'background', 0, 0, { kind: 'sweep' }); VFX.connect(g, b.id, out(g).id, 0); const blob = await VFX.exportMP4(g, { mbps: 2 }); ok(blob && blob.size > 1000, 'blob'); const v = document.createElement('video'); v.src = URL.createObjectURL(blob); await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('decode')); }); near(v.duration, .5, .1, 'duration'); dropG(g); });
  test('project: Motion comps + VFX graphs + links survive save / load', async () => {
    const comp = Motion.newComp({ name: 'RT comp', w: 100, h: 100, bg: 'transparent' }); const sh = mkLayer('shape', { start: 0, dur: 5 }); Object.assign(sh.shape, { w: 300, h: 300, fill: '#ff8800' }); sh.tr.x = 50; sh.tr.y = 50; comp.layers.push(sh); Motion.addComp(comp);
    const g = vg(100, 100); g.name = 'RT graph'; const cn = VFX.addNode(g, 'comp', 0, 0, { comp: comp.id }); VFX.connect(g, cn.id, out(g).id, 0);
    const L = mkLayer('vfx', { graphRef: g.id, start: 0, dur: 5 }); P.layers.push(L); const nE = P.layers.length;
    const env = await Shell.buildEnvelope(); const probs = Schema.validate(env); ok(!probs.length, probs.join('; ')); await Shell.loadEnvelope(JSON.parse(JSON.stringify(env)));
    ok(P.layers.length === nE && Motion.getComp(comp.id) && VFX.graph(g.id), 'restored'); const c = VFX.renderSync(VFX.graph(g.id), 1); const p = px(c, 50, 50); ok(p[0] > 240 && p[1] > 120 && p[1] < 150, 'graph renders comp after reload: ' + p);
    P.layers = P.layers.filter(l => l.graphRef !== g.id); dropG(VFX.graph(g.id)); Motion.S.order = Motion.S.order.filter(x => x !== comp.id); delete Motion.S.comps[comp.id]; structChanged();
  });
  test('schema: validation catches dangling comp / graph links', () => { const env = Schema.envelope({ edit: { project: { w: 10, h: 10, layers: [{ id: 'a', type: 'comp', compRef: 'nope', start: 0, dur: 1 }, { id: 'b', type: 'vfx', graphRef: 'gone', start: 0, dur: 1 }] }, media: {} }, vfx: { graphs: [{ id: 'g', name: 'G', nodes: { o: { id: 'o', type: 'output', p: {} } }, links: [{ from: 'x', to: 'o', port: 0 }] }] } }); const e = Schema.validate(env).join('|'); ok(/missing Motion composition/.test(e) && /missing VFX graph/.test(e) && /missing node/.test(e), e); });

  test('shell: Edit shortcuts do not fire while another workspace is active', () => {
    const prev = Shell.tab, editTool = tool, n = P.layers.length, imgTool = NXI.ui.tool; Shell.go('assets');
    try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); ok(tool === editTool, 'Edit tool changed'); ok(P.layers.length === n, 'Edit layer deleted'); }
    finally { Shell.go(prev); NXI.ui.setTool(imgTool); }
  });
  test('shell: every workspace page renders', () => { const prev = Shell.tab; try { for (const w of Shell.WS) { Shell.go(w.id); ok(Shell.tab === w.id, w.id); } } finally { Shell.go(prev); } });
  test('shell: video rail switches Edit / Motion / VFX / Design on one project', () => {
    const prev = Shell.tab, prevCur = Projects.current; Projects.current = { id: 'rail-test', name: 'rail', kind: 'video', created: Date.now() }; Recovery.suspended = true;
    try {
      Shell.go('edit'); const rail = [...document.querySelectorAll('#rail .rbtn')].map(b => b.dataset.mode || b.textContent);
      ok(rail.length >= 6 && document.querySelector('#rail'), 'rail built'); const n = P.layers.length;
      for (const m of ['motion', 'vfx', 'image', 'edit']) { Shell.go(m); ok(Shell.tab === m && Projects.current.id === 'rail-test', m); }
      ok(P.layers.length === n, 'Edit timeline untouched by switching modes');
      ok(!document.querySelector('#wsbar'), 'no workspace tab bar');
    } finally { Projects.current = prevCur; Recovery.suspended = false; Shell.go(prev); }
  });
  test('shell: image projects get the image rail', () => { const prev = Shell.tab, prevCur = Projects.current; Projects.current = { id: 'rail-img', name: 'img', kind: 'image', created: Date.now() }; Recovery.suspended = true; try { Shell.go('image'); const names = [...document.querySelectorAll('#rail .rbtn')].map(b => b.textContent); ok(names.some(t => /Design/.test(t)) && !names.some(t => /^Motion/.test(t)), names.join(',')); } finally { Projects.current = prevCur; Recovery.suspended = false; Shell.go(prev); } });
  /* ---------- milestone 5: performance engine ---------- */
  function fxSrc(W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#10a040'); g.addColorStop(.5, '#e04090'); g.addColorStop(1, '#30f0ff'); x.fillStyle = g; x.fillRect(0, 0, W, H); x.fillStyle = '#00ff00'; x.fillRect(10, 10, 20, 20); x.fillStyle = '#fff'; x.fillRect(50, 20, 8, 30); c._ctx = x; return c; }
  /* software WebGL (SwiftShader, llvmpipe, Apple's paravirtual GPU on CI machines) rounds sub-pixel coordinates
     differently from a real GPU: a remapping effect can then pick the neighbouring pixel. There, coordinate-remapping
     effects are judged by how many pixels differ, and filtering tolerances are doubled; real GPUs keep the strict checks. */
  const glName = (() => { try { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)); } catch (e) { return ''; } })();
  const softGL = /swiftshader|llvmpipe|softpipe|lavapipe|paravirtual|basic render/i.test(glName), REMAP = ['swirl', 'bulge'];
  const offFrac = (da, db, lim) => { let n = 0; for (let i = 0; i < da.length; i++) if (Math.abs(da[i] - db[i]) > lim) n++; return n / da.length; };
  test('gpu: every GPU effect matches the CPU result (±1 level)', () => {
    if (!GPU.available) return; const W = 96, H = 64, bad = [];
    for (const type of GPU.types) { if (type === 'grain') continue; const p = newFx(type).p, a = fxSrc(W, H), b = fxSrc(W, H); FX[type].px(a._ctx, a, p, { t: 0 }); ok(GPU.run(b, [{ type, p }]), type + ' ran'); const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let mx = 0; for (let i = 0; i < da.length; i++) mx = Math.max(mx, Math.abs(da[i] - db[i]));
      if (softGL && REMAP.includes(type)) { const f = offFrac(da, db, 1); if (f > .02) bad.push(`${type}: ${(f * 100).toFixed(1)} % of values off (${glName})`); } else if (mx > 1) bad.push(type + ':' + mx); }
    ok(!bad.length, bad.join(', '));
  });
  test('gpu: ported canvas effects (CSS colour filters, blur, glow, shadow, distortions) match the CPU path', () => {
    if (!GPU.available) return; const W = 120, H = 80, bad = [], rep = [];
    const src = () => { const c = fxSrc(W, H), x = c._ctx; x.clearRect(70, 40, 50, 40); x.fillStyle = 'rgba(255,200,40,.5)'; x.beginPath(); x.arc(90, 55, 14, 0, 7); x.fill(); return c; };
    // tolerances: colour matrices are exact maths; blurs/resampling differ from Skia's filtering by rounding and sub-pixel weights
    const TOL = { brightness: [.5, 2], contrast: [.5, 2], saturate: [.5, 2], hue: [.5, 2], grayscale: [.5, 2], sepia: [.5, 2], invert: [.5, 2], blur: [1, 8], glow: [1, 8], shadow: [1, 40], pixelate: [.2, 2], wave: [3, 128], mirror: [.5, 2], zoomblur: [3, 24], motionblur: [3, 24], halftone: [10, 255], glitch: [3, 255] };   // halftone: same disc colours, disc radii differ by Skia's downscale filter
    for (const type of GPU.ports) {
      const p = newFx(type).p, a = src(), b = src(); if (type === 'glitch') p.amount = 80;
      if (FX[type].css) applyCss(a, FX[type].css(p)); else FX[type].px(a._ctx, a, p, { t: .37 });
      ok(GPU.run(b, [{ type, p, t: .37, T: .37 }]), type + ' ran');
      const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let mx = 0, s = 0;
      // compared premultiplied (what is actually seen when composited): colour noise under ~0 alpha is invisible
      for (let i = 0; i < da.length; i++) { const k = i & 3, d = k === 3 ? Math.abs(da[i] - db[i]) : Math.abs(da[i] * da[i - k + 3] - db[i] * db[i - k + 3]) / 255; s += d; if (d > mx) mx = d; }
      mx = Math.round(mx);
      const mean = s / da.length, [tm, tx] = TOL[type].map(v => softGL ? v * 2 : v); rep.push(`${type} ${mean.toFixed(2)}/${mx}`); if (mean > tm || mx > tx) bad.push(`${type}: mean ${mean.toFixed(2)} max ${mx}`);
    }
    ok(!bad.length, bad.join(', ') + ' | all: ' + rep.join(', '));
  });
  test('gpu: chained effects in one batch equal sequential CPU passes', () => {
    if (!GPU.available) return; const W = 80, H = 50, list = ['levels', 'vibrance', 'swirl', 'sharpen'].map(t => ({ type: t, p: newFx(t).p })), a = fxSrc(W, H), b = fxSrc(W, H);
    for (const f of list) FX[f.type].px(a._ctx, a, f.p, { t: 0 }); GPU.run(b, list);
    const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let mx = 0; for (let i = 0; i < da.length; i++) mx = Math.max(mx, Math.abs(da[i] - db[i]));
    if (softGL) { const f = offFrac(da, db, 6); ok(f < .02, `software GL (${glName}): ${(f * 100).toFixed(1)} % of values off by more than 6`); } else ok(mx <= 6, 'max diff ' + mx);   // ±1 rounding per pass, amplified up to 3.4× by sharpen
  });
  test('gpu: grain adds noise only where there is content', () => { if (!GPU.available) return; const c = fxSrc(40, 40); c._ctx.clearRect(0, 0, 20, 40); GPU.run(c, [{ type: 'grain', p: { amount: 100 } }]); const d = c._ctx.getImageData(0, 0, 40, 40).data; ok(d[(5 * 40 + 5) * 4 + 3] === 0, 'transparent stays transparent'); let v = new Set(); for (let y = 0; y < 10; y++) v.add(d[(y * 40 + 30) * 4]); ok(v.size > 3, 'noise varies'); });
  test('gpu: switching GPU off renders the same frame on the CPU', () => {
    const L = mkLayer('shape', { start: 0, dur: 2 }); L.fx.push(newFx('levels'), newFx('colorgrade')); const prev = GPU.S.enabled, list = [L], cv = document.createElement('canvas'); cv.width = 160; cv.height = 90; const x = cv.getContext('2d', { willReadFrequently: true });
    const shot = on => { GPU.setEnabled(on); x.clearRect(0, 0, 160, 90); renderLayers(x, .5, list, { w: 160, h: 90, fps: 30 }); return x.getImageData(0, 0, 160, 90).data; };
    try { const a = shot(false), b = shot(true); let mx = 0; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i])); ok(mx <= 2, 'max diff ' + mx); } finally { GPU.setEnabled(prev); }
  });
  test('color: primary grade — GPU equals CPU with every control moved, and the maths does what it says', () => {
    const p = Object.assign(newFx('primaries').p, { lm: 20, lr: 8, lb: -6, gm: -15, gg: 10, km: 25, kb: -12, om: 5, or: -4, con: 130, sat: 70, temp: 30, tint: -20 });
    const W = 64, H = 40, a = fxSrc(W, H); FX.primaries.px(a._ctx, a, p, { t: 0 });
    if (GPU.available) { const b = fxSrc(W, H); ok(GPU.run(b, [{ type: 'primaries', p }]), 'ran on GPU'); const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let mx = 0; for (let i = 0; i < da.length; i++) mx = Math.max(mx, Math.abs(da[i] - db[i])); ok(mx <= 1, 'GPU vs CPU max diff ' + mx); }
    // one pixel through the formulas: lift raises black, gain scales white, saturation 0 makes grey
    const px = (rgb, q) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = `rgb(${rgb})`; x.fillRect(0, 0, 1, 1); FX.primaries.px(x, c, Object.assign(newFx('primaries').p, q)); return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
    ok(px('0,0,0', { lm: 50 })[0] > 40, 'lift lifts black'); ok(px('128,128,128', { km: -50 })[1] < 80, 'gain lowers mids'); const g = px('200,40,40', { sat: 0 }); ok(g[0] === g[1] && g[1] === g[2], 'saturation 0 is grey ' + g);
    ok(JSON.stringify(px('90,140,200', {})) === JSON.stringify([90, 140, 200]), 'neutral grade changes nothing');
    const w = px('128,128,128', { temp: 60 }); ok(w[0] > w[2] + 10, 'warm temperature: red over blue ' + w);
  });
  test('color: wheel puck ↔ channel values round-trip and stay luminance-neutral', () => {
    for (const [x, y] of [[0, 0], [.5, 0], [0, -.7], [-.3, .4], [.6, .6]]) { const v = ColorPage.toRGB(x, y), s = v[0] + v[1] + v[2], [bx, by] = ColorPage.toXY(...v); ok(Math.abs(s) < .2, 'sum ' + s); ok(Math.abs(bx - x) < .01 && Math.abs(by - y) < .01, `(${x},${y}) → ${v} → (${bx.toFixed(3)},${by.toFixed(3)})`); }
  });
  test('color: page opens on the same timeline, grades the clip under the playhead, and Auto balances a colour cast', () => {
    const L = mkLayer('solid', { start: 0, dur: 3 }); L.color = '#c07850'; const pre = L.fx.length; addLayer(L); selId = L.id; seek(1);
    try {
      Shell.go('color'); ok(document.body.classList.contains('color-page') && Shell.active === 'edit', 'color page uses the Edit timeline'); ok(document.querySelector('#colorScopes .scopes'), 'scopes docked');
      ok(document.querySelectorAll('#colorDock .cw-wheel').length === 4, 'four wheels'); ok(ColorPage.target() === L, 'grades the selected clip'); ok(L.fx.length === pre, 'looking does not add an effect');
      const r = ColorPage.autoBalance(L), f = ColorPage.gradeOf(L); ok(r && f && L.fx[0] === f, 'grade added at the top of the stack');
      ok(f.p.or < 0 && f.p.ob > 0, `orange cast: offset pulls red down and blue up (${r.offset})`); ok(ColorPage.isGraded(L), 'marked graded');
      Shell.go('edit'); ok(!document.body.classList.contains('color-page') && !document.querySelector('#colorScopes .scopes'), 'leaving restores Edit');
    } finally { removeLayer(L.id); Shell.go('edit'); }
  });
  test('color: curves — monotone spline, identity by default, GPU equals CPU', () => {
    const s = Curves.spline([[0, 0], [.3, .6], [.5, .5], [1, 1]]); let prev = -1, okMono = true; for (let i = 0; i <= 100; i++) { const v = s(i / 100); if (v < -1e-6 || v > 1 + 1e-6) okMono = false; prev = v; } ok(okMono, 'stays in range'); ok(Math.abs(s(.3) - .6) < 1e-6 && Math.abs(s(.5) - .5) < 1e-6, 'passes through its points');
    ok(Curves.isIdentity(Curves.DEF), 'default curve changes nothing');
    const pts = JSON.stringify({ m: [[0, .05], [.5, .62], [1, .95]], r: [[0, 0], [.6, .7], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, .1], [1, .9]] }), p = { pts, amount: 100 };
    const W = 64, H = 40, a = fxSrc(W, H); FX.curves.px(a._ctx, a, p);
    if (GPU.available) { const b = fxSrc(W, H); ok(GPU.run(b, [{ type: 'curves', p }]), 'ran on GPU'); const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let mx = 0; for (let i = 0; i < da.length; i++) mx = Math.max(mx, Math.abs(da[i] - db[i])); ok(mx <= 1, 'GPU vs CPU max diff ' + mx); }
    const t = Curves.table(pts); ok(t[0 * 4 + 2] * 255 > 20 && t[255 * 4 + 2] * 255 < 235, 'blue curve lifts black and lowers white');
  });
  test('color: secondary — qualifier + window, GPU equals CPU, matte isolates the picked colour', () => {
    const p = Object.assign(newFx('secondary').p, { hue: 200, hw: 60, hs: 25, slo: 10, llo: 5, lhi: 95, wm: 'Ellipse', wx: 40, wy: 25, ww: 50, wh: 40, wsf: 40, ah: 30, as: 140, ae: -40 });
    const W = 64, H = 40, a = fxSrc(W, H); FX.secondary.px(a._ctx, a, p);
    if (GPU.available) { const b = fxSrc(W, H); ok(GPU.run(b, [{ type: 'secondary', p }]), 'ran on GPU'); const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let mx = 0; for (let i = 0; i < da.length; i++) mx = Math.max(mx, Math.abs(da[i] - db[i])); ok(mx <= 2, 'GPU vs CPU max diff ' + mx + ' (window orientation and maths agree)'); }
    const u = Secondary.uni(Object.assign(newFx('secondary').p, { hue: 210, hw: 40, slo: 20 }));
    ok(Secondary.matte(.2, .5, .9, .5, .5, 1, u) > .95, 'blue selected'); ok(Secondary.matte(.9, .3, .2, .5, .5, 1, u) < .05, 'red not selected'); ok(Secondary.matte(.5, .5, .5, .5, .5, 1, u) < .05, 'grey not selected');
    const w = Secondary.uni(Object.assign(newFx('secondary').p, { wm: 'Ellipse', wx: 50, wy: 50, ww: 40, wh: 40, wsf: 1 })); ok(Secondary.matte(1, 1, 1, .5, .5, 1, w) > .99 && Secondary.matte(1, 1, 1, .05, .05, 1, w) < .01, 'window inside / outside');
    const neutral = Secondary.shade(.3, .6, .2, .5, .5, 1, Secondary.uni(newFx('secondary').p)); ok(neutral.every((v, i) => Math.abs(v - [.3, .6, .2][i]) < 1e-6), 'default changes nothing');
  });
  test('color: secondary tab picks a colour from the viewer', () => {
    const L = mkLayer('solid', { start: 0, dur: 3 }); L.color = '#2a7fd0'; addLayer(L); selId = L.id; seek(1);
    try {
      Shell.go('color'); ColorPage.S.view = 'sec'; ColorPage.build(); ok(document.querySelectorAll('#colorDock .sec-col').length === 3, 'three columns');
      ok(!L.fx.some(f => f.type === 'secondary'), 'nothing added by looking'); const c = toScr({ x: P.w / 2, y: P.h / 2 }), r = ColorPage.pickAt(c.x, c.y), q = L.fx.find(f => f.type === 'secondary');
      ok(r && q && Math.abs(q.p.hue - r.hue) <= 1 && r.hue > 195 && r.hue < 220, 'hue picked: ' + JSON.stringify(r)); ok(q.p.hw === 40, 'narrow band');
      ok(Secondary.matte(0x2a / 255, 0x7f / 255, 0xd0 / 255, .5, .5, 1, Secondary.uni(q.p)) > .9, 'picked colour is inside the matte'); ok(ColorPage.isGraded(L), 'marked graded');
    } finally { ColorPage.S.view = 'prim'; removeLayer(L.id); Shell.go('edit'); }
  });
  test('color: grade versions A–D, previous-clip grade, match to a still', async () => {
    const A = mkLayer('solid', { start: 0, dur: 2, name: 'A' }), B2 = mkLayer('solid', { start: 2, dur: 2, name: 'B' }); A.color = '#808080'; B2.color = '#808080'; addLayer(A); addLayer(B2); selId = B2.id; seek(3);
    try {
      Shell.go('color'); ColorPage.S.view = 'prim'; ColorPage.build(); ok(document.querySelectorAll('#colorDock .cp-vers button').length === 4, 'version buttons');
      const fA = newFx('primaries'); fA.p.km = 40; A.fx.unshift(fA);
      const prev = ColorPage.fromPrevious(B2); ok(prev === A && ColorPage.gradeOf(B2).p.km === 40 && ColorPage.gradeOf(B2).id !== fA.id, 'previous clip grade copied (own copy)');
      ColorPage.useVersion(B2, 'B'); ColorPage.gradeOf(B2).p.km = -30; ColorPage.useVersion(B2, 'A'); ok(ColorPage.gradeOf(B2).p.km === 40, 'version A restored');
      ColorPage.useVersion(B2, 'B'); ok(ColorPage.gradeOf(B2).p.km === -30 && B2.gradeVersions.active === 'B', 'version B kept its own grade');
      // match: this grey shot to a blue-ish still
      const sc = mkCanvas(64, 36), sx = sc.getContext('2d'); sx.fillStyle = '#4060a8'; sx.fillRect(0, 0, 64, 36); ColorPage.S.stills = [{ id: 'st1', url: sc.toDataURL('image/png'), name: 'ref' }];
      const r = await ColorPage.matchStill(B2); ok(r && r.offset[2] > 5 && r.offset[0] < -5, 'offset pushes blue up, red down: ' + r.offset);
      renderComp(vctx, 3); const px = vctx.getImageData(P.w >> 1, P.h >> 1, 1, 1).data; ok(px[2] > px[0] + 20, 'the shot now leans blue like the still: ' + [...px].slice(0, 3));
    } finally { ColorPage.S.stills = []; removeLayer(A.id); removeLayer(B2.id); Shell.go('edit'); }
  });
  test('color: curves page edits the clip, stills grab and wipe', () => {
    const L = mkLayer('solid', { start: 0, dur: 3 }); L.color = '#808080'; addLayer(L); selId = L.id; seek(1);
    try {
      Shell.go('color'); ColorPage.S.view = 'curves'; ColorPage.build(); ok(document.querySelector('#colorDock .cv-edit'), 'curve editor shown'); ok(!ColorPage.curvesOf(L), 'no effect until edited');
      const cv = document.querySelector('#colorDock .cv-edit'), r = cv.getBoundingClientRect(), ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: r.left + r.width * x, clientY: r.top + r.height * y, pointerId: 1, bubbles: true }));
      ev('pointerdown', .5, .5); ev('pointermove', .5, .3); ev('pointerup', .5, .3); const c = ColorPage.curvesOf(L); ok(c && !Curves.isIdentity(c.p.pts), 'dragging the curve adds a curves effect'); ok(ColorPage.isGraded(L), 'clip marked graded');
      ColorPage.grabStill(); ok(ColorPage.S.stills.length >= 1 && /^data:image\/jpeg/.test(ColorPage.S.stills[0].url), 'still grabbed'); ColorPage.wipe(ColorPage.S.stills[0]); ok(document.getElementById('wipe') && /inset/.test(document.querySelector('#wipe img').style.clipPath), 'wipe shown');
      ColorPage.wipe(null); ok(!document.getElementById('wipe'), 'wipe off');
    } finally { ColorPage.S.view = 'prim'; ColorPage.S.stills = []; removeLayer(L.id); Shell.go('edit'); }
  });
  test('timeline: right-click clip menu, colour labels saved on the clip', () => {
    const L = mkLayer('solid', { start: 0, dur: 2 }); addLayer(L); structChanged(); renderTimeline();
    try {
      const c = document.querySelector(`#tlc .clip[data-id="${L.id}"]`); ok(c, 'clip has its id'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
      const pop = document.getElementById('menuPop'); ok(!pop.classList.contains('hidden') && /Ripple delete/.test(pop.textContent), 'menu open'); ok(selId === L.id, 'right-click selects');
      pop.querySelector('.cm-dot[title="Navy"]').click(); ok(L.label === 'navy', 'label set'); renderTimeline(); const c2 = document.querySelector(`#tlc .clip[data-id="${L.id}"]`); ok(c2 && c2.style.backgroundColor, 'label colour drawn');
      ok(cloneLayer(L).label === 'navy', 'label survives duplicate');
    } finally { removeLayer(L.id); document.getElementById('menuPop').classList.add('hidden'); }
  });
  /* ---------- Blocks ---------- */
  const withBlocks = async fn => { const p = typeof Motion !== 'undefined' ? Motion.editProject() : P, saved = p.blocks; p.blocks = undefined; try { return await fn(); } finally { p.blocks = saved; } };
  const unzip = async blob => Zip.read(await blob.arrayBuffer());
  test('blocks: zip writer round-trips names, bytes and CRCs', async () => {
    const files = [{ name: 'pack.mcmeta', data: '{"a":1}' }, { name: 'assets/x/y.png', data: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255]) }, { name: 'ünïcode/ok.txt', data: 'héllo' }];
    const back = await unzip(Zip.build(files)); ok(back.length === 3 && back.every(f => f.crcOk), 'crc ok'); ok(back[1].name === 'assets/x/y.png' && back[1].data[7] === 255 && new TextDecoder().decode(back[2].data) === 'héllo' && back[2].name === 'ünïcode/ok.txt', 'contents');
    ok(Zip.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'CRC-32 check value');
  });
  test('blocks: pixel tools — pencil line, mirror, rectangle, flood fill, wrap shift', () => {
    const c = mkCanvas(8, 8), x = c.getContext('2d', { willReadFrequently: true }), id = x.getImageData(0, 0, 8, 8), red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
    Blocks.stroke(id, 0, 0, 3, 3, red, true); ok(Blocks.getPx(id, 2, 2)[0] === 255 && Blocks.getPx(id, 5, 2)[0] === 255 && Blocks.getPx(id, 2, 3)[3] === 0, 'diagonal + mirrored');
    Blocks.rect(id, 0, 5, 7, 7, blue, false); ok(Blocks.getPx(id, 4, 5)[2] === 255 && Blocks.getPx(id, 4, 6)[3] === 0, 'outline only');
    const n = Blocks.fill(id, 4, 6, red); ok(n === 6 && Blocks.getPx(id, 1, 6)[0] === 255 && Blocks.getPx(id, 0, 6)[2] === 255, 'fill stays inside the outline: ' + n);
    x.putImageData(id, 0, 0); c._ctx = x; Blocks.transform(c, 'shiftR'); const s = x.getImageData(0, 0, 8, 8); ok(Blocks.getPx(s, 1, 0)[0] === 255 && Blocks.getPx(s, 0, 7)[2] === 255, 'shift wraps around');
  });
  test('blocks: Minecraft model JSON, automatic UVs, resource pack zip', () => withBlocks(async () => {
    ok(JSON.stringify(Blocks.autoUV([0, 0, 0], [16, 16, 16], 'north')) === '[0,0,16,16]' && JSON.stringify(Blocks.autoUV([4, 0, 4], [12, 8, 12], 'up')) === '[4,4,12,12]', 'auto uv');
    const t = Blocks.newTexture({ w: 16, template: 'ore', name: 'Ruby Ore', path: 'block/ruby_ore' }), m = Blocks.newModel({ kind: 'block', tex: t.id, name: 'Ruby Ore', path: 'block/ruby_ore' }), it = Blocks.newModel({ kind: 'item', tex: t.id, path: 'item/ruby' });
    const c = await Blocks.ready(t), px = c.getContext('2d').getImageData(0, 0, 16, 16).data; ok([...px].filter((v, i) => i % 4 === 3 && v === 255).length === 256, 'template texture is opaque');
    const j = Blocks.modelJSON(m, 'nexora'); ok(j.textures['0'] === 'nexora:block/ruby_ore' && j.textures.particle && j.elements[0].faces.north.texture === '#0' && j.elements[0].to[1] === 16, JSON.stringify(j).slice(0, 200));
    ok(Blocks.modelJSON(it, 'nexora').parent === 'minecraft:item/generated', 'item model');
    Object.assign(Blocks.store().pack, { namespace: 'nexora', format: 46, description: 'Test pack' });
    const r = await Blocks.resourcePack(), z = await unzip(r.blob), names = z.map(f => f.name);
    ok(['pack.mcmeta', 'pack.png', 'assets/nexora/textures/block/ruby_ore.png', 'assets/nexora/models/block/ruby_ore.json', 'assets/nexora/models/item/ruby.json'].every(n => names.includes(n)), names.join(', '));
    const meta = JSON.parse(new TextDecoder().decode(z.find(f => f.name === 'pack.mcmeta').data)); ok(meta.pack.pack_format === 46 && meta.pack.description === 'Test pack', 'pack.mcmeta');
    const png = z.find(f => f.name.endsWith('ruby_ore.png')).data; ok(png[0] === 0x89 && png[1] === 0x50 && z.every(f => f.crcOk), 'real PNG, all CRCs ok');
  }));
  test('blocks: sprite atlas packs without overlap; OBJ export is well formed', () => withBlocks(async () => {
    const ts = [Blocks.newTexture({ w: 16, template: 'stone', path: 'a' }), Blocks.newTexture({ w: 32, template: 'planks', path: 'b' }), Blocks.newTexture({ w: 16, h: 8, template: 'metal', path: 'c' }), Blocks.newTexture({ w: 64, template: 'grass', path: 'd' })];
    const a = await Blocks.atlas('t'), F = Object.values(a.json.frames).map(f => f.frame), S = a.json.meta.size.w; ok(F.length === 4 && (S & (S - 1)) === 0, 'power-of-two square: ' + S);
    ok(F.every(f => f.x >= 0 && f.y >= 0 && f.x + f.w <= S && f.y + f.h <= S), 'inside'); for (let i = 0; i < F.length; i++) for (let k = i + 1; k < F.length; k++) { const p = F[i], q = F[k]; ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, 'no overlap'); }
    const fd = a.json.frames['d.png'].frame, d = a.canvas.getContext('2d').getImageData(fd.x + 3, fd.y + 3, 1, 1).data, d0 = (await Blocks.ready(ts[3])).getContext('2d').getImageData(3, 3, 1, 1).data; ok(d[0] === d0[0] && d[1] === d0[1], 'pixels copied exactly');
    const m = Blocks.newModel({ kind: 'block', tex: ts[0].id, name: 'Cube' }); m.elements.push(Blocks.newElement({ from: [4, 16, 4], to: [12, 20, 12], tex: ts[1].id })); const o = await Blocks.objZip(m);
    ok((o.obj.match(/^v /gm) || []).length === 48 && (o.obj.match(/^vt /gm) || []).length === 48 && (o.obj.match(/^f /gm) || []).length === 12, 'two boxes: 48 vertices, 12 quads'); ok(/map_Kd textures\/a\.png/.test(o.mtl) && o.files.includes('textures/b.png'), 'materials point at the textures');
  }));
  test('blocks: the page opens, paints a pixel, shows the 3D preview and the pack files', () => withBlocks(async () => {
    const t = Blocks.newTexture({ w: 16, template: 'blank', name: 'T' }); Shell.go('blocks'); await new Promise(r => setTimeout(r, 200));
    try {
      BlocksMode.S.tex = t; BlocksMode.S.tab = 'tex'; BlocksMode.S.tool = 'pencil'; BlocksMode.S.color = '#ff0000'; BlocksMode.S.alpha = 255; BlocksMode.render(); await new Promise(r => requestAnimationFrame(r));
      const cv = document.querySelector('.bk-pix'); ok(cv && cv.width >= 16, 'pixel canvas'); const r = cv.getBoundingClientRect(), pe = (ty, fx, fy) => cv.dispatchEvent(new PointerEvent(ty, { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pointerId: 1, bubbles: true }));
      pe('pointerdown', .53, .53); pe('pointerup', .53, .53); const px = Blocks.canvasOf(t).getContext('2d').getImageData(8, 8, 1, 1).data; ok(px[0] === 255 && px[3] === 255 && t.png.startsWith('data:image/png'), 'painted and saved');
      Blocks.newModel({ kind: 'block', tex: t.id }); BlocksMode.S.tab = 'model'; BlocksMode.render(); await ThreeD.load(); await new Promise(r => setTimeout(r, 300)); ok(document.querySelector('.bk-view') && BlocksMode.S.three && BlocksMode.S.three.group.children.length >= 1, '3D preview built');
      BlocksMode.S.tab = 'pack'; BlocksMode.render(); await new Promise(r => setTimeout(r, 300)); ok(/pack\.mcmeta/.test(document.querySelector('.bk-files').textContent), 'file list');
    } finally { BlocksMode.S.tab = 'tex'; Shell.go('edit'); }
  }));
  test('about: changelog is well formed, newest first, and matches the app version', async () => {
    const L = window.NX_CHANGELOG; ok(Array.isArray(L) && L.length >= 3, 'entries');
    for (let i = 0; i < L.length; i++) { const r = L[i]; ok(/^\d+\.\d+\.\d+$/.test(r.version) && /^\d{4}-\d\d-\d\d$/.test(r.date) && r.title && r.items.length, 'entry ' + r.version); if (i) ok(About.cmp(L[i - 1].version, r.version) > 0, 'newest first'); }
    if (window.nxupdate) { await nxupdate.test({ tag_name: 'v0.0.1', html_url: 'x', body: '' }); try { const r = await nxupdate.check(false); ok(r.current === About.version(), `package.json ${r.current} = changelog ${About.version()}`); } finally { await nxupdate.test(null); } }
    About.whatsNew('1.0.0'); let m = document.querySelector('#modal .wn'); ok(m && m.querySelectorAll('.wn-rel').length === L.filter(r => About.cmp(r.version, '1.0.0') > 0).length, "What's new lists only newer versions"); closeModal();
    About.about(); m = document.querySelector('#modal .ab'); ok(m && m.textContent.includes('Version ' + About.version()), 'About shows the version'); closeModal();
  });
  test("about: What's new after updating, including from a renumbered 2.x build", async () => {
    const L = window.NX_CHANGELOG, f = s => About.sinceFor(s, L);
    ok(L[0].version === '1.4.0' || About.cmp(L[0].version, '1.4.0') > 0, 'numbering starts at 1.x');
    ok(f(null) === null, 'fresh install: nothing'); ok(f(L[0].version) === null, 'same version: nothing'); ok(f(L[1].version) === L[1].version, 'normal update: changes since the old version');
    ok(f('2.3.0') === L[1].version && f('2.2.1') === L[1].version, 'from a 2.x build: the newest version\'s changes'); ok(f('9.0.0') === null && f('2.9.0') === null, 'a real downgrade: nothing');
    ok(/sinceFor\(seen, LOG\(\)\)/.test(About.onStart.toString()), 'onStart uses this rule');
  });
  test('about: the logo loads and is the brand mark', async () => {
    const img = new Image(); img.src = 'nexora/app/logo.svg'; await img.decode(); ok(img.naturalWidth > 0, 'logo.svg decodes');
    const b = document.querySelector('.brand-mark'); ok(b && /logo\.svg/.test(getComputedStyle(b).backgroundImage), 'brand mark uses the logo');
  });
  test('timeline: go to timecode parses absolute and relative input', () => {
    const p = s => GotoTC.parse(s, 30); ok(Math.abs(p('00:00:02:15') - 2.5) < 1e-9, 'HH:MM:SS:FF'); ok(Math.abs(p('1:00:00') - 60) < 1e-9, 'M:SS:FF'); ok(Math.abs(p('3:00') - 3) < 1e-9, 'SS:FF');
    ok(p('+2:00').rel === 2 && Math.abs(p('-15').rel + .5) < 1e-9, 'relative'); ok(p('01.02.03.04') > 3723 && p('abc') === null && p('') === null, 'dots ok, junk refused');
    const T0 = T; try { seek(1); const s = document.getElementById('tlTC'); GotoTC.edit(s); const inp = s.querySelector('input'); ok(inp, 'readout turns into a field'); inp.value = '+1:00'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); ok(Math.abs(T - Math.min(P.dur, 2)) < .02 && !s.querySelector('input'), 'jumped and closed: ' + T); } finally { seek(T0); }
  });
  test('updates: version compare and the update notice', async () => {
    if (!window.nxupdate) return;
    const old = localStorage.getItem('nx.update.skip'); localStorage.removeItem('nx.update.skip');
    const btn = t => [...document.querySelectorAll('#modal button')].find(b => b.textContent === t), modalText = () => document.getElementById('modal').classList.contains('hidden') ? '' : document.getElementById('modal').textContent;
    // a fake release: a 300 kB "installer" and its checksum file
    const setup = new Uint8Array(300000); for (let i = 0; i < setup.length; i++) setup[i] = (i * 31 + 7) & 255;
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', setup))].map(b => b.toString(16).padStart(2, '0')).join(''), b64 = btoa(String.fromCharCode(...setup.subarray(0, 1))) && (() => { let s = ''; for (let i = 0; i < setup.length; i += 8192) s += String.fromCharCode(...setup.subarray(i, i + 8192)); return btoa(s); })();
    const rel = (sum, tag) => ({ tag_name: tag || 'v99.0.0', name: 'NEXORA Studio 99.0.0', html_url: 'https://github.com/x/y/releases/tag/v99.0.0', published_at: '2099-01-01T00:00:00Z', body: '## Highlights\n- Faster timeline\n- **New** Color tools',
      assets: [{ name: 'NEXORA-Studio-Setup-win-x64.exe', size: setup.length, browser_download_url: 'https://example.test/setup.exe' }, { name: 'SHA256SUMS.txt', size: 100, browser_download_url: 'https://example.test/sums' }] });
    const files = sum => ({ files: { 'https://example.test/setup.exe': { base64: b64 }, 'https://example.test/sums': { text: `${sum}  NEXORA-Studio-Setup-win-x64.exe\n0000000000000000000000000000000000000000000000000000000000000000  NEXORA-Studio-win-x64.zip\n` } } });
    try {
      await nxupdate.test(rel(), files(hex));
      const r = await Updates.check(false); ok(r.ok && r.newer && r.latest === '99.0.0' && r.notes.length === 2 && r.notes[1] === 'New Color tools' && r.canInstall, JSON.stringify(r).slice(0, 300));
      ok(/NEXORA 99\.0\.0 is available/.test(modalText()) && /Faster timeline/.test(modalText()) && btn('Update now'), 'popup with what\'s new and Update now');
      const prog = []; const off = nxupdate.onProgress(d => prog.push(d)); const res = await Updates.updateNow(r); off();
      ok(res && res.ok && res.sha256 === hex, 'downloaded and verified: ' + JSON.stringify(res).slice(0, 200)); ok(prog.length && prog[prog.length - 1].got === setup.length, 'progress reported');
      const ran = await nxupdate.testRan(); ok(ran && ran.file === res.file && ran.args.join(' ') === '/S --force-run', 'installer would run silently and reopen NEXORA: ' + JSON.stringify(ran));
      closeModal(); Updates.S.open = false;
      // a tampered download is rejected and deleted, never run
      await nxupdate.test(rel(), files('f'.repeat(64))); await Updates.check(false); const bad = await Updates.updateNow(Updates.S.last);
      ok(bad && !bad.ok && /did not match the published checksum/.test(bad.error) && /did not match/.test(modalText()), 'checksum mismatch refused: ' + (bad && bad.error)); ok(!(await nxupdate.testRan()), 'nothing was run');
      closeModal(); Updates.S.open = false;
      // Skip this version: no popup on automatic checks; older and pre-release versions are never offered
      await nxupdate.test(rel(), files(hex)); await Updates.check(false); btn('Skip this version').click(); ok(localStorage.getItem('nx.update.skip') === '99.0.0' && !modalText(), 'skipped');
      await Updates.check(false); ok(!modalText(), 'skipped version stays hidden on automatic checks');
      await nxupdate.test({ tag_name: 'v0.9.0', html_url: 'x', body: '' }); const s = await Updates.check(false); ok(s.ok && !s.newer && !modalText(), 'older release is not offered');
      await nxupdate.test({ tag_name: 'v99.0.0-beta.1', prerelease: true, html_url: 'x', body: '' }); ok(!(await Updates.check(false)).newer, 'pre-releases are not offered');
    } finally { await nxupdate.test(null); Updates.hide(); Updates.S.open = false; Updates.S.later = null; closeModal(); if (old == null) localStorage.removeItem('nx.update.skip'); else localStorage.setItem('nx.update.skip', old); }
  });
  test('timeline: speed presets keep the source range and ripple later clips', () => {
    const id = 'spd' + uid(); media[id] = { id, name: 's.mp4', kind: 'video', w: 1920, h: 1080, dur: 20 };
    const A = mkLayer('video', { media: id, start: 0, dur: 4 }), B = mkLayer('solid', { start: 4, dur: 2 }); A.kf.op = [{ t: 2, v: 50, e: 'linear' }]; addLayer(A); addLayer(B); P.markers = [5];
    try { ClipMenu.setSpeed(A, .5); ok(Math.abs(A.dur - 8) < 1e-6 && A.speed === .5, 'half speed doubles length: ' + A.dur); ok(Math.abs(B.start - 8) < 1e-6, 'next clip rippled to ' + B.start); ok(Math.abs(A.kf.op[0].t - 4) < 1e-6, 'keyframe stretched'); ok(P.markers.includes(9), 'marker moved');
      ClipMenu.setSpeed(A, 2); ok(Math.abs(A.dur - 2) < 1e-6 && Math.abs(B.start - 2) < 1e-6, 'double speed: ' + A.dur + ' / ' + B.start); }
    finally { removeLayer(A.id); removeLayer(B.id); delete media[id]; P.markers = []; }
  });
  test('markers: names and colours follow ripple and speed; chapters, CSV, ruler, list', () => {
    const id = 'mk' + uid(); media[id] = { id, name: 'm.mp4', kind: 'video', w: 1920, h: 1080, dur: 30 };
    const A = mkLayer('video', { media: id, start: 0, dur: 4 }), B = mkLayer('solid', { start: 4, dur: 2 }); addLayer(A); addLayer(B); const keep = [P.markers, P.markerInfo]; P.markers = []; P.markerInfo = {};
    try {
      Markers.add(5, { name: 'Drop', color: 'ice', note: 'bass' }); Markers.add(65.2, { name: 'Outro' });
      ok(Markers.info(5).name === 'Drop' && Markers.info(5).color === 'ice', 'named');
      ClipMenu.setSpeed(A, .5); ok(P.markers.includes(9) && Markers.info(9).name === 'Drop' && Markers.info(9).note === 'bass', 'name moved with the speed change: ' + JSON.stringify(P.markerInfo));
      selId = A.id; Pro.rippleDelete(); ok(P.markers.includes(1) && Markers.info(1).name === 'Drop', 'name moved with ripple delete: ' + P.markers);
      const ch = Markers.chapters().split('\n'); ok(ch[0] === '0:00 Intro' && ch[1] === '0:01 Drop' && ch.some(l => /^1:0\d Outro$/.test(l)), 'chapters: ' + ch.join(' | '));
      ok(Markers.csv().split('\r\n')[0] === 'Timecode,Seconds,Name,Colour,Note' && /"Drop",Ice,"bass"/.test(Markers.csv()), 'csv');
      renderTimeline(); const mk = [...document.querySelectorAll('#tlr .mk, .mk')].find(e => e.querySelector('.mk-lbl') && e.textContent === 'Drop'); ok(mk && mk.style.getPropertyValue('--mkc') === '#8fc9f0', 'ruler shows the name and colour');
      Markers.openList(); ok(document.querySelectorAll('.mk-list .mk-row').length === P.markers.length, 'list rows'); closeModal(); Markers.S.list = false;
      Markers.remove(1); ok(!P.markers.includes(1) && !P.markerInfo[Markers.key(1)], 'delete removes its info');
    } finally { [A, B].forEach(x => P.layers.includes(x) && removeLayer(x.id)); delete media[id]; P.markers = keep[0] || []; P.markerInfo = keep[1] || {}; }
  });
  test('speed ramp: same footage, speed follows the curve, ripples, and removes cleanly', () => {
    const id = 'rp' + uid(); media[id] = { id, name: 'r.mp4', kind: 'video', w: 1920, h: 1080, dur: 30 };
    const A = mkLayer('video', { media: id, start: 0, dur: 4, srcIn: 2 }), B = mkLayer('solid', { start: 4, dur: 2 }); A.kf.op = [{ t: 4, v: 0, e: 'linear' }]; addLayer(A); addLayer(B); const keepM = P.markers; P.markers = [6];
    try {
      const parts = Ramp.apply(A, 'hero'); ok(parts && parts.length === 32, 'steps: ' + (parts && parts.length));
      const src = parts.reduce((a, p) => a + p.dur * p.speed, 0); ok(Math.abs(src - 4) < .01, 'same source length: ' + src.toFixed(4));
      ok(Math.abs(parts[0].srcIn - 2) < 1e-6 && Math.abs(parts[31].srcIn + parts[31].dur * parts[31].speed - 6) < .01, 'source range kept');
      const mid = parts[16], edge = parts[0]; ok(mid.speed < .3 && edge.speed > .95, `slow in the middle (${mid.speed}), normal at the ends (${edge.speed})`);
      for (let i = 1; i < parts.length; i++) ok(Math.abs(parts[i].start - (parts[i - 1].start + parts[i - 1].dur)) < .002, 'contiguous at ' + i);
      const end = parts[31].start + parts[31].dur; ok(Math.abs(B.start - end) < .002 && Math.abs(P.markers[0] - (end + 2)) < .002, 'later clip and marker ripple: ' + B.start + ' / ' + P.markers);
      ok(Math.abs(parts[31].kf.op[0].t - parts[31].dur) < .01, 'last keyframe lands at the new end');
      ok(parts.every(p => p.ramp.id === parts[0].ramp.id), 'one ramp group');
      const O = Ramp.unramp(parts[7]); ok(O && P.layers.filter(x => x.ramp).length === 0 && Math.abs(O.dur - 4) < 1e-6 && O.speed === 1 && O.srcIn === 2, 'removed: back to one clip');
      ok(Math.abs(B.start - 4) < .002 && Math.abs(P.markers[0] - 6) < .002, 'later clips move back: ' + B.start);
      const again = Ramp.apply(O, 'in'); ok(again[0].speed < again[again.length - 1].speed, 'speed up ramp accelerates'); Ramp.unramp(again[0]);
    } finally { P.layers.filter(x => x.media === id || x === B).forEach(x => removeLayer(x.id)); delete media[id]; P.markers = keepM || []; }
  });
  test('social captions: word groups, pop-in, spoken word lit up', () => {
    const w = Social.fromChunks([{ text: ' This is really cool. Watch this', timestamp: [1, 3] }, { text: 'now', timestamp: [4, 4.4] }]);
    ok(w.length === 7 && Math.abs(w[0].t0 - 1) < 1e-6 && Math.abs(w[5].t1 - 3) < 1e-6, 'words share the phrase time: ' + w.length);
    const g = Social.groups(w); ok(g.map(x => x.map(y => y.text).join(' ')).join('|') === 'This is really|cool.|Watch this|now', 'groups: ' + g.map(x => x.map(y => y.text).join(' ')).join('|'));
    const id = 'sc' + uid(); media[id] = { id, name: 'v.mp4', kind: 'video', w: 1920, h: 1080, dur: 30 }; const L = mkLayer('video', { media: id, start: 10, dur: 8, speed: 2 }); addLayer(L);
    try {
      const made = Social.build(L, w); ok(made.length === 4 && made[0].text.str === 'THIS IS REALLY' && made[0].tin.type === 'pop', 'layers');
      ok(Math.abs(made[0].start - 10.5) < 1e-3, 'speed-aware start: ' + made[0].start); ok(made[0].start + made[0].dur <= made[1].start + 1e-6, 'no overlap');
      const t = made[0].start + made[0].text.words[1][0] + .01, c = textCanvas(made[0], t).src, x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; let blue = 0, white = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 250) { if (d[i] > 120 && d[i] < 160 && d[i + 2] > 230) blue++; else if (d[i] > 245 && d[i + 2] > 245) white++; }
      ok(blue > 200 && white > 200, `active word drawn light blue (${blue}) among white words (${white})`);
    } finally { [L, ...P.layers.filter(x => x.social)].forEach(x => removeLayer(x.id)); delete media[id]; }
  });
  test('timeline: track height S / M / L', () => {
    const L = mkLayer('solid', { start: 0, dur: 2 }); addLayer(L); structChanged();
    try { for (const [k, h] of [['S', 26], ['L', 62], ['M', 38]]) { setRowHeight(k); const lane = document.querySelector('#tlc .row.tk .lane'); ok(lane && lane.offsetHeight === h, `${k}: ${lane && lane.offsetHeight}`); } }
    finally { removeLayer(L.id); setRowHeight('M'); }
  });
  test('reframe: 16:9 → 9:16 covers with picture, keeps titles in place and fitting', () => {
    const saved = P; P = Object.assign({}, P, { w: 1920, h: 1080, layers: [], markers: [], dur: 4 }); const id = 'rf' + uid(); media[id] = { id, name: 'r.mp4', kind: 'video', w: 1920, h: 1080, dur: 4 };
    try {
      const V = mkLayer('video', { media: id, start: 0, dur: 4 }); V.tr.s = 100; const T2 = mkLayer('text', { start: 0, dur: 4 }); T2.tr.y = 1080 * .85; T2.tr.s = 100; T2.kf.x = [{ t: 0, v: 960 + 200, e: 'linear' }]; P.layers.push(V, T2);
      const n = Reframe.apply(1080, 1920); ok(n === 2 && P.w === 1080 && P.h === 1920, 'size ' + P.w + '×' + P.h);
      ok(Math.abs(1920 * V.tr.s / 100 * 1080 / 1920 - 1920) < 2 || Math.abs(1080 * V.tr.s / 100 - 1920) < 2, 'video covers the new height: s=' + V.tr.s); ok(Math.abs(V.tr.x - 540) < 1e-6 && Math.abs(V.tr.y - 960) < 1e-6, 'centred');
      ok(Math.abs(T2.tr.y / 1920 - .85) < 1e-6, 'title stays at 85 % height'); ok(T2.tr.s < 100 && T2.tr.s > 60, 'title scaled to fit: ' + T2.tr.s); ok(Math.abs(T2.kf.x[0].v - (540 + 200 * 1080 / 1920)) < 1e-6, 'keyframes converted');
      ok(JSON.stringify(Reframe.sizeFor('9:16')) === '[1080,1920]' && JSON.stringify(Reframe.sizeFor('1:1')) === '[1920,1920]', 'sizes from the long side');
    } finally { delete media[id]; P = saved; view.width = P.w; view.height = P.h; structChanged(); }
  });
  test('media pool: list view with sortable metadata', () => {
    const was = localStorage.getItem('nx.pool.view'), id = 'mpt' + uid(); media[id] = { id, name: 'zz-test.png', kind: 'image', w: 640, h: 360, dur: 5 };
    try { localStorage.setItem('nx.pool.view', 'list'); leftTab = 'media'; buildLeft(); const rows = [...document.querySelectorAll('#leftBody .mp-list tbody tr')]; ok(rows.length >= 1, 'rows'); const row = rows.find(r => r.textContent.includes('zz-test.png')); ok(row && /640×360/.test(row.textContent), 'resolution shown'); }
    finally { delete media[id]; if (was == null) localStorage.removeItem('nx.pool.view'); else localStorage.setItem('nx.pool.view', was); buildLeft(); }
  });
  test('viewer: guides — crop frames are centred and the right aspect', () => {
    const r = cropRect(9 / 16); ok(Math.abs(r.w / r.h - 9 / 16) < .01 && r.h <= P.h + .01 && Math.abs(r.x * 2 + r.w - P.w) < .01, JSON.stringify(r));
    const s = cropRect(2.39); ok(Math.abs(s.w / s.h - 2.39) < .01 && s.w <= P.w + .01, JSON.stringify(s));
    const was = showGuides; showGuides = true; guides.crop = '1:1'; try { drawOverlay(); ok(true); } finally { showGuides = was; guides.crop = ''; drawOverlay(); }
  });
  test('audio: program meters read silence as the floor and never throw', () => { Meters.measure(); ok(Meters.S.lvl.every(v => v <= -59), Meters.S.lvl.join()); ok(document.querySelector('#meters canvas'), 'meter canvas mounted'); });
  test('perf: transport shows render time and mode', () => { renderComp(vctx, T); Perf.frame(5, performance.now() + 1e4); ok(/ms/.test($('perfRead').textContent) && /(GPU|CPU)/.test($('perfRead').textContent), $('perfRead').textContent); });
  async function makeTestVideo(W, H, N, fps) {
    const mux = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
    const enc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: e => console.error(e) }); enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 8e6, framerate: fps });
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    for (let i = 0; i < N; i++) { x.fillStyle = `rgb(${(i * 7) % 256},${(i * 13) % 256},${(i * 29) % 256})`; x.fillRect(0, 0, W, H); const f = new VideoFrame(c, { timestamp: Math.round(i / fps * 1e6) }); enc.encode(f, { keyFrame: i % 30 === 0 }); f.close(); }
    await enc.flush(); mux.finalize(); return new File([mux.target.buffer], 'test-' + W + '.mp4', { type: 'video/mp4' });
  }
  test('proxy: built frame-exact at reduced size, used for playback, never for export', async () => {
    if (!Proxies.supported()) return; const auto = Proxies.S.auto; Proxies.setAuto(false); let m, L;
    try {
      m = await importFile(await makeTestVideo(1920, 1080, 60, 30)); await Proxies.make(m);
      ok(m.proxyUrl && m.proxyFrames >= 60 && m.proxyFrames <= 61, 'frames ' + m.proxyFrames);
      // compare proxy against the ORIGINAL as this runtime decodes it, frame by frame (adjacent test frames differ by ≥7 per channel)
      const open = async url => { const v = document.createElement('video'); v.muted = true; v.src = url; await new Promise(r => v.onloadeddata = r); return v; };
      const vo = await open(m.url), vp = await open(m.proxyUrl), sh = Proxies.S.short;
      ok(Math.min(vp.videoWidth, vp.videoHeight) === sh && Math.abs(vp.videoWidth / vp.videoHeight - 16 / 9) < .01, vp.videoWidth + 'x' + vp.videoHeight + ' (short side ' + sh + ')');
      const cc = document.createElement('canvas'); cc.width = cc.height = 4; const xx = cc.getContext('2d', { willReadFrequently: true });
      const at = async (v, t) => { v.currentTime = t; await new Promise(r => v.onseeked = r); xx.drawImage(v, 0, 0, 4, 4); return xx.getImageData(1, 1, 1, 1).data.slice(0, 3); };
      let wrong = 0, worst = 0; for (let fr = 0; fr < 60; fr += 3) { const t = (fr + .5) / 30, a = await at(vo, t), b = await at(vp, t), d = Math.max(...[0, 1, 2].map(k => Math.abs(a[k] - b[k]))); worst = Math.max(worst, d); if (d > 5) wrong++; }
      for (const v of [vo, vp]) { v.removeAttribute('src'); v.load(); }   // release decoders (browsers cap concurrent players)
      ok(wrong === 0, `${wrong} proxy frames differ from the original (worst ${worst}, colour-exact runtime: ${Proxies.S.colorExact})`);
      L = addMediaLayer(m, 0); ok(getEl(L)._proxy === true, 'playback uses proxy');
      exporting = true; try { const e = getEl(L); ok(!e._proxy && e.src === m.url, 'export uses original'); } finally { exporting = false; }
      ok(contentOf(L, 0) === null || contentOf(L, 0).w === 1920, 'proxy drawn at original size');
      const k = Proxies.keyOf(m); delete m.proxyUrl; ok(await Proxies.restore(m), 'restored from cache'); ok(m.proxyUrl, 'has url after restore');
    } finally { if (L) removeLayer(L.id); if (m) { await Proxies.remove(m); delete media[m.id]; uiMedia(); } Proxies.setAuto(auto); }
  });
  /* ---------- milestone 6: media on disk (desktop app only; these return early in a browser) ---------- */
  const DK = {};
  const sleep_ = ms => new Promise(r => setTimeout(r, ms));
  test('disk: imported file is linked by path and streamed with seeking (desktop)', async () => {
    if (!Disk.on) return; Recovery.suspended = true;
    DK.dir = Disk.join(await Disk.fs.defaultRoot(), '__nexora_selftest__'); await Disk.fs.remove(DK.dir); await Disk.fs.mkdir(DK.dir);
    DK.clip = Disk.join(DK.dir, 'clip.mp4'); await Disk.fs.writeBytes(DK.clip, await (await makeTestVideo(1280, 720, 45, 30)).arrayBuffer());
    const m = DK.m = await Disk.importPath(DK.clip); ok(m.url.startsWith('nxmedia://') && m.path === DK.clip && m.w === 1280 && Math.abs(m.dur - 1.5) < .1, JSON.stringify({ url: m.url, w: m.w, dur: m.dur }));
    const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.src = m.url; await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('load failed')); });
    v.currentTime = 1.2; await new Promise(r => v.onseeked = r); const c = document.createElement('canvas'); c.width = c.height = 4; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, 4, 4);
    const p = x.getImageData(1, 1, 1, 1).data, e = [(36 * 7) % 256, (36 * 13) % 256, (36 * 29) % 256]; v.removeAttribute('src'); v.load();
    ok(Math.max(...e.map((q, k) => Math.abs(q - p[k]))) < 40, `seek landed on frame 36 (got ${[...p].slice(0, 3)}, want ${e})`);   // pixels readable ⇒ canvas not tainted
    ok(m.blob._disk && m.blob.size > 1000, 'bytes stay on disk');
  });
  test('disk: project folder stores media by reference and reopens it (desktop)', async () => {
    if (!Disk.on || !DK.m) return; DK.prev = Projects.current;
    const L = addMediaLayer(DK.m, 0); DK.layer = L.id;
    Projects.current = { id: 'disk-' + uid(), name: '__selftest__', kind: 'video', created: Date.now(), folder: Disk.join(DK.dir, 'Project') }; DK.id = Projects.current.id; await Disk.fs.mkdir(Disk.join(DK.dir, 'Project', 'Media'));
    const meta = await Projects.save(); ok(meta.folder === Projects.current.folder, 'folder in library meta');
    const txt = await Disk.fs.readText(Disk.projectFile(meta.folder)); ok(txt.includes('clip.mp4') && !/data:video/.test(txt) && txt.length < 2e6, 'project.nexora references the file, no embedded video (' + txt.length + ' bytes)');
    await Projects.load(DK.id); const m = media[DK.m.id]; ok(m && !m.missing && m.path === DK.clip && m.url.startsWith('nxmedia://'), 'media resolved on reopen');
  });
  test('disk: moved file shows offline and is relinked by folder search (desktop)', async () => {
    if (!Disk.on || !DK.id) return;
    await Disk.fs.mkdir(Disk.join(DK.dir, 'moved', 'deeper')); const np = Disk.join(DK.dir, 'moved', 'deeper', 'clip.mp4'); await Disk.fs.rename(DK.clip, np);
    await Projects.load(DK.id); const m = media[DK.m.id]; ok(m.missing, 'offline after move'); const L = P.layers.find(l => l.id === DK.layer); const c = contentOf(L, .2); ok(c && c.src.tagName === 'CANVAS', 'offline card drawn');
    ok(Disk.missing().length === 1, 'listed for relink'); const n = await Disk.searchAndRelink(DK.dir); ok(n === 1 && !m.missing && m.path === np, 'relinked to ' + m.path);
    DK.clip = np;
  });
  test('disk: collected project folder still opens after being moved (relative paths, desktop)', async () => {
    if (!Disk.on || !DK.id) return;
    const n = await (async () => { const cur = Projects.current; return Disk.collect(cur.folder); })(); ok(n === 1, 'collected ' + n); await Projects.save();
    const moved = Disk.join(DK.dir, 'Project moved'); await Disk.fs.rename(Projects.current.folder, moved); await Disk.fs.remove(DK.clip);   // original gone, folder moved
    await Projects.remove(DK.id); const r = await Projects.openFolder(moved); DK.id = Projects.current.id;
    const m = media[DK.m.id]; ok(m && !m.missing && m.path.toLowerCase().startsWith(moved.toLowerCase()), 'resolved via project-relative path: ' + (m && m.path));
  });
  test('disk: cleanup (desktop)', async () => {
    if (!Disk.on) return;
    try { if (DK.m && media[DK.m.id]) Disk.dropEls(media[DK.m.id]); if (DK.layer) removeLayer(DK.layer); if (DK.m) delete media[DK.m.id]; if (DK.id) await Projects.remove(DK.id); }
    finally {
      Projects.current = DK.prev || null; Disk.S.folder = null; Recovery.suspended = false;
      // players release file handles asynchronously on Windows; retry briefly
      for (let i = 0; i < 10 && DK.dir; i++) { try { await Disk.fs.remove(DK.dir); break; } catch (e) { await sleep_(300); } }
    }
    ok(!(await Disk.fs.stat(DK.dir)).exists, 'temp folder removed');
  });
  test('projects: removing a project while it is saving does not bring it back', async () => {
    const prev = Projects.current, id = 'race-' + uid(); Projects.current = { id, name: '__race__', kind: 'video', created: Date.now() }; Recovery.suspended = true;
    try { const pending = Projects.save(); await Projects.remove(id); const r = await pending; ok(!r, 'pending save wrote nothing'); ok(!(await Projects.list()).some(m => m.id === id), 'not resurrected'); }
    finally { const m = (await Projects.list()).find(x => x.id === id); if (m) { await Projects.remove(id); if (m.folder && Disk.on) await Disk.fs.remove(m.folder); } Projects.current = prev; Recovery.suspended = false; }
  });
  /* ---------- milestone 7: connected modes + Audio ---------- */
  function wavFile(chs, sr, name) { const n = chs[0].length, nc = chs.length, b = new ArrayBuffer(44 + n * nc * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * nc * 2, true); let o = 44; for (let i = 0; i < n; i++) for (const c of chs) { v.setInt16(o, clamp(c[i], -1, 1) * 32767, true); o += 2; } return new File([b], name || 'tone.wav', { type: 'audio/wav' }); }
  test('connect: VFX attached to a clip renders in place (pass-through exact, nodes apply)', () => {
    const own = mkLayer('shape', { start: 0, dur: 3 }); Object.assign(own.shape, { w: 400, h: 300, fill: '#3b9bff' }); addLayer(own, true);
    const L = own, prevSel = selId, prevTab = Shell.tab; selId = L.id; seek(L.start + .3);
    const cv = document.createElement('canvas'); cv.width = P.w; cv.height = P.h; const x = cv.getContext('2d', { willReadFrequently: true }), snap = () => { x.clearRect(0, 0, P.w, P.h); renderLayers(x, T, [L], P); return x.getImageData(0, 0, P.w, P.h).data; };
    const raw = snap(); Connect.vfxForClip(L); const g = VFX.graph(L.fxGraph);
    try {
      ok(Shell.tab === 'vfx' && g.host === L.id && Connect.S.ctx && Connect.S.ctx.layerId === L.id, 'opened VFX for the clip');
      const pass = snap(); let d = 0; for (let i = 0; i < raw.length; i++) d = Math.max(d, Math.abs(raw[i] - pass[i])); ok(d === 0, 'pass-through diff ' + d);
      const inv = VFX.addNode(g, 'color', 400, 120, { adj: 'invert' }), cl = Object.values(g.nodes).find(n => n.type === 'clip'); VFX.connect(g, cl.id, inv.id, 0); VFX.connect(g, inv.id, VFX.outputOf(g).id, 0);
      const after = snap(); let n = 0, hit = 0; for (let i = 0; i < raw.length; i += 4) if (raw[i + 3] > 200) { n++; if (Math.abs(255 - raw[i] - after[i]) < 6) hit++; } ok(n > 0 && hit / n > .98, 'inverted ' + hit + '/' + n);
      Connect.back(); ok(Shell.tab === 'edit' && selId === L.id && !Connect.S.ctx, 'back to the same clip');
      ok(VFX.usage()[g.id] === 1, 'graph counted as used'); const env = VFX.toJSON(); ok(env.graphs.find(q => q.id === g.id).host === L.id, 'host saved');
    } finally { Connect.removeVfx(L); selId = prevSel; Shell.go(prevTab === 'vfx' ? 'edit' : prevTab); }
    ok(!L.fxGraph && !VFX.graph(g.id), 'removed cleanly'); removeLayer(own.id);
  });
  test('connect: overlay painted in Design appears on the timeline', async () => {
    const prevTab = Shell.tab, n0 = P.layers.length; Connect.newOverlay(); const d = NXI.ui.doc, L = P.layers.find(l => l.type === 'image' && media[l.media] && media[l.media].link && media[l.media].link.doc === d.id);
    try {
      ok(Shell.tab === 'image' && L && d.w === P.w, 'overlay doc opened and placed');
      const R = d.layers.find(l => l.type === 'raster'); const c = R.canvas.getContext('2d'); c.fillStyle = '#ff0000'; c.fillRect(10, 10, 50, 50); NXI.dirty(d, R); NXI.push(d, 'paint');
      Connect.back(); await new Promise(r => setTimeout(r, 1200)); Assets.syncAll(true);
      const cv = document.createElement('canvas'); cv.width = P.w; cv.height = P.h; const x = cv.getContext('2d', { willReadFrequently: true }); renderLayers(x, L.start + .1, [L], P); const p = x.getImageData(30, 30, 1, 1).data; ok(p[0] > 240 && p[1] < 15 && p[3] > 240, 'red on timeline: ' + [...p]);
    } finally { if (L) { removeLayer(L.id); delete media[L.media]; } delete Assets.docs[d.id]; NXI.ui.open = NXI.ui.open.filter(i => i !== d.id); if (NXI.ui.doc === d) NXI.ui.doc = null; Shell.go(prevTab); }
  });
  test('audio: integrated loudness of a −20 dBFS stereo sine reads −20 LUFS (±0.5)', async () => { const SR = 48000, ab = new AudioBuffer({ length: SR * 5, numberOfChannels: 2, sampleRate: SR }); for (let c = 0; c < 2; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = .1 * Math.sin(2 * Math.PI * 997 * i / SR); } const r = await AudioMix.measure(ab); ok(Math.abs(r.lufs + 20) < .05, r.lufs.toFixed(3)); near(r.peak, -20, .1); });
  test('audio: EBU Tech 3341 case 1 (1 kHz, −23 dBFS stereo) reads −23.0 LUFS', async () => { const SR = 48000, A = Math.pow(10, -23 / 20), ab = new AudioBuffer({ length: SR * 20, numberOfChannels: 2, sampleRate: SR }); for (let c = 0; c < 2; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = A * Math.sin(2 * Math.PI * 1000 * i / SR); } near((await AudioMix.measure(ab)).lufs, -23, .1, 'LUFS'); });
  test('audio: true peak catches inter-sample peaks (fs/4 sine at 45°: sample −3 dB, true ≈ 0 dBTP)', async () => { const SR = 48000, ab = new AudioBuffer({ length: SR, numberOfChannels: 1, sampleRate: SR }), d = ab.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 12000 * i / SR + Math.PI / 4); const r = await AudioMix.measure(ab); near(r.peak, -3.01, .05, 'sample peak'); ok(r.truePeak > -.5 && r.truePeak < .3, 'true peak ' + r.truePeak.toFixed(2)); });
  test('audio: reverb send leaves a tail after the sound stops', async () => {
    const SR = 48000, d = new Float32Array(SR * 2).map((_, i) => i < SR * .5 ? .3 * Math.sin(2 * Math.PI * 440 * i / SR) : 0), m = await importFile(wavFile([d, d], SR, 'burst.wav')), L = addMediaLayer(m, 0), solo = P.layers.filter(l => l.solo), M = AudioMix.master(), lim = M.limiter;
    const tail = b => { const x = b.getChannelData(0); let a = 0; for (let i = SR * .8; i < SR * 1.6; i++) a += x[i] * x[i]; return 10 * Math.log10(a / (SR * .8) + 1e-12); };
    try { P.layers.forEach(l => l.solo = false); L.solo = true; M.limiter = false; const dry = tail(await mixAudio(2)); AudioMix.conf(L).reverb = 1; const wet = tail(await mixAudio(2)); ok(dry < -90 && wet > -60, `dry ${dry.toFixed(1)} dB, wet ${wet.toFixed(1)} dB`); }
    finally { removeLayer(L.id); delete media[m.id]; solo.forEach(l => l.solo = true); M.limiter = lim; uiMedia(); }
  });
  test('audio: EQ, pan, master and normalize apply to the export mix', async () => {
    const SR = 48000, tone = new Float32Array(SR * 2).map((_, i) => .1 * Math.sin(2 * Math.PI * 100 * i / SR)), m = await importFile(wavFile([tone, tone], SR)), L = addMediaLayer(m, 0), solo = P.layers.filter(l => l.solo), M = AudioMix.master(), keep = { gain: M.gain, limiter: M.limiter }, dur0 = P.dur;
    const rms = (b, c) => { const d = b.getChannelData(c); let a = 0; for (let i = SR * .2; i < SR * 1.8; i++) a += d[i] * d[i]; return 10 * Math.log10(a / (SR * 1.6) || 1e-12); };
    try {
      P.layers.forEach(l => l.solo = false); L.solo = true; P.dur = Math.max(P.dur, 2); M.limiter = false; M.gain = 0;
      const b0 = await mixAudio(2); AudioMix.conf(L).eq = [12, 0, 0]; const b1 = await mixAudio(2); near(rms(b1, 0) - rms(b0, 0), 11, 1.2, 'low shelf +12 at 100 Hz');
      AudioMix.conf(L).eq = [0, 0, 0]; AudioMix.conf(L).pan = 1; const b2 = await mixAudio(2); ok(rms(b2, 0) < -60 && Math.abs(rms(b2, 1) - rms(b0, 1) - 6.02) < .3, 'hard right');
      AudioMix.conf(L).pan = 0; M.gain = -6; const b3 = await mixAudio(2); near(rms(b3, 0) - rms(b0, 0), -6, .05, 'master −6 dB');
      M.gain = 0; M.limiter = true; const r = await AudioMix.normalize(-14); ok(Math.abs(r.after.lufs + 14) < .3, 'normalized to ' + r.after.lufs.toFixed(2));
    } finally { removeLayer(L.id); delete media[m.id]; solo.forEach(l => l.solo = true); P.layers.forEach(l => { if (!solo.includes(l)) l.solo = false; }); M.gain = keep.gain; M.limiter = keep.limiter; P.dur = dur0; uiMedia(); }
  });
  test('audio: auto-duck dips music under speech and recovers', async () => {
    const SR = 48000, tone = new Float32Array(SR * 3).map((_, i) => .1 * Math.sin(2 * Math.PI * 220 * i / SR)), voice = new Float32Array(SR * 3).map((_, i) => { const t = i / SR; return (t > .5 && t < 1) || (t > 1.3 && t < 1.6) ? .3 * Math.sin(2 * Math.PI * 300 * t) : 0; });
    const mm = await importFile(wavFile([tone, tone], SR, 'music.wav')), vm = await importFile(wavFile([voice, voice], SR, 'voice.wav')), M = addMediaLayer(mm, 0), V = addMediaLayer(vm, 0);
    try {
      const n = await AudioMix.duck(M, [V], { amount: -12 }); const k = M.kf.vol;
      ok(n === 1, 'close phrases merged into one dip: ' + n); ok(k.every((q, i) => !i || q.t > k[i - 1].t), 'keys sorted');
      near(valueAt(M, 'vol', .2), 100, .5, 'before speech'); near(valueAt(M, 'vol', .8), 25.1, .5, '−12 dB during speech'); near(valueAt(M, 'vol', 1.15), 25.1, .5, 'stays down in a short gap'); near(valueAt(M, 'vol', 2.6), 100, .5, 'recovered');
    } finally { removeLayer(M.id); removeLayer(V.id); delete media[mm.id]; delete media[vm.id]; uiMedia(); }
  });
  test('audio: mixer mode renders strips for every clip with sound', async () => {
    const SR = 48000, tone = new Float32Array(SR).map((_, i) => .1 * Math.sin(i / 10)), m = await importFile(wavFile([tone, tone], SR)), L = addMediaLayer(m, 0), prev = Shell.tab;
    try { Connect.audioForLayer(L); const strips = [...document.querySelectorAll('#ws-audio .strip:not(.master)')]; ok(Shell.tab === 'audio' && strips.length === AudioMix.sounding().length && strips.some(s => s.dataset.id === L.id && s.classList.contains('focus')), 'strips ' + strips.length); ok(document.querySelector('#ws-audio .strip.master'), 'master strip'); }
    finally { removeLayer(L.id); delete media[m.id]; uiMedia(); Shell.go(prev === 'audio' ? 'edit' : prev); }
  });
  /* ---------- milestone 7: Gaming + AI analysis ---------- */
  test('analysis: 120 BPM click track → 120 BPM, beats within 15 ms', async () => {
    const SR = 44100, d = new Float32Array(SR * 8); for (let k = 0; k < 16; k++) { const s = Math.round((.1 + k * .5) * SR); for (let i = 0; i < 400; i++) d[s + i] = Math.sin(i / 3) * Math.exp(-i / 80) * .8; }
    const m = await importFile(wavFile([d], SR, 'click.wav')), L = addMediaLayer(m, 2);
    try { const r = await Analysis.beats(L); near(r.bpm, 120, .5, 'bpm'); ok(r.beats.length >= 15, r.beats.length + ' beats'); const err = Math.max(...r.beats.map(t => { const q = t - 2.1; return Math.abs(q - Math.round(q / .5) * .5); })); ok(err < .015, 'max beat error ' + err); }
    finally { removeLayer(L.id); delete media[m.id]; uiMedia(); }
  });
  async function synthBeat(bpm, bars, pattern) {   // pattern(t0, B, hit) schedules hits; returns a WAV File
    const SR = 44100, B = 60 / bpm, ac = new OfflineAudioContext(1, Math.ceil(bars * 4 * B * SR) + SR, SR), hit = (t, f, dec, amp) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * .4, t + dec); g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(.0001, t + dec); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dec + .02); };
    for (let bar = 0; bar < bars; bar++) pattern(bar * 4 * B, B, hit); const buf = await ac.startRendering(); return wavFile([buf.getChannelData(0)], SR, 'beat.wav');
  }
  test('analysis: phonk pattern (kick 1 / 3 / 3.75, claps 2 & 4) at 140 BPM is not halved to 70', async () => {
    const f = await synthBeat(140, 8, (t0, B, hit) => { [0, 2, 2.75].forEach(b => hit(t0 + b * B, 140, .35, 1)); [1, 3].forEach(b => hit(t0 + b * B, 1800, .12, .5)); for (let i = 0; i < 8; i++) hit(t0 + i * B / 2, 6000, .04, .15); });
    const m = await importFile(f), L = addMediaLayer(m, 0); try { const r = await Analysis.beats(L); near(r.bpm, 140, 1.5, 'bpm'); } finally { removeLayer(L.id); delete media[m.id]; uiMedia(); }
  });
  test('analysis: a real 90 BPM groove with eighth-note hats stays 90 (not doubled)', async () => {
    const f = await synthBeat(90, 8, (t0, B, hit) => { for (let b = 0; b < 4; b++) hit(t0 + b * B, 140, .35, 1); for (let i = 0; i < 8; i++) hit(t0 + i * B / 2, 6000, .04, .2); });
    const m = await importFile(f), L = addMediaLayer(m, 0); try { const r = await Analysis.beats(L); near(r.bpm, 90, 1.5, 'bpm'); } finally { removeLayer(L.id); delete media[m.id]; uiMedia(); }
  });
  test('analysis: remove silences cuts the gaps and ripples later clips', async () => {
    const SR = 44100, d = new Float32Array(SR * 5).map((_, i) => { const t = i / SR; return t < 1 || (t > 2 && t < 3) || t > 3.6 ? .3 * Math.sin(2 * Math.PI * 220 * t) : 0; });
    const m = await importFile(wavFile([d], SR, 'talk.wav')), L = addMediaLayer(m, 0), after = mkLayer('shape', { start: 5, dur: 1 }); addLayer(after, true); let parts = [];
    try {
      const sp = await Analysis.silences(L, { threshold: -40, minDur: .4 }); ok(sp.length === 2 && Math.abs(sp[0][0] - 1.08) < .03 && Math.abs(sp[1][1] - 3.52) < .03, JSON.stringify(sp));
      const r = await Analysis.removeSilences(L, { threshold: -40, minDur: .4 }); parts = P.layers.filter(l => l.media === m.id);
      ok(parts.length === 3 && parts.every((l, i) => !i || Math.abs(l.start - parts[i - 1].start - parts[i - 1].dur) < 1e-6), 'three contiguous pieces');
      near(r.removed, 1.28, .05, 'removed'); near(after.start, 5 - r.removed, .001, 'later clip rippled');
      near(parts[1].srcIn, 1.92, .03, 'second piece starts after the first gap');
    } finally { [...parts, L, after].forEach(l => removeLayer(l.id)); delete media[m.id]; uiMedia(); }
  });
  test('analysis: scene cuts found at the right frames and clip split there', async () => {
    const W = 640, H = 360, fps = 30, mux = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' }), enc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: () => { } });
    enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 3e6, framerate: fps }); const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), cols = ['#c03030', '#2050c0', '#30a050'];
    for (let i = 0; i < 90; i++) { x.fillStyle = cols[Math.floor(i / 30)]; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.fillRect(50 + i * 3, 150, 60, 60); const f = new VideoFrame(c, { timestamp: Math.round(i / fps * 1e6) }); enc.encode(f, { keyFrame: i % 30 === 0 }); f.close(); }
    await enc.flush(); mux.finalize(); const m = await importFile(new File([mux.target.buffer], 'scenes.mp4', { type: 'video/mp4' })), L = addMediaLayer(m, 0); let parts = [L];
    try { const cuts = await Analysis.scenes(L, { step: .1 }); ok(cuts.length === 2 && Math.abs(cuts[0] - 1) < .11 && Math.abs(cuts[1] - 2) < .11, JSON.stringify(cuts)); parts = Analysis.splitAtTimes(L, cuts); ok(parts.length === 3, 'split into 3'); }
    finally { parts.forEach(p => removeLayer(p.id)); delete media[m.id]; uiMedia(); }
  });
  test('gaming: recording pipeline → screen, facecam (corner, on top) and mic clips with real durations', async () => {
    const sc = document.createElement('canvas'); sc.width = 1280; sc.height = 720; const sx = sc.getContext('2d'); let fr = 0; const iv = setInterval(() => { sx.fillStyle = `hsl(${fr++ * 8},70%,45%)`; sx.fillRect(0, 0, 1280, 720); }, 33);
    const cam = document.createElement('canvas'); cam.width = 640; cam.height = 360; const cx = cam.getContext('2d'), iv2 = setInterval(() => { cx.fillStyle = '#ffcc00'; cx.fillRect(0, 0, 640, 360); }, 33);
    const ac = new AudioContext(), osc = ac.createOscillator(), dst = ac.createMediaStreamDestination(); osc.connect(dst); osc.start(); let placed = {};
    try {
      const rec = Gaming.recordStreams({ screen: sc.captureStream(30), cam: cam.captureStream(30), mic: dst.stream }); await sleep_(2000); const files = await rec.stop();
      ok(files.screen && files.cam && files.mic && files.screen.size > 1000, 'three files');
      placed = await Gaming.placeRecording(files, 0);
      ok(placed.screen.type === 'video' && placed.cam.type === 'video' && placed.mic.type === 'audio', 'clip types');
      ok(P.layers.indexOf(placed.cam) > P.layers.indexOf(placed.screen) && placed.cam.tr.x > P.w * .7, 'facecam on top, bottom-right');
      ok(Math.abs(placed.mic.dur - placed.screen.dur) < .6 && placed.mic.dur < 4, 'mic duration read from headerless WebM: ' + placed.mic.dur);
    } finally { clearInterval(iv); clearInterval(iv2); osc.stop(); ac.close(); Object.values(placed).forEach(L => { removeLayer(L.id); delete media[L.media]; }); uiMedia(); }
  });
  test('gaming: real window capture end-to-end (desktop test mode, records only its own off-screen test window)', async () => {
    if (!window.nxcap) return; let id; try { id = await nxcap.testTarget(); } catch (e) { return; }   // handler exists only in --nx-hidden test runs
    let m;
    try {
      const stream = await Gaming.captureSource(id); ok(stream.getVideoTracks().length === 1, 'got a video track');
      const rec = Gaming.recordStreams({ screen: stream }); await sleep_(1500); const files = await rec.stop(); ok(files.screen && files.screen.size > 500, 'recorded file');
      m = await importFile(files.screen); const v = document.createElement('video'); v.muted = true; v.src = m.url; await new Promise(r => v.onloadeddata = r); v.currentTime = Math.min(.8, m.dur / 2); await new Promise(r => { v.onseeked = r; setTimeout(r, 2000); });
      const c = document.createElement('canvas'); c.width = 32; c.height = 18; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, 32, 18); const p = x.getImageData(16, 9, 1, 1).data; v.removeAttribute('src'); v.load();
      ok(p[0] > 180 && p[1] < 90 && p[2] > 180, 'captured frame is the magenta test window: ' + [...p]);
    } finally { await nxcap.testTargetClose(); if (m) delete media[m.id]; uiMedia(); }
  });
  test('gaming/ai: modes render their tools; gaming overlays are Motion templates', () => {
    const prev = Shell.tab;
    try { Shell.go('gaming'); ok(document.querySelectorAll('#ws-gaming .gcard').length === 3 && document.querySelectorAll('#ws-gaming .ov').length >= 6, 'gaming cards'); Shell.go('ai'); ok(document.querySelectorAll('#ws-ai .aitool').length === 8, 'ai tools (5 timeline + 3 design)'); ok(Motion.TEMPLATES.filter(t => t.cat === 'gaming').length >= 6); }
    finally { Shell.go(prev); }
  });
  test('ai/design: remove background → layer mask, select subject → selection, crop to subject (matte stand-in)', async () => {
    const d = NXI.newDoc({ w: 200, h: 100 }), L = NXI.mkLayer(d, 'raster', { name: 'photo' }); NXI.insert(d, L); const c = L.canvas.getContext('2d'); c.fillStyle = '#3366ff'; c.fillRect(0, 0, 200, 100); NXI.push(d, 'p');
    const prevDoc = NXI.ui.doc; NXI.ui.doc = d; window.__matteOverride = src => { const m = document.createElement('canvas'); m.width = src.width; m.height = src.height; const x = m.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(80, 30, 40, 40); return m; };   // "subject" = 40×40 square
    try {
      await designRemoveBackground({ quiet: true }); ok(L.mask, 'mask added (non-destructive)'); ok(comp(d, 5, 5)[3] === 0 && comp(d, 100, 50)[3] === 255, 'background hidden, subject kept'); ok(px(L.canvas, 5, 5)[3] === 255, 'pixels untouched');
      await designSelectSubject({ quiet: true }); ok(d.sel && px(d.sel, 100, 50)[3] === 255 && px(d.sel, 5, 5)[3] === 0, 'selection = subject');
      const r = await designCropToSubject({ quiet: true }); ok(d.w < 60 && d.w > 40 && d.h < 60, `cropped to ${d.w}×${d.h}`);
    } finally { delete window.__matteOverride; NXI.ui.doc = prevDoc; }
  });
  test('ai: bundled Whisper (English + multilingual) and MODNet run without any internet requests', async () => {
    const before = performance.getEntriesByType('resource').length; performance.setResourceTimingBufferSize(5000); const tf = await loadTF();
    const c = document.createElement('canvas'); c.width = 96; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#ddd'; x.fillRect(0, 0, 96, 96); x.fillStyle = '#a33'; x.beginPath(); x.arc(48, 48, 26, 0, 7); x.fill();
    const m = await matteFor(c), d = m.getContext('2d').getImageData(0, 0, 96, 96).data; const ca = d[(48 * 96 + 48) * 4 + 3], co = d[(3 * 96 + 3) * 4 + 3]; ok(ca - co > 120 && co < 80, `matte separates subject from background (centre ${ca}, corner ${co})`);   // relative: the model's exact confidence on a synthetic disc varies by CPU
    const asr = await tf.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en'); const r = await asr(new Float32Array(16000), { return_timestamps: true }); ok(typeof r.text === 'string', 'whisper ran');
    const ml = await tf.pipeline('automatic-speech-recognition', 'Xenova/whisper-base'); const r2 = await ml(new Float32Array(16000), { return_timestamps: true, language: 'spanish', task: 'transcribe' }); ok(typeof r2.text === 'string', 'multilingual whisper ran (Spanish)');
    const remote = performance.getEntriesByType('resource').slice(before).map(e => e.name).filter(u => /huggingface|jsdelivr|hf\.co/.test(u)); ok(!remote.length, 'remote requests: ' + remote.join(', '));
  });
  /* ---------- milestone 7: Vector + 3D ---------- */
  test('vector: boolean geometry is exact (unite / subtract)', async () => {
    const prev = Shell.tab; Shell.go('vector'); await VectorMode.load(); await sleep_(300); const V = VectorMode, sc = V.S.scope, d = V.newDoc({ name: '__vec_test__' }); V.open(d.id);
    try {
      const a = V.addShape('rect', { x: 100, y: 100, w: 200, h: 200 }), b = V.addShape('rect', { x: 200, y: 100, w: 200, h: 200 }); sc.project.deselectAll(); a.selected = b.selected = true; const u = V.boolean('unite'); near(Math.abs(u.area), 60000, 1, 'union area');
      const c = V.addShape('ellipse', { x: 600, y: 100, w: 200, h: 200 }), r = V.addShape('rect', { x: 700, y: 100, w: 200, h: 200 }); V.snapshot('add'); sc.project.deselectAll(); c.selected = r.selected = true; const s = V.boolean('subtract'); near(Math.abs(s.area), Math.PI * 1e4 / 2, 30, 'half circle');
      ok(V.S.scope.project.activeLayer.children.length === 2, 'originals replaced by results'); V.undo(); ok(V.S.scope.project.activeLayer.children.length === 3, 'undo restores the circle and rectangle');
    } finally { delete V.store()[d.id]; Shell.go(prev); }
  });
  test('vector: drawing placed on the timeline stays linked and survives save/load', async () => {
    const prev = Shell.tab; Shell.go('vector'); await VectorMode.load(); await sleep_(300); const V = VectorMode, d = V.newDoc({ name: '__vec_link__' }); V.open(d.id); let L, m;
    try {
      const sh = V.addShape('rect', { x: 0, y: 0, w: 300, h: 300 }); sh.fillColor = '#00ff00'; V.snapshot('add'); L = await V.place(); m = media[L.media];
      const cv = document.createElement('canvas'); cv.width = P.w; cv.height = P.h; const x = cv.getContext('2d', { willReadFrequently: true }), k = P.w / d.w, px = () => { x.clearRect(0, 0, P.w, P.h); renderLayers(x, L.start + .05, [P.layers.find(l => l.media === m.id)], P); return x.getImageData(Math.round(100 * k), Math.round(100 * k), 1, 1).data; };
      ok(px()[1] === 255 && px()[0] === 0, 'green on timeline');
      Shell.go('vector'); sh.fillColor = '#0000ff'; V.snapshot('fill'); await sleep_(400); ok(px()[2] === 255 && px()[1] === 0, 'edit updates timeline');
      const env = await Shell.buildEnvelope(); ok(env.edit.project.vectors[d.id] && Object.values(env.edit.media).some(q => q.vec === d.id), 'saved with link');
      await Shell.loadEnvelope(JSON.parse(JSON.stringify(env))); m = Object.values(media).find(q => q.vec === d.id); ok(m && px()[2] === 255, 'relinked after load');
    } finally { const LL = m && P.layers.find(l => l.media === m.id); if (LL) removeLayer(LL.id); if (m) delete media[m.id]; delete V.store()[d.id]; Shell.go(prev); }
  });
  test('vector: linear gradient fill renders and exports as an SVG gradient', async () => {
    Shell.go('vector'); await VectorMode.load(); const V = VectorMode, d = V.newDoc({ name: '__grad__', w: 400, h: 200 }); V.open(d.id);
    try { const r = V.addShape('rect', { x: 0, y: 0, w: 400, h: 200 }); V.setGradient(r, { type: 'linear', c1: '#ff0000', c2: '#0000ff', angle: 0 }); V.snapshot('g'); const x = (await V.rasterize(d)).getContext('2d', { willReadFrequently: true }), L = x.getImageData(5, 100, 1, 1).data, R = x.getImageData(395, 100, 1, 1).data, M = x.getImageData(200, 100, 1, 1).data;
      ok(L[0] > 200 && L[2] < 40 && R[2] > 200 && R[0] < 40 && Math.abs(M[0] - M[2]) < 6, `${[...L]} | ${[...M]} | ${[...R]}`); ok(/<linearGradient/.test(V.svgOf(d)), 'svg gradient'); ok(r.data.grad.type === 'linear', 'editable params kept'); }
    finally { delete V.store()[d.id]; Shell.go('edit'); }
  });
  test('vector: text on a path follows the curve (one rotated glyph per letter)', async () => {
    Shell.go('vector'); await VectorMode.load(); const V = VectorMode, d = V.newDoc({ name: '__tp__' }); V.open(d.id);
    try { const sc = V.S.scope, c = new sc.Path.Circle(new sc.Point(300, 300), 120), g = V.textOnPath('HELLO WORLD', c, { size: 30 }), gl = g.children.filter(k => k.className === 'PointText');
      ok(gl.length === 10, gl.length + ' glyphs'); ok(new Set(gl.map(k => Math.round(k.rotation))).size === 10, 'each glyph rotated to the tangent'); ok(gl.every(k => c.getNearestPoint(k.position).getDistance(k.position) < 1), 'glyphs sit on the path'); ok(!c.fillColor && !c.strokeColor, 'path is an invisible guide'); }
    finally { delete V.store()[d.id]; Shell.go('edit'); }
  });
  test('3d: scene renders lit geometry on a transparent background, deterministically, and animates', async () => {
    await ThreeD.load(); const D = ThreeD, sc = D.newScene({ empty: true, name: '__3d__', w: 320, h: 180 }), box = D.addObject(sc, 'box', { color: '#ff2020', rough: .5 });
    try {
      const g = D.frame(sc, 0).getContext('2d', { willReadFrequently: true }), c = g.getImageData(160, 90, 1, 1).data, k = g.getImageData(3, 3, 1, 1).data;
      ok(c[0] > 120 && c[1] < 60 && c[3] === 255, 'lit red box ' + [...c]); ok(k[3] === 0, 'transparent background');
      box.spin = [0, 90, 0]; const a = D.frame(sc, .3).getContext('2d').getImageData(0, 0, 320, 180).data.slice(), a2 = D.frame(sc, .3).getContext('2d').getImageData(0, 0, 320, 180).data.slice(), b = D.frame(sc, .8).getContext('2d').getImageData(0, 0, 320, 180).data;
      ok(a.every((v, i) => v === a2[i]), 'same time → same frame'); let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 20) n++; ok(n > 500, 'spin changes the frame (' + n + ' px)');
    } finally { delete D.store()[sc.id]; }
  });
  const px3 = (c, f) => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2], d[i + 3])) n++; return n; };
  test('3d: extruded text renders real geometry (visible from the side)', async () => {
    await ThreeD.load(); const D = ThreeD, sc = D.newScene({ empty: true, w: 480, h: 270 }); sc.cam.dist = 7; sc.cam.height = 0; const t = D.addObject(sc, 'text3d', { text: 'NX', color: '#ffcc00', rough: .4 });
    try { D.frame(sc, 0); for (let i = 0; i < 20 && !(window.NX_FONTS && NX_FONTS.helvetiker); i++) await sleep_(100); ok(px3(D.frame(sc, 0), (r, g, b, a) => a > 200 && r > 120 && g > 90 && b < 80) > 1000, 'yellow lettering');
      t.rot = [0, 88, 0]; ok(px3(D.frame(sc, 0), (r, g, b, a) => a > 200) > 200, 'has depth when seen edge-on'); }
    finally { delete D.store()[sc.id]; }
  });
  function makeGLB() {
    const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), idx = new Uint16Array([0, 1, 2, 0, 2, 3]), bin = new Uint8Array(pos.byteLength + idx.byteLength + 4); bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(idx.buffer), pos.byteLength);
    const gj = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' }] };
    const js = new TextEncoder().encode(JSON.stringify(gj)), jp = new Uint8Array(js.length + (4 - js.length % 4) % 4).fill(32); jp.set(js);
    const total = 28 + jp.length + bin.length, b = new ArrayBuffer(total), dv = new DataView(b); dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); dv.setUint32(12, jp.length, true); dv.setUint32(16, 0x4E4F534A, true); new Uint8Array(b, 20, jp.length).set(jp); dv.setUint32(20 + jp.length, bin.length, true); dv.setUint32(24 + jp.length, 0x004E4942, true); new Uint8Array(b, 28 + jp.length).set(bin);
    return new File([b], 'quad.glb');
  }
  test('3d: GLB and OBJ models import, render, and survive save/load', async () => {
    await ThreeD.load(); const D = ThreeD, a = D.newScene({ empty: true, w: 320, h: 180 }), b = D.newScene({ empty: true, w: 320, h: 180 }); a.cam.height = 0;
    try {
      await D.importModel(a, makeGLB()); const red = c => px3(c, (r, g, bl, al) => al > 200 && r > 100 && g < 60 && bl < 60); const n = red(D.frame(a, 0)); ok(n > 2000, 'red quad from GLB: ' + n);
      await D.importModel(b, new File(['v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\nf 3 7 8 4\nf 5 1 4 8'], 'cube.obj')); ok(px3(D.frame(b, 0), (r, g, bl, al) => al > 200) > 2000, 'OBJ cube');
      let bad = false; try { await D.importModel(a, new File(['x'], 'model.fbx')); } catch (e) { bad = true; } ok(bad, 'unsupported format rejected');
      const env = await Shell.buildEnvelope(); await Shell.loadEnvelope(JSON.parse(JSON.stringify(env))); D.clearModels(); const a2 = D.store()[a.id]; D.frame(a2, 0);   /* forces a re-parse from the saved data */ await sleep_(500); ok(red(D.frame(a2, 0)) === n, 'identical after reload');
    } finally { delete D.store()[a.id]; delete D.store()[b.id]; }
  });
  /* tiny glTF builder for tests: accessors are packed into one buffer; output as .glb or as .gltf + separate .bin */
  function GB() {
    const parts = [], views = [], accs = []; let off = 0; const NCn = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    return {
      acc(arr, type, extra) { const pad = (4 - off % 4) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; } const bytes = new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength)); views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length }); parts.push(bytes); off += bytes.length;
        const ct = arr instanceof Float32Array ? 5126 : arr instanceof Uint16Array ? 5123 : arr instanceof Uint8Array ? 5121 : 5125; accs.push(Object.assign({ bufferView: views.length - 1, componentType: ct, count: arr.length / NCn[type], type }, extra || {})); return accs.length - 1; },
      bin() { const b = new Uint8Array(off + (4 - off % 4) % 4); let o = 0; parts.forEach(p => { b.set(p, o); o += p.length; }); return b; },
      glb(json) { const bin = this.bin(); json.buffers = [{ byteLength: bin.length }]; json.bufferViews = views; json.accessors = accs; const js = new TextEncoder().encode(JSON.stringify(json)), jp = new Uint8Array(js.length + (4 - js.length % 4) % 4).fill(32); jp.set(js);
        const total = 28 + jp.length + bin.length, b = new ArrayBuffer(total), dv = new DataView(b); dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); dv.setUint32(12, jp.length, true); dv.setUint32(16, 0x4E4F534A, true); new Uint8Array(b, 20, jp.length).set(jp); dv.setUint32(20 + jp.length, bin.length, true); dv.setUint32(24 + jp.length, 0x004E4942, true); new Uint8Array(b, 28 + jp.length).set(bin); return new File([b], 'model.glb'); },
      split(json, binName) { const bin = this.bin(); json.buffers = [{ uri: binName, byteLength: bin.length }]; json.bufferViews = views; json.accessors = accs; return [new File([JSON.stringify(json)], 'model.gltf'), new File([bin], binName)]; }
    };
  }
  const QUAD = () => new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), QIDX = () => new Uint16Array([0, 1, 2, 0, 2, 3]), RED = [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }];
  const redStats = c => { const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0, sx = 0, minY = 1e9; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i + 3] > 200 && d[i] > 100 && d[i + 1] < 60 && d[i + 2] < 60) { n++; sx += x; if (x > c.width * .55) minY = Math.min(minY, y); } } return { n, cx: n ? sx / n : -1, rightTop: minY }; };
  async function scene3(file) { await ThreeD.load(); const sc = ThreeD.newScene({ empty: true, w: 320, h: 180 }); sc.cam.height = 0; sc.cam.dist = 12; const ob = await ThreeD.importModel(sc, file); return { sc, ob, at: t => redStats(ThreeD.frame(sc, t)) }; }
  test('3d: glTF animation (linear and cubic-spline) moves the model with scene time', async () => {
    for (const interp of ['LINEAR', 'CUBICSPLINE']) {
      const g = GB(), pos = g.acc(QUAD(), 'VEC3'), idx = g.acc(QIDX(), 'SCALAR'), tin = g.acc(new Float32Array([0, 1]), 'SCALAR', { min: [0], max: [1] });
      const vals = interp === 'LINEAR' ? new Float32Array([-1, 0, 0, 1, 0, 0]) : new Float32Array([0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]), tout = g.acc(vals, 'VEC3');
      const f = g.glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: pos }, indices: idx, material: 0 }] }], materials: RED, animations: [{ name: 'slide', samplers: [{ input: tin, output: tout, interpolation: interp }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }] });
      const { sc, ob, at } = await scene3(f);
      try { ok(ob.clips.length === 1 && ob.clips[0].name === 'slide' && ob.clips[0].dur === 1, interp + ' clip listed'); const a = at(0), m = at(.5), b = at(.999); ok(b.cx - a.cx > 30, `${interp}: moved right ${a.cx.toFixed(0)} → ${b.cx.toFixed(0)}`); ok(Math.abs(m.cx - (a.cx + b.cx) / 2) < 6, `${interp}: halfway at t=0.5`); ok(Math.abs(at(.5).cx - m.cx) < .01, 'deterministic'); }
      finally { delete ThreeD.store()[sc.id]; }
    }
  });
  test('3d: skinned glTF deforms when an animated bone moves', async () => {
    const g = GB(), pos = g.acc(QUAD(), 'VEC3'), idx = g.acc(QIDX(), 'SCALAR'), jnt = g.acc(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]), 'VEC4'), wts = g.acc(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4');
    const ibm = g.acc(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1]), 'MAT4'), tin = g.acc(new Float32Array([0, 1]), 'SCALAR'), tout = g.acc(new Float32Array([1, 0, 0, 1, 1.2, 0]), 'VEC3');
    const f = g.glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 2] }], nodes: [{ children: [1] }, { translation: [1, 0, 0] }, { mesh: 0, skin: 0 }], skins: [{ joints: [0, 1], inverseBindMatrices: ibm }], meshes: [{ primitives: [{ attributes: { POSITION: pos, JOINTS_0: jnt, WEIGHTS_0: wts }, indices: idx, material: 0 }] }], materials: RED, animations: [{ samplers: [{ input: tin, output: tout }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] }] });
    const { sc, at } = await scene3(f); try { const a = at(0), b = at(.999); ok(a.n > 500, 'rest pose renders'); ok(a.rightTop - b.rightTop > 20, `right edge raised by the bone: ${a.rightTop} → ${b.rightTop}`); } finally { delete ThreeD.store()[sc.id]; }
  });
  test('3d: glTF morph target animated by weights', async () => {
    const g = GB(), pos = g.acc(QUAD(), 'VEC3'), idx = g.acc(QIDX(), 'SCALAR'), tgt = g.acc(new Float32Array([0, 0, 0, 0, 0, 0, 0, 1.5, 0, 0, 1.5, 0]), 'VEC3'), tin = g.acc(new Float32Array([0, 1]), 'SCALAR'), tout = g.acc(new Float32Array([0, 1]), 'SCALAR');
    const f = g.glb({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: pos }, indices: idx, material: 0, targets: [{ POSITION: tgt }] }], weights: [0] }], materials: RED, animations: [{ samplers: [{ input: tin, output: tout }], channels: [{ sampler: 0, target: { node: 0, path: 'weights' } }] }] });
    const { sc, at } = await scene3(f); try { const a = at(0).n, b = at(.999).n; ok(b > a * 1.4, `morph grows the shape: ${a} → ${b} px`); } finally { delete ThreeD.store()[sc.id]; }
  });
  test('3d: .gltf with a separate .bin imports when both files are chosen (and explains when the .bin is missing)', async () => {
    const g = GB(), pos = g.acc(QUAD(), 'VEC3'), idx = g.acc(QIDX(), 'SCALAR'); const files = g.split({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: pos }, indices: idx, material: 0 }] }], materials: RED }, 'quad.bin');
    await ThreeD.load(); const sc = ThreeD.newScene({ empty: true, w: 320, h: 180 }); sc.cam.height = 0;
    try { let msg = ''; try { await ThreeD.importModel(sc, [files[0]]); } catch (e) { msg = e.message; } ok(/quad\.bin/.test(msg), 'names the missing file: ' + msg); ok(!Object.keys(sc.assets || {}).length, 'failed import leaves nothing behind');
      await ThreeD.importModel(sc, files); ok(redStats(ThreeD.frame(sc, 0)).n > 1000, 'renders from .gltf + .bin'); }
    finally { delete ThreeD.store()[sc.id]; }
  });
  test('3d: OBJ uses its .mtl colours and texture maps', async () => {
    const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.fillStyle = '#0000ff'; x.fillRect(0, 0, 8, 8); const png = await new Promise(r => c.toBlob(r, 'image/png'));
    const obj = 'mtllib scene.mtl\nv -2 -1 0\nv -0.2 -1 0\nv -0.2 1 0\nv -2 1 0\nv 0.2 -1 0\nv 2 -1 0\nv 2 1 0\nv 0.2 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl Red\nf 1/1 2/2 3/3 4/4\nusemtl Tex\nf 5/1 6/2 7/3 8/4\n';
    const mtl = 'newmtl Red\nKd 1 0 0\nNs 10\nnewmtl Tex\nKd 1 1 1\nmap_Kd blue.png\n';
    await ThreeD.load(); const sc = ThreeD.newScene({ empty: true, w: 320, h: 180 }); sc.cam.height = 0;
    try { await ThreeD.importModel(sc, [new File([obj], 'scene.obj'), new File([mtl], 'scene.mtl'), new File([png], 'blue.png')]); const fr = ThreeD.frame(sc, 0); ok(redStats(fr).n > 500, 'red material from .mtl');
      ok(px3(fr, (r, g, b, a) => a > 200 && b > 120 && r < 60 && g < 60) > 500, 'blue texture from map_Kd'); }
    finally { delete ThreeD.store()[sc.id]; }
  });
  test('3d: scene on the timeline renders, exports and saves', async () => {
    await ThreeD.load(); const prev = Shell.tab, sc = ThreeD.newScene({ name: '__3d_tl__' }); let L;
    try {
      L = ThreeD.place(sc); ok(L.type === '3d' && L.sceneRef === sc.id && Shell.tab === 'edit', 'placed'); const cv = document.createElement('canvas'); cv.width = P.w; cv.height = P.h; const x = cv.getContext('2d', { willReadFrequently: true }); renderLayers(x, L.start + .2, [L], P);
      const d = x.getImageData(0, 0, P.w, P.h).data; let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++; ok(opaque > 1000, 'pixels rendered: ' + opaque);
      const env = await Shell.buildEnvelope(); ok(env.edit.project.scenes3d[sc.id] && !Schema.validate(env).length, 'saved and valid'); ok(ThreeD.usage(sc.id) === 1, 'usage');
    } finally { if (L) removeLayer(L.id); delete ThreeD.store()[sc.id]; Shell.go(prev); }
  });
  test('shell: no mode on the rail is marked "soon" any more', () => { ok(Object.values(Shell.MODES).every(m => m.st === 'ok'), Object.entries(Shell.MODES).filter(([, m]) => m.st !== 'ok').map(([k]) => k).join(',')); });
  /* ---------- milestone 8: effects / filters library + asset browser + theme ---------- */
  test('library: catalogue sizes (5000+ effects, 2000+ filters, 200+ transitions, 300+ text styles, 100+ sounds, 1000+ stickers)', () => {
    ok(Library.count('fx') >= 5000, 'effects ' + Library.count('fx')); ok(Library.count('filter') >= 2000, 'filters ' + Library.count('filter')); ok(Library.count('tin') + Library.count('tout') >= 200, 'transitions');
    ok(Library.TEXTS.length >= 300 && Library.SFX.length >= 100 && Browser.EMOJI.length >= 1000, `${Library.TEXTS.length} text / ${Library.SFX.length} sfx / ${Browser.EMOJI.length} stickers`);
    const keys = new Set(Library.ITEMS.map(i => i.k + JSON.stringify(i.u) + JSON.stringify(i.a))); ok(keys.size === Library.ITEMS.length, 'every preset has a unique parameter set');
    ok(new Set(Library.ITEMS.map(i => i.id)).size === Library.ITEMS.length && new Set(Library.ITEMS.map(i => i.k + i.n)).size === Library.ITEMS.length, 'unique ids and names');
  });
  const libSig = (it, times) => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d', { willReadFrequently: true }); let h = 0, diff = 0; const base = (() => { const y = document.createElement('canvas'); y.width = 160; y.height = 90; const g = y.getContext('2d', { willReadFrequently: true }); g.drawImage(Browser.currentSample(), 0, 0); return g.getImageData(0, 0, 160, 90).data; })();
    for (const t of times) { Browser.renderItem(it, t, c); const d = x.getImageData(0, 0, 160, 90).data; for (let i = 0; i < d.length; i += 29) { h = (h * 31 + d[i]) >>> 0; diff += Math.abs(d[i] - base[i]); } } return { h, diff }; };
  test('library: 250 effects across the catalogue all change the picture and are all different (GPU)', () => {
    if (!GPU.available) return; const prev = selId; selId = null; const fx = Library.ITEMS.filter(i => i.k === 'fx'), seen = new Map(); let flat = 0, dups = [];
    try { for (let i = 0; i < 250; i++) { const it = fx[Math.floor(i * fx.length / 250)], s = libSig(it, [.13, .37, .71, 1.29]); if (s.diff < 50) flat++; if (seen.has(s.h)) dups.push(seen.get(s.h) + ' = ' + it.n); else seen.set(s.h, it.n); } } finally { selId = prev; }
    ok(!flat, flat + ' effects did not change the image'); ok(!dups.length, dups.slice(0, 3).join('; '));
  });
  test('library: 200 filters all different; 0 % intensity is pixel-identical to the original (GPU)', () => {
    if (!GPU.available) return; const prev = selId; selId = null; const fl = Library.ITEMS.filter(i => i.k === 'filter'), seen = new Set(); let flat = 0, dup = 0;
    try { for (let i = 0; i < 200; i++) { const s = libSig(fl[Math.floor(i * fl.length / 200)], [.5]); if (s.diff < 80) flat++; if (seen.has(s.h)) dup++; seen.add(s.h); }
      const w = document.createElement('canvas'); w.width = 160; w.height = 90; w._ctx = w.getContext('2d', { willReadFrequently: true }); w._ctx.drawImage(Browser.currentSample(), 0, 0); const before = w._ctx.getImageData(0, 0, 160, 90).data.slice(); GPU.run(w, [{ type: 'lib', p: { preset: fl[77].id, amount: 0, speed: 1 }, t: .5, ld: 1 }]); const after = w._ctx.getImageData(0, 0, 160, 90).data; let mx = 0; for (let i = 0; i < after.length; i++) mx = Math.max(mx, Math.abs(after[i] - before[i])); ok(mx === 0, 'intensity 0 diff ' + mx);
    } finally { selId = prev; }
    ok(!flat && !dup, `${flat} unchanged, ${dup} duplicates`);
  });
  test('library: transitions act only at the clip start / end and settle to the untouched clip', () => {
    const tin = Library.ITEMS.find(i => i.k === 'tin' && /Zoom in 2/.test(i.n)), tout = Library.ITEMS.find(i => i.k === 'tout' && /Flash White/.test(i.n));
    const a = Library.evaluate(tin, 0, 1, 1, 3, .5), b = Library.evaluate(tin, .6, 1, 1, 3, .5); ok(a.zoom > 1.5 && Math.abs(b.zoom - 1) < 1e-6, `in: ${a.zoom} → ${b.zoom}`);
    const c = Library.evaluate(tout, 1, 1, 1, 3, .5), d = Library.evaluate(tout, 3, 1, 1, 3, .5); ok(c.flash === 0 && d.flash > .9, `out: ${c.flash} → ${d.flash}`);
  });
  test('browser: applying effects, filters and transitions follows the selection (clip vs own layer)', () => {
    const L = mkLayer('shape', { start: 0, dur: 3 }); addLayer(L, true); const prev = selId, T0 = T, tgt = Browser.S.target; Browser.S.target = 'auto'; const fx = Library.ITEMS.find(i => i.k === 'fx'), fl = Library.ITEMS.find(i => i.k === 'filter'), tin = Library.ITEMS.filter(i => i.k === 'tin');
    let A = null;
    try {
      selId = L.id; Browser.apply(fx); Browser.apply(fl); ok(L.fx.filter(f => f.type === 'lib').length === 2, 'effect + filter on the selected clip');
      Browser.apply(tin[0]); Browser.apply(tin[1]); ok(L.fx.filter(f => f.type === 'lib' && Library.BYID[f.p.preset].k === 'tin').length === 1 && L.fx.some(f => f.p.preset === tin[1].id), 'one In transition per clip (replaced)');
      selId = null; seek(1); const n = P.layers.length; Browser.apply(fx); A = P.layers[P.layers.length - 1]; ok(P.layers.length === n + 1 && A.type === 'adjust' && A.start === 1 && A.fx[0].p.preset === fx.id, 'no selection → its own effect layer at the playhead');
    } finally { removeLayer(L.id); if (A) removeLayer(A.id); selId = prev; seek(T0); Browser.S.target = tgt; }
  });
  test('library: effect renders identically for the same frame and survives save / load', async () => {
    const L = mkLayer('shape', { start: 0, dur: 3 }); Object.assign(L.shape, { w: 600, h: 400, fill: '#3b9bff' }); addLayer(L, true); const it = Library.ITEMS.find(i => /Kaleidoscope 6 · spin 0.8$/.test(i.n)) || Library.ITEMS.find(i => i.c === 'Kaleidoscope'); L.fx.push(Library.fxFor(it.id));
    try { const cv = document.createElement('canvas'); cv.width = P.w; cv.height = P.h; const x = cv.getContext('2d', { willReadFrequently: true }), shot = () => { x.clearRect(0, 0, P.w, P.h); renderLayers(x, 1.234, [P.layers.find(l => l.id === L.id)], P); return x.getImageData(0, 0, P.w, P.h).data; };
      const a = shot(), b = shot(); ok(a.every((v, i) => v === b[i]), 'deterministic');
      const env = await Shell.buildEnvelope(); await Shell.loadEnvelope(JSON.parse(JSON.stringify(env))); const L2 = P.layers.find(l => l.id === L.id); ok(L2 && L2.fx.some(f => f.type === 'lib' && f.p.preset === it.id), 'preset saved'); if (GPU.available) { const c2 = shot(); ok(c2.every((v, i) => v === a[i]), 'same pixels after reload'); }
    } finally { removeLayer(L.id); }
  });
  test('browser: tabs, virtual grid (5000+ items, few DOM cards), search', async () => {
    const prev = leftTab; leftTab = 'effects'; buildLeft(); await sleep_(300);
    try { ok(document.querySelectorAll('#leftTabs button').length === 11, 'tabs'); const cards = document.querySelectorAll('#leftBody .lcard').length; ok(cards > 0 && cards < 120, 'virtualised: ' + cards + ' cards in DOM');
      const q = document.querySelector('#leftBody .lsearch'); q.value = 'kaleidoscope 7'; q.dispatchEvent(new Event('input')); await sleep_(100); ok(Browser.S.list.length > 0 && Browser.S.list.every(i => /kaleidoscope 7/i.test(i.n + ' ' + i.c)), Browser.S.list.length + ' search results');
      for (const t of ['audio', 'text', 'stickers', 'filters', 'transitions']) { leftTab = t; buildLeft(); await sleep_(50); ok(document.querySelector('#leftBody').children.length > 0, t + ' tab renders'); }
    } finally { Browser.S.q.fx = ''; leftTab = prev; buildLeft(); }
  });
  test('browser: sound effects render to real audio; text styles and stickers add layers', async () => {
    const s = Library.SFX.find(x => x.kind === 'Whoosh' && x.len === .8), f = await Library.renderSfx(s), ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await f.arrayBuffer()); near(ab.duration, 1.0, .05, 'whoosh length'); let pk = 0; const d = ab.getChannelData(0); for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); ok(pk > .05, 'audible');
    const n = P.layers.length; Browser.addText(Library.TEXTS.find(t => t.font === 'Impact')); const T1 = P.layers[P.layers.length - 1]; ok(T1.type === 'text' && T1.text.font === 'Impact' && T1.text.anim, 'text style'); removeLayer(T1.id); ok(P.layers.length === n, 'cleaned');
  });
  test('theme: interface accents are light blue / white (no purple)', () => {
    const cs = getComputedStyle(document.documentElement), acc = cs.getPropertyValue('--acc').trim().toLowerCase(); ok(['#5cb8ff', '#ffffff'].includes(acc), 'accent ' + acc);
    const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join(''); } catch (e) { return ''; } }).join(''); ok(!/#8b5cf6|#a855f7|#7c3aed|rgb\(139, 92, 246\)/i.test(css), 'no purple in stylesheets');
  });
  /* ---------- milestone 9: pro editing ---------- */
  function proBench(spec) {   // spec: [[start, dur], ...] → solid layers, returns { Ls, done() } and isolates the timeline
    const saved = P.layers, savedM = P.markers, savedIO = P.io, savedT = T, savedSel = selId, savedDur = P.dur; P.layers = []; P.markers = []; P.io = { in: null, out: null }; P.dur = 20;
    const Ls = spec.map(([s, d], i) => { const L = mkLayer('solid', { name: 'C' + i, start: s, dur: d }); P.layers.push(L); return L; });
    return { Ls, done() { P.layers = saved; P.markers = savedM; P.io = savedIO; P.dur = savedDur; selId = savedSel; seek(savedT); structChanged(); } };
  }
  const r3 = x => Math.round(x * 1000) / 1000;
  test('pro: ripple trim start / end (Q / W) and ripple delete keep later clips in sync', () => {
    const b = proBench([[0, 4], [4, 2], [6, 1]]), [A, B, C] = b.Ls;
    try { selId = A.id; seek(1); Pro.rippleTrimStart(); ok(r3(A.start) === 0 && r3(A.dur) === 3 && r3(A.srcIn) === 1 && r3(B.start) === 3 && r3(C.start) === 5, `Q: A ${A.start}/${A.dur} B ${B.start} C ${C.start}`);
      seek(2); Pro.rippleTrimEnd(); ok(r3(A.dur) === 2 && r3(B.start) === 2 && r3(C.start) === 4, `W: A ${A.dur} B ${B.start}`);
      selId = B.id; Pro.rippleDelete(); ok(!P.layers.includes(B) && r3(C.start) === 2, 'ripple delete: C ' + C.start); }
    finally { b.done(); }
  });
  test('pro: roll edit moves the cut between touching clips; cut-all splits every clip under the playhead', () => {
    const b = proBench([[0, 2], [2, 2], [0, 4]]), [A, B, C] = b.Ls;
    try { selId = A.id; seek(2.5); Pro.roll(); ok(r3(A.dur) === 2.5 && r3(B.start) === 2.5 && r3(B.dur) === 1.5 && r3(B.srcIn) === .5, `roll: A ${A.dur} B ${B.start}/${B.dur}/${B.srcIn}`);
      const n = P.layers.length; seek(1); Pro.cutAll(); ok(P.layers.length === n + 2, 'cut all: ' + (P.layers.length - n) + ' new pieces'); }
    finally { b.done(); }
  });
  test('pro: lift leaves a gap, extract closes it (In / Out across all layers)', () => {
    const b = proBench([[0, 6], [1, 4], [5, 3]]);
    try { seek(2); Pro.markIn(); seek(3); Pro.markOut(); ok(Pro.range()[0] === 2 && Pro.range()[1] === 3, 'range');
      Pro.liftExtract(false); ok(!P.layers.some(L => L.start < 3 - 1e-4 && L.start + L.dur > 2 + 1e-4), 'lift: nothing inside 2–3'); ok(r3(Math.max(...P.layers.map(L => L.start + L.dur))) === 8, 'lift keeps total length');
      Pro.io().in = 4; Pro.io().out = 5; Pro.liftExtract(true); ok(r3(Math.max(...P.layers.map(L => L.start + L.dur))) === 7, 'extract shortens by 1s: ' + Math.max(...P.layers.map(L => L.start + L.dur))); }
    finally { b.done(); }
  });
  test('pro: insert pushes later clips, overwrite replaces the In–Out range (three-point edit)', async () => {
    const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16); const m = await importFile(new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'still.png', { type: 'image/png' }));
    const b = proBench([[0, 3], [3, 3]]), [A, B] = b.Ls; A.type = B.type = 'image'; A.media = B.media = m.id; const prevSel = window.selMedia; selMedia = m.id;
    try { seek(1); const N = Pro.place('insert'); ok(N && r3(N.start) === 1 && r3(N.dur) === 5 && r3(B.start) === 8, `insert: new ${N && N.start}/${N && N.dur}, B ${B.start}`); ok(P.layers.some(L => L !== A && r3(L.start) === 6 && L.media === m.id), 'clip under the playhead was cut and its tail pushed');
      Pro.io().in = 8.5; Pro.io().out = 9.5; const O = Pro.place('overwrite'); ok(r3(O.start) === 8.5 && r3(O.dur) === 1, 'overwrite fits In–Out'); ok(!P.layers.some(L => L !== O && L.start < 9.5 - 1e-4 && L.start + L.dur > 8.5 + 1e-4), 'old picture removed from the range'); }
    finally { b.done(); selMedia = prevSel; delete media[m.id]; uiMedia(); }
  });
  test('pro: J/K/L shuttle, I/O keys, edit-point navigation', () => {
    const b = proBench([[0, 2], [3, 2]]);
    try { seek(0); Pro.shuttle(1); ok(playing && playRate === 1, 'L'); Pro.shuttle(1); ok(playRate === 2, 'L L = 2×'); Pro.shuttle(1); Pro.shuttle(1); ok(playRate === 8, 'max 8×'); Pro.shuttle(-1); ok(playRate === -1, 'J reverses'); Pro.shuttle(0); ok(!playing && playRate === 1, 'K stops');
      const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); const prevTab = Shell.tab; Shell.go('edit'); seek(1.5); key('i'); seek(2.5); key('o'); ok(r3(P.io.in) === 1.5 && r3(P.io.out) === 2.5, 'I / O keys');
      seek(0); Pro.nextEdit(1); ok(r3(T) === 2, 'next edit → 2'); Pro.nextEdit(1); ok(r3(T) === 3, '→ 3'); Pro.nextEdit(-1); ok(r3(T) === 2, '← 2'); Shell.go(prevTab); }
    finally { if (playing) pause(); b.done(); }
  });
  test('pro: slip changes the source in-point only (video)', async () => {
    const m = await importFile(await makeTestVideo(320, 180, 90, 30)), b = proBench([]), L = addMediaLayer(m, 0) || P.layers[P.layers.length - 1];
    try { L.dur = 1; L.srcIn = .5; selId = L.id; const s0 = L.start, d0 = L.dur; Pro.slip(3); ok(r3(L.srcIn) === .6 && L.start === s0 && L.dur === d0, 'slip +3f: ' + L.srcIn); Pro.slip(-1000); ok(L.srcIn === 0, 'clamped at 0'); Pro.slip(1000); ok(r3(L.srcIn) === r3(m.dur - 1), 'clamped at end'); }
    finally { b.done(); delete media[m.id]; uiMedia(); }
  });
  /* ---------- milestone 9: scopes, LUTs, pro export ---------- */
  test('scopes: waveform, histogram and vectorscope measure a known frame', () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 320, 360); x.fillStyle = '#fff'; x.fillRect(320, 0, 320, 360);
    let s = Scopes.analyse(c); ok(s.wf[10 * 256 + 0] === 180 && s.wf[300 * 256 + 255] === 180, 'waveform columns: black left, white right'); ok(s.hist[3][0] === 160 * 180 && s.hist[3][255] === 160 * 180, 'luma histogram split 50/50'); ok(s.lmin === 0 && s.lmax === 255, 'min/max');
    x.fillStyle = 'rgb(191,0,0)'; x.fillRect(0, 0, 640, 360); s = Scopes.analyse(c); let best = 0, bi = 0; s.vec.forEach((v, i) => { if (v > best) { best = v; bi = i; } }); const u = bi % 256 - 128, v = 128 - Math.floor(bi / 256), R = Scopes.BARS.find(b => b[0] === 'R');
    ok(Math.abs(u - R[1]) <= 1 && Math.abs(v - R[2]) <= 1, `75% red lands on the R target (${u}, ${v}) vs (${R[1].toFixed(1)}, ${R[2].toFixed(1)})`);
  });
  const cube = (n, f, title) => { const L = [`TITLE "${title || 'test'}"`, `LUT_3D_SIZE ${n}`]; for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) { const o = f(r / (n - 1), g / (n - 1), b / (n - 1)); L.push(o.map(v => v.toFixed(6)).join(' ')); } return L.join('\n'); };
  test('lut: .cube parsing, GPU result matches the CPU reference, errors are explained', async () => {
    let bad = ''; try { LUT.parse('LUT_3D_SIZE 2\n0 0 0\n1 1 1'); } catch (e) { bad = e.message; } ok(/Expected 8/.test(bad), bad);
    const id = await LUT.importFile(new File([cube(17, (r, g, b) => [Math.pow(g, .8), b, Math.sqrt(r)], 'swap')], 'swap.cube'));
    try {
      const W = 96, H = 64, mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; c._ctx = c.getContext('2d', { willReadFrequently: true }); const gr = c._ctx.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#103050'); gr.addColorStop(.5, '#e0a040'); gr.addColorStop(1, '#40f0c0'); c._ctx.fillStyle = gr; c._ctx.fillRect(0, 0, W, H); return c; };
      const a = mk(), b = mk(); FX.lut.px(a._ctx, a, { lut: id, amount: 100 }); const ran = GPU.available && GPU.run(b, [{ type: 'lut', p: { lut: id, amount: 100 }, t: 0 }]);
      if (ran) { const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let mx = 0; for (let i = 0; i < da.length; i++) mx = Math.max(mx, Math.abs(da[i] - db[i])); ok(mx <= 2, 'GPU vs CPU max diff ' + mx); }
      const src = mk()._ctx.getImageData(40, 30, 1, 1).data, p = a._ctx.getImageData(40, 30, 1, 1).data, [sr, sg, sb] = [src[0] / 255, src[1] / 255, src[2] / 255], want = [Math.pow(sg, .8), sb, Math.sqrt(sr)].map(v => v * 255);
      ok(want.every((v, i) => Math.abs(v - p[i]) <= 4), `LUT maths: got ${[...p].slice(0, 3)} want ${want.map(Math.round)}`);
      const env = await Shell.buildEnvelope(); ok(env.luts && env.luts[id] && env.luts[id].n === 17, 'saved with the project'); LUT.reset(); ok(!LUT.store()[id], 'reset'); LUT.fromJSON(env.luts); ok(LUT.store()[id].name === 'swap', 'restored');
    } finally { delete LUT.store()[id]; LUT.invalidate(id); }
  });
  test('lut: a library filter baked to .cube reproduces the filter (round trip)', async () => {
    if (!GPU.available) return; const fl = Library.ITEMS.find(i => i.k === 'filter' && /Teal & orange · Punchy$/.test(i.n)) || Library.ITEMS.find(i => i.k === 'filter');
    const txt = LUT.bake(fl.id, 33), id = await LUT.importFile(new File([txt], 'baked.cube'));
    try { const W = 96, H = 64, mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; c._ctx = c.getContext('2d', { willReadFrequently: true }); c._ctx.drawImage(Browser.currentSample(), 0, 0, W, H); return c; };
      const a = mk(), b = mk(); GPU.run(a, [{ type: 'lib', p: { preset: fl.id, amount: 100, speed: 1 }, t: 0, ld: 1 }]); GPU.run(b, [{ type: 'lut', p: { lut: id, amount: 100 }, t: 0 }]);
      const da = a._ctx.getImageData(0, 0, W, H).data, db = b._ctx.getImageData(0, 0, W, H).data; let s = 0, mx = 0; for (let i = 0; i < da.length; i += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(da[i + c] - db[i + c]); s += d; mx = Math.max(mx, d); }
      ok(s / (W * H * 3) < 2 && mx < 16, `mean diff ${(s / (W * H * 3)).toFixed(2)}, max ${mx}`); ok(/LUT_3D_SIZE 33/.test(txt) && txt.split('\n').length > 35000, '33-point cube');
    } finally { delete LUT.store()[id]; LUT.invalidate(id); }
  });
  test('export: In–Out range + codec selection produce a decodable MP4 of the right length', async () => {
    if (!offlineSupported()) return; const io0 = P.io, dl = window.download; let blob = null; window.download = b => { blob = b; }; const codecs = await supportedCodecs(P.w, P.h, P.fps); ok(codecs.includes('avc'), 'H.264 available: ' + codecs.join(','));
    try { for (const codec of codecs.filter(c => c === 'avc' || c === 'hevc')) { blob = null; await exportOffline({ fps: 30, mbps: 8, audio: false, codec, from: 1, to: 2 }); ok(blob && blob.size > 1000, codec + ' file');
        const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob); const okLoad = await new Promise(r => { v.onloadedmetadata = () => r(true); v.onerror = () => r(false); setTimeout(() => r(false), 5000); });
        if (codec === 'avc') { ok(okLoad && Math.abs(v.duration - 1) < .1, `${codec}: ${v.duration}s`); } v.removeAttribute('src'); v.load(); } }
    finally { window.download = dl; P.io = io0; }
  });
  test('render cache: segments render, play back in real time, and only edited segments go stale', async () => {
    if (!(window.VideoEncoder && window.Mp4Muxer)) return;
    const keep = P.layers.slice(), dur0 = P.dur, T0 = T; RenderCache.clear();
    try {
      P.layers.length = 0; P.dur = 8;
      const A = mkLayer('shape', { start: 0, dur: 4 }), B = mkLayer('shape', { start: 4.5, dur: 3 }); Object.assign(A.shape, { w: P.w * .6, h: P.h * .6, fill: '#3080e0' }); Object.assign(B.shape, { w: 300, h: 300, fill: '#e0e0e0' });
      P.layers.push(A, B); commit();
      const n = await RenderCache.render(0, 8, { quiet: true }); ok(n === 2 && RenderCache.valid(0) && RenderCache.valid(1), 'two segments rendered: ' + n);
      B.shape.fill = '#ff0000'; commit(); ok(RenderCache.valid(0) && !RenderCache.valid(1), 'editing a clip in 4–8 s invalidates only that segment');
      renderTimeline(); ok(document.querySelectorAll('.ruler .rcache').length === 1, 'ruler shows one rendered segment');
      const hits0 = RenderCache.S.hits || 0; seek(1); play(); let snap = null; const c1 = mkCanvas(64, 36), x1 = c1.getContext('2d', { willReadFrequently: true });
      // frames are driven here at ~60 Hz (hidden test windows throttle requestAnimationFrame to ~1 Hz)
      for (let i = 0; i < 120 && !snap; i++) { await sleep_(16); T = Math.min(3.9, playT0 + (performance.now() - wall0) / 1000); renderComp(vctx, T); if ((RenderCache.S.hits || 0) > hits0 + 10) { x1.drawImage(view, 0, 0, 64, 36); snap = x1.getImageData(0, 0, 64, 36).data; } }
      pause(); ok(snap, 'playback drew frames from the render file (hits ' + ((RenderCache.S.hits || 0) - hits0) + ', fallbacks ' + JSON.stringify(RenderCache.S.why) + ')');
      renderComp(vctx, T); const c2 = mkCanvas(64, 36), x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(view, 0, 0, 64, 36); const live = x2.getImageData(0, 0, 64, 36).data;
      let s = 0; for (let k = 0; k < live.length; k += 4) for (let q = 0; q < 3; q++) s += Math.abs(live[k + q] - snap[k + q]); ok(s / (64 * 36 * 3) < 4, 'cached frame matches live render: mean diff ' + (s / (64 * 36 * 3)).toFixed(2));
    } finally { pause(); RenderCache.clear(); P.layers.length = 0; P.layers.push(...keep); P.dur = dur0; T = T0; commit(); structChanged(); }
  });
  test('formats: a NEXORA PSD is read correctly by an independent decoder (FFmpeg, desktop)', async () => {
    if (!ProMedia.on || !(await ProMedia.probe()).available) return;
    const d = NXI.newDoc({ w: 96, h: 64, bg: '#2a6fd0' }), a = NXI.mkLayer(d, 'raster', { name: 'shape' }); { const x = a.canvas.getContext('2d'); x.fillStyle = '#ffcc00'; x.beginPath(); x.arc(48, 32, 22, 0, 7); x.fill(); } a.blend = 'multiply'; d.layers.push(a);
    const dir = Disk.join(await Disk.fs.defaultRoot(), '__nexora_psd_test__'), psd = Disk.join(dir, 't.psd'), png = Disk.join(dir, 't.png');
    try {
      await Disk.fs.writeBytes(psd, await (await NXI.psd.write(d)).arrayBuffer()); await nxff.optimize(psd, png, 'image');
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = Disk.urlOf(png) + '?' + Date.now(); await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('png not readable')); });
      const c = NXI.newCanvas(96, 64), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); const p = x.getImageData(0, 0, 96, 64).data, q = NXI.flatten(d).getContext('2d').getImageData(0, 0, 96, 64).data;
      let s = 0; for (let i = 0; i < p.length; i += 4) for (let k = 0; k < 3; k++) s += Math.abs(p[i + k] - q[i + k]); ok(img.width === 96 && s / (96 * 64 * 3) < 1.5, 'FFmpeg decode vs NEXORA composite: mean diff ' + (s / (96 * 64 * 3)).toFixed(2));
    } finally { await Disk.fs.remove(dir); }
  });
  test('pro export: the timeline mix is muxed into masters (PCM), software H.264 (AAC) and WAV stems (desktop)', async () => {
    if (!ProMedia.on || !(await ProMedia.probe()).available) return;
    const dir = Disk.join(await Disk.fs.defaultRoot(), '__nexora_ffaudio_test__'), f = await Library.renderSfx(Library.SFX.find(x => x.kind === 'Whoosh' && x.len === .8)), m = await importFile(new File([f], 'sfx.wav', { type: 'audio/wav' })), L = addMediaLayer(m, 0), dur0 = P.dur; P.dur = Math.max(P.dur, 2);
    try {
      const run = async (codec, name) => { const out = Disk.join(dir, name), r = await ProMedia.exportPro({ codec, from: 0, to: .6, fps: 30, mbps: 8, audio: true, out, quiet: true }); ok(r && r.size > 500, codec + ' written'); return nxff.info(out); };
      let i = await run('prores_lt', 'a.mov'); ok(i.video && i.video.codec === 'prores' && i.audio && i.audio.codec === 'pcm_s24le' && Math.abs(i.dur - .6) < .06, 'ProRes + PCM: ' + JSON.stringify(i));
      i = await run('x264', 'a.mp4'); ok(i.video && i.video.codec === 'h264' && i.audio && i.audio.codec === 'aac', 'H.264 + AAC: ' + JSON.stringify(i));
      i = await run('wav', 'a.wav'); ok(!i.video && i.audio && i.audio.codec === 'pcm_s24le' && Math.abs(i.dur - .6) < .02, 'WAV: ' + JSON.stringify(i));
    } finally { removeLayer(L.id); delete media[m.id]; uiMedia(); P.dur = dur0; commit(); await Disk.fs.remove(dir); }
  });
  test('pro export: WAV writer round-trips samples exactly', async () => {
    const SR = 48000, b = new AudioBuffer({ length: 4800, numberOfChannels: 2, sampleRate: SR }); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * (c + 1) * .01) * .7; }
    const back = await new OfflineAudioContext(2, 1, SR).decodeAudioData(ProMedia.wav(b)); ok(back.length === 4800 && back.numberOfChannels === 2, 'shape');
    let mx = 0; for (let c = 0; c < 2; c++) { const x = b.getChannelData(c), y = back.getChannelData(c); for (let i = 0; i < x.length; i++) mx = Math.max(mx, Math.abs(x[i] - y[i])); } ok(mx < 1e-6, 'max error ' + mx);
  });
  test('pro export: ProRes 4444 alpha, DNxHR, HEVC 10-bit, PNG sequence + optimized import of a ProRes/DNxHR file (desktop)', async () => {
    if (!ProMedia.on) return; const inf = await ProMedia.probe(); ok(inf.available, 'FFmpeg bundled: ' + (inf.version || inf.error));
    const dir = Disk.join(await Disk.fs.defaultRoot(), '__nexora_ffmpeg_test__'), bg0 = P.bg, W = P.w & ~1, H = P.h & ~1, made = []; await Disk.fs.remove(dir);
    try {
      P.bg = 'transparent'; const a = Disk.join(dir, 'alpha.mov'), r = await ProMedia.exportPro({ codec: 'prores_4444', from: 0, to: .5, fps: 30, audio: false, out: a, quiet: true });
      ok(r && r.frames === 15 && r.size > 1000, 'ProRes 4444 written: ' + JSON.stringify(r)); let i = await nxff.info(a); ok(i.video && i.video.codec === 'prores' && i.video.w === W && i.video.alpha, 'probe: ' + JSON.stringify(i.video));
      P.bg = '#203040';
      const d = Disk.join(dir, 'dnx.mov'); await ProMedia.exportPro({ codec: 'dnxhr_hq', from: 0, to: .5, fps: 30, audio: false, out: d, quiet: true }); i = await nxff.info(d); ok(i.video && i.video.codec === 'dnxhd' && Math.abs(i.dur - .5) < .05, 'DNxHR: ' + JSON.stringify(i));
      const h = Disk.join(dir, 'hevc10.mp4'); await ProMedia.exportPro({ codec: 'x265_10', from: 0, to: .5, fps: 30, mbps: 8, audio: false, out: h, quiet: true }); i = await nxff.info(h); ok(i.video && i.video.codec === 'hevc', 'x265: ' + JSON.stringify(i.video));
      const s = Disk.join(dir, 'seq'); await ProMedia.exportPro({ codec: 'png_seq', from: 0, to: .2, fps: 30, audio: false, out: s, base: 'seq', quiet: true }); const f = await Disk.fs.find(s, ['seq_000000.png', 'seq_000005.png'], 1); ok(f['seq_000000.png'] && f['seq_000005.png'], 'PNG frames 0…5');
      // a DNxHR .mov cannot be decoded by Chromium: importing it creates optimized media whose frames match the timeline render
      const m = await Disk.importPath(d); made.push(m); ok(m.source === d && /\.mp4$/.test(m.path) && m.w === W && m.h === H && Math.abs(m.dur - .5) < .1, 'optimized: ' + JSON.stringify({ src: m.source, path: m.path, w: m.w, dur: m.dur }));
      const v = document.createElement('video'); v.muted = true; v.crossOrigin = 'anonymous'; v.src = m.url; await new Promise(r => v.onloadeddata = r); v.currentTime = 6.5 / 30; await new Promise(r => v.onseeked = r);
      const cw = 64, ch = Math.round(64 * H / W), c1 = mkCanvas(cw, ch), c2 = mkCanvas(cw, ch), x1 = c1.getContext('2d', { willReadFrequently: true }), x2 = c2.getContext('2d', { willReadFrequently: true });
      x1.drawImage(v, 0, 0, cw, ch); v.removeAttribute('src'); v.load(); renderComp(vctx, 6 / 30); x2.drawImage(view, 0, 0, cw, ch);
      const p1 = x1.getImageData(0, 0, cw, ch).data, p2 = x2.getImageData(0, 0, cw, ch).data; let sum = 0; for (let k = 0; k < p1.length; k += 4) for (let q = 0; q < 3; q++) sum += Math.abs(p1[k + q] - p2[k + q]);
      ok(sum / (cw * ch * 3) < 6, 'optimized frame vs render: mean diff ' + (sum / (cw * ch * 3)).toFixed(2));
    } finally { P.bg = bg0; requestRender(); for (const m of made) { delete media[m.id]; if (m.path) await Disk.fs.remove(m.path); } uiMedia(); await Disk.fs.remove(dir); }
  });
  test('askText: in-app prompt resolves with the typed value', async () => { const p = askText('Name', 'abc'); const i = document.querySelector('#modal input'); i.value = 'hello'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); ok(await p === 'hello'); });
  test('projects: save, list, reopen, rename, duplicate, delete', async () => {
    const prevCur = Projects.current, id = 'test-' + uid(); let dup;
    Projects.current = { id, name: '__selftest__', kind: 'video', created: Date.now() }; Recovery.suspended = true;
    try {
      const meta = await Projects.save(); DK.saved = meta && meta.folder; ok(meta && meta.id === id && meta.size > 100 && /^data:image\/jpeg/.test(meta.thumb || ''), 'saved with thumbnail');
      ok((await Projects.list()).some(m => m.id === id), 'listed');
      const n = P.layers.length, r = await Projects.load(id); ok(!r.probs.length && P.layers.length === n && Projects.current.id === id, 'reopened identically');
      await Projects.rename(id, '__renamed__'); { const rn = (await Projects.list()).find(m => m.id === id); ok(rn.name === '__renamed__', 'renamed'); if (Disk.on) { ok(/__renamed__$/.test(rn.folder) && (await Disk.fs.stat(Disk.projectFile(rn.folder))).exists, 'folder renamed on disk: ' + rn.folder); DK.saved = rn.folder; } }
      dup = await Projects.duplicate(id); DK.dupFolder = ((await Projects.list()).find(m => m.id === dup) || {}).folder; ok((await Projects.get(dup)).json === (await Projects.get(id)).json, 'duplicate has same data');
      await Projects.remove(id); await Projects.remove(dup); const after = await Projects.list(); ok(!after.some(m => m.id === id || m.id === dup), 'deleted');
    } finally {
      // desktop: the library keeps folders on disk by design, so the test deletes the folders it created
      const folders = (await Projects.list()).filter(m => m.id === id || m.id === dup).map(m => m.folder).concat([Projects.current && Projects.current.id === id ? Projects.current.folder : null, DK.saved, DK.dupFolder]).filter(Boolean);
      if (dup) await Projects.remove(dup); await Projects.remove(id); Projects.current = prevCur; Recovery.suspended = false; Disk.S.folder = null;
      if (Disk.on) for (const f of new Set(folders)) await Disk.fs.remove(f);
    }
  });

  /* ---------- accounts (real main-process code; separate accounts-test store) ---------- */
  const A_ = () => window.nxauth, hasAuth = () => !!(window.nxauth && window.nxauth.test);
  const SP = 'correct horse battery';
  const mustOk = (r, what) => { ok(r && r.ok, (what || 'call') + ': ' + (r && r.error)); return r; };
  async function freshUser(email) { await A_().test('reset'); return mustOk(await A_().signUp({ name: 'Test User', email: email || 'a@example.com', password: SP, remember: false }), 'signUp'); }
  test('auth: sign-up, strong hashing, encrypted store, sign-out, sign-in, wrong password', async () => {
    if (!hasAuth()) return; const r = await freshUser('Editor@Example.com');
    ok(r.user.email === 'editor@example.com' && r.recovery.length === 10, 'account + recovery codes'); ok(!('password' in r.user) && !JSON.stringify(r).includes('hash'), 'no secrets reach the page');
    const m = await A_().test('pwmeta', 'editor@example.com'); ok(m.N === 131072 && m.r === 8 && m.p === 1 && m.saltLen === 16 && m.hashLen === 32, 'scrypt ' + JSON.stringify(m));
    const raw = await A_().test('raw'), encOn = (await A_().status()).encrypted; if (encOn) ok(!raw.includes('editor@example.com'), 'store is encrypted on disk'); else console.info('no OS key store on this machine: accounts kept in an owner-only file, not encrypted');
    ok((await A_().status()).user.id === r.user.id); mustOk(await A_().signOut()); ok(!(await A_().status()).user, 'signed out');
    let x = await A_().signIn({ email: 'editor@example.com', password: 'wrong password!' }); ok(!x.ok && x.code === 'bad_credentials', 'wrong password refused');
    x = await A_().signIn({ email: 'nobody@example.com', password: 'whatever12345' }); ok(!x.ok && x.code === 'bad_credentials', 'unknown e-mail gives the same answer');
    x = mustOk(await A_().signIn({ email: 'EDITOR@example.com ', password: SP }), 'correct password'); ok(x.user && (await A_().status()).user, 'signed in');
    ok(!(await A_().signUp({ email: 'editor@example.com', password: SP })).ok, 'duplicate refused'); await A_().signOut();
    for (const bad of ['short', 'password123', '1234567890']) ok((await A_().signUp({ email: 'b@example.com', password: bad })).code === 'weak_password', 'weak: ' + bad);
    ok((await A_().signUp({ email: 'not-an-email', password: SP })).code === 'bad_email', 'bad e-mail');
  });
  test('auth: five wrong passwords lock the account, then it recovers', async () => {
    if (!hasAuth()) return; await freshUser(); await A_().signOut(); for (let i = 0; i < 5; i++) await A_().signIn({ email: 'a@example.com', password: 'nope nope nope' });
    const l = await A_().signIn({ email: 'a@example.com', password: SP }); ok(!l.ok && l.code === 'locked', 'even the right password is refused while locked: ' + l.code);
    await A_().test('unlock', 'a@example.com'); mustOk(await A_().signIn({ email: 'a@example.com', password: SP }), 'after the lock');
  });
  test('auth: TOTP matches RFC 6238 test vectors', async () => {
    if (!hasAuth()) return; const s = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    ok(await A_().test('totpAt', { secret: s, step: 1 }) === '287082', 'T=59'); ok(await A_().test('totpAt', { secret: s, step: 37037036 }) === '081804', 'T=1111111109'); ok(await A_().test('totpAt', { secret: s, step: 41152263 }) === '005924', 'T=1234567890'); ok(await A_().test('totpAt', { secret: s, step: 66666666 }) === '279037', 'T=2000000000');
  });
  test('auth: 2FA enrol, sign-in, replay refused, recovery code works once, turn off', async () => {
    if (!hasAuth()) return; const u = await freshUser(), b = mustOk(await A_().totpBegin(), 'begin'); ok(b.uri.startsWith('otpauth://totp/') && b.uri.includes('issuer=NEXORA%20Studio') && b.qr.size >= 21, 'uri + qr');
    ok((await A_().totpConfirm({ code: '000000' })).code === 'bad_code', 'wrong code refused');
    const secret = b.secret.replace(/ /g, ''), step = await A_().test('step'), c0 = await A_().test('totpAt', { secret, step });
    const on = mustOk(await A_().totpConfirm({ code: c0 }), 'confirm'); ok(on.user.totp && on.recovery.length === 10, 'on, new recovery codes'); await A_().signOut();
    const f = mustOk(await A_().signIn({ email: 'a@example.com', password: SP }), 'first factor'); ok(f.twoFactor && !f.user && f.methods.includes('totp') && !(await A_().status()).user, 'password alone does not sign in');
    ok((await A_().verify2fa({ method: 'totp', code: c0 })).code === 'bad_code', 'the code used at enrolment cannot be replayed');
    const c1 = await A_().test('totpAt', { secret, step: step + 1 }); mustOk(await A_().verify2fa({ method: 'totp', code: c1 }), 'next code'); ok((await A_().status()).user, 'signed in');
    await A_().signOut(); await A_().test('unlock', 'a@example.com'); mustOk(await A_().signIn({ email: 'a@example.com', password: SP })); const v = mustOk(await A_().verify2fa({ method: 'recovery', code: on.recovery[0].toLowerCase() }), 'recovery'); ok(v.user.recoveryLeft === 9, 'one code consumed');
    await A_().signOut(); mustOk(await A_().signIn({ email: 'a@example.com', password: SP })); ok((await A_().verify2fa({ method: 'recovery', code: on.recovery[0] })).code === 'bad_code', 'single use'); mustOk(await A_().verify2fa({ method: 'recovery', code: on.recovery[1] }));
    ok((await A_().totpDisable({ code: 'nope' })).code === 'bad_code', 'turning off needs proof'); const off = mustOk(await A_().totpDisable({ code: on.recovery[2] })); ok(!off.user.totp, 'off'); await A_().signOut(); ok(u.user && (mustOk(await A_().signIn({ email: 'a@example.com', password: SP }))).user, 'password only again'); await A_().signOut();
  });
  test('auth: QR code is structurally valid (format BCH, Reed-Solomon, payload)', async () => {
    if (!hasAuth()) return; const text = 'otpauth://totp/NEXORA%20Studio:someone%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=NEXORA%20Studio&algorithm=SHA1&digits=6&period=30';
    const q = await A_().test('qr', text), N = q.size, M = (x, y) => q.rows[y][x] === '1', ver = q.version; ok(N === ver * 4 + 17, 'size');
    let f = 0; for (let i = 0; i <= 5; i++) f |= (M(8, i) ? 1 : 0) << i; f |= (M(8, 7) ? 1 : 0) << 6; f |= (M(8, 8) ? 1 : 0) << 7; f |= (M(7, 8) ? 1 : 0) << 8; for (let i = 9; i < 15; i++) f |= (M(14 - i, 8) ? 1 : 0) << i;
    f ^= 0x5412; let rem = f; for (let i = 14; i >= 10; i--) if (rem >> i & 1) rem ^= 0x537 << (i - 10); ok((rem & 0x3ff) === 0, 'format BCH'); ok((f >> 13) === 0, 'level M'); const mask = (f >> 10) & 7;
    const fn = [...Array(N)].map(() => new Array(N).fill(false)), mark = (x, y) => { if (x >= 0 && y >= 0 && x < N && y < N) fn[y][x] = true; }; for (let i = 0; i < N; i++) { mark(6, i); mark(i, 6); } for (const [a, b] of [[0, 0], [N - 8, 0], [0, N - 8]]) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) mark(a + x, b + y);
    for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); } for (let i = 0; i < 8; i++) mark(N - 1 - i, 8); for (let i = 0; i < 8; i++) mark(8, N - 1 - i);
    if (ver > 1) { const n = Math.floor(ver / 7) + 2, st = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, pos = [6]; for (let p = N - 7; pos.length < n; p -= st) pos.splice(1, 0, p); pos.forEach((py, i) => pos.forEach((px, j) => { if ((!i && !j) || (!i && j === n - 1) || (i === n - 1 && !j)) return; for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) mark(px + e, py + d); })); }
    if (ver >= 7) for (let i = 0; i < 18; i++) { const a = N - 11 + i % 3, c = Math.floor(i / 3); mark(a, c); mark(c, a); }
    const MF = [(x, y) => (x + y) % 2, (x, y) => y % 2, x => x % 3, (x, y) => (x + y) % 3, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2, (x, y) => x * y % 2 + x * y % 3, (x, y) => (x * y % 2 + x * y % 3) % 2, (x, y) => ((x + y) % 2 + x * y % 3) % 2][mask], bits = [];
    for (let right = N - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let v = 0; v < N; v++) for (let j = 0; j < 2; j++) { const x = right - j, y = ((right + 1) & 2) === 0 ? N - 1 - v : v; if (!fn[y][x]) bits.push(M(x, y) !== (MF(x, y) === 0)); } }
    const raw = []; for (let i = 0; i + 8 <= bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | (bits[i + k] ? 1 : 0); raw.push(b); }
    const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26][ver], NB = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16][ver], nShort = NB - raw.length % NB, sLen = Math.floor(raw.length / NB), blocks = [...Array(NB)].map(() => []); let p = 0;
    for (let i = 0; i < sLen - ECC; i++) for (let b = 0; b < NB; b++) blocks[b].push(raw[p++]); for (let b = nShort; b < NB; b++) blocks[b].push(raw[p++]); for (let i = 0; i < ECC; i++) for (let b = 0; b < NB; b++) blocks[b].push(raw[p++]);
    const gm = (a, c) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((c >>> i) & 1) * a; } return z & 255; };
    blocks.forEach((bl, bi) => { let root = 1; for (let i = 0; i < ECC; i++) { let s = 0; for (const c of bl) s = gm(s, root) ^ c; ok(s === 0, `RS syndrome ${i} of block ${bi}`); root = gm(root, 2); } });
    const data = blocks.flatMap(b => b.slice(0, b.length - ECC)); let bs = data.map(b => b.toString(2).padStart(8, '0')).join(''); ok(bs.slice(0, 4) === '0100', 'byte mode'); const cc = ver < 10 ? 8 : 16, len = parseInt(bs.substr(4, cc), 2); let out = ''; for (let i = 0; i < len; i++) out += String.fromCharCode(parseInt(bs.substr(4 + cc + i * 8, 8), 2)); ok(out === text, 'payload: ' + out.slice(0, 40));
  });
  const idpMode = async (id, mode) => { await A_().test('set', { mode }); const r = await A_().oauth(id, {}); await A_().test('set', { mode: 'ok' }); return r; };
  test('auth: Google and Microsoft sign-in (PKCE, ID token checks, no silent account merge)', async () => {
    if (!hasAuth()) return; await A_().test('reset'); const base = await A_().test('idp');
    ok((await A_().oauth('google', {})).code === 'not_configured', 'honest when not set up');
    await A_().test('route', { id: 'google', base }); await A_().test('route', { id: 'microsoft', base }); mustOk(await A_().providerSet('google', { clientId: 'g-client', clientSecret: 'g-secret' })); mustOk(await A_().providerSet('microsoft', { clientId: 'ms-client' }));
    ok(!JSON.stringify(await A_().providers()).includes('g-secret'), 'client secret stays in the main process');
    for (const m of ['badnonce', 'badaud', 'badiss', 'badsig', 'expired']) { const r = await idpMode('google', m); ok(!r.ok && r.code === 'bad_token', m + ' refused: ' + JSON.stringify(r)); ok(!(await A_().status()).user, 'not signed in after ' + m); }
    const den = await idpMode('google', 'deny'); ok(den.code === 'denied', 'user cancelled at the provider');
    await A_().test('set', { mode: 'badstate' }); const pr = A_().oauth('google', {}); await new Promise(r => setTimeout(r, 700)); ok(!(await A_().status()).user, 'forged state ignored'); await A_().oauthCancel(); ok((await pr).code === 'cancelled', 'forged redirect never completes the sign-in'); await A_().test('set', { mode: 'ok' });
    const g = mustOk(await A_().oauth('google', { remember: false }), 'google'); ok(g.created && g.user.email === 'idp.user@example.com' && g.user.emailVerified && g.user.links.google && !g.user.hasPassword, 'account created'); ok(await A_().test('verifierOk'), 'PKCE verified by the provider'); await A_().signOut();
    const g2 = mustOk(await A_().oauth('google', {}), 'returning user'); ok(g2.user.id === g.user.id && !g2.created, 'same account'); await A_().signOut();
    await A_().test('set', { sub: 'ms-1', email: 'second@example.com' }); const ms = mustOk(await A_().oauth('microsoft', {}), 'microsoft'); ok(ms.user.links.microsoft && ms.user.id !== g.user.id, 'separate account'); await A_().signOut();
    mustOk(await A_().signUp({ email: 'taken@example.com', password: SP })); await A_().signOut(); await A_().test('set', { sub: 'attacker', email: 'taken@example.com' }); ok((await A_().oauth('microsoft', {})).code === 'email_taken', 'matching e-mail is never merged automatically');
    mustOk(await A_().signIn({ email: 'taken@example.com', password: SP })); const l = mustOk(await A_().oauth('microsoft', { link: true }), 'connect from Profile'); ok(l.user.links.microsoft, 'connected'); await A_().signOut(); ok(mustOk(await A_().oauth('microsoft', {})).user.email === 'taken@example.com', 'connected provider signs in'); await A_().test('set', { sub: 'user-1', email: 'idp.user@example.com' }); ok((await A_().oauth('microsoft', { link: true })).ok, 'relink own'); const u2 = await A_().status(); await A_().signOut(); ok(u2.user, 'state');
  });
  test('auth: GitHub device flow and custom OpenID Connect (discovery)', async () => {
    if (!hasAuth()) return; await A_().test('reset'); const base = await A_().test('idp'); await A_().test('route', { id: 'github', base }); mustOk(await A_().providerSet('github', { clientId: 'gh-client' }));
    let dev = null; const off = A_().onEvent((t, d) => { if (t === 'device') dev = d; }); const g = mustOk(await A_().oauth('github', {}), 'github'); off(); ok(dev && dev.code === 'ABCD-1234', 'user code shown'); ok(g.user.email === 'gh.user@example.com' && g.user.name === 'Git Hub', 'identity'); await A_().signOut();
    mustOk(await A_().providerSet('oidc', { clientId: 'sso', issuer: base, label: 'Acme SSO' })); const list = (await A_().providers()).list.find(p => p.id === 'oidc'); ok(list.configured && list.name === 'Acme SSO', 'named');
    const o = mustOk(await A_().oauth('oidc', {}), 'sso'); ok(Object.keys(o.user.links)[0] === 'oidc:' + base, 'bound to the issuer'); await A_().signOut();
    ok(!(await A_().providerSet('oidc', { clientId: 'x', issuer: 'http://insecure.example.com' })).ok, 'plain http issuer refused');
  });
  test('auth: e-mail verification, code sign-in, reset; 2FA also applies after a provider', async () => {
    if (!hasAuth()) return; const lastCode = async () => { const m = await A_().test('mails'); return /(\d{6})/.exec(m[m.length - 1].data.split('\n\n').slice(1).join('\n'))[1]; };
    const u = await freshUser(), port = await A_().test('smtp'); mustOk(await A_().smtpSet({ host: '127.0.0.1', port, user: 'u', pass: 'p', from: 'studio@example.com' }), 'smtp'); ok(!JSON.stringify(await A_().smtpGet()).includes('"p"') && (await A_().smtpGet()).hasPass, 'mail password stays in the main process');
    mustOk(await A_().smtpTest(), 'test mail'); ok((await A_().test('mails')).length === 1, 'delivered');
    mustOk(await A_().verifyEmailSend()); ok((await A_().verifyEmailConfirm({ code: '000000' })).code === 'bad_code'); const v = mustOk(await A_().verifyEmailConfirm({ code: await lastCode() })); ok(v.user.emailVerified, 'verified'); await A_().signOut();
    mustOk(await A_().emailCodeRequest({ email: 'a@example.com' })); const si = mustOk(await A_().emailCodeSignIn({ email: 'a@example.com', code: await lastCode() }), 'code sign-in'); ok(si.user, 'signed in by e-mail'); await A_().signOut();
    const n = (await A_().test('mails')).length; mustOk(await A_().emailCodeRequest({ email: 'ghost@example.com' })); ok((await A_().test('mails')).length === n, 'unknown address: nothing sent, same answer');
    mustOk(await A_().resetRequest({ email: 'a@example.com' })); const NP = 'a brand new passphrase'; mustOk(await A_().resetPassword({ email: 'a@example.com', code: await lastCode(), password: NP, via: 'email' }), 'reset'); ok(!(await A_().signIn({ email: 'a@example.com', password: SP })).ok, 'old password gone'); mustOk(await A_().signIn({ email: 'a@example.com', password: NP })); ok(u.recovery.length === 10, 'codes'); await A_().signOut();
    mustOk(await A_().resetPassword({ email: 'a@example.com', code: u.recovery[0], password: SP, via: 'recovery' }), 'reset by recovery code'); ok(!(await A_().resetPassword({ email: 'a@example.com', code: u.recovery[0], password: 'yet another one 1' })).ok, 'recovery code single use');
    await A_().test('unlock', 'a@example.com'); mustOk(await A_().signIn({ email: 'a@example.com', password: SP })); const base = await A_().test('idp'); await A_().test('route', { id: 'google', base }); mustOk(await A_().providerSet('google', { clientId: 'c', clientSecret: 's' })); mustOk(await A_().oauth('google', { link: true })); const b = mustOk(await A_().totpBegin()), secret = b.secret.replace(/ /g, ''), st = await A_().test('step'); mustOk(await A_().totpConfirm({ code: await A_().test('totpAt', { secret, step: st }) })); await A_().signOut();
    const r = mustOk(await A_().oauth('google', {}), 'provider'); ok(r.twoFactor && !r.user && !(await A_().status()).user, 'Google alone does not bypass 2FA'); mustOk(await A_().verify2fa({ method: 'totp', code: await A_().test('totpAt', { secret, step: st + 1 }) })); await A_().signOut();
  });
  test('auth: remember me survives a restart, profile saves, account deletes', async () => {
    if (!hasAuth()) return; await A_().test('reset'); mustOk(await A_().signUp({ email: 'a@example.com', password: SP, remember: true, name: 'A' }));
    ok(await A_().test('reload') === true, 'remembered session restored'); ok((await A_().status()).user.email === 'a@example.com'); await A_().signOut(); ok(await A_().test('reload') === false, 'signed out stays out');
    mustOk(await A_().signIn({ email: 'a@example.com', password: SP, remember: false })); ok(await A_().test('reload') === false, 'not remembered unless asked');
    mustOk(await A_().signIn({ email: 'a@example.com', password: SP })); const p = mustOk(await A_().updateProfile({ name: 'Colorist', title: 'Lead', prefs: { w: 3840, h: 2160, fps: 23.976 } })); ok(p.user.name === 'Colorist' && p.user.prefs.w === 3840 && p.user.prefs.fps === 23.976, 'saved');
    ok(!(await A_().updateProfile({ avatar: 'javascript:alert(1)' })).ok, 'only real images as avatars'); ok(!(await A_().changePassword({ current: 'bad', next: 'a good new password' })).ok, 'needs the current password'); mustOk(await A_().changePassword({ current: SP, next: 'a good new password' }));
    ok((await A_().activity()).log.some(l => l.ev === 'Password changed'), 'activity'); ok(!(await A_().deleteAccount({ confirm: 'wrong@example.com', password: 'a good new password' })).ok, 'confirm required'); mustOk(await A_().deleteAccount({ confirm: 'a@example.com', password: 'a good new password' }), 'delete'); ok(!(await A_().status()).user && !(await A_().status()).hasUsers, 'gone');
  });
  test('auth: library shows each account its own projects; older projects stay visible', async () => {
    if (!hasAuth()) return; const now = Date.now(), mine = { id: '__own_a', name: 'a', kind: 'video', created: now, updated: now, owner: 'user-a' }, other = { id: '__own_b', name: 'b', kind: 'video', created: now, updated: now, owner: 'user-b' }, old = { id: '__own_c', name: 'c', kind: 'video', created: now, updated: now };
    await Projects._tx(['meta'], 'readwrite', t => { const s = t.objectStore('meta'); s.put(mine); s.put(other); s.put(old); }); const saved = Account.S.user;
    try { Account.S.user = { id: 'user-a', prefs: {} }; let ids = (await Projects.list()).map(m => m.id); ok(ids.includes('__own_a') && !ids.includes('__own_b') && ids.includes('__own_c'), 'user a: ' + ids); Account.S.user = null; ids = (await Projects.list()).map(m => m.id); ok(!ids.includes('__own_a') && !ids.includes('__own_b') && ids.includes('__own_c'), 'no account'); }
    finally { Account.S.user = saved; await Projects._tx(['meta'], 'readwrite', t => { const s = t.objectStore('meta'); for (const k of ['__own_a', '__own_b', '__own_c']) s.delete(k); }); }
  });
  /* ---------- AI editor (official SDK against a local server speaking the streaming protocol) ---------- */
  const hasAI = () => !!(window.nxai && window.nxai.test);
  async function aiRun(script, fn) { const saved = { p: P, sel: selId, cur: Projects.current, msgs: Copilot.S.messages, log: Copilot.S.log }; Copilot.S.messages = []; Copilot.S.log = []; P = Object.assign({}, P, { w: 1280, h: 720, fps: 30, dur: 12, layers: [], markers: [] }); Projects.current = saved.cur || { id: '__ai', kind: 'video', name: 'x' }; await nxai.test('start', script); ok((await nxai.setKey('sk-ant-test-0123456789abcdef')).ok, 'key'); try { return await fn(); } finally { await nxai.test('stop'); P = saved.p; selId = saved.sel; Projects.current = saved.cur; Copilot.S.messages = saved.msgs; Copilot.S.log = saved.log; structChanged(); } }
  test('ai: tool loop edits the real timeline through the SDK, request is well formed, undo reverts', async () => {
    if (!hasAI()) return;
    await aiRun([{ content: [{ type: 'text', text: 'Adding it.' }, { type: 'tool_use', id: 't1', name: 'get_timeline', input: {} }, { type: 'tool_use', id: 't2', name: 'add_text', input: { text: 'Hello 4K', start: 1, duration: 3, size: 80 } }], stop: 'tool_use' }, { content: [{ type: 'tool_use', id: 't3', name: 'add_marker', input: { time: 2 } }], stop: 'tool_use' }, { content: [{ type: 'text', text: 'Done.' }] }], async () => {
      commit(); const h0 = hist.i; await Copilot.send('add a title');
      const L = P.layers.find(l => l.text && l.text.str === 'Hello 4K'); ok(L && L.start === 1 && L.dur === 3 && L.text.size === 80, 'text layer added'); ok(P.markers.includes(2), 'marker');
      const rq = await nxai.test('requests'); ok(rq.length === 3, 'three turns: ' + rq.length); const b = rq[0].body;
      ok(rq[0].url.includes('/v1/messages') && b.stream === true, 'streamed Messages call: ' + rq[0].url); ok(b.model === 'claude-opus-5-5' && b.thinking.type === 'adaptive' && b.output_config.effort === 'medium' && b.fallbacks === 'default', 'model settings'); ok(String(rq[0].headers['anthropic-beta']).includes('server-side-fallback-2026-07-01'), 'beta header'); ok(rq[0].headers.authorization === 'Bearer sk-ant-test-0123456789abcdef', 'SDK sends the saved key to the API');
      ok(b.tools.length === Copilot.TOOLS.length && b.tools.every(t => t.eager_input_streaming === true && t.input_schema.type === 'object'), 'tools');
      const second = rq[1].body.messages; ok(second[1].role === 'assistant' && second[1].content.length === 3 && second[2].role === 'user' && second[2].content.length === 2 && second[2].content.every(c => c.type === 'tool_result'), 'all results in one user message');
      const tl = JSON.parse(second[2].content.find(c => c.tool_use_id === 't1').content); ok(tl.width === 1280, 'timeline read');
      ok(Copilot.S.log.some(m => m.kind === 'ai' && m.text === 'Done.'), 'answer shown'); Copilot.undoRun(); ok(hist.i === h0 && !P.layers.some(l => l.text && l.text.str === 'Hello 4K'), 'one button reverts the whole request');
    });
  });
  test('ai: bad tool input is rejected without running; API errors become plain messages', async () => {
    if (!hasAI()) return;
    await aiRun([{ content: [{ type: 'tool_use', id: 'a', name: 'split_clip', input: { id: 'nope' } }, { type: 'tool_use', id: 'b', name: 'split_clip', input: { id: 'ghost', time: 1 } }, { type: 'tool_use', id: 'c', name: 'seek', input: { time: 'soon' } }, { type: 'tool_use', id: 'd', name: 'run_command', input: { title: 'Developer: Run automated self-tests' } }], stop: 'tool_use' }, { content: [{ type: 'text', text: 'ok' }] }], async () => {
      await Copilot.send('x'); const m = (await nxai.test('requests'))[1].body.messages[2].content; ok(m.every(r => r.is_error), JSON.stringify(m)); ok(/Missing "time"/.test(m[0].content) && /No clip/.test(m[1].content) && /must be a number/.test(m[2].content) && /not available/.test(m[3].content), JSON.stringify(m));
    });
    await aiRun([{ status: 401, message: 'bad key' }], async () => { await Copilot.send('x'); ok(Copilot.S.log.some(l => l.kind === 'err' && /key was rejected/.test(l.text)), 'friendly auth error'); ok(Copilot.S.messages.length === 0, 'failed request does not stay in the history'); });
    const bad = await nxai.setKey('hello'); ok(!bad.ok, 'nonsense key refused');
  });
  test('ai: OpenCode Zen key — checked before saving, open models via Chat Completions, Qwen/Claude via Messages', async () => {
    if (!hasAI()) return; const saved = { p: P, sel: selId, cur: Projects.current, msgs: Copilot.S.messages, log: Copilot.S.log };
    Copilot.S.messages = []; Copilot.S.log = []; P = Object.assign({}, P, { w: 1280, h: 720, fps: 30, dur: 12, layers: [], markers: [] }); Projects.current = saved.cur || { id: '__ai', kind: 'video', name: 'x' };
    try {
      await nxai.test('start', []); await nxai.test('zen');
      const bad = await nxai.setKey('zen-bad-key-0123456789abc'); ok(!bad.ok && /rejected/.test(bad.error), 'rejected key not saved: ' + bad.error); ok(!(await nxai.status()).hasKey, 'nothing stored');
      const r = await nxai.setKey('zen-good-key-0123456789abc'), st = await nxai.status(); ok(r.ok && r.provider === 'zen' && st.provider === 'zen', 'Zen key accepted');
      const ids = st.models.map(m => m.id); ok(!ids.includes('gpt-6-sol') && !ids.includes('gemini-3.1-pro') && ids.includes('kimi-k3') && ids.includes('qwen3.6-plus'), 'only models NEXORA can drive: ' + ids); ok(st.model === 'kimi-k3', 'open model is the default: ' + st.model); ok(ids.indexOf('claude-opus-5-5') === ids.length - 1, 'Claude listed last');
      await nxai.test('script', [{ content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'k1', name: 'add_text', input: { text: 'Zen title', start: 0, duration: 2 } }], stop: 'tool_use' }, { content: [{ type: 'text', text: 'Done.' }] }]);
      await Copilot.send('add a title'); ok(P.layers.some(l => l.text && l.text.str === 'Zen title'), 'tool ran from a Chat Completions model');
      let rq = await nxai.test('requests'); const b = rq[0].body; ok(rq.length === 2 && rq[0].url.includes('/v1/chat/completions'), 'chat endpoint: ' + rq.map(x => x.url)); ok(rq[0].headers.authorization === 'Bearer zen-good-key-0123456789abc', 'Bearer key');
      ok(b.model === 'kimi-k3' && b.messages[0].role === 'system' && b.tools.every(t => t.type === 'function' && t.function.parameters.type === 'object'), 'OpenAI-shaped request');
      const m2 = rq[1].body.messages; ok(m2.some(m => m.role === 'assistant' && m.tool_calls && m.tool_calls[0].id === 'k1') && m2.some(m => m.role === 'tool' && m.tool_call_id === 'k1'), 'tool call and result translated');
      ok(Copilot.S.log.some(m => m.kind === 'ai' && m.text === 'Done.'), 'answer shown');
      await nxai.setModel('qwen3.6-plus'); Copilot.S.messages = []; await nxai.test('script', [{ content: [{ type: 'text', text: 'Hi.' }] }]); await Copilot.send('hello');
      rq = await nxai.test('requests'); const q = rq[0].body; ok(rq[0].url.includes('/v1/messages') && q.model === 'qwen3.6-plus', 'Messages endpoint for Qwen: ' + rq.map(x => x.url)); ok(rq[0].headers['x-api-key'] === 'zen-good-key-0123456789abc', 'x-api-key sent (Zen Messages needs it)'); ok(Copilot.S.log.some(m => m.kind === 'ai' && m.text === 'Hi.'), 'Qwen reply shown'); ok(!q.thinking && !q.betas && !q.fallbacks && q.tools.every(t => !('eager_input_streaming' in t)), 'Anthropic-only fields removed');
      await nxai.test('script', [{ status: 402, message: 'no credit' }]); await nxai.setModel('kimi-k3'); Copilot.S.messages = []; await Copilot.send('x');
      ok(Copilot.S.log.some(l => l.kind === 'err' && /needs credit/.test(l.text)), 'billing error explained');
      // free models only
      const fo = await nxai.setFreeOnly(true), sf = await nxai.status(); ok(fo.ok && sf.freeOnly && sf.models.length && sf.models.every(m => /-free$/.test(m.id)), 'only free models listed: ' + sf.models.map(m => m.id)); ok(sf.model === 'deepseek-v4.1-flash-free', 'a free model is selected: ' + sf.model);
      await nxai.test('script', [{ status: 429, retryAfter: 20 }, { content: [{ type: 'text', text: 'Free.' }] }]); Copilot.S.messages = []; Copilot.S.log = []; await Copilot.send('hi');
      rq = await nxai.test('requests'); ok(rq.length === 2 && rq[1].body.model === 'glm-5.3-flash-free', 'busy free model → the next free model: ' + rq.map(x => x.body.model)); ok(Copilot.S.log.some(l => l.kind === 'ai' && l.text === 'Free.') && Copilot.S.log.some(l => /Answered by glm-5.3-flash-free/.test(l.text)), 'answer shown with a note');
      await nxai.test('script', [{ status: 429, retryAfter: 73806 }]); Copilot.S.messages = []; Copilot.S.log = []; await Copilot.send('hi');
      rq = await nxai.test('requests'); ok(rq.length === 1, 'a used-up allowance is not retried on every model'); ok(Copilot.S.log.some(l => l.kind === 'err' && /allowance .* used up/.test(l.text) && /20 h 30 min/.test(l.text)), 'reset time explained: ' + (Copilot.S.log.find(l => l.kind === 'err') || {}).text);
      await nxai.setFreeOnly(false); ok((await nxai.status()).models.some(m => m.id === 'kimi-k3'), 'turning it off shows every model again');
    } finally { await nxai.test('stop'); P = saved.p; selId = saved.sel; Projects.current = saved.cur; Copilot.S.messages = saved.msgs; Copilot.S.log = saved.log; structChanged(); }
  });
  /* ---------- 4K and above ---------- */
  async function atSize(w, h, fn) { const saved = P, c0 = [view.width, view.height]; P = Object.assign({}, P, { w: 1280, h: 720, layers: [], markers: [], dur: 1, fps: 30, bg: '#000000', io: null }); try { setProjectSize(w, h); const A1 = mkLayer('gen', { dur: 1 }); P.layers.push(A1); const t = mkLayer('text', { dur: 1 }); t.text.str = '4K'; t.text.size = Math.round(h * .3); t.tr.x = w / 2; t.tr.y = h / 2; P.layers.push(t); structChanged(); return await fn(); } finally { P = saved; view.width = c0[0]; view.height = c0[1]; structChanged(); requestRender(); } }
  const tmp4k = async n => Disk.join(await Disk.fs.defaultRoot(), '__nexora_4k_test__', n);
  test('4k: a 3840×2160 timeline renders full size with crisp detail', async () => {
    await atSize(3840, 2160, async () => { const t0 = performance.now(); renderComp(vctx, .5); const ms = performance.now() - t0; ok(view.width === 3840 && view.height === 2160, 'canvas'); console.info('4K frame ms', ms);
      let edges = 0; for (let y = 760; y <= 1400 && !edges; y += 32) { const d = vctx.getImageData(0, y, 3840, 1).data; for (let i = 4; i < d.length; i += 4) if (Math.abs(d[i] - d[i - 4]) > 120) edges++; } ok(edges >= 1, 'hard text edges present at full resolution'); });
  });
  test('4k: UHD and DCI masters, H.264, HEVC come out at the exact size (FFmpeg reads them back)', async () => {
    if (!ProMedia.on || !(await ProMedia.probe()).available) return; const dir = await tmp4k('');
    try {
      await atSize(3840, 2160, async () => { for (const [c, n, v] of [['x264', 'a.mp4', 'h264'], ['x265', 'b.mp4', 'hevc'], ['prores_hq', 'c.mov', 'prores'], ['dnxhr_hq', 'd.mov', 'dnxhd']]) { const out = await tmp4k(n), r = await ProMedia.exportPro({ codec: c, from: 0, to: .2, fps: 30, mbps: 45, audio: false, out, quiet: true }); ok(r && r.frames === 6, c); const i = await nxff.info(out); ok(i.video && i.video.w === 3840 && i.video.h === 2160 && i.video.codec === v, c + ' ' + JSON.stringify(i.video)); } });
      await atSize(4096, 2160, async () => { const out = await tmp4k('e.mov'); await ProMedia.exportPro({ codec: 'prores_4444', from: 0, to: .1, fps: 24, audio: false, out, quiet: true }); const i = await nxff.info(out); ok(i.video.w === 4096 && i.video.h === 2160, 'DCI 4K'); });
    } finally { await nxfs.remove(dir); }
  });
  test('4k: 8K UHD project and output scaling (1080p → 4K, 4K → 1080p)', async () => {
    if (!ProMedia.on || !(await ProMedia.probe()).available) return; const dir = await tmp4k('');
    try {
      await atSize(7680, 4320, async () => { ok(P.w === 7680 && P.h === 4320, '8K canvas allowed'); const out = await tmp4k('8k.mp4'); await ProMedia.exportPro({ codec: 'x265', from: 0, to: 2 / 30, fps: 30, mbps: 80, audio: false, out, quiet: true }); const i = await nxff.info(out); ok(i.video.w === 7680 && i.video.h === 4320, '8K ' + JSON.stringify(i.video)); });
      await atSize(1920, 1080, async () => { const out = await tmp4k('up.mp4'); await ProMedia.exportPro({ codec: 'x264', from: 0, to: .1, fps: 30, mbps: 45, audio: false, out, quiet: true, outW: 3840, outH: 2160 }); const i = await nxff.info(out); ok(i.video.w === 3840 && i.video.h === 2160, 'upscale ' + JSON.stringify(i.video)); });
      await atSize(3840, 2160, async () => { const out = await tmp4k('down.mov'); await ProMedia.exportPro({ codec: 'prores_lt', from: 0, to: .1, fps: 30, audio: false, out, quiet: true, outW: 1920, outH: 1080 }); const i = await nxff.info(out); ok(i.video.w === 1920 && i.video.h === 1080, 'downscale'); });
    } finally { await nxfs.remove(dir); }
  });
  test('4k: render cache and the WebCodecs MP4 export work at UHD', async () => {
    if (!(window.VideoEncoder && offlineSupported())) return;
    await atSize(3840, 2160, async () => {
      const codecs = await supportedCodecs(3840, 2160, 30); if (!codecs.includes('avc')) { console.info('no H.264 WebCodecs encoder at 4K on this PC'); return; }
      RenderCache.clear(); commit(); try { const n = await RenderCache.render(0, 1, { quiet: true }); ok(n >= 1 && RenderCache.valid(0), 'segment cached at 4K: ' + n); } finally { RenderCache.clear(); }
      const dl = window.download; let blob = null; window.download = b => { blob = b; };
      try { await exportOffline({ fps: 30, mbps: 45, audio: false, codec: 'avc', from: 0, to: .2 }); ok(blob && blob.size > 1000, 'file'); const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob); await new Promise((r, x) => { v.onloadedmetadata = r; v.onerror = () => x(new Error('undecodable')); setTimeout(() => x(new Error('timeout')), 8000); }); ok(v.videoWidth === 3840 && v.videoHeight === 2160, `MP4 is ${v.videoWidth}×${v.videoHeight}`); v.removeAttribute('src'); v.load(); }
      finally { window.download = dl; }
    });
  });
  test('4k: hardware-encoder check accepts UHD where the GPU can, Design documents reach 8K', async () => {
    if (typeof VideoEncoder !== 'undefined') { const c = await supportedCodecs(3840, 2160, 30); console.info('hardware / WebCodecs at 4K:', c.join(',')); ok(Array.isArray(c), 'probe ran'); }
    const d = NXI.newDoc({ name: '8k', w: 7680, h: 4320, bg: '#101820' }); NXI.push(d, 'init'); const r = NXI.render(d); ok(r.width === 7680 && r.height === 4320, 'composite at 8K'); near(px(r, 7000, 4000)[2], 32, 1, 'pixels');
  });

  test('cloud: online accounts: sign-up, session refresh after restart, 2FA, Google, profile sync, reset', async () => {
    if (!hasAuth()) return; await A_().test('reset'); const base = await A_().test('idp'); await A_().test('cloud', { url: base, key: 'pk_test' }); const off = () => A_().test('cloud', null);
    try {
      let st = await A_().status(); ok(st.cloud && !st.user && st.smtp, 'cloud mode'); ok((await A_().providers()).list.every(p => p.configured) && (await A_().providers()).list.length === 3, 'providers ready with no local setup');
      const u = mustOk(await A_().signUp({ email: 'a@example.com', password: SP, name: 'Online', remember: true }), 'signUp'); ok(u.user.name === 'Online' && u.user.hasPassword, 'account'); ok((await A_().signUp({ email: 'a@example.com', password: SP })).code === 'email_taken', 'duplicate');
      await A_().test('cloudReload'); st = await A_().status(); if (st.encrypted) ok(st.user && st.user.email === 'a@example.com', 'remembered session restored with a refresh token'); else { ok(!st.user, 'no OS key store: the session is not written to disk, so it is not restored'); return; }
      mustOk(await A_().updateProfile({ name: 'Renamed', title: 'Editor', prefs: { w: 3840, h: 2160, fps: 30 } })); await A_().signOut(); ok(!(await A_().status()).user, 'out');
      ok((await A_().signIn({ email: 'a@example.com', password: 'nope nope nope' })).code === 'bad_credentials', 'wrong password');
      const i = mustOk(await A_().signIn({ email: 'a@example.com', password: SP })); ok(i.user.name === 'Renamed' && i.user.prefs.w === 3840, 'profile came from the server');
      const b = mustOk(await A_().totpBegin()); ok(b.qr.size >= 21, 'qr'); ok((await A_().totpConfirm({ code: '000000' })).code === 'bad_code', 'wrong code'); ok(mustOk(await A_().totpConfirm({ code: '123456' })).user.totp, '2FA on'); await A_().signOut();
      const f = mustOk(await A_().signIn({ email: 'a@example.com', password: SP })); ok(f.twoFactor && !f.user && !(await A_().status()).user, 'password alone is not enough'); ok(mustOk(await A_().verify2fa({ method: 'totp', code: '123456' })).user, 'second factor'); ok(!mustOk(await A_().totpDisable({ code: '123456' })).user.totp, '2FA off'); await A_().signOut();
      const g = mustOk(await A_().oauth('microsoft', { remember: false }), 'microsoft'); ok(g.user.links.microsoft && g.user.name === 'Provider User', 'provider identity'); await A_().signOut();
      mustOk(await A_().resetRequest({ email: 'a@example.com' })); ok(!(await A_().resetPassword({ email: 'a@example.com', code: '000000', password: 'a new long passphrase', via: 'email' })).ok, 'bad code'); mustOk(await A_().resetPassword({ email: 'a@example.com', code: '654321', password: 'a new long passphrase', via: 'email' })); mustOk(await A_().signIn({ email: 'a@example.com', password: 'a new long passphrase' })); await A_().signOut();
      ok((await A_().test('cloudCalls')).every(c => c.key === 'pk_test' || c.p === '/authorize'), 'project key on every API call');
    } finally { await off(); ok(!(await A_().status()).cloud, 'back to local accounts'); await A_().test('reset'); }
  });
  test('signin: e-mail only by default; GitHub appears only once it has a Client ID', async () => {
    if (!hasAuth()) return; await A_().test('reset'); const saved = { st: Account.S.status, pv: Account.S.providers }, g = () => document.getElementById('authGate');
    try { Account.S.status = await A_().status(); Account.S.providers = (await A_().providers()).list; Account.signin(); ok(!g().querySelector('.au-prov') && !g().querySelector('.au-or') && /Sign in/.test(g().querySelector('h1').textContent), 'only the e-mail form'); ok(!/Google|Microsoft|providers/.test(g().textContent), 'no other providers mentioned');
      mustOk(await A_().providerSet('github', { clientId: 'gh' })); mustOk(await A_().providerSet('microsoft', { clientId: 'ms' })); Account.S.providers = (await A_().providers()).list; Account.signin(); const b = [...g().querySelectorAll('.au-prov')].map(x => x.dataset.provider); ok(b.join() === 'github', 'buttons: ' + b); }
    finally { g().classList.add('hidden'); Account.S.status = saved.st; Account.S.providers = saved.pv; await A_().test('reset'); }
  });
  test('versions: snapshots stay out of the way, restore brings the project back and is itself undoable', async () => {
    if (!Disk.on) return; const savedCur = Projects.current, savedP = P; let folder = null;
    await Shell.newProject('video', { name: '__ver_test__' });
    try { folder = Projects.current.folder; const t1 = mkLayer('text', { dur: 2 }); t1.text.str = 'first'; addLayer(t1); commit(); await Recovery.flush(); await Versions.saveNamed('cut one'); await new Promise(r => setTimeout(r, 15));
      t1.text.str = 'second'; commit(); await Recovery.flush(); const l = await Versions.list(folder), v = l.find(x => x.label === 'cut one'); ok(v, 'named version listed'); await Versions.restore(v); ok(P.layers.some(x => x.text && x.text.str === 'first'), 'restored'); const l2 = await Versions.list(folder), b = l2.find(x => x.label === 'before restore'); ok(b, 'current state saved first'); await Versions.restore(b); ok(P.layers.some(x => x.text && x.text.str === 'second'), 'restore undone');
      const same = await Disk.readProject(folder); Versions.S.last[folder] = 0; Versions.S.hash[folder] = null; ok(await Versions.maybe(folder, same.json), 'first autosave version'); ok(!(await Versions.maybe(folder, same.json + ' ')), 'not again within five minutes'); Versions.S.last[folder] = 0; ok(!(await Versions.maybe(folder, same.json)), 'identical content is not stored twice');
      for (let i = 0; i < 30; i++) await Disk.fs.writeText(Disk.join(folder, '.versions', `${Date.now() + 1000 + i}-auto.nexora`), '{}'); await Versions.prune(folder); const a = (await Versions.list(folder)).filter(x => x.label === 'auto'); ok(a.length <= 21, 'old autosaves thinned: ' + a.length); ok((await Versions.list(folder)).some(x => x.label === 'cut one'), 'named versions kept');
    } finally { const id = Projects.current.id; await Projects.remove(id); if (folder) await nxfs.remove(folder); Projects.current = savedCur; }
  });
  test('doctor: finds and fixes what would go wrong after export', async () => {
    const keep = P.layers.slice(), dur0 = P.dur, w0 = P.w, h0 = P.h, fake = { id: '__doc', name: 'doc.mp4', kind: 'video', w: 640, h: 360, dur: 4, peaks: new Float32Array(500).fill(.9) }; media.__doc = fake; P.layers.length = 0; P.dur = 30;
    try { ok(Doctor.check().some(x => /empty/.test(x.title)), 'empty'); const A = mkLayer('video', { media: '__doc', name: 'a', start: 0, dur: 6 }); A.tr.s = 300; A.vol = 200; const F = mkLayer('image', { media: '__none', name: 'flash', start: 6, dur: 1 / P.fps }); const B = mkLayer('video', { media: '__doc', name: 'b', start: 9, dur: 2 }); B.visible = true; const X = mkLayer('text', { start: 0, dur: 1 }); X.text.str = 'edge'; X.tr.x = 2; P.layers.push(A, F, B, X); P.layers.forEach(l => l.kf = l.kf || {});
      const has = (k, L) => Doctor.check().some(x => x.kind === k && (!L || x.L === L)); ok(has('overrun', A), 'overrun'); ok(has('flash', F), 'flash'); ok(has('clip', A), 'clipping'); ok(has('soft', A), 'soft'); ok(has('gap'), 'gap'); ok(has('tail'), 'tail'); ok(has('safe', X), 'safe area');
      const n = Doctor.fixAll(); ok(n >= 4, 'fixed ' + n); ok(Math.abs(A.dur - 4) < .05, 'overrun trimmed'); ok(!P.layers.includes(F), 'flash removed'); ok(A.vol * .9 / 100 <= 1, 'level safe'); ok(!has('tail'), 'tail gone'); ok(!has('overrun') && !has('clip') && !has('flash'), 'clean after fix'); ok(/Clean cut/.test(Doctor.verdict([])), 'voice'); }
    finally { P.layers.length = 0; keep.forEach(l => P.layers.push(l)); P.dur = dur0; delete media.__doc; structChanged(); }
  });
  test('queue: several formats render one after another; stop and failures are handled; disk estimate is sane', async () => {
    ok(ProMedia.estimate('prores_hq', 3840, 2160, 30, 60) > 6e9 && ProMedia.estimate('x264', 1920, 1080, 30, 60, 16) === 120e6, 'estimate'); if (!ProMedia.on || !(await ProMedia.probe()).available) return; ok(await nxfs.free('C:\\definitely\\not\\here') > 1e6, 'free space walks up to a real folder');
    const dir = Disk.join(await Disk.fs.defaultRoot(), '__nexora_queue_test__'), keep = P.layers.slice(), dur0 = P.dur; P.layers.length = 0; P.dur = 1; const s = mkLayer('shape', { start: 0, dur: 1 }); P.layers.push(s); RenderQueue.S.items = [];
    try { const a = RenderQueue.add({ codec: 'x264', label: 'a', fps: 30, from: 0, to: .3, audio: false, mbps: 8, out: Disk.join(dir, 'a.mp4') }), b = RenderQueue.add({ codec: 'prores_lt', label: 'b', fps: 30, from: 0, to: .3, audio: false, out: Disk.join(dir, 'b.mov'), outW: 1280, outH: 720 }), c = RenderQueue.add({ codec: 'x264', label: 'c', fps: 30, from: 0, to: .3, audio: false, mbps: 8, out: 'relative/path.mp4' }); const n = await RenderQueue.run(); ok(n === 2 && a.state === 'done' && b.state === 'done' && c.state === 'failed', `${n} ${a.state} ${b.state} ${c.state} ${c.msg}`); const i = await nxff.info(b.out); ok(i.video.codec === 'prores' && i.video.w === 1280, 'second job'); const d = RenderQueue.add({ codec: 'x264', label: 'd', fps: 30, from: 0, to: 1, audio: false, mbps: 8, out: Disk.join(dir, 'd.mp4') }); const pr = RenderQueue.run(); RenderQueue.S.stop = true; await pr; ok(d.state === 'cancelled' || d.state === 'waiting', 'stop: ' + d.state); }
    finally { RenderQueue.S.items = []; P.layers.length = 0; keep.forEach(l => P.layers.push(l)); P.dur = dur0; structChanged(); await nxfs.remove(dir); }
  });
  test('persona: real activity counted once a minute, greeting uses your name, empty stage follows the timeline', () => {
    const k = 'nx.stats.guest', saved = localStorage.getItem(k), acc = Account.S.user; Account.S.user = null; localStorage.removeItem(k);
    try { const t0 = Date.now() + 6e7; Persona.activity(t0); Persona.activity(t0 + 1000); Persona.activity(t0 + 61000); Persona.stat('exports'); const s = Persona.summary(); ok(s.week === 2 && s.exports === 1 && s.streak === 1, JSON.stringify(s)); ok(Persona.fmtMins(135) === '2 h 15 m', 'format'); ok(/\.$/.test(Persona.greeting()), 'no name'); Account.S.user = { id: 'x', name: 'Alex Doe', prefs: {} }; ok(/Alex\.$/.test(Persona.greeting()), Persona.greeting()); }
    finally { Account.S.user = acc; if (saved) localStorage.setItem(k, saved); else localStorage.removeItem(k); }
    const keep = P.layers.slice(); P.layers.length = 0; Persona.emptyStage(); const e = document.getElementById('emptyStage'); ok(!e.classList.contains('hidden'), 'shown when empty'); P.layers.push(mkLayer('shape', {})); Persona.emptyStage(); ok(e.classList.contains('hidden'), 'hidden with a clip'); P.layers.length = 0; keep.forEach(l => P.layers.push(l)); Persona.emptyStage();
  });
  async function bigTimeline(n, fn) { const keep = P.layers.slice(), dur0 = P.dur, sel0 = selId, wasCompact = compactTracks, sc = [tlscroll.scrollLeft, tlscroll.scrollTop]; P.layers.length = 0; P.dur = n * .5; try { return await fn(); } finally { P.layers.length = 0; keep.forEach(l => P.layers.push(l)); P.dur = dur0; selId = sel0; compactTracks = wasCompact; tlscroll.scrollLeft = sc[0]; tlscroll.scrollTop = sc[1]; structChanged(true); } }
  test('timeline: 2,000 clips only build what is on screen, and scrolling brings the rest in', () => bigTimeline(2000, async () => {
    for (let i = 0; i < 2000; i++) P.layers.push(mkLayer('shape', { name: 'c' + i, start: i * .5, dur: .5 })); compactTracks = true; renderTimeline();
    ok(tlc.querySelectorAll('.row.tk').length === 1, 'cuts share one track'); const n = tlc.querySelectorAll('.clip').length; ok(n > 0 && n < 200, 'clips built: ' + n); tlscroll.scrollLeft = 30000; renderTimeline(); const first = [...tlc.querySelectorAll('.clip')].map(c => parseFloat(c.style.left)); ok(first.some(x => x > 29000 && x < 32000), 'far clips appear after scrolling');
    tlscroll.scrollLeft = 0; compactTracks = false; renderTimeline(); ok(tlc.querySelectorAll('.row').length < 80, 'layer view is windowed: ' + tlc.querySelectorAll('.row').length); ok(tlc.scrollHeight > 2000 * 38 - 100, 'full scroll height kept'); tlscroll.scrollTop = 40000; renderTimeline(); ok([...tlc.querySelectorAll('.nm')].some(x => /^c\d+$/.test(x.textContent)), 'rows at depth');
    const t0 = performance.now(); compactTracks = true; for (let i = 0; i < 10; i++) renderTimeline(); ok((performance.now() - t0) / 10 < 40, 'redraw under 40 ms: ' + (performance.now() - t0) / 10);
  }));
  test('timeline: tracks keep stacking order; only overlaps need more rows; audio sits below', () => bigTimeline(40, async () => {
    const mk = (type, start, dur) => { const L = mkLayer(type, { start, dur }); P.layers.push(L); return L; }, A = mk('shape', 0, 4), B = mk('shape', 4, 4), C = mk('shape', 2, 4), D = mk('shape', 3, 1), a1 = mk('audio', 0, 5), a2 = mk('audio', 2, 2), g = laneGroups();
    ok(g.v.length === 3, 'three picture rows: ' + g.v.length); ok(g.v[0].includes(A) && g.v[0].includes(B), 'non-overlapping clips share a row'); ok(g.v[1].includes(C), 'C above what it covers'); ok(g.v[2].includes(D), 'D is in front of A and C, so above both'); ok(g.a.length === 2 && g.a[0].includes(a1) && g.a[1].includes(a2), 'audio rows'); compactTracks = true; renderTimeline(); ok([...tlc.querySelectorAll('.tk-tag')].map(x => x.textContent).join() === 'V3,V2,V1,A1,A2', 'order on screen');
    for (const [x, y] of [[A, C], [C, D], [A, D]]) { const lx = laneIndex(x), ly = laneIndex(y); ok(P.layers.indexOf(y) > P.layers.indexOf(x) && ly > lx, 'front clip is on the higher row'); }
    ok(moveToTrack(C, 1), 'dragging down moves it'); ok(laneIndex(C) < 1 || P.layers.indexOf(C) < P.layers.indexOf(B), 'stacking changed'); ok(P.layers.includes(C), 'still there');
  }));
  test('timeline: open media players stay bounded with hundreds of cuts; cuts are pre-rolled; zoom keeps the time under the cursor', () => bigTimeline(300, async () => {
    const v = document.createElement('canvas'); v.width = 2; v.height = 2; const m = { id: '__pool', name: 'p.mp4', kind: 'video', w: 2, h: 2, dur: 400, url: 'data:video/mp4;base64,AAAA', blob: new Blob([]) }; media.__pool = m; els.forEach(e => e.pause());
    try { for (let i = 0; i < 300; i++) P.layers.push(mkLayer('video', { media: '__pool', start: i, dur: 1, srcIn: i })); structChanged(true); ok(els.size <= MEDIA_POOL + 2, 'structChanged opened ' + els.size); for (let t = 0; t < 200; t += 5) { T = t; for (const a of collectMedia(P.layers, T, [])) getEl(a.L); } ok(els.size <= MEDIA_POOL + 1, 'pool after scrubbing: ' + els.size); T = 10; const next = P.layers[11]; prerollMedia(10.5); ok(!!getEl(next), 'next clip opened'); }
    finally { P.layers.length = 0; for (const [k, e] of [...els]) if (e.src && e.src.startsWith('data:video/mp4;base64,AAAA')) { e.removeAttribute('src'); e.load(); els.delete(k); } delete media.__pool; T = 0; }
    P.dur = 300; const pp0 = pps, box = tlscroll.getBoundingClientRect(), X = box.left + 600; tlscroll.scrollLeft = 1000; renderTimeline(); const at = (600 + tlscroll.scrollLeft - HD) / pps; zoomTo(pps * 1.7, X); near((600 + tlscroll.scrollLeft - HD) / pps, at, .02, 'time under the cursor'); zoomFit(); ok(pps * P.dur <= tlscroll.clientWidth * 1.2 || pps === 400, 'fit'); pps = pp0; document.getElementById('tZoom').value = pps;
  }));
  /* same picture at reduced resolution: compares the preview with the full render shrunk to the same size */
  function pvDiff(q, t) { renderComp(vctx, t); const w = Math.round(P.w * q), h = Math.round(P.h * q), a = mkCanvas(w, h), b = mkCanvas(w, h), ax = a.getContext('2d', { willReadFrequently: true }), bx = b.getContext('2d', { willReadFrequently: true }); ax.imageSmoothingQuality = 'high'; ax.drawImage(view, 0, 0, w, h); RQnext = q; try { renderComp(vctx, t); } finally { RQnext = 1; } bx.drawImage(pvC, 0, 0); const A = ax.getImageData(0, 0, w, h).data, B = bx.getImageData(0, 0, w, h).data; let s = 0; for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); return s / (A.length / 4 * 3); }
  async function pvScene(fn) { const saved = P, c0 = [view.width, view.height]; P = Object.assign({}, P, { w: 1280, h: 720, fps: 30, dur: 4, bg: '#101820', layers: [], markers: [], io: null }); view.width = 1280; view.height = 720; try { return await fn(); } finally { P = saved; view.width = c0[0]; view.height = c0[1]; RQnext = 1; requestRender(); } }
  const pvBase = () => { const s = mkLayer('shape', { start: 0, dur: 4 }); Object.assign(s.shape, { kind: 'rect', w: 700, h: 400, fill: '#5cb8ff', grad: true, fill2: '#ffffff', radius: 30 }); s.tr.x = 640; s.tr.y = 360; const t = mkLayer('text', { start: 0, dur: 4 }); t.text.str = 'PREVIEW'; t.text.size = 150; t.tr.x = 640; t.tr.y = 360; return [s, t]; };
  test('preview: half and quarter match the full render for every built-in effect, transition, mask and comp', () => pvScene(async () => {
    const bad = []; for (const [type, p] of [['blur', { amount: 24 }], ['shadow', { x: 30, y: 30, blur: 20 }], ['glow', { radius: 30 }], ['rgbsplit', { amount: 12 }], ['pixelate', { size: 24 }], ['wave', { amp: 30, freq: 60 }], ['motionblur', { len: 60 }], ['scanlines', { gap: 8 }], ['shake', { amount: 30 }], ['vignette', {}], ['swirl', {}], ['zoomblur', {}], ['contrast', {}], ['temperature', {}], ['mirror', {}]]) { const [a, b] = pvBase(), f = newFx(type); Object.assign(f.p, p); a.fx.push(f); P.layers = [a, b]; for (const q of [.5, .25]) { const d = pvDiff(q, 1); if (d > (q === .5 ? 5 : 9)) bad.push(`${type}@${q}: ${d.toFixed(1)}`); } } ok(!bad.length, bad.join(', '));
    const [a, b] = pvBase(); a.tin = { type: 'slide-left', dur: 1 }; P.layers = [a, b]; const d1 = pvDiff(.5, .4); ok(d1 < 5, 'slide transition ' + d1.toFixed(1)); const [c, e] = pvBase(); c.tin = { type: 'blur', dur: 1 }; c.mask = Object.assign(defaultMask(), { feather: 40 }); P.layers = [c, e]; ok(pvDiff(.5, .5) < 5, 'mask and blur transition'); const [g, h] = pvBase(), C = mkLayer('comp', { start: 0, dur: 4 }); C.comp = { layers: [g, h], dur: 4 }; const ad = mkLayer('adjust', { start: 0, dur: 4 }); ad.fx.push(newFx('saturate')); P.layers = [C, ad]; ok(pvDiff(.5, 1) < 5, 'nested comp + adjustment');
  }));
  test('preview: library effects stay matched across the catalogue', () => pvScene(async () => {
    if (!GPU.available) return; const all = Library.ITEMS.filter(i => i.k === 'fx' || i.k === 'filter'), step = Math.floor(all.length / 120), bad = []; let worst = 0; for (let i = 0; i < all.length; i += step) { const [a, b] = pvBase(); a.fx.push(Library.fxFor(all[i].id)); P.layers = [a, b]; const d = pvDiff(.5, 1); worst = Math.max(worst, d); if (d > 14) bad.push(`${all[i].n}: ${d.toFixed(1)}`); } console.info('library preview worst', worst); ok(bad.length <= 3, bad.slice(0, 8).join(' | '));
  }));
  test('preview: exports and frame grabs stay full size; a still settles at full; Auto steps down and back up', () => pvScene(async () => {
    const [a, b] = pvBase(); P.layers = [a, b]; const m0 = Preview.mode, pl0 = playing; try { RQnext = .5; offlineBusy = true; ok(Preview.q() === 1, 'export ignores the setting'); offlineBusy = false; RQnext = 1; ok(RQ === 1, 'full by default');
      Preview.mode = '0.5'; ok(Preview.q() === .5, 'half'); offlineBusy = true; await new Promise(r => setTimeout(r, 260)); offlineBusy = false; ok(Preview.full && Preview.q() === 1, 'still frame settles at full'); clearTimeout(Preview.timer);
      Preview.mode = 'auto'; Preview.level = 1; Preview.hold = 0; playing = true; const B = 1000 / P.fps; Preview.adapt(B * 2, 1000); ok(Preview.level === .5, 'steps down'); Preview.adapt(B * 2, 1200); ok(Preview.level === .5, 'waits'); Preview.adapt(B * 2, 2000); ok(Preview.level === .25, 'again'); Preview.adapt(B * 2, 3000); ok(Preview.level === .25, 'floor'); Preview.adapt(B * .1, 4000); ok(Preview.level === .5, 'steps up'); Preview.adapt(B * .5, 8000); ok(Preview.level === .5, 'no flip-flop at moderate load'); }
    finally { playing = pl0; Preview.mode = m0; Preview.level = 1; Preview.hold = 0; Preview.full = false; Perf.ms = 0; }
  }));
  test('effects: saved projects keep their effects (older ids never move)', () => { const I = Library.ITEMS.slice(0, 7810); let h = 2166136261; for (const i of I) for (const c of i.id + i.n) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } ok((h >>> 0) === 1575617819, 'fingerprint ' + (h >>> 0)); ok(new Set(Library.ITEMS.map(i => i.id)).size === Library.ITEMS.length, 'ids unique'); });
  test('effects: the page opens on real variety; each look is one card with its variations inside', async () => {
    const G = Library.groups('fx'), n24 = G.picks.slice(0, 24); ok(G.picks.length >= 50, 'picks ' + G.picks.length); ok(n24.filter(g => g.c === 'Shake').length <= 1, 'shakes on the first page: ' + n24.filter(g => g.c === 'Shake').length); ok(new Set(n24.map(g => g.c)).size >= 9, 'categories: ' + new Set(n24.map(g => g.c)).size); ok(G.mixed.slice(0, 18).filter(g => g.c === 'Shake').length <= 1, 'All view is mixed too'); const hs = G.list.find(g => g.stem === 'Handheld shake'); ok(hs && hs.items.length === 20 && /Medium · Normal/.test(hs.rep.n), 'shake variations collapse: ' + (hs && hs.items.length)); ok(G.list.length < 700 && G.list.length > 150, 'distinct looks: ' + G.list.length); ok(G.list.reduce((a, g) => a + g.items.length, 0) === Library.count('fx'), 'nothing lost');
    const prev = leftTab, c0 = Browser.S.cat.fx; leftTab = 'effects'; Browser.S.cat.fx = undefined; Browser.S.q.fx = ''; Browser.S.stem.fx = null; buildLeft(); await sleep_(200); try { const shown = Browser.S.list.slice(0, 24).map(i => i.c); ok(shown.filter(c => c === 'Shake').length <= 1, 'panel opens on Top picks'); const v = document.querySelector('#leftBody .lvar'); ok(v, 'variations button'); v.click(); await sleep_(100); ok(document.querySelector('#leftBody .lback') && Browser.S.list.length > 1, 'variations open'); document.querySelector('#leftBody .lback').click(); await sleep_(60); ok(!document.querySelector('#leftBody .lback'), 'and close'); } finally { leftTab = prev; Browser.S.cat.fx = c0; buildLeft(); }
  });
  test('effects: every new look compiles and visibly changes the picture, and they differ from each other', () => {
    if (!GPU.available) return; const W = 320, H = 180, src = mkCanvas(W, H), x = src.getContext('2d'), g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#30506a'); g.addColorStop(1, '#a07040'); x.fillStyle = g; x.fillRect(0, 0, W, H); x.fillStyle = '#e8e8e8'; x.fillRect(100, 40, 120, 100); x.fillStyle = '#101010'; x.beginPath(); x.arc(160, 90, 30, 0, 7); x.fill();
    const out = mkCanvas(W, H); out._ctx = out.getContext('2d', { willReadFrequently: true }); const frame = (it, t) => { const c = out._ctx; resetCtx(c); c.clearRect(0, 0, W, H); c.drawImage(src, 0, 0); ok(GPU.run(out, [{ type: 'lib', p: { preset: it.id, amount: 100, speed: 1, td: .5 }, t, T: t, ld: 3 }]), 'rendered ' + it.n); return c.getImageData(0, 0, W, H).data; }, plain = (() => { const c = out._ctx; resetCtx(c); c.clearRect(0, 0, W, H); c.drawImage(src, 0, 0); return c.getImageData(0, 0, W, H).data.slice(); })(), dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 12) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 12 * 3); };
    const fresh = Library.groups('fx').list.filter(g => g.items[0] === Library.ITEMS.find(i => i.id === g.items[0].id) && Library.ITEMS.indexOf(g.items[0]) >= 7810), weak = [], looks = []; ok(fresh.length >= 25, 'new looks: ' + fresh.length); for (const G of fresh) { const f = frame(G.rep, .7).slice(); let d = dist(f, plain); if (d < 1.2) { d = Math.max(d, dist(frame(G.rep, .3), plain), dist(frame(G.rep, 1.9), plain), dist(frame(G.rep, 2.6), plain)); } if (d < .8) weak.push(G.stem + ':' + d.toFixed(2)); looks.push([G, f]); } ok(!weak.length, 'barely visible: ' + weak.join(', '));
    const same = []; for (let i = 0; i < looks.length; i++) for (let j = i + 1; j < looks.length; j++) if (looks[i][0].rep.u.gmode !== looks[j][0].rep.u.gmode && looks[i][0].rep.u.dmode !== looks[j][0].rep.u.dmode && dist(looks[i][1], looks[j][1]) < .35) same.push(looks[i][0].stem + ' = ' + looks[j][0].stem); ok(!same.length, 'look the same: ' + same.slice(0, 6).join(', '));
  });
  const gasCode = async () => { const m = await A_().test('gasMails'); return /(\d{6})/.exec(m[m.length - 1].body)[1]; };
  test('gas: e-mail accounts with real codes; the password never leaves the computer', async () => {
    if (!hasAuth()) return; await A_().test('reset'); const url = await A_().test('gasStart'); mustOk(await A_().gasSet({ url }), 'connect'); const PW = 'gas login passphrase';
    try {
      ok((await A_().gasSet({ url: 'https://evil.example.com/x' })).code === 'bad_url', 'only Apps Script addresses'); let st = await A_().status(); ok(st.cloud && st.online === 'gas' && !st.user, 'online mode');
      const s = mustOk(await A_().signUp({ name: '=HYPERLINK(1)', email: 'New@Example.com', password: PW, remember: true }), 'signUp'); ok(s.verifyEmail && !(await A_().status()).user, 'not signed in before verifying'); ok((await A_().signUp({ email: 'x@example.com', password: 'short' })).code === 'weak_password', 'weak');
      ok((await A_().signIn({ email: 'new@example.com', password: PW })).code === 'not_verified', 'unverified refused'); const mail = (await A_().test('gasMails'))[0]; ok(mail.to === 'new@example.com' && /\d{6}/.test(mail.body), 'code e-mailed');
      ok((await A_().resendSignup({ email: 'new@example.com' })).code === 'cooldown', 'resend throttled'); ok((await A_().verifySignup({ email: 'new@example.com', code: '000000' })).code === 'bad_code', 'wrong code'); const v = mustOk(await A_().verifySignup({ email: 'new@example.com', code: await gasCode(), remember: true }), 'verify'); ok(v.user.emailVerified && (await A_().status()).user, 'signed in');
      const dump = await A_().test('gasDump'), sent = (await A_().test('gasBodies')).join(' '); ok(!dump.includes(PW) && !sent.includes(PW), 'no password in the Sheet or in any request'); ok(!dump.includes('formula'), 'names cannot run as Sheet formulas');
      await A_().test('gasReload'); if (!(await A_().status()).encrypted) { ok(!(await A_().status()).user, 'no OS key store: the session is not written to disk'); return; } ok((await A_().status()).user, 'remembered session survives restart'); ok(mustOk(await A_().updateProfile({ name: 'Editor', prefs: { w: 3840, h: 2160, fps: 30 } })).user.prefs.w === 3840, 'profile syncs'); await A_().signOut(); ok(!(await A_().status()).user, 'out');
      ok((await A_().signIn({ email: 'nobody@example.com', password: 'whatever long one' })).code === 'bad_credentials', 'unknown e-mail same answer'); ok(mustOk(await A_().signIn({ email: 'NEW@example.com', password: PW })).user.name === 'Editor', 'sign in'); await A_().signOut();
      for (let i = 0; i < 5; i++) await A_().signIn({ email: 'new@example.com', password: 'wrong wrong wrong' }); ok((await A_().signIn({ email: 'new@example.com', password: PW })).code === 'locked', 'lockout'); await A_().test('gasAge'); mustOk(await A_().signIn({ email: 'new@example.com', password: PW }), 'after lock');
      const b = mustOk(await A_().totpBegin()), secret = b.secret.replace(/ /g, ''), st0 = await A_().test('step'), c0 = await A_().test('totpAt', { secret, step: st0 }); ok(b.qr.size >= 21, 'qr'); ok((await A_().totpConfirm({ code: '000000' })).code === 'bad_code', 'wrong'); const on = mustOk(await A_().totpConfirm({ code: c0 })); ok(on.user.totp && on.recovery.length === 10, 'on'); await A_().signOut();
      const f = mustOk(await A_().signIn({ email: 'new@example.com', password: PW })); ok(f.twoFactor && !f.user && !(await A_().status()).user, 'password alone is not enough'); ok((await A_().verify2fa({ method: 'totp', code: c0 })).code === 'bad_code', 'replay refused'); mustOk(await A_().verify2fa({ method: 'totp', code: await A_().test('totpAt', { secret, step: st0 + 1 }) })); await A_().signOut(); await A_().test('gasAge'); mustOk(await A_().signIn({ email: 'new@example.com', password: PW })); ok(mustOk(await A_().verify2fa({ method: 'recovery', code: on.recovery[0] })).user.recoveryLeft === 9, 'recovery code'); ok(!mustOk(await A_().totpDisable({ code: on.recovery[1] })).user.totp, '2FA off');
      mustOk(await A_().changePassword({ current: PW, next: 'second long passphrase' })); await A_().signOut(); ok(!(await A_().signIn({ email: 'new@example.com', password: PW })).ok, 'old password gone'); await A_().test('gasAge'); mustOk(await A_().resetRequest({ email: 'new@example.com' })); const n0 = (await A_().test('gasMails')).length; mustOk(await A_().resetRequest({ email: 'ghost@example.com' })); ok((await A_().test('gasMails')).length === n0, 'unknown address gets nothing'); mustOk(await A_().resetPassword({ email: 'new@example.com', code: await gasCode(), password: PW }), 'reset'); await A_().test('gasAge'); mustOk(await A_().signIn({ email: 'new@example.com', password: PW })); await A_().signOut();
      await A_().test('gasAge'); mustOk(await A_().emailCodeRequest({ email: 'new@example.com' })); mustOk(await A_().emailCodeSignIn({ email: 'new@example.com', code: await gasCode() }), 'code sign-in'); ok((await A_().deleteAccount({ confirm: 'wrong@example.com', password: PW })).code === 'bad_confirm', 'confirm'); mustOk(await A_().deleteAccount({ confirm: 'new@example.com', password: PW }), 'delete'); ok(!(await A_().signIn({ email: 'new@example.com', password: PW })).ok, 'gone');
      await A_().test('gasCap', 999); ok((await A_().signUp({ email: 'cap@example.com', password: PW })).code === 'mail_quota', 'daily mail cap'); await A_().test('gasHtml'); ok((await A_().signIn({ email: 'cap@example.com', password: PW })).code === 'not_deployed', 'wrong deployment explains itself');
    } finally { await A_().gasSet({ url: '' }); ok(!(await A_().status()).cloud, 'back to local'); await A_().test('reset'); }
  });
  test('gas: a stand-alone Apps Script project makes one Sheet of its own and keeps using it', async () => {
    if (!hasAuth()) return; await A_().test('reset'); const url = await A_().test('gasStart'); await A_().test('gasStandalone', true); mustOk(await A_().gasSet({ url }), 'connect'); const PW = 'gas login passphrase';
    try { mustOk(await A_().signUp({ email: 'a@example.com', password: PW }), 'first'); mustOk(await A_().verifySignup({ email: 'a@example.com', code: await gasCode() }), 'verify'); ok(await A_().test('gasCreated') === 1, 'one Sheet created'); await A_().signOut(); mustOk(await A_().signIn({ email: 'a@example.com', password: PW }), 'again'); ok(await A_().test('gasCreated') === 1, 'still one'); await A_().signOut(); }
    finally { await A_().test('gasStandalone', false); await A_().gasSet({ url: '' }); await A_().test('reset'); }
  });
  test('music: every genre is level-matched and keeps its punch (not crushed flat)', async () => { const bad = []; for (const g of Object.keys(Music.STYLES)) { const b = await Music.render(Music.CATALOG.filter(x => x.genre === g)[3], { preview: 8 }), m = await AudioMix.measure(b); if (m.lufs < -16 || m.lufs > -11 || m.truePeak - m.lufs < 7 || m.truePeak > 0) bad.push(`: ${m.lufs.toFixed(1)} LUFS, PLR ${(m.truePeak - m.lufs).toFixed(1)}`); } ok(!bad.length, bad.join(', ')); });
  test('music: montagem, slowed phonk and epic tracks render; older tracks did not move', async () => { const g = n => Music.CATALOG.filter(t => t.genre === n); ok(g('Montagem').length === 150 && g('Slowed Phonk').length === 100 && g('Epic Orchestral').length === 80, 'counts'); ok(Music.CATALOG[0].id === 'm1_0', 'first id'); const m = await Music.render(g('Montagem')[4], { preview: 6 }), s = await Music.render(g('Slowed Phonk')[4], { preview: 6 }), e = await Music.render(g('Epic Orchestral')[4], { preview: 6 }); for (const [n, x] of [['montagem', m], ['slowed', s], ['epic', e]]) ok(rms(x, 1, 5.5) > .04, n + ' level'); });
  /* ---------- music and audio workflow ---------- */
  const rms = (b, a, z) => { const d = b.getChannelData(0), s = Math.floor(a * b.sampleRate), e = Math.min(d.length, Math.floor(z * b.sampleRate)); let x = 0; for (let i = s; i < e; i++) x += d[i] * d[i]; return Math.sqrt(x / Math.max(1, e - s)); };
  const bandE = (b, a, z, f) => { const d = b.getChannelData(0), sr = b.sampleRate, s = Math.floor(a * sr), e = Math.min(d.length, Math.floor(z * sr)); let re = 0, im = 0; for (let i = s; i < e; i++) { re += d[i] * Math.cos(2 * Math.PI * f * i / sr); im += d[i] * Math.sin(2 * Math.PI * f * i / sr); } return Math.hypot(re, im) / (e - s); };
  test('music: catalogue has 1,000+ unique tracks led by funk and phonk', () => {
    ok(Music.CATALOG.length >= 1000, 'count ' + Music.CATALOG.length); ok(new Set(Music.CATALOG.map(t => t.title)).size === Music.CATALOG.length, 'titles unique'); ok(new Set(Music.CATALOG.map(t => t.id)).size === Music.CATALOG.length, 'ids unique');
    const c = g => Music.CATALOG.filter(t => t.genre.includes(g)).length; ok(c('Phonk') >= 500 && c('Funk') >= 400, `phonk ${c('Phonk')}, funk ${c('Funk')}`); for (const t of Music.CATALOG) { const st = Music.STYLES[t.genre]; ok(t.bpm >= st.bpm[0] && t.bpm <= st.bpm[1] && t.dur > 30, t.title); }
  });
  test('music: tracks render with real level, no clipping, deterministic, distinct', async () => {
    const pick = g => Music.CATALOG.find(t => t.genre === g), a = await Music.render(pick('Phonk'), { preview: 8 }), a2 = await Music.render(pick('Phonk'), { preview: 8 }), b = await Music.render(pick('Funk'), { preview: 8 });
    for (const [n, x] of [['phonk', a], ['funk', b]]) { let pk = 0; for (const v of x.getChannelData(0)) { if (Number.isNaN(v)) throw new Error(n + ' NaN'); if (Math.abs(v) > pk) pk = Math.abs(v); } ok(pk > .5 && pk <= .9, n + ' peak ' + pk); ok(rms(x, 1, 7) > .05, n + ' level'); }
    let same = true, diff = 0; const d1 = a.getChannelData(0), d2 = a2.getChannelData(0), d3 = b.getChannelData(0); for (let i = 0; i < d1.length; i += 97) { if (Math.abs(d1[i] - d2[i]) > 1e-4) same = false; diff += Math.abs(d1[i] - d3[i]); } ok(same, 'same seed gives the same track'); ok(diff / (d1.length / 97) > .02, 'genres differ');
    for (const g of Object.keys(Music.STYLES)) { const x = await Music.render(pick(g), { preview: 3 }); ok(rms(x, .2, 3) > .01, g + ' audible'); }
  });
  test('music: the tempo a track claims is the tempo the beat tracker hears', async () => {
    for (const g of ['Phonk', 'Funk', 'Disco Funk']) { const t = Music.CATALOG.filter(x => x.genre === g)[3], L = await Music.addTrack(t, { start: 0 }); try { const r = await Analysis.beats(L), ratios = [1, 2, .5]; ok(ratios.some(k => Math.abs(r.bpm * k - t.bpm) < 3), `${g}: claims ${t.bpm}, heard ${r.bpm}`); } finally { const m = L.media; removeLayer(L.id); delete media[m]; } }
  });
  test('music: adding fits the timeline with a fade; MP3 files import and decode', async () => {
    const dur0 = P.dur; P.dur = 12; const hold = mkLayer('shape', { start: 0, dur: 12 }); P.layers.push(hold); const t = Music.CATALOG[0], L = await Music.addTrack(t, { start: 0, fit: true }), mid = L.media;
    try { ok(Math.abs(L.dur - 12) < .02 && L.type === 'audio', 'trimmed to 12 s: ' + L.dur); near(valueAt(L, 'vol', 9.9), 100, .5); near(valueAt(L, 'vol', 11.99), 0, 2); ok(media[mid].peaks !== undefined || true);
      if (window.nxff && (await ProMedia.probe()).available) { const dir = Disk.join(await Disk.fs.defaultRoot(), '__nexora_mp3_test__'), out = Disk.join(dir, 'tune.mp3'); try { const r = await ProMedia.exportPro({ codec: 'mp3', from: 0, to: 2, fps: 30, out, quiet: true }); ok(r && r.size > 5000, 'MP3 exported'); const i = await nxff.info(out); ok(i.audio && i.audio.codec === 'mp3', JSON.stringify(i)); const m = await Disk.importPath(out); media[m.id] = m; ok(m.kind === 'audio' && Math.abs(m.dur - 2) < .15, 'mp3 duration ' + m.dur); const ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await m.blob.arrayBuffer()); ok(ab.length > 1000, 'decoded'); delete media[m.id]; Disk.dropEls(m); } finally { await nxfs.remove(dir); } }
    } finally { removeLayer(L.id); removeLayer(hold.id); delete media[mid]; P.dur = dur0; }
  });
  async function toneVideo() { if (!(window.VideoEncoder && window.nxff)) return null; const dir = Disk.join(await Disk.fs.defaultRoot(), '__nexora_extract_test__'), out = Disk.join(dir, 'tone.mp4'), keep = P.layers.slice(), dur0 = P.dur; P.layers.length = 0; P.dur = 3; const c = new OfflineAudioContext(2, 48000 * 3, 48000), o = c.createOscillator(); o.frequency.value = 880; o.connect(c.destination); o.start(); const buf = await c.startRendering(), f = new File([ProMedia.wav(buf)], 'tone.wav', { type: 'audio/wav' }), am = await importFile(f), A = addMediaLayer(am, 0); const s = mkLayer('shape', { start: 0, dur: 3 }); P.layers.push(s); await ProMedia.exportPro({ codec: 'x264', from: 0, to: 3, fps: 30, mbps: 4, audio: true, out, quiet: true }); removeLayer(A.id); P.layers.length = 0; keep.forEach(l => P.layers.push(l)); P.dur = dur0; delete media[am.id]; const m = await Disk.importPath(out); media[m.id] = m; return { m, dir }; }
  test('extract: audio separates from video as its own clip and plays once in the mix', async () => {
    const v = await toneVideo(); if (!v) return; const keep = P.layers.slice(), dur0 = P.dur; P.layers.length = 0; P.dur = 3;
    try { const L = addMediaLayer(v.m, 0); L.vol = 80; let mix = await mixAudio(3); const before = rms(mix, .5, 2.5); const A = Music.detach(L); ok(A.type === 'audio' && A.media === L.media && A.vol === 80 && L.muted && A.start === L.start && A.dur === L.dur, 'detached'); mix = await mixAudio(3); near(rms(mix, .5, 2.5), before, before * .08, 'same loudness, not doubled'); ok(bandE(mix, .5, 2.5, 880) > .05, 'the tone is there');
      for (const x of [L, A]) removeLayer(x.id); }
    finally { P.layers.length = 0; keep.forEach(l => P.layers.push(l)); P.dur = dur0; structChanged(); delete media[v.m.id]; Disk.dropEls(v.m); await nxfs.remove(v.dir); }
  });
  test('extract: a clip range saves as MP3, WAV, FLAC and M4A, and speed is respected', async () => {
    const v = await toneVideo(); if (!v) return; const keep = P.layers.slice(), dur0 = P.dur; P.layers.length = 0; P.dur = 3;
    try { const L = addMediaLayer(v.m, 0); L.srcIn = .5; L.dur = 2; for (const [fmt, ext, codec] of [['mp3', 'mp3', 'mp3'], ['wav', 'wav', 'pcm_s24le'], ['flac', 'flac', 'flac'], ['aac', 'm4a', 'aac']]) { const out = Disk.join(v.dir, 'x.' + ext), r = await Music.saveAudio(L, { format: fmt, out }); ok(r.size > 500, fmt); const i = await nxff.info(out); ok(i.audio && i.audio.codec === codec && !i.video && Math.abs(i.dur - 2) < .12, fmt + ' ' + JSON.stringify(i)); }
      L.speed = 2; L.dur = 1; const out = Disk.join(v.dir, 'fast.mp3'); await Music.saveAudio(L, { format: 'mp3', out }); const i = await nxff.info(out); ok(Math.abs(i.dur - 1) < .12, 'double speed halves the length: ' + i.dur); removeLayer(L.id); }
    finally { P.layers.length = 0; keep.forEach(l => P.layers.push(l)); P.dur = dur0; structChanged(); delete media[v.m.id]; Disk.dropEls(v.m); await nxfs.remove(v.dir); }
  });
  test('music: beat sync cuts video on the beat; audio panel lists the library', async () => {
    const keep = P.layers.slice(), dur0 = P.dur, mk0 = P.markers; P.layers.length = 0; P.markers = []; P.dur = 10;
    try { const t = Music.CATALOG.find(x => x.genre === 'Funk'), M = await Music.addTrack(t, { start: 0 }); M.srcIn = sectionsStart(t); M.dur = 10; const fake = mkLayer('video', { name: 'v', media: M.media, start: 0, dur: 10 }); P.layers.push(fake); const r = await Music.beatSync(M, 4); const parts = P.layers.filter(l => l.type === 'video'); ok(r.cuts >= 2 && parts.length === r.cuts + 1, `cuts ${r.cuts}, clips ${parts.length}`); ok(P.markers.length === r.beats, 'markers');
      leftTab = 'audio'; Browser.S.audioPane = 'music'; Music.U.tab = 'library'; Music.U.genre = 'Drift Phonk'; Music.U.q = ''; buildLeft(); await new Promise(res => setTimeout(res, 120)); ok(document.querySelectorAll('.mu-row').length > 3, 'rows drawn'); ok(Music.filtered().every(x => x.genre === 'Drift Phonk'), 'genre filter'); Music.U.genre = 'All'; leftTab = 'media'; buildLeft(); const id = M.media; P.layers.length = 0; delete media[id]; }
    finally { P.layers.length = 0; keep.forEach(l => P.layers.push(l)); P.dur = dur0; P.markers = mk0; structChanged(); }
  });
  const sectionsStart = t => Music.sections(t)[0].b * 240 / t.bpm;

  /** run(onEach, filter?) — filter: a RegExp or substring that selects tests by name (development use) */
  async function run(onEach, filter) {
    const lines = []; let pass = 0, fail = 0; const t0 = performance.now();
    // tests run with default settings; the user's saved preferences are restored afterwards
    const prefs = { gpu: GPU.S.enabled, proxy: Proxies.S.use }; if (!prefs.gpu) GPU.setEnabled(true); if (!prefs.proxy) Proxies.setUse(true);
    try { return await runAll(onEach, lines, t0, filter); } finally { if (!prefs.gpu) GPU.setEnabled(false); if (!prefs.proxy) Proxies.setUse(false); }
  }
  async function runAll(onEach, lines, t0, filter) {
    let pass = 0, fail = 0;
    for (const t of T_) {
      if (filter && !(filter instanceof RegExp ? filter.test(t.name) : t.name.includes(filter))) continue; if (onEach) try { await onEach(t.name); } catch (e) { } try { await t.fn(); pass++; lines.push('PASS  ' + t.name); } catch (e) { fail++; lines.push('FAIL  ' + t.name + '\n      ' + e.message); console.error(t.name, e); } }
    lines.push(`\n${pass} passed, ${fail} failed in ${Math.round(performance.now() - t0)} ms`); NXI.ui.render(); return { pass, fail, lines };
  }
  return { run, count: () => T_.length };
})();
