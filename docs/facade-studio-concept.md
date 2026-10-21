# Facade Studio — Concept Document

Version 0.1 · October 21, 2026 · Owner: Cade (CMRLM)

---

## 1. Purpose

The Facade Studio is a browser tool for fast facade studies. It wraps a skin system around a massing and counts the glass as you change the skin.

The tool is for conceptual design only. It does not replace Revit, an energy model, or an envelope consultant. It replaces the first hours of drawing window patterns on elevations and adding up glass areas by hand.

**Main goal:** Go from a massing to two or three believable facade options, with a real window-to-wall ratio, in less than 15 minutes.

**Users:** Cade and RJTR teammates. All names in presets, tests, and notes are generic. No client names. No district names.

The window-to-wall ratio (WWR) is the glazing area divided by the gross wall area. It drives the energy code path, the cost, and the look of the building. The tool shows it on every change.

The tool covers three cases:

| Case | Where the massing comes from |
|---|---|
| Tower | The `massing` section written by the Tower Generator. Faces follow each floor plate, with taper and twist. |
| Mid-rise | The `massing` section written by the Mid-Rise Generator. Faces follow the bar faces and the courtyard faces. |
| Standalone | A simple massing you type: a rectangle or an L, a floor count, and floor-to-floor heights. |

---

## 2. Scope

### 2.1 Version 1 includes

- Faces built from every massing level, classified north, east, south, or west.
- Four facade systems: punched windows, window wall, curtain wall, and storefront.
- Zones (base, middle, top, or level ranges) with rules per orientation.
- Balconies in five patterns, per module or per unit.
- Vertical fins, horizontal shades, material bands, and corner treatments.
- Live metrics: WWR overall and per orientation, ground-floor transparency, facade area, glazing area, balconies.
- A 40 percent WWR check and an optional envelope note, both from editable tables.
- A simple solar exposure per orientation when the project holds a sun study.
- Presets, saved options, the compare view, screenshots, AI-ready images, and the prompt library.
- Exports: four elevations as DXF, SketchUp JSON, and the project file section.
- Use on a Mac browser and on an iPad. Hosting on GitHub Pages.

### 2.2 Version 1 does not include

- Energy simulation. The envelope note is a reminder, not a calculation.
- Curved facades. Curved plates come in as straight edges.
- Shadows from neighbors on the facade. The exposure ignores context.
- Structural, thermal, or water-tightness design of the wall.
- Unit plans. The Plate Planner owns them; this tool only reads unit exposures.
- Multi-user access.

---

## 3. Form system

### 3.1 Basic model

The tool builds the facade from faces. A face is one straight wall strip: one plate edge times one floor-to-floor height. The tool panelizes each face by a module and fills each panel with the system of its zone.

The glazing area is the sum of the panel glazing. The wall area is the sum of the faces. This keeps the WWR exact for the geometry on the screen.

### 3.2 Faces

1. For each massing level, take the plate outer rings and the hole rings (courtyards). Use the plate edges as they are, with no offset.
2. Merge collinear edges. Two edges merge when their directions differ by less than 0.5 degrees and they share an end point within 0.1 ft.
3. The outward normal points away from the plate fill. On a hole ring it points into the courtyard.
4. Turn the normal into a compass bearing in the project frame. Add the massing placement rotation first.
5. Classify the bearing into four 90-degree sectors:

| Orientation | Bearing (clockwise from north) |
|---|---|
| North | 315 to less than 45 degrees |
| East | 45 to less than 135 degrees |
| South | 135 to less than 225 degrees |
| West | 225 to less than 315 degrees |

6. A face strip is the edge length times the level floor-to-floor. Parapets and roof screens are not faces. They add no wall area.
7. Faces on consecutive levels stack into one face group when the edge stays within 1 ft and 1 degree. A tapered or twisted tower gives one face group per level.

### 3.3 Zones

A zone is a band of levels that shares one set of rules.

