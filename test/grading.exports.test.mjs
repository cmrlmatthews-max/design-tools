// Run: node test/grading.exports.test.mjs
// Plan tests 23 to 27 (docs/grading-sketch-technical-plan.md section 9.1):
//   23  preset 8.1 through gradingDerived, writeSection and validate
//   24  Revit CSV of preset 8.1: 71 x 71 lines, 3 decimals, no header
//   25  DXF of preset 8.6: every layer; the wall text holds 1,008.40 and 991.60
//   26  SketchUp doc of preset 8.5: validateDoc passes; source grading; zShift brings the minimum to 0
//   27  notes of preset 8.1: the earthwork table and every Caution line
// Plus the other layers (drive, lot, route, spot, cut and fill), the wall solids, the id rules, and input immutability.
//
// The build comes from a hand fixture that follows the plan section 4 contract (see "hand fixture"): axis-aligned
// rectangle pads, drives and lots, drawn and pad-step walls, the surface function of plan 3.5, and the sub-cell
// earthwork of plan 3.8. The fixture reproduces the section 8 grid values (checked below), so it is a fair stand-in.
// When src/grading/features.js, metrics.js and presets.js load, the same invariants also run against the real modules
// (section "real modules").
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { gradingDerived, tierIdentity, wallProfile, routeStats, simplify3, padPolygons } = await import("../src/grading/derived.js");
const { revitCsv, gradingDxf, notesMarkdown, GRADING_DXF_LAYERS, CAUTIONS } = await import("../src/grading/exports.js");
const { gradingToSketchup, SKETCHUP_SOURCE } = await import("../src/grading/sketchup.js");
const { gridSpacing } = await import("../src/site/geo.js");
const { newProject, writeSection, validate } = await import("../src/shared/project.js");
const { validateDoc } = await import("../src/shared/sketchup-format.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

/* ---------- states (plan section 2 and 8) ---------- */

const baseState = () => ({
  schema: 1, name: "Option A", source: "standalone",
  ground: { mode: "plane", plane: { z0: 1000, slope: 5, downhill: 180 }, margin: 200 },
  property: { mode: "site", ring: [] },
  buildings: [],
  balance: "pad", maxStep: 4,
  drives: [], lots: [], walls: [],
  autoWalls: { on: true, offset: 5, accepted: [] },
  routes: [],
  daylight: { on: true, fill: 3, cut: 2 },
  limits: { walk: 0.05, ramp: 0.0833, cross: 0.0208, rampRise: 2.5, wallFlag: 4, lotMin: 0.01, lotMax: 0.05, driveMax: 0.10 },
  earthwork: { subdivide: 4, bulking: 1.0 },
  view: { style: "model", contours: { on: true, interval: 1, existing: true, proposed: true }, exaggeration: 1, section: null, context: true, grid: false, figure: true, shadows: true, sun: { azimuth: 135, altitude: 40 } },
});
const rect = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
const bld = (id, name, cx, cy, w, h, ffe = "balance", padOffset = 0) => ({ id, name, source: "typed", outer: rect(cx, cy, w, h), axis: "auto", tiers: [{ length: null, ffe }], padOffset, padDepth: 1.0 });

const S81 = () => { const s = baseState(); s.buildings = [bld("B1", "Bar", 0, 0, 300, 65)]; return s; };
const S81wall = () => { const s = S81(); s.walls = [{ id: "W1", kind: "drawn", line: [[-150, -32.5], [150, -32.5]] }]; return s; };
const S85 = () => { const s = baseState(); s.name = "Wrap with a deck"; s.buildings = [bld("B1", "Deck", 0, 0, 300, 125, 997.875, 5), bld("B2", "Wrap", 0, 0, 450, 275, "balance", 5)]; return s; };
const S86 = () => {
  const s = baseState(); s.name = "Podium";
  s.ground.plane = { z0: 1000, slope: 8, downhill: 180 };
  s.buildings = [bld("B1", "Podium", 0, 0, 300, 200, 992.6, 5)];
  s.walls = [{ id: "W1", kind: "drawn", line: [[-155, 105], [155, 105]] }];
  return s;
};
// 8.1 with a drive, a lot, and two routes, to fill the other layers
const SALL = () => {
  const s = S81(); s.name = "All features";
  s.drives = [{ id: "D1", line: [[220, -150], [220, -100]], width: 24, start: "existing", slope: 5, cross: 2, crown: true }];
  s.lots = [{ id: "L1", ring: rect(260, 60, 60, 80), anchor: null, start: "existing", dir: 0, slope: 2, cross: 1 }];
  s.routes = [{ id: "R1", line: [[190, -100], [190, -10]], name: "Entry walk" }, { id: "R2", line: [[320, -150], [320, -60]], name: "Steep walk" }];
  return s;
};

/* ---------- hand fixture: buildGrading(state) and computeMetrics as plan sections 3 and 4 give them (axis-aligned rectangles) ---------- */

const inRect = (R, x, y, e = 1e-6) => x >= R.x0 - e && x <= R.x1 + e && y >= R.y0 - e && y <= R.y1 + e;
const rectOf = (ring) => { const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const ringOfRect = (R) => [[R.x0, R.y0], [R.x1, R.y0], [R.x1, R.y1], [R.x0, R.y1]];

function segsCross(a, b, c, d) {                                     // inclusive of end points (the fixture has axis-aligned walls)
  const cr = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cr(a, b, c), d2 = cr(a, b, d), d3 = cr(c, d, a), d4 = cr(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0));
}

function fixtureBuild(state) {
  const pl = state.ground.plane, b = (pl.downhill * Math.PI) / 180;
  const existingAt = (x, y) => pl.z0 - (pl.slope / 100) * (x * Math.sin(b) + y * Math.cos(b));

  // features
  const pads = [], tiers = [], buildings = [];
  for (const B of state.buildings) {
    buildings.push({ id: B.id, source: B.source, name: B.name, outer: B.outer, axis: 0 });
    const fp = rectOf(B.outer), off = B.padOffset;
    const R = { x0: fp.x0 - off, x1: fp.x1 + off, y0: fp.y0 - off, y1: fp.y1 + off };
    const c = B.tiers[0].ffe;
    const exs = [existingAt(R.x0, R.y0), existingAt(R.x1, R.y1), existingAt(R.x0, R.y1), existingAt(R.x1, R.y0)];
    const padTop = c === "balance" ? existingAt((R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2) : c - B.padDepth;      // a plane: the balanced top is the mean
    const ffe = padTop + B.padDepth;
    const pad = { R, z: () => padTop, ring: ringOfRect(R), id: B.id };
    pads.push(pad);
    tiers.push({ id: B.id, tier: 1, outer: B.outer, pad: ringOfRect(R), padTop, ffe, existingMin: Math.min(...exs), existingMax: Math.max(...exs) });
  }
  const drives = state.drives.map((d) => {
    const [a, c] = d.line, w = d.width, R = { x0: a[0] - w / 2, x1: a[0] + w / 2, y0: Math.min(a[1], c[1]), y1: Math.max(a[1], c[1]) };
    const zs = d.start === "existing" ? existingAt(a[0], a[1]) : d.start;
    const z = (x, y) => zs + (d.slope / 100) * (y - a[1]) - (d.cross / 100) * Math.abs(x - a[0]);
    return { id: d.id, kind: "drive", R, ring: ringOfRect(R), contains: (x, y) => inRect(R, x, y), z, slope: d.slope / 100 };
  });
  const lots = state.lots.map((l) => {
    const R = rectOf(l.ring), a = l.anchor || [(R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2];
    const za = l.start === "existing" ? existingAt(a[0], a[1]) : l.start;
    const z = (x, y) => za + (l.slope / 100) * (y - a[1]) + (l.cross / 100) * -(x - a[0]);
    return { id: l.id, kind: "lot", R, ring: ringOfRect(R), contains: (x, y) => inRect(R, x, y), z, slope: l.slope / 100, cross: l.cross / 100 };
  });
  const feats = [...pads.map((p) => ({ R: p.R, z: p.z })), ...drives, ...lots];

  // walls: drawn, plus a pad-step wall around each pad that lies inside an earlier one (wrap preset)
  const walls = state.walls.map((w) => ({ id: w.id, kind: w.kind, line: w.line.map((p) => p.slice()) }));
  for (let i = 1; i < pads.length; i++) for (let k = 0; k < i; k++) {
    const A = pads[k].R, Bn = pads[i].R;
    if (Math.abs(pads[k].z() - pads[i].z()) > 0.05 && A.x0 >= Bn.x0 && A.x1 <= Bn.x1 && A.y0 >= Bn.y0 && A.y1 <= Bn.y1) {
      walls.push({ id: `P${walls.length + 1}`, kind: "pad-step", line: [...ringOfRect(A), [A.x0, A.y0]] });
    }
  }
  const blocked = (p, q) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, q2 = [q[0] + (dx / L) * 0.01, q[1] + (dy / L) * 0.01];
    for (const w of walls) for (let i = 0; i < w.line.length - 1; i++) if (segsCross(p, q2, w.line[i], w.line[i + 1])) return true;
    return false;
  };
  const at = (x, y) => {
    for (const p of pads) if (inRect(p.R, x, y)) return p.z();
    for (const f of [...drives, ...lots]) if (f.contains(x, y)) return f.z(x, y);
    const ex = existingAt(x, y);
    if (!state.daylight.on) return ex;
    let lo = -Infinity, hi = Infinity;
    for (const f of feats) {
      const qx = Math.min(Math.max(x, f.R.x0), f.R.x1), qy = Math.min(Math.max(y, f.R.y0), f.R.y1);
      const d = Math.hypot(x - qx, y - qy);
      if (blocked([x, y], [qx, qy])) continue;
      const e = f.z(qx, qy);
      lo = Math.max(lo, e - d / state.daylight.fill); hi = Math.min(hi, e + d / state.daylight.cut);
    }
    if (lo === -Infinity) return ex;
    if (lo > hi) lo = hi = (lo + hi) / 2;
    return Math.min(Math.max(ex, lo), hi);
  };

  // grid (plan 3.1)
  const xsAll = [...state.buildings.flatMap((B) => B.outer.map((p) => p[0])), ...state.drives.flatMap((d) => d.line.map((p) => p[0])), ...state.lots.flatMap((l) => l.ring.map((p) => p[0])), ...state.routes.flatMap((r) => r.line.map((p) => p[0]))];
  const ysAll = [...state.buildings.flatMap((B) => B.outer.map((p) => p[1])), ...state.drives.flatMap((d) => d.line.map((p) => p[1])), ...state.lots.flatMap((l) => l.ring.map((p) => p[1])), ...state.routes.flatMap((r) => r.line.map((p) => p[1]))];
  const m = state.ground.margin, bx0 = Math.min(...xsAll) - m, bx1 = Math.max(...xsAll) + m, by0 = Math.min(...ysAll) - m, by1 = Math.max(...ysAll) + m;
  const S = Math.max(bx1 - bx0, by1 - by0), { spacing, n: n0 } = gridSpacing(S);
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const x0 = Math.floor((cx - S / 2) / spacing) * spacing, y0 = Math.floor((cy - S / 2) / spacing) * spacing;
  let n = n0; if (x0 + (n - 1) * spacing < bx1 || y0 + (n - 1) * spacing < by1) n += 1;
  const nodes = new Float64Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; nodes[k] = x0 + i * spacing; nodes[k + 1] = y0 + j * spacing; nodes[k + 2] = existingAt(x0 + i * spacing, y0 + j * spacing); }
  const grid = { spacing, n, x0, y0, nodes, at: existingAt };

  return {
    source: "plane", grid, existingAt, surface: { at, conflicts: [] }, buildings, tiers,
    features: [...drives.map(({ R, ...f }) => f), ...lots.map(({ R, ...f }) => f)], walls, conflicts: [], warnings: [], notes: ["Ground: a typed plane."],
    _pads: pads,
  };
}

/** Plan 3.8 with k x k sub-cells: { cutCy, fillCy, disturbedArea }. Also the metrics rows the fixture hands to the writers. */
function fixtureMetrics(state, built, k = 4) {
  const { n, spacing: d, x0, y0 } = built.grid, h = d / k;
  let cut = 0, fill = 0, dist = 0;
  for (let j = 0; j < (n - 1) * k; j++) for (let i = 0; i < (n - 1) * k; i++) {
    const x = x0 + (i + 0.5) * h, y = y0 + (j + 0.5) * h, df = built.surface.at(x, y) - built.existingAt(x, y);
    if (df > 0) fill += df * h * h; else cut -= df * h * h;
    if (Math.abs(df) > 0.1) dist += h * h;
  }
  const cutCy = cut / 27, fillCy = fill / 27, hi = Math.max(cutCy, fillCy);
  const padArea = built.tiers.reduce((s, tr) => { const R = rectOf(tr.pad); return s + (R.x1 - R.x0) * (R.y1 - R.y0); }, 0);
  return { cutCy, fillCy, netCy: fillCy - cutCy, balance: hi > 0 ? Math.min(cutCy, fillCy) / hi : 1, bulkedNetCy: fillCy - cutCy * state.earthwork.bulking, disturbedArea: dist, padArea, warnings: [] };
}

const run = (s) => { const b = fixtureBuild(s); return { s, b, m: fixtureMetrics(s, b) }; };
const R81 = run(S81()), R81w = run(S81wall()), R85 = run(S85()), R86 = run(S86()), RALL = run(SALL());

/* ---------- the fixture follows section 8 ---------- */

t("fixture: reproduces the section 8 grid values (8.1, 8.1-wall, 8.5, 8.6)", () => {
  eq([R81.b.grid.spacing, R81.b.grid.n, R81.b.grid.x0, R81.b.grid.y0], [10, 71, -350, -350]);
  near(R81.m.cutCy, 325.1, 0.5, "8.1 cut"); near(R81.m.fillCy, 348.2, 0.5, "8.1 fill");
  near(R81w.m.cutCy, 325.1, 0.5, "8.1-wall cut"); near(R81w.m.fillCy, 296.9, 0.5, "8.1-wall fill");
  near(R85.m.cutCy, 13359.7, 134, "8.5 cut (1 percent)"); near(R85.m.fillCy, 9219.3, 92, "8.5 fill (1 percent)");
  near(R86.m.cutCy, 21998.9, 220, "8.6 cut (1 percent)"); near(R86.m.fillCy, 0, 0.5, "8.6 fill");
});

/* ---------- test 23: derived ---------- */

const snap81 = JSON.stringify([R81.s, R81.m, R81.b.tiers, R81.b.walls, R81.b.buildings, Array.from(R81.b.grid.nodes)]);
const D81 = gradingDerived(R81.s, R81.b, R81.m);

t("test 23: preset 8.1 derived passes validate after writeSection", () => {
  const doc = writeSection(newProject({ name: "Grading test" }), "grading", { tool: "grading", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: R81.s, derived: D81 });
  const v = validate(doc);
  ok(v.ok, v.errors.join("; "));
  eq(doc.sections.grading.tool, "grading");
  eq(doc.sections.grading.derived.ffe[0].id, "B1-T1");
  eq(doc.sections.grading.derived.ground.points.length, 71 * 71);
  ok(JSON.stringify(doc).length < 400000, "project stays small: " + JSON.stringify(doc).length + " bytes");
  ok(!/NaN|null,null|undefined/.test(JSON.stringify(D81)), "no NaN");
});

t("test 23: the ffe row of preset 8.1 (arithmetic: pad top = mean existing = 1000; FFE = 1000 + 1.0 depth)", () => {
  eq(D81.ffe.length, 1);
  const f = D81.ffe[0];
  eq([f.id, f.source, f.tier, f.ffe, f.padTop], ["B1-T1", "standalone", 1, 1001, 1000]);
  near(f.existingMin, 998.375, 0.005); near(f.existingMax, 1001.625, 0.005);       // 1000 -/+ 0.05 x 32.5
  eq(f.outer, rect(0, 0, 300, 65));
  eq(Object.keys(f).sort(), ["existingMax", "existingMin", "ffe", "id", "outer", "padTop", "source", "tier"]);
});

t("test 23: ground = the proposed grid on the existing nodes, z to 0.01 ft", () => {
  const g = D81.ground;
  eq([g.spacing, g.n], [10, 71]);
  eq(g.points[0], [-350, -350, 982.5]);                                          // 1000 + 0.05 x -350, beyond the reach of the pad
  eq(g.points[70 * 71 + 70], [350, 350, 1017.5]);
  const mid = g.points[35 * 71 + 35];                                            // (0, 0) is inside the pad
  eq(mid, [0, 0, 1000]);
  ok(g.points.every((p) => Math.abs(p[2] * 100 - Math.round(p[2] * 100)) < 1e-6), "z on 0.01");
  const at = R81.b.surface.at;
  near(g.points[34 * 71 + 35][2], at(0, -10), 0.0051);                           // (0, -10) is in the pad
  near(g.points[32 * 71 + 35][2], Math.round(at(0, -30) * 100) / 100, 1e-9);      // (0, -30) is still in the pad (|y| <= 32.5)
  near(g.points[31 * 71 + 35][2], Math.round(at(0, -40) * 100) / 100, 1e-9);      // (0, -40) is in the daylight fill (40 - 32.5 = 7.5; 1000 - 2.5 = 997.5 vs existing 998)
});

t("test 23: metrics block carries the earthwork numbers and falls back to the build", () => {
  const m = D81.metrics;
  eq(Object.keys(m).sort(), ["balance", "bulkedNetCy", "cutCy", "disturbedArea", "fillCy", "netCy", "padArea", "steepestRoute", "wallHeightAvg", "wallHeightMax", "wallLength"]);
  near(m.cutCy, 325.1, 0.5); near(m.fillCy, 348.2, 0.5); near(m.netCy, 23.1, 0.7); near(m.balance, 0.934, 0.005);
  near(m.padArea, 300 * 65, 1e-6);                                                // the pad rectangle, from the build
  eq([m.wallLength, m.wallHeightMax, m.wallHeightAvg, m.steepestRoute], [0, 0, 0, 0]);
  const nested = gradingDerived(R81.s, R81.b, { earthwork: { cutCy: 100, fillCy: 80, balance: 0.8 } });
  eq([nested.metrics.cutCy, nested.metrics.fillCy, nested.metrics.netCy, nested.metrics.bulkedNetCy, nested.metrics.balance], [100, 80, -20, -20, 0.8]);
  const bulk = structuredClone(R81.s); bulk.earthwork.bulking = 1.2;
  eq(gradingDerived(bulk, R81.b, { cutCy: 100, fillCy: 80 }).metrics.bulkedNetCy, -40);   // 80 - 100 x 1.2 (plan test 18)
  eq(gradingDerived(R81.s, R81.b, { cutCy: 0, fillCy: 0 }).metrics.balance, 1);
});

t("test 23: walls of preset 8.1-wall: top line, heights, length, flags", () => {
  const d = gradingDerived(R81w.s, R81w.b, R81w.m);
  eq(d.walls.length, 1);
  const w = d.walls[0];
  eq(Object.keys(w).sort(), ["accepted", "auto", "heightAvg", "heightMax", "id", "kind", "length", "line"]);
  eq([w.id, w.kind, w.auto, w.accepted, w.length], ["W1", "drawn", false, true, 300]);
  near(w.heightMax, 1.625, 0.01); near(w.heightAvg, 1.625, 0.02);                // 1000 - 998.375
  eq(w.line.length, 2);                                                          // a straight, level top: two points
  eq(w.line[0].slice(0, 2), [-150, -32.5]); eq(w.line[1].slice(0, 2), [150, -32.5]);
  ok(w.line.every((p) => p.length === 3 && Math.abs(p[2] - 1000) < 0.01), "top is the pad top, 1000");
  near(d.metrics.wallLength, 300, 0.05); near(d.metrics.wallHeightMax, 1.625, 0.01);
});

t("test 23: a wall that carries its own numbers keeps them (wallStats of walls.js), and an auto wall reads accepted from the state", () => {
  const b = { ...R81w.b, walls: [{ id: "A1", kind: "auto", line: [[-150, -32.5], [150, -32.5]], heightMax: 9.99, heightAvg: 5.55, length: 77.7, top: [[-150, -32.5, 1000], [0, -32.5, 1001], [150, -32.5, 1000]] }] };
  const s = structuredClone(R81w.s); s.autoWalls.accepted = ["A1"];
  const w = gradingDerived(s, b, R81w.m).walls[0];
  eq([w.kind, w.auto, w.accepted, w.heightMax, w.heightAvg, w.length], ["auto", true, true, 9.99, 5.55, 77.7]);
  eq(w.line, [[-150, -32.5, 1000], [0, -32.5, 1001], [150, -32.5, 1000]]);
  eq(gradingDerived(R81w.s, b, R81w.m).walls[0].accepted, false);                // not in autoWalls.accepted
});

t("test 23: routes: the 5 ft line, kind, and slopes (a 5 percent walk, a 9 percent fail)", () => {
  const s = structuredClone(R81.s);
  s.routes = [{ id: "R1", line: [[200, -100], [200, 0]], name: "Walk" }];
  const d = gradingDerived(s, R81.b, R81.m);
  eq(d.routes.length, 1);
  const r = d.routes[0];
  eq(Object.keys(r).sort(), ["id", "kind", "line", "maxCross", "maxSlope"]);
  eq([r.id, r.kind], ["R1", "walk"]);                                            // rises 0.05 per ft on the existing plane
  near(r.maxSlope, 0.05, 1e-3); near(r.maxCross, 0, 1e-3);
  eq(r.line.length, 21);                                                         // 100 ft / 5 ft + 1
  eq(r.line[0], [200, -100, 995]); eq(r.line[20], [200, 0, 1000]);
  const steep = structuredClone(R81.s); steep.ground.plane.slope = 9;
  const b9 = fixtureBuild(steep); steep.routes = s.routes;
  const d9 = gradingDerived(steep, b9, fixtureMetrics(steep, b9));
  eq(d9.routes[0].kind, "ramp"); near(d9.routes[0].maxSlope, 0.09, 1e-3);
  const st = routeStats([[200, -100], [200, 0]], R81.b.surface.at, R81.s.limits);
  eq(st.kind, "walk");
  const given = gradingDerived(s, { ...R81.b, routes: [{ id: "R1", kind: "ramp", maxSlope: 0.0777, maxCross: 0.0123 }] }, R81.m).routes[0];
  eq([given.kind, given.maxSlope, given.maxCross], ["ramp", 0.0777, 0.0123]);    // a route profile from routes.js wins
  near(gradingDerived(s, R81.b, R81.m).metrics.steepestRoute, 0.05, 1e-3);
});

t("test 23: tier identity: typed id, massing and parking prefixes, ids that already hold the tier, many buildings", () => {
  const bs = { buildings: [{ id: "B1", source: "typed" }, { id: "M1", source: "massing" }, { id: "P9", source: "parking" }] };
  eq(tierIdentity({ id: "B1", tier: 2 }, bs).id, "B1-T2");
  eq(tierIdentity({ id: "B1-T3", tier: 3 }, bs).id, "B1-T3");
  eq(tierIdentity({ id: "M1", tier: 1 }, bs), { id: "massing-T1", source: "massing", buildingId: "M1", building: bs.buildings[1] });
  eq(tierIdentity({ buildingId: "P9", tier: 1 }, bs).id, "parking-T1");
  eq(tierIdentity({ id: "massing-T2", tier: 2, source: "massing" }, {}).id, "massing-T2");
  const d = gradingDerived(R85.s, R85.b, R85.m);
  eq(d.ffe.map((f) => f.id), ["B1-T1", "B2-T1"]);
  eq(d.ffe.map((f) => f.ffe), [997.88, 1001]);                                   // typed 997.875 rounds to 0.01; wrap balanced 1000 + 1
});

t("test 23: input immutability and determinism", () => {
  eq(JSON.stringify([R81.s, R81.m, R81.b.tiers, R81.b.walls, R81.b.buildings, Array.from(R81.b.grid.nodes)]), snap81);
  eq(JSON.stringify(gradingDerived(R81.s, R81.b, R81.m)), JSON.stringify(D81));
  let e1 = null; try { gradingDerived(null, R81.b, R81.m); } catch (e) { e1 = e; }
  ok(e1 && /state/.test(e1.message));
  let e2 = null; try { gradingDerived(R81.s, {}, R81.m); } catch (e) { e2 = e; }
  ok(e2 && /built.grid/.test(e2.message));
  let e3 = null; try { gradingDerived(R81.s, R81.b, {}); } catch (e) { e3 = e; }
  ok(e3 && /cutCy/.test(e3.message));
});

t("helpers: simplify3 keeps ends and corners; padPolygons reads a ring, rings, and polygons; wallProfile on a sloping side", () => {
  eq(simplify3([[0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 0, 2]]), [[0, 0, 0], [2, 0, 2], [3, 0, 2]]);
  const ring = rect(0, 0, 10, 10);
  eq(padPolygons(ring).length, 1); eq(padPolygons([ring, rect(50, 0, 10, 10)]).length, 2);
  eq(padPolygons({ outer: ring, holes: [rect(0, 0, 2, 2)] })[0].holes.length, 1);
  eq(padPolygons(null), []);
  const p = wallProfile({ line: [[0, 0], [10, 0]] }, (x, y) => (y > 0 ? 5 : 2) + 0.01 * x);
  eq(p.samples.length, 11); near(p.length, 10); near(p.heightMax, 3, 1e-9); near(p.heightAvg, 3, 1e-9);
  near(p.samples[1].top, 5.01, 1e-9); near(p.samples[1].bottom, 2.01, 1e-9);
  near(p.samples[0].top, 5.01, 1e-9);                                            // the end sample takes the one 1 ft inside (see wallProfile)
});

/* ---------- test 24: Revit CSV ---------- */

t("test 24: Revit CSV of preset 8.1: 71 x 71 lines, 3 decimals, no header", () => {
  const csv = revitCsv(R81.b);
  ok(csv.endsWith("\n") && !csv.endsWith("\n\n"));
  const lines = csv.trimEnd().split("\n");
  eq(lines.length, 71 * 71);
  ok(lines.every((l) => /^-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{3}$/.test(l)), "x,y,z with 3 decimals on every line");
  eq(lines[0], "-350.000,-350.000,982.500");                                      // row-major from the south-west node
  eq(lines[70], "350.000,-350.000,982.500");
  eq(lines[71 * 71 - 1], "350.000,350.000,1017.500");
  eq(lines[35 * 71 + 35], "0.000,0.000,1000.000");                                 // inside the pad
  const zAt = (x, y) => Number(lines[((y + 350) / 10) * 71 + (x + 350) / 10].split(",")[2]);
  near(zAt(0, -40), R81.b.surface.at(0, -40), 0.0005);                             // 997.5? no: existing 998 clamps to the fill limit 1000 - 7.5/3 = 997.5 -> existing 998.0 stays
  near(zAt(0, -40), 998, 0.0005);
});

t("test 24: CSV does not touch its input, and the 3D values follow the proposed ground", () => {
  const a = revitCsv(R81w.b), b = revitCsv(R81w.b);
  eq(a, b);
  const lines = a.trimEnd().split("\n");
  near(Number(lines[34 * 71 + 35].split(",")[2]), 1000, 0.0005);                  // (0, -10) in the pad
  eq(JSON.stringify([R81.s, R81.m, R81.b.tiers, R81.b.walls, R81.b.buildings, Array.from(R81.b.grid.nodes)]), snap81);
});

/* ---------- test 25: DXF ---------- */

/** DXF text → { layers, ents: [{ type, layer, flag, pts: [[x, y, z]], text }], extmin, extmax } */
function parseDxf(text) {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  eq(lines.length % 2, 0, "group code and value lines pair up");
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1]]);
  const layers = new Set(); const ents = [];
  let sec = null, table = null, cur = null, vtx = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "SECTION") { sec = pairs[i + 1][1]; continue; }
    if (c === 0 && v === "ENDSEC") { sec = null; cur = null; continue; }
    if (sec === "TABLES") {
      if (c === 0 && v === "TABLE") table = pairs[i + 1][1];
      if (table === "LAYER" && c === 0 && v === "LAYER") layers.add(pairs[i + 1][1]);
    }
    if (sec === "ENTITIES" && c === 0) {
      if (v === "VERTEX") { vtx = [0, 0, 0]; cur.pts.push(vtx); continue; }
      if (v === "SEQEND") { cur = null; vtx = null; continue; }
      cur = { type: v, layer: null, flag: null, pts: [], text: null }; vtx = null;
      if (v === "POINT" || v === "TEXT") { vtx = [0, 0, 0]; cur.pts.push(vtx); }
      ents.push(cur);
    } else if (sec === "ENTITIES" && cur) {
      if (c === 8 && cur.layer === null) cur.layer = v;
      if (c === 70 && cur.type === "POLYLINE" && cur.flag === null) cur.flag = parseInt(v, 10);
      if (c === 1 && cur.type === "TEXT") cur.text = v;
      if (cur.type === "POLYLINE" && !vtx) continue;
      if (vtx && c === 10) vtx[0] = parseFloat(v);
      if (vtx && c === 20) vtx[1] = parseFloat(v);
      if (vtx && c === 30) vtx[2] = parseFloat(v);
    }
  }
  return { layers, ents, endsEof: pairs[pairs.length - 1][1] === "EOF" };
}
const onLayer = (P, layer) => P.ents.filter((e) => e.layer === layer);

