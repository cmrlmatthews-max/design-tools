/* ==========================================================================
   STATE
   The default state and fillDefaults (older, partial or imported states become complete).
   Schema: docs/parking-deck-technical-plan.md section 2. The default state and the presets come from
   src/parking/presets.js (PresetsMod). All lengths are feet, areas square feet, slopes fractions
   (percent on the screen), angles degrees. East = +x, north = +y. Cores, entries and the speed ramp
   are in the layout frame (origin at the south-west corner of the footprint's bounding rectangle).
   ========================================================================== */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const RAMP_TYPES = ['single-helix', 'double-helix', 'speed', 'split', 'sloped-floor', 'none'];
const RAMP_LABELS = { 'single-helix': 'Single helix', 'double-helix': 'Double helix', speed: 'Speed ramp', split: 'Split-level', 'sloped-floor': 'Sloped floor', none: 'None' };
const SOURCE_LABELS = { standalone: 'Standalone deck', wrap: 'Wrap deck', podium: 'Podium parking' };
const SIDES = ['west', 'east', 'south', 'north'];

/** The default design: "Two-bay single helix, five levels" (plan section 8.1). 496 stalls, 378 sf per stall. */
function defaultState() { return PresetsMod.defaultState(); }

/** Fill every missing field from the defaults so older or partial states (presets, imports) are complete. */
function fillDefaults(src) {
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
  if (isObj(s.placement)) s.placement.baseMode = s.placement.baseMode === 'typed' ? 'typed' : 'follow';       // base elevation: Follow ground (default, and the migration for old saves) | Typed
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
  v.site = v.site !== false;                       // the project site layer (ground, roads, water, trees, neighbors); on unless switched off
  v.siteStyle = ['solid', 'glass', 'wireframe'].includes(v.siteStyle) ? v.siteStyle : 'solid';     // neighbor buildings in the site layer: solid, glass or wireframe
  if (v.colorBy !== 'slope') v.colorBy = 'kind';
  if (v.style !== 'diagram') v.style = 'model';
  v.level = Math.round(clamp(num(v.level, 0), 0, s.levels.count));
  v.snap = { on: v.snap.on !== false, grid: v.snap.grid === 5 ? 5 : 1 };
  v.shot = isObj(v.shot) ? v.shot : {};
  merge(v.shot, { title: true, date: true, metrics: true, mark: true });
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/** Saved options at an older schema step up here. Schema 1 is the first, so nothing changes yet. */
function migrateState(state /* , fromSchema */) { return state; }
