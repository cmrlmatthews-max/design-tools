/* ==========================================================================
   UI
   Mid-rise panels (Form, Program, View, Site), top bar, metrics HUD, preset view buttons, sheet.
   ========================================================================== */
const ICONS = {
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
  compare: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  option: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z"/><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z"/></svg>',
  snap: '<svg viewBox="0 0 24 24"><path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3z"/><path d="M6 7h4M14 7h4"/></svg>',
  export: '<svg viewBox="0 0 24 24"><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M3 5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.8"/><path d="M12 17h.01"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>',
};
const UI_STORAGE_KEY = 'midrise.ui.v1';

function loadUiPrefs() { try { return JSON.parse(localStorage.getItem(UI_STORAGE_KEY)) || {}; } catch (e) { return {}; } }
const uiPrefs = loadUiPrefs();
function saveUiPrefs(p) { try { localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* storage unavailable: the tool still works */ } }

/* ---- small shared widgets: toast, popover, confirm ------------------------------ */
const Toast = (() => {
  function show(message, kind = '', ms = 3600) {
    const host = document.getElementById('toasts');
    const t = h('div', { class: `toast ${kind}`.trim() }, message);
    t.addEventListener('click', () => t.remove());
    host.append(t);
    while (host.children.length > 4) host.firstChild.remove();
    if (ms > 0) setTimeout(() => t.remove(), ms);
    return t;
  }
  return { show };
})();

const Pop = (() => {
  let cur = null;
  function close() {
    if (!cur) return;
    const c = cur; cur = null;
    c.el.remove();
    document.removeEventListener('pointerdown', c.onDown, true);
    document.removeEventListener('keydown', c.onKey, true);
    c.anchor.setAttribute('aria-expanded', 'false');
    if (c.onClose) c.onClose();
  }
  /** Opens `el` under `anchor`. Returns false (and closes) when that anchor's popover was already open. */
  function open(anchor, el, opts = {}) {
    const wasSame = cur && cur.anchor === anchor;
    close();
    if (wasSame) return false;
    el.classList.add('pop');
    el.style.visibility = 'hidden';
    document.body.append(el);
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth;
    let left = opts.align === 'right' ? r.right - w : r.left;
    left = clamp(left, 8, Math.max(8, window.innerWidth - w - 8));
    const top = Math.min(r.bottom + 6, window.innerHeight - 120);
    el.style.left = `${left}px`; el.style.top = `${top}px`;
    el.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;
    el.style.visibility = '';
    anchor.setAttribute('aria-expanded', 'true');
    const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    cur = { el, anchor, onDown, onKey, onClose: opts.onClose };
    return true;
  }
  return { open, close, isOpen: () => !!cur };
})();

