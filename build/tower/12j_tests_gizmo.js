/* ==========================================================================
   TESTS: placement gizmo (docs/site-layer-technical-plan.md section 9.2, tests 7 to 9) - Tower
   Drag the building: placement.x / y move in the project frame, the base elevation snaps to the ground, ONE undo step, the
   context blocks from the site follow on release only. Rotation handle in 5 degree steps. No drag without a project.
   Uses its own in-memory site project, so a ?test visit never touches the saved projects. runAllTests is extended at the end of
   this file (no edit of the other test files needed).
   ========================================================================== */
const GizmoFixture = (() => {
  const S = 1000, N = 11, SPACING = 100;
  const memory = () => ({ data: {}, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; }, setItem(k, v) { this.data[k] = String(v); }, removeItem(k) { delete this.data[k]; } });
  /** A 1000 ft site square with a sloping ground (z = 1000 + 0.01 x + 0.02 y), a near building and a far one. */
  function siteProject() {
    let doc = ProjectMod.newProject({ name: 'Gizmo fixture', frame: { kind: 'site', lat: 33.927, lon: -84.339, size: S } });
    const points = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) points.push([i * SPACING, j * SPACING, 1000 + 0.01 * i * SPACING + 0.02 * j * SPACING]);
    const derived = {
      address: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test',
      boundary: [[0, 0], [S, 0], [S, S], [0, S]], ground: { spacing: SPACING, n: N, points },
      buildings: [
        { id: 'near', outer: [[480, 380], [560, 380], [560, 420], [480, 420]], holes: [], base: 1010, height: 40, top: 1050, floors: 3, rule: 'data', name: 'Near' },
        { id: 'far', outer: [[950, 950], [990, 950], [990, 990], [950, 990]], holes: [], base: 1030, height: 30, top: 1060, floors: 2, rule: 'data', name: 'Far' },
      ],
      roads: { segments: [], pavement: [] }, walks: null, trees: [], water: { areas: [], lines: [] },
    };
    doc = ProjectMod.writeSection(doc, 'site', { tool: 'site', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: { query: 'Fixture', lat: 33.927, lon: -84.339, size: S, release: 'test', walks: false }, derived });
    return doc;
  }
  /** Ground elevation by the same rule the site fixture was built with. */
  const groundAt = (x, y) => 1000 + 0.01 * Math.min(Math.max(x, 0), S) + 0.02 * Math.min(Math.max(y, 0), S);
  return { memory, siteProject, groundAt, S };
})();

