// Run: node test/plate.exports.test.mjs
// Plan tests 23 to 27 (docs/plate-planner-technical-plan.md section 9.1):
//   23  preset 8.1 through platesDerived, writeSection and validate: unit ids 1-01..., every unit has bay, ring, two demising lines
//   24  the Parking Deck overlay on a plates section from 8.1: demisingLines returns source "plates"; every line within 5 degrees
//       of the y axis, 5 ft or longer, at a bay cut of 8.1
//   25  rooms CSV of 8.1: placement comment, header, 17 rows, centroids inside their units
//   26  DXF of 8.4: every layer; UNIT-LINE holds two lines per unit
//   27  SketchUp doc of 8.6: validateDoc passes; source "plate"; one solid per unit
// Plus: the notes file, levels of a group (ids, z, building totals), hotel bays, input immutability, determinism, label points
// of L-shaped wrap units, corridor wall lines, quoting, and the Facade Studio unitBalconies reader.
//
// The build comes from a hand fixture that follows the plan section 4 contract (see "hand fixture"). The fixture reproduces the
// section 8 geometry: 8.1 with the reference widths of the plan, 8.4 (U plate) and 8.6 (courtyard) with their run lengths and
// unit counts (21 and 39). When src/plate/fill.js and src/plate/corridor.js load, the same invariants also run against the real
// modules (section "real modules"); the final line says which one ran.
//
// validateDoc: src/shared/sketchup-format.js does not accept source "plate" until the integrator adds it (plan section 10).
// The tests validate a copy with source "midrise" and accept a source error as the only error of the real document.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const D = await import("../src/plate/derived.js");
const X = await import("../src/plate/exports.js");
const { plateToSketchup, SKETCHUP_SOURCE } = await import("../src/plate/sketchup.js");
const { newProject, writeSection, validate } = await import("../src/shared/project.js");
const { validateDoc } = await import("../src/shared/sketchup-format.js");
const { demisingLines } = await import("../src/parking/overlay.js");
const { unitBalconies } = await import("../src/facade/balconies.js");
const { platesDerived, labelPoint, pointInRing, ringAreaSigned, corridorWallLines } = D;
const { roomsCsv, plateDxf, notesMarkdown, PLATE_DXF_LAYERS, CAUTIONS, CSV_COLUMNS, AREA_RULE } = X;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/** The doc passes validateDoc, or its only errors are about the source (before the integrator edit). */
function validDoc(doc) {
  const strict = validateDoc({ ...doc, source: "midrise" });
  if (!strict.ok) throw new Error("validateDoc (source midrise copy): " + strict.errors.join("; "));
  const v = validateDoc(doc);
  ok(v.ok || v.errors.every((e) => e.startsWith("source:")), "validateDoc: " + v.errors.join("; "));
  return { strict, direct: v.ok };
}

const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

/* ---------- state (plan section 2) ---------- */

const MF_MIX = [
  { id: "studio", name: "Studio", widthMin: 20, widthMax: 24, targetArea: 525, areaMin: 450, areaMax: 600, share: 0.10, color: "#9cc3e6" },
  { id: "1br", name: "1BR", widthMin: 24, widthMax: 28, targetArea: 725, areaMin: 650, areaMax: 800, share: 0.45, color: "#4f7fd1" },
  { id: "1brden", name: "1BR + den", widthMin: 28, widthMax: 32, targetArea: 900, areaMin: 850, areaMax: 950, share: 0.10, color: "#6b5fc7" },
  { id: "2br", name: "2BR", widthMin: 32, widthMax: 40, targetArea: 1100, areaMin: 1000, areaMax: 1200, share: 0.30, color: "#2f9e9a" },
  { id: "3br", name: "3BR", widthMin: 40, widthMax: 48, targetArea: 1400, areaMin: 1300, areaMax: 1500, share: 0.05, color: "#d9a22b" },
];
const HOTEL_MIX = [
  { id: "king", name: "King", widthMin: 13.5, widthMax: 14.5, target: 14, bays: 1, share: 0.60, color: "#8a63c9" },
  { id: "dq", name: "Double queen", widthMin: 14, widthMax: 15, target: 14.5, bays: 1, share: 0.30, color: "#b48ad9" },
  { id: "suite", name: "Suite", widthMin: 27, widthMax: 29, target: 28, bays: 2, share: 0.05, color: "#5b3f99" },
];
const baseState = (name, mode = "multifamily") => ({
  schema: 1, name, mode, source: "drawn",
  plate: { shape: "rect", w: 300, d: 65, arm: 60, courtW: 120, courtD: 90, segments: 64, points: [] },
  corridor: { kind: "bar", width: null, wall: 0.5, side: "south", spine: null },
  extWall: 1.0,
  core: { rect: null }, stairs: { mode: "auto", size: [11, 22], items: [] }, elevators: { count: null, size: [8, 10], service: null }, support: [],
  mix: { multifamily: MF_MIX, hotel: HOTEL_MIX, cornerType: "2br", accessibleWidth: [15, 16, 15.5] },
  accessible: { multifamily: { typeAShare: 0.02, minUnits: 1, over: 20 }, hotel: [[25, 1, 0], [50, 2, 0], [100, 5, 1]], perFloor: null },
  placement: null,
});
const state81 = () => baseState("Double-loaded bar");

/* ---------- hand fixture: buildPlates(state) as plan section 4 gives it ---------- */

const rr = (v) => Math.round(v * 1000) / 1000;
const rectRing = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const sector = (nx, ny) => { const b = ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360; return b >= 315 || b < 45 ? "N" : b < 135 ? "E" : b < 225 ? "S" : "W"; };

/** Arc length from the first vertex of `ring`, along the ring order, to the point of the ring nearest to pt. */
function arcPos(ring, pt) {
  let best = Infinity, pos = 0, acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tt = Math.max(0, Math.min(1, ((pt[0] - a[0]) * (b[0] - a[0]) + (pt[1] - a[1]) * (b[1] - a[1])) / (L * L)));
    const q = [a[0] + tt * (b[0] - a[0]), a[1] + tt * (b[1] - a[1])], dd = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
    if (dd < best - 1e-9) { best = dd; pos = acc + tt * L; }
    acc += L;
  }
  return rr(pos);
}

const TYPE_MID = [["studio", 22], ["1br", 26], ["1brden", 30], ["2br", 36], ["3br", 44]];
const typeFor = (w) => TYPE_MID.reduce((b, c) => (Math.abs(c[1] - w) < Math.abs(b[1] - w) ? c : b))[0];

/**
 * Units along one run: `widths` side by side from distance t0 along u from the point P on the area line, `d` deep toward the
 * corridor (direction n). Each unit has its two cut lines from the area line to the corridor face.
 */
