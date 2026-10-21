# Tower Generator — Concept Document

Version 0.1 · October 20, 2026 · Owner: Cade

---

## 1. Purpose

The tower generator is a browser tool for fast massing studies. It lets you shape a tower with sliders and see the 3D form and the area numbers change at the same time.

The tool is for conceptual design only. It does not replace Revit or Rhino. It replaces the first hour of sketching boxes and adding up floor areas by hand.

**Main goal:** Go from a site and a target area to three or four believable tower options in less than 15 minutes.

---

## 2. Scope

### 2.1 Version 1 includes

- Tower and podium forms with regular and irregular controls.
- A site boundary with zoning setbacks and a height limit.
- Live area metrics.
- Screenshot export.
- Saved options in the browser.
- Use on a Mac browser and on an iPad.
- Hosting on GitHub Pages.

### 2.2 Version 1 does not include

- Code checks (for example, high-rise or exit stair rules).
- Model export (OBJ, DXF, or similar).
- Random form generation.
- Multi-user access.
- Structural or facade design.

---

## 3. Form system

### 3.1 Basic model

The tool builds the tower as a stack of floor plates. Each floor plate is a flat shape with a height. Every form control changes the shape, size, rotation, or position of the plates.

This model keeps the area math exact. The area of the tower is the sum of the plate areas.

### 3.2 Building zones

The tower has four zones. Each zone has its own controls.

| Zone | What it is |
|---|---|
| Podium | The wider base of lower floors. It often holds parking, retail, or amenities. |
| Tower body | The main stack of typical floors. |
| Mechanical floors | Optional floors for equipment, at any level. |
| Crown | The top of the building. |

### 3.3 Footprint shapes

Choose one shape for the podium and one shape for the tower body.

- Rectangle
- Square
- Circle
- Ellipse
- Triangle
- L-shape
- U-shape
- Custom polygon (draw it, or type the corner points)

Each shape has width and depth controls. Rectangle and square shapes also have a corner radius control.

### 3.4 Height controls

- Floor count for each zone.
- Floor-to-floor height for the ground floor, podium floors, typical floors, and mechanical floors. Floor-to-floor height means the distance from one floor surface to the next floor surface.
- Total height shows as a live number.

### 3.5 Regular form controls

| Control | What it does | Settings |
|---|---|---|
| Taper | Makes the plates smaller or larger as the tower rises. | Amount, X and Y separately, curve type (straight or eased) |
| Twist | Rotates each plate a little more than the plate below it. | Total degrees, start floor, end floor, curve type |
| Setbacks | Steps the plates in at chosen floors. | Floor number, step distance, which sides |
| Podium | Sets the base size and height. | Floor count, site coverage, offset from tower |
| Crown | Shapes the top of the tower. | Flat, stepped, sloped, spire, or equipment screen |

### 3.6 Irregular form controls

Irregular forms in this tool are designed, not random. You control every move.

| Control | What it does |
|---|---|
| Segments | Splits the tower body into two or more stacked parts. Each part has its own shape, size, offset, and rotation. |
| Shift | Moves a segment sideways to make a cantilever (a floor that projects past the floor below). |
| Lean | Tilts the tower so that each plate moves a little in one direction. |
| Carve | Removes a volume at chosen floors to make a sky garden or a gap. |
| Cut | Slices a corner or one side at an angle. |

### 3.7 Core

The core is the central zone for elevators, stairs, and shafts. In version 1, the core is a simple rectangle.

- Set the core width and depth, or set the core as a percent of the typical plate.
- The tool shows a warning if the core does not fit inside the smallest plate.

---

## 4. Site and zoning

### 4.1 Site boundary

- Type a width and depth for a rectangular site, or draw a polygon.
- The tool shows the site area.

### 4.2 Zoning envelope

The zoning envelope is the 3D limit that zoning rules put on the building.

- Setback distance for each property line.
- Maximum building height.
- Optional tower stepback: the tower must step back a set distance above a set height.

### 4.3 Envelope display and warnings

- The envelope shows as a transparent wireframe.
- Any part of the tower outside the envelope turns red.
- A warning lists each problem, for example "Floor 34 exceeds the height limit."

---

## 5. Live metrics

The metrics panel updates each time a control changes.

