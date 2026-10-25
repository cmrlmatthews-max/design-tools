/* ==========================================================================
   plate/advisor.js — the efficiency advisor of the Plate Planner (rework plan section 6)

   advise(state, built, metrics, { fillPlate }) → [{ code, severity, message, current, suggested, gain, where }]
     state      the plate state
     built      buildPlates(state, …) result
     metrics    computeMetrics(state, built) result (optional: the numbers come from the fill when it is missing)
     fillPlate  fillPlates (fill.js, the automatic fill), injected so that this module has no import cycle; it makes the
                real test fit of plate-too-deep. Without it, plate-too-deep carries no test fit. (Draw plan: buildPlates
                lays out drawn units only, so a test fit needs fillPlates.)
   ADVISOR_CAUTION   the caution line for the card

   Caution: design-stage numbers from a test fit. The advisor never edits the massing.

   Rule choices where the plan leaves room:
   - One group is advised: state.levels.selected when it is a built group, else the group with the most floors
     (ties: the first). `where.group` names it.
   - Target area depth: state.targetDepth, else multifamily 30 ft, hotel 26 ft. A run is too deep when its depth is more
     than target + 2 ft.
   - plate-too-deep (rectangular plates: one piece, no holes, plate area ÷ minimum-area rectangle ≥ 0.98): a candidate
     search. Area depths target − 2 … target + 6 ft in 1 ft steps. Point plates: side = core side + 2 × corridor width
     + 2 × (depth + extWall) on both axes (the core is the program for the candidate's own GSF with the same floors
     context; first the same depth on both axes, then each axis alone around the best); bars: the short side
     2 × (depth + extWall) + corridor width, the length unchanged; single-loaded depth + 2 × extWall + corridor width.
     A side never grows past the current one. Each candidate is a real fill (fillPlate) of a drawn rectangle with the
     same state, except: no locks, no support blocks, no typed spine, auto stairs, the same corridor kind, an auto core.
     Score: no unfilled runs first, then most units in range (metrics unitsInRange), then highest efficiency, then the
     size closest to the current one. Fills are cached by size. With no candidate free of unfilled runs, the message
     says so and gives the depths only. Other plates (and no fillPlate): depths and the target only.
     suggested.depths.long / .short are the area depths that set the long and the short side.
   - gainUnits: units in range gained per floor (plate-too-deep; 0 for the others). gain is square feet per floor:
     plate-too-deep the gross area less per floor; core-oversize the manual core area − the auto program area;
     unfilled-runs the unfilled area; efficiency-low (0.75 − efficiency) × GSF; plate-too-shallow 0.
     Items sort by gainUnits, then gain, largest first (ties: the code order below).
   - Numbers in messages: feet to one decimal (no ".0"), square feet rounded with thousands separators, percent to one
     decimal. Short sentences, active voice, no contractions (ASD-STE100 style).
   ========================================================================== */

import { GEO, minRect } from "./corridor.js";
import { coreProgram } from "./core.js";
import { unitsInRange } from "./metrics.js";

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
  s.units = [];
  s.support = [];
  s.levels = { showPodium: false, selected: null, groups: {} };
  s.corridor = { ...(s.corridor || {}), kind: fill.kind, spine: null };
  s.stairs = { ...(s.stairs || {}), mode: "auto", items: [] };
  s.core = { mode: "auto", rect: null };
  return s;
}

/** Sides of the test plate for an area depth per axis. → { u, n } */
function sidesFor(kind, cur, depth, coreSize, width, ext) {
  if (kind === "point") return { u: Math.min(cur.u, coreSize[0] + 2 * width + 2 * (depth.u + ext)), n: Math.min(cur.n, coreSize[1] + 2 * width + 2 * (depth.n + ext)) };
  if (kind === "single") return { u: cur.u, n: Math.min(cur.n, depth.n + 2 * ext + width) };
  return { u: cur.u, n: Math.min(cur.n, 2 * (depth.n + ext) + width) };
}

