/* ==========================================================================
   viewer/scene.js — Model Viewer: every section of a project as items in the PROJECT frame
   (docs/model-viewer-technical-plan.md sections 2 and 3).

   layersFrom(doc, opts)        → { site, massing, units, cores, parking, grading, sun }, each { ok, items, bounds, ... }
                                (the hidden facade layer comes only with opts.includeHidden)
   levelsIndex(doc)             → [{ key, z, name, ftf, sources }] sorted by z (the level cut list)
   cutAt(layers, z)             → a new layers object: no solid above z, the cut level marked (item.cut = true)
   colorKey(item, mode)         → a palette key; colorOf(key) → "#rrggbb"
   sunSamples(doc)              → { dates, byDate: { date: [{ time, azimuth, altitude }] } }

   Item shapes (project frame, feet):
     solid  { id, layer, kind, outer, holes, z0, z1, program?, type?, tool, data: { title, rows: [[label, text]] } }
     flat   { id, layer, kind: "stall", outer, z0 = z1, line3, ... }      (parking stalls)
     line   { id, layer, kind: "ramp", line3, outer3 }                     (a ramp strip, 3D ring)
     ground { id, layer, kind: "ground", grid: { n, spacing, points } }    (the proposed ground)
   Every z = local z + placement.baseZ. A section without a placement of its own takes the massing placement.

   Rules: pure, no DOM, no Three.js, never mutates the document, skips malformed items, no NaN.
   An unknown (newer) section schema is read as far as it parses; opts.onWarn(message) runs once per section.
   ========================================================================== */

import { getSection, transformRing } from "../shared/project.js";
import { siteBounds } from "../shared/sitelayer.js";

/** Layers that are hidden from the viewer (Facade Studio hidden October 26, 2026). The parsing code stays; layersFrom adds a hidden layer only with opts.includeHidden. */
export const HIDDEN_LAYERS = new Set(["facade"]);
export const LAYER_IDS = ["site", "massing", "units", "cores", "parking", "grading", "sun"];
export const LAYER_LABELS = { site: "Site", massing: "Massing", units: "Units", cores: "Cores and corridors", parking: "Parking", facade: "Facade", grading: "Grading", sun: "Sun" };
/** The tool that owns the data of each layer: the "Edit in" link opens ../<tool>/?project=<id>. */
export const LAYER_TOOLS = { site: "site", massing: "tower", units: "plate", cores: "plate", parking: "parking", facade: "facade", grading: "grading", sun: "tower" };
export const TOOL_NAMES = { site: "Site Model", tower: "Tower Generator", midrise: "Mid-Rise Generator", plate: "Plate Planner", parking: "Parking Deck", facade: "Facade Studio", grading: "Grading Sketch" };
export const DEFAULT_ON = { site: true, massing: true, units: true, cores: true, parking: true, facade: false, grading: false, sun: true };

export const DEFAULT_FTF = 10;
export const SLAB = 0.8;          // ft, the parking slab under the floor surface
export const BAND = 0.6;          // ft, the thickness of a facade band
export const WALL_T = 1;          // ft, the thickness of a grading wall
const KEEP_EPS = 0.25;            // ft, an item at or below the cut level plus this stays
const MARK_EPS = 1;               // ft, an item this close to the cut floor is the cut level

/* ---------- helpers ---------- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, d) => (fin(v) ? v : d);
const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const ZERO = { x: 0, y: 0, rotation: 0, baseZ: 0 };

function secOf(doc, key) {
  const sec = getSection(doc, key);
  return sec && isObj(sec.derived) && Object.keys(sec.derived).length ? sec : null;
}
/** The placement to map a section with. Falls back to `fb`, then to the identity. */
function placeOf(sec, fb) {
  const p = sec && isObj(sec.placement) ? sec.placement : fb || ZERO;
  return { x: num(p.x, 0), y: num(p.y, 0), rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) };
}

