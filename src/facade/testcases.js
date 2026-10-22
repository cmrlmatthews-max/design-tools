// Hand-calculated test cases for the facade studio, one per preset (plan section 8),
// plus the concept examples A, A2, B, and B2 (sections 8.9 and 8.10), which are test cases only.
// Expected values are the section 8 numbers. The arithmetic is in the comments.
//  - wwr and wwrByOrientation are glazing over wall (plan section 3.11). Compared to tolerance.
//  - transparency is the S face ground band ratio (plan section 3.10), where section 8 gives it.
//  - balconies is { count, area } in sf (plan section 3.8).
//  - wall and glazing are total areas in sf. Compared to areaTolerance (plan section 9.1, test 17).
//  - tolerance is 0.001 for ratios and counts. areaTolerance is 0.1 sf for areas.

import { PRESETS, defaultState } from "./presets.js";

const stateOf = (id) => structuredClone(PRESETS.find((p) => p.id === id).state);

// Concept example A (section 8.9): rect 300 by 65, five floors, punched everywhere, no balconies.
function conceptA() {
  const s = defaultState();
  s.name = 'Concept example A';
  s.balconies.on = false;
  return s;
}

// Variant A2: the base zone takes storefront on the S face.
function conceptA2() {
  const s = conceptA();
  s.name = 'Concept example A2';
  s.zones.overrides = { base: { S: { system: 'storefront' } } };
  return s;
}

// Concept example B (section 8.10): rect 90 by 90, ten floors at 10, curtain wall with vision 8.
function conceptB() {
  const s = defaultState();
  s.name = 'Concept example B';
  s.standalone.width = 90;
  s.standalone.depth = 90;
  s.standalone.floors = 10;
  s.standalone.ftf1 = 10;
  s.standalone.ftf = 10;
  const wall = () => ({ system: 'curtainWall', vision: 8, sill: 0 });
  s.zones.rules = { base: wall(), middle: wall(), top: wall() };
  s.balconies.on = false;
  return s;
}

// Variant B2: the N face keeps vision 8. The E, S, and W faces take vision 4 with every other panel solid.
function conceptB2() {
  const s = conceptB();
  s.name = 'Concept example B2';
  const viewFaceRule = () => ({ system: 'curtainWall', vision: 4, solid: { count: 1, every: 2 } });
  s.zones.overrides = {
    base: { E: viewFaceRule(), S: viewFaceRule(), W: viewFaceRule() },
    middle: { E: viewFaceRule(), S: viewFaceRule(), W: viewFaceRule() },
    top: { E: viewFaceRule(), S: viewFaceRule(), W: viewFaceRule() },
  };
  return s;
}

