# Plate Planner — Technical Plan

Version 0.1 · October 22, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Source: `plate-planner-notes.md` v0.2 (the concept for this tool) with the decisions in its section 14, which Cade gave on October 22, 2026.

This plan is the instruction set for the build phases. Each build agent gets this plan, the notes, and `docs/project-file-spec.md`.

Caution: the Plate Planner makes a test fit for early design. Unit counts, areas, corridor lengths, and accessible counts are design-stage numbers. The tool never checks a code and never says "compliant".

---

## 1. Scope and decisions

### 1.1 Decisions that bind the build

| # | Decision | Source |
|---|---|---|
| 1 | Modes: multifamily and hotel. Senior living comes later | Notes, header |
| 2 | Feet and square feet only | Notes, header |
| 3 | Plates from the project file (Tower or Mid-Rise massing), or a drawn or typed plate | Notes 3.1 |
| 4 | Corridors: bar, single-loaded, point (ring around the core) | Notes 3.3 |
| 5 | Area rule: centerline of demising walls, corridor face of the corridor wall, inside face of the exterior wall | Decision 1 |
| 6 | Exterior wall allowance 1.0 ft; corridor wall 0.5 ft, counted in the unit; both editable | Decision 1 |
| 7 | Stairs at the corridor ends on bar plates by default | Decision 2 |
| 8 | Default mix of notes 4.1; every share, width, and area editable per type | Decision 3 |
| 9 | Hotel suite: one key, two bays | Decision 4 |
| 10 | Podium levels out of the fill by default; a toggle shows them | Decision 5 |
| 11 | Users are Cade and RJTR teammates; a short Help panel | Notes, header |
| 12 | Generic names only; no client names | Notes, header |
| 13 | The project file is part of version 1 | Notes 9 |
| 14 | The tool reports distances (stair doors, dead ends); it checks no code | Notes 2.2 |

### 1.2 Changes from the notes

1. **Effective width range per type.** A type's usable width is `[max(widthMin, areaMin ÷ d), min(widthMax, areaMax ÷ d)]`, where `d` is the area depth of the run. The notes clamp only by width, so a stretched or shrunk unit could leave its area range (example A gave a 3BR of 1,293 sf against a 1,300 sf minimum). With the effective range, every unit width also meets its area range. A type whose range is empty at a depth ("does not fit this depth") drops out of that fill with a warning, and the other shares renormalize.
2. **Fixed unit count per run, chosen by exact feasibility.** The notes' greedy walk stops when the remainder is under the smallest width. In tests it left gaps it could not close (a 70 ft run took a 2BR and a 30 ft "studio"). The plan instead picks the unit count `n` of each run first: the count closest to `run ÷ W` for which some set of `n` types fits the run exactly within their effective ranges. Types then fill the `n` slots in deficit order, with an exact check that the remaining slots can still close the run. Widths then stretch or shrink in proportion to each unit's room. No run ends with a gap or an oversized last unit.
3. **Hotel slots are bays.** For hotels, `n` counts bays. A suite takes two slots. `W` is the weighted width per bay.
4. **Block reservations.** Any block that touches a run band (core, stair, elevator, support block, locked unit) reserves the band over the block's extent along the run. The rest of the band in that interval becomes support of kind `remainder`. The notes' examples already worked this way ("each stair takes 11 ft of bay length").
5. **Seeds win over corners.** When a Mid-Rise stair seed sits inside a convex corner zone, the corner gets no wrap unit. Its two runs end at the stair.
6. **Accessible first.** Accessible units and keys take their slots before the mix fill, at the run end nearest the elevators.
7. **Example numbers.** Section 8 replaces the notes' rounded estimates with the exact values of the rules above. Example A: 17 units, NRSF 15,077.8 sf, efficiency 0.773. Example B: 27 keys (28 bays), NRSF 10,296.0 sf, efficiency 0.715. Both sit inside the notes' test bands (A: 17 ± 1 units, 0.74 to 0.79; B: 26 ± 1 keys, 0.68 to 0.72). The tests in section 9 use the exact values with tight tolerances.

### 1.3 Reuse

| Reused verbatim (shared modules) | Copied and changed (Grading Sketch parts) | New |
|---|---|---|
| `src/shared/storage.js`, `screenshot.js`, `sketchup-format.js`, `project.js` | `build/grading/shell.html`, `body.html`, `css_add.css`, `build.py` | `src/plate/corridor.js`, `fill.js` |
| `src/tower/geometry.js` `shapeToRing` (typed L and U plates) | `00_imports.js` to `03b_store.js` | `src/plate/mix.js`, `levels.js`, `metrics.js` |
| `src/tower/prompts.js` (prompt library data; plate fields added in the page) | `06_render.js`, `06b_select.js` (plan drawing, tap select, vertex handles, snapping) | `src/plate/derived.js`, `exports.js`, `sketchup.js` |
| `src/site/exports.js` DXF writer style | `07_controls.js`, `08_ui.js`, `08b_prompts.js`, `08c_sketchup.js`, `08e_help.js`, `09_storage.js`, `09b_project.js`, `10_screenshot.js`, `11_compare.js`, `12_tests.js`, `13_start.js` | `src/plate/presets.js`, `testcases.js` |

**Why the Grading Sketch shell:** the Plate Planner is plan-first. The Grading Sketch shell already draws polygons in plan, selects by tap, drags vertices with snapping, and keeps a plan camera. The Facade Studio shell is built around faces and elevations.

Tests build massing sections two ways: Mid-Rise massings with `assemble` plus `midriseDerived` (they carry `spines` and `seeds`), and tower-like levels from `buildPlates` (they carry `coreRect`). The Plate Planner reads only `massing.derived`, so the tower's own `towerDerived` writer (planned in parallel) needs no special case.

---

## 2. State schema

All lengths are feet. Areas are square feet. Plan coordinates `(x, y)` are in the plate frame: east = +x, north = +y. With a project, the plate frame is the massing local frame and `placement` copies the massing placement.

