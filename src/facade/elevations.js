/* ==========================================================================
   facade/elevations.js — Facade Studio: elevation geometry and the elevations DXF
   (docs/facade-studio-technical-plan.md sections 3.6 to 3.9, 4 and 9.1 test 22)

   elevationGeometry(built, orientation, state?) → { orientation, faces, glass, spandrel, mullions, balconies, fins, shades, levels, extent }
     built        buildFacade(state, ...) result (plan section 4): { rotation, levels, faces[], ... }
     orientation  "N" | "E" | "S" | "W"   The viewer stands outside and looks at the massing.
     state        the facade state. Optional: without it balconies, fins and shades come back empty
                  (they need state.balconies, state.fins and state.shades).
     u runs left to right on the sheet, v = z (feet). Project frame after built.rotation:
        N: u = -x    S: u = x    E: u = y    W: u = -y
     Every element carries `court: true` when a nearer face of the same sector hides it (courtyard faces).
       faces      { id, u0, u1, z0, z1, court }                         one per face and level
       glass      { faceId, kind: window|door|glass|corner, u0, u1, z0, z1, court }
       spandrel   { faceId, u0, u1, z0, z1, court }                     opaque remainder of window wall and curtain wall
       mullions   { faceId, u, z0, z1, court }                          window wall, curtain wall, storefront
       balconies  { faceId, type, u0, u1, z0, z1, rail, court }         projected: slab and rail; inset: the recess
       fins       { faceId, u0, u1, z0, z1, court }
       shades     { faceId, u0, u1, z0, z1, court }
       levels     [{ index, z, ftf }]    sorted by z
       extent     { umin, umax, zmin, zmax }   of the whole massing in this view

   elevationSheets(built) → [{ orientation, label, x0, x1, umin, umax }]   the DXF sheet layout (N, E, S, W; 50 ft apart)

   elevationsDxf(state, built, metrics) → DXF R12 text (AC1009), feet. Four elevations side by side, 50 ft apart,
     in the order N, E, S, W from x = 0. Sheet x = x0 + (u - umin). y = z. All entities lie in the XY plane at z = 0.
     Layers  FAC-WALL      one closed polyline per face and level
             FAC-GLASS     one closed polyline per glass rectangle (windows, doors, vision glass, corners)
             FAC-SPANDREL  one closed polyline per opaque rectangle of a window wall or curtain wall
             FAC-MULLION   one vertical line per mullion line
             FAC-BALCONY   projected: slab and rail polylines. inset: the recess polyline
             FAC-FIN       one closed polyline per fin
             FAC-SHADE     one closed polyline per shade
             FAC-LEVEL     one horizontal line per floor level and the top, across each sheet
             FAC-COURT     the whole content of a face that a nearer face hides
             FAC-TEXT      sheet titles with the WWR, level labels, a header

   faceElements(state, face) → the same elements in face coordinates (u along the face from `a`, v up from the floor)
     (shared with sketchup.js). Pure: no DOM. Units: feet.

   Assumptions about the contract (plan section 4) are listed in the report that came with this file:
     - Panel.glass rectangles use u along the face from `a` (a rectangle with u0 below its panel's u0 is read as panel-relative).
     - A balcony module is a panel of kind "door". Balcony slabs, fins and shades are computed here from the face and the state
       (fins at the interior module lines j = every, 2 every, ... below n, shades over the first glass rectangle of each glazed panel,
       as panels.js does). A panel's own `spandrel` rectangles are used when it lists them.
   ========================================================================== */

export const SHEET_ORDER = ["N", "E", "S", "W"];
export const SHEET_GAP = 50;
export const FACADE_DXF_LAYERS = [
  ["FAC-WALL", 7], ["FAC-GLASS", 5], ["FAC-SPANDREL", 252], ["FAC-MULLION", 9], ["FAC-BALCONY", 3],
  ["FAC-FIN", 6], ["FAC-SHADE", 2], ["FAC-LEVEL", 1], ["FAC-COURT", 8], ["FAC-TEXT", 7],
];

