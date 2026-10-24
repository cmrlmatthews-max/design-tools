# Tower Generator — Technical Plan

> **Update, October 24, 2026:** the core moved to the Plate Planner. The Tower Generator no longer makes a core: no Core card, no `core` state key, no `core-outside` warning, no "Core area" or "Efficiency" row in the HUD. Every plate writes `coreRect: null` and `coreArea: 0`, and every level writes `core: null`. Net area is now GFA − mechanical area, shown as "Net area (before core)". Unit estimates use that net area, so they run higher than before. A saved state or import with a `core` key still loads; the key is dropped. Sections 3.6 (Core) and the efficiency and net-area rows in section 5 below describe the old behaviour. See `plate-planner-rework-plan.md` section 4.1.


Version 0.1 · October 20, 2026 · Phase 1 output (Opus)
Source: `tower-generator-concept.md` v0.1 with the decisions in section 12.

This plan is the instruction set for the build phases. Each build session gets this plan and the concept document.

---

## 1. Architecture

### 1.1 Core principle

The tool has one source of truth: the **state** object. The state is a plain JSON object that holds every setting.

Every change follows one path:

```
state  →  floor list  →  floor polygons  →  metrics + warnings
                                       →  3D meshes
```

- The floor list and the polygons come from pure functions. A pure function means a function that gives the same output for the same input and changes nothing else.
- The metrics and the meshes both use the same polygons. This rule keeps the numbers and the model in agreement.

### 1.2 Libraries

| Library | Use | Source |
|---|---|---|
| Three.js (pin one current version) | 3D view, cameras, lights, shadows | cdn.jsdelivr.net/npm, with an import map |
| Three.js add-ons: OrbitControls, BufferGeometryUtils | Camera control, merged meshes | Same package, `examples/jsm` |
| Clipper (JavaScript port, `clipper-lib`) | Polygon offset and boolean operations | cdn.jsdelivr.net/npm |

Boolean operation means the union, difference, or overlap of two shapes. Polygon offset means to move every edge of a shape in or out by one distance.

### 1.3 Files and hosting

**Recommendation:** Make one new GitHub repository, `design-tools`, for the full toolkit.

```
design-tools/
  index.html          ← simple menu page that links to each tool
  tower/
    index.html        ← the tower generator (one file)
  README.md
```

- Version 1 of the tower generator is one HTML file.
- Mark each reusable code section with a `/* SHARED: name */` comment.
- When the second tool starts, move the shared sections into `design-tools/shared/`.

---

## 2. State schema

All lengths are in feet. All areas are in square feet. All angles are in degrees.

```js
{
  schema: 1,
  name: "Option A",

  site: {
    shape: "rect",              // "rect" or "polygon"
    width: 250, depth: 200,     // used when shape = "rect"
    points: [],                 // [[x,y], ...] used when shape = "polygon"
    setbacks: { front: 10, back: 10, left: 10, right: 10 },
    heightLimit: 400,           // 0 = no limit
    stepback: { on: false, aboveHeight: 85, distance: 15 }
  },

  context: {
    show: true,
    blocks: [ { x: 0, y: -180, w: 200, d: 120, h: 60 } ]
  },

  podium: {
    on: true,
    floors: 4,
    groundFtf: 18,              // ftf = floor-to-floor height
    ftf: 14,
    shape: { type: "rect", w: 220, d: 170, radius: 0, points: [] },
    offset: { x: 0, y: 0 },
    program: "retail"           // ground floor program; upper floors use upperProgram
    upperProgram: "amenity"
  },

  segments: [                   // tower body, bottom to top; at least one
    {
      floors: 30,
      ftf: 10,
      program: "residential",
      shape: { type: "rect", w: 110, d: 80, radius: 0, points: [] },
      offset: { x: 0, y: 0 },   // shift: moves the full segment
      rotation: 0,              // fixed rotation of the segment
      taper: { x: 0, y: 0, curve: "linear" },   // % change from bottom to top
      twist: { deg: 0, start: 0, end: 1, curve: "linear" }, // start/end as 0–1 of segment height
      lean:  { x: 0, y: 0 }     // feet of movement at the top of the segment
    }
  ],

  setbacks:   [ { floor: 20, distance: 10, sides: ["front","back","left","right"] } ],
  mechanical: [ { afterFloor: 15, ftf: 16 } ],
  carves:     [ { startFloor: 22, endFloor: 23, kind: "corner", corner: "NE", w: 30, d: 30 } ],
  cuts:       [ { side: "front", angle: 30, startFloor: 1, endFloor: 999, depth: 20 } ],

  crown: { type: "flat", height: 20, steps: 3, slopeSide: "front" },

  core: { mode: "percent", percent: 20, w: 40, d: 30 },

  programs: { /* defaults in section 6; the user can edit them */ },

  targets: { gfa: 0, far: 0 },  // 0 = not set

  view: {
    style: "model",             // "model" or "diagram"
    colorBy: "zone",            // "zone" or "program"
    floorLines: true,
    shadows: true,
    sun: { azimuth: 135, altitude: 40 },
    grid: true,
    figure: true
  }
}
```

