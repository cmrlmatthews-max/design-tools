/* ==========================================================================
   Start-up and test hook
   ========================================================================== */
const TEST_MODE = /[?&]test\b/.test(location.search);
Options.init({ restore: !TEST_MODE });
UI.init();
Prompts.init();
Compare.init();
Options.syncDirty();
if (!Render.init(document.getElementById('canvasHost'))) Store.subscribe(() => UI.updateHud(Derived.get()));
Select.init();
ProjectUI.start();
// A restored option may be saved in an elevation view: the camera starts there.
if (Render.ready() && Store.raw().view.elevation) Render.setView(Store.raw().view.elevation.toLowerCase(), false);

TopBar.init({ tool: 'facade', sections: () => UI.sectionCtl, remember: UI.rememberSection, onSite: () => Render.frameSite(), onBuilding: () => Render.frameBuilding() });   // 08z_topbar.js: Collapse all and the zoom buttons

const optionInfo = (o) => ({ id: o.id, name: o.name, updatedAt: o.updatedAt });
window.__facade = {
  getState: () => Store.snapshot(),
  setState: (path, value) => { Store.set(path, value, { live: false }); },
  setStateLive: (path, value) => { Store.set(path, value, { live: true }); },
  commit: () => Store.commit(),
  replaceState: (state) => { Store.replace(fillDefaults(state)); },
  getDerived: () => { const d = Derived.get(); return { ok: d.ok, hud: d.hud, warnings: d.warnings, street: d.street, groups: d.groups.map((g) => ({ id: g.id, zone: g.zone, orientation: g.orientation, length: g.length, levelFrom: g.levelFrom, levelTo: g.levelTo })) }; },
  getHud: () => Derived.get().hud,
  getMetrics: () => Derived.get().metrics,
  getWarnings: () => Derived.get().warnings,
  getGroups: () => Derived.get().groups,
  loadPreset: (id) => Options.loadPreset(id),
  newDesign: (opts) => Options.newDesign(opts),            // { confirm: false } skips the unsaved-changes question (tests)
  hasUnsavedChanges: () => Options.hasUnsavedChanges(),
  listPresets: () => CONFIG.presets.map((p) => ({ id: p.id, name: p.name })),
  listOptions: () => Options.list().map(optionInfo),
  saveOption: () => Options.save(),
  duplicateOption: () => Options.duplicate(),
  loadOption: (id) => Options.loadOption(id),
  compare: (keys) => Compare.enter(keys),
  exitCompare: () => Compare.exit(),
  getCompare: () => ({ active: Compare.isActive(), names: Compare.names(), chosen: Compare.chosen(), table: Compare.isActive() ? Compare.table() : '' }),
  screenshot: (opts) => Shots.capture(opts),
  openPrompts: () => Prompts.open(),
  closePrompts: () => Prompts.close(),
  getPromptText: (id, values) => Prompts.promptText(id, values),
  getPromptAuto: () => Prompts.currentAuto(),
  listPrompts: () => Prompts.allPrompts().map((p) => ({ id: p.id, group: p.group, title: p.title })),
  aiReadyScreenshot: () => Shots.aiReady({ deliver: false }),
  undo: () => Store.undo(),
  redo: () => Store.redo(),
  history: () => ({ depth: Store.historyDepth(), canUndo: !!Store.canUndo(), canRedo: !!Store.canRedo() }),
  setView: (id, animate = false) => Render.setView(id, animate),
  getView: () => Render.info(),
  units: Units,
  runTests: runAllTests,
  // exports
  sketchupDoc: () => SketchupExport.doc(),
  sketchupDownload: (opts) => SketchupExport.download(opts),
  dxfText: () => SketchupExport.dxfText(),
  dxfDownload: (opts) => SketchupExport.dxf(opts),
  exportJson: () => Options.exportJson(),
  importJson: (file) => Options.importFile(file),
  getDerivedSection: () => { const st = Store.snapshot(), d = Derived.get(); return FacDerivedMod.facadeDerived(st, d.built, d.metrics); },
  overlayInfo: () => Render.overlayInfo(),
  // project file (ProjectUI; tests inject storage and navigation with projectConfigure)
  projectConfigure: (o) => ProjectUI.configure(o),
  projectReset: () => ProjectUI.reset(),
  projectOpenDoc: (doc) => ProjectUI.openDoc(doc),
  projectStatus: () => ProjectUI.status(),
  projectDoc: () => ProjectUI.doc(),
  projectMassing: () => ProjectUI.massingInfo(),
  projectUseProject: () => ProjectUI.useProject({ quiet: true }),
  projectFlush: () => { ProjectUI.markDirty(); return ProjectUI.flush(); },
  projectCreate: (name) => ProjectUI.create(name, { quiet: true }),
  projectClose: () => ProjectUI.close(),
  // panels and selection (the same functions the clicks and the face card call)
  openItem: (item) => UI.openItem(item),
  setTab: (id) => UI.setTab(id),
  getTab: () => UI.activeTab(),
  select: (items) => Select.select(items),
  getSelection: () => Select.get(),
  clearSelection: () => Select.clear(),
  pickAt: (x, y) => Select.pickAt(x, y),                      // client px -> { kind: 'face', id } | null
  clickAt: (x, y) => Select.click(x, y),
  screenPointFor: (item) => Select.screenPointFor(item),      // a client point where that face can be picked
  toggleStreet: (id) => Select.toggleStreet(id),
  setStreetPick: (on) => UI.setStreetPick(on),
};
if (TEST_MODE) {
  runAllTests().then((r) => {
    document.getElementById('toasts').textContent = '';
    const msg = r.failed.length
      ? `Tests: ${r.failed.length} of ${r.total} failed. ${r.failed.map((f) => `${f.name} (${f.detail})`).join(' | ')}`
      : `Tests: all ${r.total} passed`;
    Toast.show(msg, r.failed.length ? 'bad' : 'test-pass', 0);
  });
}
