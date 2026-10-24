// Run: node test/plate.rework.test.mjs
// Plan: docs/plate-planner-rework-plan.md, section 8.1 tests R1 to R9 (deep runs, the auto core, the depth cap,
// the advisor, old Tower files, presets, determinism), plus contract checks for core.js and advisor.js.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const FL = await import("../src/plate/fill.js");
const CO = await import("../src/plate/corridor.js");
const CR = await import("../src/plate/core.js");
const AD = await import("../src/plate/advisor.js");
const MT = await import("../src/plate/metrics.js");
const MX = await import("../src/plate/mix.js");
const DV = await import("../src/plate/derived.js");
const { PRESETS, defaultState } = await import("../src/plate/presets.js");
const { TEST_CASES } = await import("../src/plate/testcases.js");
const { buildPlates } = FL;
const { GEO } = CO;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.001, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ± ${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
const clone = (o) => JSON.parse(JSON.stringify(o));

const area = (r) => Math.abs(GEO.ringArea(r));
const mp = (rings) => rings.map((r) => ({ outer: r, holes: [] }));
const nrsfOf = (f) => f.units.reduce((s, u) => s + area(u.outer), 0);
const support = (f, kind) => f.support.filter((s) => s.kind === kind);
const fillOf = (state, opts) => buildPlates(state, opts).groups[0].fill;

/** Core rooms tile the core: Σ room areas = core area = union area (no overlap, no gap). */
function tiling(f) {
  const sum = f.coreRooms.reduce((s, r) => s + area(r.outer), 0);
  const uni = GEO.mpArea(GEO.bool("union", mp(f.coreRooms.map((r) => r.outer)), []));
  const gap = GEO.mpArea(GEO.bool("diff", mp([f.core]), mp(f.coreRooms.map((r) => r.outer))));
  return { sum, union: uni, core: area(f.core), gap };
}

/** The R1 state: a drawn 150 × 160 rect (x 150, y 160), no core in the level, core mode auto, corridor auto. */
function r1State() {
  const s = defaultState();
  s.plate.w = 150; s.plate.d = 160;
  s.core = { mode: "auto", rect: null };
  s.corridor.kind = "auto";
  return s;
}

console.log("plate rework");

/* ------------------------------------------------------------ R1 */

// Plate 150 × 160: GSF 24,000. Compact: area ÷ box = 1 ≥ 0.85; 160 ÷ 150 = 1.067 ≤ 1.6 → point with an auto core.
// Program: A = 0.10 × 525 + 0.45 × 725 + 0.10 × 900 + 0.30 × 1,100 + 0.05 × 1,400 = 868.75 sf;
//   U = 1 floor × round(24,000 × 0.75 ÷ 868.75) = round(20.72) = 21; cabs = max(2, ceil(21 ÷ 90)) = 2; service 0 (1 floor < 20).
//   Row 1: 2 cabs × 8 = 16; row 2: trash 8 + electrical 8 + shaft 6 = 22 → R = 22; row 1 gets a 6 ft shaft.
//   Core A = 2 × 11 + 22 = 44 along the long axis (y), B = 22: x −11..11, y −22..22, 968 sf. Rooms: S1, E1, E2, SH1, TR1, EL1, SH2, S2.
// Corridor clear ring: core + 5.67 → x ±16.67, y ±27.67; 33.34 × 55.34 − 968 = 1,845.04 − 968 = 877.04 sf.
// Depths: north and south 80 − 1 − 27.67 = 51.33; east and west 75 − 1 − 16.67 = 57.33. Every type is deep:
//   2BR areaMax ÷ d = 1,200 ÷ 51.33 = 23.4 < 32 (widthMin); studio 600 ÷ 51.33 = 11.7 < 20; no type drops.
// Corners: d = (51.33 + 57.33) ÷ 2 = 54.33; e = clamp((1,100 + 54.33²) ÷ 108.66 = 37.29, 54.33, 108.66) = 54.33.
//   The corner piece spans 57.33 along the north facade (> e: no leg) and 51.33 along the east facade, so the leg runs
//   3 ft into the east run: legs [57.33, 54.33]. Runs: north and south 33.34 (1 slot: a 2BR, 32 to 40); east and west
//   55.34 − 2 × 3 = 49.34 (2 slots). Units = 4 corners + 2 × 1 + 2 × 2 = 10.
// NRSF = inset 148 × 158 − corridor box 33.34 × 55.34 = 23,384 − 1,845.04 = 21,538.96; efficiency 21,538.96 ÷ 24,000 = 0.8975.
// Closure: GSF − (NRSF + corridor + core) = 24,000 − 21,538.96 − 877.04 − 968 = 616 = 1.0 × (2 × 33.34 + 2 × 49.34 + 4 × (57.33 + 54.33))
//   + 4 × 1.0² (corner squares) = 612 + 4 = 616.
t("R1 deep point plate 150 × 160: point, auto core 44 × 22 with 8 rooms that tile it, 10 units all filled, type-area-high", () => {
  const b = buildPlates(r1State());
  const f = b.groups[0].fill;
  eq(f.kind, "point"); eq(f.coreMode, "auto");
  eq(f.core, [[11, -22], [11, 22], [-11, 22], [-11, -22]], "core x −11..11, y −22..22");
  eq(f.coreProgram.size, [44, 22]); eq(f.coreProgram.cabs, 2); eq(f.coreProgram.service, 0); eq(f.coreProgram.units, 21);
  eq(f.coreRooms.map((r) => r.id), ["S1", "E1", "E2", "SH1", "TR1", "EL1", "SH2", "S2"]);
  eq(f.coreRooms.map((r) => Math.round(area(r.outer))), [242, 88, 88, 66, 88, 88, 66, 242], "11 × 22, 8 × 11, 6 × 11");
  const tl = tiling(f);
  near(tl.sum, 968, 1, "rooms sum"); near(tl.union, 968, 1, "no overlap"); near(tl.gap, 0, 1, "no empty core");
  eq(f.stairs.map((s) => s.id), ["S1", "S2"], "stairs from the rooms");
  ok(f.stairs.every((s) => Array.isArray(s.door)), "stairs keep doors");
  eq(f.elevators.map((e) => e.id), ["E1", "E2"], "cabs from the rooms");
  near(GEO.mpArea(f.corridor), 877.04, 0.05, "corridor");
  eq(f.runs.map((r) => [r.length, r.depth, r.slots]), [[33.34, 51.33, 1], [49.34, 57.33, 2], [33.34, 51.33, 1], [49.34, 57.33, 2]], "runs");
  eq(f.corners.map((c) => c.legs.slice().sort((a, b) => a - b)), [[54.33, 57.33], [54.33, 57.33], [54.33, 57.33], [54.33, 57.33]], "legs");
  eq(f.units.length, 10, "units");
  eq(support(f, "remainder").length, 0, "no remainder");
  ok(f.runs.every((r) => r.slots > 0), "every run filled");
  ok(f.units.every((u) => u.areaHigh), "every unit is larger than its range");
  near(nrsfOf(f), 21538.96, 0.5, "NRSF");
  const hi = f.warnings.filter((w) => w.code === "type-area-high");
  eq(hi.map((w) => w.where.type), ["studio", "1br", "1brden", "2br", "3br"], "one type-area-high per type");
  ok(hi.every((w) => w.severity === "info"));
  // 2BR at the deepest run, 57.33: 32 × 57.33 = 1,834.6 → 1,835; 40 × 57.33 = 2,293.2 → 2,293
  eq(hi[3].message, "At 57.3 ft deep, a 2BR 32 to 40 ft wide is 1,835 to 2,293 sf. Its area range is 1,000 to 1,200 sf. The units fill by width and show as large.");
  eq(f.warnings.filter((w) => w.code === "type-does-not-fit").length, 0, "no type-does-not-fit");
  eq(f.dropped, []);
  const m = MT.computeMetrics(r1State(), b);
  const row = m.groups[0].row;
  near(row.efficiency, 0.8975, 0.0001, "efficiency");
  ok(row.closure.ok, `closure ${JSON.stringify(row.closure)}`);
  near(row.closure.strip, 616, 1, "strip"); near(row.closure.expected, 616, 0.05, "expected");
});

/* ------------------------------------------------------------ R2, R3 */

// R2: U = 52 × round(23,364 × 0.75 ÷ 868.75) = 52 × round(20.170) = 52 × 20 = 1,040; cabs = max(2, ceil(1,040 ÷ 90)) =
// ceil(11.56) = 12; service 1 (52 floors ≥ 20). 12 > 6: banks of 6 and 6. Row 1: 6 × 8 + service 8 + trash 8 +
// electrical 8 + shaft 6 = 78; row 2: 6 × 8 = 48 + a 30 ft shaft = 78. A = 22 + 78 = 100; area 100 × 22 = 2,200 sf.
t("R2 coreProgram multifamily 52 floors, 23,364 sf: 12 passenger cabs (U = 1,040), 1 service; two banks", () => {
  const p = CR.coreProgram(defaultState(), { floors: 52, levelGsf: 23364, mode: "multifamily" });
  eq(p.units, 1040, "U"); eq(p.autoCabs, 12); eq(p.cabs, 12); eq(p.service, 1);
  eq(p.rows.row1.map((r) => [r.kind, r.len]), [["elevator", 8], ["elevator", 8], ["elevator", 8], ["elevator", 8], ["elevator", 8], ["elevator", 8], ["service-elevator", 8], ["trash", 8], ["electrical", 8], ["shaft", 6]]);
  eq(p.rows.row2.map((r) => [r.kind, r.len]), [["elevator", 8], ["elevator", 8], ["elevator", 8], ["elevator", 8], ["elevator", 8], ["elevator", 8], ["shaft", 30]]);
  eq(p.size, [100, 22]); eq(p.area, 2200);
  // the elevator count overrides the passenger count
  const s = defaultState(); s.elevators.count = 4;
  eq(CR.coreProgram(s, { floors: 52, levelGsf: 23364 }).cabs, 4);
  // the layout tiles a turned core too (axis 0.6, 0.8)
  const lay = CR.coreLayout2(p, [10, 20], [0.6, 0.8], defaultState());
  const sum = lay.rooms.reduce((a, r) => a + area(r.outer), 0);
  near(sum, 2200, 0.5, "rooms sum"); near(area(lay.outer), 2200, 0.5, "core");
  near(GEO.mpArea(GEO.bool("union", mp(lay.rooms.map((r) => r.outer)), [])), 2200, 0.5, "no overlap");
  eq(lay.rect, null, "a turned core has no rect");
  eq(lay.rooms.filter((r) => r.kind === "elevator").length, 12); eq(lay.rooms.filter((r) => r.kind === "service-elevator").map((r) => r.id), ["SE1"]);
});

// R3: K = 12 × round(14,400 × 0.75 ÷ 400) = 12 × round(27.0) = 324; cabs = max(2, ceil(324 ÷ 100)) = ceil(3.24) = 4.
// The plan table expects 2; its own formula gives 4 (reported). A 7,200 sf plate: K = 12 × round(13.5) = 12 × 14 = 168
// → max(2, ceil(1.68)) = 2 passenger + 1 service. Row 2: service 8 + trash 8 + electrical 8 + linen 14 + ice 6 + data 6
// + shaft 6 = 56; row 1: 2 × 8 = 16 + a 40 ft shaft. A = 22 + 56 = 78; area 1,716 sf.
t("R3 coreProgram hotel 12 floors: 14,400 sf → 4 + 1 (formula); 7,200 sf → 2 + 1; linen, ice, data rooms", () => {
  const h = defaultState(); h.mode = "hotel";
  const p = CR.coreProgram(h, { floors: 12, levelGsf: 14400 });
  eq([p.units, p.cabs, p.service], [324, 4, 1]);
  const q = CR.coreProgram(h, { floors: 12, levelGsf: 7200 });
  eq([q.units, q.cabs, q.service], [168, 2, 1]);
  eq(q.rows.row2.map((r) => r.kind), ["service-elevator", "trash", "electrical", "linen", "ice", "data", "shaft"]);
  eq(q.rows.row1.map((r) => [r.kind, r.len]), [["elevator", 8], ["elevator", 8], ["shaft", 40]]);
  eq(q.size, [78, 22]);
  for (const k of ["linen", "ice", "data"]) ok(q.rooms.some((r) => r.kind === k), k);
  // back-of-house off: no linen, ice, data
  const off = clone(h); off.hotelBoh.on = false;
  ok(!CR.coreProgram(off, { floors: 12, levelGsf: 7200 }).rooms.some((r) => r.kind === "linen"));
});

/* ------------------------------------------------------------ R4 */

// Advisor on R1, target 30 ft (+ 2 = 32; every run is deeper). R1 has 0 of 10 units in range: every unit is above its
// areaMax (average 21,538.8 ÷ 10 = 2,153.9 sf; target 868.75 → 869 sf). The plate is a rectangle (area ÷ box = 1).
// Search: area depths 28 … 36 ft. Point sides: y (long, u) = 44 + 2 × 5.67 + 2 × (du + 1); x (short, n) = 22 + 11.34 +
// 2 × (dn + 1); the core for each candidate: 1 floor, U = round(GSF × 0.75 ÷ 868.75) → 2 cabs, 44 × 22.
// Best: du = 32, dn = 29 → y = 44 + 11.34 + 66 = 121.34, x = 22 + 11.34 + 60 = 93.34; GSF 93.34 × 121.34 = 11,325.9.
// The real fill of that drawn rect: 10 units, 10 in range, NRSF 9,055.6, efficiency 0.7995; no unfilled run.
// gainUnits = 10 − 0 = 10; gain = 24,000 − 11,325.9 = 12,674.1 sf less per floor.
t("R4 advisor on R1: plate-too-deep picks a searched size with no unfilled run and more units in range", () => {
  const s = r1State();
  const b = buildPlates(s);
  const m = MT.computeMetrics(s, b);
  const row = m.groups[0].row;
  eq([row.inRange, row.areaHighCount, row.avgArea, row.targetAvgArea], [0, 10, 2153.9, 868.8], "R1 range metrics");
  eq([m.building.inRange, m.building.areaHighCount], [0, 10]);
  const t0 = performance.now();
  const list = AD.advise(s, b, m, { fillPlate: buildPlates });
  const ms = performance.now() - t0;
  console.log(`       advise(R1) ${ms.toFixed(0)} ms, ${list[0].suggested.tested} sizes filled`);
  ok(ms < 300, `${ms} ms`);
  const a = list[0];
  eq(a.code, "plate-too-deep");
  eq(a.suggested.depths, { long: 32, short: 29 });
  eq(a.suggested.size, { long: 121.34, short: 93.34 });
  eq([a.suggested.plate.w, a.suggested.plate.d], [93.34, 121.34]);
  const tf = fillOf({ ...clone(s), plate: { ...s.plate, w: 93.34, d: 121.34 } });
  eq(support(tf, "remainder").length, 0, "the best candidate has no unfilled run");
  const tfRow = MT.computeMetrics(s, buildPlates({ ...clone(s), plate: { ...s.plate, w: 93.34, d: 121.34 } })).groups[0].row;
  eq([tfRow.units, tfRow.inRange], [10, 10], "the test fit is a real fill");
  ok(tfRow.inRange > row.inRange, "more units in range than R1");
  eq([a.suggested.units, a.suggested.inRange], [10, 10]);
  near(a.suggested.gsf, 11325.9, 0.05); near(a.suggested.nrsf, 9055.6, 0.5); near(a.suggested.efficiency, 0.7995, 0.0001);
  eq(a.gainUnits, 10); near(a.gain, 12674.1, 0.05);
  eq(a.message, "The units are 51.3 to 57.3 ft deep. The target is 30 ft. 10 of 10 units are larger than their area range (average 2,154 sf, target 869 sf). Narrow the plate to 93.3 × 121.3 ft on the Plate tab. Test fit at that size: 10 units, 10 in range, 80.0% efficiency.");
  ok(!/[;]|n't/.test(a.message), "no semicolons or contractions");
  // a project source names the Tower Generator
  const pb = { ...b, source: "project" };
  ok(/ in the Tower Generator\./.test(AD.advise(s, pb, m, { fillPlate: buildPlates })[0].message), "project wording");
  // a larger target depth gives no plate-too-deep
  ok(!AD.advise({ ...s, targetDepth: 60 }, b, m, { fillPlate: buildPlates }).some((x) => x.code === "plate-too-deep"));
  for (let i = 1; i < list.length; i++) ok(list[i - 1].gainUnits >= list[i].gainUnits, "sorted by units in range gained");
  // 8.1: every unit in range
  const r81 = MT.computeMetrics(PRESETS[0].state, buildPlates(clone(PRESETS[0].state))).groups[0].row;
  eq([r81.inRange, r81.areaHighCount, r81.units], [17, 0, 17]);
});

/* ------------------------------------------------------------ R5 */

// Manual core [−25, −47, 25, 47] = 50 × 94 = 4,700 sf on the R1 plate. Program (1 floor, 21 units): 44 × 22 = 968 sf;
// 4,700 > 1.25 × 968 = 1,210 → core-oversize, gain 4,700 − 968 = 3,732 sf per floor.
// The east and west runs are 75 − 1 − 30.67 = 43.33 ft deep, so plate-too-deep also shows (with an auto core in its test
// fit); it sorts first because it gains units in range (gainUnits > 0) and core-oversize gains none.
t("R5 advisor on a manual 4,700 sf core: core-oversize with a gain of 3,732 sf", () => {
  const s = r1State(); s.core = { mode: "manual", rect: [-25, -47, 25, 47] };
  const b = buildPlates(s);
  const f = b.groups[0].fill;
  eq(f.coreMode, "manual"); eq(f.kind, "point");
  const list = AD.advise(s, b, MT.computeMetrics(s, b), { fillPlate: buildPlates });
  const c = list.find((x) => x.code === "core-oversize");
  ok(c, "core-oversize");
  near(c.gain, 3732, 0.05); near(c.current.coreSf, 4700, 0.05); near(c.suggested.coreSf, 968, 0.05);
  eq(c.message, "The core is 4,700 sf. The program needs 968 sf. Reset the core to auto to gain about 3,732 sf per floor.");
  eq(list.map((x) => x.code), ["plate-too-deep", "core-oversize"]);
  ok(list[0].gainUnits > 0 && c.gainUnits === 0, "sort by units in range gained");
  // presets 8.1, 8.5, 8.6 have small manual cores: no core-oversize
  for (const id of ["double-loaded-bar", "point-tower", "courtyard-typed-o"]) {
    const ps = clone(PRESETS.find((p) => p.id === id).state);
    const pb = buildPlates(ps);
    ok(!AD.advise(ps, pb, MT.computeMetrics(ps, pb), { fillPlate: buildPlates }).some((x) => x.code === "core-oversize"), id);
  }
});

/* ------------------------------------------------------------ R6 */

// Depth cap 30 on R1: every run is cut to 30 ft deep from the area line; the rest of each band is support "trim".
// Corners: d = 30 → e = (1,100 + 900) ÷ 60 = 33.33 < the corner piece (57.33 and 51.33): no legs; each wrap is the corner
// piece within 30 ft of a facade: 57.33 × 51.33 − 27.33 × 21.33 = 2,942.75 − 582.95 = 2,359.8 (above 1,200: area-high).
// Runs: north and south 33.34 × 30 = 1,000.2 each; east and west 55.34 × 30 = 1,660.2 each.
// NRSF = 2 × 1,000.2 + 2 × 1,660.2 + 4 × 2,359.8 = 14,760.0; trim = 21,538.96 − 14,760.0 = 6,778.96.
t("R6 depth cap 30 on R1: units 30 ft deep, trim support 6,779 sf, area closure within 1 sf", () => {
  const s = r1State(); s.fill = { maxDepth: 30 };
  const b = buildPlates(s);
  const f = b.groups[0].fill;
  eq(f.maxDepth, 30);
  eq(f.runs.map((r) => [r.length, r.depth]), [[33.34, 30], [55.34, 30], [33.34, 30], [55.34, 30]]);
  for (const u of f.units.filter((x) => !x.wrap)) {
    const d = u.demising.map((l) => Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]));
    for (const v of d) near(v, 30, 0.002, `${u.id} depth`);
  }
  near(nrsfOf(f), 14760.0, 0.5, "NRSF");
  const tr = support(f, "trim");
  ok(tr.length > 0, "trim support");
  near(tr.reduce((a, x) => a + area(x.outer), 0), 6778.96, 0.5, "trim area");
  ok(tr.every((x) => x.why === "depth-cap"));
  for (const w of f.units.filter((x) => x.wrap)) { near(area(w.outer), 2359.8, 0.1, "capped corner"); ok(w.areaHigh, "corner area-high"); }
  const row = MT.computeMetrics(s, b).groups[0].row;
  ok(row.closure.ok, JSON.stringify(row.closure)); near(row.closure.diff, 0, 1);
  eq(row.support.byKind.trim.count, tr.length);
  // the group key wins over the global key; a group value of null falls back to the global one
  const g = b.groups[0].id;
  const s2 = clone(s); s2.levels.groups = { [g]: { maxDepth: 40 } };
  eq(fillOf(s2).runs.map((r) => r.depth), [40, 40, 40, 40]);
  const s3 = clone(s); s3.levels.groups = { [g]: { maxDepth: null } };
  eq(fillOf(s3).runs.map((r) => r.depth), [30, 30, 30, 30]);
});

