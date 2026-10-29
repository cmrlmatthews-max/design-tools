/* ==========================================================================
   geometry.js — tower geometry + metrics (Agent G, phases 3 and 4)

   Contract: docs/module-contracts.md. Behavior: tower-generator-technical-plan.md
   sections 2, 3, 5 and 6. Pure functions only: no DOM, no Three.js, no hidden
   state, no mutation of inputs.

   Units: feet, square feet, degrees. Plan coordinates (x, y): north = +y.
   front = south (-y), back = north (+y), left = west (-x), right = east (+x).

   Clipper: globalThis.ClipperLib, integers at SCALE = 1000 (0.001 ft). Clipper
   is only used where it is needed (non-convex offsets, carves, non-convex
   half-plane clips). Rotations, translations, scaling and
   convex clips are done in floating point, so simple cases are exact.

   ---- Rule choices where the plan leaves room (documented on purpose) -------
   SHAPES
   - circle: diameter = shape.w (shape.d when w is 0). ellipse: axes w x d.
   - Curved edges use an EQUAL-AREA polygon: vertices sit on a radius scaled by
     k so the polygon area equals the true curve area exactly (circle 96 seg:
     k = 1.000357; rounded corner, 8 seg: interior points k = 1.003683, end
     points stay on the straight edges). GFA of a circle is exactly pi r^2.
   - square: side = shape.w (shape.d when w is 0). Corner radius allowed.
   - rect / square: radius clamped to min(w, d) / 2, 8 segments per corner.
   - triangle: base w on the front (-y) side, apex at the back centre, depth d.
   - L: w x d bounding box; one arm along the front (-y) edge and one along the
     left (-x) edge, both `arm` wide. Area = w*a + (d - a)*a.
   - U: w x d bounding box, open to the back (+y). Base along the front edge,
     arms on the left and right, all `arm` wide. Area = w*d - (w - 2a)(d - a).
   - arm default = 40% of min(w, d). If arm >= the size that closes the shape
     the result is the full rectangle. Corner radius is ignored for L and U.
   - polygon / custom: shape.points as given (not re-centred), made
     counter-clockwise; self-intersections are resolved with a Clipper union.
   SETBACKS
   - setback.floor is the global floor number (podium floors and mechanical
     floors count). A setback applies to TOWER floors n >= floor, in every
     segment above it. Distances accumulate.
   - A setback whose sides list all four sides (or is empty / missing / "all")
     is an all-sides inward offset (miter join; rectangles stay rectangles).
     Any other side list cuts the shape with a straight line on each listed
     side, in the segment's local frame (after taper, before rotation). The
     line sits at that side's bounding-box edge of the tapered shape, moved
     inward by (all-sides total + that side's total).
   MECHANICAL FLOORS
   - A mechanical floor copies the plate of the floor below it BEFORE that
     floor's carves and cuts, then gets the carves and cuts whose range holds
     the mechanical floor's own number.
   CARVES (applied to every zone in the floor range, after translation)
   - corner: w x d rectangle at the NE/NW/SE/SW corner of the floor's own
     bounding box, world frame (after rotation and translation).
   - center: w x d rectangle, world-axis-aligned, centred on the plate's area
     centroid. It makes a hole (or splits the plate if it crosses an edge).
   - full: a sky gap. The floor stays in the plate list as a void plate
     (void: true, polygons [], area 0, coreArea 0). It adds no GFA and no floor
     to floorCount, but it keeps its floor-to-floor height, so every floor
     above stays at the same elevation and total height does not change.
   CUTS (applied to every zone in the floor range, after carves)
   - Depth rule (angle is not used for geometry): the cut is a true plane. It
     touches the reference edge at the floor surface of startFloor and is
     `depth` ft inside that edge at the floor surface of endFloor (endFloor is
     clamped to the top floor). At floor n:
        cutDepth(n) = depth * (z_n - z_start) / (z_end - z_start)
     so startFloor loses 0 ft and endFloor loses `depth` ft. With one floor in
     the range the full depth applies. The reference edge is the bounding-box
     edge on that side of the first floor in the range that has geometry
     (before carves and cuts), so the plane does not follow taper or twist.
     The effective angle from vertical is atan(depth / (z_end - z_start)).
   CORE
   - The Tower Generator makes no core (October 24, 2026). The Plate Planner sets
     the core and the efficiency. Every plate still carries coreRect: null and
     coreArea: 0 so readers of those fields do not break. A saved `core` key in
     an old state is ignored here (the page's store drops it).
   CROWN
   - Sits on the highest non-void plate; base elevation = top of all floors.
   - flat: 4 ft parapet ring, 1 ft thick. Adds no height.  none: nothing.
   - stepped: `steps` prisms, each h/steps tall, inset i * s where
     s = min(8% of min(W, D), min(W, D) / (2 (steps + 1))).
   - sloped: mesh, the top plate cut by one plane; 0 ft at the slopeSide edge,
     crown.height at the opposite edge.
   - spire: cone mesh at the top plate centroid, radius max(1, 6% of min(W,D)).
   - screen: top plate minus a 1 ft inward offset, extruded to crown.height.
   - Non-flat crowns add crown.height to total height. Crowns add no GFA.
   TOWERS (several towers on one podium, October 29, 2026)
   - A segment's optional `tower` (whole number, default 0) names its tower. Segments of one tower stack bottom up in
     list order. The lowest tower index present is the lead tower (Tower 1).
   - Shared levels: the lead tower stacks as a one-tower design always has (its floors, floor-to-floor and mechanical
     floors). Every other tower sits on the same base (podium top or ground); its i-th floor takes the i-th level above
     the podium (that level's n, z and ftf; the tower's own ftf is ignored). Above the lead tower's top the levels go on
     at the lead tower's top floor-to-floor (its last segment's ftf).
   - Floors and plates: one entry per tower per level, sorted by n, then the lead first, then by tower index. Entries
     of one level share n (the level number), z and ftf; each keeps its program, segmentIndex (flat index into
     state.segments) and `tower` (-1 for podium floors and mechanical floors on the podium). Setbacks and carves by n
     apply to every tower at that level; a cut's reference edge is taken per tower; mechanical floors belong to the
     lead tower and copy the plate below them in that tower.
   - Crown: every tower gets the same crown on its own top plate, at the top of its own floors. Crown solids carry
     `tower`.
   - One tower (no `tower` keys): the floor list, plates, crown and metrics are the same as before, plus `tower` fields.
   METRICS
   - Several towers: GFA and the areas sum every plate; floorCount, voidFloors, levelCount and floorsByZone count
     distinct levels (podium + the tallest tower); floor1Area sums the plates of level 1; topOfFloors is the top of the
     tallest tower. byProgram counts plates (a level of two residential towers is 2 residential floors).
   - netArea = GFA - mechanicalArea (sum of the area of non-mechanical plates).
     It is "before core": no core is taken out. coreArea is always 0. There is
     no efficiency metric; the Plate Planner computes it.
   - unitFactor may be a fraction (0.85) or a percent (85); values > 1 are
     read as percent.
   ========================================================================== */

