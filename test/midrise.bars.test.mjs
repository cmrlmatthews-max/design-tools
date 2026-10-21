// Run: node test/midrise.bars.test.mjs
// Plan section 9.1 tests 1 and 2, plus level, spine and helper checks for src/midrise/bars.js.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const B = await import("../src/midrise/bars.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const same = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const throws = (fn, part) => { try { fn(); } catch (e) { if (part && !e.message.includes(part)) throw new Error(`message "${e.message}" lacks "${part}"`); return; } throw new Error("expected a throw"); };
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }

/* Clipper union of rings, area back in sf (the test's own check; bars.js has no Clipper). */
function unionOf(rings) {
  const C = globalThis.ClipperLib, S = 1000;
  const clip = new C.Clipper();
  for (const r of rings) clip.AddPath(r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })), C.PolyType.ptSubject, true);
  const sol = new C.Paths();
  clip.Execute(C.ClipType.ctUnion, sol, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const area = sol.reduce((s, p) => s + Math.abs(C.Clipper.Area(p)) / (S * S), 0);
  return { area, paths: sol };
}

const baseBar = (over = {}) => ({
  id: "A", name: "Bar A", x: -150, y: 0, angle: 0, length: 300, depth: 65, floors: 5,
  program: "residential", groundProgram: null, corridor: "double", unitSide: "left",
  ends: { start: "stair", end: "stair" }, bends: [], unitWidth: null, ...over,
});
const baseState = (over = {}) => ({
  schema: 1, name: "t", floors: { groundFtf: 12, ftf: 10 },
  podium: { on: false, levels: [{ ftf: 11, program: "parking" }], footprint: { mode: "allowed", percent: 100, offset: 0 }, liner: { on: false, side: "front", depth: 40 } },
  deck: { on: false, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true },
  bars: [baseBar()], ...over,
});
const rules = { corridorWidth: 5.67 };

console.log("midrise.bars.test.mjs");

/* ---- plan 9.1 test 1 ---- */
t("1. leg ring of a 300 x 65 bar at 0 deg from (-150, 0)", () => {
  const legs = B.legsOf(baseBar());
  eq(legs.length, 1, "one leg");
  const ring = B.legRing(legs[0]);
  same(ring, [[-150, -32.5], [150, -32.5], [150, 32.5], [-150, 32.5]], "ring");
  near(B.ringArea(ring), 19500, 1e-9, "area 300 x 65");
  ok(B.ringArea(ring) > 0, "counter-clockwise");
  eq(legs[0].ext0, 0); eq(legs[0].ext1, 0);
});

/* ---- plan 9.1 test 2 ---- */
t("2. bar with one 90 deg bend at 120 ft: two legs of 152.5 and 212.5, union 19,500, 1 inside corner", () => {
  const bar = baseBar({ bends: [{ at: 120, deg: 90 }] });
  const legs = B.legsOf(bar);
  eq(legs.length, 2, "two legs");
  // miter extension = depth / 2 x tan(45 deg) = 32.5 ft on each side of the bend
  near(legs[0].length + legs[0].ext0 + legs[0].ext1, 152.5, 1e-9, "leg 0 long");   // 120 + 32.5
  near(legs[1].length + legs[1].ext0 + legs[1].ext1, 212.5, 1e-9, "leg 1 long");   // 180 + 32.5
  eq(legs[0].ext0, 0); eq(legs[0].ext1, 32.5); eq(legs[1].ext0, 32.5); eq(legs[1].ext1, 0);
  const rings = legs.map(B.legRing);
  near(B.ringArea(rings[0]), 152.5 * 65, 1e-6, "ring 0 area");
  near(B.ringArea(rings[1]), 212.5 * 65, 1e-6, "ring 1 area");
  // Hand arithmetic: union = 152.5 x 65 + 212.5 x 65 - 65 x 65 = 9,912.5 + 13,812.5 - 4,225 = 19,500
  const u = unionOf(rings);
  near(u.area, 152.5 * 65 + 212.5 * 65 - 65 * 65, 1e-6, "union area");
  near(u.area, 19500, 1e-6, "union area is 19,500");
  eq(u.paths.length, 1, "one polygon");
  eq(u.paths[0].length, 6, "L shape has 6 vertices (sharp miter)");
  eq(legs.length - 1, 1, "the bend counts as 1 inside corner");
});