export const RAIL_HEIGHT = 3.5;       // ft: balcony rail, elevation only
export const SHADE_THICKNESS = 0.25;  // ft: shade plate

const NAMES = { N: "NORTH", E: "EAST", S: "SOUTH", W: "WEST" };
const GLASS_SYSTEMS = ["windowWall", "curtainWall"];
const MULLION_SYSTEMS = ["windowWall", "curtainWall", "storefront"];
const EPS = 1e-6;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };

/* ---------- project frame ---------- */

function sincos(deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [0, 1];
  if (d === 90) return [1, 0];
  if (d === 180) return [0, -1];
  if (d === 270) return [-1, 0];
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

/** Local point → project frame (rotation only; the placement offset does not matter for an elevation). */
function toFrame(rotation, p) {
  const [s, c] = sincos(rotation);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

const U_OF = { N: (q) => -q[0], S: (q) => q[0], E: (q) => q[1], W: (q) => -q[1] };
const NEAR_OF = { N: (q) => q[1], S: (q) => -q[1], E: (q) => q[0], W: (q) => -q[0] };   // larger = nearer the viewer

/* ---------- face helpers ---------- */

const faceLen = (f) => (isNum(f.length) && f.length > 0 ? f.length : Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]));

/** Point on the face line at distance s from `a` (local frame). */
export function facePoint(face, s) {
  const L = faceLen(face), t = L > 0 ? s / L : 0;
  return [face.a[0] + (face.b[0] - face.a[0]) * t, face.a[1] + (face.b[1] - face.a[1]) * t];
}

/** Outward unit normal of a face in the local frame (same rule as faces.js: right of a → b). */
export function faceNormal(face) {
  const dx = face.b[0] - face.a[0], dy = face.b[1] - face.a[1], len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len];
}

/* ---------- rectangle algebra in (u, v) ---------- */

/** `outer` minus the `holes`, as rectangles. Rectangles are cut into horizontal bands; each band keeps the u intervals no hole covers. */
export function subtractRects(outer, holes) {
  const hs = [];
  for (const h of holes) {
    const u0 = Math.max(h.u0, outer.u0), u1 = Math.min(h.u1, outer.u1), v0 = Math.max(h.v0, outer.v0), v1 = Math.min(h.v1, outer.v1);
    if (u1 - u0 > EPS && v1 - v0 > EPS) hs.push({ u0, u1, v0, v1 });
  }
  const vs = [outer.v0, outer.v1];
  for (const h of hs) vs.push(h.v0, h.v1);
  vs.sort((a, b) => a - b);
  const levels = vs.filter((v, i) => i === 0 || v - vs[i - 1] > EPS);
  const out = [];
  for (let k = 0; k + 1 < levels.length; k++) {
    const va = levels[k], vb = levels[k + 1];
    const cover = hs.filter((h) => h.v0 <= va + EPS && h.v1 >= vb - EPS).sort((a, b) => a.u0 - b.u0);
    let cur = outer.u0;
    for (const h of cover) {
      if (h.u0 - cur > EPS) out.push({ u0: cur, u1: h.u0, v0: va, v1: vb });
      cur = Math.max(cur, h.u1);
    }
    if (outer.u1 - cur > EPS) out.push({ u0: cur, u1: outer.u1, v0: va, v1: vb });
  }
  return out;
}

/* ---------- elements of one face and level, in face coordinates ---------- */

function glassKind(kind) {
  return kind === "door" ? "door" : kind === "corner" ? "corner" : kind === "glass" ? "glass" : "window";
}

function listHas(list, v) {
  return Array.isArray(list) && list.includes(v);
}

/**
 * Everything drawn on one face and level, with u along the face from `a` (feet) and v up from the floor surface.
 * → { glass[{kind,i,u0,u1,v0,v1}], spandrel[{i,u0,u1,v0,v1}], mullions[{u,v0,v1}], balconies[{i,type,u0,u1,v0,v1,rail,depth,slab}],
 *     fins[{u,width,depth}], shades[{i,u0,u1,v0,v1,depth}] }
 * `state` may be null; then balconies, fins and shades are empty.
 */