export const SCALE = 1000;

const MAX_FLOORS = 400;           // same cap as the shell's CONFIG.limits.maxFloors
const MAX_DIM = 5000;             // ft, cap on any plan dimension
const AREA_EPS = 1e-6;            // sf, a plate below this is empty
const MIN_RING_AREA = 1e-4;       // sf, Clipper output rings below this are dropped
const PARAPET_HEIGHT = 4;         // ft
const RING_THICKNESS = 1;         // ft, parapet and screen ring thickness
const CORNER_SEGMENTS = 8;        // per rounded corner
const MITER_LIMIT = 4;

/* Program defaults, plan section 6. Used when state.programs is empty or misses a key.
   unitFactor is a fraction here; the shell stores percent. Both are accepted. */
export const PROGRAM_DEFAULTS = {
  residential: { ftf: 10,   unitSize: 850, unitFactor: 0.85 },
  hotel:       { ftf: 10,   unitSize: 400, unitFactor: 0.80 },
  office:      { ftf: 13.5, unitSize: 0,   unitFactor: 0 },
  retail:      { ftf: 18,   unitSize: 0,   unitFactor: 0 },
  amenity:     { ftf: 15,   unitSize: 0,   unitFactor: 0 },
  parking:     { ftf: 10.5, unitSize: 350, unitFactor: 1.00 },
  mechanical:  { ftf: 16,   unitSize: 0,   unitFactor: 0 },
};

/* ---------------------------------------------------------------- helpers */

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const curveOf = (t, kind) => (kind === "eased" ? t * t * (3 - 2 * t) : t);
const DEG = Math.PI / 180;

function warn(code, floors, message, severity = "warn") {
  return { code, severity, floors: floors.slice().sort((a, b) => a - b), message };
}

/* --------------------------------------------------------------- areas */

/** Signed shoelace area of one ring (positive when counter-clockwise). */
export function ringArea(ring) {
  let a = 0;
  const n = ring ? ring.length : 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[i + 1 === n ? 0 : i + 1];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Area of a MultiPoly: outers minus holes. */
export function multiPolyArea(mp) {
  let a = 0;
  for (const p of mp || []) {
    a += Math.abs(ringArea(p.outer));
    for (const h of p.holes || []) a -= Math.abs(ringArea(h));
  }
  return a;
}

function mpCentroid(mp) {
  let A = 0, cx = 0, cy = 0;
  const add = (ring, sign) => {
    const s = Math.sign(ringArea(ring)) * sign;   // outer counts +, hole counts -
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      const c = (p[0] * q[1] - q[0] * p[1]) * s;
      A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
    }
  };
  for (const p of mp) { add(p.outer, 1); for (const h of p.holes || []) add(h, -1); }
  if (Math.abs(A) < 1e-12) return [0, 0];
  return [cx / (3 * A), cy / (3 * A)];
}

function mpBounds(mp) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of mp) for (const q of p.outer) {
    if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
    if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
  }
  return { minX, minY, maxX, maxY };
}

const ccw = (ring) => (ringArea(ring) < 0 ? ring.slice().reverse() : ring);
const cw = (ring) => (ringArea(ring) > 0 ? ring.slice().reverse() : ring);

function dedupe(ring, eps = 1e-9) {
  const out = [];
  for (const p of ring) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l[0] - p[0]) > eps || Math.abs(l[1] - p[1]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps) out.pop(); else break;
  }
  return out;
}

function isConvexRing(ring) {
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], c = ring[(i + 2) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr < -1e-9) return false;
  }
  return true;
}
const isSimpleConvex = (mp) => mp.length === 1 && !(mp[0].holes && mp[0].holes.length) && isConvexRing(mp[0].outer);

function mapMP(mp, f) {
  return mp.map((p) => ({ outer: p.outer.map(f), holes: (p.holes || []).map((h) => h.map(f)) }));
}
function cloneMP(mp) { return mapMP(mp, (q) => [q[0], q[1]]); }

/* --------------------------------------------------------------- Clipper */

function CL() {
  const L = globalThis.ClipperLib;
  if (!L) throw new Error("geometry.js: globalThis.ClipperLib is not loaded");
  return L;
}
function ringToPath(r) {
  const p = new Array(r.length);
  for (let i = 0; i < r.length; i++) p[i] = { X: Math.round(r[i][0] * SCALE), Y: Math.round(r[i][1] * SCALE) };
  return p;
}
const pathToRing = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);
function mpToPaths(mp) {
  const out = [];
  for (const p of mp) { out.push(ringToPath(p.outer)); for (const h of p.holes || []) out.push(ringToPath(h)); }
  return out;
}
function treeToMP(tree) {
  const out = [];
  const visitOuter = (node) => {
    const outer = ccw(pathToRing(node.Contour()));
    const holes = [];
    for (const h of node.Childs()) {
      const hr = cw(pathToRing(h.Contour()));
      if (hr.length >= 3 && Math.abs(ringArea(hr)) > MIN_RING_AREA) holes.push(hr);
      for (const island of h.Childs()) visitOuter(island);
    }
    if (outer.length >= 3 && Math.abs(ringArea(outer)) > MIN_RING_AREA) out.push({ outer, holes });
  };
  for (const n of tree.Childs()) visitOuter(n);
  return out;
}
/** op: "int" | "diff" | "union". Subject uses even-odd (holes need no orientation), clip non-zero. */
function boolOp(mp, clipRings, op) {
  const L = CL();
  const c = new L.Clipper();
  c.StrictlySimple = true;   // pieces that touch along an edge or a point come out separate
  c.AddPaths(mpToPaths(mp), L.PolyType.ptSubject, true);
  if (clipRings.length) c.AddPaths(clipRings.map(ringToPath), L.PolyType.ptClip, true);
  const type = op === "int" ? L.ClipType.ctIntersection : op === "diff" ? L.ClipType.ctDifference : L.ClipType.ctUnion;
  const tree = new L.PolyTree();
  c.Execute(type, tree, op === "union" ? L.PolyFillType.pftNonZero : L.PolyFillType.pftEvenOdd, L.PolyFillType.pftNonZero);
  if (op === "union") return treeToMP(tree);
  // clipper-lib 6.4.2 can return pieces joined by a zero-width bridge along a shared
  // collinear edge (area right, topology wrong). A second StrictlySimple union pass
  // splits them into separate pieces.
  const paths = [];
  const walk = (node) => { for (const ch of node.Childs()) { paths.push(ch.Contour()); walk(ch); } };
  walk(tree);
  if (!paths.length) return [];
  const c2 = new L.Clipper();
  c2.StrictlySimple = true;
  c2.AddPaths(paths, L.PolyType.ptSubject, true);
  const tree2 = new L.PolyTree();
  c2.Execute(L.ClipType.ctUnion, tree2, L.PolyFillType.pftEvenOdd, L.PolyFillType.pftEvenOdd);
  return treeToMP(tree2);
}
function clipperOffset(mp, delta) {
  const L = CL();
  const co = new L.ClipperOffset(MITER_LIMIT, 0.25 * SCALE);
  co.AddPaths(mpToPaths(mp), L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const tree = new L.PolyTree();
  co.Execute(tree, delta * SCALE);
  return treeToMP(tree);
}

/* ------------------------------------------------- half-planes and offsets */

/** Sutherland-Hodgman: keep a*x + b*y >= c of a convex ring. */
function clipRingHalf(ring, a, b, c) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[i + 1 === n ? 0 : i + 1];
    const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      const x = p[0] + t * (q[0] - p[0]), y = p[1] + t * (q[1] - p[1]);
      // exact coordinate on axis-aligned lines
      out.push(a === 0 ? [x, c / b] : b === 0 ? [c / a, y] : [x, y]);
    }
  }
  return dedupe(out);
}