/** A ring of finite [x, y] points without repeated neighbours or closing point, or null. */
export function cleanRing(ring) {
  if (!Array.isArray(ring)) return null;
  const out = [];
  for (const p of ring) {
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) return null;
    const l = out[out.length - 1];
    if (l && l[0] === p[0] && l[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}
/** Signed plan area, positive when counter-clockwise. */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
/** One { outer, holes } piece in the project frame, or null. */
function piece(pl, p) {
  if (!isObj(p)) return null;
  const outer = cleanRing(p.outer);
  if (!outer || Math.abs(ringArea(outer)) < 0.25) return null;
  const holes = [];
  for (const h of Array.isArray(p.holes) ? p.holes : []) { const c = cleanRing(h); if (c) holes.push(transformRing(pl, c, "toProject")); }
  return { outer: transformRing(pl, outer, "toProject"), holes };
}
const pieces = (pl, mp) => (Array.isArray(mp) ? mp.map((p) => piece(pl, p)).filter(Boolean) : []);
const areaOf = (p) => Math.abs(ringArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0);
const sf = (v) => `${Math.round(v).toLocaleString("en-US")} sf`;
const ft = (v) => `${r1(v)} ft`;

function empty(extra) {
  return { ok: false, items: [], bounds: null, ...(extra || {}) };
}
function finish(layer, ok) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, zMin = Infinity, zMax = -Infinity;
  const add = (x, y, z) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  };
  for (const it of layer.items) {
    if (it.outer) for (const p of it.outer) add(p[0], p[1], fin(it.z0) ? it.z0 : 0), add(p[0], p[1], fin(it.z1) ? it.z1 : fin(it.z0) ? it.z0 : 0);
    if (it.line3) for (const p of it.line3) add(p[0], p[1], p[2]);
    if (it.outer3) for (const p of it.outer3) add(p[0], p[1], p[2]);
  }
  layer.bounds = minX <= maxX ? { minX: r3(minX), maxX: r3(maxX), minY: r3(minY), maxY: r3(maxY), zMin: r3(zMin), zMax: r3(zMax) } : null;
  layer.ok = ok === undefined ? layer.items.length > 0 : !!ok;
  return layer;
}
const card = (title, rows) => ({ title, rows: rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== "") });

/* ---------- levels of the massing ---------- */

/** [{ index, name, z, ftf, program, zone, plates }] of massing.derived.levels (z and ftf as given; defaults filled). */
function massingLevelList(doc) {
  const sec = secOf(doc, "massing");
  const list = sec && Array.isArray(sec.derived.levels) ? sec.derived.levels : [];
  const out = [];
  list.forEach((l, i) => {
    if (!isObj(l)) return;
    const index = fin(l.index) ? l.index : i + 1;
    const ftf = fin(l.ftf) && l.ftf > 0 ? l.ftf : DEFAULT_FTF;
    out.push({ index, name: typeof l.name === "string" && l.name ? l.name : `Floor ${index}`, z: fin(l.z) ? l.z : (index - 1) * ftf, ftf, program: typeof l.program === "string" && l.program ? l.program : null, zone: typeof l.zone === "string" ? l.zone : null, plates: l.plates,
      tower: fin(l.tower) ? l.tower : null, level: fin(l.level) ? l.level : null });
  });
  return out;
}

/* ---------- the layers ---------- */

function siteLayer(doc) {
  const sec = secOf(doc, "site");
  const L = empty({ ground: null });
  if (!sec) return L;
  const dv = sec.derived, pl = placeOf(sec, ZERO);
  let sb = null;
  try { sb = siteBounds(dv); } catch (e) { sb = null; }
  if (!sb) return L;
  const boundary = transformRing(pl, sb.boundary, "toProject");
  L.boundary = boundary;
  const g = isObj(dv.ground) ? dv.ground : null;
  if (g && Array.isArray(g.points) && fin(g.n) && g.points.length === g.n * g.n) {
    let zMin = Infinity, zMax = -Infinity;
    for (const p of g.points) if (Array.isArray(p) && fin(p[2])) { zMin = Math.min(zMin, p[2] + pl.baseZ); zMax = Math.max(zMax, p[2] + pl.baseZ); }
    if (zMin <= zMax) L.ground = { n: g.n, spacing: g.spacing, zMin: r3(zMin), zMax: r3(zMax) };
  }
  (Array.isArray(dv.buildings) ? dv.buildings : []).forEach((b, i) => {
    if (!isObj(b) || b.removed === true) return;
    const p = piece(pl, { outer: b.outer, holes: b.holes });
    if (!p) return;
    const height = fin(b.height) ? b.height : fin(b.top) && fin(b.base) ? b.top - b.base : 0;
    if (!(height > 0)) return;
    const z0 = fin(b.base) ? b.base + pl.baseZ : L.ground ? L.ground.zMin : 0;
    const id = b.id !== undefined && b.id !== null ? String(b.id) : `b${i}`;
    L.items.push({ id: `site:${id}`, layer: "site", kind: "neighbor", outer: p.outer, holes: p.holes, z0: r3(z0), z1: r3(z0 + height), tool: "site",
      data: card(b.name || "Neighbor building", [["Height", ft(height)], ["Floors", fin(b.floors) ? String(b.floors) : ""], ["Footprint", sf(areaOf(p))]]) });
  });
  const ok = true;
  finish(L, ok);
  if (L.ground) {                                       // the ground counts in the bounds
    const sbx = sb.boundary.map((q) => transformRing(pl, [q], "toProject")[0]);
    const xs = sbx.map((q) => q[0]), ys = sbx.map((q) => q[1]);
    const b = L.bounds || { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, zMin: L.ground.zMin, zMax: L.ground.zMax };
    L.bounds = { minX: Math.min(b.minX, ...xs), maxX: Math.max(b.maxX, ...xs), minY: Math.min(b.minY, ...ys), maxY: Math.max(b.maxY, ...ys), zMin: Math.min(b.zMin, L.ground.zMin), zMax: Math.max(b.zMax, L.ground.zMax) };
  } else if (!L.bounds) {
    const xs = boundary.map((q) => q[0]), ys = boundary.map((q) => q[1]);
    L.bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), zMin: 0, zMax: 0 };
  }
  return L;
}

