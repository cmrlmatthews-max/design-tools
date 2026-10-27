// Node tests for app/core/project-store.js. Run: node test/app.project-store.test.mjs
// Memory storage, a fake window (events, address bar) and fake timers drive the store without a browser.
import { createProjectStore } from "../app/core/project-store.js";
import { createBus } from "../app/core/bus.js";
import { newProject, writeSection, saveProject, loadProject, getSection, listProjects } from "../src/shared/project.js";

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const eq = (a, b, m = "") => { if (canon(a) !== canon(b)) throw new Error(`${m} expected ${canon(b)} got ${canon(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || "expected true"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    map: m,
  };
}

// fake timers: run() fires every pending timer
function fakeTimers() {
  let next = 1;
  const live = new Map();
  return {
    setTimeout: (fn, ms) => { const id = next++; live.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { live.delete(id); },
    count: () => live.size,
    delays: () => [...live.values()].map((x) => x.ms),
    run: () => { const all = [...live.values()]; live.clear(); all.forEach((x) => x.fn()); },
  };
}

// a fake window with listeners, a document with visibilityState, an address bar
function fakeWin(href = "https://x.test/design-tools/app/") {
  const ls = new Map();
  const add = (map) => (evt, fn) => { if (!map.has(evt)) map.set(evt, new Set()); map.get(evt).add(fn); };
  const rm = (map) => (evt, fn) => { if (map.has(evt)) map.get(evt).delete(fn); };
  const fire = (map) => (evt, e = {}) => { for (const fn of map.get(evt) || []) fn(e); };
  const dls = new Map();
  const win = {
    location: new URL(href),
    history: { state: null, replaceState(state, title, url) { win.location = new URL(url, win.location.href); } },
    addEventListener: add(ls), removeEventListener: rm(ls), fire: fire(ls),
    document: { visibilityState: "visible", addEventListener: add(dls), removeEventListener: rm(dls), fire: fire(dls) },
  };
  return win;
}

// records every event on the bus
function recorder(b) {
  const log = [];
  const orig = b.emit;
  b.emit = (evt, p) => { log.push([evt, p]); return orig(evt, p); };
  return {
    log,
    names: () => log.map(([e]) => e),
    of: (evt) => log.filter(([e]) => e === evt).map(([, p]) => p),
    clear: () => { log.length = 0; },
  };
}

function setup({ storage = memStore(), href, debounceMs = 1000, autoStart = true } = {}) {
  const bus = createBus();
  const rec = recorder(bus);
  const timers = fakeTimers();
  const win = fakeWin(href);
  const ps = createProjectStore({ storage, bus, debounceMs, win, timers, autoStart });
  return { ps, bus, rec, timers, win, storage };
}

const PL = { x: 0, y: 0, rotation: 0, baseZ: 0 };
/** Another page saves a section (the Plate Planner, a second tab): load fresh, write, save. */
function otherPageWrites(storage, id, key, patch) {
  const d = loadProject(storage, id);
  const next = writeSection(d, key, patch);
  const res = saveProject(storage, next);
  if (!res.ok) throw new Error(res.warning);
  return next;
}

/* ---------- open, create, ensure ---------- */

t("ensure() creates, saves and opens an Untitled project", () => {
  const { ps, rec, storage } = setup();
  eq(ps.doc(), null);
  const d = ps.ensure();
  ok(d && d.name === "Untitled project");
  eq(ps.id(), d.id);
  eq(storage.getItem("cmrlm.project.last"), d.id);
  ok(loadProject(storage, d.id), "saved");
  eq(listProjects(storage).map((e) => e.id), [d.id]);
  eq(rec.of("project:open").length, 1);
  eq(rec.of("project:open")[0].doc.id, d.id);
  ok(ps.ensure() === d, "a second ensure() keeps the same project");
  eq(rec.of("project:open").length, 1);
});

t("create(name) trims and falls back to Untitled project; the address gets ?project=", () => {
  const { ps, win } = setup();
  eq(ps.create("  Ravinia  ").name, "Ravinia");
  eq(win.location.searchParams.get("project"), ps.id());
  eq(ps.create("   ").name, "Untitled project");
  eq(ps.create(null).name, "Untitled project");
  eq(ps.list().length, 3);
});

t("startup opens ?project=<id>, else cmrlm.project.last, else nothing", () => {
  const storage = memStore();
  const a = newProject({ name: "A" }), b = newProject({ name: "B" });
  saveProject(storage, a);
  saveProject(storage, b);                              // last = b
  const one = setup({ storage, href: `https://x.test/app/?project=${a.id}` });
  eq(one.ps.id(), a.id);
  eq(storage.getItem("cmrlm.project.last"), a.id, "opening sets last");
  storage.setItem("cmrlm.project.last", b.id);
  const two = setup({ storage });
  eq(two.ps.id(), b.id);
  const three = setup({ storage: memStore() });
  eq(three.ps.doc(), null);
  eq(three.rec.of("project:open").length, 0);
  const four = setup({ storage, href: "https://x.test/app/?project=missing" });
  eq(four.ps.id(), b.id, "an unknown id falls back to last");
});

