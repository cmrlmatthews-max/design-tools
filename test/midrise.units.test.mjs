// Run: node test/midrise.units.test.mjs
// Plan section 9.1 tests 9 to 14: units (9, 10, 11), parking (12, 13), metrics (14),
// plus hand checks of every number in plan section 8 against hand-made `built` fixtures.
// The fixtures match the assemble(state) contract of plan section 4; the cases at the end
// also run against src/midrise/assemble.js when that file exists.
import { createRequire } from "node:module";
import fs from "node:fs";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const B = await import("../src/midrise/bars.js");
const U = await import("../src/midrise/units.js");
const P = await import("../src/midrise/parking.js");
const M = await import("../src/midrise/metrics.js");

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

/* ------------------------------------------------------------ state ---- */

const PROGRAMS = {
  residential: { ftf: 10, unitSize: 850, unitFactor: 0.85, unitWidth: 28, parkingRatio: 1.25, color: "#4f7fd1" },
  hotel: { ftf: 10, unitSize: 400, unitFactor: 0.80, unitWidth: 14, parkingRatio: 0.8, color: "#8a63c9" },
  senior: { ftf: 10, unitSize: 600, unitFactor: 0.85, unitWidth: 30, parkingRatio: 0.6, color: "#c2607a" },
  retail: { ftf: 16, unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 3, color: "#d9a22b" },
  amenity: { ftf: 12, unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 0, color: "#58a65c" },
  leasing: { ftf: 12, unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 0, color: "#7a8fa6" },
  parking: { ftf: 10.5, unitSize: 330, unitFactor: 1, unitWidth: null, parkingRatio: 0, color: "#8b929a" },
};
const RULES = {
  corridorWidth: 5.67, breezewayWidth: 8, stairPer: 250, elevatorPer: 100, cornerLoss: 1,
  constructionHints: [
    { maxFloors: 3, podium: "any", hint: "Wood frame" },
    { maxFloors: 5, podium: "none", hint: "Wood frame with fire-rated assemblies" },
    { maxFloors: 5, podium: "yes", hint: "Wood over a concrete podium" },
    { maxFloors: 8, podium: "any", hint: "Mass timber, steel, or concrete; check the code" },
    { maxFloors: 999, podium: "any", hint: "Concrete; use the Tower Generator" },
  ],
};
const bar = (id, x, y, angle, length, over = {}) => ({
  id, name: `Bar ${id}`, x, y, angle, length, depth: 65, floors: 5, program: "residential", groundProgram: null,
  corridor: "double", unitSide: "left", ends: { start: "stair", end: "stair" }, bends: [], unitWidth: null, ...over,
});
function mkState(site, bars, over = {}) {
  return {
    schema: 1, name: "t", type: "bar",
    site: { shape: "rect", width: site[0], depth: site[1], points: [], setbacks: { front: 20, back: 20, left: 20, right: 20 },
      heightLimit: 0, stepback: { on: false, aboveHeight: 85, distance: 15 }, densityCap: 0, openSpaceShare: 0, separationMin: 20, courtyardMin: 40 },
    placement: null, context: { show: true, fromSite: false, blocks: [] },
    floors: { groundFtf: 12, ftf: 10 },
    bars, courts: [],
    deck: { on: false, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true },
    podium: { on: false, levels: [{ ftf: 11, program: "parking" }], footprint: { mode: "allowed", percent: 100, offset: 0 }, liner: { on: false, side: "front", depth: 40 } },
    surface: { count: 0, lot: [] },
    programs: PROGRAMS,
    parking: { sfPerStallSurface: 350, sfPerStallDeck: 330, retailPerThousand: 3 },
    rules: RULES, roof: { type: "parapet", height: 4 }, targets: { units: 0, density: 0 },
    ...over,
  };
}

/* ---------------------------------------------------------- fixtures ---- */

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];            // counter-clockwise
const hole = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];            // clockwise
const poly = (outer, holes = []) => ({ outer, holes });

/* A hand-made `built` in the assemble() contract shape. spec:
   barPlates MultiPoly at every bar level, podium MultiPoly (or per-level array), deckPlate MultiPoly,
   joints [{ a, b, type, insideCorners, zone }], edges (override of spineGraph edges), courtyards. */
