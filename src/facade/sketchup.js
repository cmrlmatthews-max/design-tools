/* ==========================================================================
   facade/sketchup.js — Facade Studio → ".sketchup.json" (docs/sketchup-spec.md section 4, plan section 4)

   facadeToSketchup(state, built, metrics, meta) → a document made with makeDoc (passes validateDoc).
     state    the facade state
     built    buildFacade(state, ...) result: { faces[], ... } (plan section 4)
     metrics  computeMetrics result, read only for the notes (optional)
     meta     optional { createdAt, name, location, zShift }

   Pure: no DOM. Units: feet. Plan (x, y): x = east, y = north. z up. Local (massing) frame, like the Parking Deck export.

   Rule choices (where the spec leaves room):
   - Group order: Walls, Glass, Spandrel, Balconies, Fins, Shades. A group with nothing in it is left out.
   - Walls, Glass and Spandrel are `mesh` nodes, one per face and level (named with the face id, "F3@4"). validateDoc
     rejects a vertical `faces` polygon (its plan area is zero), so vertical skin is triangulated quads.
     Walls = the face rectangle minus the glass and spandrel rectangles, cut in horizontal bands.
     Glass sits in the wall plane. Wall + Glass + Spandrel tile the face exactly.
   - Tags by system: "Punched windows", "Window wall", "Curtain wall", "Storefront", "Solid wall" on Walls, Glass and Spandrel
     meshes; tags "Balconies", "Fins", "Shades" on the others.
   - Projected balcony: a solid slab outside the face, `balconies.depth` deep, `balconies.width` wide, `slab` thick, top at the floor.
   - Inset balcony: the face gets an opening (recess width x level height); a back wall, two side returns and the door glass sit
     `depth` inside the face plane; the floor slab is a solid inside the face plane.
   - Fins: one closed mesh box per fin and level. (The default fin footprint is 0.25 sf, the validateDoc minimum for a solid.)
   - Shades: one solid per glazed panel, SHADE_THICKNESS thick.
   - Mullions are not exported.
   ========================================================================== */

import { cleanRing2, makeDoc } from "../shared/sketchup-format.js";
import { facadeDerived, systemName } from "./derived.js";
import { faceElements, facePoint, faceNormal, subtractRects, SHADE_THICKNESS } from "./elevations.js";

export const SKETCHUP_SOURCE = "facade";

const SYSTEM_TAGS = {
  punched: ["Punched windows", "#c9c2b6"], windowWall: ["Window wall", "#aab4bd"], curtainWall: ["Curtain wall", "#7f9db5"],
  storefront: ["Storefront", "#b68f6a"], solid: ["Solid wall", "#a8a8a2"],
};
const COLORS = { Wall: "#f1efe9", Glass: "#9fb4c4", Spandrel: "#8a8f94", Balconies: "#d6cdbd", Fins: "#6f7780", Shades: "#6f7780" };

const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const MIN_W = 0.01;

/** Adds quads (as two triangles each) to a mesh being built. */
class MeshBuilder {
  constructor() { this.vertices = []; this.triangles = []; }
  quad(p0, p1, p2, p3) {
    const k = this.vertices.length;
    for (const p of [p0, p1, p2, p3]) this.vertices.push([r3(p[0]), r3(p[1]), r3(p[2])]);
    this.triangles.push([k, k + 1, k + 2], [k, k + 2, k + 3]);
  }
  get empty() { return this.triangles.length === 0; }
}

/** Closed box mesh over a plan ring (4 points, either direction) between z0 and z1. */
function boxMesh(ring, z0, z1) {
  const area = ring.reduce((s, p, i) => { const q = ring[(i + 1) % 4]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const r = area >= 0 ? ring : ring.slice().reverse();               // counter-clockwise
  const vertices = [...r.map((p) => [r3(p[0]), r3(p[1]), r3(z0)]), ...r.map((p) => [r3(p[0]), r3(p[1]), r3(z1)])];
  const triangles = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7]];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; triangles.push([i, j, 4 + j], [i, 4 + j, 4 + i]); }
  return { vertices, triangles };
}

