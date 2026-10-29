/* ==========================================================================
   envelope.js — zoning envelope for the tower generator (Agent E)

   Units: feet, square feet. Plan coordinates (x, y); front = -y, back = +y,
   left = -x, right = +x. Elevation z is up.

   Public API (see docs/module-contracts.md):
     allowedFootprint(state, z)
     envelopeWireframe(state, topZ)
     checkEnvelope(state, plates, solids)
   Extra helper: describeFloors(numbers)  (grouped floor text, en-dash ranges)

   Clipper (globalThis.ClipperLib) works in integers; SCALE = 1000 so one
   unit is 0.001 ft. SCALE stays inside this module.

   --- Method notes ---------------------------------------------------------
   Rect site: the allowed footprint is exact:
     x in [-w/2 + left, +w/2 - right], y in [-d/2 + front, +d/2 - back].

   Polygon site (site.points):
     1. Make the ring counter-clockwise and drop duplicate / collinear points.
     2. For every edge compute the OUTWARD normal n = (dy, -dx) / |d|.
        Classify the edge to the side whose axis the normal is closest to:
        front (0,-1), back (0,+1), left (-1,0), right (+1,0), i.e. the
        largest of  -ny, +ny, -nx, +nx.  Ties (exact 45 degrees) resolve in
        the order front, back, left, right.
     3. Move each edge inward along its inward normal by the setback of its
        side. The new vertices are the intersections of adjacent moved edge
        lines (a mitered offset with a different distance per edge).
     4. Resolve self-intersections caused by oversized setbacks: the moved
        ring is intersected with the site ring using the positive fill rule,
        so inverted loops disappear and the result never leaves the site.
   Stepback: above `aboveHeight` the base allowed footprint is offset inward
   by `distance` on all sides (Clipper mitered offset).
   ========================================================================== */

export const SCALE = 1000;

const AREA_TOL = 1;          // sf: a plate is "outside" above this area
const H_TOL = 0.01;          // ft: height tolerance
const STEP_EPS = 1e-6;

const C = () => globalThis.ClipperLib;

/* ---------------- small helpers ---------------- */

