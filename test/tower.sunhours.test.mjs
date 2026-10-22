// Run: node test/tower.sunhours.test.mjs
// Plan: docs/tower-project-sun-plan.md, section 9.1 tests 13 to 17 (hand case in section 8.3), plus the
// section 3.6 cost target, slicing, the grid shape and no input mutation.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const H = await import("../src/tower/sunhours.js");
const Sol = await import("../src/shared/solar.js");
const G = await import("../src/tower/geometry.js");
const P = await import("../src/tower/presets.js");
const { casters, shadowPolygon, sunGrid, sunHours, samplesFor, isLit } = H;
const { sunTimes, sunPosition, localToUTC, localBearing, ATLANTA } = Sol;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.001, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ± ${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
function deepFreeze(o) {
  if (o && typeof o === "object" && !ArrayBuffer.isView(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------ fixtures */

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const noCtx = { context: { show: false, blocks: [] } };
/** Section 8.3: 100 × 100 ft, 10 floors of 10 ft, no crown solid. */
const CUBE = {
  plates: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, z: 10 * i, ftf: 10, void: false, polygons: [{ outer: rect(-50, -50, 50, 50), holes: [] }] })),
  solids: [],
};
const LAT = ATLANTA.lat, LON = ATLANTA.lon, TZ = "us-eastern", EQX = "2026-03-20";
const noonTimes = sunTimes(LAT, LON, EQX, TZ);
const NOON = sunPosition(LAT, LON, localToUTC(EQX, noonTimes.noon, TZ));

function pointInRing(r, x, y) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const inMP = (mp, x, y) => mp.some((p) => pointInRing(p.outer, x, y) && !p.holes.some((h) => pointInRing(h, x, y)));
function edgeDist(mp, x, y) {
  let d = Infinity;
  for (const p of mp) for (const r of [p.outer, ...p.holes]) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
      d = Math.min(d, Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy));
    }
  }
  return d;
}
const mpArea = (mp) => mp.reduce((s, p) => s + Math.abs(G.ringArea(p.outer)) - p.holes.reduce((h, r) => h + Math.abs(G.ringArea(r)), 0), 0);
function bboxOf(mp) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of mp) for (const [x, y] of p.outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

console.log("tower sun hours");

/* ------------------------------------------------------------ casters */

t("casters: stacked equal plates merge; context blocks; kinds and orientation", () => {
  const c = casters(noCtx, CUBE);
  eq(c.length, 1);
  eq(c[0].z0, 0); eq(c[0].z1, 100); eq(c[0].kind, "plate"); eq(c[0].convex, true);
  ok(G.ringArea(c[0].polygon) > 0, "outer CCW");
  const withCtx = casters({ context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }, { x: 0, y: 0, w: 10, d: 10, h: 0 }] } }, CUBE);
  eq(withCtx.length, 2, "zero-height block skipped");
  eq(withCtx[1].kind, "context"); eq(withCtx[1].z1, 60);
  eq(casters({ context: { show: false, blocks: [{ x: 0, y: 0, w: 10, d: 10, h: 10 }] } }, CUBE).length, 1, "hidden context");
  const based = casters({ context: { show: true, blocks: [{ x: 0, y: 0, w: 10, d: 10, h: 10, base: -4 }] } }, { plates: [], solids: [] });
  eq(based[0].z0, -4); eq(based[0].z1, 6);
});
t("casters: every preset builds casters; crowns and holes come through", () => {
  for (const pr of P.PRESETS) {
    const built = G.buildPlates(pr.state);
    const c = casters(pr.state, built);
    ok(c.length >= 2, pr.id);
    ok(c.every((x) => G.ringArea(x.polygon) > 0 && x.holes.every((h) => G.ringArea(h) < 0) && x.z1 > x.z0), `${pr.id} rings`);
    ok(c.some((x) => x.kind === "crown"), `${pr.id} crown`);
    ok(c.some((x) => x.kind === "context"), `${pr.id} context`);
  }
  const l = casters(P.PRESETS.find((p) => p.id === "l-multifamily-podium").state, G.buildPlates(P.PRESETS.find((p) => p.id === "l-multifamily-podium").state));
  ok(l.some((x) => x.kind === "plate" && !x.convex), "the L plate is not convex");
  ok(l.some((x) => x.holes.length), "the parapet ring has a hole");
});

