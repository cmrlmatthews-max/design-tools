# Unified Shell — Plan

Version 1 · October 27, 2026 · Owner: Cade (CMRLM) · Branch `unified-shell`

This plan merges the Site Model, the Tower Generator, the Parking Deck Generator, and the Grading Sketch into one page with one shared 3D scene. Read it before any shell work. The project-file spec (`docs/project-file-spec.md`) stays the contract for all data.

## 1. Decisions (Cade, October 27, 2026)

| Topic | Decision |
|---|---|
| Direction | B: full merge. One page, one 3D scene, one code base for the shell tools. |
| Layout | Side dock: tool icons on the left, an always-on 3D view in the center, stacked collapsible panels on the right. |
| Look | Dark app style. No light mode in the shell for now. |
| Tools in the shell | Site Model, Tower Generator, Parking Deck, Grading Sketch. |
| Not in the shell | Plate Planner (stays its own page, shown as a view-only layer). Mid-Rise Generator (no slot). Facade Studio (no slot). |
| Model Viewer | Retired. The shell view replaces it. |
| Feature level | Core features. The Tower Generator keeps the AI prompt library. No compare view. |
| Unfinished tools | No slot, no icon, no "coming soon" or "planned" text anywhere. |
| URL | `/design-tools/app/`. The Workspace page stays and links to it. |
| Repo | Same repo `design-tools`. The old tool pages stay live until Cade approves their removal. |
| Freeze | The work Claude does not edit tool folders until the shell reaches parity (`docs/suite-roadmap.md` section 5). |
| iPad | Required. Start a list of direct-drawing features: `docs/ipad-drawing-ideas.md`. |
| One look (October 28, 2026) | The model looks the same in every tool and with no tool open. Each tool's own drawer draws its part, loaded in the background when a project opens. Edit aids (handles, envelope, conflict lines, labels for editing) show only in the active tool. View settings (style, color by, floor lines, shadows, sun) are app-wide in the View panel. |
| Podium parking (October 28, 2026) | Direction B: podium floors with the Parking program become a linked podium deck in the Parking tool at once. The deck replaces those massing floors. A standalone deck stays as it is, with a warning. |
| Screening (October 28, 2026) | Open, Solid, Mesh. Mesh openness 0 to 50 percent, written to `parking.derived.screen` for later open-garage checks. |
| Units and massing (October 28, 2026) | Units draw while they match the massing geometry; the massing skips those floors. After a geometry change the massing draws and the units hide. A move or a new base does not count as a change. |
| Future | More tools join the shell later. The tool contract (section 5) must make a new tool a new folder, not a shell rewrite. |

## 2. What the research found

Five research passes read every tool (October 27, 2026). The results that set this plan:

1. The tool math is in `src/` as clean ES modules with no DOM and no Three.js. The shell reuses these modules unchanged. Examples: `src/tower/geometry.js`, `src/parking/layout.js`, `src/grading/features.js`, `src/site/model.js`, `src/shared/project.js`.
2. The page layer (`build/<tool>/*.js`) cannot merge as it is. Every tool defines the same top-level names (`CONFIG`, `Render`, `UI`, `Store`, `Select`, `Derived`, `h`, `Toast`) and the same DOM ids (`#canvasHost`, `#hud`, `#sections`). This layer gets rewritten.
3. The Model Viewer's `src/viewer/scene.js` already turns every project section into drawable items (`layersFrom`, `levelsIndex`, `cutAt`, `colorKey`). It is the seed for the shell's layer system.
4. Each tool owns a renderer, a camera, OrbitControls, lights, a ground, and a grid inside its `Render` closure. The shell owns these once.
5. The Grading Sketch draws its own ground on the same grid nodes as the site ground. In one scene the two grounds overlap. The shell needs one ground owner (section 7).
6. Each tool binds pointer events on the canvas in the capture phase. The shell needs one input router (section 8).
7. Project data moves through `localStorage` today (`cmrlm.project.*`). In one page, one in-memory project replaces the save-and-navigate handoff. The Plate Planner still writes from its own page, so the shell must reload on focus and on the `storage` event.

