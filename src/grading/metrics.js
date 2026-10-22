/* ==========================================================================
   metrics.js — every row of plan 3.11 and the warning list (Grading Sketch)

   Contract: docs/grading-sketch-technical-plan.md sections 3.7, 3.11 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs.

   Caution: these are design checks against editable values, not a code
   review and not a grading plan. The tool never writes "compliant". Walls,
   drive grades, lot grades, and route slopes all need the civil engineer.

   Reads `built` (the buildGrading result): grid, existingAt, surface.at,
   tiers, walls, features, conflicts, warnings, and `quality` ("draft" runs
   the earthwork at k = 1, as plan section 6 asks while a handle moves).

   Rule choices where the plan leaves room:
   - Tiers group into buildings by the id "<building>-T<k>", in tier order.
   - A tier's corners are the vertices of its `outer` ring(s). `above` =
     ffe - existingAt(corner).
   - Exposed foundation and cut face (plan 3.7): along every pad edge, every
     1 ft and at both ends, take the point 0.01 ft outside. If it belongs to any pad it is
     skipped (that edge touches another pad). Otherwise exposed = padTop -
     proposedAt, cutFace = proposedAt - padTop. Each tier keeps its maximum,
     never below 0.
   - A wall that already holds heightMax, heightAvg, and length keeps them.
     Otherwise they come from plan 3.6 (about every 1 ft at mid-stretch,
     0.01 ft each side of the line). Totals count every wall, accepted or not, and byKind splits
     drawn, pad-step, and auto.
   - wallHeightAvg is the length-weighted mean of the wall averages.
   - steepestRoute is the steepest running slope over all routes (0 when
     there are none); `routes` holds one row each.
   - outside-site: a pad, drive, or lot vertex outside the property ring.
     property.mode "site" uses the grid square.
   - slope-conflict points group into 20 ft squares: one warning each, at
     most 8.
   - Warnings are { code, severity, where, message }; where is { x, y, ... }
     or null. Build warnings (tower-no-levels and the like) pass through
     metrics.buildWarnings, as the Facade Studio does.
   - Volumes round to 0.1 cy, heights and steps to 0.01 ft, corners to 0.001.
   ========================================================================== */

import { earthwork } from "./earthwork.js";
import { routeProfile } from "./routes.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10 + 0;
const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;

const EPS = 1e-9;
const KINDS = ["drawn", "pad-step", "auto"];
const DEFAULT_LIMITS = { walk: 0.05, ramp: 0.0833, cross: 0.0208, rampRise: 2.5, wallFlag: 4, lotMin: 0.01, lotMax: 0.05, driveMax: 0.10 };

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* -------------------------------------------------------------- geometry */

const isPair = (v) => Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1]);

/** A ring, or a list of rings, as a list of rings. */
function rings(v) {
  if (!Array.isArray(v) || !v.length) return [];
  if (isPair(v[0])) return [v];
  return v.filter((r) => Array.isArray(r) && r.length >= 3 && isPair(r[0]));
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  return a / 2;
}

function inRing(x, y, ring, tol = 1e-6) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    // on the edge counts as inside
    const cr = (xb - xa) * (y - ya) - (yb - ya) * (x - xa);
    const len = Math.hypot(xb - xa, yb - ya);
    if (len > 0 && Math.abs(cr) / len <= tol && x >= Math.min(xa, xb) - tol && x <= Math.max(xa, xb) + tol && y >= Math.min(ya, yb) - tol && y <= Math.max(ya, yb) + tol) return true;
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

const inAny = (x, y, ringList) => ringList.some((r) => inRing(x, y, r));

/* ------------------------------------------------------------------ tiers */

function parseTierId(id) {
  const m = /^(.*)-T(\d+)$/.exec(String(id));
  return m ? { building: m[1], k: Number(m[2]) } : { building: String(id), k: 1 };
}

