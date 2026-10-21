/* ==========================================================================
   SITE: exports
   Revit CSV (ground points), DXF R12 (all other layers) and the notes file.
   Pure functions, no DOM. Input is the model bundle from model.js:
     { frame, ground, buildings, roads, trees, water }
   Spec: docs/site-tool-spec.md section 5.7.

   Choices where the spec is silent:
   - DXF is hand-written R12 (AC1009): HEADER, TABLES (LTYPE + LAYER), ENTITIES.
     Lines end with "\n". Group codes are right-aligned to 3 characters.
   - Building roofs and floors are triangulated by ear clipping. Holes are
     supported: each hole is joined to the outer ring by a bridge (a visible
     vertex pair). Walls are made for the outer ring and every hole.
     Triangles are written with 3 face indices (no 4th index).
   - Building layers: rule "estimate" goes to BLDG-ESTIMATE; "data" and
     "floors" go to BLDG-DATA.
   - Pavement, walk and water polylines are 2D closed polylines (flag 1) with
     the elevation in group 30: 0 for pavement and walks, the water level for
     water. Holes are separate closed polylines.
   - The topo mesh is one polyface mesh unless n*n > 32,000 vertices; then it
     is cut into bands of rows that share one boundary row.
   ========================================================================== */

import { summarize } from "./model.js";

export const DXF_LAYERS = [
  ["SITE-BOUNDARY", 1], ["TOPO-MESH", 8], ["BLDG-DATA", 7], ["BLDG-ESTIMATE", 30], ["ROAD-PAVEMENT", 8],
  ["WALK-PAVEMENT", 9], ["ROAD-CL", 2], ["WATER", 5], ["WATER-LINE", 4], ["TREE", 3],
];

export const CREDITS = "Elevation: USGS 3D Elevation Program. Buildings, roads, trees, water: Overture Maps Foundation, © OpenStreetMap contributors (ODbL), Microsoft ML Buildings. Geocoding: Nominatim / OpenStreetMap.";

/* ---------------- CSV ---------------- */

/** "x,y,z\n" for every ground node (row-major from the south), 3 decimals, no header. */
export function revitCsv(ground) {
  const { n, xs, ys, z } = ground;
  const rows = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) rows.push(`${xs[i].toFixed(3)},${ys[j].toFixed(3)},${z[j * n + i].toFixed(3)}`);
  return rows.join("\n") + "\n";
}

/* ---------------- triangulation (ear clipping with hole bridging) ---------------- */

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function ringArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

