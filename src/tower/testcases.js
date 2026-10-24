// Hand-calculated test cases for the tower massing tool (plan section 12, phase 6).
// Every expected value below was worked out by hand. The arithmetic is in each comment.
//
// Conventions (plan sections 2, 3 and 5):
//  - Floor numbers start at 1. Within a segment, t = i / (n - 1): 0 at the bottom floor, 1 at the top.
//  - A setback with floor F applies to floor F and to every floor above it.
//  - GFA = sum of all plate areas, mechanical floors included. A crown adds no floor area.
//  - Total height = top of the highest floor + crown height.
//  - Site is the default 250 x 200 ft (50,000 sf). Setbacks are the default 10 ft. Every plate in these
//    cases fits inside the 230 x 180 allowed footprint, so the envelope never changes GFA.
//  - The base crown is flat with height 0, so height = top of the highest floor. Only TC-08 uses a crown height.
//    (The default state has a flat crown of 20 ft. It is set to 0 here so each height is easy to check by hand.)
//  - tolerancePct 0.01 is used for every case. All values are exact in binary floating point.
//  - expect has only gfa, floors, height and tolerancePct, per the module contract. FAR and site coverage
//    are checked through gfa: FAR = gfa / 50,000 and coverage = floor 1 area / 50,000 (noted in the comments).

import { PROGRAM_DEFAULTS } from './presets.js';

const copyPrograms = () =>
  Object.fromEntries(Object.entries(PROGRAM_DEFAULTS).map(([k, v]) => [k, { ...v }]));

const rect = (w, d) => ({ type: 'rect', w, d, radius: 0, points: [] });

// One tower segment. Defaults are the default-state segment: 10 floors, 10 ft, 100 x 100, no transforms.
const seg = (over = {}) => ({
  floors: 10,
  ftf: 10,
  program: 'residential',
  shape: rect(100, 100),
  offset: { x: 0, y: 0 },
  rotation: 0,
  taper: { x: 0, y: 0, curve: 'linear' },
  twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
  lean: { x: 0, y: 0 },
  ...over,
});

// Podium off by default. podium(...) turns it on with the given overrides.
const podium = (over = {}) => ({
  on: true,
  floors: 4,
  groundFtf: 18,
  ftf: 14,
  shape: rect(220, 170),
  offset: { x: 0, y: 0 },
  program: 'retail',
  upperProgram: 'amenity',
  ...over,
});

// Full default-state structure (plan section 2). Only the patch changes per case.
const baseState = () => ({
  schema: 1,
  name: 'Test',
  site: {
    shape: 'rect',
    width: 250,
    depth: 200,
    points: [],
    setbacks: { front: 10, back: 10, left: 10, right: 10 },
    heightLimit: 400,
    stepback: { on: false, aboveHeight: 85, distance: 15 },
  },
  context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
  podium: podium({ on: false }),
  segments: [seg()],
  setbacks: [],
  mechanical: [],
  carves: [],
  cuts: [],
  crown: { type: 'flat', height: 0, steps: 3, slopeSide: 'front' },
  programs: copyPrograms(),
  targets: { gfa: 0, far: 0 },
  view: {
    style: 'model',
    colorBy: 'zone',
    floorLines: true,
    shadows: true,
    sun: { azimuth: 135, altitude: 40 },
    grid: true,
    figure: true,
  },
});

const makeState = (name, patch) => ({ ...baseState(), name, ...patch });

const ALL_SIDES = ['front', 'back', 'left', 'right'];