/**
 * Keep the part of mp on the inner side of an axis-aligned line.
 * side "front": keep y >= v · "back": y <= v · "left": x >= v · "right": x <= v.
 */
function clipSide(mp, side, v) {
  if (!mp.length) return mp;
  const b = mpBounds(mp);
  const [lo, hi] = side === "front" ? [b.minY, b.maxY] : side === "back" ? [-b.maxY, -b.minY]
    : side === "left" ? [b.minX, b.maxX] : [-b.maxX, -b.minX];
  const vv = side === "back" || side === "right" ? -v : v;
  if (vv <= lo) return mp;            // line outside: nothing removed
  if (vv >= hi) return [];            // line past the far side: nothing left
  const [a, bb] = side === "front" ? [0, 1] : side === "back" ? [0, -1] : side === "left" ? [1, 0] : [-1, 0];
  if (isSimpleConvex(mp)) {
    const r = clipRingHalf(mp[0].outer, a, bb, side === "front" || side === "left" ? v : -v);
    return r.length >= 3 && Math.abs(ringArea(r)) > AREA_EPS ? [{ outer: r, holes: [] }] : [];
  }
  const m = 1;
  let x0 = b.minX - m, x1 = b.maxX + m, y0 = b.minY - m, y1 = b.maxY + m;
  if (side === "front") y0 = v; else if (side === "back") y1 = v; else if (side === "left") x0 = v; else x1 = v;
  return boolOp(mp, [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], "int");
}

/**
 * Inward offset of a convex CCW ring by D (exact miter). Fast path: intersect each pair of
 * adjacent moved edge lines, O(n). Valid when no edge collapses (every moved edge keeps its
 * direction); otherwise fall back to clipping by every moved edge half-plane.
 */
function offsetConvexInward(ring, D) {
  const n = ring.length;
  const L = new Array(n);   // moved lines: point + unit direction
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len < 1e-12) { L.length = 0; break; }
    const ux = dx / len, uy = dy / len;
    L[i] = [p[0] - uy * D, p[1] + ux * D, ux, uy];
  }
  if (L.length === n) {
    const out = new Array(n);
    let okFast = true;
    for (let i = 0; i < n && okFast; i++) {
      const a = L[(i + n - 1) % n], b = L[i];
      const den = a[2] * b[3] - a[3] * b[2];
      if (Math.abs(den) < 1e-12) { okFast = false; break; }
      const s = ((b[0] - a[0]) * b[3] - (b[1] - a[1]) * b[2]) / den;
      let x = a[0] + a[2] * s, y = a[1] + a[3] * s;
      if (a[3] === 0) y = a[1]; else if (a[2] === 0) x = a[0];   // exact on axis-aligned edges
      if (b[3] === 0) y = b[1]; else if (b[2] === 0) x = b[0];
      out[i] = [x, y];
    }
    if (okFast) {
      for (let i = 0; i < n; i++) {   // each moved edge must keep the original direction
        const p = out[i], q = out[(i + 1) % n];
        if ((q[0] - p[0]) * L[i][2] + (q[1] - p[1]) * L[i][3] <= 1e-9) { okFast = false; break; }
      }
      if (okFast) return out;
    }
  }
  let poly = ring;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) continue;
    const nx = -dy / len, ny = dx / len;   // inward normal for a CCW ring (exact ±1 / 0 on axis edges)
    poly = clipRingHalf(poly, nx, ny, nx * p[0] + ny * p[1] + D);
    if (poly.length < 3) return [];
  }
  return poly;
}

/** Inward offset of a MultiPoly by D ft (D > 0). Miter joins keep rectangles rectangular. */
function insetMP(mp, D) {
  if (!(D > 0)) return mp;
  if (!mp.length) return mp;
  if (isSimpleConvex(mp)) {
    const r = offsetConvexInward(mp[0].outer, D);
    return r.length >= 3 && ringArea(r) > AREA_EPS ? [{ outer: r, holes: [] }] : [];
  }
  return clipperOffset(mp, -D);
}

/* ------------------------------------------------------------------ shapes */

function arcPoints(cx, cy, r, a0, a1, m) {
  // m segments, end points on r, interior points on k*r so the fan area is exact.
  const theta = a1 - a0, dl = theta / m;
  let k = 1;
  if (m >= 3) {
    const A = m - 2, B = 2, C = -theta / Math.sin(dl);
    k = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  } else if (m === 2) k = theta / (2 * Math.sin(dl));
  const pts = [];
  for (let i = 0; i <= m; i++) {
    const a = a0 + dl * i, rr = i === 0 || i === m ? r : r * k;
    let x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
    if (i === 0 || i === m) {   // snap end points exactly onto the straight edges
      const c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
      x = cx + r * c; y = cy + r * s;
    }
    pts.push([x, y]);
  }
  return pts;
}

function rectRing(w, d, radius = 0) {
  const x = w / 2, y = d / 2;
  const r = clamp(num(radius, 0), 0, Math.min(x, y));
  if (r <= 0) return [[-x, -y], [x, -y], [x, y], [-x, y]];
  const h = Math.PI / 2;
  const pts = [
    ...arcPoints(x - r, -y + r, r, -h, 0, CORNER_SEGMENTS),       // SE
    ...arcPoints(x - r, y - r, r, 0, h, CORNER_SEGMENTS),         // NE
    ...arcPoints(-x + r, y - r, r, h, 2 * h, CORNER_SEGMENTS),    // NW
    ...arcPoints(-x + r, -y + r, r, 2 * h, 3 * h, CORNER_SEGMENTS), // SW
  ];
  return dedupe(pts);
}

function ellipseRing(a, b, n) {
  // Equal-area polygon: N/2 * k^2 * a*b * sin(2pi/N) = pi*a*b.
  const k = Math.sqrt((2 * Math.PI) / (n * Math.sin((2 * Math.PI) / n)));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    pts.push([k * a * Math.cos(t), k * b * Math.sin(t)]);
  }
  return pts;
}

