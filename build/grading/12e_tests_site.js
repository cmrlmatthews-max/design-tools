/* ==========================================================================
   TESTS: the project site layer  (docs/site-layer-technical-plan.md section 9.2, tests 1 to 6)
   A project with a 1,000 ft site (a sloping 11 x 11 ground, two buildings, a road, a walk, a pond and three trees) and a deck massing
   placed on it. The layer draws the whole site: the ground, the neighbors, the pavement, the water and the trees. View > Site switches
   it, Compare and the AI-ready image hide it, a theme change rebuilds it. A fixture project lives in an in-memory storage, so a ?test
   visit never touches the saved projects. runAllTests below picks these tests up after the others.
   ========================================================================== */
const SiteFixture = (() => {
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  const S = 1000, N = 11, SPACING = 100;
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  /** The massing placement on the site: its ground floor at the ground there (1000 + 0.01 x + 0.02 y = 1008 at x 300, y 250). */
  const PLACEMENT = { x: 300, y: 250, rotation: 0, baseZ: 1008 };
  /** A 1000 ft site square with a sloping ground (z = 1000 + 0.01 x + 0.02 y), a near and a far building, a road, a walk, a pond and trees. */
  function siteProject({ massing = null } = {}) {
    let doc = ProjectMod.newProject({ name: 'Site fixture', frame: { kind: 'site', lat: 33.927, lon: -84.339, size: S } });
    const points = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) points.push([i * SPACING, j * SPACING, 1000 + 0.01 * i * SPACING + 0.02 * j * SPACING]);
    const derived = {
      address: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test',
      boundary: rect(0, 0, S, S), ground: { spacing: SPACING, n: N, points },
      buildings: [
        { id: 'near', outer: rect(480, 380, 560, 420), holes: [], base: 1010, height: 40, top: 1050, floors: 3, rule: 'data', name: 'Near' },
        { id: 'far', outer: rect(950, 950, 990, 990), holes: [], base: 1030, height: 30, top: 1060, floors: 2, rule: 'data', name: 'Far' },
      ],
      roads: { segments: [], pavement: [{ outer: rect(0, 560, S, 600), holes: [] }] },
      walks: [{ outer: rect(0, 610, S, 618), holes: [] }],
      trees: [{ x: 620, y: 300, z: 1010, canopy: 22, height: 34 }, { x: 660, y: 330, z: 1011, canopy: 18, height: 30 }, { x: 700, y: 280, z: 1010, canopy: 20, height: 32 }],
      water: { areas: [{ outer: rect(760, 120, 860, 200), holes: [], level: 1010 }], lines: [] },
    };
    doc = ProjectMod.writeSection(doc, 'site', { tool: 'site', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { query: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test', walks: false }, derived });
    if (massing) doc = ProjectMod.writeSection(doc, 'massing', massing);
    return doc;
  }
  return { memory, siteProject, S, PLACEMENT };
})();

async function runSiteTests() {
  const { eq, near, make, $, wait, frames } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const mem = SiteFixture.memory();
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
  const fresh = () => { Store.replace(fillDefaults(defaultState())); };
  const errors = [];
  const onErr = (e) => { errors.push(String(e && e.message ? e.message : e)); };
  window.addEventListener('error', onErr);
  const siteMesh = (kind) => Render.sceneObjects().find((o) => o.userData && o.userData.kind === kind) || null;
  const viewRow = () => [...document.querySelectorAll('#tabpanel-view .toggle-row')].find((b) => b.textContent.trim() === 'Site');
  const open = () => { const doc = SiteFixture.siteProject(); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };
  const bbox = (mesh) => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox; };

  try {
    fresh();
    await frames(3);
    await t('1 no project: the site layer is off', () => eq([SiteLayer.info().shown, SiteLayer.groundMesh()], [false, null]));
    await t('2 a project with a site draws the neighbors, the pavement, the water and the trees; the ground stays the sketch ground', async () => {
      open();
      await frames(4);
      const i = SiteLayer.info();
      return eq([i.shown, i.ground, i.buildings, i.roads, i.walks, i.waterAreas, i.trees, Render.sceneFlags().site, !!siteMesh('site-buildings'), !!siteMesh('site-ground'), errors.length],
        [true, false, 2, 1, 1, 1, 3, true, true, false, 0]);
    });
    await t('3 the View Site toggle switches the layer off and on again', async () => {
      UI.setTab('view');
      const row = viewRow();
      const a = [SiteLayer.info().shown, !!row, row && row.getAttribute('aria-checked')];
      row.click();
      await frames(3);
      const off = [SiteLayer.info().shown, Store.get('view.site'), Render.sceneFlags().site];
      row.click();
      await frames(3);
      const on = [SiteLayer.info().shown, Store.get('view.site'), SiteLayer.info().buildings];
      return eq([a, off, on], [[true, true, 'true'], [false, false, true], [true, true, 2]]);
    });
    await t('4 the Compare view hides the layer; closing Compare shows it again', async () => {
      fresh();
      Options.save(); Options.duplicate();
      const ok = Compare.enter();
      await frames(3);
      const during = [ok !== false, Render.sceneFlags().site];
      Compare.exit();
      await frames(3);
      for (const o of Options.list()) Options.storage.remove(o.id);
      return eq([during, Render.sceneFlags().site, SiteLayer.info().shown], [[true, false], true, true]);
    });
    await t('5 the AI-ready image hides the layer while it is drawn and puts it back after', async () => {
      const orig = ShotMod.captureView;
      let seen = null;
      ShotMod.captureView = (o) => { seen = { site: Render.sceneFlags().site }; return orig(o); };
      try { await Shots.aiReady({ deliver: false }); } finally { ShotMod.captureView = orig; }
      await frames(3);
      return eq([seen, Render.sceneFlags().site], [{ site: false }, true]);
    });
    await t('6 a theme change rebuilds the layer (the key carries the theme epoch)', async () => {
      const k0 = SiteLayer.info().key, m0 = siteMesh('site-buildings');
      Render.themeChanged();
      await frames(4);
      const k1 = SiteLayer.info().key, m1 = siteMesh('site-buildings');
      return eq([k0 !== k1, !!m0, !!m1, m0 !== m1, SiteLayer.info().buildings], [true, true, true, true, 2]);
    });
    await t('7 the layer draws the site meshes: buildings, roads, walks, water, trees', async () => {
      const kinds = [];
      Render.sceneObjects().forEach((o) => { if (o.userData && o.userData.site && !kinds.includes(o.userData.kind)) kinds.push(o.userData.kind); });
      return eq(['site-buildings', 'site-roads', 'site-walks', 'site-water', 'site-trees'].every((k) => kinds.includes(k)), true);
    });
    await t('9 the neighbors follow the vertical exaggeration of the sketch', async () => {
      const h1 = bbox(siteMesh('site-buildings')).max.y - bbox(siteMesh('site-buildings')).min.y;
      Store.set('view.exaggeration', 3, { live: false });
      await frames(4);
      const h3 = bbox(siteMesh('site-buildings')).max.y - bbox(siteMesh('site-buildings')).min.y;
      Store.set('view.exaggeration', 1, { live: false });
      await frames(3);
      return eq([Math.abs(h3 / h1 - 3) < 0.02, h1 > 30], [true, true]);
    });
    await t('10 the old 25 percent ghost is gone: no context mesh in the scene and no Ground3D.contextObjects', async () => {
      Store.set('view.context', true, { live: false });
      await frames(3);
      const ghosts = Render.sceneObjects().filter((o) => o.userData && o.userData.context).length;
      return eq([ghosts, typeof Ground3D.contextObjects, SiteLayer.info().ground, SiteLayer.info().buildings], [0, 'undefined', false, 2]);
    });
    await t('11 the layer never feeds a number: the grading numbers stay the same when the Site switch flips', async () => {
      const a = JSON.stringify(Derived.get().hud);
      Store.set('view.site', false, { live: false });
      await frames(2);
      const b = JSON.stringify(Derived.get().hud);
      Store.set('view.site', true, { live: false });
      await frames(2);
      return eq([a === b, a.length > 20], [true, true]);
    });
    await t('12 Axon frames the whole site; switching the layer off frames the building again, and on again frames the site', async () => {
      Render.setView('axon', false);
      await frames(3);
      const a = Render.info().distance;
      Store.set('view.site', false, { live: false });
      await wait(1600);
      const b = Render.info().distance;
      Store.set('view.site', true, { live: false });
      await wait(1600);
      const c = Render.info().distance;
      return eq([a > b * 1.5, c > b * 1.5], [true, true]);
    });
    await t('8 closing the project removes the layer', async () => {
      ProjectUI.close();
      await frames(3);
      return eq([SiteLayer.info().shown, !!siteMesh('site-buildings')], [false, false]);
    });
  } finally {
    window.removeEventListener('error', onErr);
    if (Compare.isActive()) Compare.exit();
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    Select.clear();
    Store.replace(savedState);
    UI.setTab(savedTab, { remember: false });
    Options.holdAutosave(false);
  }
  return results;
}

/* The merged run (runAllTests, in 12d) picks the site tests up here, after the others. */
{
  const runAllBefore = runAllTests;
  runAllTests = async function runAllTestsWithSite() {
    const r = await runAllBefore();
    const site = await runSiteTests();
    const failed = site.filter((x) => !x.ok);
    r.results.push(...site);
    r.failed.push(...failed);
    r.total += site.length;
    r.passed += site.length - failed.length;
    TestHelp.merged('site', site);
    return r;
  };
}
