/* ==========================================================================
   CONFIG
   Program defaults, presets, limits, zone colors.
   The presets module (src/tower/presets.js) is inlined here unchanged apart
   from the export keywords; it is wrapped in a function so its names do not
   clash with the rest of the file.
   ========================================================================== */
//@@MODULE presets@@

const PROGRAM_LABELS = {
  residential: 'Residential', hotel: 'Hotel', office: 'Office', retail: 'Retail',
  amenity: 'Amenity', parking: 'Parking', mechanical: 'Mechanical',
};
const CONFIG = {
  limits: {
    maxFloors: 400,       // hard cap on total floors the geometry will build
    maxDim: 5000,         // ft, hard cap on any single plan dimension
    maxHistory: 50,       // undo steps
  },
  floorGap: 0.5,          // ft, gap between extruded plates when floor lines are on (plan 7.2)
  // Program defaults (plan section 6). ftf = floor-to-floor (ft). unitFactor is a FRACTION (0.85) or null.
  programs: Object.fromEntries(Object.entries(PresetsMod.PROGRAM_DEFAULTS).map(([k, v]) => [k, { label: PROGRAM_LABELS[k] || k, ...v }])),
  zoneColors: { podium: '#8b929a', tower: '#4f7fd1', mechanical: '#e0762f', crown: '#d9a22b' },
  outsideColor: '#d64545',
  presets: PresetsMod.PRESETS,
  storageKey: 'towergen.options.v1',
  heroColor: '#E0A458',    // AI-ready image: the hero model draws in this color, everything else stays white (batch-fixes plan 7); one value
  heroColorName: 'amber',  // the name the Hero render prompt uses for it
  schema: 2,               // the option state (plan section 2.3); the saved options blob uses the same number
  pinLocksOffsets: true,   // Pin placement also disables the offset fields of segments (Tower) or the start x/y of bars (Mid-Rise); Cade chose yes (batch-fixes plan 2.2); false leaves them editable
  projectSchema: 1,        // schema of the "massing" and "sun" sections this tool writes (plan section 2.3)
  projectSaveMs: 1000,     // project autosave delay (spec section 8)
  projectListMax: 8,
  contextRadius: 600,      // ft, default radius for "Context from site"
  shadowStrength: 0.55,   // opacity of the flat ground shadow (batch-fixes plan 3.2); the Tower also boosts the light contrast for the Sun Study
  tool: 'tower',
};
