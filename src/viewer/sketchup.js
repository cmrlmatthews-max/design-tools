/* ==========================================================================
   viewer/sketchup.js — Model Viewer → ".sketchup.json" (docs/sketchup-spec.md, source "viewer")

   viewerToSketchup(doc, layersOn, meta) → a document made with makeDoc, source "viewer".
     doc       the project document (every section is read through scene.js; nothing is written)
     layersOn  { site, massing, units, cores, parking, facade, grading: true | false }; missing keys use DEFAULT_ON
     meta      optional { createdAt, name }

   Structure: root group (the project name) > one group per layer that is on and has items:
     Site      one solid per neighbor building, and the site ground as a soft mesh
     Massing   one solid per level plate (levels the plates do not cover)
     Units     one group per level, one solid per unit (tag = the type name)
     Cores     one group per level, one solid per core piece, stair, elevator or corridor
     Parking   one group per level: the slab solid, the cores, the stalls as one lines node, the ramps as one lines node
     Facade    one solid per face band (tag = the system)
     Grading   the proposed ground as a soft mesh and one solid per wall piece
   zShift brings the lowest drawn z to 0. Units: feet, project frame (x east, y north).
   Pure: no DOM, no input mutation.
   ========================================================================== */

import { makeDoc, cleanRing2 } from "../shared/sketchup-format.js";
import { getSection } from "../shared/project.js";
import { layersFrom, colorKey, colorOf, LAYER_LABELS, DEFAULT_ON } from "./scene.js";

export const SKETCHUP_SOURCE = "viewer";

const r3 = (v) => Math.round(v * 1000) / 1000;
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const attrs = (it) => {
  const a = { id: String(it.id), layer: it.layer };
  if (it.type) a.type = it.type;
  if (it.program) a.program = it.program;
  if (it.level !== undefined) a.level = it.level;
  return a;
};

function meshOf(grid, baseZ) {
  const { n, points } = grid;
  const vertices = points.map((p) => [r3(p[0]), r3(p[1]), r3(p[2] + baseZ)]);
  const triangles = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n + 1, d = a + n;
    triangles.push([a, b, c], [a, c, d]);
  }
  return { vertices, triangles };
}

