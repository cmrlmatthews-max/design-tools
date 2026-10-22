# Grading Sketch — Concept Document

Version 0.1 · October 22, 2026 · Owner: Cade (CMRLM)

---

## 1. Purpose

The Grading Sketch is a browser tool for fast grading studies. It sets the project buildings on the real ground and shows how much earth moves as you change the floor elevations.

The tool is for conceptual design only. It does not replace Civil 3D, a grading plan, or the civil engineer. It replaces the first hours of guessing finished floor elevations on a contour map and adding up cut and fill by hand.

**Main goal:** Go from a massing on a real site to two or three believable floor elevation options, with cut, fill, and wall heights, in less than 15 minutes.

**Users:** Cade and RJTR teammates. All names in presets, tests, and notes are generic. No client names. No street or district names.

Terms used in this document:

| Term | Meaning |
|---|---|
| FFE | Finished floor elevation. The elevation of the top of the ground floor slab, in NAVD88 feet. |
| Pad | The flat area of earth under a building. Its top is the FFE minus the pad depth. |
| Pad depth | The slab plus the stone base under it. Default 1.0 ft. |
| Cut | Earth removed, where the proposed ground is below the existing ground. |
| Fill | Earth added, where the proposed ground is above the existing ground. |
| Daylight slope | The graded slope that ties a pad, a drive, or a lot back into the existing ground. "3:1" means 3 ft across for 1 ft up or down. |
| Tier | One part of a long building with its own FFE. A building that steps down a slope has two or more tiers. |
| Exposed height | The height of a wall or a foundation face above the proposed ground on its low side. |

Atlanta sites slope. RJTR garden, wrap, and podium projects often step their floors across a site. The tool makes the step decision early and puts a number on it.

The tool covers three cases:

| Case | Where the ground comes from |
|---|---|
| Site project | The `site` section written by the Site Model: the USGS ground grid in NAVD88 feet. |
| Project without a site | A plane you type: an elevation, a slope in percent, and the downhill direction. |
| Standalone | The same typed plane, with a typed building footprint. |

---

## 2. Scope

### 2.1 Version 1 includes

- The project buildings on the ground: the massing footprint, the parking footprint, and the site neighbors as context.
- One FFE per building, or several tiers with their own FFEs.
- Pads, drives, and parking lots with target slopes and cross slopes.
- Daylight slopes that tie the proposed ground back to the existing ground.
- Retaining walls drawn as lines, plus automatic walls where a daylight slope leaves the site.
- Accessible routes drawn as lines, with their slopes checked.
- Live metrics: cut, fill, net, balance, wall length and heights, route slopes, pad area, FFE against grade.
- A stepping suggestion: the tiers that balance cut and fill within a maximum step.
- Presets, saved options, the compare view, screenshots, AI-ready images, and the prompt library.
- Exports: Revit CSV of the proposed ground, DXF, SketchUp JSON, notes Markdown, and the project file section.
- Use on a Mac browser and on an iPad. Hosting on GitHub Pages.

### 2.2 Version 1 does not include

- Storm water design: pipes, inlets, ponds, or drainage areas.
- Utility design and inverts.
- Soil data, shrink and swell, rock, or topsoil stripping. One optional bulking factor covers this roughly.
- Wall design: footings, geogrid, or wall type selection.
- Road design: vertical curves, superelevation, or sight distance.
- Curved walls. A curved wall is drawn as straight segments.
- Multi-user access.

---

## 3. Form system

### 3.1 Basic model

The tool works on one ground grid. The proposed ground starts equal to the existing ground. The tool then "burns in" each feature in a fixed order. Each burn-in sets the proposed elevation of the grid nodes inside the feature. The daylight slopes then blend the features back into the existing ground.

The grid is the same grid the Site Model writes: about 10 ft spacing, 10,000 points or fewer. A 1,000 ft site uses 10.5 ft spacing and 96 points per side. Every number in the tool comes from this grid, so the model, the metrics, and the Revit CSV agree.

