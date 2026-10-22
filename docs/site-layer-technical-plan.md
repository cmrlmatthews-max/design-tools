# Shared Site Layer and Drag Placement — Technical Plan

Version 1 · October 22, 2026 · Branch `site-layer` · Owner: Cade (CMRLM)

## 1. Goal

When a project has a site from the Site Model, every tool shows that site the way the Site Model shows it: the real ground, the boundary, roads, water, trees, and the neighbor buildings as solid grey blocks with dark edges. The user drags the building on the ground to place it, turns it with a handle, and the base elevation follows the ground.

Cade's decisions (October 22, 2026):

1. Neighbor buildings are solid grey with dark edges, like the Site Model.
2. The whole site square is drawn. The context radius only limits which neighbors become context blocks (shadows, metrics).
3. Drag placement: move by drag, rotate with a handle, base elevation snaps to the ground.
4. All six tools now: Tower, Mid-Rise, Plate Planner, Parking Deck, Facade Studio, Grading Sketch.
5. The real sloped ground shows under the building. The building cuts into a slope until the Grading Sketch sets pads.

## 2. What the user sees

| Item | Today (Tower) | After |
|---|---|---|
| Ground | A flat grey slab at the base elevation | The site ground mesh with elevation shading (light to lighter grey, Site Model colors), a skirt, and a dark site outline |
| Boundary | Dashed orange loop | Same dashed loop, on the ground surface; the north arrow stays |
| Neighbors | Grey boxes at 60% opacity, within 600 ft | Real footprints with holes, solid, `--scene-model` white-grey with dark edges, the whole site |
| Roads, walks | Not drawn | Flat pavement draped on the ground (`--scene-road`, `--scene-walk`) |
| Water | Not drawn | Flat areas at their level (`--scene-water`), lines on the ground |
| Trees | Not drawn | Low-poly canopy and trunk (`--scene-tree`, `--scene-trunk`) |
| Placement | Typed X, Y, rotation, base; Center on site | Drag the building; a rotation ring; typed fields stay |
| View toggle | "Show context blocks" (Tower) | "Site" toggle in the View tab, plus "Context blocks" |

Rules:

- The tool's flat ground slab and the shadow plane stay where there is no site. With a site shown, the slab drops to 4 ft under the lowest ground node, the grid stays at the base elevation but fades to 40%, and shadows fall on the site ground mesh (`receiveShadow`). The 8,000 ft shadow plane hides.
- The building sits at `placement.baseZ`. The ground mesh is drawn in the local frame, so its z is `ground − baseZ`. A building on a slope cuts into the ground. That is correct until the Grading Sketch sets pads.
- The context blocks (state.context.blocks) stay for metrics, snapping, and the Sun Study shadows. The site layer does not draw them when they came from the site (`block.site === true`), so no double building appears.
- Every object of the layer is one merged BufferGeometry per kind: ground, skirt, buildings, building edges, roads, walks, water, water lines, trees (instanced).
- The layer is rebuilt only when its key changes: `siteUpdatedAt | placement | show flags | theme epoch`.

## 3. Module `src/shared/sitelayer.js` (data only, no Three.js)

Reads `site.derived` (spec section 6.1) and returns plain arrays in the tool's local frame. Every input point is in the project frame; every output point is local: `[x, y]` through `ProjectMod.transformRing(placement, ring, "toLocal")`, z through `z − placement.baseZ`.

Caution: the Site Model ground grid is row-major from the south, `n × n` nodes, `spacing` ft, first node at `points[0]`. The grid stays axis-aligned in the project frame. The layer rotates the whole mesh as a solid, so a rotated placement gives a rotated ground mesh. Nothing is resampled.

### 3.1 Inputs

```js
siteDerived   // site.derived of the project (object) or null
placement     // { x, y, rotation, baseZ } of the tool (ProjectUI.placement())
opts          // { contextIds: Set of building ids already drawn as context blocks (skipped), maxBuildings: 2000 }
```

