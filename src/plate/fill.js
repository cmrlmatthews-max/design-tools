/* ==========================================================================
   plate/fill.js — unit zone, runs, corners, slots, types, widths, unit polygons
   (docs/plate-planner-technical-plan.md sections 3.4 to 3.10 and 4)

   unitZone(plate, corridor, blocks, extWall)           → { zone, areaLines: [Ring], inset, zone0 }
   runsAndCorners(zone, plate, corridor, blocks, state) → { runs, corners, pockets, remainders, bands, warnings }
   slotsFor(run, types, W)                              → n | null
   fillRuns(runs, types, counts, opts)                  → [{ runId, units: [{ type, from, to, width, accessible }], short }]
   fillLevel(level, state, { counters, locks, accessible } = {}) → LevelFill
   buildPlates(state, { project = null } = {})          → { source, groups: [{ id, key, label, first, floors, levels, fill }],
                                                            levels, placement, warnings, notes, massingUpdatedAt }

   LevelFill = { index, kind, width, spine, plate, inset, corridor, corridorClear, core, stairs: [{ id, outer, door }],
                 elevators: [{ id, outer, service }], support: [{ id, outer, kind }], units, runs, corners: [{ ring, at, e, outer, type }],
                 counts, placed, dropped, depth, graph: { lengthFt, stairPathFt, deadEnds, reach }, warnings }
   unit = { id, type, outer, area, width, exposures, corner, accessible, bays, bay: { from, to }, ring, demising, door, runId,
            wrap?, locked? }

   Pure ES module: no DOM, no Three.js, no hidden state, inputs are never mutated. Clipper at SCALE 1000.
   Coordinates round to 0.001 ft, unit areas to 0.1 sf.

   Rule choices where the plan leaves room:
   - Runs come from sight lines: every facade edge (area line, the plate inset by extWall) looks inward along its
     normal; where the first obstacle is a corridor face, that stretch is a band candidate. Consecutive stretches that
     see the same corridor face merge (a curved facade becomes one run). Candidates are taken in order of depth; a
     candidate that overlaps a taken band by more than 1 sf drops (a U arm end looking down the arm).
     The run axis is the corridor face; cut lines are perpendicular to it.
   - What the bands leave: a piece that touches two facade edges at a convex vertex is a corner zone (a wrap unit of
     cornerType; hotel: a remainder); a piece that touches no facade is a pocket; anything else is a remainder.
     A corner zone that a block touches gets no wrap unit and becomes a remainder (change 5).
   - Wrap leg e = clamp((A + d²) ÷ (2d), d, 2d) from the inset corner, d = the mean depth of the two runs. A leg stops
     at the first reservation of its run.
   - Reserved stretches (blocks, too-short runs) become remainders out to the plate edge (section 8.1 closure), minus the
     corridor, the blocks, and every other band, wrap and pocket.
   - Hotel accessible keys keep the target accessible width; they take the run ends nearest the guest elevators
     (ties: run order, start before end), one end each. Type A units (multifamily) are a flag on the units whose door is
     nearest the guest elevators.
   - Elevators without a core: `count` cabs on the first run at mid-length against the corridor; hotel service cabs and
     back-of-house (service 8, linen 8 × 14, ice and data 8 × 6 stacked: 24 ft) across the corridor at the same point.
     With a core: every cab inside the core; hotel back-of-house against the core on the side with the longer run.
   - The bay of a unit runs along its area-line ring, counter-clockwise from the ring's lowest, then westmost vertex.
     A bay across that vertex has to > the ring perimeter.
   - Exposures: N [315, 45), E [45, 135), S [135, 225), W [225, 315) of the facade edges' outward bearing after the
     placement rotation (counter-clockwise degrees); a unit with two sectors is a corner unit.
   - Targets (fill.counts): countsFor(ΣL, types at the length-weighted depth, wrap corners + locked units), hotel less the
     accessible widths. Deficit counters start with the corner and locked units and carry from run to run.
   ========================================================================== */

import { GEO, spineFor, corridorPolygon, stairBlocks, corridorGraph, coreLayout } from "./corridor.js";
import { effectiveTypes, weightedWidth, countsFor, requiredAccessible, MULTIFAMILY_TYPES, HOTEL_TYPES } from "./mix.js";
import { levelsFrom, groupLevels } from "./levels.js";
import { cleanRing2 } from "../shared/sketchup-format.js";

const { asMP, bool, offsetMP, mpArea, ringArea, inMP, segDist, distToBoundary, bboxOf, rectRing, centroidOf, ringsOf, at, frameRect, rr3, r3 } = GEO;

const EPS = 1e-9;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPt = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const need = (v, fn, name) => { if (v === undefined || v === null) throw new Error(`${fn}: missing input "${name}".`); return v; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dirOf = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
const warn = (code, message, where = {}, severity = "warn") => ({ code, severity, where, message });

const MAX_RUN = 400;              // ft: longer runs split at the middle (plan section 11)
const MIN_DEPTH = 0.5;            // ft: a corridor this close to the area line leaves no band
const STRIP_T = 1e4;              // ft: "far enough" in a frame strip

const extWallOf = (state) => (isNum(state.extWall) && state.extWall >= 0 ? state.extWall : 1.0);
const modeOf = (state) => (state.mode === "hotel" ? "hotel" : "multifamily");
const mixTypes = (state) => {
  const mode = modeOf(state);
  const t = state.mix && Array.isArray(state.mix[mode]) && state.mix[mode].length ? state.mix[mode] : mode === "hotel" ? HOTEL_TYPES : MULTIFAMILY_TYPES;
  return t;
};
const largest = (mp) => asMP(mp).slice().sort((a, b) => Math.abs(ringArea(b.outer)) - Math.abs(ringArea(a.outer)))[0] || null;
const blockMP = (blocks) => blocks.map((b) => ({ outer: b.outer, holes: [] }));

/* ======================================================================= unit zone */

/** Plan 3.5 item 1. blocks: [{ outer }]. → { zone, areaLines, inset, zone0 } */
export function unitZone(plate, corridor, blocks, extWall) {
  need(plate, "unitZone", "plate"); need(corridor, "unitZone", "corridor");
  const ext = isNum(extWall) && extWall >= 0 ? extWall : 1.0;
  const inset = ext > 0 ? offsetMP(asMP(plate), -ext) : asMP(plate);
  const zone0 = corridor.length ? bool("diff", inset, corridor) : inset;
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) => b && Array.isArray(b.outer) && b.outer.length >= 3);
  const zone = list.length ? bool("diff", zone0, blockMP(list)) : zone0;
  return { zone, areaLines: ringsOf(inset), inset, zone0 };
}

/* ======================================================================= facade rings */

function mergeCollinear(pts) {
  const out = pts.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const u = dirOf(a, b), v = dirOf(b, c);
      const ang = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], dot(u, v))) * 180 / Math.PI;
      if (ang < 0.5 && segDist(b, a, c) < 0.1) { out.splice(i, 1); changed = true; i--; }
    }
  }
  return out;
}

