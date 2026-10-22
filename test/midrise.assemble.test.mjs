// Run: node test/midrise.assemble.test.mjs
// Plan: docs/mid-rise-generator-technical-plan.md, section 9.1 tests 3 to 8, plus contract checks.
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { assemble } = await import("../src/midrise/assemble.js");
const { collectBarSnapTargets, barBox, midriseItemBox } = await import("../src/midrise/snaptargets.js");
const { snapMove, snapEdge } = await import("../src/tower/snap.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 0.1, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

function signedArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const mpArea = (mp) => mp.reduce((s, p) => s + Math.abs(signedArea(p.outer)) - p.holes.reduce((h, r) => h + Math.abs(signedArea(r)), 0), 0);

function deepFreeze(o) {
  if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

const PROGRAMS = {
  residential: { ftf: 10, unitSize: 850, unitFactor: 0.85, unitWidth: 28, parkingRatio: 1.25, color: "#4f7fd1" },
  retail: { ftf: 16, unitSize: null, unitFactor: null, unitWidth: null, parkingRatio: 3, color: "#d9a22b" },
  parking: { ftf: 10.5, unitSize: 330, unitFactor: 1, unitWidth: null, parkingRatio: 0, color: "#8b929a" },
};
const RULES = { corridorWidth: 5.67, breezewayWidth: 8, stairPer: 250, elevatorPer: 100, cornerLoss: 1, constructionHints: [] };

const bar = (id, x, y, angle, length, over = {}) => ({
  id, name: `Bar ${id}`, x, y, angle, length, depth: 65, floors: 5,
  program: "residential", groundProgram: null, corridor: "double", unitSide: "left",
  ends: { start: "stair", end: "stair" }, bends: [], unitWidth: null, ...over,
});

function makeState(bars, over = {}) {
  return {
    schema: 1, name: "assemble test", type: "bar",
    site: { shape: "rect", width: 800, depth: 800, points: [], setbacks: { front: 20, back: 20, left: 20, right: 20 },
      heightLimit: 0, stepback: { on: false, aboveHeight: 85, distance: 15 },
      densityCap: 0, openSpaceShare: 0, separationMin: 20, courtyardMin: 40 },
    placement: null,
    context: { show: true, fromSite: false, blocks: [] },
    floors: { groundFtf: 12, ftf: 10 },
    bars,
    courts: [],
    deck: { on: false, x: 0, y: 0, w: 300, d: 125, levels: 5, ftf: 10.5, openTop: true },
    podium: { on: false, levels: [{ ftf: 11, program: "parking" }], footprint: { mode: "allowed", percent: 100, offset: 0 },
      liner: { on: false, side: "front", depth: 40 } },
    surface: { count: 0, lot: [] },
    programs: PROGRAMS,
    parking: { sfPerStallSurface: 350, sfPerStallDeck: 330, retailPerThousand: 3 },
    rules: RULES,
    roof: { type: "parapet", height: 4 },
    targets: { units: 0, density: 0 },
    view: { style: "model", colorBy: "program", snap: { on: true, grid: 5 } },
    ...over,
  };
}

const barLevelsOf = (built) => built.levels.filter((l) => l.zone === "bar");

console.log("midrise assemble");

/* ---- test 3: L joint ---- */
t("3 L joint: area 26,975, exactly 6 vertices, one L, 1 inside corner", () => {
  // A: x 0..240, y -32.5..32.5. B: x 0..65, y -32.5..207.5. Shared 65 x 65 corner.
  const s = makeState([bar("A", 0, 0, 0, 240), bar("B", 32.5, -32.5, 90, 240)]);
  const b = assemble(s);
  const lv = barLevelsOf(b)[0];
  eq(lv.plates.length, 1, "pieces");
  near(mpArea(lv.plates), 240 * 65 + 240 * 65 - 65 * 65, 0.01, "area");
  eq(lv.plates[0].outer.length, 6, "vertices");
  eq(lv.plates[0].holes.length, 0, "holes");
  ok(signedArea(lv.plates[0].outer) > 0, "outer counter-clockwise");
  eq(b.joints.length, 1, "joints");
  eq(b.joints[0].type, "L");
  eq(b.joints[0].insideCorners, 1);
  near(Math.abs(signedArea(b.joints[0].zone.outer)), 4225, 0.01, "corner zone");
  eq(JSON.stringify(b.joints[0].node), JSON.stringify([32.5, 0]), "node");
  eq(lv.joints.length, 1, "level joints");
  eq(lv.cornerZones.length, 1, "level corner zones");
  // spine graph: two end nodes per bar minus none, plus one joint node; edges sum to the spine lengths
  const nodes = b.spineGraph.nodes;
  eq(nodes.filter((n) => n.kind === "joint").length, 1, "joint nodes");
  eq(nodes.filter((n) => n.kind === "end").length, 4, "end nodes");
  const sum = b.spineGraph.edges.reduce((a, e) => a + e.length, 0);
  near(sum, 480, 0.001, "edge length sum");
});

/* ---- test 4: T joint ---- */
t("4 T joint: area 25,025, T, 2 inside corners", () => {
  // A: (-150, 0) east, 300 long. B: starts on A's south edge (0, -32.5), runs north 150.
  const s = makeState([bar("A", -150, 0, 0, 300), bar("B", 0, -32.5, 90, 150)]);
  const b = assemble(s);
  const lv = barLevelsOf(b)[0];
  eq(lv.plates.length, 1);
  near(mpArea(lv.plates), 19500 + 9750 - 4225, 0.01, "area");
  eq(lv.plates[0].outer.length, 8, "vertices");
  eq(b.joints.length, 1);
  eq(b.joints[0].type, "T");
  eq(b.joints[0].insideCorners, 2);
});

/* ---- test 5: cross joint ---- */
t("5 cross joint: area 34,775, cross, 4 inside corners", () => {
  const s = makeState([bar("A", -150, 0, 0, 300), bar("B", 0, -150, 90, 300)]);
  const b = assemble(s);
  const lv = barLevelsOf(b)[0];
  eq(lv.plates.length, 1);
  near(mpArea(lv.plates), 19500 + 19500 - 4225, 0.01, "area");
  eq(lv.plates[0].outer.length, 12, "vertices");
  eq(b.joints.length, 1);
  eq(b.joints[0].type, "cross");
  eq(b.joints[0].insideCorners, 4);
  eq(JSON.stringify(b.joints[0].node), JSON.stringify([0, 0]), "node");
});

/* ---- test 6: touch joint ---- */
t("6 touch joint: 0.4 ft gap between a bar end and a bar side joins into one polygon", () => {
  // A's north edge is y = 32.5. B starts at y = 32.9 and runs north: a 0.4 ft gap.
  const s = makeState([bar("A", -150, 0, 0, 300), bar("B", 0, 32.9, 90, 150)]);
  const b = assemble(s);
  const lv = barLevelsOf(b)[0];
  eq(b.joints.length, 1, "joints");
  eq(b.joints[0].type, "T", "type");
  eq(lv.plates.length, 1, "one polygon");
  eq(lv.plates[0].holes.length, 0, "no holes");
  near(mpArea(lv.plates), 19500 + 9750 + 0.4 * 65, 0.01, "area with the gap filled");
  eq(lv.plates[0].outer.length, 8, "vertices (rectangular corners kept)");
  // the ending spine is extended to the through spine: node at (0, 0)
  eq(JSON.stringify(b.joints[0].node), JSON.stringify([0, 0]), "node");
  const bEdges = b.spineGraph.edges.filter((e) => e.barId === "B");
  near(bEdges.reduce((a, e) => a + e.length, 0), 150 + 32.9, 0.001, "B spine extended to the node");
  eq(b.separation.length, 0, "joined bars have no separation entry");
});

t("6b gap of 0.6 ft does not join", () => {
  const s = makeState([bar("A", -150, 0, 0, 300), bar("B", 0, 33.1, 90, 150)]);
  const b = assemble(s);
  eq(b.joints.length, 0);
  eq(barLevelsOf(b)[0].plates.length, 2, "two polygons");
  near(b.separation[0].distance, 0.6, 0.001, "separation");
});

/* ---- test 7: preset 8.4 courtyard ---- */
function courtyardState() {
  return makeState([
    bar("S", -125, -77.5, 0, 250),
    bar("N", -125, 77.5, 0, 250),
    bar("W", -92.5, -110, 90, 220, { ends: { start: "open", end: "open" } }),
    bar("E", 92.5, -110, 90, 220, { ends: { start: "open", end: "open" } }),
  ], {
    type: "courtyard",
    site: { shape: "rect", width: 330, depth: 330, points: [], setbacks: { front: 20, back: 20, left: 20, right: 20 },
      heightLimit: 0, stepback: { on: false, aboveHeight: 85, distance: 15 },
      densityCap: 0, openSpaceShare: 0, separationMin: 20, courtyardMin: 40 },
    podium: { on: true, levels: [{ ftf: 11, program: "parking" }], footprint: { mode: "offset", percent: 100, offset: 0 },
      liner: { on: false, side: "front", depth: 40 } },
    surface: { count: 120, lot: [] },
  });
}

t("7 preset 8.4: one hole of 10,800 sf, smallest dimension 90, four joints", () => {
  const s = courtyardState();
  const b = assemble(s);
  const closed = b.courtyards.filter((c) => c.kind === "closed");
  eq(closed.length, 1, "closed courtyards");
  near(closed[0].area, 10800, 0.1, "hole area");
  near(closed[0].minDim, 90, 0.001, "min dimension");
  eq(b.joints.length, 4, "joints");
  ok(b.joints.every((j) => j.type === "L" && j.insideCorners === 1), "four L joints");
  const lv = barLevelsOf(b);
  eq(lv.length, 5, "bar levels");
  eq(lv[0].index, 2, "bar levels start after the podium");
  for (const l of lv) {
    eq(l.plates.length, 1);
    eq(l.plates[0].holes.length, 1);
    ok(signedArea(l.plates[0].holes[0]) < 0, "hole clockwise");
    near(mpArea(l.plates), 44200, 0.01, "union per bar level");
    eq(l.barIds.join(","), "S,N,W,E");
  }
  const pod = b.levels.find((l) => l.zone === "podium");
  near(mpArea(pod.plates), 55000, 0.01, "podium = bar bounding box 250 x 220");
  eq(b.separation.length, 2, "S-N and W-E pairs");
  eq(b.warnings.length, 0, "no warnings: " + JSON.stringify(b.warnings));
  // tower-shaped plates for envelope.js
  eq(b.plates.length, 6);
  const p2 = b.plates[1];
  eq(p2.n, 2); eq(p2.zone, "bar"); eq(p2.coreArea, 0); eq(p2.coreRect, null); eq(p2.outsideEnvelopeArea, 0);
  near(p2.area, 44200, 0.1);
});

/* ---- test 8: separation ---- */
t("8 two parallel bars 84 ft apart on centerline: separation 19 ft, one warning at 20", () => {
  const s = makeState([bar("A", -150, -42, 0, 300), bar("B", -150, 42, 0, 300)]);
  const b = assemble(s);
  eq(b.joints.length, 0);
  eq(b.separation.length, 1);
  near(b.separation[0].distance, 19, 0.001);
  eq(b.separation[0].barIds.join(","), "A,B");
  const w = b.warnings.filter((x) => x.code === "separation");
  eq(w.length, 1, "separation warnings");
  eq(b.warnings.length, 1, "only that warning");
  ok(/19 ft/.test(w[0].message) && /20 ft/.test(w[0].message), w[0].message);
  eq(w[0].severity, "warn");
  ok(Array.isArray(w[0].floors));
});

/* ---- contract checks ---- */
t("draft quality skips the union: one Poly per leg ring", () => {
  const s = makeState([bar("A", 0, 0, 0, 240), bar("B", 32.5, -32.5, 90, 240, { bends: [{ at: 120, deg: -90 }] })]);
  const b = assemble(s, { quality: "draft" });
  eq(b.quality, "draft");
  eq(barLevelsOf(b)[0].plates.length, 3, "1 + 2 legs");
  eq(b.joints.length, 0);
  eq(b.separation.length, 0);
  const full = assemble(s);
  eq(full.quality, "full");
  eq(barLevelsOf(full)[0].plates.length, 1);
});

t("draft runs without Clipper", () => {
  const saved = globalThis.ClipperLib;
  try {
    globalThis.ClipperLib = undefined;
    const b = assemble(makeState([bar("A", -150, 0, 0, 300)]), { quality: "draft" });
    eq(barLevelsOf(b).length, 5);
    let threw = false;
    try { assemble(makeState([bar("A", -150, 0, 0, 300)])); } catch (e) { threw = /ClipperLib/.test(e.message); }
    ok(threw, "full quality names ClipperLib");
  } finally { globalThis.ClipperLib = saved; }
});

t("a bent bar unions to its exact area (bend miter closes the corner)", () => {
  // 300 x 65 with a 90-degree bend at 120: 152.5 x 65 + 212.5 x 65 - 65 x 65 = 19,500
  const b = assemble(makeState([bar("A", -150, 0, 0, 300, { bends: [{ at: 120, deg: 90 }] })]));
  const lv = barLevelsOf(b)[0];
  eq(lv.plates.length, 1);
  near(mpArea(lv.plates), 19500, 0.01);
  eq(lv.plates[0].outer.length, 6);
  eq(b.joints.length, 0, "one bar's legs do not join");
  // spine graph: one edge through the bend, two points per drawing piece
  eq(b.spineGraph.edges.length, 1);
  eq(b.spineGraph.edges[0].points.length, 3);
  eq(lv.spines.length, 2);
});

t("levels: podium, bar, deck in list order; shorter bars stop early", () => {
  const s = makeState([bar("A", -150, -100, 0, 300, { floors: 5 }), bar("B", -150, 100, 0, 300, { floors: 3 })], {
    podium: { on: true, levels: [{ ftf: 16, program: "parking" }, { ftf: 11, program: "parking" }],
      footprint: { mode: "allowed", percent: 100, offset: 0 }, liner: { on: false, side: "front", depth: 40 } },
    deck: { on: true, x: 0, y: 0, w: 300, d: 125, levels: 2, ftf: 10.5, openTop: true },
  });
  const b = assemble(s);
  eq(b.levels.map((l) => l.zone).join(","), "podium,podium,bar,bar,bar,bar,bar,deck,deck");
  eq(b.levels.map((l) => l.index).join(","), "1,2,3,4,5,6,7,8,9");
  eq(b.levels[2].z, 27); eq(b.levels[2].ftf, 12); eq(b.levels[3].z, 39);
  eq(b.levels[4].barIds.join(","), "A,B");
  eq(b.levels[5].barIds.join(","), "A");
  eq(b.levels[5].plates.length, 1);
  near(mpArea(b.levels[5].plates), 19500, 0.01);
  near(mpArea(b.levels[0].plates), 760 * 760, 0.01, "allowed footprint 100 percent");
  near(mpArea(b.levels[7].plates), 37500, 0.01, "deck rectangle");
  eq(b.levels[7].z, 27, "deck starts on the podium top");
  eq(b.levels[7].barIds.length, 0);
  // bar B over the deck? The deck sits between the bars: no warning expected
  eq(b.warnings.length, 0, JSON.stringify(b.warnings));
});

t("podium allowed mode: percent is a share of the allowed area", () => {
  const s = makeState([bar("A", -150, 0, 0, 300)], {
    podium: { on: true, levels: [{ ftf: 11, program: "parking" }], footprint: { mode: "allowed", percent: 64, offset: 0 },
      liner: { on: false, side: "front", depth: 40 } },
  });
  const b = assemble(s);
  near(mpArea(b.levels[0].plates), 0.64 * 760 * 760, 1, "area");
});

t("open courts: area, min dim, warnings for a narrow court and a bar over it", () => {
  const s = makeState([bar("A", -150, 0, 0, 300)], {
    courts: [{ id: "C1", x: 0, y: 40, w: 170, d: 35 }],
  });
  const b = assemble(s);
  const open = b.courtyards.filter((c) => c.kind === "open");
  eq(open.length, 1);
  eq(open[0].id, "C1"); near(open[0].area, 5950, 0.01); near(open[0].minDim, 35, 0.001);
  const codes = b.warnings.map((w) => w.code).sort();
  eq(codes.join(","), "bar-over-court,courtyard");
});

t("closed courtyard under the minimum warns", () => {
  const s = courtyardState();
  const b = assemble({ ...s, site: { ...s.site, courtyardMin: 100 } });
  const w = b.warnings.filter((x) => x.code === "courtyard");
  eq(w.length, 1);
  ok(/90 ft/.test(w[0].message), w[0].message);
});

t("warnings: sliver, bar outside the site, envelope setbacks and height", () => {
  const s = makeState([bar("A", -150, 0, 0, 300), bar("C", -420, 300, 0, 50)], {
    site: { shape: "rect", width: 800, depth: 800, points: [], setbacks: { front: 20, back: 20, left: 20, right: 20 },
      heightLimit: 40, stepback: { on: false, aboveHeight: 85, distance: 15 },
      densityCap: 0, openSpaceShare: 0, separationMin: 20, courtyardMin: 40 },
  });
  const b = assemble(s);
  const codes = new Set(b.warnings.map((w) => w.code));
  ok(codes.has("sliver"), "sliver");
  ok(codes.has("bar-outside-site"), "outside site");
  ok(codes.has("setback"), "setback (envelope)");
  ok(codes.has("height"), "height (envelope)");
  ok(b.plates.some((p) => p.outsideEnvelopeArea > 0), "plates carry outsideEnvelopeArea");
});

t("roof screen adds a prism on the top of each bar group", () => {
  const s = makeState([bar("A", -150, -100, 0, 300, { floors: 5 }), bar("B", -150, 100, 0, 300, { floors: 3 })], {
    roof: { type: "screen", height: 8 },
  });
  const b = assemble(s);
  eq(b.solids.length, 2);
  const a = b.solids.find((x) => x.z0 === 52);
  ok(a && a.z1 === 60 && a.kind === "prism" && a.role === "screen", JSON.stringify(b.solids.map((x) => [x.z0, x.z1])));
  ok(b.solids.some((x) => x.z0 === 32 && x.z1 === 40));
  eq(assemble(makeState([bar("A", -150, 0, 0, 300)])).solids.length, 0, "parapet adds none");
});

t("single-loaded spine shifts toward the corridor side", () => {
  const b = assemble(makeState([bar("A", -150, 0, 0, 300, { corridor: "single", unitSide: "left" })]));
  const e = b.spineGraph.edges[0];
  near(e.points[0][1], -(32.5 - 5.67 / 2), 0.001, "shift to the right side");
});

t("no mutation of the input state; clear errors", () => {
  const s = deepFreeze(courtyardState());
  const before = JSON.stringify(s);
  assemble(s);
  assemble(s, { quality: "draft" });
  eq(JSON.stringify(s), before);
  let m = "";
  try { assemble(); } catch (e) { m = e.message; }
  ok(/state/.test(m), m);
  try { assemble({ site: {}, floors: {} }); } catch (e) { m = e.message; }
  ok(/state\.bars/.test(m), m);
});

t("every ring is clean: no repeated points, outers CCW, holes CW, 0.001 ft grid", () => {
  const b = assemble(courtyardState());
  for (const l of b.levels) for (const p of l.plates) {
    ok(signedArea(p.outer) > 0);
    for (const h of p.holes) ok(signedArea(h) < 0);
    for (const r of [p.outer, ...p.holes]) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], c = r[(i + 1) % r.length];
        ok(a[0] !== c[0] || a[1] !== c[1], "repeated point");
        ok(Math.abs(a[0] * 1000 - Math.round(a[0] * 1000)) < 1e-6, "grid");
      }
    }
  }
});

