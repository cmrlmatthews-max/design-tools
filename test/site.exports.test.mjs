// Run: node test/site.exports.test.mjs
// Removed buildings in the Site Model writers (docs/site-remove-technical-plan.md sections 3.3 and 7.1):
// siteDxf (BLDG-REMOVED outlines), notesMarkdown (the count line), siteToSketchup (no removed solids).
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { makeFrame } = await import("../src/site/geo.js");
const M = await import("../src/site/model.js");
const X = await import("../src/site/exports.js");
const SK = await import("../src/site/sketchup.js");
const F = await import("../src/shared/sketchup-format.js");
const D = await import("../src/site/derived.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/* ---------- fixture: 300 ft, gently tilted ground, 4 Overture features (one in two pieces) ---------- */
const LAT = 33.927, LON = -84.339, SIZE = 300;
const frame = makeFrame(LAT, LON, SIZE);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];       // CCW
const feat = (id, type, properties, parts) => ({ id, type, properties, parts });
const P = (outer, holes = []) => ({ outer, holes });
function makeDem(fr, zOf, { w = 80, h = 80, margin = 60 } = {}) {
  const bb = fr.bbox(margin), pixelW = (bb.east - bb.west) / w, pixelH = (bb.north - bb.south) / h;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const [x, y] = fr.toLocal(bb.west + (c + 0.5) * pixelW, bb.north - (r + 0.5) * pixelH);
    data[r * w + c] = zOf(x, y) * 0.3048;
  }
  return { width: w, height: h, data, west: bb.west, north: bb.north, pixelW, pixelH };
}
const ground = M.buildGround(frame, makeDem(frame, (x, y) => 1000 + 0.03 * x + 0.01 * y));
const features = {
  building: [
    feat("b-data", 3, { height: 30, "@name": "Hall" }, [P(rect(40, 40, 100, 90))]),
    feat("b-court", 3, { num_floors: 3 }, [P(rect(150, 150, 250, 250), [rect(180, 180, 220, 220).reverse()])]),
    feat("b-est", 3, {}, [P([[40, 200], [90, 200], [90, 230], [60, 230], [60, 260], [40, 260]])]),
    feat("b-two", 3, { height: 20 }, [P(rect(200, 20, 230, 50)), P(rect(250, 20, 280, 50))]),
  ],
  segment: [feat("r1", 2, { subtype: "road", class: "residential", "@name": "Test St" }, [[[0, 140], [150, 150], [300, 140]]])],
  land: [feat("t1", 1, { class: "tree" }, [[200, 100]])],
  water: [feat("p1", 3, { class: "pond" }, [P(rect(110, 100, 140, 130))])],
};
const model = {
  frame, ground,
  buildings: M.buildBuildings(features, frame, ground),
  roads: M.buildRoads(features, frame, ground, {}),
  trees: M.buildTrees(features, frame, ground),
  water: M.buildWater(features, frame, ground),
};
const meta = { address: "Ravinia Dr, Dunwoody, GA", lat: LAT, lon: LON, size: SIZE, release: "2026-09-24.0", date: "2026-10-22" };
const byId = (id) => model.buildings.filter((b) => b.id === id);

/* ---------- a small DXF reader: entities with layer, flag 70 and vertices ---------- */
function parseDxf(text) {
  const lines = text.split("\n"); eq(lines.pop(), "", "trailing newline");
  ok(lines.length % 2 === 0, "pairs");
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) { ok(/^ *\d{1,3}$/.test(lines[i]) && lines[i].length === 3, "code format: " + JSON.stringify(lines[i])); pairs.push([parseInt(lines[i], 10), lines[i + 1]]); }
  const layers = new Map(), ltypes = new Set();
  let table = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "TABLE") table = pairs[i + 1][1];
    if (c === 0 && v === "ENDTAB") table = null;
    if (c === 0 && table === "LAYER" && v === "LAYER") {
      const rec = {}; for (let k = i + 1; k < pairs.length && pairs[k][0] !== 0; k++) rec[pairs[k][0]] = pairs[k][1];
      layers.set(rec[2], { color: Number(rec[62]), ltype: rec[6] });
    }
    if (c === 0 && table === "LTYPE" && v === "LTYPE") ltypes.add(pairs[i + 1][1]);
  }
  const start = pairs.findIndex((p, k) => p[0] === 2 && p[1] === "ENTITIES" && pairs[k - 1][1] === "SECTION");
  const ents = [];
  let cur = null;
  for (let i = start + 1; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) {
      if (v === "POLYLINE" || v === "CIRCLE") { cur = { type: v, layer: null, flag: 0, z: null, verts: [] }; ents.push(cur); }
      else if (v === "VERTEX" && cur) cur.verts.push({ x: null, y: null, z: null, flag: 0 });
      else if (v === "SEQEND") cur = null;
      continue;
    }
    if (!cur) continue;
    const tgt = cur.verts.length ? cur.verts[cur.verts.length - 1] : null;
    if (c === 8 && !tgt) cur.layer = v;
    if (c === 70) { if (tgt) tgt.flag = Number(v); else cur.flag = Number(v); }
    if (c === 30 && !tgt) cur.z = Number(v);
    if (tgt && c === 10) tgt.x = Number(v);
    if (tgt && c === 20) tgt.y = Number(v);
    if (tgt && c === 30) tgt.z = Number(v);
  }
  return { pairs, layers, ltypes, ents };
}
const onLayer = (P, name) => P.ents.filter((e) => e.layer === name);
const pointsOf = (e) => e.verts.filter((v) => !(v.flag & 128) || (v.flag & 64)).map((v) => [v.x, v.y]);