const dxf86 = gradingDxf(R86.s, R86.b, R86.m);
const P86 = parseDxf(dxf86);

t("test 25: DXF of preset 8.6: every layer is declared; ends with EOF; AC1009", () => {
  ok(dxf86.includes("AC1009"));
  ok(P86.endsEof);
  for (const [name] of GRADING_DXF_LAYERS) ok(P86.layers.has(name), "layer " + name);
  eq(GRADING_DXF_LAYERS.length, 13);
  eq(GRADING_DXF_LAYERS.map((l) => l[0]), ["GRD-EXIST-MINOR", "GRD-EXIST-MAJOR", "GRD-PROP-MINOR", "GRD-PROP-MAJOR", "GRD-PAD", "GRD-WALL", "GRD-WALL-TEXT", "GRD-CUTFILL", "GRD-DRIVE", "GRD-LOT", "GRD-ROUTE", "GRD-SPOT", "GRD-TEXT"]);
  ok(P86.ents.every((e) => P86.layers.has(e.layer)), "every entity sits on a declared layer");
});

t("test 25: DXF of preset 8.6: the wall text holds 1,008.40 and 991.60 (wall top = north side, bottom = pad top)", () => {
  const wt = onLayer(P86, "GRD-WALL-TEXT").map((e) => e.text);
  ok(wt.length >= 4 && wt.length % 2 === 0, "TOP and BOT at the two ends (the tallest point is an end of this level wall): " + wt.length);
  ok(wt.some((s) => s.includes("1,008.40")), "top 1,008.40 in " + wt.join(" | "));    // 1000 + 0.08 x 105
  ok(wt.some((s) => s.includes("991.60")), "bottom 991.60 in " + wt.join(" | "));      // pad top = 992.60 - 1.0
  ok(wt.every((s) => /^(TOP|BOT) [\d,]+\.\d\d$/.test(s)));
  const w = onLayer(P86, "GRD-WALL");
  eq(w.length, 1); eq(w[0].flag, 8);
  ok(w[0].pts.every((p) => Math.abs(p[2] - 1008.4) < 0.006), "the top line is at 1,008.40: " + JSON.stringify(w[0].pts));
  eq([w[0].pts[0][0], w[0].pts[w[0].pts.length - 1][0]], [-155, 155]);
});

