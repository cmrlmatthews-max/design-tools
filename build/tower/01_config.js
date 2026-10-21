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
  schema: 1,
};
