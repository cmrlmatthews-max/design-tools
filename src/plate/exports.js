/* ==========================================================================
   plate/exports.js — rooms CSV, DXF R12, and the notes file
   (docs/plate-planner-technical-plan.md section 4 "Rooms CSV columns" and "DXF layers"; notes section 8)

   roomsCsv(derived, placement)         CSV text. Two comment lines, a header, one row per unit.
   plateDxf(derived, state)             DXF R12 (AC1009), feet, plate frame, hand-written like src/site/exports.js.
   notesMarkdown(state, built, metrics, meta)   Markdown notes in ASD-STE100 style: the area rule, the mix, the metrics, every Caution.

   Rooms CSV
     line 1   "# placement x=<x>, y=<y>, rotation=<deg>, baseZ=<ft>"      (the placement of the plates section; zeros without a project)
     line 2   "# area rule: ...; nrsf = the NRSF of the whole level"
     line 3   level_index, level_name, unit_id, type, area_sf, cx, cy, z, nrsf, exposures, corner, accessible, bay_from, bay_to
     rows     one per unit, levels in index order, units in run order. cx, cy: a point inside the unit (the centroid when it is inside),
              plate frame, 3 decimals. z: the floor surface above baseZ. nrsf: the level NRSF (repeated). exposures: "S E" (space separated).
              corner, accessible: true or false ("roll-in" or similar text when the fill wrote text). bay_from, bay_to: empty without a bay.

   DXF layers (PLATE_DXF_LAYERS), every level of derived.levels at its own z (3D polylines and lines carry the z):
     PLATE            the plate outline (closed polylines, holes included)
     UNIT-LINE        the demising lines (LINE, two per unit)
     UNIT-AREA        the unit outlines (closed polylines)
     CORRIDOR         the clear corridor outline
     CORRIDOR-WALL    the corridor wall lines (the corridor face offset into the units by corridor.wall)
     CORE, STAIR, ELEV, SUPPORT   outlines
     TEXT             "<type> <id>" and "<area> SF" at each unit label point; the title and the area rule below the lowest plate

   Pure: no DOM, no input mutation. Reads the derived object (platesDerived) and, for the notes, the build.
   ========================================================================== */

import { platesDerived, corridorWallLines, labelPoint, typeTable, corridorWidth, wallThickness, levelRecords, r1 } from "./derived.js";

export const PLATE_DXF_LAYERS = [
  ["PLATE", 7], ["UNIT-LINE", 1], ["UNIT-AREA", 5], ["CORRIDOR", 8], ["CORRIDOR-WALL", 9],
  ["CORE", 3], ["STAIR", 4], ["ELEV", 6], ["SUPPORT", 30], ["TEXT", 2],
];

export const AREA_RULE = "Unit area runs to the centerline of the demising walls, the corridor face of the corridor wall, and the inside face of the exterior wall.";

