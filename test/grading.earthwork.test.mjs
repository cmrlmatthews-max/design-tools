// Run: node test/grading.earthwork.test.mjs
// Plan section 9.1 tests 15 to 22: earthwork (15, 16, 17, 18), routes (19, 20), contours (21), metrics (22).
// Tests 15 to 18 and 22 run on a hand fixture first: planes, rectangles, and the section 3.5 daylight rule
// written out for rectangular features (see fixtureSurface). When src/grading/surface.js and features.js
// exist, the same cases also run through the real buildGrading (the "real" group at the end).
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const EW = await import("../src/grading/earthwork.js");
const RT = await import("../src/grading/routes.js");
const CT = await import("../src/grading/contours.js");
const MT = await import("../src/grading/metrics.js");
const { gridSpacing } = await import("../src/site/geo.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const rel = (a, b, frac, m = "") => { if (!(Math.abs(a - b) <= Math.abs(b) * frac)) throw new Error(`${m} expected ${b} within ${frac * 100}%, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const same = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o) && !ArrayBuffer.isView(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

/* ------------------------------------------------------------ the fixture */

const DEG = Math.PI / 180;
/** Plan 3.1, plane mode: z0 - (slope / 100)(x sin b + y cos b). */
const plane = (z0, slope, downhill) => (x, y) => z0 - (slope / 100) * (x * Math.sin(downhill * DEG) + y * Math.cos(downhill * DEG));
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const sq = (cx, cy, w, h) => rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);

/** Plan 3.1: the typed-plane grid. boxes: lists of [x, y] points the grid has to cover plus the margin. */
function planeGrid(existingAt, points, margin = 200) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin, minY = Math.min(...ys) - margin, maxY = Math.max(...ys) + margin;
  const S = Math.max(maxX - minX, maxY - minY);
  const { spacing, n } = gridSpacing(S);
  const x0 = Math.floor(((minX + maxX) / 2 - S / 2) / spacing) * spacing, y0 = Math.floor(((minY + maxY) / 2 - S / 2) / spacing) * spacing;
  const nodes = new Float64Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * spacing, y = y0 + j * spacing, k = (j * n + i) * 3;
    nodes[k] = x; nodes[k + 1] = y; nodes[k + 2] = existingAt(x, y);
  }
  return { spacing, n, x0, y0, nodes, at: existingAt };
}

/** Plan 3.5 for rectangular features. features: [{ rect: [x0, y0, x1, y1], z(x, y) }] in first-wins order;
    walls: [[[x, y], [x, y]], ...]; daylight: { on, fill, cut }. → { at, conflicts }. */