/* ------------------------------------------------------------ test 13 */
t("13 hand case: solar noon at the equinox, altitude 56.30°, shadow 66.70 ft", () => {
  near(NOON.altitude, 56.30, 0.05, "altitude");
  near(NOON.azimuth, 180, 0.1, "azimuth");
  near(100 / Math.tan(NOON.altitude * Math.PI / 180), 66.70, 0.1, "shadow length");
  const c = casters(noCtx, CUBE);
  eq(isLit(c, 0, 50 + 60, NOON.azimuth, NOON.altitude), false, "60 ft north");
  eq(isLit(c, 0, 50 + 72, NOON.azimuth, NOON.altitude), true, "72 ft north");
  eq(isLit(c, 0, 50 + 66, NOON.azimuth, NOON.altitude), false, "66 ft north");
  eq(isLit(c, 0, 50 + 67.5, NOON.azimuth, NOON.altitude), true, "67.5 ft north");
  eq(isLit(c, 0, -60, NOON.azimuth, NOON.altitude), true, "south side");
  eq(isLit(c, 0, 0, NOON.azimuth, NOON.altitude), false, "under the tower");
  eq(isLit(c, 0, -60, NOON.azimuth, -1), false, "sun down");
  const sh = shadowPolygon(c[0], NOON.azimuth, NOON.altitude);
  eq(sh.length, 1);
  near(bboxOf(sh).maxY, 50 + 100 / Math.tan(NOON.altitude * Math.PI / 180), 0.01, "shadow tip");
});
t("13 sunHours, one sample, 5 ft grid: shaded nodes reach 65 ft north and stop before 70 ft", () => {
  const c = casters(noCtx, CUBE);
  const grid = sunGrid({ minX: -200, minY: -200, maxX: 200, maxY: 200 }, 5);
  eq(grid.nx, 81); eq(grid.ny, 81); eq(grid.n, 81);
  const r = sunHours(c, grid, [{ minutes: noonTimes.noon, azimuth: NOON.azimuth, altitude: NOON.altitude, dt: 60 }]);
  eq(r.samples, 1); eq(r.cancelled, false);
  ok(r.hours instanceof Float32Array && r.hours.length === 81 * 81, "hours array");
  const at = (x, y) => r.hours[Math.round((y - grid.y0) / 5) * grid.nx + Math.round((x - grid.x0) / 5)];
  eq(at(0, 115), 0, "65 ft north shaded");
  eq(at(0, 120), 1, "70 ft north lit");
  eq(at(0, 0), 0, "under the tower");
  eq(at(0, -55), 1, "south face lit");
  eq(at(-45, 110), 0); eq(at(45, 110), 0); eq(at(60, 110), 1, "east of the shadow");
  // every node agrees with the ray cast, away from the shadow edge
  const sh = shadowPolygon(c[0], NOON.azimuth, NOON.altitude);
  let checked = 0;
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const x = grid.x0 + 5 * i, y = grid.y0 + 5 * j;
    if (edgeDist(sh, x, y) < 0.01) continue;
    eq(r.hours[j * grid.nx + i] === 1, isLit(c, x, y, NOON.azimuth, NOON.altitude), `node ${x}, ${y}`);
    checked++;
  }
  ok(checked > 6000, "checked nodes");
});

