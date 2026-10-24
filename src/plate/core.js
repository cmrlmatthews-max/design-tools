/* ==========================================================================
   plate/core.js — the auto core of the Plate Planner (rework plan sections 4.2 and 4.4)

   coreProgram(state, ctx)                         → { mode, cabs, autoCabs, service, units, unitArea, floors, rows, size, area, rooms, notes }
   coreLayout2(program, center, axis, state, opts) → { rect, outer, rooms: [{ id, kind, outer }], size }
   autoCore(plate, level, state, ctx)              → { outer, rect, rooms, program, size, axis, center }
   coreContext(state, groups)                      → { floors, units, unitArea, perGroup } (buildPlates passes it to every level)
   normalizeCore(core)                             → { mode, rect } (the load rule, for the page store)
   coreModeOf(state), manualCoreRect(state)        re-exported from corridor.js

   Caution: elevator counts and core sizes are seeds for early design. Verify them with a vertical transportation
   consultant and the design team. The tool never checks a code.

   Pure ES module: no DOM, no hidden state, inputs are never mutated. Feet and square feet.

   Rule choices where the plan leaves room:
   - Unit estimate U (K for hotels) = Σ over the filled groups of floors × round(levelGsf × 0.75 ÷ A). With one group this
     is the plan formula floors × round(levelGsf × 0.75 ÷ A). A = the share-weighted target area of the mix (types with
     share > 0); hotel A = 400 sf per key. ctx.units, when given, is U; else ctx.floors × round(ctx.levelGsf × 0.75 ÷ A).
   - Passenger cabs: multifamily max(2, ceil(U ÷ 90)), hotel max(2, ceil(K ÷ 100)); state.elevators.count (not null)
     overrides. Service cab: hotel 1, multifamily 1 when floors ≥ 20; state.elevators.service (not null) overrides.
   - Core depth B = the stair depth (state.stairs.size[1], 22). Two rows of B ÷ 2 (11 ft). Cab width = state.elevators.size[0]
     (8 ft); a cab room is 8 × 11.
   - Row 1: the passenger cabs. Row 2: service cab 8, trash 8, electrical 8, then (hotel, back-of-house on) linen 14,
     ice 6, data 6, and last the shaft 6. The shaft is last so that it is the room that stretches.
   - More than 6 passenger cabs: row 1 takes ceil(n ÷ 2), row 2 floor(n ÷ 2); the row-2 rooms move to the end of row 1.
   - Row length R = the longer row; the shorter row stretches its last room when it is a shaft, else it gets a new shaft
     room of the missing length. Core length A = 2 × stair width + R (stairs at the two ends, full depth). Every square
     foot of the core is a named room.
   - Without core stairs (stairs mode "manual", or stair seeds): A = R, no stair rooms.
   - Frame: u along the plate's long axis (minimum-area rectangle; a near-square plate: east-west), n = u turned 90
     degrees counter-clockwise; the core is centered on the plate's area centroid; row 1 is on the +n side.
   - Room ids: S1, S2 (stairs), E1… (cabs), SE1 (service cab), TR1 (trash), EL1 (electrical), SH1… (shafts), LN1, IC1, DA1.
   ========================================================================== */

import { GEO, minRect, coreModeOf as coreModeOf0, manualCoreRect as manualCoreRect0 } from "./corridor.js";
import { MULTIFAMILY_TYPES, HOTEL_TYPES } from "./mix.js";

const { asMP, mpArea, centroidOf, frameRect, rr3, r3 } = GEO;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const need = (v, fn, name) => { if (v === undefined || v === null) throw new Error(`${fn}: missing input "${name}".`); return v; };
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };

export const CORE_CAUTION = "Elevator counts and core sizes are seeds for early design. Verify them with a vertical transportation consultant.";

/** Room kinds of an auto core (rework plan 4.4). */
export const CORE_ROOM_KINDS = ["stair", "elevator", "service-elevator", "trash", "electrical", "shaft", "linen", "ice", "data"];

const ROOM_CODE = { stair: "S", elevator: "E", "service-elevator": "SE", trash: "TR", electrical: "EL", shaft: "SH", linen: "LN", ice: "IC", data: "DA" };

/** Core mode: "auto" | "manual" | "none" (the load rule: a rect with no mode is manual, else auto). */
export const coreModeOf = coreModeOf0;
/** The manual core rectangle, or null. */
export const manualCoreRect = manualCoreRect0;

/** The load rule of rework plan 4.2 for a stored core: → { mode, rect } (a new object). */
export function normalizeCore(core) {
  const c = core && typeof core === "object" ? core : {};
  const rect = Array.isArray(c.rect) && c.rect.length === 4 && c.rect.every(isNum) ? c.rect.slice() : null;
  const mode = c.mode === "auto" || c.mode === "manual" || c.mode === "none" ? c.mode : rect ? "manual" : "auto";
  return { mode, rect };
}

const modeOf = (state, ctx) => ((ctx && (ctx.mode === "hotel" || ctx.mode === "multifamily")) ? ctx.mode : state && state.mode === "hotel" ? "hotel" : "multifamily");

