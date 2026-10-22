/* ==========================================================================
   TESTS: the project file
   Open a project whose massing is a hand-built courtyard (O) of 250 by 220 ft (a podium level and five bar levels, the shape of plan
   section 8.7), read its levels (plan section 7), write the facade section (1 s debounce, visibilitychange, pagehide), keep every
   other section, a newer schema, close. A tower project with no levels shows the plan's note and the warning tower-no-levels.
   A fixture project lives in an in-memory storage, so a ?test visit never touches the saved projects.
   runAllTests (below) runs every test file and merges the results.
   ========================================================================== */
const ProjectFixture = (() => {
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  /** A courtyard massing, centered on the origin: a solid 250 x 220 podium level (11 ft) and five bar levels (10 ft) with a 120 x 90 court. */
  function courtyardLevels() {
    const levels = [{ index: 1, zone: 'podium', z: 0, ftf: 11, plates: [{ outer: rect(-125, -110, 125, 110), holes: [] }] }];
    for (let i = 0; i < 5; i++) levels.push({ index: 2 + i, zone: 'bar', z: 11 + i * 10, ftf: 10, plates: [{ outer: rect(-125, -110, 125, 110), holes: [[[-60, -45], [-60, 45], [60, 45], [60, -45]]] }] });
    return levels;
  }
  const massing = (tool, levels, rotation = 0) => ({ tool, schema: 1, placement: { x: 40, y: 60, rotation, baseZ: 0 }, state: {}, derived: levels ? { levels, metrics: { units: 120 } } : {} });
  function project({ tool = 'midrise', levels = courtyardLevels(), rotation = 0, name = 'Fixture' } = {}) {
    let doc = ProjectMod.newProject({ name });
    doc = ProjectMod.writeSection(doc, 'massing', massing(tool, levels, rotation));
    doc = ProjectMod.writeSection(doc, 'plates', { tool: 'plate', schema: 1, placement: { x: 1, y: 2, rotation: 0, baseZ: 3 }, state: { keep: 'me' }, derived: { levels: [] } });
    return doc;
  }
  return { memory, courtyardLevels, project };
})();

