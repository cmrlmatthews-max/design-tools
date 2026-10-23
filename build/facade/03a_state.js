/* ==========================================================================
   STATE
   The default state and fillDefaults (older, partial or imported states become complete).
   Schema: docs/facade-studio-technical-plan.md section 2. The default state and the presets come from
   src/facade/presets.js (PresetsMod). All lengths are feet, areas square feet, ratios fractions
   (percent on the screen), angles degrees. East = +x, north = +y.
   ========================================================================== */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const SYSTEM_KEYS = ['punched', 'windowWall', 'curtainWall', 'storefront', 'solid'];
const SHAPES = ['rect', 'L', 'U', 'O'];
const SHAPE_LABELS = { rect: 'Rectangle', L: 'L', U: 'U', O: 'Courtyard (O)' };
const BALCONY_TYPES = ['inset', 'projected'];
const BALCONY_PATTERNS = ['stacked', 'alternating', 'checker', 'per-unit'];
const SOURCE_LABELS = { standalone: 'Standalone massing', project: 'Project massing' };

/** The default design: "Residential punched windows with inset balconies" (plan section 8.1). WWR 0.243, 66 balconies. */
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
  if (!['standalone', 'project'].includes(s.source)) s.source = 'standalone';
  const sa = s.standalone;
  if (!SHAPES.includes(sa.shape)) sa.shape = 'rect';
  for (const k of ['width', 'depth', 'arm', 'courtW', 'courtD']) sa[k] = clamp(num(sa[k], base.standalone[k]), 1, CONFIG.limits.maxDim);
  sa.angle = clamp(num(sa.angle, 0), -360, 360);
  sa.floors = Math.round(clamp(num(sa.floors, 5), 1, CONFIG.limits.maxLevels));
  sa.ftf1 = clamp(num(sa.ftf1, 12), 6, 40);
  sa.ftf = clamp(num(sa.ftf, 10), 6, 40);
  sa.podium.on = !!sa.podium.on;
  sa.podium.levels = Math.round(clamp(num(sa.podium.levels, 1), 1, 20));
  sa.podium.ftf = clamp(num(sa.podium.ftf, 11), 6, 40);
  sa.podium.width = clamp(num(sa.podium.width, 300), 1, CONFIG.limits.maxDim);
  sa.podium.depth = clamp(num(sa.podium.depth, 200), 1, CONFIG.limits.maxDim);
  // zones
  const z = s.zones;
  if (z.mode !== 'ranges') z.mode = 'default';
  if (!Array.isArray(z.ranges)) z.ranges = [];
  z.ranges = z.ranges.filter(isObj).slice(0, CONFIG.limits.maxRanges).map((r, i) => ({
    id: typeof r.id === 'string' && r.id ? r.id : `Z${i + 1}`, name: String(r.name || `Range ${i + 1}`).slice(0, 40),
    from: Math.max(1, Math.round(num(r.from, 1))), to: Math.max(1, Math.round(num(r.to, num(r.from, 1)))),
  }));
  if (!isObj(z.rules)) z.rules = {};
  for (const id of ['base', 'middle', 'top', 'crown', ...z.ranges.map((r) => r.id)]) {
    if (!isObj(z.rules[id])) z.rules[id] = id === 'crown' ? { system: 'solid' } : deepClone(z.rules.middle || { system: 'punched' });   // the crown is a screen by default
    if (!SYSTEM_KEYS.includes(z.rules[id].system)) z.rules[id].system = 'punched';
  }
  if (!isObj(z.overrides)) z.overrides = {};
  for (const id of Object.keys(z.overrides)) {
    if (!isObj(z.overrides[id])) { delete z.overrides[id]; continue; }
    for (const o of Object.keys(z.overrides[id])) {
      if (!CONFIG.orientations.includes(o) || !isObj(z.overrides[id][o])) delete z.overrides[id][o];
      else if (z.overrides[id][o].system !== undefined && !SYSTEM_KEYS.includes(z.overrides[id][o].system)) delete z.overrides[id][o].system;
    }
  }
  const b = s.balconies;
  b.on = !!b.on;
  if (!BALCONY_TYPES.includes(b.type)) b.type = 'projected';
  if (!BALCONY_PATTERNS.includes(b.pattern)) b.pattern = 'stacked';
  b.spacing = Math.round(clamp(num(b.spacing, 2), 1, 20));
  if (!Array.isArray(b.zones)) b.zones = ['middle'];
  if (!Array.isArray(b.orientations)) b.orientations = ['N', 'S'];
  for (const k of ['fins', 'shades']) {
    s[k].on = !!s[k].on;
    if (!Array.isArray(s[k].orientations)) s[k].orientations = [];
    if (!Array.isArray(s[k].zones)) s[k].zones = [];
  }
  s.fins.every = Math.round(clamp(num(s.fins.every, 1), 1, 20));
  if (!Array.isArray(s.bands)) s.bands = [];
  s.bands = s.bands.filter(isObj).slice(0, CONFIG.limits.maxBands).map((x) => (x.every !== undefined
    ? { every: Math.round(clamp(num(x.every, 3), 1, 60)), material: String(x.material || 'metal') }
    : { zone: String(x.zone || 'base'), material: String(x.material || 'metal') }));
  if (s.corners !== 'glass') s.corners = 'solid';
  if (!['auto', 'manual'].includes(s.street.mode)) s.street.mode = 'auto';
  if (!Array.isArray(s.street.manual)) s.street.manual = [];
  s.street.roadDistance = clamp(num(s.street.roadDistance, 60), 0, 2000);
  s.checks.wwrLimit = clamp(num(s.checks.wwrLimit, 0.4), 0, 1);
  s.checks.transparencyTarget = s.checks.transparencyTarget == null ? null : clamp(num(s.checks.transparencyTarget, 0.6), 0, 1);
  if (!Array.isArray(s.materials) || !s.materials.length) s.materials = deepClone(base.materials);
  const v = s.view;
  v.site = v.site !== false;                       // the project site layer (ground, roads, water, trees, neighbors); on unless switched off
  v.siteStyle = ['solid', 'glass', 'wireframe'].includes(v.siteStyle) ? v.siteStyle : 'solid';     // neighbor buildings in the site layer: solid, glass or wireframe
  if (v.style !== 'diagram') v.style = 'model';
  if (v.colorBy !== 'wwr') v.colorBy = 'system';
  if (!CONFIG.orientations.includes(v.elevation)) v.elevation = null;
  v.sun = { azimuth: clamp(num(v.sun && v.sun.azimuth, 135), 0, 360), altitude: clamp(num(v.sun && v.sun.altitude, 40), 3, 90) };
  v.shot = isObj(v.shot) ? v.shot : {};
  merge(v.shot, { title: true, date: true, metrics: true, mark: true });
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/** Saved options at an older schema step up here. Schema 1 is the first, so nothing changes yet. */
function migrateState(state /* , fromSchema */) { return state; }
