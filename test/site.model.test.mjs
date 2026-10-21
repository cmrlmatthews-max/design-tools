// Run: node test/site.model.test.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { makeFrame, tileToLonLat } = await import("../src/site/geo.js");
const M = await import("../src/site/model.js");
const X = await import("../src/site/exports.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/* ---------- helpers ---------- */
const polyArea = (mp) => mp.reduce((s, p) => s + Math.abs(M.ringArea(p.outer)) - p.holes.reduce((q, h) => q + Math.abs(M.ringArea(h)), 0), 0);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];       // CCW
const flatGround = { at: (x, y) => 10 + 0.01 * x, min: 10, max: 20 };
const feat = (id, type, properties, parts) => ({ id, type, properties, parts });
const P = (outer, holes = []) => ({ outer, holes });

// frame centered on a tile edge so the site spans two z14 tiles
const Z = 14, TX = 4437, TY = 6865, EXT = 65536;
const edgeLon = tileToLonLat(Z, TX + 1, TY, 0, 0, EXT)[0];
const midLat = tileToLonLat(Z, TX, TY, 0, EXT / 2, EXT)[1];
const frame = makeFrame(midLat, edgeLon, 1000);
function toTile(tile, x, y) {          // local ft → tile units (y down), rounded
  const [lon, lat] = frame.toLonLat(x, y), n = 2 ** Z;
  const s = Math.sin(lat * Math.PI / 180);
  const wx = (lon + 180) / 360 * n, wy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [Math.round((wx - tile.x) * EXT), Math.round((wy - tile.y) * EXT)];
}
const tileArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function mvtRing(tile, local, hole = false) {   // MVT winding: exterior positive y-down area
  let r = local.map((p) => toTile(tile, p[0], p[1]));
  if ((tileArea(r) > 0) === hole) r = r.reverse();
  return r;
}
const tA = { z: Z, x: TX, y: TY }, tB = { z: Z, x: TX + 1, y: TY };
const mkTile = (tile, layers) => ({ ...tile, layers });

// synthetic DEM: z_ft(x,y) = 32.8084 + 0.05 x + 0.02 y  (values in meters, degrees grid, row 0 = north)
const planeFt = (x, y) => 32.8084 + 0.05 * x + 0.02 * y;
function makeDem(fr, { w = 120, h = 120, margin = 80, hole = null } = {}) {
  const bb = fr.bbox(margin), pixelW = (bb.east - bb.west) / w, pixelH = (bb.north - bb.south) / h;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const [x, y] = fr.toLocal(bb.west + (c + 0.5) * pixelW, bb.north - (r + 0.5) * pixelH);
    data[r * w + c] = hole && hole(c, r) ? -9999 : planeFt(x, y) * 0.3048;
  }
  return { width: w, height: h, data, west: bb.west, north: bb.north, pixelW, pixelH };
}
const dem = makeDem(frame);
const ground = M.buildGround(frame, dem);

/* ---------- ground ---------- */
console.log("ground");
t("grid size 1000 ft: d = 10.5, n = 96", () => { eq(ground.n, 96); eq(ground.spacing, 10.5); eq(ground.z.length, 96 * 96); eq(ground.filled, 0); });
t("plane values exact to 0.01 ft (nodes and between nodes)", () => {
  for (let j = 0; j < ground.n; j += 7) for (let i = 0; i < ground.n; i += 5)
    near(ground.z[j * ground.n + i], planeFt(ground.xs[i], ground.ys[j]), 0.01, `node ${i},${j}`);
  for (const [x, y] of [[3.3, 7.7], [500, 500], [997, 12.1], [250.25, 801.9]]) near(ground.at(x, y), planeFt(x, y), 0.01, `at ${x},${y}`);
});
t("at() clamps outside the grid", () => { near(ground.at(-50, -50), ground.at(0, 0), 1e-9); near(ground.at(5000, 5000), ground.at(997.5, 997.5), 1e-9); });
t("min and max", () => { near(ground.min, planeFt(0, 0), 0.01); near(ground.max, planeFt(997.5, 997.5), 0.01); });
t("no-data hole is filled", () => {
  const d2 = makeDem(frame, { hole: (c, r) => c > 50 && c < 70 && r > 50 && r < 70 });
  const g = M.buildGround(frame, d2);
  ok(g.filled > 10, "filled " + g.filled);
  ok(Array.from(g.z).every(Number.isFinite), "all finite");
  for (let k = 0; k < g.z.length; k++) near(g.z[k], planeFt(g.xs[k % g.n], g.ys[Math.floor(k / g.n)]), 12, "fill near plane");
});
t("all no data throws", () => {
  const d2 = makeDem(frame, { hole: () => true });
  let msg = ""; try { M.buildGround(frame, d2); } catch (e) { msg = e.message; }
  eq(msg, "No ground data for this site");
});
t("NaN counts as no data", () => {
  const d2 = makeDem(frame); for (let r = 0; r < 120; r++) for (let c = 0; c < 20; c++) d2.data[r * 120 + c] = NaN;
  const g = M.buildGround(frame, d2); ok(Number.isFinite(g.at(0, 500)));
});