/** The size text of a test plate: "w × d ft" on an axis-aligned plate (x × y), else "long × short ft". */
function sizeText(m, size) {
  const aligned = Math.abs(m.u[0]) < 1e-9 || Math.abs(m.u[1]) < 1e-9;
  const alongX = Math.abs(m.u[0]) > 0.5;
  const [a, b] = aligned ? (alongX ? [size.u, size.n] : [size.n, size.u]) : [size.u, size.n];
  return `${fmtFt(a).replace(" ft", "")} × ${fmtFt(b)}`;
}

function tooDeep(state, built, fill, row, target, fillPlate, where) {
  const limit = target + 2;
  const deep = (fill.runs || []).filter((r) => isNum(r.depth) && r.depth > limit + 1e-9);
  if (!deep.length) return null;
  const P = asMP(fill.plate);
  const m = minRect(P);
  if (!m) return null;
  const dmin = Math.min(...deep.map((r) => r.depth)), dmax = Math.max(...deep.map((r) => r.depth));
  const depthText = Math.abs(dmax - dmin) < 0.05 ? fmtFt(dmax) : `${fmtFt(dmin).replace(" ft", "")} to ${fmtFt(dmax)}`;
  const rng = unitsInRange(state, fill.units);
  // draw plan: a blank plate has runs and no units
  let head = `${(fill.units || []).length ? "The units are" : "The runs are"} ${depthText} deep. The target is ${fmtFt(target)}.`;
  if (rng.areaHighCount > 0) {
    head += ` ${rng.areaHighCount} of ${rng.units} units are larger than their area range (average ${fmtSf(rng.avgArea)}${isNum(rng.targetAvgArea) ? `, target ${fmtSf(rng.targetAvgArea)}` : ""}).`;
  }
  const rectangular = P.length === 1 && !P[0].holes.length && mpArea(P) / m.area >= 0.98 - 1e-9;
  const current = { depth: r3(dmax), target, ...row, inRange: rng.inRange, areaHighCount: rng.areaHighCount, avgArea: rng.avgArea, targetAvgArea: rng.targetAvgArea };
  const base = { code: "plate-too-deep", severity: "warn", current, where };
  if (!rectangular || typeof fillPlate !== "function") return { ...base, message: head, suggested: { depth: target }, gain: 0, gainUnits: 0 };

  // candidate search (review of the rework): area depths target − 2 … target + 6 in 1 ft steps
  const width = isNum(fill.width) ? fill.width : 5.67;
  const ext = isNum(state.extWall) && state.extWall >= 0 ? state.extWall : 1.0;
  const cur = { u: m.long, n: m.short };
  const cc = built.coreContext || {};
  const A = isNum(cc.unitArea) && cc.unitArea > 0 ? cc.unitArea : null;
  const depths = [];
  for (let d = target - 2; d <= target + 6 + 1e-9; d += 1) depths.push(d);
  const cache = new Map();
  const tryDepth = (du, dn) => {
    // the core of the candidate: the program for its own GSF with the same floors context
    let coreSize = [0, 0], prog = null;
    if (fill.kind === "point") {
      const guess = sidesFor("point", cur, { u: du, n: dn }, fill.coreProgram ? fill.coreProgram.size : [44, 22], width, ext);
      const gsf = guess.u * guess.n;
      const floors = isNum(cc.floors) && cc.floors > 0 ? cc.floors : 1;
      prog = coreProgram(state, A ? { floors, units: floors * Math.round((gsf * 0.75) / A) } : { floors, levelGsf: gsf });
      coreSize = prog.size;
    }
    const size = sidesFor(fill.kind, cur, { u: du, n: dn }, coreSize, width, ext);
    const key = `${r3(size.u)}x${r3(size.n)}`;
    if (cache.has(key)) return cache.get(key);
    let res = null;
    try {
      const s2 = testFitState(state, fill, m, size);
      if (prog) s2.elevators = { ...(s2.elevators || {}), count: prog.cabs, service: prog.service };
      const b2 = fillPlate(s2, { project: null });
      const f2 = b2 && b2.groups && b2.groups[0] && b2.groups[0].fill;
      if (f2) {
        const n2 = fillNumbers(f2);
        const r2 = unitsInRange(s2, f2.units);
        const unfilled = (f2.support || []).filter((x) => x.kind === "remainder").length;
        res = { size, depth: { u: du, n: dn }, plate: clone(s2.plate), ...n2, inRange: r2.inRange, areaHighCount: r2.areaHighCount, avgArea: r2.avgArea, unfilled,
          moved: Math.abs(cur.u - size.u) + Math.abs(cur.n - size.n) };
      }
    } catch (e) { res = null; }
    cache.set(key, res);
    return res;
  };
  const better = (a, b) => {
    if (!b) return true;
    if (!a) return false;
    if ((a.unfilled === 0) !== (b.unfilled === 0)) return a.unfilled === 0;
    if (a.inRange !== b.inRange) return a.inRange > b.inRange;
    if (Math.abs(a.efficiency - b.efficiency) > 1e-6) return a.efficiency > b.efficiency;
    return a.moved < b.moved - 1e-9;
  };
  let best = null;
  // 1) the same depth on both axes, 2) then each axis alone around the best (a point plate)
  for (const d of depths) { const r = tryDepth(d, d); if (better(r, best)) best = r; }
  if (best && fill.kind === "point") {
    const d0 = best.depth;
    for (const d of depths) { const r = tryDepth(d, d0.n); if (better(r, best)) best = r; }
    const d1 = best.depth;
    for (const d of depths) { const r = tryDepth(d1.u, d); if (better(r, best)) best = r; }
  }
  const tool = built.source === "project" ? "in the Tower Generator" : "on the Plate tab";
  if (!best || best.unfilled > 0) {
    return { ...base, message: `${head} No test size with runs ${fmtFt(target - 2).replace(" ft", "")} to ${fmtFt(target + 6)} deep fills every run. Aim for runs near ${fmtFt(target)} deep.`,
      suggested: { depth: target, tested: cache.size }, gain: 0, gainUnits: 0 };
  }
  const less = (row.gsf || 0) - best.gsf;
  const gainUnits = best.inRange - rng.inRange;
  const msg = `${head} Narrow the plate to ${sizeText(m, best.size)} ${tool}. Test fit at that size: ${best.units} units, ${best.inRange} in range, ${fmtPct(best.efficiency)} efficiency.`;
  return {
    ...base, message: msg,
    suggested: { depth: target, depths: { long: best.depth.u, short: best.depth.n }, size: { long: r3(best.size.u), short: r3(best.size.n) }, axis: m.u.slice(), plate: best.plate,
      units: best.units, nrsf: best.nrsf, gsf: best.gsf, efficiency: best.efficiency, inRange: best.inRange, areaHighCount: best.areaHighCount, avgArea: best.avgArea, tested: cache.size },
    gain: r1(Math.max(0, less)), gainUnits,
  };
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
      current: { depth: r3(depth), type: d.id }, suggested: { depth: r3(dNeed), deeperBy: r3(dNeed - depth) }, gain: 0, gainUnits: 0, where: { ...where, type: d.id },
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
    current: { coreSf: r1(coreArea) }, suggested: { coreSf: r1(prog.area), size: prog.size.slice(), cabs: prog.cabs, service: prog.service }, gain: r1(gain), gainUnits: 0, where,
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
    current: { runs: n, areaSf: r1(a) }, suggested: null, gain: r1(a), gainUnits: 0, where,
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
  // draw plan: a blank plate (no drawn units) gets no efficiency-low item
  if (!items.length && row.efficiency < 0.70 && (fill.units || []).length > 0) {
    items.push({
      code: "efficiency-low", severity: "info",
      message: `Efficiency is ${fmtPct(row.efficiency)}. Typical test fits reach 75 to 82%.`,
      current: { efficiency: row.efficiency }, suggested: { efficiency: 0.75 }, gain: r1(Math.max(0, (0.75 - row.efficiency) * row.gsf)), gainUnits: 0, where,
    });
  }
  return items.map((it, i) => ({ it, i })).sort((a, b) => ((b.it.gainUnits || 0) - (a.it.gainUnits || 0)) || (b.it.gain - a.it.gain) || (ORDER.indexOf(a.it.code) - ORDER.indexOf(b.it.code)) || a.i - b.i).map((x) => x.it);
}
