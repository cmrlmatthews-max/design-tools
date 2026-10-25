/* ==========================================================================
   UI
   Plate Planner panels (Plate, Units, Checks, View), top bar, HUD (units or keys, NRSF, efficiency), preset view buttons, sheet.
   ========================================================================== */
const ICONS = {
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
  compare: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  option: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  export: '<svg viewBox="0 0 24 24"><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M3 5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.8"/><path d="M12 17h.01"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
};
const UI_STORAGE_KEY = 'plate.ui.v1';

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
  const FT = (v) => Units.formatFeetInches(v);
  const SF = (v) => Units.formatArea(v);
  const get = (path) => Store.get(path);
  const D = () => Derived.get();
  const els = (list) => list.filter((c) => c != null && c !== false).map((c) => c.el || c);
  const mkList = (o) => Controls.list({ ...o, render: (i) => { const p = o.render(i); return { children: els(p.children || []), more: els(p.more || []) }; } });
  const caution = (text) => h('p', { class: 'help caution' }, text);
  const isHotel = () => get('mode') === 'hotel';
  const unitWord = () => (isHotel() ? 'keys' : 'units');

  /* ---- control shortcuts ------------------------------------------------------- */
  const lenS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 0, hardMax: MAXD,
    format: FT, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  const lenF = (label, path, extra = {}) => lenS(label, path, 0, 1, { compact: true, ...extra });
  const intS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 0, hardMax: 999, integer: true,
    format: Units.formatInt, inputMode: 'numeric', ...extra,
  });
  const numF = (label, path, step, suffix, extra = {}) => Controls.slider({
    label, bind: bs(path), min: 0, max: 1, step, compact: true, hardMin: 0, hardMax: 1e5,
    format: (v) => `${round1(v)}${suffix}`, inputMode: 'decimal', ...extra,
  });
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
  /** A drop-down whose options follow the state (the type names change as the mix is edited). */
  function dynSelect(label, optionsFn, path, id) {
    const selEl = h('select', { id: id || null, 'aria-label': label });
    selEl.addEventListener('change', () => Store.set(path, selEl.value, { live: false }));
    let key = '';
    const refresh = () => {
      const o = optionsFn();
      const k = JSON.stringify(o);
      if (k !== key) { key = k; selEl.textContent = ''; for (const x of o) selEl.append(h('option', { value: x.value }, x.label)); }
      const v = get(path);
      if (v != null) selEl.value = v;
    };
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl select-row' }, h('label', null, label), selEl)]);
  }
  /** A number that may be "automatic" (null in the state): a toggle plus a slider. */
  function autoNumber(label, path, def, min, max, step, fmt, extra = {}) {
    const isAuto = () => get(path) === null || get(path) === undefined;
    return [
      choiceB(label, { get: () => (isAuto() ? 'auto' : 'typed'), set: (k) => Store.set(path, k === 'auto' ? null : def(), { live: false }) }, [['auto', 'Automatic'], ['typed', 'Typed']], { id: extra.id }),
      Controls.when(() => !isAuto(), [Controls.slider({ label: `${label} (typed)`, bind: bs(path), min, max, step, compact: true, hardMin: 0, hardMax: extra.hardMax || 1e4, format: fmt, parse: extra.parse, inputMode: 'decimal', integer: !!extra.integer })]),
    ];
  }
  const defaultCorridorWidth = () => (isHotel() ? 6 : 5.67);
  /** A whole-number field that is blank for automatic: the placeholder shows the automatic value (rework plan 7.2). */
  function blankAutoField({ label, path, id, max, autoText }) {
    const input = h('input', { class: 'numfield', type: 'text', id, inputmode: 'numeric', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label });
    const hint = h('p', { class: 'help', id: `${id}Hint` });
    const apply = () => {
      input.dataset.dirty = '';
      const t = input.value.trim();
      if (t === '') Store.set(path, null, { live: false });
      else { const n = Math.round(Number(t)); if (isFinite(n)) Store.set(path, clamp(n, 0, max), { live: false }); }
      refresh();
    };
    function refresh() {
      const v = get(path);
      const auto = autoText();
      input.placeholder = auto;
      if (!(document.activeElement === input && input.dataset.dirty === '1')) input.value = v === null || v === undefined ? '' : String(v);
      hint.textContent = v === null || v === undefined ? `Blank means automatic. ${auto}.` : `Typed value. Clear the field for automatic. ${auto}.`;
    }
    input.addEventListener('input', () => { input.dataset.dirty = '1'; });
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl compact' }, h('label', { class: 'ctl-label', for: id }, label), input), hint]);
  }
  /** The passenger elevator count: blank = automatic, and the automatic value comes from the core program of the fill. */
  const elevatorCountField = () => blankAutoField({
    label: 'Passenger elevators', path: 'elevators.count', id: 'elevCountField', max: 20,
    autoText: () => { const c = D().hud.core; return c && c.autoCabs !== null && c.autoCabs !== undefined ? `Auto: ${c.autoCabs}` : 'Auto: 2'; },
  });

  /* ==========================================================================
     Plate tab
     ========================================================================== */
  function buildSource() {
    return {
      children: els([
        choiceB('Program', { get: () => get('mode'), set: (k) => Store.set('mode', k, { live: false }) }, MODES.map((m) => [m, MODE_LABELS[m]]), { id: 'modeChips' }),
        choiceB('Plate from', { get: () => get('source'), set: (k) => { if (k === 'drawn') ProjectUI.useDrawn(); else if (!ProjectUI.has()) Toast.show('Open a project first (Project menu). The massing comes from the Mid-Rise Generator.', 'warn', 6000); else ProjectUI.useProject(); } },
          [['drawn', SOURCE_LABELS.drawn], ['project', SOURCE_LABELS.project, 'Open a project that has a massing first', () => !ProjectUI.has() || !ProjectUI.hasMassing()]], { id: 'sourceChips' }),
        Controls.help('A drawn or typed plate is one level. An open project gives the plates of its massing: levels with the same plate share one fill.'),
        h('p', { class: 'help', id: 'sourceNote' }),
        h('div', { class: 'proj-line', id: 'projLine' }),
        Controls.when(() => ProjectUI.has(), [ProjectUI.nameControl().el]).el,
      ]),
    };
  }

  function buildShape() {
    const shape = () => get('plate.shape');
    return {
      children: els([
        sel('Shape', 'plate.shape', SHAPES.map((k) => ({ value: k, label: SHAPE_LABELS[k] }))),
        Controls.when(() => shape() !== 'polygon', [
          Controls.group(els([lenF('Width (east)', 'plate.w', { hardMin: 10 }), Controls.when(() => shape() !== 'circle', [lenF('Depth (north)', 'plate.d', { hardMin: 10 })])])),
          Controls.when(() => shape() === 'circle', [Controls.help('A circle takes its diameter from the width.')]),
        ]),
        Controls.when(() => shape() === 'L' || shape() === 'U', [lenS('Arm width', 'plate.arm', 30, 100, { hardMin: 10 })]),
        Controls.when(() => shape() === 'O', [Controls.group(els([lenF('Court width', 'plate.courtW', { hardMin: 10 }), lenF('Court depth', 'plate.courtD', { hardMin: 10 })]))]),
        Controls.when(() => shape() === 'circle', [Controls.slider({ label: 'Segments', bind: bs('plate.segments'), min: 12, max: 180, step: 4, hardMin: 12, hardMax: 180, integer: true, format: Units.formatInt, inputMode: 'numeric' })]),
        Controls.when(() => shape() === 'polygon', [h('p', { class: 'help', id: 'polyNote' })]),
        h('div', { class: 'add-row' }, Controls.button('Draw outline', () => { if (Render.ready()) Select.startDraw('polygon'); }, 'outline sm')),
        Controls.help('East is +x and north is +y. The polygon is drawn counter-clockwise. Hold Option to skip snapping.'),
      ]),
    };
  }

  /* ---- the level groups (project source) ---- */
  function buildLevels() {
    return {
      children: els([
        h('p', { class: 'help', id: 'levelsNote' }),
        h('div', { class: 'group-list', id: 'groupList', role: 'listbox', 'aria-label': 'Level groups' }),
        Controls.toggle({ label: 'Show podium levels', bind: bs('levels.showPodium') }),
        Controls.help('Every level of a group shares its fill. Tap a group to edit it. Locks and block edits apply to every floor of the group.'),
      ]),
    };
  }
  function updateGroups(d) {
    const box = $('groupList');
    if (!box) return;
    const st = Store.raw();
    const note = $('levelsNote');
    const project = st.source === 'project';
    if (note) note.textContent = project ? (d.groups.length ? `${d.groups.length} group${d.groups.length === 1 ? '' : 's'} in the massing.` : 'The massing has no levels to fill.') : 'Open a project to fill the levels of its massing.';
    const shown = project ? d.groups : [];
    const key = JSON.stringify([shown.map((g) => [g.id, g.label, g.row.units]), d.group && d.group.id]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const g of shown) {
      const on = d.group && d.group.id === g.id;
      box.append(h('button', { class: 'group-row', type: 'button', role: 'option', 'aria-selected': String(on), 'data-group': g.id, onclick: () => { Store.set('levels.selected', g.id, { live: false }); } },
        h('span', { class: 'grow' }, g.label), h('span', { class: 'sub' }, `${g.row.units} ${unitWord()}`)));
    }
  }

  function buildCorridor() {
    const kind = () => get('corridor.kind');
    return {
      children: els([
        choice('Kind', 'corridor.kind', CORRIDOR_KINDS.map((k) => [k, CORRIDOR_LABELS[k]]), { id: 'corridorKind' }),
        ...autoNumber('Clear width', 'corridor.width', defaultCorridorWidth, 3, 12, 0.25, (v) => FT(v), { id: 'corridorWidthMode' }),
        Controls.help('Automatic is 5 ft 8 in for multifamily and 6 ft for a hotel.'),
        lenS('Corridor wall thickness', 'corridor.wall', 0, 2, { step: 0.05, hardMax: 3, format: (v) => `${(Math.round(v * 100) / 100)} ft`, parse: Units.parseNumber }),
        Controls.when(() => kind() === 'single', [choice('Units on the', 'corridor.side', SIDES.map((k) => [k, k.charAt(0).toUpperCase() + k.slice(1)]))]),
        lenS('Exterior wall thickness', 'extWall', 0, 2, { step: 0.05, hardMax: 6, format: (v) => `${(Math.round(v * 100) / 100)} ft`, parse: Units.parseNumber }),
        ...depthCapControls(),
        caution(CONFIG.widthCaution),
      ]),
    };
  }

  /* ---- unit depth cap (rework plan 5 and 7.2): the selected group for a project, the whole plate for a drawn plate ---- */
  const CAP_MIN = 24, CAP_MAX = 40, CAP_DEFAULT = 30;
  const capGroupId = () => { const d = D(); return get('source') === 'project' && d.group ? d.group.id : null; };
  const capPath = () => (capGroupId() ? `levels.groups.${capGroupId()}.maxDepth` : 'fill.maxDepth');
  function capNow() {
    const v = get(capPath());
    if (typeof v === 'number' && v > 0) return v;
    const gid = capGroupId();
    if (gid) { const f = get('fill.maxDepth'); return typeof f === 'number' && f > 0 ? f : null; }       // a group with no cap of its own follows the global one
    return null;
  }
  /** Writes the cap (null = off). A project group that has no entry yet gets a whole entry, so the fill still sees its locks and its filled flag. */
  function capSet(v, live = false) {
    const gid = capGroupId();
    if (gid) {
      const g = get(`levels.groups.${gid}`);
      if (!g) { Store.set(`levels.groups.${gid}`, { filled: true, locks: [], maxDepth: v }, { live }); return; }
    }
    Store.set(capPath(), v, { live });
  }
  function depthCapControls() {
    const on = () => capNow() !== null;
    return [
      Controls.label('Unit depth cap'),
      choiceB('Unit depth cap', { get: () => (on() ? 'on' : 'off'), set: (k) => capSet(k === 'off' ? null : CAP_DEFAULT) }, [['off', 'Off'], ['on', 'On']], { id: 'depthCapMode' }),
      Controls.when(on, [Controls.slider({
        label: 'Cap depth', bind: { get: () => capNow() || CAP_DEFAULT, set: (v, live) => capSet(clamp(Math.round(v), CAP_MIN, CAP_MAX), live), commit: () => Store.commit() },
        min: CAP_MIN, max: CAP_MAX, step: 1, hardMin: CAP_MIN, hardMax: CAP_MAX, format: FT, parse: Units.parseLength, inputMode: 'text',
      })]),
      h('p', { class: 'help', id: 'depthCapNote' }),
    ];
  }

  function buildBlocks() {
    const coreOn = () => !!get('core.rect');
    const coreBind = (i) => ({ get: () => (get('core.rect') || [0, 0, 0, 0])[i], set: (v, live) => { const r = (get('core.rect') || [0, 0, 0, 0]).slice(); r[i] = v; Store.set('core.rect', r, { live: !!live }); }, commit: () => Store.commit() });
    const coreField = (label, i) => Controls.slider({ label, bind: coreBind(i), min: 0, max: 1, step: 0.5, compact: true, hardMin: -1e5, hardMax: 1e5, format: FT, parse: Units.parseLength, inputMode: 'text' });
    const stairItems = () => get('stairs.items') || [];
    const supportList = mkList({
      bind: { get: () => get('support'), set: (v, live) => Store.set('support', v, { live: !!live }), commit: () => Store.commit() },
      addLabel: 'Add support block', min: 0, reorder: false, openDefault: () => false, empty: 'No support blocks.',
      title: (i, b) => `${(b.kind || 'storage').charAt(0).toUpperCase()}${(b.kind || 'storage').slice(1)} ${b.id}`,
      make: (arr) => {
        let n = arr.length + 1; while (arr.some((b) => b.id === `B${n}`)) n++;
        const c = D().editing ? ringCentroidXY(D().editing.plate[0].outer) : [0, 0];
        return { id: `B${n}`, kind: 'storage', rect: [Math.round(c[0]) - 5, Math.round(c[1]) - 5, Math.round(c[0]) + 5, Math.round(c[1]) + 5] };
      },
      render: (i) => ({
        children: els([
          sel('Kind', `support.${i}.kind`, SUPPORT_KINDS.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))),
          Controls.group(els([0, 1].map((k) => Controls.slider({ label: ['West', 'South'][k], bind: rectBindPath(`support.${i}.rect`, k), min: 0, max: 1, step: 0.5, compact: true, hardMin: -1e5, hardMax: 1e5, format: FT, parse: Units.parseLength, inputMode: 'text' })))),
          Controls.group(els([2, 3].map((k) => Controls.slider({ label: ['East', 'North'][k - 2], bind: rectBindPath(`support.${i}.rect`, k), min: 0, max: 1, step: 0.5, compact: true, hardMin: -1e5, hardMax: 1e5, format: FT, parse: Units.parseLength, inputMode: 'text' })))),
          Controls.button('Show on plan', () => { if (Render.ready()) { if (Render.info().preset !== 'plan') Render.setView('plan', true); Select.select({ kind: 'support', id: (get('support') || [])[i].id }); } }, 'outline sm'),
        ]),
      }),
    });
    function rectBindPath(path, k) {
      return { get: () => (get(path) || [0, 0, 0, 0])[k], set: (v, live) => { const r = (get(path) || [0, 0, 0, 0]).slice(); r[k] = v; Store.set(path, r, { live: !!live }); }, commit: () => Store.commit() };
    }
    return {
      children: els([
        Controls.label('Core'),
        choiceB('Core', { get: () => get('core.mode'), set: (k) => Select.setCoreMode(k) }, CORE_MODES.map((m) => [m, CORE_MODE_LABELS[m]]), { id: 'coreModeChips' }),
        h('p', { class: 'help', id: 'coreNote' }),
        Controls.when(() => get('core.mode') === 'manual', [
          Controls.group(els([coreField('West', 0), coreField('South', 1)])),
          Controls.group(els([coreField('East', 2), coreField('North', 3)])),
        ]),
        Controls.when(() => get('core.mode') !== 'auto' || !!get('core.rect'), [h('div', { class: 'add-row' }, Controls.button('Reset core to auto', () => Select.resetCore(), 'outline sm'))]),
        Controls.help('Auto makes the core for a point plate: stairs at the ends, elevators and service rooms in between. Drag the core in the plan to set it by hand.'),
        Controls.label('Stairs'),
        choice('Stairs', 'stairs.mode', STAIR_MODES.map((k) => [k, { auto: 'Automatic', seeds: 'From the massing', manual: 'Manual' }[k]]), { id: 'stairMode' }),
        Controls.group(els([lenF('Stair width', 'stairs.size.0', { hardMin: 4, hardMax: 60 }), lenF('Stair length', 'stairs.size.1', { hardMin: 4, hardMax: 80 })])),
        Controls.when(() => get('stairs.mode') === 'manual', [
          h('p', { class: 'help' }, 'Manual stairs are rectangles. Select a stair in the plan to move or delete it.'),
          h('div', { class: 'add-row' }, Controls.button('Add stair', () => { if (Render.ready()) Select.startDraw('rect', { target: { type: 'stair' }, label: 'a stair' }); }, 'outline sm')),
        ]),
        Controls.label('Elevators'),
        elevatorCountField(),
        ...autoNumber('Service elevators', 'elevators.service', () => 1, 0, 4, 1, (v) => String(Math.round(v)), { id: 'elevServiceMode', integer: true, hardMax: 4 }),
        Controls.group(els([lenF('Cab width', 'elevators.size.0', { hardMin: 3, hardMax: 30 }), lenF('Cab depth', 'elevators.size.1', { hardMin: 3, hardMax: 30 })])),
        Controls.label('Support blocks'),
        supportList.el,
        h('div', { class: 'add-row' }, SUPPORT_KINDS.map((k) => Controls.button(`Draw ${k}`, () => { if (Render.ready()) Select.startDraw('rect', { target: { type: 'support', kind: k }, label: `a ${k} block` }); }, 'outline sm')).map((c) => c.el || c)),
        Controls.when(isHotel, [Controls.toggle({ label: 'Hotel back-of-house in the core', bind: bs('hotelBoh.on') }), Controls.help('The linen closet, ice and service space that the hotel needs sit beside the service elevator.')]),
      ]),
    };
  }

  /* ==========================================================================
     Units tab
     ========================================================================== */
  const lists = {};
  function mixList(mode) {
    const base = `mix.${mode}`;
    const mf = mode === 'multifamily';
    const bindArr = { get: () => get(base), set: (v, live) => { if (Array.isArray(v) && v.length > 12) { Toast.show('Up to 12 types.', 'warn'); return; } Store.set(base, v, { live: !!live }); }, commit: () => Store.commit() };
    return mkList({
      bind: bindArr, addLabel: 'Add type', min: 1, reorder: true, swatch: (i, t) => t.color, openDefault: () => false, empty: '',
      title: (i, t) => `${t.name || t.id} · ${Math.round((t.share || 0) * 100)}%`,
      make: (arr) => {
        let n = arr.length + 1; while (arr.some((t) => t.id === `t${n}`)) n++;
        return mf ? { id: `t${n}`, name: `Type ${n}`, widthMin: 24, widthMax: 30, targetArea: 800, areaMin: 700, areaMax: 900, share: 0, color: '#8a8f98' }
          : { id: `t${n}`, name: `Type ${n}`, widthMin: 14, widthMax: 15, target: 14.5, bays: 1, share: 0, color: '#8a8f98' };
      },
      render: (i) => ({
        children: els([
          textField('Name', `${base}.${i}.name`, { maxlength: 24 }),
          pctS('Share of the mix', `${base}.${i}.share`, 0, 100, 1),
          Controls.group(els([lenF('Width, least', `${base}.${i}.widthMin`, { step: 0.5, hardMin: 5, hardMax: 120 }), lenF('Width, most', `${base}.${i}.widthMax`, { step: 0.5, hardMin: 5, hardMax: 120 })])),
          mf ? Controls.group(els([numF('Area, least (sf)', `${base}.${i}.areaMin`, 10, ' sf', { hardMin: 50, hardMax: 8000 }), numF('Area, target (sf)', `${base}.${i}.targetArea`, 10, ' sf', { hardMin: 100, hardMax: 6000 }), numF('Area, most (sf)', `${base}.${i}.areaMax`, 10, ' sf', { hardMin: 100, hardMax: 8000 })]))
            : Controls.group(els([lenF('Target width', `${base}.${i}.target`, { step: 0.25, hardMin: 5, hardMax: 120 }), intS('Bays', `${base}.${i}.bays`, 1, 4, { compact: true, hardMin: 1, hardMax: 4 })])),
          Controls.color({ label: 'Color', bind: bs(`${base}.${i}.color`) }),
        ]),
      }),
    });
  }
  function buildMix() {
    lists.mf = mixList('multifamily');
    lists.hotel = mixList('hotel');
    return {
      children: els([
        Controls.when(() => !isHotel(), [
          lists.mf.el,
          dynSelect('Corner units are', () => (get('mix.multifamily') || []).map((t) => ({ value: t.id, label: t.name })), 'mix.cornerType', 'cornerType'),
          Controls.help('A wrap corner is one unit of this type. The width range and the area range set the widths each type can take at the depth of a run.'),
        ]),
        Controls.when(isHotel, [
          lists.hotel.el,
          Controls.group(els([lenF('Accessible key, least', 'mix.accessibleWidth.0', { step: 0.5, hardMin: 8, hardMax: 40 }), lenF('Accessible key, most', 'mix.accessibleWidth.1', { step: 0.5, hardMin: 8, hardMax: 40 }), lenF('Accessible key, target', 'mix.accessibleWidth.2', { step: 0.5, hardMin: 8, hardMax: 40 })])),
          Controls.help('Accessible keys are wider and sit by the guest elevator. They are not scored against the mix.'),
        ]),
        h('p', { class: 'help', id: 'shareNote' }),
      ]),
    };
  }
  function updateMixNote() {
    const el = $('shareNote');
    if (!el) return;
    const sum = (get(`mix.${isHotel() ? 'hotel' : 'multifamily'}`) || []).reduce((s, t) => s + (t.share || 0), 0);
    el.textContent = Math.abs(sum - 1) < 0.005 ? `Shares add to 100%.` : `Shares add to ${Math.round(sum * 100)}%. The fill renormalizes them.`;
  }

  function buildLocks() {
    return {
      children: els([
        h('p', { class: 'help', id: 'lockNote' }),
        h('div', { class: 'add-row' },
          Controls.button('Re-fill', () => Select.refill(), 'solid sm'),
          Controls.button('Unlock all', () => { if (!Select.unlockAll()) Toast.show('No units are locked.', 'warn'); }, 'outline sm'),
          Controls.button('Draw unit', () => { if (Render.ready()) Select.startDraw('unit', { label: 'a unit' }); }, 'outline sm')),
        Controls.help('Re-fill recomputes every unlocked unit from the mix. A locked unit keeps its outline and its type. Dragging a bay line, changing the type of a unit, splitting, merging or drawing a unit locks the units it touches.'),
        Controls.help('Draw unit: tap two cut lines on one run. The unit fills the band between them. To fill an unfilled run, tap it in the plan.'),
      ]),
    };
  }
  function buildAccessible() {
    return {
      children: els([
        Controls.when(() => !isHotel(), [
          pctS('Type A units, share of the units', 'accessible.multifamily.typeAShare', 0, 20, 0.5),
          Controls.group(els([intS('At least', 'accessible.multifamily.minUnits', 0, 10, { compact: true, hardMin: 0, hardMax: 50 }), intS('Add one per extra (units)', 'accessible.multifamily.over', 0, 100, { compact: true, hardMin: 0, hardMax: 1000 })])),
        ]),
        Controls.when(isHotel, [
          ...autoNumber('Accessible keys per level', 'accessible.perFloor', () => 1, 0, 6, 1, (v) => String(Math.round(v)), { id: 'accPerFloorMode', integer: true, hardMax: 20 }),
          lenS('Housekeeping reach', 'housekeepingReach', 60, 300, { step: 5, hardMin: 20, hardMax: 1000 }),
          Controls.help('Reach is the walking distance from the linen closet to a key door. The tool reports it. It does not check it.'),
        ]),
        h('p', { class: 'help', id: 'accNote' }),
        caution(CONFIG.accessibleCaution),
      ]),
    };
  }

  /* ==========================================================================
     Checks tab
     ========================================================================== */
  function buildChecksList() { return { children: [h('ul', { class: 'warns', id: 'checksWarnings' })] }; }
  /** The Efficiency card (rework plan 7.3): the advisor list, the target depth and the caution. */
  function buildEfficiency() {
    const def = () => (isHotel() ? 26 : 30);
    return {
      children: els([
        h('p', { class: 'help', id: 'advNote' }),
        h('ul', { class: 'warns adv-list', id: 'advList' }),
        blankAutoDecimal({ label: 'Target unit depth (ft)', path: 'targetDepth', id: 'targetDepthField', min: 10, max: 100, autoText: () => `Auto: ${def()} ft` }),
        caution(AdvisorMod.ADVISOR_CAUTION),
        caution(CoreMod.CORE_CAUTION),
      ]),
    };
  }
  /** A number field in feet that is blank for the default (null in the state). */
  function blankAutoDecimal({ label, path, id, min, max, autoText }) {
    const input = h('input', { class: 'numfield', type: 'text', id, inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label });
    const hint = h('p', { class: 'help', id: `${id}Hint` });
    const apply = () => {
      input.dataset.dirty = '';
      const t = input.value.trim();
      if (t === '') Store.set(path, null, { live: false });
      else { const n = Units.parseLength(t); if (isFinite(n)) Store.set(path, clamp(n, min, max), { live: false }); }
      refresh();
    };
    function refresh() {
      const v = get(path);
      input.placeholder = autoText();
      if (!(document.activeElement === input && input.dataset.dirty === '1')) input.value = typeof v === 'number' ? FT(v) : '';
      hint.textContent = typeof v === 'number' ? `Typed value. Clear the field for the default. ${autoText()}.` : `Blank means the default. ${autoText()}.`;
    }
    input.addEventListener('input', () => { input.dataset.dirty = '1'; });
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl compact' }, h('label', { class: 'ctl-label', for: id }, label), input), hint]);
  }
  function buildNumbers() { return { children: [h('dl', { class: 'kv', id: 'numbersTable' }), caution(CONFIG.testFitCaution), caution(CONFIG.distanceCaution)] }; }
  function buildMixTable() { return { children: [h('table', { class: 'tier-table', id: 'mixTable' }), h('p', { class: 'help', id: 'mixNote' })] }; }

  /* ==========================================================================
     View tab
     ========================================================================== */
  function buildDisplay() {
    const v = (k) => bs(`view.${k}`);
    return {
      children: els([
        choice('Style', 'view.style', [['model', 'Model'], ['diagram', 'Diagram']], { id: 'styleChips' }),
        Controls.toggle({ label: 'Site', bind: v('site') }),
        Controls.help('The ground, roads, water, trees, and neighbors of the project site. From the Site Model.'),
        Controls.when(() => get('view.site') !== false, [choice('Site style', 'view.siteStyle', [['solid', 'Solid'], ['glass', 'Glass'], ['wireframe', 'Wireframe']], { id: 'siteStyleChips' })]),
        Controls.toggle({ label: 'Massing', bind: v('massing') }),
        Controls.help('The whole project massing as a solid, with the level group you are filling highlighted and its plate drawn at its own height. Plan shows the massing as outlines.'),
        Controls.toggle({ label: 'Unit labels', bind: v('labels') }),
        Controls.toggle({ label: 'Corridor wall lines', bind: v('walls') }),
        Controls.toggle({ label: 'Bay lines (drag to move)', bind: v('bays') }),
        Controls.toggle({ label: 'Levels in 3D', bind: v('levels3d') }),
        Controls.toggle({ label: 'Site context', bind: v('context') }),
        Controls.toggle({ label: 'Grid', bind: v('grid') }),
        Controls.toggle({ label: 'Scale figure', bind: v('figure') }),
        Controls.toggle({ label: 'Snap', bind: v('snap.on') }),
        Controls.when(() => !!get('view.snap.on'), [lenS('Snap step', 'view.snap.grid', 0, 5, { step: 0.25, hardMin: 0.05, hardMax: 10, format: (x) => `${round1(x)} ft`, parse: Units.parseNumber })]),
      ]),
    };
  }

  const TABS = [
    { id: 'plate', title: 'Plate' },
    { id: 'units', title: 'Units' },
    { id: 'checks', title: 'Checks' },
    { id: 'view', title: 'View' },
  ];
  const SECTIONS = [
    { id: 'source', tab: 'plate', title: 'Source and program', open: false, build: buildSource },
    { id: 'shape', tab: 'plate', title: 'Plate shape', open: false, build: buildShape },
    { id: 'levels', tab: 'plate', title: 'Level groups', open: false, build: buildLevels },
    { id: 'corridor', tab: 'plate', title: 'Corridor', open: false, build: buildCorridor },
    { id: 'blocks', tab: 'plate', title: 'Blocks', open: false, build: buildBlocks },
    { id: 'mix', tab: 'units', title: 'Unit mix', open: false, build: buildMix },
    { id: 'locks', tab: 'units', title: 'Locks and re-fill', open: false, build: buildLocks },
    { id: 'accessible', tab: 'units', title: 'Accessible', build: buildAccessible },
    { id: 'efficiency', tab: 'checks', title: 'Efficiency', open: false, build: buildEfficiency },
    { id: 'checkslist', tab: 'checks', title: 'Warnings', open: false, build: buildChecksList },
    { id: 'numbers', tab: 'checks', title: 'Numbers', open: false, build: buildNumbers },
    { id: 'mixtable', tab: 'checks', title: 'Mix against target', open: false, build: buildMixTable },
    { id: 'display', tab: 'view', title: 'Display', open: false, build: buildDisplay },
  ];
  const sectionCtl = {};
  let activeTab = 'plate';
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
  function openSection(id) { const s = sectionCtl[id]; if (s && !s.isOpen()) { s.setOpen(true); rememberSection(id, true); } return !!s; }

  /* ---- top bar -------------------------------------------------------------------- */
  /** The Export menu: the picture, the files and the hand-off to the other tools. */
  function openExportMenu(anchor) {
    const el = h('div', { role: 'menu', id: 'exportMenu' });
    const item = (id, title, sub, onclick, o = {}) => h('button', { class: 'pop-item', type: 'button', role: 'menuitem', id, disabled: o.disabled, onclick: () => { if (!o.keep) Pop.close(); onclick(); } },
      h('span', { class: 'grow' }, title, sub ? h('small', null, sub) : null), o.chev ? h('span', { html: ICONS.chev, class: 'chev-r', style: 'display:contents' }) : null);
    const main = () => {
      el.textContent = '';
      el.append(h('div', { class: 'label pop-label' }, 'Picture'),
        item('miImage', 'Image', 'Save a PNG of this view', () => Shots.take()),
        item('miOverlay', 'Image overlay', 'Choose what the Image shows', () => overlay(), { keep: true, chev: true }),
        h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Files'),
        item('miRooms', 'Rooms (.csv)', 'One row per unit: type, area, position, exposures', () => FileExports.rooms()),
        item('miDxf', 'DXF (.dxf)', 'Plate, units, corridor, core and support on layers', () => FileExports.dxf()),
        item('miSketchup', 'SketchUp (.json)', 'Import with the CMRLM SketchUp extension', () => FileExports.sketchup()),
        item('miNotes', 'Notes (.md)', 'Numbers, settings and cautions in plain text', () => FileExports.notes()),
        item('miExportJson', 'Export JSON', 'Download all saved options', () => Options.exportJson()),
        item('miImportJson', 'Import JSON', 'Add the options from a file', () => $('importFile').click()),
        h('div', { class: 'pop-sep' }), h('div', { class: 'label pop-label' }, 'Send the project to'),
        item('miSendParking', 'Parking Deck', 'Save the project, then open the Parking Deck on it', () => ProjectUI.send('parking')),
        item('miSendFacade', 'Facade Studio', 'Save the project, then open the Facade Studio on it', () => ProjectUI.send('facade')));
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

    // Model / Diagram toggle
    const seg = $('styleToggle');
    const mk = (value, text) => h('button', { type: 'button', 'data-style': value, 'aria-pressed': 'false', onclick: () => Store.set('view.style', value, { live: false }) }, text);
    seg.append(mk('model', 'Model'), mk('diagram', 'Diagram'));
    const syncStyle = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === Store.get('view.style') ? 'true' : 'false'));
    Store.subscribe(syncStyle); syncStyle();

    const proj = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnProject', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Project: new, open, import, export', 'aria-label': 'Project menu', onclick: () => ProjectUI.openMenu(proj) },
      h('span', { html: ICONS.folder, style: 'display:contents' }), h('span', { class: 'btn-text', id: 'projLabel' }, 'Project'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbProject').append(proj);

    const exp = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnExport', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Export: image, rooms, DXF, SketchUp, notes, JSON, send to another tool', 'aria-label': 'Export menu', onclick: () => openExportMenu(exp) },
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
          <span class="label">Plate</span>
          <span class="hud-badge" id="hudBadge" data-n="0" title="Warnings">0 warnings</span>
          ${CARET_SVG}
        </span>
        <span class="hud-core">
          <span class="m"><span class="k" id="kUnits">Units</span><span class="v" id="mUnits">-</span></span>
          <span class="m"><span class="k">NRSF</span><span class="v" id="mNrsf">-</span></span>
          <span class="m"><span class="k">Efficiency</span><span class="v" id="mEff">-</span></span>
        </span>
      </button>
      <button class="hud-advice" id="hudAdvice" type="button" hidden title="Open the Efficiency card in Checks"><span class="hud-advice-text" id="hudAdviceText"></span></button>
      <div class="notice" id="staleNote" hidden role="status"><span id="staleText">The massing changed after this fill.</span> <button class="btn outline sm" type="button" id="staleRefill">Re-fill</button></div>
      <div class="hud-body" id="hudBody">
        <dl class="metrics compact">
          <div class="m"><dt>GSF</dt><dd id="mGsf">-</dd></div>
          <div class="m"><dt>Average unit</dt><dd id="mAvg">-</dd></div>
          <div class="m" id="mRangeRow" hidden><dt>Units in range</dt><dd id="mRange">-</dd></div>
          <div class="m"><dt>Corridor</dt><dd id="mCor">-</dd></div>
          <div class="m"><dt>Stair door path</dt><dd id="mPath">-</dd></div>
          <div class="m"><dt>Dead ends</dt><dd id="mDead">-</dd></div>
          <div class="m"><dt>Support</dt><dd id="mSupport">-</dd></div>
          <div class="m"><dt>Accessible</dt><dd id="mAcc">-</dd></div>
          <div class="m" id="mHotelRow"><dt>Housekeeping reach</dt><dd id="mReach">-</dd></div>
        </dl>
        <div class="sec" id="hudMix"><div class="label">Mix</div><table class="tier-table" id="hudMixTable"></table></div>
        <div class="sec" id="hudBuilding"><div class="label">Building</div><dl class="kv" id="hudBuildingList"></dl></div>
        <p class="help caution" id="hudCaution">${CONFIG.testFitCaution}</p>
        <div class="warn-block" id="warnBlock" data-n="0">
          <div class="label">Warnings <span class="count" id="warnCount">0</span></div>
          <ul class="warns" id="warnList"></ul>
          <button class="btn outline sm warn-all" id="warnAll" type="button" hidden>See all in Checks</button>
        </div>
      </div>`;
    $('hudToggle').addEventListener('click', () => setHudOpen(hud.dataset.collapsed === 'true'));
    $('staleRefill').addEventListener('click', () => Select.refill());
    const toChecks = (section) => { setTab('checks'); openSection(section); raiseSheet(); };
    $('warnAll').addEventListener('click', () => toChecks('checkslist'));
    $('hudAdvice').addEventListener('click', () => toChecks('efficiency'));
    Render.setInsetProvider(() => {
      if (Render.comparing()) return { right: 0 };
      const vw = $('viewport').clientWidth, w = hud.offsetWidth + 24;
      return { right: vw >= 1000 && vw - w >= 380 ? w : 0 };
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
  const HUD_WARNINGS = 3;
  const warnItem = (w) => h('li', { class: `warn-${w.level}`, 'data-warn': w.id || '' }, w.text);
  const opt = (v, f) => (v === null || v === undefined ? 'none' : f(v));
  /**
   * The mix table (HUD and Checks). A type with a target of 0 and none placed is not shown. A type that dropped out at this depth
   * shows "does not fit at this depth" in place of the numbers. The color chips sit in one column.
   */
  function mixTable(table, rows, types, dropped = []) {
    if (!table) return;
    table.textContent = '';
    const nameOf = (id) => { const t = types.find((x) => x.id === id); return t ? t.name : id; };
    const colorOf = (id) => { const t = types.find((x) => x.id === id); return t ? t.color : '#9aa3ad'; };
    const ids = [...rows.map((r) => r.type), ...types.map((t) => t.id).filter((id) => !rows.some((r) => r.type === id))];
    table.append(h('thead', null, h('tr', null, h('th', null, 'Type'), h('th', null, 'Placed'), h('th', null, 'Target'), h('th', null, 'Avg area'))));
    const body = h('tbody');
    for (const id of ids) {
      const r = rows.find((x) => x.type === id) || { type: id, count: 0, target: 0, diff: 0, avgArea: 0 };
      const cell = h('td', { class: 'type-cell' }, h('span', { class: 'type-wrap' }, h('span', { class: 'sw', style: `background:${colorOf(id)}` }), h('span', { class: 'type-name' }, nameOf(id))));
      if (dropped.includes(id)) { body.append(h('tr', { 'data-type': id, class: 'dropped' }, cell, h('td', { class: 'none', colspan: '3' }, 'does not fit at this depth'))); continue; }
      if (!r.count && !r.target) continue;
      body.append(h('tr', { 'data-type': id }, cell, h('td', null, String(r.count)), h('td', { class: Math.abs(r.diff) > 1 ? 'bad' : '' }, r.target === undefined ? '-' : String(r.target)), h('td', null, r.avgArea ? SF(r.avgArea) : '-')));
    }
    table.append(body);
  }

  function updateHud(d) {
    const m = d.hud;
    const hotel = isHotel();
    setText('kUnits', hotel ? 'Keys' : 'Units');
    setText('mUnits', Units.formatInt(m.units));
    setText('mNrsf', SF(m.nrsf));
    setText('mEff', pct1(m.efficiency));
    setText('mGsf', SF(m.gsf));
    setText('mAvg', SF(m.avgUnit));
    setText('mCor', m.corridorFt ? `${FT(m.corridorFt)}${m.corridorPerUnit ? ` · ${FT(m.corridorPerUnit)} per ${hotel ? 'key' : 'unit'}` : ''}` : 'none');
    setText('mPath', opt(m.stairPathFt, FT));
    setText('mDead', m.deadEnds && m.deadEnds.length ? `${m.deadEnds.length} · longest ${opt(m.deadEndMax, FT)}` : 'none');
    setText('mSupport', m.support ? `${SF(m.support.areaSf !== undefined ? m.support.areaSf : 0)}${m.support.count !== undefined ? ` · ${m.support.count} blocks` : ''}` : 'none');
    setText('mAcc', String(m.accessible));
    $('mHotelRow').hidden = !hotel;
    if (hotel && m.hotel) setText('mReach', m.hotel.reachable !== undefined ? `${m.hotel.reachable} of ${m.units} keys within ${FT(Store.get('housekeepingReach'))}` : 'reported');
    const types = (get(`mix.${hotel ? 'hotel' : 'multifamily'}`) || []);
    mixTable($('hudMixTable'), m.mix, types, m.dropped || []);
    mixTable($('mixTable'), m.mix, types, m.dropped || []);
    $('hudMix').hidden = !m.mix.length && !(m.dropped || []).length;
    $('mRangeRow').hidden = m.inRange === null || m.inRange === undefined;
    if (!$('mRangeRow').hidden) setText('mRange', `${Units.formatInt(m.inRange)} of ${Units.formatInt(m.units)}${m.areaHigh ? ` · ${m.areaHigh} large` : ''}`);
    $('hudBuilding').hidden = !(m.building && m.building.floors > 1);
    if (m.building) kvRows($('hudBuildingList'), [
      ['Floors', Units.formatInt(m.building.floors)], [hotel ? 'Keys' : 'Units', Units.formatInt(m.building.units)], ['NRSF', SF(m.building.nrsf)], ['GSF', SF(m.building.gsf)], ['Efficiency', pct1(m.building.efficiency)],
      ...(m.building.inRange === null || m.building.inRange === undefined ? [] : [['Units in range', `${Units.formatInt(m.building.inRange)} of ${Units.formatInt(m.building.units)}`]]),
    ]);

    // One list for the badge, the HUD and the Checks tab: d.warnings (the checks() output). The HUD shows the first three.
    const list = $('warnList');
    list.textContent = '';
    if (!d.warnings.length) list.append(h('li', { class: 'none' }, 'No warnings'));
    for (const w of d.warnings.slice(0, HUD_WARNINGS)) list.append(warnItem(w));
    const nw = d.warnings.length;
    $('warnAll').hidden = nw === 0;
    $('warnCount').textContent = String(nw);
    $('warnBlock').dataset.n = String(nw);
    $('hudBadge').dataset.n = String(nw);
    $('hudBadge').textContent = `${nw} ${nw === 1 ? 'warning' : 'warnings'}`;
    $('staleNote').hidden = !d.stale;

    updateNotes(d);
    updateGroups(d);
    updateLegend(d);
    updateAdvice();
  }

  /** The advisor list on the Efficiency card and the one line in the HUD Plate panel (rework plan 7.3 items 4 and 5). */
  function updateAdvice() {
    const a = Advice.get(), list = a.list;
    const box = $('advList');
    const note = $('advNote');
    if (note) note.textContent = a.error ? 'The advisor could not run for these settings.' : a.fresh ? '' : 'The advisor is checking the plate.';
    if (box) {
      box.textContent = '';
      if (!list.length) box.append(h('li', { class: 'none' }, a.fresh ? 'No advice. The plate has no efficiency problem that the advisor can name.' : '...'));
      for (const it of list) {
        const li = h('li', { class: `warn-${it.severity === 'info' ? 'info' : 'warn'} adv-item`, 'data-adv': it.code }, h('span', null, it.message));
        if (it.code === 'core-oversize') li.append(h('button', { class: 'btn outline sm', type: 'button', onclick: () => Select.resetCore() }, 'Reset core to auto'));
        box.append(li);
      }
    }
    const ha = $('hudAdvice');
    if (ha) {
      ha.hidden = !list.length;
      setText('hudAdviceText', list.length ? list[0].message : '');
      ha.classList.toggle('stale', !a.fresh);
    }
  }

  /** The small readouts inside the panel sections. */
  function updateNotes(d) {
    const st = Store.raw(), m = d.hud;
    const sn = $('sourceNote');
    if (sn) {
      const err = !d.ok && d.warnings[0] ? d.warnings[0].text : '';
      sn.textContent = err || (d.notes || []).join(' ');
      sn.hidden = !sn.textContent;
      sn.classList.toggle('caution', !!err);
    }
    const pn = $('polyNote');
    if (pn) pn.textContent = st.plate.points.length >= 3 ? `${st.plate.points.length} points, ${SF(Math.abs(ringArea(st.plate.points)))}.` : 'No outline yet. Draw one.';
    updateMixNote();
    const cn = $('coreNote');
    if (cn) {
      const L = d.editing, mode = st.core.mode, c = m.core;
      let text = '';
      if (mode === 'none') text = 'No core. The fill makes none.';
      else if (L && L.core && L.core.length) {
        const r = ringRect(L.core), area = Math.abs(ringArea(L.core));
        const el = c && c.cabs !== null && c.cabs !== undefined ? ` ${c.cabs} passenger elevator${c.cabs === 1 ? '' : 's'}${c.service ? ` and ${c.service} service` : ''}.` : '';
        text = `${mode === 'auto' ? 'Auto' : 'Manual'} core: ${FT(r[2] - r[0])} by ${FT(r[3] - r[1])}, ${SF(area)}.${mode === 'auto' ? el : ''}`;
      } else text = mode === 'auto' ? 'Auto: this plate has no core block. A bar plate puts the elevators beside the corridor. A point plate gets a core.' : 'Manual: draw the core in the plan.';
      cn.textContent = text;
    }
    const dn = $('depthCapNote');
    if (dn) { const on = capNow() !== null; dn.textContent = `${on ? 'Units stop at the cap depth. The strip between the cap and the corridor becomes storage.' : 'Off: units run the full depth.'} ${capGroupId() ? 'The cap applies to the selected level group.' : 'The cap applies to the whole plate.'}`; }
    const ln = $('lockNote');
    if (ln) { const n = Select.locks().length; ln.textContent = n ? `${n} locked unit${n === 1 ? '' : 's'} in this ${st.source === 'project' ? 'group' : 'plate'}.` : 'No locked units.'; }
    const an = $('accNote');
    if (an && d.metrics) {
      const a = d.metrics.building.accessible;
      an.textContent = isHotel() ? `Required ${a.required} accessible keys (${a.rollIn} roll-in) for ${m.building ? m.building.units : m.units} keys; provided ${a.provided}.` : `Required ${a.required} Type A units for ${m.building ? m.building.units : m.units} units; provided ${a.provided}.`;
    }
    const cw = $('checksWarnings');
    if (cw) { cw.textContent = ''; if (!d.warnings.length) cw.append(h('li', { class: 'none' }, 'No warnings')); for (const w of d.warnings) cw.append(warnItem(w)); }
    const hotel = isHotel();
    kvRows($('numbersTable'), [
      [hotel ? 'Keys' : 'Units', Units.formatInt(m.units)], ['NRSF', SF(m.nrsf)], ['GSF', SF(m.gsf)], ['Efficiency', pct1(m.efficiency)], ['Average unit', SF(m.avgUnit)],
      ['Corner units', Units.formatInt(m.corners)], ['Exposures N E S W', ['N', 'E', 'S', 'W'].map((k) => `${k} ${m.exposures[k]}`).join(' · ')],
      ['Corridor length', m.corridorFt ? FT(m.corridorFt) : 'none'], ['Stair doors', Units.formatInt(m.stairDoors)], ['Longest stair door path', opt(m.stairPathFt, FT)],
      ['Dead ends', m.deadEnds && m.deadEnds.length ? m.deadEnds.map((x) => (typeof x === 'number' ? FT(x) : FT(x.length || 0))).join(', ') : 'none'],
      ['Area closure', m.closure ? (m.closure.ok ? 'closes' : `off by ${m.closure.diff} sf`) : 'not reported'],
    ]);
    const mn = $('mixNote');
    if (mn) mn.textContent = m.mix.length ? 'The target is the count the shares give for the length of the runs. A miss is more than one unit off.' : 'No mix targets for this plate.';
  }

  /* ---- legend ------------------------------------------------------------------------------ */
  function updateLegend() {
    const box = $('legend');
    const v = Store.raw().view;
    if (Render.comparing()) { box.hidden = true; return; }
    const rows = [];
    if (v.style === 'diagram') {
      for (const t of get(`mix.${isHotel() ? 'hotel' : 'multifamily'}`) || []) rows.push([t.color, t.name, `type-${t.id}`]);
    }
    rows.push([CONFIG.corridorColor, 'Corridor', 'role-corridor'], [CONFIG.coreColor, 'Core, stairs, elevators', 'role-core'], [CONFIG.supportColor, 'Support', 'role-support']);
    const L = Derived.get().editing;
    if (L && L.support.some((b) => b.kind === 'remainder')) rows.push([CONFIG.remainderColor, 'Unfilled run (tap to fill)', 'role-remainder']);
    if (L && L.units.some((u) => u.areaHigh)) rows.push([CONFIG.areaHighColor, 'Large unit', 'role-large']);
    const key = JSON.stringify([rows, v.style]);
    box.hidden = false;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const r of rows) box.append(h('div', { class: 'lg-row', 'data-key': r[2] }, h('span', { class: 'sw', style: `background:${r[0]}` }), h('span', null, r[1])));
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
    setTab(TABS.some((t) => t.id === prefs.tab) ? prefs.tab : 'plate', { remember: false });
    buildViews();
    buildHud();
    initSheet();
    initKeys();
    Store.subscribe(() => { Controls.refreshAll(); updateLegend(); });
    Controls.refreshAll();
    Render.onRebuild(updateHud);
    Advice.onChange(updateAdvice);
    Advice.start();
    // A viewport that is not WebGL-capable still gets numbers.
    updateHud(Derived.get());
  }
  return {
    init, updateHud, rebuildPanel: () => { Controls.refreshAll(); },
    // test hooks: the section controllers, and a rebuild of the panel from the saved UI prefs (a simulated reload)
    rememberSection, sectionCtl, rebuildSections: () => { buildPanel(); setTab(activeTab, { remember: false }); Controls.refreshAll(); },
    setTab, activeTab: () => activeTab, tabs: () => TABS.map((t) => t.id),
    setHudOpen, hudOpen: () => $('hud').dataset.collapsed === 'false', sections: () => SECTIONS.map((s) => ({ id: s.id, tab: s.tab })),
    openSection,
  };
})();
