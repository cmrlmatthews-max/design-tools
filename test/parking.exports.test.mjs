// Run: node test/parking.exports.test.mjs
// Plan tests 16 to 18 (docs/parking-deck-technical-plan.md section 9.1):
//   16  preset 8.6 through parkingDerived, writeSection and validate
//   17  DXF of preset 8.1: every layer, one closed polyline per stall on PARK-STALL and PARK-ACCESSIBLE, 496 in total
//   18  stall CSV of preset 8.7: 42 rows plus the header
// Plus the SketchUp export (validateDoc), the circular ramp pieces and the ear clipper.
// The build comes from a hand fixture that follows the plan section 4 contract (layout.js is written in parallel).
// When src/parking/layout.js loads, the same invariants also run against the real layout (section "real layout").
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { parkingDerived, localMapper } = await import("../src/parking/derived.js");
const { parkingToSketchup } = await import("../src/parking/sketchup.js");
const { parkingDxf, stallCsv, parkTriangulate, PARK_DXF_LAYERS } = await import("../src/parking/exports.js");
const { newProject, writeSection, validate } = await import("../src/shared/project.js");
const { validateDoc, ringArea2 } = await import("../src/shared/sketchup-format.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/* ---------- states ---------- */

let presets = null;
try { presets = (await import("../src/parking/presets.js")).PRESETS; } catch (e) { /* inline states below */ }

function baseState() {
  return {
    schema: 1, name: "Wrap deck", source: "wrap", sourceLevel: 6,
    footprint: { shape: "rect", width: 300, depth: 125, points: [], x: 0, y: 0, angle: 0, perimeter: 1 },
    placement: null,
    levels: { count: 5, ftf1: 11, ftf: 10.5, belowGrade: 0, openTop: true },
    bays: { stallW: 9, stallD: 18, aisle: 24, edgeBays: true, compactShare: 0, compactW: 8, compactD: 16, turnZone: null, rotateBays: false },
    grid: { span: "long", column: 2, stallsPerModule: 3, structureDepth: { long: 2.5, short: 1.5 } },
    ramp: { type: "single-helix", slopedBay: 1, speed: { x: 99, y: 123, width: 24, length: 82, shape: "straight", insideRadius: 30, segments: 12 }, splitLength: 36, transition: { length: 10, slopeFactor: 0.5 } },
    cores: [
      { id: "S1", kind: "stair", x: 25, y: 1, w: 22, d: 12 },
      { id: "E1", kind: "elevator", x: 52, y: 1, w: 10, d: 10 },
      { id: "S2", kind: "stair", x: 246, y: 109, w: 22, d: 12 },
    ],
    coresFromProject: true,
    entries: [{ id: "N1", side: "west", at: 31, width: 24 }],
    checks: { slopeParking: 0.0667, slopeSpeed: 0.12, crossSlope: 0.02, barrier: 2.75, guard: 3.5, clearGeneral: 7, clearVan: 8.1667, barrierProvided: 3.5, overlayTolerance: 2 },
    accessible: { vanPer: 6, aisleCar: 5, aisleVan: 8, r2: { on: null, percent: 2 } },
    ev: { readyShare: 0.2, installedShare: 0.05 },
    bike: { mode: "per-units", perUnits: 10, count: 0, rack: "single" },
    required: { units: null, ratio: 1.25, retailSf: 0 },
    view: { style: "model", colorBy: "kind" },
  };
}
const preset = (id) => { const p = presets && presets.find((x) => x.id === id); return p ? structuredClone(p.state) : null; };
const state86 = preset("wrap-deck-five-level") || baseState();       // plan 8.6: wrap, 5 levels, R-2 on
const state81 = preset("two-bay-single-helix") || (() => { const s = baseState(); s.source = "standalone"; s.name = "Two-bay single helix"; return s; })();
const state87 = preset("podium-one-level") || (() => {
  const s = baseState();
  s.source = "podium"; s.footprint.depth = 65; s.levels.count = 1; s.ramp.type = "none";
  s.cores = [{ id: "S1", kind: "stair", x: 25, y: 1, w: 22, d: 12 }, { id: "E1", kind: "elevator", x: 52, y: 1, w: 10, d: 10 },
    { id: "S2", kind: "stair", x: 142, y: 1, w: 22, d: 12 }, { id: "S3", kind: "stair", x: 246, y: 49, w: 22, d: 12 }];
  return s;
})();

/* ---------- hand fixture: layout(state) as the plan section 4 contract gives it ---------- */

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];       // CCW
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const box = (r) => [r[0][0], r[0][1], r[2][0], r[2][1]];

