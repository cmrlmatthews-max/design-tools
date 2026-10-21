# SketchUp Export — Spec

Author: Opus (orchestrator). Approved by Cade on October 21, 2026.
Target: SketchUp Pro 2021 or later, desktop (Mac). Not SketchUp for Web.
Canonical folder: `/home/claude/repo-design-tools`. Do not commit or push; the reviewer does that.

## 1. How it works

1. The Tower Generator and the Site Model each export one file, `<name>.sketchup.json`.
2. A SketchUp extension, `cmrlm-design-tools.rbz`, adds **Extensions > CMRLM > Import Design Tools file…**.
3. The extension reads the file and builds native, fully editable SketchUp geometry: closed solid groups, Sandbox-style terrain, tags, and materials. The whole import is one undo step.

## 2. File format (version 1)

All lengths are **feet**. Plan `(x, y)`: x = east, y = north. `z` is up.

```jsonc
{
  "format": "cmrlm-design-tools/sketchup",
  "version": 1,
  "source": "tower" | "site" | "midrise",
  "name": "Option A",                       // root group name
  "createdAt": "2026-10-21T16:05:00Z",
  "units": "feet",
  "location": { "lat": 33.92, "lon": -84.34 } | null,   // sets SketchUp shadow location; null for the tower
  "zShift": -1012.4,                        // ft added to every TRUE elevation (site). 0 for the tower.
  "notes": ["Plan origin = SW corner of the site.", "..."],
  "tags": [ { "name": "Buildings", "color": "#9aa3ad", "visible": true } ],
  "materials": [ { "name": "Residential", "color": "#4f7fd1", "alpha": 1 } ],
  "root": Node                              // type "group"
}
```

`Node` is one of:

| type | fields | SketchUp result |
|---|---|---|
| `group` | `name`, `tag?`, `material?`, `children: Node[]` | A group that contains its children. |
| `solid` | `name`, `tag?`, `material?`, `outer: [[x,y],…]`, `holes: [[[x,y],…]]`, `z0`, `z1` | A closed solid group: bottom face at `z0`, extruded to `z1`. |
| `mesh` | `name`, `tag?`, `material?`, `vertices: [[x,y,z],…]`, `triangles: [[i,j,k],…]`, `soft: bool`, `closed: bool` | A group of triangle faces. `soft: true` = soft and smooth edges (terrain; Sandbox tools work on it). |
| `faces` | `name`, `tag?`, `material?`, `polygons: [{ outer: [[x,y,z],…], holes: [[[x,y,z],…]] }]` | A group of flat faces. Every polygon must be planar. |
| `lines` | `name`, `tag?`, `lines: [[[x,y,z],…],…]` | A group of edges (polylines). |

Every node may also carry `attributes: { key: string|number|boolean }` → saved as attribute dictionary `"cmrlm"` on that group.

### Ring rules (exporters MUST apply them; `src/shared/sketchup-format.js` does it)

- No repeated last point. Remove points closer than 0.01 ft to the previous point. Remove collinear points (cross product < 1e-9 relative).
- Outer rings counter-clockwise, holes clockwise (seen from above).
- Drop rings with fewer than 3 points or area < 0.25 sf.
- Round coordinates to 0.001 ft.

### Validation

`validateDoc(doc)` (in the shared module) returns `{ ok, errors[] }`. Both exporters must pass it in their tests.

## 3. Extension rules (Ruby, SketchUp API)

- Files: `sketchup/cmrlm_design_tools.rb` (loader, registers a `SketchupExtension`), `sketchup/cmrlm_design_tools/main.rb` (menu + import), `sketchup/cmrlm_design_tools/importer.rb` (pure geometry logic that takes the model as an argument, so it can be tested with a mock API). Package: `sketchup/build_rbz.py` → `dist/cmrlm-design-tools.rbz` (a zip of the loader file and the folder).
- Menu: `UI.menu("Extensions").add_submenu("CMRLM").add_item("Import Design Tools file…")`. File dialog: `UI.openpanel("Import Design Tools file", "", "Design Tools|*.sketchup.json;*.json||")`.
- Read with `JSON.parse(File.read(path))`. Check `format` and `version`. On a problem: `UI.messagebox` with a plain sentence; change nothing.
- `model.start_operation("Import #{name}", true)` … `model.commit_operation`; on any error `model.abort_operation` and show the message.
- Units: SketchUp works in inches internally. Multiply every length by 12 (or use `.feet`).
- Tags: `model.layers.add(name)`; set `color` (Sketchup::Color) and `visible`. **Put tags on groups only. Raw geometry stays Untagged** (SketchUp best practice).
- Materials: `model.materials.add(name)` (reuse when the name exists); `color`, `alpha`. Apply the material to the group (geometry inherits it), not to each face.
- `solid`: inside a new group, add the bottom face from `outer` at `z0`; for each hole add the hole face and erase it (leaves the opening). If `face.normal.z > 0` then `face.reverse!`. Then `face.pushpull(-(z1 - z0) * 12)` so it rises. The result must be `group.manifold?` = true; if it is not, keep the group and add attribute `"manifold" => false`.
- `mesh`: `Geom::PolygonMesh`, then `group.entities.fill_from_mesh(mesh, true, flags)`. Terrain (`soft: true`): flags = soften + smooth for every edge between triangles (`Geom::PolygonMesh::SOFTEN | Geom::PolygonMesh::SMOOTH`, or set `edge.soft = edge.smooth = true` after). Keep the outer boundary edges hard.
- `faces`: one `entities.add_face` per polygon (holes erased as above). Orient faces up (`normal.z >= 0`) for horizontal and draped faces.
- `lines`: `entities.add_curve` (or `add_edges`) per polyline.
- Location: if `location` is present, set `model.shadow_info["Latitude"]`, `["Longitude"]` (wrap in rescue; skip if the API refuses).
- Model attributes: `model.set_attribute("cmrlm", "zShift", zShift)`, also `source`, `name`, `createdAt`; the same on the root group.
- Place the root group at the model origin. After import: `model.active_view.zoom(root)`.
- Speed: build inside one operation with `disable_ui = true`. A 3,000 ft site (about 10,000 ground triangles and 1,000 buildings) must import in under about 30 s.

