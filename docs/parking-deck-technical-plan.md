# Parking Deck Generator — Technical Plan

Version 0.1 · October 21, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Source: `parking-deck-concept.md` v0.1 with the decisions in its section 12, including decisions 11 to 15 that Cade accepted on October 21, 2026.

This plan is the instruction set for the build phases. Each build agent gets this plan, the concept, and `docs/project-file-spec.md`.

---

## 1. Scope and decisions

### 1.1 Decisions that bind the build

| # | Decision | Source |
|---|---|---|
| 1 | Both visual styles with one toggle: white model and diagram | Concept 12.1 |
| 2 | Feet and square feet only | Concept 12.2 |
| 3 | Stall 9 × 18 ft, aisle 24 ft, 90 degrees, two-way; every value editable | Concept 12.3 |
| 4 | Three cases: standalone, wrap deck, podium parking | Concept 12.4 |
| 5 | Five ramp types: single helix, double helix, speed ramp, split-level, sloped parking floor | Concept 12.5 |
| 6 | Long-span or short-span grid, with the column overlay | Concept 12.6 |
| 7 | Users are Cade and RJTR teammates; a short Help panel | Concept 12.7 |
| 8 | Generic names only | Concept 12.8 |
| 9 | The project file is part of version 1 | Concept 12.9 |
| 10 | Every code-related default lives in an editable table with a Caution line | Concept 12.10 |
| 11 | 90-degree two-way bays only | Decision 11 |
| 12 | The tool suggests an aligned stall width; it never changes the width by itself | Decision 12 |
| 13 | The R-2 accessible rule is on by default for wrap and podium decks | Decision 13 |
| 14 | The short end walls stay turn zones; no stalls along them | Decision 14 |
| 15 | Compact share 0 percent by default | Decision 15 |

### 1.2 Changes from the concept

1. **Leftover strip goes to the north edge.** The concept put a 3 ft spine between two bays. The plan puts every leftover strip at the north edge (the high y side of the layout frame). The count does not change. The rule is the same for any bay count, and a speed ramp can use the strip.
2. **Default entry is at a short end.** The entry lane sits in a turn zone, so it costs no stalls. The concept's example A charged 6 stalls to an entry on a long side. An entry on a long side stays an option.
3. **Level 1 floor-to-floor is 11 ft.** At 10.5 ft, long-span clear height is 8 ft 0 in, below the 8 ft 2 in van route. The default level 1 is 11 ft, so the default passes.
4. **Split-level end ramps sit in longer end zones.** At 24 ft, a half-level ramp is 22 percent. The end zone of a split-level deck is the ramp length plus its two transitions (default 36 + 2 × 10 = 56 ft).
5. **Example B uses long-span.** The concept preset table listed the podium level as short-span, but its example used long-span math. The plan keeps example B long-span and adds a short-span podium preset.
6. **Accessible aisles count exactly.** Section 3.9 gives the rule. Example A loses 4 stalls to aisles, not 8.

### 1.3 Reuse from the Mid-Rise, the tower, and the shared modules

| Reused verbatim (shared modules) | Copied and changed (Mid-Rise parts) | New |
|---|---|---|
| `src/shared/storage.js`, `screenshot.js`, `sketchup-format.js`, `project.js` | `build/midrise/shell.html`, `body.html`, `css_add.css`, `build.py` | `src/parking/layout.js` |
| `src/tower/snap.js` (`snapMove`, `snapEdge`, `snapLength`) | `00_imports.js`, `01_config.js`, `02_units.js`, `03a_state.js`, `03b_store.js` | `src/parking/ramps.js`, `grid.js` |
| `src/tower/prompts.js` (prompt library data) | `06_render.js`, `06b_select.js` (handles for footprint, ramp, cores) | `src/parking/accessible.js`, `overlay.js`, `metrics.js` |
| `src/midrise/bars.js` helpers: `ringArea`, `multiPolyArea` | `07_controls.js`, `08_ui.js`, `08b_prompts.js`, `08c_sketchup.js`, `08e_help.js` | `src/parking/derived.js`, `sketchup.js`, `exports.js` |
| | `09_storage.js`, `09b_project.js`, `10_screenshot.js`, `11_compare.js`, `12_tests.js`, `13_start.js` | `src/parking/presets.js`, `testcases.js` |

The page copies the Mid-Rise shell, not the tower shell. The Mid-Rise already has the project menu, the Send pattern, the bottom sheet, and the select-and-handles code.

---

## 2. State schema

All lengths are feet. All areas are square feet. Slopes are fractions in the state and percents on the screen. Plan coordinates `(x, y)`: east = +x, north = +y.

The **layout frame** is the frame the bays use. Its origin is the southwest corner of the footprint's minimum-area bounding rectangle. Its x axis runs along the long side. `layout.rotateBays: true` swaps the axes. For a rectangle footprint at angle 0 the layout frame equals the local frame shifted to the corner.

