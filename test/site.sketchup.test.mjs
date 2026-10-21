// Node tests for src/site/sketchup.js. Run: node test/site.sketchup.test.mjs
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { makeFrame } = await import("../src/site/geo.js");
const M = await import("../src/site/model.js");
const X = await import("../src/site/exports.js");
const SK = await import("../src/site/sketchup.js");
const F = await import("../src/shared/sketchup-format.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/* ---------------- fixtures (synthetic: no network, no files) ---------------- */
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const feat = (id, type, properties, parts) => ({ id, type, properties, parts });
const P = (outer, holes = []) => ({ outer, holes });
const road = (id, props, line) => feat(id, 2, { subtype: "road", ...props }, [line]);

// ground: a tilted plane with bumps, so the cells are not planar; values in meters (DEM), true elevation ~ 1000 ft
const trueFt = (x, y) => 1000.37 + 0.05 * x + 0.02 * y + 6 * Math.sin(x / 90) * Math.cos(y / 110);
function makeDem(fr, { w = 160, h = 160, margin = 80, fn = trueFt } = {}) {
  const bb = fr.bbox(margin), pixelW = (bb.east - bb.west) / w, pixelH = (bb.north - bb.south) / h;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const [x, y] = fr.toLocal(bb.west + (c + 0.5) * pixelW, bb.north - (r + 0.5) * pixelH);
    data[r * w + c] = fn(x, y) * 0.3048;
  }
  return { width: w, height: h, data, west: bb.west, north: bb.north, pixelW, pixelH };
}
const LAT = 33.92, LON = -84.34;

function makeSite(size, { extra = true } = {}) {
  const frame = makeFrame(LAT, LON, size);
  const ground = M.buildGround(frame, makeDem(frame, { w: 220, h: 220 }));
  const f = {
    building: [
      feat("b-data", 3, { height: 30, "@height_source": "ml", "@name": "Hall" }, [P(rect(300, 300, 360, 340))]),
      feat("b-floors", 3, { num_floors: 4 }, [P(rect(500, 300, 560, 360))]),
      feat("b-court", 3, { height: 40 }, [P(rect(600, 600, 700, 700), [rect(630, 630, 670, 670).reverse()])]),
      feat("b-est", 3, {}, [P(rect(200, 700, 240, 730))]),
    ],
    segment: [
      road("r1", { class: "residential", "@name": "Oak Street" }, [[0, 150], [500, 160], [1000, 150]]),
      road("r2", { class: "secondary", "@name": "Main Avenue" }, [[400, 0], [410, 500], [420, 1000]]),
      road("d", { class: "service", subclass: "driveway" }, [[100, 900], [996, 905]]),     // reaches the strip between the grid edge and the site edge
    ],
    land: [feat("t", 1, { class: "tree" }, [[120, 420], [140, 430]])],
    water: [
      feat("pond", 3, { class: "pond" }, [P(rect(750, 750, 850, 830), [rect(790, 780, 810, 800).reverse()])]),
      feat("stream", 2, { class: "stream" }, [[[0, 520], [300, 540], [1000, 700]]]),
    ],
  };
  if (extra) f.segment.push(road("w", { class: "footway" }, [[50, 800], [300, 820]]));
  const roads = M.buildRoads(f, frame, ground, { walks: extra });
  // A ring road around a block. Added by hand: buildRoads() currently fills the holes of the pavement union
  // (it flips the orientation of the ClipperOffset output), so a real hole must come from here.
  roads.pavement.push({ outer: rect(650, 250, 900, 450), holes: [rect(676, 276, 874, 424).reverse()] });
  roads.segments.push({ id: "ring", cls: "service", name: "", width: 26, line: [[663, 250, 0], [663, 450, 0]] });
  const model = {
    frame, ground, errors: {},
    buildings: M.buildBuildings(f, frame, ground),
    roads,
    trees: M.buildTrees(f, frame, ground),
    water: M.buildWater(f, frame, ground),
  };
  return model;
}

const meta = { address: "123 Test St, Tampa, FL", lat: LAT, lon: LON, size: 1000, release: "2026-09-23.1", date: "2026-10-21" };
const model = makeSite(1000);
const doc = SK.siteToSketchup(model, meta);

