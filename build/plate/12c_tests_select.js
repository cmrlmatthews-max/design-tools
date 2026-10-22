/* ==========================================================================
   TESTS: selecting and editing  (plan section 9.2 "Editing")
   Pick a unit by a click (plane math), the selection card, a bay drag of 2 ft (two widths change, NRSF stays), a drag past a neighbor's
   minimum (refused), a lock that survives Re-fill, a type change that re-solves its run, moving and deleting blocks, and the pointer
   drag of a bay line. They change the design on screen and put it back at the end.
   ========================================================================== */
async function runSelectTests() {
  const { eq, near, make, $, frames, wait, visible } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const fresh = () => { Select.clear(); Store.replace(fillDefaults(defaultState())); UI.updateHud(Derived.get()); };
  const L = () => Derived.get().editing;
  const nrsf = () => Derived.get().hud.nrsf;
  const widthOf = (u) => Math.round(Math.abs(Select.frameOf(L().units.indexOf(u)).w) * 1000) / 1000;
  /** The bay edge with the most room (the first one with at least `room` ft either way). */
  const southBay = (room = 0) => {
    const bays = Select.bays();
    let best = null;
    bays.forEach((b, i) => {
      const lim = Select.bayLimits(i), r = Math.max(lim.fwd, -lim.back);
      if (!best || (best.r < room && r > best.r)) best = { i, b, r, lim };
    });
    return best;
  };
  try {
    fresh();
    if (Render.ready()) Render.setView('plan', false);
    await frames(3);

    await t('the default plate has bay lines between neighbors (17 units: at least 12 bay lines)', () => eq(Select.bays().length >= 12, true));

    /* ---- picking ---- */
    if (Render.ready()) {
      await t('a click on a unit selects it and the card shows its type, area and a lock button', async () => {
        const u = L().units[0];
        const c = ringCentroidXY(u.outer);
        const p = Select.screenOf(c[0], c[1]);
        Select.click(p.x, p.y);
        await frames(2);
        const sel = Select.get();
        const card = $('selection-card');
        return eq([sel && sel.kind, sel && sel.k, visible(card), /sf/.test(card.textContent), !!card.querySelector('[data-action="lock"]'), card.querySelectorAll('#itemTypes .chip').length], ['unit', 0, true, true, true, 5]);
      });
      await t('a click on empty ground clears the selection', async () => {
        const p = Select.screenOf(-400, 200);
        Select.click(p.x, p.y);
        return eq(Select.get(), null);
      });
      await t('a click on the core selects the core; a click on a unit after it selects the unit', async () => {
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
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return eq(Select.get(), null);
      });
    }

    /* ---- the bay drag ---- */
    await t('a bay drag of 2 ft changes two widths by 2 ft and keeps NRSF', () => {
      fresh();
      const s = southBay(2);
      if (!s) return 'no south bay';
      const before = nrsf(), A = L().units[s.b.a], B = L().units[s.b.b];
      const wa = widthOf(A), wb = widthOf(B);
      const lim = s.lim;
      const d = lim.fwd >= 2 ? 2 : (lim.back <= -2 ? -2 : 0);
      if (!d) return `no room to move: limits ${JSON.stringify(lim)}`;
      const ok = Select.moveBay(s.i, d);
      const units = L().units;
      const lockedAt = units.map((u, k) => (u.locked ? k : -1)).filter((k) => k >= 0);
      const wa2 = widthOf(units[s.b.a]), wb2 = widthOf(units[s.b.b]);
      return eq([ok, lockedAt, Select.locks().length, Math.round(Math.abs(wa2 - wa) * 100) / 100, Math.round(Math.abs(wb2 - wb) * 100) / 100, Math.abs(nrsf() - before) < 0.2], [true, [s.b.a, s.b.b].sort((x, y) => x - y), 2, 2, 2, true]);
    });
    await t('the bay drag is one undo step', () => {
      fresh();
      const s = southBay(1);
      const before = TestHelp.snap();
      Select.moveBay(s.i, s.lim.fwd >= 1 ? 1 : -1);
      return eq([Select.locks().length, TestHelp.oneStep(before)], [2, true]);
    });
    await t('a drag past a neighbor\'s minimum is refused: nothing changes', () => {
      fresh();
      const s = southBay();
      const before = TestHelp.snap();
      const lim = Select.bayLimits(s.i);
      const ok = Select.moveBay(s.i, lim.fwd + 3), ok2 = Select.moveBay(s.i, lim.back - 3);
      return eq([ok, ok2, TestHelp.snap() === before, Select.locks().length], [false, false, true, 0]);
    });
    await t('the limits are the widths each type allows: a 1BR (24 to 28 ft) stays inside its range after a drag to the limit', () => {
      fresh();
      const s = southBay();
      const lim = Select.bayLimits(s.i);
      const d = lim.fwd > 0.2 ? lim.fwd - 0.01 : lim.back + 0.01;
      const ok = Select.moveBay(s.i, d);
      const flagged = L().units.filter((u) => u.flagged).length;
      return eq([ok, flagged], [true, 0]);
    });

    /* ---- locks ---- */
    await t('L locks the selected unit: an amber lock appears; L again unlocks', () => {
      fresh();
      Select.selectUnit(1);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
      const a = [Select.locks().length, L().units[1].locked];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
      return eq([a, Select.locks().length], [[1, true], 0]);
    });
    await t('a lock survives Re-fill: the outline and the type do not change while the others re-solve', () => {
      fresh();
      Select.toggleLock(1); Select.toggleLock(4);
      const keep = Select.locks().map((l) => JSON.stringify([l.outer, l.type]));
      const unitsBefore = L().units.length;
      Store.set('mix.multifamily.3.share', 0.5, { live: false });
      Store.set('mix.multifamily.1.share', 0.25, { live: false });
      Select.refill();
      const after = L().units.filter((u) => u.locked).map((u) => JSON.stringify([Select.locks().find((l) => JSON.stringify(l.outer) === JSON.stringify(u.outer)) ? u.outer : null, u.type]));
      const kept = keep.every((k) => after.includes(k));
      const n2 = L().units.filter((u) => u.type === '2br').length;
      return eq([Select.locks().length, kept, n2 >= 5, unitsBefore > 0], [2, true, true, true]);
    });
    await t('Unlock all removes the locks and the plate returns to the plain fill', () => {
      fresh();
      Select.toggleLock(1); Select.toggleLock(2);
      const had = Select.locks().length;
      Select.unlockAll();
      return eq([had, Select.locks().length, Derived.get().hud.units, Math.abs(nrsf() - 15077.8) <= 0.5], [2, 0, 17, true]);
    });

    /* ---- type change ---- */
    await t('a type change from the card re-solves the run: the unit takes the new type and the run still fills', () => {
      fresh();
      const k = L().units.findIndex((u) => u.type === '1br');
      const r = Select.setUnitType(k, 'studio');
      const d = Derived.get();
      const bad = d.warnings.filter((w) => w.id === 'run-too-short').length;
      return eq([r.ok, Select.locks().length, Select.locks()[0].type, bad, d.hud.units >= 16], [true, 1, 'studio', 0, true]);
    });
    await t('the type chips of the card change the type of the selected unit', () => {
      fresh();
      const k = L().units.findIndex((u) => u.type === '1br');
      Select.selectUnit(k);
      const chip = $('itemTypes').querySelector('[data-type="2br"]');
      chip.click();
      const sel = Select.get();
      const u = sel && sel.kind === 'unit' ? L().units[sel.k] : null;
      return eq([!!u, u && u.type, u && u.locked], [true, '2br', true]);
    });
    await t('a type that does not fit the depth is refused by the card (no lock is made)', () => {
      fresh();
      Store.set('plate.d', 55, { live: false });
      const before = Select.locks().length;
      const r = Select.setUnitType(0, '3br');
      return eq([r.ok === false, Select.locks().length - before], [true, 0]);
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
      return eq([ok, added, moved, Store.get('support').length, Derived.get().hud.units], [true, 1, [-100, -31, -92, -21], 0, 17]);
    });
    await t('moving a stair switches the stairs to Manual and the fill follows', () => {
      fresh();
      const st = L().stairs[0];
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
      await t('a pointer drag on a bay line moves it: two units lock and NRSF stays', async () => {
        fresh();
        Store.set('view.bays', true, { live: false });
        Render.setView('plan', false);
        await frames(3);
        const s = southBay();
        const lim = Select.bayLimits(s.i);
        const sgn = lim.fwd >= 2 ? 1 : -1;
        const mid = s.b.mid, t0 = s.b.t;
        const a = Select.bayScreen(s.i), z = Select.screenOf(mid[0] + t0[0] * 2 * sgn, mid[1] + t0[1] * 2 * sgn, 0.9);
        const c = Render.canvas();
        const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y }));
        const before = nrsf();
        ev('pointerdown', a.x, a.y);
        ev('pointermove', a.x + (z.x - a.x) / 2, a.y + (z.y - a.y) / 2);
        ev('pointermove', z.x, z.y);
        ev('pointerup', z.x, z.y);
        await frames(2);
        return eq([Select.locks().length, Math.abs(nrsf() - before) < 0.5 || `${before} -> ${nrsf()}`, Render.orbitEnabled()], [2, true, true]);
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
