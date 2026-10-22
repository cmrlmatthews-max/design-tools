/* ==========================================================================
   TESTS: the project file  (plan section 7)
   A hand-built project: a massing of two bars placed at x 40, y 60 (derived.footprint, the shape the Mid-rise Generator writes) and a
   site ground grid that falls 2 percent toward the east. Open it, read the footprint in the project frame, write the grading section
   (1 s debounce, visibilitychange, pagehide), keep every other section, a newer schema, a tower with no levels, a parking deck, close.
   The fixture lives in an in-memory storage, so a ?test visit never touches the saved projects.
   runAllTests (below) runs every test file and merges the results.
   ========================================================================== */
const ProjectFixture = (() => {
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  /** Two bars in the massing frame: 200 x 60 and 120 x 30. */
  const footprint = () => [{ outer: rect(-100, -30, 100, 30), holes: [] }, { outer: rect(-60, 40, 60, 70), holes: [] }];
  /** An n by n ground, 20 ft apart, z = 100 + 0.02 x. */
  function ground() {
    const n = 21, spacing = 20, x0 = -150, y0 = -100, points = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = x0 + i * spacing; points.push([x, y0 + j * spacing, 100 + 0.02 * x]); }
    return { spacing, n, points };
  }
  const massing = (tool, withFootprint) => ({ tool, schema: 1, placement: { x: 40, y: 60, rotation: 0, baseZ: 0 }, state: {}, derived: withFootprint ? { footprint: footprint(), levels: [{ index: 1, zone: 'bar', z: 0, ftf: 10, plates: footprint() }] } : {} });
  function project({ tool = 'midrise', footprintOn = true, site = true, parking = false, name = 'Fixture' } = {}) {
    let doc = ProjectMod.newProject({ name });
    if (tool) doc = ProjectMod.writeSection(doc, 'massing', massing(tool, footprintOn));
    if (site) doc = ProjectMod.writeSection(doc, 'site', { tool: 'site', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { ground: ground() } });
    if (parking) doc = ProjectMod.writeSection(doc, 'parking', { tool: 'parking', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { levels: [{ index: 1, z: 0, plate: [{ outer: rect(300, 0, 400, 60), holes: [] }] }] } });
    doc = ProjectMod.writeSection(doc, 'plates', { tool: 'plate', schema: 1, placement: { x: 1, y: 2, rotation: 0, baseZ: 3 }, state: { keep: 'me' }, derived: { levels: [] } });
    return doc;
  }
  return { memory, project, footprint, ground };
})();

