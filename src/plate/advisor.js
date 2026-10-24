/* ==========================================================================
   plate/advisor.js — the efficiency advisor of the Plate Planner (rework plan section 6)

   advise(state, built, metrics, { fillPlate }) → [{ code, severity, message, current, suggested, gain, where }]
     state      the plate state
     built      buildPlates(state, …) result
     metrics    computeMetrics(state, built) result (optional: the numbers come from the fill when it is missing)
     fillPlate  buildPlates, injected so that this module has no import cycle; it makes the real test fit of
                plate-too-deep. Without it, plate-too-deep carries no test fit.
   ADVISOR_CAUTION   the caution line for the card

   Caution: design-stage numbers from a test fit. The advisor never edits the massing.

   Rule choices where the plan leaves room:
   - One group is advised: state.levels.selected when it is a built group, else the group with the most floors
     (ties: the first). `where.group` names it.
   - Target area depth: state.targetDepth, else multifamily 30 ft, hotel 26 ft. A run is too deep when its depth is more
     than target + 2 ft.
   - plate-too-deep: the deep runs are sorted into the two axes of the plate's minimum-area rectangle by their direction.
     A run along an axis is deep across the other axis, so that other side is the one to narrow. The suggested side:
     point plates core extent + 2 × corridor width + 2 × (target + extWall); bars 2 × (target + extWall) + corridor
     width; single-loaded target + 2 × extWall + corridor width. A side is suggested only when it is shorter than now.
     The plate is rectangular when plate area ÷ the rectangle area ≥ 0.98 (one piece, no holes). The test fit is a
     drawn rectangle at the suggested size with the same state, except: no locks, no support blocks, no typed spine,
     auto stairs, the same corridor kind, an auto core with the same elevator counts (a point plate) or no core (a bar).
   - gain is square feet per floor: plate-too-deep the gross area less per floor (current GSF − test-fit GSF);
     core-oversize the manual core area − the auto program area; unfilled-runs the unfilled area; efficiency-low
     (0.75 − efficiency) × GSF; plate-too-shallow 0. Items sort by gain, largest first (ties: the code order below).
   - Numbers in messages: feet to one decimal (no ".0"), square feet rounded with thousands separators, percent to one
     decimal. Short sentences, active voice, no contractions (ASD-STE100 style).
   ========================================================================== */

import { GEO, minRect } from "./corridor.js";
import { coreProgram } from "./core.js";

