/* ==========================================================================
   facade/faces.js — Facade Studio: levels → faces → face groups (plan section 3.1 to 3.5, 3.10)

   Pure ES module. No DOM, no three, no hidden state, no mutation of inputs.
   Clipper through globalThis.ClipperLib at SCALE = 1000, only to build the
   standalone L, U, and O shapes. Units: feet, square feet, degrees.
   Plan (x, y): x = east, y = north. Coordinates round to 0.001 ft.

   Contract (docs/facade-studio-technical-plan.md, section 4):
     SECTORS                                  ["N", "E", "S", "W"]
     standaloneLevels(standalone)             → Level[]
     massingLevels(state, project)            → { levels, rotation, source, notes, noteIds }
     bearingOf(normal, rotationDeg)           → degrees clockwise from north, [0, 360)
     sectorOf(bearing)                        → "N" | "E" | "S" | "W"
     levelEdges(level, rotationDeg)           → Edge[]
     zoneOf(state, levels)                    → { [levelIndex]: zoneId }
     faceGroups(state, levels, rotationDeg)   → Group[]
     streetFaces(state, groups, levels, project) → { ids, source }

   Types:
     Level = { index, zone, z, ftf, program, plates: MultiPoly }
     Edge  = { levelIndex, ring, a, b, length, normal, bearing, orientation, convexStart, convexEnd,
               piece, k, z, ftf }            (piece, k, z, ftf are additive)
     Group = { id, levelFrom, levelTo, levels, a, b, length, bearing, orientation, zone, ring,
               convexStart, convexEnd, height, normal, piece, z, edges }   (normal … edges additive;
               edges = the per-level Edge list, bottom up; a, b, length, bearing are the levelFrom edge)

   Rule choices where the plan leaves room (documented on purpose):
   - Levels sort by z (then index) before zoning and grouping; `index` is an id, not an order.
   - Convex vertex = a LEFT turn on the cleaned ring (outer CCW, holes CW). Both ring kinds keep the
     building on the left, so a left turn is a building corner on both. (Plan 3.2 says "the sign of the
     ring orientation"; on a CW hole that would call the court's inside corners convex.)
   - Merge compares each next edge with the merged edge so far (no drift on fine polylines). Merge,
     then drop edges under 0.1 ft, repeated until stable; convexity is read between the kept edges.
   - Face groups join only on adjacent levels in z order whose floors touch (z + ftf = next z).
   - Standalone rings start at their lowest-then-westmost vertex before the rotation, so the south
     face of a rectangle is edge 0 and group F1.
   - Street faces with a site use state.placement, else the massing placement, else the identity.
   ========================================================================== */

import { cleanRing2 } from "../shared/sketchup-format.js";
import { getSection, toProject } from "../shared/project.js";

const SCALE = 1000;
const DEG = Math.PI / 180;
const MERGE_DEG = 0.5;      // plan 3.2
const MIN_EDGE = 0.1;       // ft, plan 3.2
const GROUP_TOL = 1;        // ft, plan 3.5
const GROUP_DEG = 1;        // degrees, plan 3.5
const Z_TOL = 0.01;         // ft: floors touch
const SKIP_ZONES = ["deck"];   // decision 16, revised: the crown now stays (batch-fixes plan 1)

export const SECTORS = ["N", "E", "S", "W"];

const r3 = (v) => Math.round(v * 1000) / 1000;
const r6 = (v) => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function num(v, d = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}
const pos = (v, d) => { const n = num(v, d); return n > 0 ? n : d; };
const clonePt = (p) => [p[0], p[1]];
const cloneMP = (mp) => (Array.isArray(mp) ? mp : []).map((pc) => ({ outer: pc.outer.map(clonePt), holes: (pc.holes || []).map((h) => h.map(clonePt)) }));

/* ------------------------------------------------------------ rings */

function signedArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** One {outer, holes} piece → cleaned piece (outer CCW, holes CW), or null. */
function cleanPiece(pc) {
  const outer = cleanRing2(pc && pc.outer);
  if (!outer) return null;
  const holes = [];
  for (const h of (pc && pc.holes) || []) { const c = cleanRing2(h, { hole: true }); if (c) holes.push(c); }
  return { outer, holes };
}
const cleanMP = (mp) => (Array.isArray(mp) ? mp : []).map(cleanPiece).filter(Boolean);

