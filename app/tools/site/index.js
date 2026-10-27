/* ==========================================================================
   TOOL: site (Site Model, docs/shell-plan.md section 9.1)
   Address, coordinates or a Google Maps link -> USGS ground + Overture buildings, roads, water -> the `site` section.
   The scene is drawn by the shell from site.derived (core/derived.js, core/sitelayer3d.js). This tool adds:
   - panel 'site-find': input, size, Go, one progress row per data theme
   - panel 'site-data': counts, Restore all, neighbor style
   - tap a neighbor building: card with Remove or Restore (state.removed + derived.buildings[].removed)
   - layer 'site-removed': a dashed outline where a removed building stood (so it can be tapped and restored)
   - downloads after a run: Revit CSV, DXF, SketchUp, Notes
   Port of build/site/02_pipeline.js and 04_ui.js. The math stays in src/site/.
   ========================================================================== */
import { parseCoordinates, googleMapsUrl } from '../../../src/site/geocode.js';
import { summarize } from '../../../src/site/model.js';
import { revitCsv, siteDxf, notesMarkdown } from '../../../src/site/exports.js';
import { siteToSketchup } from '../../../src/site/sketchup.js';
import { siteDerived, siteState, featureId, removedSet, isRemovedId } from '../../../src/site/derived.js';
import { sketchupFilename, docToBlob } from '../../../src/shared/sketchup-format.js';
import { toProject } from '../../../src/shared/project.js';
import { deliverImage } from '../../../src/shared/screenshot.js';
import { drapeRing, groundZAt } from '../../../src/shared/sitelayer.js';
import * as Pipeline from './pipeline.js';

const { CONFIG } = Pipeline;
const RECENT_KEY = 'sitemodel.recent.v1';       // the same list the old page kept
const RECENT_MAX = 8;
const SCHEMA = 1;
const IDENTITY = { x: 0, y: 0, rotation: 0, baseZ: 0 };
const REMOVED_LAYER = 'site-removed';
const STYLE_OPTIONS = [{ value: 'solid', label: 'Solid' }, { value: 'glass', label: 'Glass' }, { value: 'wireframe', label: 'Wireframe' }];

const grouped = (n, digits = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtFt = (v, d = 1) => (Number.isFinite(v) ? `${grouped(v, d)} ft` : '-');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const todayIso = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const siteKeyOf = (lat, lon, size) => `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)},${size}`;
const sortedIds = (ids) => [...new Set([...ids].map(featureId))].sort();

const Local = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } },
};

/* ---------- tool state (module level: one Site Model per page) ---------- */
let C = null;                         // ctx
let store = null;                     // { removed: [feature ids] } with undo
let suppress = false;                 // true while the tool sets the store itself (no write back)
const form = { text: '', size: CONFIG.defaultSize };
const run = {
  busy: false, id: 0, t0: 0, timer: 0,
  steps: {},                          // step -> { s, msg }
  chip: '', chipKind: '',
  result: null,                       // the last run: { loc, frame, model, release, failed, text }
  started: false,
};
const hooks = {};                     // tests: { fetchFn, fetchThemeFn }
const views = { find: null, data: null, steps: null, status: null, go: null, input: null };
const ui = { controls: null };

/* ---------- reading the project ---------- */
function secInfo() {
  const sec = C && C.project.section('site');
  const dv = sec && isObj(sec.derived) && Array.isArray(sec.derived.buildings) && isObj(sec.derived.ground) ? sec.derived : null;
  const st = sec && isObj(sec.state) ? sec.state : null;
  return { sec, dv, st };
}
const hasSite = () => !!secInfo().dv;
function savedKey() {
  const { st } = secInfo();
  return st && fin(st.lat) && fin(st.lon) && fin(st.size) ? siteKeyOf(st.lat, st.lon, st.size) : null;
}
const removedNow = () => (store ? store.raw().removed : []);
/** The removed feature ids the section holds: state.removed plus every building flagged in derived. */
function savedRemoved() {
  const { dv, st } = secInfo();
  const ids = [];
  if (st && Array.isArray(st.removed)) ids.push(...st.removed.filter((x) => typeof x === 'string'));
  if (dv) for (const b of dv.buildings) if (b.removed === true) ids.push(b.id);
  return sortedIds(ids);
}

function setStoreRemoved(list) {
  suppress = true;
  try { store.replace({ removed: sortedIds(list) }, { resetHistory: true }); } finally { suppress = false; }
}

