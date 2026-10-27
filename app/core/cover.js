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
