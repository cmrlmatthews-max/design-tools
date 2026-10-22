/* ==========================================================================
   plate/derived.js — Plate Planner → plates.derived
   (docs/plate-planner-technical-plan.md sections 3.13 and 4; project file spec 6.3)

   platesDerived(state, built, metrics) → { mode, massingUpdatedAt, levels, mix, metrics }
     state    the plate state (plan section 2). Read: mode, mix[mode] (type names and colors), corridor.width, extWall.
     built    buildPlates(state, ...) result (plan section 4): { source, groups: [{ id, levels, fill }], placement, ... }
              group.levels   the level indices of the group. An entry is a number, or an object { index, name, z, ftf, program, zone }.
                             A number takes its data from built.levels (an array of level records, optional), else defaults:
                             name "Level <n>", ftf 10, z (n - 1) * ftf.
              group.fill     LevelFill { plate, corridor, core, stairs, elevators, support, units, ... } of the lowest level.
                             Every level of the group gets a copy of it, with its own index and unit ids.
              fill.units[]   { type (id or name), outer, exposures, corner, bay: { from, to }, ring, demising, accessible }
                             in run order. `area` is not read: the area is the polygon area.
              built.massingUpdatedAt (else state.massingUpdatedAt, else null)   the massing updatedAt the fill used.
     metrics  computeMetrics result. Optional. Not read here: every number comes from the geometry.

   levels[]  index, name, z, ftf, plate, corridor, core { outer, stairs, elevators }, support, units, metrics { units, nrsf, gsf, efficiency }
             (name, z and ftf are optional keys; the rooms CSV, the DXF and the SketchUp export read them.)
   units[]   id "<level>-<nn>" (run order), type (the type NAME, e.g. "1BR"), outer, area, exposures, corner, bay, ring, demising, accessible
   mix[]     { type, count, share, avgArea } over the whole building (level x group floors)
   metrics   { units, nrsf, gsf, efficiency, corridorFt } over the whole building; hotel adds bays.
             corridorFt = clear corridor polygon area / clear width, summed over the levels.

   Area rule (decision 5): unit area = centerline of the demising walls, the corridor face of the corridor wall, the inside face of the
   exterior wall. Coordinates are in the plate frame (the massing local frame), rounded to 0.001 ft. Areas round to 0.1 sf, ratios to 0.0001.

   Shared helpers (ring math, type table, level records, corridor wall lines) are used by exports.js and sketchup.js too.
   Pure: no DOM, no input mutation, no hidden state.
   ========================================================================== */

import { cleanRing2 } from "../shared/sketchup-format.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
export const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
export const r4 = (v) => { const r = Math.round(v * 10000) / 10000; return r === 0 ? 0 : r; };
const need = (v, name) => { if (v === undefined || v === null) throw new Error(`platesDerived: missing input "${name}".`); return v; };

export const DEFAULT_FTF = 10;                       // ft, when a level has no floor-to-floor height
export const CORRIDOR_DEFAULT = { multifamily: 5.67, hotel: 6.0 };   // clear width, plan section 2
export const WALL_DEFAULT = 0.5;                     // ft, corridor wall thickness (decision 6)
const EXPOSURE_ORDER = ["N", "E", "S", "W"];

/* ---------------- rings ---------------- */

const isPt = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const isRing = (v) => Array.isArray(v) && v.length >= 3 && v.every(isPt);

/** Signed plan area of a ring (positive = counter-clockwise). */
export function ringAreaSigned(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Area-weighted centroid of a ring. A zero-area ring gives the vertex average. */
export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], w = p[0] * q[1] - q[0] * p[1];
    a += w; cx += (p[0] + q[0]) * w; cy += (p[1] + q[1]) * w;
  }
  if (Math.abs(a) < 1e-9) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * A point inside the ring for a label: the centroid when it is inside, else the middle of the longest
 * inside stretch of the horizontal line through the centroid (an L-shaped wrap unit can have its centroid outside).
 */
