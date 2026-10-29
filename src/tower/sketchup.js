/* ==========================================================================
   tower/sketchup.js — Tower Generator → ".sketchup.json" (docs/sketchup-spec.md section 4)

   towerToSketchup(state, built) → a document made with makeDoc (passes validateDoc).
     state  the tower state (names, programs and colors, context blocks)
     built  buildPlates(state) → { plates, solids }

   Pure: no DOM, no Clipper. Units: feet. Plan (x, y): x = east, y = north. z up.

   Rule choices (where the spec leaves room):
   - Group order: Podium, Segment 1 · Program, …, Crown, Context. A group with nothing in it
     is left out. A mechanical floor goes in the group of the zone it sits in (the segment
     below it, or the podium) and carries the "Mechanical" tag and material.
   - Tags and materials: one per program used (named like the program, "Residential"), plus
     "Crown" and "Context" only when something uses them. Tag color = program color.
   - A floor with one piece is a solid named "Floor n". A floor with several pieces is a
     group "Floor n" holding one solid per piece ("Floor n · piece k"). Tag and material go
     on both the group and its solids. Attributes (floor, program, area_sf) sit on the
     "Floor n" node.
   - Crown meshes are welded (equal points share a vertex) and triangles that collapse are
     dropped. Prisms become solids, one per polygon piece.
   - Context blocks come from state.context.blocks; none when state.context.show is false.
   - Several towers (segments with `tower`, October 29, 2026): every tower is exported. A segment group is named
     "Tower k · Segment j · Program" (j counts the segments of that tower). Crown solids carry the tower name
     ("Tower k · Parapet"). One tower: names as before.
   ========================================================================== */

import { cleanRing2, makeDoc } from "../shared/sketchup-format.js";

const PROGRAM_COLORS = {
  residential: "#4f7fd1", hotel: "#8a63c9", office: "#2f9e9a", retail: "#d9a22b",
  amenity: "#58a65c", parking: "#8b929a", mechanical: "#e0762f",
};
const CROWN_COLOR = "#d9a22b";
const CONTEXT_COLOR = "#c3c8ce";
const FALLBACK_COLOR = "#8b929a";
const HEX = /^#[0-9a-fA-F]{6}$/;

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const cap = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };

/** Tag and material name for a program key: "residential" → "Residential". */
export const programLabel = (key) => cap(key) || "Program";

function programColor(state, key) {
  const c = state && state.programs && state.programs[key] && state.programs[key].color;
  return HEX.test(c || "") ? c : PROGRAM_COLORS[key] || FALLBACK_COLOR;
}

/** One multipolygon piece {outer, holes} → { outer, holes } cleaned, or null when the outer ring is degenerate. */
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

/** Weld equal points of a flat-position mesh and drop triangles that collapse. → { vertices, triangles } */
function weldMesh(positions, indices) {
  const keyToIdx = new Map(), vertices = [], remap = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const p = [r3(positions[i]), r3(positions[i + 1]), r3(positions[i + 2])];
    const key = p.join(",");
    let k = keyToIdx.get(key);
    if (k === undefined) { k = vertices.length; vertices.push(p); keyToIdx.set(key, k); }
    remap.push(k);
  }
  const triangles = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    if (a === undefined || b === undefined || c === undefined) continue;
    if (a === b || b === c || a === c) continue;
    triangles.push([a, b, c]);
  }
  return { vertices, triangles };
}

