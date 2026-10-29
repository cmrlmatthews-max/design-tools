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
import { createPanels } from './core/panels.js';
import { initTips } from './core/tips.js';
import { createLeftbar } from './core/leftbar.js';
import { applyRealSun } from './core/sunstudy.js';
import { createShellPanels } from './core/shell-panels.js';
import { createSection } from './core/section.js';
import { TOOLS, toolOn } from './tools/registry.js';

const $ = (id) => document.getElementById(id);
const VIEW_TIPS = { axon: 'Three-quarter view from above.', n: 'Look at the north side.', e: 'Look at the east side.', s: 'Look at the south side.', w: 'Look at the west side.', plan: 'Top view. A drag moves the view.' };
const VIEWS = [['axon', 'Axon', '1'], ['n', 'N', '2'], ['e', 'E', '3'], ['s', 'S', '4'], ['w', 'W', '5'], ['plan', 'Plan', '6']];

/* ---------- core objects ---------- */
bus.on('notice', ({ text, kind }) => Toast.show(text, { kind }));   // first, so startup notices show
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

const SITE_STYLE_KEY = 'cmrlm.app.siteStyle';
let siteStyle = (() => { try { return localStorage.getItem(SITE_STYLE_KEY) || 'solid'; } catch (e) { return 'solid'; } })();

/* ---------- app-wide view settings (Cade, October 28, 2026): one look in every tool ---------- */
const VIEW_KEY = 'cmrlm.app.view';
const VIEW_DEFAULT = { colorBy: 'program', floorLines: true, shadows: true, sun: { az: 140, alt: 40 } };
let viewSettings = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (v && typeof v === 'object') return { ...VIEW_DEFAULT, ...v, sun: { ...VIEW_DEFAULT.sun, ...(v.sun || {}) } };
  } catch (e) { /* blocked storage: defaults */ }
  return { ...VIEW_DEFAULT, sun: { ...VIEW_DEFAULT.sun } };
})();
const viewApi = {
  get: () => ({ ...viewSettings, sun: { ...viewSettings.sun } }),
  key: () => `${viewSettings.colorBy}|${viewSettings.floorLines ? 1 : 0}`,
  set(patch = {}) {
    const next = { ...viewSettings, ...patch, sun: { ...viewSettings.sun, ...(patch.sun || {}) } };
    if (!['program', 'zone'].includes(next.colorBy)) next.colorBy = 'program';
    next.floorLines = !!next.floorLines; next.shadows = !!next.shadows;
    viewSettings = next;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(viewSettings)); } catch (e) { /* keep it for this visit */ }
    applyView();
    bus.emit('view:change', { view: viewApi.get() });
  },
};
function applyView() {
  scene.setShadows(viewSettings.shadows);
  scene.setSun(viewSettings.sun);
}

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
  leftbar: null,   // set below (core/leftbar.js)
  view: viewApi,
  siteStyle: () => siteStyle,
  setSiteStyle: (v) => {
    if (!['solid', 'glass', 'wireframe'].includes(v) || v === siteStyle) return;
    siteStyle = v;
    try { localStorage.setItem(SITE_STYLE_KEY, v); } catch (e) { /* private mode: keep it for this visit */ }
    syncLayers(); shell.refresh(['layers']);
  },
  tool: (id) => loaded.get(id) || null,
};

const loading = new Map();       // id -> promise while a tool loads (two callers share one load)
function loadTool(id) {
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  if (!loading.has(id)) loading.set(id, loadToolNow(id).finally(() => loading.delete(id)));
  return loading.get(id);
}

async function loadToolNow(id) {
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
  if (prev) ctx.leftbar.set(prev, null);
  active = tool ? id : null;
  select(null);
  if (tool && tool.activate) { try { tool.activate(ctx); } catch (e) { console.error(e); } }
  keys.setActive(active || 'shell');
  dock.setActive(active);
  refreshPanels();
  syncTopbar();
  bus.emit('tool:active', { id: active, prev });
  syncLayers();   // some layers depend on the active tool (units hide while the Tower is active)
}

/* ---------- left tool bar (one tool's main list, for example the Tower segments) ---------- */
ctx.leftbar = createLeftbar({ h, ICONS, onResize: () => { syncInsets(); scene.resize(); } });

/* ---------- panels ---------- */
const shell = createShellPanels(ctx, { loaded: () => loaded, activeId: () => active });
shell.setRefresher((id) => panels.refresh(id));
ctx.panelsApi = panels;

function refreshPanels() {
  const tool = active ? loaded.get(active) : null;
  const toolGroups = tool && tool.panels ? tool.panels(ctx).map((g) => ({ owner: tool.id, ...g })) : [];
  // Metrics last (Cade, October 28, 2026). Warnings hidden for now (docs/removed-features.md).
  panels.set([...toolGroups, ...shell.groups(), shell.metricsGroup()]);
}