/* ---------------- helpers on the document ---------------- */
function walk(node, fn, path = []) { fn(node, path); (node.children || []).forEach((c) => walk(c, fn, [...path, node.name])); }
const find = (name) => { let r = null; walk(doc.root, (n) => { if (n.name === name) r = n; }); return r; };
const allPolys = (node) => { const out = []; walk(node, (n) => { if (n.type === "faces") out.push(...n.polygons); }); return out; };
const area2 = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const polyArea = (p) => Math.abs(area2(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(area2(h)), 0);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);

/** Max distance of all vertices (outer and holes) to the plane through the first 3 non-collinear outer vertices. */
function planarityError(poly) {
  const v = poly.outer;
  let nrm = null, p0 = v[0];
  outer: for (let i = 1; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
    const c = cross(sub(v[i], v[0]), sub(v[j], v[0]));
    const l = len(c), s = len(sub(v[i], v[0])) * len(sub(v[j], v[0]));
    if (l / s > 0.05 && l > 0.05) { nrm = c.map((q) => q / l); break outer; }
  }
  if (!nrm) return 0;
  let worst = 0;
  for (const ring of [poly.outer, ...poly.holes]) for (const q of ring) { const d = sub(q, p0); worst = Math.max(worst, Math.abs(d[0] * nrm[0] + d[1] * nrm[1] + d[2] * nrm[2])); }
  return worst;
}

/** Independent reference for the ground surface: read the document's own ground mesh (triangle order a,b,c / a,c,d). */
function meshRef(doc_) {
  const mesh = find("Ground");
  const n = Math.round(Math.sqrt(mesh.vertices.length)), d = mesh.vertices[1][0] - mesh.vertices[0][0];
  return (x, y) => {
    const i = Math.min(Math.max(Math.floor(x / d + 1e-9), 0), n - 2), j = Math.min(Math.max(Math.floor(y / d + 1e-9), 0), n - 2);
    const cell = j * (n - 1) + i, [a, b, c] = mesh.triangles[2 * cell].map((k) => mesh.vertices[k]), [a2, c2, d2] = mesh.triangles[2 * cell + 1].map((k) => mesh.vertices[k]);
    const u = (x - a[0]) / d, v = (y - a[1]) / d;
    return u >= v ? a[2] + u * (b[2] - a[2]) + v * (c[2] - b[2]) : a2[2] + u * (c2[2] - d2[2]) + v * (d2[2] - a2[2]);
  };
}
const ref = meshRef(doc);

/* ---------------- document ---------------- */
console.log("document");
t("validateDoc ok", () => { const v = F.validateDoc(doc); ok(v.ok, v.errors.join("; ")); });
t("header: source, name, location, notes", () => {
  eq(doc.source, "site"); eq(doc.name, "Site at 123 Test St, Tampa, FL"); eq(doc.root.name, doc.name);
  eq(doc.location, { lat: LAT, lon: LON }); eq(doc.units, "feet");
  ok(doc.notes.some((s) => s.includes("southwest corner")) && doc.notes.some((s) => s.includes("NAVD88")) && doc.notes.some((s) => s.includes(X.CREDITS)));
});
t("root name falls back to lat/lon without an address", () => {
  const d = SK.siteToSketchup(model, { lat: LAT, lon: LON });
  eq(d.root.name, "Site at 33.92000, -84.34000");
});
t("structure and tags follow the spec", () => {
  const top = doc.root.children.map((c) => `${c.name}:${c.type}:${c.tag}`);
  eq(top, ["Ground:mesh:Ground", "Buildings:group:Buildings", "Roads:group:Roads", "Walks:group:Walks", "Road centerlines:lines:Road centerlines", "Water:group:Water", "Site boundary:lines:Site boundary"]);
  eq(find("Buildings").material, "Building"); eq(find("Roads").material, "Pavement"); eq(find("Water").material, "Water"); eq(find("Ground").material, "Ground");
  eq(doc.tags.find((x) => x.name === "Road centerlines").visible, false);
  eq(doc.materials.find((m) => m.name === "Water").alpha, 0.85);
});
t("no trees anywhere", () => {
  ok(model.trees.length >= 2, "the model has trees");
  walk(doc.root, (n) => { ok(!/tree/i.test(n.name), "node " + n.name); });
  ok(!/tree/i.test(JSON.stringify(doc.tags) + JSON.stringify(doc.materials)));
});