/** The area-line rings: counter-clockwise, from the lowest then westmost vertex, collinear edges merged. */
function facadeRings(inset) {
  const rings = [];
  let holeNo = 0;
  for (const pc of asMP(inset)) {
    const list = [{ pts: pc.outer, hole: false }, ...pc.holes.map((h) => ({ pts: h, hole: true }))];
    for (const { pts, hole } of list) {
      let p = pts.map((q) => [q[0], q[1]]);
      if (ringArea(p) < 0) p.reverse();
      p = mergeCollinear(p);
      let s = 0;
      for (let i = 1; i < p.length; i++) if (p[i][1] < p[s][1] - 1e-9 || (Math.abs(p[i][1] - p[s][1]) <= 1e-9 && p[i][0] < p[s][0])) s = i;
      p = p.slice(s).concat(p.slice(0, s));
      const id = hole ? ++holeNo : 0;
      const side = hole ? -1 : 1;                        // material left (outer) or right (hole) of the CCW walk
      const edges = [];
      let s0 = 0;
      for (let k = 0; k < p.length; k++) {
        const a = p[k], b = p[(k + 1) % p.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u = dirOf(a, b), n = [-u[1] * side, u[0] * side];
        edges.push({ ring: rings.length, k, a, b, len, u, n, s0 });
        s0 += len;
      }
      rings.push({ id, hole, side, pts: p, edges, perimeter: s0 });
    }
  }
  return rings;
}

/** Ring parameter of a point on a facade ring (nearest edge). */
function ringParam(ring, P) {
  let best = null;
  for (const e of ring.edges) {
    const t = Math.max(0, Math.min(e.len, dot(sub(P, e.a), e.u)));
    const q = [e.a[0] + e.u[0] * t, e.a[1] + e.u[1] * t];
    const d = Math.hypot(P[0] - q[0], P[1] - q[1]);
    if (!best || d < best.d - 1e-9) best = { d, s: e.s0 + t };
  }
  return best ? best.s : 0;
}

/* ======================================================================= sight lines and bands */

function sightIntervals(E, obstacles, corridor) {
  const toLocal = (p) => [dot(sub(p, E.a), E.u), dot(sub(p, E.a), E.n)];
  const segs = [];
  const T0 = 1e-7;
  for (const o of obstacles) {
    if (o.facade && o.ring === E.ring && o.k === E.k) continue;
    let p = toLocal(o.p), q = toLocal(o.q);
    if (p[1] < T0 && q[1] < T0) continue;
    if (p[1] < T0 || q[1] < T0) {
      const t = (T0 - p[1]) / (q[1] - p[1]);
      const x = [p[0] + (q[0] - p[0]) * t, T0];
      if (p[1] < T0) p = x; else q = x;
    }
    if (p[0] > q[0]) [p, q] = [q, p];
    if (q[0] - p[0] < 1e-7 || q[0] <= 0 || p[0] >= E.len) continue;
    segs.push({ p, q, o });
  }
  const bps = [0, E.len];
  for (const s of segs) { if (s.p[0] > 0 && s.p[0] < E.len) bps.push(s.p[0]); if (s.q[0] > 0 && s.q[0] < E.len) bps.push(s.q[0]); }
  bps.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < bps.length; i++) {
    const a = bps[i], b = bps[i + 1];
    if (b - a < 1e-6) continue;
    const m = (a + b) / 2;
    const probe = [E.a[0] + E.u[0] * m + E.n[0] * 0.01, E.a[1] + E.u[1] * m + E.n[1] * 0.01];
    if (corridor.length && inMP(probe, corridor)) { out.push({ a, b, hit: null, inside: true }); continue; }
    let best = null;
    for (const s of segs) {
      if (m < s.p[0] || m > s.q[0]) continue;
      const tau = s.p[1] + ((s.q[1] - s.p[1]) * (m - s.p[0])) / (s.q[0] - s.p[0]);
      if (!best || tau < best.tau) best = { tau, o: s.o };
    }
    out.push({ a, b, hit: best ? best.o : null, tau: best ? best.tau : Infinity });
  }
  // merge neighbours with the same hit
  const merged = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && last.hit === iv.hit && !!last.inside === !!iv.inside && Math.abs(last.b - iv.a) < 1e-6) { last.b = iv.b; last.tau = Math.min(last.tau, iv.tau); }
    else merged.push({ ...iv });
  }
  return merged;
}

/** Band candidates of every facade ring, built and filtered (plan 3.5 items 2 and 3). */
function facadeBands(rings, corridor, zone0, known = []) {
  const obstacles = [];
  ringsOf(corridor).forEach((r, ri) => { for (let i = 0; i < r.length; i++) obstacles.push({ p: r[i], q: r[(i + 1) % r.length], cid: `${ri}:${i}`, facade: false }); });
  for (const R of rings) for (const e of R.edges) obstacles.push({ p: e.a, q: e.b, facade: true, ring: e.ring, k: e.k });

  const cands = [];
  rings.forEach((R, ri) => {
    const list = [];
    for (const E of R.edges) {
      for (const iv of sightIntervals(E, obstacles, corridor)) {
        const ok = iv.hit && !iv.hit.facade && iv.tau >= MIN_DEPTH && !iv.inside;
        if (!ok) { list.push(null); continue; }
        const last = list[list.length - 1];
        const lastPart = last && last.parts[last.parts.length - 1];
        const contiguous = last && last.hit === iv.hit.cid && lastPart && (
          (lastPart.k === E.k && Math.abs(lastPart.b - iv.a) < 1e-6) ||
          (lastPart.k === E.k - 1 && Math.abs(lastPart.b - R.edges[lastPart.k].len) < 1e-6 && iv.a < 1e-6));
        if (contiguous) lastPart.k === E.k ? (lastPart.b = iv.b) : last.parts.push({ k: E.k, a: iv.a, b: iv.b });
        else list.push({ ring: ri, hit: iv.hit.cid, face: iv.hit, parts: [{ k: E.k, a: iv.a, b: iv.b }] });
      }
    }
    const real = list.filter(Boolean);
    // across the ring start
    if (real.length > 1) {
      const first = real[0], last = real[real.length - 1];
      const lp = last.parts[last.parts.length - 1], fp = first.parts[0];
      if (first.hit === last.hit && lp.k === R.edges.length - 1 && Math.abs(lp.b - R.edges[lp.k].len) < 1e-6 && fp.k === 0 && fp.a < 1e-6) {
        last.parts.push(...first.parts);
        real.shift();
      }
    }
    for (const c of real) cands.push(c);
  });

  // geometry of each candidate
  const built = [];
  cands.forEach((c, order) => {
    const R = rings[c.ring];
    const chain = [];
    for (const part of c.parts) {
      const E = R.edges[part.k];
      const pa = [E.a[0] + E.u[0] * part.a, E.a[1] + E.u[1] * part.a], pb = [E.a[0] + E.u[0] * part.b, E.a[1] + E.u[1] * part.b];
      if (!chain.length || Math.hypot(chain[chain.length - 1][0] - pa[0], chain[chain.length - 1][1] - pa[1]) > 1e-6) chain.push(pa);
      chain.push(pb);
    }
    const F = c.face;
    let u = dirOf(F.p, F.q);
    const cd = sub(chain[chain.length - 1], chain[0]);
    const firstE = R.edges[c.parts[0].k];
    if (Math.hypot(cd[0], cd[1]) > 1e-6 ? dot(u, cd) < 0 : dot(u, firstE.u) < 0) u = [-u[0], -u[1]];
    const mid = chain[Math.floor(chain.length / 2)];
    let n = [-u[1], u[0]];
    if (dot(n, sub(mid, F.p)) < 0) n = [-n[0], -n[1]];
    const o = [F.p[0] + u[0] * dot(sub(chain[0], F.p), u), F.p[1] + u[1] * dot(sub(chain[0], F.p), u)];
    const fr = { o, u, n };
    const s1 = dot(sub(chain[chain.length - 1], o), u);
    if (s1 < 0.01) return;
    const ring = [...chain, at(fr, s1, 0), at(fr, 0, 0)];
    const band = bool("int", [ring], zone0);
    const area = mpArea(band);
    if (area < 0.5) return;
    const maxT = Math.max(...chain.map((p) => dot(sub(p, o), n)));
    built.push({ order, ring: c.ring, parts: c.parts, fr, s1, band, area, depth: area / s1, maxT,
      from: R.edges[c.parts[0].k].s0 + c.parts[0].a, facePts: chain });
  });

  // free length after the blocks known now (stairs, core, seeds, support, locks): the tie-break between equal depths
  for (const b of built) {
    const cuts = [];
    for (const blk of known) {
      if (mpArea(bool("int", b.band, [{ outer: blk.outer, holes: [] }])) <= 0.01) continue;
      const [lo, hi] = projRange(b.fr, blk.outer);
      cuts.push([Math.max(0, lo), Math.min(b.s1, hi)]);
    }
    b.free = b.s1 - mergeIntervals(cuts).reduce((s, iv) => s + iv[1] - iv[0], 0);
  }
  // depth order (within 0.01 ft a tie), then the longer free length; drop a candidate that overlaps a taken band
  const sorted = built.slice().sort((a, b) => (Math.abs(a.depth - b.depth) > 0.01 ? a.depth - b.depth : 0) || b.free - a.free || a.order - b.order);
  const taken = [];
  let takenMP = [];
  for (const b of sorted) {
    if (takenMP.length && mpArea(bool("int", b.band, takenMP)) > 1) continue;
    taken.push(b);
    takenMP = takenMP.length ? bool("union", [...takenMP, ...b.band], []) : b.band;
  }
  taken.sort((a, b) => a.order - b.order);
  taken.forEach((b, i) => { b.id = i; });
  return taken;
}

