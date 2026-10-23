/* ==========================================================================
   TESTS
   Calculation tests. Run by adding ?test to the address. They cover the
   shell helpers, every hand-calculated case in src/tower/testcases.js
   (through the integrated pipeline), every preset, and the save / export /
   import round trip. The result toast appears in ?test mode only.
   ========================================================================== */
//@@MODULE testcases@@

/** Opens one panel section (every section starts collapsed: docs/site-base-style-technical-plan.md section 4.4). Does not touch the saved choice. */
function openSection(id) { const c = UI.sectionCtl[id]; if (c && !c.isOpen()) c.setOpen(true); return !!c; }

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
    const s = defaultState(); s.site.shape = 'rect'; s.segments[0].shape.w = 230; s.segments[0].shape.d = 180;
    return eq(computeDerived(s).plates.filter((x) => x.outsideEnvelopeArea > 1).length, 0);
  });
  await t('a plate past the setback is outside and listed', () => {
    const s = defaultState(); s.site.shape = 'rect'; s.segments[0].shape.w = 240;
    const d = computeDerived(s);
    return eq([d.plates.every((x) => x.outsideEnvelopeArea > 1), d.warnings.some((x) => x.id === 'setback')], [true, true]);
  });
  await t('draft build has the same area as the full build (circle)', () => {
    const s = defaultState(); s.segments[0].shape = { type: 'circle', w: 100, d: 100, radius: 0, points: [] };
    const full = Geo.buildPlates(s).plates[0].area, draft = Geo.buildPlates(s, { quality: 'draft' }).plates[0].area;
    return (hasCurves(s) && Math.abs(full - draft) / full < 1e-3) || `full ${full} draft ${draft}`;
  });
  await t('Surround makes one block per side, outside the site', () => {
    const s = defaultState(); s.site.shape = 'rect';
    const b = surroundBlocks(s);
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

  /* ---- AI prompts ---- */
  const presetStates = CONFIG.presets.map((p) => fillDefaults(p.state));
  await t('every built-in prompt fills with no "[" or "{{" left (default design and every preset)', () => {
    const states = [fillDefaults(defaultState()), ...presetStates];
    for (const st of states) {
      const auto = Prompts.autoValues(st, computeDerived(st).metrics);
      for (const p of PromptsMod.PROMPTS) {
        const text = PromptsMod.fillPrompt(p, { ...auto, ...Object.fromEntries(Object.keys(PromptsMod.PROMPT_FIELDS).map((k) => [k, Prompts.valuesFor(p)[k]])) });
        if (text.includes('[') || text.includes('{{')) return `${p.id} (${st.name}) left a token: ${(text.match(/\[[^\]]*\]|\{\{[^}]*\}\}/) || [''])[0]}`;
        if (!p.noLock && !text.startsWith(PromptsMod.FORM_LOCK.slice(0, 20))) return `${p.id} does not start with the form lock`;      // the Hero render has its own opening (noLock)
      }
    }
    return true;
  });
  await t('the panel text for every built-in prompt matches getPromptText', () => {
    for (const p of PromptsMod.PROMPTS) { const x = Prompts.promptText(p.id); if (!x || x.includes('[') || x.includes('{{')) return `${p.id}: ${String(x).slice(0, 80)}`; }
    return eq(Prompts.promptText('no-such-prompt'), null);
  });
  await t('the form phrase is non-empty for every preset', () => {
    for (const st of presetStates) { const f = Prompts.formPhrase(st); if (!/^an? .+ tower with .+/.test(f)) return `${st.name}: "${f}"`; }
    return true;
  });
  await t('form phrase rules (shape, setbacks, twist, taper, sky garden, crown)', () => {
    const s = fillDefaults(defaultState());
    const out = [Prompts.formPhrase(s)];
    s.setbacks = [{ floor: 4, distance: 10, sides: ['front'] }, { floor: 7, distance: 10, sides: ['front'] }]; s.crown.type = 'stepped';
    out.push(Prompts.formPhrase(s));
    s.segments[0].shape.type = 'ellipse'; s.segments[0].twist.deg = 20; s.carves = [{ startFloor: 5, endFloor: 6, kind: 'full' }]; s.crown.type = 'spire';
    out.push(Prompts.formPhrase(s));
    s.segments[0].shape.type = 'L'; s.segments[0].twist.deg = 0; s.segments[0].taper.x = -10; s.setbacks = [s.setbacks[0]]; s.carves = []; s.crown.type = 'screen';
    out.push(Prompts.formPhrase(s));
    s.segments[0].shape.type = 'polygon'; s.segments[0].taper.x = 0; s.crown.type = 'sloped';
    out.push(Prompts.formPhrase(s));
    return eq(out, [
      'a rectangular tower with a flat roof',
      'a rectangular tower with two setbacks and a stepped crown',
      'a twisting elliptical tower with two setbacks, a sky garden and a spire',
      'a tapering L-shaped tower with one setback and a rooftop screen',
      'a custom-shaped tower with one setback and a sloped crown',
    ]);
  });
  await t('auto fields: floors, height, program of the tallest segment, podium', () => {
    const s = fillDefaults(defaultState());
    s.podium.on = true; s.podium.floors = 8;
    s.segments = [{ ...s.segments[0], floors: 5, program: 'retail' }, { ...s.segments[0], floors: 20, ftf: 10, program: 'hotel' }];
    const m = computeDerived(s).metrics, a = Prompts.autoValues(s, m);
    s.podium.on = false;
    return eq([a.floors, a.height, a.program, a.podium, Prompts.autoValues(s, computeDerived(s).metrics).podium],
      [String(m.floorCount), `${Math.round(m.totalHeight)} feet`, 'hotel', 'an 8-story podium', 'no podium']);
  });
  await t('Hero render: the first prompt, no form lock; the hero text carries the height, floors, twist (only when twisted) and the chosen material', () => {
    const p0 = PromptsMod.PROMPTS[0];
    if (p0.id !== 'hero-render' || p0.group !== 'hero' || !p0.noLock || PromptsMod.PROMPTS.filter((x) => x.id === 'hero-render').length !== 1) return `first prompt ${p0.id}`;
    const s = fillDefaults(defaultState());
    s.segments[0].twist.deg = 25; s.crown.type = 'stepped';
    const m = computeDerived(s).metrics;
    const fill = (st, mm, extra) => PromptsMod.fillPrompt(p0, { ...Prompts.autoValues(st, mm), hero: PromptsMod.heroFor('tower', st, mm), ...extra });
    const tw = fill(s, m);
    s.segments[0].twist.deg = 0;
    const flat = fill(s, computeDerived(s).metrics, { material: PromptsMod.PROMPT_FIELDS.material.options[7].value });
    const checks = {
      opens: tw.startsWith('Edit the attached massing model image'), noLock: !tw.includes('Turn the attached massing model'),
      twist: tw.includes('rotates slightly'), height: tw.includes(`${Math.round(m.totalHeight)} feet`), floors: tw.includes(`${m.floorCount} floors`), crown: tw.includes('stepped crown'),
      dusk: /photographed at dusk under a deep blue sky/.test(tw), fritted: tw.includes('The facade is white-fritted glass'), sections: ['KEEP EXACTLY AS SHOWN', 'HERO BUILDING — RENDER PHOTOREAL', 'CONTEXT BUILDINGS — KEEP AS WHITE MODEL', 'GROUND PLANE — RENDER PHOTOREAL', 'RULE', 'LIGHT AND SKY', 'CAMERA', 'DO NOT INCLUDE'].every((x) => tw.includes(x)),
      noTwist: !flat.includes('rotates slightly'), material: flat.includes('The facade is dark bronze anodized metal and glass in a crisp vertical grid.'),
      clean: !/\[|\{\{/.test(tw + flat), noContractions: !/\b(don't|doesn't|isn't|aren't|can't|it's)\b/i.test(tw),
    };
    const bad = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
    return bad.length ? `failed: ${bad.join(', ')}` : true;
  });
  await t('Hero render: taper adds its line only when the tower tapers; the time list has the Dusk option first', () => {
    const s = fillDefaults(defaultState()), m = computeDerived(s).metrics;
    const a = PromptsMod.heroFor('tower', s, m);
    s.segments[0].taper.x = -10;
    const b = PromptsMod.heroFor('tower', s, computeDerived(s).metrics);
    const t0 = PromptsMod.PROMPT_FIELDS.time.options[0];
    return eq([a.includes('Keep the taper'), b.includes('Keep the taper'), b.includes('tapering'), t0.label, PromptsMod.PROMPT_FIELDS.time.options.length], [false, true, true, 'Dusk, deep blue sky', 9]);
  });
  await t('Hero render in the panel: promptText fills the hero from the current design', () => {
    const s = fillDefaults(defaultState());
    s.segments[0].twist.deg = 25;
    Store.replace(s);
    const m = Derived.get().metrics, text = Prompts.promptText('hero-render');
    return eq([!!text && text.startsWith('Edit the attached massing model image'), text.includes('rotates slightly'), text.includes(`${Math.round(m.totalHeight)} feet`), /\[|\{\{/.test(text)], [true, true, true, false]);
  });
  await t('Hero render names the hero color: the amber volume is the hero, every white volume stays a white model, the avoid list names the tint', () => {
    const text = Prompts.promptText('hero-render');
    return eq([text.includes(`The hero building is the ${CONFIG.heroColorName} volume.`), CONFIG.heroColorName, text.includes('Every white volume stays a white model.'), text.includes(`any ${CONFIG.heroColorName} tint on the finished hero`), /\[|\{\{/.test(text)], [true, 'amber', true, true, false]);
  });
  await t('custom prompts: save, export, import (title collisions become "Title (2)"), remove', async () => {
    const a = StorageMod.createStorage({ key: 'k', schema: 1, storage: memory() });
    const rec = a.savePrompt({ title: 'Evening mood', template: 'A {{height}} tower at {{time}}.', uses: ['time'] });
    a.savePrompt({ title: 'Second', template: 'Second prompt', uses: [] });
    if (!rec || rec.group !== 'custom' || !rec.id) return `bad record ${JSON.stringify(rec)}`;
    const blob = a.exportAll();
    const payload = JSON.parse(await blob.text());
    if (!Array.isArray(payload.prompts) || payload.prompts.length !== 2) return `export has ${JSON.stringify(payload.prompts)}`;
    const fresh = StorageMod.createStorage({ key: 'k2', schema: 1, storage: memory() });
    const r1 = await fresh.importFile(new File([blob], 'x.json'));
    const back = fresh.listPrompts();
    if (r1.promptsAdded !== 2 || back.length !== 2) return `imported ${JSON.stringify(r1)}`;
    const same = (x, y) => x.title === y.title && x.template === y.template && JSON.stringify(x.uses) === JSON.stringify(y.uses) && x.group === 'custom';
    if (!same(back[0], rec) || !same(back[1], a.listPrompts()[1])) return `round trip differs: ${JSON.stringify(back)}`;
    const r2 = await fresh.importFile(new File([blob], 'x.json'));
    const titles = fresh.listPrompts().map((x) => x.title).sort();
    if (r2.promptsAdded !== 2 || JSON.stringify(titles) !== JSON.stringify(['Evening mood', 'Evening mood (2)', 'Second', 'Second (2)'])) return `titles ${titles}`;
    if (!fresh.removePrompt(back[0].id) || fresh.listPrompts().length !== 3) return 'remove failed';
    const mem = memory(), b1 = StorageMod.createStorage({ key: 'k3', schema: 1, storage: mem }); b1.savePrompt({ title: 'Kept', template: 'x', uses: ['season'] });
    b1.flush();
    return eq(StorageMod.createStorage({ key: 'k3', schema: 1, storage: mem }).listPrompts().map((x) => [x.title, x.uses]), [['Kept', ['season']]]);
  });
  await t('an export with no prompts has no "prompts" key (older files stay the same)', async () => {
    const a = StorageMod.createStorage({ key: 'k', schema: 1, storage: memory() });
    a.save(defaultState(), 'Only an option');
    return eq('prompts' in JSON.parse(await a.exportAll().text()), false);
  });
  await t('AI-ready filename', () => eq(ShotMod.screenshotFilename('Option A-ai-ready', new Date(2026, 9, 20)), 'option-a-ai-ready-2026-10-20.png'));

  /* ---- screenshot ---- */
  if (Render.ready()) {
    await t('AI-ready capture returns a PNG and puts the scene back exactly', async () => {
      const before = JSON.stringify(Render.sceneFlags()), style = Store.get('view.style');
      const blob = await Shots.aiReady({ deliver: false, scale: 1 });
      const after = JSON.stringify(Render.sceneFlags());
      return (blob.type === 'image/png' && blob.size > 2000 && before === after && style === Store.get('view.style')) || `type ${blob.type} size ${blob.size} before ${before} after ${after}`;
    });
    await t('screenshot capture returns a PNG blob', async () => {
      const blob = await Shots.capture({ scale: 1 });
      return (blob.type === 'image/png' && blob.size > 2000) || `type ${blob.type} size ${blob.size}`;
    });
  }

  /* ---- Sun Study mode (?study=sun, batch-fixes plan 3.1): the same page opened in a hidden frame ---- */
  await t('this page (no ?study) is the full Tower: four tabs, not in study mode, no data-study mark', () => eq([UI.studyMode, UI.tabs(), document.documentElement.getAttribute('data-study'), !!document.getElementById('tbEditTower')], [false, ['form', 'program', 'view', 'site'], null, false]));
  {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;border:0;opacity:0;pointer-events:none;z-index:-1';
    frame.src = `${location.pathname}?study=sun&project=study-test-none`;
    document.body.append(frame);
    let cw = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 20000) {
      try { cw = frame.contentWindow; if (cw && cw.__tower && cw.document.readyState === 'complete' && cw.document.getElementById('tbEditTower')) break; } catch (e) { /* not ready */ }
      cw = null;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
    const info = () => cw.__tower.studyInfo();
    const doc = () => cw.document;
    await t('Sun Study mode: the page loads with the study flag (UI.studyMode, data-study="sun")', () => cw ? eq([info().study, doc().documentElement.getAttribute('data-study')], [true, 'sun']) : 'the study page did not load');
    await t('Sun Study mode: the tab row shows View only (Form, Program, Site hidden) and View is the open tab', () => {
      const d = doc();
      const shown = [...d.querySelectorAll('#panelTabs .tab')].filter((b) => !b.hidden && b.offsetParent !== null).map((b) => b.dataset.tab);
      const hidden = [...d.querySelectorAll('#panelTabs .tab')].filter((b) => b.hidden || b.offsetParent === null).map((b) => b.dataset.tab);
      const refused = cw.__tower.setTab('form');
      return eq([shown, hidden, cw.__tower.getTab(), refused, info().tabs], [['view'], ['form', 'program', 'site'], 'view', false, ['view']]);
    });
    await t('Sun Study mode: the Sun section is open, Display and Context and envelope are collapsed', () => eq([info().open.sun, info().open.display, info().open.scene], [true, false, false]));
    await t('Sun Study mode: the Sun section offers Date and time controls and the shadow study sheet button', () => {
      const d = doc();
      return eq([!!d.querySelector('[data-sun="mode"]'), !!d.querySelector('[data-sun="sheet"]'), !!d.querySelector('[data-sun="compute"]')], [true, true, true]);
    });
    await t('Sun Study mode: the title reads "Tower Generator · Sun Study" (page and browser tab)', () => eq([doc().querySelector('.app-title').textContent, doc().title], ['Tower Generator · Sun Study', 'Tower Generator · Sun Study']));
    await t('Sun Study mode: no selection handles and no placement gizmo (a click on the model selects nothing)', () => {
      const d = doc();
      // a click on the middle of the model: with the selection off nothing gets selected
      const cv = d.querySelector('#canvasHost canvas');
      if (cv) {
        const r = cv.getBoundingClientRect();
        for (const type of ['pointerdown', 'pointerup']) {
          try { cv.dispatchEvent(new cw.PointerEvent(type, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 7, pointerType: 'mouse', bubbles: true })); } catch (e) { /* a synthetic pointer id has no capture */ }
        }
      }
      const sel = cw.__tower.getSelection().length;
      let hdl = 0;
      try { hdl = cw.__tower.visibleHandles().length; } catch (e) { hdl = 0; }
      const shownHdl = [...d.querySelectorAll('.hdl')].filter((e) => e.offsetParent !== null).length;
      return eq([shownHdl, hdl, sel, cw.__tower.placementGizmo.info().active, cw.__tower.placementGizmo.info().handles, d.getElementById('selection-card').hidden], [0, 0, 0, false, 0, true]);
    });
    await t('Sun Study mode: the Export menu keeps Image, AI-ready image, Shadow study sheet and Send to; it drops AI Prompts, SketchUp and the JSON files', () => {
      const d = doc();
      d.getElementById('btnExport').click();
      const ids = [...d.querySelectorAll('#exportMenu .pop-item')].map((b) => b.id);
      cw.__tower.closePop();
      const has = (id) => ids.includes(id);
      return eq([has('miImage'), has('miAiReady'), has('miShadowSheet'), has('miSendPlate'), has('miAiPrompts'), has('miSketchup'), has('miExportJson'), has('miImportJson')], [true, true, true, true, false, false, false, false]);
    });
    await t('Sun Study mode: the "Edit the tower" link opens the same address without ?study and keeps ?project=', () => {
      const a = doc().getElementById('tbEditTower');
      return eq([a && a.tagName, a && a.textContent.trim(), a && a.getAttribute('href')], ['A', 'Edit the tower', `${location.pathname}?project=study-test-none`]);
    });
    await t('Sun Study mode: the shadows draw with the stronger light (the boost is on while shadows are on)', () => (info().ready ? eq([info().boosted, info().light.sun, info().light.hemi], [true, 2.3, 1.1]) : true));
    frame.remove();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`[tests] ${results.length - failed.length}/${results.length} passed`, failed.length ? JSON.stringify(failed) : '');
  window.__towerTestResults = { total: results.length, passed: results.length - failed.length, failed, results };
  return window.__towerTestResults;
}