/** The set of massing level indices that the plates section covers. */
function coveredIndices(doc) {
  const sec = secOf(doc, "plates");
  const out = new Set();
  if (sec && Array.isArray(sec.derived.levels)) for (const l of sec.derived.levels) if (isObj(l) && fin(l.index)) out.add(l.index);
  return out;
}

function massingLayer(doc) {
  const sec = secOf(doc, "massing");
  const L = empty();
  if (!sec) return L;
  const pl = placeOf(sec, ZERO), levels = massingLevelList(doc);
  if (!levels.length) return L;
  // Several towers (levels carry `tower`): the Plate Planner units are never current (app/core/cover.js), so no level is covered.
  const covered = levels.some((lv) => lv.tower !== null) ? new Set() : coveredIndices(doc);
  for (const lv of levels) {
    if (covered.has(lv.index)) continue;
    const ps = pieces(pl, lv.plates);
    ps.forEach((p, k) => {
      const z0 = r3(lv.z + pl.baseZ);
      L.items.push({ id: `massing:${lv.index}:${k}`, layer: "massing", kind: "level", outer: p.outer, holes: p.holes, z0, z1: r3(z0 + lv.ftf), program: lv.program, level: lv.index, tool: sec.tool || "tower",
        data: card(lv.name, [...(lv.tower !== null ? [["Tower", String(lv.tower + 1)]] : []), ["Program", lv.program || ""], ["Zone", lv.zone || ""], ["Plate area", sf(areaOf(p))], ["Floor to floor", ft(lv.ftf)], ["Level", String(lv.level !== null ? lv.level : lv.index)]]) });
    });
  }
  return finish(L, true);
}

/** [{ index, name, z (project), ftf, program, level: the plates level record }] for the plates section. */
function platesLevelList(doc) {
  const sec = secOf(doc, "plates");
  if (!sec || !Array.isArray(sec.derived.levels)) return [];
  const mass = massingLevelList(doc), msec = getSection(doc, "massing");
  const pl = placeOf(sec, msec && isObj(msec.placement) ? msec.placement : ZERO);
  const out = [];
  for (const l of sec.derived.levels) {
    if (!isObj(l) || !fin(l.index)) continue;
    const m = mass.find((x) => x.index === l.index) || null;
    const ftf = m ? m.ftf : fin(l.ftf) && l.ftf > 0 ? l.ftf : DEFAULT_FTF;
    const z = m ? m.z : fin(l.z) ? l.z : (l.index - 1) * ftf;
    out.push({ index: l.index, name: m ? m.name : typeof l.name === "string" && l.name ? l.name : `Level ${l.index}`, z: r3(z + pl.baseZ), ftf, program: m ? m.program : null, pl, rec: l });
  }
  return out;
}

