// Run: node test/facade.exports.test.mjs
// Plan tests 21 to 23 (docs/facade-studio-technical-plan.md section 9.1):
//   21  preset 8.7 through facadeDerived, writeSection and validate
//   22  elevations DXF of preset 8.1: every layer; FAC-GLASS holds 5 x 21 - 33 windows + 33 doors on the S sheet
//   23  SketchUp doc of preset 8.2: validateDoc passes; source facade
// Plus derived keys on every face, input immutability, the DXF sheet layout, and the other layers (spandrel, mullion, fin, shade, court).
// The build comes from a hand fixture that follows the plan section 4 contract (see "hand fixture").
// When src/facade/panels.js, metrics.js and presets.js load, the same invariants also run against the real modules
// (section "real modules").
import { createRequire } from "node:module";
globalThis.ClipperLib = createRequire(import.meta.url)("clipper-lib");

const { facadeDerived } = await import("../src/facade/derived.js");
const { elevationsDxf, elevationGeometry, elevationSheets, FACADE_DXF_LAYERS } = await import("../src/facade/elevations.js");
const { facadeToSketchup, SKETCHUP_SOURCE } = await import("../src/facade/sketchup.js");
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
  standalone: { shape: "rect", width: 300, depth: 65, arm: 65, courtW: 120, courtD: 90, angle: 0, floors: 5, ftf1: 12, ftf: 10, podium: { on: false, levels: 1, ftf: 11, width: 300, depth: 200 } },
  placement: null,
  zones: { mode: "default", ranges: [], rules: { base: { system: "punched" }, middle: { system: "punched" }, top: { system: "punched" } }, overrides: {} },
  systems: {
    punched: { module: 14, windowW: 6, sill: 2.5, head: 8, mullionW: 0.1667, mullionD: 0.333 },
    windowWall: { module: 5, slabCover: 1.3333, mullionW: 0.2083, mullionD: 0.5 },
    curtainWall: { module: 5, vision: 8, sill: 0, mullionW: 0.2083, mullionD: 0.6667 },
    storefront: { module: 5, sill: 1.5, head: 10, mullionW: 0.1667, mullionD: 0.375 },
    solid: { module: 10 },
  },
  balconies: { on: false, type: "projected", pattern: "stacked", spacing: 2, width: 12, depth: 6, slab: 1, door: { width: 6, head: 8 }, zones: ["middle"], orientations: ["N", "E", "S", "W"] },
  fins: { on: false, depth: 1.5, width: 0.1667, every: 1, orientations: ["E", "W"], zones: ["middle", "top"] },
  shades: { on: false, depth: 2, above: 0.5, orientations: ["S"], zones: ["middle", "top"] },
  bands: [], corners: "solid",
  street: { mode: "auto", manual: [], roadDistance: 60 },
  checks: { wwrLimit: 0.40, band: { from: 2, to: 10 }, transparencyTarget: null },
});

const state81 = () => {                       // 8.1 residential punched windows with inset balconies
  const s = baseState(); s.name = "Residential punched windows with inset balconies";
  s.balconies = { ...s.balconies, on: true, type: "inset", pattern: "stacked", orientations: ["N", "S"] };
  return s;
};
const state82 = () => {                       // 8.2 hotel window wall
  const s = baseState(); s.name = "Hotel window wall";
  s.standalone = { ...s.standalone, width: 180, depth: 62, floors: 24, ftf1: 18, ftf: 10, podium: { on: true, levels: 2, ftf: 15, width: 240, depth: 120 } };
  s.zones.rules = { base: { system: "storefront" }, middle: { system: "windowWall" }, top: { system: "windowWall" } };
  return s;
};
const state87 = () => {                       // 8.7 courtyard multifamily with projected balconies
  const s = baseState(); s.name = "Courtyard multifamily";
  s.standalone = { ...s.standalone, shape: "O", width: 250, depth: 220, arm: 65, courtW: 120, courtD: 90, floors: 5, ftf1: 11, ftf: 10, podium: { on: true, levels: 1, ftf: 11, width: 250, depth: 220 } };
  s.zones.rules = { base: { system: "solid" }, middle: { system: "punched" }, top: { system: "punched" } };
  s.balconies = { ...s.balconies, on: true, type: "projected", pattern: "alternating", orientations: ["N", "E", "S", "W"] };
  return s;
};

/* ---------- hand fixture: buildFacade(state) as plan section 4 gives it (rect and O shapes, angle 0) ---------- */

const rectRing = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];     // CCW
const rr = (v) => Math.round(v * 1000) / 1000;

