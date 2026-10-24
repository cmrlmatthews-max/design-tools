/* ==========================================================================
   tower/derived.js — Tower Generator → massing.derived (docs/project-file-spec.md 6.2;
   docs/tower-project-sun-plan.md section 3.1)

   towerDerived(state, built, metrics) → { footprint, height, levels, context, metrics }
     state    the tower state (schema 1 or 2)
     built    buildPlates(state) → { plates, solids, warnings, floors }
     metrics  computeMetrics(state, built.plates); computed here when missing

   Pure: no DOM, no mutation of the inputs. Clipper (globalThis.ClipperLib, SCALE 1000) is used only for the
   footprint union. Units: feet, square feet. Plan (x, y): x = east, y = north, in the tower local frame.
   ========================================================================== */

import { computeMetrics, multiPolyArea } from "./geometry.js";
import { cleanRing2 } from "../shared/sketchup-format.js";

const SCALE = 1000;

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clone = (o) => JSON.parse(JSON.stringify(o));
const need = (v, name) => { if (v === undefined || v === null) throw new Error(`towerDerived: missing input "${name}".`); return v; };

/* ---------- rings and multipolygons ---------- */

/** One {outer, holes} piece → cleaned piece, or null when the outer ring is degenerate. */
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
const cleanMulti = (mp) => (Array.isArray(mp) ? mp : []).map(cleanPiece).filter(Boolean);

/** Union of several MultiPolys with Clipper. Returns a cleaned MultiPoly. */
function unionMulti(list) {
  const C = globalThis.ClipperLib;
  if (!C) throw new Error("towerDerived: ClipperLib is not loaded (globalThis.ClipperLib) and the footprint needs it.");
  const toPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
  const clip = new C.Clipper();
  let any = false;
  for (const mp of list) {
    for (const pc of mp) {
      clip.AddPath(toPath(pc.outer), C.PolyType.ptSubject, true);
      for (const h of pc.holes) clip.AddPath(toPath(h), C.PolyType.ptSubject, true);   // outers wind +1, holes 0 under non-zero
      any = true;
    }
  }
  if (!any) return [];
  const tree = new C.PolyTree();
  clip.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const ring = (node) => node.Contour().map((p) => [p.X / SCALE, p.Y / SCALE]);
  const out = [];
  const visit = (node) => {
    if (!node.IsHole()) {
      const outer = cleanRing2(ring(node));
      const holes = [];
      for (const ch of node.Childs()) {
        const h = cleanRing2(ring(ch), { hole: true });
        if (h) holes.push(h);
      }
      if (outer) out.push({ outer, holes });
    }
    for (const ch of node.Childs()) for (const g of ch.Childs()) visit(g);   // islands inside holes
  };
  for (const top of tree.Childs()) visit(top);
  return out;
}

/* ---------- the crown ---------- */

/** Convex hull of points (Andrew's monotone chain), counter-clockwise. */
function hull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** The footprint (a MultiPoly) of one crown solid. Prisms carry it; a sloped crown sits on the top plate; a spire is its base circle. */
function solidFootprint(solid, state, topPlate) {
  if (Array.isArray(solid.polygons) && solid.polygons.length) return cleanMulti(solid.polygons);
  const type = String((state.crown && state.crown.type) || "").toLowerCase();
  if (type === "sloped") return topPlate ? cleanMulti(topPlate.polygons) : [];
  const pos = solid.positions;
  if (Array.isArray(pos) && pos.length >= 9) {
    let zMin = Infinity;
    for (let i = 2; i < pos.length; i += 3) zMin = Math.min(zMin, pos[i]);
    const base = [];
    for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 2] - zMin) < 1e-6) base.push([pos[i], pos[i + 1]]);
    const ring = cleanRing2(hull(base));
    return ring ? [{ outer: ring, holes: [] }] : [];
  }
  return [];
}

/* ---------- the writer ---------- */

export function towerDerived(state, built, metrics) {
  need(state, "state"); need(built, "built");
  const plates = need(built.plates, "built.plates");
  const solids = Array.isArray(built.solids) ? built.solids : [];
  const m = metrics || computeMetrics(state, plates);

  const levels = plates.map((p) => {
    const isVoid = !!p.void || !(p.area > 0);
    return {
      index: p.n,
      name: `Floor ${p.n}`,
      zone: p.zone,
      z: r3(p.z),
      ftf: r3(p.ftf),
      program: p.zone === "mechanical" ? "mechanical" : (p.program === undefined ? null : p.program),
      plates: isVoid ? [] : cleanMulti(p.polygons),
      core: null,          // the Tower Generator makes no core; the Plate Planner does
      spines: [],
      seeds: [],
    };
  });

  // the crown level: only when the crown adds height (a flat crown is a parapet and adds none)
  const crownHeight = isNum(m.crownHeight) ? m.crownHeight : 0;
  const real = plates.filter((p) => !p.void && p.area > 0);
  const topPlate = real.length ? real[real.length - 1] : null;
  const crownSolids = solids.filter((s) => s && (s.role === "screen" || s.role === "crown" || s.role === "spire"));
  const crownPieces = crownSolids.map((s) => ({ s, fp: solidFootprint(s, state, topPlate) }));
  if (crownHeight > 0 && crownPieces.length) {
    const zOf = (c) => (isNum(c.s.z0) ? c.s.z0 : Infinity);
    const lowest = crownPieces.reduce((a, b) => (zOf(b) < zOf(a) ? b : a));
    const lastN = plates.reduce((mx, p) => Math.max(mx, p.n), 0);
    levels.push({
      index: lastN + 1,
      name: "Crown",
      zone: "crown",
      z: r3(isNum(m.topOfFloors) ? m.topOfFloors : plates.reduce((mx, p) => Math.max(mx, p.z + p.ftf), 0)),
      ftf: r3(crownHeight),
      program: null,
      plates: lowest.fp,
      core: null,
      spines: [],
      seeds: [],
    });
  }

  const footprint = unionMulti([...levels.filter((l) => l.zone !== "crown").map((l) => l.plates), ...crownPieces.filter((c) => c.s.polygons).map((c) => c.fp)]);

  const byProgram = m.byProgram || {};
  let units = 0;
  for (const k of ["residential", "hotel"]) if (byProgram[k] && isNum(byProgram[k].unitsWhole)) units += byProgram[k].unitsWhole;

  const gfa = isNum(m.gfa) ? m.gfa : levels.filter((l) => l.zone !== "crown").reduce((s, l) => s + multiPolyArea(l.plates), 0);
  const height = isNum(m.totalHeight) ? m.totalHeight : 0;

  return {
    footprint,
    height: r1(height),
    levels,
    context: { blocks: clone(((state.context && state.context.blocks) || []).map((b) => ({ ...b }))) },
    metrics: {
      gfa: r1(gfa),
      far: r2(isNum(m.far) ? m.far : 0),
      siteCoverage: r3(isNum(m.siteCoverage) ? m.siteCoverage : 0),
      floors: isNum(m.floorCount) ? m.floorCount : real.length,
      height: r1(height),
      units,
    },
  };
}