function runUnits({ P, u, n, d, widths, types, ring, ringIdx = 0, t0 = 0 }) {
  const out = [];
  let tt = t0;
  widths.forEach((w, i) => {
    const ta = tt, tb = tt + w; tt = tb;
    const A = [P[0] + u[0] * ta, P[1] + u[1] * ta], B = [P[0] + u[0] * tb, P[1] + u[1] * tb];
    const C = [B[0] + n[0] * d, B[1] + n[1] * d], Dd = [A[0] + n[0] * d, A[1] + n[1] * d];
    const outer = [A, B, C, Dd].map((p) => [rr(p[0]), rr(p[1])]);
    if (ringAreaSigned(outer) < 0) outer.reverse();
    out.push({
      type: types ? types[i] : typeFor(w), outer, exposures: [sector(-n[0], -n[1])], corner: false,
      bay: { from: arcPos(ring, A), to: arcPos(ring, B) }, ring: ringIdx,
      demising: [[A, Dd], [B, C]].map((l) => l.map((p) => [rr(p[0]), rr(p[1])])), accessible: false,
    });
  });
  return out;
}

/** A run of length L cut into n equal units. */
const equalRun = (spec, L, n) => runUnits({ ...spec, widths: Array.from({ length: n }, () => L / n) });

/** A wrap unit (an L) from its polygon, the two leg-end lines, and the bay ends. */
function wrapUnit(poly, lines, exposures, ring, from, to, type = "2br") {
  return { type, outer: poly.map((p) => [rr(p[0]), rr(p[1])]), exposures, corner: true, bay: { from: arcPos(ring, from), to: arcPos(ring, to) }, ring: 0, demising: lines.map((l) => l.map((p) => [rr(p[0]), rr(p[1])])), accessible: false };
}

const mirrorPoly = (poly, sx, sy, cx = 0, cy = 0) => {
  const m = poly.map((p) => [cx + sx * (p[0] - cx), cy + sy * (p[1] - cy)]);
  return sx * sy < 0 ? m.reverse() : m;
};
const lines2 = (ls, sx, sy, cx = 0, cy = 0) => ls.map((l) => l.map((p) => [cx + sx * (p[0] - cx), cy + sy * (p[1] - cy)]));
const asBuilt = (fill, levels = [1], extra = {}) => ({ source: "drawn", groups: [{ id: "g1", levels, fill }], placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, warnings: [], notes: [], ...extra });

// --- 8.1 Double-loaded bar: rect 300 x 65, clear corridor 5.67, d = 28.665, the reference widths of plan 8.1 ---
const D81 = 28.665;
const PLATE81 = rectRing(-150, -32.5, 150, 32.5);
function fill81() {
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const closeRun = (w, L) => [...w, L - sum(w)];
  const south = closeRun([20.00, 24.44, 30.24, 36.07, 46.25, 24.44, 36.07, 24.44], 278);
  const ne = closeRun([25.14, 20.00, 31.19], 124), nw = closeRun([24.84, 37.16, 24.84], 124);
  const units = [
    ...runUnits({ P: [-139, -31.5], u: [1, 0], n: [0, 1], d: D81, widths: south, types: ["studio", "1br", "1brden", "2br", "3br", "1br", "2br", "1br", "2br"], ring: PLATE81 }),
    ...runUnits({ P: [139, 31.5], u: [-1, 0], n: [0, -1], d: D81, widths: ne, types: ["1br", "studio", "1brden", "3br"], ring: PLATE81 }),
    ...runUnits({ P: [-15, 31.5], u: [-1, 0], n: [0, -1], d: D81, widths: nw, types: ["1br", "2br", "1br", "2br"], ring: PLATE81 }),
  ];
  return {
    plate: [{ outer: PLATE81, holes: [] }],
    corridor: [{ outer: rectRing(-139, -2.835, 139, 2.835), holes: [] }],
    core: [-15, 2.835, 15, 32.5],                                                        // a rectangle, as state.core.rect
    stairs: [{ id: "S1", outer: rectRing(-150, -11, -139, 11), door: [-139, 0] }, { id: "S2", outer: rectRing(139, -11, 150, 11), door: [139, 0] }],
    elevators: [{ id: "E1", outer: rectRing(-9, 5, -1, 15) }, { id: "E2", outer: rectRing(1, 5, 9, 15) }],
    support: [
      { id: "B1", kind: "remainder", outer: rectRing(-150, -32.5, -139, -11) }, { id: "B2", kind: "remainder", outer: rectRing(139, -32.5, 150, -11) },
      { id: "B3", kind: "remainder", outer: rectRing(139, 11, 150, 32.5) }, { id: "B4", kind: "remainder", outer: rectRing(-150, 11, -139, 32.5) },
    ],
    units, warnings: [],
  };
}
const built81 = () => asBuilt(fill81());

// --- 8.4 U plate, 60 ft arms: d = 26.165, e = 34.103, 21 units ---
function built84() {
  const d = 26.165, e = 34.103, plate = [[0, 0], [200, 0], [200, 140], [140, 140], [140, 60], [60, 60], [60, 140], [0, 140]];
  const run = (P, u, n, L, count) => equalRun({ P, u, n, d, ring: plate }, L, count);
  const wrapA = wrapUnit([[1, 1], [1 + e, 1], [1 + e, 1 + d], [1 + d, 1 + d], [1 + d, 1 + e], [1, 1 + e]], [[[1 + e, 1], [1 + e, 1 + d]], [[1, 1 + e], [1 + d, 1 + e]]], ["S", "W"], plate, [1, 1 + e], [1 + e, 1]);
  const wrapB = wrapUnit(mirrorPoly([[1, 1], [1 + e, 1], [1 + e, 1 + d], [1 + d, 1 + d], [1 + d, 1 + e], [1, 1 + e]], -1, 1, 100), lines2([[[1 + e, 1], [1 + e, 1 + d]], [[1, 1 + e], [1 + d, 1 + e]]], -1, 1, 100), ["S", "E"], plate, [199 - e, 1], [199, 1 + e]);
  const units = [
    wrapA,
    ...run([1 + e, 1], [1, 0], [0, 1], 199 - e - (1 + e), 4),
    wrapB,
    ...run([199, 1 + e], [0, 1], [-1, 0], 129 - (1 + e), 3),
    ...run([141, 129], [0, -1], [1, 0], 70, 3),
    ...run([141, 59], [-1, 0], [0, -1], 82, 3),
    ...run([59, 59], [0, 1], [-1, 0], 70, 3),
    ...run([1, 129], [0, -1], [1, 0], 129 - (1 + e), 3),
  ];
  const fill = {
    plate: [{ outer: plate, holes: [] }],
    corridor: [{ outer: [[27.165, 27.165], [172.835, 27.165], [172.835, 129], [167.165, 129], [167.165, 32.835], [32.835, 32.835], [32.835, 129], [27.165, 129]], holes: [] }],
    core: null,
    stairs: [{ id: "S1", outer: rectRing(19, 129, 41, 140), door: [30, 129] }, { id: "S2", outer: rectRing(159, 129, 181, 140), door: [170, 129] }],
    elevators: [],
    support: [
      { id: "B1", kind: "pocket", outer: rectRing(32.835, 32.835, 59, 59) }, { id: "B2", kind: "pocket", outer: rectRing(141, 32.835, 167.165, 59) },
      { id: "B3", kind: "remainder", outer: rectRing(1, 129, 19, 139) }, { id: "B4", kind: "remainder", outer: rectRing(41, 129, 59, 139) },
      { id: "B5", kind: "remainder", outer: rectRing(141, 129, 159, 139) }, { id: "B6", kind: "remainder", outer: rectRing(181, 129, 199, 139) },
    ],
    units, warnings: [],
  };
  return asBuilt(fill);
}

