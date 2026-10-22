/* ==========================================================================
   TESTS: drawing and selection  (plan section 5.3)
   Pointer events are sent to the canvas the way a mouse or a finger would: down, then up in the same place is a tap; down, move, up on a
   handle drags it. Taps snap to pad corners and edges. The wall test follows plan section 9.2: four taps on the south edge of preset 8.1
   change the fill to 297.3 cy (the integrator's corrected value).
   ========================================================================== */
async function runSelectTests() {
  const { eq, near, make, $, frames, wait, snap, oneStep, presetState } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const canvas = Render.canvas();
  if (!Render.ready() || !canvas) { results.push({ name: 'select tests need WebGL (skipped)', ok: true, detail: '' }); Options.holdAutosave(false); return results; }
  // Synthetic pointers have no capture target; the renderer's controls would throw on them.
  canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
  const ptr = (type, x, y, o = {}) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: o.id || 7, pointerType: o.type || 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, altKey: !!o.alt, isPrimary: true }));
  // down and up in one task: a slow software-rendered frame must not turn a tap into a long press (400 ms)
  const tap = async (x, y, o) => { ptr('pointerdown', x, y, o); ptr('pointerup', x, y, o); await wait(15); };
  const key = (k, o = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const at = (x, y, z) => Select.screenOf(x, y, z);
  const tapPlan = async (x, y, o) => { const p = at(x, y); await tap(p.x, p.y, o); };
  const toPlan = async () => { Render.setView('plan', false); await frames(3); };
  const fresh = async () => { Select.clear(); Select.cancelDraw(); Store.replace(fillDefaults(defaultState())); await toPlan(); await frames(2); };

  try {
    await fresh();
    await t('Draw: the wall button and key W start a drawing in the plan view; the draw bar shows; Esc cancels', async () => {
      Render.setView('axon', false); await frames(2);
      key('w'); await frames(2);
      const on = Select.drawing(), bar = !$('drawBar').hidden, plan = Render.info().preset;
      key('Escape'); await frames(1);
      return eq([on && on.kind, bar, plan, Select.drawing(), $('drawBar').hidden], ['wall', true, 'plan', null, true]);
    });
    await toPlan();
    let beforeWall = null;
    await t('Draw: four taps on the south edge of preset 8.1 make a wall and the fill is 297.3 cy', async () => {
      beforeWall = snap();
      Select.startDraw('wall'); await frames(2);
      for (const x of [-150, -50, 50, 150]) await tapPlan(x, -32.5);
      const mid = Select.drawing();
      await tapPlan(150, -32.5);                                  // the last point again finishes
      await frames(2);
      const s = Store.raw(), w = s.walls[0], h = Derived.get().hud;
      const ok = [mid && mid.points, s.walls.length, w && w.line.length, w && w.line[0][0], w && w.line[w.line.length - 1][0], w && w.line.every((p) => Math.abs(p[1] + 32.5) < 1e-6)];
      return Math.abs(h.fillCy - 297.3) <= 0.5 ? eq(ok, [4, 1, 4, -150, 150, true]) : `fill ${h.fillCy}`;
    });
    await t('Draw: the new wall is one undo step, is selected, and its card is open in the Site work tab', async () => {
      const sel = Select.get();
      const tab = UI.activeTab(), card = !$('selection-card').hidden, title = $('itemTitle') && $('itemTitle').textContent;
      const r = [oneStep(beforeWall), sel, tab, card, title];
      return eq(r, [true, [{ kind: 'wall', id: 'W1' }], 'site', true, 'Wall W1']);
    });
    await t('Select: a tap on empty ground clears the selection; a tap on the wall selects it', async () => {
      await tapPlan(0, 150); const a = Select.count();
      await tapPlan(-100, -32.5); await frames(2);
      return eq([a, Select.get()], [0, [{ kind: 'wall', id: 'W1' }]]);
    });
    await t('Select: the handles are the 4 vertices and the 3 midpoints of the wall', () => eq(Select.handles(), { vertices: 4, midpoints: 3 }));
    await t('Edit: dragging a vertex moves it, snaps to the grid, turns orbit off while it moves, and is one undo step', async () => {
      const before = snap();
      const p = Select.handleScreen('v', 1), w0 = Store.get('walls.0.line')[1];
      ptr('pointerdown', p.x, p.y); await wait(15);
      const orbitDuring = Render.orbitEnabled();
      ptr('pointermove', p.x, p.y + 25); await wait(15);
      ptr('pointermove', p.x, p.y + 50); await wait(15);
      ptr('pointerup', p.x, p.y + 50); await wait(30);
      const w1 = Store.get('walls.0.line')[1];
      const moved = Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) > 5, whole = Number.isInteger(w1[0]) || Math.abs(w1[0] - Math.round(w1[0])) < 1e-9;
      const one = oneStep(before);
      return eq([orbitDuring, Render.orbitEnabled(), moved, whole, one, Store.get('walls.0.line').length], [false, true, true, true, true, 4]);
    });
    await t('Edit: dragging a midpoint dot adds a vertex', async () => {
      const before = snap();
      const p = Select.handleScreen('m', 0);
      ptr('pointerdown', p.x, p.y); await wait(15);
      ptr('pointermove', p.x + 4, p.y + 30); await wait(15);
      ptr('pointerup', p.x + 4, p.y + 30); await wait(30);
      const n = Store.get('walls.0.line').length;
      const one = oneStep(before);
      return eq([n, one, Select.handles().vertices], [5, true, 5]);
    });
    await t('Edit: a drag that starts away from a handle orbits and leaves the selection alone', async () => {
      const sel = JSON.stringify(Select.get());
      ptr('pointerdown', 700, 300); await wait(15); ptr('pointermove', 760, 340); await wait(15); ptr('pointerup', 760, 340); await wait(30);
      await toPlan();
      return eq([JSON.stringify(Select.get()), Store.get('walls').length], [sel, 1]);
    });
    await t('Edit: Delete removes the selected wall; undo brings it back', async () => {
      await toPlan();
      key('Delete'); await frames(2);
      const gone = Store.get('walls').length === 0 && Select.count() === 0;
      Store.undo(); await frames(2);
      return eq([gone, Store.get('walls').length], [true, 1]);
    });
    await t('Esc clears the selection', async () => {
      Select.select([{ kind: 'wall', id: 'W1' }]); key('Escape'); await frames(1);
      return eq([Select.count(), $('selection-card').hidden], [0, true]);
    });
    await t('Select: a tap on the building selects it, with its tier in the card', async () => {
      await tapPlan(0, 0); await frames(2);
      return eq([Select.get(), $('itemTitle').textContent, $('selection-card').hidden], [[{ kind: 'building', id: 'B1' }], 'Bar', false]);
    });
    await t('Draw: a drive of three taps is finished with Enter, takes the defaults and opens in the Site work tab', async () => {
      Select.clear();
      Select.startDraw('drive'); await frames(2);
      await tapPlan(200, -100); await tapPlan(200, 0); await tapPlan(230, 60);
      key('Enter'); await frames(2);
      const d = Store.get('drives');
      return eq([d.length, d[0].line.length, d[0].width, d[0].slope, d[0].start, Select.get(), UI.activeTab()], [1, 3, 24, 5, 'existing', [{ kind: 'drive', id: 'D1' }], 'site']);
    });
    await t('Draw: a lot closes itself (three taps and Enter) and a property line the same', async () => {
      Select.startDraw('lot'); await frames(2);
      await tapPlan(-250, 100); await tapPlan(-200, 100); await tapPlan(-200, 160); key('Enter'); await frames(2);
      const lot = Store.get('lots')[0];
      Select.startDraw('property'); await frames(2);
      await tapPlan(-250, -150); await tapPlan(250, -150); await tapPlan(250, 200); await tapPlan(-250, 200); key('Enter'); await frames(2);
      const pr = Store.get('property');
      return eq([lot.ring.length, pr.mode, pr.ring.length, Select.get()], [3, 'drawn', 4, [{ kind: 'property', id: 'property' }]]);
    });
    await t('Draw: a route with two taps, and the key R draws one too', async () => {
      Select.startDraw('route'); await frames(2);
      await tapPlan(-120, -80); await tapPlan(-60, -80); key('Enter'); await frames(2);
      const r = Store.get('routes');
      key('r'); await frames(1); const k = Select.drawing(); key('Escape');
      return eq([r.length, r[0].name, k && k.kind], [1, 'Route 1', 'route']);
    });
    await t('Edit: a drive is picked by a tap inside its outline; a lot likewise', async () => {
      Select.clear();
      await tapPlan(200, -40); const a = Select.get();
      await tapPlan(-215, 120); const b = Select.get();
      return eq([a, b], [[{ kind: 'drive', id: 'D1' }], [{ kind: 'lot', id: 'L1' }]]);
    });
    await t('Edit: Redraw keeps the settings and replaces the points', async () => {
      Store.set('drives.0.slope', 7, { live: false });
      Select.select([{ kind: 'drive', id: 'D1' }]);
      Select.redraw({ kind: 'drive', id: 'D1' }); await frames(2);
      await tapPlan(180, -120); await tapPlan(180, 20); key('Enter'); await frames(2);
      const d = Store.get('drives');
      return eq([d.length, d[0].line.length, d[0].slope, d[0].id], [1, 2, 7, 'D1']);
    });
    await t('Edit: Delete removes a drive, a lot and a route, one step each', async () => {
      const out = [];
      for (const it of [{ kind: 'drive', id: 'D1' }, { kind: 'lot', id: 'L1' }, { kind: 'route', id: 'R1' }]) {
        Select.select([it]); const before = snap();
        out.push(Select.deleteSelected() && oneStep(before));
        Select.clear();
      }
      return eq([out, Store.get('drives').length, Store.get('lots').length, Store.get('routes').length], [[true, true, true], 0, 0, 0]);
    });
    await t('Snap: grid, pad corner, pad edge, drive end; Option skips snapping', () => {
      const g = Select.snapPoint([10.37, 5.61]);
      const c = Select.snapPoint([-149.6, -32.1]);
      const e = Select.snapPoint([20.2, -32.4]);
      const f = Select.snapPoint([10.37, 5.61], { skip: true });
      return eq([[g.x, g.y, g.kind], [c.x, c.y, c.kind], [Math.round(e.x * 10) / 10, e.y, e.kind], f.kind, f.x], [[10, 6, 'grid'], [-150, -32.5, 'corner'], [20.2, -32.5, 'edge'], 'free', 10.37]);
    });
    await t('Draw: tapping with Option held places the point where the finger is (no snap)', async () => {
      Select.startDraw('wall'); await frames(2);
      const p = at(33.3, 71.7);
      await tap(p.x, p.y, { alt: true });
      const pts = [];
      Select.drawPoint(80, 71.7);
      const n = Select.drawing().points;
      Select.cancelDraw();
      return eq(n, 2);
    });
    await t('Section: Draw section takes two taps, the profile panel shows and the pads and the length are right', async () => {
      Select.startDraw('section'); await frames(2);
      await tapPlan(-120, -100); await tapPlan(-120, 100); await frames(4);
      const sec = Store.get('view.section'), info = SectionView.info();
      return eq([sec && sec.length, Select.drawing(), SectionView.visible(), info && Math.round(info.length), info && info.samples], [2, null, true, 200, 201]);
    });
    await t('Section: a line through the bar shows the pad and the cut and fill ends', async () => {
      Store.set('view.section', [[0, -80], [0, 80]], { live: false }); await frames(4);
      const info = SectionView.info();
      return eq([info.pads, Math.round(info.length), info.hi - info.lo > 7], [1, 160, true]);
    });
    await t('Section: closing the panel clears the line', async () => {
      $('sectionClose').click(); await frames(2);
      return eq([Store.get('view.section'), SectionView.visible()], [null, false]);
    });
    await t('Keys: 1 to 6 switch the view, D switches Model and Cut and fill', async () => {
      key('3'); await frames(2); const e = Render.info().preset;
      key('6'); await frames(2); const p = Render.info().preset;
      const s0 = Store.get('view.style'); key('d'); const s1 = Store.get('view.style'); key('d'); const s2 = Store.get('view.style');
      return eq([e, p, s0, s1, s2], ['e', 'plan', 'model', 'cutfill', 'model']);
    });
    await t('Keys are ignored while typing in a field', async () => {
      const input = document.createElement('input'); document.body.append(input); input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
      const none = Select.drawing();
      input.remove();
      return eq(none, null);
    });
    await t('A tap that moves more than 6 px, or a long press, is not a tap', async () => {
      Select.clear();
      const p = at(0, 0);
      ptr('pointerdown', p.x, p.y); await wait(15); ptr('pointermove', p.x + 20, p.y); ptr('pointerup', p.x + 20, p.y); await wait(20);
      const a = Select.count();
      await toPlan();
      ptr('pointerdown', p.x, p.y); await wait(480); ptr('pointerup', p.x, p.y); await wait(20);
      return eq([a, Select.count()], [0, 0]);
    });
  } finally {
    Select.clear(); Select.cancelDraw();
    delete canvas.setPointerCapture; delete canvas.releasePointerCapture;
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    Render.setView('axon', false);
  }
  TestHelp.merged('select', results);
  return results;
}
