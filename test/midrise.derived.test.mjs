// Run: node test/midrise.derived.test.mjs
// Plan test 15 (docs/mid-rise-generator-technical-plan.md section 9.1): preset 8.5 through midriseDerived,
// writeSection and validate; plus the SketchUp export and the seeds.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { midriseDerived, seedBlocks, levelNames } = await import("../src/midrise/derived.js");
const { midriseToSketchup } = await import("../src/midrise/sketchup.js");
const { newProject, writeSection, validate } = await import("../src/shared/project.js");
const { validateDoc, ringArea2 } = await import("../src/shared/sketchup-format.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/* ---------- preset 8.5 (wrap with five-level deck), plan section 8.5 ---------- */
const PROGRAMS = {
  residential: { ftf: 10, unitSize: 850, unitFactor: 0.85, unitWidth: 28, parkingRatio: 1.25, color: "#4f7fd1" },
  hotel: { ftf: 10, unitSize: 400, unitFactor: 0.8, unitWidth: 14, parkingRatio: 0.8, color: "#8a63c9" },
  senior: { ftf: 10, unitSize: 600, unitFactor: 0.85, unitWidth: 30, parkingRatio: 0.6, color: "#c2607a" },
  retail: { ftf: 16, unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 3, color: "#d9a22b" },
  amenity: { ftf: 12, unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 0, color: "#58a65c" },
  leasing: { ftf: 12, unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 0, color: "#7a8fa6" },
  parking: { ftf: 10.5, unitSize: 330, unitFactor: 1, unitWidth: null, parkingRatio: 0, color: "#8b929a" },
};
const bar = (id, x, y, angle, length, ends) => ({
  id, name: `Bar ${id}`, x, y, angle, length, depth: 65, floors: 5, program: "residential", groundProgram: null,
  corridor: "double", unitSide: "left", ends, bends: [], unitWidth: null,
});
function wrapState() {
  return {
    schema: 1, name: "Wrap with five-level deck", type: "wrap",
    site: { shape: "rect", width: 540, depth: 363, points: [], setbacks: { front: 25, back: 25, left: 25, right: 25 }, heightLimit: 0,
      stepback: { on: false, aboveHeight: 85, distance: 15 }, densityCap: 0, openSpaceShare: 0, separationMin: 20, courtyardMin: 40 },
    placement: null,
    context: { show: true, fromSite: false, blocks: [{ x: 0, y: -261.5, w: 200, d: 120, h: 40 }] },
    floors: { groundFtf: 12, ftf: 10 },
    bars: [
      bar("S", -225, -105, 0, 450, { start: "stair", end: "stair" }),
      bar("N", -225, 105, 0, 450, { start: "stair", end: "stair" }),
      bar("W", -192.5, -137.5, 90, 275, { start: "open", end: "open" }),
      bar("E", 192.5, -137.5, 90, 275, { start: "open", end: "open" }),
    ],
    courts: [],
    deck: { on: true, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true },
    podium: { on: false, levels: [], footprint: { mode: "offset", percent: 100, offset: 0 }, liner: { on: false, side: "front", depth: 40 } },
    surface: { count: 40, lot: [] },
    programs: PROGRAMS,
    parking: { sfPerStallSurface: 350, sfPerStallDeck: 330, retailPerThousand: 3 },
    rules: { corridorWidth: 5.67, breezewayWidth: 8, stairPer: 250, elevatorPer: 100, cornerLoss: 1 },
    roof: { type: "parapet", height: 4 },
    targets: { units: 0, density: 0 },
    view: { style: "model", colorBy: "program" },
  };
}

/** The same build as assemble would give for the wrap: hand-made, matching the contract in plan section 4. */
function fixtureBuilt(state) {
  const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];                 // CCW
  const holeRing = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];             // CW
  const barPlate = [{ outer: ring(-225, -137.5, 225, 137.5), holes: [holeRing(-160, -72.5, 160, 72.5)] }];
  const deckPlate = [{ outer: ring(-150, -62.5, 150, 62.5), holes: [] }];
  const spines = [[[-225, -105], [225, -105]], [[-225, 105], [225, 105]], [[-192.5, -137.5], [-192.5, 137.5]], [[192.5, -137.5], [192.5, 137.5]]];
  const levels = [];
  for (let i = 0; i < 5; i++) {
    levels.push({ index: i + 1, zone: "bar", z: i === 0 ? 0 : 12 + (i - 1) * 10, ftf: i === 0 ? 12 : 10, program: "residential",
      plates: barPlate, spines, joints: [], cornerZones: [], barIds: ["S", "N", "W", "E"] });
  }
  for (let i = 0; i < 5; i++) {
    levels.push({ index: 6 + i, zone: "deck", z: i * 10.5, ftf: 10.5, program: "parking", plates: deckPlate, spines: [], joints: [], cornerZones: [], barIds: [] });
  }
  return { levels, spineGraph: { nodes: [], edges: [] }, joints: [], courtyards: [{ kind: "closed", id: "H1", area: 46400, minDim: 145, ring: ring(-160, -72.5, 160, 72.5) }], separation: [], plates: [], solids: [], warnings: [] };
}

