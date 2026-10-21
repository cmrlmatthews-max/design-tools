// Hand-calculated test cases for the mid-rise generator, one per preset (plan section 8).
// Expected values are the section 8 numbers. The arithmetic is in the plan.
//  - unionArea is the union of the bar plates on one bar level. It is listed only where section 8 gives it.
//  - gfa counts every bar level, podium level, and deck level.
//  - parkingRequired for podium-5-over-2 is 323.5 rounded up to 324, as section 8 gives it.
//  - tolerancePct is the allowed deviation in percent for each expected number (plan section 9.1, test 16).

import { PRESETS } from "./presets.js";

const stateOf = (id) => structuredClone(PRESETS.find((p) => p.id === id).state);

export const TEST_CASES = [
  {
    id: 'garden-walkup',
    description: 'Garden walk-up, three floors: three breezeway bars of three floors, 108 units, 4.996 acres.',
    state: stateOf('garden-walkup'),
    // Units 3 x 12 x 3 = 108. GFA 3 x 192 x 66 x 3 = 114,048. Required 108 x 1.25 = 135.
    expect: { units: 108, parkingRequired: 135, parkingProvided: 160, gfa: 114048, tolerancePct: 0.5 },
  },

  {
    id: 'corridor-garden',
    description: 'Corridor garden, four floors: two bars meeting in an L, 100 units.',
    state: stateOf('corridor-garden'),
    // Union 240 x 65 + 160 x 65 - 65 x 65 = 21,775. Units 25 x 4 = 100. GFA 21,775 x 4 = 87,100.
    expect: { unionArea: 21775, units: 100, parkingRequired: 125, parkingProvided: 125, gfa: 87100, tolerancePct: 0.5 },
  },

  {
    id: 'double-bar',
    description: 'Double-loaded bar, five floors (default state): 100 units, 50.0 per acre, parking deficit of 5.',
    state: stateOf('double-bar'),
    // Units 2 x floor(300 / 28) = 20 per floor, 100 total. GFA 300 x 65 x 5 = 97,500.
    expect: { units: 100, parkingRequired: 125, parkingProvided: 120, gfa: 97500, tolerancePct: 0.5 },
  },

  {
    id: 'courtyard-5-over-1',
    description: 'Courtyard, five over one: four bars around a closed court, 280 units, parking deficit of 64.',
    state: stateOf('courtyard-5-over-1'),
    // Union 2 x 250 x 65 + 2 x 220 x 65 - 4 x 65 x 65 = 44,200. Units 56 x 5 = 280.
    // GFA 55,000 podium + 5 x 44,200 = 276,000. Provided 166 podium + 120 surface = 286.
    expect: { unionArea: 44200, units: 280, parkingRequired: 350, parkingProvided: 286, gfa: 276000, tolerancePct: 0.5 },
  },

  {
    id: 'wrap-deck',
    description: 'Wrap with five-level deck: four bars around a 300 x 125 deck, 480 units.',
    state: stateOf('wrap-deck'),
    // Union 450 x 275 - 320 x 145 = 77,350. Units 96 x 5 = 480. Deck stalls floor(5 x 37,500 / 330) = 568.
    // GFA 5 x 77,350 + 5 x 37,500 = 574,250. Provided 568 + 40 = 608.
    expect: { unionArea: 77350, units: 480, parkingRequired: 600, parkingProvided: 608, gfa: 574250, tolerancePct: 0.5 },
  },

  {
    id: 'podium-5-over-2',
    description: 'Podium, five over two with retail: three bars on a parking podium with a retail liner, 230 units.',
    state: stateOf('podium-5-over-2'),
    // Union 300 x 65 + 2 x 200 x 65 - 2 x 65 x 65 = 37,050. Units 46 x 5 = 230.
    // Required 230 x 1.25 + 12 x 3 = 323.5, shown as 324. Provided 145 + 181 = 326.
    // GFA 2 x 60,000 + 5 x 37,050 = 305,250.
    expect: { unionArea: 37050, units: 230, parkingRequired: 324, parkingProvided: 326, gfa: 305250, tolerancePct: 0.5 },
  },
];
