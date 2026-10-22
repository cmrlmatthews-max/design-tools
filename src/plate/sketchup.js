/* ==========================================================================
   plate/sketchup.js — Plate Planner → ".sketchup.json" (docs/sketchup-spec.md, plan section 4)

   plateToSketchup(state, built, metrics, meta) → a document made with makeDoc, source "plate".
     state    the plate state
     built    buildPlates(state, ...) result (see derived.js for the fields read)
     metrics  computeMetrics result (optional; not read: the numbers come from platesDerived)
     meta     optional { createdAt, name, location, zShift, date }

   Structure: root group (the option name) > one group per level (the level name, "Level 3"; "Level 3 - Podium" when the name has no index; index order) >
     one solid per unit  (name = unit id, z to z + ftf, tag = the type name, in the type color; attributes type, area, corner, accessible, exposures)
     "Corridor"   one solid per corridor piece (holes kept)
     "Core"       the core outline
     "Stairs"     one solid per stair ("S1")
     "Elevators"  one solid per cab ("E1")
     "Support"    one solid per support block ("B1 (trash)")
   A level group with no corridor, core, stair, elevator, or support leaves those out. Raw geometry stays untagged: tags sit on the
   solids and groups, as in the other exports. The spec says "put tags on groups only"; a solid is a group in SketchUp.

   z: every z = the level z (floor surface above baseZ, plate frame) + zShift. zShift is 0 unless meta.zShift is given.
   Units: feet. Plan (x, y): the plate frame (the massing local frame). The notes carry the placement.

   Note: validateDoc in src/shared/sketchup-format.js must accept source "plate" (an integrator edit, plan section 10).
   Pure: no DOM, no input mutation.
   ========================================================================== */

import { makeDoc } from "../shared/sketchup-format.js";
import { platesDerived, typeTable, typeRow, r3 } from "./derived.js";

export const SKETCHUP_SOURCE = "plate";

const COLORS = { Corridor: "#d9dadc", Core: "#8f959c", Stairs: "#6f757c", Elevators: "#a3a8ae", Support: "#c9b99a" };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function plateToSketchup(state, built, metrics, meta) {
  if (!state) throw new Error('plateToSketchup: missing input "state".');
  if (!built) throw new Error('plateToSketchup: missing input "built".');
  void metrics;
  const mt = meta || {};
  const derived = platesDerived(state, built, metrics);
  const table = typeTable(state);
  const shift = isNum(mt.zShift) ? Math.round(mt.zShift * 100) / 100 : 0;

  const tagList = [], matList = [], declared = new Set();
  const declare = (name, color) => {
    if (!declared.has(name)) { declared.add(name); tagList.push({ name, color, visible: true }); matList.push({ name, color, alpha: 1 }); }
    return name;
  };

  const children = [];
  let nUnits = 0;
  for (const lv of derived.levels) {
    const z0 = r3(lv.z + shift), z1 = r3(lv.z + lv.ftf + shift);
    const kids = [];
    const solid = (name, outer, holes, tagName, color, attributes) => {
      const n = { type: "solid", name, tag: declare(tagName, color), material: tagName, outer, holes: holes || [], z0, z1 };
      if (attributes) n.attributes = attributes;
      return n;
    };
    for (const u of lv.units) {
      const row = typeRow(table, u.type);
      const attrs = { type: u.type, area: u.area, corner: u.corner, accessible: !!u.accessible, exposures: u.exposures.join(" ") };
      kids.push(solid(u.id, u.outer, [], u.type, row ? row.color : "#9aa3ad", attrs));
      nUnits++;
    }
    lv.corridor.forEach((pc, k) => kids.push(solid(lv.corridor.length > 1 ? `Corridor ${k + 1}` : "Corridor", pc.outer, pc.holes, "Corridor", COLORS.Corridor)));
    if (lv.core.outer) kids.push(solid("Core", lv.core.outer, [], "Core", COLORS.Core));
    for (const s of lv.core.stairs) kids.push(solid(String(s.id), s.outer, [], "Stairs", COLORS.Stairs));
    for (const e of lv.core.elevators) kids.push(solid(String(e.id), e.outer, [], "Elevators", COLORS.Elevators));
    for (const s of lv.support) kids.push(solid(`${s.id} (${s.kind})`, s.outer, [], "Support", COLORS.Support));
    if (!kids.length) continue;
    children.push({
      type: "group", name: new RegExp(`\\b${lv.index}\\b`).test(lv.name) ? lv.name : `Level ${lv.index} - ${lv.name}`, children: kids,
      attributes: { index: lv.index, z: lv.z, ftf: lv.ftf, units: lv.metrics.units, nrsf: lv.metrics.nrsf, gsf: lv.metrics.gsf, efficiency: lv.metrics.efficiency },
    });
  }

  const name = String(mt.name || state.name || "Plate Planner");
  const pl = built.placement || state.placement || null;
  const pn = (k) => (pl && isNum(pl[k]) ? pl[k] : 0);
  const dm = derived.metrics;
  const notes = [
    "Plan origin = the plate frame origin (the massing local frame). x = east, y = north. Lengths in feet. z = the level floor surface above the base.",
    `Placement of the plates section: x ${pn("x")}, y ${pn("y")}, rotation ${pn("rotation")} degrees, base z ${pn("baseZ")} ft.`,
    `Plate Planner: ${derived.mode}, ${derived.levels.length} levels, ${nUnits} ${derived.mode === "hotel" ? "keys" : "units"} drawn, NRSF ${dm.nrsf.toFixed(1)} sf, GSF ${dm.gsf.toFixed(1)} sf, efficiency ${(dm.efficiency * 100).toFixed(1)} percent.`,
    "Each unit is one solid from the floor to the floor above. Corridor, core, stairs, elevators, and support are separate solids. Tags: one per unit type, plus Corridor, Core, Stairs, Elevators, and Support.",
    "Area rule: unit area runs to the centerline of the demising walls, the corridor face of the corridor wall, and the inside face of the exterior wall.",
    "Caution: this is a test fit for early design. Unit counts and areas are design-stage numbers. The tool checks no code. Verify before use.",
  ];

  return makeDoc({
    source: SKETCHUP_SOURCE, name, location: mt.location || null, zShift: shift, notes,
    tags: tagList, materials: matList, createdAt: mt.createdAt,
    root: { type: "group", name, children },
  });
}
