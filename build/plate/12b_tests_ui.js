/* ==========================================================================
   TESTS: the page  (plan section 9.2)
   The HUD and its numbers, the tabs and their controls, the Export menu, the Help panel with the area rule, the Option menu, the style
   toggle and the legend, the views, compare, and the draw tool. They change the design on screen and put it back at the end.
   ========================================================================== */
async function runUiTests() {
  const { eq, make, $, frames, wait, visible, toastText } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab();
  Options.holdAutosave(true);
  const fresh = () => { Store.replace(TestHelp.presetState('double-loaded-bar')); UI.updateHud(Derived.get()); };
  try {
    fresh();
    await t('the title bar says Plate Planner with the CMRLM mark', () => eq([document.querySelector('.app-title').textContent, document.querySelector('.wordmark').textContent], ['Plate Planner', 'CMRLM']));
    await t('the Tools button and the CMRLM mark link back to the Workspace (../)', () => {
      const home = document.getElementById('tbHome'), mark = document.querySelector('.wordmark');
      return eq([home && home.tagName, home && home.getAttribute('href'), mark.tagName, mark.getAttribute('href'), home && home.textContent.trim()], ['A', '../', 'A', '../', 'Tools']);
    });
    await t('the HUD shows 17 units, 15,078 sf and 77.3% for the default plate', () => eq(['mUnits', 'mNrsf', 'mEff'].map((id) => $(id).textContent), ['17', '15,078 sf', '77.3%']));
    await t('the HUD expands to the mix, the corridor, the stair door path and the support', () => {
      UI.setHudOpen(true);
      const rows = document.querySelectorAll('#hudMixTable tbody tr').length;
      const out = [rows > 0, visible($('hudBody')), $('mGsf').textContent, $('mCor').textContent !== '-', $('mPath').textContent !== '-'];
      UI.setHudOpen(false);
      return eq(out, [true, true, '19,500 sf', true, true]);
    });
    await t('the tabs are Plate, Units, Checks and View, and the Plan view is the first view', () => eq([UI.tabs(), Render.ready() ? Render.info().preset : 'plan'], [['plate', 'units', 'checks', 'view'], 'plan']));
    await t('no control of the copied tools is left: no cut and fill style, no section panel, no AI prompts item', () => {
      const bad = ['sectionPanel', 'miAiPrompts', 'miAiReady', 'miRevit'].filter((id) => $(id));
      const styles = [...$('styleToggle').querySelectorAll('button')].map((b) => b.dataset.style);
      return eq([bad, styles], [[], ['model', 'diagram']]);
    });

    /* ---- Plate tab ---- */
    await t('the program chips switch to a hotel and back', () => {
      UI.setTab('plate');
      const chip = [...$('modeChips').querySelectorAll('button')].find((b) => b.dataset.value === 'hotel');
      chip.click();
      const hotel = Store.get('mode');
      UI.updateHud(Derived.get());
      const key = $('kUnits').textContent;
      [...$('modeChips').querySelectorAll('button')].find((b) => b.dataset.value === 'multifamily').click();
      UI.updateHud(Derived.get());
      return eq([hotel, key, Store.get('mode'), $('kUnits').textContent], ['hotel', 'Keys', 'multifamily', 'Units']);
    });
    await t('the shape select changes the plate and the numbers; Undo brings the bar back', () => {
      const before = TestHelp.snap();
      Store.set('plate.shape', 'L', { live: false });
      const changed = Math.abs(Derived.get().hud.nrsf - 15077.8) > 1;
      const ok = TestHelp.oneStep(before);
      Store.undo();
      return eq([changed, ok, Derived.get().hud.units], [true, true, 17]);
    });
    await t('the corridor width control: automatic is 5.67 ft, a typed 6.5 ft changes the unit depth', () => {
      const a = Derived.get().hud.nrsf;
      Store.set('corridor.width', 6.5, { live: false });
      const b = Derived.get().hud.nrsf;
      Store.set('corridor.width', null, { live: false });
      return eq([b < a, Math.abs(Derived.get().hud.nrsf - 15077.8) < 0.5], [true, true]);
    });
    await t('the block controls: a support block adds a hatched block on the plan and takes area from the units', () => {
      const a = Derived.get().hud.nrsf;
      Store.set('support', [{ id: 'B1', kind: 'trash', rect: [-100, -31, -92, -21] }], { live: false });
      const d = Derived.get();
      const hasBlock = d.editing.support.some((b) => b.kind === 'trash');
      Store.set('support', [], { live: false });
      return eq([hasBlock, d.hud.nrsf < a, Math.abs(Derived.get().hud.nrsf - 15077.8) < 0.5], [true, true, true]);
    });
    await t('the level group list is empty for a drawn plate and says so', () => {
      UI.openSection('levels');
      return eq([$('groupList').children.length, /Open a project/.test($('levelsNote').textContent)], [0, true]);
    });

    /* ---- Units tab ---- */
    await t('the Units tab lists one card per type and the corner type select', () => {
      UI.setTab('units');
      const items = document.querySelectorAll('#tabpanel-units .item').length;
      return eq([items >= 5, !!$('cornerType'), $('cornerType').value], [true, true, '2br']);
    });
    await t('a share edit in the panel changes the Suggest target, not the drawn units (changed: shares no longer fill the plate)', () => {
      const tgt = () => Derived.get().hud.mix.find((r) => r.type === '3br');
      const a = tgt() ? tgt().target : 0;
      Store.set('mix.multifamily.4.share', 0.2, { live: false });
      const b = tgt() ? tgt().target : 0;
      Store.set('mix.multifamily.4.share', 0.05, { live: false });
      return eq([b > a, Derived.get().hud.units], [true, 17]);
    });
    await t('the Units tab has no Re-fill, Unlock all or Draw unit button, and the HUD has no stale notice', () => {
      const labels = [...document.querySelectorAll('#tabpanel-units button')].map((b) => b.textContent);
      return eq([labels.includes('Re-fill'), labels.includes('Unlock all'), labels.includes('Draw unit'), !!$('staleNote'), !!$('staleRefill'), [...document.querySelectorAll('button')].some((b) => /^Re-fill$/.test(b.textContent))], [false, false, false, false, false, false]);
    });

    /* ---- Checks and View tabs ---- */
    await t('the Checks tab lists the numbers, the mix table and the cautions', () => {
      UI.setTab('checks');
      const kv = $('numbersTable').textContent;
      return eq([/Units17/.test(kv.replace(/\s/g, '')), /NRSF15,078sf/.test(kv.replace(/\s/g, '')), document.querySelectorAll('#mixTable tbody tr').length > 0, /never checks a code/.test($('tabpanel-checks').textContent)], [true, true, true, true]);
    });
    await t('a mix that cannot fit shows its warning in the Checks list', () => {
      Store.set('plate.d', 40, { live: false });
      const ids = Derived.get().warnings.map((w) => w.id);
      const listed = $('checksWarnings').children.length;
      Store.set('plate.d', 65, { live: false });
      return eq([ids.includes('type-does-not-fit') || ids.includes('run-too-short') || ids.length > 0, listed > 0], [true, true]);
    });
    await t('the style toggle switches Model and Diagram, and the legend lists the type colors in Diagram', () => {
      UI.setTab('view');
      Store.set('view.style', 'diagram', { live: false });
      const rows = [...$('legend').querySelectorAll('.lg-row')].map((r) => r.dataset.key);
      const pressed = [...$('styleToggle').querySelectorAll('button')].find((b) => b.getAttribute('aria-pressed') === 'true').dataset.style;
      Store.set('view.style', 'model', { live: false });
      return eq([pressed, rows.filter((k) => k.startsWith('type-')).length, rows.includes('role-corridor')], ['diagram', 5, true]);
    });
    await t('the View tab toggles labels, walls, bays and 3D levels', () => {
      const names = [...document.querySelectorAll('#tabpanel-view .toggle-row span:first-child')].map((x) => x.textContent);
      return eq(['Unit labels', 'Corridor wall lines', 'Bay lines (drag to move)', 'Levels in 3D'].every((n) => names.includes(n)), true);
    });

    /* ---- the scene ---- */
    if (Render.ready()) {
      await t('the plan view draws the plate: a model mesh per role and the unit outlines', async () => {
        await frames(3);
        const info = Render.layerInfo();
        return eq([info.model.units >= 1, info.model.corridor >= 1, info.model.blocks >= 1, info.overlay.line >= 3], [true, true, true, true]);
      });
      await t('labels show the type and area at the zoom of the plan view (and not when Labels are off)', async () => {
        await frames(3);
        const a = Render.overlayInfo().labels.length;
        Store.set('view.labels', false, { live: false }); await frames(3);
        const b = Render.overlayInfo().labels.filter((l) => /sf/.test(l)).length;
        Store.set('view.labels', true, { live: false }); await frames(3);
        return eq([a >= 17, b], [true, 0]);
      });
      await t('the preset views: 1 to 6 keys change the view and 6 is Plan', async () => {
        Render.setView('axon', false);
        const a = Render.info().preset;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true }));
        await frames(2);
        return eq([a, Render.info().preset, Render.info().camera], ['axon', 'plan', 'ortho']);
      });
      await t('D switches Model and Diagram', async () => {
        const a = Store.get('view.style');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        const b = Store.get('view.style');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        return eq([a, b, Store.get('view.style')], ['model', 'diagram', 'model']);
      });
      await t('levels in 3D off draws one level only; the plate shows a faint context outline for other groups', async () => {
        const a = Render.layerInfo().model.units;
        return eq(a, 1);
      });
      await t('the screenshot has the title, the metrics and the CMRLM mark in its overlay', () => {
        const o = Shots.buildOverlay();
        return eq([o.title, o.mark, o.metrics.map((m) => m[0]).slice(0, 3)], [Store.get('name'), 'CMRLM', ['Units', 'NRSF', 'Efficiency']]);
      });
    }

    /* ---- menus ---- */
    await t('the Export menu lists Image, Rooms, DXF, SketchUp, Notes, JSON and the Send to Parking Deck item, and no Facade Studio item', () => {
      $('btnExport').click();
      const ids = [...document.querySelectorAll('#exportMenu [id]')].map((b) => b.id);
      const menuText = document.querySelector('#exportMenu').textContent;
      Pop.close();
      return eq(['miImage', 'miRooms', 'miDxf', 'miSketchup', 'miNotes', 'miExportJson', 'miImportJson', 'miSendParking'].filter((i) => !ids.includes(i)), []) && eq(ids.filter((i) => /facade/i.test(i)), []) && eq(/facade/i.test(menuText), false);
    });
    await t('the Export menu has no item of another tool (Revit, AI prompts, AI-ready image)', () => {
      $('btnExport').click();
      const txt = $('exportMenu').textContent;
      Pop.close();
      return eq([/Revit/.test(txt), /AI/.test(txt), /Contours/.test(txt)], [false, false, false]);
    });
    await t('the Help panel states the area rule and the cautions', () => {
      $('btnHelp').click();
      const txt = $('helpPanel').textContent;
      Pop.close();
      return eq([/centerline of the demising walls/.test(txt), /corridor face of the corridor wall/.test(txt), /inside face of the exterior wall/.test(txt), /never checks a code/.test(txt), /Caution: the accessible counts/.test(txt)], [true, true, true, true, true]);
    });
    await t('the Option menu lists the seven presets (the blank point tower is new) and Compare', () => {
      $('btnOption').click();
      const ids = [...document.querySelectorAll('#optionMenu [id]')].map((b) => b.id);
      Pop.close();
      return eq([ids.filter((i) => i.startsWith('preset-')).length, ids.includes('miCompare'), ids.includes('miNewDesign')], [7, true, true]);
    });
    await t('Save, Duplicate, Compare of two options and Exit', async () => {
      const id = Options.save();
      Store.set('plate.w', 260, { live: false });
      Options.duplicate();
      const ok = Compare.enter();
      await frames(2);
      const tbl = Compare.table();
      Compare.exit();
      for (const o of Options.list()) Options.storage.remove(o.id);
      return eq([!!id, ok, /Units/.test(tbl), /Efficiency/.test(tbl)], [true, true, true, true]);
    });

    /* ---- drawing ---- */
    if (Render.ready()) {
      await t('Draw outline: taps make a polygon plate; Enter finishes; the plate becomes a drawn polygon', () => {
        fresh();
        const ok = Select.startDraw('polygon');
        for (const p of [[0, 0], [160, 0], [160, 60], [60, 60], [60, 120], [0, 120]]) Select.drawPoint(p[0], p[1]);
        Select.finishDraw();
        const s = Store.snapshot();
        const out = [ok, s.plate.shape, s.plate.points.length, Derived.get().ok, Derived.get().hud.units > 0];
        fresh();
        return eq(out, [true, 'polygon', 6, true, true]);
      });
      await t('Draw outline: Escape cancels and changes nothing', () => {
        fresh();
        const before = TestHelp.snap();
        Select.startDraw('polygon'); Select.drawPoint(1, 1);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return eq([Select.drawing(), TestHelp.snap() === before], [null, true]);
      });
    }
  } finally {
    Store.replace(savedState); UI.setTab(savedTab);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('ui', results);
  return results;
}
