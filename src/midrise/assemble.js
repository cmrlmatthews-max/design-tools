/* ==========================================================================
   assemble.js — mid-rise generator: bars → plates per level (plan section 3)

   Pure ES module. No DOM, no three, no hidden state, no mutation of inputs.
   Clipper through globalThis.ClipperLib at SCALE = 1000 (0.001 ft).
   Units: feet, square feet, degrees. Plan (x, y): north = +y, east = +x.

   Contract (docs/mid-rise-generator-technical-plan.md, section 4):
     assemble(state, { quality = "full" })
       → { quality, levels, spineGraph, joints, courtyards, separation,
           plates, solids, warnings }

   Pipeline (plan 3.3 – 3.8):
     levels      buildingLevels(state) from bars.js; a bar occupies the bar
                 levels P + 1 … P + floors.
     union       one Clipper union per level. Touch rule: offset every leg
                 ring out 0.25 ft (miter, limit 2), union, offset in 0.25 ft
                 (miter, limit 2). Rectangles come back as rectangles.
                 Rings cleaned with cleanRing2: outers CCW, holes CW.
     joints      leg pairs of different bars: overlap ≥ 1 sf or a gap
                 under 0.5 ft. Type from end/through per leg (L, T, cross).
     spine graph nodes = spine ends + joint nodes; edges carry `points`
                 (the polyline, bends included) besides from/to/barId/length.
     courtyards  closed = holes of the union at the lowest bar level;
                 open = state.courts. minDim by rotating calipers.
     separation  pairs of bars with no joint: min ring-to-ring distance.
     envelope    checkEnvelope from src/tower/envelope.js on tower-shaped
                 plates; its warnings are merged into `warnings`.

   quality "draft": no Clipper at all. Each leg ring is its own Poly; no
   joints, no closed courtyards, no separation, no envelope check (the
   envelope's even-odd fill would read overlapping leg rings as holes).
   ========================================================================== */

import { legsOf, legRing, barSpine, buildingLevels, barLevels } from "./bars.js";
import { checkEnvelope, allowedFootprint, hasSite } from "../tower/envelope.js";
import { cleanRing2 } from "../shared/sketchup-format.js";

const SCALE = 1000;
const TOUCH = 0.25;          // ft: half of the 0.5 ft touch gap
const GAP = 0.5;             // ft: a gap under this joins
const MIN_OVERLAP = 1;       // sf: an overlap at or above this joins
const MITER_LIMIT = 2;
const EPS = 1e-6;
const CORNERS = { L: 1, T: 2, cross: 4 };

const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;

function num(v, d = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function need(cond, msg) {
  if (!cond) throw new Error(msg);
}

/* ------------------------------------------------------------ rings */

function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function mpArea(mp) {
  let a = 0;
  for (const p of mp) {
    a += Math.abs(ringArea(p.outer));
    for (const h of p.holes) a -= Math.abs(ringArea(h));
  }
  return a;
}

const ccw = (r) => (ringArea(r) < 0 ? r.slice().reverse() : r.slice());

function rectRing(cx, cy, w, d) {
  const x0 = r3(cx - w / 2), x1 = r3(cx + w / 2), y0 = r3(cy - d / 2), y1 = r3(cy + d / 2);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function emptyBox() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function growBox(b, ring) {
  for (const q of ring) {
    if (q[0] < b.minX) b.minX = q[0];
    if (q[0] > b.maxX) b.maxX = q[0];
    if (q[1] < b.minY) b.minY = q[1];
    if (q[1] > b.maxY) b.maxY = q[1];
  }
  return b;
}

const boxOk = (b) => Number.isFinite(b.minX) && b.maxX >= b.minX && b.maxY >= b.minY;

function boxGap(a, b) {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/* ------------------------------------------------------------ Clipper */

const CL = () => globalThis.ClipperLib;
const toPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
const toRing = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

function ccwPath(ring) {
  const path = toPath(ring);
  if (!CL().Clipper.Orientation(path)) path.reverse();
  return path;
}

/** PolyTree → MultiPoly, every ring cleaned (outer CCW, hole CW). */
function treeToMP(tree) {
  const out = [];
  const visit = (node) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) { visit(child); continue; }
      const outer = cleanRing2(toRing(child.Contour()));
      const holes = [];
      for (const h of child.Childs()) {
        const hr = cleanRing2(toRing(h.Contour()), { hole: true });
        if (hr) holes.push(hr);
        visit(h);                      // islands inside holes
      }
      if (outer) out.push({ outer, holes });
    }
  };
  visit(tree);
  return out;
}