### 3.2 Output of `buildSiteLayerData(siteDerived, placement, opts)`

```js
{
  ok: true,                       // false with { ok: false, reason } when there is no ground and no boundary
  bounds: { minX, maxX, minY, maxY, zMin, zMax },      // local frame; zMin/zMax are ground, relative to baseZ
  ground: {                       // null when site.derived.ground is missing or malformed
    n, spacing,
    positions: Float32Array(n*n*3),  // local x, y, z per node, row-major from the south (z relative to baseZ)
    shade: Float32Array(n*n),        // 0 at zMin, 1 at zMax (elevation shading)
    indices: Uint32Array((n-1)*(n-1)*6),
    skirt: { positions: Float32Array, indices: Uint32Array, bottomZ }  // four sides, bottom 4 ft under zMin
  },
  boundary: [[x, y, z], …] | null,  // the boundary ring draped on the ground, lifted 0.6 ft
  buildings: [ { id, name, outer: [[x,y],…], holes: [[[x,y],…]], base, height, rule } ],   // base relative to baseZ
  roads: [ { outer, holes } ],      // MultiPoly in the local frame (draped at draw time)
  walks: [ { outer, holes } ],
  water: { areas: [ { outer, holes, level } ], lines: [ [[x,y,z],…] ] },   // level relative to baseZ
  trees: [ { x, y, z, canopy, height } ],
  counts: { buildings, roads, walks, waterAreas, trees, groundNodes }
}
```

### 3.3 Ground lookup

`groundZAt(siteDerived, xp, yp)` → the ground elevation (absolute, NAVD88 ft) at a project-frame point by bilinear interpolation on the grid, clamped to the grid edge. Returns `null` without a grid. This replaces `groundAt` in `build/tower/09b_project.js` and the copy in `build/midrise/09b_project.js`. Both tools keep a one-line wrapper.

`groundZLocal(siteDerived, placement, x, y)` → the same at a local-frame point, relative to `baseZ`.

### 3.4 Drape helper

`drapeRing(siteDerived, placement, ring, step, lift)` → `[[x, y, z], …]` with points every `step` ft along the ring, z from `groundZLocal` plus `lift`. The THREE part uses it for the boundary and the water lines. Roads and walks are triangulated by the THREE part with `THREE.ShapeUtils`, then draped per vertex through `groundZLocal`.

### 3.5 Rules

- A building whose id is in `opts.contextIds` is skipped. A building with fewer than 3 points is skipped. More than `maxBuildings` keeps the nearest to the origin.
- `rule === "estimate"` buildings keep that flag; the THREE part colors them `--scene-est`.
- Output rings have no repeated closing point.
- No NaN anywhere. A malformed grid (`points.length !== n*n`) gives `ground: null` and a `reason`.

## 4. Signatures (the contracts every agent codes against)