**Floor numbers:** Floor 1 is the ground floor. Podium floors come first. Tower floors continue the count. Mechanical floors take a floor number too.

---

## 3. Geometry pipeline

### 3.1 Step 1 — Floor list

Build an ordered list of floors from the bottom up. Each item holds:

```js
{ n, zone, program, segmentIndex, t, z, ftf }
```

- `zone` is "podium", "tower", "mechanical", or "crown".
- `t` is the position inside the segment, from 0 at the bottom floor to 1 at the top floor.
- `z` is the elevation of the floor surface above grade.

Insert mechanical floors at their `afterFloor` positions. A mechanical floor uses the plate of the tower floor below it.

### 3.2 Step 2 — Base shape

Make a polygon from the shape settings.

- Center every shape on (0, 0).
- Draw circles and ellipses with 96 segments. The area error is less than 0.1%.
- Draw corner radius with 8 segments for each corner.
- Make L-shapes and U-shapes from width, depth, and an arm width setting.

### 3.3 Step 3 — Transforms for each tower floor

Apply the transforms in this fixed order. The order changes the result, so do not change it.

1. **Taper.** Scale the base shape by `1 + (taper.x / 100) × curve(t)` in X and the same rule in Y.
2. **Setbacks.** Offset the shape inward by the sum of all setback distances at or below this floor. Apply each setback only to its chosen sides. For a side-only setback, cut the shape with a moved straight line on that side.
3. **Rotation.** Rotate by `segment.rotation + twist.deg × curve(twistT)`. `twistT` maps `t` into the twist start and end range.
4. **Translation.** Move by `segment.offset + lean × t`.
5. **Carves.** Subtract each carve volume that includes this floor.
6. **Cuts.** Cut the plate with each angled plane that includes this floor. At this floor, the plane becomes a straight line.

**Curves:** `linear` means `t`. `eased` means `t × t × (3 − 2t)`.

**Warning:** A large inward offset can make a plate disappear. Remove empty plates from the list and show a warning, for example "Floor 41 has no area after setbacks."

### 3.4 Step 4 — Podium plates

Podium floors use the podium shape and offset. They get no taper, twist, or lean.

### 3.5 Step 5 — Crown

The crown adds no floor area.

| Type | Geometry |
|---|---|
| Flat | No extra geometry. A parapet of 4 ft shows as a thin ring. |
| Stepped | `steps` smaller copies of the top plate, each offset inward. |
| Sloped | The top plate extruded to `height`, then cut by one sloped plane. |
| Spire | A thin cone at the center of the top plate. |
| Screen | A ring: the top plate minus an inward offset of 1 ft, extruded to `height`. |

### 3.6 Step 6 — Core

- The core is a rectangle at the center of the first plate of each segment.
- The core does not twist, lean, or taper. A real core is vertical.
- In `percent` mode, size the core to `percent` of the first plate area, with the plate proportions.
- On each floor, test whether the core fits inside the plate. Subtract the plate from the core. If the result has area, show a warning.

### 3.7 Data that each plate holds

```js
{ n, zone, program, z, ftf, polygons, area, coreArea, outsideEnvelopeArea }
```

`polygons` can hold more than one shape and holes. Carves can split a plate.

---

## 4. Zoning envelope

1. Make the allowed footprint: the site polygon offset inward by the setbacks.
2. If the stepback is on, make a second allowed footprint above `aboveHeight`: the first footprint offset inward by `distance`.
3. For each plate, subtract the allowed footprint at that elevation. If the result has area more than 1 sf, the plate is outside the envelope.
4. If the top of a floor or the crown is above `heightLimit`, that part is outside the envelope.

**Display:**

- Draw the envelope as a transparent wireframe.
- Color plates outside the envelope red in both visual styles.
- List each problem in the warnings panel. Group adjacent floors, for example "Floors 31–34 exceed the height limit."

---

## 5. Metrics

Calculate all metrics from the plate data in section 3.7.

