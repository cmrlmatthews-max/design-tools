// Sun hours on flat ground: shadow casters, ground shadows, the node grid and the hours count.
// Source: docs/tower-project-sun-plan.md sections 3.6 and 4.
// Pure ES module: no DOM, no Three.js, inputs never changed. Clipper through globalThis.ClipperLib at SCALE 1000.
// Frames: the grid frame is the project frame when a placement is given, else the tower local frame. In both,
// north is +y and every azimuth is a compass bearing in that frame (0 = north, clockwise).
// Ground is flat at the tower ground floor (plan decision 7): caster heights are above that floor.

import { sunPosition, sunTimes, localToUTC } from "../shared/solar.js";

const SCALE = 1000;
const RAD = Math.PI / 180;

const num = (v, d = 0) => (Number.isFinite(+v) && v !== null && v !== "" ? +v : d);
const CL = () => {
  const c = globalThis.ClipperLib;
  if (!c) throw new Error("sunhours: ClipperLib is not loaded");
  return c;
};

/* --------------------------------------------------------------- rings */

function signedArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** A copy of the ring as [x, y] pairs, without a repeated closing point, with the asked orientation. */
function cleanRing(ring, ccw) {
  if (!Array.isArray(ring)) return [];
  const out = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(+p[0]) || !Number.isFinite(+p[1])) continue;
    const q = [+p[0], +p[1]];
    const last = out[out.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    out.push(q);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  if (out.length < 3) return [];
  const a = signedArea(out);
  if (a === 0) return [];
  if ((a > 0) !== ccw) out.reverse();
  return out;
}

/** Convex test with collinear points allowed (the ring is CCW). */
function isConvexRing(r) {
  const n = r.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n], c = r[(i + 2) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr < -1e-9 * (1 + Math.abs(a[0]) + Math.abs(a[1]))) return false;
  }
  return true;
}

/** Monotone-chain convex hull of [x, y] points → CCW ring. */
function hull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

const toPath = (ring, dx = 0, dy = 0) => ring.map((p) => ({ X: Math.round((p[0] + dx) * SCALE), Y: Math.round((p[1] + dy) * SCALE) }));
const fromPath = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

/* ----------------------------------------------------------- placement */

/** [sin, cos] of degrees, exact for the quarter turns (as src/shared/project.js). */
function sincos(d) {
  const a = ((d % 360) + 360) % 360;
  if (a === 0) return [0, 1];
  if (a === 90) return [1, 0];
  if (a === 180) return [0, -1];
  if (a === 270) return [-1, 0];
  return [Math.sin(a * RAD), Math.cos(a * RAD)];
}

/** Local → project (spec 4): xp = x cos r − y sin r + x0, yp = x sin r + y cos r + y0. Identity without a placement. */
function framer(placement) {
  const p = placement && typeof placement === "object" && placement.placement && typeof placement.placement === "object" ? placement.placement : placement;
  if (!p || typeof p !== "object") return (x, y) => [x, y];
  const px = num(p.x), py = num(p.y), [s, c] = sincos(num(p.rotation));
  if (px === 0 && py === 0 && s === 0 && c === 1) return (x, y) => [x, y];
  return (x, y) => [x * c - y * s + px, x * s + y * c + py];
}

/* -------------------------------------------------------------- casters */

function prismCasters(mp, z0, z1, kind, role, fr) {
  const out = [];
  for (const poly of Array.isArray(mp) ? mp : []) {
    if (!poly) continue;
    const polygon = cleanRing((poly.outer || []).map((q) => fr(+q[0], +q[1])), true);
    if (!polygon.length) continue;
    const holes = (Array.isArray(poly.holes) ? poly.holes : []).map((h) => cleanRing(h.map((q) => fr(+q[0], +q[1])), false)).filter((h) => h.length);
    const c = { polygon, holes, z0, z1, kind, convex: !holes.length && isConvexRing(polygon) };
    if (role) c.role = role;
    out.push(c);
  }
  return out;
}

