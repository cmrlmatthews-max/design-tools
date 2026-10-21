# Tower Generator — Module Contracts (parallel build)

Author: Opus (orchestrator). Every parallel agent follows this file exactly.
The technical plan (`tower-generator-technical-plan.md`) is still the source for behavior; this file fixes the interfaces.

## Locations

```
/home/claude/design-tools/
  tower/index.html            ← shell (phase 2 agent) → later the single integrated file
  src/tower/geometry.js       ← Agent G (Opus): phases 3 + 4 geometry + metrics
  src/tower/envelope.js       ← Agent E (Sonnet): zoning envelope + warnings
  src/shared/storage.js       ← Agent S (Sonnet): save / load / export / import
  src/shared/screenshot.js    ← Agent S (Sonnet): capture + annotate + deliver
  src/tower/presets.js        ← Agent P (Haiku): presets + program defaults
  src/tower/testcases.js      ← Agent P (Haiku): hand-calculated test cases
  test/                       ← node and browser tests for each module
```

Test libraries (local copies, the shell cannot reach CDNs):
`/tmp/claude-0/-home-claude/9546d1ce-6b27-55ce-b438-81c16f52df3e/scratchpad/node_modules/{three,clipper-lib}`
Browser harness: `python3 /tmp/claude-0/-home-claude/9546d1ce-6b27-55ce-b438-81c16f52df3e/scratchpad/harness.py PAGE.html OUT_PREFIX 1440x900 --js "expr"`
(serves `https://cdn.jsdelivr.net/npm/three@0.170.0/...` and `https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/...` from the local copies).

## Rules for all modules

- ES modules (`export function ...`). No build step. No DOM access in geometry, envelope, presets, testcases.
- Clipper: use `globalThis.ClipperLib`. The page loads `https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js` with a classic script tag. Node tests set `globalThis.ClipperLib = require(".../clipper-lib")` first.
- Clipper works in integers: scale feet by `SCALE = 1000` (0.001 ft precision). Keep the scale inside the module.
- Units: feet, square feet, degrees. Plan coordinates `(x, y)`; north = +y; front = south (−y side), back = north (+y), left = west (−x), right = east (+x). Elevation `z` is up.
- Pure functions: no hidden state, no mutation of inputs.

## Shared data types

```js
// Ring: closed polygon, no repeated last point, counter-clockwise for outers, clockwise for holes.
type Ring = Array<[x, y]>;
type Poly = { outer: Ring, holes: Ring[] };   // one connected piece
type MultiPoly = Poly[];                        // a plate can have several pieces

type Plate = {
  n,                 // floor number, 1 = ground
  zone,              // "podium" | "tower" | "mechanical"
  program,           // key of state.programs
  segmentIndex,      // -1 for podium
  z, ftf,            // elevation of floor surface, floor-to-floor height
  polygons: MultiPoly,
  area,              // sf, from polygons
  coreArea,          // sf of core inside this plate (0 for podium)
  coreRect: Ring|null,
  outsideEnvelopeArea: 0   // filled by envelope.js
};

type Solid =                                   // crown and other non-floor geometry
  | { kind: "prism", polygons: MultiPoly, z0, z1, role }            // role: "crown" | "parapet" | "screen"
  | { kind: "mesh",  positions: number[] /* x,y,z triples */, indices: number[], role }; // spire, sloped crown

type Warning = { code, severity: "warn"|"error", floors: number[], message };
// message uses grouped floors: "Floors 31–34 exceed the height limit." (en dash)
```

## geometry.js (Agent G)

```js
export const SCALE = 1000;
export function shapeToRing(shape, { segments = 96 } = {})      // shape: {type, w, d, radius, arm, points}
export function ringArea(ring)                                   // signed shoelace
export function multiPolyArea(mp)                                // outers minus holes
export function buildFloorList(state)                            // plan 3.1
export function buildPlates(state, { quality = "full" } = {})    // → { plates: Plate[], solids: Solid[], warnings: Warning[] }
export function computeMetrics(state, plates)                    // plan section 5, all metrics, per-program unit estimates
export function groupFloors(numbers)                             // [31,32,33,34,40] → "Floors 31–34 and 40"
```
`quality: "draft"` → 32 circle segments for display while dragging. Metrics always come from a `"full"` build.