/* ------------------------------------------------------------ R7 */

// An old project file: a Tower level that still carries its 40 × 30 core ring. The fill ignores it (rework plan 4.2):
// the fill is byte-equal to the same level with core null, and it has the auto core of R1 (44 × 22).
t("R7 old project level with a Tower core ring: the ring is ignored, the core is auto", () => {
  const level = (core) => ({ index: 5, name: "Level 5", zone: "tower", z: 50, ftf: 11, program: "residential",
    plates: [{ outer: [[-75, -80], [75, -80], [75, 80], [-75, 80]], holes: [] }], core, spines: [], seeds: [] });
  const proj = (core) => deepFreeze({ sections: { massing: { tool: "tower", updatedAt: "2026-10-01T00:00:00.000Z", derived: { levels: [level(core)] } } } });
  const s = defaultState(); s.source = "project"; s.corridor.kind = "auto"; s.core = { rect: null };     // no mode: the load rule gives auto
  eq(CO.coreModeOf(s), "auto");
  const a = buildPlates(s, { project: proj([[-20, -15], [20, -15], [20, 15], [-20, 15]]) });
  const b = buildPlates(s, { project: proj(null) });
  ok(JSON.stringify(a) === JSON.stringify(b), "the massing core changes nothing");
  const f = a.groups[0].fill;
  eq(f.coreMode, "auto"); eq(f.kind, "point"); eq(f.core, [[11, -22], [11, 22], [-11, 22], [-11, -22]]);
});

