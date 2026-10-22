/* ==========================================================================
   mix.js — the unit mix model of the Plate Planner (plan sections 3.6, 3.10, 4)

   Contract: docs/plate-planner-technical-plan.md sections 2, 3.6, 3.10 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs. Feet and square feet.

   Caution: the accessible counts are seeds for an editable table. Verify every
   count against the adopted code before use. The tool never writes "compliant".

   Rule choices where the plan leaves room:
   - effectiveTypes keeps full precision. Display layers round. A type whose
     range is empty by less than 1e-9 ft is kept with lo = hi.
   - effectiveTypes renormalizes the shares of the kept types to 1. When every
     kept share is 0 the kept types share equally.
   - weightedWidth: W is the width per unit (key), Wbay the width per bay.
     Multifamily types have 1 bay, so W = Wbay. Hotel: W = Σ share × w ÷ Σ share,
     Wbay = Σ share × w ÷ Σ share × bays (example 8.2: 14.895 and 14.150).
   - countsFor(lengthFt, types, corners): N = floor(lengthFt ÷ W) + corner units.
     Hotel callers pass the run length less the accessible key widths
     (plan 3.6 item 4). `corners` is one of: nothing; a number (corner units
     of unknown type, they only raise N); an array of type ids, one per corner
     unit; { type, count }; or a map { [typeId]: count }. Corner units count
     toward their type: when the largest-remainder count of that type is
     below the corner count, the type is raised and the largest surpluses of
     the other types give the units back, so N does not change.
   - Largest remainder: quota = share × N; the leftover units go to the
     largest remainders, ties by type order (the earlier type first).
   - scoreMix: target = the count given for the type, count = placed units,
     diff = count − target, share = placed share. `misses` lists the types
     of `types` with |diff| > 1 (plan 3.12, mix-miss). A placed type that is not in `types`
     gets a trailing row and is never a miss.
   - requiredAccessible: the hotel table row is the first row whose max keys
     is at least the building count. Above the last row the last row is used
     and the result carries beyond: true (the table ends; extend it in the panel).
   ========================================================================== */

const EPS = 1e-9;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* ---------------------------------------------------------------- defaults */

export const MULTIFAMILY_TYPES = [
  { id: "studio", name: "Studio",    widthMin: 20, widthMax: 24, targetArea: 525,  areaMin: 450,  areaMax: 600,  share: 0.10, color: "#9cc3e6" },
  { id: "1br",    name: "1BR",       widthMin: 24, widthMax: 28, targetArea: 725,  areaMin: 650,  areaMax: 800,  share: 0.45, color: "#4f7fd1" },
  { id: "1brden", name: "1BR + den", widthMin: 28, widthMax: 32, targetArea: 900,  areaMin: 850,  areaMax: 950,  share: 0.10, color: "#6b5fc7" },
  { id: "2br",    name: "2BR",       widthMin: 32, widthMax: 40, targetArea: 1100, areaMin: 1000, areaMax: 1200, share: 0.30, color: "#2f9e9a" },
  { id: "3br",    name: "3BR",       widthMin: 40, widthMax: 48, targetArea: 1400, areaMin: 1300, areaMax: 1500, share: 0.05, color: "#d9a22b" },
];

export const HOTEL_TYPES = [
  { id: "king",  name: "King",         widthMin: 13.5, widthMax: 14.5, target: 14,   bays: 1, share: 0.60, color: "#8a63c9" },
  { id: "dq",    name: "Double queen", widthMin: 14,   widthMax: 15,   target: 14.5, bays: 1, share: 0.30, color: "#b48ad9" },
  { id: "suite", name: "Suite",        widthMin: 27,   widthMax: 29,   target: 28,   bays: 2, share: 0.05, color: "#5b3f99" },
];

/** Seeds of the editable accessible table (plan section 2). Hotel rows: [max keys, accessible, roll-in]. */
export const ACCESSIBLE_DEFAULTS = {
  multifamily: { typeAShare: 0.02, minUnits: 1, over: 20 },
  hotel: [[25, 1, 0], [50, 2, 0], [75, 4, 1], [100, 5, 1], [150, 7, 2], [200, 8, 2], [300, 10, 3], [400, 12, 4]],
};

/* ---------------------------------------------------------- effectiveTypes */

