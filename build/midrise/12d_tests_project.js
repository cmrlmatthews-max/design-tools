/* ==========================================================================
   TESTS: project file
   Open a project with a site, place the building on it, load the neighbors, write the massing section (1 s debounce),
   keep every other section, the Tower Generator massing question, a newer schema, Send to, import, close.
   A fixture project lives in an in-memory storage, so a ?test visit never touches the saved projects.
   runAllTests (below) runs every test file and merges the results.
   ========================================================================== */
const ProjectFixture = (() => {
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  const S = 1000, N = 11, SPACING = 100;
  /** A 1000 ft site square with a sloping ground (z = 1000 + 0.01 x + 0.02 y), a near building and a far one. */
  function siteProject({ withMassing = null, withPlates = false } = {}) {
    let doc = ProjectMod.newProject({ name: 'Fixture', frame: { kind: 'site', lat: 33.927, lon: -84.339, size: S } });
    const points = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) points.push([i * SPACING, j * SPACING, 1000 + 0.01 * i * SPACING + 0.02 * j * SPACING]);
    const derived = {
      address: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test',
      boundary: [[0, 0], [S, 0], [S, S], [0, S]], ground: { spacing: SPACING, n: N, points },
      buildings: [
        { id: 'near', outer: [[480, 380], [560, 380], [560, 420], [480, 420]], holes: [], base: 1010, height: 40, top: 1050, floors: 3, rule: 'data', name: 'Near' },
        { id: 'far', outer: [[950, 950], [990, 950], [990, 990], [950, 990]], holes: [], base: 1030, height: 30, top: 1060, floors: 2, rule: 'data', name: 'Far' },
      ],
      roads: { segments: [], pavement: [] }, walks: null, trees: [], water: { areas: [], lines: [] },
    };
    doc = ProjectMod.writeSection(doc, 'site', { tool: 'site', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { query: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test', walks: false }, derived });
    if (withMassing) doc = ProjectMod.writeSection(doc, 'massing', withMassing);
    if (withPlates) doc = ProjectMod.writeSection(doc, 'plates', { tool: 'plate', schema: 1, placement: { x: 1, y: 2, rotation: 0, baseZ: 3 }, state: { keep: 'me' }, derived: { levels: [] } });
    return doc;
  }
  return { memory, siteProject, S };
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
  const modal = () => document.querySelector('.modal-back');
  const answer = (yes) => { const m = modal(); if (!m) return false; const btns = m.querySelectorAll('.btn'); (yes ? btns[1] : btns[0]).click(); return true; };
  const fresh = () => { Store.replace(fillDefaults(defaultState())); };

  try {
    await t('the fixture project is valid and carries a site', () => {
      const doc = ProjectFixture.siteProject();
      const v = ProjectMod.validate(doc);
      return (v.ok && !!ProjectMod.getSection(doc, 'site')) || v.errors.join('; ');
    });

    /* ---- opening a project with a site and no massing ---- */
    await t('opening a site project with no massing centers the building on the site, at the ground there, with the neighbors from the site', () => {
      fresh();
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const p = Store.get('placement'), ctx = Store.get('context');
      return eq([p.x, p.y, p.rotation, Math.round(p.baseZ), ctx.fromSite, ctx.blocks.length, ProjectUI.has(), ProjectUI.hasSite()], [500, 500, 0, 1015, true, 1, true, true]);
    });
    await t('the project name shows next to the Project button', () => {
      const pill = $('projPill');
      return eq([pill.hidden, pill.textContent], [false, 'Fixture']);
    });
    await t('the site boundary is given in the building frame (centered on the building)', () => {
      const ring = ProjectUI.boundaryLocal();
      return eq(ring, [[-500, -500], [500, -500], [500, 500], [-500, 500]]);
    });
    await t('the Site tab shows placement, Center on site and Context from site while a project is open', () => {
      UI.setTab('site');
      const labels = [...document.querySelectorAll('#tabpanel-site .btn')].map((b) => b.textContent);
      const fields = [...document.querySelectorAll('#tabpanel-site .ctl-label')].map((l) => l.textContent).join('|');
      return (labels.includes('Center on site') && labels.includes('Context from site') && /X \(east\)/.test(fields) && /Rotation/.test(fields) && /Base elevation/.test(fields)) || `buttons ${labels}`;
    });

    /* ---- context ---- */
    await t('Context from site: the radius picks the neighbors (100 ft: the near one; 2000 ft: both); blocks are in the building frame', () => {
      const a = ProjectUI.contextFromSite(100, { quiet: true });
      const near1 = Store.get('context.blocks');
      const b = ProjectUI.contextFromSite(2000, { quiet: true });
      const both = Store.get('context.blocks');
      const first = both.find((x) => Math.abs(x.w - 80) < 0.1);
      return eq([a, near1[0].x, near1[0].y, near1[0].h, b, first && first.base, Store.get('context.radius'), Store.get('context.fromSite')], [1, 20, -100, 40, 2, -5, 2000, true]);
    });
    await t('Context from site is one undo step', () => {
      const before = snap();
      ProjectUI.contextFromSite(150, { quiet: true });
      return oneStep(before);
    });
    await t('moving the building while the context comes from the site loads the neighbors again', () => {
      ProjectUI.contextFromSite(100, { quiet: true });
      const n0 = Store.get('context.blocks').length;
      Store.set('placement.x', 900, { live: false });
      Store.set('placement.y', 900, { live: false });
      const n1 = Store.get('context.blocks').length;
      const far = Store.get('context.blocks')[0];
      Store.set('placement', { x: 500, y: 500, rotation: 0, baseZ: 1015 }, { live: false });
      return eq([n0, n1, far && Math.round(far.x)], [1, 1, 70]);
    });
    await t('Center on site puts the building at the site center and the ground height (one undo step)', () => {
      Store.set('placement', { x: 10, y: 20, rotation: 0, baseZ: 0 }, { live: false });
      const before = snap();
      const ok = ProjectUI.centerOnSite({ quiet: true });
      const p = Store.get('placement');
      return eq([ok, p.x, p.y, Math.round(p.baseZ), oneStep(before)], [true, 500, 500, 1015, true]);
    });
    await t('the ground height is read from the site grid (bilinear)', () => eq([Math.round(ProjectUI.groundAt(250, 130) * 100) / 100, Math.round(ProjectUI.groundAt(0, 0))], [1005.1, 1000]));

    /* ---- writing the project ---- */
    await t('flush writes the massing section: tool midrise, schema 1, placement, state, and a derived that validates', () => {
      Store.set('bars.0.floors', 4, { live: false });
      const res = ProjectUI.flush();
      const doc = stored(ProjectUI.doc().id);
      const sec = ProjectMod.getSection(doc, 'massing');
      const v = ProjectMod.validate(doc);
      return (res.ok !== false && v.ok && sec && sec.tool === 'midrise' && sec.schema === 1 && sec.state.bars[0].floors === 4 && sec.placement.x === 500 && sec.derived.metrics.floors === 4 && sec.derived.levels.length === 4)
        || `res ${JSON.stringify(res)} valid ${v.ok} ${v.errors} sec ${sec && JSON.stringify({ tool: sec.tool, floors: sec.state.bars[0].floors, levels: sec.derived.levels.length })}`;
    });
    await t('the project saves by itself about a second after a change (not before)', async () => {
      Store.set('bars.0.floors', 3, { live: false });
      await wait(300);
      const early = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.bars[0].floors;
      await wait(1100);
      const late = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.bars[0].floors;
      return eq([early, late, ProjectUI.status().dirty], [4, 3, false]);
    });
    await t('a live drag does not save until it is committed', async () => {
      Store.set('bars.0.length', 280, { live: true });
      await wait(1200);
      const mid = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.bars[0].length;
      Store.commit();
      await wait(1200);
      const end = ProjectMod.getSection(stored(ProjectUI.doc().id), 'massing').state.bars[0].length;
      return eq([mid, end], [300, 280]);
    });
    await t('writing keeps every other section and every unknown key (a round trip through the page)', () => {
      const doc = ProjectFixture.siteProject({ withPlates: true });
      doc.extra = { keep: 1 };
      ProjectMod.saveProject(mem, doc);
      const siteBefore = JSON.stringify(ProjectMod.getSection(doc, 'site')), platesBefore = JSON.stringify(ProjectMod.getSection(doc, 'plates'));
      ProjectUI.openDoc(doc);
      Store.set('bars.0.floors', 2, { live: false });
      ProjectUI.flush();
      const back = stored(doc.id);
      return eq([JSON.stringify(ProjectMod.getSection(back, 'site')) === siteBefore, JSON.stringify(ProjectMod.getSection(back, 'plates')) === platesBefore, back.extra, ProjectMod.getSection(back, 'massing').tool, back.log.at(-1).tool], [true, true, { keep: 1 }, 'midrise', 'midrise']);
    });
    await t('a save loads the project fresh: a section another tab saved in the meantime is kept', () => {
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const other = ProjectMod.writeSection(stored(doc.id), 'parking', { tool: 'parking', schema: 1, state: { other: true }, derived: { levels: [] } });
      ProjectMod.saveProject(mem, other);
      Store.set('bars.0.floors', 3, { live: false });
      ProjectUI.flush();
      const back = stored(doc.id);
      return eq([!!ProjectMod.getSection(back, 'parking'), ProjectMod.getSection(back, 'massing').state.bars[0].floors], [true, 3]);
    });
    await t('rename changes the project name in the file and the pill', () => {
      ProjectUI.rename('Fixture renamed');
      ProjectUI.flush();
      return eq([stored(ProjectUI.doc().id).name, $('projPill').textContent], ['Fixture renamed', 'Fixture renamed']);
    });

    /* ---- loading a saved massing ---- */
    await t('opening a project whose massing was written by the Mid-Rise Generator loads that design and placement', () => {
      fresh();
      const st = fillDefaults(CONFIG.presets.find((p) => p.id === 'wrap-deck').state);
      const d = computeDerived(st);
      const doc = ProjectFixture.siteProject({ withMassing: { tool: 'midrise', schema: 1, placement: { x: 300, y: 400, rotation: 15, baseZ: 1020 }, state: st, derived: MidDerivedMod.midriseDerived(st, d.built, d.metrics) } });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      return eq([Store.get('bars').length, Store.get('deck.on'), Store.get('placement'), ProjectUI.status().replaceNeeded], [4, true, { x: 300, y: 400, rotation: 15, baseZ: 1020 }, false]);
    });

    /* ---- the Tower Generator massing ---- */
    await t('a Tower Generator massing is kept until you confirm; confirming replaces it', async () => {
      fresh();
      const doc = ProjectFixture.siteProject({ withMassing: { tool: 'tower', schema: 1, placement: { x: 500, y: 500, rotation: 0, baseZ: 1015 }, state: { tower: true }, derived: { levels: [] } } });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      const flagged = ProjectUI.status().replaceNeeded;
      Store.set('bars.0.floors', 3, { live: false });
      ProjectUI.flush();
      const asked = !!modal();
      const untouched = ProjectMod.getSection(stored(doc.id), 'massing').tool;
      answer(true);
      await wait(50);
      const replaced = ProjectMod.getSection(stored(doc.id), 'massing').tool;
      return eq([flagged, asked, untouched, replaced], [true, true, 'tower', 'midrise']);
    });
    await t('declining the question keeps the tower massing and stops saving to the project', async () => {
      fresh();
      const doc = ProjectFixture.siteProject({ withMassing: { tool: 'tower', schema: 1, placement: { x: 500, y: 500, rotation: 0, baseZ: 1015 }, state: { tower: true }, derived: { levels: [] } } });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      Store.set('bars.0.floors', 3, { live: false });
      ProjectUI.flush();
      answer(false);
      await wait(50);
      Store.set('bars.0.floors', 2, { live: false });
      ProjectUI.flush();
      return eq([ProjectMod.getSection(stored(doc.id), 'massing').tool, ProjectUI.status().readOnly], ['tower', true]);
    });
    await t('a massing section with a newer schema opens read-only and is never written', () => {
      fresh();
      const doc = ProjectFixture.siteProject();
      const newer = JSON.parse(JSON.stringify(doc));
      newer.sections.massing = { tool: 'midrise', schema: 9, updatedAt: new Date().toISOString(), placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { from: 'future' }, derived: {} };
      mem.setItem(`cmrlm.project.${newer.id}`, JSON.stringify(newer));
      ProjectUI.openDoc(newer);
      Store.set('bars.0.floors', 3, { live: false });
      const res = ProjectUI.flush();
      return eq([ProjectUI.status().readOnly, JSON.parse(mem.getItem(`cmrlm.project.${newer.id}`)).sections.massing.schema, res.skipped === true], [true, 9, true]);
    });

    /* ---- new, send, import, close ---- */
    await t('New project (no site) holds the design with a zero placement and a local frame', () => {
      ProjectUI.close();
      fresh();
      const doc = ProjectUI.create('Local one', { quiet: true });
      const back = stored(doc.id);
      return eq([back.frame.kind, back.name, ProjectMod.getSection(back, 'massing').tool, Store.get('placement'), urls.at(-1) === doc.id], ['local', 'Local one', 'midrise', { x: 0, y: 0, rotation: 0, baseZ: 0 }, true]);
    });
    await t('Send to Plate Planner saves the project, logs the send, and opens ../plate/?project=<id>', async () => {
      navs.length = 0;
      const id = ProjectUI.doc().id;
      const url = await ProjectUI.send('plate');
      const back = stored(id);
      return eq([url, navs, back.log.at(-1).action, back.log.at(-1).note], [`../plate/?project=${encodeURIComponent(id)}`, [`../plate/?project=${encodeURIComponent(id)}`], 'send', 'midrise → plate']);
    });
    await t('Send to Parking Deck opens ../parking/?project=<id>; with no project open one is made first', async () => {
      ProjectUI.close();
      fresh();
      navs.length = 0;
      const url = await ProjectUI.send('parking');
      const id = ProjectUI.doc() && ProjectUI.doc().id;
      return eq([!!id, url === `../parking/?project=${encodeURIComponent(id)}`, navs.length, ProjectMod.getSection(stored(id), 'massing').tool], [true, true, 1, 'midrise']);
    });
    await t('Import opens the imported project (a taken id becomes a copy named "(2)")', async () => {
      const doc = ProjectFixture.siteProject();
      ProjectMod.saveProject(mem, doc);
      const file = new Blob([JSON.stringify(doc)], { type: 'application/json' });
      const got = await ProjectUI.importFile(file);
      return eq([!!got, got && got.name, got && got.id !== doc.id, ProjectUI.doc().id === got.id, urls.at(-1) === got.id], [true, 'Fixture (2)', true, true, true]);
    });
    await t('Export names the file from the project name (the Export item is enabled with a project)', () => {
      const e = ProjectMod.exportProject(ProjectUI.doc());
      document.getElementById('btnProject').click();
      const exp = document.querySelector('#projectMenu [data-proj="export"]');
      const enabled = exp && !exp.disabled;
      Pop.close();
      return eq([e.filename, enabled], ['fixture-2.cmrlm.json', true]);
    });
    await t('Close project forgets the project and clears the placement; the saved copy stays', () => {
      const id = ProjectUI.doc().id;
      ProjectUI.close();
      return eq([ProjectUI.has(), Store.get('placement'), Store.get('context.fromSite'), !!stored(id), $('projPill').hidden], [false, null, false, true, true]);
    });
    await t('the Project menu lists the saved projects to open', () => {
      document.getElementById('btnProject').click();
      const opens = [...document.querySelectorAll('#projectMenu [data-proj="open"]')].length;
      Pop.close();
      return opens > 0 || 'no saved projects listed';
    });
  } finally {
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    Select.clear();
    Store.replace(savedState);
    UI.setTab(savedTab);
  }
  TestHelp.merged('project', results);
  return results;
}

/** Every test file, merged. This is what ?test and __midrise.runTests run. */
async function runAllTests() {
  const base = await runTests();
  const ui = await runUiTests();
  const select = await runSelectTests();
  const project = await runProjectTests();
  const nosite = await runNoSiteTests();        // 12e_tests_nosite.js
  const all = [...base, ...ui, ...select, ...project, ...nosite];
  const failed = all.filter((r) => !r.ok);
  window.__midriseTestResults = { total: all.length, passed: all.length - failed.length, failed, results: all };
  return window.__midriseTestResults;
}
