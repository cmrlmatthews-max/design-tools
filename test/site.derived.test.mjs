// Run: node test/site.derived.test.mjs
// The site section of a project file (docs/project-file-spec.md, section 6.1): src/site/derived.js.
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { makeFrame } = await import("../src/site/geo.js");
const M = await import("../src/site/model.js");
const X = await import("../src/site/exports.js");
const D = await import("../src/site/derived.js");

let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  const good = () => { pass++; console.log("  ok   " + name); };
  const bad = (e) => { fail++; console.log("  FAIL " + name + "\n       " + ((e && (e.stack || e.message)) || String(e)).split("\n").slice(0, 3).join("\n       ")); };
  try {
    const r = fn();
    if (r && typeof r.then === "function") pending.push(r.then(good, bad)); else good();     // an async test reports when it is done
  } catch (e) { bad(e); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/* ---------- a small synthetic site: 300 ft, flat ground, 3 buildings, 1 road, 1 tree, 1 water area ---------- */
const LAT = 33.927, LON = -84.339, SIZE = 300;
const frame = makeFrame(LAT, LON, SIZE);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];       // CCW
const feat = (id, type, properties, parts) => ({ id, type, properties, parts });
const P = (outer, holes = []) => ({ outer, holes });

/** DEM in meters (degrees grid, row 0 = north) for z_ft(x, y) = zOf(x, y). */
function makeDem(fr, zOf, { w = 80, h = 80, margin = 60 } = {}) {
  const bb = fr.bbox(margin), pixelW = (bb.east - bb.west) / w, pixelH = (bb.north - bb.south) / h;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const [x, y] = fr.toLocal(bb.west + (c + 0.5) * pixelW, bb.north - (r + 0.5) * pixelH);
    data[r * w + c] = zOf(x, y) * 0.3048;
  }
  return { width: w, height: h, data, west: bb.west, north: bb.north, pixelW, pixelH };
}
const flatFt = () => 1000;
const tiltFt = (x, y) => 1000 + 0.05 * x + 0.02 * y;
const ground = M.buildGround(frame, makeDem(frame, flatFt));
const tilted = M.buildGround(frame, makeDem(frame, tiltFt));

const features = {
  building: [
    feat("b-data", 3, { height: 30, "@name": "Hall" }, [P(rect(40, 40, 100, 90))]),
    feat("b-court", 3, { num_floors: 3 }, [P(rect(150, 150, 250, 250), [rect(180, 180, 220, 220).reverse()])]),    // one courtyard
    feat("b-est", 3, {}, [P([[40, 200], [90, 200], [90, 230], [60, 230], [60, 260], [40, 260]])]),                   // L shape, height estimated
  ],
  segment: [feat("r1", 2, { subtype: "road", class: "residential", "@name": "Test St" }, [[[0, 140], [150, 150], [300, 140]]]),
            feat("w1", 2, { subtype: "road", class: "footway" }, [[[20, 20], [120, 20]]])],
  land: [feat("t1", 1, { class: "tree" }, [[200, 60]])],
  water: [feat("p1", 3, { class: "pond" }, [P(rect(220, 40, 280, 100))])],
};
const build = (g, { walks = false } = {}) => ({
  frame, ground: g,
  buildings: M.buildBuildings(features, frame, g),
  roads: M.buildRoads(features, frame, g, { walks }),
  trees: M.buildTrees(features, frame, g),
  water: M.buildWater(features, frame, g),
});
const model = build(ground), modelTilted = build(tilted), modelWalks = build(ground, { walks: true });
const meta = { address: "Ravinia Dr, Dunwoody, GA", lat: LAT, lon: LON, size: SIZE, release: "2026-09-24.0", walks: false };
const derived = D.siteDerived(model, meta);