/**
 * Plan 3.6 items 1 and 2: the usable width range of every type at an area depth.
 * Multifamily: lo = max(widthMin, areaMin ÷ d), hi = min(widthMax, areaMax ÷ d), w = clamp(targetArea ÷ d, lo, hi).
 * Hotel: lo = widthMin, hi = widthMax, w = target (clamped); the depth is not used.
 * → { types: [{ id, name, color, w, lo, hi, bays, share }], dropped: [{ id, name, lo, hi }] }
 *   `share` is renormalized over the kept types. A type with lo > hi drops out.
 */
export function effectiveTypes(types, depth, mode = "multifamily") {
  need(Array.isArray(types), "effectiveTypes", "types");
  const hotel = mode === "hotel";
  if (!hotel) need(isNum(depth) && depth > 0, "effectiveTypes", "depth");
  const kept = [], dropped = [];
  for (const t of types) {
    need(t && t.id !== undefined, "effectiveTypes", "a type id");
    need(isNum(t.widthMin) && isNum(t.widthMax) && t.widthMin > 0, "effectiveTypes", `the widths of type "${t.id}"`);
    let lo, hi, target;
    if (hotel) {
      lo = t.widthMin; hi = t.widthMax;
      target = isNum(t.target) ? t.target : (lo + hi) / 2;
    } else {
      lo = isNum(t.areaMin) ? Math.max(t.widthMin, t.areaMin / depth) : t.widthMin;
      hi = isNum(t.areaMax) ? Math.min(t.widthMax, t.areaMax / depth) : t.widthMax;
      target = isNum(t.targetArea) ? t.targetArea / depth : (lo + hi) / 2;
    }
    const base = { id: t.id, ...(t.name !== undefined ? { name: t.name } : {}) };
    if (lo > hi + EPS) { dropped.push({ ...base, lo, hi }); continue; }
    if (lo > hi) lo = hi;
    kept.push({
      ...base, ...(t.color !== undefined ? { color: t.color } : {}),
      w: clamp(target, lo, hi), lo, hi,
      bays: isNum(t.bays) && t.bays >= 1 ? Math.round(t.bays) : 1,
      share: isNum(t.share) && t.share > 0 ? t.share : 0,
    });
  }
  const sum = kept.reduce((s, t) => s + t.share, 0);
  for (const t of kept) t.share = sum > EPS ? t.share / sum : 1 / kept.length;
  return { types: kept, dropped };
}

/* ----------------------------------------------------------- weightedWidth */

/**
 * Plan 3.6 item 3. `types` are effective types. → { W, Wbay }
 * W = Σ share × w ÷ Σ share (width per unit); Wbay = Σ share × w ÷ Σ share × bays (width per bay).
 */
export function weightedWidth(types) {
  need(Array.isArray(types) && types.length > 0, "weightedWidth", "types");
  const sum = types.reduce((s, t) => s + (t.share > 0 ? t.share : 0), 0);
  const wt = (t) => (sum > EPS ? Math.max(0, t.share) / sum : 1 / types.length);
  const W = types.reduce((s, t) => s + wt(t) * t.w, 0);
  const bays = types.reduce((s, t) => s + wt(t) * (t.bays || 1), 0);
  return { W, Wbay: W / bays };
}

/* ---------------------------------------------------------------- countsFor */

function cornerSpec(corners, ids) {
  const out = { total: 0, byType: {} };
  const add = (id, n) => { out.total += n; if (id !== undefined && id !== null && ids.includes(id)) out.byType[id] = (out.byType[id] || 0) + n; };
  if (corners === undefined || corners === null) return out;
  if (isNum(corners)) { out.total = Math.max(0, Math.round(corners)); return out; }
  if (Array.isArray(corners)) {
    for (const c of corners) add(c && typeof c === "object" ? c.type : c, 1);
    return out;
  }
  if (typeof corners === "object") {
    if (isNum(corners.count)) { add(corners.type !== undefined ? corners.type : corners.id, Math.max(0, Math.round(corners.count))); return out; }
    for (const id of Object.keys(corners)) if (isNum(corners[id])) add(id, Math.max(0, Math.round(corners[id])));
    return out;
  }
  need(false, "countsFor", "corners");
  return out;
}

/**
 * Plan 3.6 items 4 and 5. → { N, counts: { [id]: n }, W }
 * lengthFt is the total run length (hotel: less the accessible key widths); `types` are effective types.
 */