function fixtureLevels(sa) {
  const out = []; let z = 0, idx = 0;
  const main = () => (sa.shape === "O"
    ? [{ outer: rectRing(sa.width, sa.depth), holes: [rectRing(sa.courtW, sa.courtD).reverse()] }]
    : [{ outer: rectRing(sa.width, sa.depth), holes: [] }]);
  if (sa.podium.on) {
    for (let k = 0; k < sa.podium.levels; k++) {
      idx++; const ftf = k === 0 ? sa.ftf1 : sa.podium.ftf;
      out.push({ index: idx, zone: "podium", z, ftf, program: null, plates: [{ outer: rectRing(sa.podium.width, sa.podium.depth), holes: [] }] }); z += ftf;
    }
  }
  for (let k = 0; k < sa.floors; k++) {
    idx++; const ftf = k === 0 && !sa.podium.on ? sa.ftf1 : sa.ftf;
    out.push({ index: idx, zone: "main", z, ftf, program: null, plates: main() }); z += ftf;
  }
  return out;
}

function zoneIds(levels) {
  const base = levels.some((l) => l.zone === "podium") ? levels.filter((l) => l.zone === "podium").map((l) => l.index) : [levels[0].index];
  const top = levels[levels.length - 1].index;
  const m = {};
  for (const l of levels) m[l.index] = base.includes(l.index) ? "base" : l.index === top ? "top" : "middle";
  return m;
}

const sectorOf = (b) => (b >= 315 || b < 45 ? "N" : b < 135 ? "E" : b < 225 ? "S" : "W");

function fixtureRule(state, zone, o) {
  const r = { ...(state.zones.rules[zone] || { system: "punched" }), ...((state.zones.overrides[zone] || {})[o] || {}) };
  return { ...state.systems[r.system], ...r };
}

function fixturePanels(state, face, rule, h) {
  const n = Math.max(1, Math.floor(face.length / rule.module)), m = face.length / n;
  const b = state.balconies;
  const eligible = b.on && rule.system !== "solid" && b.zones.includes(face.zone) && b.orientations.includes(face.orientation);
  const s = b.spacing, k = face.levelIndex, o = (k % 2) * Math.floor(s / 2);
  const mod = (a, c) => ((a % c) + c) % c;
  const doors = new Set();
  if (eligible) for (let i = 0; i < n; i++) if (b.pattern === "stacked" ? i % s === 0 : mod(i - o, s) === 0) doors.add(i);
  const panels = [];
  for (let i = 0; i < n; i++) {
    const u0 = i * m, u1 = (i + 1) * m, c = (u0 + u1) / 2;
    const solid = rule.system === "solid" || (rule.solid && i % rule.solid.every >= rule.solid.every - rule.solid.count);
    const p = { i, u0, u1, kind: "solid", glass: [] };
    if (!solid) {
      if (rule.system === "punched") { const w = Math.min(rule.windowW, m); p.kind = "window"; p.glass = [{ u0: c - w / 2, u1: c + w / 2, v0: rule.sill, v1: Math.min(rule.head, h) }]; }
      else if (rule.system === "windowWall") { p.kind = "glass"; p.glass = [{ u0, u1, v0: 0, v1: h - rule.slabCover }]; }
      else if (rule.system === "curtainWall") { p.kind = "glass"; p.glass = [{ u0, u1, v0: rule.sill, v1: Math.min(rule.sill + rule.vision, h) }]; }
      else if (rule.system === "storefront") { p.kind = "glass"; p.glass = [{ u0, u1, v0: rule.sill, v1: Math.min(rule.head, h) }]; }
    }
    if (!solid && doors.has(i)) { p.kind = "door"; p.glass = [{ u0: c - b.door.width / 2, u1: c + b.door.width / 2, v0: 0, v1: b.door.head }]; }
    panels.push(p);
  }
  return { n, module: m, panels };
}

