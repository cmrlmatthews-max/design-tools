/* ==========================================================================
   CORE: ground (app/CONTRACT.md section 11, docs/shell-plan.md section 7)
   One ground registry for the page.

   1. The Site Model owns the existing ground: site.derived.ground, a grid in the PROJECT frame (the site section
      placement is the identity), sampled bilinear like src/shared/sitelayer.js groundZAt.
   2. The Grading Sketch registers a proposed-ground override: setOverride(fn, owner). fn(x, y) gives the proposed
      elevation at a project point, or null where it has no ground (the existing ground shows through there).
   3. at(x, y) = override, else existing, else null. All points and elevations are in the project frame.

   Owner rule: setOverride(fn, owner) replaces any override. setOverride(null, owner) clears it only when that owner
   holds it (or when owner is left out), so the derived grading layer never clears a live Grading tool's override.
   Every change emits 'ground:change' { owner, on } on the bus (core/layers.js re-syncs on it).
   Pure: no DOM, no Three.js. Never throws.
   ========================================================================== */
import { getSection } from '../../src/shared/project.js';
import { groundZAt } from '../../src/shared/sitelayer.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export function createGround({ getDoc, bus } = {}) {
  let override = null, owner = null, version = 0;

  function siteDerived() {
    let doc = null;
    try { doc = typeof getDoc === 'function' ? getDoc() : null; } catch (e) { doc = null; }
    const sec = doc ? getSection(doc, 'site') : null;
    const dv = sec && sec.derived;
    return dv && typeof dv === 'object' && !Array.isArray(dv) ? dv : null;
  }

  /** The existing ground at a project point, or null without a site ground. */
  function existingAt(x, y) {
    if (!fin(x) || !fin(y)) return null;
    const dv = siteDerived();
    if (!dv) return null;
    try { const z = groundZAt(dv, x, y); return fin(z) ? z : null; } catch (e) { return null; }
  }

  /** The ground at a project point: the override, else the existing ground, else null. */
  function at(x, y) {
    if (!fin(x) || !fin(y)) return null;
    if (override) {
      let z = null;
      try { z = override(x, y); } catch (e) { z = null; }
      if (fin(z)) return z;
    }
    return existingAt(x, y);
  }

  function setOverride(fn, who) {
    const next = typeof fn === 'function' ? fn : null;
    if (!next) {
      if (!override) return false;
      if (who !== undefined && who !== null && owner !== null && who !== owner) return false;
      override = null; owner = null;
    } else {
      if (next === override && (who || null) === owner) return false;
      override = next; owner = who || null;
    }
    version++;
    try { if (bus) bus.emit('ground:change', { owner, on: !!override }); } catch (e) { /* ignore */ }
    return true;
  }

  return {
    at, existingAt, setOverride,
    hasOverride: () => !!override,
    owner: () => owner,
    /** Goes up on every override change; layer keys use it. */
    version: () => version,
  };
}
