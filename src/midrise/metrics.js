/* ==========================================================================
   metrics.js — every metric row of plan section 3.13 (Mid-Rise Generator)

   Contract: docs/mid-rise-generator-technical-plan.md sections 3.11 to 3.13
   and 4. computeMetrics(state, built, units, parking) reads the build result
   (levels with plates, spineGraph, courtyards, joints). Pure: no DOM, no
   Clipper, no mutation of inputs.

   Arguments after `built`:
   - units: the result of unitsEstimate (computed here when omitted).
   - parking: { required, provided } from parkingRequired and parkingProvided,
     or the object parkingBalance returns (computed here when omitted).

   Shape notes (top-level keys other modules read):
   - units (number), unitsDetail { total, byBar, byProgram }
   - gfa, far, siteCoverage (0 to 1 ratio), siteCoverageArea
   - floors (number: tallest bar floor count + podium levels), floorsDetail
     { bar, podium, deck }
   - height (ft; bar top, plus the screen height when the roof is a screen),
     deckTop (ft)

   Rule choices where the plan leaves room:
   - Site coverage = level 1 plate (index 1) + a deck level standing at z = 0,
     minus the overlap of the two (deck is a rectangle, so the overlap is
     exact without Clipper).
   - Exit stair = 12 x 22 ft, exterior stair = 10 x 20, elevator = 10 x 10.
     The stair and elevator areas come off every bar level they stand on
     (elevators stand on the levels of the longest bar).
   - Corridor length of a bar = the sum of its spineGraph edges (0 for a
     breezeway bar); it falls back to bar.length when the graph has no edge
     for the bar.
   - Open space = (site - level-1 coverage - lot area - typed stalls x
     sfPerStallSurface) / site, never below 0.
   ========================================================================== */

import { barLevels, multiPolyArea, ringArea, clipAreaConvex } from "./bars.js";
import { unitsEstimate } from "./units.js";
import { parkingBalance } from "./parking.js";

export const CONSTRUCTION_CAUTION = "Caution: the hint is a reminder only. Verify the construction type against the adopted code.";
export const SEED_CAUTION = "Caution: stair and elevator counts are a seed, not a code count. Verify them against the adopted code.";

const EXIT_STAIR_AREA = 12 * 22;
const EXTERIOR_STAIR_AREA = 10 * 20;
const ELEVATOR_AREA = 10 * 10;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

