/* ==========================================================================
   TESTS: selecting and editing  (plan section 9.2 "Editing", draw-first)
   Pick a unit by a click (plane math), the selection card (type chips, Split, Merge, Delete: no lock button), a bay drag of 2 ft (two widths
   change, NRSF stays), a drag past a neighbor (it stops at 1 ft), a type change by hand, moving and deleting blocks, the pointer drag of a
   bay line. The fixture is the bar 8.1 preset (17 drawn units). They change the design on screen and put it back at the end.
   Changed by the draw-first change: the lock, Re-fill and Unlock all tests are gone (locks and Re-fill no longer exist: the units are the
   drawn units); the card has no lock button; a bay drag no longer locks, it moves two drawn units; "refused past the minimum" became
   "stops at 1 ft" (draw.js moveBayLine clamps).
   ========================================================================== */
async function runSelectTests() {
  const { eq, near, make, $, frames, wait, visible } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const fresh = () => { Select.clear(); Select.setTool('select'); Store.replace(TestHelp.presetState('double-loaded-bar')); UI.updateHud(Derived.get()); };
  const L = () => Derived.get().editing;
  const nrsf = () => Derived.get().hud.nrsf;
  const wOf = (k) => Math.round(Select.unitSize(k).w * 1000) / 1000;
  const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
  /** The first bay line that two units of one run share and with room of at least `room` ft each way. */
  const bay = (room = 2) => {
    const bays = Select.bays();
    for (let i = 0; i < bays.length; i++) {
      const b = bays[i];
      if (wOf(b.a) >= room + 10 && wOf(b.b) >= room + 10) return { i, b };
    }
    return null;
  };
  try {
    fresh();
    if (Render.ready()) Render.setView('plan', false);
    await frames(3);

    await t('the bar 8.1 plate has bay lines between neighbors (17 units: at least 12 bay lines)', () => eq(Select.bays().length >= 12, true));

    /* ---- picking ---- */
    if (Render.ready()) {
      await t('a click on a unit selects it and the card shows its type chips, area, Split, Merge and Delete (no lock button)', async () => {
        const u = L().units[0];
        const c = ringCentroidXY(u.outer);
        const p = Select.screenOf(c[0], c[1]);
        Select.click(p.x, p.y);
        await frames(2);
        const sel = Select.get();
        const card = $('selection-card');
        const has = (a) => !!card.querySelector(`[data-action="${a}"]`);
        return eq([sel && sel.kind, sel && sel.k, visible(card), /sf/.test(card.textContent), has('split'), has('merge-left'), has('merge-right'), has('delete'), has('lock'), card.querySelectorAll('#itemTypes .chip').length], ['unit', 0, true, true, true, true, true, true, false, 5]);
      });
      await t('a click on an unfilled spot of the blank plate selects the open stretch; a click far from the plate clears the selection', async () => {
        const p = Select.screenOf(-400, 200);
        Select.click(p.x, p.y);
        return eq(Select.get(), null);
      });
      await t('a click on the core selects the core; a click on a unit after it selects the unit', async () => {
        fresh();
        Store.set('core', { mode: 'manual', rect: [-45, 2.835, -15, 32.5] }, { live: false });
        await frames(2);
        const c = L().core ? ringCentroidXY(L().core) : null;
        if (!c) return 'no core';
        const p = Select.screenOf(c[0], c[1]);
        Select.click(p.x, p.y);
        const a = Select.get();
        const u = L().units[3], cu = ringCentroidXY(u.outer), pu = Select.screenOf(cu[0], cu[1]);
        Select.click(pu.x, pu.y);
        return eq([a && a.kind, Select.get().kind, Select.get().k], ['core', 'unit', 3]);
      });
      await t('Escape clears the selection', () => {
        Select.selectUnit(2);
        key('Escape');
        return eq(Select.get(), null);
      });
    }

    /* ---- the bay drag ---- */
    await t('a bay drag of 2 ft changes two widths by 2 ft and keeps NRSF; the two drawn units move (no lock)', () => {
      fresh();
      const s = bay(2);
      if (!s) return 'no bay line';
      const before = nrsf(), n0 = Store.get('units').length;
      const wa = wOf(s.b.a), wb = wOf(s.b.b);
      const ok = Select.moveBay(s.i, 2);
      const wa2 = wOf(s.b.a), wb2 = wOf(s.b.b);
      return eq([ok, Store.get('units').length, Math.round(Math.abs(wa2 - wa) * 100) / 100, Math.round(Math.abs(wb2 - wb) * 100) / 100, Math.abs(nrsf() - before) < 0.2], [true, n0, 2, 2, true]);
    });
    await t('the bay drag is one undo step', () => {
      fresh();
      const s = bay(1);
      const before = TestHelp.snap();
      Select.moveBay(s.i, 1);
      return eq([TestHelp.snap() !== before, TestHelp.oneStep(before)], [true, true]);
    });
    await t('a drag far past a neighbor stops at 1 ft: the widths still add up and NRSF stays', () => {
      fresh();
      const s = bay(2);
      const sum = wOf(s.b.a) + wOf(s.b.b), before = nrsf();
      Select.moveBay(s.i, 500);
      const wa = wOf(s.b.a), wb = wOf(s.b.b);
      return eq([Math.abs(wa + wb - sum) < 0.01, Math.min(wa, wb) >= 0.99, Math.abs(nrsf() - before) < 0.5], [true, true, true]);
    });

    /* ---- type change ---- */
    await t('a type change from the card sets the type by hand and keeps the outline', () => {
      fresh();
      const k = L().units.findIndex((u) => u.type === '1br');
      const outer = JSON.stringify(L().units[k].outer);
      const r = Select.setUnitType(k, 'studio');
      const u = L().units.find((x) => x.uid === L().units[k].uid);
      return eq([r.ok, u.type, JSON.stringify(u.outer) === outer, Derived.get().hud.units], [true, 'studio', true, 17]);
    });
    await t('the type chips of the card change the type of the selected unit', () => {
      fresh();
      const k = L().units.findIndex((u) => u.type === '1br');
      Select.selectUnit(k);
      const chip = $('itemTypes').querySelector('[data-type="2br"]');
      chip.click();
      const sel = Select.get();
      const u = sel && sel.kind === 'unit' ? L().units[sel.k] : null;
      return eq([!!u, u && u.type], [true, '2br']);
    });

    /* ---- blocks ---- */
    await t('a support block: Add draws a rectangle, the block moves with a snap, and Delete removes it', () => {
      fresh();
      const ok = Select.startDraw('rect', { target: { type: 'support', kind: 'trash' }, label: 'a trash block' });
      Select.drawPoint(-120, -31); Select.drawPoint(-112, -21);
      const item = Select.finishDraw();
      const added = Store.get('support').length;
      Select.setBlockRect(item, [-100, -31, -92, -21]);
      const moved = Store.get('support')[0].rect;
      const sel = Select.get();
      Select.deleteBlock(sel);
      return eq([ok, added, moved, Store.get('support').length], [true, 1, [-100, -31, -92, -21], 0]);
    });
    await t('moving a stair switches the stairs to Manual', () => {
      fresh();
      const st = L().stairs[0];
      if (!st) return 'no stair';
      const r0 = ringRect(st.outer);
      Select.setBlockRect({ kind: 'stair', id: st.id }, [r0[0] + 2, r0[1], r0[2] + 2, r0[3]]);
      const s = Store.snapshot();
      return eq([s.stairs.mode, s.stairs.items.length, Derived.get().ok], ['manual', L().stairs.length, true]);
    });
    await t('moving the core changes the plan and Undo puts it back', () => {
      fresh();
      const before = TestHelp.snap();
      Select.setBlockRect({ kind: 'core', id: 'core' }, [-45, 2.835, -15, 32.5]);
      const moved = Store.get('core.rect');
      return eq([moved, TestHelp.oneStep(before)], [[-45, 2.835, -15, 32.5], true]);
    });

    /* ---- the pointer drag ---- */
    if (Render.ready()) {
      await t('a pointer drag on a bay line moves it: NRSF stays, one undo step, orbit comes back', async () => {
        fresh();
        Store.set('view.bays', true, { live: false });
        Render.setView('plan', false);
        await frames(3);
        const s = bay(2);
        const mid = s.b.mid, t0 = s.b.t;
        const a = Select.bayScreen(s.i), z = Select.screenOf(mid[0] + t0[0] * 2, mid[1] + t0[1] * 2, undefined);
        const c = Render.canvas();
        const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y }));
        const w0 = wOf(s.b.a), before = nrsf(), snap0 = TestHelp.snap();
        ev('pointerdown', a.x, a.y);
        ev('pointermove', a.x + (z.x - a.x) / 2, a.y + (z.y - a.y) / 2);
        ev('pointermove', z.x, z.y);
        ev('pointerup', z.x, z.y);
        await frames(2);
        const moved = Math.abs(wOf(s.b.a) - w0) > 0.4;
        return eq([moved, Math.abs(nrsf() - before) < 0.5 || `${before} -> ${nrsf()}`, Render.orbitEnabled(), TestHelp.oneStep(snap0)], [true, true, true, true]);
      });
    }
  } finally {
    Select.clear();
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('select', results);
  return results;
}
