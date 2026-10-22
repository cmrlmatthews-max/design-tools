/* ==========================================================================
   TESTS: Unlimited site (site.shape 'none')
   The default design has no site line, no site checks and "—" for the site numbers; Rectangle brings them back;
   templates and presets keep "no site"; old states keep their rectangle. runAllTests (12d) merges the results.
   The tests restore the design, the tab and the metrics card when they finish, and hold the autosave.
   ========================================================================== */
async function runNoSiteTests() {
  const { eq, make, $, frames, visible } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab(), savedHud = UI.hudOpen();
  Options.holdAutosave(true);
  const rulesSec = () => document.querySelector('#tabpanel-site [data-section="siterules"]');
  const rulesWasOpen = rulesSec().dataset.open === 'true';            // Zoning rules is closed by default: the tests open it and close it again
  const setShape = (shape) => Store.set('site.shape', shape, { live: false });
  const finite = (o) => !/NaN|Infinity/.test(JSON.stringify(o));
  const SITE_CODES = ['bar-outside-site', 'setback', 'stepback', 'density-cap', 'open-space'];
  /** True when some element of the Site-tab sections with exactly this text is on screen (a hidden section or control has no layout boxes). */
  const rowVisible = (label) => [...document.querySelectorAll('#tabpanel-site [data-section="site"] *, #tabpanel-site [data-section="height"] *, #tabpanel-site [data-section="siterules"] *')]
    .some((e) => e.children.length === 0 && e.textContent.trim() === label && visible(e));

  try {
    /* ---- the state ---- */
    await t('the default design has an Unlimited site; width, depth, setbacks and stepback stay for Rectangle', () => {
      const s = defaultState().site;
      return eq([s.shape, s.heightLimit, s.width, s.depth, s.setbacks.front, s.stepback.aboveHeight], ['none', 0, 360, 242, 20, 85]);
    });
    await t('a state with a site and no shape stays a rectangle; a state with no site is Unlimited; a polygon stays', () => {
      const old = fillDefaults({ site: { width: 300, depth: 200, setbacks: { front: 5, back: 5, left: 5, right: 5 } } });
      const poly = fillDefaults({ site: { shape: 'polygon', points: [[0, 0], [100, 0], [100, 80]] } });
      return eq([old.site.shape, old.site.width, fillDefaults({}).site.shape, poly.site.shape], ['rect', 300, 'none', 'polygon']);
    });
    await t('every preset keeps its own site when it loads', () => {
      const bad = CONFIG.presets.filter((p) => JSON.stringify(fillDefaults(p.state).site) !== JSON.stringify(p.state.site)).map((p) => p.id);
      return eq(bad, []);
    });
    await t('sitePolygon is empty and siteArea is 0 with no site; Rectangle gives the ring and the area', () => {
      const s = defaultState();
      const a = [sitePolygon(s).length, siteArea(s)];
      s.site.shape = 'rect';
      return eq([a, sitePolygon(s).length, siteArea(s)], [[0, 0], 4, 360 * 242]);
    });

    /* ---- numbers and warnings ---- */
    await t('no site: no site warning on the default design, no red plates, no envelope box, and every metric is finite', () => {
      const d = computeDerived(defaultState());
      return eq([d.warnings.filter((w) => SITE_CODES.includes(w.id)).length, d.plates.some((p) => p.outsideEnvelopeArea > 0), d.metrics.hasSite, d.metrics.siteArea, d.metrics.density, d.metrics.far, d.metrics.siteCoverage, finite(d.metrics), d.wire.length],
        [0, false, false, 0, 0, 0, 0, true, 0]);
    });
    await t('no site: a bar far outside the old site has no warning and is not red; the height limit still works', () => {
      const s = defaultState(); s.bars[0].length = 900; s.site.stepback = { on: true, aboveHeight: 20, distance: 300 }; s.site.densityCap = 5; s.site.openSpaceShare = 0.9;
      const d = computeDerived(s);
      const a = [d.warnings.filter((w) => SITE_CODES.includes(w.id)).length, d.plates.some((p) => p.outsideEnvelopeArea > 0)];
      s.site.heightLimit = 35;
      const h = computeDerived(s);
      return eq([a, h.warnings.some((w) => w.id === 'height'), h.plates.filter((p) => p.outsideEnvelopeArea > 1).map((p) => p.n)], [[0, false], true, [4, 5]]);
    });
    await t('no site: separation and courtyard checks stay', () => {
      const s = defaultState(); s.bars.push({ ...deepClone(s.bars[0]), id: 'B', name: 'Bar B', y: 75 });
      return eq(computeDerived(s).warnings.some((w) => w.id === 'separation'), true);
    });
    await t('switching to Rectangle brings back the site warning, density, FAR and coverage', () => {
      const s = defaultState(); s.bars[0].length = 340; s.site.shape = 'rect';
      const d = computeDerived(s);
      return eq([d.warnings.some((w) => w.id === 'bar-outside-site'), d.metrics.hasSite, d.metrics.siteArea, d.metrics.density > 0, d.metrics.far > 0, d.metrics.siteCoverage > 0], [true, true, 360 * 242, true, true, true]);
    });
    await t('Surround without a site goes around the bars', () => {
      const b = surroundBlocks(defaultState());
      return eq([b.length, finite(b)], [4, true]);
    });
    await t('the bounds without a site are the building plus a margin (framing, scale figure)', () => {
      const { model, site } = computeDerived(defaultState()).bounds;
      return eq([site.minX < model.minX, site.maxX > model.maxX, site.minY < model.minY, site.maxY > model.maxY], [true, true, true, true]);
    });

    /* ---- templates, presets, exports ---- */
    await t('a template keeps the Unlimited site (and Rectangle with a template still grows its site)', () => {
      Store.replace(fillDefaults(defaultState()));
      const next = Templates.apply('courtyard-U', { floors: 4 });
      const a = next && next.site.shape;
      Store.replace(fillDefaults(defaultState()));
      setShape('rect');
      return eq([a, Store.get('site.shape')], ['none', 'rect']);
    });
    await t('a preset loaded while the site is Unlimited keeps no site and no height limit, with its other site numbers', () => {
      Store.replace(fillDefaults(defaultState()));
      const p = CONFIG.presets[0];
      Options.loadPreset(p.id);
      const s = Store.raw().site;
      return eq([s.shape, s.heightLimit, s.width, s.setbacks.left], ['none', 0, p.state.site.width, p.state.site.setbacks.left]);
    });
    await t('a preset loaded over a Rectangle site brings its own site', () => {
      const s0 = fillDefaults(defaultState()); s0.site.shape = 'rect';
      Store.replace(s0);
      const p = CONFIG.presets[0];
      Options.loadPreset(p.id);
      return eq(Store.raw().site, fillDefaults(p.state).site);
    });
    await t('SketchUp export and the project derived section are valid with no site', () => {
      Store.replace(fillDefaults(defaultState()));
      const v = SkFmt.validateDoc(SketchupExport.doc());
      const st = Store.snapshot(), d = Derived.get();
      const derived = MidDerivedMod.midriseDerived(st, d.built, d.metrics);
      const doc = ProjectMod.writeSection(ProjectMod.newProject({ name: 'No site' }), 'massing', { tool: 'midrise', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: st, derived });
      const pv = ProjectMod.validate(doc);
      return (v.ok && pv.ok && finite(derived) && derived.metrics.far === 0 && derived.metrics.siteCoverage === 0 && doc.sections.massing.state.site.shape === 'none') || `sketchup ${v.errors} project ${pv.errors}`;
    });

    /* ---- panel and metrics card ---- */
    await t('Site tab with Unlimited: the Shape control lists it, one help line shows, width, depth, setbacks, stepback, density cap and open space hide; the height limit, separation and courtyard stay', async () => {
      Store.replace(fillDefaults(defaultState()));
      UI.setTab('site');
      if (rulesSec().dataset.open !== 'true') rulesSec().querySelector('.acc-head').click();
      await frames();
      const opts = [...document.querySelectorAll('#tabpanel-site select')[0].options].map((o) => o.textContent);
      const help = [...document.querySelectorAll('#tabpanel-site .help')].filter(visible).map((e) => e.textContent);
      const setbacks = document.querySelector('#tabpanel-site [data-section="setbacks"]');
      return eq([opts, help.includes('Unlimited: no site line, setbacks, or site checks. Pick Rectangle or Polygon to test a real site.'), help.includes('Site area sets density. Front is south.'),
        rowVisible('Width'), rowVisible('Depth'), visible(setbacks), rowVisible('Stepback above a height'), rowVisible('Open space share (0 = no rule)'), rowVisible('Density cap (units per acre, 0 = none)'),
        rowVisible('Height limit (0 = none)'), rowVisible('Separation between bars that do not join'), rowVisible('Smallest courtyard dimension')],
      [['Unlimited', 'Rectangle', 'Polygon'], true, false, false, false, false, false, false, false, true, true, true]);
    });
    await t('Site tab: picking Rectangle shows width, depth, setbacks, stepback, density cap and open space', async () => {
      const sel = document.querySelectorAll('#tabpanel-site select')[0];
      sel.value = 'rect'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await frames();
      const setbacks = document.querySelector('#tabpanel-site [data-section="setbacks"]');
      return eq([Store.get('site.shape'), rowVisible('Width'), rowVisible('Depth'), visible(setbacks), rowVisible('Stepback above a height'), rowVisible('Open space share (0 = no rule)'), rowVisible('Density cap (units per acre, 0 = none)')],
        ['rect', true, true, true, true, true, true]);
    });
    await t('Metrics card: density, FAR, site area, coverage and open space show "—" with "no site"; Rectangle shows the numbers', () => {
      UI.setHudOpen(true);
      Store.replace(fillDefaults(defaultState()));
      UI.updateHud(Derived.get());
      const note = (id) => !!$(id).querySelector('small.nosite');
      const none = [$('mDensity').firstChild.nodeValue, $('mDensitySub').textContent, ...['mFar', 'mSite', 'mCover', 'mOpen'].map((id) => [$(id).firstChild.nodeValue, note(id)])];
      setShape('rect');
      UI.updateHud(Derived.get());
      const rect = [$('mDensity').firstChild.nodeValue, $('mDensitySub').textContent, ...['mFar', 'mSite', 'mCover', 'mOpen'].map((id) => [$(id).firstChild.nodeValue, note(id)])];
      return eq([none, rect], [['—', 'no site', ['—', true], ['—', true], ['—', true], ['—', true]], ['50.0 /ac', '2.00 acres', ['1.12', false], ['87,120 sf', false], ['22.4%', false], ['29.4%', false]]]);
    });

    /* ---- drawing ---- */
    if (Render.ready()) {
      await t('no site line is drawn and the envelope box is empty; Rectangle draws the site line and the envelope; back to Unlimited removes them', async () => {
        Store.replace(fillDefaults(defaultState()));
        await frames(4);
        const a = Render.info();
        setShape('rect');
        await frames(4);
        const b = Render.info();
        setShape('none');
        await frames(4);
        const c = Render.info();
        return eq([[a.siteLines, a.envelopeLines > 0], [b.siteLines, b.envelopeLines > 0], [c.siteLines, c.envelopeLines > 0]], [[0, false], [1, true], [0, false]]);
      });
    }
  } finally {
    Pop.close();
    if (!rulesWasOpen && rulesSec().dataset.open === 'true') rulesSec().querySelector('.acc-head').click();
    Store.replace(savedState);
    UI.setTab(savedTab);
    UI.setHudOpen(savedHud);
    Options.holdAutosave(false);
  }
  TestHelp.merged('no site', results);
  return results;
}
