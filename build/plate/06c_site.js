/* ==========================================================================
   SITE LAYER  (docs/site-layer-technical-plan.md sections 2, 4 and 7)
   `SiteLayer` is the small adapter between the open project and the shared drawing part (SiteLayer3D, build/shared/06x_sitelayer.js).
   With a project that has a site, the layer draws the whole site square in the plate's own (massing) frame: the ground with elevation
   shading, the boundary and the north arrow, the neighbor buildings as solid blocks with dark edges, roads, walks, water and trees.
   The ground is drawn in the local frame, so its z is `ground - placement.baseZ`: a plate on a slope cuts into the ground.
   The plate is a flat drawing at its base elevation, so the layer drops by the highest ground under the plate (plus half a foot):
   the ground never covers the plan. The plate is not cut into a slope the way a building is.
   The layer follows the View > Site toggle (view.site). It never feeds a number: the metrics read the project, not this layer.
   ========================================================================== */
//@@MODULE sitelayer@@
const SiteLayer = (() => {
  const OFF = { shown: false, ground: false, buildings: 0, roads: 0, walks: 0, waterAreas: 0, trees: 0, key: 'off' };
  let drawn = { ...OFF };
  let mesh = null, zBottom = 0, drop = 0, foot = 0;

  /** site.derived of the open project, or null (no project, no site section, or nothing in it). */
  function siteDerived() {
    if (!ProjectUI.has()) return null;
    let sec = null;
    try { sec = ProjectMod.getSection(ProjectUI.doc(), 'site'); } catch (e) { sec = null; }
    const dv = sec && sec.derived;
    return dv && typeof dv === 'object' && !Array.isArray(dv) ? dv : null;
  }

  /** ft the layer drops so the ground under the plate stays below it: the highest ground over a 9 x 9 sampling of the plate box, plus 0.5 ft (0 when the ground is lower). */
  function dropFor(d, dv, pl) {
    const b = d && d.bounds && d.bounds.model;
    if (!b || !Number.isFinite(b.minX + b.maxX + b.minY + b.maxY)) return 0;
    let top = -Infinity;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      let z = null;
      try { z = SiteLayerMod.groundZLocal(dv, pl, b.minX + (b.maxX - b.minX) * i / 8, b.minY + (b.maxY - b.minY) * j / 8); } catch (e) { z = null; }
      if (Number.isFinite(z) && z > top) top = z;
    }
    return top > -Infinity ? Math.max(0, top + 0.5) : 0;
  }

  /** ft the massing continues below its base so the lowest levels meet the lowest ground under them (the layer is dropped, so the building would float): 0 on flat ground, at most 80. */
  function footFor(dv, pl, dropNow) {
    const b = ProjectUI.massingBox();
    if (!b) return 0;
    let low = Infinity;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      let z = null;
      try { z = SiteLayerMod.groundZLocal(dv, pl, b.minX + (b.maxX - b.minX) * i / 8, b.minY + (b.maxY - b.minY) * j / 8); } catch (e) { z = null; }
      if (Number.isFinite(z) && z < low) low = z;
    }
    return low < Infinity ? Math.min(80, Math.max(0, dropNow - low)) : 0;
  }

  /** Called by Render.syncMain on every frame of the main view (never in Compare).
   *  layer = { group, key } (a THREE.Group already in the scene, hidden in Compare and in the AI-ready image);
   *  state = Store.raw(); d = Derived.get(); kit = { syncLayer, clearGroup, cssColor, themeEpoch }.
   *  Returns true when the scene changed. */
  function update(layer, state, d, kit) {
    if (layer.key && Store.gestureActive() && Store.gesturePath().startsWith('placement')) return false;     // a drag moves the building: the layer is rebuilt once, on release
    const dv = state.view && state.view.site !== false ? siteDerived() : null;
    const doc = dv ? ProjectUI.doc() : null;
    const pl = dv ? ProjectUI.placement() : null;
    const key = dv ? SiteLayer3D.keyFor(doc, pl, { site: true, buildings: true }, kit.themeEpoch ? kit.themeEpoch() : 0) : 'off';
    if (layer.key !== key) SiteLayer3D.dispose(layer.group.children);       // the materials; kit.syncLayer frees the geometry
    const changed = kit.syncLayer(layer, key, () => {
      mesh = null; zBottom = 0; drawn = { ...OFF, key };
      if (!dv) return [];
      let data = null;
      try { data = SiteLayerMod.buildSiteLayerData(dv, pl, { contextIds: new Set() }); } catch (e) { console.error(e); return []; }
      if (!data || !data.ok) return [];
      let res = null;
      try { res = SiteLayer3D.objects(data, { css: kit.cssColor, rotation: pl.rotation, edges: true, shadows: false }); } catch (e) { console.error(e); return []; }
      mesh = res.objects.find((o) => o.userData.kind === 'site-ground') || null;
      zBottom = data.bounds ? data.bounds.zMin : 0;
      const i = res.info;
      drawn = { shown: true, ground: !!i.ground, buildings: i.buildings, roads: i.roads, walks: i.walks, waterAreas: i.waterAreas, trees: i.trees, key };
      return res.objects;
    });
    const next = dv ? dropFor(d, dv, pl) : 0;
    foot = dv ? Math.round(footFor(dv, pl, next) * 4) / 4 : 0;
    if (Math.abs(next - drop) > 1e-6 || layer.group.position.y !== -next) { drop = next; layer.group.position.y = -next; return true; }
    return changed;
  }

  /** The depth the massing continues below its base (see footFor); 0 without a drawn ground. */
  function massingFoot() { return mesh ? foot : 0; }
  /** For tests: { shown, ground, buildings, roads, walks, waterAreas, trees, key }. */
  function info() { return { ...drawn }; }
  /** The site ground mesh now on screen (shadows, the drag hit test), or null. */
  function groundMesh() { return mesh; }
  /** The lowest ground node, relative to the placement base (the flat ground slab sits 4 ft under it). */
  function groundBottom() { return mesh ? zBottom : null; }
  /** The ground elevation at a local point, relative to the placement base, or null without a drawn ground. */
  function groundZ(x, y) {
    if (!mesh) return null;
    const dv = siteDerived();
    if (!dv) return null;
    try { const z = SiteLayerMod.groundZLocal(dv, ProjectUI.placement(), x, y); return Number.isFinite(z) ? z - drop : null; } catch (e) { return null; }
  }
  /** The site square in the local frame { minX, maxX, minY, maxY } while the layer is switched on (it does not need the layer built yet), or null. */
  function frameBox(state) {
    if (!state.view || state.view.site === false) return null;
    const dv = siteDerived();
    if (!dv) return null;
    try {
      const sb = SiteLayerMod.siteBounds(dv);
      const ring = sb && ProjectMod.transformRing(ProjectUI.placement(), sb.boundary, 'toLocal');
      if (!ring || !ring.length) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
      return Number.isFinite(minX + maxX + minY + maxY) ? { minX, maxX, minY, maxY } : null;
    } catch (e) { return null; }
  }
  /** Changes when the layer switches on or off or another site opens (not when the building moves): Render re-frames on it. */
  function frameKey(state) {
    if (!(state.view && state.view.site !== false)) return 'off';
    const dv = siteDerived();
    if (!dv) return 'off';
    let sec = null;
    try { sec = ProjectMod.getSection(ProjectUI.doc(), 'site'); } catch (e) { sec = null; }
    return `on|${ProjectUI.doc().id}|${(sec && sec.updatedAt) || ''}`;
  }
  return { update, info, groundMesh, frameKey, groundBottom, groundZ, frameBox, massingFoot };
})();
