/* ==========================================================================
   ramps.js — Parking Deck: ramp slopes, outlines, and footprints

   Contract: docs/parking-deck-technical-plan.md sections 3.4 and 4.
   Pure ES module. No DOM, no Three.js, no Clipper, no hidden state, no
   mutation of inputs. Units: feet; slopes are fractions.

   Coordinates are in the LAYOUT frame (plan section 2): x along the run,
   y across the bays, origin at the southwest corner of the footprint's
   bounding rectangle. The derived writer maps them back to the local frame.

   Rule choices where the plan leaves room:
   - A ramp "leaves" level i for levels 1 … count − 1. The top level has no
     ramp. A one-level deck has no ramps.
   - Helix and sloped bays carry no transitions: the turn zones are flat and
     the bay itself is the ramped length R.
   - Single helix: bay b of level i rises from z_i + (b − 1)·h to z_i + b·h;
     odd bays climb east, even bays climb west. Double helix: every bay
     rises z_i → z_i + ftf_i (odd east, even west). Sloped floor: only bay
     `slopedBay` (0-based, from the south) rises, climbing east.
   - Speed ramp position: `speed.x`, `speed.y` are the southwest corner of
     its plan footprint. Straight: footprint x [x, x + length + 2T],
     y [y, y + width], climbing east. Circular: the circle of radius
     insideRadius + width centered at (x + R, y + R); one turn per level.
   - Split-level end ramps sit in the west and east end zones
     (t = splitLength + 2T) across the bays; west climbs west, east climbs
     east. Their footprint is the end-zone rectangle (it costs no stalls:
     no stalls lie in an end zone).
   - Circular footprint ring: 64 vertices on the circle (inscribed). The
     `segmentsRing` of circularRamp has `segments` vertices on the circle.
   ========================================================================== */

const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
const FOOTPRINT_SEGMENTS = 64;
const ARC_SAMPLES = 96;
const EPS = 1e-9;

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

function transitionOf(state) {
  const t = (state && state.ramp && state.ramp.transition) || {};
  return { length: Math.max(0, num(t.length, 10)), slopeFactor: Math.max(0, num(t.slopeFactor, 0.5)) };
}

/** Plan 3.4: h = s·L + 2·(f·s)·T  →  s = h ÷ (L + 2·f·T). transition may be null. */
export function rampSlope(rise, length, transition) {
  need(isNum(rise), "rampSlope", "rise");
  need(isNum(length) && length >= 0, "rampSlope", "length");
  const T = transition && isNum(transition.length) ? Math.max(0, transition.length) : 0;
  const f = transition && isNum(transition.slopeFactor) ? Math.max(0, transition.slopeFactor) : 0.5;
  const den = length + 2 * f * T;
  return den > EPS ? rise / den : Infinity;
}

/** Plan 1.2 change 4: the split-level end zone = splitLength + 2 × transition.length. */
export function splitEndZone(state) {
  need(state && typeof state === "object", "splitEndZone", "state");
  const ramp = state.ramp || {};
  return r3(Math.max(0, num(ramp.splitLength, 36)) + 2 * transitionOf(state).length);
}

/** Plan 3.4. A circular ramp centered on the origin.
    → { length, radius, arc, segmentsRing, centerline }
    length = 2π × (insideRadius + width ÷ 2) per turn; arc = the true centerline arc
    sampled at 96 pieces (97 points, open, the last repeats the first position);
    centerline = the same arc as `segments` straight pieces (segments + 1 points);
    segmentsRing = the plan footprint (radius insideRadius + width) as `segments` vertices, CCW. */
export function circularRamp(insideRadius, width, segments) {
  need(isNum(insideRadius) && insideRadius >= 0, "circularRamp", "insideRadius");
  need(isNum(width) && width > 0, "circularRamp", "width");
  const n = Math.max(3, Math.round(num(segments, 12)));
  const rc = insideRadius + width / 2;
  const R = insideRadius + width;
  const pt = (r, a) => [r3(r * Math.cos(a)), r3(r * Math.sin(a))];
  const arc = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) arc.push(pt(rc, (2 * Math.PI * i) / ARC_SAMPLES));
  const centerline = [];
  for (let i = 0; i <= n; i++) centerline.push(pt(rc, (2 * Math.PI * i) / n));
  const segmentsRing = [];
  for (let i = 0; i < n; i++) segmentsRing.push(pt(R, (2 * Math.PI * i) / n));
  return { length: r3(2 * Math.PI * rc), radius: r3(rc), arc, centerline, segmentsRing };
}