function unitsAndCores(doc) {
  const U = empty(), C = empty();
  const sec = secOf(doc, "plates");
  if (!sec) return { units: U, cores: C };
  for (const lv of platesLevelList(doc)) {
    const { pl, rec } = lv, z0 = lv.z, z1 = r3(lv.z + lv.ftf);
    for (const u of Array.isArray(rec.units) ? rec.units : []) {
      const p = piece(pl, { outer: u && u.outer });
      if (!p) continue;
      const area = fin(u.area) ? u.area : areaOf(p);
      const flags = Array.isArray(u.flags) ? u.flags.filter((f) => typeof f === "string") : [];
      U.items.push({ id: `unit:${lv.index}:${u.id !== undefined ? u.id : U.items.length}`, layer: "units", kind: "unit", outer: p.outer, holes: [], z0, z1, program: lv.program, type: typeof u.type === "string" ? u.type : "Unit", level: lv.index, tool: "plate",
        data: card(`Unit ${u.id !== undefined ? u.id : ""}`.trim(), [["Type", u.type || "Unit"], ["Area", sf(area)], ["Level", lv.name], ["Exposures", Array.isArray(u.exposures) && u.exposures.length ? u.exposures.join(" ") : "None"], ["Corner", u.corner ? "Yes" : ""], ["Flags", flags.join(", ")]]) });
    }
    const c = isObj(rec.core) ? rec.core : null;
    const add = (kind, id, ring, label, extra) => {
      const p = piece(pl, { outer: ring });
      if (!p) return;
      C.items.push({ id: `core:${lv.index}:${kind}:${id}`, layer: "cores", kind, outer: p.outer, holes: [], z0, z1, program: null, level: lv.index, tool: "plate", data: card(label, [["Level", lv.name], ["Area", sf(areaOf(p))], ...(extra || [])]) });
    };
    if (c) {
      const rooms = Array.isArray(c.rooms) ? c.rooms.filter((r) => isObj(r) && cleanRing(r.outer)) : [];
      const stairs = Array.isArray(c.stairs) ? c.stairs : [], elevators = Array.isArray(c.elevators) ? c.elevators : [];
      if (rooms.length) rooms.forEach((r, i) => add(`room-${typeof r.kind === "string" ? r.kind : "room"}`, r.id !== undefined ? r.id : i, r.outer, `Core room ${r.id !== undefined ? r.id : ""} (${r.kind || "room"})`.replace("  ", " ")));
      else if (stairs.length || elevators.length) {
        stairs.forEach((s, i) => add("stair", s && s.id !== undefined ? s.id : i, s && s.outer, `Stair ${s && s.id !== undefined ? s.id : ""}`.trim()));
        elevators.forEach((e, i) => add("elevator", e && e.id !== undefined ? e.id : i, e && e.outer, `Elevator ${e && e.id !== undefined ? e.id : ""}`.trim()));
      } else add("core", "core", c.outer, "Core");
    }
    pieces(pl, rec.corridor).forEach((p, k) => {
      C.items.push({ id: `core:${lv.index}:corridor:${k}`, layer: "cores", kind: "corridor", outer: p.outer, holes: p.holes, z0, z1, program: null, level: lv.index, tool: "plate", data: card("Corridor", [["Level", lv.name], ["Area", sf(areaOf(p))]]) });
    });
  }
  return { units: finish(U), cores: finish(C) };
}

/** [{ index, z (project), ftf, pl, rec }] for the parking section, by z. */
function parkingLevelList(doc) {
  const sec = secOf(doc, "parking");
  if (!sec || !Array.isArray(sec.derived.levels)) return [];
  const msec = getSection(doc, "massing");
  const pl = placeOf(sec, msec && isObj(msec.placement) ? msec.placement : ZERO);
  const out = [];
  sec.derived.levels.forEach((l, i) => { if (isObj(l)) out.push({ index: fin(l.index) ? l.index : i + 1, z: r3(num(l.z, 0) + pl.baseZ), pl, rec: l }); });
  out.sort((a, b) => a.z - b.z || a.index - b.index);
  out.forEach((l, i) => {
    const next = out[i + 1], d = next ? next.z - l.z : 0;
    l.ftf = d > 4 ? r3(d) : i > 0 ? out[i - 1].ftf : 10.5;
  });
  return out;
}

