/* ==========================================================================
   CORE: layers (app/CONTRACT.md section 9)
   The layer registry of the shell. Every drawn thing in the 3D view is a layer: a def with a key and a build function.
   sync(ctx) asks each visible layer for its key and rebuilds only the layers whose key changed (render on demand).
   A layer def may hide others while it is registered (def.replaces), so a live tool layer replaces its derived twin.

   buildMerged() is the Model Viewer pattern (build/viewer/04_render.js): one merged BufferGeometry per group, a color per
   vertex, and a table of vertex ranges, so a tap maps a face index back to its item. Items are in the PROJECT frame; the
   geometry is drawn in the shifted scene (project point minus frame.getShift()).

   Extensions beyond the contract (all optional):
   - def.always(ctx, { on, replaced }) runs on every sync, also for a layer that is off or replaced (derived.js uses it for
     the grading ground override).
   - The ctx that key, build and always get is the caller's ctx plus { doc, style, cut: { key, z } | null, shift, aiReady, layers }.
   - pick() returns { layerId, owner, item, point, world }: point is the project plan point [x, y, z], world the Three point.
   - bounds(ids) -> THREE.Box3 | null: world box of the built, visible layers in ids.
   - get(id) -> the built object or null; info() for tests.
   - A mesh's userData.pick(faceIndex, hit) gets the raycast hit as a second argument.
   - The 'ground:change' bus event (core/ground.js) re-runs the last sync.
   ========================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planMatrix, getShift, worldToPlan } from './frame.js';
import { levelsIndex } from '../../src/viewer/scene.js';

const STORE_KEY = 'cmrlm.app.layers';
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const ZERO = { x: 0, y: 0, z: 0 };

function readPrefs() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}
function writePrefs(p) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* private mode */ }
}

/** Frees the geometry and the materials of a built object and its children. Safe to call twice. */
export function disposeObject(obj) {
  if (!obj) return;
  const mats = new Set();
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.isInstancedMesh && typeof o.dispose === 'function') o.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x && mats.add(x)); else if (m) mats.add(m);
  });
  mats.forEach((m) => { try { m.dispose(); } catch (e) { /* ignore */ } });
  if (obj.parent) obj.parent.remove(obj);
}

/* ---------- merged geometry ---------- */

/** Geometry of one item in scene coordinates, non-indexed, with position and normal only. null when the item has no shape. */
export function itemGeometry(it, sh = ZERO) {
  let g = null;
  if (it.kind === 'ramp' && Array.isArray(it.outer3) && it.outer3.length >= 3) {
    const pts = it.outer3.map((p) => new THREE.Vector2(p[0] - sh.x, p[1] - sh.y));
    const tri = THREE.ShapeUtils.triangulateShape(pts, []);
    if (!tri.length) return null;
    const pos = [];
    for (const t of tri) {
      const ccw = (pts[t[1]].x - pts[t[0]].x) * (pts[t[2]].y - pts[t[0]].y) - (pts[t[1]].y - pts[t[0]].y) * (pts[t[2]].x - pts[t[0]].x) > 0;
      const order = ccw ? t : [t[0], t[2], t[1]];
      for (const i of order) { const p = it.outer3[i]; pos.push(p[0] - sh.x, p[2] - sh.z, -(p[1] - sh.y)); }
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }
  if (!Array.isArray(it.outer) || it.outer.length < 3 || !fin(it.z0)) return null;
  const shape = new THREE.Shape(it.outer.map((p) => new THREE.Vector2(p[0] - sh.x, p[1] - sh.y)));
  for (const hole of it.holes || []) if (Array.isArray(hole) && hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p[0] - sh.x, p[1] - sh.y))));
  const depth = (fin(it.z1) ? it.z1 : it.z0) - it.z0;
  if (depth > 0.001) g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 4 });
  else g = new THREE.ShapeGeometry(shape);
  g.applyMatrix4(planMatrix(it.z0 - sh.z));
  if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
  g.clearGroups();
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/** Binary search of the vertex ranges. */
function itemAt(rs, vertex) {
  let lo = 0, hi = rs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, r = rs[mid];
    if (vertex < r.start) hi = mid - 1; else if (vertex >= r.start + r.count) lo = mid + 1; else return r.item;
  }
  return null;
}

const toColor = (c, out) => (c && c.isColor ? out.copy(c) : out.set(c || '#9aa3ad'));

