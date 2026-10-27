/* ==========================================================================
   PARKING: panels
   parking-source, parking-layout, parking-ramps, parking-view. Port of build/parking/08_ui.js (the Layout, Ramp, Checks and
   View tabs), built with ctx.ui.Controls. One refresh registry (T.CT) is refreshed on every store change.
   Left for later (docs/shell-plan.md 9.3): liner strip, circular speed segments, accessible table / EV / bike / required editors,
   stall-number labels. Their numbers stay in the metrics.
   ========================================================================== */
import { Units } from '../../core/ui-kit.js';
import { CONFIG, RAMP_TYPES, RAMP_LABELS, SOURCE_LABELS, num, clamp, deepClone } from './state.js';

const MAXD = CONFIG.limits.maxDim;
const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
const round1 = (v) => String(Math.round(v * 10) / 10);
const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
const RAMP_HELP = {
  'single-helix': 'Every bay climbs half a level; neighbouring bays climb in opposite directions. Turn zones stay flat.',
  'double-helix': 'Every bay climbs a full level. Turn zones stay flat.',
  speed: 'A separate ramp between levels. Its rectangle is cut from every level it touches.',
  split: 'Half-level end ramps. The end zones grow to the ramp length plus its two transitions.',
  'sloped-floor': 'One bay slopes a full level; the other bays stay flat.',
  none: 'No ramp. Every level is flat (a one-level deck, or levels reached another way).',
};

