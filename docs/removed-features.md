# Removed and Hidden Features

Owner: Cade (CMRLM) · Started October 28, 2026

This list keeps every feature that the Design App removed or hid. Some features come back after they are refined. Nothing here is deleted from the code unless the "Code" column says so.

Rule for hidden Tower features: while hidden, a saved value has no effect on the model (`HIDDEN_FEATURES_OFF` in `app/tools/tower/state.js`). The value stays in the project file and works again when the feature comes back.

How to bring a feature back: find the comment "Hidden October 28, 2026" (or the file named in the table), undo the change, then test.

## Tools

| Item | Date | Why | Code | How to bring it back |
|---|---|---|---|---|
| Parking Deck tool (podium deck from the Parking program, screening Open/Solid/Mesh with openness, standalone deck) | October 28, 2026 | Keep the app simple for the demo | Kept in `app/tools/parking/` | `app/tools/registry.js`: set `ready: true` |
| Grading Sketch tool (pads, FFE, drives, walls, routes, cut and fill) | October 28, 2026 | Keep the app simple | Kept in `app/tools/grading/` | `app/tools/registry.js`: set `ready: true` |
| Tower base from the Grading floor elevation | October 28, 2026 | Grading is hidden | Kept (`app/tools/tower/project.js` `gradingFfe`) | Comes back with the Grading Sketch |
| Single tool cards on the Workspace page (Site Model, Massing, Plate Planner, Parking Deck, Sun Study, Grading Sketch, Model Viewer) | October 28, 2026 | Demo shows only the Design App | The old pages still work by URL | Restore the cards in `index.html` (git history, pull request #32) |
| "Open Plate Planner" link on unit cards | October 28, 2026 | No links out of the app | Removed from `app/core/shell-panels.js` and `app/tools/plates/index.js` | Git history, pull request #33 |

## Top bar and panels

| Item | Date | Why | Code | How to bring it back |
|---|---|---|---|---|
| Left tool dock | October 28, 2026 | Tools moved to the top bar | `app/core/dock.js` kept, unused | Not planned |
| "Layers" dock button | October 28, 2026 | Did the wrong thing; dock removed | — | Not planned |
| "Workspace page" item in the Project menu | October 28, 2026 | The CMRLM mark links there | Removed | Git history |
| Warnings panel | October 28, 2026 | Not useful yet | `buildWarnings` kept in `app/core/shell-panels.js` | Add `shell-warnings` back to `groups()` |
| Style control in the View panel | October 28, 2026 | Same as the top-bar Diagram button | Removed | Git history |
| Owner labels and counts under each layer | October 28, 2026 | Noise | Removed | Git history |
| Layer switches: Zoning envelope, Units, Cores and corridors, Context blocks | October 28, 2026 | Clutter | `listed: false` on the layer | Remove `listed: false` |
| Neighbor style in the Layers panel | October 28, 2026 | Moved to the top bar | — | — |
| Site file downloads (Revit CSV, DXF, SketchUp, Notes) and "Load again for downloads" | October 28, 2026 | Need a fresh site search and network | `HIDE_DOWNLOADS_FOR_DEMO` in `app/tools/site/index.js` | Set the flag to false |
| Site data count list and its style control | October 28, 2026 | Same as Metrics and the top bar | Removed | Git history |

## Tower Generator

| Item | Date | Why | Code | How to bring it back |
|---|---|---|---|---|
| Tower "View" panel | October 28, 2026 | Two panels named View; the app View panel owns the look | Snap and the envelope switch moved to "Editing" | — |
| Duplicate controls: second Option name, "Show the site neighbors as blocks", Save in the Options menu, Net area metric | October 28, 2026 | Duplicates | Removed | Git history |
| AI prompts beyond the first 6 | October 28, 2026 | Long list | Under "More prompts" (not removed) | — |
| Form moves (setbacks by floor and side, mechanical floors) | October 28, 2026 | Simplify | Section hidden; saved values stay in the file | Comment "Hidden October 28, 2026" in `app/tools/tower/panels.js` |
| Carves and cuts | October 28, 2026 | Simplify | Section hidden; saved values stay in the file | Same |
| Spire crown type | October 28, 2026 | Simplify | Not offered; a saved spire stays until changed | Same |
| Presets in the Options menu | October 28, 2026 | Simplify | Saved options stay | Same |
| Height limit and stepback | October 28, 2026 | Simplify | Section hidden | Same |
| Context blocks (Add block, Surround, Context from site) and the context layer | October 28, 2026 | The Site Model adds the context | Hidden; layer draws nothing | Same |
| Sun Study mode inside the Tower (sun hours map, ?study=sun page) | October 27, 2026 | Not in the app's first version | Old tower page only | The app View panel has "Create sun study" (October 28, 2026) |
| Compare view | October 27, 2026 | Cade: not needed now | Old tower page only | Not planned |

## Earlier

| Item | Date | Why |
|---|---|---|
| Mid-Rise Generator | October 27, 2026 | Not in the Design App |
| Facade Studio | October 26, 2026 | Facades vary too much to model well with the current tools |
| Model Viewer page | October 27, 2026 | The Design App view replaces it (old page still works by URL) |
