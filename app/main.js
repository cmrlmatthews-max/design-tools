/* ==========================================================================
   MAIN
   Starts the shell: one scene, one project, the dock, the panels, the top bar, the derived layers, and the tools.
   docs/shell-plan.md is the plan. app/CONTRACT.md fixes the module APIs.
   ========================================================================== */
import * as THREE from 'three';
import { bus } from './core/bus.js';
import { createStore } from './core/store.js';
import { createProjectStore } from './core/project-store.js';
import * as frame from './core/frame.js';
import { createScene } from './core/scene.js';
import { createInput } from './core/input.js';
import { createKeys } from './core/keys.js';
import { createLayers } from './core/layers.js';
import { derivedLayerDefs } from './core/derived.js';
import { createGround } from './core/ground.js';
import { captureImage, deliver } from './core/capture.js';
import { h, ICONS, Toast, Pop, Controls, confirmDialog } from './core/ui-kit.js';
import { createDock } from './core/dock.js';
import { createPanels } from './core/panels.js';
import { createShellPanels } from './core/shell-panels.js';
import { TOOLS } from './tools/registry.js';

const $ = (id) => document.getElementById(id);
const VIEWS = [['axon', 'Axon', '1'], ['n', 'N', '2'], ['e', 'E', '3'], ['s', 'S', '4'], ['w', 'W', '5'], ['plan', 'Plan', '6']];

/* ---------- core objects ---------- */
const project = createProjectStore({ bus });
const scene = createScene($('view'), { bus });
const input = createInput(scene, { bus });
const keys = createKeys();
const layers = createLayers({ scene, bus });
const ground = createGround({ getDoc: () => project.doc(), bus });
const panels = createPanels($('panels'), { storageKey: 'cmrlm.app.panels' });

/* ---------- tools ---------- */
const loaded = new Map();        // id -> tool object (after init)
const layerOffs = new Map();     // id -> [off fns]
let active = null;               // active tool id or null
let selection = null;            // { item, owner } or null

const ctx = {
  THREE, bus, scene, layers, ground, input, keys, project, frame,
  ui: { h, ICONS, Toast, Pop, Controls, confirmDialog },
  capture: { image: (opts) => captureImage(scene, opts), deliver },
  store: (initial) => createStore({ initial }),
  activate: (id) => activate(id),
  select: (item, owner) => select(item, owner),
  refreshPanels: () => refreshPanels(),
  refreshHud: () => shell.refresh(['metrics', 'warnings']),
  activeTool: () => active,
  tool: (id) => loaded.get(id) || null,
};

async function loadTool(id) {
  if (loaded.has(id)) return loaded.get(id);
  const entry = TOOLS.find((t) => t.id === id);
  if (!entry) return null;
  try {
    const mod = await entry.load();
    const tool = mod && mod.default;
    if (!tool) return null;
    if (tool.init) await tool.init(ctx);
    loaded.set(id, tool);
    registerToolLayers(tool);
    return tool;
  } catch (e) {
    console.error('Tool failed to load:', id, e);
    Toast.show(`${entry.label} could not start.`, { kind: 'error' });
    return null;
  }
}

function registerToolLayers(tool) {
  (layerOffs.get(tool.id) || []).forEach((off) => off());
  const defs = (tool.layers && tool.layers(ctx)) || [];
  layerOffs.set(tool.id, defs.map((d) => layers.register({ owner: tool.id, ...d })));
  syncLayers();
}

async function activate(id) {
  if (id === active) return;
  const tool = id ? await loadTool(id) : null;
  if (id && !tool) return;
  const prev = active;
  const prevTool = prev ? loaded.get(prev) : null;
  if (prevTool && prevTool.deactivate) { try { prevTool.deactivate(ctx); } catch (e) { console.error(e); } }
  active = tool ? id : null;
  select(null);
  if (tool && tool.activate) { try { tool.activate(ctx); } catch (e) { console.error(e); } }
  keys.setActive(active || 'shell');
  dock.setActive(active);
  refreshPanels();
  syncTopbar();
  bus.emit('tool:active', { id: active, prev });
}

/* ---------- panels ---------- */
const shell = createShellPanels(ctx, { loaded: () => loaded, activeId: () => active });
shell.setRefresher((id) => panels.refresh(id));

function refreshPanels() {
  const tool = active ? loaded.get(active) : null;
  const toolGroups = tool && tool.panels ? tool.panels(ctx).map((g) => ({ owner: tool.id, ...g })) : [];
  panels.set([shell.metricsGroup(), ...toolGroups, ...shell.groups()]);
}

/* ---------- dock ---------- */
const dock = createDock($('dock'), { onSelect: (id) => activate(id === active ? null : id) });
dock.setTools(TOOLS.filter((t) => t.ready && !t.viewOnly).sort((a, b) => a.order - b.order).map((t) => ({ id: t.id, label: t.label, icon: t.icon })));
dock.setExtras([
  { id: 'layers', label: 'Layers', icon: 'layers', action: () => { if (active) activate(null); else panels.collapseAll(); } },
]);

