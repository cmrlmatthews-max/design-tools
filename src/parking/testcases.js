// Hand-calculated test cases for the parking deck generator, one per preset (plan section 8),
// plus hand example A (section 8.9), which is a test case only and not a menu preset.
// Expected values are the section 8 numbers. The arithmetic is in the comments.
//  - stalls is the final count on all levels, after accessible replacement and aisle losses (plan section 3.6).
//  - sfPerStall is gross area divided by stalls. The plan rounds it to 0.1, so compare after rounding to 0.1.
//  - slope is the level 1 ramp slope as a fraction (plan section 3.4). Presets without a ramp omit it.
//  - accessible is { required, van, car } (plan section 3.6).
//  - tolerance is 0 (plan section 9.1, test 15): stall counts are exact.

import { PRESETS, defaultState } from "./presets.js";

const stateOf = (id) => structuredClone(PRESETS.find((p) => p.id === id).state);

// Hand example A (section 8.9): no cores, every floor-to-floor 10.5 ft.
function handExampleA() {
  const s = defaultState();
  s.name = 'Hand example A';
  s.cores = [];
  s.levels.ftf1 = 10.5;
  return s;
}

export const TEST_CASES = [
  {
    id: 'two-bay-single-helix',
    description: 'Default state: two bays, single helix, five levels.',
    state: stateOf('two-bay-single-helix'),
    // Per level 4 x 27 - 8 = 100. N0 = 500. Table 401-500 gives 9. Van 2, car 7.
    // Aisles 8 x 2 + 5 x ceil(5 / 2) = 31, so 4 lost. Stalls 500 - 4 = 496.
    // Gross 300 x 125 x 5 = 187,500. 187,500 / 496 = 378.02.
    // Level 1 slope 5.5 / 250 = 2.2 percent.
    expect: { stalls: 496, sfPerStall: 378.0, slope: 5.5 / 250, accessible: { required: 9, van: 2, car: 7 }, tolerance: 0 },
  },

  {
    id: 'three-bay-sloped-center',
    description: 'Three bays with a sloped center bay, five levels.',
    state: stateOf('three-bay-sloped-center'),
    // Per level 6 x 27 - 8 = 154. N0 = 770. Table 501-1000 gives ceil(15.4) = 16. Van 3, car 13.
    // Aisles 8 x 3 + 5 x ceil(10 / 2) = 49, so 6 lost. Stalls 770 - 6 = 764.
    // Gross 300 x 185 x 5 = 277,500. 277,500 / 764 = 363.22.
    // Sloped bay 1 level 1 slope 11 / 250 = 4.4 percent.
    expect: { stalls: 764, sfPerStall: 363.2, slope: 11 / 250, accessible: { required: 16, van: 3, car: 13 }, tolerance: 0 },
  },

  {
    id: 'double-helix-six',
    description: 'Double helix, six levels.',
    state: stateOf('double-helix-six'),
    // Run 310, so 34 per row. Per level 4 x 34 - 8 = 128. N0 = 768. Required ceil(15.36) = 16. Van 3, car 13.
    // Aisles 8 x 3 + 5 x ceil(10 / 2) = 49, so 6 lost. Stalls 768 - 6 = 762.
    // Gross 360 x 125 x 6 = 270,000. 270,000 / 762 = 354.33.
    // Level 1 slope 11 / 310 = 3.55 percent.
    expect: { stalls: 762, sfPerStall: 354.3, slope: 11 / 310, accessible: { required: 16, van: 3, car: 13 }, tolerance: 0 },
  },

  {
    id: 'flat-speed-ramp',
    description: 'Flat floors with a straight speed ramp in the north strip, five levels.',
    state: stateOf('flat-speed-ramp'),
    // Per level 4 x 27 - 8 = 100. N0 = 500. Required 9. Van 2, car 7. Aisles lose 4. Stalls 496.
    // The speed ramp sits in the strip (y 123 to 147 within 121 to 149), so it costs no stalls.
    // Gross 300 x 150 x 5 = 225,000. 225,000 / 496 = 453.63.
    // Level 1 slope 11 / (82 + 10) = 11.96 percent.
    expect: { stalls: 496, sfPerStall: 453.6, slope: 11 / 92, accessible: { required: 9, van: 2, car: 7 }, tolerance: 0 },
  },

  {
    id: 'split-level-six',
    description: 'Split-level deck with end ramps, six levels.',
    state: stateOf('split-level-six'),
    // End zones 36 + 2 x 10 = 56 each. Run 298 - 112 = 186, so 20 per row. Per level 4 x 20 - 8 = 72.
    // N0 = 6 x 72 = 432. Required 9. Van 2, car 7. Aisles lose 4. Stalls 428.
    // Gross 300 x 125 x 6 = 225,000. 225,000 / 428 = 525.70.
    // Level 1 end ramp slope 5.5 / (36 + 10) = 11.96 percent.
    expect: { stalls: 428, sfPerStall: 525.7, slope: 5.5 / 46, accessible: { required: 9, van: 2, car: 7 }, tolerance: 0 },
  },

  {
    id: 'wrap-deck-five-level',
    description: 'Wrap deck from the Mid-Rise wrap preset, five levels, R-2 rule on.',
    state: stateOf('wrap-deck-five-level'),
    // Same geometry as 8.1: N0 = 500. R-2 gives max(1, ceil(500 x 0.02)) = 10, above the table 9. Required 10.
    // Van 2, car 8. Aisles 16 + 5 x 3 = 31, so 4 lost. Stalls 496.
    // Standalone level 1 slope 5.5 / 250 = 2.2 percent. The 2.1 percent in section 8.6 applies inside a project.
    // Gross 187,500 / 496 = 378.02.
    expect: { stalls: 496, sfPerStall: 378.0, slope: 5.5 / 250, accessible: { required: 10, van: 2, car: 8 }, tolerance: 0 },
  },

  {
    id: 'podium-one-level',
    description: 'One level under a bar, long-span, podium source, R-2 rule on.',
    state: stateOf('podium-one-level'),
    // Run 250, so 27 per row. Two rows: 54. Cores lose 11 (S1 3, E1 2, S2 3 in the south row; S3 3 in the north row).
    // N0 = 43. Table 26-50 gives 2. R-2 gives 1. Required 2. Van 1, car 1. Aisle 8 gives 1 lost. Stalls 42.
    // Gross 300 x 65 = 19,500. 19,500 / 42 = 464.29.
    expect: { stalls: 42, sfPerStall: 464.3, accessible: { required: 2, van: 1, car: 1 }, tolerance: 0 },
  },

  {
    id: 'podium-two-level-short-span',
    description: 'Two levels under a U building, short-span grid, speed ramp in the north strip, south liner on level 1.',
    state: stateOf('podium-two-level-short-span'),
    // Short-span row 8 x 3 + 1 = 25. Level 1: 4 rows x 25 - 8 = 92 (liner removes bay 1). Level 2: 6 x 25 - 8 = 142.
    // N0 = 234. Table 201-300 gives 7. R-2 gives ceil(4.68) = 5. Required 7. Van 2, car 5.
    // Aisles 16 + 5 x ceil(3 / 2) = 26, so 3 lost. Stalls 231.
    // Gross 2 x 300 x 206 - 300 x 61 = 105,300. 105,300 / 231 = 455.84.
    // Speed ramp level 1 slope 11 / (82 + 10) = 11.96 percent.
    expect: { stalls: 231, sfPerStall: 455.8, slope: 11 / 92, accessible: { required: 7, van: 2, car: 5 }, tolerance: 0 },
  },

  {
    id: 'hand-example-a',
    description: 'Hand example A: no cores, every floor-to-floor 10.5 ft. Test case only.',
    state: handExampleA(),
    // Per level 4 x 27 = 108, no cores. N0 = 540. Table 501-1000 gives ceil(10.8) = 11. Van 2, car 9.
    // Aisles 16 + 5 x ceil(7 / 2) = 36, so 4 lost. Stalls 536.
    // Gross 300 x 125 x 5 = 187,500. 187,500 / 536 = 349.81.
    // Level 1 slope 5.25 / 250 = 2.1 percent.
    expect: { stalls: 536, sfPerStall: 349.8, slope: 5.25 / 250, accessible: { required: 11, van: 2, car: 9 }, tolerance: 0 },
  },
];
