/* ==========================================================================
   CONFIG
   Limits, palettes, labels, and the inlined src modules.
   The src modules (shared, tower prompts, site helpers, grading) are wrapped in functions so
   their names do not clash with the rest of the file; build.py puts them in
   dependency order at the marker below.
   ========================================================================== */
//@@MODULES@@

const CONFIG = {
  limits: {
    maxDim: 5000,         // ft, hard cap on any single typed plan dimension
    maxHistory: 50,       // undo steps
    maxBuildings: 8,
    maxTiers: 8,
    maxFeatures: 12,      // drives, lots, walls and routes, each
  },
  // Cut and fill map (plan section 6): fill blue, cut red, five steps each (0 to 1, 1 to 2, 2 to 4, 4 to 8, over 8 ft).
  diffEdges: [1, 2, 4, 8],
  fillColors: ['#cde2f5', '#9cc6ec', '#6199d6', '#3470b8', '#1c478a'],
  cutColors: ['#f7d3cb', '#eda697', '#dc7366', '#c1433a', '#8f2a24'],
  noChangeColor: '#f3f3ef',
  noChange: 0.05,                       // ft: under this the ground counts as unchanged on the map
  classColors: { walk: '#2f9e5b', ramp: '#e0a21b', fail: '#d03a30' },
  classLabels: { walk: 'Walk', ramp: 'Ramp', fail: 'Over the ramp limit' },
  wallColor: '#c4c8cc',
  wallStepColor: '#aab0b6',
  wallFlagColor: '#e0762b',
  padColor: '#23508f',
  driveColor: '#5f6b79',
  lotColor: '#7b6cc6',
  routeColor: '#2f9e5b',
  propertyColor: '#a85a12',
  conflictColor: '#d03a30',
  existingColor: '#8e98a3',
  buildingHeight: 12,                   // ft, the one-story block drawn on each tier for scale
  exaggerations: [1, 2, 3, 5],
  presets: PresetsMod.PRESETS,
  storageKey: 'grading.options.v1',
  heroColor: '#E0A458',    // AI-ready image: the hero model draws in this color, everything else stays white (batch-fixes plan 7); one value
  heroColorName: 'amber',  // the name the Hero render prompt uses for it
  schema: 1,
  projectSchema: 1,        // schema of the "grading" section this tool writes
  projectSaveMs: 1000,     // project autosave delay (spec section 8)
  projectListMax: 8,
  contextRadius: 900,      // ft, site neighbors drawn around the work
  shadowStrength: 0.55,   // opacity of the flat ground shadow (batch-fixes plan 3.2); the Tower also boosts the light contrast for the Sun Study
  tool: 'grading',
  title: 'Grading Sketch',
  sketchCaution: 'Caution: this is a sketch for early coordination with the civil engineer. It is never a grading plan. Every volume, slope, and wall height is a design-stage estimate.',
  earthCaution: 'Caution: grid earthwork compares options. It is not a quantity takeoff. Expect about plus or minus 5 to 10 percent against a civil surface model, more where edges fall between samples.',
  daylightCaution: 'Caution: stable slopes depend on the soil. 3:1 and 2:1 are starting values, not a geotechnical recommendation.',
  routeCaution: 'Caution: these limits come from the 2010 ADA Standards and ICC A117.1. The adopted code and its amendments decide. The tool reports slopes; it never says "compliant".',
  wallCaution: 'Caution: walls over about 4 ft often need an engineered design, a permit, and a guard. Verify every wall with the civil and structural engineers.',
  gradeCaution: 'Caution: drive and lot grades are design values for a sketch. The fire marshal and the local code set fire access grades. Verify every grade with the civil engineer.',
  stepCaution: 'Caution: a step between tiers changes the building, not only the ground. A 4 ft step needs stairs or a ramp inside the building and a stepped slab. Confirm every step with the design team.',
};
