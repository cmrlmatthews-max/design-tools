/* ==========================================================================
   SITE: SketchUp export
   Builds the ".sketchup.json" document (docs/sketchup-spec.md section 5) from the
   site model bundle { frame, ground, buildings, roads, trees, water }.
   Pure functions, no DOM. Uses globalThis.ClipperLib (6.4.2), SCALE = 1000.

   Units: feet. Plan (x, y): x = east, y = north, origin = SW corner of the site
   square (the same origin as the Revit CSV and the DXF). Every z in the document
   is the true NAVD88 elevation plus zShift, so the lowest ground node is 0 ft.

   Choices where the spec is silent:
   - Ground triangles: for each cell (i, j) with corners a = (i, j), b = (i+1, j),
     c = (i+1, j+1), d = (i, j+1): triangles (a, b, c) and (a, c, d). The diagonal
     runs from the southwest corner to the northeast corner, the same as the 3D
     view in the page. (The DXF writes the cell as one quad, so it has no diagonal.)
   - The grid can end a little before the site edge (for example 997.5 ft of 1000 ft).
     For draping, the outer cells extend to the site edge on their own plane, so
     roads and the boundary there are not cut off.
   - Roads: the model holds merged pavement (one union), so the draped pieces are
     grouped per pavement piece. Each group is named after the longest road name
     (or class) of the centerlines inside it.
   - Walks (when the model has them) go in a "Walks" group, draped + 0.12 ft.
   - A building solid starts at its base elevation (no 1 ft skirt, unlike the DXF).
   - Draped faces: x and y are rounded to 0.001 ft, z to 0.00001 ft, so each polygon stays flat
     (rounding z to 0.001 ft would bend a quad by up to about 0.001 ft).
   ========================================================================== */

import { cleanRing2, cleanRing3, makeDoc } from "../shared/sketchup-format.js";
import { CREDITS } from "./exports.js";

const K = 1000;                       // Clipper scale: 0.001 ft
const BIG = 100000;                   // ft: "infinity" for the outer cells
const r3 = (v) => Math.round(v * 1000) / 1000;
const C = () => globalThis.ClipperLib;

export const OFFSETS = { road: 0.1, walk: 0.12, centerline: 0.15, stream: 0.1, boundary: 0.2 };

/* ---------------- ground surface (the same two triangles per cell as the mesh) ---------------- */

const clampI = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Cell index along one axis (clamped to 0..n-2). */
function cellOf(arr, d, n, v) { return clampI(Math.floor((v - arr[0]) / d + 1e-9), 0, n - 2); }

/** Elevation of the ground triangle surface at (x, y). Outside the grid the nearest cell plane is extended. */
export function groundZAt(ground, x, y) {
  const { n, xs, ys, z } = ground, d = xs[1] - xs[0], dy = ys[1] - ys[0];
  const i = cellOf(xs, d, n, x), j = cellOf(ys, dy, n, y), o = j * n + i;
  const u = (x - xs[i]) / d, v = (y - ys[j]) / dy;
  const za = z[o], zb = z[o + 1], zc = z[o + n + 1], zd = z[o + n];
  return u >= v ? za + u * (zb - za) + v * (zc - zb) : za + u * (zc - zd) + v * (zd - za);
}

/* ---------------- Clipper plumbing ---------------- */

const pathOf = (ring, ccw) => {
  const p = ring.map((q) => ({ X: Math.round(q[0] * K), Y: Math.round(q[1] * K) }));
  return C().Clipper.Orientation(p) === ccw ? p : p.reverse();
};

function treeToPolys(tree) {
  const out = [];
  const visit = (node) => {
    for (const ch of node.Childs()) {
      if (!ch.IsHole()) {
        const poly = { outer: ch.Contour(), holes: [] };
        for (const h of ch.Childs()) { poly.holes.push(h.Contour()); visit(h); }
        out.push(poly);
      } else visit(ch);
    }
  };
  visit(tree);
  return out;
}