/** Small modal question. Resolves true for the confirm button. */
function confirmDialog(message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'solid'}`, type: 'button', onclick: () => done(true) }, okLabel);
    const cancel = h('button', { class: 'btn outline', type: 'button', onclick: () => done(false) }, 'Cancel');
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', onKey, true);
    back.append(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('p', null, message), h('div', { class: 'pop-actions' }, cancel, ok)));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done(false); });
    document.body.append(back);
    ok.focus();
  });
}

const UI = (() => {
  const $ = (id) => document.getElementById(id);
  const sheetQuery = window.matchMedia('(max-width: 899px), (orientation: portrait)');
  const prefs = uiPrefs;
  const MAXD = CONFIG.limits.maxDim;
  const bs = (path) => Controls.bindStore(Store, path);
  const round1 = (v) => String(Math.round(v * 10) / 10);

  /* ---- control shortcuts ------------------------------------------------------- */
  const lenS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: MAXD,
    format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  const lenF = (label, path, extra = {}) => lenS(label, path, 0, 1, { compact: true, ...extra });   // compact (number field only)
  const offS = (label, path, lim = 200) => lenS(label, path, -lim, lim, { hardMin: -MAXD });          // may be negative
  const intS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: CONFIG.limits.maxFloors, integer: true,
    format: Units.formatInt, inputMode: 'numeric', ...extra,
  });
  const degS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: -3600, hardMax: 3600,
    format: (v) => `${round1(v)}°`, inputMode: 'decimal', ...extra,
  });
  const numS = (label, path, min, max, step, digits, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step, hardMin: 0, hardMax: 1e7,
    format: (v) => Units.formatRatio(v, digits), inputMode: 'decimal', ...extra,
  });
  const sel = (label, path, options, bind) => Controls.select({ label, bind: bind || bs(path), options });
  const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const els = (list) => list.filter((c) => c != null && c !== false).map((c) => c.el || c);
  const mkList = (o) => Controls.list({ ...o, render: (i) => { const p = o.render(i); return { children: els(p.children || []), more: els(p.more || []) }; } });
  const get = (path) => Store.get(path);
  const progColor = (k) => ((get(`programs.${k}`) || {}).color) || ((CONFIG.programs[k] || {}).color) || '#999';
  const barColor = (i) => CONFIG.barColors[i % CONFIG.barColors.length];
  const progOptions = (keys) => keys.map((k) => ({ value: k, label: CONFIG.programs[k].label }));
  let barList = null, courtList = null, ctxList = null;       // the row lists, kept so openItem can open a row

  /** A text field bound to a store path. */
  function textField(label, path, { maxlength = 60, placeholder = '' } = {}) {
    const input = h('input', { class: 'pop-name', type: 'text', maxlength: String(maxlength), spellcheck: 'false', autocomplete: 'off', placeholder, 'aria-label': label });
    input.addEventListener('change', () => { Store.set(path, input.value.trim().slice(0, maxlength), { live: false }); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    const refresh = () => { if (document.activeElement !== input) input.value = String(get(path) == null ? '' : get(path)); };
    const ctl = { el: h('div', { class: 'ctl text-row' }, h('label', { class: 'ctl-label' }, label), input), refresh };
    // register with the controls refresher through a hidden "when" (it refreshes with every other control)
    return Controls.when(() => { refresh(); return true; }, [ctl.el]);
  }

  /* ---- panel sections ------------------------------------------------------------- */
  function buildTemplates() {
    const btn = h('button', { class: 'btn outline', type: 'button', id: 'btnTemplates', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => Templates.openMenu(btn) },
      'Templates', h('span', { html: ICONS.chev, style: 'display:contents' }));
    const cur = h('span', { class: 'help', id: 'templateCurrent', style: 'margin:0 0 0 8px' });
    Store.subscribe(() => { const t = get('type'); cur.textContent = t ? `Current: ${t}` : ''; });
    return {
      children: [
        Controls.help('Start from a layout. A template replaces the bars, courts, deck and podium and keeps the site. Undo brings the last layout back.'),
        h('div', { class: 'add-row' }, btn, cur),
      ],
    };
  }

  /** Drag a bar row by its title to reorder it. Delegated, so it survives row rebuilds. */
  function enableBarDrag(list) {
    const host = list.el;
    let from = -1;
    const rows = () => [...host.querySelectorAll('.item[data-index]')];
    const mark = () => rows().forEach((r) => { const head = r.querySelector('.item-head'); if (head) head.draggable = true; });
    const obs = new MutationObserver(mark);
    obs.observe(host, { childList: true, subtree: true });
    mark();
    host.addEventListener('dragstart', (e) => {
      const row = e.target.closest && e.target.closest('.item[data-index]');
      if (!row) return;
      from = +row.dataset.index;
      row.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); } catch (err) { /* not supported */ }
    });
    host.addEventListener('dragover', (e) => { if (from >= 0) { e.preventDefault(); const row = e.target.closest && e.target.closest('.item[data-index]'); rows().forEach((r) => r.classList.toggle('drop-target', r === row && +r.dataset.index !== from)); } });
    host.addEventListener('dragend', () => { from = -1; rows().forEach((r) => r.classList.remove('dragging', 'drop-target')); });
    host.addEventListener('drop', (e) => {
      const row = e.target.closest && e.target.closest('.item[data-index]');
      const to = row ? +row.dataset.index : -1;
      rows().forEach((r) => r.classList.remove('dragging', 'drop-target'));
      if (from >= 0 && to >= 0 && to !== from) reorderBars(from, to);
      from = -1;
    });
  }
  /** Moves bar `from` to position `to` (one undo step). */
  function reorderBars(from, to) {
    const bars = deepClone(Store.raw().bars);
    if (!bars[from] || to < 0 || to >= bars.length) return false;
    bars.splice(to, 0, bars.splice(from, 1)[0]);
    return Store.set('bars', bars, { live: false });
  }

  function buildBars() {
    const groundBind = (i) => ({
      get: () => get(`bars.${i}.groundProgram`) || '',
      set: (v) => Store.set(`bars.${i}.groundProgram`, v === '' ? null : v, { live: false }),
      commit: () => {},
    });
    const widthBind = (i) => Controls.mapBind(bs(`bars.${i}.unitWidth`), (v) => (v == null ? 0 : v), (v) => (v > 0 ? v : null));
    const endOpts = opts([['stair', 'Stair'], ['open', 'Open']]);
    const barsBind = {
      get: () => get('bars'),
      set: (v, live) => { if (Array.isArray(v) && v.length > CONFIG.limits.maxBars) { Toast.show(`A design holds up to ${CONFIG.limits.maxBars} bars.`, 'warn'); return; } Store.set('bars', v, { live }); },
      commit: () => Store.commit(),
    };
    barList = mkList({
      bind: barsBind, addLabel: 'Add bar', min: 1, openDefault: (i) => i === 0,
      swatch: (i) => barColor(i),
      title: (i, b) => {
        const u = (Derived.get().units.byBar || {})[b.id];
        return `${b.name} · ${Units.formatFeetInches(b.length)} · ${b.floors} fl · ${u ? u.perFloor : 0} units/fl`;
      },
      make: (arr) => newBarFor({ bars: arr, site: Store.raw().site }),
      render: (i) => {
        const p = `bars.${i}`;
        const bendsBind = {
          get: () => get(`${p}.bends`) || [],
          set: (v, live) => Store.set(`${p}.bends`, (v || []).slice(0, CONFIG.limits.maxBends), { live }),
          commit: () => Store.commit(),
        };
        const bends = mkList({
          bind: bendsBind, addLabel: 'Add bend', reorder: false, openDefault: () => true, empty: 'No bends.',
          title: (j, b) => `Bend at ${Units.formatFeetInches(b.at)} · ${round1(b.deg)}°`,
          make: () => ({ at: Math.max(1, Math.round(num(get(`${p}.length`), 200) / 2)), deg: 90 }),
          render: (j) => ({ children: els([lenS('At (from the start)', `${p}.bends.${j}.at`, 5, 600), degS('Turn (+ left, - right)', `${p}.bends.${j}.deg`, -150, 150, { hardMin: -150, hardMax: 150 })]) }),
        });
        return {
          children: els([
            textField('Name', `${p}.name`),
            sel('Typical floors', `${p}.program`, progOptions(CONFIG.barPrograms)),
            intS('Floors', `${p}.floors`, 1, 12),
            lenS('Length', `${p}.length`, 40, 500),
            lenS('Depth', `${p}.depth`, 30, 120, { hardMin: 10 }),
            sel('Ground floor', null, [{ value: '', label: 'Same as typical floors' }, ...progOptions(CONFIG.groundPrograms)], groundBind(i)),
            sel('Corridor', `${p}.corridor`, opts([['double', 'Double-loaded'], ['single', 'Single-loaded'], ['breezeway', 'Breezeway']])),
            Controls.when(() => get(`${p}.corridor`) === 'single', [sel('Units on the', `${p}.unitSide`, opts([['left', 'Left (looking along the bar)'], ['right', 'Right']]))]),
          ]),
          more: els([
            Controls.label('Start of the bar'),
            Controls.group(els([lenF('Start x', `${p}.x`, { hardMin: -MAXD }), lenF('Start y', `${p}.y`, { hardMin: -MAXD })])),
            degS('Angle (from east, counter-clockwise)', `${p}.angle`, -180, 180),
            Controls.group(els([sel('Start end', `${p}.ends.start`, endOpts), sel('End end', `${p}.ends.end`, endOpts)])),
            Controls.label('Bends'),
            Controls.help('A bend turns the bar. At most two. Each bend costs the corner-loss units on every floor.'),
            bends.el,
            Controls.slider({ label: 'Unit width override (0 = program default)', bind: widthBind(i), min: 0, max: 40, step: 1, hardMin: 0, hardMax: 200, format: (v) => (v > 0 ? Units.formatFeetInches(v) : 'Default'), parse: (t) => (/^\s*(default|none|0)\s*$/i.test(t) ? 0 : Units.parseLength(t)), inputMode: 'text' }),
          ]),
        };
      },
    });
    enableBarDrag(barList);
    return {
      children: [
        Controls.help('One row per bar. Click a bar in the view to open its row. Drag a row by its title to reorder, or use the arrows. The swatch shows the bar color in Diagram style.'),
        barList.el,
        h('div', { class: 'add-row' }, Controls.button('Duplicate selected', () => { const it = Select.get().find((x) => x.kind === 'bar'); if (it) Select.duplicateBar(it.id); else Toast.show('Select a bar first.', 'warn', 2400); }),
          h('span', { class: 'help', style: 'margin:0' }, 'Cmd+D duplicates the selected bar. B adds one.')),
      ],
    };
  }

  function buildDeck() {
    const on = () => !!get('deck.on');
    return {
      children: [
        Controls.toggle({ label: 'Parking deck', bind: bs('deck.on') }).el,
        Controls.when(on, [
          Controls.help('A stand-alone deck of parking levels. Each level is the deck rectangle. Stalls = levels x deck area / stall size.'),
          lenS('Width (east-west)', 'deck.w', 40, 600), lenS('Depth (north-south)', 'deck.d', 40, 600),
          intS('Levels', 'deck.levels', 1, 10),
          lenS('Floor-to-floor', 'deck.ftf', 8, 14, { step: 0.5, hardMin: 6, hardMax: 30 }),
          Controls.toggle({ label: 'Open top', bind: bs('deck.openTop') }),
          Controls.label('Position (center)'),
          Controls.group(els([lenF('Center x', 'deck.x', { hardMin: -MAXD }), lenF('Center y', 'deck.y', { hardMin: -MAXD })])),
        ]).el,
      ],
    };
  }

  function buildPodium() {
    const on = () => !!get('podium.on');
    const levels = mkList({
      bind: bs('podium.levels'), addLabel: 'Add level', min: 1, openDefault: () => true,
      title: (i, l) => `Level ${i + 1} · ${(CONFIG.programs[l.program] || {}).label || l.program} · ${Units.formatFeetInches(num(l.ftf, 0))}`,
      make: (arr) => ({ ...(arr[arr.length - 1] || { ftf: 11, program: 'parking' }) }),
      render: (i) => ({ children: els([sel('Program', `podium.levels.${i}.program`, progOptions(CONFIG.podiumPrograms)), lenS('Floor-to-floor', `podium.levels.${i}.ftf`, 8, 20, { step: 0.5, hardMin: 6, hardMax: 40 })]) }),
    });
    return {
      children: [
        Controls.toggle({ label: 'Podium', bind: bs('podium.on') }).el,
        Controls.when(on, [
          Controls.help('Levels under the bars, bottom first. The podium plate is shared by every bar.'),
          levels.el,
          sel('Footprint', 'podium.footprint.mode', opts([['allowed', 'Percent of the allowed footprint'], ['offset', 'Bars bounding box plus an offset']])),
          Controls.when(() => get('podium.footprint.mode') === 'allowed', [Controls.slider({ label: 'Share of the allowed footprint', bind: bs('podium.footprint.percent'), min: 10, max: 100, step: 1, hardMin: 1, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal' })]),
          Controls.when(() => get('podium.footprint.mode') === 'offset', [lenS('Offset from the bars', 'podium.footprint.offset', -40, 80, { hardMin: -200 })]),
          Controls.toggle({ label: 'Retail liner on the first level', bind: bs('podium.liner.on') }),
          Controls.when(() => !!get('podium.liner.on'), [
            sel('Liner side', 'podium.liner.side', opts([['front', 'Front (south)'], ['back', 'Back (north)'], ['left', 'Left (west)'], ['right', 'Right (east)']])),
            lenS('Liner depth', 'podium.liner.depth', 10, 80),
          ]),
        ]).el,
      ],
    };
  }

  function buildSurface() {
    const hasLot = () => (get('surface.lot') || []).length >= 3;
    const drawBtn = h('button', { class: 'btn outline sm', type: 'button', id: 'btnDrawLot', onclick: () => { if (Select.lotActive()) Select.finishLot(true); else Select.startLot(); } }, 'Draw lot');
    const syncDraw = () => { drawBtn.textContent = Select.lotActive() ? 'Finish lot' : (hasLot() ? 'Redraw lot' : 'Draw lot'); };
    Store.subscribe(syncDraw);
    Select.onLot(syncDraw);
    return {
      children: [
        Controls.slider({ label: 'Surface stalls (typed count)', bind: bs('surface.count'), min: 0, max: 600, step: 5, hardMin: 0, hardMax: 100000, integer: true, format: Units.formatInt, inputMode: 'numeric' }),
        Controls.help('Stalls you count by hand. They take open space at the stall size on the Program tab.'),
        h('div', { class: 'add-row' }, drawBtn, Controls.button('Clear lot', () => { Select.finishLot(false); Store.set('surface.lot', [], { live: false }); })),
        Controls.help('Draw lot: click corner points on the ground in the view, then press Finish lot, Enter, or double-click. Escape cancels. A drawn lot adds stalls by its area.'),
        Controls.when(hasLot, [Controls.points({ label: 'Lot corners (x, y in feet)', bind: bs('surface.lot'), need: 3 })]),
      ],
    };
  }

  function buildCourts() {
    courtList = mkList({
      bind: bs('courts'), addLabel: 'Add court', reorder: false, openDefault: () => false, empty: 'No open courts.',
      title: (i, c) => `Court ${c.id} · ${Units.formatFeetInches(num(c.w, 0))} × ${Units.formatFeetInches(num(c.d, 0))}`,
      make: (arr) => {
        let n = arr.length + 1;
        while (arr.some((c) => c.id === `C${n}`)) n++;
        return { id: `C${n}`, x: 0, y: 0, w: 100, d: 80 };
      },
      render: (i) => ({ children: [Controls.group(els([lenF('Center x', `courts.${i}.x`, { hardMin: -MAXD }), lenF('Center y', `courts.${i}.y`, { hardMin: -MAXD }), lenF('Width', `courts.${i}.w`), lenF('Depth', `courts.${i}.d`)]))] }),
    });
    return { children: [Controls.help('An open court is a rectangle on the ground, drawn as an outline. It counts toward the courtyard checks. Bars should not cover it.'), courtList.el] };
  }

  function buildRoof() {
    return {
      children: els([
        sel('Roof', 'roof.type', opts([['parapet', 'Parapet (adds no height)'], ['screen', 'Screen (adds its height)']])),
        Controls.when(() => get('roof.type') === 'screen', [lenS('Screen height', 'roof.height', 2, 30, { hardMin: 1, hardMax: 60 })]),
        lenS('Typical floor-to-floor', 'floors.ftf', 8, 14, { step: 0.5, hardMin: 6, hardMax: 30 }),
        lenS('Ground floor-to-floor', 'floors.groundFtf', 10, 20, { step: 0.5, hardMin: 6, hardMax: 40 }),
        Controls.help('Floor-to-floor applies to every bar. The first bar floor uses the ground value.'),
      ]),
    };
  }

  function buildPrograms() {
    const cards = Object.keys(CONFIG.programs).map((k) => {
      const path = `programs.${k}`;
      const unitSize = {
        get: () => num(get(`${path}.unitSize`), 0),
        set: (v, live) => {
          const p = { ...get(path) };
          if (!(v > 0)) { p.unitSize = null; p.unitFactor = null; } else { p.unitSize = v; if (p.unitFactor == null) p.unitFactor = 1; }
          Store.set(path, p, { live });
        },
        commit: () => Store.commit(),
      };
      const factor = Controls.mapBind(bs(`${path}.unitFactor`), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100);
      const colorCtl = Controls.color({ label: `${CONFIG.programs[k].label} color`, bind: bs(`${path}.color`) });
      const parkLabel = k === 'retail' ? 'Stalls per 1,000 sf' : 'Stalls per unit';
      return h('div', { class: 'prog-card' },
        h('div', { class: 'prog-head' }, colorCtl.el, h('span', { class: 'grow' }, CONFIG.programs[k].label)),
        Controls.group(els([
          lenF('Floor-to-floor', `${path}.ftf`, { hardMin: 6, hardMax: 100, step: 0.5 }),
          Controls.slider({ label: k === 'parking' ? 'Stall size (sf)' : 'Unit size (sf, 0 = none)', bind: unitSize, compact: true, min: 0, max: 1, step: 10, hardMin: 0, hardMax: 100000, format: (v) => (v > 0 ? Units.grouped(v) : '0'), inputMode: 'numeric' }),
        ])),
        Controls.when(() => get(`${path}.unitSize`) != null, [Controls.slider({ label: 'Unit factor (corridors, walls)', bind: factor, compact: true, min: 0, max: 1, step: 1, hardMin: 0, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal' })]).el,
        Controls.when(() => get(`${path}.unitWidth`) != null, [lenS('Unit width (along the bar)', `${path}.unitWidth`, 10, 50, { step: 0.5, hardMin: 5, hardMax: 200 })]).el,
        k === 'parking' ? null : numS(parkLabel, `${path}.parkingRatio`, 0, 4, 0.05, 2, { compact: true }).el);
    });
    return {
      children: [
        Controls.help('Units = net area x unit factor / unit size. Unit width sets how many units fit along a bar. Parking ratios set the stalls required.'),
        ...cards,
      ],
    };
  }

  function buildParking() {
    return {
      children: els([
        Controls.group(els([
          numS('Surface stall (sf)', 'parking.sfPerStallSurface', 0, 1, 10, 0, { compact: true }),
          numS('Deck stall (sf)', 'parking.sfPerStallDeck', 0, 1, 10, 0, { compact: true }),
        ])),
        numS('Retail stalls per 1,000 sf', 'parking.retailPerThousand', 0, 1, 0.5, 1, { compact: true }),
        Controls.toggle({ label: 'Count a parking shortfall as a warning', bind: bs('view.warnParking') }),
        Controls.help('Required = units x ratio by program, plus retail area x the retail ratio. A half stall rounds up.'),
      ]),
    };
  }

  function buildRules() {
    const hints = mkList({
      bind: bs('rules.constructionHints'), addLabel: 'Add hint', reorder: true, openDefault: () => false, empty: 'No construction hints.',
      title: (i, r) => `Up to ${r.maxFloors} floors · podium ${r.podium} · ${r.hint}`,
      make: () => ({ maxFloors: 6, podium: 'any', hint: 'Check the code' }),
      render: (i) => ({ children: els([
        intS('Up to floors', `rules.constructionHints.${i}.maxFloors`, 1, 12, { hardMax: 999 }),
        sel('Podium', `rules.constructionHints.${i}.podium`, opts([['any', 'Any'], ['none', 'No podium'], ['yes', 'With a podium']])),
        textField('Hint', `rules.constructionHints.${i}.hint`, { maxlength: 120 }),
      ]) }),
    });
    return {
      children: [
        Controls.group(els([
          numS('Corridor width (ft)', 'rules.corridorWidth', 0, 1, 0.25, 2, { compact: true }),
          numS('Breezeway width (ft)', 'rules.breezewayWidth', 0, 1, 0.5, 1, { compact: true }),
          numS('Corridor ft per extra stair', 'rules.stairPer', 0, 1, 10, 0, { compact: true }),
          numS('Units per elevator', 'rules.elevatorPer', 0, 1, 10, 0, { compact: true }),
        ])),
        Controls.slider({ label: 'Corner loss (units per inside corner per floor)', bind: bs('rules.cornerLoss'), min: 0, max: 2, step: 0.5, hardMin: 0, hardMax: 2, format: (v) => String(Math.round(v * 10) / 10), inputMode: 'decimal' }),
        Controls.label('Construction hints'),
        Controls.help('The first row that matches the tallest bar wins. It is a reminder only.'),
        hints.el,
      ],
    };
  }

  function buildDisplay() {
    const v = (k) => bs(`view.${k}`);
    return {
      children: els([
        sel('Style', 'view.style', opts([['model', 'Model'], ['diagram', 'Diagram']])),
        sel('Color by (diagram)', 'view.colorBy', opts([['program', 'Program'], ['bar', 'Bar']])),
        Controls.toggle({ label: 'Floor lines', bind: v('floorLines') }),
        Controls.toggle({ label: 'Shadows', bind: v('shadows') }),
        Controls.toggle({ label: 'Grid', bind: v('grid') }),
        Controls.toggle({ label: 'Scale figure', bind: v('figure') }),
        Controls.toggle({ label: 'Unit ticks (plan and Diagram)', bind: v('ticks') }),
        Controls.help('Spines, unit ticks, corner zones, courtyard labels and stall counts show in the Plan view and in Diagram style.'),
      ]),
    };
  }
  function buildScene() {
    return {
      children: els([
        Controls.toggle({ label: 'Show zoning envelope', bind: bs('view.envelope') }),
        Controls.toggle({ label: 'Show context blocks', bind: bs('context.show') }),
        Controls.help('Edit the context blocks in the Site tab.'),
      ]),
    };
  }
  function buildSun() {
    const v = (k) => bs(`view.${k}`);
    return {
      children: els([
        Controls.slider({ label: 'Sun azimuth', bind: v('sun.azimuth'), min: 0, max: 360, step: 1, hardMin: 0, hardMax: 360, integer: true, format: Units.formatDeg, inputMode: 'numeric' }),
        Controls.slider({ label: 'Sun altitude', bind: v('sun.altitude'), min: 5, max: 90, step: 1, hardMin: 3, hardMax: 90, integer: true, format: Units.formatDeg, inputMode: 'numeric' }),
      ]),
    };
  }

  function buildSite() {
    const shapeBind = {
      get: () => get('site.shape'),
      set: (v) => {
        const site = deepClone(get('site'));
        site.shape = v;
        if (v === 'polygon' && (!Array.isArray(site.points) || site.points.length < 3)) {
          const w = num(site.width, 250), d = num(site.depth, 200);
          site.points = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
        }
        Store.set('site', site, { live: false });
      },
      commit: () => {},
    };
    return {
      children: els([
        sel('Shape', null, opts([['rect', 'Rectangle'], ['polygon', 'Polygon']]), shapeBind),
        Controls.when(() => get('site.shape') !== 'polygon', [lenS('Width', 'site.width', 100, 800), lenS('Depth', 'site.depth', 100, 800)]),
        Controls.when(() => get('site.shape') === 'polygon', [Controls.points({ label: 'Site corners (x, y in feet)', bind: bs('site.points'), need: 3, needText: 'Needs at least 3 points. Until then the rectangle is used.' })]),
        Controls.help('Site area sets density. Front is south.'),
      ]),
    };
  }
  function buildSetbacks() {
    return {
      children: els([
        Controls.group(els([
          lenF('Front (south)', 'site.setbacks.front', { hardMin: 0 }), lenF('Back (north)', 'site.setbacks.back', { hardMin: 0 }),
          lenF('Left (west)', 'site.setbacks.left', { hardMin: 0 }), lenF('Right (east)', 'site.setbacks.right', { hardMin: 0 }),
        ])),
        Controls.help('The building must stay inside the site shrunk by these distances.'),
      ]),
    };
  }
  function buildHeight() {
    const limitBind = Controls.mapBind(bs('site.heightLimit'), (v) => num(v, 0), (v) => Math.max(0, v));
    return {
      children: els([
        Controls.slider({
          label: 'Height limit (0 = none)', bind: limitBind, min: 0, max: 200, step: 1, hardMin: 0, hardMax: 5000,
          format: (v) => (v > 0 ? Units.formatFeetInches(v) : 'None'), parse: (t) => (/^\s*(none|off)\s*$/i.test(t) ? 0 : Units.parseLength(t)), inputMode: 'text',
        }),
        Controls.toggle({ label: 'Stepback above a height', bind: bs('site.stepback.on') }),
        Controls.when(() => get('site.stepback.on'), [lenS('Above height', 'site.stepback.aboveHeight', 20, 200), lenS('Step in by', 'site.stepback.distance', 5, 60)]),
        Controls.help('Above the stepback height the allowed footprint shrinks by the step-in distance on every side.'),
      ]),
    };
  }
  function buildRulesSite() {
    return {
      children: els([
        numS('Density cap (units per acre, 0 = none)', 'site.densityCap', 0, 1, 1, 0, { compact: true }),
        Controls.slider({
          label: 'Open space share (0 = no rule)', bind: Controls.mapBind(bs('site.openSpaceShare'), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100),
          min: 0, max: 60, step: 1, hardMin: 0, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal',
        }),
        lenS('Separation between bars that do not join', 'site.separationMin', 0, 80, { hardMin: 0 }),
        lenS('Smallest courtyard dimension', 'site.courtyardMin', 0, 120, { hardMin: 0 }),
      ]),
    };
  }
  function buildTargets() {
    return {
      children: [
        Controls.group(els([numS('Units target', 'targets.units', 0, 1, 10, 0, { compact: true }), numS('Density target (per acre)', 'targets.density', 0, 1, 1, 0, { compact: true })])),
        Controls.help('0 means not set. The metrics card shows how far the design is from each target.'),
      ],
    };
  }
  function buildContext() {
    ctxList = mkList({
      bind: bs('context.blocks'), addLabel: 'Add block', reorder: false, openDefault: () => false,
      empty: 'No context blocks.',
      title: (i, b) => `Block ${i + 1} · ${Units.formatFeetInches(num(b.h, 0))} high`,
      make: () => ({ x: 0, y: -180, w: 200, d: 120, h: 60 }),
      render: (i) => ({
        children: [Controls.group(els([
          lenF('Center x', `context.blocks.${i}.x`, { hardMin: -MAXD }), lenF('Center y', `context.blocks.${i}.y`, { hardMin: -MAXD }),
          lenF('Width', `context.blocks.${i}.w`), lenF('Depth', `context.blocks.${i}.d`), lenF('Height', `context.blocks.${i}.h`),
        ]))],
      }),
    });
    return {
      children: els([
        Controls.help('Neighboring buildings, drawn for scale. They never change any number. Show or hide them in the View tab.'),
        ctxList.el,
        h('div', { class: 'add-row' }, Controls.button('Surround', () => {
          Store.set('context.blocks', surroundBlocks(Store.raw()).map((b) => ({ ...b })), { live: false });
          Store.set('context.fromSite', false, { live: false });
          if (!get('context.show')) Store.set('context.show', true, { live: false });
        }), h('span', { class: 'help', style: 'margin:0' }, 'One block on each side of the site.')),
      ]),
    };
  }

  function buildProject() {
    const has = () => ProjectUI.has();
    const siteOk = () => ProjectUI.hasSite();
    return {
      children: [
        Controls.when(() => !has(), [Controls.help('No project is open. Use Project in the top bar to start one or open one. A project holds the site, this building and the other tools in one file.')]).el,
        Controls.when(has, [
          h('div', { class: 'proj-line', id: 'projLine' }),
          ProjectUI.nameControl().el,
          Controls.label('Placement of the building in the project'),
          Controls.group(els([lenF('X (east)', 'placement.x', { hardMin: -1e6, hardMax: 1e6 }), lenF('Y (north)', 'placement.y', { hardMin: -1e6, hardMax: 1e6 })])),
          degS('Rotation (5 degree steps)', 'placement.rotation', -180, 180, { step: 5, hardMin: -360, hardMax: 360 }),
          lenF('Base elevation (FFE, ft)', 'placement.baseZ', { hardMin: -1e5, hardMax: 1e5, step: 0.5 }),
          h('div', { class: 'add-row' }, Controls.button('Center on site', () => ProjectUI.centerOnSite(), 'outline sm'), h('span', { class: 'help', style: 'margin:0' }, 'Puts the building at the site center and its floor at the ground there.')),
          Controls.when(siteOk, [
            Controls.label('Neighbors from the Site Model'),
            Controls.slider({ label: 'Radius around the building', bind: bs('context.radius'), min: 100, max: 2000, step: 50, hardMin: 50, hardMax: 5000, format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text' }),
            h('div', { class: 'add-row' }, Controls.button('Context from site', () => ProjectUI.contextFromSite(), 'outline sm'), h('span', { class: 'help', style: 'margin:0', id: 'ctxSiteNote' })),
          ]),
        ]).el,
      ],
    };
  }

  // Four tabs (Direction A). Each tab is a stack of accordion sections.
  const TABS = [
    { id: 'form', title: 'Form' },
    { id: 'program', title: 'Program' },
    { id: 'view', title: 'View' },
    { id: 'site', title: 'Site' },
  ];
  const SECTIONS = [
    { id: 'templates', tab: 'form', title: 'Templates', open: true, build: buildTemplates },
    { id: 'bars', tab: 'form', title: 'Bars', open: true, build: buildBars },
    { id: 'deck', tab: 'form', title: 'Deck', build: buildDeck },
    { id: 'podium', tab: 'form', title: 'Podium', build: buildPodium },
    { id: 'surface', tab: 'form', title: 'Surface parking', build: buildSurface },
    { id: 'courts', tab: 'form', title: 'Courts', build: buildCourts },
    { id: 'roof', tab: 'form', title: 'Roof and floors', build: buildRoof },
    { id: 'programs', tab: 'program', title: 'Programs', open: true, build: buildPrograms },
    { id: 'parking', tab: 'program', title: 'Parking', open: true, build: buildParking },
    { id: 'rules', tab: 'program', title: 'Rules', build: buildRules },
    { id: 'display', tab: 'view', title: 'Display', open: true, build: buildDisplay },
    { id: 'scene', tab: 'view', title: 'Context and envelope', open: true, build: buildScene },
    { id: 'sun', tab: 'view', title: 'Sun', open: true, build: buildSun },
    { id: 'site', tab: 'site', title: 'Site', open: true, build: buildSite },
    { id: 'setbacks', tab: 'site', title: 'Setbacks', open: true, build: buildSetbacks },
    { id: 'height', tab: 'site', title: 'Height limit and stepback', open: true, build: buildHeight },
    { id: 'siterules', tab: 'site', title: 'Zoning rules', build: buildRulesSite },
    { id: 'targets', tab: 'site', title: 'Targets', build: buildTargets },
    { id: 'context', tab: 'site', title: 'Context blocks', build: buildContext },
    { id: 'project', tab: 'site', title: 'Project and placement', open: true, build: buildProject },
  ];
  const sectionCtl = {};          // id -> Controls.section result
  const swatchSyncs = [];         // functions that repaint section-head swatches
  let activeTab = 'form';
  const scrollPos = {};

  function buildPanel() {
    const host = $('sections');
    host.textContent = '';
    const panels = {};
    for (const t of TABS) {
      panels[t.id] = h('div', { class: 'tabpanel', id: `tabpanel-${t.id}`, role: 'tabpanel', 'aria-labelledby': `tab-${t.id}`, hidden: true });
      host.append(panels[t.id]);
    }
    for (const s of SECTIONS) {
      const parts = s.build();
      const open = prefs.sections && s.id in prefs.sections ? !!prefs.sections[s.id] : !!s.open;
      const sec = Controls.section({
        id: s.id, title: s.title, open, children: els(parts.children || []), more: els(parts.more || []),
        onToggle: (isOpen) => rememberSection(s.id, isOpen),
      });
      sectionCtl[s.id] = sec;
      panels[s.tab].append(sec.el);
    }
  }
  function rememberSection(id, isOpen) { prefs.sections = { ...(prefs.sections || {}), [id]: isOpen }; saveUiPrefs(prefs); }

  /* ---- tabs ------------------------------------------------------------------------ */
  function buildTabs() {
    const bar = $('panelTabs');
    bar.textContent = '';
    for (const t of TABS) {
      bar.append(h('button', {
        class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'data-tab': t.id, 'aria-controls': `tabpanel-${t.id}`, 'aria-selected': 'false', tabindex: '-1',
        onclick: () => { setTab(t.id); raiseSheet(); },
      }, t.title));
    }
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const i = TABS.findIndex((t) => t.id === activeTab);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      setTab(TABS[next].id);
      $(`tab-${TABS[next].id}`).focus();
    });
  }
  /** Shows one tab. Remembered in the UI prefs (localStorage), and each tab keeps its own scroll position. */
  function setTab(id, { remember = true } = {}) {
    if (!TABS.some((t) => t.id === id)) return false;
    const scroller = $('panelScroll');
    if (id !== activeTab) scrollPos[activeTab] = scroller.scrollTop;
    activeTab = id;
    for (const t of TABS) {
      const on = t.id === id;
      const btn = $(`tab-${t.id}`), pnl = $(`tabpanel-${t.id}`);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      pnl.hidden = !on;
    }
    scroller.scrollTop = scrollPos[id] || 0;
    if (remember && prefs.tab !== id) { prefs.tab = id; saveUiPrefs(prefs); }
    return true;
  }

  /* ---- hooks for the selection card ------------------------------------------------- */
  const ITEM_MAP = {
    bar: { tab: 'form', section: 'bars', list: () => barList, index: (it) => Store.raw().bars.findIndex((b) => b.id === it.id) },
    deck: { tab: 'form', section: 'deck' },
    podium: { tab: 'form', section: 'podium' },
    court: { tab: 'form', section: 'courts', list: () => courtList, index: (it) => Store.raw().courts.findIndex((c) => c.id === it.id) },
    context: { tab: 'site', section: 'context', list: () => ctxList, index: (it) => it.index },
  };
  /**
   * Switches to the tab that holds the item, opens its section (and its row when the kind is a list), and scrolls it into view.
   * item: { kind: 'bar' | 'court', id } | { kind: 'deck' | 'podium' } | { kind: 'context', index }. Returns true when something was opened.
   */
  function openItem(item) {
    const m = item && ITEM_MAP[item.kind];
    if (!m) return false;
    setTab(m.tab);
    const sec = sectionCtl[m.section];
    if (!sec) return false;
    if (!sec.isOpen()) { sec.setOpen(true); rememberSection(m.section, true); }
    let target = sec.el;
    if (m.list) {
      const lst = m.list();
      const i = m.index(item);
      const row = lst && Number.isInteger(i) && i >= 0 ? lst.openAt(i) : null;
      if (row) target = row;
    }
    raiseSheet();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { target.scrollIntoView(); }
    target.classList.remove('is-focus'); void target.offsetWidth; target.classList.add('is-focus');
    setTimeout(() => target.classList.remove('is-focus'), 1600);
    return true;
  }
  /** Sets the typical-floor program of every bar in `items`. ONE undo step for the whole call. Returns how many bars changed. */
  function setProgramForItems(items, program) {
    if (!CONFIG.barPrograms.includes(program)) return 0;
    const next = deepClone(Store.raw());
    let n = 0;
    for (const it of items || []) {
      if (!it || it.kind !== 'bar') continue;
      const bar = next.bars.find((b) => b.id === it.id);
      if (bar) { bar.program = program; n++; }
    }
    if (n && JSON.stringify(next) !== JSON.stringify(Store.raw())) Store.replace(next);
    return n;
  }

  /* ---- top bar -------------------------------------------------------------------- */
  const iconBtn = (icon, text, attrs = {}) => h('button', { class: 'btn has-text', type: 'button', 'aria-label': text, title: text, ...attrs },
    h('span', { html: icon, style: 'display:contents' }), h('span', { class: 'btn-text' }, text));

  const snapState = () => { const s = get('view.snap') || {}; return { on: s.on !== false, grid: s.grid === 10 ? 10 : 5 }; };
  const setSnap = (patch) => Store.set('view.snap', { ...snapState(), ...patch }, { live: false });

  function openSnapMenu(anchor) {
    const el = h('div', { role: 'group', 'aria-label': 'Snap options' });
    const sw = h('button', { class: 'toggle-row', type: 'button', role: 'switch', id: 'snapSwitch', style: 'padding:0 8px' }, h('span', null, 'Snap while dragging'), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    const chips = [5, 10].map((g) => h('button', { class: 'chip', type: 'button', 'data-grid': String(g), 'aria-pressed': 'false', onclick: () => setSnap({ grid: g }) }, `${g} ft`));
    const sync = () => {
      const st = snapState();
      sw.setAttribute('aria-checked', String(st.on));
      chips.forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.grid) === st.grid)));
    };
    sw.addEventListener('click', () => setSnap({ on: !snapState().on }));
    const off = Store.subscribe(sync);
    sync();
    el.append(
      sw,
      h('div', { class: 'label pop-label' }, 'Grid'),
      h('div', { class: 'chips', style: 'padding:2px 8px 6px', role: 'group', 'aria-label': 'Grid size' }, chips),
      h('div', { class: 'pop-note' }, 'Snaps to the grid, the site, setbacks and the edges and centers of bars, the deck and courts. Hold Option (Alt) while dragging to skip it. Rotation snaps to 5 degrees.'),
    );
    Pop.open(anchor, el, { align: 'right', onClose: off });
  }

  /** The Export menu: Image, AI-ready image, AI Prompts, the image overlay choices (a sub-view), files, and Send to. */
  function openExportMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'exportMenu' });
    const item = (id, title, sub, onclick, o = {}) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', id, onclick: () => { if (!o.keep) Pop.close(); onclick(); } },
      h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null), o.chev ? h('span', { html: ICONS.chev, class: 'chev-r', style: 'display:contents' }) : null);
    const main = () => {
      el.textContent = '';
      el.append(h('div', { class: 'label pop-label' }, 'Pictures'),
        item('miImage', 'Image', 'Save a PNG of this view', () => Shots.take()),
        item('miAiReady', 'AI-ready image', 'Plain model, no overlay, grid or wireframe. For ChatGPT or Gemini.', () => Shots.takeAiReady()),
        item('miAiPrompts', 'AI Prompts', 'A prompt to pair with the AI-ready image', () => Prompts.toggle()),
        item('miOverlay', 'Image overlay', 'Choose what the Image shows', () => overlay(), { keep: true, chev: true }),
        h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Files'),
        item('miSketchup', 'SketchUp (.json)', 'Import with the CMRLM SketchUp extension', () => SketchupExport.download()),
        item('miExportJson', 'Export JSON', 'Download all saved options', () => Options.exportJson()),
        item('miImportJson', 'Import JSON', 'Add the options from a file', () => $('importFile').click()),
        h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Send to'),
        item('miSendPlate', 'Send to Plate Planner', 'Save the project and open the Plate Planner', () => ProjectUI.send('plate')),
        item('miSendParking', 'Send to Parking Deck', 'Save the project and open the Parking Deck', () => ProjectUI.send('parking')),
        item('miSendFacade', 'Send to Facade Studio', 'Save the project and open the Facade Studio', () => ProjectUI.send('facade')),
        item('miSendGrading', 'Send to Grading Sketch', 'Save the project and open the Grading Sketch', () => ProjectUI.send('grading')));
    };
    const overlay = () => {
      el.textContent = '';
      el.append(h('button', { class: 'pop-item', type: 'button', id: 'miOverlayBack', onclick: main }, h('span', { class: 'grow' }, '‹  Export')));
      el.append(...Shots.overlayControls());
      el.append(h('div', { class: 'pop-actions' }, h('button', { class: 'btn solid', type: 'button', onclick: () => { Pop.close(); Shots.take(); } }, 'Save image')));
    };
    main();
    Pop.open(anchor, el, { align: 'right' });
  }

  function buildTopBar() {
    const optBtn = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnOption', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Option: name, presets, save, compare', 'aria-label': 'Option menu', onclick: () => Options.openMenu(optBtn) },
      h('span', { html: ICONS.option, style: 'display:contents' }), h('span', { class: 'menu-name', id: 'optionLabel' }, Store.get('name') || 'Option'), h('span', { class: 'dot', id: 'unsavedDot', hidden: true, title: 'Unsaved changes' }), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbOption').append(optBtn);
    const syncName = () => { const n = Store.get('name') || 'Option'; const l = $('optionLabel'); if (l.textContent !== n) l.textContent = n; };
    Store.subscribe(syncName);

    const undo = h('button', { class: 'btn icon', type: 'button', title: 'Undo (Cmd/Ctrl+Z)', 'aria-label': 'Undo', html: ICONS.undo, onclick: () => Store.undo() });
    const redo = h('button', { class: 'btn icon', type: 'button', title: 'Redo (Shift+Cmd/Ctrl+Z)', 'aria-label': 'Redo', html: ICONS.redo, onclick: () => Store.redo() });
    $('tbHistory').append(undo, redo);
    const syncHistory = () => { undo.disabled = !Store.canUndo(); redo.disabled = !Store.canRedo(); };
    Store.subscribe(syncHistory); syncHistory();

    // Model / Diagram toggle: a working material switch.
    const seg = $('styleToggle');
    const mk = (value, text) => h('button', { type: 'button', 'data-style': value, 'aria-pressed': 'false', onclick: () => Store.set('view.style', value, { live: false }) }, text);
    seg.append(mk('model', 'Model'), mk('diagram', 'Diagram'));
    const syncStyle = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === Store.get('view.style') ? 'true' : 'false'));
    Store.subscribe(syncStyle); syncStyle();

    // Snap: the main button toggles, the caret opens the grid choice. state.view.snap = { on, grid }.
    const snapBtn = iconBtn(ICONS.snap, 'Snap', { id: 'btnSnap', title: 'Snap to guides and the grid while dragging', 'aria-pressed': 'true', onclick: () => setSnap({ on: !snapState().on }) });
    const snapCaret = h('button', { class: 'btn caret-only', type: 'button', id: 'btnSnapMenu', 'aria-label': 'Snap grid size', title: 'Choose the snap grid (5 or 10 ft)', 'aria-haspopup': 'true', 'aria-expanded': 'false', html: ICONS.chev, onclick: () => openSnapMenu(snapCaret) });
    $('tbSnap').append(snapBtn, snapCaret);
    const syncSnap = () => {
      const st = snapState();
      snapBtn.classList.toggle('is-on', st.on);
      snapBtn.setAttribute('aria-pressed', String(st.on));
      snapBtn.title = st.on ? `Snap is on (${st.grid} ft grid). Click to turn off.` : 'Snap is off. Click to turn on.';
    };
    Store.subscribe(syncSnap); syncSnap();

    const proj = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnProject', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Project: new, open, import, export', 'aria-label': 'Project menu', onclick: () => ProjectUI.openMenu(proj) },
      h('span', { html: ICONS.folder, style: 'display:contents' }), h('span', { class: 'btn-text', id: 'projLabel' }, 'Project'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbProject').append(proj);

    const exp = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnExport', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Export: image, AI-ready image, AI prompts, SketchUp, JSON, send to another tool', 'aria-label': 'Export menu', onclick: () => openExportMenu(exp) },
      h('span', { html: ICONS.export, style: 'display:contents' }), h('span', { class: 'btn-text' }, 'Export'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbExport').append(exp);

    $('tbHelp').append(h('button', { class: 'btn icon', type: 'button', id: 'btnHelp', title: 'Help', 'aria-label': 'Help', html: ICONS.help, onclick: () => Help.toggle() }));
  }

  /* ---- preset views ------------------------------------------------------------------ */
  function buildViews() {
    const nav = $('views');
    const items = [['axon', 'Axon'], ['n', 'N'], ['e', 'E'], ['s', 'S'], ['w', 'W'], ['plan', 'Plan']];
    const labels = { axon: 'Axonometric view', n: 'North elevation', e: 'East elevation', s: 'South elevation', w: 'West elevation', plan: 'Plan view' };
    for (const [id, text] of items) nav.append(h('button', { type: 'button', 'data-view': id, 'aria-pressed': 'false', title: labels[id], 'aria-label': labels[id], onclick: () => Render.setView(id, true) }, text));
    Render.onViewChange((active) => nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === active ? 'true' : 'false')));
  }

  /* ---- metrics + warnings HUD ---------------------------------------------------------- */
  const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
  const signed = (v, fmt) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v))}`;

  function buildHud() {
    const hud = $('hud');
    const open = !!prefs.hudOpen;                      // remembered: expanded or compact
    hud.dataset.collapsed = open ? 'false' : 'true';
    hud.innerHTML = `
      <button class="hud-toggle" id="hudToggle" type="button" aria-expanded="${open}" aria-controls="hudBody" title="Show or hide all metrics">
        <span class="hud-top">
          <span class="label">Metrics</span>
          <span class="hud-badge" id="hudBadge" data-n="0" title="Warnings">0 warnings</span>
          ${CARET_SVG}
        </span>
        <span class="hud-core">
          <span class="m"><span class="k">Units</span><span class="v" id="mUnits">-</span></span>
          <span class="m"><span class="k">Density</span><span class="v" id="mDensity">-<small id="mDensitySub"></small></span></span>
          <span class="m"><span class="k">Parking ratio</span><span class="v" id="mParkRatio">-<small id="mParkSub"></small></span></span>
          <span class="m"><span class="k">Height</span><span class="v" id="mHeight">-<small id="mHeightSub"></small></span></span>
        </span>
      </button>
      <div class="hud-body" id="hudBody">
        <dl class="metrics compact">
          <div class="m"><dt>GFA</dt><dd id="mGfa">-</dd></div>
          <div class="m"><dt>FAR</dt><dd id="mFar">-</dd></div>
          <div class="m"><dt>Site area</dt><dd id="mSite">-</dd></div>
          <div class="m"><dt>Site coverage</dt><dd id="mCover">-</dd></div>
          <div class="m"><dt>Efficiency (est.)</dt><dd id="mEff">-</dd></div>
          <div class="m"><dt>Open space</dt><dd id="mOpen">-</dd></div>
          <div class="m"><dt>Corridor</dt><dd id="mCorr">-</dd></div>
          <div class="m"><dt>Courtyards</dt><dd id="mCourts">-</dd></div>
          <div class="m"><dt>Stairs / elevators</dt><dd id="mStairs">-</dd></div>
          <div class="m"><dt>Bars</dt><dd id="mBars">-</dd></div>
        </dl>
        <div class="sec"><div class="label">Construction hint</div><p class="hint-text" id="mHint">-</p><p class="help" id="mHintCaution"></p></div>
        <div class="sec" id="hudParking"><div class="label">Parking</div><dl class="kv" id="hudParkingList"></dl></div>
        <div class="sec" id="hudUnits" hidden><div class="label">Units (estimate)</div><dl class="kv" id="hudUnitsList"></dl></div>
        <div class="sec" id="hudTargets" hidden><div class="label">Target check</div><dl class="kv" id="hudTargetsList"></dl></div>
        <div class="warn-block" id="warnBlock" data-n="0">
          <div class="label">Warnings <span class="count" id="warnCount">0</span></div>
          <ul class="warns" id="warnList"></ul>
        </div>
      </div>`;
    const head = $('hudToggle');
    head.addEventListener('click', () => setHudOpen(hud.dataset.collapsed === 'true'));
    // Views are framed beside the HUD when there is room for both. The card is the same width compact or expanded, so toggling never reframes.
    Render.setInsetProvider(() => {
      if (Render.comparing()) return { right: 0 };
      const vw = $('viewport').clientWidth, w = hud.offsetWidth + 24;
      return { right: vw - w >= 380 ? w : 0 };
    });
  }
  function setHudOpen(open) {
    const hud = $('hud');
    hud.dataset.collapsed = open ? 'false' : 'true';
    $('hudToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!!prefs.hudOpen !== open) { prefs.hudOpen = open; saveUiPrefs(prefs); }
  }
  function setText(id, text) { const el = $(id); if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = text; else el.prepend(document.createTextNode(text)); }
  function kvRows(list, rows) {
    list.textContent = '';
    for (const [k, v, cls] of rows) list.append(h('dt', null, k), h('dd', cls ? { class: cls } : null, v));
  }
  function updateHud(d) {
    const m = d.metrics, st = Store.raw();
    setText('mUnits', Units.formatInt(m.units));
    setText('mDensity', `${Units.formatRatio(m.density, 1)} /ac`);
    $('mDensitySub').textContent = `${Units.formatRatio(m.siteAcres, 2)} acres`;
    const pk = m.parking;
    setText('mParkRatio', Units.formatRatio(pk.ratioProvided, 2));
    $('mParkSub').textContent = `${Units.formatInt(pk.provided)} of ${Units.formatInt(pk.required)} stalls`;
    $('mParkRatio').classList.toggle('bad', !!pk.deficit);
    setText('mHeight', Units.formatFeetInches(m.height));
    const fd = m.floorsDetail || {};
    $('mHeightSub').textContent = `${Units.formatInt(m.floors)} floors${fd.deck ? ` · ${fd.deck} deck` : ''}`;

    setText('mGfa', Units.formatArea(m.gfa));
    setText('mFar', Units.formatRatio(m.far, 2));
    setText('mSite', Units.formatArea(m.siteArea));
    setText('mCover', pct1(m.siteCoverage));
    setText('mEff', pct1(m.efficiency));
    setText('mOpen', pct1(m.openSpace.ratio));
    $('mOpen').classList.toggle('bad', !m.openSpace.ok);
    setText('mCorr', `${Units.formatInt(m.corridorLength)} ft`);
    setText('mCourts', m.courtyards.count ? `${m.courtyards.count} · ${Units.formatInt(m.courtyards.area)} sf · min ${Units.formatFeetInches(m.courtyards.minDim)}` : 'none');
    setText('mStairs', `${m.stairs.total} / ${m.elevators}`);
    setText('mBars', m.bars.longest ? `${m.bars.count} · longest ${Units.formatFeetInches(m.bars.longest.length)}` : '0');
    $('mHint').textContent = m.constructionHint || 'None';
    $('mHintCaution').textContent = m.constructionHint ? (m.constructionCaution || '') : '';

    const req = pk.requiredDetail, prov = pk.providedDetail;
    const rows = [['Required', Units.formatInt(pk.required)]];
    if (req) {
      for (const [prog, n] of Object.entries(req.byProgram || {})) if (n > 0) rows.push([`  ${(CONFIG.programs[prog] || {}).label || prog}`, Units.formatInt(n)]);
      if (req.retail > 0) rows.push(['  Retail', `${Units.formatInt(req.retail)} for ${Units.formatInt(req.retailArea)} sf`]);
    }
    rows.push(['Provided', Units.formatInt(pk.provided)]);
    if (prov) {
      if (prov.surface) rows.push(['  Surface (typed)', Units.formatInt(prov.surface)]);
      if (prov.lot) rows.push(['  Surface lot', Units.formatInt(prov.lot)]);
      if (prov.deck) rows.push(['  Deck', Units.formatInt(prov.deck)]);
      const pod = (prov.podium || []).reduce((t, n) => t + n, 0);
      if (pod) rows.push(['  Podium', Units.formatInt(pod)]);
    }
    rows.push([pk.surplus < 0 ? 'Short by' : 'Surplus', Units.formatInt(Math.abs(pk.surplus)), pk.surplus < 0 ? 'tgt-neg' : 'tgt-pos']);
    kvRows($('hudParkingList'), rows);

    const ud = m.unitsDetail;
    const urows = [];
    for (const [prog, n] of Object.entries(ud.byProgram || {})) urows.push([(CONFIG.programs[prog] || {}).label || prog, Units.formatInt(n)]);
    if (Object.keys(ud.byBar || {}).length > 1) for (const b of st.bars) { const u = ud.byBar[b.id]; if (u) urows.push([`  ${b.name}`, `${Units.formatInt(u.total)} (${u.perFloor}/fl)`]); }
    kvRows($('hudUnitsList'), urows);
    $('hudUnits').hidden = !urows.length;

    const trows = [];
    const addTarget = (label, t, fmt) => {
      if (!t) return;
      trows.push([`${label} (target ${fmt(t.target)})`, `${signed(t.diff, fmt)} (${signed(t.pct, (v) => `${v.toFixed(1)}%`)})`, t.diff >= 0 ? 'tgt-pos' : 'tgt-neg']);
    };
    addTarget('Units', m.target.units, Units.formatInt);
    addTarget('Density', m.target.density, (v) => Units.formatRatio(v, 1));
    kvRows($('hudTargetsList'), trows);
    $('hudTargets').hidden = !trows.length;

    const list = $('warnList');
    list.textContent = '';
    if (!d.warnings.length) list.append(h('li', { class: 'none' }, 'No warnings'));
    for (const w of d.warnings) list.append(h('li', { class: `warn-${w.level}` }, w.text));
    $('warnCount').textContent = String(d.warnings.length);
    $('warnBlock').dataset.n = String(d.warnings.length);
    const nw = d.warnings.length;
    $('hudBadge').dataset.n = String(nw);
    $('hudBadge').textContent = `${nw} ${nw === 1 ? 'warning' : 'warnings'}`;
    updateLegend(d);
  }

  /* ---- color legend (Diagram style) ------------------------------------------------------ */
  /** Lists what appears in the model: programs, or bars, the roof screen, and red for anything outside the envelope. */
  function updateLegend(d) {
    const box = $('legend');
    const st = Store.raw(), v = st.view;
    if (v.style !== 'diagram' || Render.comparing()) { box.hidden = true; return; }
    const plates = (d && d.plates) || [];
    const used = plates.filter((p) => p.polygons && p.polygons.length);
    const rows = [];
    if (v.colorBy === 'program') {
      const seen = new Set();
      for (const b of st.bars) for (const l of BarsMod.barLevels(b, st)) seen.add(l.program);
      if (st.podium.on) for (const l of st.podium.levels) seen.add(l.program);
      if (st.deck.on) seen.add('parking');
      for (const k of Object.keys(CONFIG.programs)) if (seen.has(k)) rows.push([progColor(k), CONFIG.programs[k].label, `prog-${k}`]);
    } else {
      st.bars.forEach((b, i) => rows.push([barColor(i), b.name, `bar-${b.id}`]));
      if (used.some((p) => p.zone === 'podium')) rows.push([CONFIG.zoneColors.podium, 'Podium', 'zone-podium']);
      if (used.some((p) => p.zone === 'deck')) rows.push([CONFIG.zoneColors.deck, 'Deck', 'zone-deck']);
    }
    if ((d && d.solids || []).some((x, i) => !(d.solidsOutside && d.solidsOutside[i]))) rows.push([CONFIG.zoneColors.screen, 'Roof screen', 'screen']);
    if (used.some((p) => p.outsideEnvelopeArea > 1) || (d && (d.solidsOutside || []).some(Boolean))) rows.push([CONFIG.outsideColor, 'Outside envelope', 'outside']);
    const key = JSON.stringify([rows, v.colorBy]);
    box.hidden = !rows.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    box.append(h('div', { class: 'label' }, v.colorBy === 'program' ? 'Program' : 'Bar'));
    for (const [color, text, id] of rows) box.append(h('div', { class: 'lg-row', 'data-key': id }, h('span', { class: 'sw', style: `background:${color}` }), h('span', null, text)));
  }

  /* ---- bottom sheet (iPad portrait / narrow) -------------------------------------------- */
  function initSheet() {
    const app = $('app'), grabber = $('grabber');
    const GRAB = 44;
    const total = () => app.clientHeight;
    // The lowest stop shows the grabber and the tab bar, so the tabs sit at the top of the sheet even when it is pulled down.
    const lowest = () => GRAB + ($('panelTabs').offsetHeight || 45) + 2;
    const snaps = () => [lowest(), Math.round(total() * 0.42), Math.round(total() * 0.86)];
    const setH = (px) => app.style.setProperty('--sheet-h', `${Math.round(clamp(px, lowest(), total() * 0.9))}px`);
    const curH = () => $('panel').getBoundingClientRect().height;
    const animateTo = (to) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setH(to);
      const from = curH(), t0 = performance.now();
      const step = (now) => {
        const p = clamp((now - t0) / 180, 0, 1);
        setH(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    let drag = null;
    grabber.addEventListener('pointerdown', (e) => {
      grabber.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, h: curH(), moved: false };
    });
    grabber.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) setH(drag.h + dy);
    });
    const end = () => {
      if (!drag) return;
      const s = snaps(), now = curH();
      if (!drag.moved) {                                   // tap: cycle to the next snap
        const next = s.find((v) => v > now + 8) || s[0];
        animateTo(next);
      } else {
        animateTo(s.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a)));
      }
      drag = null;
    };
    grabber.addEventListener('pointerup', end);
    grabber.addEventListener('pointercancel', end);
    grabber.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      setH(curH() + (e.key === 'ArrowUp' ? 60 : -60));
    });
    const reset = () => { if (sheetQuery.matches) setH(total() * 0.42); else app.style.removeProperty('--sheet-h'); };
    (sheetQuery.addEventListener ? sheetQuery.addEventListener('change', reset) : sheetQuery.addListener(reset));
    reset();
    window.addEventListener('resize', () => { if (sheetQuery.matches) { const px = parseFloat(app.style.getPropertyValue('--sheet-h')); if (px) setH(px); } });
    /** Pulls a collapsed sheet up to its middle stop (a tab was tapped, or an item was opened). */
    sheetRaise = () => { if (sheetQuery.matches && curH() < lowest() + 24) animateTo(snaps()[1]); };
  }
  let sheetRaise = () => {};
  const raiseSheet = () => sheetRaise();

  /* ---- keyboard ---------------------------------------------------------------------------- */
  function initKeys() {
    window.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); Options.save(); return; }
      if (key !== 'z' && key !== 'y') return;
      const t = e.target;
      if (t && t.matches && t.matches('input[type="text"], textarea') && t.dataset.dirty === '1') return;   // let the browser undo typing
      e.preventDefault();
      if (key === 'y' || e.shiftKey) Store.redo(); else Store.undo();
    });
  }

  function init() {
    buildTopBar();
    buildPanel();
    buildTabs();
    setTab(TABS.some((t) => t.id === prefs.tab) ? prefs.tab : 'form', { remember: false });
    buildViews();
    buildHud();
    initSheet();
    initKeys();
    Store.subscribe(() => { Controls.refreshAll(); swatchSyncs.forEach((fn) => fn()); updateLegend(Derived.get()); });
    Controls.refreshAll();
    swatchSyncs.forEach((fn) => fn());
    Render.onRebuild(updateHud);
    // A viewport that is not WebGL-capable still gets numbers.
    updateHud(Derived.get());
  }
  return {
    init, updateHud, rebuildPanel: () => { Controls.refreshAll(); },
    // hooks for the selection card
    openItem, setProgramForItems, setTab, activeTab: () => activeTab, tabs: () => TABS.map((t) => t.id), reorderBars,
    setHudOpen, hudOpen: () => $('hud').dataset.collapsed === 'false', sections: () => SECTIONS.map((s) => ({ id: s.id, tab: s.tab })),
  };
})();

/* SLOT: ai-prompts */
/* Filled: the entry is the AI Prompts item (#miAiPrompts) in the Export menu (UI.openExportMenu above); the panel and its logic are in 08b_prompts.js. */
