/* ==========================================================================
   GRADING TOOL: model
   The pure part of the shell port of the Grading Sketch: limits, labels, the state defaults (fillDefaults), the build
   pipeline (state + project -> buildGrading -> metrics -> warnings), the section patch, the project source rules,
   the text of a selected item, and plan helpers.
   No DOM and no Three.js here. The math stays in src/grading/*; this file only calls it in order.
   Port of build/grading/01_config.js, 03a_state.js, 04_geometry.js, 05_pipeline.js and 09b_project.js (the reading rules).
   ========================================================================== */
import * as FeaturesMod from '../../../src/grading/features.js';
import * as GradMetricsMod from '../../../src/grading/metrics.js';
import * as EarthMod from '../../../src/grading/earthwork.js';
import * as PresetsMod from '../../../src/grading/presets.js';
import { gradingDerived } from '../../../src/grading/derived.js';
import { getSection } from '../../../src/shared/project.js';
import { toolOn } from '../registry.js';
import { Units } from '../../core/ui-kit.js';

export { FeaturesMod, GradMetricsMod, EarthMod, PresetsMod };

export const CONFIG = {
  limits: { maxDim: 5000, maxBuildings: 8, maxTiers: 8, maxFeatures: 12 },
  // Cut and fill map: fill blue, cut red, five steps each (0 to 1, 1 to 2, 2 to 4, 4 to 8, over 8 ft).
  diffEdges: [1, 2, 4, 8],
  fillColors: ['#cde2f5', '#9cc6ec', '#6199d6', '#3470b8', '#1c478a'],
  cutColors: ['#f7d3cb', '#eda697', '#dc7366', '#c1433a', '#8f2a24'],
  noChangeColor: '#4a5159',
  noChange: 0.05,
  classColors: { walk: '#2f9e5b', ramp: '#e0a21b', fail: '#d03a30' },
  classLabels: { walk: 'Walk', ramp: 'Ramp', fail: 'Over the ramp limit' },
  wallColor: '#c4c8cc',
  wallStepColor: '#aab0b6',
  wallFlagColor: '#e0762b',
  padColor: '#6aa2ea',
  driveColor: '#9aa6b4',
  lotColor: '#9a8de0',
  propertyColor: '#d9843a',
  conflictColor: '#e0483d',
  existingColor: '#8e98a3',
  buildingHeight: 12,
  heroColor: '#E0A458',
  schema: 1,
  projectSchema: 1,
  tool: 'grading',
  sketchCaution: 'Caution: this is a sketch for early coordination with the civil engineer. It is never a grading plan. Every volume, slope, and wall height is a design-stage estimate.',
  earthCaution: 'Caution: grid earthwork compares options. It is not a quantity takeoff. Expect about plus or minus 5 to 10 percent against a civil surface model, more where edges fall between samples.',
  daylightCaution: 'Caution: stable slopes depend on the soil. 3:1 and 2:1 are starting values, not a geotechnical recommendation.',
  routeCaution: 'Caution: these limits come from the 2010 ADA Standards and ICC A117.1. The adopted code and its amendments decide. The tool reports slopes; it never says "compliant".',
  wallCaution: 'Caution: walls over about 4 ft often need an engineered design, a permit, and a guard. Verify every wall with the civil and structural engineers.',
  gradeCaution: 'Caution: drive and lot grades are design values for a sketch. The fire marshal and the local code set fire access grades. Verify every grade with the civil engineer.',
  stepCaution: 'Caution: a step between tiers changes the building, not only the ground. A 4 ft step needs stairs or a ramp inside the building and a stepped slab. Confirm every step with the design team.',
};

/* ---------- small helpers ---------- */
export const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const rnd = (v, k = 1000) => Math.round(v * k) / k;
export const isPt = (p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]);

export const SOURCE_LABELS = { standalone: 'Standalone', project: 'Open project' };
const BUILDING_SOURCES = ['typed', 'massing', 'parking'];

export function defaultState() { return PresetsMod.defaultState(); }

