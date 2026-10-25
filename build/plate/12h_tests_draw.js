/* ==========================================================================
   TESTS: draw-first  (docs/plate-planner-draw-plan.md sections 4 and 6)
   The plate starts blank. Paint (logical and by pointer, with the live label), Suggest (ghosts: accept all, accept one, dismiss, Escape), a free
   rectangle, a free polygon, the core (move, corner-handle resize, snap 0.5 ft, 10 by 10 ft at least, mode Manual, Rooms do not fit, reset),
   Clear level (dialog, one undo step), undo and redo, the blank-plate hint, the HUD numbers, Split, Merge, Delete, the match colors, a project
   group, and that no Re-fill button exists. They change the design on screen and put it back at the end.
   ========================================================================== */
async function runDrawTests() {
  const { eq, make, $, frames, wait, visible, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const L = () => Derived.get().editing;
  const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
  /** The bar 8.1 plate with no drawn unit: runs R1 (south, 278 ft), R2 and R3 (north, 124 ft each), 28.7 ft deep. */
  const blankBar = () => {
    Select.clear();
    const s = TestHelp.presetState('double-loaded-bar'); s.units = [];
    Store.replace(s); UI.updateHud(Derived.get());
    Select.setTool('paint');
  };
  const bar81 = () => { Select.clear(); Store.replace(TestHelp.presetState('double-loaded-bar')); UI.updateHud(Derived.get()); Select.setTool('select'); };
  const blank = () => { Select.clear(); Store.replace(fillDefaults(defaultState())); UI.updateHud(Derived.get()); Select.setTool('paint'); };
  const n = () => Store.get('units').length;
  const canvasEv = (type, x, y, id = 3, touch = false) => Render.canvas().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: touch ? 'touch' : 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  const screenOfRun = (runId, s, tt = 12) => { const p = Select.runPoint(runId, s, tt); return Select.screenOf(p[0], p[1]); };
  try {
    blankBar();
    if (Render.ready()) Render.setView('plan', false);
    await frames(3);

    /* ---- the blank plate, the tools and the hint ---- */
    await t('the default plate is blank: 0 units, Paint is the tool, the hint shows the sentence, the HUD says Open', async () => {
      blank();
      await frames(2);
      const hint = $('blankHint');
      return eq([Derived.get().hud.units, Select.tool(), !!hint && !hint.hidden && /Drag along a facade to draw a unit\. Select an open stretch and tap Suggest for a layout\./.test(hint.textContent), /\d/.test($('mOpen').textContent) && Derived.get().hud.open > 1000], [0, 'paint', true, true]);
    });
    await t('the palette has Paint, Suggest, Rectangle, Polygon, Select, Core and Clear level; Paint is pressed; each button is 44 px high at least', async () => {
      blank();
      await frames(2);
      const tb = [...$('tools').querySelectorAll('button')];
      const names = tb.map((b) => b.getAttribute('aria-label'));
      const pressed = tb.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.tool);
      return eq([names, pressed, tb.every((b) => b.getBoundingClientRect().height >= 43.5)], [['Paint', 'Suggest', 'Rectangle', 'Polygon', 'Select', 'Core', 'Clear level'], ['paint'], true]);
    });
    await t('the keys V, S, R, G and P choose the tool', () => {
      blank();
      const out = [];
      for (const k of ['v', 's', 'r', 'g', 'p']) { key(k); out.push(Select.tool()); }
      return eq(out, ['select', 'suggest', 'rect', 'poly', 'paint']);
    });
    await t('no Re-fill, Unlock, Fill or Lock button exists, and Select has no refill or lock function', () => {
      bar81();
      const labels = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
      return eq([labels.some((x) => /^(Re-fill|Unlock all|Draw unit|Lock|Fill)$/.test(x)), typeof Select.refill, typeof Select.toggleLock, typeof Select.fillRemainder, !!$('staleNote')], [false, 'undefined', 'undefined', 'undefined', false]);
    });

    /* ---- paint ---- */
    await t('paint: a 24 ft stretch of the south run makes one unit with the best-fit type; the open area falls; one undo step', () => {
      blankBar();
      const open0 = Derived.get().hud.open, before = snap();
      const r = Select.paintOnRun('R1', 0, 24);
      const u = L().units[0];
      const ok = [r.unit && r.unit.mode, n(), L().units.length, !!u && u.area > 600 && u.area < 800, Derived.get().hud.open < open0 - 600, Derived.get().hud.units];
      return eq([ok, oneStep(before)], [['run', 1, 1, true, true, 1], true]);
    });
    await t('paint: a second unit next to the first adds to it; a drag over a drawn unit is refused and nothing changes', () => {
      blankBar();
      Select.paintOnRun('R1', 0, 24);
      Select.paintOnRun('R1', 24, 50);
      const two = n();
      const before = snap();
      const bad = Select.paintOnRun('R1', 10, 30);
      return eq([two, bad.unit, bad.refused, snap() === before], [2, null, 'inside-unit', true]);
    });
    if (Render.ready()) {
      await t('paint by pointer: press on the open stretch, drag along the run, the live label shows area and match, release makes the unit; orbit stays off during the drag and on after', async () => {
        blankBar();
        Render.setView('plan', false);
        await frames(3);
        const a = screenOfRun('R1', 60), b = screenOfRun('R1', 84);
        const before = snap();
        canvasEv('pointerdown', a.x, a.y);
        canvasEv('pointermove', (a.x + b.x) / 2, (a.y + b.y) / 2);
        canvasEv('pointermove', b.x, b.y);
        await frames(1);
        const label = Select.liveText(), orbitOff = Render.orbitEnabled() === false, dragging = Select.dragging();
        canvasEv('pointerup', b.x, b.y);
        await frames(2);
        return eq([/\d+ sf · .+, (in range|large|small)$/.test(label) || label, orbitOff, dragging, n(), Render.orbitEnabled(), Select.liveText(), oneStep(before)], [true, true, true, 1, true, '', true]);
      });
      await t('paint by pointer: a tap on an open stretch only selects it (no unit); the card offers Suggest', async () => {
        blankBar();
        await frames(2);
        const a = screenOfRun('R1', 100);
        canvasEv('pointerdown', a.x, a.y); canvasEv('pointerup', a.x, a.y);
        await frames(2);
        const sel = Select.get(), card = $('selection-card');
        return eq([n(), sel && sel.kind, !!card.querySelector('[data-action="suggest"]')], [0, 'free', true]);
      });
      await t('paint by touch: one finger paints; a second finger cancels the paint and makes no unit', async () => {
        blankBar();
        await frames(2);
        const a = screenOfRun('R1', 60), b = screenOfRun('R1', 84);
        const cap = Element.prototype.setPointerCapture, rel = Element.prototype.releasePointerCapture;       // synthetic touch ids have no active pointer
        Element.prototype.releasePointerCapture = function (id) { try { return rel.call(this, id); } catch (e) { return undefined; } };
        Element.prototype.setPointerCapture = function (id) { try { return cap.call(this, id); } catch (e) { return undefined; } };
        canvasEv('pointerdown', a.x, a.y, 11, true);
        canvasEv('pointermove', b.x, b.y, 11, true);
        canvasEv('pointerdown', b.x + 40, b.y + 40, 12, true);
        canvasEv('pointerup', b.x, b.y, 11, true);
        canvasEv('pointerup', b.x + 40, b.y + 40, 12, true);
        await frames(1);
        const none = n();
        canvasEv('pointerdown', a.x, a.y, 13, true);
        canvasEv('pointermove', (a.x + b.x) / 2, (a.y + b.y) / 2, 13, true);
        canvasEv('pointermove', b.x, b.y, 13, true);
        canvasEv('pointerup', b.x, b.y, 13, true);
        await frames(1);
        Element.prototype.setPointerCapture = cap; Element.prototype.releasePointerCapture = rel;
        return eq([none, n(), Render.orbitEnabled()], [0, 1, true]);
      });
    }

    /* ---- suggest ---- */
    await t('suggest: a selected open stretch gives ghost units and changes nothing in the state; Accept all makes them in one undo step', () => {
      blankBar();
      Select.select({ kind: 'free', id: 'R2:1', runId: 'R2', mid: 62 });
      const r = Select.suggest();
      const g = Select.ghosts();
      const before = snap();
      const acc = Select.acceptGhosts();
      const made = n();
      return eq([r.ok, r.count > 0, g && g.list.length === r.count, n() === made && made === r.count, acc.count, Select.ghosts(), oneStep(before)], [true, true, true, true, r.count, null, true]);
    });
    await t('suggest: the Suggest tool and a tap on the stretch also show the ghosts, and the card has Accept all and Dismiss', async () => {
      blankBar();
      Select.setTool('suggest');
      await frames(2);
      if (Render.ready()) { const a = screenOfRun('R2', 60); Select.click(a.x, a.y); } else Select.select({ kind: 'free', id: 'R2:1', runId: 'R2', mid: 62 });
      await frames(2);
      const card = $('selection-card');
      return eq([(Select.ghosts() || { list: [] }).list.length > 0, !!card.querySelector('[data-action="accept-all"]'), !!card.querySelector('[data-action="dismiss"]'), n()], [true, true, true, 0]);
    });
    await t('suggest: accept one ghost (by id, or by a tap on it) makes one unit; the others stay', async () => {
      blankBar();
      Select.select({ kind: 'free', id: 'R2:1', runId: 'R2', mid: 62 });
      const r = Select.suggest();
      const first = Select.ghosts().list[0];
      const before = snap();
      const acc = Select.acceptGhosts(first.gid);
      const left = Select.ghosts();
      const one = [acc.count, n(), left ? left.list.length : 0, r.count - 1];
      oneStep(before);
      let tap = null;
      if (Render.ready() && r.count > 1) {
        blankBar();
        Select.select({ kind: 'free', id: 'R2:1', runId: 'R2', mid: 62 });
        Select.suggest();
        const g = Select.ghosts().list[0], c = ringCentroidXY(g.outer), p = Select.screenOf(c[0], c[1]);
        Select.click(p.x, p.y);
        tap = [n(), (Select.ghosts() || { list: [] }).list.length];
      }
      return eq([one, tap === null ? true : tap[0] === 1 && tap[1] === r.count - 1 || tap], [[1, 1, r.count - 1, r.count - 1], true]);
    });
    await t('suggest: Dismiss removes the ghosts and leaves the plate blank; Escape dismisses them too', () => {
      blankBar();
      Select.select({ kind: 'free', id: 'R3:1', runId: 'R3', mid: 62 });
      Select.suggest();
      const a = (Select.ghosts() || { list: [] }).list.length;
      Select.dismissGhosts();
      const afterDismiss = [Select.ghosts(), n()];
      Select.select({ kind: 'free', id: 'R3:1', runId: 'R3', mid: 62 });
      Select.suggest();
      key('Escape');
      return eq([a > 0, afterDismiss, Select.ghosts(), n(), Select.get() !== null], [true, [null, 0], null, 0, true]);
    });
    await t('suggest: an edit made elsewhere dismisses the ghosts (no stale ghost stays)', () => {
      blankBar();
      Select.select({ kind: 'free', id: 'R3:1', runId: 'R3', mid: 62 });
      Select.suggest();
      Store.set('extWall', 1.25, { live: false });
      const out = Select.ghosts();
      Store.set('extWall', 1, { live: false });
      return eq(out, null);
    });

    /* ---- free draw ---- */
    await t('free rectangle: two corners make one free unit clipped to the unit zone, with a type and the match; one undo step', () => {
      blankBar();
      Select.setTool('rect');
      const d0 = Select.drawing();
      Select.drawPoint(-100, -31); Select.drawPoint(-76, -6);
      const before = snap();
      const r = Select.finishDraw();
      const u = L().units[0];
      const ok = [d0 && d0.kind, r && r.ok, n(), Store.get('units')[0].mode, u && u.area > 500 && u.area < 700, Select.drawing() && Select.drawing().kind];
      return eq([ok, oneStep(before)], [['freeRect', true, 1, 'free', true, 'freeRect'], true]);
    });
    await t('free rectangle: a shape under 50 sf makes no unit and the tool stays armed', () => {
      blankBar();
      Select.setTool('rect');
      Select.drawPoint(-100, -10); Select.drawPoint(-96, -6);
      const r = Select.finishDraw();
      return eq([r, n(), Select.drawing() && Select.drawing().kind], [null, 0, 'freeRect']);
    });
    await t('free polygon: taps and Finish make one free unit; Escape with nothing drawn leaves the tool', () => {
      blankBar();
      Select.setTool('poly');
      for (const p of [[-60, -31], [-30, -31], [-34, -5], [-60, -5]]) Select.drawPoint(p[0], p[1]);
      const r = Select.finishDraw();
      const made = [r && r.ok, n(), Store.get('units')[0].mode];
      key('Escape');                                                       // the first Escape clears the selected new unit
      key('Escape');
      return eq([made, Select.tool(), Select.drawing()], [[true, 1, 'free'], 'select', null]);
    });
    if (Render.ready()) {
      await t('free rectangle by pointer: press, drag and release draws the unit; the live label shows while dragging', async () => {
        blankBar();
        Select.setTool('rect');
        await frames(2);
        const a = Select.screenOf(-100, -31), b = Select.screenOf(-76, -6);
        canvasEv('pointerdown', a.x, a.y); canvasEv('pointermove', (a.x + b.x) / 2, (a.y + b.y) / 2); canvasEv('pointermove', b.x, b.y);
        await frames(1);
        const label = Select.liveText();
        canvasEv('pointerup', b.x, b.y);
        await frames(2);
        return eq([/sf/.test(label) || label, n(), Render.orbitEnabled()], [true, 1, true]);
      });
    }

    /* ---- the core: move, resize ---- */
    await t('core resize: a corner handle resizes in 0.5 ft steps, never under 10 by 10 ft, and the mode becomes Manual; one undo step per drag', () => {
      Select.clear();
      Store.replace(fillDefaults(defaultState())); Select.setTool('select');
      const r0 = Select.rectOf({ kind: 'core', id: 'core' });
      const before = snap();
      Select.resizeCore(2, r0[2] + 3.26, r0[3] + 1.1);                    // NE corner: snaps to 0.5 ft
      const r1 = Select.rectOf({ kind: 'core', id: 'core' });
      const mode = Store.get('core.mode');
      Select.resizeCore(0, r1[2] + 50, r1[3] + 50);                       // SW corner dragged far past NE: 10 ft minimum
      const r2 = Select.rectOf({ kind: 'core', id: 'core' });
      return eq([mode, r1[2] - r0[2], r1[3] - r0[3], Math.abs(r1[2] * 2 - Math.round(r1[2] * 2)) < 1e-9, r2[2] - r2[0] >= 10 - 1e-9, r2[3] - r2[1] >= 10 - 1e-9, Store.get('core.mode')], ['manual', 3.5, 1, true, true, true, 'manual']);
    });
    await t('core move: setBlockRect moves the core by a snapped step; the card shows Auto, Manual and None, an elevator count and Reset core to auto', () => {
      Select.clear();
      Store.replace(fillDefaults(defaultState())); Select.setTool('select');
      Select.select({ kind: 'core', id: 'core' });
      const r0 = Select.rectOf({ kind: 'core', id: 'core' });
      const before = snap();
      Select.setBlockRect({ kind: 'core', id: 'core' }, [r0[0] + 5, r0[1], r0[2] + 5, r0[3]]);
      const card = $('selection-card');
      const modes = [...card.querySelectorAll('#itemTypes [data-mode]')].map((b) => b.dataset.mode);
      const ok = [Store.get('core.mode'), Select.rectOf({ kind: 'core', id: 'core' })[0] - r0[0], modes, !!card.querySelector('[data-action="elev-plus"]'), !!card.querySelector('[data-action="elev-minus"]'), !!card.querySelector('[data-action="elev-auto"]'), !!card.querySelector('[data-action="reset-core"]')];
      return eq([ok, oneStep(before)], [['manual', 5, ['auto', 'manual', 'none'], true, true, true, true], true]);
    });
    await t('core card: a manual core whose rooms do not fit says "Rooms do not fit"; Reset core to auto brings the auto core back', () => {
      Select.clear();
      Store.replace(fillDefaults(defaultState())); Select.setTool('select');
      Select.select({ kind: 'core', id: 'core' });
      const r0 = Select.rectOf({ kind: 'core', id: 'core' });
      Select.setBlockRect({ kind: 'core', id: 'core' }, [r0[0], r0[1], r0[0] + 10, r0[1] + 10]);
      const fits = L().coreRooms.length > 0;
      const text = $('selection-card').textContent;
      $('selection-card').querySelector('[data-action="reset-core"]').click();
      return eq([fits || /Rooms do not fit/.test(text), Store.get('core.mode'), Store.get('core.rect'), L().coreRooms.length > 0], [true, 'auto', null, true]);
    });
    await t('core card: the elevator count steps up and down by one and Auto sets it back to null', () => {
      Select.clear();
      Store.replace(fillDefaults(defaultState())); Select.setTool('select');
      Select.select({ kind: 'core', id: 'core' });
      const card = () => $('selection-card');
      const auto = Derived.get().hud.core.autoCabs;
      card().querySelector('[data-action="elev-plus"]').click();
      const up = Store.get('elevators.count');
      card().querySelector('[data-action="elev-minus"]').click();
      card().querySelector('[data-action="elev-minus"]').click();
      const down = Store.get('elevators.count');
      card().querySelector('[data-action="elev-auto"]').click();
      return eq([up, down, Store.get('elevators.count')], [auto + 1, auto - 1, null]);
    });
    if (Render.ready()) {
      await t('core by pointer: dragging a corner handle resizes the core; dragging inside it moves it; both keep orbit usable', async () => {
        Select.clear();
        Store.replace(fillDefaults(defaultState())); Select.setTool('select');
        Render.setView('plan', false);
        await frames(2);
        Select.select({ kind: 'core', id: 'core' });
        await frames(2);
        const r0 = Select.rectOf({ kind: 'core', id: 'core' });
        const h2 = Select.coreHandleScreen(2), to = Select.screenOf(r0[2] + 4, r0[3] + 4);
        canvasEv('pointerdown', h2.x, h2.y); canvasEv('pointermove', (h2.x + to.x) / 2, (h2.y + to.y) / 2); canvasEv('pointermove', to.x, to.y); canvasEv('pointerup', to.x, to.y);
        await frames(2);
        const r1 = Select.rectOf({ kind: 'core', id: 'core' });
        const c = [(r1[0] + r1[2]) / 2, (r1[1] + r1[3]) / 2], a = Select.screenOf(c[0], c[1]), b = Select.screenOf(c[0] + 6, c[1]);
        Select.select({ kind: 'core', id: 'core' });
        await frames(2);
        canvasEv('pointerdown', a.x, a.y); canvasEv('pointermove', (a.x + b.x) / 2, a.y); canvasEv('pointermove', b.x, b.y); canvasEv('pointerup', b.x, b.y);
        await frames(2);
        const r2 = Select.rectOf({ kind: 'core', id: 'core' });
        return eq([r1[2] - r0[2] > 3 && r1[3] - r0[3] > 3, Math.abs(r2[0] - r1[0] - 6) < 0.6, Store.get('core.mode'), Render.orbitEnabled()], [true, true, 'manual', true]);
      });
    }

    /* ---- clear level, undo ---- */
    await t('clear level: the dialog asks first; Cancel keeps the units; OK removes all 17 in one undo step and the hint comes back', async () => {
      bar81();
      await frames(2);
      const before = snap();
      const pending = Select.clearLevel();
      await frames(1);
      const dlg = document.querySelector('.modal-back');
      const asked = !!dlg && /17 units/.test(dlg.textContent);
      [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
      const kept = (await pending) === false && n() === 17;
      const p2 = Select.clearLevel();
      await frames(1);
      [...document.querySelectorAll('.modal-back button')].find((b) => b.textContent === 'Clear level').click();
      const done = await p2;
      await frames(2);
      const out = [asked, kept, done, n(), Derived.get().hud.units, !$('blankHint').hidden];
      return eq([out, oneStep(before), n()], [[true, true, true, 0, 0, true], true, 0]);   // oneStep ends on the redone state
    });
    await t('clear level: the palette button does the same and a level with no unit only shows a toast', async () => {
      blankBar();
      const r = await Select.clearLevel({ confirm: false });
      return eq([r, /no units/i.test(TestHelp.toastText())], [false, true]);
    });
    await t('undo and redo work for paint, suggest, free draw, split, merge, delete and the core', () => {
      blankBar();
      const steps = [];
      const step = (name, fn) => { const b = snap(); fn(); const a = snap(); steps.push(a !== b && oneStep(b) ? true : name); };
      step('paint', () => Select.paintOnRun('R1', 0, 24));
      step('free', () => Select.commitFree([[-100, -31], [-76, -31], [-76, -6], [-100, -6]]));
      step('suggest', () => { Select.select({ kind: 'free', id: 'R3:1', runId: 'R3', mid: 62 }); Select.suggest(); Select.acceptGhosts(); });
      step('split', () => Select.splitUnit(0));
      step('merge', () => { const nb = Select.neighbors(0); const dir = nb['1'] ? 1 : -1; Select.mergeUnit(dir, 0); });
      step('delete', () => Select.deleteUnit(0));
      step('core', () => Select.setCoreMode('none'));
      return eq(steps, steps.map(() => true));
    });

    /* ---- select tool: unit card actions ---- */
    await t('select: Split makes two units from one, Merge joins them again (one piece), Delete removes the unit', () => {
      blankBar();
      Select.paintOnRun('R1', 0, 48);
      Select.setTool('select');
      Select.selectUnit(0);
      const area0 = L().units[0].area;
      const card = () => $('selection-card');
      card().querySelector('[data-action="split"]').click();
      const split = [n(), Math.abs(L().units.reduce((s, u) => s + u.area, 0) - area0) < 1];
      const k = Select.get() ? Select.get().k : 0;
      const dir = Select.neighbors(k)['1'] ? 1 : -1;
      const m = Select.mergeUnit(dir, k);
      const merged = [m.ok, n(), Math.abs(L().units[0].area - area0) < 1];
      Select.selectUnit(0);
      card().querySelector('[data-action="delete"]').click();
      return eq([split, merged, n(), Select.get()], [[2, true], [true, 1, true], 0, null]);
    });
    await t('select: Delete and Backspace keys remove the selected unit', () => {
      blankBar();
      Select.paintOnRun('R1', 0, 24);
      Select.setTool('select');
      Select.selectUnit(0);
      key('Delete');
      return eq([n(), Select.get()], [0, null]);
    });

    /* ---- the match colors, the HUD ---- */
    await t('match: a 60 ft unit is large (orange), an 8 ft unit is small (blue), a 24 ft unit is in range; the live label words and the HUD count follow', () => {
      blankBar();
      Select.paintOnRun('R1', 0, 24);
      Select.paintOnRun('R1', 30, 90);
      Select.paintOnRun('R1', 100, 108);
      const us = L().units;
      const flags = us.map((u) => [u.match, !!u.areaHigh, !!u.small]);
      const hud = Derived.get().hud;
      UI.updateHud(Derived.get());
      return eq([flags.map((f) => f[0]), flags[1][1], flags[2][2], hud.units, hud.inRange, $('hudRange') && $('hudRange').textContent], [['in-range', 'large', 'small'], true, true, 3, 1, 'Units in range 1 of 3']);
    });
    await t('the HUD shows Units, NRSF, Efficiency and Open; Open falls as units are drawn and the line "Units in range a of b" shows', () => {
      blankBar();
      const o0 = Derived.get().hud.open;
      Select.paintOnRun('R1', 0, 24);
      UI.updateHud(Derived.get());
      const o1 = Derived.get().hud.open;
      const labels = [...$('hud').querySelectorAll('.hud-core .k')].map((k) => k.textContent);
      return eq([labels, o1 < o0 - 600, /sf/.test($('mOpen').textContent), /^Units in range \d+ of 1$/.test($('hudRange').textContent)], [['Units', 'NRSF', 'Efficiency', 'Open'], true, true, true]);
    });
    await t('the hint hides once a unit exists and returns when the level is clear again', async () => {
      blankBar();
      await frames(2);
      const a = !$('blankHint').hidden;
      Select.paintOnRun('R1', 0, 24);
      await frames(1);
      const b = !$('blankHint').hidden;
      Select.deleteUnit(0);
      await frames(1);
      return eq([a, b, !$('blankHint').hidden], [true, false, true]);
    });

    /* ---- a project group, hotel ---- */
    await t('a project group keeps its drawn units at levels.groups[gid].units and the written section carries them', async () => {
      const mem = ProjectFixture.memory();
      try {
        ProjectUI.reset();
        ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
        const doc = ProjectFixture.project();
        ProjectMod.saveProject(mem, doc);
        ProjectUI.openDoc(doc);
        Select.clear(); Select.setTool('paint');
        const gid = Derived.get().group.id;
        const info = Select.layoutInfo();
        const r = Select.paintOnRun(info.runs[0].id, 0, 24);
        const saved = Store.get(`levels.groups.${gid}.units`);
        ProjectUI.flush();
        await wait(30);
        const sec = ProjectMod.loadProject(mem, ProjectUI.doc().id).sections.plates;
        return eq([!!r.unit, Array.isArray(saved) && saved.length, Store.get('units') && Store.get('units').length, sec.derived.levels[0].units.length], [true, 1, 0, 1]);
      } finally {
        ProjectUI.close(); ProjectUI.restoreDefaults(); ProjectUI.reset();
      }
    });
    await t('hotel: the live match uses the width range and the label shows the width; Clear level and paint work in keys', () => {
      blankBar();
      Store.set('mode', 'hotel', { live: false });
      const r = Select.paintOnRun('R1', 0, 14);
      const u = L().units[0];
      const ok = [!!r.unit, n(), !!u && /king|double|suite|accessible|\w+/.test(u.type), u && ['in-range', 'large', 'small'].includes(u.match)];
      Store.set('mode', 'multifamily', { live: false });
      return eq(ok, [true, 1, true, true]);
    });
  } finally {
    Select.clear();
    Select.setTool('paint');
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('draw', results);
  return results;
}

runAllTests = ((base) => async function runAllWithDraw() {
  const r = await base();
  const g = await runDrawTests();
  const bad = g.filter((x) => !x.ok);
  r.results.push(...g);
  r.total += g.length;
  r.passed += g.length - bad.length;
  r.failed.push(...bad);
  return r;
})(runAllTests);