Page-layer size to port (no tests): Tower about 7,000 lines, Parking about 6,400, Grading about 5,900, Site about 2,000. About half of each is panel and top-bar code that the new dock and panels replace.

## 3. Shell layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ CMRLM  Project name ▾   Undo Redo   Axon N E S W Plan  Site Bldg  ⤓ │  top bar
├──┬───────────────────────────────────────────────────┬──────────────┤
│◉ │                                                   │ ▾ Metrics    │
│  │                                                   │   GFA  FAR   │
│▲ │                                                   ├──────────────┤
│  │              ONE 3D VIEW (always on)              │ ▾ Form       │  panels of
│▦ │   site + massing + plates + parking + grading     │   …          │  the active
│  │                                                   ├──────────────┤  tool
│⛰ │                                                   │ ▸ Program    │
│  │                                                   │ ▸ Site       │
│──│                                                   ├──────────────┤
│☰ │ [selection card]                                  │ ▸ Layers     │  shell panels
│  │                                                   │ ▸ Warnings   │
└──┴───────────────────────────────────────────────────┴──────────────┘
 dock: Site ◉, Tower ▲, Parking ▦, Grading ⛰, then Layers/Project ☰
```

- **Dock.** One icon per tool in pipeline order: Site, Tower, Parking, Grading. A tap makes that tool active. The active tool's panels fill the right column. The other tools' layers stay visible in the view as context.
- **Panels.** Each panel has a header that collapses it. The shell remembers open and closed state per tool. "Collapse all" closes every panel. The right column hides fully with one button or the key `\`.
- **Shell panels** (always present, below the tool panels): Metrics, Layers, Warnings. The Project menu and the Export menu live in the top bar.
- **Selection card.** Floats at the lower left of the view. It shows the selected item and its fields. It replaces each tool's `#selection-card`.
- **iPad portrait.** The right column becomes a bottom sheet with three heights. The dock becomes a row of icons at the top edge of the sheet.

## 4. Code layout (native ES modules, no build step)

The shell uses native ES modules. The `src/` modules are already valid ES modules (the Node tests and the Workspace page import them directly). The shell imports them with relative paths and loads each tool with `import()` the first time its icon is tapped. Three.js stays on jsDelivr through an import map. ClipperLib stays a classic script from jsDelivr, loaded once.

```
app/
  index.html               page: import map, Clipper script, tokens, mount points
  shell.css                dark tokens and every shell style
  core/
    scene.js               renderer, cameras, OrbitControls, lights, sun, grid, figure, render loop
    frame.js               planToWorld, worldVec, planMatrix, scene shift (one copy for the page)
    layers.js              layer registry, merged-geometry builder, pick ranges, level cut
    ground.js              ground registry: existing ground owner, proposed-ground override
    project-store.js       one in-memory project, event bus, autosave, reload from storage
    store.js               undo/redo store factory (one instance per tool)
    input.js               pointer router, tap rule, drag capture, pen versus finger
    keys.js                keyboard router (shell keys first, then the active tool)
    dock.js, panels.js     dock, panel stack, bottom sheet, collapse state
    ui-kit.js              h, Toast, Pop, confirm, field widgets (from build/tower/07_controls.js)
    placement.js           placement gizmo and pin (from build/shared/06y_placement.js, 08y_pin.js)
    sitelayer3d.js         site meshes (from build/shared/06x_sitelayer.js)
    capture.js             image and AI-ready image through src/shared/screenshot.js
  tools/
    site/index.js          tool module (section 5) and its panels
    tower/index.js
    parking/index.js
    grading/index.js
    plates/index.js        view-only layer: no panels, no dock icon
  test/                    in-page smoke tests (?test)
```

Rules:

1. A file in `app/tools/<tool>/` imports from `app/core/` and `src/` only. It never imports another tool folder.
2. Nothing in `app/` defines a page global. The only `window` hook is `window.__app` for tests.
3. `src/` changes only when a module needs a new export. Every change keeps `npm test` green.
4. Caution: GitHub Pages serves each module as its own request. If the first load on an iPad is slow, add a small bundle step later. Do not add it before a measured need.

## 5. Tool module contract

