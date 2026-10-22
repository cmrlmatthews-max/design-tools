// Run: node test/facade.faces.test.mjs
// Plan: docs/facade-studio-technical-plan.md, section 9.1 tests 1 to 10, plus contract checks.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const F = await import("../src/facade/faces.js");
const { SECTORS, standaloneLevels, massingLevels, bearingOf, sectorOf, levelEdges, zoneOf, faceGroups, streetFaces } = F;
const { assemble } = await import("../src/midrise/assemble.js");
const { midriseDerived } = await import("../src/midrise/derived.js");
const { PRESETS: MIDRISE_PRESETS } = await import("../src/midrise/presets.js");
const { buildPlates } = await import("../src/tower/geometry.js");
const { PRESETS: TOWER_PRESETS } = await import("../src/tower/presets.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const deq = (a, b, m = "") => eq(JSON.stringify(a), JSON.stringify(b), m);
const near = (a, b, tol = 0.001, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
function deepFreeze(o) {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

const STANDALONE = { shape: "rect", width: 300, depth: 65, arm: 65, courtW: 120, courtD: 90, angle: 0, floors: 5, ftf1: 12, ftf: 10,
  podium: { on: false, levels: 1, ftf: 11, width: 300, depth: 200 } };
const stateOf = (standalone = {}, over = {}) => ({ schema: 1, source: "standalone", standalone: { ...clone(STANDALONE), ...standalone },
  placement: null, zones: { mode: "default", ranges: [], rules: {}, overrides: {} }, street: { mode: "auto", manual: [], roadDistance: 60 }, ...over });
const square = (s = 1) => ({ index: 1, zone: "main", z: 0, ftf: 10, program: null, plates: [{ outer: [[0, 0], [s, 0], [s, s], [0, s]], holes: [] }] });
const byOrient = (list) => Object.fromEntries(SECTORS.map((o) => [o, list.filter((x) => x.orientation === o)]));

console.log("facade faces");

t("contract: SECTORS", () => deq(SECTORS, ["N", "E", "S", "W"]));

// 1. Sector boundaries: N [315, 45), E [45, 135), S [135, 225), W [225, 315).
t("1 sectorOf boundaries", () => {
  const got = [0, 44.9, 45, 134.9, 135, 224.9, 225, 314.9, 315].map(sectorOf);
  deq(got, ["N", "N", "E", "E", "S", "S", "W", "W", "N"]);
  eq(sectorOf(360), "N"); eq(sectorOf(-45), "N"); eq(sectorOf(-46), "W");   // −45 → 315 (N); −46 → 314 (W)
});

// 2. CCW unit square from (0,0): edges bottom, right, top, left.
//    bottom d = (1,0) → n = (d.y, −d.x) = (0,−1) → atan2(0,−1) = 180 (S); right n = (1,0) → 90 (E); top n = (0,1) → 0 (N); left n = (−1,0) → 270 (W).
t("2 CCW square bearings 180, 90, 0, 270", () => {
  const e = levelEdges(square(), 0);
  eq(e.length, 4);
  deq(e.map((x) => x.bearing), [180, 90, 0, 270]);
  deq(e.map((x) => x.orientation), ["S", "E", "N", "W"]);
  deq(e[0].normal, [0, -1]);
  ok(e.every((x) => x.convexStart && x.convexEnd), "square corners convex");
  // A CW input ring is cleaned to CCW first: same normals.
  const cw = { ...square(), plates: [{ outer: [[0, 0], [0, 1], [1, 1], [1, 0]], holes: [] }] };
  deq(levelEdges(cw, 0).map((x) => x.orientation).sort(), ["E", "N", "S", "W"]);
});

// 3. Rotation 90: north normal (0,1) → px = 0·cos90 − 1·sin90 = −1, py = 0·sin90 + 1·cos90 = 0 → atan2(−1, 0) = −90 → 270 (W).
t("3 rotation 90 turns the north edge W (270)", () => {
  eq(bearingOf([0, 1], 90), 270);
  const e = levelEdges(square(), 90);
  eq(e[2].bearing, 270); eq(e[2].orientation, "W");
  deq(e.map((x) => x.bearing), [90, 0, 270, 180]);
});

// 4. Angle 30 rotates the rings CCW 30°: south normal (0,−1) → (sin30, −cos30) = (0.5, −0.866) → atan2 = 150 (S); north → 330 (N).
t("4 standalone angle 30: long faces 150 (S) and 330 (N)", () => {
  const lv = standaloneLevels({ ...STANDALONE, angle: 30 });
  const e = levelEdges(lv[0], 0);
  eq(e.length, 4);
  const long = e.filter((x) => Math.abs(x.length - 300) < 0.01);
  eq(long.length, 2);
  const b = long.map((x) => x.bearing).sort((p, q) => p - q);
  near(b[0], 150, 0.001); near(b[1], 330, 0.001);
  deq(long.map((x) => x.orientation).sort(), ["N", "S"]);
  const short = e.filter((x) => Math.abs(x.length - 65) < 0.01).map((x) => x.bearing).sort((p, q) => p - q);
  near(short[0], 60, 0.001); near(short[1], 240, 0.001);     // E face 90 − 30 = 60; W face 270 − 30 = 240
  // Placement rotation is not applied to standalone rings twice.
  eq(massingLevels(stateOf({ angle: 30 }), null).rotation, 0);
});

// 5. O 250 × 220, court 120 × 90: 4 outer + 4 court faces. Court ring is CW, n = (d.y, −d.x) points into the court:
//    the court's south side (y = −45) has normal +y → bearing 0 (N).
t("5 O shape: 8 faces per level; court faces point into the court", () => {
  const lv = standaloneLevels({ ...STANDALONE, shape: "O", width: 250, depth: 220, courtW: 120, courtD: 90 });
  eq(lv.length, 5);
  for (const l of lv) eq(levelEdges(l, 0).length, 8, `level ${l.index}`);
  const e = levelEdges(lv[0], 0);
  const court = e.filter((x) => x.ring === 1);
  eq(court.length, 4);
  const south = court.find((x) => Math.abs(x.a[1] + 45) < 0.01 && Math.abs(x.b[1] + 45) < 0.01);
  ok(south, "court south side");
  eq(south.orientation, "N"); eq(south.bearing, 0); eq(south.length, 120);
  const north = court.find((x) => Math.abs(x.a[1] - 45) < 0.01 && Math.abs(x.b[1] - 45) < 0.01);
  eq(north.orientation, "S");
  // Court corners are inside corners of the building: not convex. Outer corners are convex.
  ok(court.every((x) => !x.convexStart && !x.convexEnd), "court corners concave");
  ok(e.filter((x) => x.ring === 0).every((x) => x.convexStart && x.convexEnd), "outer corners convex");
  // Outer faces: S 250, E 220, N 250, W 220.
  const outer = byOrient(e.filter((x) => x.ring === 0));
  deq(SECTORS.map((o) => outer[o].map((x) => x.length)), [[250], [220], [250], [220]]);
});

// 6. A vertex mid-edge (and a near-collinear 0.2° kink) merge away: 4 edges.
t("6 collinear merge: 4 edges", () => {
  const lv = { ...square(), plates: [{ outer: [[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]], holes: [] }] };
  const e = levelEdges(lv, 0);
  eq(e.length, 4);
  eq(e[0].length, 100);
  // 0.2° kink on the bottom edge: (0,0) → (50, −0.175) → (100,0); 0.175/50 rad = 0.2° per side, 0.4° turn < 0.5°.
  const kink = { ...square(), plates: [{ outer: [[0, 0], [50, -0.175], [100, 0], [100, 100], [0, 100]], holes: [] }] };
  eq(levelEdges(kink, 0).length, 4);
  // A 0.05 ft chamfer at a corner is dropped (< 0.1 ft): 4 edges.
  const ch = { ...square(), plates: [{ outer: [[0, 0], [99.95, 0], [100, 0.05], [100, 100], [0, 100]], holes: [] }] };
  eq(levelEdges(ch, 0).length, 4);
});

// 7. Zones, plan 3.4.
t("7 zones: 5 levels; 2 podium + 24; 1 level; 2 levels", () => {
  const five = standaloneLevels(STANDALONE);
  deq(zoneOf({}, five), { 1: "base", 2: "middle", 3: "middle", 4: "middle", 5: "top" });
  const pod = standaloneLevels({ ...STANDALONE, floors: 24, podium: { on: true, levels: 2, ftf: 15, width: 300, depth: 200 } });
  eq(pod.length, 26);
  const z = zoneOf({}, pod);
  eq(z[1], "base"); eq(z[2], "base"); eq(z[3], "middle"); eq(z[25], "middle"); eq(z[26], "top");
  eq(Object.values(z).filter((v) => v === "middle").length, 23);
  deq(zoneOf({}, standaloneLevels({ ...STANDALONE, floors: 1 })), { 1: "base" });
  deq(zoneOf({}, standaloneLevels({ ...STANDALONE, floors: 2 })), { 1: "base", 2: "top" });
  // Ranges mode: levels 2 to 3 in Z1; others fall back to the default.
  const st = { zones: { mode: "ranges", ranges: [{ id: "Z1", name: "Levels 2 to 3", from: 2, to: 3 }] } };
  deq(zoneOf(st, five), { 1: "base", 2: "Z1", 3: "Z1", 4: "middle", 5: "top" });
  // Podium heights: level 1 ftf1 12, level 2 podium ftf 15, level 3 main ftf 10 at z = 27.
  eq(pod[0].ftf, 12); eq(pod[1].ftf, 15); eq(pod[2].ftf, 10); eq(pod[2].z, 27);
});

// 8. Rect 5 floors: zones base (1), middle (2–4), top (5); 4 groups each → 12 groups.
t("8 face groups, rect 5 floors: 4 per zone", () => {
  const st = stateOf();
  const { levels, rotation } = massingLevels(st, null);
  const g = faceGroups(st, levels, rotation);
  eq(g.length, 12);
  for (const [zone, n, h] of [["base", 1, 12], ["middle", 3, 30], ["top", 1, 10]]) {
    const zg = g.filter((x) => x.zone === zone);
    eq(zg.length, 4, zone);
    ok(zg.every((x) => x.levels.length === n && x.height === h), `${zone} levels/height`);
    deq(zg.map((x) => x.orientation).sort(), ["E", "N", "S", "W"]);
  }
  deq(g.map((x) => x.id).slice(0, 4), ["F1", "F2", "F3", "F4"]);
  eq(g[0].orientation, "S"); eq(g[0].length, 300);       // standalone rings start at the SW corner
  const mid = g.find((x) => x.zone === "middle" && x.orientation === "N");
  eq(mid.levelFrom, 2); eq(mid.levelTo, 4); deq(mid.levels, [2, 3, 4]); eq(mid.edges.length, 3);
  // Wall check: Σ length × height = 2 × (300 + 65) × 52 = 37,960 sf (plan 8.9).
  eq(Math.round(g.reduce((s, x) => s + x.length * x.height, 0) * 10) / 10, 37960);
});

// 9. Mid-Rise double-bar (300 × 65 bar, 5 floors at 12 / 10) through assemble + midriseDerived = the standalone rect.
t("9 Mid-Rise double-bar matches the standalone 300 × 65", () => {
  const pre = MIDRISE_PRESETS.find((p) => p.id === "double-bar");
  ok(pre, "double-bar preset");
  const mstate = clone(pre.state);
  const built = assemble(mstate);
  const derived = midriseDerived(mstate, built, null);
  const project = { sections: { massing: { tool: "midrise", schema: 1, placement: { x: 500, y: 500, rotation: 0, baseZ: 0 }, state: {}, derived } } };
  const st = stateOf({}, { source: "project" });
  const m = massingLevels(st, project);
  eq(m.source, "project"); eq(m.levels.length, 5);
  const gm = faceGroups(st, m.levels, m.rotation);
  const s = massingLevels(stateOf(), null);
  const gs = faceGroups(stateOf(), s.levels, s.rotation);
  eq(gm.length, gs.length);
  const key = (g) => `${g.zone}|${g.orientation}|${g.length}|${g.levels.join(",")}|${g.height}`;
  deq(gm.map(key).sort(), gs.map(key).sort());
  // Same end points as a set (the bar is centered on the origin like the standalone rect).
  const pts = (gl) => gl.map((g) => [g.a, g.b].map((p) => p.join(",")).sort().join(";")).sort();
  deq(pts(gm), pts(gs));
});

// 10. Tower 10 floors, rect 100 × 60, twist 45° (t = i / 9 → 5° per floor; CCW twist lowers bearings by 5° per floor).
t("10 tower twist 45° over 10 floors: one group per level, equal steps, total = twist", () => {
  const base = clone(TOWER_PRESETS[0].state);
  base.podium = { ...base.podium, on: false };
  base.segments = [{ floors: 10, ftf: 10, program: "residential", shape: { type: "rect", w: 100, d: 60, radius: 0, points: [] },
    offset: { x: 0, y: 0 }, rotation: 0, taper: { x: 0, y: 0, curve: "linear" }, twist: { deg: 45, start: 0, end: 1, curve: "linear" }, lean: { x: 0, y: 0 } }];
  base.setbacks = []; base.mechanical = []; base.carves = []; base.cuts = [];
  const { plates } = buildPlates(base);
  eq(plates.length, 10);
  const levels = plates.map((p) => ({ index: p.n, zone: p.zone, z: p.z, ftf: p.ftf, plates: p.polygons }));
  const g = faceGroups({}, levels, 0);
  eq(g.length, 40);
  ok(g.every((x) => x.levels.length === 1), "one level per group");
  // Follow the south face (edge with the longest length facing S at level 1) up the tower by edge index k.
  const k0 = levelEdges(levels[0], 0).find((e) => e.orientation === "S" && Math.abs(e.length - 100) < 0.01).k;
  const b = levels.map((l) => levelEdges(l, 0)[k0].bearing);
  const steps = b.slice(1).map((v, i) => b[i] - v);
  steps.forEach((s, i) => near(s, 5, 0.002, `step ${i + 1}`));
  near(b[0] - b[9], 45, 0.002, "total");
  near(b[0], 180, 0.001); near(b[9], 135, 0.001);
});

/* ---------- contract checks ---------- */

t("contract: no input mutation", () => {
  const st = deepFreeze(stateOf({ shape: "U", width: 300, depth: 200, arm: 65 }));
  const m = massingLevels(st, null);
  deepFreeze(m.levels);
  const g = faceGroups(st, m.levels, 0);
  deepFreeze(g);
  streetFaces(st, g, m.levels, null);
  levelEdges(m.levels[0], 15);
  zoneOf(st, m.levels);
});

t("contract: U open to the north has 8 faces; L has 6", () => {
  const u = standaloneLevels({ ...STANDALONE, shape: "U", width: 300, depth: 200, arm: 65 });
  const e = levelEdges(u[0], 0);
  eq(e.length, 8);
  // S 300, E 200, N arm ends 65 × 2, inner sides 135 × 2, court back 170 (plan 8.6).
  deq(e.map((x) => x.length).sort((p, q) => p - q), [65, 65, 135, 135, 170, 200, 200, 300]);
  const back = e.find((x) => x.length === 170); eq(back.orientation, "N");
  eq(e.filter((x) => !x.convexStart).length, 2);     // two inside corners of the U
  const l = standaloneLevels({ ...STANDALONE, shape: "L", width: 200, depth: 150, arm: 50 });
  eq(levelEdges(l[0], 0).length, 6);
});

t("contract: standalone podium levels and z", () => {
  const lv = standaloneLevels({ ...STANDALONE, floors: 5, podium: { on: true, levels: 2, ftf: 11, width: 300, depth: 200 } });
  deq(lv.map((l) => l.zone), ["podium", "podium", "main", "main", "main", "main", "main"]);
  deq(lv.map((l) => l.z), [0, 12, 23, 33, 43, 53, 63]);
  deq(lv.map((l) => l.index), [1, 2, 3, 4, 5, 6, 7]);
  eq(lv[0].program, null);
  ok(lv[0].plates !== lv[1].plates, "plates not shared");
});

t("contract: project levels skip deck, crown, and empty; tower with no levels notes", () => {
  const ring = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const L = (index, zone, z, ftf, plates) => ({ index, zone, z, ftf, program: "residential", plates });
  const derived = { levels: [L(2, "bar", 12, 10, [{ outer: ring, holes: [] }]), L(1, "bar", 0, 12, [{ outer: ring, holes: [] }]),
    L(3, "bar", 22, 10, []), L(9, "deck", 0, 10.5, [{ outer: ring, holes: [] }]), L(4, "crown", 32, 4, [{ outer: ring, holes: [] }])] };
  const project = { sections: { massing: { tool: "midrise", placement: { x: 0, y: 0, rotation: 30, baseZ: 0 }, derived } } };
  const m = massingLevels({ source: "project", standalone: STANDALONE }, project);
  eq(m.source, "project"); eq(m.rotation, 30);
  deq(m.levels.map((l) => l.index), [1, 2]);
  const tower = { sections: { massing: { tool: "tower", placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, derived: {} } } };
  const t2 = massingLevels({ source: "project", standalone: STANDALONE }, tower);
  eq(t2.source, "standalone"); deq(t2.noteIds, ["tower-no-levels"]);
  eq(t2.notes[0], "The Tower Generator does not write massing levels yet. Use the standalone massing.");
  eq(t2.levels.length, 5);
  const none = massingLevels({ source: "project", standalone: STANDALONE }, null);
  eq(none.source, "standalone"); deq(none.noteIds, ["no-project-massing"]);
});

t("contract: groups do not join across a void floor", () => {
  const ring = [{ outer: [[0, 0], [100, 0], [100, 50], [0, 50]], holes: [] }];
  const levels = [{ index: 1, zone: "tower", z: 0, ftf: 10, plates: ring }, { index: 3, zone: "tower", z: 20, ftf: 10, plates: ring }];
  const g = faceGroups({ zones: { mode: "ranges", ranges: [{ id: "A", from: 1, to: 3 }] } }, levels, 0);
  eq(g.length, 8);
});

t("contract: street faces auto, manual, and auto with a site", () => {
  const st = stateOf();
  const { levels } = massingLevels(st, null);
  const g = faceGroups(st, levels, 0);
  const auto = streetFaces(st, g, levels, null);
  eq(auto.source, "auto"); deq(auto.ids, [g.find((x) => x.zone === "base" && x.orientation === "S").id]);
  const man = streetFaces({ ...st, street: { mode: "manual", manual: ["F2", "F99", "F1"] } }, g, levels, null);
  eq(man.source, "manual"); deq(man.ids, ["F1", "F2"]);
  // Massing placed at (500, 500), rotation 0. South face midpoint (0, −32.5) → (500, 467.5).
  // Road A runs east-west at y = 427.5 (40 ft south) → street. Road B at y = 367.5 (100 ft south) → not street.
  const road = (id, y) => ({ id, cls: "primary", name: id, width: 36, line: [[0, y, 1000], [1000, y, 1000]] });
  const massing = { tool: "midrise", placement: { x: 500, y: 500, rotation: 0, baseZ: 0 }, derived: {} };
  const near40 = { sections: { site: { tool: "site", placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, derived: { roads: { segments: [road("A", 427.5)] } } }, massing } };
  const s1 = streetFaces(st, g, levels, near40);
  eq(s1.source, "auto-site"); deq(s1.ids, auto.ids);
  const far = { sections: { ...near40.sections, site: { ...near40.sections.site, derived: { roads: { segments: [road("B", 367.5)] } } } } };
  deq(streetFaces(st, g, levels, far).ids, []);
  // Rotation 90: the local south face now faces project east (bearing 90); its midpoint maps to (532.5, 500).
  const rot = { sections: { site: near40.sections.site, massing: { ...massing, placement: { x: 500, y: 500, rotation: 90, baseZ: 0 } } } };
  const roadE = { ...rot, sections: { ...rot.sections, site: { ...rot.sections.site, derived: { roads: { segments: [{ id: "E", line: [[572.5, 0, 0], [572.5, 1000, 0]] }] } } } } };
  const gr = faceGroups(st, levels, 90);
  const sid = gr.find((x) => x.zone === "base" && x.orientation === "E").id;
  deq(streetFaces(st, gr, levels, roadE).ids, [sid]);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
