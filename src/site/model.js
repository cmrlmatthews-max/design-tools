/* ==========================================================================
   SITE: model
   Ground grid, buildings, roads, trees and water from already-decoded data.
   Pure functions, no DOM, no network. Uses globalThis.ClipperLib (6.4.2).
   Spec: docs/site-tool-spec.md sections 4 and 5.6.

   Units: feet, square feet. Local (x, y): x = east, y = north, origin = SW
   corner of the site square. Rings: CCW outers, CW holes (no repeated last
   point). Clipper works in integers: SCALE = 1000 (0.001 ft) in local feet;
   tile geometry is clipped at TILE_K = 16 sub-units per tile unit.

   "Model" bundle used by summarize() and exports.js:
     { frame, ground, buildings, roads, trees, water }
   buildModel() assembles it (each layer in its own try/catch, errors listed).

   Choices where the spec is silent:
   - Features whose raw bbox is more than 200 ft outside the site are dropped
     before any clipping (speed).
   - One building is made for each polygon piece of a feature after the union.
   - Pavement is clipped to the site square after the union.
   - Unknown road classes use the "service" width (14 ft).
   - Point features keep only tile positions in [0, extent) (no duplicates).
   - Tree cap: explicit trees first, then forest trees evenly thinned.
   ========================================================================== */

import { gridSpacing, tileToLonLat, FT } from "./geo.js";

export const SCALE = 1000;
const TILE_K = 16;
const M2FT = 1 / FT;               // 3.28084
const PREFILTER_MARGIN = 200;      // ft
const MAX_TREES = 3000;

const C = () => globalThis.ClipperLib;

/* ---------------- small helpers ---------------- */

const num = (v, d = NaN) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };

/** Signed shoelace area (positive = CCW when y is up). */
export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const orient = (r, ccw) => ((ringArea(r) > 0) === ccw ? r : r.slice().reverse());
const lineLen = (l) => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };

function parseJson(v) {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function dedupeRing(r) {
  const out = [];
  for (const p of r) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) { const n = ring.length; return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]; }
  return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const pointInPoly = (x, y, poly) => pointInRing(x, y, poly.outer) && !poly.holes.some((h) => pointInRing(x, y, h));

/* ---------------- Clipper plumbing ---------------- */

const toPath = (pts, k) => pts.map((p) => ({ X: Math.round(p[0] * k), Y: Math.round(p[1] * k) }));
const fromPath = (path, k) => path.map((p) => [p.X / k, p.Y / k]);
const rectPath = (x0, y0, x1, y1, k) => toPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], k);

/** PolyTree (closed paths) → [{outer, holes}] in input units. Orientation not normalized. */
function treeToPolys(tree, k) {
  const out = [];
  const visit = (node) => {
    for (const ch of node.Childs()) {
      if (!ch.IsHole()) {
        const poly = { outer: fromPath(ch.Contour(), k), holes: [] };
        for (const h of ch.Childs()) { poly.holes.push(fromPath(h.Contour(), k)); visit(h); }
        out.push(poly);
      } else visit(ch);
    }
  };
  visit(tree);
  return out;
}

/** Clip a set of rings (even-odd) to a rectangle. */
function clipRingsToRect(rings, rect, k) {
  const cl = new (C().Clipper)();
  cl.AddPaths(rings.map((r) => toPath(r, k)), C().PolyType.ptSubject, true);
  cl.AddPath(rectPath(rect[0], rect[1], rect[2], rect[3], k), C().PolyType.ptClip, true);
  const tree = new (C().PolyTree)();
  cl.Execute(C().ClipType.ctIntersection, tree, C().PolyFillType.pftEvenOdd, C().PolyFillType.pftNonZero);
  return treeToPolys(tree, k);
}

/** Clip open lines to a rectangle. Returns lines (arrays of [x,y]). */
function clipLinesToRect(lines, rect, k) {
  const cl = new (C().Clipper)();
  let any = false;
  for (const l of lines) if (l.length > 1) { cl.AddPath(toPath(l, k), C().PolyType.ptSubject, false); any = true; }
  if (!any) return [];
  cl.AddPath(rectPath(rect[0], rect[1], rect[2], rect[3], k), C().PolyType.ptClip, true);
  const tree = new (C().PolyTree)();
  cl.Execute(C().ClipType.ctIntersection, tree, C().PolyFillType.pftNonZero, C().PolyFillType.pftNonZero);
  return C().Clipper.OpenPathsFromPolyTree(tree).map((p) => fromPath(p, k)).filter((l) => l.length > 1);
}

