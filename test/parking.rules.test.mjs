// Run: node test/parking.rules.test.mjs
// Plan section 9.1 tests 11 to 15: accessible (11, 12, 13), overlay (14), metrics (15),
// plus hand checks of every count in plan section 8 against hand-made `built` fixtures.
// The fixtures match the layout(state) contract of plan section 4 (layout frame, stalls cut by
// rectangle overlap, bays, strip). The cases at the end also run against src/parking/layout.js
// and src/parking/grid.js when those files exist.
import { createRequire } from "node:module";
import fs from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const A = await import("../src/parking/accessible.js");
const O = await import("../src/parking/overlay.js");
const M = await import("../src/parking/metrics.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} ±${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const same = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const throws = (fn, part) => { try { fn(); } catch (e) { if (part && !e.message.includes(part)) throw new Error(`message "${e.message}" lacks "${part}"`); return; } throw new Error("expected a throw"); };
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------ state ---- */

const ACCESSIBLE = {
  table: [
    { upTo: 25, count: 1 }, { upTo: 50, count: 2 }, { upTo: 75, count: 3 },
    { upTo: 100, count: 4 }, { upTo: 150, count: 5 }, { upTo: 200, count: 6 },
    { upTo: 300, count: 7 }, { upTo: 400, count: 8 }, { upTo: 500, count: 9 },
    { upTo: 1000, percent: 2 },
    { upTo: null, base: 20, per100Over1000: 1 },
  ],
  vanPer: 6, aisleCar: 5, aisleVan: 8,
  r2: { on: null, percent: 2 },
};
const STD_CORES = () => [
  { id: "S1", kind: "stair", x: 25, y: 1, w: 22, d: 12 },
  { id: "E1", kind: "elevator", x: 52, y: 1, w: 10, d: 10 },
  { id: "S2", kind: "stair", x: 246, y: 109, w: 22, d: 12 },
];
function baseState() {
  return {
    schema: 1, name: "t", source: "standalone", sourceLevel: null,
    footprint: { shape: "rect", width: 300, depth: 125, points: [], x: 0, y: 0, angle: 0, perimeter: 1 },
    placement: null,
    levels: { count: 5, ftf1: 11, ftf: 10.5, belowGrade: 0, openTop: true },
    bays: { stallW: 9, stallD: 18, aisle: 24, edgeBays: true, compactShare: 0, compactW: 8, compactD: 16, turnZone: null, rotateBays: false },
    grid: { span: "long", column: 2, stallsPerModule: 3, structureDepth: { long: 2.5, short: 1.5 } },
    ramp: {
      type: "single-helix", slopedBay: 1,
      speed: { x: 99, y: 123, width: 24, length: 82, shape: "straight", insideRadius: 30, segments: 12 },
      splitLength: 36, transition: { length: 10, slopeFactor: 0.5 },
    },
    cores: STD_CORES(), coresFromProject: true,
    entries: [{ id: "N1", side: "west", at: 31, width: 24 }],
    liner: { on: false, side: "south", depth: 61, levels: [1] },
    checks: { slopeParking: 0.0667, slopeSpeed: 0.12, crossSlope: 0.02, barrier: 2.75, guard: 3.5, clearGeneral: 7.0, clearVan: 8.1667, barrierProvided: 3.5, overlayTolerance: 2 },
    accessible: clone(ACCESSIBLE),
    ev: { readyShare: 0.20, installedShare: 0.05 },
    bike: { mode: "per-units", perUnits: 10, count: 0, rack: "single" },
    required: { units: null, ratio: 1.25, retailSf: 0 },
  };
}
function mk(over = {}) {
  const s = baseState();
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) Object.assign(s[k], v);
    else s[k] = v;
  }
  return s;
}

/* The plan section 8 presets, written out here so this test stands alone. */
const PRESETS = {
  "8.1": { state: () => mk(), stalls: 496, sf: 378.0, req: 9, lost: 4, maxSlope: 5.5 / 250 },
  "8.2": {
    state: () => mk({ footprint: { depth: 185 }, ramp: { type: "sloped-floor", slopedBay: 1 }, cores: [STD_CORES()[0], STD_CORES()[1], { id: "S2", kind: "stair", x: 246, y: 169, w: 22, d: 12 }] }),
    stalls: 764, sf: 363.2, req: 16, lost: 6, maxSlope: 11 / 250,
  },
  "8.3": {
    state: () => mk({ footprint: { width: 360 }, levels: { count: 6 }, ramp: { type: "double-helix" }, cores: [STD_CORES()[0], STD_CORES()[1], { id: "S2", kind: "stair", x: 309, y: 109, w: 22, d: 12 }] }),
    stalls: 762, sf: 354.3, req: 16, lost: 6, maxSlope: 11 / 310,
  },
  "8.4": { state: () => mk({ footprint: { depth: 150 }, ramp: { type: "speed" } }), stalls: 496, sf: 453.6, req: 9, lost: 4, maxSlope: 11 / 92 },
  "8.5": {
    state: () => mk({
      levels: { count: 6 }, ramp: { type: "split" },
      cores: [{ id: "S1", kind: "stair", x: 57, y: 1, w: 22, d: 12 }, { id: "E1", kind: "elevator", x: 84, y: 1, w: 10, d: 10 }, { id: "S2", kind: "stair", x: 215, y: 109, w: 22, d: 12 }],
    }),
    stalls: 428, sf: 525.7, req: 9, lost: 4, maxSlope: 5.5 / 46,
  },
  "8.6": { state: () => mk({ source: "wrap", levels: { ftf1: 10.5 } }), stalls: 496, sf: 378.0, req: 10, lost: 4, maxSlope: 5.25 / 250 },
  "8.7": {
    state: () => mk({
      source: "podium", footprint: { depth: 65 }, levels: { count: 1 }, ramp: { type: "none" },
      cores: [STD_CORES()[0], STD_CORES()[1], { id: "S2", kind: "stair", x: 142, y: 1, w: 22, d: 12 }, { id: "S3", kind: "stair", x: 246, y: 49, w: 22, d: 12 }],
    }),
    stalls: 42, sf: 464.3, req: 2, lost: 1, maxSlope: 0,
  },
  "8.8": {
    state: () => mk({
      source: "podium", footprint: { depth: 206 }, levels: { count: 2 }, grid: { span: "short" }, ramp: { type: "speed", speed: { x: 99, y: 181, width: 24, length: 82, shape: "straight", insideRadius: 30, segments: 12 } },
      liner: { on: true, side: "south", depth: 61, levels: [1] },
      cores: [{ id: "S1", kind: "stair", x: 25, y: 61, w: 22, d: 12 }, { id: "E1", kind: "elevator", x: 58, y: 61, w: 10, d: 10 }, { id: "S2", kind: "stair", x: 246, y: 169, w: 22, d: 12 }],
    }),
    stalls: 231, sf: 455.8, req: 7, lost: 3, maxSlope: 11 / 92,
  },
  "8.9": { state: () => mk({ levels: { ftf1: 10.5 }, cores: [] }), stalls: 536, sf: 349.8, req: 11, lost: 4, maxSlope: 5.25 / 250 },
};

