/* ==========================================================================
   parking/exports.js — Parking Deck Generator: DXF R12 and stall CSV (plan sections 4 and 9.1, tests 17 and 18)

   parkingDxf(state, built, parts) → DXF R12 text (AC1009), local (massing) frame, z = floor surface above baseZ
     parts (optional) { ramps, columnPoints, clearHeights }  rampsFor / columnsFor.points / clearHeights results.
           Without them the DXF reads built.ramps, built.columns and the computed fallbacks of derived.js.
     Layers  PARK-SLAB       plate outlines, one closed polyline per piece and hole, per level
             PARK-STALL      one closed polyline per standard, compact or EV stall
             PARK-ACCESSIBLE one closed polyline per accessible or van stall
             PARK-AISLE      aisle outlines, closed polylines
             PARK-RAMP       3D faces from each ramp's outer3d (a quad stays one face); a circular speed ramp also
                             writes its inside and outside circle (the true arc) at the lower level
             PARK-RAMP-SEG   circular speed ramp only: the centerline as `segments` straight 3D lines, rising with the ramp
             PARK-COLUMN     one closed square polyline per column per level
             PARK-CORE       one closed polyline per core per level
             PARK-TEXT       level labels, ramp slopes, core ids

   stallCsv(state, built) → "level,id,kind,ev_ready,x,y,width,depth\n…"
     x, y = stall center in the local frame (3 decimals); width = along the row (layout x), depth = along the stall (layout y).
     ev_ready is true or false. One row per final stall, in level order.

   parkTriangulate(ring) → [[i, j, k], …]   ear clipping of a simple plan ring [[x, y, …], …]; shared with sketchup.js.

   Pure: no DOM. Units: feet.
   ========================================================================== */

import { parkingDerived, localMapper } from "./derived.js";

export const PARK_DXF_LAYERS = [
  ["PARK-SLAB", 8], ["PARK-STALL", 7], ["PARK-ACCESSIBLE", 5], ["PARK-AISLE", 9], ["PARK-RAMP", 3],
  ["PARK-RAMP-SEG", 2], ["PARK-COLUMN", 1], ["PARK-CORE", 6], ["PARK-TEXT", 7],
];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000;

/* ---------- ear clipping (simple ring, no holes) ---------- */

const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function parkTriangulate(ring) {
  const n = ring.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const loop = ring.map((_, i) => i);
  if (area < 0) loop.reverse();                                   // work counter-clockwise
  const tris = [];
  let guard = n * n + 10;
  while (loop.length > 3 && guard-- > 0) {
    const m = loop.length;
    let ear = -1;
    for (let i = 0; i < m && ear < 0; i++) {
      const a = ring[loop[(i + m - 1) % m]], b = ring[loop[i]], c = ring[loop[(i + 1) % m]];
      if (cross2(a, b, c) <= 1e-9) continue;
      let ok = true;
      for (let j = 0; j < m && ok; j++) {
        const q = ring[loop[j]];
        if (q === a || q === b || q === c) continue;
        if (cross2(a, b, q) >= 0 && cross2(b, c, q) >= 0 && cross2(c, a, q) >= 0) ok = false;
      }
      if (ok) ear = i;
    }
    if (ear < 0) ear = 0;                                         // give up on exactness: clip any vertex
    tris.push([loop[(ear + m - 1) % m], loop[ear], loop[(ear + 1) % m]]);
    loop.splice(ear, 1);
  }
  if (loop.length === 3) tris.push(loop.slice());
  return tris.filter((t) => Math.abs(cross2(ring[t[0]], ring[t[1]], ring[t[2]])) > 1e-9);
}

/* ---------- DXF writer ---------- */

function fmt(v) {
  let s = (Math.round(v * 1e4) / 1e4).toFixed(4).replace(/0+$/, "");
  if (s.endsWith(".")) s += "0";
  return s === "-0.0" ? "0.0" : s;
}

