# Model Viewer — Technical Plan

Version 1.0 · October 25, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)

The Model Viewer replaces the Egress Sketch as tool 8 on the Workspace page. The Egress Sketch moves to a "Later" list.

Caution: the Model Viewer shows design-stage numbers from the other tools. It checks no code and never says "compliant".

---

## 1. Purpose and decisions

The Model Viewer opens one project and shows every section together in one 3D model, with one summary table. It is view only. Each tool keeps its own editing.

| # | Decision (October 25, 2026, defaults taken on "go") |
|---|---|
| D1 | Content: every section — site, massing, plates, parking, facade, sun, grading. |
| D2 | View only. Each layer has an "Edit in <tool>" link that opens that tool with `?project=<id>`. |
| D3 | Layer toggles, a level cut (plan cut at one level), color by program or by unit type, tap an item for its data. |
| D4 | A project summary table. |
| D5 | Exports: screenshot, AI-ready image, combined SketchUp file. |
| D6 | Egress Sketch: off the tool list; one line in a "Later" list on the Workspace page. |

Tool id `viewer`, folder `viewer/`, title "Model Viewer". It writes no section. It never calls `writeSection` and never saves the project.

## 2. Sources and layers

All geometry goes to the **project frame** through `toProject` / `transformRing` / `transformMultiPoly` (spec section 4). z = local z + `placement.baseZ`.

| Layer id | Source | Drawn as | Default |
|---|---|---|---|
| `site` | `site.derived` | The shared site layer (`src/shared/sitelayer.js` + `build/shared` Three.js part): ground, roads, neighbors (removed buildings skipped) | On |
| `massing` | `massing.derived.levels` | One slab per level: plates extruded from `z` to `z + ftf`. Shown only for levels that `plates` does not cover | On |
| `units` | `plates.derived.levels[].units` | One solid per unit, `z` to `z + ftf` of its massing level (match by `index`; default ftf 10) | On |
| `cores` | `plates.derived.levels[].core` (outer, stairs, elevators, rooms) and `corridor` | Solids per level, darker gray | On |
| `parking` | `parking.derived.levels` | Plate slab, stalls as flat outlines on the slab, ramps as sloped strips, cores | On |
| `facade` | `facade.derived.faces` | A thin colored band on each face edge (`edge`, `levelFrom`..`levelTo`), colored by `system`; balconies count in the tap card | Off |
| `grading` | `grading.derived` | Proposed ground in place of the site ground when on; walls as thin solids | Off |
| `sun` | `sun.derived` | The light direction for the chosen sample (date and time pickers) | On (lighting only) |

A layer whose section is missing shows "No data" and an "Open <tool>" link.

## 3. Modules (pure, Node-tested)

```js
// src/viewer/scene.js
export function layersFrom(doc)              // → { site, massing, units, cores, parking, facade, grading, sun } each { ok, items: [...], bounds } in the project frame
export function levelsIndex(doc)             // → [{ key, z, name, sources: ["massing", "plates", "parking"] }] sorted by z (the level cut list)
export function cutAt(layers, z)             // → layers with every solid above z removed and the cut level marked (plan cut)
export function colorKey(item, mode)         // mode "program" | "unitType" | "source" → a palette key

// src/viewer/summary.js
export function summary(doc)                 // → rows: project, site (area, lat/lon), massing (GFA, floors, height, FAR, coverage),
                                             //   plates (units by type, NRSF, efficiency, units in range), parking (stalls by kind, sf per stall),
                                             //   facade (WWR by orientation, balconies), grading (cut, fill, net), and stale flags
export function staleFlags(doc)              // → [{ section, message }] e.g. plates.massingUpdatedAt older than massing.updatedAt

// src/viewer/sketchup.js
export const SKETCHUP_SOURCE = "viewer";
export function viewerToSketchup(doc, layersOn, meta)   // → makeDoc(): one group per layer, one solid per unit/level/stall slab
```

Item shape: `{ id, layer, kind, outer: Ring (project frame), z0, z1, program?, type?, data: {…} }` for solids; `{ id, layer, kind, line3 }` for lines. `data` holds the tap card text fields.

Rules: no DOM, no Three.js, never mutate the doc, skip malformed items, no NaN. Unknown section schemas: read what parses, warn once.

