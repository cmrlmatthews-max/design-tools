/* ==========================================================================
   PIN PLACEMENT  (shared by the Tower, the Mid-Rise Generator and the Parking Deck; batch fixes plan section 2)
   A top-bar button right after the project pill: Pin placement / Unpin. While a project with a placement is open:
   - pinned: the drag gizmo and the rotation ring are off (PlacementGizmo.init gets locked: () => PinUI.pinned()), the site style
     switches to Solid, and with CONFIG.pinLocksOffsets the offset fields of the page are disabled too (08_ui.js reads PinUI.locksOffsets()).
     Typed X, Y, rotation and base fields stay editable; Center on site and Context from site still work.
   - Unpin: the gizmo is back and the site style goes to Glass.
   One click is one undo step (placement.pinned and view.siteStyle change together). placement.pinned is saved with the section
   (a missing value is false) and comes back when the project opens; 09b_project.js sets Glass on open when it is not pinned.

   API: PinUI.init({ tool, enabled }) builds the button once and wires it; sync() refreshes it; pinned() reads placement.pinned;
   setPinned(v) sets it (false when there is nothing to pin or nothing changes); available() is true while the button shows;
   locksOffsets() is true while the offset fields lock; button() is the element; info() is for tests.
   Globals used at call time: Store, ProjectUI, PlacementGizmo, Render, Toast, CONFIG, h, UI (optional: UI.studyMode hides the button).
   ========================================================================== */
const PinUI = (() => {
  const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6M10 3.5l-.7 6L6.5 12.5v1.5h11v-1.5l-2.8-3-.7-6M12 14v6.5"/></svg>';
  const CSS = '.tb-pin{flex:none}.tb-pin[hidden]{display:none}'
    + '.tb-pin[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}'
    + '.tb-pin[aria-pressed="true"]:hover{background:var(--accent-soft)}';
  let opts = { tool: '', enabled: () => true };
  let btn = null, textEl = null, wired = false;

  const placementObj = () => {
    try { const p = Store.raw().placement; return p && typeof p === 'object' ? p : null; } catch (e) { return null; }
  };
  /** True while placement.pinned is true. */
  const pinned = () => { const p = placementObj(); return !!p && p.pinned === true; };
  /** True while the button shows: a project with a placement is open, the page lets the building move, and it is not the Sun Study. */
  function available() {
    try {
      if (!ProjectUI.has() || !placementObj()) return false;
      if (typeof UI !== 'undefined' && UI && UI.studyMode) return false;
      return !!opts.enabled();
    } catch (e) { return false; }
  }
  /** CONFIG.pinLocksOffsets (default true, Cade's decision) and pinned: the page's offset fields are disabled. */
  const locksOffsets = () => {
    try { return CONFIG.pinLocksOffsets === true && pinned(); } catch (e) { return false; }
  };

  /** The open project has a site (the Tower and the Mid-Rise say hasSite(), the Parking Deck reads siteDerived()). */
  const siteOf = () => {
    try { return typeof ProjectUI.hasSite === 'function' ? !!ProjectUI.hasSite() : !!(typeof ProjectUI.siteDerived === 'function' && ProjectUI.siteDerived()); } catch (e) { return false; }
  };

  /** Pins (true) or unpins (false): placement.pinned and, with a site, the site style (Solid pinned, Glass unpinned) in ONE undo step. */
  function setPinned(v) {
    v = !!v;
    if (!placementObj() || !ProjectUI.has() || v === pinned()) return false;
    if (Store.gestureActive()) Store.commit();
    Store.set('placement.pinned', v, { live: false });
    try { if (siteOf()) Store.set('view.siteStyle', v ? 'solid' : 'glass', { live: false, merge: true }); } catch (e) { /* no site layer */ }
    sync();
    return true;
  }

  function sync() {
    if (btn) {
      const on = pinned(), show = available();
      btn.hidden = !show;
      btn.setAttribute('aria-pressed', String(on));
      if (textEl) textEl.textContent = on ? 'Unpin' : 'Pin placement';
      const tip = on ? 'Placement is pinned. Select to unpin and move the building again.' : 'Pin the placement: the drag handle and the rotation ring lock, and the site draws solid.';
      btn.title = tip;
      btn.setAttribute('aria-label', on ? 'Unpin the placement' : 'Pin the placement');
    }
    try { PlacementGizmo.sync(); } catch (e) { /* no gizmo on this page */ }
    try { if (Render.ready()) Render.requestRender(); } catch (e) { /* no 3D view */ }
  }

  function toggle() {
    const next = !pinned();
    if (!setPinned(next)) return;
    try { Toast.show(next ? 'Placement pinned. Select Unpin to move the building again.' : 'Placement unpinned.', '', 2600); } catch (e) { /* no toast */ }
  }

  /** Builds the button after the project pill (once) and keeps it in step with the Store. opts: { tool, enabled: () => bool }. */
  function init(o) {
    opts = { tool: '', enabled: () => true, ...(o || {}) };
    if (wired) { sync(); return true; }
    const pill = document.getElementById('projPill');
    if (!pill || !pill.parentNode) return false;
    wired = true;
    const style = document.createElement('style');
    style.id = 'pinStyle';
    style.textContent = CSS;
    document.head.append(style);
    textEl = h('span', { class: 'btn-text', id: 'tbPinText' }, 'Pin placement');
    btn = h('button', { class: 'btn has-text tb-pin', type: 'button', id: 'tbPin', hidden: true, 'aria-pressed': 'false', onclick: toggle },
      h('span', { html: PIN_SVG, style: 'display:contents' }), textEl);
    pill.after(btn);
    Store.subscribe((s, info) => { if (!info || !info.live) sync(); });
    sync();
    return true;
  }

  return {
    init, sync, pinned, setPinned, available, locksOffsets,
    button: () => btn,
    info: () => ({ pinned: pinned(), available: available(), hidden: btn ? btn.hidden : true, text: textEl ? textEl.textContent : '', pressed: btn ? btn.getAttribute('aria-pressed') : null, locksOffsets: locksOffsets() }),
  };
})();