/* ---- legs ---- */
t("leg 1 starts at the end of leg 0 and turns left by deg", () => {
  const legs = B.legsOf(baseBar({ bends: [{ at: 120, deg: 90 }] }));
  near(legs[1].x0, -30); near(legs[1].y0, 0); near(legs[1].angle, 90);
});
t("negative deg turns right; the extension uses |deg|", () => {
  const legs = B.legsOf(baseBar({ bends: [{ at: 120, deg: -90 }] }));
  near(legs[1].angle, -90); near(legs[1].ext0, 32.5); near(legs[0].ext1, 32.5);
  const ring = B.legRing(legs[1]);
  near(Math.min(...ring.map((p) => p[1])), -180, 1e-9, "runs south");
});
t("60 deg bend: extension = 32.5 x tan(30 deg)", () => {
  const legs = B.legsOf(baseBar({ bends: [{ at: 100, deg: 60 }] }));
  near(legs[0].ext1, 32.5 * Math.tan(Math.PI / 6), 1e-3);
});
t("two bends make three legs, with the angle summed", () => {
  const legs = B.legsOf(baseBar({ bends: [{ at: 100, deg: 90 }, { at: 200, deg: -90 }] }));
  eq(legs.length, 3);
  near(legs[2].angle, 0); near(legs[2].length, 100);
  near(legs[1].ext0, 32.5); near(legs[1].ext1, 32.5);
  near(legs[2].x0, -150 + 100 + 0, 1e-9, "leg 2 x0"); near(legs[2].y0, 100, 1e-9, "leg 2 y0");
});
t("bends beyond 2, outside the bar or unsorted are handled", () => {
  const legs = B.legsOf(baseBar({ bends: [{ at: 250, deg: 90 }, { at: 0, deg: 45 }, { at: 100, deg: 30 }, { at: 400, deg: 10 }, { at: 180, deg: 20 }] }));
  eq(legs.length, 3, "at most 2 valid bends");
  near(legs[0].length, 100); near(legs[1].length, 80);       // sorted: 100 (30 deg), 180 (20 deg)
});
t("|deg| clamps to 150", () => {
  const legs = B.legsOf(baseBar({ bends: [{ at: 100, deg: 170 }] }));
  near(legs[1].angle, 150); near(legs[0].ext1, 32.5 * Math.tan(75 * Math.PI / 180), 1e-3);
});
t("angled bar: ring is a rotated rectangle of the same area", () => {
  const leg = B.legsOf(baseBar({ x: 10, y: 20, angle: 90, length: 100 }))[0];
  const ring = B.legRing(leg);
  same(ring, [[42.5, 20], [42.5, 120], [-22.5, 120], [-22.5, 20]]);
  near(B.ringArea(ring), 6500);
});
t("coordinates round to 0.001 ft and never print -0", () => {
  const ring = B.legRing(B.legsOf(baseBar({ x: 0, y: 0, angle: 33.3333, length: 123.4567 }))[0]);
  for (const [x, y] of ring) { near(x * 1000, Math.round(x * 1000), 1e-6); near(y * 1000, Math.round(y * 1000), 1e-6); }
  const r2 = B.legRing(B.legsOf(baseBar({ x: 0, y: 0, angle: 90, length: 100, depth: 65 }))[0]);
  ok(r2.every((p) => !Object.is(p[0], -0) && !Object.is(p[1], -0)), "no negative zero");
});

