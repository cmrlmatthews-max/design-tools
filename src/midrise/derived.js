/* ==========================================================================
   midrise/derived.js — Mid-Rise Generator → massing.derived (docs/project-file-spec.md 6.2)

   midriseDerived(state, built, metrics) → { footprint, height, levels, context, metrics }
     state    the mid-rise state (docs/mid-rise-generator-technical-plan.md section 2)
     built    assemble(state) (plan section 4): levels[{ index, zone, z, ftf, program, plates, spines, barIds }], solids
     metrics  computeMetrics(...) rows. A number is read as is; an object is read through .total / .value.
              A missing row falls back to a figure computed from `built`.

   seedBlocks(state, built) → { [levelIndex]: [{ kind, outer }] }   (plan section 3.11, bar levels only)
     kind "stair" | "exterior-stair" | "elevator"; outer = a clean counter-clockwise ring.

   levelNames(levels) → ["Podium 1", "Floor 2", …, "Deck 1", …]   (shared with sketchup.js)

   Pure: no DOM. Clipper (globalThis.ClipperLib, SCALE 1000) is used only for the footprint union.
   Units: feet. Plan (x, y): x = east, y = north.
   ========================================================================== */

import { cleanRing2 } from "../shared/sketchup-format.js";

const SCALE = 1000;
const STAIR = { along: 12, across: 22, inset: 6 };     // exit stair, plan section 3.11
const EXT_STAIR = { along: 10, across: 20 };           // exterior stair at a breezeway
const ELEV = { along: 10, across: 10 };                // elevator

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clone = (o) => JSON.parse(JSON.stringify(o));
const need = (v, name) => { if (v === undefined || v === null) throw new Error(`midriseDerived: missing input "${name}".`); return v; };

/* ---------- rings and multipolygons ---------- */

/** One {outer, holes} piece → cleaned piece, or null when the outer ring is degenerate. */
function cleanPiece(poly) {
  const outer = cleanRing2(poly && poly.outer);
  if (!outer) return null;
  const holes = [];
  for (const h of (poly && poly.holes) || []) {
    const c = cleanRing2(h, { hole: true });
    if (c) holes.push(c);
  }
  return { outer, holes };
}
const cleanMulti = (mp) => (Array.isArray(mp) ? mp : []).map(cleanPiece).filter(Boolean);

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const multiArea = (mp) => mp.reduce((s, pc) => s + Math.abs(ringArea(pc.outer)) - pc.holes.reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);

/** Union of several MultiPolys with Clipper. Returns a cleaned MultiPoly. */
function unionMulti(list) {
  const C = globalThis.ClipperLib;
  if (!C) throw new Error("midriseDerived: ClipperLib is not loaded (globalThis.ClipperLib) and the footprint needs it.");
  const toPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
  const clip = new C.Clipper();
  let any = false;
  for (const mp of list) {
    for (const pc of mp) {
      clip.AddPath(toPath(pc.outer), C.PolyType.ptSubject, true);
      for (const h of pc.holes) clip.AddPath(toPath(h), C.PolyType.ptSubject, true);   // regions wind 1 or 0, so windings add up correctly
      any = true;
    }
  }
  if (!any) return [];
  const tree = new C.PolyTree();
  clip.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const ring = (node) => node.Contour().map((p) => [p.X / SCALE, p.Y / SCALE]);
  const out = [];
  const visit = (node) => {
    if (!node.IsHole()) {
      const outer = cleanRing2(ring(node));
      const holes = [];
      for (const ch of node.Childs()) {
        const h = cleanRing2(ring(ch), { hole: true });
        if (h) holes.push(h);
      }
      if (outer) out.push({ outer, holes });
    }
    for (const ch of node.Childs()) for (const g of ch.Childs()) visit(g);   // islands inside holes
  };
  for (const top of tree.Childs()) visit(top);
  return out;
}

/* ---------- level names ---------- */

/** "Podium n" (n = level index), "Floor n" (n = level index), "Deck n" (n counts deck levels from 1). */
export function levelNames(levels) {
  let deck = 0;
  return (levels || []).map((l) => {
    if (l.zone === "podium") return `Podium ${l.index}`;
    if (l.zone === "deck") return `Deck ${++deck}`;
    return `Floor ${l.index}`;
  });
}

/* ---------- bar spines (plan section 3.1 and 3.2, kept here so this file stands alone) ---------- */

const dirOf = (deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a), Math.sin(a)]; };

/** The centerline vertices of a bar: start, each bend point, end. */
function centerline(bar) {
  const length = need(bar.length, "bar.length");
  const bends = (bar.bends || []).filter((b) => b && isNum(b.at) && b.at > 0 && b.at < length).sort((a, b) => a.at - b.at);
  const pts = [[bar.x || 0, bar.y || 0]];
  let angle = bar.angle || 0, at = 0;
  const stops = [...bends.map((b) => ({ at: b.at, deg: b.deg || 0 })), { at: length, deg: 0 }];
  for (const s of stops) {
    const [dx, dy] = dirOf(angle), p = pts[pts.length - 1], d = s.at - at;
    pts.push([p[0] + dx * d, p[1] + dy * d]);
    at = s.at; angle += s.deg;
  }
  return pts;
}