/* ---------- tiles ---------- */
console.log("tiles");
const bigRing = rect(480, 480, 520, 510);           // straddles the tile edge at x = 500; area 1200
const tiles = [
  mkTile(tA, { building: { extent: EXT, features: [
    { id: "split", type: 3, properties: { height: 10 }, geometry: [mvtRing(tA, bigRing)] },
    { id: "solo", type: 3, properties: { num_floors: 5 }, geometry: [mvtRing(tA, rect(300, 300, 340, 330))] },
    { id: "far", type: 3, properties: {}, geometry: [mvtRing(tA, rect(5000, 5000, 5040, 5030))] },
  ] } }),
  mkTile(tB, { building: { extent: EXT, features: [
    { id: "split", type: 3, properties: { height: 10 }, geometry: [mvtRing(tB, bigRing)] },
  ] } }),
];
const feats = M.featuresFromTiles(tiles, frame);
t("building split across a tile edge becomes one footprint", () => {
  const f = feats.building.filter((b) => b.id === "split");
  eq(f.length, 1); eq(f[0].parts.length, 1);
  near(polyArea(f[0].parts), 1200, 1200 * 0.02, "area");
  ok(M.ringArea(f[0].parts[0].outer) > 0, "outer CCW");
});
t("feature outside the site is dropped before clipping", () => { ok(!feats.building.some((b) => b.id === "far")); });
t("each tile alone gives only its half (clip to tile box)", () => {
  const a = M.featuresFromTiles([tiles[0]], frame).building.find((b) => b.id === "split");
  near(polyArea(a.parts), 600, 600 * 0.03, "half area");
});
t("hole in a polygon is kept and wound clockwise", () => {
  const tl = [mkTile(tA, { building: { extent: EXT, features: [{ id: "h", type: 3, properties: {}, geometry: [mvtRing(tA, rect(100, 100, 200, 200)), mvtRing(tA, rect(130, 130, 160, 160), true)] }] } })];
  const f = M.featuresFromTiles(tl, frame).building[0];
  eq(f.parts.length, 1); eq(f.parts[0].holes.length, 1);
  ok(M.ringArea(f.parts[0].holes[0]) < 0, "hole CW");
  near(polyArea(f.parts), 10000 - 900, 150, "area");
});
t("lines are clipped to the tile box and kept as separate pieces", () => {
  const ln = (tile) => [[toTile(tile, 300, 300), toTile(tile, 700, 300)]];
  const tl = [mkTile(tA, { segment: { extent: EXT, features: [{ id: "r", type: 2, properties: { subtype: "road" }, geometry: ln(tA) }] } }),
              mkTile(tB, { segment: { extent: EXT, features: [{ id: "r", type: 2, properties: { subtype: "road" }, geometry: ln(tB) }] } })];
  const f = M.featuresFromTiles(tl, frame).segment[0];
  eq(f.parts.length, 2);
  const L = f.parts.reduce((s, l) => s + Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), 0);
  near(L, 400, 2, "total length");
  for (const l of f.parts) ok(l.every((p) => p[0] <= 500.5 || p[0] >= 499.5));
});
t("points: half-open tile box removes buffer duplicates", () => {
  const pt = (tile, x, y) => [toTile(tile, x, y)];
  const tl = [mkTile(tA, { land: { extent: EXT, features: [{ id: "p1", type: 1, properties: { class: "tree" }, geometry: pt(tA, 450, 450) }, { id: "p2", type: 1, properties: { class: "tree" }, geometry: pt(tA, 520, 450) }] } }),
              mkTile(tB, { land: { extent: EXT, features: [{ id: "p2", type: 1, properties: { class: "tree" }, geometry: pt(tB, 520, 450) }] } })];
  const f = M.featuresFromTiles(tl, frame).land;
  eq(f.length, 2); eq(f.reduce((s, q) => s + q.parts.length, 0), 2);
});

