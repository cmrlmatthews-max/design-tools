/* ==========================================================================
   accessible.js — accessible stalls and access aisles (Parking Deck Generator)

   Contract: docs/parking-deck-technical-plan.md sections 3.6 and 4.
   Pure: no DOM, no Clipper, no mutation of inputs.

   Caution: the table, the van rule, and the aisle widths seed an editable
   table (state.accessible). Verify every value against IBC 1106 and the
   adopted accessibility standard.

   Rule choices where the plan leaves room:
   - N0 is the number of stalls in built.levels after the cuts, all levels.
   - requiredAccessible: a table row with upTo null and a `base` gives
     base + per100Over1000 x ceil((N0 - T) / 100), T = the last finite upTo
     above it (1000 in the seed table). Percent rows give ceil(N0 x percent
     / 100). N0 of 0 or less needs 0 stalls.
   - The R-2 rule is on when accessible.r2.on is true, or when it is null and
     the source is "wrap" or "podium" (decision 13).
   - Aisle length (3.6.6): La = aisleVan x van + aisleCar x
     ceil((car - min(car, van)) / 2). Stalls lost = ceil(La / stallW).
   - Slot model (3.6.5, 3.6.8): the group is one run of stall slots. Each van
     stall is followed by its 8 ft aisle and (when a car stall is left) its
     paired car stall; the remaining car stalls pair on 5 ft aisles; an odd
     last car stall gets its own aisle. The aisle widths pool: a slot is
     lost at the first aisle that takes the running aisle length past a whole
     number of stall widths, so the slots lost are exactly ceil(La / stallW)
     and the stall count matches the plan. Slots are exact; where inside the
     run a given aisle sits is approximate.
   - Placement: the entry level is the level whose floor z is nearest 0
     (lowest index on a tie). Rows are ordered by the distance from the row
     centerline to the elevator center (first elevator core; first core when
     there is none). The group starts at the free standard stall nearest the
     elevator center in x and runs east, or west when east has no room. When
     the row has no room for the rest, the group continues in the next
     nearest row. A stall is free when its kind is "standard" (or unset).
   - placeAccessible returns EVERY stall of every level as new objects, with
     the lost slots removed and kinds set to "accessible" or "van". The
     input rings are copied. Other kinds (ev, compact) pass through.
   ========================================================================== */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const ceilEps = (v) => Math.ceil(v - 1e-9);

const SEED = { vanPer: 6, aisleCar: 5, aisleVan: 8 };

function need(cond, fn, what) {
  if (!cond) throw new Error(`${fn}: ${what} is missing or not valid`);
}

/* ------------------------------------------------------------- required */

function tableCount(n0, table) {
  let threshold = 1000;
  for (const row of table) {
    if (!row) continue;
    if (row.upTo === null || row.upTo === undefined) {
      if (isNum(row.base)) return row.base + (isNum(row.per100Over1000) ? row.per100Over1000 : 0) * Math.max(0, ceilEps((n0 - threshold) / 100));
      if (isNum(row.percent)) return ceilEps((n0 * row.percent) / 100);
      return isNum(row.count) ? row.count : 0;
    }
    threshold = row.upTo;
    if (n0 <= row.upTo) {
      if (isNum(row.percent)) return ceilEps((n0 * row.percent) / 100);
      return isNum(row.count) ? row.count : 0;
    }
  }
  const last = table[table.length - 1];
  if (last && isNum(last.percent)) return ceilEps((n0 * last.percent) / 100);
  return last && isNum(last.count) ? last.count : 0;
}

/** Plan 3.6 steps 2 to 4. source: "standalone" | "wrap" | "podium".
    → { table, r2, required, van, car }. `table` is the count the table gives,
    `r2` the count the R-2 rule gives (null when the rule is off). */
