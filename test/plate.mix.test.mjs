// Run: node test/plate.mix.test.mjs
// Plan section 9.1 tests 15 to 22: mix (15, 16, 17), levels (18, 19, 20), metrics (21, 22),
// plus extra cases for plateFromState, the corridor graph, the hotel reach, and no input mutation.
// Tests 21 and 22 run on a hand fixture (preset 8.1 written out unit by unit). When src/plate/fill.js exists,
// the same checks also run through the real buildPlates (the "real" group at the end).
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const MX = await import("../src/plate/mix.js");
const LV = await import("../src/plate/levels.js");
const MT = await import("../src/plate/metrics.js");
const { PRESETS } = await import("../src/midrise/presets.js");
const { assemble } = await import("../src/midrise/assemble.js");
const { midriseDerived } = await import("../src/midrise/derived.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------ fixtures */

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const DEPTH = 28.665;   // (65 - 5.67) / 2 - 1.0, plan section 8

/** A mid-rise preset through assemble and midriseDerived → the project document the Plate Planner reads. */
function midriseProject(id, mutate) {
  const p = PRESETS.find((x) => x.id === id);
  const state = clone(p.state);
  const built = assemble(state);
  const derived = midriseDerived(state, built, {});
  if (mutate) mutate(derived);
  return { sections: { massing: { updatedAt: "2026-10-01T00:00:00.000Z", derived } } };
}

const baseState = (over = {}) => ({
  schema: 1, mode: "multifamily", source: "drawn",
  plate: { shape: "rect", w: 300, d: 65, arm: 60, courtW: 120, courtD: 90, segments: 64, points: [] },
  levels: { showPodium: false, selected: null, groups: {} },
  corridor: { kind: "auto", width: null, wall: 0.5, side: "south", spine: null },
  extWall: 1.0,
  core: { rect: [-15, 2.835, 15, 32.5] },
  mix: { multifamily: MX.MULTIFAMILY_TYPES, hotel: MX.HOTEL_TYPES, cornerType: "2br", accessibleWidth: [15, 16, 15.5] },
  housekeepingReach: 150,
  ...over,
});

/**
 * Preset 8.1 written out: the reference fill of plan section 8.1 (widths scaled to close each run exactly).
 * south x -139..139 (9 slots), north-east 15..139 (4), north-west -139..-15 (4).
 */
function fixture81({ depth = DEPTH, spineEnd = 150 } = {}) {
  const typeIds = { S: "studio", B: "1br", D: "1brden", T: "2br", H: "3br" };
  const runs = [
    { id: "R1", x0: -139, x1: 139, y0: -31.5, y1: -2.835, ex: "S", seq: "SBDTHBTBT", widths: [20.0, 24.44, 30.24, 36.07, 46.25, 24.44, 36.07, 24.44, 36.07] },
    { id: "R2", x0: 15, x1: 139, y0: 2.835, y1: 31.5, ex: "N", seq: "BSDH", widths: [25.14, 20.0, 31.19, 47.68] },
    { id: "R3", x0: -139, x1: -15, y0: 2.835, y1: 31.5, ex: "N", seq: "BTBT", widths: [24.84, 37.16, 24.84, 37.16] },
  ];
  // the south run reads studio, 1BR, den, 2BR, 3BR, 1BR, 2BR, 1BR, 2BR (plan 8.1)
  const units = [];
  const outRuns = [];
  let n = 0;
  for (const r of runs) {
    const L = r.x1 - r.x0, raw = r.widths.reduce((s, w) => s + w, 0);
    let x = r.x0;
    r.widths.forEach((w0, i) => {
      const w = (w0 * L) / raw, x1 = i === r.widths.length - 1 ? r.x1 : x + w;
      n++;
      units.push({
        id: `1-${String(n).padStart(2, "0")}`, type: typeIds[r.seq[i]], outer: rect(x, r.y0, x1, r.y1), area: (x1 - x) * (r.y1 - r.y0),
        exposures: [r.ex], corner: false, accessible: false, ring: 0, bay: { from: x - r.x0, to: x1 - r.x0 },
        demising: [[[x, r.y0], [x, r.y1]], [[x1, r.y0], [x1, r.y1]]],
      });
      x = x1;
    });
    outRuns.push({ id: r.id, length: L, depth });
  }
  return {
    plate: [{ outer: rect(-150, -32.5, 150, 32.5), holes: [] }],
    corridor: [{ outer: rect(-139, -2.835, 139, 2.835), holes: [] }],
    spine: [[[-spineEnd, 0], [spineEnd, 0]]],
    core: rect(-15, 2.835, 15, 32.5),
    stairs: [{ id: "S1", outer: rect(-150, -11, -139, 11), door: [-139, 0] }, { id: "S2", outer: rect(139, -11, 150, 11), door: [139, 0] }],
    elevators: [],
    support: [
      { id: "P1", outer: rect(-150, -32.5, -139, -11), kind: "remainder" }, { id: "P2", outer: rect(-150, 11, -139, 32.5), kind: "remainder" },
      { id: "P3", outer: rect(139, -32.5, 150, -11), kind: "remainder" }, { id: "P4", outer: rect(139, 11, 150, 32.5), kind: "remainder" },
    ],
    units, runs: outRuns, corners: [], warnings: [],
  };
}

const builtOf = (fill, indices = [1], extra = {}) => ({ source: "drawn", groups: [{ id: "g1", levels: indices, fill, label: `Levels ${indices[0]}–${indices[indices.length - 1]}` }], placement: null, warnings: [], ...extra });

/* ===================================================================== */
console.log("mix");

// Test 15: plan 8.1 table at d = 28.665 and the 8.3 drops at d = 26.165.
t("15 effectiveTypes at 28.665 reproduces the section 8.1 table", () => {
  // lo = max(widthMin, areaMin / d), hi = min(widthMax, areaMax / d), w = clamp(targetArea / d, lo, hi)
  const e = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, DEPTH);
  eq(e.dropped, []);
  const want = {   // id: [lo, hi, w]
    studio: [20, 600 / DEPTH, 20],                       // 450 / 28.665 = 15.70 < 20; 600 / 28.665 = 20.93; 525 / 28.665 = 18.31 clamps up to 20
    "1br": [24, 800 / DEPTH, 725 / DEPTH],               // 24; 27.91; 25.292
    "1brden": [850 / DEPTH, 32, 900 / DEPTH],            // 29.65; 32; 31.397
    "2br": [1000 / DEPTH, 40, 1100 / DEPTH],             // 34.89; 40; 38.374
    "3br": [1300 / DEPTH, 48, 48],                       // 45.35; 48; 1400 / 28.665 = 48.84 clamps down to 48
  };
  eq(e.types.map((x) => x.id), Object.keys(want));
  for (const x of e.types) {
    near(x.lo, want[x.id][0], 1e-9, `${x.id} lo`);
    near(x.hi, want[x.id][1], 1e-9, `${x.id} hi`);
    near(x.w, want[x.id][2], 1e-9, `${x.id} w`);
    eq(x.bays, 1);
  }
  near(e.types[1].w, 25.292, 0.001);
  near(e.types[2].lo, 29.65, 0.005);
  near(e.types.reduce((s, x) => s + x.share, 0), 1, 1e-12);
  // W = 0.10 * 20 + 0.45 * 25.292 + 0.10 * 31.397 + 0.30 * 38.374 + 0.05 * 48 = 30.433
  const { W, Wbay } = MX.weightedWidth(e.types);
  near(W, 30.433, 0.001);
  near(Wbay, W, 1e-12);
});

