// Run: node test/envelope.test.mjs
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)(
  "clipper-lib");

const { allowedFootprint, envelopeWireframe, checkEnvelope, describeFloors } =
  await import("../src/tower/envelope.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const near = (a, b, tol = 0.01, m = "") => { if (Math.abs(a - b) > tol) throw new Error(`${m} expected ${b}, got ${a}`); };

function mpArea(mp) {
  let a = 0;
  const sa = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
  for (const p of mp) { a += Math.abs(sa(p.outer)); for (const h of p.holes) a -= Math.abs(sa(h)); }
  return a;
}
function rectPoly(x0, y0, x1, y1) { return [{ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }]; }
function plate(n, z, ftf, polygons, extra = {}) {
  return { n, zone: "tower", program: "residential", segmentIndex: 0, z, ftf, polygons,
    area: mpArea(polygons), coreArea: 0, coreRect: null, outsideEnvelopeArea: 0, ...extra };
}
function baseState(over = {}) {
  return {
    site: { shape: "rect", width: 250, depth: 200, points: [],
      setbacks: { front: 10, back: 10, left: 10, right: 10 }, heightLimit: 0,
      stepback: { on: false, aboveHeight: 85, distance: 15 }, ...over },
  };
}
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }

console.log("envelope.test.mjs");

t("rect site: allowed area after 10 ft setbacks = 230 x 180", () => {
  near(mpArea(allowedFootprint(baseState(), 0)), 230 * 180);
});

t("rect site: per-side setbacks are exact (front -y, back +y, left -x, right +x)", () => {
  const s = baseState({ setbacks: { front: 20, back: 5, left: 8, right: 12 } });
  const mp = allowedFootprint(s, 0);
  const xs = mp[0].outer.map((p) => p[0]), ys = mp[0].outer.map((p) => p[1]);
  near(Math.min(...xs), -125 + 8); near(Math.max(...xs), 125 - 12);
  near(Math.min(...ys), -100 + 20); near(Math.max(...ys), 100 - 5);
});

t("setbacks larger than the site give an empty footprint", () => {
  const s = baseState({ setbacks: { front: 120, back: 120, left: 0, right: 0 } });
  eq(allowedFootprint(s, 0).length, 0);
  const r = checkEnvelope(s, [plate(1, 0, 10, rectPoly(-10, -10, 10, 10))]);
  near(r.outside.get(1), 400);
});

t("plate exactly inside the allowed footprint -> 0 outside, no warnings", () => {
  const s = baseState();
  const r = checkEnvelope(s, [plate(1, 0, 10, rectPoly(-115, -90, 115, 90))]);
  near(r.outside.get(1), 0);
  eq(r.plates[0].outsideEnvelopeArea, 0);
  eq(r.warnings.length, 0);
});

t("plate 5 ft over the front setback -> outside = 5 x width", () => {
  const s = baseState();
  const r = checkEnvelope(s, [plate(1, 0, 10, rectPoly(-115, -95, 115, 90))]);
  near(r.outside.get(1), 5 * 230);
  eq(r.warnings.length, 1);
  eq(r.warnings[0].code, "setback");
  eq(r.warnings[0].message, "Floor 1 extends past the setbacks.");
});

t("plate with a hole: hole inside the allowed area does not add outside area", () => {
  const poly = [{ outer: [[-100, -80], [100, -80], [100, 80], [-100, 80]],
    holes: [[[-10, -10], [-10, 10], [10, 10], [10, -10]]] }];
  const r = checkEnvelope(baseState(), [plate(1, 0, 10, poly)]);
  near(r.outside.get(1), 0);
});

t("tower 1 ft over the height limit -> height warning on the right floor only", () => {
  const s = baseState({ heightLimit: 99 });
  const plates = [];
  for (let i = 0; i < 10; i++) plates.push(plate(i + 1, i * 10, 10, rectPoly(-50, -50, 50, 50)));
  const r = checkEnvelope(s, plates);
  eq(r.warnings.length, 1);
  eq(r.warnings[0].code, "height");
  eq(r.warnings[0].severity, "error");
  eq(JSON.stringify(r.warnings[0].floors), "[10]");
  eq(r.warnings[0].message, "Floor 10 exceeds the height limit.");
  // exactly at the limit is fine
  const r2 = checkEnvelope(baseState({ heightLimit: 100 }), plates);
  eq(r2.warnings.length, 0);
  // heightLimit 0 = no limit
  eq(checkEnvelope(baseState({ heightLimit: 0 }), plates).warnings.length, 0);
});

