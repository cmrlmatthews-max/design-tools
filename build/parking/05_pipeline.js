/* ==========================================================================
   PIPELINE
   state -> layout (bays, rows, stalls, cuts) -> ramps -> columns -> accessible group -> overlay -> metrics -> checks.
   One cached run per change. Every module is pure (src/parking/*); this file only calls them in order, merges the final
   stalls into the built levels (the exports and the project file read the final stalls), and normalizes what the page needs:
   the HUD numbers, the warnings, the cores with their issues, the bounds for framing, and the frame matrix.
   Never throws: a failure becomes one error warning and an empty deck.
   ========================================================================== */
const pt2 = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);

/** MultiPoly from whatever a module gave: [{ outer, holes }], one ring, or a list of rings. */
function asMulti(v) {
  if (!Array.isArray(v) || !v.length) return [];
  if (Array.isArray(v[0]) && typeof v[0][0] === 'number') return [{ outer: v, holes: [] }];
  if (Array.isArray(v[0]) && Array.isArray(v[0][0])) return v.map((r) => ({ outer: r, holes: [] }));
  return v.filter((p) => p && Array.isArray(p.outer)).map((p) => ({ outer: p.outer, holes: p.holes || [] }));
}

/** The matrix that puts geometry authored in the layout frame (through planToWorld) into the massing frame. */
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

