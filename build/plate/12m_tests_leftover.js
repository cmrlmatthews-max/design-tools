/* ==========================================================================
   TESTS: leftovers (the leftover fix, October 26, 2026)
   Cade's hotel tower: a rounded and chamfered square plate around a large auto core with a point corridor. The fill now
   gives runs north and south of the corridor (before: two leftovers of about 2,000 sf or more under the facade). A leftover
   that stays offers "Fill with units" (the suggestion on its run) and "Make open stretch" in its card, and Paint and
   Rectangle draw in it. LeftoverFixture opens the fixture as a project (in-memory storage) for these tests and for the
   screenshots: three levels of the src/plate/testcases.js hotelTowerPlate, turned `rot` degrees, program hotel.
   runAllTests is extended at the end of this file.
   ========================================================================== */
const LeftoverFixture = (() => {
  const level = (index, rot) => ({ index, name: `Level ${index}`, zone: 'tower', z: (index - 1) * 11, ftf: 11, program: 'hotel', plates: [{ outer: TestCasesMod.hotelTowerPlate(rot), holes: [] }], core: null, spines: [], seeds: [] });
  const massing = (rot) => ({ tool: 'tower', schema: 1, placement: { x: 0, y: 0, rotation: 0, baseZ: 0 }, state: {}, derived: { levels: [1, 2, 3].map((i) => level(i, rot)) } });
  /** Opens the fixture project in Hotel mode. → the project doc */
  function open({ rot = 12, name = 'Hotel tower fixture' } = {}) {
    const mem = ProjectFixture.memory();
    ProjectUI.reset();
    ProjectUI.configure({ storage: mem, navigate: () => {}, updateUrl: () => {} });
    let doc = ProjectMod.newProject({ name });
    doc = ProjectMod.writeSection(doc, 'massing', massing(rot));
    ProjectMod.saveProject(mem, doc);
    ProjectUI.openDoc(doc);
    Store.set('mode', 'hotel', { live: false });
    return doc;
  }
  function close() { ProjectUI.close(); ProjectUI.restoreDefaults(); ProjectUI.reset(); }
  return { open, close, massing };
})();