/** Union (or intersection with a rect) of MultiPoly parts in local ft. Orientation is normalized first. */
function unionPolys(polys, clipRect) {
  const cl = new (C().Clipper)();
  for (const p of polys) {
    cl.AddPath(toPath(orient(p.outer, true), SCALE), C().PolyType.ptSubject, true);
    for (const h of p.holes) cl.AddPath(toPath(orient(h, false), SCALE), C().PolyType.ptSubject, true);
  }
  if (clipRect) cl.AddPath(rectPath(...clipRect, SCALE), C().PolyType.ptClip, true);
  const tree = new (C().PolyTree)();
  const nz = C().PolyFillType.pftNonZero;
  cl.Execute(clipRect ? C().ClipType.ctIntersection : C().ClipType.ctUnion, tree, nz, nz);
  return cleanPolys(treeToPolys(tree, SCALE));
}

/** Normalize orientation and drop slivers (< 0.5 sf polygons, < 0.5 sf holes). */
function cleanPolys(polys) {
  const out = [];
  for (const p of polys) {
    const outer = dedupeRing(p.outer);
    if (outer.length < 3 || Math.abs(ringArea(outer)) < 0.5) continue;
    out.push({
      outer: orient(outer, true),
      holes: p.holes.map(dedupeRing).filter((h) => h.length >= 3 && Math.abs(ringArea(h)) >= 0.5).map((h) => orient(h, false)),
    });
  }
  return out;
}

/** MVT rings → [{outer, holes}] (positive y-down area = outer; negative = hole of the last outer). */
function groupRings(rings) {
  const polys = [];
  for (const r of rings) {
    const a = ringArea(r);
    if (a === 0) continue;
    if (a > 0 || !polys.length) polys.push({ outer: r, holes: [] });
    else polys[polys.length - 1].holes.push(r);
  }
  return polys;
}

/* ==========================================================================
   Ground
   ========================================================================== */

/** Bilinear DEM sample, meters; NaN for no data. Pixel centers at west+(col+.5)*pixelW, north-(row+.5)*pixelH. */
function sampleDem(dem, lon, lat) {
  const { width: w, height: h, data } = dem;
  let fx = (lon - dem.west) / dem.pixelW - 0.5, fy = (dem.north - lat) / dem.pixelH - 0.5;
  if (fx < -1 || fy < -1 || fx > w || fy > h) return NaN;
  fx = Math.min(Math.max(fx, 0), w - 1); fy = Math.min(Math.max(fy, 0), h - 1);
  const x0 = Math.min(Math.floor(fx), Math.max(w - 2, 0)), y0 = Math.min(Math.floor(fy), Math.max(h - 2, 0));
  const tx = fx - x0, ty = fy - y0;
  let s = 0, ws = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const xx = Math.min(x0 + dx, w - 1), yy = Math.min(y0 + dy, h - 1), v = data[yy * w + xx];
    if (!(v > -1000)) continue;                       // NaN and no-data
    const wt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
    s += v * wt; ws += wt;
  }
  return ws > 1e-9 ? s / ws : NaN;
}

/**
 * Ground grid (section 4.1).
 * @param frame  from geo.makeFrame
 * @param dem  { width, height, data: Float32Array (row 0 = north), west, north, pixelW, pixelH } degrees, values meters
 * @returns {{spacing:number, n:number, xs:Float64Array, ys:Float64Array, z:Float64Array, min:number, max:number,
 *   filled:number, at:(x:number,y:number)=>number}}  xs/ys = the n node coordinates on each axis;
 *   z = n*n elevations in ft, row-major from south: index j*n+i is node (xs[i], ys[j]).
 */
