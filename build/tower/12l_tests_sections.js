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


/* ==========================================================================
   TESTS: Collapse all and the Site / Building zoom buttons (docs/batch-fixes-technical-plan.md sections 4 and 5)
   Collapse all closes every panel section and remembers each one (the UI prefs), so a reload keeps them closed.
   Site frames a box that contains the site square (the model when no site is open); Building frames a box close to the model box.
   Both keep the camera direction (compared as unit vectors, within 0.001) and fit the box inside the view.
   The site tests open the in-memory fixture project and restore everything when they finish.
   ========================================================================== */
async function runTopBarTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const $ = (id) => document.getElementById(id);
  const frames = (n = 2) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const live = Render.ready();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  const savedSections = uiPrefs.sections === undefined ? undefined : JSON.parse(JSON.stringify(uiPrefs.sections));
  Options.holdAutosave(true);
  const mem = ProjectFixture.memory();
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
  const openSite = async () => {
    Store.replace(fillDefaults(defaultState()), { resetHistory: true });
    const doc = ProjectFixture.siteProject();
    ProjectMod.saveProject(mem, doc);
    ProjectUI.openDoc(doc);
    await wait(350);
    await frames(3);
  };
  const siteSquare = () => SiteLayer.frameBounds();
  const stored = () => { try { return JSON.parse(localStorage.getItem(UI_STORAGE_KEY)) || {}; } catch (e) { return {}; } };
  const freshProfile = () => { uiPrefs.sections = {}; saveUiPrefs(uiPrefs); UI.rebuildSections(); };
  const reload = () => { uiPrefs.sections = stored().sections; UI.rebuildSections(); };
  const accs = () => [...document.querySelectorAll('#sections section.acc')];
  const openIds = () => accs().filter((a) => a.dataset.open === 'true').map((a) => a.dataset.section);
  const dirOf = () => { const c = Render.camera(); c.updateMatrixWorld(true); return c.getWorldDirection(new THREE.Vector3()); };
  /** The corners of a framing box in normalized device coordinates (-1 .. 1) of the camera as it stands. */
  const ndcOf = (box) => {
    const c = Render.camera(); c.updateMatrixWorld(true); c.updateProjectionMatrix();
    const z0 = box.minZ || 0, H = Math.max(box.height || 0, z0 + 20);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [box.minX, box.maxX]) for (const y of [box.minY, box.maxY]) for (const z of [z0, H]) {
      const p = worldVec(x, y, z).project(c);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, x1, y0, y1, fill: Math.max(x1 - x0, y1 - y0) };
  };
  const inside = (n, slack = 0.02) => n.x0 >= -1 - slack && n.x1 <= 1 + slack && n.y0 >= -1 - slack && n.y1 <= 1 + slack;
  const contains = (outer, inner, tol = 0.5) => outer.minX <= inner.minX + tol && outer.maxX >= inner.maxX - tol && outer.minY <= inner.minY + tol && outer.maxY >= inner.maxY - tol;
  const sameDir = (a, b) => a.distanceTo(b) < 0.001;
  const dist = () => Render.info().distance;

  try {
    /* ---- Collapse all (section 4) ---- */
    await t('Z1. the Collapse all button sits in the panel head with a name, a touch-size target and a visible label', () => {
      const b = $('panelCollapse');
      if (!b) return 'missing #panelCollapse';
      const r = b.getBoundingClientRect();
      return eq([b.tagName, !!b.getAttribute('aria-label'), !b.hidden, r.height >= 40, !!b.closest('#panel'), b.textContent.trim()], ['BUTTON', true, true, true, true, 'Collapse all']);
    });
    await t('Z2. Collapse all closes every section, saves each one as closed, and a reload keeps them closed', () => {
      freshProfile();
      const ids = Object.keys(UI.sectionCtl);
      accs().filter((a) => !a.hidden).slice(0, 3).forEach((a) => a.querySelector('.acc-head').click());
      const before = openIds().length;
      $('panelCollapse').click();
      const closed = [openIds(), ids.filter((id) => UI.sectionCtl[id].isOpen())];
      const saved = ids.filter((id) => (stored().sections || {})[id] !== false);
      reload();
      return eq([before >= 3, closed, saved, openIds()], [true, [[], []], [], []]);
    });
    await t('Z3. after Collapse all a section the user opens stays open after a reload, and the others stay closed', () => {
      freshProfile();
      $('panelCollapse').click();
      const id = accs().find((a) => !a.hidden).dataset.section;
      document.querySelector(`#sections section.acc[data-section="${id}"] .acc-head`).click();
      reload();
      return eq(openIds(), [id]);
    });
    await t('Z4. Collapse all is harmless when every section is already closed (and scrolls the panel to its top)', () => {
      freshProfile();
      $('panelCollapse').click();
      $('panelCollapse').click();
      return eq([openIds(), $('panelScroll').scrollTop], [[], 0]);
    });

    /* ---- the zoom buttons (section 5) ---- */
    await t('Z5. the Site and Building buttons are in the top bar with names, touch-size targets and visible labels', () => {
      const s = $('tbZoomSite'), b = $('tbZoomBuilding');
      if (!s || !b) return 'missing zoom buttons';
      const hit = (e) => e.getBoundingClientRect().height >= 40;
      return eq([!!s.closest('#topbar'), !!b.closest('#topbar'), !!s.getAttribute('aria-label'), !!b.getAttribute('aria-label'), hit(s), hit(b), s.textContent.trim(), b.textContent.trim()], [true, true, true, true, true, true, 'Site', 'Building']);
    });
    await t('Z6. the buttons call the Render zoom functions (Site → frameSite, Building → frameBuilding)', () => {
      if (!live) return true;
      const origS = Render.frameSite, origB = Render.frameBuilding;
      const seen = [];
      Render.frameSite = () => { seen.push('site'); return origS(false); };
      Render.frameBuilding = () => { seen.push('building'); return origB(false); };
      try { $('tbZoomSite').click(); $('tbZoomBuilding').click(); } finally { Render.frameSite = origS; Render.frameBuilding = origB; }
      return eq(seen, ['site', 'building']);
    });
    await t('Z7. no site open: Site frames a box that contains the model, keeps the camera direction and fits the box in the view', async () => {
      if (!live) return true;
      Store.replace(fillDefaults(defaultState()), { resetHistory: true });
      await frames(3);
      Render.setView('axon', false);
      Render.camera().position.add(new THREE.Vector3(13, 4, -9));      // a view the presets do not make
      await frames(3);                                                   // the frame loop turns the camera to its target
      const d0 = dirOf();
      Render.frameSite(false);
      const box = Render.framedBox('site'), model = Derived.get().bounds.model, n = ndcOf(box);
      return eq([contains(box, model), sameDir(d0, dirOf()), inside(n), n.fill > 0.35], [true, true, true, true]);
    });
    await t('Z8. Building frames a box close to the model box, fits it in the view, keeps the direction, and is no farther than Site', async () => {
      if (!live) return true;
      Render.setView('axon', false);
      Render.frameSite(false);
      const dSite = dist(), zSite = Render.info().zoom;
      const d0 = dirOf();
      Render.frameBuilding(false);
      const box = Render.framedBox('building'), m = Derived.get().bounds.model, n = ndcOf(box);
      const span = Math.max(m.maxX - m.minX, m.maxY - m.minY);
      const slack = (span) => Math.max(8, 0.25 * span);
      const close = contains(box, m) === true && box.minX >= m.minX - slack(span) && box.maxX <= m.maxX + slack(span) && box.minY >= m.minY - slack(span) && box.maxY <= m.maxY + slack(span);
      const nearer = Render.cameraType() === 'persp' ? dist() <= dSite * 1.001 : Render.info().zoom >= zSite * 0.999;       // no site: the Site box can equal the model box
      return eq([close, sameDir(d0, dirOf()), inside(n), n.fill > 0.35, nearer], [true, true, true, true, true]);
    });
    await t('Z9. in an elevation (orthographic) Building and Site keep the direction and the orthographic camera', async () => {
      if (!live) return true;
      Render.setView('n', false);
      const d0 = dirOf();
      Render.frameBuilding(false);
      const nB = ndcOf(Render.framedBox('building')), d1 = dirOf(), type1 = Render.cameraType();
      Render.frameSite(false);
      const nS = ndcOf(Render.framedBox('site')), d2 = dirOf(), type2 = Render.cameraType();
      return eq([sameDir(d0, d1), sameDir(d0, d2), type1, type2, inside(nB), inside(nS), nB.fill > 0.35, nS.fill > 0.35], [true, true, 'ortho', 'ortho', true, true, true, true]);
    });
    await t('Z10. a preset button after a zoom button still works (the zoom leaves no preset pressed, the preset returns)', async () => {
      if (!live) return true;
      Render.frameBuilding(false);
      const pressedAfterZoom = document.querySelectorAll('#views button[aria-pressed="true"]').length;
      Render.setView('axon', false);
      const pressed = [...document.querySelectorAll('#views button[aria-pressed="true"]')].map((b) => b.dataset.view);
      return eq([pressedAfterZoom, pressed, Render.cameraType()], [0, ['axon'], 'persp']);
    });
    await t('Z11. a site open: Site frames a box that contains the whole site square and the model, keeps the direction, and fits it', async () => {
      if (!live) return true;
      await openSite();
      Render.setView('axon', false);
      Render.camera().position.add(new THREE.Vector3(-17, 6, 11));
      await frames(3);
      const d0 = dirOf();
      Render.frameSite(false);
      const sq = siteSquare(), box = Render.framedBox('site'), n = ndcOf(box);
      return eq([!!sq, contains(box, sq, 0.01), contains(box, Derived.get().bounds.model), sameDir(d0, dirOf()), inside(n), n.fill > 0.35], [true, true, true, true, true, true]);
    });
    await t('Z12. a site open: Building stays on the model (the site is far larger) and is much closer than Site', async () => {
      if (!live) return true;
      Render.setView('axon', false);
      Render.frameSite(false);
      const dSite = dist(), site = Render.framedBox('site');
      const d0 = dirOf();
      Render.frameBuilding(false);
      const box = Render.framedBox('building'), n = ndcOf(box), m = Derived.get().bounds.model;
      const small = (box.maxX - box.minX) < 0.5 * (site.maxX - site.minX);
      return eq([contains(box, m), small, sameDir(d0, dirOf()), inside(n), n.fill > 0.35, dist() < 0.6 * dSite], [true, true, true, true, true, true]);
    });
    await t('Z13. a site open: Collapse all and the zoom buttons still work with the project panel sections in place', () => {
      freshProfile();
      accs().filter((a) => !a.hidden).slice(0, 2).forEach((a) => a.querySelector('.acc-head').click());
      $('panelCollapse').click();
      return eq(openIds(), []);
    });
    /* ---- the core moved to the Plate Planner (docs/plate-planner-rework-plan.md 4.1, 8.2) ---- */
    await t('M1. the Metrics button and key M hide the metrics panel fully and show it again; the choice is kept', () => {
      const hud = document.getElementById('hud'), btn = document.getElementById('tbMetrics');
      if (!hud || !btn) return 'no Metrics button';
      const before = TopBar.hudHidden();
      TopBar.setHudHidden(false);
      btn.click();
      const hidden = [hud.dataset.hidden, hud.getClientRects().length, localStorage.getItem('cmrlm.hud.hidden'), btn.getAttribute('aria-pressed')];
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      const shown = [hud.dataset.hidden, hud.getClientRects().length > 0, localStorage.getItem('cmrlm.hud.hidden')];
      TopBar.setHudHidden(before);
      return eq([hidden, shown, !!btn.closest('#topbar'), btn.textContent.trim()], [['true', 0, 'true', 'false'], ['false', true, 'false'], true, 'Metrics']);
    });

    await t('C1. no Core card in the panel and no Core area or Efficiency row in the HUD; the HUD says the Plate Planner sets the core', () => {
      const titles = [...document.querySelectorAll('#sections section.acc')].map((a) => (a.querySelector('.acc-head') || a).textContent.trim());
      const labels = [...document.querySelectorAll('#hud dt')].map((e) => e.textContent.trim());
      return eq([
        'core' in UI.sectionCtl, titles.some((x) => /^core\b/i.test(x)), $('mCore'), $('mEff'),
        labels.some((x) => /core area|efficiency/i.test(x)), labels.includes('Net area (before core)'),
        $('hudCoreHelp') && $('hudCoreHelp').textContent,
      ], [false, false, null, null, false, true, 'The Plate Planner sets the core and the efficiency.']);
    });
    await t('C2. an old state with a core key loads without error; the key is dropped and every level has core null', () => {
      const old = Store.snapshot(); old.core = { mode: 'size', percent: 20, w: 400, d: 300 };
      const filled = fillDefaults(old);
      Store.replace(filled);
      const d = Derived.get();
      return eq([
        'core' in filled, 'core' in Store.raw(),
        TowerDerivedMod.towerDerived(Store.snapshot(), d, d.metrics).levels.every((l) => l.core === null), d.plates.every((p) => p.coreRect === null && p.coreArea === 0),
        d.warnings.some((w) => w.code === 'core-outside'), d.metrics.coreArea,
      ], [false, false, true, true, false, 0]);
    });
    await t('C3. net area is GFA minus mechanical area, and the HUD shows it', () => {
      const m = Derived.get().metrics;
      return eq([Math.abs(m.netArea - (m.gfa - m.mechanicalArea)) < 1e-6, $('mNet').textContent.includes(Units.formatArea(m.netArea))], [true, true]);
    });
  } finally {
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    if (typeof Select !== 'undefined' && Select.clear) Select.clear();
    if (savedSections === undefined) delete uiPrefs.sections; else uiPrefs.sections = savedSections;
    saveUiPrefs(uiPrefs);
    UI.rebuildSections();
    Store.replace(savedState); UI.setTab(savedTab, { remember: false });
    Options.holdAutosave(false);
  }
  return results;
}

runAllTests = ((base) => async function runAllWithTopBar() {
  const r = await base();
  const g = await runTopBarTests();
  const bad = g.filter((x) => !x.ok);
  r.results.push(...g);
  r.total += g.length;
  r.passed += g.length - bad.length;
  r.failed.push(...bad);
  console.log(`[tests] topbar ${g.length - bad.length}/${g.length} passed`, bad.length ? JSON.stringify(bad) : '');
  return r;
})(runAllTests);