t("open() emits project:open; close() forgets it", () => {
  const { ps, rec, storage } = setup();
  const a = ps.create("A");
  const b = ps.create("B");
  rec.clear();
  ok(ps.open(a.id));
  eq(rec.of("project:open")[0].doc.id, a.id);
  eq(storage.getItem("cmrlm.project.last"), a.id);
  ok(ps.open("nope") === null);
  eq(ps.id(), a.id, "a failed open keeps the open project");
  ok(rec.of("notice").length >= 1);
  ps.close();
  eq(ps.doc(), null);
  eq(rec.of("project:open").pop().doc, null);
  eq(ps.list().map((e) => e.id).sort(), [a.id, b.id].sort());
});

/* ---------- write, ownership, debounce, flush ---------- */

t("write() changes only its own section, emits section:<key> and project:change with the tool", () => {
  const { ps, rec } = setup();
  const d0 = ps.ensure();
  rec.clear();
  const site = { tool: "site", schema: 1, placement: PL, state: { a: 1 }, derived: { boundary: [] } };
  ps.write("site", site);
  const d1 = ps.doc();
  ok(d1 !== d0, "a new doc object");
  eq(getSection(d0, "site"), null, "the old doc is not changed");
  rec.clear();
  ps.write("massing", { tool: "tower", schema: 1, placement: { ...PL, x: 5 }, state: { s: 1 }, derived: { levels: [] } });
  eq(getSection(ps.doc(), "site").state, { a: 1 }, "site kept");
  eq(getSection(ps.doc(), "site").updatedAt, getSection(d1, "site").updatedAt, "site untouched");
  const sec = rec.of("section:massing");
  eq(sec.length, 1);
  eq(sec[0].source, "local");
  eq(sec[0].tool, "tower");
  eq(sec[0].section.placement.x, 5);
  const ch = rec.of("project:change");
  eq(ch.length, 1);
  eq(ch[0].keys, ["massing"]);
  eq(ch[0].source, "local");
  eq(ch[0].tool, "tower");
  eq(rec.names().filter((n) => n.startsWith("section:")), ["section:massing"], "no other section event");
});

t("write() on an unknown key does nothing", () => {
  const { ps, rec } = setup();
  ps.ensure();
  const before = ps.doc();
  eq(ps.write("bogus", { state: {} }), null);
  ok(ps.doc() === before);
  ok(rec.of("notice").length >= 1);
});

t("write() makes a project first when none is open", () => {
  const { ps, storage } = setup();
  ps.write("massing", { tool: "tower", state: { x: 1 } });
  ok(ps.doc());
  eq(ps.doc().name, "Untitled project");
  eq(storage.getItem("cmrlm.project.last"), ps.id());
});

t("autosave waits 1 s (one timer, restarted); flush saves now", () => {
  const { ps, timers, storage } = setup();
  ps.ensure();
  const id = ps.id();
  ps.write("massing", { tool: "tower", state: { n: 1 } });
  ps.write("massing", { state: { n: 2 } });
  ps.write("massing", { state: { n: 3 } });
  eq(timers.count(), 1, "one pending save");
  eq(timers.delays(), [1000]);
  eq(getSection(loadProject(storage, id), "massing"), null, "not saved yet");
  eq(ps.pending(), ["massing"]);
  timers.run();
  const saved = getSection(loadProject(storage, id), "massing");
  eq(saved.state, { n: 3 });
  eq(saved.tool, "tower", "the merged patch keeps the tool of the first write");
  eq(ps.pending(), []);
  ps.write("massing", { state: { n: 4 } });
  const res = ps.flush();
  ok(res.ok && !res.skipped);
  eq(timers.count(), 0, "flush clears the timer");
  eq(getSection(loadProject(storage, id), "massing").state, { n: 4 });
  ok(ps.flush().skipped, "nothing to save");
});