function bboxOf(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) { if (q.X < x0) x0 = q.X; if (q.X > x1) x1 = q.X; if (q.Y < y0) y0 = q.Y; if (q.Y > y1) y1 = q.Y; }
  return [x0, y0, x1, y1];
}

/** Intersection of a path set (outers CCW, holes CW; nonzero) with one convex clip path. */
function clipPaths(clipper, paths, clipPath, asTree) {
  clipper.Clear();
  clipper.AddPaths(paths, C().PolyType.ptSubject, true);
  clipper.AddPath(clipPath, C().PolyType.ptClip, true);
  const nz = C().PolyFillType.pftNonZero;
  const sol = asTree ? new (C().PolyTree)() : [];
  clipper.Execute(C().ClipType.ctIntersection, sol, nz, nz);
  return sol;
}

/* ---------------- draping ---------------- */

/**
 * Drape a plan polygon (with holes) on the ground triangles.
 * The polygon is clipped against every ground triangle it touches; each piece is lifted onto
 * that triangle's plane + offset, so every piece is planar. Nothing is merged.
 * @param outer  [[x,y],…] (any winding)
 * @param holes  [[[x,y],…],…]
 * @param ground { n, xs, ys, z } (z already includes any shift)
 * @param offset ft above the ground
 * @returns {Array<{outer:number[][], holes:number[][][]}>} 3D rings, outer CCW, holes CW, cleaned with cleanRing3
 */
