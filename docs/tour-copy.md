# First-Visit Tour: Copy

Version 1 · October 22, 2026 · Owner: Cade (CMRLM) · Phase D

Phase A pastes the five slides. Phase B pastes the seven tool tips. Paste each cell exactly as written. Each Body row is one array item in `TOUR_SLIDES`.

Rules used: sentences of 20 words or fewer. One instruction per sentence. Active voice, simple present. No contractions. Define "project" on slide 1 and "massing" on slide 3. Button and tab names match the pages (see the last section).

## Workspace tour

### Slide 1

| Field | Copy |
|---|---|
| Kicker | 1 of 5 |
| Title | Welcome to the Design Tools |
| Body 1 | The Design Tools help you test early building designs in a web browser. |
| Body 2 | A project is one file that holds the work of every tool for one design study. |
| Body 3 | Projects stay on this device only, so select Export to keep a copy. |
| Image alt text | The Workspace page, with a project schedule that lists two projects. |
| Caption | The Workspace page with two projects in the project schedule. |
| Picture | `assets/tour/01-workspace.jpg` |

### Slide 2

| Field | Copy |
|---|---|
| Kicker | 2 of 5 |
| Title | One project, in order |
| Body 1 | Each tool reads the parts that come before it and writes its own part. |
| Body 2 | The order is Site Model, Tower or Mid-Rise Generator, Plate Planner, Parking Deck, Facade Studio, Sun Study, and Grading Sketch. |
| Body 3 | The Tools list on this page uses the same order. |
| Image alt text | The Tools list on the Workspace page, with numbered cards for each tool in order. |
| Caption | The Tools list on the Workspace page, cards 1 to 8. |
| Picture | `assets/tour/02-pipeline.jpg` |

### Slide 3

| Field | Copy |
|---|---|
| Kicker | 3 of 5 |
| Title | Start with the site |
| Body 1 | The Site Model builds a 3D site from an address and public map data. |
| Body 2 | Select Send to Tower Generator or Send to Mid-Rise Generator. Massing is the 3D shape of a building. |
| Body 3 | Drag the building on the site to place it. |
| Image alt text | A tower on a real site, with neighboring buildings shown in grey. |
| Caption | The Tower on a real site, with neighbor buildings in grey. |
| Picture | `assets/tour/03-tower-on-site.jpg` |

### Slide 4

| Field | Copy |
|---|---|
| Kicker | 4 of 5 |
| Title | Add the later tools |
| Body 1 | The Plate Planner, Parking Deck, Facade Studio, Sun Study, and Grading Sketch come after the massing tool. |
| Body 2 | Each one opens the project and adds its own part. |
| Body 3 | Select the next tool in the Export menu to move on. |
| Image alt text | The Plate Planner in plan view, with a floor plate filled with units. |
| Caption | The Plate Planner fill on the same project. |
| Picture | `assets/tour/04-plate-fill.jpg` |

### Slide 5

| Field | Copy |
|---|---|
| Kicker | 5 of 5 |
| Title | Start a project |
| Body 1 | Select New project below the Project schedule on this page. |
| Body 2 | Or type an address in the Site Model to make a project from a real site. |
| Body 3 | To see this tour again, select Tour at the top of this page. |
| Image alt text | The Grading Sketch in a 3D view, with areas of cut and fill on the site. |
| Caption | The Grading Sketch on the same project. |
| Picture | `assets/tour/05-grading.jpg` |

## Tool tips

Each tip shows the purpose line, then two Try lines, then the Help button only where the tool has a Help page. The FirstTip card adds the title and the buttons.

### Site Model

| Field | Copy |
|---|---|
| Purpose | The Site Model builds a 3D site from an address with public map data. |
| Try 1 | Type an address in the panel. |
| Try 2 | Select Go to load the site. |
| Help button | No (the Site Model build has no Help page) |

### Tower Generator

| Field | Copy |
|---|---|
| Purpose | The Tower Generator shapes a tower and shows its floor area and height as you work. |
| Try 1 | Drag a handle on the tower to change it. |
| Try 2 | Select the View tab to find the Sun Study. |
| Help button | No |

### Mid-Rise Generator

| Field | Copy |
|---|---|
| Purpose | The Mid-Rise Generator lays out bars and courtyards, with unit and parking estimates. |
| Try 1 | Select a template from the Templates menu. |
| Try 2 | Click a bar in the view to open its row. |
| Help button | Yes |

### Plate Planner

| Field | Copy |
|---|---|
| Purpose | The Plate Planner fills a floor plate with units or hotel keys and counts the area. |
| Try 1 | In Source and program, select Hotel or Multifamily. |
| Try 2 | Turn on Bay lines in the View tab. |
| Help button | Yes |

### Parking Deck

| Field | Copy |
|---|---|
| Purpose | The Parking Deck lays out stalls, bays, ramps, and columns for a deck. |
| Try 1 | Select a ramp type in the Ramp tab. |
| Try 2 | With a project open, turn on Column overlay in the View tab. |
| Help button | Yes |

### Facade Studio

| Field | Copy |
|---|---|
| Purpose | The Facade Studio puts facade systems on each face and reads the window-to-wall ratio. |
| Try 1 | Select a facade system for each zone in the Facade tab. |
| Try 2 | Click a face in the 3D view. |
| Help button | Yes |

### Grading Sketch

| Field | Copy |
|---|---|
| Purpose | The Grading Sketch shapes the ground and sets the finished floor elevation of each building. |
| Try 1 | Open a project that has a site. |
| Try 2 | In Balance and steps, select The whole site. |
| Help button | Yes |

## Names used on the pages

Checked against `index.html` and `build/<tool>/08_ui.js`. The copy uses these names exactly.

| Name in the copy | Where it is |
|---|---|
| Export | Top bar menu in each tool, and the Export button in the project schedule |
| Project schedule | Workspace page, lists every project |
| New project | Workspace page, below the Project schedule |
| Tour | Workspace page, title block (added by phase A) |
| Tools list | Workspace page, cards 1 to 8 |
| Go | Site Model panel, starts the site |
| Send to Tower Generator, Send to Mid-Rise Generator | Site Model top bar (disabled until a site loads) |
| View tab | Tower Generator (holds Display and the Sun Study), Mid-Rise, Plate, Parking, Facade, Grading |
| Sun Study | Tower Generator, View tab |
| Templates | Mid-Rise Generator, Form tab, Templates section |
| Source and program | Plate Planner, Plate tab, section with the Program chips (Hotel, Multifamily) |
| Bay lines | Plate Planner, View tab (labeled "Bay lines (drag to move)") |
| Ramp tab | Parking Deck, Ramp tab, Ramp type section |
| Column overlay | Parking Deck, View tab (needs a column source from the project) |
| Facade tab | Facade Studio, Facade tab, zone sections |
| Balance and steps | Grading Sketch, Buildings tab, section with the pad balance choice |

## Not used in this copy

The Plate Planner's Re-fill button sits in the Units tab, under Locks and re-fill. The Mid-Rise Generator's Center on site button sits in the Site tab, under Project and placement. Add them to a tip only if a Try line needs them.