/* ---------------------------------------------------------- fixtures ---- */

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** A hand-made layout(state) result: bays, rows, cuts by rectangle overlap (> 1 sf). Plan 3.1 to 3.5. */
function mkBuilt(state) {
  const fp = state.footprint, p = fp.perimeter, { stallW: sw, stallD, aisle } = state.bays;
  let W = Math.max(fp.width, fp.depth), D = Math.min(fp.width, fp.depth);
  if (state.bays.rotateBays) [W, D] = [D, W];
  const frame = {
    origin: [-W / 2, -D / 2], angle: 0, W, D,
    toLayout: (q) => [q[0] + W / 2, q[1] + D / 2], toLocal: (q) => [q[0] - W / 2, q[1] - D / 2],
  };
  const B2 = 2 * stallD + aisle, B1 = stallD + aisle, Du = D - 2 * p;
  const nb = Math.floor(Du / B2 + 1e-9);
  const bays = [];
  let y = p;
  for (let i = 0; i < nb; i++, y += B2) {
    bays.push({ index: i, kind: "double", y0: y, rows: [{ id: "S", y0: y, y1: y + stallD }, { id: "N", y0: y + stallD + aisle, y1: y + B2 }], aisle: { y0: y + stallD, y1: y + stallD + aisle } });
  }
  let r = Du - nb * B2;
  if (state.bays.edgeBays && r >= B1 - 1e-9) {
    bays.push({ index: nb, kind: "single", y0: y, rows: [{ id: "N", y0: y + aisle, y1: y + B1 }], aisle: { y0: y, y1: y + aisle } });
    y += B1; r -= B1;
  }
  const strip = r > 1e-9 ? { y0: y, y1: y + r } : null;

  const tr = state.ramp.transition;
  const split = state.ramp.type === "split";
  const tz = state.bays.turnZone ?? (split ? state.ramp.splitLength + 2 * tr.length : aisle);
  const xs = p + tz, xe = W - p - tz, R = xe - xs;
  const g = state.grid, xr = [];
  if (g.span === "short") {
    const M = g.column + g.stallsPerModule * sw, k = Math.floor(R / M + 1e-9);
    for (let j = 0; j < k; j++) for (let i = 0; i < g.stallsPerModule; i++) xr.push(xs + j * M + g.column + i * sw);
    const extra = Math.floor(Math.max(0, R - k * M - g.column) / sw + 1e-9);
    for (let i = 0; i < extra; i++) xr.push(xs + k * M + g.column + i * sw);
  } else {
    for (let i = 0; i < Math.floor(R / sw + 1e-9); i++) xr.push(xs + i * sw);
  }

  const cuts = state.cores.map((c) => ({ id: c.id, kind: "core", ring: rect(c.x, c.y, c.x + c.w, c.y + c.d), box: [c.x, c.y, c.x + c.w, c.y + c.d] }));
  if (state.ramp.type === "speed" || state.ramp.type === "split") {
    // only the speed ramp cuts a rectangle; the split-level cost is the longer end zone
  }
  if (state.ramp.type === "speed") {
    const s = state.ramp.speed, x1 = s.x + s.length + 2 * tr.length;
    cuts.push({ id: "R1", kind: "ramp", ring: rect(s.x, s.y, x1, s.y + s.width), box: [s.x, s.y, x1, s.y + s.width] });
  }
  const liner = state.liner.on ? { id: "L1", kind: "liner", ring: rect(0, 0, W, state.liner.depth), box: [0, 0, W, state.liner.depth] } : null;

  const levels = [];
  let z = 0;
  for (let i = 1; i <= state.levels.count; i++) {
    const ftf = i === 1 ? state.levels.ftf1 : state.levels.ftf;
    const lc = cuts.concat(liner && state.liner.levels.includes(i) ? [liner] : []);
    const stalls = [];
    for (const b of bays) {
      for (const row of b.rows) {
        xr.forEach((x0, k) => {
          const box = [x0, row.y0, x0 + sw, row.y1];
          if (lc.some((c) => overlap(box, c.box) > 1)) return;
          stalls.push({ id: `P${i}-${b.index + 1}${row.id}-${String(k + 1).padStart(3, "0")}`, level: i, bay: b.index, row: row.id, k, outer: rect(...box), kind: "standard", evReady: false });
        });
      }
    }
    levels.push({
      index: i, z, ftf, plate: [{ outer: rect(0, 0, W, D), holes: [] }], stalls,
      aisles: bays.map((b) => ({ outer: rect(xs, b.aisle.y0, xe, b.aisle.y1), holes: [] })),
      turnZones: bays.flatMap((b) => { const y1 = Math.max(...b.rows.map((q) => q.y1)); return [{ outer: rect(p, b.y0, xs, y1), holes: [] }, { outer: rect(xe, b.y0, W - p, y1), holes: [] }]; }),
      cuts: lc.map(({ id, kind, ring }) => ({ id, kind, ring })),
    });
    z += ftf;
  }
  return { frame, levels, bays, strip, cores: state.cores.map((c) => ({ ...c })), warnings: [] };
}

/** A hand-made rampsFor(state, built) result (plan 3.4): slope = h / (L + 2 f T). */
function mkRamps(state, built) {
  const { type, transition: tr } = state.ramp, c = state.checks;
  const p = state.footprint.perimeter, tz = state.bays.aisle;
  const R = built.frame.W - 2 * p - 2 * tz;
  const out = [];
  for (const lv of built.levels.slice(0, -1)) {
    let rise, len, limit, fp = null;
    if (type === "single-helix") { rise = lv.ftf / 2; len = R; limit = c.slopeParking; }
    else if (type === "double-helix" || type === "sloped-floor") { rise = lv.ftf; len = R; limit = c.slopeParking; }
    else if (type === "speed") {
      const s = state.ramp.speed;
      rise = lv.ftf; len = s.length + 2 * tr.slopeFactor * tr.length; limit = c.slopeSpeed;
      fp = rect(s.x, s.y, s.x + s.length + 2 * tr.length, s.y + s.width);
    } else if (type === "split") { rise = lv.ftf / 2; len = state.ramp.splitLength + 2 * tr.slopeFactor * tr.length; limit = c.slopeSpeed; }
    else continue;
    const slope = rise / len;
    out.push({ id: `R${lv.index}`, type, level: lv.index, rise, length: len, slope, limit, ok: slope <= limit + 1e-9, outer3d: [], footprint: fp });
  }
  return out;
}

