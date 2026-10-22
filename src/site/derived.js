/* ==========================================================================
   SITE: derived
   The "site" section of a project file: docs/project-file-spec.md, section 6.1.
   Input is the model bundle from model.js: { frame, ground, buildings, roads, trees, water }.
   Pure functions, no DOM, no network, no ClipperLib.

   Units: feet. Plan (x, y): x = east, y = north, origin = SW corner of the site square
   (the same origin as the Revit CSV, the DXF and the SketchUp file). z = NAVD88 feet, never shifted.

   Choices where the spec is silent:
   - Every ring goes through cleanRing2 (outer CCW, hole CW, no repeated or collinear points) and is
     rounded to 0.001 ft again, with -0 turned into 0. A ring that is too small (under 0.25 sf) is
     dropped. A building or a polygon without an outer ring is dropped; a hole that is dropped does
     not drop its polygon.
   - Every coordinate is rounded to 0.001 ft. The ground grid is rounded to 0.01 ft: it is the one
     large array (n * n points, 10,000 at most).
   - base, height and top of a building are rounded to 0.001 ft, then top = base + height.
   - One Overture feature can give several pieces with the same id. Later pieces get the suffix
     "~2", "~3", so every id in the section is unique.
   - Road centerlines and water lines keep the draped points of the model (one every 10 ft). Only
     the rounding changes. A point that repeats after the rounding is dropped.
   - walks is null when the model has no walk layer, and a MultiPoly (maybe empty) when it has one.
   - latitude and longitude are copied as they are. They are not feet.
   - Removed buildings (meta.removed, an array or a Set of ids): every building stays in the section, and a removed
     one gets `removed: true`. A building that is not removed has no `removed` key. The match ignores the piece
     suffix on both sides ("b", "b~2" and "b~3" are one Overture feature), so one feature is removed as one building.
   ========================================================================== */

import { cleanRing2 } from "../shared/sketchup-format.js";

const r3 = (v) => { const x = Math.round(v * 1000) / 1000; return x === 0 ? 0 : x; };    // also turns -0 into 0
const r2 = (v) => { const x = Math.round(v * 100) / 100; return x === 0 ? 0 : x; };
const fin = Number.isFinite;

/** A cleaned plan ring (outer CCW, hole CW, 0.001 ft), or null when it is degenerate. */
function ring(r, hole) {
  const c = cleanRing2(r, { hole });
  return c ? c.map((p) => [r3(p[0]), r3(p[1])]) : null;
}

const holesOf = (holes) => (holes || []).map((h) => ring(h, true)).filter(Boolean);

/** [{ outer, holes }] with every ring cleaned. Polygons without an outer ring are dropped. */
function multiPoly(mp) {
  const out = [];
  for (const p of mp || []) {
    const outer = ring(p.outer, false);
    if (outer) out.push({ outer, holes: holesOf(p.holes) });
  }
  return out;
}

/** [[x, y, z], …] rounded to 0.001 ft. Points that are not finite, or that repeat, are dropped. */
function line3(l) {
  const out = [];
  for (const p of l || []) {
    if (!p || !fin(p[0]) || !fin(p[1]) || !fin(p[2])) continue;
    const q = [r3(p[0]), r3(p[1]), r3(p[2])], last = out[out.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1] && last[2] === q[2]) continue;
    out.push(q);
  }
  return out;
}

/** Makes every id unique: the second piece with the id "x" becomes "x~2", the third "x~3". */
function uniqueIds(items) {
  const seen = new Map();
  for (const it of items) {
    const n = (seen.get(it.id) || 0) + 1;
    seen.set(it.id, n);
    if (n > 1) it.id = `${it.id}~${n}`;
  }
  return items;
}

/** The Overture feature id of a building id: the id without the piece suffix ("b~2" gives "b"). */
export function featureId(id) {
  return String(id ?? "").replace(/~\d+$/, "");
}

/**
 * The removed ids as a Set of feature ids (piece suffix dropped). Takes an array, a Set, or nothing.
 * Empty, null and undefined entries are dropped.
 */
export function removedSet(removed) {
  const out = new Set();
  if (removed instanceof Set || Array.isArray(removed)) {
    for (const id of removed) if (id !== undefined && id !== null && String(id) !== "") out.add(featureId(id));
  }
  return out;
}

/** True when the building id (with or without a piece suffix) is in the set from removedSet(). */
export function isRemovedId(id, set) {
  return !!set && set.size > 0 && set.has(featureId(id));
}