| Zone | Default levels |
|---|---|
| Base | Level 1, or every podium level when the massing has a podium |
| Top | The top level |
| Middle | Every level between the base and the top |

- You can change the zones to level ranges, for example "levels 2 to 6".
- Each zone holds one rule for all orientations, plus an optional override per orientation.
- A rule sets the system and its dimensions (section 3.4), the balcony pattern, the shading, and the material.

### 3.4 Facade systems

| System | Glazing | Typical use |
|---|---|---|
| Punched windows | One window per module, set by width, sill, and head | Multifamily, hotel |
| Window wall | Floor-to-ceiling glass between slabs, with a slab-edge cover | Multifamily, hotel |
| Curtain wall | A continuous grid hung outside the slabs: vision plus spandrel | Office, tower |
| Storefront | Tall glass from a low base to a head, in a base zone | Retail, lobby |

**Defaults:**

| Setting | Punched | Window wall | Curtain wall | Storefront |
|---|---|---|---|---|
| Module width | 14 ft | 5 ft | 5 ft | 5 ft |
| Window width | 6 ft | full module | full module | full module |
| Sill height | 2 ft 6 in | 0 | — | 1 ft 6 in |
| Head height | 8 ft | ftf − 1 ft 4 in | — | 10 ft |
| Vision height | — | — | 8 ft | — |
| Spandrel height | — | 1 ft 4 in slab cover | 2 ft | — |
| Mullion width (face) | 2 in | 2.5 in | 2.5 in | 2 in |
| Mullion depth | 4 in | 6 in | 8 in | 4.5 in |

- Glazing area counts the whole window opening, frames and mullions included. Energy codes count fenestration area this way.
- The mullion depth shows in the 3D view and the DXF. It does not change the WWR.
- A spandrel is the opaque panel that hides the slab edge and the ceiling space in a curtain wall.

### 3.5 Panelizing

- Panel count `n = max(1, floor(L ÷ module))`, where L is the face length.
- The actual module is `L ÷ n`. It is never smaller than the target module.
- Each window sits centered in its module.
- A face shorter than one module gets one panel with the window clipped to the face.

This rule keeps windows from crowding. The stretch on any face is less than one module divided by n.

### 3.6 Balconies

| Pattern | Rule |
|---|---|
| Stacked | The same modules on every level |
| Alternating | Every other module, shifted one module on every other level |
| Checker | Every other module, shifted on every level |
| Inset | Stacked, but recessed into the plate instead of projecting |
| Projected | Stacked slabs outside the face |

- Defaults: width 12 ft, depth 6 ft, every second module, middle zone only.
- An inset balcony cuts back the wall. Its door counts as glazing at the recessed plane. The cut-back wall counts as wall area.
- With Plate Planner units in the project, "per unit" places one balcony on each unit facade. A corner unit gets one balcony on its longer facade. Without units, balconies follow the module.
- The tool counts balconies and their slab area.

### 3.7 Fins, shades, and bands

- Vertical fins: depth, spacing (every module or every n modules), and orientations.
- Horizontal shades: depth and the height above the window head. The tool reports the projection factor, the shade depth divided by its height above the sill. Caution: energy codes credit shades only by their own rules. Verify any credit against the adopted code.
- Material bands: a material per zone, or a band of n floors. Materials come from a table: EIFS over CMU, metal panel, brick, fiber cement panel, and precast.
- Glazing types come from a table: insulated glass with a low-e coating (IGU), and laminated single-pane glass.

### 3.8 Corners

| Corner | Rule |
|---|---|
| Solid corner | The end modules stay as the system draws them. Default. |
| Glass corner | The two modules at a convex corner become full-height glass that wraps the corner |

A glass corner raises the WWR on both faces. The tool shows the change.

---

## 4. Site and zoning

### 4.1 Street faces

Ground-floor transparency applies to street faces only.

- You mark the street faces in the plan view.
- Default without a site: the south faces.
- Default with a site: faces whose midpoint is within 60 ft of a site road centerline and whose normal points toward it.