export function countsFor(lengthFt, types, corners) {
  need(isNum(lengthFt) && lengthFt >= 0, "countsFor", "lengthFt");
  need(Array.isArray(types) && types.length > 0, "countsFor", "types");
  const { W } = weightedWidth(types);
  need(W > 0, "countsFor", "a positive weighted width");
  const ids = types.map((t) => t.id);
  const cs = cornerSpec(corners, ids);
  const N = Math.floor(lengthFt / W + EPS) + cs.total;

  const sum = types.reduce((s, t) => s + Math.max(0, t.share), 0);
  const quota = types.map((t) => (sum > EPS ? Math.max(0, t.share) / sum : 1 / types.length) * N);
  const base = quota.map((q) => Math.floor(q + EPS));
  let left = N - base.reduce((s, v) => s + v, 0);
  const order = quota.map((q, i) => ({ i, rem: q - base[i] }))
    .sort((a, b) => (Math.abs(a.rem - b.rem) > EPS ? b.rem - a.rem : a.i - b.i));
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) base[order[k].i]++;

  // corner units count toward their type: raise it, take the units back from the largest surpluses
  for (const id of Object.keys(cs.byType)) {
    const i = ids.indexOf(id);
    let need_ = cs.byType[id] - base[i];
    while (need_ > 0) {
      let best = -1, surplus = -Infinity;
      for (let j = 0; j < base.length; j++) {
        if (j === i || base[j] <= (cs.byType[ids[j]] || 0)) continue;
        const s = base[j] - quota[j];
        if (s >= surplus - EPS) { best = j; surplus = s; }   // ties: the later type gives
      }
      if (best < 0) break;
      base[best]--; base[i]++; need_--;
    }
  }
  const counts = {};
  ids.forEach((id, i) => { counts[id] = base[i]; });
  return { N, counts, W };
}

/* ---------------------------------------------------------------- scoreMix */

/**
 * Placed units against the target counts. units: [{ type }]; counts: { [id]: target }; types: the mix types (order and names).
 * → { byType: [{ type, count, target, share, targetShare, diff }], misses: [type] }
 */
export function scoreMix(units, counts, types) {
  need(Array.isArray(units), "scoreMix", "units");
  need(Array.isArray(types), "scoreMix", "types");
  const tg = counts || {};
  const placed = {};
  for (const u of units) placed[u.type] = (placed[u.type] || 0) + 1;
  const total = units.length;
  const targetTotal = types.reduce((s, t) => s + (isNum(tg[t.id]) ? tg[t.id] : 0), 0);
  const row = (id, inList) => {
    const count = placed[id] || 0, target = inList && isNum(tg[id]) ? tg[id] : 0;
    return { type: id, count, target, share: total ? count / total : 0, targetShare: targetTotal ? target / targetTotal : 0, diff: count - target };
  };
  const byType = types.map((t) => row(t.id, true));
  const known = new Set(types.map((t) => t.id));
  for (const id of Object.keys(placed)) if (!known.has(id)) byType.push(row(id, false));
  const misses = byType.filter((r, i) => i < types.length && Math.abs(r.diff) > 1).map((r) => r.type);
  return { byType, misses };
}

/* ------------------------------------------------------ requiredAccessible */

/**
 * Plan 3.10. Multifamily → { typeA, row }. Hotel → { keys, rollIn, row, beyond }.
 * Caution: seeds for an editable table; verify against the adopted code.
 */
export function requiredAccessible(state, buildingCount) {
  need(state && typeof state === "object", "requiredAccessible", "state");
  need(isNum(buildingCount) && buildingCount >= 0, "requiredAccessible", "buildingCount");
  const count = Math.round(buildingCount);
  const acc = state.accessible || {};
  if (state.mode === "hotel") {
    const table = Array.isArray(acc.hotel) && acc.hotel.length ? acc.hotel : ACCESSIBLE_DEFAULTS.hotel;
    if (count === 0) return { keys: 0, rollIn: 0, row: null, beyond: false };
    const rows = table.slice().sort((a, b) => a[0] - b[0]);
    let hit = rows.find((r) => count <= r[0]);
    const beyond = !hit;
    if (!hit) hit = rows[rows.length - 1];
    return { keys: hit[1], rollIn: hit[2], row: hit.slice(), beyond };
  }
  const row = { ...ACCESSIBLE_DEFAULTS.multifamily, ...(acc.multifamily || {}) };
  const typeA = count > row.over ? Math.max(row.minUnits, Math.ceil(row.typeAShare * count - EPS)) : 0;
  return { typeA, row };
}