export const CAUTIONS = [
  "Caution: the Plate Planner makes a test fit for early design. Unit counts, areas, corridor lengths, and accessible counts are design-stage numbers. The tool never checks a code and never says \"compliant\".",
  "Caution: NRSF here follows the area rule above. It is not a leasing area, a BOMA area, or a legal area. Check the area rule before you use NRSF in a pro forma.",
  "Caution: the accessible counts are seeds for an editable table. Verify every count against the adopted code and its amendments.",
  "Caution: the tool reports distances (stair door paths, dead ends, housekeeping reach). It does not check them. The adopted code and the authority having jurisdiction decide.",
  "Caution: the unit outlines are not unit plans. Walls, bedrooms, baths, and doors inside a unit stay for the design team.",
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const n0 = (v) => Math.round(v).toLocaleString("en-US");
const n1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
const pct = (v) => `${(Math.round(v * 1000) / 10).toFixed(1)} percent`;

function plc(p) {
  const n = (v) => (isNum(v) ? v : 0);
  return p && typeof p === "object" ? { x: n(p.x), y: n(p.y), rotation: n(p.rotation), baseZ: n(p.baseZ) } : { x: 0, y: 0, rotation: 0, baseZ: 0 };
}

/* ---------------- rooms CSV ---------------- */

const csvCell = (v) => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export const CSV_COLUMNS = ["level_index", "level_name", "unit_id", "type", "area_sf", "cx", "cy", "z", "nrsf", "exposures", "corner", "accessible", "bay_from", "bay_to"];

export function roomsCsv(derived, placement) {
  if (!derived || !Array.isArray(derived.levels)) throw new Error('roomsCsv: missing input "derived.levels".');
  const p = plc(placement);
  const lines = [
    `# placement x=${p.x}, y=${p.y}, rotation=${p.rotation}, baseZ=${p.baseZ}`,
    `# area rule: ${AREA_RULE} nrsf = the NRSF of the whole level.`,
    CSV_COLUMNS.join(","),
  ];
  const levels = derived.levels.slice().sort((a, b) => a.index - b.index);
  for (const lv of levels) {
    const z = isNum(lv.z) ? lv.z : 0;
    const nrsf = lv.metrics && isNum(lv.metrics.nrsf) ? lv.metrics.nrsf : r1((lv.units || []).reduce((s, u) => s + (isNum(u.area) ? u.area : 0), 0));
    for (const u of lv.units || []) {
      const [cx, cy] = labelPoint(u.outer);
      lines.push([
        lv.index, lv.name ?? `Level ${lv.index}`, u.id, u.type, n1(u.area).replace(/,/g, ""), n3(cx), n3(cy), n3(z), n1(nrsf).replace(/,/g, ""),
        (u.exposures || []).join(" "), u.corner ? "true" : "false", u.accessible ? (typeof u.accessible === "string" ? u.accessible : "true") : "false",
        u.bay && isNum(u.bay.from) ? n3(u.bay.from) : "", u.bay && isNum(u.bay.to) ? n3(u.bay.to) : "",
      ].map(csvCell).join(","));
    }
  }
  return lines.join("\n") + "\n";
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
  /** Polyline of 3D vertices at height z (flag 8; closed = flag 9), vertices flag 32. */
  poly(layer, ring, z, closed) {
    this.count(layer);
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, closed ? 9 : 8);
    for (const p of ring) { this.g(0, "VERTEX"); this.g(8, layer); this.pt(p[0], p[1], z); this.g(70, 32); }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  line(layer, a, b, z) {
    this.count(layer);
    this.g(0, "LINE"); this.g(8, layer); this.pt(a[0], a[1], z, 10); this.pt(b[0], b[1], z, 11);
  }
  text(layer, x, y, z, h, s) {
    this.count(layer);
    this.g(0, "TEXT"); this.g(8, layer); this.pt(x, y, z); this.g(40, h); this.g(1, String(s).replace(/[^\x20-\x7e]/g, "?"));
  }
}

/** The DXF text of a derived object. See the file header for the layers. */
export function plateDxf(derived, state) {
  if (!derived || !Array.isArray(derived.levels)) throw new Error('plateDxf: missing input "derived.levels".');
  const D = new Dxf();
  const wall = wallThickness(state || {});
  const name = String((state && state.name) || "Option");
  let minY = Infinity, minX = Infinity;
  for (const lv of derived.levels.slice().sort((a, b) => a.index - b.index)) {
    const z = isNum(lv.z) ? lv.z : 0;
    const closed = (layer, ring) => { if (ring && ring.length > 2) D.poly(layer, ring, z, true); };
    for (const pc of lv.plate || []) {
      closed("PLATE", pc.outer); for (const h of pc.holes || []) closed("PLATE", h);
      for (const p of pc.outer) { if (p[1] < minY) minY = p[1]; if (p[0] < minX) minX = p[0]; }
    }
    for (const pc of lv.corridor || []) { closed("CORRIDOR", pc.outer); for (const h of pc.holes || []) closed("CORRIDOR", h); }
    for (const l of corridorWallLines(lv, wall)) D.line("CORRIDOR-WALL", l[0], l[1], z);
    const core = lv.core || {};
    closed("CORE", core.outer);
    for (const s of core.stairs || []) closed("STAIR", s.outer);
    for (const e of core.elevators || []) closed("ELEV", e.outer);
    for (const s of lv.support || []) closed("SUPPORT", s.outer);
    for (const u of lv.units || []) {
      closed("UNIT-AREA", u.outer);
      for (const l of u.demising || []) D.line("UNIT-LINE", l[0], l[1], z);
      const [cx, cy] = labelPoint(u.outer);
      const a = `${u.type} ${u.id}`, b = `${n0(u.area)} SF`;
      D.text("TEXT", cx - a.length * 0.45, cy + 0.4, z, 1.5, a);
      D.text("TEXT", cx - b.length * 0.45, cy - 1.8, z, 1.5, b);
    }
  }
  // title and area rule, below the lowest plate
  const x0 = isFinite(minX) ? minX : 0, y0 = isFinite(minY) ? minY - 12 : -12;
  const title = [
    `PLATE PLANNER - ${name}`,
    "SKETCH ONLY - A TEST FIT FOR EARLY DESIGN. IT CHECKS NO CODE.",
    "AREA RULE: UNIT AREA TO THE CENTERLINE OF DEMISING WALLS, THE CORRIDOR FACE OF THE CORRIDOR WALL, AND THE INSIDE FACE OF THE EXTERIOR WALL.",
  ];
  if (derived.metrics) title.push(`UNITS ${derived.metrics.units}   NRSF ${n0(derived.metrics.nrsf)} SF   GSF ${n0(derived.metrics.gsf)} SF   EFFICIENCY ${(derived.metrics.efficiency * 100).toFixed(1)} PERCENT`);
  title.forEach((s, k) => D.text("TEXT", x0, y0 - k * 3.5, 0, 2, s));

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
  head.g(0, "TABLE"); head.g(2, "LAYER"); head.g(70, PLATE_DXF_LAYERS.length + 1);
  head.g(0, "LAYER"); head.g(2, "0"); head.g(70, 0); head.g(62, 7); head.g(6, "CONTINUOUS");
  for (const [lname, color] of PLATE_DXF_LAYERS) { head.g(0, "LAYER"); head.g(2, lname); head.g(70, 0); head.g(62, color); head.g(6, "CONTINUOUS"); }
  head.g(0, "ENDTAB");
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "ENTITIES");
  const tail = ["  0", "ENDSEC", "  0", "EOF"];
  return head.out.concat(D.out, tail).join("\n") + "\n";
}

