/* ==========================================================================
   TOOL: grading (Grading Sketch, docs/shell-plan.md section 9.4, app/tools/PORTING.md)
   The Grading Sketch in the shell. It grades the site: buildings with floor tiers, daylight slopes, drives, lots, walls, routes,
   and the cut and fill that results. It is a sketch for early coordination, never a grading plan.

   Files in this folder
     model.js     pure: state defaults, the build pipeline (src/grading), the section patch, the text of an item
     ground3d.js  the live layer's three.js group: proposed ground mesh, cut and fill colors, contours, pads, walls, routes
     edit.js      drawing, snapping, picking and handle editing (DOM and SVG in #handles, input claims)
     panels.js    the six panels (grading-buildings, -ground, -drives, -walls, -routes, -earthwork)
     tool.css     the few classes the shell does not have (prefix grading-)

   Ground (docs/shell-plan.md section 7): while the live layer is on, this tool holds the ground override (owner 'grading'):
   ground.at(x, y) gives the PROPOSED elevation at a project plan point, or null outside the grid. The site ground layer then hides
   its own ground mesh, and roads and walks drape on the proposed ground. The layer is 'grading-live' and replaces the derived
   twin 'grading'. Placement is the identity, so project points are grading points; the layer draws at project minus the shift.

   The section: ctx.project.write('grading', { tool, schema: 1, placement, state, derived, note }) after every committed change.
   derived = gradingDerived(state, built, metrics); its ffe[] feeds the Tower and Parking bases.
   ========================================================================== */
import { css } from '../../core/scene.js';
import { revitCsv } from '../../../src/grading/exports.js';
import {
  computeDerived, dataKey, geomKeyOf, defaultState, fillDefaults, sectionPatch, stateUsingProject, stateStandalone,
  shellItem, groundItem, fmt, pct1, isObj,
} from './model.js';
import { buildLayer, setAiReady, setLabelsVisible, disposeExtras } from './ground3d.js';
import { createEditor } from './edit.js';
import { createPanels } from './panels.js';

const LAYER_ID = 'grading-live';
const OWNER = 'grading';

let ctx = null, store = null, editor = null, panelsApi = null;
let D = null, dKey = '', layerVer = 0, stamp = 0, overStamp = -1, overFn = null;
let quiet = 0, uiRaf = 0, active = false, warnedReadOnly = false, overWanted = false;
let offs = [];

/* ---------------------------------------------------------------- state and derived */
const doc = () => (ctx ? ctx.project.doc() : null);

/** The state for the open project: its grading section, else the default design (with the project as the source when it offers one). */
function loadState() {
  const d = doc();
  const sec = d ? ctx.project.section('grading') : null;
  if (sec && isObj(sec.state)) return fillDefaults(sec.state);
  const base = fillDefaults(defaultState());
  return d ? (stateUsingProject(base, d) || base) : base;
}

/** The derived result for the state on screen. A draft (while a drag is live) is cheaper; the full one is cached by its key. */
function compute(quality) {
  const s = store.raw();
  const key = `${geomKeyOf(s)}|${dataKey(doc())}|${quality}`;
  if (D && key === dKey) return D;
  D = computeDerived(s, { project: doc(), quality });
  dKey = key;
  if (quality === 'full') stamp++;
  return D;
}

/** Writes the grading section (nothing when it would not change). `onlyIfExists`: a data change from another tool only refreshes a section that exists. */
function writeSection({ onlyIfExists = false } = {}) {
  if (!ctx || !D || !D.ok) return false;
  try {
    if (ctx.project.isReadOnly && ctx.project.isReadOnly('grading')) {
      if (!warnedReadOnly) { warnedReadOnly = true; ctx.bus.emit('notice', { text: 'The grading in this project was saved by a newer version. It stays as it is.', kind: 'warn' }); }
      return false;
    }
    const cur = ctx.project.section('grading');
    if (onlyIfExists && !cur) return false;
    const full = compute('full');
    if (!full.ok) return false;
    const patch = sectionPatch(store.raw(), full);
    if (cur && JSON.stringify(cur.state) === JSON.stringify(patch.state) && JSON.stringify(cur.derived) === JSON.stringify(patch.derived)) return false;
    ctx.project.write('grading', patch);
    return true;
  } catch (e) { console.error(e); return false; }
}