```js
// src/shared/sitelayer.js  (ES module, imports { transformRing, toLocal } from "./project.js")
export function buildSiteLayerData(siteDerived, placement, opts = {})   // section 3.2
export function groundZAt(siteDerived, xp, yp)                           // absolute ft or null
export function groundZLocal(siteDerived, placement, x, y)               // relative to baseZ, or null
export function drapeRing(siteDerived, placement, ring, step = 10, lift = 0.6)
export function siteBounds(siteDerived)                                  // { size, boundary, center: [x, y] } project frame, or null
export const SITE_LAYER_VERSION = 1;

// build/shared/06x_sitelayer.js  (page part; globals THREE, BufferGeometryUtils, planToWorld, planMatrix, worldVec, ProjectMod, SiteLayerMod)
const SiteLayer3D = (() => {
  /** THREE objects for a data result. opts: { parts: ['ground','boundary','buildings','roads','walks','water','trees'] (default all),
   *  zOf: (localZ) => worldY (default identity; the Grading Sketch passes its exaggeration mapper), css: (name, fallback) => THREE.Color,
   *  edges: true, shadows: true }.  Returns { objects: [THREE.Object3D], info: { ground: bool, buildings, roads, walks, waterAreas, trees, triangles } } */
  function objects(data, opts = {})
  /** Disposes the geometries and own materials of objects made by objects(). */
  function dispose(objs)
  /** The cache key for a tool's syncLayer: `${siteUpdatedAt}|${x},${y},${rot},${baseZ}|${showFlags}|${themeEpoch}` */
  function keyFor(doc, placement, show, themeEpoch)
  return { objects, dispose, keyFor };
})();

// Each tool's 06c_site.js (Tower: rewritten; others: new) — one small adapter, same shape in every tool
const SiteLayer = (() => {
  /** Called from Render.syncMain every frame. layer = { group, key }; kit = { syncLayer, clearGroup }. Returns true when the scene changed. */
  function update(layer, state, d, kit)
  /** { shown, ground, buildings, roads, walks, waterAreas, trees, key } for tests. */
  function info()
  /** The site ground mesh now on screen (for shadows and the drag hit test), or null. */
  function groundMesh()
  return { update, info, groundMesh };
})();

// build/shared/06y_placement.js  (page part; globals THREE, Store, Render, ProjectUI, SiteLayerMod, SiteLayer, h, $)
const PlacementGizmo = (() => {
  /** Wires the pointer handlers once. opts: { enabled: () => bool, bounds: () => { minX, maxX, minY, maxY } (local frame building box),
   *  path: 'placement' (the Store path of { x, y, rotation, baseZ }), onCommit: () => void (the tool re-runs Context from site) } */
  function init(opts)
  /** Called from Render after each frame: moves the DOM handles. */
  function sync()
  /** For tests: { active, dragging: 'move' | 'rotate' | null, handles: n } */
  function info()
  /** For tests: synthetic drags. begin(kind, cx, cy) → move(cx, cy) → end(). kind: 'move' | 'rotate'. */
  function begin(kind, cx, cy); function move(cx, cy); function end(ok = true)
  return { init, sync, info, begin, move, end };
})();
```

The page parts use the globals listed in their header. Every tool has them (checked: `THREE`, `BufferGeometryUtils`, `planToWorld`, `planMatrix`, `worldVec`, `Store.set(path, v, { live | merge })`, `Store.commit()`, `Render.canvas()`, `Render.camera()`, `Render.setOrbitEnabled()`, `Render.requestRender()`, `ProjectUI.has()`, `ProjectUI.doc()`, `ProjectUI.placement()`, `h`, `$`).

## 5. Page part `build/shared/06x_sitelayer.js`

