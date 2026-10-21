/* ==========================================================================
   overlay.js — column overlay against the unit demising lines
   (Parking Deck Generator)

   Contract: docs/parking-deck-technical-plan.md sections 3.8, 3.9 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs.

   Sources (plan 3.9 step 1), in this order:
   - "plates": sections.plates.derived.levels, the lowest-index level whose
     massing program is "residential" (any level with demising lines when
     none is labeled residential); each unit's `demising` lines.
   - "midrise": sections.massing.derived.levels, the lowest-index
     "residential" level with spines; a tick every unitWidth along each spine
     (unitWidth = sections.massing.state.programs[program].unitWidth).
   - "none": no project, or neither source has data.

   Rule choices where the plan leaves room:
   - A demising line counts when it is within 5 degrees of the layout y axis
     (perpendicular to the run) and at least 5 ft long. Lines closer than
     0.25 ft in x merge. A mid-rise tick counts when its spine segment is
     within 5 degrees of the layout x axis.
   - unitWidth = the median spacing between neighbouring lines, using
     spacings from 4 to 60 ft only (the gap between two bars is not a unit).
   - A column is "under the building" when it lies inside the source level's
     plate (layout frame); with no plate it counts when its x lies within the
     demising lines' x range, plus the tolerance.
   - Short-span suggestion: m = max(1, round((column + n x stallW) / U)),
     w* = (m x U - column) / n (the module length replaces n x stallW in m).
   - The suggestion is null when w* is outside 8 to 10 ft or equals the
     current stall width (already aligned).
   - The run (xs, xe) comes from built.run when the layout supplies it, else
     from the footprint perimeter and the turn zone (the split-level end
     zone included).
   - overlay takes the columnsFor result as an optional fourth argument.
     Without it, columnsFromState (plan 3.8, same rules) supplies the
     columns, so this file stands alone.
   ========================================================================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;   // + 0 turns -0 into 0
const TAN5 = Math.tan((5 * Math.PI) / 180);
const MIN_W = 8, MAX_W = 10;

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* -------------------------------------------------------------- helpers */

function median(list) {
  if (!list.length) return 0;
  const a = list.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function mergeClose(sorted, gap) {
  const out = [];
  for (const x of sorted) if (!out.length || x - out[out.length - 1] > gap) out.push(x);
  return out;
}

function unitWidthOf(xs) {
  const spacings = [];
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    if (d >= 4 && d <= 60) spacings.push(d);
  }
  return r3(median(spacings));
}

function inRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function inMultiPoly(pt, mp) {
  for (const poly of mp || []) {
    if (!inRing(pt, poly.outer)) continue;
    if ((poly.holes || []).some((h) => inRing(pt, h))) continue;
    return true;
  }
  return false;
}

function mpToLayout(mp, frame) {
  return (mp || []).map((p) => ({
    outer: (p.outer || []).map((q) => frame.toLayout(q)),
    holes: (p.holes || []).map((h) => h.map((q) => frame.toLayout(q))),
  }));
}

/* --------------------------------------------------------- demising xs */

function fromPlates(project, frame) {
  const plates = project.sections && project.sections.plates && project.sections.plates.derived;
  const levels = plates && Array.isArray(plates.levels) ? plates.levels : [];
  const massing = project.sections && project.sections.massing && project.sections.massing.derived;
  const program = (index) => {
    const m = massing && Array.isArray(massing.levels) ? massing.levels.find((l) => l.index === index) : null;
    return m ? m.program : null;
  };
  const withLines = levels.filter((lv) => Array.isArray(lv.units) && lv.units.some((u) => Array.isArray(u.demising) && u.demising.length));
  if (!withLines.length) return null;
  const byIndex = (a, b) => a.index - b.index;
  const pick = withLines.filter((lv) => program(lv.index) === "residential").sort(byIndex)[0] || withLines.slice().sort(byIndex)[0];

  const xs = [];
  for (const u of pick.units) {
    for (const line of u.demising || []) {
      if (!Array.isArray(line) || line.length < 2) continue;
      const a = frame.toLayout(line[0]), b = frame.toLayout(line[1]);
      const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
      if (dy < 5 || dx > TAN5 * dy) continue;
      xs.push((a[0] + b[0]) / 2);
    }
  }
  if (!xs.length) return null;
  xs.sort((p, q) => p - q);
  const merged = mergeClose(xs, 0.25).map(r3);
  return { source: "plates", xs: merged, unitWidth: unitWidthOf(merged), footprint: mpToLayout(pick.plate, frame), level: pick.index };
}

