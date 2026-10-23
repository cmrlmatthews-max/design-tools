/* ==========================================================================
   TESTS: collapsed panel sections (docs/site-base-style-technical-plan.md section 4)
   Every panel section starts collapsed on a fresh profile. A click on a section title opens it and saves the choice in the UI prefs
   (localStorage key plate.ui.v1, prefs.sections); a rebuild of the panel from the saved prefs (a simulated reload) brings the
   choice back.
   The tests restore the UI prefs and the panel when they finish. runAllTests is extended at the end of this file.
   ========================================================================== */
async function runSectionTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const $ = (id) => document.getElementById(id);
  const frames = (n = 2) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  const savedSections = uiPrefs.sections === undefined ? undefined : JSON.parse(JSON.stringify(uiPrefs.sections));
  Options.holdAutosave(true);
  const accs = () => [...document.querySelectorAll('#sections section.acc')];
  const openIds = () => accs().filter((a) => a.dataset.open === 'true').map((a) => a.dataset.section);
  const stored = () => { try { return JSON.parse(localStorage.getItem(UI_STORAGE_KEY)) || {}; } catch (e) { return {}; } };
  /** A fresh profile: no remembered choice. The panel is rebuilt from the prefs, as at load. */
  const freshProfile = () => { uiPrefs.sections = {}; saveUiPrefs(uiPrefs); UI.rebuildSections(); };
  /** A reload: the prefs are read again from localStorage and the panel is rebuilt from them. */
  const reload = () => { uiPrefs.sections = stored().sections; UI.rebuildSections(); };
  const firstShown = () => accs().find((a) => !a.hidden);

  try {
    await t('S1. every panel section starts collapsed on a fresh profile (and there are sections to collapse)', () => {
      freshProfile();
      const all = accs();
      const ctl = Object.keys(UI.sectionCtl);
      return eq([all.length >= 8, all.length === ctl.length, openIds(), ctl.filter((id) => UI.sectionCtl[id].isOpen())], [true, true, [], []]);
    });
    await t('S2. a collapsed section keeps its controls in the page, hidden by the style sheet (value tests still see them)', () => {
      freshProfile();
      const acc = firstShown();
      const body = acc.querySelector('.acc-body');
      const rendered = getComputedStyle(body).display !== 'none';
      return eq([acc.dataset.open, !!body.querySelector('input, button, select, textarea'), rendered], ['false', true, false]);
    });
    await t('S3. a click on a section title opens it and saves the choice under the tool UI key; a second click closes it and saves that', () => {
      freshProfile();
      const acc = firstShown(), id = acc.dataset.section;
      acc.querySelector('.acc-head').click();
      const afterOpen = [acc.dataset.open, (stored().sections || {})[id]];
      acc.querySelector('.acc-head').click();
      const afterClose = [acc.dataset.open, (stored().sections || {})[id]];
      return eq([afterOpen, afterClose], [['true', true], ['false', false]]);
    });
    await t('S4. an open section is open again after a simulated reload, and the other sections stay collapsed', () => {
      freshProfile();
      const ids = accs().filter((a) => !a.hidden).map((a) => a.dataset.section);
      const a = ids[0], b = ids[ids.length - 1];
      document.querySelector(`#sections section.acc[data-section="${a}"] .acc-head`).click();
      document.querySelector(`#sections section.acc[data-section="${b}"] .acc-head`).click();
      reload();
      return eq([new Set(openIds())].map((s) => [...s].sort()), [[a, b].sort()]);
    });
    await t('S5. a section the user closed stays closed after a reload (the saved choice wins over the default)', () => {
      freshProfile();
      const id = firstShown().dataset.section;
      const head = () => document.querySelector(`#sections section.acc[data-section="${id}"] .acc-head`);
      head().click(); reload();
      const reopened = openIds().includes(id);
      head().click(); reload();
      return eq([reopened, openIds().includes(id), (stored().sections || {})[id]], [true, false, false]);
    });
    await t('S6. the HUD and the selection card are not panel sections', () => {
      const hud = $('hud'), card = $('selection-card');
      return eq([!!hud && !hud.closest('.acc'), !card || !card.closest('.acc')], [true, true]);
    });
    await t('S7. the UI prefs key is this tool\'s own (plate.ui.v1)', () => eq(UI_STORAGE_KEY, 'plate.ui.v1'));

  } finally {
    try { const p = document.querySelector('#aiPanel'); if (p && typeof Prompts !== 'undefined' && Prompts.isOpen()) Prompts.close(); } catch (e) { /* no prompt panel */ }
    if (savedSections === undefined) delete uiPrefs.sections; else uiPrefs.sections = savedSections;
    saveUiPrefs(uiPrefs);
    UI.rebuildSections();
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
  }
  return results;
}

/* Extend runAllTests with the section tests (the other test files stay as they are). */
runAllTests = ((base) => async function runAllWithSections() {
  const r = await base();
  const g = await runSectionTests();
  const bad = g.filter((x) => !x.ok);
  r.results.push(...g);
  r.total += g.length;
  r.passed += g.length - bad.length;
  r.failed.push(...bad);
  console.log(`[tests] sections ${g.length - bad.length}/${g.length} passed`, bad.length ? JSON.stringify(bad) : '');
  return r;
})(runAllTests);
