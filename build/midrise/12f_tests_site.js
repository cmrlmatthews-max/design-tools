/* ==========================================================================
   TESTS: the site layer  (docs/site-layer-technical-plan.md section 9.2, tests 1 to 6)
   1. no project: no layer, the flat slab and the shadow plane stay;  2. a site project: ground, boundary, neighbors, no double
   building, slab and shadow plane follow the plan;  3. the View "Site" toggle;  4. Compare hides the layer;
   5. the AI-ready image hides the layer;  6. a theme change rebuilds the layer.
   Uses the in-memory fixture of 12d_tests_project.js. Wrapped around runAllTests below, so ?test and __midrise.runTests run them.
   ========================================================================== */
async function runSiteLayerTests() {
  const { eq, make, wait } = TestHelp;
  const { results, t } = make();
  const errors = [];
  const onError = (e) => errors.push(String((e && e.message) || e));
  window.addEventListener('error', onError);
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const mem = ProjectFixture.memory();
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
  const live = Render.ready();
  const openSite = async () => {
    Store.replace(fillDefaults(defaultState()));
    const doc = ProjectFixture.siteProject();
    ProjectMod.saveProject(mem, doc);
    ProjectUI.openDoc(doc);
    await wait(300);
  };

  try {
    await t('1. no project: the site layer is off, the flat slab and the shadow plane stay', async () => {
      if (!live) return true;
      Store.replace(fillDefaults(defaultState()));
      await wait(250);
      const i = SiteLayer.info(), f = Render.siteFlags();
      return eq([i.shown, i.ground, i.buildings, f.slabY, f.shadowPlane, SiteLayer.groundMesh()], [false, false, 0, 0, true, null]);
    });

    await t('2. a site project: ground (121 nodes), skirt, boundary, both neighbors (solid, with edges), the site context blocks left out of the context layer; slab, grid and shadow plane follow the plan', async () => {
      if (!live) return true;
      await openSite();
      const i = SiteLayer.info(), f = Render.siteFlags(), gm = SiteLayer.groundMesh();
      const group = [];
      gm && gm.parent && gm.parent.children.forEach((o) => group.push(o.userData.kind));
      const ctx = Store.get('context');
      const slab = i.bounds ? i.bounds.zMin - 4 : NaN;
      const checks = {
        shown: i.shown, ground: i.ground, buildings: i.buildings, contextMeshes: f.contextMeshes, nodes: gm && gm.geometry.getAttribute('position').count,
        receives: gm && gm.receiveShadow, kinds: ['site-ground', 'site-skirt', 'site-boundary', 'site-arrow', 'site-buildings', 'site-building-edges'].every((k) => group.includes(k)),
        ctx: ctx.fromSite ? ctx.blocks.length : 0, slab: Math.abs(f.slabY - slab) < 1e-6, shadowPlane: f.shadowPlane, grid: Math.abs(f.gridMinorA - 0.42 * 0.4) < 1e-9, triangles: i.triangles > 200, errors: errors.length,
      };
      return eq(checks, { shown: true, ground: true, buildings: 2, contextMeshes: 0, nodes: 121, receives: true, kinds: true, ctx: 1, slab: true, shadowPlane: false, grid: true, triangles: true, errors: 0 });
    });

    await t('2b. the layer draws both neighbors with the context blocks on or off; the context blocks stay in the state', async () => {
      if (!live) return true;
      Store.set('context.show', false, { live: false });
      await wait(300);
      const off = SiteLayer.info().buildings;
      Store.set('context.show', true, { live: false });
      await wait(300);
      return eq([off, SiteLayer.info().buildings, Store.get('context.blocks').length], [2, 2, 1]);
    });

    await t('2c. the scale figure stands on the site ground', async () => {
      if (!live) return true;
      const p = Store.get('placement'), d = Derived.get();
      const gz = SiteLayer.groundZ(d.bounds.site.minX + 14, d.bounds.site.minY + 14);
      return (gz !== null && Math.abs(Render.siteFlags().figureY - gz) < 1e-6 && Math.abs(gz - (1000 + 0.01 * (p.x + d.bounds.site.minX + 14) + 0.02 * (p.y + d.bounds.site.minY + 14) - p.baseZ)) < 0.5) || `figureY ${Render.siteFlags().figureY}, ground ${gz}`;
    });

    await t('3. the View "Site" toggle: off hides the layer, restores the slab and shadow plane and draws the site context blocks again; on brings it back', async () => {
      if (!live) return true;
      UI.setTab('view');
      const row = [...document.querySelectorAll('#tabpanel-view .toggle-row')].find((b) => b.textContent.trim() === 'Site');
      const labelled = !!row;
      if (row) row.click();
      await wait(300);
      const off = SiteLayer.info(), f = Render.siteFlags();
      const offFlags = [off.shown, off.buildings, f.slabY, f.shadowPlane, SiteLayer.groundMesh(), f.contextMeshes];
      const checked = row ? row.getAttribute('aria-checked') : null;
      if (row) row.click();
      await wait(300);
      const on = SiteLayer.info();
      return eq([labelled, checked, offFlags, on.shown, on.ground, on.buildings], [true, 'false', [false, 0, 0, true, null, 1], true, true, 2]);
    });

    await t('3b. view.site defaults to true and an old save without it gets true', () => {
      const old = defaultState(); delete old.view.site;
      return eq([defaultState().view.site, fillDefaults(old).view.site], [true, true]);
    });

    await t('4. the Compare view hides the layer; closing Compare shows it again', async () => {
      if (!live) return true;
      const st = Store.snapshot();
      const entry = (uid) => ({ name: uid, state: st, d: Derived.get(), uid });
      Render.enterCompare([entry('a'), entry('b')], null);
      await wait(250);
      const inCmp = [Render.siteFlags().siteVisible, Render.siteFlags().slabY, Render.siteFlags().shadowPlane];
      Render.exitCompare();
      await wait(350);
      const back = [Render.siteFlags().siteVisible, SiteLayer.info().shown, SiteLayer.info().buildings];
      return eq([inCmp, back], [[false, 0, true], [true, true, 2]]);
    });

    await t('5. the AI-ready image keeps the site layer on screen, hides the boundary and the north arrow, then puts everything back', async () => {
      if (!live) return true;
      const real = ShotMod.captureView, seen = [];
      ShotMod.captureView = async () => { const f = Render.siteFlags(); seen.push([f.siteVisible, f.slabY < -10, f.shadowPlane]); return new Blob(['x']); };
      try { await Render.captureClean(1); } finally { ShotMod.captureView = real; }
      await wait(150);
      const f = Render.siteFlags(), cf = Render.captureFlags();
      const kids = SiteLayer.groundMesh().parent.children;
      const marks = ['site-boundary', 'site-arrow'].map((k) => kids.some((o) => o.userData.kind === k && o.visible));
      return eq([seen, [cf.site, cf.boundary, cf.arrow, cf.grid, cf.figure, cf.overlay], cf.siteObjects > 2, [f.siteVisible, f.slabY < -10, marks], SiteLayer.info().shown],
        [[[true, true, false]], [true, false, false, false, false, false], true, [true, true, [true, true]], true]);
    });

    await t('5b the AI-ready image draws the hero in CONFIG.heroColor (captureFlags reports it), the neighbors and context stay as drawn, and the live materials come back', async () => {
      if (!live) return true;
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
      await wait(150);
      let liveHero = 0;
      seen.scene.traverse((x) => { if (hasColor(x) && hx(x.material) === heroHex) liveHero++; });
      return eq([seen.n > 0, seen.heroHexes.includes(heroHex), seen.flags.heroColor, Render.captureFlags().heroColor, seen.othersHero, liveHero], [true, true, CONFIG.heroColor, CONFIG.heroColor, 0, 0]);
    });

    await t('6. a theme change rebuilds the layer (the key carries the theme epoch)', async () => {
      if (!live) return true;
      const before = SiteLayer.info().key, mesh = SiteLayer.groundMesh(), epoch = Render.themeEpoch();
      Render.bumpTheme();
      await wait(350);
      const after = SiteLayer.info().key, mesh2 = SiteLayer.groundMesh();
      return eq([Render.themeEpoch() === epoch + 1, after !== before, mesh2 !== mesh, SiteLayer.info().shown], [true, true, true, true]);
    });

    await t('6b. Axon and Plan frame the building plus a margin of max(150 ft, 0.6 x its span), clamped to the site square: smaller than the site, holding the building (the elevations keep the building box)', async () => {
      if (!live) return true;
      const out = [];
      for (const id of ['axon', 'plan', 'e']) {
        Store.set('view.site', false, { live: false });
        await wait(150);
        const off = Render.framedBox(id);
        Store.set('view.site', true, { live: false });
        await wait(150);
        const on = Render.framedBox(id), sb = SiteLayer.frameBounds();
        const m = Math.max(150, 0.6 * Math.max(off.maxX - off.minX, off.maxY - off.minY));
        const holds = on.minX <= off.minX && on.maxX >= off.maxX && on.minY <= off.minY && on.maxY >= off.maxY;
        const smaller = on.maxX - on.minX < sb.maxX - sb.minX - 1 && on.maxY - on.minY < sb.maxY - sb.minY - 1;
        const margin = [on.minX - Math.min(off.minX, Math.max(off.minX - m, sb.minX)), on.maxX - Math.max(off.maxX, Math.min(off.maxX + m, sb.maxX)), on.minY - Math.min(off.minY, Math.max(off.minY - m, sb.minY)), on.maxY - Math.max(off.maxY, Math.min(off.maxY + m, sb.maxY))].every((v) => Math.abs(v) < 1e-6);
        out.push(id === 'e' ? [holds, on.maxX - on.minX === off.maxX - off.minX] : [holds, smaller, margin, m >= 150]);
      }
      return eq(out, [[true, true, true, true], [true, true, true, true], [true, true]]);
    });

    await t('7a. a live placement drag moves the built layer as a solid without rebuilding it; the commit rebuilds it', async () => {
      if (!live) return true;
      await wait(400);                                   // a frame may still be rebuilding the layer after the earlier tests
      const pl = Store.get('placement'), mesh = SiteLayer.groundMesh();
      Store.set('placement', { ...pl, x: pl.x + 40 }, { live: true });
      await wait(300);
      const g = mesh.parent;
      if (!g) return `the ground mesh left the scene during the drag; gesture ${Store.gestureActive()} ${Store.gesturePath()}; key ${SiteLayer.info().key}`;
      const during = [SiteLayer.groundMesh() === mesh, Math.round(g.position.x), Math.round(g.position.z)];
      Store.commit();
      await wait(350);
      const after = [SiteLayer.groundMesh() !== mesh, g.position.x, SiteLayer.info().shown];
      Store.set('placement', pl, { live: false });
      await wait(300);
      return eq([during, after], [[true, -40, 0], [true, 0, true]]);
    });

    await t('8s site style: glass draws the neighbors transparent (opacity 0.25, no depth write, drawn after the ground) with their edges kept; wireframe draws edges only; solid is opaque again; the ground and roads do not change; info.style and the layer key follow', async () => {
      if (!live) return true;
      if (!SiteLayer.info().shown) await openSite();
      const objs = () => { const g = SiteLayer.groundMesh(); return g && g.parent ? g.parent.children : []; };
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
        await wait(350);
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
      if (!live) return true;
      if (!SiteLayer.info().shown) await openSite();
      const q = (v) => document.querySelector(`#siteStyleChips [data-value="${v}"]`);
      const row = document.getElementById('siteStyleChips');
      const labels = row ? [...row.querySelectorAll('[data-value]')].map((b) => b.textContent.trim()) : [];
      const visible = () => !!row && !row.closest('.when[hidden]');
      Store.set('view.siteStyle', 'solid', { live: false });
      await wait(350);
      const a = [visible(), q('solid') && q('solid').getAttribute('aria-pressed')];
      q('glass').click();
      await wait(350);
      const b = [Store.get('view.siteStyle'), q('glass').getAttribute('aria-pressed'), q('solid').getAttribute('aria-pressed')];
      Store.set('view.site', false, { live: false });
      await wait(350);
      const hidden = !visible();
      Store.set('view.site', true, { live: false });
      Store.set('view.siteStyle', 'solid', { live: false });
      await wait(350);
      const fill = [fillDefaults({ view: { siteStyle: 'bogus' } }).view.siteStyle, fillDefaults({ view: { siteStyle: 'glass' } }).view.siteStyle, fillDefaults({}).view.siteStyle];
      return eq([labels, a, b, hidden, fill], [['Solid', 'Glass', 'Wireframe'], [true, 'true'], ['glass', 'true', 'false'], true, ['solid', 'glass', 'solid']]);
    });

    await t('7. closing the project removes the layer; the slab and shadow plane come back', async () => {
      if (!live) return true;
      ProjectUI.close();
      await wait(350);
      const f = Render.siteFlags();
      return eq([SiteLayer.info().shown, SiteLayer.groundMesh(), f.slabY, f.shadowPlane, errors.length], [false, null, 0, true, 0]);
    });
  } finally {
    window.removeEventListener('error', onError);
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    Select.clear();
    Store.replace(savedState);
    UI.setTab(savedTab);
    Options.holdAutosave(false);
  }
  return results;
}

/** Adds the site layer tests to the merged results of runAllTests (the previous definition runs first). */
const runAllTestsBeforeSiteLayer = runAllTests;
runAllTests = async function runAllTests() {
  const prev = await runAllTestsBeforeSiteLayer();
  const site = await runSiteLayerTests();
  TestHelp.merged('site layer', site);
  const all = [...prev.results, ...site];
  const failed = all.filter((r) => !r.ok);
  window.__midriseTestResults = { total: all.length, passed: all.length - failed.length, failed, results: all };
  return window.__midriseTestResults;
};