export function facadeToSketchup(state, built, metrics, meta) {
  if (!state) throw new Error('facadeToSketchup: missing input "state".');
  if (!built || !Array.isArray(built.faces)) throw new Error('facadeToSketchup: missing input "built.faces".');
  const mt = meta || {};
  const d = facadeDerived(state, built, metrics || {});

  const tagList = [], matList = [], declaredTags = new Set(), declaredMats = new Set();
  const tag = (name, color) => { if (!declaredTags.has(name)) { declaredTags.add(name); tagList.push({ name, color, visible: true }); } return name; };
  const mat = (name, color, alpha = 1) => { if (!declaredMats.has(name)) { declaredMats.add(name); matList.push({ name, color: color || COLORS[name], alpha }); } return name; };
  const sysTag = (sys) => { const [n, c] = SYSTEM_TAGS[sys] || SYSTEM_TAGS.punched; return tag(n, c); };

  const walls = [], glass = [], spandrels = [], balconies = [], fins = [], shades = [];
  const bal = state.balconies || {};

  for (const face of built.faces) {
    if (!face || !Array.isArray(face.a) || !Array.isArray(face.b)) continue;
    const h = num(face.ftf, 0), L = num(face.length, Math.hypot(face.b[0] - face.a[0], face.b[1] - face.a[1])), z = num(face.z, 0);
    if (!(h > 0) || !(L > 0)) continue;
    const sys = (face.rule && face.rule.system) || "punched";
    const n = faceNormal(face);
    const P = (u, v, off = 0) => { const p = facePoint(face, u); return [p[0] - n[0] * off, p[1] - n[1] * off, z + v]; };
    const el = faceElements(state, face);
    const attributes = { level: face.levelIndex, orientation: face.orientation, zone: String(face.zone), system: systemName(sys) };

    const insetIdx = new Set(el.balconies.filter((b) => b.type === "inset").map((b) => b.i));
    const insetOf = (i) => el.balconies.find((b) => b.type === "inset" && b.i === i);
    const wallM = new MeshBuilder(), glassM = new MeshBuilder(), spanM = new MeshBuilder();
    const quad = (m, r, off = 0) => { if (r.u1 - r.u0 > MIN_W && r.v1 - r.v0 > MIN_W) m.quad(P(r.u0, r.v0, off), P(r.u1, r.v0, off), P(r.u1, r.v1, off), P(r.u0, r.v1, off)); };

    const holes = [];
    for (const g of el.glass) {
      if (g.kind === "door" && insetIdx.has(g.i)) quad(glassM, g, insetOf(g.i).depth);        // door at the recessed plane
      else { quad(glassM, g); holes.push(g); }
    }
    for (const s of el.spandrel) if (!insetIdx.has(s.i)) { quad(spanM, s); holes.push(s); }
    for (const b of el.balconies) {
      if (b.type !== "inset") continue;
      holes.push(b);                                                                          // opening in the face
      const doors = el.glass.filter((g) => g.kind === "door" && g.i === b.i);
      for (const r of subtractRects(b, doors)) quad(wallM, r, b.depth);                       // back wall around the door
      for (const u of [b.u0, b.u1]) wallM.quad(P(u, 0, 0), P(u, 0, b.depth), P(u, h, b.depth), P(u, h, 0));   // side returns
    }
    for (const r of subtractRects({ u0: 0, u1: L, v0: 0, v1: h }, holes)) quad(wallM, r);

    const node = (m, nm, tg, mt2) => ({ type: "mesh", name: nm, tag: tg, material: mt2, vertices: m.vertices, triangles: m.triangles, soft: false, closed: false, attributes });
    if (!wallM.empty) walls.push(node(wallM, face.id, sysTag(sys), mat("Wall")));
    if (!glassM.empty) glass.push(node(glassM, face.id, sysTag(sys), mat("Glass", COLORS.Glass, 0.45)));
    if (!spanM.empty) spandrels.push(node(spanM, face.id, sysTag(sys), mat("Spandrel")));

    // balconies
    for (const b of el.balconies) {
      const dir = b.type === "inset" ? -1 : 1;                                                // outward or inward
      const ring = cleanRing2([P(b.u0, 0, 0), P(b.u1, 0, 0), P(b.u1, 0, -dir * b.depth), P(b.u0, 0, -dir * b.depth)].map((p) => [p[0], p[1]]));
      if (!ring) continue;
      balconies.push({
        type: "solid", name: `${face.id} · B${b.i + 1}`, tag: tag("Balconies", COLORS.Balconies), material: mat("Balconies"),
        outer: ring, holes: [], z0: r3(z - b.slab), z1: r3(z), attributes: { level: face.levelIndex, orientation: face.orientation, type: b.type },
      });
    }
    // fins: closed boxes
    for (const [k, f] of el.fins.entries()) {
      const ring = [P(f.u - f.width / 2, 0, 0), P(f.u + f.width / 2, 0, 0), P(f.u + f.width / 2, 0, -f.depth), P(f.u - f.width / 2, 0, -f.depth)].map((p) => [p[0], p[1]]);
      const box = boxMesh(ring, z, z + h);
      fins.push({ type: "mesh", name: `${face.id} · fin ${k + 1}`, tag: tag("Fins", COLORS.Fins), material: mat("Fins"), vertices: box.vertices, triangles: box.triangles, soft: false, closed: true, attributes: { level: face.levelIndex, orientation: face.orientation } });
    }
    // shades
    for (const s of el.shades) {
      const ring = cleanRing2([P(s.u0, 0, 0), P(s.u1, 0, 0), P(s.u1, 0, -s.depth), P(s.u0, 0, -s.depth)].map((p) => [p[0], p[1]]));
      if (!ring) continue;
      shades.push({
        type: "solid", name: `${face.id} · S${s.i + 1}`, tag: tag("Shades", COLORS.Shades), material: mat("Shades"),
        outer: ring, holes: [], z0: r3(z + s.v0), z1: r3(z + s.v0 + SHADE_THICKNESS), attributes: { level: face.levelIndex, orientation: face.orientation },
      });
    }
  }

  const children = [];
  const add = (nm, kids) => { if (kids.length) children.push({ type: "group", name: nm, children: kids }); };
  add("Walls", walls); add("Glass", glass); add("Spandrel", spandrels); add("Balconies", balconies); add("Fins", fins); add("Shades", shades);

  const m = d.metrics;
  const name = String(mt.name || state.name || "Facade");
  const notes = [
    "Plan origin = the tool's plan origin (0, 0) in the massing frame. x = east, y = north. Lengths in feet. z = floor surface above the base.",
    `Facade Studio: ${d.faces.length} face groups, ${built.faces.length} face levels. Wall ${Math.round(m.facadeArea).toLocaleString("en-US")} sf, glazing ${Math.round(m.glazingArea).toLocaleString("en-US")} sf, WWR ${(Math.round(m.wwr * 1000) / 10).toFixed(1)} percent, ${m.balconyCount} balconies.`,
    "Glazing area is the whole window opening, frames included. Inset balcony returns are not wall area. Parapets and roof screens add no wall area.",
    "Walls, Glass and Spandrel are triangulated quads in the wall plane. An inset balcony opens the face; its back wall and door glass sit inside the face plane.",
    "Caution: these are design values for a concept study, not product sizes or code values. Verify every value before use.",
  ];

  return makeDoc({
    source: SKETCHUP_SOURCE, name, location: mt.location || null, zShift: num(mt.zShift, 0), notes,
    tags: tagList, materials: matList, createdAt: mt.createdAt,
    root: { type: "group", name, children },
  });
}
