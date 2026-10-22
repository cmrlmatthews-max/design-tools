# Grading Sketch — Technical Plan

Version 0.1 · October 22, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Source: `grading-sketch-concept.md` v0.1 with the decisions in its section 12, including decisions 13 to 17 that Cade accepted on October 22, 2026.

This plan is the instruction set for the build phases. Each build agent gets this plan, the concept, and `docs/project-file-spec.md`.

Caution: the Grading Sketch is a sketch for early coordination with the civil engineer. It is never a grading plan. Every volume, slope, and wall height in this plan is a design-stage estimate.

---

## 1. Scope and decisions

### 1.1 Decisions that bind the build

| # | Decision | Source |
|---|---|---|
| 1 | Both visual styles with one toggle: white model and the cut and fill map | Concept 12.1 |
| 2 | Feet, square feet, and cubic yards only | Concept 12.2 |
| 3 | Ground: the Site Model grid, or a typed plane with the same spacing rule | Concept 12.3 |
| 4 | Earthwork on the ground grid, with the accuracy stated in the panel and the notes | Concept 12.4, change 1 |
| 5 | Daylight slopes 3:1 fill and 2:1 cut by default, editable, with a Caution line | Concept 12.5 |
| 6 | Drawn walls, plus automatic walls at the property line | Concept 12.6 |
| 7 | Route limits 1:20, 1:12, 1:48, and 30 in per ramp run; the tool never says "compliant" | Concept 12.7 |
| 8 | The tool never edits another section's placement; it publishes FFEs in its own section | Concept 12.8 |
| 9 | Users are Cade and RJTR teammates; a short Help panel | Concept 12.9 |
| 10 | Generic names only; no client, street, or district names | Concept 12.10 |
| 11 | The project file is part of version 1 | Concept 12.11 |
| 12 | A sketch, never a grading plan | Concept 12.12 |
| 13 | Pad depth 1.0 ft below the FFE by default | Decision 13 |
| 14 | Pad offset 5 ft past the footprint by default | Decision 14 |
| 15 | Automatic walls on by default; drawn dashed until accepted | Decision 15 |
| 16 | Bulking factor 1.00 (off) by default | Decision 16 |
| 17 | Lots: 2 percent along, 1 percent across by default; warnings below 1 percent and above 5 percent | Decision 17 |

### 1.2 Changes from the concept

1. **Earthwork uses a sub-cell midpoint rule.** Each grid cell splits into `k × k` sub-cells (default `k = 4`, so 2.5 ft at 10 ft spacing). The tool evaluates the proposed and the existing ground at each sub-cell center. The concept's corner average on the node grid moves every pad edge by up to half a cell. For example B1 it gives 1,244.4 cy each way (+15 percent). The midpoint rule gives the exact 1,083.3 cy when the edges fall on 2.5 ft lines.
2. **One surface function.** `proposedAt(x, y)` evaluates the proposed ground at any point. The grid nodes, the earthwork samples, the routes, and the walls all call it. The concept sampled routes on the node grid by bilinear interpolation; the function is exact and costs the same.
3. **Pad-to-pad steps become walls.** Where two pads with different tops touch, the tool adds an automatic wall of kind `pad-step` along the shared edge, accepted by default. The wrap preset needs it ("two FFEs, one wall").
4. **Balance mode.** `balance: "pad"` (default) balances cut and fill inside the tier's pad only. On a plane this gives the mean existing elevation, as concept example A states. `balance: "site"` includes the daylight slopes.
5. **Slope conflicts.** Where two features need slopes that cannot meet (the fill limit of one is above the cut limit of the other), the proposed ground takes the midpoint and the tool raises a `slope-conflict` warning with the location. The fix is a wall or more distance.
6. **Auto wall placement.** The auto wall sits on the property line inset by the offset. Where that line falls inside a feature, the wall sits on the feature edge instead.
7. **The typed-plane grid is square.** Its side covers every feature plus a 200 ft margin. Spacing and point count follow the Site Model rule (`gridSpacing`), so the grid stays at 10,000 points or fewer.
8. **The garden preset has a lot but no drive.** The drive adds no new rule and makes the hand numbers long. The drive rule has its own module tests.
9. **Example A on the grid.** The grid gives cut 325.1 cy and fill 348.2 cy. The concept's closed form, 326.0 and 345.2, left out the short ends. Both numbers appear in section 8.1.

### 1.3 Reuse

| Reused verbatim (shared modules) | Copied and changed (Facade Studio parts) | New |
|---|---|---|
| `src/shared/storage.js`, `screenshot.js`, `sketchup-format.js`, `project.js` | `build/facade/shell.html`, `body.html`, `css_add.css`, `build.py` | `src/grading/surface.js`, `features.js`, `walls.js` |
| `src/site/geo.js` `gridSpacing` (the spacing rule) | `00_imports.js` to `03b_store.js` | `src/grading/earthwork.js`, `routes.js`, `contours.js` |
| `src/site/exports.js` `triangulate` (pad faces in SketchUp) | `06_render.js`, `06b_select.js` (plan drawing and vertex handles) | `src/grading/derived.js`, `exports.js`, `sketchup.js` |
| `src/tower/prompts.js` (prompt library data; grading fields added in the page) | `07_controls.js`, `08_ui.js`, `08b_prompts.js`, `08c_sketchup.js`, `08e_help.js` | `src/grading/presets.js`, `testcases.js` |
| | `09_storage.js`, `09b_project.js`, `10_screenshot.js`, `11_compare.js`, `12_tests.js`, `13_start.js` | |

Tests build site sections with `siteDerived` (`src/site/derived.js`) from a small synthetic model, and massing sections with `assemble` plus `midriseDerived`, as the Facade Studio tests do.

---

## 2. State schema

All lengths are feet. Areas are square feet. Volumes are cubic yards. Elevations are NAVD88 feet with a site, or local feet without one. Plan coordinates `(x, y)` are in the project frame: east = +x, north = +y.