/* ======================================================================= leftovers: corners, pockets */

function facadeContacts(ring, rings) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.01) continue;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const R of rings) {
      for (const e of R.edges) {
        if (segDist(m, e.a, e.b) > 0.005 || segDist(a, e.a, e.b) > 0.005 || segDist(b, e.a, e.b) > 0.005) continue;
        out.push({ ring: e.ring, k: e.k, len: L });
      }
    }
  }
  return out;
}

/** Leftover pieces of the band partition → corner zones, pockets, remainders. */
function classifyLeftovers(zone0, bands, rings, blocks, opts) {
  const all = bands.flatMap((b) => b.band);
  const left = all.length ? bool("diff", zone0, all) : asMP(zone0);
  const corners = [], pockets = [], remainders = [];
  const blk = blockMP(blocks);
  for (const pc of left) {
    const piece = [pc];
    const hit = blk.length && mpArea(bool("int", piece, blk)) > 0.01;
    if (hit) {
      for (const q of bool("diff", piece, blk)) if (Math.abs(ringArea(q.outer)) > 0.25) remainders.push({ outer: q.outer, holes: q.holes, why: "block" });
      continue;
    }
    const contacts = facadeContacts(pc.outer, rings);
    const total = contacts.reduce((s, c) => s + c.len, 0);
    if (total < 0.01) { pockets.push({ outer: pc.outer, holes: pc.holes }); continue; }
    // two edges of one ring that meet at a convex vertex
    const byEdge = new Map();
    for (const c of contacts) { const key = `${c.ring}:${c.k}`; byEdge.set(key, (byEdge.get(key) || 0) + c.len); }
    let corner = null;
    if (byEdge.size === 2 && !opts.hotel) {
      const [k1, k2] = [...byEdge.keys()].map((k) => k.split(":").map(Number));
      if (k1[0] === k2[0]) {
        const R = rings[k1[0]], n = R.edges.length;
        let e1 = null, e2 = null;
        if ((k1[1] + 1) % n === k2[1]) { e1 = R.edges[k1[1]]; e2 = R.edges[k2[1]]; }
        else if ((k2[1] + 1) % n === k1[1]) { e1 = R.edges[k2[1]]; e2 = R.edges[k1[1]]; }
        if (e1 && e2) {
          const cr = e1.u[0] * e2.u[1] - e1.u[1] * e2.u[0];
          if (cr * R.side > 1e-6) {
            const a = byEdge.get(`${e1.ring}:${e1.k}`), b = byEdge.get(`${e2.ring}:${e2.k}`);
            const B1 = bands.find((bd) => { const p = bd.parts[bd.parts.length - 1]; return bd.ring === e1.ring && p.k === e1.k && Math.abs(p.b - (e1.len - a)) < 0.02; });
            const B2 = bands.find((bd) => { const p = bd.parts[0]; return bd.ring === e2.ring && p.k === e2.k && Math.abs(p.a - b) < 0.02; });
            if (B1 || B2) corner = { ring: e1.ring, V: e2.a, e1, e2, a, b, B1, B2, piece: pc };
          }
        }
      }
    }
    if (corner) corners.push(corner);
    else remainders.push({ outer: pc.outer, holes: pc.holes, why: "leftover" });
  }
  return { corners, pockets, remainders };
}

/* ======================================================================= runs and corners */

function mergeIntervals(list) {
  const s = list.filter((iv) => iv[1] - iv[0] > 1e-6).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of s) { const last = out[out.length - 1]; if (last && iv[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], iv[1]); else out.push([iv[0], iv[1]]); }
  return out;
}
function minusIntervals(range, cuts) {
  let free = [range.slice()];
  for (const c of cuts) {
    const next = [];
    for (const f of free) {
      if (c[1] <= f[0] + 1e-9 || c[0] >= f[1] - 1e-9) { next.push(f); continue; }
      if (c[0] > f[0]) next.push([f[0], c[0]]);
      if (c[1] < f[1]) next.push([c[1], f[1]]);
    }
    free = next;
  }
  return free.filter((f) => f[1] - f[0] > 1e-6);
}

const strip = (fr, s0, s1, t0 = -1, t1 = STRIP_T) => [frameRect(fr, s0, s1, t0, t1)];
const projRange = (fr, ring) => { let lo = Infinity, hi = -Infinity; for (const p of ring) { const s = dot(sub(p, fr.o), fr.u); lo = Math.min(lo, s); hi = Math.max(hi, s); } return [lo, hi]; };

/**
 * Plan 3.5 items 2 to 8. zone: the unit zone (unused beyond a check; the bands are rebuilt from plate, corridor and
 * extWall); plate: MultiPoly; corridor: the clear corridor; blocks: [{ id, kind, outer }]; state: the plate state.
 * → { runs: [{ id, ring, edge, from, to, length, depth, band, start, end, fr, a, b, bandId }], corners: [{ ring, at, e, outer, legs }],
 *     pockets: [{ outer }], remainders: [{ outer, why }], bands, rings, warnings }
 */