const cleanPts = (arr, min) => {
  const pts = (Array.isArray(arr) ? arr : []).filter(isPt).map((p) => [p[0], p[1]]);
  return pts.length >= min ? pts : null;
};
const cleanId = (raw, prefix, i, taken) => {
  let id = typeof raw === 'string' && raw ? raw : `${prefix}${i + 1}`;
  let n = i + 1;
  while (taken.has(id)) id = `${prefix}${++n}`;
  taken.add(id);
  return id;
};

/** Fills every missing field from the defaults so older, partial or imported states become complete. */
export function fillDefaults(src) {
  const s = isObj(src) ? deepClone(src) : {};
  const merge = (t, d) => {
    for (const k of Object.keys(d)) {
      if (t[k] === undefined) t[k] = deepClone(d[k]);
      else if (isObj(d[k]) && isObj(t[k])) merge(t[k], d[k]);
    }
  };
  merge(s, defaultState());
  if (!['standalone', 'project'].includes(s.source)) s.source = 'standalone';

  const g = s.ground;
  if (g.mode !== 'site') g.mode = 'plane';
  g.plane.z0 = clamp(num(g.plane.z0, 1000), -1000, 20000);
  g.plane.slope = clamp(num(g.plane.slope, 5), -100, 100);
  g.plane.downhill = ((num(g.plane.downhill, 180) % 360) + 360) % 360;
  g.margin = clamp(num(g.margin, 200), 0, 2000);

  if (s.property.mode !== 'drawn') s.property.mode = 'site';
  s.property.ring = cleanPts(s.property.ring, 3) || [];
  if (s.property.mode === 'drawn' && s.property.ring.length < 3) s.property.mode = 'site';

  const taken = new Set();
  s.buildings = (Array.isArray(s.buildings) ? s.buildings : []).filter(isObj).slice(0, CONFIG.limits.maxBuildings).map((b, i) => {
    const out = { ...b };
    out.id = cleanId(b.id, 'B', i, taken);
    out.name = String(b.name || out.id).slice(0, 40);
    if (!BUILDING_SOURCES.includes(out.source)) out.source = 'typed';
    if (out.source === 'typed') out.outer = cleanPts(b.outer, 3) || [[-50, -30], [50, -30], [50, 30], [-50, 30]];
    else delete out.outer;
    out.axis = typeof b.axis === 'number' && Number.isFinite(b.axis) ? b.axis : 'auto';
    let tiers = (Array.isArray(b.tiers) ? b.tiers : []).filter(isObj).slice(0, CONFIG.limits.maxTiers).map((t) => ({
      length: typeof t.length === 'number' && Number.isFinite(t.length) && t.length > 0 ? t.length : null,
      ffe: typeof t.ffe === 'number' && Number.isFinite(t.ffe) ? t.ffe : 'balance',
    }));
    if (!tiers.length) tiers = [{ length: null, ffe: 'balance' }];
    out.tiers = tiers;
    out.padOffset = clamp(num(b.padOffset, 5), 0, 200);
    out.padDepth = clamp(num(b.padDepth, 1), 0, 20);
    return out;
  });
  if (s.balance !== 'site') s.balance = 'pad';
  s.maxStep = clamp(num(s.maxStep, 4), 0.5, 40);

  const tk = { D: new Set(), L: new Set(), W: new Set(), R: new Set() };
  s.drives = (Array.isArray(s.drives) ? s.drives : []).filter(isObj).slice(0, CONFIG.limits.maxFeatures).map((d, i) => ({
    id: cleanId(d.id, 'D', i, tk.D), line: cleanPts(d.line, 2) || [[0, 0], [0, 50]], width: clamp(num(d.width, 24), 4, 200),
    start: typeof d.start === 'number' && Number.isFinite(d.start) ? d.start : 'existing',
    slope: clamp(num(d.slope, 5), -30, 30), cross: clamp(num(d.cross, 2), 0, 20), crown: d.crown !== false,
  }));
  s.lots = (Array.isArray(s.lots) ? s.lots : []).filter(isObj).slice(0, CONFIG.limits.maxFeatures).map((l, i) => ({
    id: cleanId(l.id, 'L', i, tk.L), ring: cleanPts(l.ring, 3) || [[0, 0], [60, 0], [60, 60], [0, 60]],
    anchor: isPt(l.anchor) ? [l.anchor[0], l.anchor[1]] : null,
    start: typeof l.start === 'number' && Number.isFinite(l.start) ? l.start : 'existing',
    dir: ((num(l.dir, 0) % 360) + 360) % 360, slope: clamp(num(l.slope, 2), -30, 30), cross: clamp(num(l.cross, 1), -30, 30),
  }));
  s.walls = (Array.isArray(s.walls) ? s.walls : []).filter(isObj).slice(0, CONFIG.limits.maxFeatures * 2).map((w, i) => ({
    id: cleanId(w.id, 'W', i, tk.W), line: cleanPts(w.line, 2) || [[0, 0], [50, 0]], kind: 'drawn',
  }));
  s.routes = (Array.isArray(s.routes) ? s.routes : []).filter(isObj).slice(0, CONFIG.limits.maxFeatures).map((r, i) => ({
    id: cleanId(r.id, 'R', i, tk.R), line: cleanPts(r.line, 2) || [[0, 0], [50, 0]], name: String(r.name || `Route ${i + 1}`).slice(0, 40),
  }));
  const aw = s.autoWalls;
  aw.on = !!aw.on;
  aw.offset = clamp(num(aw.offset, 5), 0, 100);
  aw.accepted = (Array.isArray(aw.accepted) ? aw.accepted : []).filter((x) => typeof x === 'string');

  const dl = s.daylight;
  dl.on = !!dl.on;
  dl.fill = clamp(num(dl.fill, 3), 1, 12);
  dl.cut = clamp(num(dl.cut, 2), 0.5, 12);
  const lim = s.limits;
  lim.walk = clamp(num(lim.walk, 0.05), 0.005, 0.5);
  lim.ramp = clamp(num(lim.ramp, 0.0833), 0.005, 0.5);
  lim.cross = clamp(num(lim.cross, 0.0208), 0.001, 0.5);
  lim.rampRise = clamp(num(lim.rampRise, 2.5), 0.5, 20);
  lim.wallFlag = clamp(num(lim.wallFlag, 4), 0.5, 100);
  lim.lotMin = clamp(num(lim.lotMin, 0.01), 0, 0.5);
  lim.lotMax = clamp(num(lim.lotMax, 0.05), 0.001, 0.5);
  lim.driveMax = clamp(num(lim.driveMax, 0.1), 0.005, 0.5);
  const ew = s.earthwork;
  ew.subdivide = Math.round(clamp(num(ew.subdivide, 4), 1, 8));
  ew.bulking = clamp(num(ew.bulking, 1), 0.5, 2);

  const v = s.view;
  v.contours.on = !!v.contours.on;
  v.contours.interval = v.contours.interval === 2 ? 2 : 1;
  v.contours.existing = !!v.contours.existing;
  v.contours.proposed = !!v.contours.proposed;
  v.exaggeration = 1;                                // one frame in the shell: no vertical exaggeration yet
  v.section = null;
  v.sun = { azimuth: clamp(num(v.sun && v.sun.azimuth, 135), 0, 360), altitude: clamp(num(v.sun && v.sun.altitude, 40), 3, 90) };
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/* ---------- plan geometry ---------- */
export const ringArea = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export function pointInRing(x, y, ring) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const xa = ring[a][0], ya = ring[a][1], xb = ring[b][0], yb = ring[b][1];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}
export function nearestOnSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L2, 0, 1) : 0;
  const x = a[0] + dx * t, y = a[1] + dy * t;
  return { x, y, t, d: Math.hypot(px - x, py - y) };
}
export const polyLength = (line) => { let L = 0; for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return L; };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassOf = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
const mv = (row, d = 0) => (typeof row === 'number' && Number.isFinite(row) ? row : d);

