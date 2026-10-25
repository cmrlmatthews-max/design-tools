/* ==========================================================================
   plate/core.js — the auto core of the Plate Planner (rework plan sections 4.2 and 4.4)

   coreProgram(state, ctx)                         → { mode, cabs, autoCabs, service, units, unitArea, floors, rows: { top, mid, bottom, R },
                                                       k, split, size, area, rooms, notes, options, depths? }   ctx.fit optional
   coreLayout2(program, center, axis, state, opts) → { rect, outer, rooms: [{ id, kind, outer }], size }
   autoCore(plate, level, state, ctx)              → { outer, rect, rooms, program, size, axis, center }
   manualCoreRooms(program, rect, opts)            → { fits, rooms, size, need? } (the program inside a manual core rectangle)
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
   - Rows of 11 ft. Layout options (review of the rework): k = 2 or 3 rows (core depth 22 or 33), and the passenger cabs
     n1 in the top outer row, n2 in the bottom outer row, for every n1 from n down to ceil(n ÷ 2) (two banks facing
     opposite corridors). Cabs and service cabs sit only in the outer rows. The service cabs, then trash and electrical,
     go to the shorter outer row (ties: bottom); with k = 3, trash and electrical go to the middle row when the outer
     row has no room (it would pass the longest cab row), and linen, ice, data and the shaft go to the middle row.
     With k = 2 every room goes to the shorter outer row. Each row fills to R (its last shaft stretches, else a new
     shaft). Stairs 11 × 22 at the two ends; with k = 3 an 11 × 11 shaft beside each stair. Cab width =
     state.elevators.size[0] (8 ft). Every square foot of the core is a named room.
   - Choice: with ctx.fit = { long, short, width, ext } (autoCore passes the plate's minimum-area rectangle), the option
     with the smallest |d_long − d_short|, d = (side − core side − 2 × corridor) ÷ 2 − extWall; then the smaller core
     area; then fewer rows; then fewer split cabs. Without a fit: the smallest area, then fewer rows, then fewer split cabs.
     program.options lists every option (with depths when a fit is given); program.k, .split, .depths the chosen one.
   - Core length A = 2 × stair width + R. Without core stairs (stairs mode "manual", or stair seeds): A = R, no stair rooms.
   - Frame: u along the plate's long axis (minimum-area rectangle; a near-square plate: east-west), n = u turned 90
     degrees counter-clockwise; the core is centered on the plate's area centroid; row 1 is on the +n side.
   - Room ids: S1, S2 (stairs), E1… (cabs, top row then bottom row), SE1 (service cab), TR1 (trash), EL1 (electrical),
     SH1… (shafts), LN1, IC1, DA1. Rows: bottom t 0..11, middle 11..22, top B − 11..B (t along n).
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

const rowLen = (row) => row.reduce((x, r) => x + r.len, 0);

/**
 * One layout option: k rows of 11 ft (2 or 3), n1 passenger cabs in the top outer row and n2 in the bottom outer row.
 * Cabs and service cabs sit only in the outer rows. The service cabs, then trash and electrical, go to the shorter
 * outer row (ties: the bottom row); with k = 3, trash and electrical move to the middle row when an outer row has no
 * room left (it would grow past the longest cab row), and the other rooms (linen, ice, data, shaft) go to the middle
 * row. With k = 2 every room goes to the shorter outer row. Each row then fills to R: its last room stretches when it
 * is a shaft, else a new shaft room takes the missing length. With k = 3 an 11 × 11 shaft sits beside each stair.
 * → { k, split: [n1, n2], rows: { top, mid, bottom, R, row1, row2 }, size: [A, B], area }
 */
