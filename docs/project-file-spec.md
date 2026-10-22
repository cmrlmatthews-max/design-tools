# Project File — Spec and Module Contract

Version 1 · October 21, 2026 · Owner: Cade (CMRLM)

This document is the contract between every tool in the suite. A tool that reads or writes a project file follows it exactly. The Plate Planner and the Sun Study (built on a download of this repository) follow it too. Change this document first, then the code.

## 1. Purpose

A project file holds one design study as it moves through the tools: the site, the massing, the floor plates, the parking, the facade, the sun study, the grading, and the egress check. Each tool reads what the tools before it made, adds its own part, and hands the file on.

The file is one JSON document, `<name>.cmrlm.json`. All lengths are feet. All areas are square feet. Angles are degrees.

## 2. One project, many tools

The tools run in this pipeline order. The Workspace page (section 9) shows them in this order.

| Order | Tool id | Tool | Section it owns | Status |
|---|---|---|---|---|
| 1 | `site` | Site Model | `site` | Exists |
| 2 | `tower` | Tower Generator | `massing` (and `sun`) | Exists |
| 2 | `midrise` | Mid-Rise Generator | `massing` | Next build |
| 3 | `plate` | Plate Planner | `plates` | Work Claude |
| 4 | `parking` | Parking Deck | `parking` | Planned |
| 5 | `facade` | Facade Studio | `facade` | Planned |
| 6 | `tower` | Sun Study (inside the Tower Generator) | `sun` | Work Claude |
| 7 | `grading` | Grading Sketch | `grading` | Later |
| 8 | `egress` | Egress Sketch | `egress` | Later |

A project holds one massing. Either the Tower Generator or the Mid-Rise Generator owns the `massing` section, never both. The section's `tool` field says which one wrote it last.

## 3. File format (version 1)

```jsonc
{
  "format": "cmrlm-design-tools/project",
  "version": 1,                              // envelope version (this document)
  "id": "6f1c…",                             // UUID, fixed for the life of the project
  "name": "Ravinia test",
  "createdAt": "2026-10-21T20:00:00Z",
  "updatedAt": "2026-10-21T21:15:00Z",
  "units": "feet",
  "frame": {
    "kind": "site" | "local",
    "lat": 33.927 | null, "lon": -84.339 | null,   // site center; null without a site
    "size": 1000 | null,                            // site square, ft; null without a site
    "zDatum": "NAVD88" | "local"
  },
  "sections": {
    "site":    { "tool": "site",    "schema": 1, "updatedAt": "…", "placement": { "x": 0, "y": 0, "rotation": 0, "baseZ": 0 }, "state": {}, "derived": {} },
    "massing": { "tool": "tower" | "midrise", "schema": 1, "updatedAt": "…", "placement": { "x": 500, "y": 500, "rotation": 0, "baseZ": 1012.5 }, "state": {}, "derived": {} },
    "plates":  { "tool": "plate",   "schema": 1, "updatedAt": "…", "placement": { … }, "state": {}, "derived": {} },
    "parking": { "tool": "parking", "schema": 1, "updatedAt": "…", "placement": { … }, "state": {}, "derived": {} },
    "facade":  { "tool": "facade",  "schema": 1, "updatedAt": "…", "placement": { … }, "state": {}, "derived": {} },
    "sun":     { "tool": "tower",   "schema": 1, "updatedAt": "…", "placement": { … }, "state": {}, "derived": {} },
    "grading": { "tool": "grading", "schema": 1, "updatedAt": "…", "placement": { … }, "state": {}, "derived": {} },
    "egress":  { "tool": "egress",  "schema": 1, "updatedAt": "…", "placement": { … }, "state": {}, "derived": {} }
  },
  "log": [
    { "at": "2026-10-21T20:00:00Z", "tool": "site",  "action": "write" | "send" | "import", "note": "Ravinia, 1,000 ft" }
  ]
}
```

Rules for the envelope:

- `format` and `version` are required. A reader rejects any other `format`. A reader with a smaller `version` than the file opens it read-only.
- Every key in `sections` is optional. A section that no tool has written is absent, or present with `state: {}` and `derived: {}`. Both mean "empty".
- A section holds exactly these keys: `tool`, `schema`, `updatedAt`, `placement`, `state`, `derived`. A tool may add keys inside `state` and `derived` only.
- `log` is append-only. One entry per write, send, or import. Keep the newest 200 entries.
- Strings are UTF-8. Numbers are plain JSON numbers. Round coordinates to 0.001 ft and areas to 0.1 sf.

## 4. Frame and placement

The project frame is the one coordinate system that every section shares.

1. With a site (`frame.kind = "site"`), the project frame is the Site Model frame: origin at the southwest corner of the site square, x to the east, y to true north, z = NAVD88 feet. z is never shifted. `frame.lat`, `frame.lon`, and `frame.size` repeat the site center and size.
2. Without a site (`frame.kind = "local"`), the origin is arbitrary, `zDatum` is `"local"`, and every `baseZ` is 0.

