/* ==========================================================================
   TESTS  (docs/model-viewer-technical-plan.md section 6, in-page tests)
   Run by adding ?test to the address. Two suites:
     viewer.page     no project: the empty state, the menus, the help
     viewer.project  the fixture project (test/viewer.fixture.json, made from the tools' own modules): every layer loads, toggles hide
                     layers, the level cut, the tap card, the Edit links, No data notes, stale flags, sun, exports, and the rule that
                     the page never writes the project (storage unchanged byte for byte, no write call)
   The fixture is read with fetch from ../test/ (the test server serves the whole folder).
   ========================================================================== */
const TestHelp = (() => {
  const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
  const near = (a, b, tol = 1e-9) => (Math.abs(a - b) <= tol ? true : `got ${a}, expected ${b}`);
  const make = () => {
    const results = [];
    const t = async (name, fn) => {
      let r;
      try { r = await fn(); } catch (e) { r = `threw ${e && e.message}`; }
      results.push({ name, ok: r === true, detail: r === true ? '' : String(r) });
    };
    return { results, t };
  };
  const frames = (n = 3) => new Promise((res) => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const merged = (name, results) => {
    const bad = results.filter((r) => !r.ok);
    console.log(`[tests] ${name} ${results.length - bad.length}/${results.length} passed`, bad.length ? JSON.stringify(bad) : '');
  };
  const drawn = () => Render.info().drawn;
  return { eq, near, make, frames, wait, visible, merged, drawn };
})();

/** A project key snapshot: every key that starts with cmrlm.project, with its exact text. */
function projectKeysSnapshot() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^cmrlm\.project/.test(k)) out[k] = localStorage.getItem(k); }
  return JSON.stringify(Object.keys(out).sort().map((k) => [k, out[k]]));
}

async function runPageTests() {
  const { eq, make, frames, visible } = TestHelp;
  const { results, t } = make();
  ViewerProject.close();
  await frames(4);

  await t('title, tool id and the Model Viewer heading', () => eq([document.title, CONFIG.tool, document.querySelector('.app-title').textContent], ['Model Viewer', 'viewer', 'Model Viewer']));
  await t('all the src modules are in the page', () => {
    const names = ['ViewerScene', 'ViewerSummary', 'ViewerSketchup', 'ProjectMod', 'SiteLayerMod', 'ShotMod', 'SkFmt', 'PromptsMod'];
    const miss = names.filter((n) => { try { return typeof eval(n) !== 'object'; } catch (e) { return true; } });
    return eq(miss, []);
  });
  await t('planToWorld north is -z', () => eq(planToWorld(3, 4, 5), [3, 5, -4]));
  await t('no project: the empty state says "Open a project to view it."', () => eq([visible($('emptyState')), $('emptyTitle').textContent], [true, 'Open a project to view it.']));
  await t('no project: no HUD, no view buttons, a note in every tab', () => {
    const notes = ['layers', 'levels', 'view', 'summary'].map((id) => !!document.querySelector(`#tabpanel-${id} .no-project`));
    return eq([visible($('hud')), visible($('views')), notes], [false, false, [true, true, true, true]]);
  });
  await t('the top bar: Tools home, CMRLM, Project, Export, Help; Site, Building, Model and Diagram are in the bottom bar', () => {
    const home = $('tbHome');
    return eq([home.getAttribute('href'), document.querySelector('.wordmark').textContent, !!$('btnProject'), visible($('tbZoomSite')), visible($('tbZoomBuilding')), [...$('styleToggle').querySelectorAll('button')].map((b) => b.textContent), !!$('btnExport'), !!$('btnHelp')],
      ['../', 'CMRLM', true, true, true, ['Model', 'Diagram'], true, true]);
  });
  await t('B1. the bottom bar holds the view buttons, Site, Building, Model / Diagram, Metrics; none of them is in the top bar', () => {
    const want = ['views', 'tbZoomSite', 'tbZoomBuilding', 'styleToggle', 'tbMetrics']; const i = TopBar.barInfo(want);
    const bar = document.getElementById('viewBar'), vp = document.getElementById('viewport');
    if (!bar || !vp) return 'no bottom bar';
    const r = bar.getBoundingClientRect(), v = vp.getBoundingClientRect();
    const inside = r.left >= v.left - 1 && r.right <= v.right + 1 && r.bottom <= v.bottom + 1 && r.top >= v.top;
    const metrics = document.getElementById('tbMetrics');
    const pressed = !metrics || metrics.getAttribute('aria-pressed') === String(!TopBar.hudHidden());
    return eq([i.missing, i.inTop, want.filter((id) => !i.inBar.includes(id)), i.views >= 6, inside, pressed], [[], [], [], true, true, true]);
  });
  await t('the panel tabs are Layers, Levels, View, Summary', () => eq([...$('panelTabs').querySelectorAll('.tab')].map((b) => b.textContent), ['Layers', 'Levels', 'View', 'Summary']));
  await t('the Project menu has Import and Export and no New', async () => {
    $('btnProject').click(); await frames(2);
    const menu = $('projectMenu');
    const labels = [...menu.querySelectorAll('.pop-item')].map((b) => b.querySelector('.grow').firstChild.textContent);
    const hasNew = labels.some((l) => /^new/i.test(l));
    const exportOff = $('miExportProject').disabled;
    Pop.close();
    return eq([labels.includes('Import'), labels.includes('Export'), hasNew, exportOff], [true, true, false, true]);
  });
  await t('the Export menu has Image, AI-ready image, AI Prompts and SketchUp, all off without a project', async () => {
    $('btnExport').click(); await frames(2);
    const ids = ['miImage', 'miAiReady', 'miAiPrompts', 'miSketchup'];
    const out = ids.map((id) => [!!$(id), $(id) && $(id).disabled]);
    Pop.close();
    return eq(out, ids.map(() => [true, true]));
  });
  await t('the Help panel opens with the caution', async () => {
    $('btnHelp').click(); await frames(2);
    const p = $('helpPanel');
    const text = p ? p.textContent : '';
    Pop.close();
    return eq([!!p, text.includes(CONFIG.caution), Help.sections()[0]], [true, true, 'Read this first']);
  });
  await t('the page has no New button and no Save button', () => eq([!!document.getElementById('btnNew'), !!document.getElementById('btnSave'), /\bNew\b/.test($('tbProject').textContent)], [false, false, false]));
  TestHelp.merged('viewer.page', results);
  return results;
}

