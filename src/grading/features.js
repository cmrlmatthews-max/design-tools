/* ==========================================================================
   GRADING: features
   Plan: docs/grading-sketch-technical-plan.md, sections 3.2 to 3.7 and the buildGrading contract (4).

   Pure ES module: no DOM, no Three.js, no hidden state, no mutation of inputs. Clipper through
   globalThis.ClipperLib at SCALE = 1000 (0.001 ft), only to build pads and tier strips.
   Units: feet; plan (x, y) in the project frame. Coordinates round to 0.001 ft, elevations to 0.01 ft.

   Axis angles are degrees counter-clockwise from east (+x), in [0, 180): an east–west bar is 0.
   Slopes in returned objects are fractions (0.05 = 5 percent), the same unit as state.limits; the state
   types them in percent (section 3.4).

   Caution: drive and lot grades are design values for a sketch. The fire marshal and the local code set
   fire access grades. Verify every grade with the civil engineer.
   ========================================================================== */
import { cleanRing2 } from "../shared/sketchup-format.js";
import { getSection } from "../shared/project.js";
import { existingSurface, makeSurface, areaFeature, padFeature, footprintRings } from "./surface.js";
import { padStepWalls, autoWalls, wallStats } from "./walls.js";

const SCALE = 1000;
const MITER_LIMIT = 4;
const EPS = 1e-6;
const SUB_DEFAULT = 2.5;       // ft: sub-cell side without a grid (k = 4 at 10 ft)

const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const snap0 = (v) => (Math.abs(v) < 1e-12 ? 0 : v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isRing = (r) => Array.isArray(r) && r.length >= 3 && isPt(r[0]);

/* ------------------------------------------------------------ Clipper */

const CL = () => {
  const L = globalThis.ClipperLib;
  if (!L) throw new Error("grading features: globalThis.ClipperLib is not loaded");
  return L;
};
const toPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
const toRing = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

/** Outer rings of a PolyTree (holes dropped: courtyards belong to the pad), cleaned CCW, largest first. */
function treeOuters(tree) {
  const out = [];
  const visit = (node) => {
    for (const child of node.Childs()) {
      if (!child.IsHole()) { const r = cleanRing2(toRing(child.Contour())); if (r) out.push(r); }
      visit(child);
    }
  };
  visit(tree);
  return out.sort((a, b) => ringArea(b) - ringArea(a));
}

/** Union of the rings grown by d (miter); d = 0 gives the cleaned union. */
function offsetUnion(rings, d) {
  const L = CL();
  const co = new L.ClipperOffset(MITER_LIMIT, 0.25);
  for (const r of rings) {
    const p = toPath(r);
    if (!L.Clipper.Orientation(p)) p.reverse();
    co.AddPath(p, L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  }
  const paths = [];
  co.Execute(paths, d * SCALE);
  return paths;
}

function intersect(paths, clipRing) {
  const L = CL();
  if (!paths.length) return [];
  const c = new L.Clipper();
  c.AddPaths(paths, L.PolyType.ptSubject, true);
  c.AddPath(toPath(clipRing), L.PolyType.ptClip, true);
  const tree = new L.PolyTree();
  c.Execute(L.ClipType.ctIntersection, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return treeOuters(tree);
}

/* ------------------------------------------------------------ small geometry */

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-12) { const m = ring.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]); return [m[0] / ring.length, m[1] / ring.length]; }
  return [cx / (3 * a), cy / (3 * a)];
}

function onSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= EPS;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSeg(x, y, a[0], a[1], b[0], b[1])) return true;
    if ((b[1] > y) !== (a[1] > y) && x < ((a[0] - b[0]) * (y - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}

const inAny = (rings, x, y) => rings.some((r) => inRing(r, x, y));

function boxOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

function hull(points) {
  const P = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Section 3.3: the longer side of the minimum-area bounding rectangle (rotating calipers on the hull). */
function autoAxis(rings) {
  const H = hull(rings.flat());
  if (H.length < 2) return 0;
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(L > 1e-9)) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of H) {
      const s = p[0] * ux + p[1] * uy, t = -p[0] * uy + p[1] * ux;
      if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
    }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area - 1e-6) best = { area, ux, uy, long: s1 - s0 >= t1 - t0 - 1e-9 };
  }
  if (!best) return 0;
  let deg = (Math.atan2(best.uy, best.ux) * 180) / Math.PI + (best.long ? 0 : 90);
  deg = ((deg % 180) + 180) % 180;
  if (Math.abs(deg - 180) < 1e-6 || Math.abs(deg) < 1e-6) deg = 0;
  return Math.round(deg * 1e6) / 1e6;
}