Every section carries a `placement`. It maps that section's local coordinates to the project frame:

```
xp = x · cos(r) − y · sin(r) + placement.x
yp = x · sin(r) + y · cos(r) + placement.y
zp = z + placement.baseZ
```

`r` is `placement.rotation` in degrees, counter-clockwise, measured from project north to the section's local +y axis. A rotation of 0 means local north is project north. A rotation of 90 turns the local +y axis to the project west.

- The site section's placement is the identity: `{ x: 0, y: 0, rotation: 0, baseZ: 0 }`.
- The tower's local frame is its own: the site rectangle is centered on the origin and north is +y. Its state keeps working unchanged. The placement tells where that origin sits in the project.
- The Mid-Rise Generator, the Plate Planner, the Parking Deck, and the Facade Studio use the massing's local frame. They copy the massing placement when they first write, and keep it in step after that.
- `baseZ` is the finished floor elevation (FFE) of the ground floor, in project z. FFE means the elevation of the top of the floor you walk on. When a tool first sends a massing into a site project, it sets `baseZ` to the site ground elevation at the placement point.
- The ground-floor FFE of a massing or a deck is `sections.grading.derived.ffe` when that section exists and holds a tier for that source (`source` = `massing` or `parking`; the lowest tier when there are several). Otherwise it is `placement.baseZ`. The Grading Sketch never edits another section's placement.
- Sun and grading use the project frame directly. Their placement is the identity.

## 5. State, derived, and ownership

Each section has two halves.

- `state` is the tool's own saved option state, unchanged. The Tower Generator drops its schema-1 state in as is. Nobody else reads it.
- `derived` is the geometry and the numbers that other tools read. Section 6 defines it per tool.

Caution: a tool that rewrites another section destroys that tool's work. There is no undo across tools.

- A tool reads other sections' `derived` only. It never reads their `state`.
- A tool writes only its own section, the top-level `updatedAt`, and one `log` entry. It keeps every other section and every unknown key byte for byte. `project.js` enforces this; a tool never edits the document object by hand.
- Section `schema` numbers belong to one tool each. They move on their own.
- When a tool meets a section of its own with a `schema` newer than it knows, it opens the project read-only, shows the notice once ("This project was saved by a newer version of this tool. You can view it, but changes will not be saved."), and never writes. This is the storage.js rule.
- When a tool meets another tool's section with an unknown schema, it reads what it can from `derived` and warns once in the metrics panel.

## 6. Derived shapes

Shared types:

- `Ring` = `[[x, y], …]`, closed implicitly, no repeated last point.
- `MultiPoly` = `[{ outer: Ring, holes: [Ring, …] }]`. Outer rings run counter-clockwise, holes clockwise, seen from above. Clean every ring with `cleanRing2` from `src/shared/sketchup-format.js` before you write it.
- `Line3` = `[[x, y, z], …]`.
- Coordinates in `derived` are in that section's local frame. Readers transform them with `toProject` (section 10).

### 6.1 `site.derived` (writer: Site Model)

```jsonc
{
  "address": "…",                     // as the user typed it
  "lat": 33.927, "lon": -84.339,      // site center
  "size": 1000,                       // ft
  "release": "2026-09-24.0",          // Overture release used
  "boundary": Ring,                   // the site square: [[0,0],[S,0],[S,S],[0,S]]
  "ground": { "spacing": 10, "n": 101, "points": [[x, y, z], …] },   // every grid node, row-major from the south
  "buildings": [ { "id": "…", "outer": Ring, "holes": [Ring], "base": 1010.2, "height": 48, "top": 1058.2, "floors": 4, "rule": "data" | "floors" | "estimate", "name": "",
                   "removed": true } ],   // optional; the user removed this building in the Site Model. Readers skip it unless they draw demolition.
  "roads": { "segments": [ { "id": "…", "cls": "primary", "name": "…", "width": 36, "line": Line3 } ], "pavement": MultiPoly },
  "walks": MultiPoly | null,
  "trees": [ { "x": 0, "y": 0, "z": 0, "canopy": 30, "height": 40 } ],
  "water": { "areas": [ { "ring": Ring, "holes": [Ring], "level": 1001.5, "cls": "pond" } ], "lines": [Line3] }
}
```

