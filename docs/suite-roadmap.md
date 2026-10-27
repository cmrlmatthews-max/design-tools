# Design Tools Suite — Roadmap and Working Rules

Version 1 · October 21, 2026 · Owner: Cade (CMRLM)

This file is the one place that lists every tool in the suite, who builds it, and the order. Both Claude sessions read it: the home session (this repo on GitHub) and the work session (a download of this repo).

## 1. Users and purpose

- Users: Cade and RJTR teammates. The tools support early design on multifamily, hospitality, office, and senior living projects.
- Every tool is one HTML file in the browser. It runs on a Mac and on an iPad. GitHub Pages hosts it.
- Units: feet and square feet only.
- Names: generic preset names only. No client names anywhere in the repo.

## 2. Tools and status

| Id | Tool | Folder | Status | Built by |
|---|---|---|---|---|
| `app` | Design App (unified shell) | `app/` | Phase 0 and Phase 1 built October 27, 2026: Site, Tower (with AI prompts), Parking, Grading in one 3D view; Plate Planner as a view-only layer. Opus review done, fixes in. Next: Cade's Mac and iPad test. Plan: `docs/shell-plan.md` | Home |
| `site` | Site Model | `site/` | Version 1 live. Remove existing buildings in review | Home |
| `tower` | Tower Generator | `tower/` | Version 1.2 built, in review (project file, Sun Study) | Home |
| `sun` | Sun Study (inside the Tower Generator) | `tower/` | Version 1 built, in review | Home |
| `plate` | Plate Planner | `plate/` | Version 1 built; rework (auto core, advisor, editing tools) October 24, 2026, in review | Home |
| — | Project file (`src/shared/project.js`), Workspace page, Site Model handoff | `index.html`, `src/shared/`, `site/` | Version 1 live | Home |
| `midrise` | Mid-Rise Generator | `midrise/` | Version 1 live | Home |
| `parking` | Parking Deck Generator | `parking/` | Version 1 live | Home |
| `facade` | Facade Studio | `facade/` | Hidden, October 26, 2026: facades vary too much to model well with the current tools. The code, the tests, and the saved `facade` section stay. The Workspace page, the Send menus, and the Model Viewer do not show it. | Home |
| `grading` | Grading Sketch | `grading/` | Version 1 live | Home |
| `viewer` | Model Viewer | `viewer/` | Built. Retires when the Design App reaches parity (`docs/shell-plan.md`) | Home |
| `view` | View Study | `view/` | Later | — |
| `egress` | Egress Sketch | `egress/` | Later | — |
| — | Yield Study | — | Skipped for now | — |
| — | Model Explorer | — | Skipped for now. Became the Model Viewer (October 25, 2026) | — |

Branch `site-base-style` (October 23, 2026): in progress, not merged. It adds the base elevation that follows the ground, the site style (Solid, Glass, Wireframe), the AI-ready image with the site and the Hero render prompt, and collapsed panel sections.

## 3. Shared parts

| Part | File | Rule |
|---|---|---|
| Project file | `docs/project-file-spec.md`, `src/shared/project.js` | One `name.cmrlm.json` carries every tool's section. Read the spec before any tool work. |
| Options storage | `src/shared/storage.js` | Saved options per tool. Unchanged. |
| Screenshots | `src/shared/screenshot.js` | Same image export in every tool. |
| SketchUp export | `src/shared/sketchup-format.js`, `sketchup/` | Same `.sketchup.json` format. |
| Sun position | `src/shared/solar.js` (home session, with the Sun Study) | API in the project-file spec, section on the `sun` section. |
| Look and controls | `build/tower/` parts | New tools copy the tower shell. Same tokens, top bar, tabs, CMRLM mark. |
| Site layer | `src/shared/sitelayer.js`, `build/shared/06x_sitelayer.js`, `build/shared/06y_placement.js` | Every tool draws the project site from `site.derived`. Drag placement only in the Tower Generator, the Mid-Rise Generator, and a standalone Parking Deck. The Grading Sketch keeps its own ground. |

