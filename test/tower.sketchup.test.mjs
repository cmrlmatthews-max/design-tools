// Node tests for src/tower/sketchup.js. Run: node test/tower.sketchup.test.mjs
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { buildPlates, computeMetrics } = await import("../src/tower/geometry.js");
const { PRESETS, PROGRAM_DEFAULTS } = await import("../src/tower/presets.js");
const { towerToSketchup } = await import("../src/tower/sketchup.js");
const { validateDoc, ringArea2, sketchupFilename } = await import("../src/shared/sketchup-format.js");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  ", name); } catch (e) { fail++; console.log("  FAIL", name, "-", e.message); } };
const ok = (v, m) => { if (!v) throw new Error(m || "expected true"); };
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };

const clone = (o) => JSON.parse(JSON.stringify(o));
const rect = (w, d) => ({ type: "rect", w, d, radius: 0, points: [] });

/** The shell's defaultState() (build/tower/03a_state.js), for a tool-free run. */
function defaultState() {
  return {
    schema: 1, name: "Option A",
    site: { shape: "rect", width: 250, depth: 200, points: [], setbacks: { front: 10, back: 10, left: 10, right: 10 }, heightLimit: 400, stepback: { on: false, aboveHeight: 85, distance: 15 } },
    context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
    podium: { on: false, floors: 4, groundFtf: 18, ftf: 14, shape: rect(220, 170), offset: { x: 0, y: 0 }, program: "retail", upperProgram: "amenity" },
    segments: [{ floors: 10, ftf: 10, program: "residential", shape: rect(100, 100), offset: { x: 0, y: 0 }, rotation: 0,
      taper: { x: 0, y: 0, curve: "linear" }, twist: { deg: 0, start: 0, end: 1, curve: "linear" }, lean: { x: 0, y: 0 } }],
    setbacks: [], mechanical: [], carves: [], cuts: [],
    crown: { type: "flat", height: 20, steps: 3, slopeSide: "front" },
    core: { mode: "percent", percent: 20, w: 40, d: 30 },
    programs: Object.fromEntries(Object.entries(PROGRAM_DEFAULTS).map(([k, v]) => [k, { ...v }])),
    targets: { gfa: 0, far: 0 },
    view: { style: "model", colorBy: "program", snap: { on: true, grid: 5 } },
  };
}

const run = (state) => { const built = buildPlates(state); return { built, doc: towerToSketchup(state, built), metrics: computeMetrics(state, built.plates) }; };

function walk(node, fn, parent = null) { fn(node, parent); (node.children || []).forEach((c) => walk(c, fn, node)); }
const nodes = (doc, type) => { const out = []; walk(doc.root, (n) => { if (n.type === type) out.push(n); }); return out; };
function floorsOf(doc) {   // [{n, solids:[...]}]
  const out = [];
  walk(doc.root, (n) => {
    if (n.attributes && n.attributes.floor != null) out.push({ n: n.attributes.floor, node: n, solids: n.type === "solid" ? [n] : n.children });
  });
  return out;
}
const solidArea = (s) => Math.abs(ringArea2(s.outer)) - s.holes.reduce((a, h) => a + Math.abs(ringArea2(h)), 0);

const cases = [{ id: "default", state: defaultState() }, ...PRESETS.map((p) => ({ id: p.id, state: (() => { const d = defaultState(); const s = clone(p.state); return { ...d, ...s, view: d.view }; })() }))];