// --- 8.6 Courtyard level (typed O): 250 x 220 minus a 120 x 90 court; d = 28.665, e = 33.520, 39 units ---
function built86() {
  const d = 28.665, e = 33.52;
  const outerRing = rectRing(-125, -110, 125, 110), holeRing = [[-60, -45], [-60, 45], [60, 45], [60, -45]];     // the hole is clockwise
  const o = (P, u, n, L, count) => equalRun({ P, u, n, d, ring: outerRing }, L, count);
  const h = (P, u, n, L, count) => equalRun({ P, u, n, d, ring: holeRing, ringIdx: 1 }, L, count);
  const Lw = [[-124, -109], [-124 + e, -109], [-124 + e, -109 + d], [-124 + d, -109 + d], [-124 + d, -109 + e], [-124, -109 + e]];
  const Ll = [[[-124 + e, -109], [-124 + e, -109 + d]], [[-124, -109 + e], [-124 + d, -109 + e]]];
  const wrap = (sx, sy, ex, from, to) => wrapUnit(mirrorPoly(Lw, sx, sy), lines2(Ll, sx, sy), ex, outerRing, from, to);
  const units = [
    wrap(1, 1, ["S", "W"], [-124, -109 + e], [-124 + e, -109]),
    ...o([-90.48, -109], [1, 0], [0, 1], 84.98, 3), ...o([5.5, -109], [1, 0], [0, 1], 84.98, 3),
    wrap(-1, 1, ["S", "E"], [124 - e, -109], [124, -109 + e]),
    ...o([124, -75.48], [0, 1], [-1, 0], 60.48, 2), ...o([124, 15], [0, 1], [-1, 0], 60.48, 2),
    wrap(-1, -1, ["N", "E"], [124, 109 - e], [124 - e, 109]),
    ...o([90.48, 109], [-1, 0], [0, -1], 84.98, 3), ...o([-5.5, 109], [-1, 0], [0, -1], 84.98, 3),
    wrap(1, -1, ["N", "W"], [-124 + e, 109], [-124, 109 - e]),
    ...o([-124, 75.48], [0, -1], [1, 0], 150.96, 5),
    ...h([-61, -46], [0, 1], [-1, 0], 92, 3),
    ...h([-61, 46], [1, 0], [0, 1], 55.5, 2), ...h([5.5, 46], [1, 0], [0, 1], 55.5, 2),
    ...h([61, 46], [0, -1], [1, 0], 92, 3),
    ...h([61, -46], [-1, 0], [0, -1], 55.5, 2), ...h([-5.5, -46], [-1, 0], [0, -1], 55.5, 2),
  ];
  const C = (x0, y0, x1, y1) => ({ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] });
  const eastC = { outer: [[5.5, -80.335], [95.335, -80.335], [95.335, 80.335], [5.5, 80.335], [5.5, 74.665], [89.665, 74.665], [89.665, -74.665], [5.5, -74.665]], holes: [] };
  const westC = { outer: eastC.outer.map((p) => [-p[0], p[1]]).reverse(), holes: [] };
  const pocket = (sx, sy) => { const x = [61 * sx, 89.665 * sx].sort((a, b) => a - b), y = [46 * sy, 74.665 * sy].sort((a, b) => a - b); return rectRing(x[0], y[0], x[1], y[1]); };
  const fill = {
    plate: [{ outer: outerRing, holes: [holeRing] }],
    corridor: [eastC, westC],
    core: { outer: rectRing(95.335, -15, 125, 15) },                                      // a polygon, as the fill may give it
    stairs: [{ id: "S1", outer: rectRing(-5.5, -88.5, 5.5, -66.5), door: [0, -77.5] }, { id: "S2", outer: rectRing(-5.5, 66.5, 5.5, 88.5), door: [0, 77.5] }],
    elevators: [{ id: "E1", outer: rectRing(100, -10, 108, 0) }, { id: "E2", outer: rectRing(110, -10, 118, 0) }],
    support: [
      { id: "B1", kind: "pocket", outer: pocket(-1, -1) }, { id: "B2", kind: "pocket", outer: pocket(1, -1) }, { id: "B3", kind: "pocket", outer: pocket(1, 1) }, { id: "B4", kind: "pocket", outer: pocket(-1, 1) },
      { id: "B5", kind: "remainder", outer: rectRing(-5.5, -109, 5.5, -88.5) }, { id: "B6", kind: "remainder", outer: rectRing(-5.5, 88.5, 5.5, 109) },
      { id: "B7", kind: "remainder", outer: rectRing(-5.5, -66.5, 5.5, -46) }, { id: "B8", kind: "remainder", outer: rectRing(-5.5, 46, 5.5, 66.5) },
    ],
    units, warnings: [],
  };
  void C;
  return asBuilt(fill);
}

const NRSF81 = 526 * D81;                     // 526 x 28.665 = 15,077.79 (plan 8.1)
const GSF81 = 300 * 65;                       // 19,500

/* ---------- 23  derived ---------- */