/* ---------- tools in the top bar (Cade, October 28, 2026: the left dock moved to the top bar, layout A) ---------- */
const toolTabs = h('div', { class: 'tool-tabs', role: 'toolbar', 'aria-label': 'Tools' });
const dock = {
  setActive(id) { toolTabs.querySelectorAll('.tool-tab').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false')); },
};
TOOLS.filter((t) => t.ready && !t.viewOnly).sort((a, b) => a.order - b.order).forEach((t) => {
  const b = h('button', { class: 'tool-tab', type: 'button', 'data-id': t.id, 'aria-pressed': 'false', 'data-tip': ({ site: 'Site Model: find a real site and remove buildings. Select it again to close it.', tower: 'Tower Generator: shape the building and place it on the site. Select it again to close it.' })[t.id] || `${t.label}. Select it again to close it.`, onclick: () => activate(t.id === active ? null : t.id) });
  b.innerHTML = ICONS[t.icon] || '';
  b.append(h('span', {}, t.label));
  toolTabs.append(b);
});

/* ---------- selection card ---------- */
const highlight = new THREE.Group();
highlight.name = 'selection-highlight';
scene.overlayRoot.add(highlight);

/** Outline of a selected item that carries a plan ring (derived items): bottom and top loops plus corner lines. */
function drawHighlight(item) {
  highlight.children.slice().forEach((c) => { highlight.remove(c); if (c.geometry) c.geometry.dispose(); });
  const ring = item && Array.isArray(item.outer) ? item.outer : null;
  if (!ring || ring.length < 2) { scene.requestRender(); return; }
  const z0 = Number.isFinite(item.z0) ? item.z0 : 0, z1 = Number.isFinite(item.z1) ? item.z1 : z0;
  const pts = [];
  const at = (p, z) => { const q = frame.toScene([p[0], p[1], z]); return frame.worldVec(q[0], q[1], q[2]); };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    pts.push(at(a, z0), at(b, z0));
    if (z1 > z0 + 0.01) pts.push(at(a, z1), at(b, z1), at(a, z0), at(a, z1));
  }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6aa2ea';
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  lines.renderOrder = 10;
  highlight.add(lines);
  scene.requestRender();
}

function select(item, owner) {
  selection = item ? { item, owner: owner || item.owner || null } : null;
  drawHighlight(selection ? selection.item : null);
  shell.renderCard(selection, { openTool: (id) => activate(id) });
  bus.emit('selection', { item: selection ? selection.item : null, owner: selection ? selection.owner : null });
}

input.onTap((ev) => {
  if (ctx.section && ctx.section.drawing && ctx.section.drawing()) return;   // drawing a section cut: a tap places a point, it does not select
  const tool = active ? loaded.get(active) : null;
  if (tool && tool.onTap && tool.onTap(ev, ctx)) return;      // the active tool picks its own items first
  const hit = layers.pick(ev.clientX, ev.clientY);
  select(hit ? { ...hit.item, layer: hit.layerId } : null, hit ? hit.owner : null);
});

/* ---------- top bar ---------- */
const tb = { left: $('tbLeft'), center: $('tbCenter'), right: $('tbRight') };
const projBtn = h('button', { class: 'btn proj', type: 'button', 'data-tip': 'Projects: new, open, import, and export.', onclick: (e) => openProjectMenu(e.currentTarget) });
const undoBtn = h('button', { class: 'btn icon', type: 'button', 'data-tip': 'Undo the last change.', 'data-tip-key': '⌘Z', 'aria-label': 'Undo', onclick: () => undo() });
const redoBtn = h('button', { class: 'btn icon', type: 'button', 'data-tip': 'Redo the change.', 'data-tip-key': '⇧⌘Z', 'aria-label': 'Redo', onclick: () => redo() });
undoBtn.innerHTML = ICONS.undo; redoBtn.innerHTML = ICONS.redo;
const viewBtns = VIEWS.map(([id, label, key]) => h('button', { class: 'seg-btn', type: 'button', 'data-tip': VIEW_TIPS[id], 'data-tip-key': key, 'data-view': id, onclick: () => setView(id) }, label));
const zoomSite = h('button', { class: 'seg-btn', type: 'button', 'data-tip': 'Fit the whole site in the view.', onclick: () => scene.frameSite() }, 'Site');
const zoomBldg = h('button', { class: 'seg-btn', type: 'button', 'data-tip': 'Fit the building in the view.', onclick: () => scene.frameBuilding() }, 'Building');
const styleBtn = h('button', { class: 'seg-btn', type: 'button', 'data-tip': 'Color the model by program. Select it again for the white model.', 'data-tip-key': 'D', onclick: () => toggleStyle() }, 'Diagram');
const exportBtn = h('button', { class: 'btn icon', type: 'button', 'data-tip': 'Save a picture of the view, or an AI-ready image.', 'aria-label': 'Save image', onclick: (e) => openExportMenu(e.currentTarget) });
exportBtn.innerHTML = ICONS.export;
const panelsBtn = h('button', { class: 'btn icon', type: 'button', 'data-tip': 'Show or hide the panels.', 'data-tip-key': '\\', 'aria-label': 'Panels', onclick: () => panels.toggleColumn() });
panelsBtn.innerHTML = ICONS.panels;

