
/* ==========================================================================
   Start-up and test hook
   ========================================================================== */
const TEST_MODE = /[?&]test\b/.test(location.search);
Options.init({ restore: !TEST_MODE });
UI.init();
Compare.init();
Options.syncDirty();
if (!Render.init(document.getElementById('canvasHost'))) Store.subscribe(() => UI.updateHud(Derived.get()));

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
  runTests,
};
if (TEST_MODE) {
  runTests().then((r) => {
    const msg = r.failed.length
      ? `Tests: ${r.failed.length} of ${r.total} failed. ${r.failed.map((f) => `${f.name} (${f.detail})`).join(' | ')}`
      : `Tests: all ${r.total} passed`;
    Toast.show(msg, r.failed.length ? 'bad' : 'test-pass', 0);
  });
}
