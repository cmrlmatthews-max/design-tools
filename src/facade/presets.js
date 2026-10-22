// Default state and the menu presets for the facade studio.
// Source: docs/facade-studio-technical-plan.md sections 2 and 8.
// Units: feet, square feet, degrees. Plan coordinates: east = +x, north = +y.
// Each preset is a complete state object (schema 1). Consumers should deep-copy before editing.

// The default state (plan section 2). Builds a new object on each call, so every caller gets its own copy.
// It equals the section 8.1 preset.
export function defaultState() {
  return {
    schema: 1,
    name: 'Residential punched windows with inset balconies',
    source: 'standalone',

    standalone: {
      shape: 'rect',
      width: 300, depth: 65,
      arm: 65,
      courtW: 120, courtD: 90,
      angle: 0,
      floors: 5,
      ftf1: 12,
      ftf: 10,
      podium: { on: false, levels: 1, ftf: 11, width: 300, depth: 200 },
    },

    placement: null,

    zones: {
      mode: 'default',
      ranges: [],
      rules: {
        base: { system: 'punched' },
        middle: { system: 'punched' },
        top: { system: 'punched' },
      },
      overrides: {},
    },

    systems: {
      punched: { module: 14, windowW: 6, sill: 2.5, head: 8, mullionW: 0.1667, mullionD: 0.333 },
      windowWall: { module: 5, slabCover: 1.3333, mullionW: 0.2083, mullionD: 0.5 },
      curtainWall: { module: 5, vision: 8, sill: 0, mullionW: 0.2083, mullionD: 0.6667 },
      storefront: { module: 5, sill: 1.5, head: 10, mullionW: 0.1667, mullionD: 0.375 },
      solid: { module: 10 },
    },

    balconies: {
      on: true, type: 'inset', pattern: 'stacked', spacing: 2,
      width: 12, depth: 6, slab: 1,
      door: { width: 6, head: 8 },
      zones: ['middle'],
      orientations: ['N', 'S'],
    },

    fins: { on: false, depth: 1.5, width: 0.1667, every: 1, orientations: ['E', 'W'], zones: ['middle', 'top'] },
    shades: { on: false, depth: 2, above: 0.5, orientations: ['S'], zones: ['middle', 'top'] },
    bands: [],
    corners: 'solid',

    street: { mode: 'auto', manual: [], roadDistance: 60 },

    // Design values, not code values. The 40 percent limit is the prescriptive path of ASHRAE 90.1-2019. Verify the edition and the path for each project.
    checks: {
      wwrLimit: 0.40,
      band: { from: 2, to: 10 },
      transparencyTarget: null,
    },

    // Typical seed values, not product data or code values. Verify every value.
    envelope: {
      on: false,
      limits: { uFixed: 0.45, shgc: 0.25 },
      glazing: {
        igu: { label: 'IGU with low-e', u: 0.29, shgc: 0.25 },
        laminated: { label: 'Laminated single pane', u: 1.00, shgc: 0.70 },
      },
      walls: { eifsCmu: { label: 'EIFS over CMU', u: 0.09 } },
      glazingDefault: 'igu',
      wallDefault: 'eifsCmu',
    },

    materials: ['eifsCmu', 'metal', 'brick', 'fiberCement', 'precast'],

    view: {
      style: 'model', colorBy: 'system',
      elevation: null,
      mullions: true, context: true, grid: true, figure: true, shadows: true,
      sun: { azimuth: 135, altitude: 40 },
    },
  };
}

// A default state with a name and edits applied. Used by the presets that differ from the default.
function stateWith(name, edit) {
  const s = defaultState();
  s.name = name;
  edit(s);
  return s;
}

// Section 8.2 massing: a 180 by 62 ft tower of 24 floors on a two-level 240 by 120 ft podium.
// The podium is the base zone, so the tower rules apply to the middle and top zones.
function hotelMassing(s) {
  s.standalone.width = 180;
  s.standalone.depth = 62;
  s.standalone.floors = 24;
  s.standalone.ftf1 = 18;
  s.standalone.ftf = 10;
  Object.assign(s.standalone.podium, { on: true, levels: 2, ftf: 15, width: 240, depth: 120 });
  s.balconies.on = false;
}

// Section 8.4 massing: a 200 by 90 ft bar, 32 floors at 13.5 ft, no podium.
function officeMassing(s) {
  s.standalone.width = 200;
  s.standalone.depth = 90;
  s.standalone.floors = 32;
  s.standalone.ftf1 = 13.5;
  s.standalone.ftf = 13.5;
  s.balconies.on = false;
}

function hotelWindowWall(s) {
  hotelMassing(s);
  s.zones.rules = {
    base: { system: 'storefront' },
    middle: { system: 'windowWall' },
    top: { system: 'windowWall' },
  };
}

function hotelWindowWallSolidBands(s) {
  hotelMassing(s);
  s.zones.rules = {
    base: { system: 'storefront' },
    middle: { system: 'windowWall', solid: { count: 2, every: 5 } },
    top: { system: 'windowWall', solid: { count: 2, every: 5 } },
  };
}

function officeCurtainWall(s) {
  officeMassing(s);
  s.zones.rules = {
    base: { system: 'curtainWall', vision: 8, sill: 0 },
    middle: { system: 'curtainWall', vision: 8, sill: 0 },
    top: { system: 'curtainWall', vision: 8, sill: 0 },
  };
}