function mpPaths(mp) {
  const paths = [];
  for (const p of mp) {
    paths.push(toPath(p.outer));
    for (const h of p.holes) paths.push(toPath(h));
  }
  return paths;
}

/**
 * The level union with the touch rule: offset out 0.25 ft, union, offset in
 * 0.25 ft. Miter joins (limit 2) on both offsets, never round.
 */
function touchUnion(rings) {
  if (!rings.length) return [];
  const L = CL();
  const grow = new L.ClipperOffset(MITER_LIMIT, 0.25);
  grow.AddPaths(rings.map(ccwPath), L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const mid = [];
  grow.Execute(mid, TOUCH * SCALE);               // offsets each ring and unions them
  const shrink = new L.ClipperOffset(MITER_LIMIT, 0.25);
  shrink.AddPaths(mid, L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const tree = new L.PolyTree();
  shrink.Execute(tree, -TOUCH * SCALE);
  return treeToMP(tree);
}

/** Plain boolean op on path lists → { paths, area } (area in sf). */
function clip(subj, clipPaths, type) {
  const L = CL();
  const c = new L.Clipper();
  c.AddPaths(subj, L.PolyType.ptSubject, true);
  if (clipPaths && clipPaths.length) c.AddPaths(clipPaths, L.PolyType.ptClip, true);
  const sol = [];
  c.Execute(type, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  let a = 0;
  for (const p of sol) a += L.Clipper.Area(p);
  return { paths: sol, area: Math.abs(a) / (SCALE * SCALE) };
}

function intersect(ra, rb) {
  return clip([ccwPath(ra)], [ccwPath(rb)], CL().ClipType.ctIntersection);
}

function offsetRing(ring, delta) {
  const L = CL();
  const co = new L.ClipperOffset(MITER_LIMIT, 0.25);
  co.AddPath(ccwPath(ring), L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const out = [];
  co.Execute(out, delta * SCALE);
  return out;
}

/** Largest piece of a path list as a cleaned Poly, or null. */
function pathsToPoly(paths) {
  let best = null, bestA = 0;
  for (const p of paths) {
    const a = Math.abs(CL().Clipper.Area(p));
    if (a > bestA) { bestA = a; best = p; }
  }
  if (!best) return null;
  const outer = cleanRing2(toRing(best));
  return outer ? { outer, holes: [] } : null;
}

/* ------------------------------------------------------------ distances */

function segDist(a, b, c, d) {
  // segments ab and cd
  if (segCross(a, b, c, d)) return 0;
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
}

function ptSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segCross(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Minimum distance between two rings (0 when they overlap). */
function ringDist(ra, rb) {
  if (pointInRing(ra[0], rb) || pointInRing(rb[0], ra)) return 0;
  let m = Infinity;
  for (let i = 0; i < ra.length; i++) {
    const a = ra[i], b = ra[(i + 1) % ra.length];
    for (let j = 0; j < rb.length; j++) {
      const d = segDist(a, b, rb[j], rb[(j + 1) % rb.length]);
      if (d < m) m = d;
      if (m === 0) return 0;
    }
  }
  return m;
}

/* ------------------------------------------------------------ min dimension */

function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
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
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Shortest side of the minimum-area bounding rectangle (rotating calipers over the hull). */
function minDimension(ring) {
  const hull = convexHull(ring);
  if (hull.length < 3) return 0;
  let bestArea = Infinity, bestMin = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < EPS) continue;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of hull) {
      const s = p[0] * ux + p[1] * uy, t = -p[0] * uy + p[1] * ux;
      if (s < s0) s0 = s; if (s > s1) s1 = s;
      if (t < t0) t0 = t; if (t > t1) t1 = t;
    }
    const w = s1 - s0, h = t1 - t0;
    if (w * h < bestArea - EPS) { bestArea = w * h; bestMin = Math.min(w, h); }
  }
  return bestMin;
}

/* ------------------------------------------------------------ bars */

function barName(bar) {
  return bar.name || `Bar ${bar.id}`;
}

/** Leg spine line (point + unit direction), shifted for single-loaded bars (plan 3.2). */
function legSpineLine(leg, bar, rules) {
  const th = (num(leg.angle) * Math.PI) / 180;
  const ux = Math.cos(th), uy = Math.sin(th);
  let shift = 0;
  if (bar.corridor === "single") {
    const off = num(leg.depth) / 2 - num(rules && rules.corridorWidth, 5.67) / 2;
    shift = bar.unitSide === "right" ? off : -off;    // toward the side opposite the units
  }
  return { px: leg.x0 - uy * shift, py: leg.y0 + ux * shift, ux, uy };
}

function lineMeet(a, b) {
  const den = a.ux * b.uy - a.uy * b.ux;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.px - a.px) * b.uy - (b.py - a.py) * b.ux) / den;
  return [a.px + t * a.ux, a.py + t * a.uy];
}