/**
 * W x D footprint at the local origin's south-west corner shifted by (-W/2, -D/2): layout frame -> local frame is a pure shift.
 * accessible: [{ kind }] placed from the first free stall of row 1S on level 1; aisles: stalls removed after them.
 */
function fixture(state, { accessible = [], aisles = 0, evInstalled = 0, evReady = 0 } = {}) {
  const p = state.footprint.perimeter, W = state.footprint.width, D = state.footprint.depth;
  const stallW = state.bays.stallW, stallD = state.bays.stallD, aisle = state.bays.aisle, t = state.bays.turnZone ?? aisle;
  const B2 = 2 * stallD + aisle, Du = D - 2 * p, nb = Math.floor(Du / B2), strip = Du - nb * B2;
  const xs = p + t, xe = W - p - t, n = Math.floor((xe - xs) / stallW);
  const bays = [];
  for (let b = 0; b < nb; b++) {
    const y0 = p + b * B2;
    bays.push({ index: b, kind: "double", y0, rows: [{ id: "S", y0, y1: y0 + stallD }, { id: "N", y0: y0 + stallD + aisle, y1: y0 + B2 }], aisle: { y0: y0 + stallD, y1: y0 + stallD + aisle } });
  }
  const cores = state.cores.map((c) => ({ id: c.id, kind: c.kind, outer: rect(c.x, c.y, c.x + c.w, c.y + c.d) }));
  const levels = [];
  for (let i = 0; i < state.levels.count; i++) {
    const index = i + 1, z = i === 0 ? 0 : state.levels.ftf1 + (i - 1) * state.levels.ftf, ftf = i === 0 ? state.levels.ftf1 : state.levels.ftf;
    const stalls = [];
    for (const bay of bays) for (const row of bay.rows) for (let k = 0; k < n; k++) {
      const x0 = xs + k * stallW, b = [x0, row.y0, x0 + stallW, row.y1];
      if (cores.some((c) => overlap(b, box(c.outer)) > 1)) continue;
      stalls.push({ id: `P${index}-${bay.index + 1}${row.id}-${String(k + 1).padStart(3, "0")}`, level: index, bay: bay.index, row: row.id, k, outer: rect(...b), kind: "standard", evReady: false });
    }
    const aisleMp = bays.map((bay) => ({ outer: rect(xs - t, bay.aisle.y0, xe + t, bay.aisle.y1), holes: [] }));
    levels.push({ index, z, ftf, plate: [{ outer: rect(0, 0, W, D), holes: [] }], stalls, aisles: aisleMp, turnZones: [], cuts: [] });
  }
  // accessible group on level 1, row 1S, then the aisle stalls
  const l1 = levels[0].stalls, row = l1.filter((s) => s.id.includes("-1S-"));
  accessible.forEach((a, i) => { row[i].kind = a.kind; });
  const gone = new Set(row.slice(accessible.length, accessible.length + aisles).map((s) => s.id));
  levels[0].stalls = l1.filter((s) => !gone.has(s.id));
  // EV: standard stalls nearest the entry (west), level 1 first; ready: the first standard stalls in order
  const std = levels.flatMap((l) => l.stalls).filter((s) => s.kind === "standard");
  const byWest = std.filter((s) => s.level === 1).sort((a, b) => a.outer[0][0] - b.outer[0][0] || a.outer[0][1] - b.outer[0][1]);
  byWest.slice(0, evInstalled).forEach((s) => { s.kind = "ev"; });
  std.filter((s) => s.kind === "standard").slice(0, evReady).forEach((s) => { s.evReady = true; });
  const frame = { origin: [-W / 2, -D / 2], angle: 0, W, D, toLocal: (q) => [q[0] - W / 2, q[1] - D / 2], toLayout: (q) => [q[0] + W / 2, q[1] + D / 2] };
  return { frame, levels, bays: { bays, strip: strip > 0 ? { y0: D - p - strip, y1: D - p } : null }, strip, cores, warnings: [] };
}