### 4.2 Ground-floor transparency

Caution: overlay districts and zoning codes set their own band and their own target. Verify both against the adopted code.

- Band: from 2 ft to 10 ft above the ground floor. Both heights are editable.
- Transparency = glazed area inside the band ÷ wall area inside the band, on street faces.
- Target: off by default. Presets with retail turn it on at 60 percent.

### 4.3 Energy code check

Caution: the 40 percent limit is the prescriptive path of ASHRAE 90.1-2019 for this climate. The performance path may allow more glass. Verify the edition and the path for each project.

- WWR limit: 40 percent by default, editable.
- The tool turns the overall WWR red above the limit and shows each orientation.
- The tool never says "compliant". It says "within the limit you set".

---

## 5. Live metrics

The metrics panel updates on every change. Four stay visible: WWR, the worst orientation, ground transparency, and balconies.

| Metric | Meaning |
|---|---|
| WWR | Glazing area ÷ gross wall area, overall |
| WWR by orientation | North, east, south, and west |
| Ground transparency | Section 4.2, against the target |
| Facade area | Gross wall area, by orientation and by zone |
| Glazing area | By orientation, by zone, and by system |
| Balconies | Count and slab area |
| Projection factor | Per shade rule |
| Solar exposure | Relative sun on each orientation (section 5.2) |
| Envelope note | Section 5.1, when on |

### 5.1 Envelope note

Caution: these values seed an editable table. They are typical starting values, not product data or code values. Verify every value against the product data and the code table for the project.

| Item | Seed value |
|---|---|
| Fixed fenestration limit, U-factor | 0.45 |
| Fixed fenestration limit, SHGC | 0.25 |
| IGU with low-e, U-factor / SHGC | 0.29 / 0.25 |
| Laminated single pane, U-factor / SHGC | 1.00 / 0.70 |
| EIFS over CMU, assembly U-factor | 0.09 |

The note lists the chosen glazing against the limits, as plain text. The SHGC is the solar heat gain coefficient: the share of the sun's heat that passes through the glass. The tool does not simulate energy.

### 5.2 Solar exposure

When the project holds a `sun` section, the tool reads its sun samples.

- For each orientation, sum `cos(altitude) × cos(azimuth − face bearing)` over the samples where the sun is above the horizon and in front of the face.
- Show each sum relative to the largest one (the most exposed orientation = 1.00).
- Without a sun section, the panel says "Run a sun study in the Tower Generator to see exposure."

---

## 6. Viewing

- Orbit, pan, and zoom with a mouse, a trackpad, or touch.
- Preset views: axonometric, four elevations, and plan.
- Model style: white model with glass in pale blue-gray, mullions as thin lines.
- Diagram style: faces colored by system, or by WWR on a light-to-dark scale.
- Elevation views are orthographic and match the DXF export.
- Context: the site neighbors, on or off.
- Selection: click a face to see its orientation, zone, length, and WWR.

---

## 7. Screenshots

- Export the current view as a PNG image.
- Optional metrics block, with the WWR table as a second option.
- Optional title, date, and CMRLM mark.
- AI-ready image and the prompt library, as in the other tools. The facade prompts describe the system, the material, and the balconies, so an image tool keeps the window pattern.

---

## 8. Options and saving

- Save an option with a name, for example "Option C — window wall with projected balconies."
- Saved options stay in the browser under their own storage key.
- Export and import all options as a JSON file.
- Duplicate an option. Compare two to four options side by side, with the WWR table.
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
| File structure | One HTML file, `facade/index.html`, built from parts in `build/facade/` | Same as the other tools |
| Shell | Copy of the Parking Deck shell | Newest shell with the project file wired in |
| 3D library | Three.js, same version as the other tools | One version across the toolkit |
| Panels in 3D | Instanced meshes, one per panel type | Thousands of panels stay smooth on an iPad |
| Polygons | clipper-lib 6.4.2 | Same rules as the other tools |
| Build step | `python3 build/facade/build.py` | Same as the other tools |
| Performance target | A 60-floor tower, 4 faces, 18 panels each (4,320 panels), smooth on an iPad | Covers tall towers |

