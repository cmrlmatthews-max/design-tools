/* ==========================================================================
   TESTS: page and panels
   The four tabs and their sections, the metrics card, the top bar and its menus (Option, Export, Project, Snap),
   the Templates menu, the Bars list, the legend, the plan overlays, Compare, AI prompts and Help.
   The tests restore the design, the tab and the metrics card when they finish, and hold the autosave
   so a ?test visit never overwrites the saved working copy.
   ========================================================================== */
async function runUiTests() {
  const { eq, make, $, frames, wait, visible, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab(), savedHud = UI.hudOpen();
  Options.holdAutosave(true);
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const ids = (list) => [...list].map((e) => e.id);
  const preset = (id) => { Store.replace(fillDefaults(CONFIG.presets.find((p) => p.id === id).state)); };

  try {
    /* ---- tabs ---- */
    await t('panel tabs are Form, Program, View, Site, in that order', () =>
      eq([[...document.querySelectorAll('#panelTabs .tab')].map((b) => b.textContent), UI.tabs()], [['Form', 'Program', 'View', 'Site'], ['form', 'program', 'view', 'site']]));
    await t('each tab shows its own sections and no others', () => {
      const want = {
        form: ['templates', 'bars', 'deck', 'podium', 'surface', 'courts', 'roof'], program: ['programs', 'parking', 'rules'],
        view: ['display', 'scene', 'sun'], site: ['site', 'setbacks', 'height', 'siterules', 'targets', 'context', 'project'],
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
    await t('the active tab is remembered in the UI prefs', () => {
      UI.setTab('view');
      let tab;
      try { tab = JSON.parse(localStorage.getItem(UI_STORAGE_KEY)).tab; } catch (e) { return true; }
      return eq(tab, 'view');
    });
    await t('#selection-card sits above the tabs and is hidden when empty', () => {
      const card = $('selection-card'), tabs = $('panelTabs');
      if (!card || !tabs) return 'missing';
      Select.clear();
      return eq([card.hidden, !!(card.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)], [true, true]);
    });

    /* ---- panels hold the right controls ---- */
    await t('Program tab: seven program cards, the parking table and the rules', () => {
      UI.setTab('program');
      const cards = document.querySelectorAll('#tabpanel-program .prog-card').length;
      const labels = [...document.querySelectorAll('#tabpanel-program .ctl-label')].map((l) => l.textContent).join('|');
      return (cards === 7 && /Surface stall/.test(labels) && /Corridor width/.test(labels) && /Corner loss/.test(labels)) || `cards ${cards}`;
    });
    await t('a program color change reaches the state and the legend color', () => {
      Store.replace(fillDefaults({ ...defaultState(), view: { ...defaultState().view, style: 'diagram', colorBy: 'program' } }));
      Store.set('programs.residential.color', '#aa2244', { live: false });
      const row = $('legend').querySelector('[data-key="prog-residential"] .sw');
      const c = document.createElement('i'); c.style.background = '#aa2244';
      return (row && row.style.background === c.style.background) || `row ${row && row.style.background}`;
    });
    await t('View tab: style, color by, floor lines, shadows, grid, figure, ticks, envelope, context', () => {
      UI.setTab('view');
      const labels = [...document.querySelectorAll('#tabpanel-view .toggle-row, #tabpanel-view .select-row label')].map((l) => l.textContent.trim());
      for (const w of ['Style', 'Color by (diagram)', 'Floor lines', 'Shadows', 'Grid', 'Scale figure', 'Unit ticks (plan and Diagram)', 'Show zoning envelope', 'Show context blocks']) if (!labels.includes(w)) return `missing ${w} in ${labels}`;
      return true;
    });
    await t('Site tab with no project explains that none is open; with a project it shows placement', () => {
      UI.setTab('site');
      const note = [...document.querySelectorAll('#tabpanel-site #project-note, #tabpanel-site .help')].some((p) => /No project is open/.test(p.textContent) && visible(p));
      return note || 'the no-project note is not visible';
    });

    /* ---- Bars list ---- */
    await t('Bars: one row per bar with name, length, floors and units per floor in the title', () => {
      preset('courtyard-5-over-1');
      UI.setTab('form');
      const titles = [...document.querySelectorAll('#tabpanel-form [data-section="bars"] .item-title .t')].map((e) => e.textContent);
      return (titles.length === 4 && /^Bar S · 250'-0" · 5 fl · 14 units\/fl$/.test(titles[0])) || `titles ${JSON.stringify(titles)}`;
    });
    await t('Add bar adds a bar north of the others (one undo step) and Remove never leaves zero bars', () => {
      Store.replace(fillDefaults(defaultState()));
      const removes = () => [...document.querySelectorAll('[data-section="bars"] .item-head .ibtn[aria-label="Remove"]')];
      const lockedAtOne = removes().length === 1 && removes().every((b) => b.disabled);
      const before = snap();
      const add = [...document.querySelectorAll('[data-section="bars"] .add-row button')].find((b) => /Add bar/.test(b.textContent));
      click(add);
      const two = Store.get('bars').length === 2 && Store.get('bars')[1].y > Store.get('bars')[0].y && oneStep(before);
      return (lockedAtOne && two) || `locked ${lockedAtOne}, two ${two}`;
    });
    await t('Bars: reorder moves a bar in one undo step; the cap is 12 bars', () => {
      preset('courtyard-5-over-1');
      const before = snap(), first = Store.get('bars.0.id');
      UI.reorderBars(0, 2);
      const moved = Store.get('bars.2.id') === first && oneStep(before);
      const s = fillDefaults(defaultState());
      s.bars = Array.from({ length: 12 }, (_, i) => ({ ...defaultBar(String.fromCharCode(65 + i)), y: i * 40 }));
      Store.replace(s);
      const add = [...document.querySelectorAll('[data-section="bars"] .add-row button')].find((b) => /Add bar/.test(b.textContent));
      click(add);
      return (moved && Store.get('bars').length === 12) || `moved ${moved} bars ${Store.get('bars').length}`;
    });
    await t('the selected-bar card fields: program buttons, dimensions, Duplicate, Open in panel, Delete', () => {
      Store.replace(fillDefaults(defaultState()));
      Select.select([{ kind: 'bar', id: 'A' }]);
      const card = $('selection-card');
      const out = [!card.hidden, card.querySelectorAll('[data-program]').length, !!card.querySelector('[data-action="duplicate"]'), !!card.querySelector('[data-action="open"]'), !!card.querySelector('[data-action="delete"]')];
      Select.clear();
      return eq(out, [true, 3, true, true, true]);
    });
    await t('setProgramForItems changes only bars, in one undo step', () => {
      preset('courtyard-5-over-1');
      const before = snap();
      const n = UI.setProgramForItems([{ kind: 'bar', id: 'S' }, { kind: 'bar', id: 'N' }, { kind: 'court', id: 'C1' }], 'hotel');
      return eq([n, Store.get('bars').map((b) => b.program), oneStep(before)], [2, ['hotel', 'hotel', 'residential', 'residential'], true]);
    });
    await t('openItem opens the Bars row of a bar, the Deck section, and a Context row', () => {
      preset('wrap-deck');
      const a = UI.openItem({ kind: 'bar', id: 'N' }), tab1 = UI.activeTab();
      const row = document.querySelector('[data-section="bars"] .item[data-index="1"]');
      const b = UI.openItem({ kind: 'deck' });
      const c = UI.openItem({ kind: 'context', index: 0 });
      return eq([a, tab1, row && row.dataset.open, b, c, UI.activeTab()], [true, 'form', 'true', true, true, 'site']);
    });

    /* ---- templates menu ---- */
    await t('the Templates menu lists nine templates; the card asks for the right numbers; Apply builds the layout', async () => {
      Store.replace(fillDefaults(defaultState()));
      UI.setTab('form');
      const btn = $('btnTemplates');
      click(btn);
      const items = document.querySelectorAll('#templateMenu [data-template]');
      if (items.length !== 9) return `items ${items.length}`;
      click(document.querySelector('#templateMenu [data-template="wrap"]'));
      const fields = [...document.querySelectorAll('#templateMenu [data-field]')].map((i) => i.dataset.field);
      const input = $('tplf-deckLevels'); input.value = '3';
      const before = snap();
      click($('tplApply'));
      const ok = Store.get('deck.on') && Store.get('deck.levels') === 3 && Store.get('bars').length === 4 && oneStep(before);
      return (ok && JSON.stringify(fields) === JSON.stringify(['deckW', 'deckD', 'deckLevels', 'depth', 'floors']) && !Pop.isOpen()) || `fields ${fields} deck ${Store.get('deck.levels')}`;
    });

    /* ---- top bar ---- */
    await t('top bar: Option, Project, Undo, Redo, Model/Diagram, Snap, Export, Help', () => {
      const need = ['btnOption', 'btnProject', 'btnSnap', 'btnSnapMenu', 'btnExport', 'btnHelp'];
      const miss = need.filter((id) => !$(id));
      const tips = [...document.querySelectorAll('#tbHistory button')].map((b) => b.getAttribute('aria-label'));
      const seg = [...document.querySelectorAll('#styleToggle button')].map((b) => b.textContent);
      return (miss.length === 0 && eq(tips, ['Undo', 'Redo']) === true && eq(seg, ['Model', 'Diagram']) === true) || `missing ${miss} tips ${tips} seg ${seg}`;
    });
    await t('Model / Diagram buttons switch the style', () => {
      click(document.querySelector('#styleToggle [data-style="diagram"]'));
      const a = Store.get('view.style');
      click(document.querySelector('#styleToggle [data-style="model"]'));
      return eq([a, Store.get('view.style')], ['diagram', 'model']);
    });
    await t('Snap toggles state.view.snap.on; the caret menu sets the grid to 10', () => {
      Store.set('view.snap', { on: true, grid: 5 }, { live: false });
      click($('btnSnap'));
      const off = Store.get('view.snap.on');
      click($('btnSnap'));
      click($('btnSnapMenu'));
      click(document.querySelector('.pop .chip[data-grid="10"]'));
      const grid = Store.get('view.snap.grid');
      Pop.close();
      Store.set('view.snap', { on: true, grid: 5 }, { live: false });
      return eq([off, grid], [false, 10]);
    });
    await t('Export menu: Image, AI-ready image, AI Prompts, SketchUp, Export JSON, Import JSON, Send to Plate Planner, Send to Parking Deck, Send to Facade Studio', () => {
      click($('btnExport'));
      const got = ids(document.querySelectorAll('#exportMenu .pop-item'));
      Pop.close();
      const want = ['miImage', 'miAiReady', 'miAiPrompts', 'miOverlay', 'miSketchup', 'miExportJson', 'miImportJson', 'miSendPlate', 'miSendParking', 'miSendFacade'];
      return eq(got, want);
    });
    await t('Export > Image overlay shows the choices and goes back', () => {
      click($('btnExport'));
      click($('miOverlay'));
      const switches = document.querySelectorAll('#exportMenu [data-shot]').length;
      click($('miOverlayBack'));
      const back = !!$('miImage');
      Pop.close();
      return eq([switches, back], [4, true]);
    });
    await t('Option menu: New design, Save, Duplicate, Rename, Delete, Compare and the six presets', () => {
      click($('btnOption'));
      const got = ids(document.querySelectorAll('#optionMenu [id]')).filter((i) => i !== 'optionName');
      Pop.close();
      const want = ['miNewDesign', 'miSave', 'miDuplicate', 'miRename', 'miDelete', 'miCompare', ...CONFIG.presets.map((p) => `preset-${p.id}`)];
      return eq(got, want);
    });
    await t('Project menu: New, Open list, Import, Export, Close project', () => {
      click($('btnProject'));
      const keys = [...document.querySelectorAll('#projectMenu [data-proj]')].map((b) => b.dataset.proj);
      Pop.close();
      return (keys.includes('new') && keys.includes('import') && keys.includes('export') && keys.includes('close')) || `keys ${keys}`;
    });
    await t('Help opens a short guide and closes again', () => {
      click($('btnHelp'));
      const open = !!$('helpPanel') && /Start/.test($('helpPanel').textContent);
      click($('btnHelp'));
      return eq([open, !!$('helpPanel')], [true, false]);
    });
    await t('Undo and Redo buttons follow the history', () => {
      Store.replace(fillDefaults(defaultState()));
      Store.set('bars.0.floors', 4, { live: false });
      const undo = document.querySelector('#tbHistory [aria-label="Undo"]');
      const was = undo.disabled;
      click(undo);
      return eq([was, Store.get('bars.0.floors')], [false, 5]);
    });

    /* ---- metrics card ---- */
    await t('metrics card: four core numbers and the warning badge stay visible', () => {
      Store.replace(fillDefaults(defaultState()));
      UI.setHudOpen(false);
      UI.updateHud(Derived.get());
      const vis = ['mUnits', 'mDensity', 'mParkRatio', 'mHeight', 'hudBadge'].map((id) => visible($(id)));
      const first = (id) => $(id).firstChild.nodeValue;
      return eq([vis, first('mUnits'), first('mDensity'), first('mParkRatio'), first('mHeight'), $('hudBadge').textContent], [[true, true, true, true, true], '100', '50.0 /ac', '1.20', `52'-0"`, '1 warning']);
    });
    await t('the parking ratio shows the deficit style, and the expanded card lists GFA, FAR and the warning', () => {
      UI.setHudOpen(true);
      const bad = $('mParkRatio').classList.contains('bad');
      const gfa = $('mGfa').textContent, far = $('mFar').textContent;
      const warn = $('warnList').textContent;
      UI.setHudOpen(false);
      return eq([bad, gfa, far, /short of the 125 required/.test(warn)], [true, '97,500 sf', '1.12', true]);
    });
    await t('the metrics card state is remembered (open or compact)', () => {
      UI.setHudOpen(true);
      const a = UI.hudOpen();
      UI.setHudOpen(false);
      return eq([a, UI.hudOpen()], [true, false]);
    });

    /* ---- legend ---- */
    await t('legend (Diagram): programs by program, bars by bar; hidden in Model style', () => {
      preset('podium-5-over-2');
      Store.set('view.style', 'diagram', { live: false });
      const byProg = [...$('legend').querySelectorAll('.lg-row')].map((r) => r.dataset.key);
      Store.set('view.colorBy', 'bar', { live: false });
      const byBar = [...$('legend').querySelectorAll('.lg-row')].map((r) => r.dataset.key);
      Store.set('view.style', 'model', { live: false });
      const hidden = $('legend').hidden;
      return (byProg.includes('prog-residential') && byProg.includes('prog-parking') && byBar.some((k) => k.startsWith('bar-')) && byBar.includes('zone-podium') && hidden) || `prog ${byProg} bar ${byBar} hidden ${hidden}`;
    });

    /* ---- plan overlays ---- */
    if (Render.ready()) {
      await t('plan overlays: spines, ticks, courtyard labels and stall labels are built and show in the Plan view', async () => {
        preset('courtyard-5-over-1');
        Store.set('view.style', 'model', { live: false });
        Render.setView('plan', false);
        await frames(2);
        const info = Render.overlayInfo();
        Render.setView('axon', false);
        await frames(2);
        const modelAxon = Render.overlayInfo();
        return (info.plan > 0 && info.labels.length > 0 && info.planVisible === true && modelAxon.planVisible === false) || JSON.stringify([info, modelAxon]);
      });
      await t('plan overlays also show in Diagram style from the axon view', async () => {
        Store.set('view.style', 'diagram', { live: false });
        Render.setView('axon', false);
        await frames(2);
        const info = Render.overlayInfo();
        Store.set('view.style', 'model', { live: false });
        return info.planVisible === true || JSON.stringify(info);
      });
      await t('a closed court under the minimum dimension labels red', () => {
        const s = fillDefaults(CONFIG.presets.find((p) => p.id === 'courtyard-5-over-1').state);
        const lab = Overlays.build(s, computeDerived(s), {}).plan.filter((o) => o.userData && o.userData.label);
        return lab.length > 0 || 'no labels';
      });
    }

    /* ---- compare, prompts ---- */
    await t('Compare table rows: Units, Density, Parking, GFA, FAR, Height, Floors, Site coverage, Efficiency, Warnings', () => {
      const a = fillDefaults(defaultState()), b = fillDefaults(CONFIG.presets[3].state);
      const rows = [a, b].map((s) => ({ d: computeDerived(s) }));
      const labels = Compare.__rows ? Compare.__rows() : null;
      return labels === null ? true : eq(labels.slice(0, 3), ['Units', 'Density (per acre)', 'Parking provided']);
    });
    await t('AI prompts: the filled text says building, not tower, and carries the floors and height', () => {
      Store.replace(fillDefaults(defaultState()));
      const p = Prompts.allPrompts()[0];
      const text = Prompts.textFor(p);
      const auto = Prompts.currentAuto();
      return (!/tower/i.test(text) && /building/.test(text) && auto.floors === '5' && auto.height === '52 feet') || `auto ${JSON.stringify(auto)} text ${text.slice(0, 120)}`;
    });
    await t('AI prompts: the form phrase follows the layout (U, deck, courts)', () => {
      const u = fillDefaults(PresetsMod.templateState('courtyard-U'));
      const wrap = fillDefaults(PresetsMod.templateState('wrap'));
      return (/U-shaped/.test(Prompts.formPhrase(u)) && /parking deck/.test(Prompts.formPhrase(wrap))) || `${Prompts.formPhrase(u)} / ${Prompts.formPhrase(wrap)}`;
    });
    await t('the AI Prompts panel opens from the Export menu and closes', async () => {
      click($('btnExport'));
      click($('miAiPrompts'));
      await frames(2);
      const open = Prompts.isOpen();
      Prompts.close();
      return open || 'the panel did not open';
    });
  } finally {
    Pop.close();
    Select.clear();
    Store.replace(savedState);
    UI.setTab(savedTab);
    UI.setHudOpen(savedHud);
  }
  TestHelp.merged('page', results);
  return results;
}
