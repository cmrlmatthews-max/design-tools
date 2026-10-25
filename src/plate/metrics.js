/* ==========================================================================
   metrics.js — every row of plan 3.12 and the warning list (Plate Planner)

   Contract: docs/plate-planner-technical-plan.md sections 3.11, 3.12 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs.

   Caution: these are design-stage numbers on editable values, not a code
   review. Unit counts, areas, corridor lengths, distances and accessible
   counts need the design team's check against the adopted code. The tool
   never writes "compliant".

   Reads `built` (the buildPlates result):
     { source, groups: [{ id, levels, fill, label?, first? }], placement, warnings,
       massingUpdatedAt?, currentMassingUpdatedAt? }
   `levels` lists the level indices of the group (numbers, or objects with .index);
   `fill` is the LevelFill of the lowest level:
     { plate: MultiPoly, corridor: MultiPoly, core: Ring | { outer } | null,
       stairs: [{ id, outer, door }], elevators: [{ id, outer }],
       support: [{ id, outer, kind }], units: [{ id, type, outer, area?, exposures, corner,
       accessible, bays?, bay? }], runs: [{ id, length, depth }], corners?: [{ e }],
       spine?: [[[x, y], [x, y]], …], counts?: { [typeId]: target }, warnings?: [] }
   Optional fill fields: `spine` (the corridor graph numbers need it), `counts` (the
   per-type targets; otherwise they are recomputed from the runs with mix.js), `corners`
   (the wrap corner legs, for the area closure). `fill.core.stairs` and `fill.core.elevators`
   are read when the fill keeps them inside `core`.

   Rule choices where the plan leaves room:
   - Every level of a group gets its own row (same numbers, its own index);
     building totals are level × group floors. Building NRSF adds the level NRSF
     rounded to 0.1 sf, so five floors of 15,077.8 give 75,389.0.
   - GSF = plate outer areas less hole areas. Efficiency = NRSF ÷ GSF (4 decimals).
     Unit area is `area` when given, else the polygon area.
   - Mix targets: fill.counts, else countsFor on the run lengths at the depth that
     carries the most run length, with the wrap corners as cornerType units
     (hotel: less the widths of the accessible keys, which are not scored).
   - Mix misses: |placed − target| > 1 unit on a level (scoreMix).
   - Corridor length = clear corridor area ÷ clear width (spine length when
     the polygon is missing). Clear width: state.corridor.width, else 6.0 (hotel) / 5.67.
   - Corridor graph: nodes at spine ends, junctions, and the projection of each
     stair door, linen closet and key door onto the spine. Stair door path = the
     longest of the shortest paths between two stair doors. Dead end = for every
     spine end that is not inside a stair block, the path length to the nearest
     stair door; an end inside a stair block gives 0. Reported only, no code check.
   - Hotel reach: a key door is the middle of the longest edge of the unit that lies
     on the corridor boundary (the unit centroid when none does). A key counts
     when its graph distance from the linen closet is at most housekeepingReach.
   - Area closure: GSF − (NRSF + clear corridor + core + stairs + elevators + support)
     with overlaps removed, against extWall × (Σ run lengths + the two wrap legs
     of every corner). A run with `slots: 0` (unfilled) is left out: its remainder runs to the plate edge.
     `area-closure` warns beyond ±1 sf.
   - Stale massing: needs built.massingUpdatedAt (used by the fill) and
     built.currentMassingUpdatedAt (the project now); checks() also takes the current time as a third
     argument { massingUpdatedAt }.
   - Warnings are { code, severity, where, message }. Build and fill warnings pass
     through metrics.buildWarnings. Derived here: type-does-not-fit and run-too-short
     (only when the fill passed none), mix-miss, stale-massing, area-closure.
   - Areas round to 0.1 sf, lengths to 0.1 ft, efficiency to 0.0001, points to 0.001.
   - Draw plan (a fill with layout: true, from layoutLevel): the closure adds the open area (closure.open) and checks
     the strip against fill.allowance; the row carries layout: true and openArea; no mix-miss and no run-too-short.
     unitsInRange reads u.match when a unit carries it.
   ========================================================================== */

import { effectiveTypes, countsFor, scoreMix, requiredAccessible, MULTIFAMILY_TYPES, HOTEL_TYPES } from "./mix.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
const isPair = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);

const EPS = 1e-9;
const CAUTION = "Design-stage numbers from a test fit. Unit counts, areas, corridor lengths and accessible counts are not a code check. Verify against the adopted code.";

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* -------------------------------------------------------------- geometry */

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};
const absArea = (ring) => Math.abs(ringArea(ring));
const multiArea = (mp) => (Array.isArray(mp) ? mp : []).reduce((s, pc) => s + absArea(pc.outer) - (pc.holes || []).reduce((h, r) => h + absArea(r), 0), 0);

