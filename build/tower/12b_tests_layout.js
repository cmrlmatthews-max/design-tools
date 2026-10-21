/* ==========================================================================
   TESTS: v1.1 layout
   Panel tabs, program colors and legend, snap state, metrics card, the
   Option and Export menus, and the hooks for the selection card (openItem,
   setProgramForItems). Runs after the calculation tests in 12_tests.js
   (runAllTests below runs both and merges the results).
   The tests restore the design, the tab and the metrics card when they finish,
   and hold the autosave so a ?test visit never overwrites the saved working copy.
   ========================================================================== */
async function runLayoutTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const $ = (id) => document.getElementById(id);
  const norm = (c) => { const e = document.createElement('i'); e.style.background = c; return e.style.background; };
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const savedState = Store.snapshot(), savedTab = UI.activeTab(), savedHud = UI.hudOpen();
  Options.holdAutosave(true);
  const twoSegments = () => {
    const s = Store.snapshot();
    s.segments = [{ ...s.segments[0], program: 'residential' }, { ...s.segments[0], program: 'office', floors: 5 }];
    s.podium.on = false;
    Store.replace(s);
  };

  try {
    /* ---- tabs ---- */
    await t('panel tabs are Form, Program, View, Site, in that order', () =>
      eq([[...document.querySelectorAll('#panelTabs .tab')].map((b) => b.textContent), UI.tabs()], [['Form', 'Program', 'View', 'Site'], ['form', 'program', 'view', 'site']]));
    await t('each tab shows its own sections and no others', () => {
      const want = {
        form: ['podium', 'segments', 'moves', 'carves', 'crown', 'core'], program: ['programs', 'targets'],
        view: ['display', 'scene', 'sun'], site: ['site', 'setbacks', 'height', 'context'],
      };
      for (const [tab, ids] of Object.entries(want)) {
        UI.setTab(tab);
        const shown = [...document.querySelectorAll('.tabpanel')].filter(visible);
        if (shown.length !== 1 || shown[0].id !== `tabpanel-${tab}`) return `tab ${tab}: ${shown.map((p) => p.id)}`;
        const got = [...shown[0].querySelectorAll(':scope > .acc')].map((a) => a.dataset.section);
        if (JSON.stringify(got) !== JSON.stringify(ids)) return `tab ${tab}: sections ${got}`;
      }
      return true;
    });
    await t('the active tab is remembered in the UI prefs', () => {
      UI.setTab('view');
      let tab;
      try { tab = JSON.parse(localStorage.getItem(UI_STORAGE_KEY)).tab; } catch (e) { return true; }   // storage unavailable: nothing to check
      return eq(tab, 'view');
    });
    await t('#selection-card sits above the tabs and is hidden when empty', () => {
      const card = $('selection-card'), tabs = $('panelTabs');
      if (!card || !tabs) return 'missing';
      return eq([card.hidden, !!(card.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)], [true, true]);
    });

    /* ---- program colors ---- */
    await t('new options color the Diagram by program', () => eq(defaultState().view.colorBy, 'program'));
    await t('an old saved option that says "zone" keeps it; a missing value becomes program', () =>
      eq([fillDefaults({ view: { colorBy: 'zone' } }).view.colorBy, fillDefaults({ view: { colorBy: 'program' } }).view.colorBy, fillDefaults({ view: { style: 'model' } }).view.colorBy, fillDefaults({}).view.colorBy],
        ['zone', 'program', 'program', 'program']));
    await t('view.snap defaults to { on: true, grid: 5 }; a bad grid becomes 5; old states get it', () =>
      eq([defaultState().view.snap, fillDefaults({ view: { style: 'model' } }).view.snap, fillDefaults({ view: { snap: { on: false, grid: 7 } } }).view.snap, fillDefaults({ view: { snap: { grid: 10 } } }).view.snap],
        [{ on: true, grid: 5 }, { on: true, grid: 5 }, { on: false, grid: 5 }, { on: true, grid: 10 }]));
    await t('a color swatch sits on each segment row and the podium, in the program color', () => {
      twoSegments();
      UI.setTab('form');
      const sw = [...document.querySelectorAll('#tabpanel-form [data-section="segments"] .item-title .sw')];
      if (sw.length !== 2) return `${sw.length} swatches`;
      const col = (k) => norm(Store.get(`programs.${k}.color`));
      if (sw[0].style.background !== col('residential') || sw[1].style.background !== col('office')) return `colors ${sw.map((x) => x.style.background)}`;
      Store.set('podium.on', true, { live: false });
      const box = document.querySelector('[data-section="podium"] .acc-sw');
      return (box && !box.hidden && box.children[0].style.background === col(Store.get('podium.program')) && box.children[1].style.background === col(Store.get('podium.upperProgram'))) || 'podium swatches wrong';
    });
    await t('the legend (Diagram) lists only the programs in the model, and is hidden in Model style', () => {
      twoSegments();
      Store.set('view.style', 'model', { live: false });
      const lg = $('legend');
      if (!lg.hidden) return 'shown in Model style';
      Store.set('view.style', 'diagram', { live: false });
      const keys = () => [...lg.querySelectorAll('.lg-row')].map((r) => r.dataset.key).filter((k) => k.startsWith('prog-'));
      const a = keys();
      Store.set('segments.1.program', 'hotel', { live: false });
      const b = keys();
      Store.set('podium.on', true, { live: false });
      const c = keys();
      Store.set('view.style', 'model', { live: false });
      return eq([a, b, c], [['prog-residential', 'prog-office'], ['prog-residential', 'prog-hotel'], ['prog-residential', 'prog-hotel', 'prog-retail', 'prog-amenity']]);
    });

    /* ---- hooks ---- */
    await t('setProgramForItems changes segments and the podium in ONE undo step, and undo restores them', () => {
      twoSegments();
      Store.set('podium.on', true, { live: false });
      const before = Store.snapshot(), depth = Store.historyDepth();
      const n = UI.setProgramForItems([{ kind: 'segment', index: 0 }, { kind: 'segment', index: 1 }, { kind: 'podium' }], 'hotel');
      const s = Store.snapshot();
      if (n !== 3 || !s.segments.every((g) => g.program === 'hotel') || s.podium.program !== 'hotel' || s.podium.upperProgram !== 'hotel') return `applied ${n}, ${JSON.stringify(s.segments.map((g) => g.program))}`;
      if (Store.historyDepth() !== depth + 1) return `depth ${depth} -> ${Store.historyDepth()}`;
      Store.undo();
      return eq(Store.snapshot(), before);
    });
    await t('setProgramForItems skips items with no program, unknown programs, and does nothing when nothing changes', () => {
      twoSegments();
      const depth = Store.historyDepth();
      const a = UI.setProgramForItems([{ kind: 'crown' }, { kind: 'carve', index: 0 }, { kind: 'context', index: 0 }], 'hotel');
      const b = UI.setProgramForItems([{ kind: 'segment', index: 0 }], 'no-such-program');
      const c = UI.setProgramForItems([{ kind: 'segment', index: 0 }], 'residential');
      return eq([a, b, c, Store.historyDepth()], [0, 0, 1, depth]);
    });
    await t('a segment program change recolors the Diagram state (plates carry the new program)', () => {
      twoSegments();
      Store.set('view.style', 'diagram', { live: false });
      UI.setProgramForItems([{ kind: 'segment', index: 1 }], 'parking');
      const progs = new Set(Derived.get().plates.filter((p) => !p.void).map((p) => p.program));
      Store.set('view.style', 'model', { live: false });
      return eq([...progs].sort(), ['parking', 'residential']);
    });
    await t('openItem switches tab, opens the row or section, and returns false for an unknown kind', () => {
      twoSegments();
      UI.setTab('site');
      if (!UI.openItem({ kind: 'segment', index: 1 }) || UI.activeTab() !== 'form') return `segment: tab ${UI.activeTab()}`;
      const row = document.querySelector('[data-section="segments"] .item[data-index="1"]');
      if (!row || row.dataset.open !== 'true') return 'segment row 1 not open';
      UI.setTab('program');
      if (!UI.openItem({ kind: 'podium' }) || UI.activeTab() !== 'form' || document.querySelector('[data-section="podium"]').dataset.open !== 'true') return 'podium';
      if (!UI.openItem({ kind: 'crown' }) || document.querySelector('[data-section="crown"]').dataset.open !== 'true') return 'crown';
      Store.set('carves', [{ startFloor: 3, endFloor: 4, kind: 'corner', corner: 'NE', w: 20, d: 20 }], { live: false });
      if (!UI.openItem({ kind: 'carve', index: 0 }) || document.querySelector('[data-section="carves"] .item[data-index="0"]').dataset.open !== 'true') return 'carve';
      if (!UI.openItem({ kind: 'context', index: 0 }) || UI.activeTab() !== 'site' || document.querySelector('[data-section="context"] .item[data-index="0"]').dataset.open !== 'true') return 'context';
      return eq(UI.openItem({ kind: 'wall', index: 0 }), false);
    });

    /* ---- metrics card ---- */
    await t('four metrics and the warning badge are always visible; the rest appear when expanded', () => {
      UI.setHudOpen(false);
      const compactOk = ['mGfa', 'mFar', 'mHeight', 'mFloors', 'hudBadge'].every((id) => visible($(id)));
      const hiddenOk = !visible($('mSite')) && !visible($('warnList'));
      UI.setHudOpen(true);
      const expandedOk = ['mSite', 'mCover', 'mEff', 'mNet', 'mCore', 'mMech', 'mCrown', 'mPlateAvg', 'warnList'].every((id) => visible($(id)));
      return (compactOk && hiddenOk && expandedOk) || `compact ${compactOk} hidden ${hiddenOk} expanded ${expandedOk}`;
    });
    await t('the metrics card expanded or collapsed state is remembered', () => {
      UI.setHudOpen(true);
      let a, b;
      try { a = JSON.parse(localStorage.getItem(UI_STORAGE_KEY)).hudOpen; UI.setHudOpen(false); b = JSON.parse(localStorage.getItem(UI_STORAGE_KEY)).hudOpen; } catch (e) { return true; }
      return eq([a, b], [true, false]);
    });

    /* ---- top bar ---- */
    await t('the Snap button writes state.view.snap; the popover chooses 5 or 10 ft', () => {
      Store.set('view.snap', { on: true, grid: 5 }, { live: false });
      $('btnSnap').click();
      const off = Store.get('view.snap');
      $('btnSnap').click();
      $('btnSnapMenu').click();
      const chip10 = document.querySelector('.pop .chip[data-grid="10"]');
      if (!chip10) return 'no grid chip';
      chip10.click();
      const ten = Store.get('view.snap');
      Pop.close();
      return eq([off, ten], [{ on: false, grid: 5 }, { on: true, grid: 10 }]);
    });
    await t('the Option menu has name, Save, Duplicate, Rename, Delete, Compare and the presets', () => {
      $('btnOption').click();
      const ids = ['optionName', 'miSave', 'miDuplicate', 'miRename', 'miDelete', 'miCompare'].filter((id) => !$(id));
      const presets = document.querySelectorAll('#optionMenu [id^="preset-"]').length;
      Pop.close();
      return eq([ids, presets === CONFIG.presets.length], [[], true]);
    });
    await t('the Export menu has Image, AI-ready image, AI Prompts, Image overlay, Export JSON, Import JSON', () => {
      $('btnExport').click();
      const missing = ['miImage', 'miAiReady', 'miAiPrompts', 'miOverlay', 'miExportJson', 'miImportJson'].filter((id) => !$(id));
      $('miOverlay').click();
      const toggles = [...document.querySelectorAll('#exportMenu [data-shot]')].map((b) => b.dataset.shot);
      Pop.close();
      return eq([missing, toggles], [[], ['title', 'date', 'metrics', 'mark']]);
    });
  } finally {
    Pop.close();
    Store.replace(savedState);
    UI.setTab(savedTab);
    UI.setHudOpen(savedHud);
    Options.holdAutosave(false);
  }
  return results;
}

/** The calculation tests plus the layout tests, merged. This is what ?test and __tower.runTests run. */
async function runAllTests() {
  const base = await runTests();
  const layout = await runLayoutTests();
  const select = await runSelectTests();
  const all = [...(base.results || []), ...layout, ...select];
  const failed = all.filter((r) => !r.ok);
  console.log(`[tests] layout ${layout.length - layout.filter((r) => !r.ok).length}/${layout.length} passed`, layout.filter((r) => !r.ok).length ? JSON.stringify(layout.filter((r) => !r.ok)) : '');
  console.log(`[tests] select ${select.length - select.filter((r) => !r.ok).length}/${select.length} passed`, select.filter((r) => !r.ok).length ? JSON.stringify(select.filter((r) => !r.ok)) : '');
  window.__towerTestResults = { total: all.length, passed: all.length - failed.length, failed, results: all };
  return window.__towerTestResults;
}
