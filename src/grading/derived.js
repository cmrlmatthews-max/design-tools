/* ==========================================================================
   grading/derived.js — Grading Sketch → grading.derived
   (docs/grading-sketch-technical-plan.md sections 3.12 and 4; project file spec 6.7 once the integrator adds it)

   gradingDerived(state, built, metrics) → { ffe, ground, walls, routes, metrics }
     state    the grading state (plan section 2)
     built    buildGrading(state, ...) result (plan section 4): { grid, surface, buildings, tiers, features, walls, ... }
     metrics  computeMetrics(state, built) result. A row may sit flat (metrics.cutCy) or in a group (metrics.earthwork.cutCy).
              A missing wall, pad, or route row falls back to a figure computed from `built`. cut and fill are required.

   ffe[]      one per tier: id ("<building id>-T<k>"; building id is "massing" or "parking" for those sources), source
              ("standalone" | "massing" | "parking"), tier, outer, ffe, padTop, existingMin, existingMax.
   ground     { spacing, n, points } the proposed grid, same nodes as the existing grid, z to 0.01 ft.
   walls[]    { id, kind, line (the top, [x, y, z]), heightMax, heightAvg, length, auto, accepted }.
   routes[]   { id, kind, line ([x, y, z] every 5 ft), maxSlope, maxCross }.
   metrics    { cutCy, fillCy, netCy, balance, bulkedNetCy, wallLength, wallHeightMax, wallHeightAvg, padArea,
                disturbedArea, steepestRoute }

   The shared helpers below (groundData, wallProfile, routeStats, tierList, padPolygons, ...) are also used by
   exports.js and sketchup.js, so the three writers read the build the same way.

   Rounding: coordinates 0.001 ft, elevations 0.01 ft, volumes 0.1 cy, areas 0.1 sf, ratios 0.001, slopes 0.0001.
   Pure: no DOM, no input mutation, no hidden state.
   ========================================================================== */

export const WALL_STEP = 1;             // ft between wall height samples (plan 3.6)
export const WALL_PROBE = 0.01;         // ft each side of the wall line
export const ROUTE_STEP = 5;            // ft between route points in derived

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
export const r2 = (v) => { const r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; };
export const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
export const r4 = (v) => { const r = Math.round(v * 10000) / 10000; return r === 0 ? 0 : r; };
const need = (v, name) => { if (v === undefined || v === null) throw new Error(`gradingDerived: missing input "${name}".`); return v; };

/** The first number found at any of the dotted paths ("cutCy", "earthwork.cutCy"), else null. */
export function pick(obj, ...paths) {
  for (const p of paths) {
    let v = obj;
    for (const k of p.split(".")) { if (v === null || v === undefined || typeof v !== "object") { v = undefined; break; } v = v[k]; }
    if (isNum(v)) return v;
  }
  return null;
}

/* ---------------- rings and polygons ---------------- */

const isPt = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const isRing = (v) => Array.isArray(v) && v.length >= 3 && v.every(isPt);

/** A ring from a ring, a polygon { outer }, or a list of rings (the first one). Else null. */
export function ringOf(v) {
  if (isRing(v)) return v;
  if (v && !Array.isArray(v) && isRing(v.outer)) return v.outer;
  if (Array.isArray(v) && v.length && isRing(v[0])) return v[0];
  return null;
}

/**
 * Polygons [{ outer, holes }] from a pad: one ring, a list of rings (separate polygons), a polygon
 * { outer, holes }, or a list of polygons.
 */
