/* ==========================================================================
   UI
   Tower-specific panels, top bar, metrics HUD, preset view buttons, sheet.
   ========================================================================== */
const ICONS = {
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
  compare: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  option: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M3 5l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const UI_STORAGE_KEY = 'towergen.ui.v1';

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
  const pctS = (label, path, min, max, extra = {}) => Controls.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: -95, hardMax: 500,
    format: (v) => `${round1(v)}%`, inputMode: 'decimal', ...extra,
  });
  const fracS = (label, path) => Controls.slider({   // 0..1 stored, shown as percent of height
    label, bind: Controls.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => v / 100), min: 0, max: 100, step: 1, hardMin: 0, hardMax: 100,
    format: (v) => `${round1(v)}%`, inputMode: 'decimal',
  });
  const sel = (label, path, options, bind) => Controls.select({ label, bind: bind || bs(path), options });
  const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const programOptions = () => Object.entries(CONFIG.programs).filter(([k]) => k !== 'mechanical').map(([k, v]) => ({ value: k, label: v.label }));
  const get = (path) => Store.get(path);
  const levels = () => Derived.get().floors.length;
  const els = (list) => list.map((c) => c.el || c);

  /* ---- shape editor (podium and segments) --------------------------------------- */
  const SHAPE_TYPES = opts([['rect', 'Rectangle'], ['square', 'Square'], ['circle', 'Circle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['L', 'L-shape'], ['U', 'U-shape'], ['polygon', 'Custom polygon']]);
  function shapeTypeBind(prefix) {
    return {
      get: () => get(`${prefix}.type`),
      set: (v) => {
        const sh = deepClone(get(prefix));
        sh.type = v;
        const w = num(sh.w, 100), d = num(sh.d, 100);
        if ((v === 'L' || v === 'U') && !(sh.arm > 0)) sh.arm = Math.round(0.4 * Math.min(w, d));
        if (v === 'polygon' && (!Array.isArray(sh.points) || sh.points.length < 3)) sh.points = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
        Store.set(prefix, sh, { live: false });
      },
      commit: () => {},
    };
  }
  function shapeControls(prefix, lim = 400) {
    const type = () => get(`${prefix}.type`);
    const is = (...t) => () => t.includes(type());
    return [
      sel('Shape', null, SHAPE_TYPES, shapeTypeBind(prefix)),
      Controls.when(is('circle'), [lenS('Diameter', `${prefix}.w`, 20, lim)]),
      Controls.when(is('square'), [lenS('Side', `${prefix}.w`, 20, lim)]),
      Controls.when(is('rect', 'ellipse', 'triangle', 'L', 'U'), [lenS('Width', `${prefix}.w`, 20, lim), lenS('Depth', `${prefix}.d`, 20, lim)]),
      Controls.when(is('rect', 'square'), [lenS('Corner radius', `${prefix}.radius`, 0, 60, { hardMin: 0 })]),
      Controls.when(is('L', 'U'), [lenS('Arm width', `${prefix}.arm`, 10, 150)]),
      Controls.when(is('polygon'), [Controls.points({ label: 'Corners (x, y in feet)', bind: bs(`${prefix}.points`), need: 3, needText: 'Needs at least 3 points.' })]),
    ];
  }

  /* ---- panel sections ------------------------------------------------------------- */
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
    const limitBind = Controls.mapBind(bs('site.heightLimit'), (v) => num(v, 0), (v) => Math.max(0, v));
    const children = [
      sel('Shape', null, opts([['rect', 'Rectangle'], ['polygon', 'Polygon']]), shapeBind),
      Controls.when(() => get('site.shape') !== 'polygon', [lenS('Width', 'site.width', 50, 600), lenS('Depth', 'site.depth', 50, 600)]),
      Controls.when(() => get('site.shape') === 'polygon', [Controls.points({ label: 'Site corners (x, y in feet)', bind: bs('site.points'), need: 3, needText: 'Needs at least 3 points. Until then the rectangle is used.' })]),
      Controls.slider({
        label: 'Height limit (0 = none)', bind: limitBind, min: 0, max: 800, step: 5, hardMin: 0, hardMax: 5000,
        format: (v) => (v > 0 ? Units.formatFeetInches(v) : 'None'), parse: (t) => (/^\s*(none|off)\s*$/i.test(t) ? 0 : Units.parseLength(t)), inputMode: 'text',
      }),
      Controls.label('Setbacks'),
      Controls.group(els([
        lenF('Front (south)', 'site.setbacks.front', { hardMin: 0 }), lenF('Back (north)', 'site.setbacks.back', { hardMin: 0 }),
        lenF('Left (west)', 'site.setbacks.left', { hardMin: 0 }), lenF('Right (east)', 'site.setbacks.right', { hardMin: 0 }),
      ])),
    ];
    const blocks = Controls.list({
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
    const more = [
      Controls.label('Stepback'),
      Controls.toggle({ label: 'Stepback above a height', bind: bs('site.stepback.on') }),
      Controls.when(() => get('site.stepback.on'), [lenS('Above height', 'site.stepback.aboveHeight', 20, 400), lenS('Step in by', 'site.stepback.distance', 5, 60)]).el,
      Controls.help('Above the stepback height the allowed footprint shrinks by the step-in distance on every side.'),
      Controls.label('Context blocks'),
      Controls.help('Neighbouring buildings, drawn for scale. They never change any number.'),
      blocks.el,
      h('div', { class: 'add-row' }, Controls.button('Surround', () => {
        Store.set('context.blocks', surroundBlocks(Store.raw()), { live: false });
        if (!get('context.show')) Store.set('context.show', true, { live: false });
      }), h('span', { class: 'help', style: 'margin:0' }, 'One block on each side of the site.')),
    ].map((x) => x.el || x);
    return { children: els(children), more };
  }

  function buildPodium() {
    const on = () => !!get('podium.on');
    return {
      children: [
        Controls.toggle({ label: 'Podium', bind: bs('podium.on') }).el,
        Controls.when(on, [
          intS('Floors', 'podium.floors', 1, 12, { hardMax: 100 }),
          lenS('Ground floor-to-floor', 'podium.groundFtf', 10, 40, { step: 0.5, hardMin: 6, hardMax: 100 }),
          lenS('Floor-to-floor', 'podium.ftf', 8, 30, { step: 0.5, hardMin: 6, hardMax: 100 }),
          ...shapeControls('podium.shape', 600),
        ]).el,
      ],
      more: [
        Controls.when(on, [
          Controls.label('Offset from the site center'),
          Controls.group(els([lenF('Offset x (east)', 'podium.offset.x', { hardMin: -MAXD }), lenF('Offset y (north)', 'podium.offset.y', { hardMin: -MAXD })])),
          sel('Ground floor program', 'podium.program', programOptions()),
          sel('Upper floors program', 'podium.upperProgram', programOptions()),
        ]).el,
      ],
    };
  }

  const CURVES = opts([['linear', 'Linear'], ['eased', 'Eased']]);
  function buildSegments() {
    const list = Controls.list({
      bind: bs('segments'), addLabel: 'Add segment', min: 1,
      title: (i, g) => `Segment ${i + 1} · ${g.floors} fl · ${(CONFIG.programs[g.program] || {}).label || g.program}`,
      make: (arr) => { const s = deepClone(arr[arr.length - 1] || defaultSegment()); s.floors = 10; return s; },
      render: (i) => {
        const p = `segments.${i}`;
        return {
          children: els([
            intS('Floors', `${p}.floors`, 1, 150),
            lenS('Floor-to-floor', `${p}.ftf`, 8, 30, { step: 0.5, hardMin: 6, hardMax: 100 }),
            sel('Program', `${p}.program`, programOptions()),
            ...shapeControls(`${p}.shape`, 400),
          ]),
          more: els([
            Controls.label('Shift'),
            Controls.group(els([lenF('Offset x (east)', `${p}.offset.x`, { hardMin: -MAXD }), lenF('Offset y (north)', `${p}.offset.y`, { hardMin: -MAXD })])),
            degS('Rotation', `${p}.rotation`, -180, 180),
            Controls.label('Taper (change bottom to top)'),
            pctS('Taper x', `${p}.taper.x`, -60, 60), pctS('Taper y', `${p}.taper.y`, -60, 60),
            sel('Taper curve', `${p}.taper.curve`, CURVES),
            Controls.label('Twist'),
            degS('Twist (total)', `${p}.twist.deg`, -180, 180),
            fracS('Twist starts at height', `${p}.twist.start`), fracS('Twist ends at height', `${p}.twist.end`),
            sel('Twist curve', `${p}.twist.curve`, CURVES),
            Controls.label('Lean (movement at the top)'),
            Controls.group(els([lenF('Lean x (east)', `${p}.lean.x`, { hardMin: -MAXD }), lenF('Lean y (north)', `${p}.lean.y`, { hardMin: -MAXD })])),
          ]),
        };
      },
    });
    return { children: [Controls.help('Segments stack from bottom to top. Use the arrows to reorder them.'), list.el] };
  }

  const SIDE_OPTS = opts([['front', 'Front (south)'], ['back', 'Back (north)'], ['left', 'Left (west)'], ['right', 'Right (east)']]);
  const SIDE_CHIPS = opts([['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']]);
  const sidesText = (sides) => ((sides || []).length >= 4 || !(sides || []).length ? 'all sides' : sides.join(', '));
  function buildMoves() {
    const mid = () => Math.max(2, Math.round(levels() / 2));
    const setbacks = Controls.list({
      bind: bs('setbacks'), addLabel: 'Add setback', reorder: false, openDefault: () => true, empty: 'No setbacks.',
      title: (i, s) => `From floor ${s.floor} · in ${Units.formatFeetInches(num(s.distance, 0))} · ${sidesText(s.sides)}`,
      make: () => ({ floor: mid(), distance: 10, sides: ['front', 'back', 'left', 'right'] }),
      render: (i) => ({
        children: els([
          intS('From floor', `setbacks.${i}.floor`, 2, 150),
          lenS('Step in by', `setbacks.${i}.distance`, 0, 60, { hardMin: 0 }),
          Controls.chips({ label: 'Sides', bind: bs(`setbacks.${i}.sides`), options: SIDE_CHIPS }),
        ]),
      }),
    });
    const mech = Controls.list({
      bind: bs('mechanical'), addLabel: 'Add mechanical floor', reorder: false, openDefault: () => true, empty: 'No mechanical floors.',
      title: (i, m) => `After floor ${m.afterFloor} · ${Units.formatFeetInches(num(m.ftf, 0))}`,
      make: () => ({ afterFloor: mid(), ftf: num(get('programs.mechanical.ftf'), 16) }),
      render: (i) => ({ children: els([intS('After floor', `mechanical.${i}.afterFloor`, 1, 150), lenS('Floor-to-floor', `mechanical.${i}.ftf`, 8, 30, { step: 0.5, hardMin: 6, hardMax: 100 })]) }),
    });
    return {
      children: [
        Controls.label('Setbacks'),
        Controls.help('From the chosen floor up, the tower steps in. All four sides gives an even step. Fewer sides cut one straight edge.'),
        setbacks.el,
        Controls.label('Mechanical floors'),
        Controls.help('A mechanical floor is added after the floor you pick. It repeats the plate below, counts in GFA and adds height.'),
        mech.el,
      ],
    };
  }

  function buildCarves() {
    const mid = () => Math.max(2, Math.round(levels() / 2));
    const kind = (i) => () => get(`carves.${i}.kind`);
    const carves = Controls.list({
      bind: bs('carves'), addLabel: 'Add carve', reorder: false, openDefault: () => true, empty: 'No carves.',
      title: (i, c) => `${{ corner: 'Corner', center: 'Center', full: 'Sky gap' }[c.kind] || c.kind} · floors ${c.startFloor}–${c.endFloor}`,
      make: () => ({ startFloor: mid(), endFloor: mid() + 1, kind: 'corner', corner: 'NE', w: 30, d: 30 }),
      render: (i) => ({
        children: els([
          sel('Kind', `carves.${i}.kind`, opts([['corner', 'Corner notch'], ['center', 'Center hole'], ['full', 'Full floor (sky gap)']])),
          Controls.when(() => kind(i)() === 'corner', [sel('Corner', `carves.${i}.corner`, opts([['NE', 'North-east'], ['NW', 'North-west'], ['SE', 'South-east'], ['SW', 'South-west']]))]),
          Controls.when(() => kind(i)() !== 'full', [Controls.group(els([lenF('Width', `carves.${i}.w`), lenF('Depth', `carves.${i}.d`)]))]),
          Controls.group(els([intS('From floor', `carves.${i}.startFloor`, 1, 150, { compact: true }), intS('To floor', `carves.${i}.endFloor`, 1, 150, { compact: true })])),
        ]),
      }),
    });
    const cuts = Controls.list({
      bind: bs('cuts'), addLabel: 'Add cut', reorder: false, openDefault: () => true, empty: 'No cuts.',
      title: (i, c) => `${(c.side || 'front')[0].toUpperCase()}${(c.side || 'front').slice(1)} cut · floors ${c.startFloor}–${c.endFloor > 400 ? 'top' : c.endFloor} · ${Units.formatFeetInches(num(c.depth, 0))}`,
      make: () => ({ side: 'front', angle: 30, startFloor: 1, endFloor: Math.max(2, levels()), depth: 20 }),
      render: (i) => ({
        children: els([
          sel('Side', `cuts.${i}.side`, SIDE_OPTS),
          Controls.group(els([intS('From floor', `cuts.${i}.startFloor`, 1, 150, { compact: true }), intS('To floor', `cuts.${i}.endFloor`, 1, 150, { compact: true, hardMax: 999 })])),
          lenS('Depth at the top', `cuts.${i}.depth`, 0, 100, { hardMin: 0 }),
        ]),
      }),
    });
    return {
      children: [
        Controls.label('Carves'),
        Controls.help('Corner or center carves remove a rectangle from every floor in the range. A full carve is a sky gap: the floors keep their height and add no area.'),
        carves.el,
        Controls.label('Cuts'),
        Controls.help('A cut is a sloped plane on one side. It takes 0 ft at the first floor and the full depth at the last floor, measured from that side.'),
        cuts.el,
      ],
    };
  }

  function buildCrown() {
    const type = () => get('crown.type');
    return {
      children: els([
        sel('Type', 'crown.type', opts([['none', 'None'], ['flat', 'Flat (parapet)'], ['stepped', 'Stepped'], ['sloped', 'Sloped'], ['spire', 'Spire'], ['screen', 'Screen']])),
        Controls.when(() => !['flat', 'none'].includes(type()), [lenS('Height', 'crown.height', 0, 100, { hardMin: 0 })]),
        Controls.when(() => type() === 'stepped', [intS('Steps', 'crown.steps', 1, 8, { hardMax: 20 })]),
        Controls.when(() => type() === 'sloped', [sel('Low side', 'crown.slopeSide', SIDE_OPTS)]),
        Controls.help('A flat crown adds only a 4 ft parapet ring and no height. Every other type adds its height to the total. A crown never adds floor area.'),
      ]),
    };
  }

  function buildCore() {
    const mode = () => get('core.mode');
    return {
      children: els([
        sel('Size by', 'core.mode', opts([['percent', 'Percent of plate'], ['size', 'Fixed size']])),
        Controls.when(() => mode() === 'percent', [Controls.slider({
          label: 'Core share of the first plate', bind: bs('core.percent'), min: 5, max: 50, step: 1, hardMin: 0, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal',
        })]),
        Controls.when(() => mode() !== 'percent', [lenS('Core width', 'core.w', 10, 120), lenS('Core depth', 'core.d', 10, 120)]),
        Controls.help('One core per segment, vertical, on its first plate. A warning shows when it does not fit a plate.'),
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
      return h('div', { class: 'prog-card' },
        h('div', { class: 'prog-head' }, colorCtl.el, h('span', { class: 'grow' }, CONFIG.programs[k].label)),
        Controls.group(els([
          lenF('Floor-to-floor', `${path}.ftf`, { hardMin: 6, hardMax: 100, step: 0.5 }),
          Controls.slider({ label: 'Unit size (sf, 0 = none)', bind: unitSize, compact: true, min: 0, max: 1, step: 10, hardMin: 0, hardMax: 100000, format: (v) => (v > 0 ? Units.grouped(v) : '0'), inputMode: 'numeric' }),
        ])),
        Controls.when(() => get(`${path}.unitSize`) != null, [Controls.slider({ label: 'Unit factor (corridors, walls)', bind: factor, compact: true, min: 0, max: 1, step: 1, hardMin: 0, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal' })]).el);
    });
    return {
      children: [
        Controls.help('Units = net area of the program x unit factor / unit size. Floor-to-floor is the default for new segments and mechanical floors.'),
        ...cards,
      ],
    };
  }

  function buildTargets() {
    const num0 = (label, path, step, digits) => Controls.slider({
      label, bind: bs(path), compact: true, min: 0, max: 1, step, hardMin: 0, hardMax: 1e9,
      format: (v) => (digits ? Units.formatRatio(v, digits) : Units.grouped(Math.round(v))), inputMode: 'decimal',
    });
    return {
      children: [
        Controls.group(els([num0('GFA target (sf)', 'targets.gfa', 1000, 0), num0('FAR target', 'targets.far', 0.1, 2)])),
        Controls.help('0 means not set. The metrics panel shows how far the design is from each target.'),
      ],
    };
  }

  function buildView() {
    const v = (k) => bs(`view.${k}`);
    return {
      children: els([
        sel('Style', 'view.style', opts([['model', 'Model'], ['diagram', 'Diagram']])),
        Controls.toggle({ label: 'Floor lines', bind: v('floorLines') }),
        Controls.toggle({ label: 'Shadows', bind: v('shadows') }),
        Controls.toggle({ label: 'Show zoning envelope', bind: v('envelope') }),
        Controls.toggle({ label: 'Show context blocks', bind: bs('context.show') }),
      ]),
      more: els([
        sel('Color by (diagram)', 'view.colorBy', opts([['zone', 'Zone'], ['program', 'Program']])),
        Controls.slider({ label: 'Sun azimuth', bind: v('sun.azimuth'), min: 0, max: 360, step: 1, hardMin: 0, hardMax: 360, integer: true, format: Units.formatDeg, inputMode: 'numeric' }),
        Controls.slider({ label: 'Sun altitude', bind: v('sun.altitude'), min: 5, max: 90, step: 1, hardMin: 3, hardMax: 90, integer: true, format: Units.formatDeg, inputMode: 'numeric' }),
        Controls.toggle({ label: 'Grid', bind: v('grid') }),
        Controls.toggle({ label: 'Scale figure', bind: v('figure') }),
      ]),
    };
  }

  // Plan order (section 8.1) plus Targets.
  const SECTIONS = [
    { id: 'site', title: 'Site', open: true, build: buildSite },
    { id: 'podium', title: 'Podium', build: buildPodium },
    { id: 'segments', title: 'Segments', open: true, build: buildSegments },
    { id: 'moves', title: 'Form moves', build: buildMoves },
    { id: 'carves', title: 'Carves', build: buildCarves },
    { id: 'crown', title: 'Crown', build: buildCrown },
    { id: 'core', title: 'Core', build: buildCore },
    { id: 'programs', title: 'Programs', build: buildPrograms },
    { id: 'targets', title: 'Targets', build: buildTargets },
    { id: 'view', title: 'View', build: buildView },
  ];

  function buildPanel() {
    const host = $('sections');
    host.textContent = '';
    for (const s of SECTIONS) {
      const parts = s.build();
      const open = prefs.sections && s.id in prefs.sections ? !!prefs.sections[s.id] : !!s.open;
      host.append(Controls.section({
        id: s.id, title: s.title, open, children: parts.children, more: parts.more,
        onToggle: (isOpen) => { prefs.sections = { ...(prefs.sections || {}), [s.id]: isOpen }; saveUiPrefs(prefs); },
      }).el);
    }
  }

  /* ---- top bar -------------------------------------------------------------------- */
  const iconBtn = (icon, text, attrs = {}) => h('button', { class: 'btn has-text', type: 'button', 'aria-label': text, title: text, ...attrs },
    h('span', { html: icon, style: 'display:contents' }), h('span', { class: 'btn-text' }, text));

  function buildTopBar() {
    const name = $('optionName');
    name.value = Store.get('name') || '';
    name.addEventListener('change', () => Options.rename(name.value));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    Store.subscribe(() => { if (document.activeElement !== name) name.value = Store.get('name') || ''; });

    const optBtn = h('button', { class: 'btn has-text menu-btn', type: 'button', id: 'btnOption', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Saved options, presets and files', 'aria-label': 'Option menu', onclick: () => Options.openMenu(optBtn) },
      h('span', { html: ICONS.option, style: 'display:contents' }), h('span', { class: 'btn-text menu-name' }, 'Option'), h('span', { class: 'dot', id: 'unsavedDot', hidden: true, title: 'Unsaved changes' }), h('span', { html: ICONS.chev, style: 'display:contents' }));
    $('tbOption').append(optBtn);

    const undo = h('button', { class: 'btn icon', type: 'button', title: 'Undo (Cmd/Ctrl+Z)', 'aria-label': 'Undo', html: ICONS.undo, onclick: () => Store.undo() });
    const redo = h('button', { class: 'btn icon', type: 'button', title: 'Redo (Shift+Cmd/Ctrl+Z)', 'aria-label': 'Redo', html: ICONS.redo, onclick: () => Store.redo() });
    $('tbHistory').append(undo, redo);
    const syncHistory = () => { undo.disabled = !Store.canUndo(); redo.disabled = !Store.canRedo(); };
    Store.subscribe(syncHistory); syncHistory();

    // SLOT: ai-prompts has its hidden entry button here; it stays hidden until that panel exists.
    const aiBtn = iconBtn('', 'AI Prompts', { id: 'btnAiPrompts', hidden: true, 'aria-hidden': 'true', title: 'AI Prompts (not built yet)' });
    $('tbActions').append(
      iconBtn(ICONS.save, 'Save', { id: 'btnSave', title: 'Save this option (Cmd/Ctrl+S)', onclick: () => Options.save() }),
      iconBtn(ICONS.duplicate, 'Duplicate', { id: 'btnDuplicate', title: 'Save a copy as a new option', onclick: () => Options.duplicate() }),
      iconBtn(ICONS.compare, 'Compare', { id: 'btnCompare', title: 'Compare 2 to 4 options', 'aria-pressed': 'false', onclick: () => Compare.toggle() }),
      aiBtn,
    );

    const shotBtn = iconBtn(ICONS.camera, 'Image', { id: 'btnShot', title: 'Save an image of this view', onclick: () => Shots.take() });
    const shotMenu = h('button', { class: 'btn caret-only', type: 'button', id: 'btnShotMenu', 'aria-label': 'Image options', title: 'Choose what the image shows', 'aria-haspopup': 'true', 'aria-expanded': 'false', html: ICONS.chev, onclick: () => Shots.openMenu(shotMenu) });
    $('tbShot').append(shotBtn, shotMenu);

    // Model / Diagram toggle: a working material switch.
    const seg = $('styleToggle');
    const mk = (value, text) => h('button', { type: 'button', 'data-style': value, 'aria-pressed': 'false', onclick: () => Store.set('view.style', value, { live: false }) }, text);
    seg.append(mk('model', 'Model'), mk('diagram', 'Diagram'));
    const syncStyle = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === Store.get('view.style') ? 'true' : 'false'));
    Store.subscribe(syncStyle); syncStyle();
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
  const floorsText = (m) => {
    const z = m.floorsByZone, parts = [];
    if (z.podium) parts.push(`${z.podium} podium`);
    if (z.tower) parts.push(`${z.tower} tower`);
    if (z.mechanical) parts.push(`${z.mechanical} mech`);
    if (m.voidFloors) parts.push(`${m.voidFloors} sky gap`);
    return parts.length > 1 || m.voidFloors ? parts.join(' · ') : '';
  };
  const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
  const signed = (v, fmt) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v))}`;

  function buildHud() {
    const hud = $('hud');
    hud.dataset.collapsed = sheetQuery.matches ? 'true' : 'false';
    hud.innerHTML = `
      <button class="hud-head" type="button" aria-expanded="true" aria-controls="hudBody">
        <span class="label">Metrics</span>
        <span class="hud-summary" id="hudSummary"></span>
        ${CARET_SVG}
      </button>
      <div class="hud-body" id="hudBody">
        <div class="metric-hero"><div class="label">GFA</div><div class="v" id="mGfa">-</div></div>
        <dl class="metrics compact">
          <div class="m"><dt>FAR</dt><dd id="mFar">-</dd></div>
          <div class="m"><dt>Total height</dt><dd id="mHeight">-</dd></div>
          <div class="m"><dt>Floors</dt><dd id="mFloors">-<small id="mFloorsSub"></small></dd></div>
          <div class="m"><dt>Site area</dt><dd id="mSite">-</dd></div>
          <div class="m"><dt>Site coverage</dt><dd id="mCover">-</dd></div>
          <div class="m"><dt>Efficiency (avg)</dt><dd id="mEff">-</dd></div>
          <div class="m"><dt>Net area</dt><dd id="mNet">-</dd></div>
          <div class="m"><dt>Core area</dt><dd id="mCore">-</dd></div>
          <div class="m"><dt>Mechanical area</dt><dd id="mMech">-</dd></div>
          <div class="m"><dt>Crown height</dt><dd id="mCrown">-</dd></div>
          <div class="m wide"><dt>Tower plate area (sf)</dt>
            <dd class="triple"><div id="mPlateMin">-<span>min</span></div><div id="mPlateAvg">-<span>avg</span></div><div id="mPlateMax">-<span>max</span></div></dd></div>
        </dl>
        <div class="sec" id="hudUnits" hidden><div class="label">Units (estimate)</div><dl class="kv" id="hudUnitsList"></dl></div>
        <div class="sec" id="hudTargets" hidden><div class="label">Target check</div><dl class="kv" id="hudTargetsList"></dl></div>
        <div class="warn-block" id="warnBlock" data-n="0">
          <div class="label">Warnings <span class="count" id="warnCount">0</span></div>
          <ul class="warns" id="warnList"></ul>
        </div>
      </div>`;
    const head = hud.querySelector('.hud-head');
    head.addEventListener('click', () => {
      const collapsed = hud.dataset.collapsed !== 'true';
      hud.dataset.collapsed = collapsed ? 'true' : 'false';
      head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      Render.refreshInsets(true);
    });
    // Views are framed beside the HUD when it is open and there is room for both.
    Render.setInsetProvider(() => {
      if (hud.dataset.collapsed === 'true' || Render.comparing()) return { right: 0 };
      const vw = $('viewport').clientWidth, w = hud.offsetWidth + 24;
      return { right: vw - w >= 380 ? w : 0 };
    });
    head.setAttribute('aria-expanded', hud.dataset.collapsed === 'true' ? 'false' : 'true');
  }
  function setText(id, text) { const el = $(id); if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = text; else el.prepend(document.createTextNode(text)); }
  function updateHud(d) {
    const m = d.metrics;
    setText('mGfa', Units.formatArea(m.gfa));
    setText('mFar', Units.formatRatio(m.far));
    setText('mHeight', Units.formatFeetInches(m.totalHeight));
    setText('mFloors', Units.formatInt(m.floorCount));
    $('mFloorsSub').textContent = floorsText(m);
    setText('mSite', Units.formatArea(m.siteArea));
    setText('mCover', pct1(m.siteCoverage));
    setText('mEff', pct1(m.efficiencyAvg));
    setText('mNet', Units.formatArea(m.netArea));
    setText('mCore', Units.formatArea(m.coreArea));
    setText('mMech', Units.formatArea(m.mechanicalArea));
    setText('mCrown', m.crownHeight > 0 ? Units.formatFeetInches(m.crownHeight) : 'none');
    setText('mPlateMin', Units.formatInt(m.plateMin));
    setText('mPlateAvg', Units.formatInt(m.plateAvg));
    setText('mPlateMax', Units.formatInt(m.plateMax));
    $('hudSummary').textContent = `${Units.formatArea(m.gfa)} · FAR ${Units.formatRatio(m.far)}`;

    // Units per program
    // Dwelling units and hotel keys first, then their total, then parking spaces on their own (never added in).
    const ub = unitBreakdown(m);
    const ul = $('hudUnitsList');
    ul.textContent = '';
    const addUnitRow = (r) => {
      const bp = r.bp;
      ul.append(h('dt', { title: `Net ${Units.formatArea(bp.net)} x ${Math.round(bp.unitFactor * 100)}% / ${Units.formatInt(bp.unitSize)} sf` }, r.label),
        h('dd', null, r.kind === 'spaces' ? `${Units.formatInt(r.count)} spaces` : `${Units.formatInt(r.count)}`, h('small', null, ` @ ${Units.formatInt(r.size)} sf`)));
    };
    ub.dwelling.forEach(addUnitRow);
    if (ub.hasTotal && ub.rows.length > 1) ul.append(h('dt', { title: 'Residential units plus hotel keys. Parking spaces are not included.' }, 'Total'), h('dd', null, Units.formatInt(ub.total)));
    ub.spaces.forEach(addUnitRow);
    $('hudUnits').hidden = !ub.rows.length;

    // Target check
    const tl = $('hudTargetsList');
    tl.textContent = '';
    const addTarget = (label, t, fmt) => {
      if (!t) return;
      tl.append(h('dt', null, `${label} (target ${fmt(t.target)})`),
        h('dd', { class: t.diff > 0 ? 'tgt-pos' : 'tgt-neg' }, `${signed(t.diff, fmt)} (${signed(t.pct, (v) => `${v.toFixed(1)}%`)})`));
    };
    addTarget('GFA', m.target.gfa, (v) => Units.formatArea(v));
    addTarget('FAR', m.target.far, (v) => Units.formatRatio(v, 2));
    $('hudTargets').hidden = !tl.children.length;

    const list = $('warnList');
    list.textContent = '';
    if (!d.warnings.length) list.append(h('li', { class: 'none' }, 'No warnings'));
    for (const w of d.warnings) list.append(h('li', { class: `warn-${w.level}` }, w.text));
    $('warnCount').textContent = String(d.warnings.length);
    $('warnBlock').dataset.n = String(d.warnings.length);
  }

  /* ---- bottom sheet (iPad portrait / narrow) -------------------------------------------- */
  function initSheet() {
    const app = $('app'), grabber = $('grabber');
    const GRAB = 44;
    const total = () => app.clientHeight;
    const snaps = () => [GRAB + 8, Math.round(total() * 0.42), Math.round(total() * 0.86)];
    const setH = (px) => app.style.setProperty('--sheet-h', `${Math.round(clamp(px, GRAB + 8, total() * 0.9))}px`);
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
  }

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
    buildViews();
    buildHud();
    initSheet();
    initKeys();
    Store.subscribe(() => Controls.refreshAll());
    Controls.refreshAll();
    Render.onRebuild(updateHud);
    // A viewport that is not WebGL-capable still gets numbers.
    updateHud(Derived.get());
  }
  return { init, updateHud, rebuildPanel: () => { Controls.refreshAll(); } };
})();

/* SLOT: ai-prompts */
/* Reserved for the future "AI Prompts" panel. Nothing is built here on purpose.
   Its entry point is the hidden #btnAiPrompts button in the top bar (UI.buildTopBar):
   remove the `hidden` attribute and add a click handler when the panel exists. */