/* ---------------------------------------------------------------- ground override */
function overrideFor(d) {
  const b = d.built, g = b.grid, at = b.surface.at;
  const L = (g.n - 1) * g.spacing, x1 = g.x0 + L, y1 = g.y0 + L, e = 1e-6;
  return (x, y) => {
    if (!(x >= g.x0 - e && x <= x1 + e && y >= g.y0 - e && y <= y1 + e)) return null;
    const z = at(x, y);
    return Number.isFinite(z) ? z : null;
  };
}
/** Runs on every layer sync: holds the override while the live layer shows, and gives the ground back when it is off. */
function syncOverride(want) {
  if (!ctx) return;
  const holder = ctx.ground.owner ? ctx.ground.owner() : null;
  if (want && D && D.ok) {
    if (holder !== OWNER || overStamp !== stamp) {
      overFn = overrideFor(D);
      overStamp = stamp;
      ctx.ground.setOverride(overFn, OWNER);
    }
  } else if (holder === OWNER) {
    ctx.ground.setOverride(null, OWNER);
    overStamp = -1;
  }
}

/* ---------------------------------------------------------------- the live layer */
const wantLabels = (style) => style === 'diagram' || (ctx && ctx.scene.isPlan && ctx.scene.isPlan());
const layerGroup = () => ctx.layers.get(LAYER_ID);
function viewSize() {
  const c = ctx.scene.canvas();
  return [c && c.clientWidth ? c.clientWidth : 1000, c && c.clientHeight ? c.clientHeight : 700];
}
function layerDef() {
  return {
    id: LAYER_ID, label: 'Grading', owner: OWNER, order: 40, defaultOn: true, replaces: ['grading'],
    key: (l) => `${layerVer}|${store.gestureActive() ? 'live' : 'full'}|${l.style}|${wantLabels(l.style) ? 1 : 0}|${l.shift.x},${l.shift.y},${l.shift.z}`,
    build: (l) => {
      if (!D || !D.ok) return null;
      const s = store.raw();
      const group = buildLayer(D, s, {
        sh: l.shift, style: l.style, cssColor: css, light: store.gestureActive(), res: viewSize(), labels: wantLabels(l.style),
        items: { ground: () => groundItem(D), of: (kind, id) => shellItem({ kind, id }, D, s) },
      });
      if (group) group.userData.gradingLive = true;
      return group;
    },
    count: (obj) => obj.userData.count || 1,
    dispose: (obj) => disposeExtras(obj),
    aiReady: (obj, on) => setAiReady(obj, on),
    always: (l, { on, replaced }) => { overWanted = !!(on && !replaced); syncOverride(overWanted); },
  };
}

/* ---------------------------------------------------------------- change handling */
/** Redraws what follows the model: the layer, the HUD, the panel fields, the editor handles. Coalesced to one frame. */
function scheduleUi() {
  if (uiRaf) return;
  const run = () => {
    uiRaf = 0;
    try { ctx.layers.sync(ctx); } catch (e) { console.error(e); }
    try { if (panelsApi) panelsApi.refresh(); } catch (e) { console.error(e); }
    try { ctx.refreshHud(); } catch (e) { console.error(e); }
    try { if (editor) editor.refresh(); } catch (e) { console.error(e); }
    ctx.scene.requestRender();
  };
  if (typeof requestAnimationFrame === 'function') uiRaf = requestAnimationFrame(run); else run();
}
function onStore(state, info) {
  const live = !!(info && info.live);
  compute(live ? 'draft' : 'full');
  layerVer++;
  if (live) { scheduleUi(); return; }
  if (overWanted) syncOverride(true);            // the ground first: the tower reads it when the section is written
  if (!quiet) writeSection();
  try { ctx.layers.sync(ctx); } catch (e) { console.error(e); }
  if (uiRaf && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(uiRaf); uiRaf = 0; }
  // the editor first (an undone item may leave the selection), then the fields
  try { if (editor) editor.refresh(); } catch (e) { console.error(e); }
  try { if (panelsApi) panelsApi.refresh(); } catch (e) { console.error(e); }
  try { ctx.refreshHud(); } catch (e) { console.error(e); }
  ctx.scene.requestRender();
}

/** Replaces the state without an undo step and without a write (the project opened, or another tab saved). */
function reloadState() {
  quiet++;
  try { store.replace(loadState(), { undoable: false }); } finally { quiet--; }
}

