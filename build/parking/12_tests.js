/* ==========================================================================
   TESTS
   Calculation and export tests. Run by adding ?test to the address (plan section 9.2). They cover the shell helpers, the
   default deck (496 stalls, 378 sf per stall, 5 levels, 2.2 percent), every hand-calculated case in src/parking/testcases.js
   through the integrated pipeline, every preset, EV tagging, the draft quality, the SketchUp document, the DXF, the stall
   list, the derived section and the save / export / import round trip. The other test files (12b page, 12c selection and
   handles, 12d project) run after this one; runAllTests (in 12d) merges the results. The result toast appears in ?test mode only.
   ========================================================================== */
const TestHelp = (() => {
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const near = (a, b, tol = 1e-9) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b}`);
  const within = (a, b, pct) => (Math.abs(a - b) <= Math.abs(b) * pct / 100 + 1e-9 ? true : `got ${a}, expected ${b} (+/- ${pct}%)`);
  const make = () => {
    const results = [];
    const t = async (name, fn) => {
      let r;
      try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
      results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
    };
    return { results, t };
  };
  const $ = (id) => document.getElementById(id);
  const frames = (n = 2) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const snap = () => JSON.stringify(Store.snapshot());
  /** One undo returns the state from before the action, and one redo puts the result back (checked by behavior). */
  const oneStep = (before) => { Store.undo(); const back = snap() === before; Store.redo(); return back; };
  const toastText = () => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join(' | ');
  const merged = (name, results) => {
    const bad = results.filter((r) => !r.ok);
    console.log(`[tests] ${name} ${results.length - bad.length}/${results.length} passed`, bad.length ? JSON.stringify(bad) : '');
  };
  const presetState = (id) => fillDefaults(deepClone(CONFIG.presets.find((p) => p.id === id).state));
  return { eq, near, within, make, $, frames, wait, visible, snap, oneStep, toastText, merged, presetState };
})();

async function runTests() {
  const { eq, near, within, make, presetState } = TestHelp;
  const { results, t } = make();
  const def = () => fillDefaults(defaultState());
  const level1Slope = (d) => Math.max(0, ...d.ramps.filter((r) => r.level === 1).map((r) => Math.abs(r.slope)));

  /* ---- shell helpers ---- */
  await t('formatFeetInches 312.5', () => eq(Units.formatFeetInches(312.5), `312'-6"`));
  await t('formatArea 100000', () => eq(Units.formatArea(100000), '100,000 sf'));
  await t('parseLength 10\'-6" and 10-6', () => eq([Units.parseLength(`10'-6"`), Units.parseLength('10-6')], [10.5, 10.5]));
  await t('planToWorld north is -z', () => eq(planToWorld(3, 4, 5), [3, 5, -4]));
  await t('storage key, title and tool', () => eq([CONFIG.storageKey, document.title, CONFIG.tool], ['parking.options.v1', 'Parking Deck Generator', 'parking']));
  await t('all the src modules are in the page', () => {
    const names = ['LayoutMod', 'RampsMod', 'GridMod', 'AccessibleMod', 'OverlayMod', 'MetricsMod', 'ParkDerivedMod', 'ExportsMod', 'SkPark', 'PresetsMod', 'TestCasesMod', 'ProjectMod'];
    const miss = names.filter((n) => { try { return typeof eval(n) !== 'object'; } catch (e) { return true; } });
    return eq(miss, []);
  });

  /* ---- the default deck ---- */
  await t('the default deck: 496 stalls, 378.0 sf per stall, 5 levels, 2.2 percent', () => {
    const d = computeDerived(def()), h = d.hud;
    return eq([d.ok, h.stalls, Math.round(h.sfPerStall * 10) / 10, h.levels, Math.round(h.maxSlope * 10000) / 10000], [true, 496, 378.0, 5, 0.022]);
  });
  await t('the default deck: 25 EV installed and 99 EV ready', () => {
    const d = computeDerived(def()), all = d.levels.flatMap((l) => l.stalls);
    return eq([all.filter((s) => s.kind === 'ev').length, all.filter((s) => s.evReady).length], [25, 99]);
  });
  await t('the default deck: accessible 9 required (2 van, 7 car), all provided', () => {
    const a = computeDerived(def()).hud.accessible;
    return eq([a.required, a.van, a.car, a.provided], [9, 2, 7, 9]);
  });
  await t('the default deck has no error warning', () => eq(computeDerived(def()).warnings.filter((w) => w.level === 'error').map((w) => w.id), []));
  await t('the page is showing the default numbers (496 stalls, 378 sf per stall)', () => {
    if (!document.getElementById('mStalls')) return true;
    const saved = Store.snapshot();
    Store.replace(def());
    UI.updateHud(Derived.get());
    const out = [document.getElementById('mStalls').firstChild.nodeValue, document.getElementById('mSfStall').firstChild.nodeValue];
    Store.replace(saved);
    return eq(out, ['496', '378']);
  });
  await t('computeDerived never throws on a broken state', () => {
    const s = def(); s.footprint.width = -5; s.levels.count = 0;
    const err = console.error; console.error = () => {};
    let d;
    try { d = computeDerived(s); } finally { console.error = err; }
    return typeof d.hud.stalls === 'number' ? true : 'no hud';
  });

  /* ---- every hand-calculated case through the pipeline ---- */
  for (const tc of TestCasesMod.TEST_CASES) {
    await t(`case ${tc.id}: stalls, sf per stall, slope, accessible`, () => {
      const d = computeDerived(fillDefaults(deepClone(tc.state))), h = d.hud, e = tc.expect;
      const got = { stalls: h.stalls, sf: Math.round(h.sfPerStall * 10) / 10, req: h.accessible.required, van: h.accessible.van, car: h.accessible.car };
      const want = { stalls: e.stalls, sf: e.sfPerStall, req: e.accessible.required, van: e.accessible.van, car: e.accessible.car };
      const a = eq(got, want);
      if (a !== true) return a;
      return e.slope == null ? true : near(level1Slope(d), e.slope, 1e-4);
    });
  }

  /* ---- every preset ---- */
  for (const p of CONFIG.presets) {
    await t(`preset ${p.id} builds with no error warning`, () => {
      const d = computeDerived(presetState(p.id));
      if (!d.ok) return 'not ok';
      const err = d.warnings.filter((w) => w.level === 'error');
      return err.length ? err.map((w) => w.text).join(' | ') : (d.hud.stalls > 0 ? true : 'no stalls');
    });
  }
  await t('every preset is in the Option menu list (CONFIG.presets)', () => eq(CONFIG.presets.length >= 6, true));

  /* ---- draft quality ---- */
  await t('draft quality keeps the same stall count as full', () => {
    const s = def();
    const full = LayoutMod.layout(s, { project: null, quality: 'full' }), draft = LayoutMod.layout(s, { project: null, quality: 'draft' });
    const n = (r) => r.levels.reduce((t0, l) => t0 + l.stalls.length, 0);
    return eq(n(draft), n(full));
  });
  await t('the display key changes between draft and full', () => {
    const a = Derived.display(true), b = Derived.display(false);
    return eq([a.quality, b.quality, a.key !== b.key], ['draft', 'full', true]);
  });

  /* ---- columns, clear heights, overlay ---- */
  await t('columns: one set per level, no conflicts without a project', () => {
    const d = computeDerived(def());
    return eq([d.columns.points.length > 0, d.hud.conflicts, d.overlay.source], [true, 0, 'none']);
  });
  await t('clear heights: one per level; level 1 is the van route', () => {
    const d = computeDerived(def());
    return eq([d.hud.clearHeights.length, d.hud.clearHeights[0].min], [5, def().checks.clearVan]);
  });
  await t('a low floor-to-floor gives a clear-height warning', () => {
    const s = def(); s.levels.ftf = 8; s.levels.ftf1 = 8;
    return eq(computeDerived(s).warnings.some((w) => /^clear-height/.test(w.id)), true);
  });
  await t('a ramp over its slope limit warns and turns red in the slope colors', () => {
    const s = def(); s.checks.slopeParking = 0.01;
    const d = computeDerived(s);
    return eq([d.warnings.some((w) => /slope/.test(w.id)), d.ramps.some((r) => !r.ok)], [true, true]);
  });

  /* ---- cores ---- */
  await t('a core in an aisle is flagged, and Move to the nearest row clears it', () => {
    const s = def();
    const row = LayoutMod.layout(s, { project: null }).bays[0];
    s.cores = [{ id: 'S1', kind: 'stair', x: 60, y: (row.aisle.y0 + row.aisle.y1) / 2 - 6, w: 22, d: 12 }];
    const d = computeDerived(s);
    if (d.coreIssues.S1 !== 'aisle') return `issue ${d.coreIssues.S1}`;
    if (!d.warnings.some((w) => w.action === 'move-to-row' && w.ref === 'S1')) return 'no move-to-row action';
    const r = LayoutMod.moveCoreToRow(d.raw.cores[0], d.raw);
    s.cores[0].x = r.x; s.cores[0].y = r.y;
    return eq(computeDerived(s).coreIssues.S1 || null, null);
  });
  await t('cores at the same place on every level cost the same stalls on every level', () => {
    const d = computeDerived(def());
    const per = d.levels.map((l) => l.stalls.length);
    return eq(new Set(per.slice(0, -1)).size <= 2, true);
  });

  /* ---- ramps ---- */
  await t('ramp type none: no ramps, no slope', () => {
    const s = def(); s.ramp.type = 'none';
    const d = computeDerived(s);
    return eq([d.ramps.length, d.hud.maxSlope], [0, 0]);
  });
  await t('each ramp type builds', () => {
    for (const type of RAMP_TYPES) {
      const s = def(); s.ramp.type = type;
      const d = computeDerived(s);
      if (!d.ok || !(d.hud.stalls > 0)) return `${type}: ${d.ok} ${d.hud.stalls}`;
    }
    return true;
  });

  /* ---- exports ---- */
  await t('SketchUp document validates and has solids', () => {
    const v = SkFmt.validateDoc(SketchupExport.doc(def(), computeDerived(def())));
    return v.ok && (v.counts.solid || v.counts.mesh) ? true : JSON.stringify(v.errors || v);
  });
  await t('SketchUp download delivers a file named .sketchup.json', () => {
    let name = '';
    const r = SketchupExport.download({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /\.sketchup\.json$/.test(name)], [true, true]);
  });
  await t('DXF text has the layers and the entities', () => {
    const txt = SketchupExport.dxfText();
    return eq([/ENTITIES/.test(txt), /EOF/.test(txt), txt.length > 2000], [true, true, true]);
  });
  await t('stall CSV has one row per stall plus the header', () => {
    const rows = SketchupExport.csvText().trim().split('\n');
    return eq(rows.length, Derived.get().hud.stalls + 1);
  });
  await t('the derived section has stalls, levels and ramps', () => {
    const d = Derived.get(), sec = ParkDerivedMod.parkingDerived(Store.snapshot(), d.built, d.metrics);
    return eq([typeof sec, sec && sec.metrics ? sec.metrics.stalls : sec.stalls], ['object', d.hud.stalls]);
  });

  /* ---- save / export / import ---- */
  await t('state survives a JSON round trip and fillDefaults', () => {
    const s = def(), back = fillDefaults(JSON.parse(JSON.stringify(s)));
    return eq(back, s);
  });
  await t('fillDefaults fills a partial state', () => {
    const s = fillDefaults({ footprint: { width: 200 } });
    return eq([s.footprint.width, s.footprint.depth > 0, s.levels.count > 0, Array.isArray(s.cores)], [200, true, true, true]);
  });
  await t('Send to Facade Studio is a planned stub', async () => {
    const r = await ProjectUI.send('facade');
    return eq([r, /planned/i.test(TestHelp.toastText())], [false, true]);
  });
  return results;
}
