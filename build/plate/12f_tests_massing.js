/* ==========================================================================
   TESTS: the project massing in the 3D view
   A project with a massing of nine levels (a two-level podium, a four-level tower group, a two-level upper group, a crown). View > Massing draws
   every level as a solid with dark edges (the podium softer), the active group highlighted, the editing level standing at its own z;
   Plan draws the massing as outlines so the plate stays readable; Compare hides it. runAllTests below picks these tests up after the others.
   ========================================================================== */
const MassingFixture = (() => {
  const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const lv = (index, zone, z, ftf, w, d, extra = {}) => ({ index, name: `Level ${index}`, zone, z, ftf, program: zone === 'crown' ? null : 'residential', plates: [{ outer: rect(w, d), holes: extra.hole ? [rect(w - 2, d - 2).reverse()] : [] }], core: zone === 'tower' ? rect(30, 24) : null, spines: [], seeds: [] });
  /** Podium 1-2 (120 x 100), group A = levels 3-6 (80 x 60), group B = levels 7-8 (60 x 50), crown 9. */
  const massing = (placement = { x: 0, y: 0, rotation: 0, baseZ: 0 }) => ({
    tool: 'tower', schema: 1, placement, state: {},
    derived: { levels: [lv(1, 'podium', 0, 15, 120, 100), lv(2, 'podium', 15, 15, 120, 100), lv(3, 'tower', 30, 10, 80, 60), lv(4, 'tower', 40, 10, 80, 60), lv(5, 'tower', 50, 10, 80, 60), lv(6, 'tower', 60, 10, 80, 60), lv(7, 'tower', 70, 10, 60, 50), lv(8, 'tower', 80, 10, 60, 50), lv(9, 'crown', 90, 20, 60, 50, { hole: true })] },
  });
  return { massing };
})();