function mkBuilt(state, spec) {
  const levels = B.buildingLevels(state).map((l) => {
    let plates = [];
    if (l.zone === "bar") plates = spec.barPlates;
    if (l.zone === "podium") plates = Array.isArray(spec.podium[0]) ? spec.podium[l.index - 1] : spec.podium;
    if (l.zone === "deck") plates = spec.deckPlate;
    return { ...l, plates, spines: [], joints: [], cornerZones: [], barIds: l.zone === "bar" ? state.bars.map((b) => b.id) : [] };
  });
  const joints = (spec.joints || []).map((j, i) => ({ id: `J${i + 1}`, barIds: [j.a, j.b], type: j.type || "L", insideCorners: j.insideCorners ?? 1, zone: j.zone, node: j.node || [0, 0] }));
  const edges = spec.edges || state.bars.map((b) => ({ from: `${b.id}0`, to: `${b.id}1`, barId: b.id, length: b.length }));
  const nodes = [];
  for (const e of edges) for (const k of [e.from, e.to]) if (!nodes.find((n) => n.id === k)) nodes.push({ id: k, x: 0, y: 0, kind: "end" });
  return {
    levels, spineGraph: { nodes, edges }, joints, courtyards: spec.courtyards || [], separation: [],
    plates: [], solids: [], warnings: [],
  };
}
const J = (a, b, x0, y0, x1, y1, type = "L", insideCorners = 1) => ({ a, b, type, insideCorners, zone: poly(rect(x0, y0, x1, y1)) });

/* ---- plan section 8 presets (8.1 to 8.6), geometry worked out by hand ---- */
const F = {};

F["8.1"] = (() => {
  const bars = [-120, 0, 120].map((y, i) => bar("ABC"[i], -96, y, 0, 192, { depth: 66, floors: 3, corridor: "breezeway", ends: { start: "open", end: "open" } }));
  const state = mkState([540, 403], bars, { floors: { groundFtf: 10, ftf: 10 }, surface: { count: 160, lot: [] } });
  const barPlates = [-120, 0, 120].map((y) => poly(rect(-96, y - 33, 96, y + 33)));
  return { state, built: mkBuilt(state, { barPlates, podium: [] }) };
})();

F["8.2"] = (() => {
  const bars = [
    bar("A", -152.5, -80, 0, 240, { floors: 4 }),
    bar("B", -120, -112.5, 90, 160, { floors: 4, ends: { start: "open", end: "stair" } }),
  ];
  const state = mkState([400, 327], bars, { surface: { count: 125, lot: [] } });
  const L = poly([[-152.5, -112.5], [87.5, -112.5], [87.5, -47.5], [-87.5, -47.5], [-87.5, 47.5], [-152.5, 47.5]]);
  // spines cross at (-120, -80): A is cut 32.5 / 207.5, B is cut 32.5 / 127.5
  const edges = [
    { from: "A0", to: "N1", barId: "A", length: 32.5 }, { from: "N1", to: "A1", barId: "A", length: 207.5 },
    { from: "B0", to: "N1", barId: "B", length: 32.5 }, { from: "N1", to: "B1", barId: "B", length: 127.5 },
  ];
  return { state, built: mkBuilt(state, { barPlates: [L], podium: [], joints: [J("A", "B", -152.5, -112.5, -87.5, -47.5)], edges }) };
})();

F["8.3"] = (() => {
  const state = mkState([360, 242], [bar("A", -150, 0, 0, 300)], { surface: { count: 120, lot: [] } });
  return { state, built: mkBuilt(state, { barPlates: [poly(rect(-150, -32.5, 150, 32.5))], podium: [] }) };
})();

F["8.4"] = (() => {
  const bars = [
    bar("S", -125, -77.5, 0, 250), bar("N", -125, 77.5, 0, 250),
    bar("W", -92.5, -110, 90, 220, { ends: { start: "open", end: "open" } }),
    bar("E", 92.5, -110, 90, 220, { ends: { start: "open", end: "open" } }),
  ];
  const podium = { on: true, levels: [{ ftf: 11, program: "parking" }], footprint: { mode: "offset", percent: 100, offset: 0 }, liner: { on: false, side: "front", depth: 40 } };
  const state = mkState([330, 330], bars, { podium, surface: { count: 120, lot: [] } });
  const ring = poly(rect(-125, -110, 125, 110), [hole(-60, -45, 60, 45)]);
  const joints = [
    J("S", "W", -125, -110, -60, -45), J("S", "E", 60, -110, 125, -45),
    J("N", "W", -125, 45, -60, 110), J("N", "E", 60, 45, 125, 110),
  ];
  const courtyards = [{ kind: "closed", id: "H1", area: 10800, minDim: 90, ring: hole(-60, -45, 60, 45) }];
  return { state, built: mkBuilt(state, { barPlates: [ring], podium: [poly(rect(-125, -110, 125, 110))], joints, courtyards }) };
})();

