// Hand-calculated test cases for the plate planner, one per preset (plan section 8).
// Expected values are the section 8 numbers. The arithmetic is in the comments.
//  - units: unit count (multifamily). keys and bays: hotel key count and bay count.
//  - counts: units by type id (hotel: keys by type id). accessible: hotel accessible keys (section 3.10).
//  - corners: wrap corner units (section 3.5 item 4). pockets: concave pocket supports (section 3.5 item 5).
//  - nrsf: net rentable square feet, tolerance 0.5 sf. efficiency: NRSF ÷ GSF, efficiencyTolerance 0.0005.
// Counts by type are the section 8 numbers. The mix rule of section 3.6 allows each type within 1 of its target.

import { PRESETS } from "./presets.js";

const stateOf = (id) => structuredClone(PRESETS.find((p) => p.id === id).state);

export const TEST_CASES = [
  {
    id: 'double-loaded-bar',
    description: 'Default: drawn 300 by 65 ft rectangle, bar corridor, 30 ft core on the north side, multifamily mix.',
    state: stateOf('double-loaded-bar'),
    // Runs: south 278, north-east 124, north-west 124. ΣL = 526. Each depth d = (65 − 5.67) ÷ 2 − 1 = 28.665.
    // NRSF = 526 × 28.665 = 15,077.8. GSF = 300 × 65 = 19,500. Efficiency = 15,077.8 ÷ 19,500 = 0.7732.
    // N = floor(526 ÷ 30.433) = 17. A bar has no wrap corners and no pockets.
    expect: {
      units: 17,
      counts: { studio: 2, '1br': 6, '1brden': 2, '2br': 5, '3br': 2 },
      corners: 0,
      pockets: 0,
      nrsf: 15077.8,
      efficiency: 0.7732,
      tolerance: 0.5,
      efficiencyTolerance: 0.0005,
    },
  },

  {
    id: 'hotel-bar',
    description: 'Hotel bar: 240 by 60 ft, corridor clear 6.0 ft, no core, one accessible key per level.',
    state: stateOf('hotel-bar'),
    // Runs: 101 + 101 + 97 + 97. ΣL = 396. Depth d = (60 − 6) ÷ 2 − 1 = 26.0.
    // NRSF = 396 × 26.0 = 10,296.0. GSF = 240 × 60 = 14,400. Efficiency = 10,296.0 ÷ 14,400 = 0.7150.
    // Mix keys: floor((396 − 15.5) ÷ 14.895) = 25 targets (king 16, double queen 8, suite 1). The reference fill
    // places king 17 (inside the ±1 mix rule), so the mix keys total 26 and the accessible key makes 27.
    // Keys 27 = king 17 + double queen 8 + suite 1 + accessible 1. Bays 28 = 17 + 8 + 2 × 1 + 1.
    expect: {
      keys: 27,
      bays: 28,
      counts: { king: 17, dq: 8, suite: 1 },
      accessible: 1,
      corners: 0,
      pockets: 0,
      nrsf: 10296.0,
      efficiency: 0.7150,
      tolerance: 0.5,
      efficiencyTolerance: 0.0005,
    },
  },

  {
    id: 'l-plate-60-ft-arms',
    description: 'L plate, 60 ft arms, no core and no elevators. Den and 3BR drop at this depth.',
    state: stateOf('l-plate-60-ft-arms'),
    // Depth d = (60 − 5.67) ÷ 2 − 1 = 26.165. Den (lo 32.49) and 3BR (lo 49.68) do not fit and drop.
    // Wrap corner at (0, 0): e = (1,100 + 26.165²) ÷ (2 × 26.165) = 34.103, area 1,100.0.
    // Pocket at (60, 60): 26.165² = 684.6. Runs: south 153.897, north arm 130, east arm 70, west 93.897. ΣL = 447.794.
    // NRSF = 447.794 × 26.165 + 1,100.0 = 12,816.5. GSF = 16,800. Efficiency = 0.7629.
    // Units: studio 2, 1BR 8, 2BR 6 (including the corner).
    expect: {
      units: 16,
      counts: { studio: 2, '1br': 8, '2br': 6 },
      corners: 1,
      pockets: 1,
      nrsf: 12816.5,
      efficiency: 0.7629,
      tolerance: 0.5,
      efficiencyTolerance: 0.0005,
    },
  },

  {
    id: 'u-plate-60-ft-arms',
    description: 'U plate, 60 ft arms, open court, no core and no elevators.',
    state: stateOf('u-plate-60-ft-arms'),
    // Depth d = 26.165 as in the L. Two wrap corners (1,100.0 each) and two pockets (684.6 each).
    // Runs: south 198 − 2 × 34.103 = 129.794; east 93.897; east arm inner side 70; court base 82; west arm inner side 70;
    // west 93.897. ΣL = 539.588.
    // NRSF = 539.588 × 26.165 + 2 × 1,100.0 = 16,318.3. GSF = 21,600. Efficiency = 0.7555.
    // Units: studio 3, 1BR 12, 2BR 6 (including the 2 corners).
    expect: {
      units: 21,
      counts: { studio: 3, '1br': 12, '2br': 6 },
      corners: 2,
      pockets: 2,
      nrsf: 16318.3,
      efficiency: 0.7555,
      tolerance: 0.5,
      efficiencyTolerance: 0.0005,
    },
  },

  {
    id: 'point-tower',
    description: 'Point tower: 100 by 100 ft plate, 30 by 30 ft core with the stairs and elevators, corridor ring.',
    state: stateOf('point-tower'),
    // Depth d = (100 − 41.34) ÷ 2 − 1 = 28.33. Corner legs e = (1,100 + 28.33²) ÷ (2 × 28.33) = 33.579, area 1,100.0.
    // Four runs of 98 − 2 × 33.579 = 30.842, each taking one 1BR + den at 30.84.
    // NRSF = 98² − 41.34² = 9,604 − 1,709.0 = 7,895.0. GSF = 10,000. Efficiency = 0.7895.
    // Units: 2BR 4 (the corners), 1BR + den 4. No pockets on a point tower.
    expect: {
      units: 8,
      counts: { '2br': 4, '1brden': 4 },
      corners: 4,
      pockets: 0,
      nrsf: 7895.0,
      efficiency: 0.7895,
      tolerance: 0.5,
      efficiencyTolerance: 0.0005,
    },
  },

  {
    id: 'courtyard-typed-o',
    description: 'Typed O plate, 250 by 220 ft with a 120 by 90 ft court, 30 ft core on the east run, manual stairs.',
    state: stateOf('courtyard-typed-o'),
    // Depth d = 28.665. Outer corners: e = 33.520, area 1,100.0 each (4 corners). Court pockets: 4.
    // Outer runs: south and north 180.96 less the 11 ft stair each, two runs of 84.98 per side (339.92 total);
    // east 150.96 less the 30 ft core, two runs of 60.48 (120.96); west 150.96. Outer total 611.84.
    // Court runs (area line 122 × 92): south and north 122 less the 11 ft stair, two runs of 55.5 per side (222 total);
    // east and west 92 each. Court total 406. ΣL = 611.84 + 406 = 1,017.84. NRSF = 1,017.84 × 28.665 + 4 × 1,100.0 = 33,576.5. GSF = 44,200. Efficiency = 0.7596.
    // Units: studio 7, 1BR 15, den 4, 2BR 11 (including the 4 corners), 3BR 2. (The plan said studio 6, 1BR 16. On a 55.5 ft
    // court run, after the 2BR the last slot must be 15.5 to 20.61 ft wide, and only a studio fits; the fill rule decides.)
    expect: {
      units: 39,
      counts: { studio: 7, '1br': 15, '1brden': 4, '2br': 11, '3br': 2 },
      corners: 4,
      pockets: 4,
      nrsf: 33576.5,
      efficiency: 0.7596,
      tolerance: 0.5,
      efficiencyTolerance: 0.0005,
    },
  },
];