/* ------------------------------------------------------------ R8 */

// The section 8 values of presets 8.1 to 8.6 (TEST_CASES), with the core modes of rework plan 4.2: 8.1, 8.5 and 8.6
// carry an explicit core rect (manual); 8.2 to 8.4 have none (auto on bars and an L or U: no core block).
t("R8 presets 8.1 to 8.6: section 8 values unchanged; 8.5 keeps its explicit core as manual", () => {
  const modes = { "double-loaded-bar": "manual", "hotel-bar": "none", "l-plate-60-ft-arms": "none", "u-plate-60-ft-arms": "none", "point-tower": "manual", "courtyard-typed-o": "manual" };
  for (const tc of TEST_CASES) {
    const b = buildPlates(clone(tc.state));
    const f = b.groups[0].fill;
    const row = MT.computeMetrics(tc.state, b).groups[0].row;
    const e = tc.expect;
    if (e.units != null) eq(row.units, e.units, `${tc.id} units`);
    if (e.keys != null) eq(row.keys, e.keys, `${tc.id} keys`);
    if (e.bays != null) eq(row.bays, e.bays, `${tc.id} bays`);
    near(row.nrsf, e.nrsf, e.tolerance, `${tc.id} NRSF`);
    near(row.efficiency, e.efficiency, e.efficiencyTolerance, `${tc.id} efficiency`);
    eq(f.corners.length, e.corners, `${tc.id} corners`);
    eq(support(f, "pocket").length, e.pockets, `${tc.id} pockets`);
    ok(row.closure.ok, `${tc.id} closure`);
    eq(f.coreMode, modes[tc.id], `${tc.id} core mode`);
    eq(f.coreRooms, [], `${tc.id} no auto core`);
  }
  const p85 = PRESETS.find((p) => p.id === "point-tower").state;
  eq(p85.core, { mode: "manual", rect: [-15, -15, 15, 15] });
  eq(fillOf(clone(p85)).core, [[-15, -15], [15, -15], [15, 15], [-15, 15]], "8.5 core");
  // the load rule: a stored rect with no mode is manual; no rect and no mode is auto
  eq(CR.normalizeCore({ rect: [-15, -15, 15, 15] }), { mode: "manual", rect: [-15, -15, 15, 15] });
  eq(CR.normalizeCore({ rect: null }), { mode: "auto", rect: null });
  eq(CR.normalizeCore({ mode: "none", rect: null }), { mode: "none", rect: null });
  eq(CR.normalizeCore(undefined), { mode: "auto", rect: null });
  const old = clone(p85); delete old.core.mode;
  eq(fillOf(old).core, [[-15, -15], [15, -15], [15, 15], [-15, 15]], "8.5 without a mode loads as manual");
});