/**
 * One merged mesh of the solid items (per-vertex color, userData.pick by vertex range) plus its edges, and one LineSegments
 * for the line items (item.kind === 'stall' or item.asLine: the closed ring at z0, or item.line3). Items of kind 'ground' are skipped.
 * opts: { colorOf(item) -> hex | THREE.Color, edges = true, shift = frame.getShift(), material, edgeColor, edgeOpacity = 0.55,
 *         lineColorOf(item), castShadow = true, receiveShadow = true }
 * Returns a THREE.Group with userData { count, ranges, paint(colorOf, lineColorOf) }.
 */
export function buildMerged(items, opts = {}) {
  const o = opts || {};
  const sh = o.shift || getShift();
  const group = new THREE.Group();
  const geoms = [], ranges = [], lineItems = [];
  let start = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.kind === 'ground') continue;
    if (it.kind === 'stall' || it.asLine) { lineItems.push(it); continue; }
    let g = null;
    try { g = itemGeometry(it, sh); } catch (e) { g = null; }
    if (!g) continue;
    const count = g.attributes.position.count;
    if (!count) { g.dispose(); continue; }
    geoms.push(g); ranges.push({ item: it, start, count });
    start += count;
  }
  let mesh = null, lines = null;
  const lineRanges = [];
  if (geoms.length) {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (geoms.length > 1) geoms.forEach((g) => g.dispose());
    if (merged) {
      merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(start * 3), 3));
      const mat = o.material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      mat.vertexColors = true;
      mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = o.castShadow !== false; mesh.receiveShadow = o.receiveShadow !== false;
      mesh.userData.model = true;
      mesh.userData.ranges = ranges;
      mesh.userData.pick = (faceIndex) => (fin(faceIndex) ? itemAt(ranges, faceIndex * 3) : null);
      group.add(mesh);
      if (o.edges !== false) {
        const em = new THREE.LineBasicMaterial({ color: o.edgeColor || '#e7eaee', transparent: true, opacity: fin(o.edgeOpacity) ? o.edgeOpacity : 0.55 });
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 28), em);
        edges.userData.edges = true;
        edges.raycast = () => {};
        group.add(edges);
      }
    }
  }
  if (lineItems.length) {
    const pos = [];
    for (const it of lineItems) {
      const first = pos.length / 3;
      const add = (a, b) => pos.push(a[0] - sh.x, a[2] - sh.z, -(a[1] - sh.y), b[0] - sh.x, b[2] - sh.z, -(b[1] - sh.y));
      if (Array.isArray(it.line3) && it.line3.length >= 2) {
        for (let i = 1; i < it.line3.length; i++) { const a = it.line3[i - 1], b = it.line3[i]; if (a.length >= 3 && b.length >= 3) add(a, b); }
      } else if (Array.isArray(it.outer) && it.outer.length >= 2 && fin(it.z0)) {
        const z = it.z0, r = it.outer;
        for (let i = 0; i < r.length; i++) add([r[i][0], r[i][1], z], [r[(i + 1) % r.length][0], r[(i + 1) % r.length][1], z]);
      }
      const n = pos.length / 3 - first;
      if (n) lineRanges.push({ item: it, start: first, count: n });
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
      lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      lines.userData.lines = true;
      lines.userData.ranges = lineRanges;
      lines.raycast = () => {};
      group.add(lines);
    }
  }
  const c = new THREE.Color();
  function paint(colorOf, lineColorOf) {
    const fn = typeof colorOf === 'function' ? colorOf : () => '#9aa3ad';
    const lf = typeof lineColorOf === 'function' ? lineColorOf : fn;
    for (const [obj, rs, f] of [[mesh, ranges, fn], [lines, lineRanges, lf]]) {
      if (!obj) continue;
      const col = obj.geometry.attributes.color;
      for (const r of rs) {
        let v = null;
        try { v = f(r.item); } catch (e) { v = null; }
        toColor(v, c);
        for (let i = r.start; i < r.start + r.count; i++) col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
  }
  paint(o.colorOf, o.lineColorOf);
  group.userData.ranges = ranges;
  group.userData.lineRanges = lineRanges;
  group.userData.count = ranges.length + lineRanges.length;
  group.userData.paint = paint;
  group.userData.mesh = mesh;
  group.userData.lines = lines;
  return group;
}

/* ---------- the registry ---------- */

export function createLayers({ scene, bus } = {}) {
  const root = scene && scene.layerRoot ? scene.layerRoot : new THREE.Group();
  const entries = new Map();          // id -> { def, on, obj, key, count, replaced }
  const prefs = readPrefs();
  let cutKey = null, aiReady = false, lastCtx = null, syncing = false, pending = false;
  const offs = [];
  const emit = (evt, p) => { try { if (bus) bus.emit(evt, p); } catch (e) { /* ignore */ } };
  const render = () => { try { if (scene && scene.requestRender) scene.requestRender(); } catch (e) { /* ignore */ } };

  function clearObj(e) {
    if (!e.obj) return;
    try { if (e.def.dispose) e.def.dispose(e.obj); } catch (err) { console.error(err); }
    disposeObject(e.obj);
    e.obj = null;
  }

  function register(def) {
    if (!def || typeof def.id !== 'string' || !def.id) return () => {};
    const old = entries.get(def.id);
    if (old) clearObj(old);
    const on = Object.prototype.hasOwnProperty.call(prefs, def.id) ? !!prefs[def.id] : def.defaultOn !== false;
    const e = { def, on, obj: null, key: null, count: old ? old.count : 0, replaced: false };
    entries.set(def.id, e);
    markReplaced();
    emit('layers:change', {});
    return () => {
      if (entries.get(def.id) !== e) return;
      clearObj(e);
      entries.delete(def.id);
      markReplaced();
      emit('layers:change', {});
      render();
    };
  }

  function markReplaced() {
    const hidden = new Set();
    for (const e of entries.values()) for (const r of Array.isArray(e.def.replaces) ? e.def.replaces : []) if (r !== e.def.id) hidden.add(r);
    for (const [id, e] of entries) e.replaced = hidden.has(id);
  }

  const ordered = () => [...entries.values()].sort((a, b) => (fin(a.def.order) ? a.def.order : 999) - (fin(b.def.order) ? b.def.order : 999) || (a.def.id < b.def.id ? -1 : 1));

  function docOf(ctx) {
    try { return ctx && ctx.project && typeof ctx.project.doc === 'function' ? ctx.project.doc() : (ctx && ctx.doc) || null; } catch (e) { return null; }
  }
  function cutOf(doc) {
    if (!cutKey || !doc) return null;
    let lv = null;
    try { lv = levelsIndex(doc).find((l) => l.key === cutKey) || null; } catch (e) { lv = null; }
    return lv ? { key: lv.key, z: lv.z, name: lv.name } : null;
  }
  function layerCtx(ctx) {
    const doc = docOf(ctx);
    let style = 'model';
    try { style = scene && scene.style ? scene.style() : 'model'; } catch (e) { style = 'model'; }
    return { ...(ctx || {}), doc, style, cut: cutOf(doc), shift: getShift(), aiReady, layers: api };
  }

  function sync(ctx) {
    if (ctx) lastCtx = ctx;
    if (syncing) { pending = true; return; }
    syncing = true;
    let changed = false;
    try {
      let rounds = 0;
      do {
        pending = false;
        const lctx = layerCtx(lastCtx);
        const list = ordered();
        for (const e of list) {
          if (typeof e.def.always === 'function') { try { e.def.always(lctx, { on: e.on, replaced: e.replaced }); } catch (err) { console.error(err); } }
        }
        for (const e of list) {
          const visible = e.on && !e.replaced;
          if (!visible) { if (e.obj && e.obj.visible) { e.obj.visible = false; changed = true; } continue; }
          let key = null;
          try { key = String(e.def.key ? e.def.key(lctx) : ''); } catch (err) { console.error(err); key = `error:${Date.now()}`; }
          if (e.obj && key === e.key) { if (!e.obj.visible) { e.obj.visible = true; changed = true; } continue; }
          clearObj(e);
          e.key = key;
          let obj = null;
          try { obj = e.def.build ? e.def.build(lctx) : null; } catch (err) { console.error(err); obj = null; }
          changed = true;
          if (!obj) { e.count = 0; continue; }
          obj.userData.layerId = e.def.id;
          obj.visible = true;
          root.add(obj);
          e.obj = obj;
          try { e.count = e.def.count ? e.def.count(obj) : fin(obj.userData.count) ? obj.userData.count : 1; } catch (err) { e.count = 0; }
          if (aiReady && e.def.aiReady) { try { e.def.aiReady(obj, true); } catch (err) { console.error(err); } }
        }
        rounds++;
      } while (pending && rounds < 4);
    } finally { syncing = false; }
    if (changed) render();
    return changed;
  }

  function invalidate(id) {
    if (id === undefined || id === null) { for (const e of entries.values()) e.key = null; return; }
    const e = entries.get(id);
    if (e) e.key = null;
  }

  function setOn(id, on) {
    const e = entries.get(id);
    const v = !!on;
    prefs[id] = v;
    writePrefs(prefs);
    if (!e || e.on === v) return;
    e.on = v;
    emit('layers:change', {});
    render();
  }
  const isOn = (id) => { const e = entries.get(id); return !!e && e.on && !e.replaced; };

  function list() {
    return ordered().map((e) => ({ id: e.def.id, label: e.def.label || e.def.id, owner: e.def.owner || null, on: e.on, count: e.count || 0, replaced: e.replaced, listed: e.def.listed !== false }));
  }

  function pick(clientX, clientY) {
    if (!scene || typeof scene.rayFrom !== 'function') return null;
    let ray = null;
    try { ray = scene.rayFrom(clientX, clientY); } catch (e) { ray = null; }
    if (!ray) return null;
    const targets = [];
    for (const e of entries.values()) {
      if (!e.obj || !e.obj.visible || !e.on || e.replaced) continue;
      e.obj.traverseVisible((o) => { if (o.isMesh) targets.push(o); });
    }
    if (!targets.length) return null;
    let hits = [];
    try { hits = ray.intersectObjects(targets, false); } catch (e) { hits = []; }
    const sh = getShift();
    for (const hit of hits) {
      const o = hit.object;
      if (!o.userData || typeof o.userData.pick !== 'function') {
        if (o.userData && o.userData.occludes === false) continue;
        return null;                                 // something without data is in front
      }
      let item = null;
      try { item = o.userData.pick(hit.faceIndex, hit); } catch (e) { item = null; }
      if (!item) continue;
      let holder = o;
      while (holder && !(holder.userData && holder.userData.layerId)) holder = holder.parent;
      const layerId = holder ? holder.userData.layerId : null;
      const e = layerId ? entries.get(layerId) : null;
      const p = worldToPlan(hit.point);
      return { layerId, owner: item.owner || (e && e.def.owner) || null, item, point: [p[0] + sh.x, p[1] + sh.y, p[2] + sh.z], world: hit.point.clone() };
    }
    return null;
  }

  function levels(doc) {
    try { return levelsIndex(doc || docOf(lastCtx)).map((l) => ({ key: l.key, z: l.z, name: l.name })); } catch (e) { return []; }
  }
  function setCut(key) {
    const next = key || null;
    if (next === cutKey) return;
    cutKey = next;
    emit('layers:change', {});
    render();
  }
  const cut = () => cutKey;

  function setAiReady(on) {
    const v = !!on;
    if (v === aiReady) return;
    aiReady = v;
    for (const e of entries.values()) {
      if (e.obj && e.def.aiReady) { try { e.def.aiReady(e.obj, v); } catch (err) { console.error(err); } }
    }
    render();
  }

  function bounds(ids) {
    const want = new Set(Array.isArray(ids) ? ids : []);
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    let any = false;
    for (const [id, e] of entries) {
      if (!want.has(id) || !e.obj || !e.on || e.replaced || !e.obj.visible) continue;
      e.obj.updateMatrixWorld(true);
      tmp.makeEmpty();
      e.obj.traverseVisible((o) => {
        if (!o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); if (o.boundingBox) tmp.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); return; }
        if (o.geometry.boundingBox && !o.geometry.boundingBox.isEmpty()) tmp.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      if (tmp.isEmpty() || ![tmp.min.x, tmp.min.y, tmp.min.z, tmp.max.x, tmp.max.y, tmp.max.z].every(fin)) continue;
      box.union(tmp);
      any = true;
    }
    return any ? box : null;
  }

  const get = (id) => { const e = entries.get(id); return e ? e.obj : null; };
  const info = () => ({ cut: cutKey, aiReady, layers: ordered().map((e) => ({ id: e.def.id, on: e.on, replaced: e.replaced, built: !!e.obj, visible: !!(e.obj && e.obj.visible), key: e.key, count: e.count })) });

  if (bus) {
    offs.push(bus.on('frame:shift', () => invalidate()));
    offs.push(bus.on('ground:change', () => { if (lastCtx) sync(); }));
    offs.push(bus.on('project:open', () => { cutKey = null; }));
  }

  function dispose() {
    offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    for (const e of entries.values()) clearObj(e);
    entries.clear();
  }

  const api = { register, sync, invalidate, setOn, isOn, list, pick, levels, setCut, cut, setAiReady, aiReady: () => aiReady, bounds, get, info, dispose };
  return api;
}