export function drapePolygon(outer, holes, ground, offset = 0) {
  const { n, xs, ys, z } = ground, nc = n - 1, dx = xs[1] - xs[0], dy = ys[1] - ys[0];
  const clipper = new (C().Clipper)();
  const start = [pathOf(outer, true), ...(holes || []).map((h) => pathOf(h, false))];
  const bb = bboxOf(start);
  const results = [];

  const edgeX = (i) => (i <= 0 ? -BIG * K : i >= nc ? BIG * K : Math.round(xs[i] * K));
  const edgeY = (j) => (j <= 0 ? -BIG * K : j >= nc ? BIG * K : Math.round(ys[j] * K));

  // clip to the block of cells [ia..ib] x [ja..jb]; the outer blocks reach out to "infinity"
  function toBlock(paths, ia, ib, ja, jb) {
    const b = bboxOf(paths);
    const xa = edgeX(ia), xb = edgeX(ib + 1), ya = edgeY(ja), yb = edgeY(jb + 1);
    if (b[2] < xa || b[0] > xb || b[3] < ya || b[1] > yb) return [];
    if (b[0] >= xa && b[2] <= xb && b[1] >= ya && b[3] <= yb) return paths;
    return clipPaths(clipper, paths, [{ X: xa, Y: ya }, { X: xb, Y: ya }, { X: xb, Y: yb }, { X: xa, Y: yb }], false);
  }

  function leaf(paths, i, j) {
    const o = j * n + i;
    const za = z[o], zb = z[o + 1], zc = z[o + n + 1], zd = z[o + n];
    const X0 = Math.round(xs[i] * K), Y0 = Math.round(ys[j] * K), dxI = Math.round(dx * K), dyI = Math.round(dy * K);
    const XL = edgeX(i), XR = edgeX(i + 1), YB = edgeY(j), YT = edgeY(j + 1);
    // which sides of the diagonal does the piece touch?
    let pos = false, neg = false;
    for (const p of paths) for (const q of p) {
      const f = (q.X - X0) * dyI - (q.Y - Y0) * dxI;
      if (f > 0) pos = true; else if (f < 0) neg = true;
    }
    for (const side of [1, -1]) {
      if (side === 1 ? !pos : !neg) continue;
      const corners = [[XL, YB], [XR, YB], [XR, YT], [XL, YT]];
      const fv = corners.map((q) => side * ((q[0] - X0) * dyI - (q[1] - Y0) * dxI));
      const tri = [];
      for (let k = 0; k < 4; k++) {
        const p = corners[k], q = corners[(k + 1) % 4], fp = fv[k], fq = fv[(k + 1) % 4];
        if (fp >= 0) tri.push({ X: p[0], Y: p[1] });
        if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); tri.push({ X: Math.round(p[0] + (q[0] - p[0]) * t), Y: Math.round(p[1] + (q[1] - p[1]) * t) }); }
      }
      const clean = tri.filter((p, k) => { const q = tri[(k + 1) % tri.length]; return p.X !== q.X || p.Y !== q.Y; });
      if (clean.length < 3) continue;
      const tree = clipPaths(clipper, paths, clean, true);
      const plane = side === 1
        ? (x, y) => { const u = (x - xs[i]) / dx, v = (y - ys[j]) / dy; return za + u * (zb - za) + v * (zc - zb) + offset; }
        : (x, y) => { const u = (x - xs[i]) / dx, v = (y - ys[j]) / dy; return za + u * (zc - zd) + v * (zd - za) + offset; };
      for (const poly of treeToPolys(tree)) {
        const lift = (path) => path.map((q) => { const x = q.X / K, y = q.Y / K; return [x, y, plane(x, y)]; });
        results.push({ outer: lift(poly.outer), holes: poly.holes.map(lift), plane });
      }
    }
  }

  function rec(paths, i0, i1, j0, j1) {
    if (!paths.length) return;
    if (i0 === i1 && j0 === j1) return leaf(paths, i0, j0);
    if (i1 - i0 >= j1 - j0) {
      const m = (i0 + i1) >> 1;
      rec(toBlock(paths, i0, m, j0, j1), i0, m, j0, j1);
      rec(toBlock(paths, m + 1, i1, j0, j1), m + 1, i1, j0, j1);
    } else {
      const m = (j0 + j1) >> 1;
      rec(toBlock(paths, i0, i1, j0, m), i0, i1, j0, m);
      rec(toBlock(paths, i0, i1, m + 1, j1), i0, i1, m + 1, j1);
    }
  }

  const ci = (X) => cellOf(xs, dx, n, X / K), cj = (Y) => cellOf(ys, dy, n, Y / K);
  rec(start, ci(bb[0]), ci(bb[2]), cj(bb[1]), cj(bb[3]));

  // cleanRing3 rounds x, y and z to 0.001 ft. Rounded z values are not exactly on the triangle plane
  // (a quad can be off by 0.001 ft or more), and SketchUp needs flat faces. So z is set again from the
  // plane at the rounded (x, y), to 0.00001 ft.
  const onPlane = (ring, plane) => ring.map((q) => [q[0], q[1], Math.round(plane(q[0], q[1]) * 1e5) / 1e5]);
  const out = [];
  for (const p of results) {
    const o = cleanRing3(p.outer);
    if (!o) continue;
    out.push({ outer: onPlane(o, p.plane), holes: p.holes.map((h) => cleanRing3(h, { hole: true })).filter(Boolean).map((h) => onPlane(h, p.plane)) });
  }
  return out;
}

/**
 * Drape a polyline on the ground triangles: split at every grid line and triangle diagonal it crosses,
 * and set z from the triangle plane + offset. A closed line must repeat its first point.
 * @param points [[x,y],…] or [[x,y,z],…] (z is ignored)
 * @returns {number[][]} [[x,y,z],…] rounded to 0.001 ft
 */