/* ---------- text formats (feet, elevations, cubic yards) ---------- */
const grouped = (n, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmt = {
  grouped,
  elev: (v) => (typeof v === 'number' && Number.isFinite(v) ? grouped(v, 2) : '—'),
  ft: (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? `${grouped(v, d)} ft` : '—'),
  cy: (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? `${grouped(v, d)} cy` : '—'),
  cy10: (v) => (typeof v === 'number' && Number.isFinite(v) ? `${grouped(Math.round(v / 10) * 10 + 0)} cy` : '—'),
  signed: (v, f) => (typeof v === 'number' && Number.isFinite(v) ? `${v > 0.00001 ? '+' : v < -0.00001 ? '−' : '±'}${f(Math.abs(v))}` : '—'),
  wall: (v) => (v > 0 ? `${(Math.round(v * 10) / 10).toFixed(1)} ft` : '0 ft'),
  round10: (v) => { const r = Math.round(v / 10) * 10; return r === 0 ? 0 : r; },
};
export const classWord = (k) => (k === 'walk' ? 'Walk' : k === 'ramp' ? 'Ramp' : 'Over the ramp limit');

/* ---------- the pipeline ---------- */
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code || w.id, level: w.severity || w.level || 'warn', text: w.message || w.text || String(w.code || w.id || ''), where: w.where || null });
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => ((SEVERITY_ORDER[a[0].level] ?? 1) - (SEVERITY_ORDER[b[0].level] ?? 1)) || (a[1] - b[1])).map((x) => x[0]);

