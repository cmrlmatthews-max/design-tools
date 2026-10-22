# Facade Studio — Technical Plan

Version 0.1 · October 21, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Source: `facade-studio-concept.md` v0.1 with the decisions in its section 12, including decisions 14 to 18 that Cade accepted on October 21, 2026.

This plan is the instruction set for the build phases. Each build agent gets this plan, the concept, and `docs/project-file-spec.md`.

---

## 1. Scope and decisions

### 1.1 Decisions that bind the build

| # | Decision | Source |
|---|---|---|
| 1 | Both visual styles with one toggle: white model and diagram | Concept 12.1 |
| 2 | Feet and square feet only | Concept 12.2 |
| 3 | Massing sources: Tower Generator, Mid-Rise Generator, or a standalone typed massing | Concept 12.3 |
| 4 | Systems: punched windows, window wall, curtain wall, storefront (plus `solid`, change 2) | Concept 12.4 |
| 5 | Four 90-degree sectors in the project frame, after the placement rotation | Concept 12.5 |
| 6 | Glazing area = the whole window opening, frames included | Concept 12.6, decision 15 |
| 7 | Whole modules; the remainder stretches the modules evenly; no closer panel | Concept 12.7, decision 14 |
| 8 | WWR limit 40 percent by default, editable, with a Caution line | Concept 12.8 |
| 9 | Ground transparency band 2 to 10 ft, street faces only | Concept 12.9 |
| 10 | Envelope note from an editable table; no simulation | Concept 12.10 |
| 11 | Users are Cade and RJTR teammates; a short Help panel | Concept 12.11 |
| 12 | Generic names only; no district names | Concept 12.12 |
| 13 | The project file is part of version 1 | Concept 12.13 |
| 14 | Inset balcony door glass counts at the recessed plane | Decision 16 |
| 15 | Transparency target off by default; 60 percent in the retail presets | Decision 17 |
| 16 | Parapets, roof screens, and crown levels add no wall area | Decision 18 |

### 1.2 Changes from the concept

1. **Balcony type and pattern are two settings.** `type` is inset or projected. `pattern` is stacked, alternating, checker, or per-unit. The concept's five patterns map one to one: its "inset" is inset + stacked; its "projected" is projected + stacked.
2. **A fifth system, `solid`.** An opaque wall with no glazing. Parking podiums and blank party walls need it. It counts as wall area.
3. **Curtain wall vision has a sill.** Vision runs from `sill` (default 0) to `sill + vision`. The spandrel is the rest of the floor: `ftf − vision`. The concept's office preset ("8 ft vision + 4 ft spandrel at 13.5 ft") does not add up; the plan reads it as 8 ft vision and a 5.5 ft spandrel.
4. **A solid pattern on any rule.** `solid: { count, every }` makes the last `count` modules of every `every` modules opaque. The concept's own option B2 and the banded hotel preset need it.
5. **A glass corner overrides the solid pattern.** The end module at a convex corner becomes glass even when the pattern made it solid. With a plain window wall a glass corner changes nothing, so preset 8.8 uses a solid pattern. Its WWR is 0.618, not the concept's estimate of about 0.82.
6. **Inset balcony returns are not wall area.** The recessed back wall replaces the face strip one for one. The two side returns are left out. The Help panel and the notes export state this rule.
7. **A balcony places a door.** In a balcony module the window becomes a door, 6 ft wide, sill 0, head 8 ft. Both balcony types do this.
8. **The standalone massing has four shapes and a podium.** Rectangle, L, U, and O (a courtyard ring), plus an optional rectangular podium. Every preset runs without a project.
9. **Face groups never cross a zone boundary.** A face group is one face on one zone's consecutive levels.
10. **Office "one view face" preset:** 0.301 by the formulas, not the concept's estimate of about 0.38.

### 1.3 Reuse

| Reused verbatim (shared modules) | Copied and changed (Parking Deck parts) | New |
|---|---|---|
| `src/shared/storage.js`, `screenshot.js`, `sketchup-format.js`, `project.js` | `build/parking/shell.html`, `body.html`, `css_add.css`, `build.py` | `src/facade/faces.js` |
| `src/tower/prompts.js` (prompt library data; facade fields added in the page) | `00_imports.js` to `03b_store.js` | `src/facade/panels.js`, `balconies.js` |
| `src/midrise/bars.js` helpers: `ringArea`, `multiPolyArea` | `06_render.js`, `06b_select.js` (face selection, no handles) | `src/facade/metrics.js` |
| | `07_controls.js`, `08_ui.js`, `08b_prompts.js`, `08c_sketchup.js`, `08e_help.js` | `src/facade/derived.js`, `elevations.js`, `sketchup.js` |
| | `09_storage.js`, `09b_project.js`, `10_screenshot.js`, `11_compare.js`, `12_tests.js`, `13_start.js` | `src/facade/presets.js`, `testcases.js` |

Tests build Mid-Rise massings with `assemble` (`src/midrise/assemble.js`) and `midriseDerived` (`src/midrise/derived.js`). Tower tests build levels from `buildPlates` (`src/tower/geometry.js`): each plate `{ n, zone, z, ftf, polygons }` becomes a level `{ index: n, zone, z, ftf, plates: polygons }`, the shape `towerDerived` writes (spec 6.2).

---

## 2. State schema

All lengths are feet. All areas are square feet. Angles are degrees. Plan coordinates `(x, y)`: east = +x, north = +y. Heights `v` inside a level run from its floor surface.