- Ground: one `BufferGeometry` from `data.ground.positions` mapped through `planToWorld` (plan `[x, y, z]` → world `[x, z, −y]`), vertex colors from `shade` between `--scene-terrain-lo` and `--scene-terrain-hi`, `MeshStandardMaterial({ vertexColors, roughness: 1, polygonOffset 2/2 })`, `receiveShadow = true`, `userData.kind = 'site-ground'`.
- Skirt: `--scene-skirt`, no shadows.
- Boundary: `LineDashedMaterial` orange `#c0701a` (the Tower's today), `computeLineDistances()`. The north arrow code moves here from `build/tower/06c_site.js` unchanged.
- Buildings: `ExtrudeGeometry` per building (depth `height + 1`, lifted `base − 1`), merged with `BufferGeometryUtils.mergeGeometries`, `--scene-model` (`--scene-est` for estimates), `castShadow` and `receiveShadow` true, plus `EdgesGeometry(merged, 30)` in `--scene-edge`. `userData.kind = 'site-buildings'`, `userData.site = true`.
- Roads and walks: `ShapeUtils.triangulateShape` on rings densified every 10 ft, each vertex at `groundZLocal + lift` (roads 0.3, walks 0.45), `--scene-road` and `--scene-walk`, polygon offsets like the Site Model.
- Water: flat areas at `level`, `--scene-water`; lines through `drapeRing` with lift 0.4.
- Trees: two `InstancedMesh` (icosahedron canopy, cylinder trunk), the Site Model code.
- Theme: materials read the CSS tokens at build time. The six tools get the Site Model tokens added to `css_add.css` (`--scene-terrain-lo`, `--scene-terrain-hi`, `--scene-skirt`, `--scene-est`, `--scene-road`, `--scene-walk`, `--scene-water`, `--scene-tree`, `--scene-trunk`) in light and dark values copied from `build/site/css_add.css`. Agent E owns those CSS edits.
- Performance: a 101 × 101 grid is 20,000 triangles. 500 buildings merge into one mesh. Trees are instanced. Budget: build under 150 ms on an iPad for the Tampa site; the Node test asserts counts, not time.

## 6. Placement gizmo `build/shared/06y_placement.js`

Active only when `opts.enabled()` is true (a project with a site is open, the tool owns its placement, no compare view, no other drag).

- **Move.** A pointer down on a model mesh (the tool's `Render` exposes `eachModelMesh`; the gizmo raycasts `layers.model` meshes through `Render.modelMeshes()`, a new one-line export) starts a move after the pointer travels 6 px. The ground plane for the drag is the horizontal plane at the hit point's world y. Each move sets `placement.x` and `placement.y` with `Store.set(path, value, { live: true })`. The delta is in the local frame, rotated into the project frame by `placement.rotation`. Snapping: 1 ft steps, 5 ft with Shift. Orbit is off during the drag (`Render.setOrbitEnabled(false)`).
- **Rotate.** A DOM handle (`.hdl.hdl-rotate`, the Tower's handle CSS) sits on a ring 1.15 × the building box radius, at the local +x side of the box center, projected to the screen like `syncHandles` in `build/tower/06b_select.js`. Dragging it sets `placement.rotation` in 5-degree steps (1-degree with Alt), live.
- **Release.** `Store.set('placement.baseZ', groundZAt(site, x, y), { live: true })` then `Store.commit()`: one undo step for the whole drag. Then `opts.onCommit()`.
- **Touch.** Pointer events with `setPointerCapture`; a second finger cancels the drag (restores the original values, then commits nothing). The handle is 44 px on coarse pointers.
- **Label.** A `.hdl-label` shows `X 120'-0" · Y 60'-0" · 15°` during the drag.
- The gizmo does not touch `Select` (the item handles). A pointer down on a handle of `Select` wins because those handles sit above the canvas.
- Keyboard: none in version 1. The typed fields in the Project tab stay.

Tool rules for `enabled()`:

| Tool | Drag moves | Why |
|---|---|---|
| Tower | its placement | The massing |
| Mid-Rise | its placement | The massing |
| Parking Deck | its placement, only when `state.source === 'standalone'` | A wrap or podium deck follows the massing |
| Facade Studio | no gizmo | The facade sits on the massing |
| Plate Planner | no gizmo | Plates sit on the massing |
| Grading Sketch | no gizmo | It works in the project frame; pads have their own handles |

## 7. Per-tool wiring

Shared by every tool:

- `build/<tool>/build.py`: `SHARED = os.path.normpath(os.path.join(HERE, '..', 'shared'))`; `MODS['sitelayer'] = ('SiteLayerMod', 'shared/sitelayer.js')`; PARTS gets `os.path.join(SHARED, '06x_sitelayer.js')` right after `06_render.js` and, for Tower, Mid-Rise, and Parking, `os.path.join(SHARED, '06y_placement.js')` right after `06b_select.js`. `rd()` already takes absolute paths. The marker `//@@MODULE sitelayer@@` goes at the top of the tool's `06c_site.js`.
- `build/<tool>/06_render.js`: a `site` layer in the layers list (Tower has it); `changed = SiteLayer.update(layers.site, state, d, kit) || changed;` in `syncMain`; the site layer hides in Compare and in the AI-ready image (Tower does this today; copy the lines); `applyView` sets the slab, grid fade, and shadow plane per section 2 by reading `SiteLayer.info().ground`; `framingBox` adds the site bounds when the layer shows (so Axon fits the whole site; the elevation views keep the building box); a new export `modelMeshes()`.
- `build/<tool>/06c_site.js` (new file; Tower rewrites its own): the adapter of section 4. It reads the show flag, builds the data with `SiteLayerMod.buildSiteLayerData(siteDerived, ProjectUI.placement(), { contextIds })` and the objects with `SiteLayer3D.objects(data, …)` inside `kit.syncLayer(layer, SiteLayer3D.keyFor(…), build)`.
- `build/<tool>/08_ui.js`: View tab gets `Controls.toggle({ label: 'Site', bind: v('site') })` as the first toggle, help "The ground, roads, water, trees, and neighbors of the project site. From the Site Model." The existing context toggle stays (label "Context blocks").
- `build/<tool>/03a_state.js`: `view.site: true` (fillDefaults keeps old saves working).
- Help panel (`08e_help.js`): one paragraph on the site layer and the drag.

Per tool:

| Tool | Files | Notes |
|---|---|---|
| Tower | `06_render.js`, `06c_site.js`, `08_ui.js`, `03a_state.js`, `09b_project.js`, `08e_help.js`, `12f_tests_project.js`, new `12i_tests_site.js` | `state.context.show` stays the context-block toggle; `view.site` is new. `groundAt` becomes `SiteLayerMod.groundZAt(siteDerived, x, y)`. `contextFromSite` runs on gizmo commit (it already follows `placement` writes through the Store subscription with `merge`). The context blocks from the site keep `site: true`, and the layer skips those ids. `bounds.site` framing: the layer's bounds when shown. |
| Mid-Rise | `06_render.js`, new `06c_site.js`, `08_ui.js`, `03a_state.js`, `09b_project.js`, `08e_help.js`, `12d_tests_project.js`, new `12f_tests_site.js` | Same as Tower. Its `groundAt` copy goes too. |
| Parking Deck | `06_render.js`, new `06c_site.js`, `08_ui.js`, `03a_state.js`, `09b_project.js`, `08e_help.js`, new `12e_tests_site.js` | Gizmo only for standalone. The context ghost of the massing stays (`view.context`). |
| Facade Studio | `06_render.js`, new `06c_site.js`, `08_ui.js`, `03a_state.js`, `08e_help.js`, new `12e_tests_site.js` | Placement = massing placement. The "Site context (ghost)" toggle label becomes "Massing context (ghost)". Roads for the ground-transparency check stay as they are (they read `site.derived` directly). |
| Plate Planner | `06_render.js`, new `06c_site.js`, `08_ui.js`, `03a_state.js`, `08e_help.js`, new `12e_tests_site.js` | Placement = massing placement. Plan view keeps the layer (the ground is under the plate). |
| Grading Sketch | `05c_ground3d.js`, `06_render.js`, new `06c_site.js`, `08_ui.js`, `08e_help.js`, new `12e_tests_site.js` | **Keeps its own ground** (existing and proposed, cut and fill colors, exaggeration). The shared layer draws only `parts: ['buildings', 'roads', 'walks', 'water', 'trees']` with `zOf: M.Y` from `Ground3D.mapper`, through `SiteLayer3D.objects`. `Ground3D.contextObjects` (the 25% ghost) is removed; the "Site context (ghost)" toggle becomes the "Site" toggle. Placement is ZERO (project frame). |

The Workspace page (`index.html`) "How projects work" rules get one line: "Every tool shows the project site. Drag the building to place it; the base elevation follows the ground." Agent E owns it.

## 8. Project file

No section shape changes. `placement` keeps `{ x, y, rotation, baseZ }`. `docs/project-file-spec.md` section 12 gets a dated note: every tool draws `site.derived`; the context radius only limits context blocks. Agent E owns it.

## 9. Tests

### 9.1 Node: `test/sitelayer.test.mjs` (Agent A; `npm run test:shared` new script, added to `npm test`)

1. A 3 × 3 grid at spacing 100, z = 1000 + 0.01 x + 0.02 y: `groundZAt` at (150, 50) = 1002.5; outside the grid clamps to the edge; a malformed grid returns null.
2. `buildSiteLayerData` with placement {100, 50, 0, 1001}: node (0, 0) lands at local (−100, −50, −1); bounds match; `shade` is 0 at the lowest node and 1 at the highest; indices count = 4 × 6.
3. Placement rotation 90: node (300, 0) lands at local (0, −300) (rotation is counter-clockwise, so toLocal turns clockwise); the building outer ring rotates the same way.
4. Buildings: a footprint with a hole keeps the hole; `base` is relative to baseZ; a building in `contextIds` is skipped; `maxBuildings` keeps the nearest.
5. Roads, walks, water areas, trees transform and count; water `level` is relative.
6. `drapeRing` on a 200 ft square with step 50 gives 16 points, each z = ground + lift.
7. No ground and a boundary: `ok` true, `ground` null, `boundary` drawn at z 0.
8. Nothing: `ok` false.
9. The Tower fixture of `build/tower/12f_tests_project.js` (11 × 11, two buildings) goes through without NaN; counts { buildings: 2, groundNodes: 121 }.

### 9.2 In-page, every tool (`?test`), new file per tool

1. No project: `SiteLayer.info().shown === false`; the slab and shadow plane are visible.
2. Open the site fixture: `shown` true, `ground` true, `buildings` 2 (Tower, Mid-Rise: 1 when one building is already a context block from the site, 2 with context blocks off), no page errors.
3. The View "Site" toggle off: `shown` false; on again: back.
4. The Compare view hides the layer; closing Compare shows it again (Tower, Mid-Rise).
5. The AI-ready image hides the layer (tools with that export).
6. Theme change rebuilds the layer (the key carries the theme epoch).
7. Tower, Mid-Rise, Parking (standalone): `PlacementGizmo.begin('move', cx, cy)` at the building center, `move` 100 px right, `end()`: `placement.x` changed, `placement.baseZ === groundZAt(site, x, y)` within 0.05, `Store.historyDepth()` grew by exactly 1, the context blocks from the site moved with it (Tower, Mid-Rise), `end(false)` restores the values.
8. `begin('rotate', …)`, a 90-degree sweep, `end()`: `placement.rotation` is a multiple of 5; one undo step.
9. Parking with `source === 'wrap'`: `PlacementGizmo.info().active === false`.
10. Grading: `SiteLayer.info().ground === false` (its own ground), `buildings` 2, the old ghost mesh count is 0.
11. Facade: the ground-transparency numbers do not change when the toggle flips (the layer never feeds metrics).

The Tower, Mid-Rise, and Grading test files already hold a site fixture (`ProjectFixture.siteProject`). Parking, Facade, and Plate get a copy of the Tower fixture function in their new test file (Agent D), with the massing section they need from their own `ProjectFixture`.

### 9.3 Integrator checks

- `npm test` green; every `?test` page green, one browser at a time.
- A real handoff: the Dunwoody test site from the Site Model → Tower (drag to place, Center on site, Send to Facade) → Facade Studio shows the same site; → Grading Sketch shows the neighbors solid.
- Screenshots at 1440 × 900 and 820 × 1180 of the Tower and the Mid-Rise with the fixture site.

## 10. File ownership

Phases B, C, D, E run in parallel with A. B, C, and D code against section 4; A's module lands first (it is small), and the page parts stub nothing.

| Phase | Model | Agent | Owns | Done when |
|---|---|---|---|---|
| A | Opus | Data module | `src/shared/sitelayer.js`, `test/sitelayer.test.mjs`, `package.json` (`test:shared`) | Section 9.1 passes |
| B | Sonnet | Layer part and the two massing tools | `build/shared/06x_sitelayer.js`; in `build/tower/` and `build/midrise/`: `build.py`, `06_render.js`, `06c_site.js`, `03a_state.js`, the "Site" toggle lines in `08_ui.js` (View tab only), the `groundAt` swap in `09b_project.js`, new `12i_tests_site.js` (tower) and `12f_tests_site.js` (midrise) tests 1 to 6 | Both pages build; tests 1 to 6 pass |
| C | Sonnet | Placement gizmo | `build/shared/06y_placement.js`, the handle CSS in `build/tower/css_add.css` and `build/midrise/css_add.css` (`.hdl-rotate` only), `PlacementGizmo.init` calls in `build/tower/13_start.js`, `build/midrise/13_start.js`, `build/parking/13_start.js`; `Render.modelMeshes()` one-line export in the three `06_render.js` files (coordinate: B owns tower/midrise `06_render.js`; C sends B the one line, B adds it); tests 7 to 9 appended to B's and D's test files after they land, or in a separate `12j_tests_gizmo.js` per tool (C's choice; name it in the report) | Tests 7 to 9 pass on Tower, Mid-Rise, Parking |
| D | Sonnet | The four other tools | In `build/parking/`, `build/facade/`, `build/plate/`, `build/grading/`: `build.py`, `06_render.js`, new `06c_site.js`, `03a_state.js`, the View toggle lines in `08_ui.js`, new `12e_tests_site.js`; `build/grading/05c_ground3d.js` (remove `contextObjects`) | Four pages build; tests 1 to 6, 10, 11 pass |
| E | Haiku | Words and tokens | `css_add.css` of all six tools (the Site Model tokens; not the handle CSS), `08e_help.js` of all six tools, `index.html` rule line, `docs/project-file-spec.md` note, `README.md` tool rows ("site layer"), `docs/suite-roadmap.md` | Text reviewed by the integrator |
| F | Opus | Integrator (this session) | Rebuilds, `npm test`, every `?test`, section 9.3, PR | Cade merges |

Rules:

- Nobody edits a file another phase owns. A needed line in another phase's file goes to that agent as a message (the integrator relays).
- B defines `SiteLayer3D`; C and D only call it. D copies B's `06c_site.js` adapter shape (B commits it first, within its first hour; D starts on `build.py`, state, UI, and tests until then).
- Commits: each agent commits only its own files, on branch `site-layer`, in the worktree `/home/claude/layer-wt`, with the session's commit trailer. No pushes.

## 11. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| The ground mesh hides the tool's grid and the scale figure | The user loses the scale reference | The grid fades to 40% and draws with polygon offset above the ground; the figure stands on `groundZLocal` at its corner |
| Shadows on a 20,000-triangle receiver | Slower frames on an iPad | One receiver mesh; shadow map 2048 as today; casters off during drags as today |
| A drag starts when the user meant to orbit | Annoying | The drag needs a hit on a model mesh plus 6 px of travel; orbit starts on empty ground |
| A site far from the origin (project frame 0 to 1,000 ft) with a tool placement at 0 | The site draws off to the side of a new design | Opening a project with a site and no placement centers the building on the site (the Tower does this today; Mid-Rise and Parking copy it) |
| Grading keeps two code paths for the ground | Drift | Grading uses the shared part for everything but the ground, and its test asserts the old ghost is gone |
| Context blocks and site buildings drawn twice | Doubled walls | The layer skips `contextIds` (the ids of blocks with `site: true`) |

Open items: a "Snap to the boundary" option during the drag; a site contour toggle (the Site Model has one); the shadow study sheet with the site ground in the frame.
