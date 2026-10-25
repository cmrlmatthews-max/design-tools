/* ==========================================================================
   STATE
   The default state and fillDefaults (older, partial or imported states become complete).
   Schema: docs/plate-planner-technical-plan.md section 2. The default state and the presets come from
   src/plate/presets.js (PresetsMod). All lengths are feet, areas square feet.
   East = +x, north = +y. With a project the plate frame is the massing local frame.
   ========================================================================== */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const SOURCE_LABELS = { drawn: 'Drawn or typed plate', project: 'Open project' };
const MODES = ['multifamily', 'hotel'];
const MODE_LABELS = { multifamily: 'Multifamily', hotel: 'Hotel' };
const SHAPES = ['rect', 'L', 'U', 'O', 'circle', 'polygon'];
const SHAPE_LABELS = { rect: 'Rectangle', L: 'L', U: 'U', O: 'Courtyard (O)', circle: 'Circle', polygon: 'Drawn polygon' };
const CORE_MODES = ['auto', 'manual', 'none'];
const CORE_MODE_LABELS = { auto: 'Auto', manual: 'Manual', none: 'None' };
const CORRIDOR_KINDS = ['auto', 'bar', 'single', 'point'];
const CORRIDOR_LABELS = { auto: 'Automatic', bar: 'Bar', single: 'Single-loaded', point: 'Point (ring)' };
const SIDES = ['north', 'east', 'south', 'west'];
const STAIR_MODES = ['auto', 'seeds', 'manual'];
const SUPPORT_KINDS = ['trash', 'electrical', 'storage', 'linen', 'ice', 'data'];
const STYLES = ['model', 'diagram'];
/** The sizes a new support block takes (ft: along x, along y). */
const SUPPORT_SIZES = { trash: [8, 10], electrical: [6, 8], storage: [10, 10], linen: [8, 14], ice: [6, 8], data: [6, 8] };

/** The default design: "Double-loaded bar" (plan section 8.1). 17 units, NRSF 15,077.8 sf, efficiency 0.7732. */
function defaultState() { return PresetsMod.defaultState(); }