/** Every number in a JSON value, with its path. */
function* numbers(v, path = "") {
  if (typeof v === "number") yield [path, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* numbers(v[i], `${path}[${i}]`);
  else if (v && typeof v === "object") for (const k of Object.keys(v)) yield* numbers(v[k], `${path}.${k}`);
}
const decimals = (v, d) => Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-6;
const ringArea = M.ringArea;

/* ---------- shape and header ---------- */
console.log("site derived: shape");
t("the synthetic model has 3 buildings, 1 road, 1 tree, 1 water area, a 31 by 31 grid", () => {
  eq(model.buildings.length, 3); eq(model.roads.segments.length, 1); eq(model.trees.length, 1); eq(model.water.areas.length, 1);
  eq(model.ground.n, 31); eq(model.ground.spacing, 10);
});
t("keys, in the order of the spec", () => {
  eq(Object.keys(derived).join(), "address,lat,lon,size,release,boundary,ground,buildings,roads,walks,trees,water");
  eq(Object.keys(derived.ground).join(), "spacing,n,points");
  eq(Object.keys(derived.roads).join(), "segments,pavement");
  eq(Object.keys(derived.water).join(), "areas,lines");
});
t("address, center, size and release come from meta", () => {
  eq(derived.address, "Ravinia Dr, Dunwoody, GA"); eq(derived.lat, LAT); eq(derived.lon, LON); eq(derived.size, 300); eq(derived.release, "2026-09-24.0");
});
t("release is null when meta has none; lat, lon, size fall back to the frame", () => {
  const d = D.siteDerived(model, { address: "x" });
  eq(d.release, null); eq(d.lat, LAT); eq(d.lon, LON); eq(d.size, 300); eq(d.address, "x");
});
t("a missing size or center throws", () => {
  let m1 = "", m2 = "";
  try { D.siteDerived({ ...model, frame: {} }, {}); } catch (e) { m1 = e.message; }
  try { D.siteDerived({ ...model, frame: { size: 300 } }, {}); } catch (e) { m2 = e.message; }
  ok(/size/.test(m1), m1); ok(/center/.test(m2), m2);
});
t("boundary is the site square", () => {
  assert.deepStrictEqual(derived.boundary, [[0, 0], [300, 0], [300, 300], [0, 300]]);
  assert.deepStrictEqual(D.siteDerived(model, { ...meta, size: 1000 }).boundary, [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]);
});
t("the data is plain JSON: a round trip through JSON.stringify gives the same value", () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(derived)), derived);
});

/* ---------- ground ---------- */
console.log("site derived: ground");
t("ground: spacing, n and n * n points", () => {
  eq(derived.ground.spacing, 10); eq(derived.ground.n, 31); eq(derived.ground.points.length, 31 * 31);
});
t("ground: flat ground, every point at 1000 ft, 3 numbers each", () => {
  for (const p of derived.ground.points) { eq(p.length, 3); near(p[2], 1000, 0.01); }
});
t("ground: row-major from the south (x runs first, then y)", () => {
  const { n, spacing, points } = derived.ground;
  assert.deepStrictEqual(points[0].slice(0, 2), [0, 0]);
  assert.deepStrictEqual(points[1].slice(0, 2), [spacing, 0]);
  assert.deepStrictEqual(points[n - 1].slice(0, 2), [(n - 1) * spacing, 0]);
  assert.deepStrictEqual(points[n].slice(0, 2), [0, spacing]);
  assert.deepStrictEqual(points[n * n - 1].slice(0, 2), [(n - 1) * spacing, (n - 1) * spacing]);
  for (let k = 0; k < points.length; k++) { eq(points[k][0], (k % n) * spacing, `x of ${k}`); eq(points[k][1], Math.floor(k / n) * spacing, `y of ${k}`); }
});
t("ground: the z of each node is the z of the model grid (tilted ground), rounded to 0.01 ft", () => {
  const d = D.siteDerived(modelTilted, meta), g = modelTilted.ground, n = g.n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = d.ground.points[j * n + i];
    eq(p[0], g.xs[i]); eq(p[1], g.ys[j]); near(p[2], g.z[j * n + i], 0.005 + 1e-9, `z at ${i},${j}`);
    near(p[2], tiltFt(g.xs[i], g.ys[j]), 0.02, `plane at ${i},${j}`);
  }
  ok(d.ground.points[n][2] < d.ground.points[n * n - 1][2], "rises to the northeast");
});
t("ground: the same grid as the Revit CSV, row for row (to 0.01 ft)", () => {
  const d = D.siteDerived(modelTilted, meta);
  const rows = X.revitCsv(modelTilted.ground).trim().split("\n").map((r) => r.split(",").map(Number));
  eq(rows.length, d.ground.points.length);
  rows.forEach((row, k) => { for (let c = 0; c < 3; c++) near(d.ground.points[k][c], row[c], 0.0051, `row ${k} column ${c}`); });
});
t("ground: a grid with a point that has no elevation throws", () => {
  const bad = { ...model, ground: { ...model.ground, z: Float64Array.from(model.ground.z, (v, k) => (k === 5 ? NaN : v)) } };
  let msg = ""; try { D.siteDerived(bad, meta); } catch (e) { msg = e.message; }
  ok(/elevation/.test(msg), msg);
});