function axisOf(building, rings) {
  const a = building && building.axis;
  return typeof a === "number" && Number.isFinite(a) ? ((a % 180) + 180) % 180 : autoAxis(rings);
}

function axisFrame(deg) {
  const t = (deg * Math.PI) / 180;
  const ux = snap0(Math.cos(t)), uy = snap0(Math.sin(t));
  return { ux, uy, s: (p) => p[0] * ux + p[1] * uy, t: (p) => -p[0] * uy + p[1] * ux, xy: (s, t) => [s * ux - t * uy, s * uy + t * ux] };
}

function ringsOfBuilding(b) {
  if (b && Array.isArray(b.rings) && b.rings.length) return b.rings.map((r) => cleanRing2(r)).filter(Boolean);
  const r = cleanRing2(b && b.outer);
  return r ? [r] : [];
}

/* ------------------------------------------------------------ sub-cell samples */

/** Sub-cell centers inside `rings` and outside every ring set of `prior` (first wins). */
function latticeIn(rings, { grid = null, subdivide = 4, prior = [] } = {}) {
  const h = grid ? grid.spacing / Math.max(1, Math.floor(subdivide)) : SUB_DEFAULT;
  const ox = grid ? grid.x0 : 0, oy = grid ? grid.y0 : 0;
  const box = boxOf(rings);
  const pts = [];
  if (!Number.isFinite(box[0])) return pts;
  const i0 = Math.floor((box[0] - ox) / h - 0.5) - 1, i1 = Math.ceil((box[2] - ox) / h - 0.5) + 1;
  const j0 = Math.floor((box[1] - oy) / h - 0.5) - 1, j1 = Math.ceil((box[3] - oy) / h - 0.5) + 1;
  const pb = prior.map((rs) => ({ rs, b: boxOf(rs) }));
  for (let j = j0; j <= j1; j++) {
    const y = oy + (j + 0.5) * h;
    if (y < box[1] - EPS || y > box[3] + EPS) continue;
    for (let i = i0; i <= i1; i++) {
      const x = ox + (i + 0.5) * h;
      if (x < box[0] - EPS || x > box[2] + EPS || !inAny(rings, x, y)) continue;
      if (pb.some(({ rs, b }) => x >= b[0] - EPS && x <= b[2] + EPS && y >= b[1] - EPS && y <= b[3] + EPS && inAny(rs, x, y))) continue;
      pts.push([x, y]);
    }
  }
  return pts;
}

/* ------------------------------------------------------------ footprints (section 3.2) */

/**
 * Section 3.2. → [{ id, source: "typed" | "massing" | "parking", name, outer, rings, axis }] in the project
 * frame. outer = the largest ring; rings = every outer ring (a double-bar massing has two). axis = degrees.
 * building = the state building entry (read only: tiers, padOffset, padDepth).
 * A building inside another building's footprint (a deck inside a wrap) is moved before it (section 3.5).
 */
export function footprints(state, project) {
  const { list } = footprintRings(state, project);
  const items = list.map((f) => {
    const rings = f.rings.slice().sort((a, b) => ringArea(b) - ringArea(a));
    return { id: f.id, source: f.source, name: f.name, outer: rings[0], rings, axis: axisOf(f.building, rings), building: f.building };
  });
  const inside = (a, b) => a !== b && a.rings.every((r) => r.every((p) => inAny(b.rings, p[0], p[1])));
  const out = [];
  const rest = items.slice();
  while (rest.length) {
    let k = rest.findIndex((r) => !rest.some((s) => inside(s, r)));
    if (k < 0) k = 0;
    out.push(rest.splice(k, 1)[0]);
  }
  return out;
}

/* ------------------------------------------------------------ balance (section 3.7) */

