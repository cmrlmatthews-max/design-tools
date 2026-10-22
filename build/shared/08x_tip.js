/* ==========================================================================
   FIRST TIP  (shared by the seven tools; docs/first-visit-tour-technical-plan.md section 4)
   One small card the first time a tool opens: what the tool does and two things to try. It is not modal, so the tool stays usable
   behind it. Got it (or Escape) writes the key and removes the card, so the card shows once per tool per device.

     FirstTip.init({ tool, title, purpose, tries: [a, b], help: fn | null, store, auto })
     FirstTip.show({ force })   // builds and shows the card now; does nothing when the key is set, unless force is true. Returns true when shown.
     FirstTip.hide({ remember }) // removes the card and writes the key (remember: false removes it without writing)
     FirstTip.seen()            // true when the key is present in the store
     FirstTip.key()             // "cmrlm.tip.<tool>.v1"
     FirstTip.visible()         // true while the card is on screen
     FirstTip.element()         // the card element or null
     FirstTip.config()          // the options init was last given (tests use it to put things back)

   - tool is the key part ("plate"); title is the name on the card; purpose is one sentence; tries are two short lines; help is the function that opens the
     tool's help panel (null where the tool has none: no Open Help button then); store is { getItem, setItem } (default localStorage, wrapped in
     try/catch; a failed read means "not seen", a failed write is ignored).
   - Auto-show: init() schedules the card when the key is absent and the URL has no ?test. It waits two animation frames (the first rendered frame),
     then 1.2 s, and then until no toast is on screen (at most 6 s more), so it never covers the first toast of the page. auto: false skips this.
   - Place: absolute inside #viewport (or fixed on the body when the page has none), bottom right, above the view buttons, 320 px wide. Under 700 px
     wide it is a bottom sheet across the viewport, still above the view buttons.
   - Styles: one <style> element injected once. It reads the tool's tokens (--surface, --ink, --ink-2, --line, --accent, --shadow, --hit), with the
     light values as fallbacks, so light and dark both work.
   Globals used: none (the part builds its DOM itself).
   ========================================================================== */
