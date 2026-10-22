/* ==========================================================================
   SITE HELPERS
   The site polygon and area, the "Surround" context set, and small plan helpers.
   The zoning rules live in src/tower/envelope.js (Env); the building geometry
   lives in src/midrise/assemble.js (AssembleMod).
   ========================================================================== */
const siteRect = (w, d) => { const x = w / 2, y = d / 2; return [[-x, -y], [x, -y], [x, y], [-x, y]]; };
/** The site ring, or [] when the design has no site (site.shape === 'none', "Unlimited"). Every caller checks for the empty ring. */
function sitePolygon(state) {
  const s = state.site;
  if (s.shape === 'none') return [];
  if (s.shape === 'polygon' && Array.isArray(s.points) && s.points.length >= 3) return s.points.map((p) => [p[0], p[1]]);
  return siteRect(clamp(num(s.width, 0), 0, CONFIG.limits.maxDim * 4), clamp(num(s.depth, 0), 0, CONFIG.limits.maxDim * 4));
}
function siteArea(state) { const ring = sitePolygon(state); return ring.length ? Math.abs(BarsMod.ringArea(ring)) : 0; }
const designHasSite = (state) => !!state.site && state.site.shape !== 'none';

/** The ring the Surround set sits around: the site, or, with no site, the box of the bars as they stand. */
function surroundRing(state) {
  const ring = sitePolygon(state);
  if (ring.length || designHasSite(state)) return ring;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const bar of state.bars || []) {
    const bb = barBoxOf(bar);
    if (bb) { b.minX = Math.min(b.minX, bb.minX); b.maxX = Math.max(b.maxX, bb.maxX); b.minY = Math.min(b.minY, bb.minY); b.maxY = Math.max(b.maxY, bb.maxY); }
  }
  return isFinite(b.minX) ? [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] : [];
}

/** Surround set: one block on each side of the site, 20 ft off the boundary. */
function surroundBlocks(state) {
  const ring = surroundRing(state);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  if (!isFinite(minX)) return [];
  const gap = 20, depth = 80;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, W = maxX - minX, D = maxY - minY;
  const r = (v) => Math.round(v * 10) / 10;
  return [
    { x: r(cx), y: r(minY - gap - depth / 2), w: r(W), d: depth, h: 40 },    // front (south)
    { x: r(cx), y: r(maxY + gap + depth / 2), w: r(W), d: depth, h: 60 },    // back (north)
    { x: r(minX - gap - depth / 2), y: r(cy), w: depth, d: r(D), h: 30 },    // left (west)
    { x: r(maxX + gap + depth / 2), y: r(cy), w: depth, d: r(D), h: 50 },    // right (east)
  ];
}

/** Bounding box of a MultiPoly list, or null. */
function boxOfPolys(polys) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const p of polys || []) for (const q of p.outer) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
  return isFinite(b.minX) ? b : null;
}
/** Rectangle ring (counter-clockwise) from a center and a size. */
const rectRingAt = (x, y, w, d) => [[x - w / 2, y - d / 2], [x + w / 2, y - d / 2], [x + w / 2, y + d / 2], [x - w / 2, y + d / 2]];
/** Metric reader: the modules return a number or { total | value | ratio }. */
function mv(row, d = 0) {
  if (typeof row === 'number' && isFinite(row)) return row;
  if (row && typeof row === 'object') for (const k of ['total', 'value', 'ratio']) if (typeof row[k] === 'number' && isFinite(row[k])) return row[k];
  return d;
}

/** Centerline vertices of a bar: its start, the bend points and its end (plan feet). */
function barVertices(bar) {
  const legs = BarsMod.legsOf(bar);
  const pts = [[bar.x, bar.y]];
  for (const l of legs) {
    const a = (l.angle * Math.PI) / 180;
    const p = pts[pts.length - 1];
    pts.push([p[0] + l.length * Math.cos(a), p[1] + l.length * Math.sin(a)]);
  }
  return pts;
}
/** Plan box of a bar from the rings of its legs (rotation, bends and miters included), or null. */
function barBoxOf(bar) {
  try { return SnapTargetsMod.barBox({ bars: [bar] }, null, bar.id); } catch (e) { return null; }
}

/** A new bar for "Add bar": north of the existing bars, with the size of the last one. */
function newBarFor(state) {
  const bars = state.bars;
  const last = bars[bars.length - 1] || defaultBar('A');
  const id = nextBarId(bars);
  let maxY = -Infinity;
  for (const b of bars) { const bb = barBoxOf(b); if (bb) maxY = Math.max(maxY, bb.maxY); }
  const sep = num(state.site && state.site.separationMin, 20);
  const depth = last.depth;
  const bar = deepClone(last);
  Object.assign(bar, { id, name: `Bar ${id}`, angle: 0, bends: [], depth, y: isFinite(maxY) ? Math.round(maxY + Math.max(sep, 20) + depth / 2) : 0, x: last.x });
  if (Math.abs(last.angle) > 1e-6) bar.x = last.x;
  return bar;
}
/** A copy of a bar, moved one bar-depth plus the separation minimum to its left. */
function duplicateBarOf(state, bar) {
  const id = nextBarId(state.bars);
  const copy = deepClone(bar);
  const a = (num(bar.angle, 0) * Math.PI) / 180;
  const off = bar.depth + Math.max(num(state.site && state.site.separationMin, 20), 20);
  Object.assign(copy, { id, name: `Bar ${id}`, x: Math.round((bar.x - Math.sin(a) * off) * 1000) / 1000, y: Math.round((bar.y + Math.cos(a) * off) * 1000) / 1000 });
  return copy;
}
