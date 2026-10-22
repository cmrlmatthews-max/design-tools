/* ==========================================================================
   plate/corridor.js — corridor spine, corridor polygon, stairs, corridor graph
   (docs/plate-planner-technical-plan.md sections 3.2, 3.3, 3.4, 3.11 and 4)

   spineFor(plate, level, state)                 → { kind, spine: [[[x,y],[x,y]],…], width, core, warnings }
   corridorPolygon(spine, width, plate)          → MultiPoly (clear corridor, clipped to the plate)
   stairBlocks(kind, spine, plate, state, seeds) → [{ id, outer, door }]
   corridorGraph(spine, stairs, units, opts)     → { lengthFt, stairPathFt, deadEnds: [{ stairId, ft }], doors, nodes, edges, reach(fromPoint, maxFt) }
   GEO                                           shared Clipper and ring helpers (fill.js uses them)

   Pure ES module: no DOM, no Three.js, no hidden state, inputs are never mutated.
   Clipper: globalThis.ClipperLib at SCALE 1000 (0.001 ft). Feet; plan (x, y): x = east, y = north.
   MultiPoly = [{ outer: Ring, holes: [Ring] }], outer counter-clockwise, holes clockwise.

   Rule choices where the plan leaves room:
   - Point corridor: the spine is the ring at core + width ÷ 2, so the clear corridor runs from the core face
     to core + width (section 8.5: corridor outer square ±20.67 for a ±15 core). Section 3.2 also names the
     wall; the section 8 numbers decide (the wall belongs to the units, and there are no units on the core side).
   - Kind "auto": point when the level has a core and no spines (massing or state), else bar.
   - Bar spine without massing spines: a four-corner rectangle takes its long axis through the centroid. Other
     plates look for arms: two facing parallel edges whose band lies inside the plate and is longer than it is deep;
     the arm centerlines extend to the crossing of the next centerline (L, U, O). With no arm, the long axis of the
     minimum-area bounding rectangle through the centroid, clipped to the plate (circles, odd polygons).
   - Massing and typed spines: pieces that share an end point and run straight merge (0.5 degrees).
   - Auto stairs: one at each spine end that touches nothing else (bar, single). A closed spine (an O ring) has no
     ends: two stairs at the middles of its two longest pieces. Point: two stairs inside the core at the ends of its
     long axis. "auto" with massing stair seeds uses the seeds (plan section 7).
   - Stair door: the middle of the stair edge that has clear corridor just outside it; with two such edges, the one
     nearer the plate centroid; with none, the middle of the edge nearest the corridor.
   - Graph: segments split at crossings, junctions, stair-face crossings and door projections. Stair door path =
     the longest of the shortest door-to-door paths. Dead end = for every spine end, the corridor length (spine
     outside stair blocks) to the nearest node that lies on a door-to-door path or is a door. lengthFt = clear
     corridor area ÷ width when opts.corridor and opts.width are given, else the spine length outside stairs.
   - reach(fromPoint, maxFt) → { count, ids, ft: [{ id, ft }] } over the `units` passed in (unit.door or the unit's
     corridor-side middle); distances run along the graph from the projections of both points onto the spine.
   ========================================================================== */

import { cleanRing2 } from "../shared/sketchup-format.js";

const SCALE = 1000;
const EPS = 1e-9;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
const isPt = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const need = (v, fn, name) => { if (v === undefined || v === null) throw new Error(`${fn}: missing input "${name}".`); return v; };

/* ======================================================================= geometry */

function clipper(fn) {
  const C = globalThis.ClipperLib;
  if (!C) throw new Error(`${fn || "plate"}: ClipperLib is not loaded (globalThis.ClipperLib).`);
  return C;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Any of: MultiPoly, one { outer, holes }, a list of rings, one ring → MultiPoly (orientation fixed, nothing else changed). */
function asMP(x) {
  if (!x) return [];
  if (!Array.isArray(x)) return x.outer ? [{ outer: orient(x.outer, false), holes: (x.holes || []).map((h) => orient(h, true)) }] : [];
  if (!x.length) return [];
  if (x[0] && x[0].outer) return x.filter((p) => p && Array.isArray(p.outer) && p.outer.length >= 3).map((p) => ({ outer: orient(p.outer, false), holes: (p.holes || []).filter((h) => h && h.length >= 3).map((h) => orient(h, true)) }));
  if (isPt(x[0])) return x.length >= 3 ? [{ outer: orient(x, false), holes: [] }] : [];
  return x.filter((r) => Array.isArray(r) && r.length >= 3 && isPt(r[0])).map((r) => ({ outer: orient(r, false), holes: [] }));
}

function orient(ring, hole) {
  const pts = ring.filter(isPt).map((p) => [p[0], p[1]]);
  const a = ringArea(pts);
  if ((a > 0) === !!hole) pts.reverse();
  return pts;
}

const toPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
const fromPath = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);
function pathsOf(mp) {
  const out = [];
  for (const pc of asMP(mp)) { out.push(toPath(pc.outer)); for (const h of pc.holes) out.push(toPath(h)); }
  return out;
}