export function buildGround(frame, dem) {
  const { spacing: d, n } = gridSpacing(frame.size);
  const z = new Float64Array(n * n).fill(NaN);
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = ys[i] = i * d;
  let valid = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [lon, lat] = frame.toLonLat(xs[i], ys[j]);
    const m = sampleDem(dem, lon, lat);
    if (Number.isFinite(m)) { z[j * n + i] = m / FT; valid++; }
  }
  if (!valid) throw new Error("No ground data for this site");
  const filled = n * n - valid;
  for (let guard = 0; guard < n * n; guard++) {
    const upd = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (!Number.isNaN(z[j * n + i])) continue;
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const v = z[jj * n + ii];
        if (!Number.isNaN(v)) { s += v; c++; }
      }
      if (c) upd.push([j * n + i, s / c]);
    }
    if (!upd.length) break;
    for (const [k, v] of upd) z[k] = v;
  }
  let min = Infinity, max = -Infinity;
  for (const v of z) { if (v < min) min = v; if (v > max) max = v; }
  const L = (n - 1) * d;
  const at = (x, y) => {
    const cx = Math.min(Math.max(x, 0), L) / d, cy = Math.min(Math.max(y, 0), L) / d;
    const i = Math.min(Math.floor(cx), n - 2), j = Math.min(Math.floor(cy), n - 2);
    const tx = cx - i, ty = cy - j, o = j * n + i;
    return (z[o] * (1 - tx) + z[o + 1] * tx) * (1 - ty) + (z[o + n] * (1 - tx) + z[o + n + 1] * tx) * ty;
  };
  return { spacing: d, n, xs, ys, z, min, max, filled, at };
}

/* ==========================================================================
   Tiles → local features (section 4.2)
   ========================================================================== */

/**
 * @param tiles  [{ z, x, y, layers }] with layers = mvt.decodeTile output
 * @param frame  from geo.makeFrame
 * @returns {{[layer:string]: Array<{id:string, type:1|2|3, properties:object, parts:any}>}}
 *   parts: type 1 → [[x,y],…]; type 2 → lines [[[x,y],…],…] (clipped to the tile only); type 3 → MultiPoly.
 */
export function featuresFromTiles(tiles, frame) {
  const S = frame.size, lo = -PREFILTER_MARGIN, hi = S + PREFILTER_MARGIN;
  const groups = new Map();                           // key → { layer, id, type, properties, pieces }
  let anon = 0;

  for (const tile of tiles) {
    for (const [layer, L] of Object.entries(tile.layers || {})) {
      const ext = L.extent || 4096;
      const loc = (px, py) => { const [lon, lat] = tileToLonLat(tile.z, tile.x, tile.y, px, py, ext); return frame.toLocal(lon, lat); };
      // tile box outside the site → skip all
      const c1 = loc(0, 0), c2 = loc(ext, ext);
      if (Math.max(c1[0], c2[0]) < lo || Math.min(c1[0], c2[0]) > hi || Math.max(c1[1], c2[1]) < lo || Math.min(c1[1], c2[1]) > hi) continue;
      const box = [0, 0, ext, ext];

      for (const f of L.features) {
        const geom = f.geometry;
        if (!geom || !geom.length) continue;
        const flat = f.type === 1 ? geom : f.type === 2 ? geom.flat() : geom.flat();
        if (!flat.length) continue;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of flat) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
        const a = loc(x0, y0), b = loc(x1, y1);
        if (Math.max(a[0], b[0]) < lo || Math.min(a[0], b[0]) > hi || Math.max(a[1], b[1]) < lo || Math.min(a[1], b[1]) > hi) continue;
        const inside = x0 >= 0 && y0 >= 0 && x1 <= ext && y1 <= ext;
        const toLocal = (pts) => pts.map((p) => loc(p[0], p[1]));

        let piece;
        if (f.type === 1) {
          const pts = geom.filter((p) => p[0] >= 0 && p[0] < ext && p[1] >= 0 && p[1] < ext);
          if (!pts.length) continue;
          piece = toLocal(pts);
        } else if (f.type === 2) {
          const lines = inside ? geom : clipLinesToRect(geom, box, TILE_K);
          if (!lines.length) continue;
          piece = lines.map(toLocal);
        } else {
          const polys = inside ? groupRings(geom) : clipRingsToRect(geom, box, TILE_K);
          const mp = cleanPolys(polys.map((p) => ({ outer: toLocal(p.outer), holes: p.holes.map(toLocal) })));
          if (!mp.length) continue;
          piece = mp;
        }
        const id = f.id != null ? String(f.id) : f.properties && f.properties.id != null ? String(f.properties.id) : `#${anon++}`;
        const key = layer + "|" + f.type + "|" + id;
        let g = groups.get(key);
        if (!g) groups.set(key, g = { layer, id, type: f.type, properties: f.properties || {}, pieces: [] });
        g.pieces.push(piece);
      }
    }
  }

  const out = {};
  for (const g of groups.values()) {
    let parts;
    if (g.type === 1) {
      parts = [];
      for (const p of g.pieces) for (const q of p) if (!parts.some((r) => Math.abs(r[0] - q[0]) < 0.5 && Math.abs(r[1] - q[1]) < 0.5)) parts.push(q);
    } else if (g.type === 2) parts = g.pieces.flat();
    else if (g.pieces.length === 1) parts = g.pieces[0];
    else parts = unionPolys(g.pieces.flat());
    if (g.type === 3 && !parts.length) continue;
    (out[g.layer] ||= []).push({ id: g.id, type: g.type, properties: g.properties, parts });
  }
  return out;
}

