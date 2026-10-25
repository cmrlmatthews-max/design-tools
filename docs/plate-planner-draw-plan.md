# Plate Planner Draw-First — Technical Plan

Version 1.0 · October 25, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Changes `plate-planner-technical-plan.md` and `plate-planner-rework-plan.md`. Where they disagree, this plan wins.

Caution: the Plate Planner makes a test fit for early design. Areas and type matches are design-stage numbers. The tool never checks a code and never says "compliant".

---

## 1. Decisions (Cade, October 25, 2026)

| # | Decision |
|---|---|
| E1 | The plate starts blank. The architect draws the units. Main tool: **paint along the facade** (direction A). A **Free draw** mode handles odd shapes. |
| E2 | The tool shows the core (auto), the corridor and the stairs. The core is editable: move, resize, and core mode (auto, manual, none). |
| E3 | Suggestions: **ghost units on one selected run** (or free stretch). The architect accepts all, accepts one, or dismisses them. |
| E4 | The automatic whole-plate fill goes away: no auto-fill on load, no Re-fill button. |
| E5 | Live feedback while drawing: **area** and **type match** only. |
| E6 | One drawn layout applies to every level of a group of identical floors (as now). |

## 2. Model

### 2.1 State

Drawn units replace locks. One list per layout:

```jsonc
"units": [                                   // drawn source; project source: levels.groups[gid].units
  { "id": "U-01", "type": "2br", "mode": "run" | "free" | "corner", "outer": Ring, "runKey": "0:3:12.5" | null }
]
```

- `mode: "run"`: painted on a run; `outer` = the band between two cut lines (facade to corridor, or to the depth cap).
- `mode: "corner"`: a wrap unit at a convex corner zone (legs from the existing corner formula).
- `mode: "free"`: any polygon the architect drew, clipped to the unit zone (plate inset minus corridor, core, stairs, support, other units).
- `type` is chosen by the tool from the area (section 3.3); the architect can change it. A type the architect set by hand keeps `typeSet: true`.
- **Migration:** `locks` become `units` with `mode` from the shape (rectangle on one run → `run`, wrap → `corner`, else `free`). A state with no locks and no units starts blank. Presets ship with units already drawn (section 6), so their numbers stay.
- The keys `fill.maxDepth`, `levels.groups[gid].maxDepth`, `core`, `targetDepth`, mix shares, and widths stay. Mix shares now drive only suggestions and the placed-against-target table.

### 2.2 Pipeline — `src/plate/fill.js`

```js
export function layoutLevel(level, state, { units, core, maxDepth, rotation }) // → LevelLayout (main pipeline)
export function fillLevel(...)               // unchanged; now the suggestion engine only
export function buildPlates(state, { project }) // uses layoutLevel; never auto-fills
```

`layoutLevel` computes plate, corridor, core (auto, manual, none), stairs, elevators, bands, runs, corner zones, pockets — the same code as today — then places the drawn units as reservations. Output adds:

- `units`: the drawn units with `area`, `type`, `match` (section 3.3), `exposures`, `corner`, `bay`, `demising` (same derived shape as today).
- `free`: the open stretches of every run: `[{ runId, a, b, length, depth }]` — run intervals no unit covers.
- `openArea`: unit-zone area no unit covers (shown light; no warning, no hatch).
- `cornerZones`: convex corner zones with no unit: `[{ id, outer, e, legs }]`.

Area closure: GSF = NRSF + corridor + core + stairs + elevators + support + open area + exterior allowance (± 1 sf).

### 2.3 Suggestions — `src/plate/suggest.js` (new)

```js
export function suggestRun(layout, state, freeStretch, { counters })  // → { units: [{ type, outer, area, width, match }], note }
export function suggestCorner(layout, state, cornerZone)               // → one wrap unit
export function placedCounts(units)                                    // → { [type]: n } for the deficit counters
```

- Uses the existing exact-feasibility fill (`slotsFor`, `fillRuns`) on the one free stretch, with deficit counters started from the units already drawn on the whole group, so suggestions move the mix toward the targets.
- A stretch that fits no unit returns `units: []` and a note: "This stretch (13'-8") is too short for any type. Extend a neighbor or leave it open."
- Pure and deterministic.

### 2.4 Paint rule — `src/plate/draw.js` (new)

```js
export function paintUnit(layout, state, runId, s0, s1, { snap = true })   // → { unit, match, width, snapped: [s0, s1], refused?: reason }
export function freeUnit(layout, state, ring)                              // → { unit, match, area, clipped: bool }
export function retype(unit, typeId)                                       // → unit with typeSet
export function pickType(area, types, depth)                               // → { type, match }
export function splitUnit(layout, unit, at?) / mergeUnits(layout, a, b)    // existing behavior, on the units list
```

- Paint: the drag sets the interval along the run. With snap on, the width snaps to 0.5 ft and stops at a neighbor unit, a block, or the run end. The unit spans the band (facade to corridor face, or to the depth cap).
- Near a convex corner zone, a paint that starts inside the zone makes a corner unit.
- Free draw: rectangle by two corners, or polygon by taps. The ring is clipped to the unit zone. A result under 50 sf is refused.

## 3. Feedback (E5)

