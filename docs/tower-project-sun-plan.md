# Tower Generator — Project File and Sun Study Plan

Version 0.1 · October 22, 2026 · Owner: Cade (CMRLM) · Author: Opus (orchestrator)
Source: `docs/project-file-spec.md` section 12 ("Tower Generator"), sections 4, 6.2, 6.6, 8, 10, 11, and Cade's go on October 22, 2026.

This plan is the instruction set for the build phases. Each build agent gets this plan, `docs/project-file-spec.md`, `docs/tower-generator-technical-plan.md`, and `docs/v1.1-spec.md`.

---

## 1. Scope and decisions

### 1.1 What this work adds

1. `towerDerived(state, built)`: the tower writes `massing.derived` (spec 6.2). The Plate Planner, the Facade Studio, and the Grading Sketch then read a tower massing.
2. Project file support: `?project=` load, autosave of the `massing` and `sun` sections, the Project menu, the project pill, read-only on a newer schema, and a replace check when the Mid-Rise wrote the massing.
3. Export menu: Send to Plate Planner, Send to Facade Studio, Send to Grading Sketch.
4. Site tab: Context from site, placement (x, y, rotation, baseZ), Center on site, and the site boundary and neighbors under the tower.
5. Sun Study: a real sun for a date, a time, and a place. Shadows follow it. A shadow-range sheet (3 dates × 3 times). A sun-hours grid on the ground. The tower writes `sections.sun`.

### 1.2 Decisions that bind the build

| # | Decision | Source |
|---|---|---|
| 1 | The home session builds this work. No work-session code exists. | Cade, October 22 |
| 2 | Study dates: spring equinox (March 20), summer solstice (June 21), winter solstice (December 21) | Cade, October 22 |
| 3 | Study times: 9:00, 12:00, 15:00 local. Dates and times stay editable. | Cade, October 22 |
| 4 | Default place without a site: Atlanta, 33.749, −84.388, US Eastern time | This plan |
| 5 | The project section `schema` stays 1. The tower option state moves to schema 2. | This plan (section 2.3) |
| 6 | Under the tower: the site boundary and the neighbor buildings, as in the Mid-Rise. No ground mesh in this version. | Spec 12, Mid-Rise parity |
| 7 | Sun hours use flat ground at the tower ground floor. Terrain does not cast or receive shadow in this version. | This plan |
| 8 | Sun hours compute on demand (a Compute button), never on every slider move | This plan (cost, section 3.6) |
| 9 | The tower never edits another section. The FFE rule of spec section 4 applies: a `grading.derived.ffe` tier for `massing` wins over `placement.baseZ` for display. | Spec 4, 5 |
| 10 | Generic names only. Feet, square feet, degrees. | Suite rule |

### 1.3 Reuse

| Reused verbatim | Copied and changed | New |
|---|---|---|
| `src/shared/project.js`, `storage.js`, `screenshot.js` | `build/midrise/09b_project.js` → `build/tower/09b_project.js` | `src/tower/derived.js` |
| `src/tower/geometry.js` (`buildPlates`, `computeMetrics`, `multiPolyArea`) | Mid-Rise Site-tab placement controls | `src/shared/solar.js` |
| `src/shared/sketchup-format.js` (`cleanRing2`) | Mid-Rise boundary and neighbor drawing | `src/tower/sunhours.js` |
| The tower's existing shadow light (`06_render.js`, `view.sun`) | — | `build/tower/06c_site.js`, `06d_sunhours.js`, `08d_sun.js`, `10b_sunstudy.js`, two test parts |

---

## 2. State

### 2.1 Schema 2 additions

All lengths are feet. Angles are degrees. Times are minutes after local midnight.

```jsonc
{
  "schema": 2,
  // … every schema 1 key, unchanged …
  "placement": null,                         // { x, y, rotation, baseZ } when a project with a site is open (spec 4)
  "context": { "show": true, "fromSite": false, "radius": 600, "blocks": [ … ] },
  "sun": {
    "mode": "manual",                        // "manual" = the schema 1 azimuth and altitude sliders; "study" = date, time, place
    "place": { "source": "default", "lat": 33.749, "lon": -84.388 },   // source: "default" | "site" | "typed"
    "tz": { "zone": "us-eastern", "offset": -5 },   // zone: us-eastern | us-central | us-mountain | us-pacific | us-arizona | fixed
    "dates": ["03-20", "06-21", "12-21"],    // month-day; the year is the current year
    "date": "03-20",                         // the date on screen
    "time": 720,                             // 12:00
    "times": [540, 720, 900],                // 9:00, 12:00, 15:00 (the study sheet)
    "play": false,                           // animation, not saved (reset to false on load)
    "hours": { "on": false, "spacing": 10, "step": 30, "date": "03-20", "extent": "site" }   // extent: "site" | "local"
  },
  "view": { … "sun": { "azimuth": 135, "altitude": 40 } … }   // unchanged; in "study" mode the study writes it
}
```

