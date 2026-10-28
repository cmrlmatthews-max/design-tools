/* ==========================================================================
   TOWER: panels
   Port of the tabs in build/tower/08_ui.js. The four tabs become four panel groups (Form, Program, Site, View);
   each holds accordion sections built with the shared Controls kit. The prompt panel is in prompts-ui.js.
   Not ported: the Sun Study section (color, floor lines, shadows and sun are app-wide, in the shell View panel), image overlay choices, typed-base UI polish, the pin button.
   ========================================================================== */
import { Units } from '../../core/ui-kit.js';
import { CONFIG, num, clamp, deepClone, defaultSegment, surroundBlocks, unitBreakdown } from './state.js';

const MAXD = CONFIG.limits.maxDim;
const UI_KEY = 'cmrlm.tower.ui';
const round1 = (v) => String(Math.round(v * 10) / 10);
const readUi = () => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } };
const writeUi = (p) => { try { localStorage.setItem(UI_KEY, JSON.stringify(p)); } catch (e) { /* the choices last for this visit */ } };

export function createPanels(T) {
  const { ctx, store } = T;
  const { h, Pop, Toast } = ctx.ui;
  const C = ctx.ui.Controls.create();            // this tool's own refresh registry
  const prefs = readUi();
  const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const bs = (path) => C.bindStore(store, path);
  const get = (path) => store.get(path);
  const els = (list) => list.map((c) => c.el || c);
  const sections = {};                            // id -> section controller (to open one from the selection)
  const lists = {};                               // id -> row list controller
  // Sync closures of the panels now on screen, per panel. A panel build replaces its own list, so rebuilds do not pile up.
  const syncGroups = {};
  let swatchSyncs = [];
  const allSyncs = () => Object.values(syncGroups).flat();

  /* ---- control shortcuts ---- */
  const lenS = (label, path, min, max, extra = {}) => C.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: MAXD,
    format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  const lenF = (label, path, extra = {}) => lenS(label, path, 0, 1, { compact: true, ...extra });
  const intS = (label, path, min, max, extra = {}) => C.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: CONFIG.limits.maxFloors, integer: true,
    format: Units.formatInt, inputMode: 'numeric', ...extra,
  });
  const degS = (label, path, min, max, extra = {}) => C.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: -3600, hardMax: 3600,
    format: (v) => `${round1(v)}°`, inputMode: 'decimal', ...extra,
  });
  const pctS = (label, path, min, max, extra = {}) => C.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: -95, hardMax: 500,
    format: (v) => `${round1(v)}%`, inputMode: 'decimal', ...extra,
  });
  const fracS = (label, path) => C.slider({
    label, bind: C.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => v / 100), min: 0, max: 100, step: 1, hardMin: 0, hardMax: 100,
    format: (v) => `${round1(v)}%`, inputMode: 'decimal',
  });
  const sel = (label, path, options, bind) => C.select({ label, bind: bind || bs(path), options });
  const programOptions = () => Object.entries(CONFIG.programs).filter(([k]) => k !== 'mechanical').map(([k, v]) => ({ value: k, label: v.label }));
  const levels = () => T.derived.get().floors.length;
  const progColor = (k) => ((get(`programs.${k}`) || {}).color) || ((CONFIG.programs[k] || {}).color) || '#999';

  /** Builds an accordion section and files it. */
  function section(id, title, parts, { open = false, headExtra, when } = {}) {
    const wasOpen = prefs.sections && id in prefs.sections ? !!prefs.sections[id] : open;
    const sec = C.section({
      id: `tower-${id}`, title, open: wasOpen, children: parts.children, more: parts.more, headExtra,
      onToggle: (isOpen) => { prefs.sections = { ...(prefs.sections || {}), [id]: isOpen }; writeUi(prefs); },
    });
    sections[id] = sec;
    if (when) { const sync = () => { sec.el.hidden = !when(); }; swatchSyncs.push(sync); sync(); }
    return sec.el;
  }

  /* ---- shapes ---- */
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
        store.set(prefix, sh, { live: false });
      },
      commit: () => {},
    };
  }
  function shapeControls(prefix, lim = 400) {
    const type = () => get(`${prefix}.type`);
    const is = (...t) => () => t.includes(type());
    return [
      sel('Shape', null, SHAPE_TYPES, shapeTypeBind(prefix)),
      C.when(is('circle'), [lenS('Diameter', `${prefix}.w`, 20, lim)]),
      C.when(is('square'), [lenS('Side', `${prefix}.w`, 20, lim)]),
      C.when(is('rect', 'ellipse', 'triangle', 'L', 'U'), [lenS('Width', `${prefix}.w`, 20, lim), lenS('Depth', `${prefix}.d`, 20, lim)]),
      C.when(is('rect', 'square'), [lenS('Corner radius', `${prefix}.radius`, 0, 60, { hardMin: 0 })]),
      C.when(is('L', 'U'), [lenS('Arm width', `${prefix}.arm`, 10, 150)]),
      C.when(is('polygon'), [C.points({ label: 'Corners (x, y in feet)', bind: bs(`${prefix}.points`), need: 3, needText: 'Needs at least 3 points.' })]),
    ];
  }

  /* ==================================================================== FORM */
  let offOption = null;
  function optionSection() {
    const name = C.text({ label: 'Option name', bind: { get: () => get('name') || '', set: (v) => T.options.rename(v), commit: () => {} }, maxLength: 60 });
    const menuBtn = h('button', { class: 'btn outline sm', type: 'button', id: 'tower-optionMenu', 'aria-haspopup': 'true', onclick: (e) => Pop.open(e.currentTarget, T.options.menuItems()) }, 'Options and presets');
    const saveBtn = h('button', { class: 'btn solid sm', type: 'button', id: 'tower-optionSave', onclick: () => T.options.save() }, 'Save');
    const dot = h('span', { class: 'help', id: 'tower-optionDirty', style: 'margin:0' });
    const sync = () => { dot.textContent = T.options.dirty() ? 'Unsaved changes.' : 'Saved.'; };
    swatchSyncs.push(sync); sync();
    // one listener for the Option section: a rebuild replaces the last one
    if (offOption) offOption();
    offOption = T.options.onChange(() => { if (dot.isConnected) { sync(); C.refreshAll(); } });
    return section('option', 'Option', {
      children: [name.el, h('div', { class: 'btn-row' }, saveBtn, menuBtn), dot,
        h('p', { class: 'help' }, 'The working copy saves itself. Save keeps a named option you can open later.')],
    }, { open: true });
  }

  function podiumSection() {
    const on = () => !!get('podium.on');
    const box = h('span', { class: 'acc-sw', 'aria-hidden': 'true' }, h('span', { class: 'sw' }), h('span', { class: 'sw' }));
    const syncSw = () => {
      box.hidden = !on();
      if (!on()) return;
      box.children[0].style.background = progColor(get('podium.program'));
      box.children[1].style.background = progColor(get('podium.upperProgram'));
    };
    swatchSyncs.push(syncSw);
    return section('podium', 'Podium', {
      children: [
        C.toggle({ label: 'Podium', bind: bs('podium.on') }).el,
        C.when(on, [
          intS('Floors', 'podium.floors', 1, 12, { hardMax: 100 }),
          lenS('Ground floor-to-floor', 'podium.groundFtf', 10, 40, { step: 0.5, hardMin: 6, hardMax: 100 }),
          lenS('Floor-to-floor', 'podium.ftf', 8, 30, { step: 0.5, hardMin: 6, hardMax: 100 }),
          ...shapeControls('podium.shape', 600),
        ]).el,
      ],
      more: [C.when(on, [
        C.label('Offset from the site center'),
        C.group(els([lenF('Offset x (east)', 'podium.offset.x', { hardMin: -MAXD }), lenF('Offset y (north)', 'podium.offset.y', { hardMin: -MAXD })])),
        sel('Ground floor program', 'podium.program', programOptions()),
        sel('Upper floors program', 'podium.upperProgram', programOptions()),
      ]).el],
    }, { open: true, headExtra: box });
  }

  const CURVES = opts([['linear', 'Linear'], ['eased', 'Eased']]);
  function segmentsSection() {
    const list = lists.segments = C.list({
      bind: bs('segments'), addLabel: 'Add segment', min: 1,
      swatch: (i, g) => progColor(g.program),
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
            C.label('Shift'),
            C.group(els([lenF('Offset x (east)', `${p}.offset.x`, { hardMin: -MAXD }), lenF('Offset y (north)', `${p}.offset.y`, { hardMin: -MAXD })])),
            degS('Rotation', `${p}.rotation`, -180, 180),
            C.label('Taper (change bottom to top)'),
            pctS('Taper x', `${p}.taper.x`, -60, 60), pctS('Taper y', `${p}.taper.y`, -60, 60),
            sel('Taper curve', `${p}.taper.curve`, CURVES),
            C.label('Twist'),
            degS('Twist (total)', `${p}.twist.deg`, -180, 180),
            fracS('Twist starts at height', `${p}.twist.start`), fracS('Twist ends at height', `${p}.twist.end`),
            sel('Twist curve', `${p}.twist.curve`, CURVES),
            C.label('Lean (movement at the top)'),
            C.group(els([lenF('Lean x (east)', `${p}.lean.x`, { hardMin: -MAXD }), lenF('Lean y (north)', `${p}.lean.y`, { hardMin: -MAXD })])),
          ]),
        };
      },
    });
    return section('segments', 'Segments', { children: [C.help('Segments stack from bottom to top. Use the arrows to reorder them.'), list.el] }, { open: true });
  }

  const SIDE_OPTS = opts([['front', 'Front (south)'], ['back', 'Back (north)'], ['left', 'Left (west)'], ['right', 'Right (east)']]);
  const SIDE_CHIPS = opts([['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']]);
  const sidesText = (sides) => ((sides || []).length >= 4 || !(sides || []).length ? 'all sides' : sides.join(', '));
  function movesSection() {
    const mid = () => Math.max(2, Math.round(levels() / 2));
    const setbacks = C.list({
      bind: bs('setbacks'), addLabel: 'Add setback', reorder: false, openDefault: () => true, empty: 'No setbacks.',
      title: (i, s) => `From floor ${s.floor} · in ${Units.formatFeetInches(num(s.distance, 0))} · ${sidesText(s.sides)}`,
      make: () => ({ floor: mid(), distance: 10, sides: ['front', 'back', 'left', 'right'] }),
      render: (i) => ({
        children: els([
          intS('From floor', `setbacks.${i}.floor`, 2, 150),
          lenS('Step in by', `setbacks.${i}.distance`, 0, 60, { hardMin: 0 }),
          C.chips({ label: 'Sides', bind: bs(`setbacks.${i}.sides`), options: SIDE_CHIPS }),
        ]),
      }),
    });
    const mech = C.list({
      bind: bs('mechanical'), addLabel: 'Add mechanical floor', reorder: false, openDefault: () => true, empty: 'No mechanical floors.',
      title: (i, m) => `After floor ${m.afterFloor} · ${Units.formatFeetInches(num(m.ftf, 0))}`,
      make: () => ({ afterFloor: mid(), ftf: num(get('programs.mechanical.ftf'), 16) }),
      render: (i) => ({ children: els([intS('After floor', `mechanical.${i}.afterFloor`, 1, 150), lenS('Floor-to-floor', `mechanical.${i}.ftf`, 8, 30, { step: 0.5, hardMin: 6, hardMax: 100 })]) }),
    });
    return section('moves', 'Form moves', {
      children: [
        C.label('Setbacks'),
        C.help('From the chosen floor up, the tower steps in. All four sides gives an even step. Fewer sides cut one straight edge.'),
        setbacks.el,
        C.label('Mechanical floors'),
        C.help('A mechanical floor is added after the floor you pick. It repeats the plate below, counts in GFA and adds height.'),
        mech.el,
      ],
    });
  }

  function carvesSection() {
    const mid = () => Math.max(2, Math.round(levels() / 2));
    const kind = (i) => () => get(`carves.${i}.kind`);
    const carves = lists.carves = C.list({
      bind: bs('carves'), addLabel: 'Add carve', reorder: false, openDefault: () => true, empty: 'No carves.',
      title: (i, c) => `${{ corner: 'Corner', center: 'Center', full: 'Sky gap' }[c.kind] || c.kind} · floors ${c.startFloor}–${c.endFloor}`,
      make: () => ({ startFloor: mid(), endFloor: mid() + 1, kind: 'corner', corner: 'NE', w: 30, d: 30 }),
      render: (i) => ({
        children: els([
          sel('Kind', `carves.${i}.kind`, opts([['corner', 'Corner notch'], ['center', 'Center hole'], ['full', 'Full floor (sky gap)']])),
          C.when(() => kind(i)() === 'corner', [sel('Corner', `carves.${i}.corner`, opts([['NE', 'North-east'], ['NW', 'North-west'], ['SE', 'South-east'], ['SW', 'South-west']]))]),
          C.when(() => kind(i)() !== 'full', [C.group(els([lenF('Width', `carves.${i}.w`), lenF('Depth', `carves.${i}.d`)]))]),
          C.group(els([intS('From floor', `carves.${i}.startFloor`, 1, 150, { compact: true }), intS('To floor', `carves.${i}.endFloor`, 1, 150, { compact: true })])),
        ]),
      }),
    });
    const cuts = C.list({
      bind: bs('cuts'), addLabel: 'Add cut', reorder: false, openDefault: () => true, empty: 'No cuts.',
      title: (i, c) => `${(c.side || 'front')[0].toUpperCase()}${(c.side || 'front').slice(1)} cut · floors ${c.startFloor}–${c.endFloor > 400 ? 'top' : c.endFloor} · ${Units.formatFeetInches(num(c.depth, 0))}`,
      make: () => ({ side: 'front', angle: 30, startFloor: 1, endFloor: Math.max(2, levels()), depth: 20 }),
      render: (i) => ({
        children: els([
          sel('Side', `cuts.${i}.side`, SIDE_OPTS),
          C.group(els([intS('From floor', `cuts.${i}.startFloor`, 1, 150, { compact: true }), intS('To floor', `cuts.${i}.endFloor`, 1, 150, { compact: true, hardMax: 999 })])),
          lenS('Depth at the top', `cuts.${i}.depth`, 0, 100, { hardMin: 0 }),
        ]),
      }),
    });
    return section('carves', 'Carves and cuts', {
      children: [
        C.label('Carves'),
        C.help('Corner or center carves remove a rectangle from every floor in the range. A full carve is a sky gap: the floors keep their height and add no area.'),
        carves.el,
        C.label('Cuts'),
        C.help('A cut is a sloped plane on one side. It takes 0 ft at the first floor and the full depth at the last floor, measured from that side.'),
        cuts.el,
      ],
    });
  }

  function crownSection() {
    const type = () => get('crown.type');
    return section('crown', 'Crown', {
      children: els([
        sel('Type', 'crown.type', opts([['none', 'None'], ['flat', 'Flat (parapet)'], ['stepped', 'Stepped'], ['sloped', 'Sloped'], ['spire', 'Spire'], ['screen', 'Screen']])),
        C.when(() => !['flat', 'none'].includes(type()), [lenS('Height', 'crown.height', 0, 100, { hardMin: 0 })]),
        C.when(() => type() === 'stepped', [intS('Steps', 'crown.steps', 1, 8, { hardMax: 20 })]),
        C.when(() => type() === 'sloped', [sel('Low side', 'crown.slopeSide', SIDE_OPTS)]),
        C.help('A flat crown adds only a 4 ft parapet ring and no height. Every other type adds its height to the total. A crown never adds floor area.'),
      ]),
    });
  }

  /* ================================================================= PROGRAM */
  function programsSection() {
    const cards = Object.keys(CONFIG.programs).map((k) => {
      const path = `programs.${k}`;
      const unitSize = {
        get: () => num(get(`${path}.unitSize`), 0),
        set: (v, live) => {
          const p = { ...get(path) };
          if (!(v > 0)) { p.unitSize = null; p.unitFactor = null; } else { p.unitSize = v; if (p.unitFactor == null) p.unitFactor = 1; }
          store.set(path, p, { live });
        },
        commit: () => store.commit(),
      };
      const factor = C.mapBind(bs(`${path}.unitFactor`), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100);
      const colorCtl = C.color({ label: `${CONFIG.programs[k].label} color`, bind: bs(`${path}.color`) });
      return h('div', { class: 'tower-prog-card' },
        h('div', { class: 'tower-prog-head' }, colorCtl.el, h('span', { class: 'tower-grow' }, CONFIG.programs[k].label)),
        C.group(els([
          lenF('Floor-to-floor', `${path}.ftf`, { hardMin: 6, hardMax: 100, step: 0.5 }),
          C.slider({ label: 'Unit size (sf, 0 = none)', bind: unitSize, compact: true, min: 0, max: 1, step: 10, hardMin: 0, hardMax: 100000, format: (v) => (v > 0 ? Units.grouped(v) : '0'), inputMode: 'numeric' }),
        ])),
        C.when(() => get(`${path}.unitSize`) != null, [C.slider({ label: 'Unit factor (corridors, walls)', bind: factor, compact: true, min: 0, max: 1, step: 1, hardMin: 0, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal' })]).el);
    });
    return section('programs', 'Programs', {
      children: [C.help('Units = net area of the program x unit factor / unit size. Floor-to-floor is the default for new segments and mechanical floors.'), ...cards],
    }, { open: true });
  }
  function targetsSection() {
    const num0 = (label, path, step, digits) => C.slider({
      label, bind: bs(path), compact: true, min: 0, max: 1, step, hardMin: 0, hardMax: 1e9,
      format: (v) => (digits ? Units.formatRatio(v, digits) : Units.grouped(Math.round(v))), inputMode: 'decimal',
    });
    return section('targets', 'Targets', {
      children: [C.group(els([num0('GFA target (sf)', 'targets.gfa', 1000, 0), num0('FAR target', 'targets.far', 0.1, 2)])),
        C.help('0 means not set. The metrics panel shows how far the design is from each target.')],
    }, { open: true });
  }

  /* ==================================================================== SITE */
  const NO_SITE_HELP = 'Unlimited: no site line, setbacks, or site checks. Pick Rectangle or Polygon to test a real site.';
  const hasSiteNow = () => get('site.shape') !== 'none';

  function projectSection() {
    const P = T.project;
    const line = h('div', { class: 'help', id: 'tower-projLine' });
    const ffe = h('div', { class: 'help', id: 'tower-ffeNote' });
    const ctxNote = h('span', { class: 'help', style: 'margin:0', id: 'tower-ctxSiteNote' });
    const baseLine = h('p', { class: 'help', id: 'tower-baseLine' });
    const ft = (v) => `${(Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })} ft`;
    const sync = () => {
      const doc = ctx.project.doc();
      const info = P.siteInfo();
      line.textContent = doc ? `Project “${doc.name}”. ${info ? `Site: ${Units.formatFeetInches(info.size)} square.` : 'No site in this project.'}` : '';
      const tier = P.gradingFfe();
      ffe.textContent = !doc ? '' : tier
        ? `Grading Sketch sets the ground floor at ${Units.formatFeetInches(tier.ffe)}. The other tools read that height; the base elevation below stays editable.`
        : 'No Grading Sketch height yet, so the tools read the base elevation below as the ground floor.';
      const n = (store.raw().context.blocks || []).filter((b) => b && b.site).length;
      ctxNote.textContent = store.raw().context.fromSite ? `${n} block${n === 1 ? '' : 's'} from the site.` : '';
      const g = P.groundUnderFootprint();
      baseLine.textContent = info && g != null ? `Ground floor at ${ft(num(get('placement.baseZ'), 0))} above sea level.` : `This project has no site ground. The base stays at ${ft(num(get('placement.baseZ'), 0))}.`;
    };
    swatchSyncs.push(sync); sync();
    const modeBtns = [['follow', 'Follow ground'], ['typed', 'Typed']].map(([mode, text]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-base-mode': mode, onclick: () => { P.setBaseMode(mode); C.refreshAll(); } }, text));
    const modeRow = C.when(() => { modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.baseMode === P.baseMode()))); return true; },
      [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Base elevation'), h('div', { class: 'chips', role: 'group', 'aria-label': 'Base elevation mode', id: 'tower-baseModeChips' }, modeBtns))]);
    const keep = C.toggle({ label: 'Keep manual blocks', bind: { get: () => P.flags.keepManual, set: (v) => { P.flags.keepManual = !!v; C.refreshAll(); }, commit: () => {} } });
    const nameCtl = C.text({ label: 'Option name', bind: { get: () => get('name') || '', set: (v) => T.options.rename(v), commit: () => {} }, maxLength: 60 });
    return section('project', 'Project site', {
      children: [
        line, nameCtl.el,
        C.label('Placement of the tower in the project'),
        C.group(els([lenF('X (east)', 'placement.x', { hardMin: -1e6, hardMax: 1e6 }), lenF('Y (north)', 'placement.y', { hardMin: -1e6, hardMax: 1e6 })])),
        degS('Rotation (5 degree steps)', 'placement.rotation', -180, 180, { step: 5, hardMin: -360, hardMax: 360 }).el,
        modeRow.el,
        C.when(() => P.baseMode() === 'follow', [baseLine]).el,
        C.when(() => P.baseMode() === 'typed', [lenF('Base elevation (ft)', 'placement.baseZ', { hardMin: -1e5, hardMax: 1e5, step: 0.5 })]).el,
        C.help('Follow ground sets the base to the lowest ground under the building. Typed keeps the value you enter.'),
        ffe,
        C.when(() => P.hasSite(), [
          h('div', { class: 'add-row' }, C.button('Center on site', () => P.centerOnSite()), h('span', { class: 'help', style: 'margin:0' }, 'Puts the tower at the site center and its ground floor at the ground there.')),
          C.label('Neighbors from the Site Model'),
          C.slider({ label: 'Radius around the tower', bind: bs('context.radius'), min: 100, max: 2000, step: 50, hardMin: 50, hardMax: 5000, format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text' }),
          h('div', { class: 'add-row' }, C.button('Context from site', () => P.contextFromSite()), ctxNote),
          keep,
          C.toggle({ label: 'Show the site neighbors as blocks', bind: bs('context.show') }),
        ]).el,
      ],
    }, { when: () => P.hasDoc() });
  }

  function siteSection() {
    const shapeBind = {
      get: () => get('site.shape'),
      set: (v) => {
        const site = deepClone(get('site'));
        site.shape = v;
        if (v === 'polygon' && (!Array.isArray(site.points) || site.points.length < 3)) {
          const w = num(site.width, 250), d = num(site.depth, 200);
          site.points = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
        }
        store.set('site', site, { live: false });
      },
      commit: () => {},
    };
    return section('site', 'Site', {
      children: els([
        sel('Shape', null, opts([['none', 'Unlimited'], ['rect', 'Rectangle'], ['polygon', 'Polygon']]), shapeBind),
        C.when(() => get('site.shape') === 'none', [C.help(NO_SITE_HELP)]),
        C.when(() => get('site.shape') === 'rect', [lenS('Width', 'site.width', 50, 600), lenS('Depth', 'site.depth', 50, 600)]),
        C.when(() => get('site.shape') === 'polygon', [C.points({ label: 'Site corners (x, y in feet)', bind: bs('site.points'), need: 3, needText: 'Needs at least 3 points. Until then the rectangle is used.' })]),
      ]),
    });
  }
  function setbacksSection() {
    return section('setbacks', 'Setbacks', {
      children: els([
        C.group(els([
          lenF('Front (south)', 'site.setbacks.front', { hardMin: 0 }), lenF('Back (north)', 'site.setbacks.back', { hardMin: 0 }),
          lenF('Left (west)', 'site.setbacks.left', { hardMin: 0 }), lenF('Right (east)', 'site.setbacks.right', { hardMin: 0 }),
        ])),
        C.help('The tower must stay inside the site shrunk by these distances.'),
      ]),
    }, { when: hasSiteNow });
  }
  function heightSection() {
    const limitBind = C.mapBind(bs('site.heightLimit'), (v) => num(v, 0), (v) => Math.max(0, v));
    return section('height', 'Height limit and stepback', {
      children: els([
        C.slider({
          label: 'Height limit (0 = none)', bind: limitBind, min: 0, max: 800, step: 5, hardMin: 0, hardMax: 5000,
          format: (v) => (v > 0 ? Units.formatFeetInches(v) : 'None'), parse: (t) => (/^\s*(none|off)\s*$/i.test(t) ? 0 : Units.parseLength(t)), inputMode: 'text',
        }),
        C.when(hasSiteNow, [
          C.label('Stepback'),
          C.toggle({ label: 'Stepback above a height', bind: bs('site.stepback.on') }),
          C.when(() => get('site.stepback.on'), [lenS('Above height', 'site.stepback.aboveHeight', 20, 400), lenS('Step in by', 'site.stepback.distance', 5, 60)]),
          C.help('Above the stepback height the allowed footprint shrinks by the step-in distance on every side.'),
        ]),
      ]),
    });
  }
  function contextSection() {
    const list = lists.context = C.list({
      bind: bs('context.blocks'), addLabel: 'Add block', reorder: false, openDefault: () => false,
      empty: 'No context blocks.',
      title: (i, b) => `Block ${i + 1} · ${Units.formatFeetInches(num(b.h, 0))} high${b.site ? ' · site' : ''}`,
      make: () => ({ x: 0, y: -180, w: 200, d: 120, h: 60 }),
      render: (i) => ({
        children: [C.group(els([
          lenF('Center x', `context.blocks.${i}.x`, { hardMin: -MAXD }), lenF('Center y', `context.blocks.${i}.y`, { hardMin: -MAXD }),
          lenF('Width', `context.blocks.${i}.w`), lenF('Depth', `context.blocks.${i}.d`), lenF('Height', `context.blocks.${i}.h`),
        ]))],
      }),
    });
    return section('context', 'Context blocks', {
      children: els([
        C.help('Neighboring buildings, drawn for scale. They never change any number. Show or hide them in the View panel.'),
        list,
        h('div', { class: 'add-row' }, C.button('Surround', () => {
          store.set('context.blocks', surroundBlocks(store.raw()), { live: false });
          if (!get('context.show')) store.set('context.show', true, { live: false });
        }), h('span', { class: 'help', style: 'margin:0' }, 'One block on each side of the site (around the building when there is no site).')),
      ]),
    }, { open: true });
  }

  /* ==================================================================== VIEW */
  const appView = () => (ctx.view && ctx.view.get()) || { colorBy: 'program', floorLines: true, shadows: true, sun: { az: 140, alt: 40 } };
  function legendEl() {
    const box = h('div', { class: 'tower-legend', id: 'tower-legend', hidden: true });
    const sync = () => {
      const v = appView();
      const d = T.derived.get();
      const diagram = ctx.scene.style() === 'diagram';
      const plates = d.plates || [];
      const used = plates.filter((p) => !p.void && p.polygons && p.polygons.length);
      const rows = [];
      if (v.colorBy === 'program') {
        const seen = new Set(used.filter((p) => p.outsideEnvelopeArea <= 1).map((p) => p.program));
        for (const k of Object.keys(CONFIG.programs)) if (seen.has(k)) rows.push([progColor(k), CONFIG.programs[k].label]);
      } else {
        const seen = new Set(used.filter((p) => p.outsideEnvelopeArea <= 1).map((p) => p.zone));
        for (const z of ['podium', 'tower', 'mechanical']) if (seen.has(z)) rows.push([CONFIG.zoneColors[z], z[0].toUpperCase() + z.slice(1)]);
      }
      if ((d.solids || []).some((x, i) => !(d.solidsOutside && d.solidsOutside[i]))) rows.push([CONFIG.zoneColors.crown, 'Crown']);
      if (used.some((p) => p.outsideEnvelopeArea > 1) || (d.solidsOutside || []).some(Boolean)) rows.push([CONFIG.outsideColor, 'Outside envelope']);
      box.hidden = !diagram || !rows.length;
      const key = JSON.stringify([rows, v.colorBy]);
      if (box.dataset.key === key) return;
      box.dataset.key = key;
      box.textContent = '';
      box.append(h('div', { class: 'label' }, v.colorBy === 'program' ? 'Program colors' : 'Zone colors'));
      for (const [color, text] of rows) box.append(h('div', { class: 'tower-lg-row' }, h('span', { class: 'sw', style: `background:${color}` }), h('span', null, text)));
    };
    swatchSyncs.push(sync); sync();
    return box;
  }
  function displaySection() {
    return section('display', 'Display', {
      children: els([
        legendEl(),
        C.help('Use Model or Diagram in the top bar to change the style. Color, floor lines, shadows and sun are in the View panel of the app.'),
      ]),
    }, { open: true });
  }
  function sceneSection() {
    return section('scene', 'Context and envelope', {
      children: els([
        C.toggle({ label: 'Show zoning envelope', bind: bs('view.envelope') }),
        C.toggle({ label: 'Show context blocks', bind: bs('context.show') }),
        C.help('Edit the context blocks in the Site panel.'),
        C.segmented({
          label: 'Neighbor buildings', options: opts([['solid', 'Solid'], ['glass', 'Glass'], ['wireframe', 'Wireframe']]),
          bind: { get: () => (ctx.siteStyle ? ctx.siteStyle() : 'solid'), set: (v) => { if (ctx.setSiteStyle) ctx.setSiteStyle(v); }, commit() {} },
        }),
      ]),
    }, { open: true });
  }
  function snapSection() {
    const snap = (patch) => store.set('view.snap', { ...(get('view.snap') || {}), ...patch }, { live: false });
    const gridChips = [5, 10].map((g) => h('button', { class: 'chip', type: 'button', 'data-grid': String(g), 'aria-pressed': 'false', onclick: () => { snap({ grid: g }); C.refreshAll(); } }, `${g} ft`));
    return section('snap', 'Snap', {
      children: [
        C.toggle({ label: 'Snap while dragging', bind: { get: () => (get('view.snap') || {}).on !== false, set: (v) => snap({ on: !!v }), commit: () => {} } }).el,
        C.when(() => { const g = (get('view.snap') || {}).grid === 10 ? 10 : 5; gridChips.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.grid) === g))); return true; },
          [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Grid'), h('div', { class: 'chips', role: 'group', 'aria-label': 'Grid size' }, gridChips))]).el,
        C.help('Snaps to the grid, the site, setbacks and the edges and centers of other pieces. Hold Option (Alt) while dragging to skip it.'),
      ],
    });
  }

  /* ================================================================== builders */
  const host = (name, fn) => (body) => {
    body.classList.add('tower-panel');
    swatchSyncs = syncGroups[name] = [];
    const parts = fn();
    parts.filter(Boolean).forEach((el) => body.append(el));
    C.refreshAll();
    allSyncs().forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  };
  const form = host('form', () => [optionSection(), podiumSection(), segmentsSection(), movesSection(), carvesSection(), crownSection()]);
  const program = host('program', () => [programsSection(), targetsSection()]);
  const site = host('site', () => [projectSection(), siteSection(), setbacksSection(), heightSection(), contextSection()]);
  const view = host('view', () => [displaySection(), sceneSection(), snapSection()]);

  /** Switches to the section that holds an item, opens its row, and scrolls it into view. */
  const ITEM_MAP = { segment: ['segments', 'segments'], podium: ['podium'], crown: ['crown'], carve: ['carves', 'carves'], context: ['context', 'context'] };
  function openItem(item) {
    const m = item && ITEM_MAP[item.kind];
    if (!m) return false;
    const sec = sections[m[0]];
    if (!sec || !sec.el.isConnected) return false;
    if (!sec.isOpen()) sec.setOpen(true);
    let target = sec.el;
    const lst = m[1] ? lists[m[1]] : null;
    if (lst && Number.isInteger(item.index)) { const row = lst.openAt(item.index); if (row) target = row; }
    try { target.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } catch (e) { /* the row stays where it is */ }
    target.classList.remove('is-focus'); void target.offsetWidth; target.classList.add('is-focus');
    setTimeout(() => target.classList.remove('is-focus'), 1600);
    return true;
  }
  function refresh() {
    C.refreshAll();
    allSyncs().forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  return { form, program, site, view, refresh, openItem, sections, lists, controls: C, syncCount: () => allSyncs().length };
}

export { unitBreakdown };
