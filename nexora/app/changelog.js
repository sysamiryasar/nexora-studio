window.NX_CHANGELOG = [
  {
    "version": "1.8.0",
    "date": "2026-11-17",
    "title": "Lab: experimental tools",
    "items": [
      "Lab tools are experimental and may change. Find them in the Edit menu",
      "Time machine: drag a slider back through every version of your edit, see what changed at each step, and keep the one you like",
      "Edit replay: an animation of how your edit was built, with counters, which you can save as a WebM video for a \"making of\"",
      "Pacing map: cuts per 10 seconds, shot lengths and loudness on one chart. Long shots in quiet parts and very frantic stretches are marked; click to jump there",
      "Sound link: a music or voice clip drives the scale, opacity, rotation or position of another clip, written as keyframes you can edit"
    ]
  },
  {
    "version": "1.7.0",
    "date": "2026-11-17",
    "title": "Voice cleanup, beat grid, animated textures, skins and Bedrock",
    "items": [
      "Clean up voice (right-click a clip): removes steady background noise (hiss, hum, fans, room tone) and low rumble on your computer; the original file is kept and Restore original sound switches back",
      "Beat grid (right-click a music clip): the beats show on the ruler, clips and trims snap to them, and the grid moves with the music; Beats to markers turns them into markers",
      "Blocks: animated textures. Add frames, set the frame time, blend between frames, watch a live preview; the Java pack gets the .png.mcmeta",
      "Blocks: player skin preview with wide or slim arms, the outer layer, classic 64×32 skins and an armour texture on top; new Player skin starter texture",
      "Blocks: Minecraft Bedrock export (.mcpack) with manifest, block and item textures, flipbook animations and block models as Bedrock geometry"
    ]
  },
  {
    "version": "1.6.0",
    "date": "2026-11-17",
    "title": "Multicam, nested clips, your own shortcuts and project starters",
    "items": [
      "Multicam: stack your camera angles, put the playhead on them and choose Layer › Create multicam. NEXORA lines the angles up by their sound",
      "Cut between angles with keys 1–9, live while it plays, or with the angle buttons in the Inspector; pick which angle's sound you hear",
      "Flatten multicam turns your cuts into ordinary clips with one continuous sound track",
      "Nested clips: Layer › Nest clips (In to Out), or right-click › Nest clip, turns part of the edit into one clip you can move, trim, grade and speed up; double-click opens it, Unpack puts the clips back",
      "Keyboard shortcuts editor (View › Keyboard shortcuts): give any Edit command the keys you want, including menu commands that had none; conflicts are cleared for you and Reset puts everything back",
      "Project starters (Home › Templates): YouTube video, Short / Reel / TikTok, Instagram post, Cinematic 4K with 2.39:1 bars and Podcast, each at the right size and frame rate with editable titles and named chapter markers",
      "Save as template (File menu) keeps your own intro and outro layout, without media, for every new project",
      "Proxies & cache (File menu): see and free the space used by proxy copies, rendered previews and downloaded AI models; your projects and media are never touched"
    ]
  },
  {
    "version": "1.5.0",
    "date": "2026-11-17",
    "title": "Named markers, speed ramps and social captions",
    "items": [
      "Markers get names, colours and notes: double-click a marker on the ruler to edit it; names show on the ruler",
      "Marker list (timeline toolbar › Markers): jump, edit or delete, copy YouTube chapters, export a CSV",
      "Names and colours stay on their markers through ripple deletes and speed changes, and the AI Editor can add named markers",
      "Speed ramps: right-click a clip › Ramp: Hero, Montage, Bullet, Speed up, Slow down or Flash. Same footage, the speed follows a curve, later clips move; Remove puts the original clip back",
      "Social captions: Auto captions › Style › Social makes 1–3 word captions in bold capitals with an outline, a pop-in, and the spoken word lit up in light blue"
    ]
  },
  {
    "version": "1.4.1",
    "date": "2026-11-16",
    "title": "One-click updates, released",
    "items": [
      "First published 1.4 build: 1.4.0's release check stopped on a timing problem in the test script (the app itself was fine), so it was never published",
      "Includes everything in 1.4.0 below"
    ]
  },
  {
    "version": "1.4.0",
    "date": "2026-11-16",
    "title": "One-click updates",
    "items": [
      "Update popup: when a new version is out, NEXORA tells you at start (and every 6 hours) with what's new",
      "Update now: downloads the new installer inside the app with progress, checks it against the published SHA-256 checksum, installs it over the old version and reopens NEXORA",
      "After an update, What's new shows everything that changed",
      "Later hides the popup until the next start; Skip this version hides it until a newer one; checks can be turned off in Commands",
      "Every release is now tested by installing the previous version and updating it, exactly as the app does",
      "Version numbers now follow major.minor.patch: the first public release is 1.0.0 (earlier builds were numbered 2.x)"
    ]
  },
  {
    "version": "1.3.0",
    "date": "2026-11-16",
    "title": "Blocks: game textures, block models and resource packs",
    "items": [
      "New Blocks page: paint pixel textures (pencil, fill, line, rectangles, mirror, wrap-shift, tiling preview) and build block or item models from boxes with a live 3D preview",
      "Export a Minecraft Java resource pack (.zip with pack.mcmeta and icon), a sprite atlas (PNG + JSON) for any engine, OBJ + MTL models, or all textures as PNGs",
      "Color page: grade versions A–D per clip, copy the previous clip's grade, and Match still to set a shot's colour and brightness from a reference still",
      "Exports only offer video codecs that really encode on this computer (fixes HEVC failing on some Macs)",
      "Background removal test made reliable across processors; the full test suite runs on Windows, macOS and Linux for every release",
      "Website download buttons only link files a release really has"
    ]
  },
  {
    "version": "1.2.0",
    "date": "2026-11-15",
    "title": "Windows installer, a real logo, What's new and a new website",
    "items": [
      "Windows installer: NEXORA-Studio-Setup-win-x64.exe installs NEXORA with Start menu and desktop shortcuts; uninstall from Settings › Apps",
      "The installer is built from the same tested files as the portable app, installed on a test machine and checked with every test before it is published",
      "New NEXORA logo and app icon: window, taskbar, splash screen, installer, macOS app and Linux launcher",
      "What's new: after an update NEXORA shows what changed, and Help › What's new shows the full history",
      "About NEXORA: version, website, source code and licences in one place",
      "Go to timecode: click a timecode readout and type 01:02:03:04, 1:30:00 or +2:00",
      "macOS and Linux use an installed FFmpeg (Homebrew, apt …) for ProRes, DNxHR and audio export",
      "The pencil draws pixel-sharp edges on every system",
      "New website with every feature, screenshots and this changelog"
    ]
  },
  {
    "version": "1.1.0",
    "date": "2026-11-14",
    "title": "Update notice, automatic builds, secondary grading",
    "items": [
      "Update notice: NEXORA tells you when a newer version is out",
      "Every release is built and tested automatically on Windows, macOS and Linux",
      "Secondary grading on the Color page: pick a colour, limit it with an ellipse or rectangle window, check it with Show matte",
      "One-click 9:16, 1:1 and 4:5 versions of an edit, with the original left untouched",
      "Clip speed presets, track height S / M / L, curves, stills with wipe compare, right-click clip menu with colour labels"
    ]
  },
  {
    "version": "1.0.0",
    "date": "2026-11-14",
    "title": "First public release",
    "items": [
      "Professional workstation layout: titled panels, timecode everywhere, pages along the bottom",
      "Color page: lift / gamma / gain / offset wheels, scopes, auto balance",
      "220+ GPU effects and transitions, 26 looks, .cube LUTs",
      "1,590 original music tracks made on your computer, free to use anywhere",
      "Exports up to 8K: H.264, HEVC, AV1, ProRes, DNxHR",
      "AI Editor with your own key (OpenCode Zen or Anthropic)",
      "Accounts with e-mail codes, two-factor authentication and recovery codes",
      "Viewer guides, crop frames and program audio meters"
    ]
  }
];
