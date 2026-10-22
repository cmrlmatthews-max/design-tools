/* ==========================================================================
   UI
   Parking panels (Layout, Ramp, Checks, View), top bar, metrics HUD, preset view buttons, sheet.
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
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>',
};
const UI_STORAGE_KEY = 'parking.ui.v1';

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
  const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
  const signed = (v, fmt) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v))}`;
  const CAUTION = 'Caution: common design values, not code values. Verify against the adopted code.';

  /* ---- control shortcuts ------------------------------------------------------- */
  const lenS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: MAXD,
    format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  const lenF = (label, path, extra = {}) => lenS(label, path, 0, 1, { compact: true, ...extra });   // compact (number field only)
  const intS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: 999, integer: true,
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
  /** A share stored as a fraction, shown as a percent. */
  const pctS = (label, path, min, max, step, extra = {}) => Controls.slider({
    label, bind: Controls.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100),
    min, max, step, hardMin: 0, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal', ...extra,
  });
  /** A slope stored as a fraction, shown as a percent with two decimals. */
  const slopeS = (label, path, extra = {}) => Controls.slider({
    label, bind: Controls.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100),
    min: 0, max: 1, step: 0.1, hardMin: 0, hardMax: 100, compact: true, format: (v) => `${(Math.round(v * 100) / 100)}%`, inputMode: 'decimal', ...extra,
  });
  const sel = (label, path, options, bind) => Controls.select({ label, bind: bind || bs(path), options });
  const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const els = (list) => list.filter((c) => c != null && c !== false).map((c) => c.el || c);
  const mkList = (o) => Controls.list({ ...o, render: (i) => { const p = o.render(i); return { children: els(p.children || []), more: els(p.more || []) }; } });
  const get = (path) => Store.get(path);
  const D = () => Derived.get();
  const caution = (text = CAUTION) => h('p', { class: 'help caution' }, text);

  /** A select whose options come from a function (they change with the project or the layout). */
  function dynSelect(label, optionsFn, bind, id) {
    const select = h('select', { id: id || null });
    let key = '';
    select.addEventListener('change', () => bind.set(select.value));
    const refresh = () => {
      const list = optionsFn();
      const k = JSON.stringify(list);
      if (k !== key) { key = k; select.textContent = ''; for (const o of list) select.append(h('option', { value: String(o.value) }, o.label)); }
      const v = bind.get();
      if (v != null) select.value = String(v);
    };
    const wrap = h('div', { class: 'ctl select-row' }, h('label', null, label), select);
    refresh();
    return Controls.when(() => { refresh(); return true; }, [wrap]);
  }
  /** A text field bound to a store path. */
  function textField(label, path, { maxlength = 60, placeholder = '' } = {}) {
    const input = h('input', { class: 'pop-name', type: 'text', maxlength: String(maxlength), spellcheck: 'false', autocomplete: 'off', placeholder, 'aria-label': label });
    input.addEventListener('change', () => { Store.set(path, input.value.trim().slice(0, maxlength), { live: false }); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    const refresh = () => { if (document.activeElement !== input) input.value = String(get(path) == null ? '' : get(path)); };
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl text-row' }, h('label', { class: 'ctl-label' }, label), input)]);
  }
  /** A row of toggle buttons: pairs [value, label]. */
  function choice(label, path, pairs, { id } = {}) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': label, id: id || null });
    const btns = pairs.map(([value, text, title]) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-value': String(value), title: title || null }, text);
      b.addEventListener('click', () => Store.set(path, value, { live: false }));
      wrap.append(b);
      return b;
    });
    const refresh = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(get(path)))));
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, label), wrap)]);
  }
  const live = (id) => ({ set: (text) => { const el = $(id); if (el && el.textContent !== text) el.textContent = text; } });

  let coreList = null, entryList = null;

  /* ==========================================================================
     Layout tab
     ========================================================================== */
  function setSource(k) {
    if (k === 'standalone') { ProjectUI.useStandalone(); return; }
    if (!ProjectUI.has()) { Toast.show('Open a project first (Project menu). A wrap deck or a podium comes from the massing in the project.', 'warn', 6000); return; }
    ProjectUI.useSource(k);
  }
  function setSourceLevel(v) {
    const src = ProjectUI.sources().find((x) => x.source === get('source'));
    if (!src) return;
    const at = src.levels.findIndex((l) => String(l.index) === String(v));
    if (at < 0) return;
    const sub = src.levels.slice(at);
    const next = deepClone(Store.raw());
    next.sourceLevel = src.levels[at].index;
    next.levels.count = Math.min(CONFIG.limits.maxLevels, sub.length);
    next.levels.ftf1 = sub[0].ftf;
    next.levels.ftf = sub[1] ? sub[1].ftf : sub[0].ftf;
    Store.replace(fillDefaults(next));
  }
  function buildSource() {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Deck source', id: 'sourceChips' });
    const btns = ['standalone', 'wrap', 'podium'].map((k) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-source': k, 'aria-pressed': 'false', onclick: () => setSource(k) }, ({ standalone: 'Standalone', wrap: 'Wrap deck', podium: 'Podium' })[k]);
      wrap.append(b);
      return b;
    });
    const syncSource = () => {
      const s = get('source'), found = ProjectUI.sources();
      btns.forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.source === s));
        const need = b.dataset.source !== 'standalone' && !found.some((x) => x.source === b.dataset.source);
        b.classList.toggle('is-disabled', need);
        b.title = need ? (ProjectUI.has() ? 'The project has no such levels yet' : 'Open a project first') : '';
      });
    };
    Store.subscribe(syncSource);
    return {
      children: [
        Controls.when(() => { syncSource(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Parking is'), wrap)]).el,
        Controls.help('A standalone deck is free-standing. A wrap deck or a podium takes its footprint, level heights and cores from the massing in the open project.'),
        Controls.when(() => get('source') !== 'standalone', [
          dynSelect('First level of the deck', () => {
            const src = ProjectUI.sources().find((x) => x.source === get('source'));
            return src ? src.levels.map((l, i) => ({ value: l.index, label: `Level ${i + 1} · z ${Units.formatFeetInches(l.z)}` })) : [{ value: get('sourceLevel'), label: '—' }];
          }, { get: () => get('sourceLevel'), set: (v) => setSourceLevel(v) }, 'selSourceLevel'),
          h('p', { class: 'help', id: 'sourceNote' }),
        ]).el,
        h('div', { class: 'proj-line', id: 'projLine' }),
        Controls.when(() => ProjectUI.has(), [ProjectUI.nameControl().el]).el,
      ],
    };
  }

  function buildFootprint() {
    const standalone = () => get('source') === 'standalone';
    const rect = () => standalone() && get('footprint.shape') !== 'polygon';
    const poly = () => standalone() && get('footprint.shape') === 'polygon';
    const shapeBind = {
      get: () => get('footprint.shape'),
      set: (v) => {
        const fp = deepClone(get('footprint'));
        fp.shape = v;
        if (v === 'polygon' && (!Array.isArray(fp.points) || fp.points.length < 3)) {
          const w = num(fp.width, 300), d = num(fp.depth, 125), cx = num(fp.x, 0), cy = num(fp.y, 0);
          fp.points = [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]];
        }
        Store.set('footprint', fp, { live: false });
      },
      commit: () => {},
    };
    return {
      children: els([
        Controls.when(standalone, [sel('Shape', null, opts([['rect', 'Rectangle'], ['polygon', 'Polygon']]), shapeBind)]),
        Controls.when(rect, [
          lenS('Width', 'footprint.width', 100, 600), lenS('Depth', 'footprint.depth', 60, 400),
          degS('Angle', 'footprint.angle', -90, 90),
          Controls.group(els([lenF('Center x', 'footprint.x', { hardMin: -MAXD }), lenF('Center y', 'footprint.y', { hardMin: -MAXD })])),
        ]),
        Controls.when(poly, [Controls.points({ label: 'Footprint corners (x, y in feet)', bind: bs('footprint.points'), need: 3, needText: 'Needs at least 3 points. Until then the rectangle is used.' })]),
        Controls.when(() => !standalone(), [Controls.help('The footprint is the plate of the first deck or podium level in the project.')]),
        lenS('Perimeter wall', 'footprint.perimeter', 0, 4, { step: 0.5, hardMin: 0, hardMax: 20 }),
        Controls.toggle({ label: 'Rotate the bays 90 degrees', bind: bs('bays.rotateBays') }),
        h('p', { class: 'help', id: 'frameNote' }),
      ]),
    };
  }

  function buildLevels() {
    const fromProject = () => get('source') !== 'standalone' && ProjectUI.has();
    return {
      children: els([
        intS('Levels', 'levels.count', 1, 10, { hardMax: CONFIG.limits.maxLevels }),
        lenS('Level 1 floor-to-floor', 'levels.ftf1', 9, 16, { step: 0.5, hardMin: 6, hardMax: 30 }),
        lenS('Typical floor-to-floor', 'levels.ftf', 9, 14, { step: 0.5, hardMin: 6, hardMax: 30 }),
        intS('Levels below grade', 'levels.belowGrade', 0, 3, { hardMin: 0, hardMax: 12 }),
        Controls.toggle({ label: 'Open top (the top level parks cars, no slab above)', bind: bs('levels.openTop') }),
        Controls.when(fromProject, [Controls.help('Floor-to-floor heights come from the project levels while the source is a wrap deck or a podium.')]),
        h('p', { class: 'help', id: 'levelsNote' }),
      ]),
    };
  }

  function buildBays() {
    const tzBind = Controls.mapBind(bs('bays.turnZone'), (v) => (v == null ? 0 : v), (v) => (v > 0 ? v : null));
    return {
      children: els([
        Controls.group(els([lenF('Stall width', 'bays.stallW', { step: 0.5, hardMin: 6, hardMax: 14 }), lenF('Stall depth', 'bays.stallD', { step: 0.5, hardMin: 12, hardMax: 30 })])),
        lenS('Aisle width (two-way)', 'bays.aisle', 20, 28, { hardMin: 10, hardMax: 40 }),
        Controls.toggle({ label: 'Single-loaded edge bay for a wide remainder (42 ft or more)', bind: bs('bays.edgeBays') }),
        pctS('Compact stalls', 'bays.compactShare', 0, 50, 5),
      ]),
      more: els([
        Controls.group(els([lenF('Compact width', 'bays.compactW', { step: 0.5, hardMin: 6, hardMax: 12 }), lenF('Compact depth', 'bays.compactD', { step: 0.5, hardMin: 10, hardMax: 24 })])),
        Controls.slider({ label: 'End turn zone (0 = aisle width)', bind: tzBind, min: 0, max: 1, step: 1, hardMin: 0, hardMax: 120, compact: true, format: (v) => (v > 0 ? Units.formatFeetInches(v) : 'Aisle width'), parse: (t) => (/^\s*(auto|aisle|0)\s*$/i.test(t) ? 0 : Units.parseLength(t)), inputMode: 'text' }),
        Controls.help('Stalls are 90 degrees in two-way bays. The short end walls stay turn zones with no stalls.'),
      ]),
    };
  }

  function useSuggestion() {
    const sg = D().overlay.suggestion;
    if (!sg) return false;
    Store.set('bays.stallW', sg.stallW, { live: false });
    return true;
  }
  function buildGrid() {
    return {
      children: els([
        choice('Structural span', 'grid.span', [['long', 'Long span'], ['short', 'Short span']], { id: 'spanChips' }),
        lenS('Column size (square)', 'grid.column', 1, 4, { step: 0.5, hardMin: 0.5, hardMax: 8 }),
        intS('Stalls per module', 'grid.stallsPerModule', 2, 5, { hardMax: 8 }),
        h('p', { class: 'help', id: 'gridNote' }),
        Controls.when(() => !!D().overlay.suggestion, [
          h('p', { class: 'help', id: 'suggestNote' }),
          h('div', { class: 'add-row' }, Controls.button('Use the suggested width', () => useSuggestion(), 'outline sm', ), h('span', { class: 'help', style: 'margin:0' }, 'The tool never changes the width by itself.')),
        ]),
      ]),
      more: els([
        Controls.group(els([lenF('Structure depth, long span', 'grid.structureDepth.long', { step: 0.5, hardMin: 0.5, hardMax: 8 }), lenF('Structure depth, short span', 'grid.structureDepth.short', { step: 0.5, hardMin: 0.5, hardMax: 8 })])),
      ]),
    };
  }

  /* ---- cores ---- */
  function coreAt(i) { return Store.raw().cores[i]; }
  function moveCoreToRowAt(i, quiet) {
    const c = coreAt(i);
    if (!c) return false;
    let r = null;
    try { r = LayoutMod.moveCoreToRow(c, D().raw); } catch (e) { r = null; }
    if (!r) { if (!quiet) Toast.show('No stall row to move the core into.', 'warn'); return false; }
    const next = deepClone(Store.raw().cores);
    next[i] = { ...next[i], x: r.x, y: r.y };
    Store.set('cores', next, { live: false });
    if (!quiet) Toast.show(`${c.id} moved into row ${r.rowId}.`);
    return true;
  }
  function moveCoreById(id) {
    const i = Store.raw().cores.findIndex((c) => c.id === id);
    return i >= 0 ? moveCoreToRowAt(i) : false;
  }
  function moveAllCoresToRows() {
    const issues = D().coreIssues;
    const next = deepClone(Store.raw().cores);
    let n = 0;
    next.forEach((c, i) => {
      if (issues[c.id] !== 'aisle') return;
      let r = null;
      try { r = LayoutMod.moveCoreToRow(c, D().raw); } catch (e) { r = null; }
      if (r) { next[i] = { ...c, x: r.x, y: r.y }; n++; }
    });
    if (!n) { Toast.show('No core sits in a drive aisle.', '', 2400); return 0; }
    Store.set('cores', next, { live: false });
    Toast.show(`Moved ${n} core${n === 1 ? '' : 's'} into stall rows.`);
    return n;
  }
  /** Copies the project cores into the state so they can be moved. */
  function makeCoresEditable() {
    const list = D().cores.map((c) => ({ id: c.id, kind: c.kind, x: rnd(c.x, 100), y: rnd(c.y, 100), w: rnd(c.w, 100), d: rnd(c.d, 100) }));
    const next = deepClone(Store.raw());
    next.cores = list.slice(0, CONFIG.limits.maxCores);
    next.coresFromProject = false;
    Store.replace(fillDefaults(next));
    return list.length;
  }
  const newCore = (arr, kind) => {
    const pre = kind === 'elevator' ? 'E' : 'S';
    let n = 1;
    while (arr.some((c) => c.id === `${pre}${n}`)) n++;
    const p = num(Store.raw().footprint.perimeter, 1);
    const row = D().raw.bays && D().raw.bays[0] ? D().raw.bays[0].rows[0] : null;
    return { id: `${pre}${n}`, kind, x: p + 4, y: row ? row.y0 : p, w: kind === 'elevator' ? 10 : 22, d: kind === 'elevator' ? 10 : 12 };
  }
  function buildCores() {
    const projectCores = () => D().cores.some((c) => c.fromProject);
    const coresBind = {
      get: () => get('cores'),
      set: (v, live) => {
        if (Array.isArray(v) && v.length > CONFIG.limits.maxCores) { Toast.show(`A deck holds up to ${CONFIG.limits.maxCores} cores.`, 'warn'); return; }
        Store.set('cores', v, { live });
      },
      commit: () => Store.commit(),
    };
    coreList = mkList({
      bind: coresBind, addLabel: 'Add stair', min: 0, reorder: false, openDefault: () => false, empty: 'No cores.',
      title: (i, c) => {
        const issue = D().coreIssues[c.id];
        return `${c.id} · ${c.kind === 'elevator' ? 'Elevator' : 'Stair'} · ${Units.formatFeetInches(num(c.w, 0))} × ${Units.formatFeetInches(num(c.d, 0))}${issue === 'aisle' ? ' · in an aisle' : issue === 'outside' ? ' · outside' : ''}`;
      },
      make: (arr) => newCore(arr, 'stair'),
      render: (i) => ({
        children: [
          textField('Name', `cores.${i}.id`, { maxlength: 8 }),
          sel('Kind', `cores.${i}.kind`, opts([['stair', 'Stair'], ['elevator', 'Elevator']])),
          Controls.group(els([lenF('x', `cores.${i}.x`, { hardMin: -MAXD }), lenF('y', `cores.${i}.y`, { hardMin: -MAXD }), lenF('Width', `cores.${i}.w`), lenF('Depth', `cores.${i}.d`)])),
          h('div', { class: 'add-row' }, Controls.button('Move to the nearest row', () => moveCoreToRowAt(i), 'outline sm')),
        ],
      }),
    });
    return {
      children: [
        Controls.toggle({ label: 'Use the cores from the project', bind: bs('coresFromProject') }).el,
        Controls.when(() => projectCores(), [
          Controls.help('These cores come from the project massing and carry down through the deck. To move them, copy them into this design.'),
          h('div', { class: 'add-row' }, Controls.button('Make the cores editable', () => makeCoresEditable(), 'outline sm')),
          h('ul', { class: 'warns', id: 'projectCoreList' }),
        ]).el,
        Controls.when(() => !projectCores(), [
          Controls.help('Cores are the same on every level, in the layout frame (origin at the south-west corner). Drag them in the view, or type values here.'),
          coreList.el,
          h('div', { class: 'add-row' }, Controls.button('Add elevator', () => { const arr = deepClone(get('cores')); arr.push(newCore(arr, 'elevator')); coresBind.set(arr, false); }, 'outline sm'),
            Controls.button('Move all cores to rows', () => moveAllCoresToRows(), 'outline sm')),
        ]).el,
      ],
    };
  }

  function buildEntries() {
    const entriesBind = {
      get: () => get('entries'),
      set: (v, live) => {
        if (Array.isArray(v) && v.length > CONFIG.limits.maxEntries) { Toast.show(`A deck holds up to ${CONFIG.limits.maxEntries} entries.`, 'warn'); return; }
        Store.set('entries', v, { live });
      },
      commit: () => Store.commit(),
    };
    entryList = mkList({
      bind: entriesBind, addLabel: 'Add entry', min: 0, reorder: false, openDefault: () => false, empty: 'No entries.',
      title: (i, e) => `${e.id} · ${e.side} · ${Units.formatFeetInches(num(e.at, 0))} · ${Units.formatFeetInches(num(e.width, 0))} wide`,
      make: (arr) => {
        let n = arr.length + 1;
        while (arr.some((e) => e.id === `N${n}`)) n++;
        return { id: `N${n}`, side: 'east', at: Math.round(num(D().frame.D, 125) / 4), width: 24 };
      },
      render: (i) => ({
        children: els([
          sel('Side', `entries.${i}.side`, opts([['west', 'West end'], ['east', 'East end'], ['south', 'South side'], ['north', 'North side']])),
          Controls.group(els([lenF('Center along the side', `entries.${i}.at`, { hardMin: 0 }), lenF('Lane width', `entries.${i}.width`, { hardMin: 10, hardMax: 60 })])),
        ]),
      }),
    });
    return {
      children: [
        Controls.help('An entry at a short end lies in a turn zone and costs no stalls. An entry on a long side cuts the edge row it crosses.'),
        entryList.el,
      ],
    };
  }

  function buildLiner() {
    const reachBind = {
      get: () => { const l = get('liner.levels') || [1]; return l.length ? Math.max(...l) : 1; },
      set: (v) => Store.set('liner.levels', Array.from({ length: Math.max(1, Math.round(v)) }, (_, i) => i + 1), { live: false }),
      commit: () => {},
    };
    return {
      children: els([
        Controls.toggle({ label: 'Retail liner kept out of the parking area', bind: bs('liner.on') }),
        Controls.when(() => !!get('liner.on'), [
          sel('Side', 'liner.side', opts([['south', 'South'], ['north', 'North'], ['west', 'West'], ['east', 'East']])),
          lenS('Depth', 'liner.depth', 20, 100, { hardMin: 5 }),
          Controls.slider({ label: 'Up to level', bind: reachBind, min: 1, max: 4, step: 1, hardMin: 1, hardMax: CONFIG.limits.maxLevels, integer: true, format: Units.formatInt, inputMode: 'numeric', compact: true }),
          Controls.help('Stalls inside the liner are lost on those levels. The liner area is taken out of the gross deck area.'),
        ]),
      ]),
    };
  }

  /* ==========================================================================
     Ramp tab
     ========================================================================== */
  function buildRampType() {
    const rampBtns = h('div', { class: 'chips', role: 'group', 'aria-label': 'Ramp type', id: 'rampTypes' });
    const btns = RAMP_TYPES.map((k) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-ramp': k, 'aria-pressed': 'false', onclick: () => Store.set('ramp.type', k, { live: false }) }, RAMP_LABELS[k]);
      rampBtns.append(b);
      return b;
    });
    const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ramp === get('ramp.type'))));
    Store.subscribe(sync);
    const HELP = {
      'single-helix': 'Every bay climbs half a level; neighbouring bays climb in opposite directions. Turn zones stay flat.',
      'double-helix': 'Every bay climbs a full level. Turn zones stay flat.',
      speed: 'A separate ramp between levels. Its rectangle is cut from every level it touches.',
      split: 'Half-level end ramps. The end zones grow to the ramp length plus its two transitions.',
      'sloped-floor': 'One bay slopes a full level; the other bays stay flat.',
      none: 'No ramp. Every level is flat (a one-level deck, or levels reached another way).',
    };
    return {
      children: [
        Controls.when(() => { sync(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Ramp type'), rampBtns)]).el,
        h('p', { class: 'help', id: 'rampHelp' }),
        Controls.when(() => get('ramp.type') === 'sloped-floor', [
          dynSelect('Sloped bay', () => D().built.bays.map((b, i) => ({ value: i, label: `Bay ${b.index} (from the south)` })), { get: () => get('ramp.slopedBay'), set: (v) => Store.set('ramp.slopedBay', Number(v), { live: false }) }, 'selSlopedBay'),
        ]).el,
        Controls.when(() => get('ramp.type') === 'split', [lenS('Main ramp length', 'ramp.splitLength', 20, 80, { hardMin: 10, hardMax: 200 }), h('p', { class: 'help', id: 'splitNote' })]).el,
        Controls.label('Transitions'),
        Controls.group(els([lenF('Transition length', 'ramp.transition.length', { hardMin: 0, hardMax: 40 }), numS('Slope factor', 'ramp.transition.slopeFactor', 0, 1, 0.05, 2, { compact: true, hardMax: 1 })])),
        Controls.help('Each end of a transition slopes at the factor times the ramp slope (0.5 by default).'),
      ],
      help: HELP,
    };
  }
  function buildSpeed() {
    const on = () => get('ramp.type') === 'speed';
    return {
      children: [
        Controls.when(on, [
          choice('Shape', 'ramp.speed.shape', [['straight', 'Straight'], ['circular', 'Circular']]),
          Controls.group(els([lenF('x', 'ramp.speed.x', { hardMin: -MAXD }), lenF('y', 'ramp.speed.y', { hardMin: -MAXD })])),
          lenS('Width', 'ramp.speed.width', 18, 30, { hardMin: 10, hardMax: 60 }),
          Controls.when(() => get('ramp.speed.shape') !== 'circular', [lenS('Length (ramped)', 'ramp.speed.length', 40, 160, { hardMin: 20, hardMax: 400 })]),
          Controls.when(() => get('ramp.speed.shape') === 'circular', [
            lenS('Inside radius', 'ramp.speed.insideRadius', 20, 60, { hardMin: 10, hardMax: 200 }),
            choice('Segments', 'ramp.speed.segments', [[8, '8'], [12, '12'], [16, '16']]),
          ]),
          h('p', { class: 'help', id: 'speedNote' }),
        ]).el,
        Controls.when(() => !on(), [Controls.help('Choose Speed ramp to place a separate ramp in the strip beside the bays.')]).el,
      ],
    };
  }
  function buildRampSlopes() {
    return { children: [h('dl', { class: 'kv', id: 'rampList' }), Controls.help('The limits are on the Checks tab.')] };
  }

  /* ==========================================================================
     Checks tab
     ========================================================================== */
  function buildChecksList() {
    return {
      children: [
        h('ul', { class: 'warns', id: 'checksWarnings' }),
        h('div', { class: 'add-row' }, Controls.button('Move all cores to rows', () => moveAllCoresToRows(), 'outline sm')),
      ],
    };
  }
  function buildLimits() {
    return {
      children: els([
        caution(),
        Controls.group(els([slopeS('Parking ramp slope limit', 'checks.slopeParking'), slopeS('Speed and split ramp limit', 'checks.slopeSpeed')])),
        slopeS('Cross slope', 'checks.crossSlope'),
        Controls.group(els([lenF('Vehicle barrier', 'checks.barrier', { step: 0.25, hardMin: 0, hardMax: 10 }), lenF('Pedestrian guard', 'checks.guard', { step: 0.25, hardMin: 0, hardMax: 10 })])),
        lenF('Barrier the design shows', 'checks.barrierProvided', { step: 0.25, hardMin: 0, hardMax: 10 }),
        Controls.group(els([lenF('Clear height, general', 'checks.clearGeneral', { step: 0.25, hardMin: 0, hardMax: 20 }), lenF('Clear height, van route', 'checks.clearVan', { step: 0.25, hardMin: 0, hardMax: 20 })])),
        lenF('Column overlay tolerance', 'checks.overlayTolerance', { step: 0.5, hardMin: 0, hardMax: 20 }),
      ]),
    };
  }
  function buildAccessible() {
    const r2Bind = {
      get: () => { const v = get('accessible.r2.on'); return v === true ? 'on' : v === false ? 'off' : 'auto'; },
      set: (v) => Store.set('accessible.r2.on', v === 'on' ? true : v === 'off' ? false : null, { live: false }),
      commit: () => {},
    };
    const table = mkList({
      bind: bs('accessible.table'), addLabel: 'Add row', min: 999, reorder: false, openDefault: () => false,
      title: (i, r) => {
        const upTo = r.upTo == null ? 'over 1,000' : `up to ${Units.formatInt(r.upTo)}`;
        const need = r.count != null ? `${r.count}` : r.percent != null ? `${r.percent}%` : `${r.base} + ${r.per100Over1000} per 100`;
        return `${upTo} stalls · ${need}`;
      },
      make: () => ({ upTo: 1000, percent: 2 }),
      render: (i) => {
        const row = (get('accessible.table') || [])[i] || {};
        const kids = [];
        if (row.upTo != null) kids.push(numS('Up to (stalls)', `accessible.table.${i}.upTo`, 0, 1, 25, 0, { compact: true }));
        if (row.count != null) kids.push(numS('Accessible stalls', `accessible.table.${i}.count`, 0, 1, 1, 0, { compact: true }));
        if (row.percent != null) kids.push(numS('Percent of stalls', `accessible.table.${i}.percent`, 0, 1, 0.5, 1, { compact: true }));
        if (row.base != null) kids.push(numS('Base', `accessible.table.${i}.base`, 0, 1, 1, 0, { compact: true }), numS('Per 100 over 1,000', `accessible.table.${i}.per100Over1000`, 0, 1, 1, 0, { compact: true }));
        return { children: kids };
      },
    });
    const addRow = table.el.querySelector('.add-row');
    if (addRow) addRow.hidden = true;
    return {
      children: [
        caution('Caution: the table, the van rule and the aisle widths are seed values from IBC 1106.1. Verify every value against the adopted code and the accessibility standard.'),
        h('p', { class: 'help', id: 'accNote' }),
        Controls.group(els([numS('One van per', 'accessible.vanPer', 0, 1, 1, 0, { compact: true, hardMin: 1 }), lenF('Car aisle', 'accessible.aisleCar', { hardMin: 0, hardMax: 20 })])),
        lenF('Van aisle', 'accessible.aisleVan', { hardMin: 0, hardMax: 20 }),
        sel('Residential rule (R-2)', null, opts([['auto', 'Automatic (on for wrap and podium)'], ['on', 'On'], ['off', 'Off']]), r2Bind),
        numS('R-2 percent of stalls', 'accessible.r2.percent', 0, 1, 0.5, 1, { compact: true }),
        Controls.label('Table'),
        table.el,
      ],
    };
  }
  function buildEv() {
    return {
      children: els([
        pctS('EV installed (charging stalls)', 'ev.installedShare', 0, 20, 1),
        pctS('EV ready (conduit only)', 'ev.readyShare', 0, 50, 1),
        Controls.help('Installed stalls are taken from the rows nearest the entry, level 1 first. Ready stalls keep their kind.'),
        h('p', { class: 'help', id: 'evNote' }),
      ]),
    };
  }
  function buildBike() {
    return {
      children: els([
        sel('Bicycle spaces', 'bike.mode', opts([['per-units', 'One per number of units'], ['count', 'A typed count']])),
        Controls.when(() => get('bike.mode') !== 'count', [numS('One per (units)', 'bike.perUnits', 0, 1, 1, 0, { compact: true, hardMin: 1 })]),
        Controls.when(() => get('bike.mode') === 'count', [numS('Spaces', 'bike.count', 0, 1, 5, 0, { compact: true })]),
        sel('Rack', 'bike.rack', opts([['single', 'Single (12 sf each)'], ['two-tier', 'Two-tier (1.25 ft of wall each)']])),
        h('p', { class: 'help', id: 'bikeNote' }),
      ]),
    };
  }
  function buildRequired() {
    const unitsBind = {
      get: () => { const v = get('required.units'); return v == null ? (ProjectUI.massingUnits() == null ? 0 : ProjectUI.massingUnits()) : v; },
      set: (v, live) => Store.set('required.units', v, { live }),
      commit: () => Store.commit(),
    };
    return {
      children: els([
        Controls.slider({ label: 'Units served', bind: unitsBind, min: 0, max: 1, step: 10, compact: true, hardMin: 0, hardMax: 100000, integer: true, format: Units.formatInt, inputMode: 'numeric' }),
        h('div', { class: 'add-row' }, Controls.button('Use the project units', () => Store.set('required.units', null, { live: false }), 'outline sm'), h('span', { class: 'help', style: 'margin:0', id: 'unitsSource' })),
        Controls.group(els([numS('Stalls per unit', 'required.ratio', 0, 1, 0.05, 2, { compact: true }), numS('Retail (sf)', 'required.retailSf', 0, 1, 500, 0, { compact: true })])),
        Controls.help('Required = units x ratio + retail sf / 1,000 x 3, rounded up. The balance is stalls provided minus required.'),
        h('p', { class: 'help', id: 'requiredNote' }),
      ]),
    };
  }

  /* ==========================================================================
     View tab
     ========================================================================== */
  function buildDisplay() {
    const v = (k) => bs(`view.${k}`);
    const levelBind = { get: () => get('view.level'), set: (x) => Store.set('view.level', Math.round(x), { live: false }), commit: () => {} };
    return {
      children: els([
        sel('Style', 'view.style', opts([['model', 'Model'], ['diagram', 'Diagram']])),
        sel('Color by (diagram)', 'view.colorBy', opts([['kind', 'Stall kind'], ['slope', 'Ramp slope']])),
        Controls.slider({ label: 'Level (0 = all levels)', bind: levelBind, min: 0, max: 10, step: 1, hardMin: 0, hardMax: CONFIG.limits.maxLevels, integer: true, format: (x) => (x === 0 ? 'All' : String(x)), inputMode: 'numeric', compact: true }),
        Controls.toggle({ label: 'Stall numbers', bind: v('stallNumbers') }),
        Controls.toggle({ label: 'Column overlay (demising lines, conflicts)', bind: v('overlay') }),
        Controls.toggle({ label: 'Massing context (ghost)', bind: v('context') }),
        Controls.toggle({ label: 'Shadows', bind: v('shadows') }),
        Controls.toggle({ label: 'Grid', bind: v('grid') }),
        Controls.toggle({ label: 'Scale figure', bind: v('figure') }),
        Controls.help('Keys 1 to 6 jump to Axon, N, E, S, W and Plan. D switches Model and Diagram. L isolates the next level, Shift+L shows all levels.'),
      ]),
    };
  }

  const TABS = [
    { id: 'layout', title: 'Layout' },
    { id: 'ramp', title: 'Ramp' },
    { id: 'checks', title: 'Checks' },
    { id: 'view', title: 'View' },
  ];
  const SECTIONS = [
    { id: 'source', tab: 'layout', title: 'Source', open: true, build: buildSource },
    { id: 'footprint', tab: 'layout', title: 'Footprint', open: true, build: buildFootprint },
    { id: 'levels', tab: 'layout', title: 'Levels', open: true, build: buildLevels },
    { id: 'bays', tab: 'layout', title: 'Bays and stalls', build: buildBays },
    { id: 'grid', tab: 'layout', title: 'Column grid', build: buildGrid },
    { id: 'cores', tab: 'layout', title: 'Cores', open: true, build: buildCores },
    { id: 'entries', tab: 'layout', title: 'Entries', build: buildEntries },
    { id: 'liner', tab: 'layout', title: 'Liner', build: buildLiner },
    { id: 'ramptype', tab: 'ramp', title: 'Ramp type', open: true, build: buildRampType },
    { id: 'speed', tab: 'ramp', title: 'Speed ramp', open: true, build: buildSpeed },
    { id: 'rampslopes', tab: 'ramp', title: 'Slopes', open: true, build: buildRampSlopes },
    { id: 'checkslist', tab: 'checks', title: 'Warnings', open: true, build: buildChecksList },
    { id: 'limits', tab: 'checks', title: 'Limits', build: buildLimits },
    { id: 'accessible', tab: 'checks', title: 'Accessible stalls', open: true, build: buildAccessible },
    { id: 'ev', tab: 'checks', title: 'EV', build: buildEv },
    { id: 'bike', tab: 'checks', title: 'Bicycles', build: buildBike },
    { id: 'required', tab: 'checks', title: 'Required parking', open: true, build: buildRequired },
    { id: 'display', tab: 'view', title: 'Display', open: true, build: buildDisplay },
  ];
  const sectionCtl = {};          // id -> Controls.section result
  let activeTab = 'layout';
  const scrollPos = {};
  let rampHelpText = {};

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
      if (parts.help) rampHelpText = parts.help;
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
    footprint: { tab: 'layout', section: 'footprint' },
    core: { tab: 'layout', section: 'cores', list: () => coreList, index: (it) => Store.raw().cores.findIndex((c) => c.id === it.id) },
    entry: { tab: 'layout', section: 'entries', list: () => entryList, index: (it) => Store.raw().entries.findIndex((e) => e.id === it.id) },
    speed: { tab: 'ramp', section: 'speed' },
  };
  /**
   * Switches to the tab that holds the item, opens its section (and its row when the kind is a list), and scrolls it into view.
   * item: { kind: 'footprint' | 'speed' } | { kind: 'core' | 'entry', id }. Returns true when something was opened.
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

  /* ---- top bar -------------------------------------------------------------------- */
  const iconBtn = (icon, text, attrs = {}) => h('button', { class: 'btn has-text', type: 'button', 'aria-label': text, title: text, ...attrs },
    h('span', { html: icon, style: 'display:contents' }), h('span', { class: 'btn-text' }, text));

  const snapState = () => { const s = get('view.snap') || {}; return { on: s.on !== false, grid: s.grid === 5 ? 5 : 1 }; };
  const setSnap = (patch) => Store.set('view.snap', { ...snapState(), ...patch }, { live: false });

  function openSnapMenu(anchor) {
    const el = h('div', { role: 'group', 'aria-label': 'Snap options' });
    const sw = h('button', { class: 'toggle-row', type: 'button', role: 'switch', id: 'snapSwitch', style: 'padding:0 8px' }, h('span', null, 'Snap while dragging'), h('span', { class: 'switch', 'aria-hidden': 'true' }));
    const chips = CONFIG.snapGrids.map((g) => h('button', { class: 'chip', type: 'button', 'data-grid': String(g), 'aria-pressed': 'false', onclick: () => setSnap({ grid: g }) }, `${g} ft`));
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
      h('div', { class: 'pop-note' }, 'Snaps to the grid, the footprint edges, the bay lines, the stall rows, the column lines and the strip. Hold Option (Alt) while dragging to skip it. Rotation snaps to 5 degrees.'),
    );
    Pop.open(anchor, el, { align: 'right', onClose: off });
  }

  /** The Export menu: Image, AI-ready image, AI Prompts, the image overlay choices (a sub-view), files, and Send to. */
  function openExportMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'exportMenu' });
    const item = (id, title, sub, onclick, o = {}) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', id, disabled: o.disabled, onclick: () => { if (!o.keep) Pop.close(); onclick(); } },
      h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null), o.chev ? h('span', { html: ICONS.chev, class: 'chev-r', style: 'display:contents' }) : null);
    const main = () => {
      el.textContent = '';
      el.append(h('div', { class: 'label pop-label' }, 'Pictures'),
        item('miImage', 'Image', 'Save a PNG of this view', () => Shots.take()),
        item('miAiReady', 'AI-ready image', 'Plain model, no overlay or grid. For ChatGPT or Gemini.', () => Shots.takeAiReady()),
        item('miAiPrompts', 'AI Prompts', 'A prompt to pair with the AI-ready image', () => Prompts.toggle()),
        item('miOverlay', 'Image overlay', 'Choose what the Image shows', () => overlay(), { keep: true, chev: true }),
        h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Files'),
        item('miSketchup', 'SketchUp (.json)', 'Import with the CMRLM SketchUp extension', () => SketchupExport.download()),
        item('miDxf', 'DXF (.dxf)', 'Slabs, stalls, ramp faces and columns for Revit', () => SketchupExport.dxf()),
        item('miCsv', 'Stall list (.csv)', 'One row per stall', () => SketchupExport.csv()),
        item('miExportJson', 'Export JSON', 'Download all saved options', () => Options.exportJson()),
        item('miImportJson', 'Import JSON', 'Add the options from a file', () => $('importFile').click()),
        h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Send to'),
        item('miSendFacade', 'Send to Facade Studio', 'Save the project and open the Facade Studio', () => ProjectUI.send('facade')));
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
    const snapCaret = h('button', { class: 'btn caret-only', type: 'button', id: 'btnSnapMenu', 'aria-label': 'Snap grid size', title: 'Choose the snap grid (1 or 5 ft)', 'aria-haspopup': 'true', 'aria-expanded': 'false', html: ICONS.chev, onclick: () => openSnapMenu(snapCaret) });
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

    const exp = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnExport', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Export: image, AI-ready image, AI prompts, SketchUp, DXF, stall list, JSON', 'aria-label': 'Export menu', onclick: () => openExportMenu(exp) },
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
  function buildHud() {
    const hud = $('hud');
    const open = !!prefs.hudOpen;                      // remembered: expanded or compact
    hud.dataset.collapsed = open ? 'false' : 'true';
    hud.innerHTML = `
      <button class="hud-toggle" id="hudToggle" type="button" aria-expanded="${open}" aria-controls="hudBody" title="Show or hide all metrics">
        <span class="hud-top">
          <span class="label">Deck</span>
          <span class="hud-badge" id="hudBadge" data-n="0" title="Warnings">0 warnings</span>
          ${CARET_SVG}
        </span>
        <span class="hud-core">
          <span class="m"><span class="k">Stalls</span><span class="v" id="mStalls">-</span></span>
          <span class="m"><span class="k">Sf per stall</span><span class="v" id="mSfStall">-</span></span>
          <span class="m"><span class="k">Levels</span><span class="v" id="mLevels">-<small id="mLevelsSub"></small></span></span>
          <span class="m"><span class="k">Max ramp slope</span><span class="v" id="mSlope">-<small id="mSlopeSub"></small></span></span>
        </span>
      </button>
      <div class="hud-body" id="hudBody">
        <dl class="metrics compact">
          <div class="m"><dt>Accessible</dt><dd id="mAcc">-</dd></div>
          <div class="m"><dt>Parking balance</dt><dd id="mBalance">-</dd></div>
          <div class="m"><dt>Lowest clear height</dt><dd id="mClear">-</dd></div>
          <div class="m"><dt>Column conflicts</dt><dd id="mConflicts">-</dd></div>
          <div class="m"><dt>Gross deck area</dt><dd id="mGross">-</dd></div>
          <div class="m"><dt>Efficiency</dt><dd id="mEff">-</dd></div>
          <div class="m"><dt>EV installed / ready</dt><dd id="mEv">-</dd></div>
          <div class="m"><dt>Bicycles</dt><dd id="mBike">-</dd></div>
          <div class="m"><dt>Columns per level</dt><dd id="mCols">-</dd></div>
          <div class="m"><dt>Top of deck</dt><dd id="mTop">-</dd></div>
        </dl>
        <div class="sec" id="hudLevels"><div class="label">Stalls by level</div><dl class="kv" id="hudLevelsList"></dl></div>
        <div class="sec" id="hudClear"><div class="label">Clear height by level</div><dl class="kv" id="hudClearList"></dl><p class="help caution" id="hudCaution">${CAUTION}</p></div>
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
  function setText(id, text) { const el = $(id); if (!el) return; if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = text; else el.prepend(document.createTextNode(text)); }
  function kvRows(list, rows) {
    list.textContent = '';
    for (const [k, v, cls] of rows) list.append(h('dt', null, k), h('dd', cls ? { class: cls } : null, v));
  }
  const ftIn = (ft) => (ft == null ? 'open' : Units.formatFeetInches(ft));

  function updateHud(d) {
    const m = d.hud, st = Store.raw();
    setText('mStalls', Units.formatInt(m.stalls));
    setText('mSfStall', m.sfPerStall >= 100 ? Units.formatInt(Math.round(m.sfPerStall)) : Units.formatRatio(m.sfPerStall, 1));
    setText('mLevels', Units.formatInt(m.levels));
    $('mLevelsSub').textContent = m.topOfDeck ? `${Units.formatFeetInches(m.topOfDeck)} high` : '';
    setText('mSlope', pct1(m.maxSlope));
    $('mSlopeSub').textContent = st.ramp.type === 'none' ? 'no ramp' : RAMP_LABELS[st.ramp.type].toLowerCase();
    $('mSlope').classList.toggle('bad', d.ramps.some((r) => !r.ok));

    const acc = m.accessible;
    setText('mAcc', `${Units.formatInt(acc.provided)} of ${Units.formatInt(acc.required)} · ${Units.formatInt(acc.van)} van`);
    setText('mBalance', `${m.balance > 0 ? '+' : ''}${Units.formatInt(m.balance)} (needs ${Units.formatInt(m.required)})`);
    $('mBalance').classList.toggle('bad', m.balance < 0);
    setText('mClear', m.lowestClear ? Units.formatFeetInches(m.lowestClear) : '-');
    $('mClear').classList.toggle('bad', m.clearHeights.some((c) => !c.ok));
    setText('mConflicts', m.columns.source === 'none' ? 'no overlay source' : Units.formatInt(m.conflicts));
    $('mConflicts').classList.toggle('bad', m.conflicts > 0);
    setText('mGross', Units.formatArea(m.gross));
    setText('mEff', pct1(m.efficiency));
    setText('mEv', `${Units.formatInt(m.ev.installed)} / ${Units.formatInt(m.ev.ready)}`);
    setText('mBike', m.bike.required ? `${Units.formatInt(m.bike.required)} · ${m.bike.areaSf ? `${Units.formatInt(m.bike.areaSf)} sf` : `${(m.bike.wallFt || 0).toFixed(1)} ft wall`}` : '0');
    setText('mCols', Units.formatInt(m.columns.perLevel));
    setText('mTop', m.topOfDeck ? Units.formatFeetInches(m.topOfDeck) : '-');

    kvRows($('hudLevelsList'), m.byLevel.map((b) => [`Level ${b.index}`, Units.formatInt(b.stalls)]));
    kvRows($('hudClearList'), m.clearHeights.map((c) => [`Level ${c.level}`, c.open ? 'open top' : `${ftIn(c.clear)} (needs ${ftIn(c.min)})`, c.ok ? '' : 'tgt-neg']));

    const list = $('warnList');
    list.textContent = '';
    if (!d.warnings.length) list.append(h('li', { class: 'none' }, 'No warnings'));
    for (const w of d.warnings) list.append(warnItem(w));
    $('warnCount').textContent = String(d.warnings.length);
    $('warnBlock').dataset.n = String(d.warnings.length);
    const nw = d.warnings.length;
    $('hudBadge').dataset.n = String(nw);
    $('hudBadge').textContent = `${nw} ${nw === 1 ? 'warning' : 'warnings'}`;

    updateNotes(d);
    updateLegend(d);
  }
  function warnItem(w) {
    const li = h('li', { class: `warn-${w.level}`, 'data-warn': w.id || '' }, w.text);
    if (w.action === 'move-to-row' && w.ref) li.append(' ', h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'move-to-row', onclick: () => moveCoreById(w.ref) }, 'Move to the nearest row'));
    return li;
  }

  /** The small readouts inside the panel sections. */
  function updateNotes(d) {
    const st = Store.raw(), f = d.frame;
    const fn = $('frameNote');
    if (fn) fn.textContent = f && f.W ? `Layout ${Units.formatFeetInches(f.W)} × ${Units.formatFeetInches(f.D)} · ${d.built.bays.length} bay${d.built.bays.length === 1 ? '' : 's'}${d.built.strip ? ` · strip ${Units.formatFeetInches(d.built.strip.y1 - d.built.strip.y0)}` : ''}` : '';
    const sn = $('sourceNote');
    if (sn) { const s = ProjectUI.sources().find((x) => x.source === st.source); sn.textContent = s ? `${s.levels.length} ${s.zone} level${s.levels.length === 1 ? '' : 's'} in the project (${Units.formatArea(s.levels[0].area)} on the first).` : 'The project has no such levels.'; }
    const gn = $('gridNote');
    if (gn) gn.textContent = `Module ${Units.formatFeetInches(d.columns.module || 0)} · ${d.columns.perLevel || 0} columns per level.`;
    const sg = d.overlay.suggestion, sgn = $('suggestNote');
    if (sgn && sg) sgn.textContent = `Units ${Units.formatFeetInches(d.overlay.unitWidth)} wide: a stall width of ${Units.formatFeetInches(sg.stallW)} lines the columns up and gives ${sg.stallsPerRow} stalls per row.`;
    const lv = $('levelsNote');
    if (lv) lv.textContent = d.hud.topOfDeck ? `Top of the deck ${Units.formatFeetInches(d.hud.topOfDeck)} above the first level.` : '';
    const rh = $('rampHelp');
    if (rh) rh.textContent = rampHelpText[st.ramp.type] || '';
    const sp = $('splitNote');
    if (sp) sp.textContent = `End zone ${Units.formatFeetInches(RampsMod.splitEndZone(st))} (main ramp plus two transitions).`;
    const spn = $('speedNote');
    if (spn) {
      const fp = RampsMod.speedRampFootprint(st);
      const lost = d.raw.levels.length ? ((d.raw.levels[0].cuts.find((c) => c.kind === 'ramp') || {}).lost || 0) : 0;
      spn.textContent = fp ? `Cut from every level: ${Units.formatFeetInches(fp.box[2] - fp.box[0])} × ${Units.formatFeetInches(fp.box[3] - fp.box[1])}. Stalls lost per level: ${lost}.` : '';
    }
    const rl = $('rampList');
    if (rl) {
      const rows = d.ramps.filter((r) => r.level === (d.ramps[0] ? d.ramps[0].level : 1)).map((r) => [`${r.id}`, `${pct1(Math.abs(r.slope))} of ${pct1(r.limit)}`, r.ok ? '' : 'tgt-neg']);
      const lastLevel = d.ramps.length ? Math.max(...d.ramps.map((r) => r.level)) : 0;
      if (lastLevel > 1) { const t = d.ramps.find((r) => r.level === Math.min(2, lastLevel)); if (t) rows.push([`${t.id} (typical)`, `${pct1(Math.abs(t.slope))} of ${pct1(t.limit)}`, t.ok ? '' : 'tgt-neg']); }
      if (!rows.length) rows.push(['No ramp', '-']);
      kvRows(rl, rows);
    }
    const cw = $('checksWarnings');
    if (cw) { cw.textContent = ''; if (!d.warnings.length) cw.append(h('li', { class: 'none' }, 'No warnings')); for (const w of d.warnings) cw.append(warnItem(w)); }
    const pcl = $('projectCoreList');
    if (pcl) { pcl.textContent = ''; for (const c of d.cores) pcl.append(h('li', { class: 'none' }, `${c.id} · ${c.kind} · ${Units.formatFeetInches(c.w)} × ${Units.formatFeetInches(c.d)} at ${Units.formatFeetInches(c.x)}, ${Units.formatFeetInches(c.y)}`)); }
    const an = $('accNote');
    if (an) { const a = d.hud.accessible; an.textContent = `${a.required} required (${a.van} van, ${a.car} car), ${a.provided} provided. The access aisles take ${a.lost} stall${a.lost === 1 ? '' : 's'}.${d.acc && d.acc.warnings && d.acc.warnings.length ? ' See the warnings.' : ''}`; }
    const en = $('evNote');
    if (en) en.textContent = `${d.hud.ev.installed} installed, ${d.hud.ev.ready} ready.`;
    const bn = $('bikeNote');
    if (bn) bn.textContent = d.hud.bike.required ? `${d.hud.bike.required} spaces, ${d.hud.bike.areaSf ? `${Units.formatInt(d.hud.bike.areaSf)} sf` : `${(d.hud.bike.wallFt || 0).toFixed(1)} ft of wall`}.` : 'No bicycle spaces required (no units).';
    const us = $('unitsSource');
    if (us) us.textContent = d.metrics && d.metrics.required ? ({ typed: 'Typed.', massing: 'From the project massing.', none: 'No units known.' }[d.metrics.required.unitsSource] || '') : '';
    const rn = $('requiredNote');
    if (rn) rn.textContent = `${Units.formatInt(d.hud.required)} stalls required, ${Units.formatInt(d.hud.stalls)} provided (${d.hud.balance >= 0 ? 'surplus' : 'short by'} ${Units.formatInt(Math.abs(d.hud.balance))}).`;
  }

  /* ---- color legend (Diagram style) ------------------------------------------------------ */
  function updateLegend(d) {
    const box = $('legend');
    const st = Store.raw(), v = st.view;
    if (v.style !== 'diagram' || Render.comparing()) { box.hidden = true; return; }
    const rows = [];
    if (v.colorBy === 'slope') {
      rows.push([CONFIG.slopeColors.ok, 'Under 80% of the limit', 'slope-ok'], [CONFIG.slopeColors.near, 'Up to the limit', 'slope-near'], [CONFIG.slopeColors.over, 'Over the limit', 'slope-over']);
    } else {
      const seen = new Set();
      for (const lv of (d && d.levels) || []) for (const s of lv.stalls) seen.add(s.kind || 'standard');
      for (const k of Object.keys(CONFIG.kindColors)) if (seen.has(k)) rows.push([CONFIG.kindColors[k], CONFIG.kindLabels[k], `kind-${k}`]);
    }
    rows.push([CONFIG.coreColors.stair, 'Stair', 'core-stair'], [CONFIG.coreColors.elevator, 'Elevator', 'core-elevator']);
    if (d && d.overlay && d.overlay.conflicts.length) rows.push([CONFIG.conflictColor, 'Column conflict', 'conflict']);
    const key = JSON.stringify([rows, v.colorBy]);
    box.hidden = !rows.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    box.append(h('div', { class: 'label' }, v.colorBy === 'slope' ? 'Ramp slope' : 'Stalls'));
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
    setTab(TABS.some((t) => t.id === prefs.tab) ? prefs.tab : 'layout', { remember: false });
    buildViews();
    buildHud();
    initSheet();
    initKeys();
    Store.subscribe(() => { Controls.refreshAll(); updateLegend(Derived.get()); });
    Controls.refreshAll();
    Render.onRebuild(updateHud);
    // A viewport that is not WebGL-capable still gets numbers.
    updateHud(Derived.get());
  }
  return {
    init, updateHud, rebuildPanel: () => { Controls.refreshAll(); },
    // hooks for the selection card
    openItem, setTab, activeTab: () => activeTab, tabs: () => TABS.map((t) => t.id),
    moveCoreById, moveAllCoresToRows, makeCoresEditable,
    setHudOpen, hudOpen: () => $('hud').dataset.collapsed === 'false', sections: () => SECTIONS.map((s) => ({ id: s.id, tab: s.tab })),
  };
})();

/* SLOT: ai-prompts */
/* Filled: the entry is the AI Prompts item (#miAiPrompts) in the Export menu (UI.openExportMenu above); the panel and its logic are in 08b_prompts.js. */