/* ---------- buildings ---------- */
console.log("site derived: buildings");
t("buildings: ids, rules, floors, names", () => {
  assert.deepStrictEqual(derived.buildings.map((b) => [b.id, b.rule, b.floors, b.name]),
    [["b-data", "data", 8, "Hall"], ["b-court", "floors", 3, ""], ["b-est", "estimate", 2, ""]]);
  for (const b of derived.buildings) eq(Object.keys(b).join(), "id,outer,holes,base,height,top,floors,rule,name");
});
t("buildings: outer rings run counter-clockwise, holes clockwise", () => {
  for (const b of derived.buildings) { ok(ringArea(b.outer) > 0, `${b.id} outer`); for (const h of b.holes) ok(ringArea(h) < 0, `${b.id} hole`); }
  eq(derived.buildings[1].holes.length, 1);
});
t("buildings: base on the ground, top = base + height", () => {
  for (const b of derived.buildings) { near(b.base, 1000, 0.05); near(b.top, b.base + b.height, 0.0011); }
  near(derived.buildings[0].height, 30 / 0.3048, 0.001); eq(derived.buildings[1].height, 36); eq(derived.buildings[2].height, 24);
});
t("buildings: the L shape keeps its 6 corners and the courtyard its 4 + 4", () => {
  eq(derived.buildings[2].outer.length, 6); eq(derived.buildings[1].outer.length, 4); eq(derived.buildings[1].holes[0].length, 4);
});
t("buildings: rings are cleaned (clockwise outer, repeated start, collinear point, sliver hole, sliver building)", () => {
  const messy = { ...model, buildings: [
    { id: "m1", ring: [[0, 0], [0, 50], [25, 50], [50, 50], [50, 0], [0, 0]], holes: [rect(10, 10, 20, 20), [[30, 30], [30.1, 30], [30.1, 30.1]]], base: 1000, height: 20, top: 1020, floors: 2, rule: "data", name: "" },   // CW, closing repeat, collinear (25,50), CCW hole, tiny hole
    { id: "m2", ring: [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]], holes: [], base: 1000, height: 10, top: 1010, floors: 1, rule: "data", name: "" },                                                          // 0.04 sf
  ] };
  const d = D.siteDerived(messy, meta);
  eq(d.buildings.length, 1);
  const b = d.buildings[0];
  eq(b.outer.length, 4); ok(ringArea(b.outer) > 0, "outer CCW"); near(ringArea(b.outer), 2500, 1e-9);
  eq(b.holes.length, 1); ok(ringArea(b.holes[0]) < 0, "hole CW"); near(ringArea(b.holes[0]), -100, 1e-9);
});
t("buildings: ids that repeat get a suffix and every id is unique", () => {
  const twin = { ...model, buildings: [0, 1, 2].map((k) => ({ ...model.buildings[0], id: "same", ring: rect(10 + k * 30, 10, 30 + k * 30, 30) })) };
  const d = D.siteDerived(twin, meta);
  assert.deepStrictEqual(d.buildings.map((b) => b.id), ["same", "same~2", "same~3"]);
});