- `ground.points` is the same grid as the Revit CSV. The grid rule (spacing = max(10, ceil(S / 99 · 2) / 2) ft) already keeps it at 10,000 points or fewer. No further thinning.
- `site.state` holds the fetch parameters: `{ query, lat, lon, size, release, walks, removed }`. With them the Site Model rebuilds the full model (trees, water lines, contour shading) on demand.
- `site.state.removed` is the list of removed building ids (strings, unique, sorted; `[]` when there is none). A file without the key has no removed buildings. The Site Model applies the list again after a refetch and drops ids that no longer exist.
- `removed` on a building: every building stays in `derived.buildings`, and a removed one carries `removed: true`. A building that is not removed has no `removed` key. Pieces of one Overture feature (`b`, `b~2`, `b~3`) are removed together.
- Reader rule: `siteContextFor` and `buildSiteLayerData` skip removed buildings (no context block, no site-layer solid, no shadow, no sun-hours blocker); `opts.includeRemoved: true` returns them flagged. The Site Model exports draw them only as ground outlines on DXF layer `BLDG-REMOVED` and leave them out of the SketchUp file.
- Elevations are true NAVD88 feet, never shifted.

### 6.2 `massing.derived` (writers: Tower Generator and Mid-Rise Generator, same shape)

```jsonc
{
  "footprint": MultiPoly,             // plan union of every level
  "height": 503,                      // ft from baseZ to the top of the crown
  "levels": [
    {
      "index": 1,                     // 1 = ground floor; same count as the tool's floor list
      "name": "Floor 1",
      "zone": "podium" | "tower" | "mechanical" | "crown" | "bar" | "deck",
      "z": 0,                         // floor surface, ft above baseZ
      "ftf": 18,                      // floor-to-floor, ft
      "program": "retail",
      "plates": MultiPoly,            // the floor plate (several pieces allowed)
      "core": Ring | null,            // the core rectangle, or null
      "spines": [ [[x, y], [x, y]], … ] | [],  // corridor centerlines; bars give them, the tower leaves []
      "seeds": [ { "kind": "stair" | "exterior-stair" | "elevator", "outer": Ring } ] | []   // optional starting blocks for the Plate Planner
    }
  ],
  "context": { "blocks": [ { "x": 0, "y": -180, "w": 200, "d": 120, "h": 60 } ] },   // the neighbor blocks the tool shows
  "metrics": { "gfa": 0, "far": 0, "siteCoverage": 0, "floors": 0, "height": 0, "units": 0 }   // units is an estimate
}
```

- Zones `podium`, `tower`, `mechanical`, and `crown` come from the Tower Generator (`buildPlates` plates plus the crown). Zones `bar` and `deck` come from the Mid-Rise Generator. A crown level has `ftf` = the crown height and its plates = the crown footprint.
- A void floor (full carve) is written with `plates: []`.
- A design with no site (`state.site.shape` = `"none"`, "Unlimited": the default for new Tower and Mid-Rise designs) has no site ring in `derived`; `derived` never holds one. `metrics.far` and `metrics.siteCoverage` are written as `0`, and a reader treats them as "no site", not as a real zero. `state.site` keeps its width, depth, setbacks and stepback so the tool can switch back to Rectangle. A saved state whose `site` has no `shape` is a rectangle (older files); a reader must not read it as `"none"`.
- `index` is an id in list order, not an elevation order. The Mid-Rise Generator lists podium levels, then bar floors, then deck levels (deck indices come after the building levels). A reader that needs elevation order sorts by `z`.
- The Tower Generator needs one new pure function, `towerDerived(state, built)` in `src/tower/derived.js`, that maps `buildPlates(state)` plates to this shape. The Mid-Rise Generator writes the same shape from its own geometry.
- `metrics.units` repeats the tool's unit estimate. The Plate Planner replaces it with a real count.
- `seeds` is optional. The Mid-Rise Generator writes its stair and elevator blocks here. The tower writes `[]` or omits the key. The Plate Planner reads them as a starting core and may move or delete them.

### 6.3 `plates.derived` (writer: Plate Planner)

```jsonc
{
  "mode": "multifamily" | "hotel",
  "levels": [
    {
      "index": 3,                     // the massing level index this plate fills
      "plate": MultiPoly,             // the plate as laid out (equals the massing plate unless edited)
      "corridor": MultiPoly,
      "core": {
        "outer": Ring,
        "stairs":    [ { "id": "S1", "outer": Ring, "door": [x, y] } ],
        "elevators": [ { "id": "E1", "outer": Ring } ]
      },
      "units": [ { "id": "3-07", "type": "1BR", "outer": Ring, "area": 745.5, "exposures": ["S", "E"], "corner": true, "bay": { "from": 120.0, "to": 148.0 } } ],
      "metrics": { "units": 18, "nrsf": 13410, "gsf": 16200, "efficiency": 0.828 }
    }
  ],
  "mix": [ { "type": "1BR", "count": 120, "share": 0.5, "avgArea": 740 } ],
  "metrics": { "units": 240, "nrsf": 0, "gsf": 0, "efficiency": 0, "corridorFt": 0 }
}
```

