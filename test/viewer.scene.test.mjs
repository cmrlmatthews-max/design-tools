// Run: node test/viewer.scene.test.mjs
// Model Viewer plan section 6, tests V1 to V5 and V9 (docs/model-viewer-technical-plan.md) on fixtures built from the tools' own modules
// (test/viewer.fixture.mjs): layersFrom, levelsIndex, cutAt, colorKey, sunSamples. V6 and V7 are in viewer.summary.test.mjs, V8 in viewer.sketchup.test.mjs.
const F = await import("./viewer.fixture.mjs");
const S = await import("../src/viewer/scene.js");
const SU = await import("../src/viewer/summary.js");
const PJ = await import("../src/shared/project.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
/** Every number in a JSON value is finite. */
function allFinite(v, path = "") {
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error(`not finite at ${path}`); }
  else if (Array.isArray(v)) v.forEach((x, i) => allFinite(x, `${path}[${i}]`));
  else if (v && typeof v === "object") for (const k of Object.keys(v)) allFinite(v[k], `${path}.${k}`);
}
const rad = (d) => (d * Math.PI) / 180;
/** Local point to project point, spec section 4. */
const toP = (pl, [x, y]) => [x * Math.cos(rad(pl.rotation)) - y * Math.sin(rad(pl.rotation)) + pl.x, x * Math.sin(rad(pl.rotation)) + y * Math.cos(rad(pl.rotation)) + pl.y];

const site = F.siteSection();
const massing = F.towerSection();
massing.updatedAt = "2026-10-24T10:00:00.000Z";
const plates = F.platesSection(massing);
const parking = F.parkingSection();
const stamps = { massing: massing.updatedAt };
const docSite = F.assemble({ site });
const docMass = F.assemble({ site, massing }, { stamps });
const docPlates = F.assemble({ site, massing, plates }, { stamps });
const docPark = F.assemble({ site, massing, plates, parking }, { stamps });
const docFull = F.fullProject();
const sec = (doc, k) => PJ.getSection(doc, k);

console.log("V1 empty project");
t("V1 every layer is not ok, has no items and no bounds", () => {
  const empty = PJ.newProject({ name: "Empty" });
  const L = S.layersFrom(empty);
  eq(Object.keys(L), S.LAYER_IDS);
  for (const id of S.LAYER_IDS) { ok(L[id].ok === false, id + " ok"); eq(L[id].items.length, 0, id + " items"); ok(L[id].bounds === null, id + " bounds"); }
  eq(S.levelsIndex(empty), []);
  const rows = SU.summary(empty);
  eq(rows.length, 1); eq(rows[0].id, "project"); eq(SU.staleFlags(empty), []);
  const cut = S.cutAt(L, 10);
  eq(cut.massing.items.length, 0);
});
t("V1 a null or odd document does not throw", () => {
  for (const d of [null, undefined, {}, { sections: 5 }, { sections: { massing: null, plates: { derived: [] } } }]) {
    const L = S.layersFrom(d);
    for (const id of S.LAYER_IDS) ok(L[id].ok === false);
    SU.summary(d); SU.staleFlags(d); S.levelsIndex(d);
  }
});

