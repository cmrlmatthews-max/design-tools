/* ==========================================================================
   plate/suggest.js — ghost units for one open stretch or one corner zone (docs/plate-planner-draw-plan.md section 2.3)

   suggestRun(layout, state, freeStretch, { counters } = {}) → { units: [{ type, outer, area, width, match, mode, runKey, runId, a, b }], note }
   suggestCorner(layout, state, cornerZone)                 → { type, outer, area, match, mode: "corner", legs, e, zoneId }
   placedCounts(units)                                      → { [type]: n } (accessible keys are not counted)

   layout       a layoutLevel result (fill.js)
   freeStretch  an entry of layout.free ({ runId, a, b, length, depth }; a and b in ft from the run start), or its id
   cornerZone   an entry of layout.cornerZones, or its id
   counters     the deficit counters to start from; default placedCounts(layout.units). A group has one layout, so the
                units of the layout are the units of the whole group.

   Rule choices where the plan leaves room:
   - The targets are layout.counts (the level targets of plan 3.6: every run and every corner zone). The stretch is
     one run of fillRuns (exact feasibility, deficit order, widths in proportion to their room): the same code as the
     automatic fill, so a blank run gives the units of the reference fill.
   - Hotel accessible keys are not suggested; the architect draws them (type "accessible").
   - A ghost has the type of the fill. Its match is the draw plan 3.3 match for that type ("large" on a deep run).
   - A stretch that no set of units fills exactly takes the units of the longest shorter length that a set fills (0.25 ft
     steps, up to 40 ft shorter), from its start; the note names the open rest. A stretch that fits no set at all gives
     units: [] and the too-short note. Otherwise the note is null.
   Pure and deterministic: no DOM, no hidden state, inputs are never mutated.
   ========================================================================== */

import { GEO } from "./corridor.js";
import { fillRuns, fmtFtIn } from "./fill.js";
import { matchFor } from "./draw.js";
import { MULTIFAMILY_TYPES, HOTEL_TYPES } from "./mix.js";

const { asMP, bool, ringArea, frameRect, rr3, r3 } = GEO;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const need = (v, fn, name) => { if (v === undefined || v === null) throw new Error(`${fn}: missing input "${name}".`); return v; };
const r1 = (v) => { const r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; };
const largest = (mp) => asMP(mp).slice().sort((a, b) => Math.abs(ringArea(b.outer)) - Math.abs(ringArea(a.outer)))[0] || null;
const modeOf = (state) => (state && state.mode === "hotel" ? "hotel" : "multifamily");
const typesOf = (state) => {
  const m = modeOf(state);
  return state && state.mix && Array.isArray(state.mix[m]) && state.mix[m].length ? state.mix[m] : m === "hotel" ? HOTEL_TYPES : MULTIFAMILY_TYPES;
};

/** Units by type: { [type]: n }. Accessible keys (type "accessible") are left out. */
export function placedCounts(units) {
  const out = {};
  for (const u of Array.isArray(units) ? units : []) if (u && u.type !== undefined && u.type !== "accessible") out[u.type] = (out[u.type] || 0) + 1;
  return out;
}