### 3.2 Buildings and tiers

Each project building becomes one grading building:

| Source | Footprint | Default FFE |
|---|---|---|
| Massing | `massing.derived.footprint`, placed in the project frame | The balanced FFE (section 3.7) |
| Parking deck | The ground level plate of `parking.derived` | The deck entry elevation, from the balanced FFE |
| Standalone | A typed rectangle, L, or U | The balanced FFE |

A building has one tier by default. You split a building into tiers along its long axis:

| Control | What it does | Default |
|---|---|---|
| Tier count | Number of tiers along the long axis | 1 |
| Tier lengths | Equal, or typed per tier | Equal |
| FFE per tier | Typed, or "balance" for each tier | Balance |
| Step between tiers | Shown live; a warning above the maximum step | Maximum 4 ft |
| Pad offset | The pad extends past the footprint by this distance | 5 ft |
| Pad depth | FFE minus the pad top | 1.0 ft |

Caution: a step between tiers changes the building, not only the ground. A 4 ft step needs stairs or a ramp inside the building and a stepped slab. Confirm every step with the design team.

### 3.3 Drives and parking lots

You draw a drive as a centerline with a width. You draw a lot as a polygon.

| Control | Drive | Lot |
|---|---|---|
| Start elevation | Typed, or snapped to a pad or a road | Typed, or snapped to a pad edge |
| Target slope | Along the centerline; default 5 percent, maximum warning 10 percent | Along a direction you set; default 2 percent |
| Cross slope | Default 2 percent, crowned or one-way | Default 1 percent |
| Width | Default 24 ft | — |

The drive surface is a set of planes, one per centerline segment. The lot surface is one plane through its start point with its slope and cross slope.

Caution: drive and lot slopes are design values for a sketch. Local codes and the fire marshal set maximum grades for fire access roads. Verify every grade with the civil engineer and the fire marshal.

### 3.4 Daylight slopes

Outside every feature, the proposed ground ties back to the existing ground at a daylight slope.

| Side | Default | Range |
|---|---|---|
| Fill (proposed above existing) | 3:1 | 2:1 to 6:1 |
| Cut (proposed below existing) | 2:1 | 1.5:1 to 6:1 |

The tool picks the side for each node from the sign of the difference. A grid node far from every feature keeps the existing elevation.

Caution: stable slopes depend on the soil. 2:1 and 3:1 are common starting values, not a geotechnical recommendation.

### 3.5 Retaining walls

A retaining wall is a line where the proposed ground jumps. The wall replaces the daylight slope on its side.

- **Drawn walls:** draw a polyline. The tool holds the proposed ground on the feature side and the existing ground on the other side, up to the wall line.
- **Auto walls:** when a daylight slope would leave the site boundary, the tool adds a wall at the boundary minus an offset you set (default 5 ft). An auto wall shows in a dashed style until you accept it.
- **Wall height:** at each point along the wall, the exposed height is the difference between the proposed ground on its two sides.

The tool labels the maximum and the average exposed height on each wall.

Caution: walls taller than about 4 ft often need an engineered design, a permit, and a guard at the top. The tool flags walls over a height you set (default 4 ft). Verify every wall with the civil and structural engineers.

### 3.6 Accessible routes

You draw an accessible route as a polyline: a walk from a building door to a sidewalk, a parking space, or another door. The tool samples the proposed ground along it every 1 ft.

| Check | Default limit | Meaning |
|---|---|---|
| Running slope, walk | 1:20 (5 percent) | Above this, the route is a ramp |
| Running slope, ramp | 1:12 (8.33 percent) | Above this, the route fails |
| Cross slope | 1:48 (2.08 percent) | Measured across the route on the proposed ground |
| Ramp rise | 30 in per run | One ramp run rises 2.5 ft at most between landings |