/* ---- spine ---- */
t("double bar spine is the centerline", () => {
  same(B.barSpine(baseBar(), rules), [[-150, 0], [150, 0]]);
});
t("breezeway bar spine is the centerline", () => {
  same(B.barSpine(baseBar({ corridor: "breezeway" }), rules), [[-150, 0], [150, 0]]);
});
t("single bar, unitSide left: spine shifts right (south) by depth/2 - corridorWidth/2", () => {
  const s = B.barSpine(baseBar({ corridor: "single", depth: 38, unitSide: "left" }), rules);
  near(s[0][1], -(19 - 5.67 / 2), 1e-3); near(s[1][1], s[0][1], 1e-9); near(s[0][0], -150);
});
t("single bar, unitSide right: spine shifts left (north)", () => {
  const s = B.barSpine(baseBar({ corridor: "single", depth: 38, unitSide: "right" }), rules);
  near(s[0][1], 19 - 5.67 / 2, 1e-3);
});
t("spine follows bends; single spine miters at the bend", () => {
  const bar = baseBar({ bends: [{ at: 120, deg: 90 }] });
  same(B.barSpine(bar, rules), [[-150, 0], [-30, 0], [-30, 180]]);
  const s = B.barSpine({ ...bar, corridor: "single", depth: 38, unitSide: "left" }, rules);
  const d = 19 - 5.67 / 2;
  near(s[0][1], -d, 1e-3); near(s[1][0], -30 + d, 1e-3); near(s[1][1], -d, 1e-3); near(s[2][0], -30 + d, 1e-3);
});
t("single bar without rules.corridorWidth throws and names it", () => {
  throws(() => B.barSpine(baseBar({ corridor: "single" })), "rules.corridorWidth");
});

/* ---- levels ---- */
t("barLevels, no podium: ground 12, then 10 each; z 0, 12, 22, 32, 42", () => {
  const lv = B.barLevels(baseBar(), baseState());
  eq(lv.length, 5);
  same(lv.map((l) => l.index), [1, 2, 3, 4, 5]);
  same(lv.map((l) => l.z), [0, 12, 22, 32, 42]);
  same(lv.map((l) => l.ftf), [12, 10, 10, 10, 10]);
  eq(lv[0].program, "residential");
});
t("barLevels: groundProgram applies to the first bar floor only", () => {
  const lv = B.barLevels(baseBar({ groundProgram: "retail" }), baseState());
  eq(lv[0].program, "retail"); eq(lv[1].program, "residential");
});
t("barLevels with a podium: indices and z continue above the podium", () => {
  const st = baseState({ podium: { ...baseState().podium, on: true, levels: [{ ftf: 16, program: "parking" }, { ftf: 11, program: "parking" }] } });
  const lv = B.barLevels(baseBar(), st);
  same(lv.map((l) => l.index), [3, 4, 5, 6, 7]);
  same(lv.map((l) => l.z), [27, 39, 49, 59, 69]);
});
t("a bar with fewer floors stops early", () => {
  eq(B.barLevels(baseBar({ floors: 2 }), baseState()).length, 2);
  eq(B.barLevels(baseBar({ floors: 0 }), baseState()).length, 0);
});
t("buildingLevels, preset 8.3: 5 bar levels, top 52 ft", () => {
  const lv = B.buildingLevels(baseState());
  eq(lv.length, 5);
  ok(lv.every((l) => l.zone === "bar"));
  near(lv[4].z + lv[4].ftf, 52);
});
t("buildingLevels, preset 8.4: podium 11 + bar 12 + 4 x 10 = 63 ft", () => {
  const st = baseState({ podium: { ...baseState().podium, on: true, levels: [{ ftf: 11, program: "parking" }] } });
  const lv = B.buildingLevels(st);
  eq(lv.length, 6);
  eq(lv[0].zone, "podium"); near(lv[0].z, 0); near(lv[0].ftf, 11);
  eq(lv[1].zone, "bar"); near(lv[1].z, 11); near(lv[1].ftf, 12);
  near(lv[5].z + lv[5].ftf, 63);
  same(lv.map((l) => l.index), [1, 2, 3, 4, 5, 6]);
});
t("buildingLevels, preset 8.6: podium 16 + 11 + bar 12 + 4 x 10 = 79 ft", () => {
  const st = baseState({ podium: { ...baseState().podium, on: true, levels: [{ ftf: 16, program: "parking" }, { ftf: 11, program: "parking" }] } });
  const lv = B.buildingLevels(st);
  eq(lv.length, 7);
  near(lv[6].z + lv[6].ftf, 79);
});
t("buildingLevels, preset 8.5: 5 deck levels list after the bar levels, deck z from 0, top 52.5", () => {
  const st = baseState({ deck: { ...baseState().deck, on: true } });
  const lv = B.buildingLevels(st);
  eq(lv.length, 10);
  same(lv.slice(5).map((l) => l.index), [6, 7, 8, 9, 10]);
  ok(lv.slice(5).every((l) => l.zone === "deck" && l.ftf === 10.5));
  same(lv.slice(5).map((l) => l.z), [0, 10.5, 21, 31.5, 42]);
  near(lv[9].z + lv[9].ftf, 52.5);
});
t("deck levels start at the podium top when the podium is on", () => {
  const st = baseState({ deck: { ...baseState().deck, on: true, levels: 2 }, podium: { ...baseState().podium, on: true } });
  const lv = B.buildingLevels(st).filter((l) => l.zone === "deck");
  same(lv.map((l) => l.z), [11, 21.5]);
});
t("bars with different floor counts: levels above the short bar hold the tall bar only", () => {
  const st = baseState({ bars: [baseBar({ floors: 3 }), baseBar({ id: "B", floors: 5, program: "hotel" })] });
  const lv = B.buildingLevels(st);
  eq(lv.length, 5);
  eq(lv[0].program, "residential"); eq(lv[3].program, "hotel");
});

