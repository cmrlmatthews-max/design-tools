/* ==========================================================================
   Start-up and test hook
   ========================================================================== */
const TEST_MODE = /[?&]test\b/.test(location.search);
Options.init({ restore: !TEST_MODE });
UI.init();
Compare.init();
Options.syncDirty();
if (!Render.init(document.getElementById('canvasHost'))) Store.subscribe(() => UI.updateHud(Derived.get()));
Select.init();
ProjectUI.start();

const optionInfo = (o) => ({ id: o.id, name: o.name, updatedAt: o.updatedAt });
window.__plate = {
  getState: () => Store.snapshot(),
  setState: (path, value) => { Store.set(path, value, { live: false }); },
  setStateLive: (path, value) => { Store.set(path, value, { live: true }); },
  commit: () => Store.commit(),
  replaceState: (state) => { Store.replace(fillDefaults(state)); },
  getDerived: () => { const d = Derived.get(); return { ok: d.ok, hud: d.hud, warnings: d.warnings, notes: d.notes, stale: d.stale, groups: d.groups.map((g) => ({ id: g.id, label: g.label, floors: g.floors })) }; },
  getHud: () => Derived.get().hud,
  getMetrics: () => Derived.get().metrics,
  getBuilt: () => Derived.get().built,
  getScene: () => Derived.get().scene,
  getWarnings: () => Derived.get().warnings,
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
  undo: () => Store.undo(),
  redo: () => Store.redo(),
  history: () => ({ depth: Store.historyDepth(), canUndo: !!Store.canUndo(), canRedo: !!Store.canRedo() }),
  setView: (id, animate = false) => Render.setView(id, animate),
  getView: () => Render.info(),
  units: Units,
  runTests: runAllTests,
  // exports
  sketchupDoc: () => FileExports.sketchupDoc(),
  sketchupDownload: (opts) => FileExports.sketchup(opts),
  roomsText: () => FileExports.roomsText(),
  roomsDownload: (opts) => FileExports.rooms(opts),
  dxfText: () => FileExports.dxfText(),
  dxfDownload: (opts) => FileExports.dxf(opts),
  notesText: () => FileExports.notesText(),
  notesDownload: (opts) => FileExports.notes(opts),
  exportJson: () => Options.exportJson(),
  importJson: (file) => Options.importFile(file),
  getDerivedSection: () => { const st = Store.snapshot(), d = Derived.get(); return PlateDerivedMod.platesDerived(st, d.built, d.metrics); },
  overlayInfo: () => Render.overlayInfo(),
  layerInfo: () => Render.layerInfo(),
  // project file (ProjectUI; tests inject storage and navigation with projectConfigure)
  projectConfigure: (o) => ProjectUI.configure(o),
  projectReset: () => ProjectUI.reset(),
  projectOpenDoc: (doc) => ProjectUI.openDoc(doc),
  projectStatus: () => ProjectUI.status(),
  projectDoc: () => ProjectUI.doc(),
  projectInfo: () => ProjectUI.massingInfo(),
  projectUseProject: () => ProjectUI.useProject({ quiet: true }),
  projectFlush: () => { ProjectUI.markDirty(); return ProjectUI.flush(); },
  projectCreate: (name) => ProjectUI.create(name, { quiet: true }),
  projectClose: () => ProjectUI.close(),
  projectSend: (toolId) => ProjectUI.send(toolId),
  // panels, selection, editing and drawing (the same functions the clicks and the keys call)
  setTab: (id) => UI.setTab(id),
  getTab: () => UI.activeTab(),
  select: (item) => Select.select(item),
  selectUnit: (k) => Select.selectUnit(k),
  getSelection: () => Select.get(),
  clearSelection: () => Select.clear(),
  pickAt: (x, y) => Select.pickAt(x, y),                      // client px -> { kind, id } | null
  clickAt: (x, y) => Select.click(x, y),
  screenOf: (x, y, z) => Select.screenOf(x, y, z),            // plan point -> client px
  startDraw: (kind, opts) => Select.startDraw(kind, opts),
  drawing: () => Select.drawing(),
  drawTap: (cx, cy, alt) => Select.drawTap(cx, cy, alt),
  drawPoint: (x, y) => Select.drawPoint(x, y),
  finishDraw: () => Select.finishDraw(),
  cancelDraw: () => Select.cancelDraw(),
  bays: () => Select.bays(),
  bayLimits: (i) => Select.bayLimits(i),
  moveBay: (i, delta, live) => Select.moveBay(i, delta, live),
  bayScreen: (i) => Select.bayScreen(i),
  toggleLock: (k) => Select.toggleLock(k),
  locks: () => Select.locks(),
  unlockAll: () => Select.unlockAll(),
  setUnitType: (k, id) => Select.setUnitType(k, id),
  refill: () => Select.refill(),
  addBlock: (target, rect) => Select.addBlock(target, rect),
  deleteBlock: (it) => Select.deleteBlock(it),
  setBlockRect: (it, rect, live) => Select.setBlockRect(it, rect, live),
  snapPoint: (p, o) => Select.snapPoint(p, o),
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