console.log("tower.sketchup.test.mjs");
for (const { id, state } of cases) {
  const { built, doc, metrics } = run(state);
  const plates = built.plates;
  const voids = plates.filter((p) => p.void).length;
  const fl = floorsOf(doc);

  t(`${id}: validateDoc ok`, () => { const r = validateDoc(doc); ok(r.ok, r.errors.join("; ")); });
  t(`${id}: floor solids' plan area (holes out) equals GFA within 0.1%`, () => {
    let sum = 0;
    for (const f of fl) for (const s of f.solids) sum += solidArea(s);
    ok(Math.abs(sum - metrics.gfa) / metrics.gfa < 0.001, `sum ${sum} vs gfa ${metrics.gfa}`);
  });
  t(`${id}: one "Floor n" per plate minus voids (${plates.length} - ${voids})`, () => {
    eq(fl.length, plates.length - voids);
    eq(fl.map((f) => f.n), plates.filter((p) => !p.void).map((p) => p.n));
  });
  t(`${id}: every solid has z1 > z0; floors use full ftf`, () => {
    for (const n of nodes(doc, "solid")) ok(n.z1 > n.z0, `${n.name}: ${n.z0}..${n.z1}`);
    for (const f of fl) {
      const p = plates.find((q) => q.n === f.n);
      for (const s of f.solids) ok(Math.abs(s.z0 - p.z) < 1e-3 && Math.abs(s.z1 - (p.z + p.ftf)) < 1e-3, `Floor ${f.n} z`);
    }
  });
  t(`${id}: tags and materials used are declared; every tag is used`, () => {
    const tags = new Set(doc.tags.map((x) => x.name)), mats = new Set(doc.materials.map((x) => x.name));
    const used = new Set();
    walk(doc.root, (n) => {
      if (n.tag) { ok(tags.has(n.tag), `tag ${n.tag}`); used.add(n.tag); }
      if (n.material) ok(mats.has(n.material), `material ${n.material}`);
    });
    for (const x of tags) ok(used.has(x), `tag ${x} declared but unused`);
    for (const f of fl) ok(f.node.tag === ((plates.find((q) => q.n === f.n).program || "")[0].toUpperCase() + plates.find((q) => q.n === f.n).program.slice(1)), `Floor ${f.n} tag`);
  });
  t(`${id}: structure and header (Podium, Segment n, Crown, Context; origin, tower source, zShift 0)`, () => {
    const names = doc.root.children.map((c) => c.name);
    eq(doc.source, "tower"); eq(doc.zShift, 0); eq(doc.location, null);
    eq(doc.root.name, state.name);
    eq(names.includes("Podium"), !!state.podium.on);
    state.segments.forEach((s, i) => { if (plates.some((p) => p.segmentIndex === i && !p.void)) ok(names.some((n) => n.startsWith(`Segment ${i + 1} · `)), `segment ${i + 1}`); });
    eq(names.includes("Crown"), built.solids.length > 0);
    eq(names.includes("Context"), state.context.show && state.context.blocks.length > 0);
  });
  t(`${id}: floor attributes (floor, program, area_sf)`, () => {
    for (const f of fl) {
      const p = plates.find((q) => q.n === f.n), a = f.node.attributes;
      eq([a.floor, a.program, Math.abs(a.area_sf - p.area) < 0.01], [p.n, p.program, true]);
    }
  });
  const sizeKb = Math.round(JSON.stringify(doc).length / 1024);
  t(`${id}: size ${sizeKb} KB, ${fl.length} floors`, () => ok(sizeKb < 2048));
}