F["8.5"] = (() => {
  const bars = [
    bar("S", -225, -105, 0, 450), bar("N", -225, 105, 0, 450),
    bar("W", -192.5, -137.5, 90, 275, { ends: { start: "open", end: "open" } }),
    bar("E", 192.5, -137.5, 90, 275, { ends: { start: "open", end: "open" } }),
  ];
  const deck = { on: true, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true };
  const state = mkState([540, 363], bars, { deck, surface: { count: 40, lot: [] } });
  const ring = poly(rect(-225, -137.5, 225, 137.5), [hole(-160, -72.5, 160, 72.5)]);
  const joints = [
    J("S", "W", -225, -137.5, -160, -72.5), J("S", "E", 160, -137.5, 225, -72.5),
    J("N", "W", -225, 72.5, -160, 137.5), J("N", "E", 160, 72.5, 225, 137.5),
  ];
  const courtyards = [{ kind: "closed", id: "H1", area: 320 * 145, minDim: 145, ring: hole(-160, -72.5, 160, 72.5) }];
  return { state, built: mkBuilt(state, { barPlates: [ring], podium: [], deckPlate: [poly(rect(-150, -62.5, 150, 62.5))], joints, courtyards }) };
})();

F["8.6"] = (() => {
  const bars = [
    bar("S", -150, -67.5, 0, 300),
    bar("W", -117.5, -100, 90, 200, { ends: { start: "open", end: "stair" } }),
    bar("E", 117.5, -100, 90, 200, { ends: { start: "open", end: "stair" } }),
  ];
  const podium = { on: true, levels: [{ ftf: 16, program: "parking" }, { ftf: 11, program: "parking" }], footprint: { mode: "offset", percent: 100, offset: 0 }, liner: { on: true, side: "front", depth: 40 } };
  const state = mkState([330, 231], bars, { podium, courts: [{ id: "C1", x: 0, y: 32.5, w: 170, d: 135 }], surface: { count: 0, lot: [] } });
  const U6 = poly([[-150, -100], [150, -100], [150, 100], [85, 100], [85, -35], [-85, -35], [-85, 100], [-150, 100]]);
  const joints = [J("S", "W", -150, -100, -85, -35), J("S", "E", 85, -100, 150, -35)];
  const courtyards = [{ kind: "open", id: "C1", area: 22950, minDim: 135, ring: rect(-85, -35, 85, 100) }];
  return { state, built: mkBuilt(state, { barPlates: [U6], podium: [poly(rect(-150, -100, 150, 100))], joints, courtyards }) };
})();

const run = (key) => {
  const { state, built } = F[key];
  const units = U.unitsEstimate(state, built);
  const parking = { required: P.parkingRequired(state, units, built), provided: P.parkingProvided(state, built) };
  const metrics = M.computeMetrics(state, built, units, parking);
  return { state, built, units, parking, metrics };
};

console.log("midrise.units.test.mjs");

/* =============================== test 9 ================================ */
t("9. breezeway bar 192 ft, w 28: 12 units per floor", () => {
  const state = mkState([540, 403], [bar("A", -96, 0, 0, 192, { depth: 66, floors: 3, corridor: "breezeway" })]);
  const built = mkBuilt(state, { barPlates: [poly(rect(-96, -33, 96, 33))], podium: [] });
  const u = U.unitsEstimate(state, built);
  eq(u.byBar.A.perFloor, 12);                    // 4 x floor(192 / (2 x 28 + 8)) = 4 x 3
  eq(u.byBar.A.total, 36);
  eq(u.total, 36);
});

/* ============================== test 10 ================================ */
t("10. preset 8.2: 25 units per floor, 100 total, corner loss charged to bar A", () => {
  const { units } = run("8.2");
  eq(units.byBar.A.perFloor, 15, "A: 2 x floor(240 / 28) - 1 = 16 - 1");
  eq(units.byBar.B.perFloor, 10, "B: 2 x floor(160 / 28) = 10");
  eq(units.byBar.A.perFloor + units.byBar.B.perFloor, 25);
  eq(units.byBar.A.lossPerFloor, 1); eq(units.byBar.B.lossPerFloor, 0);
  eq(units.byBar.A.floors, 4); eq(units.byBar.A.total, 60); eq(units.byBar.B.total, 40);
  eq(units.total, 100);
  eq(units.byProgram.residential, 100);
  eq(units.warnings.length, 0);
});

/* ============================== test 11 ================================ */
t("11. sliver: a 50 ft bar with w 28 gives one sliver warning", () => {
  const state = mkState([300, 300], [bar("C", 0, 0, 0, 50, { floors: 3 })]);
  const built = mkBuilt(state, { barPlates: [poly(rect(0, -32.5, 50, 32.5))], podium: [] });
  const u = U.unitsEstimate(state, built);
  eq(u.warnings.length, 1);
  eq(u.warnings[0].code, "sliver"); eq(u.warnings[0].severity, "warn");
  eq(u.warnings[0].message, "Bar C is shorter than two units.");
  eq(u.byBar.C.perFloor, 2);                     // 2 x floor(50 / 28)
});
t("11b. a bar of exactly two unit widths is not a sliver", () => {
  const state = mkState([300, 300], [bar("C", 0, 0, 0, 56)]);
  const built = mkBuilt(state, { barPlates: [poly(rect(0, -32.5, 56, 32.5))], podium: [] });
  eq(U.unitsEstimate(state, built).warnings.length, 0);
});