export function runsAndCorners(zone, plate, corridor, blocks, state, cache = null) {
  need(plate, "runsAndCorners", "plate"); need(corridor, "runsAndCorners", "corridor"); need(state, "runsAndCorners", "state");
  const ext = extWallOf(state);
  const blockList = (Array.isArray(blocks) ? blocks : []).filter((b) => b && Array.isArray(b.outer) && b.outer.length >= 3);
  const base = cache || prepareBands(plate, corridor, ext, blockList);
  const { rings, bands, zone0 } = base;
  const warnings = [];
  const hotel = modeOf(state) === "hotel";
  const { corners: cz, pockets, remainders: left } = classifyLeftovers(zone0, bands, rings, blockList, { hotel });
  const types = mixTypes(state);
  const cornerId = (state.mix && state.mix.cornerType) || "2br";
  const cornerType = types.find((t) => t.id === cornerId) || null;

  // reservations per band
  const res = new Map();
  for (const b of bands) {
    const list = [];
    for (const blk of blockList) {
      if (mpArea(bool("int", b.band, [{ outer: blk.outer, holes: [] }])) <= 0.01) continue;
      const [lo, hi] = projRange(b.fr, blk.outer);
      list.push([Math.max(lo, -ext - 0.01), Math.min(hi, b.s1 + ext + 0.01)]);
    }
    res.set(b.id, mergeIntervals(list));
  }

  // wrap corners
  const corners = [];
  const legCuts = new Map(bands.map((b) => [b.id, []]));
  for (const c of cz) {
    if (!cornerType || !isNum(cornerType.targetArea)) { left.push({ outer: c.piece.outer, holes: c.piece.holes, why: "corner" }); continue; }
    const ds = [c.B1, c.B2].filter(Boolean).map((b) => b.depth);
    const d = ds.reduce((s, v) => s + v, 0) / ds.length;
    const A = cornerType.targetArea;
    let e = Math.min(2 * d, Math.max(d, (A + d * d) / (2 * d)));
    // legs stop at the first reservation
    let la = 0, lb = 0;
    if (c.B1) {
      la = Math.max(0, e - c.a);
      const cuts = res.get(c.B1.id).filter((iv) => iv[1] > c.B1.s1 - la - 1e-9);
      if (cuts.length) la = Math.max(0, Math.min(la, c.B1.s1 - Math.max(...cuts.map((iv) => iv[1]))));
      la = Math.min(la, c.B1.s1);
    }
    if (c.B2) {
      lb = Math.max(0, e - c.b);
      const cuts = res.get(c.B2.id).filter((iv) => iv[0] < lb + 1e-9);
      if (cuts.length) lb = Math.max(0, Math.min(lb, Math.min(...cuts.map((iv) => iv[0]))));
      lb = Math.min(lb, c.B2.s1);
    }
    const parts = [{ outer: c.piece.outer, holes: c.piece.holes }];
    if (c.B1 && la > 1e-6) { parts.push(...bool("int", c.B1.band, strip(c.B1.fr, c.B1.s1 - la, c.B1.s1 + 1))); legCuts.get(c.B1.id).push([c.B1.s1 - la, c.B1.s1 + 1]); }
    if (c.B2 && lb > 1e-6) { parts.push(...bool("int", c.B2.band, strip(c.B2.fr, -1, lb))); legCuts.get(c.B2.id).push([-1, lb]); }
    const poly = bool("union", parts, []);
    const big = largest(poly);
    if (!big) continue;
    const eOut = c.B1 && c.B2 ? Math.min(c.a + la, c.b + lb) : (c.B1 ? c.a + la : c.b + lb);
    corners.push({
      ring: c.ring, at: [r3(c.V[0]), r3(c.V[1])], e: Math.round(eOut * 1000) / 1000, eTarget: Math.round(e * 1000) / 1000,
      legs: [Math.round((c.a + la) * 1000) / 1000, Math.round((c.b + lb) * 1000) / 1000],
      outer: big.outer, d, B1: c.B1 ? c.B1.id : null, B2: c.B2 ? c.B2.id : null, la, lb, e1: c.e1, e2: c.e2,
    });
  }

  // run pieces
  const runs = [];
  const reserved = [];             // { band, a, b, why }
  for (const b of bands) {
    const cuts = mergeIntervals([...res.get(b.id), ...legCuts.get(b.id)]);
    for (const iv of res.get(b.id)) reserved.push({ band: b, a: iv[0], b: iv[1], why: "block" });
    for (const f of minusIntervals([0, b.s1], cuts)) {
      const pieces = [f];
      while (pieces.some((p) => p[1] - p[0] > MAX_RUN)) {
        const i = pieces.findIndex((p) => p[1] - p[0] > MAX_RUN), p = pieces[i], m = (p[0] + p[1]) / 2;
        pieces.splice(i, 1, [p[0], m], [m, p[1]]);
      }
      for (const [a, z] of pieces) {
        const L = z - a;
        if (L < 0.01) continue;
        const pb = bool("int", b.band, strip(b.fr, a, z));
        const area = mpArea(pb);
        if (area < 0.01) continue;
        const R = rings[b.ring];
        const pa = facadeAt(b, a), pz = facadeAt(b, z);
        runs.push({
          ring: R.id, ringIndex: b.ring, edge: b.parts[0].k, bandId: b.id, fr: b.fr, a, b: z, length: L, depth: area / L, band: pb,
          from: ringParam(R, pa), to: ringParam(R, pz), start: at(b.fr, a, 0), end: at(b.fr, z, 0), maxT: b.maxT,
        });
      }
    }
  }
  runs.sort((p, q) => p.ringIndex - q.ringIndex || p.from - q.from || p.a - q.a);
  runs.forEach((r, i) => { r.id = `R${i + 1}`; });
  return { runs, corners, pockets, remainders: left, reserved, bands, rings, zone0, warnings };
}

/** Facade point of a band at axis position s (the far end of the cut line). */
function facadeAt(b, s) {
  const pts = b.facePts;
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    const sp = dot(sub(p, b.fr.o), b.fr.u), sq = dot(sub(q, b.fr.o), b.fr.u);
    if (Math.abs(sq - sp) < 1e-9) continue;
    const t = (s - sp) / (sq - sp);
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const x = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const tt = dot(sub(x, b.fr.o), b.fr.n);
    if (!best || tt < best.tt) best = { x, tt };
  }
  return best ? best.x : at(b.fr, s, b.depth);
}

function prepareBands(plate, corridor, ext, known = []) {
  const P = asMP(plate);
  const inset = ext > 0 ? offsetMP(P, -ext) : P;
  const zone0 = corridor.length ? bool("diff", inset, corridor) : inset;
  const rings = facadeRings(inset);
  const bands = facadeBands(rings, asMP(corridor), zone0, known);
  return { inset, zone0, rings, bands };
}

/* ======================================================================= slots */

function sumsTable(types, rMax, cache) {
  const key = types.map((t) => `${t.id}:${t.lo.toFixed(6)}:${t.hi.toFixed(6)}:${t.bays || 1}`).join("|");
  let entry = cache && cache.get(key);
  if (!entry) { entry = [[[0, 0]]]; if (cache) cache.set(key, entry); }
  for (let r = entry.length; r <= rMax; r++) {
    const seen = new Map();
    for (const t of types) {
      const b = t.bays || 1;
      if (b > r) continue;
      for (const [lo, hi] of entry[r - b]) {
        const p = [lo + t.lo, hi + t.hi];
        const k = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
        if (!seen.has(k)) seen.set(k, p);
      }
    }
    entry.push([...seen.values()]);
  }
  return entry;
}

const canClose = (table, r, loNeed, hiNeed) => {
  if (r < 0 || r >= table.length) return false;
  for (const [lo, hi] of table[r]) if (lo <= loNeed + 1e-7 && hi >= hiNeed - 1e-7) return true;
  return false;
};

function rMaxFor(L, types) {
  const per = Math.min(...types.map((t) => t.lo / (t.bays || 1)));
  return Math.min(80, Math.floor(L / Math.max(per, 1)) + 2);
}

/** Plan 3.7 item 2. run: { length }; types: effective types; W: width per slot. → n | null */
export function slotsFor(run, types, W, cache = null) {
  need(run, "slotsFor", "run"); need(types, "slotsFor", "types");
  const L = isNum(run) ? run : run.length;
  if (!isNum(L) || L <= 0 || !types.length) return null;
  const w = isNum(W) && W > 0 ? W : weightedWidth(types).Wbay;
  const rMax = rMaxFor(L, types);
  const table = sumsTable(types, rMax, cache || new Map());
  let best = null;
  for (let r = 1; r <= rMax; r++) {
    if (!canClose(table, r, L, L)) continue;
    const dist = Math.abs(r - L / w);
    if (!best || dist < best.dist - 1e-9) best = { r, dist };
  }
  return best ? best.r : null;
}

/* ======================================================================= types and widths per run */

