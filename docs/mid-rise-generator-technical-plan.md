# Mid-Rise Generator — Technical Plan

Version 0.1 · October 21, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Source: `mid-rise-generator-concept.md` v0.1 with the decisions in its section 12, plus the five defaults Cade accepted on October 21, 2026.

This plan is the instruction set for the build phases. Each build agent gets this plan, the concept, and `docs/project-file-spec.md`.

---

## 1. Scope and decisions

### 1.1 Decisions that bind the build

| # | Decision | Source |
|---|---|---|
| 1 | Both visual styles with one toggle: white model and diagram | Concept 12.1 |
| 2 | Feet, square feet, and acres only | Concept 12.2 |
| 3 | Context toggle: Site Model neighbors or simple blocks | Concept 12.3 |
| 4 | Compare view of two to four saved options | Concept 12.4 |
| 5 | Users are Cade and RJTR teammates; a short Help panel in the tool | Concept 12.5 |
| 6 | Generic names only, in presets, tests, ids, and notes | Concept 12.6 |
| 7 | The project file is part of version 1 | Concept 12.7 |
| 8 | Multifamily first; hotel and senior living are programs | Concept 12.8 |
| 9 | The deck is a placeholder box; the podium is a plate with parking counts | Concept 12.9 |
| 10 | Same plate representation as the tower | Concept 12.10 |
| 11 | Residential unit width default 28 ft | Accepted default |
| 12 | Draw the exterior stairs at each breezeway in version 1 | Accepted default |
| 13 | Wrap gap default 10 ft | Accepted default |
| 14 | Surface parking as a typed count or a drawn lot polygon, or both | Accepted default |
| 15 | A bar shorter than two unit widths warns as a sliver | Accepted default |

### 1.2 Two changes from the concept

1. **Floor-to-floor is a building setting, not a bar setting.** The concept gives each bar its own floor-to-floor. The union per level needs every bar at the same elevation. So `floors.groundFtf` and `floors.ftf` live at the building level. Each bar keeps its own floor count.
2. **Open courts are explicit objects.** A courtyard template creates a court object with a position and a size. The tool reports holes in the plate union as closed courtyards, and court objects as open courts. This rule is predictable and editable. A rule that infers courts from the plate shape gives odd results for L shapes and angled bars.

### 1.3 Reuse from the tower and the site

| Reused verbatim (shared modules) | Copied and changed (parts) | New |
|---|---|---|
| `src/tower/envelope.js` (allowed footprint, envelope checks) | `build/tower/shell.html`, `body.html`, `css_add.css` | `src/midrise/bars.js` |
| `src/tower/snap.js` (`snapMove`, `snapEdge`, `snapLength`) | `03a_state.js` (store, undo, migrate) | `src/midrise/assemble.js` |
| `src/shared/storage.js`, `screenshot.js`, `sketchup-format.js`, `project.js` | `06_render.js`, `06b_select.js` (handles for bars) | `src/midrise/units.js`, `parking.js`, `metrics.js` |
| `src/tower/prompts.js` (AI prompt library data) | `07_controls.js`, `08_ui.js`, `09_storage.js`, `10_screenshot.js`, `11_compare.js` | `src/midrise/derived.js`, `sketchup.js`, `snaptargets.js` |
| `src/tower/geometry.js` helpers: `ringArea`, `multiPolyArea`, `groupFloors` | `12_tests.js`, `13_start.js`, `build.py` | `src/midrise/presets.js`, `testcases.js` |

---

## 2. State schema

All lengths are feet. All areas are square feet. All angles are degrees. Plan coordinates `(x, y)`: north = +y, east = +x, the site is centered on the origin. Front = south.