## envelope.js (Agent E)

```js
export function allowedFootprint(state, z)       // MultiPoly allowed at elevation z (setbacks, stepback)
export function envelopeWireframe(state, topZ)   // [{ polygons: MultiPoly, z0, z1 }] for drawing the envelope
export function checkEnvelope(state, plates, solids)
  // → { plates: Plate[] (copies with outsideEnvelopeArea set), outside: Map<n, sf>,
  //     solidsOutside: boolean[], warnings: Warning[] }
```

## storage.js (Agent S, SHARED)

```js
export function createStorage({ key, schema, migrate, onNotice })
  // → { list(), get(id), save(state, name) → id, update(id, state), remove(id), duplicate(id, newName),
  //     autosave(state) /* 1 s debounce, slot "__current" */, loadAutosave(),
  //     exportAll() → Blob (application/json), importFile(file) → Promise<{added, skipped}> /* appends, renames duplicates "Name (2)" */ }
  // Every storage access wrapped in try/catch; on failure call onNotice(message) once and keep working in memory.
```

## screenshot.js (Agent S, SHARED)

```js
export async function captureView({ renderer, scene, camera, scale = 2, overlay })
  // overlay: { title?, date?, metrics?: Array<[label, value]>, mark?: "CMRLM" } → Promise<Blob> (image/png)
export async function deliverImage(blob, filename)
  // navigator.canShare({files}) → navigator.share; else download with an <a download> link.
```

## presets.js and testcases.js (Agent P)

```js
export const PROGRAM_DEFAULTS = { residential: { ftf, unitSize, unitFactor, color }, ... }  // plan section 6
export const PRESETS = [ { id, name, description, state } ]   // full state objects, plan section 2 schema
export const TEST_CASES = [ { id, description, state, expect: { gfa?, floors?, height?, tolerancePct } } ]
```

---

## AI prompt library (added October 20, 2026)

Canonical folder from now on: `/home/claude/repo-design-tools` (the git clone). Test server: `http://localhost:8766/` serves that folder.

### src/tower/prompts.js (Agent PL, Opus — data only)

```js
export const PROMPT_LIBRARY_VERSION = 1;

// Fields the user picks in the panel. Each option: { value, label }.
export const PROMPT_FIELDS = {
  material: { label: "Facade material", options: [...], default: "..." },
  location: { label: "Site context",    options: [...], default: "..." },
  time:     { label: "Time of day",     options: [...], default: "..." },
  season:   { label: "Season",          options: [...], default: "..." },
};

// Fields the tool fills from the current option (the panel computes them):
//   {{floors}}   e.g. "32"            (metrics.floorCount)
//   {{height}}   e.g. "432 feet"      (metrics.totalHeight, rounded to the foot)
//   {{program}}  e.g. "residential"   (program of the tallest segment; hotel → "hotel", office → "office")
//   {{podium}}   e.g. "a 4-story podium" or "no podium"
//   {{form}}     e.g. "a rectangular tower with two setbacks and a stepped crown" (short phrase built by the panel)

export const FORM_LOCK = "...";   // fixed rule block, may use {{floors}} and {{form}}; prepended to every prompt

export const PROMPTS = [
  { id, group: "time" | "material" | "context" | "camera", title, description,
    template,            // text with {{tokens}}; must NOT repeat the form lock
    uses: ["material", "location", "time", "season"],   // which pick fields this prompt shows
    defaults: { material?, location?, time?, season? } } // per-prompt overrides of field defaults
];  // exactly 20: 5 time, 6 material, 5 context, 4 camera

export function fillPrompt(prompt, values) // → full text: FORM_LOCK + "\n\n" + template, all {{tokens}} replaced; unknown tokens left visible as [token]
```

### Panel (Agent PP, Sonnet — build parts)

- Fills `/* SLOT: ai-prompts */` and the hidden "AI Prompts" top-bar button.
- Imports the data by inlining `src/tower/prompts.js` through build.py (add it the same way as the other src modules).
- Custom prompts: stored in the same storage blob under `prompts: [{ id, title, group: "custom", template, uses, createdAt, updatedAt }]`; included in Export/Import JSON. Built-in prompts are read-only; "Duplicate to edit" makes a custom copy.