/* ------------------------------------------------------------ test 14 */
function agree(list, label, n = 2000) {
  const suns = [[135, 40], [200, 25], [80, 15], [260, 60], [10, 70]];
  let tested = 0;
  for (const [az, alt] of suns) {
    for (const c of list) {
      const sh = shadowPolygon(c, az, alt);
      ok(sh.length >= 1, `${label} shadow`);
      const b = bboxOf(sh);
      const m = 20;
      const per = Math.ceil(n / suns.length / list.length);
      let k = 0;
      while (k < per) {
        const x = b.minX - m + rnd() * (b.maxX - b.minX + 2 * m), y = b.minY - m + rnd() * (b.maxY - b.minY + 2 * m);
        if (edgeDist(sh, x, y) < 0.02) continue;
        const shaded = inMP(sh, x, y);
        if (shaded === isLit([c], x, y, az, alt)) throw new Error(`${label} az ${az} alt ${alt}: node ${x.toFixed(3)}, ${y.toFixed(3)} shadow says ${shaded ? "shaded" : "lit"}`);
        k++; tested++;
      }
    }
  }
  return tested;
}
t("14 shadowPolygon agrees with isLit on 2,000 random nodes: convex caster", () => {
  const hex = Array.from({ length: 6 }, (_, i) => [30 + 40 * Math.cos(i * Math.PI / 3 + 0.3), -20 + 40 * Math.sin(i * Math.PI / 3 + 0.3)]);
  const c = casters(noCtx, { plates: [{ z: 0, ftf: 80, polygons: [{ outer: hex, holes: [] }] }], solids: [] });
  eq(c[0].convex, true);
  ok(agree(c, "convex") >= 2000);
});
t("14 shadowPolygon agrees with isLit on 2,000 random nodes: L-shaped caster (raised, z 20 to 120)", () => {
  const L = [[0, 0], [120, 0], [120, 40], [40, 40], [40, 140], [0, 140]];
  const c = casters(noCtx, { plates: [{ z: 20, ftf: 100, polygons: [{ outer: L, holes: [] }] }], solids: [] });
  eq(c[0].convex, false);
  ok(agree(c, "L-shaped") >= 2000);
});
t("14 extra: a ring with a hole, a spire and an L-shaped sloped crown agree with isLit", () => {
  const ring = casters(noCtx, { plates: [], solids: [{ kind: "prism", role: "screen", z0: 100, z1: 130, polygons: [{ outer: rect(-60, -60, 60, 60), holes: [rect(-55, -55, 55, 55).reverse()] }] }] });
  eq(ring[0].holes.length, 1);
  agree(ring, "screen ring", 1000);
  const base = P.PRESETS.find((p) => p.id === "point-tower").state;
  const spireState = { ...clone(base), crown: { ...clone(base.crown || {}), type: "spire", height: 60 } };
  const sp = casters(noCtx, G.buildPlates(spireState)).filter((x) => x.mesh);
  eq(sp.length, 1); eq(sp[0].convex, true, "spire is convex");
  agree(sp, "spire", 1000);
  const lState = P.PRESETS.find((p) => p.id === "l-multifamily-podium").state;
  const sloped = { ...clone(lState), crown: { ...clone(lState.crown || {}), type: "sloped", height: 30, slopeSide: "front" } };
  const sl = casters(noCtx, G.buildPlates(sloped)).filter((x) => x.mesh);
  eq(sl.length, 1); eq(sl[0].convex, false, "L sloped crown is not convex");
  agree(sl, "sloped L", 1000);
});

/* ------------------------------------------------------------ test 15 */
t("15 full-day node 500 ft south of the tower: hours = the day length", () => {
  const s = samplesFor(LAT, LON, EQX, TZ, 30);
  const day = noonTimes.sunset - noonTimes.sunrise;
  near(s.reduce((a, x) => a + x.dt, 0), day, 1e-9, "dt adds up to the day");
  eq(s.length, Math.ceil(day / 30));
  ok(s.every((x) => x.altitude > 0 && x.dt > 0 && x.dt <= 30), "every sample above the horizon");
  near(s[0].minutes, noonTimes.sunrise + 15, 1e-9, "first sample mid-interval");
  const grid = sunGrid({ minX: 0, minY: -550, maxX: 0, maxY: -550 }, 10);
  eq(grid.nx * grid.ny, 1);
  const r = sunHours(casters(noCtx, CUBE), grid, s);
  // The plan (section 8.3) says 12.26 h; the day is 12 h 08.1 min = 12.14 h (see test/solar.test.mjs test 8).
  near(r.hours[0], 12.14, 0.03, "hours");
  near(r.hours[0], day / 60, 1e-4, "exactly the day length");
  eq(r.samples, s.length);
  // the tower's north side sees less
  const north = sunHours(casters(noCtx, CUBE), sunGrid({ minX: 0, minY: 60, maxX: 0, maxY: 60 }, 10), s);
  ok(north.hours[0] < 4, `north node ${north.hours[0]}`);
});
t("15 samplesFor: other dates, steps, polar day and night", () => {
  const jun = sunTimes(LAT, LON, "2026-06-21", TZ);
  near(samplesFor(LAT, LON, "2026-06-21", TZ, 60).reduce((a, x) => a + x.dt, 0), jun.sunset - jun.sunrise, 1e-9);
  eq(samplesFor(80, 0, "2026-12-21", 0, 30).length, 0);
  const pd = samplesFor(80, 0, "2026-06-21", 0, 60);
  eq(pd.length, 24); near(pd.reduce((a, x) => a + x.dt, 0), 1440, 1e-9);
});

