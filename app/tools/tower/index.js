/* ==========================================================================
   TOOL: tower (Tower Generator, docs/shell-plan.md section 9.2)
   Podium, segments, setbacks, mechanical floors, carves, cuts and a crown; programs and targets; a site with an
   envelope and context blocks; placement on the project site; the AI prompt library.
   Port of build/tower/*.js. The math stays in src/tower/ (geometry, envelope, snap, prompts, derived).
   Files here:
     state.js    state shape, defaults, migration, the cached geometry run (createDerived)
     render.js   Three.js groups for the model, the context blocks and the envelope
     select.js   selection, five handles, snapping, copy and delete
     project.js  placement, base elevation, context from site, the 'massing' section
     options.js  saved options, presets, autosave
     panels.js   Form, Program, Site and View panels
     prompts-ui.js  the AI prompt panel
   Live layers: 'tower-model' (replaces the derived 'massing' twin), 'tower-context', 'tower-envelope'.
   ========================================================================== */
import { deckCover, coverKey, platesCoverZs, platesCoverKey } from '../../core/cover.js';
import { createPlacementGizmo } from '../../core/placement.js';
import { Units } from '../../core/ui-kit.js';
import { toProject } from '../../../src/shared/project.js';
import { CONFIG, defaultState, fillDefaults, createDerived, unitBreakdown, num } from './state.js';
import { buildModelGroup, buildContextGroup, buildEnvelopeGroup, aiReadyModel, aiReadyContext, aiReadyEnvelope } from './render.js';
import { createProject } from './project.js';
import { createSelect } from './select.js';
import { createOptions } from './options.js';
import { createPanels } from './panels.js';
import { createPrompts } from './prompts-ui.js';

