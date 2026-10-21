# Mid-Rise Generator — Concept Document

Version 0.1 · October 21, 2026 · Owner: Cade (CMRLM)

---

## 1. Purpose

The Mid-Rise Generator is a browser tool for fast massing studies of low and mid-rise multifamily buildings. It is the sibling of the Tower Generator. You arrange straight building bars on a site, and the tool shows the 3D form, the unit count, and the parking balance at the same time.

The tool is for conceptual design only. It does not replace Revit or SketchUp. It replaces the first hours of drawing bars in plan, counting units by hand, and checking the parking ratio on a calculator.

**Main goal:** Go from a site and a target unit count to three or four believable mid-rise options in less than 20 minutes.

**Users:** Cade and RJTR teammates. All names in presets, tests, and notes are generic. No client names.

---

## 2. Scope

### 2.1 Version 1 includes

- Six building types: garden walk-up, corridor garden, bar, courtyard, wrap, and podium.
- Bars with corners, courtyards, a wrap deck placeholder, and a podium.
- A site boundary with setbacks, a height limit, a density cap, an open space share, and a building separation minimum.
- Placement of the building on a real site from the Site Model.
- Live metrics: units, density, parking required against parking provided, and the tower metrics.
- Screenshots, saved options, the compare view, and the AI prompt library.
- The shared project file, with handoffs to the Plate Planner and the Parking Deck tool.
- SketchUp JSON export.
- Use on a Mac browser and on an iPad.
- Hosting on GitHub Pages.

### 2.2 Version 1 does not include

- Unit plans. The Plate Planner lays out units inside the plates.
- Parking deck design. The deck is a placeholder box. The Parking Deck tool designs it.
- Code checks for egress, construction type, or accessibility. The construction type line is a hint only.
- Curved bars. A bar is straight, or it bends at a corner.
- Structural, facade, or grading design.
- Multi-user access.

---

## 3. Form system

### 3.1 Basic model

The tool builds the building from bars. A bar is a straight stack of rectangular floor plates with a corridor down its length. The plates of all bars at one level union into one plate. The area math stays exact: the area of the building is the sum of the plate areas.

This is the same plate representation as the Tower Generator. The Plate Planner and the Facade Studio read both tools the same way.

### 3.2 Building types

| Type | What it is | Typical floors | Parking |
|---|---|---|---|
| Garden walk-up | Bars with breezeways and exterior stairs. A breezeway is an open-air passage through the bar that holds the stairs and the unit doors. | 3 to 4 | Surface lot |
| Corridor garden | Bars with an interior corridor and one or two elevators. | 3 to 4 | Surface lot |
| Bar | One or more bars with a double-loaded corridor. A double-loaded corridor has units on both sides. | 4 to 7 | Surface lot or small deck |
| Courtyard | Bars around one or more courts. | 4 to 7 | Surface lot, deck, or podium |
| Wrap | Bars that surround a parking deck. The deck is a placeholder box in this tool. | 4 to 5 | Wrapped deck |
| Podium | Bars on a one or two level concrete base of parking or retail. "Five over two" means five bar floors over two podium levels. | 4 to 5 over 1 to 2 | Podium levels |

Each type is a template. A template places the bars, the deck, and the podium as a starting arrangement. After that, every bar is free. The type stays as a label on the option.

### 3.3 Bars

Each bar has these controls.

| Control | What it does | Default |
|---|---|---|
| Start point and angle | Where the bar starts in plan and the direction it runs. | From the template |
| Length | Length along the corridor. | 240 ft |
| Depth | Width across the corridor. | 65 ft double-loaded, 38 ft single-loaded |
| Floors | Number of floors in the bar. | 5 |
| Floor-to-floor | Distance from one floor surface to the next. Ground floor has its own value. | 10 ft, ground 12 ft |
| Program | Program for the typical floors, and an optional ground floor program. | Residential |
| Corridor type | Double-loaded, single-loaded, or breezeway. | Double-loaded |
| Unit side | For single-loaded bars: which side holds the units. | Left |
| End conditions | Each end is open or holds a stair. | Stair at both ends |
| Bends | Up to two bends. A bend splits the bar into straight legs at an angle. | None |
| Unit width | Overrides the program default for this bar. | Program default |

A bar also shows its own numbers: units per floor, units total, and corridor length.

### 3.4 Corners and joints

Bars join at corners. One explicit joint rule applies everywhere, so the numbers stay predictable.

