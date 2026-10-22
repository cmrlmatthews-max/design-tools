/* ==========================================================================
   SHARED: sitelayer
   The site layer data: reads site.derived (docs/project-file-spec.md section 6.1) and returns plain
   arrays in a tool's LOCAL frame, ready for the Three.js part (build/shared/06x_sitelayer.js).
   Plan: docs/site-layer-technical-plan.md sections 3 and 4.

   Frames
   - Input points are in the project frame (the site section placement is the identity).
   - Output points are local: [x, y] through transformRing(placement, ring, "toLocal"), z = z - placement.baseZ.
   - The ground grid stays axis-aligned in the project frame. A rotated placement rotates the whole mesh as a
     solid: node positions are transformed, nothing is resampled.

   Rules
   - Pure ES module, no Three.js, no DOM. Node-testable. One-line import (the build scripts inline it).
   - Never mutates its inputs. No NaN in any output: malformed items are skipped.
   - Output rings have no repeated closing point and no repeated consecutive points.
   ========================================================================== */

import { transformRing, toLocal, toProject } from "./project.js";

export const SITE_LAYER_VERSION = 1;

const DEFAULT_MAX_BUILDINGS = 2000;
const SKIRT_DEPTH = 4;          // ft under the lowest ground node
const BOUNDARY_STEP = 10;       // ft between draped boundary points
const BOUNDARY_LIFT = 0.6;
const WATER_LINE_STEP = 10;
const WATER_LINE_LIFT = 0.4;
const MAX_SEGS_PER_EDGE = 10000;
const FLAT_RANGE = 0.5;         // ground with less relief than this shades flat (0.5), like the Site Model

/* ---------- small helpers ---------- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Round to 0.001 ft (and never return -0). */
function r3(v) {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}

/** The four placement numbers; a missing or bad number counts as 0 (same rule as project.js placementOf). */
function placementNums(p) {
  const q = isObj(p) && isObj(p.placement) ? p.placement : p;
  const n = (v) => (fin(v) ? v : 0);
  return isObj(q) ? { x: n(q.x), y: n(q.y), rotation: n(q.rotation), baseZ: n(q.baseZ) } : { x: 0, y: 0, rotation: 0, baseZ: 0 };
}

/** A ring of finite [x, y] points, without the closing point and without consecutive repeats. null when a point is bad. */
function cleanInputRing(ring) {
  if (!Array.isArray(ring)) return null;
  const out = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) return null;
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

/** The same cleanup on a ring that is already local (after the 0.001 rounding two points can become equal). */
function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

/** A project-frame ring to a clean local ring of >= 3 points, or null. */
function localRing(pl, ring) {
  const c = cleanInputRing(ring);
  if (!c || c.length < 3) return null;
  const out = dedupeRing(transformRing(pl, c, "toLocal"));
  return out.length >= 3 ? out : null;
}

/** A project-frame MultiPoly polygon ({ outer | ring, holes }) to { outer, holes } local, or null. */
function localPoly(pl, poly) {
  if (!isObj(poly)) return null;
  const outer = localRing(pl, Array.isArray(poly.outer) ? poly.outer : poly.ring);
  if (!outer) return null;
  const holes = [];
  for (const h of Array.isArray(poly.holes) ? poly.holes : []) {
    const r = localRing(pl, h);
    if (r) holes.push(r);
  }
  return { outer, holes };
}

function bboxOf(ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, maxX, minY, maxY };
}

