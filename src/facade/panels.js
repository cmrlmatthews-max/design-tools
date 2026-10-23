/* ==========================================================================
   panels.js — rules, panels, and the facade build (Facade Studio)

   Contract: docs/facade-studio-technical-plan.md sections 3.4 to 3.9 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs. Units: feet, square feet.
   buildFacade is the only function that reads the project.

   Caution: these are design defaults. They are not product sizes or code values.

   Rule choices where the plan leaves room:
   - ruleFor: the zone rule, then the orientation override, over the system
     defaults (state.systems over built-in copies of plan section 2). When an
     override changes `system`, the zone rule's system-specific keys (module,
     windowW, sill, head, vision, slabCover, solid) are dropped; `glazing` and
     `material` stay. An unknown system is punched.
   - facePanels order: system, solid pattern, glass corner (overrides the
     pattern, not on solid or storefront), balcony door (not on a solid
     panel). A balcony module that is solid is skipped, so the balcony count
     is the number of "door" panels. Window wall and curtain wall panels
     carry `spandrel: [{ u0, u1, v0, v1 }]` (the opaque bands inside a glazed
     panel); every panel has the key (empty when none).
   - Glass rectangles keep full precision. Face glazing and wall round to
     0.001 sf; metrics round the totals to 0.1 sf.
   - Per-level face geometry comes from group.edges (faces.js) when present,
     else from levelEdges matched to the group (same ring, end points within
     1 ft, direction within 1 degree), else from the group itself.
   - Fins: lines 1 to n-1 where i mod every = 0 (the end lines are left out
     so a corner does not get two). Draft quality skips fins.
   - Shades: one per panel of kind window, glass, or corner; none over a door.
     pf = depth / (glass height + above).
   - Bands: face.band = the material of the first band that matches the zone
     (or, with `every`, the level index mod every = 0).
   - Per-unit balconies read plates.derived only when the massing source is
     the project. A level without units falls back to stacked and raises one
     per-unit-fallback warning.
   - Warnings: { code, severity, floors, message }. massingLevels notes with
     id tower-no-levels, no-levels, or no-project-massing become warnings of
     the same code.
   ========================================================================== */

import * as FACES from "./faces.js";
import { balconyModules, unitBalconies, balconyGeometry, faceStrip } from "./balconies.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const ZONE_KEYS = ["module", "windowW", "sill", "head", "vision", "slabCover", "solid"];

const DEFAULT_SYSTEMS = {
  punched: { module: 14, windowW: 6, sill: 2.5, head: 8, mullionW: 0.1667, mullionD: 0.333 },
  windowWall: { module: 5, slabCover: 1.3333, mullionW: 0.2083, mullionD: 0.5 },
  curtainWall: { module: 5, vision: 8, sill: 0, mullionW: 0.2083, mullionD: 0.6667 },
  storefront: { module: 5, sill: 1.5, head: 10, mullionW: 0.1667, mullionD: 0.375 },
  solid: { module: 10 },
};
const SYSTEMS = Object.keys(DEFAULT_SYSTEMS);

/* ---------------------------------------------------------------- rules */

/** Plan 3.4. → the merged rule { system, module, ...system keys, solid?, glazing?, material? }. */
export function ruleFor(state, zoneId, orientation) {
  const st = state || {};
  const zones = st.zones || {};
  const base = (zones.rules && zones.rules[zoneId]) || (zoneId === "crown" ? { system: "solid" } : {});   // the crown is a screen unless a rule says otherwise
  const ov = (zones.overrides && zones.overrides[zoneId] && zones.overrides[zoneId][orientation]) || {};
  let rule = { ...base };
  if (ov.system && ov.system !== (base.system || "punched")) {
    rule = {};
    if (base.glazing !== undefined) rule.glazing = base.glazing;
    if (base.material !== undefined) rule.material = base.material;
  }
  rule = { ...rule, ...ov };
  const system = SYSTEMS.includes(rule.system) ? rule.system : "punched";
  const out = { ...DEFAULT_SYSTEMS[system], ...(st.systems && st.systems[system]), ...rule, system };
  if (out.solid && typeof out.solid === "object") out.solid = { count: out.solid.count, every: out.solid.every };
  else delete out.solid;
  return out;
}

