// Run: node test/tower.presets.test.mjs
// Plan test 18 (docs/tower-project-sun-plan.md section 9.1): presets at schema 2.
// Every preset has the schema 2 keys with the plan's defaults (section 2.1), and the schema 1
// geometry, programs and view are unchanged from HEAD (spot values below were read from HEAD).
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { PRESETS, PROGRAM_DEFAULTS } = await import("../src/tower/presets.js");
const { buildPlates, computeMetrics } = await import("../src/tower/geometry.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
// Order-insensitive deep equality for plain JSON-like values.
function deepEq(a, b, path = "") {
  if (typeof a !== typeof b) throw new Error(`${path}: type ${typeof a} vs ${typeof b}`);
  if (a === null || b === null || typeof a !== "object") {
    if (a !== b) throw new Error(`${path}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) throw new Error(`${path}: array mismatch`);
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka.join(",")} vs ${kb.join(",")}`);
  for (const k of kb) deepEq(a[k], b[k], `${path}.${k}`);
}
const byId = (id) => PRESETS.find((p) => p.id === id);

console.log("tower.presets.test.mjs");

// Schema 2 defaults, plan section 2.1. Written out here so the test does not import the module's own default.
const SUN_DEFAULT = {
  mode: "manual",
  place: { source: "default", lat: 33.749, lon: -84.388 },
  tz: { zone: "us-eastern", offset: -5 },
  dates: ["03-20", "06-21", "12-21"],
  date: "03-20",
  time: 720,
  times: [540, 720, 900],
  play: false,
  hours: { on: false, spacing: 10, step: 30, date: "03-20", extent: "site" },
};

// Schema 1 top-level keys (HEAD), plus the two schema 2 top-level keys.
const SCHEMA1_KEYS = ["name", "site", "context", "podium", "segments", "setbacks", "mechanical", "carves", "cuts",
  "crown", "core", "programs", "targets", "view"];
const SCHEMA2_KEYS = ["schema", "placement", "sun"];

t("five presets, ids unique and in the expected order", () => {
  eq(PRESETS.length, 5, "count");
  const ids = PRESETS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, "unique ids");
  eq(ids.join(","), "point-tower,office-slab,hotel-podium,l-multifamily-podium,u-multifamily-podium", "ids");
});

t("every preset state is schema 2", () => {
  for (const p of PRESETS) eq(p.state.schema, 2, p.id + ".schema");
});

t("every preset has the schema 2 top-level keys and keeps every schema 1 key", () => {
  for (const p of PRESETS) {
    for (const k of [...SCHEMA1_KEYS, ...SCHEMA2_KEYS]) ok(k in p.state, `${p.id} is missing ${k}`);
  }
});

t("placement is null on every preset (no project site open)", () => {
  for (const p of PRESETS) eq(p.state.placement, null, p.id + ".placement");
});

t("context: fromSite false, radius 600, show true, blocks kept from schema 1", () => {
  for (const p of PRESETS) {
    const c = p.state.context;
    eq(c.fromSite, false, p.id + ".context.fromSite");
    eq(c.radius, 600, p.id + ".context.radius");
    eq(c.show, true, p.id + ".context.show");
    deepEq(c.blocks, [{ x: 0, y: -180, w: 200, d: 120, h: 60 }], p.id + ".context.blocks");
    eq(Object.keys(c).sort().join(), "blocks,fromSite,radius,show", p.id + " context keys");
  }
});

t("sun: every preset has the plan's section 2.1 default", () => {
  for (const p of PRESETS) deepEq(p.state.sun, SUN_DEFAULT, p.id + ".sun");
});

t("sun: each preset has its own object (no shared references, edits do not leak)", () => {
  const seen = new Set();
  for (const p of PRESETS) {
    ok(!seen.has(p.state.sun), p.id + " shares a sun object");
    seen.add(p.state.sun);
    ok(!seen.has(p.state.sun.hours), p.id + " shares a sun.hours object");
    seen.add(p.state.sun.hours);
  }
  const [a, b] = PRESETS;
  a.state.sun.times.push(999);
  eq(b.state.sun.times.length, 3, "sun.times leaked between presets");
  a.state.sun.times.pop();
});

t("view.sun is unchanged (azimuth 135, altitude 40) and view keeps its schema 1 keys", () => {
  for (const p of PRESETS) {
    deepEq(p.state.view.sun, { azimuth: 135, altitude: 40 }, p.id + ".view.sun");
    eq(Object.keys(p.state.view).sort().join(), "colorBy,figure,floorLines,grid,shadows,style,sun", p.id + " view keys");
  }
});

t("PROGRAM_DEFAULTS still exports the seven programs with HEAD values", () => {
  eq(Object.keys(PROGRAM_DEFAULTS).sort().join(), "amenity,hotel,mechanical,office,parking,residential,retail", "keys");
  eq(PROGRAM_DEFAULTS.residential.ftf, 10); eq(PROGRAM_DEFAULTS.residential.unitSize, 850);
  eq(PROGRAM_DEFAULTS.office.ftf, 13.5); eq(PROGRAM_DEFAULTS.retail.ftf, 18);
  eq(PROGRAM_DEFAULTS.parking.unitFactor, 1.00); eq(PROGRAM_DEFAULTS.mechanical.color, "#e0762f");
});

// Spot values from HEAD (git show HEAD:src/tower/presets.js), schema 1 geometry.
t("geometry spot values match HEAD", () => {
  const s = (id) => byId(id).state;
  const pt = s("point-tower");
  eq(pt.site.width, 150); eq(pt.site.heightLimit, 550);
  eq(pt.podium.on, true); eq(pt.podium.floors, 2); eq(pt.podium.groundFtf, 18); eq(pt.podium.ftf, 15);
  eq(pt.segments[0].floors, 45); eq(pt.segments[0].ftf, 10); eq(pt.segments[0].shape.w, 90);
  eq(pt.segments[0].taper.x, -10);
  eq(pt.crown.type, "screen"); eq(pt.crown.height, 20);
  eq(pt.core.percent, 20);

  const of = s("office-slab");
  eq(of.site.width, 260); eq(of.site.depth, 160); eq(of.podium.on, false);
  eq(of.segments[0].floors, 32); eq(of.segments[0].ftf, 13.5); eq(of.segments[0].shape.w, 200);
  eq(of.setbacks.length, 2); eq(of.setbacks[0].floor, 20); eq(of.setbacks[1].floor, 28); eq(of.setbacks[1].distance, 10);
  eq(of.crown.type, "flat"); eq(of.crown.height, 4);

  const ht = s("hotel-podium");
  eq(ht.site.heightLimit, 350); eq(ht.podium.floors, 4); eq(ht.segments[0].floors, 24); eq(ht.segments[0].shape.d, 65);
  eq(ht.crown.type, "stepped"); eq(ht.crown.height, 15);

  const L = s("l-multifamily-podium");
  eq(L.site.heightLimit, 0); eq(L.podium.floors, 6); eq(L.podium.ftf, 10.5); eq(L.podium.upperProgram, "parking");
  eq(L.segments.length, 2); eq(L.segments[0].program, "amenity"); eq(L.segments[0].shape.type, "L");
  eq(L.segments[0].shape.arm, 65); eq(L.segments[1].floors, 16); eq(L.segments[1].program, "residential");
  eq(L.core.percent, 20);

  const U = s("u-multifamily-podium");
  eq(U.segments[0].shape.type, "U"); eq(U.segments[0].shape.arm, 50); eq(U.segments[1].shape.arm, 50);
  eq(U.core.percent, 15); eq(U.crown.height, 4);
});

// Section 8.1 table: GFA, floors, height, FAR, coverage and tower units, from buildPlates and computeMetrics.
// The "Levels written" column comes from towerDerived (phase 3), so it is not checked here.
const SECTION_8_1 = {
  "point-tower":           { gfa: 349278.8, floors: 47, height: 503,   far: 15.52, coverage: 0.444, units: 256 },
  "office-slab":           { gfa: 482800.0, floors: 32, height: 432,   far: 11.61, coverage: 0.433, units: 0 },
  "hotel-podium":          { gfa: 399200.0, floors: 28, height: 318,   far: 7.98,  coverage: 0.748, units: 399 },
  "l-multifamily-podium":  { gfa: 591875.0, floors: 23, height: 245.5, far: 10.35, coverage: 0.839, units: 228 },
  "u-multifamily-podium":  { gfa: 611000.0, floors: 23, height: 245.5, far: 10.68, coverage: 0.839, units: 258 },
};
const TOWER_PROGRAM = { "point-tower": "residential", "office-slab": "office", "hotel-podium": "hotel",
  "l-multifamily-podium": "residential", "u-multifamily-podium": "residential" };

for (const p of PRESETS) {
  const exp = SECTION_8_1[p.id];
  t(`section 8.1 metrics: ${p.id}`, () => {
    const plates = buildPlates(structuredClone(p.state)).plates;
    const m = computeMetrics(p.state, plates);
    near(m.gfa, exp.gfa, 0.1, "gfa");
    eq(m.floorCount, exp.floors, "floors");
    near(m.totalHeight, exp.height, 1e-6, "height");
    near(m.far, exp.far, 0.005, "far");
    near(m.siteCoverage, exp.coverage, 0.0005, "coverage");
    const bp = m.byProgram[TOWER_PROGRAM[p.id]];
    eq(bp ? (bp.unitsWhole || 0) : 0, exp.units, "units");
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
