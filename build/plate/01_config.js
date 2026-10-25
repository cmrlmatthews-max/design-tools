/* ==========================================================================
   CONFIG
   Limits, palettes, labels, and the inlined src modules.
   The src modules (shared, Tower geometry, plate) are wrapped in functions so their names do not clash with the rest of the file;
   build.py puts them in dependency order at the marker below.
   ========================================================================== */
//@@MODULES@@

const CONFIG = {
  limits: {
    maxDim: 5000,         // ft, hard cap on any single typed plan dimension
    maxHistory: 50,       // undo steps
    maxSupport: 24,       // support blocks
    maxStairs: 12,        // manual stairs
    maxUnits: 600,        // drawn units per layout
  },
  presets: PresetsMod.PRESETS,
  storageKey: 'plate.options.v1',
  schema: 1,
  projectSchema: 1,        // schema of the "plates" section this tool writes
  projectSaveMs: 1000,     // project autosave delay (spec section 8)
  projectListMax: 8,
  contextRadius: 900,      // ft, site neighbors drawn around the work
  shadowStrength: 0.55,   // opacity of the flat ground shadow (batch-fixes plan 3.2); the Tower also boosts the light contrast for the Sun Study
  tool: 'plate',
  title: 'Plate Planner',
  // Scene colors by role (the model style uses these; the diagram style colors units by type)
  corridorColor: '#d4d9de',
  coreColor: '#aeb5bd',
  stairColor: '#9aa2ab',
  elevColor: '#8b94a0',
  supportColor: '#c9cdd2',
  pocketColor: '#dcdfe3',
  openColor: '#e9edf1',                // an open stretch: a very light band
  ghostLine: '#23508f',                // the dashed outline of a suggested (ghost) unit
  smallColor: '#2f6fd0',               // blue: a unit smaller than its type's range
  areaHighColor: '#e07a00',            // orange: a unit larger than its type's range
  flagColor: '#d03a30',
  lineColor: '#1d242b',
  accentColor: '#23508f',
  slabHeight: 0.8,                      // ft, thickness of a unit slab in the single-level views
  stackGap: 0,                          // ft, extra gap between stacked levels
  areaRule: 'Area rule: units are measured to the centerline of demising walls, to the corridor face of the corridor wall, and to the inside face of the exterior wall. The corridor wall thickness counts in the unit, not in the corridor.',
  testFitCaution: 'Caution: this is a test fit for early design. Unit counts, areas, corridor lengths, and accessible counts are design-stage numbers. The tool never checks a code and never says "compliant".',
  accessibleCaution: 'Caution: the accessible counts are seeds for an editable table. Verify every count against the adopted code before use.',
  distanceCaution: 'Caution: the tool reports stair-door distances and dead ends. It does not check them against any code.',
  widthCaution: 'Caution: the corridor width is a common design width, not a code minimum. Verify it against the adopted code.',
};
