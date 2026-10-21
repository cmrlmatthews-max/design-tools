// Program defaults, the default state, the six presets, and the template builder for the mid-rise generator.
// Source: docs/mid-rise-generator-technical-plan.md sections 2, 4 and 8.
// Units: feet, square feet, degrees. Plan north is +y and east is +x. Bar angles run counter-clockwise from east.
// Each preset is a complete state object (schema 1). Consumers should deep-copy before editing.

export const PROGRAM_DEFAULTS = {
  residential: { ftf: 10,   unitSize: 850,  unitFactor: 0.85, unitWidth: 28,   parkingRatio: 1.25, color: '#4f7fd1' }, // blue
  hotel:       { ftf: 10,   unitSize: 400,  unitFactor: 0.80, unitWidth: 14,   parkingRatio: 0.8,  color: '#8a63c9' }, // purple
  senior:      { ftf: 10,   unitSize: 600,  unitFactor: 0.85, unitWidth: 30,   parkingRatio: 0.6,  color: '#c2607a' }, // rose
  retail:      { ftf: 16,   unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 3,    color: '#d9a22b' }, // amber, parking per 1,000 sf
  amenity:     { ftf: 12,   unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 0,    color: '#58a65c' }, // green
  leasing:     { ftf: 12,   unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 0,    color: '#7a8fa6' }, // slate
  parking:     { ftf: 10.5, unitSize: 330,  unitFactor: 1,    unitWidth: null, parkingRatio: 0,    color: '#8b929a' }, // gray
};

const BAR_DEPTH = 65;          // default bar depth, ft
const WRAP_GAP = 10;           // clearance between the wrap deck and the bars, ft (plan decision 13)
const PODIUM_COURT_Y = 32.5;   // center y of the open court in the podium template, ft (preset 8.6 layout)

const copyPrograms = () =>
  Object.fromEntries(Object.entries(PROGRAM_DEFAULTS).map(([k, v]) => [k, { ...v }]));

// Context block north of the site, per plan section 8 "Common to all presets".
const contextBlock = (siteDepth) => ({ x: 0, y: -(siteDepth / 2 + 80), w: 200, d: 120, h: 40 });

// A pair of bar ends, each 'stair' or 'open'.
const pair = (start, end) => ({ start, end });

// One bar. Defaults follow the section 2 bar: double-loaded, stairs at both ends, no bends.
function bar({ id, x, y, angle, length, floors, depth = BAR_DEPTH, corridor = 'double', ends = pair('stair', 'stair') }) {
  return {
    id, name: `Bar ${id}`, x, y, angle, length, depth, floors,
    program: 'residential', groundProgram: null,
    corridor, unitSide: 'left', ends: pair(ends.start, ends.end), bends: [], unitWidth: null,
  };
}

