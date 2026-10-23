/* ==========================================================================
   CONFIG
   Limits, palettes, labels, and the inlined src modules.
   The src modules (shared, tower prompts, facade) are wrapped in functions so
   their names do not clash with the rest of the file; build.py puts them in
   dependency order at the marker below.
   ========================================================================== */
//@@MODULES@@

const CONFIG = {
  limits: {
    maxLevels: 120,       // the plan's target is a 60-floor tower; the standalone massing stops at 120 levels
    maxDim: 3000,         // ft, hard cap on any single plan dimension
    maxHistory: 50,       // undo steps
    maxRanges: 8,
    maxBands: 8,
  },
  // Diagram style: faces colored by system (plan section 6)
  systemColors: { punched: '#5b8bd6', windowWall: '#3f9c8c', curtainWall: '#7b6cc6', storefront: '#e0a21b', solid: '#98a1ab' },
  systemLabels: { punched: 'Punched windows', windowWall: 'Window wall', curtainWall: 'Curtain wall', storefront: 'Storefront', solid: 'Solid' },
  systemOrder: ['punched', 'windowWall', 'curtainWall', 'storefront', 'solid'],
  // Diagram style, colored by WWR: five steps, light to dark. Edges are WWR fractions (upper bound of each step).
  wwrColors: ['#e6eef8', '#c0d6ee', '#8db4e0', '#5388c8', '#2a5a9c'],
  wwrEdges: [0.1, 0.2, 0.3, 0.4],
  materialColors: { eifsCmu: '#eeebe3', metal: '#aab3bd', brick: '#b8705a', fiberCement: '#c6c0b1', precast: '#d3cfc6' },
  materialLabels: { eifsCmu: 'EIFS over CMU', metal: 'Metal panel', brick: 'Brick', fiberCement: 'Fiber cement panel', precast: 'Precast' },
  glassColor: '#9db5ca',
  glassColorDiagram: '#ffffff',
  doorColor: '#7f9bb4',
  recessColor: '#3b434c',
  mullionColor: '#7d8791',
  streetColor: '#e8892b',
  orientations: ['N', 'E', 'S', 'W'],
  orientationLabels: { N: 'North', E: 'East', S: 'South', W: 'West' },
  zoneLabels: { base: 'Base', middle: 'Middle', top: 'Top' },
  presets: PresetsMod.PRESETS,
  storageKey: 'facade.options.v1',
  heroColor: '#E0A458',    // AI-ready image: the hero model draws in this color, everything else stays white (batch-fixes plan 7); one value
  heroColorName: 'amber',  // the name the Hero render prompt uses for it
  schema: 1,
  projectSchema: 1,        // schema of the "facade" section this tool writes
  projectSaveMs: 1000,     // project autosave delay (spec section 8)
  projectListMax: 8,
  contextRadius: 900,      // ft, site neighbors drawn around the massing
  shadowStrength: 0.55,   // opacity of the flat ground shadow (batch-fixes plan 3.2); the Tower also boosts the light contrast for the Sun Study
  tool: 'facade',
  wallThickness: 0.5,      // ft, the wall box of each face and level
  glassLift: 0.15,         // ft, glass sits this far proud of the wall face
};
