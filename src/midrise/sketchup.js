/* ==========================================================================
   midrise/sketchup.js — Mid-Rise Generator → ".sketchup.json" (docs/sketchup-spec.md section 4)

   midriseToSketchup(state, built, metrics, meta) → a document made with makeDoc (passes validateDoc).
     state    the mid-rise state (names, programs and colors, courts, context blocks)
     built    assemble(state): levels[{ index, zone, z, ftf, program, plates }], courtyards, solids
     metrics  computeMetrics rows (a number, or an object with .total / .value); only used for the notes
     meta     optional { createdAt, name, location, zShift }

   Pure: no DOM, no Clipper. Units: feet. Plan (x, y): x = east, y = north. z up.

   Rule choices (where the spec leaves room):
   - Group order: Podium, Bars, Deck, Courts, Context. A group with nothing in it is left out.
   - Bars holds one solid per bar level ("Floor n"), at full floor-to-floor height. The level plate is the
     union of the bars on that level, so a level whose bars do not touch is a group "Floor n" with one solid
     per piece ("Floor n · piece k"). Podium and Deck levels are named the same way ("Podium n", "Deck n").
   - Tags and materials: one per program used (named like the program, "Residential"), plus "Roof", "Courts"
     and "Context" only when something uses them. Tag color = program color. The "Courts" tag is hidden.
   - Courts: outline lines at ground level, in a hidden group: the open courts of state.courts and the
     closed courtyards of built.courtyards.
   - The roof screen (a prism in built.solids) is a solid "Screen" inside Bars.
   - doc.source is "midrise" (SKETCHUP_SOURCE). validateDoc and the SketchUp importer accept it.
   ========================================================================== */

import { cleanRing2, makeDoc } from "../shared/sketchup-format.js";
import { levelNames } from "./derived.js";

/** The `source` value written to the document. Change to "midrise" once validateDoc and importer.rb accept it. */
export const SKETCHUP_SOURCE = "midrise";

const PROGRAM_COLORS = {
  residential: "#4f7fd1", hotel: "#8a63c9", senior: "#c2607a", retail: "#d9a22b",
  amenity: "#58a65c", leasing: "#7a8fa6", parking: "#8b929a",
};
const ROOF_COLOR = "#d9a22b";
const COURT_COLOR = "#58a65c";
const CONTEXT_COLOR = "#c3c8ce";
const FALLBACK_COLOR = "#8b929a";
const HEX = /^#[0-9a-fA-F]{6}$/;

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const cap = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
const metricNumber = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") for (const k of ["total", "value"]) if (typeof v[k] === "number" && Number.isFinite(v[k])) return v[k];
  return null;
};

/** Tag and material name for a program key: "residential" → "Residential". */
export const programLabel = (key) => cap(key) || "Program";

function programColor(state, key) {
  const c = state && state.programs && state.programs[key] && state.programs[key].color;
  return HEX.test(c || "") ? c : PROGRAM_COLORS[key] || FALLBACK_COLOR;
}

function cleanPiece(poly) {
  const outer = cleanRing2(poly && poly.outer);
  if (!outer) return null;
  const holes = [];
  for (const h of (poly && poly.holes) || []) {
    const c = cleanRing2(h, { hole: true });
    if (c) holes.push(c);
  }
  return { outer, holes };
}
const piecesOf = (mp) => (Array.isArray(mp) ? mp : []).map(cleanPiece).filter(Boolean);

function pieceArea(pc) {
  const a = (ring) => { let s = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s / 2); };
  return a(pc.outer) - pc.holes.reduce((s, h) => s + a(h), 0);
}

const rectRing = (x, y, w, d) => [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];