### 3.1 While drawing

A label follows the pointer: **area** and **type match**. Example: "812 sf · 1BR, in range" or "1,320 sf · 2BR, large".

### 3.2 On the plan

Each unit shows its type and area. The outline color shows the match: in range = normal line; large = orange; small = blue.

### 3.3 Type match rule (`pickType`)

1. Candidates: types whose area range `[areaMin, areaMax]` holds the area → `match: "in-range"`. Pick the one whose target area is closest.
2. Else the type whose range is nearest: `match: "large"` (area above its max) or `"small"` (below its min).
3. Hotel mode: match by width against `widthMin..widthMax` (suite: two bays); area is shown only.
4. A type set by hand keeps its type; `match` still reports in range, large, or small for that type.

## 4. Page — `build/plate/*`

Remove: auto-fill on load, Re-fill, the "Fill an unfilled run" card, the run-too-short and mix-miss warnings, remainder styling.

| Tool | Behavior |
|---|---|
| **Paint** (default tool, key P) | Press on a run and drag along it. The live label shows area and type match. Release makes the unit. Tap an empty run without drag: select the free stretch. |
| **Suggest** | With a free stretch or a corner zone selected: the card shows "Suggest". Ghost units appear (dashed, type colors). Buttons: "Accept all", tap a ghost to accept one, "Dismiss". Escape dismisses. |
| **Free draw** (key R rectangle, key G polygon) | Draws a free unit; clipped to the unit zone. |
| **Select** (key V) | Tap a unit: card with type chips, area, match, Split, Merge ← / →, Delete. Drag a shared bay line between two run units: both widths change. |
| **Core** | Drag to move (mode becomes manual). Corner handles resize it (snap 0.5 ft, minimum 10 × 10 ft). With a resized manual core the auto room layout is redrawn inside it when the rooms fit; else the core shows "Rooms do not fit" and stays one block. Card: mode Auto / Manual / None, elevator count, "Reset to auto". Stairs drag as now. |
| **Clear level** | Removes every unit of the selected group (one undo step, confirm). |

- Empty state on a blank plate: a short hint over the plan: "Drag along a facade to draw a unit. Select an open stretch and tap Suggest for a layout."
- Open stretches draw as a very light band; corner zones with no unit show a faint dashed outline.
- HUD: Units, NRSF, Efficiency (of the drawn units), "Open: 4,120 sf", Units in range a of b. The advisor line stays.
- Undo and redo for every edit. iPad: 44 pt handles; paint works with one finger; two fingers pan and zoom.

## 5. Readers and exports

`derived` keeps its shape (units, demising, bay, flags), so the Parking Deck overlay, the Facade Studio balconies, and the Model Viewer need no change. Open area is not written to `derived`. The rooms CSV, DXF, SketchUp and notes export the drawn units.

## 6. Presets and tests

- Presets 8.1 to 8.6: ship with units equal to today's fill result (run once, frozen into the preset state by a script `scripts/freeze-presets.mjs`, output pasted into `src/plate/presets.js`). Their section 8 numbers stay.
- New preset "Blank point tower" (150 × 160 ft, auto core, no units) is the default for a new design.
- Module tests (new `test/plate.draw.test.mjs`):

| # | Case | Expect |
|---|---|---|
| D1 | Blank plate | 0 units; `free` covers every run; closure within 1 sf; no warnings except the info line "No units drawn yet" |
| D2 | `paintUnit` 30 ft on the 8.1 south run | Rectangle 30 × 28.665; 860 sf; `pickType` 1BR + den in range |
| D3 | Paint over a neighbor | Stops at the neighbor's cut line |
| D4 | `suggestRun` on the 8.1 south run, blank | Same units as the 8.1 reference fill of that run |
| D5 | `suggestRun` with 2BRs already drawn | Deficit order moves away from 2BR |
| D6 | Too-short stretch | `units: []` and the note |
| D7 | `freeUnit` across the corridor | Clipped; the part in the corridor is removed |
| D8 | Corner zone suggest | Wrap unit with legs from the formula |
| D9 | `pickType` rules | in range, large, small, hand-set |
| D10 | Migration | Old locks become units; old state with no locks is blank |
| D11 | Presets | Values of section 8 unchanged |
| D12 | Group | One layout copies to every level of the group; building units = level units × floors |

- Existing fill tests stay (the engine is unchanged) and run against `fillLevel`.
- In-page tests: paint, suggest accept all, accept one, dismiss, free rectangle, free polygon, core move and resize, clear level, undo, empty-state hint, no Re-fill button.

## 7. Phases and models

| Phase | Model | Owns | Reason |
|---|---|---|---|
| 1 | Opus | This plan | The draw rules and suggestions interact. |
| 2 | Opus | `src/plate/*` (`layoutLevel`, `draw.js`, `suggest.js`, metrics, migration, presets freeze), `test/plate.*`, the freeze script | Geometry and closure math. |
| 3 | Sonnet | `build/plate/*` | Standard interface work against the section 2 to 4 contracts. Starts after phase 2. |
| 4 | Opus | Review, all tests, Model Viewer and Parking checks, screenshots | Independent check. |

Haiku is not used: the preset values come from a script, not by hand.
