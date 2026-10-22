// Run: node test/facade.panels.test.mjs
// Plan section 9.1 tests 11 to 20: panels (11, 12, 13), balconies (14, 15, 16), metrics (17 to 20).
// Test 17 runs every case in src/facade/testcases.js (plan section 8) through buildFacade and
// computeMetrics against the real src/facade/faces.js. Tests 11 to 13 and 16 use hand-made faces.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const P = await import("../src/facade/panels.js");
const B = await import("../src/facade/balconies.js");
const M = await import("../src/facade/metrics.js");
const F = await import("../src/facade/faces.js");
const { PRESETS, defaultState } = await import("../src/facade/presets.js");
const { TEST_CASES } = await import("../src/facade/testcases.js");
const PJ = await import("../src/shared/project.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const same = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
const clone = (o) => JSON.parse(JSON.stringify(o));

const glazed = (panels) => panels.filter((p) => p.glass.length > 0).length;
const area = (panels) => panels.reduce((s, p) => s + p.glass.reduce((q, r) => q + (r.u1 - r.u0) * (r.v1 - r.v0), 0), 0);
const rule = (o) => P.ruleFor({ zones: { rules: { base: o }, overrides: {} }, systems: {} }, "base", "N");
const face = (L, extra = {}) => ({ length: L, a: [0, 0], b: [L, 0], z: 0, ftf: 10, convexStart: true, convexEnd: true, ...extra });

/* ---------------------------------------------------- 11 panelize ---- */

t("11 panelize(300, 14), (65, 14), (10, 14) give 21 / 14.286, 4 / 16.25, 1 / 10", () => {
  // floor(300 / 14) = 21, 300 / 21 = 14.2857; floor(65 / 14) = 4, 65 / 4 = 16.25; floor(10 / 14) = 0 -> 1, 10 / 1 = 10
  const a = P.panelize(300, 14), b = P.panelize(65, 14), c = P.panelize(10, 14);
  eq(a.n, 21); near(a.module, 14.286, 0.001);
  eq(b.n, 4); near(b.module, 16.25);
  eq(c.n, 1); near(c.module, 10);
  eq(P.panelize(180, 5).n, 36, "an exact multiple is not lost to rounding");
  eq(P.panelize(62, 5).n, 12);
  eq(P.panelize(50, 0).n, 1, "a bad module gives one panel");
});

t("11 ruleFor: zone rule, orientation override, system defaults; a system change drops the old keys", () => {
  const st = defaultState();
  st.zones.rules.base = { system: "windowWall", solid: { count: 2, every: 5 }, material: "metal" };
  st.zones.overrides = { base: { S: { system: "storefront" }, E: { solid: { count: 1, every: 2 } } } };
  const w = P.ruleFor(st, "base", "N");
  eq(w.system, "windowWall"); eq(w.module, 5); near(w.slabCover, 4 / 3, 1e-9, "slabCover"); same(w.solid, { count: 2, every: 5 });
  const s = P.ruleFor(st, "base", "S");
  eq(s.system, "storefront"); eq(s.module, 5); eq(s.sill, 1.5); eq(s.head, 10); eq(s.solid, undefined); eq(s.material, "metal");
  same(P.ruleFor(st, "base", "E").solid, { count: 1, every: 2 });
  const p = P.ruleFor(st, "nowhere", "N");
  eq(p.system, "punched"); eq(p.module, 14);
  const frozen = deepFreeze(clone(st));
  P.ruleFor(frozen, "base", "S");   // no mutation
});

/* ------------------------------------------------ 12 solid pattern ---- */

t("12 solid pattern {2, 5} on n = 36 and {1, 2} on n = 18 give 22 and 9 glazed", () => {
  // n = 36: solid when i mod 5 >= 3; 7 full cycles (14 solid) + i = 35 (mod 5 = 0, glazed) -> 22 glazed
  const a = P.facePanels(face(180), rule({ system: "windowWall", solid: { count: 2, every: 5 } }), { ftf: 10 });
  eq(a.length, 36); eq(glazed(a), 22);
  // n = 18: solid when i mod 2 >= 1 -> 9 odd panels solid, 9 glazed
  const b = P.facePanels(face(90), rule({ system: "curtainWall", vision: 4, solid: { count: 1, every: 2 } }), { ftf: 13.5 });
  eq(b.length, 18); eq(glazed(b), 9);
  // 62 ft: n = 12, solid i = 3, 4, 8, 9 -> 8 glazed
  const c = P.facePanels(face(62), rule({ system: "windowWall", solid: { count: 2, every: 5 } }), { ftf: 10 });
  same(c.filter((p) => p.kind === "solid").map((p) => p.i), [3, 4, 8, 9]);
  eq(glazed(c), 8);
});

/* ------------------------------------------------- 13 glass corner ---- */

t("13 glass corner on punched 90 x 90 at 10 ft (n = 6) gives 392 sf per face per floor", () => {
  // n = 90 / 14 -> 6, module 15. 4 windows x 33 = 132; 2 corner panels x 15 x (10 - 1.3333) = 2 x 130 = 260.0; total 392
  const r = rule({ system: "punched" });
  const ps = P.facePanels(face(90), r, { ftf: 10 }, { corners: "glass" });
  eq(ps.length, 6);
  near(area(ps), 392, 0.01);
  same([ps[0].kind, ps[5].kind, ps[1].kind], ["corner", "corner", "window"]);
  near(area(P.facePanels(face(90), r, { ftf: 10 }, { corners: "solid" })), 6 * 33, 1e-9);
  // only a convex end is glass
  const half = P.facePanels(face(90, { convexEnd: false }), r, { ftf: 10 }, { corners: "glass" });
  same([half[0].kind, half[5].kind], ["corner", "window"]);
});

t("13 glass corner overrides a solid pattern; storefront and solid systems keep their own glass", () => {
  const ww = P.facePanels(face(90), rule({ system: "windowWall", solid: { count: 1, every: 3 } }), { ftf: 10 }, { corners: "glass" });
  eq(ww.length, 18); eq(ww[17].kind, "corner"); eq(glazed(ww), 13);
  const sf = P.facePanels(face(90), rule({ system: "storefront" }), { ftf: 10 }, { corners: "glass" });
  eq(sf[0].kind, "glass"); near(sf[0].glass[0].v1 - sf[0].glass[0].v0, 8.5);
  eq(P.facePanels(face(90), rule({ system: "solid" }), { ftf: 10 }, { corners: "glass" }).every((p) => p.kind === "solid"), true);
});

t("panels: system glass heights clamp to the level height", () => {
  const h = (sys, o, ftf) => { const g = P.facePanels(face(60), rule({ system: sys, ...o }), { ftf })[0].glass[0]; return [g.v0, g.v1]; };
  same(h("punched", {}, 10), [2.5, 8]);
  same(h("punched", {}, 6), [2.5, 6]);
  same(h("curtainWall", { vision: 8 }, 13.5), [0, 8]);
  same(h("curtainWall", { vision: 8, sill: 1 }, 7), [1, 7]);
  same(h("storefront", {}, 16), [1.5, 10]);
  same(h("storefront", {}, 8), [1.5, 8]);
  const cw = P.facePanels(face(60), rule({ system: "curtainWall", vision: 8, sill: 1 }), { ftf: 13.5 })[0];
  same(cw.spandrel.map((s) => [s.v0, s.v1]), [[0, 1], [9, 13.5]]);
  const door = P.facePanels(face(60), rule({ system: "punched" }), { ftf: 10 }, { balconies: [1], door: { width: 6, head: 8 } });
  eq(door[1].kind, "door"); near(door[1].glass[0].u1 - door[1].glass[0].u0, 6); eq(door[1].glass[0].v1, 8);
  eq(door[0].kind, "window");
});

/* ------------------------------------------------ 14, 15 balconies ---- */

t("14 alternating spacing 2, n = 17, levels 2 to 5 gives 9, 8, 9, 8", () => {
  // k even: offset 0 -> i = 0, 2, ..., 16 = 9; k odd: offset 1 -> i = 1, 3, ..., 15 = 8
  same([2, 3, 4, 5].map((k) => B.balconyModules("alternating", 17, k, 2).length), [9, 8, 9, 8]);
  same(B.balconyModules("alternating", 5, 3, 2), [1, 3]);
  same(B.balconyModules("stacked", 7, 4, 2), [0, 2, 4, 6]);
  same(B.balconyModules("per-unit", 5, 4, 2), [0, 2, 4], "per-unit without units answers like stacked");
  same(B.balconyModules("stacked", 5, 1, 0), [0, 1, 2, 3, 4], "spacing below 1 is 1");
});

t("15 checker spacing 3, n = 6, levels 1 to 3 gives {1, 4}, {2, 5}, {0, 3}", () => {
  // (i - k) mod 3 = 0
  same([1, 2, 3].map((k) => B.balconyModules("checker", 6, k, 3)), [[1, 4], [2, 5], [0, 3]]);
});

/* ---------------------------------------------------- 16 per unit ---- */

t("16 per-unit: four 28 ft units on a 120 ft face give 4 balconies, one per unit", () => {
  // n = floor(120 / 14) = 8, module 15. Units at x 4..32, 32..60, 60..88, 88..116: facade-edge centres 18, 46, 74, 102
  // -> modules floor(18 / 15) = 1, floor(46 / 15) = 3, floor(74 / 15) = 4, floor(102 / 15) = 6
  const f = { id: "F1", a: [0, 0], b: [120, 0], length: 120, n: 8, module: 15, z: 0, ftf: 10 };
  const units = [0, 1, 2, 3].map((j) => ({ id: `u${j}`, outer: [[4 + 28 * j, 0], [32 + 28 * j, 0], [32 + 28 * j, 40], [4 + 28 * j, 40]] }));
  same(B.unitBalconies(f, { units }, 15), [1, 3, 4, 6]);
  // two units in one module: the second moves to the nearest free module
  const crowd = [{ outer: [[0, 0], [10, 0], [10, 30], [0, 30]] }, { outer: [[10, 0], [20, 0], [20, 30], [10, 30]] }];
  eq(B.unitBalconies(f, { units: crowd }, 15).length, 2);
  // a corner unit with a longer edge on the east face belongs to that face
  const east = { id: "F2", a: [120, 0], b: [120, 60], length: 60, n: 4, module: 15, z: 0, ftf: 10 };
  const corner = [{ outer: [[100, 0], [120, 0], [120, 50], [100, 50]] }];
  same(B.unitBalconies(f, { units: corner }, 15, [f, east]), []);
  same(B.unitBalconies(east, { units: corner }, 15, [f, east]), [1]);
  same(B.unitBalconies(f, { units: corner }, 15), [7], "without allFaces the unit counts on every face it touches");
  same(B.unitBalconies(f, { units: [] }, 15), []);
});

t("16 per-unit through buildFacade: units from the project, and the fallback warning without them", () => {
  const st = defaultState();
  Object.assign(st.balconies, { pattern: "per-unit", type: "projected" });
  st.standalone.width = 120; st.standalone.depth = 40; st.standalone.floors = 3;
  st.source = "project";
  let doc = PJ.newProject({ name: "t" });
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const ident = { x: 0, y: 0, rotation: 0, baseZ: 0 };
  const plate = [{ outer: rect(-60, -20, 60, 20), holes: [] }];
  const levels = [1, 2, 3].map((i) => ({ index: i, name: `L${i}`, zone: "bar", z: (i - 1) * 10, ftf: 10, program: "residential", plates: plate, core: null, spines: [] }));
  doc = PJ.writeSection(doc, "massing", { tool: "midrise", schema: 1, placement: ident, state: {}, derived: { footprint: plate, height: 30, levels, context: { blocks: [] }, metrics: {} } });
  // level 2 holds three 40 ft units on the south face (y -20); the middle level's plate repeats on 3 by identity
  const units = [0, 1, 2].map((j) => ({ id: `2-${j}`, type: "1BR", outer: rect(-60 + 40 * j, -20, -20 + 40 * j, 0), area: 800, exposures: ["S"], corner: false, bay: { from: 0, to: 40 } }));
  doc = PJ.writeSection(doc, "plates", { tool: "plate", schema: 1, placement: ident, state: {}, derived: { mode: "multifamily", levels: [{ index: 2, plate, corridor: [], core: { outer: [], stairs: [], elevators: [] }, units, metrics: {} }], mix: [], metrics: {} } });
  const built = P.buildFacade(st, { project: doc });
  eq(built.source, "project");
  const mid = built.balconies.filter((b) => b.levelIndex === 2 && b.orientation === "S");
  eq(mid.length, 3, "one per unit on level 2");
  eq(built.warnings.some((w) => w.code === "per-unit-fallback"), false, "the middle zone is level 2 only");
  const none = P.buildFacade(st, { project: PJ.writeSection(doc, "plates", { tool: "plate", schema: 1, placement: ident, state: {}, derived: { mode: "multifamily", levels: [], mix: [], metrics: {} } }) });
  eq(none.warnings.some((w) => w.code === "per-unit-fallback"), true);
  ok(none.balconies.length > 0, "stacked balconies stand in");
  same(M.checks(st, M.computeMetrics(st, none, null)).filter((w) => w.code === "per-unit-fallback").length, 1);
});

/* ------------------------------------------------------ 17 presets ---- */

for (const c of TEST_CASES) {
  t(`17 metrics: ${c.id}`, () => {
    const st0 = clone(c.state);
    // Plan 8.7 puts balconies on every orientation; src/facade/presets.js leaves the default N and S. Set all four here.
    const state = deepFreeze(st0);
    const built = P.buildFacade(state, { project: c.project || null });
    const m = M.computeMetrics(state, built, c.project || null);
    const e = c.expect, tol = e.tolerance === undefined ? 0.001 : e.tolerance;
    near(m.wwr, e.wwr, tol, "wwr");
    if (e.wwrByOrientation) for (const [o, v] of Object.entries(e.wwrByOrientation)) near(m.wwrByOrientation[o], v, tol, `wwr ${o}`);
    if (e.transparency !== undefined) near(m.transparency, e.transparency, tol, "transparency");
    if (e.balconies) { eq(m.balconyCount, e.balconies.count, "balconies"); near(m.balconyArea, e.balconies.area, 0.1, "balcony area"); }
    // areas: the plan arithmetic uses 26 / 3 = 8.66667 for the window wall glass; the default slabCover 1.3333 gives 8.6667
    if (e.wall !== undefined) near(m.wall, e.wall, 0.1, "wall");
    if (e.glazing !== undefined) near(m.glazing, e.glazing, (e.areaTolerance || 0.1) + 0.05, "glazing");   // + 0.05: areas round to 0.1 sf
  });
}

t("17 metrics: worst orientation, zone and system tables, limit check (default preset)", () => {
  const st = defaultState(), built = P.buildFacade(st), m = M.computeMetrics(st, built, null);
  same(m.worst, { orientation: "N", wwr: 0.2538 });   // 3,960 / 15,600 = 0.25385; N and S tie, N first
  eq(m.levels, 5);
  near(m.wwrByZone.middle, (2 * 3 * 21 * 33 + 2 * 33 * 15 + 2 * 3 * 4 * 33) / (2 * 3 * 300 * 10 + 2 * 3 * 65 * 10), 1e-3);
  eq(m.wwrBySystem.punched, m.wwr);
  eq(m.wwrLimit, 0.4);
  same(M.checks(st, m), []);
  const hot = TEST_CASES.find((c) => c.id === "hotel-window-wall").state;
  const hb = P.buildFacade(hot), hm = M.computeMetrics(hot, hb, null);
  const codes = M.checks(hot, hm).map((w) => w.code);
  eq(codes[0], "wwr-limit");
  eq(codes.filter((c) => c === "wwr-orientation").length, 4);
  ok(!M.checks(hot, hm).some((w) => /compliant/i.test(w.message) && !/not/i.test(w.message)), "never says compliant");
  const retail = TEST_CASES.find((c) => c.id === "podium-retail-storefront").state;
  const lowT = clone(retail); lowT.checks.transparencyTarget = 1.5;
  const rm = M.computeMetrics(lowT, P.buildFacade(lowT), null);
  eq(M.checks(lowT, rm).some((w) => w.code === "transparency"), true);
  eq(M.checks(retail, M.computeMetrics(retail, P.buildFacade(retail), null)).some((w) => w.code === "transparency"), false);
});

t("17 buildFacade: face shape, ids, zones, no input mutation, determinism", () => {
  const st = deepFreeze(defaultState());
  const a = P.buildFacade(st), b = P.buildFacade(st);
  same(a.faces.map((f) => f.glazing), b.faces.map((f) => f.glazing));
  eq(a.faces.length, 20);   // 4 groups x ... base 4 + middle 4 x 3 + top 4 = 20 faces
  const f = a.faces[0];
  eq(f.id, `${f.groupId}@${f.levelIndex}`);
  for (const k of ["z", "ftf", "a", "b", "length", "orientation", "bearing", "zone", "street", "rule", "n", "module", "panels", "glazing", "wall"]) ok(f[k] !== undefined, k);
  eq(a.balconies.length, 66);
  eq(a.balconies[0].type, "inset");
  eq(a.street.ids.length, 1);
  eq(a.faces.filter((x) => x.street).length, 1, "the S base face only");
  eq(P.buildFacade(st, { quality: "draft" }).faces.length, 20);
});

t("17 buildFacade: each level takes its own edge from group.edges (a tapered group)", () => {
  const st = defaultState();
  st.balconies.on = false;
  const fake = {
    ...F,
    massingLevels: () => ({ levels: [{ index: 1, zone: "main", z: 0, ftf: 10, plates: [] }, { index: 2, zone: "main", z: 10, ftf: 10, plates: [] }], rotation: 0, source: "standalone", notes: [], noteIds: [] }),
    zoneOf: () => ({ 1: "base", 2: "base" }),
    faceGroups: () => [{ id: "F1", levelFrom: 1, levelTo: 2, levels: [1, 2], a: [0, 0], b: [100, 0], length: 100, bearing: 180, orientation: "S", zone: "base", ring: 0, convexStart: true, convexEnd: true, height: 20,
      edges: [{ levelIndex: 1, a: [0, 0], b: [100, 0], length: 100, bearing: 180, convexStart: true, convexEnd: true }, { levelIndex: 2, a: [0.5, 0], b: [90, 0], length: 89.5, bearing: 180, convexStart: true, convexEnd: true }] }],
    streetFaces: () => ({ ids: ["F1"], source: "auto" }),
  };
  const built = P.buildFacade(st, { faces: fake });
  same(built.faces.map((f) => f.length), [100, 89.5]);
  same(built.faces.map((f) => f.wall), [1000, 895]);
  eq(built.faces[0].n, 7); eq(built.faces[1].n, 6);
});

t("17 buildFacade: fins, shades, and bands", () => {
  const st = clone(TEST_CASES.find((c) => c.id === "tower-glass-corner-fins").state);
  st.bands = [{ zone: "base", material: "precast" }, { every: 3, material: "metal" }];
  const b = P.buildFacade(st);
  // fins on E and W of the middle and top zones only: 46 levels... levels 3 to 47 = 45 floors, 2 faces, lines 1..17 = 17 fins
  eq(b.fins.length, 45 * 2 * 17);
  ok(b.fins.every((f) => f.orientation === "E" || f.orientation === "W"));
  eq(b.fins[0].depth, 1.5);
  eq(P.buildFacade(st, { quality: "draft" }).fins.length, 0);
  eq(b.faces.find((f) => f.zone === "base").band, "precast");
  eq(b.faces.find((f) => f.zone === "middle" && f.levelIndex === 6).band, "metal");
  eq(b.faces.find((f) => f.zone === "middle" && f.levelIndex === 4).band, null);
  eq(b.shades.length, 0);
  // fins sit outside the face: the plan ring is counter-clockwise and reaches 1.5 ft out
  const ring = b.fins[0].plan;
  let s = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; s += p[0] * q[1] - q[0] * p[1]; }
  ok(s > 0, "counter-clockwise");
});