console.log("derived");
const S81 = state81(), B81 = built81();
let derived81;
t("23  fixture 8.1: 17 units, widths close the runs (sum 526), area = 526 x 28.665", () => {
  const u = B81.groups[0].fill.units;
  eq(u.length, 17);
  near(u.reduce((s, x) => s + Math.abs(ringAreaSigned(x.outer)), 0), NRSF81, 0.05);
});
t("23  platesDerived of 8.1: ids 1-01 to 1-17, type names, metrics", () => {
  derived81 = platesDerived(S81, B81, null);
  eq(derived81.mode, "multifamily");
  eq(derived81.massingUpdatedAt, null);
  eq(derived81.levels.length, 1);
  const lv = derived81.levels[0];
  eq(lv.index, 1);
  eq(lv.units.map((x) => x.id), Array.from({ length: 17 }, (_, k) => `1-${String(k + 1).padStart(2, "0")}`));
  // 526 x 28.665 = 15,077.79 -> 15,077.8; 15,077.79 / 19,500 = 0.77322
  near(lv.metrics.nrsf, 15077.8, 0.15); eq(lv.metrics.units, 17); near(lv.metrics.gsf, GSF81, 0.05); near(lv.metrics.efficiency, 0.7732, 0.0003);
  eq(derived81.metrics.units, 17); near(derived81.metrics.nrsf, 15077.8, 0.15); near(derived81.metrics.efficiency, 0.7732, 0.0003);
  near(derived81.metrics.corridorFt, 278, 0.1, "corridorFt (278 x 5.67 / 5.67)");
  eq(lv.units[0].type, "Studio"); eq(lv.units[4].type, "3BR"); eq(lv.units[2].type, "1BR + den");
});
t("23  mix: studio 2, 1BR 6, den 2, 2BR 5, 3BR 2; shares sum to 1; average area = width x 28.665", () => {
  eq(derived81.mix.map((m) => [m.type, m.count]), [["Studio", 2], ["1BR", 6], ["1BR + den", 2], ["2BR", 5], ["3BR", 2]]);
  near(derived81.mix.reduce((s, m) => s + m.share, 0), 1, 0.0005);
  near(derived81.mix[0].avgArea, ((20 + 20) / 2) * D81, 0.6);                     // studios: 20.00 and 20.00 (25.14 -> 20.00)
});
t("23  every unit has bay, ring, a clean outer ring, exposures and two demising lines of two points", () => {
  for (const u of derived81.levels[0].units) {
    ok(u.bay && typeof u.bay.from === "number" && typeof u.bay.to === "number" && u.bay.to > u.bay.from, `${u.id} bay`);
    eq(u.ring, 0, `${u.id} ring`);
    eq(u.demising.length, 2, `${u.id} demising`);
    for (const l of u.demising) { eq(l.length, 2); ok(l.every((p) => p.length === 2)); }
    ok(ringAreaSigned(u.outer) > 0, `${u.id} outer is counter-clockwise`);
    ok(u.outer.length === 4, `${u.id} has four vertices`);
    ok(u.exposures.length === 1 && "NESW".includes(u.exposures[0]), `${u.id} exposures`);
    eq(u.corner, false); eq(u.accessible, false);
  }
  const u = derived81.levels[0].units[0];
  eq(u.exposures, ["S"]); near(u.bay.from, 11, 0.01, "first unit starts 11 ft from the ring start (stair)");
});
t("23  core, stairs, elevators, support, plate, corridor in the plate frame", () => {
  const lv = derived81.levels[0];
  eq(lv.core.outer.length, 4); near(Math.abs(ringAreaSigned(lv.core.outer)), 30 * 29.665, 0.01);
  eq(lv.core.stairs.map((s) => s.id), ["S1", "S2"]); eq(lv.core.stairs[0].door, [-139, 0]);
  eq(lv.core.elevators.map((s) => s.id), ["E1", "E2"]);
  eq(lv.support.map((s) => [s.id, s.kind]), [["B1", "remainder"], ["B2", "remainder"], ["B3", "remainder"], ["B4", "remainder"]]);
  eq(lv.plate.length, 1); eq(lv.plate[0].holes, []); near(Math.abs(ringAreaSigned(lv.plate[0].outer)), GSF81, 0.01);
  eq(lv.corridor.length, 1);
});
t("23  writeSection(plates) then validate: ok; the stored derived equals the written one", () => {
  const doc = newProject({ name: "Plates" });
  const out = writeSection(doc, "plates", { tool: "plate", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: S81, derived: derived81 });
  const v = validate(out);
  ok(v.ok, "validate: " + v.errors.join("; "));
  eq(out.sections.plates.tool, "plate");
  eq(out.sections.plates.derived, derived81);
  eq(Object.keys(doc.sections), [], "the input project is not changed");
  ok(JSON.stringify(derived81).length / 17 < 1000, "about 0.5 KB per unit (under 1 KB)");
});
t("23  same inputs, same bytes; frozen inputs are not mutated", () => {
  const s = deepFreeze(state81()), b = deepFreeze(built81());
  const a1 = JSON.stringify(platesDerived(s, b, null)), a2 = JSON.stringify(platesDerived(s, b, null));
  eq(a1, a2);
  const csv = roomsCsv(JSON.parse(a1), null); ok(csv.length > 10);
  plateDxf(deepFreeze(JSON.parse(a1)), s); notesMarkdown(s, b, null, { date: "2026-10-22" }); plateToSketchup(s, b, null, { createdAt: "2026-10-22T00:00:00Z" });
});
t("23  a group of five floors: five levels, ids 3-07, z from the level data, building totals (plan test 21: 85 units, NRSF 75,389.0)", () => {
  const levels = [2, 3, 4, 5, 6].map((i) => ({ index: i, name: `Level ${i}`, z: 14 + (i - 2) * 10, ftf: 10, program: "residential" }));
  const b = asBuilt(fill81(), levels, { massingUpdatedAt: "2026-10-22T10:00:00.000Z" });
  const d = platesDerived(S81, b, null);
  eq(d.levels.map((l) => l.index), [2, 3, 4, 5, 6]);
  eq(d.levels.map((l) => l.z), [14, 24, 34, 44, 54]);
  eq(d.levels[1].units[6].id, "3-07"); eq(d.levels[4].units[16].id, "6-17");
  eq(d.metrics.units, 85); near(d.metrics.nrsf, 75389.0, 0.7); near(d.metrics.gsf, 97500, 0.1); near(d.metrics.corridorFt, 1390, 0.5);
  eq(d.mix.find((m) => m.type === "1BR").count, 30);
  eq(d.massingUpdatedAt, "2026-10-22T10:00:00.000Z");
  // the unit outlines are identical on every level of the group
  eq(d.levels[0].units.map((u) => u.outer), d.levels[4].units.map((u) => u.outer));
});
t("23  level data from built.levels, or defaults (name Level n, ftf 10, z (n - 1) x ftf)", () => {
  const b = asBuilt(fill81(), [3, 4], { levels: [{ index: 3, name: "Floor 3", z: 22, ftf: 11 }] });
  const d = platesDerived(S81, b, null);
  eq([d.levels[0].name, d.levels[0].z, d.levels[0].ftf], ["Floor 3", 22, 11]);
  eq([d.levels[1].name, d.levels[1].z, d.levels[1].ftf], ["Level 4", 30, 10]);
});
t("23  hotel: type names, bays count a suite twice, corridor width default 6.0", () => {
  const s = baseState("Hotel", "hotel");
  const f = fill81();
  const ids = ["king", "dq", "suite"];
  f.units = f.units.map((u, k) => ({ ...u, type: ids[k % 3] }));
  const d = platesDerived(s, asBuilt(f), null);
  const suites = f.units.filter((u) => u.type === "suite").length;
  eq(d.mode, "hotel"); eq(d.metrics.units, 17); eq(d.metrics.bays, 17 + suites);
  eq(d.mix.map((m) => m.type), ["King", "Double queen", "Suite"]);
  near(d.metrics.corridorFt, (278 * 5.67) / 6, 0.1);
});
t("23  accessible flags and text pass through; exposures sorted N E S W; missing optional keys default", () => {
  const f = fill81();
  f.units = f.units.slice(0, 3).map((u, k) => ({ ...u, accessible: k === 1 ? "roll-in" : k === 2, exposures: k === 0 ? ["W", "S"] : u.exposures }));
  const d = platesDerived(S81, asBuilt(f), null);
  eq(d.levels[0].units.map((u) => u.accessible), [false, "roll-in", true]);
  eq(d.levels[0].units[0].exposures, ["S", "W"]);
  const g = fill81(); g.units = [{ type: "1br", outer: g.units[1].outer }];
  const e = platesDerived(S81, asBuilt(g), null).levels[0].units[0];
  eq(e.ring, 0); eq(e.demising, []); eq(e.exposures, []); ok(!("bay" in e));
});
t("23  errors name the missing input", () => {
  let m = ""; try { platesDerived(null, B81); } catch (e) { m = e.message; } ok(/state/.test(m), m);
  m = ""; try { platesDerived(S81, {}); } catch (e) { m = e.message; } ok(/built\.groups/.test(m), m);
  m = ""; try { roomsCsv({}, null); } catch (e) { m = e.message; } ok(/derived\.levels/.test(m), m);
  m = ""; try { plateToSketchup(S81, null); } catch (e) { m = e.message; } ok(/built/.test(m), m);
});