### 2.2 Migration from schema 1

`migrateTower(state, from)` in `build/tower/03a_state.js`, passed to `createStorage({ migrate })` in `09_storage.js`:

1. `from === 1`: add `placement: null`, `context.fromSite: false`, `context.radius: 600`, and the full `sun` default with `mode: "manual"`. Keep `view.sun` as it is, so an old option looks the same.
2. Set `schema: 2`.
3. A schema 3 or newer option opens read-only (the storage.js rule, unchanged).

`fillDefaults` keeps its deep merge over the default state. The default state carries every schema 2 key.

### 2.3 Section schema and option schema

The project section `massing` keeps `schema: 1`. The `derived` shape does not change (spec 6.2), and the Workspace page shows "Newer version" for any section schema above 1. `CONFIG.projectSchema = 1` (new). `CONFIG.schema = 2` is the option schema only. The `state` inside the section carries `schema: 2`. The `sun` section also uses `schema: 1`.

---

## 3. Pipeline and math

### 3.1 `towerDerived(state, built)` → `massing.derived`

Input: `built = buildPlates(state)` (`{ plates, solids, warnings, floors }`) and `metrics = computeMetrics(state, built.plates)`.

| `derived` key | Rule |
|---|---|
| `footprint` | Clipper union (SCALE 1000) of every non-void plate polygon and every crown solid polygon. Rings cleaned with `cleanRing2`. |
| `height` | `metrics.totalHeight` |
| `levels[]` | One entry per plate, in plate order, then one crown entry when `metrics.crownHeight > 0` |
| level `index` | `plate.n` (1 = ground floor). The crown level takes `last n + 1`. |
| level `name` | "Floor n"; the crown level "Crown" |
| level `zone` | `plate.zone` (`podium`, `tower`, `mechanical`); the crown level `crown` |
| level `z`, `ftf` | `plate.z`, `plate.ftf`; the crown level `z = metrics.topOfFloors`, `ftf = metrics.crownHeight` |
| level `program` | `plate.program` (mechanical floors: `mechanical`; crown: `null`) |
| level `plates` | `plate.polygons` as `MultiPoly`, rings cleaned; a void plate (full carve) writes `[]` |
| level `core` | `plate.coreRect` ring, or `null` |
| level `spines`, `seeds` | `[]` |
| crown `plates` | The footprint of the lowest crown solid (`solids` with role `screen`, `crown`, or `spire`). A flat crown (parapet only, `crownHeight` 0) writes no crown level. |
| `context.blocks` | `state.context.blocks` |
| `metrics` | `{ gfa, far, siteCoverage, floors: floorCount, height: totalHeight, units }` with `units` = the sum of `byProgram[p].unitsWhole` for `residential` and `hotel` (keys count as units) |

All coordinates stay in the tower local frame (site rectangle centered on the origin, north = +y). Rounding: 0.001 ft, areas 0.1 sf.

Check: the sum of `multiPolyArea(level.plates)` over levels with `zone !== "crown"` equals `metrics.gfa` within 0.1 sf.

### 3.2 Placement and frames

- `placement` maps tower local coordinates to the project frame (spec 4). Rotation `r` is counter-clockwise from project north to local +y.
- The view's sun direction is in the local frame. A true bearing `A` (clockwise from north) becomes a local azimuth `A + r`. `view.sun.azimuth = (A + r) mod 360`. The plan view north arrow turns by `−r`.
- Center on site: `x, y` = the site center; `baseZ` = the site ground (`groundAt`) at the center, to 0.1 ft. Copy `centerOnSite` from the Mid-Rise.
- Context from site: `siteContextFor(doc, placement, radius)` → `blocks`. Replace `context.blocks`, set `fromSite: true`. One undo step. A Keep option merges the manual blocks with the site blocks. Copy `contextFromSite` from the Mid-Rise.
- FFE display: when `sections.grading.derived.ffe` holds a tier with `source: "massing"`, the Site tab shows "Grading Sketch sets the ground floor at N ft" and the lowest such tier's `ffe`. The `baseZ` field stays editable; the note says which one readers use.