/** Points every `step` along a polyline (closed: back to the first point, which is not repeated). */
function densify(pts, step, closed) {
  const out = [];
  const m = pts.length;
  if (m === 0) return out;
  if (m === 1) return [[pts[0][0], pts[0][1]]];
  const edges = closed ? m : m - 1;
  for (let e = 0; e < edges; e++) {
    const a = pts[e], b = pts[(e + 1) % m];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const segs = Math.min(MAX_SEGS_PER_EDGE, Math.max(1, Math.ceil(len / step - 1e-9)));
    for (let k = 0; k < segs; k++) {
      const t = k / segs;
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  if (!closed) out.push([pts[m - 1][0], pts[m - 1][1]]);
  return out;
}

/* ---------- the ground grid (validated once per grid object) ---------- */

const gridCache = new WeakMap();

/**
 * The checked grid of site.derived.ground: { ok: true, n, spacing, x0, y0, xs, ys, zs, zMin, zMax } with the node
 * coordinates as Float64Arrays (row-major from the south), or { ok: false, reason }.
 */
function gridOf(siteDerived) {
  const g = isObj(siteDerived) ? siteDerived.ground : null;
  if (g === undefined || g === null) return { ok: false, reason: "The site has no ground grid." };
  if (!isObj(g)) return { ok: false, reason: "The site ground grid is not an object." };
  const hit = gridCache.get(g);
  if (hit && hit.points === g.points && hit.n === g.n && hit.spacing === g.spacing && hit.len === (Array.isArray(g.points) ? g.points.length : -1)) return hit.grid;
  const grid = checkGrid(g);
  gridCache.set(g, { points: g.points, n: g.n, spacing: g.spacing, len: Array.isArray(g.points) ? g.points.length : -1, grid });
  return grid;
}

function checkGrid(g) {
  const { n, spacing, points } = g;
  if (!Number.isInteger(n) || n < 2) return { ok: false, reason: "The site ground grid needs n of 2 or more." };
  if (!fin(spacing) || spacing <= 0) return { ok: false, reason: "The site ground grid spacing must be a positive number." };
  if (!Array.isArray(points) || points.length !== n * n) return { ok: false, reason: `The site ground grid has ${Array.isArray(points) ? points.length : 0} points; n = ${n} needs ${n * n}.` };
  const N = n * n, xs = new Float64Array(N), ys = new Float64Array(N), zs = new Float64Array(N);
  let zMin = Infinity, zMax = -Infinity;
  for (let k = 0; k < N; k++) {
    const p = points[k];
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1]) || !fin(p[2])) return { ok: false, reason: `The site ground grid point ${k} is not a finite [x, y, z].` };
    xs[k] = p[0]; ys[k] = p[1]; zs[k] = p[2];
    if (p[2] < zMin) zMin = p[2];
    if (p[2] > zMax) zMax = p[2];
  }
  return { ok: true, n, spacing, x0: xs[0], y0: ys[0], xs, ys, zs, zMin, zMax };
}

/** Bilinear on a checked grid at a project point, clamped to the grid edge. */
function sample(grid, xp, yp) {
  const { n, spacing, x0, y0, zs } = grid;
  const L = n - 1;
  let fi = (xp - x0) / spacing, fj = (yp - y0) / spacing;
  fi = fi < 0 ? 0 : fi > L ? L : fi;
  fj = fj < 0 ? 0 : fj > L ? L : fj;
  const i = Math.min(Math.floor(fi), n - 2), j = Math.min(Math.floor(fj), n - 2);
  const tx = fi - i, ty = fj - j, o = j * n + i;
  return zs[o] * (1 - tx) * (1 - ty) + zs[o + 1] * tx * (1 - ty) + zs[o + n] * (1 - tx) * ty + zs[o + n + 1] * tx * ty;
}

/* ---------- public lookups ---------- */

/**
 * The ground elevation (absolute, NAVD88 ft) at a project-frame point: bilinear on the site grid, clamped to the
 * grid edge (a point outside the grid gets the elevation of the nearest edge point). null without a usable grid
 * or for a non-finite point.
 */
export function groundZAt(siteDerived, xp, yp) {
  if (!fin(xp) || !fin(yp)) return null;
  const grid = gridOf(siteDerived);
  if (!grid.ok) return null;
  const z = sample(grid, xp, yp);
  return fin(z) ? z : null;
}

/** groundZAt at a LOCAL-frame point of a tool (placement { x, y, rotation, baseZ }), relative to baseZ. null without a grid. */
export function groundZLocal(siteDerived, placement, x, y) {
  if (!fin(x) || !fin(y)) return null;
  const pl = placementNums(placement);
  const [xp, yp] = toProject(pl, [x, y]);
  const z = groundZAt(siteDerived, xp, yp);
  return z === null ? null : z - pl.baseZ;
}

/**
 * A LOCAL ring draped on the ground: [[x, y, z], …] with points every `step` ft along the ring (the corners are
 * kept; no closing point), z = groundZLocal + lift. Without a grid z is 0 (the tool's base). Input points may be
 * [x, y] or [x, y, z] (z is ignored). The 6th argument `closed` (default true) is an extension: pass false for an
 * open polyline (no segment from the last point back to the first; the last point is kept).
 */