function fixtureBuild(state) {
  const levels = fixtureLevels(state.standalone);
  const zones = zoneIds(levels);
  const groups = [], faces = [], balconies = [];
  const lowest = levels[0].index;
  for (const lv of levels) {
    lv.plates.forEach((pc) => [pc.outer, ...pc.holes].forEach((ring, ri) => {
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e], b = ring[(e + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        const nrm = [dy / len, -dx / len], bearing = ((Math.atan2(nrm[0], nrm[1]) * 180) / Math.PI + 360) % 360, orientation = sectorOf(bearing);
        const zone = zones[lv.index];
        let g = groups.find((q) => q.zone === zone && q.ring === ri && q.levelTo === lv.index - 1 && Math.hypot(q.a[0] - a[0], q.a[1] - a[1]) < 1 && Math.hypot(q.b[0] - b[0], q.b[1] - b[1]) < 1);
        if (g) { g.levelTo = lv.index; g.levels.push(lv.index); g.height += lv.ftf; }
        else {
          g = { id: `F${groups.length + 1}`, levelFrom: lv.index, levelTo: lv.index, levels: [lv.index], a, b, length: len, bearing, orientation, zone, ring: ri, convexStart: true, convexEnd: true, height: lv.ftf };
          groups.push(g);
        }
        const rule = fixtureRule(state, zone, orientation);
        const face = { id: `${g.id}@${lv.index}`, groupId: g.id, levelIndex: lv.index, z: lv.z, ftf: lv.ftf, a, b, length: len, orientation, bearing, zone, street: false, rule };
        const fp = fixturePanels(state, face, rule, lv.ftf);
        Object.assign(face, fp);
        face.glazing = rr(fp.panels.reduce((s, p) => s + p.glass.reduce((q, r) => q + (r.u1 - r.u0) * (r.v1 - r.v0), 0), 0));
        face.wall = rr(len * lv.ftf);
        faces.push(face);
        for (const p of fp.panels) if (p.kind === "door") balconies.push({ faceId: face.id, levelIndex: lv.index, i: p.i, type: state.balconies.type });
      }
    }));
  }
  const streetIds = [...new Set(faces.filter((f) => f.levelIndex === lowest && f.orientation === "S").map((f) => f.groupId))];
  for (const f of faces) f.street = streetIds.includes(f.groupId);
  return { source: "standalone", rotation: 0, levels, groups, faces, balconies, fins: [], shades: [], street: { ids: streetIds, source: "auto" }, warnings: [] };
}

function fixtureMetrics(state, built) {
  const O = ["N", "E", "S", "W"], by = {};
  for (const o of O) by[o] = { w: 0, g: 0 };
  let wall = 0, glaze = 0;
  for (const f of built.faces) { wall += f.wall; glaze += f.glazing; by[f.orientation].w += f.wall; by[f.orientation].g += f.glazing; }
  const zg = built.levels[0].z, band = state.checks.band;
  let gl = 0, den = 0;
  for (const f of built.faces.filter((q) => q.street)) {
    den += f.length * (band.to - band.from);
    for (const p of f.panels) for (const r of p.glass) { const lo = Math.max(f.z + r.v0, zg + band.from), hi = Math.min(f.z + r.v1, zg + band.to); if (hi > lo) gl += (r.u1 - r.u0) * (hi - lo); }
  }
  const bc = built.balconies.length;
  return {
    wall, glazing: glaze, wwr: glaze / wall,
    wwrByOrientation: Object.fromEntries(O.map((o) => [o, by[o].w ? by[o].g / by[o].w : 0])),
    transparency: den > 0 ? gl / den : null, balconyCount: bc, balconyArea: bc * state.balconies.width * state.balconies.depth,
    exposure: null, wwrLimit: state.checks.wwrLimit,
  };
}

const S81 = state81(), S82 = state82(), S87 = state87();
const B81 = fixtureBuild(S81), B82 = fixtureBuild(S82), B87 = fixtureBuild(S87);
const M81 = fixtureMetrics(S81, B81), M82 = fixtureMetrics(S82, B82), M87 = fixtureMetrics(S87, B87);

t("fixture: presets 8.1, 8.2 and 8.7 reproduce the plan section 8 numbers", () => {
  near(M81.wwr, 9240 / 37960, 1e-9); near(M81.transparency, 693 / 2400, 1e-9); eq(M81.balconyCount, 66);
  near(M82.wwr, 112912 / 139920, 1e-4);                       // 8.2: 0.807
  eq(M87.balconyCount, 184); near(M87.wall, 78340, 1e-6); near(M87.glazing, 17940, 0.01); near(M87.balconyArea, 13248, 1e-6);
});

/* ---------- test 21: derived ---------- */

const snap = JSON.stringify([S87, B87, M87]);
const D87 = facadeDerived(S87, B87, M87);

t("test 21: preset 8.7 derived passes validate after writeSection", () => {
  const doc = writeSection(newProject({ name: "Facade test" }), "facade", { tool: "facade", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: S87, derived: D87 });
  const v = validate(doc);
  ok(v.ok, v.errors.join("; "));
  eq(doc.sections.facade.tool, "facade");
  eq(doc.sections.facade.derived.faces.length, B87.groups.length);
  ok(JSON.stringify(doc).length < 200000, "project stays small: " + JSON.stringify(doc).length + " bytes");
  ok(!/NaN|null,null/.test(JSON.stringify(D87)), "no NaN");
});

t("test 21: every face carries the spec keys and the additive keys", () => {
  const keys = ["id", "levelFrom", "levelTo", "orientation", "system", "area", "glazing", "wwr", "balconies", "edge", "bearing", "zone", "street"];
  eq(B87.groups.length, 4 + 8 + 8);                                  // podium 4 (outer ring only) + middle 8 + top 8
  for (const f of D87.faces) {
    eq(Object.keys(f).sort(), keys.slice().sort(), "keys of " + f.id);
    ok(["N", "E", "S", "W"].includes(f.orientation));
    eq(f.edge.length, 2); ok(f.edge.every((p) => p.length === 2 && p.every(Number.isFinite)));
    ok(typeof f.street === "boolean" && Number.isInteger(f.balconies));
  }
});