/* ---- more unit rules ---- */
t("single-loaded bar: floor(length / w) per floor", () => {
  const state = mkState([300, 300], [bar("A", 0, 0, 0, 300, { corridor: "single", depth: 38, floors: 4 })]);
  const u = U.unitsEstimate(state, mkBuilt(state, { barPlates: [poly(rect(0, -19, 300, 19))], podium: [] }));
  eq(u.byBar.A.perFloor, 10); eq(u.total, 40);
});
t("bar.unitWidth overrides the program width; hotel default is 14", () => {
  const s1 = mkState([300, 300], [bar("A", 0, 0, 0, 300, { unitWidth: 30, floors: 2 })]);
  eq(U.unitsEstimate(s1, mkBuilt(s1, { barPlates: [], podium: [] })).byBar.A.perFloor, 20);          // 2 x floor(300 / 30)
  const s2 = mkState([300, 300], [bar("A", 0, 0, 0, 300, { program: "hotel", floors: 2 })]);
  const u2 = U.unitsEstimate(s2, mkBuilt(s2, { barPlates: [], podium: [] }));
  eq(u2.byBar.A.perFloor, 42); eq(u2.byProgram.hotel, 84);                                          // 2 x floor(300 / 14) = 42
});
t("ground retail adds no units on that floor", () => {
  const s = mkState([300, 300], [bar("A", 0, 0, 0, 300, { groundProgram: "retail" })]);
  const u = U.unitsEstimate(s, mkBuilt(s, { barPlates: [], podium: [] }));
  eq(u.byBar.A.floors, 4); eq(u.byBar.A.total, 80); eq(u.byBar.A.perFloor, 20); eq(u.total, 80);
});
t("a bend is one inside corner charged to its own bar", () => {
  const s = mkState([400, 400], [bar("A", -150, 0, 0, 300, { floors: 2, bends: [{ at: 120, deg: 90 }] })]);
  const u = U.unitsEstimate(s, mkBuilt(s, { barPlates: [], podium: [] }));
  eq(u.byBar.A.perFloor, 19); eq(u.byBar.A.lossPerFloor, 1); eq(u.total, 38);
});
t("joint loss applies only on floors where both bars stand", () => {
  const s = mkState([400, 400], [bar("A", -152.5, -80, 0, 240, { floors: 5 }), bar("B", -120, -112.5, 90, 160, { floors: 3 })]);
  const b = mkBuilt(s, { barPlates: [], podium: [], joints: [J("A", "B", -152.5, -112.5, -87.5, -47.5)] });
  const u = U.unitsEstimate(s, b);
  eq(u.byBar.A.total, 5 * 16 - 3, "A loses 1 on floors 1 to 3 only");
  eq(u.byBar.B.total, 3 * 10);
  eq(u.total, 77 + 30);
});
t("a T joint (2 inside corners) and a cross joint (4) charge cornerLoss x insideCorners", () => {
  const s = mkState([400, 400], [bar("A", -150, 0, 0, 300, { floors: 1 }), bar("B", 0, -75, 90, 150, { floors: 1 })]);
  const T = U.unitsEstimate(s, mkBuilt(s, { barPlates: [], podium: [], joints: [{ a: "A", b: "B", type: "T", insideCorners: 2, zone: poly(rect(0, 0, 1, 1)) }] }));
  eq(T.byBar.A.total, 20 - 2); eq(T.byBar.B.total, 10);
  const X = U.unitsEstimate(s, mkBuilt(s, { barPlates: [], podium: [], joints: [{ a: "A", b: "B", type: "cross", insideCorners: 4, zone: poly(rect(0, 0, 1, 1)) }] }));
  eq(X.byBar.A.total, 20 - 4);
});
t("cornerLoss 0 charges nothing; cornerLoss is clamped to 2", () => {
  const s = mkState([400, 400], [bar("A", -152.5, -80, 0, 240, { floors: 1 }), bar("B", -120, -112.5, 90, 160, { floors: 1 })]);
  const b = mkBuilt(s, { barPlates: [], podium: [], joints: [J("A", "B", 0, 0, 1, 1)] });
  eq(U.unitsEstimate({ ...s, rules: { ...RULES, cornerLoss: 0 } }, b).total, 26);
  eq(U.unitsEstimate({ ...s, rules: { ...RULES, cornerLoss: 5 } }, b).total, 24);
});
t("units never go below 0", () => {
  const s = mkState([400, 400], [bar("A", 0, 0, 0, 20, { floors: 1 }), bar("B", 0, 0, 90, 20, { floors: 1 })]);
  const u = U.unitsEstimate({ ...s, rules: { ...RULES, cornerLoss: 2 } }, mkBuilt(s, { barPlates: [], podium: [], joints: [{ a: "A", b: "B", type: "cross", insideCorners: 4, zone: poly(rect(0, 0, 1, 1)) }] }));
  eq(u.byBar.A.total, 0);
});
t("units inputs are not mutated; missing inputs throw", () => {
  const { state, built } = F["8.2"];
  U.unitsEstimate(deepFreeze(JSON.parse(JSON.stringify(state))), deepFreeze(JSON.parse(JSON.stringify(built))));
  throws(() => U.unitsEstimate(state), "built.joints");
  throws(() => U.unitsEstimate({}, built), "state.bars");
});