/* ---------- buildings ---------- */
console.log("buildings");
const bf = {
  building: [
    feat("a", 3, { height: 10 }, [P(rect(100, 100, 140, 130))]),
    feat("b", 3, { num_floors: 5 }, [P(rect(300, 300, 340, 330))]),
    feat("c", 3, {}, [P(rect(500, 500, 540, 530))]),
    feat("d", 3, { height: 8, is_underground: true }, [P(rect(600, 600, 640, 630))]),
    feat("e", 3, { height: 8 }, [P(rect(1200, 100, 1240, 130))]),                 // centroid outside
    feat("f", 3, { height: 8, "@height_source": "ml", "@name": "Hall" }, [P(rect(980, 100, 1060, 130))]),   // centroid at x = 1020 → out
    feat("g", 3, { height: 8 }, [P(rect(960, 100, 1030, 130))]),                  // centroid 995 → in, no clipping
  ],
};
const bl = M.buildBuildings(bf, frame, ground);
t("selection by centroid, underground skipped, no clipping", () => {
  eq(bl.map((b) => b.id).join(), "a,b,c,g");
  near(Math.max(...bl.find((b) => b.id === "g").ring.map((p) => p[0])), 1030, 1e-9);
});
t("height rules: data, floors, estimate", () => {
  const a = bl.find((b) => b.id === "a"), b = bl.find((b) => b.id === "b"), c = bl.find((b) => b.id === "c");
  near(a.height, 32.8084, 1e-3); eq(a.rule, "data"); eq(a.floors, 3);
  eq(b.height, 60); eq(b.rule, "floors"); eq(b.floors, 5);
  eq(c.height, 24); eq(c.rule, "estimate"); eq(c.floors, 2);
});
t("base is the lowest ground at vertices; top = base + height", () => {
  const a = bl.find((b) => b.id === "a");
  near(a.base, planeFt(100, 100), 0.02); near(a.top, a.base + a.height, 1e-9);
});
t("rings CCW", () => { ok(bl.every((b) => M.ringArea(b.ring) > 0)); });
t("min floors 1", () => { const b = M.buildBuildings({ building: [feat("s", 3, { height: 1 }, [P(rect(10, 10, 20, 20))])] }, frame, ground)[0]; eq(b.floors, 1); });

