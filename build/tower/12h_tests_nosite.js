/* ==========================================================================
   TESTS: Unlimited site (site.shape 'none')
   The default design has no site line, no site checks and "—" for the site numbers; Rectangle brings them back;
   a preset keeps "no site"; old states keep their rectangle. runAllTests in 12b merges the results.
   The tests restore the design, the tab and the metrics card when they finish, and hold the autosave.
   ========================================================================== */
async function runNoSiteTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const $ = (id) => document.getElementById(id);
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const frames = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r())); };
  const savedState = Store.snapshot(), savedTab = UI.activeTab(), savedHud = UI.hudOpen();
  Options.holdAutosave(true);
  const siteSetSite = (shape) => Store.set('site.shape', shape, { live: false });
  const finite = (o) => !/NaN|Infinity/.test(JSON.stringify(o));
  /** True when some element of the Site and Height sections with exactly this text is on screen (a hidden section or control has no layout boxes). */
  const rowVisible = (label) => [...document.querySelectorAll('#tabpanel-site [data-section="site"] *, #tabpanel-site [data-section="height"] *')].some((e) => e.children.length === 0 && e.textContent.trim() === label && visible(e));

  try {
    /* ---- the state ---- */
    await t('the default design has an Unlimited site and no height limit; width, depth and setbacks stay for Rectangle', () => {
      const s = defaultState().site;
      return eq([s.shape, s.heightLimit, s.width, s.depth, s.setbacks.front, s.stepback.aboveHeight], ['none', 0, 250, 200, 10, 85]);
    });
    await t('a state with a site and no shape stays a rectangle; a state with no site is Unlimited; a polygon stays', () => {
      const old = fillDefaults({ site: { width: 200, depth: 100, setbacks: { front: 5, back: 5, left: 5, right: 5 }, heightLimit: 300 } });
      const poly = fillDefaults({ site: { shape: 'polygon', points: [[0, 0], [100, 0], [100, 80]] } });
      return eq([old.site.shape, old.site.width, old.site.heightLimit, fillDefaults({}).site.shape, poly.site.shape], ['rect', 200, 300, 'none', 'polygon']);
    });
    await t('every preset keeps its own site when it loads (rect, its numbers, its height limit)', () => {
      const bad = CONFIG.presets.filter((p) => JSON.stringify(fillDefaults(p.state).site) !== JSON.stringify(p.state.site)).map((p) => p.id);
      return eq(bad, []);
    });
    await t('sitePolygon is empty and siteArea is 0 with no site; Rectangle gives the ring and the area', () => {
      const s = defaultState();
      const a = [sitePolygon(s).length, siteArea(s)];
      s.site.shape = 'rect';
      return eq([a, sitePolygon(s).length, siteArea(s)], [[0, 0], 4, 50000]);
    });

    /* ---- numbers and warnings ---- */
    await t('no site: zero warnings on the default design, no red plates, and every metric is finite', () => {
      const d = computeDerived(defaultState());
      return eq([d.warnings.length, d.plates.some((p) => p.outsideEnvelopeArea > 0), d.metrics.hasSite, d.metrics.siteArea, d.metrics.far, d.metrics.siteCoverage, finite(d.metrics), d.wire.length],
        [0, false, false, 0, 0, 0, true, 0]);
    });
    await t('no site: a huge building has no setback, stepback or outside warning', () => {
      const s = defaultState(); s.segments[0].shape.w = 900; s.segments[0].shape.d = 900; s.site.stepback = { on: true, aboveHeight: 20, distance: 300 };
      const d = computeDerived(s);
      return eq([d.warnings.map((w) => w.id), d.plates.some((p) => p.outsideEnvelopeArea > 0)], [[], false]);
    });
    await t('no site: the height limit still works, and 0 means no limit', () => {
      const s = defaultState(); s.site.heightLimit = 55;
      const w = computeDerived(s).warnings.map((x) => x.id);
      s.site.heightLimit = 0;
      return eq([w.includes('height'), computeDerived(s).warnings.length], [true, 0]);
    });
    await t('switching to Rectangle brings back the setback check, FAR and coverage', () => {
      const s = defaultState(); s.segments[0].shape.w = 240; s.site.shape = 'rect';
      const d = computeDerived(s);
      return eq([d.warnings.some((w) => w.id === 'setback'), d.metrics.hasSite, d.metrics.siteArea, d.metrics.far > 0, d.metrics.siteCoverage > 0], [true, true, 50000, true, true]);
    });
    await t('Surround without a site goes around the building', () => {
      const b = surroundBlocks(defaultState());
      return eq([b.length, b.every((k) => finite(k))], [4, true]);
    });
    await t('the bounds without a site are the building plus a margin (framing, scale figure, sun grid)', () => {
      const d = computeDerived(defaultState());
      const { model, site } = d.bounds;
      return eq([site.minX < model.minX, site.maxX > model.maxX, site.minY < model.minY, site.maxY > model.maxY, finite(d.bounds)], [true, true, true, true, true]);
    });

    /* ---- exports ---- */
    await t('SketchUp export and the project derived section are valid with no site', () => {
      Store.replace(fillDefaults(defaultState()));
      const v = SkFmt.validateDoc(SketchupExport.doc());
      const derived = TowerDerivedMod.towerDerived(Store.snapshot(), Derived.get(), Derived.get().metrics);
      const doc = ProjectMod.writeSection(ProjectMod.newProject({ name: 'No site' }), 'massing', { tool: 'tower', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: Store.snapshot(), derived });
      const pv = ProjectMod.validate(doc);
      return (v.ok && pv.ok && finite(derived) && doc.sections.massing.state.site.shape === 'none') || `sketchup ${v.errors} project ${pv.errors}`;
    });
    /* ---- presets ---- */
    await t('a preset loaded while the site is Unlimited keeps no site and no height limit, with its other site numbers', () => {
      Store.replace(fillDefaults(defaultState()));
      Options.loadPreset('point-tower');
      const s = Store.raw().site;
      const a = [s.shape, s.heightLimit, s.width, s.depth, s.setbacks.left];
      siteSetSite('rect');
      return eq([a, Store.raw().site.width], [['none', 0, 150, 150, 10], 150]);
    });
    await t('a preset loaded over a Rectangle site brings its own site and height limit', () => {
      const s0 = fillDefaults(defaultState()); s0.site.shape = 'rect';
      Store.replace(s0);
      Options.loadPreset('point-tower');
      const s = Store.raw().site;
      return eq([s.shape, s.heightLimit, s.width], ['rect', 550, 150]);
    });

    /* ---- panel and metrics card ---- */
    await t('Site tab with Unlimited: the Shape control lists it, one help line shows, width, depth, corners, setbacks and stepback hide, the height limit stays', async () => {
      Store.replace(fillDefaults(defaultState()));
      UI.setTab('site');
      openSection('site'); openSection('height');          // every section starts collapsed
      await frames();
      const opts = [...document.querySelectorAll('#tabpanel-site select')[0].options].map((o) => o.textContent);
      const help = [...document.querySelectorAll('#tabpanel-site .help')].filter(visible).map((e) => e.textContent);
      const setbacks = document.querySelector('#tabpanel-site [data-section="setbacks"]');
      return eq([opts, help.includes('Unlimited: no site line, setbacks, or site checks. Pick Rectangle or Polygon to test a real site.'),
        rowVisible('Width'), rowVisible('Depth'), rowVisible('Site corners (x, y in feet)'), visible(setbacks), rowVisible('Height limit (0 = none)'), rowVisible('Stepback above a height')],
      [['Unlimited', 'Rectangle', 'Polygon'], true, false, false, false, false, true, false]);
    });
    await t('Site tab: picking Rectangle in the Shape control shows width, depth and setbacks; the numbers come back', async () => {
      const sel = document.querySelectorAll('#tabpanel-site select')[0];
      sel.value = 'rect'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await frames();
      const setbacks = document.querySelector('#tabpanel-site [data-section="setbacks"]');
      return eq([Store.get('site.shape'), rowVisible('Width'), rowVisible('Depth'), visible(setbacks), rowVisible('Stepback above a height')], ['rect', true, true, true, true]);
    });
    await t('Metrics card: "—" with a small "no site" for FAR, site area and coverage; Rectangle shows the numbers', () => {
      UI.setHudOpen(true);
      Store.replace(fillDefaults(defaultState()));
      UI.updateHud(Derived.get());
      const none = ['mFar', 'mSite', 'mCover'].map((id) => [$(id).firstChild.nodeValue, !!$(id).querySelector('small.nosite')]);
      siteSetSite('rect');
      UI.updateHud(Derived.get());
      const rect = ['mFar', 'mSite', 'mCover'].map((id) => [$(id).firstChild.nodeValue, !!$(id).querySelector('small.nosite')]);
      return eq([none, rect], [[['—', true], ['—', true], ['—', true]], [['2.00', false], ['50,000 sf', false], ['20.0%', false]]]);
    });
    await t('the default design shows "No warnings" in the card', () => {
      Store.replace(fillDefaults(defaultState()));
      UI.updateHud(Derived.get());
      return eq([$('warnCount').textContent, $('hudBadge').textContent], ['0', '0 warnings']);
    });

    /* ---- drawing ---- */
    if (Render.ready()) {
      await t('no site line is drawn and the envelope box is empty; Rectangle draws the site line and the envelope; back to Unlimited removes them', async () => {
        Store.replace(fillDefaults(defaultState()));
        await frames();
        const a = Render.info();
        siteSetSite('rect');
        await frames();
        const b = Render.info();
        siteSetSite('none');
        await frames();
        const c = Render.info();
        return eq([[a.siteLines, a.envelopeLines > 0], [b.siteLines, b.envelopeLines > 0], [c.siteLines, c.envelopeLines > 0]], [[0, false], [1, true], [0, false]]);
      });
    }
  } finally {
    Pop.close();
    Store.replace(savedState);
    UI.setTab(savedTab);
    UI.setHudOpen(savedHud);
    Options.holdAutosave(false);
  }
  console.log(`[tests] no site ${results.length - results.filter((r) => !r.ok).length}/${results.length} passed`, results.filter((r) => !r.ok).length ? JSON.stringify(results.filter((r) => !r.ok)) : '');
  return results;
}
