/* ==========================================================================
   TESTS
   Calculation tests. Run by adding ?test to the address. They cover the
   shell helpers, every hand-calculated case in src/tower/testcases.js
   (through the integrated pipeline), every preset, and the save / export /
   import round trip. The result toast appears in ?test mode only.
   ========================================================================== */
//@@MODULE testcases@@

async function runTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const near = (a, b, tol = 1e-9) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };

  /* ---- shell helpers ---- */
  await t('formatFeetInches 312.5', () => eq(Units.formatFeetInches(312.5), `312'-6"`));
  await t('formatFeetInches 0', () => eq(Units.formatFeetInches(0), `0'-0"`));
  await t('formatFeetInches rounds up to next foot', () => eq(Units.formatFeetInches(9.999), `10'-0"`));
  await t('formatArea 100000', () => eq(Units.formatArea(100000), '100,000 sf'));
  await t('parseLength 10\'-6"', () => near(Units.parseLength(`10'-6"`), 10.5));
  await t('parseLength 10.5', () => near(Units.parseLength('10.5'), 10.5));
  await t("parseLength 10'", () => near(Units.parseLength("10'"), 10));
  await t('parseLength 10 ft 6 in', () => near(Units.parseLength('10 ft 6 in'), 10.5));
  await t('parseLength 6"', () => near(Units.parseLength('6"'), 0.5));
  await t('parseLength 10-6', () => near(Units.parseLength('10-6'), 10.5));
  await t('parseLength bad input', () => eq(isNaN(Units.parseLength('abc')), true));
  await t('ringArea square', () => near(Geo.ringArea(siteRect(100, 100)), 10000));
  await t('default GFA', () => near(computeDerived(defaultState()).metrics.gfa, 100000));
  await t('default floor list', () => { const f = Geo.buildFloorList(defaultState()); return eq([f.length, f[0].z, f[9].z, f[9].t], [10, 0, 90, 1]); });
  await t('planToWorld north is -z', () => eq(planToWorld(3, 4, 5), [3, 5, -4]));
  await t('floor cap', () => { const s = defaultState(); s.segments[0].floors = 1000; return eq(Geo.buildPlates(s).plates.length, CONFIG.limits.maxFloors); });

  /* ---- integration decisions ---- */
  await t('unitFactor is a fraction or null in every program', () => {
    const bad = Object.entries(defaultState().programs).filter(([, p]) => !(p.unitFactor === null || (p.unitFactor > 0 && p.unitFactor <= 1)));
    return bad.length === 0 || `bad: ${bad.map(([k]) => k)}`;
  });
  await t('flat crown adds 0 height; stepped adds its height', () => {
    const s = defaultState(); s.crown = { type: 'flat', height: 20, steps: 3, slopeSide: 'front' };
    const flat = computeDerived(s).metrics.totalHeight;
    s.crown.type = 'stepped';
    return eq([flat, computeDerived(s).metrics.totalHeight], [100, 120]);
  });
  await t('floor count = podium + tower + mechanical', () => {
    const s = defaultState(); s.podium.on = true; s.podium.floors = 2; s.mechanical = [{ afterFloor: 5, ftf: 16 }];
    return eq(computeDerived(s).metrics.floorCount, 13);
  });
  await t('groupFloors and envelope describeFloors give the same text', () => {
    for (const a of [[5], [31, 32, 33, 34, 40], [1, 2, 3], [2, 4, 6], [10, 11, 20, 21, 22]]) if (Geo.groupFloors(a) !== Env.describeFloors(a)) return `differs for ${a}`;
    return true;
  });
  await t('warnings use grouped floors (height limit)', () => {
    const s = defaultState(); s.site.heightLimit = 55;
    const w = computeDerived(s).warnings.find((x) => x.id === 'height');
    return eq(w && w.text, 'Floors 6–10 exceed the height limit.');
  });
  await t('plates above the height limit count as outside (they turn red)', () => {
    const s = defaultState(); s.site.heightLimit = 55;
    const p = computeDerived(s).plates;
    return eq([p.filter((x) => x.outsideEnvelopeArea > 1).map((x) => x.n)], [[6, 7, 8, 9, 10]]);
  });
  await t('a plate that touches the allowed footprint exactly is inside', () => {
    const s = defaultState(); s.segments[0].shape.w = 230; s.segments[0].shape.d = 180;
    return eq(computeDerived(s).plates.filter((x) => x.outsideEnvelopeArea > 1).length, 0);
  });
  await t('a plate past the setback is outside and listed', () => {
    const s = defaultState(); s.segments[0].shape.w = 240;
    const d = computeDerived(s);
    return eq([d.plates.every((x) => x.outsideEnvelopeArea > 1), d.warnings.some((x) => x.id === 'setback')], [true, true]);
  });
  await t('draft build has the same area as the full build (circle)', () => {
    const s = defaultState(); s.segments[0].shape = { type: 'circle', w: 100, d: 100, radius: 0, points: [] };
    const full = Geo.buildPlates(s).plates[0].area, draft = Geo.buildPlates(s, { quality: 'draft' }).plates[0].area;
    return (hasCurves(s) && Math.abs(full - draft) / full < 1e-3) || `full ${full} draft ${draft}`;
  });
  await t('Surround makes one block per side, outside the site', () => {
    const b = surroundBlocks(defaultState());
    return eq([b.length, b.every((k) => Math.abs(k.x) + k.w / 2 > 125 || Math.abs(k.y) + k.d / 2 > 100)], [4, true]);
  });
  await t('compare grid: 2 options landscape = 2 columns; 4 = 2 x 2', () => {
    const a = compareRects(2, 1000, 500, {}, 0), b = compareRects(4, 1000, 500, {}, 0);
    return eq([a.map((r) => [r.x, r.y, r.w, r.h]), b.map((r) => [r.x, r.y, r.w, r.h])],
      [[[0, 0, 500, 500], [500, 0, 500, 500]], [[0, 0, 500, 250], [500, 0, 500, 250], [0, 250, 500, 250], [500, 250, 500, 250]]]);
  });

  /* ---- every hand-calculated case, through the integrated pipeline ---- */
  for (const tc of TestCasesMod.TEST_CASES) {
    await t(`case ${tc.id}`, () => {
      const d = computeDerived(fillDefaults(tc.state));
      const e = tc.expect, tol = e.tolerancePct == null ? 0.01 : e.tolerancePct;
      const pct = (a, b) => (b === 0 ? Math.abs(a) : (Math.abs(a - b) / Math.abs(b)) * 100);
      const bad = [];
      if (e.gfa != null && pct(d.metrics.gfa, e.gfa) > tol) bad.push(`gfa ${d.metrics.gfa} vs ${e.gfa}`);
      if (e.floors != null && d.metrics.floorCount !== e.floors) bad.push(`floors ${d.metrics.floorCount} vs ${e.floors}`);
      if (e.height != null && pct(d.metrics.totalHeight, e.height) > tol) bad.push(`height ${d.metrics.totalHeight} vs ${e.height}`);
      return bad.length === 0 || bad.join('; ');
    });
  }

  /* ---- every preset loads with zero error warnings ---- */
  for (const p of CONFIG.presets) {
    await t(`preset ${p.id} loads with zero error-severity warnings`, () => {
      const s = fillDefaults(p.state); s.context.blocks = surroundBlocks(s);
      const d = computeDerived(s);
      const errors = d.warnings.filter((w) => w.level === 'error');
      return (errors.length === 0 && d.metrics.gfa > 0 && d.plates.length > 0) || `errors: ${errors.map((w) => w.text).join(' | ')} gfa ${d.metrics.gfa}`;
    });
  }

  /* ---- save, export, import ---- */
  const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  await t('autosave round trip', () => {
    const a = StorageMod.createStorage({ key: 'k', schema: 1, storage: memory(), debounceMs: 5 });
    const s = fillDefaults(CONFIG.presets[0].state);
    a.autosave(s); a.flush();
    return eq(a.loadAutosave(), s);
  });
  await t('export then import gives the same metrics', async () => {
    const a = StorageMod.createStorage({ key: 'k', schema: 1, storage: memory() });
    const originals = CONFIG.presets.map((p) => fillDefaults(p.state));
    originals.forEach((s, i) => a.save(s, `Preset ${i}`));
    const blob = a.exportAll();
    const b = StorageMod.createStorage({ key: 'k2', schema: 1, storage: memory() });
    const res = await b.importFile(new File([blob], 'x.json', { type: 'application/json' }));
    const imported = b.list().sort((x, y) => x.name.localeCompare(y.name));
    if (res.added !== originals.length) return `added ${res.added}`;
    for (let i = 0; i < originals.length; i++) {
      const g1 = computeDerived(originals[i]).metrics.gfa, g2 = computeDerived(fillDefaults(imported[i].state)).metrics.gfa;
      if (Math.abs(g1 - g2) > 1e-6) return `option ${i}: ${g1} vs ${g2}`;
    }
    return true;
  });
  await t('import appends and renames duplicates', async () => {
    const a = StorageMod.createStorage({ key: 'k', schema: 1, storage: memory() });
    a.save(defaultState(), 'Same');
    const res = await a.importFile(new File([a.exportAll()], 'x.json'));
    return eq([res.added, a.list().map((o) => o.name).sort()], [1, ['Same', 'Same (2)']]);
  });

  /* ---- screenshot ---- */
  if (Render.ready()) {
    await t('screenshot capture returns a PNG blob', async () => {
      const blob = await Shots.capture({ scale: 1 });
      return (blob.type === 'image/png' && blob.size > 2000) || `type ${blob.type} size ${blob.size}`;
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`[tests] ${results.length - failed.length}/${results.length} passed`, failed.length ? JSON.stringify(failed) : '');
  window.__towerTestResults = { total: results.length, passed: results.length - failed.length, failed, results };
  return window.__towerTestResults;
}