The route line turns green (walk), amber (ramp), or red (fails) along its length.

Caution: these limits come from the 2010 ADA Standards and ICC A117.1. The adopted code and the local amendments decide. The tool reports slopes; it never says "compliant".

### 3.7 Balanced FFE and stepping

The balanced FFE makes the cut equal the fill under a pad.

- For one tier, the tool finds the pad top elevation where cut equals fill inside the pad. On a plane, this is the mean existing elevation under the pad.
- With the daylight slopes on, the tool repeats the search with the slopes included. Ten iterations of a bisection reach 0.01 ft.
- **Stepping suggestion:** the tool finds the fewest tiers with steps no greater than the maximum step. Tiers = ceiling of (existing rise along the long axis ÷ maximum step). Each tier then gets its own balanced FFE.

The suggestion is a starting point. You can accept it, change it, or ignore it.

---

## 4. Site and zoning

### 4.1 Site boundary

- With a site project, the boundary is the Site Model site square.
- A property line polygon can replace it. Draw it, or type the corner points.
- The tool warns when a pad, a drive, a lot, or a daylight slope crosses the property line.

### 4.2 Context

- The site neighbors, roads, and trees show as context. They are never graded.
- The road centerlines from the site give the default start elevation for a drive that meets them.

### 4.3 Typed ground

Without a site section, the ground is a plane:

| Control | Default |
|---|---|
| Elevation at the origin | 1,000.0 ft |
| Slope | 5 percent |
| Downhill direction | South (180 degrees) |
| Grid size | The massing extent plus 200 ft each side, 10 ft spacing |

The typed plane makes the worked examples and the tests exact.

---

## 5. Live metrics

The metrics panel updates on every change. Four stay visible: cut, fill, net, and the tallest wall. One tap expands the rest.

| Metric | Meaning |
|---|---|
| Cut | Volume of earth removed, cubic yards |
| Fill | Volume of earth added, cubic yards |
| Net | Fill minus cut. Positive means import; negative means export |
| Balance | The smaller of cut and fill divided by the larger. 1.00 is a perfect balance |
| Bulked net | Net with the optional bulking factor on the cut (default 1.00, off) |
| Pad area | Sum of all pad areas, square feet |
| FFE per tier | The FFE, and its height above or below the existing grade at each pad corner |
| Steps | Each step between tiers, against the maximum |
| Walls | Count, total length, maximum exposed height, average exposed height |
| Routes | The steepest running slope and cross slope on each route |
| Drives and lots | The steepest slope on each |
| Disturbed area | Area where the proposed ground differs from existing by more than 0.1 ft |

**Units:** feet, square feet, and cubic yards. One cubic yard is 27 cubic feet.

### 5.1 Earthwork accuracy

Caution: the earthwork uses the grid-cell prism method on a 10 ft grid. At this spacing, expect about plus or minus 5 to 10 percent against a civil surface model. Use the numbers to compare options, not to price earthwork.

---

## 6. Viewing

- Orbit, pan, and zoom with a mouse, a trackpad, or touch.
- Preset views: axonometric, four elevations, plan, and a section cut you place.
- Existing ground in gray. Proposed ground in white.
- Cut and fill map: cut in red, fill in blue, shaded by depth. A legend shows the scale.
- Contours of the existing ground (dashed) and the proposed ground (solid). Interval 1 ft or 2 ft.
- Wall heights as labels along each wall. Spot elevations at pad corners, drive ends, and route ends.
- Vertical exaggeration: 1×, 2×, 3×, or 5×, as in the Site Model.
- Section view: a cut line you drag in plan shows the existing and proposed ground, the pads, and the walls in one elevation.

---

## 7. Screenshots

- Export the current view as a PNG image.
- Optional metrics block, with the earthwork table as a second option.
- Optional title, date, and CMRLM mark.
- AI-ready image and the prompt library, as in the other tools. The grading prompts describe the terraces, the walls, and the landscape, so an image tool keeps the ground form.