```jsonc
{
  "schema": 1,
  "name": "Option A",
  "type": "bar",                       // template label: garden | corridor-garden | bar | courtyard | wrap | podium

  "site": {
    "shape": "rect", "width": 360, "depth": 242, "points": [],       // same keys as the tower (envelope.js reads them)
    "setbacks": { "front": 20, "back": 20, "left": 20, "right": 20 },
    "heightLimit": 0,                                                 // 0 = no limit
    "stepback": { "on": false, "aboveHeight": 85, "distance": 15 },
    "densityCap": 0,                   // units per acre; 0 = no cap
    "openSpaceShare": 0,               // 0 to 1; 0 = no rule
    "separationMin": 20,               // ft between bars that do not join
    "courtyardMin": 40                 // ft, smallest courtyard dimension
  },

  "placement": null,                   // { x, y, rotation, baseZ } when a project is open (spec section 4)

  "context": { "show": true, "fromSite": false, "blocks": [ { "x": 0, "y": -260, "w": 200, "d": 120, "h": 40 } ] },

  "floors": { "groundFtf": 12, "ftf": 10 },   // building-level floor-to-floor (section 1.2)

  "bars": [
    {
      "id": "A", "name": "Bar A",
      "x": -150, "y": 0, "angle": 0,   // start of the centerline; angle counter-clockwise from east
      "length": 300, "depth": 65,
      "floors": 5,
      "program": "residential",        // typical floors
      "groundProgram": null,           // null = same as program; "retail" | "amenity" | "leasing" add no units
      "corridor": "double",            // "double" | "single" | "breezeway"
      "unitSide": "left",              // single-loaded only: side of the units when you look along the bar
      "ends": { "start": "stair", "end": "stair" },   // "stair" | "open"
      "bends": [],                     // [{ "at": 120, "deg": 90 }] at = ft from the start; deg > 0 turns left; at most 2
      "unitWidth": null                // null = the program default
    }
  ],

  "courts": [],                        // [{ "id": "C1", "x": 0, "y": 32.5, "w": 170, "d": 135 }] open courts (section 1.2)

  "deck": { "on": false, "x": 0, "y": 0, "w": 300, "d": 125, "levels": 5, "ftf": 10.5, "openTop": true },

  "podium": {
    "on": false,
    "levels": [ { "ftf": 11, "program": "parking" } ],              // bottom first; program parking | retail | amenity | leasing
    "footprint": { "mode": "allowed", "percent": 100, "offset": 0 }, // "allowed": percent of the allowed footprint; "offset": bar bounding box + offset
    "liner": { "on": false, "side": "front", "depth": 40 }           // retail strip on the first podium level
  },

  "surface": { "count": 120, "lot": [] },    // typed count plus an optional drawn lot [[x,y],…]

  "programs": {                        // tower PROGRAM_DEFAULTS plus unitWidth, parkingRatio, senior, leasing
    "residential": { "ftf": 10,   "unitSize": 850, "unitFactor": 0.85, "unitWidth": 28, "parkingRatio": 1.25, "color": "#4f7fd1" },
    "hotel":       { "ftf": 10,   "unitSize": 400, "unitFactor": 0.80, "unitWidth": 14, "parkingRatio": 0.8,  "color": "#8a63c9" },
    "senior":      { "ftf": 10,   "unitSize": 600, "unitFactor": 0.85, "unitWidth": 30, "parkingRatio": 0.6,  "color": "#c2607a" },
    "retail":      { "ftf": 16,   "unitSize": null, "unitFactor": null, "unitWidth": null, "parkingRatio": 3,  "color": "#d9a22b" },  // per 1,000 sf
    "amenity":     { "ftf": 12,   "unitSize": null, "unitFactor": null, "unitWidth": null, "parkingRatio": 0,  "color": "#58a65c" },
    "leasing":     { "ftf": 12,   "unitSize": null, "unitFactor": null, "unitWidth": null, "parkingRatio": 0,  "color": "#7a8fa6" },
    "parking":     { "ftf": 10.5, "unitSize": 330, "unitFactor": 1,    "unitWidth": null, "parkingRatio": 0,  "color": "#8b929a" }
  },

  "parking": { "sfPerStallSurface": 350, "sfPerStallDeck": 330, "retailPerThousand": 3 },

  "rules": {
    "corridorWidth": 5.67,             // ft, for the efficiency estimate
    "breezewayWidth": 8,
    "stairPer": 250,                   // one extra stair per 250 ft of corridor beyond the first
    "elevatorPer": 100,                // one elevator per 100 units
    "cornerLoss": 1,                   // units lost per inside corner per floor; 0 to 2
    "constructionHints": [             // first row that matches wins
      { "maxFloors": 3, "podium": "any",  "hint": "Wood frame" },
      { "maxFloors": 5, "podium": "none", "hint": "Wood frame with fire-rated assemblies" },
      { "maxFloors": 5, "podium": "yes",  "hint": "Wood over a concrete podium" },
      { "maxFloors": 8, "podium": "any",  "hint": "Mass timber, steel, or concrete; check the code" },
      { "maxFloors": 999, "podium": "any", "hint": "Concrete; use the Tower Generator" }
    ]
  },

  "roof": { "type": "parapet", "height": 4 },   // "parapet" (adds no height, as the tower's flat crown) | "screen" (adds height)

  "targets": { "units": 0, "density": 0 },      // 0 = not set

  "view": {
    "style": "model", "colorBy": "program",     // "program" | "bar"
    "floorLines": true, "shadows": true, "sun": { "azimuth": 135, "altitude": 40 },
    "grid": true, "figure": true, "ticks": true, // ticks = unit module ticks in plan
    "snap": { "on": true, "grid": 5 }
  }
}
```

**Default state:** preset "Double-loaded bar, five floors" (section 8).

**Storage:** key `midrise.options.v1`, schema 1, through `createStorage` from `src/shared/storage.js`. The store deep-merges a loaded state over the default state, as the tower's `03a_state.js` does. A missing key gets its default. `migrate(state, fromSchema)` returns the state unchanged for schema 1. A later schema bumps the number and adds one case to `migrate`.

**Level numbers:** Level 1 is the ground floor. Podium levels come first. Bar floors continue the count. Deck levels come after all building levels (section 3.3).

---

## 3. Geometry pipeline

```
state → bars → legs → rings per level → union per level → plates + spines → metrics + warnings
                                                                          → 3D meshes
```

Every step before the meshes is a pure function. The metrics and the meshes use the same plates.

### 3.1 Step 1 — Bar to legs

A leg is one straight rectangle. A bar with no bends is one leg. Each bend splits the bar.

- Leg 0 starts at `(x, y)` with `angle`, length `bends[0].at` (or `length` with no bends).
- Leg i starts at the end point of leg i − 1, with angle `angle + sum of deg up to bend i`, length `bends[i].at − bends[i − 1].at` (the last leg runs to `length`).
- A leg's rectangle spans its length along its direction and `depth / 2` on each side.
- **Miter rule at a bend:** extend both legs past the bend point by `(depth / 2) × tan(|deg| / 2)`. The outer edges then meet at one point. For a 90-degree bend this is `depth / 2`, which makes a full `depth × depth` corner square.

Leg record: `{ barId, legIndex, x0, y0, angle, length, depth, ext0, ext1 }`. `ext0` and `ext1` are the miter extensions at each end (0 at a free end).

### 3.2 Step 2 — Leg ring and spine

- `legRing(leg)` returns the rectangle ring, counter-clockwise, with the extensions applied.
- `barSpine(bar)` returns the corridor centerline as a polyline through the legs. For `double` and `breezeway` bars the spine is the centerline. For `single` bars the spine shifts by `depth / 2 − rules.corridorWidth / 2` toward the corridor side (the side opposite `unitSide`).
- Spine coordinates are rounded to 0.001 ft.

### 3.3 Step 3 — Levels