/** Position of an overlap along a leg: "end" within depth of its start or end, else "through". */
function legPosition(leg, ring) {
  const th = (num(leg.angle) * Math.PI) / 180;
  const ux = Math.cos(th), uy = Math.sin(th);
  let s0 = Infinity, s1 = -Infinity;
  for (const p of ring) {
    const s = (p[0] - leg.x0) * ux + (p[1] - leg.y0) * uy;
    if (s < s0) s0 = s;
    if (s > s1) s1 = s;
  }
  const d = num(leg.depth), L = num(leg.length), tol = 0.01;
  if (s1 <= d + tol || s0 >= L - d - tol) return "end";
  return "through";
}

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const k = p[0] * q[1] - q[0] * p[1];
    a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
  }
  if (Math.abs(a) < EPS) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/* ------------------------------------------------------------ spine graph */

function polyLen(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Closest parameter s along a polyline. */
function projectOn(pts, p) {
  let best = { s: 0, d: Infinity }, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < EPS) continue;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L);
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < best.d) best = { s: acc + t * L, d };
    acc += L;
  }
  return best.s;
}

/** Point at parameter s. */
function pointAt(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= acc + L + EPS || i === pts.length - 1) {
      const t = L > EPS ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      return [r3(a[0] + t * (b[0] - a[0])), r3(a[1] + t * (b[1] - a[1]))];
    }
    acc += L;
  }
  return pts[0].slice();
}

/** Extend a spine to a node that lies beyond its start or end (touch joints, plan 3.5 step 6). */
function extendTo(pts, node) {
  const tol = 0.01;
  const a = pts[0], b = pts[1];
  const L0 = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L0 > EPS) {
    const t = ((node[0] - a[0]) * (b[0] - a[0]) + (node[1] - a[1]) * (b[1] - a[1])) / L0;
    if (t < -tol && ptSeg(node, a, b) > tol) return [node.slice(), ...pts];
  }
  const c = pts[pts.length - 2], d = pts[pts.length - 1];
  const L1 = Math.hypot(d[0] - c[0], d[1] - c[1]);
  if (L1 > EPS) {
    const t = ((node[0] - d[0]) * (d[0] - c[0]) + (node[1] - d[1]) * (d[1] - c[1])) / L1;
    if (t > tol && ptSeg(node, c, d) > tol) return [...pts, node.slice()];
  }
  return pts;
}