/* ---------- roads ---------- */
console.log("roads");
const road = (id, props, line) => feat(id, 2, { subtype: "road", ...props }, [line]);
const rd = (feats_, opts) => M.buildRoads({ segment: feats_ }, frame, flatGround, opts);
t("residential 100 ft road: width 26, pavement ≈ 2600 sf", () => {
  const r = rd([road("r1", { class: "residential" }, [[200, 200], [300, 200]])]);
  eq(r.segments.length, 1); eq(r.segments[0].width, 26);
  near(polyArea(r.pavement), 2600, 26, "area");
  eq(r.walks, null);
});
t("draping: points every ≤ 10 ft at ground + 0.3", () => {
  const s = rd([road("r1", { class: "residential" }, [[200, 200], [300, 200]])]).segments[0].line;
  eq(s.length, 11);
  for (const p of s) near(p[2], flatGround.at(p[0], p[1]) + 0.3, 1e-9);
});
t("two crossing roads union (no double count)", () => {
  const r = rd([road("a", { class: "residential" }, [[200, 200], [300, 200]]), road("b", { class: "residential" }, [[250, 150], [250, 250]])]);
  near(polyArea(r.pavement), 2600 + 2600 - 26 * 26, 40);
  eq(r.pavement.length, 1);
});
t("four roads around a block keep the block as a hole", () => {
  // 200 ft square loop of 26 ft roads (centerlines 200..400). Pavement band = outer square (226 ft) − inner square (174 ft).
  const r = rd([
    road("s", { class: "residential" }, [[200, 200], [400, 200]]), road("e", { class: "residential" }, [[400, 200], [400, 400]]),
    road("n", { class: "residential" }, [[400, 400], [200, 400]]), road("w", { class: "residential" }, [[200, 400], [200, 200]]),
  ]);
  eq(r.pavement.length, 1);
  eq(r.pavement[0].holes.length, 1, "block hole");
  near(polyArea(r.pavement), 226 * 226 - 174 * 174 - 4 * 13 * 13, 5, "band area");   // butt ends leave a 13 × 13 ft notch at each outer corner
});
t("class widths", () => {
  const w = (p) => rd([road("x", p, [[100, 100], [200, 100]])]).segments[0].width;
  eq(w({ class: "motorway" }), 48); eq(w({ class: "trunk" }), 48); eq(w({ class: "primary" }), 44); eq(w({ class: "secondary" }), 36);
  eq(w({ class: "tertiary" }), 30); eq(w({ class: "living_street" }), 26); eq(w({ class: "unclassified" }), 22); eq(w({ class: "unknown" }), 22);
  eq(w({ class: "service" }), 14); eq(w({ class: "service", subclass: "alley" }), 12);
  eq(w({ class: "service", subclass: "parking_aisle" }), 20); eq(w({ class: "service", subclass: "driveway" }), 10);
  eq(w({ class: "secondary", subclass: "link" }), 16);
  eq(w({ class: "primary", road_flags: '[{"values":["is_link"]}]' }), 16);
});
t("width_rules JSON string (meters, first value)", () => {
  const r = rd([road("x", { class: "residential", width_rules: '[{"value":7.92,"between":[0.23,0.81]}]' }, [[100, 100], [200, 100]])]);
  near(r.segments[0].width, 7.92 * 3.28084, 1e-4);
});
t("tunnel covering > 50% is skipped; 30% is kept; bridge is marked", () => {
  const r = rd([
    road("t1", { class: "primary", road_flags: '[{"between":[0.1,0.7],"values":["is_tunnel"]}]' }, [[100, 100], [200, 100]]),
    road("t2", { class: "primary", road_flags: '[{"between":[0.1,0.4],"values":["is_tunnel"]}]' }, [[100, 150], [200, 150]]),
    road("t3", { class: "primary", road_flags: '[{"values":["is_tunnel"]}]' }, [[100, 180], [200, 180]]),
    road("t4", { class: "primary", road_flags: '[{"between":[0.35,0.46],"values":["is_bridge"]}]' }, [[100, 220], [200, 220]]),
  ]);
  eq(r.segments.map((s) => s.id).join(), "t2,t4"); eq(r.segments[1].bridge, true);
});
t("non-road subtype skipped; lines clipped to the square", () => {
  const r = rd([feat("rail", 2, { subtype: "rail", class: "standard_gauge" }, [[[0, 0], [100, 0]]]), road("long", { class: "residential" }, [[-500, 500], [1500, 500]])]);
  eq(r.segments.length, 1);
  const xs = r.segments[0].line.map((p) => p[0]);
  near(Math.min(...xs), 0, 1e-6); near(Math.max(...xs), 1000, 1e-6);
  ok(r.pavement.every((p) => p.outer.every((q) => q[0] >= -1e-9 && q[0] <= 1000 + 1e-9)), "pavement inside square");
});
t("walks only when requested", () => {
  const f = [road("w", { class: "footway" }, [[100, 100], [200, 100]]), road("c", { class: "cycleway" }, [[100, 200], [200, 200]])];
  const r0 = rd(f), r1 = rd(f, { walks: true });
  eq(r0.walks, null); eq(r0.segments.length, 0);
  near(polyArea(r1.walks), 100 * 5 + 100 * 8, 20); eq(r1.segments.length, 0);
});