/* =============================== test 12 =============================== */
t("12. preset 8.6: parking required 324, provided 326", () => {
  const { parking, units } = run("8.6");
  eq(units.total, 230);
  eq(parking.required.total, 324);                // 230 x 1.25 = 287.5, + 12 x 3 = 36 -> 323.5 -> 324
  eq(parking.required.retailArea, 12000);
  near(parking.required.retail, 36);
  near(parking.required.byProgram.residential, 287.5);
  eq(parking.provided.total, 326);                // floor(48,000 / 330) + floor(60,000 / 330) = 145 + 181
  same(parking.provided.podium, [145, 181]);
  eq(parking.provided.surface, 0); eq(parking.provided.deck, 0);
});

/* =============================== test 13 =============================== */
t("13. drawn lot of 35,000 sf plus count 10 gives 110 provided", () => {
  const state = mkState([500, 500], [bar("A", 0, 0, 0, 300)], { surface: { count: 10, lot: rect(0, 100, 175, 300) } });   // 175 x 200 = 35,000
  const p = P.parkingProvided(state, mkBuilt(state, { barPlates: [], podium: [] }));
  eq(p.total, 110); eq(p.surface, 10); eq(p.lot, 100);
});
t("13b. a drawn lot rounds down, and a lot under 3 points counts 0", () => {
  const s = mkState([500, 500], [bar("A", 0, 0, 0, 300)], { surface: { count: 0, lot: rect(0, 0, 100, 100.5) } });   // 10,050 / 350 = 28.7
  eq(P.parkingProvided(s, mkBuilt(s, { barPlates: [], podium: [] })).lot, 28);
  const s2 = { ...s, surface: { count: 3, lot: [[0, 0], [1, 1]] } };
  eq(P.parkingProvided(s2, mkBuilt(s2, { barPlates: [], podium: [] })).total, 3);
});

/* ---- parking rules ---- */
t("deck stalls: floor(levels x w x d / sfPerStallDeck)", () => {
  const { parking } = run("8.5");
  eq(parking.provided.deck, 568);                 // 5 x 37,500 / 330 = 568.18
  eq(parking.provided.total, 608);
});
t("liner on another side and a retail podium level", () => {
  const { state, built } = F["8.6"];
  const back = { ...state, podium: { ...state.podium, liner: { on: true, side: "back", depth: 40 } } };
  // the back strip of the 300 x 200 plate is 300 x 40 too
  eq(P.retailArea(back, built).liner, 12000);
  const left = { ...state, podium: { ...state.podium, liner: { on: true, side: "left", depth: 40 } } };
  eq(P.retailArea(left, built).liner, 8000);      // 40 x 200
  const retailLevel = { ...state, podium: { ...state.podium, levels: [{ ftf: 16, program: "retail" }, { ftf: 11, program: "parking" }] } };
  const area = P.retailArea(retailLevel, built);
  eq(area.podium, 60000); eq(area.liner, 0);
  const prov = P.parkingProvided(retailLevel, built);
  same(prov.podium, [0, 181]);                    // a retail level holds no stalls
});
t("ground retail on a bar counts length x depth, minus the joint overlap charged to the later bar", () => {
  const s = mkState([400, 400], [bar("A", -152.5, -80, 0, 240, { groundProgram: "retail" }), bar("B", -120, -112.5, 90, 160, { groundProgram: "retail" })]);
  const b = mkBuilt(s, { barPlates: [], podium: [], joints: [J("A", "B", -152.5, -112.5, -87.5, -47.5)] });
  const area = P.retailArea(s, b);
  eq(area.groundBars, 240 * 65 + (160 * 65 - 65 * 65));   // 15,600 + 6,175
  const req = P.parkingRequired(s, U.unitsEstimate(s, b), b);
  near(req.retail, 21.775 * 3, 0.01);
});
t("hotel and senior use their own ratios", () => {
  const s = mkState([400, 400], [bar("A", 0, 0, 0, 280, { program: "hotel", floors: 1 }), bar("B", 0, 100, 0, 300, { program: "senior", floors: 1 })]);
  const b = mkBuilt(s, { barPlates: [], podium: [] });
  const u = U.unitsEstimate(s, b);                 // hotel 2 x 20 = 40, senior 2 x 10 = 20
  eq(u.byProgram.hotel, 40); eq(u.byProgram.senior, 20);
  const r = P.parkingRequired(s, u, b);
  near(r.byProgram.hotel, 32); near(r.byProgram.senior, 12); eq(r.total, 44);
});
t("parkingBalance returns required, provided, ratio and balance", () => {
  const { state, built, units } = run("8.3");
  const bal = P.parkingBalance(state, units, built);
  eq(bal.required.total, 125); eq(bal.provided.total, 120); eq(bal.surplus, -5); near(bal.ratioProvided, 1.2);
});
t("parking inputs are not mutated; missing inputs throw", () => {
  const { state, built, units } = run("8.6");
  const fs_ = deepFreeze(JSON.parse(JSON.stringify(state))), fb = deepFreeze(JSON.parse(JSON.stringify(built)));
  P.parkingRequired(fs_, units, fb); P.parkingProvided(fs_, fb);
  throws(() => P.parkingProvided({}, built), "state.parking");
  throws(() => P.parkingRequired(state, null, built), "units.byProgram");
});

