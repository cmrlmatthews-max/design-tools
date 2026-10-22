/* ==========================================================================
   UI
   Grading Sketch panels (Buildings, Site work, Checks, View), top bar, HUD (cut, fill, net, tallest wall), preset view buttons, sheet.
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
  export: '<svg viewBox="0 0 24 24"><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M3 5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.8"/><path d="M12 17h.01"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
};
const UI_STORAGE_KEY = 'grading.ui.v1';

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
  const E = (v) => Units.formatElev(v);
  const FT = (v) => Units.formatFeetInches(v);
  const get = (path) => Store.get(path);
  const D = () => Derived.get();
  const els = (list) => list.filter((c) => c != null && c !== false).map((c) => c.el || c);
  const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const mkList = (o) => Controls.list({ ...o, render: (i) => { const p = o.render(i); return { children: els(p.children || []), more: els(p.more || []) }; } });
  const caution = (text) => h('p', { class: 'help caution' }, text);
  const signedCy = (v) => Units.formatSigned(v, (x) => `${Units.grouped(x)} cy`);
  const wallFt = (v) => (v > 0 ? `${(Math.round(v * 10) / 10).toFixed(1)} ft` : '0 ft');

  /* ---- control shortcuts ------------------------------------------------------- */
  const lenS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 0, hardMax: MAXD,
    format: FT, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  const lenF = (label, path, extra = {}) => lenS(label, path, 0, 1, { compact: true, ...extra });
  const intS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: 999, integer: true,
    format: Units.formatInt, inputMode: 'numeric', ...extra,
  });
  const degS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: -3600, hardMax: 3600,
    format: (v) => `${round1(v)}°`, inputMode: 'decimal', ...extra,
  });
  /** A value stored as a plain number but shown with a suffix: percent slopes, ratios. */
  const numS = (label, path, min, max, step, suffix, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step, hardMin: -1e6, hardMax: 1e6,
    format: (v) => `${round1(v)}${suffix}`, inputMode: 'decimal', ...extra,
  });
  /** A share stored as a fraction, shown as a percent (limits). */
  const pctS = (label, path, min, max, step, extra = {}) => Controls.slider({
    label, bind: Controls.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100),
    min, max, step, hardMin: 0, hardMax: 100, format: (v) => `${(Math.round(v * 100) / 100)}%`, inputMode: 'decimal', ...extra,
  });
  const sel = (label, path, options, bind) => Controls.select({ label, bind: bind || bs(path), options });

  /** A text field bound to a store path. */
  function textField(label, path, { maxlength = 60, placeholder = '' } = {}) {
    const input = h('input', { class: 'pop-name', type: 'text', maxlength: String(maxlength), spellcheck: 'false', autocomplete: 'off', placeholder, 'aria-label': label });
    input.addEventListener('change', () => { Store.set(path, input.value.trim().slice(0, maxlength), { live: false }); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    const refresh = () => { if (document.activeElement !== input) input.value = String(get(path) == null ? '' : get(path)); };
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl text-row' }, h('label', { class: 'ctl-label' }, label), input)]);
  }
  /** A row of toggle buttons driven by a bind: pairs [value, label, title, disabledFn]. */
  function choiceB(label, bind, pairs, { id } = {}) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': label, id: id || null });
    const btns = pairs.map(([value, text, title, off]) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-value': String(value), title: title || null }, text);
      b.addEventListener('click', () => { if (!b.classList.contains('is-disabled')) bind.set(value, false); else if (title) Toast.show(title, 'warn', 5000); });
      wrap.append(b);
      b._off = off;
      return b;
    });
    const refresh = () => btns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.value === String(bind.get())));
      b.classList.toggle('is-disabled', !!(b._off && b._off()));
    });
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl' }, label ? h('div', { class: 'ctl-label' }, label) : null, wrap)]);
  }
  const choice = (label, path, pairs, o = {}) => choiceB(label, { get: () => get(path), set: (v) => Store.set(path, v, { live: false }) }, pairs, o);
  /** A small button that selects an item in the view (handles show) and goes to the plan. */
  const showBtn = (kind, idFn) => Controls.button('Show on plan', () => { const id = idFn(); if (id == null) return; if (Render.ready() && Render.info().preset !== 'plan') Render.setView('plan', true); Select.select([{ kind, id }]); }, 'outline sm');
  const redrawBtn = (kind, idFn) => Controls.button("Redraw", () => { const id = idFn(); if (id == null) return; Select.redraw({ kind, id }); }, "outline sm");

  /* ==========================================================================
     Buildings tab
     ========================================================================== */
  const hasSec = (k) => ProjectUI.has() && ProjectUI.hasSection(k);
  function buildSource() {
    const syncSource = () => {};
    return {
      children: els([
        choiceB('Work is on', { get: () => get('source'), set: (k) => { if (k === 'standalone') ProjectUI.useStandalone(); else if (!ProjectUI.has()) Toast.show('Open a project first (Project menu). The site, the massing and the parking deck come from the Site Model, the Mid-Rise Generator and the Parking Deck.', 'warn', 6000); else ProjectUI.useProject(); } },
          [['standalone', SOURCE_LABELS.standalone], ['project', SOURCE_LABELS.project, 'Open a project first', () => !ProjectUI.has()]], { id: 'sourceChips' }),
        Controls.help('Standalone uses the typed ground and the buildings below. An open project adds its massing and parking deck as buildings and, when it has one, its site ground.'),
        h('p', { class: 'help', id: 'sourceNote' }),
        h('div', { class: 'proj-line', id: 'projLine' }),
        Controls.when(() => ProjectUI.has(), [ProjectUI.nameControl().el]).el,
      ]),
    };
  }

  function buildGround() {
    const mode = () => get('ground.mode');
    return {
      children: els([
        choiceB('Existing ground', { get: mode, set: (k) => { if (k === 'site' && !ProjectUI.hasSiteGround()) { Toast.show(ProjectUI.has() ? 'The project has no site ground yet. Make one in the Site Model.' : 'Open a project with a site first (Project menu).', 'warn', 6000); return; } Store.set('ground.mode', k, { live: false }); } },
          [['plane', 'Typed plane'], ['site', 'Project site', 'The project has no site ground', () => !ProjectUI.hasSiteGround()]], { id: 'groundChips' }),
        Controls.when(() => mode() === 'plane', [
          Controls.slider({ label: 'Elevation at the origin', bind: bs('ground.plane.z0'), min: 900, max: 1100, step: 1, hardMin: -1000, hardMax: 20000, format: E, inputMode: 'decimal' }),
          numS('Slope', 'ground.plane.slope', 0, 30, 0.5, '%', { hardMin: -100, hardMax: 100 }),
          degS('Falls toward', 'ground.plane.downhill', 0, 360, { hardMin: 0, hardMax: 360 }),
          h('p', { class: 'help', id: 'groundNote' }),
          lenS('Margin around the work', 'ground.margin', 50, 400, { hardMax: 2000, step: 10 }),
          Controls.help('A typed plane is a flat tilted surface. Elevations are local feet. The north direction is 0 degrees and east is 90.'),
        ]),
        Controls.when(() => mode() === 'site', [
          Controls.help('The existing ground comes from the Site Model of the open project. Elevations are NAVD88 feet.'),
          caution('Caution: the USGS ground can differ from a survey. FFEs can be off by a foot or more. Confirm every elevation against a survey.'),
        ]),
      ]),
    };
  }

  /* ---- the building cards ---------------------------------------------------------------------------------------- */
  const bAt = (i) => (get('buildings') || [])[i] || {};
  const bPath = (i, k) => `buildings.${i}.${k}`;
  const builtIdOf = (b) => (b.source === 'typed' ? b.id : b.source);
  const builtOf = (i) => { const b = bAt(i); return D().built.buildings.find((x) => x.id === builtIdOf(b)) || null; };
  const rectRing = (w, d, cx, cy) => [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]];
  const rectOf = (i) => {
    const o = bAt(i).outer;
    if (!Array.isArray(o) || o.length !== 4) return null;
    const xs = [...new Set(o.map((p) => rnd(p[0], 1000)))].sort((a, b) => a - b), ys = [...new Set(o.map((p) => rnd(p[1], 1000)))].sort((a, b) => a - b);
    if (xs.length !== 2 || ys.length !== 2) return null;
    return { w: xs[1] - xs[0], d: ys[1] - ys[0], cx: (xs[0] + xs[1]) / 2, cy: (ys[0] + ys[1]) / 2 };
  };
  const rectBind = (i, key) => ({
    get: () => { const r = rectOf(i); return r ? r[key] : 0; },
    set: (v, live) => { const r = rectOf(i); if (r) Store.set(bPath(i, 'outer'), rectRing(...Object.values({ ...r, [key]: v }).slice(0, 4).map((x) => rnd(x))), { live: !!live }); },
    commit: () => Store.commit(),
  });
  function setBuildingSource(i, src) {
    const b = deepClone(bAt(i));
    if (!b || b.source === src) return;
    b.source = src;
    if (src === 'typed') { if (!Array.isArray(b.outer)) { const bb = builtOf(i); b.outer = bb ? bb.outer.map((p) => [rnd(p[0]), rnd(p[1])]) : rectRing(100, 60, 0, 0); } }
    else delete b.outer;
    Store.set(`buildings.${i}`, b, { live: false });
  }
  const tierBind = (i, j, key) => ({ get: () => ((bAt(i).tiers || [])[j] || {})[key], set: (v, live) => Store.set(`${bPath(i, 'tiers')}.${j}.${key}`, v, { live: !!live }), commit: () => Store.commit() });
  function applySteps(i) {
    const bb = builtOf(i);
    if (!bb) return null;
    const sg = FeaturesMod.suggestTiers(bb, D().built.existingAt, get('maxStep'));
    const tiers = Array.from({ length: sg.count }, () => ({ length: null, ffe: 'balance' }));
    Store.set(bPath(i, 'tiers'), tiers, { live: false });
    return sg;
  }
  const lists = {};
  function buildBuildings() {
    const newBuilding = (arr) => {
      let n = arr.length + 1;
      while (arr.some((b) => b.id === `B${n}`)) n++;
      const box = D().box;
      const cx = box ? Math.round(box.maxX + 80) : 0, cy = box ? Math.round((box.minY + box.maxY) / 2) : 0;
      return { id: `B${n}`, name: `Building ${n}`, source: 'typed', outer: rectRing(100, 60, cx, cy), axis: 'auto', tiers: [{ length: null, ffe: 'balance' }], padOffset: 5, padDepth: 1 };
    };
    const buildingsBind = { get: () => get('buildings'), set: (v, live) => { if (Array.isArray(v) && v.length > CONFIG.limits.maxBuildings) { Toast.show(`Up to ${CONFIG.limits.maxBuildings} buildings.`, 'warn'); return; } Store.set('buildings', v, { live: !!live }); }, commit: () => Store.commit() };
    lists.building = mkList({
      bind: buildingsBind, addLabel: 'Add building', min: 1, reorder: true, openDefault: (i) => i === 0, empty: 'No buildings.',
      title: (i, b) => `${b.name || b.id} · ${(b.tiers || []).length} tier${(b.tiers || []).length === 1 ? '' : 's'}${b.source === 'typed' ? '' : ` · ${b.source}`}`,
      make: newBuilding,
      render: (i) => {
        const typed = () => bAt(i).source === 'typed';
        const tierList = mkList({
          bind: bs(bPath(i, 'tiers')), addLabel: 'Add tier', min: 1, reorder: false, openDefault: () => false, empty: '',
          title: (j, t) => `Tier ${j + 1} · FFE ${typeof t.ffe === 'number' ? E(t.ffe) : 'balanced'}${t.length ? ` · ${FT(t.length)}` : ''}`,
          make: (arr) => ({ length: null, ffe: 'balance' }),
          render: (j) => ({
            children: els([
              choiceB('Floor elevation', { get: () => (typeof tierBind(i, j, 'ffe').get() === 'number' ? 'typed' : 'balance'), set: (k) => { if (k === 'balance') Store.set(`${bPath(i, 'tiers')}.${j}.ffe`, 'balance', { live: false }); else { const row = D().metrics && D().metrics.tiers.find((r) => r.building === builtIdOf(bAt(i)) && r.tier === j + 1); Store.set(`${bPath(i, 'tiers')}.${j}.ffe`, row ? rnd(row.ffe, 100) : 1000, { live: false }); } } },
                [['balance', 'Balance'], ['typed', 'Typed']]),
              Controls.when(() => typeof tierBind(i, j, 'ffe').get() === 'number', [Controls.slider({ label: 'FFE (ft)', bind: tierBind(i, j, 'ffe'), min: 0, max: 1, step: 0.01, compact: true, hardMin: -1000, hardMax: 20000, format: E, inputMode: 'decimal' })]),
              choiceB('Length along the axis', { get: () => (typeof tierBind(i, j, 'length').get() === 'number' ? 'typed' : 'equal'), set: (k) => { if (k === 'equal') Store.set(`${bPath(i, 'tiers')}.${j}.length`, null, { live: false }); else { const bb = builtOf(i); const n = (bAt(i).tiers || []).length || 1; const L = bb ? Math.max(10, Math.round(polyLength(bb.outer.concat([bb.outer[0]])) / 2 / n)) : 100; Store.set(`${bPath(i, 'tiers')}.${j}.length`, L, { live: false }); } } },
                [['equal', 'Equal'], ['typed', 'Typed']]),
              Controls.when(() => typeof tierBind(i, j, 'length').get() === 'number', [Controls.slider({ label: 'Length', bind: tierBind(i, j, 'length'), min: 0, max: 1, step: 1, compact: true, hardMin: 1, hardMax: MAXD, format: FT, parse: Units.parseLength, inputMode: 'text' })]),
            ]),
          }),
        });
        return {
          children: els([
            textField('Name', bPath(i, 'name'), { maxlength: 40 }),
            choiceB('Footprint from', { get: () => bAt(i).source, set: (k) => setBuildingSource(i, k) },
              [['typed', 'Drawn'], ['massing', 'Project massing', 'Open a project that has a massing', () => !hasSec('massing')], ['parking', 'Parking deck', 'Open a project that has a parking deck', () => !hasSec('parking')]]),
            Controls.when(() => !typed(), [Controls.help('The footprint comes from the open project and is not edited here.')]),
            Controls.when(typed, [
              Controls.when(() => !!rectOf(i), [
                Controls.group(els([lenF('Width', 'x', { bind: rectBind(i, 'w'), hardMin: 5 }), lenF('Depth', 'x', { bind: rectBind(i, 'd'), hardMin: 5 })])),
                Controls.group(els([Controls.slider({ label: 'Center east', bind: rectBind(i, 'cx'), min: 0, max: 1, step: 1, compact: true, hardMin: -1e5, hardMax: 1e5, format: FT, parse: Units.parseLength, inputMode: 'text' }),
                  Controls.slider({ label: 'Center north', bind: rectBind(i, 'cy'), min: 0, max: 1, step: 1, compact: true, hardMin: -1e5, hardMax: 1e5, format: FT, parse: Units.parseLength, inputMode: 'text' })])),
              ]),
              h('div', { class: 'add-row' }, Controls.button('Draw footprint', () => { Select.startDraw('building', { target: i }); }, 'outline sm'), showBtn('building', () => builtIdOf(bAt(i)))),
            ]),
            Controls.label('Floor elevations'),
            tierList.el,
            h('p', { class: 'help', 'data-suggest': String(i) }),
            h('div', { class: 'add-row' }, h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'apply-steps', 'data-building': String(i), onclick: () => { const sg = applySteps(i); if (sg) Toast.show(`${sg.count} tier${sg.count === 1 ? '' : 's'}, each balanced on the existing ground.`); } }, 'Apply the suggestion')),
            caution(CONFIG.stepCaution),
          ]),
          more: els([
            Controls.group(els([lenF('Pad offset', bPath(i, 'padOffset'), { step: 1, hardMin: 0, hardMax: 200 }), lenF('Pad depth', bPath(i, 'padDepth'), { step: 0.25, hardMin: 0, hardMax: 20 })])),
            Controls.help('The pad offset grows the pad past the footprint. The pad top is the FFE minus the pad depth (the slab and the base under the floor).'),
            choiceB('Tier axis', { get: () => (typeof bAt(i).axis === 'number' ? 'typed' : 'auto'), set: (k) => Store.set(bPath(i, 'axis'), k === 'auto' ? 'auto' : 0, { live: false }) }, [['auto', 'Automatic'], ['typed', 'Typed']]),
            Controls.when(() => typeof bAt(i).axis === 'number', [degS('Axis angle', bPath(i, 'axis'), 0, 180, { hardMin: -360, hardMax: 360 })]),
          ]),
        };
      },
    });
    return { children: [lists.building.el] };
  }
  function buildBalance() {
    return {
      children: els([
        choice('Balance each pad on', 'balance', [['pad', 'The pad only'], ['site', 'The whole site']], { id: 'balanceChips' }),
        Controls.help('The pad balances cut and fill under the pad. The whole site includes the daylight slopes around it.'),
        lenS('Largest step between tiers', 'maxStep', 1, 12, { step: 0.5, hardMin: 0.5, hardMax: 40, format: Units.formatFt }),
        caution(CONFIG.stepCaution),
      ]),
    };
  }
  const tierTable = (id) => h('table', { class: 'tier-table', id },
    h('thead', null, h('tr', null, ['Tier', 'FFE', 'Pad top', 'Step', 'Above existing'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody'));
  function fillTierTable(table, rows) {
    if (!table) return;
    const body = table.querySelector('tbody');
    body.textContent = '';
    if (!rows.length) { body.append(h('tr', null, h('td', { colspan: '5', class: 'none' }, 'No tiers.'))); return; }
    for (const r of rows) {
      const above = r.cornerMin == null ? '-' : `${r.cornerMin.toFixed(2)} to ${r.cornerMax.toFixed(2)} ft`;
      body.append(h('tr', { 'data-tier': r.id }, h('th', { scope: 'row' }, r.id), h('td', null, E(r.ffe)), h('td', null, E(r.padTop)), h('td', null, r.step == null ? '-' : `${r.step.toFixed(2)} ft`), h('td', null, above)));
    }
  }
  function buildTierTable() {
    return { children: [tierTable('tierTable'), Controls.help('Above existing is the height of the FFE over the existing ground at the corners of the building. A negative value means the building sits below the existing ground.'), caution(CONFIG.stepCaution)] };
  }

  /* ==========================================================================
     Site work tab
     ========================================================================== */
  function buildProperty() {
    return {
      children: els([
        choiceB('Property line', { get: () => get('property.mode'), set: (k) => { if (k === 'site') Store.set('property', { mode: 'site', ring: [] }, { live: false }); else if ((get('property.ring') || []).length >= 3) Store.set('property.mode', 'drawn', { live: false }); else Select.startDraw('property'); } },
          [['site', 'Site edge'], ['drawn', 'Drawn']], { id: 'propertyChips' }),
        Controls.help('The site edge is the edge of the ground grid (or the project boundary). A drawn line is closed by tapping its first point. Daylight slopes stop, and automatic walls follow, this line.'),
        h('div', { class: 'add-row' }, Controls.button('Draw property line', () => Select.startDraw('property'), 'outline sm'), Controls.when(() => get('property.mode') === 'drawn', [showBtn('property', () => 'property')]).el),
      ]),
    };
  }
  const startLabel = (path) => ({ get: () => (typeof get(path) === 'number' ? 'typed' : 'existing'), set: (k) => { if (k === 'existing') Store.set(path, 'existing', { live: false }); else Store.set(path, 1000, { live: false }); } });
  const startElev = (path) => Controls.slider({ label: 'Start elevation (ft)', bind: bs(path), min: 0, max: 1, step: 0.01, compact: true, hardMin: -1000, hardMax: 20000, format: E, inputMode: 'decimal' });
  const idAt = (arr, i) => ((get(arr) || [])[i] || {}).id;
  function buildDrives() {
    lists.drive = mkList({
      bind: bs('drives'), addLabel: 'Draw a drive', onAdd: () => Select.startDraw('drive'), min: 0, reorder: false, openDefault: () => false, empty: 'No drives yet.',
      title: (i, d) => `${d.id} · ${FT(polyLength(d.line))} · ${round1(d.slope)}%`,
      make: () => ({}),
      render: (i) => ({
        children: els([
          lenS('Width', `drives.${i}.width`, 10, 60, { hardMin: 4, hardMax: 200 }),
          numS('Slope along the drive', `drives.${i}.slope`, -15, 15, 0.5, '%', { hardMin: -30, hardMax: 30 }),
          numS('Cross slope', `drives.${i}.cross`, 0, 6, 0.5, '%', { hardMin: 0, hardMax: 20 }),
          Controls.toggle({ label: 'Crowned', bind: bs(`drives.${i}.crown`) }),
          choiceB('Starts at', startLabel(`drives.${i}.start`), [['existing', 'Existing ground'], ['typed', 'Typed elevation']]),
          Controls.when(() => typeof get(`drives.${i}.start`) === 'number', [startElev(`drives.${i}.start`)]),
          h('div', { class: 'add-row' }, showBtn('drive', () => idAt('drives', i)), redrawBtn('drive', () => idAt('drives', i))),
          caution(CONFIG.gradeCaution),
        ]),
      }),
    });
    return { children: [lists.drive.el] };
  }
  function buildLots() {
    lists.lot = mkList({
      bind: bs('lots'), addLabel: 'Draw a lot', onAdd: () => Select.startDraw('lot'), min: 0, reorder: false, openDefault: () => false, empty: 'No lots yet.',
      title: (i, l) => `${l.id} · ${Units.formatArea(Math.abs(ringArea(l.ring)))} · ${round1(l.slope)}%`,
      make: () => ({}),
      render: (i) => ({
        children: els([
          numS('Slope uphill', `lots.${i}.slope`, 0, 8, 0.5, '%', { hardMin: -30, hardMax: 30 }),
          numS('Cross slope', `lots.${i}.cross`, -4, 4, 0.5, '%', { hardMin: -30, hardMax: 30 }),
          degS('Uphill direction', `lots.${i}.dir`, 0, 360, { hardMin: 0, hardMax: 360 }),
          choiceB('Starts at', startLabel(`lots.${i}.start`), [['existing', 'Existing ground'], ['typed', 'Typed elevation']]),
          Controls.when(() => typeof get(`lots.${i}.start`) === 'number', [startElev(`lots.${i}.start`)]),
          h('div', { class: 'add-row' }, showBtn('lot', () => idAt('lots', i)), redrawBtn('lot', () => idAt('lots', i))),
          caution(CONFIG.gradeCaution),
        ]),
      }),
    });
    return { children: [lists.lot.el] };
  }
  const wallRow = (id) => { const m = D().metrics; return m && m.walls && m.walls.list ? m.walls.list.find((w) => w.id === id) : null; };
  function buildWalls() {
    lists.wall = mkList({
      bind: bs('walls'), addLabel: 'Draw a wall', onAdd: () => Select.startDraw('wall'), min: 0, reorder: false, openDefault: () => false, empty: 'No drawn walls yet. Press W, then tap the points.',
      title: (i, w) => { const r = wallRow(w.id); return `${w.id} · ${FT(polyLength(w.line))}${r ? ` · up to ${wallFt(r.heightMax)}` : ''}`; },
      make: () => ({}),
      render: (i) => ({
        children: els([
          h('p', { class: 'help', 'data-wall-info': String(i) }),
          h('div', { class: 'add-row' }, showBtn('wall', () => idAt('walls', i)), redrawBtn('wall', () => idAt('walls', i))),
          caution(CONFIG.wallCaution),
        ]),
      }),
    });
    return {
      children: els([
        lists.wall.el,
        Controls.label('Automatic walls'),
        Controls.toggle({ label: 'Add walls where the daylight slope leaves the site', bind: bs('autoWalls.on') }),
        Controls.when(() => !!get('autoWalls.on'), [lenS('Offset inside the property line', 'autoWalls.offset', 0, 30, { hardMax: 100 })]),
        Controls.help('An automatic wall follows the property line where the daylight slope would pass it. It stays dashed until you accept it.'),
        h('div', { class: 'auto-walls', id: 'autoWalls' }),
        h('p', { class: 'help', id: 'padStepNote' }),
        caution(CONFIG.wallCaution),
      ]),
    };
  }
  function buildRoutes() {
    lists.route = mkList({
      bind: bs('routes'), addLabel: 'Draw a route', onAdd: () => Select.startDraw('route'), min: 0, reorder: false, openDefault: () => false, empty: 'No routes yet. Press R, then tap the points.',
      title: (i, r) => { const m = D().metrics && D().metrics.routes.find((x) => x.id === r.id); return `${r.name}${m ? ` · ${pct1(m.maxSlope)}` : ''}`; },
      make: () => ({}),
      render: (i) => ({
        children: els([
          textField('Name', `routes.${i}.name`, { maxlength: 40 }),
          h('p', { class: 'help', 'data-route-info': String(i) }),
          h('div', { class: 'add-row' }, showBtn('route', () => idAt('routes', i)), redrawBtn('route', () => idAt('routes', i))),
          caution(CONFIG.routeCaution),
        ]),
      }),
    });
    return { children: [lists.route.el] };
  }

  /* ==========================================================================
     Checks tab
     ========================================================================== */
  function buildChecksList() { return { children: [h('ul', { class: 'warns', id: 'checksWarnings' })] }; }
  function buildLimits() {
    const ratio = (label, path, min, max) => Controls.slider({ label, bind: bs(path), min, max, step: 0.5, hardMin: 0.5, hardMax: 12, format: (v) => `${round1(v)} : 1`, inputMode: 'decimal' });
    return {
      children: els([
        Controls.label('Daylight slopes'),
        Controls.toggle({ label: 'Daylight slopes on', bind: bs('daylight.on') }),
        Controls.when(() => !!get('daylight.on'), [ratio('Fill slope (run : rise)', 'daylight.fill', 1.5, 6), ratio('Cut slope (run : rise)', 'daylight.cut', 1, 4)]),
        caution(CONFIG.daylightCaution),
        Controls.label('Routes'),
        Controls.group(els([pctS('Walk running slope', 'limits.walk', 2, 8, 0.1, { compact: true }), pctS('Ramp running slope', 'limits.ramp', 5, 10, 0.1, { compact: true })])),
        Controls.group(els([pctS('Cross slope', 'limits.cross', 1, 4, 0.1, { compact: true }), lenF('Ramp rise per run', 'limits.rampRise', { step: 0.5, hardMin: 0.5, hardMax: 20, format: Units.formatFt })])),
        caution(CONFIG.routeCaution),
        Controls.label('Walls'),
        lenS('Flag a wall taller than', 'limits.wallFlag', 2, 8, { step: 0.5, hardMin: 0.5, hardMax: 100, format: Units.formatFt }),
        caution(CONFIG.wallCaution),
        Controls.label('Drives and lots'),
        Controls.group(els([pctS('Lot slope, least', 'limits.lotMin', 0.5, 3, 0.1, { compact: true }), pctS('Lot slope, most', 'limits.lotMax', 2, 8, 0.1, { compact: true })])),
        pctS('Drive slope, most', 'limits.driveMax', 4, 15, 0.5, { compact: true }),
        caution(CONFIG.gradeCaution),
        Controls.label('Earthwork'),
        intS('Sub-cells per grid cell (per side)', 'earthwork.subdivide', 1, 8, { hardMin: 1, hardMax: 8 }),
        Controls.slider({ label: 'Bulking factor', bind: bs('earthwork.bulking'), min: 0.8, max: 1.4, step: 0.01, hardMin: 0.5, hardMax: 2, format: (v) => v.toFixed(2), inputMode: 'decimal' }),
        caution(CONFIG.earthCaution),
      ]),
    };
  }
  function buildEarthTable() {
    return { children: [h('dl', { class: 'kv', id: 'earthTable' }), caution(CONFIG.earthCaution)] };
  }

  /* ==========================================================================
     View tab
     ========================================================================== */
  function buildDisplay() {
    const v = (k) => bs(`view.${k}`);
    const expo = Controls.mapBind(v('exaggeration'), (x) => x, (x) => Number(x));
    return {
      children: els([
        choice('Style', 'view.style', [['model', 'Model'], ['cutfill', 'Cut and fill']], { id: 'styleChips' }),
        Controls.toggle({ label: 'Contours', bind: v('contours.on') }),
        Controls.when(() => !!get('view.contours.on'), [
          choice('Interval', 'view.contours.interval', [[1, '1 ft'], [2, '2 ft']], { id: 'intervalChips' }),
          Controls.toggle({ label: 'Existing contours (dashed)', bind: v('contours.existing') }),
          Controls.toggle({ label: 'Proposed contours', bind: v('contours.proposed') }),
        ]),
        choice('Vertical exaggeration', 'view.exaggeration', CONFIG.exaggerations.map((x) => [x, `${x}x`]), { id: 'exagChips' }),
        h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Section'),
          h('div', { class: 'add-row' }, Controls.button('Draw section', () => Select.startDraw('section'), 'outline sm'), Controls.button('Clear section', () => Store.set('view.section', null, { live: false }), 'outline sm'))),
        Controls.toggle({ label: 'Site', bind: v('site') }),
        Controls.help('Site context from the Site Model: neighbor buildings, roads, walks, water, and trees. The ground stays the one you grade.'),
        Controls.toggle({ label: 'Shadows', bind: v('shadows') }),
        Controls.toggle({ label: 'Grid', bind: v('grid') }),
        Controls.toggle({ label: 'Scale figure', bind: v('figure') }),
        Controls.group(els([degS('Sun azimuth', 'view.sun.azimuth', 0, 360, { hardMin: 0, hardMax: 360 }), degS('Sun altitude', 'view.sun.altitude', 3, 90, { hardMin: 3, hardMax: 90 })])),
        Controls.help('Keys 1 to 6 jump to Axon, N, E, S, W and Plan. D switches Model and Cut and fill. W draws a wall and R draws a route. Escape clears the selection. Plan labels show in the Plan view and in Cut and fill.'),
      ]),
    };
  }

  const TABS = [
    { id: 'buildings', title: 'Buildings' },
    { id: 'site', title: 'Site work' },
    { id: 'checks', title: 'Checks' },
    { id: 'view', title: 'View' },
  ];
  const SECTIONS = [
    { id: 'source', tab: 'buildings', title: 'Source', open: true, build: buildSource },
    { id: 'ground', tab: 'buildings', title: 'Existing ground', open: true, build: buildGround },
    { id: 'buildings', tab: 'buildings', title: 'Buildings and floor elevations', open: true, build: buildBuildings },
    { id: 'balance', tab: 'buildings', title: 'Balance and steps', build: buildBalance },
    { id: 'tiertable', tab: 'buildings', title: 'Tier table', open: true, build: buildTierTable },
    { id: 'property', tab: 'site', title: 'Property line', build: buildProperty },
    { id: 'drives', tab: 'site', title: 'Drives', open: true, build: buildDrives },
    { id: 'lots', tab: 'site', title: 'Lots', build: buildLots },
    { id: 'walls', tab: 'site', title: 'Walls', open: true, build: buildWalls },
    { id: 'routes', tab: 'site', title: 'Routes', build: buildRoutes },
    { id: 'checkslist', tab: 'checks', title: 'Warnings', open: true, build: buildChecksList },
    { id: 'limits', tab: 'checks', title: 'Limits', open: true, build: buildLimits },
    { id: 'earthtable', tab: 'checks', title: 'Earthwork table', open: true, build: buildEarthTable },
    { id: 'display', tab: 'view', title: 'Display', open: true, build: buildDisplay },
  ];
  const sectionCtl = {};
  let activeTab = 'buildings';
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

  /* ---- the selection hooks ------------------------------------------------------- */
  const HOME = {
    drive: { tab: 'site', sec: 'drives', list: 'drive', arr: 'drives' },
    lot: { tab: 'site', sec: 'lots', list: 'lot', arr: 'lots' },
    wall: { tab: 'site', sec: 'walls', list: 'wall', arr: 'walls' },
    route: { tab: 'site', sec: 'routes', list: 'route', arr: 'routes' },
    building: { tab: 'buildings', sec: 'buildings', list: 'building', arr: 'buildings' },
    property: { tab: 'site', sec: 'property' },
    section: { tab: 'view', sec: 'display' },
  };
  /** Switches to the tab of an item, opens its section and its card, and scrolls it into view. item: { kind, id }. Returns true when something was opened. */
  function openItem(item) {
    const home = item && HOME[item.kind];
    if (!home) return false;
    setTab(home.tab);
    const sec = sectionCtl[home.sec];
    if (!sec) return false;
    if (!sec.isOpen()) { sec.setOpen(true); rememberSection(home.sec, true); }
    let target = sec.el;
    if (home.list) {
      let i = (get(home.arr) || []).findIndex((x) => (item.kind === 'building' ? (x.source === 'typed' ? x.id : x.source) : x.id) === item.id);
      if (i >= 0 && lists[home.list]) { const row = lists[home.list].openAt(i); if (row) target = row; }
      else if (item.kind === 'wall') target = $('autoWalls') || target;
    }
    raiseSheet();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { target.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); } catch (e) { target.scrollIntoView(); }
    target.classList.remove('is-focus'); void target.offsetWidth; target.classList.add('is-focus');
    setTimeout(() => target.classList.remove('is-focus'), 1600);
    return true;
  }
  /** Accepts (or un-accepts) an automatic wall by id. */
  function toggleAutoWall(id) {
    const cur = new Set(get('autoWalls.accepted') || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    Store.set('autoWalls.accepted', [...cur], { live: false });
    return cur.has(id);
  }

  /* ---- top bar -------------------------------------------------------------------- */
  /** The Export menu: pictures (Image, AI-ready image, AI Prompts, Image overlay) and the files. */
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
        item('miSketchup', 'SketchUp (.json)', 'Import with the CMRLM SketchUp extension', () => FileExports.sketchup()),
        item('miRevit', 'Revit points (.csv)', 'The proposed ground as x, y, z points', () => FileExports.revit()),
        item('miDxf', 'Contours (.dxf)', 'Contours, pads, walls, drives, lots and routes', () => FileExports.dxf()),
        item('miNotes', 'Notes (.md)', 'Numbers, settings and cautions in plain text', () => FileExports.notes()),
        item('miExportJson', 'Export JSON', 'Download all saved options', () => Options.exportJson()),
        item('miImportJson', 'Import JSON', 'Add the options from a file', () => $('importFile').click()));
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

    // Model / Cut and fill toggle
    const seg = $('styleToggle');
    const mk = (value, text) => h('button', { type: 'button', 'data-style': value, 'aria-pressed': 'false', onclick: () => Store.set('view.style', value, { live: false }) }, text);
    seg.append(mk('model', 'Model'), mk('cutfill', 'Cut and fill'));
    const syncStyle = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === Store.get('view.style') ? 'true' : 'false'));
    Store.subscribe(syncStyle); syncStyle();

    const proj = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnProject', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Project: new, open, import, export', 'aria-label': 'Project menu', onclick: () => ProjectUI.openMenu(proj) },
      h('span', { html: ICONS.folder, style: 'display:contents' }), h('span', { class: 'btn-text', id: 'projLabel' }, 'Project'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbProject').append(proj);

    const exp = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnExport', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Export: image, AI prompts, SketchUp, Revit points, DXF, notes, JSON', 'aria-label': 'Export menu', onclick: () => openExportMenu(exp) },
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
    const open = !!prefs.hudOpen;
    hud.dataset.collapsed = open ? 'false' : 'true';
    hud.innerHTML = `
      <button class="hud-toggle" id="hudToggle" type="button" aria-expanded="${open}" aria-controls="hudBody" title="Show or hide all numbers">
        <span class="hud-top">
          <span class="label">Grading</span>
          <span class="hud-badge" id="hudBadge" data-n="0" title="Warnings">0 warnings</span>
          ${CARET_SVG}
        </span>
        <span class="hud-core">
          <span class="m"><span class="k">Cut</span><span class="v" id="mCut">-</span></span>
          <span class="m"><span class="k">Fill</span><span class="v" id="mFill">-</span></span>
          <span class="m"><span class="k">Net</span><span class="v" id="mNet">-</span></span>
          <span class="m"><span class="k">Tallest wall</span><span class="v" id="mWallMax">-</span></span>
        </span>
      </button>
      <div class="hud-body" id="hudBody">
        <dl class="metrics compact">
          <div class="m"><dt>Balance</dt><dd id="mBalance">-</dd></div>
          <div class="m"><dt>Net with bulking</dt><dd id="mBulked">-</dd></div>
          <div class="m"><dt>Pad area</dt><dd id="mPad">-</dd></div>
          <div class="m"><dt>Disturbed area</dt><dd id="mDist">-</dd></div>
          <div class="m"><dt>Wall length</dt><dd id="mWallLen">-</dd></div>
          <div class="m"><dt>Steepest route</dt><dd id="mRoute">-</dd></div>
        </dl>
        <div class="sec" id="hudTiers"><div class="label">Tiers</div></div>
        <div class="sec" id="hudRoutes"><div class="label">Routes</div><dl class="kv" id="hudRouteList"></dl></div>
        <p class="help caution" id="hudCaution">${CONFIG.sketchCaution}</p>
        <div class="warn-block" id="warnBlock" data-n="0">
          <div class="label">Warnings <span class="count" id="warnCount">0</span></div>
          <ul class="warns" id="warnList"></ul>
        </div>
      </div>`;
    $('hudTiers').append(tierTable('hudTierTable'));
    $('hudToggle').addEventListener('click', () => setHudOpen(hud.dataset.collapsed === 'true'));
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
  function setText(id, text) { const el = $(id); if (el && el.textContent !== text) el.textContent = text; }
  function kvRows(list, rows) {
    if (!list) return;
    list.textContent = '';
    for (const [k, v, cls] of rows) list.append(h('dt', null, k), h('dd', cls ? { class: cls } : null, v));
  }
  const warnItem = (w) => h('li', { class: `warn-${w.level}`, 'data-warn': w.id || '' }, w.text);
  const classWord = (k) => (k === 'walk' ? 'Walk' : k === 'ramp' ? 'Ramp' : 'Over the ramp limit');

  function updateHud(d) {
    const m = d.hud;
    setText('mCut', Units.formatCy10(m.cutCy));
    setText('mFill', Units.formatCy10(m.fillCy));
    setText('mNet', signedCy(round10(m.netCy)));
    setText('mWallMax', wallFt(m.wallMax));
    $('mWallMax').classList.toggle('bad', m.wallMax > num(Store.get('limits.wallFlag'), 4) + 1e-9);
    setText('mBalance', `${(m.balance * 100).toFixed(0)}%`);
    setText('mBulked', signedCy(round10(m.bulkedNetCy)));
    setText('mPad', Units.formatArea(m.padArea));
    setText('mDist', Units.formatArea(m.disturbed));
    setText('mWallLen', FT(m.wallLength));
    setText('mRoute', m.routes.length ? pct1(m.steepestRoute) : 'no routes');
    fillTierTable($('hudTierTable'), m.tiers);
    const rl = $('hudRouteList');
    $('hudRoutes').hidden = !m.routes.length;
    kvRows(rl, m.routes.map((r) => [r.name || r.id, `${pct1(r.maxSlope)} · cross ${pct1(r.maxCross)} · ${classWord(r.kind)}`, r.kind === 'fail' ? 'tgt-neg' : '']));

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
  function round10(v) { const r = Math.round(v / 10) * 10; return r === 0 ? 0 : r; }

  /** The small readouts inside the panel sections. */
  function updateNotes(d) {
    const st = Store.raw(), m = d.hud;
    const sn = $('sourceNote');
    if (sn) {
      const tw = d.warnings.find((w) => w.id === 'tower-no-levels');
      const notes = (d.notes || []).filter((t) => !tw || t !== tw.text);
      sn.textContent = tw ? tw.text : (notes.length ? notes.join(' ') : '');
      sn.hidden = !sn.textContent;
      sn.classList.toggle('caution', !!tw);
    }
    const gn = $('groundNote');
    if (gn) gn.textContent = `Falls toward ${compassOf(st.ground.plane.downhill)} at ${round1(st.ground.plane.slope)} percent.`;
    fillTierTable($('tierTable'), m.tiers);
    // stepping suggestions
    document.querySelectorAll('[data-suggest]').forEach((el) => {
      const i = Number(el.dataset.suggest), bb = builtOf(i);
      if (!bb) { el.textContent = ''; return; }
      let sg = null;
      try { sg = FeaturesMod.suggestTiers(bb, d.built.existingAt, st.maxStep); } catch (e) { sg = null; }
      if (!sg) { el.textContent = ''; return; }
      const cur = (bAt(i).tiers || []).length;
      el.textContent = sg.count > 1
        ? `The existing ground changes ${sg.rise.toFixed(2)} ft along this building. A step of ${st.maxStep} ft or less needs ${sg.count} tiers of ${FT(sg.lengths[0])}. It has ${cur}.`
        : `The existing ground changes ${sg.rise.toFixed(2)} ft along this building, within the ${st.maxStep} ft largest step. One tier is enough.`;
      const btn = document.querySelector(`[data-action="apply-steps"][data-building="${i}"]`);
      if (btn) btn.hidden = sg.count === 1 && cur === 1;
      el.dataset.count = String(sg.count);
    });
    // walls
    document.querySelectorAll('[data-wall-info]').forEach((el) => {
      const w = st.walls[Number(el.dataset.wallInfo)];
      const r = w && wallRow(w.id);
      el.textContent = r ? `Up to ${wallFt(r.heightMax)} tall, ${wallFt(r.heightAvg)} on average, ${FT(r.length)} long.${r.flagged ? ` Over the ${st.limits.wallFlag} ft flag.` : ''}` : '';
    });
    const aw = $('autoWalls');
    if (aw) {
      const autos = (d.metrics && d.metrics.walls ? d.metrics.walls.list : []).filter((w) => w.kind === 'auto');
      const key = JSON.stringify(autos.map((w) => [w.id, w.heightMax, w.length, w.accepted]));
      if (aw.dataset.key !== key) {
        aw.dataset.key = key;
        aw.textContent = '';
        for (const w of autos) {
          aw.append(h('div', { class: 'auto-wall', 'data-wall': w.id },
            h('span', { class: 'grow' }, `${w.id} · ${FT(w.length)} · up to ${wallFt(w.heightMax)}`),
            h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'accept-wall', 'aria-pressed': String(w.accepted), onclick: () => toggleAutoWall(w.id) }, w.accepted ? 'Accepted' : 'Accept'),
            h('button', { class: 'btn outline sm', type: 'button', onclick: () => { if (Render.ready() && Render.info().preset !== 'plan') Render.setView('plan', true); Select.select([{ kind: 'wall', id: w.id }]); } }, 'Show')));
        }
        if (!autos.length) aw.append(h('p', { class: 'help' }, st.autoWalls.on ? 'No automatic walls. The daylight slopes stay inside the property line.' : 'Automatic walls are off.'));
      }
    }
    const ps = $('padStepNote');
    if (ps) { const n = (d.metrics && d.metrics.walls ? d.metrics.walls.list : []).filter((w) => w.kind === 'pad-step').length; ps.textContent = n ? `${n} pad-step wall${n === 1 ? '' : 's'} between tiers. They follow the tiers.` : ''; }
    document.querySelectorAll('[data-route-info]').forEach((el) => {
      const r = st.routes[Number(el.dataset.routeInfo)];
      const rm = r && d.metrics && d.metrics.routes.find((x) => x.id === r.id);
      el.textContent = rm ? `Steepest running slope ${pct1(rm.maxSlope)}, steepest cross slope ${pct1(rm.maxCross)}. ${classWord(rm.kind)}.` : '';
    });
    const cw = $('checksWarnings');
    if (cw) { cw.textContent = ''; if (!d.warnings.length) cw.append(h('li', { class: 'none' }, 'No warnings')); for (const w of d.warnings) cw.append(warnItem(w)); }
    kvRows($('earthTable'), [
      ['Cut', Units.formatCy(m.cutCy)], ['Fill', Units.formatCy(m.fillCy)], ['Net (fill minus cut)', Units.formatSigned(m.netCy, (x) => Units.formatCy(x))],
      ['Net with bulking', Units.formatSigned(m.bulkedNetCy, (x) => Units.formatCy(x))], ['Balance', `${(m.balance * 100).toFixed(1)}%`],
      ['Pad area', Units.formatArea(m.padArea)], ['Disturbed area', Units.formatArea(m.disturbed)], ['Wall length', FT(m.wallLength)],
      ['Tallest wall', wallFt(m.wallMax)], ['Average wall', wallFt(m.wallAvg)], ['Steepest route', m.routes.length ? pct1(m.steepestRoute) : 'no routes'],
      ['Sub-cells per cell', `${m.subdivide} by ${m.subdivide}`], ['Grid cells sampled', Units.formatInt(m.cellsSampled)],
    ]);
  }

  /* ---- legend ------------------------------------------------------------------------------ */
  function updateLegend(d) {
    const box = $('legend');
    const v = Store.raw().view;
    if (Render.comparing()) { box.hidden = true; return; }
    const rows = [];
    const e = CONFIG.diffEdges;
    const labels = [`Under ${e[0]} ft`, `${e[0]} to ${e[1]} ft`, `${e[1]} to ${e[2]} ft`, `${e[2]} to ${e[3]} ft`, `Over ${e[3]} ft`];
    if (v.style === 'cutfill') {
      rows.push(['h', 'Fill (new ground above existing)']);
      CONFIG.fillColors.forEach((c, i) => rows.push([c, labels[i], `fill-${i}`]));
      rows.push(['h', 'Cut (new ground below existing)']);
      CONFIG.cutColors.forEach((c, i) => rows.push([c, labels[i], `cut-${i}`]));
      rows.push([CONFIG.noChangeColor, 'Unchanged', 'none']);
    }
    if (d && d.hud.routes.length) {
      rows.push(['h', 'Routes']);
      for (const k of ['walk', 'ramp', 'fail']) rows.push([CONFIG.classColors[k], CONFIG.classLabels[k], `route-${k}`]);
    }
    const key = JSON.stringify([rows, v.style]);
    box.hidden = !rows.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const r of rows) {
      if (r[0] === 'h') box.append(h('div', { class: 'label' }, r[1]));
      else box.append(h('div', { class: 'lg-row', 'data-key': r[2] }, h('span', { class: 'sw', style: `background:${r[0]}` }), h('span', null, r[1])));
    }
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
    setTab(TABS.some((t) => t.id === prefs.tab) ? prefs.tab : 'buildings', { remember: false });
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
    openItem, toggleAutoWall, applySteps, setTab, activeTab: () => activeTab, tabs: () => TABS.map((t) => t.id),
    setHudOpen, hudOpen: () => $('hud').dataset.collapsed === 'false', sections: () => SECTIONS.map((s) => ({ id: s.id, tab: s.tab })),
    openSection: (id) => { const s = sectionCtl[id]; if (s && !s.isOpen()) s.setOpen(true); return !!s; },
  };
})();

/* SLOT: ai-prompts */
/* Filled: the entry is the AI Prompts item (#miAiPrompts) in the Export menu (UI.openExportMenu above); the panel and its logic are in 08b_prompts.js. */
