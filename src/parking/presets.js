// Default state and the menu presets for the parking deck generator.
// Source: docs/parking-deck-technical-plan.md sections 2 and 8.
// Units: feet, square feet, degrees. Slopes are fractions in the state.
// Cores, entries, and the speed ramp use the layout frame (plan section 2).
// Each preset is a complete state object (schema 1). Consumers should deep-copy before editing.

const stair = (id, x, y) => ({ id, kind: 'stair', x, y, w: 22, d: 12 });
const elevator = (id, x, y) => ({ id, kind: 'elevator', x, y, w: 10, d: 10 });

// Standard cores for the two-bay layout: S1 and E1 in the south row of bay 1, S2 in the north row of the top bay.
const standardCores = () => [stair('S1', 25, 1), elevator('E1', 52, 1), stair('S2', 246, 109)];

// The default state (plan section 2). Builds a new object on each call, so every caller gets its own copy.
// It equals the section 8.1 preset.
export function defaultState() {
  return {
    schema: 1,
    name: 'Two-bay single helix, five levels',
    source: 'standalone',
    sourceLevel: null,

    footprint: { shape: 'rect', width: 300, depth: 125, points: [], x: 0, y: 0, angle: 0, perimeter: 1 },

    placement: null,

    levels: { count: 5, ftf1: 11, ftf: 10.5, belowGrade: 0, openTop: true },

    bays: {
      stallW: 9, stallD: 18, aisle: 24,
      edgeBays: true,
      compactShare: 0, compactW: 8, compactD: 16,
      turnZone: null,
      rotateBays: false,
    },

    grid: {
      span: 'long',
      column: 2,
      stallsPerModule: 3,
      structureDepth: { long: 2.5, short: 1.5 },
    },

    ramp: {
      type: 'single-helix',
      slopedBay: 1,
      speed: { x: 99, y: 123, width: 24, length: 82, shape: 'straight', insideRadius: 30, segments: 12 },
      splitLength: 36,
      transition: { length: 10, slopeFactor: 0.5 },
    },

    cores: standardCores(),
    coresFromProject: true,

    entries: [{ id: 'N1', side: 'west', at: 31, width: 24 }],

    liner: { on: false, side: 'south', depth: 61, levels: [1] },

    // Common design values, not code values. Verify against the adopted code.
    checks: {
      slopeParking: 0.0667,
      slopeSpeed: 0.12,
      crossSlope: 0.02,
      barrier: 2.75,
      guard: 3.5,
      clearGeneral: 7.0,
      clearVan: 8.1667,
      barrierProvided: 3.5,
      overlayTolerance: 2,
    },

    // Seed rows from IBC 1106.1. Verify against the adopted accessibility standard.
    accessible: {
      table: [
        { upTo: 25, count: 1 }, { upTo: 50, count: 2 }, { upTo: 75, count: 3 },
        { upTo: 100, count: 4 }, { upTo: 150, count: 5 }, { upTo: 200, count: 6 },
        { upTo: 300, count: 7 }, { upTo: 400, count: 8 }, { upTo: 500, count: 9 },
        { upTo: 1000, percent: 2 },
        { upTo: null, base: 20, per100Over1000: 1 },
      ],
      vanPer: 6,
      aisleCar: 5,
      aisleVan: 8,
      r2: { on: null, percent: 2 },
    },

    ev: { readyShare: 0.20, installedShare: 0.05 },

    bike: { mode: 'per-units', perUnits: 10, count: 0, rack: 'single' },

    required: { units: null, ratio: 1.25, retailSf: 0 },

    view: {
      style: 'model',
      colorBy: 'kind',
      level: 0,
      overlay: true,
      context: true,
      stallNumbers: false,
      grid: true,
      figure: true,
      shadows: false,
      snap: { on: true, grid: 1 },
    },
  };
}

// A default state with a name and edits applied. Used by the presets that differ from the default.
function stateWith(name, edit) {
  const s = defaultState();
  s.name = name;
  edit(s);
  return s;
}