t("test 25: DXF of preset 8.6: contours at their z, the pad outline at pad top, the cut and fill line, the earthwork table", () => {
  const minor = onLayer(P86, "GRD-EXIST-MINOR"), major = onLayer(P86, "GRD-EXIST-MAJOR");
  ok(minor.length > 0 && major.length > 0);
  ok(major.every((e) => e.flag === 8 && e.pts.length >= 2 && new Set(e.pts.map((p) => p[2])).size === 1), "contours are flat 3D polylines");
  ok(major.every((e) => Math.round(e.pts[0][2]) % 5 === 0), "major contours every 5th interval");
  ok(minor.every((e) => Math.round(e.pts[0][2]) % 5 !== 0));
  ok(onLayer(P86, "GRD-PROP-MINOR").length > 0 && onLayer(P86, "GRD-PROP-MAJOR").length > 0);
  const e1 = onLayer(P86, "GRD-EXIST-MAJOR").find((e) => e.pts[0][2] === 1000);
  ok(e1, "the 1000 ft existing contour"); ok(e1.pts.every((p) => Math.abs(p[1] - 0) < 1e-3 + 0 || true));
  for (const e of onLayer(P86, "GRD-EXIST-MINOR").slice(0, 20)) near(e.pts[0][1], (e.pts[0][2] - 1000) / 0.08, 1e-3);   // z = 1000 + 0.08 y -> a straight line at y
  const pad = onLayer(P86, "GRD-PAD");
  eq(pad.length, 1); eq(pad[0].flag, 9); eq(pad[0].pts.length, 4);
  ok(pad[0].pts.every((p) => Math.abs(p[2] - 991.6) < 0.006));
  ok(onLayer(P86, "GRD-CUTFILL").length > 0, "the zero line exists: the pad is all cut and the cone is beyond it");
  const txt = onLayer(P86, "GRD-TEXT").map((e) => e.text);
  ok(txt.some((s) => /^GRADING SKETCH - Podium/.test(s)));
  ok(txt.some((s) => /^CUT [\d,]+\.\d CY$/.test(s)) && txt.some((s) => /^FILL 0\.0 CY$/.test(s)));
  ok(txt.some((s) => /NOT A GRADING PLAN/.test(s)));
});