t("test 21: sum of face areas = wall; glazing and balconies add up", () => {
  near(D87.faces.reduce((s, f) => s + f.area, 0), M87.wall, 0.1 * D87.faces.length, "area");
  near(D87.faces.reduce((s, f) => s + f.glazing, 0), M87.glazing, 0.1 * D87.faces.length, "glazing");
  eq(D87.faces.reduce((s, f) => s + f.balconies, 0), 184);
  eq(D87.faces.filter((f) => f.zone === "base").every((f) => f.system === "solid" && f.glazing === 0 && f.wwr === 0), true);
  eq(D87.faces.filter((f) => f.zone !== "base").every((f) => f.system === "punched"), true);
});

t("test 21: metrics block", () => {
  const m = D87.metrics;
  near(m.wwr, 0.229, 0.0005);                                        // 17,940 / 78,340
  eq(m.balconyCount, 184); eq(m.balconyArea, 13248);
  near(m.facadeArea, 78340, 0.05); near(m.glazingArea, 17940, 0.05);
  eq(m.wwrLimit, 0.4); eq(m.exposure, null); eq(m.groundTransparency, 0);   // solid podium, S street faces
  eq(Object.keys(m.wwrByOrientation), ["N", "E", "S", "W"]);
});

t("test 21: preset 8.1 numbers through the writer (0.243; N and S 0.254; E and W 0.195; transparency 0.289; 66 balconies; 4,752 sf)", () => {
  const d = facadeDerived(S81, B81, M81);
  near(d.metrics.wwr, 0.243, 0.0005);
  eq(d.metrics.wwrByOrientation, { N: 0.254, E: 0.195, S: 0.254, W: 0.195 });
  near(d.metrics.groundTransparency, 0.289, 0.0005);
  eq(d.metrics.balconyCount, 66); eq(d.metrics.balconyArea, 4752);
  eq(d.faces.filter((f) => f.street).map((f) => f.orientation), ["S"]);          // the S base group only
  ok(d.faces.every((f) => ["base", "middle", "top"].includes(f.zone)));
});

t("test 21: hotel window wall reads as window-wall and storefront", () => {
  const d = facadeDerived(S82, B82, M82);
  eq([...new Set(d.faces.map((f) => f.system))].sort(), ["storefront", "window-wall"]);
});

t("derived: street flag, exposure and transparency pass through; a missing metrics row falls back to the built faces", () => {
  const d = facadeDerived(S81, B81, { ...M81, exposure: { N: 0, E: 0.261, S: 1, W: 0 }, transparency: { value: 0.5 } });
  eq(d.metrics.exposure, { N: 0, E: 0.261, S: 1, W: 0 });
  eq(d.metrics.groundTransparency, 0.5);
  const f = facadeDerived(S81, B81, {});
  near(f.metrics.wwr, 0.243, 0.0005); eq(f.metrics.balconyCount, 66); eq(f.metrics.balconyArea, 4752); eq(f.metrics.groundTransparency, null);
});

t("derived: inputs are not mutated; same inputs give the same result", () => {
  eq(JSON.stringify([S87, B87, M87]), snap);
  eq(JSON.stringify(facadeDerived(S87, B87, M87)), JSON.stringify(D87));
});

t("derived: missing inputs throw", () => {
  let e1 = null; try { facadeDerived(null, B81, {}); } catch (e) { e1 = e; }
  ok(e1 && /state/.test(e1.message));
  let e2 = null; try { facadeDerived(S81, {}, {}); } catch (e) { e2 = e; }
  ok(e2 && /built.groups/.test(e2.message));
});

/* ---------- test 22: DXF ---------- */

