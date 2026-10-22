// Default state and the menu presets for the grading sketch.
// Source: docs/grading-sketch-technical-plan.md sections 2 and 8.
// Units: feet, square feet, cubic yards, degrees. Elevations are local feet on a plane ground with z0 1,000.
// Plan coordinates: east = +x, north = +y.
// Each preset is a complete state object (schema 1). Consumers should deep-copy before editing.

// A closed rectangle ring centered on (cx, cy), with the corners in the order the plan lists them.
function centeredRing(width, depth, cx = 0, cy = 0) {
  const hw = width / 2;
  const hd = depth / 2;
  return [[cx - hw, cy - hd], [cx + hw, cy - hd], [cx + hw, cy + hd], [cx - hw, cy + hd]];
}

// A typed building. The default pad offset is 5 ft (plan decision 14) and the default pad depth is 1.0 ft (decision 13).
function typedBuilding(id, name, outer, { tiers = balancedTiers(1), padOffset = 5 } = {}) {
  return { id, name, source: 'typed', outer, axis: 'auto', tiers, padOffset, padDepth: 1.0 };
}

// Tiers of equal length, each with its FFE balanced on the existing ground.
function balancedTiers(count) {
  return Array.from({ length: count }, () => ({ length: null, ffe: 'balance' }));
}

