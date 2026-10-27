/* ==========================================================================
   GRADING TOOL: edit
   Drawing, snapping, picking and editing of the plan items (port of build/grading/06b_select.js to the shell).
   Draw: tap points on the plan; tap the last point again (or Enter, or Finish) to end; Escape or Cancel stops. A lot, a
     property line and a footprint close themselves when the first point is tapped again.
     A pen or a mouse click places a point (a DRAW claim, ctx.input.claim at PRIORITY.DRAW). A finger tap places a point too,
     through the tool's onTap; a finger drag still orbits (in the Plan view it pans).
   Snap: corners and ends first, then edges, then the 1 ft grid. Alt skips snapping.
   Edit: the selected item shows its outline, a square at each vertex and a dot at each edge midpoint. A press on a handle
     (a PRIORITY.HANDLES claim) drags it live; a midpoint dot adds a vertex when dragged. One undo step per drag.
   The selection itself lives in the shell (ctx.select); the editor only mirrors it (setSelected).
   Everything drawn here is DOM and SVG in #handles, so it never shows in a captured image.
   ========================================================================== */
import { PRIORITY } from '../../core/input.js';
import { CONFIG, clamp, rnd, deepClone, nearestOnSeg, pointInRing } from './model.js';

const SVGNS = 'http://www.w3.org/2000/svg';

/** What each kind of plan item is. */
export const KINDS = {
  drive: { word: 'drive', min: 2, closed: false, list: 'drives', prefix: 'D', limit: () => CONFIG.limits.maxFeatures },
  lot: { word: 'lot', min: 3, closed: true, list: 'lots', prefix: 'L', limit: () => CONFIG.limits.maxFeatures },
  wall: { word: 'wall', min: 2, closed: false, list: 'walls', prefix: 'W', limit: () => CONFIG.limits.maxFeatures * 2 },
  route: { word: 'route', min: 2, closed: false, list: 'routes', prefix: 'R', limit: () => CONFIG.limits.maxFeatures },
  property: { word: 'property line', min: 3, closed: true },
  building: { word: 'building footprint', min: 3, closed: true },
};
const nextId = (arr, prefix) => { let n = 1; while (arr.some((x) => x.id === `${prefix}${n}`)) n++; return `${prefix}${n}`; };
const indexOf = (list, id) => (list || []).findIndex((x) => x.id === id);
const distToLine = (x, y, pts, closed) => {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) best = Math.min(best, nearestOnSeg(x, y, pts[i], pts[(i + 1) % n]).d);
  return best;
};

/**
 * env: { ctx, store, getD(), groundMesh() -> Mesh|null, selectItem(gsel) (puts the item in the shell selection), deselect(),
 *        notify(text, kind), openItem(gsel) }
 */