1. Two bars join when their plates overlap or touch within 0.5 ft at the same level.
2. The plates union into one plate. The overlap counts one time.
3. The corridor spines meet at a node. A spine is the corridor centerline. The ending spine extends or trims to the through spine.
4. The overlap square (depth by depth) is the corner zone. The tool marks it in the Diagram style.
5. Each corner zone removes units from the estimate by the corner loss rule (section 3.7).
6. A bar that ends on the side of another bar makes a T joint. A bar that crosses another bar makes a cross joint. The same five steps apply.

A bend inside one bar follows the same rule between its two legs.

### 3.5 Templates: court, wrap, and podium

**Court templates.** L (two bars), U (three bars), O (four bars), and E (one long bar with three wings). Controls: court width, court depth, bar depth, and floors. A courtyard is a hole in the plate union, or an open court between bars. The tool reports each courtyard's area and smallest dimension.

**Wrap template.** A deck box with width, depth, levels, and a floor-to-floor of 10.5 ft. A flag marks the top level as open air. Bars sit around the deck on two, three, or four sides, with a gap you set (default 10 ft). The inner units face the deck across the gap. The deck stays a placeholder. "Send to Parking Deck" hands it over for design.

**Podium.** A plate under the bars.

| Control | What it does | Default |
|---|---|---|
| Levels | One or two levels. | 1 |
| Floor-to-floor | Per level. Parking 10.5 to 12 ft. Retail 15 to 18 ft. | 11 ft parking, 16 ft retail |
| Footprint | A percent of the allowed site footprint, or an offset from the bars. | 100 percent of the allowed footprint |
| Program per level | Parking, retail, amenity, or leasing. | Parking |
| Retail liner | Optional retail strip along one side, with a depth. | Off, 50 ft |

Bars sit on the podium roof. A courtyard on the podium roof is an amenity deck.

### 3.6 Height controls

- Floor count for each bar, the deck, and the podium.
- Floor-to-floor for the ground floor, typical floors, deck levels, and podium levels.
- A roof: a 4 ft parapet, or an 8 ft equipment screen.
- Total height shows as a live number for each bar and for the building.

### 3.7 Units estimate

The tool estimates units from bar length. The Plate Planner refines the count later with real unit plans.

| Corridor type | Units per floor |
|---|---|
| Double-loaded | 2 × floor(length ÷ unit width) − corner loss |
| Single-loaded | 1 × floor(length ÷ unit width) − corner loss |
| Breezeway | modules × 2 × 2, where modules = floor(length ÷ (2 × unit width + 8)). Each breezeway takes 8 ft. |

- Unit width is a program default. Residential 28 ft. Hotel 14 ft (one key bay). Senior living 30 ft. You can change each one.
- Corner loss removes one unit per corner per floor from the inside of the corner. You can set it from 0 to 2.
- A floor with a ground floor program of retail, amenity, or leasing adds no units.
- The count uses only floors with a residential, hotel, or senior living program.

### 3.8 Parking

The tool shows parking required against parking provided on every change.

**Required** = sum over programs of units × ratio, plus retail area ÷ 1,000 sf × 3.

| Program | Ratio | Unit |
|---|---|---|
| Residential | 1.25 | per unit |
| Hotel | 0.8 | per key |
| Senior living | 0.6 | per unit |
| Retail | 3.0 | per 1,000 sf |

All ratios are editable from 0 to 3.

**Provided** = surface + deck + podium.

| Source | Count |
|---|---|
| Surface lot | A typed count, or a drawn lot polygon ÷ 350 sf per stall. The 350 sf includes drive aisles. |
| Deck placeholder | levels × footprint area ÷ 330 sf per stall |
| Podium parking level | (level area − retail − amenity − leasing) ÷ 330 sf per stall |

The square feet per stall values are editable. The panel shows required, provided, the ratio provided, and the surplus or deficit.

### 3.9 Stairs and elevators

Counts come from editable rules of thumb. The blocks show on the plates in both visual styles so the Plate Planner starts with a seed.

| Item | Rule | Block size |
|---|---|---|
| Stairs | One per bar end set to "stair", plus one per 250 ft of corridor beyond the first. | 12 ft × 22 ft |
| Exterior stairs | One per breezeway on breezeway bars. | 10 ft × 20 ft |
| Elevators | One per 100 units. At least one when a bar has three floors or more. Zero on breezeway bars. | 10 ft × 10 ft |

Caution: these rules give a seed count, not a code count. Verify stairs and elevators against the adopted code.

### 3.10 Construction type hint

An editable table maps the bar floors and the podium to a hint. Caution: the hint is a reminder only. Verify the construction type against the adopted code.