function segsCross(a, b, c, d) {      // proper intersection
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
const same = (p, q) => p[0] === q[0] && p[1] === q[1];

/**
 * Triangulate a polygon with holes. outer CCW, holes CW.
 * @returns {{pts:number[][], tris:number[][]}} pts = outer then holes; tris = index triples, CCW.
 */
export function triangulate(outer, holes = []) {
  const pts = outer.slice();
  const holeIdx = holes.map((h) => h.map((p) => { pts.push(p); return pts.length - 1; }));
  let loop = outer.map((_, i) => i);
  const inLoopSegs = (skipHoleIdx) => {
    const segs = [];
    for (let i = 0; i < loop.length; i++) segs.push([pts[loop[i]], pts[loop[(i + 1) % loop.length]]]);
    holeIdx.forEach((h, k) => { if (!skipHoleIdx.has(k)) for (let i = 0; i < h.length; i++) segs.push([pts[h[i]], pts[h[(i + 1) % h.length]]]); });
    return segs;
  };
  const used = new Set();
  const order = holeIdx.map((h, k) => k).sort((a, b) => Math.max(...holes[b].map((p) => p[0])) - Math.max(...holes[a].map((p) => p[0])));
  for (const k of order) {
    const h = holeIdx[k];
    let hi = 0;
    for (let i = 1; i < h.length; i++) if (pts[h[i]][0] > pts[h[hi]][0]) hi = i;
    const hp = pts[h[hi]];
    const segs = inLoopSegs(used);                       // merged loop + holes not merged yet (this one included)
    const cand = loop.map((vi, pos) => ({ pos, d: Math.hypot(pts[vi][0] - hp[0], pts[vi][1] - hp[1]) })).sort((a, b) => a.d - b.d);
    let best = cand[0].pos;
    for (const c of cand) {
      const vp = pts[loop[c.pos]];
      let ok = true;
      for (const [s, e] of segs) { if (!same(s, vp) && !same(e, vp) && !same(s, hp) && !same(e, hp) && segsCross(hp, vp, s, e)) { ok = false; break; } }
      if (ok) { const mid = [(hp[0] + vp[0]) / 2, (hp[1] + vp[1]) / 2]; if (!pointInLoop(mid, loop.map((i) => pts[i]))) ok = false; }
      if (ok) { best = c.pos; break; }
    }
    const seq = [];
    for (let i = 0; i <= h.length; i++) seq.push(h[(hi + i) % h.length]);       // hole starting and ending at the bridge vertex
    loop = loop.slice(0, best + 1).concat(seq, [loop[best]], loop.slice(best + 1));
    used.add(k);
  }

  const tris = [];
  const P = (i) => pts[i];
  let guard = loop.length * loop.length + 10;
  while (loop.length > 3 && guard-- > 0) {
    const m = loop.length;
    let earAt = -1, flatAt = -1;
    for (let i = 0; i < m; i++) {
      const a = P(loop[(i + m - 1) % m]), b = P(loop[i]), c = P(loop[(i + 1) % m]);
      const cr = cross(a, b, c);
      if (Math.abs(cr) < 1e-9) { if (flatAt < 0) flatAt = i; continue; }
      if (cr < 0) continue;
      let ok = true;
      for (let j = 0; j < m && ok; j++) {
        const q = P(loop[j]);
        if (same(q, a) || same(q, b) || same(q, c)) continue;
        if (cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0) ok = false;
      }
      if (ok) { earAt = i; break; }
    }
    if (earAt < 0) {
      if (flatAt >= 0) { loop.splice(flatAt, 1); continue; }
      earAt = 0;                                                    // give up on exactness: clip any vertex
    }
    tris.push([loop[(earAt + m - 1) % m], loop[earAt], loop[(earAt + 1) % m]]);
    loop.splice(earAt, 1);
  }
  if (loop.length === 3 && Math.abs(cross(P(loop[0]), P(loop[1]), P(loop[2]))) > 1e-9) tris.push(loop.slice());
  return { pts, tris: tris.filter((t) => cross(P(t[0]), P(t[1]), P(t[2])) > 1e-9) };
}

function pointInLoop(p, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/* ---------------- DXF writer ---------------- */

class Dxf {
  constructor() { this.out = []; this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity]; this.counts = {}; }
  g(code, v) { this.out.push(String(code).padStart(3, " "), typeof v === "number" && code >= 10 && code <= 59 ? fmt(v) : String(v)); }
  pt(x, y, z, c = 10) {
    this.g(c, x); this.g(c + 10, y); this.g(c + 20, z);
    const v = [x, y, z];
    for (let i = 0; i < 3; i++) { if (v[i] < this.min[i]) this.min[i] = v[i]; if (v[i] > this.max[i]) this.max[i] = v[i]; }
  }
  count(layer) { this.counts[layer] = (this.counts[layer] || 0) + 1; }
  /** Closed 2D polyline (flag 1) at elevation z. */
  closed2d(layer, ring, z) {
    this.count(layer);
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, z); this.g(70, 1);
    for (const p of ring) { this.g(0, "VERTEX"); this.g(8, layer); this.pt(p[0], p[1], z); }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  /** Open 3D polyline (flag 8), vertices flag 32. */
  line3d(layer, line) {
    this.count(layer);
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, 8);
    for (const p of line) { this.g(0, "VERTEX"); this.g(8, layer); this.pt(p[0], p[1], p[2]); this.g(70, 32); }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  /** Polyface mesh. faces: arrays of 3 or 4 one-based vertex indices (negative = invisible edge). */
  polyface(layer, verts, faces) {
    this.count(layer);
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, 0);
    this.g(70, 64); this.g(71, verts.length); this.g(72, faces.length);
    for (const v of verts) { this.g(0, "VERTEX"); this.g(8, layer); this.pt(v[0], v[1], v[2]); this.g(70, 192); }
    for (const f of faces) {
      this.g(0, "VERTEX"); this.g(8, layer); this.g(10, 0); this.g(20, 0); this.g(30, 0); this.g(70, 128);
      f.forEach((idx, k) => this.g(71 + k, idx));
    }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  circle(layer, x, y, z, r) { this.count(layer); this.g(0, "CIRCLE"); this.g(8, layer); this.pt(x, y, z); this.g(40, r); }
}

function fmt(v) {
  let s = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/0+$/, "");
  if (s.endsWith(".")) s += "0";
  return s === "-0.0" ? "0.0" : s;
}

