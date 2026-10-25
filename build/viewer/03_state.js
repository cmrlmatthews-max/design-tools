/* ==========================================================================
   STATE and MODEL
   State: what the person chose (layers, style, color mode, level cut, sun). It never holds the project.
   Model: the open project, read through ViewerScene (src/viewer/scene.js) into layers in the PROJECT frame.
   Nothing here writes the project. The document is only read.
   ========================================================================== */
const { LAYER_IDS, LAYER_LABELS, LAYER_TOOLS, TOOL_NAMES, DEFAULT_ON, layersFrom, levelsIndex, cutAt, sunSamples, colorKey, colorOf, PROGRAM_COLORS, UNIT_COLORS } = ViewerScene;
const BUILD_LAYERS = ['massing', 'units', 'cores', 'parking', 'facade', 'grading'];   // the layers that draw solids above the ground
const TOGGLE_LAYERS = ['site', 'massing', 'units', 'cores', 'parking', 'facade', 'grading'];

const State = (() => {
  const s = {
    layers: { ...DEFAULT_ON },
    mode: uiPrefs.mode === 'model' ? 'model' : 'diagram',        // Model: plain solids. Diagram: colors by the choice below.
    colorBy: ['program', 'unitType', 'source'].includes(uiPrefs.colorBy) ? uiPrefs.colorBy : 'program',
    siteStyle: ['solid', 'glass', 'wireframe'].includes(uiPrefs.siteStyle) ? uiPrefs.siteStyle : 'solid',
    shadows: uiPrefs.shadows !== false,
    cutKey: null,                                                 // the level key of the cut, or null for all levels
    sunDate: null, sunTime: null,
  };
  let version = 0;
  const subs = [];
  const notify = () => { version++; subs.slice().forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); };
  return {
    get: (k) => s[k],
    raw: () => s,
    set(k, v) { if (s[k] === v) return; s[k] = v; if (['mode', 'colorBy', 'siteStyle', 'shadows'].includes(k)) { uiPrefs[k] = v; saveUiPrefs(); } notify(); },
    setLayer(id, on) { if (s.layers[id] === !!on) return; s.layers = { ...s.layers, [id]: !!on }; notify(); },
    setSun(date, time) { s.sunDate = date; s.sunTime = time; notify(); },
    subscribe: (fn) => subs.push(fn),
    version: () => version,
    changed: notify,
  };
})();

