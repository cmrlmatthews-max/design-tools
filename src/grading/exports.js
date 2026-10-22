/* ==========================================================================
   grading/exports.js — Revit CSV, DXF R12, and the notes file
   (docs/grading-sketch-technical-plan.md section 4 "DXF layers" and section 3.12)

   revitCsv(built)                          "x,y,z\n" for every proposed ground node, row-major from the south, 3 decimals, no header.
   gradingDxf(state, built, metrics)        DXF R12 (AC1009), feet, project frame, hand-written like src/site/exports.js.
   notesMarkdown(state, built, metrics, meta)   Markdown notes in ASD-STE100 style: the earthwork table and every Caution.

   DXF layers (GRADING_DXF_LAYERS):
     GRD-EXIST-MINOR, GRD-EXIST-MAJOR, GRD-PROP-MINOR, GRD-PROP-MAJOR   contours as 3D polylines at their z
     GRD-PAD         pad outlines at pad top (closed 3D polylines)
     GRD-WALL        the top line of each wall (3D polyline)
     GRD-WALL-TEXT   "TOP 1,008.40" and "BOT 991.60" at each end of a wall and at its tallest point
     GRD-CUTFILL     the zero line of proposed minus existing (3D polylines on the proposed ground)
     GRD-DRIVE, GRD-LOT   outlines (closed 3D polylines on the proposed ground; drive centerline as an open polyline)
     GRD-ROUTE       route lines, every 5 ft
     GRD-SPOT        points and elevation labels at pad corners, drive ends, and route ends
     GRD-TEXT        title, caution line, and the earthwork table, below the grid

   Contours: taken from built.contours when it exists ({ existing: [{ z, major, line }], proposed: [...], zero: [[[x, y], …]] },
   the shape contours.js returns, so the page can pass its 2x refinement near features); else contours.js runs on the node
   grid at view.contours.interval (no refinement). Both sets are always written, whatever the view toggles say.

   Pure: no DOM, no input mutation. Reads the build through ./derived.js and the contours through ./contours.js.
   ========================================================================== */

import { contours, zeroLine } from "./contours.js";
import { groundData, tierList, tierIdentity, padPolygons, padOf, wallRecords, routeRecords, metricsSummary, ringOf } from "./derived.js";

export const GRADING_DXF_LAYERS = [
  ["GRD-EXIST-MINOR", 9], ["GRD-EXIST-MAJOR", 8], ["GRD-PROP-MINOR", 3], ["GRD-PROP-MAJOR", 5], ["GRD-PAD", 2],
  ["GRD-WALL", 1], ["GRD-WALL-TEXT", 1], ["GRD-CUTFILL", 6], ["GRD-DRIVE", 4], ["GRD-LOT", 30],
  ["GRD-ROUTE", 7], ["GRD-SPOT", 7], ["GRD-TEXT", 7],
];