- `nrsf` is net rentable square feet. `gsf` is gross square feet. `efficiency` = nrsf / gsf.
- `bay.from` and `bay.to` are distances in feet along the facade ring that the unit faces, counter-clockwise from the ring's first vertex. An optional `ring` on the unit names that ring: 0 = the outer ring, k = hole ring k.
- Optional keys the Plate Planner also writes (see `docs/plate-planner-notes.md`, section 9): `massingUpdatedAt` on `derived`; `support: [{ id, outer, kind }]` on each level; `demising` (the two cut lines) on each unit.
- `exposures` lists the compass sides of the unit with a facade, in the local frame after the massing rotation. The Facade Studio and the Egress Sketch read `units`, `corridor`, and `core`.
- Version 1 of the Plate Planner (October 2026) writes these keys too. Readers must accept them and must not need them:
  - On `derived`: `massingUpdatedAt` (the `massing.updatedAt` that the fill used; a newer massing makes the plates stale).
  - On each level: `name`, `z` (floor surface, ft above `baseZ`), `ftf`, and `support: [{ id, outer, kind }]`.
  - On each unit: `ring`, `demising` (the cut lines, each `[[x, y], [x, y]]`), and `accessible` (`false`, `true`, or a type such as `"type-a"`).
  - On `metrics`: `bays` (hotel mode only: the keys times the bays per key).
- Unit `type` is the type NAME (for example `"1BR"`), not the internal id.
- Area rule: unit `area` is measured to the centerline of the demising walls, to the corridor face of the corridor wall, and to the inside face of the exterior wall. The 0.5 ft corridor wall counts in the unit; the plate edge is the outside face, so the fill takes a 1.0 ft exterior wall allowance off the plate first. `nrsf` is the sum of unit areas, so it is a planning number, not a leasing number.
- Every coordinate is in the massing local frame (the frame of `massing.derived.levels[].footprint`).

### 6.4 `parking.derived` (writer: Parking Deck)

```jsonc
{
  "levels": [
    {
      "index": 1, "z": -10.5,          // floor surface, ft above baseZ (below grade is negative)
      "plate": MultiPoly,
      "stalls": [ { "id": "P1-001", "outer": Ring, "kind": "standard" | "compact" | "accessible" | "van" | "ev" } ],
      "aisles": MultiPoly,
      "ramps": [ { "id": "R1", "outer3d": [[x, y, z], …], "slope": 0.0625 } ],   // slope as a fraction
      "columns": [[x, y], …]
    }
  ],
  "metrics": { "stalls": 412, "byKind": { "standard": 390, "accessible": 9, "van": 2, "ev": 11 }, "sfPerStall": 338, "levels": 4 }
}
```

Optional keys (added with the Parking Deck Generator, October 21, 2026):

- On each level: `"cores": [ { "id": "S1", "kind": "stair" | "elevator", "outer": Ring } ]` and `"clearHeight": 8.0` (the lowest clear height on the level, ft).
- On each stall: `"evReady": true`.
- In `metrics`: `"accessible": { "required", "provided", "van" }`, `"ev": { "installed", "ready" }`, `"bike": { "required", "areaSf" }`, `"conflicts": 0`.
- `index` 1 is the lowest parking level. `z` is relative to `baseZ`.

### 6.5 `facade.derived` (writer: Facade Studio)

```jsonc
{
  "faces": [ { "id": "F3", "levelFrom": 3, "levelTo": 24, "orientation": "S", "system": "window-wall", "area": 18200, "glazing": 7100, "wwr": 0.39, "balconies": 44 } ],
  "metrics": { "wwr": 0.37, "wwrByOrientation": { "N": 0.31, "E": 0.40, "S": 0.39, "W": 0.40 }, "groundTransparency": 0.68 }
}
```

`wwr` is the window-to-wall ratio: glazing area divided by wall area. `groundTransparency` is the glazed share of the ground-floor street wall.

Optional keys (added with the Facade Studio, October 22, 2026):

- On each face: `"edge": [[x, y], [x, y]]` (local frame, on `levelFrom`), `"bearing"` (degrees clockwise from project north), `"zone"`, `"street": true | false`.
- In `metrics`: `"facadeArea"`, `"glazingArea"`, `"balconyCount"`, `"balconyArea"`, `"wwrLimit"`, `"exposure": { "N", "E", "S", "W" } | null`.
- `levelFrom` and `levelTo` are massing level indices. Glazing counts the whole window opening. `system` is kebab-case: `punched`, `window-wall`, `curtain-wall`, `storefront`, `solid`.

### 6.6 `sun.derived` (writer: Sun Study, inside the Tower Generator)

```jsonc
{
  "lat": 33.927, "lon": -84.339, "tzOffset": -4,          // hours from UTC on the study dates
  "dates": ["2026-03-20", "2026-06-21", "2026-12-21"],
  "samples": [ { "date": "2026-06-21", "time": "09:00", "azimuth": 82.1, "altitude": 38.4 } ],
  "sunHours": { "spacing": 10, "n": 101, "hours": [ … ] } | null   // ground grid, row-major from the south, hours of sun per node
}
```

