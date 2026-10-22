// Node tests for src/shared/sitelayer.js (docs/site-layer-technical-plan.md section 9.1).
// Run: node --test test/sitelayer.test.mjs   (or: node test/sitelayer.test.mjs, or: npm run test:shared)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSiteLayerData, groundZAt, groundZLocal, drapeRing, siteBounds, SITE_LAYER_VERSION,
} from "../src/shared/sitelayer.js";
import { toLocal, toProject } from "../src/shared/project.js";

const near = (a, b, tol = 1e-6, m = "") => assert.ok(Math.abs(a - b) <= tol, `${m} expected ${b}, got ${a}`);

/** A grid of n × n nodes at `spacing`, row-major from the south, first node at (x0, y0), z = f(x, y). */
function grid(n, spacing, f, x0 = 0, y0 = 0) {
  const points = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * spacing, y = y0 + j * spacing;
    points.push([x, y, f(x, y)]);
  }
  return { spacing, n, points };
}

/** Every number in a nested structure (arrays, typed arrays, objects) is finite. */
function noNaN(v, path = "data") {
  if (typeof v === "number") { assert.ok(Number.isFinite(v), `${path} is not finite: ${v}`); return; }
  if (ArrayBuffer.isView(v)) { for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) assert.fail(`${path}[${i}] is not finite`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => noNaN(x, `${path}[${i}]`)); return; }
  if (v && typeof v === "object") for (const k of Object.keys(v)) noNaN(v[k], `${path}.${k}`);
}

/** The synthetic site: 11 × 11 grid at 10 ft, z = 1000 + 0.02 x; 3 buildings (one with a hole), a road, a walk, a tree, a pond. */
function synthSite() {
  return {
    address: "Synthetic", lat: 33.9, lon: -84.3, size: 100, release: "test",
    boundary: [[0, 0], [100, 0], [100, 100], [0, 100]],
    ground: grid(11, 10, (x) => 1000 + 0.02 * x),
    buildings: [
      { id: "a", outer: [[10, 10], [30, 10], [30, 30], [10, 30]], holes: [], base: 1000.5, height: 20, top: 1020.5, floors: 2, rule: "data", name: "A" },
      { id: "court", outer: [[50, 50], [90, 50], [90, 90], [50, 90], [50, 50]], holes: [[[60, 60], [60, 80], [80, 80], [80, 60]]], base: 1001.4, height: 30, top: 1031.4, floors: 3, rule: "floors", name: "Court" },
      { id: "est", outer: [[60, 10], [80, 10], [80, 30], [60, 30]], holes: [], base: 1001.4, height: 12, top: 1013.4, floors: 1, rule: "estimate", name: "" },
    ],
    roads: {
      segments: [{ id: "r1", cls: "primary", name: "Main", width: 20, line: [[0, 40, 1000], [100, 40, 1002]] }],
      pavement: [{ outer: [[0, 35], [100, 35], [100, 45], [0, 45]], holes: [] }],
    },
    walks: [{ outer: [[0, 46], [100, 46], [100, 49], [0, 49]], holes: [] }],
    trees: [{ x: 40, y: 70, z: 1000.8, canopy: 20, height: 30 }],
    water: { areas: [{ ring: [[5, 80], [25, 80], [25, 95], [5, 95]], holes: [], level: 1000.1, cls: "pond" }], lines: [[[0, 60, 1000], [40, 60, 1000.8]]] },
  };
}

test("module version", () => {
  assert.equal(SITE_LAYER_VERSION, 1);
});

/* 9.1.1 */
test("groundZAt: bilinear on a 3 × 3 grid, clamped outside, null without a usable grid", () => {
  const sd = { ground: grid(3, 100, (x, y) => 1000 + 0.01 * x + 0.02 * y) };
  near(groundZAt(sd, 150, 50), 1002.5);
  near(groundZAt(sd, 0, 0), 1000);
  near(groundZAt(sd, 200, 200), 1006);
  near(groundZAt(sd, 100, 100), 1003);
  near(groundZAt(sd, 37.5, 162.5), 1000 + 0.375 + 3.25);
  // outside the grid: clamped to the edge
  near(groundZAt(sd, -50, 50), groundZAt(sd, 0, 50));
  near(groundZAt(sd, 500, 500), 1006);
  near(groundZAt(sd, 150, -999), groundZAt(sd, 150, 0));
  // no grid, malformed grid, bad point
  assert.equal(groundZAt(null, 1, 1), null);
  assert.equal(groundZAt({}, 1, 1), null);
  assert.equal(groundZAt({ ground: { spacing: 100, n: 3, points: sd.ground.points.slice(0, 8) } }, 1, 1), null);
  assert.equal(groundZAt({ ground: { spacing: 0, n: 3, points: sd.ground.points } }, 1, 1), null);
  assert.equal(groundZAt({ ground: { spacing: 100, n: 1, points: [[0, 0, 0]] } }, 1, 1), null);
  const bad = sd.ground.points.map((p) => p.slice());
  bad[4][2] = NaN;
  assert.equal(groundZAt({ ground: { spacing: 100, n: 3, points: bad } }, 1, 1), null);
  assert.equal(groundZAt(sd, NaN, 1), null);
});