### 3.3 Solar position (NOAA algorithm)

`sunPosition(lat, lon, dateUTC)` follows the NOAA Solar Calculator spreadsheet (Meeus). Angles in degrees; `rad()` converts.

| Step | Formula |
|---|---|
| Julian day | `JD = ms / 86,400,000 + 2,440,587.5` |
| Julian century | `T = (JD − 2,451,545) / 36,525` |
| Mean longitude | `L0 = (280.46646 + T (36,000.76983 + 0.0003032 T)) mod 360` |
| Mean anomaly | `M = 357.52911 + T (35,999.05029 − 0.0001537 T)` |
| Eccentricity | `e = 0.016708634 − T (0.000042037 + 0.0000001267 T)` |
| Equation of center | `C = sin M (1.914602 − T (0.004817 + 0.000014 T)) + sin 2M (0.019993 − 0.000101 T) + sin 3M · 0.000289` |
| Apparent longitude | `λ = L0 + C − 0.00569 − 0.00478 sin(125.04 − 1,934.136 T)` |
| Obliquity | `ε0 = 23 + (26 + (21.448 − T (46.815 + T (0.00059 − 0.001813 T))) / 60) / 60`; `ε = ε0 + 0.00256 cos(125.04 − 1,934.136 T)` |
| Declination | `δ = asin(sin ε · sin λ)` |
| Equation of time (min) | `y = tan²(ε/2)`; `EoT = 4 · deg(y sin 2L0 − 2e sin M + 4ey sin M cos 2L0 − 0.5y² sin 4L0 − 1.25e² sin 2M)` |
| True solar time (min) | `TST = (UTC minutes + EoT + 4 · lon) mod 1440` |
| Hour angle | `H = TST/4 − 180` (then into −180 … 180) |
| Zenith | `cos Z = sin φ sin δ + cos φ cos δ cos H` |
| Geometric altitude | `h = 90 − Z` |
| Refraction (arc-seconds) | `h > 85`: 0; `h > 5`: `58.1/tan h − 0.07/tan³ h + 0.000086/tan⁵ h`; `h > −0.575`: `1,735 + h(−518.2 + h(103.4 + h(−12.79 + 0.711 h)))`; else `−20.772/tan h` |
| Apparent altitude | `altitude = h + refraction / 3600` |
| Azimuth | `a = acos((sin φ cos Z − sin δ) / (cos φ sin Z))`; `azimuth = H > 0 ? (a + 180) mod 360 : (540 − a) mod 360` |

`sunPosition` returns `{ azimuth, altitude, altitudeGeometric, declination, eot }`. `azimuth` is a compass bearing: 0 = north, clockwise (spec 6.6).

`sunTimes(lat, lon, localDate, tz)` → `{ sunrise, noon, sunset }` in local minutes. Solar noon = `720 − 4 lon − EoT + 60 · offset`. Sunrise and sunset use the hour angle at altitude −0.833°: `cos H0 = (cos 90.833 − sin φ sin δ) / (cos φ cos δ)`, then `sunrise = noon − 4 H0`, `sunset = noon + 4 H0`. Iterate once with `δ` and `EoT` at the event time. Polar day or night returns `null` events.

### 3.4 Time zones

`tzOffset(zone, localDate, localMinutes)` → hours from UTC.

| Zone | Standard | DST |
|---|---|---|
| `us-eastern` | −5 | −4 |
| `us-central` | −6 | −5 |
| `us-mountain` | −7 | −6 |
| `us-pacific` | −8 | −7 |
| `us-arizona` | −7 | none |
| `fixed` | `tz.offset` | none |

US rule: DST starts on the second Sunday of March at 2:00 local standard time. It ends on the first Sunday of November at 2:00 local daylight time. The skipped hour (2:00 to 3:00 on the March date) maps forward. The repeated hour (1:00 to 2:00 on the November date) uses daylight time. For 2026 the dates are March 8 and November 1.

`dayPath(lat, lon, localDate, tzOffsetOrZone, stepMin)` → `[{ minutes, time: "HH:MM", azimuth, altitude }]` from 0:00 to 24:00 local at `stepMin`.

