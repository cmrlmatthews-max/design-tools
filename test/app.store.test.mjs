// Node tests for app/core/store.js and app/core/bus.js. Run: node test/app.store.test.mjs
import { createStore } from "../app/core/store.js";
import { createBus, bus } from "../app/core/bus.js";

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const eq = (a, b, m = "") => { if (canon(a) !== canon(b)) throw new Error(`${m} expected ${canon(b)} got ${canon(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || "expected true"); };

const initial = () => ({ name: "A", segments: [{ floors: 10, shape: "rect" }], view: { style: "model" } });

/* ---------- store ---------- */

t("get reads dot paths and array indexes", () => {
  const s = createStore({ initial: initial() });
  eq(s.get("segments.0.floors"), 10);
  eq(s.get(["view", "style"]), "model");
  eq(s.get("missing.deep.path"), undefined);
  eq(s.get(""), s.raw());
});

t("the initial state is copied, not shared", () => {
  const init = initial();
  const s = createStore({ initial: init });
  s.set("name", "B");
  eq(init.name, "A");
});

t("set makes one undo step; undo and redo walk it", () => {
  const s = createStore({ initial: initial() });
  ok(!s.canUndo() && !s.canRedo());
  ok(s.set("segments.0.floors", 12));
  ok(s.set("name", "B"));
  ok(s.canUndo());
  ok(s.undo());
  eq(s.get("name"), "A");
  eq(s.get("segments.0.floors"), 12);
  ok(s.canRedo());
  ok(s.undo());
  eq(s.get("segments.0.floors"), 10);
  ok(!s.undo(), "nothing left to undo");
  ok(s.redo());
  ok(s.redo());
  eq(s.get("name"), "B");
  ok(!s.redo());
});

t("a set of the same value does nothing", () => {
  const s = createStore({ initial: initial() });
  ok(!s.set("segments.0.floors", 10));
  ok(!s.canUndo());
});

t("set creates missing objects and arrays on the path", () => {
  const s = createStore({ initial: {} });
  s.set("a.b.0.c", 5);
  ok(Array.isArray(s.get("a.b")));
  eq(s.get("a.b.0.c"), 5);
});

t("a new set clears the redo list", () => {
  const s = createStore({ initial: initial() });
  s.set("name", "B");
  s.undo();
  ok(s.canRedo());
  s.set("name", "C");
  ok(!s.canRedo());
});

t("a live gesture becomes one undo step on commit", () => {
  const s = createStore({ initial: initial() });
  for (let f = 11; f <= 20; f++) s.set("segments.0.floors", f, { live: true });
  ok(s.gestureActive());
  ok(s.canUndo(), "an open gesture with a change can undo");
  eq(s.historyDepth(), 0);
  ok(s.commit());
  ok(!s.gestureActive());
  eq(s.historyDepth(), 1);
  s.undo();
  eq(s.get("segments.0.floors"), 10);
  s.redo();
  eq(s.get("segments.0.floors"), 20);
});

t("a non-live set closes an open gesture first (two steps)", () => {
  const s = createStore({ initial: initial() });
  s.set("segments.0.floors", 11, { live: true });
  s.set("segments.0.floors", 15, { live: true });
  s.set("name", "B");
  ok(!s.gestureActive());
  eq(s.historyDepth(), 2);
  s.undo();
  eq(s.get("name"), "A");
  eq(s.get("segments.0.floors"), 15);
  s.undo();
  eq(s.get("segments.0.floors"), 10);
});

t("undo during a gesture closes it and undoes it", () => {
  const s = createStore({ initial: initial() });
  s.set("segments.0.floors", 30, { live: true });
  ok(s.undo());
  eq(s.get("segments.0.floors"), 10);
});

t("a gesture that ends where it began adds no step", () => {
  const s = createStore({ initial: initial() });
  s.set("segments.0.floors", 11, { live: true });
  s.set("segments.0.floors", 10, { live: true });
  s.commit();
  eq(s.historyDepth(), 0);
  ok(!s.commit(), "nothing to commit");
});

t("merge joins the step before it", () => {
  const s = createStore({ initial: initial() });
  s.set("name", "B");
  s.set("view.style", "diagram", { merge: true });
  eq(s.historyDepth(), 1);
  s.undo();
  eq(s.get("name"), "A");
  eq(s.get("view.style"), "model");
});

t("update changes a draft as one step; live update coalesces", () => {
  const s = createStore({ initial: initial() });
  const before = s.raw();
  ok(s.update((d) => { d.name = "U"; d.segments.push({ floors: 3 }); }));
  eq(before.name, "A", "the old state object is not changed");
  eq(s.get("segments.1.floors"), 3);
  eq(s.historyDepth(), 1);
  ok(!s.update(() => {}), "no change, no step");
  s.update((d) => { d.segments[0].floors = 40; }, { live: true });
  s.update((d) => { d.segments[0].floors = 41; }, { live: true });
  s.commit();
  eq(s.historyDepth(), 2);
  s.undo();
  eq(s.get("segments.0.floors"), 10);
  ok(s.update(() => ({ fresh: true })), "a returned object replaces the state");
  eq(s.raw(), { fresh: true });
});

t("replace is undoable unless undoable: false", () => {
  const s = createStore({ initial: initial() });
  s.replace({ name: "R" });
  eq(s.get("name"), "R");
  s.undo();
  eq(s.get("name"), "A");
  s.set("name", "B");
  s.replace({ name: "Z" }, { undoable: false });
  ok(!s.canUndo() && !s.canRedo());
  eq(s.get("name"), "Z");
  s.set("", { whole: 1 });
  eq(s.raw(), { whole: 1 }, "an empty path replaces");
});

t("history keeps the newest `limit` steps", () => {
  const s = createStore({ initial: { n: 0 } });
  for (let i = 1; i <= 60; i++) s.set("n", i);
  eq(s.historyDepth(), 50);
  let undone = 0;
  while (s.undo()) undone++;
  eq(undone, 50);
  eq(s.get("n"), 10);
  const small = createStore({ initial: { n: 0 }, limit: 3 });
  for (let i = 1; i <= 5; i++) small.set("n", i);
  eq(small.historyDepth(), 3);
});

t("subscribe gets (state, info); off stops it; a throwing listener does not stop others", () => {
  const s = createStore({ initial: initial() });
  const seen = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    s.subscribe(() => { throw new Error("boom"); });
    const off = s.subscribe((state, info) => seen.push([state.name, info.kind, info.path, info.live]));
    s.set("name", "B", { live: true });
    s.commit();
    s.undo();
    off();
    s.redo();
  } finally { console.error = quiet; }
  eq(seen, [["B", "set", "name", true], ["B", "commit", "name", false], ["A", "undo", "", false]]);
});

t("snapshot is a deep copy", () => {
  const s = createStore({ initial: initial() });
  const snap = s.snapshot();
  snap.segments[0].floors = 99;
  eq(s.get("segments.0.floors"), 10);
});

t("a set object value is copied", () => {
  const s = createStore({ initial: {} });
  const v = { a: [1, 2] };
  s.set("x", v);
  v.a.push(3);
  eq(s.get("x.a"), [1, 2]);
});

/* ---------- bus ---------- */

t("bus on, emit, off, once", () => {
  const b = createBus();
  const got = [];
  const off = b.on("x", (p) => got.push(["a", p]));
  b.once("x", (p) => got.push(["once", p]));
  b.emit("x", 1);
  b.emit("x", 2);
  off();
  b.emit("x", 3);
  eq(got, [["a", 1], ["once", 1], ["a", 2]]);
  b.emit("none", 1);            // no handler: nothing happens
});

t("bus keeps going after a handler throws; off inside a handler is safe", () => {
  const b = createBus();
  const got = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    const self = () => { got.push("self"); b.off("y", self); };
    b.on("y", () => { throw new Error("boom"); });
    b.on("y", self);
    b.on("y", () => got.push("last"));
    b.emit("y");
    b.emit("y");
  } finally { console.error = quiet; }
  eq(got, ["self", "last", "last"]);
});

t("the shared bus exists", () => {
  ok(typeof bus.on === "function" && typeof bus.emit === "function" && typeof bus.once === "function" && typeof bus.off === "function");
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