function deficitOrder(types, counts, placed) {
  return types.map((t, i) => {
    const target = isNum(counts[t.id]) ? counts[t.id] : 0, got = placed[t.id] || 0;
    const remaining = target - got;
    return { t, i, group: remaining > 0 ? 0 : 1, def: target > 0 ? remaining / target : -Infinity };
  }).sort((a, b) => a.group - b.group || (b.def - a.def) || a.i - b.i).map((x) => x.t);
}

/**
 * Plan 3.7. runs: [{ id, length, depth, acc?: [{ at: "start" | "end", width }] }]; types: the mix types (state rows);
 * counts: { [id]: target }; opts: { mode, placed, cache }. Deficit counters carry from run to run (opts.placed is copied).
 * → [{ runId, units: [{ type, from, to, width, accessible }], short, dropped }]
 */
export function fillRuns(runs, types, counts, opts = {}) {
  need(runs, "fillRuns", "runs"); need(types, "fillRuns", "types"); need(counts, "fillRuns", "counts");
  const mode = opts.mode === "hotel" ? "hotel" : "multifamily";
  const placed = { ...(opts.placed || {}) };
  const cache = opts.cache || new Map();
  const effCache = new Map();
  const out = [];
  for (const run of runs) {
    const dk = mode === "hotel" ? "h" : run.depth.toFixed(6);
    let eff = effCache.get(dk);
    if (!eff) { eff = effectiveTypes(types, run.depth, mode); effCache.set(dk, eff); }
    const acc = Array.isArray(run.acc) ? run.acc : [];
    const accW = acc.reduce((s, a) => s + a.width, 0);
    const L = run.length - accW;
    const ts = eff.types;
    if (!ts.length || L <= 0) { out.push({ runId: run.id, units: [], short: true, dropped: eff.dropped }); continue; }
    const { W, Wbay } = weightedWidth(ts);
    const n = slotsFor({ length: L }, ts, mode === "hotel" ? Wbay : W, cache);
    if (n === null) { out.push({ runId: run.id, units: [], short: true, dropped: eff.dropped }); continue; }
    const table = sumsTable(ts, n, cache);
    const chosen = [];
    let left = n, lo = 0, hi = 0;
    while (left > 0) {
      let pick = null;
      for (const t of deficitOrder(ts, counts, placed)) {
        const b = t.bays || 1;
        if (b > left) continue;
        if (canClose(table, left - b, L - lo - t.lo, L - hi - t.hi)) { pick = t; break; }
      }
      if (!pick) break;
      chosen.push(pick);
      left -= pick.bays || 1; lo += pick.lo; hi += pick.hi;
      placed[pick.id] = (placed[pick.id] || 0) + 1;
    }
    // widths (plan 3.7 item 6)
    const R = L - chosen.reduce((s, t) => s + t.w, 0);
    const room = chosen.reduce((s, t) => s + (R >= 0 ? t.hi - t.w : t.w - t.lo), 0);
    const widths = chosen.map((t) => {
      if (Math.abs(R) < 1e-12) return t.w;
      if (room < 1e-12) return t.w + R / chosen.length;
      return t.w + (R * (R >= 0 ? t.hi - t.w : t.w - t.lo)) / room;
    });
    const units = [];
    let s = 0;
    for (const a of acc.filter((x) => x.at === "start")) { units.push({ type: "accessible", from: s, to: s + a.width, width: a.width, accessible: true, bays: 1 }); s += a.width; }
    chosen.forEach((t, i) => { units.push({ type: t.id, from: s, to: s + widths[i], width: widths[i], accessible: false, bays: t.bays || 1, lo: t.lo, hi: t.hi }); s += widths[i]; });
    for (const a of acc.filter((x) => x.at === "end")) { units.push({ type: "accessible", from: s, to: s + a.width, width: a.width, accessible: true, bays: 1 }); s += a.width; }
    out.push({ runId: run.id, units, short: false, dropped: eff.dropped });
  }
  return out;
}

/* ======================================================================= level blocks */

function coreMove(core, corridor, plate, warnings) {
  const hit = mpArea(bool("int", [core], corridor));
  if (hit <= 1) return core;
  const [x0, y0, x1, y1] = bboxOf([core]);
  const cands = [];
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) if (i || j) cands.push([i * 25, j * 25]);
  cands.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[0] - b[0] || a[1] - b[1]);
  for (const [dx, dy] of cands) {
    const r = rectRing(x0 + dx, y0 + dy, x1 + dx, y1 + dy);
    if (mpArea(bool("diff", [r], plate)) > 0.01) continue;
    if (mpArea(bool("int", [r], corridor)) > 0.01) continue;
    warnings.push(warn("core-blocks-corridor", `The core blocks the corridor; it moved ${dx} ft east and ${dy} ft north to the nearest free spot on a 25 ft grid.`, { dx, dy }));
    return r;
  }
  warnings.push(warn("core-blocks-corridor", "The core blocks the corridor and no free spot was found on the 25 ft grid.", {}));
  return core;
}

const bandAtPoint = (bands, p) => bands.find((b) => { const s = dot(sub(p, b.fr.o), b.fr.u), t = dot(sub(p, b.fr.o), b.fr.n); return Math.abs(t) < 0.02 && s >= -0.01 && s <= b.s1 + 0.01; }) || null;

/* ======================================================================= the level */

function exposuresOf(ring, rings, rotation) {
  const r = ringArea(ring) < 0 ? ring.slice().reverse() : ring;
  const set = new Set();
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) continue;
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let on = false;
    for (const R of rings) { for (const e of R.edges) if (segDist(m, e.a, e.b) < 0.005 && segDist(a, e.a, e.b) < 0.005 && segDist(b, e.a, e.b) < 0.005) { on = true; break; } if (on) break; }
    if (!on) continue;
    const nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
    let bearing = (Math.atan2(nx, ny) * 180) / Math.PI - rotation;
    bearing = ((bearing % 360) + 360) % 360;
    const sec = bearing >= 315 - 1e-9 || bearing < 45 - 1e-9 ? "N" : bearing < 135 - 1e-9 ? "E" : bearing < 225 - 1e-9 ? "S" : "W";
    set.add(sec);
  }
  return ["N", "E", "S", "W"].filter((k) => set.has(k));
}