class Dxf {
  constructor() { this.out = []; this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity]; }
  g(code, v) { this.out.push(String(code).padStart(3, " "), typeof v === "number" && code >= 10 && code <= 59 ? fmt(v) : String(v)); }
  pt(x, y, z, c = 10) {
    this.g(c, x); this.g(c + 10, y); this.g(c + 20, z);
    const v = [x, y, z];
    for (let i = 0; i < 3; i++) { if (v[i] < this.min[i]) this.min[i] = v[i]; if (v[i] > this.max[i]) this.max[i] = v[i]; }
  }
  /** Closed 2D polyline (flag 1) at elevation z. */
  closed2d(layer, ring, z) {
    this.g(0, "POLYLINE"); this.g(8, layer); this.g(66, 1); this.g(10, 0); this.g(20, 0); this.g(30, z); this.g(70, 1);
    for (const p of ring) { this.g(0, "VERTEX"); this.g(8, layer); this.pt(p[0], p[1], z); }
    this.g(0, "SEQEND"); this.g(8, layer);
  }
  /** 3DFACE with 3 or 4 corners (a triangle repeats its third corner). */
  face(layer, pts) {
    this.g(0, "3DFACE"); this.g(8, layer);
    const q = pts.length === 3 ? [...pts, pts[2]] : pts;
    q.forEach((p, k) => this.pt(p[0], p[1], p[2], 10 + k));
  }
  line(layer, a, b) { this.g(0, "LINE"); this.g(8, layer); this.pt(a[0], a[1], a[2]); this.pt(b[0], b[1], b[2], 11); }
  circle(layer, x, y, z, r) { this.g(0, "CIRCLE"); this.g(8, layer); this.pt(x, y, z); this.g(40, r); }
  text(layer, x, y, z, height, s) { this.g(0, "TEXT"); this.g(8, layer); this.pt(x, y, z); this.g(40, height); this.g(1, String(s).replace(/[^\x20-\x7e]/g, "?")); }
}