Every tool exports one object. A new tool joins the shell by adding a folder and one line in the dock list.

```js
export default {
  id: 'tower',                  // dock id; also the default project section owner
  section: 'massing',           // the project section this tool writes (one only)
  label: 'Tower', icon: 'tower',
  async init(ctx) {},           // first activation: build state, panels, layer builders
  activate(ctx) {},             // tool becomes active: panels shown, input and keys routed here
  deactivate(ctx) {},           // tool becomes inactive: its layers stay, its handles go
  panels: [ /* { id, title, build(el, ctx), open } */ ],
  layers: [ /* { id, label, key(ctx), build(ctx) -> THREE.Group, pick?:true } */ ],
  metrics(ctx) {},              // rows for the shell Metrics panel
  warnings(ctx) {},             // rows for the shell Warnings panel
  onProject(doc, ctx) {},       // another section changed
  exports: [ /* { id, label, run(ctx) } */ ],
};
```

`ctx` gives the tool: `scene` (add and remove groups, request a render, frame a box), `project` (read sections, write the tool's own section), `store` (its own undo store), `input` (claim pointer gestures), `ui` (ui-kit), `ground` (ground height at a point), and `capture`.

**Live and derived drawing.** A loaded tool draws its layers live from its own state. A tool that is not loaded yet has its section drawn from `derived` through `src/viewer/scene.js` `layersFrom`. The Plate Planner is always drawn this way (`unitsAndCores`). Thus the first view of a project is complete before any tool loads, and the Model Viewer's job moves into the shell.

## 6. Shared scene

- **One renderer**, pixel ratio at most 2, render on demand only (`needsRender`). One `WebGLRenderer` for the whole page keeps the iPad under its WebGL limits.
- **One frame.** The project frame from `src/shared/project.js`. Scene origin = the Model Viewer's shift rule: the site center and the lowest ground. Each tool group gets its `placement` matrix (`toProject`). One `planToWorld` in `core/frame.js`.
- **No vertical exaggeration** in the shared scene. The Site Model's 1/2/3/5× scale and the Grading Sketch's exaggeration move to later (section 9).
- **Lights and sun.** One hemisphere light and one shadow sun. The Tower's manual sun (azimuth and altitude) drives it. One shadow catcher on the ground.
- **Views.** Axon, N, E, S, W, Plan, Site zoom, Building zoom (from `Render.setView`, `fitBox`, `frameSite`, `frameBuilding`).
- **Style.** Model and Diagram, color by program or zone. Site style Solid, Glass, Wireframe for neighbor buildings.
- **Layers panel.** One switch per layer with a count: Site ground, Neighbors, Roads, Water, Massing, Context blocks, Envelope, Units, Cores, Parking, Grading. Level cut from `levelsIndex` and `cutAt`.
- **Tap for data.** A tap on any item of an inactive tool shows its data card and an "Edit" button that activates the owner tool.

## 7. Ground

One ground registry in `core/ground.js`.

1. The Site Model owns the existing ground (`site.derived.ground`).
2. The Grading Sketch registers a proposed-ground override. While the grading layer is on, the shell hides the existing ground mesh and shows the existing surface as a dashed wire only where it differs (`existingWire` in `build/grading/05c_ground3d.js`).
3. `ctx.ground.at(x, y)` returns the proposed height when grading is on, else the existing height, else 0.
4. Buildings and decks stand on their `placement.baseZ`. "Follow ground" uses `ctx.ground.at`. When `grading.derived.ffe` has a value for that building, the base uses the FFE.
5. One pick target for the ground, so a tap never hits two grounds.

## 8. Input and keys

- **Input router.** One set of pointer listeners on the canvas. Order: active-tool handles, then the placement gizmo, then the active tool's draw mode, then tap-to-pick, then OrbitControls. A gesture that a layer claims turns orbit off until release.
- **Tap rule.** Shorter than 6 px and 400 ms, one finger. A second finger cancels a tap or a drag. Touch hit sizes 44 px for handles, 28 px for vertices.
- **Pen versus finger.** `pointerType === 'pen'` draws or edits. A finger orbits and pans. A mouse keeps today's behavior. Details: `docs/ipad-drawing-ideas.md`.
- **Keys.** One router. Shell keys first: 1–6 views, D style, Cmd+Z and Cmd+Shift+Z undo and redo of the active tool, `\` panels, M metrics, Esc. Then the active tool's keys.

## 9. Core features per tool

"Core" goes into the shell now. "Later" waits for a later pass. "Old page" stays on the old tool page until a later pass or forever.

### 9.1 Site Model (`app/tools/site/`)

| Core | Later |
|---|---|
| Address, coordinates, or Google Maps link, then Go, with a size choice | Vertical scale and the contour shader |
| Progress list with an error per data theme | Walks toggle |
| Ground, neighbor buildings, roads, water through `sitelayer3d.js` | Revit CSV, DXF, SketchUp, notes downloads (pure functions, wire to the Export menu after core) |
| Remove and restore existing buildings (tap, card, Restore all) | Recent sites list |
| Writes the `site` section (`siteDerived`, `siteState`) | Trees (off today) |
| Site style, boundary, north arrow | |

### 9.2 Tower Generator (`app/tools/tower/`)

| Core | Later |
|---|---|
| Podium, segments (all shapes), offsets, taper, twist, lean, crown, setbacks by floor, mechanical floors, carves, cuts | Sun Study mode (study dates, play, sun-hours map, 3×3 shadow sheet) |
| Programs and targets | `?study=sun` page mode (drop) |
| Site shape, setbacks, height limit, stepback, envelope, context blocks | Custom-prompt editor |
| Selection, handles, snapping, copy above and below | SketchUp export |
| Presets, saved options, autosave, undo and redo | Option JSON export and import |
| Placement on the site, Follow ground, Context from site | Typed base elevation, pin |
| Manual sun and shadows | Image overlay options |
| Image and AI-ready image | |
| **AI prompt library** (20 built-in prompts, fields, preview, copy) | |
| Writes the `massing` section (`towerDerived`) | |
| Compare view: **dropped** | |

### 9.3 Parking Deck (`app/tools/parking/`)

| Core | Later |
|---|---|
| Source: standalone, wrap, podium (`useSource` logic) | Liner strip, circular speed-ramp segments |
| Footprint, levels, bays, column grid, cores, entries | Accessible table editor, EV, bike, required-parking editors (metrics stay) |
| Ramp type and slopes | Stall-number labels |
| `Deck3D` model, Diagram style, isolate a level | Custom prompts, option library menu |
| Metrics and warnings | |
| Handles for footprint, core, entry, speed ramp; snapping | |
| Column overlay against the Plate Planner unit walls | |
| SketchUp, DXF, stall CSV, AI-ready image | |
| Writes the `parking` section (`parkingDerived`) | |

### 9.4 Grading Sketch (`app/tools/grading/`)

| Core | Later |
|---|---|
| Buildings with tiers, balanced or typed FFE, pad offset and depth | Section view (2D profile) |
| Existing site ground or a typed plane; daylight slopes | Vertical exaggeration |
| Cut and fill color, cut and fill numbers, contours, zero line | AI prompts and AI-ready image |
| Drives and lots | SketchUp, DXF, notes (Revit CSV is in core: it is cheap) |
| Walls: drawn, pad-step, auto | Tier table, earthwork table |
| Routes with slope checks | Saved options, presets, Help |
| Drawing with snap and vertex edit; select | Freehand pencil input (see the ideas list) |
| Writes the `grading` section (`gradingDerived`); FFE feeds Tower and Parking bases | |

### 9.5 Plate Planner (view-only layer, `app/tools/plates/`)

- Draws `plates.derived` units and cores through `unitsAndCores` in `src/viewer/scene.js`. Color by unit type in Diagram style.
- Tap a unit: data card with type, area, and an "Open Plate Planner" link (`../plate/?project=<id>`).
- The shell reloads the project when the page gets focus, when it becomes visible, and on the `storage` event, so units appear after work on the Plate Planner page.

## 10. Project store

- One in-memory project document for the page. Tools read with `ctx.project.section(key)` and write only their own section with `ctx.project.write(patch)`. Writes go through `writeSection` in `src/shared/project.js`, so every ownership rule in the spec stays.
- Event bus: a write emits `section:<key>`. Other tools rebuild their live layers from that section's `derived`.
- Autosave: 1 s debounce, plus a flush on `visibilitychange` and `pagehide`. Before each save, merge with the stored copy (spec section 8, Conflicts).
- Send menus go away. The dock replaces them.
- Project menu: New, Open, Import, Export, Close. Same keys in `localStorage` as today, so the old pages and the shell share projects.
- Risk: a large site section can reach the 4 MB `localStorage` limit (`SIZE_MAX`). Move to IndexedDB later if a real project reaches the 3 MB warning.

## 11. Dark look

- Start from the dark values that every tool's `shell.html` already defines under `prefers-color-scheme: dark` (`--bg #101316`, `--panel #171b1f`, `--surface #1f2429`, accent `#6aa2ea`) plus the `--scene-*` and site tokens in `build/viewer/css_add.css`.
- Pin them in `:root` of `app/shell.css`. Set `color-scheme: dark`. Remove the `matchMedia` theme switch.
- Same type and the CMRLM mark as today. Thin icons, 44 px hit targets.

## 12. Workspace page

- Add one main card at the top: "Open the app" (`app/?project=<id>` when a project is open).
- The old tool cards stay, grouped under "Single tools", until Cade approves their removal.
- Remove every "Planned", "Later", and "coming soon" line (Egress Sketch, View Study, Facade Studio, Mid-Rise in the app context). Cade asked for no such text.

## 13. Phases and agents

Speed comes from parallel agents. The tool ports run at the same time because the contract in section 5 keeps each tool in its own folder.

| Phase | Work | Model | Reason |
|---|---|---|---|
| 0 | `app/index.html`, `shell.css`, everything in `app/core/`, the plates view-only layer, derived drawing for every section. At the end the shell already shows any saved project. | Opus | Every tool depends on these contracts. Errors here spread everywhere. |
| 1 (parallel) | Port Site Model | Sonnet | Follows the contract; mostly UI and wiring. |
| 1 (parallel) | Port Tower Generator with the AI prompt library | Sonnet | Largest port, but the patterns exist in `build/tower/`. |
| 1 (parallel) | Port Parking Deck | Sonnet | Same pattern. |
| 1 (parallel) | Port Grading Sketch | Sonnet | Same pattern; uses the ground registry. |
| 1 (parallel) | Workspace card, README, roadmap, remove "planned" text | Haiku | Short text edits. |
| 2 | Review: math, frames, ground, input conflicts, iPad behavior; fix list | Opus | Integration errors hide between tools. |
| 3 | Fixes from the review | Sonnet | Targeted edits. |
| 4 | Mac and iPad test | Cade | Only Cade can judge the feel. |
| 5 | Retire `viewer/`; old tool pages stay until Cade approves | Cade | His decision. |

Each phase is one commit series on `unified-shell` and one pull request. Cade merges.

## 14. Tests

- `npm test` stays green. No `src/` change merges with a red test.
- New Node tests for the pure core parts: `project-store.js` (ownership, merge, debounce), `layers.js` (merged ranges, cut), `ground.js` (override order).
- `app/?test`: a short in-page smoke suite per tool: load, change one field, check the layer key, check the written section shape.
- The old in-page suites stay on the old pages.

## 15. Risks

| Risk | Effect | Answer |
|---|---|---|
| Large Tower port | The longest task in Phase 1 | Split it into two Sonnet agents if it runs long: form and selection, then site, project, and prompts. |
| Two grounds | Flicker and wrong picks | Ground registry (section 7). |
| Input conflicts | Gizmo, handles, and orbit fight | One input router (section 8). |
| iPad memory | Crash or reload on large sites | One renderer, merged meshes, render on demand; measure on Cade's iPad in Phase 4. |
| Many module requests | Slow first load | Measure first; add a bundle step only if needed. |
| `localStorage` size | Save fails on large sites | Warning at 3 MB today; IndexedDB later. |
| Work Claude edits during the build | Merge conflicts | Freeze (roadmap section 5). |
