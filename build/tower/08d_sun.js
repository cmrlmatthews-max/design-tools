/* ==========================================================================
   SUN UI  (docs/tower-project-sun-plan.md sections 4.1, 5.3 and 3.5)
   `SunUI` builds the View tab Sun section (it replaces the schema 1 buildSun), drives the study
   (date, time, place, time zone -> state.view.sun through SolarMod), Play, and the sun-hours controls and
   compute loop (SunHoursMod, in slices; SunLayer draws the result). Writes state.sun and state.view.sun only.
   PHASE 0 STUB: phase 4 replaces the bodies. Keep the global name and the method signatures.
   ========================================================================== */
const SunUI = (() => {
  /** Called once by UI.buildPanel for the 'sun' section. ctx = { bs, els, degS, get, legacy } where legacy() is the
   *  schema 1 section (the azimuth and altitude sliders, for Manual mode). Returns { children, more }. */
  function build(ctx) { return ctx.legacy(); }
  /** Called once from 13_start.js after UI.init() and before ProjectUI.start(). */
  function init() { }
  /** For tests and the __tower hooks. */
  function info() { return { mode: 'manual', stub: true }; }
  function compute(opts) { return Promise.resolve(null); }
  function cancel() { }
  function play(on) { }
  return { build, init, info, compute, cancel, play };
})();