/* ==========================================================================
   Buildings (4.3)
   ========================================================================== */

/**
 * @returns {Array<{id:string, ring:number[][], holes:number[][][], base:number, height:number, top:number,
 *   floors:number, rule:"data"|"floors"|"estimate", source:string, name:string}>}
 *   rule/height per section 4.3. source = @height_source (or @geometry_source).
 */
export function buildBuildings(features, frame, ground) {
  const S = frame.size, out = [];
  for (const f of (features.building || [])) {
    if (f.type !== 3) continue;
    const p = f.properties || {};
    if (p.is_underground === true || p.is_underground === "true") continue;
    for (const poly of f.parts) {
      const [cx, cy] = centroid(poly.outer);
      if (cx < 0 || cy < 0 || cx > S || cy > S) continue;
      const h = num(p.height), nf = num(p.num_floors);
      let height, rule;
      if (h > 0) { height = h * M2FT; rule = "data"; }
      else if (nf > 0) { height = nf * 12; rule = "floors"; }
      else { height = 24; rule = "estimate"; }
      let base = ground.at(cx, cy);
      for (const q of poly.outer) base = Math.min(base, ground.at(q[0], q[1]));
      out.push({
        id: f.id, ring: poly.outer, holes: poly.holes, base, height, top: base + height,
        floors: Math.max(1, Math.round(height / 12)), rule,
        source: String(p["@height_source"] ?? p["@geometry_source"] ?? ""), name: String(p["@name"] ?? p.name ?? ""),
      });
    }
  }
  return out;
}

/* ==========================================================================
   Roads (4.4)
   ========================================================================== */

const ROAD_W = { motorway: 48, trunk: 48, primary: 44, secondary: 36, tertiary: 30, residential: 26, living_street: 26, unclassified: 22, unknown: 22, service: 14 };
const WALK_W = { footway: 5, pedestrian: 5, path: 5, steps: 5, cycleway: 8 };
const SERVICE_SUB = { alley: 12, parking_aisle: 20, driveway: 10 };

function roadFlags(p) {
  const arr = parseJson(p.road_flags);
  return Array.isArray(arr) ? arr : [];
}
/** Fraction (0..1) of the segment covered by flag `name`. */
function flagCoverage(flags, name) {
  const iv = [];
  for (const e of flags) {
    if (!e || !Array.isArray(e.values) || !e.values.includes(name)) continue;
    const b = Array.isArray(e.between) ? e.between : [0, 1];
    iv.push([Math.max(0, Math.min(b[0], b[1])), Math.min(1, Math.max(b[0], b[1]))]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  let tot = 0, end = 0;
  for (const [a, b] of iv) { const s = Math.max(a, end); if (b > s) { tot += b - s; end = b; } }
  return tot;
}

/** Width (ft) for a road/walk segment from properties, or table. */
function segmentWidth(p, cls, walk) {
  const wr = parseJson(p.width_rules);
  if (Array.isArray(wr) && wr.length) {
    const m = num(wr[0] && wr[0].value);
    if (m > 0 && m * M2FT >= 3 && m * M2FT <= 200) return m * M2FT;
  }
  if (walk) return WALK_W[cls];
  const sub = p.subclass;
  if (sub === "link" || flagCoverage(roadFlags(p), "is_link") > 0) return 16;
  if (cls === "service" || !(cls in ROAD_W)) return SERVICE_SUB[sub] ?? ROAD_W.service;
  return ROAD_W[cls];
}

function densify(line, step, zOf) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    if (i > 0) {
      const b = line[i - 1], L = Math.hypot(a[0] - b[0], a[1] - b[1]), k = Math.ceil(L / step);
      for (let s = 1; s < k; s++) { const t = s / k, x = b[0] + (a[0] - b[0]) * t, y = b[1] + (a[1] - b[1]) * t; out.push([x, y, zOf(x, y)]); }
    }
    out.push([a[0], a[1], zOf(a[0], a[1])]);
  }
  return out;
}