function centroid(ring) {
  const a = ringArea(ring);
  if (Math.abs(a) < 1e-9) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  let cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function inRing(x, y, ring, tol = 1e-6) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    const len = Math.hypot(xb - xa, yb - ya);
    if (len > 0) {
      const cr = (xb - xa) * (y - ya) - (yb - ya) * (x - xa);
      if (Math.abs(cr) / len <= tol && x >= Math.min(xa, xb) - tol && x <= Math.max(xa, xb) + tol && y >= Math.min(ya, yb) - tol && y <= Math.max(ya, yb) + tol) return true;
    }
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

function isConvex(ring) {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Sutherland–Hodgman: the area of `subject` (any simple polygon) inside `clip` (convex). */
function clipArea(subject, clip) {
  const ccw = ringArea(clip) > 0;
  let out = subject.map((p) => [p[0], p[1]]);
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (ccw ? 1 : -1);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out.length >= 3 ? absArea(out) : 0;
}

/** Area of ring ∩ MultiPoly, for a convex `ring` (or a convex piece outer). */
function overlapWith(ring, mp) {
  let total = 0;
  for (const pc of mp) {
    let a;
    if (isConvex(ring)) a = clipArea(pc.outer, ring) - (pc.holes || []).reduce((h, r) => h + clipArea(r, ring), 0);
    else if (isConvex(pc.outer) && !(pc.holes || []).length) a = clipArea(ring, pc.outer);
    else a = 0;
    total += a;
  }
  return total;
}

const ringOf = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.outer) ? v.outer : null);

function projectOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  const x = a[0] + dx * t, y = a[1] + dy * t;
  return { t, pt: [x, y], dist: Math.hypot(p[0] - x, p[1] - y) };
}

/* ------------------------------------------------------- corridor graph */

function spineSegments(spine) {
  const segs = [];
  for (const line of Array.isArray(spine) ? spine : []) {
    const pts = (Array.isArray(line) ? line : []).filter(isPair);
    for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) > 1e-6) segs.push([pts[i], pts[i + 1]]);
  }
  return segs;
}