function run(state, project = null) {
  const built = mkBuilt(state);
  const acc = A.placeAccessible(state, built);
  const columns = O.columnsFromState(state, built);
  const ramps = mkRamps(state, built);
  const metrics = M.computeMetrics(state, built, ramps, columns, acc, project);
  return { built, acc, columns, ramps, metrics };
}

/* ---------------------------------------------- 11 required accessible --- */

t("11 requiredAccessible: 25, 26, 500, 534, 770, 1200 give 1, 2, 9, 11, 16, 22", () => {
  const got = [25, 26, 500, 534, 770, 1200].map((n) => A.requiredAccessible(n, ACCESSIBLE, "standalone").required);
  same(got, [1, 2, 9, 11, 16, 22]);
});

t("11 requiredAccessible: table edges (every row boundary and the over-1000 formula)", () => {
  // 50 -> 2, 51 -> 3, 100 -> 4, 101 -> 5, 400 -> 8, 401 -> 9, 1000 -> ceil(20) = 20,
  // 1001 -> 20 + 1 x ceil(1/100) = 21, 1100 -> 20 + 1 = 21, 1101 -> 20 + 2 = 22
  const cases = [[1, 1], [50, 2], [51, 3], [100, 4], [101, 5], [150, 5], [151, 6], [400, 8], [401, 9], [501, 11], [1000, 20], [1001, 21], [1100, 21], [1101, 22]];
  for (const [n, want] of cases) eq(A.requiredAccessible(n, ACCESSIBLE, "standalone").required, want, `N0 ${n}`);
  same(A.requiredAccessible(0, ACCESSIBLE, "wrap"), { table: 0, r2: null, required: 0, van: 0, car: 0 });
});

t("11 requiredAccessible: van is max(1, ceil(required / 6)) and car is the rest", () => {
  // 1 -> van 1; 6 -> van 1; 7 -> van 2; 9 -> van 2, car 7; 16 -> van 3, car 13
  const v = (n) => { const r = A.requiredAccessible(n, ACCESSIBLE, "standalone"); return [r.required, r.van, r.car]; };
  same(v(25), [1, 1, 0]);
  same(v(200), [6, 1, 5]);
  same(v(300), [7, 2, 5]);
  same(v(500), [9, 2, 7]);
  same(v(770), [16, 3, 13]);
});

t("11 requiredAccessible: an edited table and vanPer are honored; a bad table throws", () => {
  const acc = { ...clone(ACCESSIBLE), vanPer: 4, table: [{ upTo: null, count: 5 }] };
  const r = A.requiredAccessible(80, acc, "standalone");
  same([r.required, r.van, r.car], [5, 2, 3]);   // ceil(5 / 4) = 2
  throws(() => A.requiredAccessible(80, { table: [] }, "standalone"), "accessible.table");
});

/* ------------------------------------------------------- 12 R-2 rule ----- */

t("12 R-2 on, 500 stalls: required 10, van 2", () => {
  const acc = { ...clone(ACCESSIBLE), r2: { on: true, percent: 2 } };
  const r = A.requiredAccessible(500, acc, "standalone");
  // table 9; R-2 max(1, ceil(500 x 2 / 100)) = 10; van ceil(10 / 6) = 2; car 8
  same([r.table, r.r2, r.required, r.van, r.car], [9, 10, 10, 2, 8]);
});

t("12 R-2 default (on null): on for wrap and podium, off for standalone; explicit off wins", () => {
  eq(A.requiredAccessible(500, ACCESSIBLE, "standalone").required, 9);
  eq(A.requiredAccessible(500, ACCESSIBLE, "standalone").r2, null);
  eq(A.requiredAccessible(500, ACCESSIBLE, "wrap").required, 10);
  eq(A.requiredAccessible(500, ACCESSIBLE, "podium").required, 10);
  const off = { ...clone(ACCESSIBLE), r2: { on: false, percent: 2 } };
  eq(A.requiredAccessible(500, off, "wrap").required, 9);
  // small deck: N0 43 -> table 2, R-2 ceil(0.86) = 1 -> 2 (the larger)
  const small = A.requiredAccessible(43, ACCESSIBLE, "podium");
  same([small.table, small.r2, small.required], [2, 1, 2]);
  // N0 234 -> table 7, R-2 ceil(4.68) = 5 -> 7
  eq(A.requiredAccessible(234, ACCESSIBLE, "podium").required, 7);
});

/* ------------------------------------------------ 13 aisle length -------- */

t("13 aisleLength(2, 7), (2, 8), (1, 1) give 31, 31, 8", () => {
  // (2,7): 8 x 2 + 5 x ceil((7 - 2) / 2) = 16 + 15 = 31
  // (2,8): 16 + 5 x ceil(6 / 2) = 16 + 15 = 31
  // (1,1): 8 + 5 x ceil(0 / 2) = 8
  eq(A.aisleLength(2, 7), 31);
  eq(A.aisleLength(2, 8), 31);
  eq(A.aisleLength(1, 1), 8);
  eq(A.aisleLength(2, 7, ACCESSIBLE), 31);
});

t("13 aisleLength: plan 8.x pairs and edited widths", () => {
  eq(A.aisleLength(3, 13), 49);     // 24 + 5 x ceil(10 / 2) = 49
  eq(A.aisleLength(2, 9), 36);      // 16 + 5 x ceil(7 / 2) = 36
  eq(A.aisleLength(2, 5), 26);      // 16 + 5 x ceil(3 / 2) = 26
  eq(A.aisleLength(1, 0), 8);       // one van, no car: 8
  eq(A.aisleLength(0, 0), 0);
  eq(A.aisleLength(1, 4, { aisleVan: 9, aisleCar: 6 }), 9 + 6 * 2);   // 9 + 6 x ceil(3 / 2) = 21
  throws(() => A.aisleLength(-1, 2), "van and car");
});

