/* ==========================================================================
   facade/derived.js — Facade Studio → facade.derived (docs/project-file-spec.md 6.5 + plan sections 3.13 and 7)

   facadeDerived(state, built, metrics) → { faces, metrics }
     state    the facade state (plan section 2)
     built    buildFacade(state, ...) result (plan section 4): { groups[], faces[], street, ... }
     metrics  computeMetrics(...) result (plan section 4). Every row is optional; a missing row falls back to a figure
              computed from `built.faces`. A row may be a number or an object with .value / .total / .ratio.

   faces[]    one per face group: id, levelFrom, levelTo, orientation, system, area, glazing, wwr, balconies (count),
              edge [a, b] (local frame, on levelFrom), bearing, zone, street.
              area = Σ wall over the group's faces and levels. glazing counts the whole window opening. balconies = door panels.
              system is the rule's system in the spec's kebab-case: punched, window-wall, curtain-wall, storefront, solid.
   metrics    wwr, wwrByOrientation { N, E, S, W }, groundTransparency (null without street faces), facadeArea, glazingArea,
              balconyCount, balconyArea, wwrLimit, exposure ({ N, E, S, W } or null).

   Areas round to 0.1 sf, ratios to 0.001, coordinates to 0.001 ft. No NaN, no undefined. Pure: no DOM, no input mutation.
   ========================================================================== */

const ORIENTATIONS = ["N", "E", "S", "W"];
const KEBAB = { punched: "punched", windowWall: "window-wall", curtainWall: "curtain-wall", storefront: "storefront", solid: "solid" };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const r3 = (v) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
const need = (v, name) => { if (v === undefined || v === null) throw new Error(`facadeDerived: missing input "${name}".`); return v; };

/** A number from a metrics row: the number itself, or .value / .ratio / .total of an object. Else null. */
function metricNumber(v) {
  if (isNum(v)) return v;
  if (v && typeof v === "object" && !Array.isArray(v)) for (const k of ["value", "ratio", "total"]) if (isNum(v[k])) return v[k];
  return null;
}

/** Wall or glazing of a built face: a number, or an object with .area / .total / .value. */
const areaOf = (v) => { const n = metricNumber(v); if (n !== null) return n; return v && isNum(v.area) ? v.area : 0; };

const panelsOf = (f) => (Array.isArray(f && f.panels) ? f.panels : []);
const doorCount = (f) => panelsOf(f).filter((p) => p && p.kind === "door").length;

/** The spec's system name for a rule or a system key. */
export function systemName(key) {
  return KEBAB[key] || (typeof key === "string" && key ? key : "punched");
}

function groupSystem(state, group, faces) {
  const f = faces.find((x) => x.rule && x.rule.system);
  if (f) return f.rule.system;
  const zr = state && state.zones && state.zones.rules && state.zones.rules[group.zone];
  const ov = state && state.zones && state.zones.overrides && state.zones.overrides[group.zone] && state.zones.overrides[group.zone][group.orientation];
  return (ov && ov.system) || (zr && zr.system) || "punched";
}

export function facadeDerived(state, built, metrics) {
  need(state, "state"); need(built, "built");
  const groups = need(built.groups, "built.groups");
  const faces = Array.isArray(built.faces) ? built.faces : [];
  const m = metrics || {};

  const byGroup = new Map();
  for (const f of faces) {
    if (!f) continue;
    if (!byGroup.has(f.groupId)) byGroup.set(f.groupId, []);
    byGroup.get(f.groupId).push(f);
  }
  const streetIds = new Set(built.street && Array.isArray(built.street.ids) ? built.street.ids : []);

  // fallback totals from the built faces
  const tot = { wall: 0, glazing: 0, balconies: 0, byO: {} };
  for (const o of ORIENTATIONS) tot.byO[o] = { wall: 0, glazing: 0 };
  for (const f of faces) {
    if (!f) continue;
    const w = areaOf(f.wall), g = areaOf(f.glazing);
    tot.wall += w; tot.glazing += g; tot.balconies += doorCount(f);
    if (tot.byO[f.orientation]) { tot.byO[f.orientation].wall += w; tot.byO[f.orientation].glazing += g; }
  }

  const outFaces = groups.map((g) => {
    const fs = byGroup.get(g.id) || [];
    const area = fs.reduce((s, f) => s + areaOf(f.wall), 0);
    const glazing = fs.reduce((s, f) => s + areaOf(f.glazing), 0);
    const a = Array.isArray(g.a) ? g.a : [0, 0], b = Array.isArray(g.b) ? g.b : [0, 0];
    return {
      id: String(g.id),
      levelFrom: g.levelFrom,
      levelTo: g.levelTo,
      orientation: g.orientation,
      system: systemName(groupSystem(state, g, fs)),
      area: r1(area),
      glazing: r1(glazing),
      wwr: area > 0 ? r3(glazing / area) : 0,
      balconies: fs.reduce((s, f) => s + doorCount(f), 0),
      edge: [[r3(a[0]), r3(a[1])], [r3(b[0]), r3(b[1])]],
      bearing: isNum(g.bearing) ? r3(g.bearing) : 0,
      zone: String(g.zone),
      street: streetIds.has(g.id) || fs.some((f) => f.street === true),
    };
  });

  const wall = metricNumber(m.wall) !== null ? metricNumber(m.wall) : tot.wall;
  const glazing = metricNumber(m.glazing) !== null ? metricNumber(m.glazing) : tot.glazing;
  const wwrIn = metricNumber(m.wwr);
  const byOrient = {};
  for (const o of ORIENTATIONS) {
    const v = m.wwrByOrientation ? metricNumber(m.wwrByOrientation[o]) : null;
    byOrient[o] = r3(v !== null ? v : tot.byO[o].wall > 0 ? tot.byO[o].glazing / tot.byO[o].wall : 0);
  }
  const bc = metricNumber(m.balconyCount);
  const ba = metricNumber(m.balconyArea);
  const limit = isNum(state.checks && state.checks.wwrLimit) ? state.checks.wwrLimit : 0.4;
  const wl = metricNumber(m.wwrLimit);
  const exp = m.exposure && typeof m.exposure === "object" && !Array.isArray(m.exposure)
    ? Object.fromEntries(ORIENTATIONS.map((o) => [o, r3(isNum(m.exposure[o]) ? m.exposure[o] : 0)]))
    : null;
  const gt = metricNumber(m.transparency !== undefined ? m.transparency : m.groundTransparency);

  return {
    faces: outFaces,
    metrics: {
      wwr: r3(wwrIn !== null ? wwrIn : wall > 0 ? glazing / wall : 0),
      wwrByOrientation: byOrient,
      groundTransparency: gt === null ? null : r3(gt),
      facadeArea: r1(wall),
      glazingArea: r1(glazing),
      balconyCount: bc !== null ? bc : tot.balconies,
      balconyArea: r1(ba !== null ? ba : (bc !== null ? bc : tot.balconies) * (isNum(state.balconies && state.balconies.width) ? state.balconies.width : 12) * (isNum(state.balconies && state.balconies.depth) ? state.balconies.depth : 6)),
      wwrLimit: wl !== null ? wl : limit,
      exposure: exp,
    },
  };
}