/** Plan 3.6. n = max(1, floor(L / module)); the actual module is L / n. */
export function panelize(length, module) {
  const L = isNum(length) && length > 0 ? length : 0;
  const n = isNum(module) && module > 0 ? Math.max(1, Math.floor(L / module + 1e-9)) : 1;
  return { n, module: L / n };
}

/** Plan 3.6 and 3.7. face: { length, convexStart?, convexEnd? }. level: { ftf }.
    opts: { corners: "solid"|"glass", slabCover, balconies: [module index], door: { width, head } }.
    → Panel[] { i, u0, u1, kind, glass: [{ u0, u1, v0, v1 }], spandrel: [...] } (u along the face, v above the floor). */
export function facePanels(face, rule, level, opts = {}) {
  const r = rule || {};
  const sys = SYSTEMS.includes(r.system) ? r.system : "punched";
  const L = face.length;
  const h = isNum(level && level.ftf) ? level.ftf : face.ftf;
  const cl = (v) => Math.min(Math.max(v, 0), h);
  const { n, module: m } = panelize(L, r.module);
  const sp = r.solid;
  const every = sp ? Math.floor(sp.every) : 0, count = sp ? Math.floor(sp.count) : 0;
  const patterned = every >= 1 && count >= 1;
  const solidPat = (i) => patterned && i % every >= every - Math.min(count, every);
  const cover = isNum(opts.slabCover) ? opts.slabCover : sys === "windowWall" && isNum(r.slabCover) ? r.slabCover : DEFAULT_SYSTEMS.windowWall.slabCover;
  const cornerGlass = opts.corners === "glass" && sys !== "solid" && sys !== "storefront";
  const doors = new Set(Array.isArray(opts.balconies) ? opts.balconies : []);
  const door = opts.door || {};
  const out = [];
  for (let i = 0; i < n; i++) {
    const u0 = i * m, u1 = i === n - 1 ? L : (i + 1) * m;
    const p = { i, u0, u1, kind: "solid", glass: [], spandrel: [] };
    const full = (v0, v1) => ({ u0, u1, v0, v1 });
    let solid = sys === "solid" || solidPat(i);
    const isCorner = cornerGlass && ((i === 0 && face.convexStart) || (i === n - 1 && face.convexEnd));
    if (isCorner) {
      solid = false;
      p.kind = "corner";
      const v1 = cl(h - cover);
      p.glass.push(full(0, v1));
      if (v1 < h) p.spandrel.push(full(v1, h));
    } else if (!solid) {
      if (sys === "punched") {
        const w = Math.min(isNum(r.windowW) ? r.windowW : 6, u1 - u0);
        const v0 = cl(r.sill), v1 = cl(Math.min(r.head, h));
        p.kind = "window";
        const c = (u0 + u1) / 2;
        if (v1 > v0 && w > 0) p.glass.push({ u0: c - w / 2, u1: c + w / 2, v0, v1 });
      } else if (sys === "windowWall") {
        const v1 = cl(h - cover);
        p.kind = "glass";
        p.glass.push(full(0, v1));
        if (v1 < h) p.spandrel.push(full(v1, h));
      } else if (sys === "curtainWall") {
        const v0 = cl(r.sill), v1 = cl(Math.min((isNum(r.sill) ? r.sill : 0) + r.vision, h));
        p.kind = "glass";
        if (v1 > v0) p.glass.push(full(v0, v1));
        if (v0 > 0) p.spandrel.push(full(0, v0));
        if (v1 < h) p.spandrel.push(full(v1, h));
      } else if (sys === "storefront") {
        const v0 = cl(r.sill), v1 = cl(Math.min(r.head, h));
        p.kind = "glass";
        if (v1 > v0) p.glass.push(full(v0, v1));
      }
    }
    if (!solid && doors.has(i)) {
      const w = Math.min(isNum(door.width) ? door.width : 6, u1 - u0);
      const c = (u0 + u1) / 2;
      p.kind = "door";
      p.glass = [{ u0: c - w / 2, u1: c + w / 2, v0: 0, v1: cl(isNum(door.head) ? door.head : 8) }];
      p.spandrel = [];
    }
    out.push(p);
  }
  return out;
}

/* --------------------------------------------------------------- readers */

const orDefault = (v, d) => (Array.isArray(v) ? v : d);