/** DXF text → { layers: Set, ents: [{ type, layer, flag, pts: [[x, y]] }] } */
function parseDxf(text) {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  eq(lines.length % 2, 0, "group code and value lines pair up");
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1]]);
  const layers = new Set(), ents = [];
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
      if (v === "VERTEX") { vtx = [0, 0]; cur.pts.push(vtx); continue; }
      if (v === "SEQEND") { cur = null; vtx = null; continue; }
      cur = { type: v, layer: null, flag: null, pts: [], text: null }; vtx = null;
      if (v === "LINE" || v === "TEXT") { vtx = [0, 0]; cur.pts.push(vtx); }
      ents.push(cur);
    } else if (sec === "ENTITIES" && cur) {
      if (c === 8 && cur.layer === null) cur.layer = v;
      if (c === 70 && cur.type === "POLYLINE" && cur.flag === null) cur.flag = parseInt(v, 10);
      if (c === 1 && cur.type === "TEXT") cur.text = v;
      if (cur.type === "POLYLINE" && !vtx) continue;
      if (c === 10 && vtx && cur.type !== "POLYLINE") vtx[0] = parseFloat(v);
      if (c === 20 && vtx && cur.type !== "POLYLINE") vtx[1] = parseFloat(v);
      if (cur.type === "POLYLINE" && vtx) { if (c === 10) vtx[0] = parseFloat(v); if (c === 20) vtx[1] = parseFloat(v); }
    }
  }
  return { layers, ents };
}
const bbox = (e) => ({ x0: Math.min(...e.pts.map((p) => p[0])), x1: Math.max(...e.pts.map((p) => p[0])), y0: Math.min(...e.pts.map((p) => p[1])), y1: Math.max(...e.pts.map((p) => p[1])) });

const dxf81 = elevationsDxf(S81, B81, M81);
const P81 = parseDxf(dxf81);
const sheets81 = elevationSheets(B81);
const onSheet = (P, layer, orient, sheets, type = "POLYLINE") => {
  const sh = sheets.find((s) => s.orientation === orient);
  return P.ents.filter((e) => e.layer === layer && e.type === type && e.pts.length && e.pts[0][0] >= sh.x0 - 1e-6 && e.pts[0][0] <= sh.x1 + 1e-6);
};

t("test 22: DXF R12 header; every layer in the table; no NaN", () => {
  ok(dxf81.includes("AC1009") && dxf81.endsWith("  0\nEOF\n"));
  eq(FACADE_DXF_LAYERS.map((l) => l[0]), ["FAC-WALL", "FAC-GLASS", "FAC-SPANDREL", "FAC-MULLION", "FAC-BALCONY", "FAC-FIN", "FAC-SHADE", "FAC-LEVEL", "FAC-COURT", "FAC-TEXT"]);
  for (const [name] of FACADE_DXF_LAYERS) ok(P81.layers.has(name), `layer ${name} missing`);
  eq([...P81.layers].filter((n) => n.startsWith("FAC-")).length, 10);
  ok(!/NaN|undefined|Infinity/.test(dxf81));
});

t("test 22: sheet layout: N, E, S, W from x = 0, 50 ft apart (widths 300, 65, 300, 65)", () => {
  eq(sheets81.map((s) => [s.orientation, s.x0, s.x1]), [["N", 0, 300], ["E", 350, 415], ["S", 465, 765], ["W", 815, 880]]);
});

t("test 22: S sheet FAC-GLASS holds 5 x 21 - 33 = 72 windows and 33 doors", () => {
  const g = onSheet(P81, "FAC-GLASS", "S", sheets81);
  eq(g.length, 105);
  const h = (e) => Math.round((bbox(e).y1 - bbox(e).y0) * 1000) / 1000;
  eq(g.filter((e) => h(e) === 5.5).length, 72);                      // 8 - 2.5 = 5.5 ft windows
  eq(g.filter((e) => h(e) === 8).length, 33);                        // 8 ft doors
  ok(g.every((e) => e.flag === 1 && e.pts.length === 4), "closed rectangles");
  eq(onSheet(P81, "FAC-GLASS", "N", sheets81).length, 105);
  eq(onSheet(P81, "FAC-GLASS", "E", sheets81).length, 5 * 4);        // 4 windows per level on 65 ft
});

t("test 22: FAC-WALL per face and level; FAC-BALCONY recesses; FAC-LEVEL; titles carry the WWR", () => {
  eq(onSheet(P81, "FAC-WALL", "S", sheets81).length, 5);
  const wall = onSheet(P81, "FAC-WALL", "S", sheets81).map((e) => bbox(e));
  eq(wall.map((b) => [b.y0, b.y1]), [[0, 12], [12, 22], [22, 32], [32, 42], [42, 52]]);
  eq(onSheet(P81, "FAC-BALCONY", "S", sheets81).length, 33);         // inset: the recess only
  eq(onSheet(P81, "FAC-BALCONY", "E", sheets81).length, 0);
  const lv = P81.ents.filter((e) => e.layer === "FAC-LEVEL" && e.type === "LINE");
  eq(lv.length, 4 * 6);                                              // 5 floors + the top, on four sheets
  const titles = P81.ents.filter((e) => e.layer === "FAC-TEXT" && e.type === "TEXT").map((e) => e.text);
  ok(titles.includes("SOUTH ELEVATION  WWR 25.4 PCT"), titles.join(" | "));
  ok(titles.includes("EAST ELEVATION  WWR 19.5 PCT"));
  eq(P81.ents.filter((e) => e.layer === "FAC-SPANDREL" || e.layer === "FAC-COURT" || e.layer === "FAC-FIN" || e.layer === "FAC-SHADE" || e.layer === "FAC-MULLION").length, 0);
});