/* =============================== test 14 =============================== */
t("14. preset 8.3: GFA 97,500; FAR 1.12; density 50.0; coverage 19,500 / 87,120", () => {
  const { metrics: m } = run("8.3");
  eq(m.gfa, 97500);
  near(m.far, 1.119, 0.0006); eq(Math.round(m.far * 100) / 100, 1.12);
  eq(Math.round(m.density * 10) / 10, 50);
  near(m.siteCoverage, 19500 / 87120, 0.0006);
  eq(m.siteCoverageArea, 19500);
  eq(m.units, 100);
  eq(m.siteArea, 87120); near(m.siteAcres, 2, 1e-3);
});
t("14b. preset 8.3: parking deficit 5, stairs 3, elevators 1, height 52 ft, floors 5", () => {
  const { metrics: m } = run("8.3");
  eq(m.parking.required, 125); eq(m.parking.provided, 120); eq(m.parking.surplus, -5); eq(m.parking.deficit, true);
  near(m.parking.ratioProvided, 1.2);
  eq(m.warnings.length, 1); eq(m.warnings[0].code, "parking-deficit");
  eq(m.stairs.total, 3);                           // 2 end stairs + (ceil(300 / 250) - 1)
  eq(m.elevators, 1);
  eq(m.height, 52); eq(M.formatHeight(m.height), "52' 0\"");
  eq(m.floors, 5); same(m.floorsDetail, { bar: 5, podium: 0, deck: 0 });
  eq(m.bars.count, 1); eq(m.bars.longest.id, "A");
  eq(m.corridorLength, 300); near(m.corridorPerUnit, 3);
  eq(m.constructionHint, "Wood frame with fire-rated assemblies");
});
t("14c. preset 8.3: efficiency = (19,500 - 300 x 5.67 - 3 x 264 - 100) / 19,500", () => {
  // corridor 1,701 sf; stairs 3 x (12 x 22) = 792 sf; elevator 100 sf -> 16,907 sf net
  near(run("8.3").metrics.efficiency, 16907 / 19500, 0.0006);
});
t("14d. open space: (87,120 - 19,500 - 120 stalls x 350) / 87,120", () => {
  const { metrics: m } = run("8.3");
  near(m.openSpace.area, 87120 - 19500 - 42000, 0.1);
  near(m.openSpace.ratio, 25620 / 87120, 0.0006);
});
t("14e. target check: units and density against targets", () => {
  const { state, built } = F["8.3"];
  const s = { ...state, targets: { units: 120, density: 40 } };
  const m = M.computeMetrics(s, built);
  eq(m.target.units.diff, -20); near(m.target.units.pct, -16.7, 0.05);
  near(m.target.density.diff, 10, 1e-3); near(m.target.density.pct, 25, 0.05);
  eq(M.computeMetrics(state, built).target.units, null);
});
t("14f. computeMetrics computes units and parking itself when they are not passed", () => {
  const { state, built } = F["8.3"];
  const m = M.computeMetrics(state, built);
  eq(m.units, 100); eq(m.parking.required, 125); eq(m.parking.provided, 120);
});
t("14g. warnings: density over the cap, open space under the rule, no parking deficit", () => {
  const { state, built } = F["8.2"];
  const s = { ...state, site: { ...state.site, densityCap: 30, openSpaceShare: 0.9 } };
  const m = M.computeMetrics(s, built);
  eq(m.warnings.map((w) => w.code).sort().join(), "density-cap,open-space");
  eq(m.openSpace.ok, false);
});
t("14h. roof screen adds its height; parapet adds 0", () => {
  const { state, built } = F["8.3"];
  eq(M.computeMetrics({ ...state, roof: { type: "screen", height: 8 } }, built).height, 60);
  eq(M.computeMetrics({ ...state, roof: { type: "parapet", height: 4 } }, built).height, 52);
});
t("14i. metrics inputs are not mutated; missing inputs throw", () => {
  const { state, built } = F["8.4"];
  M.computeMetrics(deepFreeze(JSON.parse(JSON.stringify(state))), deepFreeze(JSON.parse(JSON.stringify(built))));
  throws(() => M.computeMetrics(state, {}), "built.levels");
  throws(() => M.constructionHint({}), "state.rules.constructionHints");
});

