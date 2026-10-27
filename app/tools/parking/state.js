/* ==========================================================================
   PARKING: state and pipeline
   The default state, fillDefaults, the geometry helpers, the project readers (useSource logic), and the Derived cache.
   Port of build/parking/03a_state.js, 04_geometry.js, 05_pipeline.js and the reading half of 09b_project.js.
   The math stays in src/parking/*; this file only calls it in order. computeDerived never throws.
   ========================================================================== */
import * as THREE from 'three';
import * as PresetsMod from '../../../src/parking/presets.js';
import * as LayoutMod from '../../../src/parking/layout.js';
import * as RampsMod from '../../../src/parking/ramps.js';
import * as GridMod from '../../../src/parking/grid.js';
import * as AccessibleMod from '../../../src/parking/accessible.js';
import * as OverlayMod from '../../../src/parking/overlay.js';
import * as MetricsMod from '../../../src/parking/metrics.js';

export { LayoutMod, RampsMod };

/* ---------- config ---------- */
export const CONFIG = {
  limits: { maxLevels: 12, maxDim: 3000, maxCores: 12, maxEntries: 4 },
  kindColors: { standard: '#c3c9d0', accessible: '#2f7fd9', van: '#1b4a99', ev: '#3fa45c', compact: '#e0a21b' },
  kindLabels: { standard: 'Standard', accessible: 'Accessible', van: 'Van accessible', ev: 'EV installed', compact: 'Compact' },
  slopeColors: { ok: '#3fa45c', near: '#e0a21b', over: '#d64545' },
  conflictColor: '#d64545',
  coreColors: { stair: '#d9731a', elevator: '#7a5cc2' },
  presets: PresetsMod.PRESETS,
  schema: 1,
  projectSchema: 1,
  tool: 'parking',
  snapGrids: [1, 5],
  slabThickness: 1,
};
export const RAMP_TYPES = ['single-helix', 'double-helix', 'speed', 'split', 'sloped-floor', 'none'];
export const RAMP_LABELS = { 'single-helix': 'Single helix', 'double-helix': 'Double helix', speed: 'Speed ramp', split: 'Split-level', 'sloped-floor': 'Sloped floor', none: 'None' };
export const SOURCE_LABELS = { standalone: 'Standalone deck', wrap: 'Wrap deck', podium: 'Podium parking' };
export const SIDES = ['west', 'east', 'south', 'north'];

/* ---------- small helpers ---------- */
export const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const rnd = (v, k = 1000) => Math.round(v * k) / k;

export function defaultState() { return PresetsMod.defaultState(); }