---

## 8. Options and saving

- Save an option with a name, for example "Option B — three tiers, 4 ft steps."
- Saved options stay in the browser under their own storage key.
- Export and import all options as a JSON file.
- Duplicate an option. Compare two to four options side by side, with the earthwork table.
- The project file carries the current option to the other tools (section 14).

**Caution:** Browser storage can clear when you clear the browser data. Export the JSON file to keep a backup.

---

## 9. iPad use

- Controls are large enough for a finger. Handles are 44 points or larger.
- Sliders also accept typed numbers. FFEs accept typed elevations to 0.01 ft.
- Drawing a wall, a drive, a lot, or a route: tap points, then tap the last point again to finish.
- The layout changes for portrait and landscape. Portrait uses the bottom sheet.
- Add the tool to the iPad Home Screen as a web app.

---

## 10. Technical approach

| Item | Choice | Reason |
|---|---|---|
| File structure | One HTML file, `grading/index.html`, built from parts in `build/grading/` | Same as the other tools |
| Shell | Copy of the Facade Studio shell | Newest shell with the project file wired in |
| 3D library | Three.js, same version as the other tools | One version across the toolkit |
| Ground mesh | One indexed mesh from the grid, colors per vertex for the cut and fill map | Fast to update; 10,000 points stay smooth |
| Polygons | clipper-lib 6.4.2 | Same rules as the other tools |
| Build step | `python3 build/grading/build.py` | Same as the other tools |
| Performance target | A 96 × 96 grid, 4 buildings, 6 tiers, 4 drives and lots, 6 walls, full update under 100 ms on an iPad | Covers a large garden site |

### 10.1 Grading algorithm

The heart of the tool. The same inputs always give the same result.

1. **Ground.** Read the existing grid from `site.derived.ground`, or build it from the typed plane. Grid nodes are `(x, y, z)` in the project frame.
2. **Features.** Place each building footprint in the project frame with the massing placement. Build each pad: footprint offset by the pad offset, top at FFE minus pad depth.
3. **Pads.** For each node inside a pad, proposed = pad top.
4. **Drives and lots.** For each node inside a drive or a lot (and outside every pad), proposed = the feature plane at that node.
5. **Daylight.** For each node outside every feature, find the nearest feature edge and its edge elevation `e` at the nearest point. With distance `d`, the fill limit is `e − d ÷ fillRatio` and the cut limit is `e + d ÷ cutRatio`. Proposed = existing, clamped between those two limits.
6. **Walls.** A wall line splits the daylight. A node on the far side of a wall from a feature keeps the existing elevation. Wall height at each sample = the absolute difference of the proposed ground on its two sides.
7. **Auto walls.** Where the daylight from step 5 changes a node outside the property line, add a wall at the boundary offset. Rerun steps 5 and 6.
8. **Earthwork.** For each grid cell, average the four corner differences (proposed − existing), times the cell area. Sum positive values as fill and negative values as cut. Divide cubic feet by 27.
9. **Routes.** Sample each route on the proposed surface every 1 ft. Running slope = rise ÷ run between samples 5 ft apart. Cross slope = the slope across the route at each sample, 2.5 ft each side.
10. **Balance and stepping.** Section 3.7.

Step 5 uses the nearest feature edge only. Where two features are near each other, the clamp takes the tighter limit from both. This keeps the surface continuous between a pad and a drive.

### 10.2 Worked example A — a bar on a cross slope

| Input | Value |
|---|---|
| Building | Mid-Rise bar, 300 × 65 ft, long axis east–west |
| Ground | Typed plane, 5 percent slope rising to the north across the 65 ft depth |
| Pad | Offset 0 ft (for this example), depth 1.0 ft |
| Daylight | 3:1 fill, 2:1 cut |

Let the existing ground at the south face be `z0`. It rises 0.05 × 65 = 3.25 ft to the north face.

