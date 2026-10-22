/* ==========================================================================
   grading/sketchup.js — Grading Sketch → ".sketchup.json" (docs/sketchup-spec.md, plan section 4)

   gradingToSketchup(state, built, metrics, meta) → a document made with makeDoc (passes validateDoc), source "grading".
     state    the grading state
     built    buildGrading(state, ...) result (plan section 4)
     metrics  computeMetrics result (optional; read only for the notes)
     meta     optional { createdAt, name, location, zShift }

   Groups (a group with nothing in it is left out):
     Proposed ground   one soft mesh over the node grid (tag "Proposed ground")
     Existing ground   one soft mesh, tag "Existing ground", hidden (visible: false)
     Pads              one `faces` node per tier: the pad polygons flat at pad top + 0.05 ft (so they do not fight the ground)
     Walls             one closed mesh per wall: 1 ft thick, centered on the wall line, from the low side to the top
     Routes            one `lines` node per route, 2 ft points, 0.15 ft above the proposed ground

   zShift: every z = tool elevation + zShift, and zShift brings the lowest proposed point (ground node, pad top, or wall
   bottom) to 0, rounded to 0.01 ft, as the Site Model export does. meta.zShift overrides it. The notes state the shift.
   Units: feet. Plan (x, y): x = east, y = north, the project frame. z up.

   Ground triangles per cell, as the Site Model: a = (i, j), b = (i+1, j), c = (i+1, j+1), d = (i, j+1); (a, b, c) and (a, c, d).
   Pure: no DOM, no input mutation.
   ========================================================================== */

import { cleanRing3, makeDoc } from "../shared/sketchup-format.js";
import { groundData, tierList, tierIdentity, padPolygons, padOf, wallRecords, routeRecords, metricsSummary, sampleLine } from "./derived.js";

export const SKETCHUP_SOURCE = "grading";

export const PAD_LIFT = 0.05;           // ft above the pad top
export const ROUTE_LIFT = 0.15;         // ft above the proposed ground
export const WALL_THICKNESS = 1;        // ft
const MIN_WALL_H = 0.05;                // ft: a wall shorter than this has no solid
const ROUTE_STEP = 2;                   // ft between route points

const COLORS = { "Proposed ground": "#ece9e1", "Existing ground": "#b4b4ae", Pads: "#d6d0c2", Walls: "#c4b49a", Routes: "#2f8f5b" };

const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Soft mesh over the node grid. z = values[k] + shift. */
function groundMesh(g, values, shift, name, tag, material) {
  const { n } = g;
  const vertices = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vertices.push([r3(g.xs[i]), r3(g.ys[j]), r3(values[j * n + i] + shift)]);
  const triangles = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
    triangles.push([a, b, c], [a, c, d]);
  }
  return { type: "mesh", name, tag, material, vertices, triangles, soft: true, closed: false };
}

/** Adds a quad (two triangles) to a mesh, wound so its normal faces `hint`. */
function addQuad(mesh, i0, i1, i2, i3, hint) {
  const v = mesh.vertices, a = v[i0], b = v[i1], c = v[i2];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const flip = nrm[0] * hint[0] + nrm[1] * hint[1] + nrm[2] * hint[2] < 0;
  const q = flip ? [i0, i3, i2, i1] : [i0, i1, i2, i3];
  mesh.triangles.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
}

/**
 * Closed prisms for one wall: one per polyline segment, sections every sample (1 ft).
 * Section = four vertices: left-bottom, right-bottom, right-top, left-top (left = +n of the segment).
 */
