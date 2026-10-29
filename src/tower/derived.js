/* ==========================================================================
   tower/derived.js — Tower Generator → massing.derived (docs/project-file-spec.md 6.2;
   docs/tower-project-sun-plan.md section 3.1)

   towerDerived(state, built, metrics) → { footprint, height, levels, context, metrics }
     state    the tower state (schema 1 or 2)
     built    buildPlates(state) → { plates, solids, warnings, floors }
     metrics  computeMetrics(state, built.plates); computed here when missing

   Several towers on one podium (October 29, 2026): one level per tower per level. The podium levels and the lead
   tower's levels come first, in elevation order, with index = the level number n (exactly the one-tower list). Then
   each other tower's levels, bottom up, with ids that go on after the highest n. Then the crown levels, one per tower.
   Levels of a multi-tower design that belong to a tower carry `tower` (tower index, 0 = Tower 1) and `level` (the
   shared level number n); floors of one level share z, ftf and name ("Floor 7"). A one-tower design writes neither
   key, so its output is unchanged. Readers that need elevation order sort by z (docs/project-file-spec.md 6.2).

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

  const towerSet = new Set(plates.filter((p) => p.zone === "tower" && isNum(p.tower)).map((p) => p.tower));
  const multi = towerSet.size > 1;
  const leadTower = towerSet.size ? Math.min(...towerSet) : 0;
  const isLeadList = (p) => !multi || !isNum(p.tower) || p.tower < 0 || p.tower === leadTower;
  // list order: podium + lead tower (index = n), then the other towers by index (ids after the highest n)
  const ordered = multi
    ? [...plates.filter(isLeadList), ...[...towerSet].filter((k) => k !== leadTower).sort((a, b) => a - b).flatMap((k) => plates.filter((p) => p.tower === k))]
    : plates;
  let nextId = plates.reduce((mx, p) => Math.max(mx, p.n), 0);
  const levels = ordered.map((p) => {
    const isVoid = !!p.void || !(p.area > 0);
    const extra = multi && isNum(p.tower) && p.tower >= 0 ? { tower: p.tower, level: p.n } : null;
    return {
      index: isLeadList(p) ? p.n : ++nextId,
      name: `Floor ${p.n}`,
      zone: p.zone,
      z: r3(p.z),
      ftf: r3(p.ftf),
      program: p.zone === "mechanical" ? "mechanical" : (p.program === undefined ? null : p.program),
      plates: isVoid ? [] : cleanMulti(p.polygons),
      core: null,          // the Tower Generator makes no core; the Plate Planner does
      spines: [],
      seeds: [],
      ...(extra || {}),
    };
  });

  // the crown level: only when the crown adds height (a flat crown is a parapet and adds none)
  // With several towers there is one crown per tower (built.solids carry `tower`), each on its own top plate.
  const crownHeight = isNum(m.crownHeight) ? m.crownHeight : 0;
  const real = plates.filter((p) => !p.void && p.area > 0);
  const crownSolids = solids.filter((s) => s && (s.role === "screen" || s.role === "crown" || s.role === "spire"));
  const crownGroups = [];
  if (multi) {
    for (const k of [...towerSet].sort((a, b) => a - b)) {
      const mine = real.filter((p) => p.tower === k);
      const ss = crownSolids.filter((s) => s.tower === k);
      if (!ss.length) continue;
      const topPlate = mine.length ? mine[mine.length - 1] : null;
      const z = plates.reduce((mx, p) => (p.tower === k ? Math.max(mx, p.z + p.ftf) : mx), 0);
      crownGroups.push({ tower: k, z, pieces: ss.map((s) => ({ s, fp: solidFootprint(s, state, topPlate) })) });
    }
  } else {
    const topPlate = real.length ? real[real.length - 1] : null;
    const z = isNum(m.topOfFloors) ? m.topOfFloors : plates.reduce((mx, p) => Math.max(mx, p.z + p.ftf), 0);
    crownGroups.push({ tower: null, z, pieces: crownSolids.map((s) => ({ s, fp: solidFootprint(s, state, topPlate) })) });
  }
  const crownPieces = crownGroups.flatMap((g) => g.pieces);
  if (crownHeight > 0) {
    const zOf = (c) => (isNum(c.s.z0) ? c.s.z0 : Infinity);
    for (const g of crownGroups) {
      if (!g.pieces.length) continue;
      const lowest = g.pieces.reduce((a, b) => (zOf(b) < zOf(a) ? b : a));
      levels.push({
        index: ++nextId,
        name: "Crown",
        zone: "crown",
        z: r3(g.z),
        ftf: r3(crownHeight),
        program: null,
        plates: lowest.fp,
        core: null,
        spines: [],
        seeds: [],
        ...(g.tower === null ? {} : { tower: g.tower }),
      });
    }
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