/* ---------- 24  Parking Deck overlay and Facade Studio readers ---------- */

console.log("readers of units");
t("24  demisingLines on a plates section from 8.1: source plates, lines near the y axis, 5 ft or longer, at the bay cuts", () => {
  const doc = writeSection(newProject({ name: "P" }), "plates", { tool: "plate", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: S81, derived: derived81 });
  const frame = { toLayout: (p) => [p[0], p[1]] };
  const dem = demisingLines(doc, frame);
  eq(dem.source, "plates"); eq(dem.level, 1);
  // every demising line of the derived units: within 5 degrees of the y axis and 5 ft or longer
  const TAN5 = Math.tan((5 * Math.PI) / 180);
  for (const u of derived81.levels[0].units) for (const [a, b] of u.demising) { ok(Math.abs(b[1] - a[1]) >= 5, "5 ft or longer"); ok(Math.abs(b[0] - a[0]) <= TAN5 * Math.abs(b[1] - a[1]), "within 5 degrees of y"); }
  // the cuts of 8.1: the unit edges of the fixture, merged within 0.25 ft as the overlay does
  const cuts = [...new Set(B81.groups[0].fill.units.flatMap((u) => u.outer.map((p) => p[0])))].sort((a, b) => a - b);
  const merged = cuts.reduce((o, x) => { if (!o.length || x - o[o.length - 1] > 0.25) o.push(x); return o; }, []);
  eq(dem.xs.length, merged.length, "number of cuts");
  dem.xs.forEach((x, k) => near(x, merged[k], 0.002, `cut ${k}`));
  ok(dem.xs.length >= 17, "at least 17 cuts");
  // note: south and north cuts interleave on a double-loaded bar, so the median spacing is about half a unit width (here 16.5 ft)
  ok(dem.unitWidth >= 20 && dem.unitWidth <= 50, `unit width ${dem.unitWidth} (each unit own width, median)`);
  console.log(`       note: overlay unitWidth on the double-loaded 8.1 is ${dem.unitWidth} ft (median of each unit own width)`);
  ok(dem.footprint && dem.footprint.length === 1, "footprint is the level plate");
});
t("24  with a massing section, the plates source still wins and the residential level is picked", () => {
  let doc = writeSection(newProject({ name: "P" }), "plates", { tool: "plate", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: S81, derived: derived81 });
  doc = writeSection(doc, "massing", { tool: "midrise", schema: 1, state: {}, derived: { levels: [{ index: 1, program: "residential", plates: [], spines: [] }] } });
  eq(demisingLines(doc, { toLayout: (p) => p }).source, "plates");
  eq(demisingLines(newProject({ name: "empty" }), { toLayout: (p) => p }).source, "none");
});
t("24  Facade Studio unitBalconies reads units[].outer: a face on the unit area line takes one module per unit", () => {
  const lv = derived81.levels[0];
  const face = { id: "F1", a: [-150, -31.5], b: [150, -31.5], length: 300, z: 0, ftf: 10, n: 21 };
  // this face runs west to east along y = -31.5, so its outward normal is (0, -1): the south facade
  const south = unitBalconies(face, lv, 14, null);
  ok(south.length >= 8 && south.length <= 9, `south units on the face: ${south.length}`);
  eq(south, [...new Set(south)].sort((a, b) => a - b));
});
t("24  info: a face on the plate edge (y = -32.5) is 1.0 ft from the unit edge; unitBalconies tolerates 1.5 ft", () => {
  const lv = derived81.levels[0];
  const edge = unitBalconies({ id: "F1", a: [-150, -32.5], b: [150, -32.5], length: 300, z: 0, ftf: 10, n: 21 }, lv, 14, null);
  console.log(`       note: a face on the plate edge matches ${edge.length} units (the unit outlines stop at the area line, extWall = 1.0 ft inside)`);
});

/* ---------- 25  rooms CSV ---------- */

