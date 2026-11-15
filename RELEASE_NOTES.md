## What's new in 1.4.0

- Update popup: when a new version is out, NEXORA tells you at start (and every 6 hours) with what's new
- Update now: downloads the new installer inside the app with progress, checks it against the published SHA-256 checksum, installs it over the old version and reopens NEXORA
- After an update, What's new shows everything that changed
- Later hides the popup until the next start; Skip this version hides it until a newer one; checks can be turned off in Commands
- Every release is now tested by installing the previous version and updating it, exactly as the app does
- Version numbers now follow major.minor.patch: the first public release is 1.0.0 (earlier builds were numbered 2.x)

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