**Balanced pad.** The pad top is the mean existing elevation: `z0 + 1.625`. The FFE is `z0 + 2.625`.

**Under the pad.** The south half is fill and the north half is cut. Each half is a wedge 32.5 ft wide and 1.625 ft deep at its edge, along 300 ft.

| Part | Calculation | Volume |
|---|---|---|
| Fill under the pad | 0.5 × 32.5 × 1.625 × 300 = 7,921.9 cf | 293.4 cy |
| Cut under the pad | Same | 293.4 cy |

**Daylight on the long faces.** On the south side the fill slope falls 1/3 ft per ft and the ground falls 0.05 ft per ft. The gap closes at 0.333 − 0.05 = 0.283 ft per ft. On the north side the cut slope rises 1/2 ft per ft against the ground at 0.05. The gap closes at 0.45 ft per ft.

| Part | Calculation | Volume |
|---|---|---|
| South fill slope | Width 1.625 ÷ 0.283 = 5.74 ft; 0.5 × 5.74 × 1.625 × 300 = 1,399 cf | 51.8 cy |
| North cut slope | Width 1.625 ÷ 0.45 = 3.61 ft; 0.5 × 3.61 × 1.625 × 300 = 880 cf | 32.6 cy |

The short ends add a small amount. This example leaves them out.

| Total | Value |
|---|---|
| Cut | 293.4 + 32.6 = 326.0 cy |
| Fill | 293.4 + 51.8 = 345.2 cy |
| Net | 19.2 cy of fill (import) |
| Balance | 326.0 ÷ 345.2 = 0.94 |

**With a wall on the low side.** A wall along the south pad edge replaces the south fill slope. Its exposed height is 1.625 ft, about 1 ft 7 in. The fill drops to 293.4 cy, and the net becomes 32.6 cy of cut (export). A wall this short is a landscape wall, not an engineered wall.

### 10.3 Worked example B — a bar along a slope, one FFE or three tiers

| Input | Value |
|---|---|
| Building | Mid-Rise bar, 300 × 65 ft |
| Ground | Typed plane, 4 percent slope rising along the 300 ft length |
| Pad | Offset 0 ft, depth 1.0 ft |
| Daylight | Left out, so the comparison shows only the pads |

The existing ground rises 0.04 × 300 = 12 ft from the west end to the east end.

**Option B1 — one FFE.** The pad top is the mean: `z0 + 6`. The east half is cut and the west half is fill. Each half is a wedge 150 ft long, 6 ft deep at the end, and 65 ft wide.

| Item | Calculation | Value |
|---|---|---|
| Cut | 0.5 × 150 × 6 × 65 = 29,250 cf | 1,083.3 cy |
| Fill | Same | 1,083.3 cy |
| Exposed foundation at the west end | Pad top 6 ft above existing | 6 ft |
| Cut face at the east end | Existing 6 ft above the pad | 6 ft |

**Option B2 — three tiers of 100 ft.** The stepping suggestion gives tiers = ceiling(12 ÷ 4) = 3. Each tier balances at its own mean: `z0 + 2`, `z0 + 6`, and `z0 + 10`. Each step is 4 ft, at the maximum.

| Item | Calculation | Value |
|---|---|---|
| Cut per tier | 0.5 × 50 × 2 × 65 = 3,250 cf | 120.4 cy |
| Cut, three tiers | 3 × 3,250 = 9,750 cf | 361.1 cy |
| Fill, three tiers | Same | 361.1 cy |
| Exposed foundation | 2 ft at the low end of each tier | 2 ft |

| Comparison | B1 | B2 | Change |
|---|---|---|---|
| Cut | 1,083.3 cy | 361.1 cy | −67 percent |
| Fill | 1,083.3 cy | 361.1 cy | −67 percent |
| Maximum exposed foundation | 6 ft | 2 ft | −4 ft |
| Steps inside the building | 0 | 2 at 4 ft | +2 |

