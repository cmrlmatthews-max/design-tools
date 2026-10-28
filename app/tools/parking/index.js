/* ==========================================================================
   TOOL: parking (Parking Deck Generator, docs/shell-plan.md section 9.3)
   Port of build/parking/*.js. The math stays in src/parking/*. This file is the tool object of app/CONTRACT.md section 14:
   state and undo, the project glue (useSource logic, base elevation, the `parking` section), the live layers, metrics,
   warnings, exports and the test hooks. Panels are in panels.js, the selection handles in handles.js, the 3D builders in
   deck3d.js, the state and pipeline in state.js.

   Frames: layout (SW corner of the footprint bounding rect) -> local (the massing frame) -> project (placement). The layer
   draws in the layout frame, puts that group in the local frame with Derived.matrix and places it with frame.placeGroup.
   ========================================================================== */
import * as THREE from 'three';
import { toProject, toLocal } from '../../../src/shared/project.js';
import { parkingDerived } from '../../../src/parking/derived.js';
import { parkingToSketchup } from '../../../src/parking/sketchup.js';
import { parkingDxf, stallCsv } from '../../../src/parking/exports.js';
import { validateDoc, docToBlob, sketchupFilename } from '../../../src/shared/sketchup-format.js';
import { deliverImage } from '../../../src/shared/screenshot.js';
import { createPlacementGizmo, lowestGround } from '../../core/placement.js';
import { Units } from '../../core/ui-kit.js';
import { css } from '../../core/scene.js';
import {
  CONFIG, RAMP_LABELS, SOURCE_LABELS, num, clamp, deepClone, isObj, rnd, fillDefaults, defaultState, createDerived, createReaders,
  ZERO_PLACEMENT, LayoutMod, RampsMod, boxOfRings, computeDerived, clipPolys, multiArea, isEmptyLinked,
} from './state.js';
import { createMats, buildModel, buildOverlay, boxGeo } from './deck3d.js';
import { buildScreens, screenOpenness } from './screen.js';
import { buildPanels } from './panels.js';
import { createHandles } from './handles.js';

const SECTION = 'parking';
const pt2 = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);
const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
const ft = (v) => Units.formatFeetInches(v);
const READ_ONLY_TEXT = 'This project was saved by a newer version of this tool. You can view it, but changes are not saved.';
const LINK_NOTE = 'Podium parking from the massing program';
const START_GAP = 30;                 // ft between a new standalone deck and the massing

/* ---------- module state (one Parking Deck per page) ---------- */
let C = null;                         // ctx
const T = {};                         // shared with panels.js and handles.js
let mats = null, gizmo = null, handles = null;
let quiet = 0;                        // > 0 while the tool sets its own state (no section write)
let active = false;
let readOnlyShown = false;
let pendingWrite = false;             // a load moved the base to the grading FFE, or linked the deck to the podium program
let pendingNote = null;               // the log note of that pending write
let tick = 0;                         // goes up when the layers must rebuild without a store change
const offs = [];

const S = () => T.store.raw();
const D = () => T.derived.get();

/* ---------- placement and base elevation ---------- */
const baseMode = (s = S()) => (isObj(s.placement) && s.placement.baseMode === 'typed' ? 'typed' : 'follow');
const pinned = (s = S()) => isObj(s.placement) && s.placement.pinned === true;

/** The placement the deck stands on (project frame). A wrap deck or a podium stands where the massing stands. */
function placementOf(s = S()) {
  if (s.source !== 'standalone') {
    const m = T.readers.massingPlacement();
    if (m) return m;
  }
  const p = s.placement;
  return isObj(p) ? { x: num(p.x, 0), y: num(p.y, 0), rotation: num(p.rotation, 0), baseZ: num(p.baseZ, 0) } : ZERO_PLACEMENT();
}

const layoutToLocal = (p) => pt2(D().frame.toLocal([p[0], p[1]]));
const localToLayout = (p) => pt2(D().frame.toLayout([p[0], p[1]]));
const localToProject = (p, pl = placementOf()) => { const q = toProject(pl, [p[0], p[1]]); return [q[0], q[1]]; };
const projectToLocal = (p, pl = placementOf()) => { const q = toLocal(pl, [p[0], p[1]]); return [q[0], q[1]]; };
const layoutToProject = (p, pl = placementOf()) => localToProject(layoutToLocal(p), pl);

/** The deck footprint (bounding box of the plates) as a ring in the project frame. */
function footprintRing(pl = placementOf()) {
  const b = D().bounds;
  if (!b || ![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) return [];
  return [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]].map((p) => localToProject(p, pl));
}

/** Sets placement.baseZ to the grading FFE, else the lowest ground under the footprint. One merged step. Returns true when it changed. */
function followGround({ merge = true, force = false } = {}) {
  const s = S();
  if ((quiet && !force) || T.store.gestureActive()) return false;
  if (s.source !== 'standalone' || !isObj(s.placement) || baseMode(s) !== 'follow' || pinned(s)) return false;
  let z = T.readers.gradingFfe();
  if (z == null) {
    const pl = placementOf(s);
    z = lowestGround((x, y) => C.ground.at(x, y), footprintRing(pl), pl, pl);
  }
  if (z == null || !Number.isFinite(z) || Math.abs(z - num(s.placement.baseZ, 0)) < 1e-9) return false;
  quiet++;
  try { T.store.set('placement.baseZ', z, { merge }); } finally { quiet--; }
  return true;
}

function setBaseMode(mode) {
  const s = S();
  if (!isObj(s.placement) || (mode !== 'follow' && mode !== 'typed') || baseMode(s) === mode) return false;
  T.store.set('placement.baseMode', mode, { live: false });
  return true;
}
function baseLineText() {
  const z = num(placementOf().baseZ, 0);
  const fmt = (v) => `${(Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })} ft`;
  if (T.readers.gradingFfe() != null) return `Ground floor at ${fmt(z)}, the finished floor from the Grading Sketch.`;
  const pl = placementOf();
  const low = lowestGround((x, y) => C.ground.at(x, y), footprintRing(pl), pl, pl);
  return low != null ? `Ground floor at ${fmt(z)} above sea level.` : `This project has no site ground. The base stays at ${fmt(z)}.`;
}