### 10.1 Facade algorithm

The heart of the tool. The same inputs always give the same result.

1. **Levels.** Read the massing levels. Skip void floors and levels with no plates. Skip deck levels.
2. **Faces.** Build faces per level (section 3.2). Merge collinear edges. Classify each face.
3. **Zones.** Assign each level to a zone. Pick the rule for each face from its zone and orientation.
4. **Panels.** Panelize each face (section 3.5). Build each panel from its system (section 3.4).
5. **Corners.** Apply the corner rule at convex corners.
6. **Balconies.** Place balconies by pattern, or by unit when Plate Planner units exist. Cut inset balconies back into the wall.
7. **Shading and bands.** Add fins, shades, and material bands. They change no area.
8. **Areas.** Sum the wall and the glazing per face, per orientation, per zone, and per system.
9. **Checks.** WWR against the limit. Ground transparency against the target on street faces.
10. **Exposure.** Section 5.2, when the sun section exists.

### 10.2 Worked example A — the Mid-Rise default bar

| Input | Value |
|---|---|
| Massing | One bar, 300 × 65 ft, running east–west, 5 floors |
| Floor-to-floor | Level 1: 12 ft. Levels 2 to 5: 10 ft. Wall height 12 + 4 × 10 = 52 ft |
| System | Punched windows on all faces: 6 ft wide, sill 2 ft 6 in, head 8 ft → 5.5 ft tall, 33 sf each |
| Module | 14 ft |
| Corners | Solid |

Panels per face:

| Face | Length | Panels | Actual module | Windows per floor | Glazing per floor |
|---|---|---|---|---|---|
| North, south | 300 ft | floor(300 ÷ 14) = 21 | 14.29 ft | 21 | 693 sf |
| East, west | 65 ft | floor(65 ÷ 14) = 4 | 16.25 ft | 4 | 132 sf |

WWR by orientation:

| Orientation | Glazing (5 floors) | Wall | WWR |
|---|---|---|---|
| North | 5 × 693 = 3,465 sf | 300 × 52 = 15,600 sf | **0.222** |
| South | 3,465 sf | 15,600 sf | **0.222** |
| East | 5 × 132 = 660 sf | 65 × 52 = 3,380 sf | **0.195** |
| West | 660 sf | 3,380 sf | **0.195** |
| Overall | 8,250 sf | 37,960 sf | **0.217** |

The overall WWR is 21.7 percent, well within a 40 percent limit.

Ground transparency on the south face (the default street face): the band runs 2 ft to 10 ft. Each window has 5.5 ft of height inside the band. Glazing in the band = 21 × 6 × 5.5 = 693 sf. Band wall = 300 × 8 = 2,400 sf. **Transparency = 28.9 percent.**

With storefront on the south face of level 1 (glass from 1 ft 6 in to 10 ft, 2 in mullions counted as glazing), the whole band is glazing: **100 percent of the band**. The overall WWR rises to (8,250 − 693 + 300 × 8.5) ÷ 37,960 = 10,107 ÷ 37,960 = **0.266**.

### 10.3 Worked example B — a curtain wall tower floor

| Input | Value |
|---|---|
| Plate | 90 × 90 ft, every face 90 ft |
| Floor-to-floor | 10 ft |
| System | Curtain wall, 5 ft module, 8 ft vision + 2 ft spandrel |

Panels per face = 90 ÷ 5 = 18, exactly. Each panel: 5 × 8 = 40 sf of vision on 5 × 10 = 50 sf of wall.

**WWR = 40 ÷ 50 = 0.80 on every face.** The 40 percent check fails by a wide margin.

**Option B2: one view face.** Keep the 8 + 2 curtain wall on the north face for the view. On the east, south, and west faces use a 4 ft vision + 6 ft spandrel grid where every other module is a solid metal panel.