/** PolyTree → MultiPoly with clean rings (0.001 ft, collinear points dropped, slivers under 0.25 sf dropped). */
function fromTree(tree) {
  const out = [];
  const visit = (node) => {
    if (!node.IsHole()) {
      const outer = cleanRing2(fromPath(node.Contour()));
      const holes = [];
      for (const ch of node.Childs()) { const h = cleanRing2(fromPath(ch.Contour()), { hole: true }); if (h) holes.push(h); }
      if (outer) out.push({ outer, holes });
    }
    for (const ch of node.Childs()) for (const g of ch.Childs()) visit(g);
  };
  for (const top of tree.Childs()) visit(top);
  return out;
}

/** Boolean of two shape sets: "union" | "diff" | "int" | "xor". → MultiPoly */
function bool(op, a, b) {
  const C = clipper("bool");
  const clip = new C.Clipper();
  const pa = pathsOf(a), pb = pathsOf(b);
  if (!pa.length) return [];
  clip.AddPaths(pa, C.PolyType.ptSubject, true);
  if (pb.length) clip.AddPaths(pb, C.PolyType.ptClip, true);
  const type = { union: C.ClipType.ctUnion, diff: C.ClipType.ctDifference, int: C.ClipType.ctIntersection, xor: C.ClipType.ctXor }[op];
  if (type === undefined) throw new Error(`bool: unknown operation "${op}".`);
  if (!pb.length && op === "int") return [];
  const tree = new C.PolyTree();
  clip.Execute(type, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return fromTree(tree);
}

const union = (...sets) => bool("union", sets.flatMap((s) => asMP(s)), []);

/** Closed offset of a MultiPoly by `delta` ft (negative = inset), miter joins. */
function offsetMP(mp, delta) {
  const C = clipper("offsetMP");
  const co = new C.ClipperOffset(4, 0.25);
  co.AddPaths(pathsOf(mp), C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  const tree = new C.PolyTree();
  co.Execute(tree, delta * SCALE);
  return fromTree(tree);
}

/** Open-path offset of spine segments by `half` ft, square end caps, miter joins, unioned. */
function offsetSegments(segments, half) {
  const C = clipper("offsetSegments");
  const co = new C.ClipperOffset(4, 0.25);
  for (const s of segments) co.AddPath(toPath(s), C.JoinType.jtMiter, C.EndType.etOpenSquare);
  const tree = new C.PolyTree();
  co.Execute(tree, half * SCALE);
  return fromTree(tree);
}

const mpArea = (mp) => asMP(mp).reduce((s, pc) => s + Math.abs(ringArea(pc.outer)) - pc.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);

function inRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inMP(pt, mp) {
  for (const pc of asMP(mp)) if (inRing(pt, pc.outer) && !pc.holes.some((h) => inRing(pt, h))) return true;
  return false;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function ringsOf(mp) { const out = []; for (const pc of asMP(mp)) { out.push(pc.outer); for (const h of pc.holes) out.push(h); } return out; }
function distToBoundary(p, mp) {
  let d = Infinity;
  for (const r of ringsOf(mp)) for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(p, r[i], r[(i + 1) % r.length]));
  return d;
}

function bboxOf(mp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of ringsOf(mp)) for (const p of r) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
}
const rectRing = (x0, y0, x1, y1) => [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]];
const rr3 = (ring) => ring.map((p) => [r3(p[0]), r3(p[1])]);

function centroidOf(mp) {
  let A = 0, cx = 0, cy = 0;
  for (const r of ringsOf(mp)) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length], f = p[0] * q[1] - q[0] * p[1];
      A += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
    }
  }
  if (Math.abs(A) < EPS) { const b = bboxOf(mp); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
  return [cx / (3 * A), cy / (3 * A)];
}

/** Point at local (s, t) of an axis frame { o, u, n }. */
const at = (fr, s, t) => [fr.o[0] + fr.u[0] * s + fr.n[0] * t, fr.o[1] + fr.u[1] * s + fr.n[1] * t];
/** Axis-aligned rectangle in a frame → ring (counter-clockwise when u × n > 0). */
function frameRect(fr, s0, s1, t0, t1) {
  const ring = [at(fr, s0, t0), at(fr, s1, t0), at(fr, s1, t1), at(fr, s0, t1)];
  return ringArea(ring) < 0 ? ring.reverse() : ring;
}