/**
 * Section 3.7. Finds the pad top t where fill − cut = 0. sampler:
 *   null              sub-cell centers inside padRing on the 2.5 ft lattice (k = 4 at 10 ft from 0, 0)
 *   [[x, y], …]       equal-weight samples: g(t) = Σ (t − existingAt)
 *   (t) => g          any increasing function (fill − cut with the whole surface for balance "site")
 * Bracket: min − 1 to max + 1 of the existing ground under the pad. Method: false position with the
 * Illinois step (bisection when the step leaves the bracket), stopped when the bracket is under 0.01 ft or
 * the step moves under 0.0001 ft. g is linear in pad mode, so it lands in 1 to 2 iterations.
 * padRing may be a ring or a list of rings. → { padTop, ffe, iterations } (0.01 ft)
 */
export function balanceTier(padRing, existingAt, padDepth = 1, sampler = null) {
  const rings = isRing(padRing) ? [padRing] : (Array.isArray(padRing) ? padRing : []).filter(isRing);
  const ex = typeof existingAt === "function" ? existingAt : () => 0;
  const depth = num(padDepth, 1);
  let pts = Array.isArray(sampler) ? sampler.filter(isPt) : latticeIn(rings);
  if (!pts.length) pts = rings.flat();
  const zs = pts.map((p) => ex(p[0], p[1]));
  const vz = rings.flat().map((p) => ex(p[0], p[1]));
  const all = zs.concat(vz);
  if (!all.length) return { padTop: 0, ffe: r2(depth), iterations: 0 };
  let lo = Math.min(...all) - 1, hi = Math.max(...all) + 1;
  let g;
  if (typeof sampler === "function") g = sampler;
  else { const sum = zs.reduce((s, v) => s + v, 0), n = zs.length; g = (t) => n * t - sum; }
  let flo = g(lo), fhi = g(hi);
  let t = (lo + hi) / 2, iterations = 0;
  if (!(flo < 0)) t = lo;
  else if (!(fhi > 0)) t = hi;
  else {
    const tol = 1e-12 * (Math.abs(flo) + Math.abs(fhi));
    let side = 0, prev = NaN;
    while (iterations < 60) {
      iterations++;
      t = (lo * fhi - hi * flo) / (fhi - flo);
      if (!(t > lo && t < hi)) t = (lo + hi) / 2;
      const ft = g(t);
      if (Math.abs(ft) <= tol || Math.abs(t - prev) < 1e-4) break;
      if (ft < 0) { lo = t; flo = ft; if (side === -1) fhi /= 2; side = -1; }
      else { hi = t; fhi = ft; if (side === 1) flo /= 2; side = 1; }
      if (hi - lo < 0.01) { t = (lo + hi) / 2; break; }
      prev = t;
    }
  }
  const padTop = r2(t);
  return { padTop, ffe: r2(padTop + depth), iterations };
}

/* ------------------------------------------------------------ tiers and pads (section 3.3) */

function tierCuts(building, s0, s1) {
  const tiers = Array.isArray(building.tiers) && building.tiers.length ? building.tiers : [{ length: null, ffe: "balance" }];
  const count = tiers.length, Ls = s1 - s0;
  const typed = tiers.map((t) => (t && typeof t.length === "number" && t.length > 0 ? t.length : null));
  const free = typed.filter((v) => v === null).length;
  const rest = Math.max(0, Ls - typed.reduce((s, v) => s + (v || 0), 0));
  const lens = typed.map((v) => (v === null ? rest / Math.max(1, free) : v));
  const cuts = [];
  let s = s0;
  for (let k = 0; k < count - 1; k++) { s += lens[k]; cuts.push(Math.min(s, s1)); }
  return { tiers, cuts };
}

/**
 * Section 3.3. building = { id, source, name, outer | rings, axis, tiers, padOffset, padDepth }.
 * Pad of tier k = offset(footprint, padOffset, miter) ∩ strip k; the end strips run to infinity, so the end
 * pads reach past s0 and s1 through the offset footprint. Pad top = FFE − padDepth.
 * opts: { balance: "pad" (only pad mode here; buildGrading re-solves "site"), grid (sub-cell lattice),
 *         subdivide (4), prior: [rings, …] pads listed earlier (first wins) }.
 * → [{ id: "<building>-T<k>", building, source, tier, outer, outers, pad, pads, padTop, ffe, ffeMode,
 *      padDepth, padArea, existingMin, existingMax, iterations, axis, strip: [sFrom|null, sTo|null] }]
 */
