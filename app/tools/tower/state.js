/* ==========================================================================
   TOWER: state, defaults, migration and the derived pipeline
   Port of build/tower/01_config.js, 03a_state.js, 04_geometry.js and 05_envelope.js.
   The math stays in src/tower/ (geometry, envelope, presets). This file holds the tool's state shape, the fill-in rule
   for older states, the Surround set, the unit breakdown and a cached geometry run for one store.
   ========================================================================== */
import * as Geo from '../../../src/tower/geometry.js';
import * as Env from '../../../src/tower/envelope.js';
import * as Presets from '../../../src/tower/presets.js';

export const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const PROGRAM_LABELS = {
  residential: 'Residential', hotel: 'Hotel', office: 'Office', retail: 'Retail',
  amenity: 'Amenity', parking: 'Parking', mechanical: 'Mechanical',
};

export const CONFIG = {
  limits: { maxFloors: 400, maxDim: 5000, maxHistory: 50 },
  floorGap: 0.5,                       // ft, gap between extruded plates when floor lines are on
  programs: Object.fromEntries(Object.entries(Presets.PROGRAM_DEFAULTS).map(([k, v]) => [k, { label: PROGRAM_LABELS[k] || k, ...v }])),
  zoneColors: { podium: '#8b929a', tower: '#4f7fd1', mechanical: '#e0762f', crown: '#d9a22b' },
  outsideColor: '#d64545',
  presets: Presets.PRESETS,
  storageKey: 'towergen.options.v1',   // shared with the old Tower page
  heroColor: '#E0A458',                // AI-ready image: the model paints in this color
  heroColorName: 'amber',              // the name the Hero render prompt uses for it
  schema: 2,                           // the option state
  projectSchema: 1,                    // schema of the "massing" section
  projectSaveMs: 250,                  // wait before the section is rebuilt and written
  contextRadius: 600,
  maxContext: 300,
  tool: 'tower',
};

/* ---------- defaults ---------- */

function defaultPrograms() {
  const programs = {};
  for (const [k, p] of Object.entries(CONFIG.programs)) programs[k] = { ftf: p.ftf, unitSize: p.unitSize, unitFactor: p.unitFactor, color: p.color };
  return programs;
}
export function defaultSegment() {
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
/** The sun block kept for files that carry it (the Sun Study is not in the app). */
export function defaultSun() {
  return {
    mode: 'manual',
    place: { source: 'default', lat: 33.749, lon: -84.388 },
    tz: { zone: 'us-eastern', offset: -5 },
    dates: ['03-20', '06-21', '12-21'],
    date: '03-20',
    time: 720,
    times: [540, 720, 900],
    play: false,
    hours: { on: false, spacing: 10, step: 30, date: '03-20', extent: 'site' },
  };
}
export function defaultState() {
  return {
    schema: 2,
    name: 'Option A',
    placement: null,
    site: {
      shape: 'none',
      width: 250, depth: 200,
      points: [],
      setbacks: { front: 10, back: 10, left: 10, right: 10 },
      heightLimit: 0,
      stepback: { on: false, aboveHeight: 85, distance: 15 },
    },
    context: { show: true, fromSite: false, radius: 600, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] },
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
    crown: { type: 'flat', height: 20, steps: 3, slopeSide: 'front' },
    programs: defaultPrograms(),
    targets: { gfa: 0, far: 0 },
    sun: defaultSun(),
    view: {
      style: 'model',
      colorBy: 'program',
      snap: { on: true, grid: 5 },
      floorLines: true,
      shadows: true,
      sun: { azimuth: 135, altitude: 40 },
      grid: true,
      figure: true,
      envelope: true,
      site: true,
      siteStyle: 'solid',
      shot: { title: true, date: true, metrics: true, mark: true },
    },
  };
}

function migrateView(v) {
  if (v.colorBy !== 'zone' && v.colorBy !== 'program') v.colorBy = 'program';
  if (!v.snap || typeof v.snap !== 'object') v.snap = { on: true, grid: 5 };
  v.snap = { on: v.snap.on !== false, grid: v.snap.grid === 10 ? 10 : 5 };
  v.siteStyle = ['solid', 'glass', 'wireframe'].includes(v.siteStyle) ? v.siteStyle : 'solid';
  return v;
}

