# NEXORA Studio — development status

_Last updated: milestone 10 (limits removed: pro codecs, render cache, GPU everywhere, PSD, TIFF, real healing / content-aware fill). Every "Available" item below is exercised by `tests/tests.js` (all passing in Chrome and in the packaged Electron 33 app) or by manual real-input testing._

## Milestone 25 (v2.2.0): logo, changelog, website
- **Logo**: an N whose diagonal is a light-blue blade, on a dark rounded tile (`build/icon.svg`). It is rendered to PNG at 16–1024 px, to `build/icon.ico` (7 sizes) and to `build/icon.icns` (11 sizes, structure checked).
  - In the app: the window and taskbar icon, the splash, the header and Home.
  - In the packages: the Windows `.exe` icon and metadata (set by rcedit in CI), the macOS app icon, and the Linux PNG plus `.desktop` file.
- **Changelog**: `nexora/app/changelog.js` is the single source. `scripts/changelog.ps1` writes CHANGELOG.md, RELEASE_NOTES.md and `site/changelog.js`, and CI fails if they drift or `package.json` disagrees.
  - The app shows What's new on the first start after an update, never on a fresh install. Help › What's new / About and the Home sidebar link open it any time.
- **Go to timecode**: click a timecode readout and type an absolute timecode or a +/- offset.
- **Test runs** with `--nx-userdata` keep their project folders inside that folder, never in the user's Documents.
- **Website rebuilt**: logo, every feature with fresh screenshots (click to enlarge), a full feature list, and the changelog rendered from the same file as the app.

## Milestone 24 (v2.1.0): update notice, automatic builds
- **Update notice**: once a day the desktop app reads the latest public release from GitHub (no account, no identifiers, generic User-Agent). If it is newer, a small bar offers What's new, Download and Later; Later hides that version only. Check manually with "Help: Check for updates" in the command palette, where automatic checks can also be turned off. Pre-releases are never offered.
- **Self-test mode**: `--nx-selftest` runs the whole suite inside the real app, prints the result and exits with 0 when everything passes. `--nx-userdata=<folder>` keeps a test run's settings and library away from the user's own.
- **Packaging script**: `scripts/package.ps1` builds all four zips from Electron's official builds, checked against Electron's checksums.
  - The Windows zip it produced passed 222/222 tests after unzipping.
  - The deepest path inside it is 162 characters, so unzipping into a very deep folder can exceed Windows' 260-character limit.
- **GitHub Actions** (`.github/workflows/ci.yml`): every push runs the self-test on Windows, macOS and Linux. A `v*` tag also builds the zips and publishes the release, with notes from RELEASE_NOTES.md.

## Milestone 23: secondary grading (qualifier + window)
- **Color page › Secondary** grades only part of the picture.
  - **Qualifier**: a hue band (centre, width, softness) plus saturation and luma ranges. Pick colour samples the graded clip on its own, so titles above it are ignored. A near-grey pick selects by brightness.
  - **Window**: an ellipse or rectangle with position, size and softness, applied inside or outside.
  - **Adjustments**: hue shift, saturation and exposure inside the selection.
  - **Show matte** displays the selection in black and white.
- It is one "secondary" effect after the primaries and curves. Every value is a number, so it can be keyframed. The GPU and CPU results match within 2 levels, checked by a test.
- 221 tests, all passing.

## Milestone 22: reframe versions, clip speed, track height
- **Reframe**: Export page buttons, or "Project: Create 9:16 / 16:9 / 1:1 / 4:5 version", duplicate the edit and reframe the copy.
  - Picture clips are scaled to cover the new frame. Titles keep their place relative to the frame edges and are scaled to fit.
  - Backgrounds are re-centred, and position and scale keyframes are converted the same way.
  - The original project is never changed.
- **Clip speed presets** (right-click a video or audio clip): 25 % to 4×. The clip keeps the same source range, keyframes stretch with it, and later clips ripple so nothing overlaps.
- **Track height**: Rows S / M / L on the timeline toolbar (26 / 38 / 62 px), remembered.
- 219 tests, all passing.

## Milestone 21: OpenCode Zen for the AI Editor
- The AI Editor accepts an **OpenCode Zen** key as well as an Anthropic key. A key starting `sk-ant-` is treated as Anthropic; any other key is checked against Zen (`GET /zen/v1/models`) before it is saved.
- Models are routed by family:
  - Claude and Qwen go to Zen's Anthropic Messages endpoint, with Anthropic-only options removed.
  - DeepSeek, GLM, Kimi, MiniMax and the free models go to Chat Completions. The tools, tool calls, tool results and images are translated both ways.
  - GPT and Gemini are not offered, because they need other API shapes.
- An open model is the default (Kimi K3 when available). The model list can be refreshed. Errors are explained in plain words: rejected key, no credit, unavailable model, rate limit.
- Verified against a local mock of Zen in the tests, not yet against the live service with a real key. Chat Completions models reply in one piece, not streamed word by word.

