// Default state and the menu presets for the plate planner.
// Source: docs/plate-planner-technical-plan.md sections 2 and 8.
// Units: feet and square feet. Plan coordinates: east = +x, north = +y.
// Each preset is a complete state object (schema 1). Consumers should deep-copy before editing.

// The default state (plan section 2). Builds a new object on each call, so every caller gets its own copy.
// It equals the section 8.1 preset (Double-loaded bar).
export function defaultState() {
  return {
    schema: 1,
    name: 'Double-loaded bar',
    mode: 'multifamily',
    source: 'drawn',

    plate: {
      shape: 'rect',
      w: 300, d: 65,
      arm: 60,
      courtW: 120, courtD: 90,
      segments: 64,
      points: [],
    },

    levels: {
      showPodium: false,
      selected: null,
      groups: {},
    },

    // Kind "bar" is explicit: with a core and no spines, "auto" would resolve to a point corridor.
    corridor: {
      kind: 'bar',
      width: null,
      wall: 0.5,
      side: 'south',
      spine: null,
    },
    extWall: 1.0,

    // Core mode (rework plan 4.2): "auto" | "manual" | "none". 8.1 has an explicit core rectangle, so it is manual.
    core: { mode: 'manual', rect: [-15, 2.835, 15, 32.5] },
    stairs: {
      mode: 'auto',
      size: [11, 22],
      items: [],
    },
    elevators: { count: null, size: [8, 10], service: null },
    support: [],
    hotelBoh: { on: true, place: 'core' },

    mix: {
      multifamily: [
        { id: 'studio', name: 'Studio',    widthMin: 20, widthMax: 24, targetArea: 525,  areaMin: 450,  areaMax: 600,  share: 0.10, color: '#9cc3e6' },
        { id: '1br',    name: '1BR',       widthMin: 24, widthMax: 28, targetArea: 725,  areaMin: 650,  areaMax: 800,  share: 0.45, color: '#4f7fd1' },
        { id: '1brden', name: '1BR + den', widthMin: 28, widthMax: 32, targetArea: 900,  areaMin: 850,  areaMax: 950,  share: 0.10, color: '#6b5fc7' },
        { id: '2br',    name: '2BR',       widthMin: 32, widthMax: 40, targetArea: 1100, areaMin: 1000, areaMax: 1200, share: 0.30, color: '#2f9e9a' },
        { id: '3br',    name: '3BR',       widthMin: 40, widthMax: 48, targetArea: 1400, areaMin: 1300, areaMax: 1500, share: 0.05, color: '#d9a22b' },
      ],
      hotel: [
        { id: 'king',  name: 'King',         widthMin: 13.5, widthMax: 14.5, target: 14,   bays: 1, share: 0.60, color: '#8a63c9' },
        { id: 'dq',    name: 'Double queen', widthMin: 14,   widthMax: 15,   target: 14.5, bays: 1, share: 0.30, color: '#b48ad9' },
        { id: 'suite', name: 'Suite',        widthMin: 27,   widthMax: 29,   target: 28,   bays: 2, share: 0.05, color: '#5b3f99' },
      ],
      cornerType: '2br',
      accessibleWidth: [15, 16, 15.5],
    },

    accessible: {
      multifamily: { typeAShare: 0.02, minUnits: 1, over: 20 },
      hotel: [
        [25, 1, 0], [50, 2, 0], [75, 4, 1], [100, 5, 1],
        [150, 7, 2], [200, 8, 2], [300, 10, 3], [400, 12, 4],
      ],
      perFloor: null,
    },
    housekeepingReach: 150,

    locks: [],
    placement: null,

    // Rework plan 5: unit depth cap in ft (null = off). Per group: levels.groups[gid].maxDepth wins.
    fill: { maxDepth: null },
    // Rework plan 6: the advisor's target area depth in ft (null = mode default: multifamily 30, hotel 26).
    targetDepth: null,

    view: {
      style: 'model',
      labels: true, walls: true, bays: true,
      levels3d: false,
      context: true, grid: true, figure: false,
      snap: { on: true, grid: 0.5 },
    },
  };
}

// A default state with a name and edits applied. Used by every preset except the default.
function stateWith(name, edit) {
  const s = defaultState();
  s.name = name;
  edit(s);
  return s;
}

// Section 8.2: a 240 by 60 ft hotel bar with no core, so the guest elevators sit beside the corridor.
// Corridor clear 6.0 ft, one accessible key per level.
function hotelBar(s) {
  s.mode = 'hotel';
  s.plate.w = 240;
  s.plate.d = 60;
  s.core = { mode: 'auto', rect: null };
  s.corridor.kind = 'auto';
  s.corridor.width = 6.0;
  s.accessible.perFloor = 1;
}