export function viewerToSketchup(doc, layersOn, meta) {
  if (!doc || typeof doc !== "object") throw new Error('viewerToSketchup: missing input "doc".');
  const mt = meta || {};
  const on = (id) => (layersOn && id in layersOn ? !!layersOn[id] : !!DEFAULT_ON[id]);
  const L = layersFrom(doc);

  const tagList = [], matList = [], declared = new Set();
  const declare = (name, color) => {
    if (!declared.has(name)) { declared.add(name); tagList.push({ name, color, visible: true }); matList.push({ name, color, alpha: 1 }); }
    return name;
  };
  const solidOf = (it, tagName, color) => {
    const outer = cleanRing2(it.outer);
    if (!outer || !fin(it.z0) || !fin(it.z1) || !(it.z1 - it.z0 > 0.001)) return null;
    const holes = (it.holes || []).map((h) => cleanRing2(h, { hole: true })).filter(Boolean);
    return { type: "solid", name: String(it.id), tag: declare(tagName, color), material: tagName, outer, holes, z0: r3(it.z0), z1: r3(it.z1), attributes: attrs(it) };
  };
  const levelGroups = (items, nameOf, build) => {
    const by = new Map();
    for (const it of items) { const k = it.level; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    const out = [];
    for (const k of [...by.keys()].sort((a, b) => a - b)) {
      const kids = build(by.get(k));
      if (kids.length) out.push({ type: "group", name: nameOf(k), children: kids });
    }
    return out;
  };

  const groups = [];
  let zMin = Infinity;
  const track = (z) => { if (fin(z) && z < zMin) zMin = z; };

  if (on("site") && L.site.ok) {
    const kids = [];
    for (const it of L.site.items) { const s = solidOf(it, "Site buildings", colorOf("layer:site")); if (s) { kids.push(s); track(s.z0); } }
    const sec = getSection(doc, "site");
    const g = sec && sec.derived && sec.derived.ground;
    if (g && Array.isArray(g.points) && g.points.length === g.n * g.n && g.points.every((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(fin))) {
      const pl = sec.placement && typeof sec.placement === "object" ? sec.placement : {};
      const m = meshOf(g, fin(pl.baseZ) ? pl.baseZ : 0);
      kids.unshift({ type: "mesh", name: "Site ground", tag: declare("Site ground", "#d6dadd"), material: "Site ground", vertices: m.vertices, triangles: m.triangles, soft: true, closed: false });
      for (const v of m.vertices) track(v[2]);
    }
    if (kids.length) groups.push({ type: "group", name: LAYER_LABELS.site, children: kids });
  }
  if (on("massing") && L.massing.items.length) {
    const kids = [];
    for (const it of L.massing.items) { const k = colorKey(it, "program"); const s = solidOf(it, it.program ? it.program : "Massing", colorOf(k)); if (s) { kids.push(s); track(s.z0); } }
    if (kids.length) groups.push({ type: "group", name: LAYER_LABELS.massing, children: kids });
  }
  if (on("units") && L.units.items.length) {
    const kids = levelGroups(L.units.items, (k) => `Level ${k}`, (items) => items.map((it) => { const s = solidOf(it, it.type, colorOf(colorKey(it, "unitType"))); if (s) track(s.z0); return s; }).filter(Boolean));
    if (kids.length) groups.push({ type: "group", name: LAYER_LABELS.units, children: kids });
  }
  if (on("cores") && L.cores.items.length) {
    const label = { corridor: "Corridor", core: "Core", stair: "Stairs", elevator: "Elevators" };
    const kids = levelGroups(L.cores.items, (k) => `Level ${k}`, (items) => items.map((it) => { const tag = label[it.kind] || "Core rooms"; const s = solidOf(it, tag, colorOf(`kind:${it.kind in label ? it.kind : "core"}`)); if (s) track(s.z0); return s; }).filter(Boolean));
    if (kids.length) groups.push({ type: "group", name: LAYER_LABELS.cores, children: kids });
  }
  if (on("parking") && L.parking.items.length) {
    const kids = levelGroups(L.parking.items, (k) => `Parking level ${k}`, (items) => {
      const out = [];
      for (const it of items) {
        if (it.kind === "slab" || it.kind === "core") { const s = solidOf(it, it.kind === "slab" ? "Parking slab" : "Parking cores", colorOf(`kind:${it.kind === "slab" ? "slab" : "core"}`)); if (s) { out.push(s); track(s.z0); } }
      }
      const stalls = items.filter((it) => it.kind === "stall" && it.line3 && it.line3.length >= 4);
      if (stalls.length) { out.push({ type: "lines", name: "Stalls", tag: declare("Parking stalls", colorOf("stall:standard")), lines: stalls.map((s) => s.line3.map((q) => [r3(q[0]), r3(q[1]), r3(q[2])])), attributes: { count: stalls.length } }); stalls.forEach((s) => track(s.line3[0][2])); }
      const ramps = items.filter((it) => it.kind === "ramp" && it.line3 && it.line3.length >= 3);
      if (ramps.length) { out.push({ type: "lines", name: "Ramps", tag: declare("Parking ramps", colorOf("kind:ramp")), lines: ramps.map((s) => s.line3.map((q) => [r3(q[0]), r3(q[1]), r3(q[2])])), attributes: { count: ramps.length } }); ramps.forEach((s) => s.line3.forEach((q) => track(q[2]))); }
      return out;
    });
    if (kids.length) groups.push({ type: "group", name: LAYER_LABELS.parking, children: kids });
  }
  if (on("facade") && L.facade.items.length) {
    const kids = [];
    for (const it of L.facade.items) { const s = solidOf(it, `Facade ${it.system}`, colorOf(colorKey(it, "program"))); if (s) { kids.push(s); track(s.z0); } }
    if (kids.length) groups.push({ type: "group", name: LAYER_LABELS.facade, children: kids });
  }
  if (on("grading") && L.grading.items.length) {
    const kids = [];
    for (const it of L.grading.items) {
      if (it.kind === "ground") {
        const sec = getSection(doc, "grading"), pl = sec && sec.placement && typeof sec.placement === "object" ? sec.placement : {};
        const m = meshOf(it.grid, fin(pl.baseZ) ? pl.baseZ : 0);
        kids.push({ type: "mesh", name: "Proposed ground", tag: declare("Proposed ground", colorOf("layer:grading")), material: "Proposed ground", vertices: m.vertices, triangles: m.triangles, soft: true, closed: false });
        for (const v of m.vertices) track(v[2]);
      } else { const s = solidOf(it, "Grading walls", colorOf("kind:wall")); if (s) { kids.push(s); track(s.z0); } }
    }
    if (kids.length) groups.push({ type: "group", name: LAYER_LABELS.grading, children: kids });
  }

  const name = String(mt.name || doc.name || "Model Viewer");
  const sitesec = getSection(doc, "site");
  const sd = sitesec && sitesec.derived;
  const location = sd && fin(sd.lat) && fin(sd.lon) ? { lat: sd.lat, lon: sd.lon } : null;
  const frame = doc.frame && typeof doc.frame === "object" ? doc.frame : {};
  const shift = frame.kind === "site" && zMin !== Infinity ? -zMin : 0;
  const notes = [
    "Plan origin = the project frame origin (the southwest corner of the site when the project has a site). x = east, y = north. Lengths in feet.",
    `Model Viewer: ${groups.length} layer${groups.length === 1 ? "" : "s"}: ${groups.map((g) => g.name).join(", ") || "none"}.`,
    "Each layer is one group. Units, cores, and parking are grouped by level. Tags: one per unit type, program, and part.",
    "Caution: the numbers come from design-stage tools. The viewer checks no code.",
  ];
  return makeDoc({
    source: SKETCHUP_SOURCE, name, location, zShift: shift, notes,
    tags: tagList, materials: matList, createdAt: mt.createdAt,
    root: { type: "group", name, children: groups },
  });
}