const FirstTip = (() => {
  const VERSION = 1;
  const STYLE_ID = 'firstTipStyle';
  const CARD_ID = 'firstTip';
  const SETTLE_MS = 1200;          // after the first rendered frame
  const TOAST_WAIT_MS = 500;
  const TOAST_WAIT_MAX = 12;       // 12 x 500 ms = 6 s
  let cfg = null;
  let store = null;
  let card = null;
  let timer = 0;

  const CSS = `
.ftip { position: absolute; z-index: 18; right: 12px; bottom: calc(max(12px, env(safe-area-inset-bottom)) + 62px + var(--cmp-table-h, 0px));
  width: 320px; max-width: calc(100% - 24px); box-sizing: border-box; padding: 14px 14px 12px; border-radius: 12px;
  background: var(--surface, #fff); color: var(--ink, #1b1f24); border: 1px solid var(--line-2, var(--line, #c6cbd1));
  box-shadow: var(--shadow, 0 8px 24px rgba(16, 20, 26, .14)); font: 13px/1.4 var(--font, -apple-system, system-ui, sans-serif); }
.ftip.ftip-fixed { position: fixed; }
.ftip-kicker { margin: 0 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3, #848d98); }
.ftip-title { margin: 0 0 6px; font-size: 15px; font-weight: 650; line-height: 1.25; color: var(--ink, #1b1f24); }
.ftip-purpose { margin: 0 0 8px; color: var(--ink-2, #4e5763); }
.ftip-try { margin: 0 0 10px; padding: 0; list-style: none; display: grid; gap: 4px; }
.ftip-try li { display: grid; grid-template-columns: 14px 1fr; color: var(--ink, #1b1f24); }
.ftip-try li::before { content: "\\2022"; color: var(--accent, #23508f); font-weight: 700; }
.ftip-btns { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.ftip-btn { min-height: var(--hit, 44px); min-width: var(--hit, 44px); padding: 0 16px; border-radius: 9px; font: inherit; font-weight: 600; cursor: pointer;
  background: transparent; color: var(--ink, #1b1f24); border: 1px solid var(--line-2, #c6cbd1); }
.ftip-btn:hover { background: var(--surface-2, #eef0f2); }
.ftip-btn.ftip-ok { background: var(--accent, #23508f); color: var(--accent-ink, #fff); border-color: transparent; }
.ftip-btn.ftip-ok:hover { background: var(--accent, #23508f); filter: brightness(1.08); }
.ftip-btn:focus-visible { outline: 2px solid var(--accent, #23508f); outline-offset: 2px; }
@media (max-width: 699px) {
  .ftip { left: 12px; right: 12px; width: auto; max-width: none; padding-bottom: 12px; border-radius: 14px; }
  .ftip-btns .ftip-btn { flex: 1 1 0; }
}
@media (prefers-reduced-motion: no-preference) { .ftip { animation: ftipIn .16s ease-out; } }
@keyframes ftipIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

  const isTest = () => /[?&]test\b/.test(location.search);

  function defaultStore() {
    return {
      getItem: (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
      setItem: (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked: the tip shows again next time */ } },
    };
  }

  const key = () => `cmrlm.tip.${cfg ? cfg.tool : 'tool'}.v${VERSION}`;

  function seen() {
    if (!cfg || !store) return false;
    try { return store.getItem(key()) != null; } catch (e) { return false; }
  }

  function remember() {
    try { store.setItem(key(), 'seen'); } catch (e) { /* ignored */ }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.append(s);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function onDocKey(e) {
    if (e.key !== 'Escape' || !card) return;
    const a = document.activeElement;
    if (card.contains(e.target) || !a || a === document.body || card.contains(a)) hide();
  }

  function build() {
    const host = document.getElementById('viewport');
    const c = el('div', host ? 'ftip' : 'ftip ftip-fixed');
    c.id = CARD_ID;
    c.setAttribute('role', 'dialog');
    c.setAttribute('aria-modal', 'false');
    c.setAttribute('aria-labelledby', 'firstTipTitle');
    c.append(el('p', 'ftip-kicker', 'First time here'));
    const title = el('h2', 'ftip-title', cfg.title);
    title.id = 'firstTipTitle';
    c.append(title, el('p', 'ftip-purpose', cfg.purpose));
    const list = el('ul', 'ftip-try');
    list.setAttribute('aria-label', 'Try first');
    for (const line of cfg.tries) list.append(el('li', null, line));
    c.append(list);
    const btns = el('div', 'ftip-btns');
    if (typeof cfg.help === 'function') {
      const hb = el('button', 'ftip-btn ftip-help', 'Open Help');
      hb.type = 'button';
      hb.addEventListener('click', () => { hide(); try { cfg.help(); } catch (e) { /* the help panel is optional */ } });
      btns.append(hb);
    }
    const ok = el('button', 'ftip-btn ftip-ok', 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', () => hide());
    btns.append(ok);
    c.append(btns);
    c.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); hide(); } });
    return { c, host: host || document.body };
  }

  function show(opts = {}) {
    if (!cfg) return false;
    if (card) return true;
    if (seen() && !opts.force) return false;
    ensureStyle();
    const { c, host } = build();
    host.append(c);
    card = c;
    document.addEventListener('keydown', onDocKey, true);
    return true;
  }

  function hide(opts = {}) {
    clearTimeout(timer);
    timer = 0;
    document.removeEventListener('keydown', onDocKey, true);
    const had = !!card;
    if (card) {
      const hadFocus = card.contains(document.activeElement);
      card.remove();
      card = null;
      if (hadFocus) { try { document.body.focus(); } catch (e) { /* ignored */ } }
    }
    if (opts.remember !== false && cfg) remember();
    return had;
  }

  function schedule() {
    clearTimeout(timer);
    let tries = 0;
    const attempt = () => {
      timer = 0;
      if (seen() || card) return;
      const toasts = document.querySelectorAll('#toasts .toast').length;
      if (toasts && tries++ < TOAST_WAIT_MAX) { timer = setTimeout(attempt, TOAST_WAIT_MS); return; }
      show();
    };
    requestAnimationFrame(() => requestAnimationFrame(() => { timer = setTimeout(attempt, SETTLE_MS); }));
  }

  function init(opts) {
    if (!opts || !opts.tool || !opts.title) throw new Error('FirstTip.init needs tool and title');
    hide({ remember: false });
    cfg = {
      tool: String(opts.tool),
      title: String(opts.title),
      purpose: String(opts.purpose || ''),
      tries: Array.isArray(opts.tries) ? opts.tries.slice(0, 2).map(String) : [],
      help: typeof opts.help === 'function' ? opts.help : null,
      store: opts.store || null,
      auto: opts.auto !== false,
    };
    store = opts.store || defaultStore();
    if (cfg.auto && !isTest() && !seen()) schedule();
  }

  return {
    init, show, hide, seen, key,
    visible: () => !!card,
    element: () => card,
    config: () => (cfg ? { ...cfg } : null),
  };
})();