## 4. Page (`build/viewer/`, built to `viewer/index.html`)

Copy the shell of the Grading Sketch (same top bar, panel, HUD, site layer, view buttons, screenshot, help, tests harness). Remove editing, options, compare, and presets.

- **Top bar:** Tools home, CMRLM, "Model Viewer", Project menu (Open, Import, Export — no New), Site and Building zoom, Model/Diagram, Export (Image, AI-ready image, AI Prompts, SketchUp), Help.
- **No project:** an empty state: "Open a project to view it." with the project list.
- **Panel tabs:** Layers (toggles, "Edit in <tool>" links, No data notes), Levels (level cut list and a slider; "All levels"), View (color by Program / Unit type / Source; site style; sun date and time from `sun.derived`), Summary (the table, stale flags, the Caution).
- **HUD:** project name, GFA, units, stalls, efficiency, FAR, warnings count (stale flags).
- **Tap:** a card with the item's `data` (unit: type, area, level, exposures; level: program, area; stall: kind; face: system, WWR) and the "Edit in <tool>" link.
- **Level cut:** solids above the level hide; the cut level draws in plan colors (units by type in Diagram); camera moves to Plan with one tap.
- **Colors:** program colors from the Tower Generator; unit types from the Plate Planner mix colors; source mode: one color per layer.
- iPad: same bottom sheet as the other tools.

## 5. Workspace and suite edits

1. `index.html`: card 8 becomes "Model Viewer" (`data-section="viewer"`, opens `viewer/`, text "Every section of the project in one model, with a summary table. View only."). The card shows "Has data" when any section has data. Add a "Later" line under the list: "Egress Sketch: exit stairs, doors, and corridors checked for egress." Update the pipeline sentence and the "How projects work" table row (reads every section; writes nothing).
2. `docs/suite-roadmap.md`: Model Viewer row (built, in review); Egress Sketch row stays "Later".
3. `docs/project-file-spec.md` sections 2 and 9: add the viewer (reads every section, owns none); Egress stays reserved.
4. `src/shared/sketchup-format.js` `validateDoc`, `sketchup/cmrlm_design_tools/importer.rb`, `docs/sketchup-spec.md`: accept source `"viewer"`; rebuild the `.rbz`.
5. `package.json`: `build:viewer`, `test:viewer` in `npm test`. `README.md` tool row.

## 6. Tests

Module tests `test/viewer.*.test.mjs` on fixtures built from real tool output (Tower preset → `towerDerived`; Plate preset 8.1 → `platesDerived`; the parking, facade and grading fixtures their tests already make; the site fixture of `test/site.derived.test.mjs`):

| # | Case | Expect |
|---|---|---|
| V1 | Empty project | Every layer `ok: false`; summary has the project row only |
| V2 | Site + tower massing | Massing slabs in the project frame at `baseZ + z`; a rotated placement rotates them |
| V3 | + plates on a group of levels | Units replace the massing slab on those levels; unit count = plates metrics units |
| V4 | + parking | Stall count = parking metrics stalls |
| V5 | Level cut at a plate level | Nothing above the cut; the cut level keeps its units |
| V6 | Stale plates (massing newer) | `staleFlags` names plates |
| V7 | Summary | Numbers equal each section's `derived.metrics` |
| V8 | SketchUp doc | `validateDoc` passes; source `viewer`; one group per layer on |
| V9 | Determinism | Byte-equal output twice |

In-page tests (`viewer/index.html?test`): no-project empty state; fixture project loads every layer; toggles hide layers; level cut; tap card text; Edit links point to `../<tool>/?project=<id>`; the page never writes the project (storage unchanged byte for byte).

## 7. Phases and models

| Phase | Model | Owns | Reason |
|---|---|---|---|
| 1 | Opus | This plan | Reads every section's shape. |
| 2 | Sonnet | `src/viewer/*`, `build/viewer/*`, `viewer/index.html`, `test/viewer.*`, the `package.json` scripts | Standard module and page work against fixed contracts. |
| 3 | Haiku | `index.html` card and Later line, `docs/suite-roadmap.md`, spec sections 2 and 9, `README.md` row | Small text edits. |
| 4 | Opus | Section 5 item 4 (SketchUp source), review, full tests, screenshots | Cross-tool check. |