export function faceElements(state, face) {
  const h = num(face.ftf, 0), rule = face.rule || {}, sys = rule.system || "punched";
  const glassSys = GLASS_SYSTEMS.includes(sys);
  const out = { glass: [], spandrel: [], mullions: [], balconies: [], fins: [], shades: [] };
  const bounds = new Map();     // boundary u (r3) → [v0, v1] of the glass next to it

  for (const p of face.panels || []) {
    const gl = [];
    for (const g of p.glass || []) {
      const shift = g.u0 < p.u0 - EPS ? p.u0 : 0;       // a panel-relative rectangle
      const r = { u0: g.u0 + shift, u1: g.u1 + shift, v0: Math.max(0, g.v0), v1: Math.min(h, g.v1) };
      if (r.u1 - r.u0 > EPS && r.v1 - r.v0 > EPS) gl.push(r);
    }
    for (const g of gl) out.glass.push({ kind: glassKind(p.kind), i: p.i, ...g });
    if (Array.isArray(p.spandrel)) {
      // the panel lists its opaque rectangles (panels.js does); a rectangle may be panel-relative like the glass
      for (const g of p.spandrel) {
        const shift = g.u0 < p.u0 - EPS ? p.u0 : 0;
        const r = { u0: g.u0 + shift, u1: g.u1 + shift, v0: Math.max(0, g.v0), v1: Math.min(h, g.v1) };
        if (r.u1 - r.u0 > EPS && r.v1 - r.v0 > EPS) out.spandrel.push({ i: p.i, ...r });
      }
    } else if (glassSys || p.kind === "spandrel") {
      for (const r of subtractRects({ u0: p.u0, u1: p.u1, v0: 0, v1: h }, gl)) out.spandrel.push({ i: p.i, ...r });
    }
    if (gl.length && MULLION_SYSTEMS.includes(sys)) {
      const v0 = Math.min(...gl.map((g) => g.v0)), v1 = Math.max(...gl.map((g) => g.v1));
      for (const u of [p.u0, p.u1]) {
        const key = r3(u), old = bounds.get(key);
        bounds.set(key, old ? [Math.min(old[0], v0), Math.max(old[1], v1)] : [v0, v1]);
      }
    }
    if (state && gl.length && p.kind !== "door" && state.shades && state.shades.on && listHas(state.shades.orientations, face.orientation) && listHas(state.shades.zones, face.zone)) {
      const vs = gl[0].v1 + num(state.shades.above, 0.5);          // one shade per glazed panel, over its first glass rectangle (as panels.js does)
      if (vs + SHADE_THICKNESS <= h + EPS) out.shades.push({ i: p.i, u0: gl[0].u0, u1: gl[0].u1, v0: vs, v1: vs + SHADE_THICKNESS, depth: num(state.shades.depth, 2) });
    }
    if (state && p.kind === "door" && state.balconies) {
      const b = state.balconies, w = Math.min(num(b.width, 12), p.u1 - p.u0), c = (p.u0 + p.u1) / 2;
      const type = b.type === "inset" ? "inset" : "projected";
      const slab = num(b.slab, 1);
      out.balconies.push(type === "inset"
        ? { i: p.i, type, u0: c - w / 2, u1: c + w / 2, v0: 0, v1: h, rail: false, depth: num(b.depth, 6), slab }
        : { i: p.i, type, u0: c - w / 2, u1: c + w / 2, v0: -slab, v1: 0, rail: true, depth: num(b.depth, 6), slab });
    }
  }
  for (const [u, [v0, v1]] of [...bounds.entries()].sort((a, b) => a[0] - b[0])) out.mullions.push({ u, v0, v1 });

  const f = state && state.fins;
  if (f && f.on && listHas(f.orientations, face.orientation) && listHas(f.zones, face.zone)) {
    const n = Math.max(1, num(face.n, (face.panels || []).length || 1)), m = faceLen(face) / n, every = Math.max(1, Math.round(num(f.every, 1)));
    for (let j = every; j < n; j += every) out.fins.push({ u: j * m, width: num(f.width, 0.1667), depth: num(f.depth, 1.5) });
  }
  return out;
}