```jsonc
{
  "schema": 1,
  "name": "Option A",
  "source": "standalone",              // "standalone" | "project" (read massing.derived from the open project)

  "standalone": {
    "shape": "rect",                   // "rect" | "L" | "U" | "O"; every shape centered on its bounding box
    "width": 300, "depth": 65,         // bounding box, ft
    "arm": 65,                         // L, U, O: bar depth
    "courtW": 120, "courtD": 90,       // O only: centered court; U ignores these (open to the north)
    "angle": 0,                        // counter-clockwise rotation of the whole massing, degrees
    "floors": 5,                       // levels with the main shape (above the podium)
    "ftf1": 12,                        // level 1 floor-to-floor
    "ftf": 10,                         // every other main-shape level
    "podium": { "on": false, "levels": 1, "ftf": 11, "width": 300, "depth": 200 }   // podium levels 2..P use podium.ftf
  },

  "placement": null,                   // copied from sections.massing.placement when source is "project"

  "zones": {
    "mode": "default",                 // "default" = base / middle / top (section 3.4); "ranges" = the list below
    "ranges": [],                      // [{ "id": "Z1", "name": "Levels 2 to 6", "from": 2, "to": 6 }]
    "rules": {                         // one rule per zone id: "base", "middle", "top", or a range id
      "base":   { "system": "punched" },
      "middle": { "system": "punched" },
      "top":    { "system": "punched" }
    },
    "overrides": {}                    // { "base": { "S": { "system": "storefront" } } } per zone and orientation
  },

  "systems": {                         // defaults a rule inherits; a rule may override any key
    "punched":    { "module": 14, "windowW": 6, "sill": 2.5, "head": 8, "mullionW": 0.1667, "mullionD": 0.333 },
    "windowWall": { "module": 5, "slabCover": 1.3333, "mullionW": 0.2083, "mullionD": 0.5 },
    "curtainWall":{ "module": 5, "vision": 8, "sill": 0, "mullionW": 0.2083, "mullionD": 0.6667 },
    "storefront": { "module": 5, "sill": 1.5, "head": 10, "mullionW": 0.1667, "mullionD": 0.375 },
    "solid":      { "module": 10 }
  },
  // A rule: { system, module?, windowW?, sill?, head?, vision?, slabCover?, solid?: { count, every }, glazing?, material? }

  "balconies": {
    "on": false, "type": "projected",  // "projected" | "inset"
    "pattern": "stacked",              // "stacked" | "alternating" | "checker" | "per-unit"
    "spacing": 2,                      // every second module
    "width": 12, "depth": 6, "slab": 1,
    "door": { "width": 6, "head": 8 }, // the door replaces the window in a balcony module (change 7)
    "zones": ["middle"],
    "orientations": ["N", "E", "S", "W"]
  },

  "fins":   { "on": false, "depth": 1.5, "width": 0.1667, "every": 1, "orientations": ["E", "W"], "zones": ["middle", "top"] },
  "shades": { "on": false, "depth": 2, "above": 0.5, "orientations": ["S"], "zones": ["middle", "top"] },
  "bands":  [],                        // [{ "zone": "base", "material": "precast" }] or [{ "every": 3, "material": "metal" }]
  "corners": "solid",                  // "solid" | "glass"

  "street": {
    "mode": "auto",                    // "auto" (section 3.10) | "manual"
    "manual": [],                      // face group ids chosen by hand
    "roadDistance": 60                 // ft, auto mode with a site
  },

  "checks": {                          // Caution: design values, not code values. Verify the edition and the path for each project.
    "wwrLimit": 0.40,
    "band": { "from": 2, "to": 10 },   // ground transparency band, ft above level 1
    "transparencyTarget": null         // null = off (decision 15); retail presets use 0.60
  },

  "envelope": {                        // Caution: typical seed values, not product data or code values. Verify every value.
    "on": false,
    "limits": { "uFixed": 0.45, "shgc": 0.25 },
    "glazing": {
      "igu":       { "label": "IGU with low-e", "u": 0.29, "shgc": 0.25 },
      "laminated": { "label": "Laminated single pane", "u": 1.00, "shgc": 0.70 }
    },
    "walls": { "eifsCmu": { "label": "EIFS over CMU", "u": 0.09 } },
    "glazingDefault": "igu", "wallDefault": "eifsCmu"
  },

  "materials": ["eifsCmu", "metal", "brick", "fiberCement", "precast"],

  "view": {
    "style": "model", "colorBy": "system",   // "system" | "wwr"
    "elevation": null,                       // null = 3D; "N" | "E" | "S" | "W" = orthographic elevation
    "mullions": true, "context": true, "grid": true, "figure": true, "shadows": true,
    "sun": { "azimuth": 135, "altitude": 40 }
  }
}
```

**Default state:** preset "Residential punched windows with inset balconies" (section 8.1).

**Storage:** key `facade.options.v1`, schema 1, through `createStorage`. The store deep-merges a loaded state over the default state. `migrate` returns the state unchanged for schema 1.

---

## 3. Facade pipeline

```
state (+ project) → levels → rings → edges (merge) → faces with bearings and sectors
      → zones → face groups → street faces → rules → panels → corners → balconies
      → fins, shades, bands → areas → checks → exposure → metrics → derived
```

Every step is a pure function. Clipper runs only to build standalone shapes, at `SCALE = 1000`. Coordinates round to 0.001 ft, areas to 0.1 sf. The same inputs always give the same result.

### 3.1 Step 1 — Levels