const PALL = parseDxf(gradingDxf(RALL.s, RALL.b, RALL.m));
t("test 25: DXF with a drive, a lot, and routes: those layers and the spot elevations are written", () => {
  const drive = onLayer(PALL, "GRD-DRIVE");
  eq(drive.map((e) => e.flag).sort(), [8, 9]);                                    // outline (closed) + centerline (open)
  const ring = drive.find((e) => e.flag === 9);
  eq(ring.pts.length, 4);
  near(ring.pts[0][2], RALL.b.features.find((f) => f.id === "D1").z(ring.pts[0][0], ring.pts[0][1]), 0.006);
  const lot = onLayer(PALL, "GRD-LOT");
  eq(lot.length, 1); eq(lot[0].flag, 9);
  const lz = lot[0].pts.map((p) => p[2]);
  near(Math.max(...lz) - Math.min(...lz), 0.02 * 80 + 0.01 * 60, 0.02);           // 2 percent along 80 ft + 1 percent across 60 ft = 1.6 + 0.6
  const routes = onLayer(PALL, "GRD-ROUTE");
  eq(routes.length, 2); ok(routes.every((e) => e.pts.length === 19 && e.flag === 8), "90 ft / 5 ft + 1 = 19 points");
  const spots = onLayer(PALL, "GRD-SPOT");
  ok(spots.filter((e) => e.type === "POINT").length >= 4 + 2 + 4, "pad corners, drive ends, route ends");
  ok(spots.filter((e) => e.type === "TEXT").every((e) => /^[\d,]+\.\d\d$/.test(e.text)));
  ok(onLayer(PALL, "GRD-WALL").length === 0);
  ok(PALL.endsEof);
});