```jsonc
{
  "schema": 1,
  "name": "Option A",
  "source": "standalone",                // "standalone" | "project"

  "ground": {
    "mode": "plane",                     // "site" (sections.site.derived.ground) | "plane"
    "plane": { "z0": 1000, "slope": 5, "downhill": 180 },   // z at (0, 0); percent; bearing the ground falls toward (0 = north, clockwise)
    "margin": 200                        // plane grid: feature extent plus this on every side
  },

  "property": { "mode": "site", "ring": [] },   // "site" = the site square (or the plane grid edge); "drawn" = ring

  "buildings": [
    {
      "id": "B1", "name": "Bar",
      "source": "typed",                 // "typed" | "massing" | "parking"
      "outer": [[-150, -32.5], [150, -32.5], [150, 32.5], [-150, 32.5]],   // typed only; project frame
      "axis": "auto",                    // "auto" (long side of the minimum bounding rectangle) | degrees
      "tiers": [ { "length": null, "ffe": "balance" } ],   // length null = equal split; ffe "balance" | number (FFE, ft)
      "padOffset": 5,                    // decision 14
      "padDepth": 1.0                    // decision 13
    }
  ],
  "balance": "pad",                      // "pad" | "site" (change 4)
  "maxStep": 4,                          // ft between tiers

  "drives": [],    // [{ "id": "D1", "line": [[x,y],…], "width": 24, "start": "existing" | number, "slope": 5, "cross": 2, "crown": true }]
  "lots": [],      // [{ "id": "L1", "ring": [[x,y],…], "anchor": null | [x,y], "start": "existing" | number, "dir": 0, "slope": 2, "cross": 1 }]
  "walls": [],     // [{ "id": "W1", "line": [[x,y],…], "kind": "drawn" }]
  "autoWalls": { "on": true, "offset": 5, "accepted": [] },   // decision 15; accepted = auto wall ids
  "routes": [],    // [{ "id": "R1", "line": [[x,y],…], "name": "Entry walk" }]

  "daylight": { "on": true, "fill": 3, "cut": 2 },   // Caution: soil decides stable slopes; these are starting values
  "limits": {                            // Caution: 2010 ADA Standards and ICC A117.1 values; the adopted code decides
    "walk": 0.05, "ramp": 0.0833, "cross": 0.0208, "rampRise": 2.5,
    "wallFlag": 4,                       // ft; walls above this flag
    "lotMin": 0.01, "lotMax": 0.05, "driveMax": 0.10   // decision 17; Caution: fire access grades are set locally
  },
  "earthwork": { "subdivide": 4, "bulking": 1.00 },   // decision 16

  "view": {
    "style": "model",                    // "model" | "cutfill"
    "contours": { "on": true, "interval": 1, "existing": true, "proposed": true },
    "exaggeration": 1,                   // 1 | 2 | 3 | 5
    "section": null,                     // [[x,y],[x,y]] section line, or null
    "context": true, "grid": false, "figure": true, "shadows": true,
    "sun": { "azimuth": 135, "altitude": 40 }
  }
}
```

**Default state:** preset "Bar on a cross slope" (section 8.1).

**Storage:** key `grading.options.v1`, schema 1, through `createStorage`. The store deep-merges a loaded state over the default state. `migrate` returns the state unchanged for schema 1.

---

## 3. Grading pipeline

```
state (+ project) → existing grid → features (pads, drives, lots) → walls (drawn, pad-step, auto)
      → proposedAt → balance and tiers → proposed grid → earthwork → routes → wall heights
      → contours → metrics → derived
```

Every step is a pure function. Clipper runs only to build pads and tier strips, at `SCALE = 1000`. Coordinates round to 0.001 ft, elevations to 0.01 ft, volumes to 0.1 cy. The same inputs always give the same result.

### 3.1 Step 1 — Existing ground

- **Site mode:** read `sections.site.derived.ground`: `{ spacing, n, points }`, row-major from the south, `points[j * n + i] = [x, y, z]` in the project frame. `existingAt(x, y)` is bilinear on that grid, clamped to its edge (the same rule as `buildGround().at`).
- **Plane mode:** `existingAt(x, y) = z0 − (slope ÷ 100) × (x sin b + y cos b)`, with `b` = `downhill` in degrees. Check: slope 5, downhill 180 gives `z0 + 0.05 y` (rising north).
- **Plane grid:** take the bounding box of every footprint, drive, lot, and route, plus `margin` on each side. Side `S` = the larger box dimension. `{ spacing: d, n } = gridSpacing(S)`. Origin `x0 = floor((cx − S ÷ 2) ÷ d) × d`, the same for `y0`. If the grid misses the box, add one node per side. Nodes `(x0 + i d, y0 + j d)`.
- Without a site the project frame is `local` and `z0` defaults to 1,000.

### 3.2 Step 2 — Footprints

| Source | Footprint in the project frame |
|---|---|
| typed | `outer` |
| massing | the outer rings of `massing.derived.footprint`, through `transformRing(massing, ring, "toProject")` |
| parking | the outer ring of the plate of the lowest parking level (lowest `z`), through `transformRing(parking, ring, "toProject")` |

Courtyard holes are part of the pad. A building that lies inside another building's footprint (a deck inside a wrap) is listed first (section 3.5).

A massing whose tool is `tower` with no `derived.levels` gives no footprint. The tool shows "The Tower Generator does not write massing levels yet." and the warning `tower-no-levels`.

### 3.3 Step 3 — Tiers and pads

- **Axis:** "auto" = the direction of the longer side of the minimum-area bounding rectangle (rotating calipers on the convex hull). A number sets it in degrees.
- **Tier strips:** project the footprint on the axis: from `s0` to `s1`, length `Ls`. Equal tiers split it evenly. Typed lengths run from `s0`; the last tier takes the rest. Each strip is an infinite band across the axis.
- **Pad of tier k** = `offset(footprint, padOffset, miter) ∩ strip_k`. Adjacent tiers share their cut line, so pads never overlap within a building. The end tiers extend past `s0` and `s1` by the offset through the offset footprint.
- **Pad top** = FFE − `padDepth`.

### 3.4 Step 4 — Drives and lots

Caution: drive and lot grades are design values for a sketch. The fire marshal and the local code set fire access grades. Verify every grade with the civil engineer.

