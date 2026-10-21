/* ==========================================================================
   Start-up and test hook
   ========================================================================== */
const TEST_MODE = /[?&]test\b/.test(location.search);
App.init();
Scene.init($('canvasHost'));
App.buildCompass();

window.__site = {
  go: (text, size) => { if (text != null) $('addr').value = text; if (size) App.setSize(size); return App.go(); },
  state: () => App.state,
  info: () => Scene.info(),
  file: (kind) => App.fileFor(kind),
  summary: () => (App.state.result ? ModelMod.summarize(App.state.result.model) : null),
  timings: () => (App.state.result ? { ...App.state.result.timings, ui: App.state.result.uiMs } : null),
  steps: () => [...document.querySelectorAll('#steps li')].map((li) => ({ step: li.dataset.step, status: li.dataset.s, message: li.querySelector('.ms').textContent })),
  screenshot: () => App.screenshot({ deliver: false }),
  runTests: () => SiteTests.run(),
  /** Shows the synthetic test site (with trees, a pond and a courtyard building) in the 3D view. */
  loadSynthetic: () => { const d = SiteTests.synthetic(); const m = ModelMod.buildModel(d.frame, { dem: d.dem, tiles: d.tiles }); Scene.setModel(m); $('emptyState').hidden = true; return ModelMod.summarize(m); },
};

if (TEST_MODE) {
  SiteTests.run().then((r) => {
    window.__siteTestResults = r;
    SiteTests.show(r);
    const failed = r.filter((x) => !x.ok);
    Toast.show(failed.length ? `Tests: ${failed.length} of ${r.length} failed` : `Tests: all ${r.length} passed`, failed.length ? 'bad' : 'test-pass', 0);
  });
}
