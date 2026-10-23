/* ==========================================================================
   STATE
   The default state and fillDefaults (older, partial or imported states become complete).
   Schema: docs/grading-sketch-technical-plan.md section 2. The default state and the presets come from
   src/grading/presets.js (PresetsMod). All lengths are feet, areas square feet, volumes cubic yards, angles degrees.
   Slopes in the state are percent for drives, lots and the ground plane, and fractions for the limits (percent on the screen).
   East = +x, north = +y. Elevations are NAVD88 feet with a site, local feet without one.
   ========================================================================== */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const SOURCE_LABELS = { standalone: 'Standalone', project: 'Open project' };
const BUILDING_SOURCES = ['typed', 'massing', 'parking'];
const STYLES = ['model', 'cutfill'];

/** The default design: "Bar on a cross slope" (plan section 8.1). Grid cut 325.1 cy, fill 348.2 cy. */
function defaultState() { return PresetsMod.defaultState(); }

const isPt = (p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && isFinite(p[0]) && isFinite(p[1]);
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
  merge(s, base);
  if (!['standalone', 'project'].includes(s.source)) s.source = 'standalone';

  // ground
  const g = s.ground;
  if (g.mode !== 'site') g.mode = 'plane';
  g.plane.z0 = clamp(num(g.plane.z0, 1000), -1000, 20000);
  g.plane.slope = clamp(num(g.plane.slope, 5), -100, 100);
  g.plane.downhill = ((num(g.plane.downhill, 180) % 360) + 360) % 360;
  g.margin = clamp(num(g.margin, 200), 0, 2000);

  // property
  if (s.property.mode !== 'drawn') s.property.mode = 'site';
  s.property.ring = cleanPts(s.property.ring, 3) || [];
  if (s.property.mode === 'drawn' && s.property.ring.length < 3) s.property.mode = 'site';

  // buildings
  const taken = new Set();
  s.buildings = (Array.isArray(s.buildings) ? s.buildings : []).filter(isObj).slice(0, CONFIG.limits.maxBuildings).map((b, i) => {
    const out = { ...b };
    out.id = cleanId(b.id, 'B', i, taken);
    out.name = String(b.name || out.id).slice(0, 40);
    if (!BUILDING_SOURCES.includes(out.source)) out.source = 'typed';
    if (out.source === 'typed') {
      out.outer = cleanPts(b.outer, 3) || [[-50, -30], [50, -30], [50, 30], [-50, 30]];
    } else {
      delete out.outer;
    }
    out.axis = typeof b.axis === 'number' && isFinite(b.axis) ? b.axis : 'auto';
    let tiers = (Array.isArray(b.tiers) ? b.tiers : []).filter(isObj).slice(0, CONFIG.limits.maxTiers).map((t) => ({
      length: typeof t.length === 'number' && isFinite(t.length) && t.length > 0 ? t.length : null,
      ffe: typeof t.ffe === 'number' && isFinite(t.ffe) ? t.ffe : 'balance',
    }));
    if (!tiers.length) tiers = [{ length: null, ffe: 'balance' }];
    out.tiers = tiers;
    out.padOffset = clamp(num(b.padOffset, 5), 0, 200);
    out.padDepth = clamp(num(b.padDepth, 1), 0, 20);
    return out;
  });
  if (s.balance !== 'site') s.balance = 'pad';
  s.maxStep = clamp(num(s.maxStep, 4), 0.5, 40);

  // drawn features
  const tk = { D: new Set(), L: new Set(), W: new Set(), R: new Set() };
  s.drives = (Array.isArray(s.drives) ? s.drives : []).filter(isObj).slice(0, CONFIG.limits.maxFeatures).map((d, i) => ({
    id: cleanId(d.id, 'D', i, tk.D), line: cleanPts(d.line, 2) || [[0, 0], [0, 50]], width: clamp(num(d.width, 24), 4, 200),
    start: typeof d.start === 'number' && isFinite(d.start) ? d.start : 'existing',
    slope: clamp(num(d.slope, 5), -30, 30), cross: clamp(num(d.cross, 2), 0, 20), crown: d.crown !== false,
  }));
  s.lots = (Array.isArray(s.lots) ? s.lots : []).filter(isObj).slice(0, CONFIG.limits.maxFeatures).map((l, i) => ({
    id: cleanId(l.id, 'L', i, tk.L), ring: cleanPts(l.ring, 3) || [[0, 0], [60, 0], [60, 60], [0, 60]],
    anchor: isPt(l.anchor) ? [l.anchor[0], l.anchor[1]] : null,
    start: typeof l.start === 'number' && isFinite(l.start) ? l.start : 'existing',
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

  // daylight, limits, earthwork
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

  // view
  const v = s.view;
  v.site = v.site !== false;                       // the project site layer (roads, water, trees, neighbors); on unless switched off
  v.siteStyle = ['solid', 'glass', 'wireframe'].includes(v.siteStyle) ? v.siteStyle : 'solid';     // neighbor buildings in the site layer: solid, glass or wireframe
  if (!STYLES.includes(v.style)) v.style = 'model';
  v.contours.on = !!v.contours.on;
  v.contours.interval = v.contours.interval === 2 ? 2 : 1;
  v.contours.existing = !!v.contours.existing;
  v.contours.proposed = !!v.contours.proposed;
  if (!CONFIG.exaggerations.includes(v.exaggeration)) v.exaggeration = 1;
  const sec = cleanPts(v.section, 2);
  v.section = sec && sec.length === 2 ? sec : null;
  v.sun = { azimuth: clamp(num(v.sun && v.sun.azimuth, 135), 0, 360), altitude: clamp(num(v.sun && v.sun.altitude, 40), 3, 90) };
  v.shot = isObj(v.shot) ? v.shot : {};
  merge(v.shot, { title: true, date: true, metrics: true, mark: true });
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/** Saved options at an older schema step up here. Schema 1 is the first, so nothing changes yet. */
function migrateState(state /* , fromSchema */) { return state; }