async function runProjectTests() {
  const { eq, near, make, $, wait } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const mem = ProjectFixture.memory();
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
  const stored = (id) => ProjectMod.loadProject(mem, id);
  const open = (opts) => { const doc = ProjectFixture.project(opts); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };
  const fresh = () => { Store.replace(fillDefaults(defaultState())); };
  const box = (rings) => { const a = rings.flat(); return [Math.min(...a.map((p) => p[0])), Math.min(...a.map((p) => p[1])), Math.max(...a.map((p) => p[0])), Math.max(...a.map((p) => p[1]))]; };

  try {
    fresh();
    await t('no project: the standalone default bar, the project line is empty', () => eq([ProjectUI.has(), Store.get('source'), Store.get('buildings').length, Store.get('buildings')[0].source], [false, 'standalone', 1, 'typed']));
    await t('opening a project with a massing and a site makes the source "project", the ground "site", and one massing building', () => {
      open();
      const b = Store.get('buildings');
      return eq([ProjectUI.has(), Store.get('source'), Store.get('ground.mode'), b.length, b[0].source, ProjectUI.massingInfo().site], [true, 'project', 'site', 1, 'massing', true]);
    });
    await t('the massing footprint is read in the project frame: both bars, moved by the placement (x 40, y 60)', () => {
      const d = Derived.get(), bld = d.built.buildings[0];
      const bx = bld && box(bld.rings);
      return eq([d.built.source, d.built.ground, bld && bld.id, bld && bld.rings.length, bx], ['project', 'site', 'massing', 2, [-60, 30, 140, 130]]);
    });
    await t('the tier id is massing-T1 and the pad sits on the site ground (the existing ground follows 100 + 0.02 x)', () => {
      const d = Derived.get(), tr = d.built.tiers[0];
      return eq([tr && tr.id, near(d.built.existingAt(0, 0), 100, 1e-6), near(d.built.existingAt(100, 50), 102, 1e-6), d.metrics.tiers[0].id], ['massing-T1', true, true, 'massing-T1']);
    });
    await t('the Buildings tab says where the buildings come from, and the project line names the project', () => {
      UI.setTab('buildings'); UI.updateHud(Derived.get());
      return eq([/Project “Fixture”.*site ground, massing/.test($('projLine').textContent), $('sourceChips').querySelector('[aria-pressed="true"]').dataset.value], [true, 'project']);
    });
    await t('the grading section is written after 1 s, with the state, the derived numbers and every other section kept', async () => {
      const doc = ProjectUI.doc();
      Store.set('buildings.0.padOffset', 8, { live: false });
      await wait(1400);
      const back = stored(doc.id), sec = back && back.sections.grading;
      return eq([!!sec, sec && sec.tool, sec && sec.state.buildings[0].padOffset, !!(sec && sec.derived), !!back.sections.massing, !!back.sections.site, back.sections.plates.state], [true, 'grading', 8, true, true, true, { keep: 'me' }]);
    });
    await t('the grading section has an identity placement and the saved project validates', () => {
      const back = stored(ProjectUI.doc().id), sec = back.sections.grading;
      return eq([sec.placement, ProjectMod.validate(back).ok !== false], [{ x: 0, y: 0, rotation: 0, baseZ: 0 }, true]);
    });
    await t('the massing section is untouched by the write (placement and footprint)', () => {
      const m = stored(ProjectUI.doc().id).sections.massing;
      return eq([m.placement, m.derived.footprint.length], [{ x: 40, y: 60, rotation: 0, baseZ: 0 }, 2]);
    });
    await t('visibilitychange (hidden) and pagehide flush a pending change at once', () => {
      Store.set('buildings.0.padOffset', 6, { live: false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.visibilityState;
      const a = stored(ProjectUI.doc().id).sections.grading.state.buildings[0].padOffset;
      Store.set('buildings.0.padOffset', 4, { live: false });
      window.dispatchEvent(new Event('pagehide'));
      const b = stored(ProjectUI.doc().id).sections.grading.state.buildings[0].padOffset;
      return eq([a, b], [6, 4]);
    });
    await t('reopening the project loads the saved grading state', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.flush();
      fresh();
      ProjectUI.openDoc(stored(id));
      return eq([Store.get('buildings')[0].padOffset, Store.get('source')], [4, 'project']);
    });
    await t('a project saved by a newer tool is read only: opened, not written', async () => {
      let doc = ProjectFixture.project({ name: 'Newer' });
      doc.sections.grading = { tool: 'grading', schema: 99, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: {}, updatedAt: new Date().toISOString() };
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('buildings.0.padOffset', 9, { live: false });
      await wait(1300);
      return eq([ProjectUI.status().readOnly, stored(doc.id).sections.grading.schema], [true, 99]);
    });
    await t('a tower project with no levels shows the Tower note and the tower-no-levels warning', () => {
      const doc = ProjectFixture.project({ tool: 'tower', footprintOn: false, site: false, name: 'Tower' });
      ProjectMod.saveProject(mem, doc);
      fresh();
      ProjectUI.openDoc(doc);
      UI.setTab('buildings'); UI.updateHud(Derived.get());
      const w = Derived.get().warnings.find((x) => x.id === 'tower-no-levels');
      return eq([!!w, /The Tower Generator does not write massing levels yet/.test($('sourceNote').textContent), /does not write massing levels yet/.test($('warnList').textContent)], [true, true, true]);
    });
    await t('a project with a parking deck adds a parking building, ids parking-T1, from the lowest plate', () => {
      const doc = ProjectFixture.project({ tool: null, site: false, parking: true, name: 'Deck' });
      ProjectMod.saveProject(mem, doc);
      fresh();
      ProjectUI.openDoc(doc);
      const d = Derived.get(), b = Store.get('buildings');
      return eq([b.length, b[0].source, d.built.tiers[0] && d.built.tiers[0].id, d.built.buildings[0] && box(d.built.buildings[0].rings)], [1, 'parking', 'parking-T1', [300, 0, 400, 60]]);
    });
    await t('Close project goes back to the standalone design: the project buildings go and the plane is the ground', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.close();
      return eq([ProjectUI.has(), Store.get('source'), Store.get('ground.mode'), Store.get('buildings')[0].source, !!stored(id)], [false, 'standalone', 'plane', 'typed', true]);
    });
    await t('the Project menu lists New, Import, Export and Close', () => {
      ProjectUI.openDoc(ProjectFixture.project({ name: 'Menu' }));
      $('btnProject').click();
      const keys = [...document.querySelectorAll('#projectMenu [data-proj]')].map((b) => b.dataset.proj);
      Pop.close();
      ProjectUI.close();
      return eq([keys[0], keys.includes('import'), keys.includes('export'), keys.includes('close')], ['new', true, true, true]);
    });
  } finally {
    ProjectUI.close();
    ProjectUI.restoreDefaults();
    ProjectUI.reset();
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('project', results);
  return results;
}
async function runAllTests() {
  const base = await runTests();
  const ui = await runUiTests();
  const select = await runSelectTests();
  const project = await runProjectTests();
  const all = [...base, ...ui, ...select, ...project];
  const failed = all.filter((r) => !r.ok);
  TestHelp.merged('all', all);
  window.__gradingTestResults = { total: all.length, passed: all.length - failed.length, failed, results: all };
  return window.__gradingTestResults;
}