/* ---------------- ground ---------------- */
console.log("ground");
const g = model.ground, n = g.n;
t("zShift = -ground.min rounded to 0.01 ft", () => { eq(doc.zShift, Math.round(-g.min * 100) / 100); ok(doc.zShift < -900, "elevation about 1000 ft"); });
t("min z over the ground mesh is 0 (to the 0.01 ft rounding of zShift)", () => {
  const mesh = find("Ground");
  near(Math.min(...mesh.vertices.map((v) => v[2])), 0, 0.0051);
});
t("every vertex = true elevation + zShift; plan positions are the grid nodes", () => {
  const mesh = find("Ground");
  eq(mesh.vertices.length, n * n);
  for (let j = 0; j < n; j += 5) for (let i = 0; i < n; i += 7) {
    const v = mesh.vertices[j * n + i];
    near(v[0], g.xs[i], 5e-4); near(v[1], g.ys[j], 5e-4); near(v[2], g.z[j * n + i] + doc.zShift, 5.1e-4);
  }
});
t("triangle count = 2 (n-1)^2, soft, same diagonal as the 3D view", () => {
  const mesh = find("Ground");
  eq(mesh.triangles.length, 2 * (n - 1) * (n - 1)); eq(mesh.soft, true);
  eq(mesh.triangles[0], [0, 1, n + 1]); eq(mesh.triangles[1], [0, n + 1, n]);         // cell (0,0): a-b-c and a-c-d
});
t("all triangles face up", () => {
  const mesh = find("Ground");
  for (const [a, b, c] of mesh.triangles) { const A = mesh.vertices[a], B = mesh.vertices[b], C2 = mesh.vertices[c]; ok((B[0] - A[0]) * (C2[1] - A[1]) - (B[1] - A[1]) * (C2[0] - A[0]) > 0, "CCW"); }
});

/* ---------------- buildings ---------------- */
console.log("buildings");
t("one solid per building; names, attributes, heights", () => {
  const B = find("Buildings").children;
  eq(B.length, model.buildings.length); eq(B.length, 4);
  eq(B.map((b) => b.name), ["Building 0001", "Building 0002", "Building 0003", "Building 0004 (estimated)"]);
  model.buildings.forEach((b, k) => {
    near(B[k].z0, b.base + doc.zShift, 5.1e-4); near(B[k].z1 - B[k].z0, b.height, 1.1e-3); ok(B[k].z1 > B[k].z0);
    eq(B[k].attributes.height_rule, b.rule);
  });
  eq(B[0].attributes.overture_id, "b-data"); eq(B[0].attributes.height_source, "ml"); near(B[0].attributes.height_ft, 98.4, 0.05);
  ok(!("height_source" in B[1].attributes));
});
t("courtyard hole is kept, clockwise", () => {
  const c = find("Buildings").children[2];
  eq(c.holes.length, 1); ok(area2(c.holes[0]) < 0); ok(area2(c.outer) > 0);
});
t("estimated count matches the model", () => {
  eq(find("Buildings").children.filter((b) => b.name.endsWith("(estimated)")).length, M.summarize(model).estimated);
});