Which levels a bar occupies:

- Podium levels (when on): index 1 to P, `z` from 0 up by each level's `ftf`, zone `podium`, the podium's program.
- Bar floors: index P + 1 to P + `bar.floors`. Floor P + 1 has `floors.groundFtf`; the rest have `floors.ftf`. `z` continues from the podium top. Zone `bar`. Program = `groundProgram` on floor P + 1 when set, else `program`.
- A bar with fewer floors than the tallest bar stops early. Levels above it hold the other bars only.
- Deck levels (when on): zone `deck`, `ftf` = `deck.ftf`, `z` from 0 (or from the podium top when the podium is on). Indices continue after the last building level, so index order equals list order, not elevation order. The project file gets the same list (section 7).

### 3.4 Step 4 — Union per level

- Collect every leg ring that occupies the level. Union them with Clipper at `SCALE = 1000` (0.001 ft). This is one union per level.
- **Touch rule:** two legs that touch or leave a gap under 0.5 ft must join. Before the union, offset every ring out by 0.25 ft, union, then offset in by 0.25 ft. Use miter joins for both offsets (`ClipperLib.JoinType.jtMiter`, miter limit 2), never round joins: miter joins keep every corner sharp, so rectangles come back as rectangles with no arc points. Test 3 checks that the L-joint union has exactly 6 vertices.
- The result is a `MultiPoly`. Outer rings run counter-clockwise, holes clockwise. Clean every ring with `cleanRing2` from `src/shared/sketchup-format.js`.
- The podium plate is one polygon: the allowed footprint scaled to `percent` about its centroid (mode `allowed`), or the bounding box of all bar rings offset out by `offset` (mode `offset`). The deck plate is the deck rectangle.

### 3.5 Step 5 — Joints

A joint is where two legs of different bars overlap or touch at the same level.

1. For each pair of legs from different bars, intersect their rings (Clipper). Overlap area 1 sf or more, or a gap under 0.5 ft, means a joint.
2. For each leg in the joint, find where the overlap sits: within `depth` of the leg's start or end means `end`; otherwise `through`.
3. Joint type: `L` = end + end, `T` = end + through, `cross` = through + through.
4. Inside corners: `L` 1, `T` 2, `cross` 4.
5. Corner zone = the overlap polygon. The Diagram style hatches it.
6. The spines meet at a node. Use the intersection of the two spines. When the spines do not intersect (a touch joint), extend the ending spine to the through spine and put the node there.

One bar's legs do not join with each other; the miter rule already closes a bend. A bend counts as one inside corner.

The corner loss charges `rules.cornerLoss × insideCorners` units per floor to the joint. The units module attributes the loss to the bar that comes first in `state.bars` among the joined bars.

### 3.6 Step 6 — Spine graph

Nodes: every spine end and every joint node. Edges: the spine pieces between nodes, with their lengths. The graph gives:

- Corridor length = the sum of edge lengths for `double` and `single` bars. Breezeway bars add 0.
- Dead ends are reported later by the Plate Planner, not here.

### 3.7 Step 7 — Courtyards and separation

