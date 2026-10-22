/* ==========================================================================
   GRADING: walls
   Plan: docs/grading-sketch-technical-plan.md, sections 3.5 (item 4) and 3.6.

   Pure ES module: no DOM, no Three.js, no hidden state, no mutation of inputs.
   Units: feet. Plan (x, y) in the project frame: east = +x, north = +y.
   Coordinates round to 0.001 ft, elevations and heights to 0.01 ft.

   A Wall is { id, kind: "drawn" | "pad-step" | "auto", line: [[x, y], …], auto, accepted }.
   Every wall in a list acts on the surface (unaccepted auto walls too; the page draws them dashed).

   Caution: walls over about 4 ft often need an engineered design, a permit, and a guard.
   Verify every wall with the civil and structural engineers.

   This module is the lowest grading layer: surface.js imports `blocks` and `wallSegments` from it,
   and features.js imports the wall builders. It imports nothing from the grading folder.
   ========================================================================== */
import { cleanRing2 } from "../shared/sketchup-format.js";

const EPS = 1e-6;          // ft: boundary tolerance for point-in-ring
const CROSS_EPS = 1e-7;    // ft²: orientation tolerance for a proper crossing
const STEP_MIN = 0.05;     // ft: pad tops that differ by more than this get a pad-step wall
const AUTO_MIN = 0.05;     // ft: |proposed − existing| at the property line that flags an auto wall
const JOIN_GAP = 10;       // ft: flagged stretches closer than this along the property line join
const PROBE = 0.01;        // ft: the side offset for owners, heights, and the wall test

const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/* ------------------------------------------------------------ geometry */

function lineOf(w) {
  const raw = Array.isArray(w) ? w : w && Array.isArray(w.line) ? w.line : [];
  const out = [];
  for (const p of raw) {
    if (!isPt(p)) continue;
    const q = [r3(p[0]), r3(p[1])];
    const last = out[out.length - 1];
    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.001) continue;
    out.push(q);
  }
  return out;
}

const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function properCross(ax, ay, bx, by, s) {
  const d1 = orient(s[0], s[1], s[2], s[3], ax, ay);
  const d2 = orient(s[0], s[1], s[2], s[3], bx, by);
  if (!((d1 > CROSS_EPS && d2 < -CROSS_EPS) || (d1 < -CROSS_EPS && d2 > CROSS_EPS))) return false;
  const d3 = orient(ax, ay, bx, by, s[0], s[1]);
  const d4 = orient(ax, ay, bx, by, s[2], s[3]);
  return (d3 > CROSS_EPS && d4 < -CROSS_EPS) || (d3 < -CROSS_EPS && d4 > CROSS_EPS);
}

function onSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= EPS;
}

