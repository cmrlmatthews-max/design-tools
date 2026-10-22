# First-Visit Tour — Technical Plan

Version 1 · October 22, 2026 · Owner: Cade (CMRLM) · Builder: home session

Cade's decisions: five slides on the Workspace page; real screenshots as pictures, refreshed by a script when a tool changes; one short tip the first time each tool opens; the same text for everyone.

## 1. Purpose

A teammate opens the Workspace page for the first time. A tour popup shows what the suite is, the order of the tools, and how a project moves from tool to tool. The tour shows once per device. A **Tour** link brings it back.

Each tool shows one tip the first time it opens. The tip says what the tool does and the two things to try first. It shows once per tool per device.

Definitions: a **slide** is one page of the tour. A **tip** is the one-time card inside a tool. A **device** is one browser on one machine; the memory lives in that browser's localStorage.

## 2. Where it lives

| Part | File | Note |
|---|---|---|
| Tour dialog, slides, Tour link, tests | `index.html` | One file, as the rest of the Workspace page |
| Tip card (shared page part) | `build/shared/08x_tip.js` | Inlined into each tool by its `build.py`, like `06x_sitelayer.js` |
| Tip wiring | `build/<tool>/13_start.js`, `build/<tool>/build.py` | One call and one PARTS line per tool |
| Pictures | `assets/tour/*.jpg` | Made by the script below; committed |
| Picture script | `tools/tour-shots.mjs` | Node and Playwright; `npm run shots:tour` |
| Copy | `docs/tour-copy.md` | Every slide and tip sentence in one reviewed place |

## 3. The Workspace tour

### 3.1 Slides

Five slides. Each slide has: a kicker ("1 of 5"), a title, two or three short sentences, one picture, and a one-line caption.

| # | Title | Picture (`assets/tour/`) | Content |
|---|---|---|---|
| 1 | Welcome to the Design Tools | `01-workspace.jpg` (the Workspace sheet with two projects) | What the suite is. Early design, one project file, browser only, Mac and iPad. |
| 2 | One project, in order | `02-pipeline.jpg` (the Tools list on the sheet, cards 1 to 8) | The order: Site → Massing → Plates → Parking → Facade → Sun → Grading. Each tool reads the sections before it and writes its own. |
| 3 | Start with the site, then the massing | `03-tower-on-site.jpg` (the Tower on a real site, neighbors in grey) | The Site Model builds the site from an address. Send it to the Tower or Mid-Rise Generator. Drag the building to place it. |
| 4 | The later tools | `04-plate-fill.jpg` (the Plate Planner fill on the same project) | Plates, parking, facade, sun, grading. Each tool opens with the project and adds its part. Send to moves you on. |
| 5 | Start a project | `05-grading.jpg` (the Grading Sketch on the same project) | New project on this page, or type an address in the Site Model. The project schedule shows every project. Where to find this tour again. |

The exact sentences are in `docs/tour-copy.md` (phase D). Rule: 20 words or fewer per sentence, no contractions, simple present.

### 3.2 Markup

One native `<dialog id="tour">` at the end of `<main>`. It carries `aria-modal="true"` and `aria-labelledby` pointing at the slide title. Inside: the CMRLM mark and the kicker in a top strip, the slide stage, the dots, and the button row.

```html
<dialog id="tour" class="tour" aria-labelledby="tourTitle">
  <div class="tour-top"><span class="rc">CMRLM</span><span class="rc" id="tourKicker">1 of 5</span></div>
  <h2 class="rc" id="tourTitle"></h2>
  <div class="tour-body" id="tourBody"></div>          <!-- sentences -->
  <figure class="tour-fig"><img id="tourImg" width="1200" height="750" loading="lazy" alt=""><figcaption id="tourCap"></figcaption></figure>
  <div class="tour-dots" id="tourDots" role="tablist"></div>
  <div class="tour-btns"><button class="stamp ink" id="tourBack">Back</button><button class="stamp" id="tourSkip">Skip</button><button class="stamp" id="tourNext">Next</button></div>
</dialog>
```

Slides are a JS array `TOUR_SLIDES = [{ title, body: [..], img, alt, cap }]`. The script fills the stage on each step. Only the current slide is in the DOM, so the `<img>` swaps `src`; the next slide's picture is preloaded with `new Image()` so Next does not flash.