export function padPolygons(pad) {
  if (isRing(pad)) return [{ outer: pad, holes: [] }];
  if (pad && !Array.isArray(pad) && isRing(pad.outer)) return [{ outer: pad.outer, holes: (pad.holes || []).filter(isRing) }];
  if (Array.isArray(pad)) return pad.flatMap((p) => padPolygons(p));
  return [];
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/* ---------------- ground grid ---------------- */

/**
 * The grid of a build as plain arrays.
 * @returns {{ n, spacing, x0, y0, xs: number[], ys: number[], ez: Float64Array, pz: Float64Array }}
 *   ez = existing z, pz = proposed z at every node (row-major from the south).
 *   pz comes from built.proposedZ when it holds n*n numbers, else from built.surface.at at each node.
 */
export function groundData(built) {
  const g = need(need(built, "built").grid, "built.grid");
  const n = g.n, d = g.spacing;
  if (!Number.isInteger(n) || n < 2 || !isNum(d) || !(d > 0)) throw new Error("gradingDerived: built.grid needs n (2 or more) and spacing.");
  const nodes = g.nodes && g.nodes.length >= n * n * 3 ? g.nodes : null;
  const x0 = isNum(g.x0) ? g.x0 : nodes ? nodes[0] : 0;
  const y0 = isNum(g.y0) ? g.y0 : nodes ? nodes[1] : 0;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) { xs.push(x0 + i * d); ys.push(y0 + i * d); }
  const exAt = typeof g.at === "function" ? g.at : typeof built.existingAt === "function" ? built.existingAt : null;
  const at = built.surface && typeof built.surface.at === "function" ? built.surface.at : null;
  const ez = new Float64Array(n * n), pz = new Float64Array(n * n);
  const given = built.proposedZ && built.proposedZ.length >= n * n ? built.proposedZ : null;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    ez[k] = nodes ? nodes[k * 3 + 2] : exAt ? exAt(xs[i], ys[j]) : 0;
    if (given) pz[k] = given[k];
    else if (at) pz[k] = at(xs[i], ys[j]);
    else throw new Error('gradingDerived: missing input "built.surface.at".');
  }
  return { n, spacing: d, x0, y0, xs, ys, ez, pz };
}

/* ---------------- tiers ---------------- */

/** The pad of a tier: `pad` (tierPads) or `pads` (the rings a pad feature takes). */
export function padOf(t) {
  return t && (t.pad !== undefined && t.pad !== null ? t.pad : t.pads);
}

/** The tier records of a build (flat list). */
export function tierList(built) {
  const t = Array.isArray(built && built.tiers) ? built.tiers : [];
  return t.flat().filter((x) => x && typeof x === "object");
}

/** { id, source, buildingId, building } for a tier. See the id rule in the file header. */
export function tierIdentity(t, built) {
  const buildings = Array.isArray(built && built.buildings) ? built.buildings : [];
  const m = typeof t.id === "string" ? /^(.*)-T\d+$/.exec(t.id) : null;
  const buildingId = String(t.buildingId ?? t.building ?? (m ? m[1] : t.id ?? ""));
  const building = buildings.find((b) => b && b.id === buildingId) || null;
  const raw = t.source ?? (building && building.source) ?? "typed";
  const source = raw === "massing" || raw === "parking" ? raw : "standalone";
  const prefix = source === "standalone" ? buildingId : source;
  return { id: `${prefix}-T${t.tier}`, source, buildingId, building };
}

/* ---------------- walls ---------------- */

const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function lineLength(line) { let L = 0; for (let i = 1; i < line.length; i++) L += segLen(line[i - 1], line[i]); return L; }

/**
 * Height samples along a wall (plan 3.6): every 1 ft along every segment, h = |z(p + 0.01 n) − z(p − 0.01 n)|.
 * @returns {{ samples: {x,y,top,bottom,h,seg}[], length, heightMax, heightAvg, iMax }}
 *   top = the higher of the two sides, bottom = the lower. n is the left normal of the segment. seg = the polyline segment index.
 */