function need(fn, cond, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* ------------------------------------------------------------ formatting */

export function formatArea(sf) {
  return `${Math.round(sf).toLocaleString("en-US")} sf`;
}

export function formatDensity(perAcre) {
  return `${(Math.round(perAcre * 10) / 10).toFixed(1)} per acre`;
}

/** 52 → 52' 0"; 63.5 → 63' 6" */
export function formatHeight(ft) {
  let f = Math.floor(ft + 1e-9);
  let inch = Math.round((ft - f) * 12);
  if (inch === 12) { f += 1; inch = 0; }
  return `${f}' ${inch}"`;
}

/* ---------------------------------------------------- construction hint */

/** Plan 3.12. First row of rules.constructionHints that matches; "" with no bars. */
export function constructionHint(state) {
  need("constructionHint", state && state.rules && Array.isArray(state.rules.constructionHints), "state.rules.constructionHints");
  const bars = Array.isArray(state.bars) ? state.bars : [];
  const tallest = bars.reduce((m, b) => Math.max(m, isNum(b.floors) ? b.floors : 0), 0);
  if (tallest <= 0) return "";
  const hasPodium = !!(state.podium && state.podium.on && Array.isArray(state.podium.levels) && state.podium.levels.length);
  for (const row of state.rules.constructionHints) {
    if (tallest > row.maxFloors) continue;
    const pod = row.podium || "any";
    if (pod === "any" || (pod === "yes" && hasPodium) || (pod === "none" && !hasPodium)) return row.hint;
  }
  return "";
}

/* -------------------------------------------------------------- helpers */

export function siteAreaOf(state) {
  const s = state && state.site;
  need("computeMetrics", s, "state.site");
  if (s.shape === "none") return 0;                 // Unlimited: no site, so no site area
  if (s.shape === "polygon" && Array.isArray(s.points) && s.points.length >= 3) {
    return Math.abs(ringArea(s.points.map((p) => [+p[0], +p[1]])));
  }
  return (isNum(s.width) ? s.width : 0) * (isNum(s.depth) ? s.depth : 0);
}

function corridorLengthOf(bar, built) {
  if (bar.corridor === "breezeway") return 0;
  const edges = ((built.spineGraph && built.spineGraph.edges) || []).filter((e) => e.barId === bar.id);
  if (!edges.length) return bar.length;
  return edges.reduce((s, e) => s + (isNum(e.length) ? e.length : 0), 0);
}

/** Plan 3.11 counts. units = the result of unitsEstimate.
    → { exit, extra, exterior, stairs, elevators, byBar: { [id]: { exit, extra, exterior } } } */
export function stairElevatorCounts(state, built, units) {
  need("stairElevatorCounts", state && Array.isArray(state.bars) && state.rules, "state.bars and state.rules");
  need("stairElevatorCounts", built && typeof built === "object", "built");
  const rules = state.rules;
  const byBar = {};
  let exit = 0, extra = 0, exterior = 0;
  for (const bar of state.bars) {
    const ends = bar.ends || {};
    const ends2 = (ends.start === "stair" ? 1 : 0) + (ends.end === "stair" ? 1 : 0);
    const len = corridorLengthOf(bar, built);
    const more = len > 0 ? Math.max(0, Math.ceil(len / rules.stairPer - 1e-9) - 1) : 0;
    let ext = 0;
    if (bar.corridor === "breezeway") {
      const prog = state.programs && state.programs[bar.program];
      const w = isNum(bar.unitWidth) && bar.unitWidth > 0 ? bar.unitWidth : (prog && prog.unitWidth) || 28;
      ext = Math.floor(bar.length / (2 * w + rules.breezewayWidth) + 1e-9);
    }
    byBar[bar.id] = { exit: ends2, extra: more, exterior: ext };
    exit += ends2; extra += more; exterior += ext;
  }
  const total = units && isNum(units.total) ? units.total : 0;
  const anyTall = state.bars.some((b) => b.floors >= 3);
  const allBreezeway = state.bars.length > 0 && state.bars.every((b) => b.corridor === "breezeway");
  let elevators = allBreezeway ? 0 : Math.ceil(total / rules.elevatorPer - 1e-9);
  if (!allBreezeway && anyTall) elevators = Math.max(1, elevators);
  if (!state.bars.length) elevators = 0;
  return { exit, extra, exterior, stairs: exit + extra + exterior, elevators, byBar };
}

function levelPlatesArea(lv) {
  return multiPolyArea(lv.plates);
}

function efficiencyOf(state, built, counts) {
  const bars = state.bars;
  const barLv = (built.levels || []).filter((l) => l.zone === "bar");
  if (!barLv.length || !bars.length) return 0;
  const cw = isNum(state.rules.corridorWidth) ? state.rules.corridorWidth : 0;
  const occupied = new Map(bars.map((b) => [b.id, new Set(barLevels(b, state).map((l) => l.index))]));
  let longest = bars[0];
  for (const b of bars) if (b.length > longest.length) longest = b;
  let gross = 0, net = 0;
  for (const lv of barLv) {
    const area = levelPlatesArea(lv);
    let corridor = 0, stairs = 0;
    for (const b of bars) {
      if (!occupied.get(b.id).has(lv.index)) continue;
      corridor += corridorLengthOf(b, built) * cw;
      const c = counts.byBar[b.id];
      stairs += (c.exit + c.extra) * EXIT_STAIR_AREA + c.exterior * EXTERIOR_STAIR_AREA;
    }
    const lift = counts.elevators > 0 && occupied.get(longest.id).has(lv.index) ? counts.elevators * ELEVATOR_AREA : 0;
    gross += area;
    net += area - corridor - stairs - lift;
  }
  return gross > 0 ? net / gross : 0;
}

const check = (target, current) => (isNum(target) && target > 0
  ? { target, current, diff: r3(current - target), pct: r1(((current - target) / target) * 100) }
  : null);

/* -------------------------------------------------------------- metrics */

/** Plan 3.13. Every row. */
export function computeMetrics(state, built, units, parking) {
  need("computeMetrics", state && Array.isArray(state.bars) && state.rules, "state");
  need("computeMetrics", built && Array.isArray(built.levels), "built.levels");
  if (!units) units = unitsEstimate(state, built);
  if (!parking || !parking.required || !parking.provided) parking = parkingBalance(state, units, built);

  const siteArea = siteAreaOf(state);
  const acres = siteArea / 43560;
  const levels = built.levels;

  // GFA and level 1 coverage
  let gfa = 0;
  for (const lv of levels) gfa += levelPlatesArea(lv);
  const level1 = levels.find((l) => l.index === 1);
  let coverageArea = level1 ? levelPlatesArea(level1) : 0;
  const deckGround = levels.find((l) => l.zone === "deck" && Math.abs(l.z) < 1e-6);
  if (deckGround && !(level1 && level1.zone === "deck")) {
    const deckArea = levelPlatesArea(deckGround);
    let overlap = 0;
    if (level1 && deckGround.plates.length === 1 && deckGround.plates[0].outer.length >= 3 && !(deckGround.plates[0].holes || []).length) {
      overlap = clipAreaConvex(level1.plates, deckGround.plates[0].outer);
    }
    coverageArea += deckArea - overlap;
  }

  // height and floors
  const barLv = levels.filter((l) => l.zone === "bar");
  const podLv = levels.filter((l) => l.zone === "podium");
  const deckLv = levels.filter((l) => l.zone === "deck");
  const top = (list) => list.reduce((m, l) => Math.max(m, l.z + l.ftf), 0);
  const roofScreen = state.roof && state.roof.type === "screen" && isNum(state.roof.height) ? state.roof.height : 0;
  const base = barLv.length ? top(barLv) : top(podLv);
  const height = base + (base > 0 ? roofScreen : 0);

  // corridor, stairs, elevators
  const counts = stairElevatorCounts(state, built, units);
  let corridor = 0;
  for (const b of state.bars) corridor += corridorLengthOf(b, built);
  const totalUnits = units.total;

  // parking
  const required = parking.required, provided = parking.provided;
  const reqTotal = isNum(required) ? required : required.total;
  const provTotal = isNum(provided) ? provided : provided.total;

  // courtyards
  const courts = built.courtyards || [];
  const courtItems = courts.map((c) => ({ kind: c.kind, id: c.id, area: c.area, minDim: c.minDim }));

  // bars
  let longest = null;
  for (const b of state.bars) if (!longest || b.length > longest.length) longest = b;

  // open space
  const sp = state.parking || {};
  const surfaceCfg = state.surface || {};
  const lotArea = Array.isArray(surfaceCfg.lot) && surfaceCfg.lot.length >= 3 ? Math.abs(ringArea(surfaceCfg.lot)) : 0;
  const typedArea = (isNum(surfaceCfg.count) ? surfaceCfg.count : 0) * (isNum(sp.sfPerStallSurface) ? sp.sfPerStallSurface : 0);
  const openArea = siteArea > 0 ? Math.max(0, siteArea - coverageArea - lotArea - typedArea) : 0;
  const openRatio = siteArea > 0 ? openArea / siteArea : 0;

  const density = acres > 0 ? totalUnits / acres : 0;
  const far = siteArea > 0 ? gfa / siteArea : 0;
  const tg = state.targets || {};
  const site = state.site || {};
  const hasSite = site.shape !== "none";            // false: siteArea, acres, density, FAR, coverage and open space mean "no site"

  const surplus = provTotal - reqTotal;
  const ratioProvided = totalUnits > 0 ? provTotal / totalUnits : 0;
  const warnings = [];
  if (surplus < 0) {
    warnings.push({ code: "parking-deficit", severity: "warn", floors: [], message: `Parking provided is ${-surplus} stalls short of the ${reqTotal} required.` });
  }
  if (hasSite && isNum(site.densityCap) && site.densityCap > 0 && density > site.densityCap + 1e-9) {
    warnings.push({ code: "density-cap", severity: "warn", floors: [], message: `Density ${formatDensity(density)} is over the cap of ${site.densityCap} per acre.` });
  }
  if (hasSite && isNum(site.openSpaceShare) && site.openSpaceShare > 0 && openRatio < site.openSpaceShare - 1e-9) {
    warnings.push({ code: "open-space", severity: "warn", floors: [], message: `Open space ${r1(openRatio * 100)} percent is under the ${r1(site.openSpaceShare * 100)} percent rule.` });
  }

  return {
    units: totalUnits,
    unitsDetail: { total: units.total, byBar: units.byBar, byProgram: units.byProgram },
    hasSite,
    siteArea: r1(siteArea),
    siteAcres: r3(acres),
    density: r3(density),
    gfa: r1(gfa),
    far: r3(far),
    siteCoverage: siteArea > 0 ? r3(coverageArea / siteArea) : 0,
    siteCoverageArea: r1(coverageArea),
    efficiency: r3(efficiencyOf(state, built, counts)),
    corridorLength: r1(corridor),
    corridorPerUnit: totalUnits > 0 ? r1(corridor / totalUnits) : 0,
    parking: {
      required: reqTotal,
      provided: provTotal,
      ratioProvided: r3(ratioProvided),
      surplus,
      deficit: surplus < 0,
      requiredDetail: isNum(required) ? null : required,
      providedDetail: isNum(provided) ? null : provided,
    },
    courtyards: {
      count: courts.length,
      area: r1(courts.reduce((s, c) => s + (isNum(c.area) ? c.area : 0), 0)),
      minDim: courts.length ? Math.min(...courts.map((c) => c.minDim)) : 0,
      items: courtItems,
    },
    bars: {
      count: state.bars.length,
      longest: longest ? { id: longest.id, name: longest.name || longest.id, length: longest.length } : null,
    },
    height: r3(height),
    deckTop: r3(top(deckLv)),
    floors: barLv.length + podLv.length,
    floorsDetail: { bar: barLv.length, podium: podLv.length, deck: deckLv.length },
    stairs: { exit: counts.exit + counts.extra, exterior: counts.exterior, total: counts.stairs, byBar: counts.byBar },
    elevators: counts.elevators,
    seedCaution: SEED_CAUTION,
    constructionHint: constructionHint(state),
    constructionCaution: CONSTRUCTION_CAUTION,
    openSpace: {
      area: r1(openArea),
      ratio: r3(openRatio),
      required: isNum(site.openSpaceShare) ? site.openSpaceShare : 0,
      ok: !(hasSite && isNum(site.openSpaceShare) && site.openSpaceShare > 0 && openRatio < site.openSpaceShare - 1e-9),
    },
    target: {
      units: check(tg.units, totalUnits),
      density: check(tg.density, density),
    },
    warnings,
  };
}
