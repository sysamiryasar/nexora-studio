'use strict';
/* ====================== NEXORA Image — destructive filters ======================
   Pixel kernels run in a Web Worker (built from a Blob so it also works under file:// and Electron),
   keeping the UI responsive on large images. If workers are unavailable the same kernels run inline. */
function NXI_KERNELS() {
  const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : v;
  function boxBlurPremult(d, w, h, r) {
    const n = w * h, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0, j = 0; j < n; i += 4, j++) { const a = d[i + 3] / 255; ch[0][j] = d[i] * a; ch[1][j] = d[i + 1] * a; ch[2][j] = d[i + 2] * a; ch[3][j] = d[i + 3]; }
    const tmp = new Float32Array(n), rad = Math.max(1, Math.round(r));
    const pass = (src, dst, horiz) => {
      const len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, k = 1 / (2 * rad + 1);
      for (let l = 0; l < lines; l++) {
        const base = horiz ? l * w : l; let acc = 0;
        for (let i = -rad; i <= rad; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step];
        for (let i = 0; i < len; i++) { dst[base + i * step] = acc * k; acc += src[base + Math.min(len - 1, i + rad + 1) * step] - src[base + Math.max(0, i - rad) * step]; }
      }
    };
    for (const c of ch) for (let it = 0; it < 3; it++) { pass(c, tmp, true); pass(tmp, c, false); }
    for (let i = 0, j = 0; j < n; i += 4, j++) { const a = ch[3][j]; d[i + 3] = a; const ia = a > 0 ? 255 / a : 0; d[i] = clamp8(ch[0][j] * ia); d[i + 1] = clamp8(ch[1][j] * ia); d[i + 2] = clamp8(ch[2][j] * ia); }
  }
  const gauss = (d, w, h, p) => { if (p.r > 0) boxBlurPremult(d, w, h, p.r / 2); };
  function unsharp(d, w, h, p) { const b = new Uint8ClampedArray(d); boxBlurPremult(b, w, h, Math.max(.5, p.r / 2)); const k = p.amount / 100; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const diff = d[i + c] - b[i + c]; if (Math.abs(diff) >= p.threshold) d[i + c] = clamp8(d[i + c] + diff * k); } }
  function noise(d, w, h, p) {
    let s = (p.seed || 1) * 9301 + 49297; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const g = () => { let u = 0; for (let k = 0; k < 4; k++) u += rnd(); return (u - 2) * 1.2; };
    for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; if (p.mono) { const n = (p.gaussian ? g() : rnd() * 2 - 1) * p.amount * 2.55; d[i] = clamp8(d[i] + n); d[i + 1] = clamp8(d[i + 1] + n); d[i + 2] = clamp8(d[i + 2] + n); } else for (let c = 0; c < 3; c++) d[i + c] = clamp8(d[i + c] + (p.gaussian ? g() : rnd() * 2 - 1) * p.amount * 2.55); }
  }
  function median(d, w, h, p) {
    const r = Math.max(1, Math.min(3, p.r | 0)), s = new Uint8ClampedArray(d), buf = new Uint8Array((2 * r + 1) ** 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let n = 0; for (let dy = -r; dy <= r; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -r; dx <= r; dx++) buf[n++] = s[(yy * w + Math.min(w - 1, Math.max(0, x + dx))) * 4 + c]; }
      const a = buf.subarray(0, n); a.sort(); d[(y * w + x) * 4 + c] = a[n >> 1];
    }
  }
  function motion(d, w, h, p) {
    const s = new Uint8ClampedArray(d), n = Math.max(1, Math.round(p.dist)), a = p.angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0, al = 0, k = 0; for (let t = -n; t <= n; t += Math.max(1, n / 12)) { const xx = Math.round(x + ux * t), yy = Math.round(y + uy * t); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const i = (yy * w + xx) * 4; r += s[i]; g += s[i + 1]; b += s[i + 2]; al += s[i + 3]; k++; } const i = (y * w + x) * 4; d[i] = r / k; d[i + 1] = g / k; d[i + 2] = b / k; d[i + 3] = al / k; }
  }
  function pixelate(d, w, h, p) { const z = Math.max(2, p.size | 0); for (let by = 0; by < h; by += z) for (let bx = 0; bx < w; bx += z) { const t = [0, 0, 0, 0]; let n = 0; for (let y = by; y < Math.min(h, by + z); y++) for (let x = bx; x < Math.min(w, bx + z); x++) { const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) t[c] += d[i + c]; n++; } for (let y = by; y < Math.min(h, by + z); y++) for (let x = bx; x < Math.min(w, bx + z); x++) { const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) d[i + c] = t[c] / n; } } }
  function convolve(d, w, h, k, bias, gray) {
    const s = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; let r = 0, g = 0, b = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const q = (Math.min(h - 1, Math.max(0, y + j)) * w + Math.min(w - 1, Math.max(0, x + i))) * 4, kv = k[(j + 1) * 3 + i + 1]; r += s[q] * kv; g += s[q + 1] * kv; b += s[q + 2] * kv; } if (gray) { const v = clamp8((r * .299 + g * .587 + b * .114) + bias); d[o] = d[o + 1] = d[o + 2] = v; } else { d[o] = clamp8(r + bias); d[o + 1] = clamp8(g + bias); d[o + 2] = clamp8(b + bias); } }
  }
  const emboss = (d, w, h, p) => convolve(d, w, h, [-2 * p.k, -p.k, 0, -p.k, 1, p.k, 0, p.k, 2 * p.k], 0, true);
  function edges(d, w, h) { const s = new Uint8ClampedArray(d), L = i => s[i] * .299 + s[i + 1] * .587 + s[i + 2] * .114; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const at = (xx, yy) => L((yy * w + xx) * 4); const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1), gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1), v = clamp8(255 - Math.hypot(gx, gy)), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; } }
  function remap(d, w, h, fn) {
    const s = new Uint8ClampedArray(d), cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = fn(x - cx, y - cy); if (!m) continue; const sx = cx + m[0], sy = cy + m[1], i = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) { d[i + 3] = 0; continue; }
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], e = s[(y1 * w + x0) * 4 + c], f = s[(y1 * w + x1) * 4 + c]; d[i + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy; }
    }
  }
  const twirl = (d, w, h, p) => { const R = Math.min(w, h) / 2 * p.radius / 100, A = p.angle * Math.PI / 180; remap(d, w, h, (dx, dy) => { const r = Math.hypot(dx, dy); if (r >= R) return null; const a = A * (1 - r / R) ** 2, c = Math.cos(a), s = Math.sin(a); return [dx * c - dy * s, dx * s + dy * c]; }); };
  const spherize = (d, w, h, p) => { const R = Math.min(w, h) / 2, k = p.amount / 100; remap(d, w, h, (dx, dy) => { const r = Math.hypot(dx, dy) / R; if (r >= 1) return null; const f = k >= 0 ? Math.pow(r, k * .8 + 1) / Math.max(r, 1e-6) : Math.pow(r, 1 / (1 - k * .8)) / Math.max(r, 1e-6); return [dx * f, dy * f]; }); };
  const ripple = (d, w, h, p) => remap(d, w, h, (dx, dy) => [dx + Math.sin(dy / p.wave * 2 * Math.PI) * p.amp, dy + Math.sin(dx / p.wave * 2 * Math.PI) * p.amp * (p.both ? 1 : 0)]);
  /** content-aware fill (basic): multi-scale membrane diffusion inside mask, then light texture noise. mask: Uint8 (255 = fill) */
  function inpaint(d, w, h, p, mask) {
    const levels = [], build = (D, M, W, H) => { levels.push({ D, M, W, H }); if (Math.min(W, H) <= 16) return; const w2 = Math.ceil(W / 2), h2 = Math.ceil(H / 2), D2 = new Float32Array(w2 * h2 * 3), M2 = new Uint8Array(w2 * h2); for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { let n = 0; const acc = [0, 0, 0]; for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const X = Math.min(W - 1, x * 2 + i), Y = Math.min(H - 1, y * 2 + j), q = Y * W + X; if (!M[q]) { acc[0] += D[q * 3]; acc[1] += D[q * 3 + 1]; acc[2] += D[q * 3 + 2]; n++; } } const o = y * w2 + x; if (n) { D2[o * 3] = acc[0] / n; D2[o * 3 + 1] = acc[1] / n; D2[o * 3 + 2] = acc[2] / n; } else M2[o] = 1; } build(D2, M2, w2, h2); };
    const D0 = new Float32Array(w * h * 3), M0 = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) { M0[i] = mask[i] > 127 ? 1 : 0; D0[i * 3] = d[i * 4]; D0[i * 3 + 1] = d[i * 4 + 1]; D0[i * 3 + 2] = d[i * 4 + 2]; }
    build(D0, M0, w, h);
    for (let l = levels.length - 1; l >= 0; l--) {
      const { D, M, W, H } = levels[l];
      if (l < levels.length - 1) { const c = levels[l + 1]; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = y * W + x; if (!M[q]) continue; const cq = Math.min(c.H - 1, y >> 1) * c.W + Math.min(c.W - 1, x >> 1); for (let k = 0; k < 3; k++) D[q * 3 + k] = c.D[cq * 3 + k]; } }
      const idx = []; for (let q = 0; q < W * H; q++) if (M[q]) idx.push(q);
      for (let it = 0; it < (l === 0 ? 60 : 30); it++) for (const q of idx) { const x = q % W, y = (q / W) | 0; let n = 0, r = 0, g = 0, b = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 3; r += D[o]; g += D[o + 1]; b += D[o + 2]; n++; } D[q * 3] = r / n; D[q * 3 + 1] = g / n; D[q * 3 + 2] = b / n; }
    }
    let s = 7; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280 - .5;
    for (let q = 0; q < w * h; q++) if (M0[q]) { const n = rnd() * (p.texture || 0) * 2.55; d[q * 4] = clamp8(D0[q * 3] + n); d[q * 4 + 1] = clamp8(D0[q * 3 + 1] + n); d[q * 4 + 2] = clamp8(D0[q * 3 + 2] + n); d[q * 4 + 3] = 255; }
  }
  /** Content-Aware Fill: exemplar-based image completion (Wexler, Shechtman & Irani 2007) with PatchMatch nearest-
      neighbour search (Barnes et al. 2009). Coarse to fine over an image pyramid; at every level a few EM rounds of
      (1) PatchMatch: for each 7×7 patch touching the hole find the most similar patch lying fully in known pixels
      (random init / propagation / shrinking random search), (2) voting: each hole pixel becomes the similarity-
      weighted average of what the overlapping matched patches say about it. The coarsest level starts from a smooth
      diffusion fill, finer levels from the upsampled result and the upsampled match field. mask: 255 = fill. */
  function patchfill(d, w, h, p, mask) {
    const R = 3, P2 = (2 * R + 1) ** 2;
    let s = (p.seed || 12345) >>> 0; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    // pyramid: colour (float, hole pixels averaged from known children) and hole mask (any child in the hole)
    const lv = [{ W: w, H: h, I: new Float32Array(w * h * 3), M: new Uint8Array(w * h) }];
    for (let i = 0; i < w * h; i++) { lv[0].M[i] = mask[i] > 127 ? 1 : 0; for (let c = 0; c < 3; c++) lv[0].I[i * 3 + c] = d[i * 4 + c]; }
    while (Math.min(lv[lv.length - 1].W, lv[lv.length - 1].H) >= 48) {
      const A = lv[lv.length - 1], W = Math.ceil(A.W / 2), H = Math.ceil(A.H / 2), I = new Float32Array(W * H * 3), M = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let n = 0, any = 0; const acc = [0, 0, 0]; for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const X = Math.min(A.W - 1, 2 * x + i), Y = Math.min(A.H - 1, 2 * y + j), q = Y * A.W + X; if (A.M[q]) { any = 1; continue; } for (let c = 0; c < 3; c++) acc[c] += A.I[q * 3 + c]; n++; } const o = y * W + x; M[o] = any; if (n) for (let c = 0; c < 3; c++) I[o * 3 + c] = acc[c] / n; }
      lv.push({ W, H, I, M }); if (lv.length > 8) break;
    }
    let prevNN = null, prevL = null;
    for (let l = lv.length - 1; l >= 0; l--) {
      const { W, H, I, M } = lv[l];
      // source centres: patch fully inside the image and fully outside the hole
      const hole = [], valid = new Uint8Array(W * H), srcList = [];
      const near = new Uint8Array(W * H);   // hole dilated by R: centres of patches that touch the hole
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M[y * W + x]) for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < W && Y < H) near[Y * W + X] = 1; }
      for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) { const q = y * W + x; if (!near[q]) { valid[q] = 1; srcList.push(q); } }
      for (let q = 0; q < W * H; q++) if (near[q]) hole.push(q);
      if (!srcList.length) { for (const q of hole) if (M[q]) for (let c = 0; c < 3; c++) I[q * 3 + c] = 128; continue; }
      // initial hole colours
      if (l === lv.length - 1) {
        const idx = []; for (let q = 0; q < W * H; q++) if (M[q]) idx.push(q);
        for (const q of idx) for (let c = 0; c < 3; c++) I[q * 3 + c] = 128;
        for (let it = 0; it < 200; it++) for (const q of idx) { const x = q % W, y = (q / W) | 0; let n = 0; const a = [0, 0, 0]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 3; a[0] += I[o]; a[1] += I[o + 1]; a[2] += I[o + 2]; n++; } for (let c = 0; c < 3; c++) I[q * 3 + c] = a[c] / n; }
      } else {
        for (let q = 0; q < W * H; q++) if (M[q]) { const x = q % W, y = (q / W) | 0, X = Math.min(prevL.W - 1, x >> 1), Y = Math.min(prevL.H - 1, y >> 1), o = (Y * prevL.W + X) * 3; for (let c = 0; c < 3; c++) I[q * 3 + c] = prevL.I[o + c]; }
      }
      const dist = (q, sq, best) => {
        const qx = q % W, qy = (q / W) | 0, sx = sq % W, sy = (sq / W) | 0; let sum = 0;
        for (let j = -R; j <= R; j++) { const Y = qy + j; if (Y < 0 || Y >= H) { sum += 0; continue; } for (let i = -R; i <= R; i++) { const X = qx + i; if (X < 0 || X >= W) continue; const a = (Y * W + X) * 3, b = ((sy + j) * W + sx + i) * 3, d0 = I[a] - I[b], d1 = I[a + 1] - I[b + 1], d2 = I[a + 2] - I[b + 2]; sum += d0 * d0 + d1 * d1 + d2 * d2; } if (sum > best) return sum; }
        return sum;
      };
      const NN = new Int32Array(W * H).fill(-1), ND = new Float32Array(W * H);
      const clampSrc = (x, y) => { x = Math.max(R, Math.min(W - R - 1, x)); y = Math.max(R, Math.min(H - R - 1, y)); const q = y * W + x; return valid[q] ? q : -1; };
      for (const q of hole) {
        let c = -1; if (prevNN) { const x = q % W, y = (q / W) | 0, pq = Math.min(prevL.H - 1, y >> 1) * prevL.W + Math.min(prevL.W - 1, x >> 1), ps = prevNN[pq]; if (ps >= 0) c = clampSrc((ps % prevL.W) * 2 + (x & 1), ((ps / prevL.W) | 0) * 2 + (y & 1)); }
        if (c < 0) c = srcList[(rnd() * srcList.length) | 0]; NN[q] = c; ND[q] = dist(q, c, Infinity);
      }
      const em = l === 0 ? 3 : 5, pm = 4;
      for (let e = 0; e < em; e++) {
        for (let it = 0; it < pm; it++) {
          const fwd = !(it & 1), order = fwd ? hole : hole.slice().reverse(), st = fwd ? 1 : -1;
          for (const q of order) {
            const x = q % W, y = (q / W) | 0;
            // propagation: the left/up (or right/down) neighbour's match, shifted by one pixel
            for (const nb of [q - st, q - st * W]) { if (nb < 0 || nb >= W * H || NN[nb] < 0) continue; const c = clampSrc(NN[nb] % W + (q % W - nb % W), ((NN[nb] / W) | 0) + (y - ((nb / W) | 0))); if (c < 0 || c === NN[q]) continue; const dd = dist(q, c, ND[q]); if (dd < ND[q]) { ND[q] = dd; NN[q] = c; } }
            // random search around the current match, radius halving
            for (let rad = Math.max(W, H); rad >= 1; rad >>= 1) { const cx = NN[q] % W, cy = (NN[q] / W) | 0, c = clampSrc(cx + Math.round((rnd() * 2 - 1) * rad), cy + Math.round((rnd() * 2 - 1) * rad)); if (c < 0 || c === NN[q]) continue; const dd = dist(q, c, ND[q]); if (dd < ND[q]) { ND[q] = dd; NN[q] = c; } }
          }
        }
        // voting: similarity-weighted average of every matched patch that covers a hole pixel
        const ds = hole.map(q => ND[q]).sort((a, b) => a - b), sig2 = Math.max(1, ds[(ds.length * .75) | 0] || 1) / P2 * 2;
        const acc = new Float32Array(W * H * 3), wsum = new Float32Array(W * H);
        for (const q of hole) {
          const qx = q % W, qy = (q / W) | 0, sq = NN[q], sx = sq % W, sy = (sq / W) | 0, wt = Math.exp(-ND[q] / P2 / sig2);
          for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const X = qx + i, Y = qy + j; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const t = Y * W + X; if (!M[t]) continue; const b = ((sy + j) * W + sx + i) * 3; acc[t * 3] += I[b] * wt; acc[t * 3 + 1] += I[b + 1] * wt; acc[t * 3 + 2] += I[b + 2] * wt; wsum[t] += wt; }
        }
        for (let t = 0; t < W * H; t++) if (M[t] && wsum[t] > 0) for (let c = 0; c < 3; c++) I[t * 3 + c] = acc[t * 3 + c] / wsum[t];
        for (const q of hole) ND[q] = dist(q, NN[q], Infinity);
      }
      prevNN = NN; prevL = lv[l];
    }
    const F = lv[0]; for (let q = 0; q < w * h; q++) if (F.M[q]) { for (let c = 0; c < 3; c++) d[q * 4 + c] = clamp8(F.I[q * 3 + c]); d[q * 4 + 3] = 255; }
  }
  return { gauss, unsharp, noise, median, motion, pixelate, emboss, edges, twirl, spherize, ripple, inpaint, patchfill };
}