/* ---- snaptargets ---- */
console.log("midrise snaptargets");

t("collectBarSnapTargets: site, setback, other bars (edges + centers), deck, court; own bar excluded", () => {
  const s = makeState([bar("A", -150, -100, 0, 300), bar("B", -150, 100, 0, 300)], {
    deck: { on: true, x: 0, y: 0, w: 200, d: 60, levels: 2, ftf: 10.5, openTop: true },
    courts: [{ id: "C1", x: 0, y: 250, w: 100, d: 50 }],
    context: { show: true, fromSite: false, blocks: [{ x: 0, y: -500, w: 200, d: 120, h: 40 }] },
  });
  const built = assemble(s);
  const { lines } = collectBarSnapTargets(s, built, { exclude: { kind: "bar", id: "A" } });
  ok(lines.every((l) => (l.axis === "x" || l.axis === "y") && Number.isFinite(l.value) && typeof l.kind === "string"
    && typeof l.label === "string" && Number.isFinite(l.from) && Number.isFinite(l.to)), "line shape");
  const by = (src) => lines.filter((l) => l.source === src);
  eq(by("site").length, 4, "site");
  eq(by("setback").length, 4, "setback");
  eq(by("bar").length, 6, "bar B edges + centers only");
  ok(by("bar").every((l) => l.kind === "segment" && l.id === "B"), "bar lines use kind segment");
  eq(by("deck").length, 4, "deck edges");
  ok(by("deck").every((l) => l.kind === "podium"));
  eq(by("court").length, 4, "court edges");
  eq(by("context").length, 6, "context edges + centers");
  ok(lines.some((l) => l.axis === "y" && l.value === 132.5 && l.label === "Bar B north edge"));
});