/* ---------- source (docs/shell-plan.md 9.3; build/parking/09b_project.js useSource) ---------- */
function applySource(source, { quiet: q = false } = {}) {
  const src = T.readers.sources().find((x) => x.source === source);
  if (!src) {
    if (!q) C.ui.Toast.show(source === 'wrap' ? 'The massing has no deck levels.' : 'The massing has no podium levels.', { kind: 'warn', ms: 6000 });
    return false;
  }
  const next = deepClone(S());
  const lv = src.levels;
  next.source = source;
  next.linked = false;
  next.sourceLevel = lv[0].index;
  next.levels.count = Math.min(CONFIG.limits.maxLevels, lv.length);
  next.levels.ftf1 = lv[0].ftf;
  next.levels.ftf = lv[1] ? lv[1].ftf : lv[0].ftf;
  next.levels.belowGrade = lv.filter((l) => l.z < -0.01).length;
  next.coresFromProject = true;
  const pl = T.readers.massingPlacement();
  if (pl) next.placement = { ...pl, baseMode: baseMode(next) };
  T.store.replace(fillDefaults(next));
  if (!q) C.ui.Toast.show(`${SOURCE_LABELS[source]}: ${lv.length} level${lv.length === 1 ? '' : 's'} from the project.`);
  return true;
}

/* ---------- podium parking from the massing program ("direction B", Cade, October 28, 2026) ----------
   The Tower program owns the parking floors. A linked podium deck (source 'podium', linked true) covers exactly the
   lowest podium level with program 'parking' and the contiguous parking podium levels above it. With none left it has
   zero levels and draws nothing. */
/** The state of a linked podium deck for the massing on file, built on `base` (bays, ramps, screen... stay). */
function linkedState(base) {
  const run = T.readers.parkingRun();
  const next = fillDefaults(deepClone(base));
  next.source = 'podium';
  next.linked = true;
  if (run.length) {
    next.sourceLevel = run[0].index;
    next.levels.count = Math.min(CONFIG.limits.maxLevels, run.length);
    next.levels.ftf1 = run[0].ftf;
    next.levels.ftf = run[1] ? run[1].ftf : run[0].ftf;
    next.levels.belowGrade = run.filter((l) => l.z < -0.01).length;
  } else {
    next.sourceLevel = null;
    next.levels.count = 0;
    next.levels.belowGrade = 0;
  }
  next.coresFromProject = true;
  next.view.level = 0;
  const pl = T.readers.massingPlacement();
  if (pl) next.placement = { ...pl, baseMode: baseMode(next) };
  return fillDefaults(next);
}
const linkFields = (s) => JSON.stringify([s.source, s.linked, s.sourceLevel, s.levels, s.coresFromProject]);
const isLinked = (s = S()) => s.source === 'podium' && s.linked === true;

/** Follows the massing program: a linked deck re-applies the rule, a project with no parking section links when the
 *  podium has parking floors. Writes the section (log note LINK_NOTE). Returns true when it changed the deck. */
function relink() {
  if (!T.readers.has() || T.store.gestureActive()) return false;
  const s = S();
  const has = !!T.readers.sectionOf(SECTION);
  if (has ? !isLinked(s) : !T.readers.parkingRun().length) return false;
  const next = linkedState(s);
  if (has && linkFields(next) === linkFields(s)) return false;
  quiet++;
  try { T.store.replace(next, { undoable: false }); } finally { quiet--; }
  T.derived.reset();
  T.started = true;
  followGround({ merge: true, force: true });
  writeSection({ note: LINK_NOTE });
  return true;
}

/* ---------- a new standalone deck starts beside the massing, on the open side of the site ---------- */
const rectRing = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const asPolys = (rings) => rings.filter((r) => Array.isArray(r) && r.length >= 3).map((r) => ({ outer: r.map((q) => [q[0], q[1]]), holes: [] }));
/** The placement (project frame, rotation 0) of a new standalone deck, or null to keep the default. Toasts when nothing fits. */
function startPlacement(state) {
  const rings = T.readers.massingRings();
  if (!rings.length) return null;
  const probe = fillDefaults({ ...deepClone(state), source: 'standalone', linked: false, sourceLevel: null });
  const pd = computeDerived(probe, { project: null });
  const b = pd.ok && pd.box ? pd.bounds : null;
  if (!b) return null;
  const w = b.maxX - b.minX, h = b.maxY - b.minY, ox = (b.minX + b.maxX) / 2, oy = (b.minY + b.maxY) / 2;
  const M = boxOfRings(rings);
  const mx = (M.minX + M.maxX) / 2, my = (M.minY + M.maxY) / 2;
  const site = T.readers.siteDerived();
  const boundary = site && Array.isArray(site.boundary) && site.boundary.length >= 3 ? asPolys([site.boundary]) : null;
  const blockers = asPolys([...rings, ...((site && Array.isArray(site.buildings) ? site.buildings : []).filter((x) => x && !x.removed).map((x) => x.outer))]);
  const BIG = 1e5;
  const sides = [
    { side: 'east', cx: M.maxX + START_GAP + w / 2, cy: my, half: rectRing(M.maxX, -BIG, BIG, BIG) },
    { side: 'south', cx: mx, cy: M.minY - START_GAP - h / 2, half: rectRing(-BIG, -BIG, BIG, M.minY) },
    { side: 'west', cx: M.minX - START_GAP - w / 2, cy: my, half: rectRing(-BIG, -BIG, M.minX, BIG) },
    { side: 'north', cx: mx, cy: M.maxY + START_GAP + h / 2, half: rectRing(-BIG, M.maxY, BIG, BIG) },
  ];
  const area = (polys) => { try { return multiArea(polys); } catch (e) { return 0; } };
  for (const sd of sides) {
    sd.free = 0;
    if (!boundary) continue;
    try {
      let free = clipPolys(boundary, asPolys([sd.half]), 'and');
      if (free.length && blockers.length) free = clipPolys(free, blockers, 'diff');
      sd.free = area(free);
    } catch (e) { sd.free = 0; }
  }
  const order = boundary ? sides.slice().sort((p, q) => q.free - p.free) : sides;
  const fits = (sd) => {
    const r = asPolys([rectRing(sd.cx - w / 2, sd.cy - h / 2, sd.cx + w / 2, sd.cy + h / 2)]);
    const ra = w * h;
    try {
      if (boundary && area(clipPolys(r, boundary, 'and')) < ra - 1) return false;
      if (blockers.length && area(clipPolys(r, blockers, 'and')) > 1) return false;
    } catch (e) { return false; }
    return true;
  };
  const cur = isObj(state.placement) ? state.placement : {};
  const mp = T.readers.massingPlacement();
  const baseZ = num(cur.baseZ, mp ? mp.baseZ : 0);
  const pick = order.find(fits);
  if (!pick) {
    C.ui.Toast.show('No open area for the deck on the site. Move it by hand.', { kind: 'warn', ms: 7000 });
    return { x: 0, y: 0, rotation: 0, baseZ, baseMode: baseMode(state), side: null };
  }
  return { x: rnd(pick.cx - ox, 100), y: rnd(pick.cy - oy, 100), rotation: 0, baseZ, baseMode: baseMode(state), side: pick.side };
}
/** Puts a deck that is about to start as standalone beside the massing. Returns true when it moved. */
function placeStart(next) {
  const p = startPlacement(next);
  if (!p) return false;
  const { side, ...pl } = p;
  next.placement = pl;
  T.startSide = side;
  return true;
}

