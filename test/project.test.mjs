// Node tests for src/shared/project.js. Run: node test/project.test.mjs
import { readFileSync } from "node:fs";
import * as P from "../src/shared/project.js";

const {
  FORMAT, VERSION, SECTIONS, SIZE_WARN, SIZE_MAX,
  newProject, validate, migrate, getSection, writeSection, toProject, toLocal, transformRing, transformMultiPoly,
  siteContextFor, listProjects, loadProject, saveProject, deleteProject, exportProject, importProject,
  projectIdFromUrl, sendTo, projectBytes, largestSection,
} = P;

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// deep equality that ignores key order; exact() also compares key order (byte for byte)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const eq = (a, b, m = "") => { if (canon(a) !== canon(b)) throw new Error(`${m} expected ${canon(b)} got ${canon(a)}`); };
const exact = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} not byte for byte equal`); };
const ok = (v, m) => { if (!v) throw new Error(m || "expected true"); };
const near = (a, b, tol = 1e-6, m = "") => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const throws = (fn, check) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) throw new Error("expected an error");
  if (check) check(err);
  return err;
};
const rejects = async (promise, re) => {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  if (!err) throw new Error("expected a rejection");
  if (re && !re.test(err.message)) throw new Error(`message was "${err.message}"`);
};
const clone = (v) => JSON.parse(JSON.stringify(v));
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }

// an in-memory Storage-like object; `broken` makes the chosen calls throw
function memStore(broken = []) {
  const m = new Map();
  const guard = (name) => { if (broken.includes(name)) throw new Error(`${name} is blocked`); };
  return {
    getItem: (k) => { guard("get"); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard("set"); m.set(k, String(v)); },
    removeItem: (k) => { guard("remove"); m.delete(k); },
    map: m,
  };
}

const PL = (over = {}) => ({ x: 0, y: 0, rotation: 0, baseZ: 0, ...over });
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const SITE_FRAME = { kind: "site", lat: 33.927, lon: -84.339, size: 1000, zDatum: "NAVD88" };
const bld = (id, outer, over = {}) => ({ id, outer, holes: [], base: 1010, height: 50, top: 1060, floors: 4, rule: "data", name: "", ...over });

// a site project with three sections, written only through writeSection
function sample() {
  let d = newProject({ name: "Ravinia test", frame: SITE_FRAME });
  d = writeSection(d, "site", {
    tool: "site", schema: 1, placement: PL(), state: { query: "Ravinia Dr, Dunwoody, GA", size: 1000 },
    derived: { boundary: sq(0, 0, 1000, 1000), buildings: [bld("b-1", sq(612, 530, 688, 601.2), { base: 1011.8, height: 186 })], trees: [] },
    note: "Ravinia Dr, 1,000 ft",
  });
  d = writeSection(d, "massing", {
    tool: "tower", schema: 1, placement: PL({ x: 500, y: 500, baseZ: 1012.5 }), state: { schema: 1, name: "Option A" },
    derived: { footprint: [{ outer: sq(-50, -50, 50, 50), holes: [] }], height: 503, levels: [], metrics: { gfa: 1 } }, note: "Option A",
  });
  d = writeSection(d, "plates", {
    tool: "plate", schema: 1, placement: PL({ x: 500, y: 500, baseZ: 1012.5 }), state: {}, derived: { mode: "multifamily", levels: [] }, note: "Floor 3",
  });
  return d;
}

console.log("project.test.mjs");

/* ---------- the seven cases of spec section 10 ---------- */

t("1. round trip: three sections, export, import: deep equal; a second import is a copy with a new id", async () => {
  const doc = sample();
  const { filename, blob } = exportProject(doc);
  eq(filename, "ravinia-test.cmrlm.json");
  ok(blob && typeof blob.text === "function", "expected a Blob");
  const store = memStore();
  const a = await importProject(blob, store);
  eq(a.renamed, false);
  eq(a.doc, doc);
  const b = await importProject(blob, store);
  eq(b.renamed, true);
  ok(b.doc.id !== doc.id, "expected a new id");
  eq(b.doc.name, "Ravinia test (2)");
  eq({ ...b.doc, id: doc.id, name: doc.name }, doc);
  eq(listProjects(store).length, 2);
  eq(loadProject(store, b.doc.id), b.doc);
});

t("2. unknown keys inside a section, in another section and at the top level survive writeSection and saveProject", () => {
  const doc = sample();
  doc.extra = { keep: [1, 2, { deep: true }] };
  doc.sections.massing.futureKey = { n: 7, list: ["a"] };
  doc.sections.massing.state.mine = { a: 1 };
  doc.sections.site.other = "x";
  doc.sections.future = { anything: [1, 2, 3] };
  ok(validate(doc).ok, "unknown keys must not fail validate");
  const out = writeSection(doc, "massing", { derived: { height: 600 } });
  eq(out.extra, doc.extra);
  eq(out.sections.massing.futureKey, { n: 7, list: ["a"] });
  eq(out.sections.massing.state, doc.sections.massing.state);
  eq([out.sections.massing.tool, out.sections.massing.schema], ["tower", 1]);
  eq(out.sections.massing.derived, { height: 600 });
  exact(out.sections.site, doc.sections.site);
  exact(out.sections.plates, doc.sections.plates);
  exact(out.sections.future, doc.sections.future);
  const store = memStore();
  ok(saveProject(store, out).ok);
  const back = loadProject(store, out.id);
  eq(back.extra, doc.extra);
  eq(back.sections.massing.futureKey, { n: 7, list: ["a"] });
  exact(back, out);
});

t("3. a section with a newer schema makes writeSection throw (readOnly), and the project is unchanged", () => {
  const doc = sample();
  doc.sections.massing.schema = 2;
  const before = JSON.stringify(doc);
  throws(() => writeSection(doc, "massing", { tool: "tower", schema: 1, state: { a: 1 } }), (e) => {
    eq(e.message, "This project was saved by a newer version of this tool. You can view it, but changes will not be saved.");
    eq(e.readOnly, true);
  });
  eq(JSON.stringify(doc), before);
  ok(writeSection(doc, "massing", { schema: 2, state: { a: 1 } }), "a writer that knows schema 2 may write");
  ok(writeSection(doc, "plates", { schema: 1 }), "other sections are not blocked");
  throws(() => writeSection(doc, "banana", {}), (e) => ok(!e.readOnly && /banana/.test(e.message)));
  throws(() => writeSection({ ...doc, version: 2 }, "site", {}), (e) => eq(e.readOnly, true));
});

t("4a. rotation 90 maps local (0, 10) to project (-10, 0) plus the offset; z gains baseZ", () => {
  const sec = { placement: PL({ x: 500, y: 300, rotation: 90, baseZ: 1012.5 }) };
  eq(toProject(sec, [0, 10]), [490, 300, 1012.5]);
  eq(toProject(sec, [0, 10, 4]), [490, 300, 1016.5]);
  eq(toProject(sec, [10, 0]), [500, 310, 1012.5]);
  eq(toProject({ placement: PL({ rotation: 90 }) }, [0, 10]), [-10, 0, 0]);
  eq(toProject(sec.placement, [0, 10]), [490, 300, 1012.5], "a bare placement works too");
  eq(toProject({ placement: PL() }, [3, 4, 5]), [3, 4, 5]);
});

t("4b. toLocal inverts toProject for any rotation", () => {
  for (const rot of [0, 30, 90, 137.5, 180, 270, -45, 400]) {
    const sec = { placement: PL({ x: 120.25, y: -40, rotation: rot, baseZ: 8 }) };
    for (const pt of [[0, 0, 0], [10, 20, 3], [-55.5, 80.125, -2]]) {
      const back = toLocal(sec, toProject(sec, pt));
      near(back[0], pt[0], 1e-9, `x at ${rot}`); near(back[1], pt[1], 1e-9, `y at ${rot}`); near(back[2], pt[2], 1e-9, `z at ${rot}`);
    }
  }
  eq(toLocal({ placement: PL({ x: 500, y: 300, rotation: 90, baseZ: 1012.5 }) }, [490, 300, 1012.5]), [0, 10, 0]);
});

t("4c. transformRing and transformMultiPoly: 0.001 rounding, 2D stays 2D, 3D carries baseZ, inverse, no mutation", () => {
  const sec = { placement: PL({ x: 500, y: 500, rotation: 90, baseZ: 100 }) };
  const ring = deepFreeze(sq(0, 0, 10, 10));
  eq(transformRing(sec, ring, "toProject"), [[500, 500], [500, 510], [490, 510], [490, 500]]);
  eq(transformRing(sec, [[1, 2], [3, 4, 5]], "toProject"), [[498, 501], [496, 503, 105]]);
  const odd = { placement: PL({ x: 0.0004, y: 0, rotation: 30, baseZ: 0 }) };
  ok(transformRing(odd, [[1.23456, 7.89123]], "toProject")[0].every((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6), "rounded to 0.001");
  const fwd = transformRing(odd, [[12.3, 45.6], [-7, 8]], "toProject");
  const back = transformRing(odd, fwd, "toLocal");
  near(back[0][0], 12.3, 0.002); near(back[0][1], 45.6, 0.002); near(back[1][0], -7, 0.002); near(back[1][1], 8, 0.002);
  const mp = deepFreeze([{ outer: sq(0, 0, 10, 10), holes: [[[2, 2], [2, 8], [8, 8], [8, 2]]], tag: "keep" }]);
  const out = transformMultiPoly(sec, mp, "toProject");
  eq(out, [{ outer: [[500, 500], [500, 510], [490, 510], [490, 500]], holes: [[[498, 502], [492, 502], [492, 508], [498, 508]]], tag: "keep" }]);
  eq(transformMultiPoly(sec, out, "toLocal"), mp);
  throws(() => transformRing(sec, ring, "sideways"), (e) => ok(/toProject/.test(e.message)));
  throws(() => transformMultiPoly(sec, mp, undefined));
  eq(transformRing(sec, null, "toProject"), []);
});

/* ---------- siteContextFor ---------- */

function ctxDoc() {
  return writeSection(newProject({ name: "ctx", frame: SITE_FRAME }), "site", {
    tool: "site", schema: 1, placement: PL(),
    derived: { buildings: [
      bld("b1", sq(612, 530, 688, 601.2), { base: 1011.8, height: 186, name: "Tower A" }),
      bld("far", sq(900, 900, 950, 950)),
      bld("onsite", sq(480, 480, 520, 520), { base: 1012, height: 30 }),
      bld("edge", sq(620, 490, 650, 510), { base: 1013.3, height: 20 }),
      bld("holey", sq(400, 400, 440, 440), { holes: [[[410, 410], [410, 430], [430, 430], [430, 410]]], base: 1010, height: 12.346, name: "Courtyard" }),
    ] },
  });
}

t("5a. siteContextFor: nearby buildings in the local frame, block = bounding box, base relative to baseZ", () => {
  const doc = ctxDoc();
  const snap = JSON.stringify(doc);
  const pl = PL({ x: 500, y: 500, baseZ: 1000 });
  const r = siteContextFor(doc, pl, 120);
  eq(r.blocks.map((b) => b.id), ["b1", "onsite", "edge", "holey"]);
  eq(r.blocks[0], { id: "b1", name: "Tower A", x: 150, y: 65.6, w: 76, d: 71.2, h: 186, base: 11.8 });
  eq(r.blocks[1], { id: "onsite", name: "", x: 0, y: 0, w: 40, d: 40, h: 30, base: 12 });
  eq(r.blocks[2], { id: "edge", name: "", x: 135, y: 0, w: 30, d: 20, h: 20, base: 13.3 });
  eq(r.blocks[3], { id: "holey", name: "Courtyard", x: -80, y: -80, w: 40, d: 40, h: 12.35, base: 10 });
  eq(r.polygons.map((p) => p.id), ["b1", "onsite", "edge", "holey"]);
  eq(r.polygons[3], {
    id: "holey", name: "Courtyard", outer: [[-100, -100], [-60, -100], [-60, -60], [-100, -60]],
    holes: [[[-90, -90], [-90, -70], [-70, -70], [-70, -90]]], base: 10, height: 12.35,
  });
  eq(r.polygons[0].outer, [[112, 30], [188, 30], [188, 101.2], [112, 101.2]]);
  const back = toProject({ placement: pl }, [r.blocks[0].x, r.blocks[0].y]);
  near(back[0], 650, 1e-9); near(back[1], 565.6, 1e-9);   // the block center maps back to the building box center
  eq(JSON.stringify(doc), snap);
});

t("5b. siteContextFor: the radius is inclusive, the origin box counts, no radius means all", () => {
  const doc = ctxDoc();
  const pl = PL({ x: 500, y: 500, baseZ: 1000 });
  eq(siteContextFor(doc, pl, 119.99).blocks.map((b) => b.id), ["b1", "onsite", "holey"]);
  eq(siteContextFor(doc, pl, 110).blocks.map((b) => b.id), ["onsite", "holey"]);
  eq(siteContextFor(doc, pl, 0).blocks.map((b) => b.id), ["onsite"]);
  eq(siteContextFor(doc, pl, 10000).blocks.length, 5);
  eq(siteContextFor(doc, pl).blocks.length, 5);
  eq(siteContextFor(doc, pl, -5).blocks, []);
});

t("5c. siteContextFor: a rotated placement swaps the block width and depth", () => {
  const r = siteContextFor(ctxDoc(), PL({ x: 500, y: 500, rotation: 90, baseZ: 0 }), 120);
  eq(r.blocks[0], { id: "b1", name: "Tower A", x: 65.6, y: -150, w: 71.2, d: 76, h: 186, base: 1011.8 });
  eq(r.polygons[0].outer, transformRing({ placement: PL({ x: 500, y: 500, rotation: 90 }) }, sq(612, 530, 688, 601.2), "toLocal"));
});

t("5d. siteContextFor: no site section, or no buildings, gives empty lists", () => {
  eq(siteContextFor(newProject({ name: "x" }), PL(), 500), { blocks: [], polygons: [] });
  eq(siteContextFor(writeSection(newProject({ name: "x" }), "site", { derived: {} }), PL(), 500), { blocks: [], polygons: [] });
  eq(siteContextFor(null, PL(), 500), { blocks: [], polygons: [] });
});

t("5e. siteContextFor: a removed building is skipped from blocks and polygons; includeRemoved keeps it", () => {
  const doc = ctxDoc();
  const site = getSection(doc, "site");
  const derived = clone(site.derived);
  derived.buildings[2].removed = true;                                    // "onsite": the old building on the new plate
  const doc2 = writeSection(doc, "site", { ...site, derived });
  const snap = JSON.stringify(doc2);
  const pl = PL({ x: 500, y: 500, baseZ: 1000 });
  const r = siteContextFor(doc2, pl, 120);
  eq(r.blocks.map((b) => b.id), ["b1", "edge", "holey"]);
  eq(r.polygons.map((p) => p.id), ["b1", "edge", "holey"]);
  ok(r.blocks.every((b) => !("removed" in b)) && r.polygons.every((p) => !("removed" in p)), "kept ones have no removed key");
  eq(siteContextFor(doc2, pl).blocks.length, 4);
  eq(siteContextFor(doc2, pl, 0).blocks, []);
  eq(siteContextFor(doc2, pl, 120, {}).blocks.map((b) => b.id), ["b1", "edge", "holey"]);
  eq(siteContextFor(doc2, pl, 120, { includeRemoved: false }).polygons.length, 3);
  const all = siteContextFor(doc2, pl, 120, { includeRemoved: true });
  eq(all.blocks.map((b) => b.id), ["b1", "onsite", "edge", "holey"]);
  eq(all.polygons.map((p) => p.id), ["b1", "onsite", "edge", "holey"]);
  eq(all.blocks[1], { id: "onsite", name: "", x: 0, y: 0, w: 40, d: 40, h: 30, base: 12, removed: true });
  eq(all.polygons[1].removed, true);
  ok(!("removed" in all.blocks[0]) && !("removed" in all.polygons[0]), "only the removed one is flagged");
  eq(JSON.stringify(doc2), snap);
  // removed: false, or a truthy value that is not true, does not count as removed
  const d3 = clone(derived); d3.buildings[2].removed = false; d3.buildings[3].removed = "yes";
  eq(siteContextFor(writeSection(doc, "site", { ...site, derived: d3 }), pl, 120).blocks.length, 4);
});

/* ---------- size ---------- */

t("6. saveProject warns above SIZE_WARN and refuses above SIZE_MAX, naming the largest section", () => {
  const big = (mb, key) => writeSection(sample(), key, { derived: { pad: "x".repeat(Math.round(mb * 1024 * 1024)) } });
  const store = memStore();
  const small = sample();
  let r = saveProject(store, small);
  eq(r.ok, true); eq(r.warning, null); eq(r.bytes, projectBytes(small));
  eq(listProjects(store)[0].bytes, r.bytes);
  eq(store.getItem("cmrlm.project.last"), small.id);

  const warn = big(3.2, "site");
  r = saveProject(store, warn);
  ok(r.ok && r.bytes > SIZE_WARN && r.bytes <= SIZE_MAX, `bytes ${r.bytes}`);
  ok(/"site"/.test(r.warning), r.warning);
  ok(loadProject(store, warn.id), "a warned project is saved");
  eq(store.getItem("cmrlm.project.last"), warn.id);

  const huge = big(4.3, "massing");
  r = saveProject(store, huge);
  eq(r.ok, false); ok(r.bytes > SIZE_MAX);
  ok(/"massing"/.test(r.warning), r.warning);
  eq(store.getItem(`cmrlm.project.${huge.id}`), null);
  ok(!listProjects(store).some((e) => e.id === huge.id), "a refused project is not listed");
  eq(store.getItem("cmrlm.project.last"), warn.id);

  // a refused save leaves the earlier saved copy of the same project alone
  const first = sample();
  ok(saveProject(store, first).ok);
  const grown = writeSection(first, "site", { derived: { pad: "x".repeat(SIZE_MAX) } });
  eq(saveProject(store, grown).ok, false);
  eq(loadProject(store, first.id), first);
});

/* ---------- validate ---------- */

t("7. validate accepts a good project and rejects a bad format, a missing frame and a non-number placement", () => {
  const good = sample();
  eq(validate(good), { ok: true, errors: [] });
  let bad = clone(good); bad.format = "other";
  let r = validate(bad);
  ok(!r.ok && r.errors.some((e) => e.startsWith("format")), r.errors.join("; "));
  bad = clone(good); delete bad.frame;
  r = validate(bad);
  ok(!r.ok && r.errors.some((e) => e.startsWith("frame")), r.errors.join("; "));
  bad = clone(good); bad.sections.massing.placement.rotation = "90";
  r = validate(bad);
  ok(!r.ok && r.errors.some((e) => e.includes("sections.massing.placement.rotation")), r.errors.join("; "));
  bad = clone(good); bad.sections.plates.placement.x = null;
  ok(validate(bad).errors.some((e) => e.includes("sections.plates.placement.x")));
});

t("7b. validate: version, frame shape, section keys, log and non-objects", () => {
  const good = sample();
  const errs = (mut) => { const d = clone(good); mut(d); return validate(d).errors.join("; "); };
  ok(/newer/.test(errs((d) => { d.version = 2; })), "a newer version is an error that says newer");
  ok(/version/.test(errs((d) => { d.version = "1"; })));
  ok(/frame\.kind/.test(errs((d) => { d.frame.kind = "mars"; })));
  ok(/frame\.lat/.test(errs((d) => { d.frame.lat = "33.9"; })));
  ok(/frame\.size/.test(errs((d) => { d.frame.size = undefined; })));
  ok(/frame\.zDatum/.test(errs((d) => { d.frame.zDatum = ""; })));
  ok(/units/.test(errs((d) => { d.units = "meters"; })));
  ok(/sections\.site\.derived/.test(errs((d) => { delete d.sections.site.derived; })));
  ok(/sections\.site\.state/.test(errs((d) => { d.sections.site.state = []; })));
  ok(/sections\.site\.tool/.test(errs((d) => { delete d.sections.site.tool; })));
  ok(/sections\.site\.schema/.test(errs((d) => { d.sections.site.schema = "1"; })));
  ok(/sections\.site\.updatedAt/.test(errs((d) => { delete d.sections.site.updatedAt; })));
  ok(/sections\.site\.placement/.test(errs((d) => { delete d.sections.site.placement; })));
  ok(/log/.test(errs((d) => { d.log = {}; })));
  ok(/sections/.test(errs((d) => { d.sections = []; })));
  for (const v of [null, undefined, 5, "x", []]) eq(validate(v).ok, false);
  const local = newProject({ name: "local" });
  eq(validate(local), { ok: true, errors: [] });
});

/* ---------- handoff, import, url, size helpers ---------- */

t("sendTo saves a copy with a send entry, leaves the input alone and returns ../<tool>/?project=<id>", () => {
  const store = memStore();
  const doc = sample();
  const snap = JSON.stringify(doc);
  const url = sendTo(store, doc, "plate", "tower");
  eq(url, `../plate/?project=${doc.id}`);
  eq(JSON.stringify(doc), snap);
  const saved = loadProject(store, doc.id);
  const last = saved.log[saved.log.length - 1];
  eq(Object.keys(last), ["at", "tool", "action", "note"]);
  eq({ tool: last.tool, action: last.action, note: last.note }, { tool: "tower", action: "send", note: "tower → plate" });
  eq(saved.log.length, doc.log.length + 1);
  ok(saved.updatedAt === last.at && saved.updatedAt > doc.updatedAt, "updatedAt moves to the send time");
  eq(saved.sections, doc.sections);
  eq(store.getItem("cmrlm.project.last"), doc.id);
  eq(listProjects(store)[0].id, doc.id);
  eq(sendTo(store, doc, "midrise").endsWith("/?project=" + doc.id), true, "from tool is optional");
  throws(() => sendTo(store, doc, "../evil", "tower"), (e) => ok(/toolId/.test(e.message)));
  throws(() => sendTo(store, doc, "", "tower"));
  throws(() => sendTo(memStore(["set"]), doc, "plate", "tower"), (e) => eq(e.saveFailed, true));
  throws(() => sendTo(store, { ...doc, version: 2 }, "plate", "tower"), (e) => eq(e.readOnly, true));
});

t("importProject renames on id collision (Name (2), Name (3)) and reads a JSON string or a file-like object", async () => {
  const store = memStore();
  const doc = sample();
  ok(saveProject(store, doc).ok);
  const text = JSON.stringify(doc);
  const a = await importProject(text, store);
  eq(a.renamed, true);
  ok(a.doc.id !== doc.id);
  eq(a.doc.name, "Ravinia test (2)");
  const b = await importProject({ size: text.length, text: async () => text }, store);
  eq([b.renamed, b.doc.name], [true, "Ravinia test (3)"]);
  eq(loadProject(store, doc.id), doc);
  eq(listProjects(store).map((e) => e.name).sort(), ["Ravinia test", "Ravinia test (2)", "Ravinia test (3)"]);
  eq(store.getItem("cmrlm.project.last"), b.doc.id);
  // a free number is used first: remove "(2)" and the next copy takes it
  deleteProject(store, a.doc.id);
  eq((await importProject(text, store)).doc.name, "Ravinia test (2)");
  // a file with a BOM, a file without an id, and a file that was never saved before
  const bom = await importProject("﻿" + JSON.stringify({ ...sample(), name: "Bom" }), store);
  eq([bom.renamed, bom.doc.name], [false, "Bom"]);
  const noId = clone(sample()); delete noId.id;
  const fresh = await importProject(JSON.stringify(noId), store);
  ok(typeof fresh.doc.id === "string" && fresh.doc.id && !fresh.renamed);
  ok(loadProject(store, fresh.doc.id));
});

t("importProject rejects bad files with a message for the user, and saves nothing", async () => {
  const store = memStore();
  const doc = sample();
  await rejects(importProject(null, store), /No file/);
  await rejects(importProject("{ not json", store), /not valid JSON/);
  await rejects(importProject("[1, 2]", store), /not a design tools project/);
  await rejects(importProject(JSON.stringify({ ...doc, format: "x" }), store), /not a design tools project/);
  await rejects(importProject(JSON.stringify({ ...doc, version: 2 }), store), /newer version/);
  await rejects(importProject(JSON.stringify({ ...doc, frame: null }), store), /not valid.*frame/);
  await rejects(importProject({ size: 30 * 1024 * 1024, text: async () => "{}" }, store), /too large/);
  await rejects(importProject({ size: 5, text: async () => { throw new Error("boom"); } }, store), /could not be read/);
  const huge = writeSection(doc, "site", { derived: { pad: "x".repeat(SIZE_MAX) } });
  await rejects(importProject(JSON.stringify(huge), store), /over the 4\.0 MB limit/);
  await rejects(importProject(JSON.stringify(doc), memStore(["set"])), /unavailable/);
  eq(store.map.size, 0);
});

t("exportProject: slugged <name>.cmrlm.json; without Blob it returns { filename, text }", async () => {
  eq(exportProject({ ...sample(), name: "Option A — Point Tower (v2)" }).filename, "option-a-point-tower-v2.cmrlm.json");
  eq(exportProject({ ...sample(), name: "日本" }).filename, "project.cmrlm.json");
  const doc = sample();
  const { blob } = exportProject(doc);
  eq(blob.type, "application/json");
  eq(JSON.parse(await blob.text()), doc);
  const saved = globalThis.Blob;
  globalThis.Blob = undefined;
  try {
    const r = exportProject(doc);
    eq(Object.keys(r).sort(), ["filename", "text"]);
    eq(JSON.parse(r.text), doc);
    eq((await importProject(r.text, memStore())).doc, doc);
  } finally {
    globalThis.Blob = saved;
  }
});

t("projectIdFromUrl reads ?project= from a string or a location-like object, and gives null without it", () => {
  const id = "6f1c2e0a-5c3d-4b8e-9a7f-1d2e3f4a5b6c";
  eq(projectIdFromUrl(`?project=${id}`), id);
  eq(projectIdFromUrl(`https://u.github.io/design-tools/plate/?project=${id}#top`), id);
  eq(projectIdFromUrl({ search: `?a=1&project=${id}&b=2` }), id);
  eq(projectIdFromUrl(new URL(`https://x.test/tower/?project=${id}`)), id);
  eq(projectIdFromUrl("project=abc"), "abc");
  eq(projectIdFromUrl("?project=a%20b"), "a b");
  for (const none of ["", "?foo=1", "?project=", "?project=%20", "?project=index", "?project=last", "https://x.test/tower/", "https://x.test/a/?x=1#project=abc", { search: "" }, {}, undefined, null, 42]) {
    eq(projectIdFromUrl(none), null, JSON.stringify(none));
  }
});