t("15 effectiveTypes at 26.165 drops the den and the 3BR and renormalizes", () => {
  const d = 26.165;
  const e = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, d);
  // den: lo 850 / 26.165 = 32.49 > hi 32; 3BR: lo 1300 / 26.165 = 49.68 > hi 48
  eq(e.dropped.map((x) => x.id), ["1brden", "3br"]);
  near(e.dropped[0].lo, 850 / d, 1e-9);
  near(e.dropped[0].hi, 32, 1e-9);
  near(e.dropped[1].lo, 1300 / d, 1e-9);
  eq(e.types.map((x) => x.id), ["studio", "1br", "2br"]);
  // shares 0.10, 0.45, 0.30 over 0.85
  near(e.types[0].share, 0.10 / 0.85, 1e-12);
  near(e.types[1].share, 0.45 / 0.85, 1e-12);
  near(e.types[2].share, 0.30 / 0.85, 1e-12);
  // studio w = 525 / 26.165 = 20.065 (range 20 to 22.93); 1BR 27.709 (24.84 to 28); 2BR 1100 / 26.165 = 42.04 clamps to 40 (38.22 to 40)
  near(e.types[0].w, 525 / d, 1e-9);
  near(e.types[1].lo, 650 / d, 1e-9);   // 650 / 26.165 = 24.84 > 24
  near(e.types[2].w, 40, 1e-9);
});

t("15 effectiveTypes: hotel uses the widths and the target, bays, and the weighted widths of 8.2", () => {
  const e = MX.effectiveTypes(MX.HOTEL_TYPES, 26.0, "hotel");
  eq(e.dropped, []);
  eq(e.types.map((x) => x.bays), [1, 1, 2]);
  eq(e.types.map((x) => x.w), [14, 14.5, 28]);
  near(e.types.reduce((s, x) => s + x.share, 0), 1, 1e-12);
  near(e.types[0].share, 0.60 / 0.95, 1e-12);
  // Wkey = (0.60 * 14 + 0.30 * 14.5 + 0.05 * 28) / 0.95 = 14.895; Wbay = 14.15 / (0.60 + 0.30 + 0.10) = 14.150
  const { W, Wbay } = MX.weightedWidth(e.types);
  near(W, 14.895, 0.001);
  near(Wbay, 14.15, 1e-9);
});

