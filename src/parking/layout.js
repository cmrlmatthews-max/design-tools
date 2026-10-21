/* ==========================================================================
   layout.js — Parking Deck: layout frame, bays, rows, stalls, cuts

   Contract: docs/parking-deck-technical-plan.md sections 3.1 to 3.5 and 4.
   Pure ES module. No DOM, no Three.js, no hidden state, no mutation of
   inputs. Clipper through globalThis.ClipperLib at SCALE = 1000 (0.001 ft).
   Units: feet, square feet, degrees. Coordinates round to 0.001 ft.

   Frames. The local frame is the massing local frame (east = +x, north =
   +y). The LAYOUT frame has its origin at the southwest corner of the
   footprint's minimum-area bounding rectangle and its x axis along the
   long side (rotateBays turns it 90 degrees). Bays, rows, stalls, cores,
   entries, the liner and the speed ramp all live in the layout frame.

   Rule choices where the plan leaves room:
   - Bay `index` is 1-based from the south (stall ids P1-1S-001 use it).
     `ramp.slopedBay` stays 0-based, as the state schema says.
   - Turn zone t = splitEndZone(state) for a split-level ramp, else
     bays.turnZone ?? aisle. Run xs = p + t, xe = W − p − t.
   - A rect footprint keeps its own angle: theta = angle, or angle + 90 when
     depth > width (no 180-degree normalization, so a drag is continuous).
     A polygon footprint takes the calipers edge angle in (−90, 90].
   - Levels: index 1 is the lowest. ftf1 applies to index 1, ftf to the
     rest. Levels 1 … belowGrade sit below z = 0; level belowGrade + 1 sits
     at z = 0 and is the entry level. With a project and a wrap/podium
     source, each level takes z and ftf from the massing zone levels (sorted
     by z, starting at `sourceLevel`) when that level exists.
   - Entries cut only the entry level. Sides are layout-frame sides (west =
     low x, south = low y). `at` runs along the side (y for west/east, x for
     south/north). A south lane runs from y 0 to the lowest aisle; a north
     lane from the highest aisle to D; west/east lanes cross the end zone.
   - Liner strip [0, depth] from its side, across the whole frame, on its
     `levels` (1-based indices). Cores cut every level.
   - Speed ramp footprint (ramps.speedRampFootprint) cuts every level when
     the deck has two levels or more.
   - A stall is lost when it overlaps a cut by more than 1 sf. It is lost
     once and charged to the cut with the largest overlap (ties: first cut
     in the order cores, entries, liner, ramp).
   - Polygon footprint: a stall is lost when more than 1 sf of it lies
     outside the footprint inset by the perimeter allowance.
   - Compact rows (compactShare > 0): rows are converted one at a time,
     farthest first from the first elevator in state.cores (else the first
     core, else from the north), until compact stalls ÷ all stalls (before
     cuts) meets the share. A compact row is compactD deep with compactW
     stalls; bays restack from the south and the gained depth goes to the
     north strip. The bay count does not change.
   - Project cores: with coresFromProject and a project, the seeds of the
     lowest bar level at or above the top parking level (else the lowest bar
     level) replace state.cores, kept only when they overlap the plate by
     more than 1 sf. Ids S1…, E1… in seed order; exterior-stair → stair.
     When no seed overlaps the plate, state.cores stay in use.
   - Warnings raised here (Warning = { code, severity, floors, message,
     id?, action? }): core-in-aisle (action "move-to-row"), core-outside,
     liner-aisle (a partial aisle cut), ramp-stalls (the speed ramp removes
     stalls), no-bays, short-run.
   - quality "draft": aisles, turnZones and rows are raw rectangles (no
     Clipper booleans). Stalls and counts are identical to "full".

   Additive keys beyond the section 4 contract (documented for the other
   agents): layout() also returns quality, run, inset, insetArea,
   footprint, entryLevel; each level carries rows (MultiPoly) and lost
   ([{ id, by }]); each cut carries lost (count); each bay carries y1; each
   row carries compact; each core carries ring, x, y, w, d, source,
   inAisle, outside.
   ========================================================================== */

import { cleanRing2 } from "../shared/sketchup-format.js";
import { ringArea, multiPolyArea, clipAreaConvex } from "../midrise/bars.js";
import { splitEndZone, speedRampFootprint } from "./ramps.js";

export const SCALE = 1000;

const EPS = 1e-9;
const LOSS = 1;                 // sf: a stall overlapping a cut by more than this is lost
const MITER_LIMIT = 2;
const DEG = Math.PI / 180;