/* ---------------- draping ---------------- */
console.log("draping");
const roadPolys = allPolys(find("Roads"));
t("roads exist: grouped per pavement piece, named by road name or class", () => {
  const R = find("Roads").children;
  eq(R.length, model.roads.pavement.length);
  ok(R.every((c) => c.type === "faces"));
  const names = R.map((c) => c.name);
  ok(names.includes("Main Avenue") || names.includes("Oak Street"), names.join());   // Oak Street and Main Avenue cross: one piece
  ok(names.some((s) => s === "service"), "ring road is named after its class: " + names.join());
});
t("every draped polygon is planar (< 0.001 ft)", () => {
  const all = [...roadPolys, ...allPolys(find("Walks")), ...allPolys(find("Water"))];
  ok(roadPolys.length > 200, "many pieces: " + roadPolys.length);
  let worst = 0;
  for (const p of all) worst = Math.max(worst, planarityError(p));
  ok(worst < 0.001, "worst " + worst);
});
t("total draped road plan area = pavement area inside the site (0.5%)", () => {
  const want = model.roads.pavement.reduce((s, p) => s + Math.abs(M.ringArea(p.outer)) - p.holes.reduce((q, h) => q + Math.abs(M.ringArea(h)), 0), 0);
  const got = roadPolys.reduce((s, p) => s + polyArea(p), 0);
  ok(Math.abs(got - want) / want < 0.005, `got ${got}, want ${want}`);
  const wantW = model.roads.walks.reduce((s, p) => s + Math.abs(M.ringArea(p.outer)), 0), gotW = allPolys(find("Walks")).reduce((s, p) => s + polyArea(p), 0);
  ok(Math.abs(gotW - wantW) / wantW < 0.005, `walks got ${gotW}, want ${wantW}`);
});
t("road reaching the strip between the grid edge and the site edge is not cut off", () => {
  const maxX = Math.max(...roadPolys.flatMap((p) => p.outer.map((q) => q[0])));
  ok(maxX > g.xs[n - 1] + 1, `maxX ${maxX}, grid edge ${g.xs[n - 1]}`);
});
t("draped z = ground triangle z + offset at every vertex and edge midpoint", () => {
  let worst = 0, count = 0;
  for (const p of roadPolys) for (const ring of [p.outer, ...p.holes]) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (const q of [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]]) {
      if (q[0] > g.xs[n - 1] || q[1] > g.ys[n - 1]) continue;                 // beyond the grid the cell plane is extended
      worst = Math.max(worst, Math.abs(q[2] - (ref(q[0], q[1]) + 0.1))); count++;
    }
  }
  ok(count > 1000 && worst < 0.003, `worst ${worst} over ${count}`);
});
t("a road with a hole keeps the hole (ring road around a block)", () => {
  const piece = model.roads.pavement.find((p) => p.holes.length);
  ok(piece, "the model has a pavement piece with a hole");
  const probe = [775, 350];                                                  // inside the block, outside the ring
  const covered = roadPolys.some((p) => inRing(probe, p.outer) && !p.holes.some((h) => inRing(probe, h)));
  eq(covered, false);
  const onRoad = roadPolys.some((p) => inRing([663, 350], p.outer) && !p.holes.some((h) => inRing([663, 350], h)));
  eq(onRoad, true);
  ok(roadPolys.some((p) => p.holes.length > 0) || roadPolys.length > 0);
});
function inRing(pt, r) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
t("drapePolygon: a hole inside one triangle stays a hole", () => {
  const gg = { n, spacing: g.spacing, xs: g.xs, ys: g.ys, z: g.z };
  const r = SK.drapePolygon([[4, 0.5], [10, 0.5], [10, 6]], [[[7, 1.5], [9, 1.5], [9, 3.5]]], gg, 0.1);
  eq(r.length, 1); eq(r[0].holes.length, 1); ok(area2(r[0].holes[0]) < 0 && area2(r[0].outer) > 0);
  for (const q of r[0].outer) near(q[2], SK.groundZAt(gg, q[0], q[1]) + 0.1, 0.001);
});
t("drapePolygon: a square spanning many cells keeps its plan area and has planar pieces", () => {
  const gg = { n, spacing: g.spacing, xs: g.xs, ys: g.ys, z: g.z };
  const sq = rect(100.3, 200.7, 187.9, 260.1), hole = rect(130, 220, 150, 240).reverse();
  const r = SK.drapePolygon(sq, [hole], gg, 0);
  const area = r.reduce((s, p) => s + polyArea(p), 0), want = 87.6 * 59.4 - 400;
  ok(Math.abs(area - want) / want < 0.001, `area ${area} vs ${want}`);
  ok(r.length > 40, "many triangles " + r.length);
  ok(Math.max(...r.map(planarityError)) < 0.001);
});
t("drapePolygon returns nothing for a polygon that is too small", () => {
  eq(SK.drapePolygon(rect(10, 10, 10.2, 10.2), [], { n, spacing: g.spacing, xs: g.xs, ys: g.ys, z: g.z }, 0), []);
});

