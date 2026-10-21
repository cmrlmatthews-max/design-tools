/* ==========================================================================
   parking/derived.js — Parking Deck Generator → parking.derived (docs/project-file-spec.md 6.4 + plan section 7)

   parkingDerived(state, built, metrics) → { levels, metrics }
     state    the parking state (docs/parking-deck-technical-plan.md section 2)
     built    layout(state) (plan section 4): { frame, levels[{ index, z, ftf, plate, stalls, aisles, … }], bays, strip, cores, warnings }
              Stall kinds are final (accessible, van, ev set; stalls lost to cuts and access aisles already removed).
     metrics  computeMetrics rows (a number, or an object with .total / .value). A missing row falls back to a
              figure computed from `built`. Optional parts, read when present:
                metrics.ramps        rampsFor(state, built) rows ({ id, level, slope, outer3d, … })     (else built.ramps)
                metrics.columnPoints columnsFor(state, built).points, layout frame                       (else built.columns, else computed from the bays)
                metrics.clearHeights clearHeights(state) rows ({ level, clear })                         (else ftf - structureDepth)

   Every ring goes from the layout frame to the local (massing) frame through built.frame.toLocal, then is cleaned
   (outer counter-clockwise, hole clockwise, no repeated last point).

   localMapper(built) → (point) => [x, y]        the layout → local map, shared with sketchup.js and exports.js
   coreRings(state, built) → [{ id, kind, outer }]   cores in the local frame (shared)

   Pure: no DOM, no Clipper. Units: feet. Plan (x, y): x = east, y = north.
   ========================================================================== */

import { cleanRing2, cleanRing3 } from "../shared/sketchup-format.js";

const KINDS = ["standard", "compact", "accessible", "van", "ev"];

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r5 = (v) => Math.round(v * 100000) / 100000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const need = (v, name) => { if (v === undefined || v === null) throw new Error(`parkingDerived: missing input "${name}".`); return v; };
const metricNumber = (v) => {
  if (isNum(v)) return v;
  if (v && typeof v === "object" && !Array.isArray(v)) for (const k of ["total", "value"]) if (isNum(v[k])) return v[k];
  return null;
};

/* ---------- frame map and rings ---------- */

/** The layout → local map of a built result. Identity when the frame has no toLocal. */
export function localMapper(built) {
  const f = built && built.frame;
  if (!f || typeof f.toLocal !== "function") return (p) => [p[0], p[1]];
  return (p) => {
    const q = f.toLocal([p[0], p[1]]);
    return Array.isArray(q) ? [q[0], q[1]] : [q.x, q.y];
  };
}

const mapRing = (ring, map) => (Array.isArray(ring) ? ring.map((p) => map(p)) : []);

/** A MultiPoly in the layout frame (an array of { outer, holes }, or one bare ring) → cleaned MultiPoly in the local frame. */
function localMulti(mp, map) {
  let list = Array.isArray(mp) ? mp : [];
  if (list.length && Array.isArray(list[0]) && typeof list[0][0] === "number") list = [{ outer: list, holes: [] }];
  const out = [];
  for (const pc of list) {
    const outer = cleanRing2(mapRing(pc && pc.outer, map));
    if (!outer) continue;
    const holes = [];
    for (const h of (pc && pc.holes) || []) {
      const c = cleanRing2(mapRing(h, map), { hole: true });
      if (c) holes.push(c);
    }
    out.push({ outer, holes });
  }
  return out;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const multiArea = (mp) => mp.reduce((s, pc) => s + Math.abs(ringArea(pc.outer)) - pc.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);

const rectRing = (x, y, w, d) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];

/* ---------- cores, columns, clear height ---------- */

