/* ==========================================================================
   PIPELINE
   state (+ project) -> buildGrading (existing ground, pads, drives, lots, walls, the surface) -> metrics -> checks.
   One cached run per change. Every module is pure (src/grading/*); this file only calls them in order and normalizes what the
   page needs: the HUD numbers, the warnings, the proposed grid, the bounds for framing and the 2x refinement block (plan 3.10).
   buildGrading is the only function that reads the project. Never throws: a failure becomes one error warning and an empty result.
   While a handle or a slider moves the build runs at draft quality: k = 1 earthwork and no refinement (plan section 6).
   ========================================================================== */
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code || w.id, level: w.severity || w.level || 'warn', text: w.message || w.text || String(w.code || w.id || ''), where: w.where || null });
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => ((SEVERITY_ORDER[a[0].level] ?? 1) - (SEVERITY_ORDER[b[0].level] ?? 1)) || (a[1] - b[1])).map((x) => x[0]);
const round10 = (v) => { const r = Math.round(v / 10) * 10; return r === 0 ? 0 : r; };

const emptyHud = () => ({
  cut: 0, fill: 0, net: 0, cutCy: 0, fillCy: 0, netCy: 0, bulkedNetCy: 0, balance: 1, wallMax: 0, wallAvg: 0, wallLength: 0, wallCount: 0,
  padArea: 0, disturbed: 0, steepestRoute: 0, tiers: [], steps: [], routes: [], walls: [], tierCount: 0, subdivide: 4, quality: 'full',
});

function emptyDerived(message) {
  const grid = { spacing: 10, n: 2, x0: -10, y0: -10, nodes: new Float64Array(12), z: new Float64Array(4), min: 0, max: 0, at: () => 0 };
  const built = { source: 'standalone', ground: 'plane', grid, existingAt: () => 0, surface: { at: () => 0, conflicts: [] }, buildings: [], tiers: [], features: [], walls: [], conflicts: [], warnings: [], notes: [], property: [], quality: 'full' };
  return {
    ok: false, state: null, built, metrics: null, warnings: [{ id: 'internal', level: 'error', text: message || 'The grading could not be built for these settings.', where: null }],
    box: null, bounds: computeBounds(built, 0, 1), hud: emptyHud(), proposedZ: new Float64Array(4), zBase: 0, zMax: 1, refine: null, fine: null, notes: [],
  };
}

const boxOfFeatures = (built) => {
  let b = null;
  const add = (x0, y0, x1, y1) => { b = !b ? { minX: x0, maxX: x1, minY: y0, maxY: y1 } : { minX: Math.min(b.minX, x0), maxX: Math.max(b.maxX, x1), minY: Math.min(b.minY, y0), maxY: Math.max(b.maxY, y1) }; };
  for (const f of built.features || []) if (f.box && isFinite(f.box[0]) && f.box[2] >= f.box[0]) add(f.box[0], f.box[1], f.box[2], f.box[3]);
  for (const w of built.walls || []) for (const p of w.line || []) add(p[0], p[1], p[0], p[1]);
  return b;
};

/** Plan boxes for framing and the sun: model (the work), union (the work and a margin), site (the grid). Heights are above zBase. */
function computeBounds(built, zBase, exag) {
  const g = built.grid, L = (g.n - 1) * g.spacing;
  const site = { minX: g.x0, maxX: g.x0 + L, minY: g.y0, maxY: g.y0 + L };
  const work = boxOfFeatures(built) || { minX: g.x0 + L * 0.3, maxX: g.x0 + L * 0.7, minY: g.y0 + L * 0.3, maxY: g.y0 + L * 0.7 };
  const pad = Math.max(80, Math.min(160, 0.35 * Math.max(work.maxX - work.minX, work.maxY - work.minY)));
  const union = {
    minX: Math.max(site.minX, work.minX - pad), maxX: Math.min(site.maxX, work.maxX + pad),
    minY: Math.max(site.minY, work.minY - pad), maxY: Math.min(site.maxY, work.maxY + pad),
  };
  const relief = Math.max(1, (g.max - zBase)) * exag + CONFIG.buildingHeight + 6;
  const mk = (b) => ({ ...b, height: relief });
  return { model: mk(work), site: mk(site), union: mk(union), all: mk(site) };
}

/** The block of coarse cells that gets the 2x refinement: the work grown by 20 ft, made square, kept inside the grid. null in draft quality. */
function refineBlock(built) {
  if (built.quality === 'draft') return null;
  const g = built.grid, work = boxOfFeatures(built);
  if (!work || g.n < 3) return null;
  const sp = g.spacing, n = g.n;
  const grow = 20;
  const ci0 = Math.floor((work.minX - grow - g.x0) / sp), ci1 = Math.ceil((work.maxX + grow - g.x0) / sp);
  const cj0 = Math.floor((work.minY - grow - g.y0) / sp), cj1 = Math.ceil((work.maxY + grow - g.y0) / sp);
  let m = Math.max(ci1 - ci0, cj1 - cj0, 2);
  m = Math.min(m, n - 1);
  const mid = (a, b) => (a + b) / 2;
  const i0 = clamp(Math.round(mid(ci0, ci1) - m / 2), 0, n - 1 - m), j0 = clamp(Math.round(mid(cj0, cj1) - m / 2), 0, n - 1 - m);
  if (m * m > 120 * 120) return null;                      // a very large block would cost more than it shows
  return { i0, j0, m };
}