/* ---------------- notes ---------------- */

/** The first number found at any of the dotted paths, else null. */
function dig(obj, ...paths) {
  for (const p of paths) {
    let v = obj;
    for (const k of p.split(".")) { if (v === null || v === undefined || typeof v !== "object") { v = undefined; break; } v = v[k]; }
    if (isNum(v)) return v;
  }
  return null;
}

function groupLabel(g, derived) {
  if (g.label) return String(g.label);
  const idx = (Array.isArray(g.levels) ? g.levels : []).map((e) => (isNum(e) ? e : e && e.index)).filter(isNum).sort((a, b) => a - b);
  if (!idx.length) return String(g.id ?? "Group");
  const n = idx.length;
  const contiguous = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
  const span = n === 1 ? `Level ${idx[0]}` : contiguous ? `Levels ${idx[0]}-${idx[n - 1]}` : `Levels ${idx.join(", ")}`;
  return `${span} (${n} floor${n === 1 ? "" : "s"})`;
}

/**
 * Notes file in Markdown (ASD-STE100 style: short sentences, active voice).
 * metrics is optional (the computeMetrics result): stair door path, dead ends (groups[].row.stairDoors), the fill mix targets
 * (building.mix) and the warnings are read from it when present.
 * @param meta  optional { date, address, source ("drawn" | "project"), massingName }
 */
