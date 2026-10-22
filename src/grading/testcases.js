// Hand-calculated test cases for the grading sketch, one per preset (plan section 8), plus the variants
// of section 8.1 (8.1-wall and 8.1-site) and the subdivide-1 check of section 8.2 (plan section 9.1, test 15).
// Expected values are the section 8 numbers. The arithmetic is in the comments.
//  - padTops: the pad top of each tier, in building order, then tier order (plan section 3.3).
//  - cutCy, fillCy: grid earthwork in cubic yards (plan section 3.8). netCy = fill − cut where section 8 gives it.
//  - wallMax: the tallest wall height (plan section 3.6). exposed: the exposed foundation height (section 3.7).
//  - tolerance: 0.01 ft for elevations and wall heights.
//  - volumeTolerance: 0.1 cy for the closed-form cases, 0.5 cy for the grid cases. The grid values are given to 0.1 cy.

import { PRESETS, defaultState } from "./presets.js";

const stateOf = (id) => structuredClone(PRESETS.find((p) => p.id === id).state);

// Section 8.1-wall: a drawn wall on the south pad edge of the default bar, (−150, −32.5) to (150, −32.5).
function barSouthWall() {
  const s = defaultState();
  s.name = 'Bar on a cross slope, south wall';
  s.walls = [{ id: 'W1', line: [[-150, -32.5], [150, -32.5]], kind: 'drawn' }];
  return s;
}

// Section 8.1-site: the default bar with balance "site", which includes the daylight slopes.
function barSiteBalance() {
  const s = defaultState();
  s.name = 'Bar on a cross slope, site balance';
  s.balance = 'site';
  return s;
}

// Section 8.2 at subdivide 1 (section 9.1, test 15): the sub-cell count drops from 4 to 1.
function longBarSubdivideOne() {
  const s = stateOf('long-bar-one-ffe');
  s.name = 'Long bar, subdivide 1';
  s.earthwork.subdivide = 1;
  return s;
}