/** Point in ring, boundary included (1e-6 ft). */
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSegment(x, y, a[0], a[1], b[0], b[1])) return true;
    if ((b[1] > y) !== (a[1] > y) && x < ((a[0] - b[0]) * (y - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}

function boxOfRings(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

/** Douglas–Peucker on [x, y] or [x, y, z] points (z counts in the distance). Keeps the end points. */
function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const dim = pts[0].length >= 3 ? 3 : 2;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i], b = pts[j];
    const ab = [b[0] - a[0], b[1] - a[1], dim === 3 ? b[2] - a[2] : 0];
    const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k];
      const ap = [p[0] - a[0], p[1] - a[1], dim === 3 ? p[2] - a[2] : 0];
      const t = L2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0;
      const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/* ------------------------------------------------------------ wall test (section 3.5, item 4) */

/**
 * Compiles walls (Wall objects or bare polylines) into segments with boxes, for repeated `blocks` calls.
 * → { segments: [[ax, ay, bx, by, x0, y0, x1, y1], …], count }
 */
export function wallSegments(walls) {
  if (walls && Array.isArray(walls.segments)) return walls;
  const segments = [];
  for (const w of Array.isArray(walls) ? walls : []) {
    const line = lineOf(w);
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      segments.push([a[0], a[1], b[0], b[1], Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
    }
  }
  return { segments, count: segments.length };
}

/**
 * Section 3.5, item 4: true when a wall stands between the point p and its nearest feature point q.
 * The segment p → q is extended 0.01 ft past q (so a wall drawn on the feature edge counts) and blocks
 * when it properly crosses a wall segment. Touching a wall end, or running along a wall, does not block.
 * `walls` is a Wall list, a list of polylines, or the result of wallSegments.
 */
export function blocks(walls, p, q) {
  const W = wallSegments(walls);
  if (!W.count) return false;
  const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
  if (!(L > 0)) return false;
  const ex = q[0] + (dx / L) * PROBE, ey = q[1] + (dy / L) * PROBE;
  const bx0 = Math.min(p[0], ex), by0 = Math.min(p[1], ey), bx1 = Math.max(p[0], ex), by1 = Math.max(p[1], ey);
  for (const s of W.segments) {
    if (s[6] < bx0 || s[4] > bx1 || s[7] < by0 || s[5] > by1) continue;
    if (properCross(p[0], p[1], ex, ey, s)) return true;
  }
  return false;
}

/* ------------------------------------------------------------ pad-step walls (change 3) */

function padRingsOf(t) {
  const list = Array.isArray(t && t.pads) ? t.pads : t && Array.isArray(t.pad) ? [t.pad] : [];
  return list.map((r) => cleanRing2(r)).filter(Boolean);
}

/**
 * Section 3.6, pad-step walls. `tiers` in first-wins order (buildings in list order, tiers in order),
 * each { id, padTop, pads: [ring, …] } (or `pad`: ring). Walks every pad edge in 1 ft pieces and tests a
 * point 0.01 ft outside each piece. Where the inside point belongs to this pad and the outside point
 * belongs to a LATER pad whose top differs by more than 0.05 ft, the piece is a step. The boundary between
 * two owned regions always lies on the edge of the earlier pad, so each stretch is found once.
 * → Wall[] { id: "P1"…, kind: "pad-step", line, auto: false, accepted: true, between: [tierId, tierId] }
 */
export function padStepWalls(tiers) {
  const T = (Array.isArray(tiers) ? tiers : []).map((t) => {
    const rings = padRingsOf(t);
    return { id: t && t.id, top: num(t && t.padTop, NaN), rings, box: rings.length ? boxOfRings(rings) : null };
  });
  const owner = (x, y) => {
    for (let k = 0; k < T.length; k++) {
      const b = T[k].box;
      if (!b || x < b[0] - EPS || x > b[2] + EPS || y < b[1] - EPS || y > b[3] + EPS) continue;
      if (T[k].rings.some((r) => inRing(r, x, y))) return k;
    }
    return -1;
  };
  const out = [];
  for (let ia = 0; ia < T.length; ia++) {
    const A = T[ia];
    if (!Number.isFinite(A.top)) continue;
    for (const ring of A.rings) {
      const pieces = [];
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e], b = ring[(e + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (!(L > 0)) continue;
        const N = Math.max(1, Math.ceil(L - 1e-9));
        const nx = dy / L, ny = -dx / L;          // outward normal of a CCW ring
        for (let i = 0; i < N; i++) {
          const f = (i + 0.5) / N, cx = a[0] + f * dx, cy = a[1] + f * dy;
          let flag = false, nb = -1;
          if (owner(cx - PROBE * nx, cy - PROBE * ny) === ia) {
            nb = owner(cx + PROBE * nx, cy + PROBE * ny);
            flag = nb > ia && Number.isFinite(T[nb].top) && Math.abs(T[nb].top - A.top) > STEP_MIN;
          }
          pieces.push({ e, i, N, flag, nb, a, b });
        }
      }
      for (const run of runsOf(pieces)) {
        const line = runLine(run, ring);
        const nbs = [...new Set(run.filter((p) => p.nb >= 0).map((p) => T[p.nb].id))];
        out.push({ line, between: [A.id, ...nbs] });
      }
    }
  }
  return out.map((w, k) => ({ id: `P${k + 1}`, kind: "pad-step", line: w.line, auto: false, accepted: true, between: w.between }));
}

/** Maximal cyclic runs of flagged pieces. A ring flagged all round gives one run with `closed`. */
function runsOf(pieces) {
  const n = pieces.length;
  if (!n) return [];
  if (pieces.every((p) => p.flag)) { const run = pieces.slice(); run.closed = true; return [run]; }
  let s = pieces.findIndex((p) => !p.flag);
  const runs = [];
  let cur = null;
  for (let k = 1; k <= n; k++) {
    const p = pieces[(s + k) % n];
    if (p.flag) { if (!cur) { cur = []; runs.push(cur); } cur.push(p); } else cur = null;
  }
  return runs;
}

const pieceStart = (p) => [p.a[0] + (p.i / p.N) * (p.b[0] - p.a[0]), p.a[1] + (p.i / p.N) * (p.b[1] - p.a[1])];
const pieceEnd = (p) => [p.a[0] + ((p.i + 1) / p.N) * (p.b[0] - p.a[0]), p.a[1] + ((p.i + 1) / p.N) * (p.b[1] - p.a[1])];

function runLine(run, ring) {
  if (run.closed) {
    const pts = ring.map((p) => [r3(p[0]), r3(p[1])]);
    pts.push(pts[0].slice());
    return pts;
  }
  const pts = [pieceStart(run[0])];
  for (let k = 1; k < run.length; k++) if (run[k].e !== run[k - 1].e) pts.push(ring[run[k].e].slice());
  pts.push(pieceEnd(run[run.length - 1]));
  return pts.map((p) => [r3(p[0]), r3(p[1])]);
}

/* ------------------------------------------------------------ auto walls (section 3.6, change 6) */

/** Miter inset of a CCW ring: edge k shifted left by d; vertex k = shifted edges k−1 and k. */
function insetVertices(ring, d) {
  const n = ring.length;
  const edges = [];
  for (let k = 0; k < n; k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    edges.push({ p: [a[0] + d * nx, a[1] + d * ny], u: [dx / L, dy / L], n: [nx, ny] });
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const e1 = edges[(k - 1 + n) % n], e2 = edges[k];
    const den = e1.u[0] * e2.u[1] - e1.u[1] * e2.u[0];
    if (Math.abs(den) < 1e-9) { out.push(e2.p.slice()); continue; }
    const wx = e2.p[0] - e1.p[0], wy = e2.p[1] - e1.p[1];
    const t = (wx * e2.u[1] - wy * e2.u[0]) / den;
    out.push([e1.p[0] + t * e1.u[0], e1.p[1] + t * e1.u[1]]);
  }
  return { vertices: out, normals: edges.map((e) => e.n) };
}

/** Distance along the ray (x, y) + t (ux, uy), t in (0, tMax], to the first crossing of a ring edge. */
function rayExit(rings, x, y, ux, uy, tMax) {
  let best = Infinity;
  for (const ring of rings) for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - x, wy = a[1] - y;
    const t = (wx * ey - wy * ex) / den, s = (wx * uy - wy * ux) / den;
    if (t > 1e-9 && t <= tMax + 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

function featureRings(f) {
  if (Array.isArray(f.rings) && f.rings.length) return f.rings;
  return Array.isArray(f.ring) && f.ring.length ? [f.ring] : [];
}

/**
 * Section 3.6, auto walls. Samples the property line in 1 ft pieces; where |proposed − existing| reaches
 * 0.05 ft the daylight leaves the site. Stretches with gaps under 10 ft join. Each wall follows the
 * property line inset by `autoWalls.offset` (miter); a point of that inset line inside a feature moves out
 * along the line to its property point, onto the feature edge (change 6). Ids A1, A2, … in boundary order
 * (from the first vertex of the cleaned, counter-clockwise property ring).
 * `surface` is makeSurface(...) with `at` and `existingAt`; `features` have contains(x, y) and rings.
 * → Wall[] { id, kind: "auto", line, auto: true, accepted }
 */
export function autoWalls(state, surface, propertyRing, features) {
  const aw = (state && state.autoWalls) || {};
  if (aw.on === false) return [];
  const ring = cleanRing2(propertyRing);
  if (!ring || !surface || typeof surface.at !== "function" || typeof surface.existingAt !== "function") return [];
  const offset = Math.max(0, num(aw.offset, 5));
  const accepted = Array.isArray(aw.accepted) ? aw.accepted.map(String) : [];
  const n = ring.length;
  const cum = [0];
  for (let k = 0; k < n; k++) { const a = ring[k], b = ring[(k + 1) % n]; cum.push(cum[k] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const P = cum[n];
  if (!(P > 0)) return [];

  // 1 ft pieces; a piece is flagged by its center. Runs are perimeter intervals [s, e].
  const flags = [];
  for (let k = 0; k < n; k++) {
    const L = cum[k + 1] - cum[k];
    if (!(L > 0)) continue;
    const N = Math.max(1, Math.ceil(L - 1e-9));
    const a = ring[k], b = ring[(k + 1) % n];
    for (let i = 0; i < N; i++) {
      const f = (i + 0.5) / N, x = a[0] + f * (b[0] - a[0]), y = a[1] + f * (b[1] - a[1]);
      // Flag at 0.05 ft or more (1e-6 tolerance): a toe that just reaches the line counts.
      const flag = Math.abs(surface.at(x, y) - surface.existingAt(x, y)) > AUTO_MIN - 1e-6;
      flags.push({ s: cum[k] + (i / N) * L, e: cum[k] + ((i + 1) / N) * L, flag });
    }
  }
  let runs = [];
  for (const p of flags) {
    if (!p.flag) continue;
    const last = runs[runs.length - 1];
    if (last && p.s - last.e < JOIN_GAP - 1e-9) last.e = p.e; else runs.push({ s: p.s, e: p.e });
  }
  if (!runs.length) return [];
  if (runs.length === 1 && runs[0].e - runs[0].s >= P - 1e-9) runs = [{ s: 0, e: P, closed: true }];
  else if (runs.length > 1) {
    const first = runs[0], last = runs[runs.length - 1];
    if (first.s + (P - last.e) < JOIN_GAP - 1e-9) { runs.pop(); runs[0] = { s: last.s, e: first.e + P }; runs.push(runs.shift()); }
  }

  const { vertices: inset, normals } = insetVertices(ring, offset);
  const pointAt = (s) => {                       // perimeter param → { p, q (inset), edge }
    const u = ((s % P) + P) % P;
    let k = 0;
    while (k < n - 1 && cum[k + 1] <= u) k++;
    const L = cum[k + 1] - cum[k], f = L ? (u - cum[k]) / L : 0;
    const a = ring[k], b = ring[(k + 1) % n];
    if (f < 1e-9) return { p: a.slice(), q: inset[k].slice(), k };          // on a vertex: the inset vertex
    const p = [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
    // The shifted point, held on the inset edge between its two miter vertices (no overshoot at corners).
    const sx = p[0] + offset * normals[k][0], sy = p[1] + offset * normals[k][1];
    const c0 = inset[k], c1 = inset[(k + 1) % n], ex = c1[0] - c0[0], ey = c1[1] - c0[1], E2 = ex * ex + ey * ey;
    const g = E2 ? Math.max(0, Math.min(1, ((sx - c0[0]) * ex + (sy - c0[1]) * ey) / E2)) : 0;
    return { p, q: [c0[0] + g * ex, c0[1] + g * ey], k };
  };
  const F = (Array.isArray(features) ? features : []).filter((f) => f && typeof f.contains === "function");

  const out = [];
  for (const run of runs) {
    // Densify the run every ≤ 1 ft along the property line; ring vertices map to inset vertices.
    const pairs = [];
    const span = run.e - run.s;
    const N = Math.max(1, Math.ceil(span - 1e-9));
    for (let i = 0; i <= N; i++) {
      const s = run.s + (i / N) * span;
      pairs.push(pointAt(s));
      if (i < N) {
        const s2 = run.s + ((i + 1) / N) * span;
        for (let v = 0; v <= 2 * n; v++) {          // ring vertices strictly inside (s, s2), over two laps
          const sv = cum[v % n] + Math.floor(v / n) * P;
          if (sv > s + 1e-9 && sv < s2 - 1e-9) pairs.push({ p: ring[v % n].slice(), q: inset[v % n].slice(), k: v % n });
        }
      }
    }
    const pts = pairs.map(({ p, q }) => {
      let x = q[0], y = q[1];
      const D = Math.hypot(p[0] - x, p[1] - y);
      if (!(D > 1e-9)) return [r3(x), r3(y)];
      const ux = (p[0] - x) / D, uy = (p[1] - y) / D;
      for (let guard = 0; guard < 4; guard++) {
        // The feature that holds the line just ahead of (x, y), toward the property line.
        const f = F.find((g) => g.contains(x + ux * 1e-4, y + uy * 1e-4));
        if (!f) break;
        const L = Math.hypot(p[0] - x, p[1] - y);
        const t = rayExit(featureRings(f), x + ux * 1e-4, y + uy * 1e-4, ux, uy, L);
        if (!Number.isFinite(t)) { x = p[0]; y = p[1]; break; }
        x += ux * (t + 1e-4); y += uy * (t + 1e-4);
      }
      return [r3(x), r3(y)];
    });
    const dedup = [];
    for (const p of pts) { const l = dedup[dedup.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= 0.001) dedup.push(p); }
    const line = simplify(dedup, 0.005).map((p) => [r3(p[0]), r3(p[1])]);
    if (line.length >= 2) out.push(line);
  }
  return out.map((line, k) => {
    const id = `A${k + 1}`;
    return { id, kind: "auto", line, auto: true, accepted: accepted.includes(id) };
  });
}

/* ------------------------------------------------------------ heights (section 3.6) */

/**
 * Section 3.6, height. Each wall segment is cut into 1 ft pieces; at each piece center p with the
 * segment normal n, h = |at(p + 0.01 n) − at(p − 0.01 n)|. The averages weight pieces by length.
 * → { heightMax, heightAvg, length, top: [[x, y, z], …] } (top = the higher side, simplified to 0.01 ft)
 */
export function wallStats(wall, surfaceAt) {
  const line = lineOf(wall);
  const at = typeof surfaceAt === "function" ? surfaceAt : surfaceAt && surfaceAt.at;
  if (line.length < 2 || typeof at !== "function") return { heightMax: 0, heightAvg: 0, length: 0, top: [] };
  let hMax = 0, hSum = 0, length = 0;
  const top = [];
  const side = (x, y, nx, ny) => {
    const a = at(x + PROBE * nx, y + PROBE * ny), b = at(x - PROBE * nx, y - PROBE * ny);
    return { h: Math.abs(a - b), z: Math.max(a, b) };
  };
  for (let s = 0; s + 1 < line.length; s++) {
    const a = line[s], b = line[s + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (!(L > 0)) continue;
    const nx = -dy / L, ny = dx / L;
    const N = Math.max(1, Math.ceil(L - 1e-9));
    // Ends are read 0.01 ft inside the segment: right at a wall end the daylight wraps around it.
    const ux = dx / L, uy = dy / L, e = Math.min(PROBE, L / 2);
    if (!top.length) top.push([a[0], a[1], side(a[0] + e * ux, a[1] + e * uy, nx, ny).z]);
    for (let i = 0; i < N; i++) {
      const f = (i + 0.5) / N, x = a[0] + f * dx, y = a[1] + f * dy;
      const v = side(x, y, nx, ny);
      if (v.h > hMax) hMax = v.h;
      hSum += v.h * (L / N);
      top.push([x, y, v.z]);
    }
    top.push([b[0], b[1], side(b[0] - e * ux, b[1] - e * uy, nx, ny).z]);
    length += L;
  }
  const simple = simplify(top, 0.01).map((p) => [r3(p[0]), r3(p[1]), r2(p[2])]);
  return { heightMax: r2(hMax), heightAvg: r2(length ? hSum / length : 0), length: r3(length), top: simple };
}