function setSource(k) {
  const s = S();
  if (k === 'podium') {
    if (!T.readers.has()) { C.ui.Toast.show('Open a project first (Project menu). A podium comes from the massing in the open project.', { kind: 'warn', ms: 6000 }); return false; }
    if (isLinked(s) && T.started) return false;
    const run = T.readers.parkingRun();
    if (!run.length) {
      const anyPodium = T.readers.sources().some((x) => x.source === 'podium');
      C.ui.Toast.show(anyPodium ? 'The podium has no parking floors. Set the podium program to Parking in the Tower.' : 'The massing has no podium levels.', { kind: 'warn', ms: 6000 });
      return false;
    }
    T.store.replace(linkedState(s));
    C.ui.Toast.show(`Podium parking: ${run.length} level${run.length === 1 ? '' : 's'} from the massing program.`);
    return true;
  }
  if (k === 'standalone') {
    if (s.source === 'standalone' && T.started) return false;
    const next = deepClone(s);
    next.source = 'standalone';
    next.linked = false;
    next.sourceLevel = null;
    if (T.started) placeStart(next);                      // a deck not started yet is placed by its first write (onStore)
    T.store.replace(fillDefaults(next));
    return true;
  }
  if (k === s.source && T.started) return false;
  if (!T.readers.has()) { C.ui.Toast.show('Open a project first (Project menu). A wrap deck comes from the massing in the open project.', { kind: 'warn', ms: 6000 }); return false; }
  return applySource(k);
}
function setSourceLevel(v) {
  const src = T.readers.sources().find((x) => x.source === S().source);
  if (!src) return false;
  const at = src.levels.findIndex((l) => String(l.index) === String(v));
  if (at < 0) return false;
  const sub = src.levels.slice(at);
  const next = deepClone(S());
  next.sourceLevel = src.levels[at].index;
  next.levels.count = Math.min(CONFIG.limits.maxLevels, sub.length);
  next.levels.ftf1 = sub[0].ftf;
  next.levels.ftf = sub[1] ? sub[1].ftf : sub[0].ftf;
  T.store.replace(fillDefaults(next));
  return true;
}
function applyPreset(id) {
  const p = CONFIG.presets.find((x) => x.id === id);
  if (!p) return false;
  const next = fillDefaults(deepClone(p.state));
  next.source = 'standalone';
  next.sourceLevel = null;
  next.placement = S().placement;
  next.view = deepClone(S().view);
  T.store.replace(fillDefaults(next));
  return true;
}

/* ---------- cores and entries ---------- */
const coreIndex = (id) => (S().cores || []).findIndex((c) => c.id === id);
const entryIndex = (id) => (S().entries || []).findIndex((e) => e.id === id);
const coreOf = (id) => D().cores.find((c) => c.id === id) || null;
function moveCoreToRowAt(i, quietly) {
  const c = S().cores[i];
  if (!c) return false;
  let r = null;
  try { r = LayoutMod.moveCoreToRow(c, D().raw); } catch (e) { r = null; }
  if (!r) { if (!quietly) C.ui.Toast.show('No stall row to move the core into.', { kind: 'warn' }); return false; }
  const next = deepClone(S().cores);
  next[i] = { ...next[i], x: r.x, y: r.y };
  T.store.set('cores', next, { live: false });
  if (!quietly) C.ui.Toast.show(`${c.id} moved into row ${r.rowId}.`);
  return true;
}
function moveCoreById(id) { const i = coreIndex(id); return i >= 0 ? moveCoreToRowAt(i) : false; }
function moveAllCoresToRows() {
  const issues = D().coreIssues;
  const next = deepClone(S().cores);
  let n = 0;
  next.forEach((c, i) => {
    if (issues[c.id] !== 'aisle') return;
    let r = null;
    try { r = LayoutMod.moveCoreToRow(c, D().raw); } catch (e) { r = null; }
    if (r) { next[i] = { ...c, x: r.x, y: r.y }; n++; }
  });
  if (!n) { C.ui.Toast.show('No core sits in a drive aisle.'); return 0; }
  T.store.set('cores', next, { live: false });
  C.ui.Toast.show(`Moved ${n} core${n === 1 ? '' : 's'} into stall rows.`);
  return n;
}
function makeCoresEditable() {
  const list = D().cores.map((c) => ({ id: c.id, kind: c.kind, x: rnd(c.x, 100), y: rnd(c.y, 100), w: rnd(c.w, 100), d: rnd(c.d, 100) }));
  const next = deepClone(S());
  next.cores = list.slice(0, CONFIG.limits.maxCores);
  next.coresFromProject = false;
  T.store.replace(fillDefaults(next));
  return list.length;
}
function useSuggestion() {
  const sg = D().overlay.suggestion;
  if (!sg) return false;
  T.store.set('bays.stallW', sg.stallW, { live: false });
  return true;
}
function deleteItem(it) {
  if (!it) return false;
  const next = deepClone(S());
  if (it.kind === 'core') {
    const c = coreOf(it.id);
    if (c && c.fromProject) { C.ui.Toast.show('This core comes from the project. Make the cores editable first.', { kind: 'warn', ms: 4200 }); return false; }
    if (coreIndex(it.id) < 0) return false;
    next.cores = next.cores.filter((x) => x.id !== it.id);
  } else if (it.kind === 'entry') {
    if (entryIndex(it.id) < 0) return false;
    next.entries = next.entries.filter((x) => x.id !== it.id);
  } else return false;
  T.store.replace(next);
  C.select(null);
  return true;
}