/** Option schema 1 -> 2. Passed to createStorage({ migrate }). */
export function migrateTower(state, from) {
  const s = state && typeof state === 'object' ? state : {};
  if (from === 1 || !(from >= 2)) {
    if (s.placement === undefined) s.placement = null;
    if (!s.context || typeof s.context !== 'object' || Array.isArray(s.context)) s.context = { show: true, blocks: [] };
    if (s.context.fromSite === undefined) s.context.fromSite = false;
    if (s.context.radius === undefined) s.context.radius = 600;
    if (!s.sun || typeof s.sun !== 'object') s.sun = defaultSun();
    s.sun.mode = 'manual';
  }
  s.schema = 2;
  return s;
}

function legacySite(s) {
  if (s.site && isObj(s.site) && !['none', 'rect', 'polygon'].includes(s.site.shape)) s.site.shape = 'rect';
}

/** Fills every missing field from the defaults so older or partial states (presets, imports) are complete. */
export function fillDefaults(src) {
  const s = isObj(src) ? deepClone(src) : {};
  const merge = (t, d) => {
    for (const k of Object.keys(d)) {
      if (t[k] === undefined) t[k] = deepClone(d[k]);
      else if (isObj(d[k]) && isObj(t[k])) merge(t[k], d[k]);
    }
  };
  legacySite(s);
  delete s.core;
  const base = defaultState();
  merge(s, base);
  migrateView(s.view);
  if (isObj(s.placement)) s.placement.baseMode = s.placement.baseMode === 'typed' ? 'typed' : 'follow';
  if (isObj(s.placement) && s.placement.pinned !== true) delete s.placement.pinned;
  if (!Array.isArray(s.segments) || !s.segments.length) s.segments = [defaultSegment()];
  const seg0 = defaultSegment();
  s.segments.forEach((seg) => merge(seg, seg0));
  for (const k of Object.keys(CONFIG.programs)) {
    if (!isObj(s.programs[k])) s.programs[k] = deepClone(base.programs[k]);
    const p = s.programs[k];
    if (typeof p.unitFactor === 'number' && p.unitFactor > 1) p.unitFactor = p.unitFactor / 100;
    if (typeof p.unitSize === 'number' && p.unitSize <= 0) { p.unitSize = null; p.unitFactor = null; }
    if (p.unitSize == null && p.unitFactor != null) p.unitFactor = null;
  }
  for (const key of ['setbacks', 'mechanical', 'carves', 'cuts']) if (!Array.isArray(s[key])) s[key] = [];
  if (!Array.isArray(s.context.blocks)) s.context.blocks = [];
  if (!isObj(s.sun)) s.sun = defaultSun();
  s.sun.play = false;
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/* ---------- unit breakdown (presentation of the estimates) ---------- */

export function unitBreakdown(m) {
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

/* ---------- site helpers ---------- */

const siteRect = (w, d) => { const x = w / 2, y = d / 2; return [[-x, -y], [x, -y], [x, y], [-x, y]]; };
/** The site ring, or [] when the design has no site (site.shape === 'none', "Unlimited"). */
export function sitePolygon(state) {
  const s = state.site;
  if (s.shape === 'none') return [];
  if (s.shape === 'polygon' && Array.isArray(s.points) && s.points.length >= 3) return s.points.map((p) => [p[0], p[1]]);
  return siteRect(clamp(num(s.width, 0), 0, CONFIG.limits.maxDim), clamp(num(s.depth, 0), 0, CONFIG.limits.maxDim));
}
export const designHasSite = (state) => !!state.site && state.site.shape !== 'none';

/** The ring the Surround set sits around: the site, or, with no site, the box of the building as it stands. */
function surroundRing(state) {
  const ring = sitePolygon(state);
  if (ring.length || designHasSite(state)) return ring;
  try {
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const p of Geo.buildPlates(state, { quality: 'draft' }).plates) {
      if (p.void) continue;
      for (const poly of p.polygons) for (const q of poly.outer) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
    }
    return isFinite(b.minX) ? [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] : [];
  } catch (e) { return []; }
}

/** Surround set: one block on each side of the site, 20 ft off the boundary. */
export function surroundBlocks(state) {
  const ring = surroundRing(state);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  if (!isFinite(minX)) return [];
  const gap = 20, depth = 80;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, W = maxX - minX, D = maxY - minY;
  const r = (v) => Math.round(v * 10) / 10;
  return [
    { x: r(cx), y: r(minY - gap - depth / 2), w: r(W), d: depth, h: 60 },
    { x: r(cx), y: r(maxY + gap + depth / 2), w: r(W), d: depth, h: 90 },
    { x: r(minX - gap - depth / 2), y: r(cy), w: depth, d: r(D), h: 45 },
    { x: r(maxX + gap + depth / 2), y: r(cy), w: depth, d: r(D), h: 75 },
  ];
}

/* ---------- bounds, warnings and the cached run ---------- */

/** Model + site bounds in plan coordinates. `height` includes the crown. */
export function computeBounds(state, plates, height) {
  const box = () => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const add = (b, x, y) => { b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); };
  const model = box(), site = box();
  for (const p of plates) {
    if (p.void) continue;
    for (const poly of p.polygons) for (const q of poly.outer) add(model, q[0], q[1]);
  }
  for (const q of sitePolygon(state)) add(site, q[0], q[1]);
  if (!isFinite(site.minX) && isFinite(model.minX)) { const m = 30; Object.assign(site, { minX: model.minX - m, maxX: model.maxX + m, minY: model.minY - m, maxY: model.maxY + m }); }
  if (!isFinite(site.minX)) Object.assign(site, { minX: -50, maxX: 50, minY: -50, maxY: 50 });
  if (!isFinite(model.minX)) Object.assign(model, site);
  const union = {
    minX: Math.min(model.minX, site.minX), maxX: Math.max(model.maxX, site.maxX),
    minY: Math.min(model.minY, site.minY), maxY: Math.max(model.maxY, site.maxY),
  };
  const all = { ...union };
  if (state.context && state.context.show) {
    for (const b of state.context.blocks || []) {
      const hw = num(b.w, 0) / 2, hd = num(b.d, 0) / 2;
      add(all, num(b.x, 0) - hw, num(b.y, 0) - hd); add(all, num(b.x, 0) + hw, num(b.y, 0) + hd);
    }
  }
  const h = Math.max(0, height || 0);
  return { model: { ...model, height: h }, site, union: { ...union, height: h }, all: { ...all, height: h } };
}

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code, level: w.severity, text: w.message, floors: w.floors || [] });
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => (SEVERITY_ORDER[a[0].level] - SEVERITY_ORDER[b[0].level]) || (a[1] - b[1])).map((x) => x[0]);

