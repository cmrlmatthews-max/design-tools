// Program defaults and presets for the tower massing tool.
// Source: tower-generator-technical-plan.md sections 2, 6 and 10.
// Units: feet, square feet, degrees. ftf is floor-to-floor in decimal feet (13.5 = 13'-6").
// unitFactor is a fraction (0.85 = 85%), or null for programs that have no unit count.
// Each preset is a complete state object (schema 1). Consumers should deep-copy before editing.

export const PROGRAM_DEFAULTS = {
  residential: { ftf: 10,   unitSize: 850,  unitFactor: 0.85, color: '#4f7fd1' }, // blue
  hotel:       { ftf: 10,   unitSize: 400,  unitFactor: 0.80, color: '#8a63c9' }, // purple
  office:      { ftf: 13.5, unitSize: null, unitFactor: null, color: '#2f9e9a' }, // teal
  retail:      { ftf: 18,   unitSize: null, unitFactor: null, color: '#d9a22b' }, // amber
  amenity:     { ftf: 15,   unitSize: null, unitFactor: null, color: '#58a65c' }, // green
  parking:     { ftf: 10.5, unitSize: 350,  unitFactor: 1.00, color: '#8b929a' }, // gray
  mechanical:  { ftf: 16,   unitSize: null, unitFactor: null, color: '#e0762f' }, // orange
};

const copyPrograms = () =>
  Object.fromEntries(Object.entries(PROGRAM_DEFAULTS).map(([k, v]) => [k, { ...v }]));

const rect = (w, d) => ({ type: 'rect', w, d, radius: 0, points: [] });

const lShape = (w, d, arm) => ({ type: 'L', w, d, radius: 0, arm, points: [] });

const uShape = (w, d, arm) => ({ type: 'U', w, d, radius: 0, arm, points: [] });