console.log("rooms CSV");
const parseCsv = (text) => text.trimEnd().split("\n").filter((l) => !l.startsWith("#")).map((l) => l.split(","));
t("25  rooms CSV of 8.1: placement comment, header, 17 rows, centroids inside their units", () => {
  const csv = roomsCsv(derived81, { x: 0, y: 0, rotation: 0, baseZ: 0 });
  const lines = csv.split("\n");
  eq(lines[0], "# placement x=0, y=0, rotation=0, baseZ=0");
  ok(lines[1].startsWith("# area rule:") && lines[1].includes("centerline of the demising walls"), "area rule comment");
  eq(lines[2], CSV_COLUMNS.join(","));
  eq(CSV_COLUMNS, ["level_index", "level_name", "unit_id", "type", "area_sf", "cx", "cy", "z", "nrsf", "exposures", "corner", "accessible", "bay_from", "bay_to"]);
  const rows = parseCsv(csv).slice(1);
  eq(rows.length, 17);
  rows.forEach((r, k) => {
    eq(r.length, 14, `row ${k} has 14 cells`);
    const u = derived81.levels[0].units[k];
    eq(r[2], u.id); eq(r[3], u.type); near(parseFloat(r[4]), u.area, 0.051);
    ok(pointInRing([parseFloat(r[5]), parseFloat(r[6])], u.outer), `${u.id} centroid inside`);
    eq(r[0], "1"); eq(r[1], "Level 1"); eq(r[7], "0.000"); near(parseFloat(r[8]), 15077.8, 0.15);
    eq(r[9], "S N".includes(u.exposures[0]) ? u.exposures[0] : "?"); eq(r[10], "false"); eq(r[11], "false");
    near(parseFloat(r[12]), u.bay.from, 0.0006); near(parseFloat(r[13]), u.bay.to, 0.0006);
  });
  ok(csv.endsWith("\n") && !csv.endsWith("\n\n"));
});
t("25  placement values, z of a level, accessible text, quoting, and a missing bay", () => {
  const d = JSON.parse(JSON.stringify(platesDerived(S81, asBuilt(fill81(), [{ index: 4, name: "Level 4", z: 32, ftf: 10 }]), null)));
  d.levels[0].units[0].accessible = "roll-in"; d.levels[0].units[1].type = 'A, "B"'; delete d.levels[0].units[2].bay; d.levels[0].units[3].exposures = ["N", "E"];
  const csv = roomsCsv(d, { x: 100.5, y: -50, rotation: 12.5, baseZ: 1010.2 });
  eq(csv.split("\n")[0], "# placement x=100.5, y=-50, rotation=12.5, baseZ=1010.2");
  const rows = csv.trimEnd().split("\n").slice(3);
  ok(rows[0].includes(",roll-in,"), rows[0]); ok(rows[1].includes('"A, ""B"""'), rows[1]); ok(rows[2].endsWith(",,"), rows[2]); ok(rows[3].includes(",N E,"), rows[3]);
  ok(rows[0].startsWith("4,Level 4,4-01,Studio,") && rows[0].includes(",32.000,"), rows[0]);
  eq(roomsCsv(d, null).split("\n")[0], "# placement x=0, y=0, rotation=0, baseZ=0");
});
t("25  a group copied to five levels gives 85 rows, ordered by level", () => {
  const levels = [2, 3, 4, 5, 6].map((i) => ({ index: i, name: `Level ${i}`, z: 14 + (i - 2) * 10, ftf: 10 }));
  const rows = parseCsv(roomsCsv(platesDerived(S81, asBuilt(fill81(), levels), null), null)).slice(1);
  eq(rows.length, 85); eq(rows[0][2], "2-01"); eq(rows[84][2], "6-17"); eq(rows[17][7], "24.000");
});
t("25  label points: the centroid when inside, else a point inside the L of a wrap unit; a thin C shape too", () => {
  const d84 = platesDerived(baseState("U"), built84(), null);
  for (const u of d84.levels[0].units) { const p = labelPoint(u.outer); ok(pointInRing(p, u.outer), `${u.id} label point inside`); }
  const c = [[0, 0], [30, 0], [30, 2], [2, 2], [2, 28], [30, 28], [30, 30], [0, 30]];        // a C: the centroid sits in the notch
  ok(pointInRing(labelPoint(c), c), "C shape label point inside");
});

/* ---------- 26  DXF ---------- */

console.log("DXF");
function parseDxf(text) {
  const raw = text.split("\n"), pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([parseInt(raw[i].trim(), 10), raw[i + 1].trim()]);
  const layers = [], ents = [];
  let section = null, cur = null, inTable = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "SECTION") { section = pairs[i + 1][1]; continue; }
    if (c === 0 && v === "ENDSEC") { section = null; cur = null; continue; }
    if (section === "TABLES") { if (c === 0 && v === "TABLE") inTable = pairs[i + 1][1]; if (inTable === "LAYER" && c === 0 && v === "LAYER") layers.push(pairs[i + 1][1]); }
    if (section === "ENTITIES") {
      if (c === 0) { cur = { type: v, layer: null, data: [] }; if (v !== "VERTEX" && v !== "SEQEND") ents.push(cur); else cur = null; }
      else if (cur) { if (c === 8) cur.layer = v; cur.data.push([c, v]); }
    }
  }
  return { pairs, layers, ents };
}
const countBy = (ents, layer, type) => ents.filter((e) => e.layer === layer && (!type || e.type === type)).length;
const d84 = platesDerived(baseState("U plate"), built84(), null);
const d86 = platesDerived(baseState("Courtyard"), built86(), null);
t("26  fixture 8.4 has 21 units (2 wraps) and 8.6 has 39 units (4 wraps, 14 court units with ring 1)", () => {
  eq(d84.metrics.units, 21); eq(d84.levels[0].units.filter((u) => u.corner).length, 2);
  eq(d86.metrics.units, 39); eq(d86.levels[0].units.filter((u) => u.corner).length, 4); eq(d86.levels[0].units.filter((u) => u.ring === 1).length, 14);
  eq(d86.levels[0].plate[0].holes.length, 1); ok(ringAreaSigned(d86.levels[0].plate[0].holes[0]) < 0, "hole is clockwise");
  near(d86.levels[0].metrics.gsf, 44200, 0.1);
});
t("26  DXF of 8.4: header, every layer in the table, UNIT-LINE has two lines per unit", () => {
  const text = plateDxf(d84, baseState("U plate"));
  ok(text.includes("AC1009") && text.trimEnd().endsWith("EOF"));
  const p = parseDxf(text);
  eq(p.layers, ["0", ...PLATE_DXF_LAYERS.map((l) => l[0])]);
  eq(PLATE_DXF_LAYERS.map((l) => l[0]), ["PLATE", "UNIT-LINE", "UNIT-AREA", "CORRIDOR", "CORRIDOR-WALL", "CORE", "STAIR", "ELEV", "SUPPORT", "TEXT"]);
  eq(countBy(p.ents, "UNIT-LINE", "LINE"), 42, "UNIT-LINE: 2 x 21");
  eq(countBy(p.ents, "UNIT-LINE"), 42);
  eq(countBy(p.ents, "UNIT-AREA", "POLYLINE"), 21);
  eq(countBy(p.ents, "PLATE", "POLYLINE"), 1); eq(countBy(p.ents, "CORRIDOR", "POLYLINE"), 1);
  eq(countBy(p.ents, "STAIR", "POLYLINE"), 2); eq(countBy(p.ents, "SUPPORT", "POLYLINE"), 6);
  eq(countBy(p.ents, "CORE"), 0, "no core on 8.4"); eq(countBy(p.ents, "ELEV"), 0);
  ok(countBy(p.ents, "CORRIDOR-WALL", "LINE") >= 3, "corridor wall lines");
  eq(countBy(p.ents, "TEXT", "TEXT"), 21 * 2 + 4, "two text lines per unit and the four title lines");
  const bad = p.ents.filter((e) => e.layer !== "0" && !p.layers.includes(e.layer));
  eq(bad.length, 0, "every entity sits on a declared layer");
  const txt = p.ents.filter((e) => e.layer === "TEXT").map((e) => e.data.find((d) => d[0] === 1)[1]);
  ok(txt.some((s) => /^2BR 1-01$/.test(s)) && txt.some((s) => /SF$/.test(s)), "type, id, and area text");
  ok(txt.some((s) => s.startsWith("AREA RULE")), "the title holds the area rule");
});
t("26  DXF of 8.6 (court plate with a hole, core, elevators): CORE 1, ELEV 2, STAIR 2, SUPPORT 8, PLATE 2, UNIT-LINE 78", () => {
  const p = parseDxf(plateDxf(d86, baseState("Courtyard")));
  eq(countBy(p.ents, "CORE", "POLYLINE"), 1); eq(countBy(p.ents, "ELEV", "POLYLINE"), 2); eq(countBy(p.ents, "STAIR", "POLYLINE"), 2);
  eq(countBy(p.ents, "SUPPORT", "POLYLINE"), 8); eq(countBy(p.ents, "PLATE", "POLYLINE"), 2, "outer ring and the court");
  eq(countBy(p.ents, "UNIT-LINE", "LINE"), 78); eq(countBy(p.ents, "UNIT-AREA", "POLYLINE"), 39); eq(countBy(p.ents, "CORRIDOR", "POLYLINE"), 2);
  // the layers of 8.4 and 8.6 together cover every layer
  const all = new Set([...parseDxf(plateDxf(d84, baseState("U"))).ents, ...p.ents].map((e) => e.layer));
  for (const [name] of PLATE_DXF_LAYERS) ok(all.has(name), `layer ${name} has entities`);
});
t("26  DXF levels stack at their own z: five levels give five times the entities, z in group 30", () => {
  const levels = [2, 3, 4, 5, 6].map((i) => ({ index: i, name: `Level ${i}`, z: 14 + (i - 2) * 10, ftf: 10 }));
  const d = platesDerived(S81, asBuilt(fill81(), levels), null);
  const one = parseDxf(plateDxf(derived81, S81)), five = parseDxf(plateDxf(d, S81));
  eq(countBy(five.ents, "UNIT-LINE", "LINE"), 5 * 34); eq(countBy(one.ents, "UNIT-LINE", "LINE"), 34);
  const zs = new Set(five.ents.filter((e) => e.layer === "UNIT-LINE").map((e) => e.data.find((x) => x[0] === 30)[1]));
  eq([...zs].sort(), ["14.0", "24.0", "34.0", "44.0", "54.0"]);
});
t("26  corridor wall lines of 8.1: three lines of 278, 124 and 124 ft, 0.5 ft inside the units", () => {
  const lines = corridorWallLines(derived81.levels[0], 0.5);
  eq(lines.length, 3);
  near(lines.reduce((s, l) => s + Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), 0), 526, 0.01, "total length");
  const ys = lines.map((l) => l[0][1]).sort((a, b) => a - b);
  eq(ys, [-3.335, 3.335, 3.335]);
  eq(corridorWallLines(derived81.levels[0], 1.0).map((l) => Math.abs(l[0][1])).sort(), [3.835, 3.835, 3.835]);
  // the O plate: wall lines run only where units touch the corridor (not along the stairs or the core)
  const lo = corridorWallLines(d86.levels[0], 0.5);
  ok(lo.length >= 6, `court plate wall lines: ${lo.length}`);
});