const emptyHud = () => ({
  cut: 0, fill: 0, net: 0, cutCy: 0, fillCy: 0, netCy: 0, bulkedNetCy: 0, balance: 1, wallMax: 0, wallAvg: 0, wallLength: 0, wallCount: 0,
  padArea: 0, disturbed: 0, steepestRoute: 0, tiers: [], steps: [], routes: [], walls: [], tierCount: 0, subdivide: 4, quality: 'full',
});

function emptyDerived(message) {
  const grid = { spacing: 10, n: 2, x0: -10, y0: -10, nodes: new Float64Array(12), z: new Float64Array(4), min: 0, max: 0, at: () => 0 };
  const built = { source: 'standalone', ground: 'plane', grid, existingAt: () => 0, surface: { at: () => 0, conflicts: [] }, buildings: [], tiers: [], features: [], walls: [], conflicts: [], warnings: [], notes: [], property: [], quality: 'full' };
  return {
    ok: false, state: null, built, metrics: null, warnings: [{ id: 'internal', level: 'error', text: message || 'The grading could not be built for these settings.', where: null }],
    box: null, hud: emptyHud(), proposedZ: new Float64Array(4), zMin: 0, zMax: 1, refine: null, fine: null, notes: [], quality: 'full',
  };
}

const boxOfFeatures = (built) => {
  let b = null;
  const add = (x0, y0, x1, y1) => { b = !b ? { minX: x0, maxX: x1, minY: y0, maxY: y1 } : { minX: Math.min(b.minX, x0), maxX: Math.max(b.maxX, x1), minY: Math.min(b.minY, y0), maxY: Math.max(b.maxY, y1) }; };
  for (const f of built.features || []) if (f.box && Number.isFinite(f.box[0]) && f.box[2] >= f.box[0]) add(f.box[0], f.box[1], f.box[2], f.box[3]);
  for (const w of built.walls || []) for (const p of w.line || []) add(p[0], p[1], p[0], p[1]);
  return b;
};

/** The block of coarse cells that gets the 2x refinement: the work grown by 20 ft, made square, kept inside the grid. */
function refineBlock(built) {
  if (built.quality === 'draft') return null;
  const g = built.grid, work = boxOfFeatures(built);
  if (!work || g.n < 3) return null;
  const sp = g.spacing, n = g.n, grow = 20;
  const ci0 = Math.floor((work.minX - grow - g.x0) / sp), ci1 = Math.ceil((work.maxX + grow - g.x0) / sp);
  const cj0 = Math.floor((work.minY - grow - g.y0) / sp), cj1 = Math.ceil((work.maxY + grow - g.y0) / sp);
  let m = Math.max(ci1 - ci0, cj1 - cj0, 2);
  m = Math.min(m, n - 1);
  const mid = (a, b) => (a + b) / 2;
  const i0 = clamp(Math.round(mid(ci0, ci1) - m / 2), 0, n - 1 - m), j0 = clamp(Math.round(mid(cj0, cj1) - m / 2), 0, n - 1 - m);
  if (m * m > 120 * 120) return null;
  return { i0, j0, m };
}

