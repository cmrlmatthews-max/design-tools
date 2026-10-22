// Run: node test/snap.test.mjs
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { collectSnapTargets, snapMove, snapEdge, snapLength, itemBox } = await import("../src/tower/snap.js");
const { buildPlates } = await import("../src/tower/geometry.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };

const rect = (w, d) => ({ type: "rect", w, d, radius: 0, points: [] });
const seg = (over = {}) => ({
  floors: 10, ftf: 10, program: "residential", shape: rect(100, 80), rotation: 0,
  offset: { x: 0, y: 0 }, taper: { x: 0, y: 0, curve: "linear" }, twist: { deg: 0, start: 0, end: 1, curve: "linear" },
  lean: { x: 0, y: 0 }, ...over,
});
function makeState(over = {}) {
  return {
    schema: 1, name: "snap test",
    site: { shape: "rect", width: 250, depth: 200, points: [],
      setbacks: { front: 10, back: 10, left: 10, right: 10 }, heightLimit: 0,
      stepback: { on: false, aboveHeight: 85, distance: 15 } },
    context: { show: true, blocks: [] },
    podium: { on: false, floors: 2, groundFtf: 18, ftf: 14, shape: rect(200, 150), offset: { x: 0, y: 0 },
      program: "retail", upperProgram: "amenity" },
    segments: [seg()],
    setbacks: [], mechanical: [], carves: [], cuts: [],
    crown: { type: "flat", height: 0, steps: 3, slopeSide: "front" },
    core: { mode: "percent", percent: 20, w: 40, d: 30 },
    ...over,
  };
}
const plan = (state) => buildPlates(state).plates;
const box = (minX, maxX, minY, maxY) => ({ minX, maxX, minY, maxY });
const TOL = 3;
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }

console.log("snap.test.mjs");

// Podium 200 x 150 centred: x in [-100, 100], y in [-75, 75]. Moving segment 0 (100 x 80) is excluded.
const podState = makeState({ podium: { ...makeState().podium, on: true } });
const podPlates = plan(podState);
const podTargets = collectSnapTargets(podState, podPlates, { exclude: { kind: "segment", index: 0 } });
const segBox = itemBox(podState, podPlates, { kind: "segment", index: 0 });   // [-50,50] x [-40,40]

t("itemBox: segment first-plate bbox and podium bbox", () => {
  near(segBox.minX, -50); near(segBox.maxX, 50); near(segBox.minY, -40); near(segBox.maxY, 40);
  const pb = itemBox(podState, podPlates, { kind: "podium" });
  near(pb.minX, -100); near(pb.maxY, 75);
});

t("1a. segment east edge snaps to the podium east edge within tolerance", () => {
  // raw: segment east edge 50 + 48.2 = 98.2 → podium east edge 100 (1.8 ft)
  const r = snapMove(segBox, { dx: 48.2, dy: 0.0 }, podTargets, { tolerance: TOL });
  near(r.dx, 50);
  const gx = r.guides.find((g) => g.axis === "x");
  eq(gx.kind, "podium"); eq(gx.label, "Podium east edge"); near(gx.value, 100);
});

t("1b. outside tolerance the edge does not snap (grid 0 → raw)", () => {
  const r = snapMove(segBox, { dx: 45.5, dy: 7.3 }, podTargets, { tolerance: TOL });
  // east edge 95.5 (4.5 from 100), centre 45.5, west -4.5 — nothing within 3 ft on x
  near(r.dx, 45.5);
  eq(r.guides.filter((g) => g.axis === "x").length, 0);
});

t("2. center-to-center snap (segment center to podium center)", () => {
  // podium centre (0,0); segment moved by (1.2, -0.9): centre within 3 ft, edges too far from any line
  const r = snapMove(segBox, { dx: 1.2, dy: -0.9 }, podTargets, { tolerance: TOL });
  near(r.dx, 0); near(r.dy, 0);
  const gx = r.guides.find((g) => g.axis === "x"), gy = r.guides.find((g) => g.axis === "y");
  eq(gx.label, "Podium center"); eq(gy.label, "Podium center"); eq(gx.feature, "center");
});

const plainState = makeState();
const plainTargets = collectSnapTargets(plainState, plan(plainState), { exclude: { kind: "segment", index: 0 } });

t("3. setback lines: rect site 250 x 200, 10 ft setbacks → x = ±115, y = ±90", () => {
  const sb = plainTargets.lines.filter((l) => l.kind === "setback");
  eq(sb.length, 4);
  const xs = sb.filter((l) => l.axis === "x").map((l) => l.value).sort((a, b) => a - b);
  const ys = sb.filter((l) => l.axis === "y").map((l) => l.value).sort((a, b) => a - b);
  near(xs[0], -115); near(xs[1], 115); near(ys[0], -90); near(ys[1], 90);
  // a segment dragged near the east setback line snaps to it
  const r = snapMove(box(-50, 50, -40, 40), { dx: 63.1, dy: 0 }, plainTargets, { tolerance: TOL });
  near(r.dx, 65);
  eq(r.guides[0].kind, "setback"); eq(r.guides[0].label, "East setback line");
});