function parkingLayer(doc) {
  const L = empty();
  const levels = parkingLevelList(doc);
  if (!levels.length) return L;
  for (const lv of levels) {
    const { pl, rec } = lv, zf = lv.z;
    pieces(pl, rec.plate).forEach((p, k) => {
      L.items.push({ id: `parking:${lv.index}:slab:${k}`, layer: "parking", kind: "slab", outer: p.outer, holes: p.holes, z0: r3(zf - SLAB), z1: zf, level: lv.index, tool: "parking",
        data: card(`Parking level ${lv.index}`, [["Floor", `${r1(zf)} ft`], ["Plate area", sf(areaOf(p))], ["Stalls", Array.isArray(rec.stalls) ? String(rec.stalls.length) : ""]]) });
    });
    (Array.isArray(rec.stalls) ? rec.stalls : []).forEach((s, i) => {
      const r = cleanRing(s && s.outer);
      if (!r) return;
      const o = transformRing(pl, r, "toProject"), z = r3(zf + 0.05);
      const kind = typeof s.kind === "string" ? s.kind : "standard";
      L.items.push({ id: `stall:${lv.index}:${s.id !== undefined ? s.id : i}`, layer: "parking", kind: "stall", stall: kind, outer: o, holes: [], z0: z, z1: z, line3: o.concat([o[0]]).map((q) => [q[0], q[1], z]), level: lv.index, tool: "parking",
        data: card(`Stall ${s.id !== undefined ? s.id : ""}`.trim(), [["Kind", kind], ["EV ready", s.evReady ? "Yes" : ""], ["Level", `Parking level ${lv.index}`]]) });
    });
    (Array.isArray(rec.ramps) ? rec.ramps : []).forEach((rp, i) => {
      const pts = rp && Array.isArray(rp.outer3d) ? rp.outer3d.filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]) && fin(q[2])) : [];
      if (pts.length < 3) return;
      const o3 = transformRing(pl, pts.map((q) => [q[0], q[1], q[2]]), "toProject");
      L.items.push({ id: `ramp:${lv.index}:${rp.id !== undefined ? rp.id : i}`, layer: "parking", kind: "ramp", outer3: o3, line3: o3.concat([o3[0]]), level: lv.index, tool: "parking",
        data: card(`Ramp ${rp.id !== undefined ? rp.id : ""}`.trim(), [["Slope", fin(rp.slope) ? `${r1(rp.slope * 100)} percent` : ""], ["Level", `Parking level ${lv.index}`]]) });
    });
    (Array.isArray(rec.cores) ? rec.cores : []).forEach((c, i) => {
      const p = piece(pl, { outer: c && c.outer });
      if (!p) return;
      L.items.push({ id: `pcore:${lv.index}:${c.id !== undefined ? c.id : i}`, layer: "parking", kind: "core", outer: p.outer, holes: [], z0: zf, z1: r3(zf + lv.ftf), level: lv.index, tool: "parking",
        data: card(`${c.kind === "elevator" ? "Elevator" : "Stair"} ${c.id !== undefined ? c.id : ""}`.trim(), [["Level", `Parking level ${lv.index}`]]) });
    });
  }
  return finish(L);
}

function facadeLayer(doc) {
  const sec = secOf(doc, "facade");
  const L = empty({ skipped: 0 });
  if (!sec || !Array.isArray(sec.derived.faces) || !sec.derived.faces.length) return L;
  const msec = getSection(doc, "massing");
  const pl = placeOf(sec, msec && isObj(msec.placement) ? msec.placement : ZERO);
  const mass = massingLevelList(doc);
  const levelOf = (i) => mass.find((m) => m.index === i) || null;
  for (const f of sec.derived.faces) {
    if (!isObj(f)) continue;
    const e = Array.isArray(f.edge) && f.edge.length === 2 ? f.edge : null;
    const a = e && Array.isArray(e[0]) && fin(e[0][0]) && fin(e[0][1]) ? e[0] : null, b = e && Array.isArray(e[1]) && fin(e[1][0]) && fin(e[1][1]) ? e[1] : null;
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) { L.skipped++; continue; }
    const from = fin(f.levelFrom) ? f.levelFrom : 1, to = fin(f.levelTo) ? f.levelTo : from;
    const lf = levelOf(from), lt = levelOf(to);
    const z0 = (lf ? lf.z : (from - 1) * DEFAULT_FTF) + pl.baseZ;
    const z1 = (lt ? lt.z + lt.ftf : to * DEFAULT_FTF) + pl.baseZ;
    if (!(z1 - z0 > 0.001)) { L.skipped++; continue; }
    const [p0, p1] = transformRing(pl, [a, b], "toProject");
    let nx, ny;
    if (fin(f.bearing)) { const r = (f.bearing * Math.PI) / 180; nx = Math.sin(r); ny = Math.cos(r); }
    else { const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy); nx = dy / len; ny = -dx / len; }
    const ring = [p0, p1, [p1[0] + nx * BAND, p1[1] + ny * BAND], [p0[0] + nx * BAND, p0[1] + ny * BAND]].map((q) => [r3(q[0]), r3(q[1])]);
    if (ringArea(ring) < 0) ring.reverse();
    if (Math.abs(ringArea(ring)) < 0.25) { L.skipped++; continue; }
    const system = typeof f.system === "string" && f.system ? f.system : "solid";
    L.items.push({ id: `facade:${f.id !== undefined ? f.id : L.items.length}`, layer: "facade", kind: "face", system, outer: ring, holes: [], z0: r3(z0), z1: r3(z1), tool: "facade",
      data: card(`Face ${f.id !== undefined ? f.id : ""}`.trim(), [["System", system], ["Orientation", f.orientation || ""], ["Window-to-wall", fin(f.wwr) ? `${Math.round(f.wwr * 100)} percent` : ""], ["Wall area", fin(f.area) ? sf(f.area) : ""], ["Glazing", fin(f.glazing) ? sf(f.glazing) : ""], ["Balconies", fin(f.balconies) ? String(f.balconies) : ""], ["Levels", `${from} to ${to}`]]) });
  }
  return finish(L, true);
}