/* ---------- 27  SketchUp ---------- */

console.log("SketchUp");
const S86 = baseState("Courtyard level");
t("27  SketchUp doc of 8.6: validateDoc passes; source plate; one solid per unit", () => {
  const doc = plateToSketchup(S86, built86(), null, { createdAt: "2026-10-22T12:00:00.000Z" });
  eq(SKETCHUP_SOURCE, "plate"); eq(doc.source, "plate"); eq(doc.units, "feet"); eq(doc.name, "Courtyard level"); eq(doc.zShift, 0);
  const { strict, direct } = validDoc(doc);
  console.log(`       validateDoc accepts source "plate" now: ${direct}`);
  const level = doc.root.children[0];
  eq(doc.root.children.length, 1); eq(level.name, "Level 1");
  const unitSolids = level.children.filter((n) => /^1-\d\d$/.test(n.name));
  eq(unitSolids.length, 39, "one solid per unit");
  eq(unitSolids.every((n) => n.type === "solid" && n.z0 === 0 && n.z1 === 10), true);
  // solids: 39 units + 2 corridor pieces + core + 2 stairs + 2 elevators + 8 support = 54
  eq(strict.counts.solid, 54); eq(strict.counts.group, 2);
  eq(level.children.map((n) => n.name).slice(39), ["Corridor 1", "Corridor 2", "Core", "S1", "S2", "E1", "E2", "B1 (pocket)", "B2 (pocket)", "B3 (pocket)", "B4 (pocket)", "B5 (remainder)", "B6 (remainder)", "B7 (remainder)", "B8 (remainder)"]);
  // tags by type, in the type colors
  const tagNames = doc.tags.map((x) => x.name);
  const used = [...new Set(unitSolids.map((n) => n.attributes.type))];
  ok(used.length >= 3, "the 8.6 fixture uses several types");
  for (const n of [...used, "Corridor", "Core", "Stairs", "Elevators", "Support"]) ok(tagNames.includes(n), `tag ${n}`);
  eq(tagNames.length, used.length + 5, "no tag for a type that is not drawn");
  eq(doc.tags.find((x) => x.name === "2BR").color, "#2f9e9a");
  eq(unitSolids.find((n) => n.attributes.type === "2BR").tag, "2BR");
  eq(unitSolids[0].attributes.corner, true); eq(unitSolids[0].attributes.exposures, "S W");
  ok(doc.notes.some((s) => s.startsWith("Caution:")) && doc.notes.some((s) => s.includes("Area rule")), "notes carry the Caution and the area rule");
  eq(level.attributes.units, 39);
});
t("27  five levels: one group per level at its z; zShift moves every z; a corridor with a hole is a solid with a clockwise hole", () => {
  const levels = [2, 3, 4].map((i) => ({ index: i, name: `Level ${i}`, z: 14 + (i - 2) * 10, ftf: 11 }));
  const f = fill81();
  f.corridor = [{ outer: rectRing(-139, -2.835, 139, 2.835), holes: [rectRing(-100, -1, 100, 1)] }];
  const doc = plateToSketchup(S81, asBuilt(f, levels), null, { zShift: 5, name: "Stacked" });
  validDoc(doc);
  eq(doc.name, "Stacked"); eq(doc.zShift, 5);
  eq(doc.root.children.map((g) => g.name), ["Level 2", "Level 3", "Level 4"]);
  const s = doc.root.children[1].children[0];
  eq([s.z0, s.z1], [29, 40]);
  const corr = doc.root.children[0].children.find((n) => n.name === "Corridor");
  eq(corr.holes.length, 1); ok(ringAreaSigned(corr.holes[0]) < 0, "hole is clockwise");
});
t("27  an unnamed level gets the index in its group name; hotel types are tagged by name", () => {
  const s = baseState("Hotel", "hotel"), f = fill81();
  f.units = f.units.map((u, k) => ({ ...u, type: ["king", "dq", "suite"][k % 3] }));
  const doc = plateToSketchup(s, asBuilt(f, [{ index: 7, name: "Podium", z: 0, ftf: 12 }]), null, {});
  validDoc(doc);
  eq(doc.root.children[0].name, "Level 7 - Podium");
  for (const n of ["King", "Double queen", "Suite"]) ok(doc.tags.some((x) => x.name === n), n);
});

/* ---------- notes ---------- */

