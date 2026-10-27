# app/core

These files are the shared core of the unified shell. Each tool in `app/tools/` uses them through `ctx`. No tool imports another tool. The exact APIs live in `app/CONTRACT.md`. Change a signature there first, then in code.

Four builders own the core. Each owns the contract sections in the table. The data files (`bus.js`, `store.js`, `project-store.js`) have no DOM or Three.js imports, so the Node tests in `test/app.*.test.mjs` run them directly (`npm run test:app`).

| File | Job | Contract section | Owner |
|---|---|---|---|
| `bus.js` | Event bus for the page (`project:open`, `section:<key>`, `notice`, ...) | 1 | Data builder |
| `store.js` | Undo and redo store per tool: dot paths, live gestures, 50 steps | 2 | Data builder |
| `project-store.js` | One open project: write own section, 1 s autosave, merge on save, reload from other pages | 3 | Data builder |
| `frame.js` | Plan to Three frame, scene shift, placement of tool groups | 4 | 3D builder |
| `scene.js` | Renderer, cameras, controls, lights, sun, grid, views, style | 5 | 3D builder |
| `input.js` | Pointer router: handles, gizmo, draw, tap, pen versus finger | 6 | 3D builder |
| `placement.js` | Move and rotate gizmo for a building on the site | 7 | 3D builder |
| `capture.js` | Image and AI-ready image | 8 | 3D builder |
| `layers.js` | Layer registry, merged meshes, picks, level cut | 9 | Layers builder |
| `derived.js` | Layers drawn from each section's `derived` | 10 | Layers builder |
| `ground.js` | Existing ground and the grading override | 11 | Layers builder |
| `sitelayer3d.js` | Site ground, buildings, roads, water | 12 | Layers builder |
| `ui-kit.js`, `dock.js`, `panels.js`, `keys.js` | Widgets, dock, panel stack, keys | 13 | UI builder |
