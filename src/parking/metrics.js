/* ==========================================================================
   metrics.js — metrics and design checks (Parking Deck Generator)

   Contract: docs/parking-deck-technical-plan.md sections 3.10, 3.11 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs. Areas come from
   src/midrise/bars.js (ringArea, multiPolyArea, clipAreaConvex).

   Arguments after `built`:
   - ramps: the rampsFor result ([{ id, type, level, rise, length, slope,
     limit, ok, footprint }]).
   - columns: the columnsFor result ({ lines, points, module }).
   - accessible: the placeAccessible result. Its `stalls` are the final
     stalls. Without it the built stalls count and nothing is reported lost.
   - project: the loaded project document or null (units, overlay).

   Caution: these are design checks against editable values, not a code review.

   Rule choices where the plan leaves room:
   - Gross deck area = sum of level plate areas - the liner strip on the
     levels the liner lists. The strip is [0, depth] from the chosen side of
     the layout frame, clipped to the plate.
   - Parking area = final stall areas + the accessible aisle slots (lost x
     stallW x stallD) + aisles + turn zones, over all levels. Efficiency =
     parking area / gross.
   - Required parking = ceil(units x ratio + retailSf / 1000 x 3). units =
     state.required.units, else massing.derived.metrics.units, else 0.
   - EV: installed = stalls of kind "ev"; ready = stalls with evReady. The
     targets (round(stalls x share)) are reported beside them. Tagging is the
     layout's job; this file counts the tags.
   - Clear height per level = level ftf - structureDepth[span]; the lowest
     index level is level 1 (ftf1, van route); the others use clearGeneral.
     The top level of an open-top deck has no structure above: clear null,
     ok true, open true (same as grid.clearHeights).
   - Warnings use the layout's shape { code, severity, floors, message }.
     Core warnings the layout already raised (built.warnings, same code and
     id) are not raised twice.
   - Top of deck = floor surface of the top level above baseZ (openTop), plus
     its own floor-to-floor when openTop is false. That is the sum of the
     floor-to-floors below the top level, above grade.
   - built.bays may be the bays array or the baysOf object; built.strip may
     sit on either (both are read).
   ========================================================================== */