// ---- targeted cases ---------------------------------------------------------------
t("a center carve produces a hole", () => {
  const s = defaultState();
  s.carves = [{ startFloor: 3, endFloor: 5, kind: "center", w: 20, d: 30 }];
  const { doc, metrics } = run(s);
  ok(validateDoc(doc).ok, validateDoc(doc).errors.join("; "));
  const f4 = floorsOf(doc).find((f) => f.n === 4);
  eq(f4.solids.length, 1);
  eq(f4.solids[0].holes.length, 1);
  ok(ringArea2(f4.solids[0].holes[0]) < 0, "hole clockwise");
  eq(floorsOf(doc).find((f) => f.n === 2).solids[0].holes.length, 0);
  eq(Math.round(solidArea(f4.solids[0])), 9400);
  let sum = 0; for (const f of floorsOf(doc)) for (const x of f.solids) sum += solidArea(x);
  ok(Math.abs(sum - metrics.gfa) < 1, "gfa");
});
t("a corner carve still validates and shortens the outline", () => {
  const s = defaultState();
  s.carves = [{ startFloor: 4, endFloor: 5, kind: "corner", corner: "NE", w: 30, d: 30 }];
  const { doc } = run(s);
  const r = validateDoc(doc); ok(r.ok, r.errors.join("; "));
  const f4 = floorsOf(doc).find((f) => f.n === 4).solids[0];
  eq(f4.outer.length, 6); eq(f4.holes.length, 0);
  eq(Math.round(solidArea(f4)), 9100);
});
t("a full carve (void floor) is skipped; floors above keep their elevation", () => {
  const s = defaultState();
  s.carves = [{ startFloor: 5, endFloor: 5, kind: "full" }];
  const { doc } = run(s);
  ok(validateDoc(doc).ok);
  const fl = floorsOf(doc);
  eq(fl.length, 9); ok(!fl.some((f) => f.n === 5));
  eq(fl.find((f) => f.n === 6).solids[0].z0, 50);
});
t("a 2-piece split plate gives a \"Floor n\" group with 2 solids", () => {
  const s = defaultState();
  s.carves = [{ startFloor: 6, endFloor: 6, kind: "center", w: 30, d: 200 }];   // crosses the plate edges: splits it in two
  const { doc, built } = run(s);
  const r = validateDoc(doc); ok(r.ok, r.errors.join("; "));
  eq(built.plates.find((p) => p.n === 6).polygons.length, 2, "plate pieces");
  const g = nodes(doc, "group").find((n) => n.name === "Floor 6");
  ok(g, "Floor 6 group");
  eq(g.children.length, 2); eq(g.children.every((c) => c.type === "solid"), true);
  eq(g.attributes.floor, 6);
  eq(nodes(doc, "solid").filter((n) => n.name === "Floor 5").length, 1);
});
t("a spire crown gives a closed, hard mesh; a sloped crown too", () => {
  for (const type of ["spire", "sloped"]) {
    const s = defaultState(); s.crown = { type, height: 40, steps: 3, slopeSide: "front" };
    const { doc } = run(s);
    const r = validateDoc(doc); ok(r.ok, `${type}: ${r.errors.join("; ")}`);
    const m = nodes(doc, "mesh");
    eq(m.length, 1, type);
    eq([m[0].closed, m[0].soft, m[0].tag], [true, false, "Crown"]);
    ok(m[0].triangles.length > 0 && m[0].vertices.length > 0);
  }
});
t("a spire mesh is watertight (every edge shared by two triangles)", () => {
  const s = defaultState(); s.crown = { type: "spire", height: 40, steps: 3, slopeSide: "front" };
  const m = nodes(run(s).doc, "mesh")[0];
  const edges = new Map();
  for (const [a, b, c] of m.triangles) for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? `${p}_${q}` : `${q}_${p}`; edges.set(k, (edges.get(k) || 0) + 1); }
  ok([...edges.values()].every((n) => n === 2), "open edge");
});
t("stepped crown gives one solid per step; flat gives a parapet ring; none gives no Crown group", () => {
  let s = defaultState(); s.crown = { type: "stepped", height: 30, steps: 3, slopeSide: "front" };
  let { doc } = run(s);
  ok(validateDoc(doc).ok);
  eq(doc.root.children.find((c) => c.name === "Crown").children.length, 3);
  s = defaultState(); ({ doc } = run(s));
  const flat = doc.root.children.find((c) => c.name === "Crown").children;
  ok(flat.length >= 1 && flat[0].holes.length === 1, "ring has an inner hole");
  s = defaultState(); s.crown = { type: "none", height: 0, steps: 3, slopeSide: "front" }; ({ doc } = run(s));
  ok(!doc.root.children.some((c) => c.name === "Crown") && !doc.tags.some((x) => x.name === "Crown"));
});
t("mechanical floors sit in their segment with the Mechanical tag; podium floors in Podium", () => {
  const s = defaultState();
  s.podium.on = true; s.podium.floors = 2;
  s.mechanical = [{ afterFloor: 6, ftf: 16 }];
  const { doc } = run(s);
  ok(validateDoc(doc).ok);
  const seg = doc.root.children.find((c) => c.name.startsWith("Segment 1"));
  const mech = seg.children.find((c) => c.attributes && c.attributes.program === "mechanical");
  ok(mech && mech.tag === "Mechanical" && mech.material === "Mechanical", "mechanical floor");
  eq(mech.z1 - mech.z0, 16);
  const pod = doc.root.children.find((c) => c.name === "Podium");
  eq(pod.children.map((c) => c.name), ["Floor 1", "Floor 2"]);
  ok(doc.tags.some((x) => x.name === "Mechanical" && x.color === PROGRAM_DEFAULTS.mechanical.color));
});
t("two segments make two groups named with their programs; context hidden leaves no Context group", () => {
  const s = defaultState();
  s.segments.push({ ...clone(s.segments[0]), floors: 5, program: "office", shape: rect(60, 60) });
  s.context.show = false;
  const { doc } = run(s);
  ok(validateDoc(doc).ok);
  eq(doc.root.children.map((c) => c.name).filter((n) => n.startsWith("Segment")), ["Segment 1 · Residential", "Segment 2 · Office"]);
  ok(!doc.root.children.some((c) => c.name === "Context"));
});
t("a twisted, rotated, curved tower still validates and every ring is clean (CCW outers, CW holes)", () => {
  const s = defaultState();
  s.segments[0].shape = { type: "ellipse", w: 90, d: 60, radius: 0, points: [] };
  s.segments[0].twist = { deg: 45, start: 0, end: 1, curve: "linear" };
  s.carves = [{ startFloor: 2, endFloor: 3, kind: "center", w: 10, d: 10 }];
  const { doc } = run(s);
  const r = validateDoc(doc); ok(r.ok, r.errors.join("; "));
});
t("empty design (no area) gives a valid document with no floors", () => {
  const s = defaultState(); s.segments[0].shape = rect(0, 0);
  const { doc } = run(s);
  ok(validateDoc(doc).ok);
  eq(floorsOf(doc).length, 0);
});
t("the download filename comes from the option name", () => {
  eq(sketchupFilename("Option A", new Date(2026, 9, 21)), "option-a-2026-10-21.sketchup.json");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