/** Offset a polyline to its left by s ft with mitered corners. */
function offsetPath(pts, s) {
  if (!s) return pts.map((p) => p.slice());
  const n = pts.length, normals = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1;
    normals.push([-dy / l, dx / l]);
  }
  return pts.map((p, i) => {
    let nx, ny;
    if (i === 0) [nx, ny] = normals[0];
    else if (i === n - 1) [nx, ny] = normals[n - 2];
    else {
      const a = normals[i - 1], b = normals[i], k = 1 + a[0] * b[0] + a[1] * b[1];
      nx = (a[0] + b[0]) / (k || 1); ny = (a[1] + b[1]) / (k || 1);
    }
    return [p[0] + nx * s, p[1] + ny * s];
  });
}

/** The corridor spine: the centerline, shifted toward the corridor side for single-loaded bars. */
function spineOf(bar, rules) {
  const pts = centerline(bar);
  if (bar.corridor !== "single") return pts;
  const shift = (bar.depth || 0) / 2 - ((rules && rules.corridorWidth) || 5.67) / 2;
  return offsetPath(pts, bar.unitSide === "right" ? shift : -shift);       // corridor is opposite the units
}

const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Point and unit direction at `dist` ft along a polyline (clamped to its ends). */
function pointAt(pts, dist) {
  let left = Math.max(0, dist);
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy);
    if (left <= l || i + 2 === pts.length) {
      const t = l ? Math.min(left, l) / l : 0;
      return { x: pts[i][0] + dx * t, y: pts[i][1] + dy * t, ux: l ? dx / l : 1, uy: l ? dy / l : 0 };
    }
    left -= l;
  }
  return { x: pts[0][0], y: pts[0][1], ux: 1, uy: 0 };
}

/** A rectangle `along` × `across` centred at `dist` along the spine and `offset` ft to its left. CCW ring. */
function blockAt(pts, dist, offset, along, across) {
  const p = pointAt(pts, dist), vx = -p.uy, vy = p.ux;
  const cx = p.x + vx * offset, cy = p.y + vy * offset, a = along / 2, b = across / 2;
  const c = (s, t) => [r3(cx + p.ux * s + vx * t), r3(cy + p.uy * s + vy * t)];
  return [c(-a, -b), c(a, -b), c(a, b), c(-a, b)];
}

/* ---------- seeds (plan section 3.11) ---------- */

function unitWidthOf(state, bar) {
  const prog = (state.programs || {})[bar.program] || {};
  return bar.unitWidth || prog.unitWidth || 28;
}

/** Per-bar seed blocks (kind + ring), the same on every level the bar occupies. → { [barId]: [{ kind, outer }] } */
function seedsByBar(state, unitsTotal) {
  const rules = state.rules || {};
  const bars = state.bars || [];
  const stairPer = rules.stairPer || 250, elevPer = rules.elevatorPer || 100, bw = rules.breezewayWidth || 8, cw = rules.corridorWidth || 5.67;
  const out = {};
  const push = (id, kind, ring) => { const outer = cleanRing2(ring); if (outer) (out[id] = out[id] || []).push({ kind, outer }); };
  const spines = {};

  for (const bar of bars) {
    const spine = spineOf(bar, rules);
    spines[bar.id] = spine;
    const L = pathLength(spine);
    const ends = bar.ends || {};
    if (ends.start === "stair") push(bar.id, "stair", blockAt(spine, STAIR.inset, 0, STAIR.along, STAIR.across));
    if (ends.end === "stair") push(bar.id, "stair", blockAt(spine, L - STAIR.inset, 0, STAIR.along, STAIR.across));
    if (bar.corridor === "breezeway") {
      const w = unitWidthOf(state, bar), module = 2 * w + bw, n = Math.floor(L / module);
      for (let i = 0; i < n; i++) push(bar.id, "exterior-stair", blockAt(spine, i * module + w + bw / 2, 0, EXT_STAIR.along, EXT_STAIR.across));
    } else {
      const extra = Math.max(0, Math.ceil(L / stairPer) - 1);                 // corridor length: breezeway bars add 0
      for (let k = 1; k <= extra; k++) push(bar.id, "stair", blockAt(spine, (L * k) / (extra + 1), 0, STAIR.along, STAIR.across));
    }
  }

  // elevators: all on the longest bar that has a corridor, at its mid-length, on the unitSide side
  const withCorridor = bars.filter((b) => b.corridor !== "breezeway");
  if (withCorridor.length) {
    const tall = bars.some((b) => (b.floors || 0) >= 3);
    let count = Math.ceil((unitsTotal || 0) / elevPer);
    if (tall) count = Math.max(1, count);
    if (count > 0) {
      let host = withCorridor[0];
      for (const b of withCorridor) if (pathLength(spines[b.id]) > pathLength(spines[host.id])) host = b;
      const spine = spines[host.id], L = pathLength(spine), side = host.unitSide === "right" ? -1 : 1;
      for (let k = 0; k < count; k++) {
        push(host.id, "elevator", blockAt(spine, L / 2 + (k - (count - 1) / 2) * ELEV.along, side * (cw / 2 + ELEV.across / 2), ELEV.along, ELEV.across));
      }
    }
  }
  return out;
}

