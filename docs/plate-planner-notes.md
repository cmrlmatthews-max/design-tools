# Plate Planner — Design Notes for the Work Build

Version 0.2 · October 22, 2026 · Author: Claude (home session) for Cade (CMRLM) · Decisions in section 14

These notes are the design lead for the Plate Planner build on the work computer. They stand on their own. Each major choice is marked **Recommended**, with one alternative. Keep what you have already built when it is equivalent to the recommended choice. Decisions from Cade that bind this build:

- Modes in version 1: multifamily and hotel. Senior living comes later.
- Users: Cade and RJTR teammates. Use generic names. No client names in the repo.
- The tool reads and writes the shared project file. Spec: `docs/project-file-spec.md`. The contract in section 9 of these notes matches that spec.
- Units: feet and square feet only.
- Same shell and look as the Tower Generator: one HTML file built from parts, Three.js, Model/Diagram toggle, presets, saved options (`src/shared/storage.js`), compare view, screenshots (`src/shared/screenshot.js`), in-page `?test` suite, module tests under `test/`, iPad layout.

Two later tools read this tool's output. The Parking Deck overlays deck columns on the unit bay lines. The Egress Sketch reads stairs, doors, and corridors. Both read only the `derived` block that this tool writes.

---

## 1. Purpose

The Plate Planner turns a floor plate into a counted test fit. A test fit is a quick plan that shows how many units fit on a plate and how large they are.

**Main goal:** Open a massing from the project file and get a counted test fit of the typical floor in less than 15 minutes.

Terms used in these notes:

| Term | Meaning |
|---|---|
| Plate | One floor polygon, measured to the outside face of the exterior wall. |
| GSF | Gross square feet. The area of the plate. |
| NRSF | Net rentable square feet. The area inside the units. See section 3.5 for the measurement rule. |
| Efficiency | NRSF divided by GSF. |
| Double-loaded corridor | A corridor with units on both sides. |
| Key | One hotel guest room. |
| Bay | One slice of the plate between two cut lines that run from the corridor to the facade. One unit takes one bay. A suite takes two. |
| Bay line | The facade edge, used as a one-dimensional line along which the tool cuts bays. |
| Run | The part of the unit zone that belongs to one facade edge. |

---

## 2. Scope

### 2.1 Version 1 includes

- Multifamily mode and hotel mode.
- Plates from the project file, or a drawn or typed plate.
- Three corridor types: bar, single-loaded, and point.
- A fill rule that cuts bays to meet a unit mix.
- Manual edits: change a unit type, drag a bay line, lock a unit, re-fill.
- Live metrics, presets, saved options, compare view, screenshots.
- Exports: rooms CSV, DXF, SketchUp JSON, and the project file section.
- Mac browser and iPad.

### 2.2 Version 1 does not include

- Senior living mode.
- Rooms inside a unit (bedrooms, baths, furniture).
- Code checks. The Egress Sketch does those later. This tool only reports distances.
- Parking and structure. The Parking Deck tool does those.
- A unit plan library. Units are outlines only.
- Metric units.

---

## 3. Inputs

### 3.1 The plate

**From the project file (Recommended).** Read `sections.massing.derived.levels`. Group levels that have the same plate geometry. Round each vertex to 0.01 ft and hash the rings. Show the groups as a list, for example "Levels 7–22 (16 floors)". Fill one level per group. Multiply the level metrics by the floor count of the group. Levels with zone `podium` stay out of the list by default; a toggle shows them.

*Alternative:* the user picks one level and the tool fills only that level. This is simpler, but it hides the building totals.

**Without a project.** The user types a rectangle (width and depth), an L, or a U, or draws a polygon in plan with 1 ft snapping. Reuse `shapeToRing` from `src/tower/geometry.js` for the typed shapes.

### 3.2 The core

Read `core` from the massing level when it is present. The core is a ring. The user can move it and resize it.

Read `seeds` from the massing level when it is present. The Mid-Rise Generator writes its stair and elevator blocks there (`kind`: `stair`, `exterior-stair`, or `elevator`). Use them as the starting stairs and elevators. The user can move or delete them.

Stairs and elevators are boxes inside the plate. Defaults when there are no seeds:

| Item | Size (ft) | Default place |
|---|---|---|
| Exit stair | 11 × 22 | Bar and single-loaded: one at each end of the corridor, straddling the corridor. Point: inside the core. |
| Elevator cab | 8 × 10 | Inside the core. Two cabs by default. Hotel adds one service cab. |

