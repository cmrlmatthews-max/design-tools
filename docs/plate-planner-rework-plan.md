# Plate Planner Rework — Technical Plan

Version 1.0 · October 24, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Changes `plate-planner-technical-plan.md` v0.1. Where the two disagree, this plan wins.

Caution: the Plate Planner makes a test fit for early design. Unit counts, areas, elevator counts, and core sizes are design-stage numbers. The tool never checks a code and never says "compliant".

---

## 1. Problems found (October 24, 2026)

Cade tested a 52-floor tower (levels 5–56) from the Tower Generator.

| # | Problem | Cause |
|---|---|---|
| P1 | Large diagonal-hatch areas north and south of the core | The runs are 47.1 ft deep. At that depth no type keeps its area range (2BR: 1,200 ÷ 47.1 = 25.5 ft, less than 32 ft). `slotsFor` finds no set of units, and the run becomes support of kind `remainder`. Efficiency fell to 52%. |
| P2 | Most types drop out of the mix | At 36.3 ft deep, studio, 1BR, and 1BR + den drop with `type-does-not-fit` (all on the deep side). |
| P3 | The core is mostly empty | The Tower core is 20% of the plate. The fill places only 2 stairs and 2 cabs in it. |
| P4 | Editing is hard | Bay drags use the effective (area) range, so at a deep run almost every drag is refused. No split, merge, hand-drawn unit, depth control, or way to fill a hatched run. |
| P5 | Small bugs | The HUD badge (8) and the list (10) disagree. The warnings show twice. The mix table shows dropped types with target 0. Unfilled runs and real support use the same hatch. |

## 2. Decisions (Cade, October 24, 2026)

| # | Decision |
|---|---|
| D1 | Deep runs: fill by width and flag units that are larger than their area range. Add efficiency recommendations (example: narrow the plate). |
| D2 | The Plate Planner fills the core automatically. |
| D3 | Remove the core from the Tower Generator. Only the Plate Planner makes a core. |
| D4 | Add all the editing tools: split, merge, bay drag, type change, move core and stairs, draw a unit, unit depth. |
| D5 | Fix the small bugs. |

---

## 3. Deep-run rule (D1) — `src/plate/mix.js`

`effectiveTypes(types, depth, mode)` changes for multifamily only:

1. Compute `lo`, `hi`, and `w` as now.
2. When `lo > hi` **and** the cause is depth (`areaMax ÷ d < widthMin`), keep the type with `lo = widthMin`, `hi = widthMax`, `w = clamp(targetArea ÷ d, widthMin, widthMax)`, and `areaOff: "deep"`. The type stays in the mix with its share.
3. When `lo > hi` because the run is too shallow (`areaMin ÷ d > widthMax`), drop the type as now (`type-does-not-fit`). Presets 8.3 and 8.4 keep their values.
4. Return `{ types, dropped, deep: [{ id, name, lo, hi, areaLo, areaHi }] }`, where `areaLo = widthMin × d` and `areaHi = widthMax × d`.

Results:

- Every unit of a deep type gets the flag `areaHigh: true` in the fill output and in `derived` units (`flags: ["area-high"]`).
- The warning `type-area-high` (severity `info`, one per type per group) replaces `type-does-not-fit` for deep types: "2BR at 47.1 ft deep: 32 to 40 ft wide gives 1,507 to 1,884 sf (range 1,000 to 1,200 sf)."
- Corner wrap units at a deep corner keep the formula. Their area is flagged in the same way when it leaves the corner type's range.
- The fill no longer makes `remainder` support on a deep run. A `remainder` now comes only from a run that is too short (`run-too-short`).

## 4. Core moves to the Plate Planner (D2, D3)

### 4.1 Tower Generator — `src/tower/*`, `build/tower/*`

