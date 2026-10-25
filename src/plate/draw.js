/* ==========================================================================
   plate/draw.js — the draw rules of the Plate Planner (docs/plate-planner-draw-plan.md sections 2.1, 2.4 and 3.3)

   pickType(area, types, depth, { width, mode } = {})           → { type, match }
   matchFor(area, typeRow, depth, { width, mode } = {})          → "in-range" | "large" | "small"
   paintUnit(layout, state, runId, s0, s1, { snap = true } = {}) → { unit, match, width, area, snapped: [s0, s1], refused?, message? }
   freeUnit(layout, state, ring)                                 → { unit, match, area, clipped, refused?, message? }
   cornerUnit(layout, state, zoneId)                             → { unit, match, area, refused?, message? }
   retype(unit, typeId)                                          → unit with typeSet: true
   splitUnit(layout, unit, at = null, state = null)              → { units: [a, b] } | { refused, message }
   mergeUnits(layout, a, b, state = null)                        → { unit } | { refused, message }
   moveBayLine(layout, state, uidA, uidB, s, { snap = true } = {}) → { units: [a, b], widths: [wa, wb], s } | { refused, message }
   migrateUnits(state)                                           → a new state: locks become units (plan 2.1)
   unitModeOf(outer)                                             → "run" | "corner" | "free" (from the shape only)
   nextUnitId(units)                                             → "U-nn", the first free id
   toStateUnit(unit, units)                                      → { id, type, mode, outer, runKey, typeSet? } (a ghost or a paint result)
   UNIT_MIN_SF                                                   50 (a free unit under this area is refused)

   A drawn unit in the state: { id: "U-01", type, mode: "run" | "corner" | "free", outer: Ring, runKey: string | null,
   typeSet?: true, accessible?: true }. `layout` is a layoutLevel result (fill.js): runs (with band, u, n, start,
   startCorner, endCorner), free, cornerZones, units (uid = the state id), zone (the unit zone, for free draw), depth, mode.

   Rule choices where the plan leaves room:
   - Paint: s0 is the press point, s1 the release point, both in feet from the run start. The press point must lie in a
     free stretch of the run; the unit stays inside that stretch (it stops at a neighbor unit, a block or the run end).
     With snap on, an end within 0.5 ft of the stretch end moves onto it, and the width rounds to 0.5 ft. A unit under
     1 ft wide is refused. A press before the run start (s0 < 0) or after its end (s0 > length) next to an empty corner
     zone makes the corner unit of that zone.
   - Match tolerance: 0.5 sf (the metrics rule). Hotel: by width, the width range of the type; the area is shown only.
   - Split and merge keep the mode "run" when the parts are run units, else "free". Split cuts across the run with the
     largest overlap (default: the middle). With `state`, every part takes pickType unless its type was set by hand.
   - Bay line: two run units on one run that share a cut. Each unit keeps at least 1 ft.
   Pure ES module: no DOM, no hidden state, inputs are never mutated.
   ========================================================================== */

import { GEO } from "./corridor.js";
import { MULTIFAMILY_TYPES, HOTEL_TYPES } from "./mix.js";