const base = parseDxf(X.siteDxf(model));
const removedOne = parseDxf(X.siteDxf(model, { removed: new Set(["b-data"]) }));

console.log("site exports: DXF");
t("the fixture: 5 building pieces (b-two in 2 pieces with one id), 4 on BLDG-DATA, 1 on BLDG-ESTIMATE", () => {
  eq(model.buildings.map((b) => b.id), ["b-data", "b-court", "b-est", "b-two", "b-two"]);
  eq(onLayer(base, "BLDG-DATA").length, 4);
  eq(onLayer(base, "BLDG-ESTIMATE").length, 1);
  eq(onLayer(base, "BLDG-REMOVED").length, 0);
});
t("the layer table has BLDG-REMOVED (dashed); every entity layer is in the table", () => {
  ok(X.DXF_LAYERS.some(([n]) => n === "BLDG-REMOVED"), "DXF_LAYERS");
  for (const P of [base, removedOne]) {
    for (const [name] of X.DXF_LAYERS) ok(P.layers.has(name), "layer " + name);
    eq(P.layers.get("BLDG-REMOVED").ltype, "DASHED");
    eq(P.layers.get("BLDG-DATA").ltype, "CONTINUOUS");
    ok(P.ltypes.has("DASHED") && P.ltypes.has("CONTINUOUS"), "both linetypes are defined");
    for (const e of P.ents) ok(P.layers.has(e.layer), "entity layer defined: " + e.layer);
  }
});
t("no opts, an empty Set or an empty list: the same DXF text as before", () => {
  const text = X.siteDxf(model);
  eq(X.siteDxf(model, {}), text); eq(X.siteDxf(model, { removed: new Set() }), text); eq(X.siteDxf(model, { removed: [] }), text);
  eq(X.siteDxf(model, { removed: ["not-here"] }), text);
});
t("a removed building: no polyface on BLDG-DATA, one closed BLDG-REMOVED polyline at its base", () => {
  eq(onLayer(removedOne, "BLDG-DATA").length, 3);
  eq(onLayer(removedOne, "BLDG-ESTIMATE").length, 1);
  const r = onLayer(removedOne, "BLDG-REMOVED");
  eq(r.length, 1);
  const b = byId("b-data")[0];
  eq(r[0].type, "POLYLINE"); eq(r[0].flag, 1, "closed 2D polyline");
  near(r[0].z, b.base, 1e-4, "elevation in group 30");
  eq(r[0].verts.length, b.ring.length);
  r[0].verts.forEach((v, k) => { near(v.x, b.ring[k][0], 1e-4); near(v.y, b.ring[k][1], 1e-4); near(v.z, b.base, 1e-4); });
  // the polyfaces left are the other buildings: no polyface has the footprint of b-data
  const box = (e) => { const xs = pointsOf(e).map((p) => p[0]), ys = pointsOf(e).map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v)); };
  ok(!onLayer(removedOne, "BLDG-DATA").some((e) => JSON.stringify(box(e)) === JSON.stringify([40, 40, 100, 90])), "no b-data polyface");
  ok(onLayer(base, "BLDG-DATA").some((e) => JSON.stringify(box(e)) === JSON.stringify([40, 40, 100, 90])), "b-data polyface without removal");
});
t("a removed courtyard building: the outer ring and the hole on BLDG-REMOVED", () => {
  const P = parseDxf(X.siteDxf(model, { removed: ["b-court"] }));
  eq(onLayer(P, "BLDG-DATA").length, 3);
  const r = onLayer(P, "BLDG-REMOVED");
  eq(r.length, 2);
  ok(r.every((e) => e.flag === 1 && e.verts.length === 4), "two closed rings of 4 points");
  const b = byId("b-court")[0];
  r.forEach((e) => near(e.z, b.base, 1e-4));
});
t("an estimated building leaves BLDG-ESTIMATE; a piece id removes every piece of its feature", () => {
  const P = parseDxf(X.siteDxf(model, { removed: ["b-est", "b-two~2"] }));
  eq(onLayer(P, "BLDG-ESTIMATE").length, 0);
  eq(onLayer(P, "BLDG-DATA").length, 2);
  eq(onLayer(P, "BLDG-REMOVED").length, 3);
  const Q = parseDxf(X.siteDxf(model, { removed: new Set(["b-two"]) }));
  eq(onLayer(Q, "BLDG-DATA").length, 2);
  eq(onLayer(Q, "BLDG-REMOVED").length, 2);
});
t("the rest of the DXF is not changed by a removal (topo, roads, water, trees, boundary)", () => {
  for (const name of ["SITE-BOUNDARY", "TOPO-MESH", "ROAD-PAVEMENT", "ROAD-CL", "WATER", "TREE"]) {
    eq(JSON.stringify(onLayer(removedOne, name)), JSON.stringify(onLayer(base, name)), name);
  }
});

