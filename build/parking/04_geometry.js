/* ==========================================================================
   GEOMETRY HELPERS
   Small plan helpers shared by the pipeline, the renderer and the selection code.
   Rings are [[x, y], ...]. The layout frame belongs to the deck (origin at the south-west corner of the footprint's bounding
   rectangle); the local frame is the massing frame. built.frame.toLocal / toLayout convert points between them.
   ========================================================================== */
const ringArea = (ring) => { let a = 0; for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const multiArea = (mp) => (mp || []).reduce((t, pc) => t + Math.abs(ringArea(pc.outer)) - (pc.holes || []).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
const rectRing = (x, y, w, d) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const rnd = (v, k = 1000) => Math.round(v * k) / k;

/** Bounding box of a ring list, or null. */
function boxOfRings(rings) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const r of rings || []) for (const q of r) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
  return isFinite(b.minX) ? b : null;
}
const boxOfPolys = (polys) => boxOfRings((polys || []).map((p) => p.outer));
/** Metric reader: the modules return a number or { total | value | ratio }. */
function mv(row, d = 0) {
  if (typeof row === 'number' && isFinite(row)) return row;
  if (row && typeof row === 'object') for (const k of ['total', 'value', 'ratio', 'count']) if (typeof row[k] === 'number' && isFinite(row[k])) return row[k];
  return d;
}

/* ---- Clipper helpers (SCALE 1000, as in the layout module) ---------------------------- */
const CLIP_SCALE = 1000;
const clipPath = (ring) => ring.map((p) => ({ X: Math.round(p[0] * CLIP_SCALE), Y: Math.round(p[1] * CLIP_SCALE) }));
const clipRing = (path) => path.map((p) => [p.X / CLIP_SCALE, p.Y / CLIP_SCALE]);
function treeToPolys(tree) {
  const out = [];
  const visit = (node) => {
    for (const child of node.Childs()) {
      if (!child.IsHole()) {
        const poly = { outer: clipRing(child.Contour()), holes: [] };
        for (const hole of child.Childs()) { poly.holes.push(clipRing(hole.Contour())); visit(hole); }
        if (Math.abs(ringArea(poly.outer)) > 1e-6) out.push(poly);
      } else visit(child);
    }
  };
  visit(tree);
  return out;
}
/** Union ('union'), difference ('diff') or intersection ('and') of two lists of { outer, holes }. Non-zero fill. */
function clipPolys(subj, clip, op) {
  const L = globalThis.ClipperLib;
  const c = new L.Clipper();
  const add = (list, type) => {
    for (const p of list) {
      const outer = ringArea(p.outer) < 0 ? p.outer.slice().reverse() : p.outer;
      c.AddPath(clipPath(outer), type, true);
      for (const h of p.holes || []) c.AddPath(clipPath(ringArea(h) > 0 ? h.slice().reverse() : h), type, true);
    }
  };
  add(subj, L.PolyType.ptSubject);
  add(clip, L.PolyType.ptClip);
  const tree = new L.PolyTree();
  const type = op === 'diff' ? L.ClipType.ctDifference : op === 'and' ? L.ClipType.ctIntersection : L.ClipType.ctUnion;
  c.Execute(type, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return treeToPolys(tree);
}
/** A ring inset by `d` ft (Clipper offset, miter joins). Returns a ring or null. */
function insetRing(ring, d) {
  const L = globalThis.ClipperLib;
  const o = new L.ClipperOffset(10, 0.25);
  const path = clipPath(ringArea(ring) < 0 ? ring.slice().reverse() : ring);
  o.AddPath(path, L.JoinType.jtMiter, L.EndType.etClosedPolygon);
  const out = new L.Paths();
  o.Execute(out, -d * CLIP_SCALE);
  if (!out.length) return null;
  let best = out[0];
  for (const p of out) if (Math.abs(L.Clipper.Area(p)) > Math.abs(L.Clipper.Area(best))) best = p;
  return clipRing(best);
}