export function wallProfile(wall, at) {
  const line = (wall.line || []).filter(isPt);
  const samples = [];
  let length = 0;
  for (let s = 0; s < line.length - 1; s++) {
    const a = line[s], b = line[s + 1], L = segLen(a, b);
    if (!(L > 0)) continue;
    const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, nx = -ty, ny = tx;
    const steps = Math.max(1, Math.ceil(L / WALL_STEP - 1e-9));
    for (let k = s === 0 || !samples.length ? 0 : 1; k <= steps; k++) {
      const u = (k / steps) * L, x = a[0] + tx * u, y = a[1] + ty * u;
      const z1 = at(x + nx * WALL_PROBE, y + ny * WALL_PROBE), z2 = at(x - nx * WALL_PROBE, y - ny * WALL_PROBE);
      samples.push({ x, y, top: Math.max(z1, z2), bottom: Math.min(z1, z2), h: Math.abs(z1 - z2), seg: s });
    }
    length += L;
  }
  // The first and last sample sit on the wall's end points. A probe line that runs through an end point does not
  // "properly cross" the wall, so the daylight can leak around the end. Both ends take the sample 1 ft inside.
  if (samples.length >= 3) {
    const take = (to, from) => { Object.assign(samples[to], { top: samples[from].top, bottom: samples[from].bottom, h: samples[from].h }); };
    take(0, 1); take(samples.length - 1, samples.length - 2);
  }
  let iMax = 0, sum = 0;
  samples.forEach((p, i) => { sum += p.h; if (p.h > samples[iMax].h) iMax = i; });
  return { samples, length, heightMax: samples.length ? samples[iMax].h : 0, heightAvg: samples.length ? sum / samples.length : 0, iMax };
}

/** Douglas-Peucker in 3D: drops points within tol of the line through their neighbours. */
export function simplify3(pts, tol = 0.01) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const a = pts[i], b = pts[j], ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    let worst = -1, wd = tol;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const t = L2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0;
      const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
      if (d > wd) { wd = d; worst = k; }
    }
    if (worst >= 0) { keep[worst] = true; stack.push([i, worst], [worst, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * Everything the writers need about one wall.
 * Uses the numbers on the wall when it carries them (heightMax, heightAvg, length, top); else computes them.
 * @returns {{ id, kind, auto, accepted, line, top: number[][], length, heightMax, heightAvg, profile }}
 *   top = the top line [x, y, z] (simplified); profile = the 1 ft samples (for the DXF text and the SketchUp solid).
 */
export function wallRecord(wall, state, built) {
  const at = built.surface.at;
  const profile = wallProfile(wall, at);
  const kind = typeof wall.kind === "string" ? wall.kind : "drawn";
  const auto = kind === "auto";
  const acc = state && state.autoWalls && Array.isArray(state.autoWalls.accepted) ? state.autoWalls.accepted : [];
  const accepted = !auto ? true : typeof wall.accepted === "boolean" ? wall.accepted : acc.includes(wall.id);
  let top;
  if (Array.isArray(wall.top) && wall.top.length >= 2 && wall.top.every((p) => Array.isArray(p) && p.length >= 3 && p.every(isNum))) top = wall.top.map((p) => [p[0], p[1], p[2]]);
  else top = simplify3(profile.samples.map((p) => [p.x, p.y, p.top]));
  return {
    id: String(wall.id), kind, auto, accepted, line: wall.line,
    top: top.map((p) => [r3(p[0]), r3(p[1]), r2(p[2])]),
    length: isNum(wall.length) ? wall.length : profile.length,
    heightMax: isNum(wall.heightMax) ? wall.heightMax : profile.heightMax,
    heightAvg: isNum(wall.heightAvg) ? wall.heightAvg : profile.heightAvg,
    profile,
  };
}

/** wallRecord for every wall in built.walls. */
export function wallRecords(state, built) {
  return (Array.isArray(built.walls) ? built.walls : []).filter((w) => w && Array.isArray(w.line) && w.line.length >= 2).map((w) => wallRecord(w, state, built));
}

/* ---------------- routes ---------------- */

/** Points every `step` ft along a polyline, ends included: [[x, y, z], …] with z from `at`. */
export function sampleLine(line, step, at) {
  const pts = line.filter(isPt);
  const out = [];
  const push = (x, y) => out.push([x, y, at(x, y)]);
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1], L = segLen(a, b);
    if (!(L > 0)) continue;
    const steps = Math.max(1, Math.ceil(L / step - 1e-9));
    for (let k = s === 0 || !out.length ? 0 : 1; k <= steps; k++) push(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps);
  }
  if (!out.length && pts.length) push(pts[0][0], pts[0][1]);
  return out;
}

/**
 * Slopes of a route by the plan 3.9 rules (used only when the build or the metrics carry no route profile).
 * Running slope at s = |z(s + 5) − z(s)| / 5 (the last 5 ft look back); cross slope = |z(p + 2.5 n) − z(p − 2.5 n)| / 5.
 * @returns {{ maxSlope, maxCross, kind }} kind = "walk" when every sample is a walk, else "ramp".
 */
export function routeStats(line, at, limits) {
  const lim = limits || {};
  const walk = isNum(lim.walk) ? lim.walk : 0.05, cross = isNum(lim.cross) ? lim.cross : 0.0208;
  const pts = line.filter(isPt);
  const L = lineLength(pts);
  const pos = (s) => {                       // point at station s
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = segLen(pts[i - 1], pts[i]);
      if (acc + l >= s - 1e-9 && l > 0) { const u = Math.min(1, Math.max(0, (s - acc) / l)); return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u, tx: (pts[i][0] - pts[i - 1][0]) / l, ty: (pts[i][1] - pts[i - 1][1]) / l }; }
      acc += l;
    }
    const a = pts[pts.length - 2] || pts[0], b = pts[pts.length - 1], l = segLen(a, b) || 1;
    return { x: b[0], y: b[1], tx: (b[0] - a[0]) / l, ty: (b[1] - a[1]) / l };
  };
  let maxSlope = 0, maxCross = 0, allWalk = true;
  const N = Math.max(1, Math.floor(L));
  for (let k = 0; k <= N; k++) {
    const s = Math.min(k, L), p = pos(s);
    const s2 = s + 5 <= L + 1e-9 ? s + 5 : Math.max(0, s - 5), q = pos(s2);
    const run = Math.abs(at(q.x, q.y) - at(p.x, p.y)) / Math.max(1e-9, Math.abs(s2 - s));
    const nx = -p.ty, ny = p.tx;
    const cr = Math.abs(at(p.x + 2.5 * nx, p.y + 2.5 * ny) - at(p.x - 2.5 * nx, p.y - 2.5 * ny)) / 5;
    if (run > maxSlope) maxSlope = run;
    if (cr > maxCross) maxCross = cr;
    if (run > walk + 1e-9 || cr > cross + 1e-9) allWalk = false;
  }
  return { maxSlope, maxCross, kind: allWalk ? "walk" : "ramp" };
}