// Section 8.3: an L plate with 60 ft arms, drawn as a polygon. No core and no elevators.
// The arm centerlines give the spine, so it stays automatic.
function lPlate(s) {
  s.plate = {
    shape: 'polygon',
    w: 200, d: 140, arm: 60,
    courtW: 120, courtD: 90,
    segments: 64,
    points: [[0, 0], [200, 0], [200, 60], [60, 60], [60, 140], [0, 140]],
  };
  s.core = { mode: 'auto', rect: null };
  s.corridor.kind = 'auto';
  s.elevators.count = 0;
}

// Section 8.4: a U plate with 60 ft arms, drawn as a polygon. No core and no elevators.
// The spine is set explicitly to the three arm centerline segments of the plan.
function uPlate(s) {
  s.plate = {
    shape: 'polygon',
    w: 200, d: 140, arm: 60,
    courtW: 120, courtD: 90,
    segments: 64,
    points: [
      [0, 0], [200, 0], [200, 140], [140, 140],
      [140, 60], [60, 60], [60, 140], [0, 140],
    ],
  };
  s.core = { mode: 'auto', rect: null };
  s.corridor.kind = 'auto';
  s.corridor.spine = [
    [[30, 30], [170, 30]],
    [[30, 30], [30, 140]],
    [[170, 30], [170, 140]],
  ];
  s.elevators.count = 0;
}

// Section 8.5: a 100 by 100 ft point tower. The corridor is a ring around the core,
// and the stairs and elevators sit inside the core.
function pointTower(s) {
  s.plate.w = 100;
  s.plate.d = 100;
  s.core = { mode: 'manual', rect: [-15, -15, 15, 15] };   // the explicit 30 x 30 core of 8.5 stays manual
  s.corridor.kind = 'point';
}

// Section 8.6: a typed O plate, 250 by 220 ft with a centered 120 by 90 ft court.
// The spine is the ring at the bar centerlines. The two stairs sit at the middle of the south and north pieces.
function courtyardO(s) {
  s.plate.shape = 'O';
  s.plate.w = 250;
  s.plate.d = 220;
  s.plate.courtW = 120;
  s.plate.courtD = 90;
  s.corridor.kind = 'bar';
  s.corridor.spine = [
    [[-92.5, -77.5], [92.5, -77.5]],
    [[92.5, -77.5], [92.5, 77.5]],
    [[92.5, 77.5], [-92.5, 77.5]],
    [[-92.5, 77.5], [-92.5, -77.5]],
  ];
  s.core = { mode: 'manual', rect: [95.335, -15, 125, 15] };
  s.stairs.mode = 'manual';
  s.stairs.items = [
    { id: 'S1', rect: [-5.5, -88.5, 5.5, -66.5] },
    { id: 'S2', rect: [-5.5, 66.5, 5.5, 88.5] },
  ];
}

export const PRESETS = [
  {
    id: 'double-loaded-bar',
    name: 'Double-loaded bar',
    description: 'Default. Drawn 300 by 65 ft rectangle with a centered bar corridor, a 30 ft core on the north side, and the multifamily mix. Expect 17 units, NRSF 15,077.8 sf, efficiency 0.7732.',
    state: defaultState(),
  },

  {
    id: 'hotel-bar',
    name: 'Hotel bar',
    description: 'Hotel mode, 240 by 60 ft rectangle, corridor clear 6.0 ft, no core, one accessible key per level. Expect 27 keys in 28 bays, NRSF 10,296.0 sf, efficiency 0.7150.',
    state: stateWith('Hotel bar', hotelBar),
  },

  {
    id: 'l-plate-60-ft-arms',
    name: 'L plate, 60 ft arms',
    description: 'L-shaped polygon, 200 by 140 ft with 60 ft arms, no core and no elevators. Expect 16 units, NRSF 12,816.5 sf, efficiency 0.7629.',
    state: stateWith('L plate, 60 ft arms', lPlate),
  },

  {
    id: 'u-plate-60-ft-arms',
    name: 'U plate, 60 ft arms',
    description: 'U-shaped polygon, 200 by 140 ft with 60 ft arms and an open court, no core and no elevators. Expect 21 units, NRSF 16,318.3 sf, efficiency 0.7555.',
    state: stateWith('U plate, 60 ft arms', uPlate),
  },

  {
    id: 'point-tower',
    name: 'Point tower',
    description: 'Point tower on a 100 by 100 ft plate with a 30 by 30 ft core holding the stairs and elevators. Expect 8 units, NRSF 7,895.0 sf, efficiency 0.7895.',
    state: stateWith('Point tower', pointTower),
  },

  {
    id: 'courtyard-typed-o',
    name: 'Courtyard level (typed O)',
    description: 'Typed O plate, 250 by 220 ft with a centered 120 by 90 ft court, a 30 ft core on the east run, and two manual stairs on the spine. Expect 39 units, NRSF 33,576.5 sf, efficiency 0.7596.',
    state: stateWith('Courtyard level (typed O)', courtyardO),
  },
];
