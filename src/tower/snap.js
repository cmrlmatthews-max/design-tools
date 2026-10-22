/* ==========================================================================
   snap.js — snapping for direct editing in the tower generator (v1.1)

   Pure: no DOM, no three. Plan coordinates in feet, north = +y.
   Contract: docs/v1.1-spec.md, "Contract: src/tower/snap.js".

   A target line: { axis: "x" | "y", value, kind, label, from, to }
     axis "x" = a vertical line in plan at x = value (it constrains x);
                from/to = its y extent (used to draw the guide).
     axis "y" = a horizontal line at y = value; from/to = its x extent.
     kind: "grid" | "site" | "setback" | "podium" | "segment" | "context".

   Public API:
     collectSnapTargets(state, plates, { exclude })        → { lines }
     snapMove(box, delta, targets, { tolerance, grid, enabled }) → { dx, dy, guides }
     snapEdge(value, axis, targets, { tolerance, grid, enabled, span }) → { value, guide }
     snapLength(length, { step })                          → number
   Extra helper (not in the contract, for the UI):
     itemBox(state, plates, { kind, index })               → box | null

   Notes
   - `plates` may be the Plate[] from buildPlates(...).plates or the whole
     buildPlates result. A segment's box is the bbox of its first tower plate
     (so rotation, taper at t = 0 and offset are included). When a segment or
     the podium has no plate (empty, or plates not passed), the box falls back
     to the shape from the state (rotated and offset).
   - Context blocks are targets unless state.context.show === false.
   - Ties: candidates within 0.25 ft of the best distance are compared by
     priority segment > podium > context > setback > site > grid, then by
     distance.
   - Grid is a fallback per axis: only when no line on that axis is within
     tolerance and grid > 0 does the moved min edge snap to the nearest grid
     line (any distance). A line within tolerance therefore always beats the
     grid (priority "grid" is last). Grid guides have kind "grid"; the UI may
     choose not to draw them.
   ========================================================================== */

import { allowedFootprint } from "./envelope.js";
import { shapeToRing } from "./geometry.js";

const TIE = 0.25;   // ft
const EPS = 1e-9;
const PRIORITY = { segment: 6, podium: 5, context: 4, setback: 3, site: 2, grid: 1 };

const DIR = {
  x: { min: "west", max: "east" },
  y: { min: "south", max: "north" },
};