console.log("notes");
t("notes of 8.1: the area rule, the mix table, the metrics, every Caution, the warnings", () => {
  const b = { ...built81(), warnings: [{ code: "mix-miss", severity: "info", where: "level 1", message: "1BR is one unit under target." }] };
  const md = notesMarkdown(S81, b, { warnings: [{ code: "stale-massing", message: "The massing changed." }], stairPathFt: 278, deadEnds: [] }, { date: "2026-10-22" });
  ok(md.startsWith("# Plate Planner: Double-loaded bar"));
  for (const c of CAUTIONS) ok(md.includes(c), "Caution missing: " + c.slice(0, 40));
  ok(md.includes(AREA_RULE), "area rule");
  ok(md.includes("| Studio |") && md.includes("| 3BR |"), "mix rows");
  ok(md.includes("15,077.8 sf") && md.includes("19,500.0 sf") && md.includes("77.3 percent"), "metrics");
  ok(md.includes("| Units, whole building | 17 |"), "units");
  ok(md.includes("Stair door path (farthest two doors, along the corridor): 278.0 ft") && md.includes("Dead ends: none"), "stair path");
  ok(md.includes("- mix-miss (level 1): 1BR is one unit under target.") && md.includes("- stale-massing: The massing changed."), "warnings");
  ok(md.includes("Date: 2026-10-22") && md.includes("Placement: x 0, y 0"), "project block");
  ok(md.includes("Level group") && md.includes("Level 1 (1 floor)"), "group table");
  ok(!/compliant\b/.test(md.replace(/never says "compliant"/g, "")), 'the notes never claim "compliant"');
  const sentences = md.split("\n").filter((l) => /^[A-Z].*\.$/.test(l));
  ok(sentences.every((l) => l.split(/\s+/).length <= 45), "short sentences");
});
try {
  const { computeMetrics } = await import("../src/plate/metrics.js");
  t("notes with computeMetrics (metrics.js) on the 8.1 fixture: stair door path, targets, warnings pass through", () => {
    const b = built81();
    b.groups[0].fill.spine = [[[-139, 0], [139, 0]]];
    const mt = computeMetrics(S81, b);
    const md = notesMarkdown(S81, b, mt, { date: "2026-10-22" });
    ok(md.includes("Stair door path (farthest two doors, along the corridor): 278.0 ft"), "stair path from groups[].row.stairDoors");
    ok(md.includes("Dead ends: none"), "dead ends");
    ok(/\| Studio \| 10\.0 percent \| [\d.]+ \|/.test(md), "mix row with the fill target");
    ok(!md.includes("[object Object]"), "warning location is text");
    const d = platesDerived(S81, b, mt);
    near(d.metrics.nrsf, mt.building.nrsf, 0.2, "derived nrsf agrees with computeMetrics"); eq(d.metrics.units, mt.building.units);
    near(d.metrics.corridorFt, mt.building.corridorFt, 0.2, "corridorFt agrees"); near(d.metrics.efficiency, mt.building.efficiency, 0.0005);
  });
} catch (e) { console.log("  skip computeMetrics notes: " + String(e.message).split("\n")[0]); }
t("notes: hotel keys wording; no metrics argument; errors name the input", () => {
  const s = baseState("Hotel", "hotel"), f = fill81();
  f.units = f.units.map((u, k) => ({ ...u, type: ["king", "dq", "suite"][k % 3] }));
  const md = notesMarkdown(s, asBuilt(f), undefined, { date: "2026-10-22" });
  ok(md.includes("| Keys, whole building | 17 |") && md.includes("| Bays |") && md.includes("Source table (keys up to"), "hotel");
  ok(md.includes("No warnings."));
  let m = ""; try { notesMarkdown(null, {}, {}); } catch (e) { m = e.message; } ok(/state/.test(m), m);
});

/* ---------- real modules ---------- */

console.log("real modules");
let which = "hand fixture only";
try {
  const fillMod = await import("../src/plate/fill.js");
  const presets = await import("../src/plate/presets.js");
  let metricsMod = null;
  try { metricsMod = await import("../src/plate/metrics.js"); } catch (e) { /* metrics.js not written yet */ }
  const check = (label, state, project) => {
    const built = fillMod.buildPlates(state, project ? { project } : {});
    let metrics = null;
    if (metricsMod) { try { metrics = metricsMod.computeMetrics(state, built); } catch (e) { console.log(`       computeMetrics threw: ${e.message}`); } }
    const d = platesDerived(state, built, metrics);
    ok(d.levels.length >= 1, `${label}: levels`);
    const fillUnits = built.groups.reduce((s, g) => s + g.fill.units.length * (g.levels.length || 1), 0);
    eq(d.metrics.units, fillUnits, `${label}: derived units equal fill units`);
    for (const lv of d.levels) for (const u of lv.units) {
      ok(u.bay && typeof u.bay.from === "number", `${label} ${u.id}: bay`);
      ok(typeof u.ring === "number", `${label} ${u.id}: ring`);
      eq(u.demising.length, 2, `${label} ${u.id}: demising`);
      ok(u.area > 0 && ringAreaSigned(u.outer) > 0, `${label} ${u.id}: area`);
    }
    const out = writeSection(newProject({ name: label }), "plates", { tool: "plate", schema: 1, placement: built.placement || {}, state, derived: d });
    ok(validate(out).ok, `${label}: validate`);
    const csv = parseCsv(roomsCsv(d, built.placement)); eq(csv.length - 1, d.metrics.units, `${label}: CSV rows`);
    const dx = parseDxf(plateDxf(d, state)); eq(countBy(dx.ents, "UNIT-LINE", "LINE"), 2 * d.metrics.units, `${label}: UNIT-LINE`);
    const doc = plateToSketchup(state, built, metrics, {}); validDoc(doc);
    eq(validateDoc({ ...doc, source: "midrise" }).counts.solid >= d.metrics.units, true);
    ok(notesMarkdown(state, built, metrics, { date: "2026-10-22" }).includes("Caution"), `${label}: notes`);
    return { built, d };
  };
  t("real: default state (8.1) through buildPlates, derived, writeSection, validate, and all four exports", () => {
    // draw plan 6: defaultState() is the blank point tower; the 8.1 preset carries its frozen units (buildPlates lays them out)
    const r = check("8.1", JSON.parse(JSON.stringify(presets.PRESETS.find((p) => p.id === "double-loaded-bar").state)));
    near(r.d.metrics.nrsf, 15077.8, 0.6); eq(r.d.metrics.units, 17);
  });
  t("real: every preset through derived and the exports", () => {
    for (const p of presets.PRESETS) check(p.id || p.name, JSON.parse(JSON.stringify(p.state)));
  });
  which = "real fill.js and presets.js" + (metricsMod ? " and metrics.js" : " (metrics.js not found)");
} catch (e) {
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(String(e && e.message))) console.log(`  skip real modules: ${String(e.message).split("\n")[0]}`);
  else { fail++; console.log("  FAIL real modules: " + (e && e.stack || e)); }
}

console.log(`\n${pass} passed, ${fail} failed. Build used: ${which}.`);
process.exit(fail ? 1 : 0);