/** Geometry + envelope for one state. Full quality; metrics are added by the caller. */
export function computeGeometry(s) {
  try {
    const g = Geo.buildPlates(s);
    const env = Env.checkEnvelope(s, g.plates, g.solids);
    const limit = Math.max(0, num(s.site && s.site.heightLimit, 0));
    if (limit > 0) {
      for (const p of env.plates) {
        if (p.z + p.ftf > limit + 0.01 && !p.void && p.area > 0) { p.outsideEnvelopeArea = Math.max(p.outsideEnvelopeArea, p.area); env.outside.set(p.n, p.outsideEnvelopeArea); }
      }
    }
    return {
      floors: g.floors, plates: env.plates, solids: g.solids, solidsOutside: env.solidsOutside,
      warnings: sortWarnings(g.warnings.concat(env.warnings).map(mapWarning)),
      outside: env.outside,
    };
  } catch (e) {
    console.error(e);
    return {
      floors: [], plates: [], solids: [], solidsOutside: [], outside: new Map(),
      warnings: [{ id: 'internal', level: 'error', text: 'The geometry could not be built for these settings.', floors: [] }],
    };
  }
}
function safeWire(s, topZ) { try { return Env.envelopeWireframe(s, topZ); } catch (e) { console.error(e); return []; } }

export function hasCurves(s) {
  const curved = (sh) => !!sh && (sh.type === 'circle' || sh.type === 'ellipse' || ((sh.type === 'rect' || sh.type === 'square' || !sh.type) && num(sh.radius, 0) > 0));
  return (s.podium.on && curved(s.podium.shape)) || s.segments.some((g) => curved(g.shape));
}

/* Hidden October 28, 2026 (Cade). See docs/removed-features.md. While these features are hidden they have no effect on the
   model, so a saved value cannot change the building with no control left to clear it. The values stay in the saved
   state and work again when the feature comes back. Set HIDDEN_FEATURES_OFF to false to bring them back. */
