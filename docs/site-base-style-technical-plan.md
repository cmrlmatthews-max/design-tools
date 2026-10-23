# Base Elevation, Site Style, AI-Ready Site, Prompt Cleanup — Technical Plan

Version 1 · October 23, 2026 · Branch `site-base-style` · Owner: Cade (CMRLM)

Four asks from Cade, after the site layer merged (#13, #15, #16, #17):

1. The base elevation follows the ground under the building footprint.
2. A site style toggle: Solid, Glass, Wireframe. Neighbor buildings only.
3. The AI-ready image shows the site. A standard "Hero render" prompt in every prompt library.
4. The prompt panel loses its redundant controls. Every panel section starts collapsed.

Style for every line of text this plan adds: ASD-STE100 (short sentences, active voice, one instruction per sentence).

## 1. Base elevation follows the ground

### 1.1 The problem

Cade moved his tower 1,495 ft east and 1,388 ft north with the segment offset. The placement origin stayed at the site center. `placement.baseZ` stayed at 0 while the real ground is about 1,000 ft NAVD88. The site ground drew 1,000 ft above the tower base.

Today `baseZ` changes in three places only: `centerOnSite`, the gizmo release (`06y_placement.js`), and the first open of a project with a site. All three sample the ground at ONE point (the site center or the placement origin), never under the footprint.

### 1.2 The rule

The base elevation is the LOWEST ground under the building footprint, so the ground floor never sits below grade on a slope.

- Footprint: the plan box of the model in the tool frame (`Derived.get().bounds.model` in all three tools: Tower, Mid-Rise, Parking). The box is enough; the fill shrinks it by nothing. Sample a 9 × 9 grid of points over the box, transformed to the project frame with `ProjectMod.toProject(placement, p)` (the tool's existing transform helper), each through `SiteLayerMod.groundZAt(siteDerived, xp, yp)`. Take the minimum. Round to 0.1 ft.
- Without a site grid the base does not change.
- Mode: `placement.baseMode` is `'follow'` (default) or `'typed'`.
  - `follow`: the tool sets `baseZ` by the rule every time the footprint moves.
  - `typed`: the user sets `baseZ`. The tool never changes it.
- Migration: an existing save gets `baseMode: 'follow'`. Nobody typed a base on purpose before this change, because the field never worked against the footprint. `fillDefaults` adds the key; no schema bump.

### 1.3 When it runs

One function per tool in `09b_project.js`:

```js
/** The lowest ground under the model footprint (project frame, ft NAVD88), or null without a site grid. */
function groundUnderFootprint(placement = placement(), bounds = Derived.get().bounds.model)
/** Sets placement.baseZ by the rule when baseMode is 'follow' and a site is open. opts.merge: no new undo step. Returns true when it changed. */
function followGround(opts = {})
```

`followGround` runs from the existing `Store.subscribe` hook in `09b_project.js` (the one that re-runs Context from site):

- on any committed change whose path starts with `placement` (x, y, rotation), `segments`, `podium`, `bars`, `courts`, `deck`, `shape`, `cuts`, `carves`, `setbacks` (the Tower's form moves), or `layout` (Parking standalone): the keys that move the footprint. The agent lists the exact keys per tool from each tool's `defaultState`.
- after `centerOnSite`, after `contextFromSite`, after a project opens with a site, and after a new site section arrives (`reloadData`).
- Never during a live gesture (`Store.gestureActive()`); the gizmo already snaps on release. The gizmo release calls the tool's `followGround` through `opts.onCommit` when `baseMode === 'follow'`, instead of its own single-point `groundZ`. With `baseMode === 'typed'` the gizmo leaves `baseZ` alone.
- The change joins the same undo step as the move (`merge: true`).

Context from site keeps following (it already does on `placement` changes); it now also follows the footprint keys above, because the neighbors' `base` is relative to `baseZ`.

### 1.4 The control

Site tab, the project placement section, replacing the single "Base elevation (ground floor, ft)" field:

```
Base elevation          [Follow ground] [Typed]
Ground floor at 1,016.9 ft above sea level.          (follow: read-only line)
Base elevation (ft)     [ 1,016.9 ]                   (typed: the existing lenF field)
```

- Chips bound to `placement.baseMode`. Switching to Typed keeps the current value. Switching to Follow runs `followGround` once.
- The help line under it: "Follow ground sets the base to the lowest ground under the building. Typed keeps the value you enter."
- Parking: the control appears only for a standalone deck (a wrap or podium deck follows its massing).

### 1.5 Tests (per tool: Tower, Mid-Rise, Parking standalone)

1. A project with a sloped site opens: `baseZ` equals the lowest ground under the footprint, not the ground at the origin (fixture: the sloped 11 × 11 grid the site tests already use; the difference is at least 1 ft).
2. A segment offset (Tower) / a bar move (Mid-Rise) / a layout change (Parking) moves the footprint: `baseZ` follows in the same undo step.
3. Typed mode: the same move leaves `baseZ` alone; switching back to Follow sets it.
4. The gizmo release in Follow mode uses the footprint rule (compare with `groundUnderFootprint`).
5. An old save without `baseMode` loads as `follow`.
6. Context blocks keep their `base` relative to the new `baseZ`.

## 2. Site style toggle

### 2.1 Behavior

`view.siteStyle`: `'solid'` (default) | `'glass'` | `'wireframe'`. Only the neighbor buildings change. Ground, roads, walks, water, trees, boundary, and the arrow stay as drawn.

| Style | Faces | Edges |
|---|---|---|
| solid | opaque, as today | dark edges, as today |
| glass | `transparent: true, opacity: 0.25, depthWrite: false`, same color | edges at full opacity |
| wireframe | no face mesh | edges only (`EdgesGeometry` lines, the existing material) |

Glass draws after the ground: `renderOrder` 2 on the glass mesh, 3 on its edges; the ground and roads keep 0 and 1. With `depthWrite` off, two glass neighbors overlap softly, which is the intent.

### 2.2 Code

- `build/shared/06x_sitelayer.js`: `SiteLayer3D.objects(data, opts)` reads `opts.style` and builds the buildings kind accordingly. `keyFor(doc, placement, show, themeEpoch)` gains a fifth argument `style` folded into the key string, so a style change rebuilds the layer.
- Each tool's `build/<tool>/06c_site.js` passes `state.view.siteStyle` and includes it in the key. The Grading adapter too (it draws neighbors through the same part).
- `03a_state.js` (all seven): `view.siteStyle = 'solid'` in `defaultState`, and `fillDefaults` maps a missing or unknown value to `'solid'`.
- View tab (all seven): a chips row "Site style" with Solid / Glass / Wireframe, placed right under the Site toggle; shown only while the Site toggle is on (`Controls.when`).
- The Mid-Rise, Facade, and Plate massing ghosts (their own context) are not touched.
- The tip and tour copy do not change.

### 2.3 Tests (one per tool, in the existing site test file)

With a site project open: `siteStyle` glass → the buildings mesh material is transparent at 0.25 and the edge set stays; wireframe → no buildings mesh, edges stay; back to solid → opaque. The info object gains `style`. The layer key changes with the style.

## 3. The AI-ready image shows the site; the Hero render prompt

### 3.1 Capture

Today `Render.captureClean` (every tool's `06_render.js`) rebuilds the model and context into a capture group and hides the site layer (`layers.site.group.visible = false` in `prev`/the capture). Change, in all seven tools:

- The site layer stays visible as drawn, in its current style (Solid is the normal case and the prompt assumes white volumes with edges).
- Hidden: the overlay (handles, labels, selection), the grid, the scale figure, the envelope, the sun gizmo, the boundary dash and the north arrow (`userData.kind` `site-boundary` and `site-arrow`), the placement gizmo DOM layer (already outside the canvas), toasts.
- Kept: the model (hero), the context blocks that are not `site: true` (manual blocks), the site ground, roads, walks, water, trees, and the neighbors with edges.
- Background: the light plain sky as today. Shadows follow the view setting.
- The tower's `10_screenshot.js` `aiReady()` and the other tools' equivalents need no change beyond the capture.
- The removed buildings are already out of the layer.

### 3.2 The Hero render prompt

Cade's reference (his own prompt, a dusk render of a twisting tower on a white model) is at `/tmp/claude-0/-home-claude/978c7196-b767-5026-aeca-0d8ac302dd10/scratchpad/hero-prompt.md` and `hero-reference.png`. The standard prompt keeps its structure:

```
Edit the attached massing model image. Do not regenerate the scene from scratch.

KEEP EXACTLY AS SHOWN
* The camera angle, perspective, framing, and horizon line.
* The footprint, height, rotation, and position of every building.
* The road layout, block shapes, and site boundary.
Do not add, remove, move, stretch, or reshape any volume.

HERO BUILDING — RENDER PHOTOREAL
{{hero}}
* The facade is {{material}}.
* Slab edges read as dark horizontal lines between floors.
* Interior lights are on in most rooms, in varied warm and neutral tones. Each floor reads as its own band of light.

CONTEXT BUILDINGS — KEEP AS WHITE MODEL
Render every other building as an opaque matte white volume.
* No windows. No glazing. No texture. No signage. No material.
* Keep crisp clean edges and soft grey shadows.

GROUND PLANE — RENDER PHOTOREAL
Render the ground and everything on it with real materials.
* Asphalt roads with lane markings and crosswalks. Concrete sidewalks and curbs.
* Parked and moving cars. Street trees {{season}}. Pedestrians at small scale. Streetlights on after dusk.

RULE
Vertical building volumes stay matte white. The ground plane and the objects on it become real. The hero building is the only building that becomes real.

LIGHT AND SKY
{{time}}

CAMERA
Architectural visualization quality. Vertical lines stay straight. Clean blacks. Sharp focus across the frame.

DO NOT INCLUDE
Text, logos, watermarks, building signage, neon colors, fisheye distortion, tilt-shift blur, cartoon or illustration style, windows on the white volumes.
```

- `{{hero}}` comes from the state, one tool each (the agent writes the sentences in `src/tower/prompts.js` helpers or the tool's `08b_prompts.js` `autoValues`):
  - Tower: "The hero building is the {{form}} tower at the center of the image. Height about {{height}}. {{floors}} floors, {{crown}}. {{twist}}" where twist reads "Each floor plate rotates slightly from the floor below. Keep the twist exactly as the massing shows it." only when the twist is not 0; taper the same way; program from the segments.
  - Mid-Rise: "The hero building is the {{floors}}-story {{layout}} building (bars, courtyard, podium) at the center."
  - Parking: "The hero building is the {{levels}}-level parking deck at the center, with open sides and a {{ramp}} ramp."
  - Facade: the Tower or Mid-Rise hero sentence from the massing, plus one line per zone from the facade systems in place of `{{material}}`.
  - Grading: "The hero building is the building on the graded pad at the center. Show the pads, the walls, and the slopes as graded."
- `{{material}}`, `{{time}}`, `{{season}}` are the existing fields. The reference's dusk text becomes the `time` option "Dusk, deep blue sky".
- The prompt is `id: 'hero-render'`, `group: 'hero'`, first in every library. It cannot be deleted. Duplicate to edit works as for every other prompt.
- The description line: "The hero building photoreal, the context as a white model, the ground real. Cade's standard."

### 3.3 Tests

- Capture: in every tool, `captureClean` with a site project open keeps `layers.site.group.visible === true` during the capture and hides the boundary and the arrow; a `Render.captureFlags()` hook returns what was visible at capture time (`{ site, boundary, arrow, grid, figure, overlay }`). One test per tool.
- Prompt: the Hero render is the first prompt; `fillPrompt` on the tower fixture (a twisted tower) contains "rotates slightly" and the height; without twist it does not; the material field substitutes.

## 4. Prompt panel cleanup and collapsed sections

### 4.1 The redundancy

The panel has group tabs across the top (Time, Material, Context, Camera, My prompts), a card list per group, then a "Choose" block with `select` dropdowns for the same fields (material, context, time). Cade reads this as the same control twice.

### 4.2 The new layout (one shape for all five tools)

```
AI PROMPTS                                        [×]
1. Save AI-ready image          2. Copy prompt
──────────────────────────────────────────────────
Prompt     [Hero render] [Golden hour] [Night] [Overcast] … [My prompts ▾]
Time       [Dusk] [Golden hour] [Noon] [Night] [Overcast]
Material   [Fritted glass] [Curtain wall] [Precast] [Terracotta] [Metal] [Brick] [Timber]
Context    [White model] [Light gray blocks] [Real city] [None]
Camera     [As shown] [Eye level] [Aerial] [Elevation]
──────────────────────────────────────────────────
From your design   floors · height · program · podium · form   (chips, read-only)
Preview            (textarea, selectable)                 [Duplicate to edit]
```

- The group tabs go. Every built-in prompt is one chip in the Prompt row (Hero render first, then the former Time/Material/Context/Camera prompts in that order). The Prompt row wraps.
- The field rows are chips, not dropdowns (`Controls.chips` style, the same look as the Site style row). A row appears only when the selected prompt uses that field. For the Hero render every row appears.
- My prompts: a chip at the end of the Prompt row opens the custom list with New / Edit / Delete, as today.
- "Copy with image" is out of scope (the browser cannot put an image and text on the clipboard together on iPad); the two steps stay.
- Field choices are remembered per prompt as today (`rememberField`).

### 4.3 Collapsed sections

- Every `SECTIONS` entry in every tool's `08_ui.js` gets `open: false` (63 entries today read `open: true`). The first section of the first tab is also collapsed: Cade asked for all.
- The open state is already remembered per tool and section in the UI prefs (`prefs.sections`, `rememberSection`, saved in localStorage under the tool's prefs key). Nothing new to build there; the plan only changes the defaults. The agent confirms the key name per tool in the report.
- The Site Model panel has no accordion. Its blocks (Location, Layers, View, Site data, Removed buildings, Remove buildings help) become `details` blocks with a header button, all collapsed except Location (the address field must show, or a new user cannot start). State remembered in `cmrlm.site.sections`.
- The selection cards, the HUD, the first tip, and the Compare bar are not sections.
- The "More" blocks inside a section stay as they are.

### 4.4 Tests to touch

In-page tests that read or click a control inside a section assume it is open. `Controls.section` keeps the control in the DOM when collapsed (the body is `hidden` by CSS, not removed), so value tests still pass. Click-based tests need the section open:

- `build/tower/12b_tests_layout.js`, `12c_tests_select.js`, `12d_tests_new.js`, `12f_tests_project.js`, `12h_tests_nosite.js`, `12i_tests_site.js`, `12j_tests_gizmo.js`
- `build/midrise/12b_tests_ui.js`, `12c_tests_select.js`, `12d_tests_project.js`, `12e_tests_nosite.js`, `12f_tests_site.js`
- `build/parking/12b_tests_ui.js`, `12d_tests_project.js`, `12e_tests_site.js`
- `build/facade/12b_tests_ui.js`, `12d_tests_project.js`, `12e_tests_site.js`
- `build/plate/12b_tests_ui.js`, `12c_tests_select.js`, `12d_tests_project.js`, `12e_tests_site.js`
- `build/grading/12b_tests_ui.js`, `12d_tests_project.js`, `12e_tests_site.js`
- `build/site/05_tests.js` (the Layers toggles and the Removed line)

The agent adds one helper per tool in `TestHelp`: `openSection(id)` (calls `UI.sectionCtl[id].setOpen(true)`; the Tower exposes `sectionCtl` through `UI` already; the others get the same one-line export). Each test file calls it in its setup for the sections it touches. New tests: every section starts collapsed on a fresh profile; a remembered open section comes back open; the Site Model blocks collapse and remember.

## 5. Help and docs (phase E)

- Help panels (midrise, parking, facade, plate, grading `08e_help.js`): one sentence each for Base elevation (Follow ground / Typed), Site style, the AI-ready image with the site, and the collapsed sections ("Select a section title to open it."). The Tower and the Site Model have no help panel.
- `docs/project-file-spec.md` placement: `baseMode` is an optional key; readers ignore it.
- `index.html` How projects work, section 3: "The base elevation follows the lowest ground under the building. Select Typed in the Site tab to set it yourself." and the Site style line.
- `README.md` rows: "site style", "Hero render prompt".
- `docs/suite-roadmap.md`: status line.

## 6. Order and merge

Phases A to E run in parallel. B touches the shared layer; C touches `06_render.js`; they do not overlap. A and B both edit `03a_state.js` and `08_ui.js` in the Tower, Mid-Rise, and Parking: A edits only the placement lines (state) and the Site tab lines (UI); B edits only the `view.siteStyle` line (state) and the View tab lines (UI). D edits `08_ui.js` too, for `open: true` → `open: false` only; D makes that one mechanical change FIRST (within its first minutes) and tells the integrator, so A and B pull it before they edit. The integrator rebuilds once all land.

## 7. Risks

| Risk | Response |
|---|---|
| Follow ground fights a Grading Sketch FFE | The Grading Sketch reads `grading.derived.ffe` and the massing keeps `baseZ`; the Tower's `gradingFfe()` note stays. Follow ground is the massing tool's own base; the Grading Sketch may set a different FFE on the pad. The help says so. |
| Glass neighbors sort badly against the model | Render order after the ground; `depthWrite` off; the hero model draws with depth as today, so it shows through the glass correctly. |
| The AI-ready image is now busy for image AIs | The prompt names the hero and the white model rule; Cade's reference shows this works. Solid style is the assumed input; the help says to use Solid for the AI-ready image. |
| All sections collapsed confuses a first-time user | The first tip and the tour say "Select a section title to open it." The state is remembered, so it is a one-time cost. |
| Collapsed sections break click tests | Section 4.4; `openSection` in setup. |

## 8. Phases and file ownership

| Phase | Model | Agent | Owns | Done when |
|---|---|---|---|---|
| A | Sonnet | Base elevation | `build/tower/09b_project.js`, `build/midrise/09b_project.js`, `build/parking/09b_project.js`; the placement lines of `03a_state.js` and the Site tab lines of `08_ui.js` in those three tools; `build/shared/06y_placement.js`; new `12k_tests_base.js` in the three tools | Section 1.5 passes on the three pages |
| B | Sonnet | Site style | `build/shared/06x_sitelayer.js`; `build/<tool>/06c_site.js` (all seven); the `view.siteStyle` line of `03a_state.js` and the View tab lines of `08_ui.js` (all seven); section 2.3 tests appended to each tool's existing site test file (`12i_tests_site.js` tower, `12f_tests_site.js` midrise, `12e_tests_site.js` the rest, `05_tests.js` site) | Section 2.3 passes on all seven pages |
| C | Sonnet | AI-ready site and Hero prompt | `build/<tool>/06_render.js` (all seven: `captureClean` and the `captureFlags` hook); `src/tower/prompts.js` (the Hero prompt, the Dusk time option, the hero helpers); `build/<tool>/10_screenshot.js` (if a change is needed); section 3.3 tests in the tools' existing screenshot or prompt test files (`build/tower/12d_tests_new.js` holds the prompt tests; the agent names the others) | Section 3.3 passes; one AI-ready image per tool saved in the scratchpad with a site project open |
| D | Sonnet | Prompt panel and collapsed sections | `build/<tool>/08b_prompts.js` (all five: the panel UI; the TEXT of built-in prompts is C's in `src/tower/prompts.js`); `build/<tool>/07_controls.js` (if `chips` needs an option); the `open:` values in `08_ui.js` (all six; the mechanical change first); `build/site/04_ui.js`, `body.html`, `css_add.css` (the Site Model blocks); the section 4.4 test files and the `openSection` helper; new `12l_tests_sections.js` per tool | Every page's `?test` passes; a screenshot of the new prompt panel and of a collapsed panel |
| E | Haiku | Words | Section 5 files (`08e_help.js` of five tools, spec, `index.html`, `README.md`, roadmap) | Reviewed by the integrator |
| F | Opus | Integrator (this session) | Rebuilds, `npm test`, every `?test` one at a time, the real check with Cade's file (`/tmp/claude-0/-home-claude/978c7196-b767-5026-aeca-0d8ac302dd10/scratchpad/cade/cades.cmrlm.json`: open in the Tower; the base must land on the ground under the offset segment; make the AI-ready image and look at it; try Glass and Wireframe), the PR | Cade merges |

Rules: nobody edits a file another phase owns; a needed line goes through the integrator; no agent commits. Where A and B share `03a_state.js` and `08_ui.js`, each edits only the lines section 6 names and re-reads the file before each edit.
