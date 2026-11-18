## What's new in 1.6.0

- Multicam: stack your camera angles, put the playhead on them and choose Edit › Create multicam. NEXORA lines the angles up by their sound
- Cut between angles with keys 1–9, live while it plays, or with the angle buttons in the Inspector; pick which angle's sound you hear
- Flatten multicam turns your cuts into ordinary clips with one continuous sound track
- Nested clips: Edit › Nest clips (In to Out), or right-click › Nest clip, turns part of the edit into one clip you can move, trim, grade and speed up; double-click opens it, Unpack puts the clips back

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