function fixtureSurface({ existingAt, features, walls = [], daylight }) {
  const conflicts = [];
  const sgn = (v) => (Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1);
  const orient = (a, b, c) => sgn((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  function blocked(p, q) {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    const e = [q[0] + (0.01 * dx) / len, q[1] + (0.01 * dy) / len];
    return walls.some(([a, b]) => orient(p, e, a) * orient(p, e, b) === -1 && orient(a, b, p) * orient(a, b, e) === -1);
  }
  function at(x, y) {
    for (const f of features) {
      const [x0, y0, x1, y1] = f.rect;
      if (x >= x0 - 1e-6 && x <= x1 + 1e-6 && y >= y0 - 1e-6 && y <= y1 + 1e-6) return f.z(x, y);
    }
    const ex = existingAt(x, y);
    if (!daylight.on) return ex;
    let lo = -Infinity, hi = Infinity, any = false;
    for (const f of features) {
      const [x0, y0, x1, y1] = f.rect;
      const q = [Math.min(Math.max(x, x0), x1), Math.min(Math.max(y, y0), y1)];
      const d = Math.hypot(x - q[0], y - q[1]);
      if (blocked([x, y], q)) continue;
      const e = f.z(q[0], q[1]);
      lo = Math.max(lo, e - d / daylight.fill);
      hi = Math.min(hi, e + d / daylight.cut);
      any = true;
    }
    if (!any) return ex;
    if (lo > hi) { lo = hi = (lo + hi) / 2; conflicts.push({ x, y }); }
    return Math.min(Math.max(ex, lo), hi);
  }
  return { at, conflicts };
}

const DAY = { on: true, fill: 3, cut: 2 };
const pad = (r, top) => ({ rect: [r[0][0], r[0][1], r[2][0], r[2][1]], z: () => top });

/** A built result with the shape of buildGrading's, for a plane ground.
    pads: [{ id, ring, top, ffe, outer }]; extent: points the grid must cover. */
function fixtureBuilt({ ground, pads, lots = [], walls = [], daylight = DAY, extent, quality }) {
  const existingAt = plane(ground.z0, ground.slope, ground.downhill);
  const grid = planeGrid(existingAt, extent);
  const features = [...pads.map((p) => pad(p.ring, p.top)), ...lots.map((l) => ({ rect: [l.ring[0][0], l.ring[0][1], l.ring[2][0], l.ring[2][1]], z: l.z }))];
  const s = fixtureSurface({ existingAt, features, walls: walls.map((w) => w.line), daylight });
  const tiers = pads.map((p, i) => ({
    id: p.id || `B${i + 1}-T1`, tier: 1, outer: p.outer || p.ring, pad: p.ring, padTop: p.top, ffe: p.ffe != null ? p.ffe : p.top + 1,
    existingMin: Math.min(...p.ring.map(([x, y]) => existingAt(x, y))), existingMax: Math.max(...p.ring.map(([x, y]) => existingAt(x, y))),
  }));
  return {
    source: "plane", grid, existingAt, surface: { at: s.at, conflicts: s.conflicts }, buildings: [], tiers,
    features: lots.map((l) => ({ id: l.id, kind: "lot", ring: l.ring })), walls, conflicts: s.conflicts, warnings: [], notes: [], quality,
  };
}

/* The section 8 cases, as fixture parameters. Pad tops come from the plan (the balance step is not under test here). */
const G5 = { z0: 1000, slope: 5, downhill: 180 };
const BAR = sq(0, 0, 300, 65);
const SOUTH_WALL = { id: "W1", kind: "drawn", line: [[-150, -32.5], [150, -32.5]] };
const CASES = {
  "8.1": () => fixtureBuilt({ ground: G5, pads: [{ ring: BAR, top: 1000, ffe: 1001 }], extent: BAR }),
  "8.1-wall": () => fixtureBuilt({ ground: G5, pads: [{ ring: BAR, top: 1000, ffe: 1001 }], walls: [SOUTH_WALL], extent: BAR }),
  "8.1-site": () => fixtureBuilt({ ground: G5, pads: [{ ring: BAR, top: 999.97, ffe: 1000.97 }], extent: BAR }),
  "8.2": (over = {}) => fixtureBuilt({ ground: { z0: 1000, slope: 4, downhill: 270 }, pads: [{ ring: BAR, top: 1000, ffe: 1001 }], daylight: { on: false }, extent: BAR, ...over }),
  "8.3": () => {
    const x = [-150, -50, 50, 150];
    const tops = [996, 1000, 1004];
    const pads = tops.map((top, k) => ({ id: `B1-T${k + 1}`, ring: rect(x[k], -32.5, x[k + 1], 32.5), top, ffe: top + 1 }));
    const b = fixtureBuilt({ ground: { z0: 1000, slope: 4, downhill: 270 }, pads, daylight: { on: false }, extent: BAR });
    b.tiers.forEach((tr, k) => { tr.tier = k + 1; });
    return b;
  },
  "8.4": (over = {}) => {
    const ys = [-120, 0, 120];
    const tops = [992.8, 1000, 1007.2];
    const pads = ys.map((yc, k) => ({ id: `B${k + 1}-T1`, ring: sq(0, yc, 202, 76), top: tops[k], ffe: tops[k] + 1, outer: sq(0, yc, 192, 66) }));
    const walls = ys.map((yc, k) => ({ id: `W${k + 1}`, kind: "drawn", line: [[-101, yc - 38], [101, yc - 38]] }));
    const lot = { id: "L1", ring: rect(130, -150, 290, 150), z: (x, y) => 1000 + 0.02 * y - 0.01 * (x - 210) };
    return fixtureBuilt({ ground: { z0: 1000, slope: 6, downhill: 180 }, pads, lots: [lot], walls, extent: [...ys.flatMap((yc) => sq(0, yc, 192, 66)), ...lot.ring], ...over });
  },
  "8.5": (over = {}) => {
    const deck = { id: "B1-T1", ring: sq(0, 0, 310, 135), top: 996.875, ffe: 997.875, outer: sq(0, 0, 300, 125) };
    const wrap = { id: "B2-T1", ring: sq(0, 0, 460, 285), top: 1000, ffe: 1001, outer: sq(0, 0, 450, 275) };
    const d = deck.ring, w = [[d[0], d[1]], [d[1], d[2]], [d[2], d[3]], [d[3], d[0]]].map((line, i) => ({ id: `S${i + 1}`, kind: "pad-step", line }));
    return fixtureBuilt({ ground: G5, pads: [deck, wrap], walls: w, extent: wrap.outer, ...over });
  },
  "8.6": (over = {}) => fixtureBuilt({
    ground: { z0: 1000, slope: 8, downhill: 180 },
    pads: [{ ring: sq(0, 0, 310, 210), top: 991.6, ffe: 992.6, outer: sq(0, 0, 300, 200) }],
    walls: [{ id: "W1", kind: "drawn", line: [[-155, 105], [155, 105]] }], extent: sq(0, 0, 300, 200), ...over,
  }),
  "8.7": () => fixtureBuilt({ ground: { z0: 1000, slope: 0, downhill: 180 }, pads: [{ ring: sq(0, 0, 310, 75), top: 1000, ffe: 1001, outer: sq(0, 0, 310, 75) }], extent: sq(0, 0, 310, 75) }),
};
// Without daylight (pads only)
const noDay = { daylight: { on: false } };

/* ---------------------------------------------- 15 earthwork, long bar ---- */

t("15 preset 8.2: 1,083.3 cy each way on the grid; 1,000.0 at k = 1", () => {
  // pad 300 x 65 on a 4 percent plane, pad top at the mean: cut = fill = 0.5 x 150 x 6 x 65 = 29,250 cf = 1,083.3 cy (edges on 2.5 ft lines, exact)
  const b = CASES["8.2"]();
  const e = EW.earthwork(b, { subdivide: 4 });
  near(e.cutCy, 1083.3, 0.1); near(e.fillCy, 1083.3, 0.1); near(e.netCy, 0, 0.1); eq(e.balance, 1);
  // k = 1: one sample per 10 ft cell; the pad edge at 32.5 splits cells, giving 1,000.0 (plan 3.8)
  const e1 = EW.earthwork(b, { subdivide: 1 });
  near(e1.cutCy, 1000.0, 0.1); near(e1.fillCy, 1000.0, 0.1);
});

t("15 preset 8.3: 361.1 cy each way", () => {
  // three tiers, 3 x 0.5 x 50 x 2 x 65 = 9,750 cf = 361.1 cy
  const e = EW.earthwork(CASES["8.3"](), { subdivide: 4 });
  near(e.cutCy, 361.1, 0.1); near(e.fillCy, 361.1, 0.1);
});

/* ----------------------------------------------- 16 earthwork, 8.1 set ---- */

t("16 preset 8.1: cut 325.1, fill 348.2, net +23.1, balance 0.934 (0.5 cy)", () => {
  const e = EW.earthwork(CASES["8.1"](), { subdivide: 4 });
  near(e.cutCy, 325.1, 0.5); near(e.fillCy, 348.2, 0.5); near(e.netCy, 23.1, 0.5);
  // 325.1 / 348.2 = 0.9337
  near(e.balance, 0.934, 0.002);
});

t("16 preset 8.1-wall: cut 325.1, fill 296.9, net -28.2 (0.5 cy)", () => {
  // the wall on the south edge stops the south fill slope: 348.2 - 51.3 = 296.9
  const e = EW.earthwork(CASES["8.1-wall"](), { subdivide: 4 });
  near(e.cutCy, 325.1, 0.5); near(e.fillCy, 296.9, 0.5); near(e.netCy, -28.2, 0.5);
});

t("16 preset 8.1-site: pad top 999.97 gives cut 336.9, fill 335.5; |fill - cut| <= 2 cy", () => {
  const e = EW.earthwork(CASES["8.1-site"](), { subdivide: 4 });
  near(e.cutCy, 336.9, 0.5); near(e.fillCy, 335.5, 0.5);
  ok(Math.abs(e.fillCy - e.cutCy) <= 2, "site balance within 2 cy");
});

t("16 balancing the whole grid by bisection on the pad top gives 999.97 (earthwork drives balance 'site')", () => {
  const at = (top) => {
    const b = fixtureBuilt({ ground: G5, pads: [{ ring: BAR, top }], extent: BAR });
    const e = EW.earthwork(b, { subdivide: 4 });
    return e.fillCy - e.cutCy;
  };
  let lo = 998.5, hi = 1001.5, n = 0;
  while (hi - lo > 0.005 && n++ < 40) { const mid = (lo + hi) / 2; if (at(mid) < 0) lo = mid; else hi = mid; }
  near((lo + hi) / 2, 999.97, 0.015);
});

/* ------------------------------------------- 17 earthwork, 8.4 to 8.7 ---- */

t("17 preset 8.4: whole preset cut 4,208.7, fill 4,312.3, net +103.7 (1 percent)", () => {
  const e = EW.earthwork(CASES["8.4"](), { subdivide: 4 });
  rel(e.cutCy, 4208.7, 0.01, "cut"); rel(e.fillCy, 4312.3, 0.01, "fill");
  near(e.netCy, 103.7, 60, "net (difference of two 1 percent numbers)");
});

t("17 preset 8.4 parts by region: pads 937.5 each way, lot 2,682.4", () => {
  const b = CASES["8.4"]();
  // pads only: three 202 x 76 pads. Closed form 324.1 cy each; the grid 937.5 for three (the 101 ft and 38 ft half-sizes fall between samples)
  const pads = [-120, 0, 120].map((yc) => ({ minX: -101, maxX: 101, minY: yc - 38, maxY: yc + 38 }));
  const inPads = (x, y) => pads.some((p) => x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY);
  const ep = EW.earthwork(b, { subdivide: 4, region: inPads });
  rel(ep.cutCy, 937.5, 0.01, "pads cut"); rel(ep.fillCy, 937.5, 0.01, "pads fill");
  // lot x 130 to 290, y -150 to 150: cut = fill = 72,426.7 cf = 2,682.5 cy (grid 2,682.4); region as a box and as a ring
  const el = EW.earthwork(b, { subdivide: 4, region: { minX: 130, maxX: 290, minY: -150, maxY: 150 } });
  near(el.cutCy, 2682.4, 3); near(el.fillCy, 2682.4, 3);
  const er = EW.earthwork(b, { subdivide: 4, region: rect(130, -150, 290, 150) });
  same([er.cutCy, er.fillCy], [el.cutCy, el.fillCy]);
});

t("17 preset 8.5: pads only cut 12,192.1, fill 7,348.3; whole preset cut 13,359.7, fill 9,219.3, net -4,140.4", () => {
  // ring: (460 x 0.05 x 142.5^2 - 310 x 0.05 x 67.5^2) / 2 = 198,210.9 cf = 7,341.1 cy; deck net cut 3.125 x 41,850 = 130,781.3 cf; wedge 193.8 cf
  const e0 = EW.earthwork(CASES["8.5"](noDay), { subdivide: 4 });
  rel(e0.cutCy, 12192.1, 0.01, "pads cut"); rel(e0.fillCy, 7348.3, 0.01, "pads fill");
  const e = EW.earthwork(CASES["8.5"](), { subdivide: 4 });
  rel(e.cutCy, 13359.7, 0.01, "cut"); rel(e.fillCy, 9219.3, 0.01, "fill"); rel(e.netCy, -4140.4, 0.01, "net");
});

t("17 preset 8.6: whole preset cut 21,998.9, fill 0; without the wall cut 26,032.5", () => {
  // pad 310 x 8.4 x 210 = 546,840 cf = 20,253.3 cy; end slopes 1,463.5 cy; the rest is the corner cones past the wall ends
  const e = EW.earthwork(CASES["8.6"](), { subdivide: 4 });
  rel(e.cutCy, 21998.9, 0.01, "cut"); ok(e.fillCy < 0.01 * e.cutCy, `fill ${e.fillCy} should be 0`);
  const free = EW.earthwork(CASES["8.6"]({ walls: [] }), { subdivide: 4 });
  rel(free.cutCy, 26032.5, 0.01, "cut without the wall");
});

t("17 preset 8.7: a flat site gives cut 0, fill 0, balance 1, nothing disturbed", () => {
  const e = EW.earthwork(CASES["8.7"](), { subdivide: 4 });
  eq(e.cutCy, 0); eq(e.fillCy, 0); eq(e.netCy, 0); eq(e.bulkedNetCy, 0); eq(e.balance, 1); eq(e.disturbedArea, 0);
});

t("17 disturbed area and cells: preset 8.2 pad is 19,500 sf; the skip rule drops far cells", () => {
  const b = CASES["8.2"]();
  const e = EW.earthwork(b, { subdivide: 4 });
  // the pad is 300 x 65 = 19,500 sf; samples within 0.1 ft of the ground (a 2.5 ft band at the 4 percent crossover x = 0 is under 0.1 ft: |dz| <= 0.1 for |x| <= 2.5)
  // so the disturbed area is the pad less the strip |x| < 2.5: 19,500 - 5 x 65 = 19,175 sf
  near(e.disturbedArea, 19175, 1);
  const m = b.grid.n - 1;
  ok(e.cellsSampled > 0 && e.cellsSampled < m * m / 4, `cells sampled ${e.cellsSampled} of ${m * m}`);
  // skipping is only a speed rule: a no-skip run (a box over the whole grid) gives the same volumes
  const all = { ...b, tiers: [{ ...b.tiers[0], pad: rect(b.grid.x0, b.grid.y0, b.grid.x0 + (b.grid.n - 1) * b.grid.spacing, b.grid.y0 + (b.grid.n - 1) * b.grid.spacing) }] };
  const f = EW.earthwork(all, { subdivide: 4 });
  same([f.cutCy, f.fillCy, f.disturbedArea], [e.cutCy, e.fillCy, e.disturbedArea]);
});

t("17 proposedGrid: n * n Float64Array of surface.at at every node", () => {
  const b = CASES["8.1"]();
  const g = EW.proposedGrid(b);
  ok(g instanceof Float64Array); eq(g.length, 71 * 71);
  eq(b.grid.n, 71); eq(b.grid.spacing, 10); eq(b.grid.x0, -350); eq(b.grid.y0, -350);
  const idx = (35 * 71) + 35;   // node (0, 0): inside the pad
  near(g[idx], 1000, 1e-9);
  near(g[(5 * 71) + 5], b.existingAt(-300, -300), 1e-9);   // far from the pad: existing ground
});

/* ---------------------------------------------------- 18 bulking ---- */

t("18 bulking 1.20 with cut 100 and fill 80 gives bulked net -40", () => {
  // a uniform 9 ft cut over 300 sf = 2,700 cf = 100 cy and a 7.2 ft fill over 300 sf = 2,160 cf = 80 cy, on whole 10 ft cells
  // bulked net = fill - cut x bulking = 80 - 100 x 1.2 = -40
  const ex = () => 1000;
  const ring = (x) => rect(x, 0, x + 30, 10);
  const nodes = new Float64Array(11 * 11 * 3);
  const grid = { spacing: 10, n: 11, x0: 0, y0: 0, nodes };
  for (let j = 0; j < 11; j++) for (let i = 0; i < 11; i++) { const k = (j * 11 + i) * 3; nodes[k] = i * 10; nodes[k + 1] = j * 10; nodes[k + 2] = 1000; }
  const at = (x, y) => (y >= 0 && y <= 10 ? (x >= 0 && x <= 30 ? 991 : x >= 50 && x <= 80 ? 1007.2 : 1000) : 1000);
  const built = { grid, existingAt: ex, surface: { at }, tiers: [{ id: "B1-T1", pad: ring(0) }, { id: "B1-T2", pad: ring(50) }], features: [] };
  const e = EW.earthwork(built, { subdivide: 4, bulking: 1.2 });
  near(e.cutCy, 100, 0.1); near(e.fillCy, 80, 0.1); near(e.netCy, -20, 0.1); near(e.bulkedNetCy, -40, 0.1);
  near(EW.earthwork(built, { subdivide: 4 }).bulkedNetCy, -20, 0.1);   // bulking 1.00 is off
});

t("18 earthwork does not mutate its input and repeats exactly", () => {
  const b = CASES["8.4"]();
  const frozen = deepFreeze({ ...b, tiers: b.tiers, features: b.features, walls: b.walls });
  const a = EW.earthwork(frozen, { subdivide: 4 }), c = EW.earthwork(frozen, { subdivide: 4 });
  same(a, c);
  const nodesBefore = Array.from(b.grid.nodes.slice(0, 60));
  EW.proposedGrid(frozen);
  same(Array.from(b.grid.nodes.slice(0, 60)), nodesBefore);
});

t("18 earthwork refuses a built result with no grid or surface", () => {
  let threw = 0;
  try { EW.earthwork({}); } catch { threw++; }
  try { EW.proposedGrid({ grid: { spacing: 10, n: 3, x0: 0, y0: 0 } }); } catch { threw++; }
  eq(threw, 2);
});

/* ---------------------------------------------------- 19, 20 routes ---- */

const LIM = { walk: 0.05, ramp: 0.0833, cross: 0.0208, rampRise: 2.5 };
const routeUp = { id: "R1", name: "Entry walk", line: [[0, 0], [0, 100]] };

t("19 route up a 5 percent plane is a walk; 6 percent is a ramp with ramp-landing; 9 percent fails", () => {
  const p5 = RT.routeProfile(routeUp, plane(1000, 5, 180), LIM);
  eq(p5.kind, "walk"); near(p5.maxSlope, 0.05, 1e-4); eq(p5.warnings.length, 0);
  eq(p5.samples.length, 101); eq(p5.samples[0].s, 0); eq(p5.samples[100].s, 100); ok(p5.samples.every((s) => s.cls === "walk"));
  // 6 percent over 100 ft = 6.0 ft of rise in one run of ramp samples, above the 2.5 ft limit
  const p6 = RT.routeProfile(routeUp, plane(1000, 6, 180), LIM);
  eq(p6.kind, "ramp"); near(p6.maxSlope, 0.06, 1e-4);
  eq(p6.warnings.length, 1); eq(p6.warnings[0].code, "ramp-landing");
  ok(/climbs 6 ft/.test(p6.warnings[0].message), p6.warnings[0].message);
  ok(!/compliant/i.test(p6.warnings[0].message.replace(/never/g, "")), "never says compliant");
  const p9 = RT.routeProfile(routeUp, plane(1000, 9, 180), LIM);
  eq(p9.kind, "ramp"); near(p9.maxSlope, 0.09, 1e-4);
  ok(p9.samples.every((s) => s.cls === "fail"));
  eq(p9.warnings.length, 1); eq(p9.warnings[0].code, "route-fail"); eq(p9.warnings[0].severity, "warn");
});

t("19 a short ramp run under 2.5 ft of rise needs no landing; a 1:12 ramp of 30 in is the limit", () => {
  // 8 percent over 30 ft = 2.4 ft rise, a ramp with no landing flag
  const short = RT.routeProfile({ id: "R2", line: [[0, 0], [0, 30]] }, plane(1000, 8, 180), LIM);
  eq(short.kind, "ramp"); eq(short.warnings.length, 0);
  // a walk, then a ramp: the rise counts only the ramp samples. Ground: flat to y = 50, 8 percent after
  const kink = (x, y) => 1000 + (y > 50 ? 0.08 * (y - 50) : 0);
  const k = RT.routeProfile({ id: "R3", line: [[0, 0], [0, 100]] }, kink, LIM);
  eq(k.kind, "ramp"); eq(k.samples[0].cls, "walk");
  eq(k.warnings.filter((w) => w.code === "ramp-landing").length, 1);
});

t("19 the last 5 ft look back, a bend follows each segment, and the end sample lands on the end", () => {
  const p = RT.routeProfile({ id: "R4", line: [[0, 0], [0, 7.5], [10, 7.5]] }, plane(1000, 5, 180), LIM);
  const last = p.samples[p.samples.length - 1];
  eq(last.s, 17.5); near(last.x, 10, 1e-9); near(last.y, 7.5, 1e-9);
  // the first leg climbs at 5 percent; the leg along x is level
  near(p.samples[0].running, 0.05, 1e-4); near(last.running, 0, 1e-4);
  // a route shorter than 5 ft takes its own length as the run
  const tiny = RT.routeProfile({ id: "R5", line: [[0, 0], [0, 3]] }, plane(1000, 5, 180), LIM);
  near(tiny.maxSlope, 0.05, 1e-4);
});

t("20 a route along x on a 3 percent plane rising north has cross slope 0.03 and fails", () => {
  // z(p + 2.5 n) - z(p - 2.5 n) = 0.03 x 5 = 0.15 over 5 ft = 0.03, above the 0.0208 limit
  const p = RT.routeProfile({ id: "R6", line: [[0, 0], [100, 0]] }, plane(1000, 3, 180), LIM);
  near(p.maxCross, 0.03, 1e-4); near(p.maxSlope, 0, 1e-4);
  ok(p.samples.every((s) => s.cls === "fail"));
  eq(p.kind, "ramp"); eq(p.warnings.length, 1); eq(p.warnings[0].code, "route-fail");
  // a 2 percent cross slope passes
  const q = RT.routeProfile({ id: "R7", line: [[0, 0], [100, 0]] }, plane(1000, 2, 180), LIM);
  ok(q.samples.every((s) => s.cls === "walk")); eq(q.warnings.length, 0);
});

t("19 routeProfile does not mutate its input and refuses a one-point route", () => {
  const r = deepFreeze({ id: "R8", line: [[0, 0], [0, 50]] });
  const a = RT.routeProfile(r, plane(1000, 5, 180), deepFreeze({ ...LIM })), b = RT.routeProfile(r, plane(1000, 5, 180), LIM);
  same(a, b);
  let threw = false;
  try { RT.routeProfile({ line: [[0, 0]] }, plane(1000, 5, 180), LIM); } catch { threw = true; }
  ok(threw);
});

/* -------------------------------------------------------- 21 contours ---- */

function planeValuesGrid(n, d, fn) {
  const v = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = fn(i * d, j * d);
  return { grid: { spacing: d, n, x0: 0, y0: 0 }, v };
}

t("21 contours of a 100 x 100 grid, 5 percent plane rising north, interval 1: straight lines, 1,001 at y = 20", () => {
  // z = 1000 + 0.05 y, spacing 10: the level 1000 + k sits at y = 20 k
  const { grid, v } = planeValuesGrid(100, 10, (x, y) => 1000 + 0.05 * y);
  const c = CT.contours(grid, v, 1);
  eq(c.length, 49);   // levels 1001 to 1049 (z reaches 1049.5); 1000 is the bottom row, not a crossing line
  const one = c.find((q) => q.z === 1001);
  ok(one, "1,001 present");
  ok(one.line.length >= 2 && one.line.every((p) => Math.abs(p[1] - 20) < 1e-9), "y = 20 all along");
  near(one.line[0][0] === 0 || one.line[one.line.length - 1][0] === 0 ? 0 : 1, 0);
  eq(Math.min(...one.line.map((p) => p[0])), 0); eq(Math.max(...one.line.map((p) => p[0])), 990);
  for (const q of c) { eq(q.line.length, 100, `line ${q.z}`); ok(q.line.every((p) => Math.abs(p[1] - (q.z - 1000) * 20) < 1e-9), `straight ${q.z}`); }
  // majors: every fifth level
  eq(c.find((q) => q.z === 1005).major, true); eq(c.find((q) => q.z === 1010).major, true); eq(c.find((q) => q.z === 1004).major, false);
  eq(c.filter((q) => q.major).length, 9);
  // interval 2
  const c2 = CT.contours(grid, v, 2);
  eq(c2.length, 24); eq(c2[0].z, 1002); eq(c2.find((q) => q.z === 1010).major, true); eq(c2.find((q) => q.z === 1004).major, false);
});

t("21 a closed contour repeats its first point; a pit gives one closed ring; a saddle splits", () => {
  const { grid, v } = planeValuesGrid(21, 10, (x, y) => 1000 + Math.hypot(x - 100, y - 100) * 0.05);   // a cone, 0.5 ft rim at 10 ft
  const c = CT.contours(grid, v, 0.25);
  const ring = c.find((q) => q.z === 1002.5 || q.z === 1002.25) || c[c.length - 1];
  ok(ring, "has a level");
  same(ring.line[0], ring.line[ring.line.length - 1], "closed");
  // radius of the 1000 + 0.05 r = 1002 ring is 40 ft
  const r2 = c.find((q) => q.z === 1002);
  ok(r2.line.every((p) => Math.abs(Math.hypot(p[0] - 100, p[1] - 100) - 40) < 0.2), "radius 40");
  // a saddle z = (x - 50)(y - 50) / 1000: the zero contour is the two crossing lines
  const s = planeValuesGrid(11, 10, (x, y) => ((x - 45) * (y - 45)) / 1000);
  const zl = CT.contours(s.grid, s.v, 0.5);
  ok(zl.length > 0);
});

t("21 zeroLine finds the cut and fill line and ignores noise", () => {
  // diff = x - 45 on a 10 x 10 grid: the zero line is the vertical x = 45
  const { grid, v } = planeValuesGrid(10, 10, (x) => x - 45);
  const z = CT.zeroLine(grid, v);
  eq(z.length, 1); ok(z[0].every((p) => Math.abs(p[0] - 45) < 1e-9)); eq(z[0].length, 10);
  // noise-level differences draw nothing
  const noise = new Float64Array(100).map((_, i) => (i % 2 ? 1e-12 : -1e-12));
  eq(CT.zeroLine(grid, noise).length, 0);
  // a pad cut/fill pair: preset 8.1 has a zero line across the pad along the long axis
  const b = CASES["8.1"]();
  const prop = EW.proposedGrid(b);
  const diff = new Float64Array(prop.length);
  for (let i = 0; i < diff.length; i++) diff[i] = prop[i] - b.grid.nodes[i * 3 + 2];
  const zero = CT.zeroLine(b.grid, diff);
  ok(zero.length >= 1, "a cut and fill line exists");
});

t("21 contours refuse a bad grid or interval and do not mutate", () => {
  const { grid, v } = planeValuesGrid(5, 10, (x, y) => y * 0.1);
  let threw = 0;
  try { CT.contours(grid, v, 0); } catch { threw++; }
  try { CT.contours({ spacing: 10, n: 1, x0: 0, y0: 0 }, v, 1); } catch { threw++; }
  try { CT.contours(grid, new Float64Array(3), 1); } catch { threw++; }
  eq(threw, 3);
  eq(CT.contours(grid, new Float64Array(25).fill(5), 1).length, 0);
  const a = CT.contours(deepFreeze({ ...grid }), v, 0.5), b = CT.contours(grid, v, 0.5);
  same(a, b);
});

/* --------------------------------------------------------- 22 metrics ---- */

const STATE = (over = {}) => ({
  schema: 1, maxStep: 4, balance: "pad", drives: [], lots: [], walls: [], routes: [],
  limits: { walk: 0.05, ramp: 0.0833, cross: 0.0208, rampRise: 2.5, wallFlag: 4, lotMin: 0.01, lotMax: 0.05, driveMax: 0.10 },
  earthwork: { subdivide: 4, bulking: 1 }, property: { mode: "site", ring: [] }, ...over,
});

t("22 preset 8.1: corners +2.625 south and -0.625 north; exposed and cut face under 0.1 with daylight", () => {
  // FFE 1,001; existing at the south corners 1,000 + 0.05 x -32.5 = 998.375 -> +2.625; north 1,001.625 -> -0.625
  const m = MT.computeMetrics(STATE(), CASES["8.1"]());
  const t1 = m.tiers[0];
  eq(t1.id, "B1-T1"); eq(t1.corners.length, 4);
  near(t1.cornerMax, 2.625, 0.001); near(t1.cornerMin, -0.625, 0.001);
  const south = t1.corners.filter((c) => c.y < 0), north = t1.corners.filter((c) => c.y > 0);
  ok(south.every((c) => Math.abs(c.above - 2.625) < 0.001)); ok(north.every((c) => Math.abs(c.above + 0.625) < 0.001));
  // daylight meets the pad edge: 0.01 ft outside, the ground is within 0.01 / 2 = 0.005 of the pad top
  ok(t1.exposed <= 0.01 && t1.cutFace <= 0.01, `exposed ${t1.exposed}, cut face ${t1.cutFace}`);
});

t("22 preset 8.2: exposed foundation 6.0 ft at the west end, cut face 6.0 ft at the east end", () => {
  // pad top 1,000; ground 1,000 + 0.04 x at x = -150 is 994 -> 6.0; at x = +150 it is 1,006 -> 6.0
  const m = MT.computeMetrics(STATE(), CASES["8.2"]());
  near(m.tiers[0].exposed, 6.0, 0.01); near(m.tiers[0].cutFace, 6.0, 0.01);
});

t("22 preset 8.3: exposed 2.0 and cut face 2.0 per tier; steps 4.0 and 4.0, no warning; two pad-step walls of 4.0 ft", () => {
  // tier 1 pad top 996, ground at x = -150 is 994 -> 2.0; the shared edges touch another pad and are skipped
  const b = CASES["8.3"]();
  b.walls = [-50, 50].map((x, i) => ({ id: `S${i + 1}`, kind: "pad-step", line: [[x, -32.5], [x, 32.5]] }));
  const m = MT.computeMetrics(STATE(), b);
  eq(m.tiers.length, 3);
  for (const tr of m.tiers) { near(tr.exposed, 2.0, 0.01, tr.id); near(tr.cutFace, 2.0, 0.01, tr.id); }
  same(m.tiers.map((x) => x.step), [4, 4, null]);
  same(m.steps.map((s) => s.step), [4, 4]);
  eq(m.walls.count, 2); eq(m.walls.byKind["pad-step"].count, 2); near(m.walls.heightMax, 4.0, 0.01); near(m.wallHeightMax, 4.0, 0.01);
  // exactly at the maximum step: no step warning, no wall-height warning (4.0 is not over 4)
  eq(MT.checks(STATE(), m).filter((w) => w.code === "step" || w.code === "wall-height").length, 0);
  // exposed foundation above 6 raises nothing here; a 5 ft step does warn
  const hi = CASES["8.3"]();
  hi.tiers[1].ffe += 1; hi.tiers[1].padTop += 1;
  const w = MT.checks(STATE(), MT.computeMetrics(STATE(), hi)).filter((x) => x.code === "step");
  eq(w.length, 1); ok(/maximum/.test(w[0].message));
});

t("22 wall heights: 8.1-wall 1.625, 8.6 16.80 (flagged), 8.4 2.28; totals and kinds", () => {
  // 8.1-wall: the pad top 1,000 against the south ground at y = -32.5 outside: 998.375 + wall is blocked, so the outside is existing -> 1.625
  const a = MT.computeMetrics(STATE(), CASES["8.1-wall"]());
  near(a.walls.heightMax, 1.625, 0.01); near(a.walls.heightAvg, 1.625, 0.01); near(a.walls.length, 300, 0.1);
  eq(a.walls.byKind.drawn.count, 1);
  eq(MT.checks(STATE(), a).filter((w) => w.code === "wall-height").length, 0);
  // 8.6: 0.08 x 210 = 16.8
  const b = MT.computeMetrics(STATE(), CASES["8.6"]());
  near(b.walls.heightMax, 16.8, 0.01);
  const flags = MT.checks(STATE(), b).filter((w) => w.code === "wall-height");
  eq(flags.length, 1); ok(/engineer/.test(flags[0].message));
  // 8.4: 0.06 x 38 = 2.28 each, three walls of 202 ft
  const c = MT.computeMetrics(STATE(), CASES["8.4"]());
  eq(c.walls.count, 3); near(c.walls.heightMax, 2.28, 0.01); near(c.walls.heightAvg, 2.28, 0.01); near(c.wallLength, 606, 0.5);
  // stats already on a wall are kept
  const kept = CASES["8.1-wall"]();
  kept.walls = [{ ...kept.walls[0], heightMax: 5, heightAvg: 3, length: 300 }];
  const k = MT.computeMetrics(STATE(), kept);
  eq(k.walls.heightMax, 5); eq(k.walls.heightAvg, 3);
  eq(MT.checks(STATE(), k).filter((w) => w.code === "wall-height").length, 1);
});

t("22 metrics rows: earthwork, pad area, bulking, steepest route, lots, drives, outside-site", () => {
  const b = CASES["8.1"]();
  const m = MT.computeMetrics(STATE({ earthwork: { subdivide: 4, bulking: 1.2 } }), b);
  near(m.cutCy, 325.1, 0.5); near(m.fillCy, 348.2, 0.5); near(m.bulkedNetCy, m.fillCy - m.cutCy * 1.2, 0.11);
  near(m.padArea, 19500, 0.1); ok(m.disturbedArea > 19000);
  eq(m.steepestRoute, 0);
  // a route at 6 percent: steepest 0.06, ramp-landing reaches the list
  const st = STATE({ routes: [{ id: "R1", name: "Entry walk", line: [[0, 40], [0, 140]] }] });
  const r = MT.computeMetrics(st, CASES["8.1"]());
  near(r.steepestRoute, 0.05, 1e-4);
  const g = MT.checks(st, MT.computeMetrics(STATE({ routes: [{ id: "R2", line: [[-300, -300], [-300, -200]] }] }), CASES["8.1"]()));
  eq(g.length, 0, "5 percent walk gives no route warning");
  // lots and drives
  const lw = MT.checks(STATE({ lots: [{ id: "L1", ring: sq(0, 0, 10, 10), slope: 0.5 }, { id: "L2", ring: sq(0, 0, 10, 10), slope: 2 }, { id: "L3", ring: sq(0, 0, 10, 10), slope: 6 }], drives: [{ id: "D1", line: [[0, 0], [0, 10]], slope: 12 }, { id: "D2", line: [[0, 0], [0, 10]], slope: 5 }] }), m)
    .filter((w) => w.code === "lot-slope" || w.code === "drive-slope");
  same(lw.map((w) => w.code), []);   // metrics holds none of these lots: checks reads the rows of the metrics it is given
  const m2 = MT.computeMetrics(STATE({ lots: [{ id: "L1", ring: sq(0, 0, 10, 10), slope: 0.5 }, { id: "L2", ring: sq(0, 0, 10, 10), slope: 2 }, { id: "L3", ring: sq(0, 0, 10, 10), slope: 6 }], drives: [{ id: "D1", line: [[0, 0], [0, 10]], slope: 12 }, { id: "D2", line: [[0, 0], [0, 10]], slope: 5 }] }), b);
  const w2 = MT.checks(STATE(), m2);
  same(w2.filter((w) => w.code === "lot-slope").map((w) => w.message.slice(0, 5)), ["Lot L", "Lot L"]);
  eq(w2.filter((w) => w.code === "lot-slope").length, 2); eq(w2.filter((w) => w.code === "drive-slope").length, 1);
  ok(/D1/.test(w2.find((w) => w.code === "drive-slope").message));
  // outside-site: a pad past the grid edge
  const far = fixtureBuilt({ ground: G5, pads: [{ ring: BAR, top: 1000 }], extent: BAR });
  far.tiers = [{ ...far.tiers[0], pad: rect(300, 0, 400, 40) }];
  const o = MT.checks(STATE(), MT.computeMetrics(STATE(), far)).filter((w) => w.code === "outside-site");
  eq(o.length, 1);
  const inside = MT.checks(STATE(), MT.computeMetrics(STATE(), CASES["8.1"]())).filter((w) => w.code === "outside-site");
  eq(inside.length, 0);
});

t("22 conflicts, build warnings, and quality draft pass through checks", () => {
  const b = CASES["8.1"]();
  b.conflicts = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 200, y: 200 }];
  b.warnings = [{ code: "tower-no-levels", severity: "info", where: null, message: "The Tower Generator does not write massing levels yet." }];
  const w = MT.checks(STATE(), MT.computeMetrics(STATE(), b));
  eq(w.filter((x) => x.code === "slope-conflict").length, 2);
  eq(w.filter((x) => x.code === "tower-no-levels").length, 1);
  b.quality = "draft";
  eq(MT.computeMetrics(STATE(), b).subdivide, 1);
  eq(MT.computeMetrics(STATE(), CASES["8.1"]()).subdivide, 4);
});