console.log("removed buildings");
t("removed: the removed building has removed: true, the others have no removed key", () => {
  const d = D.siteDerived(model, { ...meta, removed: ["b-court"] });
  eq(d.buildings.length, 3, "every building stays");
  const by = Object.fromEntries(d.buildings.map((b) => [b.id, b]));
  eq(by["b-court"].removed, true);
  ok(!("removed" in by["b-data"]) && !("removed" in by["b-est"]), "no removed key on the others");
  eq(Object.keys(by["b-court"]).join(), "id,outer,holes,base,height,top,floors,rule,name,removed");
});
t("removed: no meta.removed (or an empty list) gives no removed key anywhere, the same data as before", () => {
  for (const m of [meta, { ...meta, removed: [] }, { ...meta, removed: new Set() }, { ...meta, removed: null }]) {
    const d = D.siteDerived(model, m);
    ok(d.buildings.every((b) => !("removed" in b)), "no removed key");
    eq(JSON.stringify(d), JSON.stringify(derived));
  }
});
t("removed: a Set works the same as an array; an unknown id changes nothing", () => {
  const a = D.siteDerived(model, { ...meta, removed: ["b-court", "gone-id"] }), b = D.siteDerived(model, { ...meta, removed: new Set(["b-court"]) });
  eq(JSON.stringify(a), JSON.stringify(b));
});
t("removed: every piece of a removed feature is flagged (b, b~2, b~3); uniqueIds keeps the flag", () => {
  const pieces = { ...model, buildings: [
    ...[0, 1, 2].map((k) => ({ ...model.buildings[0], id: "b", ring: rect(10 + k * 30, 10, 30 + k * 30, 30) })),
    { ...model.buildings[0], id: "bb", ring: rect(200, 10, 220, 30) },
  ] };
  const d = D.siteDerived(pieces, { ...meta, removed: ["b"] });
  assert.deepStrictEqual(d.buildings.map((x) => [x.id, x.removed === true]), [["b", true], ["b~2", true], ["b~3", true], ["bb", false]]);
  ok(!("removed" in d.buildings[3]), "bb (a longer id that starts with b) is not removed");
  const d2 = D.siteDerived(pieces, { ...meta, removed: ["b~2"] });          // a piece id removes its whole feature
  assert.deepStrictEqual(d2.buildings.map((x) => x.removed === true), [true, true, true, false]);
});
t("removed: featureId, removedSet, isRemovedId", () => {
  eq(D.featureId("b~2"), "b"); eq(D.featureId("b"), "b"); eq(D.featureId("a~b"), "a~b"); eq(D.featureId(5), "5");
  const set = D.removedSet(["b~3", "x", null, ""]);
  assert.deepStrictEqual([...set].sort(), ["b", "x"]);
  ok(D.isRemovedId("b", set) && D.isRemovedId("b~7", set) && D.isRemovedId("x", set), "matches");
  ok(!D.isRemovedId("bb", set) && !D.isRemovedId("y", set) && !D.isRemovedId("b", new Set()) && !D.isRemovedId("b", null), "no match");
  eq(D.removedSet(undefined).size, 0);
});
t("removed: the exports module uses the same id rule (removedIds, isRemovedId)", () => {
  for (const ids of [["b~3", "x"], new Set(["b"]), [], null]) {
    assert.deepStrictEqual([...X.removedIds(ids)].sort(), [...D.removedSet(ids)].sort());
    for (const id of ["b", "b~2", "x", "bb", "y"]) eq(X.isRemovedId(id, X.removedIds(ids)), D.isRemovedId(id, D.removedSet(ids)), id);
  }
});
t("removed: siteState and siteDerived agree on the same meta (what the page writes)", () => {
  const m = { ...meta, removed: new Set(["b-est", "b-court"]) };
  const st = D.siteState(m), d = D.siteDerived(model, m);
  assert.deepStrictEqual(st.removed, ["b-court", "b-est"]);
  assert.deepStrictEqual(d.buildings.filter((b) => b.removed).map((b) => b.id).sort(), st.removed);
});