export function drapeLine(points, ground, offset = 0) {
  const { n, xs, ys } = ground, d = xs[1] - xs[0], dy = ys[1] - ys[0];
  const out = [];
  const push = (x, y) => {
    const p = [r3(x), r3(y), r3(groundZAt(ground, x, y) + offset)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1] || q[2] !== p[2]) out.push(p);
  };
  for (let s = 0; s < points.length; s++) {
    const b = points[s];
    if (s === 0) { push(b[0], b[1]); continue; }
    const a = points[s - 1];
    const ax = a[0], ay = a[1], bx = b[0], by = b[1], ddx = bx - ax, ddy = by - ay;
    const ts = [];
    const add = (t) => { if (t > 1e-9 && t < 1 - 1e-9) ts.push(t); };
    if (ddx !== 0) {                                           // vertical grid lines x = xs[k], k = 1..n-2
      const lo = Math.max(1, Math.ceil((Math.min(ax, bx) - xs[0]) / d - 1e-9)), hi = Math.min(n - 2, Math.floor((Math.max(ax, bx) - xs[0]) / d + 1e-9));
      for (let k = lo; k <= hi; k++) add((xs[k] - ax) / ddx);
    }
    if (ddy !== 0) {                                           // horizontal grid lines y = ys[k]
      const lo = Math.max(1, Math.ceil((Math.min(ay, by) - ys[0]) / dy - 1e-9)), hi = Math.min(n - 2, Math.floor((Math.max(ay, by) - ys[0]) / dy + 1e-9));
      for (let k = lo; k <= hi; k++) add((ys[k] - ay) / ddy);
    }
    if (ddx !== ddy) {                                         // diagonals: (x - xs[0]) - (y - ys[0]) = m * d
      const g0 = ((ax - xs[0]) - (ay - ys[0])) / d, g1 = ((bx - xs[0]) - (by - ys[0])) / d;
      const lo = Math.ceil(Math.min(g0, g1) - 1e-9), hi = Math.floor(Math.max(g0, g1) + 1e-9);
      for (let m = lo; m <= hi; m++) {
        const t = (m - g0) / (g1 - g0);
        if (!(t > 1e-9 && t < 1 - 1e-9)) continue;
        const px = ax + ddx * t, py = ay + ddy * t, i = cellOf(xs, d, n, px), j = cellOf(ys, dy, n, py);
        // keep it only where it is a real diagonal: the cell's own diagonal is u = v
        if (Math.abs((px - xs[i]) / d - (py - ys[j]) / dy) < 1e-7) add(t);
      }
    }
    ts.sort((p, q) => p - q);
    for (const t of ts) push(ax + ddx * t, ay + ddy * t);
    push(bx, by);
  }
  return out;
}

/* ---------------- model → document ---------------- */

const TAGS = [
  { name: "Ground", color: "#a89f8c", visible: true },
  { name: "Buildings", color: "#9aa3ad", visible: true },
  { name: "Roads", color: "#6b6f75", visible: true },
  { name: "Walks", color: "#b9b9b9", visible: true },
  { name: "Road centerlines", color: "#e0b030", visible: false },
  { name: "Water", color: "#4a8fd0", visible: true },
  { name: "Site boundary", color: "#d1453b", visible: true },
];
const MATERIALS = [
  { name: "Ground", color: "#b9b2a0", alpha: 1 },
  { name: "Building", color: "#e8e6e1", alpha: 1 },
  { name: "Pavement", color: "#5f6368", alpha: 1 },
  { name: "Water", color: "#5a9bd5", alpha: 0.85 },
];

/** Drop plan-collinear middle points (the model densifies lines every 10 ft). */
function simplifyLine(line) {
  const out = [];
  for (const p of line) {
    while (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const ux = b[0] - a[0], uy = b[1] - a[1], wx = p[0] - b[0], wy = p[1] - b[1];
      const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
      if (lu > 0 && lw > 0 && Math.abs(ux * wy - uy * wx) / (lu * lw) < 1e-9 && ux * wx + uy * wy > 0) out.pop(); else break;
    }
    out.push(p);
  }
  return out;
}

function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Name for a pavement piece: the road name (or class) with the most centerline length inside it. */
function pieceLabels(pieces, segments) {
  const info = (segments || []).filter((s) => s.line && s.line.length > 1).map((s) => {
    let len = 0;
    for (let i = 1; i < s.line.length; i++) len += Math.hypot(s.line[i][0] - s.line[i - 1][0], s.line[i][1] - s.line[i - 1][1]);
    // the point half way along the line (inside the pavement, away from the square edge)
    let m = s.line[0], run = 0;
    for (let i = 1; i < s.line.length; i++) {
      const a = s.line[i - 1], b = s.line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 0 && run + L >= len / 2) { const t = (len / 2 - run) / L; m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; break; }
      run += L;
    }
    return { x: m[0], y: m[1], len, label: s.name || s.cls || "road", cls: s.cls || "" };
  });
  return pieces.map((p) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p.outer) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const tally = new Map();
    let count = 0;
    for (const s of info) {
      if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
      if (!pointInRing(s.x, s.y, p.outer) || p.holes.some((h) => pointInRing(s.x, s.y, h))) continue;
      count++;
      const t = tally.get(s.label) || { len: 0, cls: s.cls };
      t.len += s.len; tally.set(s.label, t);
    }
    let best = null;
    for (const [label, t] of tally) if (!best || t.len > best.len) best = { label, len: t.len, cls: t.cls };
    return { label: best ? best.label : "Pavement", cls: best ? best.cls : "", count };
  });
}