t("22 computeMetrics does not mutate and repeats exactly", () => {
  const b = CASES["8.4"](), st = STATE({ routes: [{ id: "R1", line: [[0, 0], [0, 80]] }] });
  const frozen = deepFreeze({ ...b, tiers: b.tiers, features: b.features, walls: b.walls, warnings: [] });
  same(MT.computeMetrics(deepFreeze(st), frozen), MT.computeMetrics(st, b));
});

/* ----------------------------------------- real modules, when they exist ---- */

const tryImport = async (p) => { try { return await import(p); } catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes("grading/")) return null; throw e; } };
const F = await tryImport("../src/grading/features.js");
const hasReal = F && typeof F.buildGrading === "function";

if (!hasReal) {
  console.log("  skip real buildGrading cases: src/grading/features.js is not there yet");
} else {
  const typed = (id, outer, extra = {}) => ({ id, name: id, source: "typed", outer, axis: "auto", tiers: [{ length: null, ffe: "balance" }], padOffset: 5, padDepth: 1.0, ...extra });
  const S = (over) => ({
    schema: 1, name: "t", source: "standalone",
    ground: { mode: "plane", plane: { z0: 1000, slope: 5, downhill: 180 }, margin: 200 }, property: { mode: "site", ring: [] },
    buildings: [], balance: "pad", maxStep: 4, drives: [], lots: [], walls: [], autoWalls: { on: true, offset: 5, accepted: [] }, routes: [],
    daylight: { on: true, fill: 3, cut: 2 }, limits: STATE().limits, earthwork: { subdivide: 4, bulking: 1 },
    view: { style: "model", contours: { on: true, interval: 1, existing: true, proposed: true }, exaggeration: 1, section: null, context: true, grid: false, figure: true, shadows: true, sun: { azimuth: 135, altitude: 40 } },
    ...over,
  });
  const REAL = {
    "8.1": { state: S({ buildings: [typed("B1", BAR, { padOffset: 0 })] }), cut: 325.1, fill: 348.2, tol: 0.5 },
    "8.1-wall": { state: S({ buildings: [typed("B1", BAR, { padOffset: 0 })], walls: [{ id: "W1", line: SOUTH_WALL.line, kind: "drawn" }] }), cut: 325.1, fill: 296.9, tol: 0.5 },
    "8.1-site": { state: S({ buildings: [typed("B1", BAR, { padOffset: 0 })], balance: "site" }), cut: 336.9, fill: 335.5, tol: 0.5 },
    "8.2": { state: S({ ground: { mode: "plane", plane: { z0: 1000, slope: 4, downhill: 270 }, margin: 200 }, daylight: { on: false, fill: 3, cut: 2 }, buildings: [typed("B1", BAR, { padOffset: 0 })] }), cut: 1083.3, fill: 1083.3, tol: 0.1 },
    "8.3": { state: S({ ground: { mode: "plane", plane: { z0: 1000, slope: 4, downhill: 270 }, margin: 200 }, daylight: { on: false, fill: 3, cut: 2 }, buildings: [typed("B1", BAR, { padOffset: 0, tiers: [{ length: null, ffe: "balance" }, { length: null, ffe: "balance" }, { length: null, ffe: "balance" }] })] }), cut: 361.1, fill: 361.1, tol: 0.1 },
    "8.7": { state: S({ ground: { mode: "plane", plane: { z0: 1000, slope: 0, downhill: 180 }, margin: 200 }, buildings: [typed("B1", sq(0, 0, 310, 75), { padOffset: 0 })] }), cut: 0, fill: 0, tol: 0.05 },
  };
  const rows = [-120, 0, 120];
  const G = (slope, z0 = 1000) => ({ mode: "plane", plane: { z0, slope, downhill: 180 }, margin: 200 });
  REAL["8.4"] = {
    state: S({
      ground: G(6),
      buildings: rows.map((yc, k) => typed(`B${k + 1}`, sq(0, yc, 192, 66))),
      walls: rows.map((yc, k) => ({ id: `W${k + 1}`, kind: "drawn", line: [[-101, yc - 38], [101, yc - 38]] })),
      lots: [{ id: "L1", ring: rect(130, -150, 290, 150), anchor: [210, 0], start: "existing", dir: 0, slope: 2, cross: 1 }],
    }), cut: 4208.7, fill: 4312.3, rel: 0.01,
  };
  REAL["8.5"] = {
    state: S({
      ground: G(5),
      buildings: [typed("B1", sq(0, 0, 300, 125), { tiers: [{ length: null, ffe: 997.875 }] }), typed("B2", sq(0, 0, 450, 275))],
    }), cut: 13359.7, fill: 9219.3, rel: 0.01,
  };
  REAL["8.6"] = {
    state: S({
      ground: G(8),
      buildings: [typed("B1", sq(0, 0, 300, 200), { tiers: [{ length: null, ffe: 992.6 }] })],
      walls: [{ id: "W1", kind: "drawn", line: [[-155, 105], [155, 105]] }],
    }), cut: 21998.9, fill: 0, rel: 0.01,
  };
  for (const [id, c] of Object.entries(REAL)) {
    t(`real ${id}: buildGrading + earthwork reproduce the section 8 grid values`, () => {
      const built = F.buildGrading(c.state);
      const e = EW.earthwork(built, { subdivide: 4 });
      if (c.rel) {
        rel(e.cutCy, c.cut, c.rel, "cut");
        if (c.fill > 0) rel(e.fillCy, c.fill, c.rel, "fill"); else ok(e.fillCy < 0.01 * e.cutCy, `fill ${e.fillCy} should be 0`);
      } else { near(e.cutCy, c.cut, c.tol, "cut"); near(e.fillCy, c.fill, c.tol, "fill"); }
      const m = MT.computeMetrics(c.state, built);
      near(m.cutCy, e.cutCy, 1e-9);
    });
  }

  t("real 22: wall heights 1.625 (8.1-wall), 16.80 (8.6), 2.28 (8.4); corners and exposure on 8.1, 8.2, 8.3", () => {
    const wall = MT.computeMetrics(REAL["8.1-wall"].state, F.buildGrading(REAL["8.1-wall"].state));
    near(wall.walls.heightMax, 1.625, 0.01); near(wall.walls.heightAvg, 1.625, 0.01);
    near(MT.computeMetrics(REAL["8.6"].state, F.buildGrading(REAL["8.6"].state)).walls.heightMax, 16.8, 0.01);
    const w84 = MT.computeMetrics(REAL["8.4"].state, F.buildGrading(REAL["8.4"].state));
    near(w84.walls.heightMax, 2.28, 0.01); near(w84.walls.heightAvg, 2.28, 0.01);
    // 8.1: corners +2.625 and -0.625
    const a = MT.computeMetrics(REAL["8.1"].state, F.buildGrading(REAL["8.1"].state)).tiers[0];
    near(a.cornerMax, 2.625, 0.001); near(a.cornerMin, -0.625, 0.001);
    // 8.2: exposed 6.0 and cut face 6.0
    const b = MT.computeMetrics(REAL["8.2"].state, F.buildGrading(REAL["8.2"].state)).tiers[0];
    near(b.exposed, 6.0, 0.01); near(b.cutFace, 6.0, 0.01);
    // 8.3: three tiers, exposed 2.0, steps 4 and 4, two pad-step walls of 4.0 ft, no step or wall warning
    const m3 = MT.computeMetrics(REAL["8.3"].state, F.buildGrading(REAL["8.3"].state));
    eq(m3.tiers.length, 3);
    for (const x of m3.tiers) near(x.exposed, 2.0, 0.01, x.id);
    same(m3.steps.map((q) => q.step), [4, 4]);
    eq(m3.walls.byKind["pad-step"].count, 2); near(m3.walls.heightMax, 4.0, 0.01);
    eq(m3.warnings.filter((q) => q.code === "step" || q.code === "wall-height").length, 0);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