function num(v, d = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function ringSignedArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function multiPolyArea(mp) {
  let a = 0;
  for (const poly of mp) {
    a += Math.abs(ringSignedArea(poly.outer));
    for (const h of poly.holes || []) a -= Math.abs(ringSignedArea(h));
  }
  return a;
}

function cloneMultiPoly(mp) {
  return (mp || []).map((p) => ({
    outer: p.outer.map((q) => [q[0], q[1]]),
    holes: (p.holes || []).map((h) => h.map((q) => [q[0], q[1]])),
  }));
}

/* ---------------- Clipper plumbing ---------------- */

const ringToPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
const pathToRing = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

function mpToPaths(mp) {
  const paths = [];
  for (const poly of mp || []) {
    if (poly.outer && poly.outer.length >= 3) paths.push(ringToPath(poly.outer));
    for (const h of poly.holes || []) if (h.length >= 3) paths.push(ringToPath(h));
  }
  return paths;
}

/** Convert a Clipper PolyTree to a MultiPoly (outers CCW, holes CW). */
function treeToMultiPoly(tree) {
  const out = [];
  const ccw = (ring) => (ringSignedArea(ring) < 0 ? ring.slice().reverse() : ring);
  const cw = (ring) => (ringSignedArea(ring) > 0 ? ring.slice().reverse() : ring);
  const visit = (node) => {
    for (const child of node.Childs()) {
      if (!child.IsHole()) {
        const poly = { outer: ccw(pathToRing(child.Contour())), holes: [] };
        for (const hole of child.Childs()) {
          poly.holes.push(cw(pathToRing(hole.Contour())));
          visit(hole);                       // islands inside holes
        }
        if (Math.abs(ringSignedArea(poly.outer)) > 1e-9) out.push(poly);
      } else {
        visit(child);
      }
    }
  };
  visit(tree);
  return out;
}

/** Boolean op on two MultiPolys. EvenOdd fill makes the winding of the inputs irrelevant. */
function boolOp(subj, clip, type, subjFill, clipFill) {
  const L = C();
  const cl = new L.Clipper();
  cl.AddPaths(mpToPaths(subj), L.PolyType.ptSubject, true);
  if (clip) cl.AddPaths(mpToPaths(clip), L.PolyType.ptClip, true);
  const tree = new L.PolyTree();
  cl.Execute(type, tree,
    subjFill || L.PolyFillType.pftEvenOdd,
    clipFill || L.PolyFillType.pftEvenOdd);
  return treeToMultiPoly(tree);
}

/** Area (sf) of subject minus clip, without building a tree. */
function differenceArea(subj, clip) {
  if (!subj.length) return 0;
  const L = C();
  const cl = new L.Clipper();
  cl.AddPaths(mpToPaths(subj), L.PolyType.ptSubject, true);
  if (clip && clip.length) cl.AddPaths(mpToPaths(clip), L.PolyType.ptClip, true);
  const sol = [];
  cl.Execute(L.ClipType.ctDifference, sol, L.PolyFillType.pftEvenOdd, L.PolyFillType.pftEvenOdd);
  let a = 0;
  for (const p of sol) a += L.Clipper.Area(p);       // outers positive, holes negative
  return Math.abs(a) / (SCALE * SCALE);
}

function offsetMultiPoly(mp, delta) {
  const L = C();
  const co = new L.ClipperOffset(10, 0.25);
  co.AddPaths(mpToPaths(mp), L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const tree = new L.PolyTree();
  co.Execute(tree, delta * SCALE);
  return treeToMultiPoly(tree);
}

/* ---------------- site and setbacks ---------------- */

function setbacksOf(state) {
  const sb = (state.site && state.site.setbacks) || {};
  const g = (k) => Math.max(0, num(sb[k], 0));
  return { front: g("front"), back: g("back"), left: g("left"), right: g("right") };
}

/** False when the design has no site (site.shape === "none", "Unlimited"): there is no site ring, no setbacks and no stepback,
 *  and allowedFootprint / envelopeWireframe return []. The height limit (when above 0) still applies. */
export function hasSite(state) {
  return !state || !state.site || state.site.shape !== "none";
}

function usePolygonSite(state) {
  const s = state.site || {};
  return s.shape === "polygon" && Array.isArray(s.points) && s.points.length >= 3;
}

function rectRing(w, d) {
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
}

/** Site ring, counter-clockwise, cleaned of duplicate and collinear points. */
function siteRing(state) {
  const s = state.site || {};
  if (!hasSite(state)) return [];
  if (!usePolygonSite(state)) return rectRing(Math.max(0, num(s.width, 0)), Math.max(0, num(s.depth, 0)));
  let ring = s.points.map((p) => [num(p[0]), num(p[1])]);
  if (ringSignedArea(ring) < 0) ring.reverse();
  // drop duplicates and collinear points (repeat until stable)
  for (let changed = true; changed && ring.length >= 3;) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const dup = Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9;
      if (dup || Math.abs(cross) < 1e-9 * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]))) {
        ring.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return ring;
}

/** Classify an edge by its outward normal: "front" | "back" | "left" | "right". */
function classifyEdge(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len;           // outward normal for a CCW ring
  const scores = [["front", -ny], ["back", ny], ["left", -nx], ["right", nx]];
  let best = scores[0];
  for (const s of scores) if (s[1] > best[1] + 1e-9) best = s;
  return best[0];
}