```jsonc
{
  "schema": 1,
  "name": "Option A",
  "source": "standalone",              // "standalone" | "wrap" | "podium"
  "sourceLevel": null,                 // wrap/podium: the massing level index the footprint came from (section 7)

  "footprint": {
    "shape": "rect", "width": 300, "depth": 125, "points": [],   // "rect" (centered on the origin) or "polygon" (points)
    "x": 0, "y": 0, "angle": 0,       // rect center and rotation in the local frame
    "perimeter": 1                     // ft held for the edge wall or barrier
  },

  "placement": null,                   // { x, y, rotation, baseZ } copied from the massing when a project is open

  "levels": {
    "count": 5,
    "ftf1": 11,                        // level 1 floor-to-floor (section 1.2 change 3)
    "ftf": 10.5,                       // typical floor-to-floor
    "belowGrade": 0,                   // levels below grade (negative z); counted inside `count`
    "openTop": true                    // the top level parks cars and has no slab above
  },

  "bays": {
    "stallW": 9, "stallD": 18, "aisle": 24,
    "edgeBays": true,                  // a remainder of 42 ft or more becomes a single-loaded edge bay
    "compactShare": 0, "compactW": 8, "compactD": 16,
    "turnZone": null,                  // null = aisle width; split-level overrides it (section 3.4)
    "rotateBays": false
  },

  "grid": {
    "span": "long",                    // "long" | "short"
    "column": 2,                       // column size, square, ft
    "stallsPerModule": 3,
    "structureDepth": { "long": 2.5, "short": 1.5 }
  },

  "ramp": {
    "type": "single-helix",            // "single-helix" | "double-helix" | "speed" | "split" | "sloped-floor" | "none"
    "slopedBay": 1,                    // sloped-floor: which bay slopes (0-based, from the south)
    "speed": {                         // speed ramp: footprint in the layout frame
      "x": 99, "y": 123, "width": 24, "length": 82, "shape": "straight",   // shape "straight" | "circular"
      "insideRadius": 30, "segments": 12                                    // circular only; segments 8 | 12 | 16
    },
    "splitLength": 36,                 // split-level end ramp main length
    "transition": { "length": 10, "slopeFactor": 0.5 }
  },

  "cores": [                           // layout frame; kind "stair" 12 x 22 or "elevator" 10 x 10
    { "id": "S1", "kind": "stair",    "x": 25,  "y": 1,  "w": 22, "d": 12 },
    { "id": "E1", "kind": "elevator", "x": 52,  "y": 1,  "w": 10, "d": 10 },
    { "id": "S2", "kind": "stair",    "x": 246, "y": 109, "w": 22, "d": 12 }
  ],
  "coresFromProject": true,            // carry massing seeds down through the deck when a project is open

  "entries": [ { "id": "N1", "side": "west", "at": 31, "width": 24 } ],   // side west | east | south | north; at = center along the side

  "liner": { "on": false, "side": "south", "depth": 61, "levels": [1] },  // retail kept out of the parking area

  "checks": {                          // Caution: common design values, not code values. Verify against the adopted code.
    "slopeParking": 0.0667,
    "slopeSpeed": 0.12,
    "crossSlope": 0.02,
    "barrier": 2.75,                   // vehicle barrier height, ft (2 ft 9 in)
    "guard": 3.5,                      // pedestrian guard at open sides, ft
    "clearGeneral": 7.0,
    "clearVan": 8.1667,                // 8 ft 2 in
    "barrierProvided": 3.5,            // the barrier the design shows (checked against `barrier` and `guard`)
    "overlayTolerance": 2
  },

  "accessible": {                      // Caution: seed rows from IBC 1106.1. Verify against the adopted code.
    "table": [
      { "upTo": 25, "count": 1 }, { "upTo": 50, "count": 2 }, { "upTo": 75, "count": 3 },
      { "upTo": 100, "count": 4 }, { "upTo": 150, "count": 5 }, { "upTo": 200, "count": 6 },
      { "upTo": 300, "count": 7 }, { "upTo": 400, "count": 8 }, { "upTo": 500, "count": 9 },
      { "upTo": 1000, "percent": 2 },
      { "upTo": null, "base": 20, "per100Over1000": 1 }
    ],
    "vanPer": 6,                       // one van stall per 6 accessible stalls, at least 1
    "aisleCar": 5, "aisleVan": 8,
    "r2": { "on": null, "percent": 2 } // null = on for wrap and podium, off for standalone (decision 13)
  },

  "ev": { "readyShare": 0.20, "installedShare": 0.05 },
  "bike": { "mode": "per-units", "perUnits": 10, "count": 0, "rack": "single" },   // rack "single" 12 sf/bike | "two-tier" 1.25 ft of wall/bike

  "required": { "units": null, "ratio": 1.25, "retailSf": 0 },   // units null = from massing metrics, else typed

  "view": {
    "style": "model", "colorBy": "kind",     // "kind" | "slope"
    "level": 0,                              // 0 = all levels; n = isolate level n in plan
    "overlay": true, "context": true, "stallNumbers": false,
    "grid": true, "figure": true, "shadows": false,
    "snap": { "on": true, "grid": 1 }
  }
}
```

**Default state:** preset "Two-bay single helix, five levels" (section 8.1).

**Storage:** key `parking.options.v1`, schema 1, through `createStorage`. The store deep-merges a loaded state over the default state, as the Mid-Rise does. `migrate` returns the state unchanged for schema 1.

---

## 3. Geometry pipeline

```
state → layout frame → parking rectangle → bays → turn zones → rows → stalls
      → cut ramps, cores, entries, liner → accessible group → EV and compact tags
      → per-level stalls → columns → overlay → checks → metrics → derived
```

Every step is a pure function. Clipper runs at `SCALE = 1000` (0.001 ft). Coordinates round to 0.001 ft, areas to 0.1 sf. Every count is deterministic.

### 3.1 Step 1 — Layout frame and parking rectangle

