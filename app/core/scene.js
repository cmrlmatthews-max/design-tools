/* ==========================================================================
   CORE: scene (app/CONTRACT.md section 5)
   One renderer, two cameras (perspective and orthographic), OrbitControls, lights, the sun, the ground slab, the
   shadow catcher, the grid, the scale figure, preset views and a render-on-demand loop for the whole page.
   Ported from build/tower/06_render.js and build/viewer/04_render.js.

   Coordinates: the scene is the shifted project frame (core/frame.js). Plan (x east, y north, z up) maps to
   Three world [x, z, -y]. Boxes given to setFraming() and fitBox() are THREE.Box3 in world coordinates, or plan
   objects { minX, maxX, minY, maxY, minZ|zMin, maxZ|zMax|height } in the SCENE plan frame (already shifted).

   Ground convention: a visible object under layerRoot with userData.kind === 'site-ground' (the site layer's
   ground mesh) or userData.isGround === true counts as a drawn ground. While one shows, the flat slab drops 4 ft
   under the lowest ground point, the grid fades to 40 percent, the shadow catcher hides (shadows fall on the ground
   mesh) and the scale figure stands on that ground.

   Insets: setInsets({ right, bottom }) says how many CSS px of the view the right panel column and the bottom sheet
   cover. Views are framed in the area that is left (camera view offset), as in the Tower's setInsetProvider.

   No WebGL: createScene still returns the full API (scene graph, cameras, math) with renderer = null, shows a short
   message in the host and never throws. opts.renderer (tests only) injects a stand-in renderer.
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { planToWorld, worldVec, planMatrix } from './frame.js';

const HAS_WIN = typeof window !== 'undefined';
const FOV = 30;
const ORTHO_HALF = 100;                  // ortho frustum half-height; zoom does the rest
const GROUND_SIZE = 30000;
const FIT_MARGIN = 0.05;                 // empty fraction of the visible area on each side
const SHADOW_MAP = 2048;
const SHADOW_OPACITY = 0.55;
const LIGHT = { sun: 1.7, hemi: 2.3 };
const DEFAULT_SUN = { az: 150, alt: 42 };
const AI_SKY = '#f3f5f7', AI_GROUND = '#e4e7ea';
const EMPTY_BOX = { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: 0, maxZ: 40 };
const VIEW_IDS = ['axon', 'n', 'e', 's', 'w', 'plan'];
const rad = THREE.MathUtils.degToRad;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mq = (q) => { try { return HAS_WIN && typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false; } catch (e) { return false; } };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* Dark fallbacks, used when a token is missing from app/shell.css. */
const FALLBACK = {
  '--scene-sky': '#14181c', '--scene-ground': '#1d2227',
  '--scene-sky-diagram': '#101316', '--scene-ground-diagram': '#181c20',
  '--scene-grid-minor': '#3b424a', '--scene-grid-major': '#5a636d', '--scene-figure': '#aab2bb',
};

/** A CSS token on :root as a THREE.Color, or the fallback. Never throws. */
export function css(name, fallback) {
  let v = '';
  try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { v = ''; }
  const fb = fallback || FALLBACK[name] || '#888888';
  const c = new THREE.Color(fb);
  if (v) { try { c.setStyle(v); } catch (e) { c.set(fb); } }
  return c;
}