On a plane, `n` balanced tiers cut the earthwork to 1 ÷ `n` of one FFE. The tool shows this trade on every change: less earth and shorter walls against more steps inside the building.

---

## 11. Build plan

| Phase | Work | Model | Reason |
|---|---|---|---|
| 1 | Write the technical plan from this document | Opus | Contracts and trade-offs need judgment. |
| 2 | Build the shell: copy the Facade Studio shell, tabs, 3D view, units | Sonnet | Standard web and 3D code. |
| 3 | Build the surface: grid, pads, drives, lots, daylight clamp, walls | Opus | Nearest-edge clamps and wall splits hide sign and side errors. |
| 4 | Build earthwork, balance, stepping, and route checks | Sonnet | Sums and samples over the grid once the surface exists. |
| 5 | Build drawing tools: walls, drives, lots, routes, section line | Sonnet | Standard plan-view editing, as in the other tools. |
| 6 | Build the Revit CSV, DXF, SketchUp, notes, and the project file section | Sonnet | The formats exist in the Site Model and the other tools. |
| 7 | Make the presets and the test cases | Haiku | Simple and repetitive. |
| 8 | Review the volumes and the slopes against hand calculations | Opus | Finds calculation errors. |
| 9 | Test on the Mac and the iPad | Cade | Only you can judge the feel of the controls. |

### 11.1 Presets

| Preset | Ground | Buildings and features | Expected result |
|---|---|---|---|
| Bar on a cross slope | Plane, 5 percent across the depth | One 300 × 65 bar, one FFE | Example A: cut 326 cy, fill 345 cy |
| Long bar, one FFE | Plane, 4 percent along the length | One 300 × 65 bar | Example B1: 1,083 cy each way, 6 ft exposed |
| Long bar, three tiers | Same plane | Three tiers, 4 ft steps | Example B2: 361 cy each way, 2 ft exposed |
| Garden buildings on a falling site | Plane, 6 percent | Three garden bars, a lot, a drive | Walls on the low side |
| Wrap with a deck on a slope | Plane, 5 percent | A wrap around a deck, deck entry at the low side | Two FFEs, one wall |
| Podium with retail at the low street | Plane, 8 percent | A podium building, FFE at the low street, cut into the hill | One tall wall on the high side |
| Flat site | Plane, 0 percent | One bar | Cut and fill 0 (test) |

The technical plan computes each expected value by hand.

---

## 12. Decisions

1. **Visual style:** Both. One toggle switches between the white model and the cut and fill map.
2. **Units:** Feet, square feet, and cubic yards only.
3. **Ground:** The Site Model grid, or a typed plane. Same grid rule as the Site Model.
4. **Earthwork method:** Grid-cell prisms on the ground grid, with the accuracy stated in the panel and the notes.
5. **Daylight slopes:** 3:1 fill and 2:1 cut by default, editable, with a Caution line.
6. **Walls:** Drawn walls, plus automatic walls at the property line that you accept.
7. **Accessible routes:** 1:20, 1:12, and 1:48 by default, editable, with a Caution line. The tool never says "compliant".
8. **FFE ownership:** The tool never edits the massing placement. It publishes FFEs in its own section (section 14).
9. **Users:** Cade and RJTR teammates. A short Help panel in the tool.
10. **Names:** Generic names only in presets, tests, ids, and notes.
11. **Project file:** Part of version 1. The tool writes its section and keeps the others unchanged.
12. **Role:** A sketch for early coordination with the civil engineer. Never a grading plan.
13. **Pad depth:** 1.0 ft below the FFE by default. (October 22, 2026)
14. **Pad offset:** 5 ft past the footprint by default. (October 22, 2026)
15. **Automatic walls:** On by default; shown dashed until accepted. (October 22, 2026)
16. **Bulking factor:** 1.00 (off) by default. (October 22, 2026)
17. **Lot slopes:** 2 percent along and 1 percent across by default; warnings below 1 percent and above 5 percent. (October 22, 2026)

