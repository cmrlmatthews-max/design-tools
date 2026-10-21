/* ==========================================================================
   RENDER
   Scene, cameras, meshes, visual styles, performance rules, compare viewports.
   Plan coordinates are (x east, y north) in feet; elevation is up.
   Three.js is Y-up, so plan y maps to -z. planToWorld() is the ONLY place
   that mapping is written; geometry uses PLAN_MATRIX built from it.
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

/** Cells for the compare grid, in pixels, y from the top. `resv` reserves bars at the top and bottom. */
function compareRects(n, W, H, resv = {}, gap = 2) {
  const top = resv.top || 0, bottom = resv.bottom || 0;
  const hh = Math.max(40, H - top - bottom);
  const landscape = W >= hh;
  let cols, rows;
  if (n <= 1) { cols = 1; rows = 1; }
  else if (n === 2) { cols = landscape ? 2 : 1; rows = landscape ? 1 : 2; }
  else if (n === 3) { cols = landscape ? 3 : 1; rows = landscape ? 1 : 3; }
  else { cols = 2; rows = 2; }
  const cw = W / cols, ch = hh / rows, out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push({ x: c * cw + gap / 2, y: top + r * ch + gap / 2, w: Math.max(1, cw - gap), h: Math.max(1, ch - gap) });
  }
  return out;
}

