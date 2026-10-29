/* ==========================================================================
   TOWER: several towers on one podium (Cade, October 29, 2026)
   The state keeps ONE flat `segments` array. A segment has an optional integer `tower` (missing = 0). Segments with the
   same `tower` stack bottom to top in array order. Each segment keeps its own offset; a tower sits where its segments sit.
   Towers share the floor levels, and the level heights come from Tower 1.
   Pure helpers (no DOM): the left bar, the 3D drag and the tests use the same ones.
   ========================================================================== */
import { num, deepClone } from './state.js';

const GAP = 30;   // feet between a copied tower and the one it was copied from, when it goes beside it

/** The tower index of a segment (missing or invalid = 0). */
export const towerOf = (seg) => {
  const t = Math.floor(Number(seg && seg.tower));
  return Number.isFinite(t) && t > 0 ? t : 0;
};
/** The tower indices in use, sorted. Always has at least one entry. */
export function towerIds(segments) {
  const ids = [...new Set((segments || []).map(towerOf))].sort((a, b) => a - b);
  return ids.length ? ids : [0];
}
/** Global indices (in the flat array) of one tower's segments, in stacking order. */
export const indicesOf = (segments, t) => {
  const out = [];
  (segments || []).forEach((s, i) => { if (towerOf(s) === t) out.push(i); });
  return out;
};
/** Stamps a tower index on a segment. Tower 0 keeps the field out of the way (one-tower projects stay as they were). */
const stamp = (seg, t) => { if (t > 0) seg.tower = t; else if ('tower' in seg) seg.tower = 0; return seg; };

/** Replaces one tower's segments with `arr` (same position in the flat array; a new tower goes at the end). Edits `segments` in place. */
export function replaceTower(segments, t, arr) {
  const first = segments.findIndex((s) => towerOf(s) === t);
  const rest = segments.filter((s) => towerOf(s) !== t);
  const at = first < 0 ? rest.length : first;
  arr.forEach((s) => stamp(s, t));
  segments.splice(0, segments.length, ...rest.slice(0, at), ...arr, ...rest.slice(at));
  return segments;
}

/** Width and depth (feet) of a segment's footprint, before taper, twist and lean. Quarter turns swap them. */
export function segmentExtent(seg) {
  const sh = (seg && seg.shape) || {};
  const type = String(sh.type || 'rect').toLowerCase();
  let w = num(sh.w, 0), d = num(sh.d, 0);
  if (type === 'square' || type === 'circle') { if (!(w > 0)) w = d; d = w; }
  if ((type === 'polygon' || type === 'custom') && Array.isArray(sh.points) && sh.points.length) {
    const xs = sh.points.map((p) => num(p[0], 0)), ys = sh.points.map((p) => num(p[1], 0));
    w = Math.max(...xs) - Math.min(...xs); d = Math.max(...ys) - Math.min(...ys);
  }
  const r = ((num(seg && seg.rotation, 0) % 360) + 360) % 360;
  if (Math.abs(r - 90) < 1e-6 || Math.abs(r - 270) < 1e-6) [w, d] = [d, w];
  return { w, d };
}
/** The footprint box of a list of segments: { minX, maxX, minY, maxY, cx, cy, w, d }. */
export function towerBox(segs) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of segs) {
    const { w, d } = segmentExtent(s);
    const ox = num(s.offset && s.offset.x, 0), oy = num(s.offset && s.offset.y, 0);
    minX = Math.min(minX, ox - w / 2); maxX = Math.max(maxX, ox + w / 2);
    minY = Math.min(minY, oy - d / 2); maxY = Math.max(maxY, oy + d / 2);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0, cx: 0, cy: 0, w: 0, d: 0 };
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, d: maxY - minY };
}
const overlaps = (a, b) => a.minX < b.maxX - 0.01 && a.maxX > b.minX + 0.01 && a.minY < b.maxY - 0.01 && a.maxY > b.minY + 0.01;

/**
 * Where a copy of tower `t` goes. Returns { dx, dy, how } (how: 'mirror' | 'beside').
 * With the podium on, the copy is the mirror image across the podium center along the podium's long side.
 * A tower already centered on the podium (or a spot another tower holds) goes beside instead: its width + 30 ft along x.
 */
export function copyShift(state, t) {
  const segs = state.segments || [];
  const mine = segs.filter((s) => towerOf(s) === t);
  const box = towerBox(mine);
  const others = towerIds(segs).filter((id) => id !== t).map((id) => towerBox(segs.filter((s) => towerOf(s) === id)));
  const pod = state.podium;
  if (pod && pod.on) {
    const sh = pod.shape || {};
    const alongX = num(sh.w, 0) >= num(sh.d, 0);
    const c = alongX ? num(pod.offset && pod.offset.x, 0) : num(pod.offset && pod.offset.y, 0);
    const mine1 = alongX ? box.cx : box.cy;
    const delta = 2 * (c - mine1);                       // new center = 2c - old center
    const moved = alongX ? { ...box, minX: box.minX + delta, maxX: box.maxX + delta } : { ...box, minY: box.minY + delta, maxY: box.maxY + delta };
    if (Math.abs(delta) > 0.5 && !others.some((o) => overlaps(o, moved))) return alongX ? { dx: delta, dy: 0, how: 'mirror' } : { dx: 0, dy: delta, how: 'mirror' };
  }
  const step = Math.max(box.w, 1) + GAP;
  let dx = step;
  for (let n = 0; n < 50 && others.some((o) => overlaps(o, { ...box, minX: box.minX + dx, maxX: box.maxX + dx })); n++) dx += step;
  return { dx, dy: 0, how: 'beside' };
}

/** Adds a deep copy of tower `t` as the next tower. Edits `state` in place and returns the new tower index. */
export function copyTowerInState(state, t) {
  const { dx, dy } = copyShift(state, t);
  const next = Math.max(...towerIds(state.segments)) + 1;
  const copies = state.segments.filter((s) => towerOf(s) === t).map((s) => {
    const c = deepClone(s);
    c.tower = next;
    c.offset = { x: num(c.offset && c.offset.x, 0) + dx, y: num(c.offset && c.offset.y, 0) + dy };
    return c;
  });
  state.segments.push(...copies);
  return next;
}

/** Removes tower `t` and renumbers the higher ones down so the indices stay contiguous. Refuses to remove the only tower. */
export function removeTowerInState(state, t) {
  if (towerIds(state.segments).length <= 1) return false;
  state.segments = state.segments.filter((s) => towerOf(s) !== t);
  state.segments.forEach((s) => { const k = towerOf(s); if (k > t) s.tower = k - 1; });
  return true;
}

/** A new tower: one default-looking segment, beside the other towers. Edits `state` in place and returns the new tower index. */
export function addTowerInState(state, make) {
  const ids = towerIds(state.segments);
  const next = Math.max(...ids) + 1;
  const seg = make();
  seg.tower = next;
  const boxes = ids.map((id) => towerBox(state.segments.filter((s) => towerOf(s) === id)));
  const all = boxes.length ? { maxX: Math.max(...boxes.map((b) => b.maxX)), cy: boxes[0].cy } : { maxX: 0, cy: 0 };
  const { w } = segmentExtent(seg);
  seg.offset = { x: Math.round(all.maxX + GAP + w / 2), y: Math.round(num(boxes[0] && boxes[0].cy, 0)) };
  state.segments.push(seg);
  return next;
}