/* ------------------------------------------------------------ R9 */

t("R9 determinism of R1: byte-equal twice (fill, metrics, advisor)", () => {
  const run = () => {
    const s = r1State();
    const b = buildPlates(s);
    const m = MT.computeMetrics(s, b);
    return JSON.stringify({ b, m, a: AD.advise(s, b, m, { fillPlate: buildPlates }) });
  };
  ok(run() === run(), "byte-equal");
});

/* ------------------------------------------------------------ the deep-run rule in mix.js */

// At d = 47.1: 2BR lo = max(32, 1,000 ÷ 47.1 = 21.2) = 32, hi = min(40, 1,200 ÷ 47.1 = 25.5) = 25.5 → lo > hi and
// 1,200 ÷ 47.1 < 32: deep → lo 32, hi 40, w = clamp(1,100 ÷ 47.1 = 23.4, 32, 40) = 32; areaLo 32 × 47.1 = 1,507.2,
// areaHi 40 × 47.1 = 1,884. At d = 26.165 the den and the 3BR are too shallow (850 ÷ 26.165 = 32.49 > 32): they drop.
t("effectiveTypes: deep types keep their width range (areaOff deep); shallow types still drop", () => {
  const e = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 47.1);
  eq(e.dropped, []);
  eq(e.deep.map((d) => d.id), ["studio", "1br", "1brden", "2br", "3br"]);
  const t2 = e.types.find((x) => x.id === "2br");
  eq([t2.lo, t2.hi, t2.w, t2.areaOff], [32, 40, 32, "deep"]);
  const d2 = e.deep.find((x) => x.id === "2br");
  near(d2.areaLo, 1507.2, 1e-9); near(d2.areaHi, 1884, 1e-9);
  near(e.types.reduce((s, x) => s + x.share, 0), 1, 1e-12, "shares");
  const s = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 26.165);
  eq(s.dropped.map((x) => x.id), ["1brden", "3br"]); eq(s.deep, []);
  ok(MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 28.665).types.every((x) => !x.areaOff), "8.1 depth: no flag");
});