/**
 * Ring for a shape definition, centred on (0, 0) by bounding box (polygon: as given).
 * shape: { type, w, d, radius, arm, points }. Returns [] when the shape has no area.
 */
export function shapeToRing(shape, { segments = 96 } = {}) {
  const s = shape || {};
  const type = String(s.type || "rect").toLowerCase();
  const w = clamp(num(s.w, 0), 0, MAX_DIM);
  const d = clamp(num(s.d, 0), 0, MAX_DIM);
  const n = Math.max(8, Math.round(num(segments, 96)));
  switch (type) {
    case "square": {
      const side = w > 0 ? w : d;
      return side > 0 ? rectRing(side, side, s.radius) : [];
    }
    case "circle": {
      const dia = w > 0 ? w : d;
      return dia > 0 ? ellipseRing(dia / 2, dia / 2, n) : [];
    }
    case "ellipse":
      return w > 0 && d > 0 ? ellipseRing(w / 2, d / 2, n) : [];
    case "triangle":
      return w > 0 && d > 0 ? [[-w / 2, -d / 2], [w / 2, -d / 2], [0, d / 2]] : [];
    case "l": {
      if (!(w > 0 && d > 0)) return [];
      const a = num(s.arm, 0) > 0 ? num(s.arm, 0) : 0.4 * Math.min(w, d);
      if (a >= Math.min(w, d)) return rectRing(w, d);
      const x = w / 2, y = d / 2;
      return [[-x, -y], [x, -y], [x, -y + a], [-x + a, -y + a], [-x + a, y], [-x, y]];
    }
    case "u": {
      if (!(w > 0 && d > 0)) return [];
      const a = num(s.arm, 0) > 0 ? num(s.arm, 0) : 0.4 * Math.min(w, d);
      if (a >= w / 2 || a >= d) return rectRing(w, d);
      const x = w / 2, y = d / 2;
      return [[-x, -y], [x, -y], [x, y], [x - a, y], [x - a, -y + a], [-x + a, -y + a], [-x + a, y], [-x, y]];
    }
    case "polygon":
    case "custom": {
      const pts = (Array.isArray(s.points) ? s.points : [])
        .filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
        .map((p) => [clamp(+p[0], -MAX_DIM, MAX_DIM), clamp(+p[1], -MAX_DIM, MAX_DIM)]);
      const r = dedupe(pts);
      if (r.length < 3) return [];
      const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
      if ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) <= AREA_EPS) return [];
      return ccw(r);   // a self-intersecting ring is returned as given; shapeToMP repairs it
    }
    case "rect":
    default:
      return w > 0 && d > 0 ? rectRing(w, d, s.radius) : [];
  }
}

/** Shape → MultiPoly. Custom polygons pass through a Clipper union to fix self-intersections. */
function shapeToMP(shape, segments) {
  const ring = shapeToRing(shape, { segments });
  if (ring.length < 3) return [];
  const type = String((shape && shape.type) || "rect").toLowerCase();
  if (type === "polygon" || type === "custom") {
    if (isConvexRing(ring)) return [{ outer: ring, holes: [] }];
    return boolOp([], [ring], "union");
  }
  return [{ outer: ring, holes: [] }];
}

/* -------------------------------------------------------------- floor list */

function programsOf(state) {
  const sp = state && state.programs && typeof state.programs === "object" ? state.programs : {};
  const out = {};
  for (const k of new Set([...Object.keys(PROGRAM_DEFAULTS), ...Object.keys(sp)])) {
    out[k] = { ...(PROGRAM_DEFAULTS[k] || { ftf: 10, unitSize: 0, unitFactor: 0 }), ...(sp[k] || {}) };
  }
  return out;
}

/** Tower index of a segment: a whole number >= 0; a missing or bad value is tower 0. */
export function towerOf(seg) {
  const t = seg && seg.tower;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? Math.round(t) : 0;
}

/** The towers of a state, lowest index first: [{ tower, segments: [flat segment index, ...] }]. The first entry is the lead
 *  tower (Tower 1 when it has segments): its segments set the shared levels. */
export function towersOf(state) {
  const by = new Map();
  (Array.isArray(state && state.segments) ? state.segments : []).forEach((seg, si) => {
    const k = towerOf(seg);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(si);
  });
  return [...by.keys()].sort((a, b) => a - b).map((tower) => ({ tower, segments: by.get(tower) }));
}

function floorListInternal(state, warnings) {
  const floors = [];
  let n = 0, z = 0, capped = false;
  const progs = programsOf(state);
  const towers = towersOf(state);
  const lead = towers.length ? towers[0].tower : 0;
  const leadSet = new Set(towers.length ? towers[0].segments : []);
  const mechDefs = (Array.isArray(state.mechanical) ? state.mechanical : []).map((m) => ({
    afterFloor: Math.round(num(m && m.afterFloor, 0)),
    ftf: Math.max(1, num(m && m.ftf, num(progs.mechanical && progs.mechanical.ftf, 16))),
    used: false,
  }));
  const push = (zone, program, segmentIndex, t, ftf, tower) => {
    if (n >= MAX_FLOORS) { capped = true; return false; }
    n += 1;
    floors.push({ n, zone, program, segmentIndex, t, z, ftf, tower });
    z += ftf;
    return true;
  };
  const insertMechanical = (segmentIndex, t, tower) => {
    let again = true;
    while (again) {
      again = false;
      for (const m of mechDefs) {
        if (!m.used && m.afterFloor === n) {
          m.used = true;
          if (push("mechanical", "mechanical", segmentIndex, t, m.ftf, tower)) again = true;
        }
      }
    }
  };
  const pod = state.podium;
  if (pod && pod.on) {
    const count = Math.max(1, Math.round(num(pod.floors, 1)));
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      const ftf = Math.max(1, num(i === 0 ? pod.groundFtf : pod.ftf, 14));
      if (!push("podium", (i === 0 ? pod.program : pod.upperProgram) || "retail", -1, t, ftf, -1)) break;
      insertMechanical(-1, t, -1);
    }
  }
  const firstAbove = floors.length;       // the levels above the podium start here
  const segs = Array.isArray(state.segments) ? state.segments : [];
  // The lead tower (Tower 1) stacks exactly as a one-tower design always has: its floors and mechanical floors set the
  // shared levels above the podium.
  let leadFtf = 10;
  segs.forEach((seg, si) => {
    if (!leadSet.has(si)) return;
    const count = Math.max(1, Math.round(num(seg && seg.floors, 1)));
    leadFtf = Math.max(1, num(seg && seg.ftf, 10));
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      if (!push("tower", (seg && seg.program) || "residential", si, t, leadFtf, lead)) break;
      insertMechanical(si, t, lead);
    }
  });
  // Every other tower stands on the same base and takes the same levels, bottom up: its i-th floor sits on the i-th level
  // above the podium (z and floor-to-floor of that level; the tower's own ftf is not used). Above the top of Tower 1 the
  // levels go on at Tower 1's top floor-to-floor. Floors of one level share n (the level number) and z.
  if (towers.length > 1) {
    const slots = floors.slice(firstAbove).map((f) => ({ n: f.n, z: f.z, ftf: f.ftf }));
    const extra = [];
    for (const tw of towers.slice(1)) {
      let k = 0;
      for (const si of tw.segments) {
        const seg = segs[si];
        const count = Math.max(1, Math.round(num(seg && seg.floors, 1)));
        for (let i = 0; i < count; i++, k++) {
          while (k >= slots.length) {
            if (n >= MAX_FLOORS) { capped = true; break; }
            n += 1;
            slots.push({ n, z, ftf: leadFtf });
            z += leadFtf;
          }
          if (k >= slots.length) break;
          const sl = slots[k];
          extra.push({ n: sl.n, zone: "tower", program: (seg && seg.program) || "residential", segmentIndex: si, t: count > 1 ? i / (count - 1) : 0, z: sl.z, ftf: sl.ftf, tower: tw.tower });
        }
      }
    }
    // bottom up; within one level the podium or lead tower floor first, then the towers by index (a stable sort)
    floors.push(...extra);
    floors.sort((a, b) => a.n - b.n);
  }
  if (capped) warnings.push(warn("floor-cap", [], `Floor count is limited to ${MAX_FLOORS}. Extra floors were not built.`));
  const unplaced = mechDefs.filter((m) => !m.used).map((m) => m.afterFloor);
  if (unplaced.length) {
    warnings.push(warn("mechanical-unplaced", [], `A mechanical floor after floor ${unplaced.join(", ")} has no floor below it and was not built.`));
  }
  return floors;
}