Style: paper background, 2 px ink border with the 1 px edge outline at 4 px offset (the sheet look), no rounded corners, the `RC` condensed face for the kicker, title, caption, dots, and buttons. The backdrop is the desk color at 70 percent. Width: `min(920px, calc(100vw - 32px))`. The figure keeps `aspect-ratio: 1200 / 750` so the layout does not shift while a picture loads. At 390 px wide the title is 22 px, the body 14 px, the buttons wrap to two rows, and the dialog scrolls inside itself. `@media (prefers-reduced-motion: no-preference)` adds a 160 ms fade; otherwise none.

### 3.3 Behavior

- **Open on first visit.** On load: if `TEST` is false, the URL has no `project` parameter, and `localStorage["cmrlm.tour.v1"]` is absent, call `tour.showModal()` after `render()`. The `project` parameter means a teammate arrived from a tool. Do not interrupt them.
- **Done, Skip, Escape** close the dialog and write `cmrlm.tour.v1 = "seen"`. A storage error is ignored; the tour then shows again next time, which is harmless.
- **Buttons.** Back is hidden on slide 1. Skip shows on slides 1 to 4. On slide 5 Skip is hidden and Next reads Done. Enter on the focused button works as usual.
- **Keys.** ArrowRight and ArrowLeft move. Escape closes (native). Tab stays inside the dialog (native `showModal` traps focus).
- **Swipe.** Pointer events on the stage: a horizontal move over 48 px with less than 24 px vertical travel moves one slide. Mouse drags count too.
- **Dots.** One button per slide with `aria-label="Slide n of 5"`; the current one has `aria-current="true"`. Selecting a dot jumps.
- **Tour link.** A `<button class="stamp ink" id="tourOpen">Tour</button>` in the title block, next to the lede. It calls `showModal()` at slide 1. On close, focus returns to it.
- **Key version.** The key is `cmrlm.tour.v1`. When the slides change in substance (a new tool, a new order), bump to `v2` so everyone sees the new tour once. A picture refresh alone does not bump it.
- **Test mode.** With `?test` the tour never opens by itself; the self-test drives it.

### 3.4 Self-test additions (`index.html?test`)

The existing `selfTest()` gains these checks. They use a memory object for storage (the `TourStore` is injectable: `Tour.init({ store })`).

1. Fresh store and no `project` parameter: `Tour.shouldAutoOpen()` is true.
2. Store has the key: false.
3. URL has `project=x`: false (test by passing a fake `search` to `shouldAutoOpen`).
4. `Tour.open()` shows slide 1: kicker "1 of 5", Back hidden, Skip shown, Next reads "Next", dot 1 current.
5. `Tour.next()` four times: slide 5, Next reads "Done", Skip hidden, dot 5 current.
6. `Tour.back()`: slide 4. `Tour.go(2)`: slide 2.
7. ArrowRight and ArrowLeft key events on the dialog move the slide.
8. Done writes the key and closes; `dialog.open` is false.
9. Every slide's `img` path starts with `assets/tour/` and has non-empty alt text.
10. The Tour link reopens at slide 1 after a close.

`dialog.showModal()` throws in some headless runs when the dialog is already open; the test closes between steps.

## 4. The tool tip

### 4.1 Card

`FirstTip` is one shared page part. It builds a small card, not a modal, so the tool stays usable behind it.

```
FirstTip.init({ tool, title, lines: [a, b], help: true|false, version: 1 })
FirstTip.show()      // shows the card now (tests use this)
FirstTip.hide()      // writes the key and removes the card
FirstTip.seen()      // true when the key is present
```

- Key: `cmrlm.tip.<tool>.v<version>`.
- Auto-show: after `init`, on the first `requestAnimationFrame` after the page's first render, when `seen()` is false and the URL has no `test` parameter. A `project` parameter does not block the tip: the tip is short and the teammate is new to that tool.
- The card: a white panel, 1 px ink border, the tool's toast font and spacing. Contents: the tool name in the condensed face, one sentence of purpose, two "Try" lines with a bullet, then the buttons **Open Help** (only when `help` is true; it clicks `#btnHelp`) and **Got it**. Got it writes the key.
- Place: desktop, fixed at the bottom right, 16 px in, above the view buttons (`bottom: 84px`), width 320 px. Under 700 px wide: a bottom sheet across the width, above the view buttons. `role="dialog"`, `aria-labelledby` the title, not modal, Escape hides it when focus is inside it.
- One line of CSS added by the part itself (`<style>` injected once), so each tool's `css_add.css` is untouched. It reads the tool's tokens (`--ink`, `--paper`, `--hair`) and falls back to the Workspace values.