/* ------------------------------------------------------------ test 16 */
t("16 a placement rotation of 90 turns the shadow with the frame", () => {
  const bar = { plates: [{ z: 0, ftf: 100, polygons: [{ outer: rect(-50, -10, 50, 10), holes: [] }] }], solids: [] };
  const pl = { x: 500, y: 500, rotation: 90, baseZ: 12 };
  const local = casters(noCtx, bar);
  const proj = casters(noCtx, bar, pl);
  // the 100 × 20 local bar stands 20 wide and 100 deep in the project frame
  const b = bboxOf([{ outer: proj[0].polygon, holes: [] }]);
  near(b.minX, 490, 1e-9); near(b.maxX, 510, 1e-9); near(b.minY, 450, 1e-9); near(b.maxY, 550, 1e-9);
  eq(proj[0].z1, 100, "heights stay above the ground floor");
  // true sun from the south at 45°: the shadow runs 100 ft north in the project frame
  eq(isLit(proj, 500, 600, 180, 45), false);
  eq(isLit(proj, 540, 560, 180, 45), true, "the local bar would shade this point unrotated");
  eq(isLit(local, 40, 60, 180, 45), false);
  // the same shadow worked in the local frame with the local bearing, then turned into the project frame
  const shP = shadowPolygon(proj[0], 180, 45);
  const shL = shadowPolygon(local[0], localBearing(180, pl.rotation), 45);
  near(mpArea(shP), mpArea(shL), 0.01, "area");
  for (let k = 0; k < 500; k++) {
    const x = 380 + rnd() * 240, y = 380 + rnd() * 240;
    const lx = y - 500, ly = -(x - 500);   // project → local for rotation 90
    if (edgeDist(shP, x, y) < 0.02) continue;
    eq(inMP(shP, x, y), inMP(shL, lx, ly), `point ${x}, ${y}`);
  }
  // a whole grid in the project frame against the ray cast
  const grid = sunGrid({ minX: 400, minY: 400, maxX: 600, maxY: 700 }, 10);
  const r = sunHours(proj, grid, [{ azimuth: 180, altitude: 45, dt: 60, minutes: 0 }]);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const x = grid.x0 + 10 * i, y = grid.y0 + 10 * j;
    if (edgeDist(shP, x, y) < 0.01) continue;
    eq(r.hours[j * grid.nx + i] === 1, isLit(proj, x, y, 180, 45), `grid ${x}, ${y}`);
  }
});

/* ------------------------------------------------------------ test 17 */
t("17 cancel: shouldStop returning true stops with cancelled: true", () => {
  const s = samplesFor(LAT, LON, EQX, TZ, 30);
  const grid = sunGrid({ minX: -300, minY: -300, maxX: 300, maxY: 300 }, 20);
  let calls = 0;
  const progress = [];
  const r = sunHours(casters(noCtx, CUBE), grid, s, { shouldStop: () => ++calls > 3, onProgress: (d, n) => progress.push([d, n]) });
  eq(r.cancelled, true); eq(r.samples, 3);
  eq(JSON.stringify(progress), JSON.stringify([[1, s.length], [2, s.length], [3, s.length]]));
  const stopNow = sunHours(casters(noCtx, CUBE), grid, s, { shouldStop: () => true });
  eq(stopNow.cancelled, true); eq(stopNow.samples, 0);
  ok(stopNow.hours.every((h) => h === 0));
});