/* ---------- elevation geometry ---------- */

function allFaces(built) {
  return Array.isArray(built && built.faces) ? built.faces.filter((f) => f && Array.isArray(f.a) && Array.isArray(f.b)) : [];
}

function levelList(built) {
  const seen = new Map();
  for (const l of (built && built.levels) || []) if (l && isNum(l.z)) seen.set(r3(l.z), { index: l.index, z: r3(l.z), ftf: num(l.ftf, 0) });
  if (!seen.size) for (const f of allFaces(built)) if (isNum(f.z)) seen.set(r3(f.z), { index: f.levelIndex, z: r3(f.z), ftf: num(f.ftf, 0) });
  return [...seen.values()].sort((a, b) => a.z - b.z);
}

/** u and z extent of the whole massing in one view. */
function massingExtent(built, orientation) {
  const rot = num(built && built.rotation, 0);
  let umin = Infinity, umax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const f of allFaces(built)) {
    for (const p of [f.a, f.b]) {
      const u = U_OF[orientation](toFrame(rot, p));
      if (u < umin) umin = u;
      if (u > umax) umax = u;
    }
    zmin = Math.min(zmin, num(f.z, 0));
    zmax = Math.max(zmax, num(f.z, 0) + num(f.ftf, 0));
  }
  if (!isFinite(umin)) { umin = 0; umax = 0; }
  if (!isFinite(zmin)) { zmin = 0; zmax = 0; }
  return { umin: r3(umin), umax: r3(umax), zmin: r3(zmin), zmax: r3(zmax) };
}

export function elevationGeometry(built, orientation, state) {
  if (!SHEET_ORDER.includes(orientation)) throw new Error('elevationGeometry: orientation must be "N", "E", "S" or "W".');
  const rot = num(built && built.rotation, 0);
  const faces = allFaces(built).filter((f) => f.orientation === orientation);
  const U = U_OF[orientation], NEAR = NEAR_OF[orientation];

  // per face: u range, depth, z range
  const info = faces.map((f) => {
    const ua = U(toFrame(rot, f.a)), ub = U(toFrame(rot, f.b)), L = faceLen(f);
    const mid = toFrame(rot, facePoint(f, L / 2));
    const z0 = num(f.z, 0), z1 = z0 + num(f.ftf, 0);
    const uAt = (s) => ua + (ub - ua) * (L > 0 ? s / L : 0);
    return { f, ua, ub, L, u0: Math.min(ua, ub), u1: Math.max(ua, ub), near: NEAR(mid), z0, z1, uAt };
  });
  const byLevel = new Map();
  for (const it of info) { const k = r3(it.z0); if (!byLevel.has(k)) byLevel.set(k, []); byLevel.get(k).push(it); }
  const isCourt = (it) => {
    for (const other of info) {
      if (other === it || other.near <= it.near + 0.5) continue;
      if (Math.min(it.z1, other.z1) - Math.max(it.z0, other.z0) <= 0.5) continue;
      if (Math.min(it.u1, other.u1) - Math.max(it.u0, other.u0) > 0.5) return true;
    }
    return false;
  };

  const out = { orientation, faces: [], glass: [], spandrel: [], mullions: [], balconies: [], fins: [], shades: [], levels: levelList(built), extent: massingExtent(built, orientation) };
  const range = (it, s0, s1) => { const a = it.uAt(s0), b = it.uAt(s1); return [r3(Math.min(a, b)), r3(Math.max(a, b))]; };

  for (const it of info) {
    const f = it.f, court = isCourt(it);
    out.faces.push({ id: f.id, u0: r3(it.u0), u1: r3(it.u1), z0: r3(it.z0), z1: r3(it.z1), court });
    const el = faceElements(state || null, f);
    const rect = (r, extra) => { const [u0, u1] = range(it, r.u0, r.u1); return { faceId: f.id, ...extra, u0, u1, z0: r3(it.z0 + r.v0), z1: r3(it.z0 + r.v1), court }; };
    for (const g of el.glass) out.glass.push(rect(g, { kind: g.kind }));
    for (const s of el.spandrel) out.spandrel.push(rect(s, {}));
    for (const m of el.mullions) { const u = r3(it.uAt(m.u)); out.mullions.push({ faceId: f.id, u, z0: r3(it.z0 + m.v0), z1: r3(it.z0 + m.v1), court }); }
    for (const b of el.balconies) out.balconies.push(rect(b, { type: b.type, rail: b.rail }));
    for (const fn of el.fins) { const [u0, u1] = range(it, fn.u - fn.width / 2, fn.u + fn.width / 2); out.fins.push({ faceId: f.id, u0, u1, z0: r3(it.z0), z1: r3(it.z1), court }); }
    for (const s of el.shades) out.shades.push(rect(s, {}));
  }
  return out;
}