- Azimuth is a compass bearing: 0 = north, clockwise. Altitude is degrees above the horizon. This is the convention the tower's `view.sun` already uses.
- The sun math lives in `src/shared/solar.js`, pure, with tests: `sunPosition(lat, lon, dateUTC) → { azimuth, altitude }` and `dayPath(lat, lon, localDate, tzOffset, stepMin) → [{ time, azimuth, altitude }]`. The tower sets `view.sun.azimuth` and `view.sun.altitude` from it. The Facade Studio and a later View Study reuse the module.

### 6.7 `grading.derived` (writer: Grading Sketch)

```jsonc
{
  "ffe": [ { "id": "massing-T1", "source": "massing" | "parking" | "<typed id>", "tier": 1,
             "outer": Ring,                          // the tier footprint, project frame
             "ffe": 1001.0, "padTop": 1000.0, "existingMin": 998.375, "existingMax": 1001.625 } ],
  "ground": { "spacing": 10.5, "n": 96, "points": [[x, y, z], …] },   // proposed grade, same nodes as site.derived.ground (or the typed-plane grid)
  "walls": [ { "id": "W1", "kind": "drawn" | "pad-step" | "auto", "line": [[x, y, z], …],   // the wall top
               "heightMax": 1.63, "heightAvg": 1.63, "length": 300, "auto": false, "accepted": true } ],
  "routes": [ { "id": "R1", "kind": "walk" | "ramp" | "fail", "line": [[x, y, z], …], "maxSlope": 0.045, "maxCross": 0.015 } ],
  "metrics": { "cutCy": 325.1, "fillCy": 348.2, "netCy": 23.1, "balance": 0.934, "bulkedNetCy": 23.1,
               "wallLength": 0, "wallHeightMax": 0, "wallHeightAvg": 0, "padArea": 19500, "disturbedArea": 0, "steepestRoute": 0 }
}
```

- The placement is the identity: everything is in the project frame.
- Elevations are NAVD88 feet with a site, local feet without one. Ground points round to 0.01 ft.
- Earthwork is a conceptual estimate (about ±5 to 10 percent). It is a sketch for early coordination with the civil engineer, never a grading plan.

### 6.8 `egress.derived`

Reserved. It is defined with the Egress Sketch, in its concept document, and added here as a new subsection. Until then a reader treats it as empty.

## 7. Size

localStorage, the browser's per-site store, holds about 5 MB per origin on Safari and iPad. The project list and every open project share it.

- A project file must stay under 4 MB. A tool refuses to save a larger one and says so.
- A tool warns once when the file passes 3 MB and names the largest section.
- `cmrlm.project.index` keeps `bytes` per project, so the Workspace can show sizes and the user can delete old projects.
- Keep `derived` small: one ring per plate, no triangle meshes, no per-point attributes. The site ground grid is the one large array (about 250 KB at 10,000 points).

## 8. Handoff between tools

All tools live on one origin (`https://<user>.github.io/design-tools/`), so they share one localStorage.

| Key | Content |
|---|---|
| `cmrlm.project.index` | `[{ id, name, updatedAt, bytes }]`, newest first |
| `cmrlm.project.<id>` | the project file, as JSON text |
| `cmrlm.project.last` | the id of the last opened project |

- **Send to `<tool>`**: the tool saves its section into the project, saves the project, then opens `../<tool>/?project=<id>` in the same tab. The log gets `{ action: "send", note: "<from> → <to>" }`.
- **Open with a project**: a tool that starts with `?project=<id>` loads that project, shows the project name in the top bar (next to the option name), and loads its own section's `state` as the working option when one exists. From then on it autosaves its section back into the project on every change, with the same 1 s debounce as storage.js, and writes the file on `visibilitychange` and `pagehide`.
- **Options stay as they are.** Saved options (storage.js) are the tool's own list, unchanged. A project points at the current working state of each tool, not at an option id. "Save option" and "Save to project" are separate acts; autosave covers the project.
- **No project**: a tool that starts without `?project=` behaves exactly as today. A "Project" menu in the top bar offers New project, Open project (list), and Import. New project with an open massing creates a `local` frame project and writes the section.
- **Export project**: download `<name>.cmrlm.json`. The name is slugged: lowercase, spaces to dashes. **Import**: file picker (the Files app on iPad), accept `.json`, validate, then save. A file whose `id` already exists in the list is imported as a copy with a new id and the name "Name (2)".
- **Conflicts**: two tabs can hold the same project. Before every save the tool reads `updatedAt` from storage. When storage is newer than what the tool loaded, the tool merges by taking its own section and the stored copy of every other section, then saves. It never overwrites another tool's newer section.

## 9. Workspace page

`index.html` becomes the Workspace. Same look as today: same tokens, same type, CMRLM mark.