/** Single-helix ramps (plan 3.4): one per double bay per level, a 4-corner outline rising along x. */
function helixRamps(state, built) {
  const p = state.footprint.perimeter, t = state.bays.aisle, W = state.footprint.width, out = [];
  const xs = p + t, xe = W - p - t;
  for (const lv of built.levels) {
    const rise = lv.ftf / 2, s = rise / (xe - xs);
    built.bays.bays.forEach((bay, b) => {
      const y0 = bay.y0, y1 = bay.y0 + 2 * state.bays.stallD + state.bays.aisle;
      out.push({ id: `R${b + 1}`, type: "single-helix", level: lv.index, rise, length: xe - xs, slope: s, limit: 0.0667, ok: true,
        outer3d: [[xs, y0, lv.z], [xe, y0, lv.z + rise], [xe, y1, lv.z + rise], [xs, y1, lv.z]], footprint: null });
    });
  }
  return out;
}

/** Column points (plan 3.8, long-span): 3 lines x 11 columns. */
function columnPts(state, built) {
  const p = state.footprint.perimeter, t = state.bays.aisle, W = state.footprint.width, xs = p + t, xe = W - p - t, mod = 3 * state.bays.stallW;
  const xsList = [];
  for (let k = 0; k <= Math.floor((xe - xs) / mod); k++) xsList.push(xs + k * mod);
  if (xe - xsList[xsList.length - 1] > 0.5) xsList.push(xe);
  const ys = [...built.bays.bays.map((b) => b.y0), Math.max(...built.bays.bays.flatMap((b) => b.rows.map((r) => r.y1)))];
  return ys.flatMap((y) => xsList.map((x) => [x, y]));
}

// plan 8.6: N0 = 500; required 10 (R-2), van 2, car 8; aisles 16 + 5 x 3 = 31 ft -> 4 stalls; stalls 496.
// EV installed round(496 x 0.05) = 25, ready round(496 x 0.20) = 99.
const ACC86 = [{ kind: "van" }, { kind: "accessible" }, { kind: "van" }, ...Array.from({ length: 7 }, () => ({ kind: "accessible" }))];
const built86 = fixture(state86, { accessible: ACC86, aisles: 4, evInstalled: 25, evReady: 99 });
const ramps86 = helixRamps(state86, built86);
const cols86 = columnPts(state86, built86);
const metrics86 = { ramps: ramps86, columnPoints: cols86, accessible: { required: 10, provided: 10, van: 2 }, ev: { installed: 25, ready: 99 } };

const snapshot = JSON.stringify([state86, built86.levels, ramps86, metrics86.accessible]);
const derived = parkingDerived(state86, built86, metrics86);
const lv = derived.levels;

const ringOk = (r, hole = false) => Array.isArray(r) && r.length >= 3 && r.every((p) => p.length === 2 && p.every(Number.isFinite)) && (ringArea2(r) > 0) === !hole
  && !(r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]);
function allRings(d) {
  const out = [];
  const mp = (m, where) => m.forEach((pc, i) => { out.push([pc.outer, false, `${where}[${i}].outer`]); pc.holes.forEach((h, j) => out.push([h, true, `${where}[${i}].holes[${j}]`])); });
  d.levels.forEach((l) => {
    mp(l.plate, `levels[${l.index}].plate`); mp(l.aisles, `levels[${l.index}].aisles`);
    l.stalls.forEach((s) => out.push([s.outer, false, `levels[${l.index}].stalls[${s.id}]`]));
    l.cores.forEach((c) => out.push([c.outer, false, `levels[${l.index}].cores[${c.id}]`]));
  });
  return out;
}

/* ---------- test 16 ---------- */

t("test 16: preset 8.6 derived passes validate after writeSection", () => {
  const doc = writeSection(newProject({ name: "Parking test" }), "parking", { tool: "parking", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: state86, derived });
  const v = validate(doc);
  ok(v.ok, v.errors.join("; "));
  eq(doc.sections.parking.tool, "parking");
  eq(doc.sections.parking.derived.levels.length, 5);
  eq(doc.sections.parking.derived.metrics.levels, 5);
  ok(JSON.stringify(doc).length < 600000, "project stays small: " + JSON.stringify(doc).length + " bytes");
});

t("test 16: five levels, index 1 lowest, z above baseZ", () => {
  eq(lv.map((l) => l.index), [1, 2, 3, 4, 5]);
  eq(lv.map((l) => l.z), [0, 11, 21.5, 32, 42.5]);
});