/* ----------------------------------------------------- 18 exposure ---- */

t("18 exposure: samples (az 180, alt 0) and (az 135, alt 60) on a square give S 1.00, E 0.261, N 0, W 0", () => {
  // S bearing 180: s1 = cos0 x cos0 = 1; s2 = cos60 x cos(135 - 180) = 0.5 x 0.7071 = 0.3536; sum 1.3536
  // E bearing 90: s1 = cos(90) -> 0; s2 = 0.5 x cos(45) = 0.3536; 0.3536 / 1.3536 = 0.2612
  // N bearing 0 and W bearing 270: cos(135) < 0 and cos(-135) < 0 for s2, cos(180) < 0 and cos(-90) = 0 for s1 -> 0
  const groups = [["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([o, b]) => ({ orientation: o, bearing: b, length: 100 }));
  const sun = { samples: [{ azimuth: 180, altitude: 0 }, { azimuth: 135, altitude: 60 }] };
  same(M.exposure(groups, sun), { N: 0, E: 0.261, S: 1, W: 0 });
  eq(M.exposure(groups, null), null);
  eq(M.exposure(groups, { samples: [] }), null);
  eq(M.exposure(groups, { samples: [{ azimuth: 180, altitude: -5 }] }), null, "a sun below the horizon is skipped");
  // length weighting: two S groups, the longer one dominates the mean
  const g2 = [{ orientation: "S", bearing: 180, length: 100 }, { orientation: "S", bearing: 225, length: 300 }, { orientation: "N", bearing: 0, length: 10 }];
  const e = M.exposure(g2, { samples: [{ azimuth: 180, altitude: 0 }] });
  near(e.S, 1);
  eq(e.N, 0);
});

t("18 exposure through computeMetrics: reads sections.sun.derived.samples", () => {
  const st = defaultState(), built = P.buildFacade(st);
  eq(M.computeMetrics(st, built, null).exposure, null);
  let doc = PJ.newProject({ name: "t" });
  doc = PJ.writeSection(doc, "sun", { tool: "tower", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { samples: [{ date: "2026-06-21", time: "12:00", azimuth: 180, altitude: 60 }], sunHours: null } });
  const ex = M.computeMetrics(st, built, doc).exposure;
  eq(ex.S, 1); eq(ex.N, 0);
});

/* ----------------------------------------------- 19 street faces ---- */

t("19 street faces with a site: a road 40 ft south of the south face is a street, 100 ft away is not", () => {
  // 300 x 65 rect centered on the origin: the south face is at y = -32.5. Road at y = -72.5 (40 ft) or -132.5 (100 ft). roadDistance 60.
  const mk = (y) => {
    let doc = PJ.newProject({ name: "t" });
    const ident = { x: 0, y: 0, rotation: 0, baseZ: 0 };
    doc = PJ.writeSection(doc, "site", { tool: "site", schema: 1, placement: ident, state: {}, derived: { roads: { segments: [{ id: "r1", cls: "primary", name: "A St", width: 36, line: [[-300, y, 0], [300, y, 0]] }], pavement: [] } } });
    return PJ.writeSection(doc, "massing", { tool: "midrise", schema: 1, placement: ident, state: {}, derived: { levels: [], metrics: {} } });
  };
  const st = defaultState();
  const run = (doc) => {
    const mass = F.massingLevels(st, null);
    const groups = F.faceGroups(st, mass.levels, 0);
    const s = F.streetFaces(st, groups, mass.levels, doc);
    return { s, groups, built: P.buildFacade(st, { project: doc }) };
  };
  const near40 = run(mk(-72.5)), far100 = run(mk(-132.5));
  eq(near40.s.source, "auto-site");
  same(near40.s.ids.map((id) => near40.groups.find((g) => g.id === id).orientation), ["S"]);
  same(far100.s.ids, []);
  eq(near40.built.faces.some((f) => f.street && f.orientation === "S"), true);
  eq(far100.built.faces.some((f) => f.street), false);
  eq(M.computeMetrics(st, far100.built, null).transparency, null, "no street faces, no transparency");
  // the road on the north side does not make the south face a street (the normal points away)
  same(run(mk(72.5)).s.ids.map((id) => near40.groups.find((g) => g.id === id).orientation), ["N"]);
});

t("19 street faces: manual ids and the no-site default", () => {
  const st = defaultState();
  eq(P.buildFacade(st).street.source, "auto");
  st.street = { mode: "manual", manual: ["F2"], roadDistance: 60 };
  const b = P.buildFacade(st);
  same(b.street.ids, ["F2"]);
  eq(b.faces.filter((f) => f.street).every((f) => f.groupId === "F2"), true);
});

/* ------------------------------------------------------ 20 shades ---- */

t("20 shade depth 2, above 0.5, punched 2.5 to 8 gives PF 0.333", () => {
  // PF = 2 / (8 - 2.5 + 0.5) = 2 / 6 = 0.3333
  const st = defaultState();
  st.balconies.on = false;
  st.shades = { on: true, depth: 2, above: 0.5, orientations: ["S"], zones: ["middle", "top"] };
  const built = P.buildFacade(st), m = M.computeMetrics(st, built, null);
  eq(m.projectionFactors.length, 2, "middle and top zones");
  ok(m.projectionFactors.every((r) => r.pf === 0.333 && r.orientation === "S" && r.system === "punched"));
  eq(built.shades.length, 4 * 21, "S windows on levels 2 to 5");
  eq(built.shades[0].pf, 0.3333);
  near(built.shades[0].z, 12 + 8 + 0.5, 1e-9);
  // curtain wall: 2 / (8 + 0.5) = 0.235
  const cw = TEST_CASES.find((c) => c.id === "office-curtain-wall").state;
  cw.shades = { on: true, depth: 2, above: 0.5, orientations: ["S"], zones: ["middle"] };
  eq(M.computeMetrics(cw, P.buildFacade(cw), null).projectionFactors[0].pf, 0.235);
});

/* ------------------------------------------------------ envelope ---- */

t("envelope note: lines per zone against the limits; empty when off", () => {
  const st = defaultState();
  eq(M.envelopeNote(st, P.buildFacade(st)).length, 0);
  st.envelope.on = true;
  st.zones.rules.top = { system: "punched", glazing: "laminated" };
  const lines = M.envelopeNote(st, P.buildFacade(st));
  eq(lines.length, 4);
  ok(lines[0].startsWith("Caution"));
  ok(lines[1].startsWith("Base: glazing IGU with low-e, U 0.29 (at or below the 0.45 limit value), SHGC 0.25 (at or below the 0.25 limit value)"), lines[1]);
  ok(lines[1].includes("Wall EIFS over CMU, U 0.09"), lines[1]);
  ok(lines[3].includes("Laminated single pane, U 1 (above the 0.45 limit value), SHGC 0.7 (above the 0.25 limit value)"), lines[3]);
});

/* ------------------------------------------------- build warnings ---- */

t("warnings: a tower project with no levels, and a project without a massing", () => {
  const st = defaultState(); st.source = "project";
  let doc = PJ.newProject({ name: "t" });
  doc = PJ.writeSection(doc, "massing", { tool: "tower", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { footprint: [], height: 0, levels: [], metrics: {} } });
  const b = P.buildFacade(st, { project: doc });
  eq(b.warnings[0].code, "tower-no-levels");
  const m = M.computeMetrics(st, b, doc);
  eq(M.checks(st, m).some((w) => w.code === "tower-no-levels"), true);
  eq(P.buildFacade(st, { project: PJ.newProject({ name: "t" }) }).warnings[0].code, "no-project-massing");
  const empty = defaultState(); empty.standalone.floors = 0;
  const e = P.buildFacade(empty);
  eq(e.faces.length, 0); eq(e.warnings[0].code, "no-levels");
  eq(M.computeMetrics(empty, e, null).wwr, 0);
});

t("project source: placement rotation turns the sectors", () => {
  const st = defaultState(); st.source = "project"; st.balconies.on = false;
  let doc = PJ.newProject({ name: "t" });
  const plate = [{ outer: [[-150, -32.5], [150, -32.5], [150, 32.5], [-150, 32.5]], holes: [] }];
  doc = PJ.writeSection(doc, "massing", { tool: "midrise", schema: 1, placement: { x: 0, y: 0, rotation: 90, baseZ: 0 }, state: {}, derived: { levels: [{ index: 1, name: "1", zone: "bar", z: 0, ftf: 10, program: "residential", plates: plate, core: null, spines: [] }], metrics: {} } });
  const b = P.buildFacade(st, { project: doc });
  eq(b.rotation, 90);
  // the 300 ft long faces (local S and N) turn to project E and W
  same(b.faces.filter((f) => f.length === 300).map((f) => f.orientation).sort(), ["E", "W"]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