const bboxOf = (ring) => {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

function partsOf(built, parts) {
  const p = parts || {};
  return {
    ramps: Array.isArray(p.ramps) ? p.ramps : Array.isArray(built.ramps) ? built.ramps : [],
    columnPoints: p.columnPoints,
    clearHeights: p.clearHeights,
  };
}

export function parkingDxf(state, built, parts) {
  if (!state) throw new Error('parkingDxf: missing input "state".');
  if (!built || !Array.isArray(built.levels)) throw new Error('parkingDxf: missing input "built.levels".');
  const pr = partsOf(built, parts);
  const map = localMapper(built);
  const d = parkingDerived(state, built, { ramps: pr.ramps, columnPoints: pr.columnPoints, clearHeights: pr.clearHeights });
  const col = (state.grid && state.grid.column) || 2;
  const D = new Dxf();

  d.levels.forEach((lv, i) => {
    const z = lv.z, src = built.levels[i] || {};
    for (const pc of lv.plate) { D.closed2d("PARK-SLAB", pc.outer, z); for (const h of pc.holes) D.closed2d("PARK-SLAB", h, z); }
    for (const pc of lv.aisles) { D.closed2d("PARK-AISLE", pc.outer, z); for (const h of pc.holes) D.closed2d("PARK-AISLE", h, z); }
    for (const s of lv.stalls) D.closed2d(s.kind === "accessible" || s.kind === "van" ? "PARK-ACCESSIBLE" : "PARK-STALL", s.outer, z);
    for (const c of lv.cores) { D.closed2d("PARK-CORE", c.outer, z); const b = bboxOf(c.outer); D.text("PARK-TEXT", b[0] + 1, b[1] + 1, z, 1.5, c.id); }
    for (const c of lv.columns) D.closed2d("PARK-COLUMN", [[c[0] - col / 2, c[1] - col / 2], [c[0] + col / 2, c[1] - col / 2], [c[0] + col / 2, c[1] + col / 2], [c[0] - col / 2, c[1] + col / 2]], z);
    const outerAll = lv.plate.flatMap((pc) => pc.outer);
    if (outerAll.length) {
      const b = bboxOf(outerAll);
      D.text("PARK-TEXT", b[0], b[1] - 6, z, 3, `LEVEL ${lv.index}  Z ${fmt(z)}  ${lv.stalls.length} STALLS${isNum(src.ftf) ? `  FTF ${fmt(src.ftf)}` : ""}`);
    }
    for (const rp of lv.ramps) {
      const pts = rp.outer3d;
      if (pts.length === 4) D.face("PARK-RAMP", pts);
      else for (const t of parkTriangulate(pts)) D.face("PARK-RAMP", [pts[t[0]], pts[t[1]], pts[t[2]]]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      D.text("PARK-TEXT", cx, cy, Math.min(...pts.map((p) => p[2])), 2, `${rp.id} ${fmt(Math.round(rp.slope * 1000) / 10)} PCT`);
    }
  });

  // circular speed ramp: true arc (circles) and straight segments
  const sp = (state.ramp && state.ramp.speed) || {};
  if (state.ramp && state.ramp.type === "speed" && sp.shape === "circular") {
    const N = sp.segments || 12, rIn = sp.insideRadius || 30, w = sp.width || 24;
    for (const rp of pr.ramps) {
      if (!rp || rp.type !== "speed" || !Array.isArray(rp.footprint) || !rp.footprint.length) continue;
      const lv = d.levels.find((l) => l.index === rp.level);
      if (!lv) continue;
      const b = bboxOf(rp.footprint), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      const cl = map(c), rise = isNum(rp.rise) ? rp.rise : 0;
      D.circle("PARK-RAMP", cl[0], cl[1], lv.z, rIn);
      D.circle("PARK-RAMP", cl[0], cl[1], lv.z, rIn + w);
      const rm = rIn + w / 2, at = (k) => {
        const a = (2 * Math.PI * k) / N, q = map([c[0] + rm * Math.cos(a), c[1] + rm * Math.sin(a)]);
        return [r3(q[0]), r3(q[1]), r3(lv.z + (rise * k) / N)];
      };
      for (let k = 0; k < N; k++) D.line("PARK-RAMP-SEG", at(k), at(k + 1));
    }
  }

  const head = new Dxf();
  head.g(0, "SECTION"); head.g(2, "HEADER");
  head.g(9, "$ACADVER"); head.g(1, "AC1009");
  const lo = D.min.map((v) => (isFinite(v) ? v : 0)), hi = D.max.map((v) => (isFinite(v) ? v : 0));
  head.g(9, "$EXTMIN"); head.g(10, lo[0]); head.g(20, lo[1]); head.g(30, lo[2]);
  head.g(9, "$EXTMAX"); head.g(10, hi[0]); head.g(20, hi[1]); head.g(30, hi[2]);
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "TABLES");
  head.g(0, "TABLE"); head.g(2, "LTYPE"); head.g(70, 1);
  head.g(0, "LTYPE"); head.g(2, "CONTINUOUS"); head.g(70, 0); head.g(3, "Solid line"); head.g(72, 65); head.g(73, 0); head.g(40, 0);
  head.g(0, "ENDTAB");
  head.g(0, "TABLE"); head.g(2, "LAYER"); head.g(70, PARK_DXF_LAYERS.length + 1);
  head.g(0, "LAYER"); head.g(2, "0"); head.g(70, 0); head.g(62, 7); head.g(6, "CONTINUOUS");
  for (const [name, color] of PARK_DXF_LAYERS) { head.g(0, "LAYER"); head.g(2, name); head.g(70, 0); head.g(62, color); head.g(6, "CONTINUOUS"); }
  head.g(0, "ENDTAB");
  head.g(0, "ENDSEC");
  head.g(0, "SECTION"); head.g(2, "ENTITIES");
  const tail = ["  0", "ENDSEC", "  0", "EOF"];
  return head.out.concat(D.out, tail).join("\n") + "\n";
}

/* ---------- stall CSV ---------- */

const csvCell = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function stallCsv(state, built) {
  if (!built || !Array.isArray(built.levels)) throw new Error('stallCsv: missing input "built.levels".');
  const map = localMapper(built);
  const rows = ["level,id,kind,ev_ready,x,y,width,depth"];
  built.levels.forEach((l, i) => {
    const index = isNum(l.index) ? l.index : i + 1;
    for (const s of l.stalls || []) {
      if (!s || !Array.isArray(s.outer) || s.outer.length < 3) continue;
      const b = bboxOf(s.outer), c = map([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
      rows.push([index, csvCell(s.id), csvCell(s.kind || "standard"), s.evReady ? "true" : "false", c[0].toFixed(3), c[1].toFixed(3), (b[2] - b[0]).toFixed(3), (b[3] - b[1]).toFixed(3)].join(","));
    }
  });
  return rows.join("\n") + "\n";
}