/** The speed ramp's plan footprint in the layout frame, or null when the ramp is not a
    speed ramp. → { shape: "straight" | "circular", ring: Ring (CCW), box: [x0, y0, x1, y1] } */
export function speedRampFootprint(state) {
  need(state && typeof state === "object", "speedRampFootprint", "state");
  const ramp = state.ramp || {};
  if (ramp.type !== "speed") return null;
  const sp = ramp.speed || {};
  const x = num(sp.x, 0), y = num(sp.y, 0), w = Math.max(0, num(sp.width, 24));
  if (sp.shape === "circular") {
    const R = Math.max(0, num(sp.insideRadius, 30)) + w;
    const cx = x + R, cy = y + R;
    const ring = [];
    for (let i = 0; i < FOOTPRINT_SEGMENTS; i++) {
      const a = (2 * Math.PI * i) / FOOTPRINT_SEGMENTS;
      ring.push([r3(cx + R * Math.cos(a)), r3(cy + R * Math.sin(a))]);
    }
    return { shape: "circular", ring, box: [r3(x), r3(y), r3(x + 2 * R), r3(y + 2 * R)] };
  }
  const T = transitionOf(state).length;
  const L = Math.max(0, num(sp.length, 82)) + 2 * T;
  const x1 = r3(x + L), y1 = r3(y + w);
  return { shape: "straight", ring: [[r3(x), r3(y)], [x1, r3(y)], [x1, y1], [r3(x), y1]], box: [r3(x), r3(y), x1, y1] };
}

/* ------------------------------------------------------------ outlines */

/** A sloped rectangle x [x0, x1] × y [y0, y1] rising from zLo to zHi toward +x (east)
    or −x (west). Four corners, CCW in plan. */
function slopedRect(x0, x1, y0, y1, zLo, zHi, east) {
  const zw = east ? zLo : zHi, ze = east ? zHi : zLo;
  return [[r3(x0), r3(y0), r3(zw)], [r3(x1), r3(y0), r3(ze)], [r3(x1), r3(y1), r3(ze)], [r3(x0), r3(y1), r3(zw)]];
}

/** A straight ramp with transitions: profile breakpoints along x from xa (z0) to xb (z0 + h),
    climbing toward xb. South edge then north edge, CCW in plan when xb > xa. */
function profiledRect(xa, xb, y0, y1, z0, h, L, T, f) {
  const s = rampSlope(h, L, { length: T, slopeFactor: f });
  const dir = xb >= xa ? 1 : -1;
  const xs = [0, T, T + L, 2 * T + L];
  const zs = [0, f * s * T, f * s * T + s * L, h];
  const south = xs.map((d, i) => [r3(xa + dir * d), r3(y0), r3(z0 + zs[i])]);
  const north = xs.map((d, i) => [r3(xa + dir * d), r3(y1), r3(z0 + zs[i])]).reverse();
  const ring = south.concat(north);
  return dir > 0 ? ring : ring.reverse();
}

/* ---------------------------------------------------------------- ramps */

/** Plan 3.4. Every ramp of the deck, one entry per ramp per level it leaves.
    built = the result of layout(): reads built.levels (index, z, ftf), built.bays,
    built.run ({ xs, xe, length, turnZone }), built.frame (W, D).
    → [{ id, type, level, bay, rise, length, slope, limit, ok, outer3d, footprint: Ring | null }] */