/** Cores in the layout frame with a box each: from the layout result, else the state. */
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
/** id -> 'aisle' | 'outside' for the cores that sit in a drive aisle or outside the plate on any level. */
function coreIssuesOf(cores, levels) {
  const issues = {};
  for (const c of cores) {
    if (c.hasFlags) { if (c.inAisle) issues[c.id] = 'aisle'; else if (c.outside) issues[c.id] = 'outside'; continue; }     // the layout already decided
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

function emptyDerived(message) {
  const frame = { W: 0, D: 0, toLocal: (p) => p, toLayout: (p) => p };
  const built = { frame, levels: [], bays: [], strip: null, cores: [], warnings: [] };
  return {
    ok: false, state: null, raw: built, built, levels: [], ramps: [], columns: { lines: [], points: [], module: 0 }, clear: [], acc: { stalls: [], lost: 0, warnings: [] },
    overlay: { conflicts: [], suggestion: null, source: 'none', unitWidth: 0, tolerance: 2, checked: 0 }, demising: [], metrics: null, cores: [], coreIssues: {},
    warnings: [{ id: 'internal', level: 'error', text: message || 'The layout could not be built for these settings.', floors: [] }],
    box: null, bounds: computeBoundsFor(null, built, []), frame, matrix: new THREE.Matrix4(), solids: [], wire: [], hud: hudOf(null, []),
  };
}

function computeBoundsFor(state, built, levels) {
  const box = () => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const model = box();
  let height = 0;
  for (const lv of levels) {
    height = Math.max(height, (lv.z || 0) + (lv.ftf || 0));
    for (const poly of lv.plate || []) for (const q of poly.outer) {
      const p = pt2(built.frame.toLocal(q));
      model.minX = Math.min(model.minX, p[0]); model.maxX = Math.max(model.maxX, p[0]); model.minY = Math.min(model.minY, p[1]); model.maxY = Math.max(model.maxY, p[1]);
    }
  }
  if (!isFinite(model.minX)) Object.assign(model, { minX: -50, maxX: 50, minY: -50, maxY: 50 });
  const h = Math.max(height + 9, 20);
  const b = { ...model, height: h };
  return { model: b, site: { ...model, height: h }, union: { ...model, height: h }, all: { ...model, height: h } };
}

/** The numbers the HUD, the screenshot and the compare table read, with fallbacks computed from the built levels. */
function hudOf(metrics, levels) {
  const m = metrics || {};
  const stalls = isFinite(m.stalls) ? m.stalls : levels.reduce((t, l) => t + (l.stalls || []).length, 0);
  const gross = isFinite(m.grossArea) ? m.grossArea : levels.reduce((t, l) => t + multiArea(l.plate), 0);
  return {
    stalls, sfPerStall: isFinite(m.sfPerStall) ? m.sfPerStall : (stalls ? Math.round(gross / stalls * 10) / 10 : 0), levels: isFinite(m.levels) ? m.levels : levels.length,
    maxSlope: isFinite(m.maxRampSlope) ? m.maxRampSlope : 0, gross, efficiency: m.efficiency || 0,
    required: m.required ? m.required.total : 0, balance: isFinite(m.balance) ? m.balance : 0,
    accessible: m.accessible || { required: 0, provided: 0, van: 0, car: 0, lost: 0 }, ev: m.ev || { installed: 0, ready: 0, targetInstalled: 0, targetReady: 0 },
    bike: m.bike || { required: 0, areaSf: 0 }, lowestClear: m.lowestClear || 0, clearHeights: m.clearHeights || [], conflicts: m.conflicts || 0,
    byKind: m.byKind || {}, byLevel: m.byLevel || [], topOfDeck: m.topOfDeck || 0, columns: m.columns || { perLevel: 0, total: 0, module: 0, conflicts: 0, source: 'none', suggestion: null },
    rampSlopes: m.rampSlopes || [],
  };
}

/** Everything the UI, the renderer, the exports and the compare view need for one state (no caching). */
function computeDerived(s, { project = null, quality = 'full' } = {}) {
  try {
    const raw = LayoutMod.layout(s, { project, quality });
    const ramps = RampsMod.rampsFor(s, raw);
    const columns = GridMod.columnsFor(s, raw);
    const clear = GridMod.clearHeights(s);
    const acc0 = AccessibleMod.placeAccessible(s, raw);
    const acc = { ...acc0, stalls: AccessibleMod.tagEv(s, acc0.stalls) };      // plan 3.7: EV installed = kind "ev", EV ready = evReady
    const byLevel = new Map();
    for (const st of acc.stalls) { if (!byLevel.has(st.level)) byLevel.set(st.level, []); byLevel.get(st.level).push(st); }
    const levels = raw.levels.map((lv) => ({
      ...lv, plate: asMulti(lv.plate), aisles: asMulti(lv.aisles), turnZones: asMulti(lv.turnZones),
      stalls: (byLevel.get(lv.index) || []),
    }));
    const built = { ...raw, levels, ramps, columns };
    let demising = [], demisingInfo = null;
    try { demisingInfo = OverlayMod.demisingLines(project, raw.frame); demising = demisingInfo.xs || []; } catch (e) { demisingInfo = null; }
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
      ok: true, state: s, raw, built, levels, ramps, columns, clear, acc, overlay: ov, demising, demisingInfo, metrics, cores, coreIssues,
      warnings: sortWarnings(warnings), box, bounds: computeBoundsFor(s, built, levels), frame: raw.frame, matrix: frameMatrix(raw.frame),
      solids: [], wire: [], hud: hudOf(metrics, levels),
    };
  } catch (e) {
    console.error(e);
    return emptyDerived('The layout could not be built for these settings.');
  }
}

const Derived = (() => {
  let gKey = null, geomId = 0, counter = 0, cache = null;
  // Geometry key: everything that changes the build or the numbers. The name, the view and the placement only change drawing.
  const geomKeyOf = (s) => JSON.stringify([s.source, s.sourceLevel, s.footprint, s.levels, s.bays, s.grid, s.ramp, s.cores, s.coresFromProject, s.entries, s.liner, s.checks, s.accessible, s.ev, s.bike, s.required]);
  function get() {
    const s = Store.raw();
    const pk = ProjectUI.dataKey();
    const gk = geomKeyOf(s) + '|' + pk;
    if (gk !== gKey || !cache) {
      gKey = gk; geomId++;
      cache = { id: ++counter, geomId, ...computeDerived(s, { project: ProjectUI.dataDoc() }) };
    }
    return cache;
  }
  /** What to draw. While a geometry edit drags the draft quality is drawn: rows as strips, no columns (plan section 6). */
  function display(draft) {
    const d = get();
    return { key: `${draft ? 'd' : 'f'}${d.geomId}`, quality: draft ? 'draft' : 'full' };
  }
  return { get, display };
})();