Each stair has a door point on the corridor side. The tool reports the corridor path distance between stair doors. Caution: the tool does not check that distance against any code. The Egress Sketch does.

**Recommended:** stairs at the corridor ends for bar plates. *Alternative:* stairs inside the core for every plate. The alternative gives longer dead ends on bars.

### 3.3 The corridor

| Type | Rule |
|---|---|
| Bar | A spine along the plate. Use `spines` from the massing level when present. Otherwise use the long axis through the plate centroid, and one segment per arm for L and U plates. Units on both sides. |
| Single-loaded | The corridor runs along one facade edge that the user picks. Units on the other side only. |
| Point | A ring corridor around the core. Units on the outside. Used for point towers. |

Make the corridor polygon by offsetting the spine by half the width (clipper-lib supports open paths). Clip it to the plate.

Default corridor widths: multifamily 5.67 ft (5'-8"), hotel 6 ft. Both are editable. Caution: these are common design widths, not code minimums. Verify the width against the adopted code.

### 3.4 Support blocks

Support blocks are small boxes that hold no units: trash, electrical, storage, and hotel back-of-house. The user places them. The fill rule subtracts them from the unit zone. Hotel mode adds one set per floor by default (section 4.2).

### 3.5 Area rule

**Decided (October 22, 2026):** measure unit area to the center of demising walls, to the corridor face of the corridor wall, and to the inside face of the exterior wall. Two settings: exterior wall allowance, default 1.0 ft (the unit polygon stops 1.0 ft inside the plate edge), and corridor wall thickness, default 0.5 ft (the unit polygon reaches the corridor edge; the wall belongs to the unit). Demising walls have zero thickness. State this rule in the notes export.

*Alternative:* measure to the outside face with no allowance. It is simpler, and it reads 3 to 4 percent high.

---

## 4. Unit mix model

### 4.1 Multifamily types

Every value is editable. Width means the bay width along the facade. Target area drives the width: `width = clamp(targetArea / depth, widthMin, widthMax)`, where depth is the run depth minus the exterior wall allowance. This rule adapts the widths to any bar depth.

| Type | Width min–max (ft) | Target area (sf) | Area range (sf) | Default share |
|---|---|---|---|---|
| Studio | 20–24 | 525 | 450–600 | 10% |
| 1BR | 24–28 | 725 | 650–800 | 45% |
| 1BR + den | 28–32 | 900 | 850–950 | 10% |
| 2BR | 32–40 | 1,100 | 1,000–1,200 | 30% |
| 3BR | 40–48 | 1,400 | 1,300–1,500 | 5% |

Corner units get the corner type, default 2BR (section 5.4).

### 4.2 Hotel types

| Type | Bay width (ft) | Depth (ft) | Area (sf) | Default share |
|---|---|---|---|---|
| King | 13.5–14.5, target 14 | 27–30 | 380–420 | 60% |
| Double queen | 14–15, target 14.5 | 27–30 | 400–440 | 30% |
| Suite | Two bays, 27–29 | 27–30 | 780–860 | 5% |
| Accessible | 15–16, target 15.5 | 27–30 | 420–480 | From the table below |

Hotel back-of-house, one set per floor, placed next to the core by default: linen and housekeeping closet 8 × 14 ft, ice and vending 6 × 8 ft, electrical and data 6 × 8 ft. The user can move each block.

### 4.3 Accessible units and keys

Caution: the counts below are seeds for an editable table. Verify every count against the adopted code before use.

- Multifamily (IBC Group R-2): seed the table with 2 percent Type A units, not less than one, where the building has more than 20 units. All other units are Type B.
- Hotel (IBC Group R-1), seeded from IBC Table 1107.6.1.1:

| Total keys | Accessible keys | With roll-in shower |
|---|---|---|
| 1–25 | 1 | 0 |
| 26–50 | 2 | 0 |
| 51–75 | 4 | 1 |
| 76–100 | 5 | 1 |
| 101–150 | 7 | 2 |
| 151–200 | 8 | 2 |
| 201–300 | 10 | 3 |
| 301–400 | 12 | 4 |

The tool spreads the accessible keys across the floors, one or two per floor, and places them nearest the elevators.

---

## 5. The fill rule

This is the heart of the tool. The rule is designed, not random. The same inputs always give the same result.

### 5.1 Steps

1. Normalize the inputs: one plate piece at a time, the corridor polygon, the core, the stairs, and the support blocks.
2. Unit zone = plate − corridor − core − stairs − support blocks. Use clipper-lib with the scale 1000 (0.001 ft), the same as `src/site/model.js`.
3. Facade loop = the outer ring of the plate, split into edges at its vertices. Merge collinear edges. A plate with a hole (a courtyard) has a second loop on the hole ring. Both loops are bay lines.
4. Runs: for each facade edge, the run is the part of the unit zone within the run depth of that edge. The run depth is the distance from the edge to the corridor edge.
5. Corners: reserve a corner unit at each convex corner where the corridor turns (section 5.4). Mark each concave corner pocket as support (section 5.5).
6. Counts: find the unit count and the count per type for the total bay length (section 5.2).
7. Cut each run into bays (section 5.3). Build each unit as a rectangle between its two cut lines, then intersect it with the run polygon. Curved and angled facades give polygon units.
8. Flag every unit with an area outside its range.
9. Exposures: bin each unit facade edge into N, E, S, or W by its outward normal (45-degree sectors). A unit with facade edges in two directions is a corner unit. The two end bays of a bar count as corner units.
10. Corridor numbers come from the spine graph: total length, the path length between stair doors, and dead ends (the corridor length beyond the last stair door on each branch).

### 5.2 Counts

Total bay length `L` = the sum of all run lengths after the corner reservations. Weighted width `W` = the sum of share × target width over the types. Unit count `N = floor(L / W)`. The repair pass (section 5.3) stretches the units into the remainder, or adds one unit when the remainder is large. Per-type counts = share × N, rounded with the largest-remainder method so the counts sum to N. Corner units count toward their type.

### 5.3 Cutting a run

**Recommended: greedy pattern with a repair pass.**

1. Walk the run from its start. Pick the next type by the largest remaining deficit: `(target count − placed count) / target count`. This spreads the types evenly along the bar.
2. Cut a bay at the target width of that type.
3. Stop when the remaining length is less than the smallest minimum width.
4. Repair the remainder. Stretch the last units toward their maximum widths, starting with the last unit. If the remainder is still larger than half of the smallest minimum width, shrink the last units toward their minimum widths and add one more unit of the type with the largest deficit. If the remainder is smaller than that, give it to the last unit and flag the unit as oversize when it leaves its range.
5. Continue on the next run with the same deficit counters.

Reason: a designer can predict and edit the result. It repeats like a hand-drawn plan. It runs in a few milliseconds, so re-fill during a drag is free.

*Alternative:* dynamic programming over widths in 0.5 ft steps that minimizes a cost of area deviation plus mix deviation. It meets the mix more exactly on short runs, but the results look arbitrary and are hard to test by hand. Use it only if the greedy rule misses the mix by more than one unit per type in the test cases.

### 5.4 Corner units

At a convex corner where the corridor turns, the corner unit wraps the corner. It takes a leg `e` along each facade. For a corner type with target area `A` and run depth `d`:

```
e = (A + d²) / (2 d),  clamped to [d, 2 d]
```

Example: `A` = 1,100 sf, `d` = 28.67 ft gives `e` = 33.5 ft. The unit is L-shaped with two 33.5 ft legs.

At a bar end, the corridor does not turn. The two end bays stay rectangular and only get the corner flag.

*Alternative:* no wrap-around units; cut both facades to the corner. It leaves a square pocket at every convex corner.

### 5.5 Concave corner pockets

At a concave corner (the inside corner of an L or U), the two runs overlap in a `d × d` pocket. **Recommended:** mark the pocket as support space (trash chute, storage, electrical). It is not rentable, and the metrics list it. Real plans use these pockets the same way.

*Alternative:* give the pocket to the adjacent unit. It makes one deep, odd unit per corner.

### 5.6 Worked example A — multifamily bar

| Input | Value |
|---|---|
| Plate | 300 × 65 ft rectangle, GSF 19,500 sf |
| Corridor | Bar, 5.67 ft, full length |
| Stairs | Two, 11 × 22 ft, one at each corridor end, straddling the corridor. Each stair takes 11 ft of bay length on both sides. |
| Core | 30 ft long on the north side at mid-length, full run depth |
| Run depth | (65 − 5.67) / 2 = 29.67 ft; area depth 28.67 ft after the 1 ft allowance |
| Bay length | North 300 − 22 − 30 = 248 ft; south 300 − 22 = 278 ft; total 526 ft |
| Mix | Section 4.1 defaults |

Target widths at depth 28.67 ft: studio 20 (clamped), 1BR 25.3, 1BR + den 31.4, 2BR 38.4, 3BR 48 (clamped). Weighted width 30.4 ft. `N` = 526 / 30.4 = 17.3, so 17 units.

| Type | Count | Width (ft) | Area each (sf) |
|---|---|---|---|
| Studio | 2 | 20.0 | 573 |
| 1BR | 7 | 25.3 | 725 |
| 1BR + den | 2 | 31.4 | 900 |
| 2BR | 5 | 38.4 | 1,100 |
| 3BR | 1 | 48.0 | 1,376 |

Widths sum to 520 ft. The repair pass stretches the last units by 6 ft in total. Expected result: 17 units, NRSF about 15,100 sf, efficiency about 77 percent. The test case accepts 17 ± 1 units and efficiency between 0.74 and 0.79.

### 5.7 Worked example B — hotel bar

| Input | Value |
|---|---|
| Plate | 240 × 60 ft rectangle, GSF 14,400 sf |
| Corridor | Bar, 6 ft |
| Stairs | Two at the ends, 11 ft of bay length on both sides |
| Core and back-of-house | Guest elevators 16 ft on the south side; service elevator and back-of-house 24 ft on the north side |
| Run depth | 27 ft; area depth 26 ft |
| Bay length | North 240 − 22 − 24 = 194 ft; south 240 − 22 − 16 = 202 ft; total 396 ft |
| Mix | King 60%, double queen 30%, suite 5%, accessible one per floor |

Weighted width about 14.9 ft. `N` = 396 / 14.9 = 26.6, so 26 keys: 16 king, 8 double queen, 1 suite, 1 accessible. Widths sum to 383.5 ft; the repair pass stretches the kings and double queens by 12.5 ft in total. Expected result: 26 keys, NRSF about 10,100 sf, efficiency about 70 percent. The test case accepts 26 ± 1 keys and efficiency between 0.68 and 0.72.

---

## 6. Live metrics

| Metric | Meaning |
|---|---|
| Units by type | Count per type, for the level and for the building (level × group floor count). |
| Mix | Share per type against the target share, and the difference in units. |
| NRSF, GSF, efficiency | Per level and for the building. |
| Average unit area | NRSF divided by the unit count. |
| Corner units | Count of units with two exposures. |
| Exposures | Units facing N, E, S, and W. |
| Corridor | Total length, and length per unit. |
| Stair doors | Corridor path distance between the two stair doors. Reported only. |
| Dead ends | Longest corridor length beyond the last stair door. Reported only. |
| Support pockets | Count and area of concave corner pockets and support blocks. |
| Flags | Units outside their area range, oversize units, mix misses. |
| Hotel: keys per floor | Keys on the level, and keys within 150 ft of corridor travel from a housekeeping closet (150 ft is editable). |

---

## 7. Viewing and editing

- Plan view first: an orthographic top view in the same Three.js scene. Axon and the elevation views stay available.
- Model style: white plates with unit lines. Diagram style: units colored by type with a legend. Use the tower colors for programs and add one color per unit type.
- Click a unit to select it. The selection card shows the type, width, area, flags, and a lock toggle. Change the type from the card.
- Drag a bay line along the facade. Snap to 0.5 ft. The two neighbors change width. The tool refuses a drag that takes a neighbor below its minimum width.
- Lock a unit. A locked unit keeps its outline and type through re-fill.
- Re-fill: recomputes every unlocked unit from the mix.
- Level groups: a list on the Site tab. "Apply to group" copies the fill to every level in the group.
- Compare view: two to four saved options side by side, with the metrics table. Reuse the tower compare code.
- Help panel: a short page for teammates with the area rule, the fill rule in five lines, and the export list.

---

## 8. Exports

| Export | Content |
|---|---|
| Rooms CSV | One row per unit: `level_index, level_name, unit_id, type, area_sf, cx, cy, z, nrsf, exposures, corner, bay_from, bay_to`. A header comment holds the placement (x, y, rotation, baseZ). Coordinates are in the plate frame. A pyRevit script places rooms at `(cx, cy)` on each level. |
| DXF | R12, like the site tool. Layers `UNIT-LINE` (demising lines), `CORRIDOR`, `CORE`, `STAIR`, `SUPPORT`, `TEXT` (type and area at each centroid). |
| SketchUp JSON | One group per unit, extruded to the level floor-to-floor height. Tags by type with the type colors. Reuse `makeDoc` in `src/shared/sketchup-format.js`. |
| Screenshot | The view plus the metrics overlay. Add the mix table as metric rows. |
| Notes Markdown | The area rule, the corridor type and width, the mix targets, and the metrics. |
| Project file | The `plates` section (section 9). |

---

## 9. Project file contract

File: `name.cmrlm.json`. Spec: `docs/project-file-spec.md`. The Plate Planner reads only `derived` blocks of other sections. It writes only its own section and leaves every other byte unchanged.

Read from `sections.massing.derived`:

```js
{ footprint: MultiPoly, height,
  levels: [{ index, name, zone, z, ftf, program, plates: MultiPoly, core: Ring|null, spines: [[[x,y],[x,y]],…],
             seeds: [{ kind: "stair" | "exterior-stair" | "elevator", outer: Ring }] }],   // seeds is optional
  metrics }
// Frame: site-centered, x = east, y = north, feet. MultiPoly = [{ outer, holes }], outer counter-clockwise.
```

Write to `sections.plates`:

```js
{ tool: "plate", schema: 1, updatedAt,
  placement: { x, y, rotation, baseZ },     // copied from sections.massing.placement; zeros without a project
  state,                                     // this tool's own full state; no other tool reads it
  derived: {
    mode: "multifamily" | "hotel",
    massingUpdatedAt,                        // the massing updatedAt the fill was made from
    levels: [{
      index, plate: MultiPoly, corridor: MultiPoly,
      core: { outer, stairs: [{ id, outer, door: [x,y] }], elevators: [{ id, outer }] },
      support: [{ id, outer, kind }],
      units: [{ id, type, outer, area, exposures: ["N","E","S","W"], corner: bool,
                bay: { from, to },           // feet along the facade ring, counter-clockwise from its first vertex
                ring: 0,                     // 0 = outer ring, k = hole ring k (optional, default 0)
                demising: [[[x,y],[x,y]], [[x,y],[x,y]]] }],   // the two cut lines (optional)
      metrics: { units, nrsf, gsf, efficiency }
    }],
    mix: [{ type, count, share, avgArea }],
    metrics: { units, nrsf, gsf, efficiency, corridorFt }
  } }
```

Handoff: the tower's "Send to Plate Planner" saves the project to `localStorage` under `cmrlm.project.<id>` and opens `../plate/?project=<id>`. The Plate Planner autosaves its section one second after each change. When the massing `updatedAt` is newer than `massingUpdatedAt`, show "The massing changed after this fill" with a re-fill button. The tool also works with no project.

---

## 10. Module contracts

Pure ES modules. No DOM, no Three.js, no hidden state, no mutation of inputs. Clipper through `globalThis.ClipperLib` at `SCALE = 1000`. Plan coordinates `(x, y)`, north = +y.

```js
// src/plate/mix.js
export const MULTIFAMILY_TYPES;   // section 4.1, [{ id, name, widthMin, widthMax, targetArea, areaMin, areaMax, share, color }]
export const HOTEL_TYPES;         // section 4.2, same fields; suite has bays: 2
export function normalizeMix(types, shares)                  // → [{ type, share }], shares sum to 1
export function targetWidth(type, depth)                     // → ft, clamp(targetArea / depth, widthMin, widthMax)
export function countsForLength(mix, types, lengthFt, depth) // → { n, counts: { [type]: n } }, largest remainder
export function scoreFill(units, mix)                        // → { byType: [{ type, count, share, target, diff }], misses }

// src/plate/corridor.js
export function spineFromPlate(plate, { kind, side, core, spines })  // kind: "bar" | "single" | "point" → [[[x,y],[x,y]],…]
export function corridorFromSpine(spine, widthFt, plate)              // → MultiPoly, clipped to the plate
export function corridorMetrics(spine, stairs)                        // → { totalFt, stairPathFt, deadEnds: [{ stairId, ft }] }

// src/plate/fill.js
export function unitZone(plate, corridor, core, stairs, support)      // → MultiPoly
export function runsFromZone(zone, plate, corridor)                   // → [{ ring, edge, from, to, depth, band: MultiPoly, corners: { start, end } }]
export function cutRun(run, counters, types, { extWall, locks })      // → [{ type, from, to, outer, area, flags }]
export function fillLevel(plate, options)                             // → one level object of section 9
  // options: { mode, types, mix, corridor: { kind, width, side, spine }, core, stairs, support,
  //            extWall, cornerType, locks: [{ id, outer, type }] }

// src/plate/exports.js
export function roomsCsv(derived, placement)       // → string
export function plateDxf(derived)                  // → string, DXF R12
export function plateSketchup(derived, meta)       // → doc from makeDoc()
export function notesMarkdown(derived, options)    // → string
```

Every function throws a clear error when an input is missing, and names the input.

---

## 11. Test cases

Module tests under `test/plate.*.test.mjs`, plus the same cases in the page under `?test`.

| # | Case | Expect |
|---|---|---|
| 1 | Example A, 300 × 65 bar | 17 ± 1 units; each type within 1 unit of its count; efficiency 0.74–0.79 |
| 2 | Example B, 240 × 60 hotel bar | 26 ± 1 keys; efficiency 0.68–0.72 |
| 3 | Short bar 120 × 65 | No unit below its minimum width; no overlaps; units + corridor + core + stairs + pockets = plate area within 1 sf |
| 4 | L plate 200 × 140, 60 ft arms | One wrap corner unit with legs from the formula; one support pocket; a two-segment spine |
| 5 | U plate 200 × 140, 60 ft arms | Two corner units, two pockets, three-segment spine, dead ends reported |
| 6 | Point tower 90 × 90, 30 × 30 core, ring corridor | Four corner units; exposures in all four directions |
| 7 | Donut plate 200 × 200 with a 100 × 100 hole | Units on both rings; hole units carry `ring: 1` |
| 8 | Mix that cannot fit: 3BR 100 percent on a 60 ft run | One oversize or short unit with flags; no error |
| 9 | Locks | Lock two units, re-fill; the locked outlines and types do not change |
| 10 | Project round trip | Read a massing level, fill, write `plates`, read again; every other section is deep-equal to the input; placement matches the massing |
| 11 | Determinism | The same inputs give byte-equal output twice |
| 12 | Circle plate, 100 ft diameter | Units are polygons; the area sum matches the unit zone within 1 sf |

---

## 12. Build plan

| Phase | Work | Model | Reason |
|---|---|---|---|
| 1 | Technical plan from these notes | Opus | Trade-offs and contracts need judgment. |
| 2 | `mix.js` and `corridor.js` with tests | Sonnet | The rules are clear and small. |
| 3 | `fill.js` with tests 1–12 | Opus | Corner and pocket geometry hides errors. |
| 4 | Shell: panel, plan view, level groups, selection, bay drag, locks, compare | Sonnet | Standard web and Three.js code; copy the tower shell. |
| 5 | Exports | Sonnet | The formats already exist in the site and tower tools. |
| 6 | Presets and test data | Haiku | Simple and repetitive. |
| 7 | Review of the fill math against examples A and B by hand | Opus | Finds calculation errors. |
| 8 | Mac and iPad test | Cade | Only Cade can judge the feel. |

---

## 13. Risks

| Risk | Effect | Response |
|---|---|---|
| Irregular plates | Odd unit shapes, wrong counts | Polygon-clip every unit. Flag units outside their range. Let the user lock and fix by hand. |
| The mix cannot fit | Counts miss the targets | Report the miss per type. Suggest a wider width range. Never fail silently. |
| The core blocks the corridor | No path between stairs | Warn, then move the core as the tower does (nearest fit on a 25 × 25 grid). |
| Massing changes after the fill | Stale units | Store `massingUpdatedAt`; warn and offer re-fill. |
| iPad performance | Slow drags | The fill runs in milliseconds. Re-fill on drag end, not during the drag. |
| Area convention disputes | Numbers that teammates question | One setting, stated in every export. |

---

## 14. Decisions (October 22, 2026)

Cade answered the open questions. The home session builds the Plate Planner (the work session does not).

1. **Area rule:** measure units to the centerline of demising walls, to the corridor face of the corridor wall, and to the inside face of the exterior wall. The corridor wall thickness (default 0.5 ft, editable) counts in the unit, not in the corridor. Section 3.5 changes to match.
2. **Stairs:** at the corridor ends by default for bar plates.
3. **Unit mix:** the section 4.1 default shares, fully editable (shares, widths, and areas per type).
4. **Hotel suite:** one key, two bays.
5. **Podium levels:** out of the fill by default.
