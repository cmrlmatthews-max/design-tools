/* ==========================================================================
   Start-up and test hook
   ========================================================================== */
UI.init();
if (!Render.init($('canvasHost'))) { /* the numbers still work without WebGL */ }
ViewerProject.start();
TopBar.init({ tool: 'viewer', sections: () => ({}), remember: () => {}, onSite: () => Render.frameSite(), onBuilding: () => Render.frameBuilding() });

window.__viewer = {
  /** Shows a project document (read only). src: 'saved' (the Edit in links are on) or 'file' (in memory only). */
  loadDoc: (doc, src = 'saved') => ViewerProject.openDoc(doc, src),
  open: (id) => ViewerProject.open(id),
  close: () => ViewerProject.close(),
  list: () => ViewerProject.list(),
  importFile: (file) => ViewerProject.importFile(file),
  getState: () => ({ ...State.raw(), layers: { ...State.get('layers') } }),
  setLayer: (id, on) => State.setLayer(id, on),
  setMode: (m) => State.set('mode', m),
  setColorBy: (m) => State.set('colorBy', m),
  setSiteStyle: (m) => State.set('siteStyle', m),
  setCut: (key) => State.set('cutKey', key),
  setSun: (d, t) => State.setSun(d, t),
  levels: () => Model.levels(),
  layers: () => Model.layers(),
  summary: () => Model.rows(),
  stale: () => Model.stale(),
  hud: () => Model.hud(),
  setView: (id, animate = false) => Render.setView(id, animate),
  info: () => Render.info(),
  pickAt: (x, y) => Render.pickAt(x, y),
  clickAt: (x, y) => Render.click(x, y),
  screenOf: (x, y, z) => Render.screenOf(x, y, z),
  select: (item) => UI.select(item),
  card: () => UI.cardInfo(),
  setTab: (id) => UI.setTab(id),
  sketchupDoc: () => FileExports.sketchupDoc(),
  screenshot: (opts) => Shots.capture(opts),
  aiReadyScreenshot: () => Shots.aiReady({ deliver: false }),
  openPrompts: () => Prompts.open(),
  closePrompts: () => Prompts.close(),
  getPromptText: (id, v) => Prompts.promptText(id, v),
  runTests: runAllTests,
};

if (TEST_MODE) {
  runAllTests().then((r) => {
    $('toasts').textContent = '';
    const msg = r.failed.length
      ? `Tests: ${r.failed.length} of ${r.total} failed. ${r.failed.map((f) => `${f.name} (${f.detail})`).join(' | ')}`
      : `Tests: all ${r.total} passed`;
    Toast.show(msg, r.failed.length ? 'bad' : 'test-pass', 0);
  });
}
