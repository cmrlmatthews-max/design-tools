/* ==========================================================================
   SHELL PANELS
   The panels every tool shares: Metrics (top), Layers and Warnings (bottom), and the selection card over the view.
   The project numbers come from src/viewer/summary.js (the same numbers the Model Viewer showed).
   ========================================================================== */
import { summary, staleFlags } from '../../src/viewer/summary.js';
import { TOOLS, toolOn } from '../tools/registry.js';
import { platesCurrent } from './cover.js';

const TOOL_LABEL = Object.fromEntries(TOOLS.map((t) => [t.id, t.label]));
const OWNER_ALIAS = { plate: 'plates', midrise: 'tower' };
const ownerId = (o) => OWNER_ALIAS[o] || o;

export function createShellPanels(ctx, { loaded, activeId }) {
  const { h, ICONS } = ctx.ui;
  const toolOf = (id) => loaded().get(id) || null;
  const activeTool = () => (activeId() ? toolOf(activeId()) : null);

  /* ---------- metrics ---------- */
  /* One set of model numbers in every tool (Cade, October 28, 2026): the same six rows, from the saved project, in one
     format. The Site tool shows its site rows instead while it is the active tool. */
  const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
  const fmtFtIn = (ft) => { const t = Math.round(ft * 12); const f = Math.floor(t / 12), i = t - f * 12; return `${f.toLocaleString('en-US')}'-${i}"`; };
  function projectRows() {
    const doc = ctx.project.doc();
    if (!doc) return [];
    let rows = [];
    try { rows = summary(doc) || []; } catch (e) { rows = []; }
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    const out = [];
    const num = (id) => (by[id] && Number.isFinite(Number(by[id].value)) ? Number(by[id].value) : null);
    if (num('massing.gfa') !== null) out.push({ label: 'Gross floor area', value: `${fmtInt(num('massing.gfa'))} sf` });
    if (num('massing.floors') !== null) out.push({ label: 'Floors', value: fmtInt(num('massing.floors')) });
    if (num('massing.height') !== null) out.push({ label: 'Height', value: fmtFtIn(num('massing.height')) });
    if (num('massing.far') !== null && num('massing.far') > 0) out.push({ label: 'FAR', value: num('massing.far').toFixed(2) });
    const current = toolOn('plates') && platesCurrent(doc);
    if (current && num('plates.units') !== null) out.push({ label: 'Units', value: fmtInt(num('plates.units')) });
    else if (num('massing.units') !== null) out.push({ label: 'Units (estimate)', value: fmtInt(num('massing.units')) });
    if (current && num('plates.efficiency') !== null) out.push({ label: 'Efficiency', value: `${Math.round(num('plates.efficiency') * 100)}%` });
    if (!out.length && num('site.area') !== null) out.push({ label: 'Site area', value: `${fmtInt(num('site.area'))} sf` });
    return out;
  }

  function metricRows() {
    // Only the Site tool shows its own rows (the site numbers); every other state shows the same model numbers.
    if (activeId() === 'site') {
      const t = activeTool();
      let rows = [];
      if (t && t.metrics) { try { rows = t.metrics(ctx) || []; } catch (e) { rows = []; } }
      if (rows.length) return rows;
    }
    return projectRows();
  }

  function buildMetrics(body) {
    const rows = metricRows();
    if (!rows.length) {
      body.append(h('p', { class: 'muted' }, ctx.project.doc() ? 'This project has no numbers yet.' : 'Open or import a project from the project menu.'));
      return;
    }
    body.append(h('div', { class: 'metric-grid' }, ...rows.map((r) => h('div', { class: 'metric', title: r.hint || '' }, h('span', { class: 'metric-label' }, r.label), h('span', { class: 'metric-value' }, String(r.value))))));
  }

  /* ---------- layers ---------- */
  function buildLayers(body) {
    const list = ctx.layers.list().filter((l) => !l.replaced && l.listed !== false);
    if (!list.length) { body.append(h('p', { class: 'muted' }, 'No layers yet.')); return; }
    for (const l of list) {
      const sw = h('input', { type: 'checkbox', class: 'switch', checked: l.on ? '' : null, 'aria-label': `Show ${l.label}` });
      sw.checked = !!l.on;
      sw.addEventListener('change', () => ctx.layers.setOn(l.id, sw.checked));
      body.append(h('label', { class: 'layer-row' },
        h('span', { class: 'layer-text' }, h('span', { class: 'layer-label' }, l.label)),
        sw));
    }
    // The neighbor style moved to the top bar (Cade, October 28, 2026).
    const doc = ctx.project.doc();
    const SRC_TOOL = { massing: 'tower', plates: 'plates', parking: 'parking' };
    const levels = (doc && ctx.layers.levels ? ctx.layers.levels(doc) : []).filter((v) => !Array.isArray(v.sources) || v.sources.some((src) => toolOn(SRC_TOOL[src] || src)));
    if (levels.length) {
      const sel = h('select', { class: 'select', 'aria-label': 'Cut at level' }, h('option', { value: '' }, 'No cut'), ...levels.map((v) => h('option', { value: v.key }, v.name || `Level at ${Math.round(v.z)} ft`)));
      sel.value = ctx.layers.cut() || '';
      sel.addEventListener('change', () => { ctx.layers.setCut(sel.value || null); });
      body.append(h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, 'Level cut'), sel));
    }
  }

  /* ---------- warnings ---------- */
  function warningRows() {
    const out = [];
    const t = activeTool();
    if (t && t.warnings) { try { out.push(...(t.warnings(ctx) || [])); } catch (e) { /* a tool error never breaks the panel */ } }
    const doc = ctx.project.doc();
    const SEC_TOOL = { site: 'site', massing: 'tower', plates: 'plates', parking: 'parking', grading: 'grading', facade: 'facade', sun: 'tower' };
    if (doc) { try { staleFlags(doc).filter((f) => toolOn(SEC_TOOL[f.section] || f.section)).forEach((f) => out.push({ text: plainStale(f), level: 'warn' })); } catch (e) { /* ignore */ } }
    return out;
  }

  // The app has no Plate Planner button: say what happened, not where to go.
  function plainStale(f) {
    if (f.section === 'plates' && /older massing/.test(f.message)) return 'The units were made for an earlier tower. The tower shows every floor until the units are made again.';
    return String(f.message || '').replace(/ Open the [A-Z][\w ]+ to update (it|them)\./, '');
  }

  function buildWarnings(body) {
    const rows = warningRows();
    if (!rows.length) { body.append(h('p', { class: 'muted' }, 'No warnings.')); return; }
    rows.forEach((w) => body.append(h('div', { class: `warn-row ${w.level || 'info'}` }, w.text)));
  }

  /* ---------- groups ---------- */
  const metricsGroup = () => ({ id: 'shell-metrics', title: 'Metrics', build: buildMetrics, open: true, owner: 'shell' });
  /* ---------- view: one look in every tool (Cade, October 28, 2026) ---------- */
  function buildView(body) {
    const C = ctx.ui.Controls;
    const V = () => ctx.view.get();
    const bind = (key) => ({ get: () => V()[key], set: (v) => ctx.view.set({ [key]: v }), commit: () => {} });
    const sunBind = (key) => ({ get: () => V().sun[key], set: (v) => ctx.view.set({ sun: { [key]: v } }), commit: () => {} });
    const parts = [
      C.segmented({ label: 'Color by', bind: bind('colorBy'), options: [{ value: 'program', label: 'Program' }, { value: 'zone', label: 'Zone' }] }),
      C.toggle({ label: 'Floor lines', bind: bind('floorLines') }),
      C.toggle({ label: 'Shadows', bind: bind('shadows') }),
      C.slider({ label: 'Sun azimuth', bind: sunBind('az'), min: 0, max: 360, hardMin: 0, hardMax: 360, step: 1, format: (v) => `${Math.round(v)}°` }),
      C.slider({ label: 'Sun altitude', bind: sunBind('alt'), min: 3, max: 90, hardMin: 3, hardMax: 90, step: 1, format: (v) => `${Math.round(v)}°` }),
    ];
    parts.forEach((p) => body.append(p.el));
    // the color legend of the Diagram style (from the tools that draw colors)
    const items = [];
    loaded().forEach((t) => { if (t.legend) { try { (t.legend(ctx) || []).forEach((x) => items.push(x)); } catch (e) { /* ignore */ } } });
    if (items.length) body.append(h('div', { class: 'legend-list' }, ...items.map((x) => h('span', { class: 'legend-item' }, h('span', { class: 'legend-sw', style: `background:${x.color}` }), x.label))));
    body.append(h('p', { class: 'help' }, 'These settings apply in every tool. Color by applies in the Diagram style (top bar, or the D key).'));
  }

  const groups = () => [
    { id: 'shell-view', title: 'View', build: buildView, open: false, owner: 'shell' },
    { id: 'shell-layers', title: 'Layers', build: buildLayers, open: !activeId(), owner: 'shell' },
    // Warnings hidden October 28, 2026 (Cade). See docs/removed-features.md. buildWarnings stays for later.
  ];
  const countLabel = (n) => (n ? ` (${n})` : '');

  function refresh(which) {
    if (!which || which.includes('warnings')) { try { ctx.panelsApi && ctx.panelsApi.setTitle('shell-warnings', `Warnings${countLabel(warningRows().length)}`); } catch (e) { /* panel not shown */ } }
    const ids = { metrics: 'shell-metrics', layers: 'shell-layers', warnings: 'shell-warnings', view: 'shell-view' };
    (which || Object.keys(ids)).forEach((k) => { try { refreshPanel(ids[k]); } catch (e) { /* panel not shown */ } });
  }
  let refreshPanel = () => {};
  function setRefresher(fn) { refreshPanel = fn; }

  /* ---------- selection card ---------- */
  function renderCard(selection, { openTool }) {
    const el = document.getElementById('card');
    if (!el) return;
    el.replaceChildren();
    if (!selection) { el.hidden = true; return; }
    const { item, owner } = selection;
    const oid = ownerId(owner || item.owner || item.tool);
    const close = h('button', { class: 'btn icon card-close', type: 'button', 'aria-label': 'Close', onclick: () => ctx.select(null) });
    close.innerHTML = ICONS.close;
    el.append(h('div', { class: 'card-head' }, h('span', { class: 'card-title' }, (item.data && item.data.title) || item.title || 'Item'), close));
    const rows = (item.data && item.data.rows) || item.rows || [];
    if (rows.length) el.append(h('table', { class: 'card-rows' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, String(v))))));
    const actions = [];
    const entry = TOOLS.find((t) => t.id === oid);
    if (entry && entry.ready && !entry.viewOnly && activeId() !== oid) actions.push({ label: `Edit in ${entry.label}`, action: () => openTool(oid) });
    const t = toolOf(oid);
    if (t && t.card) { try { actions.push(...(t.card(item, ctx) || [])); } catch (e) { /* ignore */ } }
    if (actions.length) el.append(h('div', { class: 'card-actions' }, ...actions.map((a) => h('button', { class: 'btn', type: 'button', onclick: a.action }, a.label))));
    el.hidden = false;
  }

  return { metricsGroup, groups, refresh, setRefresher, renderCard, metricRows };
}
