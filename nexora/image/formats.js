'use strict';
/* ====================== NEXORA Image — file formats ======================
   Export: PNG, JPEG, WebP (browser encoders), BMP (32-bit), TIFF (RGBA, uncompressed or Deflate), PSD (psd.js), SVG
   (vector layers as real SVG, pixel layers / layers with masks or effects embedded as PNG), native .nxi (layered JSON).
   Import: PNG/JPEG/WebP/BMP/GIF/SVG (browser decoders, SVG is rasterised), TIFF (see decodeTIFF), PSD (psd.js), .nxi. */
NXI.formats = (() => {
  const blobOf = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
  function matte(c, color) { const m = NXI.newCanvas(c.width, c.height), x = m.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, m.width, m.height); x.drawImage(c, 0, 0); return m; }

  /* ---------- BMP (BITMAPINFOHEADER, 32 bpp BGRA, bottom-up) ---------- */
  function encodeBMP(id) {
    const w = id.width, h = id.height, size = 54 + w * h * 4, b = new ArrayBuffer(size), v = new DataView(b);
    v.setUint8(0, 0x42); v.setUint8(1, 0x4D); v.setUint32(2, size, true); v.setUint32(10, 54, true);
    v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 32, true); v.setUint32(34, w * h * 4, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
    const d = id.data; let o = 54;
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; v.setUint8(o++, d[i + 2]); v.setUint8(o++, d[i + 1]); v.setUint8(o++, d[i]); v.setUint8(o++, d[i + 3]); }
    return new Blob([b], { type: 'image/bmp' });
  }
  /* ---------- TIFF ---------- */
  const streamBytes = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  /** baseline RGBA TIFF; compression 'none' | 'deflate' (Adobe Deflate, zlib, with horizontal predictor) — async */
  async function encodeTIFF(id, compression) {
    const w = id.width, h = id.height, deflate = compression === 'deflate';
    let pix = id.data;
    if (deflate) { const p = new Uint8Array(pix); for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 1; x--) for (let c = 0; c < 4; c++) { const i = (y * w + x) * 4 + c; p[i] = (p[i] - p[i - 4]) & 255; } pix = await streamBytes(p, new CompressionStream('deflate')); }
    const n = deflate ? 15 : 14, ifd = 8, extra = ifd + 2 + n * 12 + 4, bps = extra, xres = bps + 8, yres = xres + 8, data = yres + 8, size = data + pix.length;
    const b = new ArrayBuffer(size), v = new DataView(b); v.setUint16(0, 0x4949); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, n, true);
    let e = ifd + 2; const ent = (tag, type, count, val) => { v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true); if (type === 3 && count === 1) v.setUint16(e + 8, val, true); else v.setUint32(e + 8, val, true); e += 12; };
    ent(256, 4, 1, w); ent(257, 4, 1, h); ent(258, 3, 4, bps); ent(259, 3, 1, deflate ? 8 : 1); ent(262, 3, 1, 2); ent(273, 4, 1, data); ent(277, 3, 1, 4); ent(278, 4, 1, h); ent(279, 4, 1, pix.length); ent(282, 5, 1, xres); ent(283, 5, 1, yres); ent(284, 3, 1, 1); ent(296, 3, 1, 2); if (deflate) ent(317, 3, 1, 2); ent(338, 3, 1, 2);
    v.setUint32(e, 0, true); for (let k = 0; k < 4; k++) v.setUint16(bps + k * 2, 8, true); v.setUint32(xres, 72, true); v.setUint32(xres + 4, 1, true); v.setUint32(yres, 72, true); v.setUint32(yres + 4, 1, true);
    new Uint8Array(b, data).set(pix); return new Blob([b], { type: 'image/tiff' });
  }
  /** TIFF reader: strips or tiles; 1 / 8 / 16 / 32-bit (unsigned or float) samples; contiguous or planar; gray,
      RGB(A), palette, CMYK; none / LZW / PackBits / Deflate / JPEG (new-style, with JPEGTables) compression; horizontal
      predictor. The first image (IFD) is read; deeper samples are scaled to the 8-bit document. Async (Deflate and
      JPEG use the browser's decoders). */
  async function decodeTIFF(buf) {
    const v = new DataView(buf), le = v.getUint16(0) === 0x4949; if (!le && v.getUint16(0) !== 0x4D4D) throw new Error('Not a TIFF file');
    const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le); if (u16(2) === 43) throw new Error('BigTIFF is not supported'); if (u16(2) !== 42) throw new Error('Not a TIFF file');
    const ifd = u32(4), n = u16(ifd), tags = {}, size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4), bytes = (size[type] || 1) * count, off = bytes <= 4 ? e + 8 : u32(e + 8), vals = [];
      if (tag === 347) { tags[tag] = new Uint8Array(buf, off, count); continue; }   // JPEGTables: raw bytes
      for (let k = 0; k < Math.min(count, 1 << 20); k++) vals.push(type === 3 ? u16(off + k * 2) : type === 4 ? u32(off + k * 4) : type === 5 ? u32(off + k * 8) / u32(off + k * 8 + 4) : v.getUint8(off + k));
      tags[tag] = vals;
    }
    const w = tags[256][0], h = tags[257][0], spp = (tags[277] || [1])[0], bps = (tags[258] || [1])[0], comp = (tags[259] || [1])[0], photo = (tags[262] || [spp >= 3 ? 2 : 1])[0], pred = (tags[317] || [1])[0];
    const planar = (tags[284] || [1])[0] === 2, fmt = (tags[339] || [1])[0], extra = (tags[338] || [])[0], cmap = tags[320];
    if (![1, 8, 16, 32].includes(bps)) throw new Error(bps + '-bit TIFF samples are not supported (1, 8, 16 and 32-bit are)');
    if (![1, 5, 7, 8, 32773, 32946].includes(comp)) throw new Error('TIFF compression ' + comp + ' is not supported (none, LZW, PackBits, Deflate and JPEG are)');
    if (w * h > 268e6) throw new Error('Image too large');
    const tiled = !!tags[322], bw = tiled ? tags[322][0] : w, bh = tiled ? tags[323][0] : Math.min(h, (tags[278] || [h])[0]), offs = tiled ? tags[324] : tags[273], counts = tiled ? tags[325] : tags[279];
    const across = Math.ceil(w / bw), down = Math.ceil(h / bh), per = across * down, B = bps / 8;
    // decoded samples, normalised to 0…255 floats per channel: S[c][y*w+x]
    const nch = planar ? spp : spp, S = Array.from({ length: spp }, () => new Float32Array(w * h));
    const jpeg = comp === 7, tbl = tags[347];
    for (let k = 0; k < offs.length; k++) {
      const plane = planar ? Math.floor(k / per) : 0, kk = planar ? k % per : k, bx = (kk % across) * bw, by = Math.floor(kk / across) * bh, rows = tiled ? bh : Math.min(bh, h - by), cps = planar ? 1 : spp;
      const rowBytes = Math.ceil(bw * cps * bps / 8), need = rowBytes * rows;
      let raw = new Uint8Array(buf, offs[k], counts[k]);
      if (jpeg) {   // browser JPEG decoder; JPEGTables (minus its EOI) + strip (minus its SOI)
        let bytes = raw; if (tbl && tbl.length > 4) { bytes = new Uint8Array(tbl.length - 2 + raw.length - 2); bytes.set(tbl.subarray(0, tbl.length - 2)); bytes.set(raw.subarray(2), tbl.length - 2); }
        const bm = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })), c = NXI.newCanvas(bm.width, bm.height), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0);
        const d = x.getImageData(0, 0, bm.width, bm.height).data;
        for (let y = 0; y < Math.min(rows, bm.height); y++) for (let xx = 0; xx < Math.min(bw, bm.width); xx++) { const X = bx + xx, Y = by + y; if (X >= w || Y >= h) continue; const s = (y * bm.width + xx) * 4, di = Y * w + X; for (let c2 = 0; c2 < Math.min(3, spp); c2++) S[c2][di] = d[s + c2]; }
        continue;
      }
      if (comp === 32773) raw = unpackBits(raw, need); else if (comp === 5) raw = lzw(raw, need); else if (comp === 8 || comp === 32946) raw = await streamBytes(raw, new DecompressionStream('deflate')); else raw = new Uint8Array(raw);
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const get = (o) => bps === 8 ? raw[o] : bps === 16 ? dv.getUint16(o, le) : fmt === 3 ? dv.getFloat32(o, le) : dv.getUint32(o, le);
      const set16 = (o, val) => dv.setUint16(o, val & 65535, le), set8 = (o, val) => { raw[o] = val & 255; };
      if (pred === 2 && bps >= 8 && fmt !== 3) for (let y = 0; y < rows; y++) for (let i = cps; i < bw * cps; i++) { const o = y * rowBytes + i * B, p = o - cps * B; if (o + B > raw.length) break; if (bps === 8) set8(o, raw[o] + raw[p]); else if (bps === 16) set16(o, dv.getUint16(o, le) + dv.getUint16(p, le)); else dv.setUint32(o, dv.getUint32(o, le) + dv.getUint32(p, le), le); }
      const scale = bps === 8 ? 1 : bps === 16 ? 255 / 65535 : fmt === 3 ? 255 : 255 / 4294967295;
      for (let y = 0; y < rows; y++) { const Y = by + y; if (Y >= h) break;
        for (let xx = 0; xx < bw; xx++) { const X = bx + xx; if (X >= w) break; const di = Y * w + X;
          for (let c2 = 0; c2 < cps; c2++) { const ch = planar ? plane : c2;
            let val; if (bps === 1) { const bit = (y * rowBytes * 8) + xx * cps + c2; val = (raw[bit >> 3] >> (7 - (bit & 7))) & 1 ? 255 : 0; } else { const o = y * rowBytes + (xx * cps + c2) * B; if (o + B > raw.length) continue; val = get(o) * scale; }
            S[ch][di] = val; } } }
    }
    const out = new Uint8ClampedArray(w * h * 4), hasA = (photo <= 1 && spp > 1) || (photo === 2 && spp > 3) || (photo === 5 && spp > 4), aIdx = photo <= 1 ? 1 : photo === 5 ? 4 : 3, premulA = extra === 1;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      let r, g, b;
      if (photo <= 1) { let q = S[0][i]; if (photo === 0) q = 255 - q; r = g = b = q; }
      else if (photo === 3 && cmap) { const ix = Math.round(bps === 8 ? S[0][i] : S[0][i] / 255 * ((1 << bps) - 1)), m = cmap.length / 3; r = cmap[ix] / 257; g = cmap[m + ix] / 257; b = cmap[2 * m + ix] / 257; }
      else if (photo === 5) { const K = S[3] ? S[3][i] / 255 : 0; r = (255 - S[0][i]) * (1 - K); g = (255 - S[1][i]) * (1 - K); b = (255 - S[2][i]) * (1 - K); }
      else { r = S[0][i]; g = S[1] ? S[1][i] : r; b = S[2] ? S[2][i] : r; }
      let a = hasA ? S[aIdx][i] : 255; if (premulA && a > 0 && a < 255) { r = r * 255 / a; g = g * 255 / a; b = b * 255 / a; }
      out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = a;
    }
    return new ImageData(out, w, h);
  }
  function unpackBits(src, n) { const out = new Uint8Array(n); let i = 0, o = 0; while (i < src.length && o < n) { const c = (src[i++] << 24) >> 24; if (c >= 0) { for (let k = 0; k <= c && o < n; k++) out[o++] = src[i++]; } else if (c !== -128) { const b = src[i++]; for (let k = 0; k < 1 - c && o < n; k++) out[o++] = b; } } return out; }
  function lzw(src, n) {
    const out = new Uint8Array(n); let o = 0, bitPos = 0, width = 9, dict = [], prev = null;
    const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict[i] = [i]; dict[256] = dict[257] = null; width = 9; };
    const read = () => { let v = 0; for (let k = 0; k < width; k++) { const byte = src[(bitPos + k) >> 3]; if (byte === undefined) return 257; v = (v << 1) | ((byte >> (7 - ((bitPos + k) & 7))) & 1); } bitPos += width; return v; };
    reset();
    while (o < n) {
      const code = read(); if (code === 257) break;
      if (code === 256) { reset(); const c2 = read(); if (c2 === 257) break; const e = dict[c2]; for (const b of e) out[o++] = b; prev = e; continue; }
      const entry = code < dict.length && dict[code] ? dict[code] : prev.concat(prev[0]);
      for (const b of entry) { if (o < n) out[o++] = b; }
      dict.push(prev.concat(entry[0])); prev = entry;
      if (dict.length + 1 >= (1 << width) && width < 12) width++;
    }
    return out;
  }
  /* ---------- SVG ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function svgOf(doc) {
    let defs = '', gid = 0;
    const blend = L => L.blend !== 'source-over' ? ` style="mix-blend-mode:${L.blend === 'lighter' ? 'plus-lighter' : L.blend}"` : '';
    const asImage = L => { const t = NXI.layerImage(L, doc), c = NXI.newCanvas(doc.w, doc.h); c.getContext('2d').drawImage(t.c, t.x, t.y); if (t.temp) NXI.give(t.c); return `<image href="${c.toDataURL('image/png')}" x="0" y="0" width="${doc.w}" height="${doc.h}" opacity="${L.opacity / 100}"${blend(L)}/>`; };
    const tf = L => { const t = L.tr; return `translate(${t.x} ${t.y}) rotate(${t.rot}) scale(${t.sx / 100} ${t.sy / 100})`; };
    const grad = (c1, c2, ang) => { const id = 'g' + (++gid), a = ang * Math.PI / 180; defs += `<linearGradient id="${id}" x1="${50 - Math.cos(a) * 50}%" y1="${50 - Math.sin(a) * 50}%" x2="${50 + Math.cos(a) * 50}%" y2="${50 + Math.sin(a) * 50}%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`; return `url(#${id})`; };
    function shapeEl(S) {
      const w = S.w, h = S.h, fill = !S.fillOn || S.kind === 'line' ? 'none' : S.grad ? grad(S.fill, S.fill2, S.gAngle) : S.fill, st = S.strokeW > 0 || S.kind === 'line' ? ` stroke="${S.stroke}" stroke-width="${Math.max(1, S.strokeW)}" stroke-linejoin="round" stroke-linecap="round"` : '';
      const poly = (k, star) => { const n = star ? k * 2 : k, pts = []; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n, r = star && i % 2 ? .45 : 1; pts.push((Math.cos(a) * w / 2 * r).toFixed(2) + ',' + (Math.sin(a) * h / 2 * r).toFixed(2)); } return `<polygon points="${pts.join(' ')}" fill="${fill}"${st}/>`; };
      switch (S.kind) {
        case 'rect': return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${Math.min(S.radius, w / 2, h / 2)}" fill="${fill}"${st}/>`;
        case 'ellipse': return `<ellipse cx="0" cy="0" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${st}/>`;
        case 'polygon': return poly(Math.max(3, S.points | 0)); case 'star': return poly(Math.max(3, S.points | 0), true);
        case 'line': return `<line x1="${-w / 2}" y1="0" x2="${w / 2}" y2="0"${st}/>`;
        case 'path': { const p = S.pts; let dd = `M${p[0].x} ${p[0].y}`; for (let i = 1; i < p.length; i++) dd += ` C${p[i - 1].ox} ${p[i - 1].oy} ${p[i].ix} ${p[i].iy} ${p[i].x} ${p[i].y}`; if (S.closed && p.length > 2) { const a = p[p.length - 1]; dd += ` C${a.ox} ${a.oy} ${p[0].ix} ${p[0].iy} ${p[0].x} ${p[0].y}Z`; } return `<path d="${dd}" fill="${fill}"${st}/>`; }
      }
      return '';
    }
    function textEl(X) {
      const lines = X.str.split('\n'), lh = X.size * X.lineH, anchor = X.align === 'left' ? 'start' : X.align === 'right' ? 'end' : 'middle';
      const c = NXI.textCanvas({ text: X }), pad = 0, xoff = X.align === 'left' ? -c.width / 2 + Math.ceil(X.size * .3 + X.strokeW * 2 + (X.shadow ? X.shBlur * 2 + Math.abs(X.shX) + Math.abs(X.shY) : 0)) : X.align === 'right' ? c.width / 2 - Math.ceil(X.size * .3 + X.strokeW * 2 + (X.shadow ? X.shBlur * 2 + Math.abs(X.shX) + Math.abs(X.shY) : 0)) : 0;
      const fill = X.grad ? grad(X.color, X.c2, X.gAngle) : X.color, st = X.strokeW > 0 ? ` stroke="${X.stroke}" stroke-width="${X.strokeW * 2}" paint-order="stroke" stroke-linejoin="round"` : '';
      const tt = { upper: 'uppercase', lower: 'lowercase', cap: 'capitalize' }[X.case] || 'none';
      return `<text font-family="${esc(X.font)}, sans-serif" font-size="${X.size}" font-weight="${X.weight}" font-style="${X.italic ? 'italic' : 'normal'}" letter-spacing="${X.tracking / 1000 * X.size}" text-anchor="${anchor}" dominant-baseline="middle" style="text-transform:${tt}" fill="${fill}"${st}>` + lines.map((l, i) => `<tspan x="${xoff + pad}" y="${(i - (lines.length - 1) / 2) * lh}">${esc(l) || ' '}</tspan>`).join('') + '</text>';
    }
    function emit(list) {
      let s = '';
      for (const L of list) {
        if (!L.visible || L.type === 'adjust') { if (L.type === 'adjust' && L.visible) s += `<!-- adjustment layer "${esc(L.name)}" cannot be expressed in SVG and was skipped -->`; continue; }
        // wrapped paragraph text and text on a path are embedded as pixels (their layout is NEXORA's, not the SVG viewer's)
        if (L.type === 'raster' || (L.mask && L.mask.on) || NXI.hasFx(L) || L.clip || (L.type === 'text' && (L.text.boxW > 0 || L.text.path))) { s += asImage(L); continue; }
        if (L.type === 'group') { s += `<g opacity="${L.opacity / 100}"${blend(L)}>${emit(L.children)}</g>`; continue; }
        s += `<g transform="${tf(L)}" opacity="${L.opacity / 100}"${blend(L)}>${L.type === 'text' ? textEl(L.text) : shapeEl(L.shape)}</g>`;
      }
      return s;
    }
    const body = emit(doc.layers);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.w}" height="${doc.h}" viewBox="0 0 ${doc.w} ${doc.h}"><defs>${defs}</defs>${body}</svg>`;
  }
  /* ---------- public ---------- */
  async function exportBlob(doc, fmt, quality) {
    const comp = NXI.flatten(doc), q = (quality || 92) / 100;
    switch (fmt) {
      case 'png': return blobOf(comp, 'image/png');
      case 'jpeg': return blobOf(matte(comp, '#ffffff'), 'image/jpeg', q);
      case 'webp': return blobOf(comp, 'image/webp', q);
      case 'bmp': return encodeBMP(comp.getContext('2d').getImageData(0, 0, comp.width, comp.height));
      case 'tiff': return encodeTIFF(comp.getContext('2d').getImageData(0, 0, comp.width, comp.height));
      case 'tiffz': return encodeTIFF(comp.getContext('2d').getImageData(0, 0, comp.width, comp.height), 'deflate');
      case 'psd': return NXI.psd.write(doc);
      case 'svg': return new Blob([svgOf(doc)], { type: 'image/svg+xml' });
      case 'nxi': return new Blob([JSON.stringify(await NXI.toJSON(doc))], { type: 'application/json' });
    }
    throw new Error('Unknown format ' + fmt);
  }
  const loadImage = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file could not be decoded as an image.')); i.src = url; });
  /** decode a File into a drawable source (canvas/image) + name; throws with a clear message for unsupported files */
  async function decodeFile(f) {
    const name = f.name.replace(/\.[^.]+$/, ''), ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'psd' || ext === 'psb') return { doc: await NXI.psd.read(await f.arrayBuffer(), name) };
    if (ext === 'nxi') return { doc: await NXI.fromJSON(JSON.parse(await f.text())) };
    if (ext === 'tif' || ext === 'tiff' || f.type === 'image/tiff') { const id = await decodeTIFF(await f.arrayBuffer()), c = NXI.newCanvas(id.width, id.height); c.getContext('2d').putImageData(id, 0, 0); return { src: c, name }; }
    if (!f.type.startsWith('image/') && !['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'avif'].includes(ext)) throw new Error(`"${f.name}" is not a supported image file.`);
    const url = URL.createObjectURL(f); try { const img = await loadImage(url); if (ext === 'svg' && !img.naturalWidth) throw new Error('SVG has no intrinsic size'); const c = NXI.newCanvas(img.naturalWidth || 1024, img.naturalHeight || 1024); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return { src: c, name }; } finally { URL.revokeObjectURL(url); }
  }
  /* ---------- brush presets file format (docs/BRUSH_FORMAT.md) ---------- */
  const BRUSH_KEYS = ['size', 'hardness', 'opacity', 'flow', 'spacing', 'angle', 'roundness', 'scatter', 'sizeJitter', 'texture', 'textureScale', 'pressureSize', 'pressureOpacity', 'smoothing'];
  function brushToJSON(name, b) { const o = { format: 'nexora-brush', version: 1, name }; BRUSH_KEYS.forEach(k => o[k] = b[k]); o.tip = b.tip || null; return o; }
  function brushFromJSON(o) {
    if (o.format === 'nexora-brush-set') return o.brushes.map(brushFromJSON).flat();
    if (o.format !== 'nexora-brush') throw new Error('Not a NEXORA brush file (missing "format": "nexora-brush")'); if (o.version > 1) throw new Error('Brush file version ' + o.version + ' is newer than this app');
    const b = {}; BRUSH_KEYS.forEach(k => { if (o[k] !== undefined) b[k] = o[k]; }); if (o.tip && !/^data:image\//.test(o.tip)) throw new Error('Brush tip must be a data:image URL'); b.tip = o.tip || null;
    return [{ name: String(o.name || 'Imported brush').slice(0, 40), b }];
  }
  return { exportBlob, encodeBMP, encodeTIFF, decodeTIFF, svgOf, decodeFile, brushToJSON, brushFromJSON, unpackBits, lzw };
})();