export function drapeRing(siteDerived, placement, ring, step = 10, lift = 0.6, closed = true) {
  const pts = closed ? cleanInputRing(ring) : cleanLine(ring);
  if (!pts || pts.length === 0) return [];
  const st = fin(step) && step > 0 ? step : 10;
  const lf = fin(lift) ? lift : 0;
  const pl = placementNums(placement);
  const grid = gridOf(siteDerived);
  const [s, c] = sinCos(pl);
  const out = [];
  for (const [x, y] of densify(pts, st, closed)) {
    let z = 0;
    if (grid.ok) {
      const xp = x * c - y * s + pl.x, yp = x * s + y * c + pl.y;
      z = sample(grid, xp, yp) - pl.baseZ + lf;
    }
    out.push([r3(x), r3(y), r3(z)]);
  }
  return out;
}

/** An open polyline of finite [x, y] points without consecutive repeats, or null. */
function cleanLine(line) {
  if (!Array.isArray(line)) return null;
  const out = [];
  for (const p of line) {
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) return null;
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** [sin, cos] of the placement rotation, exact for the quarter turns (taken from project.js toLocal). */
function sinCos(pl) {
  const u = toLocal({ x: 0, y: 0, rotation: pl.rotation, baseZ: 0 }, [1, 0]);   // = [cos, -sin]
  return [-u[1] === 0 ? 0 : -u[1], u[0] === 0 ? 0 : u[0]];
}

/**
 * The site square in the project frame: { size, boundary, center: [x, y] }, or null when the site has neither a
 * boundary, a size, nor a ground grid. boundary is site.derived.boundary (cleaned), else the square of `size`,
 * else the square the grid covers. size is site.derived.size, else the larger side of the boundary box.
 */
export function siteBounds(siteDerived) {
  if (!isObj(siteDerived)) return null;
  let boundary = cleanInputRing(siteDerived.boundary);
  if (!boundary || boundary.length < 3) boundary = null;
  const S = fin(siteDerived.size) && siteDerived.size > 0 ? siteDerived.size : null;
  if (!boundary && S !== null) boundary = [[0, 0], [S, 0], [S, S], [0, S]];
  if (!boundary) {
    const grid = gridOf(siteDerived);
    if (grid.ok) {
      const L = (grid.n - 1) * grid.spacing, x0 = grid.x0, y0 = grid.y0;
      boundary = [[x0, y0], [x0 + L, y0], [x0 + L, y0 + L], [x0, y0 + L]];
    }
  }
  if (!boundary) return null;
  const b = bboxOf(boundary);
  return { size: S !== null ? S : Math.max(b.maxX - b.minX, b.maxY - b.minY), boundary, center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] };
}

/* ---------- the layer data ---------- */

function emptyResult(reason) {
  return {
    ok: false, reason, bounds: null, ground: null, boundary: null, buildings: [], roads: [], walks: [],
    water: { areas: [], lines: [] }, trees: [],
    counts: { buildings: 0, roads: 0, walks: 0, waterAreas: 0, trees: 0, groundNodes: 0 },
  };
}

/** The ground mesh arrays in the local frame (section 3.2). */
function groundData(grid, pl) {
  const { n, spacing, xs, ys, zs, zMin, zMax } = grid;
  const N = n * n, [s, c] = sinCos(pl), bz = pl.baseZ;
  const positions = new Float32Array(N * 3), shade = new Float32Array(N);
  const range = zMax - zMin, flat = !(range > FLAT_RANGE);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < N; k++) {
    const dx = xs[k] - pl.x, dy = ys[k] - pl.y;
    const x = dx * c + dy * s, y = -dx * s + dy * c;
    positions[3 * k] = x; positions[3 * k + 1] = y; positions[3 * k + 2] = zs[k] - bz;
    shade[k] = flat ? 0.5 : (zs[k] - zMin) / range;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, cc = a + n + 1, d = a + n;
    indices[q++] = a; indices[q++] = b; indices[q++] = cc;
    indices[q++] = a; indices[q++] = cc; indices[q++] = d;
  }
  // skirt: four sides, each n top + n bottom vertices (interleaved top, bottom), two triangles per segment, faces out
  const bottomZ = zMin - bz - SKIRT_DEPTH;
  const sides = [
    (k) => k,                               // south, travelling east
    (k) => k * n + n - 1,                   // east, travelling north
    (k) => (n - 1) * n + (n - 1 - k),       // north, travelling west
    (k) => (n - 1 - k) * n,                 // west, travelling south
  ];
  const sp = new Float32Array(4 * n * 2 * 3), si = new Uint32Array(4 * (n - 1) * 6);
  let v = 0, t = 0;
  for (const side of sides) {
    const base = v;
    for (let k = 0; k < n; k++) {
      const node = side(k);
      const x = positions[3 * node], y = positions[3 * node + 1], z = positions[3 * node + 2];
      sp[3 * v] = x; sp[3 * v + 1] = y; sp[3 * v + 2] = z; v++;
      sp[3 * v] = x; sp[3 * v + 1] = y; sp[3 * v + 2] = bottomZ; v++;
    }
    for (let k = 0; k < n - 1; k++) {
      const t0 = base + 2 * k, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
      si[t++] = t0; si[t++] = b0; si[t++] = t1;
      si[t++] = t1; si[t++] = b0; si[t++] = b1;
    }
  }
  return {
    ground: { n, spacing, positions, shade, indices, skirt: { positions: sp, indices: si, bottomZ } },
    box: { minX, maxX, minY, maxY, zMin: zMin - bz, zMax: zMax - bz },
  };
}