/* ------------------------------------------------------------ corridor kind auto */

t("corridorKind auto: spines → bar; manual core → point; compact + auto → point with an auto core; else bar", () => {
  const rect = (w, d) => [{ outer: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], holes: [] }];
  const s = r1State();
  eq(CO.corridorKind(rect(150, 160), null, s), { kind: "point", core: "auto" });
  eq(CO.corridorKind(rect(300, 65), null, s), { kind: "bar", core: null }, "300 ÷ 65 = 4.6 > 1.6");
  eq(CO.corridorKind(rect(160, 100), null, s), { kind: "point", core: "auto" }, "1.6 is compact");
  eq(CO.corridorKind(rect(161, 100), null, s), { kind: "bar", core: null }, "1.61 is not");
  eq(CO.corridorKind(rect(150, 160), { spines: [[[-75, 0], [75, 0]]] }, s), { kind: "bar", core: null });
  eq(CO.corridorKind(rect(150, 160), null, { ...s, core: { mode: "none", rect: null } }), { kind: "bar", core: null });
  eq(CO.corridorKind(rect(150, 160), null, { ...s, core: { mode: "manual", rect: [-10, -10, 10, 10] } }), { kind: "point", core: "manual" });
  // L plate (8.3): 16,800 ÷ (200 × 140) = 0.6 < 0.85; O plate: a hole
  const L = [{ outer: [[0, 0], [200, 0], [200, 60], [60, 60], [60, 140], [0, 140]], holes: [] }];
  eq(CO.corridorKind(L, null, s).kind, "bar");
  eq(CO.isCompact([{ outer: rect(150, 160)[0].outer, holes: [[[-5, -5], [-5, 5], [5, 5], [5, -5]]] }]), false);
  // a bar with core mode auto: no core block, cabs beside the corridor (8.1 without its core)
  const bar = clone(PRESETS[0].state); bar.core = { mode: "auto", rect: null };
  const f = fillOf(bar);
  eq([f.kind, f.coreMode, f.core], ["bar", "none", null]);
  eq(f.elevators.length, 2, "two cabs beside the corridor");
});