- Top: project list (name, updated, size), New project, Import, Delete (with a confirm). Selecting a project makes it the open project (`cmrlm.project.last`).
- Below: one card per tool in pipeline order: Site Model, Massing (Tower Generator or Mid-Rise Generator, two buttons), Plate Planner, Parking Deck, Facade Studio, Sun Study, Grading Sketch, Egress Sketch. A planned tool shows "Planned" and no button.
- Each card shows the section status for the open project: "Empty", "Has data · <updatedAt>", or "Newer version" (schema newer than the tool on this page). The card opens the tool with `?project=<id>`.
- With no project open, the cards open the tools plain, as today.
- The page reads project.js directly as an ES module (it has no build step).

## 10. Module `src/shared/project.js`

Pure ES module. No DOM except the download and the file read, both guarded, as in storage.js. Every storage access is inside try/catch; on failure the data stays in memory and `onNotice` runs once.

```js
export const FORMAT = "cmrlm-design-tools/project";
export const VERSION = 1;
export const SECTIONS = ["site", "massing", "plates", "parking", "facade", "sun", "grading", "egress"];
export const SIZE_WARN = 3 * 1024 * 1024, SIZE_MAX = 4 * 1024 * 1024;

export function newProject({ name, frame })                  // → doc; frame { kind, lat, lon, size, zDatum } or omitted = local
export function validate(doc)                                 // → { ok, errors: [string] }; checks format, version, frame, every section's keys and placement
export function migrate(doc)                                  // → doc at VERSION (envelope only; section state is the tool's business)
export function getSection(doc, key)                          // → section or null; never throws
export function writeSection(doc, key, { tool, schema, placement, state, derived, note })
  // Returns a NEW document. The input document is unchanged; callers write `doc = writeSection(doc, …)`.
  // Replaces only the fields given. Keeps unknown keys of the section. Sets section.updatedAt and doc.updatedAt. Appends one log entry { action: "write" }.
  // Throws when key is not in SECTIONS, or when the stored schema is newer than `schema` (read-only).
export function toProject(section, [x, y, z])                 // → [xp, yp, zp] by section 4; z optional
export function toLocal(section, [xp, yp, zp])                // → [x, y, z], the inverse
export function transformRing(section, ring, dir)             // dir "toProject" | "toLocal"; MultiPoly through transformMultiPoly(section, mp, dir)
export function siteContextFor(doc, placement, radiusFt)
  // Site buildings near a massing, in that massing's LOCAL frame (placement = the massing placement).
  // → { blocks: [{ id, name, x, y, w, d, h, base }], polygons: [{ id, name, outer, holes, base, height }] }
  // Includes buildings whose plan bounding box touches the circle of radiusFt around the local origin.
  // blocks = axis-aligned bounding box of each transformed polygon (what the tower's context.blocks takes today); base is ft relative to placement.baseZ.
export function listProjects(storage)                         // → index entries, newest first
export function loadProject(storage, id)                      // → doc or null (validated, migrated)
export function saveProject(storage, doc)                     // → { ok, bytes, warning }; refuses above SIZE_MAX; updates the index
export function deleteProject(storage, id)
export function exportProject(doc)                            // → { filename, blob }
export async function importProject(file, storage)            // → { doc, renamed }; copies on id collision
export function projectIdFromUrl(location)                    // → id or null (`?project=`)
export function sendTo(storage, doc, toolId, fromToolId)      // saves a copy with a "send" log entry (the input is unchanged), returns the URL `../<toolId>/?project=<id>`
```

- `storage` is a Storage-like object (`getItem`, `setItem`, `removeItem`), default `window.localStorage`, injectable for tests, as in storage.js.
- Each browser tool inlines `project.js` through its build script, like the other shared modules. The Workspace imports it directly.

Tests, `test/project.test.mjs` (Node, no DOM, run by `npm test`):

1. Round trip: new project → write three sections → export → import → deep equal, new id.
2. Unknown keys inside a section and at the top level survive `writeSection` and `saveProject`.
3. A section with a newer schema makes `writeSection` throw; the doc is unchanged.
4. `toProject` and `toLocal` are inverses; rotation 90 maps local (0, 10) to project (−10, 0) plus the offset.
5. `siteContextFor` returns the right buildings, in the local frame, with the right block size.
6. `saveProject` warns above `SIZE_WARN` and refuses above `SIZE_MAX`.
7. `validate` rejects a bad format, a missing frame, and a placement with a non-number.

## 11. How a tool joins the suite

