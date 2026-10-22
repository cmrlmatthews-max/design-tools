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
  const massing = () => { const m = ProjectFixture.massing(); m.placement = { ...SiteFixture.PLACEMENT }; return m; };
  const open = () => { const doc = SiteFixture.siteProject({ massing: massing() }); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };

  try {
    fresh();
    await frames(3);
    await t('1 no project: the site layer is off and the grid keeps full strength', () => eq([SiteLayer.info().shown, SiteLayer.groundMesh() === null, Render.sceneFlags().gridA], [false, true, 0.8]));
    await t('2 a project with a site draws the ground, the pavement, the water, the trees and 2 neighbors; the grid fades to 40 percent', async () => {
      open();
      await frames(4);
      const i = SiteLayer.info(), f = Render.sceneFlags();
      return eq([i.shown, i.ground, i.buildings, i.roads, i.walks, i.waterAreas, i.trees, f.site, Math.round(f.gridA * 1000) / 1000, errors.length],
        [true, true, 2, 1, 1, 1, 3, true, 0.32, 0]);
    });
    await t('3 the View Site toggle switches the layer off and on again', async () => {
      UI.setTab('view');
      const row = viewRow();
      const a = [SiteLayer.info().shown, !!row, row && row.getAttribute('aria-checked')];
      row.click();
      await frames(3);
      const off = [SiteLayer.info().shown, Store.get('view.site'), Render.sceneFlags().gridA, Render.sceneFlags().site];
      row.click();
      await frames(3);
      const on = [SiteLayer.info().shown, Store.get('view.site'), SiteLayer.info().buildings];
      return eq([a, off, on], [[true, true, 'true'], [false, false, 0.8, true], [true, true, 2]]);
    });
    await t('4 the Compare view hides the layer; closing Compare shows it again', async () => {
      fresh();
      Options.save(); Options.duplicate();
      const ok = Compare.enter();
      await frames(3);
      const during = [ok !== false, Render.sceneFlags().site, Render.sceneFlags().gridA];
      Compare.exit();
      await frames(3);
      for (const o of Options.list()) Options.storage.remove(o.id);
      return eq([during, Render.sceneFlags().site, SiteLayer.info().shown], [[true, false, 0.8], true, true]);
    });
    // test 5: the Plate Planner has no AI-ready image
    await t('6 a theme change rebuilds the layer (the key carries the theme epoch)', async () => {
      const k0 = SiteLayer.info().key, m0 = siteMesh('site-buildings');
      Render.themeChanged();
      await frames(4);
      const k1 = SiteLayer.info().key, m1 = siteMesh('site-buildings');
      return eq([k0 !== k1, !!m0, !!m1, m0 !== m1, SiteLayer.info().buildings], [true, true, true, true, 2]);
    });
    await t('7 the layer draws the site meshes: ground, buildings, roads, walks, water, trees', async () => {
      const kinds = [];
      Render.sceneObjects().forEach((o) => { if (o.userData && o.userData.site && !kinds.includes(o.userData.kind)) kinds.push(o.userData.kind); });
      return eq(['site-ground', 'site-buildings', 'site-roads', 'site-walks', 'site-water', 'site-trees'].every((k) => kinds.includes(k)), true);
    });
    await t('9 the ghost of the site neighbors does not double the solid ones; it returns when the Site switch is off', async () => {
      Store.set('view.context', true, { live: false });
      await frames(3);
      const on = [SiteLayer.info().buildings, Render.contextMeshes()];
      Store.set('view.site', false, { live: false });
      await frames(3);
      const off = [SiteLayer.info().buildings, Render.contextMeshes()];
      Store.set('view.site', true, { live: false });
      await frames(3);
      return eq([on, off], [[2, 0], [0, 1]]);
    });
    await t('10 the layer never feeds a number: the plate numbers stay the same when the Site switch flips', async () => {
      const a = JSON.stringify(Derived.get().hud);
      Store.set('view.site', false, { live: false });
      await frames(2);
      const b = JSON.stringify(Derived.get().hud);
      Store.set('view.site', true, { live: false });
      await frames(2);
      return eq([a === b, a.length > 20], [true, true]);
    });
    await t('12 Axon frames the building plus a margin of max(150 ft, 0.6 x its span), clamped to the site square: smaller than the site, holding the building; the layer off frames the building alone', async () => {
      Render.setView('axon', false);
      await frames(3);
      const on = Render.framedBox('axon'), sb = SiteLayer.frameBox(Store.raw()), a = Render.info().distance;
      Store.set('view.site', false, { live: false });
      await wait(1600);
      const off = Render.framedBox('axon'), b = Render.info().distance;
      Store.set('view.site', true, { live: false });
      await wait(1600);
      const c = Render.info().distance;
      const m = Math.max(150, 0.6 * Math.max(off.maxX - off.minX, off.maxY - off.minY));
      const holds = on.minX <= off.minX && on.maxX >= off.maxX && on.minY <= off.minY && on.maxY >= off.maxY;
      const smaller = on.maxX - on.minX < sb.maxX - sb.minX - 1 && on.maxY - on.minY < sb.maxY - sb.minY - 1;
      const margin = [on.minX - Math.min(off.minX, Math.max(off.minX - m, sb.minX)), on.maxX - Math.max(off.maxX, Math.min(off.maxX + m, sb.maxX)), on.minY - Math.min(off.minY, Math.max(off.minY - m, sb.minY)), on.maxY - Math.max(off.maxY, Math.min(off.maxY + m, sb.maxY))].every((v) => Math.abs(v) < 1e-6);
      return eq([holds, smaller, margin, a > b * 1.1, Math.abs(a - c) < a * 0.01, m >= 150], [true, true, true, true, true, true]);
    });
    await t('8 closing the project removes the layer', async () => {
      ProjectUI.close();
      await frames(3);
      return eq([SiteLayer.info().shown, Math.round(Render.sceneFlags().gridA * 1000) / 1000], [false, 0.8]);
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