| Bar floors | Podium | Hint |
|---|---|---|
| 1 to 3 | None | Wood frame |
| 4 to 5 | None | Wood frame with fire-rated assemblies |
| 4 to 5 | 1 to 2 concrete levels | Wood over a concrete podium |
| 6 to 8 | Any | Mass timber, steel, or concrete; check the code |
| 9 or more | Any | Concrete; use the Tower Generator |

---

## 4. Site and zoning

### 4.1 Site boundary

- Type a width and depth for a rectangular site, draw a polygon, or load the boundary from the project file.
- The tool shows the site area in square feet and acres.

### 4.2 Zoning envelope

The zoning envelope is the 3D limit that zoning rules put on the building. The tower's envelope module checks it.

- Setback distance for each property line.
- Maximum building height.
- Optional stepback above a set height.
- Density cap in units per acre. Density means units divided by site area in acres.
- Open space share: the percent of the site with no building and no parking lot.
- Building separation minimum between bars that do not join. Default 20 ft.

### 4.3 Placement on the site

When the project file holds a Site Model, the site shows under the building: the boundary, the ground, the roads, and the neighbors as blocks. You drag the whole building, rotate it, and snap it to the boundary and the setback lines. The placement stores the offset, the rotation, and the base elevation. The base elevation comes from the ground at the footprint centroid. You can type it.

### 4.4 Warnings

- Plates outside the allowed footprint turn red. The envelope wireframe shows the limit.
- Floors above the height limit turn red.
- Density over the cap. Open space below the share. Separation below the minimum.
- Parking deficit, as a warning you can turn off.
- A bar outside the site.
- A courtyard narrower than a minimum you set (default 40 ft).

Each warning names the bar or the item, for example "Bar B, floors 4 to 5 exceed the height limit."

---

## 5. Live metrics

The metrics panel updates on every change. Four stay visible: units, density, parking ratio, and height. One tap expands the rest.

| Metric | Meaning |
|---|---|
| Units | By bar, by program, and total |
| Density | Units ÷ site area in acres |
| GFA | Gross floor area. The sum of all plates, podium and deck included. |
| FAR | Floor area ratio. GFA ÷ site area. |
| Site coverage | Ground level plate area ÷ site area |
| Efficiency estimate | (Plate area − corridor area − stairs − elevators) ÷ plate area |
| Corridor length | Total, and per unit |
| Parking | Required, provided, ratio provided, surplus or deficit |
| Courtyards | Count, area, smallest dimension |
| Bars | Count, and the longest bar |
| Height | Building height, and each bar |
| Floors | Bar floors, podium levels, deck levels |
| Stairs and elevators | Counts from section 3.9 |
| Construction hint | From section 3.10 |
| Target check | Your target units or density compared to the current value |

**Units:** Feet, square feet, and acres only in version 1.

### 5.1 Program types

| Program | Floor-to-floor | Unit size | Unit width | Parking ratio |
|---|---|---|---|---|
| Residential | 10 ft | 850 sf | 28 ft | 1.25 per unit |
| Hotel | 10 ft | 400 sf | 14 ft | 0.8 per key |
| Senior living | 10 ft | 600 sf | 30 ft | 0.6 per unit |
| Retail | 16 ft | none | none | 3 per 1,000 sf |
| Amenity | 12 ft | none | none | none |
| Leasing | 12 ft | none | none | none |
| Parking | 10.5 ft | 330 sf per stall | none | none |

The tower's program defaults stay in place. This table adds unit width, parking ratio, senior living, and leasing. You can change every value.

---

## 6. Viewing

- Orbit, pan, and zoom with a mouse, a trackpad, or touch.
- Preset views: axonometric, four elevations, and plan.
- Model style: white model with dark edges. Diagram style: color by program or by bar.
- The plan view shows spines, unit module ticks along each bar, corner zones, courtyard labels, and stall counts on the deck and the podium.
- Floor lines on or off. Simple sun shadow on or off. Ground grid and a human scale figure.
- Context on or off: the Site Model neighbors, or simple context blocks on a plain site.
- A north arrow when a site is loaded.

---

## 7. Screenshots

- Export the current view as a PNG image.
- Optional metrics block on the image, with the parking table as a second option.
- Optional title and date.
- Optional CMRLM mark in one corner.
- AI-ready image and the prompt library, as in the tower.

---

## 8. Options and saving

- Save an option with a name, for example "Option B — wrap, five floors."
- Saved options stay in the browser on that device, under their own storage key.
- Export all options as a JSON file. Import the file on another device.
- Duplicate an option to start a new variation.
- Compare two to four saved options side by side, with the metrics table under the views.
- The project file carries the current option to the other tools (section 14).

**Caution:** Browser storage can clear when you clear the browser data. Export the JSON file to keep a backup.

---

## 9. iPad use