function balconiesOf(state) {
  const b = state.balconies || {};
  return {
    on: b.on === true, type: b.type === "inset" ? "inset" : "projected", pattern: b.pattern || "stacked",
    spacing: isNum(b.spacing) ? b.spacing : 2, width: isNum(b.width) ? b.width : 12, depth: isNum(b.depth) ? b.depth : 6,
    slab: isNum(b.slab) ? b.slab : 1, door: { width: 6, head: 8, ...(b.door || {}) },
    zones: orDefault(b.zones, ["middle"]), orientations: orDefault(b.orientations, ["N", "E", "S", "W"]),
  };
}

function finsOf(state) {
  const f = state.fins || {};
  return { on: f.on === true, depth: isNum(f.depth) ? f.depth : 1.5, width: isNum(f.width) ? f.width : 0.1667,
    every: isNum(f.every) && f.every >= 1 ? Math.round(f.every) : 1, orientations: orDefault(f.orientations, ["E", "W"]), zones: orDefault(f.zones, ["middle", "top"]) };
}

function shadesOf(state) {
  const s = state.shades || {};
  return { on: s.on === true, depth: isNum(s.depth) ? s.depth : 2, above: isNum(s.above) ? s.above : 0.5,
    orientations: orDefault(s.orientations, ["S"]), zones: orDefault(s.zones, ["middle", "top"]) };
}

const plateSig = (mp) => JSON.stringify((mp || []).map((p) => [(p.outer || []).map((q) => [Math.round(q[0] * 100), Math.round(q[1] * 100)]),
  (p.holes || []).map((h) => h.map((q) => [Math.round(q[0] * 100), Math.round(q[1] * 100)]))]));

/** Plan 3.8: the plates.derived level with the same index, else the nearest lower filled level with an identical plate. */
function unitsFor(project, level, levelByIndex) {
  const list = project && project.sections && project.sections.plates && project.sections.plates.derived && project.sections.plates.derived.levels;
  if (!Array.isArray(list)) return null;
  const filled = (p) => p && Array.isArray(p.units) && p.units.length > 0;
  const exact = list.find((p) => p && p.index === level.index && filled(p));
  if (exact) return exact;
  const sig = plateSig(level.plates);
  const lower = list.filter((p) => filled(p) && p.index < level.index).sort((p, q) => q.index - p.index);
  for (const p of lower) {
    const own = p.plate || (levelByIndex.get(p.index) || {}).plates;
    if (own && plateSig(own) === sig) return p;
  }
  return null;
}

function angleDiff(a, b) {
  return Math.abs((((Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0])) * 180 / Math.PI) % 360 + 540) % 360 - 180);
}

/** The group's edge on one level: group.edges, else a levelEdges match, else the group itself. */
function edgeOn(F, group, level, rotation, cache) {
  if (Array.isArray(group.edges)) {
    const e = group.edges.find((x) => x.levelIndex === level.index);
    if (e) return e;
  }
  if (!cache.has(level.index)) cache.set(level.index, F.levelEdges ? F.levelEdges(level, rotation) : []);
  const dir = [group.b[0] - group.a[0], group.b[1] - group.a[1]];
  let best = null, bestD = Infinity;
  for (const e of cache.get(level.index)) {
    if (e.ring !== group.ring) continue;
    const da = Math.hypot(e.a[0] - group.a[0], e.a[1] - group.a[1]), db = Math.hypot(e.b[0] - group.b[0], e.b[1] - group.b[1]);
    if (da > 1 || db > 1 || angleDiff([e.b[0] - e.a[0], e.b[1] - e.a[1]], dir) > 1) continue;
    if (da + db < bestD) { best = e; bestD = da + db; }
  }
  return best || group;
}

function groupLevelIndices(group, levelByIndex) {
  if (Array.isArray(group.levels)) return group.levels;
  const out = [];
  for (const [idx] of levelByIndex) if (idx >= group.levelFrom && idx <= group.levelTo) out.push(idx);
  return out.sort((p, q) => levelByIndex.get(p).z - levelByIndex.get(q).z);
}

const warn = (code, message, floors = [], severity = "warn") => ({ code, severity, floors, message });

/* ------------------------------------------------------------------ build */

