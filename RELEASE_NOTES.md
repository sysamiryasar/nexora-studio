## What's new in 1.8.0

- Lab tools are experimental and may change. Find them in the Edit menu
- Time machine: drag a slider back through every version of your edit, see what changed at each step, and keep the one you like
- Edit replay: an animation of how your edit was built, with counters, which you can save as a WebM video for a "making of"
- Pacing map: cuts per 10 seconds, shot lengths and loudness on one chart. Long shots in quiet parts and very frantic stretches are marked; click to jump there
- Sound link: a music or voice clip drives the scale, opacity, rotation or position of another clip, written as keyframes you can edit

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