const { asMP, mpArea, ringArea } = GEO;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const need = (v, fn, name) => { if (v === undefined || v === null) throw new Error(`${fn}: missing input "${name}".`); return v; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
const r4 = (v) => { const r = Math.round(v * 10000) / 10000; return r === 0 ? 0 : r; };

export const ADVISOR_CAUTION = "Design-stage numbers from a test fit. The advisor does not change the massing.";

const ORDER = ["plate-too-deep", "core-oversize", "unfilled-runs", "plate-too-shallow", "efficiency-low"];

/** Feet to one decimal: "95.3 ft", "150 ft". */
export function fmtFt(v) { const r = r1(v); return `${Number.isInteger(r) ? String(r) : r.toFixed(1)} ft`; }
/** Square feet with thousands separators: "4,300 sf". */
export function fmtSf(v) { return `${String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} sf`; }
const fmtPct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const listWords = (w) => (w.length <= 1 ? w.join("") : w.length === 2 ? `${w[0]} and ${w[1]}` : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`);

const targetDepthOf = (state) => (isNum(state.targetDepth) && state.targetDepth > 0 ? state.targetDepth : state.mode === "hotel" ? 26 : 30);
const unitArea = (u) => (isNum(u.area) ? u.area : Math.abs(ringArea(u.outer)));

function focusGroup(state, built) {
  const groups = (built && Array.isArray(built.groups) ? built.groups : []).filter((g) => g && g.fill);
  if (!groups.length) return null;
  const sel = state.levels && state.levels.selected;
  const hit = sel ? groups.find((g) => g.id === sel) : null;
  if (hit) return hit;
  let best = groups[0];
  for (const g of groups) if ((g.floors || 1) > (best.floors || 1)) best = g;
  return best;
}

/** Facade side word of a run: the outward normal of its area line, in the plate frame. */
function sideOf(run, center) {
  const dx = run.end[0] - run.start[0], dy = run.end[1] - run.start[1];
  const L = Math.hypot(dx, dy) || 1;
  let nx = -dy / L, ny = dx / L;
  const mx = (run.start[0] + run.end[0]) / 2 - center[0], my = (run.start[1] + run.end[1]) / 2 - center[1];
  if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
  if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? "east" : "west";
  return ny > 0 ? "north" : "south";
}

/** "east–west" for an axis near x, "north–south" for an axis near y, else a plain phrase. */
function axisWord(ax) {
  const a = Math.abs(ax[0]), b = Math.abs(ax[1]);
  if (a > 0.97) return "east–west";
  if (b > 0.97) return "north–south";
  return null;
}

function projExtent(ring, ax) {
  let lo = Infinity, hi = -Infinity;
  for (const p of ring) { const s = p[0] * ax[0] + p[1] * ax[1]; lo = Math.min(lo, s); hi = Math.max(hi, s); }
  return hi - lo;
}

function fillNumbers(fill) {
  const nrsf = fill.units.reduce((s, u) => s + unitArea(u), 0);
  const gsf = mpArea(asMP(fill.plate));
  return { units: fill.units.length, nrsf: r1(nrsf), gsf: r1(gsf), efficiency: gsf > 0 ? r4(nrsf / gsf) : 0 };
}

/** The test-fit state: a drawn rectangle of sides `size` ({ u, n } lengths) along the rectangle axes m. */
function testFitState(state, fill, m, size) {
  const s = clone(state);
  s.source = "drawn";
  const aligned = Math.abs(m.u[0]) < 1e-9 || Math.abs(m.u[1]) < 1e-9;
  if (aligned) {
    const alongX = Math.abs(m.u[0]) > 0.5;
    const w = alongX ? size.u : size.n, d = alongX ? size.n : size.u;
    s.plate = { ...(s.plate || {}), shape: "rect", w: r3(w), d: r3(d), points: [] };
  } else {
    const c = m.center, hu = size.u / 2, hn = size.n / 2;
    const pt = (a, b) => [r3(c[0] + m.u[0] * a + m.n[0] * b), r3(c[1] + m.u[1] * a + m.n[1] * b)];
    s.plate = { ...(s.plate || {}), shape: "polygon", points: [pt(-hu, -hn), pt(hu, -hn), pt(hu, hn), pt(-hu, hn)] };
  }
  s.locks = [];
  s.support = [];
  s.levels = { showPodium: false, selected: null, groups: {} };
  s.corridor = { ...(s.corridor || {}), kind: fill.kind, spine: null };
  s.stairs = { ...(s.stairs || {}), mode: "auto", items: [] };
  s.core = { mode: "auto", rect: null };
  if (fill.kind === "point") {
    const prog = fill.coreProgram;
    if (prog) s.elevators = { ...(s.elevators || {}), count: prog.cabs, service: prog.service };
  }
  return s;
}

function tooDeep(state, built, fill, row, target, fillPlate, where) {
  const limit = target + 2;
  const deep = (fill.runs || []).filter((r) => isNum(r.depth) && r.depth > limit + 1e-9);
  if (!deep.length) return null;
  const P = asMP(fill.plate);
  const m = minRect(P);
  if (!m) return null;
  const center = m.center;
  const sides = [...new Set(deep.map((r) => sideOf(r, center)))];
  const order = ["north", "south", "east", "west"];
  sides.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const dmin = Math.min(...deep.map((r) => r.depth)), dmax = Math.max(...deep.map((r) => r.depth));
  const depthText = Math.abs(dmax - dmin) < 0.05 ? fmtFt(dmax) : `${fmtFt(dmin).replace(" ft", "")} to ${fmtFt(dmax)}`;
  const head = `${cap1(listWords(sides))} units are ${depthText} deep. The target is ${fmtFt(target)}.`;
  const rectangular = P.length === 1 && !P[0].holes.length && mpArea(P) / m.area >= 0.98 - 1e-9;
  const current = { depth: r3(dmax), target, ...row };
  if (!rectangular) {
    return { code: "plate-too-deep", severity: "warn", message: head, current, suggested: { depth: target }, gain: 0, where };
  }
  // the axes to narrow: a run along u is deep across n
  const width = isNum(fill.width) ? fill.width : 5.67;
  const ext = isNum(state.extWall) && state.extWall >= 0 ? state.extWall : 1.0;
  const coreRing = fill.core && fill.core.length >= 3 ? fill.core : null;
  const need2 = { u: false, n: false };
  for (const r of deep) {
    const dx = r.end[0] - r.start[0], dy = r.end[1] - r.start[1], L = Math.hypot(dx, dy) || 1;
    const alongU = Math.abs((dx * m.u[0] + dy * m.u[1]) / L) >= Math.abs((dx * m.n[0] + dy * m.n[1]) / L);
    need2[alongU ? "n" : "u"] = true;
  }
  const cur = { u: m.long, n: m.short };
  const sugg = { u: cur.u, n: cur.n };
  const changes = [];
  for (const k of ["u", "n"]) {
    if (!need2[k]) continue;
    const ax = k === "u" ? m.u : m.n;
    let s;
    if (fill.kind === "point") s = (coreRing ? projExtent(coreRing, ax) : 0) + 2 * width + 2 * (target + ext);
    else if (fill.kind === "single") s = target + 2 * ext + width;
    else s = 2 * (target + ext) + width;
    if (s < cur[k] - 0.05) { sugg[k] = s; changes.push({ k, ax, from: cur[k], to: s }); }
  }
  if (!changes.length) return { code: "plate-too-deep", severity: "warn", message: head, current, suggested: { depth: target }, gain: 0, where };
  const tool = built.source === "project" ? (fill.kind === "point" ? "in the Tower Generator" : "in the massing tool") : "on the Plate tab";
  const parts = changes.map((c) => { const w = axisWord(c.ax); return `${w ? `${w} ` : c.k === "u" ? "along its long side " : "across its short side "}from ${fmtFt(c.from)} to ${fmtFt(c.to)}`; });
  let msg = `${head} Narrow the plate ${parts.join(" and ")} ${tool}.`;
  const suggested = { depth: target, size: { long: r3(sugg.u), short: r3(sugg.n) }, axis: m.u.slice() };
  let gain = 0;
  if (typeof fillPlate === "function") {
    const s2 = testFitState(state, fill, m, sugg);
    suggested.plate = clone(s2.plate);
    try {
      const b2 = fillPlate(s2, { project: null });
      const f2 = b2 && b2.groups && b2.groups[0] && b2.groups[0].fill;
      if (f2) {
        const n2 = fillNumbers(f2);
        Object.assign(suggested, n2, { areaHigh: f2.units.filter((u) => u.areaHigh).length });
        const less = (row.gsf || 0) - n2.gsf;
        gain = r1(Math.max(0, less));
        msg += ` Test fit at that size: ${fmtPct(n2.efficiency)} efficiency, ${n2.units} units per floor, ${fmtSf(less)} ${less >= 0 ? "less" : "more"} per floor.`;
      }
    } catch (e) {
      msg += " The test fit at that size failed.";
    }
  }
  return { code: "plate-too-deep", severity: "warn", message: msg, current, suggested, gain, where };
}

function tooShallow(state, fill, where) {
  const types = state.mix && Array.isArray(state.mix[state.mode === "hotel" ? "hotel" : "multifamily"]) ? state.mix[state.mode === "hotel" ? "hotel" : "multifamily"] : [];
  const out = [];
  const depth = isNum(fill.depth) ? fill.depth : 0;
  for (const d of fill.dropped || []) {
    const t = types.find((x) => x.id === d.id);
    if (!t || !isNum(t.areaMin) || !isNum(t.widthMax) || !(t.share > 0)) continue;
    const dNeed = t.areaMin / t.widthMax;
    if (dNeed <= depth + 1e-9) continue;
    const nm = t.name || t.id;
    out.push({
      code: "plate-too-shallow", severity: "info",
      message: `The ${nm} needs runs ${fmtFt(dNeed)} deep or more. The runs are ${fmtFt(depth)} deep. Make the runs ${fmtFt(dNeed - depth)} deeper or remove the ${nm}.`,
      current: { depth: r3(depth), type: d.id }, suggested: { depth: r3(dNeed), deeperBy: r3(dNeed - depth) }, gain: 0, where: { ...where, type: d.id },
    });
  }
  return out;
}

function coreOversize(state, built, fill, where) {
  if (fill.coreMode !== "manual" || !fill.core) return null;
  const coreArea = Math.abs(ringArea(fill.core));
  const cc = built.coreContext || {};
  const prog = coreProgram(state, isNum(cc.units) ? { floors: cc.floors, units: cc.units } : { floors: 1, levelGsf: mpArea(asMP(fill.plate)) });
  if (!(coreArea > 1.25 * prog.area)) return null;
  const gain = coreArea - prog.area;
  return {
    code: "core-oversize", severity: "warn",
    message: `The core is ${fmtSf(coreArea)}. The program needs ${fmtSf(prog.area)}. Reset the core to auto to gain about ${fmtSf(gain)} per floor.`,
    current: { coreSf: r1(coreArea) }, suggested: { coreSf: r1(prog.area), size: prog.size.slice(), cabs: prog.cabs, service: prog.service }, gain: r1(gain), where,
  };
}

function unfilled(fill, where) {
  const rem = (fill.support || []).filter((s) => s.kind === "remainder");
  if (!rem.length) return null;
  const a = rem.reduce((s, x) => s + Math.abs(ringArea(x.outer)), 0);
  const n = rem.length;
  return {
    code: "unfilled-runs", severity: "warn",
    message: `${n} ${n === 1 ? "run is" : "runs are"} unfilled (${fmtSf(a)}). Move a stair or the core, or fill the run by hand.`,
    current: { runs: n, areaSf: r1(a) }, suggested: null, gain: r1(a), where,
  };
}

/** Rework plan section 6. → [{ code, severity, message, current, suggested, gain, where }] sorted by gain. */
export function advise(state, built, metrics, { fillPlate = null } = {}) {
  need(state, "advise", "state"); need(built, "advise", "built");
  const g = focusGroup(state, built);
  if (!g) return [];
  const fill = g.fill;
  const where = { group: g.id };
  const mrow = metrics && Array.isArray(metrics.groups) ? (metrics.groups.find((x) => x.id === g.id) || {}).row : null;
  const row = mrow ? { units: mrow.units, nrsf: mrow.nrsf, gsf: mrow.gsf, efficiency: mrow.efficiency } : fillNumbers(fill);
  const target = targetDepthOf(state);
  const items = [];
  const deep = tooDeep(state, built, fill, row, target, fillPlate, where);
  if (deep) items.push(deep);
  items.push(...tooShallow(state, fill, where));
  const co = coreOversize(state, built, fill, where);
  if (co) items.push(co);
  const un = unfilled(fill, where);
  if (un) items.push(un);
  if (!items.length && row.efficiency < 0.70) {
    items.push({
      code: "efficiency-low", severity: "info",
      message: `Efficiency is ${fmtPct(row.efficiency)}. Typical test fits reach 75 to 82%.`,
      current: { efficiency: row.efficiency }, suggested: { efficiency: 0.75 }, gain: r1(Math.max(0, (0.75 - row.efficiency) * row.gsf)), where,
    });
  }
  return items.map((it, i) => ({ it, i })).sort((a, b) => (b.it.gain - a.it.gain) || (ORDER.indexOf(a.it.code) - ORDER.indexOf(b.it.code)) || a.i - b.i).map((x) => x.it);
}