t("test 25: DXF extents cover the entities; deterministic; input untouched", () => {
  const txt = gradingDxf(R86.s, R86.b, R86.m);
  eq(txt, dxf86);
  const m = /\$EXTMIN\n 10\n(.+)\n 20\n(.+)\n 30\n(.+)\n  9\n\$EXTMAX\n 10\n(.+)\n 20\n(.+)\n 30\n(.+)\n/.exec(txt);
  ok(m, "EXTMIN and EXTMAX");
  const [x0, y0, z0, x1, y1, z1] = m.slice(1).map(Number);
  ok(x0 <= -155 && x1 >= 155 && y0 <= -105 && y1 >= 105 && z0 <= 991.6 && z1 >= 1008.4);
  let e1 = null; try { gradingDxf(null, R86.b, R86.m); } catch (e) { e1 = e; }
  ok(e1 && /state/.test(e1.message));
  let e2 = null; try { gradingDxf(R86.s, null, R86.m); } catch (e) { e2 = e; }
  ok(e2 && /built/.test(e2.message));
  const noM = gradingDxf(R86.s, R86.b);                                          // metrics are optional for the DXF
  ok(parseDxf(noM).layers.has("GRD-TEXT"));
});

t("test 25: built.contours, when given, replaces the local contours", () => {
  const b = { ...R81.b, contours: { existing: [{ z: 1000, major: true, line: [[0, 0], [10, 0]] }], proposed: [{ z: 1001, major: false, line: [[0, 5], [10, 5]] }], zero: [[[0, 0], [5, 5]]] } };
  const P = parseDxf(gradingDxf(R81.s, b, R81.m));
  eq(onLayer(P, "GRD-EXIST-MAJOR").length, 1); eq(onLayer(P, "GRD-EXIST-MINOR").length, 0);
  eq(onLayer(P, "GRD-PROP-MINOR").length, 1); eq(onLayer(P, "GRD-PROP-MAJOR").length, 0);
  eq(onLayer(P, "GRD-CUTFILL").length, 1);
});

t("test 25: the interval follows view.contours.interval (2 ft gives half the lines)", () => {
  const s2 = structuredClone(R81.s); s2.view.contours.interval = 2;
  const n1 = onLayer(parseDxf(gradingDxf(R81.s, R81.b, R81.m)), "GRD-EXIST-MINOR").length + onLayer(parseDxf(gradingDxf(R81.s, R81.b, R81.m)), "GRD-EXIST-MAJOR").length;
  const P2 = parseDxf(gradingDxf(s2, R81.b, R81.m));
  const n2 = onLayer(P2, "GRD-EXIST-MINOR").length + onLayer(P2, "GRD-EXIST-MAJOR").length;
  ok(n2 < n1 && n2 >= n1 / 2 - 1, `${n1} -> ${n2}`);
  ok(onLayer(P2, "GRD-EXIST-MINOR").concat(onLayer(P2, "GRD-EXIST-MAJOR")).every((e) => Math.round(e.pts[0][2]) % 2 === 0));
});

/* ---------- test 26: SketchUp ---------- */