async function runLeftoverTests() {
  const { eq, make, $, frames, snap } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const L = () => Derived.get().editing;
  const lay = () => Derived.get().group.fill;
  const gid = () => Derived.get().group.id;
  const leftovers = () => lay().support.filter((b) => b.kind === 'leftover');
  const leftoverSf = () => leftovers().reduce((s, b) => s + Math.abs(ringArea(b.outer)), 0);
  const biggest = () => leftovers().filter((b) => b.run).sort((a, b) => Math.abs(ringArea(b.outer)) - Math.abs(ringArea(a.outer)))[0];
  const units = () => Store.get(`levels.groups.${gid()}.units`) || [];
  const cardBtn = (action) => document.querySelector(`#selection-card [data-action="${action}"]`);
  const canvasEv = (type, x, y, id = 7) => Render.canvas().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  const fresh = async () => {
    Select.clear(); Select.setTool('select');
    Store.replace(fillDefaults(defaultState()));
    LeftoverFixture.open({ rot: 12 });
    const g = Store.get(`levels.groups.${gid()}`);
    if (g && ((g.units || []).length || (g.openLeftovers || []).length)) Store.set(`levels.groups.${gid()}`, { filled: true, units: [] }, { live: false });
    if (Render.ready()) Render.setView('plan', false);
    await frames(2);
  };
  try {
    await t('leftover fix: the hotel tower turned 12 degrees fills north and south: 6 runs, leftovers under 1,500 sf, Suggest on the north run gives 5 keys', async () => {
      await fresh();
      const f = lay();
      const north = f.runs.filter((r) => Math.abs(r.length - 74) < 0.05);
      const st = north.length ? f.free.find((x) => x.runId === north[0].id) : null;
      if (st) Select.select({ kind: 'free', id: st.id, runId: st.runId, mid: (st.a + st.b) / 2 });
      const g = st ? Select.suggest() : { count: 0 };
      Select.dismissGhosts();
      return eq([Store.get('source'), Store.get('mode'), f.runs.length, north.length, leftoverSf() < 1500, g.count], ['project', 'hotel', 6, 2, true, 5]);
    });
    await t('leftover fix: a selected leftover shows "Fill with units" and "Make open stretch" in its card', async () => {
      await fresh();
      const b = biggest();
      Select.select({ kind: 'support', id: b.id });
      await frames(1);
      const title = $('itemTitle') ? $('itemTitle').textContent : '';
      return eq([/^Leftover block L\d+$/.test(title), !!cardBtn('fill-leftover'), !!cardBtn('open-leftover'), cardBtn('fill-leftover') && cardBtn('fill-leftover').textContent, cardBtn('open-leftover') && cardBtn('open-leftover').textContent],
        [true, true, true, 'Fill with units', 'Make open stretch']);
    });
    await t('leftover fix: "Make open stretch" turns the leftover into an open stretch (selected), saves a seed in the group, one undo step', async () => {
      await fresh();
      const b = biggest(), n0 = leftovers().length, before = snap();
      Select.select({ kind: 'support', id: b.id });
      cardBtn('open-leftover').click();
      await frames(1);
      const s = Select.get();
      const seeds = Store.get(`levels.groups.${gid()}.openLeftovers`) || [];
      const ok = [s && s.kind, s && s.runId === b.run, seeds.length, leftovers().length, lay().free.some((f) => f.runId === b.run)];
      Store.undo();
      const back = snap() === before;
      return eq([ok, back, leftovers().length], [['free', true, 1, n0 - 1, true], true, n0]);
    });
    await t('leftover fix: "Fill with units" shows ghost keys on the leftover; Accept all draws them and the leftover opens', async () => {
      await fresh();
      const b = biggest(), n0 = leftovers().length;
      Select.select({ kind: 'support', id: b.id });
      cardBtn('fill-leftover').click();
      await frames(1);
      const g = Select.ghosts();
      const shown = !!g && g.forKind === 'support' && g.list.length >= 1 && !!cardBtn('accept-all');
      cardBtn('accept-all').click();
      await frames(1);
      return eq([shown, units().length, leftovers().length, Select.get() && Select.get().kind], [true, g.list.length, n0 - 1, 'unit']);
    });
    if (Render.ready()) {
      await t('leftover fix: Paint by pointer, starting inside a leftover, draws a key on its run', async () => {
        await fresh();
        Select.setTool('paint');
        const b = biggest(), run = Select.layoutInfo().leftoverRuns.find((r) => r.id === b.run);
        const tIn = Math.min(2, run.depth / 3);
        const p0 = Select.runPoint(run.id, Math.min(1.5, run.length * 0.1), tIn), p1 = Select.runPoint(run.id, Math.min(run.length - 0.5, 15), tIn);
        const a = Select.screenOf(p0[0], p0[1]), c = Select.screenOf(p1[0], p1[1]);
        canvasEv('pointerdown', a.x, a.y);
        for (let i = 1; i <= 6; i++) canvasEv('pointermove', a.x + ((c.x - a.x) * i) / 6, a.y + ((c.y - a.y) * i) / 6);
        canvasEv('pointerup', c.x, c.y);
        await frames(1);
        const u = L().units[0];
        return eq([units().length, !!u && u.runId === b.run, !!u && u.mode === 'run'], [1, true, true]);
      });
      await t('leftover fix: a Rectangle dragged inside a leftover draws a free unit there', async () => {
        await fresh();
        const b = biggest(), n0 = leftovers().length;
        const c = ringCentroidXY(b.outer);
        Select.setTool('rect');
        const a = Select.screenOf(c[0] - 6, c[1] - 6), z = Select.screenOf(c[0] + 6, c[1] + 6);
        canvasEv('pointerdown', a.x, a.y, 8);
        canvasEv('pointermove', (a.x + z.x) / 2, (a.y + z.y) / 2, 8);
        canvasEv('pointermove', z.x, z.y, 8);
        canvasEv('pointerup', z.x, z.y, 8);
        await frames(1);
        const u = L().units[0];
        Select.setTool('select');
        return eq([units().length, !!u && pointInRing(c[0], c[1], u.outer), leftovers().length], [1, true, n0 - 1]);
      });
    }
  } finally {
    Select.clear();
    Select.setTool('paint');
    try { LeftoverFixture.close(); } catch (e) { /* not open */ }
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('leftover', results);
  return results;
}

runAllTests = ((base) => async function runAllWithLeftover() {
  const r = await base();
  const g = await runLeftoverTests();
  const bad = g.filter((x) => !x.ok);
  r.results.push(...g);
  r.total += g.length;
  r.passed += g.length - bad.length;
  r.failed.push(...bad);
  return r;
})(runAllTests);
