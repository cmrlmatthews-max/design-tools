/* ==========================================================================
   CORE: section cut (Cade, October 28, 2026)
   Replaces the Level cut select. The Section button in the top bar switches to Plan view; a press-drag (or click,
   click) on the ground draws the cut line. The section drawing shows in a pane below the 3D view (split view, with a
   divider to resize it).

   createSection(ctx, { stage, pane, setView, onLayout }) -> api (below)
     stage     #stage. The 3D view (#view) and the handles (#handles) shrink to the space above the pane.
     pane      the empty pane element in #stage (index.html #sectionPane).
     setView   main.js setView(id): the top bar follows the view.
     onLayout  called after the pane opens, closes or is resized (main.js: syncInsets and scene.resize).

   Geometry: the saved project. Massing levels from massing.derived.levels (plates through the placement); parking
   slabs and site neighbors through src/viewer/scene.js layersFrom (rings in the project frame, z0 and z1). The cut is exact and 2D: the cut line meets each plate in
   plan. The ground line samples ctx.ground.at (the grading override, else the Site Model ground) along the cut.
   Everything here is in the PROJECT frame, feet. The 3D marker draws in the shifted scene (core/frame.js).

   Per project in localStorage ('cmrlm.app.section.' + project id): { a, b, flip, open, split }.
   ========================================================================== */
import * as THREE from 'three';
import { getSection, transformRing } from '../../src/shared/project.js';
import { layersFrom, levelsIndex, colorOf, cleanRing, PROGRAM_COLORS } from '../../src/viewer/scene.js';
import { PRIORITY } from './input.js';
import * as frame from './frame.js';

const KEY_PREFIX = 'cmrlm.app.section.';
const ZONE_COLORS = { podium: '#8b929a', tower: '#4f7fd1', mechanical: '#e0762f', crown: '#d9a22b', bar: '#4f7fd1', deck: '#8b929a' };
const MIN_PANE = 140, MIN_VIEW = 140;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- small plan math ---------- */

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];

/** Even-odd test over several rings (outer and holes together). */
function inside(pt, rings) {
  let c = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
  }
  return c;
}

/** The parts [t0, t1] (0..1 along a to b) of the segment inside the rings. */
export function segmentSpans(a, b, rings) {
  const d = sub(b, a);
  const ts = [0, 1];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const e = sub(q, p);
      const den = d[0] * e[1] - d[1] * e[0];
      if (Math.abs(den) < 1e-12) continue;
      const w = sub(p, a);
      const t = (w[0] * e[1] - w[1] * e[0]) / den;
      const u = (w[0] * d[1] - w[1] * d[0]) / den;
      if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const m = (t0 + t1) / 2;
    if (!inside([a[0] + d[0] * m, a[1] + d[1] * m], rings)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1; else out.push([t0, t1]);
  }
  return out;
}

/** The ring clipped to the half plane depth >= 0 (depth = dot(p - a, n)). */
function clipFront(ring, a, n) {
  const out = [];
  const dep = (p) => dot(sub(p, a), n);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const dp = dep(p), dq = dep(q);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

/** Merges sorted-or-not intervals [a, b]. */
function mergeSpans(list) {
  const s = list.filter((x) => x[1] - x[0] > 1e-6).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const x of s) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); }
  return out;
}
/** Intervals of `a` not covered by the intervals of `b`. */
function minusSpans(a, b) {
  let out = a.map((x) => [x[0], x[1]]);
  for (const c of b) {
    const next = [];
    for (const x of out) {
      if (c[1] <= x[0] || c[0] >= x[1]) { next.push(x); continue; }
      if (c[0] > x[0]) next.push([x[0], c[0]]);
      if (c[1] < x[1]) next.push([c[1], x[1]]);
    }
    out = next;
  }
  return out.filter((x) => x[1] - x[0] > 0.05);
}

/* ---------- words ---------- */

/** 10.5 -> 10'-6". */
export function fmtFtIn(ft, signed = false) {
  const neg = ft < -1e-6;
  const t = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(t / 12), i = t - f * 12;
  const body = `${f.toLocaleString('en-US')}'-${i}"`;
  if (!signed) return (neg ? '-' : '') + body;
  return t === 0 ? `±${body}` : (neg ? '-' : '+') + body;
}
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** Bearing in degrees clockwise from north -> 'NNE'. */
const compass = (deg) => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/* ---------- the section model (pure) ---------- */

/** Program and zone colors of the massing (the Tower state colors first, then the viewer palette). */
function programColor(doc, program) {
  if (!program) return null;
  const sec = getSection(doc, 'massing');
  const st = sec && sec.state && sec.state.programs && sec.state.programs[program];
  if (st && typeof st.color === 'string') return st.color;
  return PROGRAM_COLORS[program] || colorOf(`program:${program}`);
}

/**
 * The section of a project along a cut. cut = { a: [x, y], b: [x, y], flip } (project frame).
 * groundAt(x, y) -> elevation or null. Returns null when the cut is too short.
 * Section coordinates: s (ft, left to right as seen looking along n) and z (project elevation).
 */
