/* ==========================================================================
   SHADOW STUDY SHEET  (docs/tower-project-sun-plan.md sections 4.1 and 6.3)
   `SunStudy` makes the 3 x 3 shadow-range sheet: for each study date (rows) and time (columns), the Plan view with
   shadows, captured with ShotMod.captureView, laid out on one canvas with labels and the CMRLM footer.
   Downloads <option>-shadow-study.png. Restores the view after.
   PHASE 0 STUB: phase 4 replaces the bodies. Keep the global name and the method signatures.
   ========================================================================== */
const SunStudy = (() => {
  /** opts { deliver = true }. Resolves to { blob, width, height, panels } (or null while this is a stub). */
  function make(opts = {}) { return Promise.resolve(null); }
  function busy() { return false; }
  return { make, busy };
})();