/** A z for a local point: the ground there (relative), else `fallback`. */
function zHere(grid, pl, s, c, x, y, fallback) {
  if (!grid.ok) return fallback;
  return sample(grid, x * c - y * s + pl.x, x * s + y * c + pl.y) - pl.baseZ;
}

function centroid(ring) {
  let sx = 0, sy = 0;
  for (const p of ring) { sx += p[0]; sy += p[1]; }
  return [sx / ring.length, sy / ring.length];
}

function idSet(ids) {
  const out = new Set();
  if (ids instanceof Set || Array.isArray(ids)) for (const id of ids) if (id !== undefined && id !== null) out.add(String(id));
  return out;
}

function buildingsData(list, pl, grid, s, c, opts) {
  const skip = idSet(opts.contextIds);
  const max = fin(opts.maxBuildings) && opts.maxBuildings >= 0 ? Math.floor(opts.maxBuildings) : DEFAULT_MAX_BUILDINGS;
  const out = [];
  (Array.isArray(list) ? list : []).forEach((b, index) => {
    if (!isObj(b)) return;
    const id = b.id !== undefined && b.id !== null ? b.id : `b${index}`;
    if (skip.has(String(id))) return;
    const outer = localRing(pl, b.outer);
    if (!outer) return;
    const holes = [];
    for (const h of Array.isArray(b.holes) ? b.holes : []) {
      const r = localRing(pl, h);
      if (r) holes.push(r);
    }
    let base;
    if (fin(b.base)) base = b.base - pl.baseZ;
    else { const [cx, cy] = centroid(outer); base = zHere(grid, pl, s, c, cx, cy, 0); }
    let height = fin(b.height) ? b.height : fin(b.top) && fin(b.base) ? b.top - b.base : 0;
    if (!(height > 0)) height = 0;
    const bb = bboxOf(outer);
    const gx = Math.max(bb.minX, 0, -bb.maxX), gy = Math.max(bb.minY, 0, -bb.maxY);
    out.push({
      index, dist: Math.hypot(gx, gy), cdist: Math.hypot((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2),
      b: { id, name: typeof b.name === "string" ? b.name : "", outer, holes, base: r3(base), height: r3(height), rule: typeof b.rule === "string" && b.rule ? b.rule : "data" },
    });
  });
  let keep = out;
  if (out.length > max) {
    keep = out.slice().sort((p, q) => p.dist - q.dist || p.cdist - q.cdist || p.index - q.index).slice(0, max);
    keep.sort((p, q) => p.index - q.index);
  }
  return keep.map((e) => e.b);
}

function multiPolyData(mp, pl) {
  const out = [];
  for (const poly of Array.isArray(mp) ? mp : []) {
    const p = localPoly(pl, poly);
    if (p) out.push(p);
  }
  return out;
}

function waterData(water, pl, grid, s, c, siteDerived) {
  const areas = [], lines = [];
  const w = isObj(water) ? water : {};
  for (const a of Array.isArray(w.areas) ? w.areas : []) {
    const p = localPoly(pl, a);
    if (!p) continue;
    let level;
    if (fin(a.level)) level = a.level - pl.baseZ;
    else {
      level = Infinity;
      for (const [x, y] of p.outer) level = Math.min(level, zHere(grid, pl, s, c, x, y, 0));
      if (!fin(level)) level = 0;
    }
    areas.push({ outer: p.outer, holes: p.holes, level: r3(level) });
  }
  for (const line of Array.isArray(w.lines) ? w.lines : []) {
    const pts = cleanLine(line);
    if (!pts || pts.length < 2) continue;
    const local = transformRing(pl, pts, "toLocal");
    const dr = drapeRing(siteDerived, pl, local, WATER_LINE_STEP, WATER_LINE_LIFT, false);
    if (!grid.ok) {
      // no ground: keep the line's own z (relative) where it has one, else 0
      const z0 = Array.isArray(line[0]) && fin(line[0][2]) ? line[0][2] - pl.baseZ : 0;
      for (const p of dr) p[2] = r3(z0);
    }
    if (dr.length >= 2) lines.push(dr);
  }
  return { areas, lines };
}

function treesData(list, pl, grid, s, c) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isObj(t) || !fin(t.x) || !fin(t.y)) continue;
    const [x, y] = toLocal(pl, [t.x, t.y]);
    const height = fin(t.height) && t.height > 0 ? t.height : 30;
    let canopy = fin(t.canopy) && t.canopy > 0 ? t.canopy : 20;
    if (canopy > 2 * height) canopy = 2 * height;      // the trunk is height - canopy / 2; never negative
    const z = zHere(grid, pl, s, c, x, y, fin(t.z) ? t.z - pl.baseZ : 0);
    out.push({ x: r3(x), y: r3(y), z: r3(z), canopy: r3(canopy), height: r3(height) });
  }
  return out;
}