- Find the footprint's minimum-area bounding rectangle (rotating calipers over the convex hull). For a rectangle footprint it is the footprint.
- Layout length `W` = the long side, depth `D` = the short side (swapped when `rotateBays`).
- Parking rectangle = `[p, W − p] × [p, D − p]`, with `p = footprint.perimeter`.
- For a polygon footprint, every later cut also clips to the footprint inset by `p` (Clipper offset, miter joins). Stalls that leave it are lost.

### 3.2 Step 2 — Bays

Usable depth `Du = D − 2p`. Bay width `B2 = 2 × stallD + aisle` (60 ft). Edge bay `B1 = stallD + aisle` (42 ft).

1. `nb = floor(Du ÷ B2)` double-loaded bays, from the south edge up.
2. `r = Du − nb × B2`. When `edgeBays` and `r ≥ B1`: add one single-loaded edge bay at the north; `r = r − B1`.
3. The leftover `r` is the north strip. Report it as "strip, `r` ft". A speed ramp may sit in it (section 3.4).

A double-loaded bay from `y0`: south row `[y0, y0 + stallD]`, aisle `[y0 + stallD, y0 + stallD + aisle]`, north row `[… , y0 + B2]`. A single-loaded bay: aisle first, row on the north side.

### 3.3 Step 3 — Turn zones and rows

- Turn zone length `t = bays.turnZone ?? aisle` (24 ft), at each end of every bay (decision 14).
- Run start `xs = p + t`, run end `xe = W − p − t`, run length `R = xe − xs`.

Stalls per row:

| Grid | Rule |
|---|---|
| Long-span | `n = floor(R ÷ stallW)`. Stall k spans `[xs + k·stallW, xs + (k + 1)·stallW]`. |
| Short-span | Module `M = column + stallsPerModule × stallW` (29 ft). Module j starts at `xs + j·M` with a column, then its stalls. `k = floor(R ÷ M)` modules; remainder `rr = R − k·M`; extra = `floor(max(0, rr − column) ÷ stallW)` stalls after a column. `n = k × stallsPerModule + extra`. |

Stall ids: `P<level>-<bay><row>-<nnn>`, for example `P1-1S-001`. Row `S` is south, `N` is north.

### 3.4 Step 4 — Ramps

Every ramp climbs a rise `h`. With transitions of length `T` at slope `f × s` at each end (`f = transition.slopeFactor`, 0.5):

```
h = s × L + 2 × (f × s) × T   →   s = h ÷ (L + 2 f T)       (f = 0.5: s = h ÷ (L + T))
```

| Type | Rise per ramped length | Ramped length | Area cost |
|---|---|---|---|
| Single helix | `h = ftf ÷ 2` per bay | `R` (each bay is a ramp; turn zones stay flat) | None |
| Double helix | `h = ftf` per bay | `R` | None |
| Speed ramp | `h = ftf` between levels | `speed.length`, transitions `T` | Its rectangle (`length + 2T` × `width`) is cut from every level it touches, both ends |
| Split-level | `h = ftf ÷ 2` per end ramp | `splitLength`, transitions `T` | The end zones grow: `t = splitLength + 2T` |
| Sloped floor | `h = ftf` in bay `slopedBay` | `R` | None |

- `ftf` is the floor-to-floor of the level the ramp leaves. Level 1 uses `ftf1`.
- Parking ramps (helix, sloped floor) check against `slopeParking`. Speed and split ramps check against `slopeSpeed`.
- A circular speed ramp: ramped length = `2π × (insideRadius + width ÷ 2)` per turn. It exports as a true arc and as `segments` straight pieces. Its plan footprint is the circle of radius `insideRadius + width`, cut from every level.
- `outer3d` for each ramp: the 3D outline (four corners, z from the level surface) for helix bays, sloped bays, and straight ramps; the arc outline sampled at `segments` for circular ramps.

Worked rises with the defaults: single helix level 1 `5.5 ÷ 250 = 2.2%`; typical `5.25 ÷ 250 = 2.1%`. Speed ramp level 1 `11 ÷ (82 + 10) = 11.96%`. Split-level level 1 `5.5 ÷ (36 + 10) = 11.96%`.

### 3.5 Step 5 — Cuts: cores, entries, liner, speed ramp

A stall is lost when its rectangle overlaps a cut by more than 1 sf.

- **Cores** are the same in plan on every level. A core rectangle that overlaps an aisle by more than 1 sf raises the warning "S1 sits in the drive aisle" and the action "Move to the nearest row".
- **Cores from the project** (section 7): massing seeds, transformed to the layout frame. They keep their size. The move action snaps them into the nearest stall row at the same x.
- **Entries** cut a lane of `width` from the side inward, up to the first aisle. An entry on a short end lies inside a turn zone and costs no stalls. An entry on a long side cuts the edge row it crosses: lost stalls = stalls overlapping `[at − width/2, at + width/2]`.
- **Liner** cuts its strip `[0, depth]` from the chosen side on its levels. Stalls in it are lost. An aisle cut by the liner raises a warning.
- **Speed ramp** rectangle (section 3.4).

### 3.6 Step 6 — Accessible stalls

Caution: the table, the van rule, and the aisle widths seed an editable table. Verify every value against IBC 1106 and the adopted accessibility standard.

