/* ==========================================================================
   SHELL PANELS
   The panels every tool shares: Metrics (top), Layers and Warnings (bottom), and the selection card over the view.
   The project numbers come from src/viewer/summary.js (the same numbers the Model Viewer showed).
   ========================================================================== */
import { summary, staleFlags } from '../../src/viewer/summary.js';
import { TOOLS } from '../tools/registry.js';

const TOOL_LABEL = Object.fromEntries(TOOLS.map((t) => [t.id, t.label]));
const OWNER_ALIAS = { plate: 'plates', midrise: 'tower' };
const ownerId = (o) => OWNER_ALIAS[o] || o;
const SUMMARY_IDS = ['gfa', 'far', 'floors', 'height', 'units', 'efficiency', 'stalls', 'cut', 'fill', 'net'];

export function createShellPanels(ctx, { loaded, activeId }) {
  const { h, ICONS } = ctx.ui;
  const toolOf = (id) => loaded().get(id) || null;
  const activeTool = () => (activeId() ? toolOf(activeId()) : null);

  /* ---------- metrics ---------- */
  function projectRows() {
    const doc = ctx.project.doc();
    if (!doc) return [];
    let rows = [];
    try { rows = summary(doc) || []; } catch (e) { rows = []; }
    let pick = rows.filter((r) => SUMMARY_IDS.some((k) => String(r.id).toLowerCase().includes(k)));
    // Counted units (Plate Planner) replace the massing estimate.
    const counted = pick.some((r) => r.label === 'Units');
    if (counted) pick = pick.filter((r) => !/estimate/i.test(r.label));
    return (pick.length ? pick : rows).slice(0, 8).map((r) => ({ label: r.label, value: r.text, group: r.group }));
  }

  function metricRows() {
    const t = activeTool();
    let rows = [];
    if (t && t.metrics) { try { rows = t.metrics(ctx) || []; } catch (e) { rows = []; } }
    return rows.length ? rows : projectRows();
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
    const list = ctx.layers.list().filter((l) => !l.replaced);
    if (!list.length) { body.append(h('p', { class: 'muted' }, 'No layers yet.')); return; }
    for (const l of list) {
      const sw = h('input', { type: 'checkbox', class: 'switch', checked: l.on ? '' : null, 'aria-label': `Show ${l.label}` });
      sw.checked = !!l.on;
      sw.addEventListener('change', () => ctx.layers.setOn(l.id, sw.checked));
      body.append(h('label', { class: 'layer-row' },
        h('span', { class: 'layer-text' }, h('span', { class: 'layer-label' }, l.label), h('span', { class: 'layer-sub' }, [TOOL_LABEL[ownerId(l.owner)], l.count ? `${l.count}` : ''].filter(Boolean).join(' · '))),
        sw));
    }
    const style = h('select', { class: 'select', 'aria-label': 'Neighbor buildings' }, ...[['solid', 'Solid'], ['glass', 'Glass'], ['wireframe', 'Wireframe']].map(([v, t]) => h('option', { value: v }, t)));
    style.value = ctx.siteStyle ? ctx.siteStyle() : 'solid';
    style.addEventListener('change', () => ctx.setSiteStyle && ctx.setSiteStyle(style.value));
    body.append(h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, 'Neighbors'), style));
    const doc = ctx.project.doc();
    const levels = doc && ctx.layers.levels ? ctx.layers.levels(doc) : [];
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
    if (doc) { try { staleFlags(doc).forEach((f) => out.push({ text: f.message, level: 'warn' })); } catch (e) { /* ignore */ } }
    return out;
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
    const style = { get: () => ctx.scene.style(), set: (v) => ctx.scene.setStyle(v), commit: () => {} };
    const parts = [
      C.segmented({ label: 'Style', bind: style, options: [{ value: 'model', label: 'Model' }, { value: 'diagram', label: 'Diagram' }] }),
      C.segmented({ label: 'Color by', bind: bind('colorBy'), options: [{ value: 'program', label: 'Program' }, { value: 'zone', label: 'Zone' }] }),
      C.toggle({ label: 'Floor lines', bind: bind('floorLines') }),
      C.toggle({ label: 'Shadows', bind: bind('shadows') }),
      C.slider({ label: 'Sun azimuth', bind: sunBind('az'), min: 0, max: 360, step: 1, format: (v) => `${Math.round(v)}°` }),
      C.slider({ label: 'Sun altitude', bind: sunBind('alt'), min: 3, max: 90, step: 1, format: (v) => `${Math.round(v)}°` }),
    ];
    parts.forEach((p) => body.append(p.el));
    body.append(h('p', { class: 'help' }, 'These settings apply in every tool. Color by applies in the Diagram style.'));
  }

  const groups = () => [
    { id: 'shell-view', title: 'View', build: buildView, open: false, owner: 'shell' },
    { id: 'shell-layers', title: 'Layers', build: buildLayers, open: !activeId(), owner: 'shell' },
    { id: 'shell-warnings', title: `Warnings${countLabel(warningRows().length)}`, build: buildWarnings, open: false, owner: 'shell' },
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
    if (oid === 'plates' && !t) {
      // The plates tool loads lazily; its only action is a link to its own page.
      const doc = ctx.project.doc();
      if (doc) actions.push({ label: 'Open Plate Planner', action: () => { window.location.href = `../plate/?project=${encodeURIComponent(doc.id)}`; } });
    }
    if (actions.length) el.append(h('div', { class: 'card-actions' }, ...actions.map((a) => h('button', { class: 'btn', type: 'button', onclick: a.action }, a.label))));
    el.hidden = false;
  }

  return { metricsGroup, groups, refresh, setRefresher, renderCard, metricRows };
}
