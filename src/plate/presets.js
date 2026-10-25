// Default state and the menu presets for the plate planner.
// Source: docs/plate-planner-technical-plan.md sections 2 and 8; docs/plate-planner-draw-plan.md sections 2.1 and 6.
// Units: feet and square feet. Plan coordinates: east = +x, north = +y.
// Each preset is a complete state object (schema 1). Consumers should deep-copy before editing.
// Draw-first (draw plan E1): a state holds drawn units, never locks. Presets 8.1 to 8.6 carry the units of the
// automatic fill, frozen by scripts/freeze-presets.mjs (the FROZEN block below), so their section 8 numbers stay.

// The section 8.1 state (Double-loaded bar) with no units: the base of presets 8.1 to 8.6.
function base81() {
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

    units: [],
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

// The default state for a new design (draw plan section 6): "Blank point tower", a drawn 150 by 160 ft plate,
// an automatic core and corridor (a compact plate gives a point corridor), and no units. Builds a new object on each call.
export function defaultState() {
  const s = base81();
  s.name = 'Blank point tower';
  s.plate.w = 150;
  s.plate.d = 160;
  s.core = { mode: 'auto', rect: null };
  s.corridor.kind = 'auto';
  s.units = [];
  return s;
}

// A section 8.1 base with a name, edits, and the frozen units of the preset id applied.
function stateWith(name, edit, id) {
  const s = base81();
  s.name = name;
  if (edit) edit(s);
  s.units = JSON.parse(JSON.stringify(FROZEN[id] || []));
  return s;
}

// BEGIN FROZEN UNITS (scripts/freeze-presets.mjs; do not edit by hand)
const FROZEN = {
  'double-loaded-bar': [
    { id: 'U-01', type: 'studio', mode: 'run', runKey: '0:0:10', outer: [[-119, -2.835], [-139, -2.835], [-139, -31.5], [-119, -31.5]] },
    { id: 'U-02', type: '1br', mode: 'run', runKey: '0:0:10', outer: [[-94.563, -2.835], [-119, -2.835], [-119, -31.5], [-94.563, -31.5]] },
    { id: 'U-03', type: '1brden', mode: 'run', runKey: '0:0:10', outer: [[-64.32, -2.835], [-94.563, -2.835], [-94.563, -31.5], [-64.32, -31.5]] },
    { id: 'U-04', type: '2br', mode: 'run', runKey: '0:0:10', outer: [[-28.254, -2.835], [-64.32, -2.835], [-64.32, -31.5], [-28.254, -31.5]] },
    { id: 'U-05', type: '3br', mode: 'run', runKey: '0:0:10', outer: [[17.994, -2.835], [-28.254, -2.835], [-28.254, -31.5], [17.994, -31.5]] },
    { id: 'U-06', type: '1br', mode: 'run', runKey: '0:0:10', outer: [[42.431, -2.835], [17.994, -2.835], [17.994, -31.5], [42.431, -31.5]] },
    { id: 'U-07', type: '2br', mode: 'run', runKey: '0:0:10', outer: [[78.497, -2.835], [42.431, -2.835], [42.431, -31.5], [78.497, -31.5]] },
    { id: 'U-08', type: '1br', mode: 'run', runKey: '0:0:10', outer: [[102.934, -2.835], [78.497, -2.835], [78.497, -31.5], [102.934, -31.5]] },
    { id: 'U-09', type: '2br', mode: 'run', runKey: '0:0:10', outer: [[139, -2.835], [102.934, -2.835], [102.934, -31.5], [139, -31.5]] },
    { id: 'U-10', type: '1br', mode: 'run', runKey: '0:2:371', outer: [[139, 31.5], [113.865, 31.5], [113.865, 2.835], [139, 2.835]] },
    { id: 'U-11', type: 'studio', mode: 'run', runKey: '0:2:371', outer: [[113.865, 31.5], [93.865, 31.5], [93.865, 2.835], [113.865, 2.835]] },
    { id: 'U-12', type: '1brden', mode: 'run', runKey: '0:2:371', outer: [[93.865, 31.5], [62.679, 31.5], [62.679, 2.835], [93.865, 2.835]] },
    { id: 'U-13', type: '3br', mode: 'run', runKey: '0:2:371', outer: [[62.679, 31.5], [15, 31.5], [15, 2.835], [62.679, 2.835]] },
    { id: 'U-14', type: '1br', mode: 'run', runKey: '0:2:525', outer: [[-15, 31.5], [-39.842, 31.5], [-39.842, 2.835], [-15, 2.835]] },
    { id: 'U-15', type: '2br', mode: 'run', runKey: '0:2:525', outer: [[-39.842, 31.5], [-77, 31.5], [-77, 2.835], [-39.842, 2.835]] },
    { id: 'U-16', type: '1br', mode: 'run', runKey: '0:2:525', outer: [[-77, 31.5], [-101.842, 31.5], [-101.842, 2.835], [-77, 2.835]] },
    { id: 'U-17', type: '2br', mode: 'run', runKey: '0:2:525', outer: [[-101.842, 31.5], [-139, 31.5], [-139, 2.835], [-101.842, 2.835]] },
  ],
  'hotel-bar': [
    { id: 'U-01', type: 'king', mode: 'run', runKey: '0:0:10', outer: [[-94.833, -3], [-109, -3], [-109, -29], [-94.833, -29]] },
    { id: 'U-02', type: 'dq', mode: 'run', runKey: '0:0:10', outer: [[-80.167, -3], [-94.833, -3], [-94.833, -29], [-80.167, -29]] },
    { id: 'U-03', type: 'suite', mode: 'run', runKey: '0:0:10', outer: [[-51.833, -3], [-80.167, -3], [-80.167, -29], [-51.833, -29]] },
    { id: 'U-04', type: 'king', mode: 'run', runKey: '0:0:10', outer: [[-37.667, -3], [-51.833, -3], [-51.833, -29], [-37.667, -29]] },
    { id: 'U-05', type: 'king', mode: 'run', runKey: '0:0:10', outer: [[-23.5, -3], [-37.667, -3], [-37.667, -29], [-23.5, -29]] },
    { id: 'U-06', type: 'accessible', mode: 'run', runKey: '0:0:10', accessible: true, outer: [[-8, -3], [-23.5, -3], [-23.5, -29], [-8, -29]] },
    { id: 'U-07', type: 'dq', mode: 'run', runKey: '0:0:127', outer: [[22.714, -3], [8, -3], [8, -29], [22.714, -29]] },
    { id: 'U-08', type: 'king', mode: 'run', runKey: '0:0:127', outer: [[36.929, -3], [22.714, -3], [22.714, -29], [36.929, -29]] },
    { id: 'U-09', type: 'king', mode: 'run', runKey: '0:0:127', outer: [[51.143, -3], [36.929, -3], [36.929, -29], [51.143, -29]] },
    { id: 'U-10', type: 'dq', mode: 'run', runKey: '0:0:127', outer: [[65.857, -3], [51.143, -3], [51.143, -29], [65.857, -29]] },
    { id: 'U-11', type: 'king', mode: 'run', runKey: '0:0:127', outer: [[80.071, -3], [65.857, -3], [65.857, -29], [80.071, -29]] },
    { id: 'U-12', type: 'king', mode: 'run', runKey: '0:0:127', outer: [[94.286, -3], [80.071, -3], [80.071, -29], [94.286, -29]] },
    { id: 'U-13', type: 'dq', mode: 'run', runKey: '0:0:127', outer: [[109, -3], [94.286, -3], [94.286, -29], [109, -29]] },
    { id: 'U-14', type: 'king', mode: 'run', runKey: '0:2:306', outer: [[109, 29], [95.286, 29], [95.286, 3], [109, 3]] },
    { id: 'U-15', type: 'king', mode: 'run', runKey: '0:2:306', outer: [[95.286, 29], [81.571, 29], [81.571, 3], [95.286, 3]] },
    { id: 'U-16', type: 'dq', mode: 'run', runKey: '0:2:306', outer: [[81.571, 29], [67.357, 29], [67.357, 3], [81.571, 3]] },
    { id: 'U-17', type: 'king', mode: 'run', runKey: '0:2:306', outer: [[67.357, 29], [53.643, 29], [53.643, 3], [67.357, 3]] },
    { id: 'U-18', type: 'king', mode: 'run', runKey: '0:2:306', outer: [[53.643, 29], [39.929, 29], [39.929, 3], [53.643, 3]] },
    { id: 'U-19', type: 'dq', mode: 'run', runKey: '0:2:306', outer: [[39.929, 29], [25.714, 29], [25.714, 3], [39.929, 3]] },
    { id: 'U-20', type: 'king', mode: 'run', runKey: '0:2:306', outer: [[25.714, 29], [12, 29], [12, 3], [25.714, 3]] },
    { id: 'U-21', type: 'king', mode: 'run', runKey: '0:2:427', outer: [[-12, 29], [-25.714, 29], [-25.714, 3], [-12, 3]] },
    { id: 'U-22', type: 'dq', mode: 'run', runKey: '0:2:427', outer: [[-25.714, 29], [-39.929, 29], [-39.929, 3], [-25.714, 3]] },
    { id: 'U-23', type: 'king', mode: 'run', runKey: '0:2:427', outer: [[-39.929, 29], [-53.643, 29], [-53.643, 3], [-39.929, 3]] },
    { id: 'U-24', type: 'king', mode: 'run', runKey: '0:2:427', outer: [[-53.643, 29], [-67.357, 29], [-67.357, 3], [-53.643, 3]] },
    { id: 'U-25', type: 'dq', mode: 'run', runKey: '0:2:427', outer: [[-67.357, 29], [-81.571, 29], [-81.571, 3], [-67.357, 3]] },
    { id: 'U-26', type: 'king', mode: 'run', runKey: '0:2:427', outer: [[-81.571, 29], [-95.286, 29], [-95.286, 3], [-81.571, 3]] },
    { id: 'U-27', type: 'king', mode: 'run', runKey: '0:2:427', outer: [[-95.286, 29], [-109, 29], [-109, 3], [-95.286, 3]] },
  ],
  'l-plate-60-ft-arms': [
    { id: 'U-01', type: '2br', mode: 'corner', runKey: null, outer: [[35.103, 1], [35.103, 27.165], [27.165, 27.165], [27.165, 35.103], [1, 35.103], [1, 1]] },
    { id: 'U-02', type: 'studio', mode: 'run', runKey: '0:0:34.1', outer: [[55.157, 27.165], [35.103, 27.165], [35.103, 1], [55.157, 1]] },
    { id: 'U-03', type: '1br', mode: 'run', runKey: '0:0:34.1', outer: [[82.38, 27.165], [55.157, 27.165], [55.157, 1], [82.38, 1]] },
    { id: 'U-04', type: '1br', mode: 'run', runKey: '0:0:34.1', outer: [[109.603, 27.165], [82.38, 27.165], [82.38, 1], [109.603, 1]] },
    { id: 'U-05', type: '2br', mode: 'run', runKey: '0:0:34.1', outer: [[149.302, 27.165], [109.603, 27.165], [109.603, 1], [149.302, 1]] },
    { id: 'U-06', type: '2br', mode: 'run', runKey: '0:0:34.1', outer: [[189, 27.165], [149.302, 27.165], [149.302, 1], [189, 1]] },
    { id: 'U-07', type: '1br', mode: 'run', runKey: '0:2:266', outer: [[189, 59], [162.962, 59], [162.962, 32.835], [189, 32.835]] },
    { id: 'U-08', type: '1br', mode: 'run', runKey: '0:2:266', outer: [[162.962, 59], [136.924, 59], [136.924, 32.835], [162.962, 32.835]] },
    { id: 'U-09', type: '2br', mode: 'run', runKey: '0:2:266', outer: [[136.924, 59], [97.962, 59], [97.962, 32.835], [136.924, 32.835]] },
    { id: 'U-10', type: '2br', mode: 'run', runKey: '0:2:266', outer: [[97.962, 59], [59, 59], [59, 32.835], [97.962, 32.835]] },
    { id: 'U-11', type: 'studio', mode: 'run', runKey: '0:3:396', outer: [[59, 79.004], [32.835, 79.004], [32.835, 59], [59, 59]] },
    { id: 'U-12', type: '1br', mode: 'run', runKey: '0:3:396', outer: [[59, 104.002], [32.835, 104.002], [32.835, 79.004], [59, 79.004]] },
    { id: 'U-13', type: '1br', mode: 'run', runKey: '0:3:396', outer: [[59, 129], [32.835, 129], [32.835, 104.002], [59, 104.002]] },
    { id: 'U-14', type: '1br', mode: 'run', runKey: '0:5:544', outer: [[27.165, 129], [1, 129], [1, 101.871], [27.165, 101.871]] },
    { id: 'U-15', type: '1br', mode: 'run', runKey: '0:5:544', outer: [[27.165, 101.871], [1, 101.871], [1, 74.743], [27.165, 74.743]] },
    { id: 'U-16', type: '2br', mode: 'run', runKey: '0:5:544', outer: [[27.165, 74.743], [1, 74.743], [1, 35.103], [27.165, 35.103]] },
  ],
  'u-plate-60-ft-arms': [
    { id: 'U-01', type: '2br', mode: 'corner', runKey: null, outer: [[35.103, 1], [35.103, 27.165], [27.165, 27.165], [27.165, 35.103], [1, 35.103], [1, 1]] },
    { id: 'U-02', type: 'studio', mode: 'run', runKey: '0:0:34.1', outer: [[57.002, 27.165], [35.103, 27.165], [35.103, 1], [57.002, 1]] },
    { id: 'U-03', type: '1br', mode: 'run', runKey: '0:0:34.1', outer: [[84.897, 27.165], [57.002, 27.165], [57.002, 1], [84.897, 1]] },
    { id: 'U-04', type: '2br', mode: 'run', runKey: '0:0:34.1', outer: [[124.897, 27.165], [84.897, 27.165], [84.897, 1], [124.897, 1]] },
    { id: 'U-05', type: '2br', mode: 'run', runKey: '0:0:34.1', outer: [[164.897, 27.165], [124.897, 27.165], [124.897, 1], [164.897, 1]] },
    { id: 'U-06', type: '2br', mode: 'corner', runKey: null, outer: [[164.897, 1], [199, 1], [199, 35.103], [172.835, 35.103], [172.835, 27.165], [164.897, 27.165]] },
    { id: 'U-07', type: '1br', mode: 'run', runKey: '0:1:232.1', outer: [[199, 62.232], [172.835, 62.232], [172.835, 35.103], [199, 35.103]] },
    { id: 'U-08', type: '1br', mode: 'run', runKey: '0:1:232.1', outer: [[199, 89.36], [172.835, 89.36], [172.835, 62.232], [199, 62.232]] },
    { id: 'U-09', type: '2br', mode: 'run', runKey: '0:1:232.1', outer: [[199, 129], [172.835, 129], [172.835, 89.36], [199, 89.36]] },
    { id: 'U-10', type: '1br', mode: 'run', runKey: '0:3:404', outer: [[167.165, 129], [141, 129], [141, 104.002], [167.165, 104.002]] },
    { id: 'U-11', type: '1br', mode: 'run', runKey: '0:3:404', outer: [[167.165, 104.002], [141, 104.002], [141, 79.004], [167.165, 79.004]] },
    { id: 'U-12', type: 'studio', mode: 'run', runKey: '0:3:404', outer: [[167.165, 79.004], [141, 79.004], [141, 59], [167.165, 59]] },
    { id: 'U-13', type: '1br', mode: 'run', runKey: '0:4:474', outer: [[141, 59], [113.667, 59], [113.667, 32.835], [141, 32.835]] },
    { id: 'U-14', type: '1br', mode: 'run', runKey: '0:4:474', outer: [[113.667, 59], [86.333, 59], [86.333, 32.835], [113.667, 32.835]] },
    { id: 'U-15', type: '1br', mode: 'run', runKey: '0:4:474', outer: [[86.333, 59], [59, 59], [59, 32.835], [86.333, 32.835]] },
    { id: 'U-16', type: '1br', mode: 'run', runKey: '0:5:556', outer: [[59, 83.998], [32.835, 83.998], [32.835, 59], [59, 59]] },
    { id: 'U-17', type: '1br', mode: 'run', runKey: '0:5:556', outer: [[59, 108.996], [32.835, 108.996], [32.835, 83.998], [59, 83.998]] },
    { id: 'U-18', type: 'studio', mode: 'run', runKey: '0:5:556', outer: [[59, 129], [32.835, 129], [32.835, 108.996], [59, 108.996]] },
    { id: 'U-19', type: '2br', mode: 'run', runKey: '0:7:704', outer: [[27.165, 129], [1, 129], [1, 89.36], [27.165, 89.36]] },
    { id: 'U-20', type: '1br', mode: 'run', runKey: '0:7:704', outer: [[27.165, 89.36], [1, 89.36], [1, 62.232], [27.165, 62.232]] },
    { id: 'U-21', type: '1br', mode: 'run', runKey: '0:7:704', outer: [[27.165, 62.232], [1, 62.232], [1, 35.103], [27.165, 35.103]] },
  ],
  'point-tower': [
    { id: 'U-01', type: '2br', mode: 'corner', runKey: null, outer: [[-15.421, -49], [-15.421, -20.67], [-20.67, -20.67], [-20.67, -15.421], [-49, -15.421], [-49, -49]] },
    { id: 'U-02', type: '1brden', mode: 'run', runKey: '0:0:33.6', outer: [[15.421, -20.67], [-15.421, -20.67], [-15.421, -49], [15.421, -49]] },
    { id: 'U-03', type: '2br', mode: 'corner', runKey: null, outer: [[15.421, -49], [49, -49], [49, -15.421], [20.67, -15.421], [20.67, -20.67], [15.421, -20.67]] },
    { id: 'U-04', type: '1brden', mode: 'run', runKey: '0:1:131.6', outer: [[49, 15.421], [20.67, 15.421], [20.67, -15.421], [49, -15.421]] },
    { id: 'U-05', type: '2br', mode: 'corner', runKey: null, outer: [[15.421, 49], [15.421, 20.67], [20.67, 20.67], [20.67, 15.421], [49, 15.421], [49, 49]] },
    { id: 'U-06', type: '1brden', mode: 'run', runKey: '0:2:229.6', outer: [[15.421, 49], [-15.421, 49], [-15.421, 20.67], [15.421, 20.67]] },
    { id: 'U-07', type: '2br', mode: 'corner', runKey: null, outer: [[-49, 15.421], [-20.67, 15.421], [-20.67, 20.67], [-15.421, 20.67], [-15.421, 49], [-49, 49]] },
    { id: 'U-08', type: '1brden', mode: 'run', runKey: '0:3:327.6', outer: [[-20.67, 15.421], [-49, 15.421], [-49, -15.421], [-20.67, -15.421]] },
  ],
  'courtyard-typed-o': [
    { id: 'U-01', type: '2br', mode: 'corner', runKey: null, outer: [[-90.48, -109], [-90.48, -80.335], [-95.335, -80.335], [-95.335, -75.48], [-124, -75.48], [-124, -109]] },
    { id: 'U-02', type: 'studio', mode: 'run', runKey: '0:0:33.5', outer: [[-70.244, -80.335], [-90.48, -80.335], [-90.48, -109], [-70.244, -109]] },
    { id: 'U-03', type: '1br', mode: 'run', runKey: '0:0:33.5', outer: [[-44.287, -80.335], [-70.244, -80.335], [-70.244, -109], [-44.287, -109]] },
    { id: 'U-04', type: '2br', mode: 'run', runKey: '0:0:33.5', outer: [[-5.5, -80.335], [-44.287, -80.335], [-44.287, -109], [-5.5, -109]] },
    { id: 'U-05', type: '1brden', mode: 'run', runKey: '0:0:129.5', outer: [[37.207, -80.335], [5.5, -80.335], [5.5, -109], [37.207, -109]] },
    { id: 'U-06', type: '1br', mode: 'run', runKey: '0:0:129.5', outer: [[63.844, -80.335], [37.207, -80.335], [37.207, -109], [63.844, -109]] },
    { id: 'U-07', type: '1br', mode: 'run', runKey: '0:0:129.5', outer: [[90.48, -80.335], [63.844, -80.335], [63.844, -109], [90.48, -109]] },
    { id: 'U-08', type: '2br', mode: 'corner', runKey: null, outer: [[90.48, -109], [124, -109], [124, -75.48], [95.335, -75.48], [95.335, -80.335], [90.48, -80.335]] },
    { id: 'U-09', type: '1br', mode: 'run', runKey: '0:1:281.5', outer: [[124, -51.049], [95.335, -51.049], [95.335, -75.48], [124, -75.48]] },
    { id: 'U-10', type: '2br', mode: 'run', runKey: '0:1:281.5', outer: [[124, -15], [95.335, -15], [95.335, -51.049], [124, -51.049]] },
    { id: 'U-11', type: 'studio', mode: 'run', runKey: '0:1:372', outer: [[124, 35.767], [95.335, 35.767], [95.335, 15], [124, 15]] },
    { id: 'U-12', type: '2br', mode: 'run', runKey: '0:1:372', outer: [[124, 75.48], [95.335, 75.48], [95.335, 35.767], [124, 35.767]] },
    { id: 'U-13', type: '2br', mode: 'corner', runKey: null, outer: [[90.48, 109], [90.48, 80.335], [95.335, 80.335], [95.335, 75.48], [124, 75.48], [124, 109]] },
    { id: 'U-14', type: '1br', mode: 'run', runKey: '0:2:499.5', outer: [[90.48, 109], [63.844, 109], [63.844, 80.335], [90.48, 80.335]] },
    { id: 'U-15', type: '1brden', mode: 'run', runKey: '0:2:499.5', outer: [[63.844, 109], [32.137, 109], [32.137, 80.335], [63.844, 80.335]] },
    { id: 'U-16', type: '1br', mode: 'run', runKey: '0:2:499.5', outer: [[32.137, 109], [5.5, 109], [5.5, 80.335], [32.137, 80.335]] },
    { id: 'U-17', type: '1br', mode: 'run', runKey: '0:2:595.5', outer: [[-5.5, 109], [-32.137, 109], [-32.137, 80.335], [-5.5, 80.335]] },
    { id: 'U-18', type: '1br', mode: 'run', runKey: '0:2:595.5', outer: [[-32.137, 109], [-58.773, 109], [-58.773, 80.335], [-32.137, 80.335]] },
    { id: 'U-19', type: '1brden', mode: 'run', runKey: '0:2:595.5', outer: [[-58.773, 109], [-90.48, 109], [-90.48, 80.335], [-58.773, 80.335]] },
    { id: 'U-20', type: '2br', mode: 'corner', runKey: null, outer: [[-124, 75.48], [-95.335, 75.48], [-95.335, 80.335], [-90.48, 80.335], [-90.48, 109], [-124, 109]] },
    { id: 'U-21', type: '3br', mode: 'run', runKey: '0:3:747.5', outer: [[-95.335, 75.48], [-124, 75.48], [-124, 27.48], [-95.335, 27.48]] },
    { id: 'U-22', type: 'studio', mode: 'run', runKey: '0:3:747.5', outer: [[-95.335, 27.48], [-124, 27.48], [-124, 6.729], [-95.335, 6.729]] },
    { id: 'U-23', type: '1br', mode: 'run', runKey: '0:3:747.5', outer: [[-95.335, 6.729], [-124, 6.729], [-124, -20.674], [-95.335, -20.674]] },
    { id: 'U-24', type: '1br', mode: 'run', runKey: '0:3:747.5', outer: [[-95.335, -20.674], [-124, -20.674], [-124, -48.077], [-95.335, -48.077]] },
    { id: 'U-25', type: '1br', mode: 'run', runKey: '0:3:747.5', outer: [[-95.335, -48.077], [-124, -48.077], [-124, -75.48], [-95.335, -75.48]] },
    { id: 'U-26', type: '2br', mode: 'run', runKey: '1:0:0', outer: [[-25.5, -46], [-61, -46], [-61, -74.665], [-25.5, -74.665]] },
    { id: 'U-27', type: 'studio', mode: 'run', runKey: '1:0:0', outer: [[-5.5, -46], [-25.5, -46], [-25.5, -74.665], [-5.5, -74.665]] },
    { id: 'U-28', type: '1br', mode: 'run', runKey: '1:0:66.5', outer: [[33.25, -46], [5.5, -46], [5.5, -74.665], [33.25, -74.665]] },
    { id: 'U-29', type: '1br', mode: 'run', runKey: '1:0:66.5', outer: [[61, -46], [33.25, -46], [33.25, -74.665], [61, -74.665]] },
    { id: 'U-30', type: '3br', mode: 'run', runKey: '1:1:122', outer: [[89.665, 1.132], [61, 1.132], [61, -46], [89.665, -46]] },
    { id: 'U-31', type: '1br', mode: 'run', runKey: '1:1:122', outer: [[89.665, 26], [61, 26], [61, 1.132], [89.665, 1.132]] },
    { id: 'U-32', type: 'studio', mode: 'run', runKey: '1:1:122', outer: [[89.665, 46], [61, 46], [61, 26], [89.665, 26]] },
    { id: 'U-33', type: '2br', mode: 'run', runKey: '1:2:214', outer: [[61, 74.665], [25.5, 74.665], [25.5, 46], [61, 46]] },
    { id: 'U-34', type: 'studio', mode: 'run', runKey: '1:2:214', outer: [[25.5, 74.665], [5.5, 74.665], [5.5, 46], [25.5, 46]] },
    { id: 'U-35', type: '1brden', mode: 'run', runKey: '1:2:280.5', outer: [[-5.5, 74.665], [-36.214, 74.665], [-36.214, 46], [-5.5, 46]] },
    { id: 'U-36', type: '1br', mode: 'run', runKey: '1:2:280.5', outer: [[-36.214, 74.665], [-61, 74.665], [-61, 46], [-36.214, 46]] },
    { id: 'U-37', type: '2br', mode: 'run', runKey: '1:3:336', outer: [[-61, 46], [-89.665, 46], [-89.665, 10], [-61, 10]] },
    { id: 'U-38', type: '2br', mode: 'run', runKey: '1:3:336', outer: [[-61, 10], [-89.665, 10], [-89.665, -26], [-61, -26]] },
    { id: 'U-39', type: 'studio', mode: 'run', runKey: '1:3:336', outer: [[-61, -26], [-89.665, -26], [-89.665, -46], [-61, -46]] },
  ],
};
// END FROZEN UNITS

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
    description: 'Drawn 300 by 65 ft rectangle with a centered bar corridor, a 30 ft core on the north side, and the multifamily mix. Expect 17 units, NRSF 15,077.8 sf, efficiency 0.7732.',
    state: stateWith('Double-loaded bar', null, 'double-loaded-bar'),
  },

  {
    id: 'hotel-bar',
    name: 'Hotel bar',
    description: 'Hotel mode, 240 by 60 ft rectangle, corridor clear 6.0 ft, no core, one accessible key per level. Expect 27 keys in 28 bays, NRSF 10,296.0 sf, efficiency 0.7150.',
    state: stateWith('Hotel bar', hotelBar, 'hotel-bar'),
  },

  {
    id: 'l-plate-60-ft-arms',
    name: 'L plate, 60 ft arms',
    description: 'L-shaped polygon, 200 by 140 ft with 60 ft arms, no core and no elevators. Expect 16 units, NRSF 12,816.5 sf, efficiency 0.7629.',
    state: stateWith('L plate, 60 ft arms', lPlate, 'l-plate-60-ft-arms'),
  },

  {
    id: 'u-plate-60-ft-arms',
    name: 'U plate, 60 ft arms',
    description: 'U-shaped polygon, 200 by 140 ft with 60 ft arms and an open court, no core and no elevators. Expect 21 units, NRSF 16,318.3 sf, efficiency 0.7555.',
    state: stateWith('U plate, 60 ft arms', uPlate, 'u-plate-60-ft-arms'),
  },

  {
    id: 'point-tower',
    name: 'Point tower',
    description: 'Point tower on a 100 by 100 ft plate with a 30 by 30 ft core holding the stairs and elevators. Expect 8 units, NRSF 7,895.0 sf, efficiency 0.7895.',
    state: stateWith('Point tower', pointTower, 'point-tower'),
  },

  {
    id: 'courtyard-typed-o',
    name: 'Courtyard level (typed O)',
    description: 'Typed O plate, 250 by 220 ft with a centered 120 by 90 ft court, a 30 ft core on the east run, and two manual stairs on the spine. Expect 39 units, NRSF 33,576.5 sf, efficiency 0.7596.',
    state: stateWith('Courtyard level (typed O)', courtyardO, 'courtyard-typed-o'),
  },

  {
    id: 'blank-point-tower',
    name: 'Blank point tower',
    description: 'The default for a new design. Drawn 150 by 160 ft plate, automatic core and point corridor, no units. Draw the units along the facade.',
    state: defaultState(),
  },
];