export function tierPads(building, existingAt, { balance = "pad", grid = null, subdivide = 4, prior = [] } = {}) {
  const b = building || {};
  const rings = ringsOfBuilding(b);
  if (!rings.length) return [];
  const ex = typeof existingAt === "function" ? existingAt : () => 0;
  const axis = axisOf(b, rings);
  const A = axisFrame(axis);
  const pts = rings.flat();
  const ss = pts.map(A.s), ts = pts.map(A.t);
  const s0 = Math.min(...ss), s1 = Math.max(...ss), t0 = Math.min(...ts), t1 = Math.max(...ts);
  const offset = Math.max(0, num(b.padOffset, 5));
  const depth = num(b.padDepth, 1);
  const big = offset + 1000 + (s1 - s0) + (t1 - t0);
  const { tiers, cuts } = tierCuts(b, s0, s1);
  const padPaths = offsetUnion(rings, offset);
  const footPaths = offsetUnion(rings, 0);
  const id = String(b.id || b.source || "B");
  const out = [];
  const taken = prior.slice();
  for (let k = 0; k < tiers.length; k++) {
    const sa = k === 0 ? s0 - big : cuts[k - 1];
    const sb = k === tiers.length - 1 ? s1 + big : cuts[k];
    const strip = [A.xy(sa, t0 - big), A.xy(sb, t0 - big), A.xy(sb, t1 + big), A.xy(sa, t1 + big)];
    const pads = intersect(padPaths, strip);
    const outers = intersect(footPaths, strip);
    const spec = tiers[k] || {};
    const samples = pads.length ? latticeIn(pads, { grid, subdivide, prior: taken }) : [];
    let padTop, ffe, ffeMode, iterations = 0;
    if (typeof spec.ffe === "number" && Number.isFinite(spec.ffe)) {
      // A typed FFE keeps 0.001 ft: preset 8.5 types 997.875 (pad top 996.875 = existing at the deck face).
      ffeMode = "typed"; ffe = r3(spec.ffe); padTop = r3(spec.ffe - depth);
    } else {
      ffeMode = "balance";
      const res = balanceTier(pads, ex, depth, samples.length ? samples : null);
      padTop = res.padTop; ffe = res.ffe; iterations = res.iterations;
    }
    const under = (outers.length ? latticeIn(outers, { grid, subdivide }) : []).concat(outers.flat());
    const ez = under.map((p) => ex(p[0], p[1]));
    out.push({
      id: `${id}-T${k + 1}`, building: id, source: b.source || "typed", tier: k + 1,
      outer: outers[0] || [], outers, pad: pads[0] || [], pads, padTop, ffe, ffeMode, padDepth: depth,
      padArea: r2(pads.reduce((s, r) => s + ringArea(r), 0)),
      existingMin: ez.length ? r2(Math.min(...ez)) : null, existingMax: ez.length ? r2(Math.max(...ez)) : null,
      iterations, axis, strip: [k === 0 ? null : r3(sa), k === tiers.length - 1 ? null : r3(sb)], balance,
    });
    if (pads.length) taken.push(pads);
  }
  return out;
}

/* ------------------------------------------------------------ stepping (section 3.7) */

/**
 * Section 3.7. Samples the existing ground every 1 ft along the axis centerline of the footprint.
 * rise = max − min (never less than the end-to-end difference). count = ceil(rise ÷ maxStep), at least 1.
 * → { count, lengths: [ft, …] equal, rise }
 */
export function suggestTiers(building, existingAt, maxStep = 4) {
  const rings = ringsOfBuilding(building);
  if (!rings.length) return { count: 1, lengths: [0], rise: 0 };
  const ex = typeof existingAt === "function" ? existingAt : () => 0;
  const A = axisFrame(axisOf(building, rings));
  const pts = rings.flat();
  const ss = pts.map(A.s), ts = pts.map(A.t);
  const s0 = Math.min(...ss), s1 = Math.max(...ss), tc = (Math.min(...ts) + Math.max(...ts)) / 2;
  const Ls = s1 - s0, N = Math.max(1, Math.ceil(Ls - 1e-9));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= N; i++) {
    const p = A.xy(s0 + (i / N) * Ls, tc), z = ex(p[0], p[1]);
    if (z < lo) lo = z; if (z > hi) hi = z;
  }
  const rise = r2(hi - lo);
  const step = num(maxStep, 4) > 0 ? num(maxStep, 4) : 4;
  const count = Math.max(1, Math.ceil(rise / step - 1e-9));
  return { count, lengths: Array.from({ length: count }, () => r3(Ls / count)), rise };
}