/** Takes the form and the removed list from the project's site section. */
function loadFromProject() {
  const { st } = secInfo();
  if (st) {
    if (typeof st.query === 'string' && !run.busy) form.text = st.query;
    if (fin(st.size) && st.size > 0 && !run.busy) form.size = st.size;
  }
  setStoreRemoved(savedRemoved());
  // A run belongs to one site: another saved site drops it.
  if (run.result && savedKey() !== siteKeyOf(run.result.loc.lat, run.result.loc.lon, run.result.frame.size)) run.result = null;
}

/* ---------- remove and restore ---------- */
/** Writes state.removed and derived.buildings[].removed for the given feature ids. The rest of the section stays. */
function writeRemoved(list) {
  const { sec, dv, st } = secInfo();
  if (!sec || !dv) return false;
  if (C.project.isReadOnly && C.project.isReadOnly('site')) { C.ui.Toast.show('This project was saved by a newer version. Changes are not saved.', { kind: 'warn' }); return false; }
  const gone = removedSet(list);
  const buildings = dv.buildings.map((b) => {
    const now = isRemovedId(b.id, gone);
    if (now === (b.removed === true)) return b;
    const n = { ...b };
    if (now) n.removed = true; else delete n.removed;
    return n;
  });
  const n = gone.size;
  C.project.write('site', {
    tool: 'site', schema: SCHEMA,
    state: { ...(st || {}), removed: sortedIds(list) },
    derived: { ...dv, buildings },
    note: n ? `${n} ${n === 1 ? 'building' : 'buildings'} removed` : 'All buildings restored',
  });
  return true;
}

function setRemoved(list) {
  if (run.busy) return;
  store.update((d) => { d.removed = sortedIds(list); });
}
const removeBuilding = (id) => setRemoved([...removedNow(), featureId(id)]);
const restoreBuilding = (id) => setRemoved(removedNow().filter((x) => x !== featureId(id)));
const restoreAll = () => setRemoved([]);

/* ---------- counts ---------- */
function counts() {
  const { dv } = secInfo();
  if (!dv) return null;
  const gone = removedSet(dv.buildings.filter((b) => b.removed === true).map((b) => b.id));
  const kept = dv.buildings.filter((b) => b.removed !== true);
  let roadFt = 0;
  for (const s of (dv.roads && dv.roads.segments) || []) for (let i = 1; i < s.line.length; i++) roadFt += Math.hypot(s.line[i][0] - s.line[i - 1][0], s.line[i][1] - s.line[i - 1][1]);
  let zMin = Infinity, zMax = -Infinity;
  for (const p of dv.ground.points || []) { if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2]; }
  return {
    buildings: kept.length, removed: dv.buildings.length - kept.length, removedFeatures: gone.size,
    estimated: kept.filter((b) => b.rule === 'estimate').length,
    roads: ((dv.roads && dv.roads.segments) || []).length, roadFt,
    water: ((dv.water && dv.water.areas) || []).length,
    size: dv.size, gridN: dv.ground.n, spacing: dv.ground.spacing, zMin, zMax,
  };
}

/* ---------- progress rows ---------- */
function setStep(step, status, msg) {
  run.steps[step] = { s: status, msg: msg || (status === 'pending' ? 'Waiting' : '') };
  const li = views.steps && views.steps.isConnected ? views.steps.querySelector(`[data-step="${step}"]`) : null;
  if (!li) return;
  li.dataset.s = status;
  li.querySelector('.site-step-msg').textContent = run.steps[step].msg;
}
function renderSteps() {
  const ul = views.steps;
  if (!ul) return;
  ul.replaceChildren();
  ul.hidden = !run.started;
  for (const [k, label] of CONFIG.steps) {
    const st = run.steps[k] || { s: 'pending', msg: 'Waiting' };
    ul.append(C.ui.h('li', { class: 'site-step', 'data-step': k, 'data-s': st.s },
      C.ui.h('span', { class: 'site-dot', 'aria-hidden': 'true' }),
      C.ui.h('span', null, C.ui.h('span', { class: 'site-step-name' }, label), C.ui.h('span', { class: 'site-step-msg' }, st.msg))));
  }
}
function setChip(text, kind = '') {
  run.chip = text || ''; run.chipKind = kind;
  const el = views.status;
  if (!el || !el.isConnected) return;
  el.textContent = run.chip;
  el.className = `site-status ${kind}`.trim();
}
function setBusy(b) {
  run.busy = b;
  const g = views.go;
  if (g && g.isConnected) { g.disabled = b; g.textContent = b ? 'Working' : 'Go'; }
  if (views.input && views.input.isConnected) views.input.disabled = b;
}