function facesNode(name, pieces, ground, offset, extra) {
  const polygons = [];
  for (const p of pieces) polygons.push(...drapePolygon(p.outer, p.holes, ground, offset));
  return polygons.length ? { type: "faces", name, ...extra, polygons } : null;
}

/**
 * SketchUp document for a site model.
 * @param model  { frame, ground, buildings, roads, trees, water } from model.js (trees are ignored)
 * @param meta   { address, lat, lon, size, release, date }
 */
export function siteToSketchup(model, meta = {}) {
  const { frame, ground } = model;
  const buildings = model.buildings || [], roads = model.roads || { segments: [], pavement: [], walks: null }, water = model.water || { areas: [], lines: [] };
  const S = frame.size;
  const lat = meta.lat ?? frame.lat0, lon = meta.lon ?? frame.lon0;
  const zShift = Math.round(-ground.min * 100) / 100 || 0;
  const N = Math.abs(zShift).toFixed(2);

  // ground with the shift applied: every z below is true elevation + zShift
  const { n, xs, ys } = ground;
  const gz = new Float64Array(ground.z.length);
  for (let k = 0; k < gz.length; k++) gz[k] = ground.z[k] + zShift;
  const G = { n, spacing: ground.spacing, xs, ys, z: gz };

  // ---- ground mesh
  const vertices = new Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vertices[j * n + i] = [r3(xs[i]), r3(ys[j]), r3(gz[j * n + i])];
  const triangles = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
    triangles.push([a, b, c], [a, c, d]);
  }
  const children = [{ type: "mesh", name: "Ground", tag: "Ground", material: "Ground", vertices, triangles, soft: true, closed: false }];

  // ---- buildings
  const bnodes = [];
  buildings.forEach((b, k) => {
    const outer = cleanRing2(b.ring);
    if (!outer) return;
    const holes = (b.holes || []).map((h) => cleanRing2(h, { hole: true })).filter(Boolean);
    const z0 = r3(b.base + zShift), z1 = r3(z0 + b.height);
    const attributes = { height_ft: Math.round(b.height * 10) / 10, height_rule: b.rule, floors: b.floors, base_navd88_ft: Math.round(b.base * 100) / 100 };
    if (b.source) attributes.height_source = b.source;
    if (b.id && !String(b.id).startsWith("#")) attributes.overture_id = String(b.id);
    if (b.name) attributes.name = b.name;
    bnodes.push({ type: "solid", name: `Building ${String(k + 1).padStart(4, "0")}${b.rule === "estimate" ? " (estimated)" : ""}`, outer, holes, z0, z1, attributes });
  });
  if (bnodes.length) children.push({ type: "group", name: "Buildings", tag: "Buildings", material: "Building", children: bnodes });

  // ---- roads (pavement draped per pavement piece) and walks
  const pavement = roads.pavement || [];
  if (pavement.length) {
    const labels = pieceLabels(pavement, roads.segments);
    const seen = new Map(), rnodes = [];
    pavement.forEach((p, k) => {
      let name = labels[k].label;
      const c = (seen.get(name) || 0) + 1;
      seen.set(name, c);
      if (c > 1) name = `${name} (${c})`;
      const attributes = { segments: labels[k].count };
      if (labels[k].cls) attributes.road_class = labels[k].cls;
      const node = facesNode(name, [p], G, OFFSETS.road, { attributes });
      if (node) rnodes.push(node);
    });
    if (rnodes.length) children.push({ type: "group", name: "Roads", tag: "Roads", material: "Pavement", children: rnodes });
  }
  if (roads.walks && roads.walks.length) {
    const wnodes = [];
    roads.walks.forEach((p, k) => { const node = facesNode(`Walk area ${k + 1}`, [p], G, OFFSETS.walk); if (node) wnodes.push(node); });
    if (wnodes.length) children.push({ type: "group", name: "Walks", tag: "Walks", material: "Pavement", children: wnodes });
  }

  // ---- road centerlines (hidden tag)
  const cl = [];
  for (const s of roads.segments || []) {
    if (!s.line || s.line.length < 2) continue;
    const l = drapeLine(simplifyLine(s.line), G, OFFSETS.centerline);
    if (l.length >= 2) cl.push(l);
  }
  if (cl.length) children.push({ type: "lines", name: "Road centerlines", tag: "Road centerlines", lines: cl });

  // ---- water
  const wchildren = [];
  const polygons = [];
  for (const a of water.areas || []) {
    const zl = r3(a.level + zShift);
    const outer = cleanRing3(a.ring.map((p) => [p[0], p[1], zl]));
    if (!outer) continue;
    polygons.push({ outer, holes: (a.holes || []).map((h) => cleanRing3(h.map((p) => [p[0], p[1], zl]), { hole: true })).filter(Boolean) });
  }
  if (polygons.length) wchildren.push({ type: "faces", name: "Ponds and lakes", polygons });
  const streams = [];
  for (const l of water.lines || []) {
    if (l.length < 2) continue;
    const d = drapeLine(simplifyLine(l), G, OFFSETS.stream);
    if (d.length >= 2) streams.push(d);
  }
  if (streams.length) wchildren.push({ type: "lines", name: "Streams", lines: streams });
  if (wchildren.length) children.push({ type: "group", name: "Water", tag: "Water", material: "Water", children: wchildren });

  // ---- site boundary
  children.push({ type: "lines", name: "Site boundary", tag: "Site boundary", lines: [drapeLine([[0, 0], [S, 0], [S, S], [0, S], [0, 0]], G, OFFSETS.boundary)] });

  const where = meta.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const [oLon, oLat] = frame.toLonLat(0, 0);
  const notes = [
    "Plan origin (0, 0) = the southwest corner of the site square. x = east, y = north (true north). All lengths are in feet.",
    zShift <= 0
      ? `Elevation: every z in this model is the true NAVD88 elevation minus ${N} ft. The lowest ground point is 0 ft. Add ${N} ft to return to NAVD88 elevations.`
      : `Elevation: every z in this model is the true NAVD88 elevation plus ${N} ft. The lowest ground point is 0 ft. Subtract ${N} ft to return to NAVD88 elevations.`,
    `Origin at ${oLat.toFixed(6)}, ${oLon.toFixed(6)} (latitude, longitude). Site size ${S} ft by ${S} ft. Ground grid ${n} by ${n} points, spacing ${ground.spacing} ft.`,
    "Roads, streams, centerlines and the site boundary are draped on the ground triangles. The Road centerlines tag is hidden.",
    "This model is for conceptual design only. Ground is within about 3 ft, building height within 1 floor, building position within 10 ft.",
    CREDITS,
  ];

  const root = {
    type: "group", name: `Site at ${where}`, children,
    attributes: { size_ft: S, ...(meta.release ? { overture_release: String(meta.release) } : {}), ...(meta.date ? { date: String(meta.date) } : {}), ...(meta.address ? { address: String(meta.address) } : {}) },
  };
  const used = (key) => { const set = new Set(); (function walk(nd) { if (nd[key]) set.add(nd[key]); (nd.children || []).forEach(walk); })(root); return set; };
  const usedTags = used("tag"), usedMats = used("material");
  return makeDoc({
    source: "site", name: root.name, location: { lat, lon }, zShift, notes,
    tags: TAGS.filter((t) => usedTags.has(t.name)), materials: MATERIALS.filter((m) => usedMats.has(m.name)), root,
  });
}