/* ------------------------------------------------------------ drives and lots (section 3.4) */

/**
 * Section 3.4. drive = { id, line, width (24), start: "existing" | number, slope (percent, 5),
 * cross (percent, 2), crown (true) }. Station s and signed offset r (positive right of travel) come
 * from the nearest centerline segment. Square ends; round joints at bends.
 * → Feature { id, kind: "drive", ring (outline, miter), rings, box, contains, z, nearest, zMin, zMax,
 *             slope (fraction), cross (fraction), start (ft), width, line }
 */
export function driveFeature(drive, existingAt) {
  const dv = drive || {};
  const ex = typeof existingAt === "function" ? existingAt : () => 0;
  const line = [];
  for (const p of Array.isArray(dv.line) ? dv.line : []) {
    if (!isPt(p)) continue;
    const q = [r3(p[0]), r3(p[1])], l = line[line.length - 1];
    if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) >= 0.001) line.push(q);
  }
  const w = Math.max(0, num(dv.width, 24)), hw = w / 2;
  const slope = num(dv.slope, 5) / 100, cross = num(dv.cross, 2) / 100, crown = dv.crown !== false;
  const zs = typeof dv.start === "number" && Number.isFinite(dv.start) ? dv.start : line.length ? ex(line[0][0], line[0][1]) : 0;
  const segs = [];
  let acc = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    segs.push({ a, b, ux: dx / L, uy: dy / L, L, s0: acc });
    acc += L;
  }
  const last = segs.length - 1;
  const base = { id: dv.id, kind: "drive", slope: Math.abs(slope), cross: Math.abs(cross), start: r2(zs), width: w, line };
  if (!segs.length) return { ...base, ring: [], rings: [], box: [0, 0, -1, -1], contains: () => false, z: () => zs, nearest: (x, y) => ({ x, y, d: Infinity }), zMin: zs, zMax: zs };

  const local = (x, y) => {                     // nearest segment: { s, r, t, k, d }
    let best = null;
    for (let k = 0; k < segs.length; k++) {
      const g = segs[k];
      const t = (x - g.a[0]) * g.ux + (y - g.a[1]) * g.uy;
      const tc = Math.max(0, Math.min(g.L, t));
      const cx = g.a[0] + tc * g.ux, cy = g.a[1] + tc * g.uy;
      const d = Math.hypot(x - cx, y - cy);
      if (!best || d < best.d - 1e-12) best = { k, t, tc, d, r: (x - g.a[0]) * g.uy - (y - g.a[1]) * g.ux };
    }
    return best;
  };
  const zAt = (x, y) => {
    const L = local(x, y), g = segs[L.k];
    const zc = zs + slope * (g.s0 + L.tc);
    const r = Math.abs(L.r) <= L.d + 1e-9 && L.t >= 0 && L.t <= g.L ? L.r : Math.sign(L.r || 1) * L.d;
    return crown ? zc - cross * Math.abs(r) : zc - cross * r;
  };
  const inRect = (g, k, x, y) => {
    const t = (x - g.a[0]) * g.ux + (y - g.a[1]) * g.uy, r = (x - g.a[0]) * g.uy - (y - g.a[1]) * g.ux;
    return Math.abs(r) <= hw + EPS && t >= -EPS && t <= g.L + EPS;
  };
  const contains = (x, y) => {
    for (let k = 0; k < segs.length; k++) if (inRect(segs[k], k, x, y)) return true;
    for (let k = 1; k < line.length - 1; k++) if (Math.hypot(x - line[k][0], y - line[k][1]) <= hw + EPS) return true;
    return false;
  };
  const nearest = (x, y) => {
    let best = { x, y, d: Infinity };
    for (const g of segs) {                       // nearest point of each segment rectangle
      const t = (x - g.a[0]) * g.ux + (y - g.a[1]) * g.uy, r = (x - g.a[0]) * g.uy - (y - g.a[1]) * g.ux;
      const tc = Math.max(0, Math.min(g.L, t)), rc = Math.max(-hw, Math.min(hw, r));
      const qx = g.a[0] + tc * g.ux + rc * g.uy, qy = g.a[1] + tc * g.uy - rc * g.ux;
      const d = Math.hypot(x - qx, y - qy);
      if (d < best.d) best = { x: qx, y: qy, d };
    }
    for (let k = 1; k < line.length - 1; k++) {   // joint discs
      const c = line[k], dc = Math.hypot(x - c[0], y - c[1]);
      if (dc > hw) { const d = dc - hw; if (d < best.d) best = { x: c[0] + ((x - c[0]) / dc) * hw, y: c[1] + ((y - c[1]) / dc) * hw, d }; }
    }
    return best;
  };
  // Outline: left and right offset lines with miter joins.
  const side = (sgn) => line.map((p, i) => {
    const g1 = segs[Math.max(0, i - 1)], g2 = segs[Math.min(last, i)];
    const n1 = [g1.uy * sgn, -g1.ux * sgn], n2 = [g2.uy * sgn, -g2.ux * sgn];
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], bl = Math.hypot(bx, by);
    if (i === 0 || i === line.length - 1 || bl < 1e-9) { const n = i === 0 ? n2 : n1; return [r3(p[0] + hw * n[0]), r3(p[1] + hw * n[1])]; }
    const m = hw / Math.max(0.25, (bx * n2[0] + by * n2[1]) / bl);
    return [r3(p[0] + (m * bx) / bl), r3(p[1] + (m * by) / bl)];
  });
  const ring = cleanRing2(side(1).concat(side(-1).reverse())) || [];
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of segs) for (const p of [g.a, g.b]) {
    box[0] = Math.min(box[0], p[0] - hw); box[1] = Math.min(box[1], p[1] - hw);
    box[2] = Math.max(box[2], p[0] + hw); box[3] = Math.max(box[3], p[1] + hw);
  }
  const zcs = [zs, zs + slope * acc];
  const zMin = Math.min(...zcs) - Math.abs(cross) * hw, zMax = Math.max(...zcs) + (crown ? 0 : Math.abs(cross) * hw);
  return { ...base, ring, rings: ring.length ? [ring] : [], box, contains, z: zAt, nearest, zMin, zMax, length: r3(acc) };
}

