/* ==========================================================================
   STATE
   The default state, defaults for a bar, and fillDefaults (older, partial or
   imported states become complete). Schema: docs/mid-rise-generator-technical-plan.md section 2.
   All lengths are feet, areas square feet, angles degrees. North = +y, east = +x.
   ========================================================================== */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function defaultPrograms() {
  const programs = {};
  for (const [k, p] of Object.entries(CONFIG.programs)) {
    programs[k] = { ftf: p.ftf, unitSize: p.unitSize, unitFactor: p.unitFactor, unitWidth: p.unitWidth, parkingRatio: p.parkingRatio, color: p.color };
  }
  return programs;
}
function defaultBar(id = 'A') {
  return {
    id, name: `Bar ${id}`,
    x: -150, y: 0, angle: 0,
    length: 300, depth: 65,
    floors: 5,
    program: 'residential', groundProgram: null,
    corridor: 'double', unitSide: 'left',
    ends: { start: 'stair', end: 'stair' },
    bends: [],
    unitWidth: null,
  };
}
/** The next free bar id: A..Z, then A2..Z2, and so on. */
function nextBarId(bars) {
  const used = new Set((bars || []).map((b) => b.id));
  for (let round = 1; round < 50; round++) {
    for (let i = 0; i < 26; i++) {
      const id = String.fromCharCode(65 + i) + (round > 1 ? String(round) : '');
      if (!used.has(id)) return id;
    }
  }
  return `B${used.size + 1}`;
}

/** The default design: "Double-loaded bar, five floors" (plan section 8.3). 100 units, 52 ft, 120 stalls. */
function defaultState() {
  return {
    schema: 1,
    name: 'Option A',
    type: 'bar',

    site: {
      shape: 'none', width: 360, depth: 242, points: [],     // 'none' (Unlimited: no site line, setbacks or site checks) | 'rect' | 'polygon'
      setbacks: { front: 20, back: 20, left: 20, right: 20 },
      heightLimit: 0,
      stepback: { on: false, aboveHeight: 85, distance: 15 },
      densityCap: 0,
      openSpaceShare: 0,
      separationMin: 20,
      courtyardMin: 40,
    },

    placement: null,

    context: { show: true, fromSite: false, blocks: [{ x: 0, y: -201, w: 200, d: 120, h: 40 }] },

    floors: { groundFtf: 12, ftf: 10 },

    bars: [defaultBar('A')],
    courts: [],

    deck: { on: false, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true },

    podium: {
      on: false,
      levels: [{ ftf: 11, program: 'parking' }],
      footprint: { mode: 'allowed', percent: 100, offset: 0 },
      liner: { on: false, side: 'front', depth: 40 },
    },

    surface: { count: 120, lot: [] },

    programs: defaultPrograms(),

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
      style: 'model',
      colorBy: 'program',          // "program" | "bar"
      floorLines: true,
      shadows: true,
      sun: { azimuth: 135, altitude: 40 },
      grid: true,
      figure: true,
      ticks: true,                 // unit module ticks in plan
      envelope: true,
      site: true,                  // the project site (ground, boundary, neighbors, roads, water, trees) while a project with a site is open
      warnParking: true,           // the parking deficit counts as a warning (it can be turned off)
      snap: { on: true, grid: 5 },
      shot: { title: true, date: true, metrics: true, mark: true },
    },
  };
}

/** Saved options and project files from before the Unlimited site have a site and no shape: they were drawn on a rectangle, so they
 *  stay "rect". Only a state with no site at all gets the default ("none"). An unknown shape becomes "rect" too. */
function legacySite(s) {
  if (isObj(s.site) && !['none', 'rect', 'polygon'].includes(s.site.shape)) s.site.shape = 'rect';
}

/** Fill every missing field from the defaults so older or partial states (presets, imports) are complete. */
function fillDefaults(src) {
  const s = isObj(src) ? deepClone(src) : {};
  const merge = (t, d) => {
    for (const k of Object.keys(d)) {
      if (t[k] === undefined) t[k] = deepClone(d[k]);
      else if (isObj(d[k]) && isObj(t[k])) merge(t[k], d[k]);
    }
  };
  legacySite(s);
  const base = defaultState();
  const keepPlacement = s.placement;
  merge(s, base);
  if (keepPlacement === null || keepPlacement === undefined) s.placement = null;
  // view
  const v = s.view;
  if (v.colorBy !== 'bar' && v.colorBy !== 'program') v.colorBy = 'program';
  if (v.style !== 'diagram') v.style = 'model';
  v.snap = { on: v.snap.on !== false, grid: v.snap.grid === 10 ? 10 : 5 };
  // bars
  if (!Array.isArray(s.bars) || !s.bars.length) s.bars = [defaultBar('A')];
  s.bars = s.bars.filter(isObj);
  if (!s.bars.length) s.bars = [defaultBar('A')];
  const ids = new Set();
  s.bars.forEach((b) => { if (typeof b.id === 'string' && b.id && !ids.has(b.id)) ids.add(b.id); else b.id = null; });
  s.bars.forEach((b) => { if (!b.id) { b.id = nextBarId([...ids].map((id) => ({ id }))); ids.add(b.id); } });
  s.bars.forEach((b) => {
    merge(b, defaultBar('A'));
    if (typeof b.name !== 'string' || !b.name) b.name = `Bar ${b.id}`;
    if (!Array.isArray(b.bends)) b.bends = [];
    b.bends = b.bends.filter((x) => x && isFinite(x.at) && isFinite(x.deg)).slice(0, CONFIG.limits.maxBends);
    b.floors = Math.round(clamp(num(b.floors, 5), 1, CONFIG.limits.maxFloors));
  });
  if (!Array.isArray(s.courts)) s.courts = [];
  s.courts = s.courts.filter(isObj).map((c, i) => ({ id: c.id || `C${i + 1}`, x: num(c.x, 0), y: num(c.y, 0), w: num(c.w, 100), d: num(c.d, 80) }));
  if (!Array.isArray(s.podium.levels) || !s.podium.levels.length) s.podium.levels = deepClone(base.podium.levels);
  if (!Array.isArray(s.surface.lot)) s.surface.lot = [];
  if (!Array.isArray(s.context.blocks)) s.context.blocks = [];
  // programs: every program key exists and is complete
  for (const k of Object.keys(CONFIG.programs)) {
    if (!isObj(s.programs[k])) s.programs[k] = deepClone(base.programs[k]);
    const p = s.programs[k];
    merge(p, base.programs[k]);
    if (typeof p.unitFactor === 'number' && p.unitFactor > 1) p.unitFactor = p.unitFactor / 100;
  }
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/** Saved options at an older schema step up here. Schema 1 is the first, so nothing changes yet. */
function migrateState(state /* , fromSchema */) { return state; }