/** Buffer open lines by width/2 (flat ends, round joins), union, clip to the square. */
function pavement(items, S) {
  if (!items.length) return [];
  const byW = new Map();
  for (const it of items) {
    const key = Math.round(it.width * 10);
    if (!byW.has(key)) byW.set(key, { w: key / 10, paths: [] });
    byW.get(key).paths.push(toPath(it.line, SCALE));
  }
  const cl = new (C().Clipper)();
  for (const { w, paths } of byW.values()) {
    const co = new (C().ClipperOffset)(2, 0.25 * SCALE);
    co.AddPaths(paths, C().JoinType.jtRound, C().EndType.etOpenButt);
    const sol = [];
    co.Execute(sol, (w / 2) * SCALE);
    // Keep the offset output as it is: outers are positive and the holes of closed road loops
    // (city blocks) are negative. Reversing the holes would fill every block under NonZero fill.
    for (const path of sol) cl.AddPath(path, C().PolyType.ptSubject, true);
  }
  cl.AddPath(rectPath(0, 0, S, S, SCALE), C().PolyType.ptClip, true);
  const tree = new (C().PolyTree)();
  cl.Execute(C().ClipType.ctIntersection, tree, C().PolyFillType.pftNonZero, C().PolyFillType.pftNonZero);
  return cleanPolys(treeToPolys(tree, SCALE));
}

/**
 * @returns {{segments: Array<{id:string, cls:string, name:string, width:number, line:number[][], subclass:string, bridge:boolean}>,
 *   pavement: Array<{outer,holes}>, walks: Array<{outer,holes}>|null}}
 *   segments hold road centerlines only (draped, z = ground + 0.3); walks is null unless { walks: true }.
 */
export function buildRoads(features, frame, ground, { walks = false } = {}) {
  const S = frame.size, rect = [0, 0, S, S];
  const segments = [], roadItems = [], walkItems = [];
  for (const f of (features.segment || [])) {
    if (f.type !== 2) continue;
    const p = f.properties || {};
    if (p.subtype && p.subtype !== "road") continue;
    const cls = String(p.class || "unknown");
    const walk = cls in WALK_W;
    if (walk && !walks) continue;
    if (flagCoverage(roadFlags(p), "is_tunnel") > 0.5) continue;
    const width = segmentWidth(p, cls, walk);
    const bridge = flagCoverage(roadFlags(p), "is_bridge") > 0;
    for (const line of clipLinesToRect(f.parts, rect, SCALE)) {
      if (walk) { walkItems.push({ line, width }); continue; }
      roadItems.push({ line, width });
      segments.push({ id: f.id, cls, name: String(p["@name"] ?? p.name ?? ""), width, subclass: String(p.subclass || ""), bridge,
        line: densify(line, 10, (x, y) => ground.at(x, y) + 0.3) });
    }
  }
  return { segments, pavement: pavement(roadItems, S), walks: walks ? pavement(walkItems, S) : null };
}

/* ==========================================================================
   Trees (4.5) and water (4.6)
   ========================================================================== */

const hash2 = (i, j) => { let h = Math.imul(i | 0, 73856093) ^ Math.imul(j | 0, 19349663); h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13; return h >>> 0; };