/**
 * Section 3.4. lot = { id, ring, anchor: null | [x, y], start: "existing" | number, dir (degrees, the
 * uphill bearing, 0 = north, clockwise), slope (percent, 2), cross (percent, 1) }.
 * z = za + slope (p − a)·u + cross (p − a)·v, u = (sin dir, cos dir), v = (−cos dir, sin dir).
 * → Feature { id, kind: "lot", ring, rings, box, contains, z, nearest, zMin, zMax,
 *             slope (fraction), cross (fraction), anchor, start (ft) }
 */
export function lotFeature(lot, existingAt) {
  const l = lot || {};
  const ex = typeof existingAt === "function" ? existingAt : () => 0;
  const ring = cleanRing2(l.ring) || [];
  const a = isPt(l.anchor) ? [l.anchor[0], l.anchor[1]] : ring.length ? centroid(ring) : [0, 0];
  const za = typeof l.start === "number" && Number.isFinite(l.start) ? l.start : ex(a[0], a[1]);
  const b = (num(l.dir, 0) * Math.PI) / 180;
  const u = [snap0(Math.sin(b)), snap0(Math.cos(b))], v = [-u[1], u[0]];
  const s = num(l.slope, 2) / 100, c = num(l.cross, 1) / 100;
  const z = (x, y) => za + s * ((x - a[0]) * u[0] + (y - a[1]) * u[1]) + c * ((x - a[0]) * v[0] + (y - a[1]) * v[1]);
  const zv = ring.map((p) => z(p[0], p[1]));
  const f = areaFeature({ id: l.id, kind: "lot", rings: ring.length ? [ring] : [], z, zMin: zv.length ? Math.min(...zv) : za, zMax: zv.length ? Math.max(...zv) : za });
  return { ...f, slope: Math.abs(s), cross: Math.abs(c), anchor: [r3(a[0]), r3(a[1])], start: r2(za) };
}

/* ------------------------------------------------------------ build (sections 3.1 to 3.7) */

function cleanLine(raw) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!isPt(p)) continue;
    const q = [r3(p[0]), r3(p[1])], l = out[out.length - 1];
    if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) >= 0.001) out.push(q);
  }
  return out;
}