/** Plan 3.7, per tier: corner heights above the existing ground, exposed foundation, cut face. */
function tierRows(built) {
  const tiers = Array.isArray(built.tiers) ? built.tiers : [];
  const padRings = tiers.map((t) => rings(t && t.pad));
  const allPads = padRings.flat();
  const at = built.surface.at, exAt = built.existingAt;

  const rows = tiers.map((t, idx) => {
    const { building, k } = parseTierId(t.id);
    const corners = [];
    for (const ring of rings(t.outer)) for (const [x, y] of ring) corners.push({ x: r3(x), y: r3(y), existing: r2(exAt(x, y)), above: r3(t.ffe - exAt(x, y)) });
    let exposed = 0, cutFace = 0;
    for (const ring of padRings[idx]) {
      const ccw = signedArea(ring) > 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const nx = (ccw ? dy : -dy) / len, ny = (ccw ? -dx : dx) / len;   // outward
        const count = Math.max(1, Math.ceil(len / 1 - 1e-9));
        for (let c = 0; c <= count; c++) {
          const f = c / count;   // both ends included: the worst exposure of a sloping edge sits at its end
          const x = a[0] + dx * f + nx * 0.01, y = a[1] + dy * f + ny * 0.01;
          if (inAny(x, y, allPads)) continue;
          const diff = t.padTop - at(x, y);
          if (diff > exposed) exposed = diff;
          if (-diff > cutFace) cutFace = -diff;
        }
      }
    }
    const above = corners.map((c) => c.above);
    return {
      id: t.id, building, tier: k, ffe: t.ffe, padTop: t.padTop,
      existingMin: isNum(t.existingMin) ? t.existingMin : null, existingMax: isNum(t.existingMax) ? t.existingMax : null,
      step: null, corners,
      cornerMin: above.length ? Math.min(...above) : null, cornerMax: above.length ? Math.max(...above) : null,
      exposed: r2(exposed), cutFace: r2(cutFace),
    };
  });

  // steps between adjacent tiers of one building
  const steps = [];
  const byBuilding = new Map();
  for (const r of rows) { if (!byBuilding.has(r.building)) byBuilding.set(r.building, []); byBuilding.get(r.building).push(r); }
  for (const list of byBuilding.values()) {
    list.sort((p, q) => p.tier - q.tier);
    for (let i = 0; i + 1 < list.length; i++) {
      const step = r2(Math.abs(list[i + 1].ffe - list[i].ffe));
      list[i].step = step;
      steps.push({ from: list[i].id, to: list[i + 1].id, step });
    }
  }
  const padArea = r1(padRings.flat().reduce((s, ring) => s + Math.abs(signedArea(ring)), 0));
  return { rows, steps, padArea, padRings };
}

/* ------------------------------------------------------------------ walls */

/** Plan 3.6 fallback for a wall that arrives without its stats. */
function wallStatsFallback(wall, at) {
  const line = (wall.line || []).map((p) => [p[0], p[1]]);
  let length = 0, sum = 0, count = 0, max = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len, ny = dx / len;
    const steps = Math.max(1, Math.ceil(len / 1 - 1e-9));
    for (let c = 0; c < steps; c++) {
      const f = (c + 0.5) / steps;   // mid-stretch samples: a wall end that meets a corner cone would drag the average
      const x = a[0] + dx * f, y = a[1] + dy * f;
      const h = Math.abs(at(x + 0.01 * nx, y + 0.01 * ny) - at(x - 0.01 * nx, y - 0.01 * ny));
      if (h > max) max = h;
      sum += h; count++;
    }
    length += len;
  }
  return { heightMax: max, heightAvg: count ? sum / count : 0, length };
}

function wallRows(built, limits) {
  const list = Array.isArray(built.walls) ? built.walls : [];
  const rows = list.map((w) => {
    const have = isNum(w.heightMax) && isNum(w.heightAvg) && isNum(w.length);
    const s = have ? w : wallStatsFallback(w, built.surface.at);
    const kind = KINDS.includes(w.kind) ? w.kind : "drawn";
    const first = Array.isArray(w.line) && w.line[0] ? w.line[0] : [0, 0];
    return {
      id: w.id, kind, heightMax: r2(s.heightMax), heightAvg: r2(s.heightAvg), length: r1(s.length),
      auto: kind === "auto", accepted: w.accepted !== false, flagged: s.heightMax > limits.wallFlag + EPS,
      where: { x: r3(first[0]), y: r3(first[1]) },
    };
  });
  const byKind = {};
  for (const k of KINDS) byKind[k] = { count: 0, length: 0 };
  let length = 0, weighted = 0, max = 0;
  for (const r of rows) {
    byKind[r.kind].count++;
    byKind[r.kind].length += r.length;
    length += r.length; weighted += r.heightAvg * r.length;
    if (r.heightMax > max) max = r.heightMax;
  }
  for (const k of KINDS) byKind[k].length = r1(byKind[k].length);
  return { count: rows.length, length: r1(length), heightMax: r2(max), heightAvg: length > 0 ? r2(weighted / length) : 0, byKind, list: rows };
}

/* ------------------------------------------------------------ site extent */