1. Remove the Core card, the `core` state key, `makeCore`, the `core-outside` warning, and the HUD rows "Core area" and the core part of "Efficiency".
2. Every plate writes `coreRect: null` and `coreArea: 0`. `towerDerived` writes `core: null` on every level.
3. Net area = GFA − mechanical area. Rename the HUD row "Net area" to "Net area (before core)". Remove the tower "Efficiency" row; add a help line: "The Plate Planner sets the core and the efficiency."
4. A saved state with a `core` key loads without error (the store drops the key).
5. Presets lose their `core` key. Update every tower test that reads the core.

### 4.2 Plate Planner core modes — state

```jsonc
"core": {
  "mode": "auto",          // "auto" | "manual" | "none"
  "rect": null             // manual: [x0, y0, x1, y1]
}
```

- Load rule (migration inside `defaultState` merge): a stored `core.rect` with no `mode` gives `mode: "manual"`. No rect and no mode gives `"auto"`.
- The fill **ignores `level.core` from the massing** (old project files still carry the Tower core). It still reads `seeds` (Mid-Rise stairs).
- Dragging the core in the page sets `mode: "manual"` and `rect`. The Plate tab has "Reset core to auto".

### 4.3 Corridor kind `auto`

1. Massing spines or a typed spine → `bar`.
2. Else a **compact plate** → `point` with a core. Compact means: no holes, plate area ÷ minimum-area bounding rectangle area ≥ 0.85, and that rectangle's long side ÷ short side ≤ 1.6.
3. Else → `bar`.
4. A core in `manual` mode with no spines also gives `point` (the current rule).

### 4.4 Core program — new `src/plate/core.js`

```js
export function coreProgram(state, ctx)   // ctx: { floors, levelGsf, mode } → { cabs, service, rooms: [{ kind, size: [a, b] }], notes }
export function coreLayout2(program, center, axis, state) // → { rect: [x0,y0,x1,y1] or Ring, rooms: [{ id, kind, outer }] }
export function autoCore(plate, level, state, ctx)        // → { outer, rooms, program } for a point plate
```

Elevator count (Caution: seeds for early design; verify with a vertical transportation consultant):

| Mode | Passenger cabs | Service cab |
|---|---|---|
| Multifamily | `max(2, ceil(U ÷ 90))` | 1 when floors ≥ 20 |
| Hotel | `max(2, ceil(K ÷ 100))` | 1 always |

`U` (or `K`) is an estimate of building units, made before the fill to break the loop: `floors × round(levelGsf × 0.75 ÷ A)`, where `A` is the share-weighted target area of the mix (hotel: 400 sf per key). `floors` is the sum of the floors of every filled group. `state.elevators.count` (not null) overrides the passenger count.

Layout of the auto core (point plates), in a frame with `u` along the plate's long axis (the long side of the minimum-area bounding rectangle) and centered on the plate's area centroid:

```
 u →
 ┌──────┬──────┬──────┬──────┬──────┬──────┐
 │      │ Cab  │ Cab  │ Cab  │ Cab  │      │   row 1: passenger cabs, 8 × 11 each, doors to the corridor on this side
 │Stair │──────┴──────┼──────┴──┬───┴──┬───│
 │ S1   │ Svc  │Trash │  Elec   │Shaft │S2 │   row 2: service cab 8, trash 8, electrical 8, shaft 6 (hotel: + linen 14, ice 6, data 6)
 │11×22 │ cab  │      │         │      │   │
 └──────┴──────┴──────┴─────────┴──────┴───┘
```

- Core depth `B = 22` (the stair depth). Rows are 11 deep each.
- Row length `R = max(cabs × 8, Σ row-2 room lengths)`. The shorter row stretches its last room (row 1: a room of kind `shaft`) to `R`. Every square foot of the core belongs to a named room. No empty core.
- Core length `A = 2 × 11 + R`. Stairs take the two ends.
- When passenger cabs exceed 6, split them evenly between row 1 and row 2 (two banks), and move row-2 rooms to the end of the longer row.
- Room kinds: `stair`, `elevator`, `service-elevator`, `trash`, `electrical`, `shaft`, `linen`, `ice`, `data`. Rooms with kind `stair` are the stairs (with doors); `elevator` and `service-elevator` rooms are the elevators.
- `core.rooms` goes to the fill output and to `derived.levels[].core.rooms` (optional key; add it to `docs/project-file-spec.md` section 6.3).
- Bars keep the current behavior: no auto core; elevators beside the corridor when there is no core. `mode: "auto"` on a bar means no core block.

