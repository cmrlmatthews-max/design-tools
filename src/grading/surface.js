/* ==========================================================================
   GRADING: surface
   Plan: docs/grading-sketch-technical-plan.md, sections 3.1, 3.2 (rings), and 3.5.

   Pure ES module: no DOM, no Three.js, no hidden state, no mutation of inputs.
   Units: feet. Plan (x, y) in the project frame: east = +x, north = +y. z = NAVD88 ft with a site,
   local ft without one. Grid nodes round to 0.001 ft. Surface functions are NOT rounded (the earthwork
   midpoint rule needs the exact planes); callers round what they report.

   Grid = { spacing, n, x0, y0, nodes: Float64Array(n·n·3) [x, y, z row-major from the south],
            z: Float64Array(n·n), min, max, at(x, y) }   at = bilinear on the nodes, clamped to the edge.

   Feature (what makeSurface reads) = { id, kind: "pad" | "drive" | "lot", ring, rings, box: [x0, y0, x1, y1],
            contains(x, y), z(x, y), nearest(x, y) → { x, y, d }, zMin, zMax }
   areaFeature builds one from rings; features.js builds drives with the same shape.
   ========================================================================== */
import { gridSpacing } from "../site/geo.js";
import { cleanRing2 } from "../shared/sketchup-format.js";
import { getSection, transformRing } from "../shared/project.js";
import { wallSegments, blocks } from "./walls.js";

const EPS = 1e-6;                // ft: boundary tolerance (section 3.5, item 1)
const CONFLICT_EPS = 1e-9;       // ft: lo above hi by more than this is a slope conflict

const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const snap0 = (v) => (Math.abs(v) < 1e-12 ? 0 : v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/* ------------------------------------------------------------ small geometry */

function onSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= EPS;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSeg(x, y, a[0], a[1], b[0], b[1])) return true;
    if ((b[1] > y) !== (a[1] > y) && x < ((a[0] - b[0]) * (y - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside;
  }
  return inside;
}

function nearestOnRings(rings, x, y) {
  let best = { x, y, d: Infinity };
  for (const ring of rings) for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * dx, qy = a[1] + t * dy, d = Math.hypot(x - qx, y - qy);
    if (d < best.d) best = { x: qx, y: qy, d };
  }
  return best;
}

function boxOfPoints(pts, box = [Infinity, Infinity, -Infinity, -Infinity]) {
  for (const p of pts) {
    if (!isPt(p)) continue;
    if (p[0] < box[0]) box[0] = p[0]; if (p[0] > box[2]) box[2] = p[0];
    if (p[1] < box[1]) box[1] = p[1]; if (p[1] > box[3]) box[3] = p[1];
  }
  return box;
}

/* ------------------------------------------------------------ ground (section 3.1) */

/** Section 3.1, plane mode: z = z0 − (slope ÷ 100)(x sin b + y cos b), b = downhill bearing (0 = north, clockwise). */
export function planeGround(plane) {
  const p = isObj(plane) ? plane : {};
  const z0 = num(p.z0, 1000), s = num(p.slope, 0) / 100, b = (num(p.downhill, 180) * Math.PI) / 180;
  const sx = s * snap0(Math.sin(b)), sy = s * snap0(Math.cos(b));
  return (x, y) => z0 - (sx * x + sy * y);
}

function makeGrid(spacing, n, x0, y0, zOf) {
  const nodes = new Float64Array(n * n * 3), z = new Float64Array(n * n);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = r3(x0 + i * spacing), y = r3(y0 + j * spacing), v = zOf(i, j, x, y);
    nodes[3 * k] = x; nodes[3 * k + 1] = y; nodes[3 * k + 2] = v; z[k] = v;
    if (v < min) min = v; if (v > max) max = v;
  }
  const L = (n - 1) * spacing;
  const at = (x, y) => {
    const cx = Math.min(Math.max(x - x0, 0), L) / spacing, cy = Math.min(Math.max(y - y0, 0), L) / spacing;
    const i = Math.min(Math.floor(cx), n - 2), j = Math.min(Math.floor(cy), n - 2);
    const tx = cx - i, ty = cy - j, o = j * n + i;
    return (z[o] * (1 - tx) + z[o + 1] * tx) * (1 - ty) + (z[o + n] * (1 - tx) + z[o + n + 1] * tx) * ty;
  };
  return { spacing, n, x0: r3(x0), y0: r3(y0), nodes, z, min, max, at };
}