function fromMidrise(project, frame) {
  const massing = project.sections && project.sections.massing;
  const derived = massing && massing.derived;
  const levels = derived && Array.isArray(derived.levels) ? derived.levels : [];
  const state = massing && massing.state;
  const cand = levels.filter((l) => l.program === "residential" && Array.isArray(l.spines) && l.spines.length).sort((a, b) => a.index - b.index)[0];
  if (!cand) return null;
  const prog = state && state.programs && state.programs[cand.program];
  const U = prog && isNum(prog.unitWidth) && prog.unitWidth > 0 ? prog.unitWidth : 0;
  if (!U) return null;

  const xs = [];
  for (const spine of cand.spines) {
    if (!Array.isArray(spine) || spine.length < 2) continue;
    const pts = spine.map((p) => frame.toLayout(p));
    let walked = 0, nextTick = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const alongX = Math.abs(dy) <= TAN5 * Math.abs(dx);
      while (nextTick <= walked + len + 1e-9) {
        const t = Math.min(1, Math.max(0, (nextTick - walked) / len));
        if (alongX) xs.push(a[0] + t * dx);
        nextTick += U;
      }
      walked += len;
    }
  }
  if (!xs.length) return null;
  xs.sort((p, q) => p - q);
  const merged = mergeClose(xs, 0.25).map(r3);
  return { source: "midrise", xs: merged, unitWidth: r3(U), footprint: mpToLayout(cand.plates, frame), level: cand.index };
}

/** Plan 3.9 steps 1 and 2. frame: layoutFrame(state) (needs toLayout).
    → { source: "plates" | "midrise" | "none", xs, unitWidth, footprint, level }.
    xs are the demising lines' x in the layout frame, sorted. footprint is the
    source level's plate as a MultiPoly in the layout frame (or null). */
export function demisingLines(project, frame) {
  need(frame && typeof frame.toLayout === "function", "demisingLines", "frame.toLayout");
  const none = { source: "none", xs: [], unitWidth: 0, footprint: null, level: null };
  if (!project || typeof project !== "object" || !project.sections) return none;
  return fromPlates(project, frame) || fromMidrise(project, frame) || none;
}

/* ------------------------------------------------------------- columns */

function turnZoneOf(state) {
  if (state.ramp && state.ramp.type === "split") {
    const tr = state.ramp.transition || {};
    return (isNum(state.ramp.splitLength) ? state.ramp.splitLength : 0) + 2 * (isNum(tr.length) ? tr.length : 0);
  }
  return isNum(state.bays.turnZone) ? state.bays.turnZone : state.bays.aisle;
}

function runOf(state, built) {
  const run = built.run;
  if (run && isNum(run.xs) && isNum(run.xe)) return { xs: run.xs, xe: run.xe, R: run.xe - run.xs };
  const p = isNum(state.footprint.perimeter) ? state.footprint.perimeter : 0;
  const t = turnZoneOf(state);
  const xs = p + t, xe = built.frame.W - p - t;
  return { xs, xe, R: xe - xs };
}

/** Stalls in one row of run length R at stall width w (plan 3.3). */
function rowCount(R, w, grid) {
  if (!(R > 0) || !(w > 0)) return 0;
  const eps = 1e-9;
  if (grid.span === "short") {
    const n = grid.stallsPerModule, M = grid.column + n * w;
    const k = Math.floor(R / M + eps);
    const rr = R - k * M;
    return k * n + Math.floor(Math.max(0, rr - grid.column) / w + eps);
  }
  return Math.floor(R / w + eps);
}

/** Plan 3.8: column lines and points in the layout frame, as grid.columnsFor
    returns them. → { lines: [{ y, xs }], points, module }. */
