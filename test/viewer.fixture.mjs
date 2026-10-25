// Fixtures for the Model Viewer tests (docs/model-viewer-technical-plan.md section 6).
// Every derived block comes from the tools' own modules: Tower preset -> towerDerived, Plate Planner -> platesDerived,
// Parking Deck, Facade Studio and Grading Sketch pipelines, the Sun Study's solar module. The site is a small hand grid
// (the one the in-page project tests use): 1,000 ft square, ground z = 1000 + 0.01 x + 0.02 y, two neighbor buildings.
//
// Run: node test/viewer.fixture.mjs   writes test/viewer.fixture.json, the project the in-page tests and the screenshot load.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const R = "../src/";
const TG = await import(R + "tower/geometry.js");
const TD = await import(R + "tower/derived.js");
const TP = await import(R + "tower/presets.js");
const PF = await import(R + "plate/fill.js");
const PM = await import(R + "plate/metrics.js");
const PD = await import(R + "plate/derived.js");
const PP = await import(R + "plate/presets.js");
const KL = await import(R + "parking/layout.js");
const KR = await import(R + "parking/ramps.js");
const KG = await import(R + "parking/grid.js");
const KA = await import(R + "parking/accessible.js");
const KM = await import(R + "parking/metrics.js");
const KD = await import(R + "parking/derived.js");
const KP = await import(R + "parking/presets.js");
const FP = await import(R + "facade/panels.js");
const FM = await import(R + "facade/metrics.js");
const FD = await import(R + "facade/derived.js");
const FS = await import(R + "facade/presets.js");
const GF = await import(R + "grading/features.js");
const GM = await import(R + "grading/metrics.js");
const GD = await import(R + "grading/derived.js");
const GP = await import(R + "grading/presets.js");
const SO = await import(R + "shared/solar.js");
const PJ = await import(R + "shared/project.js");

export const clone = (o) => JSON.parse(JSON.stringify(o));
const r2 = (v) => Math.round(v * 100) / 100;
const IDENTITY = { x: 0, y: 0, rotation: 0, baseZ: 0 };

/** The site section: 1,000 ft square, 11 by 11 ground grid at 100 ft, two neighbors. */
export function siteSection() {
  const S = 1000, N = 11, SP = 100, points = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) points.push([i * SP, j * SP, 1000 + 0.01 * i * SP + 0.02 * j * SP]);
  return {
    tool: "site", schema: 1, placement: IDENTITY,
    state: { query: "Fixture", lat: 33.927, lon: -84.339, size: S, release: "test", walks: false },
    derived: {
      address: "Fixture", lat: 33.927, lon: -84.339, size: S, release: "test",
      boundary: [[0, 0], [S, 0], [S, S], [0, S]], ground: { spacing: SP, n: N, points },
      buildings: [
        { id: "near", outer: [[300, 380], [380, 380], [380, 420], [300, 420]], holes: [], base: 1009, height: 40, top: 1049, floors: 3, rule: "data", name: "Near" },
        { id: "far", outer: [[850, 850], [900, 850], [900, 900], [850, 900]], holes: [], base: 1030, height: 30, top: 1060, floors: 2, rule: "data", name: "Far" },
        { id: "gone", outer: [[100, 100], [140, 100], [140, 140], [100, 140]], holes: [], base: 1003, height: 50, top: 1053, floors: 4, rule: "estimate", name: "Removed", removed: true },
      ],
      roads: { segments: [], pavement: [] }, walks: null, trees: [], water: { areas: [], lines: [] },
    },
  };
}

export const TOWER_PLACEMENT = { x: 560, y: 520, rotation: 20, baseZ: 1016 };      // the ground at the placement point: 1000 + 0.01 x + 0.02 y
export const DECK_PLACEMENT = { x: 250, y: 700, rotation: 0, baseZ: 1016 };

/** The Tower Generator output for a preset id: { state, derived }. */
export function towerSection(id = "l-multifamily-podium", placement = TOWER_PLACEMENT) {
  const state = clone(TP.PRESETS.find((p) => p.id === id).state);
  const built = TG.buildPlates(state);
  const derived = TD.towerDerived(state, built, TG.computeMetrics(state, built.plates || built));
  return { tool: "tower", schema: 1, placement: clone(placement), state, derived };
}

/** The Plate Planner output on a massing section (Plate preset 8.1 defaults, project source, automatic core). */
export function platesSection(massing, { skipGroups = [] } = {}) {
  const s = PP.defaultState();
  s.source = "project"; s.core = { mode: "auto", rect: null }; s.corridor.kind = "auto";
  const project = { sections: { massing } };
  const first = PF.buildPlates(s, { project });
  if (skipGroups.length) { s.levels = { groups: {} }; for (const g of first.groups) if (skipGroups.includes(g.first)) s.levels.groups[g.id] = { filled: false }; }
  const built = skipGroups.length ? PF.buildPlates(s, { project }) : first;
  const metrics = PM.computeMetrics(s, built);
  const derived = PD.platesDerived(s, built, metrics);
  derived.massingUpdatedAt = massing.updatedAt || derived.massingUpdatedAt || null;
  return { tool: "plate", schema: 1, placement: clone(massing.placement), state: s, derived };
}