```jsonc
{
  "schema": 1,
  "name": "Option A",
  "mode": "multifamily",                 // "multifamily" | "hotel"
  "source": "drawn",                     // "drawn" | "project"

  "plate": {                             // drawn source only
    "shape": "rect",                     // "rect" | "L" | "U" | "O" | "circle" | "polygon"
    "w": 300, "d": 65,                   // overall width (x) and depth (y)
    "arm": 60,                           // L and U arm depth
    "courtW": 120, "courtD": 90,         // O hole size (centered)
    "segments": 64,                      // circle
    "points": []                         // polygon: [[x, y], …] counter-clockwise
  },

  "levels": {                            // project source only
    "showPodium": false,                 // decision 10
    "selected": null,                    // group id being edited; null = the first fillable group
    "groups": {}                         // { [groupId]: { filled: true, locks: [] } } per-group edits
  },

  "corridor": {
    "kind": "auto",                      // "auto" | "bar" | "single" | "point"; auto = point with a core and no spines, else bar
    "width": null,                       // clear width; null = mode default (multifamily 5.67, hotel 6.0)
    "wall": 0.5,                         // corridor wall thickness, counted in the unit (decision 6)
    "side": "south",                     // single-loaded: the facade side that holds the corridor
    "spine": null                        // null = from the massing spines or the plate axis; else [[[x, y], [x, y]], …]
  },
  "extWall": 1.0,                        // exterior wall allowance (decision 6)

  "core": { "rect": null },              // [x0, y0, x1, y1] or null; project: the massing core
  "stairs": {
    "mode": "auto",                      // "auto" (corridor ends; point: in the core) | "seeds" | "manual"
    "size": [11, 22],                    // along the corridor, across it
    "items": []                          // manual: [{ "id": "S1", "rect": [x0, y0, x1, y1] }]
  },
  "elevators": { "count": null, "size": [8, 10], "service": null },   // null = mode default (2; hotel adds 1 service)
  "support": [],                         // [{ "id": "B1", "kind": "trash" | "electrical" | "storage" | "linen" | "ice" | "data", "rect": [x0, y0, x1, y1] }]
  "hotelBoh": { "on": true, "place": "core" },   // hotel: linen 8 × 14, ice 6 × 8, data 6 × 8 next to the core

  "mix": {
    "multifamily": [
      { "id": "studio", "name": "Studio",    "widthMin": 20, "widthMax": 24, "targetArea": 525,  "areaMin": 450,  "areaMax": 600,  "share": 0.10, "color": "#9cc3e6" },
      { "id": "1br",    "name": "1BR",       "widthMin": 24, "widthMax": 28, "targetArea": 725,  "areaMin": 650,  "areaMax": 800,  "share": 0.45, "color": "#4f7fd1" },
      { "id": "1brden", "name": "1BR + den", "widthMin": 28, "widthMax": 32, "targetArea": 900,  "areaMin": 850,  "areaMax": 950,  "share": 0.10, "color": "#6b5fc7" },
      { "id": "2br",    "name": "2BR",       "widthMin": 32, "widthMax": 40, "targetArea": 1100, "areaMin": 1000, "areaMax": 1200, "share": 0.30, "color": "#2f9e9a" },
      { "id": "3br",    "name": "3BR",       "widthMin": 40, "widthMax": 48, "targetArea": 1400, "areaMin": 1300, "areaMax": 1500, "share": 0.05, "color": "#d9a22b" }
    ],
    "hotel": [
      { "id": "king",  "name": "King",         "widthMin": 13.5, "widthMax": 14.5, "target": 14,   "bays": 1, "share": 0.60, "color": "#8a63c9" },
      { "id": "dq",    "name": "Double queen", "widthMin": 14,   "widthMax": 15,   "target": 14.5, "bays": 1, "share": 0.30, "color": "#b48ad9" },
      { "id": "suite", "name": "Suite",        "widthMin": 27,   "widthMax": 29,   "target": 28,   "bays": 2, "share": 0.05, "color": "#5b3f99" }
    ],
    "cornerType": "2br",                 // multifamily wrap corner units
    "accessibleWidth": [15, 16, 15.5]    // hotel accessible key: min, max, target
  },

  "accessible": {                        // Caution: seeds for an editable table; verify every count against the adopted code
    "multifamily": { "typeAShare": 0.02, "minUnits": 1, "over": 20 },
    "hotel": [ [25, 1, 0], [50, 2, 0], [75, 4, 1], [100, 5, 1], [150, 7, 2], [200, 8, 2], [300, 10, 3], [400, 12, 4] ],   // [max keys, accessible, roll-in]
    "perFloor": null                     // null = spread the building count over the floors; else a number
  },
  "housekeepingReach": 150,              // hotel: keys within this corridor travel of the linen closet

  "locks": [],                           // drawn source: [{ "id": "U-07", "outer": Ring, "type": "2br" }]
  "placement": null,                     // project: copied from the massing placement

  "view": {
    "style": "model",                    // "model" | "diagram" (units colored by type)
    "labels": true, "walls": true, "bays": true,   // unit labels, corridor wall lines, bay-line ticks
    "levels3d": false,                   // show every filled level stacked in 3D
    "context": true, "grid": true, "figure": false,
    "snap": { "on": true, "grid": 0.5 }
  }
}
```

**Default state:** preset "Double-loaded bar" (section 8.1).

**Storage:** key `plate.options.v1`, schema 1, through `createStorage`. The store deep-merges a loaded state over the default state. `migrate` returns the state unchanged for schema 1.

---

## 3. Fill pipeline

```
state (+ project) → levels and groups → plate → corridor spine → corridor polygon → blocks (core, stairs, elevators, support, locks)
      → unit zone → runs and corners → counts → slots per run → types per slot → widths → unit polygons
      → exposures and corners → corridor graph → accessible → metrics → derived
```

Every step is a pure function. Clipper runs at `SCALE = 1000` (0.001 ft), as in `src/site/model.js`. Coordinates round to 0.001 ft and areas to 0.1 sf. The same inputs always give the same result.

### 3.1 Step 1 — Levels and groups (`levels.js`)

- Drawn source: one level, index 1, from `state.plate` (typed shapes through `shapeToRing`; O = rect minus the centered hole; circle = `segments`-gon).
- Project source: `sections.massing.derived.levels`. Skip zones `deck`, `crown`, and `mechanical`, and every level with `plates: []`. Skip zone `podium` unless `levels.showPodium`.
- **Group key:** each level's rings (outer and holes) with vertices rounded to 0.01 ft, plus the core ring and the seed rings, serialized and hashed (FNV-1a over the JSON). Levels with the same key form one group: "Levels 7–22 (16 floors)".
- The tool fills one level per group (the lowest) and copies the result to the other levels of the group, with their own `index`.

### 3.2 Step 2 — Corridor spine (`corridor.js`)

- `corridor.spine` when set.
- Else the massing level's `spines` when present (Mid-Rise bars). Merge pieces that share an end point and run straight.
- Else, kind `point` (a core and no spines): the spine is the ring at `core + wall + width ÷ 2` around the core rectangle.
- Else, kind `bar`: one segment per arm. A rectangle gets its long axis through the centroid. An L or a U gets one segment per arm along the arm centerline; the segments meet at the arm centerlines' crossing. A general polygon gets the long axis of its minimum-area bounding rectangle through the centroid, clipped to the plate.
- Kind `single`: the spine runs parallel to the chosen facade side, at `extWall + width ÷ 2` from it.

