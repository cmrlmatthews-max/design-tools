/* ==========================================================================
   parking/sketchup.js — Parking Deck Generator → ".sketchup.json" (docs/sketchup-spec.md section 4)

   parkingToSketchup(state, built, metrics, meta) → a document made with makeDoc (passes validateDoc).
     state    the parking state
     built    layout(state): { frame, levels[{ index, z, ftf, plate, stalls, aisles }], cores, bays, … }
     metrics  computeMetrics rows; also read for the optional parts of derived.js:
              metrics.ramps (rampsFor rows), metrics.columnPoints (columnsFor points), metrics.clearHeights
     meta     optional { createdAt, name, location, zShift }

   Pure: no DOM, no Clipper. Units: feet. Plan (x, y): x = east, y = north. z up. Local (massing) frame.

   Rule choices (where the spec leaves room):
   - Group order: Levels, Stalls, Ramps, Columns, Cores, Barriers. A group with nothing in it is left out.
   - Levels: one slab solid per level, 1 ft thick, its top at the floor surface z. A plate that falls into
     several pieces is a group "Level n" with one solid per piece ("Level n · piece k").
   - Stalls: closed outlines at the floor surface, one group per level, one "lines" node per tag:
     "Stalls" (standard, compact), "Accessible" (accessible, van), "EV" (ev).
   - Ramps: one mesh per ramp per level, from its outer3d (ear-clipped in plan). A helix or sloped bay is
     drawn on top of the flat slab, so the slab and the ramp overlap in those bays.
   - Columns: one solid per column per level, floor surface to the underside of the slab above (ftf - 1).
   - Cores: one solid per core, from the lowest slab to the top of the highest level.
   - Barriers: a wall of `checks.barrierProvided` (default 3.5 ft) along every plate edge, thickness
     `footprint.perimeter` (default 0.5 ft) inward of the edge, one solid per edge per level.
   - doc.source is "parking" (SKETCHUP_SOURCE). validateDoc accepts it; the SketchUp importer needs the same.
   ========================================================================== */

import { cleanRing2, makeDoc } from "../shared/sketchup-format.js";
import { parkingDerived } from "./derived.js";
import { parkTriangulate } from "./exports.js";

export const SKETCHUP_SOURCE = "parking";

const COLORS = {
  Levels: "#9aa1a9", Stalls: "#5b6670", Accessible: "#2f6fd1", EV: "#58a65c",
  Ramps: "#d9a22b", Columns: "#6b7280", Cores: "#c2607a", Barriers: "#7a8fa6",
};
const SLAB = 1;

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function ringsArea(pc) {
  const a = (ring) => { let s = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s / 2); };
  return a(pc.outer) - pc.holes.reduce((s, h) => s + a(h), 0);
}

const closedLine = (ring, z) => [...ring, ring[0]].map((p) => [p[0], p[1], z]);
const square = (c, s) => [[c[0] - s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] - s / 2], [c[0] + s / 2, c[1] + s / 2], [c[0] - s / 2, c[1] + s / 2]];

/** Inward wall rectangles along a ring (counter-clockwise outer or clockwise hole: the slab is on the left of each edge). */
function wallRings(ring, t) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const nx = (-dy / len) * t, ny = (dx / len) * t;
    const w = cleanRing2([a, b, [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]);
    if (w) out.push(w);
  }
  return out;
}