const Render = (() => {
  const FOV = 30;
  const ORTHO_HALF = 100;               // ortho frustum half-height; zoom does the rest
  const GROUND_SIZE = 30000;
  const rad = THREE.MathUtils.degToRad;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let host, renderer, scene, persp, ortho, cam, camType = 'persp', controls;
  let ground, shadowPlane, gridMesh, figure, sun, hemi;
  let layers = null;                    // { model, context, envelope } each { group, key }
  let derived = null;
  let needsRender = true, tween = null, preset = null, refitPending = false, capturing = false, envSeen = null;
  let viewVersion = -1, sunKey = '', styleApplied = null, themeEpoch = 0, themeApplied = -1, geomIdSeen = -1;
  let sceneRadius = 200, rebuildNotified = null;
  let insetProvider = () => ({ right: 0 });
  let cmp = null;                       // compare state: { entries:[{name,state,d,group,uid}], key, reserve(), groups }
  const rebuildListeners = [], viewListeners = [], resizeListeners = [];
  const materials = new Map();
  const _v2 = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
  const gridUniforms = {
    uMinor: { value: new THREE.Color() }, uMajor: { value: new THREE.Color() },
    uMinorA: { value: 0.42 }, uMajorA: { value: 0.8 }, uFade: { value: new THREE.Vector2(450, 1100) },
  };

  /* ---- colors from CSS tokens --------------------------------------------- */
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const cssColor = (name, fallback = '#888') => new THREE.Color(css(name) || fallback);

  function resetLayers() {
    if (layers) for (const l of Object.values(layers)) l.key = null;
    if (cmp) cmp.key = null;
  }
  function refreshColors() {
    const diagram = Store.raw().view.style === 'diagram';
    scene.background = cssColor(diagram ? '--scene-sky-diagram' : '--scene-sky');
    ground.material.color.copy(cssColor(diagram ? '--scene-ground-diagram' : '--scene-ground'));
    gridUniforms.uMinor.value.copy(cssColor('--scene-grid-minor'));
    gridUniforms.uMajor.value.copy(cssColor('--scene-grid-major'));
    figure.traverse((o) => { if (o.isMesh) o.material.color.copy(cssColor('--scene-figure')); });
    materials.forEach((m) => m.dispose());
    materials.clear();                       // colors are re-read lazily
    resetLayers();                           // force mesh rebuild with new materials
    styleApplied = Store.raw().view.style; themeApplied = themeEpoch;
    needsRender = true;
  }

  function materialFor(key) {
    let m = materials.get(key);
    if (m) return m;
    const ds = key.endsWith('|ds');
    const k = ds ? key.slice(0, -3) : key;
    const side = ds ? THREE.DoubleSide : THREE.FrontSide;
    const diagram = styleApplied === 'diagram';
    const flat = (color) => new THREE.MeshBasicMaterial({ color, side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    if (k === 'model') {
      m = new THREE.MeshStandardMaterial({ color: cssColor('--scene-model'), roughness: 0.94, metalness: 0, side });
    } else if (k === 'outside') {
      m = diagram ? flat(new THREE.Color(CONFIG.outsideColor)) : new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.outsideColor), roughness: 0.85, metalness: 0, side });
    } else if (k === 'context') {
      m = new THREE.MeshStandardMaterial({ color: cssColor('--scene-context'), roughness: 0.95, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
    } else if (k.startsWith('prog:')) {
      m = flat(new THREE.Color(k.split(':')[2] || '#999'));
    } else {
      m = flat(new THREE.Color(CONFIG.zoneColors[k.slice(5)] || '#999'));
    }
    materials.set(key, m);
    return m;
  }
  function lineMaterial(id) {
    let m = materials.get(id);
    if (m) return m;
    if (id === 'edge') m = new THREE.LineBasicMaterial({ color: cssColor('--scene-edge') });
    else if (id === 'site') m = new THREE.LineBasicMaterial({ color: cssColor('--scene-site') });
    else if (id === 'ctxline') m = new THREE.LineBasicMaterial({ color: cssColor('--scene-grid-major') });
    else m = new THREE.LineBasicMaterial({ color: cssColor('--scene-env'), transparent: true, opacity: 0.75, depthWrite: false });   // envelope
    materials.set(id, m);
    return m;
  }

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

    // Ground: a deep slab so elevations show a ground band; top face at elevation 0.
    const slab = new THREE.BoxGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SIZE);   // plan x, y, elevation
    slab.translate(0, 0, -GROUND_SIZE / 2);
    slab.applyMatrix4(planMatrix(0));
    ground = new THREE.Mesh(slab, new THREE.MeshBasicMaterial({ color: 0xdddddd, side: THREE.DoubleSide }));
    ground.renderOrder = -2;
    scene.add(ground);

    // Shadow catcher on the ground.
    const sp = new THREE.PlaneGeometry(8000, 8000);
    sp.applyMatrix4(planMatrix(0));
    shadowPlane = new THREE.Mesh(sp, new THREE.ShadowMaterial({ opacity: 0.24, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    shadowPlane.receiveShadow = true;
    shadowPlane.renderOrder = 1;
    scene.add(shadowPlane);

    // Grid: 10 ft minor, 50 ft major, drawn in a shader so it stays crisp at any zoom.
    const gp = new THREE.PlaneGeometry(8000, 8000);
    gp.applyMatrix4(planMatrix(0));
    gridMesh = new THREE.Mesh(gp, new THREE.ShaderMaterial({
      uniforms: gridUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
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

    // Scale figure, 6 ft tall.
    const fm = new THREE.MeshStandardMaterial({ color: 0x69727c, roughness: 0.9 });
    figure = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.62, 4.7, 16), fm);
    body.position.y = 2.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0x69727c, roughness: 0.9 }));
    head.position.y = 5.45;
    figure.add(body, head);
    figure.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(figure);

    layers = {};
    for (const id of ['model', 'context', 'envelope']) {
      const group = new THREE.Group();
      scene.add(group);
      layers[id] = { group, key: null };
    }
  }

  /* ---- model objects (shared by the main view and the compare view) ----------- */
  function extrudePolys(polygons, z, depth) {
    const shapes = polygons.map((poly) => {
      const shape = new THREE.Shape(poly.outer.map((q) => new THREE.Vector2(q[0], q[1])));
      for (const h of poly.holes || []) shape.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], q[1]))));
      return shape;
    });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
    geo.deleteAttribute('uv');
    geo.applyMatrix4(planMatrix(z));
    return geo;
  }
  function meshSolidGeometry(s) {
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(s.positions, 3));
    geo.setIndex(s.indices);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();                  // flat normals
    geo.applyMatrix4(planMatrix(0));
    return geo;
  }

  function plateMaterialKey(plate, view, programs) {
    if (plate.outsideEnvelopeArea > 1) return 'outside';
    if (view.style !== 'diagram') return 'model';
    if (view.colorBy === 'program') return `prog:${plate.program}:${((programs[plate.program] || CONFIG.programs[plate.program] || {}).color) || '#999'}`;
    return `zone:${plate.zone}`;
  }

  /** Floors, crown, site outline. `disp` = { plates, solids, solidsOutside }. */
  function buildFloorObjects(state, disp) {
    const out = [];
    const view = state.view, diagram = view.style === 'diagram';
    const gap = view.floorLines ? CONFIG.floorGap : 0;
    const groups = new Map();
    const push = (key, geo) => {
      if (!geo.getAttribute('position') || geo.getAttribute('position').count === 0) { geo.dispose(); return; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(geo);
    };
    for (const plate of disp.plates) {
      if (plate.void || !plate.polygons.length) continue;
      push(plateMaterialKey(plate, view, state.programs), extrudePolys(plate.polygons, plate.z, Math.max(0.1, plate.ftf - gap)));
    }
    disp.solids.forEach((s, i) => {
      const isMesh = s.kind === 'mesh';
      let geo;
      try { geo = isMesh ? meshSolidGeometry(s) : extrudePolys(s.polygons, s.z0, Math.max(0.05, s.z1 - s.z0)); } catch (e) { console.error(e); return; }
      const outside = disp.solidsOutside[i];
      const base = outside ? 'outside' : (diagram ? 'zone:crown' : 'model');
      push(isMesh ? `${base}|ds` : base, geo);
    });
    for (const [key, geos] of groups) {
      const merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, materialFor(key));
      mesh.userData.model = true;
      out.push(mesh);
      if (diagram) out.push(new THREE.LineSegments(new THREE.EdgesGeometry(merged, 20), lineMaterial('edge')));
    }
    // Site boundary outline (rectangle or polygon), just above the ground.
    const ring = sitePolygon(state);
    const siteGeo = new THREE.BufferGeometry().setFromPoints(ring.map((q) => worldVec(q[0], q[1], 0.1)));
    out.push(new THREE.LineLoop(siteGeo, lineMaterial('site')));
    return out;
  }

  /** Context blocks: light gray 60% boxes (model) or outlines only (diagram). */
  function buildContextObjects(state) {
    const out = [];
    if (!state.context || !state.context.show) return out;
    const diagram = state.view.style === 'diagram';
    for (const b of state.context.blocks || []) {
      const w = num(b.w, 0), d = num(b.d, 0), hgt = num(b.h, 0);
      if (!(w > 0 && d > 0 && hgt > 0)) continue;
      const geo = new THREE.BoxGeometry(w, d, hgt);          // plan x, y, elevation
      geo.translate(num(b.x, 0), num(b.y, 0), hgt / 2);
      geo.applyMatrix4(planMatrix(0));
      if (diagram) {
        out.push(new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMaterial('ctxline')));
        geo.dispose();
      } else {
        const mesh = new THREE.Mesh(geo, materialFor('context'));
        mesh.userData.model = true;
        out.push(mesh);
      }
    }
    return out;
  }

  /** Transparent wireframe of the allowed envelope (setbacks, stepback, height limit). */
  function buildEnvelopeObjects(state, wire) {
    if (!state.view.envelope || !wire || !wire.length) return [];
    const pos = [];
    const seg = (a, b) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); };
    for (const prism of wire) {
      for (const poly of prism.polygons) {
        for (const ring of [poly.outer, ...(poly.holes || [])]) {
          const n = ring.length;
          for (let i = 0; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            seg(planToWorld(a[0], a[1], prism.z0), planToWorld(b[0], b[1], prism.z0));
            seg(planToWorld(a[0], a[1], prism.z1), planToWorld(b[0], b[1], prism.z1));
            seg(planToWorld(a[0], a[1], prism.z0), planToWorld(a[0], a[1], prism.z1));
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(geo, lineMaterial('envelope'));
    lines.renderOrder = 3;
    return [lines];
  }

  function clearGroup(g) {
    for (const o of [...g.children]) { g.remove(o); if (o.geometry) o.geometry.dispose(); }
  }
  function syncLayer(layer, key, build) {
    if (layer.key === key) return false;
    clearGroup(layer.group);
    layer.key = key;
    for (const o of build()) layer.group.add(o);
    return true;
  }
  const colorsKey = (state) => (state.view.style === 'diagram' && state.view.colorBy === 'program'
    ? Object.values(state.programs).map((p) => p.color).join(',') : '');

  function syncMain(d, disp, state) {
    const v = state.view;
    let changed = false;
    changed = syncLayer(layers.model, [disp.key, v.floorLines, v.style, v.colorBy, colorsKey(state)].join('|'), () => buildFloorObjects(state, disp)) || changed;
    changed = syncLayer(layers.context, [v.style, JSON.stringify(state.context)].join('|'), () => buildContextObjects(state)) || changed;
    changed = syncLayer(layers.envelope, [d.geomId, v.envelope].join('|'), () => buildEnvelopeObjects(state, d.wire)) || changed;
    if (changed) { viewVersion = -1; needsRender = true; }
  }

  /** All model meshes in whatever is on screen (main layers or compare groups). */
  function eachModelMesh(fn) {
    const walk = (g) => g.children.forEach((o) => { if (o.userData.model) fn(o); });
    if (cmp) cmp.entries.forEach((e) => walk(e.group)); else { walk(layers.model.group); walk(layers.context.group); }
  }

  /* ---- per-frame view state (cheap) ------------------------------------------------ */
  function currentBounds() {
    if (cmp) return cmp.bounds;
    return Derived.get().bounds;
  }
  function updateSun(view) {
    const bb = currentBounds();
    if (!bb) return;
    const b = bb.all;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, h = b.height;
    const ex = b.maxX - b.minX, ey = b.maxY - b.minY;
    const R = Math.max(60, 0.5 * Math.sqrt(ex * ex + ey * ey + h * h));
    const az = rad(num(view.sun.azimuth, 135)), alt = rad(clamp(num(view.sun.altitude, 40), 3, 90));
    const key = [cx, cy, h, R, az, alt].join('|');
    if (key === sunKey) return;
    sunKey = key;
    sceneRadius = R;
    // Azimuth is a compass bearing: 0 = north (plan +y), clockwise. Altitude is above the horizon.
    const dir = new THREE.Vector3(...planToWorld(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)));
    const target = worldVec(cx, cy, h / 2);
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(dir, R * 2.5);
    const c = sun.shadow.camera;
    c.left = -R * 1.1; c.right = R * 1.1; c.top = R * 1.1; c.bottom = -R * 1.1;
    c.near = R * 1.2; c.far = R * 3.8;
    c.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    needsRender = true;
  }

  function applyView() {
    const s = Store.raw(), v = s.view;
    if (styleApplied !== v.style || themeApplied !== themeEpoch) refreshColors();
    const diagram = v.style === 'diagram';
    gridMesh.visible = !!v.grid;
    figure.visible = !!v.figure && !cmp;
    const shadowsOn = !diagram && !!v.shadows;
    // While a slider moves: casters off (no shadow pass work). Sun drags keep shadows so you can see them move.
    const dragging = Store.gestureActive() && !Store.gesturePath().startsWith('view.sun');
    const cast = shadowsOn && !dragging;
    shadowPlane.visible = shadowsOn;
    eachModelMesh((m) => { m.castShadow = cast; m.receiveShadow = shadowsOn; });
    figure.traverse((o) => { if (o.isMesh) o.castShadow = cast; });
    // The figure stands near the front-left corner of the site (front = south, plan -y).
    if (derived) figure.position.copy(worldVec(derived.bounds.site.minX + 14, derived.bounds.site.minY + 14, 0));
    updateSun(v);
    needsRender = true;
  }

  /* ---- cameras & views ------------------------------------------------------------- */
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const tanHalfFov = Math.tan(rad(FOV) / 2);

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
  const hostAspect = () => Math.max(0.1, host.clientWidth) / Math.max(1, host.clientHeight);

  /** Space covered by floating panels; views are framed in the remaining area. */
  function applyViewOffset() {
    const w = host.clientWidth, hgt = host.clientHeight;
    const off = cmp ? 0 : clamp(insetProvider().right || 0, 0, w * 0.6) / 2;
    for (const c of [persp, ortho]) {
      if (off > 0) c.setViewOffset(w, hgt, off, 0, w, hgt); else c.clearViewOffset();
    }
    return off * 2;
  }

  /* ---- framing: every preset view fits the whole of what is on screen ---------------------- */
  const FIT_MARGIN = 0.05;      // empty fraction of the visible area on each side

  /** Plan extent + height of everything a view must show: plates, crown solids, the envelope wireframe (when shown), the site. */
  function boxOf(d, showEnv) {
    const u = d.bounds.union;
    const b = { minX: u.minX, maxX: u.maxX, minY: u.minY, maxY: u.maxY, height: u.height || 0 };
    const add = (x, y, z) => {
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      if (z > b.height) b.height = z;
    };
    for (const s of d.solids || []) {
      if (s.kind === 'mesh') { const p = s.positions; for (let i = 0; i + 2 < p.length; i += 3) add(p[i], p[i + 1], p[i + 2]); }
      else for (const poly of s.polygons) for (const q of poly.outer) add(q[0], q[1], s.z1);
    }
    if (showEnv) for (const prism of d.wire || []) for (const poly of prism.polygons) for (const q of poly.outer) add(q[0], q[1], prism.z1);
    return b;
  }
  function framingBox() {
    const showEnv = !!Store.raw().view.envelope;
    if (cmp) {
      const bs = cmp.entries.map((e) => boxOf(e.d, showEnv));
      return {
        minX: Math.min(...bs.map((x) => x.minX)), maxX: Math.max(...bs.map((x) => x.maxX)),
        minY: Math.min(...bs.map((x) => x.minY)), maxY: Math.max(...bs.map((x) => x.maxY)),
        height: Math.max(...bs.map((x) => x.height)),
      };
    }
    return boxOf(Derived.get(), showEnv);
  }

  /** Perspective: the nearest distance (and the look-at point) that puts all box corners inside the visible area. */
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
    for (let i = 0; i < 6; i++) {            // centre the projected box in the visible area, then re-solve the distance
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

  /** Where each preset puts the camera. Every view frames the whole box (see boxOf) with a small margin. */
  function viewTarget(id, box, aspect) {
    const H = Math.max(box.height, 20);
    const ex = box.maxX - box.minX, ey = box.maxY - box.minY;
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
    const fit = 1 - 2 * FIT_MARGIN;
    if (id === 'axon') {
      const az = rad(135), el = rad(28);      // camera sits south-east, looking north-west
      const dirPlan = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
      const dir = new THREE.Vector3(...planToWorld(...dirPlan)).normalize();
      const f = fitPersp(box, dir, aspect, H);
      return { type: 'persp', dist: f.dist, target: f.target, dir };
    }
    const reach = 0.55 * Math.sqrt(ex * ex + ey * ey + H * H);     // keeps the whole box in front of an orthographic camera
    if (id === 'plan') {
      const vis = Math.max(ey / fit, ex / (aspect * fit), 30);
      const e = 0.0008;     // tiny tilt toward the south keeps "north up" without a degenerate up-vector
      return {
        type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: reach,
        target: worldVec(cx, cy, 0),
        dir: new THREE.Vector3(...planToWorld(0, -Math.sin(e), Math.cos(e))).normalize(),
      };
    }
    // Elevations: N = looking at the north face from the north, etc.
    const dirs = { n: [0, 1], e: [1, 0], s: [0, -1], w: [-1, 0] };
    const d = dirs[id];
    const along = (id === 'n' || id === 's') ? ex : ey;
    const vis = Math.max(H / fit, along / (aspect * fit), 40);
    return {
      type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: reach,
      target: worldVec(cx, cy, H / 2),
      dir: new THREE.Vector3(...planToWorld(d[0], d[1], 0)).normalize(),
    };
  }

  function framingAspect() {
    if (cmp) {
      const r = cmpRects();
      return r.length ? r[0].w / r[0].h : hostAspect();
    }
    return Math.max(0.2, (host.clientWidth - clamp(insetProvider().right || 0, 0, host.clientWidth * 0.6)) / Math.max(1, host.clientHeight));
  }

  function setView(id, animate = true) {
    if (!renderer) return;
    const goal = viewTarget(id, framingBox(), framingAspect());
    preset = id;
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
    if (!animate || reduceMotion) {
      apply(goal.target, goal.dir, toDist, goal.zoom);
    } else {
      tween = {
        t0: performance.now(), dur: 400,
        fromTarget: curTarget, toTarget: goal.target,
        fromDir, toDir: goal.dir, fromDist: curDist, toDist,
        fromZoom: cam.zoom, toZoom: goal.zoom || cam.zoom,
        q: new THREE.Quaternion().setFromUnitVectors(fromDir, goal.dir),
        apply,
      };
    }
    needsRender = true;
    viewListeners.forEach((fn) => fn(preset));
  }

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
    if (camType === 'persp') {
      cam.near = Math.max(0.5, dist * 0.01);
      cam.far = dist * 20 + sceneRadius * 4 + 2000;
    } else {
      cam.near = 0.1;
      cam.far = dist + 60000;
    }
    cam.updateProjectionMatrix();
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    setCamAspect(w / h);
    applyViewOffset();
    if (preset) setView(preset, false);
    needsRender = true;
    if (cmp) renderCompare(renderer, scene, cam, false); else renderer.render(scene, cam);
    resizeListeners.forEach((fn) => fn());
  }

  /* ---- compare: one renderer, one camera, one viewport per option -------------------------- */
  const cmpReserve = () => (cmp && cmp.reserve ? cmp.reserve() : { top: 0, bottom: 0 });
  function cmpRects(W = host.clientWidth, H = host.clientHeight, reserve = cmpReserve(), gap = 2) {
    return compareRects(cmp ? cmp.entries.length : 0, W, H, reserve, gap);
  }
  /** Draws every option into its own cell. Also used by screenshots (reserve = none, scaled size). */
  function renderCompare(r, s, c, forCapture) {
    if (!cmp || !cmp.entries.length) { r.render(s, c); return; }
    const size = r.getSize(_v2);
    const W = size.x, H = size.y;
    const k = W / Math.max(1, host.clientWidth);
    const reserve = forCapture ? { top: 0, bottom: 0 } : cmpReserve();
    const rects = compareRects(cmp.entries.length, W, H, reserve, 2 * k);
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.setClearColor(cssColor('--line'), 1);
    r.clear();
    r.setScissorTest(true);
    rects.forEach((rc, i) => {
      cmp.entries.forEach((e, j) => { e.group.visible = (i === j); });
      const x = Math.round(rc.x), y = Math.round(H - rc.y - rc.h), w = Math.round(rc.w), h = Math.round(rc.h);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      setCamAspect(rc.w / rc.h);
      r.render(s, c);
    });
    cmp.entries.forEach((e) => { e.group.visible = true; });
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    setCamAspect(hostAspect());
  }
  function combineBounds(list) {
    const ranges = (k) => list.map((d) => d.bounds[k]);
    const merge = (k) => {
      const rs = ranges(k);
      return {
        minX: Math.min(...rs.map((r) => r.minX)), maxX: Math.max(...rs.map((r) => r.maxX)),
        minY: Math.min(...rs.map((r) => r.minY)), maxY: Math.max(...rs.map((r) => r.maxY)),
        height: Math.max(...rs.map((r) => r.height || 0)),
      };
    };
    return { model: merge('model'), site: merge('site'), union: merge('union'), all: merge('all') };
  }
  function syncCompare() {
    const s = Store.raw(), v = s.view;
    const key = [v.style, v.colorBy, v.floorLines, v.envelope, s.context.show, colorsKey(s), cmp.entries.map((e) => e.uid).join(',')].join('|');
    if (key === cmp.key) return;
    cmp.key = key;
    for (const e of cmp.entries) {
      if (e.group) { clearGroup(e.group); scene.remove(e.group); }
      const st = { ...e.state, view: v, context: { ...e.state.context, show: s.context.show }, programs: e.state.programs };
      const group = new THREE.Group();
      const disp = { plates: e.d.plates, solids: e.d.solids, solidsOutside: e.d.solidsOutside };
      for (const o of [...buildFloorObjects(st, disp), ...buildContextObjects(st), ...buildEnvelopeObjects(st, e.d.wire)]) group.add(o);
      e.group = group;
      scene.add(group);
    }
    viewVersion = -1; needsRender = true;
  }
  function enterCompare(entries, reserve, { keepView = false } = {}) {
    const wasComparing = !!cmp;
    exitCompare(true);
    const list = entries.map((e, i) => ({ ...e, uid: `${i}:${e.uid || e.name}`, group: null }));
    cmp = { entries: list, key: null, reserve, bounds: combineBounds(list.map((e) => e.d)) };
    layers.model.group.visible = layers.context.group.visible = layers.envelope.group.visible = false;
    figure.visible = false;
    applyViewOffset();
    syncCompare();
    viewVersion = -1;
    if (!(keepView && wasComparing)) setView('axon', false);
    needsRender = true;
  }
  function exitCompare(quiet) {
    if (!cmp) return;
    for (const e of cmp.entries) if (e.group) { clearGroup(e.group); scene.remove(e.group); }
    cmp = null;
    layers.model.group.visible = layers.context.group.visible = layers.envelope.group.visible = true;
    resetLayers();
    viewVersion = -1;
    if (!quiet) { applyViewOffset(); setCamAspect(hostAspect()); if (preset) setView(preset, false); needsRender = true; }
  }

  /* ---- loop ------------------------------------------------------------------------ */
  function frame(now) {
    requestAnimationFrame(frame);
    if (capturing) return;
    if (tween) stepTween(now);
    const moved = controls.update();
    if (cmp) {
      syncCompare();
      if (viewVersion !== Store.version()) { viewVersion = Store.version(); applyView(); }
      if (moved || needsRender) { updateClip(); renderCompare(renderer, scene, cam, false); needsRender = false; }
      return;
    }
    const d = Derived.get();
    const state = Store.raw();
    // Draft quality only while a geometry slider drags (never for view settings such as the sun).
    const draft = Store.gestureActive() && !Store.gesturePath().startsWith('view');
    const disp = Derived.display(draft);
    const first = derived === null;
    if (d.geomId !== geomIdSeen) {
      if (!first) refitPending = true;                        // geometry changed: re-frame once the edit settles
      geomIdSeen = d.geomId;
    }
    derived = d;
    const envOn = !!state.view.envelope;
    if (envSeen !== null && envOn !== envSeen) refitPending = true;     // the envelope is part of the framed box
    envSeen = envOn;
    syncMain(d, disp, state);
    if (first && !preset) setView('axon', false);
    if (rebuildNotified !== d) { rebuildNotified = d; rebuildListeners.forEach((fn) => fn(d)); }
    if (refitPending && !Store.gestureActive()) { refitPending = false; if (preset) setView(preset, true); }
    if (viewVersion !== Store.version()) { viewVersion = Store.version(); applyView(); }
    if (moved || needsRender) { updateClip(); renderer.render(scene, cam); needsRender = false; }
  }

  /** Screenshot of what is on screen (main or compare). The HUD inset is removed so the model is centred. */
  async function capture(overlay, scale = 2) {
    if (!renderer) throw new Error('The 3D view is not available.');
    capturing = true;
    try {
      for (const c of [persp, ortho]) c.clearViewOffset();
      return await ShotMod.captureView({
        renderer, scene, camera: cam, scale, overlay,
        render: cmp ? (r, s, c) => renderCompare(r, s, c, true) : undefined,
      });
    } finally {
      capturing = false;
      applyViewOffset();
      needsRender = true;
    }
  }

  function init(hostEl) {
    host = hostEl;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      host.innerHTML = '<div class="gl-fail">WebGL is not available in this browser, so the 3D view cannot start.</div>';
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
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2;      // never below ground; exactly horizontal is allowed (elevations)
    controls.minDistance = 8;
    controls.maxDistance = 60000;
    controls.minZoom = 0.01; controls.maxZoom = 80;
    controls.screenSpacePanning = true;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.addEventListener('start', () => {
      tween = null;
      if (preset) { preset = null; viewListeners.forEach((fn) => fn(null)); }
    });
    controls.addEventListener('change', () => { needsRender = true; });

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => { themeEpoch++; viewVersion = -1; };
    if (mq.addEventListener) mq.addEventListener('change', onTheme); else if (mq.addListener) mq.addListener(onTheme);

    renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    refreshColors();
    resize();
    requestAnimationFrame(frame);
    return true;
  }

  return {
    init, setView, capture, enterCompare, exitCompare,
    setInsetProvider: (fn) => { insetProvider = fn; },
    refreshInsets: (animate = true) => { if (!renderer) return; applyViewOffset(); if (preset) setView(preset, animate); else needsRender = true; },
    relayout: () => { needsRender = true; resizeListeners.forEach((fn) => fn()); },
    cells: () => (cmp ? cmpRects() : []),
    requestRender: () => { needsRender = true; },
    onRebuild: (fn) => rebuildListeners.push(fn),
    onViewChange: (fn) => viewListeners.push(fn),
    onResize: (fn) => resizeListeners.push(fn),
    info: () => ({ camera: camType, preset, meshes: layers ? layers.model.group.children.length : 0, tweening: !!tween, distance: cam ? cam.position.distanceTo(controls.target) : 0, zoom: cam ? cam.zoom : 0, compare: !!cmp, drawQuality: derived ? Derived.display(Store.gestureActive() && !Store.gesturePath().startsWith('view')).quality : null }),
    ready: () => !!renderer,
    comparing: () => !!cmp,
  };
})();