const nodeKey = (p) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)}`;

/**
 * The spine as a graph. `queries` are { key, p }: each is projected onto the nearest spine piece and
 * becomes a node. → { nodes, adj, totalFt, ends, projOf(key) → nodeId, dist(fromNode) → Map }
 */
function buildGraph(spine, queries) {
  const segs = spineSegments(spine);
  if (!segs.length) return null;
  const cuts = segs.map(() => [0, 1]);
  const proj = new Map();
  for (const q of queries) {
    let best = null;
    segs.forEach((s, i) => {
      const pr = projectOnSegment(q.p, s[0], s[1]);
      if (!best || pr.dist < best.dist - 1e-9) best = { ...pr, i };
    });
    cuts[best.i].push(best.t);
    proj.set(q.key, { seg: best.i, t: best.t, pt: best.pt });
  }
  // junctions: a spine end that lies on another piece, and proper crossings
  segs.forEach((s, i) => {
    segs.forEach((o, j) => {
      if (i === j) return;
      for (const e of o) {
        const pr = projectOnSegment(e, s[0], s[1]);
        if (pr.dist < 0.05) cuts[i].push(pr.t);
      }
      const d1 = [s[1][0] - s[0][0], s[1][1] - s[0][1]], d2 = [o[1][0] - o[0][0], o[1][1] - o[0][1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) > 1e-9) {
        const t = ((o[0][0] - s[0][0]) * d2[1] - (o[0][1] - s[0][1]) * d2[0]) / den;
        const u = ((o[0][0] - s[0][0]) * d1[1] - (o[0][1] - s[0][1]) * d1[0]) / den;
        if (t > 0 && t < 1 && u > 0 && u < 1) cuts[i].push(t);
      }
    });
  });
  const nodes = [], ids = new Map(), adj = [];
  const node = (p) => {
    const k = nodeKey(p);
    if (!ids.has(k)) { ids.set(k, nodes.length); nodes.push([p[0], p[1]]); adj.push([]); }
    return ids.get(k);
  };
  let totalFt = 0;
  segs.forEach((s, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e7) / 1e7))].sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k++) {
      const p = [s[0][0] + (s[1][0] - s[0][0]) * ts[k], s[0][1] + (s[1][1] - s[0][1]) * ts[k]];
      const q = [s[0][0] + (s[1][0] - s[0][0]) * ts[k + 1], s[0][1] + (s[1][1] - s[0][1]) * ts[k + 1]];
      const a = node(p), b = node(q);
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (a === b || len < 1e-6) continue;
      adj[a].push([b, len]); adj[b].push([a, len]);
      totalFt += len;
    }
  });
  const nodeOf = new Map();
  // the node of a query: the same rounded t as the edge cuts, so the two always meet in one node
  for (const [key, pr] of proj) {
    const s = segs[pr.seg], tt = Math.round(pr.t * 1e7) / 1e7;
    nodeOf.set(key, node([s[0][0] + (s[1][0] - s[0][0]) * tt, s[0][1] + (s[1][1] - s[0][1]) * tt]));
  }
  const ends = nodes.map((_, i) => i).filter((i) => adj[i].length === 1);
  function dist(from) {
    const d = new Array(nodes.length).fill(Infinity), done = new Array(nodes.length).fill(false);
    d[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const [v, w] of adj[u]) if (d[u] + w < d[v]) d[v] = d[u] + w;
    }
    return d;
  }
  return { nodes, adj, totalFt, ends, nodeOf: (key) => nodeOf.get(key), dist };
}

/** The door of a key: the middle of the longest unit edge on the corridor boundary; the centroid when none lies on it. */
function doorOf(unit, corridor) {
  const ring = ringOf(unit.outer);
  if (!ring) return null;
  const bounds = [];
  for (const pc of corridor) { bounds.push(pc.outer); for (const h of pc.holes || []) bounds.push(h); }
  const onBoundary = (p) => bounds.some((r) => r.some((a, i) => projectOnSegment(p, a, r[(i + 1) % r.length]).dist < 0.02));
  let best = null, bestLen = 0.5;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (len > bestLen && onBoundary(a) && onBoundary(b) && onBoundary(mid)) { best = mid; bestLen = len; }
  }
  return best || centroid(ring);
}

/** Plan 3.11 for one level fill. → { lengthFt, stairPathFt, deadEnds, deadEndMax, doors, reach } */
function corridorNumbers(state, fill, width, hotel) {
  const stairs = stairsOf(fill);
  const corridor = Array.isArray(fill.corridor) ? fill.corridor : [];
  const polyFt = corridor.length && width > 0 ? multiArea(corridor) / width : null;
  const out = { lengthFt: null, stairPathFt: null, deadEnds: [], deadEndMax: null, doors: stairs.map((s) => ({ id: s.id, door: s.door ? [r3(s.door[0]), r3(s.door[1])] : null })), reach: null };
  const spine = Array.isArray(fill.spine) ? fill.spine : [];
  const queries = [];
  stairs.forEach((s) => { if (isPair(s.door)) queries.push({ key: `s:${s.id}`, p: s.door }); });
  const closets = hotel ? [...(fill.support || []), ...(Array.isArray(fill.coreRooms) ? fill.coreRooms : [])].filter((b) => b && b.kind === "linen" && ringOf(b.outer)) : [];
  closets.forEach((b, i) => queries.push({ key: `c:${i}`, p: centroid(ringOf(b.outer)) }));
  const units = Array.isArray(fill.units) ? fill.units : [];
  const doors = hotel && closets.length ? units.map((u) => doorOf(u, corridor)) : [];
  doors.forEach((p, i) => { if (p) queries.push({ key: `k:${i}`, p }); });

  const g = buildGraph(spine, queries);
  out.lengthFt = polyFt !== null ? r1(polyFt) : g ? r1(g.totalFt) : null;
  if (!g) return out;

  const sIds = stairs.filter((s) => isPair(s.door)).map((s) => ({ id: s.id, node: g.nodeOf(`s:${s.id}`) }));
  if (sIds.length >= 2) {
    let best = 0;
    for (const a of sIds) { const d = g.dist(a.node); for (const b of sIds) if (b !== a && d[b.node] < Infinity && d[b.node] > best) best = d[b.node]; }
    out.stairPathFt = r1(best);
  } else if (sIds.length === 1) out.stairPathFt = 0;

  if (sIds.length) {
    const fromStair = sIds.map((s) => ({ ...s, d: g.dist(s.node) }));
    for (const n of g.ends) {
      const at = g.nodes[n];
      const inside = stairs.find((s) => ringOf(s.outer) && inRing(at[0], at[1], ringOf(s.outer), 0.02));
      if (inside) { out.deadEnds.push({ stairId: inside.id, ft: 0, at: [r3(at[0]), r3(at[1])] }); continue; }
      let best = null;
      for (const s of fromStair) if (s.d[n] < Infinity && (!best || s.d[n] < best.d)) best = { id: s.id, d: s.d[n] };
      if (best) out.deadEnds.push({ stairId: best.id, ft: r1(best.d), at: [r3(at[0]), r3(at[1])] });
    }
    out.deadEndMax = out.deadEnds.reduce((m, e) => Math.max(m, e.ft), 0);
  }

  if (hotel && closets.length) {
    const reachFt = isNum(state.housekeepingReach) ? state.housekeepingReach : 150;
    const d = g.dist(g.nodeOf("c:0"));
    let within = 0, farthest = 0;
    doors.forEach((p, i) => {
      if (!p) return;
      const ft = d[g.nodeOf(`k:${i}`)];
      if (ft <= reachFt + EPS) within++;
      if (ft < Infinity && ft > farthest) farthest = ft;
    });
    out.reach = { reachFt, within, outside: doors.filter(Boolean).length - within, farthestFt: r1(farthest) };
  }
  return out;
}

/* ----------------------------------------------------------- level rows */

const coreRing = (fill) => ringOf(fill.core);

function stairsOf(fill) {
  if (Array.isArray(fill.stairs)) return fill.stairs;
  return fill.core && Array.isArray(fill.core.stairs) ? fill.core.stairs : [];
}
function elevatorsOf(fill) {
  if (Array.isArray(fill.elevators)) return fill.elevators;
  return fill.core && Array.isArray(fill.core.elevators) ? fill.core.elevators : [];
}

const unitArea = (u) => (isNum(u.area) ? u.area : ringOf(u.outer) ? absArea(ringOf(u.outer)) : 0);
const mixKey = (state) => (state.mode === "hotel" ? "hotel" : "multifamily");
const mixTypes = (state) => {
  const m = state.mix && Array.isArray(state.mix[mixKey(state)]) ? state.mix[mixKey(state)] : null;
  return m || (state.mode === "hotel" ? HOTEL_TYPES : MULTIFAMILY_TYPES);
};
const clearWidth = (state) => (state.corridor && isNum(state.corridor.width) ? state.corridor.width : state.mode === "hotel" ? 6.0 : 5.67);

const round2 = (v) => Math.round(v * 100) / 100;

/** The share-weighted target area of the multifamily mix (types with share > 0); hotel: null. */
function targetAvgOf(state) {
  if (state.mode === "hotel") return null;
  let s = 0, a = 0;
  for (const t of mixTypes(state)) if (isNum(t.share) && t.share > 0 && isNum(t.targetArea)) { s += t.share; a += t.share * t.targetArea; }
  return s > 0 ? r1(a / s) : null;
}

/**
 * Units against their type's area range (rework review): a unit is area-high when the fill flagged it or its area is
 * above areaMax (+0.5 sf); in range when it is not area-high and its area is at least areaMin (−0.5 sf). Wrap corners
 * carry the corner type, so they test against it. A type with no area range (hotel keys, accessible keys) is in range.
 * → { units, inRange, areaHighCount, avgArea, targetAvgArea }
 */
export function unitsInRange(state, units) {
  need(state && typeof state === "object", "unitsInRange", "state");
  const list = Array.isArray(units) ? units : [];
  const rows = new Map(mixTypes(state).map((t) => [t.id, t]));
  let inRange = 0, high = 0, sum = 0;
  for (const u of list) {
    const a = unitArea(u);
    sum += a;
    // draw plan 3.3: a drawn unit carries its match
    if (u.match === "large" || u.match === "small" || u.match === "in-range") {
      if (u.match === "large") high++; else if (u.match === "in-range") inRange++;
      continue;
    }
    const t = rows.get(u.type);
    const hasRange = t && isNum(t.areaMax) && state.mode !== "hotel";
    const isHigh = !!u.areaHigh || (hasRange && a > t.areaMax + 0.5);
    if (isHigh) { high++; continue; }
    if (!hasRange || !isNum(t.areaMin) || a >= t.areaMin - 0.5) inRange++;
  }
  return { units: list.length, inRange, areaHighCount: high, avgArea: list.length ? r1(sum / list.length) : 0, targetAvgArea: targetAvgOf(state) };
}

/** The depth that carries the most run length, and every depth in use (rounded to 0.01 ft). */
function runDepths(runs) {
  const by = new Map();
  for (const r of runs) {
    if (!isNum(r.depth) || !isNum(r.length)) continue;
    const k = round2(r.depth);
    by.set(k, (by.get(k) || 0) + r.length);
  }
  let main = null;
  for (const [k, v] of by) if (main === null || v > by.get(main)) main = k;
  return { main, all: [...by.keys()].sort((a, b) => a - b) };
}

function targetsFor(state, fill, hotel) {
  const runs = Array.isArray(fill.runs) ? fill.runs : [];
  if (fill.counts && typeof fill.counts === "object") return { counts: { ...fill.counts }, dropped: [], depths: runDepths(runs).all };
  const { main, all } = runDepths(runs);
  if (!runs.length || (main === null && !hotel)) return { counts: null, dropped: [], depths: all };
  const types = mixTypes(state);
  const eff = effectiveTypes(types, main, hotel ? "hotel" : "multifamily");
  const dropped = [];
  for (const depth of hotel ? [] : all) for (const d of effectiveTypes(types, depth, "multifamily").dropped) dropped.push({ ...d, depth });
  if (!eff.types.length) return { counts: null, dropped, depths: all };
  let length = runs.reduce((s, r) => s + (isNum(r.length) ? r.length : 0), 0);
  const units = Array.isArray(fill.units) ? fill.units : [];
  if (hotel) {
    for (const u of units) if (u.accessible) length -= u.bay && isNum(u.bay.from) && isNum(u.bay.to) ? Math.abs(u.bay.to - u.bay.from) : unitArea(u) / (main || 26);
    length = Math.max(0, length);
  }
  const cornerType = state.mix && state.mix.cornerType ? state.mix.cornerType : "2br";
  const corners = Array.isArray(fill.corners) ? fill.corners.map(() => cornerType) : [];
  return { counts: countsFor(length, eff.types, corners).counts, dropped, depths: all };
}

function supportRows(fill) {
  const byKind = {};
  let count = 0, areaSf = 0;
  for (const b of fill.support || []) {
    const ring = ringOf(b && b.outer);
    if (!ring) continue;
    const kind = b.kind || "support";
    if (!byKind[kind]) byKind[kind] = { count: 0, areaSf: 0 };
    const a = absArea(ring);
    byKind[kind].count++; byKind[kind].areaSf += a;
    count++; areaSf += a;
  }
  for (const k of Object.keys(byKind)) byKind[k].areaSf = r1(byKind[k].areaSf);
  return { count, areaSf: r1(areaSf), byKind };
}

/** Uncovered convex corners minus uncovered reflex corners of the plate (outer rings and holes). */
function cornerSquares(plate, blocks) {
  const polys = Array.isArray(plate) ? plate : [];
  const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const near = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) < 0.01;
  };
  const covered = (p) => blocks.some((r) => {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (near(p, r[j], r[i])) return true;
      const a = r[i], b = r[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  });
  let n = 0;
  const walk = (ring, hole) => {
    if (!Array.isArray(ring) || ring.length < 3) return;
    const s = Math.sign(signedArea(ring)) * (hole ? -1 : 1);   // material sits to the left after this sign
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], v = ring[i], b = ring[(i + 1) % ring.length];
      const cross = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]);
      if (Math.abs(cross) < 1e-9 || covered(v)) continue;
      n += cross * s > 0 ? 1 : -1;
    }
  };
  for (const poly of polys) { if (!poly) continue; walk(poly.outer, false); for (const h of poly.holes || []) walk(h, true); }
  return n;
}

/** Length of the edges of leftover and remainder pieces that lie on the area line (fill.inset rings). */
function leftoverContact(fill) {
  const rings = [];
  for (const pc of Array.isArray(fill.inset) ? fill.inset : []) { if (pc && pc.outer) rings.push(pc.outer); for (const h of (pc && pc.holes) || []) rings.push(h); }
  if (!rings.length) return 0;
  let total = 0;
  for (const b of fill.support || []) {
    if (!b || (b.kind !== "leftover" && b.kind !== "remainder")) continue;
    const r = ringOf(b.outer);
    if (!r) continue;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 0.01) continue;
      const on = rings.some((q) => q.some((p, k) => { const e = q[(k + 1) % q.length]; return projectOnSegment(a, p, e).dist < 0.005 && projectOnSegment(c, p, e).dist < 0.005; }));
      if (on) total += L;
    }
  }
  return total;
}

/** Plan 3.12 "Area closure". */
function closureRows(state, fill, nrsf, gsf) {
  const corridor = Array.isArray(fill.corridor) ? fill.corridor : [];
  const counted = corridor.slice();
  const take = (rings) => {
    let sum = 0;
    for (const ring of rings) {
      if (!ring || ring.length < 3) continue;
      const a = absArea(ring);
      sum += Math.max(0, a - overlapWith(ring, counted));
      counted.push({ outer: ring, holes: [] });
    }
    return sum;
  };
  const corridorSf = multiArea(corridor);
  const core = coreRing(fill);
  const coreSf = take(core ? [core] : []);
  const stairsSf = take(stairsOf(fill).map((s) => ringOf(s.outer)));
  const elevSf = take(elevatorsOf(fill).map((s) => ringOf(s.outer)));
  const supportSf = take((fill.support || []).map((s) => ringOf(s && s.outer)));
  // draw plan 2.2: a drawn layout adds its open area (the unit zone no unit covers) and gives its exterior allowance
  const openSf = fill.layout && isNum(fill.openArea) ? fill.openArea : 0;
  const strip = gsf - (nrsf + corridorSf + coreSf + stairsSf + elevSf + supportSf + openSf);
  if (fill.layout && isNum(fill.allowance)) {
    return {
      gsf: r1(gsf), nrsf: r1(nrsf), corridor: r1(corridorSf), core: r1(coreSf), stairs: r1(stairsSf), elevators: r1(elevSf), support: r1(supportSf), open: r1(openSf),
      strip: r1(strip), expected: r1(fill.allowance), diff: r1(strip - fill.allowance), ok: Math.abs(strip - fill.allowance) <= 1,
    };
  }
  const ext = isNum(state.extWall) ? state.extWall : 1.0;
  // a run the fill left unfilled (slots: 0) is a remainder out to the plate edge: its exterior strip is inside it
  const runs = (Array.isArray(fill.runs) ? fill.runs : []).filter((r) => r.slots !== 0);
  // a wrap corner covers legs[0] + legs[1] of area line (2 × e when the legs are equal; a deep corner can differ)
  const legs = Array.isArray(fill.corners) ? fill.corners.reduce((s, c) => s + (Array.isArray(c.legs) && c.legs.length === 2 && c.legs.every(isNum) ? c.legs[0] + c.legs[1] : 2 * (isNum(c.e) ? c.e : 0)), 0) : 0;
  // Corner squares: the strip along the runs and legs is measured on the area line, so each plate corner that no block
  // covers adds one ext × ext square (convex corner) or takes one away (reflex corner). A point tower has four convex ones.
  const blocks = [core, ...stairsOf(fill).map((s) => ringOf(s.outer)), ...elevatorsOf(fill).map((s) => ringOf(s.outer)),
    ...(fill.support || []).map((s) => ringOf(s && s.outer))].filter((r) => r && r.length >= 3);
  const cornerSq = runs.length ? cornerSquares(fill.plate, blocks) : 0;
  // leftover pieces that stop at the area line (a hotel corner with no wrap unit) leave the strip along them open too
  const contact = runs.length ? leftoverContact(fill) : 0;
  // locked units sit on reserved stretches (no run): their exterior strip is still the allowance
  const lockLen = (Array.isArray(fill.units) ? fill.units : []).reduce((s, u) => s + (u && u.locked && isNum(u.facadeLen) ? u.facadeLen : 0), 0);
  const expected = ext * (runs.reduce((s, r) => s + (isNum(r.length) ? r.length : 0), 0) + legs + contact + lockLen) + ext * ext * cornerSq;
  return {
    gsf: r1(gsf), nrsf: r1(nrsf), corridor: r1(corridorSf), core: r1(coreSf), stairs: r1(stairsSf), elevators: r1(elevSf), support: r1(supportSf), open: 0,
    strip: r1(strip), expected: r1(expected), diff: r1(strip - expected), ok: runs.length === 0 || Math.abs(strip - expected) <= 1,
  };
}

function levelRow(state, group, fill, hotel) {
  const units = Array.isArray(fill.units) ? fill.units : [];
  const types = mixTypes(state);
  const nrsfExact = units.reduce((s, u) => s + unitArea(u), 0);
  const gsfExact = multiArea(fill.plate);
  const nrsf = r1(nrsfExact), gsf = r1(gsfExact);
  const byType = {};
  for (const u of units) byType[u.type] = (byType[u.type] || 0) + 1;
  const bayOf = new Map(types.map((t) => [t.id, isNum(t.bays) ? t.bays : 1]));
  const bays = units.reduce((s, u) => s + (isNum(u.bays) ? u.bays : bayOf.get(u.type) || 1), 0);
  const exposures = { N: 0, E: 0, S: 0, W: 0 };
  for (const u of units) for (const e of new Set(u.exposures || [])) if (e in exposures) exposures[e]++;
  const width = clearWidth(state);
  const cn = corridorNumbers(state, fill, width, hotel);
  const t = targetsFor(state, fill, hotel);
  let mix = null;
  if (t.counts) {
    const scored = hotel ? units.filter((u) => !u.accessible) : units;
    const s = scoreMix(scored, t.counts, types.filter((ty) => ty.id in t.counts));
    // average unit area per type on this level (the page mix table shows it)
    const sum = {}, n = {};
    for (const u of units) { sum[u.type] = (sum[u.type] || 0) + unitArea(u); n[u.type] = (n[u.type] || 0) + 1; }
    mix = { targets: t.counts, byType: s.byType.map((r) => ({ ...r, avgArea: n[r.type] ? r1(sum[r.type] / n[r.type]) : 0 })), misses: s.misses };
  }
  const support = supportRows(fill);
  const closure = closureRows(state, fill, nrsfExact, gsfExact);
  const rng = unitsInRange(state, units);
  const stairsArr = stairsOf(fill);
  return {
    group: group.id,
    units: units.length, keys: units.length, bays,
    byType, mix,
    nrsf, gsf, efficiency: gsf > 0 ? r4(nrsfExact / gsfExact) : 0,
    avgUnitArea: units.length ? r1(nrsfExact / units.length) : 0,
    inRange: rng.inRange, areaHighCount: rng.areaHighCount, avgArea: rng.avgArea, targetAvgArea: rng.targetAvgArea,
    corners: units.filter((u) => u.corner).length,
    exposures,
    accessible: units.filter((u) => u.accessible).length,
    corridor: { lengthFt: cn.lengthFt, perUnit: cn.lengthFt !== null && units.length ? r1(cn.lengthFt / units.length) : null },
    stairDoors: { count: stairsArr.length, pathFt: cn.stairPathFt, doors: cn.doors, deadEnds: cn.deadEnds, deadEndMax: cn.deadEndMax },
    support,
    closure,
    hotel: hotel ? cn.reach : null,
    shortRuns: fill.layout ? [] : shortRuns(state, fill, hotel),
    dropped: t.dropped,
    layout: !!fill.layout,
    openArea: fill.layout && isNum(fill.openArea) ? r1(fill.openArea) : 0,
  };
}

/** Runs shorter than the smallest usable width of any type at their depth. */
function shortRuns(state, fill, hotel) {
  const out = [];
  const types = mixTypes(state);
  for (const r of Array.isArray(fill.runs) ? fill.runs : []) {
    if (!isNum(r.length)) continue;
    if (!hotel && !isNum(r.depth)) continue;
    const eff = effectiveTypes(types, hotel ? null : r.depth, hotel ? "hotel" : "multifamily").types;
    if (!eff.length) continue;
    const min = Math.min(...eff.map((e) => e.lo));
    if (r.length < min - EPS) out.push({ run: r.id, length: r1(r.length), min: r1(min) });
  }
  return out;
}

/* ------------------------------------------------------------ computeMetrics */

const levelIndices = (levels) => (Array.isArray(levels) ? levels : []).map((l) => (l && typeof l === "object" ? l.index : l)).filter(isNum);

const add = (obj, key, n) => { obj[key] = (obj[key] || 0) + n; };

/**
 * Plan 3.12. → {
 *   mode, caution, floors,
 *   groups: [{ id, label, first, levels, floors, row }],
 *   levels: [{ index, ...row }]           one row per level of every group
 *   (level rows and building also carry inRange, areaHighCount, avgArea, targetAvgArea: see unitsInRange)
 *   building: { units, keys, bays, nrsf, gsf, efficiency, avgUnitArea, corners, exposures, corridorFt,
 *               byType, mix: [{ type, count, share, target, diff, avgArea }], accessible, support },
 *   buildWarnings, massing: { usedAt, currentAt }, warnings }
 */
export function computeMetrics(state, built) {
  need(state && typeof state === "object", "computeMetrics", "state");
  need(built && Array.isArray(built.groups), "computeMetrics", "built.groups");
  const hotel = state.mode === "hotel";
  const types = mixTypes(state);
  const groups = [], levels = [], buildWarnings = [];
  for (const w of Array.isArray(built.warnings) ? built.warnings : []) buildWarnings.push({ ...w });

  const total = { units: 0, bays: 0, inRange: 0, areaHigh: 0, nrsf: 0, gsf: 0, corners: 0, corridorFt: 0, accessible: 0, exposures: { N: 0, E: 0, S: 0, W: 0 }, byType: {}, areaByType: {}, targets: {}, support: 0, floors: 0 };
  for (const g of built.groups) {
    if (!g || !g.fill) continue;
    const idx = levelIndices(g.levels);
    const floors = idx.length || 1;
    const row = levelRow(state, g, g.fill, hotel);
    groups.push({ id: g.id, label: g.label !== undefined ? g.label : null, first: g.first !== undefined ? g.first : idx[0], levels: idx, floors, row });
    for (const i of idx.length ? idx : [1]) levels.push({ index: i, ...row });
    for (const w of Array.isArray(g.fill.warnings) ? g.fill.warnings : []) buildWarnings.push({ ...w, where: w.where && typeof w.where === "object" ? { ...w.where, group: g.id } : { group: g.id } });

    total.floors += floors;
    total.units += row.units * floors; total.bays += row.bays * floors;
    total.inRange += row.inRange * floors; total.areaHigh += row.areaHighCount * floors;
    total.nrsf += row.nrsf * floors; total.gsf += row.gsf * floors;
    total.corners += row.corners * floors; total.accessible += row.accessible * floors;
    total.corridorFt += (row.corridor.lengthFt || 0) * floors;
    total.support += row.support.areaSf * floors;
    for (const k of Object.keys(total.exposures)) total.exposures[k] += row.exposures[k] * floors;
    for (const u of g.fill.units || []) {
      add(total.byType, u.type, floors);
      add(total.areaByType, u.type, unitArea(u) * floors);
    }
    if (row.mix) for (const k of Object.keys(row.mix.targets)) add(total.targets, k, row.mix.targets[k] * floors);
  }

  const ids = types.map((t) => t.id);
  for (const id of Object.keys(total.byType)) if (!ids.includes(id)) ids.push(id);
  const mixRows = ids.map((id) => {
    const count = total.byType[id] || 0, target = total.targets[id] || 0;
    return { type: id, count, share: total.units ? r4(count / total.units) : 0, target, diff: count - target, avgArea: count ? r1(total.areaByType[id] / count) : 0 };
  });

  const req = requiredAccessible({ ...state, mode: hotel ? "hotel" : "multifamily" }, total.units);
  const accessible = hotel
    ? { required: req.keys, rollIn: req.rollIn, row: req.row, beyond: req.beyond, provided: total.accessible, caution: "Seeds for an editable table. Verify against the adopted code." }
    : { required: req.typeA, row: req.row, provided: total.accessible, caution: "Seeds for an editable table. Verify against the adopted code." };

  const m = {
    mode: hotel ? "hotel" : "multifamily",
    caution: CAUTION,
    floors: total.floors,
    groups, levels,
    building: {
      units: total.units, keys: total.units, bays: total.bays,
      nrsf: r1(total.nrsf), gsf: r1(total.gsf), efficiency: total.gsf > 0 ? r4(total.nrsf / total.gsf) : 0,
      avgUnitArea: total.units ? r1(total.nrsf / total.units) : 0,
      inRange: total.inRange, areaHighCount: total.areaHigh, avgArea: total.units ? r1(total.nrsf / total.units) : 0, targetAvgArea: targetAvgOf(state),
      corners: total.corners, exposures: total.exposures, corridorFt: r1(total.corridorFt),
      byType: total.byType, mix: mixRows, accessible, supportSf: r1(total.support),
    },
    buildWarnings,
    massing: {
      usedAt: built.massingUpdatedAt !== undefined ? built.massingUpdatedAt : null,
      currentAt: built.currentMassingUpdatedAt !== undefined ? built.currentMassingUpdatedAt : null,
    },
  };
  m.warnings = checks(state, m);   // so one list reaches the page, the notes, and the exports
  return m;
}

/* ----------------------------------------------------------------- checks */

const warn = (code, message, where = null, severity = "warn") => ({ code, severity, where, message });

function later(current, used) {
  if (current === null || current === undefined || used === null || used === undefined) return false;
  const a = Date.parse(current), b = Date.parse(used);
  if (Number.isFinite(a) && Number.isFinite(b)) return a > b;
  return String(current) > String(used);
}

/**
 * Plan 3.12 "Flags". → Warning[] { code, severity, where, message }:
 * the build and fill warnings (core-blocks-corridor, type-area-high and the rest), type-does-not-fit, run-too-short,
 * mix-miss, area-closure and stale-massing. De-duplicated by code + where (rework plan 7.3): the page badge count
 * is the length of this list. The optional third argument { massingUpdatedAt } is the
 * massing time now, for stale-massing when the metrics do not carry it.
 */
export function checks(state, metrics, ctx = {}) {
  need(state && metrics && Array.isArray(metrics.groups), "checks", "state and metrics");
  const out = [];
  const pass = Array.isArray(metrics.buildWarnings) ? metrics.buildWarnings : [];
  for (const w of pass) out.push({ ...w, where: w.where ? { ...w.where } : null });
  const has = (code) => pass.some((w) => w.code === code);

  for (const g of metrics.groups) {
    const label = g.label || g.id;
    const row = g.row;
    if (!has("type-does-not-fit")) {
      const seen = new Set();
      for (const d of row.dropped || []) {
        const k = `${d.id}@${d.depth}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(warn("type-does-not-fit", `${d.name || d.id} does not fit a depth of ${round2(d.depth)} ft (${label}): it needs a width of at least ${round2(d.lo)} ft but its area range allows at most ${round2(d.hi)} ft. The type drops out of this fill and the other shares renormalize.`, { group: g.id, type: d.id, depth: d.depth }, "info"));
      }
    }
    if (!has("run-too-short")) {
      for (const r of row.shortRuns || []) out.push(warn("run-too-short", `Run ${r.run} is ${r.length} ft long, shorter than the narrowest unit (${r.min} ft) (${label}). It stays as support. Move a block or edit the mix.`, { group: g.id, run: r.run }));
    }
    if (row.mix && !row.layout) {          // draw plan 4: a drawn layout raises no mix-miss
      for (const id of row.mix.misses) {
        const r = row.mix.byType.find((b) => b.type === id);
        const t = (state.mix && (state.mix[mixKey(state)] || []).find((x) => x.id === id)) || {};
        out.push(warn("mix-miss", `${t.name || id} has ${r.count} placed against a target of ${r.target} (${label}). The level is off by ${Math.abs(r.diff)} units. Edit the shares or the blocks.`, { group: g.id, type: id }, "info"));
      }
    }
    if (row.closure && !row.closure.ok) {
      out.push(warn("area-closure", `The areas of ${label} do not close: the strip left is ${row.closure.strip} sf against ${row.closure.expected} sf for the exterior allowance (difference ${row.closure.diff} sf).`, { group: g.id }));
    }
  }

  const used = metrics.massing ? metrics.massing.usedAt : null;
  const current = ctx && ctx.massingUpdatedAt !== undefined ? ctx.massingUpdatedAt : metrics.massing ? metrics.massing.currentAt : null;
  if (later(current, used)) out.push(warn("stale-massing", "The massing changed after this layout. Check the units against the new plates.", { usedAt: used, currentAt: current }));
  // rework plan 7.3: one list, de-duplicated by code + where (the first one stays); the page badge counts this list
  const seenKey = new Set();
  return out.filter((w) => {
    const k = `${w.code}|${stableJson(w.where)}`;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });
}

function stableJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
}
