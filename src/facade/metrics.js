/* ==========================================================================
   metrics.js — areas, WWR, transparency, exposure, envelope note, checks (Facade Studio)

   Contract: docs/facade-studio-technical-plan.md sections 3.10 to 3.12 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs.

   Caution: these are design checks against editable values, not a code
   review. The tool never writes "compliant". The 40 percent WWR limit is a
   design value; verify the edition and the path for each project.

   Rule choices where the plan leaves room:
   - Glazing counts the whole window opening (decision 6). Areas round to
     0.1 sf, ratios to 0.0001.
   - wwrByOrientation holds a number, or null for an orientation with no wall.
     wwrByZone and wwrBySystem are { key: wwr }. `areas` holds
     { byOrientation, byZone, bySystem } as { wall, glazing } for the tables.
   - The crown (zone "crown") counts in wwrByZone and areas.byZone only. It is
     left out of wall, glazing, wwr, the orientation and system sums, and
     hasCrown tells the page to say "crown not counted".
   - worst = { orientation, wwr } for the highest orientation WWR; a tie goes
     to the first of N, E, S, W. null when there is no wall.
   - transparency = glass inside the band on street faces / sum of
     (group length x band height) over the street groups. null without street
     faces. The band runs from zGround + from to zGround + to; zGround is the
     lowest level z. Glass from every level that reaches the band counts.
   - exposure: samples with altitude >= 0 count (plan 3.12 says > 0, but its
     test 18 needs the altitude 0 sample: with it S 1.00 and E 0.261, without
     it S and E tie at 1.00). Weight = cos(alt) x max(0, cos(az - bearing)),
     summed over samples, length-weighted per orientation, divided by the
     largest. Rounded to 0.001. A negative altitude is skipped.
   - projectionFactors: one row per orientation, zone, system, and pf, from
     built.shades.
   - checks(state, metrics) returns the whole list. The build-time warnings
     (no-levels, tower-no-levels, per-unit-fallback) reach it through
     metrics.buildWarnings, a copy of built.warnings, so the page shows one
     list.
   ========================================================================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r1 = (v) => Math.round(v * 10) / 10 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
const ORIENTATIONS = ["N", "E", "S", "W"];
const DEG = Math.PI / 180;

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;

/* ------------------------------------------------------------- exposure */

/** Plan 3.12. groups: face groups { length, bearing, orientation }. sunDerived: { samples: [{ azimuth, altitude }] }.
    → { N, E, S, W } scaled so the most exposed is 1, or null without samples. */
export function exposure(groups, sunDerived) {
  const samples = sunDerived && Array.isArray(sunDerived.samples) ? sunDerived.samples.filter((s) => s && isNum(s.azimuth) && isNum(s.altitude) && s.altitude >= 0) : [];
  if (!samples.length || !Array.isArray(groups)) return null;
  const sum = {}, len = {};
  for (const o of ORIENTATIONS) { sum[o] = 0; len[o] = 0; }
  for (const g of groups) {
    if (!g || !ORIENTATIONS.includes(g.orientation) || !isNum(g.length) || !isNum(g.bearing)) continue;
    let e = 0;
    for (const s of samples) {
      const c = Math.cos((s.azimuth - g.bearing) * DEG);
      if (c > 0) e += Math.cos(s.altitude * DEG) * c;
    }
    sum[g.orientation] += e * g.length;
    len[g.orientation] += g.length;
  }
  const mean = {};
  let top = 0;
  for (const o of ORIENTATIONS) { mean[o] = len[o] > 0 ? sum[o] / len[o] : 0; top = Math.max(top, mean[o]); }
  const out = {};
  for (const o of ORIENTATIONS) out[o] = top > 0 ? r3(mean[o] / top) : 0;
  return out;
}

/* -------------------------------------------------------------- envelope */