function buildSpineGraph(bars, spines, joints) {
  const nodes = [], edges = [], pieces = new Map();   // pieces: barId → [[p, q], …]
  for (const j of joints) nodes.push({ id: j.id, x: j.node[0], y: j.node[1], kind: "joint" });

  for (const bar of bars) {
    let pts = spines.get(bar.id);
    if (!pts || pts.length < 2) continue;
    const mine = joints.filter((j) => j.barIds.includes(bar.id));
    for (const j of mine) pts = extendTo(pts, j.node);
    const total = polyLen(pts);

    // node stops along the spine
    const stops = mine.map((j) => ({ s: projectOn(pts, j.node), id: j.id }));
    const nearStop = (s) => stops.find((q) => Math.abs(q.s - s) < 0.01);
    if (!nearStop(0)) {
      const id = `${bar.id}.start`;
      nodes.push({ id, x: r3(pts[0][0]), y: r3(pts[0][1]), kind: "end" });
      stops.push({ s: 0, id });
    }
    if (!nearStop(total)) {
      const id = `${bar.id}.end`;
      const e = pts[pts.length - 1];
      nodes.push({ id, x: r3(e[0]), y: r3(e[1]), kind: "end" });
      stops.push({ s: total, id });
    }
    stops.sort((a, b) => a.s - b.s);

    // bend parameters (interior vertices)
    const bends = [];
    for (let i = 1, acc = 0; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (i < pts.length - 1) bends.push(acc);
    }

    for (let k = 1; k < stops.length; k++) {
      const s0 = stops[k - 1].s, s1 = stops[k].s;
      if (s1 - s0 < 0.001) continue;
      const cuts = [s0, ...bends.filter((s) => s > s0 + 0.001 && s < s1 - 0.001), s1];
      const points = cuts.map((s) => pointAt(pts, s));
      edges.push({ from: stops[k - 1].id, to: stops[k].id, barId: bar.id, length: r3(s1 - s0), points });
    }

    // drawing pieces: split at every node stop and bend
    const cuts = [...new Set([...stops.map((q) => q.s), ...bends].map((s) => Math.round(s * 1000)))]
      .sort((a, b) => a - b).map((s) => s / 1000);
    const list = [];
    for (let k = 1; k < cuts.length; k++) {
      if (cuts[k] - cuts[k - 1] < 0.001) continue;
      list.push([pointAt(pts, cuts[k - 1]), pointAt(pts, cuts[k])]);
    }
    pieces.set(bar.id, list);
  }
  return { graph: { nodes, edges }, pieces };
}

/* ------------------------------------------------------------ podium, deck, site */

function mpCentroid(mp) {
  let a = 0, cx = 0, cy = 0;
  const add = (ring, sign) => {
    const ra = Math.abs(ringArea(ring));
    const c = ringCentroid(ring);
    a += sign * ra; cx += sign * ra * c[0]; cy += sign * ra * c[1];
  };
  for (const p of mp) { add(p.outer, 1); for (const h of p.holes) add(h, -1); }
  return Math.abs(a) > EPS ? [cx / a, cy / a] : [0, 0];
}