t("test 16: every ring is clean: CCW outers, CW holes, no repeated last point", () => {
  for (const [r, hole, where] of allRings(derived)) ok(ringOk(r, hole), `${where} is not a clean ring`);
});

t("test 16: byKind sums to stalls; 496 stalls; kinds, accessible, EV and evReady counts", () => {
  const m = derived.metrics;
  eq(Object.values(m.byKind).reduce((a, b) => a + b, 0), m.stalls);
  eq(m.stalls, lv.reduce((s, l) => s + l.stalls.length, 0));
  eq(m.stalls, 496);                                                  // 500 - 4 stalls under the access aisles
  eq(m.byKind, { standard: 461, accessible: 8, van: 2, ev: 25 });    // 496 - 10 accessible - 25 EV = 461
  eq(m.accessible, { required: 10, provided: 10, van: 2 });
  eq(m.ev, { installed: 25, ready: 99 });
  eq(lv.flatMap((l) => l.stalls).filter((s) => s.evReady).length, 99);
  eq(lv.flatMap((l) => l.stalls).filter((s) => s.evReady === false).length, 0, "evReady is written only when true");
  eq(m.conflicts, 0);
  eq(m.bike, { required: 0, areaSf: 0 });                            // units unknown -> 0 bikes
  eq(m.levels, 5);
});

t("test 16: sfPerStall from the plates: 5 x 37,500 sf / 496 = 378.0", () => near(derived.metrics.sfPerStall, 378.0, 1e-9));

t("test 16: coordinates go back to the local frame (layout shifted by -150, -62.5)", () => {
  const xs = lv[0].plate[0].outer.map((p) => p[0]), ys = lv[0].plate[0].outer.map((p) => p[1]);
  eq([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-150, 150, -62.5, 62.5]);
  const s1 = lv[0].cores.find((c) => c.id === "S1").outer;
  eq([Math.min(...s1.map((p) => p[0])), Math.max(...s1.map((p) => p[0]))], [-125, -103]);      // layout 25..47
  eq(localMapper(built86)([150, 62.5]), [0, 0]);
});

t("test 16: per level 3 stalls kinds sum, 3 cores, 33 columns, 2 ramps, clear heights 8.5 then 8.0", () => {
  for (const l of lv) { eq(l.cores.map((c) => c.id), ["S1", "E1", "S2"]); eq(l.columns.length, 33); eq(l.ramps.length, 2); }
  eq(lv.map((l) => l.clearHeight), [8.5, 8, 8, 8, 8]);                // 11 - 2.5; 10.5 - 2.5
  eq(lv[0].ramps[0].slope, 0.022);                                    // 5.5 / 250
  eq(lv[1].ramps[0].slope, 0.021);                                    // 5.25 / 250
  eq(lv[0].ramps[0].outer3d.length, 4);
  ok(lv[0].ramps[0].outer3d.every((p) => p.length === 3));
});

t("test 16: stalls carry id, outer, kind only (evReady optional)", () => {
  for (const s of lv[0].stalls.slice(0, 40)) ok(Object.keys(s).every((k) => ["id", "outer", "kind", "evReady"].includes(k)) && typeof s.id === "string" && s.outer.length === 4);
});

t("test 16: inputs are not mutated", () => eq(JSON.stringify([state86, built86.levels, ramps86, metrics86.accessible]), snapshot));

t("derived falls back when metrics are missing (columns computed from the bays, ramps from built.ramps)", () => {
  const d = parkingDerived(state86, { ...built86, ramps: ramps86 }, {});
  eq(d.levels[0].columns.length, 33);
  eq(d.levels[0].ramps.length, 2);
  eq(d.metrics.stalls, 496);
  eq(d.metrics.accessible, { required: 10, provided: 10, van: 2 });
  eq(d.metrics.ev, { installed: 25, ready: 99 });
});

t("derived: bike fallback from units (50 units, 1 per 10 -> 5 bikes, 60 sf)", () => {
  const d = parkingDerived(state86, built86, { ...metrics86, units: 50 });
  eq(d.metrics.bike, { required: 5, areaSf: 60 });
});

t("derived: missing inputs throw", () => {
  let e1 = null; try { parkingDerived(null, built86, {}); } catch (e) { e1 = e; }
  ok(e1 && /state/.test(e1.message));
  let e2 = null; try { parkingDerived(state86, {}, {}); } catch (e) { e2 = e; }
  ok(e2 && /built.levels/.test(e2.message));
});

