/* ==========================================================================
   GEOMETRY HELPERS
   Small plan helpers shared by the pipeline, the renderer, the drawing tools and the section view.
   Rings are [[x, y], ...] in the project frame, in feet.
   ========================================================================== */
const ringArea = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const rnd = (v, k = 1000) => Math.round(v * k) / k;

/** Bounding box of a ring list, or null. */
function boxOfRings(rings) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const r of rings || []) for (const q of r) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
  return isFinite(b.minX) ? b : null;
}
const growBox = (b, g) => (b ? { minX: b.minX - g, maxX: b.maxX + g, minY: b.minY - g, maxY: b.maxY + g } : null);
const unionBox = (a, b) => (!a ? b : !b ? a : { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) });
const boxHit = (a, b) => !!a && !!b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

const isPtXY = (p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]);
/** Rings from a ring, a polygon { outer, holes }, or a list of either. */
function ringsOf(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    if (v.length && isPtXY(v[0])) return v.length >= 3 ? [v] : [];
    return v.flatMap((x) => ringsOf(x));
  }
  if (v.outer) return [v.outer, ...(v.holes || [])].filter((r) => Array.isArray(r) && r.length >= 3);
  return [];
}
/** Outer rings only (a polygon's holes dropped). */
function outerRingsOf(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    if (v.length && isPtXY(v[0])) return v.length >= 3 ? [v] : [];
    return v.flatMap((x) => outerRingsOf(x));
  }
  return v.outer && v.outer.length >= 3 ? [v.outer] : [];
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const xa = ring[a][0], ya = ring[a][1], xb = ring[b][0], yb = ring[b][1];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}
/** Nearest point on segment a-b to p: { x, y, t, d }. */
function nearestOnSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L2, 0, 1) : 0;
  const x = a[0] + dx * t, y = a[1] + dy * t;
  return { x, y, t, d: Math.hypot(px - x, py - y) };
}
/** Segment crossing: the point where a-b meets c-d, or null. */
function segCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a[0] + r[0] * t, y: a[1] + r[1] * t, t, u };
}
const polyLength = (line) => { let L = 0; for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return L; };
/** Offsets a polyline to one side (positive = left of travel) with mitered joins. */
function offsetLine(line, off) {
  const n = line.length, out = [];
  if (n < 2) return out;
  const nor = (i) => { const a = line[i], b = line[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]; };
  for (let i = 0; i < n; i++) {
    let nx, ny;
    if (i === 0) [nx, ny] = nor(0);
    else if (i === n - 1) [nx, ny] = nor(n - 2);
    else {
      const p = nor(i - 1), q = nor(i);
      const dot = p[0] * q[0] + p[1] * q[1];
      const k = 1 / Math.max(0.35, 1 + dot);          // miter: (p + q) / (1 + p.q), limited at sharp turns
      nx = (p[0] + q[0]) * k; ny = (p[1] + q[1]) * k;
    }
    out.push([line[i][0] + nx * off, line[i][1] + ny * off]);
  }
  return out;
}
/** Angle of a direction in degrees from north, clockwise (the sun and downhill convention). */
const bearingOf = (dx, dy) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compassOf = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
const mv = (row, d = 0) => (typeof row === 'number' && isFinite(row) ? row : d);