/** @returns {Array<{x:number,y:number,z:number,canopy:20,height:30}>} at most 3000 trees. */
export function buildTrees(features, frame, ground) {
  const S = frame.size, trees = [], forest = [];
  const mk = (x, y) => ({ x, y, z: ground.at(x, y), canopy: 20, height: 30 });
  for (const f of (features.land || [])) {
    const p = f.properties || {};
    if (f.type === 1 && p.class === "tree") {
      for (const q of f.parts) if (q[0] >= 0 && q[0] <= S && q[1] >= 0 && q[1] <= S) trees.push(mk(q[0], q[1]));
    } else if (f.type === 3 && (p.subtype === "forest" || p.class === "wood" || p.class === "forest")) {
      for (const poly of unionPolys(f.parts, [0, 0, S, S])) {
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const q of poly.outer) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); }
        for (let gi = Math.floor(bx0 / 30); gi <= Math.ceil(bx1 / 30); gi++) for (let gj = Math.floor(by0 / 30); gj <= Math.ceil(by1 / 30); gj++) {
          const h = hash2(gi, gj);
          const x = gi * 30 + ((h & 0xffff) / 65535 * 2 - 1) * 6, y = gj * 30 + ((h >>> 16) / 65535 * 2 - 1) * 6;
          if (x >= 0 && x <= S && y >= 0 && y <= S && pointInPoly(x, y, poly)) forest.push([x, y]);
        }
      }
    }
  }
  const room = Math.max(0, MAX_TREES - trees.length);
  if (forest.length <= room) for (const q of forest) trees.push(mk(q[0], q[1]));
  else for (let k = 0; k < room; k++) { const q = forest[Math.floor(k * forest.length / room)]; trees.push(mk(q[0], q[1])); }
  return trees.slice(0, MAX_TREES);
}

const WATER_LINES = new Set(["stream", "ditch", "canal", "drain", "river"]);

/** @returns {{areas: Array<{ring,holes,level:number,cls:string}>, lines: number[][][]}} lines are draped at ground + 0.2 ft. */
export function buildWater(features, frame, ground) {
  const S = frame.size, areas = [], lines = [];
  for (const f of (features.water || [])) {
    const p = f.properties || {};
    if (f.type === 3) {
      for (const poly of unionPolys(f.parts, [0, 0, S, S])) {
        let lv = Infinity;
        for (const r of [poly.outer, ...poly.holes]) for (const q of r) lv = Math.min(lv, ground.at(q[0], q[1]));
        areas.push({ ring: poly.outer, holes: poly.holes, level: lv + 0.2, cls: String(p.class || p.subtype || "water") });
      }
    } else if (f.type === 2 && WATER_LINES.has(p.class)) {
      for (const l of clipLinesToRect(f.parts, [0, 0, S, S], SCALE)) lines.push(densify(l, 10, (x, y) => ground.at(x, y) + 0.2));
    }
  }
  return { areas, lines };
}

/* ==========================================================================
   Summary and assembly
   ========================================================================== */

/** @param model  { ground, buildings, roads, trees, water } */
export function summarize(model) {
  return {
    buildings: model.buildings.length,
    estimated: model.buildings.filter((b) => b.rule === "estimate").length,
    roadsFt: model.roads.segments.reduce((s, g) => s + lineLen(g.line), 0),
    trees: model.trees.length,
    waterAreas: model.water.areas.length,
    groundMin: model.ground.min,
    groundMax: model.ground.max,
  };
}

/**
 * Convenience: build every layer. Ground errors throw; other layers catch their own error
 * (listed in `errors`, the layer is empty). opts.trees === false builds no trees (trees: []).
 * @returns {{frame, ground, buildings, roads, trees, water, errors: {[layer:string]: string}}}
 */
export function buildModel(frame, { dem, tiles = [], walks = false, trees = true } = {}) {
  const ground = buildGround(frame, dem);
  const errors = {};
  let features = {};
  try { features = featuresFromTiles(tiles, frame); } catch (e) { errors.features = e.message; }
  const run = (name, fn, empty) => { try { return fn(); } catch (e) { errors[name] = e.message; return empty; } };
  return {
    frame, ground, errors,
    buildings: run("buildings", () => buildBuildings(features, frame, ground), []),
    roads: run("roads", () => buildRoads(features, frame, ground, { walks }), { segments: [], pavement: [], walks: null }),
    // trees: false skips them (the Site Model makes none for now; the tree code stays for a later "trees from a map image" feature)
    trees: trees === false ? [] : run("trees", () => buildTrees(features, frame, ground), []),
    water: run("water", () => buildWater(features, frame, ground), { areas: [], lines: [] }),
  };
}
