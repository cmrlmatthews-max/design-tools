/* ==========================================================================
   PANELS
   The stack of collapsible panels at the right. In iPad portrait and on narrow screens the column becomes a bottom
   sheet with a grabber and three heights: peek, half, full. The 3D view keeps the space above the sheet.
   createPanels(el, { storageKey }) -> { set(groups), refresh(id), collapseAll(), toggleColumn(), isSheet(), ... }
   groups: [{ id, title, build(bodyEl), open = true, owner }]
   Markup inside #panels:
     <div class="panels-bar">  <span class="sheet-grab"></span> <span class="panels-label">Panels</span> <button class="btn icon panels-collapse"> </div>
     <div class="panels-scroll">
       <section class="panel" data-id data-owner data-open="true|false">
         <button class="panel-head" aria-expanded aria-controls> <span class="panel-chev">svg</span> <span class="panel-title">Title</span> </button>
         <div class="panel-body" id> ...built by group.build(bodyEl)... </div>
       </section> ...
     </div>
   State on <html>: data-panels="shown|hidden" (column mode), data-sheet="peek|half|full" (sheet mode), data-layout="column|sheet".
   CSS var on <html>: --sheet-h (the sheet height, px).
   A closed panel builds its body the first time it opens. A body that throws shows a short error line.
   ========================================================================== */
import { h, ICONS } from './ui-kit.js';

/** Sheet mode: narrow, or portrait on a touch screen (iPad portrait). Keep in step with shell.css. */
export const SHEET_QUERY = '(max-width: 819.98px), (orientation: portrait) and (pointer: coarse)';
const SNAPS = ['peek', 'half', 'full'];
const BAR_H = 44;              // the sheet bar (grabber + Collapse all)
const KEEP_VIEW = 120;         // px of 3D view kept above a full sheet

function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable: state is not kept */ } }