async function runProjectTests() {
  const { eq, near, make, frames, wait, visible, drawn } = TestHelp;
  const { results, t } = make();
  let doc = null;
  try {
    const res = await fetch(new URL('../test/viewer.fixture.json', location.href));
    doc = await res.json();
  } catch (e) { doc = null; }
  await t('the fixture project is available', () => eq(!!doc && doc.format === ProjectMod.FORMAT, true));
  if (!doc) { TestHelp.merged('viewer.project', results); return results; }

  // Seeding is test set-up: the test writes the fixture to the project list the way a tool would. The viewer does not.
  const prevIndex = localStorage.getItem('cmrlm.project.index'), prevLast = localStorage.getItem('cmrlm.project.last');
  ProjectMod.saveProject(localStorage, doc);
  const before = projectKeysSnapshot();
  const calls = [], writes = [];
  const origs = {};
  for (const fn of ['writeSection', 'saveProject', 'importProject', 'deleteProject', 'sendTo']) { origs[fn] = ProjectMod[fn]; ProjectMod[fn] = (...a) => { calls.push(fn); return origs[fn](...a); }; }
  const proto = Storage.prototype, origSet = proto.setItem, origRem = proto.removeItem;
  proto.setItem = function (k, v) { if (/^cmrlm\.project/.test(String(k))) writes.push(['set', String(k)]); return origSet.call(this, k, v); };
  proto.removeItem = function (k) { if (/^cmrlm\.project/.test(String(k))) writes.push(['remove', String(k)]); return origRem.call(this, k); };
  const id = doc.id;
  const lvl = (name) => Model.levels().find((l) => l.name === name);
  const L = () => Model.all();
  const glReady = Render.ready();

  try {
    await t('open by id: the project loads, the empty state goes, the HUD shows the name', async () => {
      const ok = ViewerProject.open(id);
      await frames(6);
      return eq([ok, Model.doc().id, Model.source(), visible($('emptyState')), visible($('hud')), $('hudName').textContent, document.title], [true, id, 'saved', false, true, doc.name, `${doc.name} - Model Viewer`]);
    });
    await t('the HUD numbers are the summary numbers', () => {
      const m = Model.hud(), rows = Object.fromEntries(Model.rows().map((r) => [r.id, r.text]));
      return eq([$('mGfa').textContent, $('mUnits').textContent, $('mStalls').textContent, $('mEff').textContent.replace('%', ' percent'), $('mFar').textContent, $('hudBadge').textContent, m.warnings],
        [rows['massing.gfa'], rows['plates.units'], rows['parking.stalls'], rows['plates.efficiency'], rows['massing.far'], '0 warnings', 0]);
    });
    await t('the fixture project has data for every layer', () => eq(['site', 'massing', 'units', 'cores', 'parking', 'facade', 'grading'].map((k) => Model.hasData(k)), [true, true, true, true, true, true, true]));
    await t('the default layers draw: neighbors, massing slabs (podium only), 238 units, cores, parking; facade and grading are off', async () => {
      await frames(3);
      const d = drawn(), by = d.byLayer;
      return eq([by.site, by.units, !!by.massing, !!by.cores, !!by.parking, by.facade || 0, by.grading || 0], [2, 238, true, true, true, 0, 0]);
    });
    await t('every layer on: facade bands and the grading walls draw, and the site ground comes from the grading when it is on', async () => {
      for (const k of TOGGLE_LAYERS) State.setLayer(k, true);
      await frames(4);
      const by = drawn().byLayer;
      const info = Render.info();
      return eq([by.facade, by.grading > 5, by.units, info.site && info.site.ground, by.parking], [L().facade.items.length, true, 238, true, L().parking.items.length]);
    });
    await t('the stall count on screen is the parking metrics stalls', () => eq(Render.itemsDrawn().filter((x) => x.startsWith('stall:')).length, ProjectMod.getSection(doc, 'parking').derived.metrics.stalls));
    await t('the model is centered and on the ground: the scene origin is the site middle at the lowest ground', () => {
      const sh = Model.shift(), sb = Model.siteBounds();
      return eq([sh.x, sh.y, sh.z], [Math.round((sb.minX + sb.maxX) / 2), Math.round((sb.minY + sb.maxY) / 2), L().site.ground.zMin]);
    });
    await t('the Layers tab: a row for every layer, a switch that is on, with counts', () => {
      const rows = [...document.querySelectorAll('#tabpanel-layers .layer-row')].map((r) => r.dataset.layer);
      const on = [...document.querySelectorAll('#tabpanel-layers .toggle-row')].map((b) => b.getAttribute('aria-checked'));
      return eq([rows, on, document.querySelector('[data-layer="units"] .lr-count').textContent], [TOGGLE_LAYERS, TOGGLE_LAYERS.map(() => 'true'), '238 units']);
    });
    await t('Edit in links point to ../<tool>/?project=<id>', () => {
      const want = { site: 'site', massing: 'tower', units: 'plate', cores: 'plate', parking: 'parking', facade: 'facade', grading: 'grading' };
      const got = {};
      document.querySelectorAll('#tabpanel-layers a.edit-link').forEach((a) => { got[a.dataset.layer] = a.getAttribute('href'); });
      const exp = {};
      for (const k of Object.keys(want)) exp[k] = `../${want[k]}/?project=${id}`;
      const text = [...document.querySelectorAll('#tabpanel-layers a.edit-link')].map((a) => a.textContent);
      return eq([got, text[0], text[2]], [exp, 'Edit in Site Model', 'Edit in Plate Planner']);
    });
    await t('a switch hides a layer, and turns it back on (the real button)', async () => {
      const btn = document.querySelector('#tabpanel-layers .toggle-row[data-layer="units"]');
      btn.click(); await frames(4);
      const off = [btn.getAttribute('aria-checked'), drawn().byLayer.units || 0, Render.itemsDrawn().some((x) => x.startsWith('unit:'))];
      btn.click(); await frames(4);
      return eq([off, btn.getAttribute('aria-checked'), drawn().byLayer.units], [['false', 0, false], 'true', 238]);
    });
    await t('turning the site off removes the neighbors and the site ground', async () => {
      State.setLayer('site', false); await frames(4);
      const off = [drawn().byLayer.site || 0, Render.info().site && Render.info().site.ground];
      State.setLayer('site', true); await frames(4);
      return eq([off[0], !!Render.info().site, drawn().byLayer.site], [0, true, 2]);
    });
    await t('the scene follows the Model and Diagram toggle: Diagram colors by program, Model draws plain solids', async () => {
      State.set('colorBy', 'program');
      State.set('mode', 'diagram'); await frames(3);
      const unit = L().units.items[0], slab = L().massing.items[0];
      const diag = [Render.colorOfItem(slab.id), Render.colorOfItem(unit.id)];
      State.set('mode', 'model'); await frames(3);
      const plain = [Render.colorOfItem(slab.id), Render.colorOfItem(unit.id)];
      document.querySelector('#styleToggle [data-style="diagram"]').click(); await frames(3);
      return eq([diag[0], diag[1] !== plain[1], plain[0] === plain[1], $('styleToggle').querySelector('[aria-pressed="true"]').textContent], [colorOf(`program:${slab.program}`), true, true, 'Diagram']);
    });
    await t('Color by Unit type colors the units by their type; Source gives one color for each layer', async () => {
      const u = L().units.items.find((i) => i.type === '2BR'), u1 = L().units.items.find((i) => i.type !== '2BR');
      document.querySelector('#colorBy [data-color="unitType"]').click(); await frames(3);
      const byType = [Render.colorOfItem(u.id), Render.colorOfItem(u1.id)];
      document.querySelector('#colorBy [data-color="source"]').click(); await frames(3);
      const src = [Render.colorOfItem(u.id), Render.colorOfItem(u1.id), Render.colorOfItem(L().massing.items[0].id)];
      State.set('colorBy', 'program'); await frames(3);
      return eq([byType[0], byType[1], src[0] === src[1], src[0] !== src[2]], [colorOf('unit:2BR'), colorOf(`unit:${u1.type}`), true, true]);
    });
    await t('the legend lists the colors in use', () => eq([visible($('legend')), $('legend').querySelectorAll('.lg-row').length > 2], [true, true]));

    /* ---- level cut ---- */
    await t('Levels tab: a row for each level, highest first, All levels is on', () => {
      const rows = [...document.querySelectorAll('#levelList .level-row')].map((b) => b.dataset.level);
      return eq([rows, document.getElementById('cutAll').getAttribute('aria-pressed'), $('cutLabel').textContent], [Model.levels().map((l) => l.key).reverse(), 'true', 'All levels']);
    });
    await t('a level cut at a plate level: nothing above it draws, the cut level keeps its units and draws them by type', async () => {
      const lv = lvl('Floor 12');
      document.querySelector(`#levelList [data-level="${lv.key}"]`).click(); await frames(4);
      const ids = Render.itemsDrawn();
      const unitsDrawn = ids.filter((x) => x.startsWith('unit:'));
      const levelsDrawn = [...new Set(unitsDrawn.map((x) => Number(x.split(':')[1])))];
      const cutUnits = L().units.items.filter((i) => i.level === 12);
      const unitCol = Render.colorOfItem(cutUnits[0].id);
      const lowerUnit = L().units.items.find((i) => i.level === 8);
      const above = Model.layers().massing.items.some((i) => i.z0 > lv.z + 0.3) || Model.layers().units.items.some((i) => i.z0 > lv.z + 0.3);
      return eq([Math.max(...levelsDrawn), unitsDrawn.length, above, unitCol, Render.colorOfItem(lowerUnit.id), $('cutLabel').textContent.startsWith('Cut at Floor 12'), document.getElementById('cutAll').getAttribute('aria-pressed')],
        [12, L().units.items.filter((i) => i.level <= 12).length, false, colorOf(`unit:${cutUnits[0].type}`), colorOf(`program:${lowerUnit.program}`), true, 'false']);
    });
    await t('in the Model style the cut level still draws in plan colors, the floors below are plain', async () => {
      State.set('mode', 'model'); await frames(3);
      const cu = L().units.items.find((i) => i.level === 12), lo = L().units.items.find((i) => i.level === 8);
      const out = [Render.colorOfItem(cu.id), Render.colorOfItem(lo.id) !== Render.colorOfItem(cu.id)];
      State.set('mode', 'diagram'); await frames(3);
      return eq(out, [colorOf(`unit:${cu.type}`), true]);
    });
    await t('the slider moves the cut, and the top stop is All levels', async () => {
      const s = $('cutSlider'), n = Model.levels().length;
      s.value = '2'; s.dispatchEvent(new Event('input', { bubbles: true })); await frames(3);
      const low = [State.get('cutKey'), $('cutLabel').textContent];
      s.value = String(n); s.dispatchEvent(new Event('input', { bubbles: true })); await frames(3);
      return eq([low[0], low[1].startsWith('Cut at'), State.get('cutKey'), $('cutLabel').textContent, drawn().byLayer.units], [Model.levels()[2].key, true, null, 'All levels', 238]);
    });
    await t('Show in plan moves the camera to the Plan view in one tap', async () => {
      document.getElementById('cutPlan').click(); await frames(4); await wait(500);
      return eq([Render.info().preset, Render.info().camera, document.querySelector('#views [data-view="plan"]').getAttribute('aria-pressed')], ['plan', 'ortho', 'true']);
    });
    await t('All levels removes the cut', async () => {
      State.set('cutKey', lvl('Floor 12').key); await frames(2);
      document.getElementById('cutAll').click(); await frames(4);
      return eq([State.get('cutKey'), drawn().byLayer.units], [null, 238]);
    });
    await t('a cut at the lowest level keeps the neighbors and the site', async () => {
      State.set('cutKey', Model.levels()[0].key); await frames(4);
      const out = [drawn().byLayer.site, drawn().byLayer.units || 0];
      State.set('cutKey', null); await frames(3);
      return eq(out, [2, 0]);
    });

    /* ---- tap card ---- */
    await t('tap a unit: a card with its type, area, level and exposures, and the Edit in link', async () => {
      State.set('cutKey', lvl('Floor 12').key); await frames(2);
      Render.setView('plan', false); await frames(4);
      let hit = null, pt = null;
      for (const u of L().units.items.filter((i) => i.level === 12)) {
        const c = Render.centerOf(u), p = Render.screenOf(c.x, c.y, c.z);
        const got = Render.pickAt(p.x, p.y);
        if (got && got.id === u.id) { hit = u; pt = p; break; }
      }
      if (!hit) return 'no unit could be picked in the plan view';
      const picked = Render.click(pt.x, pt.y);
      await frames(2);
      const card = UI.cardInfo();
      const labels = hit.data.rows.filter((r) => r[1] !== '').map((r) => r[0]);
      return eq([picked.id, card.visible, card.title, labels.every((l) => card.text.includes(l)), ['Type', 'Area', 'Level', 'Exposures'].every((l) => card.text.includes(l)), card.edit, Render.selectedId()],
        [hit.id, true, hit.data.title, true, true, `../plate/?project=${id}`, hit.id]);
    });
    await t('tap the sky: the card closes', async () => {
      const r = Render.canvas().getBoundingClientRect();
      Render.click(r.left + 4, r.top + 4); await frames(2);
      return eq([UI.cardInfo().visible, Render.selectedId()], [false, null]);
    });
    await t('tap a massing level: the card has the program and the area', async () => {
      State.set('cutKey', lvl('Floor 3').key); await frames(2);
      Render.setView('plan', false); await frames(4);
      let hit = null, pt = null;
      for (const m of L().massing.items.filter((i) => i.level === 3)) {
        const c = Render.centerOf(m), p = Render.screenOf(c.x, c.y, c.z);
        const got = Render.pickAt(p.x, p.y);
        if (got && got.id === m.id) { hit = m; pt = p; break; }
      }
      if (!hit) return 'no massing level could be picked';
      Render.click(pt.x, pt.y); await frames(2);
      const card = UI.cardInfo();
      return eq([card.visible, card.title.length > 0, /Program/.test(card.text), /Plate area/.test(card.text), card.edit], [true, true, true, true, `../tower/?project=${id}`]);
    });
    await t('tap a stall: the card has its kind and the Parking Deck link', async () => {
      const pk = Model.levels().find((l) => l.sources.includes('parking') && l.name === 'Parking level 2');
      State.set('cutKey', pk.key); await frames(2);
      Render.setView('plan', false); await frames(4);
      let hit = null, pt = null;
      for (const s of L().parking.items.filter((i) => i.kind === 'stall' && i.level === 2).slice(0, 60)) {
        const c = Render.centerOf(s), p = Render.screenOf(c.x, c.y, c.z);
        const got = Render.pickAt(p.x, p.y);
        if (got && got.id === s.id) { hit = s; pt = p; break; }
      }
      if (!hit) return 'no stall could be picked';
      Render.click(pt.x, pt.y); await frames(2);
      const card = UI.cardInfo();
      return eq([card.visible, /Kind|Type/.test(card.text), card.edit], [true, true, `../parking/?project=${id}`]);
    });
    await t('the card for a facade face and a grading wall shows their numbers and links', async () => {
      const face = L().facade.items[0], wall = L().grading.items.find((i) => i.kind === 'wall');
      State.set('cutKey', null); await frames(2);
      UI.select(face);
      const a = UI.cardInfo();
      UI.select(wall);
      const b = UI.cardInfo();
      UI.select(null);
      return eq([face.data.rows.filter((r) => r[1] !== '').every((r) => a.text.includes(r[0])), a.edit, wall.data.rows.filter((r) => r[1] !== '').every((r) => b.text.includes(r[0])), b.edit], [true, `../facade/?project=${id}`, true, `../grading/?project=${id}`]);
    });
    await t('Cut at this level on the card sets the cut', async () => {
      const u = L().units.items.find((i) => i.level === 15);
      UI.select(u); await frames(2);
      const btn = $('cardCut');
      if (!btn) return 'no button';
      btn.click(); await frames(3);
      const out = State.get('cutKey');
      State.set('cutKey', null); UI.select(null); await frames(2);
      return eq(out, lvl('Floor 15').key);
    });

    /* ---- views and zoom ---- */
    await t('the view buttons set the preset: N, E, S, W, Plan, Axon', async () => {
      const out = [];
      for (const v of ['n', 'e', 's', 'w', 'plan', 'axon']) { document.querySelector(`#views [data-view="${v}"]`).click(); await frames(2); out.push(Render.info().preset); }
      await wait(500);
      return eq(out, ['n', 'e', 's', 'w', 'plan', 'axon']);
    });
    await t('Axon frames the model: the building sits inside the view and its base is above the bottom edge', async () => {
      Render.setView('axon', false); await frames(4);
      const b = Model.buildingBounds(), r = Render.canvas().getBoundingClientRect();
      const mid = Render.screenOf((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.zMin + b.zMax) / 2);
      const base = Render.screenOf((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.zMin);
      const top = Render.screenOf((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.zMax);
      const inside = (p) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
      const cx = (mid.x - r.left) / r.width, cy = (mid.y - r.top) / r.height;
      return eq([inside(mid), inside(base), inside(top), cx > 0.3 && cx < 0.7, cy > 0.25 && cy < 0.75, top.y < base.y], [true, true, true, true, true, true]);
    });
    await t('Site zooms out to the whole site square, Building zooms in to the building', async () => {
      Render.setView('axon', false); await frames(3);
      const d0 = Render.info().distance;
      $('tbZoomSite').click(); await wait(600);
      const dSite = Render.info().distance;
      $('tbZoomBuilding').click(); await wait(600);
      const dBuilding = Render.info().distance;
      const fs = Render.framedBox('site'), fb = Render.framedBox('building');
      return eq([dSite > dBuilding, fs.maxX - fs.minX >= fb.maxX - fb.minX, fs.maxX - fs.minX >= 1000 - 1, Number.isFinite(d0)], [true, true, true, true]);
    });

    /* ---- View tab ---- */
    await t('Site style: glass makes the neighbor blocks see-through, wireframe draws edges only, solid restores them', async () => {
      const mats = () => Render.sceneObjects().filter((o) => o.isMesh && o.userData.model && o.material.vertexColors);
      document.querySelector('#siteStyle [data-site-style="glass"]').click(); await frames(4);
      const glass = mats().some((o) => o.material.transparent && Math.abs(o.material.opacity - 0.25) < 1e-6);
      document.querySelector('#siteStyle [data-site-style="wireframe"]').click(); await frames(4);
      const wire = mats().some((o) => o.material.colorWrite === false);
      document.querySelector('#siteStyle [data-site-style="solid"]').click(); await frames(4);
      const solid = !mats().some((o) => o.material.transparent || o.material.colorWrite === false);
      return eq([glass, wire, solid, drawn().byLayer.site], [true, true, true, 2]);
    });
    await t('Sun: the date and time come from sun.derived and move the light', async () => {
      const sun = Model.sun();
      const first = Render.info().sun;
      document.querySelector(`#sunDates [data-sun-date="${sun.dates[1]}"]`).click(); await frames(4);
      const a = Render.info().sun, st1 = [State.get('sunDate'), State.get('sunTime')];
      document.querySelector('#sunTimes [data-sun-time="09:00"]').click(); await frames(4);
      const b = Render.info().sun;
      document.querySelector('#sunDates [data-sun-date=""]').click(); await frames(4);
      const c = Render.info().sun;
      return eq([sun.dates, st1[0], JSON.stringify(a) !== JSON.stringify(first), JSON.stringify(b) !== JSON.stringify(a), JSON.stringify(c) === JSON.stringify(first), State.get('sunDate')], [['2026-03-20', '2026-06-21', '2026-12-21'], sun.dates[1], true, true, true, null]);
    });
    await t('Shadows switch changes the light', async () => {
      const on = Render.info().shadows;
      $('shadowsToggle').click(); await frames(4);
      const off = Render.info().shadows;
      $('shadowsToggle').click(); await frames(4);
      return eq([on, off, Render.info().shadows], [true, false, true]);
    });

    /* ---- Summary tab ---- */
    await t('Summary tab: one table row for every summary row, the stale list, and the Caution', async () => {
      UI.setTab('summary'); await frames(2);
      const rows = [...document.querySelectorAll('#summaryTable tr[data-row]')].map((r) => r.dataset.row);
      return eq([rows, $('summaryCaution').textContent, !!document.querySelector('#staleList .none')], [Model.rows().map((r) => r.id), CONFIG.caution, true]);
    });
    await t('Summary tab numbers equal the saved metrics', () => {
      const cell = (id) => document.querySelector(`#summaryTable tr[data-row="${id}"] .sum-val`).textContent;
      const m = (k) => ProjectMod.getSection(doc, k).derived.metrics;
      return eq([cell('plates.units'), cell('parking.stalls'), cell('massing.floors')], [String(m('plates').units), String(m('parking').stalls), String(m('massing').floors)]);
    });
    await t('stale flags: plates made from an older massing give a warning in the HUD and in the Summary tab', async () => {
      const d = JSON.parse(JSON.stringify(doc));
      d.sections.massing.updatedAt = '2026-10-26T09:00:00.000Z';
      ViewerProject.openDoc(d, 'saved'); await frames(4);
      const li = document.querySelector('#staleList li[data-section="plates"]');
      const out = [!!li, li && /older massing/.test(li.textContent), $('hudBadge').textContent, $('hudBadge').dataset.n];
      ViewerProject.open(id); await frames(4);
      return eq([out[0], out[1], out[2].endsWith('warnings') || out[2].endsWith('warning'), out[3] !== '0', $('hudBadge').textContent], [true, true, true, true, '0 warnings']);
    });

    /* ---- No data ---- */
    await t('a project with only a site: the other layers say No data and offer "Open <tool>"', async () => {
      const d = JSON.parse(JSON.stringify(doc));
      for (const k of ['massing', 'plates', 'parking', 'facade', 'grading', 'sun']) delete d.sections[k];
      ViewerProject.openDoc(d, 'saved'); await frames(4);
      const row = (k) => document.querySelector(`#tabpanel-layers .layer-row[data-layer="${k}"]`);
      const open = (k) => row(k).querySelector('a.open-link');
      const out = [row('site').dataset.has, row('parking').dataset.has, /No data/.test(row('parking').textContent), open('parking') && open('parking').getAttribute('href'), open('parking') && open('parking').textContent, open('units') && open('units').getAttribute('href'), row('parking').querySelector('.toggle-row').disabled, /No data/.test($('tabpanel-levels').textContent), !!$('sunNone')];
      const drawnNow = Object.keys(drawn().byLayer);
      ViewerProject.open(id); await frames(4);
      return eq([out, drawnNow], [['true', 'false', true, `../parking/?project=${id}`, 'Open Parking Deck', `../plate/?project=${id}`, true, true, true], ['site']]);
    });
    await t('an empty project (no sections): every layer says No data, the HUD shows the name only', async () => {
      const d = ProjectMod.newProject({ name: 'Empty one' });
      ViewerProject.openDoc(d, 'saved'); await frames(4);
      const out = [[...document.querySelectorAll('#tabpanel-layers .layer-row')].map((r) => r.dataset.has), $('hudName').textContent, $('mGfa').textContent, drawn().items, Model.rows().length];
      ViewerProject.open(id); await frames(4);
      return eq(out, [TOGGLE_LAYERS.map(() => 'false'), 'Empty one', '-', 0, 1]);
    });

    /* ---- exports ---- */
    await t('Export > SketchUp: a valid document with source viewer and one group for each layer that is on', async () => {
      for (const k of TOGGLE_LAYERS) State.setLayer(k, false);
      State.setLayer('massing', true); State.setLayer('units', true); State.setLayer('parking', true);
      await frames(2);
      let got = null;
      const res = FileExports.sketchup({ deliver: (blob, name) => { got = { blob, name }; } });
      const d = JSON.parse(await got.blob.text());
      const v = SkFmt.validateDoc(d);
      const names = d.root.children.map((c) => c.name);
      return eq([res.ok, v.ok, d.source, names, /\.sketchup\.json$/.test(got.name)], [true, true, 'viewer', ['Massing', 'Units', 'Parking'], true]);
    });
    await t('Export > SketchUp with nothing on says so and makes no file', async () => {
      for (const k of TOGGLE_LAYERS) State.setLayer(k, false);
      let called = false;
      const res = FileExports.sketchup({ deliver: () => { called = true; } });
      for (const k of ['site', 'massing', 'units', 'cores', 'parking']) State.setLayer(k, true);
      await frames(3);
      return eq([res.ok, called], [false, false]);
    });
    await t('Export > Image makes a PNG with the overlay, AI-ready image makes a plain PNG', async () => {
      if (!glReady) return true;
      const a = await Shots.capture({ deliver: false, scale: 1 });
      const b = await Shots.aiReady({ deliver: false, scale: 1 });
      const flags = Render.captureFlags();
      return eq([a.type, a.size > 1000, b.type, b.size > 1000, flags.grid, flags.selection, flags.aiReady, Shots.buildOverlay().title, Shots.keyMetrics().some((m) => m[0] === 'GFA')], ['image/png', true, 'image/png', true, false, false, true, doc.name, true]);
    });
    await t('the AI-ready image paints the project building amber and the rest white, then restores the colors', async () => {
      if (!glReady) return true;
      const u = L().units.items[0], n = L().site.items[0];
      const before = [Render.colorOfItem(u.id), Render.colorOfItem(n.id)];
      let during = null;
      const orig = ShotMod.captureView;
      ShotMod.captureView = async (o) => { during = [Render.colorOfItem(u.id), Render.colorOfItem(n.id)]; return orig(o); };
      try { await Shots.aiReady({ deliver: false, scale: 1 }); } finally { ShotMod.captureView = orig; }
      await frames(2);
      const after = [Render.colorOfItem(u.id), Render.colorOfItem(n.id)];
      return eq([during, after], [[CONFIG.heroColor.toLowerCase(), CONFIG.whiteColor.toLowerCase()], before]);
    });
    await t('AI Prompts: the panel opens, the Hero render names amber, the text has no unfilled field, and it closes', async () => {
      Prompts.open(); await frames(3);
      const text = $('aiPreview').value;
      const out = [Prompts.isOpen(), /amber/.test(text), /\{\{|\[[a-z]+\]/.test(text), text.split(/\s+/).length > 80, !!$('aiStepImage'), !!$('aiStepCopy')];
      document.querySelector('[data-prompt="time-golden-hour"]').click(); await frames(2);
      const golden = $('aiPreview').value;
      Prompts.close(); await frames(2);
      return eq([out, /golden hour/i.test(golden), /23-floor|23 floors/.test(golden), Prompts.isOpen()], [[true, true, false, true, true, true], true, true, false]);
    });
    await t('Project > Export downloads the project as a file and saves nothing', async () => {
      const out = ViewerProject.exportFile();
      return eq([out.filename.endsWith('.cmrlm.json'), JSON.parse(await out.blob.text()).id], [true, id]);
    });
    await t('Import opens a project file in memory only: the Edit in links are off and the list does not change', async () => {
      const listBefore = JSON.stringify(ViewerProject.list());
      const d = JSON.parse(JSON.stringify(doc)); d.name = 'From a file';
      const r = await ViewerProject.importFile(JSON.stringify(d));
      await frames(4);
      const out = [Model.source(), r.doc.name, document.querySelectorAll('#tabpanel-layers a.edit-link').length, $('projPill').textContent, JSON.stringify(ViewerProject.list()) === listBefore];
      let bad = null;
      try { await ViewerProject.importFile('{"format":"nope"}'); } catch (e) { bad = e.message; }
      let bad2 = null;
      try { await ViewerProject.importFile('not json'); } catch (e) { bad2 = e.message; }
      ViewerProject.open(id); await frames(4);
      return eq([out, bad, bad2], [['file', 'From a file', 0, 'From a file (file, not saved)', true], 'This file is not a design tools project file.', 'This file is not valid JSON, so it is not a project file.']);
    });
    await t('the Project menu lists the saved projects and opens one', async () => {
      ViewerProject.close(); await frames(3);
      const emptyRows = [...document.querySelectorAll('#emptyList .proj-row')].map((b) => b.dataset.project);
      const wasEmpty = visible($('emptyState'));
      document.querySelector(`#emptyList [data-project="${id}"]`).click(); await frames(5);
      return eq([emptyRows.includes(id), wasEmpty, Model.doc().id, visible($('emptyState'))], [true, true, id, false]);
    });
    await t('a project that is not in the list does not open and says so', async () => {
      const ok = ViewerProject.open('no-such-project'); await frames(2);
      const toast = [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join('|');
      return eq([ok, /could not be opened/.test(toast) || toast.length > 0, Model.doc().id], [false, true, id]);
    });

    /* ---- the rule: view only ---- */
    await t('the page never writes the project: no write call, no key change, storage unchanged byte for byte', () => {
      const after = projectKeysSnapshot();
      return eq([calls, writes, after === before], [[], [], true]);
    });
  } finally {
    ProjectMod.writeSection = origs.writeSection; ProjectMod.saveProject = origs.saveProject; ProjectMod.importProject = origs.importProject; ProjectMod.deleteProject = origs.deleteProject; ProjectMod.sendTo = origs.sendTo;
    proto.setItem = origSet; proto.removeItem = origRem;
    // Clean up the seeded project, and put the list and the last-project key back as they were.
    ProjectMod.deleteProject(localStorage, id);
    try {
      if (prevIndex === null) localStorage.removeItem('cmrlm.project.index'); else localStorage.setItem('cmrlm.project.index', prevIndex);
      if (prevLast === null) localStorage.removeItem('cmrlm.project.last'); else localStorage.setItem('cmrlm.project.last', prevLast);
    } catch (e) { /* ignore */ }
  }
  TestHelp.merged('viewer.project', results);
  return results;
}

async function runAllTests() {
  const a = await runPageTests();
  const b = await runProjectTests();
  const all = [...a, ...b];
  const failed = all.filter((r) => !r.ok);
  console.log(`[tests] viewer ${all.length - failed.length}/${all.length} passed`);
  return { total: all.length, failed };
}