/** Plan 3.1: ordered floors { n, zone, program, segmentIndex, t, z, ftf, tower }, bottom up.
 *  n is the level number. With several towers, one entry per tower per level: entries of one level share n, z and ftf,
 *  and keep their own program, segmentIndex and tower. tower is the segment's tower index (-1 for podium floors and
 *  for mechanical floors that sit on the podium). */
export function buildFloorList(state) {
  return floorListInternal(state || {}, []);
}

/* ---------------------------------------------------------- normalizers */

const SIDES = ["front", "back", "left", "right"];

function normSetbacks(list) {
  return (Array.isArray(list) ? list : []).map((s) => {
    let sides = Array.isArray(s && s.sides) ? s.sides.map((x) => String(x).toLowerCase()) : [];
    if (!sides.length || sides.includes("all")) sides = SIDES.slice();
    sides = SIDES.filter((x) => sides.includes(x));
    return { floor: Math.round(num(s && s.floor, 1)), distance: Math.max(0, num(s && s.distance, 0)), all: sides.length === 4, sides };
  }).filter((s) => s.distance > 0 && s.sides.length);
}

function setbackAt(setbacks, n) {
  const r = { all: 0, front: 0, back: 0, left: 0, right: 0 };
  for (const s of setbacks) {
    if (n < s.floor) continue;
    if (s.all) r.all += s.distance; else for (const side of s.sides) r[side] += s.distance;
  }
  return r;
}

function normRange(o, lastN) {
  let a = Math.round(num(o && o.startFloor, 1)), b = Math.round(num(o && o.endFloor, a));
  if (b < a) [a, b] = [b, a];
  return [Math.max(1, a), Math.min(lastN, b)];
}

function normCarves(list, lastN) {
  return (Array.isArray(list) ? list : []).map((c) => {
    const [s, e] = normRange(c, lastN);
    const kind = String((c && c.kind) || "corner").toLowerCase();
    const corner = String((c && c.corner) || "NE").toUpperCase();
    return { s, e, kind, corner: ["NE", "NW", "SE", "SW"].includes(corner) ? corner : "NE",
      w: Math.max(0, num(c && c.w, 0)), d: Math.max(0, num(c && c.d, 0)) };
  }).filter((c) => c.s <= c.e && (c.kind === "full" || (c.w > 0 && c.d > 0)));
}

function normCuts(list, lastN, floorByN) {
  return (Array.isArray(list) ? list : []).map((c) => {
    const [s, e] = normRange(c, lastN);
    const side = String((c && c.side) || "front").toLowerCase();
    const fs = floorByN.get(s), fe = floorByN.get(e);
    return { s, e, side: SIDES.includes(side) ? side : "front", depth: Math.max(0, num(c && c.depth, 0)),
      zs: fs ? fs.z : 0, ze: fe ? fe.z : 0, ref: new Map() };
  }).filter((c) => c.s <= c.e && c.depth > 0);
}

/* ---------------------------------------------------------------- segment helpers */

function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function segCross(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}
/* ---------------------------------------------------------------- crown */

