/* ==========================================================================
   TOOL: plates (view only, docs/shell-plan.md section 9.5)
   The Plate Planner stays its own page. In the shell its units and cores are drawn by core/derived.js (layers 'units'
   and 'cores', owner 'plates'), so this module adds no layer, no panel and no dock icon. It only gives the selection
   card its "Open Plate Planner" link (../plate/?project=<id>).
   ========================================================================== */

function openPlanner(ctx) {
  let doc = null;
  try { doc = ctx && ctx.project ? ctx.project.doc() : null; } catch (e) { doc = null; }
  if (!doc || !doc.id) return;
  try { if (ctx.project.flush) ctx.project.flush(); } catch (e) { /* the save on pagehide still runs */ }
  window.location.href = `../plate/?project=${encodeURIComponent(doc.id)}`;
}

export default {
  id: 'plates',
  section: 'plates',
  label: 'Plate Planner',
  icon: 'plates',
  order: 90,
  dock: false,
  async init() {},
  activate() {},
  deactivate() {},
  panels() { return []; },
  layers() { return []; },        // core/derived.js draws 'units' and 'cores'
  metrics() { return []; },
  warnings() { return []; },
  onProject() {},
  exports() { return []; },
  card(item, ctx) {
    let doc = null;
    try { doc = ctx && ctx.project ? ctx.project.doc() : null; } catch (e) { doc = null; }
    if (!doc || !doc.id) return [];
    return [];
  },
};