/* ---- helpers ---- */
t("clipAreaConvex: rectangle with a hole against a strip", () => {
  const mp = [{ outer: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [[[40, 40], [40, 60], [60, 60], [60, 40]]] }];
  near(B.clipAreaConvex(mp, [[0, 0], [100, 0], [100, 50], [0, 50]]), 5000 - 20 * 10, 1e-6);
  near(B.clipAreaConvex(mp, [[-10, -10], [200, -10], [200, 200], [-10, 200]]), 10000 - 400, 1e-6);
  near(B.clipAreaConvex(mp, [[200, 0], [300, 0], [300, 10], [200, 10]]), 0, 1e-9);
});
t("multiPolyArea: outers minus holes", () => {
  const mp = [{ outer: [[0, 0], [250, 0], [250, 220], [0, 220]], holes: [[[65, 65], [65, 155], [185, 155], [185, 65]]] }];
  near(B.multiPolyArea(mp), 55000 - 10800, 1e-9);
});

/* ---- contract rules ---- */
t("inputs are not mutated", () => {
  const bar = deepFreeze(baseBar({ bends: [{ at: 120, deg: 90 }] }));
  const st = deepFreeze(baseState({ bars: [bar] }));
  B.legsOf(bar); B.barSpine(bar, rules); B.barLevels(bar, st); B.buildingLevels(st);
  B.legRing(deepFreeze(B.legsOf(bar)[0]));
});
t("missing inputs throw and name the input", () => {
  throws(() => B.legsOf(null), "bar");
  throws(() => B.legsOf({ x: 0, y: 0, depth: 65 }), "bar.length");
  throws(() => B.legsOf({ x: 0, y: 0, length: 10 }), "bar.depth");
  throws(() => B.legRing({}), "leg");
  throws(() => B.barLevels(baseBar(), {}), "state.floors");
  throws(() => B.buildingLevels({}), "state.floors");
});
t("SCALE is 1000", () => eq(B.SCALE, 1000));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