const { asMP, bool, mpArea, ringArea, bboxOf, frameRect, rr3, r3, centroidOf } = GEO;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const isRing = (r) => Array.isArray(r) && r.length >= 3 && r.every(isPt);
const need = (v, fn, name) => { if (v === undefined || v === null) throw new Error(`${fn}: missing input "${name}".`); return v; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const pad2 = (n) => String(n).padStart(2, "0");

export const UNIT_MIN_SF = 50;
const TOL_SF = 0.5;
const SNAP = 0.5;
const MIN_W = 1;

const modeOf = (state) => (state && state.mode === "hotel" ? "hotel" : "multifamily");
const typesOf = (state) => {
  const m = modeOf(state);
  return state && state.mix && Array.isArray(state.mix[m]) && state.mix[m].length ? state.mix[m] : m === "hotel" ? HOTEL_TYPES : MULTIFAMILY_TYPES;
};
const isHotelTypes = (types, mode) => mode === "hotel" || (types.length > 0 && types.every((t) => !isNum(t.areaMin)));
const largest = (mp) => asMP(mp).slice().sort((a, b) => Math.abs(ringArea(b.outer)) - Math.abs(ringArea(a.outer)))[0] || null;
const absA = (ring) => Math.abs(ringArea(ring));

/* ======================================================================= type match (plan 3.3) */

/** The match of a value against one type: "in-range" | "large" | "small". */
export function matchFor(area, row, depth, { width = null, mode = null } = {}) {
  if (!row) return "in-range";
  const hotel = mode === "hotel" || !isNum(row.areaMin);
  if (hotel) {
    const w = isNum(width) ? width : isNum(depth) && depth > 0 && isNum(area) ? area / depth : null;
    if (!isNum(w) || !isNum(row.widthMin) || !isNum(row.widthMax)) return "in-range";
    if (w < row.widthMin - 0.005) return "small";
    if (w > row.widthMax + 0.005) return "large";
    return "in-range";
  }
  if (!isNum(area)) return "in-range";
  if (area < row.areaMin - TOL_SF) return "small";
  if (isNum(row.areaMax) && area > row.areaMax + TOL_SF) return "large";
  return "in-range";
}

/**
 * Plan 3.3. area: sf; types: the mix rows of the mode; depth: ft (hotel: width = area ÷ depth unless opts.width).
 * 1) the types whose range holds the value: the target closest (ties: type order) → "in-range";
 * 2) else the nearest range → "large" (above its max) or "small" (below its min).
 */
export function pickType(area, types, depth, { width = null, mode = null } = {}) {
  need(types, "pickType", "types");
  const list = types.filter((t) => t && t.id !== undefined);
  if (!list.length) return { type: null, match: "in-range" };
  const hotel = isHotelTypes(list, mode);
  const v = hotel ? (isNum(width) ? width : isNum(depth) && depth > 0 ? area / depth : NaN) : area;
  if (!isNum(v)) return { type: list[0].id, match: "in-range" };
  const lo = (t) => (hotel ? t.widthMin : t.areaMin), hi = (t) => (hotel ? t.widthMax : t.areaMax);
  const tg = (t) => (hotel ? (isNum(t.target) ? t.target : (t.widthMin + t.widthMax) / 2) : isNum(t.targetArea) ? t.targetArea : (t.areaMin + t.areaMax) / 2);
  const tol = hotel ? 0.005 : TOL_SF;
  let best = null;
  list.forEach((t, i) => {
    if (!isNum(lo(t)) || !isNum(hi(t))) return;
    if (v < lo(t) - tol || v > hi(t) + tol) return;
    const d = Math.abs(tg(t) - v);
    if (!best || d < best.d - 1e-9) best = { t, d, i };
  });
  if (best) return { type: best.t.id, match: "in-range" };
  let near = null;
  list.forEach((t, i) => {
    if (!isNum(lo(t)) || !isNum(hi(t))) return;
    const below = v < lo(t);
    const d = below ? lo(t) - v : v - hi(t);
    if (!near || d < near.d - 1e-9) near = { t, d, match: below ? "small" : "large" };
  });
  return near ? { type: near.t.id, match: near.match } : { type: list[0].id, match: "in-range" };
}

/** A unit with a type set by hand: typeSet true. */
export function retype(unit, typeId) {
  need(unit, "retype", "unit"); need(typeId, "retype", "typeId");
  return { ...clone(unit), type: typeId, typeSet: true };
}

/* ======================================================================= ids and state units */

/** The first free id "U-nn" (nn from 01) over the ids (or uids) of `units`. */
export function nextUnitId(units) {
  const used = new Set((Array.isArray(units) ? units : []).map((u) => (u && (u.uid || u.id)) || null).filter(Boolean));
  for (let k = 1; ; k++) { const id = `U-${pad2(k)}`; if (!used.has(id)) return id; }
}

/** A state unit from a ghost, a paint result or a layout unit: { id, type, mode, outer, runKey, typeSet?, accessible? }. */
export function toStateUnit(unit, units = []) {
  need(unit, "toStateUnit", "unit");
  const out = {
    id: unit.uid || (typeof unit.id === "string" && /^U-/.test(unit.id) ? unit.id : nextUnitId(units)),
    type: unit.type, mode: unit.mode === "corner" || unit.mode === "free" ? unit.mode : "run",
    outer: rr3(need(unit.outer, "toStateUnit", "unit.outer")), runKey: typeof unit.runKey === "string" ? unit.runKey : null,
  };
  if (unit.typeSet) out.typeSet = true;
  if (unit.accessible === true || unit.type === "accessible") out.accessible = true;
  return out;
}

/* ======================================================================= migration (plan 2.1) */

function dropCollinear(ring) {
  const p = ring.slice();
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length && p.length > 3; i++) {
      const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (L < 1e-12 || Math.abs(cr) / L < 1e-4) { p.splice(i, 1); changed = true; i--; }
    }
  }
  return p;
}