/** Fill every missing field from the defaults so older or partial states (presets, imports) are complete. */
export function fillDefaults(src) {
  const s = isObj(src) ? deepClone(src) : {};
  const merge = (t, d) => {
    for (const k of Object.keys(d)) {
      if (t[k] === undefined) t[k] = deepClone(d[k]);
      else if (isObj(d[k]) && isObj(t[k])) merge(t[k], d[k]);
    }
  };
  const base = defaultState();
  const keepPlacement = s.placement;
  merge(s, base);
  if (keepPlacement === null || keepPlacement === undefined) s.placement = null;
  if (isObj(s.placement)) s.placement.baseMode = s.placement.baseMode === 'typed' ? 'typed' : 'follow';
  if (isObj(s.placement) && s.placement.pinned !== true) delete s.placement.pinned;
  if (!['standalone', 'wrap', 'podium'].includes(s.source)) s.source = 'standalone';
  if (s.footprint.shape !== 'polygon') s.footprint.shape = 'rect';
  if (!Array.isArray(s.footprint.points)) s.footprint.points = [];
  s.footprint.points = s.footprint.points.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map((p) => [p[0], p[1]]);
  if (s.footprint.shape === 'polygon' && s.footprint.points.length < 3) s.footprint.shape = 'rect';
  s.levels.count = Math.round(clamp(num(s.levels.count, 5), 1, CONFIG.limits.maxLevels));
  s.levels.belowGrade = Math.round(clamp(num(s.levels.belowGrade, 0), 0, s.levels.count));
  s.levels.openTop = s.levels.openTop !== false;
  if (!RAMP_TYPES.includes(s.ramp.type)) s.ramp.type = 'single-helix';
  if (!['straight', 'circular'].includes(s.ramp.speed.shape)) s.ramp.speed.shape = 'straight';
  if (![8, 12, 16].includes(s.ramp.speed.segments)) s.ramp.speed.segments = 12;
  if (s.grid.span !== 'short') s.grid.span = 'long';
  if (!Array.isArray(s.cores)) s.cores = [];
  s.cores = s.cores.filter(isObj).map((c, i) => ({
    id: typeof c.id === 'string' && c.id ? c.id : `C${i + 1}`, kind: c.kind === 'elevator' ? 'elevator' : 'stair',
    x: num(c.x, 0), y: num(c.y, 0), w: num(c.w, c.kind === 'elevator' ? 10 : 22), d: num(c.d, c.kind === 'elevator' ? 10 : 12),
  })).slice(0, CONFIG.limits.maxCores);
  if (!Array.isArray(s.entries)) s.entries = [];
  s.entries = s.entries.filter(isObj).map((e, i) => ({
    id: typeof e.id === 'string' && e.id ? e.id : `N${i + 1}`, side: SIDES.includes(e.side) ? e.side : 'west', at: num(e.at, 0), width: num(e.width, 24),
  })).slice(0, CONFIG.limits.maxEntries);
  if (!['south', 'north', 'east', 'west'].includes(s.liner.side)) s.liner.side = 'south';
  if (!Array.isArray(s.liner.levels)) s.liner.levels = [1];
  if (!Array.isArray(s.accessible.table) || !s.accessible.table.length) s.accessible.table = deepClone(base.accessible.table);
  if (s.bike.mode !== 'count') s.bike.mode = 'per-units';
  if (s.bike.rack !== 'two-tier') s.bike.rack = 'single';
  const v = s.view;
  if (v.colorBy !== 'slope') v.colorBy = 'kind';
  if (v.style !== 'diagram') v.style = 'model';
  v.level = Math.round(clamp(num(v.level, 0), 0, s.levels.count));
  v.overlay = v.overlay !== false;
  v.context = v.context !== false;
  v.snap = { on: v.snap.on !== false, grid: v.snap.grid === 5 ? 5 : 1 };
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/* ---------- geometry helpers ---------- */
export const ringArea = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export const multiArea = (mp) => (mp || []).reduce((t, pc) => t + Math.abs(ringArea(pc.outer)) - (pc.holes || []).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
export const rectRing = (x, y, w, d) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];

export function boxOfRings(rings) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const r of rings || []) for (const q of r) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
  return isFinite(b.minX) ? b : null;
}
export const boxOfPolys = (polys) => boxOfRings((polys || []).map((p) => p.outer));

