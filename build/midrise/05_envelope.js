/* ==========================================================================
   PIPELINE
   state -> assemble (bars, levels, unions, joints, courtyards, warnings)
         -> envelope marks (height limit) -> units -> parking -> metrics.
   One cached run per change. The envelope itself (allowed footprint, wireframe)
   is src/tower/envelope.js, used by assemble and here (Env).
   Also: bounds for framing, Diagram pieces (the bar that owns each part of a
   level), and the Derived cache that the renderer, the HUD and the exports read.
   ========================================================================== */

/** Model + site bounds in plan coordinates (framing views, shadow frustum). `height` includes the roof screen. */
function computeBounds(state, plates, solids, height) {
  const box = () => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const add = (b, x, y) => { b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); };
  const model = box(), site = box();
  for (const p of plates) for (const poly of p.polygons) for (const q of poly.outer) add(model, q[0], q[1]);
  for (const q of sitePolygon(state)) add(site, q[0], q[1]);
  // No site (Unlimited): the site box is the building box plus a margin, so framing, the figure and the sun grid still have an extent.
  if (!isFinite(site.minX) && isFinite(model.minX)) { const m = 30; Object.assign(site, { minX: model.minX - m, maxX: model.maxX + m, minY: model.minY - m, maxY: model.maxY + m }); }
  if (!isFinite(site.minX)) Object.assign(site, { minX: -50, maxX: 50, minY: -50, maxY: 50 });
  if (!isFinite(model.minX)) Object.assign(model, site);
  const union = {
    minX: Math.min(model.minX, site.minX), maxX: Math.max(model.maxX, site.maxX),
    minY: Math.min(model.minY, site.minY), maxY: Math.max(model.maxY, site.maxY),
  };
  const all = { ...union };                       // `all` also holds the context blocks; only the sun uses it so shadows reach the neighbors
  if (state.context && state.context.show) {
    for (const b of state.context.blocks || []) {
      const hw = num(b.w, 0) / 2, hd = num(b.d, 0) / 2;
      add(all, num(b.x, 0) - hw, num(b.y, 0) - hd); add(all, num(b.x, 0) + hw, num(b.y, 0) + hd);
    }
  }
  const h = Math.max(0, height || 0);
  return { model: { ...model, height: h }, site, union: { ...union, height: h }, all: { ...all, height: h } };
}