import { ringArea, multiPolyArea, clipAreaConvex } from "../midrise/bars.js";
import { requiredAccessible, aisleLength } from "./accessible.js";
import { overlay } from "./overlay.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const ceilEps = (v) => Math.ceil(v - 1e-9);
const KINDS = ["standard", "compact", "accessible", "van", "ev"];
const RETAIL_PER_1000 = 3;

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function fmtFtIn(ft) {
  const inches = Math.round(ft * 12);
  return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

function stripOf(built) {
  if (built.strip) return built.strip;
  return built.bays && !Array.isArray(built.bays) && built.bays.strip ? built.bays.strip : null;
}

/** The liner strip as a rectangle in the layout frame, or null. */
function linerRect(state, frame) {
  const ln = state.liner;
  if (!ln || !ln.on || !isNum(ln.depth) || ln.depth <= 0) return null;
  const W = frame.W, D = frame.D, d = ln.depth;
  switch (ln.side) {
    case "north": return rect(0, D - d, W, D);
    case "east": return rect(W - d, 0, W, D);
    case "west": return rect(0, 0, d, D);
    default: return rect(0, 0, W, d);
  }
}

function clearOf(state, level, lowest) {
  const g = state.grid || {};
  const depth = g.structureDepth && isNum(g.structureDepth[g.span]) ? g.structureDepth[g.span] : 0;
  const lv = state.levels || {};
  const ftf = isNum(level.ftf) ? level.ftf : lowest ? lv.ftf1 : lv.ftf;
  return { ftf, clear: r3(ftf - depth), depth };
}

/* -------------------------------------------------------------- metrics */

/** Plan 3.11. → one object with a row for every metric:
    stalls, byLevel, byKind, grossArea, sfPerStall, parkingArea, efficiency,
    required { units, unitsSource, ratio, retailSf, total }, balance,
    accessible { required, provided, van, car, lost, aisleLength, table, r2 },
    ev { installed, ready, targetInstalled, targetReady }, bike { required,
    rack, areaSf, wallFt }, rampSlopes, maxRampSlope, clearHeights,
    lowestClear, columns { perLevel, total, module, conflicts, source,
    suggestion }, conflicts, levels, topOfDeck. */
export function computeMetrics(state, built, ramps, columns, accessible, project) {
  need(state && state.bays && state.levels && state.required, "computeMetrics", "state.bays, state.levels and state.required");
  need(built && Array.isArray(built.levels) && built.frame, "computeMetrics", "built.levels and built.frame");
  const levels = built.levels;
  const stalls = accessible && Array.isArray(accessible.stalls) ? accessible.stalls : levels.flatMap((l) => l.stalls || []);
  const n = stalls.length;
  const stallArea = state.bays.stallW * state.bays.stallD;

  // by level, by kind
  const byLevel = levels.map((lv) => ({ index: lv.index, stalls: stalls.filter((s) => s.level === lv.index).length }));
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const s of stalls) byKind[KINDS.includes(s.kind) ? s.kind : "standard"]++;

  // areas
  const liner = linerRect(state, built.frame);
  const linerLevels = new Set(state.liner && Array.isArray(state.liner.levels) ? state.liner.levels : []);
  let gross = 0, parkingArea = 0;
  for (const lv of levels) {
    gross += multiPolyArea(lv.plate);
    if (liner && linerLevels.has(lv.index)) gross -= clipAreaConvex(lv.plate, liner);
    parkingArea += multiPolyArea(lv.aisles) + multiPolyArea(lv.turnZones);
  }
  for (const s of stalls) parkingArea += Math.abs(ringArea(s.outer));
  const lost = accessible && isNum(accessible.lost) ? accessible.lost : 0;
  parkingArea += lost * stallArea;
  gross = r1(gross);
  parkingArea = r1(parkingArea);

  // required parking and balance
  const rq = state.required;
  const massUnits = project && project.sections && project.sections.massing && project.sections.massing.derived
    && project.sections.massing.derived.metrics ? project.sections.massing.derived.metrics.units : null;
  const unitsSource = isNum(rq.units) ? "typed" : isNum(massUnits) ? "massing" : "none";
  const units = unitsSource === "typed" ? rq.units : unitsSource === "massing" ? massUnits : 0;
  const retailSf = isNum(rq.retailSf) ? rq.retailSf : 0;
  const ratio = isNum(rq.ratio) ? rq.ratio : 0;
  const total = ceilEps(units * ratio + (retailSf / 1000) * RETAIL_PER_1000);

  // accessible
  const n0 = accessible && isNum(accessible.n0) ? accessible.n0 : n;
  const need0 = accessible && accessible.need ? accessible.need : state.accessible ? requiredAccessible(n0, state.accessible, state.source) : { table: 0, r2: null, required: 0, van: 0, car: 0 };
  const acc = {
    required: need0.required,
    provided: byKind.accessible + byKind.van,
    van: need0.van,
    car: need0.car,
    lost,
    aisleLength: state.accessible ? aisleLength(need0.van, need0.car, state.accessible) : 0,
    table: need0.table,
    r2: need0.r2,
  };

  // EV
  const ev = state.ev || {};
  const evOut = {
    installed: byKind.ev,
    ready: stalls.filter((s) => s.evReady).length,
    targetInstalled: Math.round(n * (isNum(ev.installedShare) ? ev.installedShare : 0)),
    targetReady: Math.round(n * (isNum(ev.readyShare) ? ev.readyShare : 0)),
  };

  // bike
  const bk = state.bike || {};
  const bikes = bk.mode === "per-units" ? (units > 0 && isNum(bk.perUnits) && bk.perUnits > 0 ? ceilEps(units / bk.perUnits) : 0) : isNum(bk.count) ? bk.count : 0;
  const two = bk.rack === "two-tier";
  const bike = { required: bikes, rack: two ? "two-tier" : "single", areaSf: two ? 0 : bikes * 12, wallFt: two ? bikes * 1.25 : 0 };

  // ramps
  const rampList = Array.isArray(ramps) ? ramps : [];
  const rampSlopes = rampList.map((r) => ({ id: r.id, type: r.type, level: r.level, slope: r.slope, limit: r.limit, ok: r.ok !== false && !(isNum(r.limit) && r.slope > r.limit + 1e-9) }));
  const maxRampSlope = rampSlopes.reduce((m, r) => Math.max(m, isNum(r.slope) ? Math.abs(r.slope) : 0), 0);

  // clear height
  const lowestIndex = levels.reduce((m, l) => Math.min(m, l.index), Infinity);
  const lim = state.checks || {};
  const topIndex = levels.reduce((m, l) => Math.max(m, l.index), -Infinity);
  const openTop = state.levels.openTop !== false;
  const clearHeights = levels.map((lv) => {
    const first = lv.index === lowestIndex;
    const c = clearOf(state, lv, first);
    const min = first ? lim.clearVan : lim.clearGeneral;
    if (openTop && lv.index === topIndex) return { level: lv.index, ftf: c.ftf, clear: null, min, ok: true, open: true };
    return { level: lv.index, ftf: c.ftf, clear: c.clear, min, ok: isNum(min) ? c.clear >= min - 1e-6 : true, open: false };
  });
  const lowestClear = clearHeights.reduce((m, c) => (c.clear === null ? m : Math.min(m, c.clear)), Infinity);

  // columns and overlay
  const perLevel = columns && Array.isArray(columns.points) ? columns.points.length : 0;
  const ov = overlay(state, built, project, columns);

  // top of deck
  const sorted = levels.slice().sort((a, b) => a.index - b.index);
  const top = sorted[sorted.length - 1];
  let topOfDeck = 0;
  if (top) {
    const below = isNum(state.levels.belowGrade) ? state.levels.belowGrade : 0;
    const zTop = isNum(top.z) ? top.z : sorted.slice(0, -1).filter((l) => l.index > below).reduce((s, l) => s + (isNum(l.ftf) ? l.ftf : 0), 0);
    topOfDeck = r3(zTop + (state.levels.openTop === false && isNum(top.ftf) ? top.ftf : 0));
  }

  return {
    stalls: n,
    byLevel,
    byKind,
    grossArea: gross,
    sfPerStall: n > 0 ? r1(gross / n) : 0,
    parkingArea,
    efficiency: gross > 0 ? r3(parkingArea / gross) : 0,
    required: { units, unitsSource, ratio, retailSf, total },
    balance: n - total,
    accessible: acc,
    ev: evOut,
    bike,
    rampSlopes,
    maxRampSlope,
    clearHeights,
    lowestClear: Number.isFinite(lowestClear) ? lowestClear : 0,
    columns: {
      perLevel, total: perLevel * levels.length, module: columns && isNum(columns.module) ? columns.module : 0,
      conflicts: ov.conflicts.length, source: ov.source, suggestion: ov.suggestion,
    },
    conflicts: ov.conflicts.length,
    levels: levels.length,
    topOfDeck,
  };
}