/* ---------- Go ---------- */
function recents() {
  const v = Local.get(RECENT_KEY, []);
  return Array.isArray(v) ? v.filter((e) => e && e.text && e.size && Number.isFinite(e.lat) && Number.isFinite(e.lon)) : [];
}
function saveRecent(r, text) {
  const entry = { text, label: r.loc.label, lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, t: Date.now() };
  const list = recents().filter((e) => !(e.text === entry.text && e.size === entry.size));
  list.unshift(entry);
  Local.set(RECENT_KEY, list.slice(0, RECENT_MAX));
  renderFind();
}

function metaOf(r, text, removed) {
  return { address: text, lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, release: r.release, date: todayIso(), removed, walks: false };
}

/** The project frame is the site (spec section 4). project.setMeta saves it with the next flush. */
function adoptFrame(r, text) {
  const want = { kind: 'site', lat: r.loc.lat, lon: r.loc.lon, size: r.frame.size, zDatum: 'NAVD88' };
  const doc = C.project.doc();
  if (!doc) return;
  const have = doc.frame || {};
  const same = have.kind === 'site' && have.lat === want.lat && have.lon === want.lon && have.size === want.size && have.zDatum === want.zDatum;
  const title = /^https?:/i.test(text) ? r.loc.label : text;
  const named = doc.name === 'Untitled project' && title;
  if (same && !named) return;
  const others = !same && Object.keys(doc.sections || {}).some((k) => {
    const s = doc.sections[k];
    return k !== 'site' && s && ((s.state && Object.keys(s.state).length) || (s.derived && Object.keys(s.derived).length));
  });
  C.project.setMeta({ frame: want, name: named ? String(title) : undefined });
  if (others) C.ui.Toast.show('The site of this project changed. Work from other tools may need a new placement.', { kind: 'warn', ms: 7000 });
}

async function go(req = {}) {
  if (run.busy) return null;
  const text = String(req.text != null ? req.text : form.text).trim();
  if (!text) { C.ui.Toast.show('Type an address, coordinates, or a Google Maps link first.', { kind: 'warn' }); if (views.input) views.input.focus(); return null; }
  const size = req.size || form.size;
  if (C.project.isReadOnly && C.project.isReadOnly('site')) { C.ui.Toast.show('This project was saved by a newer version. Changes are not saved.', { kind: 'warn' }); return null; }
  if (!req.skipConfirm && hasSite()) {
    const ok = await C.ui.confirmDialog({ title: 'Replace the site?', body: 'This project already has a site. Loading a new one replaces it and the list of removed buildings.', ok: 'Replace', cancel: 'Keep it' });
    if (!ok) return null;
  }
  form.text = text; form.size = size;
  const id = ++run.id;
  const doc0 = C.project.doc();
  const id0 = doc0 ? doc0.id : null;
  run.started = true; run.steps = {};
  for (const [k] of CONFIG.steps) run.steps[k] = { s: 'pending', msg: 'Waiting' };
  renderSteps();
  setBusy(true);
  run.t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const elapsed = () => secs((typeof performance !== 'undefined' ? performance.now() : Date.now()) - run.t0);
  clearInterval(run.timer);
  run.timer = setInterval(() => setChip(`Loading the site, ${elapsed()}`), 250);
  setChip('Loading the site, 0.0 s');

  let r = null, failure = null;
  try {
    r = await Pipeline.run({ text, size, loc: req.loc }, (step, st, msg) => { if (id === run.id) setStep(step, st, msg); },
      { fetchFn: hooks.fetchFn || req.fetchFn || undefined, fetchThemeFn: hooks.fetchThemeFn || undefined });
  } catch (e) { failure = e; }
  clearInterval(run.timer);
  const dt = elapsed();
  setBusy(false);
  if (id !== run.id) return null;
  if (failure) {
    console.error(failure);
    setChip(failure.message, 'bad');
    C.ui.Toast.show(failure.message, { kind: 'error', ms: 8000 });
    return null;
  }
  const nowDoc = C.project.doc();
  if (id0 && (!nowDoc || nowDoc.id !== id0)) {
    setChip('The project changed while the site loaded, so the site was not saved.', 'warn');
    return null;
  }

  // The removed list belongs to one site: another site clears it. On the same site, ids that no longer exist are dropped.
  const sameSite = savedKey() === siteKeyOf(r.loc.lat, r.loc.lon, r.frame.size);
  const have = new Set(r.model.buildings.map((b) => featureId(b.id)));
  const removed = sameSite ? sortedIds(removedNow().filter((x) => have.has(x))) : [];
  const meta = metaOf(r, text, removed);
  let patch = null;
  try {
    patch = { tool: 'site', schema: SCHEMA, placement: { ...IDENTITY }, state: siteState(meta), derived: siteDerived(r.model, meta), note: `${text}, ${grouped(meta.size)} ft` };
  } catch (e) {
    console.error(e);
    setChip('The site could not be saved.', 'bad');
    C.ui.Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), { kind: 'error', ms: 8000 });
    return null;
  }
  r.text = text;
  run.result = r;
  const written = C.project.write('site', patch);
  if (!written) { setChip('The site is on screen but was not saved.', 'warn'); return r; }
  setStoreRemoved(removed);
  adoptFrame(r, text);
  C.frame.setShift(C.frame.shiftFor(C.project.doc()));       // the shell computes the shift when a project opens
  C.scene.frameSite();
  if (!req.fromRecent) saveRecent(r, text);
  const bad = r.failed.map((k) => CONFIG.steps.find((s) => s[0] === k)[1]);
  setChip(bad.length ? `Loaded in ${dt}. Not loaded: ${bad.join(', ')}` : `Loaded in ${dt}`, bad.length ? 'warn' : '');
  if (bad.length) C.ui.Toast.show(`${bad.join(' and ')} could not be loaded. The rest of the site is shown.`, { kind: 'warn', ms: 7000 });
  C.refreshPanels();
  C.refreshHud();
  return r;
}

