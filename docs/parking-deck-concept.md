# Parking Deck Generator — Concept Document

Version 0.1 · October 21, 2026 · Owner: Cade (CMRLM)

---

## 1. Purpose

The Parking Deck Generator is a browser tool for fast parking studies. It lays out stalls, aisles, ramps, and columns on a deck or a podium, and it counts the stalls as you change the layout.

The tool is for conceptual design only. It does not replace Revit or a parking consultant. It replaces the first hours of drawing bays, counting stalls on a calculator, and checking ramp slopes by hand.

**Main goal:** Go from a deck footprint and a level count to two or three believable parking layouts, with a real stall count, in less than 15 minutes.

**Users:** Cade and RJTR teammates. All names in presets, tests, and notes are generic. No client names.

The tool covers three cases:

| Case | Where the footprint comes from |
|---|---|
| Standalone deck | You type or draw it. |
| Wrap deck | The `deck` levels of a Mid-Rise massing in the project file. A wrap deck is a deck that apartment bars surround. |
| Podium parking | The `podium` levels of a Mid-Rise or Tower massing. A podium is the concrete base under a building. |

---

## 2. Scope

### 2.1 Version 1 includes

- Bays of 90-degree, two-way parking, double-loaded or single-loaded.
- Five ramp types: single helix, double helix, speed ramp, split-level, and sloped parking floor.
- A column grid, short-span or long-span.
- Cores (stairs and elevators) placed on the floors, from the project file or by hand.
- Accessible and van stalls from an editable table, placed near the elevator core.
- EV-ready share, bike parking count, clear height, barrier height, and ramp slope checks.
- An overlay of deck columns against the unit bay lines from the Plate Planner.
- Live metrics, presets, saved options, the compare view, screenshots, and the AI prompt library.
- Exports: DXF, SketchUp JSON, stall schedule CSV, and the project file section.
- Use on a Mac browser and on an iPad. Hosting on GitHub Pages.

### 2.2 Version 1 does not include

- Angled parking (45 or 60 degrees) and one-way aisles. See section 15.
- Structural design. The column grid is a layout tool, not a structural check.
- Fire lane and fire apparatus access checks. The Site Model and a later tool cover the site.
- Mechanical ventilation and lighting design.
- Traffic queuing at gates.
- Multi-user access.

---

## 3. Form system

### 3.1 Basic model

The tool builds the deck as a stack of parking floors. Each floor is a plate. The parking area of a floor is the plate minus the ramps, the cores, and the barriers.

The tool lays bays inside the parking area. A bay is one drive aisle with its stall rows. The tool counts stalls row by row. The stall count is the sum of the rows. This keeps the count exact for the geometry on the screen.

### 3.2 Stalls and bays

| Item | Default | Range |
|---|---|---|
| Stall width | 9 ft | 8 to 10 ft |
| Stall depth | 18 ft | 16 to 19 ft |
| Drive aisle, two-way | 24 ft | 20 to 26 ft |
| Compact stall | 8 × 16 ft, share 0 | share 0 to 30 percent |

A double-loaded bay has a stall row on each side of the aisle. A single-loaded bay has one stall row and is used at an edge.

**Structural bay table (90-degree, two-way):**

| Layout | Stall depth | Aisle | Stall depth | Bay width |
|---|---|---|---|---|
| Double-loaded | 18 | 24 | 18 | **60 ft** |
| Double-loaded, compact rows | 16 | 24 | 16 | 56 ft |
| Single-loaded edge bay | 18 | 24 | — | 42 ft |

Bay width = 2 × stall depth + aisle. A 60 ft bay is the standard long-span module.

### 3.3 Column grid

| Grid | Where the columns sit | Effect on stalls |
|---|---|---|
| Long-span | Only on the bay lines, at the head of the stalls. Beams span the full 60 ft bay. | No stall loss. Column spacing is a multiple of the stall width (default 3 stalls = 27 ft). |
| Short-span | On the bay lines and on the line between the stalls and the aisle. Beams span about 18 to 24 ft. | Each column takes its width out of the row. Default 2 ft per column, so a module is 3 stalls + 2 ft = 29 ft. |

