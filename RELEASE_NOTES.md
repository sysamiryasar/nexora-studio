## What's new in 1.7.0

- Clean up voice (right-click a clip): removes steady background noise (hiss, hum, fans, room tone) and low rumble on your computer; the original file is kept and Restore original sound switches back
- Beat grid (right-click a music clip): the beats show on the ruler, clips and trims snap to them, and the grid moves with the music; Beats to markers turns them into markers
- Blocks: animated textures. Add frames, set the frame time, blend between frames, watch a live preview; the Java pack gets the .png.mcmeta
- Blocks: player skin preview with wide or slim arms, the outer layer, classic 64×32 skins and an armour texture on top; new Player skin starter texture
- Blocks: Minecraft Bedrock export (.mcpack) with manifest, block and item textures, flipbook animations and block models as Bedrock geometry

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