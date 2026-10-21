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
| `site` | Site Model | `site/` | Version 1 live | Home |
| `tower` | Tower Generator | `tower/` | Version 1.1 live | Home |
| `sun` | Sun Study (inside the Tower Generator) | `tower/` | In work | Work |
| `plate` | Plate Planner | `plate/` | In work | Work |
| — | Project file (`src/shared/project.js`), Workspace page, Site Model handoff | `index.html`, `src/shared/`, `site/` | Version 1 live | Home |
| `midrise` | Mid-Rise Generator | `midrise/` | Version 1 built, in review | Home |
| `parking` | Parking Deck Generator | `parking/` | Concept written, waiting on Cade | Home |
| `facade` | Facade Studio | `facade/` | Queued after Parking | Home |
| `grading` | Grading Sketch | `grading/` | Queued after Facade | Home |
| `view` | View Study | `view/` | Later | — |
| `egress` | Egress Sketch | `egress/` | Later | — |
| — | Yield Study | — | Skipped for now | — |
| — | Model Explorer | — | Skipped for now | — |

## 3. Shared parts

| Part | File | Rule |
|---|---|---|
| Project file | `docs/project-file-spec.md`, `src/shared/project.js` | One `name.cmrlm.json` carries every tool's section. Read the spec before any tool work. |
| Options storage | `src/shared/storage.js` | Saved options per tool. Unchanged. |
| Screenshots | `src/shared/screenshot.js` | Same image export in every tool. |
| SketchUp export | `src/shared/sketchup-format.js`, `sketchup/` | Same `.sketchup.json` format. |
| Sun position | `src/shared/solar.js` (to be written by the work session) | API in the project-file spec, section on the `sun` section. |
| Look and controls | `build/tower/` parts | New tools copy the tower shell. Same tokens, top bar, tabs, CMRLM mark. |

## 4. Pipeline order

Site → Massing (Tower or Mid-Rise) → Plates → Parking → Facade → Sun → Grading → Egress.

Each tool reads the sections before it and writes only its own section. The Workspace page (the menu page) shows the project and the tools in this order.

## 5. Working rules for two sessions

Caution: the work session cannot push to GitHub. It works on a download. Merge by hand, one tool folder at a time.

1. The home session pushes one branch per tool and opens a pull request. Cade merges it.
2. The work session downloads `main` after each merge, before it starts new work.
3. The work session keeps its changes inside its own folders: `plate/`, `build/plate/`, `src/plate/`, `test/plate*`, and the tower files it owns for the Sun Study (`build/tower/`, `src/tower/`, `src/shared/solar.js`).
4. The home session does not edit those folders while the work session has them open.
5. Both sessions write `derived` data in the exact shape of the project-file spec. A change to the spec goes through this repo first.
6. Every tool keeps the in-page `?test` suite and the module tests green before a merge.

## 6. Document map

| Document | Content |
|---|---|
| `docs/project-file-spec.md` | The shared project file and `project.js` contract |
| `docs/plate-planner-notes.md` | Design notes for the Plate Planner (work session) |
| `docs/mid-rise-generator-concept.md`, `docs/mid-rise-generator-technical-plan.md` | Mid-Rise Generator |
| `docs/parking-deck-concept.md` | Concept for the Parking Deck Generator (home session, next) |
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
