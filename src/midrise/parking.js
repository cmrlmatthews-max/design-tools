/* ==========================================================================
   parking.js — parking required and provided (Mid-Rise Generator)

   Contract: docs/mid-rise-generator-technical-plan.md sections 3.10 and 4.
   Reads the build result for podium plates (built.levels, zone "podium") and
   for joints. Pure: no DOM, no Clipper, no mutation of inputs.

   Rule choices where the plan leaves room:
   - Required total = ceil(sum) so a half stall counts as a stall (323.5 -> 324).
     byProgram values are the unrounded products (to 0.01).
   - Retail area = ground-floor retail bars (length x depth, less the overlap
     of every joint, charged to the bar that comes LATER in state.bars) + the
     plate area of every podium level whose program is retail + the liner
     strip when podium level 1 is not itself retail.
   - Liner strip = the podium level-1 plate cut by a strip of `liner.depth`
     along the named side of the plate's bounding box (front = south, back =
     north, left = west, right = east).
   - Podium stalls per level: 0 unless the level program is parking; level 1
     loses the liner strip first; floor((area - liner) / sfPerStallDeck).
   - Surface: `surface` is the typed count, `lot` the stalls of the drawn lot
     (floor(area / sfPerStallSurface)); both are provided stalls.
   ========================================================================== */

import { ringArea, multiPolyArea, clipAreaConvex } from "./bars.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;

function need(fn, cond, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

function podiumPlates(built) {
  return (built.levels || [])
    .filter((l) => l && l.zone === "podium")
    .slice()
    .sort((a, b) => a.index - b.index);
}

function bboxOf(mp) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of mp || []) for (const [x, y] of p.outer) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** Area of the podium plate inside the liner strip. */
export function linerArea(plate, liner) {
  if (!liner || !liner.on || !isNum(liner.depth) || liner.depth <= 0) return 0;
  const b = bboxOf(plate);
  if (!b) return 0;
  const d = liner.depth;
  let rect;
  switch (liner.side) {
    case "back":  rect = [[b.minX, b.maxY - d], [b.maxX, b.maxY - d], [b.maxX, b.maxY], [b.minX, b.maxY]]; break;
    case "left":  rect = [[b.minX, b.minY], [b.minX + d, b.minY], [b.minX + d, b.maxY], [b.minX, b.maxY]]; break;
    case "right": rect = [[b.maxX - d, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.maxX - d, b.maxY]]; break;
    default:      rect = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.minY + d], [b.minX, b.minY + d]];
  }
  return clipAreaConvex(plate, rect);
}

function barFootprint(state, bar, built) {
  let a = bar.length * bar.depth;                 // exact for any bend (plan 3.1 miter rule)
  const order = new Map(state.bars.map((b, i) => [b.id, i]));
  for (const j of built.joints || []) {
    const ids = j.barIds || [];
    if (!ids.includes(bar.id) || ids.length < 2) continue;
    const later = ids.reduce((x, y) => (order.get(x) >= order.get(y) ? x : y));
    if (later === bar.id && j.zone) a -= Math.abs(ringArea(j.zone.outer));
  }
  return Math.max(0, a);
}

/** Retail area in sf: { total, groundBars, podium, liner }. */
export function retailArea(state, built) {
  need("retailArea", state && Array.isArray(state.bars), "state.bars");
  need("retailArea", built && typeof built === "object", "built");
  let groundBars = 0;
  for (const bar of state.bars) if (bar.groundProgram === "retail") groundBars += barFootprint(state, bar, built);

  let podium = 0, liner = 0;
  if (state.podium && state.podium.on) {
    const plates = podiumPlates(built);
    const levels = state.podium.levels || [];
    plates.forEach((lv, i) => {
      if (levels[i] && levels[i].program === "retail") podium += multiPolyArea(lv.plates);
    });
    if (plates[0] && levels[0] && levels[0].program !== "retail") liner = linerArea(plates[0].plates, state.podium.liner);
  }
  return { total: groundBars + podium + liner, groundBars, podium, liner };
}

/** units = the result of unitsEstimate. → { total, byProgram, retail, retailArea } */
export function parkingRequired(state, units, built) {
  need("parkingRequired", state && state.programs, "state.programs");
  need("parkingRequired", state.parking && isNum(state.parking.retailPerThousand), "state.parking.retailPerThousand");
  need("parkingRequired", units && units.byProgram, "units.byProgram");
  need("parkingRequired", built && typeof built === "object", "built");
  const byProgram = {};
  let sum = 0;
  for (const [prog, n] of Object.entries(units.byProgram)) {
    const pr = state.programs[prog];
    const ratio = pr && isNum(pr.parkingRatio) ? pr.parkingRatio : 0;
    const req = n * ratio;
    byProgram[prog] = r2(req);
    sum += req;
  }
  const area = retailArea(state, built);
  const retail = (area.total / 1000) * state.parking.retailPerThousand;
  sum += retail;
  return { total: Math.ceil(sum - 1e-9), byProgram, retail: r2(retail), retailArea: Math.round(area.total * 10) / 10 };
}

/** → { total, surface, lot, deck, podium: [n per podium level] } */
export function parkingProvided(state, built) {
  need("parkingProvided", state && state.parking, "state.parking");
  need("parkingProvided", isNum(state.parking.sfPerStallSurface) && state.parking.sfPerStallSurface > 0, "state.parking.sfPerStallSurface");
  need("parkingProvided", isNum(state.parking.sfPerStallDeck) && state.parking.sfPerStallDeck > 0, "state.parking.sfPerStallDeck");
  need("parkingProvided", built && typeof built === "object", "built");
  const sp = state.parking;
  const eps = 1e-9;

  const surfaceCfg = state.surface || {};
  const surface = Math.max(0, Math.floor(isNum(surfaceCfg.count) ? surfaceCfg.count : 0));
  const lotRing = Array.isArray(surfaceCfg.lot) && surfaceCfg.lot.length >= 3 ? surfaceCfg.lot : null;
  const lot = lotRing ? Math.floor(Math.abs(ringArea(lotRing)) / sp.sfPerStallSurface + eps) : 0;

  let deck = 0;
  const d = state.deck;
  if (d && d.on) {
    need("parkingProvided", isNum(d.levels) && isNum(d.w) && isNum(d.d), "state.deck levels, w and d");
    deck = Math.floor((Math.max(0, d.levels) * d.w * d.d) / sp.sfPerStallDeck + eps);
  }

  const podium = [];
  if (state.podium && state.podium.on) {
    const plates = podiumPlates(built);
    const levels = state.podium.levels || [];
    plates.forEach((lv, i) => {
      const prog = levels[i] && levels[i].program;
      if (prog !== "parking") { podium.push(0); return; }
      let area = multiPolyArea(lv.plates);
      if (i === 0) area -= linerArea(lv.plates, state.podium.liner);
      podium.push(Math.max(0, Math.floor(area / sp.sfPerStallDeck + eps)));
    });
  }

  return { total: surface + lot + deck + podium.reduce((a, b) => a + b, 0), surface, lot, deck, podium };
}

/** Required, provided, ratio and balance together. Convenience for the shell and
    for computeMetrics. → { required, provided, ratioProvided, surplus } */
export function parkingBalance(state, units, built) {
  const required = parkingRequired(state, units, built);
  const provided = parkingProvided(state, built);
  const n = units && isNum(units.total) ? units.total : 0;
  return {
    required, provided,
    ratioProvided: n > 0 ? Math.round((provided.total / n) * 1000) / 1000 : 0,
    surplus: provided.total - required.total,
  };
}