export function createPanels(el, { storageKey = 'cmrlm.app.panels' } = {}) {
  const root = document.documentElement;
  const mq = (() => { try { return window.matchMedia(SHEET_QUERY); } catch (e) { return null; } })();
  const prefs = readJSON(storageKey);                     // { open: { id: bool }, hidden: bool, snap: 'half' }
  prefs.open = prefs.open && typeof prefs.open === 'object' ? prefs.open : {};
  const save = () => writeJSON(storageKey, prefs);

  el.classList.add('panels');
  const grab = h('span', { class: 'sheet-grab', 'aria-hidden': 'true' });
  const collapseBtn = h('button', { class: 'btn icon panels-collapse', type: 'button', 'data-tip': 'Fold every panel.', 'aria-label': 'Collapse all panels', html: ICONS.collapse });
  const bar = h('div', { class: 'panels-bar', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Panels. Drag to resize the sheet.', tabindex: '-1' },
    grab, h('span', { class: 'panels-label' }, 'Panels'), collapseBtn);
  const scroll = h('div', { class: 'panels-scroll' });
  el.replaceChildren(bar, scroll);
  collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); collapseAll(); });

  let groups = [];
  const entries = new Map();                              // id -> { group, sec, head, body, built, dirty }

  /* ---- the panel stack --------------------------------------------------------------------------- */

  const isOpen = (g) => (Object.prototype.hasOwnProperty.call(prefs.open, g.id) ? !!prefs.open[g.id] : g.open !== false);

  function buildBody(ent) {
    ent.body.replaceChildren();
    try { ent.group.build(ent.body); } catch (e) {
      console.error('Panel failed to build:', ent.group.id, e);
      ent.body.append(h('p', { class: 'warn-row error' }, 'This panel could not be shown.'));
    }
    ent.built = true; ent.dirty = false;
  }

  function setOpen(ent, open, remember = true) {
    ent.sec.dataset.open = open ? 'true' : 'false';
    ent.head.setAttribute('aria-expanded', open ? 'true' : 'false');
    ent.body.hidden = !open;
    if (open && (!ent.built || ent.dirty)) buildBody(ent);
    if (remember) { prefs.open[ent.group.id] = !!open; save(); }
  }

  function makeSection(g) {
    const bodyId = `pnl-${String(g.id).replace(/[^\w-]/g, '_')}`;
    const head = h('button', { class: 'panel-head', type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId },
      h('span', { class: 'panel-chev', 'aria-hidden': 'true', html: ICONS.chevron }),
      h('span', { class: 'panel-title' }, g.title || ''));
    const body = h('div', { class: 'panel-body', id: bodyId, role: 'region', 'aria-label': g.title || '' });
    const sec = h('section', { class: 'panel', 'data-id': g.id, 'data-owner': g.owner || '' }, head, body);
    const ent = { group: g, sec, head, body, built: false, dirty: true };
    head.addEventListener('click', () => {
      const next = sec.dataset.open !== 'true';
      setOpen(ent, next);
      if (next && isSheet() && currentSnap() === 'peek') snapTo('half');
    });
    return ent;
  }

  /** Rebuilds the column from groups. Keeps the scroll position when the same panels come back. */
  function set(next) {
    const sameIds = groups.length && (next || []).map((g) => g.id).join('|') === groups.map((g) => g.id).join('|');
    const top = scroll.scrollTop;
    groups = (next || []).filter((g) => g && g.id != null);
    entries.clear();
    scroll.replaceChildren();
    for (const g of groups) {
      const ent = makeSection(g);
      entries.set(g.id, ent);
      scroll.append(ent.sec);
      setOpen(ent, isOpen(g), false);
    }
    scroll.scrollTop = sameIds ? top : 0;
    el.dataset.count = String(groups.length);
  }

  /** Rebuilds one panel body (and its title, which can carry a count). A closed panel rebuilds when it opens. */
  function refresh(id) {
    const ent = entries.get(id);
    if (!ent) return false;
    const titleEl = ent.head.querySelector('.panel-title');
    if (titleEl) titleEl.textContent = ent.group.title || '';
    if (ent.sec.dataset.open === 'true') buildBody(ent); else ent.dirty = true;
    return true;
  }
  /** Changes a panel's title without a rebuild (for example a warning count). */
  function setTitle(id, title) {
    const ent = entries.get(id);
    if (!ent) return;
    ent.group.title = title;
    const t = ent.head.querySelector('.panel-title');
    if (t) t.textContent = title;
  }

  function collapseAll() {
    entries.forEach((ent) => setOpen(ent, false, false));
    entries.forEach((ent) => { prefs.open[ent.group.id] = false; });
    save();
    scroll.scrollTop = 0;
  }
  function openPanel(id, open = true) {
    const ent = entries.get(id);
    if (!ent) return null;
    setOpen(ent, open);
    if (open && isSheet() && currentSnap() === 'peek') snapTo('half');
    if (open && ent.sec.scrollIntoView) { try { ent.sec.scrollIntoView({ block: 'nearest' }); } catch (e) { /* old browsers */ } }
    return ent.body;
  }

  /* ---- column and sheet --------------------------------------------------------------------------- */

  const isSheet = () => !!(mq && mq.matches);
  const currentSnap = () => (SNAPS.includes(prefs.snap) ? prefs.snap : 'half');

  function snapHeights() {
    const H = window.innerHeight || 800;
    const topbar = (document.getElementById('topbar') || {}).offsetHeight || 52;
    const dock = isSheet() ? ((document.getElementById('dock') || {}).offsetHeight || 0) : 0;
    const max = Math.max(BAR_H + 80, H - topbar - dock - KEEP_VIEW);
    return { peek: BAR_H, half: Math.min(max, Math.max(BAR_H + 120, Math.round(H * 0.42))), full: max };
  }

  let resizeRaf = 0;
  /** Tells the 3D view its box changed (scene.js listens to window resize and/or a ResizeObserver). */
  function nudgeResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      el.dispatchEvent(new CustomEvent('panels:resize', { bubbles: true }));
      try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
    });
  }

  function setSheetHeight(px) {
    root.style.setProperty('--sheet-h', `${Math.round(px)}px`);
    nudgeResize();
  }
  function snapTo(name, remember = true) {
    if (!SNAPS.includes(name)) name = 'half';
    if (remember) { prefs.snap = name; save(); }
    root.dataset.sheet = name;
    if (isSheet()) setSheetHeight(snapHeights()[name]);
  }

  /** Column mode: hides or shows the column. Sheet mode: peek, then back to the last open height. */
  function toggleColumn() {
    if (isSheet()) {
      if (currentSnap() === 'peek') snapTo(prefs.lastOpenSnap && prefs.lastOpenSnap !== 'peek' ? prefs.lastOpenSnap : 'half');
      else { prefs.lastOpenSnap = currentSnap(); snapTo('peek'); }
      return currentSnap() !== 'peek';
    }
    prefs.hidden = !prefs.hidden; save();
    applyLayout();
    return !prefs.hidden;
  }
  const isHidden = () => (isSheet() ? currentSnap() === 'peek' : !!prefs.hidden);

  function applyLayout() {
    const sheet = isSheet();
    root.dataset.layout = sheet ? 'sheet' : 'column';
    root.dataset.panels = !sheet && prefs.hidden ? 'hidden' : 'shown';
    root.dataset.sheet = currentSnap();
    bar.tabIndex = sheet ? 0 : -1;
    const dockEl = document.getElementById('dock');
    const tb = dockEl && dockEl.querySelector('.dock-tools');
    if (tb) tb.setAttribute('aria-orientation', sheet ? 'horizontal' : 'vertical');
    if (sheet) setSheetHeight(snapHeights()[currentSnap()]);
    else { root.style.removeProperty('--sheet-h'); nudgeResize(); }
  }

  /* ---- grabber drag (pointer events). The bar and the empty part of the dock start a drag. ---- */

  let drag = null;
  function startDrag(e) {
    if (!isSheet() || drag) return;
    if (e.button != null && e.button !== 0) return;
    const hs = snapHeights();
    drag = { id: e.pointerId, y0: e.clientY, h0: hs[currentSnap()], last: e.clientY, t: performance.now(), v: 0, moved: false, target: e.currentTarget };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    root.classList.add('sheet-dragging');
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 4) drag.moved = true;
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.v = (e.clientY - drag.last) / dt;                // px per ms, + = down
    drag.last = e.clientY; drag.t = now;
    if (!drag.moved) return;
    const hs = snapHeights();
    setSheetHeight(Math.min(hs.full, Math.max(hs.peek, drag.h0 - dy)));
    e.preventDefault();
  }
  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    root.classList.remove('sheet-dragging');
    try { d.target.releasePointerCapture(d.id); } catch (err) { /* ignore */ }
    if (cancelled) { snapTo(currentSnap(), false); return; }
    if (!d.moved) {                                       // a tap on the bar: peek <-> half
      if (e && e.target && e.target.closest && e.target.closest('button')) return;
      snapTo(currentSnap() === 'peek' ? 'half' : 'peek');
      return;
    }
    const hs = snapHeights();
    const hNow = Math.min(hs.full, Math.max(hs.peek, d.h0 - (d.last - d.y0)));
    let pick;
    if (Math.abs(d.v) > 0.5) {                            // a flick: the next height in its direction (SNAPS go low to high)
      pick = d.v < 0 ? (SNAPS.find((s) => hs[s] > hNow + 1) || 'full') : ([...SNAPS].reverse().find((s) => hs[s] < hNow - 1) || 'peek');
    } else {                                              // a slow drag: the nearest height
      pick = SNAPS.reduce((best, s) => (Math.abs(hs[s] - hNow) < Math.abs(hs[best] - hNow) ? s : best), 'half');
    }
    snapTo(pick);
  }
  function wireDrag(node, onlyBackground) {
    node.addEventListener('pointerdown', (e) => {
      if (onlyBackground && e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      if (!onlyBackground && e.target.closest && e.target.closest('button')) return;
      startDrag(e);
    });
    node.addEventListener('pointermove', moveDrag);
    node.addEventListener('pointerup', (e) => endDrag(e, false));
    node.addEventListener('pointercancel', (e) => endDrag(e, true));
    node.addEventListener('lostpointercapture', (e) => { if (drag && e.pointerId === drag.id) endDrag(e, false); });
  }
  wireDrag(bar, false);
  bar.addEventListener('click', (e) => {                  // a tap from a keyboard-less pointer is handled in endDrag
    if (e.detail === 0 && isSheet() && !e.target.closest('button')) snapTo(currentSnap() === 'peek' ? 'half' : 'peek');
  });
  bar.addEventListener('keydown', (e) => {
    if (!isSheet()) return;
    const i = SNAPS.indexOf(currentSnap());
    if (e.key === 'ArrowUp') { e.preventDefault(); snapTo(SNAPS[Math.min(2, i + 1)]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); snapTo(SNAPS[Math.max(0, i - 1)]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); snapTo(SNAPS[(i + 1) % 3]); }
  });
  const dockEl = document.getElementById('dock');
  if (dockEl) wireDrag(dockEl, true);

  if (mq) {
    const onChange = () => applyLayout();
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  window.addEventListener('resize', () => { if (isSheet() && !drag) { const hs = snapHeights(); root.style.setProperty('--sheet-h', `${hs[currentSnap()]}px`); } });
  window.addEventListener('orientationchange', () => setTimeout(applyLayout, 120));
  applyLayout();

  return {
    set, refresh, setTitle, collapseAll, toggleColumn, isSheet, isHidden,
    open: openPanel, snap: (name) => (name ? snapTo(name) : currentSnap()),
    ids: () => groups.map((g) => g.id), el,
  };
}