/** Section 3.1, site mode: { spacing, n, points: [[x, y, z], …] row-major from the south } → Grid. */
export function gridFromSite(siteDerivedGround) {
  const g = siteDerivedGround || {};
  const n = Math.floor(num(g.n, 0)), d = num(g.spacing, 0), pts = Array.isArray(g.points) ? g.points : [];
  if (!(n >= 2) || !(d > 0) || pts.length !== n * n || !isPt(pts[0])) throw new Error("gridFromSite: the site ground is not an n by n grid of [x, y, z] points.");
  const x0 = pts[0][0], y0 = pts[0][1];
  return makeGrid(d, n, x0, y0, (i, j) => {
    const p = pts[j * n + i];
    const v = p && Number.isFinite(p[2]) ? p[2] : NaN;
    if (!Number.isFinite(v)) throw new Error("gridFromSite: a ground point has no elevation.");
    return v;
  });
}

/** Bounding box [x0, y0, x1, y1] of typed footprints, drives (± width/2), lots, routes, plus extra rings. */
function stateExtent(state, rings = []) {
  const st = state || {};
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) boxOfPoints(r, box);
  for (const b of Array.isArray(st.buildings) ? st.buildings : []) if (b && (b.source || "typed") === "typed") boxOfPoints(b.outer || [], box);
  for (const dv of Array.isArray(st.drives) ? st.drives : []) {
    const w = Math.max(0, num(dv && dv.width, 24)) / 2;
    for (const p of (dv && dv.line) || []) if (isPt(p)) boxOfPoints([[p[0] - w, p[1] - w], [p[0] + w, p[1] + w]], box);
  }
  for (const l of Array.isArray(st.lots) ? st.lots : []) boxOfPoints((l && l.ring) || [], box);
  for (const r of Array.isArray(st.routes) ? st.routes : []) boxOfPoints((r && r.line) || [], box);
  return Number.isFinite(box[0]) ? box : null;
}

/**
 * Section 3.1, plane grid. extentBox = [x0, y0, x1, y1] of the features (no margin); null = the typed
 * features of the state. Grows the box by ground.margin (200), S = the larger side, { spacing, n } =
 * gridSpacing(S), origin floor((c − S/2) ÷ d) × d. When the far edge falls short of the box, n grows by one.
 * → Grid with z from planeGround(ground.plane).
 */
export function gridForPlane(state, extentBox) {
  const g = (state && state.ground) || {};
  const margin = Math.max(0, num(g.margin, 200));
  const box = Array.isArray(extentBox) && extentBox.length >= 4 && extentBox.every(Number.isFinite) ? extentBox : stateExtent(state) || [0, 0, 0, 0];
  const bx0 = box[0] - margin, by0 = box[1] - margin, bx1 = box[2] + margin, by1 = box[3] + margin;
  const S = Math.max(bx1 - bx0, by1 - by0, 1);
  const { spacing: d, n: n0 } = gridSpacing(S);
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const x0 = Math.floor((cx - S / 2) / d + 1e-9) * d, y0 = Math.floor((cy - S / 2) / d + 1e-9) * d;
  let n = n0;
  while (x0 + (n - 1) * d < bx1 - 1e-9 || y0 + (n - 1) * d < by1 - 1e-9) n++;
  const at = planeGround(g.plane);
  return makeGrid(d, n, x0, y0, (i, j, x, y) => at(x, y));
}

/* ------------------------------------------------------------ footprint rings (section 3.2) */

function outerRings(sec, mp) {
  let list = Array.isArray(mp) ? mp : [];
  if (list.length && isPt(list[0])) list = [{ outer: list, holes: [] }];
  const out = [];
  for (const p of list) {
    const ring = cleanRing2(transformRing(sec, (p && p.outer) || [], "toProject"));
    if (ring) out.push(ring);
  }
  return out;
}

/**
 * Section 3.2: the footprint rings of every state building in the project frame (courtyard holes dropped:
 * they are part of the pad). Ids: the typed id, or "massing" / "parking" for project sources.
 * → { list: [{ id, source, name, rings: [ring, …], building }], notes: [string], warnings: [Warning] }
 */