t("13 accessibleSlots: the run holds van + car stalls and ceil(La / stallW) lost slots", () => {
  for (const [van, car, w] of [[2, 7, 9], [3, 13, 9], [1, 1, 9], [2, 9, 9], [1, 0, 9], [2, 5, 9], [2, 7, 8.5], [4, 20, 9]]) {
    const seq = A.accessibleSlots(van, car, ACCESSIBLE, w);
    eq(seq.filter((x) => x === "van").length, van, "vans");
    eq(seq.filter((x) => x === "accessible").length, car, "cars");
    eq(seq.filter((x) => x === "lost").length, Math.ceil(A.aisleLength(van, car, ACCESSIBLE) / w - 1e-9), `lost for ${van}/${car}/${w}`);
  }
  same(A.accessibleSlots(1, 1, ACCESSIBLE, 9), ["van", "lost", "accessible"]);
});

/* -------------------------------------------------- placeAccessible ------ */

t("placeAccessible: preset 8.1 puts the group in row 1S next to E1; 4 slots lost; 496 stalls", () => {
  const state = mk(), built = mkBuilt(state);
  eq(built.levels.reduce((s, l) => s + l.stalls.length, 0), 500, "N0");
  const acc = A.placeAccessible(state, built);
  eq(acc.n0, 500);
  same([acc.required, acc.van, acc.car, acc.aisleLength, acc.lost, acc.provided], [9, 2, 7, 31, 4, 9]);
  eq(acc.stalls.length, 496);
  eq(acc.rowId, "P1-1S");
  same(acc.rowIds, ["P1-1S"]);
  eq(acc.level, 1);
  eq(acc.warnings.length, 0);
  // E1 (x 52..62) cuts k 0 to 4 of the south row; the group starts at k 5 (x 70) and runs east for 13 slots
  const row = new Map(acc.stalls.filter((s) => s.level === 1 && s.bay === 0 && s.row === "S").map((s) => [s.k, s.kind]));
  const got = []; for (let k = 5; k <= 17; k++) got.push(row.get(k) ?? null);
  same(got, ["van", null, "accessible", "van", null, "accessible", "accessible", null, "accessible", "accessible", "accessible", "accessible", null]);
  eq(row.get(18), "standard");
  eq(acc.stalls.filter((s) => s.kind === "van").length, 2);
  eq(acc.stalls.filter((s) => s.kind === "accessible").length, 7);
  eq(acc.stalls.filter((s) => s.level !== 1 && s.kind !== "standard").length, 0, "only the entry level changes");
});

t("placeAccessible: the group continues into the next row when the first row is short", () => {
  const state = mk(), built = mkBuilt(state);
  // leave 6 free stalls in row 1S (k 21 to 26): drop k 5 to 20 from level 1's 1S row
  const lv1 = { ...built.levels[0], stalls: built.levels[0].stalls.filter((s) => !(s.bay === 0 && s.row === "S" && s.k >= 5 && s.k <= 20)) };
  const b2 = { ...built, levels: [lv1, ...built.levels.slice(1)] };
  const acc = A.placeAccessible(state, b2);
  eq(acc.rowIds.length, 2, "two rows");
  eq(acc.rowId, "P1-1S");
  eq(acc.rowIds[1], "P1-1N");
  eq(acc.warnings.some((w) => w.code === "accessible-split"), true);
  eq(acc.provided, 9);
  eq(acc.lost, 4);
});

t("placeAccessible: not enough free stalls on the entry level gives a warning", () => {
  const state = mk({ footprint: { depth: 65 } });
  const built = mkBuilt(state);
  const lv1 = { ...built.levels[0], stalls: built.levels[0].stalls.slice(0, 6) };
  const acc = A.placeAccessible(state, { ...built, levels: [lv1, ...built.levels.slice(1)] });
  eq(acc.warnings.some((w) => w.code === "accessible-short"), true);
  ok(acc.provided < acc.required);
});

t("placeAccessible: no input mutation (frozen state and built)", () => {
  const state = deepFreeze(mk()), built = deepFreeze(mkBuilt(mk()));
  const acc = A.placeAccessible(state, built);
  eq(acc.stalls.length, 496);
  ok(acc.stalls[0].outer !== built.levels[0].stalls[0].outer, "rings are copies");
  eq(built.levels[0].stalls.every((s) => s.kind === "standard"), true);
});

t("placeAccessible: other kinds pass through and are never taken", () => {
  const state = mk(), built = mkBuilt(state);
  const lv1 = { ...built.levels[0], stalls: built.levels[0].stalls.map((s) => (s.bay === 0 && s.row === "S" && s.k === 5 ? { ...s, kind: "ev" } : s)) };
  const acc = A.placeAccessible(state, { ...built, levels: [lv1, ...built.levels.slice(1)] });
  eq(acc.stalls.find((s) => s.level === 1 && s.bay === 0 && s.row === "S" && s.k === 5).kind, "ev");
  eq(acc.provided, 9);
});

t("placeAccessible: contract errors", () => {
  throws(() => A.placeAccessible({}, { levels: [] }), "state.accessible");
  throws(() => A.placeAccessible(mk(), {}), "built.levels");
});

/* ------------------------------------------------------ 14 overlay ------- */

// Plates fixture in the LOCAL frame; layout x = local x + 150, layout y = local y + 62.5.
// Building: layout x 25..277, y 30..95; 28 ft units; demising lines at layout x = 25 + 28 j, j = 0..9.
const LX = (j) => 25 + 28 * j;
function platesProject(shift = [0, 0]) {
  const line = (xl) => [[xl - 150 + shift[0], 30 - 62.5], [xl - 150 + shift[0], 95 - 62.5]];
  const units = [];
  for (let j = 0; j < 9; j++) units.push({ id: `2-${j}`, type: "1BR", outer: rect(LX(j) - 150, -32.5, LX(j + 1) - 150, 32.5), area: 1820, exposures: [], corner: false, bay: { from: 0, to: 28 }, demising: [line(LX(j)), line(LX(j + 1))] });
  const plate = [{ outer: rect(25 - 150, 30 - 62.5, 277 - 150, 95 - 62.5), holes: [] }];
  return {
    sections: {
      massing: { derived: { levels: [{ index: 1, zone: "podium", program: "retail" }, { index: 2, zone: "bar", program: "residential", plates: plate, spines: [] }, { index: 3, zone: "bar", program: "residential" }], metrics: { units: 240 } } },
      plates: {
        derived: {
          levels: [
            // a retail level with other lines: skipped because it is not residential
            { index: 1, plate, units: [{ id: "1-0", outer: rect(0, 0, 1, 1), demising: [[[-100, -30], [-100, 30]], [[-90, -30], [-90, 30]]] }] },
            { index: 3, plate, units: [{ id: "3-0", outer: rect(0, 0, 1, 1), demising: [[[-120, -30], [-120, 30]], [[-92, -30], [-92, 30]]] }] },
            { index: 2, plate, units },
          ],
        },
      },
    },
  };
}
function midriseProject() {
  const plate = [{ outer: rect(25 - 150, 30 - 62.5, 277 - 150, 95 - 62.5), holes: [] }];
  return {
    sections: {
      massing: {
        state: { programs: { residential: { unitWidth: 28 } } },
        derived: { levels: [{ index: 2, zone: "bar", program: "residential", plates: plate, spines: [[[25 - 150, 0], [277 - 150, 0]]] }], metrics: { units: 180 } },
      },
    },
  };
}