- Closed courtyards = the holes of the union at the lowest bar level. Report area and the smallest dimension (the shortest axis of the minimum-area bounding rectangle, found by rotating calipers over the hole's convex hull).
- Open courts = `state.courts`. Report `w × d` and `min(w, d)`. Warn when a bar ring overlaps a court by more than 1 sf.
- A courtyard with a smallest dimension under `site.courtyardMin` warns.
- Separation: for each pair of bars with no joint, the minimum distance between their leg rings (segment to segment, over every edge pair). Warn when the distance is under `site.separationMin`. Bars at 12 or fewer give at most 66 pairs; this runs in under a millisecond.

### 3.8 Step 8 — Envelope

Reuse `src/tower/envelope.js` unchanged.

- Build tower-shaped plates: `{ n: index, zone, program, z, ftf, polygons, area, coreArea: 0, coreRect: null }`.
- `checkEnvelope(state, plates, [])` returns copies with `outsideEnvelopeArea` and the grouped warnings. The state's `site` keys match the tower's, so the module reads them as is.
- `allowedFootprint(state, 0)` gives the podium footprint in `allowed` mode and the placement snap target in the Site tab.
- A roof screen adds a solid `{ kind: "prism", polygons: topPlate, z0: top, z1: top + roof.height, role: "screen" }` for the height check.

### 3.9 Step 9 — Units estimate

Per bar, per residential, hotel, or senior floor (`groundProgram` of retail, amenity, or leasing adds no units on that floor):

| Corridor | Units per floor |
|---|---|
| `double` | `2 × floor(length ÷ w)` |
| `single` | `floor(length ÷ w)` |
| `breezeway` | `4 × floor(length ÷ (2 w + rules.breezewayWidth))` |

`w` = `bar.unitWidth` or the program's `unitWidth`. Then subtract the corner loss (section 3.5) from the bars that carry it. The sliver rule: a bar with `length < 2 w` warns "Bar C is shorter than two units."

Units for the bar = units per floor × unit floors. The building total is the sum.

### 3.10 Step 10 — Parking

Required = Σ over programs (units × `parkingRatio`) + retail area ÷ 1,000 × `parking.retailPerThousand`. Retail area = the sum of ground-floor retail bar area, podium retail levels, and the liner.

Provided:

| Source | Stalls |
|---|---|
| Surface, typed | `surface.count` |
| Surface, drawn lot | `area(surface.lot) ÷ sfPerStallSurface`, rounded down, added to the count |
| Deck | `deck.levels × deck.w × deck.d ÷ sfPerStallDeck`, rounded down |
| Podium parking level | `(level area − liner area − non-parking area) ÷ sfPerStallDeck`, rounded down |

Report required, provided, `provided ÷ units` (the ratio provided), and surplus or deficit.

### 3.11 Step 11 — Stairs and elevators (seeds)

| Item | Count | Block | Placement |
|---|---|---|---|
| Exit stair | Per bar: ends set to `stair`, plus `max(0, ceil(corridorLength ÷ rules.stairPer) − 1)` | 12 × 22 ft | End stairs straddle the spine, centered 6 ft in from the bar end. Extra stairs sit on the spine at even spacing. |
| Exterior stair | One per breezeway module on breezeway bars | 10 × 20 ft | Centered on each breezeway, on the spine. |
| Elevator | `ceil(units ÷ rules.elevatorPer)`; at least 1 when any bar has 3 or more floors; 0 when every bar is a breezeway bar | 10 × 10 ft each | Side by side beside the spine at the mid-length of the longest bar, on the `unitSide` side. |

Seeds repeat on every bar level. Caution: seed counts are a start, not a code count. The tool says so next to the count.

### 3.12 Step 12 — Construction hint

Find the first row in `rules.constructionHints` where `maxFloors ≥ the tallest bar floor count` and the podium condition matches (`none`, `yes`, or `any`). Show the hint with the caution text from the concept.

### 3.13 Step 13 — Metrics

| Metric | Formula |
|---|---|
| Units | Per bar, per program, total (section 3.9) |
| Density | units ÷ (site area ÷ 43,560) |
| GFA | Σ plate areas over all levels, podium and deck included |
| FAR | GFA ÷ site area |
| Site coverage | area of the union of all level-1 pieces (bars on grade, podium, deck on grade) ÷ site area |
| Efficiency estimate | Σ over bar levels of (plate area − corridor area − stair area − elevator area) ÷ Σ plate area; corridor area = corridor length × `rules.corridorWidth` |
| Corridor length | Total, and total ÷ units |
| Parking | Section 3.10 |
| Courtyards | Count, area, smallest dimension (section 3.7) |
| Bars | Count, longest bar |
| Height | Top of the highest bar level, plus the screen height when the roof is a screen; the parapet adds 0 |
| Floors | Tallest bar floor count, podium levels, deck levels |
| Stairs and elevators | Section 3.11 |
| Construction hint | Section 3.12 |
| Open space | (site area − level-1 coverage area − surface lot area) ÷ site area; the typed count adds `count × sfPerStallSurface` |
| Target check | units and density minus the targets, as a number and a percent |

Format: whole square feet with commas; density to one decimal; heights as feet and inches.

### 3.14 Step 14 — Derived writer

`midriseDerived(state, built)` maps the build to `massing.derived` from the project-file spec section 6.2:

- `footprint`: the union of every level's plates.
- `levels[]`: one entry per level from section 3.3, with `plates`, `core: null`, `spines` (the spine pieces of the bars at that level), and `seeds` (section 3.11 blocks as rings with `kind`).
- `context.blocks`: `state.context.blocks`.
- `metrics`: `{ gfa, far, siteCoverage, floors, height, units }`.

---

## 4. Module contracts

Pure ES modules. No DOM, no Three.js, no hidden state, no mutation of inputs. Clipper through `globalThis.ClipperLib` at `SCALE = 1000`. Coordinates round to 0.001 ft, areas to 0.1 sf. Shared types from `docs/module-contracts.md`: `Ring`, `Poly`, `MultiPoly`, `Plate`, `Warning`.

```js
// src/midrise/bars.js
export const SCALE = 1000;
export function legsOf(bar)                       // → Leg[] (section 3.1), miter extensions applied
export function legRing(leg)                      // → Ring, counter-clockwise, extensions included
export function barSpine(bar, rules)              // → [[x, y], …] polyline (section 3.2)
export function barLevels(bar, state)             // → [{ index, z, ftf, program }] the levels this bar occupies (section 3.3)
export function buildingLevels(state)             // → [{ index, zone, z, ftf, program }] podium, bar, then deck levels, with no plates yet

// src/midrise/assemble.js
export function assemble(state, { quality = "full" } = {})
  // → { levels: [{ index, zone, z, ftf, program, plates: MultiPoly, spines: [[[x,y],[x,y]],…], joints: Joint[], cornerZones: MultiPoly, barIds: string[] }],
  //     spineGraph: { nodes: [{ id, x, y, kind: "end"|"joint" }], edges: [{ from, to, barId, length }] },
  //     joints: Joint[],                 // Joint = { id, barIds: [a, b], type: "L"|"T"|"cross", insideCorners, zone: Poly, node: [x, y] }
  //     courtyards: [{ kind: "closed"|"open", id, area, minDim, ring }],
  //     separation: [{ barIds: [a, b], distance }],
  //     plates: Plate[],                 // tower-shaped plates for envelope.js
  //     solids: Solid[],                 // the roof screen, when set
  //     warnings: Warning[] }            // sliver, courtyard, separation, bar outside the site, bar over a court
  // quality "draft": no union; each leg ring is its own Poly. Metrics always use "full".

// src/midrise/units.js
export function unitsEstimate(state, built)       // → { total, byBar: { [id]: { perFloor, floors, total, lossPerFloor } }, byProgram: { [program]: n }, warnings }

// src/midrise/parking.js
export function parkingRequired(state, units, built)   // → { total, byProgram, retail }
export function parkingProvided(state, built)          // → { total, surface, lot, deck, podium: [n per level] }

// src/midrise/metrics.js
export function computeMetrics(state, built, units, parking)   // → every row of section 3.13
export function constructionHint(state)                        // → string

// src/midrise/derived.js
export function midriseDerived(state, built, metrics)          // → massing.derived (spec 6.2)

// src/midrise/snaptargets.js
export function collectBarSnapTargets(state, built, { exclude })   // → { lines } in the snap.js line format: grid, site, setback, bar edges and centers, deck edges, court edges
export function barBox(state, built, barId)                        // → { minX, maxX, minY, maxY } of the bar's rings, or null

// src/midrise/sketchup.js
export function midriseToSketchup(state, built, metrics, meta)     // → doc from makeDoc(); groups: Podium, Bars (one solid per level per bar), Deck, Courts (hidden guides), Context

// src/midrise/presets.js
export const PROGRAM_DEFAULTS                                      // section 2 programs
export const PRESETS                                               // [{ id, name, description, state }] section 8
export function templateState(type, options)                      // → state from a template with its options (section 5.1)

// src/midrise/testcases.js
export const TEST_CASES   // [{ id, description, state, expect: { unionArea?, units?, parkingRequired?, parkingProvided?, insideCorners?, tolerancePct } }]
```

Rules:

- `assemble` is the only module that calls Clipper for unions. `units.js`, `parking.js`, and `metrics.js` read the built result.
- Every function throws a clear error when an input is missing and names the input.
- `snaptargets.js` returns lines in the exact shape `src/tower/snap.js` consumes, so `snapMove`, `snapEdge`, and `snapLength` work unchanged.

---

## 5. Interface

### 5.1 Tabs

Same panel, tabs, and top bar as the tower v1.1. Tab order: Form, Program, View, Site.

**Form tab**

- Templates menu: Garden walk-up, Corridor garden, Bar, Courtyard L, Courtyard U, Courtyard O, Courtyard E, Wrap, Podium. A template replaces the bars, courts, deck, and podium, and keeps the site. Each template asks for its options in a small card first (bar length, depth, floors; court width and depth; deck size and levels; podium levels).
- Bars list: one row per bar with its name, length, floors, units per floor, and a color swatch (Diagram style, color by bar). Add bar, duplicate, delete. Reorder by drag.
- Selected bar card (also opens from a click in the view): start x, y, angle, length, depth, floors, program, ground program, corridor type, unit side, ends, bends (add up to two), unit width override.
- Deck card: on, position, size, levels, floor-to-floor, open top.
- Podium card: on, levels with program, footprint mode, liner.
- Surface parking card: typed count, draw lot (click points in plan; Escape ends).
- Courts list: position and size.

**Program tab:** the programs table from section 2, plus the parking table and the rules (corridor width, stair rule, elevator rule, corner loss, construction hints).

**View tab:** style, color by, floor lines, shadows, sun, grid, figure, ticks, context on or off.

**Site tab:** site shape, setbacks, height limit, stepback, density cap, open space share, separation minimum, courtyard minimum, targets. With a project: placement (x, y, rotation, baseZ), "Center on site", "Context from site" with a radius, and the project name.

### 5.2 Top bar

Option menu (presets, Save, Duplicate, Rename, Delete, Compare), Undo, Redo, Model/Diagram, Snap, Export menu (Image, AI-ready image, AI Prompts, SketchUp, Export JSON, Import JSON, Send to Plate Planner, Send to Parking Deck), Project menu (New, Open, Import, Export). Four metrics stay visible: units, density, parking ratio, height. The warning count stays visible.

### 5.3 Handles and snapping

- Click or tap a bar, the deck, the podium, a court, or a context block to select it. Shift-click or "Select more" adds items. Escape clears.
- Bar handles: move (both plan axes), rotate (a handle beyond the end; 5-degree snap, free with Option), length (end handles), depth (side handles), floors (top handle, one floor per 10 ft of drag in the axon and ortho views). Deck and court handles: move and resize. Podium: no handles; its size follows the mode.
- OrbitControls stay off while a handle is active. Hit size 44 CSS px on touch.
- Snapping reuses `snapMove`, `snapEdge`, and `snapLength` from `src/tower/snap.js` with targets from `collectBarSnapTargets` (section 4): grid (5 or 10 ft), site edges, setback lines, other bar edges and centers, deck edges, court edges. Orange guides show the active snap. Option skips snapping.
- Mac shortcuts: 1 to 6 views, D Model/Diagram, B add bar, Delete removes the selection, Command+D duplicates the bar, Escape clears. Ignore shortcuts in text fields.

### 5.4 iPad

Same bottom sheet as the tower in portrait. Handles 44 points or larger. Sliders accept typed numbers.

---

## 6. Rendering

- Plates extrude per level to `ftf − 0.5 ft` with floor lines on, else to `ftf`. Reuse the tower mesh builder (merge by color).
- Model style: white, matte, dark edges; deck light gray with its level lines; podium white; courts as a thin outline on the ground.
- Diagram style: color by program (section 2 colors) or by bar (a fixed palette of 12 colors, repeating); dark outlines.
- Plan overlays (plan view and Diagram style): spines as dashed lines, unit ticks every `w` along each bar from its start, corner zones hatched, courtyard labels with area and smallest dimension, stall count text on the deck and the podium, podium outline, surface lot outline with its count.
- Draft quality during a drag: skip the union and draw each leg as a separate box; skip shadows. Full quality on drag end. Metrics run at full quality every time, at most once per animation frame.
- Context: Site Model neighbors as blocks from `siteContextFor` (section 7), or the simple blocks. Ground grid, scale figure, north arrow when a site is loaded.
- Target: 12 bars × 7 floors at 60 frames per second on the Mac and 30 on the iPad during a drag.

---

## 7. Project file

Follows `docs/project-file-spec.md`.

- Start: `projectIdFromUrl` → `loadProject`. Show the project name in the top bar. Load `sections.massing.state` as the working option when `tool` is `midrise`. When `tool` is `tower`, offer "Replace the tower massing with this option" before the first write.
- Site context: `siteContextFor(doc, placement, radiusFt)` → `state.context.blocks`, `fromSite = true`. "Context from site" in the Site tab, radius default 600 ft. Boundary and ground also draw from `sections.site.derived`.
- Placement: "Center on site" sets `x` and `y` to the site center and `baseZ` to the ground at that point. Drag the whole building in the plan view when the site shows; snap to the boundary and the setback lines. Rotation in 5-degree steps.
- Write: `writeSection(doc, "massing", { tool: "midrise", schema: 1, placement, state, derived })` on every change, debounced 1 s, and on `visibilitychange` and `pagehide`. `derived` from `midriseDerived`.
- Deck and podium levels go into `derived.levels` with zones `deck` and `podium`. The Parking Deck tool reads them from there. No extra section.
- Export menu: "Send to Plate Planner" → `sendTo(storage, doc, "plate", "midrise")`. "Send to Parking Deck" → `sendTo(storage, doc, "parking", "midrise")`.
- No project: the tool behaves as the tower does today. The Project menu offers New, Open, Import, Export.

Note for the spec: deck levels list after the building levels with higher indices (section 3.3). The spec's section 6.2 should state that `index` is an id in list order, and that a reader sorts by `z` when it needs elevation order.

---

## 8. Presets

Phase 7 (Haiku) types these values into `src/midrise/presets.js`. Every value is listed. Expected numbers come from the formulas in section 3 with the default programs, `cornerLoss` 1, and `w` = 28. Sites are rectangles centered on the origin. Bars run from `(x, y)` at `angle`.

Common to all presets: `floors.groundFtf` 12 (10 for preset 1), `floors.ftf` 10, roof parapet 4 ft, programs and rules from section 2, `context.blocks` one block at `{ x: 0, y: -(site depth / 2 + 80), w: 200, d: 120, h: 40 }`.

### 8.1 Garden walk-up, three floors

| Item | Value |
|---|---|
| Site | 540 × 403 ft = 217,620 sf = 4.996 acres; setbacks 25; height limit 0 |
| Floors | groundFtf 10, ftf 10 |
| Bars | A `(-96, -120, 0°)`, B `(-96, 0, 0°)`, C `(-96, 120, 0°)`; each length 192, depth 66, floors 3, corridor `breezeway`, ends open |
| Parking | surface count 160 |
| Podium, deck | off |

Expected: modules per bar = floor(192 ÷ (2 × 28 + 8)) = 3 → 12 units per floor → 36 per bar → **108 units**; density 108 ÷ 4.996 = **21.6 per acre**; GFA = 3 × 192 × 66 × 3 = **114,048 sf**; FAR 0.52; parking required 135, provided 160 (ratio 1.48); exterior stairs 9; elevators 0; height 30 ft.

### 8.2 Corridor garden, four floors

| Item | Value |
|---|---|
| Site | 400 × 327 ft = 130,800 sf = 3.003 acres; setbacks 25 |
| Bars | A `(-152.5, -80, 0°)` length 240, ends start `stair` end `stair`; B `(-120, -112.5, 90°)` length 160, ends start `open` end `stair`; both depth 65, floors 4, corridor `double` |
| Parking | surface count 125 |

Geometry check: A spans x −152.5 to 87.5, y −112.5 to −47.5. B spans x −152.5 to −87.5, y −112.5 to 47.5. The overlap is 65 × 65 at the southwest corner: one `L` joint, 1 inside corner.

Expected: union per level = 240 × 65 + 160 × 65 − 65 × 65 = **21,775 sf**; units per floor = 2 × 8 + 2 × 5 − 1 = 25 → **100 units**; density **33.3 per acre**; GFA 87,100 sf; FAR 0.67; parking required 125, provided 125 (ratio 1.25); stairs 3; elevators 1; height 42 ft.

### 8.3 Double-loaded bar, five floors (default state)

| Item | Value |
|---|---|
| Site | 360 × 242 ft = 87,120 sf = 2.000 acres; setbacks 20 |
| Bars | A `(-150, 0, 0°)` length 300, depth 65, floors 5, corridor `double`, ends both `stair` |
| Parking | surface count 120 |

Expected: units per floor = 2 × floor(300 ÷ 28) = 20 → **100 units**; density **50.0 per acre**; GFA 97,500 sf; FAR 1.12; parking required 125, provided 120, **deficit 5 (a planned warning)**; stairs 2 + (ceil(300 ÷ 250) − 1) = 3; elevators 1; height 52 ft.

### 8.4 Courtyard, five over one

| Item | Value |
|---|---|
| Site | 330 × 330 ft = 108,900 sf = 2.500 acres; setbacks 20 |
| Bars | S `(-125, -77.5, 0°)` length 250, ends both `stair`; N `(-125, 77.5, 0°)` length 250, ends both `stair`; W `(-92.5, -110, 90°)` length 220, ends both `open`; E `(92.5, -110, 90°)` length 220, ends both `open`; all depth 65, floors 5, corridor `double` |
| Podium | on; levels `[{ ftf: 11, program: "parking" }]`; footprint mode `offset`, offset 0; liner off |
| Parking | surface count 120 |

Geometry check: the four bars enclose a hole of 120 × 90 ft (x −60 to 60, y −45 to 45). Four `L` joints, 4 inside corners. The podium is the bar bounding box, 250 × 220 ft.

Expected: union per bar level = 250 × 220 − 120 × 90 = **44,200 sf** (check: 2 × 250 × 65 + 2 × 220 × 65 − 4 × 65 × 65 = 44,200); units per floor = 16 + 16 + 14 + 14 − 4 = 56 → **280 units**; density **112.0 per acre**; podium stalls = floor(55,000 ÷ 330) = 166; GFA = 55,000 + 5 × 44,200 = 276,000 sf; FAR 2.53; parking required 350, provided 286, **deficit 64 (a planned warning)**; closed courtyard 10,800 sf, smallest dimension 90; stairs 4; elevators 3; height 11 + 12 + 40 = 63 ft.

Note: the concept estimated about 200 units for this preset. The formulas give 280. The preset keeps the concept's dimensions and reports the computed number.

### 8.5 Wrap with five-level deck

| Item | Value |
|---|---|
| Site | 540 × 363 ft = 196,020 sf = 4.500 acres; setbacks 25 |
| Deck | on; `(0, 0)`, 300 × 125, levels 5, ftf 10.5, open top |
| Bars | S `(-225, -105, 0°)` length 450, ends both `stair`; N `(-225, 105, 0°)` length 450, ends both `stair`; W `(-192.5, -137.5, 90°)` length 275, ends both `open`; E `(192.5, -137.5, 90°)` length 275, ends both `open`; all depth 65, floors 5, corridor `double` |
| Parking | surface count 40 |

Geometry check: the gap between the deck and every bar is 10 ft. The bars enclose a hole of 320 × 145 ft that holds the deck. Four `L` joints.

Expected: union per level = 450 × 275 − 320 × 145 = **77,350 sf**; units per floor = 32 + 32 + 18 + 18 − 4 = 96 → **480 units**; density **106.7 per acre**; deck stalls = floor(5 × 37,500 ÷ 330) = 568; GFA = 5 × 77,350 + 5 × 37,500 = 574,250 sf; FAR 2.93; parking required 600, provided 608 (ratio 1.27); stairs 4 + 1 + 1 + 1 + 1 = 8; elevators 5; height 52 ft (deck 52.5 ft).

Note: the concept estimated about 390 units. The formulas give 480.

### 8.6 Podium, five over two with retail

| Item | Value |
|---|---|
| Site | 330 × 231 ft = 76,230 sf = 1.750 acres; setbacks 15 |
| Bars | S `(-150, -67.5, 0°)` length 300, ends both `stair`; W `(-117.5, -100, 90°)` length 200, ends start `open` end `stair`; E `(117.5, -100, 90°)` length 200, ends start `open` end `stair`; all depth 65, floors 5, corridor `double` |
| Court | C1 `{ x: 0, y: 32.5, w: 170, d: 135 }` (open to the north) |
| Podium | on; levels `[{ ftf: 16, program: "parking" }, { ftf: 11, program: "parking" }]`; liner on, side `front`, depth 40; footprint mode `offset`, offset 0 |
| Parking | surface count 0 |

The liner is the retail strip on podium level 1: 300 × 40 = 12,000 sf. Level 1 floor-to-floor is 16 ft because of the retail.

Geometry check: the podium is the bar bounding box, 300 × 200 ft. Two `L` joints.

Expected: union per bar level = 300 × 65 + 2 × 200 × 65 − 2 × 65 × 65 = **37,050 sf**; units per floor = 20 + 14 + 14 − 2 = 46 → **230 units**; density **131.4 per acre**; podium stalls = floor((60,000 − 12,000) ÷ 330) + floor(60,000 ÷ 330) = 145 + 181 = 326; GFA = 2 × 60,000 + 5 × 37,050 = 305,250 sf; FAR 4.00; parking required 230 × 1.25 + 12 × 3 = 323.5 → 324, provided 326 (ratio 1.42); open court 22,950 sf, smallest dimension 135; stairs 3 + 1 + 1 = 5; elevators 3; height 16 + 11 + 12 + 40 = 79 ft.

Note: the concept estimated about 170 units. The formulas give 230.

---

## 9. Tests

### 9.1 Module tests (`test/midrise.*.test.mjs`, run by `npm test`)

| # | File | Case | Expect |
|---|---|---|---|
| 1 | bars | Leg ring of a 300 × 65 bar at 0° from (−150, 0) | Ring = (−150, −32.5), (150, −32.5), (150, 32.5), (−150, 32.5), area 19,500 |
| 2 | bars | Bar of 300 × 65 with one 90° bend at 120 ft | Two legs, 152.5 and 212.5 long after the 32.5 ft miter extensions; union area = 152.5 × 65 + 212.5 × 65 − 65 × 65 = 19,500 sf; the bend counts as 1 inside corner |
| 3 | assemble | L joint: two 240 × 65 bars at 90° sharing a 65 × 65 corner | Union area = 240 × 65 + 240 × 65 − 65 × 65 = 26,975; one `L` joint; 1 inside corner |
| 4 | assemble | T joint: bar A 300 × 65 east–west; bar B 150 × 65 starting at A's south edge, running north | Union area = 19,500 + 9,750 − 4,225 = 25,025; `T`; 2 inside corners |
| 5 | assemble | Cross joint: A 300 × 65 east–west, B 300 × 65 north–south, centered | Union area = 19,500 + 19,500 − 4,225 = 34,775; `cross`; 4 inside corners |
| 6 | assemble | Touch joint: a 0.4 ft gap between a bar end and a bar side | One joint; union is one polygon |
| 7 | assemble | Preset 8.4 | One hole of 10,800 sf, smallest dimension 90; four joints |
| 8 | assemble | Two parallel bars, centerlines 84 ft apart | Separation 19 ft; one warning at `separationMin` 20 |
| 9 | units | Breezeway bar 192 ft, w 28 | 12 units per floor |
| 10 | units | Preset 8.2 | 25 units per floor; 100 total; loss charged to bar A |
| 11 | units | Sliver: a 50 ft bar with w 28 | One sliver warning |
| 12 | parking | Preset 8.6 | Required 324; provided 326 |
| 13 | parking | Drawn lot of 35,000 sf plus count 10 | Provided 110 |
| 14 | metrics | Preset 8.3 | GFA 97,500; FAR 1.12; density 50.0; coverage 19,500 ÷ 87,120 |
| 15 | derived | Preset 8.5 through `midriseDerived` then `writeSection` and `validate` from `src/shared/project.js` | Valid; 5 bar levels plus 5 deck levels; every ring clean; seeds present |
| 16 | presets | Every preset | Inside its site after setbacks; under its height limit; expected units and GFA within 0.5 percent |

Test 2: the agent computes the exact union area from the two leg rings by hand and writes it in the test with the arithmetic in a comment.

### 9.2 In-page tests (`midrise/index.html?test`)

- Shell: the default state builds; the four HUD metrics show; every tab opens.
- Handles: a move of bar A by (10, 0) changes `x` by 10 and nothing else; a length drag snaps to 1 ft; rotate snaps to 5 degrees.
- Templates: each template builds with no error and no envelope warning except the planned parking warnings.
- Project: load a fixture project with a site; "Context from site" fills `context.blocks`; `writeSection` round trip keeps every other section.
- Exports: SketchUp doc validates; Export JSON then Import JSON gives the same metrics.

### 9.3 Cade's live checks

1. Open each preset on the Mac. Compare the HUD numbers with section 8.
2. Drag a bar on the iPad. Snap guides show. The numbers update on release.
3. Build a wrap from the template, send it to the Plate Planner, and confirm the plates arrive.
4. Export SketchUp and import it with the CMRLM extension.

---

## 10. Build phases and file ownership

Phases 2 to 6 run in parallel. Each agent owns only its files. The integrator wires them.

| Phase | Model | Agent | Owns | Acceptance checks |
|---|---|---|---|---|
| 1 | Opus | Orchestrator | This plan | Cade's go |
| 2 | Sonnet | Shell | `build/midrise/shell.html`, `body.html`, `css_add.css`, `01_config.js`, `03a_state.js`, `07_controls.js`, `08_ui.js`, `09_storage.js`, `10_screenshot.js`, `11_compare.js`, `12_tests.js`, `13_start.js`, `build.py` | The default state shows one bar with units 100 and height 52 ft. Tabs, HUD, Option menu, and the iPad sheet work at 1440 × 900, 1180 × 820, and 820 × 1180. |
| 3 | Sonnet | Bars | `src/midrise/bars.js`, `units.js`, `parking.js`, `metrics.js`, tests 1, 2, 9 to 14 | Tests pass. Preset 8.3 numbers match by hand. Tests 10, 12, and 14 run against a fixture built by `assemble` once phase 4 lands; until then they use a hand-built fixture. |
| 4 | Opus | Assemble | `src/midrise/assemble.js`, `snaptargets.js`, tests 3 to 8 | Tests pass. L, T, and cross areas match by hand. Draft quality skips the union. |
| 5 | Sonnet | Scene | `build/midrise/05_envelope.js`, `06_render.js`, `06b_select.js` (handles, snapping, placement on site, context from site) | Handles work with the mouse and touch. The envelope turns plates red. Placement writes `state.placement`. |
| 6 | Sonnet | Exports | `src/midrise/derived.js`, `sketchup.js`, `build/midrise/08b_prompts.js`, `08c_sketchup.js`, `09b_project.js`, test 15 | SketchUp doc validates. `derived` validates. Send to Plate Planner opens the URL with the project id. |
| 7 | Haiku | Presets | `src/midrise/presets.js`, `testcases.js`, `build/midrise/12d_tests_presets.js`, test 16 | Every preset loads and matches section 8. |
| 8 | Opus | Integrator and reviewer | `build/midrise/build.py` MODS and markers, part order, `package.json` test script, `README.md` tool row, `index.html` card | `npm test` green. In-page tests green. Playwright smoke at three sizes. Ten hand calculations checked against the tool. |
| 9 | Cade | — | — | Section 9.3 |

**Interfaces between agents:** section 4 fixes every module signature. The Shell agent exposes `Store`, `Units`, `UI.openItem`, and `UI.setBar` as the tower does; the Scene agent and the Exports agent call them. Any change to a signature goes through the integrator first.

**Integrator's job:** copy the tower `build.py` and register the midrise modules in `MODS` (bars, assemble, units, parking, metrics, derived, snaptargets, sketchup, presets, testcases, plus the shared storage, screenshot, sketchupFormat, project, prompts, envelope, snap); place the `//@@MODULE key@@` markers in `01_config.js`; keep the part order of the tower; add `test:midrise` and the new tests to `npm test`; add the tool row to `README.md` and the card to the Workspace page; run the Playwright smoke test at 1440 × 900, 1180 × 820, and 820 × 1180; open the pull request.

---

## 11. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| Touch rule closes gaps the user meant | Two bars merge by accident | The gap must be under 0.5 ft. Snapping to bar edges makes a real joint obvious. The joints list names every joint. |
| Different floor counts per bar leave levels with holes in the stack | A level union with pieces from some bars only | Allowed. The Plate Planner groups levels by geometry. |
| Miter rule on sharp bends | Long extensions at small angles | Clamp `|deg|` to 150 degrees. Warn above 135. |
| Deck level indices after the building levels | A reader that assumes elevation order | The spec gets one line (section 7 note). `derived.levels` carry `z`. |
| Units estimate reads high next to the Plate Planner | Two counts for one building | Label it "estimate". Show the Plate Planner count next to it when the project holds one. |
| Podium `allowed` mode with a polygon site | Scaling a concave footprint about its centroid can self-intersect | Union the result with itself (Clipper) and warn when the area changes by more than 1 percent. |
| iPad drags on a 12-bar wrap | Slow frames | Draft quality skips the union. Full build on release. |

Open items:

1. Spec section 6.2: add the note on level index order (section 7).
2. Program `senior` and `leasing` colors are new. Confirm or change them.
3. Template option cards: confirm the default court sizes (120 × 90) and the default deck size (300 × 125).