const CLIP_SCALE = 1000;
const clipPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * CLIP_SCALE), Y: Math.round(p[1] * CLIP_SCALE) }));
const clipRing = (path) => path.map((p) => [p.X / CLIP_SCALE, p.Y / CLIP_SCALE]);
function treeToPolys(tree) {
  const out = [];
  const visit = (node) => {
    for (const child of node.Childs()) {
      if (!child.IsHole()) {
        const poly = { outer: clipRing(child.Contour()), holes: [] };
        for (const hole of child.Childs()) { poly.holes.push(clipRing(hole.Contour())); visit(hole); }
        if (Math.abs(ringArea(poly.outer)) > 1e-6) out.push(poly);
      } else visit(child);
    }
  };
  visit(tree);
  return out;
}
/** Union ('union'), difference ('diff') or intersection ('and') of two lists of { outer, holes }. */
export function clipPolys(subj, clip, op) {
  const L = globalThis.ClipperLib;
  const c = new L.Clipper();
  const add = (list, type) => {
    for (const p of list) {
      const outer = ringArea(p.outer) < 0 ? p.outer.slice().reverse() : p.outer;
      c.AddPath(clipPath(outer), type, true);
      for (const h of p.holes || []) c.AddPath(clipPath(ringArea(h) > 0 ? h.slice().reverse() : h), type, true);
    }
  };
  add(subj, L.PolyType.ptSubject);
  add(clip, L.PolyType.ptClip);
  const tree = new L.PolyTree();
  const type = op === 'diff' ? L.ClipType.ctDifference : op === 'and' ? L.ClipType.ctIntersection : L.ClipType.ctUnion;
  c.Execute(type, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return treeToPolys(tree);
}
/** A ring inset by `d` ft (Clipper offset, miter joins). Returns a ring or null. */
export function insetRing(ring, d) {
  const L = globalThis.ClipperLib;
  const o = new L.ClipperOffset(10, 0.25);
  const path = clipPath(ringArea(ring) < 0 ? ring.slice().reverse() : ring);
  o.AddPath(path, L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const out = new L.Paths();
  o.Execute(out, -d * CLIP_SCALE);
  if (!out.length) return null;
  let best = out[0];
  for (const p of out) if (Math.abs(L.Clipper.Area(p)) > Math.abs(L.Clipper.Area(best))) best = p;
  return clipRing(best);
}

/* ---------- pipeline ---------- */
const pt2 = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);

function asMulti(v) {
  if (!Array.isArray(v) || !v.length) return [];
  if (Array.isArray(v[0]) && typeof v[0][0] === 'number') return [{ outer: v, holes: [] }];
  if (Array.isArray(v[0]) && Array.isArray(v[0][0])) return v.map((r) => ({ outer: r, holes: [] }));
  return v.filter((p) => p && Array.isArray(p.outer)).map((p) => ({ outer: p.outer, holes: p.holes || [] }));
}

/** The matrix that puts geometry authored in the layout frame (through planToWorld) into the massing (local) frame. */
function frameMatrix(frame) {
  const o = pt2(frame.toLocal([0, 0])), ex = pt2(frame.toLocal([1, 0])), ey = pt2(frame.toLocal([0, 1]));
  const a = ex[0] - o[0], b = ex[1] - o[1], c = ey[0] - o[0], d = ey[1] - o[1];
  return new THREE.Matrix4().set(
    a, 0, -c, o[0],
    0, 1, 0, 0,
    -b, 0, d, -o[1],
    0, 0, 0, 1,
  );
}

function normalizeCores(state, raw) {
  const src = Array.isArray(raw.cores) && raw.cores.length ? raw.cores : state.cores;
  const out = [];
  (src || []).forEach((c, i) => {
    if (!c) return;
    let box = null;
    if (Array.isArray(c.outer) || Array.isArray(c.ring)) box = boxOfRings([c.outer || c.ring]);
    else if (isFinite(c.x) && isFinite(c.y)) box = { minX: c.x, maxX: c.x + num(c.w, c.kind === 'elevator' ? 10 : 22), minY: c.y, maxY: c.y + num(c.d, c.kind === 'elevator' ? 10 : 12) };
    if (!box) return;
    out.push({ id: String(c.id || `C${i + 1}`), kind: c.kind === 'elevator' ? 'elevator' : 'stair', box, fromProject: !!c.fromProject || c.source === 'project', inAisle: !!c.inAisle, outside: !!c.outside, hasFlags: c.inAisle !== undefined, w: box.maxX - box.minX, d: box.maxY - box.minY, x: box.minX, y: box.minY });
  });
  return out;
}
function coreIssuesOf(cores, levels) {
  const issues = {};
  for (const c of cores) {
    if (c.hasFlags) { if (c.inAisle) issues[c.id] = 'aisle'; else if (c.outside) issues[c.id] = 'outside'; continue; }
    const ring = rectRing(c.box.minX, c.box.minY, c.w, c.d);
    for (const lv of levels) {
      try {
        const aisle = lv.aisles && lv.aisles.length ? multiArea(clipPolys([{ outer: ring, holes: [] }], lv.aisles, 'and')) : 0;
        if (aisle > 1) { issues[c.id] = 'aisle'; break; }
      } catch (e) { /* ignore */ }
    }
    if (!issues[c.id]) {
      const lv = levels[0];
      if (lv && lv.plate && lv.plate.length) {
        try { if (multiArea(clipPolys([{ outer: ring, holes: [] }], lv.plate, 'and')) < c.w * c.d - 1) issues[c.id] = 'outside'; } catch (e) { /* ignore */ }
      }
    }
  }
  return issues;
}

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code || w.id, level: w.severity || w.level || 'warn', text: w.message || w.text, floors: w.levels || w.floors || [], action: w.action || null, ref: w.code ? (w.id || null) : null });
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => ((SEVERITY_ORDER[a[0].level] ?? 1) - (SEVERITY_ORDER[b[0].level] ?? 1)) || (a[1] - b[1])).map((x) => x[0]);

function computeBoundsFor(built, levels) {
  const model = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let height = 0;
  for (const lv of levels) {
    height = Math.max(height, (lv.z || 0) + (lv.ftf || 0));
    for (const poly of lv.plate || []) for (const q of poly.outer) {
      const p = pt2(built.frame.toLocal(q));
      model.minX = Math.min(model.minX, p[0]); model.maxX = Math.max(model.maxX, p[0]); model.minY = Math.min(model.minY, p[1]); model.maxY = Math.max(model.maxY, p[1]);
    }
  }
  if (!isFinite(model.minX)) Object.assign(model, { minX: -50, maxX: 50, minY: -50, maxY: 50 });
  return { ...model, height: Math.max(height + 9, 20) };
}