const rightAngles = (p) => p.every((b, i) => {
  const a = p[(i - 1 + p.length) % p.length], c = p[(i + 1) % p.length];
  const u = sub(b, a), v = sub(c, b), L = Math.hypot(...u) * Math.hypot(...v);
  return L > 0 && Math.abs(dot(u, v)) / L < 1e-3;
});

/** The mode of a unit from its shape: a rectangle → "run", an L (six right angles) → "corner", else "free". */
export function unitModeOf(outer) {
  if (!isRing(outer)) return "free";
  const p = dropCollinear(outer.map((q) => [q[0], q[1]]));
  if (p.length === 4 && rightAngles(p)) return "run";
  if (p.length === 6 && rightAngles(p)) return "corner";
  return "free";
}

function cleanList(list, from = []) {
  const out = [];
  const used = new Set();
  for (const u of Array.isArray(list) ? list : []) {
    if (!u || !isRing(u.outer)) continue;
    let id = typeof u.id === "string" && u.id ? u.id : null;
    if (!id || used.has(id)) id = nextUnitId([...from, ...out]);
    used.add(id);
    const rec = { id, type: u.type, mode: u.mode === "run" || u.mode === "corner" || u.mode === "free" ? u.mode : unitModeOf(u.outer), outer: rr3(u.outer), runKey: typeof u.runKey === "string" ? u.runKey : null };
    if (u.typeSet) rec.typeSet = true;
    if (u.accessible === true || u.type === "accessible") rec.accessible = true;
    out.push(rec);
  }
  return out;
}

/**
 * Plan 2.1 migration. → a new state: `units` from `units` (cleaned) or else from `locks` (drawn source), and
 * levels.groups[gid].units from groups[gid].units or else groups[gid].locks. The `locks` keys go away.
 * A state with no locks and no units is blank (units: []).
 */
export function migrateUnits(state) {
  need(state, "migrateUnits", "state");
  const s = clone(state);
  const src = Array.isArray(s.units) ? s.units : Array.isArray(s.locks) ? s.locks : [];
  s.units = cleanList(src);
  delete s.locks;
  if (s.levels && s.levels.groups && typeof s.levels.groups === "object") {
    for (const gid of Object.keys(s.levels.groups)) {
      const g = s.levels.groups[gid];
      if (!g || typeof g !== "object") continue;
      const list = Array.isArray(g.units) ? g.units : Array.isArray(g.locks) ? g.locks : null;
      if (list) g.units = cleanList(list);
      delete g.locks;
    }
  }
  return s;
}

/* ======================================================================= layout lookups */

const runOf = (layout, runId, fn) => {
  need(layout, fn, "layout");
  const r = (layout.runs || []).find((x) => x.id === runId);
  if (!r) throw new Error(`${fn}: missing input "runId" (no run ${runId} on this layout).`);
  return r;
};
const frameOf = (run) => ({ o: run.start, u: run.u, n: run.n });
const runKeyOf = (run) => `${run.ring}:${run.edge}:${r1(run.from)}`;
const unitsOf = (layout) => (Array.isArray(layout.units) ? layout.units : []);
const depthFor = (layout, run) => (run && isNum(run.depth) ? run.depth : isNum(layout.depth) && layout.depth > 0 ? layout.depth : 28);
const typeRow = (state, id) => typesOf(state).find((t) => t.id === id) || null;

/** The band of `run` between s0 and s1 (ft from the run start) → Ring | null */
function cut(run, s0, s1) {
  const band = asMP(run.band);
  if (!band.length) return null;
  const pc = largest(bool("int", band, [{ outer: frameRect(frameOf(run), s0, s1, -1, 1e4), holes: [] }]));
  return pc ? rr3(pc.outer) : null;
}

function result(state, layout, run, outer, extra = {}) {
  const area = r1(absA(outer));
  const depth = depthFor(layout, run);
  const width = isNum(extra.width) ? extra.width : null;
  const p = pickType(area, typesOf(state), depth, { width, mode: modeOf(state) });
  return { area, type: p.type, match: p.match };
}

/* ======================================================================= paint (plan 2.4) */

const refuse = (code, message, more = {}) => ({ unit: null, refused: code, message, ...more });