t("4. site edge snap", () => {
  const site = plainTargets.lines.filter((l) => l.kind === "site");
  eq(site.length, 4);
  // north edge of the box 40 + 58 = 98 → site north edge 100
  const r = snapMove(box(-50, 50, -40, 40), { dx: 0.3, dy: 58 }, plainTargets, { tolerance: TOL });
  const gy = r.guides.find((g) => g.axis === "y");
  eq(gy.kind, "site"); eq(gy.label, "Site north edge"); near(r.dy, 60);
});

t("4b. polygon site: bbox edges plus inner axis-aligned edges", () => {
  const s = makeState();
  s.site = { ...s.site, shape: "polygon", points: [[-100, -80], [100, -80], [100, 20], [40, 20], [40, 80], [-100, 80]] };
  const lines = collectSnapTargets(s, [], { exclude: { kind: "segment", index: 0 } }).lines.filter((l) => l.kind === "site");
  const v = lines.map((l) => `${l.axis}${l.value}`).sort();
  ok(v.includes("x40") && v.includes("y20") && v.includes("x100") && v.includes("y80") && v.includes("x-100") && v.includes("y-80"), v.join(","));
  const sb = collectSnapTargets(s, []).lines.filter((l) => l.kind === "setback");
  eq(sb.length, 4);
});

t("5a. grid fallback (5 ft) when nothing else is near", () => {
  // a box far from every target line
  const r = snapMove(box(1000, 1030, 1000, 1020), { dx: 3.4, dy: -6.1 }, plainTargets, { tolerance: TOL, grid: 5 });
  near(r.dx, 5);            // min x 1003.4 → 1005
  near(r.dy, -5);           // min y 993.9 → 995
  eq(r.guides.length, 2); eq(r.guides[0].kind, "grid");
});

t("5b. grid 0 → raw delta", () => {
  const r = snapMove(box(1000, 1030, 1000, 1020), { dx: 3.4, dy: -6.1 }, plainTargets, { tolerance: TOL, grid: 0 });
  near(r.dx, 3.4); near(r.dy, -6.1); eq(r.guides.length, 0);
});

t("6a. tie-break: segment beats grid at equal distance", () => {
  const lines = [{ axis: "x", value: 52, kind: "segment", label: "Segment 2 west edge", from: 0, to: 10 }];
  // min edge 47.5: grid lines 45 and 50 are 2.5 away, and the segment line at 50 is 2.5 away too.
  const tieLines = [{ axis: "x", value: 50, kind: "segment", label: "Segment 2 west edge", from: 0, to: 10 }];
  const r = snapMove(box(0, 10, 500, 510), { dx: 47.5, dy: 0 }, tieLines, { tolerance: TOL, grid: 5 });
  near(r.dx, 50);
  eq(r.guides.find((g) => g.axis === "x").kind, "segment");
  // and a nearer line within tolerance always wins over grid
  const r2 = snapMove(box(0, 10, 500, 510), { dx: 50.1, dy: 0 }, lines, { tolerance: TOL, grid: 5 });
  near(r2.dx, 52); eq(r2.guides[0].kind, "segment");
});

t("6b. tie-break within 0.25 ft: segment > podium > context > setback > site", () => {
  const L = (kind, value) => ({ axis: "x", value, kind, label: kind, from: 0, to: 1 });
  const b = box(0, 10, 0, 10);
  // site exactly at 2.0, segment at 2.2 (0.2 farther): segment wins
  let r = snapMove(b, { dx: 0, dy: 0 }, [L("site", 2.0), L("segment", 2.2)], { tolerance: TOL });
  eq(r.guides[0].kind, "segment"); near(r.dx, 2.2);
  r = snapMove(b, { dx: 0, dy: 0 }, [L("setback", 2.0), L("context", 2.1), L("podium", 2.2)], { tolerance: TOL });
  eq(r.guides[0].kind, "podium");
  // beyond 0.25 ft the nearer line wins regardless of priority
  r = snapMove(b, { dx: 0, dy: 0 }, [L("site", 2.0), L("segment", 2.4)], { tolerance: TOL });
  eq(r.guides[0].kind, "site"); near(r.dx, 2.0);
});

