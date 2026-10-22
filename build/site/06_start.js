/* ==========================================================================
   Start-up and test hook
   ========================================================================== */
const TEST_MODE = /[?&]test\b/.test(location.search);
App.init();
Scene.init($('canvasHost'));
App.buildCompass();
App.startProject();                                  // with ?project=<id>: open that project and load its saved site

const removedIdsNow = () => [...App.state.removed].sort();

window.__site = {
  go: (text, size) => { if (text != null) $('addr').value = text; if (size) App.setSize(size); return App.go(); },
  state: () => App.state,
  info: () => Scene.info(),
  file: (kind) => App.fileFor(kind),
  /** The SketchUp document (cmrlm-design-tools/sketchup) for the current site, or null before a site is loaded. */
  sketchupDoc: () => (App.state.result ? App.sketchupDoc() : null),
  summary: () => (App.state.result ? ModelMod.summarize(App.state.result.model) : null),
  /** The open project (a document in memory), or null. */
  project: () => App.project.doc,
  timings: () => (App.state.result ? { ...App.state.result.timings, ui: App.state.result.uiMs } : null),
  steps: () => [...document.querySelectorAll('#steps li')].map((li) => ({ step: li.dataset.step, status: li.dataset.s, message: li.querySelector('.ms').textContent })),
  screenshot: () => App.screenshot({ deliver: false }),
  /** Removed buildings: the ids, the building under a screen point (client x, y), and the actions the card buttons call. */
  removed: () => removedIdsNow(),
  pick: (x, y) => Scene.pick(x, y),
  screenOf: (x, y, elev) => Scene.screenOf(x, y, elev),
  remove: (id) => App.removeBuilding(id),
  restore: (id) => App.restoreBuilding(id),
  restoreAll: () => App.restoreAll(),
  select: (id) => { const b = App.state.result && App.state.result.model.buildings.find((q) => q.id === id); App.selectHit(b ? { id, building: b } : null); },
  runTests: () => SiteTests.run(),
  /** Shows the synthetic test site (with trees, a pond and a courtyard building) in the 3D view. */
  loadSynthetic: () => {
    const d = SiteTests.synthetic(), m = ModelMod.buildModel(d.frame, { dem: d.dem, tiles: d.tiles });
    const [lon, lat] = d.frame.toLonLat(d.frame.size / 2, d.frame.size / 2);
    // a result on screen too (panel data, Send buttons, removed buildings), so the screenshots and hooks work without the network
    Object.assign(App.state, { result: { loc: { lat, lon, label: 'Test Address' }, frame: d.frame, model: m, release: 'test', failed: [], timings: {} }, typed: 'Test Address', removed: new Set(), removedKey: null, selected: null });
    Scene.setModel(m, []);
    $('emptyState').hidden = true;
    App.renderCard(); App.renderMetrics(); App.syncActions();
    return ModelMod.summarize(m);
  },
};

if (TEST_MODE) {
  SiteTests.run().then((r) => {
    window.__siteTestResults = r;
    SiteTests.show(r);
    const failed = r.filter((x) => !x.ok);
    Toast.show(failed.length ? `Tests: ${failed.length} of ${r.length} failed` : `Tests: all ${r.length} passed`, failed.length ? 'bad' : 'test-pass', 0);
  });
}
