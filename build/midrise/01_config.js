/* ==========================================================================
   CONFIG
   Program defaults, limits, palettes, and the inlined src modules.
   The src modules (shared, tower and mid-rise) are wrapped in functions so
   their names do not clash with the rest of the file; build.py puts them in
   dependency order at the marker below.
   ========================================================================== */
//@@MODULES@@

const PROGRAM_LABELS = {
  residential: 'Residential', hotel: 'Hotel', senior: 'Senior living', retail: 'Retail',
  amenity: 'Amenity', leasing: 'Leasing', parking: 'Parking',
};
const CONFIG = {
  limits: {
    maxFloors: 40,        // per bar (a mid-rise; the Tower Generator takes over above this)
    maxDim: 3000,         // ft, hard cap on any single plan dimension
    maxHistory: 50,       // undo steps
    maxBars: 12,          // the performance target of the plan (section 6)
    maxBends: 2,
  },
  floorGap: 0.5,          // ft, gap between extruded plates when floor lines are on (plan section 6)
  programs: Object.fromEntries(Object.entries(PresetsMod.PROGRAM_DEFAULTS).map(([k, v]) => [k, { label: PROGRAM_LABELS[k] || k, ...v }])),
  // Programs a bar can carry on its typical floors, and on its ground floor.
  barPrograms: ['residential', 'hotel', 'senior'],
  groundPrograms: ['retail', 'amenity', 'leasing'],
  podiumPrograms: ['parking', 'retail', 'amenity', 'leasing'],
  // Fixed palette for Diagram style, color by bar (12 colors, repeating).
  barColors: ['#4f7fd1', '#d9722b', '#3f9e75', '#b0559e', '#c9a227', '#2f9aa8', '#d1566a', '#7a6bc9', '#7a9a2f', '#a8744b', '#4b86a8', '#8c8f99'],
  zoneColors: { podium: '#8b929a', bar: '#4f7fd1', deck: '#a9afb6', screen: '#d9a22b' },
  outsideColor: '#d64545',
  presets: PresetsMod.PRESETS,
  storageKey: 'midrise.options.v1',
  schema: 1,
  projectSchema: 1,        // schema of the "massing" section this tool writes
  projectSaveMs: 1000,     // project autosave delay (spec section 8)
  projectListMax: 8,
  contextRadius: 600,      // ft, default radius for "Context from site"
  tool: 'midrise',
};