/* ---- construction hint ---- */
t("construction hint: first matching row, podium none / yes / any", () => {
  const base = F["8.3"].state;
  const hint = (floors, podiumOn) => M.constructionHint({ ...base, bars: [{ ...base.bars[0], floors }], podium: { ...base.podium, on: podiumOn } });
  eq(hint(3, false), "Wood frame"); eq(hint(3, true), "Wood frame");
  eq(hint(5, false), "Wood frame with fire-rated assemblies");
  eq(hint(5, true), "Wood over a concrete podium");
  eq(hint(4, true), "Wood over a concrete podium");
  eq(hint(7, true), "Mass timber, steel, or concrete; check the code");
  eq(hint(9, false), "Concrete; use the Tower Generator");
  eq(M.constructionHint({ ...base, bars: [] }), "");
});
t("format helpers", () => {
  eq(M.formatArea(97500), "97,500 sf"); eq(M.formatDensity(50), "50.0 per acre"); eq(M.formatDensity(21.64), "21.6 per acre");
  eq(M.formatHeight(63.5), "63' 6\""); eq(M.formatHeight(52.5), "52' 6\"");
});

/* ============ every preset of plan section 8, by hand-made fixture ======= */
const EXPECT = {
  "8.1": { units: 108, density: 21.6, gfa: 114048, far: 0.52, req: 135, prov: 160, ratio: 1.48, stairs: 9, elev: 0, height: 30 },
  "8.2": { units: 100, density: 33.3, gfa: 87100, far: 0.67, req: 125, prov: 125, ratio: 1.25, stairs: 3, elev: 1, height: 42 },
  "8.3": { units: 100, density: 50.0, gfa: 97500, far: 1.12, req: 125, prov: 120, ratio: 1.2, stairs: 3, elev: 1, height: 52 },
  "8.4": { units: 280, density: 112.0, gfa: 276000, far: 2.53, req: 350, prov: 286, ratio: 1.02, stairs: 4, elev: 3, height: 63 },
  "8.5": { units: 480, density: 106.7, gfa: 574250, far: 2.93, req: 600, prov: 608, ratio: 1.27, stairs: 8, elev: 5, height: 52 },
  "8.6": { units: 230, density: 131.4, gfa: 305250, far: 4.0, req: 324, prov: 326, ratio: 1.42, stairs: 5, elev: 3, height: 79 },
};
for (const [key, e] of Object.entries(EXPECT)) {
  t(`preset ${key}: units ${e.units}, density ${e.density}, GFA ${e.gfa}, FAR ${e.far}, parking ${e.req}/${e.prov}, stairs ${e.stairs}, elevators ${e.elev}, height ${e.height}`, () => {
    const { metrics: m } = run(key);
    eq(m.units, e.units, "units");
    eq(Math.round(m.density * 10) / 10, e.density, "density");
    eq(m.gfa, e.gfa, "gfa");
    eq(Math.round(m.far * 100) / 100, e.far, "far");
    eq(m.parking.required, e.req, "required"); eq(m.parking.provided, e.prov, "provided");
    near(m.parking.ratioProvided, e.ratio, 0.006, "ratio");
    eq(m.stairs.total, e.stairs, "stairs"); eq(m.elevators, e.elev, "elevators");
    eq(m.height, e.height, "height");
  });
}
t("preset 8.1: exterior stairs 9, no exit stairs, efficiency (38,016 - 1,800) / 38,016", () => {
  const { metrics: m } = run("8.1");
  eq(m.stairs.exterior, 9); eq(m.stairs.exit, 0);
  eq(m.corridorLength, 0);                          // breezeway bars add 0
  near(m.efficiency, 36216 / 38016, 0.0006);
  eq(m.constructionHint, "Wood frame");
});
t("preset 8.2: union 21,775 per level; corridor total 400 across split edges; coverage 21,775 / 130,800", () => {
  const { metrics: m } = run("8.2");
  eq(m.gfa, 4 * 21775);
  eq(m.corridorLength, 400);
  near(m.siteCoverage, 21775 / 130800, 0.0006);
  eq(m.stairs.byBar.A.exit, 2); eq(m.stairs.byBar.B.exit, 1);
});
t("preset 8.4: podium level adds 55,000; coverage is the podium; closed court 10,800 (min 90); wood over podium", () => {
  const { metrics: m } = run("8.4");
  eq(m.gfa, 55000 + 5 * 44200);
  near(m.siteCoverage, 55000 / 108900, 0.0006);
  eq(m.courtyards.count, 1); eq(m.courtyards.area, 10800); eq(m.courtyards.minDim, 90);
  eq(m.constructionHint, "Wood over a concrete podium");
  same(m.floorsDetail, { bar: 5, podium: 1, deck: 0 }); eq(m.floors, 6);
  eq(M.formatHeight(m.height), "63' 0\"");
});
t("preset 8.5: deck on grade adds to coverage; deck top 52.5 ft; deck levels counted in GFA", () => {
  const { metrics: m } = run("8.5");
  eq(m.siteCoverageArea, 77350 + 37500);
  eq(m.deckTop, 52.5); eq(m.height, 52);
  same(m.floorsDetail, { bar: 5, podium: 0, deck: 5 });
});
t("preset 8.5: a deck that overlaps the bars is not counted twice in coverage", () => {
  const { state, built } = F["8.5"];
  const moved = { ...built, levels: built.levels.map((l) => (l.zone === "deck" ? { ...l, plates: [poly(rect(-250, -62.5, 50, 62.5))] } : l)) };
  // deck x -250..50, y -62.5..62.5 (37,500 sf); the part inside the bars is x -225..-160 = 65 x 125 = 8,125 sf
  const m = M.computeMetrics(state, moved);
  near(m.siteCoverageArea, 77350 + 37500 - 8125, 0.1);
});
t("preset 8.6: open court 22,950 sf (min 135); retail liner is 12,000 sf; GFA 305,250", () => {
  const { metrics: m, parking } = run("8.6");
  eq(m.courtyards.area, 22950); eq(m.courtyards.minDim, 135);
  eq(parking.required.retailArea, 12000);
  eq(m.gfa, 305250);
  near(m.density, 230 / 1.75, 0.001);
});