export const GEO = { SCALE, clipper, asMP, bool, union, offsetMP, offsetSegments, mpArea, ringArea, inMP, inRing, segDist, distToBoundary, bboxOf, rectRing, centroidOf, ringsOf, at, frameRect, rr3, r3 };

/* ======================================================================= state helpers */

function corridorWidth(state) {
  const w = state && state.corridor && state.corridor.width;
  if (isNum(w) && w > 0) return w;
  return state && state.mode === "hotel" ? 6.0 : 5.67;
}
const extWallOf = (state) => (state && isNum(state.extWall) && state.extWall >= 0 ? state.extWall : 1.0);

function coreRingOf(level, state) {
  if (level && Array.isArray(level.core) && level.core.length >= 3) return level.core.map((p) => [p[0], p[1]]);
  const rect = state && state.core && state.core.rect;
  if (Array.isArray(rect) && rect.length === 4 && rect.every(isNum)) return rectRing(...rect);
  return null;
}

const validSegs = (list) => (Array.isArray(list) ? list : []).filter((s) => Array.isArray(s) && s.length >= 2 && isPt(s[0]) && isPt(s[s.length - 1]))
  .flatMap((s) => { const out = []; for (let i = 0; i + 1 < s.length; i++) if (isPt(s[i]) && isPt(s[i + 1]) && Math.hypot(s[i + 1][0] - s[i][0], s[i + 1][1] - s[i][1]) > 0.01) out.push([[s[i][0], s[i][1]], [s[i + 1][0], s[i + 1][1]]]); return out; });

const near = (p, q, tol = 0.01) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
const dirOf = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };

/** Merge spine pieces that share an end point and run straight (0.5 degrees). Duplicates drop. */
function mergeSegments(segs) {
  let list = segs.map((s) => [s[0].slice(), s[1].slice()]);
  const cosTol = Math.cos((0.5 * Math.PI) / 180);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        for (const [ai, bi] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
          if (!near(a[ai], b[bi])) continue;
          const p = a[ai], qa = a[1 - ai], qb = b[1 - bi];
          const da = dirOf(p, qa), db = dirOf(p, qb);
          if (da[0] * db[0] + da[1] * db[1] <= -cosTol) {
            // other pieces that also end here make p a junction: keep it
            const others = list.filter((s, k) => k !== i && k !== j && (near(s[0], p) || near(s[1], p))).length;
            if (others) continue;
            if (ai === 1) list[i] = [a[0], qb]; else list[i] = [qb, a[1]];
            list.splice(j, 1);
            changed = true;
            break outer;
          }
          if (da[0] * db[0] + da[1] * db[1] >= cosTol && near(qa, qb)) { list.splice(j, 1); changed = true; break outer; }
        }
      }
    }
  }
  return list.map((s) => [[r3(s[0][0]), r3(s[0][1])], [r3(s[1][0]), r3(s[1][1])]]);
}

/* ---------- auto bar spine ---------- */

function cleanEdges(ring) {
  const r = cleanRing2(ring) || ring;
  const out = [];
  for (let i = 0; i < r.length; i++) out.push([r[i], r[(i + 1) % r.length]]);
  return out;
}

/** Longest interval of the infinite line through c along u that lies inside the plate, containing c when possible. */
function lineThrough(plate, c, u) {
  const ts = [];
  for (const r of ringsOf(plate)) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const den = u[0] * ey - u[1] * ex;
      if (Math.abs(den) < EPS) continue;
      const wx = a[0] - c[0], wy = a[1] - c[1];
      const t = (wx * ey - wy * ex) / den, k = (wx * u[1] - wy * u[0]) / den;
      if (k >= -EPS && k <= 1 + EPS) ts.push(t);
    }
  }
  ts.sort((p, q) => p - q);
  const uniq = ts.filter((t, i) => !i || t - ts[i - 1] > 1e-6);
  let best = null;
  for (let i = 0; i + 1 < uniq.length; i++) {
    const m = (uniq[i] + uniq[i + 1]) / 2;
    if (!inMP([c[0] + u[0] * m, c[1] + u[1] * m], plate)) continue;
    const cand = [uniq[i], uniq[i + 1]];
    const holds = cand[0] <= 1e-6 && cand[1] >= -1e-6;
    if (!best || (holds && !best.holds) || (holds === best.holds && cand[1] - cand[0] > best.t[1] - best.t[0])) best = { t: cand, holds };
  }
  if (!best) return null;
  return [[c[0] + u[0] * best.t[0], c[1] + u[1] * best.t[0]], [c[0] + u[0] * best.t[1], c[1] + u[1] * best.t[1]]];
}