/**
 * Plan 2.4 paint. runId: a layout run id; s0 (press) and s1 (release): ft from the run start.
 * → { unit: { id, type, mode, outer, runKey }, match, width, area, snapped: [lo, hi] } or { unit: null, refused, message }
 */
export function paintUnit(layout, state, runId, s0, s1, { snap = true } = {}) {
  need(state, "paintUnit", "state");
  const run = runOf(layout, runId, "paintUnit");
  if (!isNum(s0) || !isNum(s1)) throw new Error('paintUnit: missing input "s0" or "s1".');
  const L = run.length;
  // a press beyond the run end next to an empty corner zone: the corner unit
  const zoneId = s0 < -0.01 ? run.startCorner : s0 > L + 0.01 ? run.endCorner : null;
  if (zoneId && (layout.cornerZones || []).some((z) => z.id === zoneId)) return cornerUnit(layout, state, zoneId);
  const p = Math.max(0, Math.min(L, s0)), q = Math.max(0, Math.min(L, s1));
  const st = (layout.free || []).find((f) => f.runId === run.id && p >= f.a - 0.01 && p <= f.b + 0.01);
  if (!st) return refuse("inside-unit", "The start point is on a unit. Start on an open stretch.");
  let a = Math.max(st.a, Math.min(st.b, p)), b = Math.max(st.a, Math.min(st.b, q));
  if (snap) {
    if (a - st.a < SNAP) a = st.a; else if (st.b - a < SNAP) a = st.b;
    const dir = b >= a ? 1 : -1, lim = dir > 0 ? st.b : st.a;
    let w = Math.round(Math.abs(b - a) / SNAP) * SNAP;
    if (Math.abs(lim - a) - w < SNAP) w = Math.abs(lim - a);
    b = a + dir * w;
  }
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi - lo < MIN_W - 1e-9) return refuse("too-narrow", "The unit is less than 1 ft wide. Drag farther along the facade.", { snapped: [r3(lo), r3(hi)] });
  const outer = cut(run, lo, hi);
  if (!outer) return refuse("no-band", "This run has no space for a unit here.");
  const width = r3(hi - lo);
  const r = result(state, layout, run, outer, { width });
  return {
    unit: { id: nextUnitId(unitsOf(layout)), type: r.type, mode: "run", outer, runKey: runKeyOf(run) },
    match: r.match, width, area: r.area, snapped: [r3(lo), r3(hi)],
  };
}

/** The wrap unit of an empty corner zone (plan 2.4: a paint that starts inside the zone). */
export function cornerUnit(layout, state, zoneId) {
  need(layout, "cornerUnit", "layout"); need(state, "cornerUnit", "state");
  const z = (layout.cornerZones || []).find((x) => x.id === zoneId);
  if (!z) return refuse("no-corner", "This corner zone has a unit or does not exist.");
  const cornerType = (state.mix && state.mix.cornerType) || "2br";
  const area = r1(absA(z.outer));
  const match = matchFor(area, typeRow(state, cornerType), layout.depth, { mode: modeOf(state) });
  return { unit: { id: nextUnitId(unitsOf(layout)), type: cornerType, mode: "corner", outer: rr3(z.outer), runKey: null }, match, area, width: null, legs: z.legs, e: z.e };
}

/** Plan 2.4 free draw: the ring clipped to the unit zone less the other units. Under 50 sf: refused. */
export function freeUnit(layout, state, ring) {
  need(layout, "freeUnit", "layout"); need(state, "freeUnit", "state");
  if (!isRing(ring)) throw new Error('freeUnit: missing input "ring" (three points or more).');
  const raw = absA(ring);
  const zone = asMP(layout.zone);
  let mp = zone.length ? bool("int", [{ outer: ring.map((p) => [p[0], p[1]]), holes: [] }], zone) : [];
  const others = unitsOf(layout).filter((u) => isRing(u.outer)).map((u) => ({ outer: u.outer, holes: [] }));
  if (mp.length && others.length) mp = bool("diff", mp, others);
  const pc = largest(mp);
  const area = pc ? r1(absA(pc.outer)) : 0;
  if (!pc || area < UNIT_MIN_SF) return refuse("too-small", `The unit is ${Math.round(area)} sf after the clip. A unit must be 50 sf or more. Draw a larger shape.`, { area, clipped: true });
  const outer = rr3(pc.outer);
  const clipped = Math.abs(raw - area) > TOL_SF || mp.length > 1;
  const p = pickType(area, typesOf(state), depthFor(layout, null), { mode: modeOf(state) });
  return { unit: { id: nextUnitId(unitsOf(layout)), type: p.type, mode: "free", outer, runKey: null }, match: p.match, area, clipped };
}