t("largestSection and projectBytes", () => {
  const doc = writeSection(sample(), "plates", { derived: { pad: "y".repeat(5000) } });
  const r = largestSection(doc);
  eq(r.key, "plates");
  eq(r.bytes, projectBytes(doc.sections.plates));
  ok(r.bytes > 5000);
  eq(largestSection(newProject({ name: "empty" })), { key: null, bytes: 0 });
  eq(largestSection(null), { key: null, bytes: 0 });
  eq(largestSection(writeSection(doc, "site", { derived: { pad: "z".repeat(9000) } })).key, "site");
  const d = newProject({ name: "Café — 日本 😀" });
  eq(projectBytes(d), Buffer.byteLength(JSON.stringify(d), "utf8"));
  ok(projectBytes(d) > JSON.stringify(d).length, "multi-byte characters count more than one byte");
  eq(projectBytes(undefined), 0);
});

/* ---------- writeSection details, migrate, newProject, getSection ---------- */

t("writeSection: stamps, one log entry, defaults for a new section, newest 200 log entries kept", () => {
  const d = newProject({ name: "log" });
  const out = writeSection(d, "sun", { derived: { lat: 33.9 }, note: "Sun study" });
  const s = out.sections.sun;
  eq(Object.keys(s), ["tool", "schema", "updatedAt", "placement", "state", "derived"]);
  eq([s.tool, s.schema, s.placement, s.state], ["tower", 1, PL(), {}]);
  ok(s.updatedAt === out.updatedAt && out.updatedAt > d.updatedAt, "stamps move forward");
  eq(out.log.length, 1);
  eq(Object.keys(out.log[0]), ["at", "tool", "action", "note"]);
  eq(out.log[0], { at: out.updatedAt, tool: "tower", action: "write", note: "Sun study" });
  eq(validate(out), { ok: true, errors: [] });
  eq(d.log, []);
  let cur = out;
  for (let i = 0; i < 204; i++) cur = writeSection(cur, "site", { note: "n" + i });
  eq(cur.log.length, 200);
  eq([cur.log[0].note, cur.log[199].note], ["n4", "n203"]);
  ok(cur.log.every((e, i, a) => i === 0 || a[i - 1].at < e.at), "log times strictly increase");
  eq(cur.updatedAt, cur.log[199].at);
  eq(writeSection(d, "egress", {}).log[0].note, "");
  eq(writeSection(d, "massing").sections.massing.tool, "tower");
  eq(["site", "plates", "parking", "facade", "grading", "egress"].map((k) => writeSection(d, k, {}).sections[k].tool), ["site", "plate", "parking", "facade", "grading", "egress"]);
});