const TOOL = CONFIG.tool;
const FOOTPRINT_KEYS = ['placement', 'segments', 'podium', 'setbacks', 'carves', 'cuts'];
const footprintPath = (path) => FOOTPRINT_KEYS.some((k) => path === k || String(path).startsWith(`${k}.`));
const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
const signed = (v, fmt) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt(Math.abs(v))}`;

/* ---------- module state (one Tower Generator per page) ---------- */
const T = {
  ctx: null, store: null, derived: null, project: null, select: null, options: null, prompts: null, panels: null,
  flags: { carvesOpen: false, engaged: false, active: false },
  active: () => T.flags.active,
  gizmoSync: () => {},
  metricRows: () => [],
};
let gizmo = null;
let offModel = null, modelReplaces = null;
let offs = [];
let layerRaf = 0, hudRaf = 0;
let saved = null;                       // sun and shadows of the scene before the tower took them

const isDraft = () => {
  const st = T.store;
  if (!st || !st.gestureActive()) return false;
  const gp = String(st.gesturePath ? st.gesturePath() : '');
  return !(gp.startsWith('view') || gp.startsWith('programs') || gp.startsWith('targets') || gp.startsWith('name'));
};

/* ---------- visibility rules ---------- */
/** The tower's own massing section exists, or the user has worked on a tower in this visit. */
const shown = () => {
  if (!T.project) return false;
  if (T.flags.active) return true;
  return T.project.owned() && (T.flags.engaged || T.project.towerSection(T.project.sec('massing')));
};

/* ---------- layers ---------- */
/* The geometry is built in the tower's local frame, so a placement or scene-shift change only moves the group:
   def.always re-places the built group (ctx.frame.placeGroup) and asks for a render, with no rebuild. */
const placeKey = (lctx) => {
  const p = T.project.placement(), s = (lctx && lctx.shift) || { x: 0, y: 0, z: 0 };
  return `${p.x},${p.y},${p.rotation},${p.baseZ}|${s.x},${s.y},${s.z}`;
};
function placeBuilt(id, lctx) {
  const obj = T.ctx.layers.get(id);
  if (!obj) return;
  const k = placeKey(lctx);
  if (obj.userData.placedKey === k) return;
  obj.userData.placedKey = k;
  T.ctx.frame.placeGroup(obj, T.project.placement());
  try { T.ctx.scene.requestRender(); } catch (e) { /* the next sync draws it */ }
}
const placeNew = (group, lctx) => { group.userData.placedKey = placeKey(lctx); T.ctx.frame.placeGroup(group, T.project.placement()); return group; };
const itemFor = (it) => T.select.cardItem(it);

function modelDef() {
  return {
    owner: TOOL, id: 'tower-model', label: 'Tower', order: 20, defaultOn: true,
    replaces: modelReplaces ? ['massing'] : [],
    key(lctx) {
      if (!shown()) return 'off';
      const s = T.store.raw();
      const d = T.derived.display(isDraft());
      return [d.key, lctx.style, s.view.colorBy, s.view.floorLines, JSON.stringify(s.programs), JSON.stringify(s.site), T.flags.active ? 'on' : `idle:${platesCoverKey(lctx.doc)}`, coverKey(lctx.doc)].join('|');
    },
    build(lctx) {
      if (!shown()) return null;
      const s = T.store.raw();
      // the blue site outline belongs to the active tool only
      const group = buildModelGroup(s, { disp: T.derived.display(isDraft()), style: lctx.style, itemFor, showSite: T.flags.active, cover: deckCover(lctx.doc), platesZs: T.flags.active ? null : platesCoverZs(lctx.doc) });
      return placeNew(group, lctx);
    },
    always(lctx) { placeBuilt('tower-model', lctx); },
    aiReady: aiReadyModel,
  };
}
/** The model layer replaces the derived twin while the tower is the active tool or owns the massing section. */
function syncModelLayer() {
  const want = shown();
  if (offModel && want === modelReplaces) return;
  if (offModel) { offModel(); offModel = null; }
  modelReplaces = want;
  offModel = T.ctx.layers.register(modelDef());
}

/** The model (site outline) and the envelope depend on whether the tower is active: rebuild them on activate and deactivate. */
function invalidateLayers() {
  for (const id of ['tower-model', 'tower-envelope']) { try { T.ctx.layers.invalidate(id); } catch (e) { /* the key still changes */ } }
}

function towerLayers(ctx) {
  return [
    {
      id: 'tower-context', label: 'Tower context blocks', order: 21, defaultOn: true,
      key(lctx) {
        if (!shown()) return 'off';
        const s = T.store.raw();
        const skip = T.project.hasSite() && ctx.layers.isOn('site-neighbors');
        return [s.context.show ? 1 : 0, JSON.stringify(s.context.blocks), skip ? 1 : 0, lctx.style].join('|');
      },
      build(lctx) {
        if (!shown()) return null;
        const s = T.store.raw();
        if (!s.context.show || !(s.context.blocks || []).length) return null;
        const skip = T.project.hasSite() && ctx.layers.isOn('site-neighbors');
        return placeNew(buildContextGroup(s, { style: lctx.style, skipSite: skip, itemFor }), lctx);
      },
      always(lctx) { placeBuilt('tower-context', lctx); },
      aiReady: aiReadyContext,
    },
    {
      id: 'tower-envelope', label: 'Zoning envelope', order: 22, defaultOn: true,
      key() {
        if (!shown() || !T.flags.active) return 'inactive';      // the envelope shows only while the tower is the active tool
        const s = T.store.raw();
        const d = T.derived.get();
        return [s.view.envelope ? 1 : 0, JSON.stringify(s.site), d.bounds.model.height].join('|');
      },
      build(lctx) {
        if (!shown() || !T.flags.active) return null;
        const s = T.store.raw();
        if (!s.view.envelope || s.site.shape === 'none') return null;
        const wire = T.derived.get().wire;
        if (!wire || !wire.length) return null;
        return placeNew(buildEnvelopeGroup(s, wire), lctx);
      },
      always(lctx) { placeBuilt('tower-envelope', lctx); },
      aiReady: aiReadyEnvelope,
    },
  ];
}

function syncLayersSoon() {
  if (layerRaf) return;
  layerRaf = requestAnimationFrame(() => {
    layerRaf = 0;
    try { T.ctx.layers.sync(T.ctx); } catch (e) { console.error(e); }
  });
}
function syncHudSoon() {
  if (hudRaf) return;
  hudRaf = requestAnimationFrame(() => { hudRaf = 0; try { T.ctx.refreshHud(); } catch (e) { console.error(e); } });
}

/* ---------- the scene's sun ---------- */
function applySun() {
  const sc = T.ctx.scene;
  const v = T.store.raw().view;
  sc.setSun({ az: num(v.sun && v.sun.azimuth, 135), alt: num(v.sun && v.sun.altitude, 40) });
  sc.setShadows(v.shadows !== false);
}

/* ---------- metrics and warnings ---------- */
const floorsText = (m) => {
  const z = m.floorsByZone || {}, parts = [];
  if (z.podium) parts.push(`${z.podium} podium`);
  if (z.tower) parts.push(`${z.tower} tower`);
  if (z.mechanical) parts.push(`${z.mechanical} mech`);
  if (m.voidFloors) parts.push(`${m.voidFloors} sky gap`);
  return parts.length > 1 || m.voidFloors ? parts.join(' · ') : '';
};
function metricRows() {
  const d = T.derived.get(), m = d.metrics;
  const site = m.hasSite !== false;
  const rows = [
    { label: 'GFA', value: Units.formatArea(m.gfa) },
    { label: 'FAR', value: site ? Units.formatRatio(m.far) : '-', hint: site ? '' : 'No site' },
    { label: 'Height', value: Units.formatFeetInches(m.totalHeight), hint: m.crownHeight > 0 ? `Crown ${Units.formatFeetInches(m.crownHeight)}` : '' },
    { label: 'Floors', value: Units.formatInt(m.floorCount), hint: floorsText(m) },
  ];
  if (site) rows.push({ label: 'Site coverage', value: pct1(m.siteCoverage), hint: `Site area ${Units.formatArea(m.siteArea)}` });
  rows.push({ label: 'Net area', value: Units.formatArea(m.netArea), hint: 'Before core. The Plate Planner sets the core and the efficiency.' });
  if (m.mechanicalArea > 0) rows.push({ label: 'Mechanical', value: Units.formatArea(m.mechanicalArea) });
  const ub = unitBreakdown(m);
  if (ub.hasTotal) rows.push({ label: `${ub.label} (estimate)`, value: Units.formatInt(ub.total), hint: ub.dwelling.map((r) => `${r.label} ${Units.formatInt(r.count)}`).join(' · ') });
  for (const r of ub.spaces) rows.push({ label: r.label, value: Units.formatInt(r.count) });
  const addTarget = (label, t, fmt) => { if (t) rows.push({ label: `${label} vs target`, value: `${signed(t.diff, fmt)} (${signed(t.pct, (v) => `${v.toFixed(1)}%`)})`, hint: `Target ${fmt(t.target)}` }); };
  addTarget('GFA', m.target && m.target.gfa, (v) => Units.formatArea(v));
  if (site) addTarget('FAR', m.target && m.target.far, (v) => Units.formatRatio(v, 2));
  const tier = T.project.gradingFfe();
  if (tier) rows.push({ label: 'Ground floor (Grading)', value: Units.formatFeetInches(tier.ffe) });
  return rows;
}
T.metricRows = metricRows;

/* ---------- the placement gizmo ---------- */
function footprintRing() {
  const b = T.derived.get().bounds.model;
  if (!b || ![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) return null;
  const pl = T.project.placement();
  return [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]].map((q) => toProject(pl, q));
}
function makeGizmo() {
  if (gizmo) return gizmo;
  const ctx = T.ctx;
  try {
    gizmo = createPlacementGizmo({
      scene: ctx.scene, input: ctx.input, ground: ctx.ground,
      get: () => {
        const p = T.store.raw().placement;
        if (!p || typeof p !== 'object') return null;
        return { ...p, baseMode: T.project.baseMode(), pinned: T.project.pinned() };
      },
      set: (p, { live } = {}) => {
        const cur = T.store.raw().placement || {};
        T.store.set('placement', { ...cur, ...p }, { live: true });
        if (!live) T.store.commit();
      },
      bounds: footprintRing,
      pickables: () => {
        const o = ctx.layers.get('tower-model');
        const out = [];
        if (o && o.visible) o.traverse((m) => { if (m.isMesh && m.userData.pick) out.push(m); });
        return out;
      },
      enabled: () => T.flags.active && !T.select.handlesShown(),
    });
  } catch (e) { console.error(e); gizmo = null; }
  return gizmo;
}
T.gizmoSync = () => { if (gizmo) { try { gizmo.sync(); } catch (e) { console.error(e); } } };

/* ---------- reacting to the store ---------- */
async function askAboutForeign() {
  const P = T.project;
  if (!P.hasDoc() || !P.foreignTool() || P.flags.confirmed || P.flags.declined || P.flags.asking) return;
  const ok = await P.askReplace();
  if (ok) { P.flags.confirmed = true; P.markDirty(); P.flush(); } else {
    P.flags.declined = true;
    T.ctx.ui.Toast.show('The project keeps the other massing. Changes here are not saved to it.', { kind: 'warn', ms: 8000 });
  }
}

function onStore(state, info) {
  const live = !!(info && info.live);
  const kind = info ? info.kind : 'set';
  const path = info ? String(info.path || '') : '';
  const P = T.project;
  T.panels.refresh();
  T.prompts.refresh();
  T.select.onStore();
  applySunIfActive();
  syncLayersSoon();
  syncHudSoon();
  T.gizmoSync();
  if (live || P.flags.loading) return;
  if (kind !== 'undo' && kind !== 'redo') {
    if (state.context && state.context.fromSite && P.hasSite() && (path === 'context.radius' || path.startsWith('placement'))) {
      P.flags.loading = true;
      try { P.contextFromSite(undefined, { quiet: true, merge: true, follow: false }); } finally { P.flags.loading = false; }
    }
    if (kind === 'replace' || kind === 'update' || footprintPath(path)) P.followGround({ merge: true });
  }
  if (P.hasDoc() && P.foreignTool() && !P.flags.confirmed) askAboutForeign();
  P.markDirty();
}
function applySunIfActive() { if (T.flags.active) applySun(); }

/* ---------- the tool ---------- */
export default {
  id: TOOL,
  section: 'massing',
  label: 'Tower Generator',
  icon: 'tower',
  order: 20,
  dock: true,

  async init(ctx) {
    T.ctx = ctx;
    try {
      if (!document.getElementById('tower-tool-css')) {
        const link = document.createElement('link');
        link.id = 'tower-tool-css'; link.rel = 'stylesheet'; link.href = new URL('./tool.css', import.meta.url).href;
        document.head.append(link);
      }
    } catch (e) { /* the panels still work */ }

    const store = T.store = this.store = ctx.store(fillDefaults(defaultState()));
    T.derived = createDerived(store);
    T.project = createProject(T);
    T.select = createSelect(T);
    T.options = createOptions(T);
    T.prompts = createPrompts(T);
    T.panels = createPanels(T);

    // the working copy: the project's tower, else the autosaved copy, else the default preset
    const working = T.options.restore() || fillDefaults(defaultState());
    T.project.load({ working });
    T.options.link(null);
    T.options.watch();

    store.subscribe(onStore);
    syncModelLayer();
    T.select.bindKeys();
    offs.push(ctx.bus.on('selection', (e) => T.select.onShellSelection(e || {})));
    T.select.onChange((list) => {
      if (list.length === 1) { try { T.panels.openItem(list[0]); } catch (e) { /* the card still shows */ } }
      T.flags.carvesOpen = false;
    });
    const hide = () => { if (document.visibilityState === 'hidden') T.project.flush(); };
    document.addEventListener('visibilitychange', hide);
    const leave = () => { T.project.flush(); T.options.storage.flush(); };
    window.addEventListener('pagehide', leave);
    offs.push(() => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); });

    try {
      const app = (window.__app = window.__app || {});
      app.tools = app.tools || {};
      app.tools.tower = {
        T, store, derived: T.derived, project: T.project, select: T.select, options: T.options, prompts: T.prompts, panels: T.panels,
        metricRows, sectionPatch: () => T.project.sectionPatch(), flush: () => T.project.flush({ force: true }),
        gizmo: () => gizmo, isDraft, shown,
      };
    } catch (e) { /* tests only */ }
  },

  activate(ctx) {
    const first = !T.flags.engaged;
    T.flags.active = true;
    T.flags.engaged = true;
    T.project.sync();
    saved = { sun: ctx.scene.sun(), shadows: ctx.scene.shadows ? ctx.scene.shadows() : false };
    applySun();
    syncModelLayer();
    invalidateLayers();
    makeGizmo();
    T.select.enable();
    T.panels.refresh();
    T.gizmoSync();
    ctx.layers.sync(ctx);
    if (first) { try { ctx.scene.frameBuilding(); } catch (e) { /* the view stays */ } }
    ctx.refreshHud();
  },

  deactivate(ctx) {
    T.select.disable();
    T.flags.active = false;
    T.project.flush();
    if (saved) { ctx.scene.setSun({ az: saved.sun.az, alt: saved.sun.alt }); ctx.scene.setShadows(saved.shadows); saved = null; }
    syncModelLayer();
    invalidateLayers();
    T.gizmoSync();
    ctx.layers.sync(ctx);
  },

  panels() {
    return [
      { id: 'tower-form', title: 'Tower form', build: (body) => T.panels.form(body), open: true },
      { id: 'tower-program', title: 'Program', build: (body) => T.panels.program(body), open: false },
      { id: 'tower-site', title: 'Site and placement', build: (body) => T.panels.site(body), open: false },
      { id: 'tower-view', title: 'View', build: (body) => T.panels.view(body), open: false },
      { id: 'tower-prompts', title: 'AI prompts', build: (body) => T.prompts.build(body), open: false },
    ];
  },

  layers(ctx) { return towerLayers(ctx); },

  metrics() { return metricRows(); },

  warnings() {
    return T.derived.get().warnings.map((w) => ({ text: w.text, level: w.level === 'error' ? 'error' : 'warn' }));
  },

  onProject(evt, ctx) {
    if (!T.project) return;
    const P = T.project;
    const open = !evt || evt.source === 'open' || !evt.keys;
    if (open) {
      P.flags.confirmed = false; P.flags.declined = false;
      P.load({ working: T.store.raw() });
      T.options.link(null);
      T.select.clear();
    } else {
      if (evt.keys.includes('massing')) P.sync();
      if (evt.keys.includes('site') || evt.keys.includes('grading')) P.followGround({ merge: true });
    }
    syncModelLayer();
    T.panels.refresh();
    ctx.refreshHud();
    if (open) ctx.refreshPanels();
  },

  exports() { return []; },

  card(item) {
    if (!item || item.owner !== TOOL) return [];
    return T.select.cardActions(item);
  },

  onTap(ev) {
    if (!T.flags.active) return false;
    return T.select.onTap(ev);
  },

  store: null,
};