/** Start the ring at its lowest-then-westmost vertex (order and orientation unchanged). */
function startLowest(ring) {
  let s = 0;
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i], q = ring[s];
    if (p[1] < q[1] - 1e-9 || (Math.abs(p[1] - q[1]) <= 1e-9 && p[0] < q[0])) s = i;
  }
  return ring.slice(s).concat(ring.slice(0, s));
}

const rectRing = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Clipper boolean on rectangles: "union" of subjects, or "diff" subjects − clips. → MultiPoly (unrotated). */
function clipRects(subjects, clips, op) {
  const C = globalThis.ClipperLib;
  if (!C) throw new Error("standaloneLevels: ClipperLib is not loaded (globalThis.ClipperLib) and the L, U, and O shapes need it.");
  const path = (ring) => ring.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
  const clip = new C.Clipper();
  for (const r of subjects) clip.AddPath(path(r), C.PolyType.ptSubject, true);
  for (const r of clips) clip.AddPath(path(r), C.PolyType.ptClip, true);
  const tree = new C.PolyTree();
  const type = op === "diff" ? C.ClipType.ctDifference : C.ClipType.ctUnion;
  clip.Execute(type, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const ring = (node) => node.Contour().map((p) => [p.X / SCALE, p.Y / SCALE]);
  const out = [];
  const visit = (node) => {
    if (!node.IsHole()) {
      const outer = cleanRing2(ring(node));
      const holes = [];
      for (const ch of node.Childs()) { const h = cleanRing2(ring(ch), { hole: true }); if (h) holes.push(h); }
      if (outer) out.push({ outer, holes });
    }
    for (const ch of node.Childs()) for (const g of ch.Childs()) visit(g);
  };
  for (const top of tree.Childs()) visit(top);
  return out;
}

function rotateMP(mp, angleDeg) {
  const c = Math.cos(angleDeg * DEG), s = Math.sin(angleDeg * DEG);
  const rot = (r) => r.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
  return mp.map((pc) => {
    const outer = cleanRing2(rot(startLowest(pc.outer)));
    if (!outer) return null;
    const holes = pc.holes.map((h) => cleanRing2(rot(startLowest(h)), { hole: true })).filter(Boolean);
    return { outer, holes };
  }).filter(Boolean);
}

/** Plan 3.1: the main shape, centered on its bounding box, before the rotation. */
function mainShape(s) {
  const W = pos(s.width, 300), D = pos(s.depth, 65);
  const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2;
  const shape = String(s.shape || "rect");
  if (shape === "L" || shape === "U") {
    const arm = pos(s.arm, 65);
    const rings = [rectRing(x0, y0, x1, Math.min(y1, y0 + arm)), rectRing(x0, y0, Math.min(x1, x0 + arm), y1)];
    if (shape === "U") rings.push(rectRing(Math.max(x0, x1 - arm), y0, x1, y1));
    return clipRects(rings, [], "union");
  }
  if (shape === "O") {
    const cw = num(s.courtW, 120), cd = num(s.courtD, 90);
    if (!(cw > 0 && cd > 0)) return [{ outer: rectRing(x0, y0, x1, y1), holes: [] }];
    return clipRects([rectRing(x0, y0, x1, y1)], [rectRing(-cw / 2, -cd / 2, cw / 2, cd / 2)], "diff");
  }
  return [{ outer: rectRing(x0, y0, x1, y1), holes: [] }];
}

/* ------------------------------------------------------------ levels */

/** Plan 3.1, standalone: podium levels first (zone "podium"), then `floors` main levels (zone "main"). */
export function standaloneLevels(standalone) {
  const s = standalone || {};
  const angle = num(s.angle, 0);
  const ftf1 = pos(s.ftf1, 12), ftf = pos(s.ftf, 10);
  const floors = Math.max(0, Math.round(num(s.floors, 5)));
  const pod = s.podium && s.podium.on ? s.podium : null;
  const main = rotateMP(mainShape(s), angle);
  const levels = [];
  let z = 0, index = 0;
  const push = (zone, h, plates) => {
    index += 1;
    levels.push({ index, zone, z: r3(z), ftf: r3(h), program: null, plates: cloneMP(plates) });
    z += h;
  };
  if (pod) {
    const P = Math.max(1, Math.round(num(pod.levels, 1)));
    const pw = pos(pod.width, 300), pd = pos(pod.depth, 200);
    const plate = rotateMP([{ outer: rectRing(-pw / 2, -pd / 2, pw / 2, pd / 2), holes: [] }], angle);
    const podFtf = pos(pod.ftf, 11);
    for (let i = 0; i < P; i++) push("podium", i === 0 ? ftf1 : podFtf, plate);
  }
  for (let i = 0; i < floors; i++) push("main", i === 0 && !pod ? ftf1 : ftf, main);
  return levels;
}

function byZ(levels) {
  return (Array.isArray(levels) ? levels : []).slice().sort((p, q) => (num(p.z) - num(q.z)) || (num(p.index) - num(q.index)));
}

/**
 * Plan 3.1 and section 7. Project source: massing.derived.levels without deck or empty levels. The crown level stays, with zone "crown".
 * A missing project massing, or one with no levels, falls back to the standalone massing with a note.
 * → { levels (sorted by z), rotation, source: "project" | "standalone", notes: [string], noteIds: [string] }
 */
export function massingLevels(state, project) {
  const st = state || {};
  const notes = [], noteIds = [];
  const note = (id, text) => { noteIds.push(id); notes.push(text); };
  if (st.source === "project") {
    const sec = getSection(project, "massing");
    const der = sec && sec.derived;
    const list = der && Array.isArray(der.levels) ? der.levels : [];
    if (!sec) {
      note("no-project-massing", "No project massing is open. Showing the standalone massing.");
    } else if (!list.length) {
      if (sec.tool === "tower") note("tower-no-levels", "The Tower Generator does not write massing levels yet. Use the standalone massing.");
      else note("no-levels", "The project massing has no levels. Showing the standalone massing.");
    } else {
      const placement = sec.placement || st.placement || {};
      const levels = byZ(list
        .filter((l) => l && !SKIP_ZONES.includes(l.zone))
        .map((l) => ({ index: num(l.index), zone: l.zone, z: r3(num(l.z)), ftf: r3(num(l.ftf)), program: l.program === undefined ? null : l.program, plates: cleanMP(l.plates) }))
        .filter((l) => l.plates.length));
      if (!levels.length) note("no-levels", "The project massing has no levels with plates.");
      return { levels, rotation: num(placement.rotation, 0), source: "project", notes, noteIds };
    }
  }
  const levels = byZ(standaloneLevels(st.standalone).filter((l) => l.plates.length));
  if (!levels.length) note("no-levels", "The standalone massing has no levels.");
  return { levels, rotation: 0, source: "standalone", notes, noteIds };
}

/* ------------------------------------------------------------ bearings */

/** Plan 3.3: outward normal [nx, ny] (or {x, y}) in the local frame → bearing in the project frame. */
export function bearingOf(normal, rotationDeg) {
  const nx = Array.isArray(normal) ? num(normal[0]) : num(normal && normal.x);
  const ny = Array.isArray(normal) ? num(normal[1]) : num(normal && normal.y);
  const r = num(rotationDeg, 0) * DEG;
  const px = nx * Math.cos(r) - ny * Math.sin(r);
  const py = nx * Math.sin(r) + ny * Math.cos(r);
  let b = r3(Math.atan2(px, py) / DEG);
  b = ((b % 360) + 360) % 360;
  b = r3(b);
  return b >= 360 || b === 0 ? 0 : b;
}

/** Plan 3.3: N [315, 45), E [45, 135), S [135, 225), W [225, 315). */
export function sectorOf(bearing) {
  const b = ((num(bearing) % 360) + 360) % 360;
  if (b >= 315 || b < 45) return "N";
  if (b < 135) return "E";
  if (b < 225) return "S";
  return "W";
}

/* ------------------------------------------------------------ edges */

const dirOf = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
const angDiff = (x, y) => Math.abs((((x - y) % 360) + 540) % 360 - 180);
const lenOf = (e) => Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);