// The default state (plan section 2). Builds a new object on each call, so every caller gets its own copy.
// The context block follows the section 8 rule. For this site depth (242 ft) it gives y = -201, so the
// default state matches the double-bar preset.
export function defaultState() {
  return {
    schema: 1,
    name: 'Double-loaded bar, five floors',
    type: 'bar',
    site: {
      shape: 'rect', width: 360, depth: 242, points: [],
      setbacks: { front: 20, back: 20, left: 20, right: 20 },
      heightLimit: 0,
      stepback: { on: false, aboveHeight: 85, distance: 15 },
      densityCap: 0,
      openSpaceShare: 0,
      separationMin: 20,
      courtyardMin: 40,
    },
    placement: null,
    context: { show: true, fromSite: false, blocks: [contextBlock(242)] },
    floors: { groundFtf: 12, ftf: 10 },
    bars: [bar({ id: 'A', x: -150, y: 0, angle: 0, length: 300, floors: 5 })],
    courts: [],
    deck: { on: false, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true },
    podium: {
      on: false,
      levels: [{ ftf: 11, program: 'parking' }],
      footprint: { mode: 'allowed', percent: 100, offset: 0 },
      liner: { on: false, side: 'front', depth: 40 },
    },
    surface: { count: 120, lot: [] },
    programs: copyPrograms(),
    parking: { sfPerStallSurface: 350, sfPerStallDeck: 330, retailPerThousand: 3 },
    rules: {
      corridorWidth: 5.67,
      breezewayWidth: 8,
      stairPer: 250,
      elevatorPer: 100,
      cornerLoss: 1,
      constructionHints: [
        { maxFloors: 3, podium: 'any', hint: 'Wood frame' },
        { maxFloors: 5, podium: 'none', hint: 'Wood frame with fire-rated assemblies' },
        { maxFloors: 5, podium: 'yes', hint: 'Wood over a concrete podium' },
        { maxFloors: 8, podium: 'any', hint: 'Mass timber, steel, or concrete; check the code' },
        { maxFloors: 999, podium: 'any', hint: 'Concrete; use the Tower Generator' },
      ],
    },
    roof: { type: 'parapet', height: 4 },
    targets: { units: 0, density: 0 },
    view: {
      style: 'model', colorBy: 'program',
      floorLines: true, shadows: true, sun: { azimuth: 135, altitude: 40 },
      grid: true, figure: true, ticks: true,
      snap: { on: true, grid: 5 },
    },
  };
}

// Builds a complete preset from section 8 values. It starts from the default state and sets the rest.
// The site depth also places the context block (section 8 "Common to all presets"). Roof is a 4 ft parapet.
function buildState({ name, type, width, depth, setbacks, groundFtf = 12, bars, courts = [], deck = {}, podium = {}, surface }) {
  const s = defaultState();
  s.name = name;
  s.type = type;
  s.site.width = width;
  s.site.depth = depth;
  s.site.setbacks = { front: setbacks, back: setbacks, left: setbacks, right: setbacks };
  s.floors = { groundFtf, ftf: 10 };
  s.context.blocks = [contextBlock(depth)];
  s.bars = bars;
  s.courts = courts;
  s.deck = { ...s.deck, ...deck };
  s.podium = { ...s.podium, ...podium };
  s.surface = { count: surface, lot: [] };
  return s;
}

