/* ==========================================================================
   UI
   Top bar, panel tabs (Layers, Levels, View, Summary), HUD, legend, tap card, preset views, empty state, bottom sheet.
   The UI reads State and Model and writes only State. It never writes the project.
   ========================================================================== */
const UI = (() => {
  const TABS = [{ id: 'layers', title: 'Layers' }, { id: 'levels', title: 'Levels' }, { id: 'view', title: 'View' }, { id: 'summary', title: 'Summary' }];
  const NOUNS = { site: 'neighbor buildings', massing: 'level slabs', units: 'units', cores: 'core and corridor pieces', parking: 'parking pieces', grading: 'ground and wall pieces' };
  const sheetQuery = window.matchMedia('(max-width: 899px), (orientation: portrait)');
  let activeTab = TABS.some((t) => t.id === uiPrefs.tab) ? uiPrefs.tab : 'layers';
  const scrollPos = {};
  const refs = { layerRows: {}, levelRows: [], sunDates: null, sunTimes: null };
  let sliding = false;
  let sheetRaise = () => {};
  const raiseSheet = () => sheetRaise();
  const fmt = (n, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

  /** The tool that owns a layer's data. The massing layer follows the tool that made the massing section. */
  function toolFor(layerId) {
    if (layerId === 'massing') {
      try { const s = ProjectMod.getSection(Model.doc(), 'massing'); if (s && typeof s.tool === 'string' && TOOL_NAMES[s.tool]) return s.tool; } catch (e) { /* use the default */ }
    }
    return LAYER_TOOLS[layerId];
  }
  const toolName = (tool) => TOOL_NAMES[tool] || tool;

  /* ---- top bar ---------------------------------------------------------------------------- */
  function buildTopBar() {
    const proj = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnProject', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Project: open, import, export', 'aria-label': 'Project menu', onclick: () => ViewerProject.openMenu(proj) },
      h('span', { html: ICONS.folder, style: 'display:contents' }), h('span', { class: 'btn-text', id: 'projLabel' }, 'Project'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbProject').append(proj);

    const seg = $('styleToggle');
    const mk = (value, text, title) => h('button', { type: 'button', 'data-style': value, 'aria-pressed': 'false', title, onclick: () => State.set('mode', value) }, text);
    seg.append(mk('model', 'Model', 'Plain solids'), mk('diagram', 'Diagram', 'Solids colored by the View tab choice'));

    const exp = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnExport', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Export: image, AI prompts, SketchUp', 'aria-label': 'Export menu', onclick: () => openExportMenu(exp) },
      h('span', { html: ICONS.export, style: 'display:contents' }), h('span', { class: 'btn-text' }, 'Export'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbExport').append(exp);
    $('tbHelp').append(h('button', { class: 'btn icon', type: 'button', id: 'btnHelp', title: 'Help', 'aria-label': 'Help', html: ICONS.help, onclick: () => Help.toggle() }));
  }

  function openExportMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'exportMenu' });
    const has = !!Model.doc();
    const item = (id, title, sub, onclick) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', id, disabled: !has, onclick: () => { Pop.close(); onclick(); } }, h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null));
    el.append(h('div', { class: 'label pop-label' }, 'Pictures'),
      item('miImage', 'Image', 'Save a PNG of this view', () => Shots.take()),
      item('miAiReady', 'AI-ready image', 'Plain model, no grid. For ChatGPT or Gemini.', () => Shots.takeAiReady()),
      item('miAiPrompts', 'AI Prompts', 'A prompt to pair with the AI-ready image', () => Prompts.toggle()),
      h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Files'),
      item('miSketchup', 'SketchUp (.json)', 'The layers that are on. Import with the CMRLM extension.', () => FileExports.sketchup()));
    Pop.open(anchor, el, { align: 'right' });
  }

  /* ---- tabs ---------------------------------------------------------------------------------- */
  function buildTabs() {
    const bar = $('panelTabs');
    bar.textContent = '';
    for (const t of TABS) {
      bar.append(h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'data-tab': t.id, 'aria-controls': `tabpanel-${t.id}`, 'aria-selected': 'false', tabindex: '-1', onclick: () => { setTab(t.id); raiseSheet(); } }, t.title));
    }
    bar.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const i = TABS.findIndex((t) => t.id === activeTab);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      setTab(TABS[next].id);
      $(`tab-${TABS[next].id}`).focus();
    });
    const host = $('sections');
    host.textContent = '';
    for (const t of TABS) host.append(h('div', { class: 'tabpanel', role: 'tabpanel', id: `tabpanel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, hidden: true }));
  }
  function setTab(id, { remember = true } = {}) {
    if (!TABS.some((t) => t.id === id)) return false;
    const scroller = $('panelScroll');
    if (id !== activeTab) scrollPos[activeTab] = scroller.scrollTop;
    activeTab = id;
    for (const t of TABS) {
      const on = t.id === id;
      $(`tab-${t.id}`).setAttribute('aria-selected', on ? 'true' : 'false');
      $(`tab-${t.id}`).tabIndex = on ? 0 : -1;
      $(`tabpanel-${t.id}`).hidden = !on;
    }
    scroller.scrollTop = scrollPos[id] || 0;
    if (remember && uiPrefs.tab !== id) { uiPrefs.tab = id; saveUiPrefs(); }
    return true;
  }

  /* ---- the Layers tab ------------------------------------------------------------------------ */
  const countText = (id) => {
    const all = Model.all();
    if (!all || !all[id] || !all[id].ok) return '';
    const items = all[id].items;
    if (id === 'site') return [all.site.ground ? 'ground' : null, items.length ? plural(items.length, 'neighbor building', 'neighbor buildings') : null].filter(Boolean).join(', ');
    if (id === 'parking') { const s = items.filter((i) => i.kind === 'stall').length; return `${plural(s, 'stall', 'stalls')}, ${plural(items.length - s, 'other piece', 'other pieces')}`; }
    if (id === 'grading') return `${all.grading.items.some((i) => i.kind === 'ground') ? 'proposed ground, ' : ''}${plural(items.filter((i) => i.kind === 'wall').length, 'wall piece', 'wall pieces')}`;
    return plural(items.length, NOUNS[id].replace(/s$/, ''), NOUNS[id]);
  };
  function buildLayers() {
    const host = $('tabpanel-layers');
    host.textContent = '';
    refs.layerRows = {};
    if (!Model.doc()) { host.append(noProject()); return; }
    host.append(h('p', { class: 'help tab-note' }, 'Turn layers on or off. The viewer never changes the project. To change a layer, edit it in its tool.'));
    for (const id of TOGGLE_LAYERS) {
      const tool = toolFor(id), has = Model.hasData(id);
      const link = Model.editLink(tool);
      const toggle = h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'data-layer': id, 'aria-checked': 'false', disabled: !has, onclick: () => State.setLayer(id, !State.get('layers')[id]) },
        h('span', { class: 'lr-name' }, LAYER_LABELS[id], h('small', { class: 'lr-count' }, has ? countText(id) : 'No data')), h('span', { class: 'switch', 'aria-hidden': 'true' }));
      const note = has
        ? (link ? h('a', { class: 'edit-link', href: link, 'data-layer': id, 'data-tool': tool }, `Edit in ${toolName(tool)}`) : h('span', { class: 'help' }, 'This file is open in the viewer only. Save the project in a tool to edit it.'))
        : h('div', { class: 'layer-nodata' }, h('span', { class: 'help' }, `No data. The ${toolName(tool)} has not saved this layer.`), link ? h('a', { class: 'open-link', href: link, 'data-layer': id, 'data-tool': tool }, `Open ${toolName(tool)}`) : null);
      const row = h('div', { class: 'layer-row', 'data-layer': id, 'data-has': has ? 'true' : 'false' }, toggle, note);
      refs.layerRows[id] = { row, toggle };
      host.append(row);
    }
  }
  function syncLayers() {
    for (const id of TOGGLE_LAYERS) { const r = refs.layerRows[id]; if (r) r.toggle.setAttribute('aria-checked', String(!!State.get('layers')[id] && Model.hasData(id))); }
  }

  /* ---- the Levels tab ---------------------------------------------------------------------- */
  const sourceText = (s) => ({ massing: 'massing', plates: 'plates', parking: 'parking' }[s] || s);
  function buildLevels() {
    const host = $('tabpanel-levels');
    host.textContent = '';
    refs.levelRows = [];
    refs.slider = refs.sliderLabel = refs.allBtn = refs.planBtn = null;
    if (!Model.doc()) { host.append(noProject()); return; }
    const levels = Model.levels();
    if (!levels.length) { host.append(h('p', { class: 'help tab-note', id: 'levelsNone' }, 'No data. This project has no levels yet. Make a massing in the Tower Generator or the Mid-Rise Generator.')); return; }
    host.append(h('p', { class: 'help tab-note' }, 'Cut the model at a level. Solids above the level hide. The cut level draws in plan colors.'));
    refs.allBtn = h('button', { class: 'chip', type: 'button', id: 'cutAll', 'aria-pressed': 'true', onclick: () => State.set('cutKey', null) }, 'All levels');
    refs.planBtn = h('button', { class: 'chip', type: 'button', id: 'cutPlan', title: 'Look straight down at the model', onclick: () => Render.setView('plan', true) }, 'Show in plan');
    host.append(h('div', { class: 'chips' }, refs.allBtn, refs.planBtn));
    refs.slider = h('input', { class: 'range', type: 'range', id: 'cutSlider', min: '0', max: String(levels.length), step: '1', value: String(levels.length), 'aria-label': 'Level cut' });
    refs.sliderLabel = h('div', { class: 'cut-label', id: 'cutLabel', 'aria-live': 'polite' }, 'All levels');
    refs.slider.addEventListener('input', () => {
      sliding = true;
      const v = Number(refs.slider.value);
      State.set('cutKey', v >= levels.length ? null : levels[v].key);
      sliding = false;
    });
    host.append(h('div', { class: 'ctl' }, refs.sliderLabel, h('div', { class: 'ctl-row' }, refs.slider)));
    const list = h('div', { class: 'level-list', id: 'levelList' });
    for (const lv of levels.slice().reverse()) {
      const btn = h('button', { class: 'level-row', type: 'button', 'data-level': lv.key, 'aria-pressed': 'false', onclick: () => State.set('cutKey', State.get('cutKey') === lv.key ? null : lv.key) },
        h('span', { class: 'lv-name' }, lv.name), h('span', { class: 'lv-z' }, `${fmt(lv.z, 1)} ft`), h('span', { class: 'lv-src' }, lv.sources.map(sourceText).join(' + ')));
      refs.levelRows.push({ key: lv.key, btn });
      list.append(btn);
    }
    host.append(list);
  }
  function syncLevels() {
    if (!refs.slider) return;
    const key = State.get('cutKey'), levels = Model.levels();
    const idx = key ? levels.findIndex((l) => l.key === key) : -1;
    const value = idx >= 0 ? idx : levels.length;
    if (!sliding && Number(refs.slider.value) !== value) refs.slider.value = String(value);
    refs.slider.style.setProperty('--pf', String(value / Math.max(1, levels.length)));
    refs.allBtn.setAttribute('aria-pressed', String(idx < 0));
    refs.sliderLabel.textContent = idx >= 0 ? `Cut at ${levels[idx].name}, ${fmt(levels[idx].z, 1)} ft` : 'All levels';
    for (const r of refs.levelRows) r.btn.setAttribute('aria-pressed', String(r.key === key));
  }

  /* ---- the View tab ---------------------------------------------------------------------------- */
  const chipRow = (id, pairs, get, set, attr) => {
    const row = h('div', { class: 'chips', id });
    for (const [value, text, title] of pairs) row.append(h('button', { class: 'chip', type: 'button', [attr]: value, title, 'aria-pressed': 'false', onclick: () => set(value) }, text));
    row.sync = () => row.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(get()))));
    return row;
  };
  function buildView() {
    const host = $('tabpanel-view');
    host.textContent = '';
    refs.viewRows = [];
    if (!Model.doc()) { host.append(noProject()); return; }
    const add = (el) => { host.append(el); if (el.sync) refs.viewRows.push(el); return el; };
    host.append(h('div', { class: 'label sub-label' }, 'Color by'));
    add(chipRow('colorBy', [['program', 'Program', 'Residential, retail, parking, and so on'], ['unitType', 'Unit type', 'Studio, 1BR, 2BR, and so on'], ['source', 'Source', 'One color for each layer']], () => State.get('colorBy'), (v) => State.set('colorBy', v), 'data-color'));
    host.append(h('p', { class: 'help' }, 'The Diagram style uses this choice. The Model style draws plain solids. The cut level always draws in plan colors.'));
    host.append(h('div', { class: 'label sub-label' }, 'Site style'));
    add(chipRow('siteStyle', [['solid', 'Solid'], ['glass', 'Glass'], ['wireframe', 'Wireframe']], () => State.get('siteStyle'), (v) => State.set('siteStyle', v), 'data-site-style'));
    host.append(h('p', { class: 'help' }, 'Sets how the neighbor buildings draw. Solid draws grey blocks. Glass draws see-through blocks. Wireframe draws edges only.'));
    const sh = h('button', { class: 'toggle-row', type: 'button', role: 'switch', id: 'shadowsToggle', 'aria-checked': 'true', onclick: () => State.set('shadows', !State.get('shadows')) }, h('span', null, 'Shadows'), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    sh.sync = () => sh.setAttribute('aria-checked', String(!!State.get('shadows')));
    add(sh);
    host.append(h('div', { class: 'label sub-label' }, 'Sun'));
    const sun = Model.sun();
    if (!sun.dates.length) {
      const link = Model.editLink('tower');
      host.append(h('div', { class: 'layer-nodata', id: 'sunNone' }, h('span', { class: 'help' }, 'No data. The Tower Generator has not saved sun times for this project.'), link ? h('a', { class: 'open-link', href: link, 'data-layer': 'sun', 'data-tool': 'tower' }, `Open ${toolName('tower')}`) : null));
    } else {
      add(chipRow('sunDates', [['', 'Sun off'], ...sun.dates.map((d) => [d, d])], () => State.get('sunDate') || '', (v) => {
        if (!v) State.setSun(null, null);
        else { const first = (sun.byDate[v] || [])[0]; const keep = (sun.byDate[v] || []).find((x) => x.time === State.get('sunTime')); State.setSun(v, keep ? keep.time : (sun.byDate[v][Math.min(1, sun.byDate[v].length - 1)] || first).time); }
      }, 'data-sun-date'));
      const times = chipRow('sunTimes', [...new Set([].concat(...sun.dates.map((d) => sun.byDate[d].map((x) => x.time))))].sort().map((t) => [t, t]), () => State.get('sunTime') || '', (v) => { if (State.get('sunDate')) State.setSun(State.get('sunDate'), v); }, 'data-sun-time');
      add(times);
      host.append(h('p', { class: 'help', id: 'sunNote' }, 'Pick a date and a time from the Tower Generator sun study. The light and the shadows follow it.'));
    }
  }
  function syncView() {
    for (const el of refs.viewRows || []) el.sync();
    const times = $('sunTimes');
    if (times) times.querySelectorAll('button').forEach((b) => { b.disabled = !State.get('sunDate'); });
  }

  /* ---- the Summary tab ----------------------------------------------------------------------------- */
  function buildSummary() {
    const host = $('tabpanel-summary');
    host.textContent = '';
    if (!Model.doc()) { host.append(noProject()); return; }
    const stale = Model.stale();
    host.append(h('div', { class: 'label sub-label' }, 'Warnings'));
    const warns = h('ul', { class: 'warns', id: 'staleList' });
    if (!stale.length && !Model.notes().length) warns.append(h('li', { class: 'none' }, 'No warnings.'));
    for (const f of stale) warns.append(h('li', { class: 'warn-warn', 'data-section': f.section }, f.message, ...(Model.editLink(f.section === 'plates' ? 'plate' : f.section) ? [' ', h('a', { class: 'edit-link', href: Model.editLink(f.section === 'plates' ? 'plate' : f.section) }, `Open ${toolName(f.section === 'plates' ? 'plate' : f.section)}`)] : [])));
    for (const n of Model.notes()) warns.append(h('li', { class: 'warn-info' }, n));
    host.append(warns);
    host.append(h('div', { class: 'label sub-label' }, 'Numbers'));
    const table = h('table', { class: 'sum-table', id: 'summaryTable' });
    let group = null;
    const rows = Model.rows();
    for (const r of rows) {
      if (r.group !== group) { group = r.group; table.append(h('tr', { class: 'sum-group' }, h('th', { colspan: '2' }, group))); }
      table.append(h('tr', { 'data-row': r.id }, h('td', null, r.label), h('td', { class: 'sum-val' }, r.text)));
    }
    host.append(table);
    host.append(h('p', { class: 'help caution', id: 'summaryCaution' }, CONFIG.caution));
  }

  function noProject() { return h('p', { class: 'help tab-note no-project' }, 'No project is open. Choose a project in the Project menu.'); }

  /* ---- HUD ------------------------------------------------------------------------------------------- */
  function buildHud() {
    const hud = $('hud');
    const open = !!uiPrefs.hudOpen;
    hud.dataset.collapsed = open ? 'false' : 'true';
    hud.innerHTML = `
      <button class="hud-toggle" id="hudToggle" type="button" aria-expanded="${open}" aria-controls="hudBody" title="Show or hide the warnings">
        <span class="hud-top">
          <span class="label" id="hudName">Project</span>
          <span class="hud-badge" id="hudBadge" data-n="0" title="Warnings">0 warnings</span>
          ${CARET_SVG}
        </span>
        <span class="hud-core">
          <span class="m"><span class="k">GFA</span><span class="v" id="mGfa">-</span></span>
          <span class="m"><span class="k">Units</span><span class="v" id="mUnits">-</span></span>
          <span class="m"><span class="k">Stalls</span><span class="v" id="mStalls">-</span></span>
          <span class="m"><span class="k">Efficiency</span><span class="v" id="mEff">-</span></span>
          <span class="m"><span class="k">FAR</span><span class="v" id="mFar">-</span></span>
        </span>
      </button>
      <div class="hud-body" id="hudBody"><ul class="warns" id="hudWarns"></ul><p class="help caution" id="hudCaution"></p></div>`;
    $('hudToggle').addEventListener('click', () => {
      const next = hud.dataset.collapsed === 'true';
      hud.dataset.collapsed = next ? 'false' : 'true';
      $('hudToggle').setAttribute('aria-expanded', String(next));
      uiPrefs.hudOpen = next; saveUiPrefs();
    });
  }
  const setText = (id, text) => { const el = $(id); if (el && el.textContent !== text) el.textContent = text; };
  function syncHud() {
    const hud = $('hud');
    const has = !!Model.doc();
    hud.hidden = !has;
    if (!has) return;
    const m = Model.hud();
    setText('hudName', m.name);
    setText('mGfa', m.gfa || '-'); setText('mUnits', m.units || '-'); setText('mStalls', m.stalls || '-');
    setText('mEff', m.efficiency ? m.efficiency.replace(' percent', '%') : '-'); setText('mFar', m.far || '-');
    const badge = $('hudBadge');
    badge.dataset.n = String(m.warnings);
    setText('hudBadge', `${m.warnings} ${m.warnings === 1 ? 'warning' : 'warnings'}`);
    const list = $('hudWarns');
    list.textContent = '';
    if (!Model.stale().length) list.append(h('li', { class: 'none' }, 'No warnings.'));
    for (const f of Model.stale()) list.append(h('li', { class: 'warn-warn' }, f.message));
    setText('hudCaution', CONFIG.caution);
  }

  /* ---- legend ------------------------------------------------------------------------------------------ */
  function syncLegend() {
    const box = $('legend');
    const seen = new Map();
    for (const id of TOGGLE_LAYERS) for (const it of Model.shown(id)) {
      const key = Paint.keyOf(it);
      if (!key || seen.has(key)) continue;
      seen.set(key, colorOf(key));
    }
    box.textContent = '';
    if (!Model.doc() || !seen.size) { box.hidden = true; return; }
    box.hidden = false;
    box.append(h('div', { class: 'label' }, State.get('mode') === 'model' ? 'Cut level' : 'Colors'));
    for (const [key, color] of [...seen].slice(0, 14)) box.append(h('div', { class: 'lg-row', 'data-key': key }, h('span', { class: 'sw', style: `background:${color}` }), h('span', null, Paint.labelOf(key))));
  }

  /* ---- the tap card ------------------------------------------------------------------------------------- */
  function showCard(item) {
    const card = $('selection-card');
    card.textContent = '';
    if (!item) { card.hidden = true; return; }
    const d = item.data || { title: item.id, rows: [] };
    const tool = item.tool || LAYER_TOOLS[item.layer];
    const link = Model.editLink(tool);
    const lv = Number.isFinite(item.z0) ? Model.levels().find((l) => Math.abs(l.z - item.z0) <= 1) : null;
    card.append(
      h('div', { class: 'sc-head' },
        h('div', { class: 'sc-titles' }, h('div', { class: 'sc-name', id: 'cardTitle' }, d.title), h('div', { class: 'sc-sub' }, `${LAYER_LABELS[item.layer] || item.layer}, ${toolName(tool)}`)),
        h('button', { class: 'ibtn', type: 'button', id: 'cardClose', 'aria-label': 'Close the card', title: 'Close', html: ICONS.x, onclick: () => select(null) })),
      h('dl', { class: 'kv', id: 'cardRows' }, ...(d.rows || []).filter((r) => r[1] !== '' && r[1] != null).flatMap((r) => [h('dt', null, r[0]), h('dd', null, String(r[1]))])),
      h('div', { class: 'sc-actions' },
        link ? h('a', { class: 'btn outline edit-link', id: 'cardEdit', href: link, 'data-tool': tool }, `Edit in ${toolName(tool)}`) : h('span', { class: 'help' }, 'Save the project in a tool to edit it.'),
        lv ? h('button', { class: 'btn outline', type: 'button', id: 'cardCut', onclick: () => State.set('cutKey', lv.key) }, 'Cut at this level') : null));
    card.hidden = false;
    raiseSheet();
  }
  function select(item) {
    Render.select(item || null);
    showCard(item || null);
    State.changed();
  }
  function checkSelection() {
    const id = Render.selectedId();
    if (id && !Model.itemById(id)) select(null);
  }

  /* ---- preset views ------------------------------------------------------------------------------------- */
  function buildViews() {
    const nav = $('views');
    const items = [['axon', 'Axon'], ['n', 'N'], ['e', 'E'], ['s', 'S'], ['w', 'W'], ['plan', 'Plan']];
    const labels = { axon: 'Axonometric view', n: 'North elevation', e: 'East elevation', s: 'South elevation', w: 'West elevation', plan: 'Plan view' };
    for (const [id, text] of items) nav.append(h('button', { type: 'button', 'data-view': id, 'aria-pressed': 'false', title: labels[id], 'aria-label': labels[id], onclick: () => Render.setView(id, true) }, text));
    Render.onViewChange((active) => nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === active ? 'true' : 'false')));
  }

  /* ---- the empty state and the project label ------------------------------------------------------------- */
  function syncEmpty() {
    const has = !!Model.doc();
    $('emptyState').hidden = has;
    $('views').hidden = !has;
    const list = $('emptyList');
    list.textContent = '';
    if (!has) list.append(...ViewerProject.listButtons());
    const pill = $('projPill');
    pill.hidden = !has;
    if (has) { pill.textContent = Model.source() === 'file' ? `${Model.hud().name} (file, not saved)` : Model.hud().name; pill.title = pill.textContent; }
    setText('projLabel', 'Project');
    document.title = has ? `${Model.hud().name} - Model Viewer` : 'Model Viewer';
  }

  /* ---- sync ---------------------------------------------------------------------------------------------- */
  function syncMode() {
    $('styleToggle').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === State.get('mode') ? 'true' : 'false'));
  }
  function syncAll() {
    syncMode(); syncLayers(); syncLevels(); syncView(); syncHud(); syncLegend(); checkSelection();
  }
  let builtFor = -1;
  function rebuildForModel() {
    builtFor = Model.version();
    buildLayers(); buildLevels(); buildView(); buildSummary();
    showCard(null);
    syncEmpty();
    for (const t of TABS) $(`tabpanel-${t.id}`).hidden = t.id !== activeTab;
    syncAll();
  }

  /* ---- the bottom sheet (iPad portrait and narrow screens) ------------------------------------------------- */
  function initSheet() {
    const app = $('app'), grabber = $('grabber');
    const GRAB = 44;
    const total = () => app.clientHeight;
    const lowest = () => GRAB + ($('panelTabs').offsetHeight || 45) + 2;
    const snaps = () => [lowest(), Math.round(total() * 0.42), Math.round(total() * 0.86)];
    const setH = (px) => app.style.setProperty('--sheet-h', `${Math.round(clamp(px, lowest(), total() * 0.9))}px`);
    const curH = () => $('panel').getBoundingClientRect().height;
    const animateTo = (to) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setH(to);
      const from = curH(), t0 = performance.now();
      const step = (now) => { const p = clamp((now - t0) / 180, 0, 1); setH(from + (to - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    let drag = null;
    grabber.addEventListener('pointerdown', (e) => { grabber.setPointerCapture(e.pointerId); drag = { y: e.clientY, h: curH(), moved: false }; });
    grabber.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) setH(drag.h + dy);
    });
    const end = () => {
      if (!drag) return;
      const s = snaps(), now = curH();
      if (!drag.moved) animateTo(s.find((v) => v > now + 8) || s[0]);
      else animateTo(s.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a)));
      drag = null;
    };
    grabber.addEventListener('pointerup', end);
    grabber.addEventListener('pointercancel', end);
    grabber.addEventListener('keydown', (e) => { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); setH(curH() + (e.key === 'ArrowUp' ? 60 : -60)); });
    const reset = () => { if (sheetQuery.matches) setH(total() * 0.42); else app.style.removeProperty('--sheet-h'); };
    (sheetQuery.addEventListener ? sheetQuery.addEventListener('change', reset) : sheetQuery.addListener(reset));
    reset();
    window.addEventListener('resize', () => { if (sheetQuery.matches) { const px = parseFloat(app.style.getPropertyValue('--sheet-h')); if (px) setH(px); } });
    sheetRaise = () => { if (sheetQuery.matches && curH() < lowest() + 24) animateTo(snaps()[1]); };
  }

  function init() {
    buildTopBar();
    buildTabs();
    buildViews();
    buildHud();
    initSheet();
    setTab(activeTab, { remember: false });
    Render.onPick((item) => select(item));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !Pop.isOpen() && !Prompts.isOpen() && Render.selectedId()) select(null); });
    State.subscribe(syncAll);
    ViewerProject.onChange(() => { rebuildForModel(); });
    rebuildForModel();
  }
  /** For tests. */
  return {
    init, setTab, activeTab: () => activeTab, select, showCard, toolFor, rebuildForModel, syncAll,
    cardInfo: () => { const c = $('selection-card'); return { visible: !c.hidden, title: ($('cardTitle') || {}).textContent || '', text: c.textContent, edit: $('cardEdit') ? $('cardEdit').getAttribute('href') : null }; },
  };
})();