/* ======================================================================= split, merge, bay line */

/** The run with the largest overlap with a ring → { run, lo, hi } (lo, hi: ft from the run start), or null. */
function hostRun(layout, ring) {
  const bb = bboxOf([{ outer: ring, holes: [] }]);
  let best = null;
  for (const r of layout.runs || []) {
    const rb = bboxOf(asMP(r.band));
    if (rb[0] > bb[2] || rb[2] < bb[0] || rb[1] > bb[3] || rb[3] < bb[1]) continue;
    const ov = mpArea(bool("int", asMP(r.band), [{ outer: ring, holes: [] }]));
    if (ov < 0.01 || (best && ov <= best.ov + 1e-9)) continue;
    let lo = Infinity, hi = -Infinity;
    for (const p of ring) { const s = dot(sub(p, r.start), r.u); lo = Math.min(lo, s); hi = Math.max(hi, s); }
    best = { run: r, lo, hi, ov };
  }
  return best;
}

const findUnit = (layout, u) => {
  if (u && isRing(u.outer)) return u;
  const id = typeof u === "string" ? u : u && (u.uid || u.id);
  return unitsOf(layout).find((x) => x.uid === id || x.id === id) || null;
};

function retyped(state, layout, base, outer, width, depth) {
  const area = r1(absA(outer));
  if (!state || base.typeSet) return { type: base.type, typeSet: !!base.typeSet };
  const p = pickType(area, typesOf(state), depth, { width, mode: modeOf(state) });
  return { type: p.type };
}

/**
 * Split a unit across its run (`at`: ft from the unit start along the run; default the middle).
 * → { units: [a, b] } (state units; a keeps the id, b takes the next free id) or { refused, message }
 */
export function splitUnit(layout, unit, at = null, state = null) {
  need(layout, "splitUnit", "layout");
  const u = findUnit(layout, need(unit, "splitUnit", "unit"));
  if (!u) throw new Error('splitUnit: missing input "unit" (not on this layout).');
  const ring = u.outer.map((p) => [p[0], p[1]]);
  const host = hostRun(layout, ring);
  let fr, lo, hi, depth = null;
  if (host) { fr = frameOf(host.run); lo = host.lo; hi = host.hi; depth = host.run.depth; }
  else {
    const b = bboxOf([{ outer: ring, holes: [] }]);
    const alongX = b[2] - b[0] >= b[3] - b[1];
    fr = alongX ? { o: [b[0], b[1]], u: [1, 0], n: [0, 1] } : { o: [b[0], b[1]], u: [0, 1], n: [1, 0] };
    lo = 0; hi = alongX ? b[2] - b[0] : b[3] - b[1];
  }
  const s = isNum(at) ? lo + at : (lo + hi) / 2;
  if (s - lo < MIN_W || hi - s < MIN_W) return { refused: "too-narrow", message: "A part is less than 1 ft wide. Split nearer the middle." };
  const me = [{ outer: ring, holes: [] }];
  const A = largest(bool("int", me, [{ outer: frameRect(fr, lo - 1e4, s, -1e4, 1e4), holes: [] }]));
  const B = largest(bool("int", me, [{ outer: frameRect(fr, s, hi + 1e4, -1e4, 1e4), holes: [] }]));
  if (!A || !B || absA(A.outer) < 1 || absA(B.outer) < 1) return { refused: "no-split", message: "The unit does not split at this point." };
  const mode = u.mode === "run" ? "run" : "free";
  const base = { id: u.uid || u.id, type: u.type, typeSet: u.typeSet, runKey: u.runKey || null };
  const d = depth || depthFor(layout, null);
  const oa = rr3(A.outer), ob = rr3(B.outer);
  const ta = retyped(state, layout, base, oa, s - lo, d), tb = retyped(state, layout, base, ob, hi - s, d);
  const ua = { id: base.id, type: ta.type, mode, outer: oa, runKey: base.runKey, ...(ta.typeSet ? { typeSet: true } : {}) };
  const ub = { id: nextUnitId([...unitsOf(layout), { uid: base.id }]), type: tb.type, mode, outer: ob, runKey: base.runKey, ...(tb.typeSet ? { typeSet: true } : {}) };
  return { units: [ua, ub] };
}