/* ---------- roads, walks, trees, water ---------- */
console.log("site derived: roads, walks, trees, water");
t("roads: one segment with a draped Line3 and a counter-clockwise pavement", () => {
  const s = derived.roads.segments;
  eq(s.length, 1); eq(s[0].id, "r1"); eq(s[0].cls, "residential"); eq(s[0].name, "Test St"); eq(s[0].width, 26);
  ok(s[0].line.length > 20, "points " + s[0].line.length);
  for (const p of s[0].line) { eq(p.length, 3); near(p[2], 1000.3, 0.002); }
  ok(derived.roads.pavement.length >= 1);
  for (const q of derived.roads.pavement) { ok(ringArea(q.outer) > 0); for (const h of q.holes) ok(ringArea(h) < 0); }
});
t("walks: null without walks; a MultiPoly with walks", () => {
  eq(derived.walks, null);
  const w = D.siteDerived(modelWalks, meta).walks;
  ok(Array.isArray(w) && w.length >= 1, "walks " + JSON.stringify(w));
  ok(ringArea(w[0].outer) > 0);
  eq(D.siteDerived({ ...modelWalks, roads: { ...modelWalks.roads, walks: [] } }, meta).walks.length, 0);
});
t("trees: x, y, z, canopy, height", () => {
  eq(derived.trees.length, 1);
  assert.deepStrictEqual(Object.keys(derived.trees[0]), ["x", "y", "z", "canopy", "height"]);
  near(derived.trees[0].x, 200, 1e-3); near(derived.trees[0].y, 60, 1e-3); near(derived.trees[0].z, 1000, 0.01); eq(derived.trees[0].canopy, 20); eq(derived.trees[0].height, 30);
});
t("water: areas have ring, holes, level and cls; lines is a list", () => {
  eq(derived.water.areas.length, 1);
  const a = derived.water.areas[0];
  eq(Object.keys(a).join(), "ring,holes,level,cls");
  ok(ringArea(a.ring) > 0); near(ringArea(a.ring), 3600, 1e-6); near(a.level, 1000.2, 0.002); eq(a.cls, "pond");
  assert.deepStrictEqual(derived.water.lines, []);
});
t("water lines keep their points (Line3)", () => {
  const withStream = { ...model, water: { areas: model.water.areas, lines: [[[0, 100, 1000.2], [10, 100, 1000.2], [20, 100.0004, 1000.2], [20, 100.0004, 1000.2]], [[5, 5, 1000]]] } };
  const d = D.siteDerived(withStream, meta);
  eq(d.water.lines.length, 1); eq(d.water.lines[0].length, 3);     // a repeat point and a one-point line are dropped
});