const isPt = (p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && isFinite(p[0]) && isFinite(p[1]);
const cleanPts = (arr, min) => {
  const pts = (Array.isArray(arr) ? arr : []).filter(isPt).map((p) => [p[0], p[1]]);
  return pts.length >= min ? pts : null;
};
const cleanRect = (r) => {
  if (!Array.isArray(r) || r.length < 4 || !r.slice(0, 4).every((v) => typeof v === 'number' && isFinite(v))) return null;
  const x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]), y0 = Math.min(r[1], r[3]), y1 = Math.max(r[1], r[3]);
  return x1 - x0 > 0.01 && y1 - y0 > 0.01 ? [x0, y0, x1, y1] : null;
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
  if (isObj(s.core)) s.core = CoreMod.normalizeCore(s.core);        // rework plan 4.2: a rect with no mode is manual, no rect and no mode is auto
  const base = defaultState();
  const merge = (t, d) => {
    for (const k of Object.keys(d)) {
      if (t[k] === undefined) t[k] = deepClone(d[k]);
      else if (isObj(d[k]) && isObj(t[k])) merge(t[k], d[k]);
    }
  };
  merge(s, base);
  if (!MODES.includes(s.mode)) s.mode = 'multifamily';
  if (!['drawn', 'project'].includes(s.source)) s.source = 'drawn';

  // the drawn plate
  const p = s.plate;
  if (!SHAPES.includes(p.shape)) p.shape = 'rect';
  p.w = clamp(num(p.w, 300), 10, CONFIG.limits.maxDim);
  p.d = clamp(num(p.d, 65), 10, CONFIG.limits.maxDim);
  p.arm = clamp(num(p.arm, 60), 10, CONFIG.limits.maxDim);
  p.courtW = clamp(num(p.courtW, 120), 10, CONFIG.limits.maxDim);
  p.courtD = clamp(num(p.courtD, 90), 10, CONFIG.limits.maxDim);
  p.segments = Math.round(clamp(num(p.segments, 64), 12, 180));
  p.points = cleanPts(p.points, 3) || [];
  if (p.shape === 'polygon' && p.points.length < 3) p.shape = 'rect';

  // levels (project source)
  const lv = s.levels;
  lv.showPodium = !!lv.showPodium;
  lv.selected = typeof lv.selected === 'string' && lv.selected ? lv.selected : null;
  if (!isObj(lv.groups)) lv.groups = {};
  for (const k of Object.keys(lv.groups)) {
    const g = isObj(lv.groups[k]) ? lv.groups[k] : {};
    lv.groups[k] = { filled: g.filled !== false, locks: cleanLocks(g.locks) };
    const gd = cleanDepth(g.maxDepth);
    if (gd !== null) lv.groups[k].maxDepth = gd;
  }

  // corridor
  const c = s.corridor;
  if (!CORRIDOR_KINDS.includes(c.kind)) c.kind = 'auto';
  c.width = c.width === null || c.width === undefined ? null : clamp(num(c.width, 5.67), 3, 20);
  c.wall = clamp(num(c.wall, 0.5), 0, 3);
  if (!SIDES.includes(c.side)) c.side = 'south';
  c.spine = Array.isArray(c.spine) && c.spine.length ? c.spine.filter((seg) => Array.isArray(seg) && seg.length >= 2 && isPt(seg[0]) && isPt(seg[1])).map((seg) => [[seg[0][0], seg[0][1]], [seg[1][0], seg[1][1]]]) : null;
  if (c.spine && !c.spine.length) c.spine = null;
  s.extWall = clamp(num(s.extWall, 1), 0, 6);

  // core, stairs, elevators, support
  s.core.rect = cleanRect(s.core.rect);
  if (!['auto', 'manual', 'none'].includes(s.core.mode)) s.core.mode = s.core.rect ? 'manual' : 'auto';
  if (s.core.mode === 'manual' && !s.core.rect) s.core.mode = 'auto';
  s.fill = { maxDepth: cleanDepth(isObj(s.fill) ? s.fill.maxDepth : null) };
  s.targetDepth = typeof s.targetDepth === 'number' && isFinite(s.targetDepth) && s.targetDepth > 0 ? clamp(s.targetDepth, 10, 100) : null;
  const st = s.stairs;
  if (!STAIR_MODES.includes(st.mode)) st.mode = 'auto';
  st.size = [clamp(num(st.size && st.size[0], 11), 4, 60), clamp(num(st.size && st.size[1], 22), 4, 80)];
  const tk = new Set();
  st.items = (Array.isArray(st.items) ? st.items : []).filter(isObj).slice(0, CONFIG.limits.maxStairs).map((it, i) => ({ id: cleanId(it.id, 'S', i, tk), rect: cleanRect(it.rect) })).filter((it) => it.rect);
  const el = s.elevators;
  el.count = el.count === null || el.count === undefined ? null : Math.round(clamp(num(el.count, 2), 0, 20));
  el.size = [clamp(num(el.size && el.size[0], 8), 3, 30), clamp(num(el.size && el.size[1], 10), 3, 30)];
  el.service = el.service === null || el.service === undefined ? null : Math.round(clamp(num(el.service, 0), 0, 4));
  const ts = new Set();
  s.support = (Array.isArray(s.support) ? s.support : []).filter(isObj).slice(0, CONFIG.limits.maxSupport).map((b, i) => ({
    id: cleanId(b.id, 'B', i, ts), kind: SUPPORT_KINDS.includes(b.kind) ? b.kind : 'storage', rect: cleanRect(b.rect),
  })).filter((b) => b.rect);
  s.hotelBoh = { on: s.hotelBoh.on !== false, place: 'core' };

  // mix: every type keeps what the user typed and takes the rest from the default of the same id
  for (const mode of MODES) {
    const defs = base.mix[mode];
    const list = Array.isArray(s.mix[mode]) && s.mix[mode].length ? s.mix[mode] : deepClone(defs);
    s.mix[mode] = list.filter(isObj).slice(0, 12).map((t, i) => {
      const d = defs.find((x) => x.id === t.id) || defs[Math.min(i, defs.length - 1)];
      const out = { ...deepClone(d), ...t };
      out.id = String(t.id || d.id);
      out.name = String(t.name || d.name).slice(0, 24);
      out.widthMin = clamp(num(out.widthMin, d.widthMin), 5, 120);
      out.widthMax = clamp(num(out.widthMax, d.widthMax), out.widthMin, 120);
      if (mode === 'multifamily') {
        out.targetArea = clamp(num(out.targetArea, d.targetArea), 100, 6000);
        out.areaMin = clamp(num(out.areaMin, d.areaMin), 50, out.targetArea);
        out.areaMax = clamp(num(out.areaMax, d.areaMax), out.targetArea, 8000);
      } else {
        out.target = clamp(num(out.target, d.target), out.widthMin, out.widthMax);
        out.bays = Math.round(clamp(num(out.bays, d.bays || 1), 1, 4));
      }
      out.share = clamp(num(out.share, d.share), 0, 1);
      out.color = /^#[0-9a-f]{6}$/i.test(out.color) ? out.color : d.color;
      return out;
    });
  }
  const mfIds = s.mix.multifamily.map((t) => t.id);
  if (!mfIds.includes(s.mix.cornerType)) s.mix.cornerType = mfIds.includes('2br') ? '2br' : mfIds[0];
  const aw = Array.isArray(s.mix.accessibleWidth) ? s.mix.accessibleWidth : [15, 16, 15.5];
  const lo = clamp(num(aw[0], 15), 8, 40), hi = clamp(num(aw[1], 16), lo, 40);
  s.mix.accessibleWidth = [lo, hi, clamp(num(aw[2], 15.5), lo, hi)];

  // accessible table (seeds for an editable table; see the Caution)
  const ac = s.accessible, am = ac.multifamily;
  am.typeAShare = clamp(num(am.typeAShare, 0.02), 0, 1);
  am.minUnits = Math.round(clamp(num(am.minUnits, 1), 0, 50));
  am.over = Math.round(clamp(num(am.over, 20), 0, 1000));
  ac.hotel = (Array.isArray(ac.hotel) ? ac.hotel : []).filter((r) => Array.isArray(r) && r.length >= 3 && r.slice(0, 3).every((v) => typeof v === 'number' && isFinite(v))).map((r) => [Math.round(r[0]), Math.round(r[1]), Math.round(r[2])]);
  if (!ac.hotel.length) ac.hotel = deepClone(base.accessible.hotel);
  ac.perFloor = ac.perFloor === null || ac.perFloor === undefined ? null : Math.round(clamp(num(ac.perFloor, 1), 0, 20));
  s.housekeepingReach = clamp(num(s.housekeepingReach, 150), 20, 1000);

  // locks and placement
  s.locks = cleanLocks(s.locks);
  s.placement = isObj(s.placement) ? { x: num(s.placement.x, 0), y: num(s.placement.y, 0), rotation: num(s.placement.rotation, 0), baseZ: num(s.placement.baseZ, 0) } : null;

  // view
  const v = s.view;
  v.site = v.site !== false;                       // the project site layer (ground, roads, water, trees, neighbors); on unless switched off
  v.siteStyle = ['solid', 'glass', 'wireframe'].includes(v.siteStyle) ? v.siteStyle : 'solid';     // neighbor buildings in the site layer: solid, glass or wireframe
  v.massing = v.massing !== false;                 // the project massing volume (every level as a solid, the active group highlighted); on unless switched off
  if (!STYLES.includes(v.style)) v.style = 'model';
  for (const k of ['labels', 'walls', 'bays', 'levels3d', 'context', 'grid', 'figure']) v[k] = !!v[k];
  v.snap = { on: v.snap && v.snap.on !== false, grid: clamp(num(v.snap && v.snap.grid, 0.5), 0.05, 10) };
  v.shot = isObj(v.shot) ? v.shot : {};
  merge(v.shot, { title: true, date: true, metrics: true, mark: true });
  s.schema = CONFIG.schema;
  s.name = String(s.name || 'Option A').slice(0, 60);
  return s;
}

/** A unit depth cap in ft (rework plan 5): a number from 10 to 100, else null (off). */
function cleanDepth(v) { return typeof v === 'number' && isFinite(v) && v > 0 ? clamp(v, 10, 100) : null; }

/** Locks: [{ id, outer: Ring, type }]. */
function cleanLocks(arr) {
  const taken = new Set();
  return (Array.isArray(arr) ? arr : []).filter(isObj).slice(0, CONFIG.limits.maxLocks).map((l, i) => {
    const outer = cleanPts(l.outer, 3);
    return outer && typeof l.type === 'string' ? { id: cleanId(l.id, 'U-', i, taken), outer, type: l.type } : null;
  }).filter(Boolean);
}

/** Saved options at an older schema step up here. Schema 1 is the first, so nothing changes yet. */
function migrateState(state /* , fromSchema */) { return state; }
