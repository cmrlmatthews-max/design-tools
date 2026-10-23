# Batch fixes — Technical Plan

Version 1 · October 23, 2026 · Branch `batch-fixes` from `main` at 72aeddf (everything through PR #18)

Eight asks from Cade after the site layer, the base rule, and the Hero render went in. One plan, five parallel builders, one integrator. PR #19 (Site Model default 3,000 ft) is a separate branch; it touches only `build/site/01_config.js` line 21 (`defaultSize`). Phase E edits that file too (`trees: false`). The merge is clean when both change different lines. Do not depend on #19.

Decisions pending from Cade carry a default and a switch. The builders use the default. The integrator flips the switch when Cade answers.

| Pending | Default | Switch |
|---|---|---|
| Hero color | amber `#E0A458` | `CONFIG.heroColor` in the five tools that have an AI-ready image |
| Pin also locks the segment offset fields | no | `CONFIG.pinLocksOffsets` (tower, midrise) |
| Trees also leave the Revit CSV and SketchUp exports | yes | `CONFIG.trees.exports` in `build/site/01_config.js` |

## 1. Facade Studio: the crown is missing

**Cause.** `src/facade/faces.js` line 51: `SKIP_ZONES = ["deck", "crown"]` (facade plan decision 16). The Tower writes a `crown` level (`src/tower/derived.js` lines 133 to 155: zone `crown`, `plates` = the lowest crown solid's footprint, `ftf` = the crown height, `program` null). The Facade Studio drops it, so the massing stops at the top floor.

**Change (the smallest correct one).**

- `faces.js`: `SKIP_ZONES = ["deck"]`. The crown level joins `levels` with `zone: "crown"`.
- `zoneOf(state, levels)` (line 320): a level with `zone === "crown"` gets the zone id `"crown"` always, before the ranges rule. The `top` zone stays the highest non-crown level. Ranges never capture the crown (a range that covers its index still maps it to `"crown"`).
- Zone rules: `build/facade/03a_state.js` `fillDefaults` adds `zones.rules.crown = { system: "solid" }` when missing (line 38 loop: add `"crown"` to the id list). `src/facade/panels.js` `ruleFor` needs no change: `rules.crown` resolves like any zone, and `solid` draws a screen with no glass.
- Metrics (`src/facade/metrics.js` lines 136 to 143): the crown faces count in `wall` and `glazing` like any zone. With the default `solid` system they add wall and 0 glazing, which lowers the WWR a little. Decision: the crown is **left out of the building WWR and the orientation WWR** and shown as its own zone row only. Implement: `metrics` skips faces with `zone === "crown"` in the building and orientation sums, keeps them in `zones.crown`. The HUD note under WWR reads "crown not counted" when a crown exists.
- Facade tab: the zone list (`build/facade/08_ui.js`, the zones section) shows "Crown" after "Top" when the massing has a crown level, with the same system chips. The balconies rule (`panels.js` line 276) already excludes `solid`; also exclude zone `crown` from `bal.zones`.
- Drawing: `build/facade/05c_facade3d.js` draws every level in `levels`, so the crown draws once `SKIP_ZONES` changes. Check the cap (line 153) still sits on the highest level.
- Standalone massing: no crown (unchanged).
- Project file: no shape change. The facade `derived` gets the crown faces under `zones.crown` only.

**Tests.**

- Node `test/facade.faces.test.mjs`: a tower fixture with levels 1 to 3 plus a crown level (`zone: "crown"`, z 30, ftf 20): `massingLevels` returns 4 levels; `zoneOf` maps index 4 to `"crown"` and index 3 to `"top"`; a ranges mode that spans 1 to 4 still maps 4 to `"crown"`.
- Node `test/facade.panels.test.mjs`: `ruleFor(state, "crown", "N")` is `solid` by default; after `rules.crown.system = "curtainWall"` it is curtain wall.
- Node `test/facade.exports.test.mjs` or the metrics test: the building WWR with a crown equals the WWR without it; `zones.crown` exists with `glazing` 0 under `solid`.
- In-page `build/facade/12e_tests_site.js` or `12b_tests_ui.js`: open the site fixture with a crown level; the Facade tab lists "Crown"; the 3D view has one more level mesh; the HUD shows "crown not counted".

## 2. Placement: Glass on open, Pin placement, no accidental moves

### 2.1 Glass on open

When a project with a site ground opens in the Tower, the Mid-Rise, or a standalone Parking Deck, and `placement.pinned` is not true, the page sets `view.siteStyle = "glass"` for that session (not saved to the option). Pin sets it to `"solid"`. The user can change the style at any time; the page sets it only on open and on Pin. Implement in each tool's `09b_project.js` `openDoc` (after `followGround`): `Store.set("view.siteStyle", pinned ? "solid" : "glass", { live: false, merge: true })`.

### 2.2 Pin placement

- State: `placement.pinned: boolean` (default false; `fillDefaults` keeps a missing value as false). It travels in the massing section placement (`sectionPatch`) and in the parking section, like `baseMode`.
- Top bar: a **Pin placement** / **Unpin** button (`#tbPin`, class `tb-pin`, a pin glyph) right after the project pill, shown only while a project with a placement is open. Pressed look when pinned. One click toggles; one undo step. Built in a new shared part `build/shared/08y_pin.js` (`PinUI = { init({ tool }), sync(), pinned(), setPinned(v) }`), registered in the three `build.py` PARTS after `08x_tip.js`, initialized in the three `13_start.js` after `PlacementGizmo.init`.
- Locks while pinned:
  - the drag gizmo and the rotation ring: `PlacementGizmo.init` gets `locked: () => PinUI.pinned()`; `active()` returns false when locked; the ring hides.
  - the typed X, Y, rotation, base fields stay editable (Cade: "typed X/Y/rotation still work").
  - `CONFIG.pinLocksOffsets` (default false): when true, the Tower segment `offset.x/y` fields and the Mid-Rise bar `x/y` fields are disabled while pinned, with a help line "Unpin the placement to move the building." Build both variants; ship the default.
- Center on site and Context from site still work while pinned (they do not move the building by accident).
- A pinned project opens with Solid; Unpin switches to Glass.

### 2.3 No accidental moves (the hit rule)

The gizmo listens on the canvas host in the capture phase (`06y_placement.js` line 443), so it runs before a tower handle's own listener and before `Select.dragging()` is true. A press on a DOM handle over the model starts both a handle drag and a placement move. Rules, in `onCanvasDown`:

1. `e.target` must be the canvas itself. A press whose target is inside `.hdl-layer`, `.hdl`, `.sel-card`, a button, or any element other than the canvas never starts a placement move.
2. A placement move needs a model hit and no selection with visible handles: `Select.selection()` empty, or `Select.handlesShown()` false (add that read-only export in `06b_select.js` of the tower and the Mid-Rise: it returns `handlesWanted()`). When an item is selected, a press on the model selects or edits; it does not move the building. The user clears the selection (Escape) to move the building.
3. `Store.gestureActive()` and `Select.dragging()` checks stay.
4. The rotation ring is a DOM element with its own listener; it is unchanged.

### 2.4 Tests

- `12k_tests_base.js` of the three tools gets a Pin group (append): pinned state round trip through the section; Pin hides the ring and blocks `begin("move")`; typed X still writes; open with a site → `view.siteStyle` glass; Pin → solid; Unpin → glass; one undo step per toggle.
- Tower and Mid-Rise `12j_tests_gizmo.js`: a synthetic pointerdown on a `.hdl` element over the model does not start a placement move (`PlacementGizmo.info().drag` null); with an item selected and handles shown, a press on the model does not move the placement.

## 3. Sun Study: sun tools only, darker shadows

### 3.1 Sun Study mode

The Sun section (`build/tower/08d_sun.js`) holds only sun controls today: mode, place, time zone, dates, times, play, the shadow sheet, sun hours, and the manual azimuth and altitude. The tower tools Cade sees are the Form, Program, and Site tabs around it. Rule: the Sun Study is the Tower opened in **study mode**.

- URL flag `?study=sun`. The Workspace Sun card (`index.html`, the `sun` card `href="tower/"`) links to `tower/?study=sun` and keeps `?project=` when a project is open (the card code already appends it for the other cards; check `openWith`).
- In study mode (`build/tower/13_start.js` reads the flag; `UI` gets `studyMode`):
  - the title reads "Sun Study" after the CMRLM mark; the browser title too;
  - the tab row shows **View** only (Form, Program, Site hidden); the View tab opens with the Sun section open and the Display and Context sections collapsed;
  - the selection, handles, and the placement gizmo are off (`Select.init` is skipped; `PlacementGizmo.init` gets `enabled: () => !UI.studyMode`);
  - the Export menu keeps Image, AI-ready image, Shadow study sheet, Project items; the SketchUp, DXF, and prompt items hide;
  - a top-bar link **Edit the tower** (`#tbEditTower`) opens the same URL without the flag.
- Outside study mode nothing changes.

### 3.2 Shadow strength

- One value `CONFIG.shadowStrength = 0.55` in `build/tower/01_config.js` (and the same key in the other five design tools' configs for the on-screen shadows; the sheet exists only in the Tower).
- `06_render.js` (tower): the flat shadow plane `ShadowMaterial.opacity` reads the config (was 0.24). The site ground receives shadows through its lit material; raise the contrast: `sun` light intensity 1.7 → 2.0 and `hemi` 2.3 → 1.6 while `view.shadows` is on and a shadow study or the sheet runs (a `shadowBoost(on)` function; the normal view keeps today's values so the model look does not change). The sheet (`10b_sunstudy.js`) calls `Render.shadowBoost(true)` before the first capture and `false` after.
- The other five tools: only the shadow plane opacity from their config.

**Tests.** `12g_tests_sun.js` (tower): make the sheet with the test fixture (a 100 ft tower, 12:00, summer); read a pixel in the shadow next to the tower base and a lit pixel on the ground; the shadowed luminance is below 0.7 × the lit one. `Render.shadowBoost` on and off restores the light intensities. `?study=sun` test (`12_tests.js`): tab row shows View only, no handles, the Edit the tower link has the right href.

## 4. Collapse all

- A **Collapse all** button at the top of the side panel (`#panelCollapse`, a small text button right of the tab row, in every design tool; in the Site Model at the top of the panel). It closes every section through `sectionCtl[id].setOpen(false)` and calls `rememberSection(id, false)` for each, so the choice sticks.
- Built in the shared part `build/shared/08z_topbar.js` (phase D; see section 5) because the same part owns the zoom buttons: `TopBar.init({ tool, sections: () => UI.sectionCtl, remember: UI.rememberSection })`. `08_ui.js` exports `rememberSection` (one line in the return, all six tools). The Site Model has no `sectionCtl`: its blocks (`build/site/04_ui.js` `block()`) get a `blocks` registry with `setOpen`; the Site Model's `06_start.js` passes it.

**Tests.** `12l_tests_sections.js` (each tool, append): Collapse all closes every section; prefs hold false for each; a reload keeps them closed.

## 5. Zoom buttons

- Two buttons in the top bar, before the view preset buttons: **Site** and **Building** (`#tbZoomSite`, `#tbZoomBuilding`, icons plus text, icon only under 900 px). In every tool (seven: the Site Model gets Site only, which is its existing Fit).
- **Site**: frames the whole site square (`SiteLayer.frameBounds()` / `frameBox` plus the ground z range) in the current camera direction. With no site it frames the model.
- **Building**: frames the model box (`Derived.get().bounds.model`, or the plate box in the Plate Planner, the buildings box in the Grading Sketch) with a 10% margin in the current direction. Never changes the direction, only the fit.
- `06_render.js` (all six design tools) gets two exports: `frameSite()` and `frameBuilding()`, both one-liners around the existing `viewTarget` with a box argument (`framingBox` today takes a preset id; add an internal `fitBox(box)` that keeps the camera direction and refits distance and target). Phase D owns these two exports plus `fitBox`; phase E owns `captureClean` in the same files.
- Hooks: `Render.framedBox("site")` and `("building")` for tests.

**Tests.** `12l_tests_sections.js` (append) or a new small group: Site gives a box equal to the site square; Building gives the model box plus 10%; neither changes the camera direction (compare the unit direction before and after within 0.001).

## 6. Trees off

- `build/site/01_config.js`: `trees: { generate: false, exports: true }`. `exports: true` means "when trees exist, export them"; with `generate: false` there are none. The switch for Cade's pending answer is only meaningful if `generate` turns on again later; keep it.
- `src/site/model.js` line 537: `buildTrees` runs only when `opts.trees !== false`; the pipeline (`build/site/02_pipeline.js`) passes `CONFIG.trees.generate`. The Site Model summary line (line 121) drops the tree count when generation is off.
- `build/site/04_ui.js`: the Trees layer toggle hides when `CONFIG.trees.generate` is false; the Site data row "Trees" hides; the DXF item text drops "trees".
- `src/site/derived.js`: `trees` is `[]` (unchanged code path). `src/site/exports.js`: the DXF `TREE` layer and the notes line "Trees: n" appear only when the model has trees; the credits line keeps "trees" out when none. `src/site/sketchup.js`: the Trees group is skipped when empty (check; it may already be).
- Readers (`src/shared/sitelayer.js`, the adapters): unchanged; they draw `trees: []` as nothing.
- Roadmap (`docs/suite-roadmap.md` section 8): "Trees from a map image: Cade gives a map image with real foliage; the tool places trees from it. Until then the Site Model makes no trees (`CONFIG.trees.generate`)."

**Tests.** Node `test/site.model.test.mjs`: `buildModel(…, { trees: false })` gives `trees: []`; the DXF has no `TREE` entities and the notes have no Trees line when the model has none. In-page `05_tests.js`: the Trees toggle is hidden; the synthetic model has no tree meshes; `siteDerived(...).trees` is `[]`.

## 7. Hero color in the AI-ready image

- `CONFIG.heroColor = "#E0A458"` (amber) and `CONFIG.heroColorName = "amber"` in the five tools with an AI-ready image (tower, midrise, parking, facade, grading).
- `captureClean` (each `06_render.js`): before the capture, every model mesh (`userData.model`, not context, not site) gets a temporary `MeshStandardMaterial` in the hero color with the same roughness; edges stay dark; after the capture the original materials return. The neighbors, the ground, the roads stay as drawn. `captureFlags()` reports `heroColor`.
- The Grading Sketch: the hero is every project building (massing and deck); the Facade Studio: the massing with its panels keeps its panel colors but the wall color becomes the hero color (so the AI still sees the systems).
- `src/tower/prompts.js`: the Hero render prompt gets `{{heroColor}}` (the color name) in the hero block: "The hero building is the {{heroColor}} volume. Render only that building in full photographic detail. Every white volume stays a white model." and in DO NOT INCLUDE: "any {{heroColor}} tint on the finished hero". `heroFor` is unchanged; the panel passes `heroColor: CONFIG.heroColorName` in the values (phase E edits the `autoValues` in the five `08b_prompts.js`: one line each, named here so phase D does not touch them — phase D has no file in this batch that overlaps).

**Tests.** Each tool's site test 5 (`12e_tests_site.js` and the tower/midrise equivalents): `captureFlags().heroColor` equals the config; during the capture the model mesh material color equals the hero color and after it the original color is back. The Hero prompt text contains "amber volume" (`12_tests.js` prompt tests).

## 8. Words (phase F)

- Help (`08e_help.js`, five tools): the Pin placement line (tower has no help panel: its study mode "Edit the tower" link and the Pin button get `title` text); the Site and Building zoom buttons; Collapse all; the Sun Study mode (midrise: none); the hero color in the AI-ready image; trees off.
- `index.html`: the Sun card links to study mode (phase C owns the href line; F owns the words): section 3 step 5 gets "Select Pin placement in the top bar when the building sits right. Unpin to move it again." and the Site/Building buttons get one line in step 4.
- `README.md` tool rows: "pin placement", "Sun Study mode", "zoom Site and Building", "collapse all"; the Site Model row drops "trees".
- `docs/suite-roadmap.md` section 8: the trees-from-a-map idea.
- `docs/project-file-spec.md`: `placement.pinned` note next to `baseMode`.

## 9. Integrator checks

1. `npm test` green.
2. Every `?test` one at a time (the tower suite takes about 100 s alone; never two browsers at once).
3. Cade's file (`/tmp/claude-0/-home-claude/978c7196-b767-5026-aeca-0d8ac302dd10/scratchpad/cade/cades.cmrlm.json`): open in the Tower → Glass on open, the tower visible; Pin → Solid, the ring gone, a synthetic drag does nothing; Unpin → Glass; open the Facade Studio → the crown level is there (his tower has a crown? check `state.crown.type`; if flat, use the point-tower preset with a screen crown); the AI-ready image shows an amber tower on a white site; the Hero prompt names amber; `tower/?study=sun&project=…` shows View only and no handles; the shadow sheet shows dark shadows.
4. The Site Model fixture makes no trees.
5. PR.

## 10. Phases and file ownership

Phases A to F run in parallel. No agent commits. Nobody edits a file another phase owns. Where two phases share a file, each edits only the named lines, re-reads the file right before every edit, and uses small exact-string edits.

| Phase | Model | Agent | Owns | Done when |
|---|---|---|---|---|
| A | Sonnet | Facade crown | `src/facade/faces.js`, `src/facade/panels.js`, `src/facade/metrics.js`; `build/facade/03a_state.js`, `08_ui.js` (zones section lines), `05c_facade3d.js`, `05_pipeline.js` (the HUD note); `test/facade.*.test.mjs`; one in-page test in `build/facade/12b_tests_ui.js` | Section 1 tests pass; `facade/?test` green |
| B | Sonnet | Pin, Glass on open, hit rule | `build/shared/06y_placement.js`; new `build/shared/08y_pin.js`; `build/tower/09b_project.js`, `build/midrise/09b_project.js`, `build/parking/09b_project.js` (openDoc, sectionPatch, pinned); the `placement.pinned` line of `03a_state.js` in those three; the `handlesShown` export line of `build/tower/06b_select.js` and `build/midrise/06b_select.js`; the `PinUI.init` and the gizmo `locked` lines of the three `13_start.js`; the `08y_pin.js` PARTS line of the three `build.py`; the offset-field `disabled` lines of `build/tower/08_ui.js` and `build/midrise/08_ui.js` (behind `CONFIG.pinLocksOffsets`); `CONFIG.pinLocksOffsets` line in the two `01_config.js`; tests appended to the three `12k_tests_base.js` and the two `12j_tests_gizmo.js` | Section 2.4 tests pass on the three pages |
| C | Sonnet | Sun Study mode, shadow strength | `build/tower/08d_sun.js`; `build/tower/10b_sunstudy.js`; the `studyMode` lines of `build/tower/08_ui.js` (tab row, title) and `build/tower/13_start.js` (the flag, `Select.init` skip; B owns the `PlacementGizmo.init` lines — C adds `enabled: () => !UI.studyMode` through the integrator if B has not); the `shadowStrength` and `shadowBoost` lines of `build/tower/06_render.js` (the `ShadowMaterial` line 145 and the light setup lines 120 to 130; E owns `captureClean`; D owns the framing exports); `CONFIG.shadowStrength` in the six `01_config.js` and the `ShadowMaterial.opacity` line in the other five `06_render.js`; the Sun card `href` in `index.html`; `12g_tests_sun.js` and the study-mode test in `build/tower/12_tests.js` | Section 3 tests pass; `tower/?test` green |
| D | Sonnet | Collapse all, zoom buttons | new `build/shared/08z_topbar.js`; the `tb-zoom` and `panelCollapse` markup lines of `body.html` in all seven tools; the `rememberSection` export line of the six `08_ui.js`; the `TopBar.init` line of the seven start parts; the `08z_topbar.js` PARTS line of the seven `build.py`; the `frameSite`, `frameBuilding`, `fitBox`, and `framedBox("site"\|"building")` lines of the six `06_render.js`; the Site Model `blocks` registry lines of `build/site/04_ui.js` and `06_start.js`; the button CSS in the seven `css_add.css` (append a block at the end); tests appended to `12l_tests_sections.js` (six) and `05_tests.js` (site) | Sections 4 and 5 tests pass on all seven pages |
| E | Sonnet | Hero color, trees off | the `captureClean` function body and `lastCapture.heroColor` of the five `06_render.js` (tower, midrise, parking, facade, grading); `CONFIG.heroColor` / `heroColorName` in the five `01_config.js`; `src/tower/prompts.js`; the `heroColor` value line of the five `08b_prompts.js` `autoValues`; `build/site/01_config.js` (`trees`), `02_pipeline.js`, the Trees lines of `build/site/04_ui.js`; `src/site/model.js` (the `opts.trees` guard), `src/site/exports.js`, `src/site/sketchup.js`; `test/site.model.test.mjs`, the trees lines of `build/site/05_tests.js`; the hero-color tests in the five site test files and the prompt tests in the five `12_tests.js` | Sections 6 and 7 tests pass |
| F | Haiku | Words | `08e_help.js` (five tools), the words of `index.html` section 3 (not the Sun card href), `README.md`, `docs/suite-roadmap.md` section 8, `docs/project-file-spec.md` | Reviewed by the integrator |
| G | Opus | Integrator (this session) | Rebuilds, `npm test`, every `?test`, section 9, the pending switches, the PR | Cade merges |

Shared files and their line owners:

| File | Lines | Owner |
|---|---|---|
| `build/tower/06_render.js` | `ShadowMaterial`, light setup, `shadowBoost` | C |
| | `frameSite`, `frameBuilding`, `fitBox`, `framedBox` | D |
| | `captureClean`, `lastCapture` | E |
| `build/{midrise,parking,facade,grading}/06_render.js` | `ShadowMaterial.opacity` | C |
| | framing exports | D |
| | `captureClean` | E |
| `build/plate/06_render.js` | framing exports | D |
| `build/tower/08_ui.js` | offset `disabled` lines | B |
| | `studyMode` tab-row and title lines | C |
| | `rememberSection` export line | D |
| `build/midrise/08_ui.js` | bar `x/y` `disabled` lines | B |
| | `rememberSection` export line | D |
| `build/{parking,facade,grading,plate}/08_ui.js` | `rememberSection` export line | D |
| `build/facade/08_ui.js` | zones section lines | A |
| `build/tower/13_start.js` | `PinUI.init`, gizmo `locked` | B |
| | `?study=sun` flag, `Select.init` skip | C |
| | `TopBar.init` | D |
| `build/{midrise,parking}/13_start.js` | `PinUI.init`, gizmo `locked` | B |
| | `TopBar.init` | D |
| `build/*/build.py` | `08y_pin.js` line (three) | B |
| | `08z_topbar.js` line (seven) | D |
| `build/*/01_config.js` | `pinLocksOffsets` (tower, midrise) | B |
| | `shadowStrength` (six) | C |
| | `heroColor`, `heroColorName` (five) | E |
| `build/site/01_config.js` | `trees` | E |
| `build/site/04_ui.js` | `blocks` registry | D |
| | Trees toggle and row | E |
| `build/site/05_tests.js` | block and zoom tests | D |
| | trees tests | E |
| `index.html` | Sun card `href` | C |
| | words | F |
| `build/*/12l_tests_sections.js` | append | D |
| `build/*/12e_tests_site.js` etc. | hero-color test | E |
| `build/{tower,midrise,parking}/12k_tests_base.js` | append | B |

## 11. Risks

| Risk | Response |
|---|---|
| Three phases edit `06_render.js` at once | Named function boundaries above; re-read before each edit; the integrator rebuilds last |
| The crown level breaks a facade fixture that counted levels | A updates the counts in the tests it owns; the standalone massing has no crown |
| Glass on open surprises a user who saved Solid | Only the session changes; the option keeps its saved style; Pin restores Solid |
| Study mode hides the Site tab, so Context from site is unreachable there | The Sun section gets a "Context from site" button (C: one line calling `ProjectUI.contextFromSite()`) |
| Hero color changes the Facade panel look in the AI-ready image | Only the wall color changes; panels keep their colors |
| Darker on-screen shadows change the model look | The boost applies only with the Sun Study shadows on or during the sheet |
