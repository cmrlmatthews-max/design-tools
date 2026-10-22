/* ==========================================================================
   SITE LAYER  (docs/tower-project-sun-plan.md sections 4.1 and 6.1)
   `SiteLayer` draws the project site boundary under the tower when a project with a site is open
   (in the tower local frame, ProjectMod.transformRing(placement, boundary, "toLocal")). Neighbor buildings
   come in as context blocks through Context from site, so the context layer already draws them.
   PHASE 0 STUB: phase 3 replaces the bodies. Keep the global name and the method signatures.
   ========================================================================== */
const SiteLayer = (() => {
  /** Called by Render.syncMain on every frame of the main view (never in Compare).
   *  layer = { group, key } (a THREE.Group already in the scene, hidden in Compare and in the AI-ready image);
   *  state = Store.raw(); d = Derived.get(); kit = { syncLayer, clearGroup, materialFor, lineMaterial }.
   *  Use kit.syncLayer(layer, key, () => objects) so the group is rebuilt only when the key changes.
   *  Returns true when the scene changed. */
  function update(layer, state, d, kit) { return false; }
  /** For tests: what is drawn. */
  function info() { return { shown: false, points: 0 }; }
  return { update, info };
})();