test("groundZAt: exact on a plane at nodes and between nodes (11 × 11, z = 1000 + 0.02 x)", () => {
  const sd = synthSite();
  for (let k = 0; k < 200; k++) {
    const x = (k * 37) % 100 + (k % 7) / 7, y = (k * 53) % 100 + (k % 3) / 3;
    near(groundZAt(sd, x, y), 1000 + 0.02 * x, 1e-9, `at (${x}, ${y})`);
  }
  for (const p of sd.ground.points) near(groundZAt(sd, p[0], p[1]), p[2], 1e-12);
});

test("groundZLocal: the same point through the placement, relative to baseZ", () => {
  const sd = synthSite();
  const pl = { x: 50, y: 40, rotation: 30, baseZ: 1000.6 };
  for (const [x, y] of [[0, 0], [10, -5], [-20, 30], [33.3, 12.1]]) {
    const [xp, yp] = toProject(pl, [x, y]);
    near(groundZLocal(sd, pl, x, y), groundZAt(sd, xp, yp) - 1000.6, 1e-9);
  }
  near(groundZLocal(sd, pl, 0, 0), 1000 + 0.02 * 50 - 1000.6, 1e-9);
  assert.equal(groundZLocal({}, pl, 0, 0), null);
  assert.equal(groundZLocal(sd, pl, NaN, 0), null);
});

/* 9.1.2 */
test("buildSiteLayerData: placement {100, 50, 0, 1001} on the 3 × 3 grid", () => {
  const sd = { boundary: [[0, 0], [200, 0], [200, 200], [0, 200]], ground: grid(3, 100, (x, y) => 1000 + 0.01 * x + 0.02 * y) };
  const d = buildSiteLayerData(sd, { x: 100, y: 50, rotation: 0, baseZ: 1001 });
  assert.equal(d.ok, true);
  const g = d.ground;
  assert.equal(g.n, 3);
  assert.equal(g.spacing, 100);
  assert.equal(g.positions.length, 27);
  assert.deepEqual([...g.positions.slice(0, 3)], [-100, -50, -1]);
  // the last node (200, 200, 1006)
  assert.deepEqual([...g.positions.slice(24, 27)], [100, 150, 5]);
  assert.deepEqual(d.bounds, { minX: -100, maxX: 100, minY: -50, maxY: 150, zMin: -1, zMax: 5 });
  // shade: 0 at the lowest node (index 0), 1 at the highest (index 8)
  assert.equal(g.shade.length, 9);
  assert.equal(g.shade[0], 0);
  assert.equal(g.shade[8], 1);
  near(g.shade[4], 0.5, 1e-6);
  assert.equal(g.indices.length, 4 * 6);
  assert.ok(g.indices instanceof Uint32Array && g.positions instanceof Float32Array && g.shade instanceof Float32Array);
  assert.ok(Math.max(...g.indices) === 8);
  // first triangle of the first cell: a, b, c = (0, 0), (1, 0), (1, 1) — counter-clockwise from above
  assert.deepEqual([...g.indices.slice(0, 6)], [0, 1, 4, 0, 4, 3]);
  // skirt: 4 sides × 3 nodes × 2 vertices, 4 × 2 segments × 2 triangles, bottom 4 ft under zMin
  assert.equal(g.skirt.positions.length, 4 * 3 * 2 * 3);
  assert.equal(g.skirt.indices.length, 4 * 2 * 6);
  assert.equal(g.skirt.bottomZ, -5);
  for (let v = 1; v < 24; v += 2) assert.equal(g.skirt.positions[3 * v + 2], -5);
  assert.equal(d.counts.groundNodes, 9);
  noNaN(d);
});

