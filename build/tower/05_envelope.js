/* ==========================================================================
   ENVELOPE
   src/tower/envelope.js, inlined unchanged apart from the export keywords:
   allowed footprints (setbacks, stepback), the wireframe, and the check that
   marks plates and crowns that stick out. Warnings from geometry and from the
   envelope are merged below.
   ========================================================================== */
//@@MODULE envelope@@

/** Model + site bounds in plan coordinates (framing views, shadow frustum). `height` includes the crown. */
function computeBounds(state, plates, height) {
  const box = () => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const add = (b, x, y) => { b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); };
  const model = box(), site = box();
  for (const p of plates) {
    if (p.void) continue;
    for (const poly of p.polygons) for (const q of poly.outer) add(model, q[0], q[1]);
  }
  for (const q of sitePolygon(state)) add(site, q[0], q[1]);
  // No site (Unlimited): the site box is the building box plus a margin, so framing, the figure and the sun grid still have an extent.
  if (!isFinite(site.minX) && isFinite(model.minX)) { const m = 30; Object.assign(site, { minX: model.minX - m, maxX: model.maxX + m, minY: model.minY - m, maxY: model.maxY + m }); }
  if (!isFinite(site.minX)) Object.assign(site, { minX: -50, maxX: 50, minY: -50, maxY: 50 });
  if (!isFinite(model.minX)) Object.assign(model, site);
  const union = {
    minX: Math.min(model.minX, site.minX), maxX: Math.max(model.maxX, site.maxX),
    minY: Math.min(model.minY, site.minY), maxY: Math.max(model.maxY, site.maxY),
  };
  // `all` also holds the context blocks; only the sun uses it so shadows reach the neighbours.
  const all = { ...union };
  if (state.context && state.context.show) {
    for (const b of state.context.blocks || []) {
      const hw = num(b.w, 0) / 2, hd = num(b.d, 0) / 2;
      add(all, num(b.x, 0) - hw, num(b.y, 0) - hd); add(all, num(b.x, 0) + hw, num(b.y, 0) + hd);
    }
  }
  const h = Math.max(0, height || 0);
  return { model: { ...model, height: h }, site, union: { ...union, height: h }, all: { ...all, height: h } };
}

/* ---- Derived data: one cached run of the pipeline per geometry change ------- */
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code, level: w.severity, text: w.message, floors: w.floors || [] });
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => (SEVERITY_ORDER[a[0].level] - SEVERITY_ORDER[b[0].level]) || (a[1] - b[1])).map((x) => x[0]);

/** Geometry + envelope for one state. Full quality; metrics are added by the caller. */
function computeGeometry(s) {
  try {
    const g = Geo.buildPlates(s);
    const env = Env.checkEnvelope(s, g.plates, g.solids);
    // envelope.js measures footprint overlap only. A floor whose top is above the height limit is outside the
    // envelope too, so the whole plate counts as outside (it turns red) and the 'outside' map says so.
    const limit = Math.max(0, num(s.site && s.site.heightLimit, 0));
    if (limit > 0) {
      for (const p of env.plates) {
        if (p.z + p.ftf > limit + 0.01 && !p.void && p.area > 0) { p.outsideEnvelopeArea = Math.max(p.outsideEnvelopeArea, p.area); env.outside.set(p.n, p.outsideEnvelopeArea); }
      }
    }
    return {
      floors: g.floors, plates: env.plates, solids: g.solids, solidsOutside: env.solidsOutside,
      warnings: sortWarnings(g.warnings.concat(env.warnings).map(mapWarning)),
      outside: env.outside,
    };
  } catch (e) {
    console.error(e);
    return {
      floors: [], plates: [], solids: [], solidsOutside: [], outside: new Map(),
      warnings: [{ id: 'internal', level: 'error', text: 'The geometry could not be built for these settings.', floors: [] }],
    };
  }
}
/** Everything the UI, the renderer and the compare view need for one state (no caching). */
function computeDerived(s) {
  const full = computeGeometry(s);
  const metrics = Geo.computeMetrics(s, full.plates);
  return { ...full, metrics, bounds: computeBounds(s, full.plates, metrics.totalHeight), wire: safeWire(s, metrics.totalHeight) };
}
function safeWire(s, topZ) { try { return Env.envelopeWireframe(s, topZ); } catch (e) { console.error(e); return []; } }

function hasCurves(s) {
  const curved = (sh) => !!sh && (sh.type === 'circle' || sh.type === 'ellipse' || ((sh.type === 'rect' || sh.type === 'square' || !sh.type) && num(sh.radius, 0) > 0));
  return (s.podium.on && curved(s.podium.shape)) || s.segments.some((g) => curved(g.shape));
}

const Derived = (() => {
  let gKey = null, aKey = null, geomId = 0, counter = 0;
  let full = null, cache = null, draftCache = null;
  // Geometry key: everything that changes plates. Programs, targets and context only change metrics or drawing.
  const geomKeyOf = (s) => JSON.stringify([s.site, s.podium, s.segments, s.setbacks, s.mechanical, s.carves, s.cuts, s.crown]);

  function get() {
    const s = Store.raw();
    const gk = geomKeyOf(s);
    if (gk !== gKey || !full) { gKey = gk; geomId++; full = computeGeometry(s); aKey = null; draftCache = null; }
    const ak = JSON.stringify([s.programs, s.targets, s.context]);
    if (ak !== aKey || !cache) {
      aKey = ak;
      const metrics = Geo.computeMetrics(s, full.plates);        // metrics always come from the full build
      cache = { id: ++counter, geomId, ...full, metrics, bounds: computeBounds(s, full.plates, metrics.totalHeight), wire: safeWire(s, metrics.totalHeight) };
    }
    return cache;
  }
  /** What to draw. While a slider drags and the model has curves, a coarser (draft) build is drawn (plan 7.5). */
  function display(draft) {
    const d = get();
    const s = Store.raw();
    if (!draft || !hasCurves(s)) return { key: `f${d.geomId}`, plates: d.plates, solids: d.solids, solidsOutside: d.solidsOutside, quality: 'full' };
    if (!draftCache || draftCache.geomId !== d.geomId) {
      let g;
      try { g = Geo.buildPlates(s, { quality: 'draft' }); } catch (e) { return { key: `f${d.geomId}`, plates: d.plates, solids: d.solids, solidsOutside: d.solidsOutside, quality: 'full' }; }
      const out = new Map(d.plates.map((p) => [p.n, p.outsideEnvelopeArea]));
      draftCache = {
        geomId: d.geomId, key: `d${d.geomId}`, quality: 'draft',
        plates: g.plates.map((p) => ({ ...p, outsideEnvelopeArea: out.get(p.n) || 0 })),
        solids: g.solids, solidsOutside: g.solids.map((_, i) => !!d.solidsOutside[i]),
      };
    }
    return draftCache;
  }
  return { get, display };
})();