export const TEST_CASES = [
  {
    id: 'residential-punched-inset-balconies',
    description: 'Default state: punched windows, inset balconies on N and S, five floors.',
    state: stateOf('residential-punched-inset-balconies'),
    // N and S: 21 modules, 693 glazing per level. Balconies on i = 0, 2, ..., 20 = 11 per level, 3 levels, 33 per face.
    // Glazing per face = 5 x 693 + 33 x 15 = 3,960. Wall = 300 x 52 = 15,600. WWR 0.254.
    // E and W: 5 x 132 = 660 on 65 x 52 = 3,380. WWR 0.195.
    // Overall (2 x 3,960 + 2 x 660) / (2 x 15,600 + 2 x 3,380) = 9,240 / 37,960 = 0.243.
    // Balconies 66, area 66 x 72 = 4,752. Transparency S: 693 / (300 x 8) = 0.289.
    expect: {
      wwr: 0.243,
      wwrByOrientation: { N: 0.254, E: 0.195, S: 0.254, W: 0.195 },
      transparency: 0.289,
      balconies: { count: 66, area: 4752 },
      wall: 37960,
      glazing: 9240,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'hotel-window-wall',
    description: 'Hotel window wall: storefront podium, window wall tower, 24 floors.',
    state: stateOf('hotel-window-wall'),
    // Tower perimeter 484. Glazing 484 x 26/3 x 24 = 100,672. Wall 484 x 10 x 24 = 116,160.
    // Podium perimeter 720. Glazing 720 x 8.5 x 2 = 12,240. Wall 720 x 33 = 23,760.
    // Overall 112,912 / 139,920 = 0.807, fails.
    // N and S: (37,440 + 4,080) / (43,200 + 7,920) = 0.812. E and W: (12,896 + 2,040) / (14,880 + 3,960) = 0.793.
    // Transparency S: storefront covers the 2 to 10 ft band fully, 1.00.
    expect: {
      wwr: 0.807,
      wwrByOrientation: { N: 0.812, E: 0.793, S: 0.812, W: 0.793 },
      transparency: 1.0,
      wall: 139920,
      glazing: 112912,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'hotel-window-wall-solid-bands',
    description: 'Hotel window wall with two solid panels in every five on the tower faces.',
    state: stateOf('hotel-window-wall-solid-bands'),
    // 180 ft faces: n = 36, solid when i mod 5 >= 3, so 14 solid and 22 glazed.
    // 62 ft faces: n = 12, module 5.1667, solid i = 3, 4, 8, 9, so 8 glazed.
    // Tower glazing 2 x 22 x 5 x 26/3 x 24 + 2 x 8 x 5.1667 x 26/3 x 24 = 45,760 + 17,194.67 = 62,954.67.
    // Overall (62,954.67 + 12,240) / 139,920 = 0.537, fails.
    expect: {
      wwr: 0.537,
      wall: 139920,
      glazing: 2 * 22 * 5 * 208 + 2 * 8 * (31 / 6) * 208 + 12240,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'office-curtain-wall',
    description: 'Office curtain wall: vision 8 on every face, 32 floors at 13.5 ft.',
    state: stateOf('office-curtain-wall'),
    // WWR = 8 / 13.5 = 0.593 on every face, fails.
    // Wall 580 x 13.5 x 32 = 250,560. Glazing 580 x 8 x 32 = 148,480.
    // Transparency S: vision 0 to 8 covers the 2 to 10 ft band over 2 to 8 ft, 6 / 8 = 0.75.
    expect: {
      wwr: 0.593,
      wwrByOrientation: { N: 0.593, E: 0.593, S: 0.593, W: 0.593 },
      transparency: 0.75,
      wall: 250560,
      glazing: 148480,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'office-curtain-wall-one-view-face',
    description: 'Office curtain wall with vision 4 and every other panel solid on the E, S, and W faces.',
    state: stateOf('office-curtain-wall-one-view-face'),
    // Per floor. N: 1,600 / 2,700 = 0.593. S: n = 40, 20 glazed, 20 x 5 x 4 = 400, so 400 / 2,700 = 0.148.
    // E and W: n = 18, 9 glazed, 9 x 5 x 4 = 180, so 180 / 1,215 = 0.148.
    // Overall per floor (1,600 + 400 + 360) / 7,830 = 0.301, passes.
    // Over 32 floors: wall 250,560. Glazing 2,360 x 32 = 75,520.
    expect: {
      wwr: 0.301,
      wwrByOrientation: { N: 0.593, E: 0.148, S: 0.148, W: 0.148 },
      wall: 250560,
      glazing: 75520,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'podium-retail-storefront',
    description: 'U-shaped bar over a two-level podium, storefront on the south base, transparency target 0.60.',
    state: stateOf('podium-retail-storefront'),
    // Podium per level: S storefront 300 x 8.5 = 2,550; N 693; E and W 462 each. Total 4,167.
    // Walls 1,000 x 16 = 16,000 and 1,000 x 11 = 11,000.
    // U faces per floor: S 693, E and W 462 each, arm ends 132 each, inner sides 297 each, court back 396. Total 2,871.
    // Wall per floor 1,270 x 10 = 12,700.
    // Overall (2 x 4,167 + 5 x 2,871) / (27,000 + 63,500) = 22,689 / 90,500 = 0.251.
    // Transparency S: 300 x 8 / 2,400 = 1.00, meets the 0.60 target.
    expect: {
      wwr: 0.251,
      transparency: 1.0,
      wall: 90500,
      glazing: 22689,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'courtyard-multifamily-projected-balconies',
    description: 'Courtyard bar with a solid podium level and alternating projected balconies on the middle levels.',
    state: stateOf('courtyard-multifamily-projected-balconies'),
    // Windows per floor 2 x 561 + 2 x 495 + 2 x 264 + 2 x 198 = 3,036. Five floors: 15,180.
    // Balconies: each face gets 2n over four levels. Sum of n = 17 + 17 + 15 + 15 + 8 + 8 + 6 + 6 = 92, so 184 balconies.
    // Doors add 184 x 15 = 2,760. Glazing 15,180 + 2,760 = 17,940.
    // Wall: bars 1,360 x 10 x 5 = 68,000; podium 940 x 11 = 10,340. Total 78,340.
    // Overall 17,940 / 78,340 = 0.229. Balcony area 184 x 72 = 13,248.
    // Transparency: 0, the podium is solid.
    expect: {
      wwr: 0.229,
      transparency: 0,
      balconies: { count: 184, area: 13248 },
      wall: 78340,
      glazing: 17940,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'tower-glass-corner-fins',
    description: 'Square tower with glass corners and fins on the east and west faces.',
    state: stateOf('tower-glass-corner-fins'),
    // Per face n = 18. Solid i = 2, 5, 8, 11, 14, 17. The glass corner turns i = 17 glazed, so 13 glazed.
    // Tower glazing 4 x 13 x 5 x 26/3 x 45 = 101,400. Podium glazing 400 x 8.5 x 2 = 6,800. Total 108,200.
    // Wall 162,000 + 13,200 = 175,200. Overall 108,200 / 175,200 = 0.618, fails.
    expect: {
      wwr: 0.618,
      wall: 175200,
      glazing: 108200,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'concept-example-a',
    description: 'Concept example A: rect 300 by 65, punched everywhere. Test case only.',
    state: conceptA(),
    // N and S: 21 x 33 x 5 = 3,465 on 15,600, so 0.222. E and W: 660 on 3,380, so 0.195.
    // Overall (2 x 3,465 + 2 x 660) / 37,960 = 8,250 / 37,960 = 0.217.
    // Transparency S: 693 / 2,400 = 0.289.
    expect: {
      wwr: 0.217,
      wwrByOrientation: { N: 0.222, E: 0.195, S: 0.222, W: 0.195 },
      transparency: 0.289,
      wall: 37960,
      glazing: 8250,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'concept-example-a2',
    description: 'Concept example A2: concept A with storefront on the S face of the base zone. Test case only.',
    state: conceptA2(),
    // Replace the level 1 S punched glazing 693 with storefront 2,550: 8,250 - 693 + 2,550 = 10,107.
    // Overall 10,107 / 37,960 = 0.266. Transparency S: storefront covers the band, 1.00.
    expect: {
      wwr: 0.266,
      transparency: 1.0,
      wall: 37960,
      glazing: 10107,
      tolerance: 0.001,
      areaTolerance: 0.1,
    },
  },

  {
    id: 'concept-example-b',
    description: 'Concept example B: rect 90 by 90, ten floors at 10, curtain wall with vision 8. Test case only.',
    state: conceptB(),
    // Vision 8 over 10 ft floors: 8 / 10 = 0.800 on every face.
    expect: {
      wwr: 0.8,
      wwrByOrientation: { N: 0.8, E: 0.8, S: 0.8, W: 0.8 },
      tolerance: 0.001,
    },
  },

  {
    id: 'concept-example-b2',
    description: 'Concept example B2: N vision 8, E, S, and W vision 4 with every other panel solid. Test case only.',
    state: conceptB2(),
    // Per floor: N 8 x 90 = 720 glazing. E, S, W: n = 18, 9 glazed, 9 x 5 x 4 = 180 each.
    // Overall per floor (720 + 3 x 180) / 3,600 = 0.350. E, S, W: 180 / 900 = 0.200.
    expect: {
      wwr: 0.35,
      wwrByOrientation: { N: 0.8, E: 0.2, S: 0.2, W: 0.2 },
      tolerance: 0.001,
    },
  },
];