test("skirt faces outward and the ground faces up", () => {
  const sd = synthSite();
  const d = buildSiteLayerData(sd, { x: 0, y: 0, rotation: 0, baseZ: 0 });
  const P = d.ground.skirt.positions, I = d.ground.skirt.indices;
  const n = d.ground.n;
  // the first triangle of each side: its normal points away from the site center (50, 50)
  const outward = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let side = 0; side < 4; side++) {
    const t = side * (n - 1) * 6;
    const v = (k) => [P[3 * I[t + k]], P[3 * I[t + k] + 1], P[3 * I[t + k] + 2]];
    const [a, b, c] = [v(0), v(1), v(2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2];
    assert.ok(nx * outward[side][0] + ny * outward[side][1] > 0, `side ${side} faces out`);
  }
  const G = d.ground.positions, GI = d.ground.indices;
  for (let t = 0; t < GI.length; t += 3) {
    const v = (k) => [G[3 * GI[t + k]], G[3 * GI[t + k] + 1]];
    const [a, b, c] = [v(0), v(1), v(2)];
    assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0, `triangle ${t / 3} faces up`);
  }
});

/* 9.1.3 */
test("rotation 90: node (300, 0) lands at local (0, -300); the building ring turns the same way", () => {
  const sd = {
    boundary: [[0, 0], [300, 0], [300, 300], [0, 300]],
    ground: grid(4, 100, () => 1000),
    buildings: [{ id: "b", outer: [[100, 0], [200, 0], [200, 50], [100, 50]], holes: [], base: 1000, height: 10, rule: "data" }],
  };
  const pl = { x: 0, y: 0, rotation: 90, baseZ: 1000 };
  const d = buildSiteLayerData(sd, pl);
  const k = 3; // node (300, 0): i = 3, j = 0
  assert.deepEqual([...d.ground.positions.slice(3 * k, 3 * k + 3)], [0, -300, 0]);
  assert.deepEqual(d.buildings[0].outer, [[0, -100], [0, -200], [50, -200], [50, -100]]);
  for (const p of d.buildings[0].outer) {
    const q = toLocal(pl, toProject(pl, p));
    near(q[0], p[0]); near(q[1], p[1]);
  }
  // flat ground: shade 0.5 everywhere (Site Model rule for less than 0.5 ft of relief)
  assert.ok([...d.ground.shade].every((v) => v === 0.5));
});

test("rotation 90 with a non-zero placement: ground, buildings, trees and the boundary agree with toLocal", () => {
  const sd = synthSite();
  const pl = { x: 50, y: 40, rotation: 90, baseZ: 1001 };
  const d = buildSiteLayerData(sd, pl);
  assert.equal(d.ok, true);
  const G = d.ground.positions;
  sd.ground.points.forEach((p, k) => {
    const q = toLocal(pl, p);
    near(G[3 * k], q[0], 1e-4); near(G[3 * k + 1], q[1], 1e-4); near(G[3 * k + 2], q[2], 1e-4);
  });
  // node (0, 0) → dx = -50, dy = -40 → local (dy, -dx) = (-40, 50)
  assert.deepEqual([...G.slice(0, 3)], [-40, 50, -1]);
  const a = d.buildings.find((b) => b.id === "a");
  assert.deepEqual(a.outer, sd.buildings[0].outer.map((p) => toLocal(pl, p).slice(0, 2).map((v) => Math.round(v * 1000) / 1000 || 0)));
  near(a.base, -0.5);
  const t = d.trees[0], tq = toLocal(pl, [40, 70]);
  near(t.x, tq[0]); near(t.y, tq[1]);
  near(t.z, 1000 + 0.02 * 40 - 1001, 1e-3);
  // the bounds are the rotated square: x from -40 to 60, y from -50 to 50
  assert.deepEqual([d.bounds.minX, d.bounds.maxX, d.bounds.minY, d.bounds.maxY], [-40, 60, -50, 50]);
  near(d.bounds.zMin, -1); near(d.bounds.zMax, 1);
  // the draped boundary sits 0.6 ft above the ground
  for (const [x, y, z] of d.boundary) near(z, groundZLocal(sd, pl, x, y) + 0.6, 2e-3);
  noNaN(d);
});

