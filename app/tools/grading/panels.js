/* ==========================================================================
   GRADING TOOL: panels
   The six panels of the Grading Sketch in the shell (docs/shell-plan.md section 9.4), built with ctx.ui.Controls:
     grading-buildings   source, buildings and tiers, balanced or typed FFE, pad offset and depth, suggested tiers
     grading-ground      existing ground (project site or typed plane), daylight slopes, contours, legend
     grading-drives      drives and lots (drawn on the plan), their limits
     grading-walls       property line, drawn walls, pad-step walls, automatic walls (accept)
     grading-routes      walk and ramp routes, the route limits and their classes
     grading-earthwork   cut, fill and net, balance, bulking, the colors
   Port of the panel code in build/grading/08_ui.js. One Controls registry (C) per tool; the tool refreshes it on every
   store change, so every field and every note follows the model.
   ========================================================================== */
import { Units } from '../../core/ui-kit.js';
import { toolOn } from '../registry.js';
import { isLinked, drivingBase } from '../../../src/grading/towerlink.js';
import {
  CONFIG, FeaturesMod, fmt, num, clamp, rnd, deepClone, polyLength, ringArea, compassOf, pct1, classWord, projectInfo, SOURCE_LABELS,
} from './model.js';

const MAXD = CONFIG.limits.maxDim;
const round1 = (v) => String(Math.round(v * 10) / 10);