export function createEditor(env) {
  const { ctx, store, getD } = env;
  const { scene, input, frame } = ctx;
  const THREE = ctx.THREE;
  const norm = (list) => list.map((p) => [rnd(p[0]), rnd(p[1])]);

  let enabled = false;
  let sel = null;                       // { kind, id } mirrored from the shell selection
  let draw = null;                      // { kind, pts, target, replace }
  let hover = null;                     // { x, y } snapped hover point while drawing
  let drag = null;                      // an open handle drag
  let handles = { v: [], m: [] };       // handle list of the selection: { i, x, y, z }
  let outline = [];                     // draped polyline of the selection, [[x, y, z], ...]
  let offs = [];
  let raf = 0, pendingEv = null;

  /* ---------------------------------------------------------------- geometry of an item */
  /** -> { pts, closed, path (null when read only), index } or null. */
  function geomOf(it) {
    if (!it) return null;
    const s = store.raw(), D = getD();
    if (it.kind === 'drive') { const i = indexOf(s.drives, it.id); return i < 0 ? null : { pts: s.drives[i].line, closed: false, path: `drives.${i}.line`, index: i }; }
    if (it.kind === 'lot') { const i = indexOf(s.lots, it.id); return i < 0 ? null : { pts: s.lots[i].ring, closed: true, path: `lots.${i}.ring`, index: i }; }
    if (it.kind === 'route') { const i = indexOf(s.routes, it.id); return i < 0 ? null : { pts: s.routes[i].line, closed: false, path: `routes.${i}.line`, index: i }; }
    if (it.kind === 'wall') {
      const i = indexOf(s.walls, it.id);
      if (i >= 0) return { pts: s.walls[i].line, closed: false, path: `walls.${i}.line`, index: i };
      const w = D && D.built.walls.find((x) => x.id === it.id);
      return w ? { pts: w.line, closed: false, path: null, index: -1, auto: w.kind } : null;
    }
    if (it.kind === 'building') {
      const i = s.buildings.findIndex((b) => (b.source === 'typed' ? b.id : b.source) === it.id);
      if (i >= 0 && s.buildings[i].source === 'typed') return { pts: s.buildings[i].outer, closed: true, path: `buildings.${i}.outer`, index: i };
      const b = D && D.built.buildings.find((x) => x.id === it.id);
      return b && b.outer && b.outer.length ? { pts: b.outer, closed: true, path: null, index: i } : null;
    }
    if (it.kind === 'property') return s.property.mode === 'drawn' && s.property.ring.length >= 3 ? { pts: s.property.ring, closed: true, path: 'property.ring', index: 0 } : null;
    return null;
  }
  const isValid = (it) => !!it && !!KINDS[it.kind] && !!geomOf(it);

  /* ---------------------------------------------------------------- scene helpers */
  const shift = () => frame.getShift();
  const groundAt = (x, y) => { const D = getD(); if (!D || !D.ok) return 0; try { const z = D.built.surface.at(x, y); return Number.isFinite(z) ? z : 0; } catch (e) { return 0; } };
  const world = (x, y, z) => { const sh = shift(); return new THREE.Vector3(x - sh.x, z - sh.z, -(y - sh.y)); };
  const screenOf = (x, y, z) => { const p = scene.toScreen(world(x, y, z == null ? groundAt(x, y) : z)); return { x: p.x, y: p.y, visible: p.visible }; };
  /** The plan point (project frame) under a screen point: a hit on the proposed ground, else the plane through the work. */
  function planAt(cx, cy) {
    const sh = shift();
    let rc = null;
    try { rc = scene.rayFrom(cx, cy); } catch (e) { rc = null; }
    if (!rc) return null;
    const mesh = env.groundMesh();
    if (mesh) {
      let hit = null;
      try { hit = rc.intersectObject(mesh, false)[0]; } catch (e) { hit = null; }
      if (hit) return [hit.point.x + sh.x, -hit.point.z + sh.y];
    }
    const D = getD();
    const zs = D ? (D.zMin + D.zMax) / 2 - sh.z : 0;
    const p = scene.groundPoint(cx, cy, zs);
    return p ? [p[0] + sh.x, p[1] + sh.y] : null;
  }
  /** Screen pixels per foot of plan, near a plan point. */
  function pxPerFt(x, y) {
    const z = groundAt(x, y);
    const a = screenOf(x, y, z), b = screenOf(x + 10, y, z), c = screenOf(x, y + 10, z);
    return Math.max(0.05, Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y)) / 10);
  }

  /* ---------------------------------------------------------------- snapping */
  const ringsOfTiers = () => { const D = getD(); return D ? D.built.tiers.flatMap((t) => (t.pads || []).concat(t.outers || [])) : []; };
  /** Snap targets in order: corners and ends, then edges, then the 1 ft grid. `ignore` is an item whose own points do not attract. */
  function snapPoint(p, { skip = false, extra = [], ignore = null } = {}) {
    const x = p[0], y = p[1];
    if (skip) return { x, y, kind: 'free' };
    const tol = clamp(12 / pxPerFt(x, y), 0.4, 60);
    const s = store.raw(), D = getD();
    const same = (kind, id) => !!ignore && ignore.kind === kind && ignore.id === id;
    const corners = [...(extra || [])], edges = [];
    for (const ring of ringsOfTiers()) { corners.push(...ring); edges.push(ring); }
    for (const dv of s.drives) if (!same('drive', dv.id) && dv.line.length) corners.push(dv.line[0], dv.line[dv.line.length - 1]);
    for (const b of s.buildings) if (b.source === 'typed' && !same('building', b.id)) { corners.push(...b.outer); edges.push(b.outer); }
    const prop = D ? D.built.property : null;
    if (prop && prop.length >= 3 && s.property.mode === 'drawn' && !same('property', 'property')) { corners.push(...prop); edges.push(prop); }
    for (const l of s.lots) if (!same('lot', l.id)) corners.push(...l.ring);
    for (const w of s.walls) if (!same('wall', w.id)) corners.push(...w.line);
    let best = null;
    for (const c of corners) { const dd = Math.hypot(c[0] - x, c[1] - y); if (dd <= tol && (!best || dd < best.d)) best = { x: c[0], y: c[1], d: dd, kind: 'corner' }; }
    if (best) return best;
    for (const ring of edges) for (let i = 0; i < ring.length; i++) {
      const q = nearestOnSeg(x, y, ring[i], ring[(i + 1) % ring.length]);
      if (q.d <= tol && (!best || q.d < best.d)) best = { x: q.x, y: q.y, d: q.d, kind: 'edge' };
    }
    if (best) return best;
    return { x: Math.round(x), y: Math.round(y), kind: 'grid' };
  }
  const snapAt = (cx, cy, alt, extra, ignore) => { const p = planAt(cx, cy); return p ? snapPoint(p, { skip: !!alt, extra, ignore }) : null; };

  /* ---------------------------------------------------------------- finding the item under a point */
  function pickAt(cx, cy) {
    const p = planAt(cx, cy), D = getD();
    if (!p || !D || !D.ok) return null;
    const x = p[0], y = p[1], s = store.raw();
    const thr = 14 / pxPerFt(x, y);
    const near = (list, get) => {
      let best = null;
      for (const o of list) { const dd = get(o); if (dd <= thr && (!best || dd < best.d)) best = { o, d: dd }; }
      return best;
    };
    const route = near(s.routes, (r) => distToLine(x, y, r.line, false));
    if (route) return { kind: 'route', id: route.o.id };
    const wall = near(D.built.walls, (w) => distToLine(x, y, w.line, false));
    if (wall) return { kind: 'wall', id: wall.o.id };
    const drive = D.built.features.filter((f) => f.kind === 'drive').find((f) => f.contains(x, y));
    if (drive) return { kind: 'drive', id: drive.id };
    const lot = D.built.features.filter((f) => f.kind === 'lot').find((f) => f.contains(x, y));
    if (lot) return { kind: 'lot', id: lot.id };
    for (const t of D.built.tiers) {
      const rings = (t.outers && t.outers.length ? t.outers : [t.outer]).concat(t.pads || []);
      if (rings.some((r) => r && r.length >= 3 && pointInRing(x, y, r))) return { kind: 'building', id: t.building };
    }
    if (s.property.mode === 'drawn' && s.property.ring.length >= 3 && distToLine(x, y, s.property.ring, true) <= thr) return { kind: 'property', id: 'property' };
    return null;
  }

  /* ---------------------------------------------------------------- the DOM layer */
  let layer = null, svg = null, haloEl = null, lineEl = null, prevEl = null, bar = null, barText = null, barFinish = null;
  const vDots = [], mDots = [], dDots = [];
  const mkPath = (cls) => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('class', cls); p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); return p; };
  function buildLayer() {
    if (typeof document === 'undefined' || layer) return;
    const host = document.getElementById('handles');
    if (!host) return;
    layer = document.createElement('div');
    layer.className = 'grading-layer';
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    layer.hidden = true;
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'grading-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none');
    haloEl = mkPath('grading-halo'); lineEl = mkPath('grading-line'); prevEl = mkPath('grading-preview');
    svg.append(haloEl, lineEl, prevEl);
    layer.append(svg);
    host.append(layer);
    bar = document.createElement('div');
    bar.className = 'grading-drawbar';
    bar.setAttribute('role', 'status');
    bar.hidden = true;
    barText = document.createElement('span');
    barText.className = 'grading-draw-text';
    barFinish = document.createElement('button');
    barFinish.type = 'button'; barFinish.className = 'btn outline sm'; barFinish.textContent = 'Finish';
    barFinish.addEventListener('click', () => finishDraw());
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn outline sm'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => cancelDraw());
    bar.append(barText, barFinish, cancel);
    host.append(bar);
  }
  function dot(pool, cls) {
    const el = document.createElement('div');
    el.className = cls;
    el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;display:none';
    layer.append(el);
    pool.push(el);
    return el;
  }
  function useDots(pool, n, cls) {
    while (pool.length < n) dot(pool, cls);
    for (let i = 0; i < pool.length; i++) pool[i].style.display = i < n ? '' : 'none';
  }
  const pathOf = (pts3, o) => {
    let d = '', pen = false;
    for (const p of pts3) {
      const s = screenOf(p[0], p[1], p[2]);
      if (!s.visible) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${(s.x - o.left).toFixed(1)} ${(s.y - o.top).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  /** Positions the outline, the handles and the drawing preview for the current camera. Called every frame. */
  function sync() {
    if (!layer) return;
    const show = enabled && (draw || (sel && outline.length) || hover);
    layer.hidden = !show;
    if (!show) return;
    const o = layer.getBoundingClientRect();
    const showSel = !draw && sel && outline.length;
    const d = showSel ? pathOf(outline, o) : '';
    haloEl.setAttribute('d', d); lineEl.setAttribute('d', d);
    useDots(vDots, showSel ? handles.v.length : 0, 'hdl vertex grading-v');
    useDots(mDots, showSel ? handles.m.length : 0, 'hdl grading-m');
    if (showSel) {
      handles.v.forEach((h, i) => place(vDots[i], h, o));
      handles.m.forEach((h, i) => place(mDots[i], h, o));
    }
    if (draw) {
      const pts = draw.pts.concat(hover ? [[hover.x, hover.y]] : []);
      const closed = KINDS[draw.kind].closed && pts.length >= 3;
      prevEl.setAttribute('d', pts.length >= 2 ? pathOf(drape(pts, closed, 6, 1), o) : '');
      useDots(dDots, draw.pts.length, 'hdl vertex grading-d');
      draw.pts.forEach((p, i) => place(dDots[i], { x: p[0], y: p[1], z: groundAt(p[0], p[1]) + 1 }, o));
    } else {
      prevEl.setAttribute('d', '');
      useDots(dDots, 0, 'hdl vertex grading-d');
    }
  }
  function place(el, h, o) {
    if (!el) return;
    const s = screenOf(h.x, h.y, h.z);
    if (!s.visible) { el.style.visibility = 'hidden'; return; }
    el.style.visibility = '';
    el.style.transform = `translate(${(s.x - o.left).toFixed(1)}px, ${(s.y - o.top).toFixed(1)}px)`;
  }
  /** A polyline sampled every `step` ft and lifted onto the proposed ground: [[x, y, z], ...]. */
  function drape(pts, closed, step, lift) {
    const out = [], n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / step));
      for (let q = i === 0 ? 0 : 1; q <= k; q++) {
        const f = q / k, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        out.push([x, y, groundAt(x, y) + lift]);
      }
    }
    return out;
  }
  /** Rebuilds the cached outline and handle list of the selection (after a change of the selection or the model). */
  function refresh() {
    handles = { v: [], m: [] }; outline = [];
    if (sel && !isValid(sel)) { sel = null; try { env.deselect(); } catch (e) { /* ignore */ } }
    const g = enabled && !draw && sel ? geomOf(sel) : null;
    if (g) {
      const pts = g.pts, n = pts.length;
      outline = drape(pts, g.closed, 6, 0.9);
      if (g.path) {
        handles.v = pts.map((p, i) => ({ i, x: p[0], y: p[1], z: groundAt(p[0], p[1]) + 0.9 }));
        for (let i = 0; i < (g.closed ? n : n - 1); i++) {
          const a = pts[i], b = pts[(i + 1) % n], x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
          handles.m.push({ i, x, y, z: groundAt(x, y) + 0.9 });
        }
      }
    }
    sync();
    scene.requestRender();
  }

  /* ---------------------------------------------------------------- drawing */
  function syncBar() {
    if (!bar) return;
    bar.hidden = !draw;
    if (!draw) return;
    const k = KINDS[draw.kind], n = draw.pts.length;
    barText.textContent = n < 1 ? `Draw a ${k.word}: tap the first point in the view.`
      : `Drawing a ${k.word}: ${n} point${n === 1 ? '' : 's'}. Tap the last point again or use Finish.`;
    barFinish.disabled = n < k.min;
  }
  function startDraw(kind, opts = {}) {
    const k = KINDS[kind];
    if (!k || !enabled) return false;
    if (k.list) {
      const cur = store.get(k.list) || [];
      if (cur.length >= k.limit()) { env.notify(`The limit is ${k.limit()} ${k.word}s. Delete one first.`, 'warn'); return false; }
    }
    if (drag) input.cancel();
    try { env.deselect(); } catch (e) { /* ignore */ }
    sel = null;
    draw = { kind, pts: [], target: opts.target == null ? null : opts.target, replace: null };
    hover = null;
    try { if (!scene.isPlan()) scene.setView('plan'); } catch (e) { /* no scene */ }
    try { canvasEl().classList.add('grading-drawing'); } catch (e) { /* no canvas */ }
    syncBar(); refresh();
    return true;
  }
  const canvasEl = () => scene.canvas();
  function endDraw() {
    draw = null; hover = null;
    syncBar();
    try { canvasEl().classList.remove('grading-drawing'); } catch (e) { /* no canvas */ }
    refresh();
  }
  function cancelDraw() { if (!draw) return false; endDraw(); return true; }
  function drawPointAt(cx, cy, alt) {
    if (!draw) return false;
    const s = snapAt(cx, cy, alt, draw.pts);
    if (!s) return false;
    const k = KINDS[draw.kind];
    const last = draw.pts[draw.pts.length - 1];
    const tol = clamp(14 / pxPerFt(s.x, s.y), 0.5, 80);
    if (last && Math.hypot(last[0] - s.x, last[1] - s.y) <= tol) {            // the last point again: finish
      if (draw.pts.length >= k.min) { finishDraw(); return true; }
      return false;
    }
    const first = draw.pts[0];
    if (k.closed && draw.pts.length >= k.min && first && Math.hypot(first[0] - s.x, first[1] - s.y) <= tol) { finishDraw(); return true; }
    draw.pts.push([s.x, s.y]);
    hover = null;
    syncBar(); sync(); scene.requestRender();
    return true;
  }
  /** Adds a drawn point from a program (tests, the keyboard). */
  function drawPoint(x, y) {
    if (!draw) return false;
    draw.pts.push([x, y]);
    syncBar(); sync(); scene.requestRender();
    return true;
  }
  /** Commits the drawing as ONE undo step. Returns the new item or null. */
  function finishDraw() {
    if (!draw) return null;
    const k = KINDS[draw.kind], pts = norm(draw.pts);
    if (pts.length < k.min) { env.notify(`A ${k.word} needs at least ${k.min} points.`, 'warn'); return null; }
    const { kind, target, replace } = draw;
    endDraw();
    const s = store.raw();
    let item = null;
    if (replace) {                                                   // Redraw: the item keeps its settings, only the points change
      const i = indexOf(s[replace.list], replace.id);
      if (i >= 0) {
        store.set(`${replace.list}.${i}.${kind === 'lot' ? 'ring' : 'line'}`, pts, { live: false });
        item = { kind, id: replace.id };
      }
    } else if (kind === 'drive') {
      const id = nextId(s.drives, 'D');
      store.set('drives', [...s.drives, { id, line: pts, width: 24, start: 'existing', slope: 5, cross: 2, crown: true }], { live: false }); item = { kind, id };
    } else if (kind === 'lot') {
      const id = nextId(s.lots, 'L');
      store.set('lots', [...s.lots, { id, ring: pts, anchor: null, start: 'existing', dir: 0, slope: 2, cross: 1 }], { live: false }); item = { kind, id };
    } else if (kind === 'wall') {
      const id = nextId(s.walls, 'W');
      store.set('walls', [...s.walls, { id, line: pts, kind: 'drawn' }], { live: false }); item = { kind, id };
    } else if (kind === 'route') {
      const id = nextId(s.routes, 'R');
      store.set('routes', [...s.routes, { id, line: pts, name: `Route ${s.routes.length + 1}` }], { live: false }); item = { kind, id };
    } else if (kind === 'property') {
      store.set('property', { mode: 'drawn', ring: pts }, { live: false }); item = { kind, id: 'property' };
    } else if (kind === 'building') {
      const i = target == null ? 0 : target;
      const b = s.buildings[i];
      if (b) { store.set(`buildings.${i}`, { ...deepClone(b), source: 'typed', outer: pts }, { live: false }); item = { kind, id: b.source === 'typed' ? b.id : b.id }; }
    }
    if (item) { try { env.selectItem(item); } catch (e) { console.error(e); } }
    return item;
  }
  function redraw(it) {
    const g = geomOf(it);
    if (!g || !g.path) return false;
    if (['drive', 'lot', 'wall', 'route'].includes(it.kind)) {
      if (!startDraw(it.kind)) return false;
      draw.replace = { list: KINDS[it.kind].list, id: it.id };
      return true;
    }
    return startDraw(it.kind, { target: it.kind === 'building' ? g.index : null });
  }

  /* ---------------------------------------------------------------- deleting */
  function deleteItem(it) {
    if (!it) return false;
    const s = store.raw();
    const drop = (list) => { const i = indexOf(s[list], it.id); if (i < 0) return false; store.set(list, s[list].filter((_, k) => k !== i), { live: false }); return true; };
    let done = false;
    if (it.kind === 'drive') done = drop('drives');
    else if (it.kind === 'lot') done = drop('lots');
    else if (it.kind === 'route') done = drop('routes');
    else if (it.kind === 'wall') {
      done = drop('walls');
      if (!done) env.notify('Pad-step and automatic walls follow the design. Turn the automatic walls off in the Walls panel to remove them.', 'warn');
    } else if (it.kind === 'property') { store.set('property', { mode: 'site', ring: [] }, { live: false }); done = true; }
    else if (it.kind === 'building') {
      if (s.buildings.length <= 1) { env.notify('A design needs at least one building.', 'warn'); return false; }
      const i = s.buildings.findIndex((b) => (b.source === 'typed' ? b.id : b.source) === it.id);
      if (i >= 0) { store.set('buildings', s.buildings.filter((_, k) => k !== i), { live: false }); done = true; }
    }
    if (done) { sel = null; try { env.deselect(); } catch (e) { /* ignore */ } refresh(); }
    return done;
  }
  const deleteSelected = () => (sel ? deleteItem(sel) : false);

  /* ---------------------------------------------------------------- handle drags (PRIORITY.HANDLES) */
  function handleHit(ev) {
    if (!enabled || draw || !sel || !handles.v.length) return null;
    const rad = input.hitPx('handle') / 2;
    let best = null;
    const test = (list, type) => list.forEach((h) => {
      const s = screenOf(h.x, h.y, h.z);
      if (!s.visible) return;
      const dd = Math.hypot(s.x - ev.clientX, s.y - ev.clientY);
      if (dd <= rad && (!best || dd < best.d - 0.5 || (type === 'v' && best.type === 'm' && dd <= best.d + 4))) best = { type, i: h.i, d: dd };
    });
    test(handles.m, 'm'); test(handles.v, 'v');
    return best;
  }
  function applyDrag(ev) {
    if (!drag) return;
    const s = snapAt(ev.clientX, ev.clientY, ev.altKey, null, drag.item);
    if (!s) return;
    const cur = store.get(drag.path);
    if (!Array.isArray(cur)) return;
    const pts = cur.map((p) => [p[0], p[1]]);
    if (drag.type === 'm' && !drag.started) {                         // a midpoint dot becomes a new vertex after its edge's start
      pts.splice(drag.index + 1, 0, [rnd(s.x), rnd(s.y)]);
      drag.index += 1; drag.type = 'v';
    } else if (drag.index < pts.length) pts[drag.index] = [rnd(s.x), rnd(s.y)];
    drag.started = true;
    store.set(drag.path, pts, { live: true });
  }
  function flushDrag() {
    raf = 0;
    const ev = pendingEv; pendingEv = null;
    if (ev) applyDrag(ev);
  }
  let pendHit = null;
  const handleClaim = {
    test(ev) {
      const hit = handleHit(ev);
      if (!hit) return false;
      const g = geomOf(sel);
      if (!g || !g.path) return false;
      pendHit = { hit, g };
      return true;
    },
    down() {
      const { hit, g } = pendHit;
      drag = { path: g.path, item: { ...sel }, index: hit.i, type: hit.type, started: false, base: deepClone(store.get(g.path)), closed: g.closed };
    },
    move(ev) {
      if (!drag) return;
      pendingEv = { clientX: ev.clientX, clientY: ev.clientY, altKey: ev.altKey };
      if (!raf) raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(flushDrag) : (flushDrag(), 0);
    },
    up(ev) {
      if (!drag) return undefined;
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0; pendingEv = null;
      if (ev) applyDrag(ev);
      const was = drag.started;
      drag = null;
      if (was) store.commit();
      return undefined;
    },
    cancel() {
      if (!drag) return;
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = 0; pendingEv = null;
      const d = drag; drag = null;
      if (d.started) { store.set(d.path, d.base, { live: true }); store.commit(); }
    },
  };

  /* ---------------------------------------------------------------- drawing input (PRIORITY.DRAW) */
  const drawClaim = {
    // A pen or a mouse places a point where it is released. A finger never gets here: a finger drag orbits (pans in the Plan view)
    // and a finger tap reaches the tool's onTap, which calls drawTap.
    pointerTypes: ['pen', 'mouse', 'touch'],
    test(ev) { return enabled && !!draw && ev.pointerType !== 'touch'; },
    down(ev) { const s = snapAt(ev.clientX, ev.clientY, ev.altKey, draw ? draw.pts : null); hover = s ? { x: s.x, y: s.y } : null; sync(); scene.requestRender(); },
    move(ev) { if (!draw) return; const s = snapAt(ev.clientX, ev.clientY, ev.altKey, draw.pts); hover = s ? { x: s.x, y: s.y } : null; sync(); scene.requestRender(); },
    up(ev) { drawPointAt(ev.clientX, ev.clientY, ev.altKey); return undefined; },
    cancel() { hover = null; sync(); },
  };
  /** A tap while drawing (a finger, or any pointer the claim did not take). */
  function drawTap(ev) { return drawPointAt(ev.clientX, ev.clientY, !!ev.altKey); }
  /** A mouse moving over the view while drawing previews the next point. */
  function onHover(ev) {
    if (!enabled || !draw || ev.pointerType !== 'mouse' || ev.buttons) return;
    if (ev.target !== canvasEl()) return;
    const s = snapAt(ev.clientX, ev.clientY, ev.altKey, draw.pts);
    hover = s ? { x: s.x, y: s.y } : null;
    sync(); scene.requestRender();
  }
  function onKeyCapture(ev) {
    if (!enabled || !draw || ev.key !== 'Escape') return;
    cancelDraw();
    ev.preventDefault();
    ev.stopPropagation();
  }

  /* ---------------------------------------------------------------- selection and wiring */
  function setSelected(g) {
    const next = g && g.kind && g.id != null ? { kind: g.kind, id: g.id } : null;
    if (draw && next) return;
    sel = next && isValid(next) ? next : null;
    refresh();
  }
  /** Shows an item: Plan view, selected, its panel row open. */
  function showItem(it) {
    if (!it) return;
    try { if (!scene.isPlan()) scene.setView('plan'); } catch (e) { /* no scene */ }
    try { env.selectItem(it); } catch (e) { console.error(e); }
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    buildLayer();
    offs.push(input.claim(handleClaim, PRIORITY.HANDLES));
    offs.push(input.claim(drawClaim, PRIORITY.DRAW));
    if (typeof scene.onFrame === 'function') offs.push(scene.onFrame(sync));
    window.addEventListener('pointermove', onHover);
    window.addEventListener('keydown', onKeyCapture, true);
    offs.push(() => { window.removeEventListener('pointermove', onHover); window.removeEventListener('keydown', onKeyCapture, true); });
    refresh();
  }
  function disable() {
    if (!enabled) return;
    if (drag) input.cancel();
    if (draw) endDraw();
    enabled = false;
    offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    offs = [];
    sel = null; handles = { v: [], m: [] }; outline = [];
    if (layer) layer.hidden = true;
    if (bar) bar.hidden = true;
    scene.requestRender();
  }
  function dispose() {
    disable();
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    layer = bar = null;
  }

  return {
    enable, disable, dispose, refresh, sync,
    setSelected, selected: () => (sel ? { ...sel } : null), showItem,
    pickAt, planAt, snapPoint, geomOf, screenOf,
    startDraw, cancelDraw, finishDraw, drawPoint, drawTap, drawing: () => (draw ? { kind: draw.kind, points: draw.pts.length } : null),
    redraw, deleteItem, deleteSelected,
    handleList: () => ({ vertices: handles.v.length, midpoints: handles.m.length }),
    handleScreen: (type, i) => { const list = type === 'm' ? handles.m : handles.v; const h = list.find((x) => x.i === i); return h ? screenOf(h.x, h.y, h.z) : null; },
  };
}