/* 9.1.4 */
test("buildings: a hole is kept, base is relative to baseZ, contextIds skip, estimate keeps its rule, no closing point", () => {
  const sd = synthSite();
  const d = buildSiteLayerData(sd, { x: 0, y: 0, rotation: 0, baseZ: 1000 });
  assert.equal(d.counts.buildings, 3);
  const court = d.buildings.find((b) => b.id === "court");
  assert.equal(court.outer.length, 4, "the repeated closing point is dropped");
  assert.equal(court.holes.length, 1);
  assert.deepEqual(court.holes[0], [[60, 60], [60, 80], [80, 80], [80, 60]]);
  near(court.base, 1.4);
  assert.equal(court.height, 30);
  assert.equal(court.name, "Court");
  assert.equal(d.buildings.find((b) => b.id === "est").rule, "estimate");
  assert.equal(d.buildings.find((b) => b.id === "a").rule, "data");
  // contextIds as a Set or an array
  const s1 = buildSiteLayerData(sd, { x: 0, y: 0, rotation: 0, baseZ: 1000 }, { contextIds: new Set(["court"]) });
  assert.deepEqual(s1.buildings.map((b) => b.id), ["a", "est"]);
  const s2 = buildSiteLayerData(sd, { x: 0, y: 0, rotation: 0, baseZ: 1000 }, { contextIds: ["a", "est"] });
  assert.deepEqual(s2.buildings.map((b) => b.id), ["court"]);
  // fewer than 3 points, a NaN point, or no outer: skipped
  const sd2 = { ...sd, buildings: [...sd.buildings, { id: "two", outer: [[0, 0], [1, 1]], base: 1000, height: 5 }, { id: "nan", outer: [[0, 0], [NaN, 1], [2, 2]], base: 1000, height: 5 }, { id: "none" }, null] };
  assert.equal(buildSiteLayerData(sd2, { baseZ: 1000 }).counts.buildings, 3);
});

test("buildings: maxBuildings keeps the nearest to the local origin, in input order", () => {
  const sd = synthSite();
  // origin at (85, 20): est (60..80, 10..30) is 5 ft away, court (50..90, 50..90) 30 ft, a (10..30) 55 ft
  const d = buildSiteLayerData(sd, { x: 85, y: 20, rotation: 0, baseZ: 1000 }, { maxBuildings: 2 });
  assert.deepEqual(d.buildings.map((b) => b.id), ["court", "est"]);
  assert.equal(buildSiteLayerData(sd, { x: 85, y: 20, rotation: 0, baseZ: 1000 }, { maxBuildings: 1 }).buildings[0].id, "est");
  assert.equal(buildSiteLayerData(sd, { x: 0, y: 0, rotation: 0, baseZ: 1000 }, { maxBuildings: 0 }).counts.buildings, 0);
});

test("buildings: a missing base sits on the ground at the footprint centroid; height from top - base", () => {
  const sd = synthSite();
  sd.buildings = [
    { id: "nobase", outer: [[40, 0], [60, 0], [60, 20], [40, 20]], height: 10 },
    { id: "top", outer: [[0, 0], [10, 0], [10, 10], [0, 10]], base: 1000, top: 1025 },
  ];
  const d = buildSiteLayerData(sd, { baseZ: 1000 });
  near(d.buildings[0].base, 1.0, 1e-3);
  assert.equal(d.buildings[1].height, 25);
  assert.equal(d.buildings[0].name, "");
});

/* 9.1.5 */
test("roads, walks, water areas, water lines and trees transform and count; water level is relative", () => {
  const sd = synthSite();
  const pl = { x: 10, y: 20, rotation: 0, baseZ: 1000 };
  const d = buildSiteLayerData(sd, pl);
  assert.deepEqual(d.counts, { buildings: 3, roads: 1, walks: 1, waterAreas: 1, trees: 1, groundNodes: 121 });
  assert.deepEqual(d.roads[0].outer, [[-10, 15], [90, 15], [90, 25], [-10, 25]]);
  assert.deepEqual(d.roads[0].holes, []);
  assert.deepEqual(d.walks[0].outer, [[-10, 26], [90, 26], [90, 29], [-10, 29]]);
  const w = d.water.areas[0];
  assert.deepEqual(w.outer, [[-5, 60], [15, 60], [15, 75], [-5, 75]]);
  near(w.level, 0.1);
  assert.deepEqual(Object.keys(w).sort(), ["holes", "level", "outer"]);
  assert.deepEqual(d.trees[0], { x: 30, y: 50, z: 0.8, canopy: 20, height: 30 });
  // the water line: open, densified every 10 ft, draped 0.4 ft above the ground
  const line = d.water.lines[0];
  assert.equal(line.length, 5);
  assert.deepEqual(line[0].slice(0, 2), [-10, 40]);
  assert.deepEqual(line[4].slice(0, 2), [30, 40]);
  for (const [x, y, z] of line) near(z, groundZLocal(sd, pl, x, y) + 0.4, 2e-3);
  // walks: null is no walks; walks may also come from roads.walks
  assert.equal(buildSiteLayerData({ ...sd, walks: null }, pl).counts.walks, 0);
  assert.equal(buildSiteLayerData({ ...sd, walks: null, roads: { ...sd.roads, walks: sd.walks } }, pl).counts.walks, 1);
  noNaN(d);
});

