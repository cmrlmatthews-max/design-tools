/* ==========================================================================
   TESTS
   Calculation and export tests. Run by adding ?test to the address (plan section 9.2). They cover the shell helpers, the default
   plate (17 units, NRSF 15,077.8 sf, efficiency 0.7732), every case in src/plate/testcases.js through the integrated pipeline (the six
   presets of plan section 8), the warning list, the SketchUp document, the rooms CSV, the DXF, the notes, the derived section and the
   save / export / import round trip. The other test files (12b page, 12c editing, 12d project) run after this one; runAllTests (in 12d)
   merges the results. The result toast appears in ?test mode only.
   ========================================================================== */
const TestHelp = (() => {
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const near = (a, b, tol = 1e-9) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b}`);
  const within = (a, b, tol) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b} (+/- ${tol})`);
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
  const cases = () => TestCasesMod.TEST_CASES;
  return { eq, near, within, make, $, frames, wait, visible, snap, oneStep, toastText, merged, presetState, cases };
})();

async function runTests() {
  const { eq, near, within, make, presetState } = TestHelp;
  const { results, t } = make();
  const def = () => fillDefaults(defaultState());

  /* ---- shell helpers ---- */
  await t('formatFeetInches 312.5', () => eq(Units.formatFeetInches(312.5), `312'-6"`));
  await t('formatArea 15078 and formatAreaDec 15077.8', () => eq([Units.formatArea(15077.8), Units.formatAreaDec(15077.8)], ['15,078 sf', '15,077.8 sf']));
  await t('parseLength 10\'-6" and 10-6', () => eq([Units.parseLength(`10'-6"`), Units.parseLength('10-6')], [10.5, 10.5]));
  await t('planToWorld north is -z', () => eq(planToWorld(3, 4, 5), [3, 5, -4]));
  await t('storage key, title and tool', () => eq([CONFIG.storageKey, document.title, CONFIG.tool], ['plate.options.v1', 'Plate Planner', 'plate']));
  await t('all the src modules are in the page', () => {
    const names = ['MixMod', 'LevelsMod', 'CorridorMod', 'FillMod', 'PlateMetricsMod', 'PlateDerivedMod', 'PlateExportsMod', 'SkPlate', 'PresetsMod', 'TestCasesMod', 'ProjectMod', 'StorageMod', 'ShotMod', 'SkFmt', 'TowerGeo'];
    const miss = names.filter((n) => { try { return typeof eval(n) !== 'object'; } catch (e) { return true; } });
    return eq(miss, []);
  });
  await t('geometry helpers: ring area, point in ring, nearest point on a segment, offset line', () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const off = offsetLine([[0, 0], [10, 0]], 2);
    return eq([ringArea(sq), pointInRing(5, 5, sq), pointInRing(15, 5, sq), nearestOnSeg(5, 3, [0, 0], [10, 0]).d, off[0][1], ringRect(sq)], [100, true, false, 3, 2, [0, 0, 10, 10]]);
  });

  /* ---- the default plate (plan section 8.1) ---- */
  await t('the default plate: 17 units, NRSF 15,077.8 sf, efficiency 0.7732 on the HUD numbers', () => {
    const d = computeDerived(def()), h = d.hud;
    return eq([d.ok, h.units, Math.abs(h.nrsf - 15077.8) <= 0.5, h.efficiency, h.gsf], [true, 17, true, 0.7732, 19500]);
  });
  await t('the default plate has no warning that blocks the fill', () => {
    const d = computeDerived(def());
    return eq([d.warnings.filter((w) => w.level === 'error').length, d.warnings.length === d.metrics.warnings.length], [0, true]);
  });
  await t('the page is showing the default numbers (17, 15,078 sf, 77.3%)', () => {
    if (!document.getElementById('mUnits')) return true;
    const saved = Store.snapshot();
    Store.replace(def());
    UI.updateHud(Derived.get());
    const out = ['mUnits', 'mNrsf', 'mEff'].map((id) => document.getElementById(id).textContent);
    Store.replace(saved);
    UI.updateHud(Derived.get());
    return eq(out, ['17', '15,078 sf', '77.3%']);
  });

  /* ---- every preset against its hand-calculated case (plan section 8) ---- */
  for (const c of TestHelp.cases()) {
    await t(`preset ${c.id}: ${c.expect.units || c.expect.keys} ${c.expect.keys ? 'keys' : 'units'}, NRSF ${c.expect.nrsf}, efficiency ${c.expect.efficiency}`, () => {
      const d = computeDerived(fillDefaults(deepClone(c.state)));
      if (!d.ok) return `build failed: ${d.warnings[0] && d.warnings[0].text}`;
      const h = d.hud, e = c.expect;
      const n = e.units || e.keys;
      const a = eq(h.units, n); if (a !== true) return `units ${a}`;
      const b = within(h.nrsf, e.nrsf, e.tolerance); if (b !== true) return `nrsf ${b}`;
      const f = within(h.efficiency, e.efficiency, e.efficiencyTolerance); if (f !== true) return `efficiency ${f}`;
      if (e.bays !== undefined) { const bb = eq(h.bays, e.bays); if (bb !== true) return `bays ${bb}`; }
      if (e.corners !== undefined) { const cc = eq(h.corners, e.corners); if (cc !== true) return `corners ${cc}`; }
      return true;
    });
    await t(`preset ${c.id}: the counts by type are inside the mix rule (each type within 1 of the reference)`, () => {
      const d = computeDerived(fillDefaults(deepClone(c.state)));
      if (!d.ok) return 'build failed';
      const by = {};
      for (const u of d.editing.units) by[u.type] = (by[u.type] || 0) + (c.state.mode === 'hotel' && u.accessible ? 0 : 1);
      const bad = Object.keys(c.expect.counts).filter((k) => Math.abs((by[k] || 0) - c.expect.counts[k]) > 1);
      return eq(bad, []);
    });
    await t(`preset ${c.id}: the area closes (no area-closure warning) and no fatal warning`, () => {
      const d = computeDerived(fillDefaults(deepClone(c.state)));
      return eq([d.ok, d.warnings.filter((w) => w.id === 'area-closure' || w.level === 'error').length], [true, 0]);
    });
  }
  await t('loading a preset through the Option menu code path puts its numbers on the page', () => {
    const saved = Store.snapshot();
    Options.loadPreset('l-plate-60-ft-arms');
    const h = Derived.get().hud;
    UI.updateHud(Derived.get());
    const out = [h.units, h.nrsf, document.getElementById('mUnits') ? document.getElementById('mUnits').textContent : '16'];
    Store.replace(saved);
    return eq(out, [16, 12816.5, '16']);
  });

  /* ---- the area rule (decision 5) ---- */
  await t('the area rule: a unit of the default plate spans the corridor face to the inside of the exterior wall', () => {
    const d = computeDerived(def());
    const L = d.editing;
    // the south run: the plate edge is y = -32.5, the exterior wall is 1.0 ft, the unit starts at y = -31.5; the corridor face is y = -2.835
    const south = L.units.filter((u) => Math.min(...u.outer.map((p) => p[1])) < -30);
    if (!south.length) return 'no south units';
    const u = south[0];
    const ys = u.outer.map((p) => p[1]);
    return eq([Math.min(...ys), Math.round(Math.max(...ys) * 1000) / 1000], [-31.5, -2.835]);
  });
  await t('the area rule text names the centerline, the corridor face and the inside face', () => {
    const txt = CONFIG.areaRule;
    return eq([/centerline of demising walls/.test(txt), /corridor face of the corridor wall/.test(txt), /inside face of the exterior wall/.test(txt)], [true, true, true]);
  });

  /* ---- mode and mix ---- */
  await t('switching to hotel mode gives keys and bays on the same plate', () => {
    const s = def(); s.mode = 'hotel';
    const d = computeDerived(s);
    return eq([d.ok, d.hud.units > 0, d.hud.bays >= d.hud.units], [true, true, true]);
  });
  await t('a share change moves the counts: 2BR 0.50 gives more 2BR than the default', () => {
    const a = computeDerived(def());
    const s = def(); s.mix.multifamily.find((x) => x.id === '2br').share = 0.5; s.mix.multifamily.find((x) => x.id === '1br').share = 0.25;
    const b = computeDerived(s);
    const n2 = (d) => d.editing.units.filter((u) => u.type === '2br').length;
    return eq(n2(b) > n2(a), true);
  });

  /* ---- exports ---- */
  await t('the SketchUp document has source "plate", a solid per unit, and validates', () => {
    const doc = FileExports.sketchupDoc();
    const v = SkFmt.validateDoc(doc);
    const only = v.errors.filter((e) => !/source/.test(String(e)));
    const sourceOk = !v.errors.some((e) => /source/.test(String(e)));
    window.__plateSketchupSourceAccepted = sourceOk;
    return eq([doc.source, only.length, v.counts.solid >= Derived.get().hud.units], ['plate', 0, true]);
  });
  await t('the SketchUp validator accepts source "plate" (needs the integrator edit in src/shared/sketchup-format.js)', () => eq(window.__plateSketchupSourceAccepted, true));
  await t('the SketchUp download delivers a .sketchup.json file', () => {
    let name = '';
    const r = FileExports.sketchup({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /\.sketchup\.json$/.test(name)], [true, true]);
  });
  await t('the rooms CSV has a header, the area rule and one row per unit', () => {
    const txt = FileExports.roomsText();
    const lines = txt.trim().split(/\r?\n/);
    const rows = lines.filter((l) => !l.startsWith('#') && !l.startsWith('level_index'));
    return eq([lines.some((l) => l.startsWith('level_index')), /area rule/i.test(txt), rows.length], [true, true, Derived.get().hud.units]);
  });
  await t('the rooms download delivers a file named -rooms.csv', () => {
    let name = '';
    const r = FileExports.rooms({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /-rooms\.csv$/.test(name)], [true, true]);
  });
  await t('the DXF has the plate layers, entities and EOF', () => {
    const txt = FileExports.dxfText();
    const layers = ['PLATE', 'UNIT-LINE', 'UNIT-AREA', 'CORRIDOR', 'CORE', 'STAIR'].filter((l) => txt.includes(l));
    return eq([layers.length, /ENTITIES/.test(txt), /EOF/.test(txt)], [6, true, true]);
  });
  await t('the DXF download delivers a file named -plates.dxf', () => {
    let name = '';
    const r = FileExports.dxf({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /-plates\.dxf$/.test(name)], [true, true]);
  });
  await t('the notes carry the area rule, the cautions and the NRSF; the download is .md', () => {
    let name = '';
    const r = FileExports.notes({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /\.md$/.test(name), /never says "compliant"/.test(r.text), /centerline/.test(r.text), /15,077\.8|15077\.8/.test(r.text)], [true, true, true, true, true]);
  });
  await t('the derived section: levels with units, a mix and the metrics the plan names', () => {
    const d = Derived.get(), sec = PlateDerivedMod.platesDerived(Store.snapshot(), d.built, d.metrics);
    return eq([sec.levels.length, sec.levels[0].units.length, sec.metrics.units, Math.abs(sec.metrics.nrsf - 15077.8) <= 0.5, sec.mix.reduce((s, m) => s + m.count, 0), sec.levels[0].units[0].id], [1, 17, 17, true, 17, '1-01']);
  });

  /* ---- save / export / import ---- */
  await t('state survives a JSON round trip and fillDefaults', () => {
    const s = def(), back = fillDefaults(JSON.parse(JSON.stringify(s)));
    return eq(back, s);
  });
  await t('fillDefaults fills a partial state and drops nothing the user typed', () => {
    const s = fillDefaults({ plate: { w: 180 }, mode: 'hotel', locks: [{ id: 'U-01', outer: [[0, 0], [10, 0], [10, 10]], type: 'king' }] });
    return eq([s.plate.w, s.plate.d, s.mode, s.locks.length, s.corridor.wall, s.mix.hotel.length], [180, 65, 'hotel', 1, 0.5, 3]);
  });
  await t('every preset survives fillDefaults unchanged', () => {
    const bad = CONFIG.presets.filter((p) => JSON.stringify(fillDefaults(deepClone(p.state))) !== JSON.stringify(fillDefaults(fillDefaults(deepClone(p.state))))).map((p) => p.id);
    return eq(bad, []);
  });
  return results;
}
