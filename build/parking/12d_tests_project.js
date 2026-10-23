/* ==========================================================================
   TESTS: the project file
   Open a project with a Mid-Rise style massing (deck levels, a bar level with core seeds), read the deck levels and plates
   (plan section 7), write the parking section (1 s debounce, visibilitychange, pagehide), keep every other section, a newer
   schema, close. A fixture project lives in an in-memory storage, so a ?test visit never touches the saved projects.
   runAllTests (below) runs every test file and merges the results.
   ========================================================================== */
const ProjectFixture = (() => {
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  const rect = (w, d) => [[0, 0], [w, 0], [w, d], [0, d]];
  /** A massing section: 5 deck levels of 300 x 125 ft (floor-to-floor `ftf`), 4 bar levels above, 100 units. `seeds`: core seeds on the bar levels. */
  function massing({ ftf = 10.5, seeds = false, units = 100 } = {}) {
    const levels = [];
    for (let i = 0; i < 5; i++) levels.push({ index: i + 1, zone: 'deck', z: i * ftf, ftf, plates: [{ outer: rect(300, 125), holes: [] }] });
    for (let i = 0; i < 4; i++) {
      const lv = { index: 6 + i, zone: 'bar', z: 5 * ftf + i * 10, ftf: 10, plates: [{ outer: rect(300, 90), holes: [] }] };
      if (seeds) lv.seeds = [{ kind: 'stair', outer: [[40, 10], [62, 10], [62, 22], [40, 22]] }, { kind: 'elevator', outer: [[70, 10], [80, 10], [80, 20], [70, 20]] }];
      levels.push(lv);
    }
    return { tool: 'midrise', schema: 1, placement: { x: 10, y: 20, rotation: 0, baseZ: 0 }, state: {}, derived: { levels, metrics: { units } } };
  }
  function project(opts = {}, name = 'Fixture') {
    let doc = ProjectMod.newProject({ name });
    doc = ProjectMod.writeSection(doc, 'massing', massing(opts));
    doc = ProjectMod.writeSection(doc, 'plates', { tool: 'plate', schema: 1, placement: { x: 1, y: 2, rotation: 0, baseZ: 3 }, state: { keep: 'me' }, derived: { levels: [] } });
    return doc;
  }
  return { memory, massing, project };
})();