## 4. Tower export (Export menu > SketchUp)

```
<option name>                    group
 ├─ Podium                       group, tag = (none) — floors carry the program tags
 │   ├─ Floor 1                  solid (or group of solids if the plate has several pieces)  tag = program, material = program
 │   └─ …
 ├─ Segment 1 · Residential      group
 │   ├─ Floor 3 … Floor 32       solids, tag/material = program (mechanical floors: "Mechanical")
 ├─ Crown                        group: prisms → solid; spire / sloped → mesh (closed, not soft)   tag "Crown"
 └─ Context                      group of solids (blocks)   tag "Context", material "Context"
```
- Floor solid: `z0 = plate.z`, `z1 = plate.z + plate.ftf` (full height, no floor-line gap). Void floors are skipped.
- Holes in plates (center carves) → `holes`. Several pieces → one solid per piece inside a "Floor n" group.
- Tags: one per program used, plus "Crown" and "Context". Tag color = program color.
- `location: null`, `zShift: 0`. Plan coordinates as in the tool.
- Attributes on each floor: `floor`, `program`, `area_sf`.

## 5. Site export (new "SketchUp" button next to Revit CSV and DXF)

```
Site at <address>                group
 ├─ Ground                       mesh, soft: true       tag "Ground"      material "Ground"
 ├─ Buildings                    group                  tag "Buildings"   material "Building"
 │   └─ Building 0001 (estimated)  solid  (attributes: height_ft, height_source, overture_id)
 ├─ Roads                        group                  tag "Roads"       material "Pavement"
 │   └─ <road name or class> …   faces, draped on the ground + 0.1 ft
 ├─ Road centerlines             lines, draped + 0.15 ft  tag "Road centerlines" (visible: false)
 ├─ Water                        group                  tag "Water"       material "Water" (alpha 0.85)
 │   ├─ ponds / lakes            faces at the water level
 │   └─ streams                  lines, draped + 0.1 ft
 └─ Site boundary                lines at ground + 0.2 ft  tag "Site boundary"
```
- **No trees.**
- `zShift = −ground.min`, rounded to 0.01 ft. Every z = true elevation + zShift, so the lowest ground point is 0 ft. Write the shift in the notes Markdown too ("SketchUp: add N ft to return to NAVD88").
- Plan origin stays the SW corner of the site (same as the Revit CSV and DXF).
- Ground mesh: every grid node as a vertex, two triangles per cell, in the same diagonal direction as the DXF topo mesh.
- Buildings: `z0` = building base + zShift, `z1` = z0 + height.
- **Draping:** a road (or stream) piece is clipped against every ground triangle it touches (Clipper intersection in plan), then each piece is lifted onto that triangle's plane + offset. Each resulting polygon is planar by construction. Merge nothing.
- Water areas: flat faces at the water level the site model already gives (+ zShift).
- `location`: the site center lat/lon.

## 6. Tests

- Node (each exporter): `validateDoc` passes; node counts match the model; every solid has `z1 > z0`; tower GFA equals the sum of solid plan areas × 1 per floor; site: min ground z = 0 after the shift; every draped polygon is planar (max distance to its best-fit plane < 0.001 ft); draped road area in plan equals the road area inside the site within 0.5%.
- Ruby: `ruby -c` on every file; a mock `Sketchup` API (test/sketchup/mock_sketchup.rb) that records calls, and tests that the importer creates the right groups, tags, materials, push-pull distances (×12), and one operation; bad files show a message and change nothing.
- SketchUp itself: Cade, on the Mac.

## 7. Shared helper module

`src/shared/sketchup-format.js` (written by the orchestrator, tested): `FORMAT`, `VERSION`, `cleanRing2(ring, {hole})`, `cleanRing3(ring, {hole})`, `ringArea2(ring)`, `makeDoc({ source, name, location, zShift, notes, tags, materials, root })`, `validateDoc(doc)`, `sketchupFilename(name, date)`, `docToBlob(doc)`.

## 8. File ownership for the parallel build (do not edit files you do not own)

| Agent | Owns |
|---|---|
| Tower exporter (Sonnet) | `src/tower/sketchup.js`, `test/tower.sketchup.test.mjs`, tower build parts it needs (`build/tower/*`; add a new part `08c_sketchup.js` and register it in `build/tower/build.py`) |
| Site exporter (Sonnet) | `src/site/sketchup.js`, `test/site.sketchup.test.mjs`, site build parts (`build/site/*`), and the one line in `src/site/exports.js` `notesMarkdown` for the SketchUp shift note |
| Extension (Sonnet) | `sketchup/**`, `test/sketchup/**`, `docs/sketchup-install.md` |
| Orchestrator | `src/shared/sketchup-format.js`, `test/sketchup-format.test.mjs`, `package.json`, this spec |

Run your own tests directly (`node test/<file>`, `ruby test/sketchup/importer_test.rb`). `npm run test:sketchup` runs all of them once every agent is done.
Both browser tools load `src/shared/sketchup-format.js` through their build script (inline it like the other shared modules).