/* --------------------------------------------- slicing, grid, mutation */
t("slices add up: two sample halves equal one run", () => {
  const s = samplesFor(LAT, LON, EQX, TZ, 30);
  const grid = sunGrid({ minX: -300, minY: -300, maxX: 300, maxY: 300 }, 20);
  const c = casters({ context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] } }, CUBE);
  const all = sunHours(c, grid, s);
  const a = sunHours(c, grid, s.slice(0, 2)), b = sunHours(c, grid, s.slice(2));
  for (let i = 0; i < all.hours.length; i++) near(a.hours[i] + b.hours[i], all.hours[i], 1e-4);
  eq(a.samples + b.samples, all.samples);
  ok(sunHours(c, grid, [{ azimuth: 180, altitude: -2, dt: 30 }]).samples === 0, "below the horizon skipped");
});
t("sunGrid: 1,000 ft site at 10 ft and 20 ft; rectangles", () => {
  const g = sunGrid({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 10);
  eq(JSON.stringify(g), JSON.stringify({ spacing: 10, n: 101, nx: 101, ny: 101, x0: 0, y0: 0 }));
  eq(sunGrid({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 20).n, 51);
  const r = sunGrid({ minX: -10, minY: 5, maxX: 95, maxY: 25 }, 10);
  eq(r.nx, 11); eq(r.ny, 3); eq(r.n, 11); eq(r.x0, -10); eq(r.y0, 5);
});
t("no input mutation: frozen state, built, placement, casters and samples", () => {
  const pr = P.PRESETS.find((p) => p.id === "l-multifamily-podium");
  const state = deepFreeze(clone(pr.state));
  const built = deepFreeze(G.buildPlates(clone(pr.state)));
  const pl = deepFreeze({ x: 100, y: 200, rotation: 30, baseZ: 5 });
  const before = JSON.stringify(built);
  const c = deepFreeze(casters(state, built, pl));
  const s = deepFreeze(samplesFor(LAT, LON, EQX, TZ, 120));
  const cBefore = JSON.stringify(c);
  sunHours(c, sunGrid({ minX: -200, minY: -200, maxX: 400, maxY: 600 }, 20), s);
  for (const x of c) shadowPolygon(x, 135, 30);
  eq(JSON.stringify(built), before); eq(JSON.stringify(c), cBefore);
});

/* ------------------------------------------------------------ cost */
t("cost (section 3.6): 1,000 ft site, point tower and context", () => {
  const pr = P.PRESETS.find((p) => p.id === "point-tower");
  const built = G.buildPlates(pr.state);
  const c = casters(pr.state, built, { x: 500, y: 500, rotation: 0, baseZ: 0 });
  const site = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const runs = [["full 10 ft, 30 min", 10, 30, 2000, 101 * 101, 25], ["draft 20 ft, 60 min", 20, 60, 500, 51 * 51, 13]];
  for (const [label, sp, st, limit, nodes, nSamples] of runs) {
    const grid = sunGrid(site, sp), s = samplesFor(LAT, LON, EQX, TZ, st);
    eq(grid.nx * grid.ny, nodes); eq(s.length, nSamples);
    sunHours(c, grid, s.slice(0, 1));   // warm up
    const t0 = performance.now();
    const r = sunHours(c, grid, s);
    const ms = performance.now() - t0;
    console.log(`       ${label}: ${nodes} nodes, ${s.length} samples, ${c.length} casters → ${ms.toFixed(0)} ms (target ${limit} ms)`);
    ok(ms < limit, `${label} took ${ms} ms`);
    ok(r.hours.some((h) => h < 6) && r.hours.some((h) => h > 12), "shade and full sun both present");
  }
  for (const id of ["l-multifamily-podium", "u-multifamily-podium", "hotel-podium", "office-slab"]) {
    const p = P.PRESETS.find((q) => q.id === id);
    const cc = casters(p.state, G.buildPlates(p.state), { x: 500, y: 500, rotation: 20, baseZ: 0 });
    const t0 = performance.now();
    sunHours(cc, sunGrid(site, 10), samplesFor(LAT, LON, EQX, TZ, 30));
    console.log(`       ${id} (rotation 20): ${cc.length} casters → ${(performance.now() - t0).toFixed(0)} ms`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