1. Read this document. Pick the section you own.
2. Define your `derived` shape in your concept document. Add it to section 6 here before you write code.
3. Inline `src/shared/project.js` in your build script.
4. On start, call `projectIdFromUrl`. With an id, `loadProject`, show the project name in the top bar, and load your section's `state` when it exists.
5. Read the sections you need through `getSection(doc, key).derived` and `toLocal`. Never read another section's `state`.
6. On every change, build your `derived`, then `writeSection` and `saveProject`, debounced 1 s. Also on `visibilitychange` and `pagehide`.
7. Add "Send to <next tool>" to the Export menu. It calls `sendTo`.
8. Add the Project menu (New, Open, Import, Export) to the top bar.
9. Add tests: your `derived` passes `validate`, every ring is clean, and a round trip through `project.js` keeps your section.
10. Add your card to the Workspace page.

## 12. Changes needed in the existing tools

Build order: the home session builds `src/shared/project.js`, its tests, and the Workspace page first, on its own branch (`project-file`), before the Mid-Rise Generator. The Site Model changes below ride on the same branch. The work session downloads `main` after that merge, then makes the Tower Generator changes below together with the Sun Study. Until then, the work session codes against the API in section 10.

Tower Generator (done October 22, 2026 by the home session; see `docs/tower-project-sun-plan.md`):

1. Add `src/tower/derived.js` with `towerDerived(state, built)` → `massing.derived` (section 6.2). Test it against the presets: GFA from `derived.levels` equals `computeMetrics(...).gfa` within 0.1 sf.
2. Accept `?project=`; autosave the `massing` section; Project menu in the top bar.
3. Export menu: "Send to Plate Planner", "Send to Facade Studio", and "Send to Grading Sketch" (`sendTo(storage, doc, "grading", "tower")`). "Send to Facade Studio" (`sendTo(storage, doc, "facade", "tower")`). The Facade Studio reads tower faces from `massing.derived.levels`; until item 1 exists it shows a note and uses its standalone massing.
4. Site context: when the project has a site, offer "Context from site" in the Site tab. It calls `siteContextFor(doc, placement, radius)` and replaces `state.context.blocks` with the returned `blocks`. Keep the manual blocks when the user says no.
5. Sun Study: build on `src/shared/solar.js` (section 6.6). Write the `sun` section with `tool: "tower"`. Set `view.sun` from the chosen date and time.
6. Placement: when the project has a site, show the placement (x, y, rotation, baseZ) in the Site tab, with a "Center on site" button that sets x and y to the site center and baseZ to the ground there.

Site Model (home session, on the `project-file` branch):

1. Write `site.derived` (section 6.1) and `site.state` after every successful run, when a project is open.
2. Buttons: "Send to Tower Generator" and "Send to Mid-Rise Generator". With no project open, the button first creates one named after the address.

Site layer (October 22, 2026): every tool draws `site.derived` (section 6.1) as the project site: ground, neighbor buildings, roads, walks, water, and trees. The Grading Sketch keeps its own ground. The context radius only limits which neighbor buildings become context blocks. The Tower Generator, the Mid-Rise Generator, and a standalone Parking Deck write `placement` (section 4) when the user drags the building. No section shape changes.

## 13. pyRevit bridge

A future pyRevit script reads `sections.*.derived` only, in the project frame, through `toProject`. So `derived` must always hold enough to rebuild the geometry in Revit: rings, heights, levels, and elevations, never only metrics. Nothing in this repository writes Revit directly yet. The script belongs to the work side, where the pyRevit MCP runs.

## 14. Worked example

A 1,000 ft Dunwoody site, a tower placed near the site center, and one planned plate level. Lists are cut short with "…".