function buildingMesh(b) {
  const rings = [b.ring, ...b.holes];
  const { pts, tris } = triangulate(b.ring, b.holes);
  const m = pts.length, z0 = b.base - 1, z1 = b.base + b.height;
  const verts = pts.map((p) => [p[0], p[1], z0]).concat(pts.map((p) => [p[0], p[1], z1]));
  const faces = [];
  for (const t of tris) { faces.push([t[0] + m + 1, t[1] + m + 1, t[2] + m + 1]); faces.push([t[0] + 1, t[2] + 1, t[1] + 1]); }
  let off = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = off + i, c = off + (i + 1) % r.length;
      faces.push([a + 1, c + 1, c + m + 1, a + m + 1]);
    }
    off += r.length;
  }
  return { verts, faces };
}

/**
 * DXF R12 text for every layer except the ground CSV points; the topo is also written as a polyface mesh.
 * @param model  { frame, ground, buildings, roads, trees, water }
 */
export function siteDxf(model) {
  const { frame, ground, buildings, roads, trees, water } = model;
  const D = new Dxf();
  const S = frame.size;

  D.closed2d("SITE-BOUNDARY", [[0, 0], [S, 0], [S, S], [0, S]], 0);

  // topo mesh in bands
  const n = ground.n;
  const rowsMax = Math.max(2, Math.floor(32000 / n));
  for (let j0 = 0; j0 < n - 1; j0 += rowsMax - 1) {
    const j1 = Math.min(j0 + rowsMax - 1, n - 1), rows = j1 - j0 + 1;
    const verts = [], faces = [];
    for (let j = j0; j <= j1; j++) for (let i = 0; i < n; i++) verts.push([ground.xs[i], ground.ys[j], ground.z[j * n + i]]);
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i + 1;
      faces.push([a, a + 1, a + n + 1, a + n]);
    }
    D.polyface("TOPO-MESH", verts, faces);
  }

  for (const b of buildings) {
    if (b.ring.length < 3) continue;
    const { verts, faces } = buildingMesh(b);
    D.polyface(b.rule === "estimate" ? "BLDG-ESTIMATE" : "BLDG-DATA", verts, faces);
  }

  for (const p of roads.pavement) { D.closed2d("ROAD-PAVEMENT", p.outer, 0); for (const h of p.holes) D.closed2d("ROAD-PAVEMENT", h, 0); }
  for (const p of roads.walks || []) { D.closed2d("WALK-PAVEMENT", p.outer, 0); for (const h of p.holes) D.closed2d("WALK-PAVEMENT", h, 0); }
  for (const s of roads.segments) if (s.line.length > 1) D.line3d("ROAD-CL", s.line);
  for (const a of water.areas) { D.closed2d("WATER", a.ring, a.level); for (const h of a.holes) D.closed2d("WATER", h, a.level); }
  for (const l of water.lines) if (l.length > 1) D.line3d("WATER-LINE", l);
  for (const t of trees) D.circle("TREE", t.x, t.y, t.z, t.canopy / 2);

  // assemble
  const head = new Dxf();
  head.g(0, "SECTION"); head.g(2, "HEADER");
  head.g(9, "$ACADVER"); head.g(1, "AC1009");
  head.g(9, "$EXTMIN"); head.g(10, D.min[0]); head.g(20, D.min[1]); head.g(30, D.min[2]);
  head.g(9, "$EXTMAX"); head.g(10, D.max[0]); head.g(20, D.max[1]); head.g(30, D.max[2]);
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "TABLES");
  head.g(0, "TABLE"); head.g(2, "LTYPE"); head.g(70, 1);
  head.g(0, "LTYPE"); head.g(2, "CONTINUOUS"); head.g(70, 0); head.g(3, "Solid line"); head.g(72, 65); head.g(73, 0); head.g(40, 0);
  head.g(0, "ENDTAB");
  head.g(0, "TABLE"); head.g(2, "LAYER"); head.g(70, DXF_LAYERS.length + 1);
  head.g(0, "LAYER"); head.g(2, "0"); head.g(70, 0); head.g(62, 7); head.g(6, "CONTINUOUS");
  for (const [name, color] of DXF_LAYERS) { head.g(0, "LAYER"); head.g(2, name); head.g(70, 0); head.g(62, color); head.g(6, "CONTINUOUS"); }
  head.g(0, "ENDTAB");
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "ENTITIES");
  const tail = ["  0", "ENDSEC", "  0", "EOF"];
  return head.out.concat(D.out, tail).join("\n") + "\n";
}