function triangulate(poly) {
  // Ear clipping with hole bridging. Returns { pts, tris } (tris: flat index list, CCW).
  let ring = ccw(dedupe(poly.outer.map((p) => [p[0], p[1]])));
  const holes = (poly.holes || []).map((h) => cw(dedupe(h.map((p) => [p[0], p[1]])))).filter((h) => h.length >= 3);
  holes.sort((a, b) => Math.max(...b.map((p) => p[0])) - Math.max(...a.map((p) => p[0])));
  const allEdgesBlock = (M, P, rest) => {
    const check = (r) => {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        if (segCross(M, P, a, b)) return true;
      }
      return false;
    };
    if (check(ring)) return true;
    for (const h of rest) if (check(h)) return true;
    return false;
  };
  for (let hi = 0; hi < holes.length; hi++) {
    const h = holes[hi];
    let mi = 0;
    for (let i = 1; i < h.length; i++) if (h[i][0] > h[mi][0]) mi = i;
    const M = h[mi];
    const order = ring.map((p, i) => [i, (p[0] - M[0]) ** 2 + (p[1] - M[1]) ** 2]).sort((a, b) => a[1] - b[1]);
    let pi = order[0][0];
    for (const [i] of order) { if (!allEdgesBlock(M, ring[i], holes.slice(hi))) { pi = i; break; } }
    const hRot = [...h.slice(mi), ...h.slice(0, mi), [M[0], M[1]]];
    ring = [...ring.slice(0, pi + 1), ...hRot, [ring[pi][0], ring[pi][1]], ...ring.slice(pi + 1)];
  }
  const pts = ring;
  const idx = pts.map((_, i) => i);
  const tris = [];
  const inTri = (p, a, b, c) => orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let found = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (orient(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = pts[j];
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (inTri(p, a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      found = true;
      break;
    }
    if (!found) {   // degenerate remainder: drop a vertex so the loop ends
      const i0 = idx[idx.length - 1], i1 = idx[0], i2 = idx[1];
      if (orient(pts[i0], pts[i1], pts[i2]) > 0) tris.push(i0, i1, i2);
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3 && orient(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 0) tris.push(idx[0], idx[1], idx[2]);
  return { pts, tris };
}

function slopedMesh(mp, z0, h, side) {
  const b = mpBounds(mp);
  const span = side === "front" || side === "back" ? b.maxY - b.minY : b.maxX - b.minX;
  const zt = (p) => {
    const dd = side === "front" ? p[1] - b.minY : side === "back" ? b.maxY - p[1]
      : side === "left" ? p[0] - b.minX : b.maxX - p[0];
    return z0 + (span > 0 ? (h * dd) / span : h);
  };
  const positions = [], indices = [];
  const v = (x, y, z) => { positions.push(x, y, z); return positions.length / 3 - 1; };
  for (const poly of mp) {
    const { pts, tris } = triangulate(poly);
    const top = pts.map((p) => v(p[0], p[1], zt(p)));
    const bot = pts.map((p) => v(p[0], p[1], z0));
    for (let i = 0; i < tris.length; i += 3) {
      indices.push(top[tris[i]], top[tris[i + 1]], top[tris[i + 2]]);
      indices.push(bot[tris[i]], bot[tris[i + 2]], bot[tris[i + 1]]);
    }
    for (const ring of [ccw(poly.outer), ...(poly.holes || []).map(cw)]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const p0 = v(p[0], p[1], z0), q0 = v(q[0], q[1], z0), q1 = v(q[0], q[1], zt(q)), p1 = v(p[0], p[1], zt(p));
        indices.push(p0, q0, q1, p0, q1, p1);
      }
    }
  }
  return { kind: "mesh", positions, indices, role: "crown" };
}

function spireMesh(cx, cy, r, z0, h, n) {
  const positions = [cx, cy, z0 + h, cx, cy, z0];
  const indices = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    positions.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z0);
  }
  for (let i = 0; i < n; i++) {
    const a = 2 + i, b = 2 + ((i + 1) % n);
    indices.push(a, b, 0);      // side, outward
    indices.push(1, b, a);      // base, facing down
  }
  return { kind: "mesh", positions, indices, role: "crown" };
}

/** The plate minus its inward offset: a ring `thickness` ft wide (parapet, screen). */
function ringOf(mp, thickness) {
  const inner = insetMP(mp, thickness);
  if (!inner.length) return cloneMP(mp);
  if (isSimpleConvex(mp) && inner.length === 1) {
    return [{ outer: mp[0].outer.map((q) => [q[0], q[1]]), holes: [cw(inner[0].outer)] }];
  }
  // Clip rings: outers CCW (+1), holes CW (0 under non-zero) → exactly the inner region.
  return boolOp(mp, inner.flatMap((p) => [ccw(p.outer), ...(p.holes || []).map(cw)]), "diff");
}

function buildCrown(state, topMP, z0, segN) {
  const c = state.crown || {};
  const type = String(c.type || "flat").toLowerCase();
  const h = Math.max(0, num(c.height, 0));
  if (!topMP || !topMP.length || type === "none") return [];
  const b = mpBounds(topMP);
  const minWD = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  switch (type) {
    case "stepped": {
      if (!(h > 0)) return [];
      const steps = clamp(Math.round(num(c.steps, 3)), 1, 20);
      const s = Math.min(0.08 * minWD, minWD / (2 * (steps + 1)));
      const out = [];
      for (let i = 1; i <= steps; i++) {
        const mp = insetMP(topMP, i * s);
        if (!mp.length) break;
        out.push({ kind: "prism", polygons: mp, z0: z0 + ((i - 1) * h) / steps, z1: z0 + (i * h) / steps, role: "crown" });
      }
      return out;
    }
    case "sloped": {
      if (!(h > 0)) return [];
      const side = SIDES.includes(String(c.slopeSide).toLowerCase()) ? String(c.slopeSide).toLowerCase() : "front";
      return [slopedMesh(topMP, z0, h, side)];
    }
    case "spire": {
      if (!(h > 0)) return [];
      const [cx, cy] = mpCentroid(topMP);
      return [spireMesh(cx, cy, Math.max(1, 0.06 * minWD), z0, h, segN === 32 ? 12 : 24)];
    }
    case "screen": {
      if (!(h > 0)) return [];
      return [{ kind: "prism", polygons: ringOf(topMP, RING_THICKNESS), z0, z1: z0 + h, role: "screen" }];
    }
    case "flat":
    default:
      return [{ kind: "prism", polygons: ringOf(topMP, RING_THICKNESS), z0, z1: z0 + PARAPET_HEIGHT, role: "parapet" }];
  }
}

/** Extra height the crown adds above the top floor (flat and none add 0). */
function crownExtra(state) {
  const c = (state && state.crown) || {};
  const type = String(c.type || "flat").toLowerCase();
  return type === "flat" || type === "none" ? 0 : Math.max(0, num(c.height, 0));
}

/* -------------------------------------------------------------- plates */

function prepSegment(seg, segN) {
  const base = shapeToMP(seg && seg.shape, segN);
  const tp = (seg && seg.taper) || {}, tw = (seg && seg.twist) || {};
  return {
    base,
    bounds: base.length ? mpBounds(base) : null,
    taperX: num(tp.x, 0), taperY: num(tp.y, 0), taperCurve: tp.curve,
    twistDeg: num(tw.deg, 0), twistStart: num(tw.start, 0), twistEnd: num(tw.end, 1), twistCurve: tw.curve,
    rotation: num(seg && seg.rotation, 0),
    ox: num(seg && seg.offset && seg.offset.x, 0), oy: num(seg && seg.offset && seg.offset.y, 0),
    lx: num(seg && seg.lean && seg.lean.x, 0), ly: num(seg && seg.lean && seg.lean.y, 0),
    cache: new Map(),
  };
}

function twistT(sc, t) {
  const a = clamp(sc.twistStart, 0, 1), b = clamp(sc.twistEnd, 0, 1);
  if (b <= a) return t >= a ? 1 : 0;
  return clamp((t - a) / (b - a), 0, 1);
}

