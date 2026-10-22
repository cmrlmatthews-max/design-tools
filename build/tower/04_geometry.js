/* ==========================================================================
   GEOMETRY  (also holds METRICS: Geo.computeMetrics)
   src/tower/geometry.js, inlined unchanged apart from the export keywords.
   Pure functions: floor list, shapes, transforms, carves, cuts, crown, core,
   plates, metrics. Nothing in it touches the DOM, the store or Three.js.
   Needs the Clipper classic script (globalThis.ClipperLib).
   ========================================================================== */
//@@MODULE geometry@@

/* ---- site helpers the shell keeps (the zoning rules live in ENVELOPE) -------- */
const siteRect = (w, d) => { const x = w / 2, y = d / 2; return [[-x, -y], [x, -y], [x, y], [-x, y]]; };
/** The site ring, or [] when the design has no site (site.shape === 'none', "Unlimited"). Every caller checks for the empty ring. */
function sitePolygon(state) {
  const s = state.site;
  if (s.shape === 'none') return [];
  if (s.shape === 'polygon' && Array.isArray(s.points) && s.points.length >= 3) return s.points.map((p) => [p[0], p[1]]);
  return siteRect(clamp(num(s.width, 0), 0, CONFIG.limits.maxDim), clamp(num(s.depth, 0), 0, CONFIG.limits.maxDim));
}
function siteArea(state) { const ring = sitePolygon(state); return ring.length ? Math.abs(Geo.ringArea(ring)) : 0; }
const designHasSite = (state) => !!state.site && state.site.shape !== 'none';

/** The ring the Surround set sits around: the site, or, with no site, the box of the building as it stands (a draft build). */
function surroundRing(state) {
  const ring = sitePolygon(state);
  if (ring.length || designHasSite(state)) return ring;
  try {
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const p of Geo.buildPlates(state, { quality: 'draft' }).plates) {
      if (p.void) continue;
      for (const poly of p.polygons) for (const q of poly.outer) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
    }
    return isFinite(b.minX) ? [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] : [];
  } catch (e) { return []; }
}

/** Surround set (plan 7.4): one block on each side of the site, 20 ft off the boundary. */
function surroundBlocks(state) {
  const ring = surroundRing(state);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  if (!isFinite(minX)) return [];
  const gap = 20, depth = 80;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, W = maxX - minX, D = maxY - minY;
  const r = (v) => Math.round(v * 10) / 10;
  return [
    { x: r(cx), y: r(minY - gap - depth / 2), w: r(W), d: depth, h: 60 },    // front (south)
    { x: r(cx), y: r(maxY + gap + depth / 2), w: r(W), d: depth, h: 90 },    // back (north)
    { x: r(minX - gap - depth / 2), y: r(cy), w: depth, d: r(D), h: 45 },    // left (west)
    { x: r(maxX + gap + depth / 2), y: r(cy), w: depth, d: r(D), h: 75 },    // right (east)
  ];
}