// The default state (plan section 2). Builds a new object on each call, so every caller gets its own copy.
// It equals the section 8.1 preset.
export function defaultState() {
  return {
    schema: 1,
    name: 'Bar on a cross slope',
    source: 'standalone',

    ground: {
      mode: 'plane',
      plane: { z0: 1000, slope: 5, downhill: 180 },
      margin: 200,
    },

    property: { mode: 'site', ring: [] },

    buildings: [
      {
        id: 'B1', name: 'Bar',
        source: 'typed',
        outer: [[-150, -32.5], [150, -32.5], [150, 32.5], [-150, 32.5]],
        axis: 'auto',
        tiers: [{ length: null, ffe: 'balance' }],
        padOffset: 0,
        padDepth: 1.0,
      },
    ],
    balance: 'pad',
    maxStep: 4,

    drives: [],
    lots: [],
    walls: [],
    autoWalls: { on: true, offset: 5, accepted: [] },
    routes: [],

    // Starting values. Soil decides stable slopes.
    daylight: { on: true, fill: 3, cut: 2 },

    // Caution: 2010 ADA Standards and ICC A117.1 values. The adopted code decides.
    limits: {
      walk: 0.05, ramp: 0.0833, cross: 0.0208, rampRise: 2.5,
      wallFlag: 4,
      lotMin: 0.01, lotMax: 0.05, driveMax: 0.10,
    },

    earthwork: { subdivide: 4, bulking: 1.00 },

    view: {
      style: 'model',
      contours: { on: true, interval: 1, existing: true, proposed: true },
      exaggeration: 1,
      section: null,
      context: true, grid: false, figure: true, shadows: true,
      sun: { azimuth: 135, altitude: 40 },
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

// Section 8.2 and 8.3: the bar on a plane rising 4 percent to the east, with daylight off.
function longBarGround(s) {
  s.ground.plane = { z0: 1000, slope: 4, downhill: 270 };
  s.daylight.on = false;
}

// Section 8.3: the long bar in three equal tiers.
function longBarThreeTiers(s) {
  longBarGround(s);
  s.buildings[0].tiers = balancedTiers(3);
}

// Section 8.4: three garden bars on a plane falling 6 percent to the south, drawn walls on the south pad edges, one lot.
function gardenFallingSite(s) {
  s.ground.plane = { z0: 1000, slope: 6, downhill: 180 };
  s.buildings = [
    typedBuilding('B1', 'Bar south', centeredRing(192, 66, 0, -120)),
    typedBuilding('B2', 'Bar middle', centeredRing(192, 66, 0, 0)),
    typedBuilding('B3', 'Bar north', centeredRing(192, 66, 0, 120)),
  ];
  s.walls = [
    { id: 'W1', line: [[-101, -158], [101, -158]], kind: 'drawn' },
    { id: 'W2', line: [[-101, -38], [101, -38]], kind: 'drawn' },
    { id: 'W3', line: [[-101, 82], [101, 82]], kind: 'drawn' },
  ];
  s.lots = [
    { id: 'L1', ring: [[130, -150], [290, -150], [290, 150], [130, 150]], anchor: [210, 0], start: 'existing', dir: 0, slope: 2, cross: 1 },
  ];
}

// Section 8.5: a deck with a typed FFE inside a wrap. The deck is listed first, so its pad wins where the pads overlap.
function wrapDeckOnSlope(s) {
  s.ground.plane = { z0: 1000, slope: 5, downhill: 180 };
  s.buildings = [
    typedBuilding('B1', 'Deck', centeredRing(300, 125), { tiers: [{ length: null, ffe: 997.875 }] }),
    typedBuilding('B2', 'Wrap', centeredRing(450, 275)),
  ];
}

// Section 8.6: a podium with its FFE typed at 992.60 and a drawn wall on the north pad edge.
function podiumOnFallingSite(s) {
  s.ground.plane = { z0: 1000, slope: 8, downhill: 180 };
  s.buildings = [
    typedBuilding('B1', 'Podium', centeredRing(300, 200), { tiers: [{ length: null, ffe: 992.6 }] }),
  ];
  s.walls = [{ id: 'W1', line: [[-155, 105], [155, 105]], kind: 'drawn' }];
}

// Section 8.7: a flat site with one balanced rectangle.
function flatSite(s) {
  s.ground.plane = { z0: 1000, slope: 0, downhill: 180 };
  s.buildings = [typedBuilding('B1', 'Bar', centeredRing(310, 75))];
}

export const PRESETS = [
  {
    id: 'bar-cross-slope',
    name: 'Bar on a cross slope',
    description: 'Default. Typed 300 by 65 ft bar on a plane falling 5 percent to the south, one balanced tier, daylight at 3:1 fill and 2:1 cut. Grid cut 325.1 and fill 348.2 cy.',
    state: defaultState(),
  },

  {
    id: 'long-bar-one-ffe',
    name: 'Long bar, one FFE',
    description: 'Typed 300 by 65 ft bar on a plane rising 4 percent to the east, one balanced tier, daylight off. Cut and fill 1,083.3 cy each way.',
    state: stateWith('Long bar, one FFE', longBarGround),
  },

  {
    id: 'long-bar-three-tiers',
    name: 'Long bar, three tiers',
    description: 'The long bar split into three balanced tiers, steps of 4.0 ft, daylight off. Cut and fill 361.1 cy each way.',
    state: stateWith('Long bar, three tiers', longBarThreeTiers),
  },

  {
    id: 'garden-falling-site',
    name: 'Garden buildings on a falling site',
    description: 'Three 192 by 66 ft bars on a plane falling 6 percent to the south, drawn walls on the south pad edges, one 2 percent lot. Grid cut 4,208.7 and fill 4,312.3 cy.',
    state: stateWith('Garden buildings on a falling site', gardenFallingSite),
  },

  {
    id: 'wrap-deck-slope',
    name: 'Wrap with a deck on a slope',
    description: 'A 300 by 125 ft deck with its FFE typed at 997.875 inside a 450 by 275 ft wrap at balance, on a plane falling 5 percent to the south. Grid cut 13,359.7 and fill 9,219.3 cy.',
    state: stateWith('Wrap with a deck on a slope', wrapDeckOnSlope),
  },

  {
    id: 'podium-retail-street',
    name: 'Podium with retail at the low street',
    description: 'A 300 by 200 ft podium with its FFE typed at 992.60 on a plane falling 8 percent to the south, with a drawn wall on the north pad edge. The 16.80 ft wall is flagged. Grid cut 21,998.9 cy, fill 0.',
    state: stateWith('Podium with retail at the low street', podiumOnFallingSite),
  },

  {
    id: 'flat-site',
    name: 'Flat site',
    description: 'Typed 310 by 75 ft bar on a flat plane at 1,000 ft, one balanced tier. Cut and fill are zero and there are no walls.',
    state: stateWith('Flat site', flatSite),
  },
];