function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Long axis direction of the minimum-area bounding rectangle (a near-square box, 1.02 or less: east-west). */
function longAxis(plate) {
  const hull = convexHull(ringsOf(plate)[0] || []);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const u = dirOf(hull[i], hull[(i + 1) % hull.length]), n = [-u[1], u[0]];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of hull) { const a = q[0] * u[0] + q[1] * u[1], b = q[0] * n[0] + q[1] * n[1]; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    const ax = (a1 - a0) >= (b1 - b0) - 1e-9 ? u : n;
    const aspect = Math.max(a1 - a0, b1 - b0) / Math.max(1e-9, Math.min(a1 - a0, b1 - b0));
    if (!best || area < best.area * (1 - 1e-9)) best = { area, ax, aspect };
  }
  if (!best || best.aspect <= 1.02) return [1, 0];             // a near-square plate (a circle): east-west
  let [x, y] = best.ax;
  if (x < -1e-9 || (Math.abs(x) <= 1e-9 && y < 0)) { x = -x; y = -y; }
  return [x, y];
}

/** Arms: facing parallel edge pairs with the band inside the plate, longer than deep. → [{ a, b, depth }] centerline pieces */
function armsOf(plate) {
  const edges = [];
  for (const pc of asMP(plate)) {
    for (const e of cleanEdges(pc.outer)) edges.push(e);
    for (const h of pc.holes) for (const e of cleanEdges(h)) edges.push(e);
  }
  const cosTol = Math.cos((0.5 * Math.PI) / 180);
  const arms = [];
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    const u = dirOf(a, b), n = [-u[1], u[0]];            // material on the left (outer CCW, hole CW)
    for (let j = 0; j < edges.length; j++) {
      if (j <= i) continue;
      const [c, d] = edges[j];
      const v = dirOf(c, d);
      if (u[0] * v[0] + u[1] * v[1] > -cosTol) continue;  // antiparallel only
      const depth = (c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1];
      const depth2 = (d[0] - a[0]) * n[0] + (d[1] - a[1]) * n[1];
      if (depth < 1 || Math.abs(depth - depth2) > 0.05) continue;
      const sa = 0, sb = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const sc = (c[0] - a[0]) * u[0] + (c[1] - a[1]) * u[1], sd = (d[0] - a[0]) * u[0] + (d[1] - a[1]) * u[1];
      const lo = Math.max(sa, Math.min(sc, sd)), hi = Math.min(sb, Math.max(sc, sd));
      if (hi - lo <= depth + 0.01) continue;
      const fr = { o: a, u, n };
      const band = frameRect(fr, lo, hi, 0, depth);
      if (mpArea(bool("diff", [band], plate)) > 0.5) continue;
      arms.push({ a: at(fr, lo, depth / 2), b: at(fr, hi, depth / 2), depth, u });
    }
  }
  return arms;
}

function lineCross(p, u, q, v) {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
  return [p[0] + u[0] * t, p[1] + u[1] * t];
}

function barSpine(plate) {
  const pcs = asMP(plate);
  const simpleRect = pcs.length === 1 && !pcs[0].holes.length && (cleanRing2(pcs[0].outer) || []).length === 4;
  if (!simpleRect) {
    const arms = armsOf(plate);
    if (arms.length) {
      const segs = arms.map((m) => [m.a.slice(), m.b.slice()]);
      for (let i = 0; i < arms.length; i++) {
        for (const end of [0, 1]) {
          const p = segs[i][end];
          if (distToBoundary(p, plate) < 0.01) continue;
          let best = null;
          for (let j = 0; j < arms.length; j++) {
            if (j === i) continue;
            const x = lineCross(arms[i].a, arms[i].u, arms[j].a, arms[j].u);
            if (!x) continue;
            const d = Math.hypot(x[0] - p[0], x[1] - p[1]);
            const out = end === 0 ? -1 : 1;                      // only extend outward
            const along = ((x[0] - p[0]) * arms[i].u[0] + (x[1] - p[1]) * arms[i].u[1]) * out;
            if (along < -0.01 || d > Math.max(arms[i].depth, arms[j].depth) + 0.01) continue;
            if (!inMP([(x[0] + p[0]) / 2, (x[1] + p[1]) / 2], plate) && d > 0.01) continue;
            if (!best || d < best.d) best = { d, x };
          }
          if (best) segs[i][end] = best.x;
        }
      }
      return mergeSegments(segs);
    }
  }
  const c = centroidOf(plate);
  const line = lineThrough(plate, c, longAxis(plate));
  return line ? [[[r3(line[0][0]), r3(line[0][1])], [r3(line[1][0]), r3(line[1][1])]]] : [];
}