- **Drive:** polyline `line`, `width`. For a point, find the nearest segment. Station `s` (ft from the start) and signed offset `r` (positive to the right of the travel direction). Inside when `|r| ≤ width ÷ 2` and the projection falls on the polyline (the ends are square). Start elevation `zs` = the number, or `existingAt(line[0])` for "existing". Centerline `zc = zs + (slope ÷ 100) × s`. Crowned: `z = zc − (cross ÷ 100) × |r|`. One-way: `z = zc − (cross ÷ 100) × r` (falls to the right).
- **Lot:** polygon `ring`. Anchor `a` = `anchor` or the ring centroid. `za` = the number, or `existingAt(a)`. Uphill unit vector `u = (sin dir, cos dir)`; left unit vector `v = (−cos dir, sin dir)`. `z = za + (slope ÷ 100)(p − a)·u + (cross ÷ 100)(p − a)·v`.
- The tool warns when a lot slope is under `lotMin` or over `lotMax`, and when a drive slope is over `driveMax`.

### 3.5 Step 5 — The surface function

`proposedAt(x, y)`:

1. **Pads.** The first pad that contains the point (boundary included, 1e-6 ft) returns its pad top. Order: buildings in list order, tiers in order.
2. **Drives**, in list order, then **lots**, in list order: the first that contains the point returns its plane.
3. **Daylight** (when `daylight.on`; otherwise return `existingAt`). For each feature `f` (every pad, drive, and lot): the nearest point `q` on its boundary, distance `d`, edge elevation `e = f.z(q)`. Skip `f` when a wall blocks it (below). Limits `lo_f = e − d ÷ fill`, `hi_f = e + d ÷ cut`. Combine: `lo = max lo_f`, `hi = min hi_f` (the stricter limit wins). If no feature is left, return `existingAt`. If `lo > hi`, set both to `(lo + hi) ÷ 2` and record a `slope-conflict` (change 5). Return `min(max(existingAt, lo), hi)`.
4. **Wall test:** extend the segment from `p` to `q` by 0.01 ft past `q` (so a wall drawn on the feature edge counts). A wall blocks `f` when that segment properly crosses any wall segment.

Checks (example A, plane 5 percent rising north, pad top 1,000 on `y` from −32.5 to 32.5):

| Point | Existing | Proposed | Reason |
|---|---|---|---|
| (0, −35) | 998.25 | 999.167 | Fill limit 1,000 − 2.5 ÷ 3 |
| (0, −40) | 998.00 | 998.00 | Beyond the toe at 5.735 ft |
| (0, 35) | 1,001.75 | 1,001.25 | Cut limit 1,000 + 2.5 ÷ 2 |

Performance: features keep their bounding boxes. A feature farther than its reach `R = (maxZ − minZ of the grid) × max(fill, cut) + d` cannot clamp a point, so the loop skips it.

### 3.6 Step 6 — Walls

Caution: walls over about 4 ft often need an engineered design, a permit, and a guard. Verify every wall with the civil and structural engineers.

- **Drawn walls:** `state.walls`.
- **Pad-step walls:** walk every pad edge and sample 0.01 ft outside it every 1 ft. Where that point belongs to another pad (first wins, section 3.5) whose top differs by more than 0.05 ft, the stretch is a pad-step wall, kind `pad-step`, always accepted (change 3). Each stretch counts once. This finds tier cut lines and a deck pad inside a wrap pad.
- **Auto walls** (when `autoWalls.on`): sample the property line every 1 ft. Where `|proposedAt − existingAt| > 0.05 ft`, the daylight leaves the site. Join flagged stretches with gaps under 10 ft. Place each wall on the property line inset by `offset`; where that inset line falls inside a feature, use the feature edge (change 6). Ids `A1`, `A2`, … in boundary order. Then rebuild the surface once with the walls. Unaccepted auto walls act on the surface and draw dashed (decision 15).
- **Height:** every 1 ft along the wall, `h = |proposedAt(p + 0.01 n) − proposedAt(p − 0.01 n)|`, with `n` the wall normal. Report `heightMax`, `heightAvg`, `length`, and the top line `[x, y, max of the two sides]`. Flag walls over `wallFlag`.

### 3.7 Step 7 — Balance and stepping

- **Balanced FFE (one tier, `ffe: "balance"`):** bisection on the pad top `t`, from `min − 1` to `max + 1` of the existing ground under the pad. `g(t)` = fill − cut, over the sub-cells that the tier's pad owns under the first-wins rule (`balance: "pad"`), or over the whole grid (`balance: "site"`). `g` rises with `t`. Stop when the bracket is under 0.01 ft (about 10 iterations). Round to 0.01. FFE = `t + padDepth`.
- With several balancing tiers and `balance: "site"`, solve the tiers in order, then repeat the pass once.
- **Stepping suggestion:** sample the existing ground along the axis centerline of the footprint. Rise = the end-to-end difference (or the max minus min when larger). Tiers = `ceil(rise ÷ maxStep)`. Equal lengths, each balanced. The panel shows the result; "Apply" writes it to the building.
- **Per tier:** FFE above existing at each footprint corner (`ffe − existingAt`); exposed foundation = max of `padTop − proposedAt` just outside the pad (0.01 ft), on pad edges that touch no other pad; cut face = the max of the reverse.

### 3.8 Step 8 — Proposed grid and earthwork

Caution: grid earthwork compares options. It is not a quantity takeoff. Expect about ±5 to 10 percent against a civil surface model, more where edges fall between samples.

- **Proposed grid:** `proposedAt` at every node of the existing grid. It feeds the mesh, the contours, the Revit CSV, and `derived.ground`.
- **Earthwork (change 1):** for each grid cell, `k × k` sub-cells of side `h = d ÷ k`. At each sub-cell center `c`: `v = (proposedAt(c) − existingAt(c)) × h²`. Positive `v` adds to fill, negative to cut. Divide cubic feet by 27.
- **Skip rule:** a cell outside every feature box grown by one cell, with its four corners unchanged (difference under 0.001 ft), adds nothing.
- **Disturbed area:** the sum of sub-cell areas with `|proposed − existing| > 0.1 ft`.
- **Net** = fill − cut (positive = import). **Bulked net** = fill − cut × `bulking`. **Balance** = min(cut, fill) ÷ max(cut, fill); 1.00 when both are 0.