/* ---------- trees ---------- */
console.log("trees");
t("tree points inside the square", () => {
  const tr = M.buildTrees({ land: [feat("p", 1, { class: "tree" }, [[100, 100], [2000, 2000]]), feat("q", 1, { class: "shrub" }, [[50, 50]])] }, frame, flatGround);
  eq(tr.length, 1); eq(tr[0].canopy, 20); eq(tr[0].height, 30); near(tr[0].z, flatGround.at(100, 100), 1e-9);
});
t("forest polygon: 30 ft grid inside, deterministic", () => {
  const f = { land: [feat("f", 3, { subtype: "forest", class: "wood" }, [P(rect(100, 100, 400, 400))])] };
  const a = M.buildTrees(f, frame, flatGround), b = M.buildTrees(f, frame, flatGround);
  near(a.length, 100, 30, "count"); eq(JSON.stringify(a), JSON.stringify(b));
  ok(a.every((q) => q.x >= 94 && q.x <= 406 && q.y >= 94 && q.y <= 406), "inside polygon");
  ok(a.every((q) => q.x >= 100 && q.x <= 400 && q.y >= 100 && q.y <= 400), "strictly inside");
});
t("forest with a hole keeps trees out of the hole", () => {
  const f = { land: [feat("f", 3, { subtype: "forest" }, [P(rect(100, 100, 500, 500), [rect(200, 200, 400, 400).reverse()])])] };
  const a = M.buildTrees(f, frame, flatGround);
  ok(a.length > 50 && a.every((q) => !(q.x > 200 && q.x < 400 && q.y > 200 && q.y < 400)));
});
t("total cap 3000", () => {
  const fr = makeFrame(midLat, edgeLon, 3000);
  const f = { land: [feat("f", 3, { subtype: "forest" }, [P(rect(-100, -100, 3100, 3100))]), feat("p", 1, { class: "tree" }, [[10, 10]])] };
  const a = M.buildTrees(f, fr, flatGround);
  eq(a.length, 3000);
});

/* ---------- water ---------- */
console.log("water");
t("water polygon clipped to the square, level = min ground + 0.2", () => {
  const w = M.buildWater({ water: [feat("w", 3, { class: "pond" }, [P(rect(900, 300, 1100, 400))])] }, frame, flatGround);
  eq(w.areas.length, 1);
  near(polyArea([{ outer: w.areas[0].ring, holes: w.areas[0].holes }]), 100 * 100, 1e-6);
  near(w.areas[0].level, flatGround.at(900, 300) + 0.2, 1e-9); eq(w.areas[0].cls, "pond");
});
t("water lines clipped and draped at +0.2", () => {
  const w = M.buildWater({ water: [feat("s", 2, { class: "stream" }, [[[-50, 500], [400, 500]]]), feat("x", 2, { class: "other" }, [[[0, 0], [100, 100]]])] }, frame, flatGround);
  eq(w.lines.length, 1); near(Math.min(...w.lines[0].map((p) => p[0])), 0, 1e-6);
  for (const p of w.lines[0]) near(p[2], flatGround.at(p[0], p[1]) + 0.2, 1e-9);
});

