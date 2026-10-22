# Site Model: Remove Existing Buildings — Technical Plan

Version 1 · October 22, 2026 · Owner: Cade (CMRLM)

## 1. Why

A new tower often stands where an existing building stands today. The Site Model brings every building from the map, so the old building hides the new plate in the Plate Planner and casts a false shadow in the Sun Study. Cade's decisions: remove one building at a time by a click in the Site Model; a removed building casts no shadow anywhere; only the Site Model offers Remove. One tool owns the site.

## 2. Behavior

1. Click a building in the Site Model 3D view. A selection card opens: the name (or "Building"), height, floors, the height rule (data, floors, estimate), and the id. The card has one button: **Remove**, or **Restore** when the building is already removed.
2. Select **Remove**. The solid building leaves the scene. A dashed outline draws in its place, flat on the ground. The card button reads **Restore**.
3. Click empty ground, or press Escape, to close the card.
4. The side panel shows one line under the metrics: "Removed buildings: n · Restore all". **Restore all** clears the list. The line is hidden when n is 0.
5. Every export (Revit CSV notes, DXF, SketchUp) leaves removed buildings out of the solid building layers. The DXF draws their ground outlines on layer `BLDG-REMOVED` (civil drawings show demolition). The SketchUp file has no removed buildings.
6. The project file keeps every building. Removed ones carry `removed: true`. Every other tool skips them: no context block, no site-layer solid, no shadow, no sun-hours blocker.
7. The removal survives a refetch of the same address: Overture ids are stable. An id that no longer exists is dropped without a message.
8. A drag that orbits does not select. The click must travel under 6 px.
9. The Site Model has no undo stack (`build/site/04_ui.js` holds plain state). Restore and Restore all are the undo.

## 3. Data

### 3.1 `site.state.removed`

`removed: string[]` joins `siteState()` in `src/site/derived.js`: the ids of the removed buildings, sorted, unique, strings. `siteState(meta)` takes `meta.removed` (an array or a Set) and writes `removed: []` when there is none. `siteRequest(doc)` in `04_ui.js` reads `st.removed` into `state.removed` before the run, so the ids apply when the model lands.

### 3.2 `site.derived.buildings[].removed`

`siteDerived(model, meta)` keeps every building and adds `removed: true` to a building whose id is in `meta.removed`. Ids with the piece suffix (`~2`, `~3`) match on the id before the suffix too: one Overture feature with several pieces is removed as one building. A building that is not removed has no `removed` key (not `false`), so old readers see no change.

Spec 6.1 gets one line: `"removed": true // optional; the user removed this building in the Site Model. Readers skip it unless they draw demolition.`

### 3.3 Readers

| Reader | Rule |
|---|---|
| `siteContextFor(doc, placement, radius, opts)` in `src/shared/project.js` | Skips `removed` buildings. `opts.includeRemoved` keeps them. Both `blocks` and `polygons` follow the same rule. The Tower and Mid-Rise context blocks, the sun hours, and the Sun Study shadows therefore skip them with no change in those tools. |
| `buildSiteLayerData(siteDerived, placement, opts)` in `src/shared/sitelayer.js` | Skips `removed` buildings by default. `opts.includeRemoved: true` returns them with `removed: true` on each record, so the Site Model can draw dashed outlines from the same data. `counts.buildings` counts drawn buildings; `counts.removed` counts the skipped ones. |
| `siteDxf(model, opts)` in `src/site/exports.js` | Takes `opts.removed` (a Set of ids). Removed buildings go to `BLDG-REMOVED` as the ground outline (`closed2d` at `b.base`), not to the polyface layers. |
| `notesMarkdown(model, meta)` | Adds "- Removed buildings: n (on layer BLDG-REMOVED in the DXF; not in the SketchUp file)" when n is above 0. |
| `siteToSketchup(model, meta)` in `src/site/sketchup.js` | Skips buildings whose id is in `meta.removed`. No hidden group: keep the file simple. |
| `revitCsv(ground)` | No change (ground only). |

The model bundle is not changed. The removed list lives in `state` and `meta`, and every writer takes it from `meta.removed`. `metaOf()` and `projectMeta()` in `04_ui.js` add `removed: [...state.removed]`.

## 4. Scene: picking, outlines, selection

### 4.1 Picking

The Site Model merges every building of one height rule into one `BufferGeometry` (`buildBuildings` in `03_scene.js`): two meshes for 500+ buildings. Keep the merge. Add identity per face:

