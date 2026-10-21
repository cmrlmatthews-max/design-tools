// Run: node test/parking.layout.test.mjs
// Plan: docs/parking-deck-technical-plan.md, section 9.1 tests 1 to 10, the section 8 row counts
// (stalls per level before the accessible aisles), plus contract checks.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { layout, layoutFrame, baysOf, rowStalls, runOf, levelList, moveCoreToRow, SCALE } = await import("../src/parking/layout.js");
const { rampSlope, rampsFor, splitEndZone, circularRamp, speedRampFootprint } = await import("../src/parking/ramps.js");
const { columnsFor, clearHeights } = await import("../src/parking/grid.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

function signedArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const mpArea = (mp) => mp.reduce((s, p) => s + Math.abs(signedArea(p.outer)) - p.holes.reduce((h, r) => h + Math.abs(signedArea(r)), 0), 0);
function deepFreeze(o) {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const total = (b) => b.levels.reduce((s, l) => s + l.stalls.length, 0);
const perLevel = (b) => b.levels.map((l) => l.stalls.length);

/* ---- inline states (presets.js is written in parallel; these follow plan section 8) ---- */

// Standard cores for 300-wide decks with 24 ft turn zones (plan 8, "Standard cores").
// S2 sits in the north row of the top bay, flush to its north edge, ending at the last stall (x 268).
const stdCores = (topNorthY1, s2x = 246) => [
  { id: "S1", kind: "stair", x: 25, y: 1, w: 22, d: 12 },
  { id: "E1", kind: "elevator", x: 52, y: 1, w: 10, d: 10 },
  { id: "S2", kind: "stair", x: s2x, y: topNorthY1 - 12, w: 22, d: 12 },
];

function base(over = {}) {
  const s = {
    schema: 1, name: "Test", source: "standalone", sourceLevel: null,
    footprint: { shape: "rect", width: 300, depth: 125, points: [], x: 0, y: 0, angle: 0, perimeter: 1 },
    placement: null,
    levels: { count: 5, ftf1: 11, ftf: 10.5, belowGrade: 0, openTop: true },
    bays: { stallW: 9, stallD: 18, aisle: 24, edgeBays: true, compactShare: 0, compactW: 8, compactD: 16, turnZone: null, rotateBays: false },
    grid: { span: "long", column: 2, stallsPerModule: 3, structureDepth: { long: 2.5, short: 1.5 } },
    ramp: {
      type: "single-helix", slopedBay: 1,
      speed: { x: 99, y: 123, width: 24, length: 82, shape: "straight", insideRadius: 30, segments: 12 },
      splitLength: 36, transition: { length: 10, slopeFactor: 0.5 },
    },
    cores: stdCores(121),
    coresFromProject: true,
    entries: [{ id: "N1", side: "west", at: 31, width: 24 }],
    liner: { on: false, side: "south", depth: 61, levels: [1] },
    checks: { slopeParking: 0.0667, slopeSpeed: 0.12, crossSlope: 0.02, barrier: 2.75, guard: 3.5, clearGeneral: 7.0, clearVan: 8.1667, barrierProvided: 3.5, overlayTolerance: 2 },
    ev: { readyShare: 0.2, installedShare: 0.05 },
  };
  for (const [k, v] of Object.entries(over)) s[k] = v && typeof v === "object" && !Array.isArray(v) && s[k] && typeof s[k] === "object" ? { ...s[k], ...v } : v;
  return s;
}

const P = {
  // 8.1 two bays, single helix, five levels: per level 4 × 27 − 8 = 100
  "8.1": base(),
  // 8.2 300 × 185, three bays, sloped center bay: top bay N row 163..181 → per level 6 × 27 − 8 = 154
  "8.2": base({ footprint: { depth: 185 }, ramp: { type: "sloped-floor", slopedBay: 1 }, cores: stdCores(181) }),
  // 8.3 360 × 125 double helix, six levels: run 310 → 34 per row; last stall 322..331 → S2 x 309..331 → 4 × 34 − 8 = 128
  "8.3": base({ footprint: { width: 360 }, levels: { count: 6 }, ramp: { type: "double-helix" }, cores: stdCores(121, 309) }),
  // 8.4 300 × 150 speed ramp in the 28 ft strip (y 121..149): 102 × 24 at x 99..201, y 123..147 → 100 per level
  "8.4": base({ footprint: { depth: 150 }, ramp: { type: "speed" } }),
  // 8.5 split-level, six levels: end zones 56 → run 186 → 20 per row; cores shifted → 4 × 20 − 8 = 72
  "8.5": base({ levels: { count: 6 }, ramp: { type: "split" }, cores: [
    { id: "S1", kind: "stair", x: 57, y: 1, w: 22, d: 12 },
    { id: "E1", kind: "elevator", x: 84, y: 1, w: 10, d: 10 },
    { id: "S2", kind: "stair", x: 215, y: 109, w: 22, d: 12 },
  ] }),
  // 8.6 wrap deck: same geometry as 8.1, source wrap → 100 per level
  "8.6": base({ source: "wrap" }),
  // 8.7 podium 300 × 65, one level, ramp none: 54 − 11 = 43
  "8.7": base({ source: "podium", footprint: { depth: 65 }, levels: { count: 1, openTop: false }, ramp: { type: "none" }, cores: [
    { id: "S1", kind: "stair", x: 25, y: 1, w: 22, d: 12 },
    { id: "E1", kind: "elevator", x: 52, y: 1, w: 10, d: 10 },
    { id: "S2", kind: "stair", x: 142, y: 1, w: 22, d: 12 },
    { id: "S3", kind: "stair", x: 246, y: 49, w: 22, d: 12 },
  ] }),
  // 8.8 two-level podium 300 × 206, short-span, speed ramp in the 24 ft strip (y 181..205), liner south 61 on level 1
  "8.8": base({ source: "podium", footprint: { depth: 206 }, levels: { count: 2, openTop: false }, grid: { span: "short" },
    ramp: { type: "speed", speed: { x: 99, y: 181, width: 24, length: 82, shape: "straight", insideRadius: 30, segments: 12 } },
    liner: { on: true, side: "south", depth: 61, levels: [1] },
    cores: [
      { id: "S1", kind: "stair", x: 25, y: 61, w: 22, d: 12 },
      { id: "E1", kind: "elevator", x: 58, y: 61, w: 10, d: 10 },
      { id: "S2", kind: "stair", x: 246, y: 169, w: 22, d: 12 },
    ] }),
  // 8.9 hand example A: no cores, every ftf 10.5 → 4 × 27 = 108 per level
  "8.9": base({ levels: { ftf1: 10.5 }, cores: [] }),
};
deepFreeze(P);

const frameOf = (s) => layoutFrame(s);
const stateWithDepth = (D) => base({ footprint: { depth: D } });

console.log("parking layout");

/* ---- test 1: bays ---- */
t("1 bays for D = 125, 150, 185, 206, 65 → 2+3, 2+28, 3+3, 3+24, 1+3", () => {
  // Du = D − 2: 123 = 2·60 + 3; 148 = 2·60 + 28; 183 = 3·60 + 3; 204 = 3·60 + 24; 63 = 60 + 3. No remainder ≥ 42.
  const cases = [[125, 2, 3], [150, 2, 28], [185, 3, 3], [206, 3, 24], [65, 1, 3]];
  for (const [D, n, strip] of cases) {
    const s = stateWithDepth(D);
    const { bays, strip: st } = baysOf(s, frameOf(s));
    eq(bays.length, n, `D ${D} bays`);
    ok(bays.every((b) => b.kind === "double"), `D ${D} all double`);
    ok(st, `D ${D} strip`);
    near(st.y1 - st.y0, strip, 1e-9, `D ${D} strip width`);
    eq(st.y1, D - 1, `D ${D} strip top`);
  }
  // 8.4 strip y 121 .. 149; 8.8 strip y 181 .. 205
  const s4 = stateWithDepth(150), b4 = baysOf(s4, frameOf(s4));
  eq(b4.strip.y0, 121); eq(b4.strip.y1, 149);
  const s8 = stateWithDepth(206), b8 = baysOf(s8, frameOf(s8));
  eq(b8.strip.y0, 181); eq(b8.strip.y1, 205);
  // bay rows: bay 1 S 1..19, aisle 19..43, N 43..61
  const s1 = stateWithDepth(125), b1 = baysOf(s1, frameOf(s1)).bays[0];
  eq(b1.index, 1); eq(b1.rows[0].id, "S"); eq(b1.rows[0].y0, 1); eq(b1.rows[0].y1, 19);
  eq(b1.aisle.y0, 19); eq(b1.aisle.y1, 43); eq(b1.rows[1].id, "N"); eq(b1.rows[1].y1, 61); eq(b1.y1, 61);
});

/* ---- test 2: edge bay ---- */
t("2 edge bay: D = 104 (Du 102) → 1 double + 1 single (42), strip 0", () => {
  // 102 − 60 = 42 ≥ 42 → single-loaded edge bay at the north; 42 − 42 = 0 → no strip.
  const s = stateWithDepth(104);
  const { bays, strip } = baysOf(s, frameOf(s));
  eq(bays.length, 2);
  eq(bays[0].kind, "double"); eq(bays[1].kind, "single");
  eq(bays[1].y1 - bays[1].y0, 42, "single width");
  eq(bays[1].aisle.y0, 61, "aisle first"); eq(bays[1].aisle.y1, 85);
  eq(bays[1].rows.length, 1); eq(bays[1].rows[0].id, "N"); eq(bays[1].rows[0].y0, 85); eq(bays[1].rows[0].y1, 103);
  eq(strip, null, "strip");
  // edgeBays off → strip 42
  const s2 = base({ footprint: { depth: 104 }, bays: { edgeBays: false } });
  const b2 = baysOf(s2, frameOf(s2));
  eq(b2.bays.length, 1); eq(b2.strip.y1 - b2.strip.y0, 42);
});

/* ---- test 3: long-span row ---- */
t("3 long-span row, R = 250 → 27 stalls; stall 26 spans 259..268", () => {
  // xs = 1 + 24 = 25, xe = 300 − 1 − 24 = 275, R = 250; floor(250 ÷ 9) = 27; stall 26 = 25 + 26·9 = 259 .. 268.
  const s = P["8.1"], f = frameOf(s);
  const run = runOf(s, f);
  eq(run.xs, 25); eq(run.xe, 275); eq(run.length, 250);
  const st = rowStalls(s, f, { id: "S", y0: 1, y1: 19 });
  eq(st.length, 27);
  eq(st[26].k, 26); eq(st[26].x0, 259); eq(st[26].x1, 268);
  eq(st[0].x0, 25); eq(st[0].y0, 1); eq(st[0].y1, 19);
});

/* ---- test 4: short-span row ---- */
t("4 short-span row, R = 250 → 25 stalls (8 modules + 1)", () => {
  // M = 2 + 3·9 = 29; floor(250 ÷ 29) = 8 modules (232 ft); rr = 18; extra floor((18 − 2) ÷ 9) = 1 → 8·3 + 1 = 25.
  const s = base({ grid: { span: "short" } }), f = frameOf(s);
  const st = rowStalls(s, f, { id: "S", y0: 1, y1: 19 });
  eq(st.length, 25);
  eq(st[0].x0, 27, "first stall after the first column 25..27");
  eq(st[3].x0, 56, "module 1: column 54..56, stall 56..65");
  eq(st[24].x0, 259, "extra stall after the column 257..259"); eq(st[24].x1, 268);
});

/* ---- test 5: cores ---- */
t("5 cores S1 25..47 and E1 52..62 in one row → 3 and 2 lost, no double count", () => {
  // S1 [25,47]×[1,13]: stalls 25..34, 34..43, 43..52 (4 × 12 = 48 sf) → 3. E1 [52,62]×[1,11]: 52..61, 61..70 (1 × 10 = 10 sf) → 2.
  const s = base({ levels: { count: 1 }, cores: stdCores(121).slice(0, 2), entries: [] });
  const b = layout(s);
  const lv = b.levels[0];
  const cut = (id) => lv.cuts.find((c) => c.id === id);
  eq(cut("S1").lost, 3, "S1"); eq(cut("E1").lost, 2, "E1");
  eq(lv.stalls.length, 108 - 5);
  eq(lv.lost.length, 5);
  ok(!lv.stalls.some((x) => x.id === "P1-1S-005"), "k 4 (61..70) lost");
  ok(lv.stalls.some((x) => x.id === "P1-1S-006"), "k 5 (70..79) kept");
  // overlapping cores: E1 moved to 45..55 overlaps stall 43..52 together with S1 → still lost once
  const s2 = base({ levels: { count: 1 }, entries: [], cores: [
    { id: "S1", kind: "stair", x: 25, y: 1, w: 22, d: 12 }, { id: "E1", kind: "elevator", x: 45, y: 1, w: 10, d: 10 }] });
  const l2 = layout(s2).levels[0];
  // stalls 25..34, 34..43, 43..52 (S1 48 sf, E1 70 sf → charged to E1), 52..61 (E1 30 sf) → 4 lost in total
  eq(l2.lost.length, 4, "lost once");
  eq(l2.cuts.find((c) => c.id === "S1").lost + l2.cuts.find((c) => c.id === "E1").lost, 4);
  eq(new Set(l2.lost.map((x) => x.id)).size, 4);
  // core in a stall row raises no aisle warning; a core in the aisle does, with the move action
  ok(!layout(P["8.1"]).warnings.some((w) => w.code === "core-in-aisle"), "standard cores sit in rows");
  const s3 = base({ levels: { count: 1 }, cores: [{ id: "S1", kind: "stair", x: 100, y: 25, w: 22, d: 12 }] });
  const b3 = layout(s3);
  const w = b3.warnings.find((x) => x.code === "core-in-aisle");
  ok(w && w.id === "S1" && w.action === "move-to-row" && w.message === "S1 sits in the drive aisle.", "aisle warning");
  ok(b3.cores[0].inAisle);
  const mv = moveCoreToRow(s3.cores[0], b3);
  // core center y 31 → nearest row centers: 1S 10, 1N 52 → 1S, flush to y 1
  eq(mv.y, 1); eq(mv.x, 100); eq(mv.rowId, "1S");
});

/* ---- test 6: entry on a long side ---- */
t("6 entry on the south side at x 150, width 24 → 4 stalls lost (k 12 to 15)", () => {
  // lane 138..162 from y 0 to the first aisle (y 19); k 12 = 25 + 108 = 133..142 (4 ft overlap), k 15 = 160..169 (2 ft).
  const s = base({ levels: { count: 2 }, cores: [], entries: [{ id: "N1", side: "south", at: 150, width: 24 }] });
  const b = layout(s);
  const l1 = b.levels[0];
  eq(l1.cuts.find((c) => c.id === "N1").lost, 4);
  const lostK = l1.lost.map((x) => x.id).sort();
  eq(JSON.stringify(lostK), JSON.stringify(["P1-1S-013", "P1-1S-014", "P1-1S-015", "P1-1S-016"]));
  eq(l1.stalls.length, 104);
  eq(b.levels[1].stalls.length, 108, "entries cut the entry level only");
  // the default west entry sits in the turn zone: no loss
  const w = layout(P["8.9"]);
  eq(w.levels[0].cuts.find((c) => c.id === "N1").lost, 0);
});

/* ---- test 7: ramp slope formula ---- */
t("7 rampSlope(11, 82, { length 10, factor 0.5 }) = 0.11957", () => {
  // s = 11 ÷ (82 + 2 · 0.5 · 10) = 11 ÷ 92 = 0.119565…
  near(rampSlope(11, 82, { length: 10, slopeFactor: 0.5 }), 0.11957, 5e-6);
  near(rampSlope(5.5, 250, null), 0.022, 1e-12);
  eq(splitEndZone(P["8.5"]), 56);
});

/* ---- test 8: single helix ---- */
t("8 single helix 300 × 125 level 1 → 0.022; typical 0.021", () => {
  // level 1: (11 ÷ 2) ÷ 250 = 0.022; typical (10.5 ÷ 2) ÷ 250 = 0.021. Two bays × 4 levels that leave = 8 ramps.
  const b = layout(P["8.1"]);
  const r = rampsFor(P["8.1"], b);
  eq(r.length, 8);
  const l1 = r.filter((x) => x.level === 1);
  eq(l1.length, 2);
  near(l1[0].slope, 0.022, 1e-12); near(l1[1].slope, 0.022, 1e-12);
  near(r.find((x) => x.level === 2).slope, 0.021, 1e-12);
  ok(r.every((x) => x.ok && x.limit === 0.0667 && x.footprint === null));
  eq(l1[0].id, "R1-B1");
  // outer3d: bay 1 climbs east from z 0 to 5.5, bay 2 climbs west from 5.5 to 11
  const o1 = l1[0].outer3d, o2 = l1[1].outer3d;
  eq(o1[0][2], 0); eq(o1[1][2], 5.5); eq(o1[1][0], 275);
  eq(o2[0][2], 11); eq(o2[1][2], 5.5);
});

/* ---- test 9: circular ramp ---- */
t("9 circular ramp radius 30, width 24, 12 segments → length 263.9; 12 segments", () => {
  // centerline radius 30 + 12 = 42; 2π · 42 = 263.894
  const c = circularRamp(30, 24, 12);
  near(c.length, 263.9, 0.05);
  eq(c.segmentsRing.length, 12);
  eq(c.centerline.length, 13);
  near(Math.hypot(...c.segmentsRing[0]), 54, 1e-9, "footprint radius 30 + 24");
  ok(signedArea(c.segmentsRing) > 0, "CCW");
  ok(c.arc.length > 12, "true arc sampled finer than the segments");
  // as a speed ramp: slope = 11 ÷ (263.894 + 10) per turn
  const s = base({ footprint: { depth: 150 }, ramp: { type: "speed", speed: { x: 99, y: 0, width: 24, shape: "circular", insideRadius: 30, segments: 12 } } });
  const b = layout(s);
  const r = rampsFor(s, b).find((x) => x.level === 1);
  near(r.slope, 11 / (2 * Math.PI * 42 + 10), 1e-9);
  const fp = speedRampFootprint(s);
  eq(fp.shape, "circular"); eq(fp.box[2], 99 + 108);
  ok(b.levels[0].cuts.find((c) => c.kind === "ramp").lost > 0, "the circle over the bays cuts stalls");
  ok(b.warnings.some((w) => w.code === "ramp-stalls"));
});

/* ---- test 10: grid ---- */
t("10 preset 8.1: 33 columns per level; clear heights 8.5 and 8.0 pass", () => {
  // lines y 1, 61, 121; x = 25 + 27k, k 0..floor(250 ÷ 27) = 9 → 10, plus xe 275 (gap 275 − 268 = 7) → 11 × 3 = 33
  const b = layout(P["8.1"]);
  const c = columnsFor(P["8.1"], b);
  eq(c.points.length, 33); eq(c.lines.length, 3); eq(c.module, 27);
  eq(JSON.stringify(c.lines.map((l) => l.y)), "[1,61,121]");
  eq(c.lines[0].xs[9], 268); eq(c.lines[0].xs[10], 275);
  const h = clearHeights(P["8.1"]);
  eq(h.length, 5);
  eq(h[0].clear, 8.5); eq(h[0].min, 8.1667); ok(h[0].ok);     // 11 − 2.5 = 8.5 ≥ 8 ft 2 in
  eq(h[1].clear, 8); eq(h[1].min, 7); ok(h[1].ok);            // 10.5 − 2.5 = 8.0 ≥ 7.0
  eq(h[4].clear, null); ok(h[4].open && h[4].ok, "open top");
  // short-span 8.8: lines on every bay edge and row/aisle line: y 1,19,43,61,79,103,121,139,163,181 = 10;
  // x = 25 + 29j, j 0..8 → 9, plus 275 (gap 18) → 10 per line → 100
  const c8 = columnsFor(P["8.8"], layout(P["8.8"]));
  eq(c8.lines.length, 10); eq(c8.points.length, 100); eq(c8.module, 29);
  // 8.6 in a project with ftf 10.5 everywhere: level 1 clear 8.0 < 8.17 → fails (the planned warning)
  const h6 = clearHeights(base({ source: "wrap", levels: { ftf1: 10.5 } }));
  eq(h6[0].clear, 8); ok(!h6[0].ok);
});

/* ---- plan section 8: stalls per level before the accessible aisles (N0) ---- */
t("8.x row counts match the plan by hand", () => {
  const expect = {
    "8.1": [100, 100, 100, 100, 100],              // 4 × 27 − 8
    "8.2": [154, 154, 154, 154, 154],              // 6 × 27 − 8
    "8.3": [128, 128, 128, 128, 128, 128],         // 4 × 34 − 8
    "8.4": [100, 100, 100, 100, 100],              // ramp in the strip costs nothing
    "8.5": [72, 72, 72, 72, 72, 72],               // 4 × 20 − 8
    "8.6": [100, 100, 100, 100, 100],
    "8.7": [43],                                   // 54 − 11
    "8.8": [92, 142],                              // 4 × 25 − 8 (liner removes bay 1); 6 × 25 − 8
    "8.9": [108, 108, 108, 108, 108],              // 4 × 27
  };
  const N0 = { "8.1": 500, "8.2": 770, "8.3": 768, "8.4": 500, "8.5": 432, "8.6": 500, "8.7": 43, "8.8": 234, "8.9": 540 };
  for (const [id, per] of Object.entries(expect)) {
    const b = layout(P[id]);
    eq(JSON.stringify(perLevel(b)), JSON.stringify(per), id);
    eq(total(b), N0[id], id + " N0");
    eq(b.levels[0].cuts.find((c) => c.kind === "entry") ? b.levels[0].cuts.find((c) => c.kind === "entry").lost : 0, 0, id + " entry free");
  }
  // 8.4 ramp footprint 102 × 24 at x 99..201, y 123..147, no loss
  const b4 = layout(P["8.4"]);
  const rc = b4.levels[0].cuts.find((c) => c.kind === "ramp");
  eq(JSON.stringify(rc.ring), "[[99,123],[201,123],[201,147],[99,147]]"); eq(rc.lost, 0);
  // 8.8 short-span run → 25 per row; liner removes bay 1 on level 1 only, no partial-aisle warning
  const b8 = layout(P["8.8"]);
  eq(b8.levels[0].cuts.find((c) => c.kind === "liner").lost, 50);
  ok(!b8.warnings.some((w) => w.code === "liner-aisle"));
  ok(!b8.levels[1].cuts.some((c) => c.kind === "liner"));
});

t("8.x ramp slopes match the plan", () => {
  const s1 = (id) => rampsFor(P[id], layout(P[id])).filter((r) => r.level === 1);
  near(s1("8.2")[0].slope, 11 / 250, 1e-12); eq(s1("8.2").length, 1); eq(s1("8.2")[0].bay, 2);   // sloped bay 1 (0-based) = bay index 2
  near(s1("8.3")[0].slope, 11 / 310, 1e-12); eq(s1("8.3").length, 2);                          // 3.55 %
  near(s1("8.4")[0].slope, 11 / 92, 1e-12); ok(s1("8.4")[0].ok);                               // 11.96 % ≤ 12 %
  near(s1("8.5")[0].slope, 5.5 / 46, 1e-12); eq(s1("8.5").length, 2);                          // two end ramps
  near(s1("8.8")[0].slope, 11 / 92, 1e-12);
  near(rampsFor(P["8.9"], layout(P["8.9"]))[0].slope, 0.021, 1e-12);                           // 5.25 ÷ 250
  eq(rampsFor(P["8.7"], layout(P["8.7"])).length, 0, "one level, ramp none");
  // speed ramp outline: 8 points, rising 0 → 11 with the transitions at 10 and 92
  const o = s1("8.4")[0].outer3d;
  eq(o.length, 8); eq(o[0][2], 0); eq(o[3][2], 11); eq(o[1][0], 109); eq(o[2][0], 191);
  near(o[1][2], 0.5 * (11 / 92) * 10, 0.001);
});

/* ---- contract checks ---- */
t("contract: frozen input, ids, rings, levels, MultiPolys, no Clipper in draft", () => {
  const b = layout(P["8.1"]);         // P is deep-frozen: any mutation throws
  const lv = b.levels[0];
  eq(lv.index, 1); eq(lv.z, 0); eq(lv.ftf, 11); eq(b.levels[1].z, 11); eq(b.levels[2].z, 21.5);
  const st = lv.stalls[0];
  eq(st.id, "P1-1S-006"); eq(st.level, 1); eq(st.bay, 1); eq(st.row, "S"); eq(st.k, 5);   // k 0..2 S1, k 3..4 E1 eq(st.kind, "standard"); eq(st.evReady, false);
  ok(signedArea(st.outer) > 0, "stall CCW");
  ok(lv.stalls.every((x) => /^P\d+-\d+[SN]-\d{3}$/.test(x.id)));
  eq(new Set(b.levels.flatMap((l) => l.stalls.map((x) => x.id))).size, 500, "unique ids");
  // aisles 250 × 24 × 2 = 12,000; turn zones 2 × 24 × 120 = 5,760; rows (4 × 243 × 18) − cores (22·12·2 + 10·10) = 17,496 − 628
  near(mpArea(lv.aisles), 12000, 0.01); near(mpArea(lv.turnZones), 5760, 0.01); near(mpArea(lv.rows), 17496 - 628, 0.01);
  for (const mp of [lv.aisles, lv.turnZones, lv.rows, lv.plate]) for (const p of mp) ok(signedArea(p.outer) > 0, "outer CCW");
  near(mpArea(lv.plate), 37500, 1e-9);
  eq(b.frame.W, 300); eq(b.frame.D, 125); eq(JSON.stringify(b.frame.origin), "[-150,-62.5]");
  eq(JSON.stringify(b.frame.toLocal([150, 62.5])), "[0,0]");
  const saved = globalThis.ClipperLib;
  globalThis.ClipperLib = undefined;
  try {
    const d = layout(P["8.1"], { quality: "draft" });
    eq(d.quality, "draft"); eq(total(d), 500, "draft counts equal full");
  } finally { globalThis.ClipperLib = saved; }
  eq(SCALE, 1000);
  eq(JSON.stringify(levelList(base({ levels: { count: 3, belowGrade: 1 } })).map((l) => l.z)), "[-11,0,10.5]");
});

t("frame: rotated, tall and rotateBays footprints keep the counts", () => {
  // the same 300 × 125 deck turned 30 degrees, or typed 125 wide × 300 deep, lays out the same stalls
  const s30 = base({ footprint: { angle: 30, x: 40, y: -20 } });
  eq(total(layout(s30)), 500);
  const f30 = layoutFrame(s30);
  eq(f30.angle, 30);
  const back = f30.toLocal(f30.toLayout([12.345, 67.891]));
  near(back[0], 12.345, 0.002); near(back[1], 67.891, 0.002);
  const tall = base({ footprint: { width: 125, depth: 300 } });
  const ft = layoutFrame(tall);
  eq(ft.W, 300); eq(ft.D, 125); eq(ft.angle, 90);
  eq(total(layout(tall)), 500);
  // rotateBays: bays run along the 125 side → W 125, D 300: Du 298 → 4 bays (240) + edge bay (42) + strip 16;
  // run 125 − 2 − 48 = 75 → 8 per row; rows 4·2 + 1 = 9 → 72 per level before cores (cores moved off: none)
  const rb = base({ bays: { rotateBays: true }, cores: [], levels: { count: 1 } });
  const brb = layout(rb);
  eq(brb.frame.W, 125); eq(brb.bays.length, 5); eq(brb.bays[4].kind, "single");
  near(brb.strip.y1 - brb.strip.y0, 16, 1e-9);
  eq(total(brb), 72);
});

t("polygon footprint: a rectangle polygon equals the rect; an L loses the notch", () => {
  const pts = [[-150, -62.5], [150, -62.5], [150, 62.5], [-150, 62.5]];
  const sp = base({ footprint: { shape: "polygon", points: pts } });
  const bp = layout(sp);
  eq(bp.frame.W, 300); eq(bp.frame.D, 125); eq(total(bp), 500);
  near(mpArea(bp.levels[0].aisles), 12000, 0.01);
  eq(columnsFor(sp, bp).points.length, 33);
  // L: notch 100 × 61 out of the northeast corner (x 50..150, y 1.5..62.5 local → layout x 200..300, y 64..125)
  const L = [[-150, -62.5], [150, -62.5], [150, 1.5], [50, 1.5], [50, 62.5], [-150, 62.5]];
  const sl = base({ footprint: { shape: "polygon", points: L }, cores: [], levels: { count: 1 } });
  const bl = layout(sl);
  eq(bl.frame.W, 300); eq(bl.frame.D, 125);
  // bay 2 north row (y 103..121) and south row (61..79): the inset edge sits at x 199 (layout) for y > 63;
  // bay 2 S row 61..79 crosses y 63 → its stalls past x 199 lose 16 × 9 = 144 sf → lost; stalls ending ≤ 199 stay.
  // rows below y 63 keep 27; bay 2 rows keep stalls with x1 ≤ 199: 25 + 9k + 9 ≤ 199 → k ≤ 18 → 19 each.
  eq(perLevel(bl)[0], 27 * 2 + 19 * 2);
  ok(bl.levels[0].lost.every((x) => x.by === "footprint"));
  ok(columnsFor(sl, bl).points.length < 33, "columns in the notch dropped");
});

t("compact share converts rows farthest from the elevator", () => {
  // compact row: 8 ft stalls → floor(250 ÷ 8) = 31; share 0.2 of 4 rows: c = 1 → 31 ÷ (3·27 + 31) = 0.277 ≥ 0.2
  const s = base({ bays: { compactShare: 0.2 }, cores: [{ id: "E1", kind: "elevator", x: 52, y: 1, w: 10, d: 10 }], levels: { count: 1 }, entries: [] });
  const b = layout(s);
  const compact = b.levels[0].stalls.filter((x) => x.kind === "compact");
  eq(compact.length, 31);
  ok(compact.every((x) => x.id.startsWith("P1-2N-")), "the row farthest from E1 (bay 2 north)");
  eq(b.bays[1].rows[1].y1 - b.bays[1].rows[1].y0, 16, "compact row depth");
  near(b.strip.y1 - b.strip.y0, 5, 1e-9, "2 ft gained → strip 5");
});

t("project: footprint from deck levels and cores from bar seeds", () => {
  const plate = [{ outer: [[0, 0], [300, 0], [300, 125], [0, 125]], holes: [] }];
  const project = {
    format: "cmrlm-design-tools/project", version: 1,
    sections: { massing: { derived: { levels: [
      { index: 1, zone: "bar", z: 0, ftf: 12, plates: [{ outer: [[0, 140], [300, 140], [300, 205], [0, 205]], holes: [] }],
        seeds: [{ kind: "stair", outer: [[400, 150], [422, 150], [422, 162], [400, 162]] }] },
      { index: 6, zone: "deck", z: 0, ftf: 10.5, plates: plate },
      { index: 7, zone: "deck", z: 10.5, ftf: 10.5, plates: plate },
      { index: 8, zone: "deck", z: 21, ftf: 10.5, plates: plate },
    ] } } },
  };
  const s = base({ source: "wrap", levels: { count: 3 }, cores: [] });
  deepFreeze(project);
  const b = layout(s, { project });
  eq(b.frame.W, 300); eq(b.frame.D, 125);
  eq(JSON.stringify(b.levels.map((l) => [l.z, l.ftf])), "[[0,10.5],[10.5,10.5],[21,10.5]]");
  eq(b.cores.length, 0, "a seed outside the deck is not carried down");
  eq(total(b), 3 * 108);
  const r = rampsFor(s, b).find((x) => x.level === 1);
  near(r.slope, 0.021, 1e-12, "project ftf 10.5 → 5.25 ÷ 250");
  // a podium seed over the deck is carried down as S1 and cuts every level
  const p2 = clone(project);
  p2.sections.massing.derived.levels[0].z = 31.5;
  p2.sections.massing.derived.levels[0].seeds = [{ kind: "stair", outer: [[25, 1], [47, 1], [47, 13], [25, 13]] }];
  const b2 = layout(s, { project: p2 });
  eq(b2.cores.length, 1); eq(b2.cores[0].id, "S1"); eq(b2.cores[0].source, "project");
  eq(total(b2), 3 * 105);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
