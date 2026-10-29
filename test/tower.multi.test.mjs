// Run: node test/tower.multi.test.mjs
// Several towers on one podium (Cade, October 29, 2026). The data model: state.segments stays one flat list; a segment's
// optional `tower` (default 0) names its tower. Towers share levels: Tower 1 sets the floor heights, the other towers take
// the same levels bottom up and go on at Tower 1's top floor-to-floor.
//
// Golden check: GOLDEN below holds hashes of the module outputs made by the code BEFORE the multi-tower change (commit
// e189168). A one-tower design must give the same floors, plates, solids, warnings, metrics, derived and SketchUp file;
// the only new key is `tower` on floors, plates and crown solids, which the hash leaves out.
// To print the hashes from another copy of the modules: TOWER_ROOT=/path/to/copy/ node test/tower.multi.test.mjs --hashes
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const ROOT = process.env.TOWER_ROOT || new URL("../", import.meta.url).href;
const at = (p) => (ROOT.startsWith("file:") ? new URL(p, ROOT).href : ROOT + p);
const G = await import(at("src/tower/geometry.js"));
const { towerDerived } = await import(at("src/tower/derived.js"));
const { towerToSketchup } = await import(at("src/tower/sketchup.js"));
const { PRESETS } = await import(at("src/tower/presets.js"));
const { TEST_CASES } = await import(at("src/tower/testcases.js"));
const { buildPlates, computeMetrics, buildFloorList, multiPolyArea } = G;

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok   " + name); } catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); } };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- the golden states (one tower) ---------- */

const preset = (id) => clone(PRESETS.find((p) => p.id === id).state);
const tcase = (id) => clone(TEST_CASES.find((c) => c.id === id).state);
function goldenStates() {
  const out = [];
  for (const id of ["point-tower", "office-slab", "hotel-podium", "l-multifamily-podium", "u-multifamily-podium"]) out.push([id, preset(id)]);
  for (const c of TEST_CASES) out.push([c.id, clone(c.state)]);
  for (const type of ["none", "flat", "stepped", "sloped", "spire", "screen"]) {
    const s = tcase("tc-05-podium-tower-gfa");
    s.crown = { type, height: 20, steps: 3, slopeSide: "back" };
    out.push([`tc-05-crown-${type}`, s]);
  }
  const m = tcase("tc-14-two-segments");
  m.mechanical = [{ afterFloor: 4, ftf: 16 }, { afterFloor: 9, ftf: 18 }];
  m.carves = [{ kind: "full", startFloor: 6, endFloor: 6 }, { kind: "corner", corner: "NE", w: 10, d: 10, startFloor: 2, endFloor: 3 }];
  m.cuts = [{ side: "front", depth: 8, startFloor: 7, endFloor: 12 }];
  m.setbacks = [{ floor: 8, distance: 5, sides: ["left"] }];
  out.push(["tc-14-everything", m]);
  return out;
}

const hashOf = (x) => createHash("sha1").update(JSON.stringify(x, function (k, v) {
  if (k === "createdAt") return undefined;
  if (k === "tower" && typeof v === "number" && ("segmentIndex" in this || "role" in this || "kind" in this)) return undefined;
  return v;
})).digest("hex").slice(0, 16);
function hashes(state) {
  const b = buildPlates(state), m = computeMetrics(state, b.plates);
  return [buildFloorList(state), b.plates, b.solids, b.warnings, m, towerDerived(state, b, m), towerToSketchup(state, b)].map(hashOf);
}

if (process.argv.includes("--hashes")) {
  const o = {};
  for (const [id, s] of goldenStates()) o[id] = hashes(s);
  console.log(JSON.stringify(o));
  process.exit(0);
}