/** The numbers the metrics panel reads, with fallbacks computed from the built levels. */
export function hudOf(metrics, levels) {
  const m = metrics || {};
  const stalls = isFinite(m.stalls) ? m.stalls : levels.reduce((t, l) => t + (l.stalls || []).length, 0);
  const gross = isFinite(m.grossArea) ? m.grossArea : levels.reduce((t, l) => t + multiArea(l.plate), 0);
  return {
    stalls, sfPerStall: isFinite(m.sfPerStall) ? m.sfPerStall : (stalls ? Math.round(gross / stalls * 10) / 10 : 0), levels: isFinite(m.levels) ? m.levels : levels.length,
    maxSlope: isFinite(m.maxRampSlope) ? m.maxRampSlope : 0, gross, efficiency: m.efficiency || 0,
    required: m.required ? m.required.total : 0, balance: isFinite(m.balance) ? m.balance : 0,
    accessible: m.accessible || { required: 0, provided: 0, van: 0, car: 0, lost: 0 }, ev: m.ev || { installed: 0, ready: 0 },
    bike: m.bike || { required: 0, areaSf: 0 }, lowestClear: m.lowestClear || 0, clearHeights: m.clearHeights || [], conflicts: m.conflicts || 0,
    byKind: m.byKind || {}, byLevel: m.byLevel || [], topOfDeck: m.topOfDeck || 0, columns: m.columns || { perLevel: 0, total: 0, module: 0, conflicts: 0, source: 'none', suggestion: null },
  };
}

function emptyDerived(message) {
  const frame = { W: 0, D: 0, toLocal: (p) => p, toLayout: (p) => p };
  const built = { frame, levels: [], bays: [], strip: null, cores: [], warnings: [] };
  return {
    ok: false, state: null, raw: built, built, levels: [], ramps: [], columns: { lines: [], points: [], module: 0 }, clear: [], acc: { stalls: [], lost: 0, warnings: [] },
    overlay: { conflicts: [], suggestion: null, source: 'none', unitWidth: 0, tolerance: 2, checked: 0 }, demising: [], metrics: null, cores: [], coreIssues: {},
    warnings: [{ id: 'internal', level: 'error', text: message || 'The layout could not be built for these settings.', floors: [] }],
    box: null, bounds: computeBoundsFor(built, []), frame, matrix: new THREE.Matrix4(), hud: hudOf(null, []),
  };
}