### 3.5 Shadows from the real sun

In `study` mode the Sun section writes `view.sun = { azimuth: A + r, altitude: max(h, 3) }` on every date or time change. The existing light code in `06_render.js` then places the light. Below the horizon (`h ≤ 0`): shadows off, a "Sun below the horizon" note, and the light at a low fixed angle. No change to the shadow code itself.

### 3.6 Sun hours

**Question per node:** a ground node is lit at time `t` when the ray from the node toward the sun misses every caster.

**Casters:** every non-void plate as a prism (`polygons` from `z` to `z + ftf`), every crown solid prism, and every context block shown (`x ± w/2`, `y ± d/2`, `0` to `h`). Casters transform to the project frame with the placement (or stay local without a project).

**Method (equivalent to the ray cast on flat ground):** for one sun direction, the ground shadow of a prism from `z0` to `z1` is the base polygon swept along the segment from `z0 · v` to `z1 · v`, where `v = −(sin A, cos A) / tan h` (feet per foot of height, pointing away from the sun). A node is shaded when it lies inside the union of all swept shadows.

1. For each sample time, compute `A` and `h`. Skip samples with `h ≤ 0`.
2. For each caster, build its shadow: convex polygon → the convex hull of the polygon moved by `z0 · v` and by `z1 · v`; other polygon → `ClipperLib.Clipper.MinkowskiSum(segment, polygon, true)` with the segment from `z0 · v` to `z1 · v`.
3. Union all shadows (Clipper, SCALE 1000).
4. Rasterize: for each grid row, intersect the row line with the union's edges, sort the crossings, and mark the nodes between pairs (even-odd). Cost per row = O(edges).
5. Add the sample's minutes to every lit node.

**Samples:** `t_k = sunrise + (k + 0.5) · step` while `t_k < sunset`. Each sample stands for `Δt_k = min(step, sunset − (sunrise + k · step))` minutes. Hours per node = Σ lit `Δt_k` ÷ 60. A node in full sun gets the day length exactly.

**Grid:** `extent: "site"` with a site: the site square, origin (0, 0), `n = floor(S / spacing) + 1` per side, project frame. Without a site: the tower site rectangle plus 300 ft on each side, local frame. Spacing 10 ft by default (5, 10, 20 offered).

**Cost (estimate):**

| Case | Nodes | Samples (equinox, 30 min) | Casters | Target time |
|---|---|---|---|---|
| 1,000 ft site, 10 ft grid | 101² = 10,201 | 25 | 48 (point tower) + context | under 2 s on the Mac, under 6 s on the iPad |
| Draft: 20 ft, 60 min | 51² = 2,601 | 13 | same | under 0.5 s |

**Draft mode:** while the form changes after a compute, the overlay shows "Out of date" and keeps the old colors. The iPad starts at 20 ft and 60 min. Compute runs in slices of 2 samples per animation frame with a progress bar, so the page stays responsive. A Cancel button stops it.

**Output:** `{ spacing, n, x0, y0, frame: "project" | "local", date, step, hours: Float32Array (row-major from the south), dayLength }`.

---

## 4. Module contracts

Pure ES modules. No DOM, no Three.js, no mutation of inputs. Every export starts a line with `export function` or `export const`. One-line relative imports only. Clipper through `globalThis.ClipperLib` at SCALE 1000.

```js
// src/tower/derived.js
export function towerDerived(state, built, metrics)   // → massing.derived (section 3.1); metrics optional (computed when missing)

// src/shared/solar.js
export const ATLANTA = { lat: 33.749, lon: -84.388 };
export function sunPosition(lat, lon, dateUTC)         // dateUTC: Date or ms → { azimuth, altitude, altitudeGeometric, declination, eot }
export function tzOffset(zone, localDate, localMinutes, fixedOffset)   // → hours (section 3.4); localDate "YYYY-MM-DD"
export function localToUTC(localDate, localMinutes, zoneOrOffset)      // → Date
export function sunTimes(lat, lon, localDate, zoneOrOffset)            // → { sunrise, noon, sunset } local minutes, or nulls
export function dayPath(lat, lon, localDate, zoneOrOffset, stepMin)    // → [{ minutes, time, azimuth, altitude }]
export function localBearing(trueAzimuth, rotation)                    // → (trueAzimuth + rotation) mod 360

// src/tower/sunhours.js
export function casters(state, built, placement)       // → [{ polygon: Ring, z0, z1, kind }] in the grid frame
export function shadowPolygon(caster, azimuth, altitude)   // → MultiPoly (section 3.6 step 2)
export function sunGrid(extentBox, spacing)            // → { spacing, n, nx, ny, x0, y0 }
export function sunHours(casterList, grid, samples, { onProgress, shouldStop } = {})
  // samples: [{ minutes, azimuth, altitude, dt }] → { hours: Float32Array, lit samples count, cancelled }
export function samplesFor(lat, lon, localDate, zoneOrOffset, stepMin)   // → samples with dt (section 3.6)
export function isLit(casterList, x, y, azimuth, altitude)   // → boolean; the direct ray cast, for tests
```