t("height grouping: floors 31-34 -> en-dash range text", () => {
  const s = baseState({ heightLimit: 300 }); // floors with top > 300 : floors 30..
  const plates = [];
  for (let i = 0; i < 34; i++) plates.push(plate(i + 1, i * 10, 10, rectPoly(-50, -50, 50, 50)));
  // top of floor n = 10n; > 300.01 -> floors 31..34
  const r = checkEnvelope(s, plates);
  eq(r.warnings[0].message, "Floors 31–34 exceed the height limit.");
});

t("setback grouping: floors 12-20", () => {
  const plates = [];
  for (let n = 1; n <= 25; n++) {
    const wide = n >= 12 && n <= 20;
    plates.push(plate(n, (n - 1) * 10, 10, wide ? rectPoly(-120, -50, 120, 50) : rectPoly(-50, -50, 50, 50)));
  }
  const r = checkEnvelope(baseState(), plates);
  eq(r.warnings.length, 1);
  eq(r.warnings[0].message, "Floors 12–20 extend past the setbacks.");
  eq(r.warnings[0].floors.length, 9);
});

t("describeFloors: groups, singles, mixed", () => {
  eq(describeFloors([31, 32, 33, 34, 40]), "Floors 31–34 and 40");
  eq(describeFloors([5]), "Floor 5");
  eq(describeFloors([9, 10]), "Floors 9–10");
  eq(describeFloors([3, 4, 8, 12, 13]), "Floors 3–4, 8 and 12–13");
  eq(describeFloors([5, 9]), "Floors 5 and 9");
});

t("stepback triggers only above aboveHeight", () => {
  const s = baseState({ stepback: { on: true, aboveHeight: 85, distance: 15 } });
  // allowed: base 230x180 below 85, 200x150 above
  near(mpArea(allowedFootprint(s, 84)), 230 * 180);
  near(mpArea(allowedFootprint(s, 85)), 230 * 180);
  near(mpArea(allowedFootprint(s, 85.5)), 200 * 150);
  // 12 floors of 10 ft, each 210 x 160: inside base, outside stepback footprint
  const plates = [];
  for (let n = 1; n <= 12; n++) plates.push(plate(n, (n - 1) * 10, 10, rectPoly(-105, -80, 105, 80)));
  const r = checkEnvelope(s, plates);
  // floors 1-8 top <= 80 fine; floor 9 spans 80-90 (straddles 85) -> stepback applies
  eq(r.warnings.length, 1);
  eq(r.warnings[0].code, "stepback");
  eq(r.warnings[0].message, "Floors 9–12 extend past the stepback.");
  for (let n = 1; n <= 8; n++) near(r.outside.get(n), 0, 0.01, "floor " + n);
  // floor 9: 210x160 - 200x150 = 33600 - 30000
  near(r.outside.get(9), 210 * 160 - 200 * 150);
});

t("stepback: a floor whose top is exactly aboveHeight is NOT stepped", () => {
  const s = baseState({ stepback: { on: true, aboveHeight: 90, distance: 15 } });
  const r = checkEnvelope(s, [plate(9, 80, 10, rectPoly(-105, -80, 105, 80)),
                              plate(10, 90, 10, rectPoly(-105, -80, 105, 80))]);
  near(r.outside.get(9), 0);
  near(r.outside.get(10), 210 * 160 - 200 * 150);
});

t("stepback off: no stepback warning even above aboveHeight", () => {
  const plates = [plate(1, 100, 10, rectPoly(-105, -80, 105, 80))];
  eq(checkEnvelope(baseState(), plates).warnings.length, 0);
});

t("a plate over the base setback above the stepback height reports 'setback'", () => {
  const s = baseState({ stepback: { on: true, aboveHeight: 20, distance: 15 } });
  const r = checkEnvelope(s, [plate(5, 40, 10, rectPoly(-130, -50, 130, 50))]);
  eq(r.warnings[0].code, "setback");
});

t("crown solids above the limit -> crown-height warning + solidsOutside flags", () => {
  const s = baseState({ heightLimit: 100 });
  const solids = [
    { kind: "prism", polygons: rectPoly(-5, -5, 5, 5), z0: 100, z1: 120, role: "crown" },
    { kind: "prism", polygons: rectPoly(-5, -5, 5, 5), z0: 90, z1: 100, role: "parapet" },
    { kind: "mesh", positions: [0, 0, 100, 1, 0, 100, 0, 1, 130], indices: [0, 1, 2], role: "spire" },
    { kind: "mesh", positions: [0, 0, 90, 1, 0, 95, 0, 1, 99], indices: [0, 1, 2], role: "spire" },
  ];
  const r = checkEnvelope(s, [], solids);
  eq(JSON.stringify(r.solidsOutside), "[true,false,true,false]");
  eq(r.warnings.length, 1);
  eq(r.warnings[0].code, "crown-height");
  eq(r.warnings[0].message, "The crown exceeds the height limit.");
  // no limit -> nothing
  eq(checkEnvelope(baseState(), [], solids).solidsOutside.some(Boolean), false);
});