t("15 effectiveTypes: share 0 stays, all shares 0 share equally, bad input throws", () => {
  const types = MX.MULTIFAMILY_TYPES.map((x) => ({ ...x, share: 0 }));
  const e = MX.effectiveTypes(types, DEPTH);
  near(e.types[0].share, 0.2, 1e-12);
  const z = MX.effectiveTypes(MX.MULTIFAMILY_TYPES.map((x) => ({ ...x, share: x.id === "2br" ? 0 : x.share })), DEPTH);
  near(z.types.find((x) => x.id === "2br").share, 0, 1e-12);
  let msg = "";
  try { MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 0); } catch (err) { msg = err.message; }
  ok(/depth/.test(msg), "names the missing depth: " + msg);
  msg = "";
  try { MX.countsFor(100, [], 0); } catch (err) { msg = err.message; }
  ok(/types/.test(msg), "names the missing types: " + msg);
});

// Test 16.
t("16 countsFor(526) at 28.665: N 17, counts 2, 7, 2, 5, 1", () => {
  const e = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, DEPTH);
  // N = floor(526 / 30.433) = floor(17.28) = 17. Quotas 1.7, 7.65, 1.7, 5.1, 0.85 -> floors 1, 7, 1, 5, 0 = 14;
  // three left go to the largest remainders 0.85 (3BR), 0.70 (studio), 0.70 (den; tie with studio by type order) -> 2, 7, 2, 5, 1
  const c = MX.countsFor(526, e.types, 0);
  eq(c.N, 17);
  eq(Object.values(c.counts), [2, 7, 2, 5, 1]);
  eq(Object.keys(c.counts), ["studio", "1br", "1brden", "2br", "3br"]);
  eq(Object.values(c.counts).reduce((s, v) => s + v, 0), 17);
});

t("16 countsFor: corners add to N and count toward their type", () => {
  const e = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 26.165);
  // 8.3: W = 31.148; floor(447.794 / 31.148) = 14, plus 1 corner = 15; quotas studio 1.76, 1BR 7.94, 2BR 5.29 -> 2, 8, 5
  const c = MX.countsFor(447.794, e.types, ["2br"]);
  eq(c.N, 15);
  eq(c.counts, { studio: 2, "1br": 8, "2br": 5 });
  // forms: number, { type, count }, map
  eq(MX.countsFor(447.794, e.types, 1).N, 15);
  eq(MX.countsFor(447.794, e.types, { type: "2br", count: 1 }).counts, c.counts);
  eq(MX.countsFor(447.794, e.types, { "2br": 1 }).counts, c.counts);
  // 8.5: four corner 2BR on four runs of 30.842 at d = 28.33: the 2BR count is raised to 4 and N does not change
  const p = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, 28.33);
  const q = MX.countsFor(4 * 30.842, p.types, ["2br", "2br", "2br", "2br"]);
  ok(q.counts["2br"] >= 4, "2BR holds the four corners");
  eq(Object.values(q.counts).reduce((s, v) => s + v, 0), q.N);
});

t("16 countsFor: hotel keys from the run length less the accessible key", () => {
  const e = MX.effectiveTypes(MX.HOTEL_TYPES, 26.0, "hotel");
  // N = floor((396 - 15.5) / 14.895) = floor(25.55) = 25; quotas 15.79, 7.89, 1.32 -> floors 15, 7, 1 = 23, then the largest remainders 0.89 (double queen), 0.79 (king) -> 16, 8, 1
  const c = MX.countsFor(396 - 15.5, e.types, 0);
  eq(c.N, 25);
  eq(c.counts, { king: 16, dq: 8, suite: 1 });
});

t("16 countsFor: a short run gives N 0; a negative length throws", () => {
  const e = MX.effectiveTypes(MX.MULTIFAMILY_TYPES, DEPTH);
  eq(MX.countsFor(10, e.types, 0).N, 0);
  eq(Object.values(MX.countsFor(10, e.types, 0).counts), [0, 0, 0, 0, 0]);
  let thrown = false;
  try { MX.countsFor(-1, e.types, 0); } catch { thrown = true; }
  ok(thrown);
});

t("16 scoreMix: placed against target, misses over one unit", () => {
  const units = [...Array(3).fill({ type: "studio" }), ...Array(4).fill({ type: "1br" }), { type: "accessible-extra" }];
  const s = MX.scoreMix(units, { studio: 2, "1br": 7 }, MX.MULTIFAMILY_TYPES.slice(0, 2));
  eq(s.byType.map((r) => [r.type, r.count, r.target, r.diff]), [["studio", 3, 2, 1], ["1br", 4, 7, -3], ["accessible-extra", 1, 0, 1]]);
  eq(s.misses, ["1br"]);
  near(s.byType[0].share, 3 / 8, 1e-12);
});

// Test 17.
t("17 requiredAccessible: multifamily 85 units gives Type A 2, hotel 270 keys gives row 300", () => {
  // ceil(0.02 * 85) = ceil(1.7) = 2
  eq(MX.requiredAccessible({ mode: "multifamily" }, 85).typeA, 2);
  // 270 keys falls in 201 to 300: 10 accessible, 3 with a roll-in shower
  const h = MX.requiredAccessible({ mode: "hotel" }, 270);
  eq([h.keys, h.rollIn, h.row], [10, 3, [300, 10, 3]]);
  eq(h.beyond, false);
});