t("test 22: first S glass rectangle sits where the geometry says (u = x, bottom at the sill)", () => {
  const g = elevationGeometry(B81, "S", S81);
  const w = g.glass.find((e) => e.faceId.endsWith("@1") && e.kind === "window");
  near(w.u0, -150 + 300 / 42 - 3, 1e-3); near(w.u1, -150 + 300 / 42 + 3, 1e-3);   // module 300/21, window centered near(w.z0, 2.5); near(w.z1, 8);
  const n = elevationGeometry(B81, "N", S81);                         // N looks south: u = -x, so face a is on the right
  ok(n.glass.length === 105 && n.extent.umin === -150 && n.extent.umax === 150);
});

t("test 22: window wall elevation has spandrel strips and mullions (preset 8.2)", () => {
  const d = elevationsDxf(S82, B82, M82), P = parseDxf(d), sh = elevationSheets(B82);
  ok(P.ents.filter((e) => e.layer === "FAC-SPANDREL").length > 0);
  ok(P.ents.filter((e) => e.layer === "FAC-MULLION" && e.type === "LINE").length > 0);
  // tower S face: 180 ft -> 36 modules; levels 3..26 -> 24 face levels; each has 36 glass rectangles
  const g = elevationGeometry(B82, "S", S82);
  eq(g.spandrel.filter((e) => Math.abs(e.z1 - e.z0 - 1.3333) < 1e-3).length, 36 * 24);
  eq(sh.length, 4);
});

t("test 22: courtyard faces go on FAC-COURT (preset 8.7)", () => {
  const g = elevationGeometry(B87, "N", S87);
  eq(g.faces.filter((f) => f.court).length, 5);                       // the court's south side faces N on five tower levels
  eq(g.faces.filter((f) => !f.court).length, 6);                      // podium + 5 floors
  const P = parseDxf(elevationsDxf(S87, B87, M87));
  ok(P.ents.filter((e) => e.layer === "FAC-COURT").length > 5);
  const n = elevationSheets(B87)[0];
  eq(P.ents.filter((e) => e.layer === "FAC-WALL" && e.pts[0][0] <= n.x1).length, 6);
});

t("test 22: projected balconies (slab + rail), fins and shades land on their layers", () => {
  const s = state87(); s.fins.on = true; s.fins.orientations = ["E", "W"]; s.shades.on = true; s.shades.orientations = ["S", "N", "E", "W"];
  s.zones.rules.middle = { system: "windowWall" }; s.zones.rules.top = { system: "windowWall" };
  const b = fixtureBuild(s), P = parseDxf(elevationsDxf(s, b, fixtureMetrics(s, b)));
  ok(P.ents.filter((e) => e.layer === "FAC-BALCONY").length > 0 && P.ents.filter((e) => e.layer === "FAC-BALCONY").length % 2 === 0, "slab and rail pairs");
  ok(P.ents.filter((e) => e.layer === "FAC-FIN").length > 0);
  ok(P.ents.filter((e) => e.layer === "FAC-SHADE").length > 0);
  const e = elevationGeometry(b, "E", s);
  ok(e.fins.length > 0 && e.fins.every((f) => Math.abs(f.u1 - f.u0 - 0.1667) < 2e-3));
});

t("test 22: project rotation 90 swaps the sheet widths (the 65 ft side now seen from the north)", () => {
  const b = { ...B81, rotation: 90 };
  const sh = elevationSheets(b);
  eq(sh.map((s) => s.x1 - s.x0), [65, 300, 65, 300]);                   // N sheet now shows the 65 ft width
});

t("test 22: exports do not change their inputs; missing inputs throw", () => {
  eq(JSON.stringify([S81, B81, M81]), JSON.stringify([state81(), fixtureBuild(state81()), fixtureMetrics(state81(), fixtureBuild(state81()))]));
  let e1 = null; try { elevationsDxf(null, B81, {}); } catch (e) { e1 = e; }
  ok(e1 && /state/.test(e1.message));
  let e2 = null; try { elevationsDxf(S81, {}, {}); } catch (e) { e2 = e; }
  ok(e2 && /built.faces/.test(e2.message));
});

/* ---------- test 23: SketchUp ---------- */

