// Run: node test/viewer.sketchup.test.mjs
// Model Viewer plan section 6, test V8: the SketchUp document passes validateDoc, has source "viewer", one group per layer that is on.
const F = await import("./viewer.fixture.mjs");
const SK = await import("../src/viewer/sketchup.js");
const SF = await import("../src/shared/sketchup-format.js");
const PJ = await import("../src/shared/project.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
}
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
const META = { createdAt: "2026-10-25T00:00:00.000Z" };
const doc = F.fullProject();
const names = (d) => d.root.children.filter((c) => c.type === "group").map((c) => c.name);

t("V8 the default layers give a valid document with source viewer", () => {
  const d = SK.viewerToSketchup(doc, null, META);
  const v = SF.validateDoc(d);
  ok(v.ok === true, JSON.stringify(v.errors || v));
  eq(d.source, "viewer");
  eq(SK.SKETCHUP_SOURCE, "viewer");
  eq(d.root.name, doc.name);
});
t("V8 one group per layer that is on (and has items)", () => {
  const d = SK.viewerToSketchup(doc, null, META);
  eq(names(d), ["Site", "Massing", "Units", "Cores and corridors", "Parking"]);
  const all = SK.viewerToSketchup(doc, { site: true, massing: true, units: true, cores: true, parking: true, facade: true, grading: true }, META);
  eq(names(all).length, 7);
  ok(SF.validateDoc(all).ok === true, JSON.stringify(SF.validateDoc(all).errors));
  const one = SK.viewerToSketchup(doc, { site: false, massing: false, units: true, cores: false, parking: false, facade: false, grading: false }, META);
  eq(names(one), ["Units"]);
  ok(SF.validateDoc(one).ok === true);
});
t("V8 units are grouped by level; one solid per unit; the tag is the unit type", () => {
  const d = SK.viewerToSketchup(doc, { units: true, site: false, massing: false, cores: false, parking: false }, META);
  const g = d.root.children[0];
  ok(g.children.every((c) => c.type === "group" && /^Level \d+$/.test(c.name)));
  const solids = g.children.flatMap((c) => c.children);
  eq(solids.length, 238);
  ok(solids.every((s) => s.type === "solid" && s.tag === s.attributes.type));
});
t("V8 the lowest z is brought to zero for a project with a site", () => {
  const d = SK.viewerToSketchup(doc, null, META);
  ok(d.zShift < -900, "zShift " + d.zShift);
  ok(d.location && Math.abs(d.location.lat - 33.927) < 1e-6);
});
t("V8 an empty project gives a valid document with no groups", () => {
  const d = SK.viewerToSketchup(PJ.newProject({ name: "Empty" }), null, META);
  ok(SF.validateDoc(d).ok === true, JSON.stringify(SF.validateDoc(d).errors));
  eq(names(d), []);
});
t("V8 the document is not changed by the export", () => {
  const before = JSON.stringify(doc);
  SK.viewerToSketchup(doc, null, META);
  eq(JSON.stringify(doc), before);
});
t("V9 determinism: byte-equal output twice", () => {
  const a = JSON.stringify(SK.viewerToSketchup(doc, null, META)), b = JSON.stringify(SK.viewerToSketchup(JSON.parse(JSON.stringify(doc)), null, META));
  eq(a, b);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