function meshCaster(solid, fr) {
  const pos = Array.isArray(solid.positions) || ArrayBuffer.isView(solid.positions) ? solid.positions : [];
  const idx = Array.isArray(solid.indices) || ArrayBuffer.isView(solid.indices) ? solid.indices : [];
  if (pos.length < 9 || idx.length < 3) return null;
  const positions = new Array(pos.length);
  let z0 = Infinity, z1 = -Infinity;
  const xy = [];
  for (let i = 0; i < pos.length; i += 3) {
    const [x, y] = fr(+pos[i], +pos[i + 1]);
    positions[i] = x; positions[i + 1] = y; positions[i + 2] = +pos[i + 2];
    xy.push([x, y]);
    z0 = Math.min(z0, +pos[i + 2]); z1 = Math.max(z1, +pos[i + 2]);
  }
  const polygon = hull(xy);
  if (polygon.length < 3) return null;
  // Convex when every vertex lies on one side of every face plane (a spire; a sloped crown on a convex plate).
  const I = Array.from(idx);
  let convex = true;
  for (let f = 0; f + 2 < I.length && convex; f += 3) {
    const A = 3 * I[f], B = 3 * I[f + 1], Cc = 3 * I[f + 2];
    const ux = positions[B] - positions[A], uy = positions[B + 1] - positions[A + 1], uz = positions[B + 2] - positions[A + 2];
    const vx = positions[Cc] - positions[A], vy = positions[Cc + 1] - positions[A + 1], vz = positions[Cc + 2] - positions[A + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) continue;
    let pos = false, neg = false;
    for (let i = 0; i < positions.length; i += 3) {
      const d = (nx * (positions[i] - positions[A]) + ny * (positions[i + 1] - positions[A + 1]) + nz * (positions[i + 2] - positions[A + 2])) / nl;
      if (d > 1e-6) pos = true; else if (d < -1e-6) neg = true;
      if (pos && neg) { convex = false; break; }
    }
  }
  return { polygon, holes: [], z0, z1, kind: "crown", role: solid.role || "crown", convex, mesh: { positions, indices: I } };
}

const ringKey = (mp) => JSON.stringify((mp || []).map((p) => [p.outer, p.holes || []]));

/**
 * Every shadow caster of a tower in the grid frame (plan section 3.6).
 * state: the tower state (context.show, context.blocks); built: buildPlates(state); placement: optional
 * { x, y, rotation, baseZ } (or a section that holds one) → project frame; none → local frame.
 * Stacked plates with the same polygons merge into one caster.
 * → [{ polygon: Ring (CCW), holes: Ring[] (CW), z0, z1, kind: "plate" | "crown" | "context", convex,
 *      role? (crown solids), mesh? ({ positions, indices } for sloped and spire crowns) }]
 */