/** The share-weighted target area A of the mix (hotel: 400 sf per key). */
export function unitAreaOf(state, mode) {
  if (mode === "hotel") return 400;
  const list = state && state.mix && Array.isArray(state.mix.multifamily) && state.mix.multifamily.length ? state.mix.multifamily : MULTIFAMILY_TYPES;
  let s = 0, a = 0;
  for (const t of list) if (isNum(t.share) && t.share > 0 && isNum(t.targetArea)) { s += t.share; a += t.share * t.targetArea; }
  if (s > 0) return a / s;
  const tg = list.filter((t) => isNum(t.targetArea));
  return tg.length ? tg.reduce((x, t) => x + t.targetArea, 0) / tg.length : 900;
}

/** Units on one level by the estimate: round(levelGsf × 0.75 ÷ A). */
const perLevel = (gsf, A) => Math.round((gsf * 0.75) / A);

/**
 * The building context of the core program: groups [{ floors, gsf }] (the filled groups, each with its level GSF).
 * → { floors, units, unitArea, perGroup: [{ floors, gsf, units }] }
 */
export function coreContext(state, groups) {
  need(state, "coreContext", "state");
  const mode = modeOf(state);
  const A = unitAreaOf(state, mode);
  const perGroup = (Array.isArray(groups) ? groups : []).map((g) => ({ floors: g.floors, gsf: g.gsf, units: g.floors * perLevel(g.gsf, A) }));
  return { mode, floors: perGroup.reduce((s, g) => s + g.floors, 0), units: perGroup.reduce((s, g) => s + g.units, 0), unitArea: A, perGroup };
}

/** The two rows of a program, in order: → { row1: [{ kind, len }], row2, R } */
function rowsOf(cabs, service, cw, extra) {
  const cab = (kind) => ({ kind, len: cw });
  const rooms = [...Array.from({ length: service }, () => cab("service-elevator")), ...extra];
  let row1, row2;
  if (cabs > 6) {
    const n1 = Math.ceil(cabs / 2), n2 = cabs - n1;
    row1 = [...Array.from({ length: n1 }, () => cab("elevator")), ...rooms];
    row2 = Array.from({ length: n2 }, () => cab("elevator"));
  } else {
    row1 = Array.from({ length: cabs }, () => cab("elevator"));
    row2 = rooms;
  }
  const len = (row) => row.reduce((s, r) => s + r.len, 0);
  const R = Math.max(len(row1), len(row2));
  for (const row of [row1, row2]) {
    const gap = R - len(row);
    if (gap <= 1e-9) continue;
    const last = row[row.length - 1];
    if (last && last.kind === "shaft") last.len += gap;
    else row.push({ kind: "shaft", len: gap });
  }
  return { row1, row2, R };
}

/**
 * Rework plan 4.4: the auto core program. ctx: { floors, levelGsf, mode?, units? }.
 * → { mode, cabs, autoCabs, service, units, unitArea, floors, cab: [w, d], stair: [w, d], rows: { row1, row2, R },
 *     size: [A, B] (with stairs), area, rooms: [{ kind, size: [a, b] }], notes }
 */
export function coreProgram(state, ctx = {}) {
  need(state, "coreProgram", "state");
  const c = ctx || {};
  const mode = modeOf(state, c);
  const hotel = mode === "hotel";
  const A = unitAreaOf(state, mode);
  const floors = isNum(c.floors) && c.floors > 0 ? Math.round(c.floors) : 1;
  let units;
  if (isNum(c.units)) units = Math.max(0, Math.round(c.units));
  else { need(isNum(c.levelGsf) ? c.levelGsf : null, "coreProgram", "ctx.levelGsf"); units = floors * perLevel(c.levelGsf, A); }
  const per = hotel ? 100 : 90;
  const autoCabs = Math.max(2, Math.ceil(units / per - 1e-9));
  const el = state.elevators || {};
  const cabs = isNum(el.count) ? Math.max(0, Math.round(el.count)) : autoCabs;
  const service = isNum(el.service) ? Math.max(0, Math.round(el.service)) : hotel ? 1 : floors >= 20 ? 1 : 0;
  const st = state.stairs && Array.isArray(state.stairs.size) && state.stairs.size.length === 2 && state.stairs.size.every((v) => isNum(v) && v > 0) ? state.stairs.size : [11, 22];
  const cw = Array.isArray(el.size) && isNum(el.size[0]) && el.size[0] > 0 ? el.size[0] : 8;
  const B = st[1], row = B / 2;
  const extra = [{ kind: "trash", len: 8 }, { kind: "electrical", len: 8 }];
  if (hotel && !(state.hotelBoh && state.hotelBoh.on === false)) extra.push({ kind: "linen", len: 14 }, { kind: "ice", len: 6 }, { kind: "data", len: 6 });
  extra.push({ kind: "shaft", len: 6 });
  const rows = rowsOf(cabs, service, cw, extra);
  const Atot = 2 * st[0] + rows.R;
  const rooms = [
    { kind: "stair", size: [st[0], B] }, { kind: "stair", size: [st[0], B] },
    ...rows.row1.map((r) => ({ kind: r.kind, size: [r.len, row] })),
    ...rows.row2.map((r) => ({ kind: r.kind, size: [r.len, row] })),
  ];
  const notes = [
    hotel
      ? `Passenger cabs: max(2, ceil(${units} keys ÷ 100)) = ${autoCabs}${isNum(el.count) ? `; the elevator count ${cabs} overrides it` : ""}. Service cab: ${service}.`
      : `Passenger cabs: max(2, ceil(${units} units ÷ 90)) = ${autoCabs}${isNum(el.count) ? `; the elevator count ${cabs} overrides it` : ""}. Service cab: ${service}${floors >= 20 ? " (20 floors or more)" : ""}.`,
    `Unit estimate: ${floors} floor${floors === 1 ? "" : "s"} at about ${r1(A)} sf per ${hotel ? "key" : "unit"} (75% of the plate).`,
    CORE_CAUTION,
  ];
  return {
    mode, cabs, autoCabs, service, units, unitArea: A, floors, cab: [cw, row], stair: st.slice(), rows,
    size: [Atot, B], area: Atot * B, rooms, notes,
  };
}

