/* ==========================================================================
   TESTS: the project file  (plan sections 7 and 9.2)
   A hand-built Mid-Rise massing: two bars, five levels with the same plate, placed at x 40, y 60. Open it, fill it (one group of five
   floors), write the plates section (1 s debounce, visibilitychange, pagehide), keep every other section, a newer massing shows the stale
   notice, a newer schema is read only, and the Send item opens ../parking/?project=<id>.
   The fixture lives in an in-memory storage, so a ?test visit never touches the saved projects.
   runAllTests (below) runs every test file and merges the results.
   ========================================================================== */
const ProjectFixture = (() => {
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  /** Two bars in the massing frame, 200 x 60 each, 30 ft apart. */
  const plate = () => [{ outer: rect(-100, -75, 100, -15), holes: [] }, { outer: rect(-100, 15, 100, 75), holes: [] }];
  const level = (index) => ({ index, name: `Level ${index}`, zone: 'bar', z: (index - 1) * 10, ftf: 10, program: 'residential', plates: plate(), core: null, spines: [], seeds: [] });
  const massing = (updatedAt) => ({ tool: 'midrise', schema: 1, placement: { x: 40, y: 60, rotation: 0, baseZ: 0 }, state: {}, derived: { levels: [1, 2, 3, 4, 5].map(level) }, ...(updatedAt ? { updatedAt } : {}) });
  function project({ name = 'Fixture', withMassing = true } = {}) {
    let doc = ProjectMod.newProject({ name });
    if (withMassing) doc = ProjectMod.writeSection(doc, 'massing', massing());
    return doc;
  }
  return { memory, project, massing, plate };
})();

