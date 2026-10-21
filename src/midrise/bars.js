/* ==========================================================================
   bars.js — bar geometry: legs, rings, spines, levels (Mid-Rise Generator)

   Contract: docs/mid-rise-generator-technical-plan.md sections 3.1 to 3.3
   and 4. Pure functions only: no DOM, no Three.js, no hidden state, no
   mutation of inputs. No Clipper here: rings are plain rectangles, and the
   union per level belongs to assemble.js.

   Units: feet, square feet, degrees. Plan coordinates (x, y): north = +y.
   A bar starts at (x, y) and runs at `angle` (counter-clockwise from east).
   Coordinates round to 0.001 ft.

   Rule choices where the plan leaves room:
   - Bends: only 0 < at < length counts, sorted by `at`, at most 2. |deg| is
     clamped to 150 (plan section 11). A bend with deg 0 makes a straight
     split with no extension.
   - barLevels returns the BAR floors only. Podium and deck levels belong to
     buildingLevels. Bar floor k of a bar has index P + k (P = podium levels).
   - Level program in buildingLevels for a bar floor = the program of the
     first bar (in state.bars order) that occupies the level.
   - Extra exports for the sibling modules (ringArea, multiPolyArea,
     clipAreaConvex) so units, parking and metrics need no Clipper.
   ========================================================================== */

export const SCALE = 1000;

const DEG = Math.PI / 180;
const MAX_BEND_DEG = 150;

const r3 = (v) => Math.round(v * 1000) / 1000 + 0;   // + 0 turns -0 into 0
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* ---------------------------------------------------------------- areas */