1. `N0` = the total stalls after section 3.5, all levels.
2. Required by the table: find the first row with `N0 ≤ upTo`. A `percent` row gives `ceil(N0 × percent ÷ 100)`. The last row gives `base + per100Over1000 × ceil((N0 − 1000) ÷ 100)`.
3. R-2 rule (when on): `max(1, ceil(N0 × r2.percent ÷ 100))`. Required = the larger of the two.
4. Van = `max(1, ceil(required ÷ vanPer))`. Car = required − van.
5. **Group pattern.** Each van stall pairs with one car stall on an 8 ft aisle: `V | 8 | A`. The remaining car stalls pair on 5 ft aisles: `A | 5 | A`. An odd last car stall gets its own aisle: `A | 5`.
6. Aisle length `La = 8 × van + 5 × ceil((car − min(car, van)) ÷ 2)`.
7. Stalls lost to aisles = `ceil(La ÷ stallW)`. Accessible stalls replace standard stalls one for one.
8. Placement: one contiguous group in the row nearest the elevator core (the closest row centerline to the elevator center), on the entry level, starting at the first free stall next to the core. When the group does not fit, it continues in the next nearest row. Accessible stalls keep the standard stall width.

### 3.7 Step 7 — EV and compact tags

- EV installed: `round(stalls × installedShare)` standard stalls become kind `ev`, taken from the rows nearest the entry, level 1 first.
- EV ready: `round(stalls × readyShare)` stalls get `evReady: true`. Their kind does not change.
- Compact: when `compactShare > 0`, the rows farthest from the core use compact stalls until the share is met. A compact row uses `compactW` and the bay width `2 × compactD + aisle`. Default share 0: no compact rows.

### 3.8 Step 8 — Columns

| Grid | Column lines (y) | Columns along each line (x) |
|---|---|---|
| Long-span | Every bay edge (stall heads) | `xs + k × (stallsPerModule × stallW)`, k = 0 … `floor(R ÷ (3 stallW))`, plus `xe` when the last gap > 0.5 ft |
| Short-span | Bay edges plus each stall/aisle line | `xs + j × M`, j = 0 … k, plus `xe` when the last gap > 0.5 ft |

Columns repeat on every level. Turn zones have none.

### 3.9 Step 9 — Column overlay

1. Source: `plates.derived.levels` with the lowest residential `index`; each unit's `demising` lines. Without plates data: the Mid-Rise unit ticks (`bar start + k × unitWidth` along each bar spine). The panel names the source.
2. Transform the lines to the layout frame. Keep the lines parallel to the column lines' cross direction (perpendicular to the run).
3. For each column under the building footprint: distance to the nearest demising line, along x. Conflict when `> overlayTolerance` (2 ft).
4. Suggest a stall width (decision 12): unit width `U` (the median demising spacing), module stalls `n = stallsPerModule`. Long-span: `m = max(1, round(n × stallW ÷ U))`, `w* = m × U ÷ n`. Short-span: `w* = (m × U − column) ÷ n`. Show `w*` only when it lies inside the stall width range (8 to 10 ft). Show the stall count it gives.

Example: `U = 28`, long-span, `n = 3`, `stallW = 9`: `m = round(27 ÷ 28) = 1`, `w* = 9.333` (9 ft 4 in).

### 3.10 Step 10 — Checks

Caution: these are design checks against editable values, not a code review.

| Check | Rule |
|---|---|
| Ramp slope | Each ramp's `s` against its limit (section 3.4) |
| Clear height | `ftf − structureDepth[span]` per level; level 1 against `clearVan`, others against `clearGeneral` |
| Barrier | `barrierProvided ≥ barrier`; at open sides above level 1, `barrierProvided ≥ guard` |
| Cores | Core in an aisle; core outside the footprint |
| Strip | Leftover strip over 10 ft and not used by a ramp: "unused strip" |
| Parking balance | Stalls − required (section 3.11); a deficit warns |

### 3.11 Step 11 — Metrics

| Metric | Formula |
|---|---|
| Stalls | Final count after section 3.6; by level; by kind |
| Gross deck area | Σ level plate area − liner area on its levels |
| Square feet per stall | gross ÷ stalls |
| Efficiency | parking area (rows + aisles + turn zones) ÷ gross |
| Required | `units × ratio + retailSf ÷ 1000 × 3`, rounded up; `units` from `massing.derived.metrics.units` when null |
| Balance | stalls − required |
| Accessible | required, provided, van |
| EV | installed count, ready count |
| Bike | required = `ceil(units ÷ perUnits)` or `count`; area = bikes × 12 sf (single) or bikes × 1.25 ft of wall (two-tier) |
| Ramp slopes | per ramp; the maximum |
| Clear height | lowest per level |
| Columns | count per level, module, conflicts |
| Top of deck | Σ ftf of all levels below the top surface |

### 3.12 Step 12 — Derived writer

`parkingDerived(state, built, metrics)` maps the result to `parking.derived` (spec 6.4) with the additive keys of section 7:

- `levels[]`: `index` (1 = lowest), `z` (floor surface above baseZ; below grade negative), `plate`, `stalls`, `aisles`, `ramps`, `columns`, `cores`, `clearHeight`.
- `metrics`: `stalls`, `byKind`, `sfPerStall`, `levels`, `accessible`, `ev`, `bike`, `conflicts`.
- Coordinates go back from the layout frame to the local (massing) frame.

---

## 4. Module contracts

Pure ES modules. No DOM, no Three.js, no hidden state, no mutation of inputs. Clipper through `globalThis.ClipperLib` at `SCALE = 1000`. One-line relative imports only. Every export starts a line with `export function` or `export const`.