/* ---------------------------------------------------------------- selection */
function openPanelFor(g) {
  if (!panelsApi || !g) return;
  const id = panelsApi.panelOf(g.kind);
  if (!id) return;
  const sec = typeof document !== 'undefined' ? document.querySelector(`#panels section.panel[data-id="${id}"]`) : null;
  if (sec && sec.dataset.open !== 'true') { const head = sec.querySelector('.panel-head'); if (head) head.click(); }
  setTimeout(() => { try { panelsApi.openRow(g.kind, g.id); } catch (e) { /* the panel is closed */ } }, 0);
}
function onSelection({ item }) {
  const g = item && item.gsel && item.owner === OWNER ? item.gsel : null;
  if (editor) editor.setSelected(g);
  if (g && active) openPanelFor(g);
}

/* ---------------------------------------------------------------- helpers for the panels and the card */
function setSource(k) {
  const d = doc();
  if (k === 'standalone') { const next = stateStandalone(store.raw()); if (next) store.replace(next); return; }
  if (!d) { ctx.bus.emit('notice', { text: 'Open a project first. The site and the massing come from the project.', kind: 'warn' }); return; }
  const next = stateUsingProject(store.raw(), d);
  if (!next) { ctx.bus.emit('notice', { text: 'This project has no site ground or massing yet.', kind: 'warn' }); return; }
  store.replace(next);
}
function toggleAutoWall(id) {
  const cur = new Set(store.get('autoWalls.accepted') || []);
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  store.set('autoWalls.accepted', [...cur], { live: false });
  return cur.has(id);
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
const safeName = (s) => String(s || 'project').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'project';

function loadCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-grading-css]')) return;
  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./tool.css', import.meta.url).href;
    link.dataset.gradingCss = '1';
    document.head.append(link);
  } catch (e) { /* the tool works without its few extra styles */ }
}

