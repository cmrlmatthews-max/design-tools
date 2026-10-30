/* ==========================================================================
   GRADING: tower link (Cade, October 30, 2026)
   When the Tower Generator base elevation is Typed, the tower sets the floor of the grading building whose
   footprint comes from the massing: the first tier FFE = the tower base (placement.baseZ, project elevation, ft),
   and every other tier of that building moves by the same amount, so the steps between tiers stay.
   In Follow ground mode the old direction holds (grading FFE -> tower base) and nothing here applies.

   The link is explicit in the grading state, so it is saved in the project file:
     building.followTower === true   (only on a building with source 'massing')
   The Grading tool sets it when the tower switches to Typed or its typed base changes, and clears it when the
   tower goes back to Follow ground (the tiers keep their last values).

   Pure: no DOM, no project store. Plain objects in, new objects out (inputs are not changed).
   ========================================================================== */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

/** The tower base from a project document: { mode: 'typed' | 'follow', baseZ } or null (no massing, or a massing from another tool). */
export function towerBaseOf(doc) {
  const s = doc && isObj(doc.sections) && isObj(doc.sections.massing) ? doc.sections.massing : null;
  if (!s || s.tool !== 'tower' || !isObj(s.placement) || !fin(s.placement.baseZ)) return null;
  return { mode: s.placement.baseMode === 'typed' ? 'typed' : 'follow', baseZ: s.placement.baseZ };
}

/** The base elevation that drives the grade, or null: only a tower in Typed mode drives it. */
export function drivingBase(doc) {
  const t = towerBaseOf(doc);
  return t && t.mode === 'typed' ? t.baseZ : null;
}

/** True when this grading building follows the tower base. */
export const isLinked = (b) => isObj(b) && b.source === 'massing' && b.followTower === true;
export const anyLinked = (state) => !!(isObj(state) && Array.isArray(state.buildings) && state.buildings.some(isLinked));
export const hasMassing = (state) => !!(isObj(state) && Array.isArray(state.buildings) && state.buildings.some((b) => isObj(b) && b.source === 'massing'));

/**
 * The tiers moved so the first FFE equals base. A typed (number) first tier gives the shift; every other typed tier moves
 * by it. A balanced first tier becomes the base, and the other tiers stay as they are (there is no step to keep).
 */
export function shiftTiers(tiers, base) {
  const list = Array.isArray(tiers) && tiers.length ? tiers : [{ length: null, ffe: 'balance' }];
  if (!fin(base)) return list.map((t) => ({ ...t }));
  const first = list[0] && fin(list[0].ffe) ? list[0].ffe : null;
  const delta = first == null ? 0 : base - first;
  return list.map((t, k) => {
    if (k === 0) return { ...t, ffe: r3(base) };
    return fin(t.ffe) ? { ...t, ffe: r3(t.ffe + delta) } : { ...t };
  });
}

/** The state with every linked building on the base. Returns the same object when nothing moves (base null, no link, or already there). */
export function applyTowerBase(state, base) {
  if (!fin(base) || !anyLinked(state)) return state;
  let changed = false;
  const buildings = state.buildings.map((b) => {
    if (!isLinked(b)) return b;
    const tiers = shiftTiers(b.tiers, base);
    if (JSON.stringify(tiers) === JSON.stringify(b.tiers)) return b;
    changed = true;
    return { ...b, tiers };
  });
  return changed ? { ...state, buildings } : state;
}

/**
 * Turns the link on for every massing building and puts it on the base. Balanced tiers are first fixed at the FFE they
 * have now (ffeOf(building, tierNumber) -> number | null, from the current build), so the steps between tiers stay.
 * Returns a new state (a deep copy).
 */
export function linkTower(state, base, ffeOf = () => null) {
  const next = clone(state);
  if (!isObj(next) || !Array.isArray(next.buildings)) return next;
  next.buildings = next.buildings.map((b) => {
    if (!isObj(b) || b.source !== 'massing') return b;
    const tiers = (Array.isArray(b.tiers) && b.tiers.length ? b.tiers : [{ length: null, ffe: 'balance' }]).map((t, k) => {
      if (fin(t.ffe)) return { ...t };
      const v = ffeOf(b, k + 1);
      return fin(v) ? { ...t, ffe: r3(v) } : { ...t };
    });
    return { ...b, followTower: true, tiers: shiftTiers(tiers, base) };
  });
  return next;
}

/** Turns the link off. The tiers keep their values (lastBase, when given, is applied first so they hold the last tower base). */
export function unlinkTower(state, lastBase = null) {
  const next = clone(applyTowerBase(state, lastBase));
  if (!isObj(next) || !Array.isArray(next.buildings)) return next;
  next.buildings = next.buildings.map((b) => {
    if (!isObj(b) || !('followTower' in b)) return b;
    const { followTower, ...rest } = b;
    return rest;
  });
  return next;
}

/**
 * What the Grading tool does after the massing changed. prev and cur are towerBaseOf() results (prev = the last one seen).
 * Returns 'link' (turn on and move), 'sync' (already on: move to the base), 'unlink', or null (nothing).
 * The link turns on only when the tower goes to Typed or its typed base changes; an old project opens as it was.
 */
export function linkAction(state, prev, cur) {
  if (!hasMassing(state)) return null;
  const linked = anyLinked(state);
  if (!cur || cur.mode !== 'typed') return linked ? 'unlink' : null;
  if (linked) return 'sync';
  const changed = !prev || prev.mode !== 'typed' || Math.abs(prev.baseZ - cur.baseZ) > 1e-9;
  return changed ? 'link' : null;
}
