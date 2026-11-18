'use strict';
/* ====================== NEXORA Blocks extras ======================
   Animated textures: frames are stacked top to bottom in one PNG (the layout Minecraft reads); t.anim holds the frame
   time (game ticks, 20 per second) and interpolation, and the Java pack gets the matching <name>.png.mcmeta.
   Skin preview: a 64×64 (or classic 64×32) skin on the player-shaped boxes, wide or slim arms, the outer layer
   0.5 px out, and an optional armour texture (64×32 armour layout) 1 px out with the left limbs mirrored.
   Bedrock: a .mcpack resource pack (manifest with UUIDs that stay the same for this project, textures/blocks and
   textures/items, terrain_texture.json, item_texture.json, flipbook_textures.json for animations) plus each block
   model as Bedrock geometry (.geo.json). */
const BlocksX = (() => {
  const B = Blocks;
  /* ---------- animation ---------- */
  const frames = t => t.anim && t.w > 0 && t.h % t.w === 0 ? t.h / t.w : 1;
  function setFrames(t, n) {
    n = clamp(n | 0, 1, 64); const c = B.canvasOf(t), cur = frames(t), fw = t.w; if (n === cur) return t; if (n * fw > 1024) throw new Error('Up to 1024 px tall: ' + Math.floor(1024 / fw) + ' frames at this size');
    const old = c._ctx.getImageData(0, 0, c.width, c.height); c.height = n * fw; c._ctx = c.getContext('2d', { willReadFrequently: true }); c._ctx.putImageData(old, 0, 0);
    for (let i = cur; i < n; i++) c._ctx.drawImage(c, 0, (cur - 1) * fw, fw, fw, 0, i * fw, fw, fw);   // new frames start as a copy of the last one
    t.h = n * fw; t.anim = n > 1 ? Object.assign({ frametime: 2, interpolate: false }, t.anim) : null; B.save(t); return t;
  }
  function mcmeta(t) { return frames(t) > 1 ? { animation: { frametime: Math.max(1, t.anim.frametime | 0), interpolate: !!t.anim.interpolate } } : null; }
  /** draw frame i (with interpolation at fraction f toward the next one, like the game) */
  function drawFrame(t, x, i, f = 0) { const c = B.canvasOf(t), n = frames(t), w = t.w, a = ((i % n) + n) % n; x.imageSmoothingEnabled = false; x.clearRect(0, 0, x.canvas.width, x.canvas.height);
    x.globalAlpha = 1; x.drawImage(c, 0, a * w, w, w, 0, 0, x.canvas.width, x.canvas.height); if (f > 0 && t.anim && t.anim.interpolate) { x.globalAlpha = f; x.drawImage(c, 0, ((a + 1) % n) * w, w, w, 0, 0, x.canvas.width, x.canvas.height); x.globalAlpha = 1; } }

  /* ---------- skins ---------- */
  // [name, from, to, uv origin, size (w h d), overlay uv origin (64×64 only), armour uv origin, mirror armour]
  const PARTS = slim => { const aw = slim ? 3 : 4; return [
    ['Head', [4, 24, 4], [12, 32, 12], [0, 0], [8, 8, 8], [32, 0], [0, 0], false],
    ['Body', [4, 12, 6], [12, 24, 10], [16, 16], [8, 12, 4], [16, 32], [16, 16], false],
    ['Right arm', [4 - aw, 12, 6], [4, 24, 10], [40, 16], [aw, 12, 4], [40, 32], [40, 16], false],
    ['Left arm', [12, 12, 6], [12 + aw, 24, 10], [32, 48], [aw, 12, 4], [48, 48], [40, 16], true],
    ['Right leg', [4, 0, 6], [8, 12, 10], [0, 16], [4, 12, 4], [0, 32], [0, 16], false],
    ['Left leg', [8, 0, 6], [12, 12, 10], [16, 48], [4, 12, 4], [0, 48], [0, 16], true]]; };
  /** per-face uv (0–16 units of the texture) for a box unwrapped at pixel (u, v); the player faces south */
  function boxUV([u, v], [w, h, d], tw, th, mirror) {
    const R = (x, y, ww, hh) => [x * 16 / tw, y * 16 / th, (x + ww) * 16 / tw, (y + hh) * 16 / th], m = r => mirror ? [r[2], r[1], r[0], r[3]] : r;
    const f = { up: R(u + d, v, w, d), down: R(u + d + w, v, w, d), west: R(u, v + d, d, h), south: R(u + d, v + d, w, h), east: R(u + d + w, v + d, d, h), north: R(u + 2 * d + w, v + d, w, h) };
    if (mirror) { const e = f.east; f.east = m(f.west); f.west = m(e); f.up = m(f.up); f.down = m(f.down); f.south = m(f.south); f.north = m(f.north); } return f;
  }
  function skinElements(o) {
    const T = B.store().textures, skin = T[o.skin], legacy = skin && skin.h === 32, out = [];
    const box = (name, from, to, uvo, size, tex, tw, th, grow, mirror) => { const e = B.newElement({ name, from: from.map(v => v - grow), to: to.map(v => v + grow), tex }); const uv = boxUV(uvo, size, tw, th, mirror); for (const f of B.FACES) e.faces[f] = { tex, uv: uv[f] }; out.push(e); };
    for (const [name, from, to, uv, size, ov, au, mir] of PARTS(o.slim)) {
      if (!skin) break; const left = name.startsWith('Left'); let uvo = uv, m = false;
      if (legacy && left) { uvo = name === 'Left arm' ? [40, 16] : [0, 16]; m = true; }   // classic skins reuse the right limbs, mirrored
      box(name, from, to, uvo, size, skin.id, skin.w, skin.h, 0, m);
      if (o.outer !== false && (!legacy || name === 'Head')) box(name + ' (outer)', from, to, legacy ? [32, 0] : ov, size, skin.id, skin.w, skin.h, .5, false);
    }
    const arm = T[o.armour]; if (arm) for (const [name, from, to, , size, , au, mir] of PARTS(false)) { const sz = name.includes('arm') && o.slim ? [4, 12, 4] : size, fr = name === 'Right arm' && o.slim ? [0, 12, 6] : from, tt = name === 'Left arm' && o.slim ? [16, 24, 10] : to; box(name + ' (armour)', fr, tt, au, sz, arm.id, arm.w, arm.h, 1, mir); }
    return out;
  }
  /** create or refresh the "Skin preview" model (never exported) */
  function skinPreview(texId, o = {}) {
    const st = B.store(); let m = Object.values(st.models).find(x => x.skin); if (!m) { m = B.newModel({ kind: 'block', name: 'Skin preview', path: 'preview/skin' }); m.skin = {}; }
    Object.assign(m.skin, { skin: texId || m.skin.skin, slim: !!m.skin.slim, outer: m.skin.outer !== false }, o); m.elements = skinElements(m.skin); return m;
  }
  /** an original starter skin: every part painted in its own shade so you can see where to draw (64×64 layout) */
  B.TEMPLATES.skin = (x, w, h) => { const k = w / 64, fill = (c, u, v, ww, hh) => { x.fillStyle = c; x.fillRect(u * k, v * k, ww * k, hh * k); };
    const shade = ['#9ad6ff', '#5cb8ff', '#2f6fb8', '#1d3d73', '#e6eaee', '#6b737d'];
    PARTS(false).forEach(([, , , [u, v], [ww, hh, d], ov], i) => { const c = shade[i % shade.length]; fill(c, u + d, v, ww * 2, d); fill(c, u, v + d, 2 * d + 2 * ww, hh); if (h >= 64 && i) { x.globalAlpha = .25; fill(c, ov[0] + d, ov[1], ww * 2, d); fill(c, ov[0], ov[1] + d, 2 * d + 2 * ww, hh); x.globalAlpha = 1; } });
    fill('#ffffff', 9, 12, 1, 1); fill('#ffffff', 14, 12, 1, 1); fill('#000000', 10, 12, 1, 1); fill('#000000', 13, 12, 1, 1); };

  /* ---------- Bedrock ---------- */
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const b64 = d => { const s = atob(d.split(',')[1] || ''), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const shortName = t => B.slug(t.path.split('/').pop()).replace(/[^a-z0-9_]/g, '_');
  /** Bedrock folder for a Java-style path: block/x → blocks/x, item/x → items/x */
  const bedPath = t => { const p = t.path.replace(/^\/+/, ''), [top, ...rest] = p.split('/'); return 'textures/' + ({ block: 'blocks', blocks: 'blocks', item: 'items', items: 'items' }[top] || 'blocks') + '/' + (rest.length ? rest.join('/') : top); };
  function geometry(m) {
    const T = B.store().textures, first = m.elements.flatMap(e => B.FACES.map(f => e.faces[f] && e.faces[f].tex)).find(id => id && T[id]), tx = T[first] || { w: 16, h: 16 }, id = 'geometry.' + B.slug(m.path.split('/').pop()).replace(/[^a-z0-9_.]/g, '_');
    const cubes = m.elements.map(e => { const uv = {}; for (const f of B.FACES) { const fc = e.faces[f]; if (!fc || !fc.tex) continue; const [u1, v1, u2, v2] = B.faceUV(e, f), k = tx.w / 16, q = tx.h / 16; uv[f] = { uv: [+(u1 * k).toFixed(3), +(v1 * q).toFixed(3)], uv_size: [+((u2 - u1) * k).toFixed(3), +((v2 - v1) * q).toFixed(3)] }; }
      return { origin: [8 - e.to[0], e.from[1], e.from[2] - 8], size: [0, 1, 2].map(i => +(e.to[i] - e.from[i]).toFixed(3)), uv }; });
    return { format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: id, texture_width: tx.w, texture_height: tx.h, visible_bounds_width: 2, visible_bounds_height: 2.5, visible_bounds_offset: [0, .75, 0] }, bones: [{ name: 'root', pivot: [0, 0, 0], cubes }] }] };
  }
  async function bedrockPack() {
    const s = B.store(), pk = s.pack, ns = B.slug(pk.namespace || 'nexora').replace(/[^a-z0-9_]/g, '_') || 'nexora', files = [], ids = pk.bedrock || (pk.bedrock = { header: uuid(), module: uuid() });
    if (typeof Recovery !== 'undefined') Recovery.touch();
    const ver = (pk.bedrockVersion || [1, 0, 0]).map(Number);
    files.push({ name: 'manifest.json', data: JSON.stringify({ format_version: 2, header: { name: pk.name || 'NEXORA pack', description: pk.description || '', uuid: ids.header, version: ver, min_engine_version: [1, 20, 0] }, modules: [{ type: 'resources', uuid: ids.module, version: ver }], metadata: { generated_with: { nexora_studio: [1, 0, 0] } } }, null, 2) });
    const texs = Object.values(s.textures);
    const icon = s.textures[pk.icon] || texs[0]; if (icon) { const c = await B.ready(icon), k = mkCanvas(128, 128), x = k.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, icon.w, icon.w, 0, 0, 128, 128); files.push({ name: 'pack_icon.png', data: b64(k.toDataURL('image/png')) }); }
    const terrain = {}, items = {}, flip = [];
    for (const t of texs) { await B.ready(t); const p = bedPath(t), key = ns + ':' + shortName(t); files.push({ name: p + '.png', data: b64(t.png || B.canvasOf(t).toDataURL('image/png')) });
      (p.startsWith('textures/items/') ? items : terrain)[key] = { textures: p }; if (frames(t) > 1) flip.push({ flipbook_texture: p, atlas_tile: key, ticks_per_frame: Math.max(1, t.anim.frametime | 0), blend_frames: !!t.anim.interpolate }); }
    if (Object.keys(terrain).length) files.push({ name: 'textures/terrain_texture.json', data: JSON.stringify({ resource_pack_name: B.slug(pk.name || 'nexora'), texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: terrain }, null, 2) });
    if (Object.keys(items).length) files.push({ name: 'textures/item_texture.json', data: JSON.stringify({ resource_pack_name: B.slug(pk.name || 'nexora'), texture_name: 'atlas.items', texture_data: items }, null, 2) });
    if (flip.length) files.push({ name: 'textures/flipbook_textures.json', data: JSON.stringify(flip, null, 2) });
    for (const m of Object.values(s.models)) if (m.kind !== 'item' && !m.skin && m.elements.length) files.push({ name: 'models/blocks/' + B.slug(m.path.split('/').pop()) + '.geo.json', data: JSON.stringify(geometry(m), null, 2) });
    return { blob: Zip.build(files), files: files.map(f => f.name) };
  }
  return { frames, setFrames, mcmeta, drawFrame, PARTS, boxUV, skinElements, skinPreview, bedPath, geometry, bedrockPack };
})();