const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* ------------------------------------------------------------ params */

function bayParams(state) {
  const b = (state && state.bays) || {};
  return {
    stallW: Math.max(0.1, num(b.stallW, 9)),
    stallD: Math.max(0.1, num(b.stallD, 18)),
    aisle: Math.max(0, num(b.aisle, 24)),
    edgeBays: b.edgeBays !== false,
    compactShare: Math.max(0, Math.min(1, num(b.compactShare, 0))),
    compactW: Math.max(0.1, num(b.compactW, 8)),
    compactD: Math.max(0.1, num(b.compactD, 16)),
    turnZone: isNum(b.turnZone) ? Math.max(0, b.turnZone) : null,
    rotateBays: !!b.rotateBays,
  };
}

function gridParams(state) {
  const g = (state && state.grid) || {};
  return {
    span: g.span === "short" ? "short" : "long",
    column: Math.max(0, num(g.column, 2)),
    spm: Math.max(1, Math.round(num(g.stallsPerModule, 3))),
  };
}

const perimOf = (state) => Math.max(0, num(state && state.footprint && state.footprint.perimeter, 1));

/** The turn-zone (end-zone) length: split-level end zone, else bays.turnZone ?? aisle. */
export function turnZoneOf(state) {
  need(state && typeof state === "object", "turnZoneOf", "state");
  if (state.ramp && state.ramp.type === "split") return splitEndZone(state);
  const b = bayParams(state);
  return b.turnZone ?? b.aisle;
}

/** The stall run of every row: → { p, turnZone, xs, xe, length } (plan 3.3). */
export function runOf(state, frame) {
  need(state && typeof state === "object", "runOf", "state");
  need(frame && isNum(frame.W), "runOf", "frame");
  const p = perimOf(state);
  const t = turnZoneOf(state);
  const xs = p + t, xe = frame.W - p - t;
  return { p: r3(p), turnZone: r3(t), xs: r3(xs), xe: r3(xe), length: r3(Math.max(0, xe - xs)) };
}

/* ------------------------------------------------------------ geometry helpers */

function rectRing(x0, y0, x1, y1) {
  const a = r3(Math.min(x0, x1)), b = r3(Math.min(y0, y1)), c = r3(Math.max(x0, x1)), d = r3(Math.max(y0, y1));
  return [[a, b], [c, b], [c, d], [a, d]];
}

function boxOf(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of ring) {
    if (q[0] < x0) x0 = q[0];
    if (q[0] > x1) x1 = q[0];
    if (q[1] < y0) y0 = q[1];
    if (q[1] > y1) y1 = q[1];
  }
  return [x0, y0, x1, y1];
}

/** True when the ring is an axis-aligned rectangle (4 vertices on its box). */
function isAxisRect(ring) {
  if (!ring || ring.length !== 4) return false;
  const [x0, y0, x1, y1] = boxOf(ring);
  return ring.every((q) => (Math.abs(q[0] - x0) < EPS || Math.abs(q[0] - x1) < EPS) && (Math.abs(q[1] - y0) < EPS || Math.abs(q[1] - y1) < EPS))
    && Math.abs(Math.abs(ringArea(ring)) - (x1 - x0) * (y1 - y0)) < 1e-6;
}

const boxOverlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Overlap area of an axis-aligned box with a cut { box, rect, ring }. */
function cutOverlap(box, cut) {
  if (box[2] <= cut.box[0] || box[0] >= cut.box[2] || box[3] <= cut.box[1] || box[1] >= cut.box[3]) return 0;
  if (cut.rect) return boxOverlap(box, cut.box);
  return clipAreaConvex([{ outer: rectRing(box[0], box[1], box[2], box[3]), holes: [] }], cut.ring);
}

/* ------------------------------------------------------------ Clipper */

const CL = () => {
  const L = globalThis.ClipperLib;
  if (!L) throw new Error("layout: globalThis.ClipperLib is not loaded");
  return L;
};
const toPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
const toRing = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

function ccwPath(ring) {
  const path = toPath(ring);
  if (!CL().Clipper.Orientation(path)) path.reverse();
  return path;
}

function mpPaths(mp) {
  const out = [];
  for (const p of mp) {
    out.push(toPath(p.outer));
    for (const h of p.holes || []) out.push(toPath(h));
  }
  return out;
}