function propertyRing(state, built) {
  const p = state && state.property;
  if (p && p.mode === "drawn" && Array.isArray(p.ring) && p.ring.length >= 3) return p.ring;
  const { spacing: d, n, x0, y0 } = built.grid;
  const x1 = x0 + (n - 1) * d, y1 = y0 + (n - 1) * d;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function outsideSite(state, built, padRingsByTier) {
  const ring = propertyRing(state, built);
  const out = [];
  const test = (kind, id, ringList) => {
    for (const r of ringList) {
      const bad = r.find((p) => !inRing(p[0], p[1], ring, 1e-6));
      if (bad) { out.push({ kind, id, x: r3(bad[0]), y: r3(bad[1]) }); return; }
    }
  };
  (Array.isArray(built.tiers) ? built.tiers : []).forEach((t, i) => test("pad", t.id, padRingsByTier[i]));
  const feats = built.features;
  const fl = Array.isArray(feats) ? feats : feats && typeof feats === "object" ? Object.values(feats).flat() : [];
  for (const f of fl) if (f && f.ring) test(f.kind || "feature", f.id, rings(f.ring));
  return out;
}

/* --------------------------------------------------------------- metrics */

/** Plan 3.11. → every row of the table, as plain data (see the header for the rules).
    { cutCy, fillCy, netCy, bulkedNetCy, balance, disturbedArea, cellsSampled, padArea,
      tiers, steps, walls, wallLength, wallHeightMax, wallHeightAvg,
      routes, steepestRoute, drives, lots, slopeConflicts, outsideSite, buildWarnings, limits, maxStep, warnings } */
export function computeMetrics(state, built) {
  need(state && typeof state === "object", "computeMetrics", "state");
  need(built && built.grid && built.surface && typeof built.surface.at === "function" && typeof built.existingAt === "function", "computeMetrics", "built");
  const limits = { ...DEFAULT_LIMITS, ...(state.limits || {}) };
  const ew = state.earthwork || {};
  const k = built.quality === "draft" ? 1 : isNum(ew.subdivide) ? ew.subdivide : 4;
  const ewk = earthwork(built, { subdivide: k, bulking: isNum(ew.bulking) ? ew.bulking : 1 });

  const t = tierRows(built);
  const walls = wallRows(built, limits);

  const routes = (Array.isArray(state.routes) ? state.routes : []).filter((r) => r && Array.isArray(r.line) && r.line.length >= 2).map((r) => {
    const p = routeProfile(r, built.surface.at, limits);
    return { id: r.id, name: r.name || null, kind: p.kind, maxSlope: p.maxSlope, maxCross: p.maxCross, warnings: p.warnings };
  });
  const steepestRoute = routes.reduce((m, r) => Math.max(m, r.maxSlope), 0);

  const drives = (Array.isArray(state.drives) ? state.drives : []).map((d) => ({ id: d.id, slopePct: isNum(d.slope) ? d.slope : 0, crossPct: isNum(d.cross) ? d.cross : 0, where: d.line && d.line[0] ? { x: r3(d.line[0][0]), y: r3(d.line[0][1]) } : null }));
  const lots = (Array.isArray(state.lots) ? state.lots : []).map((l) => {
    const pts = rings(l.ring)[0] || [];
    const c = l.anchor && isPair(l.anchor) ? l.anchor : pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : null;
    return { id: l.id, slopePct: isNum(l.slope) ? l.slope : 0, crossPct: isNum(l.cross) ? l.cross : 0, where: c ? { x: r3(c[0]), y: r3(c[1]) } : null };
  });

  const conflicts = Array.isArray(built.conflicts) ? built.conflicts : built.surface && Array.isArray(built.surface.conflicts) ? built.surface.conflicts : [];

  const m = {
    cutCy: ewk.cutCy, fillCy: ewk.fillCy, netCy: ewk.netCy, bulkedNetCy: ewk.bulkedNetCy, balance: ewk.balance,
    disturbedArea: ewk.disturbedArea, cellsSampled: ewk.cellsSampled, subdivide: k,
    padArea: t.padArea,
    tiers: t.rows, steps: t.steps,
    walls, wallLength: walls.length, wallHeightMax: walls.heightMax, wallHeightAvg: walls.heightAvg,
    routes, steepestRoute: r4(steepestRoute),
    drives, lots,
    slopeConflicts: conflicts.filter((c) => c && isNum(c.x) && isNum(c.y)).map((c) => ({ x: r3(c.x), y: r3(c.y) })),
    outsideSite: outsideSite(state, built, t.padRings),
    buildWarnings: Array.isArray(built.warnings) ? built.warnings.map((w) => ({ ...w })) : [],
    limits, maxStep: isNum(state.maxStep) ? state.maxStep : null,
  };
  m.warnings = checks(state, m);   // so one list reaches the page, the notes, and the exports
  return m;
}

/* ----------------------------------------------------------------- checks */

const warn = (code, message, where = null, severity = "warn") => ({ code, severity, where, message });

/** Plan 3.11. → Warning[] { code, severity, where, message }:
    slope-conflict, wall-height, step, lot-slope, drive-slope, ramp-landing, route-fail, outside-site,
    plus the build warnings (tower-no-levels and the like). */
export function checks(state, metrics) {
  need(state && metrics && isNum(metrics.cutCy), "checks", "state and metrics");
  const limits = { ...DEFAULT_LIMITS, ...(metrics.limits || {}), ...(state.limits || {}) };
  const maxStep = isNum(state.maxStep) ? state.maxStep : isNum(metrics.maxStep) ? metrics.maxStep : null;
  const out = [];

  // slope conflicts: one warning per 20 ft square, at most 8
  const buckets = new Map();
  for (const c of metrics.slopeConflicts || []) {
    const key = `${Math.floor(c.x / 20)},${Math.floor(c.y / 20)}`;
    const b = buckets.get(key) || { sx: 0, sy: 0, n: 0 };
    b.sx += c.x; b.sy += c.y; b.n++;
    buckets.set(key, b);
  }
  let shown = 0;
  for (const b of buckets.values()) {
    if (shown++ >= 8) break;
    const x = r1(b.sx / b.n), y = r1(b.sy / b.n);
    out.push(warn("slope-conflict", `Two features need slopes that cannot meet near (${x}, ${y}). The proposed ground takes the midpoint. Add a wall or more distance between the features.`, { x, y }));
  }

  const walls = metrics.walls && Array.isArray(metrics.walls.list) ? metrics.walls.list : [];
  for (const w of walls) {
    if (w.heightMax > limits.wallFlag + EPS) {
      out.push(warn("wall-height", `Wall ${w.id} is up to ${r2(w.heightMax)} ft tall, above the ${limits.wallFlag} ft flag. Walls over about 4 ft often need an engineered design, a permit, and a guard. Verify every wall with the civil and structural engineers.`, { ...w.where, wall: w.id }));
    }
  }

  if (maxStep != null) {
    for (const s of metrics.steps || []) {
      if (s.step > maxStep + 0.005) out.push(warn("step", `The step from ${s.from} to ${s.to} is ${r2(s.step)} ft, above the ${maxStep} ft maximum between tiers. Add a tier or a wall, and verify the step with the civil engineer.`, { from: s.from, to: s.to }));
    }
  }

  for (const l of metrics.lots || []) {
    const s = Math.abs(l.slopePct) / 100;
    if (s < limits.lotMin - EPS) out.push(warn("lot-slope", `Lot ${l.id} slopes ${r2(Math.abs(l.slopePct))} percent, below the ${r2(limits.lotMin * 100)} percent minimum. Lot grades are design values for a sketch: verify with the civil engineer.`, l.where ? { ...l.where, lot: l.id } : { lot: l.id }));
    else if (s > limits.lotMax + EPS) out.push(warn("lot-slope", `Lot ${l.id} slopes ${r2(Math.abs(l.slopePct))} percent, above the ${r2(limits.lotMax * 100)} percent maximum. Lot grades are design values for a sketch: verify with the civil engineer.`, l.where ? { ...l.where, lot: l.id } : { lot: l.id }));
  }
  for (const d of metrics.drives || []) {
    const s = Math.abs(d.slopePct) / 100;
    if (s > limits.driveMax + EPS) out.push(warn("drive-slope", `Drive ${d.id} slopes ${r2(Math.abs(d.slopePct))} percent, above the ${r2(limits.driveMax * 100)} percent check value. The fire marshal and the local code set fire access grades: verify with the civil engineer.`, d.where ? { ...d.where, drive: d.id } : { drive: d.id }));
  }

  for (const r of metrics.routes || []) for (const w of r.warnings || []) out.push({ ...w, where: w.where ? { ...w.where } : null });

  for (const o of metrics.outsideSite || []) {
    out.push(warn("outside-site", `${o.kind === "pad" ? "Pad" : o.kind === "drive" ? "Drive" : o.kind === "lot" ? "Lot" : "Feature"} ${o.id} reaches past the property line near (${o.x}, ${o.y}). Move it inside or adjust the property line.`, { x: o.x, y: o.y }));
  }

  for (const w of metrics.buildWarnings || []) out.push({ ...w });
  return out;
}
