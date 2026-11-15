## What's new in 2.3.0

- New Blocks page: paint pixel textures (pencil, fill, line, rectangles, mirror, wrap-shift, tiling preview) and build block or item models from boxes with a live 3D preview
- Export a Minecraft Java resource pack (.zip with pack.mcmeta and icon), a sprite atlas (PNG + JSON) for any engine, OBJ + MTL models, or all textures as PNGs
- Color page: grade versions A–D per clip, copy the previous clip's grade, and Match still to set a shot's colour and brightness from a reference still
- Exports only offer video codecs that really encode on this computer (fixes HEVC failing on some Macs)
- Background removal test made reliable across processors; the full test suite now runs on Windows, macOS and Linux for every release
- Website download buttons only link files a release really has

## Download
| File | For |
|---|---|
| **NEXORA-Studio-Setup-win-x64.exe** | Windows 10 / 11, 64-bit **installer**: Start menu and desktop shortcuts, uninstall from Settings > Apps. Includes FFmpeg. |
| NEXORA-Studio-win-x64.zip | Windows portable: unzip anywhere and run `NEXORA Studio.exe`, nothing is installed. |
| NEXORA-Studio-mac-arm64.zip | macOS, Apple silicon |
| NEXORA-Studio-mac-x64.zip | macOS, Intel |
| NEXORA-Studio-linux-x64.zip | Linux x64 |

**Windows:** not code-signed yet, so SmartScreen may say "Windows protected your PC". Choose **More info -> Run anyway** (for the installer and the portable app).
**macOS:** unsigned; follow README-MAC.txt inside the zip once. macOS and Linux use an installed FFmpeg (`brew install ffmpeg`, `sudo apt install ffmpeg`) for ProRes / DNxHR / audio export.

Full history: CHANGELOG.md. MIT licensed. FFmpeg (in the Windows zip) is GPL v3; see THIRD_PARTY_NOTICES.md.