/** One merge pass around a closed ring of edges {a, b}. */
function mergePass(list) {
  const n = list.length;
  if (n < 3) return list;
  let s = -1;
  for (let i = 0; i < n; i++) {
    const p = list[(i - 1 + n) % n], c = list[i];
    if (angDiff(dirOf(p.a, p.b), dirOf(c.a, c.b)) >= MERGE_DEG) { s = i; break; }
  }
  if (s < 0) return list;
  const out = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const e = list[(s + k) % n];
    if (cur && angDiff(dirOf(cur.a, cur.b), dirOf(e.a, e.b)) < MERGE_DEG) cur = { a: cur.a, b: e.b };
    else { if (cur) out.push(cur); cur = { a: e.a, b: e.b }; }
  }
  out.push(cur);
  return out;
}

/** Plan 3.2: merge near-collinear edges, drop short ones, until stable. */
function ringEdgeList(ring) {
  let list = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const e = { a: ring[i], b: ring[(i + 1) % n] };
    if (lenOf(e) > 1e-9) list.push(e);
  }
  for (let it = 0; it < 8; it++) {
    const next = mergePass(list).filter((e) => lenOf(e) >= MIN_EDGE);
    const same = next.length === list.length;
    list = next;
    if (same) break;
  }
  return list.length >= 2 ? list : [];
}

