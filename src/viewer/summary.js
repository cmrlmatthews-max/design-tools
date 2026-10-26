/* ==========================================================================
   viewer/summary.js — Model Viewer: the project summary table and the stale flags
   (docs/model-viewer-technical-plan.md section 3).

   summary(doc)    → rows [{ id, group, label, value, text }]; value is a number (or a string for text rows), text is what the table shows.
                     Every number comes from the section's derived.metrics (a sum over the levels only when the metrics are missing).
   staleFlags(doc) → [{ section, message }]

   Rules: pure, no DOM, never mutates the document, no NaN. The numbers are design-stage numbers. Nothing here checks a code.
   ========================================================================== */

import { getSection } from "../shared/project.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const grouped = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const dv = (doc, key) => { const s = getSection(doc, key); return s && isObj(s.derived) && Object.keys(s.derived).length ? s.derived : null; };
const mt = (d) => (d && isObj(d.metrics) ? d.metrics : {});

function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a / 2);
}

/** The summary rows of a project, in pipeline order. An empty project gives the project row only.
 *  The Facade Studio is hidden (October 26, 2026): its rows come only with opts.includeHidden. */
export function summary(doc, opts) {
  const includeHidden = !!(opts && opts.includeHidden);
  const rows = [];
  const row = (id, group, label, value, text) => { if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return; rows.push({ id, group, label, value, text: text === undefined ? String(value) : text }); };
  const num = (id, group, label, v, d = 0, unit = "") => { if (fin(v)) row(id, group, label, v, `${grouped(v, d)}${unit}`); };

  const frame = doc && isObj(doc.frame) ? doc.frame : {};
  const name = doc && typeof doc.name === "string" && doc.name ? doc.name : "Untitled";
  row("project", "Project", "Project", name, `${name}${frame.kind === "site" ? ", with a site" : ", local frame"}`);

  const site = dv(doc, "site");
  if (site) {
    const S = fin(site.size) ? site.size : null;
    let area = null;
    if (Array.isArray(site.boundary) && site.boundary.length >= 3 && site.boundary.every((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]))) area = ringArea(site.boundary);
    else if (S !== null) area = S * S;
    if (area !== null) row("site.area", "Site", "Site area", Math.round(area), `${grouped(area)} sf (${grouped(area / 43560, 2)} acres)`);
    if (fin(site.lat) && fin(site.lon)) row("site.latlon", "Site", "Latitude, longitude", `${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`);
    const nb = (Array.isArray(site.buildings) ? site.buildings : []).filter((b) => isObj(b) && b.removed !== true).length;
    row("site.buildings", "Site", "Neighbor buildings", nb);
  }

  const mass = dv(doc, "massing");
  if (mass) {
    const m = mt(mass), levels = Array.isArray(mass.levels) ? mass.levels : [];
    num("massing.gfa", "Massing", "Gross floor area", m.gfa, 0, " sf");
    row("massing.floors", "Massing", "Floors", fin(m.floors) ? m.floors : levels.length);
    num("massing.height", "Massing", "Height", fin(m.height) ? m.height : mass.height, 1, " ft");
    if (fin(m.far) && m.far > 0) num("massing.far", "Massing", "FAR", m.far, 2);
    else if (fin(m.far)) row("massing.far", "Massing", "FAR", 0, "No site");
    if (fin(m.siteCoverage) && m.siteCoverage > 0) row("massing.coverage", "Massing", "Site coverage", m.siteCoverage, `${grouped(m.siteCoverage * 100, 1)} percent`);
    else if (fin(m.siteCoverage)) row("massing.coverage", "Massing", "Site coverage", 0, "No site");
    if (fin(m.units)) row("massing.units", "Massing", "Units (estimate)", m.units);
  }

  const plates = dv(doc, "plates");
  if (plates) {
    const m = mt(plates), levels = Array.isArray(plates.levels) ? plates.levels : [];
    const total = fin(m.units) ? m.units : levels.reduce((s, l) => s + (isObj(l) && Array.isArray(l.units) ? l.units.length : 0), 0);
    row("plates.units", "Plates", plates.mode === "hotel" ? "Keys" : "Units", total);
    for (const t of Array.isArray(plates.mix) ? plates.mix : []) {
      if (!isObj(t) || typeof t.type !== "string" || !fin(t.count)) continue;
      row(`plates.mix.${t.type}`, "Plates", t.type, t.count, `${grouped(t.count)}${fin(t.share) ? ` (${grouped(t.share * 100, 0)} percent)` : ""}${fin(t.avgArea) ? `, ${grouped(t.avgArea)} sf each` : ""}`);
    }
    num("plates.nrsf", "Plates", "Net rentable area", m.nrsf, 0, " sf");
    num("plates.gsf", "Plates", "Gross area", m.gsf, 0, " sf");
    if (fin(m.efficiency)) row("plates.efficiency", "Plates", "Efficiency", m.efficiency, `${grouped(m.efficiency * 100, 1)} percent`);
    let flagged = 0;
    for (const l of levels) if (isObj(l)) for (const u of Array.isArray(l.units) ? l.units : []) if (isObj(u) && Array.isArray(u.flags) && u.flags.length) flagged++;
    if (flagged) row("plates.flagged", "Plates", "Units flagged (area high)", flagged);
    if (fin(m.inRange)) row("plates.inRange", "Plates", "Units in range", m.inRange);
  }

  const park = dv(doc, "parking");
  if (park) {
    const m = mt(park), levels = Array.isArray(park.levels) ? park.levels : [];
    const stalls = fin(m.stalls) ? m.stalls : levels.reduce((s, l) => s + (isObj(l) && Array.isArray(l.stalls) ? l.stalls.length : 0), 0);
    row("parking.stalls", "Parking", "Stalls", stalls);
    if (isObj(m.byKind)) for (const k of Object.keys(m.byKind).sort()) if (fin(m.byKind[k])) row(`parking.kind.${k}`, "Parking", `Stalls, ${k}`, m.byKind[k]);
    num("parking.sfPerStall", "Parking", "Area per stall", m.sfPerStall, 0, " sf");
    row("parking.levels", "Parking", "Parking levels", fin(m.levels) ? m.levels : levels.length);
  }

  const fac = includeHidden ? dv(doc, "facade") : null;
  if (fac) {
    const m = mt(fac), faces = Array.isArray(fac.faces) ? fac.faces : [];
    if (fin(m.wwr)) row("facade.wwr", "Facade", "Window-to-wall ratio", m.wwr, `${grouped(m.wwr * 100, 0)} percent`);
    if (isObj(m.wwrByOrientation)) for (const k of ["N", "E", "S", "W"]) if (fin(m.wwrByOrientation[k])) row(`facade.wwr.${k}`, "Facade", `Window-to-wall, ${k}`, m.wwrByOrientation[k], `${grouped(m.wwrByOrientation[k] * 100, 0)} percent`);
    const bal = fin(m.balconyCount) ? m.balconyCount : faces.reduce((s, f) => s + (isObj(f) && fin(f.balconies) ? f.balconies : 0), 0);
    row("facade.balconies", "Facade", "Balconies", bal);
    if (fin(m.groundTransparency)) row("facade.groundTransparency", "Facade", "Ground floor transparency", m.groundTransparency, `${grouped(m.groundTransparency * 100, 0)} percent`);
  }

  const grad = dv(doc, "grading");
  if (grad) {
    const m = mt(grad);
    num("grading.cut", "Grading", "Cut", m.cutCy, 0, " cy");
    num("grading.fill", "Grading", "Fill", m.fillCy, 0, " cy");
    if (fin(m.netCy)) row("grading.net", "Grading", "Net (fill minus cut)", m.netCy, `${m.netCy > 0 ? "+" : ""}${grouped(m.netCy)} cy`);
  }
  return rows;
}

