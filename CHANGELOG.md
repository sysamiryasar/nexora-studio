# Changelog

All notable changes to NEXORA Studio. Downloads: https://nexora-editor.pages.dev

## 2.3.0 - 2026-11-16

**Blocks: game textures, block models and resource packs**

- New Blocks page: paint pixel textures (pencil, fill, line, rectangles, mirror, wrap-shift, tiling preview) and build block or item models from boxes with a live 3D preview
- Export a Minecraft Java resource pack (.zip with pack.mcmeta and icon), a sprite atlas (PNG + JSON) for any engine, OBJ + MTL models, or all textures as PNGs
- Color page: grade versions A–D per clip, copy the previous clip's grade, and Match still to set a shot's colour and brightness from a reference still
- Exports only offer video codecs that really encode on this computer (fixes HEVC failing on some Macs)
- Background removal test made reliable across processors; the full test suite now runs on Windows, macOS and Linux for every release
- Website download buttons only link files a release really has

## 2.2.1 - 2026-11-15

**The Windows installer**

- First release with NEXORA-Studio-Setup-win-x64.exe: installs NEXORA with Start menu and desktop shortcuts, uninstall from Settings › Apps
- The installer is built from the same tested files as the portable app; before publishing, it is installed on a test machine and every test runs inside the installed copy
- 2.2.0 was not published: its installer left out the AI Editor's library, which those tests caught

## 2.2.0 - 2026-11-15

**Windows installer, a real logo, What's new and a new website**

- Windows installer: NEXORA-Studio-Setup-win-x64.exe installs NEXORA with Start menu and desktop shortcuts; uninstall from Settings › Apps
- New NEXORA logo and app icon: window, taskbar, splash screen, installer, macOS app and Linux launcher
- What's new: after an update NEXORA shows what changed, and Help › What's new shows the full history
- About NEXORA: version, website, source code and licences in one place
- Go to timecode: click a timecode readout and type 01:02:03:04, 1:30:00 or +2:00
- macOS and Linux use an installed FFmpeg (Homebrew, apt …) for ProRes, DNxHR and audio export
- The pencil draws pixel-sharp edges on every system
- New website with every feature, screenshots and this changelog

## 2.1.0 - 2026-11-14

**Update notice, automatic builds, secondary grading**

- Update notice: NEXORA tells you when a newer version is out (once a day, can be turned off)
- Every release is built and tested automatically on Windows, macOS and Linux
- Secondary grading on the Color page: pick a colour, limit it with an ellipse or rectangle window, check it with Show matte
- One-click 9:16, 1:1 and 4:5 versions of an edit, with the original left untouched
- Clip speed presets, track height S / M / L, curves, stills with wipe compare, right-click clip menu with colour labels

## 2.0.0 - 2026-11-14

**First public release**

- Professional workstation layout: titled panels, timecode everywhere, pages along the bottom
- Color page: lift / gamma / gain / offset wheels, scopes, auto balance
- 220+ GPU effects and transitions, 26 looks, .cube LUTs
- 1,590 original music tracks made on your computer, free to use anywhere
- Exports up to 8K: H.264, HEVC, AV1, ProRes, DNxHR
- AI Editor with your own key (OpenCode Zen or Anthropic)
- Accounts with e-mail codes, two-factor authentication and recovery codes
- Viewer guides, crop frames and program audio meters