/** A box (THREE.Box3 in world coordinates, or a scene plan object) as { minX, maxX, minY, maxY, minZ, maxZ }, or null. */
function planBox(b) {
  if (!b || typeof b !== 'object') return null;
  let o;
  if (b.isBox3) {
    if (b.isEmpty()) return null;
    o = { minX: b.min.x, maxX: b.max.x, minY: -b.max.z, maxY: -b.min.z, minZ: b.min.y, maxZ: b.max.y };
  } else {
    const minZ = fin(b.minZ) ? b.minZ : fin(b.zMin) ? b.zMin : 0;
    const maxZ = fin(b.maxZ) ? b.maxZ : fin(b.zMax) ? b.zMax : fin(b.height) ? b.height : minZ;
    o = { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, minZ, maxZ };
  }
  if (![o.minX, o.maxX, o.minY, o.maxY, o.minZ, o.maxZ].every(fin)) return null;
  if (o.maxX < o.minX || o.maxY < o.minY) return null;
  if (o.maxZ < o.minZ) o.maxZ = o.minZ;
  return o;
}
const unionBox = (a, b) => (!a ? b : !b ? a : {
  minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY),
  minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ),
});
/** The building with a margin of max(150 ft, 0.6 x its larger plan span), clamped to the site square (06x_sitelayer.js frameAround). */
function frameAround(b, sb) {
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const m = Math.max(150, 0.6 * span);
  return {
    ...b,
    minX: Math.min(b.minX, Math.max(b.minX - m, sb.minX)), maxX: Math.max(b.maxX, Math.min(b.maxX + m, sb.maxX)),
    minY: Math.min(b.minY, Math.max(b.minY - m, sb.minY)), maxY: Math.max(b.maxY, Math.min(b.maxY + m, sb.maxY)),
  };
}

const GRID_VERT = 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const GRID_FRAG = `
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
  }`;