export function notesMarkdown(state, built, metrics, meta) {
  if (!state) throw new Error('notesMarkdown: missing input "state".');
  if (!built) throw new Error('notesMarkdown: missing input "built".');
  const mt = meta || {};
  const m = metrics || {};
  const derived = platesDerived(state, built, metrics);
  const table = typeTable(state);
  const hotel = derived.mode === "hotel";
  const unitWord = hotel ? "keys" : "units";
  const date = mt.date || new Date().toISOString().slice(0, 10);
  const recs = levelRecords(built);
  const first = recs[0] && recs[0].fill;
  const kind = (first && (first.kind || first.corridorKind)) || (state.corridor && state.corridor.kind) || "auto";
  const pl = built.placement || state.placement || null;
  const p = plc(pl);
  const total = derived.metrics.units;

  const L = [];
  L.push(`# Plate Planner: ${String(state.name || "Option")}`, "");
  L.push("This is a test fit for early design. It is not a unit plan and it checks no code.", "");
  L.push(CAUTIONS[0], "");

  L.push("## Project", "");
  L.push(`- Option: ${String(state.name || "Option")}`);
  if (mt.address) L.push(`- Address: ${mt.address}`);
  L.push(`- Source: ${mt.source || state.source || "drawn"}`);
  L.push(`- Mode: ${derived.mode}`);
  L.push(`- Date: ${date}`);
  if (derived.massingUpdatedAt) L.push(`- Massing updated: ${derived.massingUpdatedAt}`);
  L.push(`- Placement: x ${p.x}, y ${p.y}, rotation ${p.rotation} degrees, base z ${p.baseZ} ft`);
  L.push("- Units: feet and square feet. Coordinates are in the plate frame (the massing local frame).", "");

  L.push("## Area rule", "");
  L.push(AREA_RULE, "");
  L.push(`- Exterior wall allowance: ${n1(isNum(state.extWall) ? state.extWall : 1)} ft, taken from the plate edge.`);
  L.push(`- Corridor wall: ${n1(wallThickness(state))} ft. The unit area includes it.`);
  L.push("- NRSF is the sum of the unit areas. GSF is the plate area. Efficiency is NRSF divided by GSF.", "");
  L.push(CAUTIONS[1], "");

  L.push("## Corridor and core", "");
  L.push(`- Corridor type: ${kind}`);
  L.push(`- Clear corridor width: ${n1(corridorWidth(state))} ft`);
  L.push(`- Stairs: ${state.stairs && state.stairs.mode ? state.stairs.mode : "auto"}`);
  // metrics.js (computeMetrics) keeps the corridor graph numbers per group: groups[].row.stairDoors { pathFt, deadEnds }
  const sdoors = (Array.isArray(m.groups) ? m.groups : []).map((g) => g && g.row && g.row.stairDoors).filter(Boolean);
  const stairPath = dig(m, "stairPathFt", "corridor.stairPathFt", "building.stairPathFt", "building.corridor.stairPathFt")
    ?? (sdoors.length && sdoors.every((s) => isNum(s.pathFt)) ? Math.max(...sdoors.map((s) => s.pathFt)) : null);
  if (stairPath !== null) L.push(`- Stair door path (farthest two doors, along the corridor): ${n1(stairPath)} ft`);
  const dead = m.deadEnds || (m.building && m.building.deadEnds) || (m.corridor && m.corridor.deadEnds) || (sdoors.length ? sdoors.flatMap((s) => s.deadEnds || []) : null);
  if (Array.isArray(dead)) {
    if (!dead.length || dead.every((d) => !(d.ft > 0))) L.push("- Dead ends: none");
    else for (const d of dead) L.push(`- Dead end at stair ${d.stairId}: ${n1(d.ft)} ft`);
  }
  L.push(`- Corridor length, all levels: ${n0(derived.metrics.corridorFt)} ft`, "");
  L.push(CAUTIONS[3], "");

  L.push("## Unit mix", "");
  const shareSum = table.reduce((s, t) => s + t.share, 0) || 1;
  L.push(`| Type | Target share | Target ${unitWord} | Placed | Placed share | Average area (sf) |`, "|---|---|---|---|---|---|");
  const scored = m.building && Array.isArray(m.building.mix) ? m.building.mix : [];     // computeMetrics: the fill targets, by type id
  for (const t of table) {
    const placed = derived.mix.find((r) => r.type === t.name);
    const tg = t.share / shareSum, sc = scored.find((r) => r.type === t.id);
    L.push(`| ${t.name} | ${pct(tg)} | ${n1(sc && isNum(sc.target) ? sc.target : tg * total)} | ${placed ? placed.count : 0} | ${pct(placed ? placed.share : 0)} | ${placed ? n1(placed.avgArea) : "-"} |`);
  }
  for (const r of derived.mix) if (!table.some((t) => t.name === r.type)) L.push(`| ${r.type} | - | - | ${r.count} | ${pct(r.share)} | ${n1(r.avgArea)} |`);
  L.push("", "The target shares come from the mix table. Small plates often miss the targets. The totals for the whole building come closer.", "");

  L.push("## Metrics", "");
  L.push("| Item | Value |", "|---|---|");
  L.push(`| ${hotel ? "Keys" : "Units"}, whole building | ${total} |`);
  if (hotel && isNum(derived.metrics.bays)) L.push(`| Bays | ${derived.metrics.bays} |`);
  L.push(`| NRSF | ${n1(derived.metrics.nrsf)} sf |`, `| GSF | ${n1(derived.metrics.gsf)} sf |`, `| Efficiency | ${pct(derived.metrics.efficiency)} |`);
  if (total) L.push(`| Average ${hotel ? "key" : "unit"} area | ${n1(derived.metrics.nrsf / total)} sf |`);
  L.push("");
  const groups = (Array.isArray(built.groups) ? built.groups : []).filter((g) => g && g.fill);
  if (groups.length) {
    L.push("| Level group | Floors | " + (hotel ? "Keys" : "Units") + " per floor | NRSF per floor (sf) | Efficiency |", "|---|---|---|---|---|");
    for (const g of groups) {
      const idx = (Array.isArray(g.levels) ? g.levels : []).map((e) => (isNum(e) ? e : e && e.index));
      const lv = derived.levels.find((l) => idx.includes(l.index));
      if (lv) L.push(`| ${groupLabel(g, derived)} | ${idx.length} | ${lv.metrics.units} | ${n1(lv.metrics.nrsf)} | ${pct(lv.metrics.efficiency)} |`);
    }
    L.push("");
  }

  L.push("## Accessible", "");
  const acc = derived.levels.reduce((s, l) => s + l.units.filter((u) => u.accessible).length, 0);
  const roll = derived.levels.reduce((s, l) => s + l.units.filter((u) => u.accessible === "roll-in").length, 0);
  L.push(`- Accessible ${hotel ? "keys" : "units"} placed, whole building: ${acc}${hotel && roll ? ` (${roll} roll-in)` : ""}`);
  const ac = state.accessible || {};
  if (!hotel && ac.multifamily) L.push(`- Source row: ${pct(ac.multifamily.typeAShare ?? 0)} of the units, at least ${ac.multifamily.minUnits ?? 0}, when the building has more than ${ac.multifamily.over ?? 0} units.`);
  if (hotel && Array.isArray(ac.hotel)) L.push(`- Source table (keys up to, accessible, roll-in): ${ac.hotel.map((r) => `${r[0]}: ${r[1]}, ${r[2]}`).join("; ")}`);
  L.push("");
  L.push(CAUTIONS[2], "");

  const raw = [...(Array.isArray(built.warnings) ? built.warnings : []), ...recs.flatMap((r) => (Array.isArray(r.fill.warnings) ? r.fill.warnings : [])), ...(Array.isArray(m.warnings) ? m.warnings : [])];
  const seen = new Set(), warnings = [];
  for (const w of raw) {
    if (!w) continue;
    const where = w && w.where ? (typeof w.where === "object" ? Object.entries(w.where).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object").map(([k, v]) => `${k} ${v}`).join(", ") : String(w.where)) : "";
    const s = typeof w === "string" ? w : `${w.code ? w.code + (where ? ` (${where})` : "") + ": " : ""}${w.message || ""}`;
    if (s && !seen.has(s)) { seen.add(s); warnings.push(s); }
  }
  L.push("## Warnings", "");
  if (!warnings.length) L.push("No warnings.", "");
  else { for (const s of warnings) L.push(`- ${s}`); L.push(""); }

  if (Array.isArray(built.notes) && built.notes.length) { L.push("## Build notes", ""); for (const s of built.notes) L.push(`- ${s}`); L.push(""); }

  L.push("## Import", "");
  L.push("1. Rooms: use the rooms CSV with a pyRevit script. The script places a room at (cx, cy) on each level at the z in the file. The first comment line holds the placement. Rooms get the plate frame coordinates.");
  L.push("2. Lines: Insert > Import CAD. Select the DXF file. Set Positioning to Auto - Origin to Internal Origin. Set Units to Foot.");
  L.push("3. SketchUp: use Extensions > CMRLM > Import Design Tools file.", "");
  L.push(CAUTIONS[4], "");
  return L.join("\n");
}