const ms = (t) => { const v = typeof t === "string" ? Date.parse(t) : NaN; return Number.isFinite(v) ? v : null; };

/** Sections that look older than the massing they were made from. [{ section, message }] */
export function staleFlags(doc, opts) {
  const includeHidden = !!(opts && opts.includeHidden);
  const out = [];
  const mass = getSection(doc, "massing");
  if (!mass || !dv(doc, "massing")) return out;
  const mAt = ms(mass.updatedAt);
  const plates = getSection(doc, "plates");
  if (plates && dv(doc, "plates")) {
    const stamp = ms(plates.derived.massingUpdatedAt);
    const at = stamp !== null ? stamp : ms(plates.updatedAt);
    if (mAt !== null && at !== null && at < mAt) out.push({ section: "plates", message: "The plates were made from an older massing. Open the Plate Planner to update them." });
    const have = new Set((Array.isArray(mass.derived.levels) ? mass.derived.levels : []).filter((l) => isObj(l)).map((l) => l.index));
    const gone = (Array.isArray(plates.derived.levels) ? plates.derived.levels : []).filter((l) => isObj(l) && !have.has(l.index)).length;
    if (gone) out.push({ section: "plates", message: `The plates have ${gone} level${gone === 1 ? "" : "s"} that the massing no longer has.` });
  }
  for (const [key, text] of [["parking", "The parking deck"], ["facade", "The facade"]]) {
    if (key === "facade" && !includeHidden) continue;
    const s = getSection(doc, key);
    if (!s || !dv(doc, key)) continue;
    const at = ms(s.updatedAt);
    if (mAt !== null && at !== null && at < mAt) out.push({ section: key, message: `${text} was saved before the massing changed. It may be out of date.` });
  }
  return out;
}