const GOLDEN = {
  "point-tower": ["9acab92e718e2988", "7f39ecc558569c36", "e0f1b77e26937ec2", "97d170e1550eee4a", "cbe439dbbb2f7953", "8bf836cf73c5aa65", "e319bbaac9d39bdb"],
  "office-slab": ["48ae734668c2a8bc", "c36489c4821713ac", "d0b9e92f2f71ca5f", "97d170e1550eee4a", "880bf77c6ec1119a", "d3926190c08549c5", "7b721cbb6973da18"],
  "hotel-podium": ["648122a93667a6d0", "440de27f3323c958", "556502e8bd3a4884", "97d170e1550eee4a", "6d3b44ca225ece57", "d5ee3426ac9d8955", "70461bfee42a55d2"],
  "l-multifamily-podium": ["fed269fa758e7f9e", "265fadf27afc5e64", "ffdb2f53f7c0bfb7", "97d170e1550eee4a", "c0839b4e33880483", "d78deb4de4d51e1a", "4633ff7b60f52960"],
  "u-multifamily-podium": ["fed269fa758e7f9e", "d64212ae26222688", "4e7762477c648cec", "97d170e1550eee4a", "2db6361671b7ab5d", "25248514f5014628", "77cbc6267f9395a4"],
  "tc-01-box-default": ["65b73cf8dbf452e7", "fcd3c9eadc01d953", "9003aa0f5e18a9d0", "97d170e1550eee4a", "432919b20c896698", "c73389039d87b95a", "74bd264e7a2e522a"],
  "tc-02-box-60x40-25f-ftf13.5": ["44f7bbbdd6a24854", "38c34b0a186e81e9", "733bb810618b2117", "97d170e1550eee4a", "d4f89fa188a1349b", "585aeee17a826e28", "e50dfeb288b39885"],
  "tc-03-single-floor-coverage": ["fb8515729f118896", "2a546388731a817c", "00359325467d86b4", "97d170e1550eee4a", "b8830e7987e3bcb4", "3f2b6ae46363e1be", "e2d60cce2e12d17b"],
  "tc-04-far-120x80-12f": ["0584955ac7be7410", "e530a7f49a467e2e", "7d9cb8cb236c67bb", "97d170e1550eee4a", "0bbebc3fdcb25204", "c98b60a8e899b53c", "b7213b1439175464"],
  "tc-05-podium-tower-gfa": ["12d6ad2666dc4bb3", "b1b840fdf35f4edb", "d92224f4f10cd89f", "97d170e1550eee4a", "a780dfd2222485a9", "81e1661fdb113d04", "cf3bc5ce660225e8"],
  "tc-06-podium-ground-ftf": ["bb9d8c2c235559db", "b04bb101b5b6d585", "3fdaa5f800d6784f", "97d170e1550eee4a", "c575ce3c81a9a661", "ffd5e1e5d78ca66c", "cf0a54a6e5d0a660"],
  "tc-07-mechanical-floor": ["a43188d701c5f348", "79ae97f03b09bb79", "e99c0deb5a7b1df7", "97d170e1550eee4a", "83cc26158ba4e3a0", "56c85b27bafad07f", "07ad3bd9248a2dae"],
  "tc-08-screen-crown-height": ["65b73cf8dbf452e7", "fcd3c9eadc01d953", "6007e3973d474055", "97d170e1550eee4a", "6b005352678e4559", "4597b8072c709ac6", "1d9d6f722d61ac67"],
  "tc-09-setback-all-sides-floor6": ["65b73cf8dbf452e7", "9ceea32d2dc3b8fd", "2959428fde7e92c1", "97d170e1550eee4a", "5ff076694351912f", "090c12ec271a59fa", "02a874bfd185511d"],
  "tc-10-setback-front-only": ["65b73cf8dbf452e7", "2a0f94929016d1f7", "7a1e0d1d3899e4e8", "97d170e1550eee4a", "eae2a1a2f725d937", "5a6b34b279366c1c", "a437c3f023024f3c"],
  "tc-11-linear-taper": ["cdea387a0b61294e", "13e0fb7052557f6d", "3011a4f825dd9c83", "97d170e1550eee4a", "1f63952edfbdc1cb", "18ce086981d50668", "25f6d78b9cc1a6f7"],
  "tc-12-twist-keeps-gfa": ["65b73cf8dbf452e7", "41a63b369a249d6d", "8c365425a05f72e8", "97d170e1550eee4a", "310fa62d9e8fb328", "b75cfaea0a3dc43f", "162e87b3174177c8"],
  "tc-13-shift-and-lean-keep-gfa": ["65b73cf8dbf452e7", "390b086f8d712de2", "56ec779652e60773", "97d170e1550eee4a", "55862c32686a6c99", "7d7bad368809a37d", "938d693bacae7a7f"],
  "tc-14-two-segments": ["78c40c03600e3a44", "20a19b33c2f5f3cb", "780238029ccecad5", "97d170e1550eee4a", "f3721e38c413bc63", "38225f219745c994", "4008a3c735490022"],
  "tc-15-u-podium-gfa-floors": ["fed269fa758e7f9e", "d64212ae26222688", "4e7762477c648cec", "97d170e1550eee4a", "2db6361671b7ab5d", "25248514f5014628", "609ec51d40a11041"],
  "tc-05-crown-none": ["12d6ad2666dc4bb3", "b1b840fdf35f4edb", "97d170e1550eee4a", "97d170e1550eee4a", "a780dfd2222485a9", "81e1661fdb113d04", "69a9ed417a6cfc7a"],
  "tc-05-crown-flat": ["12d6ad2666dc4bb3", "b1b840fdf35f4edb", "d92224f4f10cd89f", "97d170e1550eee4a", "a780dfd2222485a9", "81e1661fdb113d04", "cf3bc5ce660225e8"],
  "tc-05-crown-stepped": ["12d6ad2666dc4bb3", "b1b840fdf35f4edb", "e2b3a58849412d64", "97d170e1550eee4a", "f98dbb58393b2dc7", "bdf7520b383e7792", "4cd2cc83bd45dc3f"],
  "tc-05-crown-sloped": ["12d6ad2666dc4bb3", "b1b840fdf35f4edb", "ee6ddfd567b74a61", "97d170e1550eee4a", "f98dbb58393b2dc7", "c43d755622d402fa", "1891d7ed2bb17974"],
  "tc-05-crown-spire": ["12d6ad2666dc4bb3", "b1b840fdf35f4edb", "316d5973942bdd5e", "97d170e1550eee4a", "f98dbb58393b2dc7", "19ff212798bfdbc7", "f74fe6e90902d44c"],
  "tc-05-crown-screen": ["12d6ad2666dc4bb3", "b1b840fdf35f4edb", "8c9ffb4638511b3d", "97d170e1550eee4a", "f98dbb58393b2dc7", "44cd455096967572", "d6efca8a745ef8db"],
  "tc-14-everything": ["28dd79e0b708c768", "8d9b8f20f5426f5d", "8c0f89809dfe9698", "97d170e1550eee4a", "f15a408af9c593ec", "a9e08473ed6b2c2b", "2d197142c13502fd"],
};