/** The half-spacing grid over the block. Border midpoints take the average of their coarse neighbors, so the two meshes meet without a crack. */
function fineGridOf(built, block) {
  if (!block) return null;
  const g = built.grid, at = built.surface.at, sp = g.spacing / 2, N = block.m * 2 + 1;
  const x0 = g.x0 + block.i0 * g.spacing, y0 = g.y0 + block.j0 * g.spacing;
  const z = new Float64Array(N * N);
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
    if ((a & 1) && (b === 0 || b === N - 1)) continue;
    if ((b & 1) && (a === 0 || a === N - 1)) continue;
    z[b * N + a] = at(x0 + a * sp, y0 + b * sp);
  }
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
    if ((a & 1) && (b === 0 || b === N - 1)) z[b * N + a] = (z[b * N + a - 1] + z[b * N + a + 1]) / 2;
    else if ((b & 1) && (a === 0 || a === N - 1)) z[b * N + a] = (z[(b - 1) * N + a] + z[(b + 1) * N + a]) / 2;
  }
  return { spacing: sp, n: N, x0, y0, z, block };
}

/** HUD figures from the metrics. Volumes round to 10 cy on the HUD; the earthwork panel shows 0.1 cy. */
function summarize(built, metrics) {
  const cutCy = mv(metrics.cutCy), fillCy = mv(metrics.fillCy), netCy = mv(metrics.netCy);
  const walls = metrics.walls && Array.isArray(metrics.walls.list) ? metrics.walls.list : [];
  return {
    cut: fmt.round10(cutCy), fill: fmt.round10(fillCy), net: fmt.round10(netCy), cutCy, fillCy, netCy, bulkedNetCy: mv(metrics.bulkedNetCy), balance: mv(metrics.balance, 1),
    wallMax: mv(metrics.wallHeightMax), wallAvg: mv(metrics.wallHeightAvg), wallLength: mv(metrics.wallLength), wallCount: walls.length,
    padArea: mv(metrics.padArea), disturbed: mv(metrics.disturbedArea), steepestRoute: mv(metrics.steepestRoute),
    tiers: Array.isArray(metrics.tiers) ? metrics.tiers : [], steps: Array.isArray(metrics.steps) ? metrics.steps : [],
    routes: Array.isArray(metrics.routes) ? metrics.routes : [], walls,
    tierCount: (built.tiers || []).length, subdivide: mv(metrics.subdivide, 4), quality: built.quality || 'full', cellsSampled: mv(metrics.cellsSampled),
  };
}

/** Everything the panels, the layer and the section writer need for one state (no caching). `project` is the project document or null. */
export function computeDerived(s, { project = null, quality = 'full' } = {}) {
  try {
    const built = FeaturesMod.buildGrading(s, { project, quality });
    const metrics = GradMetricsMod.computeMetrics(s, built);
    const checks = Array.isArray(metrics.warnings) ? metrics.warnings : GradMetricsMod.checks(s, metrics);
    const warnings = (checks || []).map(mapWarning);
    const proposedZ = EarthMod.proposedGrid(built);
    let zLo = Infinity, zHi = -Infinity;
    for (let k = 0; k < proposedZ.length; k++) { if (proposedZ[k] < zLo) zLo = proposedZ[k]; if (proposedZ[k] > zHi) zHi = proposedZ[k]; }
    zLo = Math.min(zLo, built.grid.min); zHi = Math.max(zHi, built.grid.max);
    for (const t of built.tiers || []) { if (Number.isFinite(t.ffe)) zHi = Math.max(zHi, t.ffe + CONFIG.buildingHeight); }
    const refine = refineBlock(built);
    return {
      ok: true, state: s, built, metrics, warnings: sortWarnings(warnings), box: boxOfFeatures(built), hud: summarize(built, metrics),
      proposedZ, zMin: zLo, zMax: zHi, refine, fine: fineGridOf(built, refine), notes: built.notes || [], quality: built.quality,
    };
  } catch (e) {
    console.error(e);
    return emptyDerived('The grading could not be built for these settings.');
  }
}