export function sectionModel(doc, cut, groundAt) {
  if (!doc || !cut || !Array.isArray(cut.a) || !Array.isArray(cut.b)) return null;
  const A = cut.a, B = cut.b;
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (!(L > 1)) return null;
  const d = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
  const n = cut.flip ? [d[1], -d[0]] : [-d[1], d[0]];           // the looking direction (left of a -> b, or right)
  const r = [n[1], -n[0]];                                       // section right: s grows this way
  const sA = dot(A, r), sB = dot(B, r), s0 = Math.min(sA, sB);
  const sOfT = (t) => sA - s0 + t * (sB - sA);
  const sOf = (p) => dot(p, r) - s0;
  const spansOf = (rings) => segmentSpans(A, B, rings).map(([t0, t1]) => { const x = sOfT(t0), y = sOfT(t1); return [Math.min(x, y), Math.max(x, y)]; });
  const beyondOf = (outer) => {
    const c = clipFront(outer, A, n);
    if (c.length < 3) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of c) { const s = sOf(p); lo = Math.min(lo, s); hi = Math.max(hi, s); }
    lo = Math.max(0, lo); hi = Math.min(L, hi);
    return hi - lo > 0.5 ? [lo, hi] : null;
  };

  let all = null;
  try { all = layersFrom(doc); } catch (e) { all = null; }
  const floors = [], neighbors = [];

  // massing levels, one floor per level (several plate pieces allowed). Read from massing.derived.levels: layersFrom
  // leaves out the levels the Plate Planner covers, and the section needs every floor.
  const msec = getSection(doc, 'massing');
  const mlv = msec && msec.derived && Array.isArray(msec.derived.levels) ? msec.derived.levels : [];
  const mpl = msec && msec.placement && typeof msec.placement === 'object' ? msec.placement : { x: 0, y: 0, rotation: 0, baseZ: 0 };
  const baseZ = fin(mpl.baseZ) ? mpl.baseZ : 0;
  const ring = (rg) => { const c = cleanRing(rg); return c ? transformRing(mpl, c, 'toProject') : null; };
  mlv.forEach((l, i) => {
    if (!l || typeof l !== 'object') return;
    const index = fin(l.index) ? l.index : i + 1;
    const ftf = fin(l.ftf) && l.ftf > 0 ? l.ftf : 10;
    const z0 = baseZ + (fin(l.z) ? l.z : (index - 1) * ftf);
    const pieces = [];
    for (const p of Array.isArray(l.plates) ? l.plates : []) {
      const outer = p && ring(p.outer);
      if (!outer) continue;
      pieces.push([outer, ...(Array.isArray(p.holes) ? p.holes.map(ring).filter(Boolean) : [])]);
    }
    if (!pieces.length) return;                                   // a void floor
    floors.push({ src: 'massing', level: index, name: typeof l.name === 'string' && l.name ? l.name : `Floor ${index}`, z0, z1: z0 + ftf,
      program: typeof l.program === 'string' && l.program ? l.program : null, zone: typeof l.zone === 'string' ? l.zone : null, pieces });
  });
  // parking deck slabs: a floor from the slab top to the next level
  const pIndex = new Map();
  try { for (const v of levelsIndex(doc)) if (v.sources.includes('parking')) pIndex.set(Math.round(v.z * 10), v.ftf); } catch (e) { /* no index */ }
  const pBy = new Map();
  for (const it of (all && all.parking && all.parking.items) || []) {
    if (it.kind !== 'slab' || !it.outer || !fin(it.z1)) continue;
    let f = pBy.get(it.level);
    if (!f) {
      const ftf = pIndex.get(Math.round(it.z1 * 10));
      f = { src: 'parking', level: it.level, name: `Parking level ${it.level}`, z0: it.z1, z1: it.z1 + (fin(ftf) && ftf > 0 ? ftf : 10.5), program: 'parking', zone: 'deck', pieces: [] };
      pBy.set(it.level, f); floors.push(f);
    }
    f.pieces.push([it.outer, ...(it.holes || [])]);
  }
  for (const f of floors) {
    f.cut = mergeSpans(f.pieces.flatMap((rings) => spansOf(rings)));
    f.beyond = mergeSpans(f.pieces.map((rings) => beyondOf(rings[0])).filter(Boolean));
    f.color = programColor(doc, f.program);
    f.zoneColor = ZONE_COLORS[f.zone] || null;
    delete f.pieces;
  }
  for (const it of (all && all.site && all.site.items) || []) {
    if (it.kind !== 'neighbor' || !it.outer || !fin(it.z0) || !fin(it.z1)) continue;
    const rings = [it.outer, ...(it.holes || [])];
    const cutS = mergeSpans(spansOf(rings));
    const bey = beyondOf(it.outer);
    if (!cutS.length && !bey) continue;
    neighbors.push({ name: (it.data && it.data.title) || 'Neighbor', z0: it.z0, z1: it.z1, cut: cutS, beyond: bey ? [bey] : [] });
  }

  // the ground along the cut
  const N = clamp(Math.ceil(L / 2), 60, 400);
  const ground = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    let z = null;
    try { z = groundAt ? groundAt(p[0], p[1]) : null; } catch (e) { z = null; }
    ground.push({ s: sOfT(t), z: fin(z) ? z : null });
  }
  ground.sort((x, y) => x.s - y.s);

  // datum: Floor 1 of the massing, else the lowest floor, else the lowest ground
  const gz = ground.filter((g) => g.z !== null).map((g) => g.z);
  const shown = floors.filter((f) => f.cut.length || f.beyond.length);
  let datum = msec && mlv.length ? baseZ : null;
  if (!fin(datum)) datum = shown.length ? Math.min(...shown.map((f) => f.z0)) : gz.length ? Math.min(...gz) : 0;

  const bearing = (Math.atan2(n[0], n[1]) * 180) / Math.PI;
  return { L, a: A, b: B, d, n, r, bearing, look: compass(bearing), floors, neighbors, ground, datum, flip: !!cut.flip };
}

/* ---------- the drawing (pure: a string of SVG) ---------- */

const FONT = "-apple-system, 'SF Pro Text', Inter, system-ui, 'Segoe UI', Roboto, sans-serif";