function cutLine(fr, ring, s) {
  let tmin = Infinity, tmax = -Infinity;
  for (const p of ring) {
    if (Math.abs(dot(sub(p, fr.o), fr.u) - s) > 0.002) continue;
    const t = dot(sub(p, fr.o), fr.n);
    tmin = Math.min(tmin, t); tmax = Math.max(tmax, t);
  }
  if (!(tmax > tmin)) return null;
  const a = at(fr, s, tmin), b = at(fr, s, tmax);
  return [[r3(a[0]), r3(a[1])], [r3(b[0]), r3(b[1])]];
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Plan 3.4 to 3.11 for one level. level: a levels.js level { index, plate, core, spines, seeds }; state: the plate state.
 * opts: { counters: { [type]: n } (deficit counters to start from), locks: [{ id, outer, type }],
 *         accessible: { perFloor (hotel keys on this level), typeA (multifamily flags on this level) },
 *         rotation (placement degrees) }
 */
export function fillLevel(level, state, { counters = null, locks = null, accessible = null, rotation = null } = {}) {
  need(level, "fillLevel", "level"); need(state, "fillLevel", "state");
  const plate = asMP(need(level.plate, "fillLevel", "level.plate"));
  if (!plate.length) throw new Error('fillLevel: the input "level.plate" has no ring.');
  const mode = modeOf(state), hotel = mode === "hotel";
  const ext = extWallOf(state);
  const rot = isNum(rotation) ? rotation : state.placement && isNum(state.placement.rotation) ? state.placement.rotation : 0;
  const warnings = [];
  const where = { level: level.index };

  // corridor, core, stairs
  const sp = spineFor(plate, level, state);
  for (const w of sp.warnings) warnings.push({ ...w, where });
  const { kind, spine, width } = sp;
  const clear = corridorPolygon(spine, width, plate);
  let core = sp.core ? sp.core.map((p) => [p[0], p[1]]) : null;
  if (core && kind !== "point") core = coreMove(core, clear, plate, warnings);
  const stairs = stairBlocks(kind, spine, plate, state, level.seeds);
  const stairSize = state.stairs && Array.isArray(state.stairs.size) ? state.stairs.size : [11, 22];

  // bands (the blocks known now only break ties between equal depths)
  const support = (Array.isArray(state.support) ? state.support : []).map((s, k) => {
    const outer = Array.isArray(s.outer) ? s.outer : Array.isArray(s.rect) && s.rect.length === 4 ? rectRing(...s.rect) : null;
    return outer ? { id: s.id || `B${k + 1}`, kind: s.kind || "storage", outer: rr3(outer) } : null;
  }).filter(Boolean);
  const lockList = (Array.isArray(locks) ? locks : Array.isArray(state.locks) && state.source !== "project" ? state.locks : [])
    .filter((l) => l && Array.isArray(l.outer) && l.outer.length >= 3).map((l, k) => ({ id: l.id || `L${k + 1}`, kind: "lock", type: l.type, outer: l.outer.map((p) => [p[0], p[1]]) }));

  const seedCabs0 = (Array.isArray(level.seeds) ? level.seeds : []).filter((s) => s && s.kind === "elevator" && Array.isArray(s.outer));
  const known = [...stairs, ...(core ? [{ outer: core }] : []), ...seedCabs0, ...support, ...lockList];
  const base = prepareBands(plate, clear, ext, known);

  // elevators and back-of-house
  const el = state.elevators || {};
  const cab = Array.isArray(el.size) && el.size.length === 2 ? el.size : [8, 10];
  const guestN = isNum(el.count) ? Math.max(0, Math.round(el.count)) : 2;
  const serviceN = isNum(el.service) ? Math.max(0, Math.round(el.service)) : hotel ? 1 : 0;
  const elevators = [], boh = [];
  const seedCabs = (Array.isArray(level.seeds) ? level.seeds : []).filter((s) => s && s.kind === "elevator" && Array.isArray(s.outer));
  const firstBand = base.bands[0] || null;
  if (seedCabs.length) seedCabs.forEach((s, k) => elevators.push({ id: `E${k + 1}`, outer: rr3(s.outer), service: false }));
  else if (core) {
    const lay = coreLayout(core, stairSize, cab, guestN + serviceN, { withStairs: kind === "point" });
    if (!lay.fits) warnings.push(warn("elevators-do-not-fit", "The elevator cabs do not fit inside the core.", where));
    lay.cabs.forEach((r, k) => elevators.push({ id: k < guestN ? `E${k + 1}` : `SE${k - guestN + 1}`, outer: rr3(r), service: k >= guestN }));
  } else if (firstBand && guestN + serviceN > 0) {
    const mid = firstBand.s1 / 2, total = guestN * cab[0];
    for (let k = 0; k < guestN; k++) elevators.push({ id: `E${k + 1}`, outer: rr3(frameRect(firstBand.fr, mid - total / 2 + k * cab[0], mid - total / 2 + (k + 1) * cab[0], 0, cab[1])), service: false });
    if (serviceN > 0 || (hotel && state.hotelBoh && state.hotelBoh.on !== false)) {
      const across = [firstBand.fr.o[0] + firstBand.fr.u[0] * mid - firstBand.fr.n[0] * width, firstBand.fr.o[1] + firstBand.fr.u[1] * mid - firstBand.fr.n[1] * width];
      const B = bandAtPoint(base.bands.filter((b) => b !== firstBand), across);
      const host = B || firstBand;
      const sm = B ? dot(sub(across, B.fr.o), B.fr.u) : mid + total / 2 + (serviceN * cab[0] + (hotel ? 16 : 0)) / 2;
      const items = [];
      for (let k = 0; k < serviceN; k++) items.push({ len: cab[0], kind: "service" });
      if (hotel && state.hotelBoh && state.hotelBoh.on !== false) items.push({ len: 8, kind: "linen" }, { len: 8, kind: "icedata" });
      const tot = items.reduce((s, i) => s + i.len, 0);
      let s = sm - tot / 2, sk = 0;
      for (const it of items) {
        if (it.kind === "service") elevators.push({ id: `SE${++sk}`, outer: rr3(frameRect(host.fr, s, s + it.len, 0, cab[1])), service: true });
        else if (it.kind === "linen") boh.push({ id: "BOH-linen", kind: "linen", outer: rr3(frameRect(host.fr, s, s + 8, 0, 14)) });
        else { boh.push({ id: "BOH-ice", kind: "ice", outer: rr3(frameRect(host.fr, s, s + 8, 0, 6)) }, { id: "BOH-data", kind: "data", outer: rr3(frameRect(host.fr, s, s + 8, 6, 12)) }); }
        s += it.len;
      }
    }
  }
  if (core && hotel && state.hotelBoh && state.hotelBoh.on !== false && !seedCabs.length) {
    let best = null;
    for (const b of base.bands) {
      if (mpArea(bool("int", b.band, [core])) <= 1) continue;
      const [c0, c1] = projRange(b.fr, core);
      for (const side of [1, -1]) {
        const free = side > 0 ? b.s1 - c1 : c0;
        if (!best || free > best.free + 1e-9) best = { b, side, free, c0, c1 };
      }
    }
    if (best) {
      const { b, side, c0, c1 } = best;
      const s0 = side > 0 ? c1 : c0 - 16;
      const lin = side > 0 ? [s0, s0 + 8] : [s0 + 8, s0 + 16], ice = side > 0 ? [s0 + 8, s0 + 16] : [s0, s0 + 8];
      boh.push({ id: "BOH-linen", kind: "linen", outer: rr3(frameRect(b.fr, lin[0], lin[1], 0, 14)) },
        { id: "BOH-ice", kind: "ice", outer: rr3(frameRect(b.fr, ice[0], ice[1], 0, 6)) },
        { id: "BOH-data", kind: "data", outer: rr3(frameRect(b.fr, ice[0], ice[1], 6, 12)) });
    } else warnings.push(warn("boh-no-place", "The hotel back-of-house found no run beside the core; add it as support blocks.", where));
  }
  const blocks = [
    ...stairs.map((s) => ({ id: s.id, kind: "stair", outer: s.outer })),
    ...(core && kind !== "point" ? [{ id: "core", kind: "core", outer: core }] : core ? [{ id: "core", kind: "core", outer: core }] : []),
    ...elevators.map((e) => ({ id: e.id, kind: "elevator", outer: e.outer })),
    ...support, ...boh, ...lockList,
  ];

  // runs, corners, pockets, remainders
  const rc = runsAndCorners(null, plate, clear, blocks, state, base);
  const { runs, corners, pockets, rings } = rc;
  const types = mixTypes(state);

  // level depth and targets
  const runLen = runs.reduce((s, r) => s + r.length, 0);
  const depth = runLen > 0 ? runs.reduce((s, r) => s + r.length * r.depth, 0) / runLen : 0;
  let eff = depth > 0 || hotel ? effectiveTypes(types, depth > 0 ? depth : 1, mode) : { types: [], dropped: [] };
  for (const d of eff.dropped) warnings.push(warn("type-does-not-fit", `${d.name || d.id} does not fit this depth (${r1(depth)} ft): its width range ${r1(d.lo)} to ${r1(d.hi)} ft is empty.`, { ...where, type: d.id, lo: d.lo, hi: d.hi }));
  const cornerId = (state.mix && state.mix.cornerType) || "2br";

  // accessible keys (hotel): the run ends nearest the guest elevators
  const accW = hotel ? (state.mix && Array.isArray(state.mix.accessibleWidth) && isNum(state.mix.accessibleWidth[2]) ? state.mix.accessibleWidth[2] : 15.5) : 0;
  const guest = elevators.filter((e) => !e.service);
  const elevRef = guest.length ? centroidOf(guest.map((e) => ({ outer: e.outer, holes: [] }))) : elevators.length ? centroidOf(elevators.map((e) => ({ outer: e.outer, holes: [] }))) : core ? centroidOf([core]) : centroidOf(plate);
  const accByRun = new Map();
  if (hotel) {
    const k = accessible && isNum(accessible.perFloor) ? Math.max(0, Math.round(accessible.perFloor)) : isNum(state.accessible && state.accessible.perFloor) ? state.accessible.perFloor : 0;
    const ends = [];
    runs.forEach((r, i) => {
      ends.push({ r, i, at: "start", d: Math.hypot(r.start[0] - elevRef[0], r.start[1] - elevRef[1]), o: 0 });
      ends.push({ r, i, at: "end", d: Math.hypot(r.end[0] - elevRef[0], r.end[1] - elevRef[1]), o: 1 });
    });
    ends.sort((a, b) => (Math.abs(a.d - b.d) > 1e-6 ? a.d - b.d : a.i - b.i || a.o - b.o));
    let left = k;
    for (const e of ends) {
      if (left <= 0) break;
      const list = accByRun.get(e.r.id) || [];
      const used = list.reduce((s, a) => s + a.width, 0);
      if (e.r.length - used < accW - 1e-9) continue;
      list.push({ at: e.at, width: accW });
      accByRun.set(e.r.id, list);
      left--;
    }
    if (left > 0) warnings.push(warn("accessible-short", `${left} accessible key(s) found no run end.`, where));
  }
  const accTotal = [...accByRun.values()].flat().reduce((s, a) => s + a.width, 0);

  const cornerTypes = corners.map(() => cornerId);
  const lockTypes = lockList.map((l) => l.type).filter((t) => t !== undefined);
  let counts = {};
  if (eff.types.length) counts = countsFor(Math.max(0, runLen - accTotal), eff.types, [...cornerTypes, ...lockTypes]).counts;
  const placed0 = { ...(counters || {}) };
  for (const t of [...cornerTypes, ...lockTypes]) placed0[t] = (placed0[t] || 0) + 1;

  const fills = fillRuns(runs.map((r) => ({ id: r.id, length: r.length, depth: r.depth, acc: accByRun.get(r.id) || [] })), types, counts, { mode, placed: placed0 });

  // unit polygons
  const units = [];
  const remainders = rc.remainders.map((r) => ({ outer: r.outer, why: r.why }));
  const extra = [];               // gross strips to turn into remainders: { run|band, a, b, why }
  for (const res of rc.reserved) extra.push({ fr: res.band.fr, a: res.a, b: res.b, maxT: res.band.maxT, bandId: res.band.id, why: "block" });
  fills.forEach((f, i) => {
    const run = runs[i];
    const R = rings[run.ringIndex];
    if (f.short) {
      if (run.length >= 1) warnings.push(warn("run-too-short", `Run ${run.id} (${r1(run.length)} ft at ${r1(run.depth)} ft deep) fits no set of units; it becomes support.`, { ...where, run: run.id, length: run.length }));
      extra.push({ fr: run.fr, a: run.a, b: run.b, maxT: run.maxT, bandId: run.bandId, why: "run-too-short" });
      run.slots = 0;
      return;
    }
    run.slots = f.units.reduce((s, u) => s + u.bays, 0);
    for (const u of f.units) {
      const sa = run.a + u.from, sb = run.a + u.to;
      const poly = largest(bool("int", run.band, strip(run.fr, sa, sb)));
      if (!poly) continue;
      const outer = poly.outer;
      const d1 = cutLine(run.fr, outer, sa), d2 = cutLine(run.fr, outer, sb);
      const door = at(run.fr, (sa + sb) / 2, 0);
      const fa = d1 ? d1[1] : at(run.fr, sa, run.depth), fb = d2 ? d2[1] : at(run.fr, sb, run.depth);
      const from = ringParam(R, fa);
      let to = ringParam(R, fb);
      if (to < from - 1e-6) to += R.perimeter;
      units.push({
        type: u.type, outer, area: r1(Math.abs(ringArea(outer))), width: Math.round(u.width * 1000) / 1000,
        lo: u.lo, hi: u.hi, accessible: !!u.accessible, accessibleKind: u.accessible ? "key" : undefined, bays: u.bays,
        bay: { from: r3(from), to: r3(to) }, ring: R.id, demising: [d1, d2].filter(Boolean), door: [r3(door[0]), r3(door[1])],
        runId: run.id, key: [run.ringIndex, from],
      });
    }
  });
  for (const c of corners) {
    const R = rings[c.ring];
    const pV = ringParam(R, c.V || c.at);
    const B1 = rc.bands.find((b) => b.id === c.B1), B2 = rc.bands.find((b) => b.id === c.B2);
    const dm = [];
    if (B1) { const l = cutLine(B1.fr, c.outer, B1.s1 - c.la); if (l) dm.push(l); }
    if (B2) { const l = cutLine(B2.fr, c.outer, c.lb); if (l) dm.push(l); }
    const from = ((pV - c.legs[0]) % R.perimeter + R.perimeter) % R.perimeter;
    const door = B2 ? at(B2.fr, c.lb / 2, 0) : B1 ? at(B1.fr, B1.s1 - c.la / 2, 0) : centroidOf([c.outer]);
    units.push({
      type: cornerId, outer: c.outer, area: r1(Math.abs(ringArea(c.outer))), width: null, accessible: false, bays: 1,
      bay: { from: r3(from), to: r3(from + c.legs[0] + c.legs[1]) }, ring: R.id, demising: dm, door: [r3(door[0]), r3(door[1])],
      runId: null, wrap: true, e: c.e, key: [c.ring, pV - 1e-6],
    });
  }
  for (const l of lockList) {
    const c = centroidOf([l.outer]);
    let best = { ri: 0, s: 0, d: Infinity };
    rings.forEach((R, ri) => { for (const e of R.edges) { const d = segDist(c, e.a, e.b); if (d < best.d) best = { ri, s: ringParam(R, c), d }; } });
    const R = rings[best.ri] || { id: 0 };
    units.push({ type: l.type, outer: rr3(l.outer), area: r1(Math.abs(ringArea(l.outer))), width: null, accessible: false, bays: 1, bay: null, ring: R.id, demising: [], door: null, runId: null, locked: true, lockId: l.id, key: [best.ri, best.s] });
  }
  units.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);

  // gross remainders of the reserved stretches
  const blk = blockMP(blocks);
  const otherBands = (id) => rc.bands.filter((b) => b.id !== id).flatMap((b) => b.band);
  const fixed = [...units.map((u) => ({ outer: u.outer, holes: [] })), ...pockets, ...remainders.map((r) => ({ outer: r.outer, holes: [] }))];
  let taken = fixed.length ? bool("union", fixed, []) : [];
  for (const x of extra) {
    let g = bool("int", strip(x.fr, x.a, x.b, 0, x.maxT + ext + 1), plate);
    const minus = [...asMP(clear), ...blk, ...otherBands(x.bandId), ...taken];
    if (minus.length) g = bool("diff", g, minus);
    for (const pc of g) if (Math.abs(ringArea(pc.outer)) > 0.25) { remainders.push({ outer: pc.outer, why: x.why }); taken = bool("union", [...taken, pc], []); }
  }

  // exposures, corners, ids
  units.forEach((u, k) => {
    u.exposures = exposuresOf(u.outer, rings, rot);
    u.corner = u.exposures.length >= 2;
    u.id = `${level.index}-${pad2(k + 1)}`;
    u.outer = rr3(u.outer);
    delete u.key;
    if (u.accessibleKind === undefined) delete u.accessibleKind;
    if (u.lo === undefined) { delete u.lo; delete u.hi; }
  });
  // Type A flags (multifamily)
  if (!hotel && accessible && isNum(accessible.typeA) && accessible.typeA > 0) {
    const order = units.map((u, k) => ({ k, d: u.door ? Math.hypot(u.door[0] - elevRef[0], u.door[1] - elevRef[1]) : Infinity })).sort((a, b) => a.d - b.d || a.k - b.k);
    for (const { k } of order.slice(0, accessible.typeA)) { units[k].accessible = true; units[k].accessibleKind = "typeA"; }
  }

  // placed against target, mix misses
  const placedCount = {};
  for (const u of units) if (u.type !== "accessible") placedCount[u.type] = (placedCount[u.type] || 0) + 1;
  for (const t of eff.types) {
    const diff = (placedCount[t.id] || 0) - (counts[t.id] || 0);
    if (Math.abs(diff) > 1) warnings.push(warn("mix-miss", `${t.name || t.id}: ${placedCount[t.id] || 0} placed against a target of ${counts[t.id] || 0}.`, { ...where, type: t.id, diff }));
  }

  const support_ = [
    ...support, ...boh,
    ...pockets.map((p, k) => ({ id: `P${k + 1}`, kind: "pocket", outer: rr3(p.outer) })),
    ...remainders.map((p, k) => ({ id: `X${k + 1}`, kind: "remainder", outer: rr3(p.outer), why: p.why })),
  ];
  const corridor = blocks.length ? bool("diff", clear, blk) : clear;
  const graph = corridorGraph(spine, stairs, units, { corridor, width });
  const linen = boh.concat(support).filter((b) => b.kind === "linen");
  let reach = null;
  if (hotel && linen.length) {
    const maxFt = isNum(state.housekeepingReach) ? state.housekeepingReach : 150;
    const from = centroidOf([linen[0].outer]);
    const rr = graph.reach(from, maxFt);
    reach = { from: [r3(from[0]), r3(from[1])], maxFt, keys: rr.count, of: units.length };
  }

  return {
    index: level.index, kind, width, spine, plate, inset: base.inset.map((pc) => ({ outer: rr3(pc.outer), holes: pc.holes.map(rr3) })),
    corridor, corridorClear: clear, core: core ? rr3(core) : null,
    stairs, elevators, support: support_, units,
    runs: runs.map((r) => ({ id: r.id, ring: r.ring, edge: r.edge, from: r3(r.from), to: r3(r.to), length: Math.round(r.length * 1000) / 1000, depth: Math.round(r.depth * 1000) / 1000, slots: r.slots || 0, start: [r3(r.start[0]), r3(r.start[1])], end: [r3(r.end[0]), r3(r.end[1])] })),
    corners: corners.map((c) => ({ ring: rings[c.ring].id, at: c.at, e: c.e, legs: c.legs, eTarget: c.eTarget, type: cornerId, outer: rr3(c.outer) })),
    counts, placed: placedCount, dropped: eff.dropped.map((d) => ({ id: d.id, lo: d.lo, hi: d.hi })), depth: Math.round(depth * 1000) / 1000,
    graph: { lengthFt: graph.lengthFt, stairPathFt: graph.stairPathFt, deadEnds: graph.deadEnds, reach },
    warnings,
  };
}