t("7. exclude removes the moving item's own lines", () => {
  const s = makeState({ segments: [seg(), seg({ shape: rect(60, 40), offset: { x: 30, y: 50 } })] });
  const p = plan(s);
  const all = collectSnapTargets(s, p).lines;
  const ex0 = collectSnapTargets(s, p, { exclude: { kind: "segment", index: 0 } }).lines;
  eq(all.filter((l) => l.label.startsWith("Segment 1")).length, 6);
  eq(ex0.filter((l) => l.label.startsWith("Segment 1")).length, 0);
  eq(ex0.filter((l) => l.label.startsWith("Segment 2")).length, 6);
  const ps = makeState({ podium: { ...makeState().podium, on: true } });
  eq(collectSnapTargets(ps, plan(ps), { exclude: { kind: "podium", index: 0 } }).lines.filter((l) => l.kind === "podium").length, 0);
  const cs = makeState({ context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }, { x: 300, y: 0, w: 50, d: 50, h: 40 }] } });
  const cl = collectSnapTargets(cs, plan(cs), { exclude: { kind: "context", index: 0 } }).lines.filter((l) => l.kind === "context");
  eq(cl.length, 6); ok(cl.every((l) => l.label.startsWith("Context block 2")));
});

t("8. enabled:false returns the raw delta and no guides", () => {
  const r = snapMove(segBox, { dx: 48.2, dy: 1.1 }, podTargets, { tolerance: TOL, grid: 5, enabled: false });
  near(r.dx, 48.2); near(r.dy, 1.1); eq(r.guides.length, 0);
  const e = snapEdge(98.2, "x", podTargets, { tolerance: TOL, enabled: false });
  near(e.value, 98.2); eq(e.guide, null);
});

t("9a. snapEdge: resize edge snaps to a target, else grid, else raw", () => {
  let e = snapEdge(113.4, "x", plainTargets, { tolerance: TOL });
  near(e.value, 115); eq(e.guide.kind, "setback");
  e = snapEdge(88.6, "y", plainTargets, { tolerance: TOL, span: { from: -50, to: 50 } });
  near(e.value, 90); eq(e.guide.label, "North setback line");
  e = snapEdge(71.2, "x", plainTargets, { tolerance: TOL, grid: 5 });
  near(e.value, 70); eq(e.guide, null);              // grid without span → no guide
  e = snapEdge(71.2, "x", plainTargets, { tolerance: TOL, grid: 5, span: { from: 0, to: 20 } });
  near(e.value, 70); eq(e.guide.kind, "grid"); near(e.guide.from, 0); near(e.guide.to, 20);
  e = snapEdge(71.2, "x", plainTargets, { tolerance: TOL });
  near(e.value, 71.2); eq(e.guide, null);
});

t("9b. snapLength rounds to the step", () => {
  eq(snapLength(101.4), 101); eq(snapLength(101.5), 102); eq(snapLength(37.2, { step: 5 }), 35);
  eq(snapLength(0.3, { step: 0.5 }), 0.5); eq(snapLength(12.34, { step: 0 }), 12.34); eq(snapLength(-0.2), 0);
});

t("10. rotated segment uses its bbox", () => {
  // 100 x 80 rotated 90° → bbox 80 x 100: x in [-40, 40], y in [-50, 50]
  const s = makeState({ segments: [seg({ rotation: 90 }), seg({ shape: rect(40, 40), offset: { x: 100, y: 0 } })] });
  const p = plan(s);
  const b = itemBox(s, p, { kind: "segment", index: 0 });
  near(b.minX, -40, 1e-6); near(b.maxX, 40, 1e-6); near(b.minY, -50, 1e-6); near(b.maxY, 50, 1e-6);
  const lines = collectSnapTargets(s, p, { exclude: { kind: "segment", index: 1 } }).lines.filter((l) => l.label.startsWith("Segment 1"));
  const xs = lines.filter((l) => l.axis === "x").map((l) => Math.round(l.value)).sort((a, b) => a - b);
  eq(xs.join(","), "-40,0,40");
  // 45°: 100 x 80 → bbox half-width (100 + 80) / 2 / √2 = 63.64
  const s45 = makeState({ segments: [seg({ rotation: 45 })] });
  const b45 = itemBox(s45, plan(s45), { kind: "segment", index: 0 });
  near(b45.maxX, 90 / Math.SQRT2, 1e-6);
  // fallback without plates gives the same box
  const bf = itemBox(s45, [], { kind: "segment", index: 0 });
  near(bf.maxX, 90 / Math.SQRT2, 1e-6);
});

