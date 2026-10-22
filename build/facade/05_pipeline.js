/* ==========================================================================
   PIPELINE
   state (+ project) -> levels -> faces -> panels -> balconies -> metrics -> checks.
   One cached run per change. Every module is pure (src/facade/*); this file only calls them in order and normalizes what
   the page needs: the HUD numbers, the warnings, the per-group figures, the bounds for framing.
   buildFacade is the only function that reads the project. Never throws: a failure becomes one error warning and an empty facade.
   ========================================================================== */
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code || w.id, level: w.severity || w.level || 'warn', text: w.message || w.text || String(w.code || w.id || ''), ref: w.ref || null });
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => ((SEVERITY_ORDER[a[0].level] ?? 1) - (SEVERITY_ORDER[b[0].level] ?? 1)) || (a[1] - b[1])).map((x) => x[0]);

const emptyHud = () => ({
  wwr: 0, limit: 0.4, over: false, wall: 0, glazing: 0, worst: null, byOrientation: {}, transparency: null, target: null, targetMet: null,
  balconies: 0, balconyArea: 0, levels: 0, faces: 0, height: 0, exposure: null, projection: [], zones: {}, systems: {},
});

function emptyDerived(message) {
  const built = { source: 'standalone', rotation: 0, levels: [], groups: [], faces: [], balconies: [], fins: [], shades: [], street: { ids: [], source: 'auto' }, warnings: [] };
  return {
    ok: false, state: null, built, metrics: null, levels: [], groups: [], faces: [], groupInfo: {}, street: [], rotation: 0,
    warnings: [{ id: 'internal', level: 'error', text: message || 'The facade could not be built for these settings.', ref: null }],
    box: null, bounds: computeBoundsFor(built), hud: emptyHud(), matrix: new THREE.Matrix4(), geomId: 0,
  };
}

function computeBoundsFor(built) {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let height = 0;
  for (const lv of built.levels || []) {
    height = Math.max(height, (lv.z || 0) + (lv.ftf || 0));
    for (const poly of lv.plates || []) for (const q of poly.outer) {
      box.minX = Math.min(box.minX, q[0]); box.maxX = Math.max(box.maxX, q[0]); box.minY = Math.min(box.minY, q[1]); box.maxY = Math.max(box.maxY, q[1]);
    }
  }
  if (!isFinite(box.minX)) Object.assign(box, { minX: -50, maxX: 50, minY: -50, maxY: 50 });
  const h = Math.max(height + 9, 20);
  const b = { ...box, height: h };
  return { model: b, site: { ...box, height: h }, union: { ...box, height: h }, all: { ...box, height: h } };
}