function singleSpine(plate, side, ext, width) {
  const [x0, y0, x1, y1] = bboxOf(plate);
  const off = ext + width / 2;
  let c, u;
  switch (side) {
    case "north": c = [(x0 + x1) / 2, y1 - off]; u = [1, 0]; break;
    case "east": c = [x1 - off, (y0 + y1) / 2]; u = [0, 1]; break;
    case "west": c = [x0 + off, (y0 + y1) / 2]; u = [0, 1]; break;
    default: c = [(x0 + x1) / 2, y0 + off]; u = [1, 0];
  }
  const line = lineThrough(plate, c, u);
  return line ? [[[r3(line[0][0]), r3(line[0][1])], [r3(line[1][0]), r3(line[1][1])]]] : [];
}

function pointSpine(core, width) {
  const [x0, y0, x1, y1] = bboxOf([core]);
  const h = width / 2;
  const p = [[x0 - h, y0 - h], [x1 + h, y0 - h], [x1 + h, y1 + h], [x0 - h, y1 + h]].map((q) => [r3(q[0]), r3(q[1])]);
  return [[p[0], p[1]], [p[1], p[2]], [p[2], p[3]], [p[3], p[0]]];
}

/**
 * Plan 3.2. plate: MultiPoly; level: a levels.js level (core ring, spines) or null; state: the plate state.
 * → { kind: "bar" | "single" | "point", spine: [[[x,y],[x,y]],…], width, core: Ring | null, warnings }
 */
export function spineFor(plate, level, state) {
  need(plate, "spineFor", "plate"); need(state, "spineFor", "state");
  const P = asMP(plate);
  if (!P.length) throw new Error('spineFor: the input "plate" has no ring.');
  const cor = state.corridor || {};
  const width = corridorWidth(state);
  const core = coreRingOf(level, state);
  const typed = validSegs(cor.spine);
  const massing = validSegs(level && level.spines);
  const warnings = [];
  let kind = cor.kind || "auto";
  if (kind === "auto") kind = core && !typed.length && !massing.length ? "point" : "bar";
  if (kind === "point" && !core) { warnings.push({ code: "point-without-core", severity: "warn", where: {}, message: "A point corridor needs a core. The corridor falls back to a bar." }); kind = "bar"; }
  let spine;
  if (typed.length) spine = mergeSegments(typed);
  else if (massing.length && kind !== "point" && kind !== "single") spine = mergeSegments(massing);
  else if (kind === "point") spine = pointSpine(core, width);
  else if (kind === "single") spine = singleSpine(P, cor.side || "south", extWallOf(state), width);
  else spine = barSpine(P);
  return { kind, spine, width, core, warnings };
}

/** Plan 3.3: the clear corridor. → MultiPoly */
export function corridorPolygon(spine, width, plate) {
  need(spine, "corridorPolygon", "spine"); need(plate, "corridorPolygon", "plate");
  if (!(isNum(width) && width > 0)) throw new Error('corridorPolygon: missing input "width".');
  const segs = validSegs(spine);
  if (!segs.length) return [];
  return bool("int", offsetSegments(segs, width / 2), plate);
}

/* ======================================================================= stairs */

const ringOfBlock = (b) => (b && Array.isArray(b.outer) ? b.outer : b && Array.isArray(b.rect) && b.rect.length === 4 ? rectRing(...b.rect) : Array.isArray(b) && isPt(b[0]) ? b : null);

/** The door of a stair block: the middle of its edge with clear corridor just outside. */
function stairDoor(outer, corridor, plate) {
  const ring = orient(outer, false);
  const c = centroidOf(plate);
  let best = null, nearest = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.01) continue;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];      // CCW ring: right normal points out
    const probe = [m[0] + out[0] * 0.05, m[1] + out[1] * 0.05];
    if (inMP(probe, corridor)) {
      const dc = Math.hypot(m[0] - c[0], m[1] - c[1]);
      if (!best || dc < best.dc - 1e-9) best = { m, dc };
    }
    const dist = corridor.length ? (inMP(probe, corridor) ? 0 : distToBoundary(probe, corridor)) : Infinity;
    if (!nearest || dist < nearest.dist - 1e-9) nearest = { m, dist };
  }
  const p = best ? best.m : nearest ? nearest.m : ring[0];
  return [r3(p[0]), r3(p[1])];
}

/** Degree-1 ends of a spine: [{ p, v }] with v the outward direction. */
function spineEnds(segs) {
  const ends = [];
  segs.forEach((s, i) => {
    for (const k of [0, 1]) {
      const p = s[k];
      const touched = segs.some((t, j) => j !== i && segDist(p, t[0], t[1]) <= 0.01);
      if (!touched) ends.push({ p, v: dirOf(s[1 - k], p) });
    }
  });
  return ends;
}