| Metric | Formula |
|---|---|
| GFA | Sum of `area` for all plates, mechanical floors included |
| FAR | GFA ÷ site area |
| Site coverage | Floor 1 area ÷ site area |
| Total height | Top of the highest floor + crown height |
| Plate area | Smallest, largest, and average tower plate |
| Efficiency | (Plate area − core area) ÷ plate area, for each floor and as an average |
| Net area | GFA − all core area − all mechanical floor area |
| Unit estimate | For each program with a unit size: net area of that program × unit factor ÷ unit size |
| Target check | Current GFA or FAR minus the target, as a number and a percent |

**Note:** The concept document defines units as net area ÷ unit size. This plan adds a **unit factor** (default 85%) for corridors and walls. Without it, the unit count is too high. You can set the factor to 100% to remove it.

**Format:** Show areas as whole square feet with commas. Show heights as feet and inches, for example `312'-6"`.

---

## 6. Program defaults

All defaults are editable. Confirm or change these values.

| Program | Floor-to-floor | Unit size | Unit factor | Zone color (diagram style) |
|---|---|---|---|---|
| Residential | 10'-0" | 850 sf | 85% | Blue |
| Hotel | 10'-0" | 400 sf (one key) | 80% | Purple |
| Office | 13'-6" | — | — | Teal |
| Retail | 18'-0" | — | — | Amber |
| Amenity | 15'-0" | — | — | Green |
| Parking | 10'-6" | 350 sf (one space, gross) | 100% | Gray |
| Mechanical | 16'-0" | — | — | Orange |

---

## 7. Rendering

### 7.1 Scene

- One renderer for the full tool.
- Perspective camera for the 3D view. Orthographic camera for the elevations and the plan.
- OrbitControls for mouse, trackpad, and touch.
- A preset view moves the camera to its position over 400 ms.

### 7.2 Meshes

- Extrude each plate to `ftf − 0.5 ft`. The 0.5 ft gap makes the floor lines.
- When floor lines are off, extrude to the full `ftf`.
- Merge all plates of the same color into one mesh. This step keeps the draw count low on the iPad.

### 7.3 Visual styles

| Item | Model style | Diagram style |
|---|---|---|
| Mass material | White, matte, standard lighting | Flat color by zone or program |
| Edges | None | Dark outlines on all edges |
| Shadows | Soft shadows on | Off |
| Ground | Light gray | White |
| Context blocks | Light gray, 60% opacity | Light gray outlines only |
| Outside envelope | Red | Red |

### 7.4 Other scene items

- **Sun shadow:** One directional light. Azimuth and altitude sliders control it. Version 1 has no real sun path by date.
- **Grid:** 10 ft minor lines and 50 ft major lines.
- **Scale figure:** A simple 6 ft figure near the site front.
- **Context blocks:** Simple boxes. Edit them with number fields. A "Surround" button makes one block on each side of the site.

### 7.5 Performance

- Rebuild the model at most one time for each animation frame.
- While a slider moves: turn off shadows, and draw circles with 32 segments.
- When the slider stops: rebuild with full quality.
- Calculate metrics with full quality every time. The numbers must stay exact.
- **Target:** 60 frames per second on the Mac and 30 frames per second on the iPad, with a 150-floor tower, during a slider drag.

---

## 8. Interface

### 8.1 Layout

**Mac and iPad landscape:**

```
┌───────────────────────────────────────────────────────────┐
│ Option ▾ │ Save │ Duplicate │ Compare │ Model/Diagram │ 📷 │
├──────────────┬────────────────────────────────────────────┤
│ CONTROLS     │                                            │
│ ▸ Site       │                                            │
│ ▸ Podium     │               3D VIEW                      │
│ ▸ Segments   │                                            │
│ ▸ Form moves │                          ┌───────────────┐ │
│ ▸ Carves     │                          │ METRICS       │ │
│ ▸ Crown      │                          │ GFA  FAR  ... │ │
│ ▸ Core       │                          │ WARNINGS (2)  │ │
│ ▸ Programs   │                          └───────────────┘ │
│ ▸ View       │ [Axon][N][E][S][W][Plan]                   │
└──────────────┴────────────────────────────────────────────┘
```

**iPad portrait:** The 3D view fills the top. The controls move into a bottom sheet that you drag up or down.

### 8.2 Control rules

- Each slider has a number field next to it. Typed values can go past the slider range.
- Touch targets are 44 points or larger.
- Each section shows basic controls first. A "More" link shows the advanced controls.
- Undo and redo keep the last 50 changes. On the Mac, Command+Z and Command+Shift+Z run them.

### 8.3 Compare view