/* 9.1.6 */
test("drapeRing: a 200 ft square at step 50 gives 16 points, each at ground + lift", () => {
  const sd = { ground: grid(3, 100, (x, y) => 1000 + 0.01 * x + 0.02 * y) };
  const pl = { x: 0, y: 0, rotation: 0, baseZ: 1000 };
  const sq = [[0, 0], [200, 0], [200, 200], [0, 200]];
  const r = drapeRing(sd, pl, sq, 50, 0.6);
  assert.equal(r.length, 16);
  assert.deepEqual(r.slice(0, 5).map((p) => p.slice(0, 2)), [[0, 0], [50, 0], [100, 0], [150, 0], [200, 0]]);
  for (const [x, y, z] of r) near(z, 0.01 * x + 0.02 * y + 0.6, 1e-6);
  // a repeated closing point changes nothing; 3D input points are fine
  assert.deepEqual(drapeRing(sd, pl, [...sq, [0, 0]], 50, 0.6), r);
  assert.deepEqual(drapeRing(sd, pl, sq.map(([x, y]) => [x, y, 99]), 50, 0.6), r);
  // defaults: step 10, lift 0.6
  const d10 = drapeRing(sd, pl, sq);
  assert.equal(d10.length, 80);
  near(d10[0][2], 0.6);
  // open polyline (6th argument false): the last point is kept, no closing segment
  const open = drapeRing(sd, pl, [[0, 0], [100, 0]], 25, 0.4, false);
  assert.equal(open.length, 5);
  assert.deepEqual(open[4].slice(0, 2), [100, 0]);
  // through a rotated placement the z is the ground under the project point
  const pr = { x: 100, y: 100, rotation: 45, baseZ: 1001 };
  for (const [x, y, z] of drapeRing(sd, pr, [[-20, -20], [20, -20], [20, 20], [-20, 20]], 10, 1)) near(z, groundZLocal(sd, pr, x, y) + 1, 2e-3);
  // without a grid: z = 0
  assert.ok(drapeRing({}, pl, sq, 50, 0.6).every((p) => p[2] === 0));
  assert.deepEqual(drapeRing(sd, pl, null), []);
});

/* 9.1.7 */
test("no ground and a boundary: ok, ground null, boundary at z 0, a reason", () => {
  const sd = { boundary: [[0, 0], [100, 0], [100, 100], [0, 100]], buildings: [{ id: "x", outer: [[10, 10], [20, 10], [20, 20]], height: 5 }] };
  const d = buildSiteLayerData(sd, { x: 50, y: 50, rotation: 0, baseZ: 1000 });
  assert.equal(d.ok, true);
  assert.equal(d.ground, null);
  assert.equal(typeof d.reason, "string");
  assert.ok(d.boundary.length >= 4 && d.boundary.every((p) => p[2] === 0));
  assert.deepEqual(d.bounds, { minX: -50, maxX: 50, minY: -50, maxY: 50, zMin: 0, zMax: 0 });
  assert.equal(d.counts.groundNodes, 0);
  assert.equal(d.buildings[0].base, 0, "no base and no ground: base 0");
  // a malformed grid with a boundary: ground null and a reason that names the problem
  const m = buildSiteLayerData({ ...sd, ground: { spacing: 10, n: 3, points: [[0, 0, 0]] } }, { baseZ: 0 });
  assert.equal(m.ok, true);
  assert.equal(m.ground, null);
  assert.match(m.reason, /points/);
  noNaN(d); noNaN(m);
});

/* 9.1.8 */
test("nothing: ok false with a reason", () => {
  for (const sd of [null, undefined, {}, { buildings: [] }, { ground: { n: 2, spacing: 1, points: [] } }, "site"]) {
    const d = buildSiteLayerData(sd, { x: 0, y: 0, rotation: 0, baseZ: 0 });
    assert.equal(d.ok, false);
    assert.equal(typeof d.reason, "string");
    assert.equal(d.ground, null);
    assert.deepEqual(d.buildings, []);
  }
  assert.equal(buildSiteLayerData(synthSite(), null).ok, true, "a null placement is the identity");
});