/** Podium plate (plan 3.4). Returns { polygons, warning|null }. */
function podiumPlate(state, barRings, full) {
  const pod = state.podium || {};
  const fp = pod.footprint || {};
  // Without a site (shape "none") there is no allowed footprint, so the podium follows the bars at the offset (0 by default).
  if (fp.mode === "offset" || !hasSite(state)) {
    const b = emptyBox();
    for (const r of barRings) growBox(b, r);
    if (!boxOk(b)) return { polygons: [], warning: null };
    const o = num(fp.offset, 0);
    const ring = [[b.minX - o, b.minY - o], [b.maxX + o, b.minY - o], [b.maxX + o, b.maxY + o], [b.minX - o, b.maxY + o]]
      .map((p) => [r3(p[0]), r3(p[1])]);
    return { polygons: [{ outer: ring, holes: [] }], warning: null };
  }
  // "allowed": the allowed footprint scaled about its centroid so its AREA is `percent` of the allowed area
  const base = allowedFootprint(state, 0);
  if (!base.length) return { polygons: [], warning: null };
  const pct = Math.max(0, num(fp.percent, 100)) / 100;
  if (Math.abs(pct - 1) < 1e-9) return { polygons: base.map((p) => ({ outer: p.outer.map((q) => [r3(q[0]), r3(q[1])]), holes: p.holes.map((h) => h.map((q) => [r3(q[0]), r3(q[1])])) })), warning: null };
  const k = Math.sqrt(pct);
  const [cx, cy] = mpCentroid(base);
  const sc = (ring) => ring.map((q) => [r3(cx + (q[0] - cx) * k), r3(cy + (q[1] - cy) * k)]);
  const scaled = base.map((p) => ({ outer: sc(p.outer), holes: p.holes.map(sc) }));
  if (!full) return { polygons: scaled, warning: null };
  // risk table: a concave footprint can self-intersect; union it with itself and compare areas
  const L = CL();
  const c = new L.Clipper();
  c.AddPaths(mpPaths(scaled), L.PolyType.ptSubject, true);
  const tree = new L.PolyTree();
  c.Execute(L.ClipType.ctUnion, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  const fixed = treeToMP(tree);
  const a0 = mpArea(scaled), a1 = mpArea(fixed);
  const warning = a0 > 0 && Math.abs(a1 - a0) / a0 > 0.01
    ? { code: "podium-shape", severity: "warn", floors: [], message: "The scaled podium footprint overlaps itself; check its shape." }
    : null;
  return { polygons: fixed, warning };
}

/** The site ring (counter-clockwise), or [] when there is no site (shape "none") or its size is 0. */
function siteRing(state) {
  const s = state.site || {};
  if (!hasSite(state)) return [];
  if (s.shape === "polygon" && Array.isArray(s.points) && s.points.length >= 3) {
    return ccw(s.points.map((p) => [num(p[0]), num(p[1])]));
  }
  const w = num(s.width, 0), d = num(s.depth, 0);
  if (!(w > 0 && d > 0)) return [];
  return rectRing(0, 0, w, d);
}

/* ------------------------------------------------------------ assemble */

/**
 * Build the mid-rise from its state (plan sections 3.3 – 3.8).
 * See the header for the return shape. quality "draft" skips every Clipper call.
 */
export function assemble(state, { quality = "full" } = {}) {
  need(state && typeof state === "object", "assemble: state is required");
  need(Array.isArray(state.bars), "assemble: state.bars is required (an array)");
  need(state.site && typeof state.site === "object", "assemble: state.site is required");
  need(state.floors && typeof state.floors === "object", "assemble: state.floors is required");
  const full = quality !== "draft";
  if (full) need(globalThis.ClipperLib, "assemble: globalThis.ClipperLib is required for quality \"full\"");

  const rules = state.rules || {};
  const programs = state.programs || {};
  const site = state.site;
  const warnings = [];

  /* ---- bars, legs, rings ---- */
  const bars = state.bars.filter((b) => b && num(b.floors, 0) >= 1 && num(b.length, 0) > 0 && num(b.depth, 0) > 0);
  const legs = [];                       // { leg, ring, box, bar }
  const legsByBar = new Map();
  const spines = new Map();
  for (const bar of bars) {
    const list = legsOf(bar).map((leg) => {
      const ring = legRing(leg);
      return { leg, ring, box: growBox(emptyBox(), ring), bar };
    });
    legsByBar.set(bar.id, list);
    legs.push(...list);
    spines.set(bar.id, barSpine(bar, rules));
  }

  /* ---- levels (plan 3.3) ---- */
  const base = buildingLevels(state);
  const onLevel = new Map();             // level index → bar ids
  for (const bar of bars) {
    for (const lv of barLevels(bar, state)) {
      if (!onLevel.has(lv.index)) onLevel.set(lv.index, []);
      onLevel.get(lv.index).push(bar.id);
    }
  }

  /* ---- joints (plan 3.5) ---- */
  const joints = [];
  if (full) {
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        const A = legs[i], B = legs[j];
        if (A.bar.id === B.bar.id) continue;            // one bar's legs never join (miter rule)
        if (boxGap(A.box, B.box) >= GAP) continue;
        const ov = intersect(A.ring, B.ring);
        let zone = null;
        if (ov.area >= MIN_OVERLAP) {
          zone = pathsToPoly(ov.paths);
        } else if (ringDist(A.ring, B.ring) < GAP) {
          // touch: the zone is the bridge between the rings grown by the touch offset
          const g = clip(offsetRing(A.ring, TOUCH), offsetRing(B.ring, TOUCH), CL().ClipType.ctIntersection);
          zone = pathsToPoly(g.paths);
        }
        if (!zone) continue;
        const pa = legPosition(A.leg, zone.outer), pb = legPosition(B.leg, zone.outer);
        const type = pa === "end" && pb === "end" ? "L" : pa === "through" && pb === "through" ? "cross" : "T";
        const la = legSpineLine(A.leg, A.bar, rules), lb = legSpineLine(B.leg, B.bar, rules);
        const meet = lineMeet(la, lb) || ringCentroid(zone.outer);
        joints.push({
          id: `J${joints.length + 1}`,
          barIds: [A.bar.id, B.bar.id],
          legs: [A.leg.legIndex, B.leg.legIndex],
          type,
          insideCorners: CORNERS[type],
          zone,
          node: [r3(meet[0]), r3(meet[1])],
        });
      }
    }
  }

  /* ---- spine graph (plan 3.6) ---- */
  const { graph: spineGraph, pieces } = buildSpineGraph(bars, spines, joints);

  /* ---- plates per level (plan 3.4) ---- */
  const allBarRings = legs.map((l) => l.ring);
  const podium = state.podium && state.podium.on ? podiumPlate(state, allBarRings, full) : null;
  if (podium && podium.warning) warnings.push(podium.warning);
  const deck = state.deck && state.deck.on
    ? [{ outer: rectRing(num(state.deck.x), num(state.deck.y), num(state.deck.w), num(state.deck.d)), holes: [] }]
    : [];

  const unionCache = new Map();          // key = sorted bar ids on the level → MultiPoly
  const levels = base.map((lv) => {
    const out = { index: lv.index, zone: lv.zone, z: lv.z, ftf: lv.ftf, program: lv.program,
      plates: [], spines: [], joints: [], cornerZones: [], barIds: [] };
    if (lv.zone === "podium") { out.plates = podium ? podium.polygons : []; return out; }
    if (lv.zone === "deck") { out.plates = deck; return out; }
    const ids = onLevel.get(lv.index) || [];
    out.barIds = ids.slice();
    const rings = ids.flatMap((id) => legsByBar.get(id).map((l) => l.ring));
    if (full) {
      const key = ids.join("\u0001");
      if (!unionCache.has(key)) unionCache.set(key, touchUnion(rings));   // one union per distinct bar set
      out.plates = unionCache.get(key);
    } else {
      out.plates = rings.map((r) => ({ outer: r.map((q) => q.slice()), holes: [] }));
    }
    out.spines = ids.flatMap((id) => (pieces.get(id) || []).map((s) => [s[0].slice(), s[1].slice()]));
    out.joints = joints.filter((j) => ids.includes(j.barIds[0]) && ids.includes(j.barIds[1]));
    out.cornerZones = out.joints.map((j) => j.zone);
    return out;
  });

  /* ---- courtyards (plan 3.7) ---- */
  const courtyards = [];
  const firstBar = levels.find((l) => l.zone === "bar");
  if (full && firstBar) {
    let n = 0;
    for (const p of firstBar.plates) {
      for (const h of p.holes) {
        n++;
        courtyards.push({ kind: "closed", id: `Y${n}`, area: r1(Math.abs(ringArea(h))), minDim: r3(minDimension(h)), ring: ccw(h) });
      }
    }
  }
  for (const c of state.courts || []) {
    const w = num(c.w), d = num(c.d);
    if (!(w > 0 && d > 0)) continue;
    courtyards.push({ kind: "open", id: c.id, area: r1(w * d), minDim: r3(Math.min(w, d)), ring: rectRing(num(c.x), num(c.y), w, d) });
  }
  const cmin = num(site.courtyardMin, 0);
  for (const c of courtyards) {
    if (cmin > 0 && c.minDim < cmin - EPS) {
      const what = c.kind === "closed" ? "Closed courtyard" : `Court ${c.id}`;
      warnings.push({ code: "courtyard", severity: "warn", floors: [],
        message: `${what} is ${fmtFt(c.minDim)} at its narrowest, under the ${fmtFt(cmin)} minimum.` });
    }
  }

  /* ---- separation (plan 3.7) ---- */
  const separation = [];
  if (full) {
    const joined = new Set(joints.map((j) => pairKey(j.barIds[0], j.barIds[1])));
    const smin = num(site.separationMin, 0);
    for (let i = 0; i < bars.length; i++) {
      for (let j = i + 1; j < bars.length; j++) {
        const a = bars[i], b = bars[j];
        if (joined.has(pairKey(a.id, b.id))) continue;
        let m = Infinity;
        for (const la of legsByBar.get(a.id)) for (const lb of legsByBar.get(b.id)) m = Math.min(m, ringDist(la.ring, lb.ring));
        const distance = r3(m);
        separation.push({ barIds: [a.id, b.id], distance });
        if (smin > 0 && distance < smin - EPS) {
          warnings.push({ code: "separation", severity: "warn", floors: [],
            message: `${barName(a)} and ${barName(b)} are ${fmtFt(distance)} apart, under the ${fmtFt(smin)} separation minimum.` });
        }
      }
    }
  }

  /* ---- per-bar warnings: sliver, sharp bend, outside the site, over a court ---- */
  const sRing = full ? siteRing(state) : null;
  const courtPaths = full ? courtyards.filter((c) => c.kind === "open").map((c) => ({ id: c.id, path: toPath(c.ring) })) : [];
  for (const bar of bars) {
    const prog = programs[bar.program] || {};
    const w = num(bar.unitWidth, 0) > 0 ? num(bar.unitWidth) : num(prog.unitWidth, 0);
    if (w > 0 && num(bar.length) < 2 * w - EPS) {
      warnings.push({ code: "sliver", severity: "warn", floors: [], message: `${barName(bar)} is shorter than two units.` });
    }
    if ((bar.bends || []).some((b) => Math.abs(num(b.deg)) > 135)) {
      warnings.push({ code: "bend", severity: "warn", floors: [], message: `${barName(bar)} has a bend sharper than 135 degrees.` });
    }
    if (!full) continue;
    const paths = legsByBar.get(bar.id).map((l) => ccwPath(l.ring));
    if (sRing && sRing.length) {
      const out = clip(paths, [toPath(sRing)], CL().ClipType.ctDifference).area;
      if (out > MIN_OVERLAP) {
        warnings.push({ code: "bar-outside-site", severity: "warn", floors: [], message: `${barName(bar)} extends past the site.` });
      }
    }
    for (const c of courtPaths) {
      const ov = clip(paths, [c.path], CL().ClipType.ctIntersection).area;
      if (ov > MIN_OVERLAP) {
        warnings.push({ code: "bar-over-court", severity: "warn", floors: [], message: `${barName(bar)} overlaps court ${c.id}.` });
      }
    }
  }

  /* ---- envelope (plan 3.8) ---- */
  let plates = levels.map((l) => ({
    n: l.index, zone: l.zone, program: l.program, z: l.z, ftf: l.ftf,
    polygons: l.plates, area: r1(mpArea(l.plates)), coreArea: 0, coreRect: null, outsideEnvelopeArea: 0,
  }));
  const solids = roofSolids(state, levels, legsByBar, bars, full);
  if (full) {
    const env = checkEnvelope(state, plates, solids);
    plates = env.plates;
    for (const wn of env.warnings) {
      warnings.push(wn.code === "crown-height" ? { ...wn, code: "screen-height", message: "The roof screen exceeds the height limit." } : wn);
    }
  }

  return { quality: full ? "full" : "draft", levels, spineGraph, joints, courtyards, separation, plates, solids, warnings };
}