t("writeSection: placement merges with the stored one; bad input throws a plain error", () => {
  const doc = sample();
  eq(writeSection(doc, "massing", { placement: { x: 10, rotation: 30 } }).sections.massing.placement, { x: 10, y: 500, rotation: 30, baseZ: 1012.5 });
  eq(writeSection(doc, "massing", { placement: { x: 1, y: 2, rotation: 3, baseZ: 4, extra: "kept" } }).sections.massing.placement, { x: 1, y: 2, rotation: 3, baseZ: 4, extra: "kept" });
  eq(writeSection(doc, "massing", { tool: "midrise" }).sections.massing.tool, "midrise");
  for (const patch of [{ placement: { x: "5" } }, { placement: null }, { state: [] }, { derived: "x" }, { tool: "" }, { schema: 0 }, { schema: 1.5 }]) {
    throws(() => writeSection(doc, "massing", patch), (e) => ok(!e.readOnly, JSON.stringify(patch)));
  }
  throws(() => writeSection(null, "site", {}));
});

t("writeSection does not mutate the project or the patch, and stores copies", () => {
  const doc = sample();
  const snap = JSON.stringify(doc);
  deepFreeze(doc);
  const patch = deepFreeze({ tool: "tower", schema: 1, placement: PL({ x: 1 }), state: { a: [1] }, derived: { b: { c: 2 } }, note: "n" });
  const out = writeSection(doc, "massing", patch);
  ok(out !== doc && out.sections !== doc.sections && out.sections.massing !== doc.sections.massing, "a new object");
  eq(JSON.stringify(doc), snap);
  ok(out.sections.massing.state !== patch.state && out.sections.massing.state.a !== patch.state.a, "state is a copy");
  ok(out.sections.massing.derived.b !== patch.derived.b, "derived is a copy");
  ok(out.sections.site !== doc.sections.site, "untouched sections are copies too");
});

