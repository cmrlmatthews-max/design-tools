/* ==========================================================================
   Start-up and test hook
   ========================================================================== */
const TEST_MODE = /[?&]test\b/.test(location.search);
App.init();
Scene.init($('canvasHost'));
App.buildCompass();
App.startProject();                                  // with ?project=<id>: open that project and load its saved site

// First-visit tip (build/shared/08x_tip.js): one short card the first time this tool opens. Never shows on ?test.
FirstTip.init({
  tool: "site",
  title: "Site Model",
  purpose: "The Site Model builds a 3D site from an address with public map data.",
  tries: ["Type an address in the panel.", "Select Go to load the site."],
  help: null,
});

window.__site = {
  firstTip: FirstTip,
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
  runTests: () => SiteTests.run().then(async (r) => [...r, ...(await SiteTipTests.run())]),
  /** Shows the synthetic test site (with trees, a pond and a courtyard building) in the 3D view. */
  loadSynthetic: () => { const d = SiteTests.synthetic(); const m = ModelMod.buildModel(d.frame, { dem: d.dem, tiles: d.tiles }); Scene.setModel(m); $('emptyState').hidden = true; return ModelMod.summarize(m); },
};

if (TEST_MODE) {
  SiteTests.run().then(async (base) => {
    const r = [...base, ...(await SiteTipTests.run())];     // 05b_tests_tip.js
    window.__siteTestResults = r;
    SiteTests.show(r);
    const failed = r.filter((x) => !x.ok);
    Toast.show(failed.length ? `Tests: ${failed.length} of ${r.length} failed` : `Tests: all ${r.length} passed`, failed.length ? 'bad' : 'test-pass', 0);
  });
}