async function runMassingTests() {
  const { eq, near, make, wait, frames } = TestHelp;
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
  const unitsMesh = () => Render.sceneObjects().find((o) => o.userData && o.userData.units && o.isMesh && o.parent && o.parent.visible);
  const yRange = (m) => { m.geometry.computeBoundingBox(); return [Math.round(m.geometry.boundingBox.min.y * 100) / 100, Math.round(m.geometry.boundingBox.max.y * 100) / 100]; };
  const openPlain = () => { const doc = ProjectMod.writeSection(ProjectMod.newProject({ name: 'Massing fixture' }), 'massing', MassingFixture.massing()); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };
  const viewRow = () => [...document.querySelectorAll('#tabpanel-view .toggle-row')].find((b) => b.textContent.trim() === 'Massing');

  try {
    fresh();
    await frames(3);
    await t('m1 no project: no massing layer and the plate stands at z 0', () => eq([Render.massingInfo().solids, Plate3D.editingAtZ(Store.raw())], [0, false]));
    await t('m2 a project with a massing: 8 level solids (the editing level is a fill), each with dark edges; 2 softer podium levels; the 3 other levels of the active group carry an accent ring; the crown is a solid with a hole', async () => {
      openPlain();
      Render.setView('axon', false);
      await frames(4);
      const i = Render.massingInfo(), d = Derived.get();
      return eq([d.groups.length, d.editing.index, i.solids, i.edges, i.podium, i.active, i.rings, i.levels.includes(9), i.levels.includes(3), i.visibleSolids, i.visibleOutlines, errors.length], [2, 3, 8, 8, 2, [4, 5, 6], 3, true, false, 8, 0, 0]);
    });
    await t('m3 the editing plate stands at the z of its level (30 to 39 ft) inside the massing; the massing top is the crown (110 ft)', async () => {
      const u = unitsMesh(), i = Render.massingInfo();
      return eq([yRange(u), i.topY], [[30, 39], 110]);
    });
    await t('m4 selecting the other group rebuilds the volume: active level 8 only, level 7 is the fill at z 70', async () => {
      const d0 = Derived.get(), other = d0.groups.find((g) => g.id !== d0.group.id);
      const before = Render.massingInfo();
      Store.set('levels.selected', other.id, { live: false });
      await frames(4);
      const i = Render.massingInfo(), u = unitsMesh();
      Store.set('levels.selected', d0.group.id, { live: false });
      await frames(4);
      return eq([before.solids, i.solids, i.active, i.levels.includes(7), yRange(u)[0], Render.massingInfo().active], [8, 8, [8], false, 70, [4, 5, 6]]);
    });
    await t('m5 View > Massing switches the volume off (the plate returns to z 0, the other groups return as faint outlines) and on again', async () => {
      UI.setTab('view');
      const row = viewRow();
      const on = [!!row, row && row.getAttribute('aria-checked'), Store.get('view.massing')];
      row.click();
      await frames(4);
      const offUnits = unitsMesh();
      const off = [Render.massingInfo().solids, Store.get('view.massing'), yRange(offUnits)[0] < 5, Plate3D.editingAtZ(Store.raw())];
      row.click();
      await frames(4);
      return eq([on, off, Render.massingInfo().solids, yRange(unitsMesh())[0]], [[true, 'true', true], [0, false, true, false], 8, 30]);
    });
    await t('m6 Plan draws the massing as outlines only and looks at the plate where it stands, above the top of the massing; Axon draws the solids', async () => {
      Render.setView('plan', false);
      await frames(4);
      const p = Render.massingInfo(), cam = Render.camera();
      const plan = [p.visibleSolids, p.visibleOutlines > 0, cam.position.y > p.topY, Render.info().preset];
      Render.setView('axon', false);
      await frames(4);
      const a = Render.massingInfo();
      return eq([plan, a.visibleSolids, a.visibleOutlines], [[0, true, true, 'plan'], 8, 0]);
    });
    await t('m7 the plate is on top in Plan: the units mesh is visible and nothing visible stands above it except lines', async () => {
      Render.setView('plan', false);
      await frames(4);
      const u = unitsMesh();
      const blockers = Render.sceneObjects().filter((o) => o.isMesh && o.visible && o.parent && o.parent.visible && o.userData && o.userData.massingMesh && (o.geometry.computeBoundingBox(), o.geometry.boundingBox.max.y > 39));
      return eq([!!u, blockers.length], [true, 0]);
    });
    await t('m8 "Levels in 3D" draws every filled level as a fill, so the massing keeps only the podium and the crown', async () => {
      Render.setView('axon', false);
      Store.set('view.levels3d', true, { live: false });
      await frames(4);
      const i = Render.massingInfo();
      Store.set('view.levels3d', false, { live: false });
      await frames(4);
      return eq([i.solids, i.levels.sort((a, b) => a - b), Render.massingInfo().solids], [3, [1, 2, 9], 8]);
    });
    await t('m9 Axon frames the whole massing (the podium is wider than the plate)', async () => {
      const b = Render.framedBox('axon'), mb = ProjectUI.massingBox();
      return eq([b.minX <= mb.minX, b.maxX >= mb.maxX, b.minY <= mb.minY, b.maxY >= mb.maxY, b.height >= 110], [true, true, true, true, true]);
    });
    await t('m10 the Compare view hides the massing; closing Compare shows it again', async () => {
      Options.save(); Options.duplicate();
      const ok = Compare.enter();
      await frames(3);
      const during = [ok !== false, Render.massingInfo().groupVisible];
      Compare.exit();
      await frames(3);
      for (const o of Options.list()) Options.storage.remove(o.id);
      return eq([during, Render.massingInfo().groupVisible, Render.massingInfo().solids], [[true, false], true, 8]);
    });
    await t('m11 a theme change rebuilds the volume', async () => {
      const first = Render.sceneObjects().find((o) => o.userData && o.userData.massingMesh);
      Render.themeChanged();
      await frames(4);
      const second = Render.sceneObjects().find((o) => o.userData && o.userData.massingMesh);
      return eq([!!first, !!second, first !== second], [true, true, true]);
    });
    await t('m12 on a sloping site the lowest levels continue down to the ground (a foot); on no site there is none', async () => {
      const none = Render.massingInfo().foot;
      const doc = SiteFixture.siteProject({ massing: MassingFixture.massing({ ...SiteFixture.PLACEMENT }) });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      await frames(5);
      const i = Render.massingInfo();
      return eq([none, SiteLayer.info().ground, i.foot, SiteLayer.massingFoot() > 0.5, i.solids], [false, true, true, true, 8]);
    });
    await t('m13 closing the project removes the volume; the plate stands at z 0 again; no errors', async () => {
      ProjectUI.close();
      await frames(4);
      return eq([Render.massingInfo().solids, errors.length], [0, 0]);
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

{
  const runAllBefore = runAllTests;
  runAllTests = async function runAllTestsWithMassing() {
    const r = await runAllBefore();
    const mass = await runMassingTests();
    const failed = mass.filter((x) => !x.ok);
    r.results.push(...mass);
    r.failed.push(...failed);
    r.total += mass.length;
    r.passed += mass.length - failed.length;
    TestHelp.merged('massing', mass);
    return r;
  };
}
