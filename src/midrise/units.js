/* ==========================================================================
   units.js — units estimate (Mid-Rise Generator)

   Contract: docs/mid-rise-generator-technical-plan.md sections 3.9, 3.5 and 4.
   unitsEstimate(state, built) reads the build result for its joints only
   (built.joints). Pure: no DOM, no Clipper, no mutation of inputs.

   Rule choices where the plan leaves room:
   - A unit program is any program whose state.programs entry has a unitWidth
     above 0 (residential, hotel, senior by default).
   - bar.unitWidth, when set, applies to every unit floor of that bar.
   - Corner loss = rules.cornerLoss (clamped 0 to 2) x insideCorners per
     floor. A joint charges the bar that comes FIRST in state.bars, on the
     floors where the other bar of the joint also stands. Each bend inside a
     bar is one inside corner and charges that bar on all of its floors.
   - Units on a floor never go below 0.
   - byBar[id].perFloor and lossPerFloor read the lowest typical floor (bar
     floor 2, or floor 1 for a one-floor bar); total is the exact sum.
   - Sliver (plan 3.9): a unit-program bar with length < 2 w warns with code
     "sliver".
   ========================================================================== */

import { legsOf, barLevels } from "./bars.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function need(cond, what) {
  if (!cond) throw new Error(`unitsEstimate: ${what} is missing or not valid`);
}

function isUnitProgram(state, key) {
  const p = state.programs && state.programs[key];
  return !!p && isNum(p.unitWidth) && p.unitWidth > 0;
}

function floorUnits(corridor, length, w, breezewayWidth) {
  const eps = 1e-9;
  if (corridor === "single") return Math.floor(length / w + eps);
  if (corridor === "breezeway") return 4 * Math.floor(length / (2 * w + breezewayWidth) + eps);
  return 2 * Math.floor(length / w + eps);
}

/** → { total, byBar: { [id]: { perFloor, floors, total, lossPerFloor } }, byProgram: { [program]: n }, warnings } */
export function unitsEstimate(state, built) {
  need(state && typeof state === "object", "state");
  need(Array.isArray(state.bars), "state.bars");
  need(state.programs && typeof state.programs === "object", "state.programs");
  need(state.rules && isNum(state.rules.breezewayWidth), "state.rules.breezewayWidth");
  need(built && Array.isArray(built.joints), "built.joints");

  const rules = state.rules;
  const cornerLoss = Math.max(0, Math.min(2, isNum(rules.cornerLoss) ? rules.cornerLoss : 0));
  const bars = state.bars;
  const order = new Map(bars.map((b, i) => [b.id, i]));
  const levelSets = new Map(bars.map((b) => [b.id, new Set(barLevels(b, state).map((l) => l.index))]));

  // joints that charge each bar: [{ other, loss }]
  const charges = new Map(bars.map((b) => [b.id, []]));
  for (const j of built.joints) {
    const ids = (j.barIds || []).filter((id) => order.has(id));
    if (ids.length < 2) continue;
    const first = ids.reduce((a, b) => (order.get(a) <= order.get(b) ? a : b));
    const other = ids.find((id) => id !== first);
    if (other === undefined) continue;
    charges.get(first).push({ other, loss: cornerLoss * (isNum(j.insideCorners) ? j.insideCorners : 0) });
  }

  const byBar = {};
  const byProgram = {};
  const warnings = [];
  let total = 0;

  for (const bar of bars) {
    need(state.programs[bar.program], `state.programs.${bar.program} (bar ${bar.id})`);
    const levels = barLevels(bar, state);
    const bendLoss = cornerLoss * (legsOf(bar).length - 1);
    let sum = 0;
    const rows = [];   // { rank, n, loss } for each unit floor

    for (let rank = 0; rank < levels.length; rank++) {
      const lv = levels[rank];
      if (!isUnitProgram(state, lv.program)) continue;
      const w = isNum(bar.unitWidth) && bar.unitWidth > 0 ? bar.unitWidth : state.programs[lv.program].unitWidth;
      const base = floorUnits(bar.corridor, bar.length, w, rules.breezewayWidth);
      let loss = bendLoss;
      for (const c of charges.get(bar.id)) if (levelSets.get(c.other).has(lv.index)) loss += c.loss;
      const n = Math.max(0, base - loss);
      sum += n;
      rows.push({ rank, n, loss: base - n });
      byProgram[lv.program] = (byProgram[lv.program] || 0) + n;
    }
    // typical floor: bar floor 2 when it carries units, else the first unit floor
    const typical = rows.find((r) => r.rank === 1) || rows[0] || null;

    byBar[bar.id] = {
      perFloor: typical ? typical.n : 0,
      floors: rows.length,
      total: sum,
      lossPerFloor: typical ? typical.loss : 0,
    };
    total += sum;

    if (isUnitProgram(state, bar.program)) {
      const w = isNum(bar.unitWidth) && bar.unitWidth > 0 ? bar.unitWidth : state.programs[bar.program].unitWidth;
      if (bar.length < 2 * w) {
        warnings.push({
          code: "sliver", severity: "warn", barId: bar.id, floors: [],
          message: `${bar.name || bar.id} is shorter than two units.`,
        });
      }
    }
  }

  return { total, byBar, byProgram, warnings };
}