/* ------------------------------------------------------------ a turned compact plate */

// A 150 × 130 rectangle turned 30 degrees: the auto core follows the long axis (cos 30, sin 30); rooms tile it; closure.
t("turned compact plate: the auto core turns with the plate, rooms tile it, every corner wraps, closure", () => {
  const a = Math.PI / 6, c = Math.cos(a), sn = Math.sin(a);
  const rot = (x, y) => [Math.round((x * c - y * sn) * 1000) / 1000, Math.round((x * sn + y * c) * 1000) / 1000];
  const s = r1State();
  s.plate = { ...s.plate, shape: "polygon", points: [rot(-75, -65), rot(75, -65), rot(75, 65), rot(-75, 65)] };
  const b = buildPlates(s);
  const f = b.groups[0].fill;
  eq([f.kind, f.coreMode], ["point", "auto"]);
  const e0 = [f.core[1][0] - f.core[0][0], f.core[1][1] - f.core[0][1]];
  near(Math.abs(Math.atan2(e0[1], e0[0]) * 180 / Math.PI) % 90, 30, 0.01, "core edge at 30 degrees");
  const tl = tiling(f);
  near(tl.sum, 968, 1); near(tl.gap, 0, 1);
  eq(f.corners.length, 4, "four wrap corners");
  eq(support(f, "leftover").length, 0, "no leftover");
  ok(MT.computeMetrics(s, b).groups[0].row.closure.ok, "closure");
});

