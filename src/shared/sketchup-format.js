/* ==========================================================================
   SHARED: sketchup-format
   The ".sketchup.json" file that the CMRLM SketchUp extension imports.
   Spec: docs/sketchup-spec.md. Pure functions, no DOM except docToBlob.
   Units: feet. Plan (x, y): x = east, y = north. z up.
   ========================================================================== */

export const FORMAT = "cmrlm-design-tools/sketchup";
export const VERSION = 1;

const MIN_STEP = 0.01;      // ft: drop points closer than this to the previous point
const MIN_AREA = 0.25;      // sf: drop smaller rings
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Signed plan area (positive = counter-clockwise seen from above). Works on [x,y] or [x,y,z]. */
export function ringArea2(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function clean(ring, dims, hole) {
  if (!Array.isArray(ring)) return null;
  let pts = ring
    .filter((p) => Array.isArray(p) && p.length >= dims && p.slice(0, dims).every(Number.isFinite))
    .map((p) => p.slice(0, dims).map(r3));
  // drop closing duplicate and near-duplicate neighbours
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(...p.map((v, k) => v - last[k])) < MIN_STEP) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.hypot(...out[0].map((v, k) => v - out[out.length - 1][k])) < MIN_STEP) out.pop();
  // drop collinear points (repeat until stable)
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const u = b.map((v, k) => v - a[k]), w = c.map((v, k) => v - b[k]);
      const lu = Math.hypot(...u), lw = Math.hypot(...w);
      if (!lu || !lw) { out.splice(i, 1); changed = true; i--; continue; }
      let cross;
      if (dims === 2) cross = Math.abs(u[0] * w[1] - u[1] * w[0]);
      else cross = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
      const dot = u.reduce((s, v, k) => s + v * w[k], 0);
      if (cross / (lu * lw) < 1e-9 && dot > 0) { out.splice(i, 1); changed = true; i--; }
    }
  }
  if (out.length < 3) return null;
  const area = ringArea2(out);
  if (Math.abs(area) < MIN_AREA) return null;
  if ((area > 0) === !!hole) out.reverse();     // outer CCW, hole CW
  return out;
}

/** Clean a plan ring [[x,y],…]. Returns null when the ring is degenerate. */
export const cleanRing2 = (ring, { hole = false } = {}) => clean(ring, 2, hole);
/** Clean a 3D ring [[x,y,z],…] (orientation judged in plan). Returns null when degenerate. */
export const cleanRing3 = (ring, { hole = false } = {}) => clean(ring, 3, hole);