const state = wrapState();
let built, source;
try {
  const { assemble } = await import("../src/midrise/assemble.js");
  built = assemble(state);
  source = "src/midrise/assemble.js (real assemble)";
} catch (e) {
  built = fixtureBuilt(state);
  source = "hand fixture matching plan section 4 (assemble.js not available: " + String(e.code || e.message).split("\n")[0] + ")";
}
console.log("  built from: " + source);

// metrics as computeMetrics gives them for preset 8.5 (plan section 8.5); coverage = (77,350 + 37,500) / 196,020
const metrics = { gfa: 574250, far: 2.93, siteCoverage: (77350 + 37500) / 196020, floors: 5, height: 52, units: 480 };

const derived = midriseDerived(state, built, metrics);
const bySide = (zone) => derived.levels.filter((l) => l.zone === zone);

const ringOk = (r, hole = false) => Array.isArray(r) && r.length >= 3 && r.every((p) => p.length === 2 && p.every(Number.isFinite)) && (ringArea2(r) > 0) === !hole
  && !(r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]);
const allRings = (d) => {
  const out = [];
  const mp = (m, where) => m.forEach((pc, i) => { out.push([pc.outer, false, `${where}[${i}].outer`]); pc.holes.forEach((h, j) => out.push([h, true, `${where}[${i}].holes[${j}]`])); });
  mp(d.footprint, "footprint");
  d.levels.forEach((l) => { mp(l.plates, `levels[${l.index}].plates`); l.seeds.forEach((s, i) => out.push([s.outer, false, `levels[${l.index}].seeds[${i}]`])); });
  return out;
};

t("test 15: derived passes validate after writeSection", () => {
  const doc = writeSection(newProject({ name: "Wrap test" }), "massing", { tool: "midrise", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state, derived });
  const v = validate(doc);
  ok(v.ok, v.errors.join("; "));
  eq(doc.sections.massing.tool, "midrise");
  eq(doc.sections.massing.derived.levels.length, 10);
});