export function labelPoint(ring) {
  const c = ringCentroid(ring);
  if (pointInRing(c, ring)) return [r3(c[0]), r3(c[1])];
  const ys = [c[1], ...[0.25, 0.5, 0.75].map((f) => { const lo = Math.min(...ring.map((p) => p[1])), hi = Math.max(...ring.map((p) => p[1])); return lo + f * (hi - lo); })];
  for (const y of ys) {
    const xs = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    let best = null;
    for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
    if (best && best[1] - best[0] > 1e-6) return [r3((best[0] + best[1]) / 2), r3(y)];
  }
  return [r3(ring[0][0]), r3(ring[0][1])];
}

const roundRing = (ring) => ring.map((p) => [r3(p[0]), r3(p[1])]);

/** A ring from a ring, a polygon { outer }, or a rectangle [x0, y0, x1, y1]. Else null. */
export function ringOf(v) {
  if (isRing(v)) return v;
  if (v && !Array.isArray(v) && isRing(v.outer)) return v.outer;
  if (Array.isArray(v) && v.length === 4 && v.every(isNum)) { const [x0, y0, x1, y1] = v; return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  return null;
}

/** A cleaned ring (cleanRing2: counter-clockwise outer, clockwise hole, 0.001 ft), or null when degenerate. */
function cleanOuter(v) {
  const r = ringOf(v);
  return r ? cleanRing2(r) : null;
}

/** MultiPoly [{ outer, holes }] from a MultiPoly, one polygon, or one ring. Every ring cleaned; a degenerate piece is dropped. */
export function multiPolyOf(v) {
  let list = [];
  if (Array.isArray(v) && v.length && v.every((p) => p && !Array.isArray(p) && isRing(p.outer))) list = v;
  else if (v && !Array.isArray(v) && isRing(v.outer)) list = [v];
  else if (isRing(v)) list = [{ outer: v, holes: [] }];
  const out = [];
  for (const p of list) {
    const outer = cleanRing2(p.outer);
    if (!outer) continue;
    const holes = (p.holes || []).map((h) => (isRing(h) ? cleanRing2(h, { hole: true }) : null)).filter(Boolean);
    out.push({ outer, holes });
  }
  return out;
}

export function multiPolyArea(mp) {
  let a = 0;
  for (const p of mp) { a += Math.abs(ringAreaSigned(p.outer)); for (const h of p.holes || []) a -= Math.abs(ringAreaSigned(h)); }
  return a;
}

/* ---------------- types ---------------- */

/** The type table of the state: [{ id, name, color, share, bays }] for state.mix[state.mode]. */
export function typeTable(state) {
  const mode = state && state.mode === "hotel" ? "hotel" : "multifamily";
  const list = state && state.mix && Array.isArray(state.mix[mode]) ? state.mix[mode] : [];
  return list.map((t) => ({ id: String(t.id), name: String(t.name || t.id), color: /^#[0-9a-fA-F]{6}$/.test(t.color || "") ? t.color : "#9aa3ad", share: isNum(t.share) ? t.share : 0, bays: isNum(t.bays) ? t.bays : 1 }));
}

/** The table row for a unit type key (an id, else a name), or null. */
export function typeRow(table, key) {
  const k = String(key);
  return table.find((t) => t.id === k) || table.find((t) => t.name === k) || null;
}

/** Clear corridor width: state.corridor.width, else the mode default. */
export function corridorWidth(state) {
  const w = state && state.corridor && state.corridor.width;
  if (isNum(w) && w > 0) return w;
  return state && state.mode === "hotel" ? CORRIDOR_DEFAULT.hotel : CORRIDOR_DEFAULT.multifamily;
}

export function wallThickness(state) {
  const w = state && state.corridor && state.corridor.wall;
  return isNum(w) && w >= 0 ? w : WALL_DEFAULT;
}

/* ---------------- levels ---------------- */

/**
 * The filled levels of a build, one record per level of every group, in index order:
 * { index, name, z, ftf, program, zone, groupId, fill }. See the file header for where the data comes from.
 */
export function levelRecords(built) {
  need(built, "built");
  const groups = Array.isArray(built.groups) ? built.groups : null;
  if (!groups) throw new Error('platesDerived: missing input "built.groups".');
  const meta = new Map();
  for (const l of Array.isArray(built.levels) ? built.levels : []) if (l && isNum(l.index)) meta.set(l.index, l);
  const out = [], seen = new Set();
  for (const g of groups) {
    if (!g || !g.fill) continue;
    const entries = Array.isArray(g.levels) && g.levels.length ? g.levels : isNum(g.first) ? [g.first] : [1];
    for (const e of entries) {
      const info = isNum(e) ? { index: e } : e && isNum(e.index) ? e : null;
      if (!info || seen.has(info.index)) continue;
      seen.add(info.index);
      const m = { ...(meta.get(info.index) || {}), ...info };
      const ftf = isNum(m.ftf) && m.ftf > 0 ? m.ftf : DEFAULT_FTF;
      out.push({
        index: m.index, name: typeof m.name === "string" && m.name ? m.name : `Level ${m.index}`,
        z: isNum(m.z) ? m.z : (m.index - 1) * ftf, ftf, program: m.program ?? null, zone: m.zone ?? null,
        groupId: g.id ?? null, fill: g.fill,
      });
    }
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/* ---------------- corridor wall lines ---------------- */

/**
 * The corridor wall lines of a derived level: the corridor face offset by `wall` into the units, only where a unit
 * edge lies on the corridor edge. → [[[x, y], [x, y]], …] (rendering and DXF only; the unit area already includes the wall).
 */
export function corridorWallLines(level, wall) {
  const w = isNum(wall) && wall >= 0 ? wall : WALL_DEFAULT;
  const unitEdges = [];
  for (const u of level.units || []) {
    const r = ringOf(u.outer);
    if (r) for (let i = 0; i < r.length; i++) unitEdges.push([r[i], r[(i + 1) % r.length]]);
  }
  const lines = [];
  for (const poly of level.corridor || []) {
    for (const ring of [poly.outer, ...(poly.holes || [])]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.05) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = uy, ny = -ux;          // the right side holds the units
        const spans = [];
        for (const [c, d] of unitEdges) {
          const oc = (c[0] - a[0]) * uy - (c[1] - a[1]) * ux, od = (d[0] - a[0]) * uy - (d[1] - a[1]) * ux;
          if (Math.abs(oc) > 0.02 || Math.abs(od) > 0.02) continue;
          const tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uy, td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uy;
          const t0 = Math.max(0, Math.min(tc, td)), t1 = Math.min(L, Math.max(tc, td));
          if (t1 - t0 > 0.05) spans.push([t0, t1]);
        }
        spans.sort((p, q) => p[0] - q[0]);
        const merged = [];
        for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1] + 0.05) last[1] = Math.max(last[1], s[1]); else merged.push([s[0], s[1]]); }
        for (const [t0, t1] of merged) {
          lines.push([[r3(a[0] + ux * t0 + nx * w), r3(a[1] + uy * t0 + ny * w)], [r3(a[0] + ux * t1 + nx * w), r3(a[1] + uy * t1 + ny * w)]]);
        }
      }
    }
  }
  return lines;
}

/* ---------------- the writer ---------------- */

const bayOf = (b) => (b && isNum(b.from) && isNum(b.to) ? { from: r3(b.from), to: r3(b.to) } : undefined);
const lineOf = (l) => (Array.isArray(l) && l.length >= 2 && isPt(l[0]) && isPt(l[1]) ? [[r3(l[0][0]), r3(l[0][1])], [r3(l[l.length - 1][0]), r3(l[l.length - 1][1])]] : null);
const pad2 = (n) => String(n).padStart(2, "0");

function unitRecord(u, id, table) {
  const ring = cleanOuter(u.outer);
  if (!ring) return null;
  const row = typeRow(table, u.type ?? u.typeId);
  const exp = Array.isArray(u.exposures) ? EXPOSURE_ORDER.filter((e) => u.exposures.includes(e)) : [];
  const rec = {
    id, type: row ? row.name : String(u.type ?? u.typeId ?? ""), outer: ring,
    area: r1(Math.abs(ringAreaSigned(ring))), exposures: exp, corner: !!u.corner,
  };
  const bay = bayOf(u.bay);
  if (bay) rec.bay = bay;
  rec.ring = isNum(u.ring) ? u.ring : 0;
  rec.demising = (Array.isArray(u.demising) ? u.demising : []).map(lineOf).filter(Boolean);
  rec.accessible = typeof u.accessible === "string" ? u.accessible : !!u.accessible;
  return rec;
}

function levelOf(rec, table, width) {
  const f = rec.fill;
  const units = [];
  (Array.isArray(f.units) ? f.units : []).forEach((u, k) => {
    const r = unitRecord(u, `${rec.index}-${pad2(units.length + 1)}`, table);
    if (r) units.push(r);
  });
  // unit ids follow run order and have no gap; a dropped degenerate unit does not leave one
  const plate = multiPolyOf(f.plate), corridor = multiPolyOf(f.corridor);
  const core = f.core && !Array.isArray(f.core) && isRing(f.core.outer) ? f.core : null;
  const coreRing = cleanOuter(core || f.core);
  const stairsIn = Array.isArray(f.stairs) ? f.stairs : core && Array.isArray(core.stairs) ? core.stairs : [];
  const elevIn = Array.isArray(f.elevators) ? f.elevators : core && Array.isArray(core.elevators) ? core.elevators : [];
  const stairs = [], elevators = [];
  stairsIn.forEach((s, k) => { const o = cleanOuter(s.outer); if (o) stairs.push({ id: s.id ?? `S${k + 1}`, outer: o, door: isPt(s.door) ? [r3(s.door[0]), r3(s.door[1])] : null }); });
  elevIn.forEach((s, k) => { const o = cleanOuter(s.outer); if (o) elevators.push({ id: s.id ?? `E${k + 1}`, outer: o }); });
  const support = [];
  (Array.isArray(f.support) ? f.support : []).forEach((s, k) => { const o = cleanOuter(s.outer); if (o) support.push({ id: s.id ?? `B${k + 1}`, outer: o, kind: s.kind ?? "support" }); });

  const nrsfRaw = units.reduce((s, u) => s + Math.abs(ringAreaSigned(u.outer)), 0);
  const gsfRaw = multiPolyArea(plate);
  const corridorFt = width > 0 ? multiPolyArea(corridor) / width : 0;
  const bays = units.reduce((s, u) => { const row = typeRow(table, u.type); return s + (row ? row.bays : 1); }, 0);
  const out = {
    index: rec.index, name: rec.name, z: r3(rec.z), ftf: r3(rec.ftf),
    plate, corridor, core: { outer: coreRing, stairs, elevators }, support, units,
    metrics: { units: units.length, nrsf: r1(nrsfRaw), gsf: r1(gsfRaw), efficiency: gsfRaw > 0 ? r4(nrsfRaw / gsfRaw) : 0 },
  };
  return { level: out, raw: { nrsf: nrsfRaw, gsf: gsfRaw, corridorFt, bays } };
}

/** plates.derived of a build. See the file header. */
export function platesDerived(state, built, metrics) {
  need(state, "state"); need(built, "built");
  void metrics;
  const mode = state.mode === "hotel" ? "hotel" : "multifamily";
  const table = typeTable(state), width = corridorWidth(state);
  const levels = [], sums = { nrsf: 0, gsf: 0, corridorFt: 0, bays: 0 };
  const byType = new Map();
  for (const rec of levelRecords(built)) {
    const { level, raw } = levelOf(rec, table, width);
    levels.push(level);
    sums.nrsf += raw.nrsf; sums.gsf += raw.gsf; sums.corridorFt += raw.corridorFt; sums.bays += raw.bays;
    for (const u of level.units) {
      const e = byType.get(u.type) || { count: 0, area: 0 };
      e.count++; e.area += Math.abs(ringAreaSigned(u.outer));
      byType.set(u.type, e);
    }
  }
  const total = levels.reduce((s, l) => s + l.units.length, 0);
  const order = [...table.map((t) => t.name), ...[...byType.keys()].filter((k) => !table.some((t) => t.name === k))];
  const mix = [];
  for (const name of order) {
    const e = byType.get(name);
    if (e) mix.push({ type: name, count: e.count, share: total ? r4(e.count / total) : 0, avgArea: r1(e.area / e.count) });
  }
  const bm = { units: total, nrsf: r1(sums.nrsf), gsf: r1(sums.gsf), efficiency: sums.gsf > 0 ? r4(sums.nrsf / sums.gsf) : 0, corridorFt: r1(sums.corridorFt) };
  if (mode === "hotel") bm.bays = sums.bays;
  const stamp = built.massingUpdatedAt ?? state.massingUpdatedAt ?? null;
  return { mode, massingUpdatedAt: typeof stamp === "string" ? stamp : null, levels, mix, metrics: bm };
}