function wallMesh(w, shift) {
  const s = w.profile.samples, line = w.line;
  const mesh = { vertices: [], triangles: [] };
  const bySeg = new Map();
  s.forEach((p, i) => { if (!bySeg.has(p.seg)) bySeg.set(p.seg, []); bySeg.get(p.seg).push(i); });
  let prev = -1;                                                       // index of the last sample of the previous segment
  for (const seg of [...bySeg.keys()].sort((a, b) => a - b)) {
    const idx = bySeg.get(seg).slice();
    if (prev >= 0) idx.unshift(prev);
    prev = idx[idx.length - 1];
    const a = line[seg], b = line[seg + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(L > 0) || idx.length < 2) continue;
    const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, nx = -ty, ny = tx, h = WALL_THICKNESS / 2;
    const base = mesh.vertices.length;
    for (const i of idx) {
      const p = s[i], top = p.top + shift, bot = Math.min(p.bottom, p.top - MIN_WALL_H) + shift;
      mesh.vertices.push([r3(p.x + nx * h), r3(p.y + ny * h), r3(bot)], [r3(p.x - nx * h), r3(p.y - ny * h), r3(bot)], [r3(p.x - nx * h), r3(p.y - ny * h), r3(top)], [r3(p.x + nx * h), r3(p.y + ny * h), r3(top)]);
    }
    const sec = (k) => base + k * 4;
    for (let k = 0; k < idx.length - 1; k++) {
      const A = sec(k), B = sec(k + 1);
      addQuad(mesh, A, A + 1, B + 1, B, [0, 0, -1]);                 // bottom
      addQuad(mesh, A + 3, A + 2, B + 2, B + 3, [0, 0, 1]);          // top
      addQuad(mesh, A, A + 3, B + 3, B, [nx, ny, 0]);                // left side
      addQuad(mesh, A + 1, A + 2, B + 2, B + 1, [-nx, -ny, 0]);      // right side
    }
    const S = sec(0), E = sec(idx.length - 1);
    addQuad(mesh, S, S + 1, S + 2, S + 3, [-tx, -ty, 0]);            // start cap
    addQuad(mesh, E, E + 1, E + 2, E + 3, [tx, ty, 0]);              // end cap
  }
  return mesh;
}