export function footprintRings(state, project) {
  const st = state || {};
  const list = [], notes = [], warnings = [];
  for (const b of Array.isArray(st.buildings) ? st.buildings : []) {
    if (!b || typeof b !== "object") continue;
    const source = b.source === "massing" || b.source === "parking" ? b.source : "typed";
    let rings = [];
    const id = source === "typed" ? String(b.id || "B" + (list.length + 1)) : source;
    if (source === "typed") {
      const r = cleanRing2(b.outer);
      if (r) rings = [r]; else notes.push(`Building ${id} has no footprint.`);
    } else if (source === "massing") {
      const sec = getSection(project, "massing");
      const der = (sec && sec.derived) || {};
      if (!sec) notes.push("No project massing is open.");
      else if (sec.tool === "tower" && !(Array.isArray(der.levels) && der.levels.length)) {
        const message = "The Tower Generator does not write massing levels yet.";
        notes.push(message);
        warnings.push({ code: "tower-no-levels", severity: "info", where: { id }, message });
      } else rings = outerRings(sec, der.footprint);
      if (sec && !rings.length && !warnings.length) notes.push("The project massing has no footprint.");
    } else {
      const sec = getSection(project, "parking");
      const levels = sec && sec.derived && Array.isArray(sec.derived.levels) ? sec.derived.levels.filter(Boolean) : [];
      if (!sec) notes.push("No project parking deck is open.");
      else if (!levels.length) notes.push("The project parking deck has no levels.");
      else {
        const low = levels.slice().sort((p, q) => num(p.z, 0) - num(q.z, 0))[0];
        rings = outerRings(sec, low.plate);
      }
    }
    if (rings.length) list.push({ id, source, name: String(b.name || id), rings, building: b });
  }
  return { list, notes, warnings };
}

/**
 * Section 3.1. → { grid, at, source: "site" | "plane", notes }. Site mode reads
 * project.sections.site.derived.ground; without it the typed plane is used with a note.
 * extentBox (optional third argument) = [x0, y0, x1, y1] of every footprint, drive, lot, and route for
 * the plane grid; when left out it is worked out from the state and the project footprints.
 */
export function existingSurface(state, project, extentBox = null) {
  const st = state || {};
  const g = st.ground || {};
  const notes = [];
  if (g.mode === "site") {
    const sec = getSection(project, "site");
    const ground = sec && sec.derived && sec.derived.ground;
    if (ground) {
      const grid = gridFromSite(ground);
      return { grid, at: grid.at, source: "site", notes };
    }
    notes.push("No site ground in the project. Using the typed plane.");
  }
  const box = extentBox || stateExtent(st, footprintRings(st, project).list.flatMap((f) => f.rings));
  const grid = gridForPlane(st, box);
  return { grid, at: planeGround(g.plane), source: "plane", notes };
}

/* ------------------------------------------------------------ features and the surface (section 3.5) */

/**
 * A feature over one or more rings: { id, kind, rings, z(x, y), zMin, zMax } → Feature.
 * A pad is areaFeature({ id, kind: "pad", rings: pads, z: () => padTop, zMin: padTop, zMax: padTop }).
 */
export function areaFeature({ id, kind, rings, z, zMin, zMax }) {
  const R = (Array.isArray(rings) ? rings : []).map((r) => cleanRing2(r)).filter(Boolean);
  const box = boxOfPoints(R.flat());
  const zf = typeof z === "function" ? z : () => num(z, 0);
  return {
    id, kind, ring: R[0] || [], rings: R, box, z: zf, zMin: num(zMin, zf(box[0], box[1])), zMax: num(zMax, zf(box[0], box[1])),
    contains: (x, y) => x >= box[0] - EPS && x <= box[2] + EPS && y >= box[1] - EPS && y <= box[3] + EPS && R.some((r) => inRing(r, x, y)),
    nearest: (x, y) => nearestOnRings(R, x, y),
  };
}

/** A pad feature from a tier { id, pads | pad, padTop }. */
export function padFeature(tier) {
  const top = num(tier && tier.padTop, 0);
  const rings = Array.isArray(tier && tier.pads) ? tier.pads : tier && tier.pad ? [tier.pad] : [];
  return areaFeature({ id: tier && tier.id, kind: "pad", rings, z: () => top, zMin: top, zMax: top });
}

const KIND_ORDER = { pad: 0, drive: 1, lot: 2 };

/**
 * Section 3.5. features: Feature[] (pads in first-wins order, then drives, then lots; a stable sort by kind
 * keeps the list order inside each kind). walls: Wall[] or polylines (every one acts). existingAt(x, y).
 * daylight: { on, fill, cut } (fill and cut = horizontal per vertical).
 * opts.zRange [min, max] of the existing ground turns on the reach skip; opts.probe (a Grid or [[x, y], …])
 * fills `conflicts` from those points.
 * → { at(x, y), sample(x, y) → { z, inside: id | null, conflict: null | { a, b } }, existingAt,
 *     conflicts: [{ x, y, a, b, count }] }   one conflict per pair of features (a = fill-limit feature,
 *     b = cut-limit feature), at the centroid of the probe points where the limits cross.
 */