export const PRESETS = [
  {
    id: 'point-tower',
    name: 'Slim residential point tower',
    description: 'A slim 45-floor residential point tower on a two-floor retail and lobby podium, tapering 10% over its height and capped by a screen crown.',
    state: {
      schema: 1,
      name: 'Slim residential point tower',
      site: {
        shape: 'rect', width: 150, depth: 150, points: [],
        setbacks: { front: 10, back: 10, left: 10, right: 10 },
        heightLimit: 550,                       // planned tower top 503 ft (483 + 20 ft screen crown)
        stepback: { on: false, aboveHeight: 85, distance: 15 },
      },
      context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
      podium: {
        on: true, floors: 2, groundFtf: 18, ftf: 15,
        shape: rect(100, 100), offset: { x: 0, y: 0 },
        program: 'retail', upperProgram: 'amenity',
      },
      segments: [
        {
          floors: 45, ftf: 10, program: 'residential',
          shape: rect(90, 90), offset: { x: 0, y: 0 }, rotation: 0,
          taper: { x: -10, y: -10, curve: 'linear' },
          twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
          lean: { x: 0, y: 0 },
        },
      ],
      setbacks: [], mechanical: [], carves: [], cuts: [],
      crown: { type: 'screen', height: 20, steps: 3, slopeSide: 'front' },
      core: { mode: 'percent', percent: 20, w: 40, d: 30 },
      programs: copyPrograms(),
      targets: { gfa: 0, far: 0 },
      view: {
        style: 'model', colorBy: 'program', floorLines: true, shadows: true,
        sun: { azimuth: 135, altitude: 40 }, grid: true, figure: true,
      },
    },
  },

  {
    id: 'office-slab',
    name: 'Office slab',
    description: 'A 32-floor office slab with no podium, set back 10 feet on all sides at floors 20 and 28 under a flat roof with a 4-foot parapet.',
    state: {
      schema: 1,
      name: 'Office slab',
      site: {
        shape: 'rect', width: 260, depth: 160, points: [],
        setbacks: { front: 15, back: 15, left: 15, right: 15 },
        heightLimit: 500,                       // planned tower top 436 ft (432 + 4 ft parapet)
        stepback: { on: false, aboveHeight: 85, distance: 15 },
      },
      context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
      podium: {
        on: false, floors: 4, groundFtf: 18, ftf: 14,
        shape: rect(220, 170), offset: { x: 0, y: 0 },
        program: 'retail', upperProgram: 'amenity',
      },
      segments: [
        {
          floors: 32, ftf: 13.5, program: 'office',
          shape: rect(200, 90), offset: { x: 0, y: 0 }, rotation: 0,
          taper: { x: 0, y: 0, curve: 'linear' },
          twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
          lean: { x: 0, y: 0 },
        },
      ],
      setbacks: [
        { floor: 20, distance: 10, sides: ['front', 'back', 'left', 'right'] },
        { floor: 28, distance: 10, sides: ['front', 'back', 'left', 'right'] },
      ],
      mechanical: [], carves: [], cuts: [],
      crown: { type: 'flat', height: 4, steps: 3, slopeSide: 'front' },
      core: { mode: 'percent', percent: 20, w: 40, d: 30 },
      programs: copyPrograms(),
      targets: { gfa: 0, far: 0 },
      view: {
        style: 'model', colorBy: 'program', floorLines: true, shadows: true,
        sun: { azimuth: 135, altitude: 40 }, grid: true, figure: true,
      },
    },
  },

  {
    id: 'hotel-podium',
    name: 'Hotel on a podium',
    description: 'A 24-floor hotel tower on a four-level retail and amenity podium, finished with a three-step crown.',
    state: {
      schema: 1,
      name: 'Hotel on a podium',
      site: {
        shape: 'rect', width: 250, depth: 200, points: [],
        setbacks: { front: 10, back: 10, left: 10, right: 10 },
        heightLimit: 350,                       // planned tower top 318 ft (303 + 15 ft crown)
        stepback: { on: false, aboveHeight: 85, distance: 15 },
      },
      context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
      podium: {
        on: true, floors: 4, groundFtf: 18, ftf: 15,
        shape: rect(220, 170), offset: { x: 0, y: 0 },
        program: 'retail', upperProgram: 'amenity',
      },
      segments: [
        {
          floors: 24, ftf: 10, program: 'hotel',
          shape: rect(160, 65), offset: { x: 0, y: 0 }, rotation: 0,
          taper: { x: 0, y: 0, curve: 'linear' },
          twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
          lean: { x: 0, y: 0 },
        },
      ],
      setbacks: [], mechanical: [], carves: [], cuts: [],
      crown: { type: 'stepped', height: 15, steps: 3, slopeSide: 'front' },
      core: { mode: 'percent', percent: 20, w: 40, d: 30 },
      programs: copyPrograms(),
      targets: { gfa: 0, far: 0 },
      view: {
        style: 'model', colorBy: 'program', floorLines: true, shadows: true,
        sun: { azimuth: 135, altitude: 40 }, grid: true, figure: true,
      },
    },
  },

  {
    id: 'l-multifamily-podium',
    name: 'L-shaped multifamily on podium',
    description: 'A 23-story L-shaped multifamily building on a six-level retail and parking podium, with its amenity deck on the podium roof as the first tower floor.',
    state: {
      schema: 1,
      name: 'L-shaped multifamily on podium',
      site: {
        shape: 'rect', width: 260, depth: 220, points: [],
        setbacks: { front: 10, back: 10, left: 10, right: 10 },
        heightLimit: 0,                         // no limit, per brief; planned top 249.5 ft (245.5 + 4 ft parapet)
        stepback: { on: false, aboveHeight: 85, distance: 15 },
      },
      context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
      podium: {
        on: true, floors: 6, groundFtf: 18, ftf: 10.5,
        shape: rect(240, 200), offset: { x: 0, y: 0 },
        program: 'retail', upperProgram: 'parking',
      },
      segments: [
        {
          floors: 1, ftf: 15, program: 'amenity',          // amenity deck on the podium roof
          shape: lShape(200, 140, 65), offset: { x: 0, y: 0 }, rotation: 0,
          taper: { x: 0, y: 0, curve: 'linear' },
          twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
          lean: { x: 0, y: 0 },
        },
        {
          floors: 16, ftf: 10, program: 'residential',
          shape: lShape(200, 140, 65), offset: { x: 0, y: 0 }, rotation: 0,
          taper: { x: 0, y: 0, curve: 'linear' },
          twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
          lean: { x: 0, y: 0 },
        },
      ],
      setbacks: [], mechanical: [], carves: [], cuts: [],
      crown: { type: 'flat', height: 4, steps: 3, slopeSide: 'front' },
      core: { mode: 'percent', percent: 20, w: 40, d: 30 },
      programs: copyPrograms(),
      targets: { gfa: 0, far: 0 },
      view: {
        style: 'model', colorBy: 'program', floorLines: true, shadows: true,
        sun: { azimuth: 135, altitude: 40 }, grid: true, figure: true,
      },
    },
  },

  // U-shaped multifamily on podium. Same structure as the L preset; only the tower plate differs.
  // Hand calculation of GFA (sf):
  //   U plate = w x d - (w - 2a) x (d - a), with w = 200, d = 140, a = 50 (arm width; the notch opens to the back).
  //           = 200 x 140 - (200 - 100) x (140 - 50) = 28,000 - 100 x 90 = 28,000 - 9,000 = 19,000.
  //   Podium plate = 240 x 200 = 48,000. Podium GFA = 48,000 x 6 floors = 288,000.
  //   Tower = 1 amenity floor + 16 residential floors = 17 floors, all on the U plate.
  //   Tower GFA = 19,000 x 17 = 323,000.
  //   Total GFA = 288,000 + 323,000 = 611,000 sf. Total floors = 6 + 17 = 23.
  //   Double-check: 17 x 28,000 (full 200 x 140 plates) = 476,000; the notch removes 17 x 9,000 = 153,000;
  //   476,000 - 153,000 = 323,000. Same tower GFA.
  {
    id: 'u-multifamily-podium',
    name: 'U-shaped multifamily on podium',
    description: 'A 23-story U-shaped multifamily building on a six-level retail and parking podium, with its amenity deck on the podium roof as the first tower floor. The U opens toward the back of the site.',
    state: {
      schema: 1,
      name: 'U-shaped multifamily on podium',
      site: {
        shape: 'rect', width: 260, depth: 220, points: [],
        setbacks: { front: 10, back: 10, left: 10, right: 10 },
        heightLimit: 0,                         // no limit; planned top 249.5 ft (245.5 + 4 ft parapet)
        stepback: { on: false, aboveHeight: 85, distance: 15 },
      },
      context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
      podium: {
        on: true, floors: 6, groundFtf: 18, ftf: 10.5,
        shape: rect(240, 200), offset: { x: 0, y: 0 },
        program: 'retail', upperProgram: 'parking',
      },
      segments: [
        {
          floors: 1, ftf: 15, program: 'amenity',          // amenity deck on the podium roof
          shape: uShape(200, 140, 50), offset: { x: 0, y: 0 }, rotation: 0,
          taper: { x: 0, y: 0, curve: 'linear' },
          twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
          lean: { x: 0, y: 0 },
        },
        {
          floors: 16, ftf: 10, program: 'residential',
          shape: uShape(200, 140, 50), offset: { x: 0, y: 0 }, rotation: 0,
          taper: { x: 0, y: 0, curve: 'linear' },
          twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
          lean: { x: 0, y: 0 },
        },
      ],
      setbacks: [], mechanical: [], carves: [], cuts: [],
      crown: { type: 'flat', height: 4, steps: 3, slopeSide: 'front' },
      // The L preset's 20% core does not fit the U's 50 ft arms (about 74 x 52 ft; the base arm is 50 ft deep),
      // so it raises a core-outside warning. 15% (about 64 x 45 ft) fits in the front arm. The core is not in GFA.
      core: { mode: 'percent', percent: 15, w: 40, d: 30 },
      programs: copyPrograms(),
      targets: { gfa: 0, far: 0 },
      view: {
        style: 'model', colorBy: 'program', floorLines: true, shadows: true,
        sun: { azimuth: 135, altitude: 40 }, grid: true, figure: true,
      },
    },
  },
];