const zoneLabel = (state, id) => {
  const r = state && state.zones && Array.isArray(state.zones.ranges) ? state.zones.ranges.find((x) => x && String(x.id) === String(id)) : null;
  if (r && r.name) return r.name;
  const s = String(id);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Plan 3.12. A plain-text comparison of the glazing and wall values against the limits. [] when envelope.on is off. */
export function envelopeNote(state, built) {
  const env = state && state.envelope;
  if (!env || env.on !== true || !built || !Array.isArray(built.faces)) return [];
  const lim = env.limits || {};
  const lines = ["Caution: typical seed values, not product data or code values. Verify every value."];
  const zones = [];
  for (const f of built.faces) if (!zones.includes(f.zone)) zones.push(f.zone);
  const cmp = (v, limit) => (isNum(limit) ? `${v <= limit + 1e-9 ? "at or below" : "above"} the ${limit} limit value` : "with no limit set");
  for (const z of zones) {
    const fs = built.faces.filter((f) => f.zone === z);
    const glazed = fs.filter((f) => f.glazing > 0);
    const glKeys = [], wallKeys = [];
    for (const f of glazed) {
      const k = f.rule && f.rule.glazing ? f.rule.glazing : env.glazingDefault;
      if (!glKeys.includes(k)) glKeys.push(k);
    }
    for (const f of fs) {
      const k = f.rule && f.rule.material && env.walls && env.walls[f.rule.material] ? f.rule.material : env.wallDefault;
      if (!wallKeys.includes(k)) wallKeys.push(k);
    }
    const gl = glKeys.map((k) => {
      const g = env.glazing && env.glazing[k];
      return g ? `${g.label || k}, U ${g.u} (${cmp(g.u, lim.uFixed)}), SHGC ${g.shgc} (${cmp(g.shgc, lim.shgc)})` : `${k} is not in the glazing table`;
    });
    const wl = wallKeys.map((k) => {
      const w = env.walls && env.walls[k];
      return w ? `${w.label || k}, U ${w.u}` : `${k} is not in the wall table`;
    });
    lines.push(`${zoneLabel(state, z)}: glazing ${gl.length ? gl.join("; ") : "none"}. Wall ${wl.length ? wl.join("; ") : "none"}.`);
  }
  return lines;
}

/* --------------------------------------------------------------- metrics */

function ratio(glazing, wall) {
  return wall > 0 ? r4(glazing / wall) : null;
}

/** Plan 3.10 to 3.12. project: the loaded project document or null (reads sections.sun.derived).
    → { wall, glazing, wwr, wwrByOrientation, wwrByZone, wwrBySystem, areas, worst, transparency, balconyCount,
        balconyArea, projectionFactors, exposure, envelope, wwrLimit, levels, hasCrown, buildWarnings } */
export function computeMetrics(state, built, project) {
  need(state, "computeMetrics", "state");
  need(built && Array.isArray(built.faces) && Array.isArray(built.levels), "computeMetrics", "built.faces and built.levels");
  const bucket = () => ({ wall: 0, glazing: 0 });
  const byO = Object.fromEntries(ORIENTATIONS.map((o) => [o, bucket()]));
  const byZ = {}, byS = {};
  let wall = 0, glazing = 0;
  let hasCrown = false;
  for (const f of built.faces) {
    const z = byZ[f.zone] || (byZ[f.zone] = bucket());
    z.wall += f.wall; z.glazing += f.glazing;
    // The crown is a screen, not a floor of the building: it has its own zone row and stays out of every other sum.
    if (f.zone === "crown") { hasCrown = true; continue; }
    wall += f.wall; glazing += f.glazing;
    const o = byO[f.orientation] || (byO[f.orientation] = bucket());
    o.wall += f.wall; o.glazing += f.glazing;
    const sys = f.rule && f.rule.system ? f.rule.system : "punched";
    const s = byS[sys] || (byS[sys] = bucket());
    s.wall += f.wall; s.glazing += f.glazing;
  }
  const fin = (b) => ({ wall: r1(b.wall), glazing: r1(b.glazing) });
  const finAll = (m) => Object.fromEntries(Object.entries(m).map(([k, b]) => [k, fin(b)]));
  const wwrOf = (m) => Object.fromEntries(Object.entries(m).map(([k, b]) => [k, ratio(b.glazing, b.wall)]));
  const wwrByOrientation = wwrOf(byO);
  let worst = null;
  for (const o of ORIENTATIONS) {
    const v = wwrByOrientation[o];
    if (v !== null && (!worst || v > worst.wwr)) worst = { orientation: o, wwr: v };
  }

  // ground transparency
  const chk = state.checks || {};
  const band = chk.band && isNum(chk.band.from) && isNum(chk.band.to) ? chk.band : { from: 2, to: 10 };
  const ids = new Set(built.street && Array.isArray(built.street.ids) ? built.street.ids : []);
  const zGround = built.levels.reduce((m, l) => Math.min(m, l.z), Infinity);
  let glassInBand = 0, bandArea = 0;
  for (const g of built.groups || []) if (ids.has(g.id)) bandArea += g.length * (band.to - band.from);
  if (Number.isFinite(zGround)) {
    const lo = zGround + band.from, hi = zGround + band.to;
    for (const f of built.faces) {
      if (!ids.has(f.groupId)) continue;
      for (const p of f.panels) for (const r of p.glass) {
        const o = Math.min(f.z + r.v1, hi) - Math.max(f.z + r.v0, lo);
        if (o > 0) glassInBand += o * (r.u1 - r.u0);
      }
    }
  }
  const transparency = bandArea > 0 ? r4(glassInBand / bandArea) : null;

  // balconies and shades
  const balconies = Array.isArray(built.balconies) ? built.balconies : [];
  const pfRows = new Map();
  for (const s of Array.isArray(built.shades) ? built.shades : []) {
    const pf = r3(s.pf);
    const key = `${s.orientation}|${s.zone}|${s.system}|${pf}`;
    const row = pfRows.get(key) || { orientation: s.orientation, zone: s.zone, system: s.system, depth: s.depth, above: s.above, glassHeight: s.glassHeight, pf, count: 0 };
    row.count++;
    pfRows.set(key, row);
  }

  const sun = project && project.sections && project.sections.sun && project.sections.sun.derived;
  return {
    wall: r1(wall),
    glazing: r1(glazing),
    wwr: ratio(glazing, wall) === null ? 0 : ratio(glazing, wall),
    wwrByOrientation,
    wwrByZone: wwrOf(byZ),
    wwrBySystem: wwrOf(byS),
    areas: { byOrientation: finAll(byO), byZone: finAll(byZ), bySystem: finAll(byS) },
    worst,
    transparency,
    balconyCount: balconies.length,
    balconyArea: r1(balconies.reduce((s, b) => s + b.area, 0)),
    projectionFactors: [...pfRows.values()],
    exposure: exposure(built.groups || [], sun),
    envelope: envelopeNote(state, built),
    wwrLimit: isNum(chk.wwrLimit) ? chk.wwrLimit : 0.4,
    levels: built.levels.length,
    hasCrown,
    buildWarnings: (Array.isArray(built.warnings) ? built.warnings : []).map((w) => ({ ...w, floors: Array.isArray(w.floors) ? w.floors.slice() : [] })),
  };
}

/* ---------------------------------------------------------------- checks */

function warn(code, message, floors = [], severity = "warn", extra = {}) {
  return { code, severity, floors, message, ...extra };
}

/** Plan 3.11. → Warning[] { code, severity, floors, message }: wwr-limit, wwr-orientation, transparency,
    then the build warnings (no-levels, tower-no-levels, per-unit-fallback and any other note). */
export function checks(state, metrics) {
  need(state && metrics && isNum(metrics.wwr), "checks", "state and metrics");
  const chk = state.checks || {};
  const limit = isNum(chk.wwrLimit) ? chk.wwrLimit : metrics.wwrLimit;
  const out = [];
  if (isNum(limit) && metrics.wwr > limit + 1e-9) {
    out.push(warn("wwr-limit", `Window-to-wall ratio is ${pct(metrics.wwr)}, above the ${pct(limit)} check value. Design value, not a code review: verify the edition and the path.`));
  }
  if (isNum(limit)) {
    for (const o of ORIENTATIONS) {
      const v = metrics.wwrByOrientation ? metrics.wwrByOrientation[o] : null;
      if (isNum(v) && v > limit + 1e-9) out.push(warn("wwr-orientation", `${o} faces are at ${pct(v)}, above the ${pct(limit)} check value.`, [], "info", { orientation: o }));
    }
  }
  const target = chk.transparencyTarget;
  if (isNum(target) && isNum(metrics.transparency) && metrics.transparency < target - 1e-9) {
    out.push(warn("transparency", `Ground transparency is ${pct(metrics.transparency)}, below the ${pct(target)} target. Design value: check the zoning code for the band and the target.`));
  }
  for (const w of Array.isArray(metrics.buildWarnings) ? metrics.buildWarnings : []) out.push({ ...w, floors: Array.isArray(w.floors) ? w.floors.slice() : [] });
  return out;
}