t("14 overlay: 28 ft units under 9 ft long-span stalls give a 9.333 ft suggestion (26 per row)", () => {
  const state = mk(), built = mkBuilt(state);
  const r = O.overlay(state, built, platesProject());
  eq(r.source, "plates");
  near(r.unitWidth, 28, 1e-9);
  same(r.suggestion, { stallW: 9.333, stallsPerRow: 26 });   // m = round(27 / 28) = 1, w* = 28 / 3; floor(250 / 9.3333) = 26
});

t("14 overlay: conflicts grow by 1 ft per module (27 ft columns against 28 ft units)", () => {
  const state = mk(), built = mkBuilt(state);
  const r = O.overlay(state, built, platesProject());
  // line y 61 runs under the building (y 30..95); columns x = 25 + 27 k, k = 0..9, then 275
  // distance to the nearest line (25 + 28 j) = k ft, so k = 3..9 are over the 2 ft tolerance; x 275 is 2 ft from 277
  const row = r.conflicts.filter((c) => c.column[1] === 61).sort((a, b) => a.column[0] - b.column[0]);
  same(row.map((c) => c.column[0]), [106, 133, 160, 187, 214, 241, 268]);
  same(row.map((c) => c.distance), [3, 4, 5, 6, 7, 8, 9]);
  eq(r.conflicts.length, 7);
  eq(r.checked, 11, "columns under the building");
});

t("14 overlay: tolerance is read from state.checks.overlayTolerance", () => {
  const state = mk({ checks: { overlayTolerance: 5 } }), built = mkBuilt(state);
  const r = O.overlay(state, built, platesProject());
  eq(r.conflicts.length, 4);   // distances 0..9 by column; over 5 ft are 6, 7, 8, 9
  ok(r.conflicts.every((c) => c.distance > 5));
});

t("14 overlay: picks the lowest residential level, drops slanted lines, merges twin lines", () => {
  const state = mk(), built = mkBuilt(state);
  const project = platesProject();
  const lv2 = project.sections.plates.derived.levels.find((l) => l.index === 2);
  lv2.units.push({ id: "slant", outer: rect(0, 0, 1, 1), demising: [[[-125, -30], [-80, 15]], [[-125, 0], [-125, 2]]] });   // 45 degrees, and a 2 ft line
  const dem = O.demisingLines(project, built.frame);
  eq(dem.source, "plates");
  eq(dem.level, 2);
  same(dem.xs, [25, 53, 81, 109, 137, 165, 193, 221, 249, 277]);
  near(dem.unitWidth, 28, 1e-9);
});

t("14 overlay: the Mid-Rise spine ticks stand in when there is no plates data", () => {
  const state = mk(), built = mkBuilt(state);
  const project = midriseProject();
  const dem = O.demisingLines(project, built.frame);
  eq(dem.source, "midrise");
  same(dem.xs, [25, 53, 81, 109, 137, 165, 193, 221, 249, 277]);
  const r = O.overlay(state, built, project);
  eq(r.source, "midrise");
  same(r.suggestion, { stallW: 9.333, stallsPerRow: 26 });
  eq(r.conflicts.length, 7);
});

t("14 overlay: a rotated layout frame moves the lines to the layout x axis", () => {
  const state = mk(), built = mkBuilt(state);
  // a 90 degree turn: layout (x, y) = (local y + 150, 62.5 - local x); a local point is (62.5 - y, x - 150)
  const frame = { ...built.frame, toLayout: (q) => [q[1] + 150, 62.5 - q[0]] };
  const toLocal = (q) => [62.5 - q[1], q[0] - 150];
  const project = platesProject();   // written in the layout frame shifted by (150, 62.5); rebuild its points in the turned local frame
  const fix = (q) => toLocal([q[0] + 150, q[1] + 62.5]);
  for (const lv of project.sections.plates.derived.levels) {
    for (const u of lv.units) u.demising = u.demising.map((ln) => ln.map(fix));
    lv.plate = lv.plate.map((poly) => ({ outer: poly.outer.map(fix), holes: [] }));
  }
  const dem = O.demisingLines(project, frame);
  eq(dem.source, "plates");
  same(dem.xs, [25, 53, 81, 109, 137, 165, 193, 221, 249, 277]);
  eq(dem.footprint.length, 1);
});

t("14 overlay: short-span suggestion uses the module: w* = (m U - column) / n", () => {
  const state = mk({ grid: { span: "short" } }), built = mkBuilt(state);
  const r = O.overlay(state, built, platesProject());
  // module 2 + 3 x 9 = 29; m = round(29 / 28) = 1; w* = (28 - 2) / 3 = 8.667 (inside 8 to 10)
  eq(r.suggestion.stallW, 8.667);
  // run 250; module 28 - 3 x 0 ... with w* the module is 2 + 26 = 28: floor(250 / 28) = 8 modules, rest 26 -> floor(24 / 8.667) = 2
  eq(r.suggestion.stallsPerRow, 8 * 3 + 2);
});

t("14 overlay: no suggestion when w* is out of 8 to 10 ft, or the width is already aligned", () => {
  const state = mk(), built = mkBuilt(state);
  const wide = platesProject();
  // 60 ft spacing: m = round(27 / 60) = max(1, 0) = 1, w* = 20: out of range
  const lv = wide.sections.plates.derived.levels.find((l) => l.index === 2);
  lv.units = [0, 1, 2, 3].map((j) => ({ id: `w${j}`, outer: rect(0, 0, 1, 1), demising: [[[-125 + 60 * j, -30], [-125 + 60 * j, 30]], [[-65 + 60 * j, -30], [-65 + 60 * j, 30]]] }));
  eq(O.overlay(state, built, wide).suggestion, null);
  // 27 ft units: aligned with the 27 ft module already
  const ok27 = platesProject();
  const lv27 = ok27.sections.plates.derived.levels.find((l) => l.index === 2);
  lv27.units = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => ({ id: `u${j}`, outer: rect(0, 0, 1, 1), demising: [[[-125 + 27 * j, -30], [-125 + 27 * j, 30]], [[-98 + 27 * j, -30], [-98 + 27 * j, 30]]] }));
  const r = O.overlay(state, built, ok27);
  eq(r.suggestion, null);
  // only the closing column at x 275 (7 ft past the last line at 268) is out
  same(r.conflicts.map((c) => [c.column[0], c.distance]), [[275, 7]]);
});