console.log("site exports: notes");
t("notesMarkdown: no removed line without removed buildings", () => {
  const md = X.notesMarkdown(model, meta);
  ok(!/Removed buildings/.test(md), "no removed line");
  ok(md.includes("- Buildings: 5"), "all 5 pieces");
  eq(X.notesMarkdown(model, { ...meta, removed: [] }), md);
  eq(X.notesMarkdown(model, { ...meta, removed: new Set(["not-here"]) }), md);
});
t("notesMarkdown: the count line, and the building counts leave the removed ones out", () => {
  const md = X.notesMarkdown(model, { ...meta, removed: new Set(["b-data"]) });
  ok(md.includes("- Removed buildings: 1 (on layer BLDG-REMOVED in the DXF; not in the SketchUp file)"), md);
  ok(md.includes("- Buildings: 4\n- Removed buildings: 1"), "right after the building count");
  ok(md.includes("Height from the data (measured or from the map source): 2 buildings"), "the data rule leaves b-data out");
  const md2 = X.notesMarkdown(model, { ...meta, removed: ["b-est", "b-two"] });
  ok(md2.includes("- Removed buildings: 2 ("), "b-two counts once (one feature, two pieces)");
  ok(md2.includes("- Buildings: 2\n"), "2 pieces left");
  ok(md2.includes("Height estimated (24 ft): 0 buildings"), "the estimate rule leaves b-est out");
});

console.log("site exports: SketchUp");
const solids = (doc) => {
  const g = doc.root.children.find((c) => c.name === "Buildings");
  return g ? g.children : [];
};
t("siteToSketchup: one building fewer, the document still validates", () => {
  const d0 = SK.siteToSketchup(model, meta), d1 = SK.siteToSketchup(model, { ...meta, removed: new Set(["b-data"]) });
  ok(F.validateDoc(d0).ok, F.validateDoc(d0).errors.join("; "));
  const v = F.validateDoc(d1); ok(v.ok, v.errors.join("; "));
  eq(solids(d1).length, solids(d0).length - 1);
  ok(!solids(d1).some((s) => s.attributes.overture_id === "b-data"), "no b-data solid");
  ok(solids(d0).some((s) => s.attributes.overture_id === "b-data"), "b-data solid without removal");
  const same = (a, b) => JSON.stringify({ ...a, createdAt: 0 }) === JSON.stringify({ ...b, createdAt: 0 });
  ok(same(SK.siteToSketchup(model, { ...meta, removed: [] }), d0), "an empty list changes nothing");
  ok(same(SK.siteToSketchup(model, { ...meta, removed: new Set(["not-here"]) }), d0), "an unknown id changes nothing");
});
t("siteToSketchup: the other buildings keep their names; no hidden group for the removed ones", () => {
  const d0 = SK.siteToSketchup(model, meta), d1 = SK.siteToSketchup(model, { ...meta, removed: ["b-data"] });
  eq(solids(d1).map((s) => s.name), solids(d0).map((s) => s.name).filter((n) => n !== "Building 0001"));
  const names = []; (function walk(n) { names.push(n.name); (n.children || []).forEach(walk); })(d1.root);
  ok(!names.some((n) => /removed/i.test(n || "")), "no removed group");
});
t("siteToSketchup: a piece id removes both pieces; removing every building drops the Buildings group", () => {
  const d = SK.siteToSketchup(model, { ...meta, removed: ["b-two~2"] });
  eq(solids(d).length, 3);
  ok(!solids(d).some((s) => s.attributes.overture_id === "b-two"), "no b-two piece");
  const all = SK.siteToSketchup(model, { ...meta, removed: model.buildings.map((b) => b.id) });
  ok(F.validateDoc(all).ok, F.validateDoc(all).errors.join("; "));
  ok(!all.root.children.some((c) => c.name === "Buildings"), "no empty Buildings group");
});

console.log("site exports: one removed list for every writer");
t("the derived section, the DXF, the notes and the SketchUp file agree on the same meta.removed", () => {
  const m = { ...meta, removed: new Set(["b-court", "b-two"]) };
  const d = D.siteDerived(model, m);
  eq(d.buildings.filter((b) => b.removed).map((b) => b.id), ["b-court", "b-two", "b-two~2"]);
  const P = parseDxf(X.siteDxf(model, { removed: m.removed }));
  eq(onLayer(P, "BLDG-DATA").length + onLayer(P, "BLDG-ESTIMATE").length, d.buildings.filter((b) => !b.removed).length);
  eq(solids(SK.siteToSketchup(model, m)).length, d.buildings.filter((b) => !b.removed).length);
  ok(X.notesMarkdown(model, m).includes("- Removed buildings: 2 ("), "two features");
  eq(D.siteState(m).removed, ["b-court", "b-two"]);
  eq(model.buildings.length, 5, "the model is not changed");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