t("the read and save functions accept a deeply frozen project", () => {
  const doc = deepFreeze(sample());
  const store = memStore();
  ok(validate(doc).ok);
  eq(migrate(doc), doc);
  ok(getSection(doc, "site"));
  ok(siteContextFor(doc, PL(), 100));
  ok(exportProject(doc).filename);
  ok(projectBytes(doc) > 0 && largestSection(doc).key);
  ok(saveProject(store, doc).ok);
  ok(sendTo(store, doc, "plate", "tower"));
  eq(transformRing(doc.sections.massing, deepFreeze(sq(0, 0, 1, 1)), "toProject").length, 4);
  eq(transformMultiPoly(doc.sections.massing, doc.sections.massing.derived.footprint, "toProject").length, 1);
});

t("getSection returns the section or null and never throws", () => {
  const doc = sample();
  eq(getSection(doc, "site"), doc.sections.site);
  ok(getSection(doc, "site") === doc.sections.site, "the stored object itself");
  for (const [d, k] of [[doc, "parking"], [doc, "constructor"], [doc, "__proto__"], [doc, undefined], [null, "site"], [undefined, "site"], [{}, "site"], [{ sections: null }, "site"], [{ sections: { site: 5 } }, "site"], ["x", "site"]]) {
    eq(getSection(d, k), null, String(k));
  }
});