function rayToBoundary(plate, p, v, maxD) {
  let best = null;
  for (const r of ringsOf(plate)) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const ex = b[0] - a[0], ey = b[1] - a[1], den = v[0] * ey - v[1] * ex;
      if (Math.abs(den) < EPS) continue;
      const wx = a[0] - p[0], wy = a[1] - p[1];
      const t = (wx * ey - wy * ex) / den, k = (wx * v[1] - wy * v[0]) / den;
      if (t >= -1e-6 && t <= maxD && k >= -1e-6 && k <= 1 + 1e-6 && (!best || t < best)) best = t;
    }
  }
  return best;
}

/** Stairs and cabs inside a core rectangle (point plates). → { stairs: [Ring], cabs: (count) → [Ring] } */
export function coreLayout(coreRing, stairSize, cabSize, cabCount, { withStairs = true } = {}) {
  const [x0, y0, x1, y1] = bboxOf([coreRing]);
  const alongX = x1 - x0 >= y1 - y0 - 1e-9;
  const fr = alongX ? { o: [x0, y0], u: [1, 0], n: [0, 1] } : { o: [x0, y0], u: [0, 1], n: [1, 0] };
  const A = alongX ? x1 - x0 : y1 - y0, B = alongX ? y1 - y0 : x1 - x0;
  const [sa, sb] = stairSize;
  const stairs = [];
  let a0 = 0, a1 = A;
  if (withStairs) {
    const t0 = (B - sb) / 2;
    stairs.push(frameRect(fr, 0, sa, t0, t0 + sb), frameRect(fr, A - sa, A, t0, t0 + sb));
    a0 = sa; a1 = A - sa;
  }
  const cabs = [];
  const [ca, cb] = cabSize;
  const avail = Math.max(ca, a1 - a0);
  const per = Math.max(1, Math.floor((avail + 1e-6) / ca));
  const rows = Math.ceil(cabCount / per);
  const fits = cabCount === 0 || (rows * cb <= B + 1e-6 && Math.min(cabCount, per) * ca <= a1 - a0 + 1e-6);
  for (let k = 0; k < cabCount; k++) {
    const row = Math.floor(k / per), inRow = Math.min(per, cabCount - row * per), col = k - row * per;
    const s = a0 + (a1 - a0 - inRow * ca) / 2 + col * ca;
    const t = (B - rows * cb) / 2 + row * cb;
    cabs.push(frameRect(fr, s, s + ca, t, t + cb));
  }
  return { stairs, cabs, fits };
}

/**
 * Plan 3.4 stairs. kind: the corridor kind; spine: segments; plate: MultiPoly; state: the plate state;
 * seeds: massing seeds [{ kind, outer }] (optional). → [{ id, outer, door }]
 */
export function stairBlocks(kind, spine, plate, state, seeds) {
  need(spine, "stairBlocks", "spine"); need(plate, "stairBlocks", "plate"); need(state, "stairBlocks", "state");
  const st = state.stairs || {};
  const size = Array.isArray(st.size) && st.size.length === 2 && st.size.every((v) => isNum(v) && v > 0) ? st.size : [11, 22];
  const mode = st.mode || "auto";
  const stairSeeds = (Array.isArray(seeds) ? seeds : []).filter((s) => s && (s.kind === "stair" || s.kind === "exterior-stair") && ringOfBlock(s));
  const segs = validSegs(spine);
  const width = corridorWidth(state);
  const corridor = segs.length ? corridorPolygon(segs, width, plate) : [];
  let rings = [];
  if (mode === "manual") {
    rings = (Array.isArray(st.items) ? st.items : []).map((it, k) => ({ id: it.id || `S${k + 1}`, ring: ringOfBlock(it) })).filter((x) => x.ring);
  } else if (mode === "seeds" || (mode === "auto" && stairSeeds.length)) {
    rings = stairSeeds.map((s, k) => ({ id: s.id || `S${k + 1}`, ring: ringOfBlock(s), seed: s.kind }));
  } else if (kind === "point") {
    // the core is the spine ring shrunk by half the corridor width
    const [x0, y0, x1, y1] = bboxOf(segs.flat().length ? [segs.map((s) => s[0])] : plate);
    const h = width / 2;
    const core = rectRing(x0 + h, y0 + h, x1 - h, y1 - h);
    rings = coreLayout(core, size, [8, 10], 0).stairs.map((r, k) => ({ id: `S${k + 1}`, ring: r }));
  } else {
    const ends = spineEnds(segs);
    let k = 0;
    for (const { p, v } of ends) {
      let q = p;
      if (distToBoundary(p, plate) > 0.01) {
        const t = rayToBoundary(plate, p, v, size[0]);
        if (t !== null) q = [p[0] + v[0] * t, p[1] + v[1] * t];
      }
      const fr = { o: q, u: [-v[0], -v[1]], n: [v[1], -v[0]] };
      rings.push({ id: `S${++k}`, ring: frameRect(fr, 0, size[0], -size[1] / 2, size[1] / 2) });
    }
    if (!ends.length && segs.length) {
      // a closed spine: the middles of the two longest pieces
      const order = segs.map((s, i) => ({ i, L: Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) })).sort((a, b) => b.L - a.L || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i);
      for (const { i } of order) {
        const s = segs[i], u = dirOf(s[0], s[1]), m = [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2];
        const fr = { o: m, u, n: [-u[1], u[0]] };
        rings.push({ id: `S${++k}`, ring: frameRect(fr, -size[0] / 2, size[0] / 2, -size[1] / 2, size[1] / 2) });
      }
    }
  }
  const out = [];
  for (const { id, ring, seed } of rings) {
    const clipped = bool("int", [ring], plate);
    if (!clipped.length) continue;
    const outer = clipped.length === 1 ? clipped[0].outer : clipped.sort((a, b) => Math.abs(ringArea(b.outer)) - Math.abs(ringArea(a.outer)))[0].outer;
    const rec = { id, outer: rr3(outer), door: stairDoor(outer, corridor, plate) };
    if (seed) rec.seed = seed;
    out.push(rec);
  }
  return out;
}