/* ---------- files ---------- */
function slugOf(r) {
  const base = String((r && r.text) || (r && r.loc && r.loc.label) || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'site';
  return `${base}-${r ? r.frame.size : form.size}ft`;
}
/** The run that matches the saved site, or null. Files come from the run's model (the section holds rounded data). */
function liveResult() {
  const r = run.result;
  if (!r || run.busy) return null;
  return savedKey() === siteKeyOf(r.loc.lat, r.loc.lon, r.frame.size) ? r : null;
}
function fileFor(kind) {
  const r = liveResult();
  if (!r) return null;
  const removed = new Set(removedNow());
  const meta = metaOf(r, r.text, [...removed]);
  const model = r.model.trees && r.model.trees.length ? { ...r.model, trees: [] } : r.model;     // trees stay out of every file
  const slug = slugOf(r);
  if (kind === 'csv') return { name: `${slug}-topo.csv`, text: revitCsv(model.ground), type: 'text/csv' };
  if (kind === 'dxf') return { name: `${slug}-site.dxf`, text: siteDxf(model, { removed }), type: 'application/dxf' };
  if (kind === 'notes') return { name: `${slug}-notes.md`, text: notesMarkdown(model, meta), type: 'text/markdown' };
  if (kind === 'sketchup') return { name: sketchupFilename(slug, new Date()), blob: docToBlob(siteToSketchup(model, meta)), type: 'application/json' };
  return null;
}
async function download(kind) {
  let f = null;
  try { f = fileFor(kind); } catch (e) { console.error(e); C.ui.Toast.show(`The file could not be made. ${e.message}`, { kind: 'error', ms: 6000 }); return; }
  if (!f) { C.ui.Toast.show('Load the site with Go first.', { kind: 'warn' }); return; }
  try {
    const res = await deliverImage(f.blob || new Blob([f.text], { type: f.type }), f.name);
    if (res === 'downloaded') C.ui.Toast.show(`Saved ${f.name}`);
  } catch (e) { console.error(e); C.ui.Toast.show(`The file could not be made. ${e.message}`, { kind: 'error', ms: 6000 }); }
}

/* ---------- the removed-building layer ---------- */
function buildRemoved(THREE) {
  const { sec, dv } = secInfo();
  if (!sec || !dv) return null;
  const list = dv.buildings.filter((b) => b.removed === true);
  if (!list.length) return null;
  const sh = C.frame.getShift();
  const group = new THREE.Group();
  const w = (p, lift) => { const q = toProject(sec, [p[0], p[1], p[2]]); return new THREE.Vector3(q[0] - sh.x, q[2] - sh.z + lift, -(q[1] - sh.y)); };
  const segs = [];
  list.forEach((b) => {
    // the outline follows the ground (drapeRing: a point every 10 ft, 1 ft above the ground)
    for (const ring of [b.outer, ...(b.holes || [])]) {
      const pts = drapeRing(dv, sec.placement, ring, 10, 1.0, true);
      for (let i = 0; i < pts.length; i++) segs.push(w(pts[i], 0), w(pts[(i + 1) % pts.length], 0));
    }
    // a flat, see-through footprint so a tap finds it; each corner sits on the ground
    const outer = b.outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = (b.holes || []).map((hh) => hh.map((p) => new THREE.Vector2(p[0], p[1])));
    let tris = [];
    try { tris = THREE.ShapeUtils.triangulateShape(outer, holes); } catch (e) { tris = []; }
    if (!tris.length) return;
    const flat = [...b.outer, ...(b.holes || []).flat()];
    const pos = [];
    flat.forEach((p) => {
      const q = toProject(sec, [p[0], p[1], 0]);
      const gz = groundZAt(dv, q[0], q[1]);
      const v = w([p[0], p[1], (gz === null ? b.base + sec.placement.baseZ : gz) - (sec.placement.baseZ || 0)], 1.0);
      pos.push(v.x, v.y, v.z);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(tris.flat());
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xa5adb7, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mesh.renderOrder = 2;
    const item = {
      id: `site:${b.id}`, title: b.name || 'Removed building', owner: 'site', layer: REMOVED_LAYER, removed: true,
      rows: [['Status', 'Removed'], ['Height', fmtFt(b.height, 1)], ['Floors', String(b.floors || '')]],
    };
    mesh.userData.pick = () => item;
    group.add(mesh);
  });
  if (!group.children.length && !segs.length) return null;
  if (segs.length) {
    const geo = new THREE.BufferGeometry().setFromPoints(segs);
    const lines = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: 0xa5adb7, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.9 }));
    lines.computeLineDistances();
    lines.raycast = () => {};
    lines.renderOrder = 3;
    group.add(lines);
  }
  group.userData.count = list.length;
  return group;
}