/** Every grid node, row-major from the south (index j * n + i is node (xs[i], ys[j])), rounded to 0.01 ft. */
function groundGrid(g) {
  const { n, spacing, xs, ys, z } = g;
  if (!(n >= 2) || !z || z.length !== n * n) throw new Error("siteDerived: the ground grid is not n by n.");
  const points = new Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!fin(z[k])) throw new Error("siteDerived: a ground point has no elevation.");
      points[k] = [r2(xs[i]), r2(ys[j]), r2(z[k])];
    }
  }
  return { spacing: r3(spacing), n, points };
}

/**
 * The `derived` half of the "site" section (spec 6.1).
 * @param model  { frame, ground, buildings, roads, trees, water } from model.js
 * @param meta   { address, lat, lon, size, release, removed }  (lat, lon, size fall back to the frame of the model;
 *               removed is an array or a Set of building ids)
 * @returns {object} plain JSON data: { address, lat, lon, size, release, boundary, ground, buildings, roads, walks, trees, water }
 *               A building whose id is in meta.removed carries `removed: true`; the others have no `removed` key.
 */
export function siteDerived(model, meta = {}) {
  const fr = model.frame || {};
  const size = fin(meta.size) ? meta.size : fr.size;
  const lat = fin(meta.lat) ? meta.lat : fr.lat0, lon = fin(meta.lon) ? meta.lon : fr.lon0;
  if (!fin(size) || size <= 0) throw new Error("siteDerived: the site size is missing.");
  if (!fin(lat) || !fin(lon)) throw new Error("siteDerived: the site center is missing.");
  const S = r3(size), roads = model.roads || {}, water = model.water || {};

  const gone = removedSet(meta.removed);
  const buildings = [];
  for (const b of model.buildings || []) {
    const outer = ring(b.ring, false);
    if (!outer || !fin(b.base) || !fin(b.height)) continue;
    const base = r3(b.base), height = r3(b.height);
    buildings.push({
      id: String(b.id), outer, holes: holesOf(b.holes), base, height, top: r3(base + height),
      floors: fin(b.floors) ? b.floors : Math.max(1, Math.round(height / 12)), rule: b.rule, name: String(b.name || ""),
    });
    if (isRemovedId(b.id, gone)) buildings[buildings.length - 1].removed = true;
  }

  const segments = [];
  for (const s of roads.segments || []) {
    const line = line3(s.line);
    if (line.length >= 2 && fin(s.width)) segments.push({ id: String(s.id), cls: String(s.cls || "unknown"), name: String(s.name || ""), width: r3(s.width), line });
  }

  const trees = [];
  for (const t of model.trees || []) {
    if (fin(t.x) && fin(t.y) && fin(t.z)) trees.push({ x: r3(t.x), y: r3(t.y), z: r3(t.z), canopy: fin(t.canopy) ? r3(t.canopy) : 20, height: fin(t.height) ? r3(t.height) : 30 });
  }

  const areas = [];
  for (const a of water.areas || []) {
    const outer = ring(a.ring, false);
    if (outer && fin(a.level)) areas.push({ ring: outer, holes: holesOf(a.holes), level: r3(a.level), cls: String(a.cls || "water") });
  }

  return {
    address: String(meta.address ?? ""),
    lat, lon, size: S,
    release: meta.release ? String(meta.release) : null,
    boundary: [[0, 0], [S, 0], [S, S], [0, S]],
    ground: groundGrid(model.ground),
    buildings: uniqueIds(buildings),
    roads: { segments: uniqueIds(segments), pavement: multiPoly(roads.pavement) },
    walks: roads.walks ? multiPoly(roads.walks) : null,
    trees,
    water: { areas, lines: (water.lines || []).map(line3).filter((l) => l.length >= 2) },
  };
}

/**
 * The `state` half of the "site" section (spec 6.1): the fetch parameters. With them the page loads the site again.
 * @param meta  { address, lat, lon, size, release, walks, removed }  (address is the text the user typed; removed is an
 *              array or a Set of building ids)
 * @returns {{ query, lat, lon, size, release, walks, removed: string[] }}  removed: the ids as given, strings, unique,
 *              sorted; [] when meta has none.
 */
export function siteState(meta = {}) {
  const ids = new Set();
  if (meta.removed instanceof Set || Array.isArray(meta.removed)) {
    for (const id of meta.removed) if (id !== undefined && id !== null && String(id) !== "") ids.add(String(id));
  }
  return {
    query: String(meta.address ?? ""),
    lat: meta.lat, lon: meta.lon, size: meta.size,
    release: meta.release ? String(meta.release) : null,
    walks: !!meta.walks,
    removed: [...ids].sort(),
  };
}

/** Size of the derived data as JSON text, in bytes (UTF-8). For the size notice. */
export function derivedBytes(derived) {
  const text = JSON.stringify(derived);
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length;
}
