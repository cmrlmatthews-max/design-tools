/* ==========================================================================
   TESTS: Option menu > New design
   Resets everything to the built-in default as a new unsaved "Untitled" option,
   leaves the saved options alone, and is one undo step. Runs after the selection
   tests (runAllTests in 12b merges the results). The tests restore the design,
   the view and the saved options when they finish.
   ========================================================================== */
async function runNewDesignTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const noName = (s) => ({ ...s, name: '' });
  const snap = () => JSON.stringify(Store.snapshot());

  const savedState = Store.snapshot();
  const savedView = Render.info().preset || 'axon';
  const made = [];                                   // saved options created here, removed at the end
  Options.holdAutosave(true);

  /** Edit the design in the ways a user would: floors, a second segment, the site width, a unit size, the style. */
  const edit = () => {
    Select.clear();
    Store.replace(defaultState());
    Store.set('segments.0.floors', 23, { live: false });
    Store.set('segments', [...Store.raw().segments, { ...defaultSegment(), floors: 4, program: 'office', offset: { x: 60, y: 0 } }], { live: false });
    Store.set('site.width', 310, { live: false });
    Store.set('programs.residential.unitSize', 1200, { live: false });
    Store.set('view.style', 'diagram', { live: false });
    Store.set('name', 'My tower', { live: false });
  };

  try {
    await t('New design gives the built-in default state (ignoring the name) after many edits', async () => {
      edit();
      const edited = JSON.stringify(noName(Store.snapshot())) !== JSON.stringify(noName(defaultState()));
      await Options.newDesign({ confirm: false });
      return eq([edited, noName(Store.snapshot())], [true, noName(defaultState())]);
    });
    await t('default values: GFA 100,000, 10 floors, one 100x100 segment, 250x200 site, Model view, color by program, snap on at 5 ft', async () => {
      edit();
      await Options.newDesign({ confirm: false });
      const m = Derived.get().metrics, s = Store.raw();
      return eq([Math.round(m.gfa), m.floorCount, s.segments.length, s.segments[0].shape.w, s.site.width, s.site.depth, s.view.style, s.view.colorBy, s.view.snap],
        [100000, 10, 1, 100, 250, 200, 'model', 'program', { on: true, grid: 5 }]);
    });
    await t('the new option is named "Untitled", is unsaved, and is not linked to a saved option', async () => {
      edit();
      await Options.newDesign({ confirm: false });
      return eq([Store.get('name'), Options.current(), document.getElementById('unsavedDot').hidden], ['Untitled', null, false]);
    });
    await t('saved options are unchanged (count and contents), even when the design on screen is linked to one and edited', async () => {
      const keep = Options.storage.save(Store.snapshot(), 'Kept A');
      made.push(keep);
      Options.loadOption(keep);
      Store.set('segments.0.floors', 12, { live: false });
      const list = JSON.stringify(Options.list()), recs = JSON.stringify(Options.list().map((o) => Options.get(o.id)));
      await Options.newDesign({ confirm: false });
      return eq([JSON.stringify(Options.list()), JSON.stringify(Options.list().map((o) => Options.get(o.id)))], [list, recs]);
    });
    await t('one undo restores the previous design exactly, and one redo starts the new design again', async () => {
      edit();
      const before = snap();
      await Options.newDesign({ confirm: false });
      const fresh = snap();
      Store.undo();
      const back = snap() === before;
      Store.redo();
      return eq([back, snap() === fresh, Store.get('name')], [true, true, 'Untitled']);
    });
    await t('the selection and any open handle drag are cleared', async () => {
      edit();
      Select.select([{ kind: 'segment', index: 0 }]);
      Select.simulateHandleDrag('width', 10, 0, { alt: true, hold: true });
      const during = Select.dragging();
      await Options.newDesign({ confirm: false });
      return eq([during, Select.get(), Select.dragging()], [true, [], false]);
    });
    await t('Compare is closed and the AI Prompts panel is closed', async () => {
      edit();
      Options.storage.save(Store.snapshot(), 'Kept B');
      made.push(Options.list().find((o) => o.name === 'Kept B').id);
      Compare.enter();
      Prompts.open();
      const open = [Compare.isActive(), Prompts.isOpen()];
      await Options.newDesign({ confirm: false });
      return eq([open, Compare.isActive(), Render.comparing(), Prompts.isOpen()], [[true, true], false, false, false]);
    });
    await t('the camera is reframed to Axon', async () => {
      edit();
      Render.setView('plan', false);
      await Options.newDesign({ confirm: false });
      return eq(Render.info().preset, 'axon');
    });
    await t('name collision: with a saved "Untitled" the new option is "Untitled (2)", then "Untitled (3)"', async () => {
      const id = Options.storage.save(defaultState(), 'Untitled');
      made.push(id);
      edit();
      await Options.newDesign({ confirm: false });
      const second = Store.get('name');
      const id2 = Options.storage.save(Store.snapshot(), second);
      made.push(id2);
      await Options.newDesign({ confirm: false });
      return eq([second, Store.get('name')], ['Untitled (2)', 'Untitled (3)']);
    });
    await t('the toast says "New design started."', async () => {
      edit();
      await Options.newDesign({ confirm: false });
      const text = [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join(' | ');
      return text.includes('New design started.') || `toasts: ${text}`;
    });
    await t('unsaved changes ask first: Cancel keeps the design, Start new replaces it', async () => {
      edit();
      const before = snap();
      const asked = Options.hasUnsavedChanges();
      const p1 = Options.newDesign();
      const dlg = document.querySelector('.modal-back .modal');
      const text = dlg ? dlg.querySelector('p').textContent : '';
      const labels = dlg ? [...dlg.querySelectorAll('button')].map((b) => b.textContent) : [];
      [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
      const cancelled = await p1;
      const kept = snap() === before;
      const p2 = Options.newDesign();
      [...document.querySelectorAll('.modal-back .modal button')].find((b) => b.textContent === 'Start new').click();
      const went = await p2;
      return eq([asked, text, labels.sort(), cancelled, kept, went, /^Untitled/.test(Store.get('name'))],
        [true, 'Start a new design? Unsaved changes to “My tower” will be lost. You can undo this.', ['Cancel', 'Start new'], false, true, true, true]);
    });
    await t('no unsaved changes: it starts at once, without a question', async () => {
      await Options.newDesign({ confirm: false });
      const ask = Options.hasUnsavedChanges();
      const done = await Options.newDesign();
      return eq([ask, done, !!document.querySelector('.modal-back')], [false, true, false]);
    });
    await t('the Option menu lists New design first, with its hint', async () => {
      document.getElementById('btnOption').click();
      const first = document.querySelector('#optionMenu .pop-item');
      const out = [first && first.id, first && first.querySelector('small') && first.querySelector('small').textContent, first && first.querySelector('.grow').firstChild.textContent];
      Pop.close();
      return eq(out, ['miNewDesign', 'Start fresh from the default tower', 'New design']);
    });
  } finally {
    for (const id of made) { try { Options.storage.remove(id); } catch (e) { /* already gone */ } }
    document.querySelectorAll('.modal-back').forEach((n) => n.remove());
    Prompts.close();
    Pop.close();
    if (Compare.isActive()) Compare.exit();
    Select.clear();
    Store.replace(savedState);
    Render.setView(savedView, false);
    Options.holdAutosave(false);
  }
  return results;
}