/** A key that changes when the site, massing or parking data changes (not when this tool saves its own section). */
export function dataKey(doc) {
  if (!doc) return '';
  const st = (k) => { const s = getSection(doc, k); return (s && s.updatedAt) || ''; };
  return `${doc.id}|${st('massing')}|${st('parking')}|${st('site')}`;
}

/** The build depends on everything except the name and the view. */
export function geomKeyOf(s) { const { view, name, ...rest } = s; return JSON.stringify(rest); }

/* ---------- the section ---------- */
export const ZERO_PLACEMENT = () => ({ x: 0, y: 0, rotation: 0, baseZ: 0 });

/** The "grading" section patch for the design on screen (full quality). derived comes from src/grading/derived.js. */
export function sectionPatch(state, D) {
  const derived = gradingDerived(state, D.built, D.metrics);
  return { tool: CONFIG.tool, schema: CONFIG.projectSchema, placement: ZERO_PLACEMENT(), state: deepClone(state), derived, note: state.name };
}

/* ---------- the project as a source ---------- */
export function projectInfo(doc) {
  const has = (k) => !!(doc && getSection(doc, k));
  const site = getSection(doc, 'site');
  // The Parking Deck is hidden (October 28, 2026): its deck is not a grading building while hidden (registry.js).
  return { massing: has('massing'), parking: has('parking') && toolOn('parking'), siteGround: !!(site && site.derived && site.derived.ground) };
}
const projectBuilding = (source, n) => ({ id: `${source === 'massing' ? 'M' : 'P'}${n}`, name: source === 'massing' ? 'Massing' : 'Parking deck', source, axis: 'auto', tiers: [{ length: null, ffe: 'balance' }], padOffset: 5, padDepth: 1 });
const isDefaultBar = (b) => b.source === 'typed' && JSON.stringify(b.outer) === JSON.stringify(defaultState().buildings[0].outer) && (b.tiers || []).length === 1;

/** The state with the open project as the source: the site ground, and the massing and parking deck as buildings. Returns null when the project offers none. */
export function stateUsingProject(cur, doc) {
  const info = projectInfo(doc);
  if (!doc || !(info.siteGround || info.massing || info.parking)) return null;
  const next = deepClone(cur);
  next.source = 'project';
  if (info.siteGround) next.ground.mode = 'site';
  const add = [];
  if (info.massing && !next.buildings.some((b) => b.source === 'massing')) add.push(projectBuilding('massing', 1));
  if (info.parking && !next.buildings.some((b) => b.source === 'parking')) add.push(projectBuilding('parking', 1));
  if (add.length) {
    if (next.buildings.length === 1 && isDefaultBar(next.buildings[0])) next.buildings = [];
    next.buildings.push(...add);
  }
  return fillDefaults(next);
}

/** Back to the free-standing design: the project buildings go and the typed plane is the ground. */
export function stateStandalone(cur) {
  if (cur.source === 'standalone') return null;
  const next = deepClone(cur);
  next.source = 'standalone';
  next.ground.mode = 'plane';
  next.buildings = next.buildings.filter((b) => b.source === 'typed');
  if (!next.buildings.length) next.buildings = defaultState().buildings;
  return fillDefaults(next);
}