## 5. Unit depth cap (D4) — `src/plate/fill.js`

New state key `fill: { maxDepth: null }` (ft; null = off). Per group for a project: `levels.groups[gid].maxDepth` wins over the global key.

- When a run's area depth `d` > `maxDepth`, the unit band is cut at `maxDepth` from the area line. The strip between the cut and the corridor face becomes support of kind `trim` ("Storage / closets").
- Effective types, corners, and `e` use `maxDepth` as the depth.
- Metrics list `trim` support with the other support kinds. Area closure stays exact.

## 6. Efficiency advisor — new `src/plate/advisor.js`

```js
export function advise(state, built, metrics, { fillPlate }) // → [{ code, severity, message, current, suggested, gain }]
```

`fillPlate` is injected (it is `buildPlates`) so the module has no import cycle. Target area depth: `state.targetDepth` (default multifamily 30 ft, hotel 26 ft; editable on the Checks tab).

| Code | When | Message (example) and numbers |
|---|---|---|
| `plate-too-deep` | A run's depth > target + 2 ft on a rectangular plate (plate area ÷ min-area rectangle ≥ 0.98) | "North and south units are 47.1 ft deep; the target is 30 ft. Narrow the plate north–south from 160 ft to 126 ft in the Tower Generator. Test fit at that size: 72% efficiency, 12 units per floor, 4,300 sf less per floor." The suggested size is `core side + 2 × corridor width + 2 × (target + extWall)` on a point plate, `2 × (target + extWall) + corridor width` on a bar. The numbers come from a real fill of a drawn rectangle at the suggested size with the same state. |
| `plate-too-deep` (other shapes) | Same, non-rectangular plate | Depths and the target only, no test fit. |
| `plate-too-shallow` | A type drops with `type-does-not-fit` | "The 3BR needs 45 ft of depth or more; the runs are 26.2 ft deep. Make the bar 4 ft deeper or remove the 3BR." |
| `core-oversize` | Manual core area > 1.25 × the auto program area | "The core is 4,700 sf; the program needs 1,540 sf. Reset the core to auto to gain about 3,160 sf per floor." |
| `unfilled-runs` | Any `remainder` support | "2 runs are unfilled (4,180 sf). Move a stair or the core, or fill the run by hand." |
| `efficiency-low` | Efficiency < 0.70 and none of the above | "Efficiency is 64%. Typical test fits reach 75 to 82%." |

Order: largest `gain` (sf per floor) first. The advisor never edits the massing. Caution text on the card: design-stage numbers.

## 7. Page changes (D4, D5) — `build/plate/*`

### 7.1 Drawing styles

| Area | Style |
|---|---|
| Unit flagged `area-high` | Model: thin orange outline; Diagram: type color with an orange outline; the label adds "large". |
| `remainder` (unfilled run) | No hatch. Dashed dark outline, very light fill, label "Unfilled · 44'-5"". Tappable. |
| Support blocks, `pocket`, `trim` | Light hatch (half the current density), label by kind ("Pocket", "Storage", "Trash"). |
| Core rooms | Each room a separate rectangle with a thin line and a short label (Stair, Elev, Svc, Trash, Elec, Shaft, Linen, Ice, Data). Elevators keep the X. |

### 7.2 Editing tools