- While merging, record `ranges: [{ id, start, count }]` per mesh: the index range (or vertex range for non-indexed geometry) of each building. `ExtrudeGeometry` is non-indexed, and `mergeGeometries(list, false)` keeps it so: `start` is the first vertex, `count` the vertex count; a face `f` (from `intersection.faceIndex`) sits at vertex `3 f`.
- `pick(clientX, clientY)`: one `Raycaster` over the two building meshes (`G.buildings` meshes only, `recursive: false`). Take the nearest hit, map `faceIndex * 3` to its range by binary search, return `{ id, building }`. Return null with no hit.
- `Scene.pick(x, y)` is exported for the tests. The raycast works in the scaled root (vertical exaggeration): `Raycaster` handles the root matrix.

### 4.2 Removed outlines

`buildBuildings(buildings, removed)` skips removed ids from the solids and builds one `LineSegments` of their outer rings (and holes) at `b.base + 0.4`, draped by `site.meshAt` every 10 ft, with `LineDashedMaterial` (color `--scene-edge`, dash 8, gap 5, `computeLineDistances`). The object has `userData.kind = 'removed'`. `info.removed = n`. The outline follows the `buildings` layer toggle.

`Scene.setRemoved(ids)`: rebuilds only `G.buildings` from `site.model.buildings` with the new set and keeps the camera. Under 50 ms for 500 buildings (one merge).

### 4.3 Selection