/* ---------- reading and writing the project ---------- */
function loadFromProject() {
  const sec = T.readers.sectionOf(SECTION);
  const mine = sec && sec.tool === SECTION && isObj(sec.state) && Object.keys(sec.state).length;
  const mp = T.readers.massingPlacement();
  let link = false;
  quiet++;
  try {
    let next;
    if (mine) next = fillDefaults({ ...sec.state, placement: isObj(sec.placement) ? sec.placement : (mp || ZERO_PLACEMENT()) });
    else { next = fillDefaults(defaultState()); next.placement = mp || ZERO_PLACEMENT(); }
    next.view.level = 0;                                   // the isolated level is an edit aid of one visit
    // No parking section and parking floors in the podium program, or a linked deck: the deck follows the program.
    if (mine ? isLinked(next) : T.readers.parkingRun().length > 0) {
      const l = linkedState(next);
      if (!mine || linkFields(l) !== linkFields(next)) link = true;
      next = l;
    }
    T.store.replace(next, { undoable: false });
  } finally { quiet--; }
  T.derived.reset();
  T.started = !!mine || link;                              // nothing draws until the project has a deck
  T.startSide = null;
  const moved = followGround({ merge: true, force: true });
  pendingWrite = !!((mine && moved) || link);
  pendingNote = link ? LINK_NOTE : null;
  return !!mine;
}

function readOnly() { try { return !!(C.project.isReadOnly && C.project.isReadOnly(SECTION)); } catch (e) { return false; } }

/** Writes once after a load that moved the base to the grading FFE, or linked the deck to the podium program. */
function flushPendingWrite() {
  if (!pendingWrite) return;
  pendingWrite = false;
  const note = pendingNote;
  pendingNote = null;
  if (!quiet && !readOnly() && C.project.doc() && (T.readers.sectionOf(SECTION) || note)) writeSection({ note });
}

/** The `parking` section patch for the design on screen (docs/project-file-spec.md section 6.4). */
function sectionPatch(note) {
  const st = T.store.snapshot();
  const d = D();
  const derived = parkingDerived(st, d.built, d.metrics);
  const so = screenOpenness(screenLevels(), st.screen, { slab: CONFIG.slabThickness });
  const r1 = (v) => Math.round(v * 10) / 10;
  derived.screen = { type: st.screen.type, openness: st.screen.openness, wallArea: r1(so.wallArea), openArea: r1(so.openArea), percent: r1(so.percent) };
  const pl = { ...placementOf(), baseMode: baseMode() };
  if (pinned()) pl.pinned = true;
  return { tool: SECTION, schema: CONFIG.projectSchema, placement: pl, state: { ...st, placement: pl }, derived, note: note || st.name };
}
/**
 * The deck levels for the screens, in the layout frame: { z, ftf, plate }. The top level of a standalone deck is an
 * open roof (no screen). A podium or wrap deck has the massing level above its top level, so one more entry (that
 * level's z, the top plate) gives the top parking floor its screen too. `only`: one level index (the isolated level).
 */
function screenLevels(only = 0) {
  const d = D(), s = S();
  const lv = (d.levels || []).map((l) => ({ index: l.index, z: l.z, ftf: l.ftf, plate: l.plate }));
  if (lv.length && s.source !== 'standalone') {
    const top = lv[lv.length - 1];
    const above = T.readers.massingZAbove(top.z);
    if (above != null) lv.push({ index: top.index + 1, z: above, plate: top.plate });
  }
  if (!only) return lv;
  const at = lv.findIndex((l) => l.index === only);
  return at < 0 ? [] : lv.slice(at, at + 2);
}
/** JSON with sorted keys, so two equal values compare equal whatever their key order. */
function stable(v) {
  return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
}
/** True when the saved section already holds this patch (tool, schema, placement, state, derived). */
function sameAsSaved(patch) {
  const cur = T.readers.sectionOf(SECTION);
  if (!cur || cur.tool !== SECTION) return false;
  const pick = (x) => ({ tool: x.tool, schema: x.schema, placement: x.placement, state: x.state, derived: x.derived });   // the note goes to the log only
  return stable(pick(cur)) === stable(pick(patch));
}
/** Writes the section. Safe to call often: the project store debounces the save, and an unchanged section is not rewritten. */
function writeSection({ note } = {}) {
  if (quiet) return false;
  if (readOnly()) {
    if (!readOnlyShown) { readOnlyShown = true; C.ui.Toast.show(READ_ONLY_TEXT, { kind: 'warn', ms: 9000 }); }
    return false;
  }
  let patch;
  try { patch = sectionPatch(note); } catch (e) {
    console.error(e);
    C.ui.Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), { kind: 'error', ms: 8000 });
    return false;
  }
  if (sameAsSaved(patch)) { T.started = true; return true; }
  try { C.project.write(SECTION, patch); } catch (e) {
    console.error(e);
    C.ui.Toast.show(`The project could not be updated. ${e && e.message ? e.message : ''}`.trim(), { kind: 'error', ms: 8000 });
    return false;
  }
  T.started = true;
  return true;
}

/* ---------- sync ---------- */
function syncLayers() {
  try { C.layers.sync(C); } catch (e) { console.error(e); }
  try { C.scene.requestRender(); } catch (e) { /* no scene */ }
}
function onStore(state, info) {
  const live = !!(info && info.live);
  if (!live && !quiet) {
    const kind = info && info.kind;
    // The first edit of a project with no deck starts a standalone deck beside the massing (one merged step).
    if (!T.started && kind !== 'undo' && kind !== 'redo' && S().source === 'standalone') {
      const next = deepClone(S());
      if (placeStart(next)) { quiet++; try { T.store.set('placement', next.placement, { merge: true }); } finally { quiet--; } }
    }
    if (kind !== 'undo' && kind !== 'redo') followGround({ merge: true });
    writeSection();
  }
  try { T.CT.refreshAll(); } catch (e) { console.error(e); }
  if (handles) handles.sync();
  syncLayers();
  if (gizmo) gizmo.sync();
  if (!live) { try { C.refreshHud(); } catch (e) { /* hud not ready */ } }
}

