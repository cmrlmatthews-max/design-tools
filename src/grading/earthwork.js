/* ==========================================================================
   earthwork.js — cut, fill, and the proposed grid (Grading Sketch)

   Contract: docs/grading-sketch-technical-plan.md sections 3.8 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs.

   Caution: grid earthwork compares options. It is not a quantity takeoff.
   Expect about 5 to 10 percent against a civil surface model, more where
   edges fall between samples.

   What this module reads from `built` (the buildGrading result):
   - built.grid       { spacing, n, x0, y0, nodes } with nodes row-major from
                      the south, [x, y, z] per node (the existing ground).
   - built.existingAt (x, y) => z, built.surface.at (x, y) => z.
   - built.tiers[].pad and built.features[].ring give the feature boxes for
     the skip rule. Any nesting of [x, y] pairs is read; a missing list just
     means no boxes, and then only the corner test decides.

   Rule choices where the plan leaves room:
   - `region` limits the sums to part of the site. It is one of: a function
     (x, y) => boolean on the sub-cell center, a box { minX, minY, maxX,
     maxY }, or a ring [[x, y], ...]. null means the whole grid.
   - Volumes round to 0.1 cy, areas to 0.1 sf, the balance to 0.001. The
     balance is computed from the unrounded sums.
   - A grid with fewer than 2 nodes a side gives all zeros.
   ========================================================================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;

const CF_PER_CY = 27;
const UNCHANGED = 0.001;   // ft: corners closer than this count as unchanged (plan 3.8, skip rule)
const DISTURBED = 0.1;     // ft: |proposed - existing| above this is disturbed ground

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

function needBuilt(built, fn) {
  const g = built && built.grid;
  need(g && isNum(g.spacing) && g.spacing > 0 && Number.isInteger(g.n) && isNum(g.x0) && isNum(g.y0), fn, "built.grid");
  need(built.surface && typeof built.surface.at === "function", fn, "built.surface.at");
}

/* -------------------------------------------------------------- helpers */

/** Pushes every [x, y] pair found anywhere in `v` into `out`. */
function collectPoints(v, out) {
  if (!Array.isArray(v)) return out;
  if (v.length >= 2 && isNum(v[0]) && isNum(v[1])) { out.push(v); return out; }
  for (const item of v) collectPoints(item, out);
  return out;
}

function boxOf(points) {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/** One box per feature: every tier pad, and the ring of every drive and lot. */
function featureBoxes(built) {
  const boxes = [];
  for (const t of Array.isArray(built.tiers) ? built.tiers : []) {
    const b = boxOf(collectPoints(t && t.pad, []));
    if (b) boxes.push(b);
  }
  const feats = built.features;
  const list = Array.isArray(feats) ? feats : feats && typeof feats === "object" ? Object.values(feats).flat() : [];
  for (const f of list) {
    const b = boxOf(collectPoints(f && f.ring, []));
    if (b) boxes.push(b);
  }
  return boxes;
}

/** Flags every cell that a feature box grown by one cell touches (Uint8Array, (n-1)^2). */
function nearFlags(grid, boxes) {
  const { spacing: d, n, x0, y0 } = grid;
  const m = n - 1;
  const flags = new Uint8Array(m * m);
  for (const b of boxes) {
    // cells i with [x0 + i d, x0 + (i + 1) d] touching [minX - d, maxX + d]
    const i0 = Math.max(0, Math.floor((b.minX - d - x0) / d) - 0);
    const i1 = Math.min(m - 1, Math.ceil((b.maxX + d - x0) / d));
    const j0 = Math.max(0, Math.floor((b.minY - d - y0) / d) - 0);
    const j1 = Math.min(m - 1, Math.ceil((b.maxY + d - y0) / d));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) flags[j * m + i] = 1;
  }
  return flags;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

function regionTest(region) {
  if (region == null) return null;
  if (typeof region === "function") return region;
  if (Array.isArray(region)) {
    need(region.length >= 3, "earthwork", "region ring (3 points or more)");
    return (x, y) => pointInRing(x, y, region);
  }
  need(isNum(region.minX) && isNum(region.minY) && isNum(region.maxX) && isNum(region.maxY), "earthwork", "region");
  return (x, y) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
}

/** Existing z at every node: the grid's own node values when it has them, else existingAt. */
function existingNodes(built) {
  const { n, spacing: d, x0, y0, nodes } = built.grid;
  const out = new Float64Array(n * n);
  const useNodes = nodes && nodes.length >= n * n * 3;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      out[idx] = useNodes ? nodes[idx * 3 + 2] : built.existingAt(x0 + i * d, y0 + j * d);
    }
  }
  return out;
}