console.log("one tower: same output as before the multi-tower change");
for (const [id, s] of goldenStates()) {
  if (!GOLDEN[id]) continue;
  t(`golden ${id}: floors, plates, solids, warnings, metrics, derived, sketchup`, () => eq(hashes(s), GOLDEN[id]));
}
t("tower: 0 on every segment is the same as no tower key", () => {
  for (const [, s] of goldenStates()) {
    const s0 = clone(s);
    for (const g of s0.segments) g.tower = 0;
    eq(hashes(s0), hashes(s));
  }
});
t("one tower: floors and plates carry tower 0 (podium -1); crown solids carry the tower", () => {
  const s = tcase("tc-05-podium-tower-gfa");
  s.crown = { type: "stepped", height: 20, steps: 3 };
  const b = buildPlates(s);
  ok(b.plates.every((p) => (p.zone === "podium" ? p.tower === -1 : p.tower === 0)));
  ok(b.solids.length && b.solids.every((x) => x.tower === 0));
  const d = towerDerived(s, b);
  ok(d.levels.every((l) => !("tower" in l) && !("level" in l)), "a one-tower derived has no tower or level keys");
});

/* ---------- several towers ---------- */

const seg = (o = {}) => ({ floors: 10, ftf: 10, program: "residential", shape: { type: "rect", w: 100, d: 100, radius: 0, points: [] },
  offset: { x: 0, y: 0 }, rotation: 0, taper: { x: 0, y: 0, curve: "linear" }, twist: { deg: 0, start: 0, end: 1, curve: "linear" }, lean: { x: 0, y: 0 }, ...o });