/** Mix two hex colors: t = 0 gives a, 1 gives b. */
function mix(a, b, t) {
  const p = (h) => { const x = h.replace('#', ''); const v = x.length === 3 ? x.split('').map((c) => c + c).join('') : x; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
  try {
    const A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  } catch (e) { return a; }
}

/** Nice scale bar length (ft) for k px per ft: 50 to 150 px long. */
function niceBar(k) {
  const opts = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  let best = opts[0];
  for (const v of opts) if (v * k <= 150) best = v;
  return best;
}

/**
 * The SVG of a section model. opts: { width, height, style: 'model'|'diagram', colorBy: 'program'|'zone', colors,
 * pixelW, pixelH (the export size; default width and height) }.
 */
export function sectionSvg(m, { width, height, style = 'model', colorBy = 'program', colors = {}, pixelW, pixelH } = {}) {
  const W = Math.max(200, Math.round(width || 800)), H = Math.max(120, Math.round(height || 300));
  const C = {
    bg: '#14181c', ink: '#e7eaee', ink2: '#a5adb7', ink3: '#747d88', line: '#2b3138', line2: '#3a424a',
    earth: '#1d2329', hatch: '#2c343c', ground: '#eef0f2', beyond: '#58626d', neighbor: '#4d5660', neighborEdge: '#8e98a3',
    slab: '#f4f5f7', accent: '#d9774a', model: '#c9ccd0', ...colors,
  };
  const out = [];
  const push = (s) => out.push(s);
  const halo = `paint-order="stroke" stroke="${C.bg}" stroke-width="3" stroke-linejoin="round"`;
  const text = (x, y, s, { size = 10.5, weight = 400, fill = C.ink2, anchor = 'start' } = {}) =>
    push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${halo}>${esc(s)}</text>`);
  push(`<svg xmlns="http://www.w3.org/2000/svg" width="${pixelW || W}" height="${pixelH || H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  push(`<defs><pattern id="secEarth" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${C.earth}"/><line x1="0" y1="0" x2="0" y2="7" stroke="${C.hatch}" stroke-width="1.4"/></pattern></defs>`);
  push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

  if (!m) { push('</svg>'); return out.join(''); }

  /* ---- extents and scale ---- */
  const PAD_L = 40, PAD_R = 236, PAD_T = 22, PAD_B = 64;   // the dimension string and the level labels sit at the right
  const cutFloors = m.floors.filter((f) => f.cut.length);
  // No buildings in the background (Cade, October 28, 2026): only what the cut crosses is drawn.
  const shownFloors = cutFloors;
  const gz = m.ground.filter((g) => g.z !== null).map((g) => g.z);
  const zs = [...gz, ...shownFloors.flatMap((f) => [f.z0, f.z1]), ...m.neighbors.filter((b) => b.cut.length).flatMap((b) => [b.z0, b.z1])];
  let zLo = zs.length ? Math.min(...zs) : m.datum, zHi = zs.length ? Math.max(...zs) : m.datum + 10;
  const tall = Math.max(10, zHi - zLo);
  zLo -= Math.max(8, tall * 0.08); zHi += Math.max(4, tall * 0.04);
  const areaW = Math.max(40, W - PAD_L - PAD_R), areaH = Math.max(40, H - PAD_T - PAD_B);
  const k = Math.min(areaW / m.L, areaH / (zHi - zLo));
  const x0 = PAD_L + (areaW - m.L * k) / 2;
  const y0 = PAD_T + (areaH - (zHi - zLo) * k) / 2;
  const X = (s) => x0 + s * k;
  const Y = (z) => y0 + (zHi - z) * k;
  const yBottom = Y(zLo);
  const f1 = (v) => v.toFixed(1);
  const rect = (s0, s1, z0, z1, attrs) => push(`<rect x="${f1(X(s0))}" y="${f1(Y(z1))}" width="${f1(Math.max(0.5, (s1 - s0) * k))}" height="${f1(Math.max(0.5, (z1 - z0) * k))}" ${attrs}/>`);
  const hline = (s0, s1, z, attrs) => push(`<line x1="${f1(X(s0))}" y1="${f1(Y(z))}" x2="${f1(X(s1))}" y2="${f1(Y(z))}" ${attrs}/>`);
  const vline = (s, z0, z1, attrs) => push(`<line x1="${f1(X(s))}" y1="${f1(Y(z0))}" x2="${f1(X(s))}" y2="${f1(Y(z1))}" ${attrs}/>`);

  /* ---- ground: earth below the line ---- */
  const runs = [];
  let run = [];
  for (const g of m.ground) { if (g.z === null) { if (run.length > 1) runs.push(run); run = []; } else run.push(g); }
  if (run.length > 1) runs.push(run);
  for (const rr of runs) {
    const pts = rr.map((g) => `${f1(X(g.s))},${f1(Y(g.z))}`).join(' ');
    push(`<polygon points="${f1(X(rr[0].s))},${f1(yBottom)} ${pts} ${f1(X(rr[rr.length - 1].s))},${f1(yBottom)}" fill="url(#secEarth)"/>`);
  }

  /* ---- beyond: not drawn (Cade, October 28, 2026: no buildings in the background). m.floors[].beyond and
     m.neighbors[].beyond stay in the model for later. ---- */

  /* ---- neighbors in the cut: gray solids ---- */
  for (const b of m.neighbors) for (const [s0, s1] of b.cut) rect(s0, s1, b.z0, b.z1, `fill="${C.neighbor}" stroke="${C.neighborEdge}" stroke-width="1.2"`);

  /* ---- the ground line: thick (Cade) ---- */
  for (const rr of runs) push(`<polyline points="${rr.map((g) => `${f1(X(g.s))},${f1(Y(g.z))}`).join(' ')}" fill="none" stroke="${C.ground}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`);

  /* ---- floors in the cut: tint by program, slabs, walls ---- */
  const fillOf = (f) => {
    const c = (colorBy === 'zone' ? f.zoneColor : f.color) || f.color || f.zoneColor;
    if (style === 'diagram') return c || C.model;
    return mix(C.bg, c || C.model, c ? 0.3 : 0.14);
  };
  for (const f of cutFloors) for (const [s0, s1] of f.cut) rect(s0, s1, f.z0, f.z1, `fill="${fillOf(f)}"`);
  const slabAttr = `stroke="${C.slab}" stroke-width="2.6" stroke-linecap="square"`;
  const wallAttr = `stroke="${C.slab}" stroke-width="1.6"`;
  for (const f of cutFloors) {
    for (const [s0, s1] of f.cut) { hline(s0, s1, f.z0, slabAttr); vline(s0, f.z0, f.z1, wallAttr); vline(s1, f.z0, f.z1, wallAttr); }
    // the roof: the top of a floor where no floor sits on it
    const above = mergeSpans(cutFloors.filter((g) => g !== f && Math.abs(g.z0 - f.z1) < 0.6).flatMap((g) => g.cut));
    for (const [s0, s1] of minusSpans(f.cut, above)) hline(s0, s1, f.z1, slabAttr);
  }

  /* ---- levels: at the right of the building, the floor-to-floor dimension string, then the level labels (Cade, October 28, 2026) ---- */
  const stack = cutFloors.some((f) => f.src === 'massing') ? cutFloors.filter((f) => f.src === 'massing') : cutFloors;
  const levels = [];
  for (const f of stack.slice().sort((a, b) => a.z0 - b.z0)) {
    const last = levels[levels.length - 1];
    // floors of several towers at one level: one label, and the level spans every tower (the dimension string goes right of all)
    if (last && Math.abs(last.z - f.z0) < 0.1) { last.sMin = Math.min(last.sMin, ...f.cut.map((c) => c[0])); last.sMax = Math.max(last.sMax, ...f.cut.map((c) => c[1])); continue; }
    levels.push({ z: f.z0, name: f.name, ftf: f.z1 - f.z0, key: `${f.zone}|${f.program}`, sMin: Math.min(...f.cut.map((c) => c[0])), sMax: Math.max(...f.cut.map((c) => c[1])) });
  }
  if (levels.length) {
    const top = stack.reduce((acc, f) => (f.z1 > acc.z1 ? f : acc), stack[0]);
    const sMin = Math.min(...levels.map((l) => l.sMin)), sMax = Math.max(...levels.map((l) => l.sMax));
    const roof = { z: top.z1, name: 'Roof', roof: true, sMin, sMax };

    // labels: Roof, the first floor, and changes of program first; then the rest where there is room
    const all = [...levels, roof];
    const pri = (l, i) => (l.roof ? 0 : i === 0 ? 1 : i > 0 && levels[i - 1] && levels[i - 1].key !== l.key ? 2 : 3);
    const order = all.map((l, i) => ({ l, p: pri(l, i), i })).sort((a, b) => a.p - b.p || b.i - a.i);
    const GAP = 13;
    const picked = [];
    for (const o of order) if (picked.every((q) => Math.abs(Y(q.z) - Y(o.l.z)) >= GAP)) picked.push(o.l);
    // columns at the right of the drawing: the dimension string first (xd), then the labels (xt), with dotted leaders
    // next to the building (past any cut neighbor that touches its right side), not at the far end of the cut
    const nbR = m.neighbors.flatMap((b) => b.cut.map((c) => c[1])).filter((v) => v > sMax && v < sMax + 40);
    const xr = X(Math.max(sMax, ...nbR));
    const xd = xr + 18;
    const xl = xd + 70, xt = xl + 16;
    for (const l of picked.sort((a, b) => a.z - b.z)) {
      const y = Y(l.z);
      push(`<line x1="${f1(xl - 8)}" y1="${f1(y)}" x2="${f1(xt - 4)}" y2="${f1(y)}" stroke="${C.ink3}" stroke-width="0.7" stroke-dasharray="1.5 2.5" opacity="0.8"/>`);
      push(`<path d="M${f1(xl + 5)} ${f1(y)} l-4 -4 h8 z" fill="${C.ink2}"/>`);
      // a clear box behind the label, so the ground line never runs through Floor 1
      const elev = fmtFtIn(l.z - m.datum, true);
      push(`<rect x="${f1(xt - 3)}" y="${f1(y - 14)}" width="${f1(l.name.length * 6.1 + 10 + elev.length * 6 + 4)}" height="15" fill="${C.bg}"/>`);
      text(xt, y - 3, l.name, { size: 10.5, weight: 600, fill: C.ink });
      text(xt + l.name.length * 6.1 + 6, y - 3, fmtFtIn(l.z - m.datum, true), { size: 10.5, fill: C.ink2 });
    }

    // dimensions: one string with a tick at every floor; runs of equal heights share one text when floors are small
    // the column between the building and the labels, with light extension lines from the building
    const zsAll = [...levels.map((l) => l.z), roof.z];
    push(`<line x1="${f1(xd)}" y1="${f1(Y(zsAll[0]))}" x2="${f1(xd)}" y2="${f1(Y(zsAll[zsAll.length - 1]))}" stroke="${C.ink3}" stroke-width="0.9"/>`);
    for (const z of zsAll) {
      const y = Y(z);
      push(`<line x1="${f1(xd - 4)}" y1="${f1(y + 4)}" x2="${f1(xd + 4)}" y2="${f1(y - 4)}" stroke="${C.ink2}" stroke-width="1.2"/>`);
      push(`<line x1="${f1(X(sMax) + 3)}" y1="${f1(y)}" x2="${f1(xd - 2)}" y2="${f1(y)}" stroke="${C.ink3}" stroke-width="0.6" stroke-dasharray="1.5 2.5" opacity="0.7"/>`);
    }
    const hs = zsAll.slice(1).map((z, i) => ({ z0: zsAll[i], z1: z, h: z - zsAll[i] }));
    let i = 0;
    while (i < hs.length) {
      let j = i;
      while (j + 1 < hs.length && Math.abs(hs[j + 1].h - hs[i].h) < 0.01) j++;
      const n = j - i + 1, each = hs[i].h * k;
      if (n === 1 || (n < 4 && each >= 13)) {
        for (let q = i; q <= j; q++) if (hs[q].h * k >= 11) text(xd + 7, (Y(hs[q].z0) + Y(hs[q].z1)) / 2 + 3.6, fmtFtIn(hs[q].h), { size: 10 });
      } else if (n * each >= 11) {
        text(xd + 7, (Y(hs[i].z0) + Y(hs[j].z1)) / 2 + 3.6, `${n} × ${fmtFtIn(hs[i].h)}`, { size: 10 });
      }
      i = j + 1;
    }
  } else if (!shownFloors.length && !m.neighbors.some((b) => b.cut.length)) {
    text(W / 2, PAD_T + areaH / 2, 'The cut crosses no building. Redraw it across the tower.', { size: 12, fill: C.ink3, anchor: 'middle' });
  }

  /* ---- cut ends: A at both sides ---- */
  const ya = Math.min(yBottom - 4, H - PAD_B + 2);
  for (const s of [0, m.L]) {
    push(`<circle cx="${f1(X(s))}" cy="${f1(ya)}" r="7.5" fill="${C.bg}" stroke="${C.accent}" stroke-width="1.4"/>`);
    text(X(s), ya + 3.6, 'A', { size: 9.5, weight: 700, fill: C.accent, anchor: 'middle' });
  }

  /* ---- title block: title, looking direction, scale bar, legend, north ---- */
  const yt = H - 30;
  push(`<line x1="0" y1="${f1(H - PAD_B + 14)}" x2="${W}" y2="${f1(H - PAD_B + 14)}" stroke="${C.line}" stroke-width="1"/>`);
  push(`<circle cx="26" cy="${f1(yt + 6)}" r="12" fill="none" stroke="${C.ink}" stroke-width="1.3"/>`);
  push(`<line x1="14" y1="${f1(yt + 6)}" x2="38" y2="${f1(yt + 6)}" stroke="${C.ink}" stroke-width="1"/>`);
  text(26, yt + 2.5, 'A', { size: 9, weight: 700, fill: C.ink, anchor: 'middle' });
  text(26, yt + 15.5, 'A', { size: 9, weight: 700, fill: C.ink, anchor: 'middle' });
  text(46, yt + 5, 'Section A–A', { size: 13, weight: 700, fill: C.ink });
  text(46, yt + 19, `Looking ${m.look}. Elevations from Floor 1 at ${r1(m.datum).toLocaleString('en-US')} ft.`, { size: 10, fill: C.ink3 });

  // scale bar: two halves, black and white
  const bar = niceBar(k), bw = bar * k;
  const bx = Math.max(300, W * 0.42 - bw / 2), by = yt + 2;
  if (bx + bw + 40 < W - 220 || W > 700) {
    push(`<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw / 2)}" height="5" fill="${C.ink}" stroke="${C.ink}" stroke-width="0.8"/>`);
    push(`<rect x="${f1(bx + bw / 2)}" y="${f1(by)}" width="${f1(bw / 2)}" height="5" fill="${C.bg}" stroke="${C.ink}" stroke-width="0.8"/>`);
    text(bx, by + 17, '0', { size: 9.5, fill: C.ink2, anchor: 'middle' });
    text(bx + bw / 2, by + 17, String(bar / 2), { size: 9.5, fill: C.ink2, anchor: 'middle' });
    text(bx + bw, by + 17, `${bar} ft`, { size: 9.5, fill: C.ink2, anchor: 'middle' });
  }

  // legend: the programs (or zones) in the cut
  const seen = new Map();
  for (const f of cutFloors) {
    const label = colorBy === 'zone' && f.zone ? f.zone : f.program;
    if (label && !seen.has(label)) seen.set(label, fillOf(f));
  }
  let lx = bx + bw + 34;
  for (const [label, col] of seen) {
    const word = label[0].toUpperCase() + label.slice(1);
    const wpx = 16 + word.length * 5.8 + 12;
    if (lx + wpx > W - 70) break;
    push(`<rect x="${f1(lx)}" y="${f1(yt - 1)}" width="10" height="10" rx="2" fill="${col}" stroke="${C.line2}" stroke-width="0.8"/>`);
    text(lx + 15, yt + 8, word, { size: 10, fill: C.ink2 });
    lx += wpx;
  }

  // north: the key shows north as seen in this section (looking direction = up the key)
  const nx = W - 34, ny = H - 31, nr = 11;
  const north = [dot([0, 1], m.r), dot([0, 1], m.n)];        // section right, looking direction
  const ang = Math.atan2(north[0], north[1]);
  const tip = [nx + Math.sin(ang) * nr, ny - Math.cos(ang) * nr];
  const tail = [nx - Math.sin(ang) * nr * 0.7, ny + Math.cos(ang) * nr * 0.7];
  const side = (sgn) => [nx + Math.cos(ang) * 5 * sgn, ny + Math.sin(ang) * 5 * sgn];
  push(`<circle cx="${nx}" cy="${f1(ny)}" r="${nr}" fill="none" stroke="${C.ink3}" stroke-width="1"/>`);
  push(`<path d="M${f1(tip[0])} ${f1(tip[1])} L${f1(side(1)[0])} ${f1(side(1)[1])} L${f1(tail[0])} ${f1(tail[1])} L${f1(side(-1)[0])} ${f1(side(-1)[1])} Z" fill="${C.ink}" stroke="${C.ink}" stroke-width="0.6" stroke-linejoin="round"/>`);
  text(nx + Math.sin(ang) * (nr + 8), ny - Math.cos(ang) * (nr + 8) + 3.5, 'N', { size: 10, weight: 700, fill: C.ink, anchor: 'middle' });

  push('</svg>');
  return out.join('');
}

/* ---------- the tool ---------- */

export function createSection(ctx, { stage, pane, setView, onLayout } = {}) {
  const { h, Toast } = ctx.ui;
  const { scene, input, ground, bus, keys, project } = ctx;
  const viewEl = stage ? stage.querySelector('#view') : null;
  const handlesEl = stage ? stage.querySelector('#handles') : null;

  let cut = null;          // { a, b, flip } project frame
  let open = false;        // pane shown (with a cut)
  let split = 0.42;        // pane share of the stage height
  let mode = null;         // 'draw' while drawing
  let draft = null;        // { a, b, sx, sy, pending, second }
  let docId = null;

  /* ---- storage per project ---- */
  const keyOf = (id) => KEY_PREFIX + id;
  function load() {
    const doc = project.doc();
    docId = doc ? doc.id : null;
    cut = null; open = false; split = 0.42;
    if (!docId) return;
    try {
      const v = JSON.parse(localStorage.getItem(keyOf(docId)) || 'null');
      if (v && Array.isArray(v.a) && Array.isArray(v.b) && v.a.every(fin) && v.b.every(fin)) cut = { a: v.a.slice(0, 2), b: v.b.slice(0, 2), flip: !!v.flip };
      if (v && fin(v.split)) split = clamp(v.split, 0.15, 0.85);
      open = !!(cut && v && v.open);
    } catch (e) { /* blocked storage: no cut */ }
  }
  function save() {
    if (!docId) return;
    try { localStorage.setItem(keyOf(docId), JSON.stringify({ a: cut ? cut.a : null, b: cut ? cut.b : null, flip: cut ? cut.flip : false, open, split })); } catch (e) { /* keep it for this visit */ }
  }

  /* ---- top bar button ---- */
  const button = h('button', { class: 'seg-btn sec-btn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Section', 'data-tip': 'Draw a section cut in Plan view.', onclick: () => press() },
    h('span', { class: 'ico-wrap', html: '<svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18"/><path d="M5 12V7.5L3 9.5M5 7.5l2 2"/><path d="M19 12V7.5l-2 2M19 7.5l2 2"/><path d="M8 16h8" stroke-dasharray="2 2"/></svg>' }),
    h('span', { class: 'sec-btn-text' }, 'Section'));

  /* ---- pane ---- */
  const divider = h('div', { class: 'sec-divider', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the section', tabindex: '0', 'data-tip': 'Drag to resize the section.' });
  const btn = (label, tip, fn, extra = {}) => h('button', { class: 'btn sm', type: 'button', 'data-tip': tip, onclick: fn, ...extra }, label);
  const flipBtn = btn('Flip', 'Look the other way.', () => flip(), { 'data-tip-key': 'F' });
  const redrawBtn = btn('Redraw', 'Draw a new cut in Plan view.', () => startDraw());
  const clearBtn = btn('Clear cut', 'Remove the cut and close the section.', () => clear());
  const closeBtn = h('button', { class: 'btn icon sm', type: 'button', 'aria-label': 'Close the section', 'data-tip': 'Hide the section. Select Section again to show it.', onclick: () => setOpen(false) });
  closeBtn.innerHTML = ctx.ui.ICONS.close;
  const body = h('div', { class: 'sec-body' });
  if (pane) {
    pane.replaceChildren(divider, h('div', { class: 'sec-head' }, h('span', { class: 'sec-label' }, 'Section'), h('span', { class: 'sec-sp' }), flipBtn, redrawBtn, clearBtn, closeBtn), body);
    pane.hidden = true;
  }

  /* ---- layout: the 3D view above, the pane below ---- */
  let layoutRaf = 0;
  function paneHeight() {
    const H = stage ? stage.clientHeight : 0;
    if (H < MIN_PANE + MIN_VIEW) return Math.round(H * 0.45);
    return Math.round(clamp(split * H, MIN_PANE, H - MIN_VIEW));
  }
  function applyLayout() {
    const on = !!(open && cut && pane);
    const ph = on ? paneHeight() : 0;
    if (pane) { pane.hidden = !on; pane.style.height = on ? `${ph}px` : ''; }
    if (viewEl) viewEl.style.bottom = on ? `${ph}px` : '';
    if (handlesEl) handlesEl.style.bottom = on ? `${ph}px` : '';
    if (stage) { stage.classList.toggle('has-section', on); stage.style.setProperty('--section-h', `${ph}px`); }
    button.setAttribute('aria-pressed', mode === 'draw' || on ? 'true' : 'false');
    button.classList.toggle('drawing', mode === 'draw');
    if (typeof onLayout === 'function') { try { onLayout(); } catch (e) { console.error(e); } }
    drawMarker();
    render();
  }
  const layoutSoon = () => { if (layoutRaf) return; layoutRaf = requestAnimationFrame(() => { layoutRaf = 0; applyLayout(); }); };

  // divider: mouse, pen and touch
  let drag = null;
  divider.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    drag = { id: ev.pointerId, y: ev.clientY, h: paneHeight() };
    try { divider.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ }
    divider.classList.add('active');
    document.documentElement.classList.add('sec-dragging');
  });
  divider.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const H = stage.clientHeight;
    split = clamp((drag.h + (drag.y - ev.clientY)) / Math.max(1, H), 0.12, 0.88);
    layoutSoon();
  });
  const endDrag = (ev) => {
    if (!drag || (ev && ev.pointerId !== drag.id)) return;
    drag = null;
    divider.classList.remove('active');
    document.documentElement.classList.remove('sec-dragging');
    const H = stage.clientHeight;
    split = clamp(paneHeight() / Math.max(1, H), 0.12, 0.88);
    save(); layoutSoon();
  };
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('keydown', (ev) => {
    const step = ev.key === 'ArrowUp' ? 0.04 : ev.key === 'ArrowDown' ? -0.04 : 0;
    if (!step) return;
    ev.preventDefault(); ev.stopPropagation();
    split = clamp(split + step, 0.12, 0.88); save(); layoutSoon();
  });
  window.addEventListener('resize', () => { if (open && cut) layoutSoon(); });

  /* ---- drawing on the ground ---- */
  /** The project plan point under a screen point: the ray meets the plane at the ground height there. */
  function planAt(cx, cy) {
    const sh = frame.getShift();
    let p = scene.groundPoint ? scene.groundPoint(cx, cy, 0) : null;
    if (!p) return null;
    for (let i = 0; i < 2; i++) {
      const z = ground ? ground.at(p[0] + sh.x, p[1] + sh.y) : null;
      if (!fin(z)) break;
      const q = scene.groundPoint(cx, cy, z - sh.z);
      if (!q) break;
      p = q;
    }
    return [p[0] + sh.x, p[1] + sh.y];
  }
  /** Shift snaps the cut to 15 degree steps. */
  function snapB(a, b, ev) {
    if (!ev || !ev.shiftKey) return b;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
    return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
  }
  const drawHandler = {
    pointerTypes: ['mouse', 'pen', 'touch'],     // drawing mode: a finger draws too (two fingers still zoom)
    test: () => mode === 'draw',
    down(ev) {
      const p = planAt(ev.clientX, ev.clientY);
      if (!p) return;
      if (draft && draft.pending) { draft.b = snapB(draft.a, p, ev); draft.pending = false; draft.second = true; }
      else draft = { a: p, b: p, sx: ev.clientX, sy: ev.clientY, pending: false, second: false };
      drawMarker();
    },
    move(ev) {
      if (!draft) return;
      const p = planAt(ev.clientX, ev.clientY);
      if (p) { draft.b = snapB(draft.a, p, ev); drawMarker(); }
    },
    up(ev) {
      if (!draft) return;
      const p = ev ? planAt(ev.clientX, ev.clientY) : null;
      if (p) draft.b = snapB(draft.a, p, ev);
      const moved = ev && Math.hypot(ev.clientX - draft.sx, ev.clientY - draft.sy) > 6;
      const len = Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]);
      if (!draft.second && (!moved || len < 2)) { draft.pending = true; draft.b = draft.a.slice(); drawMarker(); return; }   // click, click
      if (len < 2) { draft.pending = true; return; }
      finishDraw();
    },
    cancel() {
      if (!draft) return;
      if (draft.second) { draft.second = false; draft.pending = true; draft.b = draft.a.slice(); }
      else draft = null;
      drawMarker();
    },
  };
  // Above the building move handle (GIZMO): in draw mode a press on the building draws the cut, it does not move the building.
  input.claim(drawHandler, PRIORITY.GIZMO + 5);

  // mouse hover between the two clicks
  const canvas = scene.canvas ? scene.canvas() : null;
  if (canvas) canvas.addEventListener('pointermove', (ev) => {
    if (mode !== 'draw' || !draft || !draft.pending) return;
    const p = planAt(ev.clientX, ev.clientY);
    if (p) { draft.b = snapB(draft.a, p, ev); drawMarker(); }
  });

  let drawToast = null;
  function startDraw() {
    if (!project.doc()) { Toast.show('Open a project first.'); return; }
    mode = 'draw'; draft = null;
    if (typeof setView === 'function') setView('plan'); else scene.setView('plan');
    if (canvas) canvas.style.cursor = 'crosshair';
    if (drawToast) drawToast.remove();
    drawToast = Toast.show(input.isCoarse() ? 'Drag across the plan to draw the cut, or tap two points. Esc cancels.' : 'Drag across the plan to draw the cut, or click two points. Shift snaps to 15°. Esc cancels.');
    applyLayout();
  }
  function stopDraw() {
    mode = null; draft = null;
    if (drawToast) { drawToast.remove(); drawToast = null; }
    if (canvas) canvas.style.cursor = '';
    applyLayout();
  }
  function finishDraw() {
    cut = { a: draft.a.map(r1), b: draft.b.map(r1), flip: false };   // a new cut looks left of the drawn direction
    open = true;
    save();
    stopDraw();
  }

  /* ---- actions ---- */
  function press() {
    if (mode === 'draw') { stopDraw(); return; }
    if (cut) { setOpen(!open); return; }
    startDraw();
  }
  function setOpen(on) { open = !!(on && cut); save(); applyLayout(); }
  function flip() { if (!cut) return false; cut = { ...cut, flip: !cut.flip }; save(); drawMarker(); render(); return true; }
  function clear() { cut = null; open = false; save(); stopDraw(); }
  function setCut(next) {
    if (!next) { clear(); return; }
    cut = { a: next.a.slice(0, 2), b: next.b.slice(0, 2), flip: !!next.flip };
    open = next.open !== false;
    save(); applyLayout();
  }

  keys.bind('shell', 'f', () => (open && cut ? flip() : false));
  // Escape ends drawing: main.js calls stopDraw() from its Escape key.

  /* ---- 3D marker: the cut line and the looking arrows (in the scene, so a saved image shows it) ---- */
  const marker = new THREE.Group();
  marker.name = 'section-cut';
  marker.renderOrder = 20;
  scene.scene.add(marker);
  const tagA = h('span', { class: 'sec-tag' }, 'A'), tagB = h('span', { class: 'sec-tag' }, 'A');
  const flipTag = h('button', { class: 'sec-flip', type: 'button', 'aria-label': 'Flip the section', 'data-tip': 'Look the other way.', 'data-tip-key': 'F', onclick: () => flip() }, '⇄');
  [tagA, tagB, flipTag].forEach((el) => { el.hidden = true; if (handlesEl) handlesEl.append(el); });
  let tagPts = null;      // { a, b, mid } scene vectors
  let hiddenForCapture = false;

  const cutColor = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--scene-cut').trim() || '#d9774a'; } catch (e) { return '#d9774a'; } };
  function clearMarker() {
    marker.children.slice().forEach((c) => { marker.remove(c); if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
  function drawMarker() {
    clearMarker();
    tagPts = null;
    const c = mode === 'draw' && draft ? { a: draft.a, b: draft.b, flip: false, draft: true } : open && cut ? cut : null;
    const L = c ? Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]) : 0;
    if (!c || hiddenForCapture) { syncTags(); scene.requestRender(); return; }
    const sh = frame.getShift();
    const zAt = (x, y) => { const z = ground ? ground.at(x, y) : null; return (fin(z) ? z : sh.z) - sh.z + 0.6; };
    const W = (x, y) => frame.worldVec(x - sh.x, y - sh.y, zAt(x, y));
    const col = new THREE.Color(cutColor());
    const mat = () => new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: c.draft ? 0.8 : 1 });
    if (L < 0.5) {
      const dotGeo = new THREE.CircleGeometry(3, 20);
      const m = new THREE.Mesh(dotGeo, mat());
      m.rotation.x = -Math.PI / 2; m.position.copy(W(c.a[0], c.a[1])); m.renderOrder = 20;
      marker.add(m);
      scene.requestRender(); syncTags(); return;
    }
    const d = [(c.b[0] - c.a[0]) / L, (c.b[1] - c.a[1]) / L];
    const n = c.flip ? [d[1], -d[0]] : [-d[1], d[0]];
    const w = clamp(L * 0.004, 1.2, 4), size = clamp(L * 0.05, 10, 34);
    // the line: a ribbon that follows the ground
    const N = 48, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = c.a[0] + (c.b[0] - c.a[0]) * t, y = c.a[1] + (c.b[1] - c.a[1]) * t;
      const p = W(x + n[0] * w / 2, y + n[1] * w / 2), q = W(x - n[0] * w / 2, y - n[1] * w / 2);
      pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const line = new THREE.Mesh(g, mat()); line.renderOrder = 20; line.raycast = () => {};
    marker.add(line);
    // the looking arrows at both ends
    const tri = [];
    for (const e of [c.a, c.b]) {
      const tip = [e[0] + n[0] * size, e[1] + n[1] * size];
      const l = [e[0] + d[0] * size * 0.45, e[1] + d[1] * size * 0.45], r = [e[0] - d[0] * size * 0.45, e[1] - d[1] * size * 0.45];
      const z = zAt(e[0], e[1]);
      for (const p of [tip, l, r]) { const v = frame.worldVec(p[0] - sh.x, p[1] - sh.y, z); tri.push(v.x, v.y, v.z); }
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const arrows = new THREE.Mesh(tg, mat()); arrows.renderOrder = 20; arrows.raycast = () => {};
    marker.add(arrows);
    if (!c.draft) {
      const at = (e, k) => { const p = [e[0] + n[0] * size * k, e[1] + n[1] * size * k]; return frame.worldVec(p[0] - sh.x, p[1] - sh.y, zAt(e[0], e[1])); };
      const mid = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
      tagPts = { a: at(c.a, 1.7), b: at(c.b, 1.7), mid: at(mid, -1.1) };
    }
    syncTags();
    scene.requestRender();
  }
  function syncTags() {
    const show = !!tagPts && !!handlesEl;
    [tagA, tagB, flipTag].forEach((el) => { el.hidden = !show; });
    if (!show) return;
    const hr = handlesEl.getBoundingClientRect();
    const place = (el, v) => {
      const p = scene.toScreen(v);
      const x = p.x - hr.left, y = p.y - hr.top;
      const inView = p.visible && x > -20 && y > -20 && x < hr.width + 20 && y < hr.height + 20;
      el.hidden = !inView;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    };
    place(tagA, tagPts.a); place(tagB, tagPts.b); place(flipTag, tagPts.mid);
  }
  scene.onFrame(() => { if (tagPts) syncTags(); });

  /* ---- the drawing ---- */
  let renderRaf = 0;
  const tokens = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
    return { ink: v('--ink', '#e7eaee'), ink2: v('--ink-2', '#a5adb7'), ink3: v('--ink-3', '#747d88'), line: v('--line', '#2b3138'), line2: v('--line-2', '#3a424a'), accent: v('--scene-cut', '#d9774a'), neighbor: v('--scene-context', '#6f7882') };
  };
  function model() {
    const doc = project.doc();
    if (!doc || !cut) return null;
    try { return sectionModel(doc, cut, (x, y) => (ground ? ground.at(x, y) : null)); } catch (e) { console.error(e); return null; }
  }
  function svgFor(width, height, extra = {}) {
    const v = ctx.view && ctx.view.get ? ctx.view.get() : { colorBy: 'program' };
    return sectionSvg(model(), { width, height, style: scene.style(), colorBy: v.colorBy, colors: tokens(), ...extra });
  }
  function render() {
    if (!open || !cut || !pane || pane.hidden) return;
    const w = body.clientWidth, hgt = body.clientHeight;
    if (w < 10 || hgt < 10) return;
    body.innerHTML = svgFor(w, hgt);
  }
  const renderSoon = () => { if (!open || !cut || renderRaf) return; renderRaf = requestAnimationFrame(() => { renderRaf = 0; render(); }); };
  try { if (typeof ResizeObserver === 'function') new ResizeObserver(() => renderSoon()).observe(body); } catch (e) { /* no observer */ }

  ['project:change', 'style:change', 'view:change', 'ground:change', 'layers:change'].forEach((evt) => bus.on(evt, () => renderSoon()));
  bus.on('frame:shift', () => drawMarker());
  bus.on('ground:change', () => drawMarker());
  bus.on('project:open', () => { mode = null; draft = null; if (canvas) canvas.style.cursor = ''; load(); applyLayout(); });

  /* ---- Save image: the 3D view with the section below it ---- */
  const loadImg = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = url; });
  async function compose(blob) {
    if (!open || !cut || !pane || pane.hidden || !blob) return blob;
    const w = body.clientWidth, hgt = body.clientHeight;
    if (w < 10 || hgt < 10) return blob;
    const u3 = URL.createObjectURL(blob);
    try {
      const im3 = await loadImg(u3);
      const sc = im3.width / w;
      const ph = Math.round(hgt * sc);
      const svg = svgFor(w, hgt, { pixelW: im3.width, pixelH: ph });
      const imS = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
      const cv = document.createElement('canvas');
      cv.width = im3.width; cv.height = im3.height + ph;
      const g = cv.getContext('2d');
      g.drawImage(im3, 0, 0);
      g.drawImage(imS, 0, im3.height, im3.width, ph);
      g.fillStyle = tokens().line2; g.fillRect(0, im3.height, im3.width, Math.max(1, Math.round(sc)));
      return await new Promise((res) => cv.toBlob((b) => res(b || blob), 'image/png'));
    } catch (e) { console.error(e); return blob; }
    finally { URL.revokeObjectURL(u3); }
  }

  /* ---- start ---- */
  load();
  applyLayout();

  return {
    button,
    /** Draw mode on (Plan view). */
    startDraw, stopDraw,
    /** The Section button: draw when there is no cut, else show or hide the pane. */
    press,
    /** { a, b, flip } in the project frame, or null. */
    cut: () => (cut ? { a: cut.a.slice(), b: cut.b.slice(), flip: cut.flip } : null),
    setCut, flip, clear,
    isOpen: () => !!(open && cut),
    setOpen,
    drawing: () => mode === 'draw',
    split: () => split,
    setSplit: (v) => { if (fin(v)) { split = clamp(v, 0.12, 0.88); save(); applyLayout(); } },
    model,
    svg: () => (open && cut ? svgFor(body.clientWidth, body.clientHeight) : ''),
    compose,
    /** Hides the 3D marker (AI-ready image hook). */
    setCaptureHidden: (on) => { hiddenForCapture = !!on; drawMarker(); },
    render,
  };
}