`sunHours` is synchronous per call. The page drives it in slices by calling it with a few samples at a time and adding the results.

### 4.1 New page parts (`build/tower/`)

| Part | Global | Contents |
|---|---|---|
| `06c_site.js` | `SiteLayer` | Site boundary and neighbor blocks under the tower when a project has a site |
| `06d_sunhours.js` | `SunLayer` | The sun-hours heat map: one ground quad with a canvas texture (nearest filter), the legend |
| `08d_sun.js` | `SunUI` | The Sun section (replaces `buildSun`), the study driver, play, the sun-hours controls and the compute loop |
| `09b_project.js` | `ProjectUI` | Project load, autosave, menu, pill, Send, placement, context from site |
| `10b_sunstudy.js` | `SunStudy` | The 3 × 3 shadow-range sheet |
| `12f_tests_project.js`, `12g_tests_sun.js` | — | In-page tests |

---

## 5. Interface

### 5.1 Top bar

- A Project button and menu (New, Open, Import, Export), and the project pill, as in the Mid-Rise.
- Export menu, after Import JSON: Send to Plate Planner, Send to Facade Studio, Send to Grading Sketch.

### 5.2 Site tab

New first section, **Project site** (shown only with a project open):

- The site name and size. "Center on site". Placement x, y, rotation (5-degree snap on the slider, any value typed), baseZ.
- The FFE note from the Grading Sketch (section 3.2).
- "Context from site" with a radius field (default 600 ft) and a Keep manual blocks toggle.
- A "Show site boundary and neighbors" toggle.

### 5.3 View tab: Sun section

Replaces the schema 1 Sun section.

- Mode: **Manual** (the schema 1 azimuth and altitude sliders) or **Date and time**.
- Date buttons: Mar 20, Jun 21, Dec 21, plus a date field.
- Time: a slider from sunrise to sunset in 15-minute steps, buttons 9:00, 12:00, 15:00, and Play (one hour per second, stops at sunset).
- Place: Site (when the project has a site, from `frame.lat`, `frame.lon`), Atlanta (default), or Typed latitude and longitude.
- Time zone: US Eastern (default), Central, Mountain, Pacific, Arizona, or a fixed offset.
- Readout: azimuth, altitude, sunrise, solar noon, sunset, "below the horizon" when it is.
- **Shadow study sheet**: one button. It makes the 3 × 3 PNG (section 6.3).
- **Sun hours**: date, spacing (5, 10, 20), step (15, 30, 60), Compute, Cancel, progress, Show toggle, legend, "Out of date" badge.

### 5.4 iPad

Same bottom sheet. Play and Compute buttons 44 points or larger. Sun hours default to 20 ft and 60 minutes on a touch device.

---

## 6. Rendering

### 6.1 Site layer

Copy the Mid-Rise drawing: the site boundary as a thin line just above the ground, in the local frame (`transformRing(placement, boundary, "toLocal")`). Neighbor buildings come in as context blocks through Context from site, so the existing context rendering draws them.

### 6.2 Sun-hours layer

- One horizontal quad at z = 0.05 ft covering the grid, in the local frame (grid corners transformed with `toLocal` when the grid is in the project frame).
- A canvas texture of `nx × ny` pixels, one per node, nearest filter, 75 percent opacity.
- Colors (hours of sun): 0–2 dark blue `#2c3e73`, 2–4 blue `#4f7fd1`, 4–6 green `#58a65c`, 6–8 yellow `#e3c34a`, 8 and more orange `#e0762f`. A legend in the corner.
- The layer hides in Diagram style and in AI-ready images.

