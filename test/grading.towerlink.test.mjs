// Run: node test/grading.towerlink.test.mjs
// The tower link (src/grading/towerlink.js, Cade, October 30, 2026): a typed tower base sets the first tier FFE of the
// massing building, the other tiers move by the same amount, and Follow ground turns the link off.
const TL = await import("../src/grading/towerlink.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + (e.stack || e.message).split("\n").slice(0, 3).join("\n       ")); }
}
const eq = (a, b, m = "") => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const same = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m = "assertion failed") => { if (!c) throw new Error(m); };
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }

const massing = (tiers, extra = {}) => ({ id: "M1", name: "Massing", source: "massing", axis: "auto", tiers, padOffset: 5, padDepth: 1, ...extra });
const typedBar = { id: "B1", name: "Bar", source: "typed", outer: [[0, 0], [10, 0], [10, 10]], tiers: [{ length: null, ffe: 990 }] };
const doc = (placement, tool = "tower") => ({ sections: { massing: { tool, placement } } });

console.log("towerBaseOf and drivingBase");
t("reads the typed tower base", () => {
  same(TL.towerBaseOf(doc({ x: 0, y: 0, baseZ: 1010, baseMode: "typed" })), { mode: "typed", baseZ: 1010 });
  eq(TL.drivingBase(doc({ baseZ: 1010, baseMode: "typed" })), 1010);
});
t("Follow ground does not drive the grade", () => {
  same(TL.towerBaseOf(doc({ baseZ: 1000, baseMode: "follow" })), { mode: "follow", baseZ: 1000 });
  eq(TL.drivingBase(doc({ baseZ: 1000 })), null, "no baseMode is follow");
});
t("no massing, a massing from another tool, or no base: null", () => {
  eq(TL.towerBaseOf(null), null);
  eq(TL.towerBaseOf({ sections: {} }), null);
  eq(TL.towerBaseOf(doc({ baseZ: 1010, baseMode: "typed" }, "midrise")), null);
  eq(TL.towerBaseOf(doc({ baseMode: "typed" })), null);
});

console.log("shiftTiers");
t("first tier to the base, the others move by the same amount (steps stay)", () => {
  const out = TL.shiftTiers(deepFreeze([{ length: 80, ffe: 1000 }, { length: null, ffe: 1004 }, { length: null, ffe: 1008.5 }]), 1010);
  same(out.map((x) => x.ffe), [1010, 1014, 1018.5]);
  eq(out[0].length, 80, "lengths stay");
});
t("a balanced tier after the first stays balanced", () => {
  same(TL.shiftTiers([{ length: null, ffe: 1000 }, { length: null, ffe: "balance" }], 995).map((x) => x.ffe), [995, "balance"]);
});
t("a balanced first tier takes the base; the others do not move", () => {
  same(TL.shiftTiers([{ length: null, ffe: "balance" }, { length: null, ffe: 1003 }], 1010).map((x) => x.ffe), [1010, 1003]);
});
t("no base: the tiers are unchanged", () => {
  same(TL.shiftTiers([{ length: null, ffe: 1000 }], null).map((x) => x.ffe), [1000]);
});
t("downhill (a lower base) also keeps the steps", () => {
  same(TL.shiftTiers([{ length: null, ffe: 1000 }, { length: null, ffe: 996 }], 990.25).map((x) => x.ffe), [990.25, 986.25]);
});

console.log("link on and off");
t("linkTower sets the flag on massing buildings only, fixes balanced tiers at their current FFE, then moves them", () => {
  const s = deepFreeze({ buildings: [massing([{ length: null, ffe: "balance" }, { length: null, ffe: "balance" }]), typedBar] });
  const ffeOf = (b, k) => (b.id === "M1" ? (k === 1 ? 1001.2 : 1005.2) : null);
  const out = TL.linkTower(s, 1010, ffeOf);
  eq(out.buildings[0].followTower, true);
  same(out.buildings[0].tiers.map((x) => x.ffe), [1010, 1014]);
  eq(out.buildings[1].followTower, undefined, "typed building not linked");
  same(out.buildings[1].tiers, typedBar.tiers, "typed building unchanged");
  ok(TL.anyLinked(out) && !TL.anyLinked(s), "input not changed");
});
t("applyTowerBase moves linked buildings and returns the same object when nothing moves", () => {
  const s = deepFreeze({ buildings: [massing([{ length: null, ffe: 1010 }, { length: null, ffe: 1014 }], { followTower: true })] });
  eq(TL.applyTowerBase(s, 1010), s, "already there");
  eq(TL.applyTowerBase(s, null), s, "no driving base");
  const moved = TL.applyTowerBase(s, 1000);
  same(moved.buildings[0].tiers.map((x) => x.ffe), [1000, 1004]);
  const unlinked = deepFreeze({ buildings: [massing([{ length: null, ffe: 1010 }])] });
  eq(TL.applyTowerBase(unlinked, 1000), unlinked, "no link: no move");
});
t("unlinkTower clears the flag and keeps the last values (not balance)", () => {
  const s = deepFreeze({ buildings: [massing([{ length: null, ffe: 1010 }, { length: null, ffe: 1014 }], { followTower: true }), typedBar] });
  const out = TL.unlinkTower(s);
  ok(!("followTower" in out.buildings[0]), "flag gone");
  same(out.buildings[0].tiers.map((x) => x.ffe), [1010, 1014]);
  const out2 = TL.unlinkTower(deepFreeze({ buildings: [massing([{ length: null, ffe: 1000 }, { length: null, ffe: 1004 }], { followTower: true })] }), 1012);
  same(out2.buildings[0].tiers.map((x) => x.ffe), [1012, 1016], "last tower base applied first");
});

console.log("linkAction (when the massing changes)");
const S0 = { buildings: [massing([{ length: null, ffe: "balance" }])] };
const S1 = { buildings: [massing([{ length: null, ffe: 1010 }], { followTower: true })] };
const F = (z) => ({ mode: "follow", baseZ: z }), T = (z) => ({ mode: "typed", baseZ: z });
t("switching to Typed links", () => eq(TL.linkAction(S0, F(1000), T(1000)), "link"));
t("typing a new base links", () => eq(TL.linkAction(S0, T(1000), T(1010)), "link"));
t("an old project in Typed mode with no base change stays as it was", () => eq(TL.linkAction(S0, T(1000), T(1000)), null));
t("Follow ground with no link: nothing (today's direction)", () => eq(TL.linkAction(S0, F(1000), F(1002)), null));
t("linked and still Typed: sync (an undo in the Tower brings the grade back)", () => eq(TL.linkAction(S1, T(1010), T(1000)), "sync"));
t("back to Follow ground unlinks", () => eq(TL.linkAction(S1, T(1010), F(1010)), "unlink"));
t("the massing gone or taken by another tool unlinks", () => eq(TL.linkAction(S1, T(1010), null), "unlink"));
t("no massing building: nothing", () => eq(TL.linkAction({ buildings: [typedBar] }, F(1000), T(1010)), null));
t("a stale flag on a typed building is not a link", () => ok(!TL.isLinked({ ...typedBar, followTower: true })));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
