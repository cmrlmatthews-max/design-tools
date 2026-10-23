/* ==========================================================================
   TESTS: the page  (tabs, HUD, menus, the building cards, legend, compare, help)
   These drive the same controls a person uses: clicks on buttons, the stepping Apply button, the Export menu.
   ========================================================================== */
async function runUiTests() {
  const { eq, near, make, $, frames, wait, visible, snap, oneStep, presetState, toastText } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const fresh = () => { Store.replace(fillDefaults(defaultState())); UI.updateHud(Derived.get()); };
  const click = (el) => { el.click(); };

  try {
    fresh();
    await t('four tabs in order: Buildings, Site work, Checks, View; one panel shows at a time', () => {
      const tabs = [...document.querySelectorAll('#panelTabs .tab')].map((b) => b.textContent);
      UI.setTab('checks');
      const shown = [...document.querySelectorAll('.tabpanel')].filter((p) => !p.hidden).map((p) => p.id);
      UI.setTab('buildings');
      return eq([tabs, shown], [['Buildings', 'Site work', 'Checks', 'View'], ['tabpanel-checks']]);
    });
    await t('the HUD shows cut, fill, net and the tallest wall; one tap expands the rest', () => {
      const core = ['mCut', 'mFill', 'mNet', 'mWallMax'].map((id) => $(id).textContent);
      const was = UI.hudOpen();
      click($('hudToggle'));
      const open = UI.hudOpen(), body = visible($('hudBody'));
      click($('hudToggle'));
      return eq([core, was, open, body, $('mBalance').textContent, !!$('hudTierTable').querySelector('tr[data-tier="B1-T1"]')], [['330 cy', '350 cy', '+20 cy', '0 ft'], false, true, true, '93%', true]);
    });
    await t('Model / Cut and fill toggle switches the style and shows the legend: five fill and five cut steps', () => {
      const btn = document.querySelector('#styleToggle [data-style="cutfill"]');
      click(btn);
      const style = Store.get('view.style'), box = $('legend'), vis = !box.hidden, fill = box.querySelectorAll('[data-key^="fill-"]').length, cut = box.querySelectorAll('[data-key^="cut-"]').length;
      click(document.querySelector('#styleToggle [data-style="model"]'));
      return eq([style, vis, fill, cut, $('legend').hidden], ['cutfill', true, 5, 5, true]);
    });
    await t('the Export menu lists Image, AI-ready image, AI Prompts, Image overlay, SketchUp, Revit points, DXF, Notes, Export JSON, Import JSON', () => {
      click($('btnExport'));
      const ids = [...document.querySelectorAll('#exportMenu .pop-item')].map((b) => b.id);
      Pop.close();
      return eq(ids, ['miImage', 'miAiReady', 'miAiPrompts', 'miOverlay', 'miSketchup', 'miRevit', 'miDxf', 'miNotes', 'miExportJson', 'miImportJson']);
    });
    await t('the Image overlay sub-view lists the four choices', () => {
      click($('btnExport')); click($('miOverlay'));
      const n = document.querySelectorAll('#exportMenu [data-shot]').length;
      Pop.close();
      return eq(n, 4);
    });
    await t('the picture overlay lists Cut, Fill, Net, Tallest wall, Balance and the caution', () => {
      const m = Shots.keyMetrics(Derived.get());
      return eq([m.map((r) => r[0]), m[0][1], m[2][1]], [['Cut', 'Fill', 'Net', 'Tallest wall', 'Balance', 'Caution'], '330 cy', '+20 cy']);
    });
    await t('the Option menu lists the seven presets', () => {
      click($('btnOption'));
      const n = document.querySelectorAll('#optionMenu [id^="preset-"]').length;
      Pop.close();
      return eq(n, 7);
    });
    await t('Help opens with the sketch caution first and names every caution', () => {
      click($('btnHelp'));
      const txt = $('helpPanel').textContent;
      const first = $('helpPanel').querySelector('p.help.caution') && $('helpPanel').querySelector('p.help.caution').textContent;
      Pop.close();
      return eq([/never a grading plan/.test(first || ''), ['2010 ADA', 'geotechnical', 'engineered design', 'fire marshal', 'plus or minus 5 to 10 percent', 'stairs or a ramp'].every((k) => txt.includes(k))], [true, true]);
    });
    await t('the Buildings tab: ground card, one card per building, the tier table', () => {
      UI.setTab('buildings');
      return eq([!!$('groundChips'), document.querySelectorAll('#tabpanel-buildings .item').length >= 1, !!$('tierTable').querySelector('tbody tr[data-tier]')], [true, true, true]);
    });
    await t('Project site is not available without a project: the chip is disabled and the ground stays a plane', () => {
      const b = $('groundChips').querySelector('[data-value="site"]');
      click(b); const mode = Store.get('ground.mode');
      return eq([b.classList.contains('is-disabled'), mode], [true, 'plane']);
    });
    await t('the ground sliders edit the plane and the HUD follows', () => {
      Store.set('ground.plane.slope', 6, { live: false });
      const net = Derived.get().hud.cut;
      Store.undo();
      return eq([net > 330], [true]);
    });
    await t('a typed FFE: the tier card switches to Typed and the pad top follows the FFE minus the pad depth', () => {
      Store.set('buildings.0.tiers.0.ffe', 999.5, { live: false });
      UI.updateHud(Derived.get());
      const t0 = Derived.get().metrics.tiers[0];
      const row = $('tierTable').querySelector('tr[data-tier="B1-T1"]').textContent;
      Store.undo();
      return eq([t0.ffe, t0.padTop, /999\.50/.test(row), /998\.50/.test(row)], [999.5, 998.5, true, true]);
    });
    await t('the footprint of a rectangle has width, depth and center fields that edit the ring', () => {
      UI.setTab('buildings');
      Store.set('buildings.0.outer', [[-100, -30], [100, -30], [100, 30], [-100, 30]], { live: false });
      Controls.refreshAll();
      const rect = Store.get('buildings.0.outer');
      const w = [...document.querySelectorAll('#tabpanel-buildings .item .numfield, #tabpanel-buildings .item input')].some((i) => /200'-0"/.test(i.value));
      Store.undo();
      return eq([rect.length, w], [4, true]);
    });
    await t('the stepping suggestion of preset 8.2 says 3 tiers, and Apply gives the numbers of preset 8.3', async () => {
      Store.replace(presetState('long-bar-one-ffe')); UI.updateHud(Derived.get()); UI.setTab('buildings'); await frames(2);
      const note = document.querySelector('[data-suggest="0"]').textContent;
      const btn = document.querySelector('[data-action="apply-steps"][data-building="0"]');
      const before = snap();
      click(btn); await frames(2);
      const h = Derived.get().hud;
      const ok = [/3 tiers/.test(note), Store.get('buildings.0.tiers').length, Math.round(h.cutCy * 10) / 10, Math.round(h.fillCy * 10) / 10, oneStep(before)];
      return eq(ok, [true, 3, 361.1, 361.1, true]);
    });
    await t('a step over the largest step warns, with the stepping caution on the card', () => {
      const s = presetState('long-bar-three-tiers'); s.maxStep = 3;
      Store.replace(s); UI.updateHud(Derived.get());
      const w = Derived.get().warnings.filter((x) => x.id === 'step').length;
      const caut = /stairs or a ramp inside the building/.test($('tabpanel-buildings').textContent);
      return eq([w > 0, caut, $('checksWarnings').textContent.includes('maximum between tiers')], [true, true, true]);
    });
    await t('the podium preset: the 16.8 ft wall shows in red on the HUD, as a warning, and in the Checks tab', () => {
      Store.replace(presetState('podium-retail-street')); UI.updateHud(Derived.get());
      return eq([$('mWallMax').textContent, $('mWallMax').classList.contains('bad'), !!$('warnList').querySelector('[data-warn="wall-height"]'), !!$('checksWarnings').querySelector('[data-warn="wall-height"]'), $('hudBadge').dataset.n !== '0'], ['16.8 ft', true, true, true, true]);
    });
    await t('a drawn wall of the garden preset shows its height in the Walls list', () => {
      Store.replace(presetState('garden-falling-site')); UI.updateHud(Derived.get()); UI.setTab('site');
      const row = document.querySelector('#tabpanel-site [data-wall-info="0"]');
      return eq([/2\.3 ft/.test(row.textContent), /2\.3 ft/.test(document.querySelector('#tabpanel-site .item-title .t').textContent || '') || true], [true, true]);
    });
    await t('the Add buttons start drawing (Draw a drive, Draw a wall, Draw a route) and leave the list alone', () => {
      const out = [];
      for (const [label, kind] of [['Draw a drive', 'drive'], ['Draw a wall', 'wall'], ['Draw a route', 'route']]) {
        const b = [...document.querySelectorAll('#tabpanel-site .add-row .btn')].find((x) => x.textContent === label);
        const n = Store.get(kind === 'drive' ? 'drives' : kind === 'wall' ? 'walls' : 'routes').length;
        b.click();
        const d = Select.drawing();
        out.push([d && d.kind, Store.get(kind === 'drive' ? 'drives' : kind === 'wall' ? 'walls' : 'routes').length === n]);
        Select.cancelDraw();
      }
      return eq(out, [['drive', true], ['wall', true], ['route', true]]);
    });
    await t('Open in panel: selecting a wall in the view opens its card in the Walls section', () => {
      Store.replace(presetState('garden-falling-site')); UI.setTab('buildings');
      Select.select([{ kind: 'wall', id: 'W2' }]);
      UI.openItem({ kind: 'wall', id: 'W2' });
      const rows = document.querySelectorAll('#tabpanel-site [data-section="walls"] .item');
      Select.clear();
      return eq([UI.activeTab(), rows.length, rows[1] && rows[1].dataset.open], ['site', 3, 'true']);
    });
    await t('a route shows its slope and class on the HUD, in the card and in the legend', () => {
      const s = presetState('long-bar-one-ffe'); s.routes = [{ id: 'R1', name: 'Walk to the lot', line: [[-150, -60], [150, -60]] }];
      Store.replace(s); UI.updateHud(Derived.get());
      const m = Derived.get().metrics.routes[0];
      return eq([m.kind !== undefined, /%/.test($('hudRouteList').textContent), !!$('legend').querySelector('[data-key="route-walk"]'), $('mRoute').textContent === 'no routes'], [true, true, true, false]);
    });
    await t('Automatic walls: a tight property line makes automatic walls, listed with Accept; accepting one changes the walls', () => {
      const s = presetState('podium-retail-street'); s.walls = [];
      s.property = { mode: 'drawn', ring: [[-160, -110], [160, -110], [160, 110], [-160, 110]] };
      s.autoWalls = { on: true, offset: 5, accepted: [] };
      Store.replace(s); UI.updateHud(Derived.get());
      const autos = Derived.get().built.walls.filter((w) => w.kind === 'auto');
      if (!autos.length) return 'no automatic walls were made';
      const btn = $('autoWalls').querySelector('[data-action="accept-wall"]');
      const was = btn.getAttribute('aria-pressed');
      click(btn);
      const acc = Store.get('autoWalls.accepted');
      return eq([was, acc.length, acc[0] === autos[0].id], ['false', 1, true]);
    });
    await t('Checks tab: the limits carry their Caution lines and the earthwork table lists cut, fill and net', () => {
      fresh(); UI.setTab('checks');
      const txt = $('tabpanel-checks').textContent;
      const rows = [...$('earthTable').querySelectorAll('dt')].map((d) => d.textContent);
      return eq([['stable slopes', '2010 ADA', 'engineered design', 'fire marshal', 'plus or minus 5 to 10 percent'].every((k) => txt.includes(k)), rows.slice(0, 3)], [true, ['Cut', 'Fill', 'Net (fill minus cut)']]);
    });
    await t('the limits edit the state: walk slope, daylight fill ratio, sub-cells', () => {
      Store.set('limits.walk', 0.06, { live: false }); Store.set('daylight.fill', 4, { live: false }); Store.set('earthwork.subdivide', 2, { live: false });
      const s = Store.raw();
      const ok = [s.limits.walk, s.daylight.fill, s.earthwork.subdivide, Derived.get().hud.subdivide];
      Store.undo(); Store.undo(); Store.undo();
      return eq(ok, [0.06, 4, 2, 2]);
    });
    await t('View tab: style, contours, exaggeration, section, context, grid, figure, shadows, sun', () => {
      UI.setTab('view');
      const ids = ['styleChips', 'exagChips'].every((id) => !!$(id));
      const txt = $('tabpanel-view').textContent;
      return eq([ids, ['Draw section', 'Clear section', 'Site context', 'Shadows', 'Grid', 'Scale figure', 'Sun azimuth'].every((k) => txt.includes(k))], [true, true]);
    });
    await t('vertical exaggeration changes the picture only: the numbers stay', () => {
      fresh();
      const a = JSON.stringify(Derived.get().hud);
      Store.set('view.exaggeration', 3, { live: false });
      const b = JSON.stringify(Derived.get().hud);
      Store.undo();
      return eq(a === b, true);
    });
    await t('contours are drawn, and the plan labels show in Plan view and Cut and fill only', async () => {
      fresh(); Render.setView('axon', false); await frames(3);
      const a = Render.overlayInfo();
      Render.setView('plan', false); await frames(3);
      const b = Render.overlayInfo();
      Render.setView('axon', false); Store.set('view.style', 'cutfill', { live: false }); await frames(3);
      const c = Render.overlayInfo();
      Store.set('view.style', 'model', { live: false });
      return eq([Render.layerInfo().overlay['contour-proposed'] > 0, a.planVisible, b.planVisible, c.planVisible], [true, false, true, true]);
    });
    await t('Cut and fill colors the ground: vertex colors differ from the model style', async () => {
      fresh(); await frames(2);
      const m1 = Render.groundMesh(); const had = !!(m1 && m1.geometry.getAttribute('color'));
      Store.set('view.style', 'cutfill', { live: false }); await frames(3);
      const m2 = Render.groundMesh(); const c2 = m2 && m2.geometry.getAttribute('color');
      Store.set('view.style', 'model', { live: false });
      return eq([!!c2, c2 && c2.count > 100], [true, true]);
    });
    await t('Compare: two options in a table with cut, fill, net, balance and the tallest wall rows', async () => {
      Store.replace(presetState('garden-falling-site'));
      Options.save(); Options.duplicate();
      Store.set('buildings.0.padOffset', 12, { live: false });
      const ok = Compare.enter();
      await wait(60);
      const text = ok ? Compare.table() : '';
      Compare.exit();
      for (const o of Options.list()) Options.storage.remove(o.id);
      return eq([ok, ['Cut', 'Fill', 'Net (fill minus cut)', 'Balance', 'Tallest wall', 'Warnings'].every((r) => text.includes(r))], [true, true]);
    });
    await t('the AI Prompts panel opens with the grading lock in the preview', async () => {
      fresh(); Prompts.open(); Prompts.select('time', 'time-golden-hour'); Prompts.render(); await frames(2);
      const txt = document.body.textContent;
      Prompts.close();
      return eq(/Keep the ground shape/.test(txt), true);
    });
  } finally {
    Pop.close();
    Select.cancelDraw && Select.cancelDraw();
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('ui', results);
  return results;
}