- Controls are large enough for a finger. Handles are 44 points or larger.
- Sliders also accept typed numbers.
- The layout changes for portrait and landscape. Portrait uses the bottom sheet from the tower.
- Add the tool to the iPad Home Screen as a web app.

---

## 10. Technical approach

| Item | Choice | Reason |
|---|---|---|
| File structure | One HTML file, `midrise/index.html`, built from parts in `build/midrise/` | Same as the tower and the site |
| 3D library | Three.js from jsDelivr, same version as the tower | One version across the toolkit |
| Polygons | clipper-lib 6.4.2 | Same union and offset rules as the tower |
| Build step | `python3 build/midrise/build.py` | Same as the other tools |
| Hosting | GitHub Pages at `design-tools/midrise/` | Same as the other tools |
| Performance target | 12 bars × 7 floors smooth on an iPad | Covers large wraps and courtyards |

### 10.1 Toolkit foundation

**Reused from the tower and the site, unchanged where possible:**

- Styles, tokens, panel layout, tabs, top bar, and the controls library.
- `src/tower/envelope.js` for the allowed footprint and the envelope warnings.
- `src/tower/snap.js` for move and resize snapping.
- `src/shared/storage.js`, `src/shared/screenshot.js`, `src/shared/sketchup-format.js`.
- The select-and-handles editing from v1.1, moved to a shared part.
- The compare view and the prompt library parts.
- `src/shared/project.js`, the project file module from the project-file spec.

**New in `src/midrise/`:**

| Module | Contents |
|---|---|
| `bars.js` | Bar to legs, legs to rings per level, spine per leg, end blocks |
| `assemble.js` | Union per level, joints, corner zones, courtyards, separation, templates |
| `parking.js` | Required and provided counts |
| `metrics.js` | All metrics in section 5 |
| `presets.js` | Program defaults and the six presets |
| `testcases.js` | Hand-calculated cases for the tests |

### 10.2 Pipeline

```
state → bars → legs → rings per level → union per level → plates + spines → metrics + warnings
                                                                         → 3D meshes
```

- Every step before the meshes is a pure function.
- The metrics and the meshes use the same plates, so the numbers and the model agree.
- While a slider moves, the tool skips shadows and the union for draft drawing. The metrics use full quality every time.

---

## 11. Build plan

| Phase | Work | Model | Reason |
|---|---|---|---|
| 1 | Write the technical plan from this document | Opus | This step needs design judgment and trade-off decisions. |
| 2 | Build the shell: copy the tower shell, move shared parts, tabs, 3D view, units | Sonnet | This is standard web and 3D code. Sonnet does it fast. |
| 3 | Build bars, corridor types, end blocks, units estimate, and metrics | Sonnet | The geometry is simple and well known. |
| 4 | Build assemble: joints, corner zones, courtyards, separation, templates | Opus | Unions and joints need careful geometry. |
| 5 | Build the site, envelope, placement on the site, and warnings | Sonnet | The rules are clear and direct. |
| 6 | Build the project file section and the handoffs | Sonnet | The contract is fixed in the spec. |
| 7 | Make the presets and the test cases | Haiku | This work is simple and repetitive. |
| 8 | Review the geometry, the unit math, and the parking math | Opus | Opus finds calculation errors better. |
| 9 | Test on the Mac and the iPad | Cade | Only you can judge the feel of the controls. |

**Estimate:** Phases 2 to 6 run as a few sessions. Phases 1, 7, and 8 are short.

### 11.1 Presets

Haiku fills in the full values in phase 7. These are the starting targets. Unit counts are approximate.

| Preset | Bars | Floors | Depth | Parking | Site | Units | Density |
|---|---|---|---|---|---|---|---|
| Garden walk-up, three floors | 3 breezeway bars, 192 ft | 3 | 66 ft | Surface, 160 stalls | 5.0 acres | about 108 | about 22 per acre |
| Corridor garden, four floors | L of 2 bars, 240 ft and 160 ft | 4 | 65 ft | Surface, 125 stalls | 3.0 acres | about 100 | about 33 per acre |
| Double-loaded bar, five floors | 1 bar, 300 ft | 5 | 65 ft | Surface, 120 stalls | 2.0 acres | about 100 | about 50 per acre |
| Courtyard, five over one | O of 4 bars around a 120 × 90 ft court | 5 over 1 | 65 ft | Podium, about 166 stalls, plus surface | 2.5 acres | about 200 | about 80 per acre |
| Wrap with five-level deck | 4 bars around a 300 × 125 ft deck | 5 | 65 ft | Deck, 5 levels, about 570 stalls | 4.5 acres | about 390 | about 87 per acre |
| Podium, five over two with retail | U of 3 bars on a 300 × 200 ft podium | 5 over 2 | 65 ft | Podium, 2 levels, about 300 stalls | 1.75 acres | about 170 | about 97 per acre |

