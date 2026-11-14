'use strict';
/* ====================== NEXORA Image — Photoshop PSD read / write ======================
   Implemented from Adobe's "Photoshop File Formats Specification" (PSD, version 1).
   Read:  RGB and Grayscale, 8 or 16 bits per channel; pixel layers with position, opacity, blend mode, visibility,
          clipping, Unicode names ('luni'), layer masks (user mask channel −2, with its default colour outside the
          mask rectangle), groups ('lsct' section dividers, open / closed, pass-through), raw / RLE / ZIP / ZIP+prediction
          channel data, 16-bit layer data stored in 'Lr16'. A PSD without layers loads its merged image.
          Type layers, smart objects, adjustment layers and layer styles come in as the pixels Photoshop stored for
          them (editable text and live effects are not reconstructed).
   Write: layered RGB 8-bit PSD — pixel layers (text and shape layers are rasterised; layer effects are baked into
          the pixels), groups, masks, blend modes, opacity, visibility, clipping, Unicode names, RLE compression, plus the
          flattened composite. Adjustment layers cannot be written as Photoshop adjustment descriptors: they are left
          out of the layer list (their effect is in the composite image) and reported.
   Not supported: PSB (large document format), CMYK / Lab / indexed / bitmap / 32-bit documents. */
NXI.psd = (() => {
  const BLEND = { 'source-over': 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over', darken: 'dark', lighten: 'lite', 'color-dodge': 'div ', 'color-burn': 'idiv', 'hard-light': 'hLit', 'soft-light': 'sLit', difference: 'diff', exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ', lighter: 'lddg' };
  const UNBLEND = Object.fromEntries(Object.entries(BLEND).map(([a, b]) => [b, a]));
  const inflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());

  /* ---------- reader ---------- */
  class R {
    constructor(buf) { this.v = new DataView(buf); this.b = new Uint8Array(buf); this.p = 0; }
    u8() { return this.v.getUint8(this.p++); } u16() { const x = this.v.getUint16(this.p); this.p += 2; return x; } i16() { const x = this.v.getInt16(this.p); this.p += 2; return x; }
    u32() { const x = this.v.getUint32(this.p); this.p += 4; return x; } i32() { const x = this.v.getInt32(this.p); this.p += 4; return x; }
    str(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.p + i]); this.p += n; return s; }
    bytes(n) { const a = this.b.subarray(this.p, this.p + n); this.p += n; return a; }
    pascal(pad) { const n = this.u8(); const s = this.str(n); const t = (n + 1) % pad; if (t) this.p += pad - t; return s; }
    ustr() { const n = this.u32(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16()); return s.replace(/\0+$/, ''); }
  }
  function unpackRow(src, p, len, out, o) { const end = p + len; while (p < end) { const n = (src[p++] << 24) >> 24; if (n >= 0) { for (let k = 0; k <= n; k++) out[o++] = src[p++]; } else if (n !== -128) { const b = src[p++]; for (let k = 0; k < 1 - n; k++) out[o++] = b; } } return o; }
  /** channel data → Uint8Array of w*h 8-bit samples */
  async function channel(r, w, h, depth, len, rowCountsOf) {
    const start = r.p, comp = r.u16(), bpc = depth / 8, n = w * h; let raw;
    if (!w || !h) { r.p = start + len; return new Uint8Array(0); }
    if (comp === 0) raw = r.bytes(w * h * bpc);
    else if (comp === 1) {
      const counts = []; for (let y = 0; y < h; y++) counts.push(r.u16()); raw = new Uint8Array(w * h * bpc); let o = 0;
      for (let y = 0; y < h; y++) { unpackRow(r.b, r.p, counts[y], raw, o); r.p += counts[y]; o += w * bpc; }
    } else if (comp === 2 || comp === 3) {
      raw = await inflate(r.b.subarray(r.p, start + len)); r.p = start + len;
      if (comp === 3) { if (bpc === 1) { for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) raw[y * w + x] = (raw[y * w + x] + raw[y * w + x - 1]) & 255; } else { const dv = new DataView(raw.buffer, raw.byteOffset); for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) { const o = (y * w + x) * 2; dv.setUint16(o, (dv.getUint16(o) + dv.getUint16(o - 2)) & 65535); } } }
    } else throw new Error('PSD channel compression ' + comp + ' is not supported');
    if (len != null) r.p = start + len;
    if (bpc === 1) return raw;
    const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = raw[i * 2];   // 16-bit → 8-bit (high byte, big-endian)
    return out;
  }
  async function layerInfo(r, depth, doc, ctxArr) {
    let count = r.i16(); count = Math.abs(count); const recs = [];
    for (let i = 0; i < count; i++) {
      const L = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), ch: [] }; const nc = r.u16();
      for (let c = 0; c < nc; c++) L.ch.push({ id: r.i16(), len: r.u32() });
      if (r.str(4) !== '8BIM') throw new Error('Bad PSD layer record'); L.blend = r.str(4); L.opacity = r.u8(); L.clip = r.u8(); L.flags = r.u8(); r.u8();
      const extraLen = r.u32(), extraEnd = r.p + extraLen;
      const mlen = r.u32(); if (mlen) { const ms = r.p; L.mask = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), def: r.u8(), flags: r.u8() }; r.p = ms + mlen; }
      const blen = r.u32(); r.p += blen;
      L.name = r.pascal(4);
      while (r.p < extraEnd - 11) {
        const sig = r.str(4); if (sig !== '8BIM' && sig !== '8B64') break; const key = r.str(4), len = r.u32(), s = r.p;
        if (key === 'luni') L.name = r.ustr() || L.name; else if (key === 'lsct' || key === 'lsdk') { L.section = r.u32(); if (len >= 12) { r.p += 4; L.sectBlend = r.str(4); } }
        r.p = s + len;
      }
      r.p = extraEnd; recs.push(L);
    }
    for (const L of recs) {
      const w = L.right - L.left, h = L.bottom - L.top;
      for (const c of L.ch) {
        const mw = c.id === -2 && L.mask ? L.mask.right - L.mask.left : w, mh = c.id === -2 && L.mask ? L.mask.bottom - L.mask.top : h;
        c.data = await channel(r, mw, mh, depth, c.len);
      }
    }
    return recs;
  }
  function toLayer(doc, rec) {
    const L = NXI.mkLayer(doc, 'raster', { name: rec.name }), w = rec.right - rec.left, h = rec.bottom - rec.top;
    L.opacity = Math.round(rec.opacity / 255 * 100); L.visible = !(rec.flags & 2); L.clip = rec.clip === 1; L.blend = UNBLEND[rec.blend] || 'source-over';
    if (w > 0 && h > 0) {
      const id = new ImageData(w, h), d = id.data, get = k => (rec.ch.find(c => c.id === k) || {}).data;
      const R0 = get(0), G = get(1) || R0, B = get(2) || R0, A = get(-1);
      for (let i = 0, j = 0; i < w * h; i++, j += 4) { d[j] = R0 ? R0[i] : 0; d[j + 1] = G ? G[i] : 0; d[j + 2] = B ? B[i] : 0; d[j + 3] = A ? A[i] : 255; }
      L.canvas.getContext('2d').putImageData(id, rec.left, rec.top);
    }
    const M = rec.ch.find(c => c.id === -2);
    if (M && rec.mask) {
      const mw = rec.mask.right - rec.mask.left, mh = rec.mask.bottom - rec.mask.top, mc = NXI.newCanvas(doc.w, doc.h), x = mc.getContext('2d');
      if (rec.mask.def) { x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h); }
      if (mw > 0 && mh > 0) { const id = new ImageData(mw, mh); for (let i = 0, j = 0; i < mw * mh; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = M.data[i]; } x.clearRect(rec.mask.left, rec.mask.top, mw, mh); x.putImageData(id, rec.mask.left, rec.mask.top); }
      L.mask = { canvas: mc, on: !(rec.mask.flags & 2), density: 100, v: 0 };
    }
    return L;
  }
  async function read(buf, name) {
    const r = new R(buf); if (r.str(4) !== '8BPS') throw new Error('Not a Photoshop file');
    const ver = r.u16(); if (ver === 2) throw new Error('PSB (Large Document Format) files are not supported — save as PSD.'); if (ver !== 1) throw new Error('Unknown PSD version ' + ver);
    r.p += 6; const nch = r.u16(), H = r.u32(), W = r.u32(), depth = r.u16(), mode = r.u16();
    if (![1, 3].includes(mode)) throw new Error('Only RGB and Grayscale PSD files are supported (this one uses colour mode ' + mode + ').');
    if (![8, 16].includes(depth)) throw new Error(depth + '-bit PSD files are not supported (8 and 16-bit are).');
    const skip = () => { const n = r.u32(); r.p += n; };   // (not r.p += r.u32(): the left side would be read first)
    skip();                             // colour mode data
    skip();                             // image resources
    const doc = NXI.newDoc({ w: W, h: H, name: name || 'PSD' });
    const lmLen = r.u32(), lmEnd = r.p + lmLen; let recs = [];
    if (lmLen) {
      const liLen = r.u32(), liEnd = r.p + liLen; if (liLen) recs = await layerInfo(r, depth, doc); r.p = liEnd;
      if (r.p < lmEnd) skip();          // global layer mask info
      while (!recs.length && r.p < lmEnd - 12) {   // 16 / 32-bit documents keep their layers in Lr16 / Lr32
        const sig = r.str(4); if (sig !== '8BIM' && sig !== '8B64') break; const key = r.str(4), len = r.u32(), s = r.p;
        if (key === 'Lr16' || key === 'Lr32') recs = await layerInfo(r, key === 'Lr16' ? 16 : 32, doc);
        r.p = s + len + (len & 1 ? 1 : 0);
      }
    }
    r.p = lmEnd;
    if (recs.length) {
      // records are bottom → top; a section divider (lsct 3) opens a group whose header record (lsct 1/2) comes after its children
      const stack = [doc.layers];
      for (const rec of recs) {
        if (rec.section === 3) { stack.push([]); continue; }
        if (rec.section === 1 || rec.section === 2) {
          const kids = stack.length > 1 ? stack.pop() : []; const G = NXI.mkLayer(doc, 'group', { name: rec.name }); G.children = kids; G.open = rec.section === 1;
          G.opacity = Math.round(rec.opacity / 255 * 100); G.visible = !(rec.flags & 2); const bk = rec.sectBlend || rec.blend; G.blend = bk === 'pass' ? 'source-over' : UNBLEND[bk] || 'source-over';
          stack[stack.length - 1].push(G); continue;
        }
        stack[stack.length - 1].push(toLayer(doc, rec));
      }
      while (stack.length > 1) { const kids = stack.pop(); stack[stack.length - 1].push(...kids); }   // unbalanced dividers: keep the layers
    } else {
      // flat PSD: merged image data
      const comp = r.u16(), bpc = depth / 8, planes = []; let counts = null;
      if (comp === 1) { counts = []; for (let i = 0; i < nch * H; i++) counts.push(r.u16()); }
      for (let c = 0; c < nch; c++) {
        const out = new Uint8Array(W * H * bpc);
        if (comp === 0) out.set(r.bytes(W * H * bpc)); else if (comp === 1) { let o = 0; for (let y = 0; y < H; y++) { const n = counts[c * H + y]; unpackRow(r.b, r.p, n, out, o); r.p += n; o += W * bpc; } } else throw new Error('Unsupported PSD image compression ' + comp);
        planes.push(bpc === 1 ? out : out.filter((_, i) => !(i & 1)));
      }
      const L = NXI.mkLayer(doc, 'raster', { name: 'Background' }), id = new ImageData(W, H), d = id.data, gray = mode === 1;
      for (let i = 0, j = 0; i < W * H; i++, j += 4) { d[j] = planes[0][i]; d[j + 1] = gray ? planes[0][i] : planes[1][i]; d[j + 2] = gray ? planes[0][i] : planes[2][i]; d[j + 3] = (gray ? nch > 1 : nch > 3) ? planes[gray ? 1 : 3][i] : 255; }
      L.canvas.getContext('2d').putImageData(id, 0, 0); doc.layers.push(L);
    }
    let last = null; NXI.walk(doc.layers, L => { if (L.type !== 'group') last = L; }); doc.activeId = last ? last.id : null;
    return doc;
  }

  /* ---------- writer ---------- */
  class Wr {
    constructor() { this.parts = []; this.n = 0; }
    push(a) { this.parts.push(a); this.n += a.length; }
    u8(x) { this.push(Uint8Array.of(x & 255)); } u16(x) { this.push(Uint8Array.of((x >> 8) & 255, x & 255)); } i16(x) { this.u16(x & 65535); }
    u32(x) { this.push(Uint8Array.of((x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255)); } i32(x) { this.u32(x >>> 0); }
    str(s) { this.push(Uint8Array.from(s, c => c.charCodeAt(0) & 255)); }
    pascal(s, pad) { const b = Uint8Array.from(s.slice(0, 255), c => { const k = c.charCodeAt(0); return k < 256 ? k : 63; }); this.u8(b.length); this.push(b); let t = (b.length + 1) % pad; if (t) this.push(new Uint8Array(pad - t)); }
    out() { const a = new Uint8Array(this.n); let o = 0; for (const p of this.parts) { a.set(p, o); o += p.length; } return a; }
  }
  /** PackBits one row */
  function packRow(src, s, n) {
    const out = []; let i = 0;
    while (i < n) {
      let j = i; while (j < n - 1 && j - i < 127 && src[s + j] === src[s + j + 1]) j++;
      if (j > i) { out.push((1 - (j - i + 1)) & 255, src[s + i]); i = j + 1; continue; }
      j = i; while (j < n && j - i < 128 && !(j < n - 1 && src[s + j] === src[s + j + 1])) j++;
      out.push(j - i - 1); for (let k = i; k < j; k++) out.push(src[s + k]); i = j;
    }
    return Uint8Array.from(out);
  }
  /** one plane (w×h) → RLE-compressed channel data { counts, rows } */
  function rle(plane, w, h) { const rows = []; for (let y = 0; y < h; y++) rows.push(packRow(plane, y * w, w)); return rows; }
  function channelBlock(plane, w, h) {   // compression 1 + row byte counts + rows
    const rows = rle(plane, w, h), wr = new Wr(); wr.u16(1); rows.forEach(r => wr.u16(r.length)); rows.forEach(r => wr.push(r)); return wr.out();
  }
  function bounds(d, W, H) { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { left: x0, top: y0, right: x1 + 1, bottom: y1 + 1 }; }
  function addInfo(wr, key, body) { wr.str('8BIM'); wr.str(key); const pad = (4 - body.length % 4) % 4; wr.u32(body.length + pad); wr.push(body); if (pad) wr.push(new Uint8Array(pad)); }
  const luni = name => { const w = new Wr(); w.u32(name.length + 1); for (const c of name) w.u16(c.charCodeAt(0)); w.u16(0); return w.out(); };
  /** flat list of PSD layer records (bottom → top) for a NEXORA layer tree */
  function records(doc, list, out, skipped) {
    for (const L of list) {
      if (L.type === 'adjust') { skipped.push(L.name); continue; }
      if (L.type === 'group') {
        out.push({ name: '</Layer group>', section: 3, visible: true, opacity: 100, blend: 'norm', clip: false });
        records(doc, L.children, out, skipped);
        out.push({ name: L.name, section: L.open ? 1 : 2, visible: L.visible, opacity: L.opacity, blend: 'pass', sectBlend: L.blend === 'source-over' ? 'pass' : BLEND[L.blend] || 'norm', clip: false });
        continue;
      }
      // pixels: content + baked layer effects, without the mask (written as its own channel), opacity or blend mode
      const c = NXI.layerPixels(doc, L), d = c.getContext('2d').getImageData(0, 0, doc.w, doc.h).data, b = bounds(d, doc.w, doc.h);
      const rec = { name: L.name, visible: L.visible, opacity: L.opacity, blend: BLEND[L.blend] || 'norm', clip: !!L.clip, rect: b || { left: 0, top: 0, right: 0, bottom: 0 }, planes: [] };
      if (b) { const w = b.right - b.left, h = b.bottom - b.top; for (const ci of [3, 0, 1, 2]) { const p = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y * w + x] = d[((b.top + y) * doc.w + b.left + x) * 4 + ci]; rec.planes.push({ id: ci === 3 ? -1 : ci, data: channelBlock(p, w, h) }); } }
      else for (const id of [-1, 0, 1, 2]) rec.planes.push({ id, data: Uint8Array.of(0, 0) });
      if (L.mask) {
        const md = L.mask.canvas.getContext('2d').getImageData(0, 0, doc.w, doc.h).data, p = new Uint8Array(doc.w * doc.h); for (let i = 0; i < p.length; i++) p[i] = md[i * 4 + 3];
        rec.mask = { left: 0, top: 0, right: doc.w, bottom: doc.h, def: 0, flags: L.mask.on ? 0 : 2 }; rec.planes.push({ id: -2, data: channelBlock(p, doc.w, doc.h) });
      }
      out.push(rec);
    }
    return out;
  }
  async function write(doc) {
    const W = doc.w, H = doc.h, skipped = [], recs = records(doc, doc.layers, [], skipped), wr = new Wr();
    wr.str('8BPS'); wr.u16(1); wr.push(new Uint8Array(6)); wr.u16(3); wr.u32(H); wr.u32(W); wr.u16(8); wr.u16(3);
    wr.u32(0);                                                 // colour mode data
    const res = new Wr(); res.str('8BIM'); res.u16(1005); res.u16(0); res.u32(16); res.u32(72 << 16); res.u16(1); res.u16(1); res.u32(72 << 16); res.u16(1); res.u16(1);   // 72 ppi
    const resB = res.out(); wr.u32(resB.length); wr.push(resB);
    // layer info
    const li = new Wr(); li.i16(recs.length);
    for (const r of recs) {
      const rect = r.rect || { left: 0, top: 0, right: 0, bottom: 0 }, planes = r.planes || [-1, 0, 1, 2].map(id => ({ id, data: Uint8Array.of(0, 0) }));
      li.i32(rect.top); li.i32(rect.left); li.i32(rect.bottom); li.i32(rect.right); li.u16(planes.length); for (const p of planes) { li.i16(p.id); li.u32(p.data.length); }
      li.str('8BIM'); li.str(r.blend); li.u8(Math.round(r.opacity / 100 * 255)); li.u8(r.clip ? 1 : 0); li.u8((r.visible ? 0 : 2) | 8); li.u8(0);
      const ex = new Wr();
      if (r.mask) { ex.u32(20); ex.i32(r.mask.top); ex.i32(r.mask.left); ex.i32(r.mask.bottom); ex.i32(r.mask.right); ex.u8(r.mask.def); ex.u8(r.mask.flags); ex.u16(0); } else ex.u32(0);
      ex.u32(0); ex.pascal(r.name, 4); addInfo(ex, 'luni', luni(r.name));
      if (r.section) { const s = new Wr(); s.u32(r.section); if (r.section !== 3) { s.str('8BIM'); s.str(r.sectBlend || 'pass'); } addInfo(ex, 'lsct', s.out()); }
      const exB = ex.out(); li.u32(exB.length); li.push(exB);
      r._planes = planes;
    }
    for (const r of recs) for (const p of r._planes) li.push(p.data);
    let liB = li.out(); if (liB.length & 1) { const t = new Uint8Array(liB.length + 1); t.set(liB); liB = t; }
    const lm = new Wr(); lm.u32(liB.length); lm.push(liB); lm.u32(0);  // + empty global layer mask info
    const lmB = lm.out(); wr.u32(lmB.length); wr.push(lmB);
    // merged composite (RGB, RLE), matted on white like Photoshop's "maximize compatibility" preview
    const comp = NXI.flatten(doc), mc = NXI.newCanvas(W, H), mx = mc.getContext('2d'); mx.fillStyle = '#fff'; mx.fillRect(0, 0, W, H); mx.drawImage(comp, 0, 0);
    const cd = mx.getImageData(0, 0, W, H).data, all = [];
    for (let c = 0; c < 3; c++) { const p = new Uint8Array(W * H); for (let i = 0; i < p.length; i++) p[i] = cd[i * 4 + c]; all.push(rle(p, W, H)); }
    wr.u16(1); for (const rows of all) rows.forEach(r => wr.u16(r.length)); for (const rows of all) rows.forEach(r => wr.push(r));
    const blob = new Blob([wr.out()], { type: 'image/vnd.adobe.photoshop' }); blob.skipped = skipped; return blob;
  }
  return { read, write, packRow, BLEND };
})();