Column size is editable (default 2 × 2 ft). The tool draws every column and lists the module.

### 3.4 Ramp types

A level is one parking floor. Floor-to-floor is the distance from one floor surface to the next (default 10.5 ft).

| Type | How it works | Parking on the slope | Slope |
|---|---|---|---|
| Single helix | The whole floor is one continuous ramp. One trip around climbs one level. Each bay rises half a level. | Yes | ftf ÷ 2 ÷ ramped length |
| Double helix | Two helixes wind together. One trip around climbs two levels. Each bay rises a full level. | Yes | ftf ÷ ramped length |
| Speed ramp | Floors are flat. A separate express ramp, with no parking, links the floors. | No | Set by its length |
| Split-level | Two flat half-floors sit half a level apart. Short ramps at the ends link them. | No | ftf ÷ 2 ÷ end ramp length |
| Sloped parking floor | One bay slopes a full level. The other bays stay flat. | Yes, in the sloped bay | ftf ÷ ramped length |

The turn zone is the flat area at each end of a bay where the aisles connect. Its length is one aisle width (24 ft) by default.

**Speed ramp shape:** straight or circular. A circular ramp is a helix ramp with an inside radius you set. The tool draws it as a true arc. It also offers the same ramp as straight segments (8, 12, or 16 per turn) for a Revit swept blend reference.

### 3.5 Slope limits

Caution: these defaults are common design limits, not code values. Verify them against the adopted code and the owner's standards.

| Limit | Default |
|---|---|
| Parking on a slope | 6.67 percent (1 in 15) |
| Speed ramp | 12 percent |
| Speed ramp transitions | Half the ramp slope (6 percent), 10 ft long, at each end |
| Cross slope on a flat floor | 2 percent, reported only |

The tool shows each ramp's slope and turns it red above its limit. With transitions, the tool solves the main slope so the ramp still climbs exactly one floor-to-floor (or half, for split-level).

### 3.6 Cores and openings

A core is a stair or an elevator that passes through the deck.

- From the project file: the tool reads `seeds` on the massing levels (Mid-Rise stairs and elevators) and places them on every parking level below.
- By hand: add a stair (12 × 22 ft) or an elevator (10 × 10 ft) and drag it.
- A core that lands in a drive aisle shows red and a warning. The tool suggests the nearest stall row position.
- A core in a stall row removes the stalls it covers. A 22 ft stair along a row removes 3 stalls.

### 3.7 Barriers and clearance

Caution: verify barrier heights and clearances against the adopted code and the accessibility standard.

| Check | Default |
|---|---|
| Vehicle barrier height (crash wall) | 2 ft 9 in minimum |
| Pedestrian guard at open sides | 3 ft 6 in |
| Clear height, general | 7 ft 0 in minimum |
| Clear height, van route to van stalls | 8 ft 2 in minimum |
| Structure depth (beam or slab) | 2 ft 6 in long-span, 1 ft 6 in short-span |

Clear height = floor-to-floor − structure depth. The tool checks it on every level. Level 1 gets its own floor-to-floor so the van route can pass.

---

## 4. Site and zoning

### 4.1 Footprint

- Standalone: type a width and depth, or draw a polygon.
- Wrap deck: the footprint is the `deck` plate from the massing. The tool keeps the gap to the bars that the Mid-Rise set (default 10 ft).
- Podium: the footprint is the `podium` plate at each podium level. A retail liner stays out of the parking area.
- The perimeter allowance (default 1 ft) holds the edge barrier or wall.

### 4.2 Levels and height

- Level count, floor-to-floor per level, level 1 floor-to-floor.
- Below-grade levels: optional, with negative `z`.
- Open top: the roof level parks cars and has no structure above.
- Height limit from the massing site, when one exists.

### 4.3 Entries

- One or two entries on chosen sides. Each entry takes a lane (default 24 ft wide) and the stalls in its path.
- The tool marks the entry, the exit, and the ramp direction.