function officeCurtainWallOneViewFace(s) {
  officeCurtainWall(s);
  // Overrides merge over the zone rule: E, S, and W panels take vision 4 and one solid panel in every two.
  const viewFaceRule = () => ({ system: 'curtainWall', vision: 4, solid: { count: 1, every: 2 } });
  s.zones.overrides = {
    base: { E: viewFaceRule(), S: viewFaceRule(), W: viewFaceRule() },
    middle: { E: viewFaceRule(), S: viewFaceRule(), W: viewFaceRule() },
    top: { E: viewFaceRule(), S: viewFaceRule(), W: viewFaceRule() },
  };
}

export const PRESETS = [
  {
    id: 'residential-punched-inset-balconies',
    name: 'Residential punched windows with inset balconies',
    description: 'Default. Standalone 300 by 65 ft bar, five floors, punched windows, inset balconies on the north and south faces. WWR 0.243.',
    state: defaultState(),
  },

  {
    id: 'hotel-window-wall',
    name: 'Hotel window wall',
    description: 'Tower 180 by 62 ft, 24 floors, window wall over a storefront podium. Fails the 40 percent limit at WWR 0.807.',
    state: stateWith('Hotel window wall', hotelWindowWall),
  },

  {
    id: 'hotel-window-wall-solid-bands',
    name: 'Hotel window wall with solid bands',
    description: 'Same tower and podium as the hotel window wall, with two solid panels in every five on the tower faces. Fails the limit at WWR 0.537.',
    state: stateWith('Hotel window wall with solid bands', hotelWindowWallSolidBands),
  },

  {
    id: 'office-curtain-wall',
    name: 'Office curtain wall',
    description: 'Bar 200 by 90 ft, 32 floors at 13.5 ft, curtain wall with vision 8 on every face. Fails the limit at WWR 0.593.',
    state: stateWith('Office curtain wall', officeCurtainWall),
  },

  {
    id: 'office-curtain-wall-one-view-face',
    name: 'Office curtain wall, one view face',
    description: 'Same bar as the office curtain wall. The east, south, and west faces take vision 4 with every other panel solid. Passes at WWR 0.301.',
    state: stateWith('Office curtain wall, one view face', officeCurtainWallOneViewFace),
  },

  {
    id: 'podium-retail-storefront',
    name: 'Podium retail storefront',
    description: 'U-shaped bar over a two-level 300 by 200 ft podium. Storefront on the south base, transparency target 0.60, WWR 0.251.',
    state: stateWith('Podium retail storefront', (s) => {
      s.standalone.shape = 'U';
      s.standalone.width = 300;
      s.standalone.depth = 200;
      s.standalone.arm = 65;
      s.standalone.floors = 5;
      s.standalone.ftf1 = 16;
      s.standalone.ftf = 10;
      Object.assign(s.standalone.podium, { on: true, levels: 2, ftf: 11, width: 300, depth: 200 });
      s.zones.rules = {
        base: { system: 'punched' },
        middle: { system: 'punched' },
        top: { system: 'punched' },
      };
      s.zones.overrides = { base: { S: { system: 'storefront' } } };
      s.checks.transparencyTarget = 0.60;
      s.balconies.on = false;
    }),
  },

  {
    id: 'courtyard-multifamily-projected-balconies',
    name: 'Courtyard multifamily with projected balconies',
    description: 'Courtyard bar 250 by 220 ft over a solid podium level. Alternating projected balconies on the middle levels, 184 balconies, WWR 0.229.',
    state: stateWith('Courtyard multifamily with projected balconies', (s) => {
      s.standalone.shape = 'O';
      s.standalone.width = 250;
      s.standalone.depth = 220;
      s.standalone.arm = 65;
      s.standalone.courtW = 120;
      s.standalone.courtD = 90;
      s.standalone.floors = 5;
      s.standalone.ftf1 = 11;
      s.standalone.ftf = 10;
      Object.assign(s.standalone.podium, { on: true, levels: 1, ftf: 11, width: 250, depth: 220 });
      s.zones.rules = {
        base: { system: 'solid' },
        middle: { system: 'punched' },
        top: { system: 'punched' },
      };
      Object.assign(s.balconies, { on: true, type: 'projected', pattern: 'alternating', spacing: 2 });
    }),
  },

  {
    id: 'tower-glass-corner-fins',
    name: 'Tower glass corner with fins',
    description: 'Square tower 90 by 90 ft, 45 floors, glass corners and fins on the east and west faces. Fails the limit at WWR 0.618.',
    state: stateWith('Tower glass corner with fins', (s) => {
      s.standalone.width = 90;
      s.standalone.depth = 90;
      s.standalone.floors = 45;
      s.standalone.ftf1 = 18;
      s.standalone.ftf = 10;
      Object.assign(s.standalone.podium, { on: true, levels: 2, ftf: 15, width: 100, depth: 100 });
      s.zones.rules = {
        base: { system: 'storefront' },
        middle: { system: 'windowWall', solid: { count: 1, every: 3 } },
        top: { system: 'windowWall', solid: { count: 1, every: 3 } },
      };
      s.corners = 'glass';
      s.fins.on = true;
      s.balconies.on = false;
    }),
  },
];