### 3.3 Step 3 — Corridor polygon

Offset the spine by `width ÷ 2` (Clipper open-path offset, square end caps, miter joins), union, and clip to the plate. This is the **clear** corridor. The corridor walls lie outside it, inside the units (decision 5).

### 3.4 Step 4 — Blocks

- **Stairs.** `auto`: on bar and single-loaded plates, one stair at each corridor end, `size[0]` along the corridor and `size[1]` across it, centered on the spine, its outer face at the plate edge. On point plates, two stairs inside the core. `seeds`: the massing `seeds` of kind `stair` and `exterior-stair`. `manual`: `stairs.items`.
- **Door point:** the middle of the stair face that touches the corridor.
- **Elevators:** `count` cabs (default 2; hotel adds 1 service) of `size`, side by side inside the core. With no core, they sit beside the corridor at mid-length on the first run and reserve it.
- **Core:** `core.rect`, or the massing level `core` ring. A core that blocks the corridor raises `core-blocks-corridor` and moves to the nearest free spot on a 25 × 25 grid (notes 13).
- **Hotel back-of-house:** linen 8 × 14, ice 6 × 8, data 6 × 8, placed against the core on the side with the longest run.
- **Support blocks:** `support`. **Locks:** locked unit outlines (drawn source) or the group's `locks` (project source).

### 3.5 Step 5 — Unit zone, runs, and corners (`fill.js`)

1. **Unit zone** = plate inset by `extWall` − corridor − every block. The plate inset is the area line of the facades.
2. **Facade loops:** the outer ring and each hole ring of the inset plate. Merge collinear edges (0.5 degrees, 0.1 ft).
3. **Run band:** for each facade edge, the part of the unit zone within reach of that edge (the strip between the area line and the corridor face). **Area depth** `d` = distance from the area line to the corridor face. Example A: `(65 − 5.67) ÷ 2 − 1.0 = 28.665` ft.
4. **Convex corners where the corridor turns** (outer corners of an L, a U, an O, and every point-tower corner): a wrap unit of type `cornerType` with leg `e = clamp((A + d²) ÷ (2d), d, 2d)` along each facade, measured from the inset corner, where `A` is the corner type's target area. Its area is `d (2e − d)`. Example: `d = 26.165`, `A = 1,100` → `e = 34.103`, area 1,100.0.
5. **Concave corners** (inside corners of an L or a U, and courtyard hole corners): the two bands overlap in a `d × d` square. It becomes support of kind `pocket`.
6. **Bar ends** (the corridor does not turn): no wrap unit. The end units get the corner flag only when they touch two facades.
7. **Reservations:** every block that touches a band reserves the band over the block's extent along the run (change 4). The rest of the band in that interval becomes support of kind `remainder`. A run splits at each reservation.
8. **Run length** `L` = the run's length along the area line between reservations, corner legs, and ring ends.

### 3.6 Step 6 — Counts (`mix.js`)

1. Effective range per type at depth `d`: `lo = max(widthMin, areaMin ÷ d)`, `hi = min(widthMax, areaMax ÷ d)`. Target width `w = clamp(targetArea ÷ d, lo, hi)`. Hotel types use `target`, `widthMin`, and `widthMax` directly.
2. A type with `lo > hi` does not fit this depth: drop it, warn `type-does-not-fit` with its range, and renormalize the shares.
3. Weighted width `W = Σ share × w` (hotel: per bay, `Σ share × w ÷ Σ share × bays`).
4. Unit count `N = floor(ΣL ÷ W) + corner units` (hotel: keys from `ΣL` less the accessible keys, `floor((ΣL − Σ accessible widths) ÷ Wkey)`).
5. Per-type targets: `share × N` by the largest-remainder method (ties by type order). Corner units count toward `cornerType`.

### 3.7 Step 7 — Slots and types per run

1. **Achievable sums.** For each slot count `r`, list the `(Σlo, Σhi)` pairs reachable by any multiset of `r` slots of the available types (a suite fills two slots). Memoize by `r`; with five types and `r ≤ 20` this is a few thousand pairs.
2. **Run slot count** `n`: among the counts with a pair where `Σlo ≤ L ≤ Σhi`, the one closest to `L ÷ W` (ties: the smaller). With no such count, the run becomes support of kind `remainder` and warns `run-too-short`.
3. **Accessible first** (change 6): accessible keys and Type A units take the first slots at the run end nearest the elevators (section 3.10).
4. **Types:** fill the slots from the run start. For each slot, try the types in deficit order: `(target − placed) ÷ target`, largest first, ties by type order; types with no remaining target come last. Take the first type for which the remaining slots can still close the run. The test: with the type taken, some achievable pair `(Σlo_rest, Σhi_rest)` for the remaining slot count satisfies `Σlo_taken + Σlo_rest ≤ L ≤ Σhi_taken + Σhi_rest`. Deficit counters carry from run to run.
5. **Run order:** outer ring first, then holes; each ring counter-clockwise from its lowest, then westmost, vertex; within a ring, runs in that order.
6. **Widths:** start at the target widths. Remainder `R = L − Σw`. With `R ≥ 0`, each unit stretches by `R × (hi − w) ÷ Σ(hi − w)`; with `R < 0`, each shrinks by `R × (w − lo) ÷ Σ(w − lo)`. The checks of step 2 and step 4 make this exact; a unit never leaves its range.

### 3.8 Step 8 — Unit polygons and lines

- Each unit is the band between its two cut lines (perpendicular to the run, from the area line to the corridor face), intersected with the band polygon. Rectangular bands give rectangles. Angled or curved facades give polygons (circle plate: test 11).
- **Demising lines:** the two cut lines of each unit, from the corridor face to the area line. Wrap corner units have their two leg-end lines.
- **Corridor wall line:** drawn `wall` inside the unit, parallel to the corridor face (rendering and DXF only; the area already includes it).
- **Bay:** `from` and `to` along the facade ring that the unit faces, counter-clockwise from the ring's first vertex, and `ring` (0 outer, `k` hole `k`).
- **Locks:** a locked unit keeps its outline and type; it is a reservation for the fill (step 3.5 item 7) and enters the output unchanged.

### 3.9 Step 9 — Exposures and corners

Bin each facade edge of a unit by its outward normal into N, E, S, W (45-degree sectors, the facade rule of the Facade Studio, after the placement rotation). A unit with facade edges in two sectors is a corner unit.

### 3.10 Step 10 — Accessible units and keys