/** The HUD figures, the per-orientation table and the per-group figures, computed from the built faces so they always add up. */
function summarize(s, built, metrics) {
  const wall = mv(metrics.wall), glazing = mv(metrics.glazing);
  const byO = {};
  for (const o of CONFIG.orientations) byO[o] = { wall: 0, glazing: 0, wwr: 0 };
  const groupInfo = {};
  const zones = {}, systems = {};
  for (const g of built.groups || []) groupInfo[g.id] = { wall: 0, glazing: 0, wwr: 0, balconies: 0, system: null, faces: 0 };
  for (const f of built.faces || []) {
    const w = mv(f.wall), gl = mv(f.glazing);
    const doors = (f.panels || []).filter((p) => p.kind === 'door').length;
    if (byO[f.orientation]) { byO[f.orientation].wall += w; byO[f.orientation].glazing += gl; }
    const gi = groupInfo[f.groupId];
    if (gi) { gi.wall += w; gi.glazing += gl; gi.balconies += doors; gi.faces++; gi.system = gi.system || (f.rule && f.rule.system) || 'punched'; }
    const z = zones[f.zone] = zones[f.zone] || { wall: 0, glazing: 0 };
    z.wall += w; z.glazing += gl;
    const sy = systems[(f.rule && f.rule.system) || 'punched'] = systems[(f.rule && f.rule.system) || 'punched'] || { wall: 0, glazing: 0 };
    sy.wall += w; sy.glazing += gl;
  }
  for (const o of CONFIG.orientations) byO[o].wwr = byO[o].wall > 0 ? byO[o].glazing / byO[o].wall : 0;
  for (const id of Object.keys(groupInfo)) groupInfo[id].wwr = groupInfo[id].wall > 0 ? groupInfo[id].glazing / groupInfo[id].wall : 0;
  for (const z of Object.values(zones)) z.wwr = z.wall > 0 ? z.glazing / z.wall : 0;
  for (const z of Object.values(systems)) z.wwr = z.wall > 0 ? z.glazing / z.wall : 0;
  let worst = null;
  for (const o of CONFIG.orientations) if (byO[o].wall > 0 && (!worst || byO[o].wwr > worst.wwr + 1e-12)) worst = { o, wwr: byO[o].wwr };
  const overall = isFinite(metrics.wwr) ? metrics.wwr : (wall > 0 ? glazing / wall : 0);
  const limit = num(s.checks.wwrLimit, 0.4);
  const tr = metrics.transparency == null ? null : (mv(metrics.transparency, NaN));
  const target = s.checks.transparencyTarget;
  const top = (built.levels || []).reduce((t, l) => Math.max(t, (l.z || 0) + (l.ftf || 0)), 0);
  return {
    wwr: overall, limit, over: overall > limit + 1e-9, wall, glazing, worst, byOrientation: byO,
    transparency: tr != null && isFinite(tr) ? tr : null, target, targetMet: target != null && tr != null && isFinite(tr) ? tr >= target - 1e-9 : null,
    balconies: mv(metrics.balconyCount), balconyArea: mv(metrics.balconyArea),
    levels: (built.levels || []).length, faces: (built.groups || []).length, height: top,
    exposure: metrics.exposure && typeof metrics.exposure === 'object' ? metrics.exposure : null,
    projection: Array.isArray(metrics.projectionFactors) ? metrics.projectionFactors : [],
    zones, systems, groupInfo,
  };
}

/** Everything the UI, the renderer, the exports and the compare view need for one state (no caching). */
function computeDerived(s, { project = null, quality = 'full' } = {}) {
  try {
    const built = PanelsMod.buildFacade(s, { project, quality });
    const metrics = FacMetricsMod.computeMetrics(s, built, project);
    const checks = FacMetricsMod.checks(s, metrics);
    const seen = new Set();
    const warnings = [];
    for (const w of [...(built.warnings || []), ...(checks || [])]) {
      const key = `${w.code || w.id}|${w.message || w.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push(mapWarning(w));
    }
    const hud = summarize(s, built, metrics);
    const streetIds = new Set((built.street && built.street.ids) || []);
    const box = boxOfRings((built.levels || []).flatMap((l) => (l.plates || []).map((p) => p.outer)));
    return {
      ok: true, state: s, built, metrics, levels: built.levels || [], groups: built.groups || [], faces: built.faces || [],
      groupInfo: hud.groupInfo, street: [...streetIds], rotation: num(built.rotation, 0),
      warnings: sortWarnings(warnings), box, bounds: computeBoundsFor(built), hud, matrix: new THREE.Matrix4(),
    };
  } catch (e) {
    console.error(e);
    return emptyDerived('The facade could not be built for these settings.');
  }
}

const Derived = (() => {
  let gKey = null, geomId = 0, counter = 0, cache = null;
  // Geometry key: everything that changes the build or the numbers. The name and the view only change drawing.
  const geomKeyOf = (s) => { const { view, name, ...rest } = s; return JSON.stringify(rest); };
  function get() {
    const s = Store.raw();
    const gk = geomKeyOf(s) + '|' + ProjectUI.dataKey();
    if (gk !== gKey || !cache) {
      gKey = gk; geomId++;
      cache = { id: ++counter, geomId, ...computeDerived(s, { project: ProjectUI.dataDoc() }) };
    }
    return cache;
  }
  /** What to draw. While a geometry edit drags the draft quality is drawn: no mullions or fins (plan section 6). */
  function display(draft) {
    const d = get();
    return { key: `${draft ? 'd' : 'f'}${d.geomId}`, quality: draft ? 'draft' : 'full' };
  }
  return { get, display };
})();