/* ---------- numbers ---------- */
console.log("site derived: numbers");
t("every number is finite (with and without walks, flat and tilted)", () => {
  for (const d of [derived, D.siteDerived(modelWalks, meta), D.siteDerived(modelTilted, meta)]) {
    let count = 0;
    for (const [path, v] of numbers(d)) { count++; ok(Number.isFinite(v), `${path} = ${v}`); ok(!Object.is(v, -0), `${path} is -0`); }
    ok(count >= 31 * 31 * 3, "numbers " + count);
  }
});
t("coordinates are rounded to 0.001 ft, the ground to 0.01 ft", () => {
  const d = D.siteDerived(modelTilted, meta);
  for (const [path, v] of numbers(d)) {
    if (/^\.(lat|lon)$/.test(path)) continue;
    if (path.startsWith(".ground.points")) ok(decimals(v, 2), `${path} = ${v}`); else ok(decimals(v, 3), `${path} = ${v}`);
  }
});
t("the model is not changed", () => {
  const before = JSON.stringify([model.buildings, model.roads, model.trees, model.water, Array.from(model.ground.z)]);
  D.siteDerived(model, meta);
  eq(JSON.stringify([model.buildings, model.roads, model.trees, model.water, Array.from(model.ground.z)]), before);
});

/* ---------- state and size ---------- */
console.log("site state");
t("siteState: query, lat, lon, size, release, walks, removed", () => {
  const st = D.siteState({ ...meta, walks: true });
  assert.deepStrictEqual(st, { query: "Ravinia Dr, Dunwoody, GA", lat: LAT, lon: LON, size: 300, release: "2026-09-24.0", walks: true, removed: [] });
  eq(Object.keys(st).join(), "query,lat,lon,size,release,walks,removed");
});
t("siteState: walks defaults to false, release to null, removed to []", () => {
  const st = D.siteState({ address: "x", lat: 1, lon: 2, size: 500 });
  eq(st.walks, false); eq(st.release, null); eq(st.query, "x");
  assert.deepStrictEqual(st.removed, []);
  assert.deepStrictEqual(D.siteState().removed, []);
  assert.deepStrictEqual(D.siteState({ removed: null }).removed, []);
});
t("siteState: removed is the ids as strings, unique and sorted (an array or a Set)", () => {
  assert.deepStrictEqual(D.siteState({ removed: ["b-court", "x"] }).removed, ["b-court", "x"]);
  assert.deepStrictEqual(D.siteState({ removed: ["x", "b-court", "x", "", null, undefined] }).removed, ["b-court", "x"]);
  assert.deepStrictEqual(D.siteState({ removed: new Set(["z", "a~2", 7]) }).removed, ["7", "a~2", "z"]);
  const st = D.siteState({ ...meta, removed: ["b-court"] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(st)), st);
});
t("derivedBytes: the length of the JSON text in bytes (UTF-8)", () => {
  eq(D.derivedBytes(derived), Buffer.byteLength(JSON.stringify(derived)));
  eq(D.derivedBytes({ name: "é" }), Buffer.byteLength('{"name":"é"}'));
  ok(D.derivedBytes(derived) > 10000, "size " + D.derivedBytes(derived));
});

/* ---------- size of a large site (printed, not asserted) ---------- */
{
  const S3 = 3000, fr3 = makeFrame(LAT, LON, S3), g3 = M.buildGround(fr3, makeDem(fr3, tiltFt, { w: 200, h: 200, margin: 100 }));
  const trees = Array.from({ length: 3000 }, (_, k) => ({ x: (k * 37) % S3, y: (k * 91) % S3, z: g3.at((k * 37) % S3, (k * 91) % S3), canopy: 20, height: 30 }));
  const t0 = performance.now();
  const d3 = D.siteDerived({ frame: fr3, ground: g3, buildings: [], roads: { segments: [], pavement: [], walks: null }, trees, water: { areas: [], lines: [] } }, { ...meta, size: S3 });
  const ms = performance.now() - t0;
  console.log(`site derived: 3000 ft site: grid ${d3.ground.n} by ${d3.ground.n}, 3000 trees, ${(D.derivedBytes(d3) / 1024).toFixed(0)} KB, ${ms.toFixed(0)} ms`);
  t("a 3000 ft site stays under 4 MB", () => ok(D.derivedBytes(d3) < 4 * 1024 * 1024));
}