## 4. Pipeline order

Site → Massing (Tower or Mid-Rise) → Plates → Parking → Sun → Grading → Model Viewer (every section in one model). Later: Egress Sketch. Hidden: Facade Studio (October 26, 2026; facades vary too much to model well with the current tools).

Each tool reads the sections before it and writes only its own section. The Workspace page (the menu page) shows the project and the tools in this order.

## 5. Working rules for two sessions

Caution: the work session cannot push to GitHub. It works on a download. Merge by hand, one tool folder at a time.

Caution: freeze from October 27, 2026 until the unified shell reaches parity (`docs/shell-plan.md`). The work session does not edit `site/`, `tower/`, `parking/`, `grading/`, `viewer/`, `build/`, or `src/` during this freeze. The Plate Planner (`plate/`) stays a separate tool and is outside the freeze only for work that does not change the `plate` section shape.

1. The home session pushes one branch per tool and opens a pull request. Cade merges it.
2. The work session downloads `main` after each merge, before it starts new work.
3. The work session keeps its changes inside the folders of the tool it builds. (The home session built the Plate Planner and the Sun Study in October 2026, so those folders now belong to the home session.)
4. The home session does not edit those folders while the work session has them open.
5. Both sessions write `derived` data in the exact shape of the project-file spec. A change to the spec goes through this repo first.
6. Every tool keeps the in-page `?test` suite and the module tests green before a merge.

## 6. Document map

| Document | Content |
|---|---|
| `docs/project-file-spec.md` | The shared project file and `project.js` contract |
| `docs/shell-plan.md` | The unified shell (one page, one 3D scene): decisions, contract, phases |
| `docs/ipad-drawing-ideas.md` | Ideas for direct drawing with the Apple Pencil |
| `docs/plate-planner-notes.md`, `docs/plate-planner-technical-plan.md`, `docs/plate-planner-rework-plan.md` | Plate Planner |
| `docs/mid-rise-generator-concept.md`, `docs/mid-rise-generator-technical-plan.md` | Mid-Rise Generator |
| `docs/parking-deck-concept.md`, `docs/parking-deck-technical-plan.md` | Parking Deck Generator |
| `docs/tower-generator-concept.md`, `docs/tower-generator-technical-plan.md`, `docs/v1.1-spec.md` | Tower Generator |
| `docs/site-tool-spec.md`, `docs/site-tool-tampa-comparison.md` | Site Model |
| `docs/sketchup-spec.md`, `docs/sketchup-install.md` | SketchUp export |
| `docs/module-contracts.md`, `docs/integration-notes.md` | Tower module contracts |

## 7. Build loop for each new tool

| Step | Model | Reason |
|---|---|---|
| Concept document | Opus | Trade-offs need judgment |
| Cade reviews and says go | Cade | Scope decisions are his |
| Technical plan and module contracts | Opus | Contracts prevent integration errors |
| Shell, controls, exports | Sonnet | Standard web and Three.js code |
| Core geometry module | Opus | Geometry errors hide well |
| Presets and test cases | Haiku | Repetitive work |
| Review of math and geometry | Opus | Finds calculation errors |
| Branch, pull request | Home session | Cade merges |
| Mac and iPad test | Cade | Only he can judge the feel |

## 8. Ideas saved for later

| Idea | Note | Added |
|---|---|---|
| First-visit tour | When a person first opens the Workspace page, show a short tour of the tools: one popup box with a few slides (what each tool does, the pipeline order, how to start a project). Show it once; a "Tour" link brings it back. | October 22, 2026 (Cade) |
| Tower help panel | The Tower Generator has no Help panel. The other five tools have one. Add it and place the Site paragraph there. | October 22, 2026 |
| Trees from a map image | Cade gives a map image with real foliage. The tool places trees from it. Until then the Site Model makes no trees (`CONFIG.trees.generate` is false). | October 23, 2026 (Cade) |

Status: not started. Trees are off in the Site Model until this idea ships.