/* ---------- sheet layout ---------- */

export function elevationSheets(built) {
  const sheets = [];
  let x = 0;
  for (const o of SHEET_ORDER) {
    const e = massingExtent(built, o), w = e.umax - e.umin;
    sheets.push({ orientation: o, label: `${NAMES[o]} ELEVATION`, x0: r3(x), x1: r3(x + w), umin: e.umin, umax: e.umax });
    x += w + SHEET_GAP;
  }
  return sheets;
}

/* ---------- DXF writer ---------- */

function fmt(v) {
  let s = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/0+$/, "");
  if (s.endsWith(".")) s += "0";
  return s === "-0.0" ? "0.0" : s;
}

class Dxf {
  constructor() { this.out = []; this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity]; }
  g(code, v) { this.out.push(String(code).padStart(3, " "), typeof v === "number" && code >= 10 && code <= 59 ? fmt(v) : String(v)); }
  pt(x, y, z, c = 10) {
    this.g(c, x); this.g(c + 10, y); this.g(c + 20, z);
    const v = [x, y, z];
    for (let i = 0; i < 3; i++) { if (v[i] < this.min[i]) this.min[i] = v[i]; if (v[i] > this.max[i]) this.max[i] = v[i]; }
  }
  closed2d(layer, ring) {
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, 1);
    for (const p of ring) { this.g(0, "VERTEX"); this.g(8, layer); this.pt(p[0], p[1], 0); }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  line(layer, a, b) { this.g(0, "LINE"); this.g(8, layer); this.pt(a[0], a[1], 0); this.pt(b[0], b[1], 0, 11); }
  text(layer, x, y, height, s) { this.g(0, "TEXT"); this.g(8, layer); this.pt(x, y, 0); this.g(40, height); this.g(1, String(s).replace(/[^\x20-\x7e]/g, "?")); }
}

const pct1 = (v) => (Math.round(v * 1000) / 10).toFixed(1);

/** Per-orientation WWR for the sheet titles: the metrics row when it has one, else the sum over the built faces. */
function wwrFor(o, built, metrics) {
  const row = metrics && metrics.wwrByOrientation;
  if (row && isNum(row[o])) return row[o];
  let wall = 0, glass = 0;
  for (const f of allFaces(built)) if (f.orientation === o) { wall += num(f.wall, 0); glass += num(f.glazing, 0); }
  return wall > 0 ? glass / wall : null;
}