/* ------------------------------------------------------------ hotel point plate */

// Hotel, corridor point, 120 × 110, 1 floor: K = round(13,200 × 0.75 ÷ 400) = round(24.75) = 25 → 2 cabs + 1 service;
// the core holds the linen closet, so housekeeping reach reads it and no separate back-of-house block is added.
t("hotel point plate: the auto core holds service, linen, ice, data; reach reads the core linen; closure", () => {
  const h = defaultState(); h.mode = "hotel"; h.core = { mode: "auto", rect: null }; h.corridor.kind = "point"; h.plate.w = 120; h.plate.d = 110;
  const b = buildPlates(h);
  const f = b.groups[0].fill;
  eq(f.coreRooms.map((r) => r.id), ["S1", "E1", "E2", "SE1", "SH1", "TR1", "EL1", "LN1", "IC1", "DA1", "SH2", "S2"]);
  eq(f.elevators.map((e) => [e.id, e.service]), [["E1", false], ["E2", false], ["SE1", true]]);
  ok(!f.support.some((x) => x.id && String(x.id).startsWith("BOH")), "no separate back-of-house");
  ok(f.graph.reach && f.graph.reach.keys === f.units.length, "reach from the core linen");
  const row = MT.computeMetrics(h, b).groups[0].row;
  ok(row.closure.ok, JSON.stringify(row.closure));
  ok(row.hotel && row.hotel.within === f.units.length, "metrics reach");
});

/* ------------------------------------------------------------ support kinds, checks, derived */

