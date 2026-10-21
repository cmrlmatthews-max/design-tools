/* ==========================================================================
   grid.js — Parking Deck: column grid and clear heights

   Contract: docs/parking-deck-technical-plan.md sections 3.8, 3.10 and 4.
   Pure ES module. No DOM, no Three.js, no Clipper, no hidden state, no
   mutation of inputs. Units: feet. Coordinates in the layout frame.

   Rule choices where the plan leaves room:
   - A column point is the column center. Long-span lines sit on every bay
     edge (stall heads), short-span lines also on every row/aisle line.
     Shared edges of adjacent bays count once.
   - Columns along a line: xs + k·module for k = 0 … floor(R ÷ module), plus
     xe when the last gap is over 0.5 ft. Long-span module =
     stallsPerModule × stallW; short-span module = column + stallsPerModule
     × stallW. Turn zones have none.
   - Polygon footprints: points outside the inset footprint (0.01 ft
     tolerance) are dropped; empty lines are dropped.
   - clearHeights: clear = ftf − structureDepth[span]. Level 1 checks against
     clearVan, the others against clearGeneral. The top level of an open-top
     deck has no structure above: clear null, ok true, open true.
   ========================================================================== */

import { levelList } from "./layout.js";

const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
const EPS = 1e-9;
const END_GAP = 0.5;
const TOL = 0.01;

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

function onSeg(p, a, b) {
  const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  if (Math.abs(cr) / len > TOL) return false;
  return p[0] >= Math.min(a[0], b[0]) - TOL && p[0] <= Math.max(a[0], b[0]) + TOL
    && p[1] >= Math.min(a[1], b[1]) - TOL && p[1] <= Math.max(a[1], b[1]) + TOL;
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSeg(p, a, b)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function inMP(p, mp) {
  for (const poly of mp || []) {
    if (!inRing(p, poly.outer)) continue;
    if ((poly.holes || []).some((h) => inRing(p, h) && !h.some((_, i) => onSeg(p, h[i], h[(i + 1) % h.length])))) continue;
    return true;
  }
  return false;
}

/** Plan 3.8. built = layout() result (bays, run, frame, inset).
    → { lines: [{ y, xs: [x, …] }], points: [[x, y], …], module, span, perLevel } — the same columns on every level. */
export function columnsFor(state, built) {
  need(state && typeof state === "object", "columnsFor", "state");
  need(built && Array.isArray(built.bays) && built.run, "columnsFor", "built");
  const g = state.grid || {};
  const b = state.bays || {};
  const span = g.span === "short" ? "short" : "long";
  const stallW = Math.max(0.1, num(b.stallW, 9));
  const spm = Math.max(1, Math.round(num(g.stallsPerModule, 3)));
  const column = Math.max(0, num(g.column, 2));
  const module = span === "long" ? spm * stallW : column + spm * stallW;
  const { xs, xe, length: R } = built.run;

  const xsList = [];
  if (R > EPS && built.bays.length) {
    const kMax = Math.floor(R / module + EPS);
    for (let k = 0; k <= kMax; k++) xsList.push(r3(xs + k * module));
    if (xe - xsList[xsList.length - 1] > END_GAP) xsList.push(r3(xe));
  }

  const ys = new Set();
  for (const bay of built.bays) {
    ys.add(r3(bay.y0));
    ys.add(r3(bay.y1));
    if (span === "short") {
      ys.add(r3(bay.aisle.y0));
      ys.add(r3(bay.aisle.y1));
      for (const row of bay.rows) { ys.add(r3(row.y0)); ys.add(r3(row.y1)); }
    }
  }
  const polygon = built.frame && built.frame.shape === "polygon";
  const lines = [];
  const points = [];
  for (const y of [...ys].sort((u, v) => u - v)) {
    const lx = polygon ? xsList.filter((x) => inMP([x, y], built.inset)) : xsList.slice();
    if (!lx.length) continue;
    lines.push({ y, xs: lx });
    for (const x of lx) points.push([x, y]);
  }
  return { lines, points, module: r3(module), span, perLevel: points.length };
}

/** Plan 3.10. → [{ level, ftf, clear, min, ok, open }] from the state level stack. */
export function clearHeights(state) {
  need(state && typeof state === "object", "clearHeights", "state");
  const span = state.grid && state.grid.span === "short" ? "short" : "long";
  const sd = (state.grid && state.grid.structureDepth) || {};
  const depth = num(sd[span], span === "long" ? 2.5 : 1.5);
  const ch = state.checks || {};
  const van = num(ch.clearVan, 8.1667), gen = num(ch.clearGeneral, 7.0);
  const openTop = !(state.levels && state.levels.openTop === false);
  const list = levelList(state);
  return list.map((lv, i) => {
    const min = lv.index === 1 ? van : gen;
    if (openTop && i === list.length - 1 && list.length > 0) {
      return { level: lv.index, ftf: lv.ftf, clear: null, min, ok: true, open: true };
    }
    const clear = r3(lv.ftf - depth);
    return { level: lv.index, ftf: lv.ftf, clear, min, ok: clear >= min - 1e-6, open: false };
  });
}