```js
// src/parking/layout.js
export const SCALE = 1000;
export function layoutFrame(state)               // → { origin: [x, y], angle, W, D, toLocal(p), toLayout(p) } (section 3.1)
export function baysOf(state, frame)             // → { bays: [{ index, kind: "double"|"single", y0, rows: [{ id: "S"|"N", y0, y1 }], aisle: { y0, y1 } }], strip: { y0, y1 } | null }
export function rowStalls(state, frame, row)     // → [{ k, x0, x1, y0, y1 }] before cuts (section 3.3)
export function layout(state, { project = null, quality = "full" } = {})
  // → { frame, levels: [{ index, z, ftf, plate, stalls: Stall[], aisles: MultiPoly, turnZones: MultiPoly, cuts: [{ id, kind, ring }] }],
  //     bays, strip, cores, warnings }
  // Stall = { id, level, bay, row, k, outer: Ring (layout frame), kind, evReady }
  // project: the loaded project document or null (cores from seeds, footprint from deck/podium levels)

// src/parking/ramps.js
export function rampSlope(rise, length, transition)        // → s (section 3.4 formula)
export function rampsFor(state, built)                     // → [{ id, type, level, rise, length, slope, limit, ok, outer3d, footprint: Ring | null }]
export function splitEndZone(state)                         // → splitLength + 2 × transition.length
export function circularRamp(insideRadius, width, segments) // → { length, arc: [[x, y], …], segmentsRing: Ring }

// src/parking/grid.js
export function columnsFor(state, built)          // → { lines: [{ y, xs: [x, …] }], points: [[x, y], …], module }
export function clearHeights(state)               // → [{ level, ftf, clear, min, ok }]

// src/parking/accessible.js
export function requiredAccessible(n0, accessible, source)   // → { table, r2, required, van, car }
export function aisleLength(van, car, accessible)            // → La (section 3.6)
export function placeAccessible(state, built)                // → { stalls: Stall[] (with kinds set), lost, rowId, warnings }

// src/parking/overlay.js
export function demisingLines(project, frame)                // → { source: "plates"|"midrise"|"none", xs: [x, …], unitWidth }
export function overlay(state, built, project)               // → { conflicts: [{ column: [x, y], distance }], suggestion: { stallW, stallsPerRow } | null, source }

// src/parking/metrics.js
export function computeMetrics(state, built, ramps, columns, accessible, project)   // → every row of section 3.11
export function checks(state, built, ramps, metrics)                                  // → Warning[] (section 3.10)

// src/parking/derived.js
export function parkingDerived(state, built, metrics)        // → parking.derived (spec 6.4 plus section 7 keys)

// src/parking/sketchup.js
export function parkingToSketchup(state, built, metrics, meta)   // → doc from makeDoc(); groups Levels (slab solids), Stalls (lines), Ramps (meshes), Columns, Cores, Barriers

// src/parking/exports.js
export function parkingDxf(state, built)          // → DXF R12 text; layers PARK-SLAB, PARK-STALL, PARK-ACCESSIBLE, PARK-AISLE, PARK-RAMP (3D faces), PARK-RAMP-SEG, PARK-COLUMN, PARK-CORE, PARK-TEXT
export function stallCsv(state, built)            // → "level,id,kind,ev_ready,x,y,width,depth\n…"

// src/parking/presets.js
export const PRESETS                               // [{ id, name, description, state }] section 8
export function defaultState()

// src/parking/testcases.js
export const TEST_CASES                            // [{ id, state, expect: { stalls, byLevel?, slope?, sfPerStall?, accessible?, tolerance: 0 } }]
```

`layout` is the only module that calls Clipper for the stall cuts. `ramps`, `grid`, `accessible`, `overlay`, and `metrics` read its result. `accessible.placeAccessible` returns new stall objects; it does not mutate `built`.

---

## 5. Interface

### 5.1 Tabs

Same panel, tabs, and top bar as the Mid-Rise. Tab order: Layout, Ramp, Checks, View.

- **Layout tab:** source card (standalone, or the project deck or podium level with a level picker), footprint card (width, depth, angle, perimeter; draw polygon), levels card (count, level 1 and typical floor-to-floor, below grade, open top), bays card (stall, aisle, edge bays, compact share, rotate bays), grid card (span, column, stalls per module), cores list (add stair, add elevator, from project, move to nearest row), entries list, liner card.
- **Ramp tab:** ramp type buttons, the sloped bay picker, speed ramp card (position, width, length, straight or circular, radius, segments), split-level ramp length, transition length and factor. Each ramp shows its slope against its limit.
- **Checks tab:** the checks table, the accessible table with the R-2 toggle, EV shares, bike settings, the required-parking block. Every code table carries its Caution line.
- **View tab:** style, color by kind or slope, level isolate, stall numbers, overlay, context, grid, figure.

### 5.2 Top bar

Option menu (presets, Save, Duplicate, Rename, Delete, Compare), Undo, Redo, Model/Diagram, Snap, Export menu (Image, AI-ready image, AI Prompts, SketchUp, DXF, Stall CSV, Export JSON, Import JSON, Send to Facade Studio — disabled, "Planned"), Project menu (New, Open, Import, Export), Help.

HUD, always visible: stalls, square feet per stall, levels, maximum ramp slope. One tap expands accessible, balance, clear height, conflicts. The warning count stays visible.

### 5.3 Handles and snapping

