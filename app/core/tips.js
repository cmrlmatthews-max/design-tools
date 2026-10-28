/* ==========================================================================
   TIPS
   A short description pops up for a button (Cade, October 28, 2026: the app is minimal, so every button explains itself).

   Source of the text: data-tip on the element (or its title, which this module moves to data-tip, so the browser's own
   slow tooltip does not show twice). An optional data-tip-key adds a key hint, for example "D".

   How it shows:
   - Mouse: rest on a button for 0.45 s. Moving to the next button shows its tip at once.
   - Apple Pencil hover (iPad Pro with Pencil Pro): same as the mouse. The Pencil hovers over the glass.
   - Finger: press and hold a button for 0.5 s. The tip shows and the button does NOT act on that press.
   ========================================================================== */
const SHOW_MS = 450, HOLD_MS = 500, WARM_MS = 600, MOVE_PX = 8, TOUCH_LINGER_MS = 1800;

export function initTips(root = document) {
  const doc = root.ownerDocument || root;
  const tip = doc.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.append(tip);

  let showTimer = 0, hideTimer = 0, warmUntil = 0, current = null;
  let hold = null;            // { el, x, y, timer, shown }
  let swallowClick = false;

  /** The element that carries a tip, from an event target. Moves a title into data-tip. */
  function tipTarget(node) {
    const el = node && node.closest ? node.closest('[data-tip], [title]') : null;
    if (!el || el.closest('.tip')) return null;
    if (el.hasAttribute('title')) {
      const t = el.getAttribute('title');
      el.removeAttribute('title');
      if (t && !el.hasAttribute('data-tip')) el.setAttribute('data-tip', t);
      if (!el.hasAttribute('aria-label') && t && !el.textContent.trim()) el.setAttribute('aria-label', t);
    }
    return el.getAttribute('data-tip') ? el : null;
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    tip.style.left = '0px'; tip.style.top = '0px';
    const w = tip.offsetWidth, hgt = tip.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(vw - w - 8, x));
    const below = r.bottom + 8 + hgt <= vh - 8 && r.top < vh / 2;
    const y = below ? r.bottom + 8 : Math.max(8, r.top - hgt - 8);
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
    tip.dataset.side = below ? 'below' : 'above';
  }

  function show(el) {
    clearTimeout(showTimer); clearTimeout(hideTimer);
    const text = el.getAttribute('data-tip');
    if (!text || !el.isConnected) return;
    tip.replaceChildren();
    tip.append(doc.createTextNode(text));
    const key = el.getAttribute('data-tip-key');
    if (key) { const k = doc.createElement('kbd'); k.textContent = key; tip.append(k); }
    tip.hidden = false;
    place(el);
    tip.classList.add('on');
    current = el;
  }

  function hide({ warm = true } = {}) {
    clearTimeout(showTimer);
    if (!current && tip.hidden) return;
    if (warm) warmUntil = Date.now() + WARM_MS;
    current = null;
    tip.classList.remove('on');
    tip.hidden = true;
  }

  /* ---- mouse and Pencil hover ---- */
  doc.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = tipTarget(e.target);
    if (!el || el === current) return;
    clearTimeout(showTimer);
    if (current || Date.now() < warmUntil) show(el);
    else showTimer = setTimeout(() => show(el), SHOW_MS);
  }, true);
  doc.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const el = tipTarget(e.target);
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    clearTimeout(showTimer);
    if (current === el) hide();
  }, true);

  /* ---- finger: press and hold ---- */
  doc.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') { hide({ warm: false }); return; }
    const el = tipTarget(e.target);
    if (!el) { hide({ warm: false }); return; }
    if (hold) clearTimeout(hold.timer);
    hold = { el, x: e.clientX, y: e.clientY, shown: false, timer: setTimeout(() => {
      if (!hold) return;
      hold.shown = true;
      swallowClick = true;
      show(el);
    }, HOLD_MS) };
  }, true);
  doc.addEventListener('pointermove', (e) => {
    if (!hold || e.pointerType !== 'touch') return;
    if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_PX) { clearTimeout(hold.timer); hold = null; }
  }, true);
  const endHold = (e) => {
    if (!hold || e.pointerType !== 'touch') return;
    clearTimeout(hold.timer);
    if (hold.shown) { clearTimeout(hideTimer); hideTimer = setTimeout(() => hide({ warm: false }), TOUCH_LINGER_MS); }
    hold = null;
  };
  doc.addEventListener('pointerup', endHold, true);
  doc.addEventListener('pointercancel', endHold, true);
  // A press that showed a tip does not press the button.
  doc.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault(); e.stopPropagation();
  }, true);
  // The long press must not open the iPad text callout or a context menu on a button.
  doc.addEventListener('contextmenu', (e) => { if (tipTarget(e.target) && e.pointerType !== 'mouse') e.preventDefault(); }, true);

  /* ---- hide on anything that moves the page ---- */
  doc.addEventListener('keydown', () => hide({ warm: false }), true);
  doc.defaultView.addEventListener('scroll', () => hide({ warm: false }), true);
  doc.defaultView.addEventListener('resize', () => hide({ warm: false }));
  doc.defaultView.addEventListener('blur', () => hide({ warm: false }));

  return { show, hide, element: tip };
}