/** Steps 1–4 for one tower floor. Returns { mp, local, theta, cause }. */
function towerPre(sc, f, setbacks) {
  if (!sc.base.length) return { mp: [], cause: "shape" };
  const sx = 1 + (sc.taperX / 100) * curveOf(f.t, sc.taperCurve);
  const sy = 1 + (sc.taperY / 100) * curveOf(f.t, sc.taperCurve);
  if (!(sx > 0 && sy > 0)) return { mp: [], cause: "taper" };
  const sb = setbackAt(setbacks, f.n);
  const key = `${sx},${sy},${sb.all},${sb.front},${sb.back},${sb.left},${sb.right}`;
  let local = sc.cache.get(key);
  if (!local) {
    // 1. taper
    let mp = sx === 1 && sy === 1 ? sc.base : mapMP(sc.base, (q) => [q[0] * sx, q[1] * sy]);
    // 2. setbacks (local frame, before rotation)
    const bb = { minX: sc.bounds.minX * sx, maxX: sc.bounds.maxX * sx, minY: sc.bounds.minY * sy, maxY: sc.bounds.maxY * sy };
    if (sb.all > 0) mp = insetMP(mp, sb.all);
    if (mp.length && sb.front > 0) mp = clipSide(mp, "front", bb.minY + sb.all + sb.front);
    if (mp.length && sb.back > 0) mp = clipSide(mp, "back", bb.maxY - sb.all - sb.back);
    if (mp.length && sb.left > 0) mp = clipSide(mp, "left", bb.minX + sb.all + sb.left);
    if (mp.length && sb.right > 0) mp = clipSide(mp, "right", bb.maxX - sb.all - sb.right);
    local = mp;
    sc.cache.set(key, local);
  }
  if (!local.length || multiPolyArea(local) <= AREA_EPS) return { mp: [], cause: "setbacks" };
  // 3. rotation
  const theta = (sc.rotation + sc.twistDeg * curveOf(twistT(sc, f.t), sc.twistCurve)) * DEG;
  // 4. translation
  const tx = sc.ox + sc.lx * f.t, ty = sc.oy + sc.ly * f.t;
  let mp = local;
  if (theta !== 0) {
    const c = Math.cos(theta), s = Math.sin(theta);
    mp = mapMP(mp, (q) => [q[0] * c - q[1] * s + tx, q[0] * s + q[1] * c + ty]);
  } else if (tx !== 0 || ty !== 0) {
    mp = mapMP(mp, (q) => [q[0] + tx, q[1] + ty]);
  } else {
    mp = cloneMP(mp);
  }
  return { mp, local, theta, tx, ty, cause: null };
}

/**
 * Build every floor plate, the crown solids and the geometry warnings.
 * → { plates: Plate[], solids: Solid[], warnings: Warning[], floors }
 */
export function buildPlates(state, { quality = "full" } = {}) {
  state = state || {};
  const segN = quality === "draft" ? 32 : 96;
  const warnings = [];
  const floors = floorListInternal(state, warnings);
  const lastN = floors.length ? floors[floors.length - 1].n : 0;
  const floorByN = new Map(floors.map((f) => [f.n, f]));

  const segs = (Array.isArray(state.segments) ? state.segments : []).map((s) => prepSegment(s, segN));
  const pod = state.podium && state.podium.on ? state.podium : null;
  let podiumMP = [];
  if (pod) {
    const ox = num(pod.offset && pod.offset.x, 0), oy = num(pod.offset && pod.offset.y, 0);
    podiumMP = shapeToMP(pod.shape, segN);
    if (ox !== 0 || oy !== 0) podiumMP = mapMP(podiumMP, (q) => [q[0] + ox, q[1] + oy]);
  }
  const setbacks = normSetbacks(state.setbacks);
  const carves = normCarves(state.carves, lastN);
  const cuts = normCuts(state.cuts, lastN, floorByN);

  const plates = [];
  const empty = { shape: [], taper: [], setbacks: [], carves: [], cuts: [] };
  // { mp (pre-carve), cause } of the floor below, per tower. Podium floors and the mechanical floors on the podium are
  // tower -1; the lead tower's first floor sits on them (one tower: this is simply the floor below in the list).
  const belowBy = new Map();
  const lead = floors.reduce((m, f) => (f.zone === "tower" && (m === null || f.tower < m) ? f.tower : m), null);
  const belowOf = (f) => (belowBy.has(f.tower) ? belowBy.get(f.tower) : f.tower === lead ? belowBy.get(-1) || null : null);

  for (const f of floors) {
    let pre, cause = null;
    if (f.zone === "podium") {
      pre = cloneMP(podiumMP);
      if (!pre.length) cause = "shape";
    } else if (f.zone === "mechanical") {
      const below = belowOf(f);
      pre = below ? cloneMP(below.mp) : [];
      if (!pre.length) cause = below && below.cause ? below.cause : "shape";
    } else {
      const sc = segs[f.segmentIndex];
      const r = towerPre(sc, f, setbacks);
      pre = r.mp; cause = r.cause;
    }
    belowBy.set(f.tower, { mp: pre, cause });
    if (!pre.length) { empty[cause || "shape"].push(f.n); continue; }

    // 5. carves
    let mp = pre, isVoid = false;
    const here = carves.filter((c) => f.n >= c.s && f.n <= c.e);
    if (here.some((c) => c.kind === "full")) {
      isVoid = true; mp = [];
    } else if (here.length) {
      const bb = mpBounds(pre);
      const [cx, cy] = mpCentroid(pre);
      const rects = [];
      for (const c of here) {
        let x0, x1, y0, y1;
        if (c.kind === "center") {
          x0 = cx - c.w / 2; x1 = cx + c.w / 2; y0 = cy - c.d / 2; y1 = cy + c.d / 2;
        } else {
          const m = 1;   // reach past the bounding box so no sliver is left on the edge
          if (c.corner.includes("E")) { x0 = bb.maxX - c.w; x1 = bb.maxX + m; } else { x0 = bb.minX - m; x1 = bb.minX + c.w; }
          if (c.corner.includes("N")) { y0 = bb.maxY - c.d; y1 = bb.maxY + m; } else { y0 = bb.minY - m; y1 = bb.minY + c.d; }
        }
        rects.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      }
      mp = boolOp(pre, rects, "diff");
      if (!mp.length || multiPolyArea(mp) <= AREA_EPS) { empty.carves.push(f.n); continue; }
    }

    // 6. cuts
    if (!isVoid) {
      let cutEmpty = false;
      for (const c of cuts) {
        if (f.n < c.s || f.n > c.e) continue;
        if (!c.ref.has(f.tower)) c.ref.set(f.tower, mpBounds(pre));   // the reference edge, per tower
        const ref = c.ref.get(f.tower);
        const dz = c.ze - c.zs;
        const dep = dz > 0 ? (c.depth * (f.z - c.zs)) / dz : c.depth;
        if (!(dep > 0)) continue;
        const v = c.side === "front" ? ref.minY + dep : c.side === "back" ? ref.maxY - dep
          : c.side === "left" ? ref.minX + dep : ref.maxX - dep;
        mp = clipSide(mp, c.side, v);
        if (!mp.length) { cutEmpty = true; break; }
      }
      if (cutEmpty || multiPolyArea(mp) <= AREA_EPS) { empty.cuts.push(f.n); continue; }
    }

    const area = isVoid ? 0 : multiPolyArea(mp);
    plates.push({
      n: f.n, zone: f.zone, program: f.program, segmentIndex: f.segmentIndex, tower: f.tower,
      t: f.t, z: f.z, ftf: f.ftf,
      polygons: mp, area,
      coreRect: null, coreArea: 0,      // the core moved to the Plate Planner; the fields stay for readers
      outsideEnvelopeArea: 0,
      void: isVoid,
    });
  }

  // warnings
  const why = { shape: "the shape has no size", taper: "taper", setbacks: "setbacks", carves: "carves", cuts: "cuts" };
  for (const k of Object.keys(empty)) {
    const list = empty[k];
    if (!list.length) continue;
    const verb = list.length === 1 ? "has" : "have";
    const msg = k === "shape" ? `${groupFloors(list)} ${verb} no area: ${why[k]}.` : `${groupFloors(list)} ${verb} no area after ${why[k]}.`;
    warnings.push(warn("plate-empty", list, msg));
  }

  // crown: every tower gets the same crown on its own top floor (base = the top of that tower's floors). With no tower
  // floor that has area, the crown sits on the highest plate (the podium), as it always has.
  let solids = [];
  const real = plates.filter((p) => !p.void && p.area > AREA_EPS);
  const towerKeys = [...new Set(real.filter((p) => p.tower >= 0).map((p) => p.tower))].sort((a, b) => a - b);
  if (towerKeys.length) {
    for (const k of towerKeys) {
      const mine = real.filter((p) => p.tower === k);
      const top = mine[mine.length - 1];
      const topOfFloors = plates.reduce((m, p) => (p.tower === k ? Math.max(m, p.z + p.ftf) : m), 0);
      for (const s of buildCrown(state, top.polygons, topOfFloors, segN)) solids.push({ ...s, tower: k });
    }
  } else if (real.length) {
    const top = real[real.length - 1];
    const topOfFloors = plates.reduce((m, p) => Math.max(m, p.z + p.ftf), 0);
    solids = buildCrown(state, top.polygons, topOfFloors, segN).map((s) => ({ ...s, tower: top.tower }));
  }
  return { plates, solids, warnings, floors };
}

