/* ==========================================================================
   GEOMETRY HELPERS
   Small plan helpers shared by the pipeline, the renderer and the selection code.
   Rings are [[x, y], ...] in the massing (local) frame, in feet. Faces keep their own end points a, b in that frame.
   ========================================================================== */
const ringArea = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const multiArea = (mp) => (mp || []).reduce((t, pc) => t + Math.abs(ringArea(pc.outer)) - (pc.holes || []).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
const rnd = (v, k = 1000) => Math.round(v * k) / k;

/** Bounding box of a ring list, or null. */
function boxOfRings(rings) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const r of rings || []) for (const q of r) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
  return isFinite(b.minX) ? b : null;
}
/** A number from a module row: a number, or an object with .value / .total / .ratio / .area. */
function mv(row, d = 0) {
  if (typeof row === 'number' && isFinite(row)) return row;
  if (row && typeof row === 'object') for (const k of ['value', 'total', 'ratio', 'area', 'count']) if (typeof row[k] === 'number' && isFinite(row[k])) return row[k];
  return d;
}
const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