t("14 overlay: no project gives source none, no conflicts, no suggestion", () => {
  const state = mk(), built = mkBuilt(state);
  const r = O.overlay(state, built, null);
  same([r.source, r.conflicts, r.suggestion], ["none", [], null]);
  eq(O.demisingLines({ sections: {} }, built.frame).source, "none");
  throws(() => O.demisingLines({}, {}), "frame.toLayout");
});

t("14 overlay: no input mutation (frozen state, built, project, columns)", () => {
  const state = deepFreeze(mk()), built = deepFreeze(mkBuilt(mk())), project = deepFreeze(platesProject());
  const columns = deepFreeze(O.columnsFromState(state, built));
  const r = O.overlay(state, built, project, columns);
  eq(r.conflicts.length, 7);
});

t("14 overlay: preset 8.7 (podium level) suggests 9 ft 4 in and 26 stalls per row", () => {
  const state = PRESETS["8.7"].state(), built = mkBuilt(state);
  const r = O.overlay(state, built, platesProject());
  same(r.suggestion, { stallW: 9.333, stallsPerRow: 26 });   // floor(250 / 9.3333) = 26
});

t("columnsFromState: plan 3.8 counts (8.1: 33 per level; 8.7: 11; 8.8 short-span: 10 lines x 10)", () => {
  // 8.1: 3 lines (y 1, 61, 121) x (floor(250 / 27) + 1 = 10, plus the end at 275) = 33
  const s1 = mk(), c1 = O.columnsFromState(s1, mkBuilt(s1));
  eq(c1.points.length, 33);
  same(c1.lines.map((l) => l.y), [1, 61, 121]);
  eq(c1.lines[0].xs[9], 268);
  eq(c1.lines[0].xs[10], 275);
  eq(c1.module, 27);
  const s7 = PRESETS["8.7"].state(), c7 = O.columnsFromState(s7, mkBuilt(s7));
  eq(c7.points.length, 22);   // 2 lines x 11
  // 8.8: bays y0 1, 61, 121; lines = bay edges 1, 61, 121, 181 plus 18, 42, 78, 102, 138, 162 = 10 lines;
  // x = 25 + 29 j, j = 0..8, plus 275 (258 + 18 gap) -> 9 + 1 = 10 columns per line
  const s8 = PRESETS["8.8"].state(), c8 = O.columnsFromState(s8, mkBuilt(s8));
  eq(c8.lines.length, 10);
  eq(c8.points.length, 100);
  eq(c8.module, 29);
});

/* ------------------------------------------------------ 15 metrics ------- */

for (const [id, P] of Object.entries(PRESETS)) {
  t(`15 metrics: preset ${id} gives ${P.stalls} stalls, ${P.sf.toFixed(1)} sf per stall`, () => {
    const state = P.state(), { acc, metrics } = run(state);
    eq(acc.need.required, P.req, "accessible required");
    eq(acc.lost, P.lost, "stalls lost to aisles");
    eq(metrics.stalls, P.stalls, "stalls");
    eq(metrics.sfPerStall, P.sf, "sf per stall");
    eq(metrics.accessible.required, P.req);
    eq(metrics.accessible.provided, P.req);
    eq(metrics.accessible.lost, P.lost);
    eq(metrics.byKind.accessible + metrics.byKind.van, P.req);
    near(metrics.maxRampSlope, P.maxSlope, 1e-9, "max ramp slope");
    eq(metrics.levels, state.levels.count);
    eq(metrics.byLevel.reduce((s, l) => s + l.stalls, 0), P.stalls);
    eq(Object.values(metrics.byKind).reduce((s, n) => s + n, 0), P.stalls, "byKind sums to stalls");
  });
}

t("15 metrics: gross area, efficiency, balance (8.1 arithmetic)", () => {
  const { metrics } = run(mk());
  eq(metrics.grossArea, 187500);                 // 300 x 125 x 5
  // parking area: 496 stalls x 162 + 4 lost slots x 162 = 81,000; aisles 2 x 250 x 24 = 12,000 and
  // turn zones 2 bays x 2 ends x 24 x 60 = 5,760 per level x 5 = 88,800; total 169,800 / 187,500
  eq(metrics.parkingArea, 169800);
  near(metrics.efficiency, 0.906, 1e-9);
  same(metrics.byLevel.map((l) => l.stalls), [96, 100, 100, 100, 100]);
  eq(metrics.byKind.standard, 487);
  same(metrics.accessible, { required: 9, provided: 9, van: 2, car: 7, lost: 4, aisleLength: 31, table: 9, r2: null });
  eq(metrics.balance, 496);                      // no units: required 0
  eq(metrics.required.total, 0);
  eq(metrics.required.unitsSource, "none");
});

t("15 metrics: liner area comes off level 1 (8.8: 2 x 300 x 206 - 300 x 61 = 105,300)", () => {
  const { metrics } = run(PRESETS["8.8"].state());
  eq(metrics.grossArea, 105300);
  same(metrics.byLevel.map((l) => l.stalls), [89, 142]);   // level 1: 92 - 3 lost to aisles
  const north = run(mk({ footprint: { depth: 206 }, ramp: { type: "none" }, liner: { on: true, side: "north", depth: 40, levels: [1, 2] }, levels: { count: 2 } }));
  eq(north.metrics.grossArea, 2 * (300 * 206 - 300 * 40));
});

t("15 metrics: columns, clear heights, top of deck (8.1)", () => {
  const { metrics } = run(mk());
  eq(metrics.columns.perLevel, 33);
  eq(metrics.columns.total, 165);
  eq(metrics.columns.module, 27);
  same(metrics.clearHeights.map((c) => [c.level, c.clear, c.ok]), [[1, 8.5, true], [2, 8, true], [3, 8, true], [4, 8, true], [5, null, true]]);   // open top: no structure above
  eq(metrics.lowestClear, 8);
  eq(metrics.topOfDeck, 42.5);   // 11 + 3 x 10.5 below the top surface
  eq(run(mk({ levels: { openTop: false } })).metrics.topOfDeck, 53);   // plus the top level's 10.5
});