/* ======================================================================= corridor graph */

function projectOnSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return { t, q: [a[0] + dx * t, a[1] + dy * t], d: Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) };
}

function segCrossT(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < EPS) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
}

/** The graph of a spine with extra points to split at. → { nodes: [[x,y]], edges: [{ a, b, len, inStair }], adj } */
function buildGraph(segs, extra, stairRings) {
  const nodes = [];
  const nodeOf = (p) => {
    for (let i = 0; i < nodes.length; i++) if (near(nodes[i], p, 0.005)) return i;
    nodes.push([p[0], p[1]]);
    return nodes.length - 1;
  };
  const edges = [];
  segs.forEach((s, i) => {
    const ts = [0, 1];
    segs.forEach((o, j) => {
      if (j === i) return;
      const t = segCrossT(s[0], s[1], o[0], o[1]);
      if (t !== null) ts.push(t);
      for (const p of o) { const pr = projectOnSeg(p, s[0], s[1]); if (pr.d <= 0.01) ts.push(pr.t); }
    });
    for (const p of extra) { const pr = projectOnSeg(p, s[0], s[1]); if (pr.d <= 0.01) ts.push(pr.t); }
    for (const ring of stairRings) for (let k = 0; k < ring.length; k++) { const t = segCrossT(s[0], s[1], ring[k], ring[(k + 1) % ring.length]); if (t !== null) ts.push(t); }
    ts.sort((a, b) => a - b);
    const L = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
    for (let k = 0; k + 1 < ts.length; k++) {
      if ((ts[k + 1] - ts[k]) * L < 0.005) continue;
      const p = [s[0][0] + (s[1][0] - s[0][0]) * ts[k], s[0][1] + (s[1][1] - s[0][1]) * ts[k]];
      const q = [s[0][0] + (s[1][0] - s[0][0]) * ts[k + 1], s[0][1] + (s[1][1] - s[0][1]) * ts[k + 1]];
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const a = nodeOf(p), b = nodeOf(q);
      if (a === b) continue;
      if (edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) continue;
      edges.push({ a, b, len: Math.hypot(q[0] - p[0], q[1] - p[1]), inStair: stairRings.some((r) => inRing(m, r)) });
    }
  });
  const adj = nodes.map(() => []);
  edges.forEach((e, k) => { adj[e.a].push(k); adj[e.b].push(k); });
  return { nodes, edges, adj };
}

/** Dijkstra from a node. weight: (edge) → ft. → { dist, prevEdge } */
function dijkstra(g, src, weight) {
  const n = g.nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const k of g.adj[u]) {
      const e = g.edges[k], v = e.a === u ? e.b : e.a, d = dist[u] + weight(e);
      if (d < dist[v] - 1e-9) { dist[v] = d; prev[v] = k; }
    }
  }
  return { dist, prev };
}

function nearestOnSpine(p, segs) {
  let best = null;
  for (const s of segs) { const pr = projectOnSeg(p, s[0], s[1]); if (!best || pr.d < best.d) best = pr; }
  return best ? best.q : p;
}

/**
 * Plan 3.11. spine: segments; stairs: [{ id, outer, door }]; units: [{ id, door?, outer }] (for reach);
 * opts: { corridor: MultiPoly, width } for the corridor length.
 * → { lengthFt, stairPathFt, deadEnds: [{ stairId, ft }], doors: [{ id, at }], nodes, edges, reach(fromPoint, maxFt) }
 */