/** Cores in the local frame: { id, kind, outer }. Source: built.cores, else state.cores (x, y = south-west corner, w along x, d along y). */
export function coreRings(state, built) {
  const map = localMapper(built);
  const src = Array.isArray(built && built.cores) ? built.cores : (state && state.cores) || [];
  const out = [];
  src.forEach((c, i) => {
    if (!c) return;
    let ring = c.outer || c.ring;
    if (!Array.isArray(ring) && isNum(c.x) && isNum(c.y) && isNum(c.w) && isNum(c.d)) ring = rectRing(c.x, c.y, c.w, c.d);
    const outer = cleanRing2(mapRing(ring, map));
    if (outer) out.push({ id: String(c.id || `C${i + 1}`), kind: c.kind === "elevator" ? "elevator" : "stair", outer });
  });
  return out;
}

/** Column points in the layout frame, plan section 3.8. Used only when no column list arrives with `built` or `metrics`. */
function computedColumns(state, built) {
  const W = built && built.frame && built.frame.W;
  const bays = built && built.bays && built.bays.bays;
  if (!isNum(W) || !Array.isArray(bays) || !bays.length) return [];
  const fp = state.footprint || {}, b = state.bays || {}, g = state.grid || {}, r = state.ramp || {};
  const p = isNum(fp.perimeter) ? fp.perimeter : 1;
  const split = r.type === "split" ? (isNum(r.splitLength) ? r.splitLength : 36) + 2 * ((r.transition && r.transition.length) || 10) : null;
  const t = isNum(b.turnZone) ? b.turnZone : split !== null ? split : b.aisle;
  const stallW = b.stallW, n = g.stallsPerModule || 3, col = g.column || 2;
  if (!isNum(t) || !isNum(stallW)) return [];
  const xs = p + t, xe = W - p - t, R = xe - xs;
  if (!(R > 0)) return [];
  const xsList = [];
  if (g.span === "short") {
    const M = col + n * stallW, k = Math.floor(R / M);
    for (let j = 0; j <= k; j++) xsList.push(xs + j * M);
  } else {
    const k = Math.floor(R / (n * stallW));
    for (let j = 0; j <= k; j++) xsList.push(xs + j * n * stallW);
  }
  if (xe - xsList[xsList.length - 1] > 0.5) xsList.push(xe);
  const ys = new Set();
  let top = -Infinity;
  for (const bay of bays) {
    ys.add(r3(bay.y0));
    for (const row of bay.rows || []) top = Math.max(top, row.y1);
    if (g.span === "short" && bay.aisle) { ys.add(r3(bay.aisle.y0)); ys.add(r3(bay.aisle.y1)); }
  }
  if (isFinite(top)) ys.add(r3(top));
  const pts = [];
  for (const y of [...ys].sort((a, c) => a - c)) for (const x of xsList) pts.push([r3(x), y]);
  return pts;
}

function columnPointsOf(state, built, m) {
  const fromList = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.points) ? v.points : null);
  const list = fromList(m.columnPoints) || fromList(built.columns) || fromList(m.columns) || computedColumns(state, built);
  return list.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
}

function clearOf(state, level, m) {
  if (isNum(level.clearHeight)) return level.clearHeight;
  const rows = Array.isArray(m.clearHeights) ? m.clearHeights : [];
  const row = rows.find((c) => c && c.level === level.index);
  if (row && isNum(row.clear)) return row.clear;
  const g = state.grid || {};
  const depth = g.structureDepth && isNum(g.structureDepth[g.span === "short" ? "short" : "long"]) ? g.structureDepth[g.span === "short" ? "short" : "long"] : null;
  return isNum(level.ftf) && depth !== null ? level.ftf - depth : null;
}

/* ---------- ramps ---------- */

function levelRamps(ramps, index, map) {
  const out = [];
  for (const rp of ramps) {
    if (!rp || rp.level !== index || !Array.isArray(rp.outer3d)) continue;
    const pts = rp.outer3d.filter((p) => Array.isArray(p) && p.length >= 3 && p.every(isNum)).map((p) => { const q = map(p); return [q[0], q[1], p[2]]; });
    const outer3d = cleanRing3(pts) || pts.map((p) => p.map(r3));
    if (outer3d.length < 3) continue;
    out.push({ id: String(rp.id), outer3d, slope: r5(isNum(rp.slope) ? rp.slope : 0) });
  }
  return out;
}

