# App Core Contract (Phase 0)

Read `docs/shell-plan.md` first. This file fixes the exact module APIs inside `app/`, so several builders can work at the same time. Change a signature here first, then in code.

## 0. Ground rules

- Native ES modules only. No build step. No page globals (except `window.__app` for tests, `window.ClipperLib` from the classic script).
- Three.js: `import * as THREE from 'three'`; addons: `three/addons/controls/OrbitControls.js`, `three/addons/utils/BufferGeometryUtils.js`, `three/addons/lines/LineSegments2.js` etc. The import map in `app/index.html` points `three` and `three/addons/` at jsDelivr `three@0.170.0` (same version as the tools).
- Paths: from `app/core/x.js` the src folder is `../../src/`. From `app/tools/<t>/x.js` it is `../../../src/`.
- Units: feet. Plan = (x east, y north, z up). Three world = `[x, z, -y]` (`planToWorld`). Rotation in placement = degrees, counter-clockwise in plan = `rotation.y` radians in Three.
- Dark only. Colors come from CSS tokens on `:root` in `app/shell.css` (`--scene-*`, `--bg`, `--panel`, ...). Read them with `css(name, fallback)` from `core/scene.js`.
- Every `try` around storage and `getComputedStyle`. Nothing throws out of a render loop.
- Style of code comments and UI text: short sentences, plain words, active voice (the repo's existing style).

## 1. `core/bus.js` (data builder)

```js
export const bus = { on(evt, fn) /* -> off() */, off(evt, fn), emit(evt, payload), once(evt, fn) };
export function createBus()   // a separate bus (tests)
```
Events used across the app:
- `project:open` `{doc}` — a different project is now open (or null).
- `project:change` `{doc, keys: [sectionKey...], source: 'local'|'storage', tool}` — sections changed. `tool` = the writer's tool id, or null.
- `section:<key>` `{doc, section, source, tool}` — one section changed.
- `tool:active` `{id, prev}`.
- `layers:change` `{}` — a layer turned on or off, or was registered.
- `style:change` `{style}` — `'model'|'diagram'`.
- `frame:shift` `{shift}`.
- `selection` `{item|null, owner}`.
- `notice` `{text, kind}` — show a toast.

## 2. `core/store.js` (data builder)

Port of `Store` in `build/tower/shell.html` (undo, redo, live gestures), as a factory.
```js
export function createStore({ initial, limit = 50 }) -> {
  raw(),                       // current state object (do not mutate)
  get(path),                   // 'segments.0.floors' dot paths, numbers index arrays
  set(path, value, { live = false, merge = false } = {}), // live: no undo step yet (drag); merge: change the last step, no new one
  update(fn, { live } = {}),   // fn(draft) mutates a deep clone; one step
  commit(),                    // close a live gesture as one undo step
  replace(state, { undoable = true, resetHistory = false } = {}),
  undo(), redo(), canUndo(), canRedo(),
  subscribe(fn) /* -> off */,  // fn(state, { live, path })
  snapshot(),                  // deep clone
  version(), gestureActive(), gesturePath(), historyDepth(),   // read-only helpers
}
```

## 3. `core/project-store.js` (data builder)

One in-memory project for the page. Wraps `src/shared/project.js`.
```js
export function createProjectStore({ storage = safeLocalStorage(), bus, debounceMs = 1000, win, timers, autoStart = true }) -> {
  doc(),                 // current doc or null
  id(),
  list(),                // listProjects(storage)
  open(id),              // load, emit project:open, set cmrlm.project.last
  create(name),          // newProject + save + open
  close(),
  ensure(),              // returns doc; creates and saves "Untitled project" when none is open
  section(key),          // getSection(doc, key) or null
  write(key, patch),     // writeSection on the current doc (ensure() first); debounced save; emits section:<key> and project:change (source 'local')
  flush(),               // save now (merge rule of spec section 8: re-read stored copy, keep newer other sections)
  reload(),              // re-read from storage; emit section:<key> for every section whose updatedAt changed (source 'storage')
  importFile(file),      // importProject; open it
  exportCurrent(),       // exportProject + download
  isReadOnly(key),       // true when the stored section schema is newer than the app knows (schema 1)
  pending(), dispose(),
}
export function safeLocalStorage()
```
Auto-wiring inside `createProjectStore`: `visibilitychange` (hidden: flush; visible: reload), `pagehide` (flush), `focus` (reload), `storage` event on `cmrlm.project.<id>` (reload). Startup: open `?project=<id>` from the URL, else `cmrlm.project.last`, else nothing.

## 4. `core/frame.js` (3D builder)

```js
export function planToWorld(x, y, e = 0) -> [x, e, -y]
export function worldVec(x, y, e = 0) -> THREE.Vector3
export function planMatrix(elev = 0) -> THREE.Matrix4      // geometry authored in plan space (shape x,y; extrude up)
export function getShift() -> { x, y, z }                  // project point minus shift = scene plan point
export function setShift(shift)                             // emits frame:shift
export function shiftFor(doc) -> { x, y, z }               // the Model Viewer rule: site center and lowest ground, else model center, else 0
export function placeGroup(group, placement)               // group.position/rotation for a tool LOCAL frame (x, y, z relative to baseZ) in the shifted scene
export function toScene([x, y, z = 0]) -> [x, y, z]        // project plan point -> scene plan point
export function fromScene([x, y, z = 0]) -> [x, y, z]
```

## 5. `core/scene.js` (3D builder)

```js
export function css(name, fallback) -> THREE.Color
export function createScene(hostEl, { bus }) -> {
  THREE,                       // re-export for tools
  renderer, scene, canvas(),
  camera(),                    // the active camera (persp or ortho)
  controls,                    // OrbitControls
  layerRoot,                   // THREE.Group: Layers puts its groups here
  overlayRoot,                 // THREE.Group: handles, outlines, guides; hidden for captures
  requestRender(),
  onFrame(fn) /* -> off */,    // called each rendered frame (handles follow the camera)
  setView(name, { animate = true } = {}),  // 'axon'|'n'|'e'|'s'|'w'|'plan'
  isPlan(),
  fitBox(box3, { animate } = {}),
  setFraming({ site: () => Box3|null, building: () => Box3|null }),
  frameSite(), frameBuilding(),
  setStyle(style), style(),    // 'model'|'diagram'; emits style:change
  setSun({ az, alt }), setShadows(on),
  setOrbitEnabled(on),
  rayFrom(clientX, clientY) -> THREE.Raycaster,
  groundPoint(clientX, clientY, zPlan = 0) -> [x, y] | null   // scene plan point on a horizontal plane
  toScreen(worldVec3) -> { x, y, visible }                     // client pixels
  resize(),
}
```
Scene content: hemisphere light, one shadow sun (shadow map 2048, follows the content bounds), a shadow catcher, a shader grid (10 ft and 50 ft, fades), a 6 ft scale figure. Render on demand only. Pixel ratio at most 2. Touches: one finger rotates (pans in Plan view), two fingers dolly and pan.

## 6. `core/input.js` (3D builder)

```js
export const PRIORITY = { HANDLES: 100, GIZMO: 80, DRAW: 60 };
export function createInput(scene, { bus }) -> {
  claim(handler, priority) /* -> off */,
  // handler = { test(ev) -> bool, down(ev), move(ev), up(ev), cancel() }
  // On pointerdown (capture phase on the canvas) handlers are asked in priority order; the first test() === true owns the gesture,
  // orbit turns off until up/cancel. A second finger cancels the gesture (cancel()).
  // A DRAW handler only gets pointerType 'pen' or 'mouse'. A finger never draws.
  onTap(fn) /* -> off */,      // fn({ clientX, clientY, pointerType, shiftKey }) for a press < 6 px and < 400 ms that nobody claimed
  onDoubleTap(fn),
  isCoarse(),                  // (pointer: coarse)
}
```

## 7. `core/placement.js` (3D builder)

Port of `build/shared/06y_placement.js` and `08y_pin.js` as a factory, using `input` (priority GIZMO) and `scene.overlayRoot`.
```js
export function createPlacementGizmo({ scene, input, ground, get, set, bounds, pickables, enabled }) -> { sync(), setEnabled(on), dispose() }
// get() -> placement {x,y,rotation,baseZ,baseMode,pinned}; set(placement, { live }) ; bounds() -> plan ring of the footprint in project frame
// pickables() -> meshes that start a move drag. Rotation ring snaps 5 deg (1 deg with Alt); move snaps 1 ft (5 ft with Shift).
// baseMode 'follow': on release baseZ = lowest ground.at() under the footprint (9 x 9 samples).
```

## 8. `core/capture.js` (3D builder)

```js
export async function captureImage(scene, { aiReady = false, title = '', rows = [], hooks = [] }) -> Blob
// hooks: fns (on: bool) called before/after an AI-ready capture (layers recolor). Uses src/shared/screenshot.js captureView.
export async function deliver(blob, name)   // deliverImage + screenshotFilename
```

## 9. `core/layers.js` (layers builder)

```js
export function createLayers({ scene, bus }) -> {
  register(def) /* -> off */,
  // def = { id, label, owner /* tool id */, order, defaultOn = true, replaces = [] /* layer ids hidden while this def is registered */,
  //         key(ctx) -> string, build(ctx) -> THREE.Object3D | null, dispose?(obj), count?(obj) -> number,
  //         aiReady?(obj, on) }
  sync(ctx),                   // for each visible layer: key(ctx); rebuild when the key changed; requestRender
  invalidate(id),
  setOn(id, on), isOn(id),
  list() -> [{ id, label, owner, on, count, replaced }],
  pick(clientX, clientY) -> { layerId, owner, item, point } | null,
  // a pickable mesh carries userData.pick = (faceIndex) => item | null ; item = { id, title, rows: [[label, text]], owner, ... }
  levels(doc) -> [{ key, z, name }], setCut(key | null), cut(),
  setAiReady(on),
  bounds(ids) -> THREE.Box3 | null,   // world box of the built, visible groups of these layer ids (Site and Building zoom)
}
export function buildMerged(items, { colorOf, edges = true }) -> THREE.Group   // one merged mesh per group, per-vertex color, userData.pick by vertex range (Model Viewer pattern)
```

## 10. `core/derived.js` (layers builder)

Draws every section from `derived` (Model Viewer job) through `src/viewer/scene.js` `layersFrom`, `levelsIndex`, `cutAt`, `colorKey`, `colorOf`.
```js
export function derivedLayerDefs({ getDoc, ground, scene }) -> [def, ...]
// ids: 'site-ground','site-neighbors','site-roads','site-water' (owner 'site', via sitelayer3d),
//      'massing' (owner 'tower'), 'units','cores' (owner 'plates'), 'parking' (owner 'parking'), 'grading' (owner 'grading')
// A live tool layer replaces its derived twin with def.replaces, e.g. the Tower's live layer has replaces: ['massing'].
```

## 11. `core/ground.js` (layers builder)

```js
export function createGround({ getDoc, bus }) -> {
  at(x, y) -> z | null,        // project plan point -> project elevation: override, else existing, else null
  existingAt(x, y) -> z | null,
  setOverride(fn | null, owner),  // fn(x, y) -> z | null (Grading proposed ground)
  hasOverride(),
}
```
The site ground layer hides its ground mesh while `hasOverride()` (it keeps roads and buildings).

## 12. `core/sitelayer3d.js` (layers builder)

ES-module port of `build/shared/06x_sitelayer.js` with the same public API (`objects`, `dispose`, `setShadows`, `keyFor`, `makeSampler`, `frameAround`, `STYLES`). Imports THREE and frame helpers instead of page globals. Dark colors only.

## 13. UI modules (UI builder)

```js
// core/ui-kit.js
export function h(tag, attrs, ...children) -> HTMLElement        // attrs: class, style (object or string), on<Event>, dataset, any attribute
export const ICONS = { site, tower, parking, grading, plates, layers, project, undo, redo, export, camera, prompt, collapse, expand, panels, close, more, eye, eyeOff, check, warn };  // inline SVG strings, 20 px, stroke currentColor
export const Toast = { show(text, { kind = 'info', ms = 2600 } = {}) };
export const Pop = { open(anchorEl, items) /* items: [{ label, action, disabled, checked, sep, hint }] */, close() };
export function confirmDialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false }) -> Promise<boolean>
export const Controls = { /* port of build/tower/07_controls.js widgets: number/slider field, segmented control, toggle, select, text, color, button row; same call shapes */ };

// core/dock.js
export function createDock(el, { onSelect }) -> { setTools([{ id, label, icon }]), setActive(id), setExtras([{ id, label, icon, action }]) }

// core/panels.js
export function createPanels(el, { storageKey = 'cmrlm.app.panels' }) -> {
  set(groups),       // groups: [{ id, title, build(bodyEl), open = true, owner }]; rebuilds the column; remembers open state per id
  refresh(id),       // rebuild one panel body
  collapseAll(), toggleColumn(), isSheet(),
}

// core/keys.js
export function createKeys() -> { bind(scope, combo, fn) /* -> off */, setActive(scope) }  // scope 'shell' first, then the active tool; combo like 'mod+z', 'shift+mod+z', '1', 'Escape'; ignores keys typed in inputs
```
`app/index.html` markup ids: `#topbar` (with `#tbLeft`, `#tbCenter`, `#tbRight`), `#dock`, `#view` (canvas host), `#handles` (DOM handle layer over the view), `#card` (selection card), `#panels`, `#toasts`. Clipper classic script, import map, `<script type="module" src="./main.js">`.

## 14. Tool module (Phase 1 builders)

```js
export default {
  id, section, label, icon, order,          // order: dock position (Site 10, Tower 20, Parking 30, Grading 40)
  dock: true,                               // false for view-only tools (plates)
  async init(ctx) {},
  activate(ctx) {}, deactivate(ctx) {},
  panels(ctx) -> [{ id, title, build(bodyEl), open }],
  layers(ctx) -> [layer def],               // live layers; use replaces: [...] for the derived twin
  metrics(ctx) -> [{ label, value, hint }],
  warnings(ctx) -> [{ text, level: 'info'|'warn'|'error' }],
  onProject(evt, ctx) {},                   // project:change from another tool or from storage
  exports(ctx) -> [{ id, label, run() }],
  card(item, ctx) -> [{ label, action }],   // extra buttons on the selection card
  onTap(ev, ctx) -> bool,                   // optional: the active tool picks its own items first; true = handled
  store,                                    // optional: the tool's createStore instance (top-bar Undo and Redo use it)
};
```
`ctx` (built in `main.js`): `{ THREE, bus, scene, layers, ground, input, keys, project, ui: { h, ICONS, Toast, Pop, Controls, confirmDialog }, frame, capture, store(initial) -> createStore, activate(toolId), select(item|null), refreshPanels(), refreshHud() }`.

## 15. Additions made by the Phase 0 builders (all additive)

Read the module source for details. The main ones a tool port uses:

- **scene**: `setInsets({ right, bottom })`, `frameSite({ animate })`, `frameBuilding({ animate })`, `onView(fn)`, `view()`, `renderNow()`, `refreshColors()`, `ok` (false without WebGL). `fitBox` and `setFraming` accept a world `Box3` or a scene-plan box `{ minX, maxX, minY, maxY, minZ, maxZ }`. A mesh with `userData.kind === 'site-ground'` or `userData.isGround` counts as ground for the slab, grid, and figure.
- **frame**: `worldToPlan(vec3)`.
- **input**: `start(handler, ev)` for a DOM grip in `#handles`; `hitPx('handle' | 'vertex')`; `active()`, `cancel()`; a handler may set `pointerTypes: [...]`; `up()` may return `'tap'`.
- **placement**: `set(p, { live })` gets live writes, then one `{ live: false }`; a cancel ends with `{ live: false, cancel: true }` and the start placement. With a tool store: `store.set('placement', p, { live: true }); if (!live) store.commit();` = one undo step. Also `pinned()`, `setPinned(on)`, and pure `movedPlacement`, `turnedPlacement`, `lowestGround`.
- **layers**: `bounds(ids)`, `get(id)`, `def.always(ctx, { on, replaced })` runs on every sync. `key(ctx)` and `build(ctx)` get the caller ctx plus `{ doc, style, cut, shift, aiReady, layers }`. `pick()` returns `{ layerId, owner, item, point, world }`; `userData.pick(faceIndex, hit)`; a mesh without `userData.pick` blocks the pick unless `userData.occludes === false`. Layer on/off state is kept in `cmrlm.app.layers`.
- **ground**: bus event `ground:change { owner, on }`. The derived grading layer uses owner `'grading:derived'`. The live Grading tool calls `setOverride(fn, 'grading')`.
- **ui-kit**: also exports `Units` (same functions as the Tower) and `icon(name)`; more ICONS (chevron, plus, minus, trash, sun, home, info). `Pop.open(anchor, items, { align, onClose })`. `Controls`: `bindStore(store, path)`, `mapBind`, `bindObject`, `slider`, `number`, `toggle`, `select`, `segmented`, `chips`, `color`, `text`, `points`, `when`, `list`, `section`, `group`, `help`, `label`, `button`, `row`, `refreshAll`, `scoped`, `create()` (a refresh registry for one tool). A bind is `{ get(), set(v, live), commit() }`; a widget returns `{ el, refresh }`.
- **panels**: `setTitle(id, title)`, `open(id)`, `snap(name)`, `isHidden()`, `ids()`. Layout state is on `<html>`: `data-layout` (`column` or `sheet`), `data-panels`, `data-sheet`.
- **keys**: a handler that returns `false` passes the key on.
- **project-store**: events carry `tool`; options `win`, `timers`, `autoStart`; `pending()`, `dispose()`.
- **store**: `set(path, v, { merge })`, `replace(s, { resetHistory })`, `version()`, `gestureActive()`, `historyDepth()`.