/* ---------- items for the selection card and the handles ---------- */
function ringOfBox(b) { return [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]; }
function zRange(kind) {
  const d = D(), lv = d.levels;
  if (!lv.length) return { z0: 0, z1: 0 };
  if (kind === 'entry') { const e = lv.find((l) => l.index === d.raw.entryLevel) || lv[0]; return { z0: e.z, z1: e.z + e.ftf }; }
  const last = lv[lv.length - 1];
  return { z0: lv[0].z, z1: last.z + last.ftf };
}
/** The item object a tap selects. outer / z0 / z1 are in the project frame, which draws the selection outline. */
function itemFor(kind, id) {
  const d = D(), s = S(), pl = placementOf(s), h = d.hud;
  const base = num(pl.baseZ, 0);
  const lvl = zRange(kind);
  const out = (ring) => ring.map((p) => layoutToProject(p, pl));
  if (kind === 'core') {
    const c = coreOf(id);
    if (!c) return null;
    const iss = d.coreIssues[id];
    return {
      id: `parking:core:${id}`, kind, pid: id, owner: 'parking', title: `${c.kind === 'elevator' ? 'Elevator' : 'Stair'} ${id}`,
      rows: [['Size', `${ft(c.w)} by ${ft(c.d)}`], ['Position', `${ft(c.x)}, ${ft(c.y)}`], ['Source', c.fromProject ? 'The project' : 'This design'], ...(iss ? [['Issue', iss === 'aisle' ? 'In a drive aisle' : 'Outside the deck']] : [])],
      outer: out(ringOfBox(c.box)), z0: base + lvl.z0, z1: base + lvl.z1,
    };
  }
  if (kind === 'entry') {
    const en = s.entries[entryIndex(id)];
    if (!en) return null;
    const lane = D().frame && D().frame.W ? entryLaneRing(en) : null;
    return {
      id: `parking:entry:${id}`, kind, pid: id, owner: 'parking', title: `Entry ${id}`,
      rows: [['Side', en.side], ['Center along the side', ft(en.at)], ['Lane width', ft(en.width)]],
      outer: lane ? out(lane) : null, z0: base + lvl.z0, z1: base + lvl.z1,
    };
  }
  if (kind === 'speed') {
    const fp = RampsMod.speedRampFootprint(s);
    if (!fp) return null;
    return {
      id: 'parking:speed', kind, pid: 'speed', owner: 'parking', title: 'Speed ramp',
      rows: [['Shape', s.ramp.speed.shape === 'circular' ? 'Circular' : 'Straight'], ['Width', ft(s.ramp.speed.width)], ['Length', ft(s.ramp.speed.length)]],
      outer: out(ringOfBox({ minX: fp.box[0], minY: fp.box[1], maxX: fp.box[2], maxY: fp.box[3] })), z0: base + lvl.z0, z1: base + lvl.z1,
    };
  }
  // the whole deck (footprint of a standalone deck)
  const lv0 = d.levels[0];
  const plate = lv0 && lv0.plate && lv0.plate[0] ? lv0.plate.slice().sort((a, b) => Math.abs(boxArea(b.outer)) - Math.abs(boxArea(a.outer)))[0].outer : null;
  const standalone = s.source === 'standalone';
  return {
    id: 'parking:deck', kind: standalone ? 'footprint' : 'deck', pid: 'footprint', owner: 'parking', title: SOURCE_LABELS[s.source] || 'Parking deck',
    rows: [
      ['Stalls', Units.formatInt(h.stalls)], ['Levels', `${h.levels}${h.topOfDeck ? `, ${ft(h.topOfDeck)} high` : ''}`],
      ['Sf per stall', h.sfPerStall >= 100 ? Units.formatInt(Math.round(h.sfPerStall)) : Units.formatRatio(h.sfPerStall, 1)],
      ['Ramp', s.ramp.type === 'none' ? 'None' : `${RAMP_LABELS[s.ramp.type]}, max ${pct1(h.maxSlope)}`],
    ],
    outer: plate ? plate.map((p) => layoutToProject(p, pl)) : null, z0: base + lvl.z0, z1: base + lvl.z1,
  };
}
function boxArea(ring) { const b = boxOfRings([ring]); return b ? (b.maxX - b.minX) * (b.maxY - b.minY) : 0; }
function entryLaneRing(en) {
  const f = D().frame, p = num(S().footprint.perimeter, 1);
  const len = Math.max(num(S().bays.turnZone, num(S().bays.aisle, 24)), 24);
  const w = num(en.width, 24), at = num(en.at, 0);
  switch (en.side) {
    case 'east': return [[f.W - p - len, at - w / 2], [f.W, at - w / 2], [f.W, at + w / 2], [f.W - p - len, at + w / 2]];
    case 'south': return [[at - w / 2, 0], [at + w / 2, 0], [at + w / 2, p + len], [at - w / 2, p + len]];
    case 'north': return [[at - w / 2, f.D - p - len], [at + w / 2, f.D - p - len], [at + w / 2, f.D], [at - w / 2, f.D]];
    default: return [[0, at - w / 2], [p + len, at - w / 2], [p + len, at + w / 2], [0, at + w / 2]];
  }
}

/* ---------- layers ---------- */
const proxyMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