t("migrate: version 1 is unchanged, a missing log and units are filled, a newer project is left alone", () => {
  const doc = sample();
  eq(migrate(doc), doc);
  const old = clone(doc); delete old.log; delete old.units;
  const m = migrate(old);
  eq([m.log, m.units, m.version], [[], "feet", VERSION]);
  ok(validate(m).ok);
  ok(!("log" in old) && !("units" in old), "the input is not changed");
  eq(migrate({ ...clone(doc), version: 0 }).version, VERSION);
  const future = { ...clone(doc), version: 7, mystery: true };
  eq(migrate(future), future);
  eq(migrate(null), null);
  eq(migrate("x"), "x");
});

t("newProject: fresh id, equal timestamps, feet, local frame by default, empty sections and log", () => {
  const a = newProject({ name: "  Alpha  " }), b = newProject({ name: "Alpha" });
  ok(a.id && a.id !== b.id, "ids differ");
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a.id), "a UUID where crypto.randomUUID exists");
  eq(a.name, "Alpha");
  eq(a.createdAt, a.updatedAt);
  ok(!Number.isNaN(Date.parse(a.createdAt)));
  eq([a.format, a.version, a.units], [FORMAT, VERSION, "feet"]);
  eq(a.frame, { kind: "local", lat: null, lon: null, size: null, zDatum: "local" });
  eq([a.sections, a.log], [{}, []]);
  eq(newProject().name, "Untitled");
  const s = newProject({ name: "S", frame: { kind: "site", lat: 33.9, lon: -84.3, size: 1000 } });
  eq(s.frame, { kind: "site", lat: 33.9, lon: -84.3, size: 1000, zDatum: "NAVD88" });
  ok(validate(a).ok && validate(s).ok);
  eq(SECTIONS, ["site", "massing", "plates", "parking", "facade", "sun", "grading", "egress"]);
  eq([FORMAT, VERSION, SIZE_WARN, SIZE_MAX], ["cmrlm-design-tools/project", 1, 3145728, 4194304]);
});