const doc82 = facadeToSketchup(S82, B82, M82, { createdAt: "2026-10-21T00:00:00Z" });
t("test 23: preset 8.2 doc validates; source facade; groups in order", () => {
  const v = validateDoc(doc82);
  ok(v.ok, v.errors.join("; "));
  eq(doc82.source, "facade"); eq(SKETCHUP_SOURCE, "facade");
  eq(doc82.root.children.map((c) => c.name), ["Walls", "Glass", "Spandrel"]);
  ok(doc82.materials.every((m) => m.name && m.color));
  eq(doc82.tags.map((x) => x.name).sort(), ["Storefront", "Window wall"]);
  ok(doc82.notes.some((n) => /WWR 80\.7 percent/.test(n)), doc82.notes.join(" | "));
});

t("test 23: one glass mesh per face and level; storefront base has wall bands, window wall has none", () => {
  const glass = doc82.root.children[1].children, walls = doc82.root.children[0].children, span = doc82.root.children[2].children;
  eq(glass.length, B82.faces.length);                                  // every face level has glass
  eq(glass.every((m) => m.type === "mesh" && m.triangles.length % 2 === 0), true);
  eq(walls.length, 4 * 2);                                             // podium faces on levels 1 and 2 (storefront: 0..1.5 and 10..h)
  eq(span.length, 4 * 24);                                             // window wall tower levels 3..26 (slab cover strip)
  const m = glass[0];
  ok(m.vertices.every((p) => p.length === 3));
});

t("test 23: mesh area equals the plan numbers: wall + glass + spandrel = facade area", () => {
  const area = (m) => { let s = 0; for (const [i, j, k] of m.triangles) { const a = m.vertices[i], b = m.vertices[j], c = m.vertices[k]; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; s += 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]); } return s; };
  const sum = (g) => g.children.reduce((s, m) => s + area(m), 0);
  const [w, g, sp] = doc82.root.children;
  near(sum(g), M82.glazing, 12, "glass (vertex rounding to 0.001 ft)");
  near(sum(w) + sum(g) + sum(sp), M82.wall, 12, "wall + glass + spandrel");
});

t("sketchup: preset 8.1 inset balconies: valid, 66 slabs, recess openings, door glass behind the face plane", () => {
  const d = facadeToSketchup(S81, B81, M81, { name: "Inset test" });
  const v = validateDoc(d);
  ok(v.ok, v.errors.join("; "));
  eq(d.root.children.map((c) => c.name), ["Walls", "Glass", "Balconies"]);
  const bal = d.root.children[2].children;
  eq(bal.length, 66); ok(bal.every((s) => s.z1 - s.z0 === 1 && s.type === "solid"));
  // south face level 2: the door glass sits 6 ft inside the face (y = -32.5 + 6)
  const g = d.root.children[1].children.find((m) => m.name === "F5@2");
  ok(g, "glass mesh of the S face on level 2");
  const ys = [...new Set(g.vertices.map((p) => p[1]))].sort((a, b) => a - b);
  eq(ys, [-32.5, -26.5]);
  // area: wall + glass + spandrel(none) + side returns + back wall = the plain face plus 2 x (6 x 10) returns per balcony
  const area = (m) => { let s = 0; for (const [i, j, k] of m.triangles) { const a = m.vertices[i], b = m.vertices[j], c = m.vertices[k]; const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; s += 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]); } return s; };
  const wl = d.root.children[0].children.find((m) => m.name === "F5@2");
  const gl = area(g), wa = area(wl);
  const b = 11;                                                         // balconies per level on the S face
  near(gl + wa, 300 * 10 + b * 2 * 6 * 10, 0.01, "face area + returns");
});

t("sketchup: projected balconies, fins and shades: Balconies, Fins and Shades groups; valid", () => {
  const s = state87(); s.fins.on = true; s.shades.on = true; s.shades.orientations = ["S", "N", "E", "W"];
  const b = fixtureBuild(s), d = facadeToSketchup(s, b, fixtureMetrics(s, b));
  const v = validateDoc(d);
  ok(v.ok, v.errors.join("; "));
  eq(d.root.children.map((c) => c.name), ["Walls", "Glass", "Balconies", "Fins", "Shades"]);
  eq(d.root.children[2].children.length, 184);
  // fins: E and W faces on middle and top levels (5 levels): E/W lengths 220 (n 15) and 90 (n 6) -> interior lines 14 + 5 per side pair
  const fins = d.root.children[3].children;
  ok(fins.length > 0 && fins.every((f) => f.type === "mesh" && f.closed === true && f.triangles.length === 12));
  const sl = d.root.children[2].children[0];
  ok(sl.z1 - sl.z0 === 1 && sl.z1 > 0);
});

t("sketchup: inputs are not mutated; missing inputs throw; deterministic", () => {
  const a = JSON.stringify(facadeToSketchup(S82, B82, M82, { createdAt: "x" })), b = JSON.stringify(facadeToSketchup(S82, B82, M82, { createdAt: "x" }));
  eq(a, b);
  let e1 = null; try { facadeToSketchup(null, B82, {}); } catch (e) { e1 = e; }
  ok(e1 && /state/.test(e1.message));
  let e2 = null; try { facadeToSketchup(S82, {}, {}); } catch (e) { e2 = e; }
  ok(e2 && /built.faces/.test(e2.message));
});