function extent(rings, st) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (p) => { if (!isPt(p)) return; box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]); box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]); };
  for (const r of rings) for (const p of r) add(p);
  for (const dv of Array.isArray(st.drives) ? st.drives : []) {
    const w = Math.max(0, num(dv && dv.width, 24)) / 2;
    for (const p of (dv && dv.line) || []) if (isPt(p)) { add([p[0] - w, p[1] - w]); add([p[0] + w, p[1] + w]); }
  }
  for (const l of Array.isArray(st.lots) ? st.lots : []) for (const p of (l && l.ring) || []) add(p);
  for (const r of Array.isArray(st.routes) ? st.routes : []) for (const p of (r && r.line) || []) add(p);
  return Number.isFinite(box[0]) ? box : null;
}

function propertyRing(st, project, grid) {
  const pr = st.property || {};
  if (pr.mode === "drawn") { const r = cleanRing2(pr.ring); if (r) return r; }
  if (st.ground && st.ground.mode === "site") {
    const sec = getSection(project, "site");
    const r = sec && sec.derived && cleanRing2(sec.derived.boundary);
    if (r) return r;
  }
  const x0 = grid.x0, y0 = grid.y0, L = (grid.n - 1) * grid.spacing;
  return [[x0, y0], [r3(x0 + L), y0], [r3(x0 + L), r3(y0 + L)], [x0, r3(y0 + L)]];
}

/**
 * The whole grading build (sections 3.1 to 3.7). The only function that reads the project.
 * quality "draft": k = 1 (earthwork and the site balance) while a handle moves.
 * → { source: "standalone" | "project", ground: "site" | "plane", grid, existingAt, surface, buildings,
 *     tiers, features, walls, conflicts, warnings, notes, property, subdivide, quality, daylight, zRange }
 *   surface  = makeSurface(...) with every wall: { at, sample, existingAt, conflicts }
 *   buildings = [{ id, source, name, outer, rings, axis, padOffset, padDepth, tiers: [tier id, …] }]
 *   tiers    = tierPads rows, flat, first-wins order
 *   features = pads (Feature, id = tier id), then drives, then lots
 *   walls    = [{ id, kind: "drawn" | "pad-step" | "auto", line, auto, accepted, heightMax, heightAvg,
 *                 length, top: [[x, y, z], …] }]
 *   warnings = [{ code, severity, where, message }]: tower-no-levels, slope-conflict, outside-site
 */