| Face | Glazing per floor | Wall per floor | WWR |
|---|---|---|---|
| North | 18 × 40 = 720 sf | 900 sf | 0.80 |
| East, south, west | 9 × (5 × 4) = 180 sf each | 900 sf each | 0.20 |
| Overall | 720 + 3 × 180 = 1,260 sf | 3,600 sf | **0.35** |

Option B2 is within the 40 percent limit. The north face keeps full-height glass. The tool shows this trade on screen as you edit.

---

## 11. Build plan

| Phase | Work | Model | Reason |
|---|---|---|---|
| 1 | Write the technical plan from this document | Opus | Contracts and trade-offs need judgment. |
| 2 | Build the shell: copy the Parking Deck shell, tabs, 3D view, units | Sonnet | Standard web and 3D code. |
| 3 | Build faces: edges, merge, normals, orientation, face groups for tapered and twisted towers | Opus | Normals and rotations hide sign errors. |
| 4 | Build panels and systems: panelizing, corners, balconies, fins, shades | Sonnet | The rules are clear once the faces exist. |
| 5 | Build metrics, checks, transparency, and exposure | Sonnet | Simple sums over the panels. |
| 6 | Build the elevations DXF, SketchUp, and the project file section | Sonnet | The formats exist in the other tools. |
| 7 | Make the presets and the test cases | Haiku | Simple and repetitive. |
| 8 | Review the areas and the WWR against hand calculations | Opus | Finds calculation errors. |
| 9 | Test on the Mac and the iPad | Cade | Only you can judge the feel of the controls. |

### 11.1 Presets

| Preset | Massing | System | Expected WWR |
|---|---|---|---|
| Residential punched windows with inset balconies | Mid-Rise bar, 300 × 65, 5 floors | Punched, 14 ft module, inset balconies every second module | about 0.25 |
| Hotel window wall | Tower, 24 floors on a podium | Window wall, 5 ft module, slab cover 1 ft 4 in | about 0.85, fails |
| Hotel window wall with solid bands | Same tower | Window wall on 3 of every 5 modules, metal panel on 2 | about 0.52, fails |
| Office curtain wall | Tower, office slab | Curtain wall, 8 ft vision + 4 ft spandrel at 13.5 ft ftf | about 0.59, fails |
| Office curtain wall, one view face | Same slab | Section 10.3 option B2 logic | about 0.38 |
| Podium retail storefront | Mid-Rise podium, five over two | Storefront on the base street faces, punched above | about 0.27, transparency about 100 percent |
| Courtyard multifamily with projected balconies | Mid-Rise courtyard | Punched, projected balconies, alternating | about 0.23 |
| Tower glass corner with fins | Tower, point tower | Window wall, glass corners, fins every module | about 0.82, fails |

The technical plan computes each expected value by hand. Presets that fail the 40 percent limit show the check on purpose.

---

## 12. Decisions

1. **Visual style:** Both. One toggle switches between the white model and the diagram style.
2. **Units:** Feet and square feet only.
3. **Massing sources:** Tower Generator, Mid-Rise Generator, or a standalone typed massing.
4. **Systems:** Punched windows, window wall, curtain wall, and storefront.
5. **Orientation:** Four 90-degree sectors in the project frame, after the placement rotation.
6. **Glazing area:** The whole window opening, frames included.
7. **Panelizing:** Whole modules; the remainder stretches the modules evenly.
8. **WWR limit:** 40 percent by default, editable, with a Caution line.
9. **Ground transparency:** Band 2 to 10 ft, street faces only, target off by default.
10. **Energy:** An optional envelope note from an editable table. No simulation.
11. **Users:** Cade and RJTR teammates. A short Help panel in the tool.
12. **Names:** Generic names only in presets, tests, ids, and notes. No district names.
13. **Project file:** Part of version 1. The tool writes its section and keeps the others unchanged.

---

## 13. Risks

