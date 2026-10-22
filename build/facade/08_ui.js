/* ==========================================================================
   UI
   Facade Studio panels (Massing, Facade, Checks, View), top bar, metrics HUD, preset view buttons, sheet.
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
const UI_STORAGE_KEY = 'facade.ui.v1';

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

  let rangesList = null, bandsList = null;
  const ORIENT_OPTS = CONFIG.orientations.map((o) => ({ value: o, label: o }));
  const BASE_ZONES = ['base', 'middle', 'top'];
  const zoneIds = () => [...BASE_ZONES, ...(get('zones.ranges') || []).map((r) => r.id)];
  const zoneName = (id) => CONFIG.zoneLabels[id] || ((get('zones.ranges') || []).find((r) => r.id === id) || {}).name || id;
  const lenB = (label, bind, min, max, extra = {}) => Controls.slider({
    label, bind, min, max, step: 0.5, hardMin: 0.5, hardMax: MAXD,
    format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  /** Toggle buttons for a list of zone ids (the ids change with the ranges). */
  function zoneChips(label, path) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': label });
    let key = '', btns = [];
    const refresh = () => {
      const ids = zoneIds();
      const k = JSON.stringify(ids.map((i) => [i, zoneName(i)]));
      if (k !== key) {
        key = k; wrap.textContent = '';
        btns = ids.map((id) => {
          const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-value': id }, zoneName(id));
          b.addEventListener('click', () => {
            const cur = new Set(get(path) || []);
            if (cur.has(id)) cur.delete(id); else cur.add(id);
            Store.set(path, ids.filter((x) => cur.has(x)), { live: false });
          });
          wrap.append(b);
          return b;
        });
      }
      const cur = new Set(get(path) || []);
      btns.forEach((b) => b.setAttribute('aria-pressed', String(cur.has(b.dataset.value))));
    };
    return Controls.when(() => { refresh(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, label), wrap)]);
  }

  /* ==========================================================================
     Massing tab
     ========================================================================== */
  function setSource(k) {
    if (k === 'standalone') { ProjectUI.useStandalone(); return; }
    if (!ProjectUI.has()) { Toast.show('Open a project first (Project menu). The project massing comes from the Mid-Rise Generator or the Tower Generator.', 'warn', 6000); return; }
    ProjectUI.useProject();
  }
  function buildSource() {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Massing source', id: 'sourceChips' });
    const btns = ['standalone', 'project'].map((k) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-source': k, 'aria-pressed': 'false', onclick: () => setSource(k) }, SOURCE_LABELS[k]);
      wrap.append(b);
      return b;
    });
    const syncSource = () => {
      const s = get('source');
      btns.forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.source === s));
        const need = b.dataset.source === 'project' && !(ProjectUI.has() && ProjectUI.hasMassing());
        b.classList.toggle('is-disabled', need);
        b.title = need ? (ProjectUI.has() ? 'The project has no massing yet' : 'Open a project first') : '';
      });
    };
    Store.subscribe(syncSource);
    return {
      children: [
        Controls.when(() => { syncSource(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Massing is'), wrap)]).el,
        Controls.help('A standalone massing is a simple shape you set below. The project massing is read from the open project and is not edited here.'),
        h('p', { class: 'help', id: 'sourceNote' }),
        h('p', { class: 'help', id: 'massNote' }),
        h('div', { class: 'proj-line', id: 'projLine' }),
        Controls.when(() => ProjectUI.has(), [ProjectUI.nameControl().el]).el,
      ],
    };
  }

  function buildStandalone() {
    const standalone = () => get('source') === 'standalone';
    const shape = () => get('standalone.shape');
    return {
      children: els([
        Controls.when(() => !standalone(), [Controls.help('The massing comes from the project. Switch the source to Standalone massing to edit a shape here.')]),
        Controls.when(standalone, [
          sel('Shape', 'standalone.shape', opts(SHAPES.map((k) => [k, SHAPE_LABELS[k]]))),
          lenS('Width', 'standalone.width', 60, 600, { hardMin: 5 }),
          lenS('Depth', 'standalone.depth', 40, 400, { hardMin: 5 }),
          Controls.when(() => shape() !== 'rect', [lenS('Bar depth', 'standalone.arm', 30, 150, { hardMin: 5 })]),
          Controls.when(() => shape() === 'O', [Controls.group(els([lenF('Court width', 'standalone.courtW', { hardMin: 5 }), lenF('Court depth', 'standalone.courtD', { hardMin: 5 })]))]),
          degS('Angle', 'standalone.angle', -90, 90),
          intS('Floors', 'standalone.floors', 1, 60, { hardMax: CONFIG.limits.maxLevels }),
          Controls.group(els([lenF('Level 1 floor-to-floor', 'standalone.ftf1', { step: 0.5, hardMin: 6, hardMax: 40 }), lenF('Typical floor-to-floor', 'standalone.ftf', { step: 0.5, hardMin: 6, hardMax: 40 })])),
          Controls.toggle({ label: 'Podium under the main shape', bind: bs('standalone.podium.on') }),
          Controls.when(() => !!get('standalone.podium.on'), [
            intS('Podium levels', 'standalone.podium.levels', 1, 6, { hardMax: 20 }),
            lenS('Podium floor-to-floor', 'standalone.podium.ftf', 10, 20, { step: 0.5, hardMin: 6, hardMax: 40 }),
            Controls.group(els([lenF('Podium width', 'standalone.podium.width', { hardMin: 5 }), lenF('Podium depth', 'standalone.podium.depth', { hardMin: 5 })])),
            Controls.help('The podium levels are the base zone. Every shape is centered on its bounding box.'),
          ]),
        ]),
      ]),
    };
  }

  function nextRangeId(arr) { let n = 1; while (arr.some((r) => r.id === `Z${n}`)) n++; return `Z${n}`; }
  function buildZones() {
    const rangesBind = {
      get: () => get('zones.ranges'),
      set: (v) => {
        if (Array.isArray(v) && v.length > CONFIG.limits.maxRanges) { Toast.show(`Up to ${CONFIG.limits.maxRanges} ranges.`, 'warn'); return; }
        const next = deepClone(Store.raw());
        next.zones.ranges = v;
        Store.replace(fillDefaults(next));
      },
      commit: () => Store.commit(),
    };
    rangesList = mkList({
      bind: rangesBind, addLabel: 'Add range', min: 0, reorder: false, openDefault: () => true, empty: 'No ranges yet.',
      title: (i, r) => `${r.name} · levels ${r.from} to ${r.to}`,
      make: (arr) => {
        const last = arr.length ? arr[arr.length - 1] : null;
        const from = last ? last.to + 1 : 2;
        return { id: nextRangeId(arr), name: `Levels ${from} to ${from + 4}`, from, to: from + 4 };
      },
      render: (i) => ({
        children: els([
          textField('Name', `zones.ranges.${i}.name`, { maxlength: 40 }),
          Controls.group(els([intS('From level', `zones.ranges.${i}.from`, 1, 1, { compact: true, hardMax: CONFIG.limits.maxLevels }), intS('To level', `zones.ranges.${i}.to`, 1, 1, { compact: true, hardMax: CONFIG.limits.maxLevels })])),
        ]),
      }),
    });
    return {
      children: els([
        choice('Zones', 'zones.mode', [['default', 'Base, middle, top'], ['ranges', 'Level ranges']], { id: 'zoneMode' }),
        Controls.help('Base is the podium (or the lowest level), top is the highest level, middle is everything between. Level ranges replace that split; a level in no range keeps its default zone.'),
        Controls.when(() => get('zones.mode') === 'ranges', [rangesList.el, Controls.help('Each range has its own card on the Facade tab.')]),
      ]),
    };
  }

  let pickBtn = null;
  function syncPick() { if (pickBtn) { const on = Select.streetPick(); pickBtn.setAttribute('aria-pressed', String(on)); pickBtn.classList.toggle('is-on', on); pickBtn.textContent = on ? 'Picking: click faces in the view' : 'Pick street faces'; } }
  function setStreetPick(on) {
    Select.setStreetPick(on);
    if (on) { setTab('massing'); }
    syncPick();
    return Select.streetPick();
  }
  function buildStreet() {
    pickBtn = h('button', { class: 'btn outline sm', type: 'button', id: 'btnPickStreet', 'aria-pressed': 'false', onclick: () => setStreetPick(!Select.streetPick()) }, 'Pick street faces');
    return {
      children: els([
        choice('Street faces', 'street.mode', [['auto', 'Automatic'], ['manual', 'Manual']], { id: 'streetMode' }),
        Controls.when(() => get('street.mode') === 'auto', [
          lenS('Distance to a road', 'street.roadDistance', 0, 200, { hardMin: 0, hardMax: 2000, step: 5 }),
          Controls.help('With a project site, a face on the lowest level is a street face when it lies within this distance of a road and points at it. Without a site, the south faces on the lowest level are street faces.'),
        ]),
        Controls.when(() => get('street.mode') === 'manual', [
          Controls.help('Click faces in the view, or press the button and click several faces. Each click toggles one face.'),
          h('div', { class: 'add-row' }, pickBtn, Controls.button('Clear', () => Store.set('street.manual', [], { live: false }), 'outline sm')),
        ]),
        Controls.when(() => get('street.mode') === 'auto', [h('div', { class: 'add-row' }, Controls.button('Pick faces by hand', () => { Store.set('street', { ...Store.get('street'), mode: 'manual', manual: D().street.slice() }, { live: false }); setStreetPick(true); }, 'outline sm'))]),
        h('p', { class: 'help', id: 'streetNote' }),
      ]),
    };
  }

  /* ==========================================================================
     Facade tab: one card per zone
     ========================================================================== */
  const zoneApi = {};
  function zoneEditor(zoneKey, getId) {
    let target = 'all';
    const id = () => getId();
    const ownObj = () => (target === 'all' ? get(`zones.rules.${id()}`) : get(`zones.overrides.${id()}.${target}`)) || {};
    const eff = () => PanelsMod.ruleFor(Store.raw(), id(), target === 'all' ? undefined : target);
    function setTargetObj(obj, live) {
      if (target === 'all') { Store.set(`zones.rules.${id()}`, obj, { live }); return; }
      const ovs = deepClone(get('zones.overrides') || {});
      if (!ovs[id()]) ovs[id()] = {};
      if (Object.keys(obj).length) ovs[id()][target] = obj; else delete ovs[id()][target];
      if (!Object.keys(ovs[id()]).length) delete ovs[id()];
      Store.set('zones.overrides', ovs, { live });
    }
    const setKey = (key, v, live) => setTargetObj({ ...ownObj(), [key]: v }, live);
    const unsetKey = (key) => { const o = { ...ownObj() }; delete o[key]; setTargetObj(o, false); };
    const keyBind = (key) => ({ get: () => eff()[key], set: (v, live) => setKey(key, v, live), commit: () => Store.commit() });
    const baseSystem = () => (get(`zones.rules.${id()}`) || {}).system || 'punched';
    function setSystem(k) {
      const own = ownObj(), keep = {};
      if (own.glazing !== undefined) keep.glazing = own.glazing;
      if (own.material !== undefined) keep.material = own.material;
      if (target === 'all') setTargetObj({ system: k, ...keep }, false);
      else setTargetObj(k === baseSystem() ? keep : { system: k, ...keep }, false);
    }
    const sysWrap = h('div', { class: 'chips sys-chips', role: 'group', 'aria-label': 'Facade system' });
    const sysBtns = CONFIG.systemOrder.map((k) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-system': k, 'aria-pressed': 'false', onclick: () => setSystem(k) }, CONFIG.systemLabels[k]);
      sysWrap.append(b);
      return b;
    });
    const strip = h('div', { class: 'orient-strip', role: 'group', 'aria-label': 'Orientation' });
    const stripBtns = ['all', ...CONFIG.orientations].map((t) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-target': t, 'aria-pressed': 'false', title: t === 'all' ? 'The rule for every orientation' : `Override for ${CONFIG.orientationLabels[t]} faces` }, t === 'all' ? 'All' : t);
      b.addEventListener('click', () => api.setTarget(t));
      strip.append(b);
      return b;
    });
    const has = (o) => Object.keys((get(`zones.overrides.${id()}.${o}`)) || {}).length > 0;
    const syncStrip = () => {
      stripBtns.forEach((b) => {
        const t = b.dataset.target;
        b.setAttribute('aria-pressed', String(t === target));
        b.classList.toggle('has-override', t !== 'all' && has(t));
      });
      sysBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.system === eff().system)));
    };
    const api = {
      setTarget: (t) => { target = t; Controls.refreshAll(); syncStrip(); },
      target: () => target,
    };
    zoneApi[zoneKey] = api;
    const sys = () => eff().system;
    const dim = (key, label, min, max, extra = {}) => lenB(label, keyBind(key), min, max, extra);
    const solidBind = {
      get: () => { const s = eff().solid; return !!(s && s.count > 0); },
      set: (on) => {
        if (on) setKey('solid', { count: 1, every: 3 }, false);
        else if (target === 'all' || !(get(`zones.rules.${id()}`) || {}).solid) unsetKey('solid');
        else setKey('solid', { count: 0, every: 1 }, false);
      },
      commit: () => {},
    };
    const solidPart = (k) => ({
      get: () => { const s = eff().solid; return s ? s[k] : undefined; },
      set: (v, live) => setKey('solid', { ...(eff().solid || { count: 1, every: 3 }), [k]: Math.max(1, Math.round(v)) }, live),
      commit: () => Store.commit(),
    });
    const optSelect = (label, key, list, none) => Controls.select({
      label, bind: { get: () => eff()[key] || '', set: (v) => { if (v) setKey(key, v, false); else unsetKey(key); }, commit: () => {} },
      options: [{ value: '', label: none }, ...list],
    });
    const glazList = Object.keys(get('envelope.glazing') || {}).map((k) => ({ value: k, label: get(`envelope.glazing.${k}.label`) || k }));
    const matList = (get('materials') || []).map((k) => ({ value: k, label: CONFIG.materialLabels[k] || k }));
    const resetBtn = Controls.button('Same as All', () => setTargetObj({}, false), 'outline sm');
    const children = [
      h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Orientation'), strip),
      Controls.when(() => target !== 'all', [h('p', { class: 'help' }, 'An override changes only this orientation of this zone. Anything left alone follows the All rule.'), Controls.when(() => has(target), [h('div', { class: 'add-row' }, resetBtn)])]).el,
      Controls.when(() => { syncStrip(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'System'), sysWrap)]).el,
      dim('module', 'Module width', 4, 30, { hardMin: 3, hardMax: 100 }).el,
      Controls.when(() => sys() === 'punched', [dim('windowW', 'Window width', 2, 14, { hardMin: 1 }), dim('sill', 'Sill height', 0, 6, { hardMin: 0, hardMax: 20 }), dim('head', 'Head height', 5, 12, { hardMin: 1, hardMax: 40 })]).el,
      Controls.when(() => sys() === 'windowWall', [dim('slabCover', 'Slab cover (spandrel)', 0, 4, { hardMin: 0, hardMax: 10 })]).el,
      Controls.when(() => sys() === 'curtainWall', [dim('vision', 'Vision glass height', 3, 12, { hardMin: 1, hardMax: 40 }), dim('sill', 'Sill height', 0, 4, { hardMin: 0, hardMax: 20 })]).el,
      Controls.when(() => sys() === 'storefront', [dim('sill', 'Sill height', 0, 4, { hardMin: 0, hardMax: 20 }), dim('head', 'Head height', 6, 14, { hardMin: 1, hardMax: 40 })]).el,
      Controls.when(() => sys() !== 'solid', [
        Controls.toggle({ label: 'Solid panels in a pattern', bind: solidBind }),
        Controls.when(() => !!(eff().solid && eff().solid.count > 0), [
          Controls.group(els([
            Controls.slider({ label: 'Solid in each run', bind: solidPart('count'), min: 1, max: 4, step: 1, compact: true, hardMin: 1, hardMax: 50, integer: true, format: Units.formatInt, inputMode: 'numeric' }),
            Controls.slider({ label: 'Run length (panels)', bind: solidPart('every'), min: 2, max: 8, step: 1, compact: true, hardMin: 1, hardMax: 50, integer: true, format: Units.formatInt, inputMode: 'numeric' }),
          ])),
          Controls.help('The last panels of each run are solid. A run of 3 with 1 solid makes every third panel solid.'),
        ]),
      ]).el,
      optSelect('Glazing type', 'glazing', glazList, 'Default').el,
      optSelect('Material (solid areas)', 'material', matList, 'Default').el,
      h('p', { class: 'help', 'data-zone-info': zoneKey }),
    ];
    return { children };
  }
  const zoneSection = (zid) => ({ children: zoneEditor(zid, () => zid).children });

  function buildRangeZones() {
    const bind = { get: () => get('zones.ranges'), set: () => {}, commit: () => {} };
    const list = mkList({
      bind, addLabel: 'Add range', min: 0, reorder: false, openDefault: () => false, empty: 'No level ranges. Switch Zones to Level ranges on the Massing tab.',
      title: (i, r) => `${r.name} · levels ${r.from} to ${r.to}`,
      make: () => ({}),
      render: (i) => {
        const zid = () => ((get('zones.ranges') || [])[i] || {}).id;
        return { children: zoneEditor(`range:${i}`, zid).children };
      },
    });
    const add = list.el.querySelector('.add-row');
    if (add) add.hidden = true;
    zoneApi.rangesList = list;
    return { children: [list.el] };
  }

  function buildBalconies() {
    return {
      children: els([
        Controls.toggle({ label: 'Balconies', bind: bs('balconies.on') }),
        Controls.when(() => !!get('balconies.on'), [
          choice('Type', 'balconies.type', [['inset', 'Inset'], ['projected', 'Projected']], { id: 'balconyType' }),
          sel('Pattern', 'balconies.pattern', opts([['stacked', 'Stacked'], ['alternating', 'Alternating'], ['checker', 'Checkerboard'], ['per-unit', 'One per unit']])),
          Controls.when(() => get('balconies.pattern') !== 'per-unit', [intS('Every nth module', 'balconies.spacing', 1, 6, { hardMax: 20 })]),
          Controls.when(() => get('balconies.pattern') === 'per-unit', [Controls.help('One balcony on the longest facade edge of each unit. Needs Plate Planner units in the project; without them stacked balconies are used and a warning says so.')]),
          Controls.group(els([lenF('Width', 'balconies.width', { step: 0.5, hardMin: 2, hardMax: 40 }), lenF('Depth', 'balconies.depth', { step: 0.5, hardMin: 2, hardMax: 20 })])),
          Controls.when(() => get('balconies.type') === 'projected', [lenF('Slab thickness', 'balconies.slab', { step: 0.25, hardMin: 0.25, hardMax: 3 })]),
          Controls.group(els([lenF('Door width', 'balconies.door.width', { step: 0.5, hardMin: 2, hardMax: 20 }), lenF('Door height', 'balconies.door.head', { step: 0.5, hardMin: 5, hardMax: 14 })])),
          zoneChips('On zones', 'balconies.zones'),
          Controls.chips({ label: 'On orientations', bind: bs('balconies.orientations'), options: ORIENT_OPTS }),
          Controls.help('The door replaces the window in a balcony module. An inset balcony cuts the wall back by its depth; its door counts as glazing and the side returns are not wall area.'),
          h('p', { class: 'help', id: 'balconyNote' }),
        ]),
      ]),
    };
  }
  function buildFins() {
    return {
      children: els([
        Controls.toggle({ label: 'Vertical fins', bind: bs('fins.on') }),
        Controls.when(() => !!get('fins.on'), [
          Controls.group(els([lenF('Depth', 'fins.depth', { step: 0.25, hardMin: 0.25, hardMax: 10 }), lenF('Thickness', 'fins.width', { step: 0.0833, hardMin: 0.0833, hardMax: 2 })])),
          intS('At every nth module line', 'fins.every', 1, 6, { hardMax: 20 }),
          zoneChips('On zones', 'fins.zones'),
          Controls.chips({ label: 'On orientations', bind: bs('fins.orientations'), options: ORIENT_OPTS }),
          Controls.help('Fins run the full level height. They do not change the areas.'),
        ]),
      ]),
    };
  }
  function buildShades() {
    return {
      children: els([
        Controls.toggle({ label: 'Horizontal shades over windows', bind: bs('shades.on') }),
        Controls.when(() => !!get('shades.on'), [
          Controls.group(els([lenF('Depth', 'shades.depth', { step: 0.25, hardMin: 0.25, hardMax: 10 }), lenF('Above the head', 'shades.above', { step: 0.25, hardMin: 0, hardMax: 5 })])),
          zoneChips('On zones', 'shades.zones'),
          Controls.chips({ label: 'On orientations', bind: bs('shades.orientations'), options: ORIENT_OPTS }),
          Controls.help('Projection factor = depth / (head - sill + above). The HUD lists it by orientation.'),
          caution('Caution: energy codes credit shades only by their own rules. Verify any credit against the adopted code.'),
        ]),
      ]),
    };
  }
  function buildBands() {
    const matList = (get('materials') || []).map((k) => ({ value: k, label: CONFIG.materialLabels[k] || k }));
    const mat = () => (get('materials') || ['metal'])[1] || 'metal';
    bandsList = mkList({
      bind: bs('bands'), addLabel: 'Add band', min: 0, reorder: false, openDefault: () => true, empty: 'No bands.',
      title: (i, b) => (b.every !== undefined ? `Every ${b.every} levels · ${CONFIG.materialLabels[b.material] || b.material}` : `${zoneName(b.zone)} · ${CONFIG.materialLabels[b.material] || b.material}`),
      make: () => ({ zone: 'base', material: mat() }),
      render: (i) => {
        const kindBind = {
          get: () => (((get('bands') || [])[i] || {}).every !== undefined ? 'every' : 'zone'),
          set: (v) => { const b = (get('bands') || [])[i] || {}; Store.set(`bands.${i}`, v === 'every' ? { every: 3, material: b.material || mat() } : { zone: 'base', material: b.material || mat() }, { live: false }); },
          commit: () => {},
        };
        return {
          children: els([
            sel('Band by', null, opts([['zone', 'Zone'], ['every', 'Every nth level']]), kindBind),
            Controls.when(() => ((get('bands') || [])[i] || {}).every === undefined, [dynSelect('Zone', () => zoneIds().map((z) => ({ value: z, label: zoneName(z) })), { get: () => ((get('bands') || [])[i] || {}).zone, set: (v) => Store.set(`bands.${i}.zone`, v, { live: false }) })]),
            Controls.when(() => ((get('bands') || [])[i] || {}).every !== undefined, [intS('Every nth level', `bands.${i}.every`, 2, 12, { hardMin: 1, hardMax: 60 })]),
            sel('Material', `bands.${i}.material`, matList),
          ]),
        };
      },
    });
    return { children: [Controls.help('A band tints the spandrels and solid panels of a zone, or of every nth level. It does not change the areas.'), bandsList.el] };
  }
  function buildCorners() {
    return { children: [choice('Corners', 'corners', [['solid', 'Solid'], ['glass', 'Glass']], { id: 'cornerChips' }), Controls.help('A glass corner turns the end panel of a face at a convex corner into full-height glass, down to the slab cover.')] };
  }

  /* ==========================================================================
     Checks tab
     ========================================================================== */
  const WWR_CAUTION = 'Caution: the 40 percent value is a design value (the prescriptive path of ASHRAE 90.1-2019). Verify the edition and the path for each project. The tool never says a design complies.';
  function buildChecksList() {
    return { children: [h('ul', { class: 'warns', id: 'checksWarnings' })] };
  }
  function buildLimits() {
    const targetOn = {
      get: () => get('checks.transparencyTarget') != null,
      set: (on) => Store.set('checks.transparencyTarget', on ? 0.6 : null, { live: false }),
      commit: () => {},
    };
    return {
      children: els([
        caution(WWR_CAUTION),
        pctS('Window-to-wall check value', 'checks.wwrLimit', 10, 80, 1),
        h('p', { class: 'help', id: 'wwrNote' }),
        Controls.label('Ground transparency'),
        Controls.group(els([lenF('Band from', 'checks.band.from', { step: 0.5, hardMin: 0, hardMax: 100 }), lenF('Band to', 'checks.band.to', { step: 0.5, hardMin: 0.5, hardMax: 100 })])),
        Controls.help('The band is measured above the lowest level, over the street faces.'),
        Controls.toggle({ label: 'Check a transparency target', bind: targetOn }),
        Controls.when(() => get('checks.transparencyTarget') != null, [pctS('Target', 'checks.transparencyTarget', 20, 100, 5)]),
        caution('Caution: zoning codes set their own band and target. Verify both against the adopted code.'),
        h('p', { class: 'help', id: 'transNote' }),
      ]),
    };
  }
  function buildWwrTables() {
    return {
      children: [
        h('div', { class: 'label sub-label' }, 'By orientation'), h('dl', { class: 'kv', id: 'wwrOrient' }),
        h('div', { class: 'label sub-label' }, 'By zone'), h('dl', { class: 'kv', id: 'wwrZone' }),
        h('div', { class: 'label sub-label' }, 'By system'), h('dl', { class: 'kv', id: 'wwrSystem' }),
        Controls.help('Glazing counts the whole window opening, frame and mullions included. Wall area is length times floor-to-floor; parapets and screens add none.'),
        caution(WWR_CAUTION),
      ],
    };
  }
  function buildEnvelope() {
    const glazKeys = Object.keys(get('envelope.glazing') || {});
    const wallKeys = Object.keys(get('envelope.walls') || {});
    return {
      children: els([
        Controls.toggle({ label: 'Show the envelope note', bind: bs('envelope.on') }),
        Controls.when(() => !!get('envelope.on'), [
          caution('Caution: typical seed values, not product data or code values. Verify every value.'),
          Controls.group(els([numS('Fixed glazing U limit', 'envelope.limits.uFixed', 0, 1, 0.01, 2, { compact: true }), numS('SHGC limit', 'envelope.limits.shgc', 0, 1, 0.01, 2, { compact: true })])),
          ...glazKeys.map((k) => Controls.group(els([numS(`${get(`envelope.glazing.${k}.label`) || k}: U`, `envelope.glazing.${k}.u`, 0, 1, 0.01, 2, { compact: true }), numS('SHGC', `envelope.glazing.${k}.shgc`, 0, 1, 0.01, 2, { compact: true })]))),
          ...wallKeys.map((k) => numS(`${get(`envelope.walls.${k}.label`) || k}: wall U`, `envelope.walls.${k}.u`, 0, 1, 0.01, 2, { compact: true })),
          h('ul', { class: 'warns', id: 'envNote' }),
        ]),
      ]),
    };
  }

  /* ==========================================================================
     View tab
     ========================================================================== */
  const VIEW_IDS = [['3d', '3D', 'axon'], ['N', 'N', 'n'], ['E', 'E', 'e'], ['S', 'S', 's'], ['W', 'W', 'w']];
  function buildDisplay() {
    const v = (k) => bs(`view.${k}`);
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Elevation', id: 'elevChips' });
    const btns = VIEW_IDS.map(([val, text, view]) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-elev': val, 'aria-pressed': 'false', onclick: () => Render.setView(view, true) }, text);
      wrap.append(b);
      return b;
    });
    const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.elev === (get('view.elevation') || '3d'))));
    return {
      children: els([
        sel('Style', 'view.style', opts([['model', 'Model'], ['diagram', 'Diagram']])),
        sel('Color by (diagram)', 'view.colorBy', opts([['system', 'Facade system'], ['wwr', 'Window-to-wall ratio']])),
        Controls.when(() => { sync(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'View'), wrap)]),
        Controls.toggle({ label: 'Mullions', bind: v('mullions') }),
        Controls.toggle({ label: 'Site context (ghost)', bind: v('context') }),
        Controls.toggle({ label: 'Shadows', bind: v('shadows') }),
        Controls.toggle({ label: 'Grid', bind: v('grid') }),
        Controls.toggle({ label: 'Scale figure', bind: v('figure') }),
        Controls.group(els([degS('Sun azimuth', 'view.sun.azimuth', 0, 360, { hardMin: 0, hardMax: 360 }), degS('Sun altitude', 'view.sun.altitude', 3, 90, { hardMin: 3, hardMax: 90 })])),
        Controls.help('Keys 1 to 6 jump to Axon, N, E, S, W and Plan. D switches Model and Diagram. An elevation view is flat and matches the DXF sheet. Escape clears the selection.'),
      ]),
    };
  }

  const TABS = [
    { id: 'massing', title: 'Massing' },
    { id: 'facade', title: 'Facade' },
    { id: 'checks', title: 'Checks' },
    { id: 'view', title: 'View' },
  ];
  const SECTIONS = [
    { id: 'source', tab: 'massing', title: 'Source', open: true, build: buildSource },
    { id: 'standalone', tab: 'massing', title: 'Standalone massing', open: true, build: buildStandalone },
    { id: 'zones', tab: 'massing', title: 'Zones', open: true, build: buildZones },
    { id: 'street', tab: 'massing', title: 'Street faces', build: buildStreet },
    { id: 'zone-base', tab: 'facade', title: 'Base zone', open: true, build: () => zoneSection('base') },
    { id: 'zone-middle', tab: 'facade', title: 'Middle zone', open: true, build: () => zoneSection('middle') },
    { id: 'zone-top', tab: 'facade', title: 'Top zone', build: () => zoneSection('top') },
    { id: 'zone-ranges', tab: 'facade', title: 'Level ranges', build: buildRangeZones },
    { id: 'balconies', tab: 'facade', title: 'Balconies', open: true, build: buildBalconies },
    { id: 'fins', tab: 'facade', title: 'Fins', build: buildFins },
    { id: 'shades', tab: 'facade', title: 'Shades', build: buildShades },
    { id: 'bands', tab: 'facade', title: 'Bands', build: buildBands },
    { id: 'corners', tab: 'facade', title: 'Corners', build: buildCorners },
    { id: 'checkslist', tab: 'checks', title: 'Warnings', open: true, build: buildChecksList },
    { id: 'limits', tab: 'checks', title: 'Limits', open: true, build: buildLimits },
    { id: 'wwrtables', tab: 'checks', title: 'Window-to-wall tables', open: true, build: buildWwrTables },
    { id: 'envelope', tab: 'checks', title: 'Envelope note', build: buildEnvelope },
    { id: 'display', tab: 'view', title: 'Display', open: true, build: buildDisplay },
  ];
  const sectionCtl = {};          // id -> Controls.section result
  let activeTab = 'massing';
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

  /* ---- hooks for the face card ------------------------------------------------------- */
  /**
   * Switches to the Facade tab, opens the card of the face's zone (and its range row) with the face's orientation chosen,
   * and scrolls it into view. item: { kind: 'face', id }. Returns true when something was opened.
   */
  function openItem(item) {
    if (!item || item.kind !== 'face') return false;
    const g = D().groups.find((x) => x.id === item.id);
    if (!g) return false;
    setTab('facade');
    const direct = BASE_ZONES.includes(g.zone);
    const secId = direct ? `zone-${g.zone}` : 'zone-ranges';
    const sec = sectionCtl[secId];
    if (!sec) return false;
    if (!sec.isOpen()) { sec.setOpen(true); rememberSection(secId, true); }
    let target = sec.el;
    if (direct) {
      if (zoneApi[g.zone]) zoneApi[g.zone].setTarget(g.orientation);
    } else {
      const i = (get('zones.ranges') || []).findIndex((r) => r.id === g.zone);
      const row = zoneApi.rangesList && i >= 0 ? zoneApi.rangesList.openAt(i) : null;
      if (row) target = row;
      if (zoneApi[`range:${i}`]) zoneApi[`range:${i}`].setTarget(g.orientation);
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

  /** The Export menu: Image, AI-ready image, AI Prompts, the image overlay choices (a sub-view), and the files. No Send item in version 1. */
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
        item('miDxf', 'Elevations (.dxf)', 'Four elevation sheets with panels, glass and balconies', () => SketchupExport.dxf()),
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

    // Model / Diagram toggle: a working material switch.
    const seg = $('styleToggle');
    const mk = (value, text) => h('button', { type: 'button', 'data-style': value, 'aria-pressed': 'false', onclick: () => Store.set('view.style', value, { live: false }) }, text);
    seg.append(mk('model', 'Model'), mk('diagram', 'Diagram'));
    const syncStyle = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === Store.get('view.style') ? 'true' : 'false'));
    Store.subscribe(syncStyle); syncStyle();

    const proj = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnProject', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Project: new, open, import, export', 'aria-label': 'Project menu', onclick: () => ProjectUI.openMenu(proj) },
      h('span', { html: ICONS.folder, style: 'display:contents' }), h('span', { class: 'btn-text', id: 'projLabel' }, 'Project'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbProject').append(proj);

    const exp = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnExport', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Export: image, AI-ready image, AI prompts, SketchUp, elevations DXF, JSON', 'aria-label': 'Export menu', onclick: () => openExportMenu(exp) },
      h('span', { html: ICONS.export, style: 'display:contents' }), h('span', { class: 'btn-text' }, 'Export'), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbExport').append(exp);

    $('tbHelp').append(h('button', { class: 'btn icon', type: 'button', id: 'btnHelp', title: 'Help', 'aria-label': 'Help', html: ICONS.help, onclick: () => Help.toggle() }));
  }

  /* ---- preset views ------------------------------------------------------------------ */
  const ELEV_OF = { n: 'N', e: 'E', s: 'S', w: 'W' };
  function buildViews() {
    const nav = $('views');
    const items = [['axon', 'Axon'], ['n', 'N'], ['e', 'E'], ['s', 'S'], ['w', 'W'], ['plan', 'Plan']];
    const labels = { axon: 'Axonometric view', n: 'North elevation', e: 'East elevation', s: 'South elevation', w: 'West elevation', plan: 'Plan view' };
    for (const [id, text] of items) nav.append(h('button', { type: 'button', 'data-view': id, 'aria-pressed': 'false', title: labels[id], 'aria-label': labels[id], onclick: () => Render.setView(id, true) }));
    nav.querySelectorAll('button').forEach((b, i) => { b.textContent = items[i][1]; });
    // The state's view.elevation follows the camera preset (an elevation preset is an orthographic elevation); it joins the last undo step.
    Render.onViewChange((active) => {
      nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === active ? 'true' : 'false'));
      const want = ELEV_OF[active] || null;
      if ((Store.get('view.elevation') || null) !== want) Store.set('view.elevation', want, { merge: true });
    });
    // A loaded option, an undo or an import that changes the elevation moves the camera.
    Store.subscribe((s, info) => {
      if (!info || !['replace', 'undo', 'redo'].includes(info.kind) || !Render.ready() || Render.comparing()) return;
      const e = s.view.elevation, p = Render.info().preset;
      if (e && p !== e.toLowerCase()) Render.setView(e.toLowerCase(), false);
      else if (!e && ELEV_OF[p]) Render.setView('axon', false);
    });
  }

  /* ---- metrics + warnings HUD ---------------------------------------------------------- */
  function buildHud() {
    const hud = $('hud');
    const open = !!prefs.hudOpen;                      // remembered: expanded or compact
    hud.dataset.collapsed = open ? 'false' : 'true';
    hud.innerHTML = `
      <button class="hud-toggle" id="hudToggle" type="button" aria-expanded="${open}" aria-controls="hudBody" title="Show or hide all metrics">
        <span class="hud-top">
          <span class="label">Facade</span>
          <span class="hud-badge" id="hudBadge" data-n="0" title="Warnings">0 warnings</span>
          ${CARET_SVG}
        </span>
        <span class="hud-core">
          <span class="m"><span class="k">WWR</span><span class="v" id="mWwr">-<small id="mWwrSub"></small></span></span>
          <span class="m"><span class="k">Worst orientation</span><span class="v" id="mWorst">-</span></span>
          <span class="m"><span class="k">Ground transparency</span><span class="v" id="mTrans">-<small id="mTransSub"></small></span></span>
          <span class="m"><span class="k">Balconies</span><span class="v" id="mBalc">-</span></span>
        </span>
      </button>
      <div class="hud-body" id="hudBody">
        <dl class="metrics compact">
          <div class="m"><dt>Facade area</dt><dd id="mWall">-</dd></div>
          <div class="m"><dt>Glazing area</dt><dd id="mGlaz">-</dd></div>
          <div class="m"><dt>Balcony area</dt><dd id="mBalcArea">-</dd></div>
          <div class="m"><dt>Levels</dt><dd id="mLevels">-</dd></div>
          <div class="m"><dt>Height</dt><dd id="mHeight">-</dd></div>
          <div class="m"><dt>Face groups</dt><dd id="mFaces">-</dd></div>
        </dl>
        <div class="sec" id="hudOrient"><div class="label">Window-to-wall by orientation</div><dl class="kv" id="hudOrientList"></dl></div>
        <div class="sec" id="hudPf"><div class="label">Shade projection factor</div><dl class="kv" id="hudPfList"></dl></div>
        <div class="sec" id="hudExp"><div class="label">Sun exposure (most exposed = 1)</div><dl class="kv" id="hudExpList"></dl></div>
        <p class="help caution" id="hudCaution">${WWR_CAUTION}</p>
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
    if (!list) return;
    list.textContent = '';
    for (const [k, v, cls] of rows) list.append(h('dt', null, k), h('dd', cls ? { class: cls } : null, v));
  }

  function updateHud(d) {
    const m = d.hud, st = Store.raw();
    setText('mWwr', pct1(m.wwr));
    $('mWwrSub').textContent = ` of ${pct1(m.limit)}`;
    $('mWwr').classList.toggle('bad', m.over);
    setText('mWorst', m.worst ? `${m.worst.o} ${pct1(m.worst.wwr)}` : '-');
    $('mWorst').classList.toggle('bad', !!m.worst && m.worst.wwr > m.limit + 1e-9);
    setText('mTrans', m.transparency == null ? (d.street.length ? '-' : 'n/a') : pct1(m.transparency));
    $('mTransSub').textContent = m.transparency == null ? '' : (m.target == null ? ' target off' : ` target ${pct1(m.target)}`);
    $('mTrans').classList.toggle('bad', m.targetMet === false);
    setText('mBalc', Units.formatInt(m.balconies));
    setText('mWall', Units.formatArea(m.wall));
    setText('mGlaz', Units.formatArea(m.glazing));
    setText('mBalcArea', Units.formatArea(m.balconyArea));
    setText('mLevels', Units.formatInt(m.levels));
    setText('mHeight', m.height ? Units.formatFeetInches(m.height) : '-');
    setText('mFaces', Units.formatInt(m.faces));

    kvRows($('hudOrientList'), CONFIG.orientations.map((o) => {
      const b = m.byOrientation[o] || { wall: 0, glazing: 0, wwr: 0 };
      return [CONFIG.orientationLabels[o], b.wall > 0 ? `${pct1(b.wwr)} · ${Units.formatArea(b.glazing)} of ${Units.formatArea(b.wall)}` : 'no wall', b.wall > 0 && b.wwr > m.limit + 1e-9 ? 'tgt-neg' : ''];
    }));
    const pf = m.projection || [];
    $('hudPf').hidden = !pf.length;
    kvRows($('hudPfList'), pf.slice(0, 12).map((r) => [`${r.orientation} · ${zoneName(r.zone)} · ${(CONFIG.systemLabels[r.system] || r.system).toLowerCase()}`, r.pf.toFixed(2)]));
    $('hudExp').hidden = !m.exposure;
    if (m.exposure) kvRows($('hudExpList'), CONFIG.orientations.map((o) => [CONFIG.orientationLabels[o], Units.formatRatio(m.exposure[o] == null ? 0 : m.exposure[o], 2)]));

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
    return h('li', { class: `warn-${w.level}`, 'data-warn': w.id || '' }, w.text);
  }

  /** The small readouts inside the panel sections. */
  function updateNotes(d) {
    const st = Store.raw(), m = d.hud;
    const sn = $('sourceNote');
    if (sn) {
      const info = ProjectUI.massingInfo();
      const tw = d.warnings.find((w) => w.id === 'tower-no-levels' || w.id === 'no-project-massing' || (st.source === 'project' && w.id === 'no-levels'));
      sn.textContent = tw ? tw.text : (st.source === 'project' ? `Project massing: ${info.levels} level${info.levels === 1 ? '' : 's'}${d.rotation ? `, rotated ${Math.round(d.rotation)}°` : ''}.` : '');
      sn.hidden = !sn.textContent;
      sn.classList.toggle('caution', !!tw);
    }
    const mn = $('massNote');
    if (mn) mn.textContent = d.levels.length ? `${m.levels} level${m.levels === 1 ? '' : 's'}, ${Units.formatFeetInches(m.height)} high, ${m.faces} face group${m.faces === 1 ? '' : 's'}.` : 'No levels to show.';
    const stn = $('streetNote');
    if (stn) stn.textContent = d.street.length ? `Street faces: ${d.street.join(', ')}.` : 'No street faces.';
    for (const el of document.querySelectorAll('[data-zone-info]')) {
      const key = el.dataset.zoneInfo;
      const zid = key.startsWith('range:') ? ((st.zones.ranges || [])[Number(key.slice(6))] || {}).id : key;
      const gs = d.groups.filter((g) => g.zone === zid);
      const lv = d.levels.filter((l) => gs.some((g) => l.index >= g.levelFrom && l.index <= g.levelTo));
      const zi = m.zones[zid];
      el.textContent = gs.length ? `${lv.length} level${lv.length === 1 ? '' : 's'}, ${gs.length} face group${gs.length === 1 ? '' : 's'}${zi ? `, WWR ${pct1(zi.wwr)}` : ''}.` : 'No levels in this zone for the current massing.';
    }
    const bn = $('balconyNote');
    if (bn) bn.textContent = `${m.balconies} balcon${m.balconies === 1 ? 'y' : 'ies'}, ${Units.formatArea(m.balconyArea)}.`;
    const cw = $('checksWarnings');
    if (cw) { cw.textContent = ''; if (!d.warnings.length) cw.append(h('li', { class: 'none' }, 'No warnings')); for (const w of d.warnings) cw.append(warnItem(w)); }
    const wn = $('wwrNote');
    if (wn) wn.textContent = `Now ${pct1(m.wwr)} overall${m.over ? ', above the check value' : ''}.`;
    const tn = $('transNote');
    if (tn) tn.textContent = m.transparency == null ? 'No street faces, so no ground transparency.' : `Ground transparency ${pct1(m.transparency)}${m.target == null ? ' (no target set)' : m.targetMet ? `, at or above the ${pct1(m.target)} target` : `, below the ${pct1(m.target)} target`}.`;
    const tbl = (o) => [CONFIG.orientationLabels[o] || o, '', ''];
    kvRows($('wwrOrient'), CONFIG.orientations.map((o) => { const b = m.byOrientation[o]; return [CONFIG.orientationLabels[o], b.wall > 0 ? `${pct1(b.wwr)} · ${Units.formatArea(b.glazing)} of ${Units.formatArea(b.wall)}` : 'no wall', b.wall > 0 && b.wwr > m.limit + 1e-9 ? 'tgt-neg' : '']; }));
    kvRows($('wwrZone'), Object.keys(m.zones).map((z) => [zoneName(z), `${pct1(m.zones[z].wwr)} · ${Units.formatArea(m.zones[z].glazing)} of ${Units.formatArea(m.zones[z].wall)}`]));
    kvRows($('wwrSystem'), CONFIG.systemOrder.filter((k) => m.systems[k]).map((k) => [CONFIG.systemLabels[k], `${pct1(m.systems[k].wwr)} · ${Units.formatArea(m.systems[k].glazing)} of ${Units.formatArea(m.systems[k].wall)}`]));
    const en = $('envNote');
    if (en) { en.textContent = ''; const lines = (d.metrics && d.metrics.envelope) || []; for (const t of lines) en.append(h('li', { class: 'none' }, t)); }
    syncPick();
  }

  /* ---- color legend (Diagram style) ------------------------------------------------------ */
  function updateLegend(d) {
    const box = $('legend');
    const st = Store.raw(), v = st.view;
    if (v.style !== 'diagram' || Render.comparing()) { box.hidden = true; return; }
    const rows = [];
    if (v.colorBy === 'wwr') {
      const e = CONFIG.wwrEdges, p = (x) => `${Math.round(x * 100)}%`;
      const labels = [`Under ${p(e[0])}`, `${p(e[0])} to ${p(e[1])}`, `${p(e[1])} to ${p(e[2])}`, `${p(e[2])} to ${p(e[3])}`, `Over ${p(e[3])}`];
      CONFIG.wwrColors.forEach((c, i) => rows.push([c, labels[i], `wwr-${i}`]));
    } else {
      const used = new Set((d && d.faces || []).map((f) => (f.rule && f.rule.system) || 'punched'));
      for (const k of CONFIG.systemOrder) if (used.has(k)) rows.push([CONFIG.systemColors[k], CONFIG.systemLabels[k], `sys-${k}`]);
    }
    if (d && d.street.length) rows.push([CONFIG.streetColor, 'Street face', 'street']);
    const key = JSON.stringify([rows, v.colorBy]);
    box.hidden = !rows.length;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    box.append(h('div', { class: 'label' }, v.colorBy === 'wwr' ? 'Window-to-wall ratio' : 'Facade system'));
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
    setTab(TABS.some((t) => t.id === prefs.tab) ? prefs.tab : 'massing', { remember: false });
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
    // hooks for the face card and the street pick mode
    openItem, setTab, activeTab: () => activeTab, tabs: () => TABS.map((t) => t.id), setStreetPick,
    setHudOpen, hudOpen: () => $('hud').dataset.collapsed === 'false', sections: () => SECTIONS.map((s) => ({ id: s.id, tab: s.tab })),
    zoneTarget: (zone) => (zoneApi[zone] ? zoneApi[zone].target() : null),
  };
})();

/* SLOT: ai-prompts */
/* Filled: the entry is the AI Prompts item (#miAiPrompts) in the Export menu (UI.openExportMenu above); the panel and its logic are in 08b_prompts.js. */