export function buildPanels(T, ctx) {
  const { h } = ctx.ui;
  const CT = T.CT;
  const store = T.store;
  const get = (path) => store.get(path);
  const bs = (path) => CT.bindStore(store, path);
  const els = (list) => list.filter((c) => c != null && c !== false).map((c) => c.el || c);

  /* ---- control shortcuts (build/parking/08_ui.js) ---- */
  const lenS = (label, path, min, max, extra = {}) => CT.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: MAXD,
    format: Units.formatFeetInches, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  const lenF = (label, path, extra = {}) => lenS(label, path, 0, 1, { compact: true, ...extra });
  const intS = (label, path, min, max, extra = {}) => CT.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: 999, integer: true,
    format: Units.formatInt, inputMode: 'numeric', ...extra,
  });
  const degS = (label, path, min, max, extra = {}) => CT.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: -3600, hardMax: 3600,
    format: (v) => `${round1(v)} deg`, inputMode: 'decimal', ...extra,
  });
  const numS = (label, path, min, max, step, digits, extra = {}) => CT.slider({
    label, bind: bs(path), min, max, step, hardMin: 0, hardMax: 1e7,
    format: (v) => Units.formatRatio(v, digits), inputMode: 'decimal', ...extra,
  });
  const pctS = (label, path, min, max, step, extra = {}) => CT.slider({
    label, bind: CT.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100),
    min, max, step, hardMin: 0, hardMax: 100, format: (v) => `${round1(v)}%`, inputMode: 'decimal', ...extra,
  });
  const slopeS = (label, path, extra = {}) => CT.slider({
    label, bind: CT.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100),
    min: 0, max: 1, step: 0.1, hardMin: 0, hardMax: 100, compact: true, format: (v) => `${Math.round(v * 100) / 100}%`, inputMode: 'decimal', ...extra,
  });
  const sel = (label, path, options, bind) => CT.select({ label, bind: bind || bs(path), options });
  const tog = (label, bind) => CT.toggle({ label, bind });
  /** A line of text that follows the state. */
  const live = (cls, fn, id) => {
    const p = h('p', { class: cls, id: id || null });
    return CT.when(() => { const t = fn(); if (p.textContent !== t) p.textContent = t; return true; }, [p]);
  };
  /** A row of toggle buttons: pairs [value, label]. */
  function choice(label, path, pairs, { id } = {}) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': label, id: id || null });
    const btns = pairs.map(([value, text]) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-value': String(value) }, text);
      b.addEventListener('click', () => store.set(path, value, { live: false }));
      wrap.append(b);
      return b;
    });
    const refresh = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(get(path)))));
    return CT.when(() => { refresh(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, label), wrap)]);
  }
  /** A select whose options come from a function. */
  function dynSelect(label, optionsFn, bind, id) {
    const select = h('select', { id: id || null, class: 'select' });
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
    return CT.when(() => { refresh(); return true; }, [wrap]);
  }
  const mkList = (o) => CT.list({ ...o, render: (i) => { const p = o.render(i); return { children: els(p.children || []), more: els(p.more || []) }; } });
  const section = (id, title, children, o = {}) => CT.section({ id: `parking-${id}`, title, open: !!o.open, children: els(children), more: o.more ? els(o.more) : undefined });

  /* ==========================================================================
     Source
     ========================================================================== */
  function buildSource(body) {
    const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Deck source', id: 'parking-source-chips' });
    const btns = ['standalone', 'wrap', 'podium'].map((k) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-source': k, 'aria-pressed': 'false', onclick: () => T.setSource(k) }, ({ standalone: 'Standalone', wrap: 'Wrap deck', podium: 'Podium' })[k]);
      wrap.append(b);
      return b;
    });
    const syncSource = () => {
      const s = get('source'), found = T.readers.sources();
      btns.forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.source === s));
        const need = b.dataset.source !== 'standalone' && !found.some((x) => x.source === b.dataset.source);
        b.classList.toggle('is-disabled', need);
        b.title = need ? (T.readers.has() ? 'The project has no such levels yet' : 'Open a project first') : '';
      });
    };
    const presetBind = { get: () => '', set: (v) => { if (v) T.applyPreset(v); }, commit() {} };
    const presetOptions = [{ value: '', label: 'Choose a preset' }, ...CONFIG.presets.filter((p) => p.state.source === 'standalone').map((p) => ({ value: p.id, label: p.name }))];
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Base elevation mode', id: 'parking-base-chips' });
    const baseBtns = [['follow', 'Follow ground'], ['typed', 'Typed']].map(([mode, text]) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-base-mode': mode, onclick: () => T.setBaseMode(mode) }, text);
      chips.append(b);
      return b;
    });
    const standalone = () => get('source') === 'standalone';
    const levelsOf = () => T.readers.sources().find((x) => x.source === get('source'));
    body.append(...els([
      CT.when(() => { syncSource(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Parking is'), wrap)]),
      CT.help('A standalone deck is free-standing. A wrap deck or a podium takes its footprint, level heights and cores from the massing in the open project.'),
      CT.when(() => !standalone(), [
        dynSelect('First level of the deck', () => {
          const src = levelsOf();
          return src ? src.levels.map((l, i) => ({ value: l.index, label: `Level ${i + 1}, z ${Units.formatFeetInches(l.z)}` })) : [{ value: get('sourceLevel'), label: '-' }];
        }, { get: () => get('sourceLevel'), set: (v) => T.setSourceLevel(v) }, 'parking-source-level'),
        live('help', () => {
          const s = levelsOf();
          return s ? `${s.levels.length} ${s.zone} level${s.levels.length === 1 ? '' : 's'} in the project (${Units.formatArea(s.levels[0].area)} on the first).` : 'The project has no such levels.';
        }),
      ]),
      CT.text({ label: 'Name', bind: bs('name'), maxLength: 60 }),
      sel('Start from a preset', null, presetOptions, presetBind),
      CT.when(() => standalone() && !!get('placement'), [
        CT.when(() => { baseBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.baseMode === T.baseMode()))); return true; },
          [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Base elevation'), chips)]),
        CT.when(() => T.baseMode() === 'follow', [live('help', () => T.baseLineText(), 'parking-base-line')]),
        CT.when(() => T.baseMode() === 'typed', [lenF('Base elevation (ft)', 'placement.baseZ', { hardMin: -1e5, hardMax: 1e5, step: 0.5 })]),
        CT.help('Follow ground sets the base to the lowest ground under the deck, or to the finished floor from the Grading Sketch. Typed keeps the value you enter.'),
      ]),
    ]));
  }

  /* ==========================================================================
     Layout
     ========================================================================== */
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
        store.set('footprint', fp, { live: false });
      },
      commit() {},
    };
    return [
      CT.when(standalone, [sel('Shape', null, opts([['rect', 'Rectangle'], ['polygon', 'Polygon']]), shapeBind)]),
      CT.when(rect, els([
        lenS('Width', 'footprint.width', 100, 600), lenS('Depth', 'footprint.depth', 60, 400),
        degS('Angle', 'footprint.angle', -90, 90),
        CT.group(els([lenF('Center x', 'footprint.x', { hardMin: -MAXD }), lenF('Center y', 'footprint.y', { hardMin: -MAXD })])),
      ])),
      CT.when(poly, [CT.points({ label: 'Footprint corners (x, y in feet)', bind: bs('footprint.points'), need: 3, needText: 'Needs at least 3 points. Until then the rectangle is used.' })]),
      CT.when(() => !standalone(), [CT.help('The footprint is the plate of the first deck or podium level in the project.')]),
      lenS('Perimeter wall', 'footprint.perimeter', 0, 4, { step: 0.5, hardMin: 0, hardMax: 20 }),
      tog('Rotate the bays 90 degrees', bs('bays.rotateBays')),
      live('help', () => {
        const d = T.D(), f = d.frame;
        return f && f.W ? `Layout ${Units.formatFeetInches(f.W)} by ${Units.formatFeetInches(f.D)}, ${d.built.bays.length} bay${d.built.bays.length === 1 ? '' : 's'}${d.built.strip ? `, strip ${Units.formatFeetInches(d.built.strip.y1 - d.built.strip.y0)}` : ''}.` : '';
      }),
    ];
  }
  function buildLevels() {
    const fromProject = () => get('source') !== 'standalone' && T.readers.has();
    return [
      intS('Levels', 'levels.count', 1, 10, { hardMax: CONFIG.limits.maxLevels }),
      lenS('Level 1 floor-to-floor', 'levels.ftf1', 9, 16, { step: 0.5, hardMin: 6, hardMax: 30 }),
      lenS('Typical floor-to-floor', 'levels.ftf', 9, 14, { step: 0.5, hardMin: 6, hardMax: 30 }),
      intS('Levels below grade', 'levels.belowGrade', 0, 3, { hardMin: 0, hardMax: 12 }),
      tog('Open top (the top level parks cars, no slab above)', bs('levels.openTop')),
      CT.when(fromProject, [CT.help('Floor-to-floor heights come from the project levels while the source is a wrap deck or a podium.')]),
      live('help', () => { const t = T.D().hud.topOfDeck; return t ? `Top of the deck ${Units.formatFeetInches(t)} above the first level.` : ''; }),
    ];
  }
  function buildBays() {
    const tzBind = CT.mapBind(bs('bays.turnZone'), (v) => (v == null ? 0 : v), (v) => (v > 0 ? v : null));
    return {
      children: [
        CT.group(els([lenF('Stall width', 'bays.stallW', { step: 0.5, hardMin: 6, hardMax: 14 }), lenF('Stall depth', 'bays.stallD', { step: 0.5, hardMin: 12, hardMax: 30 })])),
        lenS('Aisle width (two-way)', 'bays.aisle', 20, 28, { hardMin: 10, hardMax: 40 }),
        tog('Single-loaded edge bay for a wide remainder (42 ft or more)', bs('bays.edgeBays')),
        pctS('Compact stalls', 'bays.compactShare', 0, 50, 5),
      ],
      more: [
        CT.group(els([lenF('Compact width', 'bays.compactW', { step: 0.5, hardMin: 6, hardMax: 12 }), lenF('Compact depth', 'bays.compactD', { step: 0.5, hardMin: 10, hardMax: 24 })])),
        CT.slider({ label: 'End turn zone (0 = aisle width)', bind: tzBind, min: 0, max: 1, step: 1, hardMin: 0, hardMax: 120, compact: true, format: (v) => (v > 0 ? Units.formatFeetInches(v) : 'Aisle width'), parse: (t) => (/^\s*(auto|aisle|0)\s*$/i.test(t) ? 0 : Units.parseLength(t)), inputMode: 'text' }),
        CT.help('Stalls are 90 degrees in two-way bays. The short end walls stay turn zones with no stalls.'),
      ],
    };
  }
  function buildGrid() {
    return {
      children: [
        choice('Structural span', 'grid.span', [['long', 'Long span'], ['short', 'Short span']], { id: 'parking-span-chips' }),
        lenS('Column size (square)', 'grid.column', 1, 4, { step: 0.5, hardMin: 0.5, hardMax: 8 }),
        intS('Stalls per module', 'grid.stallsPerModule', 2, 5, { hardMax: 8 }),
        live('help', () => { const c = T.D().columns; return `Module ${Units.formatFeetInches(c.module || 0)}, ${c.perLevel || 0} columns per level.`; }),
        tog('Column overlay (demising lines, conflicts)', bs('view.overlay')),
        CT.when(() => !!T.D().overlay.suggestion, [
          live('help', () => {
            const d = T.D(), sg = d.overlay.suggestion;
            return sg ? `Units ${Units.formatFeetInches(d.overlay.unitWidth)} wide: a stall width of ${Units.formatFeetInches(sg.stallW)} lines the columns up and gives ${sg.stallsPerRow} stalls per row.` : '';
          }, 'parking-suggest-note'),
          h('div', { class: 'add-row' }, CT.button('Use the suggested width', () => T.useSuggestion(), 'outline sm'), h('span', { class: 'help', style: 'margin:0' }, 'The tool never changes the width by itself.')),
        ]),
      ],
      more: [
        CT.group(els([lenF('Structure depth, long span', 'grid.structureDepth.long', { step: 0.5, hardMin: 0.5, hardMax: 8 }), lenF('Structure depth, short span', 'grid.structureDepth.short', { step: 0.5, hardMin: 0.5, hardMax: 8 })])),
        lenF('Column overlay tolerance', 'checks.overlayTolerance', { step: 0.5, hardMin: 0, hardMax: 20 }),
      ],
    };
  }
  function buildCores() {
    const projectCores = () => T.D().cores.some((c) => c.fromProject);
    const coresBind = {
      get: () => get('cores'),
      set: (v, liveSet) => {
        if (Array.isArray(v) && v.length > CONFIG.limits.maxCores) { ctx.ui.Toast.show(`A deck holds up to ${CONFIG.limits.maxCores} cores.`, { kind: 'warn' }); return; }
        store.set('cores', v, { live: liveSet });
      },
      commit: () => store.commit(),
    };
    const newCore = (arr, kind) => {
      const pre = kind === 'elevator' ? 'E' : 'S';
      let n = 1;
      while (arr.some((c) => c.id === `${pre}${n}`)) n++;
      const p = num(get('footprint.perimeter'), 1);
      const row = T.D().raw.bays && T.D().raw.bays[0] ? T.D().raw.bays[0].rows[0] : null;
      return { id: `${pre}${n}`, kind, x: p + 4, y: row ? row.y0 : p, w: kind === 'elevator' ? 10 : 22, d: kind === 'elevator' ? 10 : 12 };
    };
    const coreList = mkList({
      bind: coresBind, addLabel: 'Add stair', min: 0, reorder: false, openDefault: () => false, empty: 'No cores.',
      title: (i, c) => {
        const issue = T.D().coreIssues[c.id];
        return `${c.id}, ${c.kind === 'elevator' ? 'Elevator' : 'Stair'}, ${Units.formatFeetInches(num(c.w, 0))} by ${Units.formatFeetInches(num(c.d, 0))}${issue === 'aisle' ? ', in an aisle' : issue === 'outside' ? ', outside' : ''}`;
      },
      make: (arr) => newCore(arr, 'stair'),
      render: (i) => ({
        children: [
          CT.text({ label: 'Name', bind: bs(`cores.${i}.id`), maxLength: 8 }),
          sel('Kind', `cores.${i}.kind`, opts([['stair', 'Stair'], ['elevator', 'Elevator']])),
          CT.group(els([lenF('x', `cores.${i}.x`, { hardMin: -MAXD }), lenF('y', `cores.${i}.y`, { hardMin: -MAXD }), lenF('Width', `cores.${i}.w`), lenF('Depth', `cores.${i}.d`)])),
          h('div', { class: 'add-row' }, CT.button('Move to the nearest row', () => T.moveCoreToRowAt(i), 'outline sm')),
        ],
      }),
    });
    return [
      tog('Use the cores from the project', bs('coresFromProject')),
      CT.when(projectCores, [
        CT.help('These cores come from the project massing and carry down through the deck. To move them, copy them into this design.'),
        h('div', { class: 'add-row' }, CT.button('Make the cores editable', () => T.makeCoresEditable(), 'outline sm')),
        live('help', () => T.D().cores.map((c) => `${c.id}, ${c.kind}, ${Units.formatFeetInches(c.w)} by ${Units.formatFeetInches(c.d)}`).join('. ')),
      ]),
      CT.when(() => !projectCores(), [
        CT.help('Cores are the same on every level, in the layout frame (origin at the south-west corner). Drag them in the view, or type values here.'),
        coreList,
        h('div', { class: 'add-row' },
          CT.button('Add elevator', () => { const arr = deepClone(get('cores')); arr.push(newCore(arr, 'elevator')); coresBind.set(arr, false); }, 'outline sm'),
          CT.button('Move all cores to rows', () => T.moveAllCoresToRows(), 'outline sm')),
      ]),
    ];
  }
  function buildEntries() {
    const entriesBind = {
      get: () => get('entries'),
      set: (v, liveSet) => {
        if (Array.isArray(v) && v.length > CONFIG.limits.maxEntries) { ctx.ui.Toast.show(`A deck holds up to ${CONFIG.limits.maxEntries} entries.`, { kind: 'warn' }); return; }
        store.set('entries', v, { live: liveSet });
      },
      commit: () => store.commit(),
    };
    const entryList = mkList({
      bind: entriesBind, addLabel: 'Add entry', min: 0, reorder: false, openDefault: () => false, empty: 'No entries.',
      title: (i, e) => `${e.id}, ${e.side}, ${Units.formatFeetInches(num(e.at, 0))}, ${Units.formatFeetInches(num(e.width, 0))} wide`,
      make: (arr) => {
        let n = arr.length + 1;
        while (arr.some((e) => e.id === `N${n}`)) n++;
        return { id: `N${n}`, side: 'east', at: Math.round(num(T.D().frame.D, 125) / 4), width: 24 };
      },
      render: (i) => ({
        children: els([
          sel('Side', `entries.${i}.side`, opts([['west', 'West end'], ['east', 'East end'], ['south', 'South side'], ['north', 'North side']])),
          CT.group(els([lenF('Center along the side', `entries.${i}.at`, { hardMin: 0 }), lenF('Lane width', `entries.${i}.width`, { hardMin: 10, hardMax: 60 })])),
        ]),
      }),
    });
    return [
      CT.help('An entry at a short end lies in a turn zone and costs no stalls. An entry on a long side cuts the edge row it crosses.'),
      entryList,
    ];
  }
  function buildChecks() {
    return [
      h('p', { class: 'help caution' }, 'Caution: common design values, not code values. Verify against the adopted code.'),
      CT.group(els([lenF('Vehicle barrier', 'checks.barrier', { step: 0.25, hardMin: 0, hardMax: 10 }), lenF('Pedestrian guard', 'checks.guard', { step: 0.25, hardMin: 0, hardMax: 10 })])),
      lenF('Barrier the design shows', 'checks.barrierProvided', { step: 0.25, hardMin: 0, hardMax: 10 }),
      CT.group(els([lenF('Clear height, general', 'checks.clearGeneral', { step: 0.25, hardMin: 0, hardMax: 20 }), lenF('Clear height, van route', 'checks.clearVan', { step: 0.25, hardMin: 0, hardMax: 20 })])),
      slopeS('Cross slope', 'checks.crossSlope'),
    ];
  }
  function buildLayout(body) {
    const g = buildGrid(), b = buildBays();
    body.append(
      section('footprint', 'Footprint', buildFootprint(), { open: true }).el,
      section('levels', 'Levels', buildLevels()).el,
      section('bays', 'Bays and stalls', b.children, { more: b.more }).el,
      section('grid', 'Column grid', g.children, { more: g.more }).el,
      section('cores', 'Cores', buildCores()).el,
      section('entries', 'Entries', buildEntries()).el,
      section('checks', 'Checks', buildChecks()).el,
    );
  }

  /* ==========================================================================
     Ramps
     ========================================================================== */
  function buildRamps(body) {
    const rampBtns = h('div', { class: 'chips', role: 'group', 'aria-label': 'Ramp type', id: 'parking-ramp-types' });
    const btns = RAMP_TYPES.map((k) => {
      const b = h('button', { class: 'chip', type: 'button', 'data-ramp': k, 'aria-pressed': 'false', onclick: () => store.set('ramp.type', k, { live: false }) }, RAMP_LABELS[k]);
      rampBtns.append(b);
      return b;
    });
    const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ramp === get('ramp.type'))));
    const on = () => get('ramp.type') === 'speed';
    const fmt = Units.formatFeetInches;
    const slopes = h('dl', { class: 'kv', id: 'parking-ramp-list' });
    const slopeList = CT.when(() => {
      const d = T.D();
      slopes.textContent = '';
      const first = d.ramps[0] ? d.ramps[0].level : 1;
      const rows = d.ramps.filter((r) => r.level === first).map((r) => [`${r.id}`, `${pct1(Math.abs(r.slope))} of ${pct1(r.limit)}`, r.ok]);
      const last = d.ramps.length ? Math.max(...d.ramps.map((r) => r.level)) : 0;
      if (last > 1) { const t = d.ramps.find((r) => r.level === Math.min(2, last)); if (t) rows.push([`${t.id} (typical)`, `${pct1(Math.abs(t.slope))} of ${pct1(t.limit)}`, t.ok]); }
      if (!rows.length) rows.push(['No ramp', '-', true]);
      for (const [k, v, ok] of rows) slopes.append(h('dt', null, k), h('dd', ok ? null : { class: 'parking-bad' }, v));
      return true;
    }, [slopes]);

    body.append(...els([
      CT.when(() => { sync(); return true; }, [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Ramp type'), rampBtns)]),
      live('help', () => RAMP_HELP[get('ramp.type')] || '', 'parking-ramp-help'),
      CT.when(() => get('ramp.type') === 'sloped-floor', [
        dynSelect('Sloped bay', () => T.D().built.bays.map((b, i) => ({ value: i, label: `Bay ${b.index} (from the south)` })),
          { get: () => get('ramp.slopedBay'), set: (v) => store.set('ramp.slopedBay', Number(v), { live: false }) }, 'parking-sloped-bay'),
      ]),
      CT.when(() => get('ramp.type') === 'split', [
        lenS('Main ramp length', 'ramp.splitLength', 20, 80, { hardMin: 10, hardMax: 200 }),
        live('help', () => `End zone ${fmt(ctxSplitEnd())} (main ramp plus two transitions).`),
      ]),
      CT.when(on, [
        choice('Shape', 'ramp.speed.shape', [['straight', 'Straight']]),
        CT.group(els([lenF('x', 'ramp.speed.x', { hardMin: -MAXD }), lenF('y', 'ramp.speed.y', { hardMin: -MAXD })])),
        lenS('Width', 'ramp.speed.width', 18, 30, { hardMin: 10, hardMax: 60 }),
        lenS('Length (ramped)', 'ramp.speed.length', 40, 160, { hardMin: 20, hardMax: 400 }),
        live('help', () => {
          const d = T.D(), fp = ctxSpeedFootprint();
          const lost = d.raw.levels.length ? ((d.raw.levels[0].cuts.find((c) => c.kind === 'ramp') || {}).lost || 0) : 0;
          return fp ? `Cut from every level: ${fmt(fp.box[2] - fp.box[0])} by ${fmt(fp.box[3] - fp.box[1])}. Stalls lost per level: ${lost}.` : '';
        }),
      ]),
      CT.when(() => !on(), [CT.help('Choose Speed ramp to place a separate ramp in the strip beside the bays.')]),
      CT.label('Transitions'),
      CT.group(els([lenF('Transition length', 'ramp.transition.length', { hardMin: 0, hardMax: 40 }), numS('Slope factor', 'ramp.transition.slopeFactor', 0, 1, 0.05, 2, { compact: true, hardMax: 1 })])),
      CT.help('Each end of a transition slopes at the factor times the ramp slope (0.5 by default).'),
      CT.label('Ramp slopes'),
      slopeList,
      CT.group(els([slopeS('Parking ramp slope limit', 'checks.slopeParking'), slopeS('Speed and split ramp limit', 'checks.slopeSpeed')])),
      h('p', { class: 'help caution' }, 'Caution: common design values, not code values. Verify against the adopted code.'),
    ]));
  }
  const ctxSplitEnd = () => T.RampsMod.splitEndZone(store.raw());
  const ctxSpeedFootprint = () => T.RampsMod.speedRampFootprint(store.raw());

  /* ==========================================================================
     View
     ========================================================================== */
  function buildView(body) {
    const levelBind = { get: () => get('view.level'), set: (x) => store.set('view.level', Math.round(x), { live: false }), commit() {} };
    const ghostBind = { get: () => ctx.layers.isOn('parking-context'), set: (v) => ctx.layers.setOn('parking-context', !!v), commit() {} };
    const legend = h('div', { class: 'parking-legend', id: 'parking-legend' });
    const legendCtl = CT.when(() => {
      const d = T.D(), v = get('view');
      const rows = [];
      if (v.colorBy === 'slope') rows.push([CONFIG.slopeColors.ok, 'Under 80% of the limit'], [CONFIG.slopeColors.near, 'Up to the limit'], [CONFIG.slopeColors.over, 'Over the limit']);
      else {
        const seen = new Set();
        for (const lv of d.levels || []) for (const s of lv.stalls) seen.add(s.kind || 'standard');
        for (const k of Object.keys(CONFIG.kindColors)) if (seen.has(k)) rows.push([CONFIG.kindColors[k], CONFIG.kindLabels[k]]);
      }
      rows.push([CONFIG.coreColors.stair, 'Stair'], [CONFIG.coreColors.elevator, 'Elevator']);
      if (d.overlay && d.overlay.conflicts.length) rows.push([CONFIG.conflictColor, 'Column conflict']);
      const key = JSON.stringify(rows);
      if (legend.dataset.key !== key) {
        legend.dataset.key = key;
        legend.textContent = '';
        for (const [color, text] of rows) legend.append(h('div', { class: 'parking-lg-row' }, h('span', { class: 'parking-sw', style: `background:${color}` }), h('span', null, text)));
      }
      return true;
    }, [legend]);
    const gridChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Snap grid' });
    const gridBtns = CONFIG.snapGrids.map((g) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-grid': String(g), onclick: () => store.set('view.snap.grid', g, { live: false }) }, `${g} ft`);
      gridChips.append(b);
      return b;
    });
    body.append(...els([
      live('help', () => `Model and Diagram follow the view switch in the top bar (D). It is ${ctx.scene.style() === 'diagram' ? 'Diagram' : 'Model'} now.`, 'parking-style-note'),
      sel('Color by (Diagram)', 'view.colorBy', opts([['kind', 'Stall kind'], ['slope', 'Ramp slope']])),
      CT.slider({ label: 'Isolate a level (0 = all levels)', bind: levelBind, min: 0, max: 10, step: 1, hardMin: 0, hardMax: CONFIG.limits.maxLevels, integer: true, format: (x) => (x === 0 ? 'All' : String(x)), inputMode: 'numeric', compact: true }),
      tog('Column overlay (demising lines, conflicts)', bs('view.overlay')),
      tog('Massing context (ghost)', ghostBind),
      tog('Snap while dragging a handle', bs('view.snap.on')),
      CT.when(() => !!get('view.snap.on'), [h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Snap grid'),
        CT.when(() => { gridBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.grid === String(get('view.snap.grid'))))); return true; }, [gridChips]).el)]),
      CT.help('Keys: L isolates the next level, Shift+L shows all levels. Alt while dragging a handle turns snapping off.'),
      legendCtl,
    ]));
  }

  return [
    { id: 'parking-source', title: 'Source', build: buildSource, open: true },
    { id: 'parking-layout', title: 'Layout', build: buildLayout, open: true },
    { id: 'parking-ramps', title: 'Ramps', build: buildRamps, open: false },
    { id: 'parking-view', title: 'View', build: buildView, open: false },
  ];
}