### 6.3 Shadow study sheet

For each date (rows) and time (columns): set the study, switch to the Plan view (top orthographic), turn shadows on, and capture the canvas with `ShotMod.captureView`. Lay the nine images on one canvas with row and column labels ("Mar 20", "9:00") and a footer with the place, the time zone, and the CMRLM mark. Restore the view after. Download `<option>-shadow-study.png`.

---

## 7. Project file

Copy `build/midrise/09b_project.js` and change the tool details:

| Item | Tower value |
|---|---|
| `CONFIG.tool` | `"tower"` |
| Sections written | `massing` (always), `sun` (when `sun.mode === "study"` or a sun-hours result exists) |
| `massing` patch | `{ tool: "tower", schema: 1, placement, state, derived: towerDerived(...) }` |
| `sun` patch | `{ tool: "tower", schema: 1, placement: identity, state: { sun state }, derived }` |
| Replace check | When `massing.tool === "midrise"`, ask before the first write: "Replace the Mid-Rise massing with this tower?" |
| Send | `sendTo(storage, doc, "plate" | "facade" | "grading", "tower")` |

`sun.derived` (spec 6.6 plus additive keys):

```jsonc
{
  "lat": 33.749, "lon": -84.388, "tzOffset": -4, "zone": "us-eastern",
  "dates": ["2026-03-20", "2026-06-21", "2026-12-21"],
  "samples": [ { "date": "2026-03-20", "time": "09:00", "azimuth": 99.5, "altitude": 18.9 } ],   // every study date × time, plus each date hourly
  "sunHours": { "spacing": 10, "n": 101, "nx": 101, "ny": 101, "x0": 0, "y0": 0, "frame": "project", "date": "2026-03-20", "step": 30, "hours": [ … ] } | null
}
```

`tzOffset` is the offset on the first study date. `hours` round to 0.01 h. The Facade Studio already reads `samples` for its exposure numbers.

---

## 8. Test values

### 8.1 `towerDerived` against the presets

| Preset | GFA (sf) | Floors | Levels written | Height (ft) | FAR | Coverage | Units |
|---|---|---|---|---|---|---|---|
| Slim residential point tower | 349,278.8 | 47 | 48 (with the crown) | 503 | 15.52 | 0.444 | 256 |
| Office slab | 482,800.0 | 32 | 32 (flat crown: none) | 432 | 11.61 | 0.433 | 0 |
| Hotel on a podium | 399,200.0 | 28 | 29 (stepped crown) | 318 | 7.98 | 0.748 | 399 |
| L-shaped multifamily on podium | 591,875.0 | 23 | 23 | 245.5 | 10.35 | 0.839 | 228 |
| U-shaped multifamily on podium | 611,000.0 | 23 | 23 | 245.5 | 10.68 | 0.839 | 258 |

Values from `buildPlates` and `computeMetrics` on main (October 22, 2026). The test compares the level-area sum with `metrics.gfa` within 0.1 sf, and the other columns exactly.

### 8.2 Sun position, Atlanta (33.75, −84.39)

Two independent methods agree within 0.01°: the NOAA equations of section 3.3 and the PyEphem ephemeris. The test tolerance is 0.2°.

| Local time | UTC | Azimuth | Altitude (apparent) |
|---|---|---|---|
| 2026-03-20 12:00 EDT | 16:00 | 138.41° | 48.26° |
| 2026-06-21 09:00 EDT | 13:00 | 79.79° | 28.96° |
| 2026-06-21 12:00 EDT | 16:00 | 108.87° | 65.96° |
| 2026-12-21 12:00 EST | 17:00 | 170.31° | 32.21° |
| 2026-12-21 15:00 EST | 20:00 | 216.01° | 23.35° |

Sunrise and sunset (tolerance 2 minutes):

| Date | Sunrise | Sunset | Day length |
|---|---|---|---|
| 2026-03-20 | 7:37 EDT | 19:53 EDT | 12 h 15.7 min |
| 2026-06-21 | 6:23 EDT | 20:56 EDT | 14 h 32.6 min |
| 2026-12-21 | 7:34 EST | 17:37 EST | 10 h 03.2 min |

Solar noon on 2026-03-20: 13:45 EDT, altitude 56.30°.