t("snap.js consumes the lines unchanged: a bar move snaps to another bar's edge", () => {
  const s = makeState([bar("A", -150, -100, 0, 300), bar("B", -150, 100, 0, 300)]);
  const built = assemble(s);
  const targets = collectBarSnapTargets(s, built, { exclude: { kind: "bar", id: "A" } });
  const box = barBox(s, built, "A");
  eq(JSON.stringify(box), JSON.stringify({ minX: -150, maxX: 150, minY: -132.5, maxY: -67.5 }));
  // drag A north by 133.8: its north edge lands at 66.3, 1.2 ft short of B's south edge at 67.5
  const r = snapMove(box, { dx: 0, dy: 133.8 }, targets, { tolerance: 2, grid: 5 });
  near(r.dy, 135, 1e-9, "A's north edge meets B's south edge");
  eq(r.guides.find((g) => g.axis === "y").kind, "segment");
  const e = snapEdge(66.4, "y", targets, { tolerance: 2 });
  eq(e.value, 67.5);
  eq(e.guide.label, "Bar B south edge");
});

t("exclude accepts an index or a list; barBox null for an unknown bar", () => {
  const s = makeState([bar("A", -150, -100, 0, 300), bar("B", -150, 100, 0, 300)]);
  const built = assemble(s);
  eq(collectBarSnapTargets(s, built, { exclude: { kind: "bar", index: 1 } }).lines.filter((l) => l.source === "bar" && l.id === "B").length, 0);
  eq(collectBarSnapTargets(s, built, { exclude: [{ kind: "bar", id: "A" }, { kind: "bar", id: "B" }] }).lines.filter((l) => l.source === "bar").length, 0);
  eq(collectBarSnapTargets(s, built).lines.filter((l) => l.source === "bar").length, 12);
  eq(barBox(s, built, "Z"), null);
  eq(JSON.stringify(midriseItemBox(s, built, { kind: "court", index: 0 })), "null");
  const hidden = { ...s, context: { show: false, blocks: [{ x: 0, y: 0, w: 10, d: 10 }] } };
  eq(collectBarSnapTargets(hidden, built).lines.filter((l) => l.source === "context").length, 0, "hidden context");
});