---

## 13. Risks

| Risk | Effect | Response |
|---|---|---|
| Teammates read the volumes as a quantity takeoff | Wrong cost or schedule decisions | Caution line in the panel, the screenshot block, and the notes. Round volumes to 10 cy in the HUD. |
| Nearest-edge clamp gives a seam between two features | A ridge or a pit in the proposed ground | Take the tighter limit from both features. Test a pad next to a drive. |
| A wall on the wrong side of a feature | Wrong wall height and wrong volumes | The wall side comes from the feature side of the line. Tests for walls on the high side and the low side. |
| The USGS ground differs from a survey | FFEs off by a foot or more | The notes say the ground source and its date. A survey surface can replace it in a later version. |
| Coarse grid misses a narrow drive | Drive slopes read wrong | Routes and drives sample the surface every 1 ft, between grid nodes, by bilinear interpolation. |
| FFEs in two places | The massing and the grading disagree | One rule: readers prefer the grading FFEs when present (section 14). |
| Lost saved work | You lose options | Export JSON backups. The project file holds the current option. |

---

## 14. Project file

The project file is the shared JSON file that carries one project between the tools. The spec is `docs/project-file-spec.md`.

**Reads:**

- `sections.site.derived.ground`: the existing grid (`spacing`, `n`, `points`), and `boundary`.
- `sections.site.derived.roads.segments` and `buildings`: context, and the start elevation for drives that meet a road.
- `sections.massing.derived.footprint` and `levels`, with `sections.massing.placement`: the building footprint in the project frame.
- `sections.parking.derived.levels`: the ground level plate of a deck.

**Writes** `sections.grading`. Its placement is the identity, because grading works in the project frame (spec section 4).

```js
{
  tool: "grading", schema: 1, updatedAt,
  placement: { x: 0, y: 0, rotation: 0, baseZ: 0 },
  state,                                   // the full Grading Sketch state
  derived: {
    ffe: [{
      id,                                  // "massing-T1", "massing-T2", "parking-T1"
      source: "massing" | "parking" | "standalone",
      tier,                                // 1, 2, … along the long axis
      outer,                               // Ring: the tier footprint, project frame
      ffe,                                 // NAVD88 ft
      padTop,                              // ffe − padDepth
      existingMin, existingMax,            // existing ground under the tier
    }],
    ground: { spacing, n, points: [[x, y, z], …] },   // proposed grid, same nodes as site.derived.ground
    walls: [{ id, line: [[x, y, z], …], heightMax, heightAvg, length, auto }],
    routes: [{ id, kind: "walk" | "ramp", line: [[x, y, z], …], maxSlope, maxCross }],
    metrics: {
      cutCy, fillCy, netCy, balance,
      wallLength, wallHeightMax, wallHeightAvg,
      padArea, disturbedArea, steepestRoute,
    },
  },
}
```

- The proposed grid uses the same nodes as the site grid, so it stays at 10,000 points or fewer (about 250 KB).
- `walls[].line` holds the top of the wall. The bottom is the proposed ground on the low side.

**Spec change for the integrator:** add section 6.7 with this shape, and one rule in spec section 4: "The ground-floor FFE of a massing or a deck is `grading.derived.ffe` when that section exists and holds a tier for that source. Otherwise it is `placement.baseZ`." The Grading Sketch never edits another section's placement.

**Handoffs:** the Mid-Rise Generator, the Parking Deck, and the Site Model get a "Send to Grading Sketch" item that opens `../grading/?project=<id>`. The Tower Generator item is a note for the work session.

**Rule:** A tool writes only its own section. It keeps every other section unchanged, including sections it does not understand.

---

## 15. Open questions for Cade

All five questions were answered on October 22, 2026. See decisions 13 to 17 in section 12.
