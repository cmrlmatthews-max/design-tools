/* ==========================================================================
   balconies.js — balcony modules, per-unit balconies, and strip geometry (Facade Studio)

   Contract: docs/facade-studio-technical-plan.md sections 3.8 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs. Units: feet.

   A face runs from `a` to `b` in the local frame. The outward normal is
   (dy, -dx) / |d|, the rule faces.js uses on both outer rings and holes.
   Position `u` is the distance along the face from `a`; `v` is the height
   above the level floor.

   Rule choices where the plan leaves room:
   - balconyModules("per-unit", ...) answers like "stacked". The per-unit
     choice needs Plate Planner units (unitBalconies); buildFacade uses this
     answer as the fallback when a level has none.
   - spacing is rounded to a whole number of at least 1. An unknown pattern
     is stacked. Indices are sorted, unique, and inside [0, n).
   - unitBalconies: a unit edge counts as a facade edge of a face when both
     end points lie within 1.5 ft of the face line and the edge overlaps the
     face. The edge length is the overlap length. The balcony goes at the
     centre of the overlap, in the module that holds it. When that module is
     taken by another unit, the nearest free module is used (the lower index
     on a tie), so each unit keeps one balcony while a free module exists.
   - unitBalconies with `allFaces` (the fourth argument): a unit belongs to
     the face that holds its longest facade edge among those faces, so a
     corner unit gets one balcony, not two. Without it, the unit belongs to
     this face when it has a facade edge here.
   - balconyGeometry: the balcony is centred in its module and clamped to
     the module width. A projected balcony is a slab outside the face, `slab`
     thick, with its top at the level floor (z0 = z - slab, z1 = z). An inset
     balcony is the recess cut into the plate: z0 = z, z1 = z + ftf. The door
     is centred in the module, sill 0, and stands at the recessed plane for an
     inset balcony (door.offset = depth, projected 0).
   ========================================================================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const mod = (a, b) => ((a % b) + b) % b;
const FACE_TOL = 1.5;   // ft: a unit edge lies on a face within this distance (Plate Planner units stop 1.0 ft inside the face, the exterior wall allowance)

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* ------------------------------------------------------------- patterns */

/** Plan 3.8. pattern: "stacked" | "alternating" | "checker" | "per-unit". n modules on the face,
    levelIndex k, spacing s. → sorted module indices. */
export function balconyModules(pattern, n, levelIndex, spacing) {
  const count = isNum(n) ? Math.max(0, Math.floor(n)) : 0;
  const s = isNum(spacing) ? Math.max(1, Math.round(spacing)) : 2;
  const k = isNum(levelIndex) ? Math.round(levelIndex) : 0;
  let offset = 0;
  if (pattern === "alternating") offset = mod(k, 2) * Math.floor(s / 2);
  else if (pattern === "checker") offset = k;
  const out = [];
  for (let i = 0; i < count; i++) if (mod(i - offset, s) === 0) out.push(i);
  return out;
}

/* ------------------------------------------------------------- geometry */

function frameOf(face) {
  const a = face.a, b = face.b;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  need(L > 1e-9, "balconies", "face a and b");
  return { a, L, d: [dx / L, dy / L], n: [dy / L, -dx / L] };
}

function ccw(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return s < 0 ? ring.slice().reverse() : ring;
}

/** A rectangle on a face: from u0 to u1 along the face and `depth` ft off it (outward when depth > 0,
    into the plate when depth < 0). → counter-clockwise Ring, rounded to 0.001 ft. */
export function faceStrip(face, u0, u1, depth) {
  need(face && face.a && face.b, "faceStrip", "face");
  const f = frameOf(face);
  const at = (u, off) => [r3(f.a[0] + f.d[0] * u + f.n[0] * off), r3(f.a[1] + f.d[1] * u + f.n[1] * off)];
  return ccw([at(u0, 0), at(u1, 0), at(u1, depth), at(u0, depth)]);
}

function moduleOf(face) {
  if (isNum(face.module) && face.module > 0) return face.module;
  const n = isNum(face.n) && face.n > 0 ? face.n : 1;
  return face.length / n;
}

/** Plan 3.8. face: { a, b, length, module?, n?, z, ftf }. i: module index.
    balconies: state.balconies. → { type, plan, z0, z1, door, u0, u1, width, depth, slab } */