`Scene.select(id | null)`: a highlight on the picked building. Draw it as its own small mesh (the picked building's geometry alone, `--accent` at 0.35 opacity, `depthWrite false`, `renderOrder 3`) in `G.site`, or an edge ring when the building is removed. `Scene.selection()` returns the id. Escape and a click on empty ground clear it.

Pointer rule: `pointerdown` stores `{ x, y, id }`; `pointerup` within 6 px and under 500 ms calls `pick`. Touch: the same with pointer events. `OrbitControls` keeps every drag.

## 5. UI (`build/site/04_ui.js`, `body.html`, `css_add.css`)

- `state.removed: Set<string>`. `setRemoved(ids)` writes the set, calls `Scene.setRemoved`, re-renders the panel line and the card, writes the project (`projectWrite` → `scheduleProjectSave`), and refreshes the download files (the `fileFor` cache, if any, is cleared).
- The selection card: a small floating card in the viewport (top left under the top bar, like the Tower's `.sel-card`), built with `h()`. Fields: title (name or "Building"), "Height 48'-0" · 4 floors · height from the data", the id in small type, one button. `aria-live="polite"`.
- Panel line: in the metrics box, after the last metric: `Removed buildings: 3` and a `Restore all` link button. Hidden at 0.
- `siteRequest(doc)` loads `st.removed` into `state.removed` before `go()`. The run end (`finish`, line ~150) calls `Scene.setModel(r.model)` then `Scene.setRemoved(state.removed)` and prunes ids that are not in `r.model.buildings` (pruned silently; the pruned set is what the project gets).
- A new address clears `state.removed` (another site, other ids) unless the project's saved query is the same.
- Send to Tower / Mid-Rise / Grading: `projectWrite` already runs `siteState(meta)` and `siteDerived(model, meta)`; with `meta.removed` set, both carry the removal. No change to the Send code.
- Help text (`04_ui.js` has the help block, or `body.html`): one paragraph, phase C.

## 6. Other tools

No code change in the Tower, Mid-Rise, Plate Planner, Parking Deck, Facade Studio, or Grading Sketch. Their readers (`siteContextFor`, `buildSiteLayerData`) skip removed buildings. The Grading Sketch reads neighbors through `siteContextFor` as well (check `build/grading/09b_project.js`; if it reads `site.derived.buildings` directly, the integrator adds the same skip there).

Cade's screenshot problem (the plate hidden by the old building) is then: remove the old building in the Site Model, Send to Tower Generator again (or Save), and reopen the Plate Planner.

## 7. Tests

### 7.1 Node

| File | Checks |
|---|---|
| `test/site.derived.test.mjs` | `siteState({ removed: ["b-court", "x"] }).removed` is `["b-court", "x"]`; no meta gives `[]`. `siteDerived(model, { removed: ["b-court"] })`: the court building has `removed: true`, the others have no key; piece ids `b~2` of a removed `b` are flagged too; `uniqueIds` keeps the flag. |
| `test/site.exports.test.mjs` (new or in `site.model.test.mjs`) | `siteDxf(model, { removed })`: no `BLDG-DATA` polyface for the removed id, one `BLDG-REMOVED` closed polyline; `notesMarkdown` lists the count; `siteToSketchup(model, { removed })` has one building fewer and still validates. |
| `test/project.test.mjs` | `siteContextFor` on a doc with one `removed` building: skipped from `blocks` and `polygons`; `includeRemoved: true` returns it. |
| `test/sitelayer.test.mjs` | `buildSiteLayerData` skips a removed building (`counts.buildings` down by 1, `counts.removed` 1); `includeRemoved` returns it with `removed: true`. |

### 7.2 In-page, Site Model (`build/site/05_tests.js`, in the `SiteTests.run()` list)

1. `Scene.pick` at the projected center of `b-data` returns `b-data`; at an empty ground point returns null.
2. A synthetic pointerdown and pointerup on the canvas at that point open the card with "Building" and 98.4 ft; a 20 px drag does not.
3. **Remove** flags `b-data`: `Scene.info().buildings` drops to 3, `info.removed` is 1, one `removed` line object exists, the panel line reads "Removed buildings: 1".
4. The card button now reads **Restore**; Restore brings the solid back and hides the panel line.
5. Remove two, **Restore all** clears both.
6. With a project open (the in-memory storage of the existing project tests), Remove writes `site.state.removed` and `derived.buildings[].removed` after the save delay; the other buildings have no `removed` key.
7. Reopening the project (`startProject` with the test fetch) restores `state.removed` and the outlines.
8. The DXF text for the current result has `BLDG-REMOVED` and no polyface for the removed id.
9. A new address clears the removed set.

### 7.3 In-page, readers (integrator)

- Tower `12f_tests_project.js`: the site fixture gets a second building with `removed: true`; Context from site makes blocks for the others only, and the site layer draws the others only.
- Plate `12e_tests_site.js`: the fixture gets one `removed: true` building; `SiteLayer.info().buildings` leaves it out.

## 8. Docs

- `docs/project-file-spec.md` 6.1: the `removed` key, the `site.state.removed` list, and the reader rule (one sentence each).
- `README.md` Site Model row: "remove existing buildings".
- `docs/suite-roadmap.md`: a line in section 2's Site Model row or a note under the shared parts.
- Workspace `index.html`, "What each tool reads and writes", Site Model row: "Writes … neighbor buildings (removed ones flagged)". One sentence in section 3: "To take out a building that the project demolishes, click it in the Site Model and select Remove."
- Help text in the Site Model and one line in the Tower, Mid-Rise, and Plate help where neighbors are mentioned: "Buildings removed in the Site Model do not show here."

## 9. Risks

| Risk | Response |
|---|---|
| A click after a short orbit drag selects by mistake | The 6 px and 500 ms rule; the test for a 20 px drag |
| Overture id changes between releases | The id is dropped silently; the user removes again; the notes say which release the file used |
| A merged piece id (`~2`) is removed alone | Prefix match removes every piece of one feature |
| The removed outline hides under the ground mesh on a slope | Draped every 10 ft at +0.4 ft, like the site boundary |
| Readers in other tools draw a removed building from an old project file | Old files have no `removed` keys, so nothing changes until the user removes something |

## 10. Phases and file ownership

Phases A, B, and C run in parallel. B codes against section 3 and section 4 names. No agent commits; the integrator commits each phase when its tests pass.

| Phase | Model | Agent | Owns | Done when |
|---|---|---|---|---|
| A | Opus | Data and readers | `src/site/derived.js`, `src/site/exports.js`, `src/site/sketchup.js` (the `meta.removed` skip), `src/shared/project.js`, `src/shared/sitelayer.js`; `test/site.derived.test.mjs`, `test/project.test.mjs`, `test/sitelayer.test.mjs`, a new `test/site.exports.test.mjs`; `docs/project-file-spec.md` 6.1 | `npm test` green with the section 7.1 checks |
| B | Sonnet | Site Model page | `build/site/03_scene.js` (pick, setRemoved, select, outlines), `04_ui.js` (state, card, panel line, project state, meta), `body.html`, `css_add.css`, `05_tests.js` (section 7.2), `06_start.js` (test hooks), the rebuilt `site/index.html` | `site/?test` green; a screenshot with one removed building (dashed outline) and the card open |
| C | Haiku | Words | Help text in `build/site/` (the help block; B owns `04_ui.js`, so C writes the paragraph in `docs/site-remove-copy.md` and B pastes it), `build/tower/`, `build/midrise/`, `build/plate/` help lines about neighbors (`08e_help.js`; the Tower has no help panel — skip it), `README.md`, `docs/suite-roadmap.md`, `index.html` (the table row and the one sentence) | Text reviewed by the integrator |
| D | Opus | Integrator (this session) | Section 7.3 tests in `build/tower/12f_tests_project.js` and `build/plate/12e_tests_site.js`; the Grading check in section 6; rebuilds; `npm test`; every `?test`; a real handoff (remove a building in the Site Model fixture, send to the Tower, open the Plate Planner); PR | Cade merges |

Rules: nobody edits a file another phase owns; a needed line goes through the integrator; B uses `meta.removed` and `siteState(meta).removed` exactly as section 3 names them.