/** Mitered inward offset of a CCW ring with one distance per edge. */
function offsetRingPerEdge(ring, dist) {
  const n = ring.length;
  const m = ring.map((a, i) => {                  // inward unit normals
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const ea = (i + n - 1) % n, eb = i;           // edges meeting at vertex i
    const ma = m[ea], mb = m[eb], sa = dist[ea], sb = dist[eb], v = ring[i];
    const det = ma[0] * mb[1] - ma[1] * mb[0];
    if (Math.abs(det) < 1e-9) {
      const s = (sa + sb) / 2;
      out.push([v[0] + ma[0] * s, v[1] + ma[1] * s]);
    } else {
      // solve ma.(X - v) = sa,  mb.(X - v) = sb
      const x = (sa * mb[1] - sb * ma[1]) / det;
      const y = (ma[0] * sb - mb[0] * sa) / det;
      out.push([v[0] + x, v[1] + y]);
    }
  }
  return out;
}

/** Base allowed footprint: site minus side setbacks. Returns MultiPoly. */
function baseFootprint(state) {
  if (!hasSite(state)) return [];
  const sb = setbacksOf(state);
  const s = state.site || {};
  if (!usePolygonSite(state)) {
    const w = Math.max(0, num(s.width, 0)), d = Math.max(0, num(s.depth, 0));
    const x0 = -w / 2 + sb.left, x1 = w / 2 - sb.right;
    const y0 = -d / 2 + sb.front, y1 = d / 2 - sb.back;
    if (x1 - x0 <= 1e-9 || y1 - y0 <= 1e-9) return [];
    return [{ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }];
  }
  const ring = siteRing(state);
  if (ring.length < 3) return [];
  const dist = ring.map((a, i) => sb[classifyEdge(a, ring[(i + 1) % ring.length])]);
  const moved = offsetRingPerEdge(ring, dist);
  const L = C();
  const cl = new L.Clipper();
  cl.AddPath(ringToPath(moved), L.PolyType.ptSubject, true);
  cl.AddPath(ringToPath(ring), L.PolyType.ptClip, true);
  const tree = new L.PolyTree();
  cl.Execute(L.ClipType.ctIntersection, tree, L.PolyFillType.pftPositive, L.PolyFillType.pftNonZero);
  return treeToMultiPoly(tree);
}

function stepbackOf(state) {
  const sb = (state.site && state.site.stepback) || {};
  const distance = Math.max(0, num(sb.distance, 0));
  return { on: !!sb.on && distance > 0, aboveHeight: Math.max(0, num(sb.aboveHeight, 0)), distance };
}

function stepFootprint(state, base) {
  const sb = stepbackOf(state);
  return offsetMultiPoly(base, -sb.distance);
}

/* ---------------- public: allowed footprint ---------------- */

/** MultiPoly allowed at elevation z. Stepback applies for z strictly above aboveHeight. */
export function allowedFootprint(state, z) {
  if (!hasSite(state)) return [];
  const base = baseFootprint(state);
  const sb = stepbackOf(state);
  if (sb.on && z > sb.aboveHeight + STEP_EPS) return stepFootprint(state, base);
  return base;
}

/* ---------------- public: wireframe ---------------- */

/** Prisms to draw. Height = heightLimit if set, else topZ. */
export function envelopeWireframe(state, topZ) {
  if (!hasSite(state)) return [];                  // no site: nothing to draw
  const limit = Math.max(0, num(state.site && state.site.heightLimit, 0));
  const top = limit > 0 ? limit : num(topZ, 0);
  if (!(top > 0)) return [];
  const base = baseFootprint(state);
  if (!base.length) return [];
  const sb = stepbackOf(state);
  if (sb.on && sb.aboveHeight < top - STEP_EPS) {
    const out = [];
    if (sb.aboveHeight > 0) out.push({ polygons: base, z0: 0, z1: sb.aboveHeight });
    const step = stepFootprint(state, base);
    if (step.length) out.push({ polygons: step, z0: sb.aboveHeight, z1: top });
    return out;
  }
  return [{ polygons: base, z0: 0, z1: top }];
}

/* ---------------- floor grouping text ---------------- */

/** [31,32,33,34,40] -> "Floors 31–34 and 40"; [5] -> "Floor 5". */
export function describeFloors(numbers) {
  const nums = [...new Set(numbers)].sort((a, b) => a - b);
  if (!nums.length) return "";
  const groups = [];
  for (const n of nums) {
    const g = groups[groups.length - 1];
    if (g && n === g[1] + 1) g[1] = n; else groups.push([n, n]);
  }
  const parts = groups.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  const list = parts.length === 1 ? parts[0]
    : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  return (nums.length === 1 ? "Floor " : "Floors ") + list;
}

function floorWarning(code, floors, verbSingular, verbPlural, tail) {
  floors = [...new Set(floors)];   // several towers: one level number per level
  const text = describeFloors(floors);
  return {
    code, severity: "error", floors: floors.slice().sort((a, b) => a - b),
    message: `${text} ${floors.length === 1 ? verbSingular : verbPlural} ${tail}.`,
  };
}

/* ---------------- public: check ---------------- */

function solidMaxZ(s) {
  if (s.kind === "mesh") {
    let m = -Infinity;
    const p = s.positions || [];
    for (let i = 2; i < p.length; i += 3) if (p[i] > m) m = p[i];
    return m;
  }
  return Math.max(num(s.z0, -Infinity), num(s.z1, -Infinity));
}

function copyPlate(p) {
  return {
    ...p,
    polygons: cloneMultiPoly(p.polygons),
    coreRect: p.coreRect ? p.coreRect.map((q) => [q[0], q[1]]) : p.coreRect,
  };
}

/**
 * @returns {{plates: object[], outside: Map<number, number>, solidsOutside: boolean[], warnings: object[]}}
 */
export function checkEnvelope(state, plates, solids = []) {
  const limit = Math.max(0, num(state.site && state.site.heightLimit, 0));
  const free = !hasSite(state);                     // no site: no setback or stepback checks, only the height limit
  const sb = free ? { on: false, aboveHeight: 0, distance: 0 } : stepbackOf(state);
  const base = free ? [] : baseFootprint(state);
  const step = sb.on ? stepFootprint(state, base) : base;

  const outside = new Map();
  const heightFloors = [], setbackFloors = [], stepbackFloors = [];
  const outPlates = [];

  for (const src of plates || []) {
    const p = copyPlate(src);
    const top = num(p.z, 0) + num(p.ftf, 0);
    // The floor is in the stepback zone if any part of it lies above aboveHeight.
    const stepped = sb.on && top > sb.aboveHeight + H_TOL;
    const allowed = stepped ? step : base;

    const area = free ? 0 : differenceArea(p.polygons, allowed);
    p.outsideEnvelopeArea = area;
    outside.set(p.n, Math.max(outside.get(p.n) || 0, area));   // several towers: plates of one level share n

    if (limit > 0 && top > limit + H_TOL && !heightFloors.includes(p.n)) heightFloors.push(p.n);
    if (area > AREA_TOL) {
      // Which rule? If the plate already breaks the base (setback) footprint it is a setback
      // problem; otherwise it only breaks the stepped footprint.
      const baseOver = stepped ? differenceArea(p.polygons, base) : area;
      if (baseOver > AREA_TOL) setbackFloors.push(p.n); else stepbackFloors.push(p.n);
    }
    outPlates.push(p);
  }

  const solidsOutside = (solids || []).map((s) => limit > 0 && solidMaxZ(s) > limit + H_TOL);

  const warnings = [];
  if (heightFloors.length) warnings.push(floorWarning("height", heightFloors, "exceeds", "exceed", "the height limit"));
  if (setbackFloors.length) warnings.push(floorWarning("setback", setbackFloors, "extends", "extend", "past the setbacks"));
  if (stepbackFloors.length) warnings.push(floorWarning("stepback", stepbackFloors, "extends", "extend", "past the stepback"));
  if (solidsOutside.some(Boolean)) {
    warnings.push({ code: "crown-height", severity: "error", floors: [], message: "The crown exceeds the height limit." });
  }

  return { plates: outPlates, outside, solidsOutside, warnings };
}