/** Everything the panels, the layers, the exports and the project file need for one state (no caching). */
export function computeDerived(s, { project = null, quality = 'full' } = {}) {
  try {
    const raw = LayoutMod.layout(s, { project, quality });
    const ramps = RampsMod.rampsFor(s, raw);
    const columns = GridMod.columnsFor(s, raw);
    const clear = GridMod.clearHeights(s);
    const acc0 = AccessibleMod.placeAccessible(s, raw);
    const acc = { ...acc0, stalls: AccessibleMod.tagEv(s, acc0.stalls) };
    const byLevel = new Map();
    for (const st of acc.stalls) { if (!byLevel.has(st.level)) byLevel.set(st.level, []); byLevel.get(st.level).push(st); }
    const levels = raw.levels.map((lv) => ({
      ...lv, plate: asMulti(lv.plate), aisles: asMulti(lv.aisles), turnZones: asMulti(lv.turnZones),
      stalls: (byLevel.get(lv.index) || []),
    }));
    const built = { ...raw, levels, ramps, columns };
    let demising = [];
    try { demising = OverlayMod.demisingLines(project, raw.frame).xs || []; } catch (e) { demising = []; }
    const ov = OverlayMod.overlay(s, built, project, columns);
    const metrics = MetricsMod.computeMetrics(s, built, ramps, columns, acc, project);
    const checks = MetricsMod.checks(s, built, ramps, metrics);
    const cores = normalizeCores(s, raw);
    const coreIssues = coreIssuesOf(cores, levels);
    const seen = new Set();
    const warnings = [];
    for (const w of [...(raw.warnings || []), ...(acc.warnings || []), ...checks]) {
      const key = `${w.code}|${w.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push(mapWarning(w));
    }
    const box = boxOfRings(levels.flatMap((l) => l.plate.map((p) => p.outer)));
    return {
      ok: true, state: s, raw, built, levels, ramps, columns, clear, acc, overlay: ov, demising, metrics, cores, coreIssues,
      warnings: sortWarnings(warnings), box, bounds: computeBoundsFor(built, levels), frame: raw.frame, matrix: frameMatrix(raw.frame),
      hud: hudOf(metrics, levels),
    };
  } catch (e) {
    console.error(e);
    return emptyDerived('The layout could not be built for these settings.');
  }
}

/**
 * The Derived cache for one tool instance. get() recomputes only when the geometry key or the project data key changes
 * (the name, the view and the placement only change drawing). display(draft) says what to draw.
 */
export function createDerived({ store, readers }) {
  let gKey = null, geomId = 0, counter = 0, cache = null;
  const geomKeyOf = (s) => JSON.stringify([s.source, s.sourceLevel, s.footprint, s.levels, s.bays, s.grid, s.ramp, s.cores, s.coresFromProject, s.entries, s.liner, s.checks, s.accessible, s.ev, s.bike, s.required]);
  function get() {
    const s = store.raw();
    const gk = `${geomKeyOf(s)}|${readers.dataKey()}`;
    if (gk !== gKey || !cache) {
      gKey = gk; geomId++;
      cache = { id: ++counter, geomId, ...computeDerived(s, { project: readers.dataDoc() }) };
    }
    return cache;
  }
  function display(draft) {
    const d = get();
    return { key: `${draft ? 'd' : 'f'}${d.geomId}`, quality: draft ? 'draft' : 'full' };
  }
  return { get, display, reset: () => { gKey = null; cache = null; } };
}

/* ---------- project readers (docs/shell-plan.md 9.3; build/parking/09b_project.js) ---------- */
export const ZERO_PLACEMENT = () => ({ x: 0, y: 0, rotation: 0, baseZ: 0 });

/** Reads the massing, the plates and the site from the open project, through derived only (shell rule). */
export function createReaders(ctx) {
  const P = ctx.project;
  const sectionOf = (key) => { try { return P.section(key); } catch (e) { return null; } };
  const massing = () => sectionOf('massing');
  const massingLevels = () => {
    const sec = massing();
    const dv = sec && sec.derived;
    return dv && Array.isArray(dv.levels) ? dv.levels : [];
  };
  const dataDoc = () => { try { return P.doc() || null; } catch (e) { return null; } };
  return {
    sectionOf, massing, massingLevels, dataDoc,
    has: () => !!dataDoc(),
    /** A key that changes when the massing or plates data changes (not when this tool saves its own section). */
    dataKey() {
      const doc = dataDoc();
      if (!doc) return '';
      const m = sectionOf('massing'), p = sectionOf('plates');
      return `${doc.id}|${(m && m.updatedAt) || ''}|${(p && p.updatedAt) || ''}`;
    },
    /** Deck and podium levels of the massing, lowest first: [{ source, zone, levels: [{ index, z, ftf, area }] }]. */
    sources() {
      const out = [];
      for (const [source, zone] of [['wrap', 'deck'], ['podium', 'podium']]) {
        const list = massingLevels().filter((l) => l && l.zone === zone && Array.isArray(l.plates) && l.plates.length)
          .slice().sort((a, b) => num(a.z, 0) - num(b.z, 0));
        if (list.length) out.push({ source, zone, levels: list.map((l) => ({ index: l.index, z: num(l.z, 0), ftf: num(l.ftf, 10.5), area: Math.round(multiArea(l.plates)) })) });
      }
      return out;
    },
    hasMassing: () => !!massing(),
    massingPlacement() {
      const sec = massing();
      const p = sec && sec.placement;
      return isObj(p) ? { x: num(p.x, 0), y: num(p.y, 0), rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) } : null;
    },
    massingUnits() {
      const sec = massing();
      const m = sec && sec.derived && sec.derived.metrics;
      return m && isFinite(m.units) ? m.units : null;
    },
    /** The massing levels drawn as a ghost: { polys, z, ftf }, in the massing (local) frame. The deck's own zone is left out. */
    ghostLevels(state) {
      if (!dataDoc()) return [];
      const skip = state.source === 'wrap' ? 'deck' : state.source === 'podium' ? 'podium' : null;
      const out = [];
      for (const l of massingLevels()) {
        if (!l || !Array.isArray(l.plates) || !l.plates.length) continue;
        if (l.zone === skip) continue;
        out.push({ polys: l.plates, z: num(l.z, 0), ftf: num(l.ftf, 10.5) });
      }
      return out;
    },
    siteDerived() {
      const sec = sectionOf('site');
      return sec && isObj(sec.derived) && Object.keys(sec.derived).length ? sec.derived : null;
    },
    /** The ground-floor FFE of the deck from grading.derived.ffe (lowest tier of source 'parking'), or null. */
    gradingFfe() {
      const sec = sectionOf('grading');
      const list = sec && sec.derived && Array.isArray(sec.derived.ffe) ? sec.derived.ffe : [];
      const mine = list.filter((t) => t && t.source === 'parking' && isFinite(t.ffe));
      if (!mine.length) return null;
      mine.sort((a, b) => num(a.tier, 1) - num(b.tier, 1) || a.ffe - b.ffe);
      return mine[0].ffe;
    },
  };
}
