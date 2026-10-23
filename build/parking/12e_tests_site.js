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
  const massing = () => { const m = ProjectFixture.massing(); m.placement = { ...SiteFixture.PLACEMENT }; return m; };
  const fresh = () => { Store.replace(fillDefaults(defaultState())); };
  const open = () => { const doc = SiteFixture.siteProject({ massing: massing() }); ProjectMod.saveProject(mem, doc); ProjectUI.openDoc(doc); return doc; };
  const errors = [];
  const onErr = (e) => { errors.push(String(e && e.message ? e.message : e)); };
  window.addEventListener('error', onErr);

  try {
    fresh();
    Store.set('view.shadows', true, { live: false });
    await frames(3);
    await t('1 no project: the site layer is off, the flat slab and the shadow plane stay', () => {
      const f = Render.sceneFlags();
      return eq([SiteLayer.info().shown, SiteLayer.groundMesh() === null, f.slabY, f.shadowPlane], [false, true, 0, true]);
    });

    await t('2 a project with a site draws the ground, the pavement, the water, the trees and 2 neighbors; the slab drops under the ground', async () => {
      open();
      await frames(4);
      const i = SiteLayer.info(), f = Render.sceneFlags();
      const bottom = 1000 - SiteFixture.PLACEMENT.baseZ;                       // the lowest node, relative to the placement base
      return eq([i.shown, i.ground, i.buildings, i.roads, i.walks, i.waterAreas, i.trees, f.site, f.slabY, f.shadowPlane, errors.length],
        [true, true, 2, 1, 1, 1, 3, true, bottom - 4, false, 0]);
    });
    await t('2b the layer keeps its numbers out of the metrics: the same deck has the same HUD with the layer on and off', async () => {
      const a = JSON.stringify(Derived.get().hud);
      Store.set('view.site', false, { live: false });
      await frames(2);
      const b = JSON.stringify(Derived.get().hud);
      Store.set('view.site', true, { live: false });
      await frames(2);
      return eq(a === b, true);
    });

    await t('3 the View Site toggle switches the layer off and on again, and the slab comes back', async () => {
      UI.setTab('view');
      const row = [...document.querySelectorAll('#tabpanel-view .toggle-row')].find((b) => b.textContent.trim() === 'Site');
      const a = [SiteLayer.info().shown, !!row, row && row.getAttribute('aria-checked')];
      row.click();
      await frames(3);
      const off = [SiteLayer.info().shown, Store.get('view.site'), Render.sceneFlags().slabY, Render.sceneFlags().shadowPlane, Render.sceneFlags().site];
      row.click();
      await frames(3);
      const on = [SiteLayer.info().shown, Store.get('view.site'), SiteLayer.info().buildings];
      return eq([a, off, on], [[true, true, 'true'], [false, false, 0, true, true], [true, true, 2]]);
    });

    await t('4 the Compare view hides the layer; closing Compare shows it again', async () => {
      const id = Options.save();
      Store.set('bays.stallW', 9.5, { live: false });
      const ok = Compare.enter([id, '__current']);
      await frames(3);
      const during = [ok !== false, Render.sceneFlags().site, Render.sceneFlags().slabY, Render.sceneFlags().shadowPlane];
      Compare.exit();
      await frames(3);
      Options.storage.remove(id);
      Store.set('bays.stallW', 9, { live: false });
      return eq([during, Render.sceneFlags().site, SiteLayer.info().shown], [[true, false, 0, true], true, true]);
    });

    await t('5 the AI-ready image keeps the site layer on screen, hides the boundary and the north arrow, then puts everything back', async () => {
      const orig = ShotMod.captureView;
      let seen = null;
      const markState = () => ['site-boundary', 'site-arrow'].map((k) => Render.sceneObjects().some((o) => o.userData && o.userData.kind === k && o.visible));
      const before = markState();
      ShotMod.captureView = (o) => { seen = { site: Render.sceneFlags().site, slab: Render.sceneFlags().slabY, flags: Render.captureFlags() }; return orig(o); };
      try { await Shots.aiReady({ deliver: false }); } finally { ShotMod.captureView = orig; }
      await frames(3);
      const cf = Render.captureFlags();
      const marks = markState();
      return eq([seen && seen.site, [cf.site, cf.boundary, cf.arrow, cf.grid, cf.figure, cf.overlay], cf.siteObjects > 2, Render.sceneFlags().site, eq(marks, before)], [true, [true, false, false, false, false, false], true, true, true]);
    });

    await t('5b the AI-ready image draws the hero in CONFIG.heroColor (captureFlags reports it), the neighbors and context stay as drawn, and the live materials come back', async () => {
      const heroHex = CONFIG.heroColor.toLowerCase();
      const orig = ShotMod.captureView;
      const hx = (m) => `#${m.color.getHexString()}`;
      const hasColor = (x) => x.isMesh && x.material && !Array.isArray(x.material) && x.material.color;
      let seen = null;
      ShotMod.captureView = async (o) => {
        const heroes = [], others = [];
        o.scene.traverse((x) => { if (x.isMesh) (x.userData.hero ? heroes : others).push(x); });
        seen = { scene: o.scene, flags: Render.captureFlags(), n: heroes.length, heroHexes: heroes.filter(hasColor).map((x) => hx(x.material)), othersHero: others.filter((x) => hasColor(x) && hx(x.material) === heroHex).length };
        return new Blob(['x']);
      };
      try { await Render.captureClean(1); } finally { ShotMod.captureView = orig; }
      await frames(3);
      let liveHero = 0;
      seen.scene.traverse((x) => { if (hasColor(x) && hx(x.material) === heroHex) liveHero++; });
      return eq([seen.n > 0, seen.heroHexes.includes(heroHex), seen.flags.heroColor, Render.captureFlags().heroColor, seen.othersHero, liveHero], [true, true, CONFIG.heroColor, CONFIG.heroColor, 0, 0]);
    });

    await t('6 a theme change rebuilds the layer (the key carries the theme epoch)', async () => {
      const k0 = SiteLayer.info().key, m0 = SiteLayer.groundMesh();
      Render.themeChanged();
      await frames(4);
      const k1 = SiteLayer.info().key, m1 = SiteLayer.groundMesh();
      return eq([k0 !== k1, m0 !== m1, !!m1, SiteLayer.info().buildings], [true, true, true, 2]);
    });

    await t('7 the layer draws the site meshes: ground, buildings, roads, walks, water, trees', async () => {
      const kinds = [];
      Render.sceneObjects().forEach((o) => { if (o.userData && o.userData.site && !kinds.includes(o.userData.kind)) kinds.push(o.userData.kind); });
      return eq(['site-ground', 'site-buildings', 'site-roads', 'site-walks', 'site-water', 'site-trees'].every((k) => kinds.includes(k)), true);
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
    await t('8s site style: glass draws the neighbors transparent (opacity 0.25, no depth write, drawn after the ground) with their edges kept; wireframe draws edges only; solid is opaque again; the ground and roads do not change; info.style and the layer key follow', async () => {
      if (!SiteLayer.info().shown) open();
      await frames(4);
      const objs = () => Render.sceneObjects();
      const read = () => {
        const o = objs(), m = o.find((x) => x.userData.kind === 'site-buildings'), e = o.filter((x) => x.userData.kind === 'site-building-edges'), r = o.find((x) => x.userData.kind === 'site-roads') || o.find((x) => x.userData.kind === 'site-ground');
        return {
          style: SiteLayer.info().style, mesh: !!m, transparent: m ? m.material.transparent : null, opacity: m ? m.material.opacity : null, depthWrite: m ? m.material.depthWrite : null,
          order: m ? m.renderOrder : null, edges: e.length, edgeOrder: e.length ? e[0].renderOrder : null, roads: r ? [r.material.transparent, r.material.opacity] : null, buildings: SiteLayer.info().buildings,
        };
      };
      const keys = [];
      const out = {};
      for (const s of ['solid', 'glass', 'wireframe', 'solid']) {
        Store.set('view.siteStyle', s, { live: false });
        await frames(4);
        out[s] = read();
        keys.push(SiteLayer.info().key);
      }
      const n = out.solid.edges;
      const ok = {
        solid: eq(out.solid, { style: 'solid', mesh: true, transparent: false, opacity: 1, depthWrite: true, order: 0, edges: n, edgeOrder: 0, roads: [false, 1], buildings: 2 }),
        glass: eq(out.glass, { style: 'glass', mesh: true, transparent: true, opacity: 0.25, depthWrite: false, order: 2, edges: n, edgeOrder: 3, roads: [false, 1], buildings: 2 }),
        wire: eq(out.wireframe, { style: 'wireframe', mesh: false, transparent: null, opacity: null, depthWrite: null, order: null, edges: n, edgeOrder: 3, roads: [false, 1], buildings: 2 }),
        keys: keys[0] !== keys[1] && keys[1] !== keys[2] && keys[0] !== keys[2] && keys[3] === keys[0],
        edges: n > 0, errors: errors.length,
      };
      const bad = Object.entries(ok).filter(([k, v]) => k === 'errors' ? v !== 0 : v !== true);
      return bad.length ? JSON.stringify(bad) : true;
    });

    await t('8t site style chips: the View tab has Site style Solid, Glass, Wireframe under the Site toggle (hidden while Site is off); a click sets view.siteStyle; an unknown saved value fills as solid', async () => {
      if (!SiteLayer.info().shown) open();
      await frames(4);
      const q = (v) => document.querySelector(`#siteStyleChips [data-value="${v}"]`);
      const row = document.getElementById('siteStyleChips');
      const labels = row ? [...row.querySelectorAll('[data-value]')].map((b) => b.textContent.trim()) : [];
      const visible = () => !!row && !row.closest('.when[hidden]');
      Store.set('view.siteStyle', 'solid', { live: false });
      await frames(4);
      const a = [visible(), q('solid') && q('solid').getAttribute('aria-pressed')];
      q('glass').click();
      await frames(4);
      const b = [Store.get('view.siteStyle'), q('glass').getAttribute('aria-pressed'), q('solid').getAttribute('aria-pressed')];
      Store.set('view.site', false, { live: false });
      await frames(4);
      const hidden = !visible();
      Store.set('view.site', true, { live: false });
      Store.set('view.siteStyle', 'solid', { live: false });
      await frames(4);
      const fill = [fillDefaults({ view: { siteStyle: 'bogus' } }).view.siteStyle, fillDefaults({ view: { siteStyle: 'glass' } }).view.siteStyle, fillDefaults({}).view.siteStyle];
      return eq([labels, a, b, hidden, fill], [['Solid', 'Glass', 'Wireframe'], [true, 'true'], ['glass', 'true', 'false'], true, ['solid', 'glass', 'solid']]);
    });

    await t('8 closing the project removes the layer', async () => {
      ProjectUI.close();
      await frames(3);
      return eq([SiteLayer.info().shown, Render.sceneFlags().slabY], [false, 0]);
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