/* ---------- storage ---------- */

t("storage failures: onNotice runs once per storage, nothing throws, saves report not ok", () => {
  const notes = [];
  const opts = { onNotice: (m) => notes.push(m) };
  const bad = memStore(["get", "set", "remove"]);
  eq(listProjects(bad, opts), []);
  eq(loadProject(bad, "abc", opts), null);
  const r = saveProject(bad, sample(), opts);
  eq(r.ok, false);
  ok(/unavailable/.test(r.warning), r.warning);
  eq(deleteProject(bad, "abc", opts), false);
  eq(notes.length, 1);
  ok(/Saving is unavailable/.test(notes[0]));
  listProjects(memStore(["get"]), opts);
  eq(notes.length, 2, "another storage object gets its own notice");
  eq(listProjects(memStore(["get"])), [], "no handler: no call, no throw");
  throws(() => { throw new Error("x"); });
  const readOnly = memStore(["set"]);
  eq(saveProject(readOnly, sample()).ok, false);
  eq(listProjects(readOnly), []);
  const throwing = { onNotice: () => { throw new Error("handler bug"); } };
  eq(listProjects(memStore(["get"]), throwing), [], "a failing handler is ignored");
  if (typeof globalThis.localStorage === "undefined") {
    eq(listProjects(undefined, opts), []);
    eq(saveProject(undefined, sample(), opts).ok, false);
    eq(loadProject(undefined, "abc"), null);
  }
});