/* ---------- selection card ---------- */
function select(item, owner) {
  selection = item ? { item, owner: owner || item.owner || null } : null;
  shell.renderCard(selection, { openTool: (id) => activate(id) });
  bus.emit('selection', { item: selection ? selection.item : null, owner: selection ? selection.owner : null });
}

input.onTap((ev) => {
  const tool = active ? loaded.get(active) : null;
  if (tool && tool.onTap && tool.onTap(ev, ctx)) return;      // the active tool picks its own items first
  const hit = layers.pick(ev.clientX, ev.clientY);
  select(hit ? { ...hit.item, layer: hit.layerId } : null, hit ? hit.owner : null);
});

/* ---------- top bar ---------- */
const tb = { left: $('tbLeft'), center: $('tbCenter'), right: $('tbRight') };
const projBtn = h('button', { class: 'btn proj', type: 'button', title: 'Project', onclick: (e) => openProjectMenu(e.currentTarget) });
const undoBtn = h('button', { class: 'btn icon', type: 'button', title: 'Undo (Cmd+Z)', 'aria-label': 'Undo', onclick: () => undo() });
const redoBtn = h('button', { class: 'btn icon', type: 'button', title: 'Redo (Shift+Cmd+Z)', 'aria-label': 'Redo', onclick: () => redo() });
undoBtn.innerHTML = ICONS.undo; redoBtn.innerHTML = ICONS.redo;
const viewBtns = VIEWS.map(([id, label, key]) => h('button', { class: 'seg-btn', type: 'button', title: `${label} view (${key})`, 'data-view': id, onclick: () => setView(id) }, label));
const zoomSite = h('button', { class: 'seg-btn', type: 'button', title: 'Zoom to the site', onclick: () => scene.frameSite() }, 'Site');
const zoomBldg = h('button', { class: 'seg-btn', type: 'button', title: 'Zoom to the building', onclick: () => scene.frameBuilding() }, 'Building');
const styleBtn = h('button', { class: 'seg-btn', type: 'button', title: 'Model or Diagram (D)', onclick: () => toggleStyle() }, 'Diagram');
const exportBtn = h('button', { class: 'btn icon', type: 'button', title: 'Export', 'aria-label': 'Export', onclick: (e) => openExportMenu(e.currentTarget) });
exportBtn.innerHTML = ICONS.export;
const panelsBtn = h('button', { class: 'btn icon', type: 'button', title: 'Show or hide the panels (\\)', 'aria-label': 'Panels', onclick: () => panels.toggleColumn() });
panelsBtn.innerHTML = ICONS.panels;

tb.left.append(h('a', { class: 'mark', href: '../', title: 'Workspace' }, 'CMRLM'), projBtn, undoBtn, redoBtn);
const viewCompact = h('button', { class: 'btn view-compact', type: 'button', title: 'View', onclick: (e) => openViewMenu(e.currentTarget) }, 'Axon');
tb.center.append(h('div', { class: 'seg views' }, ...viewBtns), h('div', { class: 'seg' }, zoomSite, zoomBldg), h('div', { class: 'seg' }, styleBtn), viewCompact);

// Narrow screens (the bottom-sheet layout): one View menu replaces the three button groups.
function openViewMenu(anchor) {
  Pop.open(anchor, [
    ...VIEWS.map(([id, label, key]) => ({ label, hint: key, checked: currentView === id, action: () => setView(id) })),
    { sep: true },
    { label: 'Zoom to the site', action: () => scene.frameSite() },
    { label: 'Zoom to the building', action: () => scene.frameBuilding() },
    { sep: true },
    { label: 'Diagram style', checked: scene.style() === 'diagram', action: () => toggleStyle() },
  ]);
}
tb.right.append(exportBtn, panelsBtn);

let currentView = 'axon';
function setView(id) { currentView = id; scene.setView(id); syncTopbar(); }
function toggleStyle() { scene.setStyle(scene.style() === 'diagram' ? 'model' : 'diagram'); syncTopbar(); }

function activeStore() { const t = active ? loaded.get(active) : null; return t && t.store ? t.store : null; }
function undo() { const s = activeStore(); if (s && s.canUndo()) s.undo(); syncTopbar(); }
function redo() { const s = activeStore(); if (s && s.canRedo()) s.redo(); syncTopbar(); }

function syncTopbar() {
  const doc = project.doc();
  projBtn.textContent = doc ? doc.name : 'No project';
  projBtn.classList.toggle('empty', !doc);
  const s = activeStore();
  undoBtn.disabled = !(s && s.canUndo());
  redoBtn.disabled = !(s && s.canRedo());
  viewBtns.forEach((b) => b.classList.toggle('on', b.dataset.view === currentView));
  viewCompact.textContent = (VIEWS.find((v) => v[0] === currentView) || VIEWS[0])[1];
  styleBtn.classList.toggle('on', scene.style() === 'diagram');
}