/* 9.1.9 */
test("the Tower fixture (11 × 11 at 100 ft, two buildings) goes through without NaN", () => {
  const S = 1000, N = 11, SPACING = 100;
  const points = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) points.push([i * SPACING, j * SPACING, 1000 + 0.01 * i * SPACING + 0.02 * j * SPACING]);
  const derived = {
    address: "Fixture", lat: 33.927, lon: -84.339, size: S, release: "test",
    boundary: [[0, 0], [S, 0], [S, S], [0, S]], ground: { spacing: SPACING, n: N, points },
    buildings: [
      { id: "near", outer: [[480, 380], [560, 380], [560, 420], [480, 420]], holes: [], base: 1010, height: 40, top: 1050, floors: 3, rule: "data", name: "Near" },
      { id: "far", outer: [[950, 950], [990, 950], [990, 990], [950, 990]], holes: [], base: 1030, height: 30, top: 1060, floors: 2, rule: "data", name: "Far" },
    ],
    roads: { segments: [], pavement: [] }, walks: null, trees: [], water: { areas: [], lines: [] },
  };
  const pl = { x: 500, y: 500, rotation: 0, baseZ: 1015 };
  const d = buildSiteLayerData(derived, pl);
  assert.equal(d.ok, true);
  assert.equal(d.counts.buildings, 2);
  assert.equal(d.counts.groundNodes, 121);
  assert.deepEqual(d.counts, { buildings: 2, roads: 0, walks: 0, waterAreas: 0, trees: 0, groundNodes: 121 });
  near(d.buildings[0].base, -5);
  near(groundZAt(derived, 500, 500), 1015);
  noNaN(d);
  // with the near building drawn as a context block
  assert.equal(buildSiteLayerData(derived, pl, { contextIds: new Set(["near"]) }).counts.buildings, 1);
  // and turned 15 degrees
  noNaN(buildSiteLayerData(derived, { ...pl, rotation: 15 }));
});

test("siteBounds: size, boundary and center in the project frame", () => {
  assert.deepEqual(siteBounds(synthSite()), { size: 100, boundary: [[0, 0], [100, 0], [100, 100], [0, 100]], center: [50, 50] });
  assert.deepEqual(siteBounds({ size: 400 }), { size: 400, boundary: [[0, 0], [400, 0], [400, 400], [0, 400]], center: [200, 200] });
  assert.deepEqual(siteBounds({ ground: grid(3, 50, () => 0, 10, 20) }), { size: 100, boundary: [[10, 20], [110, 20], [110, 120], [10, 120]], center: [60, 70] });
  assert.deepEqual(siteBounds({ boundary: [[0, 0], [300, 0], [300, 100], [0, 100], [0, 0]] }).size, 300);
  assert.equal(siteBounds(null), null);
  assert.equal(siteBounds({}), null);
});

test("inputs are not changed", () => {
  const sd = synthSite();
  const before = JSON.stringify(sd);
  buildSiteLayerData(sd, { x: 12, y: 34, rotation: 33, baseZ: 1000 }, { contextIds: new Set(["a"]) });
  drapeRing(sd, { x: 1, y: 2, rotation: 3, baseZ: 4 }, sd.boundary);
  siteBounds(sd);
  assert.equal(JSON.stringify(sd), before);
});

test("performance: a 101 × 101 grid builds in under 50 ms", () => {
  const sd = { ...synthSite(), size: 1000, boundary: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], ground: grid(101, 10, (x, y) => 1000 + 0.02 * x + 3 * Math.sin(y / 70)) };
  const pl = { x: 480, y: 510, rotation: 17, baseZ: 1010 };
  buildSiteLayerData(sd, { ...pl, rotation: 0 });   // warm up (JIT); a fresh grid object below is validated again
  const sd2 = { ...sd, ground: { ...sd.ground, points: sd.ground.points.slice() } };
  const t0 = performance.now();
  const d = buildSiteLayerData(sd2, pl);
  const ms = performance.now() - t0;
  assert.equal(d.counts.groundNodes, 10201);
  assert.equal(d.ground.indices.length, 100 * 100 * 6);
  assert.equal(d.ground.skirt.indices.length, 4 * 100 * 6);
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
  noNaN(d.ground);
});