t("listProjects is newest first by updatedAt; deleteProject removes the file, the entry and last; a corrupt index is backed up", () => {
  const store = memStore();
  const mk = (name, at) => { const d = newProject({ name }); d.updatedAt = at; return d; };
  const a = mk("A", "2026-10-01T00:00:00.000Z"), b = mk("B", "2026-10-02T00:00:00.000Z"), c = mk("C", "2026-09-30T00:00:00.000Z");
  for (const d of [a, c, b]) ok(saveProject(store, d).ok);
  eq(listProjects(store).map((e) => e.name), ["B", "A", "C"]);
  eq(Object.keys(listProjects(store)[0]), ["id", "name", "updatedAt", "bytes"]);
  eq(store.getItem("cmrlm.project.last"), b.id);
  ok(saveProject(store, { ...a, name: "A renamed" }).ok);
  eq(listProjects(store).map((e) => e.name), ["B", "A renamed", "C"], "saving again replaces the entry");
  eq(store.getItem("cmrlm.project.last"), a.id);
  eq(deleteProject(store, b.id), true);
  eq(store.getItem("cmrlm.project.last"), a.id, "last stays when another project is deleted");
  eq(deleteProject(store, a.id), true);
  eq(store.getItem("cmrlm.project.last"), null, "last is cleared with its project");
  eq(listProjects(store).map((e) => e.name), ["C"]);
  eq(loadProject(store, a.id), null);
  eq(store.getItem(`cmrlm.project.${a.id}`), null);
  eq([deleteProject(store, "nope"), deleteProject(store, "index"), deleteProject(store, undefined)], [false, false, false]);

  store.setItem("cmrlm.project.index", JSON.stringify([{ id: "x1", name: "X", updatedAt: "2026-01-01", bytes: 5 }, { nope: 1 }, { id: "index" }, { id: "x1" }, 7]));
  eq(listProjects(store), [{ id: "x1", name: "X", updatedAt: "2026-01-01", bytes: 5 }]);
  store.setItem("cmrlm.project.index", "{oops");
  const notes = [];
  eq(listProjects(store, { onNotice: (m) => notes.push(m) }), []);
  eq(notes.length, 1);
  eq(store.getItem("cmrlm.project.index.corrupt"), "{oops");
  ok(saveProject(store, c).ok, "a fresh index is written on the next save");
  eq(listProjects(store).map((e) => e.name), ["C"]);
});

