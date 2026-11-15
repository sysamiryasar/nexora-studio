'use strict';
/* ====================== NEXORA zip writer ======================
   A small, dependency-free ZIP (store method, no compression) writer for exports that games and tools read:
   Minecraft resource packs, texture atlases, model bundles. PNGs are already compressed, so storing them loses
   nothing. Also a reader for the same format (tests and re-import). */
const Zip = (() => {
  const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const enc = new TextEncoder();
  const bytes = d => d instanceof Uint8Array ? d : typeof d === 'string' ? enc.encode(d) : new Uint8Array(d);
  function dosTime(d) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }
  /** files: [{ name: 'a/b.png', data: Uint8Array | ArrayBuffer | string }] → Blob (application/zip) */
  function build(files) {
    const parts = [], central = [], { time, date } = dosTime(new Date()); let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name.replace(/\\/g, '/').replace(/^\/+/, '')), data = bytes(f.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }
  /** read a stored (uncompressed) zip → [{ name, data: Uint8Array, crcOk }] */
  function read(buf) {
    const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength); let e = b.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('Not a zip file');
    const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const out = [], dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Broken zip directory'); const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl)), lnl = v.getUint16(lo + 26, true), lxl = v.getUint16(lo + 28, true), data = b.subarray(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + size);
      out.push({ name, data, method, crcOk: method === 0 && crc32(data) === crc }); p += 46 + nl + xl + cl;
    }
    return out;
  }
  return { build, read, crc32 };
})();