/* ---------------- notes ---------------- */

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * Notes file in Markdown (ASD-STE100 style: short sentences, active voice).
 * @param model  { frame, ground, buildings, roads, trees, water }
 * @param meta  { address, lat, lon, size, release, date }
 */
export function notesMarkdown(model, meta) {
  const s = summarize(model), g = model.ground, fr = model.frame;
  const lat = meta.lat ?? fr.lat0, lon = meta.lon ?? fr.lon0, size = meta.size ?? fr.size;
  const [oLon, oLat] = fr.toLonLat(0, 0);
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const rules = { data: 0, floors: 0, estimate: 0 };
  for (const b of model.buildings) rules[b.rule]++;
  const lines = [
    `# Site Model: ${meta.address || "Site"}`,
    "",
    `- Address: ${meta.address || "(none)"}`,
    `- Center: ${lat.toFixed(6)}, ${lon.toFixed(6)} (latitude, longitude)`,
    `- Origin (0, 0) at the southwest corner: ${oLat.toFixed(6)}, ${oLon.toFixed(6)}`,
    `- Size: ${size} ft by ${size} ft`,
    `- Ground grid: ${g.n} by ${g.n} points, ${n0(g.n * g.n)} points in total, spacing ${g.spacing} ft`,
    `- Overture release: ${meta.release || "unknown"}`,
    `- Date: ${date}`,
    "",
    "## What the model holds",
    "",
    `- Buildings: ${s.buildings}`,
    `- Road centerlines: ${n0(s.roadsFt)} ft in ${model.roads.segments.length} segments`,
    `- Pavement areas: ${model.roads.pavement.length}`,
    `- Walk areas: ${model.roads.walks ? model.roads.walks.length : "not included"}`,
    `- Trees: ${s.trees}`,
    `- Water areas: ${s.waterAreas}`,
    `- Water lines: ${model.water.lines.length}`,
    `- Ground elevation: ${n1(s.groundMin)} ft to ${n1(s.groundMax)} ft (NAVD88)`,
    g.filled ? `- Ground points without data: ${g.filled}. The tool filled them from the points near them.` : "- Ground points without data: 0",
    "",
    "## How building heights were set",
    "",
    `- Height from the data (measured or from the map source): ${rules.data} buildings`,
    `- Height from the floor count (12 ft for each floor): ${rules.floors} buildings`,
    `- Height estimated (24 ft): ${rules.estimate} buildings. The DXF puts these on layer BLDG-ESTIMATE.`,
    "- The base of each building is the lowest ground point at its corners and center. The solid starts 1 ft below the base.",
    "",
    "## Accuracy",
    "",
    "This model has about 75% of the accuracy of the full site3d tool. Use it for conceptual design only. Do not use it for survey, permit, or construction work.",
    "",
    "- Ground elevation: within 3 ft.",
    "- Building height: within 1 floor (12 ft).",
    "- Building position: within 10 ft.",
    "",
    "## North",
    "",
    "The model uses true north. Revit grid north is true north. State plane grid north is a little different from true north. The difference is small at this site size.",
    "",
    "## Data credits",
    "",
    CREDITS,
    "",
    "## Revit import",
    "",
    "Both files use the same origin. They align when you import them as follows.",
    "",
    "1. Ground: Massing & Site > Toposolid > Create from Import > Create from CSV. Select the CSV file. Choose Decimal feet.",
    "2. Other layers: Insert > Import CAD. Select the DXF file. Set Positioning to Auto - Origin to Internal Origin. Set Units to Foot.",
    "",
  ];
  return lines.join("\n");
}