/* ----------------------------------------------------------- proposedGrid */

/** Plan 3.8. The proposed ground at every node of the existing grid, row-major from the south.
    → Float64Array of n * n elevations. */
export function proposedGrid(built) {
  needBuilt(built, "proposedGrid");
  const { n, spacing: d, x0, y0 } = built.grid;
  const at = built.surface.at;
  const out = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = at(x0 + i * d, y0 + j * d);
  return out;
}

/* -------------------------------------------------------------- earthwork */

/** Plan 3.8. Midpoint rule on k x k sub-cells per grid cell.
    → { cutCy, fillCy, netCy, bulkedNetCy, balance, disturbedArea, cellsSampled }.
    netCy = fill - cut (positive = import). bulkedNetCy = fill - cut x bulking.
    balance = min / max of cut and fill, 1 when both are 0. */
export function earthwork(built, { subdivide = 4, bulking = 1, region = null } = {}) {
  needBuilt(built, "earthwork");
  need(typeof built.existingAt === "function", "earthwork", "built.existingAt");
  const k = Math.max(1, Math.floor(isNum(subdivide) ? subdivide : 4));
  const bulk = isNum(bulking) && bulking > 0 ? bulking : 1;
  const { n, spacing: d, x0, y0 } = built.grid;
  const out = { cutCy: 0, fillCy: 0, netCy: 0, bulkedNetCy: 0, balance: 1, disturbedArea: 0, cellsSampled: 0 };
  if (n < 2) return out;

  const h = d / k, area = h * h, m = n - 1;
  const inRegion = regionTest(region);
  const exist = existingNodes(built);
  const prop = proposedGrid(built);
  const near = nearFlags(built.grid, featureBoxes(built));
  const exAt = built.existingAt, prAt = built.surface.at;

  let cut = 0, fill = 0, disturbed = 0, cells = 0;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      if (!near[j * m + i]) {
        const a = j * n + i, b = a + 1, c = a + n, e = c + 1;
        const same = Math.abs(prop[a] - exist[a]) < UNCHANGED && Math.abs(prop[b] - exist[b]) < UNCHANGED
          && Math.abs(prop[c] - exist[c]) < UNCHANGED && Math.abs(prop[e] - exist[e]) < UNCHANGED;
        if (same) continue;
      }
      cells++;
      const cx0 = x0 + i * d, cy0 = y0 + j * d;
      for (let sj = 0; sj < k; sj++) {
        const y = cy0 + (sj + 0.5) * h;
        for (let si = 0; si < k; si++) {
          const x = cx0 + (si + 0.5) * h;
          if (inRegion && !inRegion(x, y)) continue;
          const diff = prAt(x, y) - exAt(x, y);
          if (diff > 0) fill += diff * area; else cut -= diff * area;
          if (Math.abs(diff) > DISTURBED) disturbed += area;
        }
      }
    }
  }

  const cutCy = cut / CF_PER_CY, fillCy = fill / CF_PER_CY;
  const hi = Math.max(cutCy, fillCy), lo = Math.min(cutCy, fillCy);
  out.cutCy = r1(cutCy);
  out.fillCy = r1(fillCy);
  out.netCy = r1(fillCy - cutCy);
  out.bulkedNetCy = r1(fillCy - cutCy * bulk);
  out.balance = hi > 0 ? r3(lo / hi) : 1;
  out.disturbedArea = r1(disturbed);
  out.cellsSampled = cells;
  return out;
}