export function casters(state, built, placement) {
  const fr = framer(placement);
  const out = [];
  const plates = ((built && built.plates) || []).filter((p) => p && !p.void && Array.isArray(p.polygons) && p.polygons.length)
    .slice().sort((a, b) => num(a.z) - num(b.z));
  let run = null;
  const flush = () => { if (run) out.push(...prismCasters(run.mp, run.z0, run.z1, "plate", null, fr)); run = null; };
  for (const p of plates) {
    const z0 = num(p.z), z1 = z0 + num(p.ftf);
    if (!(z1 > z0)) continue;
    const key = ringKey(p.polygons);
    if (run && run.key === key && Math.abs(run.z1 - z0) < 1e-6) { run.z1 = z1; continue; }
    flush();
    run = { key, mp: p.polygons, z0, z1 };
  }
  flush();
  for (const s of (built && built.solids) || []) {
    if (!s) continue;
    if (s.kind === "prism") {
      const z0 = num(s.z0), z1 = num(s.z1);
      if (z1 > z0) out.push(...prismCasters(s.polygons, z0, z1, "crown", s.role || "crown", fr));
    } else if (s.kind === "mesh") {
      const c = meshCaster(s, fr);
      if (c) out.push(c);
    }
  }
  const ctx = state && state.context;
  if (ctx && ctx.show !== false && Array.isArray(ctx.blocks)) {
    for (const b of ctx.blocks) {
      if (!b) continue;
      const w = num(b.w), d = num(b.d), h = num(b.h), x = num(b.x), y = num(b.y), base = num(b.base);
      if (!(w > 0 && d > 0 && h > 0)) continue;
      const ring = [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
      out.push(...prismCasters([{ outer: ring, holes: [] }], base, base + h, "context", null, fr));
    }
  }
  return out;
}

/* -------------------------------------------------------------- shadows */

/** Ground offset per foot of height, pointing away from the sun: v = −(sin A, cos A) / tan h. */
function shadowVector(azimuth, altitude) {
  const t = Math.tan(altitude * RAD);
  return [-Math.sin(azimuth * RAD) / t, -Math.cos(azimuth * RAD) / t];
}

/** Clipper paths (SCALE) of one caster ground shadow; outers CCW, holes CW. */
function shadowPaths(c, v) {
  const C = CL();
  if (c.mesh) {
    const P = c.mesh.positions, I = c.mesh.indices;
    const proj = (k) => [P[3 * k] + P[3 * k + 2] * v[0], P[3 * k + 1] + P[3 * k + 2] * v[1]];
    if (c.convex) {
      const pts = [];
      for (let k = 0; k < P.length / 3; k++) pts.push(proj(k));
      const h = hull(pts);
      return h.length >= 3 ? [toPath(h)] : [];
    }
    const tris = [];
    for (let i = 0; i + 2 < I.length; i += 3) {
      const t = cleanRing([proj(I[i]), proj(I[i + 1]), proj(I[i + 2])], true);
      if (t.length === 3) tris.push(toPath(t));
    }
    const res = [];
    const cl = new C.Clipper();
    cl.AddPaths(tris, C.PolyType.ptSubject, true);
    cl.Execute(C.ClipType.ctUnion, res, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return res;
  }
  const ax = c.z0 * v[0], ay = c.z0 * v[1], bx = c.z1 * v[0], by = c.z1 * v[1];
  const moveless = Math.abs(bx - ax) * SCALE < 0.5 && Math.abs(by - ay) * SCALE < 0.5;
  const holes = c.holes || [];
  if (moveless) return [toPath(c.polygon, ax, ay), ...holes.map((h) => toPath(h, ax, ay))];
  if (c.convex && !holes.length) {
    const pts = [];
    for (const p of c.polygon) { pts.push([p[0] + ax, p[1] + ay]); pts.push([p[0] + bx, p[1] + by]); }
    return [toPath(hull(pts))];
  }
  // The sweep of the rings along the segment, plus the polygon at the segment start (Clipper adds it
  // for closed paths): exactly the region the prism shades.
  const seg = [{ X: Math.round(ax * SCALE), Y: Math.round(ay * SCALE) }, { X: Math.round(bx * SCALE), Y: Math.round(by * SCALE) }];
  return C.Clipper.MinkowskiSum(seg, [toPath(c.polygon), ...holes.map((h) => toPath(h))], true);
}

function unionPaths(paths, tree) {
  const C = CL();
  const cl = new C.Clipper();
  cl.AddPaths(paths, C.PolyType.ptSubject, true);
  const out = tree ? new C.PolyTree() : [];
  cl.Execute(C.ClipType.ctUnion, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}

function treeToMP(tree) {
  const mp = [];
  const walk = (node) => {
    for (const outer of node.Childs()) {
      mp.push({ outer: cleanRing(fromPath(outer.Contour()), true), holes: outer.Childs().map((h) => cleanRing(fromPath(h.Contour()), false)) });
      for (const h of outer.Childs()) walk(h);
    }
  };
  walk(tree);
  return mp.filter((p) => p.outer.length);
}

/**
 * The ground shadow of one caster for a sun direction (plan section 3.6 step 2). Convex rings use the
 * convex hull of the polygon moved by z0·v and z1·v; other rings a Clipper Minkowski sum.
 * → MultiPoly [{ outer (CCW), holes (CW) }]; [] when the sun is at or below the horizon.
 */
export function shadowPolygon(caster, azimuth, altitude) {
  if (!caster || !(altitude > 0)) return [];
  return treeToMP(unionPaths(shadowPaths(caster, shadowVector(azimuth, altitude)), true));
}

/* ----------------------------------------------------------------- grid */

/**
 * The node grid over an extent { minX, minY, maxX, maxY } at `spacing` ft. Node (i, j) sits at
 * (x0 + i·spacing, y0 + j·spacing); index j·nx + i (row-major from the south).
 * → { spacing, n (nodes on the longer side; the side count for a square), nx, ny, x0, y0 }
 */
export function sunGrid(extentBox, spacing) {
  const s = num(spacing, 10) > 0 ? num(spacing, 10) : 10;
  const b = extentBox || {};
  const minX = num(b.minX), minY = num(b.minY);
  const maxX = Math.max(minX, num(b.maxX, minX)), maxY = Math.max(minY, num(b.maxY, minY));
  const nx = Math.floor((maxX - minX) / s + 1e-9) + 1, ny = Math.floor((maxY - minY) / s + 1e-9) + 1;
  return { spacing: s, n: Math.max(nx, ny), nx, ny, x0: minX, y0: minY };
}

/* ------------------------------------------------------------- samples */

/**
 * Sample times for one local date (plan section 3.6): the day from sunrise to sunset cut into `stepMin`
 * intervals; each sample sits at the middle of its interval and carries the interval length `dt`
 * (minutes; the last one is shorter). The dt values add up to the day length. Polar day covers 0 … 1440;
 * polar night gives [].
 * → [{ minutes, azimuth, altitude, dt }]
 */
export function samplesFor(lat, lon, localDate, zoneOrOffset, stepMin) {
  const step = num(stepMin, 30) > 0 ? num(stepMin, 30) : 30;
  const t = sunTimes(lat, lon, localDate, zoneOrOffset);
  let start, end;
  if (t.polar === "night") return [];
  if (t.polar === "day") { start = 0; end = 1440; } else { start = t.sunrise; end = t.sunset; }
  const out = [];
  for (let k = 0; start + k * step < end - 1e-9; k++) {
    const a = start + k * step;
    const dt = Math.min(step, end - a);
    const minutes = a + dt / 2;
    const p = sunPosition(lat, lon, localToUTC(localDate, minutes, zoneOrOffset));
    out.push({ minutes, azimuth: p.azimuth, altitude: p.altitude, dt });
  }
  return out;
}

/* ------------------------------------------------------------ sun hours */

/** Marks the grid nodes inside the even-odd region of `paths` (row scan). */
function rasterize(paths, grid, mask, rows) {
  const { nx, ny, x0, y0, spacing: s } = grid;
  for (let j = 0; j < ny; j++) rows[j].length = 0;
  for (const path of paths) {
    const n = path.length;
    for (let k = 0; k < n; k++) {
      const p = path[k], q = path[(k + 1) % n];
      const ya = p.Y / SCALE, yb = q.Y / SCALE;
      if (ya === yb) continue;
      const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      let j0 = Math.ceil((lo - y0) / s), j1 = Math.ceil((hi - y0) / s) - 1;   // rows with lo ≤ y < hi
      if (j0 < 0) j0 = 0;
      if (j1 > ny - 1) j1 = ny - 1;
      if (j0 > j1) continue;
      const xa = p.X / SCALE, xb = q.X / SCALE, k1 = (xb - xa) / (yb - ya);
      for (let j = j0; j <= j1; j++) rows[j].push(xa + (y0 + j * s - ya) * k1);
    }
  }
  for (let j = 0; j < ny; j++) {
    const r = rows[j];
    if (r.length < 2) continue;
    r.sort((a, b) => a - b);
    const base = j * nx;
    for (let k = 0; k + 1 < r.length; k += 2) {
      let i0 = Math.ceil((r[k] - x0) / s), i1 = Math.ceil((r[k + 1] - x0) / s) - 1;   // lo ≤ x < hi
      if (i0 < 0) i0 = 0;
      if (i1 > nx - 1) i1 = nx - 1;
      for (let i = i0; i <= i1; i++) mask[base + i] = 1;
    }
  }
}

/**
 * Hours of direct sun per grid node (plan section 3.6). Synchronous; the page calls it with a few samples
 * at a time and adds the `hours` arrays. Samples at or below the horizon are skipped.
 * samples: [{ minutes, azimuth, altitude, dt }]; onProgress(done, total) after each sample;
 * shouldStop() checked before each sample.
 * → { hours: Float32Array (nx·ny, hours, row-major from the south), samples (samples counted), cancelled }
 */
export function sunHours(casterList, grid, samples, { onProgress, shouldStop } = {}) {
  const nx = grid.nx, ny = grid.ny, N = nx * ny;
  const acc = new Float64Array(N);
  const mask = new Uint8Array(N);
  const rows = Array.from({ length: ny }, () => []);
  const list = Array.isArray(samples) ? samples : [];
  const cs = Array.isArray(casterList) ? casterList : [];
  let used = 0, cancelled = false;
  for (let k = 0; k < list.length; k++) {
    if (typeof shouldStop === "function" && shouldStop()) { cancelled = true; break; }
    const smp = list[k];
    const dt = num(smp && smp.dt), alt = num(smp && smp.altitude, -1);
    if (alt > 0 && dt > 0) {
      const v = shadowVector(num(smp.azimuth), alt);
      const all = [];
      for (const c of cs) for (const p of shadowPaths(c, v)) all.push(p);
      mask.fill(0);
      if (all.length) rasterize(unionPaths(all, false), grid, mask, rows);
      const h = dt / 60;
      for (let i = 0; i < N; i++) if (!mask[i]) acc[i] += h;
      used++;
    }
    if (typeof onProgress === "function") onProgress(k + 1, list.length);
  }
  return { hours: Float32Array.from(acc), samples: used, cancelled };
}

/* ------------------------------------------------------------- ray cast */

function pointInRing(r, x, y) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function segsCross(p, q, a, b) {
  const d = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = d(a, b, p), d2 = d(a, b, q), d3 = d(p, q, a), d4 = d(p, q, b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function rayHitsTri(o, dir, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < 0 || u > 1) return false;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const w = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) * inv;
  if (w < 0 || u + w > 1) return false;
  return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv > 1e-9;
}

/**
 * The direct ray cast (for tests): is the ground point (x, y) in sun? The ray from the point toward the sun
 * is tested against every caster solid. Sun at or below the horizon → false.
 */
export function isLit(casterList, x, y, azimuth, altitude) {
  if (!(altitude > 0)) return false;
  const t = Math.tan(altitude * RAD);
  const wx = Math.sin(azimuth * RAD) / t, wy = Math.cos(azimuth * RAD) / t;   // ground offset per foot of rise
  for (const c of casterList || []) {
    if (c.mesh) {
      const P = c.mesh.positions, I = c.mesh.indices;
      const o = [x, y, 0], dir = [wx, wy, 1];
      const V = (k) => [P[3 * k], P[3 * k + 1], P[3 * k + 2]];
      for (let i = 0; i + 2 < I.length; i += 3) if (rayHitsTri(o, dir, V(I[i]), V(I[i + 1]), V(I[i + 2]))) return false;
      continue;
    }
    const p = [x + c.z0 * wx, y + c.z0 * wy], q = [x + c.z1 * wx, y + c.z1 * wy];
    const inRegion = (pt) => pointInRing(c.polygon, pt[0], pt[1]) && !(c.holes || []).some((h) => pointInRing(h, pt[0], pt[1]));
    if (inRegion(p) || inRegion(q)) return false;
    for (const r of [c.polygon, ...(c.holes || [])]) {
      for (let i = 0, n = r.length; i < n; i++) if (segsCross(p, q, r[i], r[(i + 1) % n])) return false;
    }
  }
  return true;
}