export function towerToSketchup(state, built) {
  state = state || {};
  const plates = (built && built.plates) || [];
  const crownSolids = (built && built.solids) || [];

  const tagList = [], matList = [];
  const declared = new Set();
  const declare = (name, color) => {
    if (declared.has(name)) return;
    declared.add(name);
    tagList.push({ name, color, visible: true });
    matList.push({ name, color, alpha: 1 });
  };

  // ---- floors, grouped by zone ------------------------------------------------
  const segsAll = Array.isArray(state.segments) ? state.segments : [];
  const towerOfSeg = (seg) => (seg && typeof seg.tower === "number" && Number.isFinite(seg.tower) && seg.tower > 0 ? Math.round(seg.tower) : 0);
  const towerKeys = [...new Set(segsAll.map(towerOfSeg))].sort((a, b) => a - b);
  const multi = towerKeys.length > 1;
  const groups = new Map();                       // key → { name, children, order }
  const groupFor = (plate) => {
    if (plate.zone === "podium" || plate.segmentIndex < 0) return ["podium", "Podium", -1];
    const si = plate.segmentIndex;
    const seg = segsAll[si];
    const prog = (seg && seg.program) || plate.program;
    if (!multi) return [`seg${si}`, `Segment ${si + 1} · ${programLabel(prog)}`, si];
    const tw = towerOfSeg(seg);
    const j = segsAll.slice(0, si + 1).filter((g) => towerOfSeg(g) === tw).length;   // 1-based within the tower
    return [`seg${si}`, `Tower ${tw + 1} · Segment ${j} · ${programLabel(prog)}`, towerKeys.indexOf(tw) * 100000 + si];
  };

  let floorSolids = 0;
  for (const p of plates) {
    if (p.void || !(p.area > 0)) continue;
    const pieces = piecesOf(p.polygons);
    if (!pieces.length) continue;
    const prog = p.program || "residential";
    const label = programLabel(prog);
    declare(label, programColor(state, prog));
    const z0 = r3(p.z), z1 = r3(p.z + p.ftf);
    const name = `Floor ${p.n}`;
    const attributes = { floor: p.n, program: prog, area_sf: r2(p.area) };
    const solid = (nm, piece, extra = {}) => ({ type: "solid", name: nm, tag: label, material: label, outer: piece.outer, holes: piece.holes, z0, z1, ...extra });
    let node;
    if (pieces.length === 1) {
      node = solid(name, pieces[0], { attributes });
    } else {
      node = { type: "group", name, tag: label, material: label, attributes, children: pieces.map((pc, i) => solid(`${name} · piece ${i + 1}`, pc)) };
    }
    floorSolids += pieces.length;
    const [key, gname, order] = groupFor(p);
    let g = groups.get(key);
    if (!g) { g = { name: gname, children: [], order }; groups.set(key, g); }
    g.children.push(node);
  }

  const children = [];
  const ordered = [...groups.values()].sort((a, b) => a.order - b.order);
  for (const g of ordered) children.push({ type: "group", name: g.name, children: g.children });

  // ---- crown ---------------------------------------------------------------------
  const crownType = String((state.crown && state.crown.type) || "flat").toLowerCase();
  const crownKids = [];
  const prismBy = new Map();                      // crown step numbers count per tower
  const towerPrefix = (s) => (multi && typeof s.tower === "number" && s.tower >= 0 ? `Tower ${s.tower + 1} · ` : "");
  for (const s of crownSolids) {
    if (s.kind === "prism") {
      const base = s.role === "parapet" ? "Parapet" : s.role === "screen" ? "Screen" : "Crown step";
      const pieces = piecesOf(s.polygons);
      const z0 = r3(s.z0), z1 = r3(s.z1);
      if (!(z1 - z0 > 0.001)) continue;
      const pk = multi ? s.tower : 0;
      const prismN = (prismBy.get(pk) || 0) + 1;
      prismBy.set(pk, prismN);
      pieces.forEach((pc, i) => {
        const nm = towerPrefix(s) + (base === "Crown step" ? `${base} ${prismN}` : base);
        crownKids.push({ type: "solid", name: pieces.length > 1 ? `${nm} · piece ${i + 1}` : nm, tag: "Crown", material: "Crown", outer: pc.outer, holes: pc.holes, z0, z1 });
      });
    } else if (s.kind === "mesh") {
      const { vertices, triangles } = weldMesh(s.positions || [], s.indices || []);
      if (!vertices.length || !triangles.length) continue;
      crownKids.push({
        type: "mesh", name: towerPrefix(s) + (crownType === "spire" ? "Spire" : crownType === "sloped" ? "Sloped roof" : "Crown"),
        tag: "Crown", material: "Crown", vertices, triangles, soft: false, closed: true,
      });
    }
  }
  if (crownKids.length) {
    declare("Crown", CROWN_COLOR);
    children.push({ type: "group", name: "Crown", tag: "Crown", children: crownKids });
  }

  // ---- context -------------------------------------------------------------------
  const ctx = state.context;
  const blockKids = [];
  if (ctx && ctx.show !== false) {
    for (const b of ctx.blocks || []) {
      const w = num(b && b.w, 0), d = num(b && b.d, 0), h = num(b && b.h, 0);
      if (!(w > 0 && d > 0 && h > 0)) continue;
      const x = num(b.x, 0), y = num(b.y, 0);
      const outer = cleanRing2([[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]]);
      if (!outer) continue;
      blockKids.push({ type: "solid", name: `Block ${blockKids.length + 1}`, tag: "Context", material: "Context", outer, holes: [], z0: 0, z1: r3(h) });
    }
  }
  if (blockKids.length) {
    declare("Context", CONTEXT_COLOR);
    children.push({ type: "group", name: "Context", tag: "Context", material: "Context", children: blockKids });
  }

  const name = String(state.name || "Tower");
  const gfa = plates.reduce((s, p) => s + (p.void ? 0 : num(p.area, 0)), 0);
  const top = plates.reduce((m, p) => Math.max(m, p.z + p.ftf), 0);
  const notes = [
    "Plan origin = the tool's plan origin (0, 0). x = east, y = north. Lengths in feet.",
    `Tower Generator: ${floorSolids} floor solids, gross floor area ${Math.round(gfa).toLocaleString("en-US")} sf, top of floors ${r2(top)} ft.`,
    "Each floor is one solid at full floor-to-floor height. Void floors are skipped.",
  ];

  const doc = makeDoc({
    source: "tower", name, location: null, zShift: 0, notes,
    tags: tagList, materials: matList,
    root: { type: "group", name, children },
  });
  return doc;
}