/**
 * Rework plan 4.4: the auto core layout. program: coreProgram(); center: [x, y]; axis: [ux, uy] (unit, along the long side);
 * opts: { withStairs = true }. → { rect: [x0, y0, x1, y1] (axis-aligned cores) | null, outer: Ring, rooms: [{ id, kind, outer }], size: [A, B] }
 */
export function coreLayout2(program, center, axis, state, { withStairs = true } = {}) {
  need(program, "coreLayout2", "program"); need(center, "coreLayout2", "center"); need(axis, "coreLayout2", "axis");
  const L = Math.hypot(axis[0], axis[1]) || 1;
  const u = [axis[0] / L, axis[1] / L], n = [-u[1] + 0, u[0]];
  const [sa, B] = program.stair;
  const R = program.rows.R;
  const A = (withStairs ? 2 * sa : 0) + R;
  const o = [center[0] - u[0] * A / 2 - n[0] * B / 2, center[1] - u[1] * A / 2 - n[1] * B / 2];
  const fr = { o, u, n };
  const counters = {};
  const rooms = [];
  const add = (kind, s0, s1, t0, t1) => {
    if (s1 - s0 < 1e-9) return;
    counters[kind] = (counters[kind] || 0) + 1;
    rooms.push({ id: `${ROOM_CODE[kind] || "R"}${counters[kind]}`, kind, outer: rr3(frameRect(fr, s0, s1, t0, t1)) });
  };
  const s0 = withStairs ? sa : 0;
  if (withStairs) add("stair", 0, sa, 0, B);
  // passenger cabs first (ids E1… in bank order), then the other rooms
  const placed = [];
  let s = s0;
  for (const r of program.rows.row1) { placed.push({ r, a: s, b: s + r.len, t0: B / 2, t1: B }); s += r.len; }
  s = s0;
  for (const r of program.rows.row2) { placed.push({ r, a: s, b: s + r.len, t0: 0, t1: B / 2 }); s += r.len; }
  for (const k of ["elevator", "service-elevator"]) for (const p of placed) if (p.r.kind === k) add(k, p.a, p.b, p.t0, p.t1);
  for (const p of placed) if (p.r.kind !== "elevator" && p.r.kind !== "service-elevator") add(p.r.kind, p.a, p.b, p.t0, p.t1);
  if (withStairs) add("stair", A - sa, A, 0, B);
  const outer = rr3(frameRect(fr, 0, A, 0, B));
  const aligned = Math.abs(u[0]) < 1e-12 || Math.abs(u[1]) < 1e-12;
  let rect = null;
  if (aligned) {
    const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
    rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return { rect, outer, rooms, size: [r3(A), r3(B)] };
}

/**
 * Rework plan 4.4: the auto core of a point plate. plate: MultiPoly; level: a levels.js level (seeds); state; ctx: as
 * coreProgram. → { outer, rect, rooms, program, size, axis, center, withStairs }
 */
export function autoCore(plate, level, state, ctx = {}) {
  need(plate, "autoCore", "plate"); need(state, "autoCore", "state");
  const P = asMP(plate);
  if (!P.length) throw new Error('autoCore: the input "plate" has no ring.');
  const c = { ...(ctx || {}) };
  if (!isNum(c.units) && !isNum(c.levelGsf)) c.levelGsf = mpArea(P);
  const program = coreProgram(state, c);
  const m = minRect(P);
  const axis = m ? m.u : [1, 0];
  const center = centroidOf(P);
  const seeds = (level && Array.isArray(level.seeds) ? level.seeds : []).filter((x) => x && (x.kind === "stair" || x.kind === "exterior-stair"));
  const stairMode = state.stairs && state.stairs.mode;
  const withStairs = stairMode !== "manual" && !(stairMode === "seeds" || seeds.length);
  const lay = coreLayout2(program, center, axis, state, { withStairs });
  return { outer: lay.outer, rect: lay.rect, rooms: lay.rooms, program, size: lay.size, axis: axis.slice(), center: [r3(center[0]), r3(center[1])], withStairs };
}
