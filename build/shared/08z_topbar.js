/* ==========================================================================
   TopBar: the Collapse all button, the bottom bar and the Site / Building zoom buttons (docs/batch-fixes-technical-plan.md sections 4 and 5)
   Shared page part, placed after the UI part in all seven tools. The markup lives in each tool's body.html:
     #panelCollapse   the Collapse all button, in the panel head beside the tab row (the Site Model: at the top of the panel)
     #viewBar         the one bottom bar in the 3D view. Its groups, left to right (each has class vb-g):
                        #views (the view buttons), #tbZoom (#tbZoomSite and #tbZoomBuilding), #styleToggle (Model / Diagram),
                        #tbSnap (Snap and its menu; Tower, Mid-Rise, Parking), #tbHud (holds #tbMetrics)
                      A thin divider shows before every group except the first one that is on screen (class vb-lead marks that one).
     #tbMetrics       added here when the page has a #hud: hides or shows the metrics panel (key M; kept in localStorage); pressed while the panel shows
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
    initHud();
    initBar();
  }

  /* ---- The bottom bar: dividers, and an icon on each Model / Diagram button so the label can hide on narrow screens ---- */
  const STYLE_ICONS = {
    model: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    diagram: '<path d="M12 3a9 9 0 100 18 2.2 2.2 0 002-3 2.2 2.2 0 012-3h1.5A3.5 3.5 0 0021 11.5C21 6.8 17 3 12 3z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16" cy="10" r="1"/>',
    cutfill: '<path d="M3 15l5-5 4 3 4-6 5 8"/><path d="M3 19h18"/>',
  };
  const DOT_ICON = '<circle cx="12" cy="12" r="6"/>';
  function decorateStyle() {
    const seg = $('styleToggle');
    if (!seg) return;
    for (const b of seg.querySelectorAll('button')) {
      if (b.querySelector('.vb-txt')) continue;
      const text = b.textContent.trim();
      const span = document.createElement('span');
      span.className = 'vb-txt'; span.textContent = text;
      b.textContent = '';
      b.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" aria-hidden="true">' + (STYLE_ICONS[b.dataset.style] || DOT_ICON) + '</svg>');
      b.append(span);
      if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', text);
      if (!b.title) b.title = text;
    }
  }
  /** Marks the first group on screen with vb-lead, so the others get a divider on their left. */
  function syncBar() {
    const bar = $('viewBar');
    if (!bar) return;
    let lead = true;
    for (const g of bar.querySelectorAll(':scope > .vb-g')) {
      const shown = !g.hidden && g.querySelector(':scope > :not([hidden])') !== null;
      g.classList.toggle('vb-lead', shown && lead);
      if (shown) lead = false;
    }
  }
  function initBar() {
    const bar = $('viewBar');
    if (!bar) return;
    decorateStyle();
    syncBar();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => { decorateStyle(); syncBar(); }).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }
  }
  /** For tests: the ids of the controls inside the bottom bar, and the ids of the same controls found inside the top bar. */
  function barInfo() {
    const bar = $('viewBar'), top = $('topbar');
    const ids = ['views', 'tbZoomSite', 'tbZoomBuilding', 'styleToggle', 'tbSnap', 'tbMetrics'];
    const inBar = [], inTop = [], missing = [];
    for (const id of ids) {
      const e = $(id);
      if (!e) { missing.push(id); continue; }
      if (bar && bar.contains(e)) inBar.push(id);
      if (top && top.contains(e)) inTop.push(id);
    }
    return { bar: !!bar, inBar, inTop, missing, views: bar ? bar.querySelectorAll('#views button').length : 0 };
  }

  /* ---- Hide the metrics panel (#hud) fully. One choice for every tool, kept in localStorage. Key M toggles it. ---- */
  const HUD_KEY = 'cmrlm.hud.hidden';
  const readHidden = () => { try { return localStorage.getItem(HUD_KEY) === 'true'; } catch (e) { return false; } };
  const writeHidden = (v) => { try { localStorage.setItem(HUD_KEY, v ? 'true' : 'false'); } catch (e) { /* private mode: keep it for this visit */ } };
  function hudHidden() { const h = $('hud'); return !!h && h.dataset.hidden === 'true'; }
  function setHudHidden(hide, { remember = true } = {}) {
    const h = $('hud');
    if (!h) return false;
    h.dataset.hidden = hide ? 'true' : 'false';
    const b = $('tbMetrics');
    if (b) { b.setAttribute('aria-pressed', hide ? 'false' : 'true'); b.title = hide ? 'Show the metrics panel (M)' : 'Hide the metrics panel (M)'; }
    if (remember) writeHidden(hide);
    return true;
  }
  function initHud() {
    const h = $('hud'), group = $('tbHud') || $('tbZoom');
    if (!h || $('tbMetrics')) return;
    if (!document.getElementById('hudHideCss')) {
      const st = document.createElement('style');
      st.id = 'hudHideCss';
      st.textContent = '.hud[data-hidden="true"]{display:none !important}';
      document.head.appendChild(st);
    }
    if (group) {
      const b = document.createElement('button');
      b.className = 'btn tb-zbtn'; b.id = 'tbMetrics'; b.type = 'button'; b.setAttribute('aria-label', 'Show or hide the metrics panel');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg><span class="tb-ztxt">Metrics</span>';
      b.onclick = () => setHudHidden(!hudHidden());
      group.appendChild(b);
    }
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'm' && e.key !== 'M')) return;
      const t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      setHudHidden(!hudHidden());
    });
    setHudHidden(readHidden(), { remember: false });
  }

  /** For tests: what is wired and shown. */
  function info() {
    const vis = (id) => { const e = $(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
    return { tool: cfg ? cfg.tool : null, ready: !!cfg, collapse: vis('panelCollapse'), site: vis('tbZoomSite'), building: vis('tbZoomBuilding'), metrics: vis('tbMetrics'), hudHidden: hudHidden() };
  }

  return { init, collapseAll, zoomSite, zoomBuilding, info, barInfo, syncBar, setHudHidden, hudHidden };
})();