Time zone checks: 2026-03-07 12:00 Eastern → −5; 2026-03-08 12:00 → −4; 2026-11-01 01:30 → −4 (repeated hour, daylight); 2026-11-01 03:00 → −5.

### 8.3 Sun-hours hand case

A 100 × 100 ft square tower, 10 floors of 10 ft (100 ft tall), flat crown, on flat ground at Atlanta, 2026-03-20 at solar noon (13:45 EDT, altitude 56.30°, azimuth about 180°).

- Shadow length north of the north face: `100 ÷ tan 56.30° = 66.70 ft`.
- `isLit` at 60 ft north of the north face, on the center line: false. At 72 ft: true.
- `sunHours` with one sample at that time on a 5 ft grid: the shaded nodes north of the tower reach 65 ft and stop before 70 ft.
- A node 500 ft south of the tower, full day, 30-minute step: hours = the day length, 12.26 h (±0.03).

---

## 9. Tests

### 9.1 Module tests (`npm test`)

| # | File | Case | Expect |
|---|---|---|---|
| 1 | `test/tower.derived.test.mjs` | Every preset through `towerDerived` | Section 8.1 table; level-area sum = GFA within 0.1 sf |
| 2 | same | Point tower crown level | Index 48, zone `crown`, `z` 483, `ftf` 20 |
| 3 | same | A full carve | That level has `plates: []`; its index stays |
| 4 | same | Every ring | Clean; outer rings counter-clockwise |
| 5 | same | Project round trip | `writeSection(newProject(), "massing", { tool: "tower", schema: 1, … })` validates; `getSection` returns the same derived |
| 6 | same | No mutation | Frozen state and plates pass |
| 7 | `test/solar.test.mjs` | The five reference positions | Within 0.2° (section 8.2) |
| 8 | same | Sunrise, sunset, noon | Within 2 minutes |
| 9 | same | Time zones and DST edges | Section 8.2 checks |
| 10 | same | `dayPath` | 24-hour path; altitude peaks at solar noon; azimuth 180° within 1° at noon in Atlanta |
| 11 | same | Polar cases | Latitude 80 in June: no sunset (`null`); in December: no sunrise |
| 12 | same | `localBearing` | 180 with rotation 90 → 270 |
| 13 | `test/tower.sunhours.test.mjs` | Section 8.3 shadow edge | Lit and shaded points as listed |
| 14 | same | `shadowPolygon` against `isLit` | 2,000 random nodes agree for a convex and an L-shaped caster |
| 15 | same | Full-day node | 12.26 h ± 0.03 |
| 16 | same | Rotation | A placement rotation of 90 turns the shadow with the frame |
| 17 | same | Cancel | `shouldStop` returning true stops with `cancelled: true` |
| 18 | `test/tower.presets.test.mjs` | Presets at schema 2 | Every preset has `placement`, `context.fromSite`, `sun`; GFA unchanged from section 8.1 |

### 9.2 In-page tests (`tower/index.html?test`)

- Project: open a fixture project with a site; the pill shows; Center on site sets x, y, baseZ; Context from site fills blocks; autosave writes `massing` after 1 s and keeps every other section; a newer section schema opens read-only; the Mid-Rise replace check asks once; Send to Facade Studio navigates to `../facade/?project=<id>`.
- Migration: a schema 1 option loads as schema 2 and looks the same (same `view.sun`, same plates).
- Sun: study mode sets `view.sun` from the date and time; Play advances the time; below the horizon turns shadows off; the place switches between Site, Atlanta, and Typed.
- Sun hours: Compute on a small grid finishes and shows the layer; a form change marks it out of date; Cancel stops it.
- Study sheet: makes one PNG of nine panels.

### 9.3 Cade's live checks

1. Open a project made in the Site Model. Center on site, Context from site. The neighbors appear.
2. Turn on Date and time. Play the summer solstice. Compare the noon shadow with a known building.
3. Compute sun hours on the iPad at 20 ft. Time it.
4. Send to the Facade Studio, the Grading Sketch, and the Plate Planner. Each opens the tower massing.

---

## 10. Build phases and file ownership

Three agents edit the same page. Phase 0 prepares every shared file, so phases 2 to 5 touch only the files each agent owns.