- Choose two to four saved options.
- The view splits into a grid. One renderer draws each option in its own area of the screen.
- One camera control moves all views together.
- A table under the views shows the main metrics for each option. The best value in each row shows in bold.

---

## 9. Saving and screenshots

### 9.1 Saving

- Store the options in browser storage under the key `towergen.options.v1`.
- Put every storage read and write in a try/catch block. If storage fails, the tool still works and shows one notice.
- Autosave the current state after each change, with a 1-second delay.
- **Export:** Download all options as one JSON file.
- **Import:** Choose a JSON file. The tool adds its options to the list and does not replace the current list.
- Each saved option holds a `schema` number. Future versions use it to update old files.

### 9.2 Screenshots

1. Render the current view at 2× screen resolution.
2. Draw the image on a 2D canvas.
3. Add the optional items: metrics block, title, date, and CMRLM mark.
4. On the Mac, download the PNG file.
5. On the iPad, open the share sheet with the PNG file. You can then save it to Photos or Files.

---

## 10. Presets

Phase 6 (Haiku) fills in the full values. These are the starting targets.

| Preset | Podium | Tower | Key moves |
|---|---|---|---|
| Slim residential point tower | 2 floors, retail and lobby | 45 floors, 90' × 90' plate, 10'-0" | Small taper, flat crown with screen |
| Office slab | None | 32 floors, 200' × 90' plate, 13'-6" | Two setbacks, flat crown |
| Hotel on a podium | 4 floors, 220' × 170' | 24 floors, 160' × 65' plate, 10'-0" | Stepped crown |
| L-shaped multifamily on podium | 6 floors, parking and amenity | 17 floors, L-shape, 10'-0" | 23 stories total, amenity deck on podium roof |
| U-shaped multifamily on podium | 6 floors, parking and amenity | 17 floors, U-shape (200' × 140', 50' arms), 10'-0" | 23 stories total, amenity deck on podium roof, U open to the back |

---

## 11. Code structure inside the file

One file, in this section order. `SHARED` marks code for the future toolkit.

| Section | Contents |
|---|---|
| `SHARED: styles` | Color tokens, fonts, panel and control styles |
| `CONFIG` | Program defaults, presets, limits |
| `SHARED: units` | Feet-and-inches format, area format |
| `SHARED: store` | State object, change events, undo and redo |
| `GEOMETRY` | Pure functions: floor list, shapes, transforms, crown, core |
| `ENVELOPE` | Allowed footprints and checks |
| `METRICS` | All formulas from section 5 |
| `RENDER` | Scene, cameras, meshes, styles, performance rules |
| `SHARED: controls` | Slider-with-number, toggle, select, accordion section |
| `UI` | Tower-specific panels |
| `SHARED: storage` | Save, load, export, import |
| `SHARED: screenshot` | Capture and annotation |
| `COMPARE` | Split view and table |
| `TESTS` | Calculation tests, run with `?test` in the address |

---

## 12. Build phases and acceptance checks

Each phase ends with a working file. Do not start a phase until the previous phase passes its checks.

| Phase | Model | Work | Acceptance checks |
|---|---|---|---|
| 2 | Sonnet | Shell: layout, 3D view, cameras, preset views, store with undo, units, controls library, one box tower from one segment, metrics panel with GFA and height | Box of 100' × 100' × 10 floors shows GFA 100,000 sf. Layout works on Mac and iPad sizes. |
| 3 | Sonnet | All shapes, podium, taper, twist, setbacks, mechanical floors, crown, core, all metrics, both visual styles | Twist does not change GFA. Linear taper GFA matches hand calculation within 0.5%. Core warning appears when the core does not fit. |
| 4 | Opus | Segments, shift, lean, carves, cuts | A carve removes the exact carve area. A cut matches hand calculation within 0.5%. Split plates show correct total area. |
| 5 | Sonnet | Site, envelope, stepback, warnings, context blocks, saving, export, import, screenshots, compare view | A tower 1 ft over the height limit shows a warning. Export, then import, gives the same metrics. Screenshot works on the iPad share sheet. |
| 6 | Haiku | Four presets, program defaults, test cases in the `TESTS` section | All presets load with no warnings except planned ones. All tests pass. |
| 7 | Opus | Review of geometry, metrics, and code; fix list | Opus checks 10 hand calculations against the tool. |
| 8 | You | Use on the Mac and the iPad | Your list of changes. |

---

## 13. Items for your confirmation

1. **Repository:** Do you approve a new `design-tools` repository with a menu page and a `tower/` folder?
2. **Unit factor:** Do you approve the added unit factor in section 5?
3. **Program defaults:** Do you approve the values in section 6?