## Milestone 20: curves, stills and wipe, clip menu, media list
- **Curves** (Color page › Curves): luma, red, green and blue curves with freely placed points.
  - Each curve is a monotone cubic, so it never overshoots. The frame's histogram is drawn behind the curve.
  - Applied through one 256-entry table per channel. It runs on the GPU and matches the CPU within 1 level, checked by a test.
- **Stills and wipe** (Color page): Grab still saves the viewer frame for this session. Clicking a still splits the viewer with a draggable line, showing the still on the left and the live grade on the right.
- **Clip right-click menu** on the timeline:
  - Split, Duplicate, Delete, Ripple delete
  - Enable/Disable, Mute, Lock
  - Mark In/Out to clip, Grade in Color, Freeze frame, Show in Media Pool
  - **Clip colour labels**: 8 colours in the blue/grey family, saved with the project.
- **Media Pool list view**: search, and a sortable table of name, type, duration, resolution, file size and how many times each item is used in the edit. Grid or list is remembered.
- 215 tests, all passing.

## Milestone 19: Color page, viewer guides, program meters
- **Color page** (new page between VFX and Design): the Edit viewer and timeline with a grading dock. Four wheels: Lift, Gamma, Gain and Offset, each with a colour-balance puck and a master slider, plus Contrast, Saturation, Temperature and Tint. Shift-drag for fine control; double-click resets.
  - The grade is one GPU "Primary Grade" effect at the top of the clip's stack. It is non-destructive, exports, and can be bypassed, copied, pasted, applied to every clip or reset. The GPU and CPU versions match within 1 level, checked by a test.
  - **Auto** sets white balance (grey world) and a levels stretch, measured from the frame without the grade.
  - A clip strip shows rendered, graded thumbnails, with a dot on clips that have a grade. Scopes are docked on the right.
- **Viewer guides** (Guides button): action-safe 93 % and title-safe 90 %, rule of thirds, centre cross, and crop frames for 16:9, 9:16, 1:1, 4:5, 2.39:1 and 4:3 with the outside dimmed. Settings are remembered.
- **Program audio meters** beside the viewer: stereo peak meters with a −60 to 0 dBFS scale, 1.5 s peak hold and a latching clip light, measured after the master limiter.
- 211 tests, all passing.

## Milestone 18: professional workstation layout
- Edit is laid out like a finishing-suite NLE: graphite panels with thin black gutters and a title bar on each (Media Pool / Effects Library, Viewer, Inspector), the pages (Edit, Motion, VFX, Design, Audio, Vector, 3D, Capture, AI, Assets, Export) along the bottom, tool options merged into the menu strip, and a compact icon strip for the asset browser.
- Timecode is hours:minutes:seconds:frames in the viewer header, in a large readout on the timeline toolbar, and on the ruler (frame-accurate ticks when zoomed in). Transport controls are centred under the viewer.
- Clips have a flat body with a lighter name strip; track headers carry V/A badges. Colours stay black, light blue and white. All 206 tests pass.

## Milestone 17: music mastering fixed
- The generated tracks were crushed almost flat by distortion: Phonk, Trap and Montagem measured about -2.5 LUFS with only 1-2.5 dB between peak and loudness. They now have headroom and a softer 808 drive, and every track is level-matched to about -13 LUFS with 8-17 dB of dynamics, checked by a test for every genre. Still judged by measurement only, not by ear.

## Milestone 16: Google Sheet accounts, more music styles
- **Online e-mail accounts:** paste a Google Apps Script Web App address under Sign in › Connect online accounts (or ship `electron/gas.config.json`). Real e-mailed verification, reset and sign-in codes, authenticator 2FA, recovery codes, lockout. Passwords are stretched with scrypt on the user's computer, and the Sheet stores only a hash of the result. Tested by running the real script against in-memory stand-ins for Google's services, **not yet on Google itself**. Consumer Gmail allows about 100 e-mails a day; the script stops at 80. Suited to small numbers of users.
- **Music:** Montagem, Slowed Phonk and Epic Orchestral genres added (330 tracks, original). Commercial songs are not bundled; users add files they own under My music.

## Milestone 15: effects library rebuilt for browsing
- The Effects and Filters tabs now show one card per look; its strengths and speeds open from the number on the card. The page opens on hand-picked Top picks, and All takes turns between categories, so no family fills the screen.
- Honest count: most of the 5,500+ original items were parameter variations (2,804 are automatic combinations), and 751 barely change a still frame, usually because they only move the picture.
- New effect types: Aura, Electric arcs, Fire, Speed lines, Rain, Snow, Fog, Sparkles, Bokeh, Starfield, God rays, Shine sweep, Caustics, Lens flare, Film damage, Dither, Crosshatch, Paper texture, Cracked glass, Hex mosaic, Glass refraction, Tunnel, Shockwave, Liquid wobble, Slices. Added after all older items, so saved projects keep their effects.