export function parkingToSketchup(state, built, metrics, meta) {
  if (!state) throw new Error('parkingToSketchup: missing input "state".');
  if (!built || !Array.isArray(built.levels)) throw new Error('parkingToSketchup: missing input "built.levels".');
  const mt = meta || {};
  const d = parkingDerived(state, built, metrics);

  const tagList = [], matList = [], declared = new Set();
  const declare = (name, visible = true) => {
    if (declared.has(name)) return;
    declared.add(name);
    tagList.push({ name, color: COLORS[name], visible });
    matList.push({ name, color: COLORS[name], alpha: 1 });
  };

  const levelsKids = [], stallKids = [], rampKids = [], columnKids = [], barrierKids = [];
  const column = num(state.grid && state.grid.column, 2);
  const barrierH = num(state.checks && state.checks.barrierProvided, 3.5);
  const wallT = num(state.footprint && state.footprint.perimeter, 0) > 0 ? state.footprint.perimeter : 0.5;
  let slabs = 0, gross = 0, ramps = 0;
  let zLow = Infinity, zTop = -Infinity;

  d.levels.forEach((lv, i) => {
    const src = built.levels[i] || {};
    const ftf = num(src.ftf, 10.5);
    const name = `Level ${lv.index}`;
    const z = lv.z;
    zLow = Math.min(zLow, z - SLAB);
    zTop = Math.max(zTop, z + ftf);

    // slab
    if (lv.plate.length) {
      declare("Levels");
      const solid = (nm, pc, extra = {}) => ({ type: "solid", name: nm, tag: "Levels", material: "Levels", outer: pc.outer, holes: pc.holes, z0: r3(z - SLAB), z1: r3(z), ...extra });
      const area = lv.plate.reduce((s, pc) => s + ringsArea(pc), 0);
      const attributes = { level: lv.index, stalls: lv.stalls.length, area_sf: r2(area) };
      levelsKids.push(lv.plate.length === 1
        ? solid(name, lv.plate[0], { attributes })
        : { type: "group", name, tag: "Levels", material: "Levels", attributes, children: lv.plate.map((pc, k) => solid(`${name} · piece ${k + 1}`, pc)) });
      slabs += lv.plate.length;
      gross += area;
    }

    // stalls
    const by = { Stalls: [], Accessible: [], EV: [] };
    for (const s of lv.stalls) by[s.kind === "accessible" || s.kind === "van" ? "Accessible" : s.kind === "ev" ? "EV" : "Stalls"].push(closedLine(s.outer, z));
    const nodes = [];
    for (const [tag, lines] of Object.entries(by)) {
      if (!lines.length) continue;
      declare(tag);
      nodes.push({ type: "lines", name: `${name} ${tag.toLowerCase()}`, tag, material: tag, lines });
    }
    if (nodes.length) stallKids.push({ type: "group", name, children: nodes });

    // ramps
    for (const rp of lv.ramps) {
      const tris = parkTriangulate(rp.outer3d);
      if (!tris.length) continue;
      declare("Ramps");
      rampKids.push({ type: "mesh", name: `${name} · ${rp.id}`, tag: "Ramps", material: "Ramps", vertices: rp.outer3d.map((p) => p.slice()), triangles: tris, soft: false, closed: false, attributes: { level: lv.index, slope: rp.slope } });
      ramps++;
    }

    // columns
    if (lv.columns.length && ftf - SLAB > 0.5) {
      declare("Columns");
      const kids = [];
      lv.columns.forEach((c, k) => {
        const outer = cleanRing2(square(c, column));
        if (outer) kids.push({ type: "solid", name: `C${k + 1}`, tag: "Columns", material: "Columns", outer, holes: [], z0: r3(z), z1: r3(z + ftf - SLAB) });
      });
      if (kids.length) columnKids.push({ type: "group", name, children: kids });
    }

    // barriers
    const walls = [];
    for (const pc of lv.plate) for (const ring of [pc.outer, ...pc.holes]) for (const w of wallRings(ring, wallT)) walls.push(w);
    if (walls.length && barrierH > 0.1) {
      declare("Barriers");
      barrierKids.push({ type: "group", name, children: walls.map((w, k) => ({ type: "solid", name: `Wall ${k + 1}`, tag: "Barriers", material: "Barriers", outer: w, holes: [], z0: r3(z), z1: r3(z + barrierH) })) });
    }
  });

  // cores: the same in plan on every level
  const coreKids = [];
  const cores = d.levels.length ? d.levels[0].cores : [];
  if (cores.length && isFinite(zLow) && zTop - zLow > 0.01) {
    declare("Cores");
    for (const c of cores) coreKids.push({ type: "solid", name: c.id, tag: "Cores", material: "Cores", outer: c.outer, holes: [], z0: r3(zLow), z1: r3(zTop), attributes: { kind: c.kind } });
  }

  const children = [];
  if (levelsKids.length) children.push({ type: "group", name: "Levels", children: levelsKids });
  if (stallKids.length) children.push({ type: "group", name: "Stalls", children: stallKids });
  if (rampKids.length) children.push({ type: "group", name: "Ramps", children: rampKids });
  if (columnKids.length) children.push({ type: "group", name: "Columns", children: columnKids });
  if (coreKids.length) children.push({ type: "group", name: "Cores", children: coreKids });
  if (barrierKids.length) children.push({ type: "group", name: "Barriers", children: barrierKids });

  const m = d.metrics;
  const name = String(mt.name || state.name || "Parking Deck");
  const notes = [
    "Plan origin = the tool's plan origin (0, 0) in the massing frame. x = east, y = north. Lengths in feet. z = floor surface above the base.",
    `Parking Deck Generator: ${m.levels} levels, ${m.stalls} stalls, ${m.sfPerStall} sf per stall, gross deck area ${Math.round(gross).toLocaleString("en-US")} sf, ${ramps} ramp meshes.`,
    "Each level is a 1 ft slab whose top is the floor surface. Stalls are outlines on the floor surface. Helix and sloped bays show as ramp meshes on top of the flat slab.",
  ];

  return makeDoc({
    source: SKETCHUP_SOURCE, name, location: mt.location || null, zShift: num(mt.zShift, 0), notes,
    tags: tagList, materials: matList, createdAt: mt.createdAt,
    root: { type: "group", name, children },
  });
}
