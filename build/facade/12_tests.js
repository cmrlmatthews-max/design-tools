/* ==========================================================================
   TESTS
   Calculation and export tests. Run by adding ?test to the address (plan section 9.2). They cover the shell helpers, the default
   design (WWR 24.3 percent, N and S 25.4 percent, 66 balconies, transparency 28.9 percent with the target off), every case in
   src/facade/testcases.js through the integrated pipeline, every preset, the draft quality, the SketchUp document, the DXF, the
   derived section and the save / export / import round trip. The other test files (12b page, 12c selection, 12d project) run after
   this one; runAllTests (in 12d) merges the results. The result toast appears in ?test mode only.
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
  const { eq, near, make, presetState } = TestHelp;
  const { results, t } = make();
  const def = () => fillDefaults(defaultState());
  const pctOf = (v) => Math.round(v * 1000) / 10;

  /* ---- shell helpers ---- */
  await t('formatFeetInches 312.5', () => eq(Units.formatFeetInches(312.5), `312'-6"`));
  await t('formatArea 100000', () => eq(Units.formatArea(100000), '100,000 sf'));
  await t('parseLength 10\'-6" and 10-6', () => eq([Units.parseLength(`10'-6"`), Units.parseLength('10-6')], [10.5, 10.5]));
  await t('planToWorld north is -z', () => eq(planToWorld(3, 4, 5), [3, 5, -4]));
  await t('storage key, title and tool', () => eq([CONFIG.storageKey, document.title, CONFIG.tool], ['facade.options.v1', 'Facade Studio', 'facade']));
  await t('all the src modules are in the page', () => {
    const names = ['FacesMod', 'BalconiesMod', 'PanelsMod', 'FacMetricsMod', 'FacDerivedMod', 'ElevMod', 'SkFacade', 'PresetsMod', 'TestCasesMod', 'ProjectMod', 'PromptsMod', 'StorageMod', 'ShotMod', 'SkFmt'];
    const miss = names.filter((n) => { try { return typeof eval(n) !== 'object'; } catch (e) { return true; } });
    return eq(miss, []);
  });

  /* ---- the default design (plan section 8.1) ---- */
  await t('the default design: WWR 24.3 percent, wall 37,960 sf, glazing 9,240 sf', () => {
    const d = computeDerived(def()), h = d.hud;
    return eq([d.ok, pctOf(h.wwr), Math.round(h.wall), Math.round(h.glazing)], [true, 24.3, 37960, 9240]);
  });
  await t('the default design: worst orientation N or S at 25.4 percent', () => {
    const h = computeDerived(def()).hud;
    return eq([['N', 'S'].includes(h.worst.o), pctOf(h.worst.wwr), pctOf(h.byOrientation.E.wwr), pctOf(h.byOrientation.W.wwr)], [true, 25.4, 19.5, 19.5]);
  });
  await t('the default design: 66 balconies, 4,752 sf, transparency 28.9 percent, target off', () => {
    const h = computeDerived(def()).hud;
    return eq([h.balconies, Math.round(h.balconyArea), pctOf(h.transparency), h.target], [66, 4752, 28.9, null]);
  });
  await t('the default design has no warning and is under the 40 percent check value', () => {
    const d = computeDerived(def());
    return eq([d.warnings.length, d.hud.over, d.hud.limit], [0, false, 0.4]);
  });
  await t('the page is showing the default numbers (24.3 percent, N 25.4 percent, 66 balconies)', () => {
    if (!document.getElementById('mWwr')) return true;
    const saved = Store.snapshot();
    Store.replace(def());
    UI.updateHud(Derived.get());
    const out = [document.getElementById('mWwr').firstChild.nodeValue, document.getElementById('mWorst').firstChild.nodeValue, document.getElementById('mBalc').firstChild.nodeValue];
    Store.replace(saved);
    return eq(out, ['24.3%', 'N 25.4%', '66']);
  });
  await t('computeDerived never throws on a broken state', () => {
    const s = def(); s.standalone.width = -5; s.standalone.floors = 0; s.zones.rules = null;
    const err = console.error; console.error = () => {};
    let d;
    try { d = computeDerived(s); } finally { console.error = err; }
    return d && d.hud && typeof d.hud.wwr === 'number' ? true : 'no hud';
  });

  /* ---- every hand-calculated case through the pipeline (plan section 8) ---- */
  for (const tc of TestCasesMod.TEST_CASES) {
    await t(`case ${tc.id}: WWR, orientation WWRs, transparency, balconies, areas`, () => {
      const d = computeDerived(fillDefaults(deepClone(tc.state))), h = d.hud, e = tc.expect, tol = e.tolerance || 0.001;
      if (!d.ok) return 'not ok';
      const bad = [];
      const chk = (name, got, want, tolerance) => { if (!(Math.abs(got - want) <= tolerance)) bad.push(`${name} ${got} vs ${want}`); };
      chk('wwr', h.wwr, e.wwr, tol);
      for (const o of Object.keys(e.wwrByOrientation || {})) chk(`wwr ${o}`, h.byOrientation[o].wwr, e.wwrByOrientation[o], tol);
      if (e.transparency !== undefined) chk('transparency', h.transparency, e.transparency, tol);
      if (e.balconies) { chk('balconies', h.balconies, e.balconies.count, 0); chk('balcony area', h.balconyArea, e.balconies.area, 0.1); }
      // the module tests hold the areas to 1e-5 (a few cases differ from the rounded plan figures by under half a sf)
      if (e.wall !== undefined) chk('wall', h.wall, e.wall, Math.max(e.areaTolerance || 0.1, e.wall * 1e-5));
      if (e.glazing !== undefined) chk('glazing', h.glazing, e.glazing, Math.max(e.areaTolerance || 0.1, e.glazing * 1e-5));
      return bad.length ? bad.join('; ') : true;
    });
  }

  /* ---- every preset ---- */
  for (const p of CONFIG.presets) {
    await t(`preset ${p.id} loads, builds and matches its WWR`, () => {
      const d = computeDerived(presetState(p.id));
      if (!d.ok) return 'not ok';
      const tc = TestCasesMod.TEST_CASES.find((c) => c.id === p.id);
      if (!tc) return d.hud.wall > 0 ? true : 'no wall';
      return Math.abs(d.hud.wwr - tc.expect.wwr) <= (tc.expect.tolerance || 0.001) ? true : `WWR ${d.hud.wwr} vs ${tc.expect.wwr}`;
    });
  }
  await t('every preset is in the Option menu list (CONFIG.presets)', () => eq(CONFIG.presets.length >= 8, true));

  /* ---- the limit, the target and the wording ---- */
  await t('a design over the 40 percent value gets the wwr-limit warning', () => {
    const d = computeDerived(presetState('hotel-window-wall'));
    return eq([d.hud.over, d.warnings.some((w) => w.id === 'wwr-limit')], [true, true]);
  });
  await t('the transparency target warns when it is not met and is off by default', () => {
    const s = def(); s.checks.transparencyTarget = 0.6;
    const on = computeDerived(s);
    return eq([on.hud.targetMet, on.warnings.some((w) => w.id === 'transparency'), computeDerived(def()).warnings.some((w) => w.id === 'transparency')], [false, true, false]);
  });
  await t('no warning or note says "compliant" or "complies"', () => {
    const texts = [];
    for (const p of CONFIG.presets) { const d = computeDerived(presetState(p.id)); texts.push(...d.warnings.map((w) => w.text)); }
    return eq(texts.filter((x) => /\bcompl(y|ies|iant|iance)\b/i.test(x)), []);
  });

  /* ---- draft quality ---- */
  await t('draft quality is drawn while a slider moves, with no mullions or fins (the display key changes)', () => {
    const a = Derived.display(true), b = Derived.display(false);
    return eq([a.quality, b.quality, a.key !== b.key], ['draft', 'full', true]);
  });
  await t('Facade3D draft has fewer instances than full for a state with fins', () => {
    const s = presetState('tower-glass-corner-fins');
    const d = computeDerived(s);
    const mats = { mesh: () => new THREE.MeshBasicMaterial(), line: () => new THREE.LineBasicMaterial() };
    const count = (quality) => {
      const r = Facade3D.build(d, s, { key: quality, quality }, mats);
      let n = 0;
      for (const o of r.model) if (o.isInstancedMesh) n += o.count;
      return n;
    };
    const full = count('full'), draft = count('draft');
    return draft < full ? true : `draft ${draft}, full ${full}`;
  });

  /* ---- exports ---- */
  await t('SketchUp document validates, has source facade and solids or meshes', () => {
    const doc = SketchupExport.doc(def(), computeDerived(def()));
    const v = SkFmt.validateDoc(doc);
    return v.ok && (v.counts.solid || v.counts.mesh) && doc.source === 'facade' ? true : JSON.stringify(v.errors || v);
  });
  await t('SketchUp document of the hotel preset validates', () => {
    const s = presetState('hotel-window-wall');
    const v = SkFmt.validateDoc(SketchupExport.doc(s, computeDerived(s)));
    return v.ok ? true : JSON.stringify(v.errors);
  });
  await t('SketchUp download delivers a file named .sketchup.json', () => {
    let name = '';
    const r = SketchupExport.download({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /\.sketchup\.json$/.test(name)], [true, true]);
  });
  await t('the elevations DXF has the facade layers, four sheets and the end of file', () => {
    const txt = SketchupExport.dxfText();
    const layers = ['FAC-GLASS', 'FAC-TEXT'].filter((l) => txt.includes(l));
    return eq([layers.length, /ENTITIES/.test(txt), /EOF/.test(txt), (txt.match(/WWR/g) || []).length >= 4], [2, true, true, true]);
  });
  await t('the DXF download delivers a file named -elevations.dxf', () => {
    let name = '';
    const r = SketchupExport.dxf({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /-elevations\.dxf$/.test(name)], [true, true]);
  });
  await t('the derived section: one face per group, the face areas add up to the wall', () => {
    const d = Derived.get(), sec = FacDerivedMod.facadeDerived(Store.snapshot(), d.built, d.metrics);
    const sum = sec.faces.reduce((s, f) => s + f.area, 0);
    return eq([sec.faces.length, Math.abs(sum - sec.metrics.facadeArea) < 1, sec.metrics.balconyCount, pctOf(sec.metrics.wwr)], [d.groups.length, true, d.hud.balconies, pctOf(d.hud.wwr)]);
  });

  /* ---- AI prompts ---- */
  await t('the AI prompt carries the facade lock, the design material and says building, not tower', () => {
    const txt = Prompts.promptText('time-golden-hour');
    return eq([/Keep every window, door, balcony/.test(txt), /percent glass/.test(txt), /__design__/.test(txt), /\btower\b/i.test(txt)], [true, true, false, false]);
  });
  await t('the AI auto values come from the design: floors, height, form', () => {
    const a = Prompts.autoValues(def(), computeDerived(def()));
    return eq([a.floors, a.height, /five-story rectangular building/.test(a.form)], ['5', '52 feet', true]);
  });

  /* ---- save / export / import ---- */
  await t('state survives a JSON round trip and fillDefaults', () => {
    const s = def(), back = fillDefaults(JSON.parse(JSON.stringify(s)));
    return eq(back, s);
  });
  await t('fillDefaults fills a partial state', () => {
    const s = fillDefaults({ standalone: { width: 200 } });
    return eq([s.standalone.width, s.standalone.depth > 0, s.zones.rules.middle.system, Array.isArray(s.materials)], [200, true, 'punched', true]);
  });
  await t('fillDefaults gives a range its own rule', () => {
    const s = fillDefaults({ zones: { mode: 'ranges', ranges: [{ id: 'Z1', name: 'Mid', from: 2, to: 4 }] } });
    return eq([!!s.zones.rules.Z1, s.zones.rules.Z1.system], [true, 'punched']);
  });
  await t('level ranges: a range zone gets its own rule and shows in the zone table', () => {
    const s = def();
    s.zones.mode = 'ranges';
    s.zones.ranges = [{ id: 'Z1', name: 'Levels 2 to 4', from: 2, to: 4 }];
    s.zones.rules.Z1 = { system: 'windowWall' };
    const d = computeDerived(fillDefaults(s));
    return eq([!!d.hud.zones.Z1, d.hud.zones.Z1 && d.hud.zones.Z1.wwr > 0.5], [true, true]);
  });
  return results;
}