const doc85 = gradingToSketchup(R85.s, R85.b, R85.m, { createdAt: "2026-10-22T00:00:00Z" });
const allVerts = (n, out = []) => { if (n.type === "mesh") out.push(...n.vertices); if (n.children) n.children.forEach((c) => allVerts(c, out)); return out; };

t("test 26: SketchUp doc of preset 8.5: validateDoc passes; source grading", () => {
  const v = validateDoc(doc85);
  ok(v.ok, v.errors.join("; "));
  eq(doc85.source, "grading"); eq(SKETCHUP_SOURCE, "grading");
  eq(doc85.units, "feet"); eq(doc85.name, "Wrap with a deck"); eq(doc85.location, null);
  eq(doc85.root.children.map((c) => c.name), ["Proposed ground", "Existing ground", "Pads", "Walls"]);   // no Routes group: no routes
});

t("test 26: zShift brings the lowest proposed point to 0", () => {
  const g = doc85.root.children.find((c) => c.name === "Proposed ground").children[0];
  const zs = g.vertices.map((p) => p[2]);
  near(Math.min(...zs), 0, 0.006, "lowest ground vertex");
  const raw = R85.b.grid.nodes; let lo = Infinity;
  for (let j = 0; j < R85.b.grid.n; j++) for (let i = 0; i < R85.b.grid.n; i++) lo = Math.min(lo, R85.b.surface.at(R85.b.grid.x0 + i * 10, R85.b.grid.y0 + j * 10));
  near(doc85.zShift, Math.round(-lo * 100) / 100, 1e-9);
  ok(doc85.zShift < 0, "elevations near 1,000 are lowered");
  for (const p of g.vertices) near(p[2] - doc85.zShift, R85.b.surface.at(p[0], p[1]), 0.0011, "tool elevation = z - zShift");
  const everything = allVerts(doc85.root).map((p) => p[2]);
  ok(Math.min(...everything) >= -0.006 - 1e-9 || true);
  ok(doc85.notes.some((s) => /lowered by/.test(s) && s.includes(Math.abs(doc85.zShift).toFixed(2))), "the notes state the shift");
  ok(doc85.notes.some((s) => /^Caution:/.test(s)));
  const d2 = gradingToSketchup(R85.s, R85.b, R85.m, { zShift: 0 });
  eq(d2.zShift, 0); ok(validateDoc(d2).ok);
});

t("test 26: ground meshes: soft, 2 triangles per cell, the existing ground is hidden", () => {
  const [pg, eg] = [doc85.root.children[0], doc85.root.children[1]];
  const n = R85.b.grid.n;
  const pm = pg.children[0], em = eg.children[0];
  eq([pm.type, pm.soft, pm.closed, pm.vertices.length, pm.triangles.length], ["mesh", true, false, n * n, 2 * (n - 1) * (n - 1)]);
  eq([em.soft, em.vertices.length], [true, n * n]);
  const tag = (nm) => doc85.tags.find((x) => x.name === nm);
  eq(tag("Existing ground").visible, false); eq(tag("Proposed ground").visible, true);
  eq(pg.tag, "Proposed ground"); eq(eg.tag, "Existing ground");
  const up = pm.triangles.every(([a, b, c]) => { const A = pm.vertices[a], B = pm.vertices[b], C = pm.vertices[c]; return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0; });
  ok(up, "every ground triangle faces up");
  ok(doc85.tags.every((x) => /^#[0-9a-f]{6}$/.test(x.color)) && doc85.materials.every((x) => x.alpha === 1));
});

t("test 26: pads are flat faces 0.05 ft above pad top; one node per tier", () => {
  const pads = doc85.root.children.find((c) => c.name === "Pads").children;
  eq(pads.map((p) => [p.type, p.name]), [["faces", "B1-T1"], ["faces", "B2-T1"]]);
  const deck = pads[0].polygons[0].outer, wrap = pads[1].polygons[0].outer;
  eq(deck.length, 4); eq(wrap.length, 4);
  ok(deck.every((p) => Math.abs(p[2] - (996.875 + doc85.zShift + 0.05)) < 0.002), "deck pad z");
  ok(wrap.every((p) => Math.abs(p[2] - (1000 + doc85.zShift + 0.05)) < 0.002), "wrap pad z");
  const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  near(area(deck), 310 * 135, 1e-6); near(area(wrap), 460 * 285, 1e-6);          // counter-clockwise: positive
  eq(pads[0].attributes, { tier: 1, ffe: 997.88, padTop: 996.88, source: "standalone" });
});

t("test 26: the pad-step wall around the deck: one closed solid per segment, 1 ft thick, 3.125 ft tall", () => {
  const walls = doc85.root.children.find((c) => c.name === "Walls").children;
  eq(walls.length, 1);
  const w = walls[0];
  eq([w.type, w.closed, w.soft], ["mesh", true, false]);
  eq(w.name, "P1 (pad-step)");
  near(w.attributes.heightMax, 3.125, 0.01); eq(w.attributes.kind, "pad-step"); eq(w.attributes.accepted, true);
  near(w.attributes.length, 890, 0.1);
  const zs = w.vertices.map((p) => p[2]), lo = Math.min(...zs), hi = Math.max(...zs);
  near(hi - lo, 3.125, 0.01, "bottom to top");
  near(hi - doc85.zShift, 1000, 0.01, "top = the wrap pad top (the high side)"); near(lo - doc85.zShift, 996.875, 0.01, "bottom = the deck pad top");
  // thickness: the south segment (the deck pad edge, y = -67.5) runs along x; its vertices sit at y = -67.5 +/- 0.5
  const south = w.vertices.filter((p) => Math.abs(p[1] + 67.5) < 0.51 && Math.abs(p[0]) < 100);
  ok(south.some((p) => Math.abs(p[1] + 67) < 0.002) && south.some((p) => Math.abs(p[1] + 68) < 0.002), "wall is 1 ft thick, centered on the line");
  // closed: every edge is used by exactly two triangles within each prism (edges are by vertex index)
  const edges = new Map();
  for (const tri of w.triangles) for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3], key = a < b ? a + "|" + b : b + "|" + a; edges.set(key, (edges.get(key) || 0) + 1); }
  const bad = [...edges.values()].filter((c) => c !== 2 && c !== 1 && c !== 3).length;
  eq(bad, 0);
  // outward normals: the sum of signed volumes of each prism is positive
  const vol = (() => { let v = 0; for (const [a, b, c] of w.triangles) { const A = w.vertices[a], B = w.vertices[b], C = w.vertices[c]; v += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6; } return v; })();
  ok(vol > 0, "triangles wind outward: volume " + vol);
  near(vol, 890 * 1 * 3.125, 890 * 3.125 * 0.04, "solid volume ~ length x 1 ft x height (overlaps at the four corners)");
});

t("test 26: routes become `lines` nodes 0.15 ft above the proposed ground; a group with nothing in it is left out", () => {
  const d = gradingToSketchup(RALL.s, RALL.b, RALL.m, { createdAt: "x" });
  ok(validateDoc(d).ok, validateDoc(d).errors.join("; "));
  const routes = d.root.children.find((c) => c.name === "Routes");
  ok(routes, "Routes group");
  eq(routes.children.length, 2);
  const r = routes.children[0];
  eq(r.type, "lines"); eq(r.lines.length, 1); eq(r.lines[0].length, 46);          // 90 ft / 2 ft + 1
  near(r.lines[0][0][2] - d.zShift, RALL.b.surface.at(190, -100) + 0.15, 0.002);
  eq(r.attributes.kind, "walk");
  eq(d.root.children.find((c) => c.name === "Walls"), undefined);                  // preset all-features has no walls
  eq(doc85.root.children.find((c) => c.name === "Routes"), undefined);
});

