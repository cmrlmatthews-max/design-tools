/* ==========================================================================
   RENDER
   Scene, cameras, preset views, picking. The scene is the PROJECT frame, shifted so the middle of the site (or of the model) sits at
   the origin and the lowest ground at height 0: every drawn point is (project x - shift.x, project y - shift.y, project z - shift.z).
   Plan coordinates are (x east, y north) in feet; elevation is up. Three.js is Y-up, so plan y maps to -z.
   planToWorld() is the ONLY place that mapping is written; geometry uses planMatrix built from it.
   ========================================================================== */
/** Plan (x, y, elevation) -> Three.js world [x, y, z]. North (plan +y) is world -z. */
function planToWorld(x, y, elev = 0) { return [x, elev, -y]; }
const worldVec = (x, y, e = 0) => new THREE.Vector3(...planToWorld(x, y, e));
/** Matrix equivalent of planToWorld, for geometry authored in plan space (shape x,y; extrusion up = elevation). */
function planMatrix(elev = 0) {
  const o = worldVec(0, 0, 0);
  const ex = worldVec(1, 0, 0).sub(o), ey = worldVec(0, 1, 0).sub(o), ez = worldVec(0, 0, 1).sub(o);
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
  m.setPosition(worldVec(0, 0, elev));
  return m;
}

/** What color an item draws in, and what the legend says. One place, used by the scene, the legend and the tests. */
const Paint = (() => {
  const css = (name, fb) => { let v = ''; try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { v = ''; } return v || fb; };
  const HERO_LAYERS = new Set(['massing', 'units', 'cores', 'facade']);
  /** The palette key an item draws with, or null when it draws in a plain color. */
  function keyOf(item, opts = {}) {
    if (opts.aiReady) return null;
    const st = State.raw();
    if (item.kind === 'neighbor') return null;
    if (st.mode === 'model' && !item.cut) return null;
    // The cut level draws in plan colors: units by type, the rest by program (the plan view of the floor).
    if (item.cut && item.layer === 'units') return colorKey(item, 'unitType');
    if (item.cut && st.mode === 'model') return colorKey(item, 'program');
    return colorKey(item, st.colorBy);
  }
  function hex(item, opts = {}) {
    if (opts.aiReady) return HERO_LAYERS.has(item.layer) ? CONFIG.heroColor : CONFIG.whiteColor;
    if (item.kind === 'neighbor') return css('--scene-context', '#c9cdd2');
    const k = keyOf(item, opts);
    if (k) return colorOf(k);
    return item.kind === 'stall' ? '#c3c8cd' : css('--scene-model', CONFIG.modelColor);
  }
  const KEY_LABELS = { 'layer:site': 'Site', 'layer:massing': 'Massing', 'layer:units': 'Units', 'layer:cores': 'Cores and corridors', 'layer:parking': 'Parking', 'layer:facade': 'Facade', 'layer:grading': 'Grading' };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  function labelOf(key) {
    if (KEY_LABELS[key]) return KEY_LABELS[key];
    const i = key.indexOf(':'), kind = key.slice(0, i), name = key.slice(i + 1);
    if (kind === 'program') return cap(name);
    if (kind === 'unit') return name;
    if (kind === 'facade') return `Facade, ${name}`;
    if (kind === 'stall') return `Stall, ${name}`;
    return cap(name);
  }
  return { keyOf, hex, labelOf };
})();