function num(v, d = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

/* ------------------------------------------------------------ boxes */

function emptyBox() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function growRing(b, ring) {
  for (const q of ring) {
    if (q[0] < b.minX) b.minX = q[0];
    if (q[0] > b.maxX) b.maxX = q[0];
    if (q[1] < b.minY) b.minY = q[1];
    if (q[1] > b.maxY) b.maxY = q[1];
  }
  return b;
}

function mpBox(mp) {
  const b = emptyBox();
  for (const p of mp || []) if (p && p.outer) growRing(b, p.outer);
  return validBox(b) ? b : null;
}

function validBox(b) {
  return !!b && Number.isFinite(b.minX) && Number.isFinite(b.maxX) &&
    Number.isFinite(b.minY) && Number.isFinite(b.maxY) && b.maxX >= b.minX && b.maxY >= b.minY;
}

function plateList(plates) {
  if (Array.isArray(plates)) return plates;
  if (plates && Array.isArray(plates.plates)) return plates.plates;
  return [];
}

/** Box of a shape placed with rotation (deg, about the shape's origin) and offset. */
function shapeBox(shape, rotation, ox, oy) {
  const ring = shapeToRing(shape, { segments: 32 });
  if (ring.length < 3) return null;
  const th = (num(rotation, 0) * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const b = emptyBox();
  for (const q of ring) {
    const x = q[0] * c - q[1] * s + ox, y = q[0] * s + q[1] * c + oy;
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
  }
  return validBox(b) ? b : null;
}

/** First-plate boxes: { podium: box|null, segments: Map<index, box> } in one pass. */
function plateBoxes(plates) {
  let podium = null;
  const segments = new Map();
  for (const p of plateList(plates)) {
    if (!p || p.void) continue;
    if (p.zone === "podium") {
      if (!podium) podium = mpBox(p.polygons);
    } else if (p.zone === "tower") {
      const i = p.segmentIndex;
      if (!segments.has(i)) {
        const b = mpBox(p.polygons);
        if (b) segments.set(i, b);
      }
    }
  }
  return { podium, segments };
}

function podiumFallback(state) {
  const pod = state && state.podium;
  if (!pod || !pod.on) return null;
  return shapeBox(pod.shape, 0, num(pod.offset && pod.offset.x, 0), num(pod.offset && pod.offset.y, 0));
}

function segmentFallback(state, i) {
  const seg = state && Array.isArray(state.segments) ? state.segments[i] : null;
  if (!seg) return null;
  return shapeBox(seg.shape, num(seg.rotation, 0), num(seg.offset && seg.offset.x, 0), num(seg.offset && seg.offset.y, 0));
}

function contextBox(b) {
  const w = num(b && b.w, 0), d = num(b && b.d, 0);
  if (!(w > 0 && d > 0)) return null;
  const x = num(b.x, 0), y = num(b.y, 0);
  return { minX: x - w / 2, maxX: x + w / 2, minY: y - d / 2, maxY: y + d / 2 };
}

function contextShown(state) {
  return !!(state && state.context && state.context.show !== false && Array.isArray(state.context.blocks));
}

/**
 * Plan box of an item, for the UI to pass to snapMove (extra helper).
 * kind "segment" → bbox of its first plate; "podium" → podium plate bbox;
 * "context" → x ± w/2, y ± d/2. Anything else → null.
 */
export function itemBox(state, plates, item) {
  if (!item) return null;
  const i = num(item.index, 0);
  if (item.kind === "context") {
    const blocks = (state && state.context && state.context.blocks) || [];
    return contextBox(blocks[i]);
  }
  if (item.kind === "podium") return plateBoxes(plates).podium || podiumFallback(state);
  if (item.kind === "segment") return plateBoxes(plates).segments.get(i) || segmentFallback(state, i);
  return null;
}

/* ------------------------------------------------------------ targets */

function boxLines(out, b, kind, name, withCenter) {
  out.push({ axis: "x", value: b.minX, kind, label: `${name} west edge`, from: b.minY, to: b.maxY });
  out.push({ axis: "x", value: b.maxX, kind, label: `${name} east edge`, from: b.minY, to: b.maxY });
  out.push({ axis: "y", value: b.minY, kind, label: `${name} south edge`, from: b.minX, to: b.maxX });
  out.push({ axis: "y", value: b.maxY, kind, label: `${name} north edge`, from: b.minX, to: b.maxX });
  if (withCenter) {
    out.push({ axis: "x", value: (b.minX + b.maxX) / 2, kind, label: `${name} center`, from: b.minY, to: b.maxY });
    out.push({ axis: "y", value: (b.minY + b.maxY) / 2, kind, label: `${name} center`, from: b.minX, to: b.maxX });
  }
}

function usePolygonSite(site) {
  return site && site.shape === "polygon" && Array.isArray(site.points) && site.points.length >= 3;
}

function siteLines(out, state) {
  const site = (state && state.site) || {};
  if (site.shape === "none") return;                 // Unlimited: no site line to snap to
  if (usePolygonSite(site)) {
    const pts = site.points.map((p) => [num(p[0]), num(p[1])]);
    const b = growRing(emptyBox(), pts);
    if (!validBox(b)) return;
    boxLines(out, b, "site", "Site", false);
    // axis-aligned polygon edges that are not already on the bbox
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      if (Math.abs(a[0] - c[0]) < EPS && Math.abs(a[1] - c[1]) > EPS) {
        if (Math.abs(a[0] - b.minX) < EPS || Math.abs(a[0] - b.maxX) < EPS) continue;
        out.push({ axis: "x", value: a[0], kind: "site", label: "Site edge",
          from: Math.min(a[1], c[1]), to: Math.max(a[1], c[1]) });
      } else if (Math.abs(a[1] - c[1]) < EPS && Math.abs(a[0] - c[0]) > EPS) {
        if (Math.abs(a[1] - b.minY) < EPS || Math.abs(a[1] - b.maxY) < EPS) continue;
        out.push({ axis: "y", value: a[1], kind: "site", label: "Site edge",
          from: Math.min(a[0], c[0]), to: Math.max(a[0], c[0]) });
      }
    }
    return;
  }
  const w = Math.max(0, num(site.width, 0)), d = Math.max(0, num(site.depth, 0));
  if (!(w > 0 && d > 0)) return;
  boxLines(out, { minX: -w / 2, maxX: w / 2, minY: -d / 2, maxY: d / 2 }, "site", "Site", false);
}

function setbackLines(out, state) {
  if (!state || !state.site || state.site.shape === "none") return;
  let mp;
  try { mp = allowedFootprint(state, 0); } catch (e) { return; }   // polygon site without Clipper
  const b = mpBox(mp);
  if (!b) return;
  out.push({ axis: "x", value: b.minX, kind: "setback", label: "West setback line", from: b.minY, to: b.maxY });
  out.push({ axis: "x", value: b.maxX, kind: "setback", label: "East setback line", from: b.minY, to: b.maxY });
  out.push({ axis: "y", value: b.minY, kind: "setback", label: "South setback line", from: b.minX, to: b.maxX });
  out.push({ axis: "y", value: b.maxY, kind: "setback", label: "North setback line", from: b.minX, to: b.maxX });
}

/**
 * All snap lines for a drag. exclude: { kind, index } of the item being moved.
 * → { lines: Line[] }
 */
export function collectSnapTargets(state, plates, { exclude } = {}) {
  state = state || {};
  const lines = [];
  const ex = exclude || {};
  const exIndex = num(ex.index, -1);

  siteLines(lines, state);
  setbackLines(lines, state);

  const pb = plateBoxes(plates);

  if (ex.kind !== "podium" && state.podium && state.podium.on) {
    const b = pb.podium || podiumFallback(state);
    if (b) boxLines(lines, b, "podium", "Podium", true);
  }

  const segs = Array.isArray(state.segments) ? state.segments : [];
  for (let i = 0; i < segs.length; i++) {
    if (ex.kind === "segment" && exIndex === i) continue;
    const b = pb.segments.get(i) || segmentFallback(state, i);
    if (b) boxLines(lines, b, "segment", `Segment ${i + 1}`, true);
  }

  if (contextShown(state)) {
    const blocks = state.context.blocks;
    for (let i = 0; i < blocks.length; i++) {
      if (ex.kind === "context" && exIndex === i) continue;
      const b = contextBox(blocks[i]);
      if (b) boxLines(lines, b, "context", `Context block ${i + 1}`, true);
    }
  }

  return { lines };
}

/* ------------------------------------------------------------ snapping */

function targetLines(targets) {
  if (Array.isArray(targets)) return targets;
  return (targets && Array.isArray(targets.lines)) ? targets.lines : [];
}

/** Pick among candidates { d, line, feature }: best distance, ties (0.25 ft) by priority. */
function pick(cands) {
  if (!cands.length) return null;
  let m = Infinity;
  for (const c of cands) if (Math.abs(c.d) < m) m = Math.abs(c.d);
  let best = null;
  for (const c of cands) {
    const a = Math.abs(c.d);
    if (a > m + TIE + EPS) continue;
    if (!best) { best = c; continue; }
    const pc = PRIORITY[c.line.kind] || 0, pbst = PRIORITY[best.line.kind] || 0;
    if (pc > pbst || (pc === pbst && a < Math.abs(best.d))) best = c;
  }
  return best;
}

function gridLine(axis, value, grid) {
  return { axis, value, kind: "grid", label: `Grid ${grid} ft`, from: 0, to: 0 };
}

/** Snap one axis. features: [[name, coord], ...]; min edge first (used for grid). */
function snapAxis(axis, features, lines, tolerance, grid) {
  const cands = [];
  for (const line of lines) {
    if (!line || line.axis !== axis || !Number.isFinite(line.value)) continue;
    for (const [feature, v] of features) {
      const d = line.value - v;
      if (Math.abs(d) <= tolerance + EPS) cands.push({ d, line, feature });
    }
  }
  const hit = pick(cands);
  if (hit || !(grid > 0)) return hit;
  // fallback: the min edge (or the single edge) to the nearest grid line
  const v = features[0][1];
  const g = Math.round(v / grid) * grid;
  return { d: g - v, line: gridLine(axis, g, grid), feature: features[0][0] };
}

/**
 * Snap a moving box. box: { minX, maxX, minY, maxY } before the move; delta: { dx, dy } raw.
 * → { dx, dy, guides }
 */
export function snapMove(box, delta, targets, { tolerance = 0, grid = 0, enabled = true } = {}) {
  const rdx = num(delta && delta.dx, 0), rdy = num(delta && delta.dy, 0);
  if (!enabled || !box) return { dx: rdx, dy: rdy, guides: [] };
  const lines = targetLines(targets);
  const tol = Math.max(0, num(tolerance, 0));
  const g = Math.max(0, num(grid, 0));

  const x0 = box.minX + rdx, x1 = box.maxX + rdx;
  const y0 = box.minY + rdy, y1 = box.maxY + rdy;
  const hx = snapAxis("x", [["min", x0], ["max", x1], ["center", (x0 + x1) / 2]], lines, tol, g);
  const hy = snapAxis("y", [["min", y0], ["max", y1], ["center", (y0 + y1) / 2]], lines, tol, g);

  const dx = rdx + (hx ? hx.d : 0);
  const dy = rdy + (hy ? hy.d : 0);
  const m = { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy };

  const guides = [];
  if (hx) {
    const L = hx.line, grid0 = L.kind === "grid";
    guides.push({ ...L, from: grid0 ? m.minY : Math.min(L.from, m.minY), to: grid0 ? m.maxY : Math.max(L.to, m.maxY), feature: hx.feature });
  }
  if (hy) {
    const L = hy.line, grid0 = L.kind === "grid";
    guides.push({ ...L, from: grid0 ? m.minX : Math.min(L.from, m.minX), to: grid0 ? m.maxX : Math.max(L.to, m.maxX), feature: hy.feature });
  }
  return { dx, dy, guides };
}

/**
 * Snap one moving edge coordinate (resize handles).
 * span (optional extra): { from, to } extent of the moving edge, used to widen the guide.
 * → { value, guide }   (a grid snap returns a guide only when span is given)
 */
export function snapEdge(value, axis, targets, { tolerance = 0, grid = 0, enabled = true, span } = {}) {
  const v = num(value, 0);
  if (!enabled) return { value: v, guide: null };
  const lines = targetLines(targets);
  const tol = Math.max(0, num(tolerance, 0));
  const g = Math.max(0, num(grid, 0));
  const hit = snapAxis(axis, [["edge", v]], lines, tol, g);
  if (!hit) return { value: v, guide: null };
  const out = v + hit.d;
  const L = hit.line;
  const hasSpan = span && Number.isFinite(span.from) && Number.isFinite(span.to);
  if (L.kind === "grid") {
    if (!hasSpan) return { value: out, guide: null };
    return { value: out, guide: { ...L, from: Math.min(span.from, span.to), to: Math.max(span.from, span.to) } };
  }
  const guide = { ...L };
  if (hasSpan) {
    guide.from = Math.min(L.from, span.from, span.to);
    guide.to = Math.max(L.to, span.from, span.to);
  }
  return { value: out, guide };
}

/** Round a dimension to the step (1 ft default). */
export function snapLength(length, { step = 1 } = {}) {
  const L = num(length, 0);
  const s = num(step, 1);
  if (!(s > 0)) return L;
  const r = Math.round(L / s) * s;
  const clean = Math.round(r * 1e9) / 1e9;
  return clean === 0 ? 0 : clean;
}
