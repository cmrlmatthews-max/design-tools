// Node tests for src/tower/geometry.js.  Run:  node test/geometry.test.mjs (after npm install)
// Every expected value is a hand calculation, written in the comment next to the test.
import { createRequire } from "module";
globalThis.ClipperLib = createRequire(import.meta.url)(
  "clipper-lib",
);
const G = await import("../src/tower/geometry.js");
const { buildPlates, computeMetrics, buildFloorList, shapeToRing, ringArea, multiPolyArea, groupFloors } = G;

/* ---------------------------------------------------------------- harness */
let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push(`  ok   ${name}`); }
  catch (e) { fail++; results.push(`  FAIL ${name}\n       ${e.message}`); }
}
function near(actual, expected, tolPct, label = "") {
  const tol = Math.abs(expected) * tolPct / 100 || 1e-9;
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${label} got ${actual}, expected ${expected} (±${tolPct}%)`);
  }
}
function eq(a, b, label = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function ok(c, label) { if (!c) throw new Error(label || "assertion failed"); }

/* ---------------------------------------------------------------- states */
const rect = (w, d) => ({ type: "rect", w, d, radius: 0, points: [] });
const seg = (o = {}) => ({
  floors: 10, ftf: 10, program: "residential", shape: rect(100, 100),
  offset: { x: 0, y: 0 }, rotation: 0,
  taper: { x: 0, y: 0, curve: "linear" },
  twist: { deg: 0, start: 0, end: 1, curve: "linear" },
  lean: { x: 0, y: 0 }, ...o,
});
// Shape of the shell's defaultState() (tower/index.html): unitFactor stored as percent there.
const base = (o = {}) => ({
  schema: 1, name: "T",
  site: { shape: "rect", width: 250, depth: 200, points: [], setbacks: { front: 10, back: 10, left: 10, right: 10 }, heightLimit: 400, stepback: { on: false, aboveHeight: 85, distance: 15 } },
  context: { show: true, blocks: [] },
  podium: { on: false, floors: 4, groundFtf: 18, ftf: 14, shape: rect(220, 170), offset: { x: 0, y: 0 }, program: "retail", upperProgram: "amenity" },
  segments: [seg()],
  setbacks: [], mechanical: [], carves: [], cuts: [],
  crown: { type: "flat", height: 20, steps: 3, slopeSide: "front" },
  core: { mode: "percent", percent: 20, w: 40, d: 30 },
  programs: {},
  targets: { gfa: 0, far: 0 },
  ...o,
});
const run = (s, q) => { const g = buildPlates(s, q ? { quality: q } : undefined); return { ...g, m: computeMetrics(s, g.plates) }; };
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

/* ---------------------------------------------------------------- required tests */

test("1. 100x100 rect, 10 floors -> GFA 100,000", () => {
  // 100 x 100 = 10,000 sf per floor x 10 floors = 100,000 sf. Height 10 x 10 = 100 ft (flat crown adds 0).
  const { m } = run(base());
  near(m.gfa, 100000, 1e-9, "gfa");
  eq(m.floorCount, 10, "floors");
  near(m.totalHeight, 100, 1e-9, "height");
});

test("2. twist 90 deg keeps GFA 100,000 (±0.01%)", () => {
  // Rotation keeps area: each plate is a rotated 100 x 100 square = 10,000 sf. 10 floors = 100,000 sf.
  const { m, plates } = run(base({ segments: [seg({ twist: { deg: 90, start: 0, end: 1, curve: "linear" } })] }));
  near(m.gfa, 100000, 0.01, "gfa");
  // floor 5: t = 4/9, angle = 40 deg -> x of a corner is not +-50 any more
  const b = plates[4].polygons[0].outer.map((p) => p[0]);
  ok(Math.max(...b) > 60, "plate 5 is rotated");
  // eased twist too
  near(run(base({ segments: [seg({ twist: { deg: 90, start: 0.2, end: 0.8, curve: "eased" } })] })).m.gfa, 100000, 0.01, "eased");
});

test("3. linear taper -50% x and y, 11 floors", () => {
  // t_i = i/10 (i = 0..10). Scale s_i = 1 - 0.5 x i/10 = 1 - 0.05 i in both x and y.
  // Area_i = 10,000 s_i^2.  sum (1 - 0.05 i)^2 = sum (1 - 0.1 i + 0.0025 i^2)
  //   = 11 - 0.1 x 55 + 0.0025 x 385 = 11 - 5.5 + 0.9625 = 6.4625.  GFA = 64,625 sf.
  const { m, plates } = run(base({ segments: [seg({ floors: 11, taper: { x: -50, y: -50, curve: "linear" } })] }));
  near(m.gfa, 64625, 0.1, "gfa");
  near(m.gfa, 64625, 1e-9, "gfa exact");
  near(plates[10].area, 2500, 1e-9, "top plate 50 x 50");
});

test("4. circle d=100, 10 floors -> 10 x pi x 50^2 within 0.1%", () => {
  // pi x 50^2 = 7,853.98 sf per floor; 10 floors = 78,539.82 sf.
  const s = base({ segments: [seg({ shape: { type: "circle", w: 100, d: 100 } })] });
  const exp = 10 * Math.PI * 2500;
  near(run(s).m.gfa, exp, 0.1, "full");
  near(run(s).m.gfa, exp, 1e-6, "equal-area polygon is exact");
  eq(shapeToRing({ type: "circle", w: 100 }).length, 96, "96 segments");
  eq(buildPlates(s, { quality: "draft" }).plates[0].polygons[0].outer.length, 32, "draft 32 segments");
  near(run(s, "draft").m.gfa, exp, 1e-6, "draft");
});

test("5. all-sides setback 10 ft at floor 6 -> 5 x 10,000 + 5 x 6,400", () => {
  // Floors 1-5: 100 x 100 = 10,000. Floors 6-10: (100 - 20) x (100 - 20) = 6,400.
  // GFA = 50,000 + 32,000 = 82,000 sf.
  const { m, plates } = run(base({ setbacks: [{ floor: 6, distance: 10, sides: ["front", "back", "left", "right"] }] }));
  near(m.gfa, 82000, 1e-9, "gfa");
  eq(plates[5].polygons[0].outer.length, 4, "still a rectangle (4 corners)");
});

test("6. front-only setback 10 ft at floor 6 -> 5 x 10,000 + 5 x 9,000", () => {
  // Floors 6-10 lose a 100 x 10 strip on the front (-y): 100 x 90 = 9,000.
  // GFA = 50,000 + 45,000 = 95,000 sf.
  const { m, plates } = run(base({ setbacks: [{ floor: 6, distance: 10, sides: ["front"] }] }));
  near(m.gfa, 95000, 1e-9, "gfa");
  near(Math.min(...plates[5].polygons[0].outer.map((p) => p[1])), -40, 1e-9, "front edge moved to y = -40");
});

test("7. corner carve 30x30 on floors 4-5 removes exactly 1,800", () => {
  // 30 x 30 = 900 sf on each of 2 floors = 1,800 sf. GFA = 100,000 - 1,800 = 98,200 sf.
  const { m, plates } = run(base({ carves: [{ startFloor: 4, endFloor: 5, kind: "corner", corner: "NE", w: 30, d: 30 }] }));
  near(m.gfa, 98200, 1e-9, "gfa");
  near(plates[3].area, 9100, 1e-9, "floor 4");
  near(plates[2].area, 10000, 1e-9, "floor 3 untouched");
  // the removed corner is NE: point (40, 40) is gone
  const xs = plates[3].polygons[0].outer;
  ok(!xs.some((p) => p[0] === 50 && p[1] === 50), "NE corner removed");
});

test("8. center carve makes a hole, area reduced by w x d", () => {
  // 20 x 30 hole at the centroid on floors 3-7: 600 sf x 5 floors = 3,000 sf.
  // GFA = 100,000 - 3,000 = 97,000 sf. Each carved plate = 10,000 - 600 = 9,400 sf.
  const { m, plates } = run(base({ carves: [{ startFloor: 3, endFloor: 7, kind: "center", w: 20, d: 30 }] }));
  near(m.gfa, 97000, 1e-9, "gfa");
  eq(plates[4].polygons.length, 1, "one piece");
  eq(plates[4].polygons[0].holes.length, 1, "one hole");
  near(Math.abs(ringArea(plates[4].polygons[0].holes[0])), 600, 1e-9, "hole area");
  ok(ringArea(plates[4].polygons[0].holes[0]) < 0, "hole is clockwise");
});

test("9. cut on the front, depth 20 over 11 floors (depth rule)", () => {
  // Rule: cut depth at floor n = depth x (z_n - z_start) / (z_end - z_start).
  // 11 floors x 10 ft, start 1 (z 0), end 11 (z 100): depth_n = 20 (n - 1) / 10 = 2 (n - 1).
  // Plate_n = 100 x (100 - 2 (n - 1)).  Sum = 100 x (11 x 100 - 2 x 55) = 100 x 990 = 99,000 sf.
  const { m, plates } = run(base({ segments: [seg({ floors: 11 })], cuts: [{ side: "front", angle: 30, startFloor: 1, endFloor: 999, depth: 20 }] }));
  near(m.gfa, 99000, 0.5, "gfa (0.5%)");
  near(m.gfa, 99000, 1e-9, "gfa exact");
  near(plates[10].area, 8000, 1e-9, "top floor 100 x 80");
  // Second case: right side, floors 6-10 of 10, depth 40.  z6 = 50, z10 = 90, span 40 ft.
  // depth_n = 40 (10 (n-1) - 50) / 40 = 10 (n - 6): 0, 10, 20, 30, 40 ft.
  // Removed = 100 x (0 + 10 + 20 + 30 + 40) = 10,000 sf. GFA = 90,000 sf.
  const r2 = run(base({ cuts: [{ side: "right", angle: 45, startFloor: 6, endFloor: 10, depth: 40 }] }));
  near(r2.m.gfa, 90000, 1e-9, "right cut");
  near(Math.max(...r2.plates[9].polygons[0].outer.map((p) => p[0])), 10, 1e-9, "floor 10 right edge at x = 10");
});

test("10. two segments with shift -> total equals sum", () => {
  // Segment 1: 100 x 100 x 5 floors = 50,000. Segment 2: 60 x 40 x 5 floors = 12,000, shifted (30, 20).
  // GFA = 62,000 sf. Segment 2 bounds: x 30 +- 30 = [0, 60], y 20 +- 20 = [0, 40].
  // Height = 5 x 10 + 5 x 12 = 110 ft.
  const s = base({ segments: [seg({ floors: 5 }), seg({ floors: 5, ftf: 12, shape: rect(60, 40), offset: { x: 30, y: 20 } })] });
  const { m, plates } = run(s);
  near(m.gfa, 62000, 1e-9, "gfa");
  near(m.totalHeight, 110, 1e-9, "height");
  const xs = plates[7].polygons[0].outer.map((p) => p[0]), ys = plates[7].polygons[0].outer.map((p) => p[1]);
  eq([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 60, 0, 40], "shifted bounds");
  eq(plates[7].segmentIndex, 1, "segment index");
  // lean: 30 ft in x at the top, 10 floors -> floor 10 centre at x = 30, area unchanged
  const l = run(base({ segments: [seg({ lean: { x: 30, y: 0 } })] }));
  near(l.m.gfa, 100000, 1e-9, "lean gfa");
  near(Math.min(...l.plates[9].polygons[0].outer.map((p) => p[0])), -20, 1e-9, "lean top");
});

test("11. mechanical floor: +1 floor, +ftf height, in GFA, out of net area", () => {
  // 10 floors 100 x 100 + mechanical after floor 5 (16 ft, plate of floor 5 = 10,000 sf).
  // Floors = 11. Height = 100 + 16 = 116 ft. GFA = 110,000 sf.
  // Core 20% = 2,000 sf per floor. Net = GFA - core (non-mech floors) - mech
  //   = 110,000 - 10 x 2,000 - 10,000 = 80,000 sf.
  const { m, plates, floors } = run(base({ mechanical: [{ afterFloor: 5, ftf: 16 }] }));
  eq(m.floorCount, 11, "floors");
  near(m.totalHeight, 116, 1e-9, "height");
  near(m.gfa, 110000, 1e-9, "gfa");
  near(m.mechanicalArea, 10000, 1e-9, "mech area");
  near(m.netArea, 80000, 1e-9, "net");
  eq([plates[5].n, plates[5].zone, plates[5].program, plates[5].z], [6, "mechanical", "mechanical", 50], "mech plate");
  eq(plates[6].z, 66, "floor 7 sits on the 16 ft mechanical floor");
  eq(floors.length, buildFloorList(base({ mechanical: [{ afterFloor: 5, ftf: 16 }] })).length, "buildFloorList agrees");
});

test("12. core larger than plate -> core-outside warning", () => {
  // Fixed core 120 x 50 on a 100 x 100 plate: 20 x 50 = 1,000 sf outside on every floor.
  const r = run(base({ core: { mode: "fixed", w: 120, d: 50 } }));
  const w = r.warnings.find((x) => x.code === "core-outside");
  ok(w, "warning present");
  eq(w.floors, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "floors");
  ok(w.message.includes("Floors 1–10"), w.message);
  near(r.plates[0].coreArea, 5000, 1e-6, "core area counted inside the plate only (100 x 50)");
  // Fixed core 60 x 60 fits a 100 x 100 plate but not the 50 x 50 plate above a 25 ft setback at floor 6.
  const r2 = run(base({ core: { mode: "fixed", w: 60, d: 60 }, setbacks: [{ floor: 6, distance: 25, sides: [] }] }));
  eq(r2.warnings.find((x) => x.code === "core-outside").floors, [6, 7, 8, 9, 10], "setback floors");
  // 20% core never warns
  ok(!run(base()).warnings.some((x) => x.code === "core-outside"), "no warning for 20%");
});

test("13. podium 4 floors 220x170 + tower -> GFA and site coverage", () => {
  // Podium: 220 x 170 = 37,400 sf x 4 = 149,600. Tower: 100 x 100 x 10 = 100,000. GFA = 249,600 sf.
  // Site 250 x 200 = 50,000 sf. FAR = 4.992. Coverage = floor 1 = 37,400 / 50,000 = 0.748.
  // Height = 18 + 3 x 14 + 10 x 10 = 160 ft.
  const s = base({ podium: { ...base().podium, on: true } });
  const { m, plates } = run(s);
  near(m.gfa, 249600, 1e-9, "gfa");
  near(m.siteCoverage, 0.748, 1e-9, "coverage");
  near(m.far, 4.992, 1e-9, "far");
  near(m.totalHeight, 160, 1e-9, "height");
  eq([plates[0].zone, plates[0].program, plates[1].program, plates[4].zone, plates[4].n, plates[4].z], ["podium", "retail", "amenity", "tower", 5, 60], "zones");
  eq(plates[0].coreArea, 0, "no core in the podium");
  // podium offset moves the plate, area unchanged
  const o = run(base({ podium: { ...base().podium, on: true, offset: { x: 10, y: -5 } } }));
  near(o.m.gfa, 249600, 1e-9, "offset gfa");
  near(Math.max(...o.plates[0].polygons[0].outer.map((p) => p[0])), 120, 1e-9, "offset x");
});

test("14. unit estimate math for residential", () => {
  // 10 floors x 10,000 sf, core 20% = 2,000 sf -> net 8,000 sf per floor, 80,000 sf total.
  // Units = 80,000 x 0.85 / 850 = 80.  (state.programs empty -> plan section 6 defaults)
  const r = run(base());
  near(r.m.byProgram.residential.net, 80000, 1e-9, "net");
  near(r.m.byProgram.residential.units, 80, 1e-9, "units");
  // Shell stores unitFactor as percent (85) -> same 80. Factor 100% and size 1,000 -> 80,000 / 1,000 = 80.
  near(run(base({ programs: { residential: { ftf: 10, unitSize: 850, unitFactor: 85 } } })).m.byProgram.residential.units, 80, 1e-9, "percent");
  near(run(base({ programs: { residential: { ftf: 10, unitSize: 1000, unitFactor: 100 } } })).m.byProgram.residential.units, 80, 1e-9, "100%");
  // Efficiency = (10,000 - 2,000) / 10,000 = 0.8 on every floor and on average.
  near(r.m.efficiencyAvg, 0.8, 1e-9, "eff avg");
  eq(r.m.efficiency.length, 10, "eff per floor");
  near(r.m.efficiency[3].efficiency, 0.8, 1e-9, "eff floor 4");
  // Office has no unit size -> units null.
  eq(run(base({ segments: [seg({ program: "office" })] })).m.byProgram.office.units, null, "office");
});

test("15. groupFloors([31,32,33,34,40]) -> 'Floors 31–34 and 40'", () => {
  eq(groupFloors([31, 32, 33, 34, 40]), "Floors 31–34 and 40");
  eq(groupFloors([5]), "Floor 5");
  eq(groupFloors([3, 1, 2, 7, 9, 10]), "Floors 1–3, 7 and 9–10");
  eq(groupFloors([]), "");
});

/* ---------------------------------------------------------------- extra coverage */

test("shapes: hand areas", () => {
  // rect radius r: w d - (4 - pi) r^2 = 100 x 60 - (4 - pi) x 100 = 6,000 - 85.84 = 5,914.16
  near(ringArea(shapeToRing({ type: "rect", w: 100, d: 60, radius: 10 })), 6000 - (4 - Math.PI) * 100, 1e-9, "rounded");
  eq(shapeToRing({ type: "rect", w: 100, d: 60, radius: 10 }).length, 36, "4 corners x 9 points");
  near(ringArea(shapeToRing({ type: "square", w: 80 })), 6400, 1e-9, "square");
  near(ringArea(shapeToRing({ type: "ellipse", w: 120, d: 60 })), Math.PI * 60 * 30, 1e-9, "ellipse pi a b");
  near(ringArea(shapeToRing({ type: "triangle", w: 100, d: 80 })), 4000, 1e-9, "triangle w d / 2");
  // L 100 x 80, arm 30: 100 x 30 + (80 - 30) x 30 = 3,000 + 1,500 = 4,500
  near(ringArea(shapeToRing({ type: "L", w: 100, d: 80, arm: 30 })), 4500, 1e-9, "L");
  // L default arm 0.4 x 80 = 32: 100 x 32 + 48 x 32 = 3,200 + 1,536 = 4,736
  near(ringArea(shapeToRing({ type: "L", w: 100, d: 80 })), 4736, 1e-9, "L default arm");
  // U 100 x 80, arm 20: 8,000 - (100 - 40)(80 - 20) = 8,000 - 3,600 = 4,400
  near(ringArea(shapeToRing({ type: "U", w: 100, d: 80, arm: 20 })), 4400, 1e-9, "U");
  // custom polygon given clockwise -> made CCW, area 50 x 50 / 2 = 1,250
  near(ringArea(shapeToRing({ type: "polygon", points: [[0, 0], [0, 50], [50, 0]] })), 1250, 1e-9, "custom");
  // bounding-box centring
  const tri = shapeToRing({ type: "triangle", w: 100, d: 80 });
  eq([Math.min(...tri.map((p) => p[1])), Math.max(...tri.map((p) => p[1]))], [-40, 40], "triangle centred by bbox");
});

test("L and U plates, setback on non-convex shape (Clipper path)", () => {
  // L 100 x 80 arm 30, 10 floors: 45,000 sf. All-sides setback 5 at floor 6 (mitered):
  // L with w 90, d 70, arm 20 at the same origin corner: 90 x 20 + (70 - 20) x 20 = 1,800 + 1,000 = 2,800.
  // GFA = 5 x 4,500 + 5 x 2,800 = 22,500 + 14,000 = 36,500.
  const s = base({ segments: [seg({ shape: { type: "L", w: 100, d: 80, arm: 30 } })], setbacks: [{ floor: 6, distance: 5, sides: ["front", "back", "left", "right"] }] });
  near(run(s).m.gfa, 36500, 0.01, "L inset");
  // U 100 x 80 arm 20, left-only setback 10 at floor 1: the left arm loses a 10 x 80 strip -> 4,400 - 800 = 3,600.
  near(run(base({ segments: [seg({ floors: 1, shape: { type: "U", w: 100, d: 80, arm: 20 } })], setbacks: [{ floor: 1, distance: 10, sides: ["left"] }] })).m.gfa, 3600, 1e-6, "U left");
});

test("setback before rotation (local frame)", () => {
  // rotation 90: the front setback acts on the local -y side, which ends up on world +x.
  // Plate 100 x 100 minus 10 ft local front -> 9,000 sf; world max x = 40 (local y min -40 rotated by 90).
  const r = run(base({ segments: [seg({ floors: 1, rotation: 90 })], setbacks: [{ floor: 1, distance: 10, sides: ["front"] }] }));
  near(r.m.gfa, 9000, 1e-9, "area");
  near(Math.max(...r.plates[0].polygons[0].outer.map((p) => p[0])), 40, 1e-9, "world +x side moved");
});

test("carve full -> sky gap: no GFA, height kept", () => {
  // Floors 4-5 removed: GFA = 8 x 10,000 = 80,000. Floor count 8, levels 10. Height still 100 ft.
  const r = run(base({ carves: [{ startFloor: 4, endFloor: 5, kind: "full" }] }));
  near(r.m.gfa, 80000, 1e-9, "gfa");
  eq([r.m.floorCount, r.m.levelCount, r.m.voidFloors], [8, 10, 2], "counts");
  near(r.m.totalHeight, 100, 1e-9, "height");
  eq([r.plates[3].void, r.plates[3].area, r.plates[3].polygons.length], [true, 0, 0], "void plate");
  eq(r.plates[5].z, 50, "floor 6 elevation unchanged");
});

test("corner carve that splits a plate: total area correct", () => {
  // Two corner carves on a 100 x 40 plate: SW 50 x 40 (full depth) leaves 50 x 40 on the east side;
  // a center carve 10 x 40 then... use a simpler split: a U plate with a 100 x 20 front carve across the base.
  // U 100 x 80 arm 20 = 4,400. SW carve w 100 d 20 removes the base 100 x 20 = 2,000 -> two arms 20 x 60 each = 2,400.
  const r = run(base({ segments: [seg({ floors: 1, shape: { type: "U", w: 100, d: 80, arm: 20 } })], carves: [{ startFloor: 1, endFloor: 1, kind: "corner", corner: "SW", w: 100, d: 20 }] }));
  eq(r.plates[0].polygons.length, 2, "split into 2 pieces");
  near(r.m.gfa, 2400, 1e-9, "area");
});

test("plate-empty warning after setbacks", () => {
  // All-sides 60 ft on a 100 ft square leaves nothing on floors 6-10.
  const r = run(base({ setbacks: [{ floor: 6, distance: 60, sides: ["front", "back", "left", "right"] }] }));
  const w = r.warnings.find((x) => x.code === "plate-empty");
  ok(w && w.message === "Floors 6–10 have no area after setbacks.", w && w.message);
  near(r.m.gfa, 50000, 1e-9, "gfa");
});

test("crown solids and height", () => {
  // Flat: 4 ft parapet ring 1 ft thick: 100^2 - 98^2 = 396 sf; adds no height.
  let r = run(base());
  eq(r.solids.length, 1); eq(r.solids[0].role, "parapet");
  near(multiPolyArea(r.solids[0].polygons), 396, 1e-9, "parapet ring");
  eq([r.solids[0].z0, r.solids[0].z1], [100, 104], "parapet z");
  // Screen 20 ft: same ring, height 100 + 20 = 120.
  r = run(base({ crown: { type: "screen", height: 20 } }));
  near(multiPolyArea(r.solids[0].polygons), 396, 1e-9, "screen ring"); near(r.m.totalHeight, 120, 1e-9, "screen height");
  // Stepped 3 x: inset s = min(8, 100/8) = 8 -> 84^2, 68^2, 52^2 prisms.
  r = run(base({ crown: { type: "stepped", height: 30, steps: 3 } }));
  eq(r.solids.map((x) => Math.round(multiPolyArea(x.polygons))), [7056, 4624, 2704], "steps");
  near(r.m.gfa, 100000, 1e-9, "crown adds no GFA");
  // Sloped and spire meshes
  for (const type of ["sloped", "spire"]) {
    r = run(base({ crown: { type, height: 25, slopeSide: "back" } }));
    ok(r.solids[0].kind === "mesh" && r.solids[0].indices.length > 0 && r.solids[0].indices.length % 3 === 0, type);
    const zs = r.solids[0].positions.filter((_, i) => i % 3 === 2);
    near(Math.max(...zs), 125, 1e-9, `${type} top`);
    near(r.m.totalHeight, 125, 1e-9, `${type} height`);
  }
});

test("metrics: plate min/max/avg, target check, inputs not mutated", () => {
  // Setback case 5: tower plates 10,000 and 6,400 -> min 6,400, max 10,000, avg 8,200.
  // Target GFA 100,000: 82,000 - 100,000 = -18,000 = -18%.
  const s = deepFreeze(base({ setbacks: [{ floor: 6, distance: 10, sides: ["front", "back", "left", "right"] }], targets: { gfa: 100000, far: 2 } }));
  const r = run(s);
  eq([r.m.plateMin, r.m.plateMax, r.m.plateAvg], [6400, 10000, 8200], "plates");
  near(r.m.target.gfa.diff, -18000, 1e-9); near(r.m.target.gfa.pct, -18, 1e-9);
  // FAR 82,000 / 50,000 = 1.64; target 2 -> -0.36 = -18%.
  near(r.m.target.far.diff, -0.36, 1e-9); near(r.m.target.far.pct, -18, 1e-9);
});

// Agent P's hand-calculated cases (src/tower/testcases.js) and presets run through this module too.
const { TEST_CASES } = await import("../src/tower/testcases.js");
for (const tc of TEST_CASES) {
  test(`testcases.js ${tc.id}`, () => {
    const { m } = run(tc.state);
    const tol = tc.expect.tolerancePct ?? 0.01;
    if (tc.expect.gfa != null) near(m.gfa, tc.expect.gfa, tol, "gfa");
    if (tc.expect.floors != null) eq(m.floorCount, tc.expect.floors, "floors");
    if (tc.expect.height != null) near(m.totalHeight, tc.expect.height, tol, "height");
  });
}
const { PRESETS } = await import("../src/tower/presets.js");
for (const p of PRESETS) {
  test(`preset ${p.id} builds without geometry warnings`, () => {
    const r = run(p.state);
    ok(r.plates.length > 0 && r.m.gfa > 0, "has plates");
    eq(r.warnings.map((w) => w.code), [], "warnings");
  });
}

/* ---------------------------------------------------------------- performance */
function perfState(kind) {
  const s = base({ segments: [seg({ floors: 150, shape: kind === "rect" ? rect(110, 80) : { type: "circle", w: 110, d: 110 } })] });
  if (kind === "heavy") {
    s.podium.on = true;
    s.segments = [
      seg({ floors: 100, shape: { type: "ellipse", w: 140, d: 90 }, taper: { x: -20, y: -10, curve: "eased" }, twist: { deg: 120, start: 0, end: 1, curve: "linear" }, lean: { x: 20, y: 0 } }),
      seg({ floors: 46, shape: { type: "rect", w: 90, d: 70, radius: 12 }, offset: { x: 10, y: 5 }, twist: { deg: 45, start: 0, end: 1, curve: "eased" } }),
    ];
    s.setbacks = [{ floor: 40, distance: 5, sides: ["front", "back", "left", "right"] }, { floor: 80, distance: 8, sides: ["front"] }];
    s.mechanical = [{ afterFloor: 50, ftf: 16 }, { afterFloor: 100, ftf: 16 }];
    s.carves = [{ startFloor: 30, endFloor: 34, kind: "corner", corner: "NE", w: 30, d: 30 }, { startFloor: 60, endFloor: 61, kind: "full" }, { startFloor: 110, endFloor: 120, kind: "center", w: 20, d: 20 }];
    s.cuts = [{ side: "front", angle: 20, startFloor: 90, endFloor: 152, depth: 25 }];
    s.crown = { type: "sloped", height: 30, slopeSide: "back" };
  }
  return s;
}
const timings = {};
for (const kind of ["rect", "circle", "heavy"]) {
  const s = perfState(kind);
  for (let i = 0; i < 20; i++) buildPlates(s);   // warm up the JIT
  const N = 50, t0 = performance.now();
  for (let i = 0; i < N; i++) buildPlates(s);
  timings[kind] = (performance.now() - t0) / N;
}
test("performance: 150 floors, full quality, buildPlates < 30 ms", () => {
  for (const [k, ms] of Object.entries(timings)) ok(ms < 30, `${k}: ${ms.toFixed(2)} ms`);
});

console.log(results.join("\n"));
console.log(`\nbuildPlates, 150+ floors, full quality (mean of 50 runs): ` +
  Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(2)} ms`).join(" · "));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
