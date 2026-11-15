## What's new in 2.2.0

- Windows installer: NEXORA-Studio-Setup-win-x64.exe installs NEXORA with Start menu and desktop shortcuts; uninstall from Settings › Apps
- New NEXORA logo and app icon: window, taskbar, splash screen, installer, macOS app and Linux launcher
- What's new: after an update NEXORA shows what changed, and Help › What's new shows the full history
- About NEXORA: version, website, source code and licences in one place
- Go to timecode: click a timecode readout and type 01:02:03:04, 1:30:00 or +2:00
- macOS and Linux use an installed FFmpeg (Homebrew, apt …) for ProRes, DNxHR and audio export
- The pencil draws pixel-sharp edges on every system
- New website with every feature, screenshots and this changelog

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