export function makeSurface(features, walls, existingAt, daylight, opts = {}) {
  const ex = typeof existingAt === "function" ? existingAt : () => 0;
  const dl = daylight || {};
  const on = dl.on !== false;
  const fill = Math.max(1e-6, num(dl.fill, 3)), cut = Math.max(1e-6, num(dl.cut, 2));
  const W = wallSegments(walls);
  const zr = Array.isArray(opts.zRange) && opts.zRange.every(Number.isFinite) ? opts.zRange : null;
  const sorted = (Array.isArray(features) ? features : []).filter((f) => f && typeof f.contains === "function")
    .map((f, i) => ({ f, i, o: KIND_ORDER[f.kind] ?? 3 }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map(({ f }) => f);
  // Reach skip (section 3.5, performance). Every result lies in [Zlo, Zhi], the range of the existing grid
  // AND of every feature, so a feature farther than (Zhi − Zlo) × max(fill, cut) can neither clamp a point
  // nor take part in a conflict. (The grid range alone is not enough: two pads above the ground limit
  // each other.)
  let Zlo = zr ? zr[0] : Infinity, Zhi = zr ? zr[1] : -Infinity;
  for (const f of sorted) { Zlo = Math.min(Zlo, num(f.zMin, Zlo)); Zhi = Math.max(Zhi, num(f.zMax, Zhi)); }
  const reach = zr ? (Zhi - Zlo) * Math.max(fill, cut) + 1 : Infinity;
  const list = sorted.map((f) => ({ f, box: f.box, reach }));

  function sample(x, y) {
    for (const { f, box } of list) {
      if (x < box[0] - EPS || x > box[2] + EPS || y < box[1] - EPS || y > box[3] + EPS) continue;
      if (f.contains(x, y)) return { z: f.z(x, y), inside: f.id, conflict: null };
    }
    const e0 = ex(x, y);
    if (!on) return { z: e0, inside: null, conflict: null };
    let lo = -Infinity, hi = Infinity, loId = null, hiId = null;
    for (const { f, box, reach } of list) {
      if (reach !== Infinity) {
        const dx = Math.max(box[0] - x, 0, x - box[2]), dy = Math.max(box[1] - y, 0, y - box[3]);
        if (dx * dx + dy * dy > reach * reach) continue;
      }
      const q = f.nearest(x, y);
      if (!Number.isFinite(q.d)) continue;
      if (W.count && blocks(W, [x, y], [q.x, q.y])) continue;
      const e = f.z(q.x, q.y);
      const l = e - q.d / fill, h = e + q.d / cut;
      if (l > lo) { lo = l; loId = f.id; }
      if (h < hi) { hi = h; hiId = f.id; }
    }
    if (loId === null) return { z: e0, inside: null, conflict: null };
    if (lo > hi + CONFLICT_EPS) return { z: (lo + hi) / 2, inside: null, conflict: { a: loId, b: hiId } };
    return { z: Math.min(Math.max(e0, lo), hi), inside: null, conflict: null };
  }

  const conflicts = [];
  const probe = opts.probe;
  const pts = [];
  if (probe && probe.nodes && probe.n) for (let k = 0; k < probe.n * probe.n; k++) pts.push([probe.nodes[3 * k], probe.nodes[3 * k + 1]]);
  else if (Array.isArray(probe)) for (const p of probe) if (isPt(p)) pts.push(p);
  if (pts.length && on) {
    const groups = new Map();
    for (const p of pts) {
      const s = sample(p[0], p[1]);
      if (!s.conflict) continue;
      const key = `${s.conflict.a}|${s.conflict.b}`;
      const g = groups.get(key) || { sx: 0, sy: 0, count: 0, a: s.conflict.a, b: s.conflict.b };
      g.sx += p[0]; g.sy += p[1]; g.count++;
      groups.set(key, g);
    }
    for (const g of groups.values()) conflicts.push({ x: r3(g.sx / g.count), y: r3(g.sy / g.count), a: g.a, b: g.b, count: g.count });
  }

  return { at: (x, y) => sample(x, y).z, sample, existingAt: ex, conflicts };
}
