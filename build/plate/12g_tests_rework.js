/* ==========================================================================
   TESTS: the rework  (docs/plate-planner-rework-plan.md sections 7 and 8.2)
   The unit depth cap, reset the core, the badge count against the list, the mix table without empty rows, the core mode controls, the
   elevator count field, the advisor lines and the help text. They change the design on screen and put it back at the end.
   Changed by the draw-first change: split, merge, fill a remainder and draw-a-unit tests moved to 12h (new draw-first versions); the depth cap
   test reads the run depth of the layout (no auto-fill units exist); the deep-plate test checks the advisor and the core rooms and that no
   remainder exists; the bay-drag width-range test is gone (draw.js clamps at 1 ft: see 12c); the help test follows the new help text.
   ========================================================================== */
async function runReworkTests() {
  const { eq, make, $, frames, wait, visible, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const L = () => Derived.get().editing;
  const flat = () => { Select.clear(); Store.replace(TestHelp.presetState('double-loaded-bar')); UI.updateHud(Derived.get()); };
  /** A deep point plate: 150 by 160 ft, automatic corridor and core (rework plan 8.1, R1). */
  const deep = () => {
    const s = fillDefaults(defaultState());
    s.plate = { ...s.plate, shape: 'rect', w: 150, d: 160, points: [] };
    s.corridor = { ...s.corridor, kind: 'auto', spine: null };
    s.core = { mode: 'auto', rect: null };
    Select.clear();
    Store.replace(s);
    UI.updateHud(Derived.get());
  };
  const mixOf = (id) => Store.get('mix.multifamily').find((x) => x.id === id);
  try {
    flat();
    if (Render.ready()) Render.setView('plan', false);
    await frames(3);

    /* ---- the unit depth cap ---- */
    await t('depth cap: 30 ft on a deep plate cuts the run depth to 30 ft, makes trim support, and the open area shrinks', () => {
      deep();
      const l0 = Select.layoutInfo();
      const maxBefore = Math.max(...l0.runs.map((r) => r.depth));
      Store.set('fill.maxDepth', 30, { live: false });
      const l1 = Select.layoutInfo(), d = Derived.get();
      const trims = L().support.filter((b) => b.kind === 'trim').length;
      return eq([maxBefore > 40, Math.max(...l1.runs.map((r) => r.depth)) <= 30.01 || Math.max(...l1.runs.map((r) => r.depth)), trims > 0, l1.openArea < l0.openArea, d.ok], [true, true, true, true, true]);
    });
    await t('depth cap: the Corridor card has Off and On chips and a slider from 24 to 40 ft; a project group takes its own cap', () => {
      deep();
      UI.setTab('plate'); TestHelp.openSection('corridor');
      const chips = [...$('depthCapMode').querySelectorAll('button')].map((b) => b.dataset.value);
      [...$('depthCapMode').querySelectorAll('button')].find((b) => b.dataset.value === 'on').click();
      const on = Store.get('fill.maxDepth');
      [...$('depthCapMode').querySelectorAll('button')].find((b) => b.dataset.value === 'off').click();
      return eq([chips, on, Store.get('fill.maxDepth')], [['off', 'on'], 30, null]);
    });

    await t('depth cap in a project: the cap goes to the selected level group (levels.groups[gid].maxDepth) and the fill of that group follows it', () => {
      const mem = ProjectFixture.memory();
      try {
        ProjectUI.reset();
        ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
        const doc = ProjectFixture.project();
        ProjectMod.saveProject(mem, doc);
        ProjectUI.openDoc(doc);
        UI.setTab('plate'); TestHelp.openSection('corridor');
        const gid = Derived.get().group.id;
        const chip = (v) => [...$('depthCapMode').querySelectorAll('button')].find((b) => b.dataset.value === v);
        chip('on').click();
        const onNow = [Store.get(`levels.groups.${gid}.maxDepth`), Store.get('fill.maxDepth'), Derived.get().built.groups[0].fill.maxDepth, Store.get(`levels.groups.${gid}.filled`)];
        chip('off').click();
        return eq([onNow, Derived.get().built.groups[0].fill.maxDepth || null], [[30, null, 30, true], null]);
      } finally {
        ProjectUI.close(); ProjectUI.restoreDefaults(); ProjectUI.reset();
      }
    });

    /* ---- the core ---- */
    await t('reset core: a drag makes the core Manual with a rectangle; Reset core to auto gives the rooms back; undo works', () => {
      deep();
      const auto0 = L().coreRooms.length;
      const r0 = Select.rectOf({ kind: 'core', id: 'core' });
      Select.setBlockRect({ kind: 'core', id: 'core' }, [r0[0] + 10, r0[1], r0[2] + 10, r0[3]]);
      const manual = [Store.get('core.mode'), Array.isArray(Store.get('core.rect')), L().coreRooms.length];
      const afterDrag = snap();
      const moved = Select.resetCore();
      const back = [Store.get('core.mode'), Store.get('core.rect'), L().coreRooms.length > 0];
      return eq([auto0 > 0, manual, moved, back, oneStep(afterDrag)], [true, ['manual', true, 11], true, ['auto', null, true], true]);
    });
    await t('core mode chips: Auto, Manual and None set the mode; None draws no core; the Reset button follows the mode', () => {
      deep();
      UI.setTab('plate'); TestHelp.openSection('blocks');
      const chips = [...$('coreModeChips').querySelectorAll('button')];
      const click = (v) => chips.find((b) => b.dataset.value === v).click();
      click('none');
      const none = [Store.get('core.mode'), L().core === null || L().core === undefined || !L().core.length];
      click('manual');
      const man = [Store.get('core.mode'), Array.isArray(Store.get('core.rect'))];
      click('auto');
      return eq([chips.map((b) => b.dataset.value), none, man, Store.get('core.mode')], [['auto', 'manual', 'none'], ['none', true], ['manual', true], 'auto']);
    });
    await t('elevator count field: blank is automatic and its placeholder shows the automatic value; a typed value is stored', () => {
      deep();
      UI.setTab('plate'); TestHelp.openSection('blocks');
      const f = $('elevCountField');
      const auto = Derived.get().hud.core.autoCabs;
      const ph = f.placeholder;
      f.value = '3'; f.dispatchEvent(new Event('change'));
      const typed = [Store.get('elevators.count'), L().coreRooms.filter((r) => r.kind === 'elevator').length];
      f.value = ''; f.dispatchEvent(new Event('change'));
      return eq([ph === `Auto: ${auto}`, typed, Store.get('elevators.count')], [true, [3, 3], null]);
    });
    await t('a deep point plate: labeled core rooms, no remainder, no unit yet, an advisor line in the HUD', async () => {
      deep();
      const adv = Advice.computeNow();
      await frames(2);
      const rooms = L().coreRooms.map((r) => r.kind);
      const hudLine = $('hudAdvice');
      return eq([rooms.includes('stair') && rooms.includes('elevator') && rooms.includes('trash'), L().support.filter((b) => b.kind === 'remainder').length, L().units.length, adv.length > 0 && adv[0].code, visible(hudLine) && hudLine.textContent === adv[0].message], [true, 0, 0, 'plate-too-deep', true]);
    });

    /* ---- one list for the badge and the panels ---- */
    await t('the badge count equals the length of the warnings list (and of the Checks list); the HUD list shows the first three', () => {
      deep();
      const d = Derived.get();
      const badge = Number($('hudBadge').textContent.split(' ')[0]);
      const checks = $('checksWarnings').querySelectorAll('li:not(.none)').length;
      const hudList = $('warnList').querySelectorAll('li:not(.none)').length;
      const keys = d.warnings.map((w) => `${w.id}|${JSON.stringify(w.where)}`);
      return eq([d.warnings.length > 0, badge, checks, hudList, new Set(keys).size === keys.length, d.metrics.warnings.filter((w) => w.id !== 'stale-massing').length === d.warnings.length || 'metrics differ'], [true, d.warnings.length, d.warnings.length, Math.min(3, d.warnings.length), true, true]);
    });
    await t('the badge counts info warnings too: the bar 8.1 plate has none, so the badge reads 0 warnings', () => {
      flat();
      return eq([$('hudBadge').textContent, Derived.get().warnings.length], ['0 warnings', 0]);
    });

    /* ---- the mix table ---- */
    await t('the mix table hides a type with a target of 0 and none placed, and shows "does not fit at this depth" for a dropped type', () => {
      flat();
      const s = Store.snapshot();
      s.plate = { ...s.plate, d: 61.2 };                                        // runs about 26.8 ft deep: the 3BR cannot keep its area range
      s.core = { mode: 'none', rect: null };
      s.mix.multifamily[1].share = 0;                                          // 1BR: no target, none placed
      s.units = [];                                                            // draw-first: none placed (the bar 8.1 units would count)
      Store.replace(fillDefaults(s));
      UI.updateHud(Derived.get());
      const rows = [...$('mixTable').querySelectorAll('tbody tr')];
      const ids = rows.map((r) => r.dataset.type);
      const dropped = rows.find((r) => r.classList.contains('dropped'));
      const hud = [...$('hudMixTable').querySelectorAll('tbody tr')].map((r) => r.dataset.type);
      return eq([ids.includes('1br') ? ids : false, !!dropped && /does not fit at this depth/.test(dropped.textContent), dropped && dropped.dataset.type, hud.join() === ids.join()], [false, true, '3br', true]);
    });
    await t('the mix table keeps the color chips in one column (each first cell holds a swatch and a name)', () => {
      flat();
      const cells = [...$('mixTable').querySelectorAll('tbody td.type-cell')];
      return eq([cells.length > 0, cells.every((c) => c.querySelector('.sw') && c.querySelector('.type-name'))], [true, true]);
    });

    /* ---- the advisor card and the HUD ---- */
    await t('the Checks tab opens with the Efficiency card: the advisor list, the target depth field and the cautions', () => {
      deep();
      Advice.computeNow();
      const first = UI.sections().filter((s) => s.tab === 'checks')[0].id;
      UI.setTab('checks'); TestHelp.openSection('efficiency');
      const items = $('advList').querySelectorAll('li[data-adv]').length;
      const field = $('targetDepthField');
      field.value = `35'`; field.dispatchEvent(new Event('change'));
      const typed = Store.get('targetDepth');
      field.value = ''; field.dispatchEvent(new Event('change'));
      return eq([first, items, field.placeholder, typed, Store.get('targetDepth'), /Design-stage numbers/.test($('tabpanel-checks').textContent)], ['efficiency', Advice.get().list.length, 'Auto: 30 ft', 35, null, true]);
    });
    await t('the HUD shows "Units in range: a of b" when the metric exists', () => {
      flat();
      const row = $('mRangeRow');
      const m = Derived.get().hud;
      return eq([m.inRange === null || (!row.hidden && new RegExp(`^${m.inRange} of ${m.units}`).test($('mRange').textContent))], [true]);
    });

    /* ---- the help ---- */
    await t('the Help panel explains drawing (Paint, Suggest, Split, Merge, Clear level), the core program and the depth cap; no Re-fill or lock text', () => {
      const ok = Help.toggle();
      const text = $('helpPanel') ? $('helpPanel').textContent : '';
      Help.close();
      return eq([ok, /Paint/.test(text), /Suggest/.test(text), /Split/.test(text) && /Merge/.test(text), /Clear level/.test(text), /core program/.test(text), /Unit depth cap/.test(text), /Efficiency card/.test(text), /Re-fill|re-fill|Unlock|locked/.test(text)], [true, true, true, true, true, true, true, true, false]);
    });
  } finally {
    Select.clear();
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('rework', results);
  return results;
}

{
  const runAllBeforeRework = runAllTests;
  runAllTests = async function runAllTestsWithRework() {
    const r = await runAllBeforeRework();
    const rw = await runReworkTests();
    const failed = rw.filter((x) => !x.ok);
    r.results.push(...rw);
    r.failed.push(...failed);
    r.total += rw.length;
    r.passed += rw.length - failed.length;
    return r;
  };
}
