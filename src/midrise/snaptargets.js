/* ==========================================================================
   snaptargets.js — snap lines for the mid-rise generator (plan 4, 5.3)

   Pure ES module. No DOM, no three, no mutation of inputs.
   The lines are in the exact shape src/tower/snap.js consumes
   (docs/v1.1-spec.md, "Contract: src/tower/snap.js"):
     { axis: "x" | "y", value, kind, label, from, to }
   so snapMove, snapEdge and snapLength work unchanged.

   kind stays inside snap.js's list, which also sets the tie priority
   (segment > podium > context > setback > site > grid):
     bar edges and centers  → kind "segment"
     deck edges             → kind "podium"
     court edges            → kind "context"
     context blocks         → kind "context"   (only when context.show)
     site, setback          → from collectSnapTargets in snap.js
   Every line also carries `source` ("site" | "setback" | "bar" | "deck" |
   "court" | "context") and, for bars and courts, `id`. snap.js ignores the
   extras and copies them onto the guides it returns.
   The grid is not a line: pass grid = state.view.snap.grid to snapMove.

   exclude: { kind: "bar" | "deck" | "court" | "context", id?, index? }
            or an array of them (a multi-selection being moved).
   ========================================================================== */

import { collectSnapTargets } from "../tower/snap.js";
import { legsOf, legRing } from "./bars.js";

function num(v, d = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function rectBox(x, y, w, d) {
  if (!(w > 0 && d > 0)) return null;
  return { minX: x - w / 2, maxX: x + w / 2, minY: y - d / 2, maxY: y + d / 2 };
}

function boxLines(out, b, kind, name, extra, withCenter) {
  const add = (axis, value, label, from, to) => out.push({ axis, value, kind, label, from, to, ...extra });
  add("x", b.minX, `${name} west edge`, b.minY, b.maxY);
  add("x", b.maxX, `${name} east edge`, b.minY, b.maxY);
  add("y", b.minY, `${name} south edge`, b.minX, b.maxX);
  add("y", b.maxY, `${name} north edge`, b.minX, b.maxX);
  if (withCenter) {
    add("x", (b.minX + b.maxX) / 2, `${name} center`, b.minY, b.maxY);
    add("y", (b.minY + b.maxY) / 2, `${name} center`, b.minX, b.maxX);
  }
}

function excluded(list, kind, id, index) {
  return list.some((e) => e && e.kind === kind &&
    ((e.id !== undefined && e.id === id) || (e.index !== undefined && num(e.index, -1) === index) ||
     (e.id === undefined && e.index === undefined)));
}

/**
 * Plan box of one bar: the bbox of its leg rings (rotation, bends and miter
 * extensions included). Computed from the state, so it is current during a
 * drag even when `built` is stale. → { minX, maxX, minY, maxY } | null
 */
export function barBox(state, built, barId) {
  if (!state || !Array.isArray(state.bars)) throw new Error("barBox: state.bars is required");
  const bar = state.bars.find((b) => b && b.id === barId);
  if (!bar || !(num(bar.length) > 0) || !(num(bar.depth) > 0)) return null;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const leg of legsOf(bar)) {
    for (const q of legRing(leg)) {
      if (q[0] < b.minX) b.minX = q[0];
      if (q[0] > b.maxX) b.maxX = q[0];
      if (q[1] < b.minY) b.minY = q[1];
      if (q[1] > b.maxY) b.maxY = q[1];
    }
  }
  return Number.isFinite(b.minX) ? b : null;
}

/**
 * Box of any movable item, for snapMove (extra helper, like itemBox in snap.js).
 * item: { kind: "bar", id } | { kind: "deck" } | { kind: "court", id?, index? } | { kind: "context", index }
 * → { minX, maxX, minY, maxY } | null
 */
export function midriseItemBox(state, built, item) {
  if (!state) throw new Error("midriseItemBox: state is required");
  if (!item) return null;
  if (item.kind === "bar") {
    const id = item.id !== undefined ? item.id : ((state.bars || [])[num(item.index, -1)] || {}).id;
    return barBox(state, built, id);
  }
  if (item.kind === "deck") {
    const d = state.deck;
    return d ? rectBox(num(d.x), num(d.y), num(d.w), num(d.d)) : null;
  }
  if (item.kind === "court") {
    const courts = state.courts || [];
    const c = item.id !== undefined ? courts.find((k) => k && k.id === item.id) : courts[num(item.index, -1)];
    return c ? rectBox(num(c.x), num(c.y), num(c.w), num(c.d)) : null;
  }
  if (item.kind === "context") {
    const c = ((state.context && state.context.blocks) || [])[num(item.index, -1)];
    return c ? rectBox(num(c.x), num(c.y), num(c.w), num(c.d)) : null;
  }
  return null;
}

/**
 * All snap lines for a drag (plan 5.3): site edges, setback lines, other bars'
 * edges and centers, deck edges, court edges, and context blocks when shown.
 * Build once at drag start with `exclude` = the moving item(s). → { lines }
 */
export function collectBarSnapTargets(state, built, { exclude } = {}) {
  if (!state || typeof state !== "object") throw new Error("collectBarSnapTargets: state is required");
  if (!state.site) throw new Error("collectBarSnapTargets: state.site is required");
  const ex = Array.isArray(exclude) ? exclude : exclude ? [exclude] : [];
  const lines = [];

  // site edges and setback lines from the tower module (a site-only state: no podium, segments or context)
  for (const l of collectSnapTargets({ site: state.site }, []).lines) lines.push({ ...l, source: l.kind });

  const bars = Array.isArray(state.bars) ? state.bars : [];
  bars.forEach((bar, i) => {
    if (!bar || excluded(ex, "bar", bar.id, i)) return;
    const b = barBox(state, built, bar.id);
    if (b) boxLines(lines, b, "segment", bar.name || `Bar ${bar.id}`, { source: "bar", id: bar.id }, true);
  });

  const deck = state.deck;
  if (deck && deck.on && !excluded(ex, "deck", undefined, 0)) {
    const b = rectBox(num(deck.x), num(deck.y), num(deck.w), num(deck.d));
    if (b) boxLines(lines, b, "podium", "Deck", { source: "deck" }, false);
  }

  (state.courts || []).forEach((c, i) => {
    if (!c || excluded(ex, "court", c.id, i)) return;
    const b = rectBox(num(c.x), num(c.y), num(c.w), num(c.d));
    if (b) boxLines(lines, b, "context", `Court ${c.id || i + 1}`, { source: "court", id: c.id }, false);
  });

  const ctx = state.context;
  if (ctx && ctx.show !== false && Array.isArray(ctx.blocks)) {
    ctx.blocks.forEach((c, i) => {
      if (!c || excluded(ex, "context", undefined, i)) return;
      const b = rectBox(num(c.x), num(c.y), num(c.w), num(c.d));
      if (b) boxLines(lines, b, "context", `Context block ${i + 1}`, { source: "context" }, true);
    });
  }

  return { lines };
}