/** Plan 3.1 to 3.10. opts: { project, quality: "full" | "draft", faces } (`faces` replaces the faces.js
    module, for tests). → { source, rotation, levels, groups, faces, balconies, fins, shades, street, warnings, notes }.
    Face = { id, groupId, levelIndex, z, ftf, a, b, length, orientation, bearing, zone, street, rule, n, module,
             panels, glazing, wall, convexStart, convexEnd, balconyModules, band } */
export function buildFacade(state, { project = null, quality = "full", faces: override = null } = {}) {
  if (!state || typeof state !== "object") throw new Error("buildFacade: state is missing or not valid");
  const F = override || FACES;
  const massing = F.massingLevels(state, project);
  const levels = (massing.levels || []).slice().sort((p, q) => p.z - q.z || p.index - q.index);
  const rotation = isNum(massing.rotation) ? massing.rotation : 0;
  const warnings = [];
  const ids = Array.isArray(massing.noteIds) ? massing.noteIds : [];
  (massing.notes || []).forEach((text, k) => {
    const code = ids[k] || (levels.length ? "massing-note" : "no-levels");
    warnings.push(warn(code, text, [], code === "massing-note" || code === "no-project-massing" ? "info" : "warn"));
  });
  const result = { source: massing.source, rotation, levels, groups: [], faces: [], balconies: [], fins: [], shades: [], street: { ids: [], source: "auto" }, warnings, notes: massing.notes || [] };
  if (!levels.length) {
    if (!warnings.some((w) => w.code === "no-levels" || w.code === "tower-no-levels")) warnings.push(warn("no-levels", "There are no massing levels to build a facade on."));
    return result;
  }

  const levelByIndex = new Map(levels.map((l) => [l.index, l]));
  const groups = F.faceGroups(state, levels, rotation);
  const street = F.streetFaces(state, groups, levels, project);
  const streetIds = new Set(street.ids || []);
  const bal = balconiesOf(state), fin = finsOf(state), shd = shadesOf(state);
  const corners = state.corners === "glass" ? "glass" : "solid";
  const slabCover = isNum(state.systems && state.systems.windowWall && state.systems.windowWall.slabCover)
    ? state.systems.windowWall.slabCover : DEFAULT_SYSTEMS.windowWall.slabCover;
  const bands = Array.isArray(state.bands) ? state.bands : [];
  const usePlates = massing.source === "project";
  const cache = new Map();

  // pass 1: one entry per group and level
  const entries = [];
  for (const g of groups) {
    for (const idx of groupLevelIndices(g, levelByIndex)) {
      const lv = levelByIndex.get(idx);
      if (!lv) continue;
      const e = edgeOn(F, g, lv, rotation, cache);
      const a = e.a, b = e.b;
      const length = isNum(e.length) ? e.length : Math.hypot(b[0] - a[0], b[1] - a[1]);
      const rule = ruleFor(state, g.zone, g.orientation);
      const { n, module } = panelize(length, rule.module);
      const eligible = bal.on && rule.system !== "solid" && g.zone !== "crown" && bal.zones.includes(g.zone) && bal.orientations.includes(g.orientation);
      entries.push({ g, lv, a, b, length, rule, n, module, eligible, convexStart: e.convexStart === undefined ? g.convexStart : e.convexStart,
        convexEnd: e.convexEnd === undefined ? g.convexEnd : e.convexEnd, bearing: isNum(e.bearing) ? e.bearing : g.bearing });
    }
  }

  // pass 2: balcony modules
  let fallbackLevels = [];
  const byLevel = new Map();
  for (const en of entries) { if (!byLevel.has(en.lv.index)) byLevel.set(en.lv.index, []); byLevel.get(en.lv.index).push(en); }
  for (const en of entries) {
    en.balconyModules = [];
    if (!en.eligible) continue;
    if (bal.pattern === "per-unit") {
      const units = usePlates ? unitsFor(project, en.lv, levelByIndex) : null;
      if (units) {
        const peers = byLevel.get(en.lv.index).filter((x) => x.eligible).map((x) => ({ id: `${x.g.id}`, a: x.a, b: x.b, length: x.length, n: x.n, module: x.module }));
        en.balconyModules = unitBalconies({ id: en.g.id, a: en.a, b: en.b, length: en.length, n: en.n, module: en.module }, units, en.module, peers);
        continue;
      }
      if (!fallbackLevels.includes(en.lv.index)) fallbackLevels.push(en.lv.index);
    }
    en.balconyModules = balconyModules(bal.pattern, en.n, en.lv.index, bal.spacing);
  }
  if (fallbackLevels.length) {
    warnings.push(warn("per-unit-fallback", `Per-unit balconies need Plate Planner units. Stacked balconies were used on ${fallbackLevels.length} level${fallbackLevels.length === 1 ? "" : "s"}.`, fallbackLevels.slice().sort((p, q) => p - q)));
  }

  // pass 3: faces, balconies, fins, shades
  for (const en of entries) {
    const { g, lv, rule } = en;
    const face = {
      id: `${g.id}@${lv.index}`, groupId: g.id, levelIndex: lv.index, z: lv.z, ftf: lv.ftf,
      a: en.a, b: en.b, length: r3(en.length), orientation: g.orientation, bearing: en.bearing, zone: g.zone,
      street: streetIds.has(g.id), rule, n: en.n, module: en.module, panels: null, glazing: 0, wall: r3(en.length * lv.ftf),
      convexStart: en.convexStart, convexEnd: en.convexEnd, balconyModules: [], band: null,
    };
    face.panels = facePanels({ ...face, length: en.length }, rule, lv, { corners, slabCover, balconies: en.balconyModules, door: bal.door });
    let glass = 0;
    for (const p of face.panels) for (const r of p.glass) glass += (r.u1 - r.u0) * (r.v1 - r.v0);
    face.glazing = r3(glass);
    face.balconyModules = face.panels.filter((p) => p.kind === "door").map((p) => p.i);
    for (const bd of bands) {
      if (!bd) continue;
      if (bd.zone !== undefined ? bd.zone === g.zone : isNum(bd.every) && bd.every >= 1 && lv.index % Math.round(bd.every) === 0) { face.band = bd.material || null; break; }
    }
    result.faces.push(face);

    const geom = { ...face, length: en.length };
    for (const i of face.balconyModules) {
      const geo = balconyGeometry(geom, i, bal);
      result.balconies.push({
        id: `${face.id}#${i}`, faceId: face.id, groupId: g.id, levelIndex: lv.index, orientation: g.orientation, zone: g.zone, i,
        type: geo.type, width: geo.width, depth: geo.depth, slab: geo.slab, area: r3(geo.width * geo.depth),
        plan: geo.plan, z0: geo.z0, z1: geo.z1, door: geo.door,
      });
    }
    if (fin.on && quality !== "draft" && fin.orientations.includes(g.orientation) && fin.zones.includes(g.zone)) {
      for (let i = 1; i < en.n; i++) {
        if (i % fin.every !== 0) continue;
        const u = i * en.module;
        result.fins.push({
          id: `${face.id}|fin${i}`, faceId: face.id, groupId: g.id, levelIndex: lv.index, orientation: g.orientation, zone: g.zone, i, u: r3(u),
          depth: fin.depth, width: fin.width, plan: faceStrip(geom, u - fin.width / 2, u + fin.width / 2, fin.depth), z0: lv.z, z1: r3(lv.z + lv.ftf),
        });
      }
    }
    if (shd.on && shd.orientations.includes(g.orientation) && shd.zones.includes(g.zone)) {
      for (const p of face.panels) {
        if (!(p.kind === "window" || p.kind === "glass" || p.kind === "corner") || !p.glass.length) continue;
        const r = p.glass[0], gh = r.v1 - r.v0;
        result.shades.push({
          id: `${face.id}|shade${p.i}`, faceId: face.id, groupId: g.id, levelIndex: lv.index, orientation: g.orientation, zone: g.zone, system: rule.system, i: p.i,
          u0: r.u0, u1: r.u1, z: r3(lv.z + r.v1 + shd.above), depth: shd.depth, above: shd.above, glassHeight: r3(gh),
          pf: Math.round((shd.depth / (gh + shd.above)) * 10000) / 10000, plan: faceStrip(geom, r.u0, r.u1, shd.depth),
        });
      }
    }
  }
  result.groups = groups;
  result.street = { ids: street.ids || [], source: street.source || "auto" };
  return result;
}