export function rampsFor(state, built) {
  need(state && typeof state === "object", "rampsFor", "state");
  need(built && Array.isArray(built.levels) && Array.isArray(built.bays) && built.run, "rampsFor", "built");
  const ramp = state.ramp || {};
  const type = ramp.type || "none";
  const checks = state.checks || {};
  const limPark = num(checks.slopeParking, 0.0667);
  const limSpeed = num(checks.slopeSpeed, 0.12);
  const tr = transitionOf(state);
  const { xs, xe, length: R } = built.run;
  const p = Math.max(0, num(state.footprint && state.footprint.perimeter, 1));
  const W = built.frame.W;
  const levels = built.levels.slice().sort((a, b) => a.index - b.index);
  const bays = built.bays;
  const out = [];
  if (type === "none" || levels.length < 2) return out;

  const push = (o) => {
    const ok = o.slope <= o.limit + EPS;
    out.push({ ...o, ok });
  };

  for (let li = 0; li < levels.length - 1; li++) {
    const lv = levels[li];
    const ftf = lv.ftf, z = lv.z;
    if (type === "single-helix" || type === "double-helix") {
      const h = type === "single-helix" ? ftf / 2 : ftf;
      const s = rampSlope(h, R, null);
      bays.forEach((b, bi) => {
        const base = type === "single-helix" ? z + bi * h : z;
        push({
          id: `R${lv.index}-B${b.index}`, type, level: lv.index, bay: b.index,
          rise: r3(h), length: r3(R), slope: s, limit: limPark,
          outer3d: slopedRect(xs, xe, b.y0, b.y1, base, base + h, bi % 2 === 0),
          footprint: null,
        });
      });
    } else if (type === "sloped-floor") {
      const bi = Math.round(num(ramp.slopedBay, 1));
      const b = bays[bi];
      if (!b) continue;
      push({
        id: `R${lv.index}-B${b.index}`, type, level: lv.index, bay: b.index,
        rise: r3(ftf), length: r3(R), slope: rampSlope(ftf, R, null), limit: limPark,
        outer3d: slopedRect(xs, xe, b.y0, b.y1, z, z + ftf, true),
        footprint: null,
      });
    } else if (type === "speed") {
      const sp = ramp.speed || {};
      const fp = speedRampFootprint(state);
      const w = Math.max(0, num(sp.width, 24));
      if (sp.shape === "circular") {
        const ri = Math.max(0, num(sp.insideRadius, 30));
        const segs = Math.round(num(sp.segments, 12));
        const c = circularRamp(ri, w, segs);
        const Rr = ri + w, cx = num(sp.x, 0) + Rr, cy = num(sp.y, 0) + Rr;
        const n = segs;
        const outerArc = [], innerArc = [];
        for (let i = 0; i <= n; i++) {
          const a = (2 * Math.PI * i) / n, zz = z + (ftf * i) / n;
          outerArc.push([r3(cx + Rr * Math.cos(a)), r3(cy + Rr * Math.sin(a)), r3(zz)]);
          innerArc.push([r3(cx + ri * Math.cos(a)), r3(cy + ri * Math.sin(a)), r3(zz)]);
        }
        push({
          id: `R${lv.index}-S`, type, level: lv.index, bay: null, shape: "circular",
          rise: r3(ftf), length: c.length, slope: rampSlope(ftf, 2 * Math.PI * (ri + w / 2), tr), limit: limSpeed,
          outer3d: outerArc.concat(innerArc.reverse()),
          footprint: fp ? fp.ring : null,
        });
      } else {
        const L = Math.max(0, num(sp.length, 82));
        const x0 = num(sp.x, 0), y0 = num(sp.y, 0);
        push({
          id: `R${lv.index}-S`, type, level: lv.index, bay: null, shape: "straight",
          rise: r3(ftf), length: r3(L), slope: rampSlope(ftf, L, tr), limit: limSpeed,
          outer3d: profiledRect(x0, x0 + L + 2 * tr.length, y0, y0 + w, z, ftf, L, tr.length, tr.slopeFactor),
          footprint: fp ? fp.ring : null,
        });
      }
    } else if (type === "split") {
      const L = Math.max(0, num(ramp.splitLength, 36));
      const t = splitEndZone(state);
      const h = ftf / 2;
      const yb0 = bays.length ? bays[0].y0 : p;
      const yb1 = bays.length ? bays[bays.length - 1].y1 : p;
      const ends = [
        { id: "W", xa: p + t, xb: p, ring: [[r3(p), r3(yb0)], [r3(p + t), r3(yb0)], [r3(p + t), r3(yb1)], [r3(p), r3(yb1)]] },
        { id: "E", xa: W - p - t, xb: W - p, ring: [[r3(W - p - t), r3(yb0)], [r3(W - p), r3(yb0)], [r3(W - p), r3(yb1)], [r3(W - p - t), r3(yb1)]] },
      ];
      for (const e of ends) {
        push({
          id: `R${lv.index}-${e.id}`, type, level: lv.index, bay: null,
          rise: r3(h), length: r3(L), slope: rampSlope(h, L, tr), limit: limSpeed,
          outer3d: profiledRect(e.xa, e.xb, yb0, yb1, z, h, L, tr.length, tr.slopeFactor),
          footprint: e.ring,
        });
      }
    }
  }
  return out;
}
