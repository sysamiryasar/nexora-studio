# Research: what the pro editors do, and what we merged

| Tool | Core idea | Key features we took |
|---|---|---|
| **Photoshop** | Raster layers, non-destructive editing | Layer stack, 27 blend modes, adjustment layers, masks (feathered/inverted), brush/eraser/fill/eyedropper, Levels, text & shape layers, undo history |
| **After Effects** | Everything is a layer with animatable properties | Keyframes on every property (position/scale/rotation/opacity/effect params), easing curves, effect stacks, masks, adjustment layers, shape layers, motion graphics presets, gizmo on canvas |
| **Premiere Pro** | Track-based NLE | Timeline w/ trim/move/split, snapping, playhead scrub, audio waveforms, transitions, speed, export |
| **DaVinci Resolve** | Color + edit + Fusion (node VFX) | Levels / color-balance grading, looks, chroma key, scopes-free grading controls |
| **CapCut** | Fast social editing, templates | One-click looks/filters, text presets with animation (type-on, pop, slide), auto transitions, vertical 9:16 / square presets, simple UI |

Shared model all five agree on (Adobe docs state AE and Photoshop blend modes are identical,
and adjustment layers work the same way): **layers + blend modes + masks + adjustment layers**.
After Effects adds **time (keyframes)**; NLEs add **clips on a timeline with transitions and audio**.

## Architecture decision
One compositor, one data model: a *project* is a stack of *layers*; each layer has a clip
range on the timeline, a transform, effects, a mask, transitions and keyframes. Photoshop-style
painting is just a raster layer type; CapCut-style editing is clip trimming + presets; AE-style
motion is keyframes. Runs in the browser (Canvas 2D + Web Audio + MediaRecorder) so there is
nothing to install.

## Known limits (honest)
- Export is real-time WebM (MediaRecorder), not frame-accurate offline MP4 encoding.
- No GPU shader pipeline, 3D, optical-flow tracking, or RAW/ProRes codecs.
- Effects run on the CPU/Canvas at project resolution (720p default for speed).
