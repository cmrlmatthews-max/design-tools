# How a Tool Joins the App

This file is the brief for a builder who moves a tool into the app (`app/`). It also applies to every new tool later.

## 1. Read first

1. `docs/shell-plan.md`: decisions, layout, section 9 (core features per tool), section 7 (ground), section 8 (input).
2. `app/CONTRACT.md`: section 14 (tool module) and section 15 (what each core module really offers).
3. The core modules you call: `app/main.js` (how `ctx` is built and how tools load), `app/core/ui-kit.js` (`Controls`, `h`, `ICONS`, `Units`), `app/core/layers.js`, `app/core/derived.js` (how a section draws from `derived` today), `app/core/placement.js`, `app/core/input.js`, `app/core/scene.js`, `app/core/store.js`.
4. The old tool: `build/<tool>/*.js` (page layer) and `src/<tool>/*.js` (math). Port behavior, not code shape.

## 2. Rules

- Write only in `app/tools/<id>/`. Do not edit `app/core/`, `app/main.js`, `app/tools/registry.js`, `src/`, `build/`, or another tool folder. If you need a core change, say so in your final report and work around it inside your folder.
- Import the math from `src/` with relative paths (`../../../src/tower/geometry.js`). Never copy a `src/` module.
- Default export = the tool object of CONTRACT section 14. Keep `store` on the object (top-bar Undo and Redo use `tool.store`).
- One undo store per tool: `ctx.store(initialState)`. Live drags use `set(..., { live: true })`, then `commit()`.
- The tool writes only its own section through `ctx.project.write(sectionKey, { tool, schema: 1, placement, state, derived, note })`. Build `derived` with the existing `src/<tool>/derived.js` function, so the shape matches `docs/project-file-spec.md` section 6 byte for byte. Write after every committed change (the project store debounces).
- Read other sections only from `derived` (`ctx.project.section(key).derived`), never their `state`.
- On `init`, load the tool state from the project section `state` when it exists, else the default preset.
- Live layers: register them through `layers(ctx)`. Set `replaces: [<derived layer id>]` so the derived twin hides while your tool is loaded. Build geometry in the tool LOCAL frame and place the group with `ctx.frame.placeGroup(group, placement)`. Key the layer on your store version plus `ctx.scene.style()`.
- Mark meshes for picking with `userData.pick = (faceIndex, hit) => item`; item = `{ id, title, rows: [[label, text]], owner: '<id>' }`.
- Handles, outlines, snap guides: `ctx.scene.overlayRoot` or DOM elements in `#handles` (class `.hdl`, `.hdl.vertex`). Claim pointer gestures with `ctx.input.claim(handler, PRIORITY.HANDLES)` from `app/core/input.js`. Turn handles on in `activate`, off in `deactivate`.
- Keys: `ctx.keys.bind('<id>', combo, fn)`. Shell keys (1–6, D, Cmd+Z) already exist.
- Panels: `panels(ctx)` returns groups `{ id: '<id>-<name>', title, build(bodyEl), open }`. Build them with `ctx.ui.Controls` (call shapes as in `build/tower/07_controls.js`). Use `ctx.ui.Controls.create()` for a refresh registry of your own, and refresh it on every store change.
- Metrics and warnings: `metrics(ctx)` and `warnings(ctx)` feed the shell panels. Call `ctx.refreshHud()` after a change.
- Exports: `exports(ctx)` adds items to the top-bar Export menu (the shell already has Image and AI-ready image).
- Dark only. Use the classes in `app/shell.css`. Add a small `app/tools/<id>/tool.css` only if you must, loaded by your tool with a `<link>` on `init`; prefix every class with `<id>-`.
- Text in the UI: short, plain words, active voice. No "coming soon", "planned", or "beta" text anywhere.
- No page globals. `window.__app` exists for tests; you may add `window.__app.tools.<id>` test hooks.

## 3. Test

There is no iPad here, but there is a headless Chromium with WebGL.

- Harness: `/tmp/claude-0/-home-claude/6cdbbd3f-8411-5677-b0f5-9b9a10a680c1/scratchpad/tk/flow.mjs`. Copy it to your own scratch folder next to it (for example `tk/<id>-flow.mjs`) and run it from the `tk` folder so `node_modules` resolves. It serves the repo at `http://app.test/`, maps jsDelivr (three, clipper-lib) to local files, seeds `localStorage` with `test/viewer.fixture.json` (`seed.js`), and opens `app/?project=23ce5764-a7a6-46f2-8083-5c5ae010ec6e`.
- Drive it with `STEPS='[{"eval":"window.__app.activate(\"<id>\")"},{"shot":"open"}]' node <id>-flow.mjs <prefix> 1440 900` and read the PNG files. Use `834 1194 touch` for iPad portrait and `1194 834 touch` for iPad landscape.
- The page has no network beyond the repo and the two CDN libraries. Mock `fetch` in an init script when a tool needs outside data.
- Check at least: the tool activates with no console errors; its panels show; a field change redraws the model; the written section passes `validate` and has the spec shape; Undo works; the tool deactivates cleanly when another tool or none is active.
- `node --check` every file. `npm test` must stay green.

## 4. Final report

Under 600 words: files, core features done, features left out (and why), core changes you need, test results with the screenshots you looked at, open risks.