t("15 metrics: required parking, balance, bike, EV targets", () => {
  const state = mk({ required: { units: 400, ratio: 1.25, retailSf: 2000 }, bike: { mode: "per-units", perUnits: 10, rack: "single" } });
  const { metrics } = run(state);
  eq(metrics.required.total, 506);               // 400 x 1.25 + 2 x 3
  eq(metrics.balance, 496 - 506);
  eq(metrics.required.unitsSource, "typed");
  same(metrics.bike, { required: 40, rack: "single", areaSf: 480, wallFt: 0 });   // 40 x 12
  eq(run(mk({ required: { units: 400 }, bike: { mode: "per-units", perUnits: 10, rack: "two-tier" } })).metrics.bike.wallFt, 50);   // 40 x 1.25
  eq(run(mk({ bike: { mode: "count", count: 12, rack: "single" } })).metrics.bike.required, 12);
  eq(metrics.ev.targetInstalled, 25);            // round(496 x 0.05) = round(24.8)
  eq(metrics.ev.targetReady, 99);                // round(496 x 0.20) = round(99.2)
  eq(metrics.ev.installed, 0, "tagging is the layout's job; none tagged here");
  // units from the massing when null: 240 x 1.25 = 300
  const project = platesProject();
  const m2 = run(mk(), project).metrics;
  eq(m2.required.total, 300);
  eq(m2.required.unitsSource, "massing");
  eq(m2.conflicts, 7);
  eq(m2.columns.source, "plates");
  eq(m2.columns.suggestion.stallW, 9.333);
});

t("15 metrics: EV tags on the stalls are counted", () => {
  const state = mk(), { built } = run(state);
  const tagged = { ...built, levels: built.levels.map((lv, i) => ({ ...lv, stalls: lv.stalls.map((s, j) => (i === 0 && j < 25 ? { ...s, kind: "ev" } : i === 1 && j < 99 ? { ...s, evReady: true } : s)) })) };
  const acc = A.placeAccessible(state, tagged);
  const m = M.computeMetrics(state, tagged, [], O.columnsFromState(state, tagged), acc, null);
  eq(m.ev.installed, 25);
  eq(m.ev.ready, 99);
});

t("15 metrics: no input mutation, and metrics work without an accessible result", () => {
  const state = deepFreeze(mk()), built = deepFreeze(mkBuilt(mk())), project = deepFreeze(platesProject());
  const columns = deepFreeze(O.columnsFromState(state, built));
  const ramps = deepFreeze(mkRamps(state, built));
  const acc = A.placeAccessible(state, built);
  const m = M.computeMetrics(state, built, ramps, columns, acc, project);
  eq(m.stalls, 496);
  const raw = M.computeMetrics(state, built, ramps, columns, null, null);
  eq(raw.stalls, 500);
  eq(raw.accessible.lost, 0);
  throws(() => M.computeMetrics({}, built, ramps, columns, acc, null), "state.bays");
});

t("15 metrics: bays given as the baysOf object work the same", () => {
  const state = mk(), built = mkBuilt(state);
  const alt = { ...built, bays: { bays: built.bays, strip: built.strip }, strip: undefined };
  eq(O.columnsFromState(state, alt).points.length, 33);
  const acc = A.placeAccessible(state, alt);
  const m = M.computeMetrics(state, alt, mkRamps(state, alt), O.columnsFromState(state, alt), acc, null);
  eq(m.stalls, 496);
  same(M.checks(state, alt, mkRamps(state, alt), m), []);
});

/* ------------------------------------------------------- checks ---------- */

t("checks: preset 8.1 is clean", () => {
  const { built, ramps, metrics } = run(mk());
  same(M.checks(mk(), built, ramps, metrics), []);
});

t("checks: wrap deck at 10.5 ft level 1 warns about the van route and names the 11 ft fix", () => {
  const state = PRESETS["8.6"].state(), { built, ramps, metrics } = run(state);
  const w = M.checks(state, built, ramps, metrics);
  eq(w.length, 1);
  eq(w[0].code, "clear-height-van");
  same(w[0].floors, [1]);
  ok(w[0].message.includes("8 ft 0 in") && w[0].message.includes("8 ft 2 in") && w[0].message.includes("11 ft"), w[0].message);
  eq(metrics.clearHeights[0].ok, false);
});

t("checks: ramp slope above its limit warns", () => {
  const state = mk({ ramp: { type: "speed" }, footprint: { depth: 150 } }), { built, metrics } = run(state);
  const bad = [{ id: "R1", type: "speed", level: 1, slope: 0.13, limit: 0.12, ok: false, footprint: null }];
  const w = M.checks(state, built, bad, metrics).filter((x) => x.code === "ramp-slope");
  eq(w.length, 1);
  ok(w[0].message.includes("13.0%") && w[0].message.includes("12.0%"), w[0].message);
  const good = mkRamps(state, built);
  eq(M.checks(state, built, good, run(state).metrics).filter((x) => x.code === "ramp-slope").length, 0);   // 11.96% < 12%
});

t("checks: a strip over 10 ft warns unless a ramp stands in it (8.4 clean, flat-floor 150 ft deck warns)", () => {
  const s84 = PRESETS["8.4"].state(), r84 = run(s84);
  eq(M.checks(s84, r84.built, r84.ramps, r84.metrics).filter((x) => x.code === "unused-strip").length, 0);
  const none = mk({ footprint: { depth: 150 }, ramp: { type: "none" } }), rn = run(none);
  const w = M.checks(none, rn.built, rn.ramps, rn.metrics).filter((x) => x.code === "unused-strip");
  eq(w.length, 1);
  ok(w[0].message.includes("28 ft"), w[0].message);
  // 8.1 strip is 3 ft: no warning
  eq(M.checks(mk(), run(mk()).built, [], run(mk()).metrics).filter((x) => x.code === "unused-strip").length, 0);
});

t("checks: a core in the aisle or outside the footprint warns", () => {
  const state = mk({ cores: [{ id: "S1", kind: "stair", x: 25, y: 20, w: 22, d: 12 }, { id: "S9", kind: "stair", x: 290, y: 1, w: 22, d: 12 }] });
  const { built, ramps, metrics } = run(state);
  const w = M.checks(state, built, ramps, metrics);
  const inAisle = w.find((x) => x.code === "core-in-aisle"), outside = w.find((x) => x.code === "core-outside");
  ok(inAisle && inAisle.message.startsWith("S1 sits in the drive aisle"), "core-in-aisle");
  ok(outside && outside.message.startsWith("S9"), "core-outside");
  eq(inAisle.floors.length, 5);
});