| Risk | Effect | Response |
|---|---|---|
| Normals point the wrong way | Faces in the wrong orientation; WWR by orientation is wrong | Rings are cleaned to counter-clockwise outer and clockwise holes. Tests for a square, a rotated square, an L, and a courtyard. |
| Placement rotation applied twice | Every face in the wrong sector | One function turns local normals into project bearings. Tests at 0, 30, 45, and 90 degrees. |
| Twisted towers give thousands of faces | Slow updates | Face groups merge stacked edges. Draft panels during a drag. |
| The WWR differs from the energy model | Two numbers for one building | State the glazing rule (whole opening) in the panel and the export. |
| Code values differ by edition and path | A wrong limit | Editable tables. Caution lines. The tool never says "compliant". |
| The tower does not write `massing.derived` yet | No tower faces | The work session adds the writer. Until then, use a Mid-Rise massing or the standalone massing. |
| Lost saved work | You lose options | Export JSON backups. The project file holds the current option. |

---

## 14. Project file

The project file is the shared JSON file that carries one project between the tools. The spec is `docs/project-file-spec.md`.

**Reads:**

- `sections.massing.derived.levels`: plates, `z`, `ftf`, zone, and program of each level. Tower and Mid-Rise write the same shape.
- `sections.massing.placement`: the rotation that turns local normals into project bearings.
- `sections.plates.derived.levels[].units`: `outer`, `exposures`, and `bay`, for balconies per unit.
- `sections.site.derived.roads.segments`: road centerlines, for the default street faces.
- `sections.sun.derived.samples`: sun positions, for the exposure. The work session writes this section with `src/shared/solar.js`.

**Writes** `sections.facade`, with the same placement as the massing section:

```js
{
  tool: "facade", schema: 1, updatedAt,
  placement,                               // copied from sections.massing.placement
  state,                                   // the full Facade Studio state
  derived: {
    faces: [{
      id, levelFrom, levelTo, orientation, system, area, glazing, wwr, balconies,
      edge: [[x, y], [x, y]],              // new, optional: the edge on levelFrom, local frame
      bearing,                             // new, optional: outward normal, degrees clockwise from project north
      zone,                                // new, optional: "base" | "middle" | "top" | a level-range id
      street,                              // new, optional: true on street faces
    }],
    metrics: {
      wwr, wwrByOrientation: { N, E, S, W }, groundTransparency,
      facadeArea, glazingArea,             // new, optional
      balconyCount, balconyArea,           // new, optional
      wwrLimit,                            // new, optional: the limit in use
      exposure: { N, E, S, W } | null,     // new, optional: relative, 1.00 = most exposed
    },
  },
}
```

- Every new key is optional and additive. The spec section 6.5 gets the same keys when the technical plan is approved.
- `orientation` keeps the spec values: `N`, `E`, `S`, `W`.
- The SketchUp format must accept the source `facade`. The integrator adds it, as it did for `midrise` and `parking`.

**Handoffs:** the Tower Generator and the Mid-Rise Generator get a "Send to Facade Studio" item that opens `../facade/?project=<id>`. The Parking Deck's planned item turns on. The Facade Studio has no Send button in version 1.

**Rule:** A tool writes only its own section. It keeps every other section unchanged, including sections it does not understand.

---

## 15. Open questions for Cade

1. **Panel remainder:** Stretch the modules evenly, or keep the module and add a narrow closer panel at one end? Recommended: stretch the modules. Windows stay evenly spaced, and the stretch is small.
2. **Glazing area rule:** Count the whole window opening with frames, or only the glass? Recommended: the whole opening. Energy codes count fenestration area this way.
3. **Inset balconies:** Count the recessed door glass in the WWR? Recommended: yes, at the recessed plane, with the cut-back wall as wall area.
4. **Ground transparency target:** Off by default, or on at a typical value? Recommended: off by default; the retail presets turn it on at 60 percent.
5. **Parapets and roof screens:** Leave them out of the wall area? Recommended: leave them out. They enclose no floor and would lower the WWR without a real change.
