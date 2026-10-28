/* ==========================================================================
   LEFT TOOL BAR
   A panel on the left of the 3D view for one tool's main list (Cade, October 28, 2026: Tower segments). It shows only
   while its tool sets content, and a button hides it. Open or closed is remembered per tool.
   API (ctx.leftbar):
     set(owner, { title, build(bodyEl) } | null)   show this tool's content, or clear it (null)
     refresh()                                      rebuild the body
     open(), close(), toggle(), isOpen()
   ========================================================================== */
export function createLeftbar({ h, ICONS, onResize }) {
  const el = document.getElementById('leftbar');
  const tab = document.getElementById('leftbarTab');
  const KEY = 'cmrlm.app.leftbar';
  let owner = null, spec = null;
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* this visit only */ } };
  const isOpen = () => !!owner && prefs[owner] !== false;

  function render() {
    if (!el || !tab) return;
    el.replaceChildren();
    if (!owner || !spec) { el.hidden = true; tab.hidden = true; document.documentElement.dataset.leftbar = 'none'; onResize && onResize(); return; }
    const open = isOpen();
    document.documentElement.dataset.leftbar = open ? 'open' : 'closed';
    el.hidden = !open;
    tab.hidden = open;
    tab.textContent = spec.title || 'Tools';
    tab.setAttribute('data-tip', `Show ${spec.title || 'the tool bar'}.`);
    tab.onclick = () => toggle();
    if (open) {
      const hide = h('button', { class: 'btn icon leftbar-hide', type: 'button', 'aria-label': `Hide ${spec.title || 'the tool bar'}`, 'data-tip': `Hide ${spec.title || 'the tool bar'}.`, onclick: () => toggle() });
      hide.innerHTML = ICONS.close || '';
      const body = h('div', { class: 'leftbar-body' });
      el.append(h('div', { class: 'leftbar-head' }, h('span', { class: 'leftbar-title' }, spec.title || ''), hide), body);
      try { spec.build(body); } catch (e) { console.error(e); body.append(h('p', { class: 'warn-row error' }, 'This list could not be drawn.')); }
    }
    onResize && onResize();
  }
  function set(id, s) { owner = s ? id : (owner === id ? null : owner); spec = s ? s : (owner ? spec : null); render(); }
  function toggle() { if (!owner) return; prefs[owner] = !isOpen(); save(); render(); }
  return { set, refresh: render, open: () => { if (owner) { prefs[owner] = true; save(); render(); } }, close: () => { if (owner) { prefs[owner] = false; save(); render(); } }, toggle, isOpen };
}