export const PRESETS = [
  {
    id: 'two-bay-single-helix',
    name: 'Two-bay single helix, five levels',
    description: 'Default. Standalone 300 by 125 ft footprint, two double-loaded bays, single helix ramps, 496 stalls.',
    state: defaultState(),
  },

  {
    id: 'three-bay-sloped-center',
    name: 'Three-bay deck with a sloped center bay, five levels',
    description: 'Standalone 300 by 185 ft footprint, three double-loaded bays, sloped center bay, 764 stalls.',
    state: stateWith('Three-bay deck with a sloped center bay, five levels', (s) => {
      s.footprint.depth = 185;
      s.ramp.type = 'sloped-floor';
      s.ramp.slopedBay = 1;
      s.cores = [stair('S1', 25, 1), elevator('E1', 52, 1), stair('S2', 246, 169)];
    }),
  },

  {
    id: 'double-helix-six',
    name: 'Double helix, six levels',
    description: 'Standalone 360 by 125 ft footprint, two bays, double helix ramps, six levels, 762 stalls.',
    state: stateWith('Double helix, six levels', (s) => {
      s.footprint.width = 360;
      s.levels.count = 6;
      s.ramp.type = 'double-helix';
    }),
  },

  {
    id: 'flat-speed-ramp',
    name: 'Flat floors with a speed ramp, five levels',
    description: 'Standalone 300 by 150 ft footprint, two bays, straight speed ramp in the north strip, 496 stalls.',
    state: stateWith('Flat floors with a speed ramp, five levels', (s) => {
      s.footprint.depth = 150;
      s.ramp.type = 'speed';
    }),
  },

  {
    id: 'split-level-six',
    name: 'Split-level deck, six levels',
    description: 'Standalone 300 by 125 ft footprint, split-level end ramps, six levels, 428 stalls.',
    state: stateWith('Split-level deck, six levels', (s) => {
      s.levels.count = 6;
      s.ramp.type = 'split';
      s.cores = [stair('S1', 57, 1), elevator('E1', 84, 1), stair('S2', 215, 109)];
    }),
  },

  {
    id: 'wrap-deck-five-level',
    name: 'Wrap deck from the Mid-Rise wrap preset',
    description: 'Wrap deck geometry from the Mid-Rise wrap preset, 300 by 125 ft, five levels, R-2 rule on, 496 stalls.',
    state: stateWith('Wrap deck from the Mid-Rise wrap preset', (s) => {
      s.source = 'wrap';
      s.accessible.r2.on = true;
    }),
  },

  {
    id: 'podium-one-level',
    name: 'Podium level under a bar',
    description: 'One level under a bar, 300 by 65 ft, podium source, R-2 rule on, 42 stalls.',
    state: stateWith('Podium level under a bar', (s) => {
      s.source = 'podium';
      s.footprint.depth = 65;
      s.levels.count = 1;
      s.ramp.type = 'none';
      s.cores = [stair('S1', 25, 1), elevator('E1', 52, 1), stair('S2', 142, 1), stair('S3', 246, 49)];
      s.accessible.r2.on = true;
    }),
  },

  {
    id: 'podium-two-level-short-span',
    name: 'Two-level podium under a U building, short-span',
    description: 'Two levels under a U building, 300 by 206 ft, short-span grid, speed ramp in the north strip, south liner on level 1, 231 stalls.',
    state: stateWith('Two-level podium under a U building, short-span', (s) => {
      s.source = 'podium';
      s.footprint.depth = 206;
      s.levels.count = 2;
      s.grid.span = 'short';
      s.ramp.type = 'speed';
      s.ramp.speed.y = 181;
      s.liner = { on: true, side: 'south', depth: 61, levels: [1] };
      s.cores = [stair('S1', 25, 61), elevator('E1', 58, 61), stair('S2', 246, 169)];
      s.accessible.r2.on = true;
    }),
  },
];