/** The Parking Deck output for its first preset (standalone, five levels, two bays), at its own placement. */
export function parkingSection(placement = DECK_PLACEMENT) {
  const s = clone(KP.PRESETS[0].state);
  const raw = KL.layout(s);
  const ramps = KR.rampsFor(s, raw);
  const columns = KG.columnsFor(s, raw);
  const acc0 = KA.placeAccessible(s, raw);
  const acc = { ...acc0, stalls: KA.tagEv(s, acc0.stalls) };
  const byLevel = new Map();
  for (const st of acc.stalls) { if (!byLevel.has(st.level)) byLevel.set(st.level, []); byLevel.get(st.level).push(st); }
  const levels = raw.levels.map((lv) => ({ ...lv, stalls: byLevel.get(lv.index) || [] }));
  const built = { ...raw, levels, ramps, columns };
  const metrics = KM.computeMetrics(s, built, ramps, columns, acc, null);
  const derived = KD.parkingDerived(s, built, { ...metrics, ramps, columnPoints: columns.points });
  return { tool: "parking", schema: 1, placement: clone(placement), state: s, derived };
}

/** The Facade Studio output on a massing project (the residential preset on the tower levels). */
export function facadeSection(project, placement) {
  const s = clone(FS.PRESETS[0].state);
  s.source = "project";
  const built = FP.buildFacade(s, { project });
  const metrics = FM.computeMetrics(s, built, project);
  const derived = FD.facadeDerived(s, built, metrics);
  return { tool: "facade", schema: 1, placement: clone(placement), state: s, derived };
}

/** The Grading Sketch output on a project with a site, a massing and a parking deck (project source, site ground). */
export function gradingSection(project) {
  const s = GP.defaultState();
  s.source = "project"; s.ground.mode = "site";
  s.buildings = [
    { id: "M1", name: "Massing", source: "massing", axis: "auto", tiers: [{ length: null, ffe: "balance" }], padOffset: 5, padDepth: 1 },
    { id: "P1", name: "Parking deck", source: "parking", axis: "auto", tiers: [{ length: null, ffe: "balance" }], padOffset: 5, padDepth: 1 },
  ];
  s.walls = [{ id: "W1", line: [[90, 628], [260, 628], [410, 640]], kind: "drawn" }];     // a drawn wall on the south edge of the deck pad
  const built = GF.buildGrading(s, { project });
  const metrics = GM.computeMetrics(s, built);
  const derived = GD.gradingDerived(s, built, metrics);
  return { tool: "grading", schema: 1, placement: clone(IDENTITY), state: s, derived };
}

/** The Sun Study output: three dates, three times (the Tower Generator's sunDerived rule). */
export function sunSection(lat = 33.927, lon = -84.339) {
  const tz = { zone: "us-eastern", offset: -5 };
  const dates = ["2026-03-20", "2026-06-21", "2026-12-21"], samples = [];
  for (const date of dates) for (const m of [540, 720, 900]) {
    const p = SO.sunPosition(lat, lon, SO.localToUTC(date, m, tz.offset));
    samples.push({ date, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:00`, azimuth: r2(p.azimuth), altitude: r2(p.altitude) });
  }
  return { tool: "tower", schema: 1, placement: clone(IDENTITY), state: {}, derived: { lat, lon, tzOffset: -5, dates, samples, sunHours: null } };
}

/** Writes sections in order. `secs` = { key: section }. Returns the document. A section's updatedAt can be forced with `stamps`. */
export function assemble(secs, { name = "Viewer fixture", stamps = {} } = {}) {
  let doc = PJ.newProject({ name, frame: secs.site ? { kind: "site", lat: 33.927, lon: -84.339, size: 1000 } : undefined });
  for (const key of PJ.SECTIONS) {
    if (!secs[key]) continue;
    doc = PJ.writeSection(doc, key, { tool: secs[key].tool, schema: secs[key].schema, placement: secs[key].placement, state: secs[key].state, derived: secs[key].derived });
    if (stamps[key]) doc = { ...doc, sections: { ...doc.sections, [key]: { ...doc.sections[key], updatedAt: stamps[key] } } };
  }
  return doc;
}

/** The full project: site, tower massing (rotated), plates on the tower levels (the podium stays massing), parking, facade, grading, sun. */
export function fullProject() {
  const site = siteSection();
  const massing = towerSection();
  massing.updatedAt = "2026-10-24T10:00:00.000Z";
  const plates = platesSection(massing);
  const parking = parkingSection();
  const base = assemble({ site, massing }, { stamps: { massing: massing.updatedAt } });
  const facade = facadeSection(base, massing.placement);
  const withParking = assemble({ site, massing, parking }, { stamps: { massing: massing.updatedAt } });
  const grading = gradingSection(withParking);
  const sun = sunSection();
  return assemble({ site, massing, plates, parking, facade, grading, sun }, {
    name: "Viewer fixture",
    stamps: { massing: "2026-10-24T10:00:00.000Z", plates: "2026-10-24T10:05:00.000Z", parking: "2026-10-24T10:06:00.000Z", facade: "2026-10-24T10:07:00.000Z", grading: "2026-10-24T10:08:00.000Z", sun: "2026-10-24T10:09:00.000Z", site: "2026-10-24T09:00:00.000Z" },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const doc = fullProject();
  const text = JSON.stringify(doc);
  writeFileSync(fileURLToPath(new URL("./viewer.fixture.json", import.meta.url)), text);
  console.log("wrote test/viewer.fixture.json", (text.length / 1024).toFixed(0), "KB;", Object.keys(doc.sections).join(", "));
  console.log(PJ.validate(doc));
}