t("17 requiredAccessible: not over 20 units, minimum 1, table edges, editable table", () => {
  eq(MX.requiredAccessible({ mode: "multifamily" }, 20).typeA, 0);
  eq(MX.requiredAccessible({ mode: "multifamily" }, 21).typeA, 1);   // ceil(0.42) = 1, and minUnits 1
  eq(MX.requiredAccessible({ mode: "multifamily" }, 100).typeA, 2);  // 0.02 * 100 = 2 exactly
  eq(MX.requiredAccessible({ mode: "multifamily", accessible: { multifamily: { typeAShare: 0.05, minUnits: 3, over: 10 } } }, 40).typeA, 3);  // max(3, ceil(2))
  eq(MX.requiredAccessible({ mode: "hotel" }, 25).keys, 1);
  eq(MX.requiredAccessible({ mode: "hotel" }, 26).keys, 2);
  eq(MX.requiredAccessible({ mode: "hotel" }, 400).keys, 12);
  const b = MX.requiredAccessible({ mode: "hotel" }, 450);
  eq([b.keys, b.beyond], [12, true]);
  eq(MX.requiredAccessible({ mode: "hotel", accessible: { hotel: [[10, 1, 0], [40, 3, 1]] } }, 30).keys, 3);
  eq(MX.requiredAccessible({ mode: "hotel" }, 0).keys, 0);
});

/* ===================================================================== */
console.log("levels");

// Test 18.
t("18 Mid-Rise double-bar massing: one group, Levels 1–5 (5 floors)", () => {
  const project = midriseProject("double-bar");
  const state = { source: "project", levels: { showPodium: false } };
  const levels = LV.levelsFrom(state, project);
  eq(levels.map((l) => l.index), [1, 2, 3, 4, 5]);
  ok(levels.every((l) => l.zone === "bar" && l.spines.length > 0 && l.seeds.length > 0), "bar levels carry spines and seeds");
  const groups = LV.groupLevels(levels);
  eq(groups.length, 1);
  eq(groups[0].label, "Levels 1–5 (5 floors)");
  eq(groups[0].levels, [1, 2, 3, 4, 5]);
  eq([groups[0].first, groups[0].floors], [1, 5]);
  ok(/^[0-9a-f]{8}$/.test(groups[0].key), "key is an 8 digit hash");
  eq(groups[0].id, "g" + groups[0].key);
  // the same input gives the same group
  eq(LV.groupLevels(LV.levelsFrom(state, midriseProject("double-bar"))), groups);
});

// Test 19.
t("19 podium-5-over-2: podium levels out by default; showPodium puts them in their own groups", () => {
  const project = midriseProject("podium-5-over-2");
  const out = LV.levelsFrom({ source: "project", levels: { showPodium: false } }, project);
  eq(out.map((l) => l.index), [3, 4, 5, 6, 7]);
  ok(out.every((l) => l.zone !== "podium"));
  const g0 = LV.groupLevels(out);
  eq(g0.map((g) => g.label), ["Levels 3–7 (5 floors)"]);

  const withP = LV.levelsFrom({ source: "project", levels: { showPodium: true } }, project);
  eq(withP.map((l) => l.index).sort(), [1, 2, 3, 4, 5, 6, 7]);
  const g1 = LV.groupLevels(withP);
  ok(g1.length >= 2, "the podium adds at least one group");
  const zoneOf = new Map(withP.map((l) => [l.index, l.zone]));
  for (const g of g1) ok(new Set(g.levels.map((i) => zoneOf.get(i))).size === 1, "a group never mixes podium and bar levels");
  ok(g1.some((g) => g.levels.every((i) => i <= 2)), "a podium group exists");
  eq(g1.find((g) => g.levels.includes(3)).label, "Levels 3–7 (5 floors)");
  eq(g1[0].levels.includes(1), true, "groups sort from the lowest level up");
});

t("19 levelsFrom skips deck, crown, mechanical and empty levels", () => {
  const project = midriseProject("double-bar", (d) => {
    d.levels[1].zone = "mechanical";
    d.levels[2].plates = [];
    d.levels[3].zone = "deck";
    d.levels[4].zone = "crown";
  });
  eq(LV.levelsFrom({ source: "project", levels: {} }, project).map((l) => l.index), [1]);
  // a missing massing is a clear error
  let msg = "";
  try { LV.levelsFrom({ source: "project", levels: {} }, null); } catch (err) { msg = err.message; }
  ok(/massing/.test(msg), msg);
});

// Test 20.
t("20 same rings, different seeds: two groups", () => {
  const project = midriseProject("double-bar", (d) => {
    // levels 4 and 5 get one seed moved by 2 ft
    for (const i of [3, 4]) d.levels[i].seeds = d.levels[i].seeds.map((s, k) => (k === 0 ? { ...s, outer: s.outer.map(([x, y]) => [x + 2, y]) } : s));
  });
  const groups = LV.groupLevels(LV.levelsFrom({ source: "project", levels: {} }, project));
  eq(groups.length, 2);
  eq(groups.map((g) => g.label), ["Levels 1–3 (3 floors)", "Levels 4–5 (2 floors)"]);
  ok(groups[0].id !== groups[1].id);
  // the same rings in a different vertex order and winding are still one group
  const p2 = midriseProject("double-bar", (d) => {
    const l = d.levels[2];
    l.plates = l.plates.map((pc) => ({ outer: pc.outer.slice(1).concat(pc.outer.slice(0, 1)).reverse(), holes: pc.holes }));
  });
  eq(LV.groupLevels(LV.levelsFrom({ source: "project", levels: {} }, p2)).length, 1);
});

