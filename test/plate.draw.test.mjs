// Run: node test/plate.draw.test.mjs
// Plan: docs/plate-planner-draw-plan.md section 6, tests D1 to D12, plus contract checks (exports, no input mutation,
// determinism, speed, ASD-STE100 text). The arithmetic of every fixed number is in the comments.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const FL = await import("../src/plate/fill.js");
const CO = await import("../src/plate/corridor.js");
const DR = await import("../src/plate/draw.js");
const SG = await import("../src/plate/suggest.js");
const MT = await import("../src/plate/metrics.js");
const DV = await import("../src/plate/derived.js");
const LV = await import("../src/plate/levels.js");
const AD = await import("../src/plate/advisor.js");
const { PRESETS, defaultState } = await import("../src/plate/presets.js");
const { TEST_CASES } = await import("../src/plate/testcases.js");
const { assemble } = await import("../src/midrise/assemble.js");
const { midriseDerived } = await import("../src/midrise/derived.js");
const MR = await import("../src/midrise/presets.js");
const { buildPlates, fillPlates, layoutLevel } = FL;
const { paintUnit, freeUnit, pickType, retype, splitUnit, mergeUnits, moveBayLine, migrateUnits, toStateUnit, cornerUnit } = DR;
const { suggestRun, suggestCorner, placedCounts } = SG;
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
const preset = (id) => clone(PRESETS.find((p) => p.id === id).state);
const blank = (id) => { const s = preset(id); s.units = []; return s; };
const layOf = (s, opts) => buildPlates(s, opts).groups[0].fill;
const rowOf = (s, opts) => { const b = buildPlates(s, opts); return MT.computeMetrics(s, b).groups[0].row; };
const T81 = PRESETS[0].state.mix.multifamily;