export function balconyGeometry(face, i, balconies) {
  need(face && face.a && face.b && isNum(face.length), "balconyGeometry", "face");
  const b = balconies || {};
  const m = moduleOf(face);
  const type = b.type === "inset" ? "inset" : "projected";
  const width = Math.min(isNum(b.width) ? b.width : 12, m);
  const depth = isNum(b.depth) ? b.depth : 6;
  const slab = isNum(b.slab) ? b.slab : 1;
  const uc = (i + 0.5) * m;
  const u0 = uc - width / 2, u1 = uc + width / 2;
  const z = isNum(face.z) ? face.z : 0, ftf = isNum(face.ftf) ? face.ftf : 10;
  const dw = Math.min(b.door && isNum(b.door.width) ? b.door.width : 6, m);
  const dh = Math.min(b.door && isNum(b.door.head) ? b.door.head : 8, ftf);
  return {
    type,
    plan: faceStrip(face, u0, u1, type === "inset" ? -depth : depth),
    z0: r3(type === "inset" ? z : z - slab),
    z1: r3(type === "inset" ? z + ftf : z),
    door: { u0: uc - dw / 2, u1: uc + dw / 2, v0: 0, v1: dh, offset: type === "inset" ? depth : 0 },
    u0, u1, width, depth, slab,
  };
}

/* ------------------------------------------------------------ per unit */

/** The part of a unit edge on a face: { len, mid } (mid = u of the overlap centre), or null. */
function edgeOnFace(face, p, q) {
  const f = frameOf(face);
  const dist = (x) => Math.abs((x[0] - f.a[0]) * f.n[0] + (x[1] - f.a[1]) * f.n[1]);
  if (dist(p) > FACE_TOL || dist(q) > FACE_TOL) return null;
  const tp = (p[0] - f.a[0]) * f.d[0] + (p[1] - f.a[1]) * f.d[1];
  const tq = (q[0] - f.a[0]) * f.d[0] + (q[1] - f.a[1]) * f.d[1];
  const lo = Math.max(0, Math.min(tp, tq)), hi = Math.min(f.L, Math.max(tp, tq));
  if (hi - lo <= 1e-6) return null;
  return { len: hi - lo, mid: (lo + hi) / 2 };
}

function bestOnFace(face, ring) {
  let best = null;
  for (let k = 0; k < ring.length; k++) {
    const e = edgeOnFace(face, ring[k], ring[(k + 1) % ring.length]);
    if (e && (!best || e.len > best.len)) best = e;
  }
  return best;
}

/** Plan 3.8, per-unit. unitsLevel: a plates.derived level { units: [{ outer }] } in the local frame.
    module: the actual module width (ft). allFaces: optional, see the header.
    → sorted unique module indices, one per unit, snapped to the module that holds the balcony. */
export function unitBalconies(face, unitsLevel, module, allFaces) {
  need(face && face.a && face.b && isNum(face.length), "unitBalconies", "face");
  const units = unitsLevel && Array.isArray(unitsLevel.units) ? unitsLevel.units : [];
  const m = isNum(module) && module > 0 ? module : moduleOf(face);
  const n = Math.max(1, isNum(face.n) && face.n > 0 ? Math.floor(face.n) : Math.round(face.length / m));
  const same = (g) => g === face || (g.id !== undefined && g.id === face.id);
  const wanted = [];
  for (const u of units) {
    const ring = u && Array.isArray(u.outer) ? u.outer : null;
    if (!ring || ring.length < 3) continue;
    const here = bestOnFace(face, ring);
    if (!here) continue;
    if (Array.isArray(allFaces)) {
      let wins = true;
      for (const g of allFaces) {
        if (same(g) || !g || !g.a || !g.b) continue;
        const other = bestOnFace(g, ring);
        if (other && other.len > here.len + 1e-9) { wins = false; break; }
      }
      if (!wins) continue;
    }
    wanted.push(Math.min(n - 1, Math.max(0, Math.floor(here.mid / m + 1e-9))));
  }
  wanted.sort((p, q) => p - q);
  const taken = new Set();
  for (const w of wanted) {
    if (taken.size >= n) break;
    for (let r = 0; r < n; r++) {
      const lo = w - r, hi = w + r;
      if (lo >= 0 && !taken.has(lo)) { taken.add(lo); break; }
      if (hi < n && !taken.has(hi)) { taken.add(hi); break; }
    }
  }
  return [...taken].sort((p, q) => p - q);
}
