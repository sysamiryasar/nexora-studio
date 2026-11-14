'use strict';
/* QR code encoder (ISO/IEC 18004, byte mode, error correction level M, versions 1-20): enough for an otpauth:// enrolment URI.
   encode(text) → { size, rows: ['0101…', …] }, 1 = dark module. Written here so the 2FA setup works with no extra dependency. */
const ECC_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const rawModules = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC_M[v] * BLOCKS_M[v];

/* GF(256), polynomial 0x11D */
function gfMul(a, b) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((b >>> i) & 1) * a; } return z; }
function rsDivisor(deg) { const r = new Array(deg - 1).fill(0).concat([1]); let root = 1; for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gfMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = gfMul(root, 2); } return r; }
function rsRemainder(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => r[i] ^= gfMul(c, f)); } return r; }

function encode(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let ver = 0; for (let v = 1; v <= 20; v++) { const cc = v < 10 ? 8 : 16; if (Math.ceil((4 + cc + bytes.length * 8) / 8) <= dataCodewords(v)) { ver = v; break; } }
  if (!ver) throw new Error('Text too long for a QR code');
  /* data bits: mode 0100, length, payload, terminator, padding */
  const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  const cap = dataCodewords(ver) * 8; put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  /* blocks + error correction, interleaved */
  const nb = BLOCKS_M[ver], ecl = ECC_M[ver], raw = Math.floor(rawModules(ver) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(ecl), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k + shortLen - ecl + (i < nShort ? 0 : 1)); k += d.length; const e = rsRemainder(d, div); if (i < nShort) d.push(-1); blocks.push(d.concat(e)); }
  const final = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach(b => { if (b[i] !== -1) final.push(b[i]); });
  /* function patterns */
  const size = ver * 4 + 17, m = [], fn = []; for (let y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
  const set = (x, y, v) => { m[y][x] = !!v; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let d = -4; d <= 4; d++) for (let e = -4; e <= 4; e++) { const x = cx + e, y = cy + d, r = Math.max(Math.abs(d), Math.abs(e)); if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, r !== 2 && r !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, pos = [6]; for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    pos.forEach((py, i) => pos.forEach((px, j) => { if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return; for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) set(px + e, py + d, Math.max(Math.abs(d), Math.abs(e)) !== 1); }));
  }
  const format = mask => {
    const d = mask;                                         // level M = 00
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, g = i => (b >>> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, g(i)); set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i)); set(8, size - 8, 1);
  };
  format(0);
  if (ver >= 7) { let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (ver << 12) | r; for (let i = 0; i < 18; i++) { const v = (b >>> i) & 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, v); set(c, a, v); } }
  /* data modules, zig-zag */
  let i = 0; const nBits = final.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert; if (!fn[y][x] && i < nBits) { m[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; } } }
  /* choose the mask with the lowest penalty */
  const MASK = [(x, y) => (x + y) % 2, (x, y) => y % 2, x => x % 3, (x, y) => (x + y) % 3, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2, (x, y) => x * y % 2 + x * y % 3, (x, y) => (x * y % 2 + x * y % 3) % 2, (x, y) => ((x + y) % 2 + x * y % 3) % 2];
  const apply = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASK[k](x, y) === 0) m[y][x] = !m[y][x]; };
  const penalty = () => {
    let s = 0, dark = 0; const run = get => { for (let a = 0; a < size; a++) { let n = 1; for (let b = 1; b < size; b++) { if (get(a, b) === get(a, b - 1)) { n++; if (n === 5) s += 3; else if (n > 5) s++; } else n = 1; } } };
    run((a, b) => m[a][b]); run((a, b) => m[b][a]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { if (m[y][x]) dark++; if (y < size - 1 && x < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) s += 3; }
    return s + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0, low = Infinity;
  for (let k = 0; k < 8; k++) { apply(k); format(k); const p = penalty(); if (p < low) { low = p; best = k; } apply(k); }
  apply(best); format(best);
  return { size, version: ver, mask: best, rows: m.map(r => r.map(v => v ? '1' : '0').join('')) };
}
module.exports = { encode };