export function elevationsDxf(state, built, metrics) {
  if (!state) throw new Error('elevationsDxf: missing input "state".');
  if (!built || !Array.isArray(built.faces)) throw new Error('elevationsDxf: missing input "built.faces".');
  const D = new Dxf();
  const sheets = elevationSheets(built);
  const geoms = sheets.map((s) => elevationGeometry(built, s.orientation, state));
  const zlo = Math.min(...geoms.map((g) => g.extent.zmin)), zhi = Math.max(...geoms.map((g) => g.extent.zmax));
  const rectRing = (X, e) => [[X(e.u0), e.z0], [X(e.u1), e.z0], [X(e.u1), e.z1], [X(e.u0), e.z1]];

  D.text("FAC-TEXT", 0, zhi + 10, 3, `${String(state.name || "Facade").toUpperCase()}  ELEVATIONS  FEET`);

  sheets.forEach((sh, k) => {
    const g = geoms[k];
    const X = (u) => r3(sh.x0 + (u - sh.umin));
    const L = (court, layer) => (court ? "FAC-COURT" : layer);
    const wwr = wwrFor(sh.orientation, built, metrics);
    D.text("FAC-TEXT", sh.x0, zlo - 8, 3, `${sh.label}${wwr === null ? "" : `  WWR ${pct1(wwr)} PCT`}`);

    // levels: a line at every floor and the top
    const zs = g.levels.map((l) => l.z);
    const top = g.levels.length ? Math.max(...g.levels.map((l) => l.z + l.ftf)) : null;
    for (const l of g.levels) {
      D.line("FAC-LEVEL", [sh.x0, l.z], [sh.x1, l.z]);
      D.text("FAC-TEXT", sh.x0 - 16, l.z + 0.5, 1.5, `L${l.index} ${l.z >= 0 ? "+" : "-"}${fmt(Math.abs(l.z))}`);
    }
    if (top !== null && !zs.some((z) => Math.abs(z - top) < 0.01)) {
      D.line("FAC-LEVEL", [sh.x0, top], [sh.x1, top]);
      D.text("FAC-TEXT", sh.x0 - 16, top + 0.5, 1.5, `TOP +${fmt(top)}`);
    }

    for (const e of g.faces) D.closed2d(L(e.court, "FAC-WALL"), rectRing(X, e));
    for (const e of g.spandrel) D.closed2d(L(e.court, "FAC-SPANDREL"), rectRing(X, e));
    for (const e of g.glass) D.closed2d(L(e.court, "FAC-GLASS"), rectRing(X, e));
    for (const e of g.mullions) D.line(L(e.court, "FAC-MULLION"), [X(e.u), e.z0], [X(e.u), e.z1]);
    for (const e of g.balconies) {
      D.closed2d(L(e.court, "FAC-BALCONY"), rectRing(X, e));
      if (e.rail) D.closed2d(L(e.court, "FAC-BALCONY"), rectRing(X, { u0: e.u0, u1: e.u1, z0: e.z1, z1: e.z1 + RAIL_HEIGHT }));
    }
    for (const e of g.fins) D.closed2d(L(e.court, "FAC-FIN"), rectRing(X, e));
    for (const e of g.shades) D.closed2d(L(e.court, "FAC-SHADE"), rectRing(X, e));
  });

  const head = new Dxf();
  head.g(0, "SECTION"); head.g(2, "HEADER");
  head.g(9, "$ACADVER"); head.g(1, "AC1009");
  const lo = D.min.map((v) => (isFinite(v) ? v : 0)), hi = D.max.map((v) => (isFinite(v) ? v : 0));
  head.g(9, "$EXTMIN"); head.g(10, lo[0]); head.g(20, lo[1]); head.g(30, lo[2]);
  head.g(9, "$EXTMAX"); head.g(10, hi[0]); head.g(20, hi[1]); head.g(30, hi[2]);
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "TABLES");
  head.g(0, "TABLE"); head.g(2, "LTYPE"); head.g(70, 1);
  head.g(0, "LTYPE"); head.g(2, "CONTINUOUS"); head.g(70, 0); head.g(3, "Solid line"); head.g(72, 65); head.g(73, 0); head.g(40, 0);
  head.g(0, "ENDTAB");
  head.g(0, "TABLE"); head.g(2, "LAYER"); head.g(70, FACADE_DXF_LAYERS.length + 1);
  head.g(0, "LAYER"); head.g(2, "0"); head.g(70, 0); head.g(62, 7); head.g(6, "CONTINUOUS");
  for (const [name, color] of FACADE_DXF_LAYERS) { head.g(0, "LAYER"); head.g(2, name); head.g(70, 0); head.g(62, color); head.g(6, "CONTINUOUS"); }
  head.g(0, "ENDTAB");
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "ENTITIES");
  const tail = ["  0", "ENDSEC", "  0", "EOF"];
  return head.out.concat(D.out, tail).join("\n") + "\n";
}
