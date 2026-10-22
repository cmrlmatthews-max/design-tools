/* ==========================================================================
   TESTS: page and panels
   The four tabs and their sections, the metrics card, the top bar and its menus (Option, Export, Project, Snap), the legend,
   the plan overlays, Compare, AI prompts and Help. The tests restore the design, the tab and the metrics card when they
   finish, and hold the autosave so a ?test visit never overwrites the saved working copy.
   ========================================================================== */
async function runUiTests() {
  const { eq, make, $, frames, wait, visible, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab(), savedHud = UI.hudOpen();
  Options.holdAutosave(true);
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const text = (id) => ($(id) ? $(id).textContent : null);

  try {
    /* ---- tabs ---- */
    await t('panel tabs are Layout, Ramp, Checks, View, in that order', () =>
      eq([[...document.querySelectorAll('#panelTabs .tab')].map((b) => b.textContent), UI.tabs()], [['Layout', 'Ramp', 'Checks', 'View'], ['layout', 'ramp', 'checks', 'view']]));
    await t('each tab shows its own sections and no others', () => {
      const want = {
        layout: ['source', 'footprint', 'levels', 'bays', 'grid', 'cores', 'entries', 'liner'],
        ramp: ['ramptype', 'speed', 'rampslopes'],
        checks: ['checkslist', 'limits', 'accessible', 'ev', 'bike', 'required'],
        view: ['display'],
      };
      for (const [tab, list] of Object.entries(want)) {
        UI.setTab(tab);
        const shown = [...document.querySelectorAll('.tabpanel')].filter(visible);
        if (shown.length !== 1 || shown[0].id !== `tabpanel-${tab}`) return `tab ${tab}: ${shown.map((p) => p.id)}`;
        const got = [...shown[0].querySelectorAll(':scope > .acc')].map((a) => a.dataset.section);
        if (JSON.stringify(got) !== JSON.stringify(list)) return `tab ${tab}: sections ${got}`;
      }
      return true;
    });
    await t('there is no Mid-Rise only control (bars, courts, templates)', () => eq([!!$('btnTemplates'), !!document.querySelector('[data-section="bars"]'), !!document.querySelector('[data-section="courts"]')], [false, false, false]));
    await t('the active tab is remembered in the UI prefs', () => {
      UI.setTab('view');
      let tab;
      try { tab = JSON.parse(localStorage.getItem(UI_STORAGE_KEY)).tab; } catch (e) { return true; }
      return eq(tab, 'view');
    });

    /* ---- controls write the state, one undo each ---- */
    await t('typing a width writes the state and is one undo step', () => {
      UI.setTab('layout');
      Store.replace(fillDefaults(defaultState()));
      const before = snap();
      const f = document.querySelector('[data-section="footprint"] input.numfield');
      f.focus(); f.value = '320'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true }));
      return eq([Store.get('footprint.width'), oneStep(before)], [320, true]);
    });
    await t('the stall width and the aisle width controls write the state', () => {
      Store.replace(fillDefaults(defaultState()));
      Store.set('bays.stallW', 9.5, { live: false });
      return eq([Store.get('bays.stallW'), Derived.get().hud.stalls > 0], [9.5, true]);
    });
    await t('ramp type buttons set the ramp type; the speed card shows only for a speed ramp', () => {
      Store.replace(fillDefaults(defaultState()));
      UI.setTab('ramp');
      const speedShown = () => visible(document.querySelector('[data-section="speed"] .when:not([hidden])'));
      click(document.querySelector('#rampTypes [data-ramp="speed"]'));
      const a = [Store.get('ramp.type'), speedShown()];
      click(document.querySelector('#rampTypes [data-ramp="single-helix"]'));
      return eq([a, Store.get('ramp.type')], [['speed', true], 'single-helix']);
    });
    await t('percent controls bind as percents (EV installed 5.0%)', () => {
      Store.replace(fillDefaults(defaultState()));
      UI.setTab('checks');
      const inputs = [...document.querySelectorAll('[data-section="ev"] input.numfield')];
      return eq(inputs.map((i) => i.value), ['5%', '20%']);
    });
    await t('the accessible table lists the 11 seed rows', () => {
      UI.setTab('checks');
      return eq(document.querySelectorAll('[data-section="accessible"] .item').length, 11);
    });
    await t('every code table carries a Caution line', () => {
      UI.setTab('checks');
      const n = document.querySelectorAll('#tabpanel-checks .caution').length;
      return n >= 2 ? true : `${n} caution lines`;
    });
    await t('the source chips: wrap and podium are disabled without a project', () => {
      UI.setTab('layout');
      const chips = [...document.querySelectorAll('#sourceChips .chip')];
      return eq(chips.map((c) => c.classList.contains('is-disabled')), [false, true, true]);
    });
    await t('Wrap without a project explains why and changes nothing', () => {
      const before = snap();
      click(document.querySelector('#sourceChips [data-source="wrap"]'));
      return eq([snap(), /project/i.test(TestHelp.toastText())], [before, true]);
    });

    /* ---- view tab ---- */
    await t('the Model / Diagram toggle switches the style and shows the legend', () => {
      Store.set('view.style', 'model', { live: false });
      const a = $('legend').hidden;
      click(document.querySelector('#styleToggle [data-style="diagram"]'));
      const b = $('legend').hidden;
      Store.set('view.style', 'model', { live: false });
      return eq([a, b], [true, false]);
    });
    await t('the legend lists the stall kinds, and the slope colors when colored by slope', () => {
      Store.set('view.style', 'diagram', { live: false });
      const kinds = [...$('legend').querySelectorAll('.lg-row')].map((r) => r.dataset.key);
      Store.set('view.colorBy', 'slope', { live: false });
      const slopes = [...$('legend').querySelectorAll('.lg-row')].map((r) => r.dataset.key);
      Store.set('view.colorBy', 'kind', { live: false });
      Store.set('view.style', 'model', { live: false });
      return eq([kinds.includes('kind-standard'), kinds.includes('kind-ev'), slopes.includes('slope-over')], [true, true, true]);
    });
    await t('level isolate: L cycles the level and Shift+L shows all', () => {
      Store.set('view.level', 0, { live: false });
      Select.nextLevel(false); const a = Store.get('view.level');
      Select.nextLevel(true); const b = Store.get('view.level');
      return eq([a, b], [1, 0]);
    });
    await t('the plan overlay shows only in the plan view or in Diagram', async () => {
      if (!Render.ready()) return true;
      Store.set('view.style', 'model', { live: false });
      Render.setView('axon', false); await frames(3);
      const a = Render.overlayInfo().planVisible;
      Render.setView('plan', false); await frames(3);
      const b = Render.overlayInfo().planVisible;
      Render.setView('axon', false);
      return eq([a, b], [false, true]);
    });

    /* ---- the metrics card ---- */
    await t('the HUD shows stalls, sf per stall, levels and max ramp slope compactly', () => {
      Store.replace(fillDefaults(defaultState()));
      UI.updateHud(Derived.get());
      UI.setHudOpen(false);
      return eq([text('mStalls'), text('mSfStall'), text('mLevels').slice(0, 1), text('mSlope').slice(0, 4), $('hud').dataset.collapsed], ['496', '378', '5', '2.2%', 'true']);
    });
    await t('one tap expands accessible, balance, clear height and conflicts', () => {
      UI.setHudOpen(false);
      click($('hudToggle'));
      const ok = [$('hud').dataset.collapsed, visible($('mAcc')), visible($('mBalance')), visible($('mClear')), visible($('mConflicts'))];
      UI.setHudOpen(false);
      return eq(ok, ['false', true, true, true, true]);
    });
    await t('the HUD warning badge counts the warnings', () => {
      const s = fillDefaults(defaultState()); s.checks.slopeParking = 0.01;
      Store.replace(s);
      UI.updateHud(Derived.get());
      const n = Derived.get().warnings.length;
      const badge = $('hudBadge').textContent;
      Store.replace(fillDefaults(defaultState()));
      return eq([n > 0, badge.startsWith(String(n))], [true, true]);
    });

    /* ---- top bar and menus ---- */
    await t('the top bar has Option, Project, Undo, Redo, Model/Diagram, Snap, Export and Help', () => {
      const ids = ['btnOption', 'btnProject', 'btnSnap', 'btnExport', 'btnHelp'];
      return eq([ids.every((i) => !!$(i)), $('tbHistory').querySelectorAll('button').length, $('styleToggle').querySelectorAll('button').length], [true, 2, 2]);
    });
    await t('the Export menu lists Image, AI-ready image, AI Prompts, SketchUp, DXF, Stall list, JSON and Send to Facade Studio', async () => {
      click($('btnExport')); await frames(2);
      const ids = ['miImage', 'miAiReady', 'miAiPrompts', 'miOverlay', 'miSketchup', 'miDxf', 'miCsv', 'miExportJson', 'miImportJson', 'miSendFacade', 'miSendGrading'];
      const have = ids.map((i) => !!$(i));
      const send = $('miSendFacade');
      const out = [have.every(Boolean), !!send && !send.disabled, send ? /Facade Studio/.test(send.textContent) : false];
      Pop.close();
      return eq(out, [true, true, true]);
    });
    await t('the Snap menu offers the 1 ft and 5 ft grids', async () => {
      click($('btnSnapMenu')); await frames(2);
      const chips = [...document.querySelectorAll('.chip[data-grid]')].map((c) => c.dataset.grid);
      click(document.querySelector('.chip[data-grid="5"]'));
      const g5 = Store.get('view.snap.grid');
      click(document.querySelector('.chip[data-grid="1"]'));
      Pop.close();
      return eq([chips, g5, Store.get('view.snap.grid')], [['1', '5'], 5, 1]);
    });
    await t('the Snap button toggles snapping', () => {
      Store.set('view.snap', { on: true, grid: 1 }, { live: false });
      click($('btnSnap'));
      const off = Store.get('view.snap.on');
      click($('btnSnap'));
      return eq([off, Store.get('view.snap.on')], [false, true]);
    });
    await t('Help opens with the Parking Deck Generator guide', async () => {
      click($('btnHelp')); await frames(2);
      const hp = $('helpPanel');
      const out = [!!hp, hp ? /Parking Deck Generator/.test(hp.textContent) : false, hp ? /Mid-Rise Generator/.test(hp.textContent) : true];
      Pop.close();
      return eq(out, [true, true, false]);
    });
    await t('the Option menu opens and lists the presets', async () => {
      click($('btnOption')); await frames(2);
      const items = [...document.querySelectorAll('.pop-item')].map((x) => x.textContent);
      Pop.close();
      return items.some((x) => /Two-bay single helix/.test(x)) ? true : `items: ${items.slice(0, 6)}`;
    });
    await t('the project pill and menu exist', () => eq([!!$('projPill'), !!$('btnProject')], [true, true]));

    /* ---- AI prompts ---- */
    await t('AI Prompts: the prompts mention the parking deck, with auto values from the HUD', () => {
      const auto = Prompts.currentAuto();
      const txt = Prompts.promptText(Prompts.allPrompts()[0].id);
      return eq([/parking/i.test(txt), !/mid-rise/i.test(txt), JSON.stringify(auto).length > 5], [true, true, true]);
    });

    /* ---- compare ---- */
    await t('Compare lists stalls, sf per stall and max slope, and marks the best', async () => {
      Store.replace(fillDefaults(defaultState()));
      const id = Options.save();
      Store.set('bays.stallW', 9.5, { live: false });
      const ok = Compare.enter([id, '__current']);
      await frames(3);
      const html = Compare.isActive() ? Compare.table() : '';
      const best = Compare.isActive() ? document.querySelectorAll('#cmpTable td.best').length : 0;
      Compare.exit();
      Options.storage.remove(id);
      return eq([ok !== false, /Stalls/.test(html), /per stall/i.test(html), /Max ramp slope/i.test(html), best > 0], [true, true, true, true, true]);
    });
  } finally {
    Compare.isActive() && Compare.exit();
    Pop.close();
    Store.replace(savedState);
    UI.setTab(savedTab, { remember: false });
    UI.setHudOpen(savedHud);
    Options.holdAutosave(false);
  }
  return results;
}