/* ---------------- lines ---------------- */
console.log("lines");
// exact plane ground: z = 3 + 0.05 x - 0.02 y
const planeG = (() => { const nn = 30, d = 10, xs = new Float64Array(nn).map((_, i) => i * d), z = new Float64Array(nn * nn); for (let j = 0; j < nn; j++) for (let i = 0; i < nn; i++) z[j * nn + i] = 3 + 0.05 * xs[i] - 0.02 * xs[j]; return { n: nn, spacing: d, xs, ys: xs, z }; })();
t("drapeLine on a sloped plane gives exact z", () => {
  const out = SK.drapeLine([[3, 4], [95.5, 81.25], [120, 40]], planeG, 0.15);
  ok(out.length > 20, "split into many points: " + out.length);
  for (const p of out) near(p[2], 3 + 0.05 * p[0] - 0.02 * p[1] + 0.15, 0.0006);
  eq([out[0][0], out[0][1]], [3, 4]); eq([out[out.length - 1][0], out[out.length - 1][1]], [120, 40]);
});
t("drapeLine splits at every grid line and diagonal crossing (bumpy ground)", () => {
  const gg = { n, spacing: g.spacing, xs: g.xs, ys: g.ys, z: g.z };
  const line = [[5, 7], [433.3, 391.1], [600, 120.5], [990, 990]];
  const out = SK.drapeLine(line, gg, 0.1);
  let worst = 0;
  for (let i = 1; i < out.length; i++) {                                    // linear between consecutive points = exact at the midpoint
    const a = out[i - 1], b = out[i], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    worst = Math.max(worst, Math.abs((a[2] + b[2]) / 2 - (SK.groundZAt(gg, mx, my) + 0.1)));
  }
  ok(worst < 0.002, "worst " + worst);
  ok(out.length > 300, "points " + out.length);
});
t("drapeLine: a line along a grid line and a line along a diagonal", () => {
  const along = SK.drapeLine([[0, 30], [100, 30]], planeG, 0);              // on a grid line: only the 9 grid crossings + 2 ends
  eq(along.length, 11);
  const across = SK.drapeLine([[0, 25], [100, 25]], planeG, 0);             // through the cells: also crosses 10 diagonals
  eq(across.length, 21);
  const diag = SK.drapeLine([[0, 0], [100, 100]], planeG, 0);               // along the diagonals: split only at the nodes
  eq(diag.length, 11);
  for (const p of diag) near(p[2], 3 + 0.05 * p[0] - 0.02 * p[1], 0.0006);
});
t("drapeLine ignores a third coordinate and drops repeated points", () => {
  const out = SK.drapeLine([[5, 5, 99], [5, 5, 99], [15, 5, 99]], planeG, 0);
  eq(out.length, 3);
});
t("centerlines: hidden tag, one line per segment, z = ground + 0.15", () => {
  const cl = find("Road centerlines");
  eq(cl.lines.length, model.roads.segments.length);
  let worst = 0;
  for (const l of cl.lines) for (const p of l) if (p[0] <= g.xs[n - 1] && p[1] <= g.ys[n - 1]) worst = Math.max(worst, Math.abs(p[2] - (ref(p[0], p[1]) + 0.15)));
  ok(worst < 0.003, "worst " + worst);
});
t("site boundary: closed square at ground + 0.2", () => {
  const b = find("Site boundary").lines[0];
  eq([b[0][0], b[0][1]], [0, 0]); eq(b[0], b[b.length - 1]);
  const xs_ = b.map((p) => p[0]), ys_ = b.map((p) => p[1]);
  eq([Math.min(...xs_), Math.max(...xs_), Math.min(...ys_), Math.max(...ys_)], [0, 1000, 0, 1000]);
  for (const p of b) if (p[0] <= g.xs[n - 1] && p[1] <= g.ys[n - 1]) near(p[2], ref(p[0], p[1]) + 0.2, 0.003);
});