export function makeDoc({ source, name, location = null, zShift = 0, notes = [], tags = [], materials = [], root, createdAt }) {
  return {
    format: FORMAT,
    version: VERSION,
    source,
    name: String(name || "Untitled"),
    createdAt: createdAt || new Date().toISOString(),
    units: "feet",
    location: location && Number.isFinite(location.lat) && Number.isFinite(location.lon) ? { lat: location.lat, lon: location.lon } : null,
    zShift: Math.round((zShift || 0) * 100) / 100,
    notes,
    tags,
    materials,
    root,
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const isPt = (p, d) => Array.isArray(p) && p.length === d && p.every(Number.isFinite);

/** Check a document against the spec. → { ok, errors, counts } */
export function validateDoc(doc) {
  const errors = [];
  const counts = { group: 0, solid: 0, mesh: 0, faces: 0, lines: 0 };
  const err = (path, msg) => { if (errors.length < 50) errors.push(`${path}: ${msg}`); };
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["document: not an object"], counts };
  if (doc.format !== FORMAT) err("format", `must be "${FORMAT}"`);
  if (doc.version !== VERSION) err("version", `must be ${VERSION}`);
  if (!["tower", "site", "midrise", "parking", "facade", "grading"].includes(doc.source)) err("source", "must be tower, site, midrise, parking, facade, or grading");
  if (doc.units !== "feet") err("units", "must be feet");
  if (!Number.isFinite(doc.zShift)) err("zShift", "must be a number");
  const tagNames = new Set(), matNames = new Set();
  for (const [i, t] of (doc.tags || []).entries()) {
    if (!t.name) err(`tags[${i}]`, "needs a name");
    if (!HEX.test(t.color || "")) err(`tags[${i}]`, "color must be #rrggbb");
    tagNames.add(t.name);
  }
  for (const [i, m] of (doc.materials || []).entries()) {
    if (!m.name) err(`materials[${i}]`, "needs a name");
    if (!HEX.test(m.color || "")) err(`materials[${i}]`, "color must be #rrggbb");
    if (!(m.alpha > 0 && m.alpha <= 1)) err(`materials[${i}]`, "alpha must be in (0, 1]");
    matNames.add(m.name);
  }
  const ringOk = (ring, d, path, hole) => {
    if (!Array.isArray(ring) || ring.length < 3 || !ring.every((p) => isPt(p, d))) return err(path, `ring needs 3+ points of ${d} numbers`);
    const a = ringArea2(ring);
    if (Math.abs(a) < MIN_AREA) err(path, "ring area too small");
    else if ((a > 0) === hole) err(path, hole ? "hole must be clockwise" : "outer ring must be counter-clockwise");
  };
  const walk = (n, path) => {
    if (!n || typeof n !== "object") return err(path, "node is not an object");
    if (!(n.type in counts)) return err(path, `unknown type ${n.type}`);
    counts[n.type]++;
    if (typeof n.name !== "string" || !n.name) err(path, "needs a name");
    if (n.tag != null && !tagNames.has(n.tag)) err(path, `tag "${n.tag}" is not in tags`);
    if (n.material != null && !matNames.has(n.material)) err(path, `material "${n.material}" is not in materials`);
    switch (n.type) {
      case "group":
        if (!Array.isArray(n.children)) err(path, "group needs children");
        else n.children.forEach((c, i) => walk(c, `${path}/${c && c.name ? c.name : i}`));
        break;
      case "solid":
        ringOk(n.outer, 2, `${path}.outer`, false);
        (n.holes || []).forEach((h, i) => ringOk(h, 2, `${path}.holes[${i}]`, true));
        if (!(Number.isFinite(n.z0) && Number.isFinite(n.z1) && n.z1 - n.z0 > 0.001)) err(path, "needs z1 > z0");
        break;
      case "mesh": {
        const nv = (n.vertices || []).length;
        if (!nv || !n.vertices.every((p) => isPt(p, 3))) err(path, "vertices must be [x,y,z]");
        if (!Array.isArray(n.triangles) || !n.triangles.length) err(path, "needs triangles");
        else for (const t of n.triangles) if (!(Array.isArray(t) && t.length === 3 && t.every((k) => Number.isInteger(k) && k >= 0 && k < nv) && new Set(t).size === 3)) { err(path, "bad triangle index"); break; }
        break;
      }
      case "faces":
        if (!Array.isArray(n.polygons) || !n.polygons.length) err(path, "needs polygons");
        else n.polygons.forEach((p, i) => { ringOk(p.outer, 3, `${path}.polygons[${i}].outer`, false); (p.holes || []).forEach((h, j) => ringOk(h, 3, `${path}.polygons[${i}].holes[${j}]`, true)); });
        break;
      case "lines":
        if (!Array.isArray(n.lines) || !n.lines.length) err(path, "needs lines");
        else for (const l of n.lines) if (!(Array.isArray(l) && l.length >= 2 && l.every((p) => isPt(p, 3)))) { err(path, "each line needs 2+ [x,y,z] points"); break; }
        break;
    }
  };
  if (!doc.root || doc.root.type !== "group") err("root", "must be a group");
  else walk(doc.root, doc.root.name || "root");
  return { ok: errors.length === 0, errors, counts };
}

/** "Option A" → "option-a-2026-10-21.sketchup.json" */
export function sketchupFilename(name, date = new Date()) {
  const slug = String(name || "design").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "design";
  const d = date instanceof Date ? date : new Date(date);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${slug}-${ymd}.sketchup.json`;
}

/** Compact JSON as a Blob for download. */
export function docToBlob(doc) {
  return new Blob([JSON.stringify(doc)], { type: "application/json" });
}