- Footprint (standalone): move, rotate (5-degree snap), width and depth handles.
- Speed ramp: move along the strip; length handle.
- Cores: move; snap to row edges, the aisle edge, and other cores.
- Entries: slide along their side.
- Snapping reuses `snapMove` and `snapEdge` with targets: footprint edges, bay lines, row edges, column lines, the strip.
- Mac shortcuts: 1 to 6 views, D Model/Diagram, L next level, Shift+L all levels, Delete removes the selection, Escape clears.

### 5.4 iPad

Same bottom sheet as the Mid-Rise in portrait. Handles 44 points or larger.

---

## 6. Rendering

- Slabs: one thin slab per level (1 ft), extruded from the plate. Helix and sloped bays draw as sloped slab pieces between their turn zones.
- Stalls: lines on the slabs (instanced line segments). Diagram style fills stalls by kind: standard light gray, accessible blue, van dark blue, EV green, compact amber.
- Ramps: sloped slabs; Diagram style colors them by slope (green under 80 percent of the limit, amber to the limit, red above).
- Columns: instanced boxes, one per column per level; red when the overlay marks a conflict.
- Cores: solid boxes through all levels; red when in an aisle.
- Barriers: a thin wall at the slab edge, `barrierProvided` high.
- Overlay: demising lines above the deck in thin orange.
- Context: the massing levels above the deck as a ghost (25 percent opacity).
- Draft quality during a drag: draw rows as filled strips, not single stalls; skip columns. Full quality on drag end.
- Target: 10 levels × 600 stalls at 60 frames per second on the Mac and 30 on the iPad.

---

## 7. Project file

Follows `docs/project-file-spec.md`.

- **Start:** `projectIdFromUrl` → `loadProject`. Load `sections.parking.state` when present.
- **Source picker:** list `massing.derived.levels` with zone `deck` (wrap) or `podium`. Picking a deck sets `source: "wrap"`; a podium level sets `source: "podium"`. The footprint becomes the level plate (polygon), `levels.count` the number of levels of that zone, and `ftf1`/`ftf` their `ftf`. `sourceLevel` keeps the first index.
- **Placement:** copy `sections.massing.placement`. The parking local frame is the massing local frame.
- **Cores:** with `coresFromProject`, read `seeds` from the lowest bar level above the parking levels and carry them down.
- **Required:** `units` from `massing.derived.metrics.units`; `retailSf` from podium retail and the liner when the Mid-Rise state set one.
- **Overlay:** `plates.derived`, else the Mid-Rise spines and unit width (section 3.9).
- **Write:** `writeSection(doc, "parking", { tool: "parking", schema: 1, placement, state, derived })`, debounced 1 s, plus `visibilitychange` and `pagehide`.
- **Send:** "Send to Facade Studio" stays disabled until that tool exists.
- **No project:** the tool works standalone; the Project menu offers New, Open, Import, Export.

**Spec additions (the integrator edits `docs/project-file-spec.md` section 6.4):**

1. On each level: `"cores": [ { "id": "S1", "kind": "stair" | "elevator", "outer": Ring } ]` and `"clearHeight": 8.0` (lowest clear height on the level, ft). Both optional.
2. On each stall: `"evReady": true` (optional).
3. In `metrics`: `"accessible": { "required", "provided", "van" }`, `"ev": { "installed", "ready" }`, `"bike": { "required", "areaSf" }`, `"conflicts": 0`. All optional.
4. A note: "`index` 1 is the lowest parking level. `z` is relative to baseZ."

---

## 8. Presets

Phase 7 (Haiku) types these values into `src/parking/presets.js`. Every count below follows section 3 exactly. All presets: stall 9 × 18, aisle 24, perimeter 1, entry on the west end (no stall loss), compact 0, EV 5 / 20 percent, open top, `ftf1` 11, `ftf` 10.5.

**Standard cores** (used by presets 8.1 to 8.6, layout frame): S1 stair `x 25..47` in the south row of bay 1 → 3 stalls; E1 elevator `x 52..62` in the same row → 2 stalls; S2 stair in the north row of the top bay, ending at the last stall → 3 stalls. **8 stalls per level.**

### 8.1 Two-bay single helix, five levels (default)

| Item | Value |
|---|---|
| Footprint | 300 × 125, standalone |
| Bays | `Du = 123` → 2 double bays (120), strip 3 |
| Run | `298 − 48 = 250` → `floor(250 ÷ 9) = 27` per row |
| Ramp | Single helix; level 1 `5.5 ÷ 250 = 2.2%`, typical `2.1%` |
| Grid | Long-span |

Per level: 4 rows × 27 = 108 − 8 = 100. Five levels: `N0 = 500`. Accessible: table row 401–500 → 9; R-2 off (standalone) → 9; van `ceil(9 ÷ 6) = 2`, car 7. Aisles: `8 × 2 + 5 × ceil((7 − 2) ÷ 2) = 16 + 15 = 31` → `ceil(31 ÷ 9) = 4` lost. **Stalls 496.** Gross 187,500 → **378.0 sf per stall**. EV installed `round(24.8) = 25`; ready `round(99.2) = 99`. Columns per level: 3 lines × (`floor(250 ÷ 27) + 1` = 10, plus the end at 275) = **33**. Clear height level 1 `11 − 2.5 = 8.5` (passes 8.17); typical `8.0` (passes 7.0).

### 8.2 Three-bay deck with a sloped center bay, five levels

