/* ==========================================================================
   TESTS: the first-visit tip  (docs/first-visit-tour-technical-plan.md section 4)
   FirstTip (build/shared/08x_tip.js) is armed with an in-memory store, so a ?test visit never touches the real localStorage. The card never
   shows by itself in ?test; the tests call show(). 06_start.js adds these tests to the SiteTests results.
   ========================================================================== */
async function runTipTests() {
  const results = [];
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); } });
  const orig = FirstTip.config();
  const arm = (store) => { FirstTip.init({ ...orig, store, auto: false }); return store; };
  const card = () => document.getElementById('firstTip');
  const KEY = `cmrlm.tip.${orig.tool}.v1`;
  try {
    await t('tip 1 ?test never shows the card by itself', () => eq([FirstTip.visible(), card() === null], [false, true]));
    await t('tip 2 show() builds a card with the tool title, the purpose and two Try lines', () => {
      arm(memory());
      const shown = FirstTip.show();
      const c = card();
      const lines = c ? [...c.querySelectorAll('.ftip-try li')].map((x) => x.textContent) : [];
      const title = c && c.querySelector('.ftip-title') ? c.querySelector('.ftip-title').textContent : '';
      const appTitle = document.querySelector('.app-title').textContent.trim();
      const labelled = c && document.getElementById(c.getAttribute('aria-labelledby')) === c.querySelector('.ftip-title');
      const out = eq([shown, title === orig.title, appTitle.startsWith(title), lines, !!labelled, c && c.getAttribute('role'), c && c.getAttribute('aria-modal')],
        [true, true, true, orig.tries, true, 'dialog', 'false']);
      FirstTip.hide({ remember: false });
      return out;
    });
    await t('tip 3 Got it hides the card and writes the key to the store', () => {
      const mem = arm(memory());
      FirstTip.show();
      const before = [FirstTip.seen(), mem.getItem(KEY)];
      const btn = [...card().querySelectorAll('button')].find((b) => b.textContent === 'Got it');
      btn.click();
      return eq([before, card() === null, FirstTip.visible(), FirstTip.seen(), mem.getItem(KEY) !== null], [[false, null], true, false, true, true]);
    });
    await t('tip 4 show() with the key set does nothing unless forced', () => {
      const mem = arm(memory());
      mem.setItem(KEY, 'seen');
      const plain = FirstTip.show();
      const none = card() === null;
      const forced = FirstTip.show({ force: true });
      const there = card() !== null;
      FirstTip.hide({ remember: false });
      return eq([plain, none, forced, there], [false, true, true, true]);
    });
    await t('tip 5 Escape hides the card and writes the key', () => {
      const mem = arm(memory());
      FirstTip.show();
      card().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return eq([card() === null, mem.getItem(KEY) !== null], [true, true]);
    });
    await t('tip 6 the buttons are 44 px tall and the card is not modal', () => {
      arm(memory());
      FirstTip.show();
      const hs = [...card().querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height));
      const out = eq([hs.length > 0 && hs.every((x) => x >= 44), card().querySelector('dialog') === null, document.querySelectorAll('dialog[open]').length], [true, true, 0]);
      FirstTip.hide({ remember: false });
      return out;
    });
    await t('tip 7 this tool has no help panel, so the card has no Open Help button', () => {
      arm(memory());
      FirstTip.show();
      const names = [...card().querySelectorAll('button')].map((b) => b.textContent);
      FirstTip.hide({ remember: false });
      return eq(names, ['Got it']);
    });
  } finally {
    FirstTip.init({ ...orig, store: orig.store, auto: false });
  }
  return results;
}

const SiteTipTests = { run: runTipTests };