/** Ghost units for one open stretch (draw plan 2.3). */
export function suggestRun(layout, state, freeStretch, { counters = null } = {}) {
  need(layout, "suggestRun", "layout"); need(state, "suggestRun", "state"); need(freeStretch, "suggestRun", "freeStretch");
  const fs = typeof freeStretch === "string" ? (layout.free || []).find((f) => f.id === freeStretch) : freeStretch;
  if (!fs) throw new Error(`suggestRun: missing input "freeStretch" (no open stretch ${freeStretch} on this layout).`);
  const run = (layout.runs || []).find((r) => r.id === fs.runId);
  if (!run) throw new Error(`suggestRun: missing input "freeStretch.runId" (no run ${fs.runId} on this layout).`);
  const a = isNum(fs.a) ? fs.a : 0, b = isNum(fs.b) ? fs.b : a + (isNum(fs.length) ? fs.length : 0);
  const length = b - a;
  const depth = isNum(fs.depth) ? fs.depth : run.depth;
  const mode = modeOf(state), types = typesOf(state);
  const placed = counters && typeof counters === "object" ? { ...counters } : placedCounts(layout.units);
  const counts = layout.counts && typeof layout.counts === "object" ? layout.counts : {};
  const tooShort = { units: [], note: `This stretch (${fmtFtIn(length)}) is too short for any type. Extend a neighbor or leave it open.` };
  if (!(length > 0)) return tooShort;
  const cache = new Map();
  let [res] = fillRuns([{ id: "S", length, depth }], types, counts, { mode, placed, cache });
  // leftover fix: no set of units fills the stretch exactly (a hotel stretch of 66 ft: 4 keys reach 60, 5 keys need
  // 67.5). The longest shorter length that a set fills takes the units, from the stretch start; the rest stays open.
  let used = length;
  if (!res || res.short || !res.units.length) {
    res = null;
    for (let cut = 0.25; cut <= Math.min(length - 1, 40) + 1e-9; cut += 0.25) {
      const [r] = fillRuns([{ id: "S", length: length - cut, depth }], types, counts, { mode, placed, cache });
      if (r && !r.short && r.units.length) { res = r; used = length - cut; break; }
    }
    // the feasible lengths are intervals: find the top of this one between used and used + 0.25 (to 0.001 ft)
    if (res) {
      let lo = used, hi = Math.min(length, used + 0.25);
      for (let i = 0; i < 9 && hi - lo > 0.001; i++) {
        const m = (lo + hi) / 2;
        const [r] = fillRuns([{ id: "S", length: m, depth }], types, counts, { mode, placed, cache });
        if (r && !r.short && r.units.length) { lo = m; res = r; } else hi = m;
      }
      used = lo;
    }
  }
  if (!res) return tooShort;
  const fr = { o: run.start, u: run.u, n: run.n };
  const band = asMP(run.band);
  const runKey = `${run.ring}:${run.edge}:${r1(run.from)}`;
  const byId = new Map(types.map((t) => [t.id, t]));
  const units = [];
  for (const u of res.units) {
    const s0 = a + u.from, s1 = a + u.to;
    const pc = largest(bool("int", band, [{ outer: frameRect(fr, s0, s1, -1, 1e4), holes: [] }]));
    if (!pc) continue;
    const outer = rr3(pc.outer);
    const area = r1(Math.abs(ringArea(outer)));
    const width = r3(u.width);
    const match = matchFor(area, byId.get(u.type) || null, depth, { width, mode });
    units.push({ type: u.type, outer, area, width, match, mode: "run", runKey, runId: run.id, a: r3(s0), b: r3(s1) });
  }
  const note = used < length - 1e-6 ? `The units take ${fmtFtIn(used)} of this ${fmtFtIn(length)} stretch. ${fmtFtIn(length - used)} stays open: widen a unit or leave it.` : null;
  return { units, note };
}

/** The wrap unit of one corner zone (draw plan 2.3): the corner type on the zone (legs from the plan 3.5 formula). */
export function suggestCorner(layout, state, cornerZone) {
  need(layout, "suggestCorner", "layout"); need(state, "suggestCorner", "state"); need(cornerZone, "suggestCorner", "cornerZone");
  const z = typeof cornerZone === "string" ? (layout.cornerZones || []).find((c) => c.id === cornerZone) : cornerZone;
  if (!z || !Array.isArray(z.outer)) throw new Error(`suggestCorner: missing input "cornerZone" (no corner zone ${cornerZone} on this layout).`);
  const type = z.type || (state.mix && state.mix.cornerType) || "2br";
  const row = typesOf(state).find((t) => t.id === type) || null;
  const outer = rr3(z.outer);
  const area = r1(Math.abs(ringArea(outer)));
  return { type, outer, area, match: matchFor(area, row, layout.depth, { mode: modeOf(state) }), mode: "corner", legs: z.legs, e: z.e, zoneId: z.id || null };
}