async function runProjectTests() {
  const { eq, near, make, $, wait } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const mem = ProjectFixture.memory();
  let went = [];
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: (url) => { went.push(url); }, updateUrl: () => {} });
  const stored = (id) => ProjectMod.loadProject(mem, id);
  const open = (opts) => { const doc = ProjectFixture.project(opts); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };
  const fresh = () => { Store.replace(TestHelp.presetState('double-loaded-bar')); };

  try {
    fresh();
    await t('no project: the drawn plate is the source and the project line is empty', () => eq([ProjectUI.has(), Store.get('source'), Derived.get().hud.units], [false, 'drawn', 17]));
    let doc0 = null;
    await t('opening a project with a massing makes the source "project": one group of five floors, labeled by its levels', () => {
      doc0 = open();
      const d = Derived.get();
      return eq([ProjectUI.has(), Store.get('source'), d.ok, d.groups.length, d.groups[0] && d.groups[0].floors, d.groups[0] && /^Levels 1.5 \(5 floors\)$/.test(d.groups[0].label)], [true, 'project', true, 1, 5, true]);
    });
    await t('the placement of the massing is copied into the plan (x 40, y 60); the group starts blank with open stretches on both bars (changed: no auto-fill)', () => {
      const d = Derived.get();
      const info = Render.ready() ? Select.layoutInfo() : null;
      return eq([d.built.placement, d.editing.units.length, info ? info.free.length >= 2 : true, d.hud.open > 1000, d.hud.building.floors], [{ x: 40, y: 60, rotation: 0, baseZ: 0 }, 0, true, true, 5]);
    });
    await t('the Plate tab names the project and the source chips say "project"', () => {
      UI.setTab('plate'); UI.updateHud(Derived.get());
      const on = $('sourceChips').querySelector('[aria-pressed="true"]');
      return eq([/Fixture/.test($('projLine').textContent), on && on.dataset.value], [true, 'project']);
    });
    await t('the plates section is written after 1 s: state, derived, the massing placement; the massing section is kept', async () => {
      const doc = ProjectUI.doc();
      Store.set('mix.cornerType', '1br', { live: false });
      await wait(1500);
      const back = stored(doc.id), sec = back && back.sections.plates, m = back && back.sections.massing;
      return eq([!!sec, sec && sec.tool, sec && sec.placement, !!(sec && sec.derived && sec.derived.levels), !!m, m && m.placement], [true, 'plate', { x: 40, y: 60, rotation: 0, baseZ: 0 }, true, true, { x: 40, y: 60, rotation: 0, baseZ: 0 }]);
    });
    await t('the written section has one record per level (five) and validates', () => {
      const back = stored(ProjectUI.doc().id), sec = back.sections.plates;
      return eq([sec.derived.levels.length, ProjectMod.validate(back).ok !== false], [5, true]);
    });
    await t('visibilitychange (hidden) and pagehide flush a pending change at once', () => {
      Store.set('extWall', 1.25, { live: false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.visibilityState;
      const a = stored(ProjectUI.doc().id).sections.plates.state.extWall;
      Store.set('extWall', 1.0, { live: false });
      window.dispatchEvent(new Event('pagehide'));
      const b = stored(ProjectUI.doc().id).sections.plates.state.extWall;
      return eq([a, b], [1.25, 1]);
    });
    await t('reopening the project loads the saved plates state', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.flush();
      fresh();
      ProjectUI.openDoc(stored(id));
      return eq([Store.get('source'), Store.get('mix.cornerType')], ['project', '1br']);
    });
    await t('a newer massing updatedAt shows no stale notice and no Re-fill button (changed: nothing re-fills in draw-first)', async () => {
      const id = ProjectUI.doc().id;
      ProjectUI.flush();
      await wait(30);
      let back = stored(id);
      back = ProjectMod.writeSection(back, 'massing', ProjectFixture.massing());
      ProjectMod.saveProject(mem, back);
      fresh();
      ProjectUI.openDoc(stored(id));
      UI.updateHud(Derived.get());
      return eq([Derived.get().stale, !!$('staleNote'), !!$('staleRefill'), Derived.get().warnings.some((w) => w.id === 'stale-massing')], [false, false, false, false]);
    });
    await t('Send to Parking Deck saves the project and opens ../parking/ with ?project=<id>; the menu has no Facade Studio item', async () => {
      const id = ProjectUI.doc().id;
      went = [];
      $('btnExport').click();
      const p = $('miSendParking'); if (p) p.click();
      $('btnExport').click();
      const noFacade = !$('miSendFacade') && !/facade/i.test(document.querySelector('#exportMenu').textContent);
      await wait(50);
      Pop.close();
      return eq([went, !!p, noFacade, !!stored(id).sections.plates], [[`../parking/?project=${id}`], true, true, true]);
    });
    await t('a project saved by a newer tool is read only: opened, not written', async () => {
      let doc = ProjectFixture.project({ name: 'Newer' });
      doc.sections.plates = { tool: 'plate', schema: 99, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: {}, updatedAt: new Date().toISOString() };
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('extWall', 1.5, { live: false });
      await wait(1300);
      return eq([ProjectUI.status().readOnly, stored(doc.id).sections.plates.schema], [true, 99]);
    });
    await t('a Tower massing (90 ft square plates, a 40 ft core, no spines) opens with a point corridor and a blank layout with open area on every level (changed: no auto-fill)', () => {
      const sq = (h) => [[-h, -h], [h, -h], [h, h], [-h, h]];
      const lv = (index, h) => ({ index, name: `Level ${index}`, zone: 'tower', z: (index - 1) * 11, ftf: 11, program: 'residential', plates: [{ outer: sq(h), holes: [] }], core: sq(20.125), spines: [], seeds: [] });
      let doc = ProjectMod.newProject({ name: 'Tower fixture' });
      doc = ProjectMod.writeSection(doc, 'massing', { tool: 'tower', schema: 2, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { levels: [lv(3, 45), lv(4, 45), lv(5, 44)] } });
      ProjectMod.saveProject(mem, doc);
      fresh();
      ProjectUI.openDoc(doc);
      const d = Derived.get();
      const fills = d.built.groups.map((g) => g.fill);
      return eq([Store.get('corridor.kind'), d.groups.length, fills.every((f) => f && f.kind === 'point' && f.layout === true && f.units.length === 0 && f.openArea > 1000), d.hud.building.floors], ['auto', 2, true, 3]);
    });
    await t('a hotel tower (117 by 93 ft plates, a 52 by 42 ft core) opens in hotel mode with an open layout; the mode notice stays quiet (changed: no keys until drawn)', () => {
      const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
      const lv = (index) => ({ index, name: `Level ${index}`, zone: 'tower', z: (index - 1) * 15, ftf: 15, program: 'hotel', plates: [{ outer: rect(117, 93), holes: [] }], core: rect(52, 42), spines: [], seeds: [] });
      let doc = ProjectMod.newProject({ name: 'Hotel tower' });
      doc = ProjectMod.writeSection(doc, 'massing', { tool: 'tower', schema: 2, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { levels: [lv(2), lv(3), lv(4)] } });
      ProjectMod.saveProject(mem, doc);
      fresh();
      ProjectUI.openDoc(doc);
      const d = Derived.get();
      return eq([ProjectUI.massingMode(), Store.get('mode'), d.hud.open > 1000], ['hotel', 'hotel', true]);
    });
    await t('a project with no massing keeps the drawn plate', () => {
      const doc = ProjectFixture.project({ name: 'Empty', withMassing: false });
      ProjectMod.saveProject(mem, doc);
      fresh();
      ProjectUI.openDoc(doc);
      return eq([Store.get('source'), Derived.get().hud.units], ['drawn', 17]);
    });
    await t('Close project goes back to the drawn plate and the saved copy stays', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.close();
      return eq([ProjectUI.has(), Store.get('source'), !!stored(id)], [false, 'drawn', true]);
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
  window.__plateTestResults = { total: all.length, passed: all.length - failed.length, failed, results: all };
  return window.__plateTestResults;
}
