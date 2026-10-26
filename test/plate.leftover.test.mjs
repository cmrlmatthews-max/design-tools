// Run: node test/plate.leftover.test.mjs
// The leftover fix (October 26, 2026). Cade's hotel tower: a rounded and chamfered square plate around a large auto
// core with a point corridor. Before the fix the band of the facade north and south of the corridor dropped as a whole
// (the side bands take the corridor corners first, and a candidate that overlapped a taken band by more than 1 sf was
// dropped), so two "Leftover" pieces of 4,027 sf each stayed under the facade. Turned 12 degrees, the plate kept only
// 1.5 ft and 10.7 ft runs: 16,507 sf of leftover. Fixture: src/plate/testcases.js hotelTowerPlate.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const FL = await import("../src/plate/fill.js");
const SG = await import("../src/plate/suggest.js");
const DR = await import("../src/plate/draw.js");
const MT = await import("../src/plate/metrics.js");
const { defaultState, PRESETS } = await import("../src/plate/presets.js");
const { hotelTowerPlate } = await import("../src/plate/testcases.js");
const { GEO } = await import("../src/plate/corridor.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.001, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ± ${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const area = (r) => Math.abs(GEO.ringArea(r));

/** Hotel mode, the drawn fixture plate turned `rot` degrees, auto core, no units. */
function fixture(rot = 0, more = {}) {
  const s = defaultState();
  s.mode = "hotel";
  s.plate = { shape: "polygon", points: hotelTowerPlate(rot) };
  s.units = [];
  return Object.assign(s, more);
}
const layOf = (s) => FL.buildPlates(s).groups[0].fill;
const leftoverSf = (f) => f.support.filter((x) => x.kind === "leftover" || x.kind === "remainder").reduce((a, x) => a + area(x.outer), 0);
/** Suggest every open stretch in turn and accept the ghosts (the deficit counters carry). → keys */
function suggestAll(s, f) {
  let counters = {}, n = 0;
  for (const st of f.free) {
    const r = SG.suggestRun(f, s, st, { counters });
    for (const u of r.units) counters[u.type] = (counters[u.type] || 0) + 1;
    n += r.units.length;
  }
  return n;
}

console.log("plate leftover fix");

// Unturned: auto core [-31, -16, 31, 17] (rounded), point corridor 5.67 → the corridor faces at x ±37 and y −22.5 / 22.5.
// East and west bands: 83.086 ft at 34.206 ft deep (as before). North and south: the candidate overlapped the east and
// west bands at the corridor corners; it now keeps the stretch of its face they do not cover: x −37 to 37 = 74 ft,
// 49.515 ft deep on average (the arc top is 55 ft beyond the face). Leftover: 4 triangles of 181 sf beside the
// diagonal facets (725 sf; before: 2 × 4,027 = 8,053 sf). Hotel keys by width: 74 ft = 5 keys (14 + 14.5 + … ≤ 75).
t("L1 the unturned fixture: north and south runs of 74 ft; leftover 725 sf (was 8,053); the closure holds", () => {
  const s = fixture(0);
  const f = layOf(s);
  eq(f.kind, "point"); eq(f.coreMode, "auto");
  eq(f.runs.length, 4, "runs");
  const ns = f.runs.filter((r) => Math.abs(r.n[0]) < 1e-6);
  eq(ns.length, 2, "a north and a south run");
  for (const r of ns) { near(r.length, 74, 0.01, `${r.id} length`); near(r.depth, 49.515, 0.01, `${r.id} depth`); }
  const ew = f.runs.filter((r) => Math.abs(r.n[1]) < 1e-6);
  for (const r of ew) { near(r.length, 83.086, 0.01); near(r.depth, 34.206, 0.01); }
  near(leftoverSf(f), 725, 2, "leftover sf");
  ok(f.support.filter((x) => x.kind === "leftover").every((x) => area(x.outer) < 200), "every leftover is a small triangle");
  const c = MT.computeMetrics(s, FL.buildPlates(s)).groups[0].row.closure;
  ok(c.ok, JSON.stringify(c));
});

t("L2 the unturned fixture: Suggest on every open stretch gives 21 keys (was 10); 5 on the north run", () => {
  const s = fixture(0);
  const f = layOf(s);
  eq(suggestAll(s, f), 21, "keys");
  const north = f.runs.find((r) => r.n[1] > 0.99);
  const g = SG.suggestRun(f, s, f.free.find((x) => x.runId === north.id));
  eq(g.units.length, 5, "north keys"); eq(g.note, null);
  ok(g.units.every((u) => u.outer.every((p) => p[1] >= 22.5 - 0.01)), "the keys lie north of the corridor face");
});

// Turned 12 degrees: before, sliver candidates (1.5 ft and 10.7 ft, where a facet grazes a corridor corner) took the
// corners first and the long bands dropped: 4 runs, 16,507 sf of leftover, 0 keys. Now slivers under 2 ft stay leftover,
// overlapped candidates keep their free stretches: 6 runs, about 1,334 sf of leftover.
t("L3 the fixture turned 12 degrees: 6 runs; leftover under 1,500 sf (was 16,507); Suggest gives 17 keys (was 0)", () => {
  const s = fixture(12);
  const f = layOf(s);
  eq(f.runs.length, 6, "runs");
  ok(f.runs.every((r) => r.length >= 2), "no sliver run");
  const lsf = leftoverSf(f);
  ok(lsf < 1500, `leftover ${Math.round(lsf)} sf`);
  eq(suggestAll(s, f), 17, "keys");
  const c = MT.computeMetrics(s, FL.buildPlates(s)).groups[0].row.closure;
  ok(c.ok, JSON.stringify(c));
});

t("L4 the automatic fill (fillPlates) also fills the north and south: 21 keys (was 11), leftover 725 sf", () => {
  const s = fixture(0);
  const f = FL.fillPlates(s).groups[0].fill;
  eq(f.units.length, 21, "keys");
  near(leftoverSf(f), 725, 2);
});

// A stretch no set of keys fills exactly (hotel: 4 keys reach 60 ft, 5 keys need 67.5 ft): the longest shorter length
// that a set fills takes the keys from the stretch start; the note names the open rest.
t("L5 Suggest on a 66.3 ft hotel stretch: 4 keys on the first 60 ft and a note; a 10 ft stretch: none and the too-short note", () => {
  const s = fixture(12);
  const f = layOf(s);
  const st = f.free.find((x) => Math.abs(x.length - 66.311) < 0.01);
  ok(st, "a 66.3 ft stretch");
  const g = SG.suggestRun(f, s, st);
  eq(g.units.length, 4, "keys");
  near(g.units[3].b - g.units[0].a, 60, 0.01, "60 ft used");
  ok(/^The units take 60'-0" of this 66'-4" stretch\. 6'-4" stays open/.test(g.note), g.note);
  const short = SG.suggestRun(f, s, { ...st, b: st.a + 10, length: 10 });
  eq(short.units, []); ok(/too short/.test(short.note), short.note);
});

// Leftover pieces have a run along their longest side off the facade (leftoverRuns, id LR<k>). A seed point in
// openLeftovers ("Make open stretch") or a drawn unit over the piece opens it: its run joins runs and the rest of it is
// an open stretch; it is no longer support. Unturned fixture: each triangle has a 19.042 ft side, 9.521 ft deep on average.
t("L6 a leftover offers a run; a seed point opens it as an open stretch; the closure holds", () => {
  const s = fixture(0);
  const f = layOf(s);
  const lo = f.support.filter((x) => x.kind === "leftover");
  eq(lo.length, 4); eq(f.leftoverRuns.length, 4);
  ok(lo.every((x) => f.leftoverRuns.some((r) => r.id === x.run)), "each leftover names its run");
  const r = f.leftoverRuns.find((x) => x.id === lo[0].run);
  near(r.length, 19.042, 0.01); near(r.depth, 9.521, 0.01);
  eq(r.stretch, { id: `${r.id}:1`, runId: r.id, a: 0, b: r.length, length: r.length, depth: r.depth, start: r.start, end: r.end });
  const c0 = GEO.centroidOf([{ outer: lo[0].outer, holes: [] }]);
  const s2 = fixture(0, { openLeftovers: [c0] });
  const f2 = layOf(s2);
  eq(f2.support.filter((x) => x.kind === "leftover").length, 3, "one leftover fewer");
  eq(f2.leftoverRuns.length, 3);
  const run = f2.runs.find((x) => x.id === r.id);
  ok(run && run.leftover, "the run joins the runs");
  eq(f2.free.filter((x) => x.runId === r.id).map((x) => [x.a, x.b]), [[0, r.length]], "one open stretch");
  near(f2.openArea - f.openArea, area(lo[0].outer), 0.5, "the piece is open area now");
  const c = MT.computeMetrics(s2, FL.buildPlates(s2)).groups[0].row.closure;
  ok(c.ok, JSON.stringify(c));
});

t("L7 painting on a leftover run makes a unit there; the piece opens and the rest is an open stretch; no seed needed", () => {
  const s = fixture(0);
  const f = layOf(s);
  const r = f.leftoverRuns[0];
  const plus = { ...f, runs: [...f.runs, ...f.leftoverRuns], free: [...f.free, ...f.leftoverRuns.map((x) => x.stretch)] };
  const p = DR.paintUnit(plus, s, r.id, 0, 14);
  ok(p.unit, p.message);
  eq(p.unit.mode, "run"); eq(p.unit.runKey.split(":")[1], r.edge);
  s.units = [DR.toStateUnit(p.unit, [])];
  const f2 = layOf(s);
  eq(f2.units.length, 1);
  eq(f2.units[0].runId, r.id, "the unit sits on the leftover run");
  eq(f2.support.filter((x) => x.kind === "leftover").length, 3);
  const fs = f2.free.filter((x) => x.runId === r.id);
  eq(fs.length, 1); near(fs[0].a, 14, 0.01); near(fs[0].b, r.length, 0.01);
});

t("L8 Suggest on a leftover run gives a key; a free rectangle drawn in a leftover is a unit (the zone holds leftovers)", () => {
  const s = fixture(0);
  const f = layOf(s);
  const plus = { ...f, runs: [...f.runs, ...f.leftoverRuns], free: [...f.free, ...f.leftoverRuns.map((x) => x.stretch)] };
  const g = SG.suggestRun(plus, s, f.leftoverRuns[0].stretch);
  eq(g.units.length, 1, "one key");
  const lo = f.support.find((x) => x.kind === "leftover");
  const c = GEO.centroidOf([{ outer: lo.outer, holes: [] }]);
  const ring = [[c[0] - 5, c[1] - 5], [c[0] + 5, c[1] - 5], [c[0] + 5, c[1] + 5], [c[0] - 5, c[1] + 5]];
  const fu = DR.freeUnit(f, s, ring);
  ok(fu.unit, fu.message);
  ok(fu.area > 50, `area ${fu.area}`);
});

t("L9 presets keep their runs: no preset gains or loses a run, and the default blank plate has no leftover", () => {
  for (const p of PRESETS) {
    const f = FL.buildPlates(p.state).groups[0].fill;
    ok(f.runs.every((r) => !r.leftover), `${p.id}: no leftover run is open`);
  }
  const d = layOf(defaultState());
  eq(d.support.filter((x) => x.kind === "leftover").length, 0);
});

t("L10 determinism and no input mutation", () => {
  const s = fixture(12);
  const before = JSON.stringify(s);
  const a = JSON.stringify(layOf(s)), b = JSON.stringify(layOf(s));
  eq(a === b, true); eq(JSON.stringify(s), before);
});

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
