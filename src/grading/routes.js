/* ==========================================================================
   routes.js — running and cross slope along a drawn route (Grading Sketch)

   Contract: docs/grading-sketch-technical-plan.md sections 3.9 and 4.
   Pure: no DOM, no mutation of inputs.

   Caution: route limits come from the 2010 ADA Standards and ICC A117.1.
   The adopted code and its amendments decide. The tool reports slopes; it
   never says "compliant".

   Rule choices where the plan leaves room:
   - Samples sit every 1 ft from s = 0, and the last sample sits on the end
     of the route when the length is not a whole number of feet.
   - Running slope at s = |z(s + 5) - z(s)| / 5. When s + 5 passes the end
     the sample looks back to s - 5 (clamped to the start, so a route
     shorter than 5 ft uses its own length as the run).
   - Cross slope uses the normal of the segment the sample sits on (the
     last segment at the end of the route).
   - A slope compares to its limit with 1e-9 of room, so a 5 percent plane
     is a walk, not a ramp, in floating point.
   - A ramp-landing run is a run of consecutive ramp samples; its rise is the
     elevation difference from its first to its last sample.
   - Elevations round to 0.01 ft, plan coordinates to 0.001 ft, slopes to
     0.0001. Classes use the unrounded values.
   - Warnings are { code, severity, where, message } with where =
     { route, s, x, y }. route-fail is one per run of failing samples.
   ========================================================================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100 + 0;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;

const EPS = 1e-9;
const RUN = 5;        // ft: run length for the running slope
const CROSS_SPAN = 5; // ft: total width for the cross slope (2.5 ft each side)
const DEFAULT_LIMITS = { walk: 0.05, ramp: 0.0833, cross: 0.0208, rampRise: 2.5 };

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/** Cumulative length at each vertex, and the total. Zero-length segments stay (they are skipped on lookup). */
function stations(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  return { cum, length: cum[cum.length - 1] };
}

/** Point and unit direction at station s; the direction is that of the segment holding s. */
function locate(line, cum, s) {
  let seg = line.length - 2;
  for (let i = 0; i < line.length - 1; i++) {
    if (cum[i + 1] - cum[i] > 0 && s < cum[i + 1] - 1e-12) { seg = i; break; }
  }
  // the last segment with length, when s sits at the very end
  while (seg > 0 && cum[seg + 1] - cum[seg] <= 0) seg--;
  const a = line[seg], b = line[seg + 1];
  const len = cum[seg + 1] - cum[seg];
  if (len <= 0) return { x: a[0], y: a[1], dx: 1, dy: 0 };
  const t = Math.min(1, Math.max(0, (s - cum[seg]) / len));
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / len, dy: (b[1] - a[1]) / len };
}

/** Plan 3.9. route: { id, line, name }; surfaceAt (x, y) => z; limits: { walk, ramp, cross, rampRise }.
    → { samples: [{ s, x, y, z, running, cross, cls }], maxSlope, maxCross, kind, warnings }.
    cls is "walk", "ramp", or "fail". kind is "walk" when every sample is a walk, else "ramp". */
export function routeProfile(route, surfaceAt, limits) {
  need(route && Array.isArray(route.line) && route.line.length >= 2, "routeProfile", "route.line (2 points or more)");
  need(typeof surfaceAt === "function", "routeProfile", "surfaceAt");
  const lim = { ...DEFAULT_LIMITS, ...(limits || {}) };
  const line = route.line;
  const { cum, length } = stations(line);
  const id = route.id != null ? route.id : null;

  const zAt = (s) => { const p = locate(line, cum, s); return surfaceAt(p.x, p.y); };

  const ss = [];
  for (let s = 0; s <= length + 1e-9; s += 1) ss.push(Math.min(s, length));
  if (length - ss[ss.length - 1] > 1e-6) ss.push(length);

  const samples = [];
  let maxSlope = 0, maxCross = 0;
  for (const s of ss) {
    const p = locate(line, cum, s);
    const z = surfaceAt(p.x, p.y);
    let partner = s + RUN <= length + 1e-9 ? s + RUN : Math.max(0, s - RUN);
    const span = Math.abs(partner - s);
    const running = span > 0 ? Math.abs(zAt(partner) - z) / span : 0;
    // normal: left of travel
    const nx = -p.dy, ny = p.dx;
    const half = CROSS_SPAN / 2;
    const cross = Math.abs(surfaceAt(p.x + half * nx, p.y + half * ny) - surfaceAt(p.x - half * nx, p.y - half * ny)) / CROSS_SPAN;
    let cls = running <= lim.walk + EPS ? "walk" : running <= lim.ramp + EPS ? "ramp" : "fail";
    if (cross > lim.cross + EPS) cls = "fail";
    if (running > maxSlope) maxSlope = running;
    if (cross > maxCross) maxCross = cross;
    samples.push({ s: r3(s), x: r3(p.x), y: r3(p.y), z: r2(z), running: r4(running), cross: r4(cross), cls, _z: z });
  }

  const label = route.name ? `${route.name}` : id != null ? `Route ${id}` : "Route";
  const warnings = [];

  // ramp-landing: each run of consecutive ramp samples whose rise passes rampRise
  for (let i = 0; i < samples.length; ) {
    if (samples[i].cls !== "ramp") { i++; continue; }
    let e = i;
    while (e + 1 < samples.length && samples[e + 1].cls === "ramp") e++;
    const rise = Math.abs(samples[e]._z - samples[i]._z);
    if (rise > lim.rampRise + EPS) {
      warnings.push({
        code: "ramp-landing", severity: "warn",
        where: { route: id, s: samples[i].s, x: samples[i].x, y: samples[i].y },
        message: `${label} climbs ${r2(rise)} ft on ramp slopes between stations ${samples[i].s} and ${samples[e].s} ft, above ${lim.rampRise} ft in one run. It needs a landing. Route limits come from the 2010 ADA Standards and ICC A117.1: the adopted code decides.`,
      });
    }
    i = e + 1;
  }

  // route-fail: each run of failing samples
  for (let i = 0; i < samples.length; ) {
    if (samples[i].cls !== "fail") { i++; continue; }
    let e = i, run = 0, cr = 0;
    while (e < samples.length && samples[e].cls === "fail") { run = Math.max(run, samples[e].running); cr = Math.max(cr, samples[e].cross); e++; }
    const last = samples[e - 1];
    warnings.push({
      code: "route-fail", severity: "warn",
      where: { route: id, s: samples[i].s, x: samples[i].x, y: samples[i].y },
      message: `${label} is steeper than the ramp limit from station ${samples[i].s} to ${last.s} ft (running ${(run * 100).toFixed(1)} percent, cross ${(cr * 100).toFixed(1)} percent). Limits: running ${(lim.ramp * 100).toFixed(2)} percent, cross ${(lim.cross * 100).toFixed(2)} percent. Route limits come from the 2010 ADA Standards and ICC A117.1: the adopted code decides.`,
    });
    i = e;
  }

  const out = samples.map(({ _z, ...rest }) => rest);
  const kind = out.every((q) => q.cls === "walk") ? "walk" : "ramp";
  return { samples: out, maxSlope: r4(maxSlope), maxCross: r4(maxCross), kind, warnings };
}