/**
 * The leftover fixture (Cade's hotel tower, October 26, 2026): a 140 ft square turned 45 degrees (half diagonal 99 ft),
 * its north and south corners rounded (radius 50 ft, `segs` segments per 90 degree arc), its east and west corners cut
 * flat at x = ±77 (flat sides 44 ft long), then the whole plate turned `rot` degrees counter-clockwise about the origin.
 * About 154 × 156 ft. With the auto core (hotel: about 62 × 33 ft) and its point corridor, the facade north and south of
 * the corridor lies 34 to 55 ft beyond the corridor face. → Ring (counter-clockwise, 0.001 ft)
 */
export function hotelTowerPlate(rot = 0, { segs = 10 } = {}) {
  const h = 99, r = 50, dc = r * Math.SQRT2;
  const pts = [];
  const arc = (cy, a0) => { for (let i = 0; i <= segs; i++) { const t = ((a0 - 45 + (90 * i) / segs) * Math.PI) / 180; pts.push([r * Math.cos(t), cy + r * Math.sin(t)]); } };
  arc(-h + dc, -90);                                   // south
  pts.push([77, -(h - 77)], [77, h - 77]);             // east flat side
  arc(h - dc, 90);                                     // north
  pts.push([-77, h - 77], [-77, -(h - 77)]);           // west flat side
  const c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180);
  const q = (v) => Math.round(v * 1000) / 1000 + 0;
  return pts.map(([x, y]) => [q(x * c - y * s), q(x * s + y * c)]);
}