Exactness: when every feature edge lies on a 2.5 ft line and the surface is linear inside each sub-cell, the midpoint rule is exact. Example B1 shows it: `k = 4` gives 1,083.3 cy; `k = 1` gives 1,000.0 cy; the concept's corner average gives 1,244.4 cy.

### 3.9 Step 9 — Routes

Caution: route limits come from the 2010 ADA Standards and ICC A117.1. The adopted code and its amendments decide. The tool reports slopes; it never says "compliant".

- Sample each route every 1 ft along its length on `proposedAt`.
- **Running slope** at station `s` = `|z(s + 5) − z(s)| ÷ 5` (the last 5 ft use `s − 5`).
- **Cross slope** at `p` = `|z(p + 2.5 n) − z(p − 2.5 n)| ÷ 5`.
- **Class per sample:** walk when running ≤ `walk`; ramp when ≤ `ramp`; fail above. Any sample with cross slope over `cross` is a fail.
- **Ramp rise:** each run of consecutive ramp samples whose rise exceeds `rampRise` raises `ramp-landing` ("needs a landing").
- Route kind in `derived` = "walk" when every sample is a walk, else "ramp".

### 3.10 Step 10 — Contours

Marching squares on the node grid, interval `view.contours.interval` (1 or 2 ft), for the existing and the proposed grids. Every fifth contour is major. Segments join into polylines by shared end points (0.001 ft). The zero contour of `proposed − existing` is the cut and fill line. The contours refine 2× near features: inside every feature box grown by 20 ft, the tool runs marching squares on a half-spacing grid of `proposedAt`.

### 3.11 Step 11 — Metrics

| Metric | Formula |
|---|---|
| Cut, fill, net, balance, bulked net | Section 3.8 |
| Pad area | Σ pad areas (Clipper) |
| FFE per tier | FFE; above or below existing at each corner |
| Steps | `|FFE_k+1 − FFE_k|` between adjacent tiers; warning over `maxStep` |
| Walls | count, total length, max and average height; drawn, pad-step, and auto counted apart |
| Routes | steepest running and cross slope each |
| Drives and lots | slope each; warnings per section 3.4 |
| Disturbed area | Section 3.8 |
| Warnings | `slope-conflict`, `wall-height`, `step`, `lot-slope`, `drive-slope`, `ramp-landing`, `route-fail`, `tower-no-levels`, `outside-site` (a pad, drive, or lot past the property line) |

HUD values round volumes to 10 cy (concept risk 1). The expanded panel shows 0.1 cy.

### 3.12 Step 12 — Derived writer

`gradingDerived(state, built, metrics)` writes the concept section 14 shape:

- `ffe[]`: one per tier: `id` (`"<building id>-T<k>"`, with building ids `massing`, `parking`, or the typed id), `source`, `tier`, `outer` (the tier footprint, project frame), `ffe`, `padTop`, `existingMin`, `existingMax`.
- `ground`: `{ spacing, n, points }` of the proposed grid, rounded to 0.01 ft, same nodes as the existing grid.
- `walls[]`: `{ id, kind, line (top, [x, y, z]), heightMax, heightAvg, length, auto, accepted }`.
- `routes[]`: `{ id, kind, line ([x, y, z] every 5 ft), maxSlope, maxCross }`.
- `metrics`: `{ cutCy, fillCy, netCy, balance, bulkedNetCy, wallLength, wallHeightMax, wallHeightAvg, padArea, disturbedArea, steepestRoute }`.

---

## 4. Module contracts

Pure ES modules. No DOM, no Three.js, no hidden state, no mutation of inputs. One-line relative imports only. Every export starts a line with `export function` or `export const`.

```js
// src/grading/surface.js
export function planeGround(plane)                          // → (x, y) => z
export function gridFromSite(siteDerivedGround)             // → Grid { spacing, n, x0, y0, nodes: Float64Array (n·n·3), at(x, y) }
export function gridForPlane(state, extentBox)              // → Grid (section 3.1)
export function existingSurface(state, project)             // → { grid, at, source: "site"|"plane", notes }
export function makeSurface(features, walls, existingAt, daylight)   // → { at(x, y), conflicts: [{ x, y }] } (section 3.5)

// src/grading/features.js
export function footprints(state, project)                  // → [{ id, source, name, outer, axis }] project frame (section 3.2)
export function tierPads(building, existingAt, { balance })   // → [{ id, tier, outer, pad, padTop, ffe, existingMin, existingMax }] (section 3.3)
export function driveFeature(drive, existingAt)             // → { id, kind: "drive", ring, contains(x, y), z(x, y), slope }
export function lotFeature(lot, existingAt)                 // → { id, kind: "lot", ring, contains(x, y), z(x, y), slope, cross }
export function balanceTier(padRing, existingAt, padDepth, sampler)   // → { padTop, ffe, iterations } (section 3.7)
export function suggestTiers(building, existingAt, maxStep)  // → { count, lengths, rise }
export function buildGrading(state, { project = null, quality = "full" } = {})
  // → { source, grid, existingAt, surface, buildings, tiers, features, walls, conflicts, warnings, notes }
  // quality "draft": k = 1 earthwork and no contour refinement while a handle moves

// src/grading/walls.js
export function padStepWalls(tiers)                          // → Wall[] kind "pad-step"
export function autoWalls(state, surface, propertyRing, features)   // → Wall[] kind "auto" (section 3.6)
export function wallStats(wall, surfaceAt)                  // → { heightMax, heightAvg, length, top: [[x, y, z], …] }
export function blocks(walls, p, q)                         // → boolean (section 3.5, item 4)

// src/grading/earthwork.js
export function earthwork(built, { subdivide = 4, bulking = 1, region = null } = {})
  // → { cutCy, fillCy, netCy, bulkedNetCy, balance, disturbedArea, cellsSampled }
export function proposedGrid(built)                         // → Float64Array of n·n proposed z

// src/grading/routes.js
export function routeProfile(route, surfaceAt, limits)      // → { samples: [{ s, x, y, z, running, cross, cls }], maxSlope, maxCross, kind, warnings }

// src/grading/contours.js
export function contours(grid, zValues, interval, { majorEvery = 5 } = {})   // → [{ z, major, line: [[x, y], …] }]
export function zeroLine(grid, diffValues)                  // → [[[x, y], …]] the cut and fill line

// src/grading/metrics.js  (owned with earthwork; see section 10)
export function computeMetrics(state, built)                // → every row of section 3.11
export function checks(state, metrics)                      // → Warning[] { code, severity, where, message }

// src/grading/derived.js
export function gradingDerived(state, built, metrics)       // → grading.derived (section 3.12)

// src/grading/exports.js
export function revitCsv(built)                             // → "x,y,z\n" per proposed node, 3 decimals, no header
export function gradingDxf(state, built, metrics)           // → DXF R12 text
export function notesMarkdown(state, built, metrics, meta)  // → string with the earthwork table and every Caution

// src/grading/sketchup.js
export const SKETCHUP_SOURCE = "grading";
export function gradingToSketchup(state, built, metrics, meta)   // → doc from makeDoc(): groups Proposed ground (soft mesh), Existing ground (hidden tag),
                                                                  //   Pads (faces), Walls (solids 1 ft thick from the low side to the top), Routes (lines)

// src/grading/presets.js
export const PRESETS            // [{ id, name, description, state }] section 8
export function defaultState()

// src/grading/testcases.js
export const TEST_CASES         // [{ id, state, expect: { padTops?, cutCy?, fillCy?, netCy?, wallMax?, exposed?, tolerance } }]
```