- **Project:** read `sections.massing.derived.levels`. Skip levels with zone `deck` or `crown` (decision 16). Skip levels whose `plates` are empty (void floors). Keep `index`, `zone`, `z`, `ftf`, `program`, `plates`.
- **Standalone:** build the levels from `state.standalone`. Podium levels come first: level 1 with `ftf1`, levels 2 to P with `podium.ftf`, all with the podium rectangle, zone `podium`. Main-shape levels follow, `floors` of them: the first one uses `ftf1` when there is no podium, every other one uses `ftf`; zone `main`. `z` accumulates from 0.
- Standalone shapes, before `angle`: rect `W × D`; L = a south bar `W × arm` plus a west bar `arm × D`; U = south bar plus a west and an east bar, each `arm × D`, open to the north; O = the rect minus a centered court `courtW × courtD`. Rotate every ring by `angle` about the origin. Clean with `cleanRing2` (outer counter-clockwise, holes clockwise).

### 3.2 Step 2 — Edges and merge

For each level and each ring (outer and holes), walk the ring edges. Merge two consecutive edges when their directions differ by less than 0.5 degrees. Drop edges shorter than 0.1 ft. Each edge keeps its ring id (0 = outer, k = hole k).

A vertex is **convex** when the turn from the incoming edge to the outgoing edge has the same sign as the ring orientation (left turn on a counter-clockwise ring). Each edge records `convexStart` and `convexEnd`.

### 3.3 Step 3 — Normal, bearing, and sector

- Edge from `a` to `b`, direction `d = b − a`. Outward normal `n = (d.y, −d.x) ÷ |d|`. This one rule works for both rings, because cleaned holes run clockwise: on a hole the normal points into the court.
- Rotation `r` = `placement.rotation` (project source) or 0 (standalone; `angle` is already in the rings).
- Project normal: `px = nx cos r − ny sin r`, `py = nx sin r + ny cos r`.
- Bearing = `atan2(px, py)` in degrees, mod 360 (0 = north, clockwise).
- Sector: N for 315 ≤ b or b < 45; E for 45 ≤ b < 135; S for 135 ≤ b < 225; W for 225 ≤ b < 315.

Checks: a counter-clockwise square, bottom edge `(0,0) → (1,0)`: `n = (0, −1)`, bearing 180, S. With `r = 90`: the north normal `(0, 1)` becomes `(−1, 0)`, bearing 270, W.

### 3.4 Step 4 — Zones

**Default mode:** base = every level with zone `podium`; with none, the lowest level. Top = the highest level, unless it is already base. Middle = every other level. One level gives base only. Two levels give base and top.

**Ranges mode:** each range covers `from` to `to` (level indices, inclusive). A level in no range falls back to the default zone it would have.

The rule for a face = `zones.rules[zone]`, merged with `zones.overrides[zone][orientation]`, merged over `systems[rule.system]` defaults.

### 3.5 Step 5 — Face groups

Faces on consecutive levels join one group when: the same zone, the same ring, both end points within 1 ft, and the direction within 1 degree. Group fields: `id` (`F1`, `F2`, … in order of first level, then ring, then edge), `levelFrom`, `levelTo`, `levels`, `a`, `b`, `length`, `bearing`, `orientation`, `zone`, `ring`, `convexStart`, `convexEnd`, `height` (Σ ftf). A tapered or twisted tower gives one group per level.

### 3.6 Step 6 — Panels

Caution: these are design defaults. They are not product sizes or code values.

Panel count `n = max(1, floor(L ÷ module))`. Actual module `m = L ÷ n` (decision 14). Panel `i` spans `u ∈ [i·m, (i + 1)·m]` along the face from `a`.

Glazing per panel, with `h` = the level `ftf` (every height clamps to `[0, h]`):

| System | Glass in a glazed panel |
|---|---|
| `punched` | One window `min(windowW, m)` wide, centered, from `sill` to `min(head, h)` |
| `windowWall` | Full module width, from 0 to `h − slabCover` |
| `curtainWall` | Full module width, from `sill` to `min(sill + vision, h)`; spandrel = the rest |
| `storefront` | Full module width, from `sill` to `min(head, h)` |
| `solid` | None |

- **Solid pattern:** with `solid: { count, every }`, panel `i` is solid when `i mod every ≥ every − count`.
- **Glazing area** is the full opening (decision 6). Mullions draw but do not reduce the area.
- **Wall area** of a face on a level = `L × h`. Parapets and screens add none (decision 16).

### 3.7 Step 7 — Corners

With `corners: "glass"`: on every face whose start vertex is convex, panel 0 becomes glass from 0 to `h − slabCover` (slab cover from the window wall defaults); the same for the last panel when the end vertex is convex. This overrides the solid pattern and the window size (change 5). Storefront panels keep their own glass.

### 3.8 Step 8 — Balconies

On levels in `balconies.zones` and faces in `balconies.orientations`:

| Pattern | Balcony modules on level k (k = the level index) |
|---|---|
| stacked | `i mod s = 0` |
| alternating | `(i − o) mod s = 0`, with `o = (k mod 2) × floor(s ÷ 2)` |
| checker | `(i − k) mod s = 0` (shifts one module each level) |
| per-unit | one balcony per unit facade (below) |

`s` = `spacing`. A balcony module places a door `door.width × door.head` (sill 0) instead of the window (change 7). The balcony sits centered in its module, `width` wide, `depth` deep. A projected balcony is a slab outside the face, `slab` thick, at the level floor. An inset balcony cuts the plate back by `depth`; its door stands at the recessed plane and counts as glazing (decision 14); the back wall replaces the face strip one for one; the side returns are not wall area (change 6).

**Per-unit:** read `plates.derived.levels` with the same `index` (else the nearest lower filled level with an identical plate). For each unit, take its facade edges (the unit ring edges that lie on a face within 0.5 ft). Use the longest one. Place one balcony centered on that segment, snapped to the nearest module. Without plates data, fall back to stacked and say so in the panel.

Balcony area = `width × depth` each.

### 3.9 Step 9 — Fins, shades, and bands