/** Plan 3.2 and 3.3: every face edge of one level, outer rings (ring 0) and holes (ring k). */
export function levelEdges(level, rotationDeg) {
  const lv = level || {};
  const out = [];
  const plates = cleanMP(lv.plates);
  plates.forEach((pc, piece) => {
    [pc.outer, ...pc.holes].forEach((ring, ringId) => {
      const list = ringEdgeList(ring);
      const m = list.length;
      const turn = (e1, e2) => {
        const d1 = [e1.b[0] - e1.a[0], e1.b[1] - e1.a[1]], d2 = [e2.b[0] - e2.a[0], e2.b[1] - e2.a[1]];
        const cross = d1[0] * d2[1] - d1[1] * d2[0];
        return cross / (Math.hypot(...d1) * Math.hypot(...d2));
      };
      const convex = list.map((e, j) => turn(list[(j - 1 + m) % m], e) > 1e-9);   // vertex at the start of edge j
      list.forEach((e, j) => {
        const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy);
        const normal = [r6(dy / L), r6(-dx / L)];
        const bearing = bearingOf([dy / L, -dx / L], rotationDeg);
        out.push({
          levelIndex: lv.index, ring: ringId,
          a: [r3(e.a[0]), r3(e.a[1])], b: [r3(e.b[0]), r3(e.b[1])], length: r3(L),
          normal, bearing, orientation: sectorOf(bearing),
          convexStart: convex[j], convexEnd: convex[(j + 1) % m],
          piece, k: j, z: r3(num(lv.z)), ftf: r3(num(lv.ftf)),
        });
      });
    });
  });
  return out;
}

/* ------------------------------------------------------------ zones */

/** Plan 3.4: default base / middle / top, or level ranges with the default as the fallback. */
export function zoneOf(state, levels) {
  const sorted = byZ(levels);
  const out = {};
  if (!sorted.length) return out;
  const podium = sorted.filter((l) => l.zone === "podium").map((l) => l.index);
  const base = new Set(podium.length ? podium : [sorted[0].index]);
  const nonCrown = sorted.filter((l) => l.zone !== "crown");
  const topIdx = nonCrown.length ? nonCrown[nonCrown.length - 1].index : null;
  for (const l of sorted) out[l.index] = base.has(l.index) ? "base" : l.index === topIdx ? "top" : "middle";
  const z = (state && state.zones) || {};
  if (z.mode === "ranges" && Array.isArray(z.ranges)) {
    for (const l of sorted) {
      if (l.zone === "crown") continue;
      const r = z.ranges.find((g) => g && g.id !== undefined && l.index >= num(g.from, Infinity) && l.index <= num(g.to, -Infinity));
      if (r) out[l.index] = String(r.id);
    }
  }
  for (const l of sorted) if (l.zone === "crown") out[l.index] = "crown";   // the crown is always its own zone
  return out;
}

/* ------------------------------------------------------------ face groups */

const near = (p, q, tol) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;