**DXF layers** (R12, AC1009, feet, project frame, like `src/site/exports.js`): `GRD-EXIST-MINOR`, `GRD-EXIST-MAJOR`, `GRD-PROP-MINOR`, `GRD-PROP-MAJOR` (contours as 3D polylines at their z), `GRD-PAD` (pad outlines at pad top), `GRD-WALL` (3D polyline of the top), `GRD-WALL-TEXT` (top and bottom elevations at each end and at the max), `GRD-CUTFILL` (the zero line), `GRD-DRIVE`, `GRD-LOT`, `GRD-ROUTE`, `GRD-SPOT` (spot elevations at pad corners, drive ends, route ends), `GRD-TEXT` (title and the earthwork table).

**SketchUp:** `zShift` brings the lowest proposed point to 0, as the Site Model export does. The notes in the doc state the shift.

`buildGrading` is the only function that reads the project. Every other module reads its result.

---

## 5. Interface

### 5.1 Tabs

Same panel, tabs, and top bar as the Facade Studio. Tab order: Buildings, Site work, Checks, View.

- **Buildings tab:** source card (standalone or the open project, with notes); ground card (site or plane: z0, slope, downhill); one card per building: tiers (count, equal or typed lengths), FFE per tier (balance or a typed elevation to 0.01 ft), pad offset, pad depth, axis, and the stepping suggestion with "Apply". A tier table shows FFE, pad top, the step to the next tier, and the height above existing at each corner.
- **Site work tab:** property line (site or drawn), drives, lots, walls, routes. Each list has Add (starts drawing), Edit, and Delete. Auto walls list with Accept per wall.
- **Checks tab:** daylight ratios, route limits, wall flag, lot and drive limits, bulking, sub-cells, each with its Caution line. The earthwork table.
- **View tab:** style (model or cut and fill), contours (on, interval, existing, proposed), exaggeration, section line ("Draw section"), context, grid, figure, shadows, sun.

### 5.2 Top bar

Option menu (presets, Save, Duplicate, Rename, Delete, Compare), Undo, Redo, Model/Cut-fill, Export menu (Image, AI-ready image, AI Prompts, SketchUp, Revit CSV, DXF, Notes, Export JSON, Import JSON), Project menu (New, Open, Import, Export), Help.

HUD, always visible: cut, fill, net, tallest wall. One tap expands balance, pad area, disturbed area, the tier table, routes, and the warning list.

### 5.3 Drawing and handles

- **Draw** in the plan view: tap points; tap the last point again (or press Enter) to finish; Escape cancels. A lot and a property line close themselves.
- **Snap:** 1 ft grid, pad edges and corners, the property line, drive ends. Option skips snapping.
- **Edit:** select a drive, lot, wall, or route; drag a vertex; Delete removes the selection.
- **Section:** "Draw section" takes two points. A 2D panel under the view shows the existing (dashed) and proposed (solid) profiles every 1 ft, the pads, and the walls, with elevations.
- Mac shortcuts: 1 to 6 views, D Model/Cut-fill, W draw wall, R draw route, Escape clears.

### 5.4 iPad

Same bottom sheet as the Facade Studio in portrait. Handles 44 points or larger. FFE fields accept typed elevations.

---

## 6. Rendering

- **Ground:** one indexed mesh from the proposed grid, refined 2× inside feature boxes (section 3.10). Model style: white, matte. Exaggeration scales `z − minZ`.
- **Existing ground:** a light gray wireframe, toggled with the existing contours.
- **Cut and fill map:** vertex colors from `proposed − existing`: fill blue, cut red, five steps each (0 to 1, 1 to 2, 2 to 4, 4 to 8, over 8 ft), a legend in the HUD.
- **Pads:** a thin outline at pad top; buildings as simple extrusions (one story) at FFE for scale.
- **Walls:** boxes 1 ft thick from the low side to the top; auto walls unaccepted draw dashed and translucent. Labels with the max height.
- **Routes:** tubes colored per sample class (green, amber, red).
- **Contours:** lines, existing dashed and proposed solid; major lines heavier.
- **Context:** site neighbors, roads, and trees, as in the Site Model.
- **Draft quality** while a handle moves: `k = 1` and no refinement; full quality on release.
- **Target:** a 96 × 96 grid, 4 buildings, 6 tiers, 4 drives and lots, 6 walls, full update under 100 ms on an iPad.

---

## 7. Project file

Follows `docs/project-file-spec.md`.

