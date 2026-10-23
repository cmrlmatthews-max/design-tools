/* ==========================================================================
   TESTS: collapsed panel sections and the prompt panel (docs/site-base-style-technical-plan.md section 4)
   Every panel section starts collapsed on a fresh profile. A click on a section title opens it and saves the choice in the UI prefs
   (localStorage key towergen.ui.v1, prefs.sections); a rebuild of the panel from the saved prefs (a simulated reload) brings the
   choice back.
   The prompt panel has no group tabs and no dropdowns: one Prompt chip row (Hero render first, My prompts last) and a chip row
   for each field the prompt uses.
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
  const savedPrompts = uiPrefs.prompts === undefined ? undefined : JSON.parse(JSON.stringify(uiPrefs.prompts));
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
    await t('S7. the UI prefs key is this tool\'s own (towergen.ui.v1)', () => eq(UI_STORAGE_KEY, 'towergen.ui.v1'));

    /* ---- the prompt panel (section 4.2): no group tabs, no dropdowns, chip rows ---- */
    const openPanel = async () => { uiPrefs.prompts = {}; saveUiPrefs(uiPrefs); Prompts.open(); Prompts.render(); await frames(2); };
    const panelRows = () => [...document.querySelectorAll('#aiBody .ai-row-label')].map((l) => l.textContent);
    await t('P1. the prompt panel has no select elements and no group tabs (Hero render, a time prompt, My prompts, the editor)', async () => {
      await openPanel();
      const count = () => [document.querySelectorAll('#aiPanel select').length, document.querySelectorAll('#aiPanel [role="tab"], #aiPanel .ai-tabs').length];
      const out = [count()];
      Prompts.select('time', 'time-golden-hour'); Prompts.render(); out.push(count());
      $('aiMine').click(); out.push(count());
      $('aiNew').click(); out.push(count(), !!$('aiEditTitle'));
      Prompts.cancelEditing(); Prompts.select('hero', PromptsMod.PROMPTS[0].id); Prompts.close();
      return eq(out, [[0, 0], [0, 0], [0, 0], [0, 0], true]);
    });
    await t('P2. Hero render is the first chip of the Prompt row, it is selected on a fresh profile, and My prompts is the last chip', async () => {
      await openPanel();
      const chips = [...$('aiPromptRow').children];
      const out = [chips[0].textContent, chips[0].getAttribute('aria-pressed'), chips[0].dataset.id, chips.filter((c) => c.getAttribute('aria-pressed') === 'true').length, chips[chips.length - 1].id, chips[chips.length - 1].textContent];
      Prompts.close();
      return eq(out, ['Hero render', 'true', 'hero-render', 1, 'aiMine', 'My prompts']);
    });
    await t('P3. the Prompt row has one chip for every built-in prompt in library order, then My prompts', async () => {
      await openPanel();
      const ids = [...$('aiPromptRow').children].map((c) => c.dataset.id).filter(Boolean);
      Prompts.close();
      return eq(ids, PromptsMod.PROMPTS.map((p) => p.id));
    });
    await t('P4. the Hero render shows chip rows Time, Material and Season (the fields it uses), one chip pressed in each, and no Context row', async () => {
      await openPanel();
      const rows = panelRows();
      const pressed = ['time', 'material', 'season'].map((k) => $(`aiField-${k}`) ? $(`aiField-${k}`).querySelectorAll('[aria-pressed="true"]').length : -1);
      const hasContext = !!$('aiField-location');
      Prompts.close();
      return eq([rows.filter((r) => r !== 'Prompt'), pressed, hasContext], [['Time', 'Material', 'Season'], [1, 1, 1], false]);
    });
    await t('P5. a row appears only when the selected prompt uses that field', async () => {
      await openPanel();
      const bad = [];
      for (const p of PromptsMod.PROMPTS) {
        Prompts.select('lib', p.id); Prompts.render();
        const shown = [...document.querySelectorAll('#aiBody .ai-fields [data-field]')].map((g) => g.dataset.field).sort();
        const want = [...(p.uses || [])].sort();
        if (JSON.stringify(shown) !== JSON.stringify(want)) bad.push(`${p.id}: ${shown} vs ${want}`);
      }
      Prompts.select('lib', PromptsMod.PROMPTS[0].id); Prompts.close();
      return eq(bad, []);
    });
    await t('P6. a field chip changes the preview text and is remembered for that prompt (not for the others)', async () => {
      await openPanel();
      const before = $('aiPreview').value;
      const row = $('aiField-time');
      const other = [...row.children].find((c) => c.getAttribute('aria-pressed') !== 'true');
      other.click();
      const after = $('aiPreview').value;
      Prompts.select('lib', PromptsMod.PROMPTS[1].id); Prompts.render();
      Prompts.select('lib', PromptsMod.PROMPTS[0].id); Prompts.render();
      const back = $('aiField-time').querySelector('[aria-pressed="true"]');
      const out = [before !== after, !!back && back.dataset.value === other.dataset.value, ((uiPrefs.prompts.fields || {})[PromptsMod.PROMPTS[0].id] || {}).time === other.dataset.value];
      Prompts.close();
      return eq(out, [true, true, true]);
    });
    await t('P7. the My prompts chip opens a row with a New prompt chip; New prompt opens the editor with checkboxes (no select), Cancel returns', async () => {
      await openPanel();
      const before = !!$('aiCustomRow');
      $('aiMine').click();
      const row = !!$('aiCustomRow'), newChip = !!$('aiNew');
      $('aiNew').click();
      const editor = [!!$('aiEditTitle'), !!$('aiEditTemplate'), document.querySelectorAll('#aiPanel .ai-uses input[type="checkbox"]').length > 0, document.querySelectorAll('#aiPanel select').length];
      Prompts.cancelEditing();
      const back = [Prompts.editing(), !!$('aiNew')];
      Prompts.select('lib', PromptsMod.PROMPTS[0].id); Prompts.render(); Prompts.close();
      return eq([before, row, newChip, editor, back], [false, true, true, [true, true, true, 0], [null, true]]);
    });
    await t('P8. the Hero render is a built-in prompt: Duplicate to edit shows, Delete and Edit do not', async () => {
      await openPanel();
      const out = [!!$('aiDuplicate'), !!$('aiDelete'), !!$('aiEdit'), Prompts.allPrompts().filter((p) => p.id === 'hero-render').length];
      Prompts.close();
      return eq(out, [true, false, false, 1]);
    });
    await t('P9. the panel keeps the two steps (Save AI-ready image, Copy prompt), the From your design chips and the preview', async () => {
      await openPanel();
      const out = [$('aiStepImage').textContent, $('aiStepCopy').textContent, document.querySelectorAll('#aiAuto .ai-chip').length > 0, !!$('aiPreview') && $('aiPreview').value.length > 100];
      Prompts.close();
      return eq(out, ['1. Save AI-ready image', '2. Copy prompt', true, true]);
    });

  } finally {
    try { const p = document.querySelector('#aiPanel'); if (p && typeof Prompts !== 'undefined' && Prompts.isOpen()) Prompts.close(); } catch (e) { /* no prompt panel */ }
    if (savedSections === undefined) delete uiPrefs.sections; else uiPrefs.sections = savedSections;
    if (savedPrompts === undefined) delete uiPrefs.prompts; else uiPrefs.prompts = savedPrompts;
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