t("inputs are not mutated; returned plates are copies", () => {
  const s = deepFreeze(baseState({ heightLimit: 50, stepback: { on: true, aboveHeight: 20, distance: 5 } }));
  const plates = deepFreeze([plate(1, 0, 10, rectPoly(-115, -95, 115, 90)), plate(2, 60, 10, rectPoly(-50, -50, 50, 50))]);
  const solids = deepFreeze([{ kind: "prism", polygons: rectPoly(-5, -5, 5, 5), z0: 60, z1: 80, role: "crown" }]);
  const r = checkEnvelope(s, plates, solids);
  if (r.plates[0] === plates[0]) throw new Error("plate not copied");
  if (r.plates[0].polygons === plates[0].polygons) throw new Error("polygons not copied");
  eq(plates[0].outsideEnvelopeArea, 0);
  if (!(r.plates[0].outsideEnvelopeArea > 0)) throw new Error("copy not filled");
});

t("polygon site, same as a rect: per-side setbacks match the rect result", () => {
  const pts = [[-125, -100], [125, -100], [125, 100], [-125, 100]];
  const setbacks = { front: 20, back: 5, left: 8, right: 12 };
  const a = mpArea(allowedFootprint(baseState({ shape: "polygon", points: pts, setbacks }), 0));
  const b = mpArea(allowedFootprint(baseState({ setbacks }), 0));
  near(a, b); near(a, (250 - 20) * (200 - 25));
  // clockwise input gives the same answer
  const cw = mpArea(allowedFootprint(baseState({ shape: "polygon", points: pts.slice().reverse(), setbacks }), 0));
  near(cw, b);
});

t("polygon site, L-shape with setbacks (hand calculation)", () => {
  // L-shape: 100 x 100 square minus the NE 50 x 50 corner.
  // Vertices CCW: (-50,-50) (50,-50) (50,0) (0,0) (0,50) (-50,50)
  //   edge (-50,-50)->(50,-50): outward normal -y  -> front
  //   edge (50,-50)->(50,0)   : outward +x         -> right
  //   edge (50,0)->(0,0)      : outward +y         -> back  (inner notch, south face of the NE cut)
  //   edge (0,0)->(0,50)      : outward +x         -> right (inner notch, west face of the NE cut)
  //   edge (0,50)->(-50,50)   : outward +y         -> back
  //   edge (-50,50)->(-50,-50): outward -x         -> left
  // Setbacks: front 10, back 5, left 8, right 6.
  //   moved lines: y = -40 (front), x = 44 (outer right), y = -5 (notch back),
  //                x = -6 (notch right), y = 45 (back), x = -42 (left)
  //   lower bar : x -42..44, y -40..-5  = 86 x 35 = 3010
  //   upper arm : x -42..-6, y  -5..45  = 36 x 50 = 1800
  //   total = 4810 sf
  const pts = [[-50, -50], [50, -50], [50, 0], [0, 0], [0, 50], [-50, 50]];
  const s = baseState({ shape: "polygon", points: pts, setbacks: { front: 10, back: 5, left: 8, right: 6 } });
  const mp = allowedFootprint(s, 0);
  near(mpArea(mp), 4810, 0.01);
  eq(mp.length, 1);
  // a plate that fills the arm exactly is inside; one 3 ft further right in the arm is outside by 3 x 50
  const r = checkEnvelope(s, [
    plate(1, 0, 10, rectPoly(-42, -5, -6, 45)),
    plate(2, 10, 10, rectPoly(-42, -5, -3, 45)),
  ]);
  near(r.outside.get(1), 0);
  near(r.outside.get(2), 3 * 50);
});

t("polygon site: rotated (non-axis) edge is classified to the nearest side", () => {
  // diamond-ish quad whose edges have outward normals at 45 deg +- small tilt
  const pts = [[0, -60], [60, -10], [10, 50], [-50, 0]];
  const s = baseState({ shape: "polygon", points: pts, setbacks: { front: 5, back: 5, left: 5, right: 5 } });
  const area = mpArea(allowedFootprint(s, 0));
  // all setbacks equal -> uniform inward miter offset; compare with Clipper-free formula:
  // area of site minus perimeter*5 + 4*25*sum(cot-ish) ~ check it is smaller and positive
  const site = Math.abs((() => { let a = 0; for (let i = 0; i < 4; i++) { const p = pts[i], q = pts[(i + 1) % 4]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; })());
  if (!(area > 0 && area < site)) throw new Error("bad area " + area);
  // uniform setback of 5 on a convex polygon = shrink by 5 on every edge: area = A - P*5 + 25*sum(cot(theta_i/2))
  let per = 0, cot = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[(i + 3) % 4], b = pts[i], c = pts[(i + 1) % 4];
    per += Math.hypot(c[0] - b[0], c[1] - b[1]);
    const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
    const th = Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)));
    cot += 1 / Math.tan(th / 2);
  }
  near(area, site - per * 5 + 25 * cot, 0.05);
});