| Metric | Meaning |
|---|---|
| GFA | Gross floor area. The total area of all floor plates. |
| FAR | Floor area ratio. GFA divided by site area. |
| Site coverage | Ground floor plate area divided by site area. |
| Total height | Height from grade to the top of the crown. |
| Floor count | Total floors, and floors in each zone. |
| Plate area | Smallest, largest, and average floor plate area. |
| Efficiency | Plate area minus core area, divided by plate area. |
| Net area | GFA minus core area on all floors. |
| Unit estimate | Net area on residential floors divided by an average unit size that you set. |
| Target check | Your target GFA or FAR compared to the current value. |

**Units:** Feet and square feet only in version 1.

### 5.1 Program types

Choose a program type for each zone: residential, office, hotel, retail, parking, or amenity. Each type has a default floor-to-floor height and a default unit size. You can change all defaults.

---

## 6. Viewing

- Orbit, pan, and zoom with a mouse, a trackpad, or touch.
- Preset views: axonometric, four elevations, and plan.
- Floor lines on or off.
- Simple sun shadow on or off.
- Ground grid and a human scale figure.
- Colors by zone or by program type.

---

## 7. Screenshots

- Export the current view as a PNG image.
- Optional metrics block on the image.
- Optional title and date on the image.
- Optional CMRLM mark in one corner.

---

## 8. Options and saving

- Save an option with a name, for example "Option A — twisted slab."
- Saved options stay in the browser on that device.
- Export all options as a JSON settings file. Import the file on another device. This step moves your work from the Mac to the iPad.
- Duplicate an option to start a new variation.

**Caution:** Browser storage can clear if you clear the browser data. Export the JSON file to keep a backup.

---

## 9. iPad use

- Controls are large enough for a finger.
- Sliders also accept typed numbers.
- The layout changes for portrait and landscape.
- Add the tool to the iPad Home Screen as a web app.

---

## 10. Technical approach

| Item | Choice | Reason |
|---|---|---|
| File structure | One HTML file | Easy to host, edit, and back up |
| 3D library | Three.js, loaded from a public library server | Mature, fast, and well documented |
| Build step | None | Faster changes and fewer errors |
| Hosting | GitHub Pages | Same as your other tools |
| Performance target | 150 floors with smooth motion on an iPad | Covers supertall studies |

### 10.1 Toolkit foundation

This tool is the first tool in a future toolkit. Build these parts so that the next tools can use them again:

- One visual style (colors, fonts, panel layout).
- One control style (sliders, number fields, toggles).
- One units module (feet and square feet now, with space to add meters later).
- One save and export module.
- One screenshot module.

---

## 11. Build plan

| Phase | Work | Model | Reason |
|---|---|---|---|
| 1 | Write the technical plan from this document | Opus | This step needs design judgment and trade-off decisions. |
| 2 | Build the shell: layout, 3D view, controls, units | Sonnet | This is standard web and 3D code. Sonnet does it fast. |
| 3 | Build the regular form controls and metrics | Sonnet | The geometry is simple and well known. |
| 4 | Build the irregular form controls | Opus | Segments, carves, and cuts need careful geometry. |
| 5 | Build the site, envelope, and warnings | Sonnet | The rules are clear and direct. |
| 6 | Make the presets and test cases | Haiku | This work is simple and repetitive. |
| 7 | Review the geometry and the area math | Opus | Opus finds calculation errors better. |
| 8 | Test on the Mac and the iPad | You | Only you can judge the feel of the controls. |

**Estimate:** Phases 2 to 5 can run as a few sessions. Phase 1 and phase 7 are short.

---

## 12. Decisions (October 20, 2026)

1. **Visual style:** Both. One toggle switches between the white physical model and the diagram style.
2. **Units:** Feet and square feet only. No metric toggle in version 1.
3. **Context:** Simple neighbor blocks are in version 1. A toggle shows or hides them.
4. **Compare view:** A side-by-side view of two to four saved options is in version 1.
5. **Starting presets:** Slim residential point tower, office slab, hotel on a podium, and Tampa-type multifamily.

---

## 13. Risks

| Risk | Effect | Response |
|---|---|---|
| Irregular forms make the area math wrong | Bad numbers in early decisions | Calculate area from the plates only. Test against hand calculations. |
| Too many controls | The tool feels slow to use | Group controls by zone. Hide advanced controls until you open them. |
| iPad performance | Slow motion on tall towers | Draw fewer details while you drag a slider. |
| Lost saved work | You lose options | Export JSON backups. |