t("visibilitychange hidden and pagehide flush", () => {
  const { ps, win, storage } = setup();
  ps.ensure();
  const id = ps.id();
  ps.write("parking", { tool: "parking", state: { a: 1 } });
  win.document.visibilityState = "hidden";
  win.document.fire("visibilitychange");
  eq(getSection(loadProject(storage, id), "parking").state, { a: 1 });
  ps.write("parking", { state: { a: 2 } });
  win.fire("pagehide");
  eq(getSection(loadProject(storage, id), "parking").state, { a: 2 });
});

t("flush merges: a newer stored section of another tool is kept, never overwritten", () => {
  const { ps, rec, storage } = setup();
  ps.ensure();
  const id = ps.id();
  ps.write("massing", { tool: "tower", state: { mine: 1 } });
  ps.flush();
  ps.write("massing", { tool: "tower", state: { mine: 2 } });     // pending in memory
  // the Plate Planner saves plates from its own page, and another page rewrites site
  otherPageWrites(storage, id, "plates", { tool: "plate", state: { p: 1 }, derived: { levels: [1] } });
  otherPageWrites(storage, id, "site", { tool: "site", state: { s: 9 } });
  rec.clear();
  ps.flush();
  const stored = loadProject(storage, id);
  eq(getSection(stored, "massing").state, { mine: 2 }, "own section written");
  eq(getSection(stored, "plates").state, { p: 1 }, "plates kept");
  eq(getSection(stored, "site").state, { s: 9 }, "site kept");
  eq(getSection(ps.doc(), "plates").derived, { levels: [1] }, "the page has the plates now");
  const keys = rec.of("section:plates").concat(rec.of("section:site"));
  eq(keys.length, 2);
  ok(keys.every((p) => p.source === "storage"));
  eq(rec.of("section:plates")[0].tool, "plate");
  eq(rec.of("section:massing").length, 0, "own section is not announced again");
  const ch = rec.of("project:change");
  eq(ch.length, 1);
  eq(ch[0].keys.sort(), ["plates", "site"]);
  eq(ch[0].tool, null, "two writers: tool unknown");
});

t("flush merges the project name and other keys from the stored copy", () => {
  const { ps, storage } = setup();
  ps.create("A");
  const id = ps.id();
  const d = loadProject(storage, id);
  d.custom = { kept: true };
  saveProject(storage, d);
  ps.write("grading", { tool: "grading", state: { g: 1 } });
  ps.flush();
  eq(loadProject(storage, id).custom, { kept: true });
});

/* ---------- reload ---------- */

t("reload emits section:<key> only for sections whose updatedAt changed", () => {
  const { ps, rec, storage } = setup();
  ps.ensure();
  const id = ps.id();
  ps.write("site", { tool: "site", state: { s: 1 } });
  ps.write("massing", { tool: "tower", state: { m: 1 } });
  ps.flush();
  rec.clear();
  eq(ps.reload(), [], "nothing changed");
  eq(rec.of("project:change").length, 0);
  otherPageWrites(storage, id, "plates", { tool: "plate", derived: { units: 3 } });
  const keys = ps.reload();
  eq(keys, ["plates"]);
  eq(rec.names(), ["section:plates", "project:change"]);
  const p = rec.of("section:plates")[0];
  eq(p.source, "storage");
  eq(p.tool, "plate");
  eq(p.section.derived, { units: 3 });
  eq(rec.of("project:change")[0], { doc: ps.doc(), keys: ["plates"], source: "storage", tool: "plate" });
});

t("reload keeps a local section that is not saved yet", () => {
  const { ps, storage } = setup();
  ps.ensure();
  const id = ps.id();
  ps.write("massing", { tool: "tower", state: { m: "local" } });
  otherPageWrites(storage, id, "plates", { tool: "plate", derived: { u: 1 } });
  ps.reload();
  eq(getSection(ps.doc(), "massing").state, { m: "local" });
  eq(getSection(ps.doc(), "plates").derived, { u: 1 });
  ps.flush();
  eq(getSection(loadProject(storage, id), "massing").state, { m: "local" });
  eq(getSection(loadProject(storage, id), "plates").derived, { u: 1 });
});