/* ---------------------------------------------------------------- the tool */
const tool = {
  id: 'grading',
  section: 'grading',
  label: 'Grading Sketch',
  icon: 'grading',
  order: 40,
  dock: true,
  store: null,

  async init(c) {
    ctx = c;
    loadCss();
    store = ctx.store(loadState());
    tool.store = store;
    compute('full');
    offs.push(store.subscribe(onStore));
    editor = createEditor({
      ctx, store, getD: () => D,
      groundMesh: () => { const g = layerGroup(); return g && g.userData ? g.userData.ground || null : null; },
      selectItem: (g) => { ctx.select(shellItem(g, D, store.raw()), OWNER); },
      deselect: () => { ctx.select(null); },
      notify: (text, kind) => ctx.bus.emit('notice', { text, kind: kind || 'info' }),
    });
    offs.push(ctx.bus.on('selection', onSelection));
    // LineMaterial widths follow the size of the view; the plan labels follow the view name
    offs.push(ctx.scene.onFrame(() => {
      const g = layerGroup();
      if (!g || !g.userData.mats) return;
      const [w, h] = viewSize();
      for (const m of g.userData.mats) if (m.resolution.x !== w || m.resolution.y !== h) m.resolution.set(w, h);
    }));
    offs.push(ctx.scene.onView((name) => {
      const g = layerGroup();
      if (g) { setLabelsVisible(g, ctx.scene.style() === 'diagram' || name === 'plan'); ctx.scene.requestRender(); }
    }));
    // keys of this tool (the shell keys 1 to 6, D and Cmd+Z already exist)
    ctx.keys.bind(OWNER, 'w', () => { if (!editor.startDraw('wall')) return false; return true; });
    ctx.keys.bind(OWNER, 'r', () => { if (!editor.startDraw('route')) return false; return true; });
    ctx.keys.bind(OWNER, 'Enter', () => (editor.drawing() ? (editor.finishDraw(), true) : false));
    ctx.keys.bind(OWNER, 'Delete', () => (editor.selected() ? (editor.deleteSelected(), true) : false));
    ctx.keys.bind(OWNER, 'Backspace', () => (editor.selected() ? (editor.deleteSelected(), true) : false));
    try {
      const app = window.__app;
      if (app) { app.tools = app.tools || {}; app.tools.grading = { store, editor, derived: () => D, tool, state: () => store.raw(), write: () => writeSection() }; }
    } catch (e) { /* no test hook */ }
  },

  activate() {
    active = true;
    if (editor) editor.enable();
    scheduleUi();
  },

  deactivate() {
    active = false;
    if (editor) editor.disable();
    try { if (ctx.input.active()) ctx.input.cancel(); } catch (e) { /* no gesture */ }
    ctx.scene.requestRender();
  },

  panels() {
    panelsApi = createPanels({ ctx, store, getD: () => D, editor, tool });
    return panelsApi.groups();
  },

  layers() { return [layerDef()]; },

  metrics() {
    if (!D || !D.ok) return [];
    const h = D.hud;
    const net = fmt.signed(h.netCy, (x) => `${fmt.grouped(fmt.round10(x))} cy`);
    return [
      { label: 'Cut', value: fmt.cy10(h.cutCy), hint: 'Existing ground removed' },
      { label: 'Fill', value: fmt.cy10(h.fillCy), hint: 'Ground added' },
      { label: 'Net (fill minus cut)', value: net, hint: 'Positive means soil to bring in' },
      { label: 'Balance', value: `${(h.balance * 100).toFixed(0)}%`, hint: 'The smaller of cut and fill over the larger' },
      { label: 'Tallest wall', value: fmt.wall(h.wallMax), hint: h.wallCount ? `${h.wallCount} wall${h.wallCount === 1 ? '' : 's'}` : 'No walls' },
      { label: 'Steepest route', value: h.routes.length ? pct1(h.steepestRoute) : 'None', hint: 'Running slope' },
    ];
  },

  warnings() {
    if (!D) return [];
    return D.warnings.map((w) => ({ text: w.text, level: w.level === 'error' ? 'error' : w.level === 'info' ? 'info' : 'warn' }));
  },

  onProject(evt) {
    if (!ctx || !store) return;
    const keys = evt && Array.isArray(evt.keys) ? evt.keys : null;
    if (!keys || evt.source === 'open') {                       // a different project, or none
      warnedReadOnly = false;
      reloadState();
      scheduleUi();
      return;
    }
    if (keys.includes('grading')) {                            // another tab saved the grading
      const sec = ctx.project.section('grading');
      if (sec && isObj(sec.state) && JSON.stringify(fillDefaults(sec.state)) !== JSON.stringify(store.raw())) { reloadState(); scheduleUi(); return; }
    }
    if (keys.some((k) => k === 'site' || k === 'massing' || k === 'parking')) {   // the data this design stands on changed
      compute('full');
      layerVer++;
      if (overWanted) syncOverride(true);
      writeSection({ onlyIfExists: true });
      scheduleUi();
    }
  },

  exports() {
    return [{
      id: 'revit-csv', label: 'Revit points (.csv)',
      run: () => {
        const d = compute('full');
        if (!d.ok) { ctx.bus.emit('notice', { text: 'The grading could not be built, so there are no points to export.', kind: 'error' }); return; }
        const d0 = doc();
        download(`${safeName(d0 && d0.name)} grading ground.csv`, revitCsv(d.built), 'text/csv');
      },
    }];
  },

  card(item) {
    const g = item && item.gsel && item.owner === OWNER ? item.gsel : null;
    if (!g) return [];
    const out = [];
    const geom = editor ? editor.geomOf(g) : null;
    if (g.kind === 'wall' && D && D.metrics && D.metrics.walls) {
      const w = D.metrics.walls.list.find((x) => x.id === g.id);
      if (w && w.kind === 'auto') out.push({ label: w.accepted ? 'Accepted' : 'Accept wall', action: () => { toggleAutoWall(g.id); ctx.select(shellItem(g, D, store.raw()), OWNER); } });
    }
    if (geom && geom.path) out.push({ label: 'Redraw', action: () => editor.redraw(g) });
    if (geom && (geom.path || g.kind === 'building') && !geom.auto) out.push({ label: 'Delete', action: () => editor.deleteItem(g) });
    return out;
  },

  /** The active tool picks its own items first. While drawing, a tap places a point (a finger tap, a pen or mouse tap the claim left). */
  onTap(ev) {
    if (!editor) return false;
    if (editor.drawing()) { editor.drawTap(ev); return true; }
    const hit = editor.pickAt(ev.clientX, ev.clientY);
    if (!hit) return false;
    ctx.select(shellItem(hit, D, store.raw()), OWNER);
    return true;
  },
};

export default tool;