const metricNumber = (v) => {
  if (isNum(v)) return v;
  if (v && typeof v === "object") for (const k of ["total", "value", "ratio"]) if (isNum(v[k])) return v[k];
  return null;
};

/** Which bars sit on a built level: level.barIds, else every bar tall enough. */
function barsOnLevel(state, level, podiumLevels) {
  if (level.zone !== "bar") return [];
  const bars = state.bars || [];
  if (Array.isArray(level.barIds)) return bars.filter((b) => level.barIds.includes(b.id));
  return bars.filter((b) => level.index - podiumLevels <= (b.floors || 0));
}

/**
 * The seed blocks of every bar level. → { [levelIndex]: [{ kind, outer }] }
 * `units` (optional number) overrides the unit count used for the elevator count.
 */
export function seedBlocks(state, built, units) {
  need(state, "state"); need(built, "built");
  const podiumLevels = state.podium && state.podium.on ? (state.podium.levels || []).length : 0;
  const perBar = seedsByBar(state, isNum(units) ? units : 0);
  const out = {};
  for (const level of built.levels || []) {
    if (level.zone !== "bar") continue;
    const list = [];
    for (const bar of barsOnLevel(state, level, podiumLevels)) for (const s of perBar[bar.id] || []) list.push({ kind: s.kind, outer: s.outer.map((p) => p.slice()) });
    out[level.index] = list;
  }
  return out;
}

/* ---------- site area, for the fallbacks ---------- */

function siteArea(state) {
  const s = (state && state.site) || {};
  if (s.shape === "polygon" && Array.isArray(s.points) && s.points.length >= 3) return Math.abs(ringArea(s.points));
  return (s.width || 0) * (s.depth || 0);
}

/* ---------- the writer ---------- */

export function midriseDerived(state, built, metrics) {
  need(state, "state"); need(built, "built");
  const builtLevels = need(built.levels, "built.levels");
  const m = metrics || {};

  const levelsIn = builtLevels.map((l) => ({ ...l, plates: cleanMulti(l.plates) }));
  const elevUnits = metricNumber(m.units);
  const seeds = seedBlocks(state, { ...built, levels: levelsIn }, elevUnits === null ? 0 : elevUnits);
  const names = levelNames(levelsIn);

  const levels = levelsIn.map((l, i) => {
    const spines = (l.zone === "bar" ? l.spines || [] : []).filter((s) => Array.isArray(s) && s.length >= 2).map((s) => s.map((p) => [r3(p[0]), r3(p[1])]));
    return {
      index: l.index, name: names[i], zone: l.zone, z: r3(l.z), ftf: r3(l.ftf), program: l.program,
      plates: l.plates, core: null, spines, seeds: l.zone === "bar" ? seeds[l.index] || [] : [],
    };
  });

  const footprint = unionMulti(levels.map((l) => l.plates));

  const gfaFallback = levels.reduce((s, l) => s + multiArea(l.plates), 0);
  const gfa = metricNumber(m.gfa);
  const area = siteArea(state);
  const far = metricNumber(m.far);
  const cov = metricNumber(m.siteCoverage);
  const level1 = levels.filter((l) => l.z === 0).map((l) => l.plates);
  const covFallback = area > 0 ? multiArea(unionMulti(level1)) / area : 0;
  const barLevels = levels.filter((l) => l.zone !== "deck");
  const screen = state.roof && state.roof.type === "screen" ? state.roof.height || 0 : 0;
  const heightFallback = barLevels.reduce((mx, l) => Math.max(mx, l.z + l.ftf), 0) + screen;
  const height = metricNumber(m.height);
  const podiumCount = levels.filter((l) => l.zone === "podium").length;
  const tallest = Math.max(0, ...(state.bars || []).map((b) => b.floors || 0));
  const floors = metricNumber(m.floors);
  const units = metricNumber(m.units);

  return {
    footprint,
    height: r1(height === null ? heightFallback : height),
    levels,
    context: { blocks: clone(((state.context && state.context.blocks) || []).map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d, h: b.h }))) },
    metrics: {
      gfa: Math.round(gfa === null ? gfaFallback : gfa),
      far: Math.round((far === null ? (area > 0 ? gfaFallback / area : 0) : far) * 100) / 100,
      siteCoverage: Math.round((cov === null ? covFallback : cov) * 1000) / 1000,
      floors: floors === null ? podiumCount + tallest : floors,
      height: r1(height === null ? heightFallback : height),
      units: units === null ? 0 : units,
    },
  };
}