## Milestone 14: timeline speed
- The timeline builds only what is on screen. Measured on a 500-clip edit: redraw 144 ms to 7 ms, an edit 151 ms to 19 ms, undo + redo 238 ms to 50 ms, zoom 142 ms to 9 ms, on-screen elements 12,225 to 500. Layout and paint time are extra and were not measured.
- Open video players are capped near 16 (was one per clip: 302 in the same edit). Clips far from the playhead release theirs and reopen on demand.
- The next clip is sought just before each cut, and the inspector updates about 8 times a second during playback instead of every frame.
- **Tracks view** (default): clips that do not overlap share a row, stacking order is preserved, audio sits below the picture. A clip cannot float on a higher row with nothing under it. Motion mode and nested compositions keep one row per layer. Drag a clip up or down to change its stacking.
- Ctrl+wheel zooms at the cursor, `=` and `-` zoom, `\` fits the edit, Shift+wheel scrolls sideways, and a snap guide shows while dragging.
- **Preview resolution** (Auto, Full, 1/2, 1/4, beside Proxy): pixel-sized settings scale with the preview so the look holds, the viewer stays project-sized, a still frame redraws at full resolution 180 ms after you stop, and exports never use it. Auto steps down when frames miss their time. Compared against the full render for the built-in effects, transitions, masks, nested comps and 120 library effects. Nested comps and VFX graphs still render at full size internally, so they gain less.

## Milestone 13: strength and character
- **Sign-in:** e-mail only. GitHub appears once it has a Client ID. Google and Microsoft are off.
- **Version history:** automatic version every 5 minutes of change plus named versions, in `<project>/.versions/`. Restoring saves the current state first. Click "Saved" in the top bar.
- **Project Doctor:** finds offline media, flash frames, clips past their source, clipping audio, black gaps, soft footage, text outside the safe area, an empty tail and odd canvas sizes, with one-click fixes where safe. Shown in the Export dialog; the AI Editor can run it.
- **Render queue:** line up several FFmpeg formats and sizes; failures do not stop the rest. Each job renders the timeline as it is when that job starts.
- **Safety:** exports stop early if the disk is too full (size is an estimate), and uncaught errors no longer pass silently.
- **Character:** new N logo, opening sequence, personal Home with real stats and one-click resume, empty-timeline screen, export results card, `?` shortcut sheet, system check.

## Milestone 12 — music, audio extraction, online accounts
- **Music library:** 1,260 original tracks (Phonk, Drift Phonk, Brazilian Phonk, Funk, Disco Funk, G-Funk, Baile Funk, Trap, House, Lo-fi, Synthwave, Cinematic) synthesised on this computer from a seed. Search, genre, mood, BPM, favorites, preview. They take no disk space until added. Tests check level, no clipping, determinism, and that the beat tracker hears the stated tempo. **Quality has not been judged by ear in testing, and they contain no vocals or sampled instruments.**
- **Free online music:** in-app Openverse search, commercial-use Creative Commons and public-domain only; the licence is shown and credits are collected per project. The available catalogue is small and much of it is short samples.
- **My music:** folders of MP3 / WAV / FLAC / M4A stay available in every project.
- **Audio formats:** export the mix as MP3, WAV, FLAC or M4A.
- **Extract audio from video:** detach to its own timeline clip (video muted, mix unchanged), or save the clip's range as MP3, WAV, FLAC or M4A.
- **Music workflow:** fit to timeline with fade-out, cut video to the beat, duck under voice. The AI Editor can do all of these.
- **Online accounts:** Supabase Auth support, switched on by `electron/cloud.config.json` (see [ACCOUNTS.md](ACCOUNTS.md)). Tested against a local stand-in only.

## Milestone 11 — accounts, AI editor, 4K+, professional finish
- **Accounts (desktop app, see [ACCOUNTS.md](ACCOUNTS.md)):** e-mail + password (scrypt, lockout), authenticator-app 2FA with QR enrolment and replay protection, single-use recovery codes, profile, activity log, data download, account deletion, per-account project library. Account data is encrypted with Windows DPAPI and handled only in the main process.
- **External sign-in:** Google and Microsoft (authorization code + PKCE in the system browser, signature/issuer/audience/expiry/nonce checked), GitHub (device flow), custom OpenID Connect. Tested end to end against a local identity provider. **Each needs its Client ID registered once before real use;** none are registered in this build.
- **E-mail:** verification, sign-in codes, e-mailed 2FA and resets work through an SMTP account you enter. Tested against a local mail server.
- **AI Editor:** Claude edits the real timeline through about 30 validated tools, can view rendered frames, every change is undoable, and one button reverts a whole request. Needs the user's Anthropic API key. Tested through the official SDK against a local server speaking the streaming protocol; **it has not been run against the live API.**
- **4K and above:** UHD, DCI 4K, 5K, 8K and vertical 4K project presets; canvas limit raised to 8192; VFX graphs up to 4096 (was 1920); webcam capture up to 4K (was 720p); 4K delivery presets; output-size option (Lanczos up/downscale through FFmpeg). Verified by reading exported H.264, HEVC, ProRes, DNxHR, DCI 4K and 8K files back with FFmpeg.
- **Interface:** flat black / light blue / white, tighter corners and density, line icons in the transport, a controlled glow on focus, primary actions, the playhead timecode, the selected clip and the sign-in card. Home opens on a new-project bar. "Gaming" is now "Capture"; stickers moved last.
- **Still limited (honest):** accounts live on one computer, there is no cloud sync. Sign-in guards the app, but project folders on disk are not encrypted. The QR code has been structurally verified but not scanned by a real phone in testing. The AI cannot generate new images, video or audio. Effect-heavy 4K timelines can miss real-time playback (a demo with several blurs measured about 40–80 ms per frame); use proxies and the render cache (Enter).

## Milestone 10 — former limits, now fixed
- **Pro codecs everywhere (desktop app):** FFmpeg 9.0.2 is bundled (`vendor/ffmpeg/win32-x64`, GPL build by gyan.dev, hash-verified, run as a separate program; licence beside it). Export › **Master file**: Apple ProRes 422 Proxy / LT / 422 / HQ, **ProRes 4444 and 4444 XQ with alpha**, Avid DNxHR LB / SQ / HQ / HQX / 444, GoPro CineForm (.mov, 24-bit PCM audio). **Image sequences** (PNG or Deflate TIFF, with alpha) and **WAV 24-bit** audio stems. H.264 / HEVC / **HEVC 10-bit** / VP9 / AV1 now also encode in software (x264 / x265 / libvpx / libaom), so they work on every PC — the dialog offers *Hardware (fastest)* or *Software (best quality per bit)* when both exist. Files are tagged Rec.709; every codec was verified to decode back within 2/255 of the rendered colour. The page never sends raw command lines: it sends a structured job that `electron/ffmpeg.js` turns into arguments.
- **Any footage imports (desktop):** files Chromium cannot decode — ProRes, DNxHR, CineForm, MXF, AVI, MTS/M2TS, WMV, odd MKVs, AIFF/WMA/AC-3, TIFF/EXR/DPX/TGA/PSD stills — are converted once into an edit-friendly copy ("optimized media": H.264 CRF 12 with a 1-second GOP + AAC, FLAC, or PNG) in `Media\Optimized\`; the original path is kept in the project. Tested: a DNxHR file imports and its frames match the timeline render.
- **Render cache — real-time playback of heavy effects:** Enter (or Ctrl+K › Render) pre-renders In–Out in 4-second segments to high-bitrate H.264 on the GPU; forward playback over a rendered segment decodes those frames with WebCodecs instead of rendering them, frame-exact, so it runs at full frame rate however heavy the stack. Edits invalidate only the segments they touch (signature of the overlapping layers, media, Motion / VFX / LUT data); rendered segments show as a light-blue bar on the ruler. Paused frames, scrubbing, shuttle and export always render live and exact. Render files live in memory for the session (Ctrl+K › Delete render files).
- **Every Edit effect on the GPU:** Gaussian blur, Glow and Drop Shadow (separable Gaussian passes in premultiplied space), the CSS colour filters (Filter Effects colour matrices), Pixelate, Wave, Mirror, Zoom / Directional blur, Halftone and Digital Glitch (same random strips as the CPU) now run in WebGL2, so a whole stack stays on the GPU with one upload and one download. Parity with the CPU path is tested per effect: colour filters, blur, glow, shadow, pixelate, mirror within 1–4/255 (mean < 1); zoom / directional blur mean < 2; halftone draws the same discs with radii that differ slightly from Skia's downscale. Zoom and directional blur on the CPU are now true averages (edges fade like real motion blur).
- **VFX:** points can be added to roto shapes that already have several keys (inserted on the nearest edge in every key); VFX export includes the audio of its Media In nodes.
- **Image — Photoshop PSD:** import and export of layered RGB PSD (8 / 16-bit read, 8-bit write): pixel layers, groups (open / closed), layer masks, blend modes, opacity, visibility, clipping, Unicode names, RLE / ZIP channel data; flat PSDs load their merged image. Text / shape layers are written as pixels and layer effects are baked in; adjustment layers stay in the composite only (the export says how many). Photoshop type layers, smart objects and live styles import as the pixels Photoshop stored. PSB, CMYK, Lab and 32-bit documents are refused with a clear message. Verified by round trip and by FFmpeg's independent PSD decoder (desktop test).
- **Image — TIFF:** tiled and stripped files, 1 / 8 / 16 / 32-bit (integer or float), contiguous or planar, gray / RGB(A) / palette / CMYK, none / LZW / PackBits / Deflate / JPEG compression, horizontal predictor. Export adds **TIFF Deflate** (with predictor).
- **Image — Content-Aware Fill** is real exemplar-based completion: multi-scale PatchMatch with similarity-weighted patch voting (continues textures — tested on stripes). **Healing** is a true Poisson (seamless-cloning) solve — tested with a harmonic tone change that a plane fit cannot reproduce.
- **Image — layer effects:** Inner Shadow, Inner Glow and Bevel & Emboss (inner bevel / emboss, depth, size, angle, altitude, highlight + shadow colours). **Adjustment layers honour blend modes.** **Paragraph text** (box width, word wrap, full justification) and **text on a path** (Pen path → glyphs placed by arc length, offset and baseline shift).
- **Image — speed on big documents:** the composite below the layer being edited is cached and reused (keyed by every layer underneath), so painting on one layer of a deep document recomposites only that layer and the ones above it.
- **Image — floating panels:** the button in any panel header tears it off the dock; drag it anywhere, resize it from its corner, dock it back. Positions are remembered.
- **Project folders:** renaming a project also renames its folder on disk (open media inside it is re-pointed). Relink search goes 12 folders deep / 400,000 entries / 20 s.
- **Still limited (honest):** export renders on the app's main thread (the window is busy during an export; encoding itself is in FFmpeg or the GPU), and the timeline still decodes through `<video>` elements. Render files are kept in memory for the session and are not saved with the project. FFmpeg and everything built on it (masters, software codecs, optimized media) are in the Windows desktop app only: the Linux / macOS packages and the plain browser version use WebCodecs. Exporting Film Grain uses a different random pattern on GPU and CPU (it is noise in both).

## Pro editing (milestone 9)
- **Trim & edit keys (Edit timeline):** J / K / L shuttle (press J or L again for 2×, 4×, 8×) · I / O mark in/out · X mark selected clip · Alt+X clear marks · `,` / `.` insert / overwrite the selected media at the playhead · `;` / `'` lift / extract the In–Out range · Q / W ripple-trim the clip start / end to the playhead · Shift+Del ripple delete · Shift+S cut every clip at the playhead · Shift+R roll edit · Alt+← / → slip one frame (Shift = 10) · Shift+I / O go to In / Out · ↑ / ↓ jump to previous / next edit point · Shift+↑ / ↓ previous / next marker. Close gaps is in Ctrl+K. The In–Out range shows on the ruler.
- **Scopes:** waveform, RGB parade, vectorscope (Rec.709 with skin-tone line and colour targets) and histogram over the viewer; Scopes button or Shift+C. Values are measured on the rendered frame, so they include every effect and grade.
- **LUTs:** import any 3D `.cube` (Filters tab › Import .cube LUT, sizes 2–65), apply it as a filter with an intensity slider, GPU with an exact CPU fallback (tested to match within 2/255). Any library filter can be **baked to a 33³ .cube** for use in Resolve, Premiere or OBS. Imported LUTs are saved inside the project file.
- **Export:** presets (Web, High quality, Master, Small, Social 9:16, AV1, VP9, Custom), codec choice H.264 / HEVC / VP9 / AV1 (only codecs this machine can actually encode are listed), 4–80 Mbit/s, 23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60 fps, and **Range: whole timeline or In–Out** (audio is cut to match).
- (The milestone-9 limits — hardware-only HEVC/AV1, no ProRes/DNxHR, heavy stacks below real time — are fixed in milestone 10 above. In the plain browser version, without FFmpeg, codecs are still the ones the machine's WebCodecs offers.)

## Effects & filters library, one-flow editing (milestone 8)
- **Edit is the hub:** the left panel is one browser — Media · Audio · Text · Stickers · Effects · Transitions · Filters · Elements · Adjust · Looks · Animate (resizable; drag its edge). Click applies to the selected clip; with nothing selected (or "New layer"), effects and filters get their own track at the playhead.
- **5,525 effects** in 18 categories (Shake, Zoom, Camera, Glitch, Distort, Kaleidoscope, Blur, Light, Light Leaks, Glow, Frames, Lens, Atmosphere, Retro, VHS, Art, Color FX, Combos), **2,079 filters** (8 tones × 26 colour styles × 10 variants), **206 transitions** (In / Out), **384 text styles**, **111 sound effects** (synthesised locally, royalty-free), **1,189 stickers** (system emoji).
- **How they are real:** one GPU uber-shader with ~40 building blocks; each item is a distinct parameter set plus time-based modulation, so it animates on its own and exports frame-exact. Tested: no two of 250 sampled effects / 200 filters render the same, every one changes the picture, 0 % intensity is pixel-identical. Combos (2,804 of the effects) merge two families. Thumbnails are live GPU renders of the selected clip (or a sample photo); hover animates them. Search, categories, favourites and recents.
- Library effects need WebGL2 (any GPU from the last ~10 years); without it they are skipped with a notice.
- **Look:** interface is black, light blue and white only; the accent toggle switches light blue ↔ white.

## Connected editing (milestone 7)
- One project, one timeline: the other modes are tools applied to it. Selecting a clip shows **Add VFX / Edit in Design / Edit animation / Mix audio**; the timeline bar has **Title / Overlay / Effect**. Opening a tool from a clip shows a "… · Back to timeline" chip that returns to the same clip and playhead. Rail clicks open the selected clip's existing VFX graph / design / composition / mixer strip directly.
- **VFX on a clip:** a node graph attached to the clip (Timeline Clip node → … → Output), rendered in place; pass-through is pixel-identical, and it is seeked frame-exactly for export.
- **Measured:** loudness of a −20 dBFS stereo sine reads −20.2 LUFS; low shelf +12 dB at 100 Hz → +11.1 dB; normalize hits target within 0.1 LU; 120 BPM click track → 120.0 BPM, beats within 10 ms; scene cuts found at 1.00 s / 2.00 s; Vector unite area exact, subtract within 0.03 %.
- **Former limits, now fixed (milestone 7.1):**
  - Loudness is exact ITU-R BS.1770-4 / EBU R128 (standard K-weighting coefficients for any sample rate): −20.00 LUFS for the −20 dBFS sine, −22.99 LUFS for EBU Tech 3341 case 1. **True peak** uses 4× oversampling (fs/4 sine at 45°: sample −3.01 dB, true +0.1 dBTP). **Reverb**: per-clip send into an algorithmic room (decay, pre-delay) on the master bus, in playback and export.
  - Vector: **linear / radial gradient fills** (editable, exported as SVG gradients) and **text on a path** (one glyph per letter, placed by arc length and rotated to the tangent).
  - 3D: **extruded 3D text** with bevel (bundled MgOpen Helvetiker / Optimer, licence in vendor/fonts) and **model import** — GLB and single-file glTF (meshes, node transforms, PBR colours, embedded textures) and OBJ; models are stored inside the project.
  - AI in Design projects: **Remove background** (editable layer mask), **Select subject**, **Crop to subject**.
  - AI works **fully offline**: transformers.js 3.3.3, its WASM runtime, Whisper tiny.en and MODNet ship in `vendor/ai` (hash-verified at download). Whisper base / multilingual remain optional downloads.
  - Gaming: real screen-capture path verified end-to-end in the desktop app (a test records only its own off-screen window); macOS ScreenCaptureKit system-audio flags enabled, with picture-only fallback if a platform refuses audio.
- **Milestone 7.2:** 3D model import now covers glTF **animations** (LINEAR / STEP / CUBICSPLINE on translation, rotation, scale and morph weights; pick the clip and speed per object), **skinned meshes** (skeletons from glTF skins), **morph targets**, sparse accessors, normal / metal-rough / emissive maps, and **multi-file** models (.gltf + .bin + textures; .obj + .mtl + textures) — all packed into the project. OBJ **.mtl materials** (Kd, Ks, Ns, d/Tr, Ke, map_Kd, one mesh per material). **Multilingual Whisper (base, 99 languages)** is bundled, so all captions work offline. **Linux x64** and **macOS (Apple silicon + Intel)** packages are produced from verified Electron 33.2.0 downloads with permissions and framework symlinks preserved; macOS gets a standard Edit menu so Cmd+C / V / Z work.
- **Remaining limits (honest):** the Linux and macOS packages are built and structurally verified (executables, symlinks, app files) but have **not been run** — there is no Linux or Mac machine here. The macOS build is not signed with an Apple Developer ID: the README inside explains the one-time `xattr` + local `codesign` step. On Linux, system-audio capture is not available, and Ubuntu 23.10+ may need the `chrome-sandbox` permission fix described in its README.
## Media on disk (milestone 6, desktop app)
- **Project folders:** every desktop project lives in `Documents\NEXORA Projects\<name>\` with `project.nexora` (JSON, no media bytes) and `Media\`. Saves are atomic (temp file + rename), serialised (no interleaved writes), and retried when OneDrive/antivirus briefly lock files. Home › **Open folder** opens any project folder; tiles have **Show in folder**; removing a project from the library keeps its folder on disk.
- **Linked media:** imported files are referenced by path and streamed through `nxmedia://` (HTTP Range for seeking, CORS so effects/export can read pixels). No size limit and nothing copied into memory. Recordings and other in-memory media are written into `Media\` on save.
- **Relative + absolute paths:** each media item stores both; a moved or copied project folder that contains its `Media\` still opens.
- **Offline media + relink:** missing files render as a red "Media offline" card (Edit and VFX); opening a project with missing files shows the Relink dialog: **Locate…** per file or **Search folder…** (recursive, by file name, preferring the same size).
- **Collect files** (Ctrl+K) copies every linked file from outside the project into `Media\`. **Clear proxy cache** frees proxy storage.
- **Portable export** (`Export project file`) still embeds all media, including linked files.
- Fixed along the way: `prompt()` (rename project/layer, save brush/group) does not exist in Electron — replaced by an in-app dialog; removing a project during an autosave no longer resurrects it.
- **Browser version:** unchanged (media embedded in IndexedDB, 300 MB cap) — browsers cannot keep file paths.

## Performance engine (milestone 5, part 1)
- **GPU effects (WebGL2):** 14 per-pixel effects now run as GLSL shaders: Temperature/Tint, Levels, Duotone, Posterize, Chroma Key, Smart Key, Sharpen, Film Grain, Chromatic Aberration, Twirl, Bulge, Edge Detect, Vibrance, Color Wheels. Consecutive effects are batched (one upload, one draw-back). Results match the CPU path within 1/255 per pass (tested). Measured on a 1280×720 frame with 5 such effects: CPU 291 ms → GPU 25 ms. Automatic CPU fallback if WebGL2 is missing or the context is lost; toggle via the transport readout or Ctrl+K › Performance.
- **Proxy media:** one-click or automatic (imports above 1080p) low-res H.264 copies with audio, built frame-exact with WebCodecs (seek per frame on a 30 fps grid), cached in IndexedDB across restarts. Used only for playback; export and frame grabs always use the original (tested). Proxy size is calibrated per runtime: Chromium versions decode H.264 colour matrices differently by frame size, so NEXORA encodes a test clip and keeps the first size (720 or 540 short side) that round-trips colours exactly.
- **Render meter:** the transport shows GPU/CPU mode, smoothed render ms per frame and delivered fps while playing; it turns amber when a frame exceeds the frame budget.

## App layout (milestone 4)
- **Home** (Home / Templates / Library in a left sidebar): "Create project" banner, quick-start cards (video with size preset, image design, motion graphics, VFX compositing, open image), template row with live-rendered thumbnails, searchable Projects grid (open, rename, duplicate, delete, import `.nexora`).
- **Projects library:** every project autosaves to IndexedDB (`nexora-projects`) about 3 s after an edit and when you go back Home; the grid shows a rendered thumbnail, size and last-edited time. Media under 300 MB total is stored with the project; larger media must be relinked.
- **Studio:** opening a project shows a slim top bar (Home, project name, save state, commands, undo/redo, Export) and a **vertical mode rail** on the left. Video projects: Edit · Motion · VFX · Design · Audio · Vector · 3D · Gaming · AI · Assets · Export. Image projects: Design · Vector · AI · Assets · Export. All modes act on the **same project**; there are no workspace tabs. Modes marked "soon" open an honest "In development" page.
- Interface uses line icons (no emoji in the chrome); emoji remain only as sticker content.

## Workspaces
| Workspace | Status | Notes |
|---|---|---|
| Home | Available | CapCut-style start page, templates, projects library (see App layout) |
| Edit | Available | Existing video/motion engine, unchanged features, now inside the shell |
| Image | **Available (new)** | See below |
| Motion | **Available (milestone 3)** | Composition library with per-comp editing context and undo; Bézier keyframes + graph-editor handles + Easy Ease (F9); motion blur (shutter/samples); per-character/word/line text animators (11 presets); trim-path draw-on; 6 animated background generators; 7 logo/title templates; comps place into Edit as live linked layers. Shares the Edit timeline UI. |
| VFX | **Available (milestone 3)** | Node graph: media / Motion comp / solid / gradient / background / particles / text inputs; transform, color correct, blur, glow, mask, roto (keyed shapes), chroma keyer with spill suppression, tracker (match-move / stabilize), displace, merge; groups (collapse, enter, save to library); loop prevention; per-graph undo; viewer + transport; PNG / exact-frame MP4 export; place in Edit as a live layer. Limit: Canvas 2D on the main thread. |
| Vector | **Available (milestone 7)** | paper.js (MIT): pen, shapes, text, unite/subtract/intersect/exclude, align, group, SVG import/export; drawings live in the project and are linked to the timeline |
| 3D | **Available (milestone 7)** | three.js r160 (MIT): primitives, flat text, image cards, PBR materials, key/ambient light, shadows, spin/bob/camera-orbit animation; '3d' timeline layers render frame-exact |
| Audio | **Available (milestone 7)** | Mixer: per-clip EQ / pan / compressor / volume / mute / solo with meters, master gain + limiter, BS.1770 loudness + normalize, auto-duck; same chain in playback and export |
| Gaming | **Available (milestone 7)** | Record screen/window (+ system audio on Windows), webcam, mic as separate clips; 6 gaming overlay templates; beat markers, cut on beat, loud-moment highlights |
| AI | **Available (milestone 7)** | Auto captions (Whisper) and background removal (MODNet) on-device after a one-time model download; remove silences (ripple), scene-cut detection, highlights |
| Export | Available | Video (exact-frame MP4 / capture), frames, image formats, whole project |
| Assets | Available | Shared registry, usage counts, linked docs, delete protection |

## NEXORA Image — what works
- **Layers:** pixel, text, shape (rect/rounded/ellipse/polygon/star/line/Bézier path), groups (nested), adjustment layers; masks (paint, density, disable, apply), clipping masks, 17 blend modes, opacity, visibility, lock, reorder (drag & drop incl. into groups), duplicate, merge down, merge visible, flatten, rasterize.
- **Layer effects (non-destructive):** drop shadow, outer glow, outside stroke, color overlay, inner shadow, inner glow, bevel & emboss.
- **Adjustment layers (non-destructive, maskable, clippable):** Brightness/Contrast, Exposure, Hue/Saturation (+colorize), Color Balance, Curves (master + R/G/B, histogram), Levels, Selective Color, Gradient Map, Black & White (+tint), Vibrance, Photo Filter, Invert, Threshold, Posterize. Same math available destructively (Image › Adjustments).
- **Selection:** rectangular/elliptical marquee, lasso, polygonal lasso, magic wand (contiguous / global, sample layer or all), quick selection, add/subtract/intersect, feather, grow/shrink, invert, load layer transparency, selection → mask, pen path → selection. Marching ants.
- **Tools (all functional):** move (auto-select, nudge, align), free transform / perspective / warp (pixel layers; vector layers transform non-destructively), crop (ratios), eyedropper (averaging), spot healing, healing brush, brush, pencil, clone stamp, eraser, gradient (linear/radial/angle/reflected), paint bucket, blur, sharpen, smudge, dodge, burn, sponge, liquify (push/bloat/pucker/twirl), pen (Bézier, edit anchors, fill/stroke/selection/shape), text (inline editing), shapes, hand, zoom.
- **Brushes:** size, hardness, opacity (per stroke) vs flow (per dab), spacing, angle, roundness, scatter, size jitter, smoothing, textures (noise/canvas/paper/stipple), pen pressure → size/opacity, 8 presets, user presets, custom tips from images, import/export (`docs/BRUSH_FORMAT.md`).
- **Filters (Web Worker):** Gaussian blur, motion blur, unsharp mask, add noise, reduce noise (median), mosaic, emboss, find edges, twirl, spherize/pinch, ripple; Content-Aware Fill (multi-scale PatchMatch completion).
- **Image ops:** image size (resample), canvas size (anchor), rotate 90/180, flip, crop to selection, trim.
- **Typography:** point text, paragraph boxes (wrap + justify), text on a pen path; font, size, weight, italic, color/gradient fill, alignment, tracking, kerning on/off, line height, case transforms, outline, shadow, transform (rotate/scale), editable at any time.
- **Panels:** layers, properties, color picker (HSV), swatches, brush settings, layer effects, history (click to jump), navigator. Panels collapse, reorder by drag, float anywhere, column resizes; 4 layout presets saved per user.
- **History:** copy-on-write snapshots (unchanged canvases shared), capped at 100 states / 768 MB with live memory readout.
- **Formats:** export PNG, JPEG, WebP, PSD (layered), BMP (32-bit), TIFF (uncompressed or Deflate), SVG (vector layers as real SVG; masked/effected/pixel layers embedded as PNG), native layered `.nxi`. Import PNG/JPEG/WebP/BMP/GIF/SVG (rasterised), PSD (layered), TIFF (see milestone 10), `.nxi`; paste from clipboard; drag & drop.
- **Templates (layered, editable):** YouTube thumbnail, gaming thumbnail, Minecraft thumbnail, gaming banner, logo/emblem, event poster, wallpaper, square social post, story, product ad, graded photo composition.

## Shared project system
- `.nexora` envelope, schema v2 with migration from v1 `.fusion` files and validation (`docs/PROJECT_SCHEMA.md`).
- Image → Edit **linked assets**: "Place in Edit" publishes a doc as a media asset; edits re-flatten automatically and the timeline updates without re-import. "Edit in NEXORA Image" on any Edit image layer opens / creates the linked doc.
- Asset usage tracking (including inside precomps), delete protection, problem report.
- Autosave: every project is saved to the IndexedDB project library ~3 s after any change and on leaving/closing; reopen from the Home grid. Media > 300 MB total is not duplicated into the library (relink needed). `.nexora` files remain the portable export.

## Known limitations (honest)
- **PSD:** PSB, CMYK / Lab / 32-bit documents are refused; Photoshop type layers, smart objects, adjustment layers and live layer styles import as their stored pixels (not as editable objects). Tested by round trip and FFmpeg's PSD decoder, not yet against files saved by Photoshop itself (no copy here).
- **TIFF:** BigTIFF and multi-page files (only the first page is read) are not supported.
- **Rendering** of Image documents is Canvas 2D (filters in a worker, composite cache below the edited layer); there is no tiling, so 100 MP+ documents with many effect layers stay slow.
- Linked assets: Image → Edit is live; Edit → Image edits happen on the doc (one source of truth).

## Testing
- `tests/tests.js` — 163 automated tests (incl. pro editing keys, scopes maths, LUT parse / GPU-vs-CPU / bake round trip, export range + codec, FFmpeg masters with audio, optimized media, render cache, PSD, TIFF, Poisson healing, PatchMatch fill) (incl. GPU/CPU parity, proxy frame accuracy, and desktop-only disk tests: linking, folder save/reopen, offline + relink, moved folders — these skip in a browser) (schema, assets, compositing, every Image tool, adjustments, filters, formats, templates, Motion, VFX, cross-workspace links, keyboard isolation, mode rail, project library save/reopen/rename/duplicate/delete).
- Run: serve the folder (`powershell -File serve.ps1`) and open `http://localhost:5173/tests/run.html`, or Command palette › "Developer: Run automated self-tests" (also works in the packaged app).
