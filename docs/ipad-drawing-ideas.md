# iPad Direct-Drawing Ideas

Version 1 · October 27, 2026 · Owner: Cade (CMRLM)

This list collects features that use direct drawing on the iPad with an Apple Pencil or a finger. It is a list of ideas, not a commitment. Nothing here shows in the app until it is built, polished, and complete.

## 1. Basic rule

- The Apple Pencil draws and edits. A finger orbits, pans, and zooms. A mouse or trackpad keeps today's behavior.
- The shell reads `pointerType` on each pointer event (`pen`, `touch`, `mouse`). This rule needs no mode button.
- When the Pencil draws in a 3D view, the shell switches to the Plan view first, so a stroke maps to the ground without distortion.

## 2. Shared drawing parts (build once, use in every tool)

| Part | What it does |
|---|---|
| Stroke capture | Records Pencil points with time and pressure. Finger touches during a stroke are ignored (palm rejection). |
| Simplify | Turns a freehand stroke into a clean polyline with few points (Ramer–Douglas–Peucker, tolerance in feet). |
| Shape snap | Hold the Pencil still at the end of a stroke to snap it to a straight line, a rectangle, or a circle (like Apple Notes). |
| Close detection | A stroke that ends near its start becomes a closed ring. |
| Grid and object snap | Snaps the final points to the 1 ft grid, to edges, to corners, and to other drawn items. Uses the snap code that exists now (`src/tower/snap.js`, the Grading `snapPoint`). |
| Vertex edit | Drag a vertex or a midpoint with the Pencil. Tap a vertex twice to delete it. |
| Scrub to erase | A fast zigzag over an item deletes it, with undo. |

## 3. Ideas by tool

### Site Model

| Idea | Note |
|---|---|
| Lasso to remove buildings | Draw a loop around neighbor buildings to remove them in one step. |
| Draw the property line | Trace the lot on the ground when the public data has no parcel. |
| Mark trees | Tap or draw a line of trees by hand (until trees come from a map image). |

### Tower Generator

| Idea | Note |
|---|---|
| Sketch a footprint | Draw a polygon to make a new segment shape or a podium. |
| Draw setback lines | Draw a line along a property edge to set that setback. |
| Pull floors | Drag up on a segment top with the Pencil to add floors. |
| Draw a carve | Draw a closed shape on a facade to cut a carve or a sky gap. |

### Parking Deck

| Idea | Note |
|---|---|
| Draw a standalone deck | Draw a rectangle or polygon for the deck footprint. |
| Draw entry lanes | Draw a short line from the street to the deck edge. |
| Place cores | Tap to drop a stair or an elevator core. |

### Grading Sketch

| Idea | Note |
|---|---|
| Freehand drives, walls, and routes | Today each point is a tap. A stroke plus Simplify is much faster. |
| Draw lots | A closed stroke makes a lot. |
| Draw the section line | One stroke sets the section line for the profile view. |
| Spot elevations | Tap with the Pencil to read the ground height; long-press to type a target height. |

### Plate Planner (its own page)

| Idea | Note |
|---|---|
| Paint units along the facade | The Plate Planner's main tool is already "paint along the facade". The Pencil makes it natural. |
| Free-draw a unit | Draw a closed shape for an odd unit. |
| Split with a stroke | A stroke across a unit splits it at that line. |

### Shell-wide

| Idea | Note |
|---|---|
| Markup layer | Red-line notes on the 3D view, saved in the project, shown in screenshots. Good for design reviews. |
| Measure | Draw a line to read its length and slope. |
| Sun spot check | Tap a point on the ground to read its sun hours (after the Sun Study returns to the shell). |
| Handwriting in fields | iPadOS Scribble already turns handwriting into text in any text field. No code needed. |

## 4. Limits and open points

- Web pages cannot read the Apple Pencil double-tap or squeeze gestures. A tool change needs an on-screen button. Confidence: high.
- Pencil hover (iPad Pro with M2 or later) shows in Safari as pointer move events before contact. Use it for a snap preview. Confidence: medium; test on Cade's iPad before design work depends on it.
- Pressure and tilt are available (`pressure`, `tiltX`, `tiltY`). They have no clear use in these tools yet. Do not build features on them now.
- Which iPad and Pencil model Cade uses decides whether hover is available. Open point.

## 5. Suggested order

1. Shared drawing parts (section 2) with Grading freehand drives and walls as the first user.
2. Site lasso remove, Tower footprint sketch, Parking footprint sketch.
3. Markup layer and Measure.
4. Plate Planner Pencil painting (its own page).