export function createScene(hostEl, { bus, renderer: injected } = {}) {
  const host = hostEl || null;
  const emit = (evt, payload) => { try { if (bus) bus.emit(evt, payload); } catch (e) { /* the bus logs */ } };
  const reduceMotion = mq('(prefers-reduced-motion: reduce)');
  const tanHalfFov = Math.tan(rad(FOV) / 2);

  /* ---- renderer (fails soft) ---- */
  let renderer = null;
  if (injected) renderer = injected;
  else {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      renderer = null;
      if (host) {
        try {
          const msg = document.createElement('div');
          msg.className = 'gl-fail';
          msg.setAttribute('role', 'alert');
          msg.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:var(--ink-2,#a5adb7);font-size:14px;line-height:1.5';
          msg.textContent = 'WebGL is not available in this browser, so the 3D view cannot start. The panels and numbers still work.';
          host.appendChild(msg);
        } catch (err) { /* no DOM */ }
      }
    }
  }
  if (renderer) {
    try {
      renderer.setPixelRatio(Math.min((HAS_WIN && window.devicePixelRatio) || 1, 2));
      if (renderer.shadowMap) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
      if (host && renderer.domElement && !renderer.domElement.parentNode) host.appendChild(renderer.domElement);
      if (renderer.domElement && renderer.domElement.style) { renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none'; }
    } catch (e) { console.error(e); }
  }

  /* ---- the scene graph ---- */
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb4bac2, LIGHT.hemi);
  const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  scene.add(hemi, sun, sun.target);

  // Ground: a deep slab so elevations show a ground band; top face at scene elevation 0 (the lowest ground).
  const slabGeo = new THREE.BoxGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SIZE);   // plan x, y, elevation
  slabGeo.translate(0, 0, -GROUND_SIZE / 2);
  slabGeo.applyMatrix4(planMatrix(0));
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshBasicMaterial({ color: css('--scene-ground'), side: THREE.DoubleSide }));
  slab.renderOrder = -2;
  slab.userData.shell = 'slab';
  slab.raycast = () => {};

  const catcherGeo = new THREE.PlaneGeometry(8000, 8000);
  catcherGeo.applyMatrix4(planMatrix(0));
  const catcher = new THREE.Mesh(catcherGeo, new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  catcher.receiveShadow = true;
  catcher.renderOrder = 1;
  catcher.userData.shell = 'catcher';
  catcher.raycast = () => {};

  const gridUniforms = {
    uMinor: { value: new THREE.Color() }, uMajor: { value: new THREE.Color() },
    uMinorA: { value: 0.42 }, uMajorA: { value: 0.8 }, uFade: { value: new THREE.Vector2(450, 1100) },
  };
  const gridGeo = new THREE.PlaneGeometry(8000, 8000);
  gridGeo.applyMatrix4(planMatrix(0));
  const grid = new THREE.Mesh(gridGeo, new THREE.ShaderMaterial({
    uniforms: gridUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, vertexShader: GRID_VERT, fragmentShader: GRID_FRAG,
  }));
  grid.renderOrder = 2;
  grid.userData.shell = 'grid';
  grid.raycast = () => {};

  // Scale figure, 6 ft tall.
  const figMat = new THREE.MeshStandardMaterial({ color: css('--scene-figure'), roughness: 0.9 });
  const figure = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.62, 4.7, 16), figMat);
  body.position.y = 2.35;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), figMat);
  head.position.y = 5.45;
  figure.add(body, head);
  figure.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.raycast = () => {}; } });
  figure.userData.shell = 'figure';

  const layerRoot = new THREE.Group();
  layerRoot.name = 'layers';
  const overlayRoot = new THREE.Group();
  overlayRoot.name = 'overlay';
  overlayRoot.renderOrder = 10;
  scene.add(slab, catcher, grid, figure, layerRoot, overlayRoot);

  /* ---- cameras and controls ---- */
  const persp = new THREE.PerspectiveCamera(FOV, 1, 1, 100000);
  const ortho = new THREE.OrthographicCamera(-ORTHO_HALF, ORTHO_HALF, ORTHO_HALF, -ORTHO_HALF, 0.1, 100000);
  persp.position.set(300, 250, 300);
  let cam = persp, camType = 'persp';

  let controls = null;
  if (renderer && renderer.domElement) {
    try {
      controls = new OrbitControls(cam, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.maxPolarAngle = Math.PI / 2;     // never below ground; exactly horizontal is allowed (elevations)
      controls.minDistance = 8;
      controls.maxDistance = 60000;
      controls.minZoom = 0.01; controls.maxZoom = 80;
      controls.screenSpacePanning = true;
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    } catch (e) { console.error(e); controls = null; }
  }

  /* ---- state ---- */
  let style = 'model', shadowsOn = true, sunDir = { ...DEFAULT_SUN };
  let insets = { right: 0, bottom: 0, left: 0 };
  let framing = { site: () => null, building: () => null };
  let preset = null, planLock = false, tween = null;
  let needsRender = true, rafId = 0, capturing = false, sceneRadius = 200;
  let sunKey = '', autoKey = '', groundInfo = { on: false, minY: 0 };
  let lastCapture = null;
  const frameFns = new Set();
  const viewFns = new Set();

  /* ---- colors ---- */
  function refreshColors() {
    const diagram = style === 'diagram';
    scene.background = css(diagram ? '--scene-sky-diagram' : '--scene-sky', diagram ? FALLBACK['--scene-sky-diagram'] : FALLBACK['--scene-sky']);
    slab.material.color.copy(css(diagram ? '--scene-ground-diagram' : '--scene-ground'));
    gridUniforms.uMinor.value.copy(css('--scene-grid-minor'));
    gridUniforms.uMajor.value.copy(css('--scene-grid-major'));
    figMat.color.copy(css('--scene-figure'));
    requestRender();
  }

  /* ---- host size and insets ---- */
  const hostW = () => Math.max(1, (host && host.clientWidth) || 1);
  const hostH = () => Math.max(1, (host && host.clientHeight) || 1);
  function insetPx() {
    const w = hostW(), h = hostH();
    return { r: clamp(fin(insets.right) ? insets.right : 0, 0, w * 0.6), b: clamp(fin(insets.bottom) ? insets.bottom : 0, 0, h * 0.7), l: clamp(fin(insets.left) ? insets.left : 0, 0, w * 0.4) };
  }
  /** The part of the view the panels leave free: { aspect (whole view), fw, fh (free fractions) }. */
  function frameGeom() {
    const w = hostW(), h = hostH(), { r, b, l } = insetPx();
    return { aspect: Math.max(0.1, w / h), fw: Math.max(0.2, (w - r - l) / w), fh: Math.max(0.2, (h - b) / h) };
  }
  function applyViewOffset() {
    const w = hostW(), h = hostH(), { r, b, l } = insetPx();
    const ox = (r - l) / 2, oy = b / 2;
    for (const c of [persp, ortho]) {
      if (ox !== 0 || oy > 0) c.setViewOffset(w, h, ox, oy, w, h); else c.clearViewOffset();
    }
  }
  function setCamAspect(a) {
    persp.aspect = a; persp.updateProjectionMatrix();
    ortho.left = -ORTHO_HALF * a; ortho.right = ORTHO_HALF * a; ortho.top = ORTHO_HALF; ortho.bottom = -ORTHO_HALF;
    ortho.updateProjectionMatrix();
  }

  /* ---- framing boxes (scene plan frame) ---- */
  const call = (fn) => { try { return typeof fn === 'function' ? planBox(fn()) : null; } catch (e) { return null; } };
  function buildingBox() { return call(framing.building) || call(framing.site) || { ...EMPTY_BOX }; }
  function siteBox() {
    const s = call(framing.site), b = call(framing.building);
    if (!s) return b || { ...EMPTY_BOX };
    return unionBox(s, b);
  }
  function axonBox() {
    const b = call(framing.building), s = call(framing.site);
    if (!b) return s || { ...EMPTY_BOX };
    if (!s) return b;
    const out = frameAround(b, s);
    out.minZ = Math.min(b.minZ, s.minZ);
    return out;
  }

  /* ---- views ---- */
  function switchCamera(type) {
    if (type === camType) return;
    const target = controls ? controls.target : new THREE.Vector3();
    const offset = cam.position.clone().sub(target);
    const dist = Math.max(1, offset.length());
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
    if (controls) controls.object = cam;
  }

  /** Perspective: the nearest distance (and the look-at point) that puts all box corners inside the free area. tX, tY: tan of the free half-angles. */
  function fitPersp(box, dir, tX, tY) {
    const corners = [];
    const z1 = Math.max(box.maxZ, box.minZ + 20);
    for (const x of [box.minX, box.maxX]) for (const y of [box.minY, box.maxY]) for (const z of [box.minZ, z1]) corners.push(worldVec(x, y, z));
    const fwd = dir.clone().negate();
    let right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    right = right.length() < 1e-6 ? new THREE.Vector3(1, 0, 0) : right.normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const fit = 1 - 2 * FIT_MARGIN;
    const target = worldVec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + z1) / 2);
    const solve = () => {
      let dist = 1;
      for (const p of corners) {
        const v = p.clone().sub(target), dd = v.dot(dir);
        dist = Math.max(dist, dd + Math.abs(v.dot(right)) / (tX * fit), dd + Math.abs(v.dot(up)) / (tY * fit));
      }
      return dist;
    };
    let dist = solve();
    for (let i = 0; i < 6; i++) {            // centre the projected box in the free area, then re-solve the distance
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

  /** Where a preset puts the camera. Every view frames the whole box with a small margin, inside the free area. */
  function viewTarget(id, box) {
    const g = frameGeom();
    const z1 = Math.max(box.maxZ, box.minZ + 20), H = z1 - box.minZ;
    const ex = box.maxX - box.minX, ey = box.maxY - box.minY;
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
    const fit = 1 - 2 * FIT_MARGIN;
    if (id === 'axon') {
      const az = rad(135), el = rad(28);      // camera sits south-east, looking north-west
      const dir = new THREE.Vector3(...planToWorld(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el))).normalize();
      const f = fitPersp(box, dir, tanHalfFov * g.aspect * g.fw, tanHalfFov * g.fh);
      return { type: 'persp', dist: f.dist, target: f.target, dir };
    }
    const reach = 0.55 * Math.sqrt(ex * ex + ey * ey + H * H);     // keeps the whole box in front of an orthographic camera
    if (id === 'plan') {
      const vis = Math.max(ey / (g.fh * fit), ex / (g.aspect * g.fw * fit), 30);
      const e = 0.0008;     // tiny tilt toward the south keeps "north up" without a degenerate up-vector
      return { type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: reach, target: worldVec(cx, cy, box.minZ), dir: new THREE.Vector3(...planToWorld(0, -Math.sin(e), Math.cos(e))).normalize() };
    }
    const d = { n: [0, 1], e: [1, 0], s: [0, -1], w: [-1, 0] }[id];
    const along = (id === 'n' || id === 's') ? ex : ey;
    const vis = Math.max(H / (g.fh * fit), along / (g.aspect * g.fw * fit), 40);
    return { type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: reach, target: worldVec(cx, cy, box.minZ + H / 2), dir: new THREE.Vector3(...planToWorld(d[0], d[1], 0)).normalize() };
  }

  /* Plan view locks the orientation (Cade, October 25, 2026): no orbit; a left drag and one finger pan; the wheel and two
     fingers zoom. Any other view orbits again. The lock survives frameSite and frameBuilding. */
  function applyPlanLock() {
    if (!controls) return;
    controls.enableRotate = !planLock;
    controls.mouseButtons = planLock
      ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = planLock ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }

  const target0 = () => (controls ? controls.target : new THREE.Vector3());
  function goTo(goal, animate) {
    tween = null;
    if (goal.type !== camType) switchCamera(goal.type);
    const curTarget = target0().clone();
    const curOffset = cam.position.clone().sub(curTarget);
    const curDist = Math.max(1, curOffset.length());
    const fromDir = curOffset.clone().normalize();
    const toDist = goal.type === 'persp' ? goal.dist : Math.max(curDist, goal.minDist || 0);
    const apply = (target, dir, dist, zoom) => {
      target0().copy(target);
      cam.position.copy(target).addScaledVector(dir, dist);
      if (camType === 'ortho' && fin(zoom)) cam.zoom = zoom;
      cam.lookAt(target);
      cam.updateProjectionMatrix();
      if (controls) controls.update();
    };
    if (!animate || reduceMotion || !renderer) apply(goal.target, goal.dir, toDist, goal.zoom);
    else {
      tween = {
        t0: now(), dur: 400, fromTarget: curTarget, toTarget: goal.target, fromDir, fromDist: curDist, toDist,
        fromZoom: cam.zoom, toZoom: goal.zoom || cam.zoom, q: new THREE.Quaternion().setFromUnitVectors(fromDir, goal.dir), apply,
      };
    }
    requestRender();
  }
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function stepTween(t) {
    const k = tween;
    const p = clamp((t - k.t0) / k.dur, 0, 1), e = easeInOut(p);
    const target = k.fromTarget.clone().lerp(k.toTarget, e);
    const dir = k.fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(k.q, e)).normalize();
    const dist = k.fromDist + (k.toDist - k.fromDist) * e;
    const zoom = k.fromZoom * Math.pow(k.toZoom / k.fromZoom, e);
    k.apply(target, dir, dist, zoom);
    if (p >= 1) tween = null;
  }

  function setView(name, { animate = true } = {}) {
    const id = VIEW_IDS.includes(name) ? name : 'axon';
    planLock = id === 'plan';
    preset = id;
    applyPlanLock();
    goTo(viewTarget(id, id === 'axon' || id === 'plan' ? axonBox() : buildingBox()), animate);
    viewFns.forEach((fn) => { try { fn(preset); } catch (e) { console.error(e); } });
  }

  /** Fits a box in the current camera direction (the Site and Building zoom buttons). Returns the goal it flew to. */
  function fitBox(box3, { animate = true } = {}) {
    const box = planBox(box3);
    if (!box) return null;
    const g = frameGeom();
    const dir = cam.position.clone().sub(target0()).normalize();
    const z0 = box.minZ, z1 = Math.max(box.maxZ, z0 + 20);
    let goal;
    if (camType === 'persp') {
      const f = fitPersp(box, dir, tanHalfFov * g.aspect * g.fw, tanHalfFov * g.fh);
      goal = { type: 'persp', dist: f.dist, target: f.target, dir };
    } else {
      const fwd = dir.clone().negate();
      const cr = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const right = cr.length() < 1e-6 ? new THREE.Vector3(1, 0, 0) : cr.normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity;
      for (const x of [box.minX, box.maxX]) for (const y of [box.minY, box.maxY]) for (const z of [z0, z1]) {
        const p = worldVec(x, y, z), r = p.dot(right), u = p.dot(up);
        r0 = Math.min(r0, r); r1 = Math.max(r1, r); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      }
      const c = worldVec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (z0 + z1) / 2);
      const target = c.clone().addScaledVector(right, (r0 + r1) / 2 - c.dot(right)).addScaledVector(up, (u0 + u1) / 2 - c.dot(up));
      const fit = 1 - 2 * FIT_MARGIN;
      const vis = Math.max((u1 - u0) / (g.fh * fit), (r1 - r0) / (g.aspect * g.fw * fit), 30);
      const ex = box.maxX - box.minX, ey = box.maxY - box.minY;
      goal = { type: 'ortho', zoom: (2 * ORTHO_HALF) / vis, minDist: 0.55 * Math.sqrt(ex * ex + ey * ey + (z1 - z0) * (z1 - z0)), target, dir };
    }
    preset = planLock ? 'plan' : null;
    goTo(goal, animate);
    viewFns.forEach((fn) => { try { fn(preset); } catch (e) { console.error(e); } });
    return goal;
  }

  /* ---- sun, ground, figure: kept in step with the content before each render ---- */
  function updateSun(box) {
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2, h = Math.max(box.maxZ - box.minZ, 10);
    const ex = box.maxX - box.minX, ey = box.maxY - box.minY;
    const R = Math.max(60, 0.5 * Math.sqrt(ex * ex + ey * ey + h * h));
    const key = [cx, cy, box.minZ, h, R, sunDir.az, sunDir.alt].join('|');
    if (key === sunKey) return;
    sunKey = key;
    sceneRadius = R;
    // Azimuth is a compass bearing: 0 = north (plan +y), clockwise. Altitude is above the horizon.
    const az = rad(fin(sunDir.az) ? sunDir.az : DEFAULT_SUN.az), alt = rad(clamp(fin(sunDir.alt) ? sunDir.alt : DEFAULT_SUN.alt, 3, 90));
    const dir = new THREE.Vector3(...planToWorld(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)));
    const target = worldVec(cx, cy, box.minZ + h / 2);
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(dir, R * 2.5);
    const c = sun.shadow.camera, ext = R * 1.4;
    c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext;
    c.near = Math.max(1, R * 0.5); c.far = R * 5;
    c.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }
  const _box = new THREE.Box3();
  function findGrounds() {
    const out = [];
    layerRoot.traverseVisible((o) => { const u = o.userData; if (o.isMesh && u && (u.kind === 'site-ground' || u.isGround === true)) out.push(o); });
    return out;
  }
  const ray = new THREE.Raycaster();
  function groundZAt(grounds, x, y) {
    if (!grounds.length) return null;
    ray.set(worldVec(x, y, 1e5), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(grounds, false);
    return hits.length ? hits[0].point.y : null;
  }
  function syncAuto() {
    const b = buildingBox();
    const grounds = findGrounds();
    const key = [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ, grounds.map((g) => g.uuid + g.geometry.uuid).join(','), style, shadowsOn, capturing].join('|');
    if (key !== autoKey) {
      autoKey = key;
      let minY = 0;
      if (grounds.length) {
        minY = Infinity;
        for (const g of grounds) {
          if (!g.geometry.boundingBox) g.geometry.computeBoundingBox();
          g.updateWorldMatrix(true, false);
          _box.copy(g.geometry.boundingBox).applyMatrix4(g.matrixWorld);
          minY = Math.min(minY, _box.min.y);
        }
        if (!fin(minY)) minY = 0;
      }
      groundInfo = { on: grounds.length > 0, minY };
      slab.position.y = groundInfo.on ? Math.min(0, minY) - 4 : 0;
      gridUniforms.uMinorA.value = groundInfo.on ? 0.42 * 0.4 : 0.42;
      gridUniforms.uMajorA.value = groundInfo.on ? 0.8 * 0.4 : 0.8;
      const cast = shadowsOn && style !== 'diagram';
      sun.castShadow = cast;
      catcher.visible = cast && !groundInfo.on;
      figure.traverse((o) => { if (o.isMesh) o.castShadow = cast; });
      // The figure stands near the front-left (south-west) corner of the building, on the drawn ground when there is one.
      const fx = b.minX - 10, fy = b.minY - 10;
      const fz = groundZAt(grounds, fx, fy);
      figure.position.copy(worldVec(fx, fy, fz == null ? 0 : fz));
    }
    updateSun(b);
  }

  /* ---- loop ---- */
  function updateClip() {
    const dist = cam.position.distanceTo(target0());
    if (camType === 'persp') { cam.near = Math.max(0.5, dist * 0.01); cam.far = dist * 20 + sceneRadius * 4 + 2000; }
    else { cam.near = 0.1; cam.far = dist + 60000; }
    cam.updateProjectionMatrix();
  }
  function render() {
    if (!renderer) return;
    try {
      syncAuto();
      for (const fn of frameFns) { try { fn(); } catch (e) { console.error(e); } }
      updateClip();
      renderer.render(scene, cam);
    } catch (e) { console.error(e); }
  }
  function frame(t) {
    rafId = 0;
    if (capturing || !renderer) return;
    let again = false;
    try {
      if (tween) { stepTween(t); again = !!tween; needsRender = true; }
      const moved = controls ? controls.update() : false;
      if (moved) again = true;
      if (moved || needsRender) { needsRender = false; render(); }
    } catch (e) { console.error(e); }
    if (again) schedule();
  }
  function schedule() {
    if (rafId || !renderer || !HAS_WIN || typeof requestAnimationFrame !== 'function') return;
    rafId = requestAnimationFrame(frame);
  }
  function requestRender() { needsRender = true; schedule(); }

  function resize() {
    if (!renderer) return;
    try {
      const w = hostW(), h = hostH();
      renderer.setSize(w, h, false);
      setCamAspect(w / h);
      applyViewOffset();
      if (preset) setView(preset, { animate: false });
      needsRender = false;
      render();
    } catch (e) { console.error(e); }
  }

  if (controls) {
    controls.addEventListener('start', () => {
      tween = null;
      if (preset && !planLock) { preset = null; viewFns.forEach((fn) => { try { fn(null); } catch (e) { console.error(e); } }); }
    });
    controls.addEventListener('change', () => requestRender());
  }
  if (renderer && host) {
    try { if (typeof ResizeObserver === 'function') new ResizeObserver(() => resize()).observe(host); else if (HAS_WIN) window.addEventListener('resize', resize); } catch (e) { /* no observer */ }
    try {
      renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
      renderer.domElement.addEventListener('webglcontextrestored', () => requestRender());
    } catch (e) { /* stand-in renderer */ }
  }

  /* ---- picking helpers ---- */
  const ndc = new THREE.Vector2();
  function rect() {
    const el = renderer && renderer.domElement ? renderer.domElement : host;
    try { if (el && el.getBoundingClientRect) { const r = el.getBoundingClientRect(); if (r.width && r.height) return r; } } catch (e) { /* no layout */ }
    return { left: 0, top: 0, width: hostW(), height: hostH() };
  }
  function rayFrom(clientX, clientY) {
    const r = rect();
    cam.updateMatrixWorld(true);
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam);
    return rc;
  }
  /** Scene plan point [x, y] where the pointer ray meets the horizontal plane at scene elevation zPlan, or null (a near-horizontal view). */
  function groundPoint(clientX, clientY, zPlan = 0) {
    const r = rayFrom(clientX, clientY).ray;
    const dy = r.direction.y;
    if (Math.abs(dy) < 0.12) return null;
    const t = (zPlan - r.origin.y) / dy;
    if (!cam.isOrthographicCamera && !(t > 0)) return null;
    const p = r.origin.clone().addScaledVector(r.direction, t);
    return [p.x, -p.z];
  }
  function toScreen(v) {
    const r = rect();
    cam.updateMatrixWorld(true);
    const p = v.clone().project(cam);
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, visible: p.z >= -1 && p.z <= 1 };
  }

  /* ---- capture support (core/capture.js) ---- */
  /** Prepares a capture: stops the loop, removes the panel offset, hides the overlay; aiReady also hides the grid, the figure and the
   *  site marks and draws a plain light sky and ground. Returns restore(). */
  function prepareCapture({ aiReady = false } = {}) {
    capturing = true;
    if (rafId && HAS_WIN && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(rafId); rafId = 0; }
    const was = { bg: scene.background, ground: slab.material.color.clone(), grid: grid.visible, fig: figure.visible, overlay: overlayRoot.visible };
    const hid = [];
    overlayRoot.visible = false;
    for (const c of [persp, ortho]) c.clearViewOffset();
    if (aiReady) {
      scene.background = new THREE.Color(AI_SKY);
      slab.material.color.set(AI_GROUND);
      grid.visible = false; figure.visible = false;
      layerRoot.traverse((o) => { const k = o.userData && o.userData.kind; if ((k === 'site-boundary' || k === 'site-arrow') && o.visible) { o.visible = false; hid.push(o); } });
    }
    try { syncAuto(); updateClip(); } catch (e) { console.error(e); }
    lastCapture = { aiReady: !!aiReady, grid: grid.visible, figure: figure.visible, overlay: overlayRoot.visible, marks: aiReady ? hid.length === 0 : true };
    let done = false;
    return function restore() {
      if (done) return;
      done = true;
      scene.background = was.bg;
      slab.material.color.copy(was.ground);
      grid.visible = was.grid; figure.visible = was.fig; overlayRoot.visible = was.overlay;
      hid.forEach((o) => { o.visible = true; });
      applyViewOffset();
      capturing = false;
      requestRender();
    };
  }

  /* ---- start ---- */
  refreshColors();
  applyPlanLock();
  if (renderer) {
    const w = hostW(), h = hostH();
    try { renderer.setSize(w, h, false); } catch (e) { /* stand-in */ }
    setCamAspect(w / h);
    applyViewOffset();
    requestRender();
  } else setCamAspect(hostW() / hostH());

  return {
    THREE,
    ok: !!renderer,
    renderer, scene, controls, layerRoot, overlayRoot,
    canvas: () => (renderer ? renderer.domElement : null),
    camera: () => cam,
    cameraType: () => camType,
    requestRender,
    renderNow: () => { needsRender = false; render(); },
    onFrame: (fn) => { if (typeof fn !== 'function') return () => {}; frameFns.add(fn); return () => frameFns.delete(fn); },
    onView: (fn) => { if (typeof fn !== 'function') return () => {}; viewFns.add(fn); return () => viewFns.delete(fn); },
    setView,
    view: () => preset,
    isPlan: () => planLock,
    fitBox,
    setFraming: (f) => { framing = { site: (f && f.site) || (() => null), building: (f && f.building) || (() => null) }; autoKey = ''; sunKey = ''; requestRender(); },
    frameSite: ({ animate = true } = {}) => fitBox(siteBox(), { animate }),
    frameBuilding: ({ animate = true } = {}) => fitBox(buildingBox(), { animate }),
    framedBox: (id = 'axon') => (id === 'site' ? siteBox() : id === 'building' ? buildingBox() : axonBox()),
    setStyle: (s) => {
      const next = s === 'diagram' ? 'diagram' : 'model';
      if (next === style) return;
      style = next;
      refreshColors();
      emit('style:change', { style });
    },
    style: () => style,
    setSun: ({ az, alt } = {}) => { if (fin(az)) sunDir.az = az; if (fin(alt)) sunDir.alt = alt; requestRender(); },
    sun: () => ({ ...sunDir }),
    setShadows: (on) => { shadowsOn = !!on; requestRender(); },
    shadows: () => shadowsOn,
    setOrbitEnabled: (on) => { if (controls) { controls.enabled = !!on; if (!on) tween = null; } },
    orbitEnabled: () => !!controls && controls.enabled,
    setInsets: ({ right, bottom, left } = {}) => {
      const next = { right: fin(right) ? right : insets.right, bottom: fin(bottom) ? bottom : insets.bottom, left: fin(left) ? left : insets.left };
      if (next.right === insets.right && next.bottom === insets.bottom && next.left === insets.left) return;
      insets = next;
      applyViewOffset();
      if (preset) setView(preset, { animate: true }); else requestRender();
    },
    insets: () => ({ ...insets }),
    rayFrom, groundPoint, toScreen,
    resize,
    refreshColors,
    prepareCapture,
    captureFlags: () => (lastCapture ? { ...lastCapture } : null),
    info: () => ({
      ok: !!renderer, camera: camType, preset, planLock, tweening: !!tween, style, shadows: shadowsOn,
      sunCasts: sun.castShadow, groundOn: groundInfo.on, slabY: slab.position.y, catcher: catcher.visible,
      distance: cam.position.distanceTo(target0()), zoom: cam.zoom, insets: { ...insets },
      sun: { x: sun.position.x, y: sun.position.y, z: sun.position.z },
    }),
  };
}
