/* ==========================================================================
   RENDER
   Scene, cameras, visual styles, performance rules, compare viewports. The plates, units, corridors and blocks come from Plate3D (05c),
   authored in the plate frame (the massing local frame), so the model and overlay layers need no extra matrix.
   The plan view (orthographic top) is the default. Plan coordinates are (x east, y north) in feet; elevation is up.
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
  const GRID_MINOR_A = 0.42, GRID_MAJOR_A = 0.8, GRID_SITE_FADE = 0.4;     // grid line strength; the grid fades to 40% over a site ground
  const ORTHO_HALF = 100;               // ortho frustum half-height; zoom does the rest
  const LABEL_PX = 1.8;                 // unit labels show when the plan is drawn at this many pixels per foot or more
  const rad = THREE.MathUtils.degToRad;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let host, renderer, scene, persp, ortho, cam, camType = 'persp', controls;
  let gridMesh, figure, sun, hemi;
  let selOverlay = null;                   // v1.1: selection outline, carve outlines and snap guides (Select draws into it; never captured or saved)
  const frameListeners = [];            // v1.1: called once per drawn frame, just before the render (handles follow the camera)
  let layers = null;                    // { site, model, context, overlay } each { group, key }
  let derived = null;
  let needsRender = true, tween = null, preset = null, refitPending = false, capturing = false;
  let siteFrameSeen = null;
  let viewVersion = -1, sunKey = '', styleApplied = null, themeEpoch = 0, themeApplied = -1, geomIdSeen = -1, frameKey = '';
  let sceneRadius = 200, rebuildNotified = null;
  let insetProvider = () => ({ right: 0 });
  let cmp = null;                       // compare state: { entries:[{name,state,d,group,uid}], key, reserve(), groups }
  const rebuildListeners = [], viewListeners = [], resizeListeners = [];
  const materials = new Map();
  const _v2 = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
  const gridUniforms = {
    uMinor: { value: new THREE.Color() }, uMajor: { value: new THREE.Color() },
    uMinorA: { value: GRID_MINOR_A }, uMajorA: { value: GRID_MAJOR_A }, uFade: { value: new THREE.Vector2(450, 1100) },
  };

  /* ---- colors from CSS tokens --------------------------------------------- */
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const cssColor = (name, fallback = '#888') => new THREE.Color(css(name) || fallback);

  function resetLayers() {
    if (layers) for (const l of Object.values(layers)) l.key = null;
    if (cmp) cmp.key = null;
  }
  function refreshColors() {
    scene.background = cssColor('--scene-sky');
    gridUniforms.uMinor.value.copy(cssColor('--scene-grid-minor'));
    gridUniforms.uMajor.value.copy(cssColor('--scene-grid-major'));
    figure.traverse((o) => { if (o.isMesh) o.material.color.copy(cssColor('--scene-figure')); });
    resetLayers();                           // force mesh rebuild with new colors
    styleApplied = Store.raw().view.style; themeApplied = themeEpoch;
    needsRender = true;
  }

  /* ---- scene ---------------------------------------------------------------- */
  function buildScene() {
    scene = new THREE.Scene();

    hemi = new THREE.HemisphereLight(0xffffff, 0xb4bac2, 2.4);
    scene.add(hemi);

    sun = new THREE.DirectionalLight(0xffffff, 1.5);     // fixed, from the south-east above; the plate planner draws no shadows
    sun.castShadow = false;
    scene.add(sun, sun.target);

    // Grid: 10 ft minor, 50 ft major, drawn in a shader so it stays crisp at any zoom.
    const gp = new THREE.PlaneGeometry(8000, 8000);
    gp.applyMatrix4(planMatrix(-0.05));
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
    scene.add(figure);

    selOverlay = new THREE.Group();
    selOverlay.renderOrder = 10;
    scene.add(selOverlay);

    layers = {};
    for (const id of ['site', 'model', 'context', 'overlay']) {     // site: SiteLayer (06c_site.js)
      const group = new THREE.Group();
      scene.add(group);
      layers[id] = { group, key: null };
    }
  }

  /* ---- model objects (shared by the main view and the compare view) ----------- */
  function clearGroup(g) {
    for (const o of [...g.children]) {
      g.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.userData.ownMat && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    }
  }
  function syncLayer(layer, key, build) {
    if (layer.key === key) return false;
    clearGroup(layer.group);
    layer.key = key;
    for (const o of build()) layer.group.add(o);
    return true;
  }

  function syncMain(d, disp, state) {
    const v = state.view;
    let changed = false;
    const mk = [disp.key, v.style, v.labels, v.walls, v.bays, v.levels3d].join('|');
    if (layers.model.key !== mk) {
      const built = Plate3D.build(d, state, disp);
      clearGroup(layers.model.group); clearGroup(layers.overlay.group);
      layers.model.key = mk; layers.overlay.key = mk;
      for (const o of built.model) layers.model.group.add(o);
      for (const o of built.overlay) layers.overlay.group.add(o);
      overlayVis = null; changed = true;
    }
    changed = SiteLayer.update(layers.site, state, d, { syncLayer, clearGroup, cssColor, themeEpoch: () => themeEpoch }) || changed;     // the project site (06c_site.js)
    // the ghost of the site neighbors would double the solid ones of the site layer, so it draws only without them (the outlines of other level groups stay)
    const solidNeighbors = SiteLayer.info().buildings > 0;
    changed = syncLayer(layers.context, [v.context, disp.key, ProjectUI.dataKey(), state.source, solidNeighbors].join('|'), () => {
      const list = Plate3D.contextObjects(d, state);
      if (!solidNeighbors) return list;
      return list.filter((o) => {
        if (!o.userData.context) return true;
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
        return false;
      });
    }) || changed;
    if (changed) { viewVersion = -1; needsRender = true; }
  }
  /** The unit labels show when the plan is drawn large enough to read them, and never while a handle or a slider moves. */
  let overlayVis = null;
  function pxPerFt() {
    if (!renderer) return 0;
    const hgt = Math.max(1, host.clientHeight);
    if (camType === 'ortho') return hgt / ((2 * ORTHO_HALF) / cam.zoom);
    const dist = cam.position.distanceTo(controls.target);
    return hgt / (2 * dist * tanHalfFov);
  }
  function syncOverlayVisibility(dragging) {
    const on = !dragging && (camType === 'ortho' || pxPerFt() >= LABEL_PX * 1.4) && pxPerFt() >= LABEL_PX;
    const key = `${on}|${dragging}|${!!cmp}`;
    if (key === overlayVis) return;
    overlayVis = key;
    layers.overlay.group.visible = !cmp;
    layers.overlay.group.children.forEach((o) => { o.visible = !o.userData.plan || on; });
    needsRender = true;
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
  function updateSun() {
    const bb = currentBounds();
    if (!bb) return;
    const b = bb.union;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, h = b.height;
    const ex = b.maxX - b.minX, ey = b.maxY - b.minY;
    const R = Math.max(60, 0.5 * Math.sqrt(ex * ex + ey * ey + h * h));
    const key = [cx, cy, h, R].join('|');
    if (key === sunKey) return;
    sunKey = key;
    sceneRadius = R;
    const dir = new THREE.Vector3(...planToWorld(0.45, -0.55, 0.7)).normalize();
    const target = worldVec(cx, cy, h / 2);
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(dir, R * 2.5);
    sun.target.updateMatrixWorld();
    needsRender = true;
  }

  function applyView() {
    const s = Store.raw(), v = s.view;
    if (themeApplied !== themeEpoch) refreshColors();
    gridMesh.visible = !!v.grid;
    figure.visible = !!v.figure && !cmp;
    // With a site ground on screen the grid fades to 40 percent.
    const siteGround = !cmp && SiteLayer.info().ground;
    gridUniforms.uMinorA.value = GRID_MINOR_A * (siteGround ? GRID_SITE_FADE : 1);
    gridUniforms.uMajorA.value = GRID_MAJOR_A * (siteGround ? GRID_SITE_FADE : 1);
    // The figure stands near the front-left corner of the plate (front = south, plan -y), on the site ground when there is one.
    if (derived && derived.ok) {
      const u = derived.bounds.model;
      figure.position.set(...planToWorld(u.minX + 14, u.minY - 14, (siteGround && SiteLayer.groundZ(u.minX + 14, u.minY - 14)) || 0));
      figure.scale.setScalar(1);
    }
    updateSun();
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

  /** Plan extent + height of everything a view must show: plates, crown solids, the context. */
  function boxOf(d) {
    const u = d.bounds.union;
    const b = { minX: u.minX, maxX: u.maxX, minY: u.minY, maxY: u.maxY, height: u.height || 0 };
    const add = (x, y, z) => {
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      if (z > b.height) b.height = z;
    };
    return b;
  }
  function framingBox(withSite = false) {
    if (cmp) {
      const bs = cmp.entries.map((e) => boxOf(e.d));
      return {
        minX: Math.min(...bs.map((x) => x.minX)), maxX: Math.max(...bs.map((x) => x.maxX)),
        minY: Math.min(...bs.map((x) => x.minY)), maxY: Math.max(...bs.map((x) => x.maxY)),
        height: Math.max(...bs.map((x) => x.height)),
      };
    }
    const b = boxOf(Derived.get());
    const sb = withSite ? SiteLayer.frameBox(Store.raw()) : null;       // Axon fits the whole site; the elevations and the plan keep the plate
    if (sb) { b.minX = Math.min(b.minX, sb.minX); b.maxX = Math.max(b.maxX, sb.maxX); b.minY = Math.min(b.minY, sb.minY); b.maxY = Math.max(b.maxY, sb.maxY); }
    return b;
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
  function viewTarget(id, box, aspect, rot = 0) {
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
    // Elevations look at a sector of the PROJECT frame. The scene is in the massing frame, so the viewing direction turns back by the placement rotation.
    const pd = { n: [0, 1], e: [1, 0], s: [0, -1], w: [-1, 0] }[id];
    const rr = rad(rot), cr = Math.cos(rr), sr = Math.sin(rr);
    const d = [pd[0] * cr + pd[1] * sr, -pd[0] * sr + pd[1] * cr];
    const turned = Math.abs(Math.sin(rr * 2)) > 1e-6;
    const along = turned ? Math.hypot(ex, ey) : ((id === 'n' || id === 's') ? ex : ey);
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
    const goal = viewTarget(id, framingBox(id === 'axon'), framingAspect(), cmp ? 0 : num(Derived.get().rotation, 0));
    preset = id;
    overlayVis = null;
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
    const key = [v.style, v.labels, v.walls, v.levels3d, cmp.entries.map((e) => e.uid).join(',')].join('|');
    if (key === cmp.key) return;
    cmp.key = key;
    for (const e of cmp.entries) {
      if (e.group) { clearGroup(e.group); scene.remove(e.group); }
      const st = { ...e.state, view: { ...v } };
      const group = new THREE.Group();
      const built = Plate3D.build(e.d, st, { quality: 'full', key: 'cmp' });
      for (const o of built.model) group.add(o);
      for (const o of built.overlay) { if (!o.userData.flags) group.add(o); }
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
    layers.model.group.visible = layers.context.group.visible = layers.overlay.group.visible = false;
    layers.site.group.visible = false;
    selOverlay.visible = false;
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
    layers.model.group.visible = layers.context.group.visible = layers.overlay.group.visible = true;
    layers.site.group.visible = true;
    selOverlay.visible = true;
    overlayVis = null;
    resetLayers();
    viewVersion = -1;
    if (!quiet) { applyViewOffset(); setCamAspect(hostAspect()); if (preset) setView(preset, false); needsRender = true; }
  }

  /* ---- loop ------------------------------------------------------------------------ */
  /** Line materials (fat lines) need the size of the view to draw a width in pixels. */
  function syncLineResolution() {
    const w = host.clientWidth, h = host.clientHeight;
    scene.traverse((o) => { if (o.material && o.material.isLineMaterial) o.material.resolution.set(w, h); });
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (capturing) return;
    if (tween) stepTween(now);
    const moved = controls.update();
    if (cmp) {
      syncCompare();
      if (viewVersion !== Store.version()) { viewVersion = Store.version(); applyView(); }
      if (moved || needsRender) { updateClip(); syncLineResolution(); renderCompare(renderer, scene, cam, false); needsRender = false; }
      return;
    }
    const d = Derived.get();
    const state = Store.raw();
    const disp = Derived.display();
    const first = derived === null;
    if (d.geomId !== geomIdSeen) {
      // Geometry changed: re-frame once the edit settles, but only when the framed area moved (a handle drag keeps the camera).
      const u = d.bounds.union, fk = [u.minX, u.maxX, u.minY, u.maxY].map((v) => Math.round(v / 40)).join(',');
      if (!first && fk !== frameKey) refitPending = true;
      frameKey = fk;
      geomIdSeen = d.geomId;
    }
    derived = d;
    const sfk = SiteLayer.frameKey(Store.raw());
    if (siteFrameSeen !== null && sfk !== siteFrameSeen) refitPending = true;     // the site layer switched on or off: it is part of the framed box
    siteFrameSeen = sfk;
    syncMain(d, disp, state);
    syncOverlayVisibility(disp.quality === 'draft');
    if (first && !preset) setView('plan', false);
    if (rebuildNotified !== d) { rebuildNotified = d; rebuildListeners.forEach((fn) => fn(d)); }
    if (refitPending && !Store.gestureActive()) { refitPending = false; if (preset) setView(preset, true); }
    if (viewVersion !== Store.version()) { viewVersion = Store.version(); applyView(); }
    if (moved || needsRender) {
      for (const fn of frameListeners) { try { fn(); } catch (e) { console.error(e); } }
      updateClip(); syncLineResolution(); renderer.render(scene, cam); needsRender = false;
    }
  }

  /** Screenshot of what is on screen (main or compare). The HUD inset is removed so the model is centred. */
  async function capture(overlay, scale = 2) {
    if (!renderer) throw new Error('The 3D view is not available.');
    capturing = true;
    const overlayWas = selOverlay.visible;
    selOverlay.visible = false;
    try {
      for (const c of [persp, ortho]) c.clearViewOffset();
      syncLineResolution();
      return await ShotMod.captureView({
        renderer, scene, camera: cam, scale, overlay,
        render: cmp ? (r, s, c) => renderCompare(r, s, c, true) : undefined,
      });
    } finally {
      capturing = false;
      selOverlay.visible = overlayWas && !cmp;
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
      if (preset) { preset = null; overlayVis = null; viewListeners.forEach((fn) => fn(null)); }
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
    init, setView, capture, enterCompare, exitCompare, pxPerFt,
    sceneFlags: () => ({ site: layers.site.group.visible, gridA: gridUniforms.uMajorA.value, grid: gridMesh.visible, figure: figure.visible, model: layers.model.group.visible, context: layers.context.group.visible, overlay: layers.overlay.group.visible, children: scene.children.length }),
    setInsetProvider: (fn) => { insetProvider = fn; },
    refreshInsets: (animate = true) => { if (!renderer) return; applyViewOffset(); if (preset) setView(preset, animate); else needsRender = true; },
    relayout: () => { needsRender = true; resizeListeners.forEach((fn) => fn()); },
    cells: () => (cmp ? cmpRects() : []),
    requestRender: () => { needsRender = true; },
    onRebuild: (fn) => rebuildListeners.push(fn),
    onViewChange: (fn) => viewListeners.push(fn),
    onResize: (fn) => resizeListeners.push(fn),
    overlayInfo: () => { const kids = layers.overlay.group.children; return { total: kids.length, plan: kids.filter((o) => o.userData.plan).length, planVisible: kids.some((o) => o.userData.plan && o.visible), labels: kids.filter((o) => o.userData.label).map((o) => o.userData.label) }; },
    /** Sizes of the drawn layers (tests): meshes by role, lines, labels. */
    layerInfo: () => {
      const role = (o) => (o.userData.units ? 'units' : o.userData.plate ? 'plate' : o.userData.corridor ? 'corridor' : o.userData.blocks ? 'blocks' : o.userData.context ? 'context' : 'other');
      const kind = (o) => (o.userData.labelId ? 'label' : o.userData.flags ? 'flags' : o.isLineSegments2 ? 'line' : 'other');
      const cnt = (g, f) => g.children.reduce((a, o) => { const k = f(o); a[k] = (a[k] || 0) + 1; return a; }, {});
      return { overlay: cnt(layers.overlay.group, kind), model: cnt(layers.model.group, role) };
    },
    info: () => ({ camera: camType, preset, meshes: layers ? layers.model.group.children.length : 0, tweening: !!tween, distance: cam ? cam.position.distanceTo(controls.target) : 0, zoom: cam ? cam.zoom : 0, compare: !!cmp, drawQuality: derived ? Derived.display().quality : null }),
    ready: () => !!renderer,
    comparing: () => !!cmp,
    // v1.1 hooks for direct editing (Select): the camera, the orbit controls, the overlay group and a per-frame callback
    overlayGroup: () => selOverlay,
    onFrame: (fn) => frameListeners.push(fn),
    camera: () => cam,
    cameraType: () => camType,
    canvas: () => (renderer ? renderer.domElement : null),
    themeChanged: () => { themeEpoch++; viewVersion = -1; needsRender = true; },        // tests: what a light/dark switch does
    sceneObjects: () => { const out = []; scene.traverse((o) => out.push(o)); return out; },        // tests
    contextMeshes: () => layers.context.group.children.filter((o) => o.isMesh).length,       // tests: the ghost of the site neighbors
    setOrbitEnabled: (on) => { if (controls) { controls.enabled = !!on; if (!on) tween = null; } },
    orbitEnabled: () => !!controls && controls.enabled,
  };
})();