/* ======================================================================= the building */

function massingSection(project) {
  if (!project || typeof project !== "object") return null;
  if (project.sections && project.sections.massing) return project.sections.massing;
  return project.derived ? project : null;
}

/**
 * Plan 3.1 and 3.10 for the whole building. → { source, groups: [{ id, key, label, first, floors, levels, fill }],
 *   levels: [{ index, name, zone, z, ftf, program }], placement, warnings, notes, massingUpdatedAt }
 */
export function buildPlates(state, { project = null } = {}) {
  need(state, "buildPlates", "state");
  const src = state.source === "project" ? "project" : "drawn";
  const sec = src === "project" ? massingSection(project) : null;
  if (src === "project" && !sec) throw new Error('buildPlates: missing input "project" (the source is "project").');
  const levels = levelsFrom(state, src === "project" ? project : null);
  const groups = groupLevels(levels);
  const warnings = [], notes = [];
  if (!groups.length) warnings.push(warn("no-levels", "The massing has no level to fill.", {}));
  const placement = sec && sec.placement ? { ...sec.placement } : state.placement ? { ...state.placement } : { x: 0, y: 0, rotation: 0, baseZ: 0 };
  const rotation = isNum(placement.rotation) ? placement.rotation : 0;
  const hotel = modeOf(state) === "hotel";
  const groupState = (g) => (state.levels && state.levels.groups && state.levels.groups[g.id]) || {};
  const lockFor = (g) => (src === "project" ? groupState(g).locks || [] : state.locks || []);
  const levelOf = (g) => levels.find((l) => l.index === g.first);
  const filled = groups.filter((g) => groupState(g).filled !== false);
  const floorsTotal = filled.reduce((s, g) => s + g.floors, 0);

  const run = (acc) => filled.map((g) => ({ g, fill: fillLevel(levelOf(g), state, { locks: lockFor(g), accessible: acc(g), rotation }) }));
  let out;
  if (hotel) {
    let perFloor = isNum(state.accessible && state.accessible.perFloor) ? state.accessible.perFloor : null;
    if (perFloor === null) {
      const first = run(() => ({ perFloor: 0 }));
      const keys = first.reduce((s, x) => s + x.fill.units.length * x.g.floors, 0);
      const req = requiredAccessible(state, keys);
      perFloor = floorsTotal ? Math.ceil(req.keys / floorsTotal) : 0;
      notes.push(`Accessible keys: ${req.keys} for about ${keys} keys (table row ${req.row ? req.row.join(", ") : "none"}), ${perFloor} per floor. Caution: a seed for an editable table; verify against the adopted code.`);
    }
    out = run(() => ({ perFloor }));
  } else {
    const first = run(() => null);
    const unitsTotal = first.reduce((s, x) => s + x.fill.units.length * x.g.floors, 0);
    const req = requiredAccessible(state, unitsTotal);
    const per = floorsTotal && req.typeA ? Math.ceil(req.typeA / floorsTotal) : 0;
    if (per) {
      notes.push(`Type A units: ${req.typeA} for ${unitsTotal} units, ${per} per floor nearest the elevators. Caution: a seed for an editable table; verify against the adopted code.`);
      out = run(() => ({ typeA: per }));
    } else out = first;
  }
  const byId = new Map(out.map((x) => [x.g.id, x.fill]));
  return {
    source: src,
    groups: groups.filter((g) => byId.has(g.id)).map((g) => ({ id: g.id, key: g.key, label: g.label, first: g.first, floors: g.floors, levels: g.levels.slice(), fill: byId.get(g.id) })),
    levels: levels.map((l) => ({ index: l.index, name: l.name, zone: l.zone, z: l.z, ftf: l.ftf, program: l.program })),
    placement,
    warnings,
    notes,
    massingUpdatedAt: sec && sec.updatedAt ? sec.updatedAt : null,
  };
}
