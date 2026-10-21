/* ==========================================================================
   TESTS: v1.1 direct editing
   Click picking, the selection card, program change, copy above / below,
   handles (move with snapping, width, top), delete, shortcuts, and that the
   selection never reaches the saved state. Runs after the layout tests
   (runAllTests in 12b merges the results).
   Drags run through the same math the pointer uses (Select.simulateHandleDrag).
   The tests restore the design, the tab, the style and the view when they finish.
   ========================================================================== */
async function runSelectTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const near = (a, b, tol = 0.01) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const $ = (id) => document.getElementById(id);
  const frames = (n = 2) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  // The undo stack is capped at 50 and these tests fill it, so "one undo step" is checked by behavior: one undo returns the state
  // from before the action, and one redo puts the result back.
  const snap = () => JSON.stringify(Store.snapshot());
  const oneStep = (before) => { Store.undo(); const back = snap() === before; Store.redo(); return back; };

  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  const savedView = Render.info().preset || 'axon';
  Options.holdAutosave(true);

  const seg = (floors, w, d, program = 'residential', ox = 0, oy = 0) => {
    const g = defaultSegment();
    g.floors = floors; g.shape = { type: 'rect', w, d, radius: 0, points: [] }; g.offset = { x: ox, y: oy }; g.program = program;
    return g;
  };
  /** Podium + two stacked segments + stepped crown + a corner carve + the default context block. */
  const full = () => {
    const s = defaultState();
    s.podium = { ...s.podium, on: true, floors: 3, groundFtf: 18, ftf: 14, shape: { type: 'rect', w: 220, d: 170, radius: 0, points: [] }, offset: { x: 0, y: 0 } };
    s.segments = [seg(10, 100, 100), seg(6, 60, 60, 'office')];
    s.crown = { type: 'stepped', height: 20, steps: 3, slopeSide: 'front' };
    s.carves = [{ startFloor: 6, endFloor: 8, kind: 'corner', corner: 'NE', w: 30, d: 30 }];
    return s;
  };
  /** Podium + one segment (100 x 100, centered) + no crown / carve: the snap and resize cases. */
  const one = () => {
    const s = defaultState();
    s.podium = { ...s.podium, on: true, floors: 3, groundFtf: 18, ftf: 14, shape: { type: 'rect', w: 220, d: 170, radius: 0, points: [] }, offset: { x: 0, y: 0 } };
    s.segments = [seg(10, 100, 100)];
    s.crown = { type: 'none', height: 20, steps: 3, slopeSide: 'front' };
    s.carves = [];
    return s;
  };
  /** Two stacked segments, nothing else (copy tests: GFA is plain area x floors). */
  const plain = () => {
    const s = defaultState();
    s.podium.on = false; s.crown.type = 'none'; s.carves = [];
    s.segments = [seg(10, 100, 100), seg(6, 60, 60, 'office')];
    return s;
  };
  // Synchronous on purpose: no frame is drawn between a state change and the checks, so the frame loop's animated re-frame
  // cannot move the camera under a test. (A drawn frame in swiftshader also costs ~0.5 s.)
  const load = (s, view = 'axon') => {
    Select.clear();
    Store.replace(s);
    Render.setView(view, false);
  };
  const toastText = () => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join(' | ');

  try {
    /* ---- click picking ---- */
    await t('click-pick: a segment, the podium and a context block are found at their projected centers', async () => {
      load(full());
      Store.set('view.snap', { on: true, grid: 5 }, { live: false });
      const out = {};
      const s = Store.raw(), d = Derived.get();
      const mid = (box, z) => worldVec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, z);
      const cases = [
        ['segment0', { kind: 'segment', index: 0 }, mid(SnapMod.itemBox(s, d.plates, { kind: 'segment', index: 0 }), 4 * 14 + 50)],
        ['segment1', { kind: 'segment', index: 1 }, mid(SnapMod.itemBox(s, d.plates, { kind: 'segment', index: 1 }), 3 * 14 + 100 + 30)],
        ['podium', { kind: 'podium', index: 0 }, worldVec(-95, -70, 20)],
        ['context', { kind: 'context', index: 0 }, worldVec(0, -180, 30)],
      ];
      for (const [name, item, p] of cases) {
        const c = Select.screenPointFor(item);
        const pc = (() => { const rect = Render.canvas().getBoundingClientRect(), cam = Render.camera(); cam.updateMatrixWorld(true); const q = p.clone().project(cam); return { x: rect.left + ((q.x + 1) / 2) * rect.width, y: rect.top + ((1 - q.y) / 2) * rect.height }; })();
        const hit = Select.pickAt(pc.x, pc.y) || Select.pickAt(c.x, c.y);
        out[name] = hit ? `${hit.kind}:${hit.index}` : null;
      }
      return eq(out, { segment0: 'segment:0', segment1: 'segment:1', podium: 'podium:0', context: 'context:0' });
    });
    await t('click-pick: the crown is found, and empty sky picks nothing', async () => {
      load(full());
      const p = Select.screenPointFor({ kind: 'crown', index: 0 });
      const hit = p && Select.pickAt(p.x, p.y);
      const rect = Render.canvas().getBoundingClientRect();
      const sky = Select.pickAt(rect.left + 6, rect.top + 6);
      return eq([hit && hit.kind, sky], ['crown', null]);
    });
    await t('click-pick: a carve is pickable only while the Carves section is open or a carve is selected', async () => {
      load(full());
      UI.setTab('view');
      const hidden = [Select.carvesVisible(), Select.screenPointFor({ kind: 'carve', index: 0 })];
      UI.openItem({ kind: 'carve', index: 0 });
      const shown = Select.carvesVisible();
      const p = Select.screenPointFor({ kind: 'carve', index: 0 });
      const hit = p && Select.pickAt(p.x, p.y);
      Select.refreshOverlay();
      const dashed = Select.overlayInfo().carve;
      UI.setTab('view');
      Select.select([{ kind: 'carve', index: 0 }]);
      const viaSelection = Select.carvesVisible();
      Select.clear();
      return eq([hidden, shown, hit, dashed > 0, viaSelection], [[false, null], true, { kind: 'carve', index: 0 }, true, true]);
    });
    await t('Select.click applies shift (add) and empty space (clear)', async () => {
      load(full());
      const a = Select.screenPointFor({ kind: 'segment', index: 0 }), b = Select.screenPointFor({ kind: 'podium', index: 0 });
      Select.click(a.x, a.y, false);
      const first = Select.get();
      Select.click(b.x, b.y, true);
      const second = Select.get();
      Select.click(b.x, b.y, true);                       // shift-click on a selected item removes it
      const third = Select.get();
      const rect = Render.canvas().getBoundingClientRect();
      Select.click(rect.left + 6, rect.top + 6, true);    // shift + empty: no change
      const fourth = Select.get();
      Select.click(rect.left + 6, rect.top + 6, false);   // empty: clear
      return eq([first, second.length, third, fourth, Select.get()], [[{ kind: 'segment', index: 0 }], 2, [{ kind: 'segment', index: 0 }], [{ kind: 'segment', index: 0 }], []]);
    });
    await t('pointer events: a short still press is a click; a drag (orbit) and a long press are not', async () => {
      load(full());
      Render.setOrbitEnabled(false);                       // synthetic pointers have no capture target for the orbit controls
      try {
        const canvas = Render.canvas();
        const p = Select.screenPointFor({ kind: 'segment', index: 0 });
        const ev = (type, x, y, extra = {}) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'mouse', button: 0, bubbles: true, clientX: x, clientY: y, ...extra }));
        ev('pointerdown', p.x, p.y); ev('pointerup', p.x + 2, p.y + 1);
        const click = Select.get();
        Select.clear();
        ev('pointerdown', p.x, p.y); ev('pointermove', p.x + 20, p.y); ev('pointerup', p.x + 20, p.y);
        const orbit = Select.get();
        ev('pointerdown', p.x, p.y); await wait(450); ev('pointerup', p.x, p.y);
        const longPress = Select.get();
        Render.setView('axon', false);                      // frames were drawn during the wait: put the camera back
        const p2 = Select.screenPointFor({ kind: 'segment', index: 0 }), q = Select.screenPointFor({ kind: 'podium', index: 0 });
        ev('pointerdown', p2.x, p2.y); ev('pointerup', p2.x, p2.y);
        ev('pointerdown', q.x, q.y, { shiftKey: true }); ev('pointerup', q.x, q.y, { shiftKey: true });
        const shift = Select.get().length;
        Select.clear();
        // two fingers: never a click
        ev('pointerdown', p2.x, p2.y); canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 42, pointerType: 'touch', bubbles: true, clientX: p2.x + 40, clientY: p2.y })); ev('pointerup', p2.x, p2.y);
        const pinch = Select.get();
        canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 42, pointerType: 'touch', bubbles: true, clientX: p2.x + 40, clientY: p2.y }));
        return eq([click, orbit, longPress, shift, pinch], [[{ kind: 'segment', index: 0 }], [], [], 2, []]);
      } finally { Render.setOrbitEnabled(true); Select.clear(); }
    });
    await t('"Select more" mode adds a tapped item to the selection', async () => {
      load(full());
      const a = Select.screenPointFor({ kind: 'segment', index: 0 }), b = Select.screenPointFor({ kind: 'podium', index: 0 });
      Select.click(a.x, a.y, false);
      const btn = document.querySelector('#selection-card [data-action="more"]');
      btn.click();
      Select.click(b.x, b.y, false);
      const added = Select.get().length, pressed = btn.getAttribute('aria-pressed') || document.querySelector('#selection-card [data-action="more"]').getAttribute('aria-pressed');
      Select.clear();
      return eq([added, pressed, Select.addMode()], [2, 'true', false]);
    });

    /* ---- selection card and state ---- */
    await t('the selection card shows the item, six program buttons and the actions; Clear empties it', async () => {
      load(full());
      Select.select([{ kind: 'segment', index: 1 }]);
      const card = $('selection-card');
      const out = {
        shown: !card.hidden,
        title: card.querySelector('.sc-name').textContent,
        programs: card.querySelectorAll('.sc-pbtn').length,
        pressed: card.querySelector('.sc-pbtn[aria-pressed="true"]').dataset.program,
        actions: [...card.querySelectorAll('.sc-actions [data-action]')].map((b) => b.dataset.action).filter((a) => a !== 'more'),
      };
      card.querySelector('[aria-label="Clear selection"]').click();
      return eq([out, card.hidden, Select.get()], [{ shown: true, title: 'Segment 2', programs: 6, pressed: 'office', actions: ['copy-above', 'copy-below', 'open', 'delete'] }, true, []]);
    });
    await t('a multi-selection card says "N items", has program buttons and Delete, and no Copy or handles', async () => {
      load(full());
      Select.select([{ kind: 'segment', index: 0 }, { kind: 'segment', index: 1 }]);
      const card = $('selection-card');
      const acts = [...card.querySelectorAll('.sc-actions [data-action]')].map((b) => b.dataset.action).filter((a) => a !== 'more');
      return eq([card.querySelector('.sc-name').textContent, card.querySelectorAll('.sc-pbtn').length, acts, Select.visibleHandles()], ['2 items', 6, ['delete'], []]);
    });
    await t('selecting and clearing change nothing in the saved state and add no undo step', async () => {
      load(full());
      const before = snap(), v0 = Store.version();
      Select.select([{ kind: 'segment', index: 0 }, { kind: 'podium', index: 0 }]);
      Select.select([{ kind: 'carve', index: 0 }]);
      const during = snap();
      // Save, autosave and Export all take Store.snapshot(): its keys are exactly the design's, nothing of the selection
      const keys = JSON.stringify(Object.keys(Store.snapshot()).sort()) === JSON.stringify(Object.keys(defaultState()).sort());
      Select.clear();
      const text = during.toLowerCase();
      return eq([during === before, snap() === before, Store.version() === v0, /select|handle|outline/.test(text), keys], [true, true, true, false, true]);
    });
    await t('Escape clears the selection; shortcuts are ignored while a text field has focus', async () => {
      load(full());
      Select.select([{ kind: 'segment', index: 0 }]);
      const input = document.createElement('input');
      input.type = 'text'; document.body.append(input); input.focus();
      key('Escape'); key('4'); key('d');
      const kept = [Select.get().length, Render.info().preset, Store.get('view.style')];
      input.blur(); input.remove();
      key('Escape');
      return eq([kept, Select.get().length], [[1, 'axon', 'model'], 0]);
    });
    await t('keys 1-6 pick the views and D toggles Model / Diagram', async () => {
      load(full());
      const got = [];
      for (const k of ['1', '2', '3', '4', '5', '6']) { key(k); got.push(Render.info().preset); }
      key('d'); const diagram = Store.get('view.style');
      key('D'); const model = Store.get('view.style');
      return eq([got, diagram, model], [['axon', 'n', 'e', 's', 'w', 'plan'], 'diagram', 'model']);
    });
    await t('shortcuts are ignored while a menu is open', async () => {
      load(full());
      Select.select([{ kind: 'segment', index: 0 }]);
      $('btnExport').click();
      const open = Pop.isOpen();
      key('Backspace'); key('3');
      const same = [Store.raw().segments.length, Render.info().preset];
      Pop.close();
      Select.clear();
      return eq([open, same], [true, [2, 'axon']]);
    });
    await t('clicking a segment row title in the panel selects it in the view (two-way link)', async () => {
      load(full());
      UI.setTab('form');
      UI.openItem({ kind: 'segment', index: 1 });
      const head = document.querySelector('#sections [data-section="segments"] .item[data-index="1"] .item-title');
      head.click();
      const sel = Select.get();
      const marked = document.querySelectorAll('#sections [data-section="segments"] .item.sel-row').length;
      return eq([sel, marked], [[{ kind: 'segment', index: 1 }], 1]);
    });
    await t('"Open in panel" opens the item in its tab', async () => {
      load(full());
      UI.setTab('view');
      Select.select([{ kind: 'context', index: 0 }]);
      document.querySelector('#selection-card [data-action="open"]').click();
      const out = [UI.activeTab(), document.querySelector('#sections [data-section="context"]').dataset.open];
      Select.clear();
      return eq(out, ['site', 'true']);
    });

    /* ---- program, copy, delete ---- */
    await t('a program button on 2 selected segments is ONE undo step', async () => {
      load(plain());
      Select.select([{ kind: 'segment', index: 0 }, { kind: 'segment', index: 1 }]);
      const before = snap();
      document.querySelector('#selection-card .sc-pbtn[data-program="hotel"]').click();
      const after = Store.raw().segments.map((g) => g.program);
      const one = oneStep(before);
      Store.undo();
      const undone = Store.raw().segments.map((g) => g.program);
      return eq([after, one, undone], [['hotel', 'hotel'], true, ['residential', 'office']]);
    });
    await t('podium program rows set the ground and the upper program separately', async () => {
      load(full());
      Select.select([{ kind: 'podium', index: 0 }]);
      const rows = document.querySelectorAll('#selection-card .sc-prog');
      rows[0].querySelector('[data-program="hotel"]').click();
      rows[1].querySelector('[data-program="parking"]').click();
      return eq([Store.raw().podium.program, Store.raw().podium.upperProgram, rows.length], ['hotel', 'parking', 2]);
    });
    await t('Copy above adds a segment on top: floors and GFA grow by the copy, one undo restores', async () => {
      load(plain());
      const m0 = Derived.get().metrics, before = snap();
      Select.select([{ kind: 'segment', index: 0 }]);
      document.querySelector('#selection-card [data-action="copy-above"]').click();
      const m1 = Derived.get().metrics;
      const out = [Store.raw().segments.length, m1.floorCount - m0.floorCount, Math.round(m1.gfa - m0.gfa), oneStep(before), Select.get(), Store.raw().segments[1].floors];
      Store.undo();
      const back = [Store.raw().segments.length, Derived.get().metrics.floorCount, Math.round(Derived.get().metrics.gfa)];
      return eq([out, back], [[3, 10, 100000, true, [{ kind: 'segment', index: 1 }], 10], [2, m0.floorCount, Math.round(m0.gfa)]]);
    });
    await t('Copy below puts the copy under the original and selects it; one undo restores', async () => {
      load(plain());
      const m0 = Derived.get().metrics, before = snap();
      Select.select([{ kind: 'segment', index: 1 }]);
      document.querySelector('#selection-card [data-action="copy-below"]').click();
      const m1 = Derived.get().metrics;
      const g = Store.raw().segments;
      const out = [g.length, m1.floorCount - m0.floorCount, Math.round(m1.gfa - m0.gfa), oneStep(before), Select.get(), g.map((x) => x.floors)];
      Store.undo();
      return eq([out, Store.raw().segments.length], [[3, 6, 21600, true, [{ kind: 'segment', index: 1 }], [10, 6, 6]], 2]);
    });
    await t('Cmd+D copies the selected segment above', async () => {
      load(plain());
      Select.select([{ kind: 'segment', index: 0 }]);
      key('d', { metaKey: true });
      return eq([Store.raw().segments.length, Select.get()], [3, [{ kind: 'segment', index: 1 }]]);
    });
    await t('Delete removes the selected segment; undo brings it back', async () => {
      load(plain());
      Select.select([{ kind: 'segment', index: 1 }]);
      const before = snap();
      document.querySelector('#selection-card [data-action="delete"]').click();
      const after = [Store.raw().segments.length, oneStep(before), Select.get()];
      Store.undo();
      return eq([after, Store.raw().segments.length], [[1, true, []], 2]);
    });
    await t('the Delete key removes a multi-selection in one undo step (segment, podium, context, carve, crown)', async () => {
      load(full());
      Select.select([{ kind: 'segment', index: 1 }, { kind: 'podium', index: 0 }, { kind: 'context', index: 0 }, { kind: 'carve', index: 0 }, { kind: 'crown', index: 0 }]);
      const before = snap();
      key('Delete');
      const s = Store.raw();
      const after = [s.segments.length, s.podium.on, s.context.blocks.length, s.carves.length, s.crown.type, oneStep(before)];
      Store.undo();
      const u = Store.raw();
      return eq([after, [u.segments.length, u.podium.on, u.context.blocks.length, u.carves.length, u.crown.type]], [[1, false, 0, 0, 'none', true], [2, true, 1, 1, 'stepped']]);
    });
    await t('the last segment cannot be deleted (a toast says why)', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      const v0 = Store.version();
      document.querySelector('#selection-card [data-action="delete"]').click();
      const text = toastText();
      return eq([Store.raw().segments.length, Store.version() === v0, /at least one segment/.test(text)], [1, true, true]);
    });
    await t('deleting every segment in a multi-selection keeps one', async () => {
      load(plain());
      Select.select([{ kind: 'segment', index: 0 }, { kind: 'segment', index: 1 }]);
      key('Backspace');
      return eq(Store.raw().segments.length, 1);
    });

    /* ---- handles ---- */
    await t('handles: all five in the axon, only the sensible ones in N / E and Plan; none for crown, carve or a multi-selection', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      const ids = (v) => { Render.setView(v, false); return Select.visibleHandles().sort(); };
      const got = { axon: ids('axon'), n: ids('n'), e: ids('e'), s: ids('s'), plan: ids('plan') };
      Render.setView('axon', false);
      Select.select([{ kind: 'crown', index: 0 }]);
      const crown = Select.visibleHandles();
      Select.select([{ kind: 'segment', index: 0 }, { kind: 'podium', index: 0 }]);
      const multi = Select.visibleHandles();
      Select.select([{ kind: 'podium', index: 0 }]);
      const podium = Select.visibleHandles().sort();
      Select.select([{ kind: 'context', index: 0 }]);
      const context = Select.visibleHandles().sort();
      Select.clear();
      return eq([got, crown, multi, podium, context], [
        { axon: ['depth', 'move-x', 'move-y', 'top', 'width'], n: ['move-x', 'top', 'width'], e: ['depth', 'move-y', 'top'], s: ['move-x', 'top', 'width'], plan: ['depth', 'move-x', 'move-y', 'width'] },
        [], [], ['depth', 'move-x', 'move-y', 'top', 'width'], ['depth', 'move-x', 'move-y', 'top', 'width']]);
    });
    await t('handles: the hit area is at least 44 CSS px on touch (36 px with a mouse)', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.visibleHandles();
      const el = document.querySelector('.hdl[data-handle="move-x"]');
      const r = el.getBoundingClientRect();
      let base = null;
      for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule.selectorText === '.hdl' && rule.style.width) base = rule.style.width;
      const coarse = matchMedia('(pointer: coarse)').matches;
      Select.clear();
      return base === '44px' && (coarse ? r.width >= 44 : r.width >= 36) ? true : `base ${base}, size ${r.width}, coarse ${coarse}`;
    });
    await t('handle move snaps a segment edge to the podium edge (offset matches); one undo step', async () => {
      load(one());
      Store.set('view.snap', { on: true, grid: 5 }, { live: false });
      Select.select([{ kind: 'segment', index: 0 }]);
      const before = snap();
      const res = Select.simulateHandleDrag('move-x', 58, 0);
      const g = res && res.guides[0];
      const off = Store.raw().segments[0].offset;
      return eq([off.x, off.y, g && g.kind, g && g.value, oneStep(before), Select.dragging()], [60, 0, 'podium', 110, true, false]);
    });
    await t('handle move with Alt does not snap', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      const res = Select.simulateHandleDrag('move-x', 58, 0, { alt: true });
      return eq([Store.raw().segments[0].offset.x, res.guides.length], [58, 0]);
    });
    await t('handle move with the Snap toggle off does not snap either', async () => {
      load(one());
      Store.set('view.snap', { on: false, grid: 5 }, { live: false });
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.simulateHandleDrag('move-x', 58, 0);
      const x = Store.raw().segments[0].offset.x;
      Store.set('view.snap', { on: true, grid: 5 }, { live: false });
      return eq(x, 58);
    });
    await t('handle move with nothing near snaps to the grid (5 ft)', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.simulateHandleDrag('move-y', 0, 22);
      return near(Store.raw().segments[0].offset.y % 5, 0, 1e-6);
    });
    await t('width handle keeps the west edge fixed', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      const before = snap();
      const res = Select.simulateHandleDrag('width', 20, 0);
      const g = Store.raw().segments[0];
      return eq([g.shape.w, g.offset.x - g.shape.w / 2, g.shape.d, g.offset.y, oneStep(before), /^Width /.test(res.label)], [120, -50, 100, 0, true, true]);
    });
    await t('depth handle keeps the south edge fixed', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.simulateHandleDrag('depth', 0, 10);
      const g = Store.raw().segments[0];
      return eq([g.shape.d, g.offset.y - g.shape.d / 2, g.shape.w], [110, -50, 100]);
    });
    await t('width handle snaps the moving edge to a target (podium east edge)', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      const res = Select.simulateHandleDrag('width', 58, 0);
      const g = Store.raw().segments[0];
      return eq([g.shape.w, g.offset.x, res.guides[0] && res.guides[0].kind], [160, 30, 'podium']);
    });
    await t('top handle adds floors (round of height / floor-to-floor, minimum 1); one undo step', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      const before = snap();
      const res = Select.simulateHandleDrag('top', 0, 33);
      const n = Store.raw().segments[0].floors, steps = oneStep(before);
      Store.undo();
      const back = Store.raw().segments[0].floors;
      Select.simulateHandleDrag('top', 0, -500);
      const min = Store.raw().segments[0].floors;
      return eq([n, steps, back, min, /^13 floors · 130'-0"$/.test(res.label)], [13, true, 10, 1, true]);
    });
    await t('top handle on the podium and on a context block', async () => {
      load(one());
      Select.select([{ kind: 'podium', index: 0 }]);
      Select.simulateHandleDrag('top', 0, 28);
      const pf = Store.raw().podium.floors;
      Select.select([{ kind: 'context', index: 0 }]);
      const res = Select.simulateHandleDrag('top', 0, 15);
      return eq([pf, Store.raw().context.blocks[0].h, res.label], [5, 75, `Height 75'-0"`]);
    });
    await t('context block: move and width through its handles', async () => {
      load(one());
      Select.select([{ kind: 'context', index: 0 }]);
      Select.simulateHandleDrag('move-x', 30, 0, { alt: true });
      Select.simulateHandleDrag('width', 20, 0, { alt: true });
      const b = Store.raw().context.blocks[0];
      return eq([b.x, b.w, b.x - b.w / 2], [30 + 10, 220, -100 + 30]);
    });
    await t('a held drag: orbit is off, a gesture is open, guides and label show; release commits ONE undo step and restores orbit', async () => {
      load(one());
      Store.set('view.snap', { on: true, grid: 5 }, { live: false });
      Select.select([{ kind: 'segment', index: 0 }]);
      const before = snap();
      Select.simulateHandleDrag('move-x', 58, 0, { hold: true });
      const live = [Select.dragging(), Store.gestureActive(), Render.orbitEnabled(), Select.overlayInfo().guides > 0, /^Offset x/.test($('dragLabel').textContent), $('dragLabel').hidden];
      Select.releaseHandleDrag();
      const done = [Select.dragging(), Store.gestureActive(), Render.orbitEnabled(), Select.overlayInfo().guides, $('dragLabel').hidden, oneStep(before)];
      return eq([live, done], [[true, true, false, true, true, false], [false, false, true, 0, true, true]]);
    });
    await t('Escape during a held drag cancels it and leaves the design untouched', async () => {
      load(one());
      Select.select([{ kind: 'segment', index: 0 }]);
      const before = snap();
      Select.simulateHandleDrag('move-x', 58, 0, { hold: true });
      key('Escape');
      const same = snap() === before;
      Store.undo();                                          // a cancelled drag left no step: this undo reverts the load before it
      const stepLeft = snap() === before;
      Store.redo();
      return eq([same, stepLeft, Select.dragging(), Render.orbitEnabled(), Select.get().length], [true, false, false, true, 1]);
    });
    await t('handles work in an elevation: move and width in the North view, depth in the East view', async () => {
      load(one(), 'n');
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.simulateHandleDrag('move-x', 12, 0, { alt: true });
      Select.simulateHandleDrag('width', 10, 0, { alt: true });
      Render.setView('e', false);
      Select.simulateHandleDrag('depth', 0, 8, { alt: true });
      const g = Store.raw().segments[0];
      return eq([g.offset.x, g.shape.w, g.shape.d, g.offset.y], [17, 110, 108, 4]);
    });
    await t('handles work in Plan: a move in y', async () => {
      load(one(), 'plan');
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.simulateHandleDrag('move-y', 0, -14, { alt: true });
      return eq(Store.raw().segments[0].offset.y, -14);
    });
    await t('a rotated (45 deg) or polygon segment shows only move and top handles', async () => {
      const s = one(); s.segments[0].rotation = 45;
      load(s);
      Select.select([{ kind: 'segment', index: 0 }]);
      const rot = Select.visibleHandles().sort();
      const s2 = one(); s2.segments[0].rotation = 90;
      load(s2);
      Select.select([{ kind: 'segment', index: 0 }]);
      const quarter = Select.visibleHandles().length;
      Select.clear();
      return eq([rot, quarter], [['move-x', 'move-y', 'top'], 5]);
    });
    await t('selection changes with the design: undo of a delete drops stale items', async () => {
      load(plain());
      Select.select([{ kind: 'segment', index: 1 }]);
      Store.set('segments', [Store.raw().segments[0]], { live: false });
      const dropped = Select.get().length;
      Store.undo();
      return eq(dropped, 0);
    });
    await t('the selection outline exists in Model and in Diagram, and is not part of the captured scene flags', async () => {
      load(full());
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.refreshOverlay();
      const model = Select.overlayInfo().outline;
      Store.set('view.style', 'diagram', { live: false });
      Select.refreshOverlay();
      const diagram = Select.overlayInfo().outline;
      Store.set('view.style', 'model', { live: false });
      Select.clear();
      Select.refreshOverlay();
      return eq([model > 0, diagram > 0, Select.overlayInfo().outline], [true, true, 0]);
    });
  } finally {
    Render.setOrbitEnabled(true);
    Select.clear();
    Pop.close();
    Store.replace(savedState);
    UI.setTab(savedTab);
    await frames(2);
    Render.setView(savedView, false);
    Options.holdAutosave(false);
  }
  return results;
}