/* ---- Clipper helpers for the Diagram pieces (assemble owns the real unions) ---------- */
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
        if (Math.abs(BarsMod.ringArea(poly.outer)) > 1e-6) out.push(poly);
      } else visit(child);
    }
  };
  visit(tree);
  return out;
}
/** Union (type 'union') or difference ('diff') of two lists of { outer, holes }. Non-zero fill; outers counter-clockwise, holes clockwise. */
function clipPolys(subj, clip, op) {
  const L = globalThis.ClipperLib;
  const c = new L.Clipper();
  const add = (list, type) => {
    for (const p of list) {
      const outer = BarsMod.ringArea(p.outer) < 0 ? p.outer.slice().reverse() : p.outer;
      c.AddPath(clipPath(outer), type, true);
      for (const h of p.holes || []) c.AddPath(clipPath(BarsMod.ringArea(h) > 0 ? h.slice().reverse() : h), type, true);
    }
  };
  add(subj, L.PolyType.ptSubject);
  add(clip, L.PolyType.ptClip);
  const tree = new L.PolyTree();
  c.Execute(op === 'diff' ? L.ClipType.ctDifference : L.ClipType.ctUnion, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return treeToPolys(tree);
}
/**
 * For each bar level: the part of the plate that each bar owns. A bar owns its own rings minus the bars before it
 * in state.bars, so the corner zone is drawn one time. → Map(level index -> [{ barId, barIndex, program, polygons }])
 */
function computePieces(state, built) {
  const out = new Map();
  const cache = new Map();
  const barById = new Map(state.bars.map((b, i) => [b.id, { bar: b, i }]));
  const ringsOf = new Map();
  for (const lv of built.levels) {
    if (lv.zone !== 'bar' || !(lv.barIds || []).length) continue;
    const ids = state.bars.map((b) => b.id).filter((id) => lv.barIds.includes(id));
    const key = ids.join('|');
    if (!cache.has(key)) {
      let acc = [];
      const list = [];
      for (const id of ids) {
        const { bar, i } = barById.get(id);
        if (!ringsOf.has(id)) ringsOf.set(id, BarsMod.legsOf(bar).map((leg) => ({ outer: BarsMod.legRing(leg), holes: [] })));
        const own = clipPolys(ringsOf.get(id), [], 'union');
        const piece = acc.length ? clipPolys(own, acc, 'diff') : own;
        if (piece.length) list.push({ barId: id, barIndex: i, polygons: piece });
        acc = acc.length ? clipPolys(acc, own, 'union') : own;
      }
      cache.set(key, list);
    }
    out.set(lv.index, cache.get(key).map((p) => {
      const bl = BarsMod.barLevels(barById.get(p.barId).bar, state).find((l) => l.index === lv.index);
      return { ...p, program: bl ? bl.program : lv.program };
    }));
  }
  return out;
}

/* ---- Derived data: one cached run of the pipeline per change ---------------------------- */
const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
const mapWarning = (w) => ({ id: w.code || w.id, level: w.severity || w.level || 'warn', text: w.message || w.text, floors: w.floors || [] });
const sortWarnings = (list) => list.map((w, i) => [w, i]).sort((a, b) => ((SEVERITY_ORDER[a[0].level] ?? 1) - (SEVERITY_ORDER[b[0].level] ?? 1)) || (a[1] - b[1])).map((x) => x[0]);

/** Geometry for one state: assemble plus the height-limit marks. Never throws: a failure becomes one error warning. */
function computeGeometry(s, quality = 'full') {
  try {
    const built = AssembleMod.assemble(s, { quality });
    const limit = Math.max(0, num(s.site && s.site.heightLimit, 0));
    const plates = built.plates.map((p) => ({ ...p }));
    // assemble's envelope check measures footprint overlap only. A level whose top is above the height limit is outside too,
    // so the whole plate counts as outside (it turns red). The roof screen is outside when its top is above the limit.
    if (limit > 0) for (const p of plates) if (p.z + p.ftf > limit + 0.01 && p.area > 0) p.outsideEnvelopeArea = Math.max(p.outsideEnvelopeArea || 0, p.area);
    const solidsOutside = built.solids.map((sol) => limit > 0 && num(sol.z1, 0) > limit + 0.01);
    return { built, plates, solids: built.solids, solidsOutside, warnings: built.warnings.slice(), ok: true };
  } catch (e) {
    console.error(e);
    const built = { quality, levels: [], spineGraph: { nodes: [], edges: [] }, joints: [], courtyards: [], separation: [], plates: [], solids: [], warnings: [] };
    return { built, plates: [], solids: [], solidsOutside: [], warnings: [{ code: 'internal', severity: 'error', message: 'The geometry could not be built for these settings.', floors: [] }], ok: false };
  }
}
function safeWire(s, topZ) { try { return Env.envelopeWireframe(s, topZ); } catch (e) { console.error(e); return []; } }

/** Units, parking, metrics and the merged warning list for a built geometry. */
function computeNumbers(s, g) {
  const empty = { units: 0, unitsDetail: { total: 0, byBar: {}, byProgram: {} }, hasSite: s.site.shape !== 'none', siteArea: siteArea(s), siteAcres: siteArea(s) / 43560, density: 0, gfa: 0, far: 0, siteCoverage: 0, efficiency: 0,
    corridorLength: 0, corridorPerUnit: 0, parking: { required: 0, provided: 0, ratioProvided: 0, surplus: 0, deficit: false }, courtyards: { count: 0, area: 0, minDim: 0, items: [] },
    bars: { count: 0, longest: null }, height: 0, deckTop: 0, floors: 0, floorsDetail: { bar: 0, podium: 0, deck: 0 }, stairs: { exit: 0, exterior: 0, total: 0, byBar: {} }, elevators: 0,
    constructionHint: '', openSpace: { area: 0, ratio: 0, required: 0, ok: true }, target: { units: null, density: null }, warnings: [] };
  if (!g.ok) return { units: { total: 0, byBar: {}, byProgram: {}, warnings: [] }, balance: null, metrics: empty };
  try {
    const units = UnitsMod.unitsEstimate(s, g.built);
    const balance = ParkingMod.parkingBalance(s, units, g.built);
    const metrics = MetricsMod.computeMetrics(s, g.built, units, balance);
    return { units, balance, metrics };
  } catch (e) {
    console.error(e);
    g.warnings.push({ code: 'internal', severity: 'error', message: 'The numbers could not be worked out for these settings.', floors: [] });
    return { units: { total: 0, byBar: {}, byProgram: {}, warnings: [] }, balance: null, metrics: empty };
  }
}
function mergeWarnings(s, g, n) {
  const seen = new Set();
  const out = [];
  const add = (w) => {
    if (w.code === 'parking-deficit' && s.view.warnParking === false) return;
    const key = `${w.code}|${w.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(mapWarning(w));
  };
  g.warnings.forEach(add);
  (n.units.warnings || []).forEach(add);
  (n.metrics.warnings || []).forEach(add);
  return sortWarnings(out);
}

/** Everything the UI, the renderer, the exports and the compare view need for one state (no caching). */
function computeDerived(s) {
  const g = computeGeometry(s);
  const n = computeNumbers(s, g);
  const m = n.metrics;
  return {
    built: g.built, plates: g.plates, solids: g.solids, solidsOutside: g.solidsOutside, floors: g.built.levels,
    units: n.units, balance: n.balance, metrics: m, warnings: mergeWarnings(s, g, n),
    bounds: computeBounds(s, g.plates, g.solids, m.height), wire: safeWire(s, m.height),
  };
}

const Derived = (() => {
  let gKey = null, aKey = null, geomId = 0, counter = 0;
  let full = null, nums = null, cache = null, draftCache = null, piecesCache = null;
  // Geometry key: everything that changes the build or the numbers. The name, the view, the context, the targets and the placement only change drawing or the warning list.
  const geomKeyOf = (s) => JSON.stringify([s.site, s.floors, s.bars, s.courts, s.deck, s.podium, s.surface, s.programs, s.parking, s.rules, s.roof]);

  function get() {
    const s = Store.raw();
    const gk = geomKeyOf(s);
    if (gk !== gKey || !full) {
      gKey = gk; geomId++; full = computeGeometry(s); nums = computeNumbers(s, full); aKey = null; draftCache = null; piecesCache = null;
    }
    const ak = JSON.stringify([s.context, s.view.warnParking]);
    if (ak !== aKey || !cache) {
      aKey = ak;
      cache = {
        id: ++counter, geomId, built: full.built, plates: full.plates, solids: full.solids, solidsOutside: full.solidsOutside, floors: full.built.levels,
        units: nums.units, balance: nums.balance, metrics: nums.metrics, warnings: mergeWarnings(s, full, nums),
        bounds: computeBounds(s, full.plates, full.solids, nums.metrics.height), wire: safeWire(s, nums.metrics.height),
      };
    }
    return cache;
  }
  /** What to draw. While a geometry edit drags, the draft build is drawn: each leg is its own box, no union (plan section 6). */
  function display(draft) {
    const d = get();
    const s = Store.raw();
    const fullDisp = { key: `f${d.geomId}`, plates: d.plates, solids: d.solids, solidsOutside: d.solidsOutside, quality: 'full', get pieces() { return Derived.pieces(); } };
    if (!draft || !d.built.levels.length) return fullDisp;
    if (!draftCache || draftCache.geomId !== d.geomId) {
      const g = computeGeometry(s, 'draft');
      if (!g.ok) return fullDisp;
      const out = new Map(d.plates.map((p) => [p.n, p.outsideEnvelopeArea]));
      draftCache = {
        geomId: d.geomId, key: `d${d.geomId}`, quality: 'draft', pieces: null,
        plates: g.plates.map((p) => ({ ...p, outsideEnvelopeArea: out.get(p.n) || 0 })),
        solids: g.solids, solidsOutside: g.solids.map((_, i) => !!d.solidsOutside[i]),
      };
    }
    return draftCache;
  }
  /** The part of each level that each bar owns (Diagram style). Built when first asked, once per geometry. */
  function pieces() {
    const d = get();
    if (!piecesCache || piecesCache.geomId !== d.geomId) {
      let map = new Map();
      try { map = computePieces(Store.raw(), d.built); } catch (e) { console.error(e); }
      piecesCache = { geomId: d.geomId, map };
    }
    return piecesCache.map;
  }
  return { get, display, pieces };
})();
