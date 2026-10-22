/* ==========================================================================
   TESTS
   Calculation and export tests. Run by adding ?test to the address (plan section 9.2). They cover the shell helpers, the default
   design (cut 330, fill 350, net +20 on the HUD, tallest wall 0), every case in src/grading/testcases.js through the integrated
   pipeline, every preset, the draft quality and the 2x refinement block, the warning list, the SketchUp document, the Revit CSV, the DXF,
   the notes, the derived section and the save / export / import round trip. The other test files (12b page, 12c drawing and selection,
   12d project) run after this one; runAllTests (in 12d) merges the results. The result toast appears in ?test mode only.
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
  const cases = () => TestCasesMod.TEST_CASES;
  return { eq, near, within, make, $, frames, wait, visible, snap, oneStep, toastText, merged, presetState, cases };
})();

async function runTests() {
  const { eq, near, make, presetState } = TestHelp;
  const { results, t } = make();
  const def = () => fillDefaults(defaultState());
  const close = (got, want, tol) => (Math.abs(got - want) <= tol ? true : `got ${got}, expected ${want} (+/- ${tol})`);

  /* ---- shell helpers ---- */
  await t('formatFeetInches 312.5', () => eq(Units.formatFeetInches(312.5), `312'-6"`));
  await t('formatArea 100000', () => eq(Units.formatArea(100000), '100,000 sf'));
  await t('formatCy10 rounds to 10 cy and formatElev has two places', () => eq([Units.formatCy10(325.1), Units.formatCy10(348.2), Units.formatElev(1000)], ['330 cy', '350 cy', '1,000.00']));
  await t('parseLength 10\'-6" and 10-6', () => eq([Units.parseLength(`10'-6"`), Units.parseLength('10-6')], [10.5, 10.5]));
  await t('planToWorld north is -z', () => eq(planToWorld(3, 4, 5), [3, 5, -4]));
  await t('storage key, title and tool', () => eq([CONFIG.storageKey, document.title, CONFIG.tool], ['grading.options.v1', 'Grading Sketch', 'grading']));
  await t('all the src modules are in the page', () => {
    const names = ['WallsMod', 'SurfaceMod', 'FeaturesMod', 'EarthMod', 'RoutesMod', 'ContoursMod', 'GradMetricsMod', 'GradDerivedMod', 'GradExportsMod', 'SkGrading', 'PresetsMod', 'TestCasesMod', 'ProjectMod', 'StorageMod', 'ShotMod', 'SkFmt', 'GeoMod', 'PromptsMod'];
    const miss = names.filter((n) => { try { return typeof eval(n) !== 'object'; } catch (e) { return true; } });
    return eq(miss, []);
  });
  await t('geometry helpers: ring area, point in ring, nearest point on a segment, offset line', () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const off = offsetLine([[0, 0], [10, 0]], 2);
    return eq([ringArea(sq), pointInRing(5, 5, sq), pointInRing(15, 5, sq), nearestOnSeg(5, 3, [0, 0], [10, 0]).d, off[0][1], compassOf(180)], [100, true, false, 3, 2, 'S']);
  });

  /* ---- the default design (plan section 8.1) ---- */
  await t('the default design: HUD cut 330, fill 350, net +20, tallest wall 0 (grid 325.1 and 348.2)', () => {
    const d = computeDerived(def()), h = d.hud;
    return eq([d.ok, h.cut, h.fill, h.net, h.wallMax, Math.round(h.cutCy * 10) / 10, Math.round(h.fillCy * 10) / 10], [true, 330, 350, 20, 0, 325.1, 348.2]);
  });
  await t('the default design has automatic walls on and none are needed; the warning list is the checks list only', () => {
    const d = computeDerived(def());
    return eq([d.built.walls.length, d.warnings.length, d.warnings.length === d.metrics.warnings.length], [0, 0, true]);
  });
  await t('the page is showing the default numbers (330 cy, 350 cy, +20 cy, 0 ft)', () => {
    if (!document.getElementById('mCut')) return true;
    const saved = Store.snapshot();
    Store.replace(def());
    UI.updateHud(Derived.get());
    const out = ['mCut', 'mFill', 'mNet', 'mWallMax'].map((id) => document.getElementById(id).textContent);
    Store.replace(saved);
    UI.updateHud(Derived.get());
    return eq(out, ['330 cy', '350 cy', '+20 cy', '0 ft']);
  });
  await t('computeDerived never throws on a broken state', () => {
    const s = def(); s.buildings = null; s.ground = null;
    const err = console.error; console.error = () => {};
    let d;
    try { d = computeDerived(s); } finally { console.error = err; }
    return d && d.hud && typeof d.hud.cut === 'number' && Array.isArray(d.warnings) ? true : 'no result';
  });

  /* ---- every hand-calculated case through the pipeline (plan section 8) ---- */
  for (const tc of TestHelp.cases()) {
    await t(`case ${tc.id}: pad tops, cut, fill, net, tallest wall`, () => {
      const d = computeDerived(fillDefaults(deepClone(tc.state))), h = d.hud, e = tc.expect;
      if (!d.ok) return 'not ok';
      const bad = [];
      const chk = (name, got, want, tolerance) => { if (!(Math.abs(got - want) <= tolerance)) bad.push(`${name} ${got} vs ${want}`); };
      const vt = e.volumeTolerance || 0.5, tol = e.tolerance || 0.01;
      (e.padTops || []).forEach((z, i) => chk(`pad top ${i + 1}`, d.metrics.tiers[i] ? d.metrics.tiers[i].padTop : NaN, z, tol));
      if (e.cutCy !== undefined) chk('cut', h.cutCy, e.cutCy, vt);
      if (e.fillCy !== undefined) chk('fill', h.fillCy, e.fillCy, vt);
      if (e.netCy !== undefined) chk('net', h.netCy, e.netCy, vt * 2);
      if (e.wallMax !== undefined) chk('tallest wall', h.wallMax, e.wallMax, tol);
      return bad.length ? bad.join('; ') : true;
    });
  }

  /* ---- every preset ---- */
  for (const p of CONFIG.presets) {
    await t(`preset ${p.id} loads and builds the same as its case`, () => {
      const d = computeDerived(presetState(p.id));
      if (!d.ok) return 'not ok';
      const tc = TestHelp.cases().find((c) => c.id === p.id);
      if (!tc) return true;
      return close(d.hud.cutCy, tc.expect.cutCy, tc.expect.volumeTolerance || 0.5);
    });
  }
  await t('seven presets are in the Option menu list (CONFIG.presets)', () => eq(CONFIG.presets.length, 7));

  /* ---- cautions and wording ---- */
  await t('no warning or note says "compliant" or "complies"', () => {
    const texts = [];
    for (const p of CONFIG.presets) { const d = computeDerived(presetState(p.id)); texts.push(...d.warnings.map((w) => w.text)); }
    texts.push(GradExportsMod.notesMarkdown(def(), Derived.get().built, Derived.get().metrics, {}));
    return eq(texts.filter((x) => /\bcompl(y|ies|iant|iance)\b/i.test(x.replace(/never says "compliant"/g, ''))), []);
  });
  await t('the podium preset flags its tall wall and the long bar flags its step', () => {
    const pod = computeDerived(presetState('podium-retail-street'));
    const three = presetState('long-bar-three-tiers'); three.maxStep = 3;
    const stepped = computeDerived(three);
    return eq([pod.warnings.some((w) => w.id === 'wall-height'), stepped.warnings.some((w) => w.id === 'step')], [true, true]);
  });

  /* ---- draft quality and the 2x refinement ---- */
  await t('draft quality uses one sub-cell and no refinement; full quality refines near the work', () => {
    const s = def();
    const full = computeDerived(s), draft = computeDerived(s, { quality: 'draft' });
    return eq([full.quality, draft.quality, !!full.refine, draft.refine, !!full.fine && full.fine.n === full.refine.m * 2 + 1, draft.hud.subdivide], ['full', 'draft', true, null, true, 1]);
  });
  await t('the refinement block meets the coarse grid: border midpoints are the neighbor averages (no crack)', () => {
    const d = computeDerived(def()), f = d.fine, N = f.n;
    let worst = 0;
    for (let a = 1; a < N - 1; a += 2) for (const b of [0, N - 1]) worst = Math.max(worst, Math.abs(f.z[b * N + a] - (f.z[b * N + a - 1] + f.z[b * N + a + 1]) / 2));
    for (let b = 1; b < N - 1; b += 2) for (const a of [0, N - 1]) worst = Math.max(worst, Math.abs(f.z[b * N + a] - (f.z[(b - 1) * N + a] + f.z[(b + 1) * N + a]) / 2));
    return worst < 1e-9 ? true : `worst gap ${worst}`;
  });
  await t('Derived.display() changes its key when the design changes and carries the quality', () => {
    const a = Derived.display();
    Store.set('buildings.0.padOffset', 6, { live: false });
    const b = Derived.display();
    Store.undo();
    return eq([a.key !== b.key, a.quality], [true, 'full']);
  });
  await t('Ground3D builds the ground, pads, walls and plan labels for the default design and a wall design', () => {
    const s = presetState('garden-falling-site'), d = computeDerived(s);
    const r = Ground3D.build(d, s, { key: 'x', quality: 'full' }, { clean: false });
    const kinds = new Set(r.model.map((o) => (o.userData.ground ? 'ground' : o.userData.wallKind ? 'wall' : o.userData.block ? 'block' : 'other')));
    return eq([kinds.has('ground'), kinds.has('wall'), kinds.has('block'), r.overlay.some((o) => o.userData.plan)], [true, true, true, true]);
  });

  /* ---- exports ---- */
  await t('SketchUp document validates, has source grading and solids or meshes', () => {
    const doc = FileExports.sketchupDoc(def());
    const v = SkFmt.validateDoc(doc);
    return v.ok && (v.counts.solid || v.counts.mesh) && doc.source === 'grading' ? true : JSON.stringify(v.errors || v);
  });
  await t('SketchUp document of the garden preset (walls, a lot) validates', () => {
    const s = presetState('garden-falling-site');
    const v = SkFmt.validateDoc(FileExports.sketchupDoc(s, computeDerived(s).built));
    return v.ok ? true : JSON.stringify(v.errors);
  });
  await t('SketchUp download delivers a file named .sketchup.json', () => {
    let name = '';
    const r = FileExports.sketchup({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /\.sketchup\.json$/.test(name)], [true, true]);
  });
  await t('the Revit CSV has one x, y, z row per grid node', () => {
    const d = Derived.get(), txt = FileExports.revitText(), rows = txt.trim().split('\n');
    return eq([rows.length, rows[0].split(',').length], [d.built.grid.n * d.built.grid.n, 3]);
  });
  await t('the Revit CSV download delivers a .csv file', () => {
    let name = '';
    const r = FileExports.revit({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /\.csv$/.test(name)], [true, true]);
  });
  await t('the contours DXF has the grading layers and the end of file', () => {
    const txt = FileExports.dxfText();
    const layers = ['GRD-EXIST-MINOR', 'GRD-PROP-MINOR', 'GRD-PAD'].filter((l) => txt.includes(l));
    return eq([layers.length, /ENTITIES/.test(txt), /EOF/.test(txt)], [3, true, true]);
  });
  await t('the DXF download delivers a file named -grading.dxf', () => {
    let name = '';
    const r = FileExports.dxf({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /-grading\.dxf$/.test(name)], [true, true]);
  });
  await t('the notes carry the cut and fill and the sketch caution; the download is .md', () => {
    let name = '';
    const r = FileExports.notes({ deliver: (blob, n) => { name = n; } });
    return eq([r.ok, /\.md$/.test(name), /never a grading plan/.test(r.text), /325\.1/.test(r.text)], [true, true, true, true]);
  });
  await t('the derived section: tiers with FFE, a ground grid, walls, and the metrics the plan names', () => {
    const d = Derived.get(), sec = GradDerivedMod.gradingDerived(Store.snapshot(), d.built, d.metrics);
    const g = sec.ground || {};
    return eq([Array.isArray(sec.ffe) && sec.ffe.length, g.n && g.points ? g.points.length === g.n * g.n : false, typeof sec.metrics.cutCy, Math.round(sec.metrics.cutCy * 10) / 10], [1, true, 'number', 325.1]);
  });

  /* ---- AI prompts ---- */
  await t('the AI prompt carries the grading lock, the design material and says building, not tower', () => {
    const txt = Prompts.promptText('time-golden-hour');
    return eq([/Keep the ground shape, the pads, the walls/.test(txt), /mown grass/.test(txt), /__design__/.test(txt), /\btower\b/i.test(txt), /facade/i.test(txt)], [true, true, false, false, false]);
  });
  await t('the AI auto values come from the design: site, tiers, ground', () => {
    const a = Prompts.autoValues(def(), computeDerived(def()));
    return eq([a.floors, /300 by 65 foot building/.test(a.form), /5.0 percent toward the south/.test(a.ground)], ['1', true, true]);
  });

  /* ---- save / export / import ---- */
  await t('state survives a JSON round trip and fillDefaults', () => {
    const s = def(), back = fillDefaults(JSON.parse(JSON.stringify(s)));
    return eq(back, s);
  });
  await t('fillDefaults fills a partial state and drops nothing the user typed', () => {
    const s = fillDefaults({ ground: { plane: { slope: 7 } }, buildings: [{ id: 'X', outer: [[0, 0], [10, 0], [10, 10], [0, 10]], tiers: [{ ffe: 995.5, length: 40 }] }] });
    return eq([s.ground.plane.slope, s.ground.plane.z0, s.buildings[0].tiers[0].ffe, s.buildings[0].tiers[0].length, s.limits.walk, s.view.contours.interval], [7, 1000, 995.5, 40, 0.05, 1]);
  });
  return results;
}