export function requiredAccessible(n0, accessible, source) {
  need(accessible && Array.isArray(accessible.table) && accessible.table.length > 0, "requiredAccessible", "accessible.table");
  need(isNum(n0), "requiredAccessible", "n0");
  const vanPer = isNum(accessible.vanPer) && accessible.vanPer > 0 ? accessible.vanPer : SEED.vanPer;
  if (n0 <= 0) return { table: 0, r2: null, required: 0, van: 0, car: 0 };

  const table = tableCount(n0, accessible.table);
  const r2cfg = accessible.r2 || {};
  const r2on = r2cfg.on === true || ((r2cfg.on === null || r2cfg.on === undefined) && source !== "standalone" && source !== undefined && source !== null);
  const r2 = r2on ? Math.max(1, ceilEps((n0 * (isNum(r2cfg.percent) ? r2cfg.percent : 2)) / 100)) : null;
  const required = Math.max(table, r2 === null ? 0 : r2);
  const van = required > 0 ? Math.max(1, ceilEps(required / vanPer)) : 0;
  return { table, r2, required, van, car: required - van };
}

/** Plan 3.6 step 6. `accessible` is optional (seed widths 8 and 5). → La in ft. */
export function aisleLength(van, car, accessible) {
  need(isNum(van) && van >= 0 && isNum(car) && car >= 0, "aisleLength", "van and car");
  const aV = accessible && isNum(accessible.aisleVan) ? accessible.aisleVan : SEED.aisleVan;
  const aC = accessible && isNum(accessible.aisleCar) ? accessible.aisleCar : SEED.aisleCar;
  return aV * van + aC * Math.ceil((car - Math.min(car, van)) / 2);
}

/** Plan 3.6 steps 5 to 7 as a slot run: an array of "van" | "accessible" | "lost".
    The run holds van + car stalls and ceil(La / stallW) lost slots. */
export function accessibleSlots(van, car, accessible, stallW) {
  need(isNum(stallW) && stallW > 0, "accessibleSlots", "stallW");
  const aV = accessible && isNum(accessible.aisleVan) ? accessible.aisleVan : SEED.aisleVan;
  const aC = accessible && isNum(accessible.aisleCar) ? accessible.aisleCar : SEED.aisleCar;
  const seq = [];
  let cum = 0, lost = 0, carsLeft = car;
  const aisle = (w) => {
    cum += w;
    const want = ceilEps(cum / stallW);
    while (lost < want) { seq.push("lost"); lost++; }
  };
  for (let i = 0; i < van; i++) {
    seq.push("van");
    aisle(aV);
    if (carsLeft > 0) { seq.push("accessible"); carsLeft--; }
  }
  while (carsLeft > 0) {
    seq.push("accessible"); carsLeft--;
    aisle(aC);
    if (carsLeft > 0) { seq.push("accessible"); carsLeft--; }
  }
  return seq;
}

/* ------------------------------------------------------------ placement */

const bbox = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1 };
};

function copyStall(s) {
  return { ...s, outer: s.outer.map((p) => [p[0], p[1]]) };
}

function rowIdOf(s) {
  const id = typeof s.id === "string" ? s.id.replace(/-\d+$/, "") : "";
  return id || `P${s.level}-${s.bay}${s.row}`;
}

function elevatorCenter(state, built) {
  const cores = Array.isArray(built.cores) && built.cores.length ? built.cores : Array.isArray(state.cores) ? state.cores : [];
  const c = cores.find((k) => k && k.kind === "elevator") || cores[0];
  if (!c || !isNum(c.x) || !isNum(c.y)) return null;
  return { cx: c.x + (isNum(c.w) ? c.w : 0) / 2, cy: c.y + (isNum(c.d) ? c.d : 0) / 2 };
}

/** Plan 3.6 steps 1 and 8. → { stalls, lost, rowId, warnings, rowIds, level,
    required, van, car, provided, aisleLength, n0, need }.
    `stalls` is every stall of every level (new objects), lost slots removed. */