- **Start:** `projectIdFromUrl` → `loadProject`. Load `sections.grading.state` when present. With a site, `ground.mode = "site"`. With a massing or a parking section, add those buildings (sources `massing` and `parking`) when the state has none.
- **Reads:** `site.derived.ground`, `boundary`, `roads`, `buildings`; `massing.derived.footprint` and `massing.placement`; `parking.derived.levels` and `parking.placement`.
- **Write:** `writeSection(doc, "grading", { tool: "grading", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state, derived })`, debounced 1 s, plus `visibilitychange` and `pagehide`.
- **Size:** the proposed grid adds about 250 KB at 10,000 points. The writer stays under the spec's 4 MB rule with the site section.

**Spec edits (the integrator makes them in `docs/project-file-spec.md`):**

1. Section 4, after the `baseZ` bullet, add: "The ground-floor FFE of a massing or a deck is `sections.grading.derived.ffe` when that section exists and holds a tier for that source (`source` = `massing` or `parking`; the lowest tier when there are several). Otherwise it is `placement.baseZ`. The Grading Sketch never edits another section's placement."
2. Section 6.7: replace "Reserved" with the shape in section 3.12, a note that `ground` uses the same nodes as `site.derived.ground` (or the plane grid without a site), and that elevations are NAVD88 feet with a site.
3. Section 12, Tower Generator list: add "Export menu: Send to Grading Sketch (`sendTo(storage, doc, "grading", "tower")`)."

**Send items (the integrator adds them):** "Send to Grading Sketch" in the Site Model (`build/site/04_ui.js`, next to the other Send buttons), the Mid-Rise and the Parking Deck Export menus (`ProjectUI.send('grading')`), and the Facade Studio Export menu. Each opens `../grading/?project=<id>`. The Workspace card for the Grading Sketch opens `grading/`.

**SketchUp source:** add `"grading"` to `validateDoc` in `src/shared/sketchup-format.js`, to `sketchup/cmrlm_design_tools/importer.rb`, and to `docs/sketchup-spec.md`; rebuild the `.rbz`.

---

## 8. Presets

Phase 6 (Haiku) types these values into `src/grading/presets.js`. Unless a preset says otherwise: plane `z0` 1,000; daylight on, 3:1 and 2:1; `balance` "pad"; `subdivide` 4; bulking 1.00; auto walls on. "Grid" values come from the section 3.8 method at `k = 4` on a 10 ft grid. Every footprint below sits on 2.5 ft lines unless noted, so the pad volumes are exact.

### 8.1 Bar on a cross slope (default; concept example A)

| Item | Value |
|---|---|
| Ground | plane, slope 5, downhill 180 (rises north) |
| Building | B1 typed rect 300 × 65 at x −150 to 150, y −32.5 to 32.5; one tier, balance; `padOffset` 0 |

Existing at the south face 998.375, at the north face 1,001.625. Balanced pad top = the mean = **1,000.00**; FFE **1,001.00**. Pad volumes: 0.5 × 32.5 × 1.625 × 300 = 7,921.9 cf = **293.4 cy** each way (exact). Closed form with the long-side slopes only: cut 326.0, fill 345.2. **Grid: cut 325.1, fill 348.2, net +23.1, balance 0.934.** FFE above existing: south corners +2.625, north corners −0.625.

Variant **8.1-wall** (test only): a drawn wall on the south pad edge, (−150, −32.5) to (150, −32.5). Wall height **1.625** (max and average within 0.01). **Grid: cut 325.1, fill 296.9, net −28.2.** The fill keeps the pad and the short ends.

Variant **8.1-site** (test only): `balance` "site". Pad top **999.97**; grid cut 336.9, fill 335.5; |fill − cut| ≤ 2 cy.

### 8.2 Long bar, one FFE (concept example B1)

| Item | Value |
|---|---|
| Ground | plane, slope 4, downhill 270 (rises east) |
| Building | B1 rect 300 × 65, x −150 to 150; one tier, balance; `padOffset` 0 |
| Daylight | off |

Rise along the bar 0.04 × 300 = 12 ft. Pad top **1,000.00**, FFE **1,001.00**. Cut = fill = 0.5 × 150 × 6 × 65 = 29,250 cf = **1,083.3 cy** (grid exact). Exposed foundation at the west end **6.0 ft**; cut face at the east end **6.0 ft**. At `k = 1` the grid gives 1,000.0 each way (test of the method).

### 8.3 Long bar, three tiers (concept example B2)

Same ground, bar, and daylight. Three equal tiers (the stepping suggestion: `ceil(12 ÷ 4) = 3`). Pad tops **996.00, 1,000.00, 1,004.00**; FFEs 997, 1,001, 1,005; steps **4.0 and 4.0** (at the maximum, no warning). Cut = fill = 3 × 0.5 × 50 × 2 × 65 = 9,750 cf = **361.1 cy** (grid exact). Exposed foundation **2.0 ft**. Two pad-step walls of **4.0 ft** at x = −50 and 50.

### 8.4 Garden buildings on a falling site

| Item | Value |
|---|---|
| Ground | plane, slope 6, downhill 180 |
| Buildings | three typed rects 192 × 66 (the Mid-Rise garden bar) at x −96 to 96, centered on y −120, 0, 120; one tier each, balance; `padOffset` 5 (pads 202 × 76) |
| Walls | drawn on each south pad edge, y = yc − 38, x −101 to 101 |
| Lot | L1 rect x 130 to 290, y −150 to 150; anchor the centroid (210, 0), start "existing" (1,000.00); `dir` 0, slope 2, cross 1 |

Pad tops **992.80, 1,000.00, 1,007.20** (the mean under each pad); FFEs 993.80, 1,001.00, 1,008.20. Wall heights **2.28** each (0.06 × 38). Pad volumes, closed form: 0.5 × 38 × 2.28 × 202 = 8,750.9 cf = 324.1 cy per bar each way, 972.3 cy for three. **Grid: 937.5 cy each way** (the 101 ft and 38 ft half-sizes fall between 2.5 ft samples; −3.6 percent, the stated edge error). Lot: `diff = −0.04 y − 0.01 (x − 210)`; cut = fill = half of ∫∫|diff| = (2 × 80 × 0.04 × 150² + (0.01² ÷ 0.04) × 2 × 80³ ÷ 3) ÷ 2 = 72,426.7 cf = **2,682.5 cy** (grid 2,682.4, edges aligned). **Whole preset, grid: cut 4,208.7, fill 4,312.3, net +103.7.** Lot slope 2 percent: no warning.