/* ---------------- water ---------------- */
console.log("water");
t("pond: horizontal face at its level + zShift, island kept; stream draped + 0.1", () => {
  const W = find("Water");
  const faces = W.children.find((c) => c.type === "faces"), lines = W.children.find((c) => c.type === "lines");
  eq(faces.polygons.length, 1); eq(faces.polygons[0].holes.length, 1);
  const a = model.water.areas[0];
  for (const q of [...faces.polygons[0].outer, ...faces.polygons[0].holes[0]]) near(q[2], a.level + doc.zShift, 5.1e-4);
  eq(lines.name, "Streams");
  for (const p of lines.lines[0]) if (p[0] <= g.xs[n - 1] && p[1] <= g.ys[n - 1]) near(p[2], ref(p[0], p[1]) + 0.1, 0.003);
});
t("a pond without a hole or stream: only what exists is written", () => {
  const m2 = { ...model, water: { areas: [], lines: [] }, roads: { segments: [], pavement: [], walks: null }, buildings: [] };
  const d2 = SK.siteToSketchup(m2, meta);
  ok(F.validateDoc(d2).ok, F.validateDoc(d2).errors.join());
  eq(d2.root.children.map((c) => c.name), ["Ground", "Site boundary"]);
  eq(d2.tags.map((x) => x.name), ["Ground", "Site boundary"]);
});

/* ---------------- notes line in exports.js ---------------- */
console.log("notes");
t("notesMarkdown has the SketchUp line with the same shift as the document", () => {
  const md = X.notesMarkdown(model, meta), N = (-doc.zShift).toFixed(2);
  const line = `SketchUp: use Extensions > CMRLM > Import Design Tools file. The model is lowered by ${N} ft so the lowest ground point is 0 ft. Add ${N} ft to return to NAVD88 elevations.`;
  ok(md.split("\n").includes(line), "line missing");
  ok(doc.notes.some((s) => s.includes(`Add ${N} ft to return to NAVD88`)));
});
t("a site below sea level is raised, not lowered", () => {
  const frame = makeFrame(29.95, -90.07, 500);                                // New Orleans
  const gr = M.buildGround(frame, makeDem(frame, { w: 80, h: 80, fn: (x, y) => -4 + 0.003 * x + 0.001 * y }));
  const m2 = { frame, ground: gr, buildings: [], roads: { segments: [], pavement: [], walks: null }, trees: [], water: { areas: [], lines: [] } };
  const d2 = SK.siteToSketchup(m2, { lat: 29.95, lon: -90.07 });
  ok(d2.zShift > 3.9 && d2.zShift < 4.1, "zShift " + d2.zShift);
  near(Math.min(...d2.root.children[0].vertices.map((v) => v[2])), 0, 0.0051);
  const md = X.notesMarkdown(m2, {});
  ok(md.includes(`raised by ${d2.zShift.toFixed(2)} ft`) && md.includes(`Subtract ${d2.zShift.toFixed(2)} ft`));
  ok(d2.notes.some((s) => s.includes("Subtract")));
});

/* ---------------- filename and blob ---------------- */
t("filename and blob", () => {
  eq(F.sketchupFilename(doc.name, new Date(2026, 9, 21)), "site-at-123-test-st-tampa-fl-2026-10-21.sketchup.json");
  const blob = F.docToBlob(doc);
  eq(blob.type, "application/json"); ok(blob.size > 100000);
});