/* ---------- SketchUp ---------- */

t("sketchup: doc validates, source parking, groups in order", () => {
  const doc = parkingToSketchup(state86, built86, metrics86, { createdAt: "2026-10-21T00:00:00Z" });
  const v = validateDoc(doc);
  ok(v.ok, v.errors.join("; "));
  eq(doc.source, "parking");
  eq(doc.root.children.map((c) => c.name), ["Levels", "Stalls", "Ramps", "Columns", "Cores", "Barriers"]);
  eq(v.counts.mesh, 10);                                              // 2 ramps x 5 levels
  eq(doc.root.children[0].children.length, 5);                        // one slab per level
  eq(doc.root.children[4].children.map((c) => c.name), ["S1", "E1", "S2"]);
  const lines = doc.root.children[1].children[0].children.reduce((s, n) => s + n.lines.length, 0);
  eq(lines, built86.levels[0].stalls.length);
  eq(v.counts.solid, 5 + 165 + 3 + 5 * 4);                            // slabs + 33 columns x 5 + cores + 4 walls x 5
  ok(doc.notes.some((n) => /496 stalls/.test(n)));
  ok(doc.tags.every((tg) => doc.materials.some((m) => m.name === tg.name)));
});

t("sketchup: slab top is the floor surface, 1 ft thick; ramp mesh keeps its z", () => {
  const doc = parkingToSketchup(state86, built86, metrics86);
  const slab2 = doc.root.children[0].children[1];
  eq([slab2.z0, slab2.z1], [10, 11]);
  const mesh = doc.root.children[2].children[0];
  eq(mesh.vertices.map((v) => v[2]), [0, 5.5, 5.5, 0]);
  eq(mesh.triangles.length, 2);
});

t("sketchup: no ramps, columns or cores -> those groups are left out; still valid", () => {
  const s = structuredClone(state86); s.cores = [];
  const b = { ...built86, cores: [] };
  const doc = parkingToSketchup(s, b, { columnPoints: [] }, { name: "Bare" });
  ok(validateDoc(doc).ok, validateDoc(doc).errors.join("; "));
  eq(doc.root.children.map((c) => c.name), ["Levels", "Stalls", "Barriers"]);
});

/* ---------- test 17 ---------- */

const ACC81 = ACC86.slice(0, 9);                                      // plan 8.1: required 9 (R-2 off), van 2, car 7
const built81 = fixture(state81, { accessible: ACC81, aisles: 4, evInstalled: 25, evReady: 99 });
const ramps81 = helixRamps(state81, built81);
const dxf = parkingDxf(state81, built81, { ramps: ramps81, columnPoints: columnPts(state81, built81) });

/** DXF text → { layers: Set (LAYER table), ents: [{ type, layer, flag, vertices }] } */
function parseDxf(text) {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  eq(lines.length % 2, 0, "group code and value lines pair up");
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1]]);
  const layers = new Set(), ents = [];
  let sec = null, table = null, cur = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "SECTION") { sec = pairs[i + 1][1]; continue; }
    if (c === 0 && v === "ENDSEC") { sec = null; cur = null; continue; }
    if (sec === "TABLES") {
      if (c === 0 && v === "TABLE") table = pairs[i + 1][1];
      if (table === "LAYER" && c === 0 && v === "LAYER") layers.add(pairs[i + 1][1]);
    }
    if (sec === "ENTITIES" && c === 0) {
      if (v === "VERTEX") { if (cur) cur.vertices++; continue; }
      if (v === "SEQEND") { cur = null; continue; }
      cur = { type: v, layer: null, flag: null, vertices: 0 };
      ents.push(cur);
    } else if (sec === "ENTITIES" && cur) {
      if (c === 8 && cur.layer === null) cur.layer = v;
      if (c === 70 && cur.type === "POLYLINE" && cur.flag === null) cur.flag = parseInt(v, 10);
    }
  }
  return { layers, ents };
}
const P = parseDxf(dxf);
const countOn = (layer, type) => P.ents.filter((e) => e.layer === layer && (!type || e.type === type)).length;

