/* ==========================================================================
   DOCK
   The tool icons. A column at the left on wide screens; a row at the top of the bottom sheet in iPad portrait
   (shell.css moves it with a media query; the markup stays the same).
   createDock(el, { onSelect }) -> { setTools([{ id, label, icon }]), setActive(id), setExtras([{ id, label, icon, action }]) }
   Markup:
     <nav id="dock" class="dock">
       <div class="dock-tools" role="toolbar">  <button class="dock-btn" data-id aria-pressed> <span class="ico-wrap">svg</span> <span class="dock-tip">Label</span> </button> ... </div>
       <div class="dock-extras">                <button class="dock-btn extra" data-id> ... </button> ... </div>
     </nav>
   ========================================================================== */
import { h, ICONS } from './ui-kit.js';

const LONG_PRESS_MS = 450;

export function createDock(el, { onSelect } = {}) {
  el.classList.add('dock');
  el.setAttribute('aria-label', 'Tools');
  const toolsEl = h('div', { class: 'dock-tools', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' });
  const extrasEl = h('div', { class: 'dock-extras' });
  el.replaceChildren(toolsEl, extrasEl);
  let active = null;

  /** One dock button: icon plus a tooltip label. A long press on touch shows the label. */
  function button(item, extra) {
    const tip = h('span', { class: 'dock-tip', role: 'tooltip' }, item.label);
    const btn = h('button', {
      class: `dock-btn${extra ? ' extra' : ''}`, type: 'button', 'data-id': item.id,
      'aria-label': item.label, 'aria-pressed': extra ? null : 'false',
    }, h('span', { class: 'ico-wrap', 'aria-hidden': 'true', html: ICONS[item.icon] || ICONS.more }), tip);
    let timer = 0, longShown = false;
    const hideTip = () => { clearTimeout(timer); btn.classList.remove('show-tip'); };
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      longShown = false;
      clearTimeout(timer);
      timer = setTimeout(() => { longShown = true; btn.classList.add('show-tip'); }, LONG_PRESS_MS);
    });
    btn.addEventListener('pointerup', () => { clearTimeout(timer); if (longShown) setTimeout(hideTip, 900); });
    btn.addEventListener('pointercancel', hideTip);
    btn.addEventListener('pointerleave', () => { clearTimeout(timer); if (!longShown) btn.classList.remove('show-tip'); });
    btn.addEventListener('contextmenu', (e) => { if (longShown) e.preventDefault(); });
    btn.addEventListener('click', (e) => {
      if (longShown) { e.preventDefault(); longShown = false; return; }   // a long press only shows the label
      if (extra) { if (typeof item.action === 'function') item.action(e); }
      else if (onSelect) onSelect(item.id);
    });
    return btn;
  }

  /** Arrow keys move the focus along the dock (both orientations). */
  el.addEventListener('keydown', (e) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const list = [...el.querySelectorAll('.dock-btn')].filter((b) => !b.hidden);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    let n = i;
    if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    else n = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[n].focus();
  });

  function setTools(tools) {
    toolsEl.replaceChildren(...(tools || []).map((t) => button(t, false)));
    setActive(active);
  }
  function setActive(id) {
    active = id || null;
    toolsEl.querySelectorAll('.dock-btn').forEach((b) => {
      const on = b.dataset.id === active;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('active', on);
    });
    el.dataset.active = active || '';
  }
  function setExtras(extras) {
    extrasEl.replaceChildren(...(extras || []).map((x) => button(x, true)));
  }

  return { setTools, setActive, setExtras, el };
}
