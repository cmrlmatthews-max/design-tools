/* ==========================================================================
   TESTS: base elevation follows the ground (docs/site-base-style-technical-plan.md section 1.5) - Parking Deck
   The base elevation is the lowest ground under the building footprint (Follow ground), or the typed value (Typed).
   Uses its own in-memory sloped site project (z = 1000 + 0.01 x + 0.02 y on an 11 x 11 grid), so a ?test visit never touches the
   saved projects. runAllTests is extended at the end of this file (no edit of the other test files needed).
   ========================================================================== */
const BaseFixture = (() => {
  const S = 1000, N = 11, SPACING = 100;
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  /** The ground by the rule the fixture grid was built with. */
  const groundAt = (x, y) => 1000 + 0.01 * Math.min(Math.max(x, 0), S) + 0.02 * Math.min(Math.max(y, 0), S);
  /** A 1000 ft site square with a sloping ground and one near building (base 1010, 40 ft high). */
  function siteDoc(withSite = true) {
    let doc = ProjectMod.newProject(withSite ? { name: 'Base fixture', frame: { kind: 'site', lat: 33.927, lon: -84.339, size: S } } : { name: 'Base fixture, no site' });
    if (!withSite) return doc;
    const points = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) points.push([i * SPACING, j * SPACING, groundAt(i * SPACING, j * SPACING)]);
    const derived = {
      address: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test',
      boundary: [[0, 0], [S, 0], [S, S], [0, S]], ground: { spacing: SPACING, n: N, points },
      buildings: [{ id: 'near', outer: [[480, 380], [560, 380], [560, 420], [480, 420]], holes: [], base: 1010, height: 40, top: 1050, floors: 3, rule: 'data', name: 'Near' }],
      roads: { segments: [], pavement: [] }, walks: null, trees: [], water: { areas: [], lines: [] },
    };
    return ProjectMod.writeSection(doc, 'site', { tool: 'site', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { query: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test', walks: false }, derived });
  }
  return { memory, groundAt, siteDoc, S };
})();

async function runBaseTests() {
  const results = [];
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const t = async (name, fn) => {
    let r;
    try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
    results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const G = PlacementGizmo;
  const savedState = Store.snapshot();
  Options.holdAutosave(true);
  const mem = BaseFixture.memory();
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
  const HAS_CTX = false;
  const fresh = () => { Store.replace(fillDefaults(defaultState()), { resetHistory: true }); };
  const pl = () => Store.get('placement');
  const depth = () => Store.historyDepth();
  const r1 = (v) => Math.round(v * 10) / 10;
  /** The lowest ground under the footprint, found a second way: the four corners of the model box (the fixture ground is a plane). */
  const lowest = () => {
    const b = Derived.get().bounds.model, p = ProjectUI.placement();
    let low = Infinity;
    for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]) {
      const q = ProjectMod.toProject(p, [x, y]);
      low = Math.min(low, BaseFixture.groundAt(q[0], q[1]));
    }
    return r1(low);
  };
  const atOrigin = () => r1(BaseFixture.groundAt(pl().x, pl().y));
  /** An old save: the base was typed as 0, no baseMode key, the footprint far from the placement origin. */
  const oldSaveDoc = () => {
    const doc = BaseFixture.siteDoc(true);
    const st = fillDefaults(defaultState());
    const placement = { x: 600, y: 600, rotation: 180, baseZ: 0 };
    return ProjectMod.writeSection(doc, 'parking', { tool: 'parking', schema: CONFIG.projectSchema, placement, state: { ...st, placement }, derived: {} });
  };
  const openOld = async () => {
    fresh();
    const doc = oldSaveDoc();
    ProjectMod.saveProject(mem, doc);
    ProjectUI.openDoc(doc);
    await wait(300);
  };
  const ctxBase = () => {
    const b = (Store.get('context.blocks') || []).find((x) => x && x.site && x.h === 40);
    return b ? b.base : null;
  };
  const field = () => document.querySelector('[aria-label="Base elevation (ft) value"]');
  const chip = (mode) => document.querySelector(`#baseModeChips [data-base-mode="${mode}"]`);

  try {
    /* ---- 1. opening a project with a sloped site ---- */
    await openOld();

    await t('1. a project with a sloped site opens: baseZ is the lowest ground under the footprint, not the ground at the origin', () => {
      const z = pl().baseZ, low = lowest(), origin = atOrigin();
      return (Math.abs(z - low) <= 0.051 && Math.abs(origin - low) >= 1 && z !== 0 && Math.abs(z - ProjectUI.groundUnderFootprint()) <= 1e-9)
        || `baseZ ${z}, lowest ground under the footprint ${low}, ground at the origin ${origin}`;
    });

    await t('5. an old save without baseMode loads as follow', () => eq([pl().baseMode, ProjectUI.baseMode()], ['follow', 'follow']));

    await t('5. fillDefaults: a missing or unknown baseMode becomes follow, typed stays typed, no placement stays null', () => {
      const a = fillDefaults({ placement: { x: 1, y: 2, rotation: 0, baseZ: 3 } }).placement;
      const b = fillDefaults({ placement: { x: 1, y: 2, rotation: 0, baseZ: 3, baseMode: 'typed' } }).placement;
      const c = fillDefaults({ placement: { x: 1, y: 2, rotation: 0, baseZ: 3, baseMode: 'sideways' } }).placement;
      return eq([a.baseMode, b.baseMode, c.baseMode, fillDefaults({}).placement], ['follow', 'typed', 'follow', null]);
    });

    await t('1. the section written to the project keeps baseMode in the placement and the state', () => {
      ProjectUI.markDirty();
      const res = ProjectUI.flush();
      const sec = ProjectMod.getSection(ProjectUI.doc(), 'parking');
      return (res && res.ok !== false && sec && sec.placement.baseMode === 'follow' && sec.state.placement.baseMode === 'follow' && sec.placement.baseZ === pl().baseZ)
        || `section placement ${JSON.stringify(sec && sec.placement)}`;
    });

    if (HAS_CTX) {
      await t('6. the context blocks from the site keep their base relative to the new baseZ', () => {
        const base = ctxBase();
        return (base !== null && Math.abs(base - (1010 - pl().baseZ)) <= 0.02 && Store.get('context.fromSite') === true) || `block base ${base}, expected ${1010 - pl().baseZ}`;
      });
    }

    /* ---- 2. a footprint move: the base follows in the same undo step ---- */
    await t('2. a layout change (a wider footprint) moves the footprint: baseZ follows the footprint in the same undo step', () => {
      const before = { z: pl().baseZ, v: JSON.stringify(Store.get('footprint.width')) };
      const d0 = depth();
      Store.set('footprint.width', 600, { live: false });
      const z1 = pl().baseZ, low = lowest(), steps = depth() - d0;
      const moved = JSON.stringify(Store.get('footprint.width')) !== before.v;
      Store.undo();
      const back = pl().baseZ === before.z && JSON.stringify(Store.get('footprint.width')) === before.v;
      Store.redo();
      return (moved && z1 !== before.z && Math.abs(z1 - low) <= 0.051 && steps === 1 && back && pl().baseZ === z1)
        || `moved ${moved}, baseZ ${before.z} -> ${z1}, lowest ${low}, steps ${steps}, undo restores both ${back}`;
    });

    if (HAS_CTX) {
      await t('6. after the move the neighbors keep their base relative to the new baseZ, in the same step', () => {
        const base = ctxBase();
        return (base !== null && Math.abs(base - (1010 - pl().baseZ)) <= 0.02) || `block base ${base}, expected ${1010 - pl().baseZ}`;
      });
    }

    await t('2. a change that does not move the footprint leaves baseZ and the undo depth alone', () => {
      const z = pl().baseZ, d0 = depth();
      Store.set('bays.stallW', 9.5, { live: false });
      return eq([pl().baseZ, depth() - d0], [z, 1]);
    });

    /* ---- 3. typed mode ---- */
    await t('3. Typed: the same move leaves baseZ alone; switching back to Follow sets it', () => {
      ProjectUI.setBaseMode('typed');
      const typed = pl().baseMode, z0 = pl().baseZ;
      Store.set('footprint.width', 250, { live: false });
      const stayed = pl().baseZ === z0;
      const lowTyped = lowest();
      ProjectUI.setBaseMode('follow');
      const z2 = pl().baseZ;
      return (typed === 'typed' && stayed && Math.abs(lowTyped - z0) > 0.5 && pl().baseMode === 'follow' && Math.abs(z2 - lowTyped) <= 0.051)
        || `mode ${typed}, kept ${stayed}, baseZ ${z0} -> ${z2}, lowest ${lowTyped}`;
    });

    await t('3. Typed keeps a typed value through a footprint change; the typed field writes placement.baseZ', () => {
      ProjectUI.setBaseMode('typed');
      Store.set('placement.baseZ', 1234.5, { live: false });
      Store.set('footprint.width', 600, { live: false });
      const kept = pl().baseZ;
      ProjectUI.setBaseMode('follow');
      return eq([kept, pl().baseMode], [1234.5, 'follow']);
    });

    await t('3. followGround does nothing in Typed mode and reports no change', () => {
      ProjectUI.setBaseMode('typed');
      Store.set('placement.baseZ', 1111, { live: false });
      const changed = ProjectUI.followGround();
      const z = pl().baseZ;
      ProjectUI.setBaseMode('follow');
      return eq([changed, z], [false, 1111]);
    });

    /* ---- the Site tab control ---- */
    await t('3. the control: Follow ground and Typed chips, a read-only line in Follow, the typed field only in Typed', () => {
      Controls.refreshAll();
      const f = field(), line = document.getElementById('baseLine');
      if (!f || !line || !chip('follow') || !chip('typed')) return 'the control is missing';
      const followState = [chip('follow').getAttribute('aria-pressed'), chip('typed').getAttribute('aria-pressed'), f.closest('.when').hidden, line.closest('.when').hidden];
      const text = line.textContent;
      chip('typed').click();
      Controls.refreshAll();
      const typedState = [chip('follow').getAttribute('aria-pressed'), chip('typed').getAttribute('aria-pressed'), f.closest('.when').hidden, line.closest('.when').hidden];
      chip('follow').click();
      Controls.refreshAll();
      const backState = [pl().baseMode, f.closest('.when').hidden];
      const expectText = `Ground floor at ${(Math.round(pl().baseZ * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })} ft above sea level.`;
      return (JSON.stringify(followState) === JSON.stringify(['true', 'false', true, false]) && text === expectText
        && JSON.stringify(typedState) === JSON.stringify(['false', 'true', false, true]) && JSON.stringify(backState) === JSON.stringify(['follow', true]))
        || `follow ${JSON.stringify(followState)} "${text}" (expected "${expectText}"), typed ${JSON.stringify(typedState)}, back ${JSON.stringify(backState)}`;
    });

    /* ---- 4. the gizmo release ---- */
    await t('4. the gizmo release in Follow mode uses the footprint rule, in ONE undo step', () => {
      if (!Render.ready()) return true;
      const p0 = { ...pl() };
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      const d0 = depth();
      if (!G.begin('move', pt.x, pt.y)) return 'begin refused';
      G.move(pt.x + 100, pt.y);
      G.end();
      const p1 = { ...pl() };
      const rule = ProjectUI.groundUnderFootprint(p1);
      return (p1.x !== p0.x && Math.abs(p1.baseZ - lowest()) <= 0.06 && Math.abs(p1.baseZ - rule) <= 1e-9 && depth() - d0 === 1 && p1.baseMode === 'follow' && !Store.gestureActive())
        || `p0 ${JSON.stringify(p0)} p1 ${JSON.stringify(p1)} rule ${rule} lowest ${lowest()} steps ${depth() - d0}`;
    });

    await t('4. the gizmo release in Typed mode leaves baseZ and baseMode alone', () => {
      if (!Render.ready()) return true;
      ProjectUI.setBaseMode('typed');
      const p0 = { ...pl() };
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      if (!G.begin('move', pt.x, pt.y)) return 'begin refused';
      G.move(pt.x - 60, pt.y);
      G.end();
      const p1 = { ...pl() };
      ProjectUI.setBaseMode('follow');
      return (p1.x !== p0.x && p1.baseZ === p0.baseZ && p1.baseMode === 'typed') || `p0 ${JSON.stringify(p0)} p1 ${JSON.stringify(p1)}`;
    });

    await t('4. a turn with the ring in Follow mode also follows the footprint', () => {
      if (!Render.ready()) return true;
      const p0 = { ...pl() };
      const a = G.ringPoint(0), b = G.ringPoint(90);
      if (!a || !b) return 'no ring point on screen';
      if (!G.begin('rotate', a.x, a.y)) return 'begin refused';
      G.move(b.x, b.y);
      G.end();
      const p1 = { ...pl() };
      return (p1.rotation !== p0.rotation && Math.abs(p1.baseZ - lowest()) <= 0.06) || `p0 ${JSON.stringify(p0)} p1 ${JSON.stringify(p1)} lowest ${lowest()}`;
    });

    /* ---- no site ground ---- */
    await t('2. without a site ground the base does not change (and Follow reports nothing to do)', async () => {
      fresh();
      let doc = BaseFixture.siteDoc(false);
      const st = fillDefaults(defaultState());
      const placement = { x: 0, y: 0, rotation: 0, baseZ: 7 };
      doc = ProjectMod.writeSection(doc, 'parking', { tool: 'parking', schema: CONFIG.projectSchema, placement, state: { ...st, placement }, derived: {} });
      ProjectMod.saveProject(mem, doc);
      ProjectUI.openDoc(doc);
      await wait(100);
      const z0 = pl().baseZ;
      Store.set('footprint.width', 600, { live: false });
      return eq([ProjectUI.groundUnderFootprint(), ProjectUI.followGround(), pl().baseZ, z0, pl().baseMode], [null, false, 7, 7, 'follow']);
    });

    await t('1. closing the project: nothing follows any more', () => {
      ProjectUI.close();
      return eq([ProjectUI.followGround(), ProjectUI.baseFor({ x: 0, y: 0, rotation: 0, baseZ: 0 })], [false, null]);
    });
  } finally {
    try { G.end(false); } catch (e) { /* no drag open */ }
    ProjectUI.reset();
    ProjectUI.restoreDefaults();
    Select.clear();
    Store.replace(savedState);
    Options.holdAutosave(false);
  }
  return results;
}

/* Extend runAllTests with the base elevation tests (the other test files stay as they are). */
runAllTests = ((base) => async function runAllWithBase() {
  const r = await base();
  const g = await runBaseTests();
  const bad = g.filter((x) => !x.ok);
  r.results.push(...g);
  r.total += g.length;
  r.passed += g.length - bad.length;
  r.failed.push(...bad);
  console.log(`[tests] base elevation ${g.length - bad.length}/${g.length} passed`, bad.length ? JSON.stringify(bad) : '');
  return r;
})(runAllTests);