t("test 17: DXF R12 header and every layer in the table", () => {
  ok(dxf.includes("AC1009") && dxf.endsWith("  0\nEOF\n"));
  for (const [name] of PARK_DXF_LAYERS) ok(P.layers.has(name), `layer ${name} missing`);
  eq([...P.layers].filter((n) => n.startsWith("PARK-")).length, 9);
  ok(!/NaN|undefined|Infinity/.test(dxf));
});

t("test 17: one closed polyline per stall on PARK-STALL and PARK-ACCESSIBLE, 496 in total", () => {
  const stall = P.ents.filter((e) => e.layer === "PARK-STALL" && e.type === "POLYLINE");
  const acc = P.ents.filter((e) => e.layer === "PARK-ACCESSIBLE" && e.type === "POLYLINE");
  eq(stall.length + acc.length, 496);                                 // 500 - 4 stalls under the access aisles
  eq(acc.length, 9);                                                  // 2 van + 7 car
  ok([...stall, ...acc].every((e) => e.flag === 1 && e.vertices === 4), "closed polyline of 4 vertices");
  eq(P.ents.filter((e) => (e.layer === "PARK-STALL" || e.layer === "PARK-ACCESSIBLE") && e.type !== "POLYLINE").length, 0);
});

t("test 17: slab, aisle, column, core, ramp and text entities per level", () => {
  eq(countOn("PARK-SLAB"), 5);                                        // one plate piece per level
  eq(countOn("PARK-AISLE"), 10);                                      // 2 bays x 5 levels
  eq(countOn("PARK-COLUMN"), 165);                                    // 33 x 5
  eq(countOn("PARK-CORE"), 15);                                       // 3 x 5
  eq(countOn("PARK-RAMP", "3DFACE"), 10);                             // 2 ramps x 5 levels, a quad each
  eq(countOn("PARK-RAMP-SEG"), 0);                                    // straight ramps: no segment pieces
  ok(countOn("PARK-TEXT", "TEXT") >= 5 + 10 + 15);                    // levels, ramps, cores
});

t("test 17: ramp face z values follow the ramp; local frame (x from -150)", () => {
  const i = dxf.indexOf("3DFACE");
  const chunk = dxf.slice(i, i + 400).split("\n");
  ok(chunk.includes("PARK-RAMP"));
  ok(dxf.includes(" 10\n-125.0\n"), "first ramp corner at local x -125 (layout 25)");
});

t("test 17: the DXF without parts reads built.ramps and computes the columns", () => {
  const P2 = parseDxf(parkingDxf(state81, { ...built81, ramps: ramps81 }));
  eq(P2.ents.filter((e) => e.layer === "PARK-COLUMN").length, 165);
  eq(P2.ents.filter((e) => e.layer === "PARK-RAMP" && e.type === "3DFACE").length, 10);
});

t("test 17: circular speed ramp writes the true circles and `segments` straight pieces", () => {
  const s = structuredClone(state81);
  s.levels.count = 2; s.ramp.type = "speed"; s.ramp.speed = { x: 99, y: 123, width: 24, length: 82, shape: "circular", insideRadius: 30, segments: 12 };
  const b = fixture(s);
  const octa = Array.from({ length: 16 }, (_, k) => [150 + 54 * Math.cos((2 * Math.PI * k) / 16), 62 + 54 * Math.sin((2 * Math.PI * k) / 16)]);
  const fp = rect(96, 8, 204, 116);
  const rp = [{ id: "R1", type: "speed", level: 1, rise: 11, slope: 0.1196, outer3d: octa.map((p, k) => [p[0], p[1], (11 * k) / 16]), footprint: fp }];
  const P3 = parseDxf(parkingDxf(s, b, { ramps: rp }));
  eq(P3.ents.filter((e) => e.layer === "PARK-RAMP-SEG" && e.type === "LINE").length, 12);
  eq(P3.ents.filter((e) => e.layer === "PARK-RAMP" && e.type === "CIRCLE").length, 2);
  ok(P3.ents.filter((e) => e.layer === "PARK-RAMP" && e.type === "3DFACE").length >= 14, "16-gon ear clipped into 14 triangles");
});

t("parkTriangulate: an L ring gives triangles of the same area; clockwise input works", () => {
  const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 30], [0, 30]];               // area 200 + 200 = 400
  for (const ring of [L, L.slice().reverse()]) {
    const tr = parkTriangulate(ring);
    eq(tr.length, 4);
    near(tr.reduce((a, [i, j, k]) => a + Math.abs(ringArea2([ring[i], ring[j], ring[k]])), 0), 400, 1e-9);
  }
});