/* ---------- round trip through src/shared/project.js ---------- */
console.log("project file");
const projectUrl = new URL("../src/shared/project.js", import.meta.url);
if (!fs.existsSync(projectUrl)) console.log("  skipped  project round trip (src/shared/project.js does not exist yet)");
else {
  const PJ = await import("../src/shared/project.js");
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, keys: () => [...m.keys()] }; };
  const state = D.siteState(meta);
  const section = { tool: "site", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state, derived, note: "Ravinia Dr, Dunwoody, GA, 300 ft" };
  const siteProject = () => PJ.newProject({ name: "Ravinia test", frame: { kind: "site", lat: LAT, lon: LON, size: SIZE, zDatum: "NAVD88" } });

  t("project: newProject, writeSection(site), validate ok, getSection returns the same data", () => {
    const doc = PJ.writeSection(siteProject(), "site", section);   // writeSection returns a new document
    const v = PJ.validate(doc);
    ok(v.ok, "validate: " + (v.errors || []).join("; "));
    const sec = PJ.getSection(doc, "site");
    ok(sec, "section exists");
    eq(sec.tool, "site"); eq(sec.schema, 1);
    assert.deepStrictEqual(sec.placement, { x: 0, y: 0, rotation: 0, baseZ: 0 });
    assert.deepStrictEqual(sec.state, state);
    assert.deepStrictEqual(sec.derived, derived);
    ok(typeof sec.updatedAt === "string" && sec.updatedAt.length > 10, "updatedAt");
    eq(doc.log.length, 1); eq(doc.log[0].tool, "site"); eq(doc.log[0].action, "write"); eq(doc.log[0].note, section.note);
  });
  t("project: the section keeps its data through saveProject and loadProject", () => {
    const store = mem(), doc = PJ.writeSection(siteProject(), "site", section);
    const res = PJ.saveProject(store, doc);
    ok(res && res.ok, "save " + JSON.stringify(res));
    ok(res.bytes > D.derivedBytes(derived), "bytes " + res.bytes);
    const again = PJ.loadProject(store, doc.id);
    ok(again, "loaded");
    assert.deepStrictEqual(PJ.getSection(again, "site"), PJ.getSection(doc, "site"));
    eq(PJ.listProjects(store).length, 1); eq(PJ.listProjects(store)[0].id, doc.id);
  });
  t("project: export and import keep the section (new id on a collision)", async () => {
    const store = mem(), doc = PJ.writeSection(siteProject(), "site", section);
    PJ.saveProject(store, doc);
    const { filename, blob } = PJ.exportProject(doc);
    ok(/\.cmrlm\.json$/.test(filename), filename);
    const file = new File([await blob.text()], filename, { type: "application/json" });
    const res = await PJ.importProject(file, store);
    ok(res.doc.id !== doc.id, "new id");
    assert.deepStrictEqual(PJ.getSection(res.doc, "site").derived, derived);
  });
  t("project: a tool that sends the site gets the URL ../tower/?project=<id>", () => {
    const store = mem(), doc = PJ.writeSection(siteProject(), "site", section);
    const url = PJ.sendTo(store, doc, "tower", "site");
    eq(url, `../tower/?project=${doc.id}`);
    const stored = PJ.loadProject(store, doc.id);                    // sendTo saves a copy that carries the log entry
    eq(stored.log[stored.log.length - 1].action, "send");
    eq(doc.log[doc.log.length - 1].action, "write");                  // the caller's copy is unchanged
  });
  t("project: a site section with a newer schema makes writeSection throw and leaves the document alone", () => {
    const doc = PJ.writeSection(siteProject(), "site", { ...section, schema: 2 });
    const before = JSON.stringify(doc);
    let err = null; try { PJ.writeSection(doc, "site", section); } catch (e) { err = e; }
    ok(err, "throws");
    eq(JSON.stringify(doc), before);
    ok(err.readOnly || err.code === "readOnly" || /newer/i.test(err.message), "the error says read only: " + (err && err.message));
  });
}

await Promise.all(pending);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