/** The state without the placement and the name, which move the layers but never rebuild them. Cached per store version. */
let drawKeyAt = -1, drawKeyVal = '';
function drawStateKey() {
  const v = T.store.version();
  if (v !== drawKeyAt) {
    const { placement, name, ...rest } = S();
    drawKeyAt = v; drawKeyVal = JSON.stringify(rest);
  }
  return drawKeyVal;
}
/** A draft is drawn only while a gesture changes the geometry. A placement drag moves the group and keeps the full model. */
let settledKey = '';
function isDraft() {
  if (!T.store.gestureActive()) { settledKey = drawStateKey(); return false; }
  return drawStateKey() !== settledKey;
}
const viewKey = () => { try { return C.view && C.view.key ? C.view.key() : ''; } catch (e) { return ''; } };
/** True when the project has a deck to draw: a saved parking section, or a deck linked to the podium program. Never a default deck. */
const hasDeck = () => !!T.started;
function layerKey(lctx, extra = '') {
  const sh = lctx.shift || { x: 0, y: 0, z: 0 };
  return [lctx.doc ? lctx.doc.id : '-', drawStateKey(), isDraft() ? 'd' : 'f', lctx.style, viewKey(), active ? 'a' : 'b', hasDeck() ? 1 : 0, `${sh.x},${sh.y},${sh.z}`, T.readers.dataKey(), tick, extra].join('|');
}
/** A placement drag, or a new base elevation, moves the built group instead of rebuilding it. */
function replace(id) {
  return () => { const o = C && C.layers.get(id); if (o) C.frame.placeGroup(o, placementOf()); };
}
function newRoot(name, D0) {
  const layout = new THREE.Group();
  layout.name = `${name}-layout`;
  layout.matrixAutoUpdate = false;
  layout.matrix.copy(D0.matrix);
  layout.matrixWorldNeedsUpdate = true;
  const root = new THREE.Group();
  root.name = name;
  root.add(layout);
  return { root, layout };
}
/** Meshes that are not picks of their own must not block a tap on what is behind them. */
function setPicks(layout) {
  layout.traverse((o) => {
    if (!o.isMesh) return;
    const key = o.userData.key || '';
    if (key === 'slab' || key === 'slab-diagram' || key === 'column' || key === 'column-bad' || key === 'barrier') o.userData.pick = () => itemFor('deck');
    else if (key.startsWith('core')) o.userData.pick = () => null;           // the proxy of the core answers
    else if (!o.userData.pick) o.userData.occludes = false;
  });
}
function addProxies(layout, d, s) {
  const add = (geo, item) => {
    const m = new THREE.Mesh(geo, proxyMat);
    m.userData.proxy = true;
    m.userData.pick = () => itemFor(item.kind, item.id);
    layout.add(m);
  };
  const r = zRange('deck');
  for (const c of d.cores) add(boxGeo(c.box.minX, c.box.minY, c.box.maxX, c.box.maxY, r.z0 - 1, r.z1 + 1), { kind: 'core', id: c.id });
  const e = zRange('entry');
  for (const en of s.entries || []) {
    const ring = entryLaneRing(en);
    const b = boxOfRings([ring]);
    if (b) add(boxGeo(b.minX, b.minY, b.maxX, b.maxY, e.z0 - 0.5, e.z0 + 6), { kind: 'entry', id: en.id });
  }
  if (s.ramp.type === 'speed') {
    const fp = RampsMod.speedRampFootprint(s);
    if (fp) add(boxGeo(fp.box[0], fp.box[1], fp.box[2], fp.box[3], r.z0 - 1, r.z1), { kind: 'speed', id: 'speed' });
  }
}
/** Hands the cached materials back before the layer is disposed (the cache lives as long as the tool). */
function releaseMaterials(obj) {
  obj.traverse((o) => {
    if (o.userData && o.userData.screen && o.material) { o.material.dispose(); o.material = undefined; return; }   // the screen texture is shared
    if (o.userData && o.userData.ownMat && o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
    if (o.material) o.material = undefined;
  });
}

function buildDeck(lctx) {
  const s = S(), d = D();
  if (!hasDeck() || !d.ok || !d.levels.length) return null;
  const draft = isDraft();
  const { root, layout } = newRoot('parking-deck', d);
  for (const o of buildModel(d, s, T.derived.display(draft), mats, lctx.style, { active })) layout.add(o);
  setPicks(layout);
  /* the facade screen: same group, every tool state */
  try {
    const only = active && s.view.level > 0 ? s.view.level : 0;
    const sg = buildScreens(screenLevels(only), s.screen, { slab: CONFIG.slabThickness, css });
    if (sg) { sg.traverse((o) => { if (o.isMesh) { o.raycast = () => {}; o.userData.occludes = false; } }); layout.add(sg); }
  } catch (e) { console.error(e); }
  addProxies(layout, d, s);
  C.frame.placeGroup(root, placementOf(s));
  root.userData.count = d.hud.stalls;
  return root;
}
function buildOverlayLayer(lctx) {
  const s = S(), d = D();
  if (!active || !hasDeck() || !d.ok || !d.levels.length) return null;   // entry arrows, slope labels, core ids: edit aids
  const draft = isDraft();
  const { root, layout } = newRoot('parking-overlay', d);
  const textOk = lctx.style === 'diagram' || C.scene.isPlan();
  for (const o of buildOverlay(d, s, T.derived.display(draft), mats)) {
    if (o.userData.plan && !textOk) { if (o.material && o.userData.ownMat) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); continue; }
    o.userData.occludes = false;
    layout.add(o);
  }
  if (!layout.children.length) return null;
  C.frame.placeGroup(root, placementOf(s));
  root.userData.count = layout.children.length;
  return root;
}
/** AI-ready: a white deck with dark lines and no color fills or labels. Repaints in place. */
function aiReadyDeck(obj, on) {
  obj.traverse((o) => {
    const key = o.userData && o.userData.key;
    if (o.isMesh && key) {
      if (on) {
        if (o.userData.matWas === undefined) o.userData.matWas = o.material;
        if (key.startsWith('kind:') || key.startsWith('slope:') || key === 'aisle' || key === 'turn') o.visible = false;
        else o.material = mats.mesh(key === 'column' || key === 'column-bad' || key.startsWith('core') ? 'ai-structure' : 'ai-white');
      } else if (o.userData.matWas !== undefined) {
        o.material = o.userData.matWas; delete o.userData.matWas; o.visible = true;
      }
    } else if (o.isLineSegments) {
      if (on) {
        if (o.userData.matWas === undefined) o.userData.matWas = o.material;
        o.material = mats.line(o.userData.stallLines ? 'ai-stall' : 'ai-edge');
      } else if (o.userData.matWas !== undefined) { o.material = o.userData.matWas; delete o.userData.matWas; }
    }
  });
}

