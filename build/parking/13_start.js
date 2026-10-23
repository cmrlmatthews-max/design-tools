
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
PlacementGizmo.init({   // 06y_placement.js: drag the building to place it, turn it with the ring (a project must be open)
  enabled: () => Store.raw().source === 'standalone',   // a wrap or podium deck follows the massing
  bounds: () => Derived.get().bounds.model,
  path: 'placement',
  onCommit: () => {},
  locked: () => PinUI.pinned(),   // Pin placement: no drag and no ring while pinned
});
PinUI.init({ tool: 'parking', enabled: () => Store.raw().source === 'standalone' });   // 08y_pin.js: the Pin placement button (a wrap or podium deck follows the massing)
ProjectUI.start();

TopBar.init({ tool: 'parking', sections: () => UI.sectionCtl, remember: UI.rememberSection, onSite: () => Render.frameSite(), onBuilding: () => Render.frameBuilding() });   // 08z_topbar.js: Collapse all and the zoom buttons

const optionInfo = (o) => ({ id: o.id, name: o.name, updatedAt: o.updatedAt });
window.__parking = {
  placementGizmo: PlacementGizmo,
  getState: () => Store.snapshot(),
  setState: (path, value) => { Store.set(path, value, { live: false }); },
  setStateLive: (path, value) => { Store.set(path, value, { live: true }); },
  commit: () => Store.commit(),
  replaceState: (state) => { Store.replace(fillDefaults(state)); },
  getDerived: () => { const d = Derived.get(); return { ok: d.ok, hud: d.hud, warnings: d.warnings, coreIssues: d.coreIssues, cores: d.cores, frame: { W: d.frame.W, D: d.frame.D } }; },
  getHud: () => Derived.get().hud,
  getMetrics: () => Derived.get().metrics,
  getWarnings: () => Derived.get().warnings,
  getRamps: () => Derived.get().ramps,
  getStalls: () => Derived.get().levels.map((l) => l.stalls.length),
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
  csvText: () => SketchupExport.csvText(),
  exportJson: () => Options.exportJson(),
  importJson: (file) => Options.importFile(file),
  getDerivedSection: () => { const st = Store.snapshot(), d = Derived.get(); return ParkDerivedMod.parkingDerived(st, d.built, d.metrics); },
  overlayInfo: () => Render.overlayInfo(),
  // project file (ProjectUI; tests inject storage and navigation with projectConfigure)
  projectConfigure: (o) => ProjectUI.configure(o),
  projectReset: () => ProjectUI.reset(),
  projectOpenDoc: (doc) => ProjectUI.openDoc(doc),
  projectStatus: () => ProjectUI.status(),
  projectDoc: () => ProjectUI.doc(),
  projectSources: () => ProjectUI.sources(),
  projectUseSource: (source) => ProjectUI.useSource(source, { quiet: true }),
  projectFlush: () => { ProjectUI.markDirty(); return ProjectUI.flush(); },
  projectCreate: (name) => ProjectUI.create(name, { quiet: true }),
  projectClose: () => ProjectUI.close(),
  projectSend: (tool) => ProjectUI.send(tool),
  // panels, selection and handles (the same functions the clicks, the selection card and the handles call)
  openItem: (item) => UI.openItem(item),
  setTab: (id) => UI.setTab(id),
  getTab: () => UI.activeTab(),
  setSnap: (patch) => Store.set('view.snap', { ...(Store.get('view.snap') || {}), ...patch }, { live: false }),
  select: (items) => Select.select(items),
  getSelection: () => Select.get(),
  clearSelection: () => Select.clear(),
  deleteSelection: () => Select.deleteSelection(),
  pickAt: (x, y) => Select.pickAt(x, y),                      // client px -> item | null
  screenPointFor: (item) => Select.screenPointFor(item),      // a client point where that item can be picked
  visibleHandles: () => Select.visibleHandles(),
  // Runs the handle-drag math without pointer events. ('move-x', dx) ('move-y', 0, dy) ('slide', d) ('width', dw) ('depth', dd) ('length', dl)
  // ('rotate', angle); opts { alt, hold }. hold keeps the drag open (guides and label stay) until releaseHandleDrag().
  simulateHandleDrag: (id, a, b, opts) => Select.simulateHandleDrag(id, a, b, opts),
  releaseHandleDrag: () => Select.releaseHandleDrag(),
  getDrag: () => ({ active: Select.dragging(), last: Select.lastDrag(), overlay: Select.overlayInfo(), orbit: Render.orbitEnabled() }),
  moveCoreToRow: (id) => UI.moveCoreById(id),
};
if (TEST_MODE) {
  runAllTests().then((r) => {
    const msg = r.failed.length
      ? `Tests: ${r.failed.length} of ${r.total} failed. ${r.failed.map((f) => `${f.name} (${f.detail})`).join(' | ')}`
      : `Tests: all ${r.total} passed`;
    Toast.show(msg, r.failed.length ? 'bad' : 'test-pass', 0);
  });
}