---

## 12. Decisions

Decisions carried over from the tower, and new ones made for this tool.

1. **Visual style:** Both. One toggle switches between the white model and the diagram style.
2. **Units:** Feet, square feet, and acres only. No metric toggle in version 1.
3. **Context:** A toggle shows or hides the neighbors from the Site Model, or simple context blocks.
4. **Compare view:** A side-by-side view of two to four saved options is in version 1.
5. **Users:** Cade and RJTR teammates. Each tool gets a short Help panel.
6. **Names:** Generic names only in presets, tests, ids, and notes.
7. **Project file:** Part of version 1. The tool writes its section and keeps the others unchanged.
8. **Programs:** Multifamily first. Hotel and senior living are programs with their own unit width and parking ratio.
9. **Deck and podium:** The deck is a placeholder box for the Parking Deck tool. The podium is a plate with parking counts.
10. **Plate representation:** The same as the tower, so the Plate Planner and the Facade Studio read both tools the same way.

---

## 13. Risks

| Risk | Effect | Response |
|---|---|---|
| Joints double-count area or units | Bad numbers in early decisions | One joint rule. Union with Clipper. Tests against hand calculations for L, T, and cross joints. |
| The units estimate differs from the Plate Planner | Two counts for one building | Label the count as an estimate. Show the Plate Planner count next to it when the project file holds one. |
| Parking rules vary by city | A wrong default ratio | Every ratio and area per stall is editable and visible in the panel. |
| Too many controls | The tool feels slow to use | Templates set most values. "More" hides advanced controls. |
| iPad performance on large wraps | Slow motion during a drag | Draft drawing during a drag. Union only when the drag stops. |
| Lost saved work | You lose options | Export JSON backups. The project file holds the current option. |
| Site data has estimated neighbor heights | Context looks wrong | The Site Model marks estimates. You can type a neighbor height. |

---

## 14. Project file

The project file is the shared JSON file that carries one project between the tools. The spec is `docs/project-file-spec.md`. The Mid-Rise Generator follows these rules.

**Writes** `sections.massing`:

```js
{
  tool: "midrise", schema: 1, updatedAt,
  placement: { x, y, rotation, baseZ },
  state,                                   // the full Mid-Rise state (schema 1)
  derived: {
    footprint,                             // MultiPoly, ground level
    height,
    levels: [{
      index, name,
      zone: "podium" | "bar" | "deck" | "mechanical" | "crown",
      z,                                   // ft above baseZ
      ftf, program,
      plates,                              // MultiPoly, the union at this level
      core,                                // ring or null; null for the mid-rise
      spines,                              // [[[x, y], [x, y]], …] corridor centerlines
      seeds,                               // [{ kind: "stair" | "exterior-stair" | "elevator", outer }] starting blocks
    }],
    context: { blocks },
    metrics: { gfa, far, siteCoverage, floors, height, units },
  },
}
```

- Coordinates are the local frame: site-centered, x east, y north, feet. `MultiPoly = [{ outer, holes }]`, with the outer ring counter-clockwise.
- Bars provide `spines` so the Plate Planner places corridors on the plates.
- Stair and elevator blocks from section 3.9 go into `seeds` on each level. The Plate Planner starts its core from them and may move or delete them.
- The deck placeholder appears as levels with zone `deck`. The podium appears as levels with zone `podium`.

**Reads** `sections.site.derived` for the boundary, the ground, and the neighbors, through `siteContextFor(doc, placement, radiusFt)` from `src/shared/project.js`. The tool sets `placement` when you place the building on the site.

**Handoffs:**

- "Send to Plate Planner" opens `../plate/?project=<id>`.
- "Send to Parking Deck" opens the Parking Deck tool with the wrap deck or the podium placeholder.

**Rule:** A tool writes only its own section. It keeps every other section unchanged, including sections it does not understand.

---

## 15. Open questions for Cade

1. **Unit width:** Is 28 ft the right residential default for the units estimate, or does the firm use 30 ft?
2. **Breezeway buildings:** Should the tool draw the exterior stairs at each breezeway in version 1, or show the breezeway only?
3. **Wrap gap:** Is a 10 ft default gap between the bars and the deck right, or do you use 20 ft for windows?
4. **Surface parking:** Do you prefer a typed stall count, a drawn lot polygon, or both in version 1?
5. **Sliver rule:** Should a bar shorter than two unit widths warn as a sliver, or stay silent?