/* ---------- panels ---------- */
function fieldSizeOptions() {
  const sizes = CONFIG.sizes.includes(form.size) ? CONFIG.sizes : [...CONFIG.sizes, form.size].sort((a, b) => a - b);
  return sizes.map((v) => ({ value: v, label: grouped(v), title: `${grouped(v)} ft square` }));
}

function currentPoint() {
  const typed = parseCoordinates(form.text);
  if (typed) return typed;
  const { st } = secInfo();
  return st && fin(st.lat) && fin(st.lon) ? { lat: st.lat, lon: st.lon } : null;
}

function buildFind(body) {
  const { h, Controls } = C.ui;
  views.find = body;
  const input = h('input', {
    class: 'textfield', id: 'site-addr', type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'go',
    placeholder: 'Address, coordinates, or Google Maps link', 'aria-label': 'Address, coordinates, or Google Maps link',
  });
  input.value = form.text;
  input.disabled = run.busy;
  input.addEventListener('input', () => { form.text = input.value; if (maps) maps.disabled = !currentPoint(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  views.input = input;

  const sizeCtl = Controls.segmented({ label: 'Site size (ft)', bind: { get: () => form.size, set: (v) => { form.size = v; }, commit() {} }, options: fieldSizeOptions() });
  const goBtn = h('button', { class: 'btn primary', type: 'button', id: 'site-go', onclick: () => go() }, run.busy ? 'Working' : 'Go');
  goBtn.disabled = run.busy;
  views.go = goBtn;
  const maps = h('button', { class: 'btn outline', type: 'button', title: 'Open this place in Google Maps', onclick: () => { const p = currentPoint(); if (p) window.open(googleMapsUrl(p.lat, p.lon), '_blank', 'noopener'); } }, 'Maps');
  maps.disabled = !currentPoint();
  const status = h('div', { class: `site-status ${run.chipKind}`.trim(), id: 'site-status', role: 'status' }, run.chip);
  views.status = status;
  const steps = h('ul', { class: 'site-steps', id: 'site-steps', 'aria-label': 'Data themes' });
  views.steps = steps;

  body.append(h('div', { class: 'site-addr-row' }, input, sizeCtl.el), h('div', { class: 'site-go-row' }, goBtn, maps), status, steps);
  renderSteps();

  const list = recents();
  if (list.length) {
    body.append(h('div', { class: 'label sub-label' }, 'Recent sites'),
      h('div', { class: 'site-recents' }, ...list.map((e) => h('button', {
        class: 'site-recent', type: 'button', title: e.label,
        onclick: () => { if (run.busy) return; form.text = e.text; form.size = e.size; input.value = e.text; go({ text: e.text, size: e.size, loc: { lat: e.lat, lon: e.lon, label: e.label }, fromRecent: true }); },
      }, h('span', { class: 't' }, e.text), h('span', { class: 's' }, `${grouped(e.size)} ft`)))));
  }
}
function renderFind() {
  const b = views.find;
  if (!b || !b.isConnected) return;
  b.replaceChildren();
  buildFind(b);
}

function buildData(body) {
  views.data = body;
  renderData();
}
function renderData() {
  const body = views.data;
  if (!body || !body.isConnected) return;
  const { h, Controls } = C.ui;
  body.replaceChildren();
  const c = counts();
  if (!c) {
    body.append(h('p', { class: 'help' }, 'The numbers appear after the site loads.'));
  } else {
    const row = (k, v, small) => [h('dt', null, k), h('dd', null, v, small ? h('small', null, ` ${small}`) : null)];
    body.append(h('dl', { class: 'site-kv', id: 'site-counts' },
      row('Buildings', grouped(c.buildings), c.estimated ? `${grouped(c.estimated)} estimated` : ''),
      row('Removed', grouped(c.removedFeatures)),
      row('Roads', grouped(c.roads), c.roads ? fmtFt(c.roadFt, 0) : ''),
      row('Water areas', grouped(c.water)),
      row('Ground', `${grouped(c.size)} ft square`, `${c.gridN} by ${c.gridN} points`),
      row('Elevation', `${grouped(c.zMin, 1)} to ${grouped(c.zMax, 1)} ft`)));
    const restoreRow = Controls.row([{ label: 'Restore all', action: () => restoreAll(), title: 'Put back every removed building' }]);
    const restoreBtn = restoreRow.querySelector('button');
    restoreBtn.id = 'site-restore-all';
    restoreBtn.disabled = !c.removed;
    body.append(restoreRow);
  }
  const style = Controls.segmented({
    label: 'Neighbor buildings', options: STYLE_OPTIONS,
    bind: { get: () => (C.siteStyle ? C.siteStyle() : 'solid'), set: (v) => { if (C.setSiteStyle) C.setSiteStyle(v); }, commit() {} },
  });
  body.append(style.el);
  body.append(h('p', { class: 'help' }, 'Tap a neighbor building and select Remove on its card to take it out of the site. A dashed outline stays where it stood. Tap the outline and select Restore to put it back. Other tools and every download leave out a removed building.'));
  const r = liveResult();
  if (c && !r && !run.busy) {
    const { st } = secInfo();
    if (st && typeof st.query === 'string' && st.query.trim() && fin(st.lat) && fin(st.lon) && fin(st.size)) {
      body.append(Controls.row([{ label: 'Load again for downloads', title: 'Load the data again so the downloads are ready', action: () => go({ text: st.query, size: st.size, loc: { lat: st.lat, lon: st.lon, label: st.query }, skipConfirm: true, fromRecent: true }) }]));
      body.append(h('p', { class: 'help' }, 'Downloads need the data of a fresh load.'));
    }
  }
}

/* ---------- the tool ---------- */
export default {
  id: 'site',
  section: 'site',
  label: 'Site Model',
  icon: 'site',
  order: 10,
  dock: true,

  async init(ctx) {
    C = ctx;
    try {
      if (!document.getElementById('site-tool-css')) {
        const link = document.createElement('link');
        link.id = 'site-tool-css'; link.rel = 'stylesheet'; link.href = new URL('./tool.css', import.meta.url).href;
        document.head.append(link);
      }
    } catch (e) { /* the panels still work */ }
    store = ctx.store({ removed: [] });
    this.store = store;
    store.subscribe((state) => {
      if (suppress) return;
      if (JSON.stringify(savedRemoved()) === JSON.stringify(state.removed)) return;
      writeRemoved(state.removed);
      ctx.select(null);
      renderData();
      ctx.refreshHud();
    });
    loadFromProject();
    try {
      const app = (window.__app = window.__app || {});
      app.tools = app.tools || {};
      app.tools.site = {
        hooks,
        go: (text, size, extra) => { if (text != null) form.text = text; if (size) form.size = size; return go(extra || {}); },
        form, run: () => ({ busy: run.busy, chip: run.chip, steps: JSON.parse(JSON.stringify(run.steps)), hasResult: !!run.result, failed: run.result ? run.result.failed : null }),
        steps: () => [...document.querySelectorAll('#site-steps li')].map((li) => ({ step: li.dataset.step, status: li.dataset.s, message: li.querySelector('.site-step-msg').textContent })),
        result: () => run.result,
        removed: () => [...removedNow()],
        remove: removeBuilding, restore: restoreBuilding, restoreAll,
        counts, file: fileFor,
      };
    } catch (e) { /* tests only */ }
  },

  activate() { renderFind(); renderData(); },
  deactivate() { views.find = null; views.data = null; views.steps = null; views.status = null; views.go = null; views.input = null; },

  panels() {
    return [
      { id: 'site-find', title: 'Find a site', build: buildFind, open: true },
      { id: 'site-data', title: 'Site data', build: buildData, open: true },
    ];
  },

  layers(ctx) {
    const THREE = ctx.THREE;
    return [{
      id: REMOVED_LAYER, label: 'Removed buildings', order: 11.5, defaultOn: true,
      key() {
        const doc = ctx.project.doc(), sec = ctx.project.section('site'), sh = ctx.frame.getShift();
        return [doc ? doc.id : '-', sec ? sec.updatedAt : '-', `${sh.x},${sh.y},${sh.z}`].join('|');
      },
      build() { try { return buildRemoved(THREE); } catch (e) { console.error(e); return null; } },
    }];
  },

  metrics() {
    const c = counts();
    if (!c) return [];
    return [
      { label: 'Buildings', value: grouped(c.buildings), hint: c.estimated ? `${c.estimated} with an estimated height` : '' },
      { label: 'Removed', value: grouped(c.removedFeatures) },
      { label: 'Roads', value: fmtFt(c.roadFt, 0), hint: `${c.roads} road segments` },
      { label: 'Water areas', value: grouped(c.water) },
      { label: 'Site', value: `${grouped(c.size)} ft square` },
      { label: 'Elevation', value: `${grouped(c.zMin, 1)} to ${grouped(c.zMax, 1)} ft` },
    ];
  },

  warnings() {
    const out = [];
    const r = run.result;
    if (r && r.failed && r.failed.length) {
      for (const k of r.failed) {
        const label = (CONFIG.steps.find((s) => s[0] === k) || [k, k])[1];
        const st = run.steps[k];
        out.push({ text: `${label} could not be loaded${st && st.msg ? `: ${st.msg}` : '.'}`, level: 'warn' });
      }
    }
    return out;
  },

  onProject(evt) {
    if (!evt || (evt.source !== 'open' && evt.keys && !evt.keys.includes('site'))) return;
    loadFromProject();
    renderFind();
    renderData();
  },

  exports() {
    if (!liveResult()) return [];
    return [
      { id: 'site-csv', label: 'Revit CSV (ground points)', run: () => download('csv') },
      { id: 'site-dxf', label: 'DXF', run: () => download('dxf') },
      { id: 'site-sketchup', label: 'SketchUp', run: () => download('sketchup') },
      { id: 'site-notes', label: 'Notes', run: () => download('notes') },
    ];
  },

  card(item) {
    if (!item || (item.layer !== 'site-neighbors' && item.layer !== REMOVED_LAYER)) return [];
    const id = String(item.id || '').replace(/^site:/, '');
    if (!id) return [];
    const gone = removedNow().includes(featureId(id));
    const done = () => { C.select(null); };
    return gone
      ? [{ label: 'Restore', action: () => { restoreBuilding(id); done(); } }]
      : [{ label: 'Remove', action: () => { removeBuilding(id); done(); } }];
  },

  onTap(ev, ctx) {
    if (run.busy) return false;
    const hit = ctx.layers.pick(ev.clientX, ev.clientY);
    if (!hit || (hit.layerId !== 'site-neighbors' && hit.layerId !== REMOVED_LAYER)) return false;
    ctx.select({ ...hit.item, layer: hit.layerId }, 'site');
    return true;
  },

  store: null,
};