t("support kinds: remainder only for an unfilled run; leftover beside blocks; pocket; trim", () => {
  // 8.1: the four 11 × 21.5 pieces beside the stairs are leftovers, not unfilled runs
  const f = fillOf(clone(PRESETS[0].state));
  eq(support(f, "leftover").length, 4); eq(support(f, "remainder").length, 0);
  // a 15 ft run: the unfilled run is a remainder
  const s = clone(PRESETS[0].state); s.core.rect = [-150 + 11 + 15, 2.835, 15, 32.5];
  const g = fillOf(s);
  ok(g.warnings.some((w) => w.code === "run-too-short"), "run-too-short");
  ok(support(g, "remainder").every((x) => x.why === "run-too-short") && support(g, "remainder").length >= 1, "remainder from the short run");
  // the advisor names it
  const b = buildPlates(s);
  const un = AD.advise(s, b, MT.computeMetrics(s, b), { fillPlate: buildPlates }).find((x) => x.code === "unfilled-runs");
  ok(un && /^1 run is unfilled \(\d{1,3}(,\d{3})* sf\)\. Move a stair or the core, or fill the run by hand\.$/.test(un.message), un && un.message);
});

t("checks: de-duplicated by code + where; the badge count is the list length", () => {
  const s = r1State();
  const b = buildPlates(s);
  const dup = clone(b);
  dup.groups[0].fill.warnings = [...dup.groups[0].fill.warnings, ...clone(dup.groups[0].fill.warnings)];
  const m = MT.computeMetrics(s, dup);
  const keys = m.warnings.map((w) => `${w.code}|${JSON.stringify(w.where)}`);
  eq(new Set(keys).size, keys.length, "no duplicate");
  eq(m.warnings.length, MT.computeMetrics(s, b).warnings.length, "same list as without the copies");
  ok(m.warnings.some((w) => w.code === "type-area-high"), "type-area-high passes through");
});

t("derived: core.rooms on an auto core, unit flags area-high, validate shape", () => {
  const s = r1State();
  const b = buildPlates(s);
  const d = DV.platesDerived(s, b, MT.computeMetrics(s, b));
  const lv = d.levels[0];
  eq(lv.core.rooms.map((r) => r.kind), ["stair", "elevator", "elevator", "shaft", "trash", "electrical", "shaft", "stair"]);
  near(lv.core.rooms.reduce((a, r) => a + area(r.outer), 0), area(lv.core.outer), 1, "rooms tile the core");
  ok(lv.units.every((u) => JSON.stringify(u.flags) === '["area-high"]'), "flags");
  const d81 = DV.platesDerived(PRESETS[0].state, buildPlates(clone(PRESETS[0].state)), null);
  ok(!("rooms" in d81.levels[0].core), "no rooms on a manual core");
  ok(d81.levels[0].units.every((u) => !("flags" in u)), "no flags on 8.1");
});

t("contract: core.js and advisor.js export and import lines; no input mutation; missing inputs name themselves", () => {
  const src = readFileSync(new URL("../src/plate/core.js", import.meta.url), "utf8") + readFileSync(new URL("../src/plate/advisor.js", import.meta.url), "utf8");
  for (const line of src.split("\n")) if (/^\s*export\b/.test(line)) ok(/^export (function|const) /.test(line), `export line: ${line}`);
  for (const line of src.split("\n")) if (/^\s*import\b/.test(line)) ok(/^import .* from "\.\.?\/[^"]+";$/.test(line), `import line: ${line}`);
  ok(!/from "\.\/fill\.js"/.test(src), "advisor.js does not import fill.js (fillPlate is injected)");
  const s = deepFreeze(r1State());
  const b = deepFreeze(buildPlates(s));
  const m = deepFreeze(MT.computeMetrics(s, b));
  AD.advise(s, b, m, { fillPlate: buildPlates });
  const s6 = deepFreeze(Object.assign(r1State(), { fill: { maxDepth: 30 } }));
  buildPlates(s6);
  let msg = "";
  try { CR.coreProgram(defaultState(), { floors: 3 }); } catch (e) { msg = e.message; }
  ok(/levelGsf/.test(msg), msg);
  try { AD.advise(null, b, m); } catch (e) { msg = e.message; }
  ok(/state/.test(msg), msg);
  // advise without fillPlate: no test fit, still the item
  const a = AD.advise(s, b, m);
  eq(a[0].code, "plate-too-deep"); ok(!("efficiency" in a[0].suggested), "no test fit");
});

t("performance: a 39-unit level (8.6) fills in well under 50 ms", () => {
  const st = clone(PRESETS.find((p) => p.id === "courtyard-typed-o").state);
  for (let i = 0; i < 3; i++) buildPlates(st);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) buildPlates(st);
  const ms = (performance.now() - t0) / 5;
  console.log(`       8.6 buildPlates ${ms.toFixed(1)} ms (two fills: the Type A pass)`);
  ok(ms < 50, `${ms} ms`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
