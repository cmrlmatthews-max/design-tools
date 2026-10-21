// Node tests for src/shared/sketchup-format.js. Run: node test/sketchup-format.test.mjs
import { cleanRing2, cleanRing3, ringArea2, makeDoc, validateDoc, sketchupFilename, FORMAT, VERSION } from "../src/shared/sketchup-format.js";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  ", name); } catch (e) { fail++; console.log("  FAIL", name, "-", e.message); } };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || "expected true"); };

const sqCW = [[0, 0], [0, 10], [10, 10], [10, 0]];

t("ringArea2 sign", () => { eq(ringArea2([[0, 0], [10, 0], [10, 10], [0, 10]]), 100); eq(ringArea2(sqCW), -100); });
t("cleanRing2 makes outer CCW", () => ok(ringArea2(cleanRing2(sqCW)) > 0));
t("cleanRing2 makes hole CW", () => ok(ringArea2(cleanRing2([[0, 0], [10, 0], [10, 10], [0, 10]], { hole: true })) < 0));
t("cleanRing2 drops closing point and near-duplicates", () => eq(cleanRing2([[0, 0], [10, 0], [10, 0.001], [10, 10], [0, 10], [0, 0]]).length, 4));
t("cleanRing2 drops collinear points", () => eq(cleanRing2([[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]]).length, 4));
t("cleanRing2 rejects tiny and degenerate rings", () => { eq(cleanRing2([[0, 0], [0.1, 0], [0.1, 0.1]]), null); eq(cleanRing2([[0, 0], [1, 1]]), null); eq(cleanRing2([[0, 0], [5, 0], [10, 0]]), null); });
t("cleanRing2 rounds to 0.001", () => eq(cleanRing2([[0.00049, 0], [10, 0], [10, 10]])[0][0], 0));
t("cleanRing3 keeps z and orients in plan", () => { const r = cleanRing3([[0, 0, 5], [0, 10, 6], [10, 10, 6], [10, 0, 5]]); ok(ringArea2(r) > 0); eq(r[0].length, 3); });
t("cleanRing3 drops collinear 3D points only when truly collinear", () => { eq(cleanRing3([[0, 0, 0], [5, 0, 1], [10, 0, 2], [10, 10, 2], [0, 10, 0]]).length, 4); eq(cleanRing3([[0, 0, 0], [5, 0, 3], [10, 0, 0], [10, 10, 0], [0, 10, 0]]).length, 5); });

const goodDoc = () => makeDoc({
  source: "tower", name: "Option A",
  tags: [{ name: "Residential", color: "#4f7fd1", visible: true }],
  materials: [{ name: "Residential", color: "#4f7fd1", alpha: 1 }],
  root: { type: "group", name: "Option A", children: [
    { type: "solid", name: "Floor 1", tag: "Residential", material: "Residential", outer: cleanRing2(sqCW), holes: [], z0: 0, z1: 10 },
    { type: "mesh", name: "Ground", vertices: [[0, 0, 0], [10, 0, 0], [0, 10, 1]], triangles: [[0, 1, 2]], soft: true, closed: false },
    { type: "faces", name: "Road", polygons: [{ outer: cleanRing3([[0, 0, 0.1], [10, 0, 0.1], [10, 10, 0.1], [0, 10, 0.1]]), holes: [] }] },
    { type: "lines", name: "Centerline", lines: [[[0, 0, 0], [10, 10, 0]]] },
  ] },
});
t("makeDoc fills header", () => { const d = goodDoc(); eq([d.format, d.version, d.units, d.zShift, d.location], [FORMAT, VERSION, "feet", 0, null]); });
t("validateDoc accepts a good document", () => { const r = validateDoc(goodDoc()); ok(r.ok, r.errors.join("; ")); eq(r.counts, { group: 1, solid: 1, mesh: 1, faces: 1, lines: 1 }); });
t("validateDoc catches unknown tag, bad z, bad orientation, bad triangle", () => {
  const d = goodDoc();
  d.root.children[0].tag = "Nope";
  d.root.children[0].z1 = 0;
  d.root.children[0].outer = sqCW;
  d.root.children[1].triangles = [[0, 1, 5]];
  const r = validateDoc(d);
  ok(!r.ok);
  ok(r.errors.some((e) => e.includes("tag")) && r.errors.some((e) => e.includes("z1 > z0")) && r.errors.some((e) => e.includes("counter-clockwise")) && r.errors.some((e) => e.includes("triangle")), r.errors.join("; "));
});
t("validateDoc rejects wrong format and version", () => { const d = goodDoc(); d.format = "x"; d.version = 2; ok(validateDoc(d).errors.length >= 2); });
t("sketchupFilename", () => eq(sketchupFilename("Option A — twisted slab", new Date(2026, 9, 21)), "option-a-twisted-slab-2026-10-21.sketchup.json"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
