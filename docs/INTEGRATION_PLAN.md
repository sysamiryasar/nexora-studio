# NEXORA Studio — Technical Integration Plan

## 1. What exists today (inspected)
The repo is a dependency-free browser/Electron app (formerly "Fusion Studio"):

| File | Role |
|---|---|
| `engine.js` | Video/motion compositor: project model `P`, layers, keyframes + expressions, parenting matrices, 3D mesh, precomps, transitions, Canvas2D render, media sync, undo snapshots |
| `fx.js` | Effect registry (36 CSS/pixel effects), looks, easing |
| `viewport.js` | Edit viewport: pan/zoom, transform gizmo, paint tools for paint layers |
| `panels.js` / `timeline.js` | Inspector, left panels, timeline, keyframe lanes |
| `features.js` | Motion tracking, graph editor, AI (transformers.js), offline MP4 (WebCodecs + vendored mp4-muxer) |
| `main.js` | Menus, shortcuts, IO, export, boot |
| `electron/main.js` | Desktop shell |

Strengths to keep: the Edit engine works and is tested. Constraints: no build step, everything is global scripts; Canvas2D only (no WebGL yet); Electron 33 (Chromium 130) gives WebCodecs, OffscreenCanvas and Workers.

## 2. Target architecture
```
index.html
├─ nexora/app/shell.js        workspace router, command palette, themes, Home, Assets, Export pages
├─ nexora/core/schema.js      versioned project envelope (v1 Fusion → v2 NEXORA), migrate + validate
├─ nexora/core/assets.js      shared asset registry, cross-workspace links, dependency tracking
├─ nexora/core/recovery.js    IndexedDB autosave + crash recovery
├─ (existing) engine/fx/viewport/panels/timeline/features/main   = NEXORA Edit (+ Motion preset)
└─ nexora/image/
   ├─ engine.js     document model, layer tree, compositor, masks, clipping, layer effects, selection, history
   ├─ adjust.js     non-destructive adjustment math (curves, levels, HSL, balance, selective, gradient map…)
   ├─ filters.js    destructive filters; heavy ones run in a Web Worker (blob worker, works under file://)
   ├─ tools.js      every canvas tool (paint, retouch, select, pen, text, shape, crop, transform, liquify)
   ├─ formats.js    PNG/JPEG/WebP/BMP/TIFF/SVG/native .nxi, brush format; PSD interop stub
   ├─ templates.js  editable layered templates (thumbnails, banners, logos…)
   └─ ui.js         Image workspace panels (layers, properties, color, swatches, brush, history, navigator, effects)
tests/run.html + tests/*.test.js   in-browser automated tests for schema, assets, image engine, formats
```
Each workspace exposes `{ id, mount(), enter(), leave(), undo(), redo(), commands[] }` to the shell. Workspaces never reach into each other's internals; they exchange **assets** through `Assets`.

## 3. Shared project system
- **Envelope v2** `{ nexora: { schema: 2 }, edit: {project, media}, images: {docId: doc}, assets: {...} }`. v1 files (`{fusion:1}`) migrate on load.
- **Assets** are `media` records (video/image/audio) and `imageDocs`. A media record may carry `link: {doc, rev}`; when the Image doc's `rev` changes, `Assets.syncLinked()` re-flattens it so the Edit timeline updates without re-import. "Edit in Image" opens the source doc.
- **Dependency tracking**: `Assets.usage()` scans Edit layers (recursively through precomps) and docs to count references; deleting a used asset is blocked.
- **Recovery**: debounced autosave of the v2 envelope to IndexedDB; Home offers restore after a crash.

## 4. Phasing (each phase ships a working app)
| Priority | Scope | This milestone |
|---|---|---|
| 1 | Finish video editor | Already functional; keep green via tests |
| 2 | NEXORA Image | **Build now**: real layers, selections, brushes, masks, text, adjustments, filters, export |
| 3 | Shared assets + linked docs | **Build now**: envelope v2, links Image→Edit, recovery |
| 4 | Motion + VFX | Motion = preset over the Edit engine now; VFX node graph next (needs render-graph refactor) |
| 5 | Audio + Gaming | Web Audio graph (EQ/comp/reverb via native nodes), beat detection |
| 6 | Vector | Path model already started (Image pen/path shapes) → dedicated workspace + boolean ops |
| 7 | 3D | Integrate **three.js** (MIT) as engine; do not hand-roll fake 3D UI |
| 8 | AI assistant | Provider adapters; secrets stay in Electron main process, never in renderer |
| 9 | Polish + integration tests | |

## 5. Engineering rules for this codebase
- Heavy pixel work (blur, inpaint, noise reduction) goes to a Worker; per-layer render caches keyed by version counters.
- History stores per-layer canvas versions (copy-on-write), with a memory cap and live estimate.
- Unsupported formats say so (PSD: not implemented until tested against real layered files).