function gradingLayer(doc) {
  const sec = secOf(doc, "grading");
  const L = empty({ ground: null });
  if (!sec) return L;
  const pl = placeOf(sec, ZERO), dv = sec.derived;
  const g = isObj(dv.ground) ? dv.ground : null;
  let hasGround = false;
  if (g && Array.isArray(g.points) && Number.isInteger(g.n) && g.n >= 2 && g.points.length === g.n * g.n && fin(g.spacing) && g.spacing > 0) {
    let zMin = Infinity, zMax = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, bad = false;
    for (const p of g.points) {
      if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1]) || !fin(p[2])) { bad = true; break; }
      zMin = Math.min(zMin, p[2] + pl.baseZ); zMax = Math.max(zMax, p[2] + pl.baseZ); minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    if (!bad) {
      hasGround = true;
      L.ground = { n: g.n, spacing: g.spacing, zMin: r3(zMin), zMax: r3(zMax), minX: r3(minX), maxX: r3(maxX), minY: r3(minY), maxY: r3(maxY) };
      L.items.push({ id: "grading:ground", layer: "grading", kind: "ground", grid: g, tool: "grading", data: card("Proposed ground", [["Cut", fin(dv.metrics && dv.metrics.cutCy) ? `${Math.round(dv.metrics.cutCy).toLocaleString("en-US")} cy` : ""], ["Fill", fin(dv.metrics && dv.metrics.fillCy) ? `${Math.round(dv.metrics.fillCy).toLocaleString("en-US")} cy` : ""]]) });
    }
  }
  (Array.isArray(dv.walls) ? dv.walls : []).forEach((w, wi) => {
    const line = w && Array.isArray(w.line) ? w.line.filter((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]) && fin(q[2])) : [];
    const h = Math.max(0.5, num(w && (w.heightAvg || w.heightMax), 1));
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (!(len > 0.05)) continue;
      const nx = (-dy / len) * (WALL_T / 2), ny = (dx / len) * (WALL_T / 2);
      const ring = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
      if (ringArea(ring) < 0) ring.reverse();
      const o = transformRing(pl, ring, "toProject"), top = (a[2] + b[2]) / 2 + pl.baseZ;
      L.items.push({ id: `wall:${w.id !== undefined ? w.id : wi}:${i}`, layer: "grading", kind: "wall", outer: o, holes: [], z0: r3(top - h), z1: r3(top), tool: "grading",
        data: card(`Wall ${w.id !== undefined ? w.id : ""}`.trim(), [["Kind", w.kind || ""], ["Height, average", fin(w.heightAvg) ? ft(w.heightAvg) : ""], ["Height, tallest", fin(w.heightMax) ? ft(w.heightMax) : ""], ["Length", fin(w.length) ? ft(w.length) : ""]]) });
    }
  });
  finish(L, hasGround || L.items.length > 0);
  if (L.ground) {
    const b = L.bounds || { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, zMin: Infinity, zMax: -Infinity };
    L.bounds = { minX: Math.min(b.minX, L.ground.minX), maxX: Math.max(b.maxX, L.ground.maxX), minY: Math.min(b.minY, L.ground.minY), maxY: Math.max(b.maxY, L.ground.maxY), zMin: Math.min(b.zMin, L.ground.zMin), zMax: Math.max(b.zMax, L.ground.zMax) };
  }
  return L;
}