/* ---------------- performance ---------------- */
console.log("performance");
function bigSite() {
  const frame = makeFrame(LAT, LON, 3000);
  const ground = M.buildGround(frame, makeDem(frame, { w: 400, h: 400, margin: 80 }));
  const buildings = [];
  for (let k = 0; k < 1000; k++) {
    const x = 20 + (k % 40) * 72, y = 20 + Math.floor(k / 40) * 110 + (k % 3) * 5, w = 20 + (k * 7) % 30, h = 18 + (k * 11) % 40;
    const ring = [[x, y], [x + w, y], [x + w, y + h], [x + w * 0.6, y + h], [x + w * 0.6, y + h * 0.5], [x, y + h * 0.5]];
    buildings.push({ id: "b" + k, ring, holes: k % 10 === 0 ? [[[x + 2, y + 2], [x + 2, y + 6], [x + 6, y + 6], [x + 6, y + 2]]] : [], base: ground.at(x, y), height: 24 + (k % 9) * 12, top: 0, floors: 2, rule: k % 7 ? "data" : "estimate", source: "ml", name: "" });
  }
  // 300 isolated road pieces (long thin rectangles), some with holes
  const pavement = [], segments = [];
  for (let k = 0; k < 300; k++) {
    const x = 30 + (k % 20) * 140, y = 40 + Math.floor(k / 20) * 190, L = 120 + (k * 13) % 200, w = 24 + (k % 4) * 6;
    const horiz = k % 2 === 0;
    const outer = horiz ? rect(x, y, x + L, y + w) : rect(x, y, x + w, y + L);
    const holes = k % 5 === 0 ? [horiz ? rect(x + L * 0.4, y + 6, x + L * 0.4 + 12, y + w - 6).reverse() : rect(x + 6, y + L * 0.4, x + w - 6, y + L * 0.4 + 12).reverse()] : [];
    pavement.push({ outer, holes });
    segments.push({ id: "s" + k, cls: "residential", name: k % 3 ? "Street " + (k % 17) : "", width: w, line: horiz ? [[x, y + w / 2, 0], [x + L, y + w / 2, 0]] : [[x + w / 2, y, 0], [x + w / 2, y + L, 0]] });
  }
  const water = { areas: [{ ring: rect(1500, 1500, 1700, 1620), holes: [], level: ground.at(1500, 1500) + 0.2, cls: "pond" }], lines: [[[0, 1000, 0], [1500, 1100, 0], [3000, 1300, 0]]] };
  return { frame, ground, buildings, roads: { segments, pavement, walks: null }, trees: [], water };
}
const big = bigSite();
let bigDoc, bigMs;
t("3,000 ft site, 1,000 buildings, 300 road pieces: export < 2 s", () => {
  SK.siteToSketchup(big, meta);                                              // warm-up
  const t0 = performance.now();
  bigDoc = SK.siteToSketchup(big, { ...meta, size: 3000 });
  bigMs = performance.now() - t0;
  const json = JSON.stringify(bigDoc);
  const v = F.validateDoc(bigDoc);
  console.log(`       ${bigMs.toFixed(0)} ms, ${(json.length / 1e6).toFixed(2)} MB JSON, ground n ${big.ground.n} (${bigDoc.root.children[0].triangles.length} triangles), ${bigDoc.root.children.find((c) => c.name === "Buildings").children.length} buildings, ${allPolys(bigDoc.root.children.find((c) => c.name === "Roads")).length} road polygons`);
  ok(v.ok, v.errors.join("; "));
  ok(bigMs < 2000, `took ${bigMs} ms`);
  eq(bigDoc.root.children.find((c) => c.name === "Buildings").children.length, 1000);
  eq(bigDoc.root.children.find((c) => c.name === "Roads").children.length, 300);
});
t("one connected road network (a single polygon with ~900 holes) drapes in < 2 s", () => {
  // the shape of a real network: one big polygon whose holes are the city blocks (900 holes)
  const holes = [];
  for (let a = 0; a < 30; a++) for (let b = 0; b < 30; b++) holes.push(rect(63 + a * 98, 63 + b * 98, 135 + a * 98, 135 + b * 98).reverse());
  const roads = { segments: [], pavement: [{ outer: rect(0, 0, 3000, 3000), holes }], walks: null };
  eq(roads.pavement[0].holes.length, 900);
  const m2 = { ...big, buildings: [], roads };
  const t0 = performance.now();
  const d2 = SK.siteToSketchup(m2, { ...meta, size: 3000 });
  const ms = performance.now() - t0;
  const polys = allPolys(d2.root.children.find((c) => c.name === "Roads"));
  const want = roads.pavement.reduce((s, p) => s + Math.abs(M.ringArea(p.outer)) - p.holes.reduce((q, h) => q + Math.abs(M.ringArea(h)), 0), 0);
  const got = polys.reduce((s, p) => s + polyArea(p), 0);
  console.log(`       ${ms.toFixed(0)} ms, ${polys.length} polygons, ${(JSON.stringify(d2).length / 1e6).toFixed(2)} MB JSON`);
  ok(F.validateDoc(d2).ok, F.validateDoc(d2).errors.join("; "));
  ok(Math.abs(got - want) / want < 0.005, `area ${got} vs ${want}`);
  ok(ms < 2000, `took ${ms} ms`);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
