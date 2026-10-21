/* ==========================================================================
   CONFIG
   Limits, palettes, labels, and the inlined src modules.
   The src modules (shared, tower and parking) are wrapped in functions so
   their names do not clash with the rest of the file; build.py puts them in
   dependency order at the marker below.
   ========================================================================== */
//@@MODULES@@

const CONFIG = {
  limits: {
    maxLevels: 12,        // the performance target of the plan (section 6): 10 levels x 600 stalls
    maxDim: 3000,         // ft, hard cap on any single plan dimension
    maxHistory: 50,       // undo steps
    maxCores: 12,
    maxEntries: 4,
  },
  // Stall colors, Diagram style (plan section 6)
  kindColors: { standard: '#c3c9d0', accessible: '#2f7fd9', van: '#1b4a99', ev: '#3fa45c', compact: '#e0a21b' },
  kindLabels: { standard: 'Standard', accessible: 'Accessible', van: 'Van accessible', ev: 'EV installed', compact: 'Compact' },
  slopeColors: { ok: '#3fa45c', near: '#e0a21b', over: '#d64545' },
  conflictColor: '#d64545',
  coreColors: { stair: '#d9731a', elevator: '#7a5cc2' },
  presets: PresetsMod.PRESETS,
  storageKey: 'parking.options.v1',
  schema: 1,
  projectSchema: 1,        // schema of the "parking" section this tool writes
  projectSaveMs: 1000,     // project autosave delay (spec section 8)
  projectListMax: 8,
  tool: 'parking',
  snapGrids: [1, 5],
  slabThickness: 1,        // ft
};