t("11. context block edges and centers are targets (and hidden context is not)", () => {
  const s = makeState({ context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] } });
  const lines = collectSnapTargets(s, plan(s), { exclude: { kind: "segment", index: 0 } }).lines.filter((l) => l.kind === "context");
  const vals = lines.map((l) => `${l.axis}${l.value}`).sort().join(",");
  eq(vals, ["x-100", "x0", "x100", "y-120", "y-180", "y-240"].sort().join(","));
  // segment south edge -40 dragged by -78.5 → -118.5 snaps to the block's north edge -120
  const r = snapMove(box(-50, 50, -40, 40), { dx: 0, dy: -78.5 }, { lines }, { tolerance: TOL });
  near(r.dy, -80); eq(r.guides.find((g) => g.axis === "y").label, "Context block 1 north edge");
  // block centre to block centre
  const r2 = snapMove(box(-10, 10, -10, 10), { dx: 1, dy: -181.5 }, { lines }, { tolerance: TOL });
  near(r2.dx, 0); near(r2.dy, -180);
  const hidden = makeState({ context: { show: false, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] } });
  eq(collectSnapTargets(hidden, plan(hidden)).lines.filter((l) => l.kind === "context").length, 0);
});

t("12. guides have from/to covering both the target and the moved box", () => {
  // short target line x = 100 from y 0..10; box moved to y 40..80 → guide 0..80
  const lines = [{ axis: "x", value: 100, kind: "segment", label: "Segment 2 west edge", from: 0, to: 10 },
    { axis: "y", value: -20, kind: "podium", label: "Podium south edge", from: -5, to: 5 }];
  const r = snapMove(box(0, 20, 0, 40), { dx: 79, dy: -19 }, lines, { tolerance: TOL });
  near(r.dx, 80); near(r.dy, -20);
  const gx = r.guides.find((g) => g.axis === "x"), gy = r.guides.find((g) => g.axis === "y");
  near(gx.from, -20); near(gx.to, 20);      // target 0..10, moved box y -20..20
  near(gy.from, -5); near(gy.to, 100);      // target -5..5, moved box x 80..100
  // grid guide spans the moved box
  const g = snapMove(box(1000, 1030, 1000, 1020), { dx: 3.4, dy: 0 }, [], { tolerance: TOL, grid: 5 });
  const gg = g.guides.find((q) => q.axis === "x");
  near(gg.from, 1000); near(gg.to, 1020);
});

t("pure: inputs are not mutated", () => {
  const s = deepFreeze(makeState({ podium: { ...makeState().podium, on: true },
    context: { show: true, blocks: [{ x: 0, y: -180, w: 200, d: 120, h: 60 }] } }));
  const p = plan(s);
  const tg = collectSnapTargets(s, p, { exclude: deepFreeze({ kind: "segment", index: 0 }) });
  deepFreeze(tg);
  const b = deepFreeze(box(-50, 50, -40, 40));
  const r = snapMove(b, deepFreeze({ dx: 48.2, dy: 0 }), tg, { tolerance: TOL, grid: 5 });
  near(r.dx, 50);
  snapEdge(98, "x", tg, { tolerance: TOL });
});

t("performance: collectSnapTargets + snapMove, 6 segments + 8 context blocks < 2 ms", () => {
  const segs = [];
  for (let i = 0; i < 6; i++) segs.push(seg({ floors: 8, shape: rect(80 - i * 8, 60 - i * 5), offset: { x: i * 3, y: -i * 2 }, rotation: i * 7 }));
  const blocks = [];
  for (let i = 0; i < 8; i++) blocks.push({ x: -300 + i * 80, y: (i % 2 ? 1 : -1) * 200, w: 60, d: 50, h: 40 });
  const s = makeState({ podium: { ...makeState().podium, on: true }, segments: segs, context: { show: true, blocks } });
  const p = plan(s);
  const run = () => {
    const tg = collectSnapTargets(s, p, { exclude: { kind: "segment", index: 2 } });
    return snapMove(box(-30, 30, -20, 20), { dx: 12.3, dy: -7.7 }, tg, { tolerance: TOL, grid: 5 });
  };
  for (let i = 0; i < 50; i++) run();   // warm up
  const N = 200;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) run();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  const tg = collectSnapTargets(s, p, { exclude: { kind: "segment", index: 2 } });
  console.log(`       ${tg.lines.length} lines, ${p.length} plates: ${ms.toFixed(3)} ms per collect + snap`);
  ok(ms < 2, `took ${ms} ms`);
});

t("Unlimited site (shape none): no site or setback lines; the other lines stay", () => {
  const s = makeState();
  s.site.shape = "none";
  const kinds = new Set(collectSnapTargets(s, buildPlates(s).plates).lines.map((l) => l.kind));
  ok(!kinds.has("site") && !kinds.has("setback"), "no site lines: " + [...kinds].join());
  ok(kinds.has("segment"), "segment lines stay");
  const r = snapMove(collectSnapTargets(s, []).lines, { minX: 118, maxX: 218, minY: -40, maxY: 40 }, { grid: 5 });
  ok(r && typeof r.dx === "number" && isFinite(r.dx), "snapMove still works");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
