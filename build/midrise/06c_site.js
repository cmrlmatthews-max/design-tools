/* ==========================================================================
   SITE LAYER  (docs/site-layer-technical-plan.md sections 4 and 7)
   `SiteLayer` is the small adapter between the page and the shared site layer. While a project with a site is open and the View
   tab's "Site" toggle (view.site) is on, it builds the layer data with SiteLayerMod.buildSiteLayerData (the site in the tower's
   local frame) and the Three.js objects with SiteLayer3D.objects (build/shared/06x_sitelayer.js): the ground with a skirt, the
   dashed site boundary with the north arrow, the neighbor buildings (view.siteStyle: solid with dark edges, glass, or wireframe), roads, walks, water and trees.
   The layer is rebuilt only when its key changes (site, placement, theme).
   The layer draws EVERY site building as a solid with dark edges. While it shows, Render's context layer leaves out the context blocks
   that came from the site (block.site === true; they stay in the state for metrics), so nothing draws twice.
   ========================================================================== */
const SiteLayer = (() => {
  const EMPTY = { style: 'solid', shown: false, ground: false, buildings: 0, roads: 0, walks: 0, waterAreas: 0, trees: 0, triangles: 0, points: 0, rotation: 0, key: 'off', bounds: null };
  let drawn = { ...EMPTY };
  let lastObjects = [];
  let builtPl = null;                // the placement the objects were built for
  let zCache = { key: null, min: 0, max: 0 };
  const isObjP = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** site.derived of the open project, or null. */
  function derivedOf() {
    if (!ProjectUI.has()) return null;
    let sec = null;
    try { sec = ProjectMod.getSection(ProjectUI.doc(), 'site'); } catch (e) { sec = null; }
    return sec && isObjP(sec.derived) ? sec.derived : null;
  }
  /** True while the layer draws: a project with a site is open and view.site is not off. */
  function isOn(state) {
    const st = state || Store.raw();
    return ProjectUI.has() && ProjectUI.hasSite() && !(st.view && st.view.site === false);
  }

  /** The site style of the View tab: 'solid' | 'glass' | 'wireframe' (anything else is 'solid'). Only the neighbor buildings change. */
  const styleOf = (state) => { const v = state && state.view && state.view.siteStyle; return v === 'glass' || v === 'wireframe' ? v : 'solid'; };

  /** Called by Render.syncMain on every frame of the main view (never in Compare).
   *  layer = { group, key } (a THREE.Group already in the scene, hidden in Compare and in the AI-ready image);
   *  state = Store.raw(); d = Derived.get(); kit = { syncLayer, clearGroup, materialFor, lineMaterial, themeEpoch }.
   *  Returns true when the scene changed. */
  function update(layer, state, d, kit) {
    const on = isOn(state);
    const pl = on ? ProjectUI.placement() : null;
    // While the building is dragged or turned (a live placement gesture) the layer is not rebuilt: the built objects are moved as a solid
    // from the placement they were built for to the live one. The rebuild comes with the commit (the key then carries the new placement).
    const g = layer.group;
    const gesture = on && builtPl && layer.key && layer.key !== 'off' && Store.gestureActive() && String(Store.gesturePath()).startsWith('placement');
    if (gesture) {
      const phi = ((builtPl.rotation - pl.rotation) * Math.PI) / 180, c = Math.cos(pl.rotation * Math.PI / 180), s = Math.sin(pl.rotation * Math.PI / 180);
      const ox = builtPl.x - pl.x, oy = builtPl.y - pl.y;
      // local_new = Rot(builtRot - rot) local_old + Rot(-rot) (t_old - t_new); plan (x, y, z) is world (x, z, -y)
      const dx = ox * c + oy * s, dy = -ox * s + oy * c, dz = builtPl.baseZ - pl.baseZ;
      const moved = g.rotation.y !== phi || g.position.x !== dx || g.position.y !== dz || g.position.z !== -dy;
      g.rotation.y = phi; g.position.set(dx, dz, -dy);
      return moved;
    }
    const wasMoved = g.rotation.y !== 0 || g.position.x !== 0 || g.position.y !== 0 || g.position.z !== 0;
    if (wasMoved) { g.rotation.y = 0; g.position.set(0, 0, 0); }
    const key = on ? SiteLayer3D.keyFor(ProjectUI.doc(), pl, 'site', kit.themeEpoch ? kit.themeEpoch() : 0, styleOf(state)) : 'off';
    const rebuilt = kit.syncLayer(layer, key, () => {
      builtPl = pl;
      SiteLayer3D.dispose(lastObjects);
      lastObjects = [];
      const derived = on ? derivedOf() : null;
      if (!derived) { drawn = { ...EMPTY, key }; return []; }
      const data = SiteLayerMod.buildSiteLayerData(derived, pl, {});
      const ring = ProjectUI.boundaryLocal();
      if (!data.ok) { drawn = { ...EMPTY, shown: true, key, points: ring ? ring.length : 0, rotation: pl.rotation }; return []; }
      const res = SiteLayer3D.objects(data, { rotation: pl.rotation, style: styleOf(state) });
      lastObjects = res.objects;
      drawn = { ...EMPTY, ...res.info, shown: true, key, points: ring ? ring.length : 0, rotation: pl.rotation };
      return res.objects;
    });
    return rebuilt || wasMoved;
  }

  /** Shadow flags for the layer (Render.applyView): the buildings and trees cast, the ground, roads and water receive. */
  function applyShadows(cast, receive) { SiteLayer3D.setShadows(lastObjects, cast, receive); }

  /** The site ground elevation at a LOCAL point, relative to the placement base, or null (no site, layer off, or no grid). */
  function groundZ(x, y) {
    if (!isOn()) return null;
    const derived = derivedOf();
    return derived ? SiteLayerMod.groundZLocal(derived, ProjectUI.placement(), x, y) : null;
  }

  /** The extent of what the layer shows, in the local frame: { minX, maxX, minY, maxY, zMin, zMax } or null while it is off.
   *  Worked out from the project (not from the built objects), so a view can be framed before the first frame draws. */
  function frameBounds() {
    if (!isOn()) return null;
    const ring = ProjectUI.boundaryLocal();
    const derived = derivedOf();
    if (!ring || ring.length < 3 || !derived) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
    const g = isObjP(derived.ground) ? derived.ground : null;
    const zk = g ? `${ProjectUI.boundaryKey().split('|')[0]}|${g.n}|${g.points && g.points.length}` : 'none';
    if (zCache.key !== zk) {
      let lo = Infinity, hi = -Infinity;
      if (g && Array.isArray(g.points)) for (const p of g.points) { if (p[2] < lo) lo = p[2]; if (p[2] > hi) hi = p[2]; }
      zCache = { key: zk, min: Number.isFinite(lo) ? lo : 0, max: Number.isFinite(hi) ? hi : 0 };
    }
    const bz = ProjectUI.placement().baseZ;
    return { minX, maxX, minY, maxY, zMin: zCache.min - bz, zMax: zCache.max - bz };
  }
  /** Changes when the layer switches on or off or another site opens (not when the building moves): Render re-frames on it. */
  function frameKey() { return isOn() ? `on|${ProjectUI.boundaryKey().split('|')[0]}` : 'off'; }

  /** For tests: what is drawn. */
  function info() { return { ...drawn, bounds: drawn.bounds ? { ...drawn.bounds } : null }; }
  /** The site ground mesh now on screen (shadows, the drag hit test), or null. */
  function groundMesh() { return lastObjects.find((o) => o.userData && o.userData.kind === 'site-ground') || null; }
  return { update, info, groundMesh, applyShadows, groundZ, frameBounds, frameKey, isOn };
})();