tb.left.append(h('a', { class: 'mark', href: '../', 'data-tip': 'Back to the Workspace page and the project list.' }, 'CMRLM'), projBtn, undoBtn, redoBtn, toolTabs);
const viewCompact = h('button', { class: 'btn view-compact', type: 'button', 'data-tip': 'Change the view, zoom, or style.', onclick: (e) => openViewMenu(e.currentTarget) }, 'Axon');
// Section cut (Cade, October 28, 2026): the drawing shows in a pane below the 3D view (core/section.js).
const section = createSection(ctx, { stage: $('stage'), pane: $('sectionPane'), setView: (id) => setView(id), onLayout: () => { syncInsets(); scene.resize(); } });
ctx.section = section;
tb.center.append(h('div', { class: 'seg views' }, ...viewBtns), h('div', { class: 'seg sec-seg' }, section.button), h('div', { class: 'seg' }, zoomSite, zoomBldg), h('div', { class: 'seg' }, styleBtn), viewCompact);   // the neighbor style select joins after Diagram (below)

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
// Neighbor buildings style (Cade, October 28, 2026: its own dropdown in the top bar)
const SITE_STYLES = [['solid', 'Solid'], ['glass', 'Glass'], ['wireframe', 'Wireframe']];
const styleSel = h('select', { class: 'select tb-select', 'aria-label': 'Neighbor buildings', 'data-tip': 'How the neighbor buildings draw: solid, see-through glass, or lines only.' },
  ...SITE_STYLES.map(([v, t]) => h('option', { value: v }, t)));
styleSel.value = siteStyle;
styleSel.addEventListener('change', () => ctx.setSiteStyle(styleSel.value));
// Next to the Diagram button (Cade, October 29, 2026).
tb.center.append(styleSel);
tb.right.append(exportBtn, panelsBtn);

/* Fit the top bar (Fable QA, October 28, 2026): when the full view, zoom, and style groups do not fit, one View menu
   replaces them ("compact"). When that still does not fit, the tool tabs and the Section button show icons only ("tight"). */