/** Merge two units that share an edge → { unit } (keeps the id of a) or { refused, message }. */
export function mergeUnits(layout, a, b, state = null) {
  need(layout, "mergeUnits", "layout");
  const ua = findUnit(layout, need(a, "mergeUnits", "a")), ub = findUnit(layout, need(b, "mergeUnits", "b"));
  if (!ua || !ub) throw new Error('mergeUnits: missing input "a" or "b" (not on this layout).');
  const grown = bool("int", GEO.offsetMP([{ outer: ua.outer, holes: [] }], 0.05), [{ outer: ub.outer, holes: [] }]);
  if (mpArea(grown) < 0.25) return { refused: "not-touching", message: "The two units do not touch. Select two neighbor units." };
  const uni = bool("union", [{ outer: ua.outer, holes: [] }, { outer: ub.outer, holes: [] }], []);
  if (uni.length !== 1 || uni[0].holes.length) return { refused: "not-one-piece", message: "The two units do not make one shape." };
  const outer = rr3(dropCollinear(uni[0].outer));
  const mode = ua.mode === "run" && ub.mode === "run" ? "run" : ua.mode === "corner" || ub.mode === "corner" ? "corner" : "free";
  const host = hostRun(layout, outer);
  const base = { id: ua.uid || ua.id, type: ua.type, typeSet: ua.typeSet };
  const t = retyped(state, layout, base, outer, host && mode === "run" ? host.hi - host.lo : null, host ? host.run.depth : depthFor(layout, null));
  return { unit: { id: base.id, type: t.type, mode, outer, runKey: ua.runKey || ub.runKey || null, ...(t.typeSet ? { typeSet: true } : {}) } };
}

/**
 * Drag the shared bay line of two run units on one run to `s` (ft from the run start).
 * → { units: [a, b], widths: [wa, wb], s } (state units) or { refused, message }
 */
export function moveBayLine(layout, state, uidA, uidB, s, { snap = true } = {}) {
  need(layout, "moveBayLine", "layout");
  const A = findUnit(layout, uidA), B = findUnit(layout, uidB);
  if (!A || !B) throw new Error('moveBayLine: missing input "uidA" or "uidB" (not on this layout).');
  if (!isNum(s)) throw new Error('moveBayLine: missing input "s".');
  const ha = hostRun(layout, A.outer), hb = hostRun(layout, B.outer);
  if (!ha || !hb || ha.run.id !== hb.run.id || A.wrap || B.wrap) return { refused: "not-one-run", message: "The two units are not run units on one run." };
  const [L, R] = ha.lo <= hb.lo ? [{ u: A, h: ha }, { u: B, h: hb }] : [{ u: B, h: hb }, { u: A, h: ha }];
  if (Math.abs(L.h.hi - R.h.lo) > 0.02) return { refused: "no-shared-line", message: "The two units do not share a bay line." };
  let x = snap ? Math.round(s / SNAP) * SNAP : s;
  x = Math.max(L.h.lo + MIN_W, Math.min(R.h.hi - MIN_W, x));
  if (x - L.h.lo < MIN_W - 1e-9 || R.h.hi - x < MIN_W - 1e-9) return { refused: "too-narrow", message: "A unit is less than 1 ft wide." };
  const run = ha.run;
  const oL = cut(run, L.h.lo, x), oR = cut(run, x, R.h.hi);
  if (!oL || !oR) return { refused: "no-band", message: "The run has no space here." };
  const mk = (u, outer, w) => {
    const t = retyped(state, layout, { type: u.type, typeSet: u.typeSet }, outer, w, run.depth);
    return { id: u.uid || u.id, type: t.type, mode: "run", outer, runKey: u.runKey || runKeyOf(run), ...(t.typeSet ? { typeSet: true } : {}), ...(u.accessible ? { accessible: true } : {}) };
  };
  const wL = r3(x - L.h.lo), wR = r3(R.h.hi - x);
  const uL = mk(L.u, oL, wL), uR = mk(R.u, oR, wR);
  return L.u === A ? { units: [uL, uR], widths: [wL, wR], s: r3(x) } : { units: [uR, uL], widths: [wR, wL], s: r3(x) };
}

/* ======================================================================= helpers for other modules */

/** The centroid of a ring (the label point of a ghost when the page needs one). */
export function unitCentroid(outer) { return centroidOf([{ outer, holes: [] }]); }