t("5 bar levels and 5 deck levels, in list order with the right numbers", () => {
  eq(bySide("bar").length, 5);
  eq(bySide("deck").length, 5);
  eq(derived.levels.map((l) => l.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  eq(derived.levels.map((l) => l.name), ["Floor 1", "Floor 2", "Floor 3", "Floor 4", "Floor 5", "Deck 1", "Deck 2", "Deck 3", "Deck 4", "Deck 5"]);
  eq(bySide("bar").map((l) => l.z), [0, 12, 22, 32, 42]);
  eq(bySide("deck").map((l) => l.z), [0, 10.5, 21, 31.5, 42]);
  eq(bySide("deck")[0].ftf, 10.5);
  ok(derived.levels.every((l) => l.core === null), "core must be null");
});

t("every ring is clean: CCW outers, CW holes, no repeated last point", () => {
  for (const [r, hole, where] of allRings(derived)) ok(ringOk(r, hole), `${where} is not a clean ring`);
});

t("plates: the bar plate has one hole and the right area; the deck plate is 300 x 125", () => {
  const area = (mp) => mp.reduce((s, pc) => s + ringArea2(pc.outer) + pc.holes.reduce((h, r) => h + ringArea2(r), 0), 0);
  const b = bySide("bar")[0].plates, d = bySide("deck")[0].plates;
  eq(b.length, 1); eq(b[0].holes.length, 1);
  near(area(b), 77350, 0.1);
  near(area(d), 37500, 0.1);
});

t("footprint is the union of all levels: bar ring with a hole, deck inside it as a second piece", () => {
  eq(derived.footprint.length, 2);
  const areas = derived.footprint.map((pc) => ringArea2(pc.outer) + pc.holes.reduce((h, r) => h + ringArea2(r), 0)).sort((a, b) => a - b);
  near(areas[0], 37500, 0.1); near(areas[1], 77350, 0.1);
  eq(derived.footprint.filter((pc) => pc.holes.length === 1).length, 1);
});

t("height, metrics, spines, context", () => {
  eq(derived.height, 52);
  eq(derived.metrics, { gfa: 574250, far: 2.93, siteCoverage: 0.586, floors: 5, height: 52, units: 480 });
  eq(bySide("bar")[0].spines.length, 4);
  eq(bySide("deck")[0].spines, []);
  eq(derived.context.blocks, [{ x: 0, y: -261.5, w: 200, d: 120, h: 40 }]);
});

t("metrics fall back to figures computed from built when a row is missing", () => {
  const d = midriseDerived(state, built, {});
  near(d.metrics.gfa, 574250, 1); eq(d.metrics.far, 2.93); eq(d.height, 52); eq(d.metrics.floors, 5);
  near(d.metrics.siteCoverage, 0.586, 0.001);
});

const kinds = (seeds) => seeds.reduce((o, s) => ((o[s.kind] = (o[s.kind] || 0) + 1), o), {});

t("seeds: bar levels carry 8 stairs (4 ends + 4 extras) and 5 elevators; deck levels none", () => {
  for (const l of bySide("bar")) eq(kinds(l.seeds), { stair: 8, elevator: 5 }, `level ${l.index}`);
  for (const l of bySide("deck")) eq(l.seeds, []);
});

t("seeds: stair 12 x 22 straddles the spine 6 ft in from the bar end", () => {
  const seeds = bySide("bar")[0].seeds.filter((s) => s.kind === "stair");
  // bar S starts at (-225, -105): stair spans x -225..-213, y -116..-94
  const first = seeds[0].outer, xs = first.map((p) => p[0]), ys = first.map((p) => p[1]);
  eq([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-225, -213, -116, -94]);
  // the extra stair on S sits at mid-length (x = 0)
  const mid = seeds.find((s) => Math.abs(s.outer.reduce((a, p) => a + p[0], 0) / 4) < 1e-6 && Math.abs(s.outer[0][1] + 116) < 1e-6);
  ok(mid, "extra stair at mid-length of bar S");
  // west bar runs north: extra stair at y = 0, rotated (22 wide in x, 12 tall in y)
  const w = seeds.find((s) => s.outer.every((p) => p[0] >= -203.5 && p[0] <= -181.5) && Math.abs(s.outer.reduce((a, p) => a + p[1], 0) / 4) < 1e-6);
  ok(w, "extra stair at mid-length of bar W");
});

t("seeds: elevators are 10 x 10, side by side beside the spine at mid-length of the longest bar", () => {
  const els = bySide("bar")[0].seeds.filter((s) => s.kind === "elevator");
  eq(els.length, 5);
  for (const e of els) {
    const xs = e.outer.map((p) => p[0]), ys = e.outer.map((p) => p[1]);
    near(Math.max(...xs) - Math.min(...xs), 10, 1e-6); near(Math.max(...ys) - Math.min(...ys), 10, 1e-6);
    ok(ringArea2(e.outer) > 0, "CCW");
  }
  const cx = els.map((e) => e.outer.reduce((a, p) => a + p[0], 0) / 4).sort((a, b) => a - b);
  eq(cx, [-20, -10, 0, 10, 20]);
  // unitSide left of an east-bound bar = north of the spine; first bar with the longest length is S (spine y = -105)
  const cy = els.map((e) => e.outer.reduce((a, p) => a + p[1], 0) / 4);
  ok(cy.every((y) => Math.abs(y - (-105 + 5.67 / 2 + 5)) < 1e-6), "north of the spine by half the corridor plus half the block");
});

t("seedBlocks gives the same blocks the derived levels carry", () => {
  const sb = seedBlocks(state, built, 480);
  eq(Object.keys(sb).map(Number), [1, 2, 3, 4, 5]);
  eq(sb[3], derived.levels[2].seeds);
});

t("seeds: breezeway bars get an exterior stair per module; single-loaded spine shifts to the corridor side", () => {
  const s2 = JSON.parse(JSON.stringify(state));
  s2.bars = [{ ...bar("A", -96, -120, 0, 192, { start: "open", end: "open" }), depth: 66, floors: 3, corridor: "breezeway" },
             { ...bar("B", -96, 0, 0, 100, { start: "open", end: "open" }), depth: 66, floors: 3, corridor: "single", unitSide: "left" }];
  const b2 = { levels: [{ index: 1, zone: "bar", z: 0, ftf: 10, program: "residential", plates: [{ outer: [[-96, -153], [96, -153], [96, -87], [-96, -87]], holes: [] }], spines: [], barIds: ["A", "B"] }] };
  const sb = seedBlocks(s2, b2, 0);
  const ext = sb[1].filter((s) => s.kind === "exterior-stair");
  eq(ext.length, 3);                                          // floor(192 / (2 x 28 + 8)) = 3
  const cxs = ext.map((e) => e.outer.reduce((a, p) => a + p[0], 0) / 4);
  eq(cxs, [-96 + 32, -96 + 96, -96 + 160]);                   // module 64: breezeway centre at 28 + 4 + i x 64
  const e0 = ext[0].outer, ys = e0.map((p) => p[1]);
  eq([Math.max(...ys) - Math.min(...ys), Math.max(...e0.map((p) => p[0])) - Math.min(...e0.map((p) => p[0]))], [20, 10]);
  const el = sb[1].filter((s) => s.kind === "elevator");
  ok(el.length >= 1, "at least one elevator when a bar has 3 floors");
  // bar B (single, units left = north): corridor on the south; spine y = 0 - (33 - 2.835)
  const cy = el[0].outer.reduce((a, p) => a + p[1], 0) / 4;
  near(cy, -(33 - 5.67 / 2) + (5.67 / 2 + 5), 1e-6);
});

t("an all-breezeway state has no elevators", () => {
  const s2 = JSON.parse(JSON.stringify(state));
  s2.bars = [{ ...bar("A", -96, -120, 0, 192, { start: "open", end: "open" }), corridor: "breezeway" }];
  const sb = seedBlocks(s2, { levels: [{ index: 1, zone: "bar", z: 0, ftf: 10, program: "residential", plates: [], barIds: ["A"] }] }, 100);
  ok(!sb[1].some((s) => s.kind === "elevator"));
});

t("the inputs are not mutated", () => {
  const s0 = JSON.stringify(state), b0 = JSON.stringify(built);
  midriseDerived(state, built, metrics); midriseToSketchup(state, built, metrics, {});
  eq(JSON.stringify(state), s0); eq(JSON.stringify(built), b0);
});

t("missing inputs throw a clear error", () => {
  let msg = "";
  try { midriseDerived(null, built, metrics); } catch (e) { msg = e.message; }
  ok(/state/.test(msg), msg);
  msg = "";
  try { midriseToSketchup(state, null, metrics, {}); } catch (e) { msg = e.message; }
  ok(/built/.test(msg), msg);
});

t("levelNames: podium, floors continue the count, deck restarts at 1", () => {
  eq(levelNames([{ index: 1, zone: "podium" }, { index: 2, zone: "podium" }, { index: 3, zone: "bar" }, { index: 4, zone: "deck" }, { index: 5, zone: "deck" }]),
    ["Podium 1", "Podium 2", "Floor 3", "Deck 1", "Deck 2"]);
});

/* ---------- SketchUp ---------- */
const doc = midriseToSketchup(state, built, metrics, { createdAt: "2026-10-21T00:00:00.000Z" });
const walk = (n, fn, parent = null) => { fn(n, parent); (n.children || []).forEach((c) => walk(c, fn, n)); };
const all = (type) => { const o = []; walk(doc.root, (n) => { if (n.type === type) o.push(n); }); return o; };
const group = (name) => doc.root.children.find((c) => c.name === name);

t("SketchUp: validateDoc passes", () => {
  const v = validateDoc(doc);
  ok(v.ok, v.errors.join("; "));
});

t("SketchUp: groups in order Bars, Deck, Courts, Context (no Podium when the podium is off)", () => {
  eq(doc.root.children.map((c) => c.name), ["Bars", "Deck", "Courts", "Context"]);
  eq(doc.root.name, "Wrap with five-level deck");
});

t("SketchUp: one solid per level in Bars and Deck, at the level z and ftf", () => {
  const bars = group("Bars").children, deck = group("Deck").children;
  eq(bars.map((s) => s.name), ["Floor 1", "Floor 2", "Floor 3", "Floor 4", "Floor 5"]);
  eq(deck.map((s) => s.name), ["Deck 1", "Deck 2", "Deck 3", "Deck 4", "Deck 5"]);
  ok(bars.every((s) => s.type === "solid" && s.holes.length === 1));
  eq(bars.map((s) => [s.z0, s.z1]), [[0, 12], [12, 22], [22, 32], [32, 42], [42, 52]]);
  eq(deck.map((s) => [s.z0, s.z1]), [[0, 10.5], [10.5, 21], [21, 31.5], [31.5, 42], [42, 52.5]]);
});

t("SketchUp: tags and materials by program color; Courts hidden", () => {
  const tag = (n) => doc.tags.find((x) => x.name === n), mat = (n) => doc.materials.find((x) => x.name === n);
  eq(tag("Residential").color, "#4f7fd1"); eq(mat("Residential").color, "#4f7fd1");
  eq(tag("Parking").color, "#8b929a");
  eq(tag("Courts").visible, false);
  eq(group("Courts").tag, "Courts");
  eq(group("Bars").children[0].tag, "Residential");
  eq(group("Deck").children[0].material, "Parking");
  eq(doc.source, "midrise");
});

t("SketchUp: courts are outline lines at ground level (closed courtyard from built)", () => {
  const lines = group("Courts").children[0];
  eq(lines.type, "lines");
  eq(lines.lines.length, 1);
  ok(lines.lines[0].every((p) => p.length === 3 && p[2] === 0));
  eq(lines.lines[0][0], lines.lines[0][lines.lines[0].length - 1]);
});

t("SketchUp: context block becomes a solid", () => {
  const b = group("Context").children[0];
  eq([b.z0, b.z1], [0, 40]);
  const c = midriseToSketchup({ ...state, context: { ...state.context, show: false } }, built, metrics, {});
  ok(!c.root.children.some((g) => g.name === "Context"));
});

t("SketchUp: podium, split plates, and screen", () => {
  const s2 = JSON.parse(JSON.stringify(state));
  const b2 = JSON.parse(JSON.stringify(built));
  b2.levels = [
    { index: 1, zone: "podium", z: 0, ftf: 16, program: "parking", plates: [{ outer: [[0, 0], [100, 0], [100, 50], [0, 50]], holes: [] }], spines: [], barIds: [] },
    { index: 2, zone: "bar", z: 16, ftf: 12, program: "residential", plates: [
      { outer: [[0, 0], [40, 0], [40, 40], [0, 40]], holes: [] }, { outer: [[60, 0], [100, 0], [100, 40], [60, 40]], holes: [] }], spines: [], barIds: ["S"] },
  ];
  b2.solids = [{ kind: "prism", polygons: [{ outer: [[0, 0], [40, 0], [40, 40], [0, 40]], holes: [] }], z0: 28, z1: 32, role: "screen" }];
  const d = midriseToSketchup(s2, b2, metrics, {});
  ok(validateDoc(d).ok, validateDoc(d).errors.join("; "));
  eq(d.root.children.map((c) => c.name), ["Podium", "Bars", "Courts", "Context"]);
  eq(d.root.children[0].children[0].name, "Podium 1");
  const f2 = d.root.children[1].children[0];
  eq(f2.type, "group"); eq(f2.children.map((c) => c.name), ["Floor 2 · piece 1", "Floor 2 · piece 2"]);
  eq(d.root.children[1].children[1].name, "Screen");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