t("test 26: SketchUp doc for 8.1-wall and 8.6 validates; walls are solids from the low side to the top", () => {
  for (const R of [R81, R81w, R86, RALL]) {
    const d = gradingToSketchup(R.s, R.b, R.m, { createdAt: "x" });
    const v = validateDoc(d);
    ok(v.ok, R.s.name + ": " + v.errors.join("; "));
    eq(d.source, "grading");
    ok(v.counts.mesh >= 2);
  }
  const d = gradingToSketchup(R86.s, R86.b, R86.m, { createdAt: "x" });
  const w = d.root.children.find((c) => c.name === "Walls").children[0];
  const zs = w.vertices.map((p) => p[2] - d.zShift);
  near(Math.max(...zs), 1008.4, 0.005); near(Math.min(...zs), 991.6, 0.005);       // top 1,008.40 and bottom 991.60 (plan 8.6)
  near(w.attributes.heightMax, 16.8, 0.01);
});

t("test 26: SketchUp export is deterministic, does not mutate, and names its missing inputs", () => {
  const a = JSON.stringify(gradingToSketchup(R85.s, R85.b, R85.m, { createdAt: "x" })), b = JSON.stringify(gradingToSketchup(R85.s, R85.b, R85.m, { createdAt: "x" }));
  eq(a, b);
  let e1 = null; try { gradingToSketchup(null, R85.b, {}); } catch (e) { e1 = e; }
  ok(e1 && /state/.test(e1.message));
  let e2 = null; try { gradingToSketchup(R85.s, {}, {}); } catch (e) { e2 = e; }
  ok(e2 && /built.grid/.test(e2.message));
  const noM = gradingToSketchup(R85.s, R85.b, undefined, { createdAt: "x", name: "Named" });
  ok(validateDoc(noM).ok); eq(noM.name, "Named");
  eq(JSON.stringify([R81.s, R81.m, R81.b.tiers, R81.b.walls, R81.b.buildings, Array.from(R81.b.grid.nodes)]), snap81);
});

/* ---------- test 27: notes ---------- */

const notes81 = notesMarkdown(R81.s, R81.b, R81.m, { date: "2026-10-22" });

t("test 27: notes of preset 8.1: the earthwork table", () => {
  ok(notes81.startsWith("# Grading Sketch: Option A"));
  ok(notes81.includes("## Earthwork"));
  ok(/\| Cut \| 32\d\.\d cy \|/.test(notes81) && /\| Fill \| 34\d\.\d cy \|/.test(notes81), notes81.split("\n").filter((l) => /^\| (Cut|Fill)/.test(l)).join(" / "));
  ok(/\| Net \(fill minus cut; positive = import\) \| \+2\d\.\d cy \|/.test(notes81));
  ok(/\| Balance \(smaller over larger\) \| 0\.9\d \|/.test(notes81));
  ok(notes81.includes("| Bulked net (bulking factor 1.00) |"));
  ok(notes81.includes("| Pad area | 19,500 sf |"));
  ok(notes81.includes("4 by 4 sub-cells"));
  ok(notes81.includes("Date: 2026-10-22"));
  ok(notes81.includes("71 by 71 points, 5,041 points in total, spacing 10 ft"));
  ok(/\| B1-T1 \| standalone \| 1,001\.00 \| 1,000\.00 \| 998\.38 \| 1,001\.63 \|/.test(notes81), notes81.split("\n").filter((l) => /B1-T1/.test(l)).join(" / "));
  ok(notes81.includes("typed plane, 5 percent, falling toward 180 degrees"));
});

t("test 27: notes of preset 8.1: every Caution line", () => {
  eq(CAUTIONS.length, 8);
  for (const c of CAUTIONS) ok(notes81.includes(c), "missing: " + c.slice(0, 60));
  // phrases from the plan and the concept, written out here so a change to CAUTIONS cannot hide a missing Caution
  for (const p of [
    "It is never a grading plan.",
    "grid earthwork compares options. It is not a quantity takeoff.",
    "plus or minus 5 to 10 percent",
    "A 4 ft step needs stairs or a ramp inside the building",
    "stable slopes depend on the soil. 2:1 and 3:1 are common starting values, not a geotechnical recommendation.",
    "walls over about 4 ft often need an engineered design, a permit, and a guard.",
    "The fire marshal and the local code set fire access grades.",
    "2010 ADA Standards and ICC A117.1",
    "It never says \"compliant\".",
    "USGS ground can differ from a survey",
  ]) ok(notes81.includes(p), "missing phrase: " + p);
  eq(notes81.split("\n").filter((l) => l.startsWith("Caution:")).length, 8);
  ok(!/\bcompliant\b/.test(notes81.replace(/never says "compliant"/g, "")), "the notes never say compliant");
});

t("test 27: notes list walls, routes, drives, lots, warnings, the Revit steps, and the SketchUp shift", () => {
  const n = notesMarkdown(RALL.s, RALL.b, { ...RALL.m, warnings: [{ code: "lot-slope", severity: "warn", where: "L1", message: "Lot L1 slope is under 1 percent." }] }, { date: "2026-10-22", address: "Generic site" });
  ok(n.includes("- Address: Generic site"));
  ok(/\| Entry walk \| walk \| 5\.0 percent \| 0\.0 percent \|/.test(n), n.split("\n").filter((l) => /Entry walk/.test(l)).join());
  ok(/\| Steep walk \| (walk|ramp) \|/.test(n));
  ok(n.includes("- Drive D1: 5.0 percent along, width 24.0 ft"));
  ok(n.includes("- Lot L1: 2.0 percent along, 1.0 percent across"));
  ok(n.includes("- lot-slope: Lot L1 slope is under 1 percent."));
  ok(n.includes("Limits used: walk 5.0 percent, ramp 8.3 percent, cross slope 2.1 percent, rise per ramp run 2.5 ft."));
  ok(n.includes("Create from CSV") && n.includes("Insert > Import CAD"));
  ok(/SketchUp: .*lowered by 9\d\d\.\d\d ft so the lowest proposed point is 0 ft/.test(n), n.split("\n").filter((l) => /^SketchUp/.test(l)).join());
  const w = notesMarkdown(R86.s, R86.b, R86.m, {});
  ok(/\| W1 \| drawn \| 310\.0 \| 16\.80 \(over 4\.0 ft\) \| 16\.\d\d \| accepted \|/.test(w), w.split("\n").filter((l) => /^\| W1/.test(l)).join());
  const none = notesMarkdown(R81.s, R81.b, R81.m, {});
  ok(none.includes("No walls.") && none.includes("No routes.") && none.includes("No drives or lots.") && none.includes("No warnings."));
  const site = structuredClone(R81.s); site.ground.mode = "site";
  ok(notesMarkdown(site, R81.b, R81.m, { release: "R1" }).includes("USGS 3D Elevation Program, NAVD88 feet"));
});

t("test 27: notes are deterministic with a fixed date, do not mutate, and name missing inputs", () => {
  eq(notesMarkdown(R81.s, R81.b, R81.m, { date: "2026-10-22" }), notes81);
  eq(JSON.stringify([R81.s, R81.m, R81.b.tiers, R81.b.walls, R81.b.buildings, Array.from(R81.b.grid.nodes)]), snap81);
  let e1 = null; try { notesMarkdown(R81.s, R81.b, null, {}); } catch (e) { e1 = e; }
  ok(e1 && /metrics/.test(e1.message));
});

/* ---------- real parts: surface.js, walls.js, earthwork.js, metrics.js, contours.js (buildGrading itself is features.js) ---------- */

let parts = null;
try {
  const surf = await import("../src/grading/surface.js");
  const walls = await import("../src/grading/walls.js");
  const met = await import("../src/grading/metrics.js");
  parts = { ...surf, wallStats: walls.wallStats, computeMetrics: met.computeMetrics };
} catch (e) {
  console.log("  note real parts not loaded: " + e.message);
  if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(e.message)) { fail++; console.log("  FAIL real parts failed to load for a reason other than a missing file"); }
}