| Tool | Behavior |
|---|---|
| Bay drag | Limits use the width range (`widthMin`, `widthMax`) of the two types, not the area range. Show both new widths live beside the line. Touch handle 44 pt. |
| Split | Unit card button. Two units of half the width. Each half takes the type whose width range holds the half width (deficit order); with no such type, the same type, flagged. Both become locks. |
| Merge | Unit card buttons "Merge ←" and "Merge →" (neighbors in the same run). One unit; type by best fit of the width (deficit order); a lock. |
| Fill an unfilled run | Tap a `remainder`. The card shows the run length and buttons "1 unit", "2 units", "3 units" (counts that fit the width ranges) and type chips. The result is locked units that split the run evenly. |
| Draw a unit | Draw menu "Unit": tap two points on the same run. The unit spans the band between the two cut lines; it becomes a lock with the best-fit type. |
| Unit depth | Plate tab, Corridor card: "Unit depth cap" slider (off, 24 to 40 ft) for the selected group (section 5). |
| Core | Drag moves the core (mode becomes manual). "Reset core to auto" button. Elevator count field (blank = auto, shows the auto value). |
| Type change | Unchanged; the chips now show every type, with deep types marked "large". |

Every edit goes through the Store, so Undo and Redo work.

### 7.3 Panels and bugs

1. HUD badge count = the length of the warnings list. One source: `checks()` output, de-duplicated by `code + where`.
2. The HUD shows the count and the first 3 warnings, plus "See all in Checks". The Checks tab holds the full list.
3. The mix table hides a type with target 0 and placed 0. A dropped type shows "does not fit at this depth" in place of numbers. Color chips align in one column.
4. Checks tab, first card: **Efficiency** — the advisor list, with the target depth field.
5. HUD "Plate" panel: one advisor line under Efficiency when the list is not empty.
6. Help panel: add the deep-run rule, the core program, and the new tools.

---

## 8. Tests

### 8.1 Module tests (Node)

| # | Case | Expect |
|---|---|---|
| R1 | Deep point plate: rect 150 × 160, no core in the level, auto | Kind `point`; auto core with rooms; core rooms tile the core within 1 sf; no `remainder`; every run filled; `type-area-high` warnings; no `type-does-not-fit` for deep types |
| R2 | `coreProgram`: multifamily, 52 floors, levelGsf 23,364, default mix | Passenger cabs `max(2, ceil(U ÷ 90))` with U written out in the test; service 1 |
| R3 | `coreProgram`: hotel, 12 floors, 14,400 sf | 2 passenger + 1 service; linen, ice, data rooms |
| R4 | Advisor on R1 | First item `plate-too-deep`; suggested size per the formula; its test-fit efficiency > R1 efficiency |
| R5 | Advisor on a manual 4,700 sf core | `core-oversize` with the gain |
| R6 | Depth cap 30 on R1 | Units 30 ft deep; `trim` support; area closure within 1 sf |
| R7 | Old project level with a Tower core ring | The core ring is ignored; auto core |
| R8 | Presets 8.1 to 8.6 | Unchanged values (8.5 keeps its explicit core as manual) |
| R9 | Determinism of R1 | Byte-equal twice |
| T1 | Tower: every preset | `coreRect` null, `coreArea` 0, net area = GFA − mechanical, no `core-outside` |

### 8.2 In-page tests

- Plate: split, merge, fill-a-remainder, draw-a-unit, depth cap, reset core; badge count equals the list length; mix table hides empty rows.
- Tower: no Core card; HUD has no Core area row; old state with `core` loads.

### 8.3 Cade's live checks

1. Open the 52-floor tower project. Re-fill. Check: no large hatch, a full core, and an advisor line.
2. Follow the advisor: narrow the plate in the Tower Generator, send it again, and compare the efficiency.
3. Split, merge, and drag on the iPad.

---

## 9. Phases and models

| Phase | Model | Owns | Reason |
|---|---|---|---|
| 1 | Opus | This plan | The rules interact. |
| 2 | Opus | `src/plate/*` (mix, core, fill, corridor, metrics, advisor, derived), `test/plate.*`, `docs/project-file-spec.md` | Geometry and fill math hide errors. |
| 3 | Sonnet | `src/tower/*`, `build/tower/*`, `test/tower.*`, `test/geometry.test.mjs`, `test/envelope.test.mjs` | A clear removal with test updates. |
| 4 | Sonnet | `build/plate/*` | Standard page code against the section 4 to 7 contracts. Starts after phase 2. |
| 5 | Opus | Review, full test run, screenshots, README and roadmap rows | Independent check. |
