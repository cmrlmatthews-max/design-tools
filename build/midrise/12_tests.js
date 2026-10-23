/* ==========================================================================
   TESTS
   Calculation and export tests. Run by adding ?test to the address (plan section 9.2). They cover the shell helpers,
   the default design (100 units, 52 ft), every hand-calculated case in src/midrise/testcases.js through the integrated
   pipeline, every preset, every template, the envelope marks, the SketchUp document, the derived section, and the save /
   export / import round trip. The other test files (12b UI, 12c selection and handles, 12d project) run after this one;
   runAllTests (in 12d) merges the results. The result toast appears in ?test mode only.
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
  /** One undo returns the state from before the action, and one redo puts the result back (the undo stack is capped, so this is checked by behavior). */
  const oneStep = (before) => { Store.undo(); const back = snap() === before; Store.redo(); return back; };
  const toastText = () => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join(' | ');
  const merged = (name, results) => {
    const bad = results.filter((r) => !r.ok);
    console.log(`[tests] ${name} ${results.length - bad.length}/${results.length} passed`, bad.length ? JSON.stringify(bad) : '');
  };
  /** Opens one panel section (every section starts collapsed: docs/site-base-style-technical-plan.md section 4.4). Does not touch the saved choice. */
  const openSection = (id) => { const c = UI.sectionCtl[id]; if (c && !c.isOpen()) c.setOpen(true); return !!c; };
  return { openSection, eq, near, within, make, $, frames, wait, visible, snap, oneStep, toastText, merged };
})();

const ENVELOPE_CODES = ['bar-outside-site', 'bar-over-court', 'separation', 'sliver', 'bend', 'courtyard', 'podium-shape', 'screen-height'];