/* ---------- test 18 ---------- */

// plan 8.7: 300 x 65, 1 bay: 2 x 27 = 54; cores take 3 + 2 + 3 + 3 = 11 -> N0 = 43; required 2 (van 1, car 1), aisle 8 ft -> 1 lost; stalls 42.
const built87 = fixture(state87, { accessible: [{ kind: "van" }, { kind: "accessible" }], aisles: 1 });
const csv = stallCsv(state87, built87);

t("test 18: stall CSV of preset 8.7 has 42 rows plus the header", () => {
  const rows = csv.split("\n");
  eq(rows.pop(), "", "ends with a newline");
  eq(rows.length, 43);
  eq(rows[0], "level,id,kind,ev_ready,x,y,width,depth");
  eq(built87.levels[0].stalls.length, 42);
  ok(rows.slice(1).every((r) => r.split(",").length === 8));
});

t("test 18: CSV row content: first stall P1-1S-006 centred at layout (74.5, 10) = local (-75.5, -22.5)", () => {
  const rows = csv.split("\n");
  eq(rows[1], "1,P1-1S-006,van,false,-75.500,-22.500,9.000,18.000");
  ok(rows.some((r) => r.startsWith("1,P1-1S-007,accessible,")));
  eq(rows.filter((r) => r.includes(",standard,")).length, 40);
});

t("test 18: CSV is the same stall set as the derived writer", () => {
  const d = parkingDerived(state87, built87, {});
  eq(d.metrics.stalls, 42);
  eq(d.metrics.byKind, { standard: 40, accessible: 1, van: 1 });
});

/* ---------- real layout, when it exists ---------- */

let realLayout = null;
try { realLayout = await import("../src/parking/layout.js"); } catch (e) { console.log("  note real layout not available: " + String(e.code || e.message).split("\n")[0]); }
if (realLayout && typeof realLayout.layout === "function") {
  let real = null, ramps = null, cols = null, why = "";
  try { real = realLayout.layout(structuredClone(state86)); } catch (e) { why = "layout() threw: " + e.message; }
  if (real) {
    try { const R = await import("../src/parking/ramps.js"); ramps = R.rampsFor(structuredClone(state86), real); } catch (e) { /* no ramps module */ }
    try { const G = await import("../src/parking/grid.js"); cols = G.columnsFor(structuredClone(state86), real).points; } catch (e) { /* no grid module */ }
    const parts = { ramps: ramps || undefined, columnPoints: cols || undefined };
    const rd = parkingDerived(state86, real, { ramps: ramps || [], columnPoints: cols || undefined });
    t("real layout: derived validates and every ring is clean", () => {
      const doc = writeSection(newProject({ name: "Real" }), "parking", { tool: "parking", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: state86, derived: rd });
      const v = validate(doc); ok(v.ok, v.errors.join("; "));
      for (const [r, hole, where] of allRings(rd)) ok(ringOk(r, hole), `${where} is not a clean ring`);
      eq(Object.values(rd.metrics.byKind).reduce((a, b) => a + b, 0), rd.metrics.stalls);
      eq(rd.levels.length, 5);
      console.log(`       real layout: ${rd.metrics.stalls} stalls (before accessible placement unless layout applies it), ${rd.levels[0].columns.length} columns/level, ${rd.levels[0].ramps.length} ramps on level 1, ramps ${ramps ? "from rampsFor" : "absent"}, columns ${cols ? "from columnsFor" : "computed"}`);
    });
    t("real layout: SketchUp doc validates, DXF stall polylines equal the stall count, CSV rows too", () => {
      const doc = parkingToSketchup(state86, real, { ramps: ramps || [], columnPoints: cols || undefined });
      const v = validateDoc(doc); ok(v.ok, v.errors.join("; "));
      const X = parseDxf(parkingDxf(state86, real, parts));
      const nPoly = X.ents.filter((e) => (e.layer === "PARK-STALL" || e.layer === "PARK-ACCESSIBLE") && e.type === "POLYLINE").length;
      eq(nPoly, rd.metrics.stalls);
      eq(stallCsv(state86, real).split("\n").length - 2, rd.metrics.stalls);
    });
  } else console.log("  note real layout not run: " + why);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