const Render = (() => {
  const FOV = 30;
  const ORTHO_HALF = 100;               // ortho frustum half-height; zoom does the rest
  const rad = THREE.MathUtils.degToRad;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FIT_MARGIN = 0.05;
  const tanHalfFov = Math.tan(rad(FOV) / 2);
  const DEFAULT_SUN = { azimuth: 150, altitude: 42 };

  let host, renderer, scene, persp, ortho, cam, camType = 'persp', controls;
  let hemi, sun, gridMesh;
  let siteGroup, modelGroup, selGroup;
  const parts = { main: null, neighbors: null, mainEdges: null, neighborEdges: null };   // the merged meshes and their edges
  let ranges = { main: [], neighbors: [] };                                              // [{ item, start, count }] in vertices, sorted by start
  let siteDrawn = { key: null, info: null };
  let geomKey = null, viewVersionSeen = -1, modelVersionSeen = -1, themeEpoch = 0, themeSeen = -1, paintKey = null, sunKeySeen = '';
  let needsRender = true, tween = null, preset = null, capturing = false, aiReady = false, selectedId = null, sceneRadius = 200;
  let drawn = { items: 0, solids: 0, flats: 0, ramps: 0, neighbors: 0, byLayer: {}, triangles: 0, vertices: 0 };
  const viewListeners = [], pickListeners = [];
  const gridUniforms = {
    uMinor: { value: new THREE.Color() }, uMajor: { value: new THREE.Color() },
    uMinorA: { value: 0.42 }, uMajorA: { value: 0.8 }, uFade: { value: new THREE.Vector2(450, 1100) },
  };

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const cssColor = (name, fallback = '#888') => new THREE.Color(css(name) || fallback);

  /* ---- scene ---------------------------------------------------------------- */
  function buildScene() {
    scene = new THREE.Scene();
    hemi = new THREE.HemisphereLight(0xffffff, 0xb4bac2, 2.3);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.castShadow = true;
    const fine = window.matchMedia && matchMedia('(pointer: fine)').matches;
    sun.shadow.mapSize.set(fine ? 4096 : 2048, fine ? 4096 : 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.4;
    scene.add(sun, sun.target);

    const gp = new THREE.PlaneGeometry(8000, 8000);
    gp.applyMatrix4(planMatrix(-0.05));
    gridMesh = new THREE.Mesh(gp, new THREE.ShaderMaterial({
      uniforms: gridUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform vec3 uMinor; uniform vec3 uMajor; uniform float uMinorA; uniform float uMajorA; uniform vec2 uFade;
        varying vec3 vW;
        float gridLine(vec2 p, float size){
          vec2 c = p / size;
          vec2 fw = max(fwidth(c), vec2(1e-6));
          vec2 g = abs(fract(c - 0.5) - 0.5) / fw;
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float f = max(fw.x, fw.y);
          return line * (1.0 - smoothstep(0.12, 0.3, f));
        }
        void main(){
          float minor = gridLine(vW.xz, 10.0) * uMinorA;
          float major = gridLine(vW.xz, 50.0) * uMajorA;
          float fade = 1.0 - smoothstep(uFade.x, uFade.y, length(vW.xz));
          float a = max(minor, major) * fade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(major >= minor ? uMajor : uMinor, a);
          #include <colorspace_fragment>
        }`,
    }));
    gridMesh.renderOrder = 2;
    scene.add(gridMesh);

    siteGroup = new THREE.Group(); modelGroup = new THREE.Group(); selGroup = new THREE.Group();
    selGroup.renderOrder = 10;
    scene.add(siteGroup, modelGroup, selGroup);
  }

  function disposeGroup(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.userData && o.userData.ownMat && o.material) o.material.dispose();
    }
  }

  /* ---- the model: one merged mesh of every solid, with vertex colors and a triangle-to-item table ------------------ */
  const ZERO = () => ({ x: 0, y: 0, z: 0 });
  /** Geometry of one item in scene coordinates, non-indexed, with position and normal only. null when the item has no shape. */
  function itemGeometry(it, sh) {
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    let g = null;
    if (it.kind === 'ramp' && Array.isArray(it.outer3) && it.outer3.length >= 3) {
      const pts = it.outer3.map((p) => new THREE.Vector2(p[0] - sh.x, p[1] - sh.y));
      const tri = THREE.ShapeUtils.triangulateShape(pts, []);
      if (!tri.length) return null;
      const pos = [], nor = [];
      for (const t of tri) for (const i of t) { const p = it.outer3[i]; pos.push(p[0] - sh.x, p[2] - sh.z, -(p[1] - sh.y)); nor.push(0, 1, 0); }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      return g;
    }
    if (!Array.isArray(it.outer) || it.outer.length < 3 || !fin(it.z0)) return null;
    const shape = new THREE.Shape(it.outer.map((p) => new THREE.Vector2(p[0] - sh.x, p[1] - sh.y)));
    for (const hole of it.holes || []) if (Array.isArray(hole) && hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p[0] - sh.x, p[1] - sh.y))));
    const depth = (fin(it.z1) ? it.z1 : it.z0) - it.z0;
    if (depth > 0.001) g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
    else g = new THREE.ShapeGeometry(shape);
    g.applyMatrix4(planMatrix(it.z0 - sh.z));
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    return g;
  }

  /** Builds { mesh, edges, ranges } for a list of items. Colors are written later by paint(). */
  function buildMerged(list, sh, material, edgeMaterial) {
    const geoms = [], rs = [];
    let start = 0;
    for (const it of list) {
      let g = null;
      try { g = itemGeometry(it, sh); } catch (e) { g = null; }
      if (!g) continue;
      const count = g.attributes.position.count;
      geoms.push(g); rs.push({ item: it, start, count });
      start += count;
    }
    if (!geoms.length) return null;
    const merged = BufferGeometryUtils.mergeGeometries(geoms, false);
    geoms.forEach((g) => g.dispose());
    if (!merged) return null;
    merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(start * 3), 3));
    const mesh = new THREE.Mesh(merged, material);
    mesh.userData.model = true;
    const eg = new THREE.EdgesGeometry(merged, 28);
    const edges = new THREE.LineSegments(eg, edgeMaterial);
    edges.userData.edges = true;
    edges.raycast = () => {};
    return { mesh, edges, ranges: rs, vertices: start };
  }

  function paint() {
    const writeAll = (mesh, rs) => {
      if (!mesh) return;
      const col = mesh.geometry.attributes.color, c = new THREE.Color();
      for (const r of rs) {
        c.set(Paint.hex(r.item, { aiReady }));
        for (let i = r.start; i < r.start + r.count; i++) col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    };
    writeAll(parts.main, ranges.main);
    writeAll(parts.neighbors, ranges.neighbors);
    paintKey = paintKeyNow();
    needsRender = true;
  }
  const paintKeyNow = () => { const s = State.raw(); return `${s.mode}|${s.colorBy}|${aiReady}|${themeEpoch}`; };

  function geometryKey() {
    const s = State.raw();
    return [Model.version(), JSON.stringify(s.layers), s.cutKey || '', s.siteStyle, themeEpoch].join('|');
  }

  function rebuildModel() {
    disposeGroup(modelGroup);
    for (const k of Object.keys(parts)) parts[k] = null;
    ranges = { main: [], neighbors: [] };
    const doc = Model.doc();
    drawn = { items: 0, solids: 0, flats: 0, ramps: 0, neighbors: 0, byLayer: {}, triangles: 0, vertices: 0 };
    if (!doc) return;
    const sh = Model.shift() || ZERO();
    const mainItems = [], nbItems = [];
    for (const id of TOGGLE_LAYERS) {
      for (const it of Model.shown(id)) {
        if (it.kind === 'ground') continue;           // the proposed ground is drawn by the site adapter below
        if (it.kind === 'neighbor') nbItems.push(it); else mainItems.push(it);
      }
    }
    const edgeColor = cssColor('--scene-edge', '#20262d');
    const mkEdge = (opacity) => new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity });
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const main = buildMerged(mainItems, sh, solidMat, mkEdge(0.55));
    if (main) {
      parts.main = main.mesh; parts.mainEdges = main.edges; ranges.main = main.ranges;
      main.mesh.userData.ownMat = true;
      main.mesh.castShadow = true; main.mesh.receiveShadow = true;
      modelGroup.add(main.mesh, main.edges);
    }
    const style = State.get('siteStyle');
    const nbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    if (style === 'glass') { nbMat.transparent = true; nbMat.opacity = 0.25; nbMat.depthWrite = false; }
    if (style === 'wireframe') { nbMat.colorWrite = false; nbMat.depthWrite = false; }
    const nb = buildMerged(nbItems, sh, nbMat, mkEdge(style === 'glass' ? 0.85 : 0.6));
    if (nb) {
      parts.neighbors = nb.mesh; parts.neighborEdges = nb.edges; ranges.neighbors = nb.ranges;
      nb.mesh.userData.ownMat = true;
      nb.mesh.castShadow = style === 'solid'; nb.mesh.receiveShadow = style !== 'wireframe';
      if (style === 'glass') nb.mesh.renderOrder = 2;
      modelGroup.add(nb.mesh, nb.edges);
    }
    for (const r of [...ranges.main, ...ranges.neighbors]) {
      const it = r.item;
      drawn.items++;
      drawn.byLayer[it.layer] = (drawn.byLayer[it.layer] || 0) + 1;
      if (it.kind === 'neighbor') drawn.neighbors++;
      else if (it.kind === 'stall') drawn.flats++;
      else if (it.kind === 'ramp') drawn.ramps++;
      else drawn.solids++;
    }
    drawn.vertices = (main ? main.vertices : 0) + (nb ? nb.vertices : 0);
    drawn.triangles = drawn.vertices / 3;
    // The light covers the model.
    const b = Model.buildingBounds(), s = Model.siteBounds();
    const box = b || s;
    if (box) {
      const ex = Math.max(box.maxX - box.minX, 40), ey = Math.max(box.maxY - box.minY, 40), hh = Math.max((box.zMax || 0) - sh.z, 40);
      sceneRadius = Math.max(120, 0.5 * Math.sqrt(ex * ex + ey * ey + hh * hh));
    }
    sunKeySeen = '';
    if (selectedId) { const it = Model.itemById(selectedId); drawSelection(it && Model.shown(it.layer).includes(it) ? it : null); }
  }

  /* ---- the site adapter: the ground, boundary, roads, walks, water and trees come from the shared site layer ----------- */
  function syncSite() {
    const doc = Model.doc();
    const st = State.raw();
    const all = Model.all();
    const wantSite = !!doc && !!all && all.site.ok && st.layers.site;
    const grad = !!doc && !!all && st.layers.grading && all.grading.ok ? all.grading.items.find((i) => i.kind === 'ground') : null;
    const key = [Model.version(), wantSite, !!grad, themeEpoch].join('|');
    if (siteDrawn.key === key) return false;
    SiteLayer3D.dispose(siteGroup.children);
    disposeGroup(siteGroup);
    siteDrawn = { key, info: null };
    const sh = Model.shift() || ZERO();
    if (!doc || (!wantSite && !grad)) { gridMesh.visible = true; return true; }
    let dv = null;
    try { const sec = ProjectMod.getSection(doc, 'site'); dv = sec && sec.derived && typeof sec.derived === 'object' ? sec.derived : null; } catch (e) { dv = null; }
    if (!wantSite) dv = null;
    if (grad) dv = { ...(dv || {}), ground: { spacing: grad.grid.spacing, n: grad.grid.n, points: grad.grid.points } };
    let data = null;
    try { data = SiteLayerMod.buildSiteLayerData(dv, { x: sh.x, y: sh.y, rotation: 0, baseZ: sh.z }, { contextIds: new Set() }); } catch (e) { console.error(e); data = null; }
    if (data && data.ok) {
      // The neighbor buildings are the viewer's own solids (so they can be tapped, cut and colored), not part of the site layer.
      data.buildings = [];
      let res = null;
      try { res = SiteLayer3D.objects(data, { style: 'solid', parts: ['ground', 'boundary', 'roads', 'walks', 'water', 'trees'], rotation: 0, edges: true, shadows: true, css: (n, f) => cssColor(n, f) }); } catch (e) { console.error(e); res = null; }
      if (res) { for (const o of res.objects) siteGroup.add(o); siteDrawn.info = res.info; }
    }
    gridMesh.visible = !(siteDrawn.info && siteDrawn.info.ground);
    return true;
  }

  /* ---- selection outline ---------------------------------------------------------------------------------------------- */
  function drawSelection(item) {
    disposeGroup(selGroup);
    selectedId = item ? item.id : null;
    needsRender = true;
    if (!item) return;
    const sh = Model.shift() || ZERO();
    const W = (p, z) => worldVec(p[0] - sh.x, p[1] - sh.y, z - sh.z);
    const segs = [];
    const ring = (pts, z) => { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push(W(a, z), W(b, z)); } };
    if (Array.isArray(item.outer3) && item.outer3.length) {
      for (let i = 0; i < item.outer3.length; i++) { const a = item.outer3[i], b = item.outer3[(i + 1) % item.outer3.length]; segs.push(W(a, a[2] + 0.3), W(b, b[2] + 0.3)); }
    } else if (Array.isArray(item.outer) && item.outer.length >= 3) {
      const z1 = typeof item.z1 === 'number' ? item.z1 : item.z0;
      ring(item.outer, z1 + 0.2);
      if (z1 - item.z0 > 0.5) { ring(item.outer, item.z0); item.outer.forEach((p) => segs.push(W(p, item.z0), W(p, z1 + 0.2))); }
    }
    if (!segs.length) return;
    const g = new THREE.BufferGeometry().setFromPoints(segs);
    const m = new THREE.LineBasicMaterial({ color: 0xff8a00, depthTest: false, transparent: true });
    const lines = new THREE.LineSegments(g, m);
    lines.userData.ownMat = true; lines.renderOrder = 11; lines.raycast = () => {};
    selGroup.add(lines);
  }

  /* ---- light ------------------------------------------------------------------------------------------------------------ */
  function updateSun() {
    const st = State.raw(), now = Model.sunNow() || DEFAULT_SUN;
    const key = [now.azimuth, now.altitude, sceneRadius, st.shadows, aiReady].join('|');
    if (key === sunKeySeen) return;
    sunKeySeen = key;
    const R = sceneRadius, az = rad(now.azimuth), alt = rad(clamp(now.altitude, 3, 90));
    const dir = new THREE.Vector3(...planToWorld(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)));
    const target = worldVec(0, 0, R * 0.3);
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(dir, R * 2.5);
    sun.castShadow = !!st.shadows && !aiReady;
    const c = sun.shadow.camera, ext = Math.max(R * 1.6, 300);
    c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = R * 0.3; c.far = R * 6 + ext;
    c.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    needsRender = true;
  }

  function refreshColors() {
    scene.background = aiReady ? new THREE.Color('#eef0f3') : cssColor('--scene-sky');
    gridUniforms.uMinor.value.copy(cssColor('--scene-grid-minor'));
    gridUniforms.uMajor.value.copy(cssColor('--scene-grid-major'));
    themeSeen = themeEpoch;
    needsRender = true;
  }

  /* ---- per-frame sync ----------------------------------------------------------------------------------------------------- */
  function sync() {
    if (themeSeen !== themeEpoch) refreshColors();
    let changed = false;
    if (modelVersionSeen !== Model.version() || viewVersionSeen !== State.version()) {
      const first = modelVersionSeen !== Model.version();
      modelVersionSeen = Model.version(); viewVersionSeen = State.version();
      const gk = geometryKey();
      if (gk !== geomKey) {
        geomKey = gk; rebuildModel(); paint(); changed = true;
        if (syncSite()) changed = true;
        if (first && Model.doc()) setView(preset || 'axon', false);
        else if (first) { tween = null; }
      } else if (paintKeyNow() !== paintKey) { paint(); changed = true; }
      if (syncSite()) changed = true;
      updateSun();
    }
    if (changed) needsRender = true;
  }

  /* ---- cameras ---------------------------------------------------------------------------------------------------------- */
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function switchCamera(type) {
    if (type === camType) return;
    const target = controls.target;
    const offset = cam.position.clone().sub(target);
    const dist = offset.length();
    if (type === 'ortho') {
      ortho.zoom = (2 * ORTHO_HALF) / (2 * dist * tanHalfFov);
      ortho.position.copy(cam.position); ortho.quaternion.copy(cam.quaternion);
      cam = ortho;
    } else {
      const visible = (2 * ORTHO_HALF) / ortho.zoom;
      const d = visible / (2 * tanHalfFov);
      persp.position.copy(target).addScaledVector(offset.normalize(), d);
      persp.quaternion.copy(cam.quaternion);
      cam = persp;
    }
    camType = type;
    cam.updateProjectionMatrix();
    controls.object = cam;
  }
  function setCamAspect(a) {
    persp.aspect = a; persp.updateProjectionMatrix();
    ortho.left = -ORTHO_HALF * a; ortho.right = ORTHO_HALF * a; ortho.top = ORTHO_HALF; ortho.bottom = -ORTHO_HALF;
    ortho.updateProjectionMatrix();
  }
  const hostAspect = () => Math.max(0.2, host.clientWidth) / Math.max(1, host.clientHeight);

  /* ---- framing. Boxes are in scene coordinates (project frame minus the shift). ----------------------------------------------- */
  const toScene = (b) => {
    const sh = Model.shift() || ZERO();
    return { minX: b.minX - sh.x, maxX: b.maxX - sh.x, minY: b.minY - sh.y, maxY: b.maxY - sh.y, height: Math.max(0, (Number.isFinite(b.zMax) ? b.zMax : sh.z) - sh.z), minZ: 0 };
  };
  const EMPTY_BOX = { minX: -100, maxX: 100, minY: -100, maxY: 100, height: 40, minZ: 0 };
  /** The building (what stands on the ground), or the site when the project draws no building. */
  function buildingBox() {
    const b = Model.buildingBounds();
    return b ? toScene(b) : { ...EMPTY_BOX };
  }
  /** The whole site square with the building (a building that sticks out stays in), or the building box without a site. */
  function siteBox() {
    const b = buildingBox(), sb = Model.siteBounds();
    if (!sb) return b;
    const s = toScene({ ...sb, zMax: Model.shift().z });
    return { minX: Math.min(b.minX, s.minX), maxX: Math.max(b.maxX, s.maxX), minY: Math.min(b.minY, s.minY), maxY: Math.max(b.maxY, s.maxY), height: b.height, minZ: 0 };
  }
  /** The Axon box: the building with a margin of max(150 ft, 0.6 x its larger plan span), clamped to the site square. */
  function axonBox() {
    const b = buildingBox(), sb = Model.siteBounds();
    if (!sb) return b;
    const s = toScene({ ...sb, zMax: Model.shift().z });
    return Object.assign({ ...b }, SiteLayer3D.frameAround(b, s));
  }

  function fitPersp(box, dir, aspect, H) {
    const corners = [];
    for (const x of [box.minX, box.maxX]) for (const y of [box.minY, box.maxY]) for (const z of [0, H]) corners.push(worldVec(x, y, z));
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const fit = 1 - 2 * FIT_MARGIN;
    const tY = tanHalfFov, tX = tanHalfFov * aspect;
    const target = worldVec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, H / 2);
    const solve = () => {
      let dist = 1;
      for (const p of corners) {
        const v = p.clone().sub(target), dd = v.dot(dir);
        dist = Math.max(dist, dd + Math.abs(v.dot(right)) / (tX * fit), dd + Math.abs(v.dot(up)) / (tY * fit));
      }
      return dist;
    };
    let dist = solve();
    for (let i = 0; i < 6; i++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of corners) {
        const v = p.clone().sub(target), z = dist - v.dot(dir);
        const nx = v.dot(right) / (z * tX), ny = v.dot(up) / (z * tY);
        x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
      }
      target.addScaledVector(right, ((x0 + x1) / 2) * tX * dist).addScaledVector(up, ((y0 + y1) / 2) * tY * dist);
      dist = solve();
    }
    return { dist, target };
  }

  function viewTarget(id, box, aspect) {
    const H = Math.max(box.height, 20);
    const ex = box.maxX - box.minX, ey = box.maxY - box.minY;
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
    const fit = 1 - 2 * FIT_MARGIN;
    if (id === 'axon') {
      const az = rad(135), el = rad(28);
      const dirPlan = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
      const dir = new THREE.Vector3(...planToWorld(...dirPlan)).normalize();
      const f = fitPersp(box, dir, aspect, H);
      return { type: 'persp', dist: f.dist, target: f.target, dir };
    }
    const reach = 0.55 * Math.sqrt(ex * ex + ey * ey + H * H);
    if (id === 'plan') {
      const vis = Math.max(ey / fit, ex / (aspect * fit), 30);
      const e = 0.0008;
      return { type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: reach, target: worldVec(cx, cy, 0), dir: new THREE.Vector3(...planToWorld(0, -Math.sin(e), Math.cos(e))).normalize() };
    }
    const d = { n: [0, 1], e: [1, 0], s: [0, -1], w: [-1, 0] }[id];
    const along = (id === 'n' || id === 's') ? ex : ey;
    const vis = Math.max(H / fit, along / (aspect * fit), 40);
    return { type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: reach, target: worldVec(cx, cy, H / 2), dir: new THREE.Vector3(...planToWorld(d[0], d[1], 0)).normalize() };
  }

  function setView(id, animate = true) {
    if (!renderer) return;
    const custom = !!id && typeof id === 'object';
    const goal = custom ? id : viewTarget(id, id === 'axon' ? axonBox() : buildingBox(), hostAspect());
    preset = custom ? null : id;
    tween = null;
    if (goal.type !== camType) switchCamera(goal.type);
    const curTarget = controls.target.clone();
    const curOffset = cam.position.clone().sub(curTarget);
    const curDist = Math.max(1, curOffset.length());
    const fromDir = curOffset.clone().normalize();
    const toDist = goal.type === 'persp' ? goal.dist : Math.max(curDist, goal.minDist || 0);
    const apply = (target, dir, dist, zoom) => {
      controls.target.copy(target);
      cam.position.copy(target).addScaledVector(dir, dist);
      if (camType === 'ortho') cam.zoom = zoom;
      cam.updateProjectionMatrix();
      controls.update();
    };
    if (!animate || reduceMotion) apply(goal.target, goal.dir, toDist, goal.zoom);
    else {
      tween = {
        t0: performance.now(), dur: 400, fromTarget: curTarget, toTarget: goal.target, fromDir, toDir: goal.dir, fromDist: curDist, toDist,
        fromZoom: cam.zoom, toZoom: goal.zoom || cam.zoom, q: new THREE.Quaternion().setFromUnitVectors(fromDir, goal.dir), apply,
      };
    }
    needsRender = true;
    viewListeners.forEach((fn) => fn(preset));
  }

  /** Fits `box` in the current camera direction. Returns the goal it flew to. */
  function fitBox(box, animate = true) {
    if (!renderer || !cam || !controls || !box) return null;
    const dir = cam.position.clone().sub(controls.target).normalize();
    const aspect = hostAspect();
    const z0 = box.minZ || 0, H = Math.max(box.height || 0, z0 + 20);
    let goal;
    if (camType === 'persp') {
      const f = fitPersp(box, dir, aspect, H);
      goal = { type: 'persp', dist: f.dist, target: f.target, dir };
    } else {
      const fwd = dir.clone().negate();
      const cr = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const right = cr.length() < 1e-6 ? new THREE.Vector3(1, 0, 0) : cr.normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
      for (const x of [box.minX, box.maxX]) for (const y of [box.minY, box.maxY]) for (const z of [z0, H]) {
        const p = worldVec(x, y, z), r = p.dot(right), u = p.dot(up);
        r0 = Math.min(r0, r); r1 = Math.max(r1, r); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      }
      const c = worldVec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (z0 + H) / 2);
      const target = c.clone().addScaledVector(right, (r0 + r1) / 2 - c.dot(right)).addScaledVector(up, (u0 + u1) / 2 - c.dot(up));
      const fit = 1 - 2 * FIT_MARGIN;
      const vis = Math.max((u1 - u0) / fit, (r1 - r0) / (aspect * fit), 30);
      const ex = box.maxX - box.minX, ey = box.maxY - box.minY;
      goal = { type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: 0.55 * Math.sqrt(ex * ex + ey * ey + (H - z0) * (H - z0)), target, dir };
    }
    setView(goal, animate);
    return goal;
  }
  const frameSite = (animate = true) => fitBox(siteBox(), animate);
  const frameBuilding = (animate = true) => fitBox(buildingBox(), animate);

  function stepTween(now) {
    const k = tween;
    const p = clamp((now - k.t0) / k.dur, 0, 1), e = easeInOut(p);
    const target = k.fromTarget.clone().lerp(k.toTarget, e);
    const dir = k.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(k.q, e)).normalize();
    const dist = k.fromDist + (k.toDist - k.fromDist) * e;
    const zoom = k.fromZoom * Math.pow(k.toZoom / k.fromZoom, e);
    k.apply(target, dir, dist, zoom);
    needsRender = true;
    if (p >= 1) tween = null;
  }
  function updateClip() {
    const dist = cam.position.distanceTo(controls.target);
    if (camType === 'persp') { cam.near = Math.max(0.5, dist * 0.01); cam.far = dist * 20 + sceneRadius * 4 + 2000; }
    else { cam.near = 0.1; cam.far = dist + 60000; }
    cam.updateProjectionMatrix();
  }
  function resize() {
    if (!renderer) return;
    const w = Math.max(1, host.clientWidth), hh = Math.max(1, host.clientHeight);
    renderer.setSize(w, hh, false);
    setCamAspect(w / hh);
    if (preset) setView(preset, false);
    needsRender = true;
    renderer.render(scene, cam);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (capturing) return;
    if (tween) stepTween(now);
    const moved = controls.update();
    sync();
    if (moved || needsRender) { updateClip(); renderer.render(scene, cam); needsRender = false; }
  }

  /* ---- picking ----------------------------------------------------------------------------------------------------------------- */
  const ray = new THREE.Raycaster();
  function itemAt(rs, vertex) {
    let lo = 0, hi = rs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, r = rs[mid];
      if (vertex < r.start) hi = mid - 1; else if (vertex >= r.start + r.count) lo = mid + 1; else return r.item;
    }
    return null;
  }
  /** The item under a client point, or null. */
  function pickAt(clientX, clientY) {
    if (!renderer) return null;
    cam.updateMatrixWorld();
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    ray.setFromCamera(ndc, cam);
    const targets = [parts.main, parts.neighbors].filter(Boolean);
    const hits = ray.intersectObjects(targets, false);
    for (const hit of hits) {
      if (hit.faceIndex == null) continue;
      const v = hit.faceIndex * 3;
      const item = hit.object === parts.main ? itemAt(ranges.main, v) : itemAt(ranges.neighbors, v);
      if (item) return item;
    }
    return null;
  }
  function screenOf(x, y, z) {       // project-frame point -> client px
    cam.updateMatrixWorld();
    const sh = Model.shift() || ZERO();
    const v = worldVec(x - sh.x, y - sh.y, z - sh.z).project(cam);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, depth: v.z };
  }
  function centerOf(item) {
    const pts = item.outer || item.outer3 || [];
    if (!pts.length) return null;
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    const z = typeof item.z1 === 'number' ? item.z1 : (item.outer3 ? item.outer3[0][2] : item.z0);
    return { x: cx, y: cy, z };
  }

  let down = null;
  function bindPointer(el) {
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      down = null;
      if (moved > 6 || dt > 500) return;
      click(e.clientX, e.clientY);
    });
  }
  function click(x, y) {
    const item = pickAt(x, y);
    pickListeners.forEach((fn) => fn(item));
    return item;
  }

  /* ---- pictures ------------------------------------------------------------------------------------------------------------------ */
  async function capture(overlay, scale = 2) {
    if (!renderer) throw new Error('The 3D view is not available.');
    capturing = true;
    const selWas = selGroup.visible;
    selGroup.visible = false;
    try { return await ShotMod.captureView({ renderer, scene, camera: cam, scale, overlay }); }
    finally { capturing = false; selGroup.visible = selWas; needsRender = true; }
  }
  /** AI-ready picture: plain light sky, no grid, no site marks, no selection. The project building is amber, everything else is white. */
  let lastCapture = null;
  async function captureClean(scale = 2) {
    if (!renderer) throw new Error('The 3D view is not available.');
    capturing = true;
    const was = { aiReady, grid: gridMesh.visible, sel: selGroup.visible, bg: scene.background };
    const hid = [];
    for (const o of siteGroup.children) { const k = o.userData && o.userData.kind; if ((k === 'site-boundary' || k === 'site-arrow') && o.visible) { o.visible = false; hid.push(o); } }
    try {
      aiReady = true; gridMesh.visible = false; selGroup.visible = false;
      refreshColors(); paint(); sunKeySeen = ''; updateSun();
      lastCapture = { grid: gridMesh.visible, marks: hid.length > 0 ? false : true, selection: selGroup.visible, aiReady, edges: !!parts.mainEdges };
      return await ShotMod.captureView({ renderer, scene, camera: cam, scale });
    } finally {
      aiReady = was.aiReady; gridMesh.visible = was.grid; selGroup.visible = was.sel; hid.forEach((o) => { o.visible = true; });
      refreshColors(); paint(); sunKeySeen = ''; updateSun();
      capturing = false; needsRender = true;
    }
  }

  function init(hostEl) {
    host = hostEl;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      host.innerHTML = '<div class="gl-fail">WebGL is not available in this browser, so the 3D view cannot start. The numbers still work.</div>';
      renderer = null;
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    buildScene();
    persp = new THREE.PerspectiveCamera(FOV, 1, 1, 100000);
    ortho = new THREE.OrthographicCamera(-ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 100000);
    cam = persp;
    persp.position.set(300, 250, 300);
    controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2;
    controls.minDistance = 8; controls.maxDistance = 60000;
    controls.minZoom = 0.01; controls.maxZoom = 80;
    controls.screenSpacePanning = true;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener('start', () => { tween = null; if (preset) { preset = null; viewListeners.forEach((fn) => fn(null)); } });
    controls.addEventListener('change', () => { needsRender = true; });
    bindPointer(renderer.domElement);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => { themeEpoch++; };
    if (mq.addEventListener) mq.addEventListener('change', onTheme); else if (mq.addListener) mq.addListener(onTheme);
    renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    refreshColors();
    resize();
    requestAnimationFrame(frame);
    return true;
  }

  return {
    init, setView, fitBox, frameSite, frameBuilding, capture, captureClean, pickAt, click, screenOf, centerOf,
    select: (item) => drawSelection(item),
    selectedId: () => selectedId,
    onViewChange: (fn) => viewListeners.push(fn),
    onPick: (fn) => pickListeners.push(fn),
    ready: () => !!renderer,
    requestRender: () => { needsRender = true; },
    canvas: () => (renderer ? renderer.domElement : null),
    camera: () => cam,
    syncNow: () => { sync(); },
    captureFlags: () => (lastCapture ? { ...lastCapture } : null),
    framedBox: (id) => (id === 'site' ? siteBox() : id === 'building' ? buildingBox() : axonBox()),
    info: () => ({ camera: camType, preset, tweening: !!tween, distance: cam ? cam.position.distanceTo(controls.target) : 0, items: drawn.items, drawn: { ...drawn, byLayer: { ...drawn.byLayer } }, site: siteDrawn.info ? { ...siteDrawn.info } : null, grid: gridMesh ? gridMesh.visible : false, shadows: sun ? sun.castShadow : false, sun: sun ? { x: sun.position.x, y: sun.position.y, z: sun.position.z } : null }),
    /** For tests: the colors drawn for each item id (hex), read back from the vertex color attribute. */
    colorOfItem: (id) => {
      for (const [mesh, rs] of [[parts.main, ranges.main], [parts.neighbors, ranges.neighbors]]) {
        if (!mesh) continue;
        const r = rs.find((q) => q.item.id === id);
        if (!r) continue;
        const col = mesh.geometry.attributes.color;
        return `#${new THREE.Color(col.getX(r.start), col.getY(r.start), col.getZ(r.start)).getHexString()}`;
      }
      return null;
    },
    itemsDrawn: () => [...ranges.main, ...ranges.neighbors].map((r) => r.item.id),
    sceneObjects: () => { const out = []; scene.traverse((o) => out.push(o)); return out; },
    themeChanged: () => { themeEpoch++; needsRender = true; },
  };
})();