t("loadProject returns null for a missing, unreadable, invalid or newer project, migrates an old one, writes nothing", () => {
  const store = memStore();
  const good = sample();
  ok(saveProject(store, good).ok);
  eq(loadProject(store, good.id), good);
  eq(loadProject(store, "nope"), null);
  store.setItem("cmrlm.project.junk", "{bad");
  eq(loadProject(store, "junk"), null);
  store.setItem("cmrlm.project.badformat", JSON.stringify({ ...good, format: "x" }));
  eq(loadProject(store, "badformat"), null);
  store.setItem("cmrlm.project.noframe", JSON.stringify({ ...good, frame: undefined }));
  eq(loadProject(store, "noframe"), null);
  const notes = [];
  store.setItem("cmrlm.project.future", JSON.stringify({ ...good, version: 3 }));
  eq(loadProject(store, "future", { onNotice: (m) => notes.push(m) }), null);
  ok(notes.length === 1 && /newer version/.test(notes[0]), notes.join("|"));
  const old = clone(good); delete old.log; delete old.units;
  store.setItem("cmrlm.project.old", JSON.stringify(old));
  const o = loadProject(store, "old");
  ok(o && o.units === "feet" && Array.isArray(o.log) && o.name === good.name);
  for (const id of ["index", "last", "", undefined, null, 5]) eq(loadProject(store, id), null, String(id));
  const before = [...store.map.entries()].join("\n");
  loadProject(store, good.id); listProjects(store);
  eq([...store.map.entries()].join("\n"), before);
});

t("saveProject refuses an invalid or newer project and stores nothing; it migrates a project without log or units", () => {
  const store = memStore();
  const bad = sample(); bad.sections.massing.placement.x = "1";
  let r = saveProject(store, bad);
  eq(r.ok, false); ok(/not valid/.test(r.warning) && /placement\.x/.test(r.warning), r.warning);
  r = saveProject(store, { ...sample(), version: 2 });
  eq(r.ok, false); ok(/newer version/.test(r.warning), r.warning);
  r = saveProject(store, { ...sample(), id: "index" });
  eq(r.ok, false); ok(/not valid/.test(r.warning));
  eq(saveProject(store, null).ok, false);
  eq(saveProject(store, "text").ok, false);
  eq(store.map.size, 0);
  const old = sample(); delete old.log; delete old.units;
  r = saveProject(store, old);
  ok(r.ok);
  const back = loadProject(store, old.id);
  ok(Array.isArray(back.log) && back.units === "feet");
  ok(!("log" in old), "the project passed in is not changed");
  eq(listProjects(store)[0].bytes, r.bytes);
});

/* ---------- build.py can inline the module ---------- */

t("inlinable by build/site/build.py: exports at line start, no imports, no window or document, no top-level await", () => {
  const src = readFileSync(new URL("../src/shared/project.js", import.meta.url), "utf8");
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  eq(names.slice().sort(), Object.keys(P).sort(), "build.py must see every export");
  eq(names.length, 25);
  ok(!/^import\s/m.test(src), "an import at the start of a line");
  ok(!/\bimport\s*[({]/.test(src), "an import call or statement");
  ok(!/\b(window|document)\b/.test(src), "window or document in the source");
  ok(!/^await\s/m.test(src), "top-level await");
  ok(!/^export\s+(?!async function|function|const)/m.test(src), "an export form the wrapper cannot read");
  const body = src.replace(/^export\s+/gm, "");
  const mod = new Function(`${body}\nreturn { ${names.join(", ")} };`)();
  eq(Object.keys(mod).sort(), names.slice().sort());
  const d = mod.writeSection(mod.newProject({ name: "inline" }), "site", { derived: { a: 1 } });
  ok(mod.validate(d).ok);
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