const base = (segments, o = {}) => ({
  schema: 2, name: "Towers", site: { shape: "none", width: 250, depth: 200, points: [], setbacks: { front: 0, back: 0, left: 0, right: 0 }, heightLimit: 0, stepback: { on: false } },
  context: { show: false, blocks: [] },
  podium: { on: false, floors: 4, groundFtf: 18, ftf: 14, shape: { type: "rect", w: 400, d: 170 }, offset: { x: 0, y: 0 }, program: "retail", upperProgram: "amenity" },
  segments, setbacks: [], mechanical: [], carves: [], cuts: [],
  crown: { type: "flat", height: 20, steps: 3, slopeSide: "front" },
  programs: {}, targets: { gfa: 0, far: 0 }, ...o,
});
const run = (s) => { const b = buildPlates(s); const m = computeMetrics(s, b.plates); return { b, m, d: towerDerived(s, b, m) }; };
const byTower = (plates, k) => plates.filter((p) => p.tower === k);

console.log("two towers, same height");
t("one plate per tower per level; same n, z and ftf; own offset", () => {
  const { b, m, d } = run(base([seg({ offset: { x: -100, y: 0 } }), seg({ tower: 1, offset: { x: 100, y: 0 } })]));
  eq(b.plates.length, 20);
  eq(b.plates.map((p) => [p.n, p.tower]).slice(0, 4), [[1, 0], [1, 1], [2, 0], [2, 1]], "order: by level, then tower");
  for (let n = 1; n <= 10; n++) {
    const at = b.plates.filter((p) => p.n === n);
    eq(at.length, 2);
    eq(at[0].z, at[1].z); eq(at[0].ftf, at[1].ftf);
    near(at[0].z, (n - 1) * 10);
  }
  eq(byTower(b.plates, 1).map((p) => p.segmentIndex), Array(10).fill(1), "segmentIndex is the flat index");
  const xs = (p) => p.polygons[0].outer.map((q) => q[0]);
  near(Math.min(...xs(byTower(b.plates, 0)[0])), -150); near(Math.min(...xs(byTower(b.plates, 1)[0])), 50);
  near(m.gfa, 200000, 1e-6); eq(m.floorCount, 10); eq(m.levelCount, 10); near(m.totalHeight, 100); eq(m.floorsByZone.tower, 10);
  eq(d.metrics.floors, 10); eq(d.metrics.gfa, 200000); eq(d.height, 100);
  eq(d.footprint.length, 2, "two separate towers in the footprint");
});
t("derived: podium and Tower 1 keep index = n; Tower 2 ids follow; tower and level keys; names shared", () => {
  const s = base([seg({ floors: 3 }), seg({ floors: 3, tower: 1, offset: { x: 150, y: 0 } })], { podium: { ...base([]).podium, on: true, floors: 2 } });
  const { d } = run(s);
  eq(d.levels.map((l) => [l.index, l.name, l.zone, l.tower === undefined ? null : l.tower, l.level === undefined ? null : l.level]), [
    [1, "Floor 1", "podium", null, null], [2, "Floor 2", "podium", null, null],
    [3, "Floor 3", "tower", 0, 3], [4, "Floor 4", "tower", 0, 4], [5, "Floor 5", "tower", 0, 5],
    [6, "Floor 3", "tower", 1, 3], [7, "Floor 4", "tower", 1, 4], [8, "Floor 5", "tower", 1, 5],
  ]);
  const ids = d.levels.map((l) => l.index);
  eq(new Set(ids).size, ids.length, "index is unique");
  eq(d.levels[5].z, d.levels[2].z); eq(d.levels[5].ftf, d.levels[2].ftf);
  near(d.levels[2].z, 18 + 14, 1e-9, "towers stand on the podium top");
});

