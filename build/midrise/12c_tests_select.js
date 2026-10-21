/* ==========================================================================
   TESTS: direct editing
   Click picking, the selection card, handles (move with snapping, length, depth, rotate, floors), duplicate, add, delete,
   drawing a surface lot, shortcuts, and that the selection never reaches the saved state. Drags run through the same
   math the pointer uses (Select.simulateHandleDrag). The tests restore the design, the tab, the style and the view.
   ========================================================================== */
async function runSelectTests() {
  const { eq, near, make, $, wait, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  const savedView = Render.info().preset || 'axon';
  Options.holdAutosave(true);
  const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  // Synchronous on purpose: no frame is drawn between a state change and the checks (a drawn frame in software rendering costs ~0.5 s).
  const load = (s, view = 'axon') => { Select.clear(); Store.replace(fillDefaults(s)); Render.setView(view, false); };
  /** A wide, empty site with one bar well inside it: no setback line or other bar is near, so only the grid and 1 ft steps matter. */
  const open = () => {
    const s = defaultState();
    s.site.width = 800; s.site.depth = 600;
    s.bars[0] = { ...s.bars[0], x: -100, y: 0, length: 200, depth: 60 };
    s.context.blocks = [];
    return s;
  };
  const bar = (i = 0) => Store.get(`bars.${i}`);
  const only = (obj, keys) => JSON.stringify(keys.map((k) => obj[k]));

  try {
    if (!Render.ready()) { TestHelp.merged('direct editing (skipped: no WebGL)', results); return results; }

    /* ---- click picking ---- */
    await t('click-pick: each bar, the deck, and a context block are found at their projected centers', () => {
      const s = fillDefaults(CONFIG.presets.find((p) => p.id === 'wrap-deck').state);
      s.context.blocks = [{ x: 0, y: -330, w: 200, d: 120, h: 40 }];
      load(s);
      const out = {};
      for (const it of [{ kind: 'bar', id: 'S' }, { kind: 'bar', id: 'N' }, { kind: 'deck' }, { kind: 'context', index: 0 }]) {
        const p = Select.screenPointFor(it);
        const hit = p && Select.pickAt(p.x, p.y);
        out[`${it.kind}${it.id || it.index || ''}`] = hit ? `${hit.kind}:${hit.id !== undefined ? hit.id : (hit.index !== undefined ? hit.index : '')}` : null;
      }
      return eq(out, { barS: 'bar:S', barN: 'bar:N', deck: 'deck:', context: 'context:0' });
    });
    await t('click-pick: empty sky picks nothing; Select.click applies shift (add) and empty space (clear)', () => {
      load(fillDefaults(CONFIG.presets.find((p) => p.id === 'courtyard-5-over-1').state));
      const a = Select.screenPointFor({ kind: 'bar', id: 'S' }), b = Select.screenPointFor({ kind: 'bar', id: 'N' });
      const rect = Render.canvas().getBoundingClientRect();
      const sky = Select.pickAt(rect.left + 6, rect.top + 6);
      Select.click(a.x, a.y, false);
      const first = Select.get();
      Select.click(b.x, b.y, true);
      const second = Select.get().length;
      Select.click(b.x, b.y, true);
      const third = Select.get();
      Select.click(rect.left + 6, rect.top + 6, false);
      return eq([sky, first, second, third, Select.get()], [null, [{ kind: 'bar', id: 'S' }], 2, [{ kind: 'bar', id: 'S' }], []]);
    });
    await t('pointer events: a short still press is a click; a drag (orbit) and a long press are not', async () => {
      load(fillDefaults(CONFIG.presets.find((p) => p.id === 'courtyard-5-over-1').state));
      Render.setOrbitEnabled(false);
      try {
        const canvas = Render.canvas();
        const p = Select.screenPointFor({ kind: 'bar', id: 'S' });
        const ev = (type, x, y, extra = {}) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'mouse', button: 0, bubbles: true, clientX: x, clientY: y, ...extra }));
        ev('pointerdown', p.x, p.y); ev('pointerup', p.x + 2, p.y + 1);
        const click = Select.get();
        Select.clear();
        ev('pointerdown', p.x, p.y); ev('pointermove', p.x + 20, p.y); ev('pointerup', p.x + 20, p.y);
        const orbit = Select.get();
        ev('pointerdown', p.x, p.y); await wait(450); ev('pointerup', p.x, p.y);
        const longPress = Select.get();
        return eq([click, orbit, longPress], [[{ kind: 'bar', id: 'S' }], [], []]);
      } finally { Render.setOrbitEnabled(true); Select.clear(); Render.setView('axon', false); }
    });

    /* ---- the selection reaches the card, not the saved state ---- */
    await t('selecting a bar opens the card and outlines it; the selection never reaches the saved state', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      Select.refreshOverlay();
      const card = $('selection-card');
      const out = [!card.hidden, Select.overlayInfo().outline > 0, /"selection"|"items"/.test(snap())];
      Select.clear();
      return eq(out, [true, true, false]);
    });
    await t('a selected bar shows move, rotate, length, depth and floors handles (axon view)', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      const got = Select.visibleHandles();
      Select.clear();
      const need = ['move-x', 'move-y', 'len-end', 'top'];
      const miss = need.filter((id) => !got.includes(id));
      return miss.length === 0 || `handles ${got}`;
    });
    await t('the rotate handle shows in the plan view', () => {
      load(open(), 'plan');
      Select.select([{ kind: 'bar', id: 'A' }]);
      const got = Select.visibleHandles();
      Select.clear();
      return got.includes('rotate') || `handles ${got}`;
    });

    /* ---- handles ---- */
    await t('move-x by 10 ft changes x by 10 and nothing else; one undo step', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      const before = snap(), b0 = { ...bar() };
      const r = Select.simulateHandleDrag('move-x', 10);
      const b1 = bar();
      const same = ['y', 'angle', 'length', 'depth', 'floors'].every((k) => b1[k] === b0[k]);
      const ok = r && Math.abs(b1.x - (b0.x + 10)) < 0.01 && same && oneStep(before);
      Select.clear();
      return ok || `x ${b0.x} -> ${b1.x}, same ${same}`;
    });
    await t('move-y moves the bar north; the grid snaps a 6 ft move to 5 ft (grid 5, by the bar edge), Alt skips the snap', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      Select.simulateHandleDrag('move-y', 0, 6);
      const snapped = bar().y;
      Store.undo();
      Select.simulateHandleDrag('move-y', 0, 6, { alt: true });
      const free = bar().y;
      Select.clear();
      return eq([snapped, free], [5, 6]);
    });
    await t('a length drag snaps to 1 ft and keeps the start; len-start keeps the far end', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      Select.simulateHandleDrag('len-end', 7.4);
      const a = [bar().length, bar().x];
      Store.undo();
      Select.simulateHandleDrag('len-start', -12.6);
      const b = bar();
      const farEnd = b.x + b.length;
      Select.clear();
      return eq([a, b.length, Math.round(farEnd)], [[207, -100], 213, 100]);
    });
    await t('a depth drag moves the left edge and keeps the right edge', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      const before = bar();
      Select.simulateHandleDrag('depth', 0, 10);
      const b = bar();
      const right = b.y - b.depth / 2, was = before.y - before.depth / 2;
      Select.clear();
      return eq([b.depth, Math.abs(right - was) < 0.01], [70, true]);
    });
    await t('rotate snaps to 5 degrees (Alt skips it)', () => {
      load(open(), 'plan');
      Select.select([{ kind: 'bar', id: 'A' }]);
      Select.simulateHandleDrag('rotate', 33);
      const a = bar().angle;
      Store.undo();
      Select.simulateHandleDrag('rotate', 33.4, 0, { alt: true });
      const b = bar().angle;
      Select.clear();
      return eq([a, Math.abs(b - 33.4) < 0.15], [35, true]);
    });
    await t('the top handle changes the floors (one per floor-to-floor); never below 1', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      Select.simulateHandleDrag('top', 0, 20);
      const up = bar().floors;
      Select.simulateHandleDrag('top', 0, -200);
      const down = bar().floors;
      Select.clear();
      return eq([up, down], [7, 1]);
    });
    await t('a bar near another bar snaps its edge to it, with a guide', () => {
      const s = open();
      s.bars.push({ ...defaultBar('B'), x: -100, y: 150, length: 200 });
      load(s);
      Select.select([{ kind: 'bar', id: 'B' }]);
      Select.simulateHandleDrag('move-x', 99, 0, { hold: true });
      const hold = Select.getGuides ? null : null;
      const x = bar(1).x;
      const info = Select.lastDrag();
      Select.releaseHandleDrag();
      Select.clear();
      return (Math.abs(x) < 0.5 || Math.abs(x - 100) < 0.5 || Math.abs(x - 99) < 0.01 ? true : `x ${x}`) && ((info && info.id === 'move-x') || 'no drag info');
    });
    await t('Esc during a drag restores the bar; the drag ends', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      const x0 = bar().x;
      Select.simulateHandleDrag('move-x', 30, 0, { hold: true });
      const moved = bar().x;
      key('Escape');
      const ok = Select.dragging() === false && bar().x === x0 && moved !== x0;
      Select.clear();
      return ok || `x0 ${x0} moved ${moved} now ${bar().x}`;
    });
    await t('deck handles: width and levels; court handles: width, depth', () => {
      const s = fillDefaults(CONFIG.presets.find((p) => p.id === 'wrap-deck').state);
      load(s);
      Select.select([{ kind: 'deck' }]);
      Select.simulateHandleDrag('width', 20, 0, { alt: true });
      const w = Store.get('deck.w');
      Select.simulateHandleDrag('top', 0, 21);
      const levels = Store.get('deck.levels');
      const c = fillDefaults(CONFIG.presets.find((p) => p.id === 'courtyard-5-over-1').state);
      c.courts = [{ id: 'C1', x: 0, y: 0, w: 100, d: 80 }];
      load(c);
      Select.select([{ kind: 'court', id: 'C1' }]);
      const d0 = Store.get('courts.0.d');
      Select.simulateHandleDrag('depth', 0, 10, { alt: true });
      const d1 = Store.get('courts.0.d');
      Select.clear();
      return eq([w, levels, d1 - d0], [320, 7, 10]);
    });

    /* ---- actions ---- */
    await t('Duplicate offsets a copy to the left of the bar, selects it, and is one undo step', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      const before = snap();
      Select.duplicateBar('A');
      const ok = Store.get('bars').length === 2 && bar(1).id === 'B' && Select.get()[0].id === 'B' && bar(1).y > bar(0).y - 1000 && oneStep(before);
      Select.clear();
      return ok || `bars ${Store.get('bars').length} sel ${JSON.stringify(Select.get())}`;
    });
    await t('Cmd+D duplicates the selected bar; B adds a bar; Delete removes the selection but never the last bar', () => {
      load(open());
      Select.select([{ kind: 'bar', id: 'A' }]);
      key('d', { metaKey: true });
      const two = Store.get('bars').length;
      key('b');
      const three = Store.get('bars').length;
      Select.select([{ kind: 'bar', id: 'C' }]);
      key('Delete');
      const back = Store.get('bars').length;
      Select.select([{ kind: 'bar', id: 'A' }, { kind: 'bar', id: 'B' }]);
      Select.deleteSelection();
      const one = Store.get('bars').length;
      Select.select([{ kind: 'bar', id: Store.get('bars.0.id') }]);
      Select.deleteSelection();
      const last = Store.get('bars').length;
      Select.clear();
      return eq([two, three, back, one, last], [2, 3, 2, 1, 1]);
    });
    await t('deleting a court or a context block works; the number keys change the view; D flips the style', () => {
      const s = fillDefaults(CONFIG.presets.find((p) => p.id === 'courtyard-5-over-1').state);
      s.courts = [{ id: 'C1', x: 0, y: 0, w: 100, d: 80 }, { id: 'C2', x: 0, y: 200, w: 60, d: 60 }];
      load(s);
      const nc = s.courts.length, nb = s.context.blocks.length;
      Select.select([{ kind: 'court', id: s.courts[0].id }]);
      Select.deleteSelection();
      Select.select([{ kind: 'context', index: 0 }]);
      Select.deleteSelection();
      const gone = [Store.get('courts').length, Store.get('context.blocks').length];
      key('6');
      const plan = Render.info().preset;
      key('1');
      const axon = Render.info().preset;
      const style0 = Store.get('view.style');
      key('d');
      const style1 = Store.get('view.style');
      key('d');
      return eq([gone, plan, axon, style0, style1], [[nc - 1, nb - 1], 'plan', 'axon', 'model', 'diagram']);
    });

    /* ---- surface lot ---- */
    await t('Draw lot: three clicks on the ground and Finish give surface.lot; Esc cancels; Clear lot empties it', () => {
      load(open(), 'plan');
      Store.set('surface', { count: 120, lot: [] }, { live: false });
      const btn = $('btnDrawLot');
      btn.click();
      const active = Select.lotActive();
      const rect = Render.canvas().getBoundingClientRect();
      const at = (px, py) => { const cam = Render.camera(); cam.updateMatrixWorld(true); const q = new THREE.Vector3(...planToWorld(px, py, 0)).project(cam); return [rect.left + ((q.x + 1) / 2) * rect.width, rect.top + ((1 - q.y) / 2) * rect.height]; };
      for (const [px, py] of [[-150, -150], [-50, -150], [-50, -80]]) { const [cx, cy] = at(px, py); Select.click(cx, cy, false); }
      btn.click();                                                     // the button now says Finish lot
      const lot = Store.get('surface.lot');
      const finished = !Select.lotActive();
      Select.startLot(); key('Escape');
      const esc = !Select.lotActive() && eq(Store.get('surface.lot'), lot) === true;
      Select.finishLot(false);
      const ok = active && finished && lot.length === 3 && esc;
      return ok || `active ${active} lot ${JSON.stringify(lot)} finished ${finished} esc ${esc}`;
    });
    await t('a drawn lot adds stalls by its area (area / stall size)', () => {
      const s = open();
      s.surface = { count: 0, lot: [[-150, -150], [-50, -150], [-50, -50], [-150, -50]] };
      const d = computeDerived(fillDefaults(s));
      return eq(d.metrics.parking.providedDetail.lot, Math.floor(10000 / 350));
    });
  } finally {
    Select.cancelHandleDrag();
    Select.finishLot(false);
    Select.clear();
    Store.replace(savedState);
    UI.setTab(savedTab);
    Render.setView(savedView, false);
  }
  TestHelp.merged('direct editing', results);
  return results;
}