```jsonc
{
  "format": "cmrlm-design-tools/project", "version": 1,
  "id": "6f1c2e0a-5c3d-4b8e-9a7f-1d2e3f4a5b6c", "name": "Ravinia test",
  "createdAt": "2026-10-21T20:00:00Z", "updatedAt": "2026-10-21T21:15:00Z", "units": "feet",
  "frame": { "kind": "site", "lat": 33.927, "lon": -84.339, "size": 1000, "zDatum": "NAVD88" },
  "sections": {
    "site": {
      "tool": "site", "schema": 1, "updatedAt": "2026-10-21T20:00:00Z",
      "placement": { "x": 0, "y": 0, "rotation": 0, "baseZ": 0 },
      "state": { "query": "Ravinia Dr, Dunwoody, GA", "lat": 33.927, "lon": -84.339, "size": 1000, "release": "2026-09-24.0", "walks": false },
      "derived": {
        "address": "Ravinia Dr, Dunwoody, GA", "lat": 33.927, "lon": -84.339, "size": 1000, "release": "2026-09-24.0",
        "boundary": [[0, 0], [1000, 0], [1000, 1000], [0, 1000]],
        "ground": { "spacing": 10, "n": 101, "points": [[0, 0, 1008.12], [10, 0, 1008.40], "…"] },
        "buildings": [ { "id": "b-0412", "outer": [[612.1, 530.4], [688.0, 530.4], [688.0, 601.2], [612.1, 601.2]], "holes": [], "base": 1011.8, "height": 186, "top": 1197.8, "floors": 16, "rule": "data", "name": "" }, "…" ],
        "roads": { "segments": [ { "id": "r-77", "cls": "secondary", "name": "Ravinia Dr", "width": 36, "line": [[0, 455.2, 1006.9], "…"] } ], "pavement": [ { "outer": ["…"], "holes": [] } ] },
        "walks": null, "trees": [ { "x": 120.5, "y": 310.0, "z": 1007.3, "canopy": 30, "height": 40 }, "…" ],
        "water": { "areas": [], "lines": [] }
      }
    },
    "massing": {
      "tool": "tower", "schema": 1, "updatedAt": "2026-10-21T20:40:00Z",
      "placement": { "x": 500, "y": 500, "rotation": 0, "baseZ": 1012.5 },
      "state": { "schema": 1, "name": "Option A — point tower", "site": { "shape": "rect", "width": 150, "depth": 150, "…": "…" }, "segments": ["…"], "…": "…" },
      "derived": {
        "footprint": [ { "outer": [[-50, -50], [50, -50], [50, 50], [-50, 50]], "holes": [] } ],
        "height": 503,
        "levels": [
          { "index": 1, "name": "Floor 1", "zone": "podium", "z": 0, "ftf": 18, "program": "retail",
            "plates": [ { "outer": [[-50, -50], [50, -50], [50, 50], [-50, 50]], "holes": [] } ], "core": null, "spines": [] },
          { "index": 3, "name": "Floor 3", "zone": "tower", "z": 33, "ftf": 10, "program": "residential",
            "plates": [ { "outer": [[-45, -45], [45, -45], [45, 45], [-45, 45]], "holes": [] } ],
            "core": [[-20, -15], [20, -15], [20, 15], [-20, 15]], "spines": [] },
          "…"
        ],
        "context": { "blocks": [ { "x": 150, "y": 70, "w": 76, "d": 71, "h": 186 }, "…" ] },
        "metrics": { "gfa": 384300, "far": 17.1, "siteCoverage": 0.44, "floors": 47, "height": 503, "units": 342 }
      }
    },
    "plates": {
      "tool": "plate", "schema": 1, "updatedAt": "2026-10-21T21:15:00Z",
      "placement": { "x": 500, "y": 500, "rotation": 0, "baseZ": 1012.5 },
      "state": { "…": "…" },
      "derived": {
        "mode": "multifamily",
        "levels": [
          { "index": 3,
            "plate": [ { "outer": [[-45, -45], [45, -45], [45, 45], [-45, 45]], "holes": [] } ],
            "corridor": [ { "outer": [[-45, -3], [45, -3], [45, 3], [-45, 3]], "holes": [] } ],
            "core": { "outer": [[-20, -15], [20, -15], [20, 15], [-20, 15]],
                      "stairs": [ { "id": "S1", "outer": [[-20, -15], [-9, -15], [-9, -3], [-20, -3]], "door": [-9, -9] } ],
                      "elevators": [ { "id": "E1", "outer": [[-5, -15], [5, -15], [5, -3], [-5, -3]] } ] },
            "units": [ { "id": "3-01", "type": "1BR", "outer": [[-45, 3], [-17, 3], [-17, 45], [-45, 45]], "area": 1176, "exposures": ["N", "W"], "corner": true, "bay": { "from": 0, "to": 28 } }, "…" ],
            "metrics": { "units": 8, "nrsf": 6420, "gsf": 8100, "efficiency": 0.793 } }
        ],
        "mix": [ { "type": "1BR", "count": 4, "share": 0.5, "avgArea": 760 }, { "type": "2BR", "count": 4, "share": 0.5, "avgArea": 1105 } ],
        "metrics": { "units": 8, "nrsf": 6420, "gsf": 8100, "efficiency": 0.793, "corridorFt": 90 }
      }
    }
  },
  "log": [
    { "at": "2026-10-21T20:00:00Z", "tool": "site",  "action": "write", "note": "Ravinia Dr, 1,000 ft" },
    { "at": "2026-10-21T20:01:00Z", "tool": "site",  "action": "send",  "note": "site → tower" },
    { "at": "2026-10-21T20:40:00Z", "tool": "tower", "action": "write", "note": "Option A — point tower" },
    { "at": "2026-10-21T20:41:00Z", "tool": "tower", "action": "send",  "note": "tower → plate" },
    { "at": "2026-10-21T21:15:00Z", "tool": "plate", "action": "write", "note": "Floor 3 test fit" }
  ]
}
```

## 15. Open points

1. The tower reads only rectangular context blocks today. `siteContextFor` gives polygons too. The tower may draw the polygons in a later version.
2. A project holds one massing option. Several options in one project (A, B, C) are a version 2 question. For now, duplicate the project.
3. The Workspace delete needs a confirm step on iPad. Decide the wording with the first build.
4. `grading` and `egress` shapes come with their tools.