NXI.filters = (() => {
  const defs = {
    gauss:    { name: 'Gaussian Blur', cat: 'Blur', p: [['r', 'Radius', 0, 150, 6, .5]] },
    motion:   { name: 'Motion Blur', cat: 'Blur', p: [['angle', 'Angle', 0, 360, 0, 1], ['dist', 'Distance', 1, 200, 20, 1]] },
    unsharp:  { name: 'Unsharp Mask', cat: 'Sharpen', p: [['amount', 'Amount %', 0, 500, 120, 1], ['r', 'Radius', .5, 50, 2, .5], ['threshold', 'Threshold', 0, 255, 2, 1]] },
    noise:    { name: 'Add Noise', cat: 'Noise', p: [['amount', 'Amount %', 0, 100, 12, 1], ['gaussian', 'Gaussian', 0, 1, 1, 1], ['mono', 'Monochromatic', 0, 1, 1, 1], ['seed', 'Seed', 1, 999, 1, 1]] },
    median:   { name: 'Reduce Noise (Median)', cat: 'Noise', p: [['r', 'Radius', 1, 3, 1, 1]] },
    pixelate: { name: 'Mosaic', cat: 'Pixelate', p: [['size', 'Cell size', 2, 200, 16, 1]] },
    emboss:   { name: 'Emboss', cat: 'Stylize', p: [['k', 'Strength', .2, 4, 1, .1]] },
    edges:    { name: 'Find Edges', cat: 'Stylize', p: [] },
    twirl:    { name: 'Twirl', cat: 'Distort', p: [['angle', 'Angle °', -999, 999, 180, 1], ['radius', 'Radius %', 5, 100, 80, 1]] },
    spherize: { name: 'Spherize / Pinch', cat: 'Distort', p: [['amount', 'Amount %', -100, 100, 60, 1]] },
    ripple:   { name: 'Ripple', cat: 'Distort', p: [['amp', 'Amplitude', 0, 100, 8, 1], ['wave', 'Wavelength', 4, 400, 60, 1], ['both', 'Both axes', 0, 1, 1, 1]] }
  };
  const K = NXI_KERNELS();
  let worker = null, seq = 0; const waiting = {};
  function getWorker() {
    if (worker !== null) return worker;
    try {
      const src = 'const K=(' + NXI_KERNELS.toString() + ')();onmessage=e=>{const{id,name,w,h,p,buf,mask}=e.data;const d=new Uint8ClampedArray(buf);try{K[name](d,w,h,p,mask?new Uint8Array(mask):null);postMessage({id,buf:d.buffer},[d.buffer]);}catch(err){postMessage({id,error:String(err)});}};';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = e => { const w = waiting[e.data.id]; delete waiting[e.data.id]; if (!w) return; e.data.error ? w.rej(new Error(e.data.error)) : w.res(new Uint8ClampedArray(e.data.buf)); };
      worker.onerror = () => { worker = false; for (const k in waiting) { waiting[k].rej(new Error('filter worker failed')); delete waiting[k]; } };
    } catch (e) { worker = false; }
    return worker;
  }
  /** run kernel `name` on an ImageData; resolves with a new ImageData */
  function run(name, id, p, mask) {
    const w = id.width, h = id.height, W = getWorker();
    if (!W) { const d = new Uint8ClampedArray(id.data); K[name](d, w, h, p, mask); return Promise.resolve(new ImageData(d, w, h)); }
    return new Promise((res, rej) => { const i = ++seq, buf = id.data.slice().buffer, mb = mask ? mask.slice().buffer : null; waiting[i] = { res: d => res(new ImageData(d, w, h)), rej }; W.postMessage({ id: i, name, w, h, p, buf, mask: mb }, mb ? [buf, mb] : [buf]); });
  }
  function regionFor(doc, L, target, margin) {
    const b = NXI.selBounds(doc); if (!b) return { x: 0, y: 0, w: target.width, h: target.height };
    const x = Math.max(0, b.x - L.x - margin), y = Math.max(0, b.y - L.y - margin); return { x, y, w: Math.min(target.width, b.x - L.x + b.w + margin) - x, h: Math.min(target.height, b.y - L.y + b.h + margin) - y };
  }
  /** apply a filter to the active raster layer (or its mask), honouring the selection */
  async function apply(doc, name, p, preview) {
    const L = NXI.active(doc); if (!L || L.type !== 'raster') throw new Error('Select a raster (pixel) layer — use Layer › Rasterize for text/shape layers.');
    const target = doc.target === 'mask' && L.mask ? L.mask.canvas : L.canvas, margin = Math.ceil((p.r || p.dist || p.size || 4) * 2);
    const R = regionFor(doc, L, target, margin); if (R.w < 1 || R.h < 1) return;
    const src = target.getContext('2d', { willReadFrequently: true }).getImageData(R.x, R.y, R.w, R.h);
    const out = await run(name, src, p);
    const full = NXI.clone(target); full.getContext('2d').putImageData(out, R.x, R.y);
    if (preview) return full;
    NXI.commitMasked(doc, L, target, full); NXI.dirty(doc, L); NXI.push(doc, defs[name].name);
  }
  /** content-aware fill of the current selection on the active raster layer */
  async function contentAwareFill(doc, texture) {
    const L = NXI.active(doc); if (!L || L.type !== 'raster') throw new Error('Select a raster layer.'); if (!doc.sel) throw new Error('Make a selection around the area to remove first.');
    const b = NXI.selBounds(doc), pad = Math.max(24, Math.round(Math.max(b.w, b.h) * .6)), x = Math.max(0, b.x - L.x - pad), y = Math.max(0, b.y - L.y - pad), w = Math.min(L.canvas.width, b.x - L.x + b.w + pad) - x, h = Math.min(L.canvas.height, b.y - L.y + b.h + pad) - y;
    const id = L.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h), sl = NXI.selLocal(doc, L), md = sl.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data, mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = md[i * 4 + 3];
    const out = await run('patchfill', id, { seed: 12345 }, mask);
    const full = NXI.clone(L.canvas); full.getContext('2d').putImageData(out, x, y); NXI.commitMasked(doc, L, L.canvas, full); NXI.dirty(doc, L); NXI.push(doc, 'Content-Aware Fill');
  }
  /** destructive adjustment (Image › Adjustments) */
  function adjustLayer(doc, type, p) {
    const L = NXI.active(doc); if (!L || L.type !== 'raster') throw new Error('Select a raster layer.');
    const full = NXI.clone(L.canvas), c = full.getContext('2d', { willReadFrequently: true }), id = c.getImageData(0, 0, full.width, full.height); ADJ.apply(id.data, type, p, 1); c.putImageData(id, 0, 0);
    NXI.commitMasked(doc, L, L.canvas, full); NXI.dirty(doc, L); NXI.push(doc, ADJ.defs[type].name);
  }
  return { defs, run, apply, contentAwareFill, adjustLayer, kernels: K };
})();