export const TEST_CASES = [
  {
    id: 'bar-cross-slope',
    description: 'Default: 300 by 65 ft bar on a plane falling 5 percent to the south, one balanced tier, daylight on.',
    state: stateOf('bar-cross-slope'),
    // Existing at the south face 998.375 = 1,000 − 0.05 × 32.5. North face 1,001.625. Mean 1,000.00, so the pad top is 1,000.00.
    // Grid values from section 8.1. The closed form with the long-side slopes only gives 326.0 and 345.2, not the test value.
    // Net = 348.2 − 325.1 = 23.1.
    expect: {
      padTops: [1000.0],
      cutCy: 325.1,
      fillCy: 348.2,
      netCy: 23.1,
      tolerance: 0.01,
      volumeTolerance: 0.5,
    },
  },

  {
    id: 'bar-cross-slope-south-wall',
    description: 'Section 8.1-wall: the default bar with a drawn wall on the south pad edge.',
    state: barSouthWall(),
    // Wall height 1,000 − 998.375 = 1.625 along the south edge (max and average within 0.01).
    // Grid fill 296.9 and cut 325.1. Net = 296.9 − 325.1 = −28.2.
    expect: {
      padTops: [1000.0],
      cutCy: 325.1,
      fillCy: 296.9,
      netCy: -28.2,
      wallMax: 1.625,
      tolerance: 0.01,
      volumeTolerance: 0.5,
    },
  },

  {
    id: 'bar-cross-slope-site-balance',
    description: 'Section 8.1-site: the default bar with balance "site", which includes the daylight slopes.',
    state: barSiteBalance(),
    // Pad top 999.97 with the balance taken over the whole grid. Grid cut 336.9 and fill 335.5.
    // |fill − cut| = 1.4, which is within the 2 cy the section allows.
    expect: {
      padTops: [999.97],
      cutCy: 336.9,
      fillCy: 335.5,
      tolerance: 0.01,
      volumeTolerance: 0.5,
    },
  },

  {
    id: 'long-bar-one-ffe',
    description: 'Long bar: 300 by 65 ft bar on a plane rising 4 percent to the east, one balanced tier, daylight off.',
    state: stateOf('long-bar-one-ffe'),
    // Rise along the bar 0.04 × 300 = 12 ft. Pad top 1,000.00 (mean existing), FFE 1,001.00.
    // Cut = fill = 0.5 × 150 × 6 × 65 = 29,250 cf. 29,250 ÷ 27 = 1,083.3 cy (grid exact, edges on 2.5 ft lines).
    // Exposed foundation at the west end: 6.0 ft.
    expect: {
      padTops: [1000.0],
      cutCy: 1083.3,
      fillCy: 1083.3,
      exposed: 6.0,
      tolerance: 0.01,
      volumeTolerance: 0.1,
    },
  },

  {
    id: 'long-bar-one-ffe-subdivide-1',
    description: 'Section 8.2 at subdivide 1: the same bar with one sub-cell per grid cell, which is the method check.',
    state: longBarSubdivideOne(),
    // At k = 1 the grid gives 1,000.0 each way. The exact volume is 1,083.3 cy (the k = 4 case).
    expect: {
      padTops: [1000.0],
      cutCy: 1000.0,
      fillCy: 1000.0,
      tolerance: 0.01,
      volumeTolerance: 0.1,
    },
  },

  {
    id: 'long-bar-three-tiers',
    description: 'Long bar in three equal balanced tiers, daylight off. Two pad-step walls.',
    state: stateOf('long-bar-three-tiers'),
    // Pad tops 996, 1,000, 1,004: the mean existing under each third of the bar (x −100, 0, 100).
    // Steps 4.0 ft each. Cut = fill = 3 × 0.5 × 50 × 2 × 65 = 9,750 cf. 9,750 ÷ 27 = 361.1 cy.
    // Pad-step walls at x = −50 and 50 are 4.0 ft high. Exposed foundation 2.0 ft.
    expect: {
      padTops: [996.0, 1000.0, 1004.0],
      cutCy: 361.1,
      fillCy: 361.1,
      exposed: 2.0,
      wallMax: 4.0,
      tolerance: 0.01,
      volumeTolerance: 0.1,
    },
  },

  {
    id: 'garden-falling-site',
    description: 'Three garden bars on a plane falling 6 percent to the south, drawn walls on the south pad edges, one lot.',
    state: stateOf('garden-falling-site'),
    // Pad tops: the mean existing under each pad at y = −120, 0, 120 (slope 0.06). 1,000 − 7.2, 1,000, 1,000 + 7.2.
    // Wall heights 0.06 × 38 = 2.28 on each south pad edge.
    // Grid cut 4,208.7 and fill 4,312.3. Net 103.7 as section 8.4 states. The rounded printed values give 103.6.
    // The grid cut and fill differ from the closed form by the stated edge error (section 8.4).
    expect: {
      padTops: [992.8, 1000.0, 1007.2],
      cutCy: 4208.7,
      fillCy: 4312.3,
      netCy: 103.7,
      wallMax: 2.28,
      tolerance: 0.01,
      volumeTolerance: 0.5,
    },
  },

  {
    id: 'wrap-deck-slope',
    description: 'Deck with a typed FFE inside a wrap on a plane falling 5 percent to the south. The deck pad wins where the pads overlap.',
    state: stateOf('wrap-deck-slope'),
    // Deck pad top 997.875 − 1.0 = 996.875. Existing at the deck south face (y = −62.5) = 1,000 − 0.05 × 62.5 = 996.875.
    // Wrap pad top 1,000.00 (the ring is symmetric about y = 0).
    // One pad-step wall around the deck pad: height 1,000 − 996.875 = 3.125 ft, length 2 × (310 + 135) = 890 ft.
    // Grid cut 13,359.7 and fill 9,219.3. Net = 9,219.3 − 13,359.7 = −4,140.4.
    expect: {
      padTops: [996.875, 1000.0],
      cutCy: 13359.7,
      fillCy: 9219.3,
      netCy: -4140.4,
      wallMax: 3.125,
      tolerance: 0.01,
      volumeTolerance: 0.5,
    },
  },

  {
    id: 'podium-retail-street',
    description: 'Podium with a typed FFE on a plane falling 8 percent to the south, with a drawn wall on the north pad edge.',
    state: stateOf('podium-retail-street'),
    // Pad top 991.60 = 992.60 − 1.0 = existing at the south pad edge (y = −105) = 1,000 − 0.08 × 105.
    // Wall on the north edge: existing 1,000 + 0.08 × 105 = 1,008.40. Height 1,008.40 − 991.60 = 16.80 ft.
    // Grid cut 21,998.9 and fill 0. Without the wall the cut is 26,032.5.
    // Pad only: 310 × 8.4 × 210 = 546,840 cf. 546,840 ÷ 27 = 20,253.3 cy. The grid adds the two corner cones past the wall ends.
    expect: {
      padTops: [991.6],
      cutCy: 21998.9,
      fillCy: 0,
      wallMax: 16.8,
      tolerance: 0.01,
      volumeTolerance: 0.5,
    },
  },

  {
    id: 'flat-site',
    description: 'Flat site: typed 310 by 75 ft bar on a flat plane, one balanced tier, no walls.',
    state: stateOf('flat-site'),
    // Plane slope 0: existing 1,000 everywhere. Pad top 1,000.00, FFE 1,001.00. Cut 0, fill 0, no walls.
    expect: {
      padTops: [1000.0],
      cutCy: 0,
      fillCy: 0,
      wallMax: 0,
      tolerance: 0.01,
      volumeTolerance: 0.1,
    },
  },
];