/** The route rows of a build: [{ id, name, line (the drawn line), points ([x,y,z] every 5 ft), kind, maxSlope, maxCross }]. */
export function routeRecords(state, built, metrics) {
  const routes = Array.isArray(state && state.routes) ? state.routes : [];
  const at = built.surface.at;
  const rows = (v) => (Array.isArray(v) ? v : []);
  const given = (id) => rows(built.routes).find((r) => r && r.id === id) || rows(metrics && metrics.routes).find((r) => r && r.id === id) || null;
  return routes.filter((r) => r && Array.isArray(r.line) && r.line.filter(isPt).length >= 2).map((r) => {
    const g = given(r.id);
    const st = g && isNum(g.maxSlope) && isNum(g.maxCross) ? g : routeStats(r.line, at, state.limits);
    const kind = g && (g.kind === "walk" || g.kind === "ramp") ? g.kind : st.kind || "ramp";
    return { id: String(r.id), name: r.name ? String(r.name) : String(r.id), line: r.line, points: sampleLine(r.line, ROUTE_STEP, at), kind, maxSlope: st.maxSlope, maxCross: st.maxCross };
  });
}

/* ---------------- the writer ---------------- */

/**
 * The metrics block of derived (and the notes). The metrics rows win; a missing wall, pad, or route row falls back to the build.
 * wr = wallRecords(...), rr = routeRecords(...).
 */
