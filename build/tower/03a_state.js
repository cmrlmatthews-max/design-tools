/* ==========================================================================
   SHARED: store
   One state object (plan section 2). Get/set by path, subscribe, undo/redo
   (50 steps). Continuous slider drags are "live" sets that coalesce into one
   undo step when commit() is called (pointerup / change).
   ========================================================================== */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function defaultPrograms() {
  const programs = {};
  for (const [k, p] of Object.entries(CONFIG.programs)) programs[k] = { ftf: p.ftf, unitSize: p.unitSize, unitFactor: p.unitFactor, color: p.color };
  return programs;
}
function defaultSegment() {
  return {
    floors: 10,
    ftf: 10,
    program: 'residential',
    shape: { type: 'rect', w: 100, d: 100, radius: 0, points: [] },
    offset: { x: 0, y: 0 },
    rotation: 0,
    taper: { x: 0, y: 0, curve: 'linear' },
    twist: { deg: 0, start: 0, end: 1, curve: 'linear' },
    lean: { x: 0, y: 0 },
  };
}
function defaultState() {
  return {
    schema: 1,
    name: 'Option A',

    site: {
      shape: 'rect',
      width: 250, depth: 200,
      points: [],
      setbacks: { front: 10, back: 10, left: 10, right: 10 },
      heightLimit: 400,
      stepback: { on: false, aboveHeight: 85, distance: 15 },
    },

    context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },

    podium: {
      on: false,
      floors: 4,
      groundFtf: 18,
      ftf: 14,
      shape: { type: 'rect', w: 220, d: 170, radius: 0, points: [] },
      offset: { x: 0, y: 0 },
      program: 'retail',
      upperProgram: 'amenity',
    },

    segments: [defaultSegment()],

    setbacks: [],
    mechanical: [],
    carves: [],
    cuts: [],

    // Integration note 2: a flat crown adds the 4 ft parapet ring only and adds 0 to total height.
    crown: { type: 'flat', height: 20, steps: 3, slopeSide: 'front' },

    core: { mode: 'percent', percent: 20, w: 40, d: 30 },

    programs: defaultPrograms(),

    targets: { gfa: 0, far: 0 },

    view: {
      style: 'model',
      colorBy: 'program',        // v1.1: new options color the Diagram by program (saved options that say "zone" keep it)
      snap: { on: true, grid: 5 },   // v1.1: drag snapping. grid is 5 or 10 (ft)
      floorLines: true,
      shadows: true,
      sun: { azimuth: 135, altitude: 40 },
      grid: true,
      figure: true,
      envelope: true,
      shot: { title: true, date: true, metrics: true, mark: true },
    },
  };
}

/** v1.1 view migration. colorBy keeps whatever an older saved option stored ("zone"); anything unknown becomes "program". snap is
 *  { on, grid } with grid 5 or 10. */
function migrateView(v) {
  if (v.colorBy !== 'zone' && v.colorBy !== 'program') v.colorBy = 'program';
  if (!v.snap || typeof v.snap !== 'object') v.snap = { on: true, grid: 5 };
  v.snap = { on: v.snap.on !== false, grid: v.snap.grid === 10 ? 10 : 5 };
  return v;
}

/** Fill every missing field from the defaults so older or partial states (presets, imports) are complete. */
function fillDefaults(src) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const s = isObj(src) ? deepClone(src) : {};
  const merge = (t, d) => {
    for (const k of Object.keys(d)) {
      if (t[k] === undefined) t[k] = deepClone(d[k]);
      else if (isObj(d[k]) && isObj(t[k])) merge(t[k], d[k]);
    }
  };
  const base = defaultState();
  merge(s, base);                                           // a state with no colorBy gets "program"; an explicit "zone" or "program" is kept
  migrateView(s.view);
  if (!Array.isArray(s.segments) || !s.segments.length) s.segments = [defaultSegment()];
  const seg0 = defaultSegment();
  s.segments.forEach((seg) => merge(seg, seg0));
  for (const k of Object.keys(CONFIG.programs)) {
    if (!isObj(s.programs[k])) s.programs[k] = deepClone(base.programs[k]);
    const p = s.programs[k];
    if (typeof p.unitFactor === 'number' && p.unitFactor > 1) p.unitFactor = p.unitFactor / 100;   // legacy percent
    if (typeof p.unitSize === 'number' && p.unitSize <= 0) { p.unitSize = null; p.unitFactor = null; }
    if (p.unitSize == null && p.unitFactor != null) p.unitFactor = null;
  }
  for (const key of ['setbacks', 'mechanical', 'carves', 'cuts']) if (!Array.isArray(s[key])) s[key] = [];
  if (!Array.isArray(s.context.blocks)) s.context.blocks = [];
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}


/** Presentation of the unit estimates. Parking is a count of spaces, never dwelling units, so it is listed apart and
 *  never added to the total. `total` = residential units + hotel keys (+ units of any other program that sets a unit size). */
function unitBreakdown(m) {
  const rows = [];
  for (const [k, bp] of Object.entries(m.byProgram || {})) {
    if (bp.units == null) continue;
    const base = (CONFIG.programs[k] || {}).label || k;
    const kind = k === 'parking' ? 'spaces' : k === 'hotel' ? 'keys' : 'units';
    const label = k === 'parking' ? 'Parking spaces' : k === 'hotel' ? 'Hotel keys' : k === 'residential' ? 'Residential units' : `${base} units`;
    rows.push({ key: k, kind, label, count: bp.unitsWhole, size: bp.unitSize, bp });
  }
  const dwelling = rows.filter((r) => r.kind !== 'spaces');
  const spaces = rows.filter((r) => r.kind === 'spaces');
  const total = dwelling.reduce((a, r) => a + r.count, 0);
  const kinds = new Set(dwelling.map((r) => r.kind));
  return { rows, dwelling, spaces, total, hasTotal: dwelling.length > 0, label: kinds.has('units') && kinds.has('keys') ? 'Units + keys' : kinds.has('keys') ? 'Keys' : 'Units' };
}