/** Signed shoelace area of one ring (positive when counter-clockwise). */
export function ringArea(ring) {
  let a = 0;
  const n = ring ? ring.length : 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[i + 1 === n ? 0 : i + 1];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Area of a MultiPoly: outers minus holes. */
export function multiPolyArea(mp) {
  let a = 0;
  for (const p of mp || []) {
    a += Math.abs(ringArea(p.outer));
    for (const h of p.holes || []) a -= Math.abs(ringArea(h));
  }
  return a;
}

function clipRing(subject, clip) {
  let out = subject.slice();
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[i + 1 === clip.length ? 0 : i + 1];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[j + 1 === input.length ? 0 : j + 1];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
}

/** Area of a MultiPoly inside a CONVEX ring (Sutherland–Hodgman). Not a union:
    use it for overlaps with rectangles, strips and half-planes only. */
export function clipAreaConvex(mp, convexRing) {
  need(Array.isArray(convexRing) && convexRing.length >= 3, "clipAreaConvex", "convexRing");
  const clip = ringArea(convexRing) < 0 ? convexRing.slice().reverse() : convexRing;
  let a = 0;
  for (const p of mp || []) {
    a += Math.abs(ringArea(clipRing(p.outer, clip)));
    for (const h of p.holes || []) a -= Math.abs(ringArea(clipRing(h, clip)));
  }
  return a;
}

/* ----------------------------------------------------------------- legs */

function validBends(bar) {
  const list = Array.isArray(bar.bends) ? bar.bends : [];
  return list
    .filter((b) => b && isNum(b.at) && isNum(b.deg) && b.at > 0 && b.at < bar.length)
    .map((b) => ({ at: b.at, deg: Math.max(-MAX_BEND_DEG, Math.min(MAX_BEND_DEG, b.deg)) }))
    .sort((p, q) => p.at - q.at)
    .slice(0, 2);
}

/** Plan 3.1. A bar with no bends is one leg. Each leg: { barId, legIndex, x0, y0,
    angle, length, depth, ext0, ext1 }. `length` is the centerline length of the
    leg; ext0 and ext1 are the miter extensions past the bend points. */
export function legsOf(bar) {
  need(bar && typeof bar === "object", "legsOf", "bar");
  need(isNum(bar.x) && isNum(bar.y), "legsOf", "bar.x and bar.y");
  need(isNum(bar.length) && bar.length > 0, "legsOf", "bar.length");
  need(isNum(bar.depth) && bar.depth > 0, "legsOf", "bar.depth");
  const bends = validBends(bar);
  const base = isNum(bar.angle) ? bar.angle : 0;
  const cuts = [0, ...bends.map((b) => b.at), bar.length];
  const legs = [];
  let x = bar.x, y = bar.y, ang = base;
  for (let i = 0; i < cuts.length - 1; i++) {
    if (i > 0) ang += bends[i - 1].deg;
    const len = cuts[i + 1] - cuts[i];
    const ext0 = i > 0 ? (bar.depth / 2) * Math.tan((Math.abs(bends[i - 1].deg) / 2) * DEG) : 0;
    const ext1 = i < bends.length ? (bar.depth / 2) * Math.tan((Math.abs(bends[i].deg) / 2) * DEG) : 0;
    legs.push({
      barId: bar.id, legIndex: i,
      x0: r3(x), y0: r3(y), angle: ang, length: r3(len), depth: bar.depth,
      ext0: r3(ext0), ext1: r3(ext1),
    });
    x += len * Math.cos(ang * DEG);
    y += len * Math.sin(ang * DEG);
  }
  return legs;
}

/** Plan 3.2. The leg rectangle, counter-clockwise, extensions included. */
export function legRing(leg) {
  need(leg && isNum(leg.x0) && isNum(leg.y0) && isNum(leg.length) && isNum(leg.depth), "legRing", "leg");
  const a = (leg.angle || 0) * DEG;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;                       // left normal
  const h = leg.depth / 2;
  const sx = leg.x0 - (leg.ext0 || 0) * dx, sy = leg.y0 - (leg.ext0 || 0) * dy;
  const L = leg.length + (leg.ext1 || 0);
  const ex = leg.x0 + L * dx, ey = leg.y0 + L * dy;
  return [
    [r3(sx - nx * h), r3(sy - ny * h)],
    [r3(ex - nx * h), r3(ey - ny * h)],
    [r3(ex + nx * h), r3(ey + ny * h)],
    [r3(sx + nx * h), r3(sy + ny * h)],
  ];
}

/** Plan 3.2. Corridor centerline through the legs. A single-loaded bar shifts by
    depth/2 − corridorWidth/2 to the side opposite `unitSide`. */
export function barSpine(bar, rules) {
  const legs = legsOf(bar);
  const exact = [];   // unrounded vertices: start, bend points, end
  {
    let x = bar.x, y = bar.y;
    exact.push([x, y]);
    for (const l of legs) {
      x += l.length * Math.cos((l.angle || 0) * DEG);
      y += l.length * Math.sin((l.angle || 0) * DEG);
      exact.push([x, y]);
    }
  }
  if (bar.corridor !== "single") return exact.map((p) => [r3(p[0]), r3(p[1])]);

  need(rules && isNum(rules.corridorWidth), "barSpine", "rules.corridorWidth");
  const shift = bar.depth / 2 - rules.corridorWidth / 2;
  // corridor side = opposite the unit side; unitSide "left" puts the corridor on the right
  const sign = bar.unitSide === "right" ? 1 : -1;      // +1 = shift to the left normal
  const norms = legs.map((l) => {
    const a = (l.angle || 0) * DEG;
    return [-Math.sin(a) * sign, Math.cos(a) * sign];
  });
  const out = exact.map((p, i) => {
    let ox, oy;
    if (i === 0) { ox = norms[0][0]; oy = norms[0][1]; }
    else if (i === exact.length - 1) { ox = norms[i - 1][0]; oy = norms[i - 1][1]; }
    else {
      const a = norms[i - 1], b = norms[i];
      const k = 1 + (a[0] * b[0] + a[1] * b[1]);
      ox = (a[0] + b[0]) / k; oy = (a[1] + b[1]) / k;
    }
    return [r3(p[0] + ox * shift), r3(p[1] + oy * shift)];
  });
  return out;
}

/* --------------------------------------------------------------- levels */

function podiumInfo(state, fn) {
  need(state && typeof state === "object", fn, "state");
  const pod = state.podium;
  const on = !!(pod && pod.on && Array.isArray(pod.levels) && pod.levels.length);
  const levels = on ? pod.levels : [];
  let z = 0;
  const out = levels.map((lv, i) => {
    need(isNum(lv.ftf), fn, `state.podium.levels[${i}].ftf`);
    const rec = { index: i + 1, zone: "podium", z: r3(z), ftf: lv.ftf, program: lv.program || "parking" };
    z += lv.ftf;
    return rec;
  });
  return { P: out.length, top: z, levels: out };
}

/** Plan 3.3. The BAR floors this bar occupies: [{ index, z, ftf, program }]. */
export function barLevels(bar, state) {
  need(bar && typeof bar === "object", "barLevels", "bar");
  need(state && state.floors && isNum(state.floors.groundFtf) && isNum(state.floors.ftf), "barLevels", "state.floors");
  const { P, top } = podiumInfo(state, "barLevels");
  const g = state.floors.groundFtf, t = state.floors.ftf;
  const n = Math.max(0, Math.floor(isNum(bar.floors) ? bar.floors : 0));
  const out = [];
  for (let k = 1; k <= n; k++) {
    out.push({
      index: P + k,
      z: r3(top + (k === 1 ? 0 : g + (k - 2) * t)),
      ftf: k === 1 ? g : t,
      program: k === 1 ? (bar.groundProgram || bar.program) : bar.program,
    });
  }
  return out;
}

/** Plan 3.3. Podium levels, bar levels, then deck levels, without plates:
    [{ index, zone, z, ftf, program }]. */
export function buildingLevels(state) {
  need(state && state.floors && isNum(state.floors.groundFtf) && isNum(state.floors.ftf), "buildingLevels", "state.floors");
  const bars = Array.isArray(state.bars) ? state.bars : [];
  const pod = podiumInfo(state, "buildingLevels");
  const out = pod.levels.map((l) => ({ ...l }));
  const perBar = bars.map((b) => barLevels(b, state));
  const maxF = perBar.reduce((m, l) => Math.max(m, l.length), 0);
  for (let k = 1; k <= maxF; k++) {
    const idx = pod.P + k;
    let rec = null;
    for (const lv of perBar) {
      const hit = lv.find((l) => l.index === idx);
      if (hit) { rec = hit; break; }
    }
    out.push({ index: idx, zone: "bar", z: rec.z, ftf: rec.ftf, program: rec.program });
  }
  const deck = state.deck;
  if (deck && deck.on) {
    need(isNum(deck.levels) && isNum(deck.ftf), "buildingLevels", "state.deck.levels and state.deck.ftf");
    const n = Math.max(0, Math.floor(deck.levels));
    for (let i = 0; i < n; i++) {
      out.push({ index: pod.P + maxF + i + 1, zone: "deck", z: r3(pod.top + i * deck.ftf), ftf: deck.ftf, program: "parking" });
    }
  }
  return out;
}