t("20 labels: a single level and a gap", () => {
  const mk = (index, z) => ({ index, zone: "bar", z, plate: [{ outer: rect(0, 0, 10, 10), holes: [] }], core: null, spines: [], seeds: [] });
  const g = LV.groupLevels([mk(4, 0)]);
  eq(g[0].label, "Level 4 (1 floor)");
  const h = LV.groupLevels([mk(2, 0), mk(4, 20), mk(5, 30), mk(6, 40)]);
  eq(h[0].label, "Levels 2, 4–6 (4 floors)");
  eq(LV.groupLevels([]), []);
});

t("levelsFrom drawn: one level with the core and the typed spine; plateFromState shapes", () => {
  const state = baseState({ corridor: { kind: "auto", width: null, wall: 0.5, side: "south", spine: [[[-100, 0], [100, 0]]] } });
  const lv = LV.levelsFrom(state, null);
  eq(lv.length, 1);
  eq([lv[0].index, lv[0].program, lv[0].z], [1, "residential", 0]);
  eq(lv[0].core, rect(-15, 2.835, 15, 32.5));
  eq(lv[0].spines, [[[-100, 0], [100, 0]]]);
  eq(LV.levelsFrom({ ...state, mode: "hotel" }, null)[0].program, "hotel");
  const area = (mp) => mp.reduce((s, pc) => s + Math.abs(pc.outer.reduce((a, p, i, r) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2 - pc.holes.reduce((a, h) => a + Math.abs(h.reduce((b, p, i, r) => b + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2, 0), 0);
  near(area(LV.plateFromState({ shape: "rect", w: 300, d: 65 })), 19500, 1e-6);
  // O: 250 x 220 less 120 x 90 = 55,000 - 10,800 = 44,200
  const o = LV.plateFromState({ shape: "O", w: 250, d: 220, courtW: 120, courtD: 90 });
  eq([o.length, o[0].holes.length], [1, 1]);
  near(area(o), 44200, 1e-6);
  ok(o[0].holes[0].reduce((a, p, i, r) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) < 0, "hole winds clockwise");
  // L 200 x 140 with arm 60: 200 * 60 + (140 - 60) * 60 = 16,800 (plan 8.3)
  near(area(LV.plateFromState({ shape: "L", w: 200, d: 140, arm: 60 })), 16800, 1e-6);
  // U 200 x 140 with arm 60: 200 * 140 - (200 - 120) * (140 - 60) = 21,600 (plan 8.4)
  near(area(LV.plateFromState({ shape: "U", w: 200, d: 140, arm: 60 })), 21600, 1e-6);
  // circle 100 ft, 64 segments: the equal-area polygon has pi * 50^2
  near(area(LV.plateFromState({ shape: "circle", w: 100, segments: 64 })), Math.PI * 2500, 0.1);   // the rings round to 0.001 ft
  near(area(LV.plateFromState({ shape: "polygon", points: [[0, 0], [200, 0], [200, 60], [60, 60], [60, 140], [0, 140]] })), 16800, 1e-6);
  for (const bad of [{ shape: "rect", w: 0, d: 10 }, { shape: "O", w: 100, d: 100, courtW: 100, courtD: 40 }, { shape: "blob", w: 1, d: 1 }]) {
    let thrown = false;
    try { LV.plateFromState(bad); } catch { thrown = true; }
    ok(thrown, "throws for " + JSON.stringify(bad));
  }
});

t("levels: inputs are not mutated", () => {
  const project = deepFreeze(midriseProject("double-bar"));
  const state = deepFreeze({ source: "project", levels: { showPodium: false } });
  const levels = LV.levelsFrom(state, project);
  deepFreeze(levels);
  LV.groupLevels(levels);
  ok(true);
});

/* ===================================================================== */
console.log("metrics");

// Test 21.
t("21 preset 8.1 on a five-floor massing: building 85 units, NRSF 75,389.0", () => {
  const fill = fixture81();
  const project = midriseProject("double-bar");
  const groups = LV.groupLevels(LV.levelsFrom({ source: "project", levels: {} }, project));
  const built = { source: "project", groups: [{ id: groups[0].id, levels: groups[0].levels, label: groups[0].label, first: 1, fill }], warnings: [] };
  const state = baseState({ source: "project" });
  const m = MT.computeMetrics(deepFreeze(state), deepFreeze(built));
  // a level: 17 units, NRSF = 526 * 28.665 = 15,077.79 -> 15,077.8; GSF 300 * 65 = 19,500; efficiency 15,077.79 / 19,500 = 0.7732
  const row = m.groups[0].row;
  eq(row.units, 17);
  near(row.nrsf, 15077.8, 0.05);
  eq(row.gsf, 19500);
  near(row.efficiency, 0.7732, 0.0005);
  near(row.avgUnitArea, 15077.79 / 17, 0.06);
  eq(row.byType, { studio: 2, "1br": 6, "1brden": 2, "2br": 5, "3br": 2 });
  // building: 17 * 5 = 85 units; 5 * 15,077.8 = 75,389.0; GSF 5 * 19,500 = 97,500
  eq(m.building.units, 85);
  eq(m.building.nrsf, 75389.0);
  eq(m.building.gsf, 97500);
  near(m.building.efficiency, 0.7732, 0.0005);
  eq(m.levels.map((l) => l.index), [1, 2, 3, 4, 5]);
  eq(m.levels.map((l) => l.units), [17, 17, 17, 17, 17]);
  eq(m.floors, 5);
  eq(m.mode, "multifamily");
  ok(/not a code check/i.test(m.caution));
});

t("21 mix against target: no miss (1BR -1, 3BR +1 stay inside one unit); building rows", () => {
  const m = MT.computeMetrics(baseState(), builtOf(fixture81(), [1, 2, 3, 4, 5]));
  const row = m.groups[0].row;
  eq(row.mix.targets, { studio: 2, "1br": 7, "1brden": 2, "2br": 5, "3br": 1 });
  eq(row.mix.misses, []);
  eq(row.mix.byType.map((r) => r.diff), [0, -1, 0, 0, 1]);
  const br = m.building.mix.find((r) => r.type === "1br");
  eq([br.count, br.target, br.diff], [30, 35, -5]);
  near(br.share, 30 / 85, 1e-4);
  eq(m.building.corners, 0);
  // exposures: south run 9 units, north runs 8
  eq(row.exposures, { N: 8, E: 0, S: 9, W: 0 });
  eq(m.building.exposures, { N: 40, E: 0, S: 45, W: 0 });
  // multifamily 85 units: Type A = ceil(0.02 * 85) = 2
  eq(m.building.accessible.required, 2);
  eq(m.building.accessible.provided, 0);
});

t("21 corridor graph numbers on 8.1: length 278, stair door path 278, dead ends 0, 3 support kinds", () => {
  const row = MT.computeMetrics(baseState(), builtOf(fixture81())).groups[0].row;
  // clear corridor 278 * 5.67 = 1,576.26 sf / 5.67 = 278 ft
  eq(row.corridor.lengthFt, 278);
  near(row.corridor.perUnit, 278 / 17, 0.05);
  eq(row.stairDoors.pathFt, 278);
  eq(row.stairDoors.count, 2);
  eq(row.stairDoors.deadEnds.map((d) => d.ft), [0, 0]);
  eq(row.stairDoors.deadEndMax, 0);
  // support: 4 remainders of 11 * 21.5 = 236.5 each = 946.0
  eq(row.support.count, 4);
  eq(row.support.areaSf, 946);
  eq(row.support.byKind.remainder.count, 4);
});

t("21 area closure on 8.1: corridor 1,576.3 + stairs 484 + core 890.0 + remainders 946 + NRSF 15,077.8 leaves the 526 sf allowance", () => {
  const c = MT.computeMetrics(baseState(), builtOf(fixture81())).groups[0].row.closure;
  near(c.corridor, 1576.3, 0.05);
  near(c.stairs, 484, 1e-6);
  near(c.core, 889.95, 0.06);   // 30 * 29.665
  near(c.support, 946, 1e-6);
  near(c.strip, 526, 0.15);
  near(c.expected, 526, 1e-6);
  eq(c.ok, true);
});

t("21 the dead end of a stair moved 30 ft off the corridor end is 30 ft", () => {
  // a stair mid-corridor: the spine runs on 30 ft past the stair, so the far end is 30 ft from the door
  const fill = fixture81();
  fill.stairs = [{ id: "S1", outer: rect(-150, -11, -139, 11), door: [-139, 0] }, { id: "S2", outer: rect(79, -11, 90, 11), door: [90, 0] }];
  fill.spine = [[[-150, 0], [120, 0]]];
  const d = MT.computeMetrics(baseState(), builtOf(fill)).groups[0].row.stairDoors;
  eq(d.pathFt, 229);          // (-139, 0) to (90, 0)
  eq(d.deadEnds.map((e) => e.ft), [0, 30]);
  eq(d.deadEndMax, 30);
});

t("21 a branched spine: junction, three ends, the longest stair path", () => {
  const fill = fixture81();
  fill.spine = [[[0, 0], [100, 0]], [[0, 0], [-100, 0]], [[0, 0], [0, 60]]];   // a T meeting at the origin
  fill.stairs = [
    { id: "A", outer: rect(-110, -5, -100, 5), door: [-100, 0] },
    { id: "B", outer: rect(100, -5, 110, 5), door: [100, 0] },
  ];
  const d = MT.computeMetrics(baseState(), builtOf(fill)).groups[0].row.stairDoors;
  eq(d.pathFt, 200);
  // the north branch end (0, 60) is 60 + 100 = 160 ft from the nearest door
  eq(d.deadEnds.map((e) => e.ft).sort((a, b) => a - b), [0, 0, 160]);
});

t("21 hotel reach: keys whose corridor door lies within housekeepingReach of the linen closet", () => {
  // a 240 x 60 hotel bar: corridor y -3..3, keys of 14.4 ft on both sides, linen closet at the middle
  const keys = [];
  const mk = (x0, y0, y1, ex) => { for (let i = 0; i < 7; i++) { const a = x0 + i * 14.4, b = a + 14.4; keys.push({ id: `1-${keys.length + 1}`, type: "king", outer: rect(a, y0, b, y1), area: 14.4 * (y1 - y0), exposures: [ex], corner: false, accessible: false }); } };
  mk(-108, -30, -3, "S"); mk(8, -30, -3, "S"); mk(-108, 3, 30, "N"); mk(8, 3, 30, "N");
  const fill = {
    plate: [{ outer: rect(-120, -30, 120, 30), holes: [] }], corridor: [{ outer: rect(-109, -3, 109, 3), holes: [] }],
    spine: [[[-120, 0], [120, 0]]], core: null,
    stairs: [{ id: "S1", outer: rect(-120, -11, -109, 11), door: [-109, 0] }, { id: "S2", outer: rect(109, -11, 120, 11), door: [109, 0] }],
    elevators: [], support: [{ id: "B1", kind: "linen", outer: rect(-4, 3, 4, 17) }], units: keys, runs: [], corners: [], warnings: [],
  };
  const hotel = baseState({ mode: "hotel", core: { rect: null }, corridor: { kind: "auto", width: 6.0, wall: 0.5, side: "south", spine: null } });
  const door = (u) => (u.outer[0][0] + u.outer[1][0]) / 2;
  const within = (reach) => keys.filter((u) => Math.abs(door(u)) <= reach + 1e-9).length;
  for (const reach of [150, 100, 60]) {
    const r = MT.computeMetrics({ ...hotel, housekeepingReach: reach }, builtOf(fill)).groups[0].row.hotel;
    eq(r.reachFt, reach);
    eq(r.within, within(reach), `reach ${reach}`);
    eq(r.within + r.outside, 28);
  }
  eq(within(150), 28);
  ok(within(100) < 28 && within(60) < within(100), "the reach count falls with the reach");
  near(MT.computeMetrics(hotel, builtOf(fill)).groups[0].row.hotel.farthestFt, Math.max(...keys.map((u) => Math.abs(door(u)))), 0.15);   // 8 + 6.5 * 14.4 = 101.6
  // a hotel row counts bays too: no suite, 28 keys = 28 bays
  eq(MT.computeMetrics(hotel, builtOf(fill)).groups[0].row.bays, 28);
});

t("21 hotel accessible keys are not scored and the building reads the table row", () => {
  const fill = fixture81();
  fill.units = fill.units.map((u, i) => (i === 0 ? { ...u, accessible: true } : u));
  const m = MT.computeMetrics(baseState(), builtOf(fill, [1, 2]));
  eq(m.building.accessible.provided, 2);
  const hotel = MT.computeMetrics(baseState({ mode: "hotel" }), builtOf(fill, [1, 2]));
  eq(hotel.building.accessible.required, 2);   // 34 keys fall in the 26 to 50 row: 2 accessible
  eq(hotel.building.accessible.rollIn, 0);
});

// Test 22.
t("22 checks: type-does-not-fit, run-too-short, mix-miss, stale-massing", () => {
  // type-does-not-fit: runs at a 60 ft bar's depth 26.165 drop the den and the 3BR
  const a = MT.computeMetrics(baseState(), builtOf(fixture81({ depth: 26.165 })));
  const dn = a.warnings.filter((w) => w.code === "type-does-not-fit");
  eq(dn.map((w) => w.where.type), ["1brden", "3br"]);
  ok(/26\.17|26\.16/.test(dn[0].message) && /32/.test(dn[0].message), "names the depth and the range: " + dn[0].message);
  eq(dn[0].severity, "info");
  ok(dn[0].where && dn[0].where.group === "g1");

  // run-too-short: a 15 ft run is under the narrowest unit (studio, 20 ft)
  const f = fixture81();
  f.runs = [...f.runs, { id: "R9", length: 15, depth: DEPTH }];
  const b = MT.computeMetrics(baseState(), builtOf(f));
  const rs = b.warnings.filter((w) => w.code === "run-too-short");
  eq(rs.length, 1);
  eq(rs[0].where.run, "R9");
  eq(rs[0].severity, "warn");

  // mix-miss: all the 2BR units turn into 3BR: 3BR 7 against 1 and 2BR 0 against 5
  const g = fixture81();
  g.units = g.units.map((u) => (u.type === "2br" ? { ...u, type: "3br" } : u));
  const c = MT.computeMetrics(baseState(), builtOf(g));
  eq(c.warnings.filter((w) => w.code === "mix-miss").map((w) => w.where.type), ["2br", "3br"]);
  eq(c.groups[0].row.mix.misses, ["2br", "3br"]);

  // stale-massing: the massing is newer than the fill, from the built result or from the third argument
  const d = MT.computeMetrics(baseState(), builtOf(fixture81(), [1], { massingUpdatedAt: "2026-10-01T00:00:00.000Z", currentMassingUpdatedAt: "2026-10-05T12:00:00.000Z" }));
  eq(d.warnings.filter((w) => w.code === "stale-massing").length, 1);
  eq(d.massing, { usedAt: "2026-10-01T00:00:00.000Z", currentAt: "2026-10-05T12:00:00.000Z" });
  const e = MT.computeMetrics(baseState(), builtOf(fixture81(), [1], { massingUpdatedAt: "2026-10-01T00:00:00.000Z" }));
  eq(e.warnings.filter((w) => w.code === "stale-massing").length, 0);
  eq(MT.checks(baseState(), e, { massingUpdatedAt: "2026-10-02T00:00:00.000Z" }).filter((w) => w.code === "stale-massing").length, 1);
  eq(MT.checks(baseState(), e, { massingUpdatedAt: "2026-09-30T00:00:00.000Z" }).filter((w) => w.code === "stale-massing").length, 0);
});

t("22 checks: a clean 8.1 level has no warnings; fill warnings pass through; no duplicate derived warnings", () => {
  eq(MT.computeMetrics(baseState(), builtOf(fixture81())).warnings, []);
  const f = fixture81();
  f.warnings = [{ code: "core-blocks-corridor", severity: "warn", where: { x: 0, y: 0 }, message: "The core blocks the corridor." }, { code: "run-too-short", severity: "warn", where: { run: "R9" }, message: "Run R9 is 15 ft." }];
  f.runs = [...f.runs, { id: "R9", length: 15, depth: DEPTH }];
  const m = MT.computeMetrics(baseState(), builtOf(f));
  eq(m.warnings.map((w) => w.code).filter((c) => c !== "area-closure"), ["core-blocks-corridor", "run-too-short"]);   // the extra 15 ft run also leaves the allowance open
  eq(m.warnings[0].where.group, "g1");
  eq(m.buildWarnings.length, 2);
  // build warnings from buildPlates come first
  const n = MT.computeMetrics(baseState(), builtOf(fixture81(), [1], { warnings: [{ code: "no-fillable-levels", severity: "warn", where: null, message: "x" }] }));
  eq(n.warnings.map((w) => w.code), ["no-fillable-levels"]);
});

t("22 area closure flags a fill that leaves the allowance", () => {
  const f = fixture81();
  f.units = f.units.slice(1);   // one unit missing: 28.665 * 20 sf more strip
  const m = MT.computeMetrics(baseState(), builtOf(f));
  ok(m.warnings.some((w) => w.code === "area-closure"), "area-closure warns");
  eq(m.groups[0].row.closure.ok, false);
});

t("metrics: inputs are not mutated; missing inputs name themselves", () => {
  const state = deepFreeze(baseState());
  const built = deepFreeze(builtOf(fixture81(), [1, 2, 3]));
  const m = MT.computeMetrics(state, built);
  MT.checks(state, m);
  let msg = "";
  try { MT.computeMetrics(state, {}); } catch (err) { msg = err.message; }
  ok(/built\.groups/.test(msg), msg);
  msg = "";
  try { MT.checks(state, null); } catch (err) { msg = err.message; }
  ok(/checks/.test(msg), msg);
  // a group without a fill is skipped
  eq(MT.computeMetrics(state, { groups: [{ id: "x", levels: [1], fill: null }] }).building.units, 0);
});

/* ===================================================================== */
// The real fill, when it exists: preset 8.1 through buildPlates and computeMetrics.
if (existsSync(new URL("../src/plate/fill.js", import.meta.url))) {
  console.log("real (fill.js)");
  let FL = null;
  try { FL = await import("../src/plate/fill.js"); } catch (e) { console.log("  skip real: " + e.message.split("\n")[0]); }
  if (FL && typeof FL.buildPlates === "function") {
    const draw = (over) => ({
      ...baseState(), name: "Option A",
      stairs: { mode: "auto", size: [11, 22], items: [] },
      elevators: { count: null, size: [8, 10], service: null },
      support: [], hotelBoh: { on: false, place: "core" },
      accessible: { multifamily: { typeAShare: 0.02, minUnits: 1, over: 20 }, hotel: MX.ACCESSIBLE_DEFAULTS.hotel, perFloor: null },
      locks: [], placement: null, ...over,
    });
    let built = null;
    t("real 8.1: buildPlates → computeMetrics runs and the numbers sit near section 8.1", () => {
      // Plan 3.2: "auto" with a core and no spine resolves to a point corridor, so 8.1 names the bar kind (as presets.js does).
      const bar = draw({ corridor: { ...baseState().corridor, kind: "bar" } });
      built = FL.buildPlates(bar, { project: null });
      const m = MT.computeMetrics(bar, built);
      const row = m.groups[0].row;
      console.log(`       units ${row.units}, nrsf ${row.nrsf}, eff ${row.efficiency}, corridor ${row.corridor.lengthFt}, path ${row.stairDoors.pathFt}, dead ${row.stairDoors.deadEndMax}, closure ${JSON.stringify(row.closure)}`);
      console.log(`       mix ${JSON.stringify(row.byType)} warnings ${m.warnings.map((w) => w.code).join(",")}`);
      ok(Math.abs(row.units - 17) <= 1, "units " + row.units);
      near(row.nrsf, 15077.8, 1, "nrsf");
    });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