/** { dates, byDate } of sun.derived.samples (finite azimuth and altitude only). */
export function sunSamples(doc) {
  const sec = secOf(doc, "sun");
  const byDate = {}, dates = [];
  for (const s of sec && Array.isArray(sec.derived.samples) ? sec.derived.samples : []) {
    if (!isObj(s) || typeof s.date !== "string" || typeof s.time !== "string" || !fin(s.azimuth) || !fin(s.altitude)) continue;
    if (!byDate[s.date]) { byDate[s.date] = []; dates.push(s.date); }
    byDate[s.date].push({ time: s.time, azimuth: s.azimuth, altitude: s.altitude });
  }
  dates.sort();
  for (const d of dates) byDate[d].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return { dates, byDate };
}
function sunLayer(doc) {
  const s = sunSamples(doc);
  return { ok: s.dates.length > 0, items: [], bounds: null, dates: s.dates, byDate: s.byDate };
}

/**
 * Every layer in the project frame. opts.includeHidden adds the hidden layers (facade). opts.onWarn(message) runs once per section that has a newer schema.
 */
export function layersFrom(doc, opts) {
  const o = isObj(opts) ? opts : {};
  const warned = new Set();
  const guard = (key, fn, fallback) => {
    const sec = getSection(doc, key);
    if (sec && fin(sec.schema) && sec.schema > 1 && !warned.has(key) && typeof o.onWarn === "function") {
      warned.add(key);
      try { o.onWarn(`The ${key} section was saved by a newer version of its tool. The viewer shows what it can read.`); } catch (e) { /* ignore */ }
    }
    try { return fn(); } catch (e) { return fallback; }
  };
  const uc = guard("plates", () => unitsAndCores(doc), { units: empty(), cores: empty() });
  const hidden = o.includeHidden ? { facade: guard("facade", () => facadeLayer(doc), empty({ skipped: 0 })) } : {};
  return {
    ...hidden,
    site: guard("site", () => siteLayer(doc), empty({ ground: null })),
    massing: guard("massing", () => massingLayer(doc), empty()),
    units: uc.units,
    cores: uc.cores,
    parking: guard("parking", () => parkingLayer(doc), empty()),
    grading: guard("grading", () => gradingLayer(doc), empty({ ground: null })),
    sun: guard("sun", () => sunLayer(doc), { ok: false, items: [], bounds: null, dates: [], byDate: {} }),
  };
}

/* ---------- the level cut list ---------- */

/** [{ key, z, name, ftf, sources }] sorted by z. z is the floor surface in the project frame. Sources: "massing", "plates", "parking". */
export function levelsIndex(doc) {
  const map = new Map();
  const put = (z, name, ftf, source) => {
    if (!fin(z)) return;
    const key = `z${(Math.round(z * 10) / 10).toFixed(1)}`;
    let e = map.get(key);
    if (!e) { e = { key, z: r3(z), name, ftf, sources: [] }; map.set(key, e); }
    if (!e.sources.includes(source)) e.sources.push(source);
  };
  const msec = secOf(doc, "massing");
  const mpl = placeOf(msec, ZERO);
  for (const l of massingLevelList(doc)) put(l.z + mpl.baseZ, l.name, l.ftf, "massing");
  for (const l of platesLevelList(doc)) put(l.z, l.name, l.ftf, "plates");
  for (const l of parkingLevelList(doc)) put(l.z, `Parking level ${l.index}`, l.ftf, "parking");
  return [...map.values()].sort((a, b) => a.z - b.z);
}

const SOLID_LAYERS = new Set(["massing", "units", "cores", "parking", "facade", "grading"]);
const lowest = (it) => {
  if (fin(it.z0)) return it.z0;
  let m = Infinity;
  for (const p of it.line3 || it.outer3 || []) if (p[2] < m) m = p[2];
  return m;
};

/**
 * Plan cut at the floor surface z: every item of massing, units, cores, parking, facade and grading whose lowest point is above z (plus 0.25 ft)
 * goes away; a facade band that runs higher is cut to the top of the cut level. The site, the ground and the sun stay.
 * Items on the cut level get cut: true. Returns a new object; the input is unchanged.
 */
