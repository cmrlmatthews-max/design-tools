// Run: node test/viewer.summary.test.mjs
// Model Viewer plan section 6, tests V6 (stale flags) and V7 (summary numbers) on fixtures built from the tools' own modules (test/viewer.fixture.mjs).
const F = await import("./viewer.fixture.mjs");
const S = await import("../src/viewer/scene.js");
const SU = await import("../src/viewer/summary.js");
const PJ = await import("../src/shared/project.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b} +-${tol}, got ${a}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
/** Every number in a JSON value is finite. */
function allFinite(v, path = "") {
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error(`not finite at ${path}`); }
  else if (Array.isArray(v)) v.forEach((x, i) => allFinite(x, `${path}[${i}]`));
  else if (v && typeof v === "object") for (const k of Object.keys(v)) allFinite(v[k], `${path}.${k}`);
}
const rad = (d) => (d * Math.PI) / 180;
/** Local point to project point, spec section 4. */
const toP = (pl, [x, y]) => [x * Math.cos(rad(pl.rotation)) - y * Math.sin(rad(pl.rotation)) + pl.x, x * Math.sin(rad(pl.rotation)) + y * Math.cos(rad(pl.rotation)) + pl.y];

const site = F.siteSection();
const massing = F.towerSection();
massing.updatedAt = "2026-10-24T10:00:00.000Z";
const plates = F.platesSection(massing);
const stamps = { massing: massing.updatedAt };
const docMass = F.assemble({ site, massing }, { stamps });
const docPlates = F.assemble({ site, massing, plates }, { stamps });
const docFull = F.fullProject();
const sec = (doc, k) => PJ.getSection(doc, k);

console.log("V6 stale flags");
t("V6 plates made from an older massing name plates", () => {
  const d = JSON.parse(JSON.stringify(docPlates));
  d.sections.massing.updatedAt = "2026-10-25T09:00:00.000Z";
  const flags = SU.staleFlags(d);
  ok(flags.some((f) => f.section === "plates" && /older massing/.test(f.message)), JSON.stringify(flags));
  eq(SU.staleFlags(docPlates), []);
});
t("V6 a plates section with no stamp falls back to its updatedAt; parking and facade older than the massing may be out of date", () => {
  const d = JSON.parse(JSON.stringify(docFull));
  d.sections.plates.derived.massingUpdatedAt = null;
  d.sections.massing.updatedAt = "2026-10-26T00:00:00.000Z";
  const flags = SU.staleFlags(d);
  eq(flags.map((f) => f.section).sort(), ["facade", "parking", "plates"]);
  ok(flags.every((f) => /[a-z]/.test(f.message) && !/compliant/i.test(f.message)));
});
t("V6 a plate level the massing no longer has is flagged", () => {
  const d = JSON.parse(JSON.stringify(docPlates));
  d.sections.massing.derived.levels = d.sections.massing.derived.levels.filter((l) => l.index < 20);
  ok(SU.staleFlags(d).some((f) => /no longer has/.test(f.message)));
});

console.log("V7 summary");
t("V7 the numbers equal each section's derived.metrics", () => {
  const rows = SU.summary(docFull), by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const m = (k) => sec(docFull, k).derived.metrics;
  eq(by["massing.gfa"].value, m("massing").gfa); eq(by["massing.floors"].value, m("massing").floors); eq(by["massing.height"].value, m("massing").height);
  eq(by["massing.far"].value, m("massing").far); eq(by["massing.coverage"].value, m("massing").siteCoverage);
  eq(by["plates.units"].value, m("plates").units); eq(by["plates.nrsf"].value, m("plates").nrsf); eq(by["plates.gsf"].value, m("plates").gsf); eq(by["plates.efficiency"].value, m("plates").efficiency);
  for (const t of sec(docFull, "plates").derived.mix) eq(by[`plates.mix.${t.type}`].value, t.count);
  eq(by["parking.stalls"].value, m("parking").stalls); eq(by["parking.sfPerStall"].value, m("parking").sfPerStall); eq(by["parking.levels"].value, m("parking").levels);
  for (const k of Object.keys(m("parking").byKind)) eq(by[`parking.kind.${k}`].value, m("parking").byKind[k]);
  eq(by["facade.wwr"].value, m("facade").wwr); eq(by["facade.balconies"].value, m("facade").balconyCount);
  for (const k of ["N", "E", "S", "W"]) eq(by[`facade.wwr.${k}`].value, m("facade").wwrByOrientation[k]);
  eq(by["grading.cut"].value, m("grading").cutCy); eq(by["grading.fill"].value, m("grading").fillCy); eq(by["grading.net"].value, m("grading").netCy);
  eq(by["site.area"].value, 1000000); eq(by["site.buildings"].value, 2);
  for (const r of rows) { ok(typeof r.text === "string" && r.text.length > 0); ok(!/NaN|undefined/.test(r.text), r.text); }
});
t("V7 the table keeps the order of the pipeline and a missing section gives no rows", () => {
  const groups = [...new Set(SU.summary(docFull).map((r) => r.group))];
  eq(groups, ["Project", "Site", "Massing", "Plates", "Parking", "Facade", "Grading"]);
  eq([...new Set(SU.summary(docMass).map((r) => r.group))], ["Project", "Site", "Massing"]);
});
t("V7 a massing without a site shows No site for FAR and coverage, not zero", () => {
  const d = F.assemble({ massing: F.towerSection("l-multifamily-podium") });
  const d2 = JSON.parse(JSON.stringify(d)); d2.sections.massing.derived.metrics.far = 0; d2.sections.massing.derived.metrics.siteCoverage = 0;
  const by = Object.fromEntries(SU.summary(d2).map((r) => [r.id, r]));
  eq(by["massing.far"].text, "No site"); eq(by["massing.coverage"].text, "No site");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