export function gradingToSketchup(state, built, metrics, meta) {
  if (!state) throw new Error('gradingToSketchup: missing input "state".');
  if (!built || !built.grid) throw new Error('gradingToSketchup: missing input "built.grid".');
  const mt = meta || {};
  const g = groundData(built);
  const wr = wallRecords(state, built).filter((w) => w.heightMax >= MIN_WALL_H && w.profile.samples.length > 1);
  const rr = routeRecords(state, built, metrics || {});
  const tiers = tierList(built);

  // zShift: the lowest proposed point
  let lo = Infinity;
  for (let k = 0; k < g.pz.length; k++) if (g.pz[k] < lo) lo = g.pz[k];
  for (const t of tiers) if (Number.isFinite(t.padTop) && t.padTop < lo) lo = t.padTop;
  for (const w of wr) for (const p of w.profile.samples) if (p.bottom < lo) lo = p.bottom;
  const computed = Math.round(-lo * 100) / 100 || 0;
  const shift = num(mt.zShift, computed);
  const shiftNote = shift <= 0
    ? `The model is lowered by ${Math.abs(shift).toFixed(2)} ft so the lowest proposed point is 0 ft. Add ${Math.abs(shift).toFixed(2)} ft to return to the tool elevations.`
    : `The model is raised by ${Math.abs(shift).toFixed(2)} ft so the lowest proposed point is 0 ft. Subtract ${Math.abs(shift).toFixed(2)} ft to return to the tool elevations.`;

  const tagList = [], matList = [], declaredTags = new Set(), declaredMats = new Set();
  const tag = (name, visible = true) => { if (!declaredTags.has(name)) { declaredTags.add(name); tagList.push({ name, color: COLORS[name], visible }); } return name; };
  const mat = (name) => { if (!declaredMats.has(name)) { declaredMats.add(name); matList.push({ name, color: COLORS[name], alpha: 1 }); } return name; };

  const children = [];
  const add = (nm, tg, visible, kids, material) => {
    if (!kids.length) return;
    children.push({ type: "group", name: nm, tag: tag(tg, visible), material: material ? mat(material) : undefined, children: kids });
  };

  // ground
  add("Proposed ground", "Proposed ground", true, [groundMesh(g, g.pz, shift, "Proposed ground mesh", undefined, undefined)], "Proposed ground");
  add("Existing ground", "Existing ground", false, [groundMesh(g, g.ez, shift, "Existing ground mesh", undefined, undefined)], "Existing ground");

  // pads
  const pads = [];
  for (const t of tiers) {
    const id = tierIdentity(t, built);
    const polygons = [];
    for (const poly of padPolygons(padOf(t))) {
      const z = r3(t.padTop + shift + PAD_LIFT);
      const outer = cleanRing3(poly.outer.map((p) => [p[0], p[1], z]));
      if (!outer) continue;
      const holes = poly.holes.map((h) => cleanRing3(h.map((p) => [p[0], p[1], z]), { hole: true })).filter(Boolean);
      polygons.push({ outer, holes });
    }
    if (polygons.length) pads.push({ type: "faces", name: id.id, polygons, attributes: { tier: t.tier, ffe: Math.round(t.ffe * 100) / 100, padTop: Math.round(t.padTop * 100) / 100, source: id.source } });
  }
  add("Pads", "Pads", true, pads, "Pads");

  // walls
  const walls = [];
  for (const w of wr) {
    const m = wallMesh(w, shift);
    if (!m.triangles.length) continue;
    walls.push({
      type: "mesh", name: `${w.id} (${w.kind})`, vertices: m.vertices, triangles: m.triangles, soft: false, closed: true,
      attributes: { kind: w.kind, heightMax: Math.round(w.heightMax * 100) / 100, heightAvg: Math.round(w.heightAvg * 100) / 100, length: Math.round(w.length * 10) / 10, accepted: w.accepted },
    });
  }
  add("Walls", "Walls", true, walls, "Walls");

  // routes
  const routes = [];
  for (const r of rr) {
    const pts = sampleLine(r.line, ROUTE_STEP, built.surface.at).map((p) => [r3(p[0]), r3(p[1]), r3(p[2] + shift + ROUTE_LIFT)]);
    if (pts.length > 1) routes.push({ type: "lines", name: r.name, lines: [pts], attributes: { kind: r.kind, maxSlope: Math.round(r.maxSlope * 10000) / 10000, maxCross: Math.round(r.maxCross * 10000) / 10000 } });
  }
  add("Routes", "Routes", true, routes);

  const name = String(mt.name || state.name || "Grading Sketch");
  const notes = [
    "Plan origin = the project frame origin (0, 0). x = east, y = north. Lengths in feet. z = proposed elevation plus the shift below.",
    `SketchUp: ${shiftNote}`,
    `Grading Sketch: ${g.n} by ${g.n} ground points at ${g.spacing} ft spacing, ${tiers.length} pad tiers, ${wr.length} walls, ${routes.length} routes.`,
  ];
  if (metrics) {
    try {
      const m = metricsSummary(state, built, metrics, wr, rr);
      notes.push(`Earthwork on the grid: cut ${m.cutCy.toFixed(1)} cy, fill ${m.fillCy.toFixed(1)} cy, net ${m.netCy.toFixed(1)} cy (positive = import).`);
    } catch (e) { /* the notes work without the earthwork line */ }
  }
  notes.push(
    "Pads are flat faces 0.05 ft above the pad top. Walls are 1 ft thick, centered on the wall line, from the low side to the top. Existing ground is in a hidden tag.",
    "Caution: this is a sketch for early coordination with the civil engineer. It is never a grading plan. Every volume, slope, and wall height is a design-stage estimate. Verify before use.",
  );

  return makeDoc({
    source: SKETCHUP_SOURCE, name, location: mt.location || null, zShift: shift, notes,
    tags: tagList, materials: matList, createdAt: mt.createdAt,
    root: { type: "group", name, children },
  });
}