`Du = 183` → 3 bays, strip 3. 6 rows × 27 = 162 − 8 = 154 per level → `N0 = 770`. Table 501–1,000: `ceil(15.4) = 16`; van 3, car 13; aisles `24 + 5 × ceil(10 ÷ 2) = 49` → 6 lost. **Stalls 764.** Gross 300 × 185 × 5 = 277,500 → **363.2 sf per stall**. Sloped bay 1 (the center bay): level 1 `11 ÷ 250 = 4.4%`.

### 8.3 Double helix, six levels

Footprint 360 × 125. Run `358 − 48 = 310` → 34 per row → 136 − 8 = 128 per level → `N0 = 768`. Required `ceil(15.36) = 16` → 6 lost. **Stalls 762.** Gross 360 × 125 × 6 = 270,000 → **354.3 sf per stall**. Slope level 1 `11 ÷ 310 = 3.55%`.

### 8.4 Flat floors with a speed ramp, five levels

Footprint 300 × 150. `Du = 148` → 2 bays (120), strip 28 (y 121 to 149). Speed ramp straight, width 24, length 82, transitions 10: footprint 102 × 24 at x 99..201, y 123..147, inside the strip → no stall loss. Slope level 1 `11 ÷ 92 = 11.96%` (limit 12). Per level 100 → `N0 = 500` → 4 lost. **Stalls 496.** Gross 225,000 → **453.6 sf per stall**.

### 8.5 Split-level deck, six levels

Footprint 300 × 125. End zones `36 + 20 = 56` → run `298 − 112 = 186` → 20 per row → 80 − 8 = 72 per level (cores shifted: S1 `x 57..79`, E1 `x 84..94`, S2 `x 215..237`) → `N0 = 432` → table 9 → 4 lost. **Stalls 428.** Gross 225,000 → **525.7 sf per stall**. End ramp level 1 `5.5 ÷ 46 = 11.96%`.

### 8.6 Wrap deck from the Mid-Rise wrap preset

Same geometry as 8.1 (the Mid-Rise wrap deck is 300 × 125, five levels). Source `wrap`; R-2 on: `max(1, ceil(500 × 0.02)) = 10` > table 9 → required 10; van 2, car 8; aisles `16 + 5 × 3 = 31` → 4 lost. **Stalls 496.** In a project, `ftf` comes from the deck levels (10.5 for all, so level 1 slope `5.25 ÷ 250 = 2.1%` and level 1 clear height 8.0, which warns against the van route — a planned warning that teaches the check).

### 8.7 Podium level under a bar (concept example B)

Footprint 300 × 65, one level, long-span, ramp none, source podium (R-2 on). `Du = 63` → 1 bay, strip 3. Run 250 → 27 per row → 54. Cores (moved into the south row, plus one north): S1 `25..47` (3), E1 `52..62` (2), S2 `142..164` (3), S3 north `246..268` (3) → 11 lost → `N0 = 43`. Table 26–50 → 2; R-2 → 1; required 2; van 1, car 1; aisle 8 → 1 lost. **Stalls 42.** Gross 19,500 → **464.3 sf per stall**. Overlay with 28 ft units: suggestion **9 ft 4 in**, giving `floor(250 ÷ 9.333) = 26` per row.

### 8.8 Two-level podium under a U building, short-span

Footprint 300 × 206, two levels, short-span (module 29), speed ramp straight in the north strip (`Du = 204` → 3 bays, strip 24, ramp y 181..205), liner south 61 ft deep on level 1 (removes bay 1 on level 1), source podium (R-2 on). Run 250 → `8 × 3 + floor((18 − 2) ÷ 9) = 25` per row. Cores in bay 2 south row (S1 `25..47` → 3, E1 `58..68` → 2) and bay 3 north row (S2 `246..268` → 3).

Level 1: 4 rows × 25 = 100 − 8 = 92. Level 2: 6 × 25 = 150 − 8 = 142. `N0 = 234`. Table 201–300 → 7; R-2 `ceil(4.68) = 5`; required 7; van 2, car 5; aisles `16 + 5 × ceil(3 ÷ 2) = 26` → 3 lost. **Stalls 231.** Gross `2 × 300 × 206 − 300 × 61 = 105,300` → **455.8 sf per stall**. Speed ramp level 1 `11 ÷ 92 = 11.96%`.

### 8.9 Hand example A (test case only, not a menu preset)

Concept example A with no cores and every `ftf` 10.5: 4 × 27 × 5 = 540; `ceil(10.8) = 11`; van 2, car 9; aisles `16 + 5 × ceil(7 ÷ 2) = 36` → 4 lost. **Stalls 536**; **349.8 sf per stall**; slope 2.1%.

---

## 9. Tests

### 9.1 Module tests (`test/parking.*.test.mjs`, run by `npm test`)

