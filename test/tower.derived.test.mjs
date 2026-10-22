// Run: node test/tower.derived.test.mjs
// Plan tests 1 to 6 (docs/tower-project-sun-plan.md sections 8.1 and 9.1): every preset through towerDerived,
// the crown level, a full carve, clean rings, the project round trip, and no mutation of the inputs.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { towerDerived } = await import("../src/tower/derived.js");
const { buildPlates, computeMetrics, multiPolyArea, ringArea } = await import("../src/tower/geometry.js");
const { PRESETS } = await import("../src/tower/presets.js");
const { newProject, writeSection, getSection, validate } = await import("../src/shared/project.js");
const { cleanRing2 } = await import("../src/shared/sketchup-format.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const clone = (o) => JSON.parse(JSON.stringify(o));

const preset = (id) => clone(PRESETS.find((p) => p.id === id).state);
const run = (state) => {
  const built = buildPlates(state);
  const metrics = computeMetrics(state, built.plates);
  return { built, metrics, derived: towerDerived(state, built, metrics) };
};
const areaSum = (d) => d.levels.filter((l) => l.zone !== "crown").reduce((s, l) => s + multiPolyArea(l.plates), 0);

/* ---------- test 1: every preset (plan section 8.1) ---------- */
const TABLE = {
  "point-tower": { gfa: 349278.8, floors: 47, levels: 48, height: 503, far: 15.52, cov: 0.444, units: 256 },
  "office-slab": { gfa: 482800.0, floors: 32, levels: 32, height: 432, far: 11.61, cov: 0.433, units: 0 },
  "hotel-podium": { gfa: 399200.0, floors: 28, levels: 29, height: 318, far: 7.98, cov: 0.748, units: 399 },
  "l-multifamily-podium": { gfa: 591875.0, floors: 23, levels: 23, height: 245.5, far: 10.35, cov: 0.839, units: 228 },
  "u-multifamily-podium": { gfa: 611000.0, floors: 23, levels: 23, height: 245.5, far: 10.68, cov: 0.839, units: 258 },
};
console.log("towerDerived against the presets");
const ids = PRESETS.map((p) => p.id);
t("the five presets are the ones the table lists", () => eq(ids, Object.keys(TABLE)));
for (const [id, row] of Object.entries(TABLE)) {
  t(`${id}: GFA, floors, levels, height, FAR, coverage and units match`, () => {
    const { derived: d, metrics } = run(preset(id));
    near(d.metrics.gfa, row.gfa, 0.1, "metrics.gfa");
    near(areaSum(d), metrics.gfa, 0.1, "sum of level areas vs computeMetrics gfa");
    near(areaSum(d), row.gfa, 0.1, "sum of level areas");
    eq([d.metrics.floors, d.levels.length, d.height, d.metrics.height, d.metrics.far, d.metrics.siteCoverage, d.metrics.units],
      [row.floors, row.levels, row.height, row.height, row.far, row.cov, row.units]);
  });
}

/* ---------- test 2: the point tower crown ---------- */
console.log("the crown level");
t("point tower: crown level index 48, zone crown, z 483, ftf 20, program null, core null", () => {
  const { derived: d } = run(preset("point-tower"));
  const c = d.levels[d.levels.length - 1];
  eq([c.index, c.name, c.zone, c.z, c.ftf, c.program, c.core], [48, "Crown", "crown", 483, 20, null, null]);
  ok(c.plates.length > 0 && multiPolyArea(c.plates) > 0, "crown footprint");
  eq(d.levels[d.levels.length - 2].index, 47);
});
t("a flat crown writes no crown level; a stepped crown writes one at the top of the floors", () => {
  const office = run(preset("office-slab")).derived;
  ok(!office.levels.some((l) => l.zone === "crown"), "flat crown: no crown level");
  const hotel = run(preset("hotel-podium"));
  const c = hotel.derived.levels.at(-1);
  eq([c.zone, c.index, c.z], ["crown", 29, hotel.metrics.topOfFloors]);
  near(c.ftf, hotel.metrics.crownHeight, 1e-9);
});
t("sloped and spire crowns write a crown level with a footprint", () => {
  for (const type of ["sloped", "spire", "stepped"]) {
    const s = preset("office-slab");
    s.crown = { type, height: 24, steps: 3, slopeSide: "front" };
    const { derived: d, metrics } = run(s);
    const c = d.levels.at(-1);
    eq([c.zone, c.ftf], ["crown", 24]);
    ok(multiPolyArea(c.plates) > 0, `${type}: crown footprint`);
    near(d.height, metrics.totalHeight, 0.05, `${type}: height`);
  }
});
t("levels run in plate order with floor names, zones, z and ftf from the plates", () => {
  const { derived: d, built } = run(preset("point-tower"));
  built.plates.forEach((p, i) => {
    const l = d.levels[i];
    eq([l.index, l.name, l.zone, l.z, l.ftf], [p.n, `Floor ${p.n}`, p.zone, Math.round(p.z * 1000) / 1000, Math.round(p.ftf * 1000) / 1000]);
    eq([l.spines, l.seeds], [[], []]);
  });
  eq(d.levels.slice(0, 2).map((l) => [l.zone, l.program]), [["podium", "retail"], ["podium", "amenity"]]);
});
t("a mechanical floor keeps its index, zone mechanical and program mechanical", () => {
  const s = preset("office-slab");
  s.mechanical = [{ afterFloor: 10, ftf: 16 }];
  const { derived: d, built } = run(s);
  const mech = built.plates.find((p) => p.zone === "mechanical");
  const l = d.levels.find((x) => x.index === mech.n);
  eq([l.zone, l.program], ["mechanical", "mechanical"]);
  near(areaSum(d), computeMetrics(s, built.plates).gfa, 0.1);
});

/* ---------- test 3: a full carve ---------- */
console.log("a full carve");
t("a full carve writes plates [] and core null; its index stays and the area sum still equals GFA", () => {
  const s = preset("office-slab");
  s.carves = [{ startFloor: 10, endFloor: 11, kind: "full" }];
  const { derived: d, built, metrics } = run(s);
  const voids = built.plates.filter((p) => p.void);
  ok(voids.length === 2, `two void plates, got ${voids.length}`);
  for (const p of voids) {
    const l = d.levels.find((x) => x.index === p.n);
    ok(l, `level ${p.n} is written`);
    eq([l.plates, l.core], [[], null]);
  }
  eq(d.levels.length, built.plates.length + (metrics.crownHeight > 0 ? 1 : 0));
  near(areaSum(d), metrics.gfa, 0.1);
  eq(d.metrics.floors, metrics.floorCount);
});

/* ---------- test 4: clean rings ---------- */
console.log("rings");
function checkRings(d, label) {
  const bad = [];
  const mp = (m, where) => {
    for (const pc of m) {
      const o = cleanRing2(pc.outer);
      if (!o || JSON.stringify(o) !== JSON.stringify(pc.outer)) bad.push(`${where}: outer not clean`);
      else if (ringArea(pc.outer) <= 0) bad.push(`${where}: outer not counter-clockwise`);
      for (const h of pc.holes) {
        const c = cleanRing2(h, { hole: true });
        if (!c || JSON.stringify(c) !== JSON.stringify(h)) bad.push(`${where}: hole not clean`);
        else if (ringArea(h) >= 0) bad.push(`${where}: hole not clockwise`);
      }
    }
  };
  mp(d.footprint, `${label} footprint`);
  for (const l of d.levels) {
    mp(l.plates, `${label} level ${l.index}`);
    if (l.core) { const c = cleanRing2(l.core); if (!c || JSON.stringify(c) !== JSON.stringify(l.core)) bad.push(`${label} level ${l.index}: core not clean`); }
  }
  return bad;
}
for (const id of ids) {
  t(`${id}: every ring is clean; outers run counter-clockwise, holes clockwise`, () => {
    const bad = checkRings(run(preset(id)).derived, id);
    ok(bad.length === 0, bad.slice(0, 3).join("; "));
  });
}
t("a carved, tapered, rounded design keeps clean rings (holes included)", () => {
  const s = preset("point-tower");
  s.carves = [{ startFloor: 20, endFloor: 24, kind: "center", w: 20, d: 20 }, { startFloor: 30, endFloor: 34, kind: "corner", corner: "NE", w: 15, d: 15 }];
  s.crown = { type: "screen", height: 20, steps: 3, slopeSide: "front" };
  const { derived: d, metrics } = run(s);
  ok(d.levels.some((l) => l.plates.some((p) => p.holes.length)), "a plate with a hole");
  const bad = checkRings(d, "carved");
  ok(bad.length === 0, bad.slice(0, 3).join("; "));
  near(areaSum(d), metrics.gfa, 0.5, "rings rounded to 0.001 ft over 47 floors");
});
t("the footprint is the union of the plates: its area is at least the largest plate and at most the sum", () => {
  const { derived: d } = run(preset("hotel-podium"));
  const fp = multiPolyArea(d.footprint);
  const biggest = Math.max(...d.levels.map((l) => multiPolyArea(l.plates)));
  ok(fp >= biggest - 0.5 && fp <= areaSum(d), `footprint ${fp}`);
  const l = run(preset("l-multifamily-podium")).derived;
  ok(multiPolyArea(l.footprint) > 0 && l.footprint.length >= 1, "L footprint");
});

/* ---------- test 5: the project round trip ---------- */
console.log("project round trip");
t("writeSection(newProject(), massing, tower patch) validates and getSection returns the same derived", () => {
  const s = preset("point-tower");
  const { derived } = run(s);
  const doc = writeSection(newProject({ name: "Tower test" }), "massing", { tool: "tower", schema: 1, placement: { x: 10, y: 20, rotation: 15, baseZ: 3 }, state: s, derived });
  const v = validate(doc);
  ok(v.ok, v.errors && v.errors.join("; "));
  const sec = getSection(doc, "massing");
  eq([sec.tool, sec.schema, sec.placement], ["tower", 1, { x: 10, y: 20, rotation: 15, baseZ: 3 }]);
  eq(sec.derived, derived);
  eq(sec.state.schema, 2);
  const again = JSON.parse(JSON.stringify(doc));
  eq(getSection(again, "massing").derived, derived);
});

/* ---------- test 6: no mutation ---------- */
console.log("no mutation");
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
t("frozen state, plates and metrics pass; the inputs are unchanged", () => {
  const s = preset("hotel-podium");
  const built = buildPlates(s);
  const metrics = computeMetrics(s, built.plates);
  const before = JSON.stringify([s, built.plates, built.solids, metrics]);
  deepFreeze(s); deepFreeze(built); deepFreeze(metrics);
  const d = towerDerived(s, built, metrics);
  eq(JSON.stringify([s, built.plates, built.solids, metrics]), before);
  near(areaSum(d), metrics.gfa, 0.1);
});
t("metrics are optional: the result is the same when they are computed inside", () => {
  const s = preset("l-multifamily-podium");
  const built = buildPlates(s);
  eq(towerDerived(s, built), towerDerived(s, built, computeMetrics(s, built.plates)));
});
t("the returned context blocks are copies of the state's blocks", () => {
  const s = preset("point-tower");
  const d = towerDerived(s, buildPlates(s));
  eq(d.context.blocks, s.context.blocks);
  d.context.blocks[0].h = 1;
  ok(s.context.blocks[0].h !== 1, "state block untouched");
});
t("missing inputs throw a clear error", () => {
  let msg = "";
  try { towerDerived(null, { plates: [] }); } catch (e) { msg = e.message; }
  ok(/missing input "state"/.test(msg), msg);
});

/* ---------- Unlimited site (shape none) ---------- */
console.log("Unlimited site");
t("shape none: metrics say no site (hasSite false, FAR, coverage and area 0), no NaN, and derived validates", () => {
  const s = preset("point-tower");
  s.site.shape = "none"; s.site.heightLimit = 0;
  const { metrics, derived: d } = run(s);
  eq([metrics.hasSite, metrics.siteArea, metrics.far, metrics.siteCoverage], [false, 0, 0, 0]);
  ok(metrics.gfa > 0 && metrics.totalHeight > 0, "the building still has numbers");
  eq([d.metrics.far, d.metrics.siteCoverage], [0, 0]);
  ok(!/NaN|Infinity/.test(JSON.stringify(d)) && !/NaN|Infinity/.test(JSON.stringify(metrics)), "no NaN or Infinity");
  const doc = writeSection(newProject({ name: "No site" }), "massing", { tool: "tower", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: s, derived: d });
  const v = validate(doc);
  ok(v.ok, v.errors && v.errors.join("; "));
  eq(getSection(doc, "massing").state.site.shape, "none");
});
t("shape none: the same building on a rectangle keeps its site numbers", () => {
  const { metrics } = run(preset("point-tower"));
  eq(metrics.hasSite, true); ok(metrics.far > 15 && metrics.siteArea === 22500);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