/* ---------- real modules ---------- */

let real = null;
try {
  const panels = await import("../src/facade/panels.js");
  const metrics = await import("../src/facade/metrics.js");
  const presets = await import("../src/facade/presets.js");
  real = { buildFacade: panels.buildFacade, computeMetrics: metrics.computeMetrics, PRESETS: presets.PRESETS };
} catch (e) { console.log("  note real modules not loaded: " + e.message); }

if (real) {
  console.log("-- real modules (panels.js, metrics.js, presets.js)");
  const preset = (id) => structuredClone(real.PRESETS.find((p) => p.id === id).state);
  const run = (id) => { const s = preset(id), b = real.buildFacade(s), m = real.computeMetrics(s, b, null); return { s, b, m }; };
  const R87 = run("courtyard-multifamily-projected-balconies"), R81 = run("residential-punched-inset-balconies"), R82 = run("hotel-window-wall"), R88 = run("tower-glass-corner-fins");

  t("real: test 21 on preset 8.7: derived validates; areas add up; 184 balconies", () => {
    const d = facadeDerived(R87.s, R87.b, R87.m);
    const doc = writeSection(newProject({ name: "Real" }), "facade", { tool: "facade", schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: R87.s, derived: d });
    ok(validate(doc).ok, validate(doc).errors.join("; "));
    near(d.faces.reduce((s, f) => s + f.area, 0), R87.m.wall, 0.1 * d.faces.length);
    eq(d.faces.reduce((s, f) => s + f.balconies, 0), 184);
    eq(d.metrics.balconyCount, 184); near(d.metrics.wwr, 0.229, 0.0006);
    ok(d.faces.every((f) => typeof f.street === "boolean" && f.edge.length === 2 && ["solid", "punched"].includes(f.system)));
  });
  t("real: test 22 on preset 8.1: S sheet FAC-GLASS = 105 rectangles (72 windows + 33 doors)", () => {
    const P = parseDxf(elevationsDxf(R81.s, R81.b, R81.m)), sh = elevationSheets(R81.b);
    ok(!/NaN|undefined/.test(elevationsDxf(R81.s, R81.b, R81.m)));
    for (const [name] of FACADE_DXF_LAYERS) ok(P.layers.has(name));
    const g = onSheet(P, "FAC-GLASS", "S", sh);
    eq(g.length, 105);
    eq(g.filter((e) => Math.round((bbox(e).y1 - bbox(e).y0) * 1000) / 1000 === 8).length, 33);
  });
  t("real: test 22 on 8.7 and 8.8: court faces, spandrel strips, fins", () => {
    const g = elevationGeometry(R87.b, "N", R87.s);
    eq(g.faces.filter((f) => f.court).length, 5);
    const P8 = parseDxf(elevationsDxf(R88.s, R88.b, R88.m));
    ok(P8.ents.filter((e) => e.layer === "FAC-FIN").length > 0, "fins");
    ok(P8.ents.filter((e) => e.layer === "FAC-SPANDREL").length > 0, "spandrel");
    ok(P8.ents.filter((e) => e.layer === "FAC-MULLION").length > 0, "mullions");
  });
  t("real: test 23 on preset 8.2 and every preset: validateDoc passes; source facade", () => {
    const d = facadeToSketchup(R82.s, R82.b, R82.m);
    ok(validateDoc(d).ok, validateDoc(d).errors.join("; ")); eq(d.source, "facade");
    for (const p of real.PRESETS) {
      const s = structuredClone(p.state), b = real.buildFacade(s), doc = facadeToSketchup(s, b, real.computeMetrics(s, b, null));
      const v = validateDoc(doc);
      ok(v.ok, p.id + ": " + v.errors.join("; "));
      const dd = facadeDerived(s, b, real.computeMetrics(s, b, null));
      ok(validate(writeSection(newProject({}), "facade", { tool: "facade", schema: 1, state: s, derived: dd })).ok, p.id + " derived");
      ok(elevationsDxf(s, b, real.computeMetrics(s, b, null)).length > 1000, p.id + " dxf");
    }
  });
  t("real: glass area in the S elevation of 8.1 equals the face glazing (no glass lost between panels and elevations)", () => {
    const g = elevationGeometry(R81.b, "S", R81.s);
    const area = g.glass.reduce((s, r) => s + (r.u1 - r.u0) * (r.z1 - r.z0), 0);
    near(area, R81.b.faces.filter((f) => f.orientation === "S").reduce((s, f) => s + f.glazing, 0), 0.05);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