export const TEST_CASES = [
  {
    id: 'tc-01-box-default',
    description: 'Default 100 x 100 box, 10 floors at 10 ft. GFA, height, FAR 2.00 on the 50,000 sf site.',
    // GFA = 100 x 100 x 10 = 100,000 sf. Height = 10 x 10 = 100 ft. FAR = 100,000 / 50,000 = 2.00.
    state: makeState('TC-01', { segments: [seg({ floors: 10 })] }),
    expect: { gfa: 100000, floors: 10, height: 100, tolerancePct: 0.01 },
  },

  {
    id: 'tc-02-box-60x40-25f-ftf13.5',
    description: 'Box 60 x 40, 25 floors at 13.5 ft. Different plate size, floor count and floor height.',
    // GFA = 60 x 40 x 25 = 2,400 x 25 = 60,000 sf. Height = 25 x 13.5 = 337.5 ft.
    state: makeState('TC-02', { segments: [seg({ floors: 25, ftf: 13.5, shape: rect(60, 40) })] }),
    expect: { gfa: 60000, floors: 25, height: 337.5, tolerancePct: 0.01 },
  },

  {
    id: 'tc-03-single-floor-coverage',
    description: 'Single 180 x 90 floor at 10 ft. GFA equals the floor 1 area, so site coverage is checked here.',
    // GFA = 180 x 90 = 16,200 sf. Coverage = 16,200 / 50,000 = 32.4%. Height = 1 x 10 = 10 ft.
    state: makeState('TC-03', { segments: [seg({ floors: 1, shape: rect(180, 90) })] }),
    expect: { gfa: 16200, floors: 1, height: 10, tolerancePct: 0.01 },
  },

  {
    id: 'tc-04-far-120x80-12f',
    description: 'Box 120 x 80, 12 floors at 10 ft. FAR check: 115,200 / 50,000 = 2.304.',
    // Plate = 120 x 80 = 9,600 sf. GFA = 9,600 x 12 = 115,200 sf. FAR = 115,200 / 50,000 = 2.304.
    // Height = 12 x 10 = 120 ft.
    state: makeState('TC-04', { segments: [seg({ floors: 12, shape: rect(120, 80) })] }),
    expect: { gfa: 115200, floors: 12, height: 120, tolerancePct: 0.01 },
  },

  {
    id: 'tc-05-podium-tower-gfa',
    description: 'Four-floor podium (220 x 170, ground 18 ft, upper 15 ft) plus a 30-floor 110 x 80 tower at 10 ft.',
    // Podium plate = 220 x 170 = 37,400 sf. Podium GFA = 37,400 x 4 = 149,600 sf.
    // Tower plate = 110 x 80 = 8,800 sf. Tower GFA = 8,800 x 30 = 264,000 sf.
    // GFA = 149,600 + 264,000 = 413,600 sf. Floors = 4 + 30 = 34.
    // Podium height = 18 + 15 x 3 = 63 ft. Tower height = 30 x 10 = 300 ft. Total = 63 + 300 = 363 ft.
    state: makeState('TC-05', {
      podium: podium({ floors: 4, groundFtf: 18, ftf: 15, shape: rect(220, 170) }),
      segments: [seg({ floors: 30, shape: rect(110, 80) })],
    }),
    expect: { gfa: 413600, floors: 34, height: 363, tolerancePct: 0.01 },
  },

  {
    id: 'tc-06-podium-ground-ftf',
    description: 'Two-floor podium (100 x 100, ground 18 ft, floor 2 at 15 ft) plus a 5-floor 80 x 80 tower at 10 ft.',
    // Podium GFA = 100 x 100 x 2 = 20,000 sf. Tower GFA = 80 x 80 x 5 = 6,400 x 5 = 32,000 sf.
    // GFA = 20,000 + 32,000 = 52,000 sf. Floors = 2 + 5 = 7.
    // Height = 18 (ground) + 15 (floor 2) + 5 x 10 = 33 + 50 = 83 ft.
    state: makeState('TC-06', {
      podium: podium({ floors: 2, groundFtf: 18, ftf: 15, shape: rect(100, 100) }),
      segments: [seg({ floors: 5, shape: rect(80, 80) })],
    }),
    expect: { gfa: 52000, floors: 7, height: 83, tolerancePct: 0.01 },
  },

  {
    id: 'tc-07-mechanical-floor',
    description: 'Box 100 x 100, 10 floors at 10 ft, with a 16 ft mechanical floor after floor 5.',
    // Mechanical plate = plate of floor 5 = 100 x 100 = 10,000 sf. Mechanical floors count in GFA.
    // GFA = 100,000 + 10,000 = 110,000 sf. Floors = 10 + 1 = 11.
    // Height = 10 x 10 + 16 = 116 ft.
    state: makeState('TC-07', {
      segments: [seg({ floors: 10 })],
      mechanical: [{ afterFloor: 5, ftf: 16 }],
    }),
    expect: { gfa: 110000, floors: 11, height: 116, tolerancePct: 0.01 },
  },

  {
    id: 'tc-08-screen-crown-height',
    description: 'Box 100 x 100, 10 floors at 10 ft, with a 20 ft screen crown. The crown adds height, not area.',
    // GFA = 100 x 100 x 10 = 100,000 sf (crown adds no floor area).
    // Height = top of floor 10 (100 ft) + crown 20 ft = 120 ft.
    state: makeState('TC-08', {
      segments: [seg({ floors: 10 })],
      crown: { type: 'screen', height: 20, steps: 3, slopeSide: 'front' },
    }),
    expect: { gfa: 100000, height: 120, tolerancePct: 0.01 },
  },

  {
    id: 'tc-09-setback-all-sides-floor6',
    description: 'Box 100 x 100, 10 floors. All-sides 10 ft setback from floor 6 gives an inner 80 x 80 square above floor 5.',
    // Floors 1-5: 100 x 100 = 10,000 sf each, total 50,000 sf.
    // Floors 6-10: (100 - 2 x 10) = 80 square = 6,400 sf each, total 32,000 sf.
    // GFA = 50,000 + 32,000 = 82,000 sf. Height = 100 ft.
    state: makeState('TC-09', {
      segments: [seg({ floors: 10 })],
      setbacks: [{ floor: 6, distance: 10, sides: ALL_SIDES }],
    }),
    expect: { gfa: 82000, floors: 10, height: 100, tolerancePct: 0.01 },
  },

  {
    id: 'tc-10-setback-front-only',
    description: 'Box 100 x 100, 10 floors. A 10 ft front-only setback from floor 1 leaves a 100 x 90 plate.',
    // Plate = w x (d - s) = 100 x (100 - 10) = 100 x 90 = 9,000 sf.
    // GFA = 9,000 x 10 = 90,000 sf. Height = 100 ft.
    state: makeState('TC-10', {
      segments: [seg({ floors: 10 })],
      setbacks: [{ floor: 1, distance: 10, sides: ['front'] }],
    }),
    expect: { gfa: 90000, floors: 10, height: 100, tolerancePct: 0.01 },
  },

  {
    id: 'tc-11-linear-taper',
    description: 'Three floors of a 90 x 90 plate, tapering -10% in X and Y from bottom to top (linear).',
    // Scale = 1 + (-10/100) x t. t = 0, 0.5, 1 for floors 1, 2, 3, so scales are 1.00, 0.95, 0.90.
    // Floor 1: 90 x 90 = 8,100 sf.
    // Floor 2: (90 x 0.95) x (90 x 0.95) = 85.5 x 85.5 = 7,310.25 sf.
    // Floor 3: (90 x 0.90) x (90 x 0.90) = 81 x 81 = 6,561 sf.
    // GFA = 8,100 + 7,310.25 + 6,561 = 21,971.25 sf. Height = 3 x 10 = 30 ft.
    state: makeState('TC-11', {
      segments: [seg({ floors: 3, shape: rect(90, 90), taper: { x: -10, y: -10, curve: 'linear' } })],
    }),
    expect: { gfa: 21971.25, floors: 3, height: 30, tolerancePct: 0.01 },
  },

  {
    id: 'tc-12-twist-keeps-gfa',
    description: 'Box 100 x 100, 10 floors, twisting 45 degrees over the height. Rotation must not change GFA.',
    // Each plate is a rotated 100 x 100 square. Area = 100 x 100 = 10,000 sf per floor.
    // GFA = 10,000 x 10 = 100,000 sf. Height = 100 ft.
    state: makeState('TC-12', {
      segments: [seg({ floors: 10, twist: { deg: 45, start: 0, end: 1, curve: 'linear' } })],
    }),
    expect: { gfa: 100000, floors: 10, height: 100, tolerancePct: 0.01 },
  },

  {
    id: 'tc-13-shift-and-lean-keep-gfa',
    description: 'Box 100 x 100, 10 floors, shifted by (20, -10) and leaning 30 ft in X. Translation must not change GFA.',
    // Each plate is a translated 100 x 100 square. Area = 10,000 sf per floor.
    // GFA = 10,000 x 10 = 100,000 sf. Height = 100 ft.
    state: makeState('TC-13', {
      segments: [seg({ floors: 10, offset: { x: 20, y: -10 }, lean: { x: 30, y: 0 } })],
    }),
    expect: { gfa: 100000, floors: 10, height: 100, tolerancePct: 0.01 },
  },

  {
    id: 'tc-14-two-segments',
    description: 'Two stacked segments: 4 floors of 100 x 100 at 10 ft, then 6 floors of 60 x 60 at 13.5 ft.',
    // Segment 1 GFA = 100 x 100 x 4 = 40,000 sf. Segment 2 GFA = 60 x 60 x 6 = 3,600 x 6 = 21,600 sf.
    // GFA = 40,000 + 21,600 = 61,600 sf. Floors = 4 + 6 = 10.
    // Height = 4 x 10 + 6 x 13.5 = 40 + 81 = 121 ft.
    state: makeState('TC-14', {
      segments: [
        seg({ floors: 4, ftf: 10, shape: rect(100, 100) }),
        seg({ floors: 6, ftf: 13.5, shape: rect(60, 60) }),
      ],
    }),
    expect: { gfa: 61600, floors: 10, height: 121, tolerancePct: 0.01 },
  },

  {
    id: 'tc-15-u-podium-gfa-floors',
    description: 'U-shaped multifamily on podium (the U preset): 260 x 220 site, 6-floor podium, then 1 amenity + 16 residential floors on a 200 x 140 U with 50 ft arms.',
    // Podium plate = 240 x 200 = 48,000 sf. Podium GFA = 48,000 x 6 = 288,000 sf.
    // U plate = w x d - (w - 2a) x (d - a) = 200 x 140 - (200 - 100) x (140 - 50) = 28,000 - 9,000 = 19,000 sf.
    // Tower = 1 + 16 = 17 floors, all on the U plate. Tower GFA = 19,000 x 17 = 323,000 sf.
    // GFA = 288,000 + 323,000 = 611,000 sf. Floors = 6 + 17 = 23.
    state: makeState('TC-15', {
      site: { ...baseState().site, width: 260, depth: 220, heightLimit: 0 },
      podium: podium({ floors: 6, groundFtf: 18, ftf: 10.5, shape: rect(240, 200), program: 'retail', upperProgram: 'parking' }),
      segments: [
        seg({ floors: 1, ftf: 15, program: 'amenity', shape: { type: 'U', w: 200, d: 140, radius: 0, arm: 50, points: [] } }),
        seg({ floors: 16, ftf: 10, shape: { type: 'U', w: 200, d: 140, radius: 0, arm: 50, points: [] } }),
      ],
      crown: { type: 'flat', height: 4, steps: 3, slopeSide: 'front' },
    }),
    expect: { gfa: 611000, floors: 23, tolerancePct: 0.01 },
  },
];