export function buildGrading(state, { project = null, quality = "full" } = {}) {
  const st = state || {};
  const notes = [], warnings = [];
  const fr = footprintRings(st, project);
  notes.push(...fr.notes);
  warnings.push(...fr.warnings);
  const fps = footprints(st, project);
  const ex = existingSurface(st, project, extent(fps.flatMap((f) => f.rings), st));
  notes.push(...ex.notes);
  const grid = ex.grid, existingAt = ex.at;
  const zRange = [grid.min, grid.max];
  const kFull = Math.max(1, Math.floor(num(st.earthwork && st.earthwork.subdivide, 4)));
  const k = quality === "draft" ? 1 : kFull;
  const daylight = { on: !st.daylight || st.daylight.on !== false, fill: num(st.daylight && st.daylight.fill, 3), cut: num(st.daylight && st.daylight.cut, 2) };

  // Tiers and pads, first wins (section 3.3); pad-mode balance first.
  const tiers = [], buildings = [], prior = [];
  for (const f of fps) {
    const b = f.building || {};
    const bld = { ...b, id: f.id, source: f.source, name: f.name, rings: f.rings, outer: f.outer, axis: f.axis };
    const tp = tierPads(bld, existingAt, { balance: st.balance === "site" ? "site" : "pad", grid, subdivide: kFull, prior });
    for (const t of tp) { tiers.push(t); if (t.pads.length) prior.push(t.pads); }
    buildings.push({ id: f.id, source: f.source, name: f.name, outer: f.outer, rings: f.rings, axis: f.axis,
      padOffset: Math.max(0, num(b.padOffset, 5)), padDepth: num(b.padDepth, 1), tiers: tp.map((t) => t.id) });
  }
  const drives = (Array.isArray(st.drives) ? st.drives : []).map((d) => driveFeature(d, existingAt)).filter((d) => d.ring.length);
  const lots = (Array.isArray(st.lots) ? st.lots : []).map((l) => lotFeature(l, existingAt)).filter((l) => l.ring.length);
  const drawn = (Array.isArray(st.walls) ? st.walls : []).map((w, i) => ({ id: String((w && w.id) || `W${i + 1}`), kind: "drawn", line: cleanLine(w && w.line), auto: false, accepted: true }))
    .filter((w) => w.line.length >= 2);
  const featuresOf = () => [...tiers.map(padFeature), ...drives, ...lots];

  // Balance "site" (section 3.7): the whole surface in g(t), tiers in order, a second pass with several.
  const balancing = tiers.filter((t) => t.ffeMode === "balance" && t.pads.length);
  if (st.balance === "site" && balancing.length) {
    const kb = k;
    const h = grid.spacing / kb;
    const fill = Math.max(1e-6, daylight.fill), cut = Math.max(1e-6, daylight.cut);
    const reach = daylight.on ? (grid.max - grid.min + 2) * Math.max(fill, cut) + 1 : 0;
    const fb = featuresOf().map((f) => f.box);
    const rb = [Math.min(...fb.map((b) => b[0])) - reach, Math.min(...fb.map((b) => b[1])) - reach, Math.max(...fb.map((b) => b[2])) + reach, Math.max(...fb.map((b) => b[3])) + reach];
    const nSub = (grid.n - 1) * kb;               // sub-cells per side; cells outside the reach add 0
    const samples = [];
    const i0 = Math.max(0, Math.floor((rb[0] - grid.x0) / h)), i1 = Math.min(nSub, Math.ceil((rb[2] - grid.x0) / h));
    const j0 = Math.max(0, Math.floor((rb[1] - grid.y0) / h)), j1 = Math.min(nSub, Math.ceil((rb[3] - grid.y0) / h));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const x = grid.x0 + (i + 0.5) * h, y = grid.y0 + (j + 0.5) * h;
      samples.push([x, y, existingAt(x, y)]);
    }
    const steps = padStepWalls(tiers);
    const passes = balancing.length > 1 ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) for (const t of balancing) {
      const g = (top) => {
        const feats = [...tiers.map((u) => padFeature(u === t ? { ...u, padTop: top } : u)), ...drives, ...lots];
        const surf = makeSurface(feats, [...drawn, ...steps], existingAt, daylight, { zRange });
        let sum = 0;
        for (const p of samples) sum += surf.at(p[0], p[1]) - p[2];
        return sum;
      };
      const res = balanceTier(t.pads, existingAt, t.padDepth, g);
      t.padTop = res.padTop; t.ffe = res.ffe; t.iterations += res.iterations;
    }
  }

  // Walls (section 3.6): drawn and pad-step, then auto walls on that surface, then the surface once more.
  const features = featuresOf();
  const steps = padStepWalls(tiers);
  const surface0 = makeSurface(features, [...drawn, ...steps], existingAt, daylight, { zRange });
  const property = propertyRing(st, project, grid);
  const autos = st.autoWalls && st.autoWalls.on === false ? [] : autoWalls(st, surface0, property, features);
  const allWalls = [...drawn, ...steps, ...autos];
  const surface = makeSurface(features, allWalls, existingAt, daylight, { zRange, probe: grid });
  const walls = allWalls.map((w) => ({ ...w, ...wallStats(w, surface.at) }));

  for (const c of surface.conflicts) {
    warnings.push({ code: "slope-conflict", severity: "warn", where: { x: c.x, y: c.y, a: c.a, b: c.b },
      message: `The slopes from ${c.a} and ${c.b} cannot meet near (${Math.round(c.x)}, ${Math.round(c.y)}). Add a wall or more distance.` });
  }
  for (const f of features) {
    const out = f.rings.some((r) => r.some((p) => !inRing(property, p[0], p[1])));
    if (out) warnings.push({ code: "outside-site", severity: "warn", where: { id: f.id }, message: `${f.kind === "pad" ? "Pad" : f.kind === "drive" ? "Drive" : "Lot"} ${f.id} crosses the property line.` });
  }

  return {
    source: st.source === "project" && project ? "project" : "standalone", ground: ex.source,
    grid, existingAt, surface, buildings, tiers, features, walls, conflicts: surface.conflicts, warnings, notes,
    property, subdivide: k, quality: quality === "draft" ? "draft" : "full", daylight, zRange,
  };
}