/** Roof screen prisms: one per group of bars that top out on the same level (plan 3.8). */
function roofSolids(state, levels, legsByBar, bars, full) {
  const roof = state.roof || {};
  const h = num(roof.height, 0);
  if (roof.type !== "screen" || !(h > 0)) return [];
  const byLevel = new Map();
  const barLevelsOnly = levels.filter((l) => l.zone === "bar");
  for (const bar of bars) {
    let top = null;
    for (const l of barLevelsOnly) if (l.barIds.includes(bar.id)) top = l;
    if (!top) continue;
    if (!byLevel.has(top.index)) byLevel.set(top.index, { level: top, ids: [] });
    byLevel.get(top.index).ids.push(bar.id);
  }
  const out = [];
  for (const { level, ids } of byLevel.values()) {
    const rings = ids.flatMap((id) => legsByBar.get(id).map((l) => l.ring));
    const polygons = full ? touchUnion(rings) : rings.map((r) => ({ outer: r.map((q) => q.slice()), holes: [] }));
    const z0 = r3(level.z + level.ftf);
    out.push({ kind: "prism", polygons, z0, z1: r3(z0 + h), role: "screen" });
  }
  return out;
}

function pairKey(a, b) {
  return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
}

function fmtFt(v) {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} ft`;
}