/* ---------- the writer ---------- */

export function parkingDerived(state, built, metrics) {
  need(state, "state"); need(built, "built");
  const builtLevels = need(built.levels, "built.levels");
  const m = metrics || {};
  const map = localMapper(built);
  const ramps = Array.isArray(m.ramps) ? m.ramps : Array.isArray(built.ramps) ? built.ramps : [];
  const cores = coreRings(state, built);
  const cols = columnPointsOf(state, built, m).map((p) => { const q = map(p); return [r3(q[0]), r3(q[1])]; });

  const byKind = {};
  let evReady = 0, gross = 0, stallCount = 0;
  const levels = builtLevels.map((l, i) => {
    const index = isNum(l.index) ? l.index : i + 1;
    const plate = localMulti(l.plate, map);
    gross += multiArea(plate);
    const stalls = [];
    for (const s of l.stalls || []) {
      const outer = cleanRing2(mapRing(s && s.outer, map));
      if (!outer) continue;
      const kind = KINDS.includes(s.kind) ? s.kind : "standard";
      const row = { id: String(s.id), outer, kind };
      if (s.evReady) { row.evReady = true; evReady++; }
      stalls.push(row);
      byKind[kind] = (byKind[kind] || 0) + 1;
    }
    stallCount += stalls.length;
    const out = {
      index, z: r3(isNum(l.z) ? l.z : 0), plate, stalls,
      aisles: localMulti(l.aisles, map),
      ramps: levelRamps(ramps, index, map),
      columns: cols.map((p) => p.slice()),
      cores: cores.map((c) => ({ id: c.id, kind: c.kind, outer: c.outer.map((p) => p.slice()) })),
    };
    const clear = clearOf(state, { ...l, index }, m);
    if (clear !== null) out.clearHeight = r3(clear);
    return out;
  });

  const kindOrder = {};
  for (const k of KINDS) if (byKind[k]) kindOrder[k] = byKind[k];

  const accessibleCount = (byKind.accessible || 0) + (byKind.van || 0);
  const ma = m.accessible && typeof m.accessible === "object" ? m.accessible : {};
  const me = m.ev && typeof m.ev === "object" ? m.ev : {};
  const mb = m.bike && typeof m.bike === "object" ? m.bike : {};
  const bike = state.bike || {};
  const unitsIn = metricNumber(m.units);
  const units = unitsIn !== null ? unitsIn : isNum(state.required && state.required.units) ? state.required.units : 0;
  const bikeReq = isNum(mb.required) ? mb.required
    : bike.mode === "count" ? (bike.count || 0) : Math.ceil(units / (bike.perUnits || 10));
  const conflictsRaw = m.conflicts;
  const conflicts = isNum(conflictsRaw) ? conflictsRaw : Array.isArray(conflictsRaw) ? conflictsRaw.length
    : conflictsRaw && isNum(conflictsRaw.count) ? conflictsRaw.count : 0;
  const sf = metricNumber(m.sfPerStall);

  return {
    levels,
    metrics: {
      stalls: stallCount,
      byKind: kindOrder,
      sfPerStall: r1(sf !== null ? sf : stallCount > 0 ? gross / stallCount : 0),
      levels: levels.length,
      accessible: {
        required: isNum(ma.required) ? ma.required : accessibleCount,
        provided: isNum(ma.provided) ? ma.provided : accessibleCount,
        van: isNum(ma.van) ? ma.van : byKind.van || 0,
      },
      ev: { installed: isNum(me.installed) ? me.installed : byKind.ev || 0, ready: isNum(me.ready) ? me.ready : evReady },
      bike: { required: bikeReq, areaSf: isNum(mb.areaSf) ? mb.areaSf : bike.rack === "two-tier" ? 0 : r1(bikeReq * 12) },
      conflicts,
    },
  };
}