async function runProjectTests() {
  const { eq, near, make, $, wait, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const mem = ProjectFixture.memory();
  const urls = [], navs = [];
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: (u) => navs.push(u), updateUrl: (id) => urls.push(id) });
  const stored = (id) => ProjectMod.loadProject(mem, id);
  const open = (opts, name) => { const doc = ProjectFixture.project(opts, name); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };
  const fresh = () => { Store.replace(fillDefaults(defaultState())); };

  try {
    fresh();
    await t('no project: the standalone deck is the default and the project line is empty', () => eq([ProjectUI.has(), Store.get('source'), ProjectUI.sources()], [false, 'standalone', []]));

    await t('opening a project with a deck lists its levels and starts with the wrap deck', () => {
      const doc = open();
      const src = ProjectUI.sources();
      return eq([ProjectUI.has(), src.map((x) => [x.source, x.levels.length]), Store.get('source'), Store.get('levels.count')], [true, [['wrap', 5]], 'wrap', 5]);
    });
    await t('the wrap deck reads the plate: 496 stalls, 378 sf per stall, 5 levels', () => {
      const h = Derived.get().hud;
      return eq([h.stalls, Math.round(h.sfPerStall * 10) / 10, h.levels], [496, 378.0, 5]);
    });
    await t('the source picker lists the deck levels; a later first level shortens the deck', () => {
      UI.setTab('layout');
      const opts = [...document.querySelectorAll('#selSourceLevel option')].map((o) => o.value);
      const sel = $('selSourceLevel');
      sel.value = '2'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const out = [opts.length, Store.get('levels.count'), Store.get('sourceLevel')];
      sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return eq(out, [5, 4, 2]);
    });
    await t('the footprint of a wrap deck is not editable (no footprint item)', () => {
      Select.select([{ kind: 'footprint' }]);
      const n = Select.count();
      Select.clear();
      return eq(n, 0);
    });
    await t('the massing placement is taken into the state', () => eq(Store.get('placement'), { x: 10, y: 20, rotation: 0, baseZ: 0, baseMode: 'follow' }));
    await t('the parking section is written after the 1 s debounce, with the state and the derived numbers', async () => {
      Store.set('bays.stallW', 9.5, { live: false });
      await wait(1500);
      const sec = ProjectMod.getSection(stored(ProjectUI.doc().id), 'parking');
      return eq([!!sec, sec && sec.tool, sec && sec.schema, sec && sec.state.bays.stallW, !!(sec && sec.derived)], [true, 'parking', 1, 9.5, true]);
    });
    await t('writing the parking section keeps the massing and the plates untouched', () => {
      const doc = stored(ProjectUI.doc().id);
      const m = ProjectMod.getSection(doc, 'massing'), p = ProjectMod.getSection(doc, 'plates');
      return eq([m.tool, m.derived.levels.length, p.state], ['midrise', 9, { keep: 'me' }]);
    });
    await t('visibilitychange (hidden) and pagehide flush a pending change at once', () => {
      Store.set('bays.stallW', 9, { live: false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.visibilityState;
      const a = ProjectMod.getSection(stored(ProjectUI.doc().id), 'parking').state.bays.stallW;
      Store.set('bays.stallW', 9.25, { live: false });
      window.dispatchEvent(new Event('pagehide'));
      const b = ProjectMod.getSection(stored(ProjectUI.doc().id), 'parking').state.bays.stallW;
      return eq([a, b], [9, 9.25]);
    });
    await t('reopening the project loads the saved parking state', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.flush();
      fresh();
      ProjectUI.openDoc(stored(id));
      return eq([Store.get('bays.stallW'), Store.get('source')], [9.25, 'wrap']);
    });
    await t('closing the project returns to a standalone deck', () => {
      ProjectUI.close();
      return eq([ProjectUI.has(), Store.get('source'), Store.get('placement')], [false, 'standalone', null]);
    });

    await t('a podium-only massing offers the podium source', () => {
      const m = ProjectFixture.massing();
      m.derived.levels.forEach((l) => { if (l.zone === 'deck') l.zone = 'podium'; });
      let doc = ProjectMod.newProject({ name: 'Podium' });
      doc = ProjectMod.writeSection(doc, 'massing', m);
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const out = [ProjectUI.sources().map((x) => x.source), Store.get('source')];
      ProjectUI.close();
      return eq(out, [['podium'], 'podium']);
    });
    await t('a low floor-to-floor in the massing gives the clear-height warning', () => {
      open({ ftf: 9 }, 'Low');
      const w = Derived.get().warnings.filter((x) => /^clear-height/.test(x.id));
      ProjectUI.close();
      return w.length ? true : 'no clear-height warning';
    });
    await t('cores from the project: the seeds become cores that carry the project flag', () => {
      open({ seeds: true }, 'Seeds');
      const d = Derived.get();
      const out = [d.cores.length >= 2, d.cores.every((c) => c.fromProject), d.cores.some((c) => c.kind === 'elevator')];
      ProjectUI.close();
      return eq(out, [true, true, true]);
    });
    await t('the units come from the massing: 100 units need 125 stalls', () => {
      open({ units: 100 }, 'Units');
      const out = [Derived.get().hud.required, ProjectUI.massingUnits()];
      ProjectUI.close();
      return eq(out, [125, 100]);
    });
    await t('a newer parking schema opens read-only and is not overwritten', async () => {
      let doc = ProjectFixture.project({}, 'Newer');
      doc = ProjectMod.writeSection(doc, 'parking', { tool: 'parking', schema: 99, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { name: 'future' }, derived: {} });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('bays.stallW', 9.1, { live: false });
      await wait(1300);
      const sec = ProjectMod.getSection(stored(doc.id), 'parking');
      const out = [ProjectUI.status().readOnly, sec.schema];
      ProjectUI.close();
      return eq(out, [true, 99]);
    });
    await t('project export and the pill', () => {
      open({}, 'Pill');
      const pill = $('projPill');
      const out = [!pill.hidden, /Pill/.test(pill.textContent)];
      ProjectUI.close();
      return eq([out, $('projPill').hidden], [[true, true], true]);
    });
    await t('Send to Facade Studio is enabled in the menu of an open project', async () => {
      open({}, 'Send');
      $('btnExport').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await TestHelp.frames(2);
      const b = $('miSendFacade');
      const out = [!!b && !b.disabled, b ? /Facade Studio/.test(b.textContent) : false];
      Pop.close();
      ProjectUI.close();
      return eq(out, [true, true]);
    });
  } finally {
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    Select.clear();
    Store.replace(savedState);
    UI.setTab(savedTab, { remember: false });
    Options.holdAutosave(false);
  }
  return results;
}

/** Every test file, merged. This is what ?test and __parking.runTests run. */
async function runAllTests() {
  const base = await runTests();
  const ui = await runUiTests();
  const select = await runSelectTests();
  const project = await runProjectTests();
  const all = [...base, ...ui, ...select, ...project];
  const failed = all.filter((r) => !r.ok);
  TestHelp.merged('all', all);
  window.__parkingTestResults = { total: all.length, passed: all.length - failed.length, failed, results: all };
  return window.__parkingTestResults;
}