### 4.2 Tip text (first draft; phase D polishes in `docs/tour-copy.md`)

| Tool | Purpose line | Try first | Help button |
|---|---|---|---|
| Site Model | Builds a 3D site from an address with public map data. | Type an address and select Go. · Send the site to the Tower or Mid-Rise Generator. | yes |
| Tower Generator | Shapes a tower and reads its floor area and height as you work. | Drag a handle on the tower to change it. · Open the View tab for the Sun Study. | no |
| Mid-Rise Generator | Lays out bars, courts, and a podium, with a unit and parking estimate. | Pick a template from the Templates menu. · Drag a bar to move it. | yes |
| Plate Planner | Fills a floor plate with units or keys and counts the area. | Select Hotel or Multifamily. · Drag a bay line between two units. | yes |
| Parking Deck | Lays out stalls, aisles, ramps, and columns for a deck. | Pick a ramp type in the Deck tab. · Turn on the column overlay with a project open. | yes |
| Facade Studio | Puts facade systems on each face and reads the glazing ratio. | Pick a system by zone in the Facade tab. · Select a face in the view to change it. | yes |
| Grading Sketch | Sketches rough grading and the finished floor elevation. | Open a project with a site for the real ground. · Select Balance in the Site work tab. | yes |

### 4.3 Wiring

- `build/<tool>/build.py`: `os.path.join(SHARED, '08x_tip.js')` in PARTS after `08_ui.js` (after Toast exists, before `13_start.js`).
- `build/<tool>/13_start.js`: `FirstTip.init({...})` as the last line before the `window.__<tool>` hook; add `firstTip: FirstTip` to the hook for tests.
- The Site Model has its own build (`build/site/`): same two lines there.
- In-page tests per tool (a new `12k_tests_tip.js` in each tool, chained the way `12i_tests_site.js` chains): `seen()` false on a fresh memory store; `show()` builds the card with the title, two lines, and the right buttons (no Open Help in the Tower); Got it writes the key and removes the card; `show()` again does nothing when seen; Escape hides. Tests inject a memory store with `FirstTip.init({ store })`.

## 5. Pictures

### 5.1 Script `tools/tour-shots.mjs`

Node 22 and Playwright. It:

1. Starts `python3 -m http.server` on a free port, serving the repo root.
2. Builds a project in memory: the site fixture from the scratch script `mksite.mjs` (61 × 61 ground on a tilted plane with a bump, 25 buildings, two roads, a pond, 30 trees) plus a tower massing (point-tower preset through `buildPlates`, `computeMetrics`, `towerDerived`) placed at the site center with a baseZ from `groundZAt`. The fixture code moves into the script; the scratch copy is not referenced.
3. Opens each page in headless Chromium at 1440 × 900 with `deviceScaleFactor: 2`, routes `cdn.jsdelivr.net` to `node_modules` (three, clipper-lib) as `chain2.js` does, seeds the project into localStorage, waits for the first render (`waitForFunction` on the tool's `__<tool>` hook, then 1,500 ms), hides the tip (sets its key first), and screenshots.
4. Writes `assets/tour/<name>.jpg`: the 2,880 × 1,800 capture resized to 1,200 × 750 with sharp, JPEG quality 82, progressive. Expected size 120 to 220 KB each.

Why JPEG at 1,200 wide: the dialog shows the picture at most 860 px wide, so 1,200 px is 1.4× for Retina at that width and 3× on a phone. PNG of a 3D view with shading lands at 600 KB or more; JPEG at 82 shows no banding on the flat sheet and keeps the text in the panels readable. Pictures with large flat areas (the Workspace sheet) stay under 100 KB.

Shots:

| File | Page | State |
|---|---|---|
| `01-workspace.jpg` | `index.html?test` seeded with two sample projects, "How projects work" closed | The sheet with the schedule and the Tools list |
| `02-pipeline.jpg` | same page, scrolled to the Tools list, clipped to the list | Cards 1 to 8 |
| `03-tower-on-site.jpg` | `tower/?project=<id>` | Axon, the tower on the site |
| `04-plate-fill.jpg` | `plate/?project=<id>` | Plan view, the fill |
| `05-grading.jpg` | `grading/?project=<id>` | Axon, cut and fill |

The script prints each file's size and fails when one is over 300 KB.

### 5.2 Dependencies and scripts

`package.json`: `"shots:tour": "node tools/tour-shots.mjs"`; devDependencies add `"playwright": "1.56.0"` (pinned; check the version installed under `/home/claude/.npm-global` and pin that) and `"sharp": "0.34.3"` (or the version `npm view sharp version` gives on the day). `npm install` on a Mac then needs `npx playwright install chromium` once. In this container, never run `playwright install`; set `NODE_PATH=/home/claude/.npm-global/lib/node_modules` or `/opt/npm-tools/node_modules` (the one that resolves) and use the preinstalled browser.

README, under Folders: `assets/tour/` row: "Pictures for the first-visit tour. When a tool changes its look, run `npm run shots:tour` and commit the pictures." And `tools/` row: "Dev scripts. `tour-shots.mjs` makes the tour pictures (needs `npm install` and `npx playwright install chromium` once)."

### 5.3 Node check

`test/tour.assets.test.mjs`: reads the `TOUR_SLIDES` array out of `index.html` with a regex on `img: "assets/tour/…"` and asserts each file exists and is under 300 KB. Added to `npm test` as `test:tour`.

## 6. Accessibility

- The dialog: `aria-modal`, labelled by the title, focus trapped by `showModal`, Escape closes, focus returns to the Tour link.
- Every picture has alt text that says what the picture shows, not "screenshot".
- Dots are buttons with labels. Buttons are 44 px tall (the `.stamp` size).
- The tip is not modal, has a labelled dialog role, and Got it is reachable by Tab.
- Reduced motion: no fade.

## 7. Workspace page edits outside the dialog

- The Tour link in the title block.
- One sentence at the end of "How projects work" section 1: "Select **Tour** at the top of this page for a five-slide tour."
- `docs/suite-roadmap.md`: section 2 gets no new tool row; section 8 marks the idea built.

## 8. Phases and file ownership

Phases A to D run in parallel. D lands first (copy is small); A and B paste from it. C needs the merged pages to exist, so it runs on the branch after A and B rebuild, but it can write the script and the fixture at once and shoot at the end.

| Phase | Model | Agent | Owns | Done when |
|---|---|---|---|---|
| A | Sonnet | Workspace tour | `index.html` (dialog, styles, `Tour` module, Tour link, section 1 sentence, self-tests) | `index.html?test` passes with the ten tour checks; 390 px and iPad portrait screenshots in the scratchpad |
| B | Sonnet | Tool tip | `build/shared/08x_tip.js`; in all seven build folders (`site`, `tower`, `midrise`, `plate`, `parking`, `facade`, `grading`): `13_start.js`, `build.py`, new `12k_tests_tip.js`; the rebuilt `*/index.html` | Every page builds; every page's `?test` passes with the tip tests; one screenshot per page with the tip shown |
| C | Sonnet | Pictures | `tools/tour-shots.mjs`, `package.json` (devDependencies, `shots:tour`, `test:tour`), `test/tour.assets.test.mjs`, `assets/tour/*.jpg`, `README.md` rows | The script runs from a clean checkout; five pictures under 300 KB; the Node check passes |
| D | Haiku | Copy | `docs/tour-copy.md` | Reviewed by the integrator; A and B paste it verbatim |
| E | Opus | Integrator (this session) | Rebuilds, `npm test`, every `?test`, a real first-visit run in headless Chromium (tour opens, Done, reload, no tour; tool tip once), PR | Cade merges |

Rules:

- Nobody edits a file another phase owns. A needed line goes to that agent through the integrator.
- A and B read `docs/tour-copy.md` before they write text. Until D lands they use the tables in sections 3.1 and 4.2.
- C shoots after A and B have rebuilt, so the pictures show the final pages without a tip in them.
- Commits: none by agents. The integrator commits per phase on branch `tour`.

## 9. Risks and open items

| Risk | Effect | Response |
|---|---|---|
| Pictures go stale after a tool change | The tour shows an old look | The README rule and the Node size check; the PR template for a tool gains the line "run `npm run shots:tour` if the look changed" |
| `showModal` in an old iPad Safari (before 15.4) | No dialog | `HTMLDialogElement` check; without it the Tour link opens the dialog as a plain block with `open` and a close button |
| The tip covers the view buttons on a phone | Annoying | Bottom sheet sits above `#views`; Got it is one tap |
| A teammate blocks storage | The tour shows every visit | Acceptable; Skip is one tap |
| Playwright and sharp add 300 MB to `npm install` | Slow installs | Both are devDependencies; the tools run without them |

Open items: a per-tool picture in the tip (not now); a "What is new" slide when a version ships; an animated GIF of a drag (not now, size).