export function columnsFromState(state, built) {
  need(state && state.grid && state.bays && state.footprint, "columnsFromState", "state.grid, state.bays and state.footprint");
  need(built && built.frame && isNum(built.frame.W), "columnsFromState", "built.frame");
  const grid = state.grid, short = grid.span === "short";
  const n = grid.stallsPerModule, w = state.bays.stallW;
  const module = short ? grid.column + n * w : n * w;
  const { xs: xs0, xe, R } = runOf(state, built);

  const bayList = Array.isArray(built.bays) ? built.bays : (built.bays && built.bays.bays) || [];
  const ys = new Set();
  for (const b of bayList) {
    const all = [...(b.rows || []).flatMap((r) => [r.y0, r.y1]), ...(b.aisle ? [b.aisle.y0, b.aisle.y1] : [])];
    if (!all.length) continue;
    const lo = Math.min(...all), hi = Math.max(...all);
    ys.add(r3(lo)); ys.add(r3(hi));
    if (short) for (const y of all) ys.add(r3(y));
  }
  const xsList = [];
  if (R > 0) {
    const k = Math.floor(R / module + 1e-9);
    for (let j = 0; j <= k; j++) xsList.push(r3(xs0 + j * module));
    if (xe - xsList[xsList.length - 1] > 0.5) xsList.push(r3(xe));
  }
  const lines = [...ys].sort((p, q) => p - q).map((y) => ({ y, xs: xsList.slice() }));
  const points = lines.flatMap((l) => l.xs.map((x) => [x, l.y]));
  return { lines, points, module: r3(module) };
}

/* ------------------------------------------------------------- overlay */

/** Plan 3.9 steps 3 and 4. columns: the columnsFor result (optional).
    → { conflicts: [{ column: [x, y], distance }], suggestion: { stallW, stallsPerRow } | null,
        source, unitWidth, tolerance, checked }.
    `checked` = columns under the building; distance is in ft along x. */
export function overlay(state, built, project, columns) {
  need(state && state.grid && state.bays && state.footprint && state.checks, "overlay", "state.grid, state.bays, state.footprint and state.checks");
  need(built && built.frame, "overlay", "built.frame");
  const tol = isNum(state.checks.overlayTolerance) ? state.checks.overlayTolerance : 2;
  const dem = demisingLines(project, built.frame);
  const empty = { conflicts: [], suggestion: null, source: dem.source, unitWidth: dem.unitWidth, tolerance: tol, checked: 0 };
  if (dem.source === "none" || !dem.xs.length) return { ...empty, source: "none" };

  const cols = columns && Array.isArray(columns.points) ? columns : columnsFromState(state, built);
  const lo = dem.xs[0] - tol, hi = dem.xs[dem.xs.length - 1] + tol;
  const hasPlate = dem.footprint && dem.footprint.length > 0;
  const conflicts = [];
  let checked = 0;
  for (const c of cols.points) {
    const under = hasPlate ? inMultiPoly(c, dem.footprint) : c[0] >= lo && c[0] <= hi;
    if (!under) continue;
    checked++;
    let d = Infinity;
    for (const x of dem.xs) d = Math.min(d, Math.abs(c[0] - x));
    if (d > tol + 1e-9) conflicts.push({ column: [c[0], c[1]], distance: r3(d) });
  }

  // suggestion (decision 12): the tool never changes the width by itself
  let suggestion = null;
  const U = dem.unitWidth;
  if (U > 0) {
    const grid = state.grid, n = grid.stallsPerModule, w = state.bays.stallW, short = grid.span === "short";
    const moduleNow = short ? grid.column + n * w : n * w;
    const m = Math.max(1, Math.round(moduleNow / U));
    const wStar = short ? (m * U - grid.column) / n : (m * U) / n;
    if (wStar >= MIN_W - 1e-9 && wStar <= MAX_W + 1e-9 && Math.abs(wStar - w) > 0.005) {
      const { R } = runOf(state, built);
      suggestion = { stallW: r3(wStar), stallsPerRow: rowCount(R, wStar, grid) };
    }
  }
  return { conflicts, suggestion, source: dem.source, unitWidth: U, tolerance: tol, checked };
}