t("focus, visible, pageshow and the storage event reload", () => {
  const { ps, rec, win, storage } = setup();
  ps.ensure();
  const id = ps.id();
  const step = (fire, n) => {
    otherPageWrites(storage, id, "plates", { tool: "plate", derived: { n } });
    rec.clear();
    fire();
    eq(rec.of("section:plates").length, 1, `reload ${n}`);
    eq(getSection(ps.doc(), "plates").derived, { n });
  };
  step(() => win.fire("focus"), 1);
  step(() => { win.document.visibilityState = "visible"; win.document.fire("visibilitychange"); }, 2);
  step(() => win.fire("pageshow", { persisted: true }), 3);
  step(() => win.fire("storage", { key: `cmrlm.project.${id}` }), 4);
  otherPageWrites(storage, id, "plates", { tool: "plate", derived: { n: 5 } });
  rec.clear();
  win.fire("storage", { key: "cmrlm.project.other" });
  eq(rec.of("section:plates").length, 0, "another project's key is ignored");
  ps.dispose();
  win.fire("focus");
  eq(rec.of("section:plates").length, 0, "dispose removes the listeners");
});

/* ---------- read-only ---------- */

t("a section with a newer schema is read-only; write() shows a notice and does nothing", () => {
  const storage = memStore();
  let d = newProject({ name: "Newer" });
  d = writeSection(d, "massing", { tool: "tower", schema: 2, state: { future: true } });
  saveProject(storage, d);
  const { ps, rec, timers } = setup({ storage });
  eq(ps.id(), d.id);
  ok(ps.isReadOnly("massing"));
  ok(!ps.isReadOnly("plates"));
  const before = ps.doc();
  eq(ps.write("massing", { tool: "tower", schema: 1, state: { mine: true } }), null);
  ok(ps.doc() === before, "doc unchanged");
  eq(timers.count(), 0, "no save planned");
  eq(rec.of("notice").length, 1);
  eq(rec.of("section:massing").length, 0);
  eq(getSection(loadProject(storage, d.id), "massing").state, { future: true });
  ok(ps.write("plates", { tool: "plate", state: { ok: 1 } }), "other sections still write");
});

t("flush never writes over a section that turned newer in storage", () => {
  const { ps, storage } = setup();
  ps.ensure();
  const id = ps.id();
  ps.write("parking", { tool: "parking", state: { mine: 1 } });
  otherPageWrites(storage, id, "parking", { tool: "parking", schema: 3, state: { newer: true } });
  ps.flush();
  eq(getSection(loadProject(storage, id), "parking").state, { newer: true });
  ok(ps.isReadOnly("parking"));
});

/* ---------- files ---------- */

t("importFile opens the imported project; a second import is a copy", async () => {
  const { ps, rec } = setup();
  const src = newProject({ name: "Imported" });
  const text = JSON.stringify(writeSection(src, "site", { tool: "site", state: { q: 1 } }));
  const a = await ps.importFile(text);
  eq(a.name, "Imported");
  eq(ps.id(), a.id);
  eq(getSection(ps.doc(), "site").state, { q: 1 });
  const b = await ps.importFile(text);
  eq(b.name, "Imported (2)");
  ok(b.id !== a.id);
  eq(await ps.importFile("not json"), null);
  ok(rec.of("notice").some((n) => n.kind === "bad"));
});

t("exportCurrent saves first and returns the file name (no download in Node)", async () => {
  const { ps, storage } = setup();
  ps.create("Ravinia test");
  ps.write("site", { tool: "site", state: { s: 1 } });
  const name = await ps.exportCurrent();
  eq(name, "ravinia-test.cmrlm.json");
  eq(getSection(loadProject(storage, ps.id()), "site").state, { s: 1 });
});

t("without storage the store still works in memory", async () => {
  const bus = createBus();
  const rec = recorder(bus);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const ps = createProjectStore({ storage: broken, bus, win: null, timers: fakeTimers() });
  eq(ps.doc(), null);
  const d = ps.create("Mem");
  ok(d && ps.doc() === d, "open in memory");
  ps.write("massing", { tool: "tower", state: { a: 1 } });
  eq(getSection(ps.doc(), "massing").state, { a: 1 });
  ok(rec.of("notice").length >= 1, "a notice says saving is off");
  await sleep(0);
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