t("envelopeWireframe: no stepback -> single prism to the height limit", () => {
  const w = envelopeWireframe(baseState({ heightLimit: 400 }), 123);
  eq(w.length, 1); eq(w[0].z0, 0); eq(w[0].z1, 400);
  near(mpArea(w[0].polygons), 230 * 180);
});

t("envelopeWireframe: no limit uses topZ; stepback splits the prism", () => {
  const s = baseState({ heightLimit: 0, stepback: { on: true, aboveHeight: 85, distance: 15 } });
  const w = envelopeWireframe(s, 300);
  eq(w.length, 2);
  eq(w[0].z0, 0); eq(w[0].z1, 85); near(mpArea(w[0].polygons), 230 * 180);
  eq(w[1].z0, 85); eq(w[1].z1, 300); near(mpArea(w[1].polygons), 200 * 150);
  // topZ below the stepback height -> only the base prism
  const w2 = envelopeWireframe(s, 60);
  eq(w2.length, 1); eq(w2[0].z1, 60);
  eq(envelopeWireframe(baseState({ heightLimit: 0 }), 0).length, 0);
});

t("performance: 150 plates check quickly", () => {
  const s = baseState({ heightLimit: 400, stepback: { on: true, aboveHeight: 85, distance: 15 } });
  const plates = [];
  for (let n = 1; n <= 150; n++) plates.push(plate(n, (n - 1) * 10, 10, rectPoly(-60, -60, 60, 60)));
  const t0 = Date.now();
  checkEnvelope(s, plates);
  const ms = Date.now() - t0;
  console.log("       150 plates: " + ms + " ms");
  if (ms > 500) throw new Error("slow: " + ms);
});

/* ---- Unlimited site (site.shape "none"): no site ring, setbacks or stepback; the height limit still applies ---- */
const { hasSite } = await import("../src/tower/envelope.js");
console.log("Unlimited site");
t("shape none: hasSite is false; allowedFootprint and envelopeWireframe are empty", () => {
  const s = baseState({ shape: "none", heightLimit: 400, stepback: { on: true, aboveHeight: 85, distance: 15 } });
  eq(hasSite(s), false); eq(hasSite(baseState()), true);
  eq(allowedFootprint(s, 0).length, 0); eq(allowedFootprint(s, 300).length, 0);
  eq(envelopeWireframe(s, 300).length, 0);
});
t("shape none: far-away plates give no setback, stepback or outside area, and no warnings", () => {
  const s = baseState({ shape: "none", setbacks: { front: 500, back: 500, left: 500, right: 500 }, stepback: { on: true, aboveHeight: 20, distance: 400 } });
  const r = checkEnvelope(s, [plate(1, 0, 10, rectPoly(1000, 1000, 1100, 1100)), plate(2, 10, 10, rectPoly(-900, -900, -800, -800))]);
  eq(r.warnings.length, 0); eq(r.outside.get(1), 0); eq(r.outside.get(2), 0);
  ok(r.plates.every((p) => p.outsideEnvelopeArea === 0), "outsideEnvelopeArea");
});
t("shape none: the height limit still warns when above 0, and 0 means no limit", () => {
  const plates = [plate(1, 0, 10, rectPoly(-10, -10, 10, 10)), plate(2, 590, 20, rectPoly(-10, -10, 10, 10))];
  const lim = checkEnvelope(baseState({ shape: "none", heightLimit: 500 }), plates);
  eq(lim.warnings.map((w) => w.code).join(), "height");
  eq(lim.warnings[0].floors.join(), "2");
  eq(checkEnvelope(baseState({ shape: "none", heightLimit: 0 }), plates).warnings.length, 0, "limit 0 = none");
  eq(checkEnvelope(baseState({ shape: "rect", heightLimit: 0 }), plates.slice(1)).warnings.filter((w) => w.code === "height").length, 0, "rect with limit 0");
  const roof = checkEnvelope(baseState({ shape: "none", heightLimit: 500 }), [], [{ kind: "prism", z0: 480, z1: 520 }]);
  eq(roof.warnings.map((w) => w.code).join(), "crown-height");
});
t("a state with a site and no shape stays a rectangle (old files)", () => {
  const s = baseState(); delete s.site.shape;
  eq(hasSite(s), true); near(mpArea(allowedFootprint(s, 0)), 230 * 180);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