console.log("two towers, different heights");
t("the taller second tower goes on at Tower 1's top floor-to-floor; its own ftf is ignored", () => {
  const s = base([seg({ floors: 8, ftf: 10 }), seg({ floors: 2, ftf: 12 }), seg({ tower: 1, floors: 14, ftf: 99, offset: { x: 160, y: 0 } })]);
  const { b, m, d } = run(s);
  const t1 = byTower(b.plates, 1);
  eq(t1.length, 14);
  eq(t1.map((p) => p.z), [0, 10, 20, 30, 40, 50, 60, 70, 80, 92, 104, 116, 128, 140]);
  eq(t1.map((p) => p.ftf), [10, 10, 10, 10, 10, 10, 10, 10, 12, 12, 12, 12, 12, 12]);
  eq(t1.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  eq(byTower(b.plates, 0).length, 10);
  eq(m.floorCount, 14, "floor count = distinct levels"); eq(m.levelCount, 14);
  near(m.topOfFloors, 152); near(m.totalHeight, 152);
  near(m.gfa, 24 * 10000, 1e-6);
  eq(d.metrics.floors, 14); eq(d.height, 152);
  eq(buildFloorList(s).length, 24);
});
t("a shorter second tower stops at its own top", () => {
  const { b, m } = run(base([seg({ floors: 12 }), seg({ tower: 1, floors: 5, offset: { x: 160, y: 0 } })]));
  eq(byTower(b.plates, 1).map((p) => p.n), [1, 2, 3, 4, 5]);
  eq(m.floorCount, 12); near(m.totalHeight, 120);
});
t("towers numbered 1 and 2 only (no tower 0): the lowest index leads", () => {
  const { b, m } = run(base([seg({ tower: 2, floors: 4, ftf: 15, offset: { x: 160, y: 0 } }), seg({ tower: 1, floors: 3, ftf: 11 })]));
  eq(byTower(b.plates, 1).map((p) => p.z), [0, 11, 22]);
  eq(byTower(b.plates, 2).map((p) => p.z), [0, 11, 22, 33], "above the lead tower: the lead's top ftf");
  eq(m.floorCount, 4);
});

console.log("programs");
t("each tower keeps its own program per segment; byProgram and units sum", () => {
  const s = base([seg({ floors: 6 }), seg({ floors: 6, tower: 1, program: "office", offset: { x: 160, y: 0 } })]);
  const { b, m, d } = run(s);
  ok(byTower(b.plates, 0).every((p) => p.program === "residential"));
  ok(byTower(b.plates, 1).every((p) => p.program === "office"));
  eq(m.byProgram.residential.floors, 6); eq(m.byProgram.office.floors, 6);
  near(m.byProgram.residential.gross, 60000, 1e-6); near(m.byProgram.office.gross, 60000, 1e-6);
  eq(m.byProgram.residential.unitsWhole, Math.floor((60000 * 0.85) / 850 + 1e-9));
  eq(d.metrics.units, m.byProgram.residential.unitsWhole);
  const at3 = d.levels.filter((l) => l.level === 3);
  eq(at3.map((l) => l.program), ["residential", "office"]);
});

console.log("crown");
t("every tower gets the crown on its own top floor", () => {
  const s = base([seg({ floors: 10 }), seg({ tower: 1, floors: 15, offset: { x: 160, y: 0 } })], { crown: { type: "stepped", height: 20, steps: 2 } });
  const { b, m, d } = run(s);
  const c0 = b.solids.filter((x) => x.tower === 0), c1 = b.solids.filter((x) => x.tower === 1);
  eq(c0.length, 2); eq(c1.length, 2);
  near(Math.min(...c0.map((x) => x.z0)), 100); near(Math.min(...c1.map((x) => x.z0)), 150);
  const cx = (x) => x.polygons[0].outer.reduce((a, q) => a + q[0], 0) / x.polygons[0].outer.length;
  near(cx(c0[0]), 0, 1e-6); near(cx(c1[0]), 160, 1e-6);
  near(m.totalHeight, 170);
  const crowns = d.levels.filter((l) => l.zone === "crown");
  eq(crowns.map((l) => [l.tower, l.z, l.ftf]), [[0, 100, 20], [1, 150, 20]]);
  eq(crowns.map((l) => l.index), [31, 32], "crown ids follow the tower levels (levels 1-15, Tower 2 ids 16-30)");
  eq(d.height, 170);
});
t("flat crown: a parapet on both towers, no crown level", () => {
  const { b, d } = run(base([seg(), seg({ tower: 1, offset: { x: 160, y: 0 } })]));
  eq(b.solids.map((x) => [x.role, x.tower, x.z0]), [["parapet", 0, 100], ["parapet", 1, 100]]);
  eq(d.levels.filter((l) => l.zone === "crown").length, 0);
});
t("spire and sloped crowns on two towers", () => {
  for (const type of ["spire", "sloped", "screen"]) {
    const { b, d } = run(base([seg(), seg({ tower: 1, floors: 12, offset: { x: 160, y: 0 } })], { crown: { type, height: 30 } }));
    eq(b.solids.map((x) => x.tower), [0, 1], type);
    eq(d.levels.filter((l) => l.zone === "crown").map((l) => l.z), [100, 120], type);
  }
});

console.log("metrics with a podium");
t("GFA sums every tower; floors = podium + the tallest tower; floor 1 area is the podium", () => {
  const s = base([seg({ floors: 10 }), seg({ tower: 1, floors: 14, offset: { x: 150, y: 0 } })], { podium: { ...base([]).podium, on: true, floors: 4 } });
  const { b, m, d } = run(s);
  near(m.gfa, 4 * 400 * 170 + 24 * 10000, 1e-6);
  eq(m.floorCount, 18); eq(m.levelCount, 18);
  eq(m.floorsByZone, { podium: 4, tower: 14, mechanical: 0, crown: 0 });
  near(m.floor1Area, 400 * 170, 1e-6);
  near(byTower(b.plates, 1)[0].z, 18 + 3 * 14);
  near(m.totalHeight, 18 + 3 * 14 + 14 * 10);
  near(d.levels.filter((l) => l.zone !== "crown").reduce((a, l) => a + multiPolyArea(l.plates), 0), m.gfa, 0.1, "derived levels hold every plate");
});
t("no podium: floor 1 area sums both towers", () => {
  const { m } = run(base([seg(), seg({ tower: 1, offset: { x: 160, y: 0 } })]));
  near(m.floor1Area, 20000, 1e-6);
});

console.log("hidden features keep working");
t("carves, cuts, setbacks and mechanical floors with two towers do not throw and stay per level", () => {
  const s = base([seg({ floors: 10 }), seg({ tower: 1, floors: 12, offset: { x: 160, y: 0 } })], {
    carves: [{ kind: "full", startFloor: 5, endFloor: 5 }], cuts: [{ side: "front", depth: 10, startFloor: 2, endFloor: 4 }],
    setbacks: [{ floor: 8, distance: 10, sides: ["all"] }], mechanical: [{ afterFloor: 6, ftf: 16 }],
  });
  const { b, m } = run(s);
  const at5 = b.plates.filter((p) => p.n === 5);
  eq(at5.map((p) => [p.tower, p.void]), [[0, true], [1, true]], "a full carve voids the level in both towers");
  const mech = b.plates.filter((p) => p.zone === "mechanical");
  eq(mech.map((p) => [p.n, p.tower]), [[7, 0]], "mechanical floors belong to Tower 1");
  const t1at7 = b.plates.find((p) => p.n === 7 && p.tower === 1);
  eq(t1at7.zone, "tower", "Tower 2 has a normal floor at the mechanical level");
  eq(t1at7.ftf, 16);
  near(b.plates.find((p) => p.n === 4 && p.tower === 1).area, 100 * 90, 1e-6, "the cut is measured from Tower 2's own edge");
  near(b.plates.find((p) => p.n === 9 && p.tower === 1).area, 80 * 80, 1e-6, "setbacks apply to every tower");
  eq(m.levelCount, 12); eq(m.floorCount, 11, "12 levels (Tower 1: 10 floors + 1 mechanical; Tower 2: 12), level 5 void"); eq(m.voidFloors, 1);
});

console.log("exports");
{
  const { towerToSketchup: TS } = await import(at("src/tower/sketchup.js"));
  const { validateDoc } = await import(at("src/shared/sketchup-format.js"));
  t("SketchUp: every tower exported, one group per segment named after its tower, crowns named", () => {
    const s = base([seg({ floors: 4 }), seg({ floors: 2, program: "office" }), seg({ tower: 1, floors: 5, offset: { x: 160, y: 0 } })], { crown: { type: "stepped", height: 10, steps: 2 } });
    const b = buildPlates(s);
    const doc = TS(s, b);
    const v = validateDoc(doc);
    ok(v === true || (v && (v.ok === true || (Array.isArray(v.errors) && !v.errors.length))), `valid doc: ${JSON.stringify(v).slice(0, 200)}`);
    const names = doc.root.children.map((g) => g.name);
    eq(names, ["Tower 1 · Segment 1 · Residential", "Tower 1 · Segment 2 · Office", "Tower 2 · Segment 1 · Residential", "Crown"]);
    eq(doc.root.children.slice(0, 3).reduce((a, g) => a + g.children.length, 0), 11, "every floor of every tower");
    eq(doc.root.children[3].children.map((c) => c.name), ["Tower 1 · Crown step 1", "Tower 1 · Crown step 2", "Tower 2 · Crown step 1", "Tower 2 · Crown step 2"]);
  });
}
{
  const S = await import(at("src/tower/snap.js"));
  t("snap: tower box, tower labels, and exclude a whole tower", () => {
    const s = base([seg({ floors: 4 }), seg({ floors: 2, shape: { type: "rect", w: 60, d: 60 } }), seg({ tower: 1, floors: 5, offset: { x: 160, y: 0 } })]);
    const b = buildPlates(s);
    eq(S.itemBox(s, b.plates, { kind: "tower", index: 1 }), { minX: 110, minY: -50, maxX: 210, maxY: 50 });
    eq(S.itemBox(s, b.plates, { kind: "tower", index: 0 }), { minX: -50, minY: -50, maxX: 50, maxY: 50 });
    const all = S.collectSnapTargets(s, b.plates).lines.map((l) => l.label);
    ok(all.includes("Tower 2 segment 1 west edge") && all.includes("Tower 1 segment 2 center"));
    const ex = S.collectSnapTargets(s, b.plates, { exclude: { kind: "tower", index: 0 } }).lines;
    ok(ex.every((l) => !l.label.startsWith("Tower 1")) && ex.some((l) => l.label.startsWith("Tower 2")));
  });
}
{
  const P = await import(at("src/tower/prompts.js"));
  t("hero prompt names the towers", () => {
    const s = base([seg({ floors: 10 }), seg({ tower: 1, floors: 14, program: "hotel", offset: { x: 160, y: 0 } })], { podium: { ...base([]).podium, on: true } });
    const { m } = run(s);
    const txt = P.heroFor("tower", s, m);
    ok(/group of two towers/.test(txt) && /4-story shared podium/.test(txt), txt);
    ok(/Tower 2 is a rectangular tower with 14 floors, all hotel\./.test(txt), txt);
  });
}
{
  const V = await import(at("src/viewer/scene.js"));
  t("viewer: both towers draw, each level with its own program and a Tower row", () => {
    const s = base([seg({ floors: 3 }), seg({ tower: 1, floors: 3, program: "office", offset: { x: 160, y: 0 } })]);
    const { d } = run(s);
    const doc = { schema: 1, id: "p", name: "T", frame: { kind: "local" }, sections: {
      massing: { tool: "tower", schema: 1, updatedAt: "2026-10-29T00:00:00Z", placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: s, derived: d },
      plates: { tool: "plate", schema: 1, updatedAt: "2026-10-29T00:00:00Z", placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { levels: [{ index: 1, plate: d.levels[0].plates, units: [] }] } },
    } };
    const L = V.layersFrom(doc);
    const items = L.massing.items;
    eq(items.length, 6, "no level is covered by stale plates");
    eq(items.map((i) => i.program), ["residential", "residential", "residential", "office", "office", "office"]);
    const card = items[3].data.rows;
    eq(card[0], ["Tower", "2"]);
    eq(card[card.length - 1], ["Level", "1"]);
    const idx = V.levelsIndex(doc);
    eq(idx.length, 3, "the level list has one entry per shared level");
  });
}

{
  const C = await import(new URL("../app/core/cover.js", import.meta.url).href);
  t("cover: Plate Planner units are current for one tower, never for two", () => {
    const docOf = (s) => {
      const { d } = run(s);
      const pl = { x: 0, y: 0, rotation: 0, baseZ: 0 };
      const lv = d.levels.find((l) => l.zone === "tower");
      return { sections: { massing: { placement: pl, derived: d }, plates: { placement: pl, derived: { levels: [{ index: lv.index, z: lv.z, ftf: lv.ftf, plate: lv.plates }] } } } };
    };
    eq(C.platesCurrent(docOf(base([seg()]))), true);
    eq(C.platesCurrent(docOf(base([seg(), seg({ tower: 1, offset: { x: 160, y: 0 } })]))), false);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
