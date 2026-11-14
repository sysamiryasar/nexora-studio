# Third-party software

NEXORA Studio's own code is MIT licensed (see LICENSE). These components ship with it under their own licenses.

| Component | Version | License | Where |
|---|---|---|---|
| FFmpeg (essentials build by Gyan Doshi) | 9.0.2 | GPL v3 | `vendor/ffmpeg/win32-x64/` (downloaded by `scripts/fetch-vendor.ps1`). Run as a separate, unmodified program. Source: https://ffmpeg.org/download.html |
| Electron | 33.2.0 | MIT | Desktop runtime in the release packages |
| three.js | bundled | MIT | `vendor/three.min.js`, `vendor/LICENSE-three.txt` |
| Paper.js | bundled | MIT | `vendor/paper-core.min.js`, `vendor/LICENSE-paper.txt` |
| mp4-muxer | bundled | MIT | `vendor/mp4-muxer.js` |
| @huggingface/transformers + ONNX Runtime Web | 3.3.3 | Apache-2.0 / MIT | `vendor/ai/`, `vendor/ai/LICENSE-transformers.txt` |
| Whisper tiny.en, Whisper base, MODNet (Xenova ONNX exports) | — | Apache-2.0 | `vendor/ai/models/` (weights downloaded by `scripts/fetch-vendor.ps1`) |
| Anthropic TypeScript SDK and its dependencies | 1.6.0 | MIT / Apache-2.0 | `vendor/anthropic/node_modules/` (each package keeps its LICENSE) |
| MgOpen / three.js typeface fonts | — | see file | `vendor/fonts/LICENSE-MgOpen.txt` |

Because the Windows release includes FFmpeg (GPL v3), anyone redistributing that release must keep FFmpeg's license with it and make FFmpeg's source available (the link above). NEXORA's own code stays MIT.

Music in the app is synthesised on the user's computer from NEXORA's own code. Creative Commons music found through the in-app search keeps the license shown next to each track.
