'use strict';
/* ====================== NEXORA 3D (three.js r160, MIT) ======================
   A scene = { id, name, w, h, dur, bg, cam: { dist, height, fov, orbit (°/s), az, el }, light: { key, keyI, amb, shadows },
               objects: [{ id, type, name, color, metal, rough, glow, pos:[x,y,z], rot:[x,y,z], scale, spin:[x,y,z] °/s,
                           bob (units), text, media }] }
   Scenes live in the project (P.scenes3d) and appear on the timeline as '3d' layers. Every frame is a pure function
   of time (spin, bob, camera orbit), so preview, scrubbing and frame-exact export all render identically.
   Shapes: box, sphere, torus, knot, cylinder, cone, floor, text (flat text in 3D space), image (a project image as a card). */
const ThreeD = (() => {
  const S = { root: null, loading: null, scene: null, sel: null, r: null, playT: 0, playing: false };
  const proj = () => typeof Motion !== 'undefined' ? Motion.editProject() : P;
  const store = () => proj().scenes3d || (proj().scenes3d = {});
  function load() { if (window.THREE) return Promise.resolve(); return S.loading || (S.loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/three.min.js'; s.onload = res; s.onerror = () => rej(new Error('vendor/three.min.js missing')); document.head.append(s); })); }
  const ready = () => !!window.THREE;

  function newScene(o) {
    o = o || {}; const id = uid(), p = proj();
    const sc = { id, name: o.name || '3D scene ' + (Object.keys(store()).length + 1), w: o.w || p.w, h: o.h || p.h, dur: o.dur || 5, bg: o.bg || 'transparent',
      cam: { dist: 9, height: 2.5, fov: 40, orbit: 0, az: 0 }, light: { key: '#ffffff', keyI: 2.2, amb: '#8b8bff', ambI: .7, shadows: true }, objects: [] };
    if (!o.empty) { addObject(sc, 'knot', { color: '#5cb8ff', metal: .6, rough: .25, spin: [0, 40, 0], pos: [0, .3, 0] }); addObject(sc, 'floor', { color: '#14141c', rough: .9 }); sc.cam.orbit = 12; }
    store()[id] = sc; return sc;
  }
  function addObject(sc, type, o) {
    const ob = Object.assign({ id: uid(), type, name: type[0].toUpperCase() + type.slice(1), color: '#3b9bff', metal: .2, rough: .4, glow: 0, pos: [0, type === 'floor' ? -1.4 : 0, 0], rot: [type === 'floor' ? -90 : 0, 0, 0], scale: 1, spin: [0, 0, 0], bob: 0, text: type === 'text' || type === 'text3d' ? 'NEXORA' : undefined, font: type === 'text3d' ? 'helvetiker' : undefined, depth: type === 'text3d' ? .35 : undefined, media: '' }, o || {});
    sc.objects.push(ob); return ob;
  }

  /* ---------- fonts for extruded 3D text (MgOpen Helvetiker / Optimer, see vendor/fonts/LICENSE-MgOpen.txt) ---------- */
  const FONTS = { helvetiker: 'Helvetiker Bold', optimer: 'Optimer Bold' }, fontLoads = {};
  function font(name) {
    if (window.NX_FONTS && NX_FONTS[name]) return NX_FONTS[name];
    if (!fontLoads[name]) fontLoads[name] = new Promise(res => { const s = document.createElement('script'); s.src = `vendor/fonts/${name}.js`; s.onload = () => { cache.clear(); requestRender(); if (S.view) draw(); res(); }; s.onerror = res; document.head.append(s); });
    return null;
  }
  // glyph outlines → THREE.Shapes (port of three.js examples/jsm/loaders/FontLoader.js, MIT)
  function textShapes(text, size, data) {
    const scale = size / data.resolution, lineH = (data.boundingBox.yMax - data.boundingBox.yMin + data.underlineThickness) * scale, shapes = []; let ox = 0, oy = 0;
    for (const ch of Array.from(text)) {
      if (ch === '\n') { ox = 0; oy -= lineH; continue; }
      const g = data.glyphs[ch] || data.glyphs['?']; if (!g) continue; const path = new THREE.ShapePath();
      if (g.o) { const o = g._o || (g._o = g.o.split(' ')); for (let i = 0; i < o.length;) { const a = o[i++], P_ = () => [o[i++] * scale + ox, o[i++] * scale + oy];
        if (a === 'm') path.moveTo(...P_()); else if (a === 'l') path.lineTo(...P_()); else if (a === 'q') { const [cx, cy] = P_(), [x1, y1] = P_(); path.quadraticCurveTo(x1, y1, cx, cy); } else if (a === 'b') { const [cx, cy] = P_(), [x1, y1] = P_(), [x2, y2] = P_(); path.bezierCurveTo(x1, y1, x2, y2, cx, cy); } } }
      shapes.push(...path.toShapes()); ox += g.ha * scale;
    }
    return shapes;
  }

  /* ---------- model import ----------
     glTF 2.0 (.glb, or .gltf with its .bin and texture files): node hierarchy, meshes, PBR materials and textures,
     morph targets, skinned meshes (skeletons) and animations (LINEAR / STEP / CUBICSPLINE on translation, rotation,
     scale and morph weights). OBJ with .mtl materials (Kd / Ks / Ns / d / map_Kd) and per-material groups.
     All files are packed into the project (sc.assets), so a project never depends on the original files. */
  const models = new Map(), modelLoads = new Map();
  const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
  const baseName = s => decodeURIComponent(String(s).split(/[\\/]/).pop()).toLowerCase();
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' };
  /* cubic-spline keyframes (glTF CUBICSPLINE: in-tangent, value, out-tangent per key) — port of three.js GLTFLoader's interpolant (MIT) */
  let CubicSpline = null;   // created on first use: three.js itself is loaded lazily
  const cubicClass = () => CubicSpline || (CubicSpline = class extends THREE.Interpolant {
    copySampleValue_(index) { const r = this.resultBuffer, v = this.sampleValues, n = this.valueSize, o = index * n * 3 + n; for (let i = 0; i !== n; i++) r[i] = v[o + i]; return r; }
    interpolate_(i1, t0, t, t1) {
      const r = this.resultBuffer, v = this.sampleValues, s = this.valueSize, s2 = s * 2, s3 = s * 3, td = t1 - t0, p = (t - t0) / td, pp = p * p, ppp = pp * p, o1 = i1 * s3, o0 = o1 - s3, k2 = -2 * ppp + 3 * pp, k3 = ppp - pp, k0 = 1 - k2, k1 = k3 - pp + p;
      for (let i = 0; i !== s; i++) r[i] = k0 * v[o0 + i + s] + k1 * v[o0 + i + s2] * td + k2 * v[o1 + i + s] + k3 * v[o1 + i] * td;
      if (this.quat) { const l = Math.hypot(r[0], r[1], r[2], r[3]) || 1; for (let i = 0; i < 4; i++) r[i] /= l; } return r;
    }
  });
  async function parseGLTF(buf, files) {
    files = files || {}; let json, bin = null; const dv = new DataView(buf);
    if (dv.getUint32(0, true) === 0x46546C67) { let off = 12; while (off < buf.byteLength) { const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), body = buf.slice(off + 8, off + 8 + len); if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(body)); else if (type === 0x004E4942) bin = body; off += 8 + len; } }
    else json = JSON.parse(new TextDecoder().decode(buf));
    const ext = uri => { if (uri.startsWith('data:')) return unb64(uri.split(',')[1]); const f = files[baseName(uri)]; if (!f) throw new Error(`Missing file "${uri}" — select the .gltf together with its .bin and texture files`); return f; };
    const buffers = (json.buffers || []).map(b => b.uri === undefined ? bin : ext(b.uri));
    const view = i => { const v = json.bufferViews[i]; return { buf: buffers[v.buffer], off: v.byteOffset || 0, len: v.byteLength, stride: v.byteStride || 0 }; };
    const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
    const accessor = (i, keepInt) => {
      const a = json.accessors[i], n = NC[a.type], T = CT[a.componentType], bpe = T.BYTES_PER_ELEMENT, out = new T(a.count * n);
      if (a.bufferView !== undefined) { const v = view(a.bufferView), start = v.off + (a.byteOffset || 0);
        if (!v.stride || v.stride === n * bpe) out.set(new T(v.buf.slice(start, start + a.count * n * bpe)));
        else { const d = new DataView(v.buf), get = { 1: (o, s) => s ? d.getInt8(o) : d.getUint8(o), 2: (o, s) => s ? d.getInt16(o, true) : d.getUint16(o, true), 4: o => T === Float32Array ? d.getFloat32(o, true) : d.getUint32(o, true) }[bpe]; for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(start + k * v.stride + c * bpe, T === Int8Array || T === Int16Array); } }
      if (a.sparse) { const s = a.sparse, iv = view(s.indices.bufferView), vv = view(s.values.bufferView), IT = CT[s.indices.componentType], idx = new IT(iv.buf.slice(iv.off + (s.indices.byteOffset || 0), iv.off + (s.indices.byteOffset || 0) + s.count * IT.BYTES_PER_ELEMENT)), vals = new T(vv.buf.slice(vv.off + (s.values.byteOffset || 0), vv.off + (s.values.byteOffset || 0) + s.count * n * bpe)); for (let k = 0; k < s.count; k++) for (let c = 0; c < n; c++) out[idx[k] * n + c] = vals[k * n + c]; }
      let arr = out; if (a.normalized && T !== Float32Array && !keepInt) { const mx = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType]; arr = Float32Array.from(out, x => Math.max(x / mx, -1)); } return { arr, n };
    };
    const texCache = {}; const texture = async i => { if (texCache[i]) return texCache[i]; const t = json.textures[i], img = json.images[t.source]; let blob;
      if (img.bufferView !== undefined) { const v = view(img.bufferView); blob = new Blob([v.buf.slice(v.off, v.off + v.len)], { type: img.mimeType }); } else if (img.uri) blob = new Blob([ext(img.uri)], { type: img.mimeType || MIME[img.uri.split('.').pop().toLowerCase()] || 'image/png' }); else return null;
      const bmp = await createImageBitmap(blob); const T_ = new THREE.Texture(bmp); T_.flipY = false; T_.colorSpace = THREE.SRGBColorSpace; T_.wrapS = T_.wrapT = THREE.RepeatWrapping; T_.needsUpdate = true; return (texCache[i] = T_); };
    const mats = await Promise.all((json.materials || []).map(async m => { const p = m.pbrMetallicRoughness || {}, f = p.baseColorFactor || [1, 1, 1, 1];
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(f[0], f[1], f[2]), opacity: f[3], transparent: f[3] < 1 || m.alphaMode === 'BLEND', alphaTest: m.alphaMode === 'MASK' ? (m.alphaCutoff ?? .5) : 0, metalness: p.metallicFactor ?? 1, roughness: p.roughnessFactor ?? 1, side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
      if (p.baseColorTexture) mat.map = await texture(p.baseColorTexture.index); if (p.metallicRoughnessTexture) { const t = await texture(p.metallicRoughnessTexture.index); if (t) { const c = t.clone(); c.colorSpace = THREE.NoColorSpace; c.needsUpdate = true; mat.metalnessMap = mat.roughnessMap = c; } }
      if (m.normalTexture) { const t = await texture(m.normalTexture.index); if (t) { const c = t.clone(); c.colorSpace = THREE.NoColorSpace; c.needsUpdate = true; mat.normalMap = c; } }
      if (m.emissiveFactor) mat.emissive = new THREE.Color(...m.emissiveFactor); if (m.emissiveTexture) mat.emissiveMap = await texture(m.emissiveTexture.index); return mat; }));
    const joints = new Set(); (json.skins || []).forEach(s => s.joints.forEach(j => joints.add(j)));
    const nodeObj = [], skinned = [];
    const prims = (meshIndex, nodeIndex, skin) => json.meshes[meshIndex].primitives.filter(p => (p.mode ?? 4) === 4).map((p, k) => {
      const g = new THREE.BufferGeometry(), A = p.attributes;
      for (const [key, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv'], ['COLOR_0', 'color'], ['WEIGHTS_0', 'skinWeight']]) if (A[key] !== undefined) { const r = accessor(A[key]); g.setAttribute(name, new THREE.BufferAttribute(r.arr, r.n)); }
      if (A.JOINTS_0 !== undefined) { const r = accessor(A.JOINTS_0, true); g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(r.arr), r.n)); }
      if (p.indices !== undefined) g.setIndex(new THREE.BufferAttribute(new Uint32Array(accessor(p.indices, true).arr), 1));
      if (p.targets) { g.morphTargetsRelative = true; g.morphAttributes.position = p.targets.map(t => { const r = t.POSITION !== undefined ? accessor(t.POSITION) : { arr: new Float32Array(g.attributes.position.count * 3), n: 3 }; return new THREE.BufferAttribute(r.arr, 3); }); if (p.targets.every(t => t.NORMAL !== undefined)) g.morphAttributes.normal = p.targets.map(t => new THREE.BufferAttribute(accessor(t.NORMAL).arr, 3)); }
      if (!A.NORMAL) g.computeVertexNormals();
      let mat = p.material !== undefined ? mats[p.material] : new THREE.MeshStandardMaterial({ color: '#cccccc' }); if (A.COLOR_0 !== undefined) { mat = mat.clone(); mat.vertexColors = true; }
      const mesh = skin !== undefined && A.JOINTS_0 !== undefined ? new THREE.SkinnedMesh(g, mat) : new THREE.Mesh(g, mat);
      mesh.name = `__n${nodeIndex}_p${k}`; if (p.targets) { mesh.updateMorphTargets(); const w = json.nodes[nodeIndex].weights || json.meshes[meshIndex].weights; if (w) w.forEach((x, i) => mesh.morphTargetInfluences[i] = x); }
      if (mesh.isSkinnedMesh) { mesh.frustumCulled = false; skinned.push({ mesh, skin }); } return mesh;
    });
    const build = ni => {
      const n = json.nodes[ni], o = joints.has(ni) ? new THREE.Bone() : new THREE.Group(); o.name = `__n${ni}`; nodeObj[ni] = o;
      if (n.matrix) { o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); } else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
      if (n.mesh !== undefined) prims(n.mesh, ni, n.skin).forEach(m => o.add(m)); (n.children || []).forEach(c => o.add(build(c))); return o;
    };
    const root = new THREE.Group(), scn = json.scenes ? json.scenes[json.scene || 0] : { nodes: json.nodes.map((_, i) => i).filter(i => !json.nodes.some(m => (m.children || []).includes(i))) };
    scn.nodes.forEach(i => root.add(build(i))); root.updateMatrixWorld(true);
    // skeletons: bones are the joint nodes, inverse bind matrices from the skin
    for (const { mesh, skin } of skinned) { const s = json.skins[skin], ibm = s.inverseBindMatrices !== undefined ? accessor(s.inverseBindMatrices).arr : null; const bones = s.joints.map(j => nodeObj[j]), inv = s.joints.map((_, i) => ibm ? new THREE.Matrix4().fromArray(ibm, i * 16) : new THREE.Matrix4()); mesh.bind(new THREE.Skeleton(bones, inv), mesh.matrixWorld); }
    // animations → AnimationClips addressed by node / mesh names (survive cloning)
    root.animations = (json.animations || []).map((an, ai) => {
      const tracks = [];
      for (const ch of an.channels) {
        const smp = an.samplers[ch.sampler], node = ch.target.node; if (node === undefined || !nodeObj[node]) continue;
        const times = accessor(smp.input).arr, vals = accessor(smp.output).arr, interp = smp.interpolation || 'LINEAR', path = ch.target.path;
        const make = (name, Type, values) => { const tr = new Type(name, times, values); if (interp === 'STEP') tr.setInterpolation(THREE.InterpolateDiscrete); if (interp === 'CUBICSPLINE') { tr.createInterpolant = function (result) { const ip = new (cubicClass())(this.times, this.values, this.getValueSize() / 3, result); ip.quat = Type === THREE.QuaternionKeyframeTrack; return ip; }; tr.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true; } return tr; };
        if (path === 'weights') { const targets = []; nodeObj[node].traverse(o => { if (o.morphTargetInfluences && o.name.startsWith(`__n${node}_`)) targets.push(o.name); }); targets.forEach(t => tracks.push(make(`${t}.morphTargetInfluences`, THREE.NumberKeyframeTrack, vals))); }
        else tracks.push(make(`__n${node}.${{ translation: 'position', rotation: 'quaternion', scale: 'scale' }[path]}`, path === 'rotation' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack, vals));
      }
      return new THREE.AnimationClip(an.name || 'Animation ' + (ai + 1), -1, tracks);
    });
    return root;
  }
  /* skinned meshes need their skeleton re-bound to the cloned bones — port of three.js SkeletonUtils.clone (MIT) */
  function cloneModel(src) {
    const clone = src.clone(true), map = new Map(), back = new Map(); const walk = (a, b) => { map.set(a, b); back.set(b, a); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]); }; walk(src, clone);
    clone.traverse(n => { if (!n.isSkinnedMesh) return; const s = back.get(n); n.skeleton = s.skeleton.clone(); n.bindMatrix.copy(s.bindMatrix); n.skeleton.bones = s.skeleton.bones.map(b => map.get(b)); n.bind(n.skeleton, n.bindMatrix); });
    clone.animations = src.animations; return clone;
  }
  function parseMTL(text, files) {
    const out = {}; let cur = null;
    for (const line of text.split('\n')) { const p = line.trim().split(/\s+/), k = (p[0] || '').toLowerCase(), rest = line.trim().slice(p[0] ? p[0].length : 0).trim();
      if (k === 'newmtl') out[cur = rest] = { color: [1, 1, 1], spec: 0, ns: 30, d: 1 }; else if (!cur) continue;
      else if (k === 'kd') out[cur].color = p.slice(1, 4).map(Number); else if (k === 'ks') out[cur].spec = Math.max(...p.slice(1, 4).map(Number)); else if (k === 'ns') out[cur].ns = +p[1]; else if (k === 'd') out[cur].d = +p[1]; else if (k === 'tr') out[cur].d = 1 - +p[1]; else if (k === 'ke') out[cur].emissive = p.slice(1, 4).map(Number);
      else if (k === 'map_kd') out[cur].map = baseName(rest.split(/\s+/).pop()); }
    return out;
  }
  async function parseOBJ(text, files, mtlText) {
    files = files || {}; const v = [], vt = [], vn = [], idx = (s, n) => { const i = parseInt(s, 10); return i < 0 ? n + i : i - 1; };
    const groups = []; let g = null; const use = name => { g = groups.find(x => x.mat === name) || (groups.push(g = { mat: name, pos: [], uv: [], nor: [] }), g); }; use('');
    let mtlFile = null;
    for (const line of text.split('\n')) { const p = line.trim().split(/\s+/);
      if (p[0] === 'v') v.push(p.slice(1, 4).map(Number)); else if (p[0] === 'vt') vt.push(p.slice(1, 3).map(Number)); else if (p[0] === 'vn') vn.push(p.slice(1, 4).map(Number));
      else if (p[0] === 'usemtl') use(line.trim().slice(7).trim()); else if (p[0] === 'mtllib') mtlFile = baseName(line.trim().slice(7).trim());
      else if (p[0] === 'f') { const c = p.slice(1).map(q => q.split('/')); for (let k = 1; k + 1 < c.length; k++) for (const q of [c[0], c[k], c[k + 1]]) { g.pos.push(...v[idx(q[0], v.length)]); if (q[1] && vt.length) g.uv.push(...vt[idx(q[1], vt.length)]); if (q[2] && vn.length) g.nor.push(...vn[idx(q[2], vn.length)]); } } }
    if (!mtlText && mtlFile && files[mtlFile]) mtlText = new TextDecoder().decode(files[mtlFile]);
    const lib = mtlText ? parseMTL(mtlText, files) : {}, root = new THREE.Group();
    for (const gr of groups) { if (!gr.pos.length) continue;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(gr.pos, 3)); if (gr.uv.length === gr.pos.length / 3 * 2) geo.setAttribute('uv', new THREE.Float32BufferAttribute(gr.uv, 2)); if (gr.nor.length === gr.pos.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(gr.nor, 3)); else geo.computeVertexNormals();
      const m = lib[gr.mat], mat = new THREE.MeshStandardMaterial({ color: m ? new THREE.Color(...m.color) : '#cccccc', roughness: m ? clamp(1 - Math.sqrt(m.ns / 1000), .05, 1) : .5, metalness: m ? clamp(m.spec * .3, 0, 1) : 0, opacity: m ? m.d : 1, transparent: !!m && m.d < 1 });
      if (m && m.emissive) mat.emissive = new THREE.Color(...m.emissive);
      if (m && m.map && files[m.map]) { const bmp = await createImageBitmap(new Blob([files[m.map]], { type: MIME[m.map.split('.').pop()] || 'image/png' }), { imageOrientation: 'flipY' }); const t = new THREE.Texture(bmp); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; mat.map = t; }
      const mesh = new THREE.Mesh(geo, mat); mesh.name = gr.mat || 'default'; root.add(mesh); }
    root.animations = []; return root;
  }
  /** normalize: centre the model on the origin and fit it into a ~3-unit box (bind pose) */
  function normalizeModel(root) { const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), k = 3 / Math.max(size.x, size.y, size.z, 1e-6), c = box.getCenter(new THREE.Vector3()); const wrap = new THREE.Group(); root.position.sub(c); wrap.add(root); wrap.scale.setScalar(k); wrap.animations = root.animations || []; return wrap; }
  const assetFiles = a => { const f = {}; for (const [n, d] of Object.entries(a.files || {})) f[n] = unb64(d); return f; };
  async function modelFor(sc, assetId) {
    if (models.has(assetId)) return models.get(assetId); if (modelLoads.has(assetId)) return modelLoads.get(assetId);
    const a = sc.assets && sc.assets[assetId]; if (!a) return null;
    const job = (async () => { const buf = unb64(a.data), files = assetFiles(a), root = a.kind === 'obj' ? await parseOBJ(new TextDecoder().decode(buf), files) : await parseGLTF(buf, files), m = normalizeModel(root); models.set(assetId, m); cache.delete(sc.id); requestRender(); if (S.view) draw(); return m; })();
    modelLoads.set(assetId, job); try { return await job; } finally { modelLoads.delete(assetId); }
  }
  /** import a model: one .glb, or a .gltf / .obj together with the files it references (.bin, .mtl, textures) */
  async function importModel(sc, fileOrFiles) {
    const list = Array.isArray(fileOrFiles) ? fileOrFiles : fileOrFiles instanceof FileList ? [...fileOrFiles] : [fileOrFiles];
    const main = list.find(f => /\.(glb|gltf|obj)$/i.test(f.name)); if (!main) throw new Error('Choose a .glb, .gltf or .obj file (plus its .bin / .mtl / texture files)');
    const ext = main.name.split('.').pop().toLowerCase(), buf = await main.arrayBuffer(), files = {}; let total = buf.byteLength;
    for (const f of list) if (f !== main) { const b = await f.arrayBuffer(); files[baseName(f.name)] = b64(b); total += b.byteLength; }
    if (total > 120e6) throw new Error('Model files are larger than 120 MB');
    const id = uid(); (sc.assets || (sc.assets = {}))[id] = { name: main.name, kind: ext === 'obj' ? 'obj' : 'gltf', data: b64(buf), files };
    try { await modelFor(sc, id); } catch (e) { delete sc.assets[id]; throw e; }
    const m = models.get(id), clips = (m.animations || []).map(c => ({ name: c.name, dur: +c.duration.toFixed(3) }));
    return addObject(sc, 'model', { name: main.name.replace(/\.[^.]+$/, ''), asset: id, color: '#ffffff', metal: 0, rough: 1, clip: clips.length ? 0 : -1, clips, animSpeed: 1 });
  }

  /* ---------- renderer (one shared WebGL context) ---------- */
  let R = null; const cache = new Map(), outs = new Map();
  function renderer() { if (!R) { R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); R.outputColorSpace = THREE.SRGBColorSpace; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; } return R; }
  function geometry(ob) {
    switch (ob.type) {
      case 'box': return new THREE.BoxGeometry(1.6, 1.6, 1.6);
      case 'sphere': return new THREE.SphereGeometry(1, 64, 32);
      case 'torus': return new THREE.TorusGeometry(1, .38, 32, 96);
      case 'knot': return new THREE.TorusKnotGeometry(.9, .3, 200, 32);
      case 'cylinder': return new THREE.CylinderGeometry(.8, .8, 1.8, 64);
      case 'cone': return new THREE.ConeGeometry(.9, 1.8, 64);
      case 'floor': return new THREE.PlaneGeometry(40, 40);
      case 'text': case 'image': return new THREE.PlaneGeometry(1, 1);
    }
    return new THREE.BoxGeometry(1, 1, 1);
  }
  function textTexture(ob) {
    const c = document.createElement('canvas'), x = c.getContext('2d'), fs = 160; x.font = `900 ${fs}px Segoe UI, Inter, sans-serif`; const w = Math.ceil(x.measureText(ob.text || ' ').width) + 40;
    c.width = Math.min(4096, w); c.height = fs * 1.3; x.font = `900 ${fs}px Segoe UI, Inter, sans-serif`; x.fillStyle = '#ffffff'; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(ob.text || '', c.width / 2, c.height / 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return { t, aspect: c.width / c.height };
  }
  /** build (or reuse) the three.js scene graph for a scene; rebuilt when its JSON changes */
  function graph(sc) {
    const key = JSON.stringify(sc, (k, v) => k === 'assets' ? Object.keys(v) : v), hit = cache.get(sc.id); /* model bytes are not part of the change key */ if (hit && hit.key === key) return hit;
    if (hit) hit.dispose();
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(sc.cam.fov, sc.w / sc.h, .1, 500), meshes = [];
    if (sc.bg !== 'transparent') scene.background = new THREE.Color(sc.bg);
    scene.add(new THREE.HemisphereLight(sc.light.amb, '#101018', sc.light.ambI));
    const key1 = new THREE.DirectionalLight(sc.light.key, sc.light.keyI); key1.position.set(4, 7, 5); key1.castShadow = !!sc.light.shadows; key1.shadow.mapSize.set(2048, 2048); Object.assign(key1.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); scene.add(key1);
    const rim = new THREE.DirectionalLight('#3b9bff', .8); rim.position.set(-5, 3, -6); scene.add(rim);
    for (const ob of sc.objects) {
      if (ob.type === 'model') {                                            // imported model: its own materials; loads async on first use
        const src = models.get(ob.asset); if (!src) { modelFor(sc, ob.asset); continue; }
        const inst = cloneModel(src); inst.traverse(o => { o.userData.shared = true; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); const holder = new THREE.Group(); holder.add(inst); holder.userData = { ob, sx: 1, sy: 1 };
        const clip = ob.clip >= 0 && src.animations[ob.clip]; if (clip) { const mx = new THREE.AnimationMixer(inst); mx.clipAction(clip).play(); holder.userData.mixer = mx; }   // driven by scene time in frame()
        scene.add(holder); meshes.push(holder); continue;
      }
      if (ob.type === 'text3d') {                                            // extruded lettering with bevel, centred on its origin
        const data = font(ob.font || 'helvetiker'); if (!data) continue;
        const geo = new THREE.ExtrudeGeometry(textShapes(ob.text || ' ', 1, data), { depth: ob.depth ?? .35, curveSegments: 10, bevelEnabled: true, bevelThickness: .04, bevelSize: .025, bevelSegments: 3 }); geo.computeBoundingBox(); const bb = geo.boundingBox; geo.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: ob.color, metalness: ob.metal, roughness: ob.rough, emissive: new THREE.Color(ob.color).multiplyScalar(ob.glow || 0) })); mesh.castShadow = mesh.receiveShadow = true; mesh.userData = { ob, sx: 1, sy: 1 }; scene.add(mesh); meshes.push(mesh); continue;
      }
      const g = geometry(ob), mat = new THREE.MeshStandardMaterial({ color: ob.color, metalness: ob.metal, roughness: ob.rough, emissive: new THREE.Color(ob.color).multiplyScalar(ob.glow || 0), side: ob.type === 'text' || ob.type === 'image' || ob.type === 'floor' ? THREE.DoubleSide : THREE.FrontSide });
      let sx = 1, sy = 1;
      if (ob.type === 'text') { const { t, aspect } = textTexture(ob); mat.map = t; mat.transparent = true; mat.alphaTest = .05; sx = aspect * 1.2; sy = 1.2; }
      if (ob.type === 'image' && media[ob.media] && media[ob.media].img) { const m = media[ob.media], t = new THREE.CanvasTexture(m.img); t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.color.set('#ffffff'); mat.transparent = true; const a = (m.w || 1) / (m.h || 1); sx = a >= 1 ? 3 : 3 * a; sy = a >= 1 ? 3 / a : 3; }
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = ob.type !== 'floor'; mesh.receiveShadow = true; mesh.userData = { ob, sx, sy }; scene.add(mesh); meshes.push(mesh);
    }
    const out = { key, scene, cam, meshes, dispose() { scene.traverse(o => { if (o.userData.shared) return; if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); } };
    cache.set(sc.id, out); return out;
  }
  const rad = d => d * Math.PI / 180;
  /** render scene at time t (seconds from its start) → a canvas of the scene's size (one per scene, reused) */
  function frame(sc, t) {
    if (!ready() || !sc) return null; const G = graph(sc), r = renderer();
    for (const m of G.meshes) { const { ob, sx, sy } = m.userData, s = ob.scale || 1; m.position.set(ob.pos[0], ob.pos[1] + (ob.bob ? Math.sin(t * Math.PI) * ob.bob : 0), ob.pos[2]); m.rotation.set(rad(ob.rot[0] + ob.spin[0] * t), rad(ob.rot[1] + ob.spin[1] * t), rad(ob.rot[2] + ob.spin[2] * t)); const z = ob.size || [1, 1, 1]; m.scale.set(s * sx * z[0], s * sy * z[1], s * z[2]); if (m.userData.mixer) m.userData.mixer.setTime(Math.max(0, t * (ob.animSpeed ?? 1))); }
    const c = sc.cam, az = rad((c.az || 0) + (c.orbit || 0) * t); G.cam.fov = c.fov; G.cam.aspect = sc.w / sc.h; G.cam.updateProjectionMatrix(); G.cam.position.set(Math.sin(az) * c.dist, c.height, Math.cos(az) * c.dist); G.cam.lookAt(0, c.lookY || 0, 0);   /* aim height: frame a face, not the ground */
    r.setPixelRatio(1); r.setSize(sc.w, sc.h, false); r.setClearColor(0x000000, 0); r.render(G.scene, G.cam);
    let o = outs.get(sc.id); if (!o || o.width !== sc.w || o.height !== sc.h) { o = document.createElement('canvas'); o.width = sc.w; o.height = sc.h; outs.set(sc.id, o); }
    const x = o.getContext('2d'); x.clearRect(0, 0, sc.w, sc.h); x.drawImage(r.domElement, 0, 0); return o;
  }
  /** timeline hook (engine contentOfBase case '3d') */
  function layerFrame(L, t) { const sc = store()[L.sceneRef]; if (!sc) return null; if (!ready()) { load().then(() => requestRender()); return null; } const lt = L.srcIn + (t - L.start) * L.speed, c = frame(sc, lt); return c ? { src: c, w: sc.w, h: sc.h } : null; }
  function place(sc) { sc = sc || S.scene; Shell.go('edit'); const L = mkLayer('3d', { name: sc.name, start: T, dur: sc.dur }); L.sceneRef = sc.id; L.tr.s = +(Math.min(proj().w / sc.w, proj().h / sc.h) * 100).toFixed(2); addLayer(L); commit(); toast('Placed as a linked 3D layer — scene edits update it.'); return L; }
  const usage = id => { let n = 0; const walk = ls => ls.forEach(l => { if (l.sceneRef === id) n++; if (l.comp) walk(l.comp.layers); }); walk(proj().layers); return n; };

  /* ---------- UI ---------- */
  async function enter(root) {
    S.root = root; if (!S.built) root.innerHTML = '<div class="abar"><b>3D</b><span class="dim">Loading engine…</span></div>';
    await load(); if (!S.built) build(root);
    if (!S.scene || !store()[S.scene.id]) S.scene = Object.values(store())[0] || newScene({});
    if (!S.sel || !S.scene.objects.includes(S.sel)) S.sel = S.scene.objects[0] || null;
    render(); draw();
  }
  function build(root) {
    root.innerHTML = ''; S.built = true; S.bar = el('div', { class: 'abar' }); S.list = el('div', { class: 'tlist' }); S.view = el('canvas', { class: 'tview' }); S.insp = el('div', { class: 'vinsp' });
    S.stage = el('div', { class: 'vstage' }, S.view);
    root.append(S.bar, el('div', { class: 'vbody' }, S.list, S.stage, S.insp));
    // drag in the viewport orbits the camera; wheel zooms
    let d = null; S.view.onpointerdown = e => { d = { x: e.clientX, y: e.clientY, az: S.scene.cam.az || 0, h: S.scene.cam.height }; S.view.setPointerCapture(e.pointerId); };
    S.view.onpointermove = e => { if (!d) return; S.scene.cam.az = d.az - (e.clientX - d.x) * .4; S.scene.cam.height = clamp(d.h + (e.clientY - d.y) * .03, -6, 12); draw(); };
    S.view.onpointerup = () => { if (d) { d = null; touch(); } };
    S.view.onwheel = e => { e.preventDefault(); S.scene.cam.dist = clamp(S.scene.cam.dist * (e.deltaY > 0 ? 1.08 : .93), 2, 60); draw(); touch(); };
    new ResizeObserver(() => draw()).observe(S.stage);
  }
  function touch() { requestRender(); if (typeof Recovery !== 'undefined') Recovery.touch(); }
  function draw() {
    if (!S.view || !S.scene) return; const sc = S.scene, c = frame(sc, S.playT); if (!c) return;
    const box = S.stage.getBoundingClientRect(), k = Math.min((box.width - 30) / sc.w, (box.height - 30) / sc.h) || .5; S.view.width = sc.w; S.view.height = sc.h; S.view.style.width = sc.w * k + 'px'; S.view.style.height = sc.h * k + 'px';
    const x = S.view.getContext('2d'); x.clearRect(0, 0, sc.w, sc.h); x.drawImage(c, 0, 0);
  }
  function play() { if (S.playing) { S.playing = false; render(); return; } S.playing = true; render(); const t0 = performance.now() - S.playT * 1000; const step = now => { if (!S.playing || !S.root || S.root.closest('.hidden')) { S.playing = false; return; } S.playT = ((now - t0) / 1000) % S.scene.dur; draw(); requestAnimationFrame(step); }; requestAnimationFrame(step); }
  function render() {
    const sc = S.scene; if (!S.bar || !sc) return; const b = (icon, label, title, fn, cls) => el('button', { class: 'ibtn ' + (cls || ''), title, onclick: fn }, icon ? Icon(icon, 14) : null, label);
    S.bar.innerHTML = '';
    S.bar.append(el('b', {}, '3D'), el('select', { onchange: e => { S.scene = e.target.value === '+' ? newScene({}) : store()[e.target.value]; S.sel = S.scene.objects[0] || null; render(); draw(); } }, Object.values(store()).map(x => el('option', { value: x.id, selected: x.id === sc.id ? '' : undefined }, x.name)), el('option', { value: '+' }, '+ New scene')),
      b('rename', '', 'Rename scene', async () => { const v = await askText('Scene name', sc.name); if (v) { sc.name = v; render(); touch(); } }),
      b('play', S.playing ? 'Pause' : 'Preview', 'Play the scene animation', play),
      el('label', { class: 'dim' }, 'Length ', el('input', { type: 'number', min: .5, max: 120, step: .5, value: sc.dur, style: 'width:64px', onchange: e => { sc.dur = Math.max(.5, +e.target.value); touch(); } }), ' s'),
      el('label', { class: 'dim' }, 'Background ', el('select', { onchange: e => { sc.bg = e.target.value === 'color' ? '#0b0b14' : 'transparent'; render(); draw(); touch(); } }, el('option', { value: 'transparent' }, 'Transparent'), el('option', { value: 'color', selected: sc.bg !== 'transparent' ? '' : undefined }, 'Colour'))),
      sc.bg !== 'transparent' ? el('input', { type: 'color', value: sc.bg, oninput: e => { sc.bg = e.target.value; draw(); }, onchange: touch }) : null,
      el('div', { class: 'spacer' }), usage(sc.id) ? el('span', { class: 'pill' }, Icon('link', 12), `On timeline ×${usage(sc.id)}`) : null, b('edit', 'Place on timeline', 'Add this scene to the Edit timeline (linked)', () => place(sc), 'primary'));
    // object list
    S.list.innerHTML = ''; S.list.append(el('h4', {}, 'Objects'));
    for (const ob of sc.objects) S.list.append(el('div', { class: 'tobj' + (ob === S.sel ? ' on' : ''), onclick: () => { S.sel = ob; render(); } }, Icon(ob.type === 'text' ? 'text' : ob.type === 'image' ? 'image' : 'cube', 14), el('span', {}, ob.name), el('button', { class: 'x', title: 'Delete', onclick: e => { e.stopPropagation(); sc.objects.splice(sc.objects.indexOf(ob), 1); if (S.sel === ob) S.sel = sc.objects[0] || null; render(); draw(); touch(); } }, Icon('trash', 12))));
    S.list.append(el('h4', {}, 'Add'), el('div', { class: 'tadd' }, ['box', 'sphere', 'torus', 'knot', 'cylinder', 'cone', 'text3d', 'text', 'image', 'floor'].map(t => el('button', { title: t === 'text3d' ? 'Extruded 3D lettering' : t === 'text' ? 'Flat text card' : '', onclick: () => { const o = {}; if (t === 'image') { const im = Object.values(media).find(m => m.kind === 'image'); if (!im) return toast('Import an image first (Edit › Media).'); o.media = im.id; } S.sel = addObject(sc, t, o); render(); draw(); touch(); } }, t))));
    S.list.append(el('button', { class: 'ibtn', style: 'margin-top:8px;width:100%', onclick: () => { const i = el('input', { type: 'file', multiple: '', accept: '.glb,.gltf,.obj,.bin,.mtl,.png,.jpg,.jpeg,.webp' }); i.onchange = async () => { if (!i.files.length) return; toast('Importing model…'); try { S.sel = await importModel(sc, [...i.files]); render(); draw(); touch(); toast('Model imported'); } catch (e) { toast('Import failed: ' + e.message); } }; i.click(); } }, Icon('import', 14), 'Import model…'), el('div', { class: 'dim', style: 'font-size:11px;margin-top:4px' }, 'Pick a .glb, or a .gltf / .obj together with its .bin, .mtl and texture files.'));
    // inspector
    S.insp.innerHTML = ''; const ob = S.sel;
    const num = (label, get, set, min, max, step) => { const v = el('span', { class: 'v' }, (+get()).toFixed(step < 1 ? 2 : 0)); return el('label', { class: 'ctl' }, el('span', { class: 'k' }, label), el('input', { type: 'range', min, max, step, value: get(), oninput: e => { set(+e.target.value); v.textContent = (+e.target.value).toFixed(step < 1 ? 2 : 0); draw(); }, onchange: touch }), v); };
    const col = (label, get, set) => el('label', { class: 'vrow' }, el('span', {}, label), el('input', { type: 'color', value: get(), oninput: e => { set(e.target.value); draw(); }, onchange: touch }));
    S.insp.append(el('h4', {}, 'Camera'), num('Distance', () => sc.cam.dist, v => sc.cam.dist = v, 2, 40, .1), num('Height', () => sc.cam.height, v => sc.cam.height = v, -6, 12, .1), num('Aim height', () => sc.cam.lookY || 0, v => sc.cam.lookY = v, -4, 8, .05), num('Lens (fov)', () => sc.cam.fov, v => sc.cam.fov = v, 15, 90, 1), num('Orbit °/s', () => sc.cam.orbit, v => sc.cam.orbit = v, -90, 90, 1),
      el('h4', {}, 'Light'), col('Key', () => sc.light.key, v => sc.light.key = v), num('Key strength', () => sc.light.keyI, v => sc.light.keyI = v, 0, 6, .1), col('Ambient', () => sc.light.amb, v => sc.light.amb = v), num('Ambient', () => sc.light.ambI, v => sc.light.ambI = v, 0, 3, .05),
      el('label', { class: 'vrow' }, el('span', {}, 'Shadows'), el('input', { type: 'checkbox', checked: sc.light.shadows ? '' : undefined, onchange: e => { sc.light.shadows = e.target.checked; draw(); touch(); } })));
    if (ob) {
      S.insp.append(el('h4', {}, ob.name),
        ob.type === 'text' || ob.type === 'text3d' ? el('label', { class: 'vrow' }, el('span', {}, 'Text'), el('input', { value: ob.text, onchange: e => { ob.text = e.target.value; draw(); touch(); } })) : null,
        ob.type === 'text3d' ? el('label', { class: 'vrow' }, el('span', {}, 'Font'), el('select', { onchange: e => { ob.font = e.target.value; draw(); touch(); } }, Object.entries(FONTS).map(([k, n]) => el('option', { value: k, selected: ob.font === k ? '' : undefined }, n)))) : null,
        ob.type === 'text3d' ? num('Depth', () => ob.depth, v => ob.depth = v, .02, 2, .01) : null,
        ob.type === 'model' && (ob.clips || []).length ? el('label', { class: 'vrow' }, el('span', {}, 'Animation'), el('select', { onchange: e => { ob.clip = +e.target.value; draw(); touch(); } }, el('option', { value: -1 }, 'None (rest pose)'), ob.clips.map((c, i) => el('option', { value: i, selected: ob.clip === i ? '' : undefined }, `${c.name} (${c.dur}s)`)))) : null,
        ob.type === 'model' && (ob.clips || []).length ? num('Anim speed', () => ob.animSpeed ?? 1, v => ob.animSpeed = v, 0, 4, .05) : null,
        ob.type === 'image' ? el('label', { class: 'vrow' }, el('span', {}, 'Image'), el('select', { onchange: e => { ob.media = e.target.value; draw(); touch(); } }, Object.values(media).filter(m => m.kind === 'image').map(m => el('option', { value: m.id, selected: m.id === ob.media ? '' : undefined }, m.name)))) : null,
        col('Colour', () => ob.color, v => ob.color = v), num('Metal', () => ob.metal, v => ob.metal = v, 0, 1, .01), num('Rough', () => ob.rough, v => ob.rough = v, 0, 1, .01), num('Glow', () => ob.glow, v => ob.glow = v, 0, 2, .05),
        num('X', () => ob.pos[0], v => ob.pos[0] = v, -8, 8, .05), num('Y', () => ob.pos[1], v => ob.pos[1] = v, -8, 8, .05), num('Z', () => ob.pos[2], v => ob.pos[2] = v, -8, 8, .05),
        ob.type === 'box' ? el('div', {}, num('Width', () => (ob.size || [1, 1, 1])[0], v => (ob.size = ob.size || [1, 1, 1])[0] = v, .05, 10, .05), num('Height', () => (ob.size || [1, 1, 1])[1], v => (ob.size = ob.size || [1, 1, 1])[1] = v, .05, 10, .05), num('Depth', () => (ob.size || [1, 1, 1])[2], v => (ob.size = ob.size || [1, 1, 1])[2] = v, .05, 10, .05)) : null,
        num('Tilt °', () => ob.rot[0], v => ob.rot[0] = v, -180, 180, 1), num('Turn °', () => ob.rot[1], v => ob.rot[1] = v, -180, 180, 1), num('Roll °', () => ob.rot[2], v => ob.rot[2] = v, -180, 180, 1), num('Scale', () => ob.scale, v => ob.scale = v, .05, 6, .05),
        el('h4', {}, 'Animation'), num('Spin X °/s', () => ob.spin[0], v => ob.spin[0] = v, -360, 360, 1), num('Spin Y °/s', () => ob.spin[1], v => ob.spin[1] = v, -360, 360, 1), num('Bob', () => ob.bob, v => ob.bob = v, 0, 2, .05));
    }
  }
  return { S, clearModels: () => { models.clear(); cache.clear(); }, load, ready, enter, newScene, addObject, importModel, modelFor, font, textShapes, frame, layerFrame, place, store, usage };
})();