---

## 5. Live metrics

The metrics panel updates on every change. Four stay visible: stalls, square feet per stall, accessible stalls, and the parking balance.

| Metric | Meaning |
|---|---|
| Stalls | Total, by level, and by kind (standard, compact, accessible, van, EV-ready) |
| Square feet per stall | Gross deck area ÷ stalls. Target 300 to 350. |
| Parking balance | Stalls − required. Required = units × ratio + retail area ÷ 1,000 × 3 (from the massing, editable). |
| Accessible | Required by the table, provided, and van stalls |
| EV-ready | Share and count |
| Bike parking | Required count and the area it needs |
| Ramp slopes | Each ramp against its limit |
| Clear height | Lowest clear height per level against its minimum |
| Columns | Count, module, and conflicts with unit bay lines |
| Efficiency | Parking area ÷ gross area |
| Levels and height | Level count, top of deck |

### 5.1 Accessible stalls

Caution: the table seeds an editable table. Verify every count against the adopted code (IBC section 1106 and the accessibility standard).

| Total stalls | Accessible stalls |
|---|---|
| 1 to 25 | 1 |
| 26 to 50 | 2 |
| 51 to 75 | 3 |
| 76 to 100 | 4 |
| 101 to 150 | 5 |
| 151 to 200 | 6 |
| 201 to 300 | 7 |
| 301 to 400 | 8 |
| 401 to 500 | 9 |
| 501 to 1,000 | 2 percent of the total |
| More than 1,000 | 20, plus 1 for each 100 over 1,000 |

- Van stalls: 1 for every 6 accessible stalls, at least 1.
- Access aisles: 5 ft wide for a car stall, 8 ft for a van stall. Two accessible stalls may share one aisle.
- A residential option (Group R-2) adds the per-unit rule as a second row. The tool uses the larger count. The rule stays off until you turn it on.
- Placement: the tool places accessible stalls in the stall row nearest the elevator core, on the level with the entry first.

### 5.2 EV and bike parking

- EV-ready share: default 20 percent. EV-installed share: default 5 percent. Both are editable. EV stalls carry a tag; they do not change the layout.
- Bike parking: default 1 space per 10 units, or a typed count. Rack type sets the area: single-tier 2 × 6 ft per bike, two-tier 1.25 ft per bike along a wall with 8 ft 6 in clear height. Caution: verify rack clearances with the manufacturer.

---

## 6. Viewing

- Orbit, pan, and zoom with a mouse, a trackpad, or touch.
- Preset views: axonometric, four elevations, plan, and a section through the ramps.
- Model style: white model with dark edges, stall lines on the floors.
- Diagram style: stalls colored by kind, ramps colored by slope, columns red where they conflict.
- Level isolate: show one level in plan with its stall numbers.
- Overlay: unit bay lines from the Plate Planner above the deck columns (section 6.1).
- Context: the massing above the deck as a ghost, on or off.

### 6.1 Column overlay

The overlay shows where the deck columns meet the building above.