/** Plan 3.5: faces on touching consecutive levels join when zone, ring, end points (1 ft), and direction (1°) match. */
export function faceGroups(state, levels, rotationDeg) {
  const sorted = byZ(levels);
  const zones = zoneOf(state, sorted);
  const groups = [];
  let open = [];        // groups whose last level is the previous level
  let prev = null;
  for (const lv of sorted) {
    const zone = zones[lv.index];
    const touches = prev && Math.abs(num(prev.z) + num(prev.ftf) - num(lv.z)) <= Z_TOL;
    const candidates = touches ? open : [];
    const edges = levelEdges(lv, rotationDeg).sort((p, q) => (p.ring - q.ring) || (p.piece - q.piece) || (p.k - q.k));
    const used = new Set();
    const next = [];
    for (const e of edges) {
      const dir = dirOf(e.a, e.b);
      const g = candidates.find((c) => {
        if (used.has(c) || c.zone !== zone || c.ring !== e.ring) return false;
        const last = c.edges[c.edges.length - 1];
        return near(last.a, e.a, GROUP_TOL) && near(last.b, e.b, GROUP_TOL) && angDiff(dirOf(last.a, last.b), dir) <= GROUP_DEG;
      });
      if (g) {
        used.add(g);
        g.edges.push(e);
        g.levels.push(lv.index);
        g.levelTo = lv.index;
        g.height = r3(g.height + e.ftf);
        next.push(g);
      } else {
        const ng = {
          id: `F${groups.length + 1}`, levelFrom: lv.index, levelTo: lv.index, levels: [lv.index],
          a: e.a.slice(), b: e.b.slice(), length: e.length, bearing: e.bearing, orientation: e.orientation,
          zone, ring: e.ring, convexStart: e.convexStart, convexEnd: e.convexEnd, height: e.ftf,
          normal: e.normal.slice(), piece: e.piece, z: e.z, edges: [e],
        };
        groups.push(ng);
        next.push(ng);
      }
    }
    open = next;
    prev = lv;
  }
  return groups;
}

/* ------------------------------------------------------------ street faces */

function closestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Plan 3.10. manual: the ids in state.street.manual. auto: lowest-level groups facing S, or, when the
 * project site has road segments, lowest-level groups whose midpoint (project frame) lies within
 * roadDistance of a road centerline and whose normal points toward it. → { ids, source }
 */
export function streetFaces(state, groups, levels, project) {
  const st = (state && state.street) || {};
  const list = Array.isArray(groups) ? groups : [];
  if (st.mode === "manual") {
    const want = new Set((Array.isArray(st.manual) ? st.manual : []).map(String));
    return { ids: list.filter((g) => want.has(g.id)).map((g) => g.id), source: "manual" };
  }
  const sorted = byZ(levels);
  if (!sorted.length) return { ids: [], source: "auto" };
  const low = sorted[0].index;
  const ground = list.filter((g) => Array.isArray(g.levels) ? g.levels.includes(low) : g.levelFrom === low);
  const site = getSection(project, "site");
  const segs = site && site.derived && site.derived.roads && Array.isArray(site.derived.roads.segments) ? site.derived.roads.segments : [];
  const roads = segs.map((s) => (s && Array.isArray(s.line) ? s.line.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])) : [])).filter((l) => l.length >= 2);
  if (!roads.length) return { ids: ground.filter((g) => g.orientation === "S").map((g) => g.id), source: "auto" };

  const massing = getSection(project, "massing");
  const placement = (state && state.placement) || (massing && massing.placement) || { x: 0, y: 0, rotation: 0, baseZ: 0 };
  const pl = { x: num(placement.x), y: num(placement.y), rotation: num(placement.rotation), baseZ: num(placement.baseZ) };
  const r = pl.rotation * DEG;
  const dist = Math.max(0, num(st.roadDistance, 60));
  const ids = [];
  for (const g of ground) {
    const e = (g.edges || []).find((x) => x.levelIndex === low) || g;
    const mid = toProject(pl, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]);
    const n = e.normal || g.normal;
    const pn = [n[0] * Math.cos(r) - n[1] * Math.sin(r), n[0] * Math.sin(r) + n[1] * Math.cos(r)];
    const hit = roads.some((line) => {
      for (let i = 0; i + 1 < line.length; i++) {
        const c = closestOnSegment(mid, line[i], line[i + 1]);
        const vx = c[0] - mid[0], vy = c[1] - mid[1];
        if (Math.hypot(vx, vy) <= dist && vx * pn[0] + vy * pn[1] > 0) return true;
      }
      return false;
    });
    if (hit) ids.push(g.id);
  }
  return { ids, source: "auto-site" };
}
