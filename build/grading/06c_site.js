/* ==========================================================================
   SITE LAYER  (docs/site-layer-technical-plan.md sections 2, 4 and 7)
   `SiteLayer` is the small adapter between the open project and the shared drawing part (SiteLayer3D, build/shared/06x_sitelayer.js).
   The Grading Sketch keeps its own ground (existing and proposed, cut and fill, exaggeration). With a project that has a site, the
   layer draws everything else of the site in the project frame: the neighbor buildings as solid blocks with dark edges, roads, walks,
   water and trees. Elevations are NAVD88 feet (placement is the identity), mapped through the sketch's own exaggeration mapper
   (Ground3D.mapper) so the neighbors stand on the same scale as the ground. Roads and trees are draped on the existing site ground.
   The layer follows the View > Site toggle (view.site). It never feeds a number.
   ========================================================================== */
//@@MODULE sitelayer@@
const SiteLayer = (() => {
  const OFF = { shown: false, ground: false, buildings: 0, roads: 0, walks: 0, waterAreas: 0, trees: 0, key: 'off' };
  let drawn = { ...OFF };

  /** site.derived of the open project, or null (no project, no site section, or nothing in it). */
  function siteDerived() {
    if (!ProjectUI.has()) return null;
    let sec = null;
    try { sec = ProjectMod.getSection(ProjectUI.doc(), 'site'); } catch (e) { sec = null; }
    const dv = sec && sec.derived;
    return dv && typeof dv === 'object' && !Array.isArray(dv) ? dv : null;
  }

  /** Called by Render.syncMain on every frame of the main view (never in Compare).
   *  layer = { group, key } (a THREE.Group already in the scene, hidden in Compare and in the AI-ready image);
   *  state = Store.raw(); d = Derived.get(); kit = { syncLayer, clearGroup, cssColor, themeEpoch, mapper }.
   *  Returns true when the scene changed. */
  function update(layer, state, d, kit) {
    if (layer.key && Store.gestureActive() && Store.gesturePath().startsWith('placement')) return false;     // a drag moves the building: the layer is rebuilt once, on release
    const dv = state.view && state.view.site !== false ? siteDerived() : null;
    const doc = dv ? ProjectUI.doc() : null;
    const pl = dv ? ProjectUI.placement() : null;
    const M = dv && d && Number.isFinite(d.zBase) ? kit.mapper() : null;                 // the sketch's elevation mapper (base level and exaggeration)
    const key = M ? `${SiteLayer3D.keyFor(doc, pl, { site: true, buildings: true }, kit.themeEpoch ? kit.themeEpoch() : 0)}|${M.ex}|${M.zb}` : 'off';
    if (layer.key !== key) SiteLayer3D.dispose(layer.group.children);       // the materials; kit.syncLayer frees the geometry
    return kit.syncLayer(layer, key, () => {
      drawn = { ...OFF, key };
      if (!M) return [];
      let data = null;
      try { data = SiteLayerMod.buildSiteLayerData(dv, pl, { contextIds: new Set() }); } catch (e) { console.error(e); return []; }
      if (!data || !data.ok) return [];
      let res = null;
      try { res = SiteLayer3D.objects(data, { parts: ['buildings', 'roads', 'walks', 'water', 'trees'], zOf: M.Y, css: kit.cssColor, rotation: pl.rotation, edges: true, shadows: true }); } catch (e) { console.error(e); return []; }
      const i = res.info;
      drawn = { shown: true, ground: false, buildings: i.buildings, roads: i.roads, walks: i.walks, waterAreas: i.waterAreas, trees: i.trees, key };
      return res.objects;
    });
  }

  /** For tests: { shown, ground, buildings, roads, walks, waterAreas, trees, key }. */
  function info() { return { ...drawn }; }
  /** The site ground mesh now on screen: none here, the Grading Sketch draws its own ground. */
  function groundMesh() { return null; }
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
  return { update, info, groundMesh, frameKey, frameBox };
})();