- The tool reads the unit bay lines from `plates.derived` (each unit's `bay` and `demising` lines on the lowest residential level).
- It projects them onto the deck plan as thin lines.
- A column that sits more than a tolerance (default 2 ft) from the nearest demising line is a conflict. A conflict means the structure above needs a transfer beam or the grid must move.
- The panel lists the conflicts and suggests a stall width that aligns the grid with the units (for example 9 ft 4 in stalls under 28 ft units).

---

## 7. Screenshots

- Export the current view as a PNG image.
- Optional metrics block, and the stall table as a second option.
- Optional title, date, and CMRLM mark.
- AI-ready image and the prompt library, as in the other tools.

---

## 8. Options and saving

- Save an option with a name, for example "Option B — double helix, six levels."
- Saved options stay in the browser under their own storage key.
- Export and import all options as a JSON file.
- Duplicate an option. Compare two to four options side by side, with the metrics table.
- The project file carries the current option to the other tools (section 14).

**Caution:** Browser storage can clear when you clear the browser data. Export the JSON file to keep a backup.

---

## 9. iPad use

- Controls are large enough for a finger. Handles are 44 points or larger.
- Sliders also accept typed numbers.
- The layout changes for portrait and landscape. Portrait uses the bottom sheet.
- Add the tool to the iPad Home Screen as a web app.

---

## 10. Technical approach

| Item | Choice | Reason |
|---|---|---|
| File structure | One HTML file, `parking/index.html`, built from parts in `build/parking/` | Same as the other tools |
| 3D library | Three.js, same version as the other tools | One version across the toolkit |
| Stalls in 3D | Instanced meshes, one per stall kind | 5,000 stalls stay smooth on an iPad |
| Polygons | clipper-lib 6.4.2 | Same rules as the other tools |
| Build step | `python3 build/parking/build.py` | Same as the other tools |
| Performance target | 10 levels × 600 stalls, smooth on an iPad | Covers large decks |

### 10.1 Layout algorithm

The heart of the tool. The same inputs always give the same result.

1. **Parking area.** Plate − perimeter allowance − ramps − cores − speed ramp − entry lanes. Use Clipper at SCALE 1000.
2. **Bay direction.** Bays run along the long axis of the plate's minimum bounding rectangle. You can rotate them 90 degrees.
3. **Bays.** Fill the width with 60 ft double-loaded bays from one side. A remainder of 42 ft or more becomes a single-loaded edge bay. A smaller remainder becomes a wider drive aisle or a landscape strip, and the tool reports it.
4. **Turn zones.** Each bay loses one aisle width (24 ft) at each end where it turns into the next bay. A dead-end bay loses one turn zone only.
5. **Rows.** Each bay has two stall rows (or one). A row's run length is the bay length minus its turn zones, clipped to the parking area.
6. **Stalls per row.** Long-span: `floor(run ÷ stall width)`. Short-span: per column module, `floor((module − column width) ÷ stall width)`, plus the remainder piece.
7. **Losses.** Remove the stalls under cores, entry lanes, and access aisles.
8. **Accessible.** Count from section 5.1. Place them nearest the elevator core, pairing two stalls on one 5 ft aisle; a van stall gets an 8 ft aisle.
9. **Ramps.** Compute each ramp's slope from its type (section 3.4) and its ramped length. Flag slopes above the limits.
10. **Totals.** Sum the rows per level and per kind. Square feet per stall = gross deck area ÷ stalls.

### 10.2 Worked example A — two-bay single helix deck

| Input | Value |
|---|---|
| Deck | 300 × 125 ft, 5 levels, floor-to-floor 10.5 ft, open top |
| Grid | Long-span, 27 ft module |
| Perimeter | 1 ft each side → parking width 123 ft, length 298 ft |
| Bays | 2 double-loaded bays of 60 ft + a 3 ft center spine = 123 ft |
| Turn zones | 24 ft at each end → run length 298 − 48 = 250 ft |
| Ramp | Single helix: each bay rises 5.25 ft over 250 ft = **2.1 percent** (limit 6.67, passes) |

Stalls per row = floor(250 ÷ 9) = 27. Four rows per level → 108 stalls per level. Five levels → 540.

Losses: the entry lane on level 1 takes 6 stalls. Accessible count for 534 stalls = 2 percent → 11 accessible, of which 2 van. Six shared access aisles plus two van aisles remove about 8 standard stalls.

**Result:** about **526 stalls**. Gross area 300 × 125 × 5 = 187,500 sf → **356 sf per stall**, just above the 350 target.

Note: the Mid-Rise rule of thumb (330 sf per stall) gives 568 stalls for this deck. The real layout gives about 526. This is the gap the tool exists to show.

### 10.3 Worked example B — podium level under a 65 ft bar

| Input | Value |
|---|---|
| Podium | 300 × 65 ft, one level, under a five-floor double-loaded bar |
| Bay | One double-loaded 60 ft bay + 5 ft of walls |
| Entry | One end → one turn zone of 24 ft; the far end is a dead end with a 24 ft turnaround |
| Run length | 298 − 24 − 24 = 250 ft |
| Cores from the Mid-Rise seeds | 3 stairs (12 × 22) and 1 elevator (10 × 10) |

Stalls per row = floor(250 ÷ 9) = 27. Two rows → 54 stalls.

The Mid-Rise stairs straddle the corridor spine. Below, the spine is the drive aisle. So every stair lands in the aisle, and the tool flags it. Moved into a stall row, each stair removes 3 stalls and the elevator removes 2 → 11 stalls lost. Result: **43 stalls**. Accessible: 2, of which 1 van.

Gross 19,500 sf ÷ 43 = **453 sf per stall**. One-bay podiums are inefficient, and the tool shows why.

Column overlay: a 27 ft module under 28 ft units drifts 1 ft per bay. After 10 bays the columns sit 10 ft off the demising lines. The tool suggests 9 ft 4 in stalls (3 stalls = 28 ft): 250 ÷ 9.33 = 26 stalls per row, and every column lands on a demising line.

---

## 11. Build plan

| Phase | Work | Model | Reason |
|---|---|---|---|
| 1 | Write the technical plan from this document | Opus | Contracts and trade-offs need judgment. |
| 2 | Build the shell: copy the Mid-Rise shell, tabs, 3D view, units | Sonnet | Standard web and 3D code. |
| 3 | Build the layout: bays, rows, stalls, losses, accessible placement | Opus | Row clipping and losses hide counting errors. |
| 4 | Build the ramps: five types, slopes, transitions, circular ramp and its segments | Opus | Ramp geometry in 3D is easy to get wrong. |
| 5 | Build the column grid, the overlay, cores, and the checks | Sonnet | The rules are clear once the layout exists. |
| 6 | Build the project file section, exports (DXF, CSV, SketchUp) | Sonnet | The formats exist in the other tools. |
| 7 | Make the presets and the test cases | Haiku | Simple and repetitive. |
| 8 | Review the stall counts, slopes, and the accessible table against hand calculations | Opus | Finds calculation errors. |
| 9 | Test on the Mac and the iPad | Cade | Only you can judge the feel of the controls. |

### 11.1 Presets

| Preset | Footprint | Levels | Ramp | Grid | Expected stalls |
|---|---|---|---|---|---|
| Two-bay single helix, five levels | 300 × 125 | 5 | Single helix | Long-span | about 526 |
| Three-bay deck with a sloped center bay | 300 × 185 | 5 | Sloped parking floor | Long-span | about 780 |
| Double helix, six levels | 360 × 125 | 6 | Double helix | Long-span | about 780 |
| Flat floors with a speed ramp | 300 × 150 | 5 | Speed ramp, straight | Long-span | about 560 |
| Split-level deck | 300 × 125 | 6 half-levels | Split-level | Long-span | about 500 |
| Wrap deck from the Mid-Rise wrap preset | 300 × 125 | 5 | Single helix | Long-span | about 526 |
| Podium level under a bar | 300 × 65 | 1 | None | Short-span | about 43 |
| Two-level podium under a U building | 300 × 200 with a retail liner | 2 | Speed ramp, straight | Short-span | about 290 |

Haiku fills in the exact values in phase 7. The technical plan computes each expected count by hand.

---

## 12. Decisions

1. **Visual style:** Both. One toggle switches between the white model and the diagram style.
2. **Units:** Feet and square feet only.
3. **Stalls:** 9 × 18 ft, 24 ft two-way aisle, 90 degrees, as the defaults. Every value is editable.
4. **Cases:** Standalone decks, wrap decks from the Mid-Rise, and podium parking from either massing tool.
5. **Ramps:** Single helix, double helix, speed ramp, split-level, and sloped parking floor.
6. **Grid:** Short-span or long-span, with the column overlay against the Plate Planner units.
7. **Users:** Cade and RJTR teammates. A short Help panel in the tool.
8. **Names:** Generic names only in presets, tests, ids, and notes.
9. **Project file:** Part of version 1. The tool writes its section and keeps the others unchanged.
10. **Code values:** Every code-related default lives in an editable table with a Caution line.
11. **Bays:** 90-degree two-way bays only in version 1. Angled one-way bays are a later version. (October 21, 2026)
12. **Stall width alignment:** The tool suggests a stall width that aligns the columns with the unit bays. It never changes the width by itself. (October 21, 2026)
13. **Apartment accessible rule:** The R-2 per-unit rule is on by default for decks under apartments. (October 21, 2026)
14. **End walls:** The short end walls stay turn zones. No stalls along them by default. (October 21, 2026)
15. **Compact stalls:** Default share 0 percent. (October 21, 2026)

---

## 13. Risks

| Risk | Effect | Response |
|---|---|---|
| Stall counts read high | Bad numbers in early decisions | Count row by row from the real geometry. Test against hand counts for every preset. |
| Ramp slope math is wrong at transitions | A ramp that cannot be built | Solve the main slope with the transitions included. Test each ramp type by hand. |
| Code tables differ by jurisdiction | Wrong accessible or barrier values | Editable tables. Caution lines. The tool never says "compliant". |
| Cores from the Mid-Rise land in aisles | Confusing warnings | Flag, then suggest the nearest stall row. One button moves the core. |
| Column overlay with no Plate Planner data | Empty overlay | Fall back to the Mid-Rise unit width ticks along the bars. Say which source the overlay uses. |
| Curved ramps in Revit | Hard to rebuild | Export the ramp as 3D faces and as straight segments for a swept blend reference. |
| iPad performance on large decks | Slow frames | Instanced stalls. Draft layout during a drag; full count on release. |
| Lost saved work | You lose options | Export JSON backups. The project file holds the current option. |

---

## 14. Project file

The project file is the shared JSON file that carries one project between the tools. The spec is `docs/project-file-spec.md`.

**Reads:**

- `sections.massing.derived.levels` with zone `deck` or `podium`: the plate, `z`, and `ftf` of each parking level. When both exist, the tool asks which one to lay out.
- `sections.massing.derived.levels[].seeds`: stairs and elevators to carry down through the deck.
- `sections.massing.derived.metrics.units`: the default for the parking required.
- `sections.plates.derived.levels[].units[].bay` and `demising`: the unit bay lines for the column overlay.
- `sections.site.derived`: the ground and the neighbors, for context only.

**Writes** `sections.parking`, with the same placement as the massing section:

```js
{
  tool: "parking", schema: 1, updatedAt,
  placement,                               // copied from sections.massing.placement; zeros without a project
  state,                                   // the full Parking Deck state
  derived: {
    levels: [{
      index, z, plate, stalls: [{ id, outer, kind }], aisles, ramps: [{ id, outer3d, slope }], columns,
      cores: [{ id, kind, outer }],        // new, optional
      clearHeight,                         // new, optional: lowest clear height on the level, ft
    }],
    metrics: {
      stalls, byKind, sfPerStall, levels,
      accessible: { required, provided, van },   // new, optional
      ev: { ready, installed },                   // new, optional
      bike: { required, areaSf },                 // new, optional
      conflicts,                                  // new, optional: column-overlay conflicts
    },
  },
}
```

- Every new key is optional and additive. The spec section 6.4 gets the same keys when the technical plan is approved.
- Stall `kind` keeps the spec values: `standard`, `compact`, `accessible`, `van`, `ev`.
- The Mid-Rise can later show "Parking Deck count" next to its own estimate by reading `parking.derived.metrics.stalls`.

**Handoffs:** the Mid-Rise "Send to Parking Deck" opens `../parking/?project=<id>`. The Parking Deck has no Send button in version 1; the Facade Studio comes next in the pipeline and does not read parking.

**Rule:** A tool writes only its own section. It keeps every other section unchanged, including sections it does not understand.

---

## 15. Open questions for Cade

All five questions were answered on October 21, 2026. See decisions 11 to 15 in section 12.