export function metricsSummary(state, built, metrics, wr, rr) {
  const cut = pick(metrics, "cutCy", "earthwork.cutCy"), fill = pick(metrics, "fillCy", "earthwork.fillCy");
  if (cut === null) throw new Error('gradingDerived: missing input "metrics.cutCy".');
  if (fill === null) throw new Error('gradingDerived: missing input "metrics.fillCy".');
  const bulking = isNum(state.earthwork && state.earthwork.bulking) ? state.earthwork.bulking : 1;
  const net = pick(metrics, "netCy", "earthwork.netCy");
  const bal = pick(metrics, "balance", "earthwork.balance");
  const bulked = pick(metrics, "bulkedNetCy", "earthwork.bulkedNetCy");
  const wLen = wr.reduce((s, w) => s + w.length, 0);
  const wAvg = wLen > 0 ? wr.reduce((s, w) => s + w.heightAvg * w.length, 0) / wLen : 0;
  const padFallback = tierList(built).reduce((s, t) => s + padPolygons(padOf(t)).reduce((a, p) => a + Math.abs(ringArea(p.outer)) - p.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0), 0);
  const hi = Math.max(cut, fill);

  return {
    cutCy: r1(cut),
    fillCy: r1(fill),
    netCy: r1(net !== null ? net : fill - cut),
    balance: r3(bal !== null ? bal : hi > 0 ? Math.min(cut, fill) / hi : 1),
    bulkedNetCy: r1(bulked !== null ? bulked : fill - cut * bulking),
    wallLength: r1(pick(metrics, "wallLength", "walls.length", "walls.totalLength") ?? wLen),
    wallHeightMax: r2(pick(metrics, "wallHeightMax", "walls.heightMax") ?? wr.reduce((m, w) => Math.max(m, w.heightMax), 0)),
    wallHeightAvg: r2(pick(metrics, "wallHeightAvg", "walls.heightAvg") ?? wAvg),
    padArea: r1(pick(metrics, "padArea") ?? padFallback),
    disturbedArea: r1(pick(metrics, "disturbedArea", "earthwork.disturbedArea") ?? 0),
    steepestRoute: r4(pick(metrics, "steepestRoute", "routes.steepestRunning") ?? rr.reduce((m, r) => Math.max(m, r.maxSlope), 0)),
  };
}

export function gradingDerived(state, built, metrics) {
  need(state, "state"); need(built, "built"); need(metrics, "metrics");
  const gd = groundData(built);

  const ffe = tierList(built).map((t) => {
    const idn = tierIdentity(t, built);
    const outer = ringOf(t.outer) || ringOf(padOf(t)) || [];
    return {
      id: idn.id, source: idn.source, tier: t.tier,
      outer: outer.map((p) => [r3(p[0]), r3(p[1])]),
      ffe: r2(t.ffe), padTop: r2(t.padTop), existingMin: r2(t.existingMin), existingMax: r2(t.existingMax),
    };
  });

  const points = [];
  for (let j = 0; j < gd.n; j++) for (let i = 0; i < gd.n; i++) points.push([r3(gd.xs[i]), r3(gd.ys[j]), r2(gd.pz[j * gd.n + i])]);

  const wr = wallRecords(state, built);
  const walls = wr.map((w) => ({
    id: w.id, kind: w.kind, line: w.top, heightMax: r2(w.heightMax), heightAvg: r2(w.heightAvg), length: r1(w.length), auto: w.auto, accepted: w.accepted,
  }));

  const rr = routeRecords(state, built, metrics);
  const routes = rr.map((r) => ({
    id: r.id, kind: r.kind, line: r.points.map((p) => [r3(p[0]), r3(p[1]), r2(p[2])]), maxSlope: r4(r.maxSlope), maxCross: r4(r.maxCross),
  }));

  return {
    ffe,
    ground: { spacing: gd.spacing, n: gd.n, points },
    walls,
    routes,
    metrics: metricsSummary(state, built, metrics, wr, rr),
  };
}