export function corridorGraph(spine, stairs, units, opts = {}) {
  need(spine, "corridorGraph", "spine");
  const segs = validSegs(spine);
  const st = (Array.isArray(stairs) ? stairs : []).filter((s) => s && Array.isArray(s.outer) && s.outer.length >= 3);
  const stairRings = st.map((s) => orient(s.outer, false));
  const doors = st.map((s) => ({ id: s.id, at: nearestOnSpine(isPt(s.door) ? s.door : centroidOf([s.outer]), segs) }));
  const unitList = Array.isArray(units) ? units : [];
  const unitDoor = (u) => (isPt(u.door) ? u.door : u.outer ? centroidOf([u.outer]) : null);
  const unitPts = unitList.map((u) => { const d = unitDoor(u); return d ? nearestOnSpine(d, segs) : null; });
  const g = buildGraph(segs, [...doors.map((d) => d.at), ...unitPts.filter(Boolean)], stairRings);
  const nodeAt = (p) => { let best = -1, bd = Infinity; g.nodes.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } }); return best; };
  const clear = (e) => (e.inStair ? 0 : e.len);
  const full = (e) => e.len;

  let spineLen = 0;
  for (const e of g.edges) spineLen += clear(e);
  let lengthFt = spineLen;
  if (opts.corridor && isNum(opts.width) && opts.width > 0) {
    const C = stairRings.length ? bool("diff", opts.corridor, stairRings.map((r) => ({ outer: r, holes: [] }))) : asMP(opts.corridor);
    lengthFt = mpArea(C) / opts.width;
  }

  // door-to-door paths
  const doorNodes = doors.map((d) => nodeAt(d.at));
  let stairPathFt = 0;
  const onPath = new Set();
  const runs = doorNodes.map((n) => (n >= 0 ? dijkstra(g, n, full) : null));
  for (let i = 0; i < doorNodes.length; i++) {
    for (let j = i + 1; j < doorNodes.length; j++) {
      const r = runs[i];
      if (!r || doorNodes[j] < 0 || r.dist[doorNodes[j]] === Infinity) continue;
      stairPathFt = Math.max(stairPathFt, r.dist[doorNodes[j]]);
      for (let v = doorNodes[j]; v !== doorNodes[i] && r.prev[v] >= 0;) {
        const e = g.edges[r.prev[v]];
        onPath.add(e.a); onPath.add(e.b);
        v = e.a === v ? e.b : e.a;
      }
    }
  }
  for (const n of doorNodes) if (n >= 0) onPath.add(n);

  // dead ends: from each spine end to the nearest node on a door-to-door path (clear length only)
  const deadEnds = [];
  g.nodes.forEach((p, i) => {
    if (g.adj[i].length !== 1) return;
    if (!doorNodes.length) return;
    const r = dijkstra(g, i, clear);
    let best = null;
    for (const v of onPath) if (r.dist[v] < Infinity && (!best || r.dist[v] < best.ft - 1e-9)) best = { v, ft: r.dist[v] };
    if (!best) return;
    // the stair whose door is nearest that node
    let sid = null, sd = Infinity;
    const rr = dijkstra(g, best.v, full);
    doorNodes.forEach((n, k) => { if (n >= 0 && rr.dist[n] < sd) { sd = rr.dist[n]; sid = doors[k].id; } });
    deadEnds.push({ stairId: sid, ft: Math.round(best.ft * 1000) / 1000, at: [r3(p[0]), r3(p[1])] });
  });

  const reach = (fromPoint, maxFt) => {
    if (!isPt(fromPoint)) throw new Error('reach: missing input "fromPoint".');
    const lim = isNum(maxFt) ? maxFt : Infinity;
    const src = nodeAt(nearestOnSpine(fromPoint, segs));
    const r = src >= 0 ? dijkstra(g, src, full) : null;
    const ft = [];
    unitList.forEach((u, k) => {
      const q = unitPts[k];
      if (!q || !r) return;
      const d = r.dist[nodeAt(q)];
      ft.push({ id: u.id ?? k, ft: d });
    });
    const inside = ft.filter((x) => x.ft <= lim + 1e-9);
    return { count: inside.length, ids: inside.map((x) => x.id), ft };
  };

  return {
    lengthFt: Math.round(lengthFt * 1000) / 1000,
    stairPathFt: Math.round(stairPathFt * 1000) / 1000,
    deadEnds,
    doors: doors.map((d) => ({ id: d.id, at: [r3(d.at[0]), r3(d.at[1])] })),
    nodes: g.nodes.map((p) => [r3(p[0]), r3(p[1])]),
    edges: g.edges.map((e) => ({ a: e.a, b: e.b, len: Math.round(e.len * 1000) / 1000, inStair: e.inStair })),
    reach,
  };
}