async function runTests() {
  const { eq, near, within, make } = TestHelp;
  const { results, t } = make();

  /* ---- shell helpers ---- */
  await t('formatFeetInches 312.5', () => eq(Units.formatFeetInches(312.5), `312'-6"`));
  await t('formatFeetInches 0', () => eq(Units.formatFeetInches(0), `0'-0"`));
  await t('formatArea 100000', () => eq(Units.formatArea(100000), '100,000 sf'));
  await t('parseLength 10\'-6"', () => near(Units.parseLength(`10'-6"`), 10.5));
  await t('parseLength 10-6 and bad input', () => eq([Units.parseLength('10-6'), isNaN(Units.parseLength('abc'))], [10.5, true]));
  await t('planToWorld north is -z', () => eq(planToWorld(3, 4, 5), [3, 5, -4]));
  await t('storage key and title', () => eq([CONFIG.storageKey, document.title], ['midrise.options.v1', 'Mid-Rise Generator']));

  /* ---- the default design ---- */
  await t('the default design: 100 units, 52 ft, 5 floors, 120 of 125 stalls', () => {
    const d = computeDerived(defaultState()), m = d.metrics;
    return eq([m.units, m.height, m.floors, m.parking.provided, m.parking.required, m.gfa], [100, 52, 5, 120, 125, 97500]);
  });
  await t('the default design shows one parking warning and no geometry warning', () => {
    const d = computeDerived(defaultState());
    return eq(d.warnings.map((w) => w.id), ['parking-deficit']);
  });
  await t('the parking warning can be turned off (view.warnParking)', () => {
    const s = defaultState(); s.view.warnParking = false;
    return eq(computeDerived(s).warnings.length, 0);
  });
  await t('the page is showing the default numbers (units 100, height 52 ft)', () => {
    if (!Render.ready() && !document.getElementById('mUnits')) return true;
    const s = defaultState();
    const saved = Store.snapshot();
    Store.replace(s);
    UI.updateHud(Derived.get());
    const out = [document.getElementById('mUnits').textContent, document.getElementById('mHeight').firstChild.nodeValue];
    Store.replace(saved);
    return eq(out, ['100', `52'-0"`]);
  });
  await t('floor cap per bar', () => {
    const s = fillDefaults({ bars: [{ ...defaultBar('A'), floors: 1000 }] });
    return eq(s.bars[0].floors, CONFIG.limits.maxFloors);
  });
  await t('fillDefaults fills a partial state and keeps bar ids unique', () => {
    const s = fillDefaults({ bars: [{ id: 'A' }, { id: 'A' }, {}] });
    return eq([s.bars.length, new Set(s.bars.map((b) => b.id)).size, s.bars[1].length], [3, 3, 300]);
  });
  await t('programs: unitFactor is a fraction or null', () => {
    const bad = Object.entries(defaultState().programs).filter(([, p]) => !(p.unitFactor === null || (p.unitFactor > 0 && p.unitFactor <= 1)));
    return bad.length === 0 || `bad: ${bad.map(([k]) => k)}`;
  });

  /* ---- hand-calculated cases (src/midrise/testcases.js) ---- */
  for (const tc of TestCasesMod.TEST_CASES) {
    await t(`case ${tc.id}: units, parking, GFA${tc.expect.unionArea ? ', union area' : ''}`, () => {
      const d = computeDerived(fillDefaults(tc.state)), m = d.metrics, e = tc.expect, tol = e.tolerancePct == null ? 0.5 : e.tolerancePct;
      const checks = [
        ['units', m.units, e.units], ['parkingRequired', m.parking.required, e.parkingRequired],
        ['parkingProvided', m.parking.provided, e.parkingProvided], ['gfa', m.gfa, e.gfa],
      ];
      if (e.unionArea) {
        const lv = d.built.levels.find((l) => l.zone === 'bar');
        checks.push(['unionArea', lv ? BarsMod.multiPolyArea(lv.plates) : NaN, e.unionArea]);
      }
      for (const [name, got, want] of checks) { const r = within(got, want, tol); if (r !== true) return `${name}: ${r}`; }
      return true;
    });
  }

  /* ---- presets ---- */
  await t('six presets exist with unique ids and names', () => {
    const ids = CONFIG.presets.map((p) => p.id), names = CONFIG.presets.map((p) => p.name);
    return eq([ids.length, new Set(ids).size, new Set(names).size], [6, 6, 6]);
  });
  for (const p of CONFIG.presets) {
    await t(`preset ${p.id} loads and builds with no geometry warning`, () => {
      const s = fillDefaults(p.state), d = computeDerived(s);
      const bad = d.warnings.filter((w) => ENVELOPE_CODES.includes(w.id));
      return (d.built.levels.length > 0 && d.metrics.units > 0 && bad.length === 0) || `levels ${d.built.levels.length} units ${d.metrics.units} warnings ${bad.map((w) => w.id)}`;
    });
  }
  await t('every preset passes through Options.loadPreset as one undo step', () => {
    const saved = Store.snapshot();
    const out = [];
    for (const p of CONFIG.presets) {
      const before = TestHelp.snap();
      Options.loadPreset(p.id);
      out.push(Store.get('name') === p.name && TestHelp.oneStep(before));
    }
    Store.replace(saved);
    return out.every(Boolean) || `got ${out}`;
  });

  /* ---- templates ---- */
  await t('nine templates, each applied to the default design builds with only planned parking warnings (a too-small site grows)', () => {
    const saved = Store.snapshot();
    const types = Templates.types().map((x) => x.id);
    if (types.length !== 9) return `types ${types}`;
    let msg = true;
    for (const id of types) {
      Store.replace(fillDefaults(defaultState()));
      Templates.apply(id);
      const d = computeDerived(Store.raw());
      const bad = d.warnings.filter((w) => ENVELOPE_CODES.includes(w.id));
      if (!d.built.levels.length || bad.length) { msg = `${id}: levels ${d.built.levels.length}, ${bad.map((w) => `${w.id}: ${w.text}`)}`; break; }
    }
    Store.replace(saved);
    return msg;
  });
  await t('template options change the numbers (length, depth, floors, court size, deck size)', () => {
    const a = PresetsMod.templateState('bar', { length: 240, depth: 70, floors: 4 });
    const u = PresetsMod.templateState('courtyard-U', { courtW: 150, courtD: 100, floors: 6 });
    const w = PresetsMod.templateState('wrap', { deckW: 200, deckD: 100, deckLevels: 3 });
    return eq([a.bars[0].length, a.bars[0].depth, a.bars[0].floors, u.bars[0].floors, w.deck.w, w.deck.levels], [240, 70, 4, 6, 200, 3]);
  });
  await t('applying a template replaces the layout, keeps the site, the programs and the name, and is one undo step', () => {
    const saved = Store.snapshot();
    const s0 = fillDefaults({ ...defaultState(), name: 'Keep me' });
    s0.site.heightLimit = 90; s0.programs.residential.unitSize = 777;
    Store.replace(s0);
    const before = TestHelp.snap();
    const next = Templates.apply('courtyard-U', { floors: 4 });
    const ok = next && Store.get('bars').length === 3 && Store.get('courts').length === 1 && Store.get('type') === 'courtyard'
      && Store.get('site.heightLimit') === 90 && Store.get('programs.residential.unitSize') === 777 && Store.get('name') === 'Keep me' && TestHelp.oneStep(before);
    Store.replace(saved);
    return ok || 'the template did not apply as described';
  });

  /* ---- envelope marks ---- */
  await t('plates above the height limit count as outside (they turn red)', () => {
    const s = defaultState(); s.site.heightLimit = 35;
    const d = computeDerived(s);
    const out = d.plates.filter((p) => p.outsideEnvelopeArea > 1).map((p) => p.n);
    return eq(out, [4, 5]);
  });
  await t('a bar past the setback is outside and listed', () => {
    const s = defaultState(); s.site.shape = 'rect'; s.bars[0].length = 340;
    const d = computeDerived(s);
    return eq([d.plates.every((p) => p.outsideEnvelopeArea > 1), d.warnings.some((w) => w.id === 'bar-outside-site')], [true, true]);
  });
  await t('a roof screen adds its height; a parapet adds none', () => {
    const s = defaultState(); s.roof = { type: 'screen', height: 12 };
    const h1 = computeDerived(s).metrics.height; s.roof.type = 'parapet';
    return eq([h1, computeDerived(s).metrics.height], [64, 52]);
  });
  await t('the draft build has the same footprint area as the full build', () => {
    const s = defaultState();
    const full = computeGeometry(s, 'full'), draft = computeGeometry(s, 'draft');
    return within(draft.plates[0].area, full.plates[0].area, 0.5);
  });

  /* ---- exports ---- */
  await t('the SketchUp document validates for the default design and every preset', () => {
    for (const s of [defaultState(), ...CONFIG.presets.map((p) => fillDefaults(p.state))]) {
      const d = computeDerived(s);
      const v = SkFmt.validateDoc(SkMid.midriseToSketchup(s, d.built, d.metrics, { name: s.name }));
      if (!v.ok) return `${s.name}: ${v.errors.join('; ')}`;
    }
    return true;
  });
  await t('the SketchUp download builds a named blob and counts solids', () => {
    let got = null;
    const r = SketchupExport.download({ deliver: (blob, name) => { got = { type: blob.type, name, size: blob.size }; } });
    return (r.ok && got && got.size > 500 && /\.sketchup\.json$/.test(got.name) && r.counts.solid > 0) || `result ${JSON.stringify(r && { ok: r.ok, errors: r.errors })} got ${JSON.stringify(got)}`;
  });
  await t('the project derived section validates: 5 bar levels, rings clean, seeds present (preset wrap-deck has 5 + 5)', () => {
    const p = CONFIG.presets.find((x) => x.id === 'wrap-deck');
    const s = fillDefaults(p.state), d = computeDerived(s);
    const dv = MidDerivedMod.midriseDerived(s, d.built, d.metrics);
    const zones = dv.levels.reduce((a, l) => { a[l.zone] = (a[l.zone] || 0) + 1; return a; }, {});
    let doc = ProjectMod.newProject({ name: 'test' });
    doc = ProjectMod.writeSection(doc, 'massing', { tool: 'midrise', schema: 1, placement: { x: 10, y: 20, rotation: 0, baseZ: 5 }, state: s, derived: dv });
    const v = ProjectMod.validate(doc);
    const seeds = dv.levels.some((l) => (l.seeds || []).length > 0);
    return (v.ok && zones.bar === 5 && zones.deck === 5 && seeds) || `valid ${v.ok} ${v.errors} zones ${JSON.stringify(zones)} seeds ${seeds}`;
  });
  await t('derived metrics repeat the page metrics (units, height, floors)', () => {
    const s = defaultState(), d = computeDerived(s);
    const dv = MidDerivedMod.midriseDerived(s, d.built, d.metrics);
    return eq([dv.metrics.units, dv.metrics.height, dv.metrics.floors], [100, 52, 5]);
  });
  await t('export JSON then import JSON keeps the option and its metrics', async () => {
    const saved = Store.snapshot();
    const key = `__t${Date.now()}`;
    const mem = { data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } };
    const st = StorageMod.createStorage({ key, schema: CONFIG.schema, migrate: (x) => x, storage: mem });
    const s = fillDefaults(CONFIG.presets[3].state);
    const id = st.save(s, 'Round trip');
    const blob = st.exportAll();
    const mem2 = { data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } };
    const st2 = StorageMod.createStorage({ key, schema: CONFIG.schema, migrate: (x) => x, storage: mem2 });
    const res = await st2.importFile(blob);
    const back = st2.list()[0];
    const a = computeDerived(fillDefaults(back.state)).metrics, b = computeDerived(s).metrics;
    const ok = id && res.added === 1 && a.units === b.units && a.gfa === b.gfa && a.height === b.height && /^midrise-options-/.test(Options.storage.exportFilename());
    Store.replace(saved);
    return ok || 'the imported option differs';
  });

  await t('Hero render: the first prompt, no form lock; the hero text carries the numbers of the design and the chosen material', () => {
    const p0 = PromptsMod.PROMPTS[0];
    if (p0.id !== 'hero-render' || !p0.noLock) return `first prompt ${p0.id}`;
    const st = fillDefaults(PresetsMod.templateState('courtyard-U')), m = computeDerived(st).metrics;
    const hero = PromptsMod.heroFor('midrise', st, m);
    const text = PromptsMod.fillPrompt(p0, { hero, material: 'warm red-brown brick with tall windows set in deep reveals' });
    const checks = {
      opens: text.startsWith('Edit the attached massing model image'), sections: ['KEEP EXACTLY AS SHOWN', 'CONTEXT BUILDINGS — KEEP AS WHITE MODEL', 'GROUND PLANE — RENDER PHOTOREAL', 'LIGHT AND SKY'].every((x) => text.includes(x)),
      material: text.includes('The facade is warm red-brown brick with tall windows set in deep reveals.'), noTower: !/tower/i.test(text), clean: !/\[|\{\{/.test(text),
      floors: text.includes(`${m.floors}-story U-shaped`), height: text.includes(`${Math.round(m.height)} feet`), bars: /It has three bars/.test(text),
    };
    const bad = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
    return bad.length ? `failed: ${bad.join(', ')} | ${hero}` : true;
  });
  await t('Hero render in the panel: promptText fills the hero from the current design', () => {
    const text = Prompts.promptText('hero-render');
    const m = Derived.get().metrics;
    return eq([!!text && text.startsWith('Edit the attached massing model image'), text.includes(`${m.floors}-story`), text.includes(`${Math.round(m.height)} feet`), /\[|\{\{/.test(text), /tower/i.test(text)], [true, true, true, false, false]);
  });
  /* ---- screenshots ---- */
  if (Render.ready()) {
    await t('AI-ready capture returns a PNG and puts the scene back exactly', async () => {
      const before = JSON.stringify(Render.sceneFlags()), style = Store.get('view.style');
      const blob = await Shots.aiReady({ deliver: false, scale: 1 });
      const after = JSON.stringify(Render.sceneFlags());
      return (blob.type === 'image/png' && blob.size > 2000 && before === after && style === Store.get('view.style')) || `type ${blob.type} size ${blob.size} before ${before} after ${after}`;
    });
    await t('screenshot capture returns a PNG blob; key metrics are units, density, parking, height, GFA, FAR', async () => {
      const blob = await Shots.capture({ scale: 1 });
      const keys = Shots.keyMetrics(Derived.get()).map((x) => x[0]);
      return (blob.type === 'image/png' && blob.size > 2000 && JSON.stringify(keys) === JSON.stringify(['Units', 'Density', 'Parking', 'Height', 'GFA', 'FAR'])) || `type ${blob.type} size ${blob.size} keys ${keys}`;
    });
  }

  TestHelp.merged('calculation', results);
  return results;
}
