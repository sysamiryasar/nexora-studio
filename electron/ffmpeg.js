'use strict';
/* ====================== NEXORA ↔ FFmpeg bridge (desktop app) ======================
   The bundled FFmpeg build (vendor/ffmpeg/<platform>-<arch>/, GPL, licence beside it) gives the desktop app
     • professional masters: Apple ProRes 422 Proxy/LT/422/HQ/4444/4444 XQ, Avid DNxHR LB/SQ/HQ/HQX/444, GoPro CineForm
     • software H.264 (x264), HEVC (x265), AV1 (libaom) and VP9 (libvpx) — so every codec works on every PC, not only
       on machines whose GPU driver exposes a hardware encoder to WebCodecs
     • image sequences (PNG / TIFF) and audio-only masters (WAV 24-bit)
     • "optimized media" for files Chromium cannot decode (ProRes, DNxHR, MXF, AVI, MKV with odd codecs, TIFF, EXR, …)
   The page never passes raw command-line arguments: it sends a structured job and this module builds the command,
   so the sandboxed renderer cannot run arbitrary FFmpeg filters/protocols. Frames are rendered by the page (exactly
   as for MP4 export) and streamed as raw RGBA over stdin. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

let BIN = null, INFO = null;
function binPath() {
  if (BIN !== null) return BIN;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dir = path.join(__dirname, '..', 'vendor', 'ffmpeg', process.platform + '-' + process.arch).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  const p = path.join(dir, exe); if (fs.existsSync(p)) return (BIN = p);
  // no bundled copy (macOS / Linux builds): use an FFmpeg the user installed (Homebrew, MacPorts, apt, dnf, snap…).
  // Apps started from the Finder / a desktop launcher get a minimal PATH, so the usual install folders are searched too.
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/snap/bin']);
  for (const d of dirs) { if (!d) continue; const c = path.join(d, exe); try { if (fs.statSync(c).isFile()) { BIN = c; SYSTEM = true; return BIN; } } catch (e) { } }
  return (BIN = '');
}
let SYSTEM = false;
const NOFF = process.platform === 'darwin' ? 'FFmpeg was not found. Install it with Homebrew (brew install ffmpeg) and restart NEXORA.' : process.platform === 'linux' ? 'FFmpeg was not found. Install it (for example sudo apt install ffmpeg) and restart NEXORA.' : 'FFmpeg is not bundled with this build.';
function run(args, opts = {}) {
  return new Promise((res, rej) => {
    const b = binPath(); if (!b) return rej(new Error(NOFF));
    const p = spawn(b, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
    p.stdout.on('data', d => { out += d; if (out.length > 4e6) out = out.slice(-2e6); });
    p.stderr.on('data', d => { err += d; if (opts.onErr) opts.onErr(String(d)); if (err.length > 4e6) err = err.slice(-2e6); });
    p.on('error', rej); p.on('close', code => res({ code, out, err }));
    if (opts.track) opts.track(p);
  });
}
async function probe() {
  if (INFO) return INFO;
  if (!binPath()) return (INFO = { available: false });
  try {
    const v = await run(['-hide_banner', '-version']), e = await run(['-hide_banner', '-encoders']);
    const enc = new Set(); for (const l of e.out.split('\n')) { const m = /^\s[VAS][.A-Z]{5}\s+(\S+)/.exec(l); if (m) enc.add(m[1]); }
    INFO = { available: true, system: SYSTEM, version: (/ffmpeg version (\S+)/.exec(v.out) || [])[1] || '?', encoders: [...enc] };
  } catch (e) { INFO = { available: false, error: String(e.message || e) }; }
  return INFO;
}

/* ---------- codec table (what the export dialog offers) ---------- */
// ext · video args · pixel format · audio args · whether it carries alpha
const CODECS = {
  prores_proxy: { enc: 'prores_ks', ext: 'mov', v: ['-c:v', 'prores_ks', '-profile:v', '0', '-vendor', 'apl0'], pix: 'yuv422p10le', a: 'pcm' },
  prores_lt: { enc: 'prores_ks', ext: 'mov', v: ['-c:v', 'prores_ks', '-profile:v', '1', '-vendor', 'apl0'], pix: 'yuv422p10le', a: 'pcm' },
  prores_422: { enc: 'prores_ks', ext: 'mov', v: ['-c:v', 'prores_ks', '-profile:v', '2', '-vendor', 'apl0'], pix: 'yuv422p10le', a: 'pcm' },
  prores_hq: { enc: 'prores_ks', ext: 'mov', v: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0'], pix: 'yuv422p10le', a: 'pcm' },
  prores_4444: { enc: 'prores_ks', ext: 'mov', v: ['-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0', '-alpha_bits', '16'], pix: 'yuva444p10le', a: 'pcm', alpha: true },
  prores_4444xq: { enc: 'prores_ks', ext: 'mov', v: ['-c:v', 'prores_ks', '-profile:v', '5', '-vendor', 'apl0', '-alpha_bits', '16'], pix: 'yuva444p10le', a: 'pcm', alpha: true },
  dnxhr_lb: { enc: 'dnxhd', ext: 'mov', v: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb'], pix: 'yuv422p', a: 'pcm' },
  dnxhr_sq: { enc: 'dnxhd', ext: 'mov', v: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_sq'], pix: 'yuv422p', a: 'pcm' },
  dnxhr_hq: { enc: 'dnxhd', ext: 'mov', v: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq'], pix: 'yuv422p', a: 'pcm' },
  dnxhr_hqx: { enc: 'dnxhd', ext: 'mov', v: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx'], pix: 'yuv422p10le', a: 'pcm' },
  dnxhr_444: { enc: 'dnxhd', ext: 'mov', v: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_444'], pix: 'yuv444p10le', a: 'pcm' },
  cineform: { enc: 'cfhd', ext: 'mov', v: ['-c:v', 'cfhd', '-quality', 'film1'], pix: 'yuv422p10le', a: 'pcm' },
  x264: { enc: 'libx264', ext: 'mp4', v: ['-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high'], pix: 'yuv420p', a: 'aac', rate: true },
  x265: { enc: 'libx265', ext: 'mp4', v: ['-c:v', 'libx265', '-preset', 'medium', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'], pix: 'yuv420p', a: 'aac', rate: true },
  x265_10: { enc: 'libx265', ext: 'mp4', v: ['-c:v', 'libx265', '-preset', 'medium', '-tag:v', 'hvc1', '-profile:v', 'main10', '-x265-params', 'log-level=error'], pix: 'yuv420p10le', a: 'aac', rate: true },
  aom_av1: { enc: 'libaom-av1', ext: 'mp4', v: ['-c:v', 'libaom-av1', '-cpu-used', '6', '-row-mt', '1', '-tiles', '2x2'], pix: 'yuv420p', a: 'aac', rate: true },
  vpx_vp9: { enc: 'libvpx-vp9', ext: 'mp4', v: ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '3', '-row-mt', '1'], pix: 'yuv420p', a: 'aac', rate: true },
  png_seq: { enc: 'png', ext: 'png', seq: true, v: ['-c:v', 'png'], pix: 'rgba', a: null, rgb: true, alpha: true },
  tiff_seq: { enc: 'tiff', ext: 'tif', seq: true, v: ['-c:v', 'tiff', '-compression_algo', 'deflate'], pix: 'rgba', a: null, rgb: true, alpha: true },
  wav: { enc: 'pcm_s24le', ext: 'wav', audioOnly: true, a: 'wav', args: ['-c:a', 'pcm_s24le'] },
  mp3: { enc: 'libmp3lame', ext: 'mp3', audioOnly: true, a: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
  flac: { enc: 'flac', ext: 'flac', audioOnly: true, a: 'flac', args: ['-c:a', 'flac'] },
  aac: { enc: 'aac', ext: 'm4a', audioOnly: true, a: 'aac', args: ['-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart'] }
};
const RATIONAL = { 23.976: '24000/1001', 29.97: '30000/1001', 59.94: '60000/1001', 47.952: '48000/1001', 119.88: '120000/1001' };
const fpsArg = f => RATIONAL[+f] || String(+f);

/* ---------- export jobs ---------- */
const jobs = new Map(); let jobN = 0;
function buildArgs(s, wavPath) {
  const c = CODECS[s.codec]; if (!c) throw new Error('Unknown codec ' + s.codec);
  const W = s.w | 0, H = s.h | 0; if (!c.audioOnly && (W < 16 || H < 16 || W > 16384 || H > 16384)) throw new Error('Bad frame size');
  const a = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y'];
  if (!c.audioOnly) a.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', fpsArg(s.fps), '-i', 'pipe:0');
  if (wavPath) a.push('-i', wavPath);
  if (c.audioOnly) { a.push('-map', '0:a', ...c.args, '-ar', '48000'); return a.concat([s.out]); }
  a.push('-map', '0:v'); if (wavPath && c.a) a.push('-map', '1:a');
  // optional output size that differs from the rendered frame (even dimensions, Lanczos)
  const oW = s.outW | 0, oH = s.outH | 0, resize = oW >= 16 && oH >= 16 && oW <= 16384 && oH <= 16384 && !(oW % 2) && !(oH % 2) && (oW !== W || oH !== H), size = resize ? `${oW}:${oH}:` : '';
  if (c.rgb) { if (resize) a.push('-vf', `scale=${oW}:${oH}:flags=lanczos`); a.push('-pix_fmt', c.pix); }
  else {
    // sRGB/Rec.709 RGB in → limited-range Rec.709 YUV out, accurately rounded, full chroma resolution before subsampling
    a.push('-vf', `scale=${size}out_color_matrix=bt709:out_range=tv:flags=${resize ? 'lanczos+' : ''}accurate_rnd+full_chroma_int+full_chroma_inp,format=${c.pix},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`);
    a.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv');
  }
  a.push(...c.v);
  if (c.rate) { if (s.crf != null) { a.push('-crf', String(s.crf | 0)); if (s.codec === 'aom_av1' || s.codec === 'vpx_vp9') a.push('-b:v', '0'); } else { const b = Math.max(1, Math.min(400, +s.mbps || 16)); a.push('-b:v', b + 'M', '-maxrate', Math.round(b * 1.5) + 'M', '-bufsize', b * 2 + 'M'); } a.push('-g', String(Math.max(1, Math.round((+s.fps || 30) * 2)))); }
  if (wavPath && c.a) a.push(...(c.a === 'pcm' ? ['-c:a', 'pcm_s24le'] : ['-c:a', 'aac', '-b:a', '320k']), '-ar', '48000');
  if (c.ext === 'mp4') a.push('-movflags', '+faststart');
  if (c.ext === 'mov') a.push('-movflags', '+write_colr');
  if (c.seq) a.push('-start_number', '0');
  a.push(s.out); return a;
}
async function start(spec, wav) {
  const c = CODECS[spec.codec]; if (!c) throw new Error('Unknown codec ' + spec.codec);
  const info = await probe(); if (!info.available) throw new Error(NOFF);
  if (!info.encoders.includes(c.enc)) throw new Error('This FFmpeg build has no ' + c.enc + ' encoder.');
  if (!spec.out || !path.isAbsolute(spec.out)) throw new Error('Output path must be absolute');
  let out = spec.out;
  if (c.seq) { await fsp.mkdir(out, { recursive: true }); out = path.join(out, (spec.base || 'frame').replace(/[<>:"/\\|?*%]+/g, '_') + '_%06d.' + c.ext); }
  else await fsp.mkdir(path.dirname(out), { recursive: true });
  let wavPath = null;
  if (wav && wav.byteLength) { wavPath = path.join(os.tmpdir(), `nexora-mix-${process.pid}-${++jobN}.wav`); await fsp.writeFile(wavPath, Buffer.from(wav)); }
  const args = buildArgs({ ...spec, out }, wavPath), id = ++jobN;
  const p = spawn(binPath(), args, { windowsHide: true, stdio: [c.audioOnly ? 'ignore' : 'pipe', 'ignore', 'pipe'] });
  const J = { p, err: '', wavPath, out: spec.out, seq: !!c.seq, done: null, frames: 0, broken: null };
  p.stderr.on('data', d => { J.err = (J.err + d).slice(-8000); });
  if (p.stdin) p.stdin.on('error', e => { J.broken = e; });
  J.done = new Promise(r => { p.on('close', code => r(code)); p.on('error', e => { J.broken = e; r(-1); }); });
  jobs.set(id, J); return { id, args: args.map(x => (x === wavPath ? '<mix.wav>' : x)) };
}
async function frame(id, buf) {
  const J = jobs.get(id); if (!J) throw new Error('No such export job');
  if (J.broken) throw new Error('FFmpeg stopped: ' + (J.err.trim().split('\n').pop() || J.broken.message));
  const ok = J.p.stdin.write(Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength)); J.frames++;
  if (!ok) await new Promise((r, j) => { const t = () => { J.p.stdin.off('drain', t); r(); }; J.p.stdin.on('drain', t); J.done.then(() => r()); });
  return J.frames;
}
async function finish(id) {
  const J = jobs.get(id); if (!J) throw new Error('No such export job');
  if (J.p.stdin) J.p.stdin.end(); const code = await J.done; jobs.delete(id);
  if (J.wavPath) fsp.rm(J.wavPath, { force: true }).catch(() => { });
  if (code !== 0) throw new Error('FFmpeg failed (' + code + '): ' + (J.err.trim().split('\n').slice(-3).join(' ') || 'no output'));
  let size = 0; try { if (!J.seq) size = (await fsp.stat(J.out)).size; } catch (e) { }
  return { out: J.out, frames: J.frames, size };
}
async function cancel(id) {
  const J = jobs.get(id); if (!J) return false; jobs.delete(id);
  try { J.p.kill(); } catch (e) { } await J.done;
  if (J.wavPath) fsp.rm(J.wavPath, { force: true }).catch(() => { });
  if (!J.seq) fsp.rm(J.out, { force: true }).catch(() => { });
  return true;
}

/* ---------- media info + optimized media for files Chromium cannot decode ---------- */
function parseInfo(err) {
  const o = { video: null, audio: null, dur: 0 };
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err); if (d) o.dur = +d[1] * 3600 + +d[2] * 60 + +d[3];
  const v = /Stream #[^\n]*?Video: ([a-z0-9_]+)[^\n]*?, (\d{2,5})x(\d{2,5})[^\n]*/.exec(err);
  if (v) { const f = /([\d.]+) fps/.exec(v[0]) || /([\d.]+) tbr/.exec(v[0]); o.video = { codec: v[1], w: +v[2], h: +v[3], fps: f ? +f[1] : 0, alpha: /yuva|rgba|argb|bgra|gbrap|ya8|ya16/.test(v[0]), still: /\b(png|mjpeg|tiff|exr|bmp|webp|psd|dpx|targa|sgi|jpeg2000|hdr)\b/.test(v[1]) && !d }; }
  const a = /Stream #[^\n]*?Audio: ([a-z0-9_]+)[^\n]*/.exec(err); if (a) o.audio = { codec: a[1], ch: /stereo/.test(a[0]) ? 2 : /mono/.test(a[0]) ? 1 : 2 };
  return o;
}
async function info(p) { const r = await run(['-hide_banner', '-i', p]); return parseInfo(r.err); }
const tasks = new Map();
/** transcode `input` to an edit-friendly file: H.264 (CRF 12, 1-second GOP) + AAC for video, FLAC for audio, PNG for stills.
    Progress (0…1) is reported to the window that asked. */
async function optimize(sender, input, output, kind) {
  const inf = await info(input); if (!inf.video && !inf.audio) throw new Error('FFmpeg cannot read this file.');
  await fsp.mkdir(path.dirname(output), { recursive: true });
  let a;
  if (kind === 'image' || (inf.video && inf.video.still)) a = ['-hide_banner', '-y', '-i', input, '-frames:v', '1', '-pix_fmt', inf.video && inf.video.alpha ? 'rgba' : 'rgb24', output];
  else if (kind === 'audio' || !inf.video) a = ['-hide_banner', '-y', '-i', input, '-vn', '-c:a', 'flac', '-ar', '48000', output];
  else {
    const g = String(Math.max(1, Math.round(inf.video.fps || 30)));
    a = ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'faster', '-crf', '12', '-g', g, '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:flags=accurate_rnd', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', output];
  }
  const key = output; let proc = null;
  const r = await run(a, { track: p => { proc = p; tasks.set(key, p); }, onErr: s => { const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s); if (m && inf.dur && !sender.isDestroyed()) sender.send('nxff:progress', output, Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / inf.dur)); } });
  tasks.delete(key);
  if (r.code !== 0) { fsp.rm(output, { force: true }).catch(() => { }); throw new Error(proc && proc.killed ? 'Cancelled' : 'FFmpeg could not convert this file: ' + r.err.trim().split('\n').slice(-2).join(' ')); }
  return { output, info: inf };
}
/** writes a clip's audio to its own file. Structured input only: the page cannot pass FFmpeg arguments. */
async function extractAudio(o) {
  const c = CODECS[o.format]; if (!c || !c.audioOnly) throw new Error('Unknown audio format');
  if (!path.isAbsolute(String(o.input)) || !path.isAbsolute(String(o.out))) throw new Error('Paths must be absolute');
  const inf = await info(o.input); if (!inf.audio) throw new Error('This clip has no audio track.');
  await fsp.mkdir(path.dirname(o.out), { recursive: true });
  const a = ['-hide_banner', '-loglevel', 'error', '-y'], from = Math.max(0, +o.from || 0), dur = +o.dur || 0, sp = +o.speed || 1; if (from) a.push('-ss', from.toFixed(3)); if (dur > 0) a.push('-t', dur.toFixed(3));
  a.push('-i', o.input, '-vn', '-map', '0:a:0');
  if (Math.abs(sp - 1) > 1e-3) { const f = []; let v = sp; while (v > 2) { f.push('atempo=2'); v /= 2; } while (v < .5) { f.push('atempo=0.5'); v *= 2; } f.push('atempo=' + v.toFixed(5)); a.push('-filter:a', f.join(',')); }
  a.push(...c.args, '-ar', '48000', o.out);
  const r = await run(a); if (r.code !== 0) { fsp.rm(o.out, { force: true }).catch(() => { }); throw new Error('Could not extract the audio: ' + r.err.trim().split('\n').slice(-2).join(' ')); }
  return { out: o.out, size: (await fsp.stat(o.out)).size };
}
function cancelOptimize(output) { const p = tasks.get(output); if (p) { p.kill(); return true; } return false; }

function register(ipcMain, app, log) {
  const h = (ch, fn) => ipcMain.handle('nxff:' + ch, (e, ...a) => fn(e, ...a));
  h('probe', () => probe());
  h('codecs', () => Object.fromEntries(Object.entries(CODECS).map(([k, c]) => [k, { enc: c.enc, ext: c.ext, seq: !!c.seq, alpha: !!c.alpha, audioOnly: !!c.audioOnly, rate: !!c.rate }])));
  h('start', (_e, spec, wav) => start(spec, wav).catch(e => { log && log('ffmpeg start', e); throw e; }));
  h('frame', (_e, id, buf) => frame(id, buf));
  h('finish', (_e, id) => finish(id));
  h('cancel', (_e, id) => cancel(id));
  h('info', (_e, p) => info(p));
  h('optimize', (e, input, output, kind) => optimize(e.sender, input, output, kind));
  h('cancelOptimize', (_e, output) => cancelOptimize(output));
  h('extractAudio', (_e, o) => extractAudio(o));
  h('cacheDir', () => path.join(app.getPath('userData'), 'Optimized Media'));
  h('saveDialog', async (e, o) => { const { dialog, BrowserWindow } = require('electron'); const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { title: o.title || 'Export', defaultPath: o.defaultPath, filters: o.filters }); return r.canceled ? null : r.filePath; });
  app.on('will-quit', () => { for (const J of jobs.values()) try { J.p.kill(); } catch (e) { } for (const p of tasks.values()) try { p.kill(); } catch (e) { } });
}
module.exports = { register, buildArgs, CODECS, parseInfo };
