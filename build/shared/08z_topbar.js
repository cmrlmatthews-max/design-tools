/* ==========================================================================
   TopBar: the Collapse all button and the Site / Building zoom buttons (docs/batch-fixes-technical-plan.md sections 4 and 5)
   Shared page part, placed after the UI part in all seven tools. The markup lives in each tool's body.html:
     #panelCollapse   the Collapse all button, in the panel head beside the tab row (the Site Model: at the top of the panel)
     #tbZoom          the zoom group in the top bar, with #tbZoomSite and #tbZoomBuilding
   TopBar.init wires them:
     TopBar.init({
       tool,                    // 'tower' | 'midrise' | 'parking' | 'facade' | 'grading' | 'plate' | 'site' (a label for tests)
       sections: () => ({ id: { setOpen(bool), isOpen() } }),   // the section controllers now on screen (UI.sectionCtl; the Site Model: its blocks)
       remember: (id, open) => {},                              // saves the open state of one section (UI.rememberSection)
       onSite: () => {},        // Site: frame the whole site square (Render.frameSite); null hides the button
       onBuilding: () => {},    // Building: fill the view with the hero building (Render.frameBuilding); null hides the button
     })
   Collapse all closes every section through its controller and remembers each one, so the choice survives a reload.
   The controllers are read when the button is pressed, not when init runs, because the panel can be rebuilt.
   ========================================================================== */
const TopBar = (() => {
  let cfg = null;
  const $ = (id) => document.getElementById(id);

  /** Closes every section and remembers each one as closed. Returns how many sections it closed. */
  function collapseAll() {
    const ctl = (cfg && typeof cfg.sections === 'function' && cfg.sections()) || {};
    let n = 0;
    for (const id of Object.keys(ctl)) {
      const c = ctl[id];
      if (!c || typeof c.setOpen !== 'function') continue;
      c.setOpen(false);
      if (cfg && typeof cfg.remember === 'function') cfg.remember(id, false);
      n++;
    }
    const scroller = $('panelScroll');
    if (scroller) scroller.scrollTop = 0;
    return n;
  }
  function zoomSite() { if (cfg && typeof cfg.onSite === 'function') cfg.onSite(); }
  function zoomBuilding() { if (cfg && typeof cfg.onBuilding === 'function') cfg.onBuilding(); }

  function init(o) {
    cfg = { tool: '', ...(o || {}) };
    const collapse = $('panelCollapse'), site = $('tbZoomSite'), building = $('tbZoomBuilding'), group = $('tbZoom');
    if (collapse) collapse.onclick = () => { collapseAll(); };
    if (site) { site.hidden = typeof cfg.onSite !== 'function'; site.onclick = zoomSite; }
    if (building) { building.hidden = typeof cfg.onBuilding !== 'function'; building.onclick = zoomBuilding; }
    if (group) group.hidden = (!site || site.hidden) && (!building || building.hidden);
  }

  /** For tests: what is wired and shown. */
  function info() {
    const vis = (id) => { const e = $(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
    return { tool: cfg ? cfg.tool : null, ready: !!cfg, collapse: vis('panelCollapse'), site: vis('tbZoomSite'), building: vis('tbZoomBuilding') };
  }

  return { init, collapseAll, zoomSite, zoomBuilding, info };
})();