/* ===== the same cases against assemble(state), when assemble.js exists ===== */
const assemblePath = new URL("../src/midrise/assemble.js", import.meta.url);
if (fs.existsSync(assemblePath)) {
  let A = null;
  try { A = await import(assemblePath.href); } catch (e) { console.log("  note assemble.js did not load: " + e.message.split("\n")[0]); }
  if (A && typeof A.assemble === "function") {
    const viaAssemble = (key) => {
      const { state } = F[key];
      const built = A.assemble(state);
      const units = U.unitsEstimate(state, built);
      const parking = { required: P.parkingRequired(state, units, built), provided: P.parkingProvided(state, built) };
      return { units, parking, metrics: M.computeMetrics(state, built, units, parking) };
    };
    t("assemble 10. preset 8.2: 25 units per floor, 100 total, loss charged to A", () => {
      const { units } = viaAssemble("8.2");
      eq(units.byBar.A.perFloor + units.byBar.B.perFloor, 25); eq(units.byBar.A.lossPerFloor, 1); eq(units.total, 100);
    });
    t("assemble 12. preset 8.6: required 324, provided 326", () => {
      const { parking } = viaAssemble("8.6");
      eq(parking.required.total, 324); eq(parking.provided.total, 326);
    });
    t("assemble 14. preset 8.3: GFA 97,500; FAR 1.12; density 50.0; coverage 19,500 / 87,120", () => {
      const { metrics: m } = viaAssemble("8.3");
      eq(m.gfa, 97500); eq(Math.round(m.far * 100) / 100, 1.12); eq(Math.round(m.density * 10) / 10, 50);
      near(m.siteCoverage, 19500 / 87120, 0.0006);
    });
    for (const key of Object.keys(EXPECT)) {
      t(`assemble preset ${key}: units, GFA, parking, stairs, elevators, height`, () => {
        const e = EXPECT[key], { metrics: m } = viaAssemble(key);
        eq(m.units, e.units, "units"); eq(m.gfa, e.gfa, "gfa");
        eq(m.parking.required, e.req, "required"); eq(m.parking.provided, e.prov, "provided");
        eq(m.stairs.total, e.stairs, "stairs"); eq(m.elevators, e.elev, "elevators"); eq(m.height, e.height, "height");
      });
    }
  }
} else {
  console.log("  note src/midrise/assemble.js not found: assemble cases skipped");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
