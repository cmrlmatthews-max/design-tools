
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
SunUI.init();          // 08d_sun.js: the study driver (before the project loads, so a loaded sun section drives it)
ProjectUI.start();     // 09b_project.js: ?project= load and autosave

const optionInfo = (o) => ({ id: o.id, name: o.name, updatedAt: o.updatedAt });
window.__tower = {
  getState: () => Store.snapshot(),
  setState: (path, value) => { Store.set(path, value, { live: false }); },
  setStateLive: (path, value) => { Store.set(path, value, { live: true }); },
  commit: () => Store.commit(),
  replaceState: (state) => { Store.replace(fillDefaults(state)); },
  getPlates: () => Derived.get().plates,
  getMetrics: () => Derived.get().metrics,
  // extras for automated tests
  getWarnings: () => Derived.get().warnings,
  getFloors: () => Derived.get().floors,
  getEnvelope: () => {
    const d = Derived.get(), s = Store.raw();
    return {
      heightLimit: s.site.heightLimit,
      wireframe: d.wire,
      outside: d.plates.filter((p) => p.outsideEnvelopeArea > 0).map((p) => ({ n: p.n, area: p.outsideEnvelopeArea })),
      crownOutside: d.solidsOutside,
      warnings: d.warnings.filter((w) => ['height', 'setback', 'stepback', 'crown-height'].includes(w.id)),
      allowedAt: (z) => Env.allowedFootprint(s, z),
    };
  },
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
  // AI prompts: the panel, the filled text of a prompt (by id; `values` overrides auto or pick fields), the AI-ready picture
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
  sketchupDoc: () => SketchupExport.doc(),                   // the SketchUp export document for the design on screen
  // project file (ProjectUI, 09b_project.js; tests inject storage and navigation with projectConfigure)
  getDerivedSection: () => { const d = Derived.get(); return TowerDerivedMod.towerDerived(Store.snapshot(), d, d.metrics); },
  projectConfigure: (o) => ProjectUI.configure(o),
  projectReset: () => ProjectUI.reset(),
  projectOpenDoc: (doc) => ProjectUI.openDoc(doc),
  projectStatus: () => ProjectUI.status(),
  projectDoc: () => ProjectUI.doc(),
  projectFlush: () => { ProjectUI.markDirty(); return ProjectUI.flush(); },
  projectCreate: (name) => ProjectUI.create(name, { quiet: true }),
  projectClose: () => ProjectUI.close(),
  projectCenter: () => ProjectUI.centerOnSite({ quiet: true }),
  projectContext: (radius, opts) => ProjectUI.contextFromSite(radius, { quiet: true, ...(opts || {}) }),
  projectSend: (tool) => ProjectUI.send(tool),
  projectGroundAt: (x, y) => ProjectUI.groundAt(x, y),
  projectBoundary: () => ProjectUI.boundaryLocal(),
  projectAskReplace: () => ProjectUI.askReplace(),
  siteLayerInfo: () => SiteLayer.info(),
  // sun study (SunUI 08d_sun.js, SunLayer 06d_sunhours.js, SunStudy 10b_sunstudy.js)
  sunInfo: () => SunUI.info(),
  sunPlay: (on) => SunUI.play(on),
  sunComputeHours: (opts) => SunUI.compute(opts),
  sunCancelHours: () => SunUI.cancel(),
  sunHoursInfo: () => SunLayer.info(),
  shadowStudy: (opts) => SunStudy.make({ deliver: false, ...(opts || {}) }),
  // v1.1 layout hooks (the same functions the selection card calls)
  openItem: (item) => UI.openItem(item),
  setProgramForItems: (items, program) => UI.setProgramForItems(items, program),
  setTab: (id) => UI.setTab(id),
  getTab: () => UI.activeTab(),
  setSnap: (patch) => Store.set('view.snap', { ...(Store.get('view.snap') || {}), ...patch }, { live: false }),
  // v1.1 direct editing (the same functions the clicks, the selection card and the handles call)
  select: (items) => Select.select(items),
  getSelection: () => Select.get(),
  clearSelection: () => Select.clear(),
  copySegment: (index, where) => Select.copySegment(index, where),
  deleteSelection: () => Select.deleteSelection(),
  pickAt: (x, y) => Select.pickAt(x, y),                      // client px -> item | null
  screenPointFor: (item) => Select.screenPointFor(item),      // a client point where that item can be picked
  visibleHandles: () => Select.visibleHandles(),
  // Runs the handle-drag math without pointer events. ('move-x', dx) ('move-y', 0, dy) ('width', dx) ('depth', 0, dy) ('top', 0, dz);
  // opts { alt, hold }. hold keeps the drag open (guides and label stay) until releaseHandleDrag().
  simulateHandleDrag: (id, a, b, opts) => Select.simulateHandleDrag(id, a, b, opts),
  releaseHandleDrag: () => Select.releaseHandleDrag(),
  getDrag: () => ({ active: Select.dragging(), last: Select.lastDrag(), overlay: Select.overlayInfo(), orbit: Render.orbitEnabled() }),
};
if (TEST_MODE) {
  runAllTests().then((r) => {
    const msg = r.failed.length
      ? `Tests: ${r.failed.length} of ${r.total} failed. ${r.failed.map((f) => `${f.name} (${f.detail})`).join(' | ')}`
      : `Tests: all ${r.total} passed`;
    Toast.show(msg, r.failed.length ? 'bad' : 'test-pass', 0);
  });
}
