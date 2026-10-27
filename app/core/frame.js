/* ==========================================================================
   CORE: frame (app/CONTRACT.md section 4)
   One copy of the plan-to-Three mapping and the scene shift for the page.

   Plan = (x east, y north, z up), feet. Three.js is Y-up, so plan y maps to -z.
   planToWorld() is the ONLY place that mapping is written; geometry authored in
   plan space uses planMatrix(), which is built from it.

   The scene is the PROJECT frame, shifted so the middle of the site (or of the
   model) sits at the origin and the lowest ground at height 0 (the Model Viewer
   rule, build/viewer/03_state.js Model.load). Every drawn point is
   (project x - shift.x, project y - shift.y, project z - shift.z).
   ========================================================================== */
import * as THREE from 'three';
import { bus } from './bus.js';
import { layersFrom } from '../../src/viewer/scene.js';

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
/** The layers that draw solids above the ground (build/viewer/03_state.js BUILD_LAYERS). */
const BUILD_LAYERS = ['massing', 'units', 'cores', 'parking', 'grading'];

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d = 0) => (fin(v) ? v : d);

/** Plan (x, y, elevation) -> Three.js world [x, y, z]. North (plan +y) is world -z. */
export function planToWorld(x, y, e = 0) { return [x, e, -y]; }

/** planToWorld as a THREE.Vector3. */
export function worldVec(x, y, e = 0) { return new THREE.Vector3(x, e, -y); }

/** A world point back to plan [x, y, elevation]. */
export function worldToPlan(v) { return [v.x, -v.z, v.y]; }

/** Matrix equivalent of planToWorld, for geometry authored in plan space (shape x, y; extrusion up = elevation). */
export function planMatrix(elev = 0) {
  const o = worldVec(0, 0, 0);
  const ex = worldVec(1, 0, 0).sub(o), ey = worldVec(0, 1, 0).sub(o), ez = worldVec(0, 0, 1).sub(o);
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
  m.setPosition(worldVec(0, 0, elev));
  return m;
}

/* ---------- the shift ---------- */

let shift = { ...ZERO };

/** The current shift: project point minus shift = scene plan point. A copy. */
export function getShift() { return { x: shift.x, y: shift.y, z: shift.z }; }

/** Sets the shift and emits frame:shift (only when it changed). */
export function setShift(next) {
  const s = next && typeof next === 'object' ? { x: num(next.x), y: num(next.y), z: num(next.z) } : { ...ZERO };
  if (s.x === shift.x && s.y === shift.y && s.z === shift.z) return false;
  shift = s;
  try { bus.emit('frame:shift', { shift: getShift() }); } catch (e) { /* the bus logs */ }
  return true;
}

function union(list) {
  const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, zMin: Infinity, zMax: -Infinity };
  let any = false;
  for (const b of list) {
    if (!b) continue;
    any = true;
    out.minX = Math.min(out.minX, b.minX); out.maxX = Math.max(out.maxX, b.maxX);
    out.minY = Math.min(out.minY, b.minY); out.maxY = Math.max(out.maxY, b.maxY);
    if (fin(b.zMin)) out.zMin = Math.min(out.zMin, b.zMin);
    if (fin(b.zMax)) out.zMax = Math.max(out.zMax, b.zMax);
  }
  return any ? out : null;
}

/**
 * The Model Viewer rule: x and y = the middle of the site bounds, else of the model bounds, else 0 (rounded to 1 ft);
 * z = the lowest site ground, else the lowest grading ground, else the lowest model point, else 0 (rounded to 0.01 ft).
 * `layers` (optional) is a layersFrom(doc) result the caller already has.
 */
export function shiftFor(doc, layers) {
  if (!doc || typeof doc !== 'object') return { ...ZERO };
  let all = layers || null;
  if (!all) { try { all = layersFrom(doc); } catch (e) { all = null; } }
  if (!all) return { ...ZERO };
  const ok = (id) => !!(all[id] && all[id].ok);
  const site = ok('site') ? all.site.bounds : null;
  const build = union(BUILD_LAYERS.map((id) => (ok(id) ? all[id].bounds : null)));
  const base = site || build || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let z = null;
  if (ok('site') && all.site.ground) z = all.site.ground.zMin;
  else if (ok('grading') && all.grading.ground) z = all.grading.ground.zMin;
  else if (build && fin(build.zMin)) z = build.zMin;
  const x = Math.round((base.minX + base.maxX) / 2), y = Math.round((base.minY + base.maxY) / 2);
  return { x: fin(x) ? x : 0, y: fin(y) ? y : 0, z: fin(z) ? Math.round(z * 100) / 100 : 0 };
}

/* ---------- points and groups ---------- */

/** Project plan point -> scene plan point. */
export function toScene(p) {
  const a = Array.isArray(p) ? p : [0, 0, 0];
  return [num(a[0]) - shift.x, num(a[1]) - shift.y, num(a[2]) - shift.z];
}

/** Scene plan point -> project plan point. */
export function fromScene(p) {
  const a = Array.isArray(p) ? p : [0, 0, 0];
  return [num(a[0]) + shift.x, num(a[1]) + shift.y, num(a[2]) + shift.z];
}

/**
 * Puts a group that holds a tool's LOCAL geometry (authored with planToWorld / planMatrix: local x, y, and z above
 * placement.baseZ) where the placement says, in the shifted scene. Same result as toProject in src/shared/project.js
 * followed by toScene. Rotation is degrees counter-clockwise in plan = rotation.y radians.
 */
export function placeGroup(group, placement) {
  if (!group) return group;
  const p = placement && typeof placement === 'object' ? placement : {};
  const [wx, wy, wz] = planToWorld(num(p.x) - shift.x, num(p.y) - shift.y, num(p.baseZ) - shift.z);
  group.position.set(wx, wy, wz);
  group.rotation.set(0, (num(p.rotation) * Math.PI) / 180, 0);
  group.updateMatrix();
  return group;
}