/* ---------- summarize, exports ---------- */
console.log("exports");
const fr5 = makeFrame(midLat, edgeLon, 500), dem5 = makeDem(fr5, { w: 60, h: 60 });
const g5 = M.buildGround(fr5, dem5);
const f5 = {
  building: [
    feat("a", 3, { height: 10 }, [P(rect(100, 100, 160, 140))]),
    feat("courtyard", 3, { num_floors: 4 }, [P(rect(200, 200, 320, 320), [rect(230, 230, 260, 260).reverse(), rect(280, 270, 300, 300).reverse()])]),
    feat("L", 3, {}, [P([[350, 100], [450, 100], [450, 140], [390, 140], [390, 200], [350, 200]])]),
  ],
  segment: [road("r", { class: "residential" }, [[0, 50], [250, 80], [500, 60]]), road("w", { class: "footway" }, [[50, 400], [300, 420]])],
  land: [feat("t", 1, { class: "tree" }, [[60, 300], [120, 330]]), feat("f", 3, { subtype: "forest" }, [P(rect(350, 300, 480, 450))])],
  water: [feat("w", 3, { class: "pond" }, [P(rect(100, 400, 180, 470))]), feat("s", 2, { class: "stream" }, [[[0, 250], [200, 260]]])],
};
const model = {
  frame: fr5, ground: g5,
  buildings: M.buildBuildings(f5, fr5, g5),
  roads: M.buildRoads(f5, fr5, g5, { walks: true }),
  trees: M.buildTrees(f5, fr5, g5),
  water: M.buildWater(f5, fr5, g5),
};
t("summarize", () => {
  const s = M.summarize(model);
  eq(s.buildings, 3); eq(s.estimated, 1); eq(s.waterAreas, 1); eq(s.trees, model.trees.length);
  ok(s.roadsFt > 500 && s.roadsFt < 560, "roadsFt " + s.roadsFt); near(s.groundMin, g5.min, 0); near(s.groundMax, g5.max, 0);
});
t("triangulate: areas add up (L shape, one hole, two holes)", () => {
  const cases = [
    [[[350, 100], [450, 100], [450, 140], [390, 140], [390, 200], [350, 200]], []],
    [rect(0, 0, 100, 100), [rect(30, 30, 60, 60).reverse()]],
    [rect(0, 0, 100, 100), [rect(10, 10, 30, 90).reverse(), rect(60, 20, 90, 80).reverse()]],
    [rect(200, 200, 320, 320), [rect(230, 230, 260, 260).reverse(), rect(280, 270, 300, 300).reverse()]],
  ];
  for (const [o, h] of cases) {
    const { pts, tris } = X.triangulate(o, h);
    const a = tris.reduce((s, q) => s + ((pts[q[1]][0] - pts[q[0]][0]) * (pts[q[2]][1] - pts[q[0]][1]) - (pts[q[1]][1] - pts[q[0]][1]) * (pts[q[2]][0] - pts[q[0]][0])) / 2, 0);
    const want = Math.abs(M.ringArea(o)) - h.reduce((s, r) => s + Math.abs(M.ringArea(r)), 0);
    near(a, want, 1e-6, "triangle area");
  }
});