| Phase | Model | Agent | Owns | Acceptance checks |
|---|---|---|---|---|
| 0 | Opus | Integrator (prep) | `build/tower/build.py` (generic one-line import rewrite as in `build/site/build.py`; MODS for `towerDerived`, `solar`, `sunhours`, `project`; new parts in the part list); stub files for every new part (each defines its global with no-op methods); the hook lines in `06_render.js` (`SiteLayer.update`, `SunLayer.update`), `08_ui.js` (Sun section → `SunUI.build`, Project site section → `ProjectUI.buildSite`, the Project button, the three Send items calling `ProjectUI.send`), `13_start.js` (`ProjectUI.start()`, `SunUI.init()`, `__tower` hooks), `package.json` test lines | `python3 build/tower/build.py` runs; the page loads with the stubs; tower in-page tests still pass |
| 1 | Opus | Orchestrator | This plan | Cade's go |
| 2 | Opus | Solar and sun hours | `src/shared/solar.js`, `src/tower/sunhours.js`, `test/solar.test.mjs`, `test/tower.sunhours.test.mjs` | Tests 7 to 17 |
| 3 | Sonnet | Project and derived | `src/tower/derived.js`, `test/tower.derived.test.mjs`, `build/tower/09b_project.js`, `build/tower/06c_site.js`, `build/tower/12f_tests_project.js`, `build/tower/01_config.js` (schema 2, `projectSchema`), `build/tower/03a_state.js` (schema 2 defaults, `migrateTower`), `build/tower/09_storage.js` (pass `migrate`) | Tests 1 to 6; section 9.2 project and migration tests |
| 4 | Sonnet | Sun UI | `build/tower/08d_sun.js`, `build/tower/06d_sunhours.js`, `build/tower/10b_sunstudy.js`, `build/tower/12g_tests_sun.js` | Section 9.2 sun, sun-hours, and sheet tests |
| 5 | Haiku | Presets | `src/tower/presets.js` (schema 2 keys on every preset), `test/tower.presets.test.mjs` | Test 18 |
| 6 | Opus | Integrator and reviewer | Wiring checks, `README.md`, `docs/suite-roadmap.md`, `docs/project-file-spec.md` section 12 (mark done), `index.html` (How projects work: the Tower row), all builds | `npm test` green; every page's in-page tests green; handoff checks tower → Plate Planner, Facade Studio, Grading Sketch |
| 7 | Cade | — | — | Section 9.3 |

Rules for phases 2 to 5:

- An agent edits only its own files. A needed change in a shared file goes to the integrator in the final report.
- Phase 3 and phase 4 code against the contracts in section 4. Phase 4 calls `SolarMod` and `SunHoursMod` by the names in section 4.
- Phase 4 writes `state.sun` and `state.view.sun` only. Phase 3 writes `placement`, `context`, and the project. Neither writes the other's keys.
- Each agent runs `python3 build/tower/build.py` and the in-page tests. Playwright uses the scratchpad harness that routes the CDN to `node_modules`.

---

## 11. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| Sun hours on the iPad | A slow or frozen page | On demand only; slices of 2 samples per frame; draft 20 ft and 60 min on touch; Cancel |
| Non-convex plates (L, U, carves) | Slow Minkowski sums | Convex hull path for convex rings; Minkowski only for the rest; union once per sample |
| DST edges | Wrong offset for an hour twice a year | Explicit US rule with tests on both edges; a fixed offset option |
| Rotation sign | Shadows turned the wrong way | One function, `localBearing`, with a test; the plan view north arrow shows the frame |
| Schema 2 migration | Old options look different | `view.sun` kept; `sun.mode` "manual" after migration; an in-page test compares plates before and after |
| Old cached tower page reads a schema 2 option | It opens read-only | The storage.js notice explains it; refresh the page |
| Workspace shows "Newer version" | Confusion | The section `schema` stays 1 (section 2.3) |
| Send to Plate Planner before that tool merges | A missing page | Merge the Plate Planner first, or the integrator labels the item "Planned" until `plate/` exists |
| Terrain ignored in sun hours | Hours on slopes are approximate | Stated in the panel; a later version can read `grading.derived.ground` |
| Neighbors without heights | Weak shadows | The Site Model marks estimated heights; context blocks stay editable |

Open items:

1. A ground mesh from `site.derived.ground` under the tower is left for a later version (the Mid-Rise also draws only the boundary and neighbors).
2. Sun hours on building faces (not only the ground) belong to the Facade Studio later.
3. Sun hours for all three dates at once (a three-panel sheet) is a later option; version 1 computes one date per run.
