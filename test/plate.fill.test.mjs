// Run: node test/plate.fill.test.mjs
// Plan: docs/plate-planner-technical-plan.md, section 9.1 tests 1 to 14 (fill and corridor), section 8 numbers,
// plus contract checks (no input mutation, export lines, run shapes).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const FL = await import("../src/plate/fill.js");
const CO = await import("../src/plate/corridor.js");
const MX = await import("../src/plate/mix.js");
const { PRESETS, defaultState } = await import("../src/plate/presets.js");
const { assemble } = await import("../src/midrise/assemble.js");
const { midriseDerived } = await import("../src/midrise/derived.js");
const MR = await import("../src/midrise/presets.js");
const TG = await import("../src/tower/geometry.js");
const TP = await import("../src/tower/presets.js");
const { buildPlates, fillLevel, fillRuns, slotsFor, unitZone, runsAndCorners } = FL;
const { spineFor, corridorPolygon, stairBlocks, corridorGraph, GEO } = CO;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.001, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ± ${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
function deepFreeze(o) { if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------ helpers */

const area = (r) => Math.abs(GEO.ringArea(r));
const mp = (rings) => rings.map((r) => ({ outer: r, holes: [] }));
const nrsfOf = (f) => f.units.reduce((s, u) => s + area(u.outer), 0);
const gsfOf = (f) => GEO.mpArea(f.plate);
const byType = (f) => { const o = {}; for (const u of f.units) o[u.type] = (o[u.type] || 0) + 1; return o; };
const preset = (id) => clone(PRESETS.find((p) => p.id === id).state);
const fillOf = (state, opts) => buildPlates(state, opts).groups[0].fill;
const support = (f, kind) => f.support.filter((s) => s.kind === kind);
const sumArea = (list) => list.reduce((s, x) => s + area(x.outer), 0);

/** The pieces tile the inset plate with no overlap: Σ areas = union area, and the inset has nothing left uncovered. */
function closure(f) {
  const core = f.core ? GEO.bool("union", mp([f.core, ...f.stairs.map((s) => s.outer), ...f.elevators.map((e) => e.outer)]), []) : [];
  const pieces = [
    ...f.units.map((u) => ({ outer: u.outer, holes: [] })), ...GEO.asMP(f.corridor),
    ...(f.core ? core : mp([...f.stairs.map((s) => s.outer), ...f.elevators.map((e) => e.outer)])),
    ...mp(f.support.map((s) => s.outer)),
  ];
  const sum = pieces.reduce((s, pc) => s + GEO.mpArea([pc]), 0);
  const uni = GEO.mpArea(GEO.bool("union", pieces, []));
  const gap = GEO.mpArea(GEO.bool("diff", f.inset, pieces));
  return { sum, union: uni, overlap: sum - uni, gap, allowance: gsfOf(f) - uni };
}

const widthsInRange = (f, tol = 1e-6) => {
  for (const u of f.units) {
    if (u.wrap || u.locked || u.accessible && u.type === "accessible") continue;
    ok(u.width >= u.lo - tol - 0.0005 && u.width <= u.hi + tol + 0.0005, `${u.id} ${u.type} width ${u.width} outside ${u.lo}..${u.hi}`);
  }
};

console.log("plate fill and corridor");

/* ------------------------------------------------------------ 1. preset 8.1 */

// d = (65 − 5.67) ÷ 2 − 1 = 28.665. Runs: south −139 → 139 = 278; north 139 → 15 = 124 and −15 → −139 = 124; ΣL = 526.
// W = 0.10 × 20 + 0.45 × 25.292 + 0.10 × 31.397 + 0.30 × 38.374 + 0.05 × 48 = 30.433; N = floor(526 ÷ 30.433) = 17; targets 2, 7, 2, 5, 1.
// NRSF = 526 × 28.665 = 15,077.79; efficiency 15,077.79 ÷ 19,500 = 0.77322.
// Without the core: ΣL = 2 × 278 = 556, N = floor(556 ÷ 30.433) = 18, targets 1.8, 8.1, 1.8, 5.4, 0.9 → 2, 8, 2, 5, 1;
// NRSF = 556 × 28.665 = 15,937.74; efficiency 0.81732.
t("1 preset 8.1: 17 units, NRSF 15,077.8, efficiency 0.7732; no core: 18 on target, 15,937.7, 0.8173", () => {
  const f = fillOf(preset("double-loaded-bar"));
  eq(f.units.length, 17, "units");
  near(nrsfOf(f), 15077.8, 0.5, "NRSF");
  near(nrsfOf(f) / gsfOf(f), 0.7732, 0.0005, "efficiency");
  eq(f.runs.map((r) => r.length), [278, 124, 124], "runs");
  eq(f.counts, { studio: 2, "1br": 7, "1brden": 2, "2br": 5, "3br": 1 }, "targets");
  const got = byType(f);
  for (const [k, v] of Object.entries(f.counts)) ok(Math.abs((got[k] || 0) - v) <= 1, `${k} ${got[k]} vs ${v}`);
  widthsInRange(f);
  // the reference fill of section 8.1
  eq(f.units.map((u) => u.width.toFixed(2)), ["20.00", "24.44", "30.24", "36.07", "46.25", "24.44", "36.07", "24.44", "36.07", "25.14", "20.00", "31.19", "47.68", "24.84", "37.16", "24.84", "37.16"], "widths");
  eq(f.units[0].id, "1-01");
  const s = preset("double-loaded-bar"); s.core.rect = null; s.elevators.count = 0;
  const g = fillOf(s);
  eq(g.units.length, 18, "no-core units");
  eq(byType(g), { studio: 2, "1br": 8, "1brden": 2, "2br": 5, "3br": 1 }, "no-core on target");
  eq(g.counts, { studio: 2, "1br": 8, "1brden": 2, "2br": 5, "3br": 1 }, "no-core targets");
  near(nrsfOf(g), 15937.7, 0.5, "no-core NRSF");
  near(nrsfOf(g) / gsfOf(g), 0.8173, 0.0005, "no-core efficiency");
});

/* ------------------------------------------------------------ 2. preset 8.2 */

// d = (60 − 6) ÷ 2 − 1 = 26.0. Runs 101 + 101 + 97 + 97 = 396 (guest cabs x −8..8, service and back-of-house x −12..12).
// Wkey = (0.60 × 14 + 0.30 × 14.5 + 0.05 × 28) ÷ 0.95 = 14.895; keys floor((396 − 15.5) ÷ 14.895) = 25 → 16, 8, 1.
// Fill: SW 85.5 → king, dq, suite, king, king + the accessible key at its east end; SE, NE, NW 7 bays each.
// Keys 5 + 1 + 21 = 27; bays 6 + 1 + 21 = 28. NRSF = 396 × 26 = 10,296.0; efficiency 10,296 ÷ 14,400 = 0.7150.
t("2 preset 8.2: 27 keys in 28 bays, one 2-bay suite, the accessible key on the guest elevators, NRSF 10,296.0", () => {
  const f = fillOf(preset("hotel-bar"));
  eq(f.units.length, 27, "keys");
  eq(f.units.reduce((s, u) => s + u.bays, 0), 28, "bays");
  const suites = f.units.filter((u) => u.type === "suite");
  eq(suites.length, 1, "suites"); eq(suites[0].bays, 2, "suite bays");
  near(suites[0].width, 28.333, 0.01, "suite width");
  const acc = f.units.filter((u) => u.accessible);
  eq(acc.length, 1, "accessible keys");
  near(acc[0].width, 15.5, 1e-9, "accessible width");
  const guest = f.elevators.filter((e) => !e.service);
  eq(guest.length, 2, "guest cabs");
  const grown = GEO.offsetMP(mp([acc[0].outer]), 0.05);           // 0.05 ft × the 10 ft cab face = 0.5 sf
  near(GEO.mpArea(GEO.bool("int", grown, mp(guest.map((e) => e.outer)))), 0.5, 0.01, "the accessible key touches the guest elevators");
  near(GEO.mpArea(GEO.bool("int", mp([acc[0].outer]), mp(guest.map((e) => e.outer)))), 0, 0.01, "and does not overlap them");
  eq(f.runs.map((r) => r.length), [101, 101, 97, 97], "runs");
  eq(f.units.filter((u) => u.runId === "R1").map((u) => u.type), ["king", "dq", "suite", "king", "king", "accessible"], "SW run");
  near(nrsfOf(f), 10296.0, 0.5, "NRSF");
  near(nrsfOf(f) / gsfOf(f), 0.715, 0.0005, "efficiency");
  eq(f.counts, { king: 16, dq: 8, suite: 1 }, "targets");
});

/* ------------------------------------------------------------ 3. short bar */

// 120 × 65, stairs at the ends, no core: runs 120 − 22 = 98 twice. W = 30.433: 98 ÷ 30.433 = 3.2 → 3 slots each → 6 units.
// NRSF = 196 × 28.665 = 5,618.34. Corridor 98 × 5.67 = 555.66; stairs 2 × 11 × 22 = 484; remainders beyond the stairs
// 4 × 11 × 21.5 = 946; allowance 196 × 1.0 = 196. 555.66 + 484 + 946 + 5,618.34 + 196 = 7,800 = 120 × 65.
t("3 short bar 120 × 65: runs 98 and 98, 6 units, NRSF 5,618.3, closure 7,800", () => {
  const s = defaultState(); s.plate.w = 120; s.core.rect = null; s.elevators.count = 0;
  const f = fillOf(s);
  eq(f.runs.map((r) => r.length), [98, 98], "runs");
  eq(f.units.length, 6, "units");
  near(nrsfOf(f), 5618.3, 0.5, "NRSF");
  const corridor = GEO.mpArea(f.corridor), stairs = sumArea(f.stairs), rem = sumArea(support(f, "remainder"));
  near(corridor, 555.66, 0.05, "corridor"); near(stairs, 484, 0.01, "stairs"); near(rem, 946, 0.05, "remainders");
  near(corridor + stairs + rem + nrsfOf(f) + 196, 7800, 1, "closure");
  const c = closure(f);
  near(c.overlap, 0, 0.5, "no overlap"); near(c.gap, 0, 0.5, "no gap"); near(c.allowance, 196, 1, "allowance");
  widthsInRange(f);
});

/* ------------------------------------------------------------ 4. preset 8.3 */

// d = 26.165. Den lo 850 ÷ 26.165 = 32.49 > 32 and 3BR lo 1,300 ÷ 26.165 = 49.68 > 48: both drop.
// Wrap corner at (1, 1): e = (1,100 + 26.165²) ÷ 52.33 = 34.103; area 26.165 × (2 × 34.103 − 26.165) = 1,100.0.
// Pocket at (59, 59): 26.165² = 684.6. Runs: 153.897, 130, 70, 93.897; ΣL = 447.794.
// NRSF = 447.794 × 26.165 + 1,100.0 = 12,816.5; 16 units (14 run slots by exact feasibility, plus the corner).
t("4 preset 8.3: one wrap corner (34.103, 1,100.0), one pocket 684.6, two spine pieces, 16 units, NRSF 12,816.5", () => {
  const f = fillOf(preset("l-plate-60-ft-arms"));
  eq(f.corners.length, 1, "corners");
  near(f.corners[0].legs[0], 34.103, 0.002, "leg 1"); near(f.corners[0].legs[1], 34.103, 0.002, "leg 2");
  eq(f.corners[0].at, [1, 1], "corner at the inset corner");
  const wrap = f.units.find((u) => u.wrap);
  near(area(wrap.outer), 1100.0, 0.5, "corner area"); eq(wrap.type, "2br"); eq(wrap.exposures, ["S", "W"]);
  eq(wrap.demising.length, 2, "two leg-end lines");
  const pk = support(f, "pocket");
  eq(pk.length, 1, "pockets"); near(area(pk[0].outer), 684.6, 0.1, "pocket area");
  eq(f.spine, [[[30, 30], [200, 30]], [[30, 30], [30, 140]]], "spine");
  eq(f.units.length, 16, "units");
  eq(byType(f), { "2br": 6, studio: 2, "1br": 8 }, "by type");
  near(nrsfOf(f), 12816.5, 0.5, "NRSF");
  eq(f.dropped.map((d) => d.id), ["1brden", "3br"], "dropped");
  eq(f.warnings.filter((w) => w.code === "type-does-not-fit").map((w) => w.where.type), ["1brden", "3br"], "warnings");
  eq(f.runs.map((r) => r.length), [153.897, 130, 70, 93.897], "runs");
  widthsInRange(f);
});

/* ------------------------------------------------------------ 5. preset 8.4 */

// Two corners (1,100.0 each), two pockets (684.6 each). Runs 129.794, 93.897, 70, 82, 70, 93.897; ΣL = 539.588.
// NRSF = 539.588 × 26.165 + 2,200 = 16,318.3; 21 units. Stairs at the arm ends: dead ends 0.
// West stair moved 30 ft south ([19, 99, 41, 110]): the corridor from its north face (y 110) to the spine end (y 140) = 30 ft.
t("5 preset 8.4: two corners, two pockets, three spine pieces, 21 units, NRSF 16,318.3; a moved stair gives a 30 ft dead end", () => {
  const f = fillOf(preset("u-plate-60-ft-arms"));
  eq(f.corners.length, 2, "corners");
  for (const c of f.corners) near(area(c.outer), 1100.0, 0.5, "corner area");
  eq(support(f, "pocket").length, 2, "pockets");
  for (const p of support(f, "pocket")) near(area(p.outer), 684.6, 0.1, "pocket area");
  eq(f.spine.length, 3, "spine pieces");
  eq(f.units.length, 21, "units");
  near(nrsfOf(f), 16318.3, 0.5, "NRSF");
  eq(f.graph.deadEnds.map((d) => d.ft), [0, 0], "dead ends");
  const s = preset("u-plate-60-ft-arms");
  s.stairs.mode = "manual";
  s.stairs.items = [{ id: "W", rect: [19, 99, 41, 110] }, { id: "E", rect: [159, 129, 181, 140] }];
  const g = fillOf(s);
  const dead = g.graph.deadEnds.find((d) => d.at[0] === 30 && d.at[1] === 140);
  ok(dead, "a dead end at the west arm end");
  near(dead.ft, 30, 0.001, "dead end"); eq(dead.stairId, "W");
  near(Math.max(...g.graph.deadEnds.map((d) => d.ft)), 30, 0.001, "longest dead end");
  widthsInRange(f); widthsInRange(g);
});

/* ------------------------------------------------------------ 6. preset 8.5 */

// d = (100 − 41.34) ÷ 2 − 1 = 28.33. e = (1,100 + 28.33²) ÷ 56.66 = 33.579. Runs 98 − 2 × 33.579 = 30.842: only the den
// (30.00 to 32) holds it. NRSF = 98² − 41.34² = 9,604 − 1,709.0 = 7,895.0; efficiency 0.7895.
t("6 preset 8.5: four corner 2BR (33.579), four dens of 30.84, NRSF 7,895.0, exposures N, E, S, W", () => {
  const f = fillOf(preset("point-tower"));
  eq(f.kind, "point");
  eq(f.corners.length, 4, "corners");
  for (const c of f.corners) { near(c.legs[0], 33.579, 0.002); near(c.legs[1], 33.579, 0.002); }
  const dens = f.units.filter((u) => u.type === "1brden");
  eq(dens.length, 4, "dens");
  for (const u of dens) { near(u.width, 30.842, 0.002, "den width"); eq(u.exposures.length, 1); }
  for (const u of f.units.filter((u) => u.wrap)) { eq(u.type, "2br"); eq(u.exposures.length, 2); ok(u.corner); }
  near(nrsfOf(f), 7895.0, 0.5, "NRSF");
  near(nrsfOf(f) / gsfOf(f), 0.7895, 0.0005, "efficiency");
  eq([...new Set(f.units.flatMap((u) => u.exposures))].sort(), ["E", "N", "S", "W"], "exposures");
  eq(f.stairs.length, 2, "stairs in the core");
  for (const s of f.stairs) ok(GEO.mpArea(GEO.bool("diff", mp([s.outer]), mp([f.core]))) < 0.01, "stair inside the core");
  near(GEO.mpArea(f.corridor), 41.34 ** 2 - 900, 0.05, "ring corridor");
});

/* ------------------------------------------------------------ 7. preset 8.6 */

// d = 28.665, e = (1,100 + 28.665²) ÷ 57.33 = 33.520. ΣL = 1,017.84 (outer 4 × 84.98 + 2 × 60.48 + 150.96; court 4 × 55.5 + 2 × 92).
// NRSF = 1,017.84 × 28.665 + 4 × 1,100 = 33,576.5; efficiency 33,576.5 ÷ 44,200 = 0.7596.
t("7 preset 8.6: 39 units, 4 corners, 4 pockets, court units on ring 1, NRSF 33,576.5", () => {
  const f = fillOf(preset("courtyard-typed-o"));
  eq(f.units.length, 39, "units");
  eq(f.corners.length, 4, "corners");
  eq(support(f, "pocket").length, 4, "pockets");
  const court = f.units.filter((u) => u.ring === 1);
  eq(court.length, 14, "court units: runs 55.5 × 4 (2 each) and 92 × 2 (3 each)");
  for (const u of court) {
    const c = GEO.centroidOf([u.outer]);
    ok(Math.abs(c[0]) < 95 && Math.abs(c[1]) < 80, `${u.id} sits by the court`);
  }
  ok(f.units.filter((u) => u.ring === 0).every((u) => u.exposures.length >= 1), "outer units face out");
  near(nrsfOf(f), 33576.5, 0.5, "NRSF");
  near(nrsfOf(f) / gsfOf(f), 0.7596, 0.0005, "efficiency");
  near(f.runs.reduce((s, r) => s + r.length, 0), 1017.84, 0.01, "ΣL");
  widthsInRange(f);
});

/* ------------------------------------------------------------ 8. a mix that cannot fit */

// Single-loaded plate 82 × 36.335: corridor at extWall from the south facade, d = 36.335 − 1 − 5.67 − 1 = 28.665;
// stairs at both corridor ends leave one 60 ft run. 3BR 1.00: target floor(60 ÷ 48) = 1 3BR, but 60 − [45.35, 48]
// = [12, 14.65] fits no unit; the next types in order: studio, then 60 − 20.93..20 = 39.07..40 → 2BR [34.89, 40].
t("8 3BR 100 percent on a 60 ft run: no error, two units of other types, mix-miss on 3BR", () => {
  const s = defaultState();
  s.plate.w = 82; s.plate.d = 36.335; s.core.rect = null; s.elevators.count = 0;
  s.corridor.kind = "single"; s.corridor.side = "south";
  s.mix.multifamily = s.mix.multifamily.map((m) => ({ ...m, share: m.id === "3br" ? 1 : 0 }));
  const f = fillOf(s);
  eq(f.runs.length, 1, "one run"); near(f.runs[0].length, 60, 0.001); near(f.runs[0].depth, 28.665, 0.001);
  eq(f.units.length, 2, "two units");
  ok(f.units.every((u) => u.type !== "3br"), "no 3BR");
  eq(f.units.map((u) => u.type), ["studio", "2br"]);
  // The 3BR target is floor(60 ÷ 48) = 1 and 0 are placed: a miss of 1 unit. Plan 3.12 flags mix-miss only beyond
  // one unit, so this case raises none (plan test 8 says it should; reported as a plan disagreement).
  eq(f.counts["3br"], 1, "3BR target"); eq(f.placed["3br"] || 0, 0, "3BR placed");
  ok(!f.warnings.some((w) => w.code === "mix-miss" && w.where.type === "3br"), "a miss of one unit is inside the rule");
  widthsInRange(f);
});

/* ------------------------------------------------------------ 9. locks */

t("9 preset 8.1: two locked units keep outline and type through a re-fill with 2BR 0.50", () => {
  const s = preset("double-loaded-bar");
  const f0 = fillOf(s);
  const lockA = f0.units[1], lockB = f0.units[10];
  s.locks = [{ id: "U-02", outer: lockA.outer, type: lockA.type }, { id: "U-11", outer: lockB.outer, type: lockB.type }];
  s.mix.multifamily = s.mix.multifamily.map((m) => (m.id === "2br" ? { ...m, share: 0.5 } : m));
  const f1 = fillOf(s);
  const locked = f1.units.filter((u) => u.locked);
  eq(locked.length, 2, "locked units");
  eq(locked.map((u) => [u.type, u.outer]), [[lockA.type, lockA.outer], [lockB.type, lockB.outer]], "outlines and types");
  const others = f1.units.filter((u) => !u.locked);
  ok(others.some((u) => !f0.units.some((v) => JSON.stringify(v.outer) === JSON.stringify(u.outer))), "the other runs re-solve");
  for (const u of others) ok(GEO.mpArea(GEO.bool("int", mp([u.outer]), mp(locked.map((l) => l.outer)))) < 0.01, "no unit overlaps a lock");
  near(nrsfOf(f1), 15077.8, 0.5, "NRSF unchanged");
  ok(byType(f1)["2br"] > byType(f0)["2br"], "more 2BR");
});

/* ------------------------------------------------------------ 10. determinism */

t("10 preset 8.6 twice: byte-equal fills", () => {
  const a = JSON.stringify(buildPlates(preset("courtyard-typed-o")));
  const b = JSON.stringify(buildPlates(preset("courtyard-typed-o")));
  ok(a === b, "byte-equal");
});

/* ------------------------------------------------------------ 11. circle */

// Circle 100 ft (64 segments), bar corridor along x through the centroid. Each half is one run along the corridor face
// (the arc edges that see the same face merge); cut lines are perpendicular to the corridor, units are polygons.
// The half bands are 40.34 ft deep on average (band area ÷ run length), where no default type fits (2BR: 1,200 ÷ 40.34
// = 29.7 < 32). The test scales every area of the default mix by 40.34 ÷ 28.665 = 1.407, which gives the 8.1 widths.
t("11 circle 100 ft: polygon units, Σ unit areas = band areas within 1 sf, widths within 1 percent of their range", () => {
  const s = defaultState();
  s.plate = { ...s.plate, shape: "circle", w: 100, d: 100, segments: 64 };
  s.core.rect = null; s.elevators.count = 0; s.corridor.kind = "bar";
  const f0 = fillOf(s);
  eq(f0.spine.length, 1); ok(Math.abs(f0.spine[0][0][1]) < 1e-9 && Math.abs(f0.spine[0][1][1]) < 1e-9, "east-west corridor");
  eq(f0.dropped.length, 5, "the default mix does not fit 40 ft bands");
  const k = f0.depth / 28.665;
  s.mix.multifamily = s.mix.multifamily.map((m) => ({ ...m, targetArea: m.targetArea * k, areaMin: m.areaMin * k, areaMax: m.areaMax * k }));
  const f = fillOf(s);
  eq(f.dropped.length, 0, "the scaled mix fits");
  ok(f.units.length >= 4, "units");
  ok(f.units.some((u) => u.outer.length > 4), "polygon units");
  const filled = f.runs.filter((r) => r.slots > 0);
  const bandArea = filled.reduce((s2, r) => s2 + r.length * r.depth, 0);
  near(nrsfOf(f), bandArea, 1, "Σ unit areas");
  for (const u of f.units) ok(u.width >= u.lo * 0.99 && u.width <= u.hi * 1.01, `${u.id} width ${u.width} in ${u.lo}..${u.hi}`);
  const c = closure(f);
  near(c.overlap, 0, 1, "no overlap"); near(c.gap, 0, 1, "no gap");
});

/* ------------------------------------------------------------ 12. Mid-Rise courtyard fixture (8.7) */

function midriseProject(id) {
  const ms = clone(MR.PRESETS.find((p) => p.id === id).state);
  const built = assemble(ms);
  const derived = midriseDerived(ms, built, { units: 280 });
  return { sections: { massing: { tool: "midrise", schema: 1, updatedAt: "2026-10-22T12:00:00.000Z", placement: { x: 500, y: 500, rotation: 0, baseZ: 1000 }, state: ms, derived } } };
}

t("12 Mid-Rise courtyard-5-over-1: spines from the massing, seed stairs, no wrap at a seed corner, efficiency 0.70 to 0.80", () => {
  const project = deepFreeze(midriseProject("courtyard-5-over-1"));
  const s = defaultState(); s.source = "project"; s.corridor.kind = "auto"; s.core.rect = null;
  const b = buildPlates(s, { project });
  eq(b.groups.length, 1, "one group"); eq(b.groups[0].floors, 5, "five floors"); eq(b.groups[0].levels, [2, 3, 4, 5, 6]);
  eq(b.placement, { x: 500, y: 500, rotation: 0, baseZ: 1000 }, "placement copied");
  eq(b.massingUpdatedAt, "2026-10-22T12:00:00.000Z");
  const f = b.groups[0].fill;
  eq(f.kind, "bar");
  const lvl = project.sections.massing.derived.levels.find((l) => l.index === 2);
  ok(f.spine.length > 0 && f.spine.every((sg) => lvl.spines.some((m) => GEO.segDist(sg[0], m[0], m[1]) < 0.01 || GEO.segDist(sg[1], m[0], m[1]) < 0.01)), "spines from the massing");
  const seedStairs = lvl.seeds.filter((x) => x.kind === "stair");
  eq(f.stairs.length, seedStairs.length, "stairs from the seeds");
  ok(f.stairs.every((st) => st.seed === "stair"));
  eq(f.corners.length, 0, "no wrap unit: every corner holds a seed stair");
  const eff = nrsfOf(f) / gsfOf(f);
  ok(eff >= 0.70 && eff <= 0.80, `efficiency ${eff}`);
  widthsInRange(f);
  for (const u of f.units) ok(GEO.mpArea(GEO.bool("int", mp([u.outer]), mp(f.stairs.map((x) => x.outer)))) < 0.01, `${u.id} overlaps a stair`);
  const units = b.groups.reduce((s2, g) => s2 + g.fill.units.length * g.floors, 0);
  eq(units, f.units.length * 5, "building units");
});

/* ------------------------------------------------------------ 13. corridor graph */

// 8.1: spine −150 → 150, stairs 11 ft at each end: corridor (300 − 22) = 278 ft; doors (±139, 0): path 278; ends inside the stairs: 0.
// 8.2: linen closet at x −4..4 north of the corridor; the key doors project onto the spine at their run middles.
t("13 corridorGraph: 8.1 length 278, door path 278, dead ends 0; 8.2 keys within reach of the linen closet", () => {
  const f = fillOf(preset("double-loaded-bar"));
  const g = corridorGraph(f.spine, f.stairs, f.units, { corridor: f.corridor, width: f.width });
  near(g.lengthFt, 278, 0.01); near(g.stairPathFt, 278, 0.01);
  eq(g.deadEnds.map((d) => d.ft), [0, 0]);
  const g0 = corridorGraph(f.spine, f.stairs, []);
  near(g0.lengthFt, 278, 0.01, "spine length outside the stairs");
  const h = fillOf(preset("hotel-bar"));
  const linen = h.support.find((x) => x.kind === "linen");
  ok(linen, "linen closet");
  const from = GEO.centroidOf([linen.outer]);
  const gh = corridorGraph(h.spine, h.stairs, h.units);
  eq(gh.reach(from, 150).count, 27, "every key within 150 ft");
  const expect50 = h.units.filter((u) => Math.abs(u.door[0] - from[0]) <= 50 + 1e-9).length;
  eq(gh.reach(from, 50).count, expect50, "keys within 50 ft");
  ok(expect50 > 0 && expect50 < 27);
  eq(h.graph.reach.keys, 27, "fill reach");
  near(h.graph.lengthFt, 218, 0.01, "hotel corridor");
});

/* ------------------------------------------------------------ 14. point tower from a tower level */

t("14 tower 'Slim residential point tower' floor 3 with coreRect: point corridor, units on the facade, wrap corners, closure", () => {
  const ts = clone(TP.PRESETS.find((p) => p.name === "Slim residential point tower").state);
  const tb = TG.buildPlates(ts);
  const p3 = tb.plates.find((p) => p.zone === "tower");
  ok(p3 && p3.coreRect, "typical floor with a core");
  const project = { sections: { massing: { tool: "tower", schema: 1, updatedAt: "2026-10-22T00:00:00.000Z", placement: { x: 0, y: 0, rotation: 0, baseZ: 0 },
    derived: { levels: [{ index: p3.n, name: `Floor ${p3.n}`, zone: "tower", z: p3.z, ftf: p3.ftf, program: "residential", plates: p3.polygons, core: p3.coreRect, spines: [], seeds: [] }] } } } };
  const s = defaultState(); s.source = "project"; s.corridor.kind = "auto"; s.core.rect = null;
  const f = fillOf(s, { project });
  eq(f.kind, "point");
  ok(f.units.length >= 4, "units");
  for (const u of f.units) ok(u.exposures.length >= 1, `${u.id} touches the facade`);
  eq(f.corners.length, 4, "four wrap corners");
  ok(f.units.filter((u) => u.wrap).every((u) => u.exposures.length === 2), "corners have two exposures");
  const c = closure(f);
  near(c.overlap, 0, 1, "no overlap"); near(c.gap, 0, 1, "closure");
});

/* ------------------------------------------------------------ contract checks */

t("contract: exports, run shapes, slotsFor, fillRuns, unitZone, runsAndCorners", () => {
  const src = readFileSync(new URL("../src/plate/fill.js", import.meta.url), "utf8") + readFileSync(new URL("../src/plate/corridor.js", import.meta.url), "utf8");
  for (const line of src.split("\n")) if (/^\s*export\b/.test(line)) ok(/^export (function|const) /.test(line), `export line: ${line}`);
  for (const line of src.split("\n")) if (/^\s*import\b/.test(line)) ok(/^import .* from "\.\.?\/[^"]+";$/.test(line), `import line: ${line}`);
  // slotsFor: 278 at d = 28.665 → 9 (278 ÷ 30.433 = 9.13); 70 at 26.165 → 3 (no pair of 2 reaches 70)
  const e1 = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 28.665).types, e2 = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 26.165).types;
  eq(slotsFor({ length: 278 }, e1, MX.weightedWidth(e1).W), 9);
  eq(slotsFor({ length: 70 }, e2, MX.weightedWidth(e2).W), 3);
  eq(slotsFor({ length: 15 }, e1, 30), null, "too short");
  const fr = fillRuns([{ id: "A", length: 124, depth: 28.665 }], MX.MULTIFAMILY_TYPES, { studio: 2, "1br": 7, "1brden": 2, "2br": 5, "3br": 1 }, { placed: { studio: 1, "1br": 3, "1brden": 1, "2br": 3, "3br": 1 } });
  eq(fr[0].units.map((u) => u.type), ["1br", "studio", "1brden", "3br"], "north-east run of 8.1");
  near(fr[0].units[3].to, 124, 1e-9);
  const plate = [{ outer: [[-150, -32.5], [150, -32.5], [150, 32.5], [-150, 32.5]], holes: [] }];
  const sp = spineFor(plate, null, defaultState());
  eq(sp.spine, [[[-150, 0], [150, 0]]]);
  const C = corridorPolygon(sp.spine, 5.67, plate);
  near(GEO.mpArea(C), 300 * 5.67, 0.01);
  const st = stairBlocks("bar", sp.spine, plate, defaultState(), []);
  eq(st.map((x) => x.door), [[-139, 0], [139, 0]]);
  const z = unitZone(plate, C, st, 1);
  near(GEO.mpArea(z.zone), 298 * 63 - 300 * 5.67 + 2 * 1 * 5.67 - 2 * (10 * 22 - 10 * 5.67), 0.1, "zone");
  const rc = runsAndCorners(z.zone, plate, C, st.map((x) => ({ id: x.id, kind: "stair", outer: x.outer })), defaultState());
  eq(rc.runs.map((r) => r.length), [278, 278]);
  ok(rc.runs.every((r) => r.id && r.depth && r.band && r.start && r.end && Number.isFinite(r.from)), "run shape");
});

t("contract: no input mutation (frozen state and project)", () => {
  const s = deepFreeze(preset("courtyard-typed-o"));
  buildPlates(s);
  const h = deepFreeze(preset("hotel-bar"));
  buildPlates(h);
  const p = deepFreeze(midriseProject("double-bar"));
  const m = deepFreeze(Object.assign(defaultState(), { source: "project", corridor: { kind: "auto", width: null, wall: 0.5, side: "south", spine: null }, core: { rect: null } }));
  const b = buildPlates(m, { project: p });
  eq(b.groups.length, 1); eq(b.groups[0].floors, 5);
  ok(b.groups[0].fill.units.length > 0);
});

t("contract: errors name the missing input", () => {
  let msg = "";
  try { fillLevel(null, defaultState()); } catch (e) { msg = e.message; }
  ok(/level/.test(msg), msg);
  try { buildPlates(Object.assign(defaultState(), { source: "project" })); } catch (e) { msg = e.message; }
  ok(/project/.test(msg), msg);
  try { corridorPolygon([[[0, 0], [1, 0]]], null, []); } catch (e) { msg = e.message; }
  ok(/width/.test(msg), msg);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