/* ---------------------------------------------------------------- metrics */

function siteAreaOf(state) {
  const s = state.site || {};
  if (s.shape === "none") return 0;                 // Unlimited: no site, so no site area
  if (s.shape === "polygon" && Array.isArray(s.points) && s.points.length >= 3) {
    return Math.abs(ringArea(s.points.map((p) => [+p[0], +p[1]])));
  }
  return clamp(num(s.width, 0), 0, MAX_DIM) * clamp(num(s.depth, 0), 0, MAX_DIM);
}

function factorOf(v) {
  const f = num(v, 0);
  return f > 1 ? f / 100 : Math.max(0, f);
}

/** Plan section 5: every metric, from the plate list. */
export function computeMetrics(state, plates) {
  state = state || {};
  plates = plates || [];
  const progs = programsOf(state);
  let gfa = 0, top = 0, mechanicalArea = 0, netArea = 0, floorCount = 0, voidFloors = 0;
  let towerArea = 0;
  const byZone = { podium: 0, tower: 0, mechanical: 0, crown: 0 };
  const towerAreas = [];
  const byProgram = {};
  let floor1Area = 0;
  // Several towers: plates of one level share n. Floors count LEVELS (podium + the tallest tower), not plates; the
  // areas sum every plate. With one tower every level has one plate, so this is the plain count.
  const levels = new Set(), realLevels = new Set(), voidLevels = new Set(), zoneLevels = new Set();

  for (const p of plates) {
    top = Math.max(top, p.z + p.ftf);
    levels.add(p.n);
    if (p.void || !(p.area > 0)) { if (p.void) voidLevels.add(p.n); continue; }
    const area = p.area;
    gfa += area;
    realLevels.add(p.n);
    const zk = `${p.zone}|${p.n}`;
    if (!zoneLevels.has(zk)) { zoneLevels.add(zk); byZone[p.zone] = (byZone[p.zone] || 0) + 1; }
    if (p.n === 1) floor1Area += area;
    const key = p.program || p.zone;
    const bp = byProgram[key] || (byProgram[key] = { floors: 0, gross: 0, net: 0 });
    bp.floors += 1; bp.gross += area;
    if (p.zone === "mechanical") {
      mechanicalArea += area;
    } else {
      netArea += area;
      bp.net += area;
    }
    if (p.zone === "tower") { towerAreas.push(area); towerArea += area; }
  }
  floorCount = realLevels.size;
  for (const n of voidLevels) if (!realLevels.has(n)) voidFloors += 1;
  for (const [k, bp] of Object.entries(byProgram)) {
    const pr = progs[k] || {};
    const unitSize = Math.max(0, num(pr.unitSize, 0));
    const unitFactor = factorOf(pr.unitFactor);
    bp.unitSize = unitSize;
    bp.unitFactor = unitFactor;
    bp.units = unitSize > 0 && unitFactor > 0 ? (bp.net * unitFactor) / unitSize : null;
    bp.unitsWhole = bp.units == null ? null : Math.floor(bp.units + 1e-9);
  }

  const crownHeight = floorCount ? crownExtra(state) : 0;
  const siteArea = siteAreaOf(state);
  const far = siteArea > 0 ? gfa / siteArea : 0;
  const t = state.targets || {};
  const check = (target, current) => (num(target, 0) > 0
    ? { target, current, diff: current - target, pct: ((current - target) / target) * 100 }
    : null);

  return {
    gfa,
    floorCount,
    voidFloors,
    levelCount: levels.size,
    floorsByZone: byZone,
    topOfFloors: top,
    crownHeight,
    totalHeight: top + crownHeight,
    plateMin: towerAreas.length ? Math.min(...towerAreas) : 0,
    plateMax: towerAreas.length ? Math.max(...towerAreas) : 0,
    plateAvg: towerAreas.length ? towerArea / towerAreas.length : 0,
    siteArea,
    hasSite: !(state.site && state.site.shape === "none"),   // false: siteArea, far and siteCoverage are 0 and mean "no site"
    far,
    floor1Area,
    siteCoverage: siteArea > 0 ? floor1Area / siteArea : 0,
    coreArea: 0,            // the core moved to the Plate Planner
    mechanicalArea,
    netArea,                // GFA - mechanicalArea, before core
    byProgram,
    target: { gfa: check(num(t.gfa, 0), gfa), far: check(num(t.far, 0), far) },
  };
}

/* ---------------------------------------------------------------- text */

/** [31,32,33,34,40] → "Floors 31–34 and 40"; [5] → "Floor 5". En dash for ranges. */
export function groupFloors(numbers) {
  const nums = [...new Set((numbers || []).map((x) => Math.round(+x)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!nums.length) return "";
  const groups = [];
  for (const n of nums) {
    const g = groups[groups.length - 1];
    if (g && n === g[1] + 1) g[1] = n; else groups.push([n, n]);
  }
  const parts = groups.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${nums.length === 1 ? "Floor" : "Floors"} ${list}`;
}
