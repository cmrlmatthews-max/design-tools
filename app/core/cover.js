/* ==========================================================================
   DECK COVER
   A wrap or podium parking deck takes the place of the massing levels it uses. Those massing levels must not draw as
   solids, or the solid hides the deck (Cade, October 27, 2026). This is the same rule the Model Viewer uses for the
   levels that the Plate Planner covers.

   The deck levels come from parking.derived.levels (z in the deck frame). A podium or wrap deck copies the massing
   placement and level heights, so the deck z and the massing z are in the same frame. Match tolerance: 0.5 ft.
   ========================================================================== */
import { getSection } from '../../src/shared/project.js';

const TOL = 0.5;
const ZONE_OF = { podium: 'podium', wrap: 'deck' };

/** { zone, zs: [z...] } for a wrap or podium deck in the project, else null. */
export function deckCover(doc) {
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
   faces, and the two flicker (z-fighting). The Model Viewer skips the covered massing levels; the Tower live layer
   does the same while the Tower is not the active tool. While the Tower is active, the shell hides the units instead
   (they are out of date during an edit). */

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

/** True when the Plate Planner units were made from the current massing (they draw; the massing skips those floors).
 *  False when there are no plates or the massing changed after them (the massing draws all floors; units hide). */
export function platesCurrent(doc) {
  const plates = getSection(doc, 'plates');
  const mass = getSection(doc, 'massing');
  if (!plates || !mass || !plates.derived || !Array.isArray(plates.derived.levels) || !plates.derived.levels.length) return false;
  const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
  const made = ms(plates.derived.massingUpdatedAt) ?? ms(plates.updatedAt);
  const now = ms(mass.updatedAt);
  return made !== null && now !== null && made >= now;
}