/** PolyTree → MultiPoly, rings cleaned (outer CCW, holes CW). */
function treeToMP(tree) {
  const out = [];
  const visit = (node) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) { visit(child); continue; }
      const outer = cleanRing2(toRing(child.Contour()));
      const holes = [];
      for (const h of child.Childs()) {
        const hr = cleanRing2(toRing(h.Contour()), { hole: true });
        if (hr) holes.push(hr);
        visit(h);
      }
      if (outer) out.push({ outer, holes });
    }
  };
  visit(tree);
  return out;
}

/** (subject ∩ within) − minus, as a cleaned MultiPoly. All three are path lists. */
function clipMP(subject, within, minus) {
  const L = CL();
  if (!subject.length) return [];
  let paths = subject;
  if (within) {
    const c = new L.Clipper();
    c.AddPaths(paths, L.PolyType.ptSubject, true);
    c.AddPaths(within, L.PolyType.ptClip, true);
    const sol = [];
    c.Execute(L.ClipType.ctIntersection, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
    paths = sol;
  }
  const c = new L.Clipper();
  c.AddPaths(paths, L.PolyType.ptSubject, true);
  if (minus && minus.length) c.AddPaths(minus, L.PolyType.ptClip, true);
  const tree = new L.PolyTree();
  c.Execute(minus && minus.length ? L.ClipType.ctDifference : L.ClipType.ctUnion, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return treeToMP(tree);
}

function areaInside(ring, insetPaths) {
  const L = CL();
  const c = new L.Clipper();
  c.AddPath(ccwPath(ring), L.PolyType.ptSubject, true);
  c.AddPaths(insetPaths, L.PolyType.ptClip, true);
  const sol = [];
  c.Execute(L.ClipType.ctIntersection, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  let a = 0;
  for (const p of sol) a += L.Clipper.Area(p);
  return Math.abs(a) / (SCALE * SCALE);
}

function insetMP(ring, d) {
  const L = CL();
  const co = new L.ClipperOffset(MITER_LIMIT, 0.25);
  co.AddPath(ccwPath(ring), L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const tree = new L.PolyTree();
  co.Execute(tree, -d * SCALE);
  return treeToMP(tree);
}

/* ------------------------------------------------------------ project */

function zoneLevels(state, project) {
  if (!project || !state || (state.source !== "wrap" && state.source !== "podium")) return null;
  const derived = project.sections && project.sections.massing && project.sections.massing.derived;
  const all = derived && Array.isArray(derived.levels) ? derived.levels : [];
  const zone = state.source === "wrap" ? "deck" : "podium";
  const list = all
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l && l.zone === zone && Array.isArray(l.plates) && l.plates.length)
    .sort((a, b) => num(a.l.z, 0) - num(b.l.z, 0) || a.i - b.i)
    .map(({ l }) => l);
  if (!list.length) return null;
  if (isNum(state.sourceLevel)) {
    const at = list.findIndex((l) => l.index === state.sourceLevel);
    if (at > 0) return list.slice(at);
  }
  return list;
}

function largestOuter(mp) {
  let best = null, bestA = 0;
  for (const p of mp || []) {
    const a = Math.abs(ringArea(p.outer || []));
    if (a > bestA) { bestA = a; best = p.outer; }
  }
  return best;
}

/** The footprint in the local frame. */
function resolveFootprint(state, project) {
  const fp = (state && state.footprint) || {};
  const zl = zoneLevels(state, project);
  if (zl) {
    const outer = largestOuter(zl[0].plates);
    if (outer && outer.length >= 3) return { kind: "polygon", ring: outer.map((q) => [q[0], q[1]]) };
  }
  if (fp.shape === "polygon") {
    need(Array.isArray(fp.points) && fp.points.length >= 3, "layoutFrame", "state.footprint.points");
    return { kind: "polygon", ring: fp.points.map((q) => [q[0], q[1]]) };
  }
  need(isNum(fp.width) && fp.width > 0 && isNum(fp.depth) && fp.depth > 0, "layoutFrame", "state.footprint.width and depth");
  return { kind: "rect", cx: num(fp.x, 0), cy: num(fp.y, 0), angle: num(fp.angle, 0), width: fp.width, depth: fp.depth };
}

function hull(points) {
  const pts = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Rotating calipers: minimum-area bounding rectangle → { cx, cy, theta (deg), eu, ev }. */
function minRect(points) {
  const h = hull(points);
  need(h.length >= 3, "layoutFrame", "footprint polygon (it has no area)");
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ux = Math.cos(th), uy = Math.sin(th);
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const p of h) {
      const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux;
      if (u < mnu) mnu = u;
      if (u > mxu) mxu = u;
      if (v < mnv) mnv = v;
      if (v > mxv) mxv = v;
    }
    const area = (mxu - mnu) * (mxv - mnv);
    if (!best || area < best.area - 1e-6) best = { th, ux, uy, mnu, mxu, mnv, mxv, area };
  }
  const cu = (best.mnu + best.mxu) / 2, cv = (best.mnv + best.mxv) / 2;
  return {
    cx: cu * best.ux - cv * best.uy, cy: cu * best.uy + cv * best.ux,
    theta: best.th / DEG, eu: best.mxu - best.mnu, ev: best.mxv - best.mnv,
  };
}

const normDeg = (a) => {
  let t = a % 360;
  if (t > 180) t -= 360;
  if (t <= -180) t += 360;
  if (t > 90) t -= 180;
  if (t <= -90) t += 180;
  return t;
};

/* ------------------------------------------------------------ frame */

/** Plan 3.1. → { origin: [x, y], angle, W, D, toLocal(p), toLayout(p), shape, footprint: Ring (layout frame) }
    project (optional): with a wrap/podium source the footprint is the massing zone plate. */
export function layoutFrame(state, project = null) {
  need(state && typeof state === "object", "layoutFrame", "state");
  const fp = resolveFootprint(state, project);
  const rotate = bayParams(state).rotateBays;
  let theta, W, D, cx, cy;
  if (fp.kind === "rect") {
    cx = fp.cx; cy = fp.cy;
    if (fp.width >= fp.depth) { theta = fp.angle; W = fp.width; D = fp.depth; }
    else { theta = fp.angle + 90; W = fp.depth; D = fp.width; }
    if (rotate) { theta += 90; [W, D] = [D, W]; }
  } else {
    const m = minRect(fp.ring);
    cx = m.cx; cy = m.cy;
    if (m.eu >= m.ev - 1e-9) { theta = m.theta; W = m.eu; D = m.ev; }
    else { theta = m.theta + 90; W = m.ev; D = m.eu; }
    theta = normDeg(theta);
    if (rotate) { theta = normDeg(theta + 90); [W, D] = [D, W]; }
  }
  const a = theta * DEG;
  const ux = [Math.cos(a), Math.sin(a)], uy = [-Math.sin(a), Math.cos(a)];
  const o = [cx - (W / 2) * ux[0] - (D / 2) * uy[0], cy - (W / 2) * ux[1] - (D / 2) * uy[1]];
  const toLayout = (p) => {
    const dx = p[0] - o[0], dy = p[1] - o[1];
    return [r3(dx * ux[0] + dy * ux[1]), r3(dx * uy[0] + dy * uy[1])];
  };
  const toLocal = (q) => [r3(o[0] + q[0] * ux[0] + q[1] * uy[0]), r3(o[1] + q[0] * ux[1] + q[1] * uy[1])];
  const footprint = fp.kind === "rect"
    ? rectRing(0, 0, W, D)
    : cleanRing2(fp.ring.map(toLayout));
  need(footprint, "layoutFrame", "footprint (it has no area)");
  return { origin: [r3(o[0]), r3(o[1])], angle: r3(theta), W: r3(W), D: r3(D), toLocal, toLayout, shape: fp.kind, footprint };
}

/* ------------------------------------------------------------ bays */

function stackBays(kinds, flags, p, D, b) {
  const bays = [];
  let y = p;
  kinds.forEach((kind, i) => {
    const y0 = y;
    const rows = [];
    let aisle;
    if (kind === "double") {
      const dS = flags[i][0] ? b.compactD : b.stallD;
      const dN = flags[i][1] ? b.compactD : b.stallD;
      rows.push({ id: "S", y0: r3(y), y1: r3(y + dS), compact: flags[i][0] });
      aisle = { y0: r3(y + dS), y1: r3(y + dS + b.aisle) };
      rows.push({ id: "N", y0: r3(y + dS + b.aisle), y1: r3(y + dS + b.aisle + dN), compact: flags[i][1] });
      y += dS + b.aisle + dN;
    } else {
      const dN = flags[i][0] ? b.compactD : b.stallD;
      aisle = { y0: r3(y), y1: r3(y + b.aisle) };
      rows.push({ id: "N", y0: r3(y + b.aisle), y1: r3(y + b.aisle + dN), compact: flags[i][0] });
      y += b.aisle + dN;
    }
    bays.push({ index: i + 1, kind, y0: r3(y0), y1: r3(y), rows, aisle });
  });
  const top = D - p;
  const strip = top - y > 0.0005 ? { y0: r3(y), y1: r3(top) } : null;
  return { bays, strip };
}

function rowCount(state, frame, compact) {
  return rowStalls(state, frame, { id: "S", y0: 0, y1: 1, compact }).length;
}

/** Plan 3.2. → { bays: [{ index, kind, y0, y1, rows: [{ id, y0, y1, compact }], aisle: { y0, y1 } }], strip: { y0, y1 } | null } */
export function baysOf(state, frame) {
  need(state && typeof state === "object", "baysOf", "state");
  need(frame && isNum(frame.D) && isNum(frame.W), "baysOf", "frame");
  const b = bayParams(state);
  const p = perimOf(state);
  const Du = frame.D - 2 * p;
  const B2 = 2 * b.stallD + b.aisle, B1 = b.stallD + b.aisle;
  const nb = Math.max(0, Math.floor(Du / B2 + EPS));
  let r = Du - nb * B2;
  const kinds = new Array(nb).fill("double");
  if (b.edgeBays && r >= B1 - EPS) { kinds.push("single"); r -= B1; }
  let flags = kinds.map((k) => (k === "double" ? [false, false] : [false]));
  if (b.compactShare > 0 && kinds.length) {
    const std = stackBays(kinds, flags, p, frame.D, b);
    const rows = [];
    std.bays.forEach((bay, bi) => bay.rows.forEach((row, ri) => rows.push({ bi, ri: bay.kind === "double" ? (row.id === "S" ? 0 : 1) : 0, yc: (row.y0 + row.y1) / 2 })));
    const cores = Array.isArray(state.cores) ? state.cores : [];
    const ref = cores.find((c) => c && c.kind === "elevator") || cores[0] || null;
    const refY = ref ? num(ref.y, 0) + num(ref.d, 0) / 2 : -Infinity;
    rows.sort((u, v) => Math.abs(v.yc - refY) - Math.abs(u.yc - refY) || v.yc - u.yc);
    const nStd = rowCount(state, frame, false), nCmp = rowCount(state, frame, true);
    const total = rows.length;
    for (let c = 1; c <= total; c++) {
      const all = (total - c) * nStd + c * nCmp;
      if (all > 0 && (c * nCmp) / all >= b.compactShare - EPS) {
        flags = kinds.map((k) => (k === "double" ? [false, false] : [false]));
        for (let i = 0; i < c; i++) flags[rows[i].bi][rows[i].ri] = true;
        break;
      }
      if (c === total) flags = kinds.map((k) => (k === "double" ? [true, true] : [true]));
    }
  }
  return stackBays(kinds, flags, p, frame.D, b);
}

/** Plan 3.3. The stalls of one row before cuts → [{ k, x0, x1, y0, y1 }], k 0-based from the west.
    A row with compact: true uses compactW. */
export function rowStalls(state, frame, row) {
  need(state && typeof state === "object", "rowStalls", "state");
  need(row && isNum(row.y0) && isNum(row.y1), "rowStalls", "row");
  const b = bayParams(state), g = gridParams(state);
  const { xs, xe } = runOf(state, frame);
  const R = xe - xs;
  const w = row.compact ? b.compactW : b.stallW;
  const out = [];
  if (R <= EPS) return out;
  const y0 = r3(row.y0), y1 = r3(row.y1);
  const add = (x) => out.push({ k: out.length, x0: r3(x), x1: r3(x + w), y0, y1 });
  if (g.span === "long") {
    const n = Math.floor(R / w + EPS);
    for (let k = 0; k < n; k++) add(xs + k * w);
  } else {
    const M = g.column + g.spm * w;
    const km = Math.floor(R / M + EPS);
    for (let j = 0; j < km; j++) for (let i = 0; i < g.spm; i++) add(xs + j * M + g.column + i * w);
    const rr = R - km * M;
    const extra = Math.floor(Math.max(0, rr - g.column) / w + EPS);
    for (let i = 0; i < extra; i++) add(xs + km * M + g.column + i * w);
  }
  return out;
}

/* ------------------------------------------------------------ levels */

/** The level stack → [{ index, z, ftf }], index 1 = lowest. */
export function levelList(state, project = null) {
  need(state && typeof state === "object", "levelList", "state");
  const lv = state.levels || {};
  const count = Math.max(1, Math.floor(num(lv.count, 1)));
  const ftf = Math.max(0, num(lv.ftf, 10.5));
  const ftf1 = Math.max(0, num(lv.ftf1, ftf));
  const below = Math.max(0, Math.min(count, Math.floor(num(lv.belowGrade, 0))));
  const zl = zoneLevels(state, project);
  const f = [];
  for (let i = 1; i <= count; i++) {
    const zlv = zl && zl[i - 1];
    f.push(zlv && isNum(zlv.ftf) ? zlv.ftf : i === 1 ? ftf1 : ftf);
  }
  let z = 0;
  for (let i = 0; i < below; i++) z -= f[i];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const zlv = zl && zl[i - 1];
    if (zlv && isNum(zlv.z)) z = zlv.z;
    out.push({ index: i, z: r3(z), ftf: f[i - 1] });
    z += f[i - 1];
  }
  return out;
}

/* ------------------------------------------------------------ cores, entries, liner */

function coreRing(c) {
  return rectRing(num(c.x, 0), num(c.y, 0), num(c.x, 0) + Math.max(0, num(c.w, 0)), num(c.y, 0) + Math.max(0, num(c.d, 0)));
}

function projectCores(state, project, frame, levels, plateRing) {
  if (!project || !state.coresFromProject) return null;
  const derived = project.sections && project.sections.massing && project.sections.massing.derived;
  const all = derived && Array.isArray(derived.levels) ? derived.levels : [];
  const bars = all.filter((l) => l && l.zone === "bar" && Array.isArray(l.seeds) && l.seeds.length)
    .slice().sort((a, b) => num(a.z, 0) - num(b.z, 0));
  if (!bars.length) return null;
  const topZ = levels.length ? levels[levels.length - 1].z : 0;
  const lvl = bars.find((l) => num(l.z, 0) >= topZ - 0.01) || bars[0];
  const counter = { stair: 0, elevator: 0 };
  const out = [];
  for (const s of lvl.seeds) {
    if (!s || !Array.isArray(s.outer) || s.outer.length < 3) continue;
    const kind = s.kind === "elevator" ? "elevator" : "stair";
    const ring = cleanRing2(s.outer.map((q) => frame.toLayout(q)));
    if (!ring) continue;
    const over = ringIsConvexFull(plateRing) ? clipAreaConvex([{ outer: ring, holes: [] }], plateRing) : areaInside(ring, [ccwPath(plateRing)]);
    if (over <= LOSS) continue;
    counter[kind] += 1;
    const [x0, y0, x1, y1] = boxOf(ring);
    out.push({ id: `${kind === "elevator" ? "E" : "S"}${counter[kind]}`, kind, ring, x: r3(x0), y: r3(y0), w: r3(x1 - x0), d: r3(y1 - y0), source: "project" });
  }
  return out;
}

function ringIsConvexFull(ring) {
  const n = ring.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], c = ring[(i + 2) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < EPS) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

function entryRing(e, frame, bays, run) {
  const w = Math.max(0, num(e.width, 24));
  const at = num(e.at, 0);
  const W = frame.W, D = frame.D;
  const side = e.side || "west";
  if (side === "west") return rectRing(0, at - w / 2, run.xs, at + w / 2);
  if (side === "east") return rectRing(run.xe, at - w / 2, W, at + w / 2);
  if (side === "south") {
    const y1 = bays.length ? bays[0].aisle.y0 : D;
    return rectRing(at - w / 2, 0, at + w / 2, y1);
  }
  const y0 = bays.length ? bays[bays.length - 1].aisle.y1 : 0;
  return rectRing(at - w / 2, y0, at + w / 2, D);
}

function linerRing(liner, frame) {
  const d = Math.max(0, num(liner.depth, 0));
  const W = frame.W, D = frame.D;
  switch (liner.side) {
    case "north": return rectRing(0, D - d, W, D);
    case "west": return rectRing(0, 0, d, D);
    case "east": return rectRing(W - d, 0, W, D);
    default: return rectRing(0, 0, W, d);
  }
}

function makeCut(id, kind, ring) {
  const rect = isAxisRect(ring);
  return { id, kind, ring, box: boxOf(ring), rect, lost: 0 };
}

const pad3 = (n) => String(n).padStart(3, "0");

/** Move a core into the nearest stall row at the same x (plan 3.5 "Move to the nearest row").
    built = layout() result. → { x, y, rowId: "<bay><row>" } | null. South rows take the core
    flush to the row's south edge, north rows flush to its north edge. */
export function moveCoreToRow(core, built) {
  need(core && typeof core === "object", "moveCoreToRow", "core");
  need(built && Array.isArray(built.bays), "moveCoreToRow", "built");
  const d = Math.max(0, num(core.d, 0));
  const yc = num(core.y, 0) + d / 2;
  let best = null;
  for (const bay of built.bays) {
    for (const row of bay.rows) {
      const dist = Math.abs((row.y0 + row.y1) / 2 - yc);
      if (!best || dist < best.dist - EPS) best = { dist, bay, row };
    }
  }
  if (!best) return null;
  const { row, bay } = best;
  const y = row.id === "S" ? row.y0 : Math.max(row.y0, row.y1 - d);
  return { x: r3(num(core.x, 0)), y: r3(y), rowId: `${bay.index}${row.id}` };
}

/* ------------------------------------------------------------ layout */

/** Plan 3.1 to 3.5. → { frame, levels: [{ index, z, ftf, plate, stalls, aisles, turnZones, rows, cuts, lost }],
    bays, strip, cores, warnings, quality, run, inset, footprint, entryLevel }
    Stall = { id, level, bay, row, k, outer: Ring (layout frame, CCW), kind: "standard" | "compact", evReady: false } */
export function layout(state, { project = null, quality = "full" } = {}) {
  need(state && typeof state === "object", "layout", "state");
  const full = quality !== "draft";
  const warnings = [];
  const frame = layoutFrame(state, project);
  const p = perimOf(state);
  const { bays, strip } = baysOf(state, frame);
  const run = runOf(state, frame);
  const levels0 = levelList(state, project);
  const count = levels0.length;
  const below = Math.max(0, Math.min(count, Math.floor(num(state.levels && state.levels.belowGrade, 0))));
  const entryLevel = Math.min(count, below + 1);
  const bp = bayParams(state);

  // footprint and inset (layout frame)
  const polygon = frame.shape === "polygon";
  const plate = [{ outer: frame.footprint, holes: [] }];
  const inset = polygon ? insetMP(frame.footprint, p) : [{ outer: rectRing(p, p, frame.W - p, frame.D - p), holes: [] }];
  const insetPaths = polygon ? mpPaths(inset) : null;
  const insetArea = multiPolyArea(inset);

  if (!bays.length) warnings.push({ code: "no-bays", severity: "warn", floors: [], message: `The footprint is too shallow for one bay (${r3(frame.D - 2 * p)} ft usable).` });
  if (bays.length && run.length < bp.stallW) warnings.push({ code: "short-run", severity: "warn", floors: [], message: `The stall run is ${run.length} ft, too short for a stall.` });

  // cores
  const fromProject = projectCores(state, project, frame, levels0, frame.footprint);
  const coreSrc = fromProject && fromProject.length ? fromProject : (Array.isArray(state.cores) ? state.cores : []).map((c) => ({
    id: c.id, kind: c.kind === "elevator" ? "elevator" : "stair", ring: coreRing(c),
    x: r3(num(c.x, 0)), y: r3(num(c.y, 0)), w: r3(num(c.w, 0)), d: r3(num(c.d, 0)), source: "state",
  }));
  const yb0 = bays.length ? bays[0].y0 : p, yb1 = bays.length ? bays[bays.length - 1].y1 : p;
  const drive = [];
  for (const bay of bays) drive.push([p, bay.aisle.y0, frame.W - p, bay.aisle.y1]);
  if (bays.length) {
    drive.push([p, yb0, run.xs, yb1]);
    drive.push([run.xe, yb0, frame.W - p, yb1]);
  }
  const cores = coreSrc.map((c) => {
    const cut = makeCut(c.id, c.kind, c.ring);
    const inAisle = drive.some((d) => cutOverlap(d, cut) > LOSS);
    const area = Math.abs(ringArea(c.ring));
    const inside = polygon ? areaInside(c.ring, insetPaths) : clipAreaConvex([{ outer: c.ring, holes: [] }], inset[0].outer);
    const outside = area - inside > LOSS;
    if (inAisle) warnings.push({ code: "core-in-aisle", severity: "warn", floors: [], id: c.id, action: "move-to-row", message: `${c.id} sits in the drive aisle.` });
    if (outside) warnings.push({ code: "core-outside", severity: "warn", floors: [], id: c.id, message: `${c.id} extends past the parking footprint.` });
    return { ...c, inAisle, outside };
  });

  const entries = Array.isArray(state.entries) ? state.entries : [];
  const liner = state.liner && state.liner.on ? state.liner : null;
  const linerLevels = liner ? new Set((Array.isArray(liner.levels) ? liner.levels : [1]).map((v) => Math.round(v))) : new Set();
  const speed = count >= 2 ? speedRampFootprint(state) : null;

  // stall rows (same on every level before cuts)
  const rowList = [];
  for (const bay of bays) for (const row of bay.rows) rowList.push({ bay, row, stalls: rowStalls(state, frame, row) });

  const levels = [];
  const linerAisleFloors = [], rampFloors = [];
  let rampLost = 0;
  for (const lv of levels0) {
    const cuts = cores.map((c) => makeCut(c.id, c.kind, c.ring));
    if (lv.index === entryLevel) entries.forEach((e, i) => cuts.push(makeCut(e.id || `N${i + 1}`, "entry", entryRing(e, frame, bays, run))));
    if (liner && linerLevels.has(lv.index)) cuts.push(makeCut("liner", "liner", linerRing(liner, frame)));
    if (speed) cuts.push(makeCut("ramp", "ramp", speed.ring));

    const stalls = [], lost = [];
    for (const { bay, row, stalls: rs } of rowList) {
      for (const s of rs) {
        const id = `P${lv.index}-${bay.index}${row.id}-${pad3(s.k + 1)}`;
        const box = [s.x0, s.y0, s.x1, s.y1];
        const outer = [[s.x0, s.y0], [s.x1, s.y0], [s.x1, s.y1], [s.x0, s.y1]];
        if (polygon) {
          const a = (s.x1 - s.x0) * (s.y1 - s.y0);
          if (a - areaInside(outer, insetPaths) > LOSS) { lost.push({ id, by: "footprint" }); continue; }
        }
        let by = null, bestA = LOSS;
        for (const c of cuts) {
          const ov = cutOverlap(box, c);
          if (ov > bestA + EPS) { bestA = ov; by = c; }
        }
        if (by) { by.lost += 1; lost.push({ id, by: by.id }); continue; }
        stalls.push({ id, level: lv.index, bay: bay.index, row: row.id, k: s.k, outer, kind: row.compact ? "compact" : "standard", evReady: false });
      }
    }

    // liner partial aisle cut
    const linerCut = cuts.find((c) => c.kind === "liner");
    if (linerCut) {
      for (const bay of bays) {
        const ab = [p, bay.aisle.y0, frame.W - p, bay.aisle.y1];
        const ov = cutOverlap(ab, linerCut);
        const full_ = (ab[2] - ab[0]) * (ab[3] - ab[1]);
        if (ov > LOSS && ov < full_ - LOSS) { linerAisleFloors.push(lv.index); break; }
      }
    }
    const rampCut = cuts.find((c) => c.kind === "ramp");
    if (rampCut && rampCut.lost > 0) { rampFloors.push(lv.index); rampLost = Math.max(rampLost, rampCut.lost); }

    // area MultiPolys
    const aisleRects = bays.map((bay) => rectRing(run.xs, bay.aisle.y0, run.xe, bay.aisle.y1)).filter((r) => r[1][0] > r[0][0]);
    const tzRects = bays.length ? [rectRing(p, yb0, run.xs, yb1), rectRing(run.xe, yb0, frame.W - p, yb1)].filter((r) => r[1][0] > r[0][0]) : [];
    const rowRects = rowList.filter((r) => r.stalls.length).map(({ row, stalls: rs }) => rectRing(rs[0].x0, row.y0, rs[rs.length - 1].x1, row.y1));
    let aisles, turnZones, rows;
    if (full) {
      const solid = cuts.filter((c) => c.kind !== "entry").map((c) => ccwPath(c.ring));
      const within = mpPaths(inset);
      aisles = clipMP(aisleRects.map(ccwPath), within, solid);
      turnZones = clipMP(tzRects.map(ccwPath), within, solid);
      rows = clipMP(rowRects.map(ccwPath), within, solid);
    } else {
      const asMP = (rs) => rs.map((r) => ({ outer: r, holes: [] }));
      aisles = asMP(aisleRects); turnZones = asMP(tzRects); rows = asMP(rowRects);
    }

    levels.push({
      index: lv.index, z: lv.z, ftf: lv.ftf, plate, stalls, aisles, turnZones, rows,
      cuts: cuts.map((c) => ({ id: c.id, kind: c.kind, ring: c.ring, lost: c.lost })),
      lost,
    });
  }
  if (linerAisleFloors.length) warnings.push({ code: "liner-aisle", severity: "warn", floors: linerAisleFloors, message: "The liner cuts a drive aisle." });
  if (rampFloors.length) warnings.push({ code: "ramp-stalls", severity: "warn", floors: rampFloors, message: `The speed ramp removes ${rampLost} stalls per level.` });

  return {
    quality: full ? "full" : "draft",
    frame, levels, bays, strip, cores, warnings,
    run, inset, insetArea: Math.round(insetArea * 10) / 10, footprint: frame.footprint, entryLevel,
  };
}