| # | File | Case | Expect |
|---|---|---|---|
| 1 | layout | Bays for D = 125, 150, 185, 206, 65 | 2 + strip 3; 2 + strip 28; 3 + strip 3; 3 + strip 24; 1 + strip 3 |
| 2 | layout | Edge bay: D = 104 (`Du = 102`) | 1 double + 1 single (42), strip 0 |
| 3 | layout | Long-span row, R = 250 | 27 stalls; stall 26 spans 259..268 |
| 4 | layout | Short-span row, R = 250 | 25 stalls (8 modules + 1) |
| 5 | layout | Core S1 25..47 and E1 52..62 in one row | 3 and 2 stalls lost; no double count |
| 6 | layout | Entry on a long side at x 150, width 24 (lane 138..162) | 4 stalls lost in the edge row (k = 12 to 15; k 12 spans 133..142, k 15 spans 160..169) |
| 7 | ramps | `rampSlope(11, 82, { length: 10, slopeFactor: 0.5 })` | 0.11957 |
| 8 | ramps | Single helix 300 × 125 level 1 | 0.022 |
| 9 | ramps | Circular ramp, radius 30, width 24, 12 segments | Length `2π × 42 = 263.9`; 12 segments |
| 10 | grid | Preset 8.1 | 33 columns per level; clear heights 8.5 and 8.0 pass |
| 11 | accessible | `requiredAccessible` for 25, 26, 500, 534, 770, 1,200 | 1, 2, 9, 11, 16, 22 |
| 12 | accessible | R-2 on, 500 stalls | 10; van 2 |
| 13 | accessible | `aisleLength(2, 7)` and `(2, 8)` and `(1, 1)` | 31, 31, 8 |
| 14 | overlay | 28 ft units, long-span 9 ft | Suggestion 9.333; conflicts grow by 1 ft per module |
| 15 | metrics | Every preset 8.1 to 8.9 | Stalls exact (tolerance 0); sf per stall to 0.1 |
| 16 | derived | Preset 8.6 through `parkingDerived`, `writeSection`, `validate` | Valid; 5 levels; every ring clean; byKind sums to stalls |
| 17 | exports | DXF of preset 8.1 | Has every layer; one closed polyline per stall on PARK-STALL and PARK-ACCESSIBLE, 496 in total |
| 18 | exports | Stall CSV of preset 8.7 | 42 rows plus the header |

Every test that fixes a number writes the arithmetic in a comment.

### 9.2 In-page tests (`parking/index.html?test`)

- Shell: the default state builds; the HUD shows 496 stalls, 378 sf per stall, 5 levels, 2.2 percent.
- Every preset loads with the expected stalls.
- Handles: move S1 by +9 ft → the row loses the same count and the total stays 496 ± 1; the speed ramp drag stays in the strip.
- Project: a fixture project with the Mid-Rise wrap preset → source picker lists the deck levels → picking them gives 496 stalls and the planned clear-height warning.
- Exports: SketchUp doc validates; DXF and CSV download.

### 9.3 Cade's live checks

1. Open each preset on the Mac. Compare the HUD with section 8.
2. On the iPad, drag a core into an aisle; the warning shows; "Move to nearest row" fixes it.
3. Mid-Rise wrap preset → Send to Parking Deck → pick the deck → check the stall count and the overlay.
4. Export the DXF and link it in Revit; check the ramp faces.

---

## 10. Build phases and file ownership

Phases 2 to 6 run in parallel. Each agent owns only its files.

| Phase | Model | Agent | Owns | Acceptance checks |
|---|---|---|---|---|
| 1 | Opus | Orchestrator | This plan | Cade's go |
| 2 | Opus | Layout | `src/parking/layout.js`, `ramps.js`, `grid.js`, tests 1 to 10 | Tests pass; every row count matches section 8 by hand |
| 3 | Sonnet | Rules | `src/parking/accessible.js`, `overlay.js`, `metrics.js`, tests 11 to 15 | Tests pass; test 15 runs against `layout` once phase 2 lands (a hand fixture before) |
| 4 | Sonnet | Exports | `src/parking/derived.js`, `sketchup.js`, `exports.js`, tests 16 to 18 | Doc validates; derived validates |
| 5 | Sonnet | Page | everything under `build/parking/`, `parking/index.html` (through its build) | Section 9.2 tests pass; screenshots at 1440 × 900 and 820 × 1180 |
| 6 | Haiku | Presets | `src/parking/presets.js`, `testcases.js` | Every preset loads; values match section 8 |
| 7 | Opus | Integrator and reviewer | `package.json` scripts, `README.md`, `index.html` Workspace card, `build/midrise` "Send to Parking Deck" enable check, `docs/project-file-spec.md` 6.4 additions, `docs/suite-roadmap.md` | `npm test` green; all in-page tests green; ten hand counts checked |
| 8 | Cade | — | — | Section 9.3 |

**Interfaces:** section 4 fixes every signature. The page agent codes against them and reports problems; it does not edit `src/`. SketchUp: the integrator adds `"parking"` to the accepted sources in `src/shared/sketchup-format.js` and `sketchup/cmrlm_design_tools/importer.rb`, and rebuilds the `.rbz`.

---

## 11. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| Polygon footprints (wrap decks with notches) | Rows clipped in odd places | Clip every stall to the inset footprint; count only whole stalls; tests on an L footprint |
| Accessible group does not fit in one row | Stalls spread out | Continue in the next nearest row; report both rows |
| Mid-Rise seeds fall in aisles | Many warnings on a first open | One "Move all cores to rows" action |
| Speed ramp outside the strip | Stall losses the user does not expect | Show the loss count on the ramp card |
| Split-level end zones cost a lot | Low counts | Shown honestly; a later version can place center ramps |
| Clear height warnings on project decks with 10.5 ft levels | Confusing on a first open | The warning names the fix: level 1 to 11 ft |
| Overlay with irregular unit widths | Weak suggestion | Use the median width; list each conflict |

Open items:

1. A later version can add center ramps for split-level decks and angled bays (decision 11).
2. The Mid-Rise can read `parking.derived.metrics.stalls` and show it next to its own estimate. Not in this build.