export const CAUTIONS = [
  "Caution: the Grading Sketch is a sketch for early coordination with the civil engineer. It is never a grading plan. Every volume, slope, and wall height here is a design-stage estimate.",
  "Caution: grid earthwork compares options. It is not a quantity takeoff. Expect about plus or minus 5 to 10 percent against a civil surface model, more where edges fall between samples.",
  "Caution: a step between tiers changes the building, not only the ground. A 4 ft step needs stairs or a ramp inside the building and a stepped slab. Confirm every step with the design team.",
  "Caution: stable slopes depend on the soil. 2:1 and 3:1 are common starting values, not a geotechnical recommendation.",
  "Caution: walls over about 4 ft often need an engineered design, a permit, and a guard. Verify every wall with the civil and structural engineers.",
  "Caution: drive and lot slopes are design values for a sketch. The fire marshal and the local code set fire access grades. Verify every grade with the civil engineer and the fire marshal.",
  "Caution: route limits come from the 2010 ADA Standards and ICC A117.1. The adopted code and its amendments decide. The tool reports slopes. It never says \"compliant\".",
  "Caution: the USGS ground can differ from a survey. FFEs can be off by a foot or more. Confirm every elevation against a survey.",
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const n0 = (v) => Math.round(v).toLocaleString("en-US");
const n1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (v) => (Math.round(v * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)} percent`;

/* ---------------- Revit CSV ---------------- */

export function revitCsv(built) {
  const g = groundData(built);
  const rows = [];
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) rows.push(`${g.xs[i].toFixed(3)},${g.ys[j].toFixed(3)},${g.pz[j * g.n + i].toFixed(3)}`);
  return rows.join("\n") + "\n";
}

/* ---------------- contours ---------------- */

/** built.contours when the page passes it (its own 2x refinement near features); else contours.js on the node grid. */
function contourData(state, built, g) {
  const c = built.contours;
  const diff = new Float64Array(g.n * g.n);
  for (let k = 0; k < diff.length; k++) diff[k] = g.pz[k] - g.ez[k];
  if (c && Array.isArray(c.existing) && Array.isArray(c.proposed)) return { existing: c.existing, proposed: c.proposed, zero: Array.isArray(c.zero) ? c.zero : zeroLine(g, diff) };
  const iv = state.view && state.view.contours && isNum(state.view.contours.interval) && state.view.contours.interval > 0 ? state.view.contours.interval : 1;
  return { existing: contours(g, g.ez, iv), proposed: contours(g, g.pz, iv), zero: zeroLine(g, diff) };
}

/* ---------------- DXF writer (R12, hand-written like src/site/exports.js) ---------------- */

function fmt(v) {
  let s = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/0+$/, "");
  if (s.endsWith(".")) s += "0";
  return s === "-0.0" ? "0.0" : s;
}

class Dxf {
  constructor() { this.out = []; this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity]; this.counts = {}; }
  g(code, v) { this.out.push(String(code).padStart(3, " "), typeof v === "number" && code >= 10 && code <= 59 ? fmt(v) : String(v)); }
  pt(x, y, z, c = 10) {
    this.g(c, x); this.g(c + 10, y); this.g(c + 20, z);
    const v = [x, y, z];
    for (let i = 0; i < 3; i++) { if (v[i] < this.min[i]) this.min[i] = v[i]; if (v[i] > this.max[i]) this.max[i] = v[i]; }
  }
  count(layer) { this.counts[layer] = (this.counts[layer] || 0) + 1; }
  /** 3D polyline (flag 8; closed = flag 9), vertices flag 32. */
  poly3d(layer, line, closed = false) {
    this.count(layer);
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, closed ? 9 : 8);
    for (const p of line) { this.g(0, "VERTEX"); this.g(8, layer); this.pt(p[0], p[1], p[2]); this.g(70, 32); }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  point(layer, x, y, z) { this.count(layer); this.g(0, "POINT"); this.g(8, layer); this.pt(x, y, z); }
  text(layer, x, y, z, h, s) {
    this.count(layer);
    this.g(0, "TEXT"); this.g(8, layer); this.pt(x, y, z); this.g(40, h); this.g(1, String(s).replace(/[^\x20-\x7e]/g, "?"));
  }
}

const elev = (v) => n2(v);                                // "1,008.40"

/** The DXF text of the build. See the file header for the layers. */
export function gradingDxf(state, built, metrics) {
  if (!state) throw new Error('gradingDxf: missing input "state".');
  if (!built) throw new Error('gradingDxf: missing input "built".');
  const g = groundData(built), at = built.surface.at, D = new Dxf();
  const wr = wallRecords(state, built), rr = routeRecords(state, built, metrics || {});
  const m = metrics ? metricsSummary(state, built, metrics, wr, rr) : null;

  // contours
  const c = contourData(state, built, g);
  const lay = (set, minor, major) => { for (const k of set) if (k.line.length > 1) D.poly3d(k.major ? major : minor, k.line.map((p) => [p[0], p[1], k.z]), false); };
  lay(c.existing, "GRD-EXIST-MINOR", "GRD-EXIST-MAJOR");
  lay(c.proposed, "GRD-PROP-MINOR", "GRD-PROP-MAJOR");
  for (const l of c.zero) if (l.length > 1) D.poly3d("GRD-CUTFILL", l.map((p) => [p[0], p[1], at(p[0], p[1])]), false);

  // pads and spot elevations
  const spots = new Map();
  const spot = (x, y, z) => { const k = `${x.toFixed(2)},${y.toFixed(2)}`; if (!spots.has(k)) spots.set(k, [x, y, z]); };
  for (const t of tierList(built)) {
    for (const poly of padPolygons(padOf(t))) {
      D.poly3d("GRD-PAD", poly.outer.map((p) => [p[0], p[1], t.padTop]), true);
      for (const h of poly.holes) D.poly3d("GRD-PAD", h.map((p) => [p[0], p[1], t.padTop]), true);
      for (const p of poly.outer) spot(p[0], p[1], t.padTop);
    }
  }

  // walls
  for (const w of wr) {
    D.poly3d("GRD-WALL", w.top, false);
    const s = w.profile.samples;
    if (!s.length) continue;
    const label = (p) => {
      D.text("GRD-WALL-TEXT", p.x, p.y, p.top, 2, `TOP ${elev(p.top)}`);
      D.text("GRD-WALL-TEXT", p.x, p.y - 2.5, p.bottom, 2, `BOT ${elev(p.bottom)}`);
    };
    const seen = new Set();
    for (const i of [0, w.profile.iMax, s.length - 1]) {
      if (seen.has(i)) continue;
      seen.add(i);
      if (i !== 0 && Math.hypot(s[i].x - s[0].x, s[i].y - s[0].y) < 1e-6) continue;       // a closed wall: the last point is the first
      label(s[i]);
    }
  }

  // drives and lots
  const feats = Array.isArray(built.features) ? built.features : [...(built.features && built.features.drives || []), ...(built.features && built.features.lots || [])];
  const zOf = (f, x, y) => (f && typeof f.z === "function" ? f.z(x, y) : at(x, y));
  const ringZ = (ring, f) => ring.map((p) => [p[0], p[1], zOf(f, p[0], p[1])]);
  for (const d of Array.isArray(state.drives) ? state.drives : []) {
    const f = feats.find((x) => x && x.kind === "drive" && x.id === d.id) || null;
    const ring = ringOf(f && f.ring);
    if (ring) D.poly3d("GRD-DRIVE", ringZ(ring, f), true);
    if (Array.isArray(d.line) && d.line.length > 1) {
      D.poly3d("GRD-DRIVE", d.line.map((p) => [p[0], p[1], zOf(f, p[0], p[1])]), false);
      for (const p of [d.line[0], d.line[d.line.length - 1]]) spot(p[0], p[1], zOf(f, p[0], p[1]));
    }
  }
  for (const l of Array.isArray(state.lots) ? state.lots : []) {
    const f = feats.find((x) => x && x.kind === "lot" && x.id === l.id) || null;
    const ring = ringOf(f && f.ring) || ringOf(l.ring);
    if (ring) D.poly3d("GRD-LOT", ringZ(ring, f), true);
  }

  // routes
  for (const r of rr) {
    if (r.points.length > 1) D.poly3d("GRD-ROUTE", r.points, false);
    if (r.points.length) { const a = r.points[0], b = r.points[r.points.length - 1]; spot(a[0], a[1], a[2]); spot(b[0], b[1], b[2]); }
  }

  // spots
  for (const [x, y, z] of spots.values()) {
    D.point("GRD-SPOT", x, y, z);
    D.text("GRD-SPOT", x + 1, y + 1, z, 1.5, elev(z));
  }

  // title and earthwork table, below the grid
  const lines = [`GRADING SKETCH - ${String(state.name || "Option")}`, "SKETCH ONLY - NOT A GRADING PLAN. VERIFY WITH THE CIVIL ENGINEER."];
  if (m) {
    lines.push(`CUT ${n1(m.cutCy)} CY`, `FILL ${n1(m.fillCy)} CY`, `NET ${n1(m.netCy)} CY (+ = IMPORT)`, `BALANCE ${m.balance.toFixed(2)}`,
      `PAD AREA ${n0(m.padArea)} SF`, `DISTURBED AREA ${n0(m.disturbedArea)} SF`, `TALLEST WALL ${n2(m.wallHeightMax)} FT`);
  }
  lines.push("EARTHWORK: GRID METHOD, PLUS OR MINUS 5 TO 10 PERCENT. NOT A TAKEOFF.");
  lines.forEach((s, k) => D.text("GRD-TEXT", g.x0, g.y0 - 20 - k * 4, 0, 2.5, s));

  // assemble
  const head = new Dxf();
  const ext = (a, d) => (isFinite(a) ? a : d);
  head.g(0, "SECTION"); head.g(2, "HEADER");
  head.g(9, "$ACADVER"); head.g(1, "AC1009");
  head.g(9, "$EXTMIN"); head.g(10, ext(D.min[0], 0)); head.g(20, ext(D.min[1], 0)); head.g(30, ext(D.min[2], 0));
  head.g(9, "$EXTMAX"); head.g(10, ext(D.max[0], 0)); head.g(20, ext(D.max[1], 0)); head.g(30, ext(D.max[2], 0));
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "TABLES");
  head.g(0, "TABLE"); head.g(2, "LTYPE"); head.g(70, 1);
  head.g(0, "LTYPE"); head.g(2, "CONTINUOUS"); head.g(70, 0); head.g(3, "Solid line"); head.g(72, 65); head.g(73, 0); head.g(40, 0);
  head.g(0, "ENDTAB");
  head.g(0, "TABLE"); head.g(2, "LAYER"); head.g(70, GRADING_DXF_LAYERS.length + 1);
  head.g(0, "LAYER"); head.g(2, "0"); head.g(70, 0); head.g(62, 7); head.g(6, "CONTINUOUS");
  for (const [name, color] of GRADING_DXF_LAYERS) { head.g(0, "LAYER"); head.g(2, name); head.g(70, 0); head.g(62, color); head.g(6, "CONTINUOUS"); }
  head.g(0, "ENDTAB");
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "ENTITIES");
  const tail = ["  0", "ENDSEC", "  0", "EOF"];
  return head.out.concat(D.out, tail).join("\n") + "\n";
}

/* ---------------- notes ---------------- */

/**
 * Notes file in Markdown (ASD-STE100 style: short sentences, active voice).
 * @param meta  optional { date, address, release, source ("standalone" | "project"), groundNote }
 */
export function notesMarkdown(state, built, metrics, meta) {
  if (!state) throw new Error('notesMarkdown: missing input "state".');
  if (!built) throw new Error('notesMarkdown: missing input "built".');
  if (!metrics) throw new Error('notesMarkdown: missing input "metrics".');
  const mt = meta || {};
  const g = groundData(built);
  const wr = wallRecords(state, built), rr = routeRecords(state, built, metrics);
  const m = metricsSummary(state, built, metrics, wr, rr);
  const date = mt.date || new Date().toISOString().slice(0, 10);
  const site = state.ground && state.ground.mode === "site";
  const pl = state.ground && state.ground.plane;
  const k = state.earthwork && isNum(state.earthwork.subdivide) ? state.earthwork.subdivide : 4;
  const bulking = state.earthwork && isNum(state.earthwork.bulking) ? state.earthwork.bulking : 1;
  const dl = state.daylight || {}, lim = state.limits || {};
  const minZ = (() => { let lo = Infinity; for (const v of g.pz) if (v < lo) lo = v; return lo; })();
  const skShift = Math.round(-minZ * 100) / 100 || 0;
  const skN = Math.abs(skShift).toFixed(2);

  const L = [];
  L.push(`# Grading Sketch: ${String(state.name || "Option")}`, "");
  L.push("This is a sketch for early coordination with the civil engineer. It is not a grading plan.", "");
  L.push(CAUTIONS[0], "");
  L.push("## Project", "");
  L.push(`- Option: ${String(state.name || "Option")}`);
  if (mt.address) L.push(`- Address: ${mt.address}`);
  L.push(`- Source: ${mt.source || state.source || "standalone"}`);
  L.push(`- Date: ${date}`);
  L.push(`- Ground: ${site ? "the Site Model grid (USGS 3D Elevation Program, NAVD88 feet)" : pl ? `a typed plane, ${pl.slope} percent, falling toward ${pl.downhill} degrees, elevation ${n2(pl.z0)} ft at the origin (local feet)` : "a typed plane"}`);
  if (mt.release) L.push(`- Overture release: ${mt.release}`);
  if (mt.groundNote) L.push(`- Ground note: ${mt.groundNote}`);
  L.push(`- Ground grid: ${g.n} by ${g.n} points, ${n0(g.n * g.n)} points in total, spacing ${g.spacing} ft`);
  L.push(`- Units: feet, square feet, and cubic yards (1 cubic yard = 27 cubic feet)`, "");

  L.push("## Earthwork", "");
  L.push("| Item | Value |", "|---|---|");
  L.push(`| Cut | ${n1(m.cutCy)} cy |`, `| Fill | ${n1(m.fillCy)} cy |`);
  L.push(`| Net (fill minus cut; positive = import) | ${m.netCy >= 0 ? "+" : "-"}${n1(Math.abs(m.netCy))} cy |`);
  L.push(`| Balance (smaller over larger) | ${m.balance.toFixed(2)} |`);
  L.push(`| Bulked net (bulking factor ${bulking.toFixed(2)}) | ${m.bulkedNetCy >= 0 ? "+" : "-"}${n1(Math.abs(m.bulkedNetCy))} cy |`);
  L.push(`| Pad area | ${n0(m.padArea)} sf |`, `| Disturbed area (change over 0.1 ft) | ${n0(m.disturbedArea)} sf |`, "");
  L.push(`Method: the tool splits each grid cell into ${k} by ${k} sub-cells. It compares the proposed and the existing ground at each sub-cell center. Balance mode: ${state.balance === "site" ? "site (the daylight slopes count)" : "pad (cut and fill inside the pad only)"}.`, "");
  L.push(CAUTIONS[1], "");

  const tiers = tierList(built);
  L.push("## Finished floor elevations", "");
  if (!tiers.length) L.push("No building is on the site.", "");
  else {
    L.push("| Tier | Source | FFE (ft) | Pad top (ft) | Existing min (ft) | Existing max (ft) |", "|---|---|---|---|---|---|");
    for (const t of tiers) { const id = tierIdentity(t, built); L.push(`| ${id.id} | ${id.source} | ${n2(t.ffe)} | ${n2(t.padTop)} | ${n2(t.existingMin)} | ${n2(t.existingMax)} |`); }
    L.push("");
    const stepMax = isNum(state.maxStep) ? state.maxStep : 4;
    L.push(`The tool warns when a step between tiers is more than ${n1(stepMax)} ft.`, "");
  }
  L.push(CAUTIONS[2], "");

  L.push("## Walls", "");
  if (!wr.length) L.push("No walls.", "");
  else {
    L.push("| Wall | Kind | Length (ft) | Tallest (ft) | Average (ft) | Status |", "|---|---|---|---|---|---|");
    const flag = isNum(lim.wallFlag) ? lim.wallFlag : 4;
    for (const w of wr) L.push(`| ${w.id} | ${w.kind} | ${n1(w.length)} | ${n2(w.heightMax)}${w.heightMax > flag ? " (over " + n1(flag) + " ft)" : ""} | ${n2(w.heightAvg)} | ${w.auto ? (w.accepted ? "accepted" : "not accepted (dashed)") : "accepted"} |`);
    L.push("");
  }
  L.push(CAUTIONS[4], "");

  L.push("## Daylight slopes", "");
  L.push(dl.on === false ? "Daylight slopes are off." : `Daylight slopes: ${dl.fill ?? 3}:1 in fill and ${dl.cut ?? 2}:1 in cut.`, "");
  L.push(CAUTIONS[3], "");

  L.push("## Routes", "");
  if (!rr.length) L.push("No routes.", "");
  else {
    L.push("| Route | Kind | Steepest running slope | Steepest cross slope |", "|---|---|---|---|");
    for (const r of rr) L.push(`| ${r.name} | ${r.kind} | ${pct(r.maxSlope)} | ${pct(r.maxCross)} |`);
    L.push("");
  }
  L.push(`Limits used: walk ${pct(isNum(lim.walk) ? lim.walk : 0.05)}, ramp ${pct(isNum(lim.ramp) ? lim.ramp : 0.0833)}, cross slope ${pct(isNum(lim.cross) ? lim.cross : 0.0208)}, rise per ramp run ${n1(isNum(lim.rampRise) ? lim.rampRise : 2.5)} ft.`, "");
  L.push(CAUTIONS[6], "");

  L.push("## Drives and lots", "");
  const drives = Array.isArray(state.drives) ? state.drives : [], lots = Array.isArray(state.lots) ? state.lots : [];
  if (!drives.length && !lots.length) L.push("No drives or lots.", "");
  else {
    for (const d of drives) L.push(`- Drive ${d.id}: ${pct((d.slope ?? 0) / 100)} along, width ${n1(d.width ?? 0)} ft`);
    for (const l of lots) L.push(`- Lot ${l.id}: ${pct((l.slope ?? 0) / 100)} along, ${pct((l.cross ?? 0) / 100)} across`);
    L.push("");
  }
  L.push(CAUTIONS[5], "");

  const warnings = (Array.isArray(metrics.warnings) ? metrics.warnings : Array.isArray(built.warnings) ? built.warnings : []).filter((w) => w && (w.message || w.code));
  L.push("## Warnings", "");
  if (!warnings.length) L.push("No warnings.", "");
  else { for (const w of warnings) L.push(`- ${w.code ? w.code + ": " : ""}${w.message || ""}`); L.push(""); }

  if (Array.isArray(built.notes) && built.notes.length) { L.push("## Build notes", ""); for (const s of built.notes) L.push(`- ${s}`); L.push(""); }

  L.push("## Data caution", "", CAUTIONS[7], "");
  L.push("## Revit import", "", "Both files use the project frame. They align when you import them as follows.", "");
  L.push("1. Ground: Massing & Site > Toposolid > Create from Import > Create from CSV. Select the CSV file. Choose Decimal feet.");
  L.push("2. Other layers: Insert > Import CAD. Select the DXF file. Set Positioning to Auto - Origin to Internal Origin. Set Units to Foot.", "");
  L.push("The CSV holds the proposed ground. The DXF holds the existing and proposed contours, pads, walls, routes, and spot elevations on the layers named GRD-.", "");
  L.push(skShift <= 0
    ? `SketchUp: use Extensions > CMRLM > Import Design Tools file. The model is lowered by ${skN} ft so the lowest proposed point is 0 ft. Add ${skN} ft to return to the tool elevations.`
    : `SketchUp: use Extensions > CMRLM > Import Design Tools file. The model is raised by ${skN} ft so the lowest proposed point is 0 ft. Subtract ${skN} ft to return to the tool elevations.`, "");
  return L.join("\n");
}