console.log("V2 site and tower massing in the project frame");
t("V2 the site layer holds the boundary, the ground range and the neighbors (a removed one is skipped)", () => {
  const L = S.layersFrom(docSite);
  ok(L.site.ok); eq(L.site.items.length, 2);
  eq(L.site.items.map((i) => i.id), ["site:near", "site:far"]);
  near(L.site.ground.zMin, 1000); near(L.site.ground.zMax, 1000 + 0.01 * 1000 + 0.02 * 1000);
  eq([L.site.bounds.minX, L.site.bounds.maxX, L.site.bounds.minY, L.site.bounds.maxY], [0, 1000, 0, 1000]);
  const near1 = L.site.items[0];
  eq([near1.z0, near1.z1], [1009, 1049]);
  eq(L.massing.ok, false);
});
t("V2 massing: one slab per level plate, z0 = baseZ + z, z1 = z0 + ftf, in the rotated frame", () => {
  const L = S.layersFrom(docMass), pl = massing.placement;
  ok(L.massing.ok);
  const levels = massing.derived.levels;
  const pieces = levels.reduce((n, l) => n + l.plates.length, 0);
  eq(L.massing.items.length, pieces);
  const first = L.massing.items.find((i) => i.level === 1), lv = levels[0];
  near(first.z0, pl.baseZ + lv.z); near(first.z1, pl.baseZ + lv.z + lv.ftf);
  const want = lv.plates[0].outer.map((p) => toP(pl, p));
  first.outer.forEach((p, i) => { near(p[0], want[i][0], 0.002); near(p[1], want[i][1], 0.002); });
  eq(first.program, lv.program);
});
t("V2 a rotated placement rotates the slabs: the same area, different corners; rotation 0 is a plain shift", () => {
  const m0 = F.towerSection("l-multifamily-podium", { x: 100, y: 200, rotation: 0, baseZ: 1010 });
  const docA = F.assemble({ site, massing: m0 }), docB = docMass;
  const a = S.layersFrom(docA).massing.items.find((i) => i.level === 1), b = S.layersFrom(docB).massing.items.find((i) => i.level === 1);
  const area = (r) => Math.abs(S.ringArea(r));
  near(area(a.outer), area(b.outer), 0.5);
  const loc = m0.derived.levels[0].plates[0].outer[0];
  near(a.outer[0][0], loc[0] + 100, 0.002); near(a.outer[0][1], loc[1] + 200, 0.002);
  ok(Math.abs(a.outer[0][0] - 100 - (b.outer[0][0] - 560)) > 1, "the rotated corner differs");
});
t("V2 a section without a placement of its own is not drawn at a shifted place: placement missing means the identity", () => {
  const d = JSON.parse(JSON.stringify(docMass));
  delete d.sections.massing.placement;
  const L = S.layersFrom(d);
  const lv = massing.derived.levels[0];
  near(L.massing.items.find((i) => i.level === 1).outer[0][0], lv.plates[0].outer[0][0], 0.002);
});
t("V2 every number of every layer is finite and every item has an id, a layer and a card", () => {
  const L = S.layersFrom(docFull);
  allFinite(L);
  const ids = new Set();
  for (const id of S.LAYER_IDS) for (const it of L[id].items) {
    ok(typeof it.id === "string" && it.id, id + " id"); ok(!ids.has(it.id), "duplicate id " + it.id); ids.add(it.id);
    eq(it.layer, id === "units" ? "units" : id);
    ok(it.data && typeof it.data.title === "string" && Array.isArray(it.data.rows), id + " card");
  }
});

console.log("V3 plates on a group of levels");
t("V3 units replace the massing slab on the plate levels; the podium stays massing", () => {
  const L = S.layersFrom(docPlates);
  const covered = new Set(plates.derived.levels.map((l) => l.index));
  ok(covered.size > 0 && covered.size < massing.derived.levels.length, "a group of levels");
  ok(L.massing.items.every((i) => !covered.has(i.level)), "no slab on a plate level");
  eq([...new Set(L.massing.items.map((i) => i.level))], massing.derived.levels.filter((l) => !covered.has(l.index)).map((l) => l.index));
  ok(L.massing.items.length > 0);
});
t("V3 the unit count equals the plates metrics units", () => {
  const L = S.layersFrom(docPlates);
  eq(L.units.items.length, plates.derived.metrics.units);
  eq(L.units.items.length, 238);
});
t("V3 a unit stands from the massing level z to z + ftf, in the project frame, with type, area and exposures", () => {
  const L = S.layersFrom(docPlates), pl = massing.placement;
  const u = L.units.items.find((i) => i.level === 12);
  const ml = massing.derived.levels.find((l) => l.index === 12);
  near(u.z0, pl.baseZ + ml.z); near(u.z1, pl.baseZ + ml.z + ml.ftf);
  const rec = plates.derived.levels.find((l) => l.index === 12).units.find((x) => `unit:12:${x.id}` === u.id);
  const want = rec.outer.map((p) => toP(pl, p));
  u.outer.forEach((p, i) => { near(p[0], want[i][0], 0.002); near(p[1], want[i][1], 0.002); });
  eq(u.type, rec.type);
  ok(u.data.rows.some((r) => r[0] === "Area" && /sf$/.test(r[1])));
  ok(u.data.rows.some((r) => r[0] === "Exposures"));
});
t("V3 cores and corridors: stairs and elevators (no rooms), corridor pieces with holes kept; core null is fine", () => {
  const L = S.layersFrom(docPlates);
  const kinds = new Set(L.cores.items.map((i) => i.kind));
  ok(kinds.has("stair") && kinds.has("elevator") && kinds.has("corridor"), [...kinds].join());
  const d = JSON.parse(JSON.stringify(docPlates));
  d.sections.plates.derived.levels.forEach((l) => { l.core = null; });
  const L2 = S.layersFrom(d);
  ok(L2.cores.items.every((i) => i.kind === "corridor"), "corridors only");
  ok(L2.units.items.length === 238);
});
t("V3 core rooms (the automatic core) draw instead of the core outline, stairs and elevators", () => {
  const d = JSON.parse(JSON.stringify(docPlates));
  const lv = d.sections.plates.derived.levels[0];
  lv.core.rooms = [{ id: "TR1", kind: "trash", outer: [[0, 0], [10, 0], [10, 10], [0, 10]] }, { id: "EL1", kind: "electrical", outer: [[10, 0], [20, 0], [20, 10], [10, 10]] }];
  const L = S.layersFrom(d);
  const first = L.cores.items.filter((i) => i.level === lv.index && i.kind !== "corridor");
  eq(first.map((i) => i.kind), ["room-trash", "room-electrical"]);
});
t("V3 units hold the area-high flag in the tap card when the plates give it", () => {
  const d = JSON.parse(JSON.stringify(docPlates));
  d.sections.plates.derived.levels[0].units[0].flags = ["area-high"];
  const L = S.layersFrom(d);
  const u = L.units.items[0];
  ok(u.data.rows.some((r) => r[0] === "Flags" && r[1] === "area-high"));
  const rows = SU.summary(d);
  ok(rows.some((r) => r.id === "plates.flagged" && r.value === 1));
});