export function placeAccessible(state, built) {
  need(state && state.accessible && state.bays && isNum(state.bays.stallW), "placeAccessible", "state.accessible and state.bays.stallW");
  need(built && Array.isArray(built.levels), "placeAccessible", "built.levels");

  const copies = built.levels.map((lv) => (lv.stalls || []).map(copyStall));
  const removed = new Set();
  const warnings = [];
  const n0 = copies.reduce((s, l) => s + l.length, 0);
  const req = requiredAccessible(n0, state.accessible, state.source);
  const La = aisleLength(req.van, req.car, state.accessible);
  const result = (rowIds, level, provided) => ({
    stalls: copies.flatMap((l) => l.filter((s) => !removed.has(s))),
    lost: removed.size, rowId: rowIds.length ? rowIds[0] : null, warnings, rowIds, level,
    required: req.required, van: req.van, car: req.car, provided, aisleLength: La, n0, need: req,
  });
  if (req.required === 0) return result([], null, 0);

  // entry level: floor z nearest 0, lowest index on a tie
  let pos = 0;
  built.levels.forEach((lv, i) => {
    const best = built.levels[pos];
    const dz = Math.abs(isNum(lv.z) ? lv.z : 0), db = Math.abs(isNum(best.z) ? best.z : 0);
    if (dz < db - 1e-9 || (Math.abs(dz - db) <= 1e-9 && lv.index < best.index)) pos = i;
  });
  const entry = built.levels[pos];
  const elev = elevatorCenter(state, built);

  const rowMap = new Map();
  for (const s of copies[pos]) {
    const key = `${s.bay}|${s.row}`;
    if (!rowMap.has(key)) rowMap.set(key, { key, id: rowIdOf(s), stalls: [], midY: 0 });
    rowMap.get(key).stalls.push(s);
  }
  const rows = [...rowMap.values()];
  for (const r of rows) {
    r.stalls.sort((a, b) => a.k - b.k);
    const b = bbox(r.stalls[0].outer);
    r.midY = (b.y0 + b.y1) / 2;
  }
  const dist = (r) => (elev ? Math.abs(r.midY - elev.cy) : r.midY);
  rows.sort((a, b) => {
    const d = Math.round(dist(a) * 1e6) - Math.round(dist(b) * 1e6);
    if (d) return d;
    if (Math.abs(a.midY - b.midY) > 1e-9) return a.midY - b.midY;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const seq = accessibleSlots(req.van, req.car, state.accessible, state.bays.stallW);
  const isFree = (s) => !removed.has(s) && (s.kind === undefined || s.kind === "standard");
  const rowIds = [];
  let at = 0, placedStalls = 0, lostSlots = 0;

  for (const row of rows) {
    if (at >= seq.length) break;
    const free = row.stalls.filter(isFree);
    if (!free.length) continue;
    const byK = new Map(free.map((s) => [s.k, s]));
    const cx = (s) => { const b = bbox(s.outer); return (b.x0 + b.x1) / 2; };
    let start = free[0];
    if (elev) {
      for (const s of free) if (Math.abs(cx(s) - elev.cx) < Math.abs(cx(start) - elev.cx) - 1e-9) start = s;
    }
    let east = 0, west = 0;
    while (byK.has(start.k + east)) east++;
    while (byK.has(start.k - west)) west++;
    const left = seq.length - at;
    const dir = east >= left ? 1 : west >= left ? -1 : west > east ? -1 : 1;
    const take = Math.min(dir === 1 ? east : west, left);
    for (let i = 0; i < take; i++) {
      const s = byK.get(start.k + dir * i);
      const item = seq[at++];
      if (item === "lost") { removed.add(s); lostSlots++; } else { s.kind = item; placedStalls++; }
    }
    rowIds.push(row.id);
  }

  if (placedStalls < req.required || lostSlots < seq.filter((x) => x === "lost").length) {
    warnings.push({
      code: "accessible-short", severity: "warn", floors: [entry.index],
      message: `The accessible group needs ${req.required} stalls and ${seq.filter((x) => x === "lost").length} aisle slots on level ${entry.index}; only ${placedStalls} stalls and ${lostSlots} slots fit in free stalls.`,
    });
  }
  if (rowIds.length > 1) {
    warnings.push({
      code: "accessible-split", severity: "info", floors: [entry.index],
      message: `The accessible group continues into more than one row (${rowIds.join(", ")}).`,
    });
  }
  return result(rowIds, entry.index, placedStalls);
}
