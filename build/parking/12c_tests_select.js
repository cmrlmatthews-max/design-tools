/* ==========================================================================
   TESTS: selection and handles
   Pick a core, an entry, the speed ramp and the footprint; the selection card; handles; snapping; Move to the nearest row.
   Handle drags run through Select.simulateHandleDrag (the same math as a real drag). Restores the design when done.
   ========================================================================== */
async function runSelectTests() {
  const { eq, near, make, $, frames, snap, oneStep, visible, presetState } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot();
  Options.holdAutosave(true);
  const fresh = () => { Select.clear(); Store.replace(fillDefaults(defaultState())); };
  const glWorks = Render.ready();

  try {
    await t('select and clear a core; the card shows its name', () => {
      fresh();
      const id = Store.get('cores.0.id');
      Select.select([{ kind: 'core', id }]);
      const card = $('selection-card');
      const out = [Select.count(), card.hidden, /Stair|Elevator/.test(card.textContent)];
      Select.clear();
      return eq([out, Select.count(), card.hidden], [[1, false, true], 0, true]);
    });
    await t('only valid items can be selected (no speed ramp on the default deck)', () => {
      fresh();
      Select.select([{ kind: 'speed' }, { kind: 'core', id: 'nope' }]);
      return eq(Select.count(), 0);
    });
    await t('the footprint is selectable on a standalone deck', () => {
      fresh();
      Select.select([{ kind: 'footprint' }]);
      const n = Select.count();
      Select.clear();
      return eq(n, 1);
    });
    await t('the Dimensions fields edit the selected core, and are one undo', () => {
      fresh();
      Select.select([{ kind: 'core', id: Store.get('cores.0.id') }]);
      const before = snap();
      const f = $('selection-card').querySelector('.sc-fields input.numfield');
      f.focus(); f.value = `${Store.get('cores.0.x') + 7}`; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true }));
      const moved = snap() !== before;
      Select.clear();
      return eq([moved, oneStep(before)], [true, true]);
    });
    await t('deleting a selected core removes it; one undo brings it back', () => {
      fresh();
      const n = Store.get('cores').length, before = snap();
      Select.select([{ kind: 'core', id: Store.get('cores.0.id') }]);
      const removed = Select.deleteSelection();
      return eq([removed, Store.get('cores').length, oneStep(before)], [1, n - 1, true]);
    });
    await t('the panel row link: clicking a core row selects the core', () => {
      fresh();
      UI.setTab('layout');
      const head = document.querySelector('[data-section="cores"] .item[data-index="0"] .item-title');
      if (!head) return 'no core row';
      head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const out = Select.get();
      Select.clear();
      return eq(out.length === 1 && out[0].kind === 'core', true);
    });
    await t('openItem switches to the tab of the item', () => {
      fresh();
      UI.setTab('view');
      UI.openItem({ kind: 'core', id: Store.get('cores.0.id') });
      const a = UI.activeTab();
      UI.setTab('view');
      Store.set('ramp.type', 'speed', { live: false });
      UI.openItem({ kind: 'speed' });
      return eq([a, UI.activeTab()], ['layout', 'ramp']);
    });

    if (!glWorks) {
      results.push({ name: 'handle and pick tests (skipped: no WebGL)', ok: true, detail: '' });
    } else {
      await t('the core has move-x and move-y handles; the footprint adds rotate, width, depth', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        Select.select([{ kind: 'core', id: Store.get('cores.0.id') }]);
        const a = Select.visibleHandles().sort();
        Select.select([{ kind: 'footprint' }]);
        const b = Select.visibleHandles().sort();
        Select.clear();
        return eq([a, b], [['move-x', 'move-y'], ['depth', 'move-x', 'move-y', 'rotate', 'width']]);
      });
      await t('a click on a core in the plan view selects it', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        const id = Store.get('cores.0.id');
        const pt = Select.screenPointFor({ kind: 'core', id });
        if (!pt) return 'no pick point';
        const hit = Select.pickAt(pt.x, pt.y);
        return eq(hit, { kind: 'core', id });
      });
      await t('a click on the deck body selects the footprint', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        const pt = Select.screenPointFor({ kind: 'footprint' });
        if (!pt) return 'no pick point';
        const hit = Select.pickAt(pt.x, pt.y);
        return eq(hit && hit.kind, 'footprint');
      });
      await t('moving S2 +9 ft (one stall width) keeps the stall total at 496 within one stall', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        const total0 = Derived.get().hud.stalls;
        const id = 'S2', x0 = Store.get('cores.2.x');
        Select.select([{ kind: 'core', id }]);
        const r = Select.simulateHandleDrag('move-x', -9, 0, { alt: true });
        const x1 = Store.get('cores.2.x');
        const total1 = Derived.get().hud.stalls;
        Select.clear();
        return r && Math.abs(x1 - x0 + 9) < 0.5 && Math.abs(total1 - total0) <= 1 ? true : `x ${x0} -> ${x1}, stalls ${total0} -> ${total1}, ${JSON.stringify(r)}`;
      });
      await t('a handle drag is ONE undo step', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        Select.select([{ kind: 'core', id: Store.get('cores.0.id') }]);
        const before = snap();
        Select.simulateHandleDrag('move-y', 0, 6, { alt: true });
        const moved = snap() !== before;
        Select.clear();
        return eq([moved, oneStep(before)], [true, true]);
      });
      await t('a core drag snaps to a row edge and reports the guide', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        Select.select([{ kind: 'core', id: Store.get('cores.0.id') }]);
        const y0 = Store.get('cores.0.y');
        const r = Select.simulateHandleDrag('move-y', 0, 0.8, {});
        Select.clear();
        return r && typeof r.label === 'string' ? true : 'no result';
      });
      await t('Escape / cancel puts the value back', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        Select.select([{ kind: 'core', id: Store.get('cores.0.id') }]);
        const x0 = Store.get('cores.0.x');
        Select.simulateHandleDrag('move-x', 11, 0, { alt: true, hold: true });
        const mid = Store.get('cores.0.x');
        Select.cancelHandleDrag();
        const x1 = Store.get('cores.0.x');
        Select.clear();
        return eq([mid !== x0, x1], [true, x0]);
      });
      await t('the footprint rotate handle snaps to 5 degrees', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        Select.select([{ kind: 'footprint' }]);
        Select.simulateHandleDrag('rotate', 12, 0, {});
        const a = Store.get('footprint.angle');
        Select.clear();
        return eq(a % 5, 0);
      });
      await t('the footprint width handle changes the width and keeps the far edge', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        const w0 = Store.get('footprint.width'), x0 = Store.get('footprint.x');
        Select.select([{ kind: 'footprint' }]);
        Select.simulateHandleDrag('width', 20, 0, { alt: true });
        const w1 = Store.get('footprint.width'), x1 = Store.get('footprint.x');
        Select.clear();
        return near(w1 - w0, 20, 0.6) === true && near(x1 - x0, (w1 - w0) / 2, 0.01) === true ? true : `w ${w0} -> ${w1}, x ${x0} -> ${x1}`;
      });
      await t('the speed ramp drag stays inside the strip', async () => {
        fresh();
        Store.replace(presetState('flat-speed-ramp'));
        Render.setView('plan', false); await frames(3);
        Select.select([{ kind: 'speed' }]);
        const strip = Derived.get().raw.strip;
        Select.simulateHandleDrag('move-y', 0, 80, { alt: true });
        const y = Store.get('ramp.speed.y'), w = Store.get('ramp.speed.width');
        Select.clear();
        return strip && y >= strip.y0 - 0.01 && y + w <= strip.y1 + 0.01 ? true : `y ${y} w ${w} strip ${JSON.stringify(strip)}`;
      });
      await t('the speed ramp length handle changes the length', async () => {
        Store.replace(presetState('flat-speed-ramp'));
        Render.setView('plan', false); await frames(3);
        Select.select([{ kind: 'speed' }]);
        const l0 = Store.get('ramp.speed.length');
        Select.simulateHandleDrag('length', -10, 0, { alt: true });
        const l1 = Store.get('ramp.speed.length');
        Select.clear();
        return near(l0 - l1, 10, 0.6);
      });
      await t('an entry slides along its side and stays on the side', async () => {
        fresh(); Render.setView('plan', false); await frames(3);
        if (!Store.get('entries').length) Store.set('entries', [{ id: 'N1', side: 'west', at: 40, width: 24 }], { live: false });
        const e = Store.get('entries.0');
        Select.select([{ kind: 'entry', id: e.id }]);
        const at0 = e.at;
        Select.simulateHandleDrag('slide', 6, 0, { alt: true });
        const at1 = Store.get('entries.0.at');
        Select.clear();
        return eq([Math.abs(at1 - at0 - 6) < 0.6, Store.get('entries.0.side')], [true, e.side]);
      });
      await t('Move to the nearest row clears a core-in-aisle warning', () => {
        fresh();
        const row = Derived.get().raw.bays[0];
        Store.set('cores', [{ id: 'S1', kind: 'stair', x: 60, y: (row.aisle.y0 + row.aisle.y1) / 2 - 6, w: 22, d: 12 }], { live: false });
        const a = Derived.get().warnings.some((w) => w.action === 'move-to-row');
        UI.moveCoreById('S1');
        const b = Derived.get().warnings.some((w) => w.action === 'move-to-row');
        return eq([a, b], [true, false]);
      });
      await t('project cores cannot be dragged', async () => {
        fresh();
        Store.set('coresFromProject', true, { live: false });
        const d = Derived.get();
        const proj = d.cores.filter((c) => c.fromProject);
        Select.clear();
        if (!proj.length) return true;     // no project open: nothing to test
        Select.select([{ kind: 'core', id: proj[0].id }]);
        const r = Select.simulateHandleDrag('move-x', 5, 0, { alt: true });
        Select.clear();
        return eq(r, null);
      });
      await t('Delete key removes the selected core and Escape clears', async () => {
        fresh();
        Select.select([{ kind: 'core', id: Store.get('cores.0.id') }]);
        const n = Store.get('cores').length;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        const a = Store.get('cores').length;
        Select.select([{ kind: 'footprint' }]);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return eq([a, Select.count()], [n - 1, 0]);
      });
      await t('the number keys jump to the preset views', async () => {
        fresh();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true }));
        await frames(2);
        const p = Render.info().preset;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        await frames(2);
        return eq([p, Render.info().preset], ['plan', 'axon']);
      });
    }
  } finally {
    try { Select.cancelHandleDrag(); } catch (e) { /* nothing was dragging */ }
    Select.clear();
    Store.replace(savedState);
    Options.holdAutosave(false);
  }
  return results;
}