/* ---------- metrics, warnings ---------- */
function metricRows() {
  const d = D();
  if (!hasDeck() || !d.ok || !d.levels.length) return [];
  const m = d.hud, s = S();
  const kindRows = Object.entries(m.byKind || {}).filter(([, n]) => n > 0)
    .map(([k, n]) => ({ label: `${CONFIG.kindLabels[k] || k} stalls`, value: Units.formatInt(n) }));
  const acc = m.accessible;
  const rows = [
    { label: 'Stalls', value: Units.formatInt(m.stalls) },
    ...kindRows,
    { label: 'Sf per stall', value: m.sfPerStall >= 100 ? Units.formatInt(Math.round(m.sfPerStall)) : Units.formatRatio(m.sfPerStall, 1), hint: 'Gross deck area divided by stalls' },
    { label: 'Levels', value: Units.formatInt(m.levels), hint: m.topOfDeck ? `${ft(m.topOfDeck)} high` : '' },
    { label: 'Max ramp slope', value: pct1(m.maxSlope), hint: s.ramp.type === 'none' ? 'No ramp' : RAMP_LABELS[s.ramp.type] },
    { label: 'Efficiency', value: pct1(m.efficiency), hint: 'Stall area share of the deck' },
    { label: 'Gross deck area', value: Units.formatArea(m.gross) },
    { label: 'Accessible', value: `${Units.formatInt(acc.provided)} of ${Units.formatInt(acc.required)}`, hint: `${acc.van} van` },
    { label: 'Parking balance', value: `${m.balance > 0 ? '+' : ''}${Units.formatInt(m.balance)}`, hint: `Needs ${Units.formatInt(m.required)}` },
    { label: 'Lowest clear height', value: m.lowestClear ? ft(m.lowestClear) : '-' },
    { label: 'Column conflicts', value: m.columns.source === 'none' ? 'No overlay source' : Units.formatInt(m.conflicts) },
    { label: 'EV installed / ready', value: `${Units.formatInt(m.ev.installed)} / ${Units.formatInt(m.ev.ready)}` },
  ];
  if (s.screen && s.screen.type !== 'open') {
    const so = screenOpenness(screenLevels(), s.screen, { slab: CONFIG.slabThickness });
    rows.push({ label: 'Screen openness', value: `${Math.round(so.percent)}% open`, hint: `${s.screen.type === 'solid' ? 'Solid' : 'Mesh'} screen, ${Units.formatArea(so.openArea)} open of ${Units.formatArea(so.wallArea)}` });
  }
  return rows;
}
function warningRows() {
  const d = D();
  const s = S();
  if (!hasDeck()) return [];
  const out = [];
  if (s.source === 'standalone' && T.readers.parkingRun().length) out.push({ text: 'The podium has parking floors. Choose Podium in Source to model them as a deck.', level: 'warn' });
  if (!d.levels.length) return out;
  out.push(...d.warnings.map((w) => ({ text: w.text, level: w.level === 'error' ? 'error' : w.level === 'info' ? 'info' : 'warn' })));
  const sg = d.overlay && d.overlay.suggestion;
  if (sg) out.push({ text: `Units are ${ft(d.overlay.unitWidth)} wide. A stall width of ${ft(sg.stallW)} lines the columns up and gives ${sg.stallsPerRow} stalls per row.`, level: 'info' });
  return out;
}

/* ---------- files ---------- */
const slug = (name) => String(name || 'deck').trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'deck';
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function fileFor(kind) {
  const s = S(), d = D();
  if (kind === 'sketchup') {
    const doc = parkingToSketchup(s, d.built, d.metrics, { name: s.name });
    const v = validateDoc(doc);
    if (!v.ok) throw new Error('The SketchUp file did not pass its own check.');
    if (!v.counts.solid && !v.counts.mesh) throw new Error('Nothing to export yet: the design has no levels.');
    return { name: sketchupFilename(s.name), blob: docToBlob(doc), doc, counts: v.counts };
  }
  if (kind === 'dxf') {
    const text = parkingDxf(s, d.built, { ramps: d.ramps, columnPoints: d.columns.points, clearHeights: d.clear });
    return { name: `${slug(s.name)}-${stamp()}.dxf`, text, blob: new Blob([text], { type: 'application/dxf' }) };
  }
  const text = stallCsv(s, d.built);
  return { name: `${slug(s.name)}-${stamp()}-stalls.csv`, text, blob: new Blob([text], { type: 'text/csv' }) };
}
async function download(kind) {
  let f;
  try { f = fileFor(kind); } catch (e) {
    console.error(e);
    C.ui.Toast.show(`The ${kind === 'sketchup' ? 'SketchUp' : kind.toUpperCase()} file could not be made. ${e && e.message ? e.message : ''}`.trim(), { kind: 'error', ms: 6000 });
    return null;
  }
  try {
    const res = await deliverImage(f.blob, f.name);
    if (res === 'downloaded') C.ui.Toast.show(kind === 'sketchup' ? `Saved ${f.name}. In SketchUp: Extensions > CMRLM > Import Design Tools file.` : `Saved ${f.name}`);
  } catch (e) { console.error(e); C.ui.Toast.show('The file could not be saved.', { kind: 'error' }); }
  return f.name;
}

/* ---------- level isolate ---------- */
function nextLevel(all) {
  const n = D().levels.length || S().levels.count;
  const cur = S().view.level;
  T.store.set('view.level', all ? 0 : (cur >= n ? 1 : cur + 1), { live: false });
}

