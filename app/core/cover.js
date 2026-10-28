/* ==========================================================================
   DECK COVER
   A wrap or podium parking deck takes the place of the massing levels it uses. Those massing levels must not draw as
   solids, or the solid hides the deck (Cade, October 27, 2026). This is the same rule the Model Viewer uses for the
   levels that the Plate Planner covers.

   The deck levels come from parking.derived.levels (z in the deck frame). A podium or wrap deck copies the massing
   placement and level heights, so the deck z and the massing z are in the same frame. Match tolerance: 0.5 ft.
   ========================================================================== */
import { toolOn } from '../tools/registry.js';
import { getSection } from '../../src/shared/project.js';

const TOL = 0.5;
const ZONE_OF = { podium: 'podium', wrap: 'deck' };

/** { zone, zs: [z...] } for a wrap or podium deck in the project, else null. */
export function deckCover(doc) {
  if (!toolOn('parking')) return null;   // the Parking Deck is hidden: the massing draws every podium floor (registry.js)
  const sec = getSection(doc, 'parking');
  const source = sec && sec.state && sec.state.source;
  const zone = ZONE_OF[source];
  const levels = sec && sec.derived && Array.isArray(sec.derived.levels) ? sec.derived.levels : [];
  if (!zone || !levels.length) return null;
  const zs = levels.map((l) => Number(l && l.z)).filter(Number.isFinite);
  return zs.length ? { zone, zs } : null;
}

/** True when a massing floor (zone, z in the massing frame) sits where the deck has a level. */
export function covered(cover, zone, z) {
  if (!cover || zone !== cover.zone || !Number.isFinite(z)) return false;
  return cover.zs.some((d) => Math.abs(d - z) < TOL);
}

/** A short key for layer caches: changes when the covered set changes. */
export function coverKey(doc) {
  const c = deckCover(doc);
  return c ? `${c.zone}:${c.zs.map((z) => Math.round(z * 10)).join(',')}` : 'none';
}

/** The covered massing level indices of massing.derived.levels (for the derived massing layer). */
export function coveredMassingIndices(doc) {
  const c = deckCover(doc);
  const out = new Set();
  if (!c) return out;
  const sec = getSection(doc, 'massing');
  const levels = sec && sec.derived && Array.isArray(sec.derived.levels) ? sec.derived.levels : [];
  for (const l of levels) if (l && covered(c, l.zone, Number(l.z))) out.add(l.index);
  return out;
}

/* ---------- floors the Plate Planner covers ---------- */
/* The Plate Planner draws units and cores inside the massing walls. A massing solid on the same floor shares those wall
   faces, and the two flicker (z-fighting). Rule (one look in every tool, Cade, October 28, 2026): while the plates
   match the massing (platesCurrent), the units draw those floors and the Tower skips them; once the massing changes,
   the units hide and the Tower draws every floor. The active tool never changes this. */

/** The z values (massing frame) of the massing levels that plates.derived covers. */
export function platesCoverZs(doc) {
  const plates = getSection(doc, 'plates');
  const mass = getSection(doc, 'massing');
  const pl = plates && plates.derived && Array.isArray(plates.derived.levels) ? plates.derived.levels : [];
  const ml = mass && mass.derived && Array.isArray(mass.derived.levels) ? mass.derived.levels : [];
  if (!pl.length || !ml.length) return [];
  const idx = new Set(pl.map((l) => l && l.index).filter(Number.isFinite));
  return ml.filter((l) => l && idx.has(l.index) && Number.isFinite(Number(l.z))).map((l) => Number(l.z));
}

/** True when a massing floor at z (massing frame) is covered by the Plate Planner. */
export function platesCovered(zs, z) {
  return Array.isArray(zs) && Number.isFinite(z) && zs.some((d) => Math.abs(d - z) < TOL);
}

/** A short key for layer caches (plates coverage). */
export function platesCoverKey(doc) {
  const zs = platesCoverZs(doc);
  return zs.length ? zs.map((z) => Math.round(z * 10)).join(',') : 'none';
}

/** True when the Plate Planner units still match the massing (they draw; the massing skips those floors).
 *  The test is geometry, not dates: every plates level must find a massing level with the same index, z, floor-to-floor
 *  height, and floor plate (plan ring within 0.05 ft). A move, a turn, or a new base elevation of the building changes
 *  the placement only, so the units stay current. False with no plates. */
export function platesCurrent(doc) {
  const plates = getSection(doc, 'plates');
  const mass = getSection(doc, 'massing');
  const pl = plates && plates.derived && Array.isArray(plates.derived.levels) ? plates.derived.levels : [];
  const ml = mass && mass.derived && Array.isArray(mass.derived.levels) ? mass.derived.levels : [];
  if (!pl.length || !ml.length) return false;
  const byIndex = new Map(ml.filter((l) => l && Number.isFinite(l.index)).map((l) => [l.index, l]));
  const near = (a, b, t) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= t;
  const ringKey = (mp) => {
    const out = [];
    for (const poly of Array.isArray(mp) ? mp : []) {
      for (const r of [poly && poly.outer, ...((poly && poly.holes) || [])]) {
        if (!Array.isArray(r)) continue;
        out.push(r.map((p) => `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)}`).sort().join(';'));
      }
    }
    return out.sort().join('|');
  };
  for (const l of pl) {
    const m = l && byIndex.get(l.index);
    if (!m) return false;
    if (!near(l.z, m.z, 0.05) || !near(l.ftf, m.ftf, 0.05)) return false;
    if (ringKey(l.plate) !== ringKey(m.plates)) return false;
  }
  return true;
}