export function midriseToSketchup(state, built, metrics, meta) {
  if (!state) throw new Error('midriseToSketchup: missing input "state".');
  if (!built || !Array.isArray(built.levels)) throw new Error('midriseToSketchup: missing input "built.levels".');
  const m = metrics || {}, mt = meta || {};

  const tagList = [], matList = [], declared = new Set();
  const declare = (name, color, visible = true) => {
    if (declared.has(name)) return;
    declared.add(name);
    tagList.push({ name, color, visible });
    matList.push({ name, color, alpha: 1 });
  };

  // ---- levels, by zone -----------------------------------------------------------
  const names = levelNames(built.levels);
  const zoneKids = { podium: [], bar: [], deck: [] };
  let floorSolids = 0, gfa = 0, top = 0;
  built.levels.forEach((l, i) => {
    const pieces = piecesOf(l.plates);
    if (!pieces.length || !(num(l.ftf, 0) > 0)) return;
    const prog = l.program || (l.zone === "deck" ? "parking" : "residential");
    const label = programLabel(prog);
    declare(label, programColor(state, prog));
    const z0 = r3(l.z), z1 = r3(l.z + l.ftf);
    const area = pieces.reduce((s, pc) => s + pieceArea(pc), 0);
    const name = names[i];
    const attributes = { level: l.index, zone: l.zone, program: prog, area_sf: r2(area) };
    const solid = (nm, pc, extra = {}) => ({ type: "solid", name: nm, tag: label, material: label, outer: pc.outer, holes: pc.holes, z0, z1, ...extra });
    const node = pieces.length === 1
      ? solid(name, pieces[0], { attributes })
      : { type: "group", name, tag: label, material: label, attributes, children: pieces.map((pc, k) => solid(`${name} · piece ${k + 1}`, pc)) };
    floorSolids += pieces.length;
    gfa += area;
    if (l.zone !== "deck") top = Math.max(top, z1);
    (zoneKids[l.zone] || zoneKids.bar).push(node);
  });

  // ---- roof screen ---------------------------------------------------------------
  for (const s of built.solids || []) {
    if (!s || s.kind !== "prism" || s.role !== "screen") continue;
    const z0 = r3(s.z0), z1 = r3(s.z1);
    if (!(z1 - z0 > 0.001)) continue;
    const pieces = piecesOf(s.polygons);
    if (!pieces.length) continue;
    declare("Roof", ROOF_COLOR);
    pieces.forEach((pc, k) => zoneKids.bar.push({ type: "solid", name: pieces.length > 1 ? `Screen · piece ${k + 1}` : "Screen", tag: "Roof", material: "Roof", outer: pc.outer, holes: pc.holes, z0, z1 }));
    top = Math.max(top, z1);
  }

  const children = [];
  if (zoneKids.podium.length) children.push({ type: "group", name: "Podium", children: zoneKids.podium });
  if (zoneKids.bar.length) children.push({ type: "group", name: "Bars", children: zoneKids.bar });
  if (zoneKids.deck.length) children.push({ type: "group", name: "Deck", children: zoneKids.deck });

  // ---- courts (hidden guides) ----------------------------------------------------
  const lines = [];
  const outline = (ring) => { const c = cleanRing2(ring); return c ? [...c, c[0]].map((p) => [p[0], p[1], 0]) : null; };
  for (const c of state.courts || []) {
    if (!(num(c.w, 0) > 0 && num(c.d, 0) > 0)) continue;
    const l = outline(rectRing(num(c.x, 0), num(c.y, 0), c.w, c.d));
    if (l) lines.push(l);
  }
  for (const c of built.courtyards || []) {
    if (c && c.kind === "closed" && Array.isArray(c.ring)) { const l = outline(c.ring); if (l) lines.push(l); }
  }
  if (lines.length) {
    declare("Courts", COURT_COLOR, false);
    children.push({ type: "group", name: "Courts", tag: "Courts", children: [{ type: "lines", name: "Court outlines", lines }] });
  }

  // ---- context -------------------------------------------------------------------
  const ctx = state.context;
  const blockKids = [];
  if (ctx && ctx.show !== false) {
    for (const b of ctx.blocks || []) {
      const w = num(b && b.w, 0), d = num(b && b.d, 0), h = num(b && b.h, 0);
      if (!(w > 0 && d > 0 && h > 0)) continue;
      const outer = cleanRing2(rectRing(num(b.x, 0), num(b.y, 0), w, d));
      if (!outer) continue;
      blockKids.push({ type: "solid", name: `Block ${blockKids.length + 1}`, tag: "Context", material: "Context", outer, holes: [], z0: 0, z1: r3(h) });
    }
  }
  if (blockKids.length) {
    declare("Context", CONTEXT_COLOR);
    children.push({ type: "group", name: "Context", tag: "Context", material: "Context", children: blockKids });
  }

  const name = String(mt.name || state.name || "Mid-Rise");
  const units = metricNumber(m.units);
  const gfaOut = metricNumber(m.gfa);
  const notes = [
    "Plan origin = the tool's plan origin (0, 0). x = east, y = north. Lengths in feet.",
    `Mid-Rise Generator: ${floorSolids} level solids, gross floor area ${Math.round(gfaOut === null ? gfa : gfaOut).toLocaleString("en-US")} sf, top of floors ${r2(top)} ft${units === null ? "" : `, about ${units} units (estimate)`}.`,
    "Each level is one solid at full floor-to-floor height. The Courts group is hidden; turn on the Courts tag to see the outlines.",
  ];

  return makeDoc({
    source: SKETCHUP_SOURCE, name, location: mt.location || null, zShift: num(mt.zShift, 0), notes,
    tags: tagList, materials: matList, createdAt: mt.createdAt,
    root: { type: "group", name, children },
  });
}