function layoutOption(k, n1, n2, service, cw, extra, stair) {
  const cab = (kind) => ({ kind, len: cw });
  const top = Array.from({ length: n1 }, () => cab("elevator"));
  const bottom = Array.from({ length: n2 }, () => cab("elevator"));
  const mid = [];
  const shorter = () => (rowLen(top) < rowLen(bottom) - 1e-9 ? top : bottom);
  for (let i = 0; i < service; i++) shorter().push(cab("service-elevator"));
  const rCab = Math.max(rowLen(top), rowLen(bottom));
  for (const r of extra) {
    const outerKind = r.kind === "trash" || r.kind === "electrical";
    if (k === 2) { shorter().push({ ...r }); continue; }
    if (outerKind) {
      const row = shorter();
      if (rowLen(row) + r.len <= rCab + 1e-9) { row.push({ ...r }); continue; }
    }
    mid.push({ ...r });
  }
  const rows = k === 3 ? [top, mid, bottom] : [top, bottom];
  const R = Math.max(...rows.map(rowLen));
  for (const row of rows) {
    const gap = R - rowLen(row);
    if (gap <= 1e-9) continue;
    const last = row[row.length - 1];
    if (last && last.kind === "shaft") last.len += gap;
    else row.push({ kind: "shaft", len: gap });
  }
  const B = 11 * k;
  const A = 2 * stair[0] + R;
  return { k, split: [n1, n2], rows: { top, mid, bottom, R, row1: top, row2: bottom }, size: [A, B], area: A * B };
}

/**
 * The area depths an option leaves on a plate (rework review): d_long = (long side − A − 2 × corridor) ÷ 2 − extWall,
 * d_short = (short side − B − 2 × corridor) ÷ 2 − extWall. fit: { long, short, width, ext }.
 */
function depthsOf(opt, fit) {
  return [(fit.long - opt.size[0] - 2 * fit.width) / 2 - fit.ext, (fit.short - opt.size[1] - 2 * fit.width) / 2 - fit.ext];
}