export const HIDDEN_FEATURES_OFF = true;
let effSrc = null, effOut = null;
/** The state the model is built from: the store state minus the hidden features. Same object while the state is the same. */
export function effectiveState(s) {
  if (!HIDDEN_FEATURES_OFF || !s) return s;
  if (s === effSrc) return effOut;
  // Hidden October 28, 2026 (Cade). See docs/removed-features.md. The zoning lot and its setbacks have no effect: the tower is built as
  // "Unlimited" (no lot line, no setback checks, no lot snap lines). The saved lot, setbacks, height limit and stepback stay in the state.
  // The FAR comes from the Site Model site area instead (createDerived, siteArea).
  const site = s.site ? { ...s.site, shape: 'none', setbacks: { front: 0, back: 0, left: 0, right: 0 }, heightLimit: 0, stepback: { ...(s.site.stepback || {}), on: false } } : s.site;
  const crown = s.crown && s.crown.type === 'spire' ? s.crown : s.crown;   // a saved spire stays until the user picks another type
  effSrc = s;
  // The Program panel (with the GFA and FAR targets) is hidden too (October 28, 2026): the targets are off. The program defaults stay.
  effOut = { ...s, site, crown, targets: { gfa: 0, far: 0 }, view: s.view ? { ...s.view, envelope: false } : s.view, setbacks: [], mechanical: [], carves: [], cuts: [], context: { ...(s.context || {}), blocks: [] } };
  return effOut;
}

/** Metrics with the Site Model site area (sf) in place of the zoning lot: siteArea, far, siteCoverage, hasSite and the FAR target check.
 *  No area (null or 0) means no site: the FAR and the site coverage are 0 and hasSite is false. */
export function withSiteArea(m, area, targets) {
  const A = typeof area === 'number' && isFinite(area) && area > 0 ? area : 0;
  const t = targets || {};
  const check = (target, current) => (num(target, 0) > 0 ? { target, current, diff: current - target, pct: ((current - target) / target) * 100 } : null);
  const far = A > 0 ? m.gfa / A : 0;
  return {
    ...m, siteArea: A, hasSite: A > 0, far, siteCoverage: A > 0 ? m.floor1Area / A : 0,
    target: { gfa: check(num(t.gfa, 0), m.gfa), far: check(num(t.far, 0), far) },
  };
}

/** One cached run of the pipeline per store. opts.siteArea() gives the Site Model site area in sf (or null), which the FAR uses. get() is the full result; display(draft) is what to draw (coarser while a slider drags). */
export function createDerived(store, opts = {}) {
  const siteAreaOf = () => { try { return (opts.siteArea && opts.siteArea()) || null; } catch (e) { return null; } };
  let gKey = null, aKey = null, geomId = 0, counter = 0;
  let full = null, cache = null, draftCache = null;
  const geomKeyOf = (s) => JSON.stringify([s.site, s.podium, s.segments, s.setbacks, s.mechanical, s.carves, s.cuts, s.crown]);

  function get() {
    const s = effectiveState(store.raw());
    const gk = geomKeyOf(s);
    if (gk !== gKey || !full) { gKey = gk; geomId++; full = computeGeometry(s); aKey = null; draftCache = null; }
    const area = siteAreaOf();
    const ak = JSON.stringify([s.programs, s.targets, s.context, area]);
    if (ak !== aKey || !cache) {
      aKey = ak;
      const metrics = withSiteArea(Geo.computeMetrics(s, full.plates), area, s.targets);
      cache = { id: ++counter, geomId, ...full, metrics, bounds: computeBounds(s, full.plates, metrics.totalHeight), wire: safeWire(s, metrics.totalHeight) };
    }
    return cache;
  }
  function display(draft) {
    const d = get();
    const s = effectiveState(store.raw());
    if (!draft || !hasCurves(s)) return { key: `f${d.geomId}`, plates: d.plates, solids: d.solids, solidsOutside: d.solidsOutside, quality: 'full' };
    if (!draftCache || draftCache.geomId !== d.geomId) {
      let g;
      try { g = Geo.buildPlates(s, { quality: 'draft' }); } catch (e) { return { key: `f${d.geomId}`, plates: d.plates, solids: d.solids, solidsOutside: d.solidsOutside, quality: 'full' }; }
      const out = new Map(d.plates.map((p) => [p.n, p.outsideEnvelopeArea]));
      draftCache = {
        geomId: d.geomId, key: `d${d.geomId}`, quality: 'draft',
        plates: g.plates.map((p) => ({ ...p, outsideEnvelopeArea: out.get(p.n) || 0 })),
        solids: g.solids, solidsOutside: g.solids.map((_, i) => !!d.solidsOutside[i]),
      };
    }
    return draftCache;
  }
  return { get, display };
}

export { Geo, Env };