/**
 * The whole site layer in a tool's local frame (plan section 3.2).
 * siteDerived: site.derived or null. placement: { x, y, rotation, baseZ }. opts: { contextIds: Set | Array of building
 * ids to skip (already drawn as context blocks), maxBuildings: 2000 }.
 * Returns { ok, reason, bounds, ground, boundary, buildings, roads, walks, water, trees, counts }. ok is false (with a
 * reason) when there is neither a ground grid nor a boundary; `reason` also says why the ground is null when ok is true.
 */
export function buildSiteLayerData(siteDerived, placement, opts = {}) {
  if (!isObj(siteDerived)) return emptyResult("There is no site.");
  const o = isObj(opts) ? opts : {};
  const pl = placementNums(placement);
  const [s, c] = sinCos(pl);
  const grid = gridOf(siteDerived);
  const sb = siteBounds(siteDerived);
  if (!grid.ok && !sb) return emptyResult(grid.reason || "The site has no ground and no boundary.");

  let ground = null, box = null;
  if (grid.ok) ({ ground, box } = groundData(grid, pl));

  let boundary = null;
  if (sb) {
    const local = transformRing(pl, sb.boundary, "toLocal");
    boundary = drapeRing(siteDerived, pl, local, BOUNDARY_STEP, BOUNDARY_LIFT);
    if (boundary.length < 3) boundary = null;
  }
  if (boundary) {
    const b = bboxOf(boundary);
    box = box
      ? { minX: Math.min(box.minX, b.minX), maxX: Math.max(box.maxX, b.maxX), minY: Math.min(box.minY, b.minY), maxY: Math.max(box.maxY, b.maxY), zMin: box.zMin, zMax: box.zMax }
      : { ...b, zMin: 0, zMax: 0 };
  }
  if (!box) return emptyResult("The site has no usable ground and no usable boundary.");
  const bounds = { minX: r3(box.minX), maxX: r3(box.maxX), minY: r3(box.minY), maxY: r3(box.maxY), zMin: r3(box.zMin), zMax: r3(box.zMax) };

  const buildings = buildingsData(siteDerived.buildings, pl, grid, s, c, o);
  const roadsIn = siteDerived.roads;
  const roads = multiPolyData(Array.isArray(roadsIn) ? roadsIn : isObj(roadsIn) ? roadsIn.pavement : null, pl);
  const walksIn = siteDerived.walks !== undefined && siteDerived.walks !== null ? siteDerived.walks : isObj(roadsIn) ? roadsIn.walks : null;
  const walks = multiPolyData(walksIn, pl);
  const water = waterData(siteDerived.water, pl, grid, s, c, siteDerived);
  const trees = treesData(siteDerived.trees, pl, grid, s, c);

  return {
    ok: true,
    reason: grid.ok ? null : grid.reason,
    bounds,
    ground,
    boundary,
    buildings,
    roads,
    walks,
    water,
    trees,
    counts: {
      buildings: buildings.length, roads: roads.length, walks: walks.length, waterAreas: water.areas.length,
      trees: trees.length, groundNodes: ground ? ground.n * ground.n : 0,
    },
  };
}