/** Option order: with a plate, the smallest |d_long − d_short|; then the smaller area; then fewer rows; then fewer split cabs. */
function chooseOption(options, fit) {
  const key = (o) => {
    const d = fit ? depthsOf(o, fit) : [0, 0];
    return [fit ? Math.round(Math.abs(d[0] - d[1]) * 1e6) : 0, Math.round(o.area * 1e6), o.k, o.split[1]];
  };
  let best = null, bk = null;
  const less = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  for (const o of options) { const kk = key(o); if (!best || less(kk, bk)) { best = o; bk = kk; } }
  return best;
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
  const row = 11;
  const extra = [{ kind: "trash", len: 8 }, { kind: "electrical", len: 8 }];
  if (hotel && !(state.hotelBoh && state.hotelBoh.on === false)) extra.push({ kind: "linen", len: 14 }, { kind: "ice", len: 6 }, { kind: "data", len: 6 });
  extra.push({ kind: "shaft", len: 6 });
  const st2 = [st[0], st[1]];
  // the layout options: 2 or 3 rows; the cabs in one outer row or split between both (two banks)
  const options = [];
  for (const k of [2, 3]) {
    for (let n1 = cabs; n1 >= Math.ceil(cabs / 2); n1--) options.push(layoutOption(k, n1, cabs - n1, service, cw, extra, st2));
  }
  const fit = c.fit && isNum(c.fit.long) && isNum(c.fit.short) ? { long: c.fit.long, short: c.fit.short, width: isNum(c.fit.width) ? c.fit.width : 5.67, ext: isNum(c.fit.ext) ? c.fit.ext : 1.0 } : null;
  const chosen = chooseOption(options, fit);
  const { rows, size } = chosen;
  const Atot = size[0], Bk = size[1];
  const rooms = [
    { kind: "stair", size: [st[0], st[1]] }, { kind: "stair", size: [st[0], st[1]] },
    ...(chosen.k === 3 ? [{ kind: "shaft", size: [st[0], Bk - st[1]] }, { kind: "shaft", size: [st[0], Bk - st[1]] }] : []),
    ...[rows.top, rows.mid, rows.bottom].flatMap((rw) => rw.map((r) => ({ kind: r.kind, size: [r.len, row] }))),
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
    k: chosen.k, split: chosen.split.slice(), size: [Atot, Bk], area: Atot * Bk, rooms, notes,
    options: options.map((o) => ({ k: o.k, split: o.split.slice(), size: o.size.slice(), area: o.area, ...(fit ? { depths: depthsOf(o, fit).map((v) => Math.round(v * 1000) / 1000) } : {}) })),
    ...(fit ? { depths: depthsOf(chosen, fit).map((v) => Math.round(v * 1000) / 1000) } : {}),
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
  const sa = program.stair[0], sb = program.stair[1];
  const k = program.k || 2;
  const B = isNum(program.size && program.size[1]) ? program.size[1] : 11 * k;
  const R = program.rows.R;
  const A = (withStairs ? 2 * sa : 0) + R;
  const o = [center[0] - u[0] * A / 2 - n[0] * B / 2, center[1] - u[1] * A / 2 - n[1] * B / 2];
  const fr = { o, u, n };
  const counters = {};
  const rooms = [];
  const add = (kind, s0, s1, t0, t1) => {
    if (s1 - s0 < 1e-9 || t1 - t0 < 1e-9) return;
    counters[kind] = (counters[kind] || 0) + 1;
    rooms.push({ id: `${ROOM_CODE[kind] || "R"}${counters[kind]}`, kind, outer: rr3(frameRect(fr, s0, s1, t0, t1)) });
  };
  const s0 = withStairs ? sa : 0;
  if (withStairs) add("stair", 0, sa, 0, sb);
  // rows: bottom t 0..11, middle 11..22 (k = 3), top B − 11..B; passenger cabs first (ids E1… top row then bottom row)
  const placed = [];
  const lay = (row, t0, t1) => { let s = s0; for (const r of row) { placed.push({ r, a: s, b: s + r.len, t0, t1 }); s += r.len; } };
  lay(program.rows.top || program.rows.row1, B - 11, B);
  if (k === 3) lay(program.rows.mid || [], 11, 22);
  lay(program.rows.bottom || program.rows.row2, 0, 11);
  for (const kd of ["elevator", "service-elevator"]) for (const p of placed) if (p.r.kind === kd) add(kd, p.a, p.b, p.t0, p.t1);
  if (withStairs && B > sb + 1e-9) add("shaft", 0, sa, sb, B);
  for (const p of placed) if (p.r.kind !== "elevator" && p.r.kind !== "service-elevator") add(p.r.kind, p.a, p.b, p.t0, p.t1);
  if (withStairs && B > sb + 1e-9) add("shaft", A - sa, A, sb, B);
  if (withStairs) add("stair", A - sa, A, 0, sb);
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
 * Draw plan follow-up: the core program laid inside a manual core rectangle [x0, y0, x1, y1]. The rows run along the
 * long side; each row's last room stretches (a shaft) to fill the length; the depth beyond the rows is one shaft between
 * them; with core stairs, each stair column is the stair (11 × 22) and a shaft above it. Every square foot is a named room.
 * opts.toward: a point; the top row (the passenger cabs) goes to the side of the core that faces it.
 * → { fits: true, rooms: [{ id, kind, outer }], size: [A, B] } or { fits: false, rooms: [], need: [A, B], size }
 */
export function manualCoreRooms(program, rect, { withStairs = true, toward = null } = {}) {
  need(program, "manualCoreRooms", "program"); need(rect, "manualCoreRooms", "rect");
  const [x0, y0, x1, y1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const w = x1 - x0, h = y1 - y0;
  const alongX = w >= h;
  const A = alongX ? w : h, B = alongX ? h : w;
  let fr = alongX ? { o: [x0, y0], u: [1, 0], n: [0, 1] } : { o: [x1, y0], u: [0, 1], n: [-1, 0] };
  // the cab row (the +n side) faces `toward` (a bar core: the corridor) when it is given
  if (Array.isArray(toward)) {
    const c = [(x0 + x1) / 2, (y0 + y1) / 2];
    if ((toward[0] - c[0]) * fr.n[0] + (toward[1] - c[1]) * fr.n[1] < 0) fr = alongX ? { o: [x0, y1], u: [1, 0], n: [0, -1] } : { o: [x0, y0], u: [0, 1], n: [1, 0] };
  }
  const sa = program.stair[0], sb = program.stair[1];
  const k = program.k || 2;
  const R = program.rows.R;
  const needA = (withStairs ? 2 * sa : 0) + R, needB = Math.max(11 * k, withStairs ? sb : 0);
  if (A < needA - 1e-6 || B < needB - 1e-6) return { fits: false, rooms: [], need: [r3(needA), r3(needB)], size: [r3(A), r3(B)] };
  const s0 = withStairs ? sa : 0, s1 = A - (withStairs ? sa : 0), R2 = s1 - s0;
  const stretch = (row) => {
    const list = (row || []).map((r) => ({ ...r }));
    const gap = R2 - rowLen(list);
    if (gap > 1e-9) { const last = list[list.length - 1]; if (last && last.kind === "shaft") last.len += gap; else list.push({ kind: "shaft", len: gap }); }
    return list;
  };
  const counters = {};
  const rooms = [];
  const add = (kind, a, b, t0, t1) => {
    if (b - a < 1e-9 || t1 - t0 < 1e-9) return;
    counters[kind] = (counters[kind] || 0) + 1;
    rooms.push({ id: `${ROOM_CODE[kind] || "R"}${counters[kind]}`, kind, outer: rr3(frameRect(fr, a, b, t0, t1)) });
  };
  const placed = [];
  const lay = (row, t0, t1) => { let x = s0; for (const r of row) { placed.push({ r, a: x, b: x + r.len, t0, t1 }); x += r.len; } };
  lay(stretch(program.rows.top), B - 11, B);
  if (k === 3) lay(stretch(program.rows.mid), 11, 22);
  lay(stretch(program.rows.bottom), 0, 11);
  if (withStairs) add("stair", 0, sa, 0, sb);
  for (const kd of ["elevator", "service-elevator"]) for (const p of placed) if (p.r.kind === kd) add(kd, p.a, p.b, p.t0, p.t1);
  if (withStairs && B > sb + 1e-9) add("shaft", 0, sa, sb, B);
  for (const p of placed) if (p.r.kind !== "elevator" && p.r.kind !== "service-elevator") add(p.r.kind, p.a, p.b, p.t0, p.t1);
  const band0 = 11 * (k === 3 ? 2 : 1);
  if (B - 11 - band0 > 1e-9) add("shaft", s0, s1, band0, B - 11);
  if (withStairs && B > sb + 1e-9) add("shaft", A - sa, A, sb, B);
  if (withStairs) add("stair", A - sa, A, 0, sb);
  return { fits: true, rooms, size: [r3(A), r3(B)] };
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
  const m = minRect(P);
  if (m && !c.fit) {
    const cw = state.corridor && isNum(state.corridor.width) && state.corridor.width > 0 ? state.corridor.width : state.mode === "hotel" ? 6.0 : 5.67;
    c.fit = { long: m.long, short: m.short, width: cw, ext: isNum(state.extWall) && state.extWall >= 0 ? state.extWall : 1.0 };
  }
  const program = coreProgram(state, c);
  const axis = m ? m.u : [1, 0];
  const center = centroidOf(P);
  const seeds = (level && Array.isArray(level.seeds) ? level.seeds : []).filter((x) => x && (x.kind === "stair" || x.kind === "exterior-stair"));
  const stairMode = state.stairs && state.stairs.mode;
  const withStairs = stairMode !== "manual" && !(stairMode === "seeds" || seeds.length);
  const lay = coreLayout2(program, center, axis, state, { withStairs });
  return { outer: lay.outer, rect: lay.rect, rooms: lay.rooms, program, size: lay.size, axis: axis.slice(), center: [r3(center[0]), r3(center[1])], withStairs };
}