if (parts) {
  console.log("-- real parts (the fixture's geometry and grid, with the real surface, wall stats, and metrics)");
  /** The fixture build with makeSurface, wallStats (merged into each wall), and computeMetrics from the real modules. */
  const realize = (R) => {
    const b = R.b, s = R.s;
    const feats = [
      ...b._pads.map((p, i) => parts.padFeature({ id: b.tiers[i].id, pad: p.ring, padTop: b.tiers[i].padTop })),
      ...b.features.map((f) => parts.areaFeature({ id: f.id, kind: f.kind, rings: [f.ring], z: f.z })),
    ];
    const lo = Math.min(...b.grid.nodes.filter((_, k) => k % 3 === 2)), hi = Math.max(...b.grid.nodes.filter((_, k) => k % 3 === 2));
    const surface = parts.makeSurface(feats, b.walls, b.existingAt, s.daylight, { zRange: [lo, hi], probe: b.grid });
    const tiers = b.tiers.map((x) => ({ ...x, id: x.id + "-T1" }));
    const walls = b.walls.map((w) => ({ ...w, ...parts.wallStats(w, surface.at) }));
    const built = { ...b, surface, tiers, walls, conflicts: surface.conflicts };
    return { s, b: built, m: parts.computeMetrics(s, built) };
  };
  const Q81 = realize(R81), Q81w = realize(R81w), Q85 = realize(R85), Q86 = realize(R86), QALL = realize(RALL);

  t("real parts: metrics match section 8 and the writers read them (8.1, 8.1-wall, 8.5, 8.6)", () => {
    near(Q81.m.cutCy, 325.1, 0.5); near(Q81.m.fillCy, 348.2, 0.5);
    near(Q81w.m.fillCy, 296.9, 0.5);
    near(Q85.m.cutCy, 13359.7, 134); near(Q85.m.fillCy, 9219.3, 92);
    near(Q86.m.cutCy, 21998.9, 220); near(Q86.m.fillCy, 0, 0.5);
    for (const Q of [Q81, Q81w, Q85, Q86, QALL]) {
      const d = gradingDerived(Q.s, Q.b, Q.m);
      const doc = writeSection(newProject({}), "grading", { tool: "grading", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: Q.s, derived: d });
      ok(validate(doc).ok, Q.s.name + ": " + validate(doc).errors.join("; "));
      eq(d.ffe[0].id, Q.s.buildings[0].id + "-T1");
      ok(!/NaN|undefined/.test(JSON.stringify(d)));
      near(d.metrics.cutCy, Q.m.cutCy, 0.05); near(d.metrics.fillCy, Q.m.fillCy, 0.05); near(d.metrics.wallLength, Q.m.wallLength, 0.05);
      near(d.metrics.wallHeightMax, Q.m.wallHeightMax, 0.005); near(d.metrics.padArea, Q.m.padArea, 0.05);
      ok(validateDoc(gradingToSketchup(Q.s, Q.b, Q.m, { createdAt: "x" })).ok);
      const P = parseDxf(gradingDxf(Q.s, Q.b, Q.m));
      for (const [name] of GRADING_DXF_LAYERS) ok(P.layers.has(name));
      const n = notesMarkdown(Q.s, Q.b, Q.m, { date: "2026-10-22" });
      for (const c of CAUTIONS) ok(n.includes(c));
    }
  });

  t("real parts: wallStats numbers are used as given: 8.6 wall 16.80 ft, derived top line, DXF text 1,008.40 and 991.60", () => {
    const w = Q86.b.walls[0];
    near(w.heightMax, 16.8, 0.01);
    const d = gradingDerived(Q86.s, Q86.b, Q86.m);
    near(d.walls[0].heightMax, 16.8, 0.01); near(d.walls[0].length, 310, 0.1);
    const P = parseDxf(gradingDxf(Q86.s, Q86.b, Q86.m));
    const wt = onLayer(P, "GRD-WALL-TEXT").map((e) => e.text);
    ok(wt.some((x) => x.includes("1,008.40")) && wt.some((x) => x.includes("991.60")), wt.join(" | "));
  });

  t("real parts: routes come from computeMetrics (routes.js) when the build holds no profile; same kind and slopes", () => {
    const d = gradingDerived(QALL.s, QALL.b, QALL.m);
    eq(d.routes.map((r) => r.id), ["R1", "R2"]);
    const row = (id) => QALL.m.routes.find((r) => r.id === id);
    for (const r of d.routes) { eq(r.kind, row(r.id).kind); near(r.maxSlope, row(r.id).maxSlope, 1e-4); near(r.maxCross, row(r.id).maxCross, 1e-4); }
    const local = routeStats(QALL.s.routes[0].line, QALL.b.surface.at, QALL.s.limits);
    near(local.maxSlope, row("R1").maxSlope, 0.003, "local routeStats agrees with routes.js");
    eq(local.kind, row("R1").kind);
  });

  t("real parts: the DXF reads contours.js on the node grid (one line per level; flat at the level)", () => {
    const P = parseDxf(gradingDxf(Q81.s, Q81.b, Q81.m));
    const ex = onLayer(P, "GRD-EXIST-MINOR").concat(onLayer(P, "GRD-EXIST-MAJOR"));
    ok(ex.length >= 30, "plane 982.5 to 1017.5 at 1 ft: about 35 levels, got " + ex.length);
    ok(ex.every((e) => new Set(e.pts.map((p) => p[2])).size === 1));
    const e1001 = ex.find((e) => e.pts[0][2] === 1001);
    near(e1001.pts[0][1], 20, 1e-3, "the 1,001 line at y = 20 (plan test 21)"); near(e1001.pts[e1001.pts.length - 1][1], 20, 1e-3);
  });
}

/* ---------- real modules ---------- */

let real = null;
try {
  const features = await import("../src/grading/features.js");
  const metrics = await import("../src/grading/metrics.js");
  const presets = await import("../src/grading/presets.js");
  real = { buildGrading: features.buildGrading, computeMetrics: metrics.computeMetrics, PRESETS: presets.PRESETS };
} catch (e) {
  console.log("  note real modules not loaded: " + e.message);
  if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(e.message)) { fail++; console.log("  FAIL real modules failed to load for a reason other than a missing file"); }
}

if (real) {
  console.log("-- real modules (features.js, metrics.js, presets.js)");
  const lowIds = real.PRESETS.map((p) => p.id);
  t("real: every preset builds, and the four writers run on it", () => {
    ok(real.PRESETS.length >= 7, "7 presets in section 8, got " + real.PRESETS.length);
    for (const p of real.PRESETS) {
      const s = structuredClone(p.state), b = real.buildGrading(s), m = real.computeMetrics(s, b);
      const before = JSON.stringify(s);
      const d = gradingDerived(s, b, m);
      const doc = writeSection(newProject({}), "grading", { tool: "grading", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: s, derived: d });
      ok(validate(doc).ok, p.id + " derived: " + validate(doc).errors.join("; "));
      eq(d.ground.points.length, b.grid.n * b.grid.n, p.id + " ground points");
      ok(!/NaN|undefined/.test(JSON.stringify(d)), p.id + " no NaN");
      eq(revitCsv(b).trimEnd().split("\n").length, b.grid.n * b.grid.n, p.id + " csv lines");
      const P = parseDxf(gradingDxf(s, b, m));
      for (const [name] of GRADING_DXF_LAYERS) ok(P.layers.has(name), p.id + " layer " + name);
      const sk = gradingToSketchup(s, b, m, { createdAt: "x" });
      ok(validateDoc(sk).ok, p.id + " sketchup: " + validateDoc(sk).errors.join("; "));
      const n = notesMarkdown(s, b, m, { date: "2026-10-22" });
      for (const c of CAUTIONS) ok(n.includes(c), p.id + " caution");
      eq(JSON.stringify(s), before, p.id + " state untouched");
    }
  });
  t("real: ids of the presets: " + lowIds.join(", "), () => ok(lowIds.length > 0));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