console.log("V4 parking");
t("V4 the stall count equals the parking metrics stalls", () => {
  const L = S.layersFrom(docPark);
  const stalls = L.parking.items.filter((i) => i.kind === "stall");
  eq(stalls.length, parking.derived.metrics.stalls);
  eq(stalls.length, 496);
});
t("V4 slabs, cores and ramps: one slab per level, ramps as 3D strips with baseZ added, stalls flat on the slab", () => {
  const L = S.layersFrom(docPark), pl = parking.placement;
  eq(L.parking.items.filter((i) => i.kind === "slab").length, parking.derived.levels.length);
  const ramps = L.parking.items.filter((i) => i.kind === "ramp");
  ok(ramps.length > 0);
  const r0 = parking.derived.levels.find((l) => l.ramps.length).ramps[0];
  const item = ramps.find((i) => i.id.endsWith(`:${r0.id}`));
  near(item.outer3[0][2], r0.outer3d[0][2] + pl.baseZ, 0.002);
  const st = L.parking.items.find((i) => i.kind === "stall" && i.level === 1);
  const lv1 = parking.derived.levels.find((l) => l.index === 1);
  near(st.z0, lv1.z + pl.baseZ + 0.05, 1e-6); eq(st.z0, st.z1);
  ok(L.parking.items.some((i) => i.kind === "core"));
  const slab = L.parking.items.find((i) => i.kind === "slab" && i.level === 1);
  near(slab.z1, lv1.z + pl.baseZ);
});
t("V4 an unknown stall kind and a bad ramp are handled, a bad stall ring is skipped", () => {
  const d = JSON.parse(JSON.stringify(docPark));
  const lv = d.sections.parking.derived.levels[0];
  lv.stalls[0].outer = [[0, 0], [NaN, 1]];
  lv.stalls[1].kind = "mystery";
  lv.ramps[0].outer3d = [[0, 0, 0]];
  const L = S.layersFrom(d);
  eq(L.parking.items.filter((i) => i.kind === "stall").length, 495);
  eq(S.colorKey(L.parking.items.find((i) => i.stall === "mystery"), "program"), "stall:mystery");
  ok(/^#[0-9a-f]{6}$/i.test(S.colorOf("stall:mystery")));
});

// The Facade Studio is hidden (October 26, 2026). The facade reader stays and runs only with { includeHidden: true }.
const HID = { includeHidden: true };
console.log("facade (hidden), grading, sun");
t("hidden facade: the viewer shows no facade layer by default", () => {
  const L = S.layersFrom(docFull);
  ok(!("facade" in L), "layersFrom adds no facade layer");
  ok(!S.LAYER_IDS.includes("facade"), "LAYER_IDS has no facade");
  ok(S.HIDDEN_LAYERS.has("facade"));
  ok(Object.keys(L).every((k) => k !== "facade"));
});
t("facade (dormant reader): a band on the edge of each face with an edge, from levelFrom to the top of levelTo, outside the face", () => {
  const L = S.layersFrom(docFull, HID);
  const faces = facadeFaces(docFull);
  eq(L.facade.items.length, faces.filter((f) => f.edge).length);
  const f = faces[0], item = L.facade.items.find((i) => i.id === `facade:${f.id}`), pl = sec(docFull, "facade").placement;
  const lf = massing.derived.levels.find((l) => l.index === f.levelFrom), lt = massing.derived.levels.find((l) => l.index === f.levelTo);
  near(item.z0, pl.baseZ + lf.z); near(item.z1, pl.baseZ + lt.z + lt.ftf);
  ok(S.ringArea(item.outer) > 0, "counter-clockwise");
  eq(item.system, f.system);
});
function facadeFaces(doc) { return sec(doc, "facade").derived.faces; }
t("facade (dormant reader): a face without an edge is skipped and counted", () => {
  const d = JSON.parse(JSON.stringify(docFull));
  delete d.sections.facade.derived.faces[0].edge;
  const L = S.layersFrom(d, HID);
  eq(L.facade.items.length, facadeFaces(docFull).filter((f) => f.edge).length - 1);
  eq(L.facade.skipped, 1);
});
t("grading: the proposed ground and the wall solids; elevations are kept as they are (identity placement)", () => {
  const L = S.layersFrom(docFull);
  ok(L.grading.ok);
  const g = L.grading.items.find((i) => i.kind === "ground");
  ok(g && g.grid.n === sec(docFull, "grading").derived.ground.n);
  const walls = L.grading.items.filter((i) => i.kind === "wall");
  ok(walls.length > 5);
  const w = walls[0], line = sec(docFull, "grading").derived.walls[0].line;
  ok(w.z1 >= Math.min(line[0][2], line[1][2]) - 0.01 && w.z1 <= Math.max(line[0][2], line[1][2]) + 0.01);
  ok(w.z1 > w.z0);
  ok(L.grading.ground.zMin > 990 && L.grading.ground.zMax < 1100);
});
t("sun: samples by date and time", () => {
  const s = S.sunSamples(docFull);
  eq(s.dates, ["2026-03-20", "2026-06-21", "2026-12-21"]);
  eq(s.byDate["2026-06-21"].map((x) => x.time), ["09:00", "12:00", "15:00"]);
  ok(s.byDate["2026-06-21"][1].altitude > 60 && s.byDate["2026-12-21"][1].altitude < 40);
  const L = S.layersFrom(docFull);
  ok(L.sun.ok); eq(L.sun.items.length, 0);
});

console.log("V5 level cut");
t("V5 levelsIndex lists massing, plates and parking levels sorted by z; plate levels carry both sources", () => {
  const idx = S.levelsIndex(docPark);
  for (let i = 1; i < idx.length; i++) ok(idx[i].z > idx[i - 1].z, "sorted");
  const l12 = idx.find((l) => l.name === "Floor 12");
  eq(l12.sources, ["massing", "plates"]);
  ok(idx.some((l) => l.sources.includes("parking")));
  const l3 = idx.find((l) => l.name === "Floor 3");
  eq(l3.sources, ["massing"]);
  near(l12.z, massing.placement.baseZ + massing.derived.levels.find((l) => l.index === 12).z);
});
t("V5 a cut at a plate level: nothing above it, the cut level keeps its units, the cut level is marked", () => {
  const L = S.layersFrom(docFull, HID), idx = S.levelsIndex(docFull);
  const lv = idx.find((l) => l.name === "Floor 12");
  const before = JSON.stringify(L);
  const C = S.cutAt(L, lv.z);
  eq(JSON.stringify(L), before, "the input is unchanged");
  for (const id of ["massing", "units", "cores", "parking", "facade", "grading"]) for (const it of C[id].items) {
    if (it.kind === "ground") continue;
    const low = it.z0 !== undefined ? it.z0 : Math.min(...(it.line3 || it.outer3).map((p) => p[2]));
    ok(low <= lv.z + 0.26, `${id} ${it.id} starts at ${low}, above the cut ${lv.z}`);
  }
  const keep = C.units.items.filter((i) => i.level === 12);
  eq(keep.length, L.units.items.filter((i) => i.level === 12).length);
  ok(keep.length > 0 && keep.every((i) => i.cut === true), "marked");
  ok(C.units.items.every((i) => i.level <= 12));
  eq(C.units.items.length, L.units.items.filter((i) => i.level <= 12).length);
  ok(C.massing.items.every((i) => i.level <= 12));
  eq(C.site.items.length, L.site.items.length, "the site stays");
  eq(C.cutZ, lv.z);
  ok(C.facade.items.every((i) => i.z1 <= lv.z + 10.5 + 0.01), "facade bands cut to the cut level");
  ok(C.facade.items.length > 0);
});
t("V5 a cut at the lowest level keeps the ground floor and the parking level below", () => {
  const L = S.layersFrom(docPark), idx = S.levelsIndex(docPark);
  const C = S.cutAt(L, idx[0].z);
  ok(C.units.items.length === 0 && C.massing.items.length > 0 && C.massing.items.every((i) => i.level === 1));
  ok(C.parking.items.some((i) => i.kind === "slab" && i.level === 1));
  ok(!C.parking.items.some((i) => i.kind === "slab" && i.level === 2));
  ok(C.parking.items.filter((i) => i.cut).length > 0);
});

console.log("colors");
t("colorKey: program, unit type and source modes", () => {
  const L = S.layersFrom(docFull, HID);
  const u = L.units.items[0], m = L.massing.items[0], c = L.cores.items[0], f = L.facade.items[0];
  eq(S.colorKey(u, "program"), `program:${u.program}`);
  eq(S.colorKey(u, "unitType"), `unit:${u.type}`);
  eq(S.colorKey(u, "source"), "layer:units");
  eq(S.colorKey(m, "program"), `program:${m.program}`);
  eq(S.colorKey(m, "source"), "layer:massing");
  ok(/^kind:|^layer:/.test(S.colorKey(c, "program")));
  eq(S.colorKey(f, "program"), `facade:${f.system}`);
  eq(S.colorOf("program:residential"), "#4f7fd1");
  eq(S.colorOf("unit:1BR"), "#4f7fd1");
  eq(S.colorOf("unit:Studio"), "#9cc3e6");
  for (const k of ["program:nothing", "unit:7BR", "facade:x", "stall:x", "kind:x", "layer:x", "x"]) ok(/^#[0-9a-f]{6}$/i.test(S.colorOf(k)), k);
  eq(S.colorOf("unit:7BR"), S.colorOf("unit:7BR"));
});

console.log("rules: no mutation, bad input, schema warning, determinism");
t("a frozen document is read without error and nothing changes", () => {
  const d = deepFreeze(JSON.parse(JSON.stringify(docFull)));
  S.layersFrom(d); S.levelsIndex(d); SU.summary(d); SU.staleFlags(d); S.sunSamples(d);
});
t("malformed items are skipped: bad rings, a level without plates, strings for numbers", () => {
  const d = JSON.parse(JSON.stringify(docPlates));
  d.sections.massing.derived.levels[0].plates = [{ outer: [[0, 0], [1, 1]] }, null, 5];
  d.sections.massing.derived.levels[1].ftf = "tall";
  d.sections.plates.derived.levels[0].units[0].outer = "no";
  d.sections.plates.derived.levels[0].units[1].outer = [[0, 0], [10, "x"], [5, 5]];
  d.sections.plates.derived.levels[0].corridor = "bad";
  const L = S.layersFrom(d);
  allFinite(L);
  eq(L.units.items.length, 236);
  ok(L.massing.items.every((i) => i.level !== 1), "the bad level draws nothing");
  const f = L.massing.items.find((i) => i.level === 2);
  near(f.z1 - f.z0, 10, 1e-9, "default ftf");
});
t("an unknown schema is read as far as it parses and warns once per section", () => {
  const d = JSON.parse(JSON.stringify(docPlates));
  d.sections.plates.schema = 7; d.sections.massing.schema = 3;
  const msgs = [];
  const L = S.layersFrom(d, { onWarn: (m) => msgs.push(m) });
  eq(msgs.length, 2);
  ok(/plates/.test(msgs.join()) && /massing/.test(msgs.join()));
  eq(L.units.items.length, 238);
});
t("V9 determinism: the same document gives the same bytes, twice", () => {
  const a = JSON.stringify([S.layersFrom(docFull), S.levelsIndex(docFull), SU.summary(docFull), SU.staleFlags(docFull)]);
  const b = JSON.stringify([S.layersFrom(JSON.parse(JSON.stringify(docFull))), S.levelsIndex(docFull), SU.summary(docFull), SU.staleFlags(docFull)]);
  eq(a, b);
  ok(a.length > 100000);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