/* ---- Unlimited site (site.shape "none") ---- */
console.log("Unlimited site");
const { computeMetrics } = await import("../src/midrise/metrics.js");
const noSite = (bars, over = {}, siteOver = {}) => {
  const s = makeState(bars, over);
  Object.assign(s.site, { shape: "none", densityCap: 80, openSpaceShare: 0.3 }, siteOver);
  return s;
};
const siteCodes = ["bar-outside-site", "setback", "stepback", "density-cap", "open-space"];
t("none: a bar far outside the old site draws no site or setback warning, and no plate is outside", () => {
  const s = noSite([bar("A", 900, 900, 0, 300)], {}, { stepback: { on: true, aboveHeight: 10, distance: 200 } });
  const b = assemble(s);
  eq(b.warnings.filter((w) => siteCodes.includes(w.code)).length, 0, JSON.stringify(b.warnings));
  ok(b.plates.every((p) => p.outsideEnvelopeArea === 0), "outsideEnvelopeArea");
  // the same bar on a rectangle does warn
  const r = makeState([bar("A", 900, 900, 0, 300)]);
  ok(assemble(r).warnings.some((w) => w.code === "bar-outside-site"), "rect warns");
});
t("none: building to building checks and the height limit stay", () => {
  const s = noSite([bar("A", 0, 0, 0, 300), bar("B", 0, 75, 0, 300)], {}, { heightLimit: 30 });
  const b = assemble(s);
  const codes = b.warnings.map((w) => w.code);
  ok(codes.includes("separation"), "separation " + codes);
  ok(codes.includes("height"), "height " + codes);
  eq(assemble(noSite([bar("A", 0, 0, 0, 300), bar("B", 0, 75, 0, 300)], {}, { heightLimit: 0 })).warnings.some((w) => w.code === "height"), false, "limit 0");
});
t("none: an allowed-footprint podium follows the bars instead of vanishing", () => {
  const s = noSite([bar("A", 0, 0, 0, 300)], { podium: { on: true, levels: [{ ftf: 11, program: "parking" }], footprint: { mode: "allowed", percent: 100, offset: 0 }, liner: { on: false, side: "front", depth: 40 } } });
  const b = assemble(s);
  const pod = b.levels.find((l) => l.zone === "podium");
  near(mpArea(pod.plates), 300 * 65, 0.5, "podium = bar box");
});
t("none: metrics show no site and have no NaN or Infinity; no density or open space warning", () => {
  const s = noSite([bar("A", 0, 0, 0, 300)]);
  const m = computeMetrics(s, assemble(s));
  eq(m.hasSite, false); eq(m.siteArea, 0); eq(m.siteAcres, 0); eq(m.density, 0); eq(m.far, 0); eq(m.siteCoverage, 0);
  const bad = [];
  (function walk(o, p) { for (const [k, v] of Object.entries(o || {})) { if (typeof v === "number" && !isFinite(v)) bad.push(p + k); else if (v && typeof v === "object") walk(v, p + k + "."); } })(m, "");
  eq(bad.join(), "");
  eq(m.warnings.filter((w) => w.code === "density-cap" || w.code === "open-space").length, 0);
  eq(m.openSpace.ok, true);
  // the same design on a small rectangle does report all of them
  const r = makeState([bar("A", 0, 0, 0, 300)]);
  Object.assign(r.site, { width: 400, depth: 300, densityCap: 5, openSpaceShare: 0.9 });
  const mr = computeMetrics(r, assemble(r));
  eq(mr.hasSite, true); ok(mr.density > 0 && mr.far > 0);
  ok(mr.warnings.some((w) => w.code === "density-cap") && mr.warnings.some((w) => w.code === "open-space"), "rect warns");
});
t("none: snap targets have no site or setback lines", () => {
  const s = noSite([bar("A", 0, 0, 0, 300)]);
  const lines = collectBarSnapTargets(s, assemble(s)).lines;
  eq(lines.filter((l) => l.source === "site" || l.source === "setback").length, 0);
  ok(lines.some((l) => l.source === "bar"), "bar lines stay");
});
t("a site with no shape (old file) is still a rectangle", () => {
  const s = makeState([bar("A", 900, 900, 0, 300)]);
  delete s.site.shape;
  ok(assemble(s).warnings.some((w) => w.code === "bar-outside-site"));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