function parseDxf(text) {
  const lines = text.split("\n"); eq(lines.pop(), "", "trailing newline");
  ok(lines.length % 2 === 0, "pairs");
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) { ok(/^ *\d{1,3}$/.test(lines[i]) && lines[i].length === 3, "code format: " + JSON.stringify(lines[i])); pairs.push([parseInt(lines[i], 10), lines[i + 1]]); }
  return pairs;
}
const dxfText = X.siteDxf(model);
const pairs = parseDxf(dxfText);
t("DXF structure: sections, EOF, layer table", () => {
  eq(pairs[0].join("|"), "0|SECTION"); eq(pairs[pairs.length - 1].join("|"), "0|EOF");
  const secs = pairs.filter((p) => p[0] === 0 && p[1] === "SECTION").length, ends = pairs.filter((p) => p[0] === 0 && p[1] === "ENDSEC").length;
  eq(secs, 3); eq(ends, 3);
  ok(pairs.some((p) => p[0] === 1 && p[1] === "AC1009"), "AC1009");
  ok(pairs.some((p) => p[0] === 9 && p[1] === "$EXTMIN") && pairs.some((p) => p[0] === 9 && p[1] === "$EXTMAX"));
  const tb = pairs.findIndex((p) => p[1] === "LAYER" && pairs[pairs.indexOf(p) - 1][1] === "TABLE");
  ok(tb > 0, "layer table");
  const layerNames = new Set(); let inTbl = false;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 2 && pairs[i][1] === "LAYER" && pairs[i - 1][1] === "TABLE") inTbl = true;
    if (inTbl && pairs[i][0] === 0 && pairs[i][1] === "ENDTAB") break;
    if (inTbl && pairs[i][0] === 0 && pairs[i][1] === "LAYER") layerNames.add(pairs[i + 1][1]);
  }
  for (const [name] of X.DXF_LAYERS) ok(layerNames.has(name), "layer " + name);
  const used = new Set(pairs.filter((p) => p[0] === 8).map((p) => p[1]));
  for (const u of used) ok(layerNames.has(u), "entity layer defined: " + u);
  for (const name of ["SITE-BOUNDARY", "TOPO-MESH", "BLDG-DATA", "BLDG-ESTIMATE", "ROAD-PAVEMENT", "WALK-PAVEMENT", "ROAD-CL", "WATER", "WATER-LINE", "TREE"]) ok(used.has(name), "has entities on " + name);
});
t("DXF polylines: every POLYLINE closes with SEQEND; polyface indices valid", () => {
  let nPoly = 0, nSeq = 0, nFace = 0, nMesh = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (!(pairs[i][0] === 0 && pairs[i][1] === "POLYLINE")) continue;
    nPoly++;
    let j = i + 1, flags = 0, nv = 0, nf = 0, verts = 0, faces = 0;
    for (; j < pairs.length && !(pairs[j][0] === 0 && (pairs[j][1] === "VERTEX" || pairs[j][1] === "SEQEND")); j++) {
      if (pairs[j][0] === 70) flags = +pairs[j][1]; if (pairs[j][0] === 71) nv = +pairs[j][1]; if (pairs[j][0] === 72) nf = +pairs[j][1];
    }
    const mesh = flags === 64; if (mesh) nMesh++;
    const idxs = [];
    while (!(pairs[j][0] === 0 && pairs[j][1] === "SEQEND")) {
      ok(pairs[j][1] === "VERTEX", "vertex expected at " + j);
      let vf = 0; const face = [], xyz = {};
      for (j++; !(pairs[j][0] === 0); j++) {
        if (pairs[j][0] === 70) vf = +pairs[j][1];
        if ([71, 72, 73, 74].includes(pairs[j][0])) face.push(+pairs[j][1]);
        if ([10, 20, 30].includes(pairs[j][0])) xyz[pairs[j][0]] = +pairs[j][1];
      }
      if (mesh && vf === 128) { faces++; idxs.push(face); ok(xyz[10] === 0 && xyz[20] === 0 && xyz[30] === 0, "face xyz zero"); }
      else { verts++; if (mesh) eq(vf, 192); else if (flags & 8) eq(vf, 32); ok(Number.isFinite(xyz[10] + xyz[20] + xyz[30]), "xyz"); }
    }
    nSeq++;
    if (mesh) { eq(verts, nv, "71"); eq(faces, nf, "72"); for (const f of idxs) { ok(f.length === 3 || f.length === 4); for (const k of f) ok(Math.abs(k) >= 1 && Math.abs(k) <= nv, "index " + k + " of " + nv); } nFace += faces; }
    else if (flags === 1) ok(verts >= 3, "closed polyline vertices");
  }
  eq(nPoly, nSeq); ok(nMesh >= 1 + 3 && nFace > 100, `meshes ${nMesh}, faces ${nFace}`);
});
t("DXF: building with holes has walls for outer and holes; tree circles radius 10", () => {
  const circles = pairs.filter((p, i) => p[0] === 0 && p[1] === "CIRCLE");
  eq(circles.length, model.trees.length); ok(model.trees.length >= 2);
  const r = pairs.filter((p, i) => p[0] === 40 && pairs.slice(0, i).reverse().find((q) => q[0] === 0)[1] === "CIRCLE").map((p) => +p[1]); ok(r.every((v) => v === 10), "radius 10");
  const courtyard = model.buildings.find((b) => b.id === "courtyard"); eq(courtyard.holes.length, 2);
  const { verts, faces } = (() => { const t2 = X.triangulate(courtyard.ring, courtyard.holes); return { verts: t2.pts, faces: t2.tris }; })();
  eq(verts.length, 4 + 8); ok(faces.length > 0);
});
t("DXF: numbers have at most 4 decimals", () => {
  for (const [c, v] of pairs) if ([10, 20, 30, 40].includes(c)) ok(/^-?\d+\.\d{1,4}$/.test(v), "number " + v);
});
t("DXF: large topo splits into bands (<= 32767 vertices each)", () => {
  const n = 200, xs = new Float64Array(n).map((_, i) => i), z = new Float64Array(n * n);
  const big = { frame: fr5, ground: { n, xs, ys: xs, z, min: 0, max: 0, spacing: 1 }, buildings: [], roads: { segments: [], pavement: [], walks: null }, trees: [], water: { areas: [], lines: [] } };
  const p2 = parseDxf(X.siteDxf(big));
  const heads = []; for (let i = 0; i < p2.length; i++) if (p2[i][0] === 71 && p2[i - 1][0] === 70 && p2[i - 1][1] === "64") heads.push(+p2[i][1]);
  ok(heads.length >= 2, "bands " + heads.length); ok(heads.every((v) => v <= 32767)); 
});
t("CSV: n² rows, 3 decimals, no header, trailing newline", () => {
  const csv = X.revitCsv(g5);
  ok(csv.endsWith("\n")); const rows = csv.slice(0, -1).split("\n");
  eq(rows.length, g5.n * g5.n); ok(rows.every((r) => /^-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{3}$/.test(r)));
  const [x, y, zz] = rows[0].split(",").map(Number); eq(x, 0); eq(y, 0); near(zz, g5.z[0], 5e-4);
  const last = rows[rows.length - 1].split(",").map(Number); near(last[0], g5.xs[g5.n - 1], 5e-4); near(last[2], g5.z[g5.z.length - 1], 5e-4);
  eq(rows[1].split(",")[0], g5.xs[1].toFixed(3));
});
t("notes: required content", () => {
  const md = X.notesMarkdown(model, { address: "123 Test St, Tampa, FL", lat: midLat, lon: edgeLon, size: 500, release: "2026-09-23.1", date: "2026-10-21" });
  for (const s of ["123 Test St, Tampa, FL", "2026-09-23.1", "2026-10-21", "500 ft", X.CREDITS, "Decimal feet", "Create from CSV", "Auto - Origin to Internal Origin", "true north", "75%", "3 ft", "12 ft", "10 ft", `${g5.n} by ${g5.n}`, "BLDG-ESTIMATE"]) ok(md.includes(s), "missing: " + s);
  ok(!/\b(don't|doesn't|isn't|can't|won't|it's)\b/i.test(md), "no contractions");
});

