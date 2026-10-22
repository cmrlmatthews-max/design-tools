/* ==========================================================================
   SUN-HOURS LAYER  (docs/tower-project-sun-plan.md sections 4.1 and 6.2)
   `SunLayer` draws the sun-hours heat map: one ground quad at z = 0.05 ft with a canvas texture (one pixel per
   grid node, nearest filter, 75 percent opacity) and the legend. Hidden in Diagram style and in AI-ready images.
   PHASE 0 STUB: phase 4 replaces the bodies. Keep the global name and the method signatures.
   ========================================================================== */
const SunLayer = (() => {
  /** Called by Render.syncMain on every frame of the main view (never in Compare).
   *  layer = { group, key } (a THREE.Group already in the scene, hidden in Compare and in the AI-ready image);
   *  state = Store.raw(); d = Derived.get(); kit = { syncLayer, clearGroup, materialFor, lineMaterial }.
   *  Returns true when the scene changed. */
  function update(layer, state, d, kit) { return false; }
  /** A finished sunHours result (plan section 3.6 "Output"), or null to clear it. */
  function setResult(result) { }
  function clear() { }
  /** The form changed after a compute: show "Out of date" and keep the old colors. */
  function markStale(stale = true) { }
  function info() { return { shown: false, stale: false, result: null }; }
  return { update, setResult, clear, markStale, info };
})();