### 8.5 Wrap with a deck on a slope

| Item | Value |
|---|---|
| Ground | plane, slope 5, downhill 180 |
| Buildings, in this order | B1 "Deck" typed rect 300 × 125 centered, one tier, FFE typed **997.875** (pad top 996.875 = existing at the deck's south face, y = −62.5); B2 "Wrap" typed rect 450 × 275 centered, one tier, balance; both `padOffset` 5 |

The deck pad (310 × 135) lies inside the wrap pad (460 × 285) and wins there (section 3.5). Wrap pad top **1,000.00** (the ring is symmetric about y = 0); FFE 1,001.00. One pad-step wall around the deck pad: length 2 × (310 + 135) = **890 ft**, height **3.125 ft**. Pads only: ring cut = fill = (460 × 0.05 × 142.5² − 310 × 0.05 × 67.5²) ÷ 2 = 198,210.9 cf = 7,341.1 cy; deck net cut 3.125 × 41,850 = 130,781.3 cf; deck fill wedge 0.5 × 5 × 0.25 × 310 = 193.8 cf. **Pads only: cut 12,192.1, fill 7,348.3.** **Whole preset, grid: cut 13,359.7, fill 9,219.3, net −4,140.4** (export).

### 8.6 Podium with retail at the low street

| Item | Value |
|---|---|
| Ground | plane, slope 8, downhill 180 |
| Building | B1 typed rect 300 × 200 centered, one tier, FFE typed **992.60** (pad top 991.60 = existing at the south pad edge, y = −105); `padOffset` 5 (pad 310 × 210) |
| Wall | drawn on the north pad edge, (−155, 105) to (155, 105) |

Wall height **16.80 ft** (flagged over 4 ft). Pad: all cut, 310 × 8.4 × 210 = 546,840 cf = **20,253.3 cy** (exact). End slopes (2:1 cut against ground level along x): 2 × ∫ (8.4 + 0.08 y)² dy = 2 × 16.8³ ÷ (3 × 0.08) = 39,513.6 cf = 1,463.5 cy. **Whole preset, grid: cut 21,998.9, fill 0** (the rest is the two corner cones past the wall ends). Without the wall: cut 26,032.5.

### 8.7 Flat site

Plane slope 0; B1 typed rect 310 × 75 centered, balance. Pad top **1,000.00**, FFE 1,001.00. Cut **0**, fill **0**, balance 1.00, no walls.

---

## 9. Tests

### 9.1 Module tests (`test/grading.*.test.mjs`, run by `npm test`)

| # | File | Case | Expect |
|---|---|---|---|
| 1 | surface | `planeGround` slope 5 downhill 180 at (0, 10); slope 4 downhill 270 at (10, 0) | 1,000.5; 1,000.4 |
| 2 | surface | `gridForPlane` for preset 8.1 | spacing 10, n 71, origin (−350, −350) |
| 3 | surface | `gridFromSite` on a 3 × 3 synthetic site ground | `at` of the center cell = the bilinear value |
| 4 | surface | Preset 8.1 points of section 3.5 | 999.167, 998.00, 1,001.25 (0.001) |
| 5 | surface | Two pads, tops 1,000 and 1,006, 20 ft apart, flat ground 1,000; the midpoint | 1,002.667 (the higher pad's fill limit wins) |
| 6 | surface | Two pads, tops 1,000 and 1,010, 10 ft apart | Midpoint 1,005.417; one `slope-conflict` |
| 7 | walls | Preset 8.1-wall: the point (0, −35) | Existing 998.25 (blocked) |
| 8 | walls | Wall heights: 8.1-wall, 8.6, 8.4 | 1.625, 16.80, 2.28 (0.01) |
| 9 | walls | Auto walls: preset 8.1 with a drawn property line, x ±200 and y ±36 | Two auto walls, one on each long pad edge (the inset line falls inside the pad); height 1.625 at x = 0 |
| 10 | features | Tier strips of preset 8.3 | Three pads, 100 ft each, sharing cut lines; no overlap |
| 11 | features | `balanceTier` on 8.1 and 8.2 | 1,000.00 each, 10 iterations or fewer |
| 12 | features | `suggestTiers` on 8.2 | count 3, rise 12.0 |
| 13 | features | Drive (0, 0) → (0, 100), start 1,000, slope 5, width 24, cross 2: crowned at (10, 50) and (−10, 50); one-way at (10, 50) and (−10, 50) | 1,002.3, 1,002.3; 1,002.3, 1,002.7 |
| 14 | features | Lot of preset 8.4 at (210, 150) and (130, 0) | 1,003.0; 1,000.8 |
| 15 | earthwork | Presets 8.2 and 8.3 | 1,083.3 and 361.1 each way (0.1); 8.2 at `k = 1`: 1,000.0 |
| 16 | earthwork | Presets 8.1, 8.1-wall, 8.1-site | Section 8.1 grid values (0.5 cy) |
| 17 | earthwork | Presets 8.4, 8.5, 8.6, 8.7 | Section 8 grid values (1 percent); 8.7 exactly 0 |
| 18 | earthwork | Bulking 1.20 with cut 100, fill 80 | Bulked net −40 |
| 19 | routes | Plane 5 percent rising north: a route (0, 0) → (0, 100); the same on 6 and 9 percent | walk; ramp with `ramp-landing` (6 ft rise); fail |
| 20 | routes | A route along x on a 3 percent plane rising north | Cross slope 0.03; fail |
| 21 | contours | A 100 × 100 grid of a 5 percent plane rising north, interval 1 | Straight lines; the 1,001 line at y = 20 |
| 22 | metrics | Exposed foundation and corner heights, presets 8.1, 8.2, 8.3 | +2.625 and −0.625; 6.0; 2.0 |
| 23 | derived | Preset 8.1 through `gradingDerived`, `writeSection`, `validate` | Valid; `ffe` id `B1-T1`; `ground.points.length = n²` |
| 24 | exports | Revit CSV of preset 8.1 | 71² lines, 3 decimals, no header |
| 25 | exports | DXF of preset 8.6 | Every layer; the wall text holds 1,008.40 and 991.60 |
| 26 | exports | SketchUp doc of preset 8.5 | `validateDoc` passes; source `grading`; `zShift` brings the minimum to 0 |
| 27 | exports | Notes of preset 8.1 | The earthwork table and every Caution line |

Every test that fixes a number writes the arithmetic in a comment. Grid values come from section 8; the tests state the tolerance next to each.

### 9.2 In-page tests (`grading/index.html?test`)

- Shell: the default state builds; the HUD shows cut 330, fill 350, net +20 (rounded to 10 cy), tallest wall 0.
- Every preset loads with its section 8 values.
- Drawing: a wall drawn by four taps on the south edge of preset 8.1 changes the fill to 296.9.
- Tiers: "Apply" on the stepping suggestion of preset 8.2 gives preset 8.3's numbers.
- Project: a fixture project with a synthetic site and the Mid-Rise `double-bar` massing → source "project" → one building `massing` with the massing footprint in the project frame; a tower project with no levels shows the note.
- Exports: SketchUp doc validates; CSV, DXF, notes, and JSON download.

### 9.3 Cade's live checks

1. Open each preset on the Mac. Compare the HUD with section 8.
2. On the iPad, split preset 8.2 into three tiers; watch the cut and the exposed foundation fall.
3. Site Model → Send to Grading Sketch on a real sloped site; balance the FFE; draw a wall and a route.
4. Import the Revit CSV as a toposolid in Revit 2026; link the DXF; check one wall height against the section view.

---

## 10. Build phases and file ownership

Phases 2 to 6 run in parallel. Each agent owns only its files.

| Phase | Model | Agent | Owns | Acceptance checks |
|---|---|---|---|---|
| 1 | Opus | Orchestrator | This plan | Cade's go |
| 2 | Opus | Surface | `src/grading/surface.js`, `features.js`, `walls.js`, tests 1 to 14 (`test/grading.surface.test.mjs`) | Tests pass; clamps, wall sides, and tier pads checked by hand |
| 3 | Sonnet | Earthwork | `src/grading/earthwork.js`, `routes.js`, `contours.js`, `metrics.js`, tests 15 to 22 (`test/grading.earthwork.test.mjs`) | Tests pass; section 8 grid values reproduce (a hand surface fixture of planes and rectangles until phase 2 lands, then the real `buildGrading`) |
| 4 | Sonnet | Exports | `src/grading/derived.js`, `exports.js`, `sketchup.js`, tests 23 to 27 (`test/grading.exports.test.mjs`) | Doc validates; derived validates |
| 5 | Sonnet | Page | everything under `build/grading/`, `grading/index.html` (through its build) | Section 9.2 tests pass; screenshots at 1440 × 900 and 820 × 1180 |
| 6 | Haiku | Presets | `src/grading/presets.js`, `testcases.js` | Every preset loads; values match section 8 |
| 7 | Opus | Integrator and reviewer | `package.json` scripts, `README.md`, `index.html` Workspace card, Send items in `build/site`, `build/midrise`, `build/parking`, `build/facade`, spec edits (section 7), SketchUp `grading` source, `docs/suite-roadmap.md` | `npm test` green; all in-page tests green; ten hand volumes and wall heights checked |
| 8 | Cade | — | — | Section 9.3 |

**Interfaces:** section 4 fixes every signature. The page agent codes against them and reports problems; it does not edit `src/`. The earthwork agent reads the surface through `buildGrading(...).surface.at` and `existingAt`; until phase 2 lands it uses a fixture with the same shape. The page registers every module in `build/grading/build.py` MODS in import order (shared `project.js` and `sketchup-format.js` first; `src/site/geo.js` for `gridSpacing`; `src/site/exports.js` for `triangulate`).

**Integrator edits outside the grading folders:**

1. Send items: `build/site/04_ui.js` (a "Send to Grading Sketch" button beside the other two, and `projectSend` accepts `grading`), `build/midrise/08_ui.js` and `09b_project.js`, `build/parking/08_ui.js` and `09b_project.js`, `build/facade/08_ui.js` and `09b_project.js`, each with its in-page test.
2. `index.html`: the Grading Sketch card opens `grading/`.
3. Spec edits 1 to 3 and the SketchUp source (section 7).
4. `package.json`: `build:grading`, `test:grading`, and `test:grading` in `npm test`.

---

## 11. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| Teammates read the volumes as a takeoff | Cost or schedule decisions on sketch numbers | Caution lines in the panel, the screenshot block, and the notes; HUD rounds to 10 cy |
| Edges between samples | Volumes off by a few percent (preset 8.4: −3.6 percent on the pads) | Stated accuracy; `subdivide` can rise to 8; tests use grid values |
| A wall drawn on the wrong side or through a pad | Wrong heights and volumes | The wall blocks by geometry only; the section view shows the result; tests 7 and 8 |
| Slope conflicts between close features | A ridge or a pit | Midpoint plus a `slope-conflict` warning with a marker; the fix is a wall |
| Steep sites where the daylight never meets the ground | A slope that runs to the grid edge | Auto walls at the property line; the `outside-site` warning |
| The USGS ground differs from a survey | FFEs off by a foot or more | The notes name the ground source and date; a survey surface is a later version |
| Other tools still read `placement.baseZ` | Two floor elevations for one building | The spec rule (section 7, edit 1) tells readers to prefer `grading.derived.ffe`; the Facade Studio and the Parking Deck adopt it when they next change |
| iPad performance on a 96 × 96 site | Slow drags | Draft quality (`k = 1`, no refinement) during a drag; feature reach skips far features |

Open items:

1. Curved walls, drives, and lots arrive as straight segments. A later version can add arcs.
2. A survey surface (LandXML or a CSV of points) can replace the USGS ground later.
3. Storm water, utilities, and soil remain out of scope (concept 2.2).
4. The Tower Generator joins when the work session adds `towerDerived` and the Send item (spec section 12).