export function cutAt(layers, z) {
  const out = {};
  const cutZ = fin(z) ? z : Infinity;
  let top = null;
  for (const id of Object.keys(layers || {})) {
    for (const it of (layers[id] && layers[id].items) || []) {
      if (!SOLID_LAYERS.has(id) || it.kind === "ground" || it.kind === "face" || it.kind === "wall") continue;
      if (fin(it.z0) && fin(it.z1) && it.z1 > it.z0 && Math.abs(it.z0 - cutZ) <= MARK_EPS && !(it.layer === "parking" && it.kind === "slab")) top = top === null ? it.z1 : Math.max(top, it.z1);
    }
  }
  for (const id of Object.keys(layers || {})) {
    const L = layers[id];
    if (!L || !SOLID_LAYERS.has(id)) { out[id] = L; continue; }
    const items = [];
    for (const it of L.items || []) {
      if (it.kind === "ground") { items.push(it); continue; }
      const lo = lowest(it);
      if (lo > cutZ + KEEP_EPS) continue;
      let next = it;
      if (fin(it.z0) && Math.abs(it.z0 - cutZ) <= MARK_EPS && it.kind !== "neighbor") next = { ...next, cut: true };
      else if (it.line3 && lo >= cutZ - MARK_EPS) next = { ...next, cut: true };
      if (it.kind === "face" || it.kind === "wall") {
        if (top !== null && fin(it.z1) && it.z1 > top && it.kind === "face") next = { ...next, z1: r3(top) };
        if (it.kind === "wall") next = { ...next, z1: Math.min(it.z1, cutZ + KEEP_EPS) > it.z0 ? Math.min(it.z1, cutZ + KEEP_EPS) : it.z1 };
      }
      items.push(next);
    }
    out[id] = { ...L, items };
  }
  out.cutZ = cutZ;
  return out;
}

/* ---------- colors ---------- */

export const PROGRAM_COLORS = { residential: "#4f7fd1", hotel: "#8a63c9", office: "#2f9e9a", retail: "#d9a22b", amenity: "#58a65c", parking: "#8b929a", mechanical: "#e0762f" };
export const UNIT_COLORS = { Studio: "#9cc3e6", "1BR": "#4f7fd1", "1BR + den": "#6b5fc7", "2BR": "#2f9e9a", "3BR": "#d9a22b", King: "#8a63c9", "Double queen": "#b48ad9", Suite: "#5b3f99" };
const SYSTEM_COLORS = { punched: "#b59a7b", "window-wall": "#5aa7d8", "curtain-wall": "#3d8fcf", storefront: "#2f9e9a", solid: "#a3a8ae" };
const STALL_COLORS = { standard: "#5f6b79", compact: "#7d8794", accessible: "#2f6fb5", van: "#1d4f8a", ev: "#2f9e5b" };
const LAYER_COLORS = { site: "#c9cdd2", massing: "#8b929a", units: "#4f7fd1", cores: "#7b838b", parking: "#9aa1a9", facade: "#5aa7d8", grading: "#a85a12", sun: "#e0a458" };
const KIND_COLORS = { corridor: "#d9dadc", core: "#8f959c", stair: "#6f757c", elevator: "#a3a8ae", slab: "#a9afb6", ramp: "#e0a21b", wall: "#c4c8cc", neighbor: "#c9cdd2" };
const EXTRA = ["#4f7fd1", "#2f9e9a", "#d9a22b", "#8a63c9", "#58a65c", "#e0762f", "#b48ad9", "#6b5fc7"];

function hashColor(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return EXTRA[h % EXTRA.length]; }

/** The hex color of a palette key made by colorKey. */
export function colorOf(key) {
  const k = String(key || "");
  const i = k.indexOf(":"), kind = i < 0 ? k : k.slice(0, i), name = i < 0 ? "" : k.slice(i + 1);
  if (kind === "program") return PROGRAM_COLORS[name] || hashColor(name);
  if (kind === "unit") return UNIT_COLORS[name] || hashColor(name);
  if (kind === "facade") return SYSTEM_COLORS[name] || SYSTEM_COLORS.solid;
  if (kind === "stall") return STALL_COLORS[name] || STALL_COLORS.standard;
  if (kind === "kind") return KIND_COLORS[name] || "#9aa3ad";
  if (kind === "layer") return LAYER_COLORS[name] || "#9aa3ad";
  return "#9aa3ad";
}

/** The palette key of an item. mode: "program" | "unitType" | "source". */
export function colorKey(item, mode) {
  const it = item || {};
  if (it.kind === "stall") return `stall:${it.stall || "standard"}`;
  if (it.layer === "facade") return `facade:${it.system || "solid"}`;
  if (mode === "source") return `layer:${it.layer || "site"}`;
  if (mode === "unitType" && it.type) return `unit:${it.type}`;
  if (mode !== "unitType" && it.program) return `program:${it.program}`;
  if (it.layer === "cores" || it.layer === "parking" || it.layer === "grading" || it.layer === "site") return KIND_COLORS[it.kind] ? `kind:${it.kind}` : `layer:${it.layer}`;
  if (it.type) return `unit:${it.type}`;
  return `layer:${it.layer || "massing"}`;
}