/** The half-spacing grid over the block: { spacing, n, x0, y0, z }. Border midpoints take the average of their coarse neighbors, so the two meshes meet without a crack. */
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

/** The HUD figures, from the metrics so they always add up. Volumes round to 10 cy on the HUD (concept risk 1); the panel shows 0.1 cy. */
function summarize(s, built, metrics) {
  const cutCy = mv(metrics.cutCy), fillCy = mv(metrics.fillCy), netCy = mv(metrics.netCy);
  const walls = metrics.walls && Array.isArray(metrics.walls.list) ? metrics.walls.list : [];
  return {
    cut: round10(cutCy), fill: round10(fillCy), net: round10(netCy), cutCy, fillCy, netCy, bulkedNetCy: mv(metrics.bulkedNetCy), balance: mv(metrics.balance, 1),
    wallMax: mv(metrics.wallHeightMax), wallAvg: mv(metrics.wallHeightAvg), wallLength: mv(metrics.wallLength), wallCount: walls.length,
    padArea: mv(metrics.padArea), disturbed: mv(metrics.disturbedArea), steepestRoute: mv(metrics.steepestRoute),
    tiers: Array.isArray(metrics.tiers) ? metrics.tiers : [], steps: Array.isArray(metrics.steps) ? metrics.steps : [],
    routes: Array.isArray(metrics.routes) ? metrics.routes : [], walls,
    tierCount: (built.tiers || []).length, subdivide: mv(metrics.subdivide, 4), quality: built.quality || 'full', cellsSampled: mv(metrics.cellsSampled),
  };
}

/** Everything the UI, the renderer, the exports and the compare view need for one state (no caching). */
function computeDerived(s, { project = null, quality = 'full' } = {}) {
  try {
    const built = FeaturesMod.buildGrading(s, { project, quality });
    const metrics = GradMetricsMod.computeMetrics(s, built);
    // metrics.warnings IS the checks() list (it already carries the build warnings); show only that list, never built.warnings on top.
    const checks = Array.isArray(metrics.warnings) ? metrics.warnings : GradMetricsMod.checks(s, metrics);
    const warnings = (checks || []).map(mapWarning);
    const proposedZ = EarthMod.proposedGrid(built);
    let zLo = Infinity, zHi = -Infinity;
    for (let k = 0; k < proposedZ.length; k++) { if (proposedZ[k] < zLo) zLo = proposedZ[k]; if (proposedZ[k] > zHi) zHi = proposedZ[k]; }
    zLo = Math.min(zLo, built.grid.min); zHi = Math.max(zHi, built.grid.max);
    for (const t of built.tiers || []) { if (isFinite(t.ffe)) zHi = Math.max(zHi, t.ffe + CONFIG.buildingHeight); }
    const zBase = Math.floor(zLo) - 4;
    const exag = s.view && s.view.exaggeration ? s.view.exaggeration : 1;
    const hud = summarize(s, built, metrics);
    const refine = refineBlock(built);
    const box = boxOfFeatures(built);
    return {
      ok: true, state: s, built, metrics, warnings: sortWarnings(warnings), box, bounds: computeBounds(built, zBase, exag), hud,
      proposedZ, zBase, zMin: zLo, zMax: zHi, refine, fine: fineGridOf(built, refine), notes: built.notes || [], quality: built.quality,
    };
  } catch (e) {
    console.error(e);
    return emptyDerived('The grading could not be built for these settings.');
  }
}

const Derived = (() => {
  let gKey = null, geomId = 0, counter = 0, cache = null;
  // Geometry key: everything that changes the build or the numbers. The name and the view only change drawing.
  const geomKeyOf = (s) => { const { view, name, ...rest } = s; return JSON.stringify(rest); };
  const qualityNow = () => (Store.gestureActive() && !Store.gesturePath().startsWith('view') ? 'draft' : 'full');
  function get() {
    const s = Store.raw();
    const q = qualityNow();
    const gk = `${geomKeyOf(s)}|${s.view.exaggeration}|${ProjectUI.dataKey()}|${q}`;
    if (gk !== gKey || !cache) {
      gKey = gk; geomId++;
      cache = { id: ++counter, geomId, ...computeDerived(s, { project: ProjectUI.dataDoc(), quality: q }) };
    }
    return cache;
  }
  /** What to draw: the draft or the full build. */
  function display() {
    const d = get();
    return { key: `${d.geomId}`, quality: d.quality === 'draft' ? 'draft' : 'full' };
  }
  return { get, display };
})();
