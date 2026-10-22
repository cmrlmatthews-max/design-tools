/* ==========================================================================
   PROJECT FILE  (docs/project-file-spec.md sections 8, 10 and 12; docs/tower-project-sun-plan.md section 7)
   `ProjectUI` is the glue between the page and src/shared/project.js (ProjectMod): ?project= load, autosave of the
   massing and sun sections, the Project menu, the project pill, Send, placement and context from site.
   Copy build/midrise/09b_project.js and change the tool details (plan section 7).
   PHASE 0 STUB: phase 3 replaces the bodies. Keep the global name and the method signatures used by the hooks:
   08_ui.js calls buildSite(ctx), has(), openMenu(anchor) and send(tool); 13_start.js calls start() and the
   __tower project hooks; 06c_site.js may call boundaryLocal() / boundaryKey().
   ========================================================================== */
const ProjectUI = (() => {
  const has = () => false;
  const hasSite = () => false;
  /** Called once by UI.buildPanel for the 'project' section (Site tab, first; shown only while has() is true).
   *  ctx = { bs, els, lenF, degS, get }. Returns { children, more }. */
  function buildSite(ctx) { return { children: [] }; }
  /** Called once from 13_start.js after UI.init(), Select.init() and SunUI.init(): reads ?project=. */
  function start() { }
  /** tool: 'plate' | 'facade' | 'grading' (the Export menu Send items). */
  function send(tool) { }
  function openMenu(anchor) { }
  const noop = () => {};
  return {
    has, hasSite, buildSite, start, send, openMenu,
    siteInfo: () => null, groundAt: () => null, boundaryKey: () => '', boundaryLocal: () => null, placement: () => null,
    openDoc: noop, close: noop, create: noop, rename: noop, flush: () => Promise.resolve(false), exportFile: noop, importFile: noop,
    centerOnSite: noop, contextFromSite: noop, markDirty: noop, askReplace: () => Promise.resolve(true), renderPill: noop,
    doc: () => null,
    status: () => ({ open: false, id: null, name: null, dirty: false, readOnly: false, replaceNeeded: false, confirmed: false }),
    configure: noop, restoreDefaults: noop, reset: noop,
  };
})();