async function runGizmoTests() {
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
  const mem = GizmoFixture.memory();
  ProjectUI.reset();
  ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
  const fresh = () => { Store.replace(fillDefaults(defaultState()), { resetHistory: true }); };
  const openSite = async () => {
    fresh();
    const doc = GizmoFixture.siteProject();
    ProjectMod.saveProject(mem, doc);
    ProjectUI.openDoc(doc);
    
    await wait(300);
  };
  const pl = () => Store.get('placement');
  const depth = () => Store.historyDepth();
  const HAS_CTX = true;
  const ctxKey = () => JSON.stringify((Store.get('context') || {}).blocks || []);

  try {
    /* ---- test 9 (first half): no project, no gizmo ---- */
    await t('9. no project: the placement gizmo is not active, begin does nothing, nothing is written', () => {
      if (!Render.ready()) return true;
      fresh();
      const before = JSON.stringify(Store.snapshot());
      const info = G.info();
      const began = G.begin('move', 100, 100) || G.begin('rotate', 100, 100);
      return eq([ProjectUI.has(), info.active, info.handles, began, JSON.stringify(Store.snapshot()) === before], [false, false, 0, false, true]);
    });

    await openSite();

    await t('7. the gizmo is active with a project open and shows the rotation grip', () => {
      if (!Render.ready()) return true;
      const i = G.info();
      return eq([i.active, i.dragging, i.handles], [true, null, 1]);
    });

    await t('7. a drag over the building moves placement.x / y in 1 ft steps, the base elevation snaps to the ground, ONE undo step', () => {
      if (!Render.ready()) return true;
      const p0 = { ...pl() };
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      const d0 = depth();
      if (!G.begin('move', pt.x, pt.y)) return 'begin refused';
      const during = G.info().dragging;
      G.move(pt.x + 100, pt.y);
      const live = { ...pl() };
      const gestureOpen = Store.gestureActive();
      G.end();
      const p1 = { ...pl() };
      const gz = ProjectUI.groundUnderFootprint(p1);   // the lowest ground under the footprint (base rule), not the ground at the origin
      const moved = p1.x !== p0.x || p1.y !== p0.y;
      return (moved && during === 'move' && gestureOpen && live.x === p1.x && live.y === p1.y && Number.isInteger(p1.x) && Number.isInteger(p1.y)
        && Math.abs(p1.baseZ - gz) <= 0.05 && p1.rotation === p0.rotation && depth() - d0 === 1 && !Store.gestureActive() && G.info().dragging === null)
        || `p0 ${JSON.stringify(p0)} p1 ${JSON.stringify(p1)} groundZ ${gz} steps ${depth() - d0} during ${during} gesture ${gestureOpen}`;
    });

    await t('7. undo returns the placement and the context blocks in the one step; redo puts them back', () => {
      if (!Render.ready()) return true;
      const after = JSON.stringify(Store.get('placement')), ctxAfter = ctxKey();
      Store.undo();
      const undone = JSON.stringify(Store.get('placement')), ctxUndone = ctxKey();
      Store.redo();
      const redone = JSON.stringify(Store.get('placement')), ctxRedone = ctxKey();
      return (undone !== after && redone === after && (!HAS_CTX || (ctxUndone !== ctxAfter && ctxRedone === ctxAfter))) || `placement ${undone} -> ${after}`;
    });

    await t('7. the context blocks from the site follow the placement on release only (no rewrite per live step)', () => {
      if (!Render.ready()) return true;
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      ProjectUI.centerOnSite({ quiet: true });                       // back at the site center so the near building is a context block
      ProjectUI.contextFromSite(undefined, { quiet: true });
      const pt2 = G.modelPoint() || pt;
      const ctx0 = ctxKey();
      let writes = 0;
      const off = Store.subscribe((s, info) => { if (String(info && info.path || '').startsWith('context')) writes++; });
      G.begin('move', pt2.x, pt2.y);
      G.move(pt2.x + 30, pt2.y); G.move(pt2.x + 60, pt2.y + 5); G.move(pt2.x + 90, pt2.y + 10);
      const midWrites = writes, midCtx = ctxKey();
      G.end();
      off();
      const p = pl(), blk = (Store.get('context.blocks') || []).find((b) => Math.abs(b.w - 80) < 0.1);
      const ok = midWrites === 0 && midCtx === ctx0 && writes >= 1 && ctxKey() !== ctx0 && blk && Math.abs(blk.x - (520 - p.x)) < 0.05 && Math.abs(blk.y - (400 - p.y)) < 0.05;
      return ok || `live writes ${midWrites}, writes ${writes}, block ${JSON.stringify(blk)}, placement ${JSON.stringify(p)}`;
    });

    await t('7. Shift snaps the move to 5 ft', () => {
      if (!Render.ready()) return true;
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      G.begin('move', pt.x, pt.y);
      G.move(pt.x - 37, pt.y + 21, { shift: true });
      const p = { ...pl() };
      G.end(false);
      return (p.x % 5 === 0 && p.y % 5 === 0) || `x ${p.x} y ${p.y}`;
    });

    await t('7. a drag that is cancelled (end(false)) restores the placement and adds no undo step', () => {
      if (!Render.ready()) return true;
      const p0 = JSON.stringify(pl()), d0 = depth(), ctx0 = ctxKey();
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      G.begin('move', pt.x, pt.y);
      G.move(pt.x + 80, pt.y - 40);
      const during = JSON.stringify(pl());
      G.end(false);
      return (during !== p0 && JSON.stringify(pl()) === p0 && depth() === d0 && ctxKey() === ctx0 && !Store.gestureActive()) || `during ${during} after ${JSON.stringify(pl())}`;
    });

    await t('7. a press on empty ground does not start a placement drag, and orbit stays on', () => {
      if (!Render.ready()) return true;
      const rect = Render.canvas().getBoundingClientRect();
      const began = G.begin('move', rect.left + 2, rect.top + 2);
      return eq([began, G.info().dragging, Render.orbitEnabled()], [false, null, true]);
    });

    await t('7. a real pointer drag on the model: needs 6 px of travel, orbit is off during it and on after, one undo step', async () => {
      if (!Render.ready()) return true;
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      const canvas = Render.canvas();
      const ev = (type, x, y) => new PointerEvent(type, { pointerId: 41, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true });
      const p0 = JSON.stringify(pl()), d0 = depth();
      canvas.dispatchEvent(ev('pointerdown', pt.x, pt.y));
      const orbitOffDown = !Render.orbitEnabled();
      window.dispatchEvent(ev('pointermove', pt.x + 3, pt.y));
      const small = JSON.stringify(pl()) === p0 && G.info().dragging === null;
      window.dispatchEvent(ev('pointermove', pt.x + 60, pt.y + 10));
      await wait(60);
      const dragging = G.info().dragging;
      const moved = JSON.stringify(pl()) !== p0;
      window.dispatchEvent(ev('pointerup', pt.x + 60, pt.y + 10));
      const ok = orbitOffDown && small && dragging === 'move' && moved && Render.orbitEnabled() && depth() - d0 === 1 && G.info().dragging === null;
      return ok || `orbitOffDown ${orbitOffDown} small ${small} dragging ${dragging} moved ${moved} orbit ${Render.orbitEnabled()} steps ${depth() - d0}`;
    });

    await t('7. a press on the model that never travels 6 px changes nothing and gives orbit back', () => {
      if (!Render.ready()) return true;
      const pt = G.modelPoint();
      if (!pt) return 'no model point on screen';
      const ev = (type, x, y) => new PointerEvent(type, { pointerId: 42, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
      const p0 = JSON.stringify(pl()), d0 = depth();
      Render.canvas().dispatchEvent(ev('pointerdown', pt.x, pt.y));
      window.dispatchEvent(ev('pointermove', pt.x + 2, pt.y + 1));
      window.dispatchEvent(ev('pointerup', pt.x + 2, pt.y + 1));
      return eq([JSON.stringify(pl()) === p0, depth() === d0, Render.orbitEnabled(), G.info().dragging], [true, true, true, null]);
    });

    /* ---- test 8: rotation ---- */
    await t('8. the rotation handle turns the placement in 5 degree steps about the box center, ONE undo step', () => {
      if (!Render.ready()) return true;
      const p0 = { ...pl() };
      const b = Derived.get().bounds.model;
      const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
      const cBefore = ProjectMod.toProject(p0, c);
      const a = G.ringPoint(0), z = G.ringPoint(90);
      const d0 = depth();
      if (!G.begin('rotate', a.x, a.y)) return 'begin refused';
      const during = G.info().dragging;
      G.move(z.x, z.y);
      const live = pl().rotation;
      G.end();
      const p1 = { ...pl() };
      const cAfter = ProjectMod.toProject(p1, c);
      const ok = during === 'rotate' && p1.rotation % 5 === 0 && Math.abs(p1.rotation - p0.rotation - 90) <= 5 && live === p1.rotation
        && Math.hypot(cAfter[0] - cBefore[0], cAfter[1] - cBefore[1]) < 0.01 && depth() - d0 === 1
        && Math.abs(p1.baseZ - ProjectUI.groundUnderFootprint(p1)) <= 0.05;
      return ok || `rot ${p0.rotation} -> ${p1.rotation}, center moved ${Math.hypot(cAfter[0] - cBefore[0], cAfter[1] - cBefore[1])}, steps ${depth() - d0}`;
    });

    await t('8. every rotation step along a sweep is a multiple of 5; Alt gives 1 degree steps', () => {
      if (!Render.ready()) return true;
      const a = G.ringPoint(0);
      G.begin('rotate', a.x, a.y);
      const seen = [];
      for (let deg = 3; deg <= 100; deg += 7) { const q = G.ringPoint(deg); G.move(q.x, q.y); seen.push(pl().rotation); }
      const q = G.ringPoint(37.4);
      G.move(q.x, q.y, { alt: true });
      const fine = pl().rotation;
      G.end(false);
      return (seen.every((r) => r % 5 === 0) && Number.isInteger(fine) && fine % 5 !== 0) || `seen ${seen} fine ${fine}`;
    });

    await t('8. Escape during a rotation restores the placement and commits nothing', () => {
      if (!Render.ready()) return true;
      const p0 = JSON.stringify(pl()), d0 = depth();
      const a = G.ringPoint(0), z = G.ringPoint(60);
      G.begin('rotate', a.x, a.y);
      G.move(z.x, z.y);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return eq([JSON.stringify(pl()) === p0, depth() === d0, G.info().dragging, Render.orbitEnabled()], [true, true, null, true]);
    });

    /* ---- test 9 (second half) ---- */
    
    await t('9. closing the project turns the gizmo off again', () => {
      if (!Render.ready()) return true;
      ProjectUI.reset();
      const info = G.info();
      return eq([info.active, info.handles, G.begin('rotate', 100, 100)], [false, 0, false]);
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

/* Extend runAllTests with the gizmo tests (the other test files stay as they are). */
runAllTests = ((base) => async function runAllWithGizmo() {
  const r = await base();
  const g = await runGizmoTests();
  const bad = g.filter((x) => !x.ok);
  r.results.push(...g);
  r.total += g.length;
  r.passed += g.length - bad.length;
  r.failed.push(...bad);
  console.log(`[tests] gizmo ${g.length - bad.length}/${g.length} passed`, bad.length ? JSON.stringify(bad) : '');
  return r;
})(runAllTests);
