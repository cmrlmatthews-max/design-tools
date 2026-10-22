// Run: node test/grading.surface.test.mjs
// Plan: docs/grading-sketch-technical-plan.md, section 9.1 tests 1 to 14, plus contract checks
// (pad-step walls of presets 8.3 and 8.5, project footprints, no input mutation).
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const S = await import("../src/grading/surface.js");
const F = await import("../src/grading/features.js");
const W = await import("../src/grading/walls.js");
const { planeGround, gridFromSite, gridForPlane, existingSurface, makeSurface, padFeature } = S;
const { footprints, tierPads, driveFeature, lotFeature, balanceTier, suggestTiers, buildGrading } = F;
const { padStepWalls, autoWalls, wallStats, blocks } = W;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.001, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ± ${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
function deepFreeze(o) {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------ fixtures (section 8) */

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const balanceTiers = (n) => Array.from({ length: n }, () => ({ length: null, ffe: "balance" }));
const B = (id, outer, over = {}) => ({ id, name: id, source: "typed", outer, axis: "auto", tiers: balanceTiers(1), padOffset: 5, padDepth: 1, ...over });
const base = (over = {}) => ({
  schema: 1, name: "Test", source: "standalone",
  ground: { mode: "plane", plane: { z0: 1000, slope: 5, downhill: 180 }, margin: 200 },
  property: { mode: "site", ring: [] }, buildings: [], balance: "pad", maxStep: 4,
  drives: [], lots: [], walls: [], autoWalls: { on: true, offset: 5, accepted: [] }, routes: [],
  daylight: { on: true, fill: 3, cut: 2 },
  limits: { walk: 0.05, ramp: 0.0833, cross: 0.0208, rampRise: 2.5, wallFlag: 4, lotMin: 0.01, lotMax: 0.05, driveMax: 0.10 },
  earthwork: { subdivide: 4, bulking: 1 }, ...over,
});
const plane = (slope, downhill) => ({ mode: "plane", plane: { z0: 1000, slope, downhill }, margin: 200 });
const BAR = rect(-150, -32.5, 150, 32.5);                                       // 300 × 65
const P81 = base({ buildings: [B("B1", BAR, { padOffset: 0 })] });
const P81wall = base({ buildings: [B("B1", BAR, { padOffset: 0 })], walls: [{ id: "W1", line: [[-150, -32.5], [150, -32.5]], kind: "drawn" }] });
const P82 = base({ ground: plane(4, 270), daylight: { on: false, fill: 3, cut: 2 }, buildings: [B("B1", BAR, { padOffset: 0 })] });
const P83 = base({ ground: plane(4, 270), daylight: { on: false, fill: 3, cut: 2 }, buildings: [B("B1", BAR, { padOffset: 0, tiers: balanceTiers(3) })] });
const P84 = base({
  ground: plane(6, 180),
  buildings: [-120, 0, 120].map((yc, i) => B(`B${i + 1}`, rect(-96, yc - 33, 96, yc + 33))),
  walls: [-120, 0, 120].map((yc, i) => ({ id: `W${i + 1}`, line: [[-101, yc - 38], [101, yc - 38]], kind: "drawn" })),
  lots: [{ id: "L1", ring: rect(130, -150, 290, 150), anchor: null, start: "existing", dir: 0, slope: 2, cross: 1 }],
});
const P85 = base({ buildings: [B("B1", rect(-150, -62.5, 150, 62.5), { name: "Deck", tiers: [{ length: null, ffe: 997.875 }] }), B("B2", rect(-225, -137.5, 225, 137.5), { name: "Wrap" })] });
const P86 = base({ ground: plane(8, 180), buildings: [B("B1", rect(-150, -100, 150, 100), { tiers: [{ length: null, ffe: 992.6 }] })], walls: [{ id: "W1", line: [[-155, 105], [155, 105]], kind: "drawn" }] });

const wallById = (built, id) => built.walls.find((w) => w.id === id);

console.log("grading surface, features, walls");

/* ------------------------------------------------------------ surface */

// 1. z = z0 − (s/100)(x sin b + y cos b). Slope 5, downhill 180: z0 + 0.05 y → (0, 10) = 1,000.5.
//    Slope 4, downhill 270: sin 270 = −1, cos 270 = 0 → z0 + 0.04 x → (10, 0) = 1,000.4.
t("1 planeGround", () => {
  near(planeGround({ z0: 1000, slope: 5, downhill: 180 })(0, 10), 1000.5, 1e-9);
  near(planeGround({ z0: 1000, slope: 4, downhill: 270 })(10, 0), 1000.4, 1e-9);
  near(planeGround({ z0: 1000, slope: 5, downhill: 180 })(123, 0), 1000, 1e-9, "no east-west tilt from sin 180");
});

// 2. Box x ±150, y ±32.5 plus 200 → 700 × 465; S = 700; gridSpacing(700): max(10, ceil(14.14)/2 = 7.5) = 10,
//    n = floor(700/10) + 1 = 71; origin floor((0 − 350)/10) × 10 = −350 on both axes.
t("2 gridForPlane preset 8.1: spacing 10, n 71, origin (−350, −350)", () => {
  const g = gridForPlane(P81, [-150, -32.5, 150, 32.5]);
  eq(g.spacing, 10); eq(g.n, 71); eq(g.x0, -350); eq(g.y0, -350);
  eq(g.nodes.length, 71 * 71 * 3);
  near(g.nodes[0], -350); near(g.nodes[1], -350); near(g.nodes[2], 1000 - 0.05 * 350, 1e-9);   // (−350, −350) → 982.5
  const g2 = gridForPlane(P81, null);                                                          // the state's own extent
  eq(g2.n, 71); eq(g2.x0, -350);
  const e = existingSurface(P81, null);
  eq(e.source, "plane"); eq(e.grid.n, 71); near(e.at(0, 10), 1000.5, 1e-9);
});

// 3. 3 × 3 site grid at spacing 10 from (100, 200). Center of the SW cell (105, 205) = mean of its 4 corners;
//    (102.5, 207.5): bilinear tx 0.25, ty 0.75. Outside the grid clamps to the edge.
t("3 gridFromSite bilinear", () => {
  const z = [1, 2, 4, 3, 5, 9, 7, 8, 6];
  const points = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) points.push([100 + 10 * i, 200 + 10 * j, z[j * 3 + i]]);
  const g = gridFromSite({ spacing: 10, n: 3, points });
  eq(g.x0, 100); eq(g.y0, 200);
  near(g.at(105, 205), (1 + 2 + 3 + 5) / 4, 1e-12);
  // (1 − .25)(1 − .75)·1 + .25(1 − .75)·2 + (1 − .25)(.75)·3 + .25(.75)·5 = 0.1875 + 0.125 + 1.6875 + 0.9375 = 2.9375
  near(g.at(102.5, 207.5), 2.9375, 1e-12);
  near(g.at(50, 150), 1, 1e-12, "clamped SW"); near(g.at(500, 500), 6, 1e-12, "clamped NE");
  const site = { sections: { site: { tool: "site", derived: { ground: { spacing: 10, n: 3, points } } } } };
  const e = existingSurface({ ground: { mode: "site" } }, site);
  eq(e.source, "site"); near(e.at(105, 205), 2.75, 1e-12);
  const e2 = existingSurface({ ground: { mode: "site", plane: { z0: 1000, slope: 0 } } }, null);
  eq(e2.source, "plane"); ok(e2.notes.length === 1, "note when no site ground");
});

// 4. Preset 8.1, pad top 1,000 on y −32.5 to 32.5, plane 1,000 + 0.05 y.
//    (0, −35): existing 998.25; fill limit 1,000 − 2.5/3 = 999.1667 → 999.167.
//    (0, −40): existing 998.00; limit 1,000 − 7.5/3 = 997.5 < 998 → existing (toe at 1.625/0.2833 = 5.735 ft).
//    (0, 35): existing 1,001.75; cut limit 1,000 + 2.5/2 = 1,001.25.
t("4 preset 8.1 daylight points", () => {
  const b = buildGrading(P81);
  eq(b.tiers[0].padTop, 1000);
  near(b.surface.at(0, -35), 999.167, 0.001);
  near(b.surface.at(0, -40), 998.00, 0.001);
  near(b.surface.at(0, 35), 1001.25, 0.001);
  near(b.surface.at(0, 0), 1000, 1e-12, "on the pad");
});

// 5. Flat 1,000; pads 1,000 (x ≤ −10) and 1,006 (x ≥ 10). At (0, 0) d = 10 to each.
//    A: lo 996.667, hi 1,005. B: lo 1,006 − 10/3 = 1,002.667, hi 1,011. lo = 1,002.667 ≤ hi = 1,005 → 1,002.667.
t("5 two pads 20 ft apart: the higher pad's fill limit wins", () => {
  const A = padFeature({ id: "A", pads: [rect(-100, -50, -10, 50)], padTop: 1000 });
  const Bp = padFeature({ id: "B", pads: [rect(10, -50, 100, 50)], padTop: 1006 });
  const s = makeSurface([A, Bp], [], () => 1000, { on: true, fill: 3, cut: 2 }, { probe: [[0, 0], [-5, 0], [5, 0]] });
  near(s.at(0, 0), 1002.667, 0.001);
  eq(s.conflicts.length, 0);
});

// 6. Pads 1,000 (x ≤ −5) and 1,010 (x ≥ 5). At (0, 0) d = 5: A hi 1,002.5; B lo 1,010 − 5/3 = 1,008.333.
//    lo > hi → midpoint (1,008.333 + 1,002.5)/2 = 1,005.417 and one slope-conflict for the pair.
t("6 two pads 10 ft apart: midpoint and one slope-conflict", () => {
  const A = padFeature({ id: "A", pads: [rect(-100, -50, -5, 50)], padTop: 1000 });
  const Bp = padFeature({ id: "B", pads: [rect(5, -50, 100, 50)], padTop: 1010 });
  const probe = [];
  for (let x = -4; x <= 4; x++) for (let y = -40; y <= 40; y += 10) probe.push([x, y]);
  const s = makeSurface([A, Bp], [], () => 1000, { on: true, fill: 3, cut: 2 }, { probe });
  near(s.at(0, 0), 1005.417, 0.001);
  eq(s.conflicts.length, 1);
  eq(s.conflicts[0].a, "B"); eq(s.conflicts[0].b, "A");     // B sets the fill limit, A the cut limit
  near(s.conflicts[0].x, 0, 1e-9);
  // Through buildGrading: one slope-conflict warning.
  const st = base({ ground: plane(0, 180), autoWalls: { on: false, offset: 5, accepted: [] },
    buildings: [B("A", rect(-100, -50, -5, 50), { padOffset: 0, tiers: [{ ffe: 1001 }] }), B("C", rect(5, -50, 100, 50), { padOffset: 0, tiers: [{ ffe: 1011 }] })] });
  const b = buildGrading(st);
  eq(b.warnings.filter((w) => w.code === "slope-conflict").length, 1);
});

/* ------------------------------------------------------------ walls */

// 7. A wall on the south pad edge: p = (0, −35), q = (0, −32.5), extended to (0, −32.49), crosses the wall
//    properly → the pad is blocked → existing 1,000 − 0.05 × 35 = 998.25.
t("7 preset 8.1-wall: (0, −35) keeps the existing ground", () => {
  const b = buildGrading(P81wall);
  near(b.surface.at(0, -35), 998.25, 1e-9);
  near(b.surface.at(0, 35), 1001.25, 0.001, "north side still daylights");
  ok(blocks(P81wall.walls, [0, -35], [0, -32.5]), "blocked");
  ok(!blocks(P81wall.walls, [-152, -35], [-150, -32.5]), "touching the wall end does not block");
  ok(!blocks(P81wall.walls, [0, 35], [0, 32.5]), "the far side is not blocked");
});

// 8. 8.1-wall: pad 1,000, existing just south 998.375 → 1.625 (0.01 probe: 1.6255 → 1.63).
//    8.6: pad top 991.60, existing at y = 105 is 1,000 + 0.08 × 105 = 1,008.40 → 16.80.
//    8.4: each pad top is the mean under its pad; wall 38 ft south of the bar center: 0.06 × 38 = 2.28.
t("8 wall heights 1.625, 16.80, 2.28", () => {
  const w1 = wallById(buildGrading(P81wall), "W1");
  near(w1.heightMax, 1.625, 0.01); near(w1.heightAvg, 1.625, 0.01); near(w1.length, 300, 1e-9);
  const w6 = wallById(buildGrading(P86), "W1");
  near(w6.heightMax, 16.80, 0.01); near(w6.heightAvg, 16.80, 0.01);
  near(w6.top[0][2], 1008.40, 0.01, "top = the high side");
  const b4 = buildGrading(P84);
  for (const id of ["W1", "W2", "W3"]) { near(wallById(b4, id).heightMax, 2.28, 0.01, id); near(wallById(b4, id).heightAvg, 2.28, 0.01, id); }
});

// 9. Property x ±200, y ±36. South: at y = −36, d = 3.5, fill limit 998.833 vs existing 998.2 → flagged.
//    North: cut limit 1,000 + 3.5/2 = 1,001.75 vs existing 1,001.80 → 0.05 → flagged (the toe at 3.61 ft
//    just passes the line). Inset lines y = ±31 fall inside the pad → the walls sit on the pad edges ±32.5.
//    Height at x = 0: 1,000 against existing 998.375 (south) and 1,001.625 (north) = 1.625.
t("9 auto walls at a drawn property line", () => {
  const st = base({ buildings: [B("B1", BAR, { padOffset: 0 })], property: { mode: "drawn", ring: rect(-200, -36, 200, 36) } });
  const b = buildGrading(st);
  const autos = b.walls.filter((w) => w.kind === "auto");
  eq(autos.length, 2);
  const south = autos.find((w) => w.line.some((p) => p[1] < 0)), north = autos.find((w) => w.line.some((p) => p[1] > 0));
  ok(south && north && south !== north, "one wall on each side");
  for (const [w, y] of [[south, -32.5], [north, 32.5]]) {
    ok(w.line.some((p) => Math.abs(p[1] - y) < 1e-9), `wall on the pad edge y = ${y}`);
    ok(w.line.every((p) => Math.abs(p[1]) <= 32.5 + 1e-9), "never outside the pad edge band");
    const h = Math.abs(b.surface.at(0, y + 0.01) - b.surface.at(0, y - 0.01));
    near(h, 1.625, 0.01, "height at x = 0");
    eq(w.auto, true); eq(w.accepted, false);
  }
  eq(autos.map((w) => w.id).sort().join(","), "A1,A2");
  near(b.surface.at(0, -35), 998.25, 1e-9, "the auto wall now blocks the south daylight");
  const acc = buildGrading({ ...st, autoWalls: { on: true, offset: 5, accepted: ["A1"] } });
  eq(acc.walls.find((w) => w.id === "A1").accepted, true);
  eq(buildGrading({ ...st, autoWalls: { on: false, offset: 5, accepted: [] } }).walls.length, 0);
});

/* ------------------------------------------------------------ features */

// 10. Preset 8.3: axis 0 (east–west), s0 = −150, s1 = 150, equal tiers of 100 ft: cuts at x = −50 and 50.
t("10 tier strips of preset 8.3", () => {
  const [fp] = footprints(P83, null);
  eq(fp.axis, 0);
  const ex = planeGround(P83.ground.plane);
  const tiers = tierPads({ ...P83.buildings[0], ...fp }, ex);
  eq(tiers.length, 3);
  const xs = tiers.map((tr) => [Math.min(...tr.pad.map((p) => p[0])), Math.max(...tr.pad.map((p) => p[0]))]);
  eq(JSON.stringify(xs), JSON.stringify([[-150, -50], [-50, 50], [50, 150]]));
  for (const tr of tiers) { near(tr.padArea, 100 * 65, 1e-6); eq(tr.pads.length, 1); }
  eq(xs[0][1], xs[1][0]); eq(xs[1][1], xs[2][0]);                       // shared cut lines
  // No overlap: the pad areas add up to the whole bar.
  near(tiers.reduce((s, tr) => s + tr.padArea, 0), 300 * 65, 1e-6);
  eq(tiers.map((tr) => tr.id).join(","), "B1-T1,B1-T2,B1-T3");
  // Plane 1,000 + 0.04 x: tier means −100, 0, 100 → 996, 1,000, 1,004.
  eq(tiers.map((tr) => tr.padTop).join(","), "996,1000,1004");
  eq(tiers.map((tr) => tr.ffe).join(","), "997,1001,1005");
  eq(tiers[0].existingMin, 994); eq(tiers[0].existingMax, 998);
  // The pad offset reaches past the ends and the sides (5 ft): tier 1 pad x −155 to −50, y ±37.5.
  const off = tierPads({ ...P83.buildings[0], ...fp, padOffset: 5 }, ex);
  near(Math.min(...off[0].pad.map((p) => p[0])), -155, 1e-9); near(Math.max(...off[0].pad.map((p) => p[1])), 37.5, 1e-9);
  near(Math.max(...off[2].pad.map((p) => p[0])), 155, 1e-9);
});

// 11. 8.1: pad samples on y ±31.25 step 2.5 are symmetric → mean 1,000. 8.2: x ±148.75 symmetric → 1,000.
//     g is linear in pad mode; false position lands on the root at the first step (pure bisection on 8.2's
//     13.9 ft bracket would need 11 halvings to get under 0.01 ft).
t("11 balanceTier on 8.1 and 8.2", () => {
  const r1 = balanceTier(BAR, planeGround(P81.ground.plane), 1);
  eq(r1.padTop, 1000); eq(r1.ffe, 1001); ok(r1.iterations <= 10, "iterations " + r1.iterations);
  const r2 = balanceTier(BAR, planeGround(P82.ground.plane), 1);
  eq(r2.padTop, 1000); eq(r2.ffe, 1001); ok(r2.iterations <= 10, "iterations " + r2.iterations);
  // A nonlinear increasing g still converges: g(t) = (t − 1,000.37)³.
  const r3 = balanceTier(BAR, planeGround(P81.ground.plane), 1, (tt) => (tt - 1000.37) ** 3);
  eq(r3.padTop, 1000.37);
  // Balance "site" (8.1-site): pad top 999.97.
  eq(buildGrading({ ...P81, balance: "site" }).tiers[0].padTop, 999.97);
});

// 12. 8.2: existing along the centerline x −150 to 150 on 1,000 + 0.04 x → rise 12.0, ceil(12/4) = 3, 100 ft each.
t("12 suggestTiers on 8.2", () => {
  const s = suggestTiers(P82.buildings[0], planeGround(P82.ground.plane), 4);
  eq(s.count, 3); eq(s.rise, 12); eq(JSON.stringify(s.lengths), "[100,100,100]");
});

// 13. Centerline (0, 0) → (0, 100), travel north, right = east. At s = 50: zc = 1,000 + 0.05 × 50 = 1,002.5.
//     Crowned: 1,002.5 − 0.02 × 10 = 1,002.3 both sides. One-way (falls right): (10, 50) r = +10 → 1,002.3;
//     (−10, 50) r = −10 → 1,002.7.
t("13 drive planes", () => {
  const d = { id: "D1", line: [[0, 0], [0, 100]], width: 24, start: 1000, slope: 5, cross: 2, crown: true };
  const c = driveFeature(d, () => 0);
  near(c.z(10, 50), 1002.3, 1e-9); near(c.z(-10, 50), 1002.3, 1e-9);
  const o = driveFeature({ ...d, crown: false }, () => 0);
  near(o.z(10, 50), 1002.3, 1e-9); near(o.z(-10, 50), 1002.7, 1e-9);
  ok(c.contains(12, 50) && !c.contains(12.1, 50) && !c.contains(0, -0.1) && !c.contains(0, 100.1), "width 24, square ends");
  eq(c.kind, "drive"); near(c.slope, 0.05, 1e-12); near(c.cross, 0.02, 1e-12);
  const q = c.nearest(20, 50); near(q.x, 12, 1e-9); near(q.d, 8, 1e-9);
  eq(driveFeature({ ...d, start: "existing" }, (x, y) => 990 + x + y).start, 990);
  // A bend: inside the outer corner's round joint, outside the miter tip.
  const bend = driveFeature({ id: "D2", line: [[0, 0], [0, 100], [100, 100]], width: 24, start: 1000, slope: 5, cross: 2 }, () => 0);
  ok(bend.contains(-8, 108) && !bend.contains(-11, 111), "round joint");
  near(bend.z(50, 100), 1000 + 0.05 * 150, 1e-9, "station runs on through the bend");
});

// 14. Lot x 130 to 290, y ±150, anchor the centroid (210, 0), za = existing (1,000.00 on the 6 percent plane).
//     dir 0 → u = (0, 1), v = (−1, 0): z = 1,000 + 0.02 y − 0.01 (x − 210).
//     (210, 150): 1,003.0. (130, 0): 1,000 + 0.01 × 80 = 1,000.8.
t("14 lot plane of preset 8.4", () => {
  const l = lotFeature(P84.lots[0], planeGround(P84.ground.plane));
  near(l.z(210, 150), 1003.0, 1e-9); near(l.z(130, 0), 1000.8, 1e-9);
  eq(l.start, 1000); eq(JSON.stringify(l.anchor), "[210,0]");
  near(l.slope, 0.02, 1e-12); near(l.cross, 0.01, 1e-12);
  ok(l.contains(130, -150) && !l.contains(129.9, 0), "boundary included");
});

/* ------------------------------------------------------------ contract checks */

// 8.3: tops 996, 1,000, 1,004 → steps 4 > 0.05 → two pad-step walls on x = −50 and 50, 65 ft, 4.0 ft.
t("pad-step walls of preset 8.3", () => {
  const b = buildGrading(P83);
  const ps = b.walls.filter((w) => w.kind === "pad-step");
  eq(ps.length, 2);
  eq(ps.map((w) => w.line[0][0]).sort((p, q) => p - q).join(","), "-50,50");
  for (const w of ps) { near(w.length, 65, 1e-9); near(w.heightMax, 4.0, 0.01); near(w.heightAvg, 4.0, 0.01); eq(w.accepted, true); }
});

// 8.5: deck pad 310 × 135 at 996.875 inside the wrap pad 460 × 285 at 1,000.00 (symmetric about y = 0):
//      one closed pad-step wall of 2 × (310 + 135) = 890 ft, 3.125 ft high.
t("pad-step wall of preset 8.5", () => {
  const b = buildGrading(P85);
  eq(b.tiers.map((tr) => tr.padTop).join(","), "996.875,1000");
  eq(b.tiers[1].ffe, 1001);
  const ps = b.walls.filter((w) => w.kind === "pad-step");
  eq(ps.length, 1);
  near(ps[0].length, 890, 1e-6); near(ps[0].heightMax, 3.125, 0.01); near(ps[0].heightAvg, 3.125, 0.01);
  near(b.surface.at(0, 0), 996.875, 1e-12, "the deck pad wins inside the wrap");
  near(b.surface.at(0, 100), 1000, 1e-12);
  // Listed wrap first, the deck still moves ahead (a footprint inside another goes first).
  const swapped = buildGrading({ ...P85, buildings: [P85.buildings[1], P85.buildings[0]] });
  eq(swapped.tiers[0].id, "B1-T1");
  // padStepWalls directly, with no step: nothing.
  eq(padStepWalls([{ id: "a", padTop: 1000, pads: [rect(0, 0, 10, 10)] }, { id: "b", padTop: 1000.04, pads: [rect(10, 0, 20, 10)] }]).length, 0);
});

t("wallStats on a bare surface function", () => {
  const s = wallStats({ line: [[0, 0], [10, 0]] }, (x, y) => (y > 0 ? 1005 : 1000));
  eq(s.heightMax, 5); eq(s.heightAvg, 5); eq(s.length, 10);
  eq(JSON.stringify(s.top), "[[0,0,1005],[10,0,1005]]");
});

t("autoWalls with no flagged stretch, and joins across short gaps", () => {
  const surf = { at: () => 1000, existingAt: () => 1000 };
  eq(autoWalls(base(), surf, rect(0, 0, 100, 100), []).length, 0);
  // Flagged on the south edge except a 5 ft gap → one wall (gap < 10 ft), inset 5 ft → y = 5.
  const gap = { at: (x, y) => (y < 1 && !(x > 40 && x < 45) ? 1001 : 1000), existingAt: () => 1000 };
  const w = autoWalls(base(), gap, rect(0, 0, 100, 100), []);
  eq(w.length, 1); eq(w[0].id, "A1");
  ok(w[0].line.every((p) => Math.abs(p[1] - 5) < 1e-9), "inset 5 ft");
});

t("project footprints: massing placement, parking lowest level, tower note", () => {
  const ring = rect(0, 0, 100, 40);
  const project = { sections: {
    massing: { tool: "midrise", placement: { x: 1000, y: 500, rotation: 90, baseZ: 0 }, derived: { footprint: [{ outer: ring, holes: [rect(10, 10, 20, 20)] }] } },
    parking: { tool: "parking", placement: { x: 0, y: 0, rotation: 0, baseZ: 0 },
      derived: { levels: [{ index: 2, z: 10, plate: [{ outer: rect(0, 0, 50, 50), holes: [] }] }, { index: 1, z: 0, plate: [{ outer: rect(0, 0, 60, 30), holes: [] }] }] } },
  } };
  const st = base({ source: "project", buildings: [{ source: "massing" }, { source: "parking" }] });
  const fps = footprints(st, project);
  eq(fps.map((f) => f.id).join(","), "massing,parking");
  // Rotation 90: (x, y) → (−y, x) + (1,000, 500): x 960 to 1,000, y 500 to 600. Long side north–south → axis 90.
  const m = fps[0];
  eq(Math.min(...m.outer.map((p) => p[0])), 960); eq(Math.max(...m.outer.map((p) => p[1])), 600);
  eq(m.axis, 90);
  near(Math.max(...fps[1].outer.map((p) => p[0])), 60, 1e-9, "lowest level plate");
  const b = buildGrading(st, { project });
  eq(b.source, "project"); eq(b.tiers[0].id, "massing-T1"); eq(b.tiers[1].id, "parking-T1");
  const tower = buildGrading(base({ source: "project", buildings: [{ source: "massing" }] }), { project: { sections: { massing: { tool: "tower", derived: {} } } } });
  ok(tower.warnings.some((w) => w.code === "tower-no-levels"), "tower-no-levels");
  ok(tower.notes.includes("The Tower Generator does not write massing levels yet."), "tower note");
  eq(tower.tiers.length, 0);
});

t("outside-site warning", () => {
  const b = buildGrading(base({ buildings: [B("B1", BAR, { padOffset: 0 })], property: { mode: "drawn", ring: rect(-100, -50, 100, 50) }, autoWalls: { on: false } }));
  ok(b.warnings.some((w) => w.code === "outside-site" && w.where.id === "B1-T1"), "pad past the property line");
});

t("inputs are not mutated; same inputs give the same result", () => {
  const st = deepFreeze(clone({ ...P84, balance: "site", property: { mode: "drawn", ring: rect(-150, -200, 300, 200) } }));
  const a = buildGrading(st), b = buildGrading(st);
  eq(JSON.stringify(a.tiers), JSON.stringify(b.tiers));
  eq(JSON.stringify(a.walls), JSON.stringify(b.walls));
  ok(a.surface.at(0, -170) === b.surface.at(0, -170), "deterministic surface");
  const d = buildGrading(st, { quality: "draft" });
  eq(d.subdivide, 1); eq(a.subdivide, 4);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