t("checks: barrier, parking deficit, accessible shortfall", () => {
  const state = mk({ checks: { barrierProvided: 2.5 }, required: { units: 500, ratio: 1.25, retailSf: 0 } });
  const { built, ramps, metrics } = run(state);
  const codes = M.checks(state, built, ramps, metrics).map((x) => x.code);
  ok(codes.includes("barrier-height"), "barrier");
  ok(codes.includes("guard-height"), "guard");
  ok(codes.includes("parking-deficit"), "deficit");   // 625 required, 496 provided
  const msg = M.checks(state, built, ramps, metrics).find((x) => x.code === "parking-deficit").message;
  eq(msg, "Parking provided is 129 stalls short of the 625 required.");
  const lowGuard = mk({ checks: { barrierProvided: 3 } }), rl = run(lowGuard);
  const c2 = M.checks(lowGuard, rl.built, rl.ramps, rl.metrics).map((x) => x.code);
  ok(!c2.includes("barrier-height") && c2.includes("guard-height"), "3 ft clears the 2.75 ft barrier but not the 3.5 ft guard");
  const fake = { ...metrics, accessible: { ...metrics.accessible, provided: 5 } };
  ok(M.checks(state, built, ramps, fake).some((x) => x.code === "accessible-short"), "accessible shortfall");
});

t("checks: no input mutation", () => {
  const state = deepFreeze(mk()), r = run(mk());
  const w = M.checks(state, deepFreeze(r.built), deepFreeze(r.ramps), deepFreeze(r.metrics));
  eq(w.length, 0);
  throws(() => M.checks({}, r.built, r.ramps, r.metrics), "state.checks");
});

/* -------------------- against src/parking/layout.js and grid.js, if present */

const layoutUrl = new URL("../src/parking/layout.js", import.meta.url);
const gridUrl = new URL("../src/parking/grid.js", import.meta.url);
const rampsUrl = new URL("../src/parking/ramps.js", import.meta.url);
let L = null, G = null, RP = null;
for (const [name, url, set] of [["layout", layoutUrl, (m) => (L = m)], ["grid", gridUrl, (m) => (G = m)], ["ramps", rampsUrl, (m) => (RP = m)]]) {
  if (!fs.existsSync(url)) { console.log(`  skip against ${name}.js: file not present yet`); continue; }
  try { set(await import(url.href + "?t=" + Date.now())); } catch (e) { console.log(`  skip against ${name}.js: ${e.message.split("\n")[0]}`); }
}

if (L && typeof L.layout === "function") {
  for (const [id, P] of Object.entries(PRESETS)) {
    t(`15 against layout.js: preset ${id} gives ${P.stalls} stalls, ${P.sf.toFixed(1)} sf per stall`, () => {
      const state = P.state(), built = L.layout(state);
      const acc = A.placeAccessible(state, built);
      const columns = G && G.columnsFor ? G.columnsFor(state, built) : O.columnsFromState(state, built);
      const ramps = RP && RP.rampsFor ? RP.rampsFor(state, built) : [];
      const m = M.computeMetrics(state, built, ramps, columns, acc, null);
      eq(acc.need.required, P.req, "accessible required");
      eq(acc.lost, P.lost, "lost to aisles");
      eq(m.stalls, P.stalls, "stalls");
      eq(m.sfPerStall, P.sf, "sf per stall");
      if (RP && RP.rampsFor) near(m.maxRampSlope, P.maxSlope, 1e-6, "max ramp slope");
      deepFreeze(built);   // metrics and checks must read it without writing
      M.checks(state, built, ramps, m);
    });
  }
  t("15 against layout.js: the same counts as the hand fixture on every level", () => {
    for (const id of ["8.1", "8.5", "8.8"]) {
      const state = PRESETS[id].state(), real = L.layout(state), hand = mkBuilt(state);
      same(real.levels.map((l) => l.stalls.length), hand.levels.map((l) => l.stalls.length), id);
    }
  });
  t("14 against layout.js: overlay on preset 8.7 suggests 9.333 and 26 per row", () => {
    const state = PRESETS["8.7"].state(), built = L.layout(state);
    same(O.overlay(state, built, platesProject()).suggestion, { stallW: 9.333, stallsPerRow: 26 });
  });
}
if (L && G && typeof G.columnsFor === "function") {
  t("columns: columnsFromState matches grid.columnsFor on every preset", () => {
    for (const [id, P] of Object.entries(PRESETS)) {
      const state = P.state(), built = L.layout(state);
      const mine = O.columnsFromState(state, built), theirs = G.columnsFor(state, built);
      eq(mine.points.length, theirs.points.length, `${id} points`);
      near(mine.module, theirs.module, 1e-6, `${id} module`);
    }
  });
  if (typeof G.clearHeights === "function") {
    t("clear height: metrics agree with grid.clearHeights on every preset", () => {
      for (const [id, P] of Object.entries(PRESETS)) {
        const state = P.state(), theirs = G.clearHeights(state), mine = run(state).metrics.clearHeights;
        same(mine.map((c) => [c.level, c.clear, c.ok]), theirs.map((c) => [c.level, c.clear, c.ok]), id);
      }
    });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
// ---------- integrator: EV tags (plan 3.7) ----------
{
  const { createRequire } = await import("node:module");
  globalThis.ClipperLib = globalThis.ClipperLib || createRequire(import.meta.url)("clipper-lib");
  const P = await import("../src/parking/presets.js");
  const L = await import("../src/parking/layout.js");
  const A = await import("../src/parking/accessible.js");
  const s = P.PRESETS[0].state, acc = A.placeAccessible(s, L.layout(s));
  const before = JSON.stringify(acc.stalls);
  const t = A.tagEv(s, acc.stalls);
  const ev = t.filter((x) => x.kind === "ev"), ready = t.filter((x) => x.evReady);
  const okEv = t.length === 496 && ev.length === 25 && ready.length === 99 && ev.every((x) => x.level === 1)
    && !ready.some((x) => x.kind !== "standard") && JSON.stringify(acc.stalls) === before
    && t.filter((x) => x.kind === "accessible" || x.kind === "van").length === acc.stalls.filter((x) => x.kind === "accessible" || x.kind === "van").length;
  console.log(`  ${okEv ? "ok  " : "FAIL"} tagEv: preset 8.1 gives 25 EV on level 1 and 99 EV ready; accessible kept; input unchanged`);
  if (!okEv) fail++;
}

process.exit(fail ? 1 : 0);