- **Fins:** one fin at every `every`-th module line on matching faces and zones, `depth` deep and `width` thick, full level height. No area change.
- **Shades:** one shade per glazed panel, `depth` deep, `above` ft over the window head. Projection factor `PF = depth ÷ (head − sill + above)`. Caution: energy codes credit shades only by their own rules. Verify any credit against the adopted code.
- **Bands:** a material per zone, or every n levels. No area change.

### 3.10 Step 10 — Street faces and ground transparency

Street faces, `street.mode`:

- **auto, no site:** every face group on the lowest level with orientation S.
- **auto, with a site:** a face group on the lowest level is a street face when its midpoint (in the project frame, through `toProject`) lies within `roadDistance` of a road centerline in `sections.site.derived.roads.segments`, and its normal points toward that road (dot product > 0).
- **manual:** the ids in `street.manual`.

Caution: zoning codes set their own band and target. Verify both against the adopted code.

Transparency = Σ (glass area inside the band) ÷ Σ (`L × (band.to − band.from)`), over street faces. The band runs from `zGround + band.from` to `zGround + band.to`, where `zGround` is the lowest level `z`. Glass from any level that falls inside the band counts. The target check runs only when `transparencyTarget` is set.

### 3.11 Step 11 — Areas and checks

Caution: the 40 percent limit is the prescriptive path of ASHRAE 90.1-2019 for this climate. The performance path may allow more glass. Verify the edition and the path for each project.

| Quantity | Formula |
|---|---|
| Wall | Σ `L × h` over every face and level |
| Glazing | Σ glass rectangles (windows, doors, curtain wall vision, corners) |
| WWR | glazing ÷ wall; also per orientation, per zone, per system |
| Worst orientation | the orientation with the highest WWR |
| WWR check | `wwr ≤ wwrLimit` overall; each orientation shown against the limit; the tool never writes "compliant" |
| Balconies | count; area |
| Projection factor | per shade rule |

### 3.12 Step 12 — Envelope note and exposure

- **Envelope note** (when on): for each zone, the glazing type's U and SHGC against `limits`, and the wall type's U. Plain text lines. No calculation beyond the comparison.
- **Exposure** (when `sections.sun.derived.samples` exists): for each face group and each sample with `altitude > 0`, add `cos(alt) × cos(az − bearing)` when that cosine is positive. Per orientation: the length-weighted mean over its face groups. Divide each by the largest (most exposed = 1.00). Without samples, `exposure: null` and the panel says "Run a sun study in the Tower Generator to see exposure."

### 3.13 Step 13 — Derived writer

`facadeDerived(state, built, metrics)` writes spec 6.5 plus the additive keys:

- `faces[]`: one per face group: `id`, `levelFrom`, `levelTo`, `orientation`, `system` (of its zone rule), `area`, `glazing`, `wwr`, `balconies` (count), `edge` (`[a, b]`, local frame), `bearing`, `zone`, `street`.
- `metrics`: `wwr`, `wwrByOrientation { N, E, S, W }`, `groundTransparency` (null without street faces), `facadeArea`, `glazingArea`, `balconyCount`, `balconyArea`, `wwrLimit`, `exposure` (or null).

---

## 4. Module contracts

Pure ES modules. No DOM, no Three.js, no hidden state, no mutation of inputs. One-line relative imports only. Every export starts a line with `export function` or `export const`.

```js
// src/facade/faces.js
export const SECTORS = ["N", "E", "S", "W"];
export function standaloneLevels(standalone)          // → Level[] (section 3.1): { index, zone: "podium"|"main", z, ftf, program: null, plates: MultiPoly }
export function massingLevels(state, project)        // → { levels: Level[], rotation, source: "project"|"standalone", notes: [string] }
export function bearingOf(normal, rotationDeg)       // → degrees clockwise from north, [0, 360)
export function sectorOf(bearing)                    // → "N" | "E" | "S" | "W"
export function levelEdges(level, rotationDeg)       // → Edge[]: { levelIndex, ring, a, b, length, normal, bearing, orientation, convexStart, convexEnd }
export function zoneOf(state, levels)                // → { [levelIndex]: zoneId }
export function faceGroups(state, levels, rotationDeg) // → Group[] (section 3.5)
export function streetFaces(state, groups, levels, project) // → { ids: string[], source: "auto"|"auto-site"|"manual" }

// src/facade/panels.js
export function ruleFor(state, zoneId, orientation)  // → merged rule with system defaults (section 3.4)
export function panelize(length, module)             // → { n, module }
export function facePanels(face, rule, level, opts)  // → Panel[]: { i, u0, u1, kind: "window"|"glass"|"spandrel"|"solid"|"door"|"corner", glass: [{ u0, u1, v0, v1 }] }
export function buildFacade(state, { project = null, quality = "full" } = {})
  // → { source, rotation, levels, groups, faces: Face[], balconies: Balcony[], fins, shades, street, warnings }
  // Face = { id: "<group>@<level>", groupId, levelIndex, z, ftf, a, b, length, orientation, bearing, zone, street, rule, n, module, panels, glazing, wall }

// src/facade/balconies.js
export function balconyModules(pattern, n, levelIndex, spacing)   // → number[] (section 3.8)
export function unitBalconies(face, unitsLevel, module)           // → number[] module indices from Plate Planner units
export function balconyGeometry(face, i, balconies)               // → { type, plan: Ring, z0, z1, door: { u0, u1, v0, v1 } }

// src/facade/metrics.js
export function computeMetrics(state, built, project)   // → { wall, glazing, wwr, wwrByOrientation, wwrByZone, wwrBySystem, worst,
                                                       //     transparency, balconyCount, balconyArea, projectionFactors, exposure, envelope, wwrLimit }
export function exposure(groups, sunDerived)            // → { N, E, S, W } | null (section 3.12)
export function envelopeNote(state, built)              // → [string]
export function checks(state, metrics)                  // → Warning[]: wwr-limit, wwr-orientation, transparency, no-levels, tower-no-levels, per-unit-fallback

// src/facade/derived.js
export function facadeDerived(state, built, metrics)    // → facade.derived (section 3.13)

// src/facade/elevations.js
export function elevationGeometry(built, orientation)   // → { faces: [{ id, u0, u1, z0, z1 }], glass, spandrel, mullions, balconies, fins, shades, levels }
export function elevationsDxf(state, built, metrics)    // → DXF R12 text: four elevations side by side, 50 ft apart
                                                       //   layers FAC-WALL, FAC-GLASS, FAC-SPANDREL, FAC-MULLION, FAC-BALCONY, FAC-FIN, FAC-SHADE, FAC-LEVEL, FAC-COURT, FAC-TEXT

// src/facade/sketchup.js
export const SKETCHUP_SOURCE = "facade";
export function facadeToSketchup(state, built, metrics, meta)   // → doc from makeDoc(); groups Walls (faces with window holes), Glass (faces),
                                                                 //   Spandrel (faces), Balconies (solids), Fins (solids), Shades (solids); tags by system

// src/facade/presets.js
export const PRESETS            // [{ id, name, description, state }] section 8
export function defaultState()

// src/facade/testcases.js
export const TEST_CASES         // [{ id, state, project?, expect: { wwr, wwrByOrientation?, transparency?, balconies?, wall?, glazing?, tolerance } }]
```