export function createPanels(env) {
  const { ctx, store, getD, editor, tool } = env;
  const { h } = ctx.ui;
  const C = ctx.ui.Controls.create();
  const FT = Units.formatFeetInches;
  const E = fmt.elev;
  const get = (p) => store.get(p);
  const bs = (p) => C.bindStore(store, p);
  const els = (list) => list.filter((c) => c != null && c !== false).map((c) => c.el || c);
  const warn = (text) => { try { ctx.bus.emit('notice', { text, kind: 'warn' }); } catch (e) { /* no toast host */ } };
  const caution = (text) => h('p', { class: 'help grading-caution' }, text);
  const doc = () => ctx.project.doc();

  /* ---- control shortcuts ---- */
  const lenS = (label, bind, min, max, extra = {}) => C.slider({
    label, bind: typeof bind === 'string' ? bs(bind) : bind, min, max, step: 1, hardMin: 0, hardMax: MAXD, format: FT, parse: Units.parseLength, inputMode: 'text', ...extra,
  });
  const lenF = (label, bind, extra = {}) => lenS(label, bind, 0, 1, { compact: true, ...extra });
  const numS = (label, path, min, max, step, suffix, extra = {}) => C.slider({
    label, bind: bs(path), min, max, step, hardMin: -1e6, hardMax: 1e6, format: (v) => `${round1(v)}${suffix}`, inputMode: 'decimal', ...extra,
  });
  const degS = (label, path, min, max, extra = {}) => C.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: -3600, hardMax: 3600, format: (v) => `${round1(v)}°`, inputMode: 'decimal', ...extra,
  });
  const pctS = (label, path, min, max, step, extra = {}) => C.slider({
    label, bind: C.mapBind(bs(path), (v) => num(v, 0) * 100, (v) => clamp(v, 0, 100) / 100),
    min, max, step, hardMin: 0, hardMax: 100, format: (v) => `${Math.round(v * 100) / 100}%`, inputMode: 'decimal', ...extra,
  });
  const intS = (label, path, min, max, extra = {}) => C.slider({
    label, bind: bs(path), min, max, step: 1, hardMin: 1, hardMax: 999, integer: true, format: Units.formatInt, inputMode: 'numeric', ...extra,
  });
  /** One value out of a short list: pairs [value, label, title]. */
  const choiceB = (label, bind, pairs) => C.segmented({ label, bind, options: pairs.map(([value, text, title]) => ({ value, label: text, title })) });
  const choice = (label, path, pairs) => choiceB(label, { get: () => get(path), set: (v) => store.set(path, v, { live: false }), commit: () => {} }, pairs);
  const textField = (label, path, maxLength = 60) => C.text({ label, maxLength, bind: { get: () => get(path), set: (v) => store.set(path, String(v).trim().slice(0, maxLength), { live: false }), commit: () => {} } });
  /** A line of text that follows the model: fn() -> string. */
  function info(fn, cls = 'help') {
    const p = h('p', { class: cls });
    return C.when(() => { let t = ''; try { t = fn() || ''; } catch (e) { t = ''; } if (p.textContent !== t) p.textContent = t; p.hidden = !t; return true; }, [p]);
  }
  /** A block that rebuilds on every refresh: fn(el). */
  function dyn(cls, fn) {
    const el = h('div', { class: cls });
    return C.when(() => { try { fn(el); } catch (e) { el.textContent = ''; } return true; }, [el]);
  }
  const kvRows = (el, rows) => { el.textContent = ''; for (const [k, v, c] of rows) el.append(h('dt', null, k), h('dd', c ? { class: c } : null, v)); };
  const drawBtn = (kind, label) => h('div', { class: 'btn-row' }, C.button(label, () => editor.startDraw(kind), 'outline sm'));
  const showBtn = (kind, idFn) => C.button('Show on plan', () => { const id = idFn(); if (id != null) editor.showItem({ kind, id }); }, 'outline sm');
  const redrawBtn = (kind, idFn) => C.button('Redraw', () => { const id = idFn(); if (id != null) editor.redraw({ kind, id }); }, 'outline sm');
  const idAt = (arr, i) => ((get(arr) || [])[i] || {}).id;
  const startBind = (path) => ({ get: () => (typeof get(path) === 'number' ? 'typed' : 'existing'), set: (k) => store.set(path, k === 'existing' ? 'existing' : 1000, { live: false }), commit: () => {} });
  const startElev = (path) => C.slider({ label: 'Start elevation (ft)', bind: bs(path), min: 0, max: 1, step: 0.01, compact: true, hardMin: -1000, hardMax: 20000, format: E, inputMode: 'decimal' });
  const mkList = (o) => C.list({ ...o, render: (i) => { const p = o.render(i); return { children: els(p.children || []), more: els(p.more || []) }; } });
  /** The built-in Add button of a list is hidden for drawn items; the Draw button above it starts the drawing. */
  const drawList = (list) => h('div', { class: 'grading-draw-list' }, list.el);

  /* ==========================================================================
     Buildings
     ========================================================================== */
  const hasSec = (k) => !!(doc() && ctx.project.section(k));
  const bAt = (i) => (get('buildings') || [])[i] || {};
  const bPath = (i, k) => `buildings.${i}.${k}`;
  const builtIdOf = (b) => (b.source === 'typed' ? b.id : b.source);
  const builtOf = (i) => { const b = bAt(i); const D = getD(); return D ? D.built.buildings.find((x) => x.id === builtIdOf(b)) || null : null; };
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
    set: (v, live) => { const r = rectOf(i); if (r) { const n = { ...r, [key]: v }; store.set(bPath(i, 'outer'), rectRing(n.w, n.d, n.cx, n.cy).map((p) => [rnd(p[0]), rnd(p[1])]), { live: !!live }); } },
    commit: () => store.commit(),
  });
  function setBuildingSource(i, src) {
    const b = deepClone(bAt(i));
    if (!b || b.source === src) return;
    if (src !== 'typed' && !hasSec(src)) { warn(src === 'massing' ? 'Open a project that has a massing first.' : 'Open a project that has a parking deck first.'); return; }
    b.source = src;
    if (src === 'typed') { if (!Array.isArray(b.outer)) { const bb = builtOf(i); b.outer = bb && bb.outer ? bb.outer.map((p) => [rnd(p[0]), rnd(p[1])]) : rectRing(100, 60, 0, 0); } }
    else delete b.outer;
    store.set(`buildings.${i}`, b, { live: false });
  }
  /** True when building i follows the tower's typed base (the link in src/grading/towerlink.js, on only while the tower is Typed). */
  const fromTower = (i) => isLinked(bAt(i)) && drivingBase(doc()) != null;
  const tierBind = (i, j, key) => ({ get: () => ((bAt(i).tiers || [])[j] || {})[key], set: (v, live) => store.set(`${bPath(i, 'tiers')}.${j}.${key}`, v, { live: !!live }), commit: () => store.commit() });
  function suggestionFor(i) {
    const bb = builtOf(i), D = getD();
    if (!bb || !D) return null;
    try { return FeaturesMod.suggestTiers(bb, D.built.existingAt, get('maxStep')); } catch (e) { return null; }
  }
  function applySteps(i) {
    const sg = suggestionFor(i);
    if (!sg) return null;
    store.set(bPath(i, 'tiers'), Array.from({ length: sg.count }, () => ({ length: null, ffe: 'balance' })), { live: false });
    return sg;
  }
  const lists = {};
  const tierTableRows = (el, rows) => {
    el.textContent = '';
    const table = h('table', { class: 'grading-table' },
      h('thead', null, h('tr', null, ['Tier', 'FFE', 'Pad top', 'Step', 'Above existing'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody'));
    const body = table.querySelector('tbody');
    if (!rows.length) body.append(h('tr', null, h('td', { colspan: '5', class: 'none' }, 'No tiers.')));
    for (const r of rows) {
      const above = r.cornerMin == null ? '-' : `${r.cornerMin.toFixed(2)} to ${r.cornerMax.toFixed(2)} ft`;
      body.append(h('tr', null, h('th', { scope: 'row' }, r.id), h('td', null, E(r.ffe)), h('td', null, E(r.padTop)), h('td', null, r.step == null ? '-' : `${r.step.toFixed(2)} ft`), h('td', null, above)));
    }
    el.append(table);
  };

  function buildBuildings(body) {
    const newBuilding = (arr) => {
      let n = arr.length + 1;
      while (arr.some((b) => b.id === `B${n}`)) n++;
      const D = getD(), box = D && D.box;
      const cx = box ? Math.round(box.maxX + 80) : 0, cy = box ? Math.round((box.minY + box.maxY) / 2) : 0;
      return { id: `B${n}`, name: `Building ${n}`, source: 'typed', outer: rectRing(100, 60, cx, cy), axis: 'auto', tiers: [{ length: null, ffe: 'balance' }], padOffset: 5, padDepth: 1 };
    };
    const buildingsBind = {
      get: () => get('buildings'),
      set: (v, live) => { if (Array.isArray(v) && v.length > CONFIG.limits.maxBuildings) { warn(`Up to ${CONFIG.limits.maxBuildings} buildings.`); return; } store.set('buildings', v, { live: !!live }); },
      commit: () => store.commit(),
    };
    lists.building = mkList({
      bind: buildingsBind, addLabel: 'Add building', min: 1, reorder: true, openDefault: (i) => i === 0, empty: 'No buildings.',
      title: (i, b) => `${b.name || b.id} · ${(b.tiers || []).length} tier${(b.tiers || []).length === 1 ? '' : 's'}`,
      make: newBuilding,
      render: (i) => {
        const typed = () => bAt(i).source === 'typed';
        const tierList = mkList({
          bind: bs(bPath(i, 'tiers')), addLabel: 'Add tier', min: 1, reorder: false, openDefault: () => false, empty: '',
          title: (j, t) => `Tier ${j + 1} · FFE ${typeof t.ffe === 'number' ? E(t.ffe) : 'balanced'}${j === 0 && fromTower(i) ? ' · tower' : ''}${t.length ? ` · ${FT(t.length)}` : ''}`,
          make: () => ({ length: null, ffe: 'balance' }),
          render: (j) => ({
            children: [
              // The tower link (src/grading/towerlink.js): the first tier of the massing building takes the tower's typed base. Read-only here.
              C.when(() => j === 0 && fromTower(i), [
                h('div', { class: 'ctl' }, h('div', { class: 'ctl-label' }, 'Floor elevation'), info(() => `FFE ${E(tierBind(i, j, 'ffe').get())} ft · from tower`, 'grading-from-tower').el),
                C.help('The tower\'s typed base elevation sets this floor. Change it in the Tower Generator, or switch the tower to Follow ground.'),
              ]),
              C.when(() => !(j === 0 && fromTower(i)), [choiceB('Floor elevation', {
                get: () => (typeof tierBind(i, j, 'ffe').get() === 'number' ? 'typed' : 'balance'),
                set: (k) => {
                  if (k === 'balance') { store.set(`${bPath(i, 'tiers')}.${j}.ffe`, 'balance', { live: false }); return; }
                  const D = getD(), row = D && D.metrics ? D.metrics.tiers.find((r) => r.building === builtIdOf(bAt(i)) && r.tier === j + 1) : null;
                  store.set(`${bPath(i, 'tiers')}.${j}.ffe`, row ? rnd(row.ffe, 100) : 1000, { live: false });
                },
                commit: () => {},
              }, [['balance', 'Balance'], ['typed', 'Typed']])]),
              C.when(() => !(j === 0 && fromTower(i)) && typeof tierBind(i, j, 'ffe').get() === 'number', [C.slider({ label: 'FFE (ft)', bind: tierBind(i, j, 'ffe'), min: 0, max: 1, step: 0.01, compact: true, hardMin: -1000, hardMax: 20000, format: E, inputMode: 'decimal' })]),
              choiceB('Length along the axis', {
                get: () => (typeof tierBind(i, j, 'length').get() === 'number' ? 'typed' : 'equal'),
                set: (k) => {
                  if (k === 'equal') { store.set(`${bPath(i, 'tiers')}.${j}.length`, null, { live: false }); return; }
                  const bb = builtOf(i), n = (bAt(i).tiers || []).length || 1;
                  const L = bb && bb.outer && bb.outer.length ? Math.max(10, Math.round(polyLength(bb.outer.concat([bb.outer[0]])) / 2 / n)) : 100;
                  store.set(`${bPath(i, 'tiers')}.${j}.length`, L, { live: false });
                },
                commit: () => {},
              }, [['equal', 'Equal'], ['typed', 'Typed']]),
              C.when(() => typeof tierBind(i, j, 'length').get() === 'number', [C.slider({ label: 'Length', bind: tierBind(i, j, 'length'), min: 0, max: 1, step: 1, compact: true, hardMin: 1, hardMax: MAXD, format: FT, parse: Units.parseLength, inputMode: 'text' })]),
            ],
          }),
        });
        return {
          children: [
            textField('Name', bPath(i, 'name'), 40),
            choiceB('Footprint from', { get: () => bAt(i).source, set: (k) => setBuildingSource(i, k), commit: () => {} },
              [['typed', 'Drawn'], ['massing', 'Massing'], ...(toolOn('parking') || bAt(i).source === 'parking' ? [['parking', 'Parking']] : [])]),   // Parking only while the Parking Deck shows
            C.when(() => !typed(), [C.help('The footprint comes from the open project and is not edited here.')]),
            C.when(typed, [
              C.when(() => !!rectOf(i), [
                C.group(els([lenF('Width', null, { bind: rectBind(i, 'w'), hardMin: 5 }), lenF('Depth', null, { bind: rectBind(i, 'd'), hardMin: 5 })])),
                C.group(els([
                  C.slider({ label: 'Center east', bind: rectBind(i, 'cx'), min: 0, max: 1, step: 1, compact: true, hardMin: -1e5, hardMax: 1e5, format: FT, parse: Units.parseLength, inputMode: 'text' }),
                  C.slider({ label: 'Center north', bind: rectBind(i, 'cy'), min: 0, max: 1, step: 1, compact: true, hardMin: -1e5, hardMax: 1e5, format: FT, parse: Units.parseLength, inputMode: 'text' }),
                ])),
              ]),
              h('div', { class: 'btn-row' }, C.button('Draw footprint', () => editor.startDraw('building', { target: i }), 'outline sm'), showBtn('building', () => builtIdOf(bAt(i)))),
            ]),
            C.label('Floor elevations'),
            tierList.el,
            info(() => {
              const sg = suggestionFor(i), st = store.raw();
              if (!sg) return '';
              const cur = (bAt(i).tiers || []).length;
              return sg.count > 1
                ? `The existing ground changes ${sg.rise.toFixed(2)} ft along this building. A step of ${st.maxStep} ft or less needs ${sg.count} tiers of ${FT(sg.lengths[0])}. It has ${cur}.`
                : `The existing ground changes ${sg.rise.toFixed(2)} ft along this building, within the ${st.maxStep} ft largest step. One tier is enough.`;
            }),
            C.when(() => { const sg = suggestionFor(i); return !!sg && !(sg.count === 1 && (bAt(i).tiers || []).length === 1); },
              [h('div', { class: 'btn-row' }, C.button('Apply the suggestion', () => { const sg = applySteps(i); if (sg) ctx.bus.emit('notice', { text: `${sg.count} tier${sg.count === 1 ? '' : 's'}, each balanced on the existing ground.`, kind: 'info' }); }, 'outline sm'))]),
            caution(CONFIG.stepCaution),
          ],
          more: [
            C.group(els([lenF('Pad offset', bPath(i, 'padOffset'), { step: 1, hardMin: 0, hardMax: 200 }), lenF('Pad depth', bPath(i, 'padDepth'), { step: 0.25, hardMin: 0, hardMax: 20 })])),
            C.help('The pad offset grows the pad past the footprint. The pad top is the FFE minus the pad depth (the slab and the base under the floor).'),
            choiceB('Tier axis', { get: () => (typeof bAt(i).axis === 'number' ? 'typed' : 'auto'), set: (k) => store.set(bPath(i, 'axis'), k === 'auto' ? 'auto' : 0, { live: false }), commit: () => {} }, [['auto', 'Automatic'], ['typed', 'Typed']]),
            C.when(() => typeof bAt(i).axis === 'number', [degS('Axis angle', bPath(i, 'axis'), 0, 180, { hardMin: -360, hardMax: 360 })]),
          ],
        };
      },
    });
    body.append(...els([
      choiceB('Work is on', { get: () => get('source'), set: (k) => tool.setSource(k), commit: () => {} }, [['standalone', SOURCE_LABELS.standalone], ['project', SOURCE_LABELS.project]]),
      C.help(toolOn('parking') ? 'Standalone uses the typed ground and the buildings below. An open project adds its massing and parking deck as buildings and, when it has one, its site ground.' : 'Standalone uses the typed ground and the buildings below. An open project adds its massing as a building and, when it has one, its site ground.'),
      info(() => {
        const D = getD();
        if (!D) return '';
        const tw = D.warnings.find((w) => w.id === 'tower-no-levels');
        if (tw) return tw.text;
        return (D.notes || []).join(' ');
      }),
      C.label('Buildings'),
      lists.building.el,
      C.label('Balance and steps'),
      choice('Balance each pad on', 'balance', [['pad', 'The pad only'], ['site', 'The whole site']]),
      C.help('The pad balances cut and fill under the pad. The whole site includes the daylight slopes around it.'),
      lenS('Largest step between tiers', 'maxStep', 1, 12, { step: 0.5, hardMin: 0.5, hardMax: 40, format: (v) => `${round1(v)} ft` }),
      C.label('Tiers'),
      dyn('grading-tiers', (el) => { const D = getD(); tierTableRows(el, D ? D.hud.tiers : []); }),
      C.help('Above existing is the height of the FFE over the existing ground at the corners of the building. A negative value means the building sits below the existing ground.'),
      caution(CONFIG.stepCaution),
    ]));
  }

  /* ==========================================================================
     Ground
     ========================================================================== */
  function legendEl() {
    return dyn('grading-legend', (el) => {
      el.textContent = '';
      const e = CONFIG.diffEdges;
      const labels = [`Under ${e[0]} ft`, `${e[0]} to ${e[1]} ft`, `${e[1]} to ${e[2]} ft`, `${e[2]} to ${e[3]} ft`, `Over ${e[3]} ft`];
      const row = (color, text) => h('div', { class: 'grading-lg-row' }, h('span', { class: 'grading-sw', style: `background:${color}` }), h('span', null, text));
      el.append(h('div', { class: 'label sub-label' }, 'Fill (new ground above existing)'));
      CONFIG.fillColors.forEach((c, i) => el.append(row(c, labels[i])));
      el.append(h('div', { class: 'label sub-label' }, 'Cut (new ground below existing)'));
      CONFIG.cutColors.forEach((c, i) => el.append(row(c, labels[i])));
      el.append(row(CONFIG.noChangeColor, 'Unchanged'));
    });
  }

  function buildGround(body) {
    const mode = () => get('ground.mode');
    body.append(...els([
      choiceB('Existing ground', {
        get: mode,
        set: (k) => {
          if (k === 'site' && !projectInfo(doc()).siteGround) { warn(doc() ? 'The project has no site ground yet. Make one in the Site Model.' : 'Open a project with a site first.'); return; }
          store.set('ground.mode', k, { live: false });
        },
        commit: () => {},
      }, [['plane', 'Typed plane'], ['site', 'Project site']]),
      C.when(() => mode() === 'plane', [
        C.slider({ label: 'Elevation at the origin', bind: bs('ground.plane.z0'), min: 900, max: 1100, step: 1, hardMin: -1000, hardMax: 20000, format: E, inputMode: 'decimal' }),
        numS('Slope', 'ground.plane.slope', 0, 30, 0.5, '%', { hardMin: -100, hardMax: 100 }),
        degS('Falls toward', 'ground.plane.downhill', 0, 360, { hardMin: 0, hardMax: 360 }),
        info(() => { const st = store.raw(); return `Falls toward ${compassOf(st.ground.plane.downhill)} at ${round1(st.ground.plane.slope)} percent.`; }),
        lenS('Margin around the work', 'ground.margin', 50, 400, { hardMax: 2000, step: 10 }),
        C.help('A typed plane is a flat tilted surface. Elevations are local feet. The north direction is 0 degrees and east is 90.'),
      ]),
      C.when(() => mode() === 'site', [
        C.help('The existing ground comes from the Site Model of the open project. Elevations are NAVD88 feet.'),
        caution('Caution: the USGS ground can differ from a survey. FFEs can be off by a foot or more. Confirm every elevation against a survey.'),
      ]),
      C.label('Daylight slopes'),
      C.toggle({ label: 'Daylight slopes on', bind: bs('daylight.on') }),
      C.when(() => !!get('daylight.on'), [
        C.slider({ label: 'Fill slope (run : rise)', bind: bs('daylight.fill'), min: 1.5, max: 6, step: 0.5, hardMin: 0.5, hardMax: 12, format: (v) => `${round1(v)} : 1`, inputMode: 'decimal' }),
        C.slider({ label: 'Cut slope (run : rise)', bind: bs('daylight.cut'), min: 1, max: 4, step: 0.5, hardMin: 0.5, hardMax: 12, format: (v) => `${round1(v)} : 1`, inputMode: 'decimal' }),
      ]),
      caution(CONFIG.daylightCaution),
      C.label('Contours'),
      C.toggle({ label: 'Contours', bind: bs('view.contours.on') }),
      C.when(() => !!get('view.contours.on'), [
        choice('Interval', 'view.contours.interval', [[1, '1 ft'], [2, '2 ft']]),
        C.toggle({ label: 'Proposed contours', bind: bs('view.contours.proposed') }),
        C.toggle({ label: 'Existing contours (dashed)', bind: bs('view.contours.existing') }),
      ]),
      C.help('Diagram style (key D) colors the proposed ground by cut and fill and draws the zero line. Plan labels show in the Plan view and in Diagram style.'),
      C.when(() => ctx.scene.style() === 'diagram', [legendEl()]),
    ]));
  }

  /* ==========================================================================
     Drives and lots
     ========================================================================== */
  function buildDrives(body) {
    lists.drive = mkList({
      bind: bs('drives'), addLabel: 'Add', min: 0, reorder: false, openDefault: () => false, empty: 'No drives yet.',
      title: (i, d) => `${d.id} · ${FT(polyLength(d.line))} · ${round1(d.slope)}%`,
      make: () => ({ id: 'D0', line: [[0, 0], [0, 50]], width: 24, start: 'existing', slope: 5, cross: 2, crown: true }),
      render: (i) => ({
        children: [
          lenS('Width', `drives.${i}.width`, 10, 60, { hardMin: 4, hardMax: 200 }),
          numS('Slope along the drive', `drives.${i}.slope`, -15, 15, 0.5, '%', { hardMin: -30, hardMax: 30 }),
          numS('Cross slope', `drives.${i}.cross`, 0, 6, 0.5, '%', { hardMin: 0, hardMax: 20 }),
          C.toggle({ label: 'Crowned', bind: bs(`drives.${i}.crown`) }),
          choiceB('Starts at', startBind(`drives.${i}.start`), [['existing', 'Existing ground'], ['typed', 'Typed elevation']]),
          C.when(() => typeof get(`drives.${i}.start`) === 'number', [startElev(`drives.${i}.start`)]),
          h('div', { class: 'btn-row' }, showBtn('drive', () => idAt('drives', i)), redrawBtn('drive', () => idAt('drives', i))),
        ],
      }),
    });
    lists.lot = mkList({
      bind: bs('lots'), addLabel: 'Add', min: 0, reorder: false, openDefault: () => false, empty: 'No lots yet.',
      title: (i, l) => `${l.id} · ${Units.formatArea(Math.abs(ringArea(l.ring)))} · ${round1(l.slope)}%`,
      make: () => ({ id: 'L0', ring: [[0, 0], [60, 0], [60, 60], [0, 60]], anchor: null, start: 'existing', dir: 0, slope: 2, cross: 1 }),
      render: (i) => ({
        children: [
          numS('Slope uphill', `lots.${i}.slope`, 0, 8, 0.5, '%', { hardMin: -30, hardMax: 30 }),
          numS('Cross slope', `lots.${i}.cross`, -4, 4, 0.5, '%', { hardMin: -30, hardMax: 30 }),
          degS('Uphill direction', `lots.${i}.dir`, 0, 360, { hardMin: 0, hardMax: 360 }),
          choiceB('Starts at', startBind(`lots.${i}.start`), [['existing', 'Existing ground'], ['typed', 'Typed elevation']]),
          C.when(() => typeof get(`lots.${i}.start`) === 'number', [startElev(`lots.${i}.start`)]),
          h('div', { class: 'btn-row' }, showBtn('lot', () => idAt('lots', i)), redrawBtn('lot', () => idAt('lots', i))),
        ],
      }),
    });
    body.append(...els([
      C.label('Drives'),
      drawBtn('drive', 'Draw a drive'),
      drawList(lists.drive),
      C.label('Lots'),
      drawBtn('lot', 'Draw a lot'),
      drawList(lists.lot),
      C.label('Limits'),
      C.group(els([pctS('Lot slope, least', 'limits.lotMin', 0.5, 3, 0.1, { compact: true }), pctS('Lot slope, most', 'limits.lotMax', 2, 8, 0.1, { compact: true })])),
      pctS('Drive slope, most', 'limits.driveMax', 4, 15, 0.5, { compact: true }),
      caution(CONFIG.gradeCaution),
    ]));
  }

  /* ==========================================================================
     Walls and the property line
     ========================================================================== */
  const wallRow = (id) => { const D = getD(); return D && D.metrics && D.metrics.walls && D.metrics.walls.list ? D.metrics.walls.list.find((w) => w.id === id) : null; };
  function buildWalls(body) {
    lists.wall = mkList({
      bind: bs('walls'), addLabel: 'Add', min: 0, reorder: false, openDefault: () => false, empty: 'No drawn walls yet. Press W, then tap the points.',
      title: (i, w) => { const r = wallRow(w.id); return `${w.id} · ${FT(polyLength(w.line))}${r ? ` · up to ${fmt.wall(r.heightMax)}` : ''}`; },
      make: () => ({ id: 'W0', line: [[0, 0], [50, 0]], kind: 'drawn' }),
      render: (i) => ({
        children: [
          info(() => {
            const w = store.raw().walls[i], r = w && wallRow(w.id);
            return r ? `Up to ${fmt.wall(r.heightMax)} tall, ${fmt.wall(r.heightAvg)} on average, ${FT(r.length)} long.${r.flagged ? ` Over the ${store.raw().limits.wallFlag} ft flag.` : ''}` : '';
          }),
          h('div', { class: 'btn-row' }, showBtn('wall', () => idAt('walls', i)), redrawBtn('wall', () => idAt('walls', i))),
        ],
      }),
    });
    body.append(...els([
      C.label('Property line'),
      choiceB('Property line', {
        get: () => get('property.mode'),
        set: (k) => {
          if (k === 'site') store.set('property', { mode: 'site', ring: [] }, { live: false });
          else if ((get('property.ring') || []).length >= 3) store.set('property.mode', 'drawn', { live: false });
          else editor.startDraw('property');
        },
        commit: () => {},
      }, [['site', 'Site edge'], ['drawn', 'Drawn']]),
      C.help('The site edge is the edge of the ground grid (or the project boundary). A drawn line is closed by tapping its first point. Daylight slopes stop, and automatic walls follow, this line.'),
      h('div', { class: 'btn-row' }, C.button('Draw property line', () => editor.startDraw('property'), 'outline sm'), C.when(() => get('property.mode') === 'drawn', [showBtn('property', () => 'property')]).el),
      C.label('Walls'),
      drawBtn('wall', 'Draw a wall'),
      drawList(lists.wall),
      info(() => {
        const D = getD();
        const n = (D && D.metrics && D.metrics.walls ? D.metrics.walls.list : []).filter((w) => w.kind === 'pad-step').length;
        return n ? `${n} pad-step wall${n === 1 ? '' : 's'} between tiers. They follow the tiers.` : '';
      }),
      lenS('Flag a wall taller than', 'limits.wallFlag', 2, 8, { step: 0.5, hardMin: 0.5, hardMax: 100, format: (v) => `${round1(v)} ft` }),
      C.label('Automatic walls'),
      C.toggle({ label: 'Add walls where the daylight slope leaves the site', bind: bs('autoWalls.on') }),
      C.when(() => !!get('autoWalls.on'), [lenS('Offset inside the property line', 'autoWalls.offset', 0, 30, { hardMax: 100 })]),
      C.help('An automatic wall follows the property line where the daylight slope would pass it. It stays dashed until you accept it.'),
      dyn('grading-autos', (el) => {
        el.textContent = '';
        const D = getD(), st = store.raw();
        const autos = (D && D.metrics && D.metrics.walls ? D.metrics.walls.list : []).filter((w) => w.kind === 'auto');
        for (const w of autos) {
          el.append(h('div', { class: 'grading-auto' },
            h('span', { class: 'grading-grow' }, `${w.id} · ${FT(w.length)} · up to ${fmt.wall(w.heightMax)}`),
            h('button', { class: 'btn outline sm', type: 'button', 'aria-pressed': String(!!w.accepted), onclick: () => tool.toggleAutoWall(w.id) }, w.accepted ? 'Accepted' : 'Accept'),
            h('button', { class: 'btn outline sm', type: 'button', onclick: () => editor.showItem({ kind: 'wall', id: w.id }) }, 'Show')));
        }
        if (!autos.length) el.append(h('p', { class: 'help' }, st.autoWalls.on ? 'No automatic walls. The daylight slopes stay inside the property line.' : 'Automatic walls are off.'));
      }),
      caution(CONFIG.wallCaution),
    ]));
  }

  /* ==========================================================================
     Routes
     ========================================================================== */
  function buildRoutes(body) {
    lists.route = mkList({
      bind: bs('routes'), addLabel: 'Add', min: 0, reorder: false, openDefault: () => false, empty: 'No routes yet. Press R, then tap the points.',
      title: (i, r) => { const D = getD(), m = D && D.metrics && D.metrics.routes ? D.metrics.routes.find((x) => x.id === r.id) : null; return `${r.name}${m ? ` · ${pct1(m.maxSlope)}` : ''}`; },
      make: () => ({ id: 'R0', line: [[0, 0], [50, 0]], name: 'Route' }),
      render: (i) => ({
        children: [
          textField('Name', `routes.${i}.name`, 40),
          info(() => {
            const r = store.raw().routes[i], D = getD();
            const rm = r && D && D.metrics && D.metrics.routes ? D.metrics.routes.find((x) => x.id === r.id) : null;
            return rm ? `Steepest running slope ${pct1(rm.maxSlope)}, steepest cross slope ${pct1(rm.maxCross)}. ${classWord(rm.kind)}.` : '';
          }),
          h('div', { class: 'btn-row' }, showBtn('route', () => idAt('routes', i)), redrawBtn('route', () => idAt('routes', i))),
        ],
      }),
    });
    body.append(...els([
      drawBtn('route', 'Draw a route'),
      drawList(lists.route),
      C.label('Limits'),
      C.group(els([pctS('Walk running slope', 'limits.walk', 2, 8, 0.1, { compact: true }), pctS('Ramp running slope', 'limits.ramp', 5, 10, 0.1, { compact: true })])),
      C.group(els([pctS('Cross slope', 'limits.cross', 1, 4, 0.1, { compact: true }), lenF('Ramp rise per run', 'limits.rampRise', { step: 0.5, hardMin: 0.5, hardMax: 20, format: (v) => `${round1(v)} ft` })])),
      C.label('Colors'),
      h('div', { class: 'grading-legend' }, ...['walk', 'ramp', 'fail'].map((k) => h('div', { class: 'grading-lg-row' }, h('span', { class: 'grading-sw', style: `background:${CONFIG.classColors[k]}` }), h('span', null, CONFIG.classLabels[k])))),
      caution(CONFIG.routeCaution),
    ]));
  }

  /* ==========================================================================
     Earthwork
     ========================================================================== */
  function buildEarthwork(body) {
    body.append(...els([
      dyn('kv grading-kv', (el) => {
        const D = getD();
        if (!D || !D.ok) { el.textContent = ''; return; }
        const m = D.hud;
        kvRows(el, [
          ['Cut', fmt.cy(m.cutCy)], ['Fill', fmt.cy(m.fillCy)], ['Net (fill minus cut)', fmt.signed(m.netCy, (x) => fmt.cy(x))],
          ['Net with bulking', fmt.signed(m.bulkedNetCy, (x) => fmt.cy(x))], ['Balance', `${(m.balance * 100).toFixed(1)}%`],
          ['Pad area', Units.formatArea(m.padArea)], ['Disturbed area', Units.formatArea(m.disturbed)], ['Wall length', FT(m.wallLength)],
          ['Tallest wall', fmt.wall(m.wallMax)], ['Average wall', fmt.wall(m.wallAvg)], ['Steepest route', m.routes.length ? pct1(m.steepestRoute) : 'no routes'],
          ['Sub-cells per cell', `${m.subdivide} by ${m.subdivide}`], ['Grid cells sampled', Units.formatInt(m.cellsSampled)],
        ]);
      }),
      C.label('Settings'),
      intS('Sub-cells per grid cell (per side)', 'earthwork.subdivide', 1, 8, { hardMin: 1, hardMax: 8 }),
      C.slider({ label: 'Bulking factor', bind: bs('earthwork.bulking'), min: 0.8, max: 1.4, step: 0.01, hardMin: 0.5, hardMax: 2, format: (v) => v.toFixed(2), inputMode: 'decimal' }),
      C.label('Cut and fill colors'),
      legendEl(),
      caution(CONFIG.earthCaution),
      caution(CONFIG.sketchCaution),
    ]));
  }

  /* ---------- the groups ---------- */
  const group = (id, title, build, open) => ({
    id, title, open: !!open,
    build: (el) => { try { build(el); } catch (e) { console.error(e); } C.refreshAll(); },
  });
  return {
    groups: () => [
      group('grading-buildings', 'Buildings', buildBuildings, true),
      group('grading-ground', 'Ground', buildGround, false),
      group('grading-drives', 'Drives and lots', buildDrives, false),
      group('grading-walls', 'Walls', buildWalls, false),
      group('grading-routes', 'Routes', buildRoutes, false),
      group('grading-earthwork', 'Earthwork', buildEarthwork, false),
    ],
    refresh: () => C.refreshAll(),
    applySteps,
    /** Which panel shows an item. */
    panelOf: (kind) => ({ building: 'grading-buildings', drive: 'grading-drives', lot: 'grading-drives', wall: 'grading-walls', property: 'grading-walls', route: 'grading-routes' }[kind] || null),
    /** Opens the row of an item in its list. */
    openRow(kind, id) {
      const map = { building: ['building', 'buildings'], drive: ['drive', 'drives'], lot: ['lot', 'lots'], wall: ['wall', 'walls'], route: ['route', 'routes'] }[kind];
      if (!map || !lists[map[0]]) return;
      const arr = get(map[1]) || [];
      const i = arr.findIndex((x) => (kind === 'building' ? builtIdOf(x) : x.id) === id);
      if (i >= 0) { try { lists[map[0]].openAt(i); } catch (e) { /* the panel is closed */ } }
    },
  };
}