async function runProjectTests() {
  const { eq, near, make, $, wait, snap, oneStep, presetState } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const mem = ProjectFixture.memory();
  const urls = [], navs = [];
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: (u) => navs.push(u), updateUrl: (id) => urls.push(id) });
  const stored = (id) => ProjectMod.loadProject(mem, id);
  const open = (opts, name) => { const doc = ProjectFixture.project({ ...opts, name }); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };
  const fresh = () => { Store.replace(fillDefaults(defaultState())); };
  const courtState = () => { const s = presetState('courtyard-multifamily-projected-balconies'); s.source = 'project'; return s; };

  try {
    fresh();
    await t('no project: the standalone massing is the default and the project line is empty', () => eq([ProjectUI.has(), Store.get('source'), ProjectUI.massingInfo().has], [false, 'standalone', false]));
    await t('ProjectUI.send goes to the Grading Sketch only', async () => eq([typeof ProjectUI.send, await ProjectUI.send('nowhere')], ['function', false]));

    await t('opening a project with a massing makes the source "project" and takes its placement', () => {
      open();
      return eq([ProjectUI.has(), Store.get('source'), Store.get('placement'), ProjectUI.massingInfo().levels], [true, 'project', { x: 40, y: 60, rotation: 0, baseZ: 0 }, 6]);
    });
    await t('the project massing builds the courtyard: 8 faces per bar level, a solid podium', () => {
      const d = Derived.get();
      return eq([d.built.source, d.levels.length, d.groups.filter((g) => g.zone === 'middle').length >= 8], ['project', 6, true]);
    });
    await t('the project faces match preset 8.7: WWR 22.9 percent, 184 balconies, 78,340 sf of wall', () => {
      Store.replace(fillDefaults(courtState()));
      const h = Derived.get().hud;
      return eq([Math.round(h.wwr * 1000) / 10, h.balconies, Math.round(h.wall), Math.round(h.glazing)], [22.9, 184, 78340, 17940]);
    });
    await t('the project massing and the standalone O give the same face groups and lengths', () => {
      const proj = Derived.get().groups.map((g) => `${g.zone}:${g.orientation}:${Math.round(g.length)}`).sort();
      const sa = fillDefaults(courtState()); sa.source = 'standalone';
      const alone = computeDerived(sa).groups.map((g) => `${g.zone}:${g.orientation}:${Math.round(g.length)}`).sort();
      return eq(proj, alone);
    });
    await t('the Massing tab says where the massing comes from', () => {
      UI.setTab('massing'); UI.updateHud(Derived.get());
      return eq([/Project massing: 6 levels/.test($('sourceNote').textContent), $('sourceChips').querySelector('[aria-pressed="true"]').dataset.source], [true, 'project']);
    });
    await t('the project line names the project and its levels', () => eq(/Project “Fixture”.*6 levels/.test($('projLine').textContent), true));
    await t('the facade section is written after 1 s, with the state, the derived faces and every other section kept', async () => {
      const doc = ProjectUI.doc();
      Store.set('balconies.spacing', 3, { live: false });
      await wait(1400);
      const back = stored(doc.id), sec = back && back.sections.facade;
      return eq([!!sec, sec && sec.tool, sec && sec.schema, sec && sec.state.balconies.spacing, sec && sec.derived.faces.length > 0, !!back.sections.massing, back.sections.plates.state], [true, 'facade', 1, 3, true, true, { keep: 'me' }]);
    });
    await t('the derived faces carry edge, bearing, zone and street, and the metrics the plan adds', () => {
      const sec = stored(ProjectUI.doc().id).sections.facade.derived, f = sec.faces[0], m = sec.metrics;
      return eq([Array.isArray(f.edge) && f.edge.length === 2, typeof f.bearing, typeof f.zone, typeof f.street, ['facadeArea', 'glazingArea', 'balconyCount', 'balconyArea', 'wwrLimit'].every((k) => typeof m[k] === 'number')], [true, 'number', 'string', 'boolean', true]);
    });
    await t('the saved project validates', () => eq(ProjectMod.validate(stored(ProjectUI.doc().id)).ok !== false, true));
    await t('visibilitychange (hidden) and pagehide flush a pending change at once', () => {
      Store.set('balconies.spacing', 2, { live: false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.visibilityState;
      const a = stored(ProjectUI.doc().id).sections.facade.state.balconies.spacing;
      Store.set('balconies.spacing', 4, { live: false });
      window.dispatchEvent(new Event('pagehide'));
      const b = stored(ProjectUI.doc().id).sections.facade.state.balconies.spacing;
      return eq([a, b], [2, 4]);
    });
    await t('a project saved by a newer tool is read only: opened, not written', async () => {
      const doc = ProjectFixture.project({ name: 'Newer' });
      doc.sections.facade = { tool: 'facade', schema: 99, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { faces: [], metrics: {} }, updatedAt: new Date().toISOString() };
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('balconies.spacing', 5, { live: false });
      await wait(1300);
      const st = ProjectUI.status();
      return eq([st.readOnly, stored(doc.id).sections.facade.schema], [true, 99]);
    });
    await t('a tower project with no levels shows the note and the tower-no-levels warning', () => {
      const doc = ProjectFixture.project({ tool: 'tower', levels: null, name: 'Tower' });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      UI.setTab('massing'); UI.updateHud(Derived.get());
      const w = Derived.get().warnings.find((x) => x.id === 'tower-no-levels');
      const note = $('sourceNote').textContent;
      const hud = $('warnList').textContent;
      return eq([!!w, /The Tower Generator does not write massing levels yet\. Use the standalone massing\./.test(note), /does not write massing levels yet/.test(hud), Derived.get().built.source], [true, true, true, 'standalone']);
    });
    await t('a rotated project massing turns the faces: a south face of the standalone bar becomes a west face at 90 degrees', () => {
      const doc = ProjectFixture.project({ levels: (() => { const lv = []; for (let i = 0; i < 3; i++) lv.push({ index: i + 1, zone: 'bar', z: i * 10, ftf: 10, plates: [{ outer: [[-150, -32.5], [150, -32.5], [150, 32.5], [-150, 32.5]], holes: [] }] }); return lv; })(), rotation: 90, name: 'Rot' });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const o = [...new Set(Derived.get().groups.filter((g) => g.length > 200).map((g) => g.orientation))].sort();
      return eq(o, ['E', 'W']);
    });
    await t('Close project goes back to the standalone massing and keeps the saved copy', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.close();
      return eq([ProjectUI.has(), Store.get('source'), !!stored(id)], [false, 'standalone', true]);
    });
    await t('the Project menu lists New, the saved projects, Import, Export and Close', () => {
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

/** Every test file, merged. This is what ?test and __facade.runTests run. */
async function runAllTests() {
  const base = await runTests();
  const ui = await runUiTests();
  const select = await runSelectTests();
  const project = await runProjectTests();
  const all = [...base, ...ui, ...select, ...project];
  const failed = all.filter((r) => !r.ok);
  TestHelp.merged('all', all);
  window.__facadeTestResults = { total: all.length, passed: all.length - failed.length, failed, results: all };
  return window.__facadeTestResults;
}