const Model = (() => {
  let doc = null, source = null;                // source: 'saved' (opened from the project list) | 'file' (imported, in memory only) | null
  let all = null, levels = [], rows = [], stale = [], sun = { dates: [], byDate: {} }, notes = [];
  let cutCache = { key: null, z: null, layers: null };
  let shift = { x: 0, y: 0, z: 0 };
  let ver = 0;

  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const union = (list) => {
    const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, zMin: Infinity, zMax: -Infinity };
    let any = false;
    for (const b of list) {
      if (!b) continue;
      any = true;
      out.minX = Math.min(out.minX, b.minX); out.maxX = Math.max(out.maxX, b.maxX); out.minY = Math.min(out.minY, b.minY); out.maxY = Math.max(out.maxY, b.maxY);
      if (fin(b.zMin)) out.zMin = Math.min(out.zMin, b.zMin);
      if (fin(b.zMax)) out.zMax = Math.max(out.zMax, b.zMax);
    }
    return any ? out : null;
  };

  function load(next, src) {
    doc = next || null; source = doc ? (src || 'saved') : null;
    notes = [];
    cutCache = { key: null, z: null, layers: null };
    ver++;
    if (!doc) { all = null; levels = []; rows = []; stale = []; sun = { dates: [], byDate: {} }; shift = { x: 0, y: 0, z: 0 }; return; }
    all = layersFrom(doc, { onWarn: (m) => notes.push(m) });
    levels = levelsIndex(doc);
    rows = ViewerSummary.summary(doc);
    stale = ViewerSummary.staleFlags(doc);
    sun = sunSamples(doc);
    // The scene origin: the middle of the site (or of the model) at the lowest ground. Every drawn number is the project number minus this shift.
    const site = all.site.ok ? all.site.bounds : null;
    const build = union(BUILD_LAYERS.map((id) => (all[id].ok ? all[id].bounds : null)));
    const base = site || build || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let z = null;
    if (all.site.ok && all.site.ground) z = all.site.ground.zMin;
    else if (all.grading.ok && all.grading.ground) z = all.grading.ground.zMin;
    else if (build && fin(build.zMin)) z = build.zMin;
    shift = { x: Math.round((base.minX + base.maxX) / 2), y: Math.round((base.minY + base.maxY) / 2), z: fin(z) ? Math.round(z * 100) / 100 : 0 };
    // A choice for the sun that the new project does not have goes away.
    const st = State.raw();
    if (st.sunDate && !sun.byDate[st.sunDate]) st.sunDate = st.sunTime = null;
    st.cutKey = null;
  }

  const levelByKey = (key) => levels.find((l) => l.key === key) || null;
  /** The layers to draw: the whole project, or the project cut at the chosen level. */
  function layers() {
    if (!all) return null;
    const key = State.get('cutKey');
    const lv = key ? levelByKey(key) : null;
    if (!lv) return all;
    if (cutCache.key !== key || cutCache.layers === null || cutCache.ver !== ver) cutCache = { key, ver, layers: cutAt(all, lv.z) };
    return cutCache.layers;
  }
  /** The items of one layer that are on screen now (the layer is on and has data; the level cut is applied). */
  function shown(id) {
    const L = layers();
    if (!L || !State.get('layers')[id] || !L[id] || !L[id].ok) return [];
    return L[id].items;
  }
  const hasData = (id) => !!all && !!all[id] && !!all[id].ok;
  const row = (id) => rows.find((r) => r.id === id) || null;
  /** The numbers for the HUD. A missing section gives null, never zero. */
  function hud() {
    const v = (id) => { const r = row(id); return r ? r.text : null; };
    const units = row('plates.units') || row('massing.units');
    return {
      name: doc && typeof doc.name === 'string' && doc.name ? doc.name : 'Untitled',
      gfa: v('massing.gfa'), units: units ? units.text : null, stalls: v('parking.stalls'), efficiency: v('plates.efficiency'), far: v('massing.far'),
      warnings: stale.length,
    };
  }
  /** The bounds of what is drawn above the ground (the "building"), project frame. */
  function buildingBounds() {
    const L = layers();
    if (!L) return null;
    const b = union(BUILD_LAYERS.filter((id) => State.get('layers')[id] && L[id].ok && id !== 'grading').map((id) => L[id].bounds));
    return b || (L.grading.ok && State.get('layers').grading ? L.grading.bounds : null) || (L.site.ok ? L.site.bounds : null);
  }
  /** The site square (project frame), or null. */
  function siteBounds() {
    if (!all || !all.site.ok) return null;
    try {
      const sb = SiteLayerMod.siteBounds(ProjectMod.getSection(doc, 'site').derived);
      if (sb && sb.boundary && sb.boundary.length) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of sb.boundary) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
        if (Number.isFinite(minX + maxX + minY + maxY)) return { minX, maxX, minY, maxY };
      }
    } catch (e) { /* use the layer bounds */ }
    return all.site.bounds;
  }
  /** The level the cut is at, or null. */
  const cutLevel = () => (State.get('cutKey') ? levelByKey(State.get('cutKey')) : null);
  function itemById(id) {
    const L = layers();
    if (!L) return null;
    for (const lid of LAYER_IDS) for (const it of (L[lid] && L[lid].items) || []) if (it.id === id) return it;
    return null;
  }
  /** The "Edit in <tool>" link for a tool id, or null when the project is not in the saved list (an imported file stays in memory only). */
  function editLink(tool) {
    if (!doc || source !== 'saved' || !tool || !doc.id) return null;
    return CONFIG.toolPath(tool, doc.id);
  }
  const sunNow = () => {
    const st = State.raw();
    if (!st.sunDate || !st.sunTime) return null;
    return (sun.byDate[st.sunDate] || []).find((x) => x.time === st.sunTime) || null;
  };

  return {
    load, layers, shown, hasData, hud, buildingBounds, siteBounds, cutLevel, itemById, editLink, sunNow,
    doc: () => doc, source: () => source, all: () => all, levels: () => levels, rows: () => rows, stale: () => stale, sun: () => sun, notes: () => notes,
    shift: () => shift, version: () => ver, levelByKey, row,
  };
})();
