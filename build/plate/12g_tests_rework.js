/* ==========================================================================
   TESTS: the rework  (docs/plate-planner-rework-plan.md sections 7 and 8.2)
   Split, merge, fill an unfilled run, draw a unit, the unit depth cap, reset the core, the badge count against the list, the mix table
   without empty rows, the core mode controls, the elevator count field, the advisor lines, and the width limits of a bay drag.
   They change the design on screen and put it back at the end.
   ========================================================================== */
async function runReworkTests() {
  const { eq, make, $, frames, wait, visible, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const L = () => Derived.get().editing;
  const flat = () => { Select.clear(); Store.replace(fillDefaults(defaultState())); UI.updateHud(Derived.get()); };
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
  /** The default bar with two storage blocks 15 ft apart in the south run: the stretch between them is an unfilled run. */
  const withGap = () => {
    const s = fillDefaults(defaultState());
    s.support = [{ id: 'B1', kind: 'storage', rect: [60, -32.5, 70, -20] }, { id: 'B2', kind: 'storage', rect: [85, -32.5, 95, -20] }];
    Select.clear();
    Store.replace(s);
    UI.updateHud(Derived.get());
  };
  const mixOf = (id) => Store.get('mix.multifamily').find((x) => x.id === id);
  const widthOfUnit = (k) => Math.round(Select.frameOf(k).w * 1000) / 1000;
  try {
    flat();
    if (Render.ready()) Render.setView('plan', false);
    await frames(3);

    /* ---- split ---- */
    await t('split: a 36 ft unit becomes two locked units of 18 ft; the unit count of the run stays; one undo step', () => {
      flat();
      const k = L().units.findIndex((u) => Select.frameOf(L().units.indexOf(u)).w > 30);
      const w = widthOfUnit(k);
      const before = snap();
      const r = Select.splitUnit(k);
      const locks = Select.locks();
      const ws = locks.map((l) => Math.round(Math.abs(Math.max(...l.outer.map((p) => p[0])) - Math.min(...l.outer.map((p) => p[0]))) * 100) / 100);
      return eq([r.ok, locks.length, ws.every((x) => Math.abs(x - w / 2) < 0.05) || ws, oneStep(before)], [true, 2, true, true]);
    });
    await t('split: each half takes the type whose width range holds the half width (a 48 ft unit gives two 24 ft units of a type that fits)', () => {
      flat();
      const u = L().units.find((x) => x.type === '3br' && Select.frameOf(L().units.indexOf(x)).w >= 40);
      if (!u) return 'no 3BR';
      const r = Select.splitUnit(L().units.indexOf(u));
      const t0 = mixOf(r.types[0]);
      return eq([r.ok, r.widths[0] >= t0.widthMin - 0.01 && r.widths[0] <= t0.widthMax + 0.01], [true, true]);
    });
    await t('split: the Split button is on the unit card and works', () => {
      flat();
      const k = 0;
      Select.selectUnit(k);
      const btn = $('selection-card').querySelector('[data-action="split"]');
      const n0 = Select.locks().length;
      if (btn && !btn.disabled) btn.click();
      return eq([!!btn, n0, Select.locks().length], [true, 0, 2]);
    });
    /* ---- merge ---- */
    await t('merge: Merge right joins a unit with its neighbor into one lock (one piece, the widths add); one undo step', () => {
      flat();
      const k = L().units.findIndex((u, i) => Select.neighbors(i)['1'] !== null && Select.neighbors(i)['1'] !== undefined);
      const j = Select.neighbors(k)['1'];
      const w = widthOfUnit(k) + widthOfUnit(j);
      const nrsf0 = Derived.get().hud.nrsf;
      const before = snap();
      const r = Select.mergeUnit(1, k);
      const locks = Select.locks();
      const lw = locks.length ? Math.abs(Math.max(...locks[0].outer.map((p) => p[0])) - Math.min(...locks[0].outer.map((p) => p[0]))) : 0;
      return eq([r.ok, locks.length, Math.abs(lw - w) < 0.05 || `${lw} vs ${w}`, Math.abs(Derived.get().hud.nrsf - nrsf0) < 1 || `${nrsf0} -> ${Derived.get().hud.nrsf}`, oneStep(before)], [true, 1, true, true, true]);
    });
    await t('merge: both Merge buttons are on the unit card; an end unit has one neighbor on a run, and the button is off without a neighbor', () => {
      flat();
      Select.selectUnit(0);
      const card = $('selection-card');
      const l = card.querySelector('[data-action="merge-left"]'), r = card.querySelector('[data-action="merge-right"]');
      return eq([!!l, !!r, l && r && (l.disabled || r.disabled)], [true, true, true]);
    });

    /* ---- fill a remainder ---- */
    await t('fill an unfilled run: a 15 ft gap is a remainder; a type chip fills it with one locked unit; one undo step', () => {
      withGap();
      const rem = Select.remainders();
      if (rem.length !== 1) return `remainders: ${rem.length}`;
      const before = snap();
      const r = Select.fillRemainder(rem[0].id, { type: 'studio' });
      return eq([Math.round(rem[0].length * 10) / 10, r.ok, r.count, Select.remainders().length, Select.locks().length, Select.locks()[0] && Select.locks()[0].type, oneStep(before)], [15, true, 1, 0, 1, 'studio', true]);
    });
    await t('fill an unfilled run: a tap selects it, the card shows its length, and "1 unit" is active once a width range holds 15 ft', () => {
      withGap();
      const p = Select.screenOf(77.5, -15);
      if (Render.ready()) Select.click(p.x, p.y); else Select.select({ kind: 'remainder', id: Select.remainders()[0].id });
      const sel = Select.get();
      const card = $('selection-card');
      const off = card.querySelector('[data-action="fill-1"]');
      const offBefore = off && off.disabled;
      Store.set('mix.multifamily.0.widthMin', 12, { live: false });          // a studio may now be 12 ft wide: one unit fits
      Select.select({ kind: 'remainder', id: Select.remainders()[0].id });
      const on = card.querySelector('[data-action="fill-1"]');
      const n0 = Select.locks().length;
      if (on && !on.disabled) on.click();
      return eq([sel && sel.kind, /15'/.test(card.textContent) || card.textContent.slice(0, 120), offBefore, Select.locks().length - n0, Select.remainders().length], ['remainder', true, true, 1, 0]);
    });
    await t('fill an unfilled run: two units split a long run evenly (the pieces are equal)', () => {
      withGap();
      const rem = Select.remainders()[0];
      const r = Select.fillRemainder(rem.id, { count: 2 });
      const ws = Select.locks().map((l) => Math.round((Math.max(...l.outer.map((p) => p[0])) - Math.min(...l.outer.map((p) => p[0]))) * 100) / 100);
      return eq([r.ok, ws.length, Math.abs(ws[0] - ws[1]) < 0.02 || ws, Math.abs(ws[0] - 7.5) < 0.02 || ws], [true, 2, true, true]);
    });

    /* ---- draw a unit ---- */
    await t('draw a unit: two points on one run make a locked unit between the two cut lines with the best-fit type; one undo step', () => {
      flat();
      const before = snap();
      const r = Select.drawUnitBetween([-100, -15], [-76, -15]);
      const lk = Select.locks();
      return eq([r.ok, lk.length, r.type, Math.abs(r.width - 24) < 0.01, oneStep(before)], [true, 1, '1br', true, true]);
    });
    await t('draw a unit: the Draw unit tool takes two taps and ends; points on two different runs are refused', () => {
      flat();
      Select.startDraw('unit', { label: 'a unit' });
      const started = Select.drawing() && Select.drawing().kind;
      Select.drawPoint(-100, -15);
      Select.drawPoint(-76, -15);
      Select.finishDraw();
      const made = Select.locks().length;
      flat();
      const bad = Select.drawUnitBetween([-100, -15], [-76, 15]);
      return eq([started, Select.drawing(), made, bad.ok, Select.locks().length], ['unit', null, 1, false, 0]);
    });

    /* ---- the unit depth cap ---- */
    await t('depth cap: 30 ft on a deep plate cuts the units to 30 ft, makes trim support, and the areas close', () => {
      deep();
      const s0 = Derived.get();
      const uncapped = L().units.filter((u) => u.runId).map((u, i) => Select.frameOf(L().units.indexOf(u)).d);
      const maxBefore = Math.max(...uncapped);
      Store.set('fill.maxDepth', 30, { live: false });
      const d = Derived.get();
      const depths = L().units.filter((u) => u.runId).map((u) => Select.frameOf(L().units.indexOf(u)).d);
      const trims = L().support.filter((b) => b.kind === 'trim').length;
      return eq([maxBefore > 40, Math.max(...depths) <= 30.01 || Math.max(...depths), trims > 0, d.hud.closure && d.hud.closure.ok, d.ok, s0.ok], [true, true, true, true, true, true]);
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
      return eq([auto0 > 0, manual, moved, back, oneStep(afterDrag)], [true, ['manual', true, 0], true, ['auto', null, true], true]);
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
    await t('a deep point plate: labeled core rooms, no unfilled run, no large hatch, large units, an advisor line in the HUD', async () => {
      deep();
      const adv = Advice.computeNow();
      await frames(2);
      const rooms = L().coreRooms.map((r) => r.kind);
      const big = L().units.filter((u) => u.areaHigh).length;
      const hudLine = $('hudAdvice');
      return eq([rooms.includes('stair') && rooms.includes('elevator') && rooms.includes('trash'), L().support.filter((b) => b.kind === 'remainder').length, big === L().units.length, adv.length > 0 && adv[0].code, visible(hudLine) && hudLine.textContent === adv[0].message], [true, 0, true, 'plate-too-deep', true]);
    });

    /* ---- one list for the badge and the panels ---- */
    await t('the badge count equals the length of the warnings list (and of the Checks list); the HUD list shows the first three', () => {
      deep();
      const d = Derived.get();
      const badge = Number($('hudBadge').textContent.split(' ')[0]);
      const checks = $('checksWarnings').querySelectorAll('li:not(.none)').length;
      const hudList = $('warnList').querySelectorAll('li:not(.none)').length;
      const keys = d.warnings.map((w) => `${w.id}|${JSON.stringify(w.where)}`);
      return eq([d.warnings.length > 3, badge, checks, hudList, new Set(keys).size === keys.length, d.metrics.warnings.length, !$('warnAll').hidden], [true, d.warnings.length, d.warnings.length, 3, true, d.warnings.length, true]);
    });
    await t('the badge counts info warnings too: the default plate has none, so the badge reads 0 warnings', () => {
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

    /* ---- the bay drag ---- */
    await t('a bay drag uses the width range: a drag to the limit keeps both widths in the range of their types, and may leave the area range', () => {
      flat();
      const bays = Select.bays();
      let found = null;
      for (let i = 0; i < bays.length && !found; i++) {
        const lim = Select.bayLimits(i);
        for (const d of [lim.fwd - 0.02, lim.back + 0.02]) {
          if (Math.abs(d) < 0.3) continue;
          const before = snap();
          Select.moveBay(i, d);
          const u = [L().units[bays[i].a], L().units[bays[i].b]];
          const tw = u.map((x) => { const ty = mixOf(x.type); const w = widthOfUnit(L().units.indexOf(x)); return w >= ty.widthMin - 0.01 && w <= ty.widthMax + 0.01; });
          if (u.some((x) => x.flagged) && tw.every(Boolean)) found = { i, d };
          Store.undo();
          if (snap() !== before) Store.replace(JSON.parse(before));
          if (found) break;
        }
      }
      return eq(!!found, true);
    });

    /* ---- the help ---- */
    await t('the Help panel explains the deep-run rule, the core program and the new tools', () => {
      const ok = Help.toggle();
      const text = $('helpPanel') ? $('helpPanel').textContent : '';
      Help.close();
      return eq([ok, /Deep runs/.test(text), /core program/.test(text), /Split/.test(text) && /Merge/.test(text), /Unfilled/.test(text), /Draw unit/.test(text), /Unit depth cap/.test(text), /Efficiency card/.test(text)], [true, true, true, true, true, true, true, true]);
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