function openProjectMenu(anchor) {
  const doc = project.doc();
  const list = project.list().slice(0, 8);
  const items = [
    { label: 'New project', action: async () => { const name = window.prompt('Project name', 'Untitled project'); if (name !== null) project.create(name); } },
    { label: 'Import project file', action: () => pickFile() },
    { label: 'Export project file', disabled: !doc, action: () => project.exportCurrent() },
    { label: 'Close project', disabled: !doc, action: () => project.close() },
  ];
  if (list.length) {
    items.push({ sep: true });
    list.forEach((p) => items.push({ label: p.name, hint: shortDate(p.updatedAt), checked: doc && p.id === doc.id, action: () => project.open(p.id) }));
  }
  items.push({ sep: true }, { label: 'Workspace page', action: () => { window.location.href = '../'; } });
  Pop.open(anchor, items);
}

function pickFile() {
  const inp = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; if (f) await project.importFile(f); inp.remove(); });
  document.body.append(inp); inp.click();
}

function openExportMenu(anchor) {
  const doc = project.doc();
  const title = doc ? doc.name : 'CMRLM';
  const rows = shell.metricRows().slice(0, 6).map((r) => [r.label, r.value]);
  const items = [
    { label: 'Image', action: async () => deliver(await captureImage(scene, { title, rows }), title) },
    { label: 'AI-ready image', action: async () => deliver(await captureImage(scene, { aiReady: true, title, rows, hooks: [(on) => layers.setAiReady(on)] }), `${title} ai-ready`) },
  ];
  const tool = active ? loaded.get(active) : null;
  const extra = tool && tool.exports ? tool.exports(ctx) : [];
  if (extra.length) { items.push({ sep: true }); extra.forEach((x) => items.push({ label: x.label, action: () => x.run() })); }
  Pop.open(anchor, items);
}

const shortDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };

/* ---------- keys ---------- */
VIEWS.forEach(([id, , key]) => keys.bind('shell', key, () => setView(id)));
keys.bind('shell', 'd', () => toggleStyle());
keys.bind('shell', 'mod+z', () => undo());
keys.bind('shell', 'shift+mod+z', () => redo());
keys.bind('shell', 'mod+y', () => redo());
keys.bind('shell', '\\', () => panels.toggleColumn());
keys.bind('shell', 'Escape', () => select(null));

/* ---------- layers and project ---------- */
derivedLayerDefs({ getDoc: () => project.doc(), ground, scene }).forEach((d) => layers.register(d));

function syncLayers() { layers.sync(ctx); scene.requestRender(); }

function framingBoxes() {
  scene.setFraming({
    site: () => layers.bounds ? layers.bounds(['site-ground', 'site-neighbors', 'site-roads']) : null,
    building: () => layers.bounds ? layers.bounds(['massing', 'units', 'parking']) : null,
  });
}
framingBoxes();

function onProjectOpen() {
  const doc = project.doc();
  frame.setShift(doc ? frame.shiftFor(doc) : { x: 0, y: 0, z: 0 });
  loaded.forEach((t) => { if (t.onProject) { try { t.onProject({ doc, keys: null, source: 'open' }, ctx); } catch (e) { console.error(e); } } });
  syncLayers();
  scene.setView(currentView, { animate: false });
  scene.frameSite();
  refreshPanels();
  syncTopbar();
}

bus.on('project:open', onProjectOpen);
bus.on('project:change', (evt) => {
  loaded.forEach((t) => { if (t.onProject && t.id !== evt.tool) { try { t.onProject(evt, ctx); } catch (e) { console.error(e); } } });
  syncLayers();
  shell.refresh(['metrics', 'warnings', 'layers']);
  syncTopbar();
});
bus.on('style:change', () => { syncLayers(); syncTopbar(); });
bus.on('layers:change', () => { syncLayers(); shell.refresh(['layers']); });
bus.on('frame:shift', () => syncLayers());
bus.on('notice', ({ text, kind }) => Toast.show(text, { kind }));

/* ---------- view insets: frame views in the area the panels leave free ---------- */
function syncInsets() {
  const view = $('view'), pan = $('panels');
  if (!view || !pan) return;
  const v = view.getBoundingClientRect(), p = pan.getBoundingClientRect();
  const sheet = document.documentElement.dataset.layout === 'sheet';
  const hidden = document.documentElement.dataset.panels === 'hidden';
  const right = !sheet && !hidden ? Math.max(0, Math.min(v.right, p.right) - Math.max(v.left, p.left)) : 0;
  const bottom = sheet && !hidden ? Math.max(0, v.bottom - p.top) : 0;
  if (scene.setInsets) scene.setInsets({ right, bottom });
}
window.addEventListener('resize', () => { syncInsets(); scene.resize(); });
window.addEventListener('panels:resize', () => { syncInsets(); scene.resize(); });

/* ---------- start ---------- */
syncInsets();
refreshPanels();
syncTopbar();
if (project.doc()) onProjectOpen();
else scene.setView('axon', { animate: false });

// Tests and debugging only.
window.__app = { ctx, activate, loaded, panels, layers, project, scene, select, version: 'phase-0' };
