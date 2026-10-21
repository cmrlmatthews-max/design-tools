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
        style: 'model', colorBy: 'zone', floorLines: true, shadows: true,
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
        style: 'model', colorBy: 'zone', floorLines: true, shadows: true,
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
        style: 'model', colorBy: 'zone', floorLines: true, shadows: true,
        sun: { azimuth: 135, altitude: 40 }, grid: true, figure: true,
      },
    },
  },

  {
    id: 'tampa-multifamily',
    name: 'Tampa-type multifamily',
    description: 'A 23-story L-shaped multifamily tower on a six-level retail and parking podium, with its amenity deck on the podium roof as the first tower floor.',
    state: {
      schema: 1,
      name: 'Tampa-type multifamily',
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
        style: 'model', colorBy: 'zone', floorLines: true, shadows: true,
        sun: { azimuth: 135, altitude: 40 }, grid: true, figure: true,
      },
    },
  },
];