export const PRESETS = [
  {
    id: 'garden-walkup',
    name: 'Garden walk-up, three floors',
    description: 'Three breezeway walk-up bars of three floors each on a five-acre site, with 160 surface stalls.',
    state: buildState({
      name: 'Garden walk-up, three floors',
      type: 'garden',
      width: 540, depth: 403, setbacks: 25, groundFtf: 10,
      bars: [
        bar({ id: 'A', x: -96, y: -120, angle: 0, length: 192, floors: 3, depth: 66, corridor: 'breezeway', ends: pair('open', 'open') }),
        bar({ id: 'B', x: -96, y: 0,    angle: 0, length: 192, floors: 3, depth: 66, corridor: 'breezeway', ends: pair('open', 'open') }),
        bar({ id: 'C', x: -96, y: 120,  angle: 0, length: 192, floors: 3, depth: 66, corridor: 'breezeway', ends: pair('open', 'open') }),
      ],
      surface: 160,
    }),
  },

  {
    id: 'corridor-garden',
    name: 'Corridor garden, four floors',
    description: 'Two double-loaded corridor bars of four floors that meet in an L, with 125 surface stalls.',
    state: buildState({
      name: 'Corridor garden, four floors',
      type: 'corridor-garden',
      width: 400, depth: 327, setbacks: 25,
      bars: [
        bar({ id: 'A', x: -152.5, y: -80,   angle: 0,  length: 240, floors: 4, ends: pair('stair', 'stair') }),
        bar({ id: 'B', x: -120,   y: -112.5, angle: 90, length: 160, floors: 4, ends: pair('open', 'stair') }),
      ],
      surface: 125,
    }),
  },

  {
    id: 'double-bar',
    name: 'Double-loaded bar, five floors',
    description: 'A single five-floor double-loaded bar with 120 surface stalls. This is the default state.',
    state: buildState({
      name: 'Double-loaded bar, five floors',
      type: 'bar',
      width: 360, depth: 242, setbacks: 20,
      bars: [
        bar({ id: 'A', x: -150, y: 0, angle: 0, length: 300, floors: 5 }),
      ],
      surface: 120,
    }),
  },

  {
    id: 'courtyard-5-over-1',
    name: 'Courtyard, five over one',
    description: 'Four five-floor bars around a closed courtyard on a one-level parking podium, with 120 surface stalls.',
    state: buildState({
      name: 'Courtyard, five over one',
      type: 'courtyard',
      width: 330, depth: 330, setbacks: 20,
      bars: [
        bar({ id: 'S', x: -125, y: -77.5, angle: 0,  length: 250, floors: 5, ends: pair('stair', 'stair') }),
        bar({ id: 'N', x: -125, y: 77.5,  angle: 0,  length: 250, floors: 5, ends: pair('stair', 'stair') }),
        bar({ id: 'W', x: -92.5, y: -110, angle: 90, length: 220, floors: 5, ends: pair('open', 'open') }),
        bar({ id: 'E', x: 92.5,  y: -110, angle: 90, length: 220, floors: 5, ends: pair('open', 'open') }),
      ],
      podium: {
        on: true,
        levels: [{ ftf: 11, program: 'parking' }],
        footprint: { mode: 'offset', percent: 100, offset: 0 },
      },
      surface: 120,
    }),
  },

  {
    id: 'wrap-deck',
    name: 'Wrap with five-level deck',
    description: 'Four five-floor bars wrapped around a five-level open-top deck, with 40 surface stalls.',
    state: buildState({
      name: 'Wrap with five-level deck',
      type: 'wrap',
      width: 540, depth: 363, setbacks: 25,
      deck: { on: true, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true },
      bars: [
        bar({ id: 'S', x: -225,  y: -105,  angle: 0,  length: 450, floors: 5, ends: pair('stair', 'stair') }),
        bar({ id: 'N', x: -225,  y: 105,   angle: 0,  length: 450, floors: 5, ends: pair('stair', 'stair') }),
        bar({ id: 'W', x: -192.5, y: -137.5, angle: 90, length: 275, floors: 5, ends: pair('open', 'open') }),
        bar({ id: 'E', x: 192.5, y: -137.5, angle: 90, length: 275, floors: 5, ends: pair('open', 'open') }),
      ],
      surface: 40,
    }),
  },

  {
    id: 'podium-5-over-2',
    name: 'Podium, five over two with retail',
    description: 'Three five-floor bars on a two-level parking podium with a retail liner, around an open court to the north.',
    state: buildState({
      name: 'Podium, five over two with retail',
      type: 'podium',
      width: 330, depth: 231, setbacks: 15,
      bars: [
        bar({ id: 'S', x: -150,   y: -67.5, angle: 0,  length: 300, floors: 5, ends: pair('stair', 'stair') }),
        bar({ id: 'W', x: -117.5, y: -100,  angle: 90, length: 200, floors: 5, ends: pair('open', 'stair') }),
        bar({ id: 'E', x: 117.5,  y: -100,  angle: 90, length: 200, floors: 5, ends: pair('open', 'stair') }),
      ],
      courts: [{ id: 'C1', x: 0, y: 32.5, w: 170, d: 135 }],
      podium: {
        on: true,
        levels: [{ ftf: 16, program: 'parking' }, { ftf: 11, program: 'parking' }],
        footprint: { mode: 'offset', percent: 100, offset: 0 },
        liner: { on: true, side: 'front', depth: 40 },
      },
      surface: 0,
    }),
  },
];

