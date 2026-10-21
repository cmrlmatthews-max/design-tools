// Regenerates the small fixtures used by importer_test.rb. Run: node test/sketchup/make_fixtures.mjs
// The fixtures are committed; you only need this when the file format changes.
import { makeDoc, validateDoc, cleanRing2, cleanRing3 } from "../../src/shared/sketchup-format.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const out = fileURLToPath(new URL("./fixtures/", import.meta.url));
const sq = (x, y, w, h) => cleanRing2([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const hole = (x, y, w, h) => cleanRing2([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { hole: true });
const solid = (name, outer, holes, z0, z1, extra = {}) => ({ type: "solid", name, outer, holes, z0, z1, ...extra });

// ---- tower: 3 floors (one with a courtyard hole), crown mesh, context block
const tags = [
  { name: "Residential", color: "#4f7fd1", visible: true },
  { name: "Retail", color: "#d1a24f", visible: true },
  { name: "Crown", color: "#b0b0b0", visible: true },
  { name: "Context", color: "#888888", visible: true },
];
const mats = [
  { name: "Residential", color: "#4f7fd1", alpha: 1 },
  { name: "Retail", color: "#d1a24f", alpha: 1 },
  { name: "Context", color: "#cccccc", alpha: 0.5 },
];
const tower = makeDoc({
  source: "tower", name: "Option A", createdAt: "2026-10-21T16:05:00Z", location: null, zShift: 0,
  notes: ["Plan origin = tool origin."], tags, materials: mats,
  root: { type: "group", name: "Option A", children: [
    { type: "group", name: "Podium", children: [
      { type: "group", name: "Floor 1", tag: "Retail", material: "Retail", attributes: { floor: 1, program: "Retail", area_sf: 6000 }, children: [
        solid("Floor 1 piece 1", sq(0, 0, 100, 60), [hole(40, 20, 20, 20)], 0, 15),
      ] },
    ] },
    { type: "group", name: "Segment 1 · Residential", children: [
      solid("Floor 2", sq(0, 0, 100, 60), [], 15, 25.5, { tag: "Residential", material: "Residential", attributes: { floor: 2, program: "Residential", area_sf: 6000 } }),
      solid("Floor 3", sq(0, 0, 100, 60), [], 25.5, 36, { tag: "Residential", material: "Residential", attributes: { floor: 3, program: "Residential", area_sf: 6000 } }),
    ] },
    { type: "mesh", name: "Crown", tag: "Crown", soft: false, closed: true,
      vertices: [[0, 0, 36], [100, 0, 36], [100, 60, 36], [0, 60, 36], [50, 30, 60]],
      triangles: [[0, 2, 1], [0, 3, 2], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] },
    { type: "group", name: "Context", tag: "Context", material: "Context", children: [
      solid("Block 1", sq(-150, 0, 80, 50), [], 0, 40),
    ] },
  ] },
});
let v = validateDoc(tower); if (!v.ok) { console.error(v.errors); process.exit(1); }
fs.writeFileSync(out + "tower-small.sketchup.json", JSON.stringify(tower, null, 1));

// ---- site: 4x4 ground grid (3x3 cells = 18 triangles), building with hole, roads draped, water, lines
const N = 4, step = 50;
const verts = [], tris = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) verts.push([i * step, j * step, Math.round((10 + i * 2 + j) * 1000) / 1000]);
for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
  const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
  // mixed windings on purpose: first cell is clockwise from above so the importer must flip it
  if (i === 0 && j === 0) tris.push([a, c, b], [b, c, d]); else tris.push([a, b, d], [a, d, c]);
}
const z = (x, y) => 10 + (x / step) * 2 + (y / step);
const tri3 = (pts) => cleanRing3(pts.map(([x, y]) => [x, y, z(x, y) + 0.1]));
const stags = [
  { name: "Ground", color: "#8a9a6a", visible: true },
  { name: "Buildings", color: "#9aa3ad", visible: true },
  { name: "Roads", color: "#555555", visible: true },
  { name: "Road centerlines", color: "#ffd400", visible: false },
  { name: "Water", color: "#3a7bd5", visible: true },
  { name: "Site boundary", color: "#ff0000", visible: true },
];
const smats = [
  { name: "Ground", color: "#7d8f5c", alpha: 1 },
  { name: "Building", color: "#c8c8c8", alpha: 1 },
  { name: "Pavement", color: "#444444", alpha: 1 },
  { name: "Water", color: "#3a7bd5", alpha: 0.85 },
];
const roadPiece = tri3([[10, 70], [60, 70], [60, 80], [10, 80]]);
const site = makeDoc({
  source: "site", name: "Site at 1 Test Way", createdAt: "2026-10-21T17:00:00Z",
  location: { lat: 33.92, lon: -84.34 }, zShift: -12.5,
  notes: ["Plan origin = SW corner of the site.", "SketchUp: add 12.5 ft to return to NAVD88"],
  tags: stags, materials: smats,
  root: { type: "group", name: "Site at 1 Test Way", children: [
    { type: "mesh", name: "Ground", tag: "Ground", material: "Ground", soft: true, closed: false, vertices: verts, triangles: tris },
    { type: "group", name: "Buildings", tag: "Buildings", material: "Building", children: [
      solid("Building 0001 (estimated)", sq(20, 20, 30, 30), [hole(30, 30, 10, 10)], 14, 44, { attributes: { height_ft: 30, height_source: "estimated", overture_id: "abc-123" } }),
    ] },
    { type: "group", name: "Roads", tag: "Roads", material: "Pavement", children: [
      { type: "faces", name: "Main St", polygons: [{ outer: roadPiece, holes: [] }] },
    ] },
    { type: "lines", name: "Road centerlines", tag: "Road centerlines", lines: [[[10, 75, z(10, 75) + 0.15], [60, 75, z(60, 75) + 0.15]]] },
    { type: "group", name: "Water", tag: "Water", material: "Water", children: [
      { type: "faces", name: "Pond", polygons: [{ outer: cleanRing3([[100, 100, 20], [130, 100, 20], [130, 130, 20], [100, 130, 20]]), holes: [] }] },
    ] },
    { type: "lines", name: "Site boundary", tag: "Site boundary", lines: [[[0, 0, 10.2], [150, 0, 10.2], [150, 150, 10.2], [0, 150, 10.2], [0, 0, 10.2]]] },
  ] },
});
v = validateDoc(site); if (!v.ok) { console.error(v.errors); process.exit(1); }
fs.writeFileSync(out + "site-small.sketchup.json", JSON.stringify(site, null, 1));
console.log("ok", JSON.stringify(validateDoc(tower).counts), JSON.stringify(validateDoc(site).counts), tris.length);
// bad files
const bad = (n, o) => fs.writeFileSync(out + n, typeof o === "string" ? o : JSON.stringify(o));
bad("bad-format.sketchup.json", { ...tower, format: "something-else" });
bad("bad-version.sketchup.json", { ...tower, version: 2 });
bad("bad-units.sketchup.json", { ...tower, units: "meters" });
bad("bad-json.sketchup.json", '{ "format": "cmrlm-design-tools/sketchup", "version": 1, ');
const noroot = { ...tower }; delete noroot.root; bad("missing-root.sketchup.json", noroot);
bad("bad-tag-ref.sketchup.json", { ...tower, root: { type: "group", name: "X", children: [solid("S", sq(0,0,10,10), [], 0, 5, { tag: "Nope" })] } });
