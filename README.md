# design-tools

A small toolkit of browser-based design tools for early-stage architectural work. Every tool is a single HTML file with no build step. Three.js is loaded from a public CDN (jsDelivr).

## Tools

| Tool | Path | Status |
|---|---|---|
| Menu page | `index.html` | Links to each tool |
| Tower Generator | `tower/index.html` | Version 1.2: project file (massing and sun sections, Send to Plate Planner, Facade Studio, Grading Sketch, context from site, placement), Sun Study (real sun by date and time, play, shadow study sheet, sun hours on the ground); from 1.1: click-to-select, 3D handles with snapping, copy segment, form controls, site envelope, live metrics, presets, saved options, compare view, screenshots, AI prompt library |
| Site Model | `site/index.html` | Version 1: type an address, see a 3D site from public map data (USGS ground, Overture buildings, roads, trees, water), download Revit CSV, DXF, SketchUp, and notes |
| Mid-Rise Generator | `midrise/index.html` | Version 1: garden, corridor, bar, courtyard, wrap, and podium buildings from straight bars; units estimate, parking required against provided, envelope, presets, saved options, compare view, SketchUp export, project file handoff |
| Parking Deck Generator | `parking/index.html` | Version 1: standalone, wrap, and podium decks; 90-degree two-way bays; single helix, double helix, speed ramp, split-level, and sloped floor; long or short span; accessible, EV, and bike counts; slope, clear height, and barrier checks; column overlay against the unit walls; DXF, SketchUp, stall CSV, project file |
| Facade Studio | `facade/index.html` | Version 1: punched windows, window wall, curtain wall, storefront, and solid systems by zone and orientation on any project massing or a standalone shape; balconies, fins, shades, bands, glass corners; window-to-wall ratio by orientation, ground transparency, envelope note, sun exposure; four-sheet elevation DXF, SketchUp, AI-ready images, project file |
| Plate Planner | `plate/index.html` | Version 1: counted test fit of every floor plate of a project massing, or a drawn plate; bar, L, U, courtyard, and point plates; multifamily mix or hotel keys (a suite is one key and two bays); corridor, stairs at corridor ends, core, corner units, pockets; drag bay lines, lock, re-fill; net rentable area (to the corridor face and the inside face of the exterior wall) and efficiency by level; rooms CSV, DXF, SketchUp, notes; project file; Send to Parking Deck and Facade Studio |
| Grading Sketch | `grading/index.html` | Version 1: buildings and decks on the Site Model ground or a typed plane; balanced or typed finished floor elevations, tiers and stepping suggestions; pads, drives, lots, routes, drawn, pad-step, and automatic walls; daylight slopes; cut and fill in cubic yards, wall heights, accessible route slopes; Revit CSV toposolid, DXF contours, SketchUp, notes; project file. A sketch for early coordination with the civil engineer, never a grading plan |

## Suite

The toolkit grows into a suite that shares one project file (`name.cmrlm.json`). Start with `docs/suite-roadmap.md` (tools, order, who builds what) and `docs/project-file-spec.md` (the shared file and `src/shared/project.js`). Planned next: View Study, Egress Sketch.

## SketchUp

Both tools export a `.sketchup.json` file. Install the extension `dist/cmrlm-design-tools.rbz` in SketchUp Pro 2021 or later, then use Extensions > CMRLM > Import Design Tools file. Steps: `docs/sketchup-install.md`.

## Folders

| Folder | Contents |
|---|---|
| `tower/` | The finished tool. Do not edit `index.html` by hand. |
| `site/` | The Site Model tool. Do not edit `index.html` by hand. |
| `plate/` | The Plate Planner. Do not edit `index.html` by hand. Rebuild with `python3 build/plate/build.py` (or `npm run build:plate`). |
| `grading/` | The Grading Sketch. Do not edit `index.html` by hand. Rebuild with `python3 build/grading/build.py` (or `npm run build:grading`). |
| `facade/` | The Facade Studio. Do not edit `index.html` by hand. Rebuild with `python3 build/facade/build.py` (or `npm run build:facade`). |
| `parking/` | The Parking Deck Generator. Do not edit `index.html` by hand. Rebuild with `python3 build/parking/build.py` (or `npm run build:parking`). |
| `midrise/` | The Mid-Rise Generator. Do not edit `index.html` by hand. Rebuild with `python3 build/midrise/build.py` (or `npm run build:midrise`). |
| `build/tower/` | Source parts. Edit these, then run `python3 build/tower/build.py` (or `npm run build:tower`) to rebuild `tower/index.html`. |
| `build/site/` | Source parts for the Site Model. Edit these, then run `python3 build/site/build.py` (or `npm run build:site`) to rebuild `site/index.html`. |
| `src/` | Tested modules. `src/tower/` (geometry, envelope, presets, test cases), `src/site/` (geo, geocode, pmtiles, mvt, tiff, model, exports), `src/shared/` (storage, screenshot). |
| `test/` | Module tests. Run `npm install`, then `npm test`. |
| `docs/` | Suite roadmap, project-file spec, concepts, technical plans, module contracts, integration notes. |

Open `tower/index.html?test` or `site/index.html?test` to run the in-page test suites.

Site Model module tests: `npm run test:site` (readers: geo, geocode, pmtiles, mvt, tiff) and `npm run test:model` (ground, buildings, roads, trees, water, exports). Both need `npm install` first (they use clipper-lib). The Site Model reads public data from the internet (Nominatim, USGS, Overture), so it needs a connection.

## Host on GitHub Pages

1. Push this repository to GitHub (for example `design-tools`).
2. Open the repository on GitHub: Settings, then Pages.
3. Under "Build and deployment", set Source to "Deploy from a branch", choose the `main` branch and the `/ (root)` folder, then Save.
4. After a minute the site is live at `https://<your-user>.github.io/design-tools/`. The tower generator is at `https://<your-user>.github.io/design-tools/tower/` and the site model is at `https://<your-user>.github.io/design-tools/site/`.

On an iPad, open the tower URL in Safari, tap Share, then "Add to Home Screen" to use it like an app.

## Run locally

Browsers block ES modules from `file://` in some cases. Serve the folder instead:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.