/* -------------------------------------------------------------- checks */

function warn(code, message, floors = [], severity = "warn", extra = {}) {
  return { code, severity, floors, message, ...extra };
}

/** Plan 3.10. → Warning[] ({ code, severity, floors, message, id?, action? }, the
    same shape layout() raises), in the order of the plan's table. */
export function checks(state, built, ramps, metrics) {
  need(state && state.checks && state.levels, "checks", "state.checks and state.levels");
  need(built && Array.isArray(built.levels) && built.frame, "checks", "built.levels and built.frame");
  need(metrics && Array.isArray(metrics.clearHeights), "checks", "metrics");
  const lim = state.checks;
  const out = [];
  const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;

  // ramp slope
  for (const r of Array.isArray(ramps) ? ramps : []) {
    if (r.ok === false || (isNum(r.limit) && r.slope > r.limit + 1e-9)) {
      out.push(warn("ramp-slope", `${r.id} slope ${pct(r.slope)} is above the ${pct(r.limit)} limit.`, isNum(r.level) ? [r.level] : []));
    }
  }

  // clear height
  const depth = state.grid && state.grid.structureDepth ? state.grid.structureDepth[state.grid.span] : 0;
  const ceilHalf = (v) => Math.ceil(v * 2 - 1e-9) / 2;
  for (const c of metrics.clearHeights) {
    if (c.ok) continue;
    const van = c.min === lim.clearVan;
    const fix = ceilHalf(c.min + depth);
    out.push(warn(van ? "clear-height-van" : "clear-height",
      `Level ${c.level} clear height ${fmtFtIn(c.clear)} is below the ${fmtFtIn(c.min)} ${van ? "van route" : "general minimum"}. Set level ${c.level} floor-to-floor to ${fix} ft.`, [c.level]));
  }

  // barrier
  if (isNum(lim.barrierProvided) && isNum(lim.barrier) && lim.barrierProvided < lim.barrier - 1e-9) {
    out.push(warn("barrier-height", `The vehicle barrier is ${fmtFtIn(lim.barrierProvided)}; the check value is ${fmtFtIn(lim.barrier)}.`));
  }
  if (built.levels.length > 1 && isNum(lim.barrierProvided) && isNum(lim.guard) && lim.barrierProvided < lim.guard - 1e-9) {
    out.push(warn("guard-height", `The edge barrier is ${fmtFtIn(lim.barrierProvided)}; open sides above level 1 check at ${fmtFtIn(lim.guard)}.`));
  }

  // cores (the layout raises these too; skip a core it already flagged)
  const raised = new Set((Array.isArray(built.warnings) ? built.warnings : []).map((w) => `${w.code}|${w.id}`));
  const cores = Array.isArray(built.cores) ? built.cores : Array.isArray(state.cores) ? state.cores : [];
  for (const c of cores) {
    if (!c || !isNum(c.x) || !isNum(c.y)) continue;
    const w = isNum(c.w) ? c.w : c.kind === "elevator" ? 10 : 22, d = isNum(c.d) ? c.d : c.kind === "elevator" ? 10 : 12;
    const r = rect(c.x, c.y, c.x + w, c.y + d);
    const inAisle = built.levels.filter((lv) => clipAreaConvex(lv.aisles, r) > 1).map((lv) => lv.index);
    if (inAisle.length && !raised.has(`core-in-aisle|${c.id}`)) {
      out.push(warn("core-in-aisle", `${c.id} sits in the drive aisle. Use "Move to nearest row".`, inAisle, "warn", { id: c.id, action: "move-to-row" }));
    }
    const outside = built.levels.filter((lv) => clipAreaConvex(lv.plate, r) < w * d - 1).map((lv) => lv.index);
    if (outside.length && !raised.has(`core-outside|${c.id}`)) out.push(warn("core-outside", `${c.id} extends outside the footprint.`, outside, "warn", { id: c.id }));
  }

  // strip
  const strip = stripOf(built);
  if (strip && isNum(strip.y0) && isNum(strip.y1) && strip.y1 - strip.y0 > 10) {
    const sr = rect(0, strip.y0, built.frame.W, strip.y1);
    const used = (Array.isArray(ramps) ? ramps : []).some((r) => Array.isArray(r.footprint) && r.footprint.length >= 3 && clipAreaConvex([{ outer: r.footprint, holes: [] }], sr) > 1);
    if (!used) out.push(warn("unused-strip", `The leftover strip is ${r3(strip.y1 - strip.y0)} ft deep and no ramp uses it.`, [], "info"));
  }

  // parking balance, accessible count, overlay
  if (metrics.required && metrics.required.total > 0 && metrics.balance < 0) {
    out.push(warn("parking-deficit", `Parking provided is ${-metrics.balance} stalls short of the ${metrics.required.total} required.`));
  }
  if (metrics.accessible && metrics.accessible.provided < metrics.accessible.required) {
    out.push(warn("accessible-short", `${metrics.accessible.provided} accessible stalls are placed; ${metrics.accessible.required} are required.`));
  }
  if (metrics.conflicts > 0) {
    out.push(warn("column-overlay", `${metrics.conflicts} columns sit more than ${lim.overlayTolerance} ft from a unit demising line.`, [], "info"));
  }
  return out;
}
