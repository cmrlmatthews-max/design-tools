/* ==========================================================================
   contours.js — marching squares on the ground grid (Grading Sketch)

   Contract: docs/grading-sketch-technical-plan.md sections 3.10 and 4.
   Pure: no DOM, no mutation of inputs.

   Works on any square grid { spacing, n, x0, y0 } with values row-major from
   the south (values[j * n + i] sits at (x0 + i spacing, y0 + j spacing)).
   The 2x refinement near features (plan 3.10) is the caller's job: pass a
   half-spacing grid of proposedAt values and this runs the same way.

   Rule choices where the plan leaves room:
   - A node whose value equals the level counts as above it, so a contour
     that runs exactly through a row of nodes is one straight line.
   - A saddle cell connects its two high corners when the cell average is at
     or above the level.
   - Segments join into polylines by shared end points (0.001 ft). A closed
     contour repeats its first point at the end. Open polylines run in the
     direction the segments were found; no orientation is promised.
   - Levels are whole multiples of the interval. A level is major when
     round(z / interval) is a multiple of majorEvery. Output runs by level,
     lowest first.
   - zeroLine snaps |value| under 1e-6 to 0 first, so floating-point noise
     where proposed equals existing does not draw wandering lines.
   ========================================================================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const q3 = (v) => Math.round(v * 1000) / 1000 + 0;

const MAX_LEVELS = 5000;

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

function needGrid(grid, values, fn) {
  need(grid && isNum(grid.spacing) && grid.spacing > 0 && Number.isInteger(grid.n) && grid.n >= 2 && isNum(grid.x0) && isNum(grid.y0), fn, "grid");
  need(values && values.length >= grid.n * grid.n, fn, "values (n * n elevations)");
}

/* Corner order: 0 SW, 1 SE, 2 NE, 3 NW. Edge order: 0 south, 1 east, 2 north, 3 west.
   Edge e joins corners e and (e + 1) % 4. */
const CASES = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], null, [[0, 2]], [[3, 2]],
  [[3, 2]], [[0, 2]], null, [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], [],
];

/** All segments of one level: [[x1, y1], [x2, y2]] with rounded ends. */
function segmentsAt(grid, v, level) {
  const { spacing: d, n, x0, y0 } = grid;
  const segs = [];
  const m = n - 1;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const a = j * n + i;
      const z0 = v[a], z1 = v[a + 1], z2 = v[a + n + 1], z3 = v[a + n];
      const mask = (z0 >= level ? 1 : 0) | (z1 >= level ? 2 : 0) | (z2 >= level ? 4 : 0) | (z3 >= level ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      const xs = x0 + i * d, ys = y0 + j * d;
      const zs = [z0, z1, z2, z3];
      const cx = [xs, xs + d, xs + d, xs], cy = [ys, ys, ys + d, ys + d];
      const cross = (e) => {
        const p = e, r = (e + 1) % 4;
        const t = (level - zs[p]) / (zs[r] - zs[p]);
        return [q3(cx[p] + (cx[r] - cx[p]) * t), q3(cy[p] + (cy[r] - cy[p]) * t)];
      };
      let pairs = CASES[mask];
      if (pairs === null) {
        const high = (z0 + z1 + z2 + z3) / 4 >= level;
        if (mask === 5) pairs = high ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]];
        else pairs = high ? [[0, 3], [1, 2]] : [[0, 1], [3, 2]];
      }
      for (const [e1, e2] of pairs) {
        const p = cross(e1), r = cross(e2);
        if (p[0] === r[0] && p[1] === r[1]) continue;
        segs.push([p, r]);
      }
    }
  }
  return segs;
}

const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

/** Joins segments into polylines by shared end points. */
function join(segs) {
  const ends = new Map();
  const add = (k, idx) => { const l = ends.get(k); if (l) l.push(idx); else ends.set(k, [idx]); };
  segs.forEach((s, idx) => { add(key(s[0]), idx); add(key(s[1]), idx); });
  const used = new Uint8Array(segs.length);
  const lines = [];

  const next = (k) => {
    const l = ends.get(k);
    if (!l) return -1;
    for (const idx of l) if (!used[idx]) return idx;
    return -1;
  };

  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const line = [segs[s][0], segs[s][1]];
    // grow at the tail, then at the head
    for (let side = 0; side < 2; side++) {
      for (;;) {
        const tip = side === 0 ? line[line.length - 1] : line[0];
        const idx = next(key(tip));
        if (idx < 0) break;
        used[idx] = 1;
        const [p, r] = segs[idx];
        const far = key(p) === key(tip) ? r : p;
        if (side === 0) line.push(far); else line.unshift(far);
        if (key(far) === key(side === 0 ? line[0] : line[line.length - 1])) break;   // closed
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Plan 3.10. grid: { spacing, n, x0, y0 }; zValues: n * n elevations; interval: ft (> 0).
    → [{ z, major, line: [[x, y], ...] }], lowest level first. */
export function contours(grid, zValues, interval, { majorEvery = 5 } = {}) {
  needGrid(grid, zValues, "contours");
  need(isNum(interval) && interval > 0, "contours", "interval");
  const nn = grid.n * grid.n;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < nn; i++) { const z = zValues[i]; if (z < lo) lo = z; if (z > hi) hi = z; }
  if (!(hi > lo)) return [];
  const first = Math.ceil(lo / interval - 1e-9), last = Math.floor(hi / interval + 1e-9);
  need(last - first < MAX_LEVELS, "contours", "interval (too many levels)");
  const every = Number.isInteger(majorEvery) && majorEvery > 0 ? majorEvery : 5;
  const out = [];
  for (let k = first; k <= last; k++) {
    const z = q3(k * interval);
    const major = ((k % every) + every) % every === 0;
    for (const line of join(segmentsAt(grid, zValues, k * interval))) out.push({ z, major, line });
  }
  return out;
}

/** Plan 3.10. The cut and fill line: the zero contour of proposed - existing.
    diffValues: n * n differences. → [[[x, y], ...], ...] one polyline per piece. */
export function zeroLine(grid, diffValues) {
  needGrid(grid, diffValues, "zeroLine");
  const nn = grid.n * grid.n;
  const v = new Float64Array(nn);
  for (let i = 0; i < nn; i++) v[i] = Math.abs(diffValues[i]) < 1e-6 ? 0 : diffValues[i];
  return join(segmentsAt(grid, v, 0));
}