/* ---------- real-data smoke test (Tampa) ---------- */
console.log("real data");
const FX = "/home/claude/sqwork/fixtures";
let mvtMod = null, tiffMod = null;
if (fs.existsSync(FX)) {
  try { mvtMod = await import("../src/site/mvt.js"); tiffMod = await import("../src/site/tiff.js"); } catch (e) { mvtMod = tiffMod = null; }
}
if (!mvtMod || !tiffMod) console.log("  skip (fixtures or mvt.js/tiff.js not available)");
else t("Tampa pipeline", () => {
  const t0 = performance.now();
  const rd = (f) => new Uint8Array(fs.readFileSync(`${FX}/${f}`));
  const fr = makeFrame(27.9521769, -82.50177, 2900);
  const tl = [];
  for (const th of ["buildings", "transportation"]) for (const y of [6865, 6866]) tl.push({ z: 14, x: 4437, y, layers: mvtMod.decodeTile(rd(`${th}_14_4437_${y}.mvt`)) });
  for (const y of [3432, 3433]) tl.push({ z: 13, x: 2218, y, layers: mvtMod.decodeTile(rd(`base_13_2218_${y}.mvt`)) });
  const buf = fs.readFileSync(`${FX}/dem_tampa_300.tif`);
  const d = tiffMod.readFloatTiff(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const t1 = performance.now();
  const m = M.buildModel(fr, { dem: d, tiles: tl, walks: true });
  const t2 = performance.now();
  const s = M.summarize(m);
  const csv = X.revitCsv(m.ground), dxf = X.siteDxf(m), md = X.notesMarkdown(m, { address: "Tampa test", lat: 27.9521769, lon: -82.50177, size: 2900, release: "fixture", date: "2026-10-21" });
  const t3 = performance.now();
  console.log(`       buildings ${s.buildings} (estimated ${s.estimated}), roads ${Math.round(s.roadsFt)} ft in ${m.roads.segments.length} segs, pavement polys ${m.roads.pavement.length}, walks ${m.roads.walks.length}, trees ${s.trees}, water ${s.waterAreas} areas + ${m.water.lines.length} lines`);
  console.log(`       ground ${s.groundMin.toFixed(1)}..${s.groundMax.toFixed(1)} ft, filled ${m.ground.filled}, n ${m.ground.n}; errors ${JSON.stringify(m.errors)}`);
  console.log(`       decode ${(t1 - t0).toFixed(0)} ms, model ${(t2 - t1).toFixed(0)} ms, exports ${(t3 - t2).toFixed(0)} ms; csv ${csv.length} B, dxf ${(dxf.length / 1e6).toFixed(2)} MB, notes ${md.length} B`);
  ok(s.buildings > 200, "buildings " + s.buildings);
  ok(s.groundMin > 5 && s.groundMax < 80, "ground range");
  eq(Object.keys(m.errors).length, 0);
  parseDxf(dxf);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