function fitTopbar() {
  const bar = tb.center && tb.center.parentElement;
  if (!bar) return;
  const root = document.documentElement;
  const fits = () => bar.scrollWidth <= bar.clientWidth + 1;
  root.dataset.tb = 'full';
  if (fits()) return;
  root.dataset.tb = 'compact';
  if (fits()) return;
  root.dataset.tb = 'tight';
}
window.addEventListener('resize', () => fitTopbar());
window.addEventListener('panels:resize', () => fitTopbar());
new MutationObserver(() => fitTopbar()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout'] });

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
  viewCompact.textContent = `View: ${(VIEWS.find((v) => v[0] === currentView) || VIEWS[0])[1]} ▾`;
  styleBtn.classList.toggle('on', scene.style() === 'diagram');
  fitTopbar();
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
    // With the section pane open, the image has the section drawing below the view.
    { label: 'Image', action: async () => deliver(await section.compose(await captureImage(scene, { title, rows })), title) },
    { label: 'AI-ready image', action: async () => deliver(await captureImage(scene, { aiReady: true, title, rows, hooks: [(on) => layers.setAiReady(on), (on) => section.setCaptureHidden(on)] }), `${title} ai-ready`) },
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
keys.bind('shell', 'Escape', () => { if (section.drawing()) { section.stopDraw(); return; } select(null); });

/* ---------- layers and project ---------- */
// A hidden tool (registry ready: false) draws nothing: its derived layers are not registered.
const HIDDEN_LAYERS = { parking: ['parking'], grading: ['grading'] };
const hiddenIds = new Set(Object.entries(HIDDEN_LAYERS).filter(([tool]) => !toolOn(tool)).flatMap(([, ids]) => ids));
// Level cut replaced by Section cut October 28, 2026 (Cade). See docs/removed-features.md.
layers.setCut(null);
derivedLayerDefs({ getDoc: () => project.doc(), ground, scene }).filter((d) => !hiddenIds.has(d.id)).forEach((d) => layers.register(d));

function syncLayers() { layers.sync(ctx); scene.requestRender(); }

function framingBoxes() {
  scene.setFraming({
    site: () => layers.bounds ? layers.bounds(['site-ground', 'site-neighbors', 'site-roads']) : null,
    // derived twins and the live tool layers that replace them (layers.bounds skips replaced and hidden layers)
    building: () => layers.bounds ? layers.bounds(['massing', 'tower-model', 'units', 'parking', 'parking-deck']) : null,
  });
}
framingBoxes();

/** The tools whose drawers the open project needs (one look in every tool: the tool's own drawer draws its part). */
function toolsFor(doc) {
  const sec = (k) => (doc && doc.sections && doc.sections[k]) || null;
  const out = [];
  if (sec('site')) out.push('site');
  const mass = sec('massing');
  if (mass && mass.tool === 'tower') out.push('tower');
  const podiumParking = !!(mass && mass.derived && Array.isArray(mass.derived.levels) && mass.derived.levels.some((l) => l && l.zone === 'podium' && l.program === 'parking'));
  if (sec('parking') || podiumParking) out.push('parking');
  if (sec('grading')) out.push('grading');
  return out.filter((id) => toolOn(id));
}

/** Loads the drawers of the open project in the background (no activate). */
async function loadForProject() {
  const doc = project.doc();
  const ids = toolsFor(doc).filter((id) => !loaded.has(id));
  if (!ids.length) return;
  await Promise.all(ids.map((id) => loadTool(id)));
  syncLayers();
  shell.refresh(['metrics', 'warnings', 'layers']);
}

function onProjectOpen() {
  const doc = project.doc();
  try { applyRealSun(ctx); } catch (e) { console.error(e); }   // real sun at the new project's site
  if (!doc && active) activate(null);   // no project: no tool stays open with work that cannot be saved
  frame.setShift(doc ? frame.shiftFor(doc) : { x: 0, y: 0, z: 0 });
  loadForProject();
  loaded.forEach((t) => { if (t.onProject) { try { t.onProject({ doc, keys: null, source: 'open' }, ctx); } catch (e) { console.error(e); } } });
  syncLayers();
  scene.setView(currentView, { animate: false });
  scene.frameSite();
  refreshPanels();
  syncTopbar();
}

bus.on('project:open', onProjectOpen);
bus.on('project:change', (evt) => {
  // Layers first: the grading override (the proposed ground) must be current before a tool follows the ground.
  syncLayers();
  loaded.forEach((t) => { if (t.onProject && t.id !== evt.tool) { try { t.onProject(evt, ctx); } catch (e) { console.error(e); } } });
  syncLayers();
  shell.refresh(['metrics', 'warnings', 'layers']);
  syncTopbar();
});
bus.on('project:change', () => { loadForProject(); });
// The View panel rebuilds only when the sun mode changes (a rebuild during a slider drag would end the drag).
let lastSunMode = (viewSettings.sun || {}).mode || 'manual';
bus.on('view:change', ({ view }) => {
  syncLayers();
  const mode = (view && view.sun && view.sun.mode) || 'manual';
  if (mode !== lastSunMode) { lastSunMode = mode; shell.refresh(['view']); }
});
bus.on('style:change', () => { syncLayers(); syncTopbar(); shell.refresh(['view']); });
bus.on('layers:change', () => { syncLayers(); shell.refresh(['layers']); });
bus.on('frame:shift', () => syncLayers());

/* ---------- view insets: frame views in the area the panels leave free ---------- */
function syncInsets() {
  const view = $('view'), pan = $('panels');
  if (!view || !pan) return;
  const v = view.getBoundingClientRect(), p = pan.getBoundingClientRect();
  const sheet = document.documentElement.dataset.layout === 'sheet';
  const hidden = document.documentElement.dataset.panels === 'hidden';
  const right = !sheet && !hidden ? Math.max(0, Math.min(v.right, p.right) - Math.max(v.left, p.left)) : 0;
  const bottom = sheet && !hidden ? Math.max(0, v.bottom - p.top) : 0;
  // the left tool bar (Tower segments) covers the left edge of the view while it is open
  const lb = $('leftbar');
  const left = lb && !lb.hidden ? Math.max(0, lb.getBoundingClientRect().right - v.left) : 0;
  if (scene.setInsets) scene.setInsets({ right, bottom, left });
}
window.addEventListener('resize', () => { syncInsets(); scene.resize(); });
window.addEventListener('panels:resize', () => { syncInsets(); scene.resize(); });

/* ---------- start ---------- */
initTips();
applyView();
syncInsets();
refreshPanels();
syncTopbar();
if (project.doc()) onProjectOpen();
else scene.setView('axon', { animate: false });

// Tests and debugging only.
window.__app = { ctx, activate, loaded, panels, layers, project, scene, select, section, version: 'phase-0' };