/* ---------- the tool ---------- */
export default {
  id: 'parking',
  section: 'parking',
  label: 'Parking Deck',
  icon: 'parking',
  order: 30,
  dock: true,

  async init(ctx) {
    C = ctx;
    try {
      if (!document.getElementById('parking-tool-css')) {
        const link = document.createElement('link');
        link.id = 'parking-tool-css'; link.rel = 'stylesheet'; link.href = new URL('./tool.css', import.meta.url).href;
        document.head.append(link);
      }
    } catch (e) { /* the panels still work */ }
    T.ctx = ctx;
    T.store = ctx.store(fillDefaults(defaultState()));
    this.store = T.store;
    T.readers = createReaders(ctx);
    T.derived = createDerived({ store: T.store, readers: T.readers });
    T.CT = ctx.ui.Controls.create();
    mats = createMats({ style: () => ctx.scene.style() });
    Object.assign(T, {
      S, D, placementOf, baseMode, pinned, setBaseMode, baseLineText, setSource, setSourceLevel, applyPreset, applySource,
      moveCoreToRowAt, moveCoreById, moveAllCoresToRows, makeCoresEditable, useSuggestion, deleteItem, coreOf, coreIndex, entryIndex,
      layoutToLocal, localToLayout, localToProject, projectToLocal, layoutToProject, footprintRing, itemFor, entryLaneRing, zRange,
      nextLevel, metricRows, warningRows, fileFor, download, writeSection, loadFromProject, syncLayers, started: false,
      isLinked: () => isLinked(), hasDeck: () => hasDeck(),
      isActive: () => active, quiet: () => quiet > 0, Units, RampsMod,
    });
    quiet++;
    try { loadFromProject(); } finally { quiet--; }
    T.store.subscribe(onStore);
    handles = createHandles(T);
    T.handles = handles;
    gizmo = createPlacementGizmo({
      scene: ctx.scene, input: ctx.input, ground: ctx.ground,
      get: () => ({ ...placementOf(), baseMode: baseMode(), pinned: pinned() }),
      set: (p, o = {}) => {
        const cur = isObj(S().placement) ? S().placement : {};
        const next = { ...cur, x: p.x, y: p.y, rotation: p.rotation, baseZ: p.baseZ, baseMode: baseMode() };
        if (p.pinned === true) next.pinned = true; else delete next.pinned;
        T.store.set('placement', next, { live: true });
        if (!o.live) T.store.commit();
      },
      bounds: () => footprintRing(),
      pickables: () => { const o = ctx.layers.get('parking-deck'); const out = []; if (o) o.traverse((m) => { if (m.isMesh && !m.userData.proxy && m.userData.key) out.push(m); }); return out; },
      enabled: () => active && hasDeck() && S().source === 'standalone' && !handles.hasSelection(),
    });
    T.gizmo = gizmo;
    gizmo.setEnabled(false);
    offs.push(ctx.bus.on('selection', (e) => handles.onSelection(e)));
    offs.push(ctx.scene.onView(() => { syncLayers(); handles.sync(); }));
    ctx.keys.bind(SECTION, 'l', () => nextLevel(false));
    ctx.keys.bind(SECTION, 'shift+l', () => nextLevel(true));
    ctx.keys.bind(SECTION, 'Delete', () => handles.deleteSelected() || false);
    ctx.keys.bind(SECTION, 'Backspace', () => handles.deleteSelected() || false);
    try {
      const app = (window.__app = window.__app || {});
      app.tools = app.tools || {};
      app.tools.parking = {
        store: T.store, state: () => S(), derived: () => D(), placement: () => placementOf(), readers: T.readers,
        setSource, setSourceLevel, applyPreset, applySource, moveAllCoresToRows, makeCoresEditable, deleteItem, itemFor,
        patch: () => sectionPatch(), write: () => writeSection(),
        files: { sketchup: () => fileFor('sketchup'), dxf: () => fileFor('dxf'), csv: () => fileFor('csv') },
        metrics: () => metricRows(), warnings: () => warningRows(),
        handles, gizmo, mats: () => mats,
        followGround: () => followGround({ merge: true }),
        relink: () => relink(), startPlacement: () => startPlacement(S()), screenLevels: (o) => screenLevels(o || 0),
        hasDeck: () => hasDeck(), linked: () => isLinked(), isActive: () => active,
      };
    } catch (e) { /* tests only */ }
    flushPendingWrite();
    syncLayers();
  },

  activate() {
    active = true;
    handles.setOn(true);
    if (gizmo) gizmo.setEnabled(true);
    T.derived.reset();
    onStore(S(), { live: true });
  },
  deactivate() {
    active = false;
    try { C.input.cancel(); } catch (e) { /* none running */ }
    handles.setOn(false);
    if (gizmo) gizmo.setEnabled(false);
    if (S().view.level) { quiet++; try { T.store.set('view.level', 0); } finally { quiet--; } }   // the isolated level is an edit aid
    syncLayers();
  },

  panels(ctx) { return buildPanels(T, ctx); },

  layers(ctx) {
    return [
      {
        id: 'parking-deck', label: 'Parking deck', order: 30, defaultOn: true, replaces: ['parking'],
        key: (l) => layerKey(l, `${S().view.level}|${S().view.overlay}`),
        always: replace('parking-deck'),
        build: buildDeck, dispose: releaseMaterials, aiReady: aiReadyDeck,
      },
      {
        id: 'parking-overlay', label: 'Parking overlay', order: 30.2, defaultOn: true,
        key: (l) => layerKey(l, `${S().view.level}|${S().view.overlay}|${C.scene.isPlan()}`),
        always: replace('parking-overlay'),
        build: buildOverlayLayer, dispose: releaseMaterials, aiReady: (obj, on) => { obj.visible = !on; },
      },
    ];
  },

  metrics() { return metricRows(); },
  warnings() { return warningRows(); },

  onProject(evt) {
    if (!evt || !T.store) return;
    if (evt.source === 'open') {
      readOnlyShown = false;
      loadFromProject();
      flushPendingWrite();
    } else {
      const keys = evt.keys || [];
      if (keys.includes(SECTION) && evt.tool !== SECTION) {
        if (!T.store.gestureActive()) loadFromProject();
      } else if (keys.some((k) => k === 'massing' || k === 'plates' || k === 'site' || k === 'grading')) {
        T.derived.reset();
        const relinked = keys.includes('massing') && relink();   // a linked deck follows the parking floors of the program
        followGround({ merge: true, force: true });          // the deck follows a new grading FFE or ground
        if (T.started && !relinked) writeSection();          // the derived block follows the massing and the plates; an unchanged section is skipped
      }
    }
    try { T.CT.refreshAll(); } catch (e) { console.error(e); }
    handles.sync();
    syncLayers();
    if (gizmo) gizmo.sync();
  },

  exports() {
    return [
      { id: 'parking-sketchup', label: 'SketchUp (.json)', run: () => download('sketchup') },
      { id: 'parking-dxf', label: 'DXF (.dxf)', run: () => download('dxf') },
      { id: 'parking-csv', label: 'Stall list (.csv)', run: () => download('csv') },
    ];
  },

  card(item) {
    if (!item || item.owner !== 'parking') return [];
    const out = [];
    if (item.kind === 'core') {
      const c = coreOf(item.pid);
      if (c && c.fromProject) out.push({ label: 'Make the cores editable', action: () => { makeCoresEditable(); C.select(null); } });
      else if (c) {
        if (D().coreIssues[item.pid] === 'aisle') out.push({ label: 'Move to the nearest row', action: () => moveCoreById(item.pid) });
        out.push({ label: 'Delete', action: () => deleteItem({ kind: 'core', id: item.pid }) });
      }
    } else if (item.kind === 'entry') {
      out.push({ label: 'Delete', action: () => deleteItem({ kind: 'entry', id: item.pid }) });
    }
    return out;
  },

  onTap() { return false; },

  store: null,
};