// Court bars for the templates. The court is w wide (x) and h high (y), centered at (cx, cy). Bars are d deep.
// Kinds:
//   O  four bars around a closed court (preset 8.4; the wrap uses it with the deck plus two gaps as the court).
//      The south and north bars are full width w + 2d. The side bars are full height h + 2d.
//   U  three bars: south, west, east. The side bars stop at the north edge of the court, so the court is open to the north.
//   L  two bars: south and west. Open to the north and east.
//   E  a spine on the west (height h + 2d) and three arms running east (length w + d): south, middle, north.
//      Each court sits between two arms and is open to the east.
// Corners overlap by d x d, so each corner is one L joint. Arm ends follow preset 8.6: start open, end stair.
function courtBars(kind, w, h, d, cx, cy, floors) {
  const x0 = cx - (w + 2 * d) / 2;      // start x of the south and north bars
  const yBottom = cy - (h + 2 * d) / 2; // start y of a side bar that runs the full height
  const yS = cy - (h + d) / 2;          // centerline y of the south bar
  const yN = cy + (h + d) / 2;          // centerline y of the north bar
  const xW = cx - (w + d) / 2;          // centerline x of the west bar
  const xE = cx + (w + d) / 2;          // centerline x of the east bar
  const stairs = pair('stair', 'stair');
  const opens = pair('open', 'open');
  const arm = pair('open', 'stair');    // a bar that joins another at its start
  const south = () => bar({ id: 'S', x: x0, y: yS, angle: 0, length: w + 2 * d, floors, depth: d, ends: stairs });

  switch (kind) {
    case 'O':
      return [
        south(),
        bar({ id: 'N', x: x0, y: yN, angle: 0, length: w + 2 * d, floors, depth: d, ends: stairs }),
        bar({ id: 'W', x: xW, y: yBottom, angle: 90, length: h + 2 * d, floors, depth: d, ends: opens }),
        bar({ id: 'E', x: xE, y: yBottom, angle: 90, length: h + 2 * d, floors, depth: d, ends: opens }),
      ];
    case 'U':
      return [
        south(),
        bar({ id: 'W', x: xW, y: yBottom, angle: 90, length: h + d, floors, depth: d, ends: arm }),
        bar({ id: 'E', x: xE, y: yBottom, angle: 90, length: h + d, floors, depth: d, ends: arm }),
      ];
    case 'L':
      return [
        south(),
        bar({ id: 'W', x: xW, y: yBottom, angle: 90, length: h + d, floors, depth: d, ends: arm }),
      ];
    case 'E':
      return [
        bar({ id: 'W', x: xW, y: yBottom, angle: 90, length: h + 2 * d, floors, depth: d, ends: stairs }),
        bar({ id: 'S', x: xW, y: yS, angle: 0, length: w + d, floors, depth: d, ends: arm }),
        bar({ id: 'M', x: xW, y: cy, angle: 0, length: w + d, floors, depth: d, ends: arm }),
        bar({ id: 'N', x: xW, y: yN, angle: 0, length: w + d, floors, depth: d, ends: arm }),
      ];
    default:
      throw new Error(`courtBars: unknown kind "${kind}"`);
  }
}

// Open court objects for a court template (plan section 1.2). The O kind has none: its court is the closed
// hole in the plate union.
function courtRecords(kind, w, h, d, cx, cy) {
  if (kind === 'O') return [];
  if (kind === 'E') {
    const ch = (h - d) / 2;   // height of each court between two arms
    const off = (h + d) / 4;  // each court center sits this far from cy
    return [
      { id: 'C1', x: cx, y: cy - off, w, d: ch },
      { id: 'C2', x: cx, y: cy + off, w, d: ch },
    ];
  }
  return [{ id: 'C1', x: cx, y: cy, w, d: h }]; // U and L: open on the north side
}

// Each template type starts from the preset listed here.
const TEMPLATE_SOURCE = {
  garden: 'garden-walkup',
  'corridor-garden': 'corridor-garden',
  bar: 'double-bar',
  'courtyard-L': 'courtyard-5-over-1',
  'courtyard-U': 'courtyard-5-over-1',
  'courtyard-O': 'courtyard-5-over-1',
  'courtyard-E': 'courtyard-5-over-1',
  wrap: 'wrap-deck',
  podium: 'podium-5-over-2',
};

