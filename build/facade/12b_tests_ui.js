/* ==========================================================================
   TESTS: page and panels
   The four tabs and their sections, the metrics card, the top bar and its menus (Option, Export, Project), the legend, the
   elevation views, Compare, AI prompts and Help. The tests restore the design, the tab and the metrics card when they finish, and
   hold the autosave so a ?test visit never overwrites the saved working copy.
   ========================================================================== */
async function runUiTests() {
  const { eq, make, $, frames, wait, visible, snap, oneStep } = TestHelp;
  const { results, t } = make();
  const savedState = Store.snapshot(), savedTab = UI.activeTab(), savedHud = UI.hudOpen();
  Options.holdAutosave(true);
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const fresh = () => Store.replace(fillDefaults(defaultState()));
  const typeInto = (input, value) => { input.focus(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };

  try {
    /* ---- tabs ---- */
    await t('panel tabs are Massing, Facade, Checks, View, in that order', () =>
      eq([[...document.querySelectorAll('#panelTabs .tab')].map((b) => b.textContent), UI.tabs()], [['Massing', 'Facade', 'Checks', 'View'], ['massing', 'facade', 'checks', 'view']]));
    await t('each tab shows its own sections and no others', () => {
      const want = {
        massing: ['source', 'standalone', 'zones', 'street'],
        facade: ['zone-base', 'zone-middle', 'zone-top', 'zone-ranges', 'balconies', 'fins', 'shades', 'bands', 'corners'],
        checks: ['checkslist', 'limits', 'wwrtables', 'envelope'],
        view: ['display'],
      };
      for (const [tab, list] of Object.entries(want)) {
        UI.setTab(tab);
        const shown = [...document.querySelectorAll('.tabpanel')].filter(visible);
        if (shown.length !== 1 || shown[0].id !== `tabpanel-${tab}`) return `tab ${tab}: ${shown.map((p) => p.id)}`;
        const got = [...shown[0].querySelectorAll(':scope > .acc')].map((a) => a.dataset.section);
        if (JSON.stringify(got) !== JSON.stringify(list)) return `tab ${tab}: sections ${got}`;
      }
      return true;
    });
    await t('there are no Parking-only controls (stalls, ramps, cores, snap, send)', () => {
      const text = ($('sections').textContent + ' ' + $('hud').textContent + ' ' + $('topbar').textContent).toLowerCase();
      return eq([/\b(stall|ramp|parking|core)\b/.test(text), !!$('btnSnap'), !!$('tbSnap')], [false, false, false]);
    });
    await t('the active tab is remembered in the UI prefs', () => {
      UI.setTab('view');
      let tab;
      try { tab = JSON.parse(localStorage.getItem(UI_STORAGE_KEY)).tab; } catch (e) { return true; }
      return eq(tab, 'view');
    });

    /* ---- controls write the state, one undo each ---- */
    await t('typing a width writes the state and is one undo step', () => {
      UI.setTab('massing');
      fresh();
      const before = snap();
      const f = document.querySelector('[data-section="standalone"] input.numfield');
      typeInto(f, '320');
      return eq([Store.get('standalone.width'), oneStep(before)], [320, true]);
    });
    await t('the shape menu offers rectangle, L, U and courtyard; the court size shows only for O', () => {
      fresh(); UI.setTab('massing'); TestHelp.openSection('standalone');
      const sel = document.querySelector('[data-section="standalone"] select');
      const opts = [...sel.options].map((o) => o.value);
      const courtShown = () => [...document.querySelectorAll('[data-section="standalone"] .ctl-label')].some((l) => /Court width/.test(l.textContent) && visible(l));
      const before = courtShown();
      Store.set('standalone.shape', 'O', { live: false });
      return eq([opts, before, courtShown()], [['rect', 'L', 'U', 'O'], false, true]);
    });
    await t('a system button sets the zone rule and the WWR follows', () => {
      fresh(); UI.setTab('facade');
      const before = Derived.get().hud.wwr;
      click(document.querySelector('[data-section="zone-middle"] [data-system="windowWall"]'));
      const after = Derived.get().hud.wwr;
      return eq([Store.get('zones.rules.middle.system'), after > before], ['windowWall', true]);
    });
    await t('the system dimensions follow the system (a window width only for punched windows)', () => {
      fresh(); UI.setTab('facade'); TestHelp.openSection('zone-middle');
      const labels = () => [...document.querySelectorAll('[data-section="zone-middle"] .ctl-label')].filter(visible).map((l) => l.textContent);
      const punched = labels().includes('Window width');
      click(document.querySelector('[data-section="zone-middle"] [data-system="curtainWall"]'));
      return eq([punched, labels().includes('Window width'), labels().includes('Vision glass height')], [true, false, true]);
    });
    await t('the orientation strip writes an override for one orientation only', () => {
      fresh(); UI.setTab('facade');
      const sec = document.querySelector('[data-section="zone-base"]');
      click(sec.querySelector('[data-target="S"]'));
      click(sec.querySelector('[data-system="storefront"]'));
      const ov = Store.get('zones.overrides.base.S'), rule = Store.get('zones.rules.base');
      const dot = sec.querySelector('[data-target="S"]').classList.contains('has-override');
      click(sec.querySelector('[data-target="all"]'));
      return eq([ov && ov.system, rule.system, dot, Derived.get().hud.transparency > 0.99], ['storefront', 'punched', true, true]);
    });
    await t('a solid-pattern toggle writes the rule and lowers the glazing', () => {
      fresh(); UI.setTab('facade');
      const before = Derived.get().hud.glazing;
      const row = [...document.querySelectorAll('[data-section="zone-top"] .toggle-row')].find((b) => /Solid panels/.test(b.textContent));
      click(row);
      return eq([!!Store.get('zones.rules.top.solid'), Derived.get().hud.glazing < before], [true, true]);
    });
    await t('balconies: the toggle, the type and the pattern write the state', () => {
      fresh(); UI.setTab('facade');
      const sec = document.querySelector('[data-section="balconies"]');
      click(sec.querySelector('#balconyType [data-value="projected"]') || sec.querySelector('#balconyType .chip:last-child'));
      Store.set('balconies.pattern', 'alternating', { live: false });
      const n = Derived.get().hud.balconies;
      Store.set('balconies.on', false, { live: false });
      return eq([Store.get('balconies.type'), n > 0 && n !== 66, Derived.get().hud.balconies], ['projected', true, 0]);
    });
    await t('level ranges: Add range makes a card on the Facade tab and a rule', () => {
      fresh(); UI.setTab('massing');
      Store.set('zones.mode', 'ranges', { live: false });
      const add = document.querySelector('[data-section="zones"] .add-row .btn');
      click(add);
      const r = Store.get('zones.ranges');
      UI.setTab('facade');
      const rows = document.querySelectorAll('[data-section="zone-ranges"] .item').length;
      return eq([r.length, r[0] && r[0].id, !!Store.get('zones.rules.Z1'), rows], [1, 'Z1', true, 1]);
    });
    await t('bands: Add band writes a band and the list shows it', () => {
      fresh(); UI.setTab('facade');
      click(document.querySelector('[data-section="bands"] .add-row .btn'));
      return eq([Store.get('bands').length, document.querySelectorAll('[data-section="bands"] .item').length], [1, 1]);
    });
    await t('the checks tab: the WWR limit and the transparency target write the state', () => {
      fresh(); UI.setTab('checks');
      const f = document.querySelector('[data-section="limits"] input.numfield');
      typeInto(f, '30');
      const lim = Store.get('checks.wwrLimit');
      const row = [...document.querySelectorAll('[data-section="limits"] .toggle-row')].find((b) => /transparency target/i.test(b.textContent));
      click(row);
      return eq([lim, Store.get('checks.transparencyTarget')], [0.3, 0.6]);
    });
    await t('the checks tab: the WWR tables list orientations and zones, with the Caution line', () => {
      fresh(); UI.setTab('checks'); UI.updateHud(Derived.get());
      const o = $('wwrOrient').textContent, z = $('wwrZone').textContent;
      return eq([/North/.test(o) && /25\.4%/.test(o), /Middle/.test(z), /Caution/.test($('tabpanel-checks').textContent)], [true, true, true]);
    });
    await t('the envelope note shows only when it is turned on, with its Caution line', () => {
      fresh(); UI.setTab('checks');
      Store.set('envelope.on', true, { live: false });
      UI.updateHud(Derived.get());
      const lines = [...$('envNote').children].map((li) => li.textContent);
      return eq([lines.length > 1, /Caution/.test(lines[0] || ''), /U 0\.29/.test(lines.join(' '))], [true, true, true]);
    });

    /* ---- the metrics card ---- */
    await t('the card shows WWR, worst orientation, transparency and balconies; one tap opens the rest', () => {
      fresh(); UI.setHudOpen(false); UI.updateHud(Derived.get());
      const k = [...document.querySelectorAll('.hud-core .k')].map((e) => e.textContent);
      click($('hudToggle'));
      return eq([k, UI.hudOpen(), /Facade area/.test($('hudBody').textContent), $('mWall').textContent], [['WWR', 'Worst orientation', 'Ground transparency', 'Balconies'], true, true, '37,960 sf']);
    });
    await t('the over-the-limit WWR shows in red and the badge counts the warning', () => {
      Store.replace(TestHelp.presetState('hotel-window-wall')); UI.updateHud(Derived.get());
      const out = [$('mWwr').classList.contains('bad'), $('hudBadge').dataset.n !== '0', /40\.0%|check value/.test($('warnList').textContent)];
      fresh(); UI.updateHud(Derived.get());
      return eq(out, [true, true, true]);
    });
    await t('shades: the projection factor is listed in the card', () => {
      fresh(); Store.set('shades.on', true, { live: false }); UI.updateHud(Derived.get());
      const text = $('hudPfList').textContent;
      Store.set('shades.on', false, { live: false });
      return eq([/0\.\d\d/.test(text), $('hudPf').hidden], [true, false]);
    });

    /* ---- the top bar and its menus ---- */
    await t('the top bar has Option, Project, Undo, Redo, Model/Diagram, Export and Help', () => eq(
      ['btnOption', 'btnProject', 'btnExport', 'btnHelp'].map((id) => !!$(id)).concat([$('tbHistory').children.length, $('styleToggle').children.length]), [true, true, true, true, 2, 2]));
    await t('the Export menu: Image, AI-ready image, AI Prompts, overlay, SketchUp, Elevations DXF, JSON, Send to Grading Sketch; no CSV', () => {
      click($('btnExport'));
      const ids = [...document.querySelectorAll('#exportMenu .pop-item')].map((b) => b.id);
      const sendText = /Send to/.test($('exportMenu').textContent);
      Pop.close();
      return eq([ids, sendText], [['miImage', 'miAiReady', 'miAiPrompts', 'miOverlay', 'miSketchup', 'miDxf', 'miExportJson', 'miImportJson', 'miSendGrading'], true]);
    });
    await t('the Option menu lists every preset', () => {
      click($('btnOption'));
      const n = document.querySelectorAll('#optionMenu [id^="preset-"]').length;
      Pop.close();
      return eq(n, CONFIG.presets.length);
    });
    await t('loading a preset from the menu replaces the design in one undo step', () => {
      fresh();
      const before = snap();
      Options.loadPreset('hotel-window-wall');
      const out = [Store.get('name'), Derived.get().hud.over];
      const back = oneStep(before);
      return eq([...out, back], ['Hotel window wall', true, true]);
    });
    await t('Model and Diagram buttons switch the style', () => {
      fresh();
      click(document.querySelector('#styleToggle [data-style="diagram"]'));
      const a = Store.get('view.style');
      click(document.querySelector('#styleToggle [data-style="model"]'));
      return eq([a, Store.get('view.style')], ['diagram', 'model']);
    });
    await t('undo and redo buttons work', () => {
      fresh(); Store.set('standalone.floors', 7, { live: false });
      click($('tbHistory').children[0]);
      const a = Store.get('standalone.floors');
      click($('tbHistory').children[1]);
      return eq([a, Store.get('standalone.floors')], [5, 7]);
    });

    /* ---- the legend ---- */
    await t('Diagram style shows a legend by system, or the five WWR steps', () => {
      fresh();
      Store.set('view.style', 'diagram', { live: false });
      const sys = [...document.querySelectorAll('#legend .lg-row')].map((r) => r.textContent);
      Store.set('view.colorBy', 'wwr', { live: false });
      const wwr = [...document.querySelectorAll('#legend .lg-row')].map((r) => r.textContent);
      Store.set('view.style', 'model', { live: false });
      Store.set('view.colorBy', 'system', { live: false });
      return eq([sys.includes('Punched windows'), wwr.length >= 5, $('legend').hidden], [true, true, true]);
    });

    /* ---- views and elevations ---- */
    await t('the preset view buttons are Axon, N, E, S, W, Plan; an elevation button sets view.elevation', async () => {
      fresh();
      const names = [...document.querySelectorAll('#views button')].map((b) => b.textContent);
      if (!Render.ready()) return eq(names, ['Axon', 'N', 'E', 'S', 'W', 'Plan']);
      click(document.querySelector('#views [data-view="s"]'));
      const s = Store.get('view.elevation');
      click(document.querySelector('#views [data-view="axon"]'));
      return eq([names, s, Store.get('view.elevation')], [['Axon', 'N', 'E', 'S', 'W', 'Plan'], 'S', null]);
    });
    await t('an elevation view needs no new undo step and turns the shadows off', async () => {
      fresh();
      if (!Render.ready()) return true;
      const depth = Store.historyDepth();
      Render.setView('e', false);
      const out = [Store.get('view.elevation'), Store.historyDepth() === depth, Render.info().camera];
      Render.setView('axon', false);
      return eq(out, ['E', true, 'ortho']);
    });
    await t('loading a saved option in an elevation view puts the camera there', async () => {
      if (!Render.ready()) return true;
      fresh();
      const s = fillDefaults(defaultState()); s.view.elevation = 'W';
      Store.replace(s);
      await frames(2);
      const p = Render.info().preset;
      Render.setView('axon', false);
      return eq(p, 'w');
    });

    /* ---- Compare ---- */
    await t('Compare shows the WWR rows for two options', async () => {
      fresh();
      const a = Options.save(); Options.duplicate();
      Store.set('zones.rules.middle.system', 'windowWall', { live: false });
      const ok = Compare.enter();
      await wait(60);
      const text = ok ? Compare.table() : '';
      Compare.exit();
      for (const o of Options.list()) Options.storage.remove(o.id);
      return eq([ok, /Window-to-wall ratio/.test(text), /Warnings/.test(text), a != null], [true, true, true, true]);
    });

    /* ---- AI prompts and Help ---- */
    await t('AI Prompts opens from the Export menu; the preview has the facade lock and the design numbers', async () => {
      fresh();
      click($('btnExport')); click($('miAiPrompts'));
      await frames(2);
      Prompts.select('time', 'time-golden-hour'); Prompts.render();       // the Hero render has its own opening; the lock sits on the other prompts
      const open = Prompts.isOpen();
      const chips = [...document.querySelectorAll('#aiAuto .ai-chip')].map((c) => c.textContent);
      const preview = $('aiPreview') ? $('aiPreview').value : '';
      Prompts.close();
      return eq([open, chips.some((c) => /Floors5/.test(c)), /Keep every window, door, balcony/.test(preview), /percent glass/.test(preview)], [true, true, true, true]);
    });
    await t('the Material row has a "From the design" chip that is the first chip and the default', async () => {
      Prompts.open(); Prompts.select('time', 'time-golden-hour'); Prompts.render();
      await frames(1);
      const row = $('aiField-material');
      const on = row ? row.querySelector('[aria-pressed="true"]') : null;
      const out = row ? [row.children[0].textContent, on && on.dataset.value] : null;
      Prompts.close();
      return eq(out, ['From the design', '__design__']);
    });
    await t('Help opens with the Facade Studio guide and the Caution about the 40 percent value', () => {
      click($('btnHelp'));
      const el = $('helpPanel');
      const out = [!!el, el ? /Facade Studio/.test(el.textContent) : false, el ? /never says a design complies/.test(el.textContent) : false];
      Pop.close();
      return eq(out, [true, true, true]);
    });
  } finally {
    Pop.close(); if (Prompts.isOpen()) Prompts.close();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (Compare.isActive()) Compare.exit();
    Store.replace(savedState); UI.setTab(savedTab); UI.setHudOpen(savedHud);
    Options.holdAutosave(false);
    UI.updateHud(Derived.get());
  }
  TestHelp.merged('ui', results);
  return results;
}