**Elevation projection:** for orientation N the viewer looks south: `u = −x`; S: `u = x`; E: `u = y`; W: `u = −y`, in the project frame after the rotation. `v = z`. Faces of other sectors are left out. Faces behind a nearer face (courtyard faces) go on layer FAC-COURT. The DXF is R12 (AC1009), units feet, like `src/site/exports.js`.

`buildFacade` is the only function that reads the project. `metrics`, `derived`, `elevations`, and `sketchup` read its result.

---

## 5. Interface

### 5.1 Tabs

Same panel, tabs, and top bar as the Parking Deck. Tab order: Massing, Facade, Checks, View.

- **Massing tab:** source card (standalone or the open project's massing, with a note when the tower has not written levels), standalone card (shape, width, depth, arm, court, angle, floors, floor-to-floor heights, podium), zones card (default or ranges; add a range), street faces card (auto or manual; "Pick street faces" toggles plan selection).
- **Facade tab:** one card per zone: system buttons (punched, window wall, curtain wall, storefront, solid), the system's dimensions, the solid pattern, glazing type, material, and an orientation strip N/E/S/W that opens an override. Then balconies, fins, shades, bands, and corners cards.
- **Checks tab:** WWR limit, transparency band and target, envelope note table, each with its Caution line. A WWR table by orientation and zone.
- **View tab:** style, color by system or WWR, elevation buttons, mullions, context, grid, figure, shadows, sun.

### 5.2 Top bar

Option menu (presets, Save, Duplicate, Rename, Delete, Compare), Undo, Redo, Model/Diagram, Export menu (Image, AI-ready image, AI Prompts, SketchUp, Elevations DXF, Export JSON, Import JSON), Project menu (New, Open, Import, Export), Help. No Send item in version 1.

HUD, always visible: WWR, worst orientation, ground transparency, balconies. One tap expands facade area, glazing area, the orientation table, projection factor, exposure. The warning count stays visible.

### 5.3 Selection

- Click a face: the face card shows its orientation, zone, length, level range, system, and WWR, with a street toggle.
- No geometry handles in version 1. The massing comes from the source.
- Mac shortcuts: 1 to 6 views (axon, N, E, S, W, plan), D Model/Diagram, Escape clears.

### 5.4 iPad

Same bottom sheet as the Parking Deck in portrait. Buttons 44 points or larger.

---

## 6. Rendering

- Walls: one thin box per face and level (0.5 ft), white in Model style.
- Glass: instanced boxes per glass rectangle, pale blue-gray, opacity 0.45. Spandrels: instanced boxes in the zone material.
- Mullions: instanced thin boxes at panel lines, `mullionD` deep, when `view.mullions` is on.
- Balconies: instanced slab boxes; railings as lines. Inset balconies draw the recess as a dark box.
- Fins and shades: instanced boxes.
- Diagram style: faces colored by system, or by face WWR on a five-step light-to-dark scale with a legend.
- Elevation mode: an orthographic camera looking at the chosen sector. It matches `elevationGeometry`.
- Context: the site neighbors from `siteContextFor`, as in the other tools.
- Draft quality while a slider moves: skip mullions and fins. Full quality on release.
- Target: 4,320 panels (60 floors × 4 faces × 18 panels) at 60 frames per second on the Mac and 30 on the iPad.

---

## 7. Project file

Follows `docs/project-file-spec.md`.

- **Start:** `projectIdFromUrl` → `loadProject`. Load `sections.facade.state` when present. With a massing section, set `source: "project"`.
- **Reads:** `massing.derived.levels` and `massing.placement` (section 3.1 and 3.3); `plates.derived.levels[].units` (per-unit balconies); `site.derived.roads.segments` (street faces); `sun.derived.samples` (exposure).
- **Tower massing:** the Tower Generator writes levels once the work session adds `towerDerived`. A project whose massing tool is `tower` with no `derived.levels` shows the note "The Tower Generator does not write massing levels yet. Use the standalone massing." and the warning `tower-no-levels`.
- **Write:** `writeSection(doc, "facade", { tool: "facade", schema: 1, placement, state, derived })`, debounced 1 s, plus `visibilitychange` and `pagehide`. `placement` is a copy of the massing placement, or the identity for a standalone source.
- **Send to Facade Studio:** the integrator adds the item to the Mid-Rise Export menu (`ProjectUI.send('facade')`) and turns on the Parking Deck's planned item. The work session adds the same item to the Tower Generator (spec section 12 note).
- **No project:** the tool works standalone. The Project menu offers New, Open, Import, Export.

**Spec additions (the integrator edits `docs/project-file-spec.md` section 6.5):**

1. On each face: `"edge": [[x, y], [x, y]]` (local frame, on `levelFrom`), `"bearing"` (degrees clockwise from project north), `"zone"`, `"street": true|false`. All optional.
2. In `metrics`: `"facadeArea"`, `"glazingArea"`, `"balconyCount"`, `"balconyArea"`, `"wwrLimit"`, `"exposure": { "N", "E", "S", "W" } | null`. All optional.
3. A note: "`levelFrom` and `levelTo` are massing level indices. Glazing counts the whole window opening."

**SketchUp (integrator):** add `"facade"` to the accepted sources in `src/shared/sketchup-format.js` (`validateDoc`), `sketchup/cmrlm_design_tools/importer.rb`, and `docs/sketchup-spec.md`; rebuild the `.rbz`.

---

## 8. Presets

Phase 6 (Haiku) types these values into `src/facade/presets.js`. Every number follows section 3. Window = 6 × 5.5 = 33 sf (punched, sill 2.5, head 8). Door = 6 × 8 = 48 sf, so a balcony adds 15 sf. Window wall glass height at 10 ft = 10 − 1.3333 = 8.6667 (26/3). Storefront glass = 10 − 1.5 = 8.5 ft. Punched module counts: 300 → 21, 250 → 17, 220 → 15, 200 → 14, 170 → 12, 135 → 9, 120 → 8, 90 → 6, 65 → 4.

### 8.1 Residential punched windows with inset balconies (default)

| Item | Value |
|---|---|
| Massing | rect 300 × 65, 5 floors, `ftf1` 12, `ftf` 10, no podium (the Mid-Rise default bar) |
| Rules | punched on every zone |
| Balconies | inset, stacked, spacing 2, middle zone (levels 2 to 4), orientations N and S |

N and S: 21 modules, balconies on `i` = 0, 2, …, 20 = 11 per level × 3 levels = 33 per face. Glazing = 5 × 693 + 33 × 15 = 3,465 + 495 = 3,960. Wall = 300 × 52 = 15,600. **WWR 0.254.** E and W: 5 × 132 = 660 on 65 × 52 = 3,380: **0.195.** Overall `(2 × 3,960 + 2 × 660) ÷ 37,960 = 9,240 ÷ 37,960` = **0.243**. Balconies **66**, area 66 × 72 = **4,752 sf**. Transparency (S, target off): 693 ÷ 2,400 = **0.289**.

### 8.2 Hotel window wall

| Item | Value |
|---|---|
| Massing | rect 180 × 62, 24 floors at 10; podium 240 × 120, 2 levels, `ftf1` 18, podium `ftf` 15 |
| Rules | base: storefront; middle and top: window wall |

Tower: perimeter 484; glazing `484 × 26/3 × 24 = 100,672`; wall `484 × 10 × 24 = 116,160`. Podium: perimeter 720; glazing `720 × 8.5 × 2 = 12,240`; wall `720 × 33 = 23,760`. Overall `112,912 ÷ 139,920` = **0.807, fails**. N and S: `(37,440 + 4,080) ÷ (43,200 + 7,920) = 41,520 ÷ 51,120` = **0.812**. E and W: `(12,896 + 2,040) ÷ (14,880 + 3,960) = 14,936 ÷ 18,840` = **0.793**. Transparency (S, target off): **1.00**.

### 8.3 Hotel window wall with solid bands

Same massing and base. Middle and top: window wall with `solid: { count: 2, every: 5 }`. 180 ft faces: n = 36, solid when `i mod 5 ≥ 3` → 14 solid, **22 glazed**. 62 ft faces: n = 12, m = 5.1667, solid `i` = 3, 4, 8, 9 → **8 glazed**. Tower glazing `2 × 22 × 5 × 26/3 × 24 + 2 × 8 × 5.1667 × 26/3 × 24 = 45,760 + 17,194.7 = 62,954.7`. Overall `(62,954.7 + 12,240) ÷ 139,920` = **0.537, fails**.

### 8.4 Office curtain wall

| Item | Value |
|---|---|
| Massing | rect 200 × 90, 32 floors, `ftf1` 13.5, `ftf` 13.5, no podium |
| Rules | curtain wall, vision 8, sill 0, every zone |

WWR = 8 ÷ 13.5 on every face = **0.593, fails**. Wall `580 × 13.5 × 32 = 250,560`; glazing `580 × 8 × 32 = 148,480`. Transparency (S, target off): band 2 to 10 holds vision 2 to 8 → **0.75**.

### 8.5 Office curtain wall, one view face

Same massing. Every zone: curtain wall vision 8; overrides E, S, W: vision 4, `solid: { count: 1, every: 2 }`. N: `1,600 ÷ 2,700` = **0.593**. S (n = 40, 20 glazed): `400 ÷ 2,700` = **0.148**. E and W (n = 18, 9 glazed): `180 ÷ 1,215` = **0.148**. Overall per floor `(1,600 + 400 + 360) ÷ 7,830` = **0.301, passes**.

### 8.6 Podium retail storefront

| Item | Value |
|---|---|
| Massing | U 300 × 200, arm 65, 5 floors at 10; podium 300 × 200, 2 levels, `ftf1` 16, podium `ftf` 11 |
| Rules | base: punched with override S: storefront; middle and top: punched |
| Checks | transparency target 0.60 (decision 15) |

Podium per level: S storefront `300 × 8.5 = 2,550`; N 693; E and W 462 each → **4,167**; walls `1,000 × 16 = 16,000` and `1,000 × 11 = 11,000`. U faces per floor: S 300 (693), E and W 200 (462 each), two arm ends 65 (132 each), two inner sides 135 (297 each), court back 170 (396) → **2,871** on `1,270 × 10 = 12,700`. Overall `(2 × 4,167 + 5 × 2,871) ÷ (27,000 + 63,500) = 22,689 ÷ 90,500` = **0.251**. Transparency (S): 300 × 8 ÷ 2,400 = **1.00, meets 0.60**.

### 8.7 Courtyard multifamily with projected balconies

| Item | Value |
|---|---|
| Massing | O 250 × 220, arm 65, court 120 × 90, 5 floors at 10; podium 250 × 220, 1 level, `ftf1` 11 |
| Rules | base: solid; middle and top: punched |
| Balconies | projected, alternating, spacing 2, middle zone (levels 2 to 5), every orientation |

Windows per floor: `2 × 561 + 2 × 495 + 2 × 264 + 2 × 198 = 3,036`, five floors 15,180. Balconies: over four levels each face gets `2 × ceil(n/2) + 2 × floor(n/2) = 2n`; `Σn = 17 + 17 + 15 + 15 + 8 + 8 + 6 + 6 = 92` → **184 balconies**, doors add `184 × 15 = 2,760`. Wall: bars `1,360 × 10 × 5 = 68,000`; podium `940 × 11 = 10,340`. Overall `17,940 ÷ 78,340` = **0.229**. Balcony area `184 × 72` = **13,248 sf**. Transparency: **0** (solid podium; target off).

### 8.8 Tower glass corner with fins

| Item | Value |
|---|---|
| Massing | rect 90 × 90, 45 floors at 10; podium 100 × 100, 2 levels, `ftf1` 18, podium `ftf` 15 |
| Rules | base: storefront; middle and top: window wall, `solid: { count: 1, every: 3 }` |
| Corners | glass; fins every module, depth 1.5, E and W |

Per face n = 18; solid `i` = 2, 5, 8, 11, 14, 17; the glass corner turns `i` = 17 glazed → **13 glazed**. Tower glazing `4 × 13 × 5 × 26/3 × 45 = 101,400`; podium `400 × 8.5 × 2 = 6,800`. Wall `162,000 + 13,200 = 175,200`. Overall **0.618, fails**. Without glass corners: 12 glazed → `(93,600 + 6,800) ÷ 175,200` = **0.573**.

### 8.9 Concept example A (test case only)

Rect 300 × 65, 5 floors, `ftf1` 12, `ftf` 10, punched everywhere: N and S **0.222**, E and W **0.195**, overall `8,250 ÷ 37,960` = **0.217**; transparency (S) **0.289**. Variant A2 with base override S storefront: `(8,250 − 693 + 2,550) ÷ 37,960` = **0.266**; transparency **1.00**.

### 8.10 Concept example B (test case only)

Rect 90 × 90, 10 floors at 10. Curtain wall vision 8 → **0.800** on every face. Variant B2 (8.5 logic: N vision 8; E, S, W vision 4 with `solid: { count: 1, every: 2 }`): `(720 + 3 × 180) ÷ 3,600` = **0.350**.

---

## 9. Tests

### 9.1 Module tests (`test/facade.*.test.mjs`, run by `npm test`)

| # | File | Case | Expect |
|---|---|---|---|
| 1 | faces | `sectorOf` at 0, 44.9, 45, 134.9, 135, 224.9, 225, 314.9, 315 | N, N, E, E, S, S, W, W, N |
| 2 | faces | Counter-clockwise square edges | Bearings 180, 90, 0, 270 (S, E, N, W) |
| 3 | faces | Same square, rotation 90 | The north edge becomes W (bearing 270) |
| 4 | faces | Standalone angle 30 on a 300 × 65 rect | Long faces bearing 150 (S) and 330 (N) |
| 5 | faces | O 250 × 220, court 120 × 90 | 8 faces per level; court faces point into the court (the court's south side faces N) |
| 6 | faces | Collinear merge: a square with an extra vertex mid-edge | 4 edges |
| 7 | faces | Zones: 5 levels; 2 podium + 24; 1 level; 2 levels | base/middle/top as section 3.4 |
| 8 | faces | Face groups, rect 5 floors | 4 groups per zone (base 1, middle 3, top 1 level) |
| 9 | faces | Mid-Rise preset `double-bar` through `assemble` + `midriseDerived` | Same faces and lengths as the standalone 300 × 65 |
| 10 | faces | Tower state with a 45-degree twist over 10 floors, through `buildPlates` | One group per level; each face bearing changes by the same step per level; the total change equals the twist |
| 11 | panels | `panelize(300, 14)`, `(65, 14)`, `(10, 14)` | 21 / 14.286; 4 / 16.25; 1 / 10 |
| 12 | panels | Solid pattern `{2, 5}` on n = 36 and `{1, 2}` on n = 18 | 22 and 9 glazed |
| 13 | panels | Glass corner on punched 90 × 90 at 10 ft (n = 6) | 392 sf per face per floor (4 × 33 + 2 × 15 × 26/3) |
| 14 | balconies | Alternating spacing 2, n = 17, levels 2 to 5 | 9, 8, 9, 8 |
| 15 | balconies | Checker spacing 3, n = 6, levels 1 to 3 | {1, 4}, {2, 5}, {0, 3} (`(i − k) mod 3 = 0`) |
| 16 | balconies | Per-unit: a fixture with four 28 ft units on a 120 ft face | 4 balconies, one per unit |
| 17 | metrics | Presets 8.1 to 8.10 | WWR, orientation WWRs, transparency, balcony counts to 0.001 (areas to 0.1 sf) |
| 18 | metrics | Exposure: samples (az 180, alt 0) and (az 135, alt 60) on a square | S 1.00, E 0.261, N 0, W 0 |
| 19 | metrics | Street faces with a site: a road 40 ft south of the south face, and one 100 ft away | Street; not street |
| 20 | metrics | Shade depth 2, above 0.5, punched 2.5 to 8 | PF 0.333 |
| 21 | derived | Preset 8.7 through `facadeDerived`, `writeSection`, `validate` | Valid; every face has the additive keys; Σ face areas = wall |
| 22 | exports | Elevations DXF of preset 8.1 | Every layer; FAC-GLASS holds 5 × 21 − 33 windows + 33 doors on the S sheet |
| 23 | exports | SketchUp doc of preset 8.2 | `validateDoc` passes; source `facade` |

Every test that fixes a number writes the arithmetic in a comment.

### 9.2 In-page tests (`facade/index.html?test`)

- Shell: the default state builds; the HUD shows WWR 24.3 percent, worst orientation N or S 25.4 percent, transparency off, 66 balconies.
- Every preset loads with its expected WWR.
- Selection: a click on the south face opens the face card with S, 300 ft, and its WWR.
- Project: a fixture project with the Mid-Rise courtyard preset → source "project" → the faces match preset 8.7's massing; a tower project with no levels shows the note.
- Exports: SketchUp doc validates; the DXF and the JSON download.

### 9.3 Cade's live checks

1. Open each preset on the Mac. Compare the HUD with section 8.
2. On the iPad, switch a zone from punched to window wall; the WWR jumps and the 40 percent warning shows.
3. Mid-Rise courtyard preset → Send to Facade Studio → check the court faces and the balconies.
4. Export the elevations DXF and open it in AutoCAD or link it in Revit; check one elevation against the 3D view.

---

## 10. Build phases and file ownership

Phases 2 to 6 run in parallel. Each agent owns only its files.

| Phase | Model | Agent | Owns | Acceptance checks |
|---|---|---|---|---|
| 1 | Opus | Orchestrator | This plan | Cade's go |
| 2 | Opus | Faces | `src/facade/faces.js`, tests 1 to 10 (`test/facade.faces.test.mjs`) | Tests pass; normals, bearings, and rotations checked by hand |
| 3 | Sonnet | Panels and metrics | `src/facade/panels.js`, `balconies.js`, `metrics.js`, tests 11 to 20 (`test/facade.panels.test.mjs`) | Tests pass; test 17 matches section 8 for every preset (a hand faces fixture until phase 2 lands, then the real `faces.js`) |
| 4 | Sonnet | Exports | `src/facade/derived.js`, `elevations.js`, `sketchup.js`, tests 21 to 23 (`test/facade.exports.test.mjs`) | Doc validates; derived validates |
| 5 | Sonnet | Page | everything under `build/facade/`, `facade/index.html` (through its build) | Section 9.2 tests pass; screenshots at 1440 × 900 and 820 × 1180 |
| 6 | Haiku | Presets | `src/facade/presets.js`, `testcases.js` | Every preset loads; values match section 8 |
| 7 | Opus | Integrator and reviewer | `package.json` scripts, `README.md`, `index.html` Workspace card, `build/midrise` and `build/parking` Send items, `docs/project-file-spec.md` 6.5 additions, SketchUp `facade` source, `docs/suite-roadmap.md` | `npm test` green; all in-page tests green; ten hand WWRs checked |
| 8 | Cade | — | — | Section 9.3 |

**Interfaces:** section 4 fixes every signature. The page agent codes against them and reports problems; it does not edit `src/`. The panels agent owns `buildFacade`; it imports `faces.js` with one-line imports and codes against section 4 until phase 2 lands. The page registers every module in `build/facade/build.py` MODS in import order, including `midrise/bars.js` when a module imports it.

**Integrator edits outside the facade folders:**

1. `build/midrise/08_ui.js`: an Export item "Send to Facade Studio" → `ProjectUI.send('facade')`, plus its in-page test.
2. `build/parking/`: turn the planned "Send to Facade Studio" item on; update its in-page test.
3. `index.html`: the Facade Studio card opens `facade/`.
4. Spec 6.5 additions (section 7) and the SketchUp source (section 7).

---

## 11. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| Normals point the wrong way | WWR by orientation is wrong | One normal rule on cleaned rings; tests 2 to 5 |
| Rotation applied twice | Every face in the wrong sector | Standalone angle goes into the rings; only the project placement goes into `bearingOf`; tests 3 and 4 |
| Twisted towers give thousands of faces | Slow updates | Instanced meshes; draft quality while a slider moves |
| The tower writes no levels yet | No tower faces from a project | The note and the standalone massing; the work session adds `towerDerived` |
| Inset returns left out of wall area | A slightly lower wall area than an energy model | The rule is stated in the Help panel and the notes; a later version can count returns |
| WWR differs from an energy model | Two numbers for one building | The glazing rule is stated in the panel and the export |
| Code values differ by edition and path | A wrong limit | Editable tables; Caution lines; the tool never says "compliant" |
| Per-unit balconies with no plates data | No balconies where the user expects them | Fallback to stacked with a warning |

Open items:

1. Curved plates come in as straight edges. A later version can panelize arcs.
2. Neighbor shadows on the facade are not in the exposure. The View Study can add them later.
3. The Facade Studio has no Send item in version 1. The Grading Sketch and the Egress Sketch do not read the facade.