- Multifamily: Type A units = `max(minUnits, ceil(typeAShare × building units))` when the building has more than `over` units, else 0. Spread over the groups by floor count; on each filled level, the Type A flag goes to the units nearest the elevators (no change in width).
- Hotel: the building key count picks the table row (`accessible`, `rollIn`). Spread over the floors (`perFloor` or `ceil(accessible ÷ floors)`, one or two per floor). Accessible keys use `accessibleWidth` and take the first slots next to the elevators.
- Caution: these are seeds for an editable table. The tool shows the source row and never says "compliant".

### 3.11 Step 11 — Corridor graph

- Nodes: spine end points, spine junctions, and the projection of each stair door onto the spine. Edges: the spine pieces with their lengths.
- **Corridor length:** the clear corridor polygon area ÷ width (equal to the spine length between the stair faces on a bar).
- **Stair door path:** the shortest path along the graph between the two farthest-apart stair doors (Dijkstra).
- **Dead ends:** on each branch, the length beyond the last stair door toward a spine end. Stairs at the corridor ends give 0.
- **Hotel reach:** keys whose door (the middle of the unit's corridor face) lies within `housekeepingReach` of the linen closet along the graph.

### 3.12 Step 12 — Metrics (`metrics.js`)

| Metric | Formula |
|---|---|
| Units / keys | Count per type, per level and building (level × group floors); hotel bays |
| Mix | Placed share against target share, and the difference in units; `mix-miss` when a type is off by more than one unit on a level |
| NRSF | Σ unit polygon areas (area rule of decision 5) |
| GSF | Plate area (outer minus holes) |
| Efficiency | NRSF ÷ GSF |
| Average unit area | NRSF ÷ units |
| Corner units, exposures | Section 3.9 |
| Corridor | Length; length per unit |
| Stair doors, dead ends | Section 3.11; reported only |
| Support | Count and area by kind (pocket, remainder, blocks) |
| Area closure | GSF − (NRSF + corridor + core + stairs + elevators + support) = the exterior allowance strip along the runs; warns when it leaves ±1 sf of `extWall × Σ run lengths on area lines plus corner legs` |
| Flags | `type-does-not-fit`, `run-too-short`, `mix-miss`, `core-blocks-corridor`, `stale-massing` |

### 3.13 Step 13 — Derived writer (`derived.js`)

`platesDerived(state, built, metrics)` writes spec section 6.3 with the optional keys of the notes section 9:

- `mode`, `massingUpdatedAt` (the massing section `updatedAt` the fill used; null for drawn plates).
- `levels[]` for every level of every filled group: `index`, `plate`, `corridor`, `core: { outer, stairs: [{ id, outer, door }], elevators: [{ id, outer }] }`, `support: [{ id, outer, kind }]`, `units: [{ id, type, outer, area, exposures, corner, bay: { from, to }, ring, demising, accessible }]`, `metrics: { units, nrsf, gsf, efficiency }`.
- `mix: [{ type, count, share, avgArea }]` and building `metrics: { units, nrsf, gsf, efficiency, corridorFt }`.
- Unit ids: `"<level>-<nn>"` in run order (`"3-07"`). Coordinates in the plate frame (the massing local frame), rounded to 0.001 ft. Rings clean through `cleanRing2`.
- Contract kept for readers: the Parking Deck overlay reads `units[].demising` (two-point lines) on the lowest residential level; the Facade Studio `unitBalconies` reads `units[].outer`. Both work with the shapes above.

---

## 4. Module contracts

Pure ES modules. No DOM, no Three.js, no hidden state, no mutation of inputs. One-line relative imports only. Every export starts a line with `export function` or `export const`. Every function throws a clear error that names a missing input.

```js
// src/plate/mix.js
export const MULTIFAMILY_TYPES                               // section 2 defaults
export const HOTEL_TYPES
export function effectiveTypes(types, depth, mode)          // → { types: [{ id, w, lo, hi, bays, share }], dropped: [{ id, lo, hi }] } (section 3.6)
export function weightedWidth(types)                        // → { W, Wbay }
export function countsFor(lengthFt, types, corners)         // → { N, counts: { [id]: n } } (largest remainder)
export function scoreMix(units, counts, types)              // → { byType: [{ type, count, target, share, diff }], misses: [type] }
export function requiredAccessible(state, buildingCount)    // → multifamily { typeA } | hotel { keys, rollIn, row }

// src/plate/corridor.js
export function spineFor(plate, level, state)               // → { kind, spine: [[[x,y],[x,y]],…] } (section 3.2)
export function corridorPolygon(spine, width, plate)        // → MultiPoly (section 3.3)
export function stairBlocks(kind, spine, plate, state, seeds)   // → [{ id, outer, door }]
export function corridorGraph(spine, stairs, units)         // → { lengthFt, stairPathFt, deadEnds: [{ stairId, ft }], reach(fromPoint, maxFt) }

// src/plate/fill.js
export function unitZone(plate, corridor, blocks, extWall)  // → { zone: MultiPoly, areaLines: [Ring] }
export function runsAndCorners(zone, plate, corridor, blocks, state)   // → { runs: [{ id, ring, edge, from, to, length, depth, band, start, end }], corners: [{ ring, at, e, outer }], pockets: [{ outer }], remainders: [{ outer }] }
export function slotsFor(run, types, W)                     // → n | null (section 3.7 item 2)
export function fillRuns(runs, types, counts, opts)         // → [{ runId, units: [{ type, from, to, width }] }] (section 3.7)
export function fillLevel(level, state, { counters } = {})  // → LevelFill { plate, corridor, core, stairs, elevators, support, units, runs, warnings }
export function buildPlates(state, { project = null } = {}) // → { source, groups: [{ id, levels, fill }], placement, warnings, notes }

// src/plate/levels.js
export function levelsFrom(state, project)                  // → [{ index, name, zone, z, ftf, program, plate, core, spines, seeds }] (section 3.1)
export function groupLevels(levels)                         // → [{ id, key, levels: [index], first, floors, label }]
export function plateFromState(plateState)                  // → MultiPoly for the drawn shapes

// src/plate/metrics.js
export function computeMetrics(state, built)                // → every row of section 3.12, per level and building
export function checks(state, metrics)                      // → Warning[] { code, severity, where, message }

// src/plate/derived.js
export function platesDerived(state, built, metrics)        // → plates.derived (section 3.13)

// src/plate/exports.js
export function roomsCsv(derived, placement)                // → CSV (section 5 of the notes, column list below)
export function plateDxf(derived, state)                    // → DXF R12 text
export function notesMarkdown(state, built, metrics, meta)  // → string with the area rule, mix, metrics, and every Caution

// src/plate/sketchup.js
export const SKETCHUP_SOURCE = "plate";
export function plateToSketchup(state, built, metrics, meta)   // → doc from makeDoc(): one group per level; one solid per unit (z to z + ftf), tagged by type; corridor, core, stairs, support

// src/plate/presets.js
export const PRESETS            // [{ id, name, description, state }] section 8
export function defaultState()

// src/plate/testcases.js
export const TEST_CASES         // [{ id, state, project?, expect: { units?, keys?, bays?, nrsf?, efficiency?, counts?, corners?, pockets?, tolerance } }]
```

**Rooms CSV columns:** `level_index, level_name, unit_id, type, area_sf, cx, cy, z, nrsf, exposures, corner, accessible, bay_from, bay_to`, with a first comment line `# placement x, y, rotation, baseZ`. The centroid is in the plate frame.

**DXF layers** (R12, AC1009, feet, plate frame, one block of levels per filled group, stacked by z): `PLATE`, `UNIT-LINE` (demising lines), `UNIT-AREA` (unit outlines), `CORRIDOR`, `CORRIDOR-WALL`, `CORE`, `STAIR`, `ELEV`, `SUPPORT`, `TEXT` (type, id, and area at each centroid).

`buildPlates` is the only function that reads the project. Every other module reads its result.

---

## 5. Interface

### 5.1 Tabs

Same panel, tabs, and top bar as the Grading Sketch. Tab order: Plate, Units, Checks, View.

- **Plate tab:** source card (drawn or the open project). Drawn: shape, sizes, draw polygon. Project: the level group list ("Levels 3–7 (5 floors)", with a podium toggle); tap a group to edit it. Corridor card: kind, clear width, wall thickness, side. Blocks card: core, stairs (auto, seeds, manual), elevators, support blocks, hotel back-of-house; Add starts drawing a rectangle.
- **Units tab:** mode (multifamily or hotel). The **mix editor**: one row per type with share, width min and max, target area (hotel: target width and bays), area min and max, and color; shares show their sum and normalize on Fill. Corner type. Re-fill button. The placed-against-target table.
- **Checks tab:** extWall, accessible table (with its Caution), housekeeping reach, flags list. The area closure table.
- **View tab:** style (model or diagram), labels, corridor walls, bay ticks, 3D levels, context, grid.

### 5.2 Top bar

Option menu (presets, Save, Duplicate, Rename, Delete, Compare), Undo, Redo, Model/Diagram, Export menu (Image, AI-ready image, AI Prompts, SketchUp, Rooms CSV, DXF, Notes, Export JSON, Import JSON, Send to Parking Deck, Send to Facade Studio), Project menu (New, Open, Import, Export), Help.

HUD, always visible: units (or keys), NRSF, efficiency, warning count. One tap expands the mix table, corridor, stair door path, dead ends, support, and the building totals.

### 5.3 Selection and editing (plan view first)

- **Select a unit** by tap: the card shows type, width, area, exposures, flags, and a lock toggle; change the type from the card (the run re-solves widths around it).
- **Drag a bay line** along its run: snap 0.5 ft; the two neighbors change width; the drag refuses a position that takes a neighbor out of its effective range.
- **Lock** a unit: it keeps its outline and type through re-fill.
- **Re-fill:** recomputes every unlocked unit of the selected group from the mix. "Apply to group" is automatic: every level of a group shares its fill.
- **Move blocks:** drag the core, a stair, an elevator, or a support block (snap to the grid, the corridor, and the facade lines); the fill updates on release.
- Mac shortcuts: 1 to 6 views (Plan is 6 and the default), D Model/Diagram, L lock, F re-fill, Delete removes a block, Escape clears.

### 5.4 iPad

Same bottom sheet as the Grading Sketch in portrait. Handles 44 points or larger. Bay-line drags use a 16 px touch tolerance.

---

## 6. Rendering

- **Plan view by default** (orthographic top). Axon and the four elevations stay available.
- **Model style:** white plate slab; units as thin white slabs with dark demising lines and the corridor wall line; corridor light gray; core and stairs mid gray; support hatched.
- **Diagram style:** units colored by type (section 2 colors) with a legend; accessible units carry a small symbol; flagged units outlined red.
- **Labels:** type and area at each unit centroid; hidden below a zoom threshold.
- **3D levels:** every filled level stacked at its z and ftf, for the screenshot and the SketchUp preview.
- **Context:** the massing outline of other levels as a faint line; site neighbors when the project has a site.
- **Draft quality** while a bay line or block moves: re-solve only the touched run; full fill on release.
- **Target:** a 40-unit level (example 8.6) refills in under 30 ms on an iPad.

---

## 7. Project file

Follows `docs/project-file-spec.md`.

- **Start:** `projectIdFromUrl` → `loadProject`. Load `sections.plates.state` when present. With a massing section, source `project`; else `drawn`.
- **Reads:** `massing.derived.levels` (plates, core, spines, seeds, program, z, ftf) and `massing.updatedAt`; `massing.placement` (copied to the plates placement); `site.derived.buildings` for context only.
- **Massing from the Tower or the Mid-Rise:** both write the same `massing.derived` shape. Tower levels have a `core` and no `spines`, so `corridor.kind` `auto` gives a point corridor. Mid-Rise levels have `spines` and `seeds`, so `auto` gives bars with seed stairs available (`stairs.mode` `seeds` is the default when seeds exist).
- **Stale fill:** when `massing.updatedAt` is newer than `derived.massingUpdatedAt`, the top bar shows "The massing changed after this fill" with a Re-fill button.
- **Write:** `writeSection(doc, "plates", { tool: "plate", schema: 1, placement, state, derived })`, debounced 1 s, plus `visibilitychange` and `pagehide`.
- **Send:** Export menu, "Send to Parking Deck" and "Send to Facade Studio" (`sendTo(storage, doc, "parking" | "facade", "plate")`). The Mid-Rise already has "Send to Plate Planner"; the Tower gets it with its project work (parallel plan).
- **Size:** about 0.5 KB per unit; a 20-level building with 18 units per level adds about 200 KB.

**Integrator edits outside the plate folders:** see section 10.

---

## 8. Presets

Phase 6 (Haiku) types these values into `src/plate/presets.js`. Unless a preset says otherwise: drawn source; multifamily mix of section 2; corridor clear 5.67 ft (hotel 6.0), wall 0.5; extWall 1.0; stairs auto 11 × 22; no elevators outside the core. Every number below comes from the rules of section 3. Area depths: 65 ft bar `d = (65 − 5.67) ÷ 2 − 1 = 28.665`; 60 ft bar `d = (60 − 5.67) ÷ 2 − 1 = 26.165`; hotel 60 ft bar `d = (60 − 6) ÷ 2 − 1 = 26.0`.

**The corridor-wall rule (decision 5) and the notes' examples.** The notes' examples used `d = 28.67` and `d = 26`: the area line to the corridor face. That is exactly the decided rule, so their depths stand. Under the earlier "center of the corridor wall" rule, the unit line would sit `wall ÷ 2 = 0.25` ft farther from the facade: `d = 28.415` and NRSF 14,946.3 for example A. The decided rule gains `526 × 0.25 = 131.5` sf there.

### 8.1 Double-loaded bar (default; notes example A)

| Item | Value |
|---|---|
| Plate | rect 300 × 65, centered: x −150 to 150, y −32.5 to 32.5; GSF 19,500 |
| Corridor | bar along x, clear 5.67: y −2.835 to 2.835 |
| Stairs | x −150 to −139 and 139 to 150, y −11 to 11 |
| Core | `[−15, 2.835, 15, 32.5]` (30 ft on the north side at mid-length, full run depth) |

Runs: south x −139 to 139 = 278; north-east 139 to 15 = 124; north-west −15 to −139 = 124; ΣL = 526. Types at `d = 28.665` (lo, hi, w): studio 20, 20.93, 20; 1BR 24, 27.91, 25.292; 1BR + den 29.65, 32, 31.397; 2BR 34.89, 40, 38.374; 3BR 45.35, 48, 48. `W = 0.10 × 20 + 0.45 × 25.292 + 0.10 × 31.397 + 0.30 × 38.374 + 0.05 × 48 = 30.433`. `N = floor(526 ÷ 30.433) = 17`; targets 2, 7, 2, 5, 1.

Reference fill (section 3.7): south (9 slots) studio 20.00, 1BR 24.44, den 30.24, 2BR 36.07, 3BR 46.25, 1BR 24.44, 2BR 36.07, 1BR 24.44, 2BR 36.07; north-east (4) 1BR 25.14, studio 20.00, den 31.19, 3BR 47.68; north-west (4) 1BR 24.84, 2BR 37.16, 1BR 24.84, 2BR 37.16.

**Expected: 17 units** (studio 2, 1BR 6, den 2, 2BR 5, 3BR 2 — 1BR −1 and 3BR +1 against target, inside the ±1 mix rule). **NRSF = 526 × 28.665 = 15,077.8 sf; efficiency 15,077.8 ÷ 19,500 = 0.7732.** Area closure: corridor 278 × 5.67 = 1,576.3; stairs 2 × 242 = 484; core 30 × 29.665 = 890.0; remainders beyond the stairs 4 × 11 × 21.5 = 946.0; NRSF 15,077.8; sum 18,974.1; the rest, 525.9 ≈ 526 × 1.0, is the exterior allowance along the runs. Corridor 278 ft; stair door path 278 ft; dead ends 0.

### 8.2 Hotel bar (notes example B)

| Item | Value |
|---|---|
| Mode | hotel; mix king 0.60, double queen 0.30, suite 0.05 (normalized ÷ 0.95); one accessible key on this level |
| Plate | rect 240 × 60, centered; GSF 14,400 |
| Corridor | clear 6.0: y −3 to 3 |
| Stairs | x −120 to −109 and 109 to 120, y −11 to 11 |
| Blocks | guest elevators `[−8, −30, 8, −3]`; service elevator and back-of-house `[−12, 3, 12, 30]` |

Runs: south-west −109 to −8 = 101; south-east 8 to 109 = 101; north-east 109 to 12 = 97; north-west −12 to −109 = 97; ΣL = 396. `Wkey = (0.60 × 14 + 0.30 × 14.5 + 0.05 × 28) ÷ 0.95 = 14.895`; `Wbay = 14.895 ÷ 1.0526 = 14.150`. Keys from the mix: `floor((396 − 15.5) ÷ 14.895) = floor(25.55) = 25`; targets king 16, double queen 8, suite 1. The accessible key (15.5 ft) takes the slot at the south-west run's east end, next to the guest elevators.

Reference fill: south-west (85.5 after the accessible key) king, double queen, suite, king, king; south-east 7 bays; north-east 7; north-west 7.

**Expected: 27 keys** (king 17, double queen 8, suite 1, accessible 1) **in 28 bays. NRSF = 396 × 26.0 = 10,296.0 sf; efficiency 10,296.0 ÷ 14,400 = 0.7150.** The notes estimated about 26 keys, 10,100 sf, and 0.70. The exact values sit inside the notes' bands (26 ± 1 keys, 0.68 to 0.72). The rule fills every run edge to edge, so NRSF depends only on run length and depth: `ΣL × d`.

### 8.3 L plate, 60 ft arms

| Item | Value |
|---|---|
| Plate | polygon (0, 0), (200, 0), (200, 60), (60, 60), (60, 140), (0, 140); GSF 16,800 |
| Spine | (30, 30) → (200, 30) and (30, 30) → (30, 140) (auto, one per arm) |
| Stairs | at the two corridor ends: `[189, 19, 200, 41]` and `[19, 129, 41, 140]` |

`d = 26.165`. The 1BR + den (lo `850 ÷ 26.165 = 32.49` > hi 32) and the 3BR (lo `1,300 ÷ 26.165 = 49.68` > hi 48) do not fit this depth: both drop with `type-does-not-fit`; shares renormalize over studio, 1BR, 2BR (0.10, 0.45, 0.30 ÷ 0.85). One wrap corner at (0, 0): `e = (1,100 + 26.165²) ÷ 52.33 = 34.103`, area 1,100.0. One pocket at (60, 60): 26.165² = 684.6. Runs on the area lines: south `188 − 34.103 = 153.897`; arm north side 59 → 189 = 130; arm east side 59 → 129 = 70; west `128 − 34.103 = 93.897`; ΣL = 447.794.

**Expected: 16 units** (studio 2, 1BR 8, 2BR 6 including the corner). **NRSF = 447.794 × 26.165 + 1,100.0 = 12,816.5 sf; efficiency 0.7629.** Spine: two segments; dead ends 0.

### 8.4 U plate, 60 ft arms

| Item | Value |
|---|---|
| Plate | polygon (0, 0), (200, 0), (200, 140), (140, 140), (140, 60), (60, 60), (60, 140), (0, 140); GSF 21,600 |
| Spine | (30, 30) → (170, 30); (30, 30) → (30, 140); (170, 30) → (170, 140) |
| Stairs | `[19, 129, 41, 140]` and `[159, 129, 181, 140]` |

`d = 26.165`; den and 3BR drop as in 8.3. Two wrap corners (1,100.0 each), two pockets (684.6 each). Runs: south `198 − 2 × 34.103 = 129.794`; east `128 − 34.103 = 93.897`; east arm inner side 70; court base 59 → 141 = 82; west arm inner side 70; west 93.897; ΣL = 539.588.

**Expected: 21 units** (studio 3, 1BR 12, 2BR 6 including 2 corners). **NRSF = 539.588 × 26.165 + 2 × 1,100.0 = 16,318.3 sf; efficiency 0.7555.** Spine: three segments.

### 8.5 Point tower

| Item | Value |
|---|---|
| Plate | rect 100 × 100, centered; GSF 10,000 |
| Core | `[−15, −15, 15, 15]`; corridor `point` (ring, clear 5.67: the corridor outer square is ±20.67) |
| Stairs, elevators | inside the core |

`d = (100 − 41.34) ÷ 2 − 1 = 28.33`. Every type fits this depth (studio 20 to 21.18; 1BR 24 to 28; den 30.00 to 32; 2BR 35.30 to 40; 3BR 45.89 to 48). Four wrap corners (every corner turns the ring): `e = (1,100 + 28.33²) ÷ 56.66 = 33.579`, area 1,100.0. Four runs of `98 − 2 × 33.579 = 30.842`: one slot each; the only type whose range holds 30.842 is the 1BR + den (30.00 to 32), so each run takes one den at 30.84.

**Expected: 8 units** (2BR 4 corners, den 4); every unit has an exposure; corners have two. **NRSF = 98² − 41.34² = 9,604 − 1,709.0 = 7,895.0 sf; efficiency 0.7895.** Mix misses on studio, 1BR, 3BR are expected and listed.

### 8.6 Courtyard level (typed O)

| Item | Value |
|---|---|
| Plate | O: rect 250 × 220 minus a centered 120 × 90 court; GSF 55,000 − 10,800 = 44,200 |
| Spine | ring at the bar centerlines: x ±92.5, y ±77.5 |
| Stairs | at the middle of the south and north spine pieces: `[−5.5, −88.5, 5.5, −66.5]`, `[−5.5, 66.5, 5.5, 88.5]` |
| Core | `[95.335, −15, 125, 15]` (30 ft on the east outer run, full depth) |

`d = 28.665`. Four outer wrap corners (`e = 33.520`, area 1,100.0 each). Four court pockets. Outer runs: south and north `248 − 2 × 33.52 = 180.96`, each less the 11 ft stair → two runs of 84.98; east `218 − 67.04 = 150.96` less the 30 ft core → two runs of 60.48; west 150.96. Court runs (area line 122 × 92): south and north `122 − 11` → two runs of 55.5; east and west 92. ΣL = 1,017.84.

**Expected: 39 units** (studio 6, 1BR 16, den 4, 2BR 11 including 4 corners, 3BR 2); court units carry `ring: 1`. **NRSF = 1,017.84 × 28.665 + 4 × 1,100.0 = 33,576.5 sf; efficiency 0.7596.**

### 8.7 Mid-Rise courtyard from a project (test fixture, not a preset)

The Mid-Rise preset `courtyard-5-over-1` through `assemble` and `midriseDerived`. Source `project`; one group (bar levels 2–6, five floors; the podium level 1 is out). Stairs from the seeds; the seed stairs sit in the four corner zones, so those corners take no wrap units (change 5). Expected: efficiency 0.70 to 0.80; every unit inside its range; no unit overlaps a stair; building units = level units × 5.

---

## 9. Tests

### 9.1 Module tests (`test/plate.*.test.mjs`, run by `npm test`)

| # | File | Case | Expect |
|---|---|---|---|
| 1 | fill | Preset 8.1 | 17 units; NRSF 15,077.8 (±0.5); efficiency 0.7732 (±0.0005); each type within 1 of its target; every width inside its effective range. Without the core: 18 units, exactly on target; NRSF 15,937.7; efficiency 0.8173 |
| 2 | fill | Preset 8.2 | 27 keys; 28 bays; one suite of two bays; one accessible key touching the guest elevator block; NRSF 10,296.0 (±0.5); efficiency 0.715 |
| 3 | fill | Short bar 120 × 65, stairs at the ends, no core | Runs 98 and 98; 6 units; NRSF 5,618.3; closure: corridor 555.7 + stairs 484 + remainders 946 + NRSF + 196 allowance = 7,800 (±1) |
| 4 | fill | Preset 8.3 | One wrap corner (legs 34.103, area 1,100.0 ±0.5); one pocket 684.6; two spine segments; 16 units; NRSF 12,816.5; den and 3BR dropped with `type-does-not-fit` |
| 5 | fill | Preset 8.4 | Two corners, two pockets, three spine segments; 21 units; NRSF 16,318.3; dead ends 0; moving the west stair 30 ft south gives a 30 ft dead end |
| 6 | fill | Preset 8.5 | Four corner 2BR (legs 33.579); four dens of 30.84; NRSF 7,895.0; exposures in N, E, S, W |
| 7 | fill | Preset 8.6 | 39 units; 4 corners; 4 pockets; court units `ring: 1`; NRSF 33,576.5 |
| 8 | fill | A mix of 3BR 1.00 on a single 60 ft run at `d = 28.665` | No error; two units of other types; `mix-miss` on 3BR; every width inside its range |
| 9 | fill | Preset 8.1: lock two units, set 2BR share 0.50, re-fill | The locked outlines and types do not change; the other runs re-solve |
| 10 | fill | Preset 8.6 twice | Byte-equal `JSON.stringify` of the fill |
| 11 | fill | Circle 100 ft diameter (64 segments), bar corridor | Units are polygons; Σ unit areas = the band area within 1 sf; no unit leaves its range by more than 1 percent |
| 12 | corridor | Fixture 8.7 (Mid-Rise courtyard) | Spines from the massing; stairs from the seeds; no wrap unit where a seed stair sits in a corner; efficiency 0.70 to 0.80 |
| 13 | corridor | `corridorGraph` on 8.1 and 8.2 | 8.1: length 278, stair door path 278, dead ends 0; 8.2: keys within 150 ft of the linen closet counted |
| 14 | fill | Point tower from a tower-like level (`buildPlates` of the tower preset "Slim residential point tower", one typical floor, `coreRect` as the core) | Kind `point`; every unit touches the facade; corners wrap; closure within 1 sf |
| 15 | mix | `effectiveTypes` at 28.665 and 26.165 | Section 8.1 table; at 26.165 the den and 3BR drop |
| 16 | mix | `countsFor(526, …)` at 28.665 | N 17; 2, 7, 2, 5, 1 |
| 17 | mix | `requiredAccessible`: multifamily 85 units; hotel 270 keys | Type A 2 (`ceil(0.02 × 85)`); hotel row 300: 10 keys, 3 roll-in |
| 18 | levels | Mid-Rise `double-bar` massing | One group "Levels 1–5 (5 floors)" |
| 19 | levels | Mid-Rise `podium-5-over-2` massing | Podium levels out by default; with `showPodium`, they appear as their own groups |
| 20 | levels | Two levels with the same rings but different seeds | Two groups (seeds are part of the key) |
| 21 | metrics | Preset 8.1 on a five-floor massing | Building 85 units; NRSF 75,389.0 |
| 22 | metrics | Checks | `type-does-not-fit`, `run-too-short` (a 15 ft run), `mix-miss`, `stale-massing` |
| 23 | derived | Preset 8.1 through `platesDerived`, `writeSection`, `validate` | Valid; unit ids `1-01`…; every unit has `bay`, `ring`, two `demising` lines |
| 24 | derived | The Parking Deck overlay on a plates section from 8.1 | `demisingLines` returns source "plates"; every line lies within 5 degrees of the y axis, is 5 ft or longer, and sits at a bay cut of section 8.1 |
| 25 | exports | Rooms CSV of 8.1 | Placement comment, header, 17 rows, centroids inside their units |
| 26 | exports | DXF of 8.4 | Every layer; `UNIT-LINE` holds two lines per unit |
| 27 | sketchup | Doc of 8.6 | `validateDoc` passes; source `plate`; one solid per unit |

Every test that fixes a number writes the arithmetic in a comment, as section 8 does.

### 9.2 In-page tests (`plate/index.html?test`)

- Shell: the default state builds; the HUD shows 17 units, NRSF 15,078 sf, efficiency 77.3 percent.
- Every preset loads with its section 8 values.
- Editing: a bay-line drag of 2 ft changes two widths and keeps NRSF; a drag past a neighbor's minimum is refused; a lock survives Re-fill; a type change from the card re-solves its run.
- Project: a fixture project with the Mid-Rise `double-bar` massing → source "project", one group of five floors, the placement copied; a newer massing `updatedAt` shows the stale notice.
- Exports: SketchUp doc validates; CSV, DXF, notes, and JSON download; Send items open `../parking/?project=<id>` and `../facade/?project=<id>`.

### 9.3 Cade's live checks

1. Open each preset on the Mac. Compare the HUD with section 8.
2. On the iPad, drag a bay line and lock a unit; Re-fill and watch the rest move.
3. Mid-Rise courtyard → Send to Plate Planner → fill → Send to Facade Studio (balconies per unit) and to Parking Deck (the column overlay now reads the real unit lines).
4. Import the rooms CSV with a pyRevit script; check three room areas against the tool.

---

## 10. Build phases and file ownership

Phases 2 to 6 run in parallel. Each agent owns only its files.

| Phase | Model | Agent | Owns | Acceptance checks |
|---|---|---|---|---|
| 1 | Opus | Orchestrator | This plan | Cade's go (given) |
| 2 | Opus | Fill | `src/plate/corridor.js`, `fill.js`, tests 1 to 14 (`test/plate.fill.test.mjs`) | Tests pass; examples A and B, the corners, and the pockets checked by hand |
| 3 | Sonnet | Mix | `src/plate/mix.js`, `levels.js`, `metrics.js`, tests 15 to 22 (`test/plate.mix.test.mjs`) | Tests pass; a hand `built` fixture until phase 2 lands, then the real `buildPlates` |
| 4 | Sonnet | Exports | `src/plate/derived.js`, `exports.js`, `sketchup.js`, tests 23 to 27 (`test/plate.exports.test.mjs`) | Doc validates; derived validates; the overlay reads the units |
| 5 | Sonnet | Page | everything under `build/plate/`, `plate/index.html` (through its build) | Section 9.2 tests pass; screenshots at 1440 × 900 and 820 × 1180 |
| 6 | Haiku | Presets | `src/plate/presets.js`, `testcases.js` | Every preset loads; values match section 8 |
| 7 | Opus | Integrator and reviewer | the list below | `npm test` green; every in-page test green; ten hand counts checked |
| 8 | Cade | — | — | Section 9.3 |

**Interfaces:** section 4 fixes every signature. The fill agent uses `effectiveTypes`, `weightedWidth`, and `countsFor` from `mix.js`; until phase 3 lands it writes private copies that follow section 3.6 exactly, then switches and reruns its tests. The page agent codes against section 4, reports problems, and does not edit `src/`. The page registers every module in `build/plate/build.py` MODS in import order (shared `sketchup-format.js` and `project.js` first; `src/tower/geometry.js` for `shapeToRing`).

**Integrator edits outside the plate folders:**

1. SketchUp: add `"plate"` to `validateDoc` in `src/shared/sketchup-format.js`, to `sketchup/cmrlm_design_tools/importer.rb`, and to `docs/sketchup-spec.md`; rebuild the `.rbz`.
2. Spec section 6.3: state the area rule (decision 5), that `bay`, `ring`, `demising`, `support`, `accessible`, and `massingUpdatedAt` are written, and that unit coordinates are in the massing local frame.
3. Send items into the Plate Planner: the Mid-Rise already has one; the Tower item comes with the parallel tower work. Send items out: the page's own Export menu (Parking Deck, Facade Studio).
4. `index.html`: the Plate Planner card opens `plate/`; the "How projects work" table gets the Plate Planner row (reads massing; writes plates; sends to Parking Deck and Facade Studio); the Mid-Rise and Tower rows list it under "Send to".
5. Parking Deck: no code change; its overlay already reads `plates.derived` units. The integrator runs the parking in-page tests with a plates section present and checks the "plates" source.
6. `package.json`: `build:plate`, `test:plate`, and `test:plate` in `npm test`. `README.md` tool row; `docs/suite-roadmap.md` status.

---

## 11. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| A depth where several types do not fit | A thin mix (point tower 8.5: dens only) | `type-does-not-fit` names the type and the width range it needs; the mix editor shows the effective range per type |
| A run no slot count fits | A gap in the plan | The run becomes a `remainder` with `run-too-short`; the user moves a block or edits the mix |
| Feasibility search cost on long runs | Slow fills | Memoized sums per slot count; runs over 400 ft split at the middle into two runs |
| Seeds that land in corners or in the corridor | Odd stairs | Seeds win over corners (change 5); a seed in the corridor moves to the nearest band edge with a warning |
| Teammates read NRSF as a leasing number | Wrong pro formas | The area rule appears in the panel, the notes, the CSV comment, and the DXF title |
| The tower writer lands after this build | No tower plates to read | Test 14 builds tower-like levels from `buildPlates`; the reader needs only `massing.derived` |
| Mix misses on small plates | A mix far from target | The placed-against-target table and `mix-miss` per level; building totals usually even out |

Open items:

1. Senior living mode (the notes' later scope) adds a type table and a care-station reach; the pipeline needs no change.
2. Angled single-loaded corridors and curved corridors arrive as straight pieces in version 1.
3. A pyRevit room-placement script is a work-session item; the rooms CSV is its input.
4. Unit plans inside the outlines (bedrooms, baths) stay out of scope (notes 2.2).