/** Numbers of two derived objects agree within 0.0015; every other value is equal. → [paths that differ] */
function diffs(a, b, path = "", out = []) {
  if (out.length > 5) return out;
  if (typeof a === "number" && typeof b === "number") { if (Math.abs(a - b) > 0.0015) out.push(`${path}: ${a} vs ${b}`); return out; }
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`); else a.forEach((x, i) => diffs(x, b[i], `${path}[${i}]`, out)); return out; }
  if (a && b && typeof a === "object" && typeof b === "object") { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[k], b[k], `${path}.${k}`, out); return out; }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

console.log("plate draw-first");

/* ------------------------------------------------------------ D1 blank plate */

// Default state "Blank point tower": 106 × 117 ft, auto core. GSF 106 × 117 = 12,402. Inset (extWall 1) 104 × 115 = 11,960.
// Auto core 33 × 44 = 1,452 (stairs and cabs inside it). Point corridor: the core grown by 5.67 → 44.34 × 55.34 = 2,453.8,
// less the core = 1,001.8. Open area = 11,960 − 2,453.8 = 9,506.2. Exterior allowance = 12,402 − 11,960 = 442.
// Closure: 0 + 1,001.8 + 1,452 + 9,506.2 + 442 = 12,402.0. Run depths: (106 − 44.34) ÷ 2 − 1 = 29.83 and
// (117 − 55.34) ÷ 2 − 1 = 29.83, near the 30 ft target: the advisor gives no item.
t("D1 blank plate: 0 units; free covers every run; closure within 1 sf; only the info line 'No units drawn yet'", () => {
  const s = defaultState();
  eq(s.name, "Blank point tower"); eq(s.units, []); eq(s.core, { mode: "auto", rect: null });
  eq(PRESETS.find((p) => p.id === "blank-point-tower").state, s, "the preset is the default state");
  const b = buildPlates(s);
  const f = b.groups[0].fill;
  eq(f.layout, true); eq(f.kind, "point"); eq(f.coreMode, "auto");
  eq(f.units.length, 0, "units");
  eq(f.runs.length, 4, "runs");
  for (const r of f.runs) {
    const fr = f.free.filter((x) => x.runId === r.id);
    eq(fr.length, 1, `${r.id} one open stretch`); near(fr[0].a, 0, 1e-9); near(fr[0].b, r.length, 0.001, `${r.id} the stretch is the run`);
  }
  eq(f.cornerZones.length, 4, "four empty corner zones");
  near(area(f.core), 1452, 0.01, "core 33 × 44");
  near(f.openArea, 9506.2, 0.2, "open area");
  near(f.allowance, 442, 0.1, "allowance");
  for (const r of f.runs) near(r.depth, 29.83, 0.001, `${r.id} depth`);
  eq(f.coreFits, true, "auto core");
  eq(AD.advise(s, b, MT.computeMetrics(s, b), { fillPlate: fillPlates }), [], "no advice on the default plate");
  const m = MT.computeMetrics(s, b);
  const c = m.groups[0].row.closure;
  ok(c.ok, JSON.stringify(c)); near(c.open, 9506.2, 0.2); near(c.corridor, 1001.8, 0.1);
  near(c.nrsf + c.corridor + c.core + c.stairs + c.elevators + c.support + c.open + c.expected, 12402, 1, "closure sum");
  eq(m.warnings.map((w) => [w.code, w.severity, w.message]), [["no-units", "info", "No units drawn yet."]], "warnings");
  eq(m.groups[0].row.openArea, 9506.2);
});

/* ------------------------------------------------------------ D2 paint */

// 8.1 blank. South run R1 starts at x −139 (the west stair face). Depth d = (65 − 5.67) ÷ 2 − 1 = 28.665.
// 30 ft: x −139 to −109, y −31.5 to −2.835 → 30 × 28.665 = 859.95 → 860.0 sf. 1BR + den 850 to 950: in range.
t("D2 paintUnit 30 ft on the 8.1 south run: 30 × 28.665 rectangle, 860 sf, 1BR + den in range", () => {
  const s = blank("double-loaded-bar");
  const f = layOf(s);
  eq(f.runs[0].id, "R1"); near(f.runs[0].length, 278, 1e-9); near(f.runs[0].depth, 28.665, 1e-9);
  const p = paintUnit(f, s, "R1", 0, 30);
  eq(p.unit.mode, "run"); eq(p.unit.id, "U-01");
  const xs = p.unit.outer.map((q) => q[0]), ys = p.unit.outer.map((q) => q[1]);
  eq(p.unit.outer.length, 4, "rectangle");
  near(Math.min(...xs), -139, 1e-9); near(Math.max(...xs), -109, 1e-9); near(Math.min(...ys), -31.5, 1e-9); near(Math.max(...ys), -2.835, 1e-9);
  near(p.width, 30, 1e-9); near(p.area, 860, 0.05);
  eq([p.unit.type, p.match], ["1brden", "in-range"]);
  // snap: 29.8 ft rounds to 30.0 (0.5 ft steps); the press point 0.3 ft from the run start moves onto it
  const q = paintUnit(f, s, "R1", 0.3, 30.1);
  eq(q.snapped, [0, 30]);
  const n = paintUnit(f, s, "R1", 10, 10.4);
  eq(n.refused, "too-narrow", "under 1 ft");
});

/* ------------------------------------------------------------ D3 paint over a neighbor */

// A unit at s 40 to 70 (x −99 to −69). A drag from s 10 to s 60 stops at s 40: the neighbor's cut line x = −99.
// The new unit is s 10 to 40 = 30 ft. A press at s 50 is on the unit: refused.
t("D3 paint over a neighbor: the unit stops at the neighbor's cut line", () => {
  const s = blank("double-loaded-bar");
  const f0 = layOf(s);
  s.units = [toStateUnit(paintUnit(f0, s, "R1", 40, 70).unit, [])];
  const f = layOf(s);
  eq(f.free.filter((x) => x.runId === "R1").map((x) => [x.a, x.b]), [[0, 40], [70, 278]], "open stretches");
  const p = paintUnit(f, s, "R1", 10, 60);
  eq(p.snapped, [10, 40]); near(p.width, 30, 1e-9);
  near(Math.max(...p.unit.outer.map((q) => q[0])), -99, 1e-9, "stops at x −99");
  eq(p.unit.id, "U-02");
  eq(paintUnit(f, s, "R1", 50, 60).refused, "inside-unit");
  // the drawn unit's demising lines are its two cut lines (x −99 and x −69, y −31.5 to −2.835)
  eq(f.units[0].demising.map((l) => l.map((q) => q[0])), [[-99, -99], [-69, -69]]);
});

/* ------------------------------------------------------------ D4 suggest on a blank run */

// Section 8.1 reference fill of the south run (9 slots, targets 2, 7, 2, 5, 1 from N = floor(526 ÷ 30.433) = 17):
// studio 20.00, 1BR 24.44, den 30.24, 2BR 36.07, 3BR 46.25, 1BR 24.44, 2BR 36.07, 1BR 24.44, 2BR 36.07 (Σ 278).
t("D4 suggestRun on the 8.1 south run, blank: the units of the 8.1 reference fill of that run", () => {
  const s = blank("double-loaded-bar");
  const f = layOf(s);
  eq(f.counts, { studio: 2, "1br": 7, "1brden": 2, "2br": 5, "3br": 1 }, "targets");
  const g = suggestRun(f, s, f.free.find((x) => x.runId === "R1"));
  eq(g.note, null);
  eq(g.units.map((u) => u.type), ["studio", "1br", "1brden", "2br", "3br", "1br", "2br", "1br", "2br"]);
  eq(g.units.map((u) => u.width.toFixed(2)), ["20.00", "24.44", "30.24", "36.07", "46.25", "24.44", "36.07", "24.44", "36.07"]);
  ok(g.units.every((u) => u.match === "in-range"), "every ghost in range");
  near(g.units.reduce((a, u) => a + u.width, 0), 278, 0.002, "Σ widths = run");
  // the ghosts equal the frozen 8.1 units of that run (U-01 to U-09)
  const frozen = preset("double-loaded-bar").units.slice(0, 9);
  eq(g.units.map((u) => u.outer.map((q) => q.slice().sort()).sort()), frozen.map((u) => u.outer.map((q) => q.slice().sort()).sort()), "outlines");
  eq(suggestRun(f, s, f.free[0].id).units.length, 9, "by stretch id");
});

/* ------------------------------------------------------------ D5 deficit order */

// Two 2BRs drawn on the north-west run (frozen U-15 and U-17): the 2BR deficit is (5 − 2) ÷ 5 = 0.6 against 1.0 for the
// others, so the south run takes one 2BR (reference: three). With counters { 2br: 5 } the 2BR target is met: no 2BR.
t("D5 suggestRun with 2BRs already drawn: the deficit order moves away from 2BR", () => {
  const s = blank("double-loaded-bar");
  s.units = preset("double-loaded-bar").units.filter((u) => u.id === "U-15" || u.id === "U-17");
  const f = layOf(s);
  eq(placedCounts(f.units), { "2br": 2 });
  const n2 = (g) => g.units.filter((u) => u.type === "2br").length;
  const g = suggestRun(f, s, f.free.find((x) => x.runId === "R1"));
  eq(n2(g), 1, "one 2BR against three in the reference");
  eq(g.units.map((u) => u.type), ["studio", "1br", "1brden", "3br", "1br", "1br", "2br", "1br", "1brden"]);
  const h = suggestRun(f, s, f.free.find((x) => x.runId === "R1"), { counters: { "2br": 5 } });
  eq(n2(h), 0, "no 2BR when its target is met");
});

/* ------------------------------------------------------------ D6 too short */

// One unit from s 13.667 to 278 leaves the stretch 0 to 13.667 = 13 ft 8 in (13.667 × 12 = 164 in = 13 × 12 + 8).
// The narrowest type at 28.665 ft is the studio, 20 ft: no set of units fits.
t("D6 too-short stretch: units [] and the note", () => {
  const s = blank("double-loaded-bar");
  const f0 = layOf(s);
  s.units = [toStateUnit(paintUnit(f0, s, "R1", 13.667, 278, { snap: false }).unit, [])];
  const f = layOf(s);
  const st = f.free.find((x) => x.runId === "R1");
  near(st.length, 13.667, 0.001);
  const g = suggestRun(f, s, st);
  eq(g, { units: [], note: "This stretch (13'-8\") is too short for any type. Extend a neighbor or leave it open." });
  eq(f.units[0].match, "large", "a 264.3 ft unit is large");
});

/* ------------------------------------------------------------ D7 free draw */

// Rectangle x −100 to −80, y −20 to 2 crosses the corridor (y −2.835 to 2.835). The clip keeps y −20 to −2.835:
// 20 × 17.165 = 343.3 sf; the 20 × 4.835 = 96.7 sf in the corridor goes away. 343.3 < 450 (studio min): studio, small.
t("D7 freeUnit across the corridor: clipped; the part in the corridor is removed", () => {
  const s = blank("double-loaded-bar");
  const f = layOf(s);
  const p = freeUnit(f, s, [[-100, -20], [-80, -20], [-80, 2], [-100, 2]]);
  eq(p.clipped, true); eq(p.unit.mode, "free");
  near(p.area, 343.3, 0.05, "area");
  ok(Math.max(...p.unit.outer.map((q) => q[1])) <= -2.835 + 1e-9, "below the corridor");
  near(GEO.mpArea(GEO.bool("int", mp([p.unit.outer]), f.corridor)), 0, 0.01, "no corridor area");
  eq([p.unit.type, p.match], ["studio", "small"]);
  // a shape under 50 sf after the clip is refused (6 × 8 = 48 sf)
  eq(freeUnit(f, s, [[-100, -20], [-94, -20], [-94, -12], [-100, -12]]).refused, "too-small");
  // the free unit enters the layout; the closure stays within 1 sf
  s.units = [toStateUnit(p.unit, [])];
  const b = buildPlates(s);
  eq(b.groups[0].fill.units.length, 1);
  ok(MT.computeMetrics(s, b).groups[0].row.closure.ok, "closure");
});

/* ------------------------------------------------------------ D8 corner zone */

// 8.5 blank: d = (100 − 41.34) ÷ 2 − 1 = 28.33; e = (1,100 + 28.33²) ÷ (2 × 28.33) = (1,100 + 802.59) ÷ 56.66 = 33.579;
// wrap area d (2e − d) = 28.33 × (67.158 − 28.33) = 1,100.0. 2BR 1,000 to 1,200: in range.
t("D8 corner zone suggest: a wrap unit with legs from the formula", () => {
  const s = blank("point-tower");
  const f = layOf(s);
  eq(f.cornerZones.length, 4, "corner zones");
  const g = suggestCorner(f, s, f.cornerZones[0]);
  eq(g.type, "2br"); eq(g.mode, "corner"); eq(g.match, "in-range");
  near(g.legs[0], 33.579, 0.002); near(g.legs[1], 33.579, 0.002); near(g.e, 33.579, 0.002);
  near(g.area, 1100, 0.5, "area");
  eq(suggestCorner(f, s, f.cornerZones[1].id).zoneId, f.cornerZones[1].id, "by zone id");
  // a paint pressed before the run start, next to an empty corner zone, makes the corner unit
  const r = f.runs[0];
  const p = paintUnit(f, s, r.id, -3, 10);
  eq(p.unit.mode, "corner"); near(p.area, 1100, 0.5);
  eq(cornerUnit(f, s, r.startCorner).unit.outer, p.unit.outer);
  // drawn, it is a wrap unit with two exposures and two leg-end demising lines; the zone leaves cornerZones
  s.units = [toStateUnit(p.unit, [])];
  const f2 = layOf(s);
  eq(f2.cornerZones.length, 3);
  const u = f2.units[0];
  ok(u.wrap && u.corner, "wrap corner"); eq(u.exposures.length, 2); eq(u.demising.length, 2);
});

/* ------------------------------------------------------------ D9 pickType */

// Default mix ranges (sf): studio 450–600, 1BR 650–800, den 850–950, 2BR 1,000–1,200, 3BR 1,300–1,500.
// 725 → 1BR (target 725). 1,600 → nearest range 3BR (100 above 1,500): large. 400 → studio (50 below 450): small.
// 820 → 1BR max 800 is 20 away, den min 850 is 30 away: 1BR, large. Hand set: 2BR at 860 sf → small (860 < 1,000).
// Hotel at 26 ft deep: 14.2 ft → king (13.5–14.5); 28 ft → suite (27–29); 20 ft → double queen max 15 is 5 away, suite min
// 27 is 7 away: double queen, large.
t("D9 pickType rules: in range, large, small, hand-set; hotel by width", () => {
  eq(pickType(725, T81, 28.665), { type: "1br", match: "in-range" });
  eq(pickType(860, T81, 28.665), { type: "1brden", match: "in-range" });
  eq(pickType(1600, T81, 28.665), { type: "3br", match: "large" });
  eq(pickType(400, T81, 28.665), { type: "studio", match: "small" });
  eq(pickType(820, T81, 28.665), { type: "1br", match: "large" });
  const s = blank("double-loaded-bar");
  const f0 = layOf(s);
  const u = retype(paintUnit(f0, s, "R1", 0, 30).unit, "2br");
  eq([u.type, u.typeSet], ["2br", true]);
  s.units = [toStateUnit(u, [])];
  const f = layOf(s);
  eq([f.units[0].type, f.units[0].match, f.units[0].typeSet], ["2br", "small", true], "hand-set type keeps its type");
  const H = PRESETS[1].state.mix.hotel;
  eq(pickType(14.2 * 26, H, 26), { type: "king", match: "in-range" });
  eq(pickType(28 * 26, H, 26), { type: "suite", match: "in-range" });
  eq(pickType(20 * 26, H, 26), { type: "dq", match: "large" });
  eq(pickType(0, H, 26, { width: 14.7 }).type, "dq", "width given");
});

/* ------------------------------------------------------------ D10 migration */

// Old saved state 8.1 with the 17 fill units as locks → 17 units of mode "run" (rectangles), same NRSF
// 526 × 28.665 = 15,077.8. A wrap lock (the L corner) → "corner". A triangle → "free". No locks → blank.
t("D10 migration: old locks become units; an old state with no locks is blank", () => {
  const old = blank("double-loaded-bar"); delete old.units;
  const fill = fillPlates(old).groups[0].fill;
  old.locks = fill.units.map((u, k) => ({ id: `L${k + 1}`, outer: u.outer, type: u.type }));
  const m = migrateUnits(old);
  ok(!("locks" in m), "no locks key"); eq(m.units.length, 17);
  ok(m.units.every((u) => u.mode === "run"), "rectangles are run units");
  eq(m.units.map((u) => u.type), fill.units.map((u) => u.type));
  eq(old.locks.length, 17, "input not changed");
  const row = rowOf(old);
  eq(row.units, 17); near(row.nrsf, 15077.8, 0.5); ok(row.closure.ok);
  const lf = fillPlates(blank("l-plate-60-ft-arms")).groups[0].fill;
  eq(DR.unitModeOf(lf.units.find((u) => u.wrap).outer), "corner", "wrap");
  eq(DR.unitModeOf([[0, 0], [10, 0], [0, 10]]), "free", "triangle");
  const none = blank("double-loaded-bar"); delete none.units; none.locks = [];
  eq(migrateUnits(none).units, [], "no locks: blank");
  eq(layOf(none).units.length, 0, "blank layout");
  const proj = { levels: { groups: { g1: { filled: true, locks: [{ id: "U-07", outer: [[0, 0], [20, 0], [20, 28], [0, 28]], type: "1br" }] }, g2: { units: [] } } } };
  const pm = migrateUnits(proj);
  eq(pm.levels.groups.g1.units.map((u) => [u.id, u.mode, u.type]), [["U-07", "run", "1br"]]); ok(!("locks" in pm.levels.groups.g1)); eq(pm.levels.groups.g2.units, []);
});

/* ------------------------------------------------------------ D11 presets */

// Section 8 values of presets 8.1 to 8.6 (the TEST_CASES arithmetic), now from the frozen units through buildPlates:
// 8.1 17 units, 15,077.8 sf, 0.7732; 8.2 27 keys in 28 bays, 10,296.0, 0.7150; 8.3 16, 12,816.5, 0.7629;
// 8.4 21, 16,318.3, 0.7555; 8.5 8, 7,895.0, 0.7895; 8.6 39, 33,576.5, 0.7596.
t("D11 presets: section 8 values unchanged; the derived equals the automatic fill's", () => {
  for (const tc of TEST_CASES) {
    const s = clone(tc.state);
    ok(s.units.length > 0 && !("locks" in s), `${tc.id} ships with units`);
    const b = buildPlates(s);
    const f = b.groups[0].fill;
    const m = MT.computeMetrics(s, b), row = m.groups[0].row, e = tc.expect;
    if (e.units != null) eq(row.units, e.units, `${tc.id} units`);
    if (e.keys != null) eq(row.keys, e.keys, `${tc.id} keys`);
    if (e.bays != null) eq(row.bays, e.bays, `${tc.id} bays`);
    near(row.nrsf, e.nrsf, e.tolerance, `${tc.id} NRSF`);
    near(row.efficiency, e.efficiency, e.efficiencyTolerance, `${tc.id} efficiency`);
    eq(f.corners.length, e.corners, `${tc.id} corners`);
    eq(f.support.filter((x) => x.kind === "pocket").length, e.pockets, `${tc.id} pockets`);
    for (const [k, v] of Object.entries(e.counts || {})) eq(row.byType[k] || 0, v, `${tc.id} ${k}`);
    ok(row.closure.ok, `${tc.id} closure ${JSON.stringify(row.closure)}`);
    near(f.openArea, 0, 0.5, `${tc.id} no open area`);
    eq(f.free.length, 0, `${tc.id} no open stretch`);
    ok(f.units.every((u) => u.match === "in-range"), `${tc.id} every unit in range`);
    ok(!m.warnings.some((w) => w.code === "mix-miss" || w.code === "run-too-short" || w.code === "area-closure"), `${tc.id} ${m.warnings.map((w) => w.code)}`);
    // the derived units, plate, corridor, support and metrics equal the automatic fill's. The core differs only where a
    // manual core now holds the room program (8.1 and 8.6: the 2 cabs move inside the program rooms). The Type A flag
    // (8.6: 39 units > 20 → max(1, ceil(0.02 × 39)) = 1) goes to the unit nearest the cabs, so it can move to a neighbor.
    const bf = fillPlates(s);
    const dl = DV.platesDerived(s, b, m), df = DV.platesDerived(s, bf, MT.computeMetrics(s, bf));
    const flat = (dv) => ({ ...dv, levels: dv.levels.map((l) => ({ ...l, core: { outer: l.core.outer, stairs: l.core.stairs }, units: l.units.map((u) => ({ ...u, accessible: null })) })) });
    eq(diffs(flat(dl), flat(df)), [], `${tc.id} derived`);
    eq(dl.levels[0].units.filter((u) => u.accessible).length, df.levels[0].units.filter((u) => u.accessible).length, `${tc.id} accessible count`);
  }
});

/* ------------------------------------------------------------ D12 group */

// Mid-Rise double-bar: one group of five floors (levels 1–5). The group's units (levels.groups[gid].units) are the
// automatic fill of that group. Every level of the group gets the same layout: building units = level units × 5.
function midriseProject(id) {
  const ms = clone(MR.PRESETS.find((p) => p.id === id).state);
  const built = assemble(ms);
  const derived = midriseDerived(ms, built, { units: 280 });
  return { sections: { massing: { tool: "midrise", schema: 1, updatedAt: "2026-10-22T12:00:00.000Z", placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: ms, derived } } };
}
t("D12 group: one layout copies to every level of the group; building units = level units × floors", () => {
  const project = deepFreeze(midriseProject("double-bar"));
  const s = blank("double-loaded-bar"); s.source = "project"; s.corridor.kind = "auto"; s.core = { mode: "auto", rect: null };
  const blankB = buildPlates(s, { project });
  eq(blankB.groups.length, 1); eq(blankB.groups[0].floors, 5);
  eq(blankB.groups[0].fill.units.length, 0, "a project group starts blank");
  const gid = blankB.groups[0].id;
  const fill = fillPlates(s, { project }).groups[0].fill;
  s.levels = { showPodium: false, selected: gid, groups: { [gid]: { filled: true, units: fill.units.map((u, k) => toStateUnit({ ...u, uid: `U-${String(k + 1).padStart(2, "0")}`, mode: u.wrap ? "corner" : "run" }, [])) } } };
  const b = buildPlates(s, { project });
  const n = b.groups[0].fill.units.length;
  eq(n, fill.units.length, "the group units");
  const m = MT.computeMetrics(s, b);
  eq(m.building.units, n * 5, "building units");
  const d = DV.platesDerived(s, b, m);
  eq(d.levels.map((l) => l.index), [1, 2, 3, 4, 5]);
  ok(d.levels.every((l) => l.units.length === n), "every level has the units");
  eq(d.levels[3].units.map((u) => u.outer), d.levels[0].units.map((u) => u.outer), "the same outlines");
  eq(d.levels[2].units[0].id, "3-01", "ids per level");
  ok(m.groups[0].row.closure.ok, "closure");
});

/* ------------------------------------------------------------ edits: split, merge, bay line, blocks */

// 8.1 frozen U-05 is the 3BR at x −28.254 to 17.994 (46.248 ft): halves of 23.124 ft = 23.124 × 28.665 = 662.8 sf → 1BR
// (650–800). Merged back: 46.248 × 28.665 = 1,325.7 sf → 3BR. Bay line U-01 | U-02 (x −119, s 20) moved to s 22:
// U-01 22 ft = 22 × 28.665 = 630.6 sf (studio max 600 is 30.6 away, 1BR min 650 is 19.4 away → 1BR, small);
// U-02 44.437 − 22 = 22.437 ft = 643.2 sf → 1BR (small). Σ area unchanged: 44.437 × 28.665.
t("edits: split, merge, and a bay-line drag re-cut the run units; pickType follows unless the type is hand-set", () => {
  const s = preset("double-loaded-bar");
  const f = layOf(s);
  const u5 = f.units.find((u) => u.uid === "U-05");
  eq(u5.type, "3br");
  const sp = splitUnit(f, u5, null, s);
  eq(sp.units.map((u) => u.id), ["U-05", "U-18"]);
  eq(sp.units.map((u) => u.type), ["1br", "1br"]);
  for (const u of sp.units) near(area(u.outer), 662.8, 0.1);
  const s2 = clone(s); s2.units = s2.units.filter((u) => u.id !== "U-05").concat(sp.units);
  const f2 = layOf(s2);
  eq(f2.units.length, 18);
  ok(MT.computeMetrics(s2, buildPlates(s2)).groups[0].row.closure.ok, "closure after split");
  const mg = mergeUnits(f2, "U-05", "U-18", s2);
  eq(mg.unit.type, "3br"); near(area(mg.unit.outer), 1325.7, 0.1); eq(mg.unit.outer.length, 4, "one rectangle");
  eq(mergeUnits(f, "U-01", "U-05", s).refused, "not-touching");
  const bl = moveBayLine(f, s, "U-01", "U-02", 22);
  eq(bl.widths, [22, 22.437]); eq(bl.s, 22);
  eq(bl.units.map((u) => u.type), ["1br", "1br"]);
  near(area(bl.units[0].outer) + area(bl.units[1].outer), area(f.units[0].outer) + area(f.units[1].outer), 0.01, "NRSF kept");
  eq(moveBayLine(f, s, "U-01", "U-03", 22).refused, "no-shared-line");
});

// A manual core moved 10 ft east over the frozen north-east units: they are clipped to the zone, the closure holds.
t("a block moved onto drawn units clips them; area closure stays within 1 sf", () => {
  const s = preset("double-loaded-bar");
  s.core.rect = [-5, 2.835, 25, 32.5];
  const b = buildPlates(s);
  const f = b.groups[0].fill;
  ok(f.units.some((u) => u.clipped), "a clipped unit");
  ok(f.warnings.some((w) => w.code === "unit-clipped"), "the info line");
  for (const u of f.units) near(GEO.mpArea(GEO.bool("int", mp([u.outer]), mp([f.core]))), 0, 0.01, `${u.id} off the core`);
  ok(MT.computeMetrics(s, b).groups[0].row.closure.ok, "closure");
  ok(f.free.some((x) => x.length > 1), "the core move opens a stretch");
});

/* ------------------------------------------------------------ follow-ups: manual core rooms, stale text, advisor */

// 8.5 blank with a manual core 50 × 30 (x −25..25, y −15..15). One floor at 10,000 sf: 2 passenger cabs, no service cab.
// Program (2 rows of 11): top E, E, shaft 6; bottom trash 8, electrical 8, shaft 6 → R = 22; A = 2 × 11 + 22 = 44, B = 22.
// In 50 × 30: rows stretch to 50 − 22 = 28 (each last shaft + 6), the middle band 28 × (30 − 22) = 224 is a shaft, each
// stair column is the stair 11 × 22 and a shaft 11 × 8. Σ = 2 × 242 + 2 × 88 + 28 × 11 + 28 × 11 + 224 = 1,500 = 50 × 30.
// A 15 × 15 core is less than 44 × 22: coreFits false, no rooms, one block.
t("manual core: the program tiles a larger rectangle exactly; a 15 × 15 core does not fit", () => {
  const s = blank("point-tower"); s.core = { mode: "manual", rect: [-25, -15, 25, 15] };
  const b = buildPlates(s);
  const f = b.groups[0].fill;
  eq(f.coreMode, "manual"); eq(f.coreFits, true);
  const rooms = f.coreRooms;
  const sum = rooms.reduce((a, r) => a + area(r.outer), 0);
  near(sum, 1500, 0.01, "Σ rooms");
  near(GEO.mpArea(GEO.bool("union", mp(rooms.map((r) => r.outer)), [])), 1500, 0.01, "no overlap");
  near(GEO.mpArea(GEO.bool("diff", mp([f.core]), mp(rooms.map((r) => r.outer)))), 0, 0.01, "no gap");
  const by = {}; for (const r of rooms) by[r.kind] = (by[r.kind] || 0) + 1;
  eq(by, { stair: 2, elevator: 2, shaft: 5, trash: 1, electrical: 1 });
  near(rooms.filter((r) => r.kind === "shaft").reduce((a, r) => a + area(r.outer), 0), 2 * 88 + 2 * 12 * 11 + 224, 0.01, "shafts 664");
  eq(f.stairs.map((x) => x.id), ["S1", "S2"]); eq(f.elevators.map((x) => x.id), ["E1", "E2"]);
  ok(f.stairs.every((x) => x.door), "stair doors");
  ok(MT.computeMetrics(s, b).groups[0].row.closure.ok, "closure");
  eq(DV.platesDerived(s, b, null).levels[0].core.rooms.length, 11, "derived rooms");
  const t15 = blank("point-tower"); t15.core = { mode: "manual", rect: [-7.5, -7.5, 7.5, 7.5] };
  const g = layOf(t15);
  eq(g.coreFits, false); eq(g.coreRooms, []);
  near(area(g.core), 225, 0.01, "one block");
  eq(g.warnings.find((w) => w.code === "core-rooms-do-not-fit").message, "The core rooms do not fit in the core. The program needs 44 × 22 ft. The core stays one block.");
  eq(layOf(blank("hotel-bar")).coreFits, null, "no core");
});

t("stale-massing text and the advisor on a plate not drawn yet", () => {
  const s = blank("double-loaded-bar");
  const b = buildPlates(s);
  const m = MT.computeMetrics(s, b);
  const st = MT.checks(s, m, { massingUpdatedAt: "2030-01-01T00:00:00Z" }).find((w) => w.code === "stale-massing");
  ok(!st, "no stamp on a drawn plate");
  const w = MT.checks(s, { ...m, massing: { usedAt: "2026-01-01T00:00:00Z", currentAt: "2026-02-01T00:00:00Z" } }).find((x) => x.code === "stale-massing");
  eq(w.message, "The massing changed after this layout. Check the units against the new plates.");
  // blank 8.1: efficiency 0, open area 15,077.8 of a 15,077.8 sf zone (100% > 10%): no efficiency-low
  ok(!AD.advise(s, b, m, { fillPlate: fillPlates }).some((x) => x.code === "efficiency-low"), "undrawn plate");
  // the frozen 8.1 with a support block over the south band (x −100..100): the units there are clipped or gone, the open
  // area is under 10% of the zone, and the efficiency is under 0.70: efficiency-low stays
  const d = preset("double-loaded-bar"); d.support = [{ id: "B1", kind: "storage", rect: [-100, -31.5, 100, -2.835] }];
  const bd = buildPlates(d), md = MT.computeMetrics(d, bd);
  const fd = bd.groups[0].fill;
  ok(fd.openArea < 0.1 * GEO.mpArea(fd.zone), `open ${fd.openArea}`);
  ok(md.groups[0].row.efficiency < 0.70, `efficiency ${md.groups[0].row.efficiency}`);
  ok(AD.advise(d, bd, md, { fillPlate: fillPlates }).some((x) => x.code === "efficiency-low"), "a drawn plate keeps efficiency-low");
});

/* ------------------------------------------------------------ contract */

t("contract: export and import lines of draw.js and suggest.js; suggest.js reads fill.js only for fillRuns", () => {
  const src = ["draw.js", "suggest.js", "fill.js"].map((n) => readFileSync(new URL(`../src/plate/${n}`, import.meta.url), "utf8")).join("\n");
  for (const line of src.split("\n")) if (/^\s*export\b/.test(line)) ok(/^export (function|const) /.test(line), `export line: ${line}`);
  for (const line of src.split("\n")) if (/^\s*import\b/.test(line)) ok(/^import .* from "\.\.?\/[^"]+";$/.test(line), `import line: ${line}`);
  ok(!/from "\.\/fill\.js"/.test(readFileSync(new URL("../src/plate/draw.js", import.meta.url), "utf8")), "draw.js does not import fill.js");
});

t("contract: no input mutation; byte-equal layouts; errors name the input", () => {
  const s = deepFreeze(preset("courtyard-typed-o"));
  const a = JSON.stringify(buildPlates(s)), b = JSON.stringify(buildPlates(s));
  ok(a === b, "byte-equal");
  const z = deepFreeze(blank("double-loaded-bar"));
  const f = deepFreeze(layOf(z));
  paintUnit(f, z, "R1", 5, 40); freeUnit(f, z, [[-100, -20], [-80, -20], [-80, 2], [-100, 2]]);
  suggestRun(f, z, f.free[0]); placedCounts(f.units);
  const p = deepFreeze(blank("point-tower")); const fp = deepFreeze(layOf(p));
  suggestCorner(fp, p, fp.cornerZones[0]); migrateUnits(deepFreeze({ ...blank("double-loaded-bar"), locks: [] }));
  const g = deepFreeze(preset("double-loaded-bar")); const fg = deepFreeze(layOf(g));
  splitUnit(fg, "U-05", null, g); mergeUnits(fg, "U-01", "U-02", g); moveBayLine(fg, g, "U-01", "U-02", 21);
  let msg = "";
  try { layoutLevel(null, z); } catch (e) { msg = e.message; } ok(/layoutLevel.*level/.test(msg), msg);
  try { paintUnit(f, z, "R99", 0, 10); } catch (e) { msg = e.message; } ok(/runId/.test(msg), msg);
  try { suggestRun(f, z, null); } catch (e) { msg = e.message; } ok(/freeStretch/.test(msg), msg);
  try { pickType(500, null, 28); } catch (e) { msg = e.message; } ok(/types/.test(msg), msg);
  try { buildPlates(Object.assign(blank("double-loaded-bar"), { source: "project" })); } catch (e) { msg = e.message; } ok(/project/.test(msg), msg);
});

// Draw plan 2.2: layoutLevel on a 40-unit level well under 50 ms in Node. 8.6 has 39 units (about 10 ms here).
t("performance: layoutLevel on the 39-unit 8.6 level well under 50 ms", () => {
  const s = preset("courtyard-typed-o");
  const lvl = LV.levelsFrom(s, null)[0];
  for (let i = 0; i < 8; i++) layoutLevel(lvl, s, { units: s.units });
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) layoutLevel(lvl, s, { units: s.units });
  const ms = (performance.now() - t0) / 5;
  console.log(`       8.6 layoutLevel ${ms.toFixed(1)} ms`);
  ok(ms < 50, `${ms} ms`);
});

// ASD-STE100: short sentences, no contractions (a feet-inch value like 13'-8" is not a contraction).
t("text: warnings and notes are short sentences with no contractions", () => {
  const texts = [];
  const s = preset("double-loaded-bar"); s.core.rect = [-5, 2.835, 25, 32.5];
  for (const st of [defaultState(), s, preset("hotel-bar"), preset("l-plate-60-ft-arms"), preset("courtyard-typed-o")]) {
    const b = buildPlates(st);
    texts.push(...MT.computeMetrics(st, b).warnings.map((w) => w.message), ...b.notes);
  }
  const z = blank("double-loaded-bar"), f = layOf(z);
  texts.push(suggestRun(f, z, { runId: "R1", a: 0, b: 10 }).note, paintUnit(f, z, "R1", 10, 10.2).message, freeUnit(f, z, [[-100, -20], [-96, -20], [-96, -16]]).message);
  for (const x of texts) {
    ok(typeof x === "string" && x.length > 0, "text");
    ok(!/[A-Za-z]'(t|s|re|ll|ve|d|m)\b/.test(x), `contraction: ${x}`);
    for (const sen of x.split(/(?<=\.)\s+/)) ok(sen.split(/\s+/).length <= 25, `long sentence: ${sen}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