/* ---------- the text of a selected item ---------- */
export function describe(it, D, s) {
  if (!it) return { title: '', sub: '', rows: [] };
  const FT = Units.formatFeetInches;
  if (it.kind === 'drive') {
    const dv = s.drives.find((x) => x.id === it.id), f = D.built.features.find((x) => x.kind === 'drive' && x.id === it.id);
    if (!dv) return { title: `Drive ${it.id}`, sub: '', rows: [] };
    return { title: `Drive ${it.id}`, sub: `${FT(f ? f.length : polyLength(dv.line))} long, ${FT(dv.width)} wide`, rows: [['Slope', `${dv.slope}%`], ['Cross slope', `${dv.cross}%${dv.crown ? ' crowned' : ''}`], ['Start', dv.start === 'existing' ? 'existing ground' : fmt.elev(dv.start)]] };
  }
  if (it.kind === 'lot') {
    const l = s.lots.find((x) => x.id === it.id);
    if (!l) return { title: `Lot ${it.id}`, sub: '', rows: [] };
    return { title: `Lot ${it.id}`, sub: Units.formatArea(Math.abs(ringArea(l.ring))), rows: [['Slope', `${l.slope}%`], ['Cross slope', `${l.cross}%`], ['Uphill', `${Math.round(l.dir)}° ${compassOf(l.dir)}`]] };
  }
  if (it.kind === 'wall') {
    const w = D.metrics && D.metrics.walls && D.metrics.walls.list ? D.metrics.walls.list.find((x) => x.id === it.id) : null;
    const kind = w ? w.kind : 'drawn';
    const rows = w ? [['Tallest', `${w.heightMax.toFixed(2)} ft`], ['Average', `${w.heightAvg.toFixed(2)} ft`], ['Length', FT(w.length)]] : [];
    return { title: `${kind === 'auto' ? 'Automatic wall' : kind === 'pad-step' ? 'Pad-step wall' : 'Wall'} ${it.id}`, sub: w && w.heightMax > s.limits.wallFlag ? `Over the ${s.limits.wallFlag} ft flag` : '', rows, auto: kind === 'auto' ? { accepted: w.accepted !== false } : null };
  }
  if (it.kind === 'route') {
    const r = s.routes.find((x) => x.id === it.id), m = D.metrics && D.metrics.routes ? D.metrics.routes.find((x) => x.id === it.id) : null;
    if (!r) return { title: `Route ${it.id}`, sub: '', rows: [] };
    return { title: r.name, sub: `${FT(polyLength(r.line))} long`, rows: m ? [['Steepest running', pct1(m.maxSlope)], ['Steepest cross', pct1(m.maxCross)], ['Class', classWord(m.kind)]] : [] };
  }
  if (it.kind === 'building') {
    const b = D.built.buildings.find((x) => x.id === it.id), tiers = D.built.tiers.filter((t) => t.building === it.id);
    return { title: b ? b.name : it.id, sub: `${tiers.length} tier${tiers.length === 1 ? '' : 's'}`, rows: tiers.slice(0, 4).map((t) => [`Tier ${t.tier} FFE`, fmt.elev(t.ffe)]) };
  }
  if (it.kind === 'property') return { title: 'Property line', sub: `${FT(polyLength(s.property.ring.concat([s.property.ring[0]])))} around`, rows: [] };
  return { title: it.id, sub: '', rows: [] };
}

/** The shell item (selection card and layer pick) for a grading item. */
export function shellItem(it, D, s) {
  const info = describe(it, D, s);
  const rows = info.sub ? [['Size', info.sub], ...info.rows] : info.rows;
  return { id: `grading-${it.kind}-${it.id}`, title: info.title, rows, owner: 'grading', gsel: { kind: it.kind, id: it.id } };
}

/** The shell item of the proposed ground (a tap on the ground mesh). */
export function groundItem(D) {
  const h = D.hud;
  return {
    id: 'grading-ground', title: 'Proposed ground',
    rows: [['Cut', fmt.cy(h.cutCy)], ['Fill', fmt.cy(h.fillCy)], ['Net (fill minus cut)', fmt.signed(h.netCy, (x) => fmt.cy(x))], ['Balance', `${(h.balance * 100).toFixed(0)}%`]],
    owner: 'grading',
  };
}