const TEMPLATE_NAME = {
  garden: 'Garden walk-up',
  'corridor-garden': 'Corridor garden',
  bar: 'Double-loaded bar',
  'courtyard-L': 'Courtyard L',
  'courtyard-U': 'Courtyard U',
  'courtyard-O': 'Courtyard O',
  'courtyard-E': 'Courtyard E',
  wrap: 'Wrap with deck',
  podium: 'Podium',
};

// Returns a complete state for a template, built from its preset with the options applied.
// Options (all optional):
//   length            bar length in ft. Garden and bar templates only. Other templates take lengths from their shape.
//   depth             bar depth in ft, all templates (default 65; the garden template keeps its 66).
//   floors            floors per bar, all templates (default 5; the garden template keeps its 3).
//   courtW, courtD    court width (x) and court height (y) in ft. Courtyard templates default to 120 x 90 (E: 120 x 210, so each of its two courts clears courtyardMin).
//                     The podium template keeps its preset court, 170 x 135.
//   deckW, deckD      wrap deck width and depth in ft (default 300 x 125). Wrap template only.
//   deckLevels        wrap deck levels (default 5). Wrap template only.
// The wrap bars sit one WRAP_GAP (10 ft) outside the deck on every side.
export function templateState(type, options = {}) {
  const sourceId = TEMPLATE_SOURCE[type];
  if (!sourceId) throw new Error(`templateState: unknown template type "${type}"`);
  const s = structuredClone(PRESETS.find((p) => p.id === sourceId).state);
  s.name = TEMPLATE_NAME[type];
  s.type = type.startsWith('courtyard') ? 'courtyard' : type;

  switch (type) {
    case 'garden':
    case 'corridor-garden':
    case 'bar': {
      const canResize = type !== 'corridor-garden'; // corridor garden lengths make its L joint, so they stay
      s.bars = s.bars.map((b) => ({
        ...b,
        length: canResize ? (options.length ?? b.length) : b.length,
        depth: options.depth ?? b.depth,
        floors: options.floors ?? b.floors,
      }));
      break;
    }
    case 'courtyard-O':
    case 'courtyard-U':
    case 'courtyard-L':
    case 'courtyard-E': {
      const kind = type.slice(-1);
      const w = options.courtW ?? 120;
      // E holds two courts in its height: (h - d) / 2 each. 210 ft gives two 72.5 ft courts, above courtyardMin 40.
      const h = options.courtD ?? (kind === 'E' ? 210 : 90);
      const d = options.depth ?? BAR_DEPTH;
      s.bars = courtBars(kind, w, h, d, 0, 0, options.floors ?? 5);
      s.courts = courtRecords(kind, w, h, d, 0, 0);
      break;
    }
    case 'podium': {
      const w = options.courtW ?? 170;
      const h = options.courtD ?? 135;
      const d = options.depth ?? BAR_DEPTH;
      s.bars = courtBars('U', w, h, d, 0, PODIUM_COURT_Y, options.floors ?? 5);
      s.courts = courtRecords('U', w, h, d, 0, PODIUM_COURT_Y);
      break;
    }
    case 'wrap': {
      const dw = options.deckW ?? 300;
      const dd = options.deckD ?? 125;
      const d = options.depth ?? BAR_DEPTH;
      s.bars = courtBars('O', dw + 2 * WRAP_GAP, dd + 2 * WRAP_GAP, d, 0, 0, options.floors ?? 5);
      s.deck = { ...s.deck, on: true, x: 0, y: 0, w: dw, d: dd, levels: options.deckLevels ?? 5 };
      break;
    }
    default:
      throw new Error(`templateState: no builder for "${type}"`);
  }
  return s;
}
