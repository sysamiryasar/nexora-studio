## What's new in 1.5.0

- Markers get names, colours and notes: double-click a marker on the ruler to edit it; names show on the ruler
- Marker list (timeline toolbar › Markers): jump, edit or delete, copy YouTube chapters, export a CSV
- Names and colours stay on their markers through ripple deletes and speed changes, and the AI Editor can add named markers
- Speed ramps: right-click a clip › Ramp: Hero, Montage, Bullet, Speed up, Slow down or Flash. Same footage, the speed follows a curve, later clips move; Remove puts the original clip back
- Social captions: Auto captions › Style › Social makes 1–3 word captions in bold capitals with an outline, a pop-in, and the spoken word lit up in light blue

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