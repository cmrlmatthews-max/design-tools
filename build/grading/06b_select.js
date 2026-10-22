import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/* ==========================================================================
   SELECT and DRAW  (plan section 5.3)
   Draw: tap points in the plan view; tap the last point again (or press Enter) to finish; Escape cancels. A lot and a property line
   close themselves. Snap: 1 ft grid, pad edges and corners, the property line, drive ends; Option (Alt) skips snapping.
   Edit: click a drive, lot, wall, route or building to select it; drag a vertex; drag a midpoint dot to add a vertex; Delete removes it.
   Mac shortcuts: 1 to 6 views (axon, N, E, S, W, plan), D Model / Cut and fill, W draw a wall, R draw a route, Escape clears.

   Selection and the drawing in progress live HERE, never in the Store, so they are never saved, exported or undone. Items are
   { kind: 'drive' | 'lot' | 'wall' | 'route' | 'building' | 'property' | 'section', id }. A tap is a short press that did not move;
   anything longer is an orbit. Drawing, handles and the selection outline go in the Render overlay group (never captured).
   ========================================================================== */
const Select = (() => {
  const $ = (id) => document.getElementById(id);
  const PICK_PX = 6, PICK_MS = 400;
  const D = () => Derived.get();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let items = [], ready = false, draw = null, drag = null, hover = null;
  const listeners = [];
  let group = null, selLines = null, handlePts = null, previewGroup = null, dotTexture = null;

  /* ---- what each kind is -------------------------------------------------------------------------------- */
  const KINDS = {
    drive: { word: 'drive', min: 2, closed: false, list: 'drives', prefix: 'D', limit: () => CONFIG.limits.maxFeatures },
    lot: { word: 'lot', min: 3, closed: true, list: 'lots', prefix: 'L', limit: () => CONFIG.limits.maxFeatures },
    wall: { word: 'wall', min: 2, closed: false, list: 'walls', prefix: 'W', limit: () => CONFIG.limits.maxFeatures * 2 },
    route: { word: 'route', min: 2, closed: false, list: 'routes', prefix: 'R', limit: () => CONFIG.limits.maxFeatures },
    property: { word: 'property line', min: 3, closed: true },
    section: { word: 'section line', min: 2, max: 2, closed: false },
    building: { word: 'building footprint', min: 3, closed: true },
  };
  const nextId = (arr, prefix) => { let n = 1; while (arr.some((x) => x.id === `${prefix}${n}`)) n++; return `${prefix}${n}`; };
  const fmt = (v) => Units.formatFeetInches(v);

  /* ---- geometry of an item -------------------------------------------------------------------------------- */
  const indexOf = (list, id) => (list || []).findIndex((x) => x.id === id);
  /** → { pts, closed, path (null when read only), index, label } or null. */
  function geomOf(it) {
    if (!it) return null;
    const s = Store.raw();
    if (it.kind === 'drive') { const i = indexOf(s.drives, it.id); return i < 0 ? null : { pts: s.drives[i].line, closed: false, path: `drives.${i}.line`, index: i }; }
    if (it.kind === 'lot') { const i = indexOf(s.lots, it.id); return i < 0 ? null : { pts: s.lots[i].ring, closed: true, path: `lots.${i}.ring`, index: i }; }
    if (it.kind === 'route') { const i = indexOf(s.routes, it.id); return i < 0 ? null : { pts: s.routes[i].line, closed: false, path: `routes.${i}.line`, index: i }; }
    if (it.kind === 'wall') {
      const i = indexOf(s.walls, it.id);
      if (i >= 0) return { pts: s.walls[i].line, closed: false, path: `walls.${i}.line`, index: i };
      const w = D().built.walls.find((x) => x.id === it.id);
      return w ? { pts: w.line, closed: false, path: null, index: -1, auto: w.kind } : null;
    }
    if (it.kind === 'building') {
      const i = indexOf(s.buildings, it.id);
      if (i >= 0 && s.buildings[i].source === 'typed') return { pts: s.buildings[i].outer, closed: true, path: `buildings.${i}.outer`, index: i };
      const b = D().built.buildings.find((x) => x.id === it.id);
      return b ? { pts: b.outer, closed: true, path: null, index: i } : null;
    }
    if (it.kind === 'property') return s.property.mode === 'drawn' && s.property.ring.length >= 3 ? { pts: s.property.ring, closed: true, path: 'property.ring', index: 0 } : null;
    if (it.kind === 'section') return s.view.section ? { pts: s.view.section, closed: false, path: 'view.section', index: 0, fixed: true } : null;
    return null;
  }
  const isValid = (it) => !!it && !!KINDS[it.kind] && !!geomOf(it);
  const sameItem = (a, b) => a.kind === b.kind && a.id === b.id;
  const groundAt = (x, y) => { const d = D(); return d.ok ? d.built.surface.at(x, y) : 0; };
  const mapper = () => Ground3D.mapper(D(), Store.raw());

  function setItems(next) {
    const out = [];
    for (const it of next || []) { const n = { kind: it && it.kind, id: it && it.id }; if (isValid(n) && !out.some((o) => sameItem(o, n))) out.push(n); }
    const changed = JSON.stringify(out) !== JSON.stringify(items);
    items = out;
    if (changed) onChanged();
    return changed;
  }
  const clear = () => setItems([]);
  function onChanged() {
    renderCard();
    refreshOverlay();
    listeners.forEach((fn) => { try { fn(items.map((i) => ({ ...i }))); } catch (e) { console.error(e); } });
  }
  function sanitize() {
    const kept = items.filter(isValid);
    if (kept.length !== items.length) { items = kept; onChanged(); return true; }
    return false;
  }

  /* ---- rays and snapping ----------------------------------------------------------------------------------- */
  function canvasRect() { const c = Render.canvas(); return c ? c.getBoundingClientRect() : null; }
  function camera() { const c = Render.camera(); c.updateMatrixWorld(true); return c; }
  function setRay(cx, cy) {
    const rect = canvasRect(), cam = camera();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
  }
  /** The plan point under a screen point (client px): a hit on the ground or a block, else the plane through the work. → [x, y, hitMesh] or null. */
  function planAt(cx, cy) {
    if (!ready) return null;
    setRay(cx, cy);
    const meshes = Render.pickables();
    const hit = meshes.length ? raycaster.intersectObjects(meshes, false)[0] : null;
    if (hit) return [hit.point.x, -hit.point.z, hit.object];
    const d = D(), M = mapper();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -M.Y((d.zMin + d.zMax) / 2));
    const p = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, p) ? [p.x, -p.z, null] : null;
  }
  const toClient = (v3) => {
    const rect = canvasRect(), p = v3.clone().project(camera());
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, z: p.z };
  };
  /** Screen pixels per foot of plan, near a plan point. */
  function pxPerFt(x, y) {
    const M = mapper(), z = groundAt(x, y);
    const a = toClient(M.V(x, y, z)), b = toClient(M.V(x + 10, y, z)), c = toClient(M.V(x, y + 10, z));
    return Math.max(0.05, Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y)) / 10);
  }
  const ringsOfTiers = () => D().built.tiers.flatMap((t) => (t.pads || []).concat(t.outers || []));
  /** Snap targets in order: corners and ends, then edges, then the 1 ft grid. Option (Alt) skips snapping. */
  function snapPoint(p, { skip = false, extra = [] } = {}) {
    extra = extra || [];
    const x = p[0], y = p[1];
    if (skip) return { x, y, kind: 'free' };
    const tol = clamp(12 / pxPerFt(x, y), 0.4, 60);
    const s = Store.raw(), d = D();
    const corners = [...extra];
    const edges = [];
    for (const ring of ringsOfTiers()) { corners.push(...ring); edges.push([ring, true]); }
    for (const dv of s.drives) { if (dv.line.length) { corners.push(dv.line[0], dv.line[dv.line.length - 1]); } }
    for (const b of s.buildings) if (b.source === 'typed') { corners.push(...b.outer); edges.push([b.outer, true]); }
    const prop = d.built.property;
    if (prop && prop.length >= 3 && s.property.mode === 'drawn') { corners.push(...prop); edges.push([prop, true]); }
    for (const l of s.lots) { corners.push(...l.ring); }
    for (const w of s.walls) corners.push(...w.line);
    let best = null;
    for (const c of corners) { const dd = Math.hypot(c[0] - x, c[1] - y); if (dd <= tol && (!best || dd < best.d)) best = { x: c[0], y: c[1], d: dd, kind: 'corner' }; }
    if (best) return best;
    for (const [ring] of edges) for (let i = 0; i < ring.length; i++) {
      const q = nearestOnSeg(x, y, ring[i], ring[(i + 1) % ring.length]);
      if (q.d <= tol && (!best || q.d < best.d)) best = { x: q.x, y: q.y, d: q.d, kind: 'edge' };
    }
    if (best) return best;
    return { x: Math.round(x), y: Math.round(y), kind: 'grid' };
  }
  const snapAt = (cx, cy, alt, extra) => { const p = planAt(cx, cy); return p ? snapPoint(p, { skip: alt, extra }) : null; };

  /* ---- finding the item under a point -------------------------------------------------------------------------- */
  const distToLine = (x, y, pts, closed) => {
    let best = Infinity;
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) best = Math.min(best, nearestOnSeg(x, y, pts[i], pts[(i + 1) % n]).d);
    return best;
  };
  /** The item under a screen point (client px), or null. */
  function pickAt(cx, cy) {
    if (!ready || Render.comparing()) return null;
    const p = planAt(cx, cy);
    if (!p) return null;
    const x = p[0], y = p[1], d = D(), s = Store.raw();
    const thr = 14 / pxPerFt(x, y);
    const near = (list, get) => {
      let best = null;
      for (const o of list) { const dd = get(o); if (dd <= thr && (!best || dd < best.d)) best = { o, d: dd }; }
      return best;
    };
    const route = near(s.routes, (r) => distToLine(x, y, r.line, false));
    if (route) return { kind: 'route', id: route.o.id };
    const wall = near(d.built.walls, (w) => distToLine(x, y, w.line, false));
    if (wall) return { kind: 'wall', id: wall.o.id };
    const drive = d.built.features.filter((f) => f.kind === 'drive').find((f) => f.contains(x, y));
    if (drive) return { kind: 'drive', id: drive.id };
    const lot = d.built.features.filter((f) => f.kind === 'lot').find((f) => f.contains(x, y));
    if (lot) return { kind: 'lot', id: lot.id };
    for (const t of d.built.tiers) {
      const rings = (t.outers && t.outers.length ? t.outers : [t.outer]).concat(t.pads || []);
      if (rings.some((r) => r && r.length >= 3 && pointInRing(x, y, r))) return { kind: 'building', id: t.building };
    }
    if (s.property.mode === 'drawn' && s.property.ring.length >= 3 && distToLine(x, y, s.property.ring, true) <= thr) return { kind: 'property', id: 'property' };
    if (s.view.section && distToLine(x, y, s.view.section, false) <= thr) return { kind: 'section', id: 'section' };
    return null;
  }

  /* ---- overlay objects: selection outline, handles, drawing preview ---------------------------------------------- */
  const cssColorOf = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  function circleTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
    c.lineWidth = 7; c.strokeStyle = '#23508f'; c.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function initOverlay() {
    group = new THREE.Group();
    Render.overlayGroup().add(group);
    previewGroup = new THREE.Group();
    Render.overlayGroup().add(previewGroup);
    dotTexture = circleTexture();
  }
  function clearGroup(g) { for (const o of [...g.children]) { g.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); } }
  const lineAt = (pts, closed, M, lift) => {
    const out = [], n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / 4));
      let prev = null;
      for (let q = 0; q <= k; q++) {
        const f = q / k, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        const w = M.W(x, y, groundAt(x, y) + lift);
        if (prev) out.push(...prev, ...w);
        prev = w;
      }
    }
    return out;
  };
  function fatLine(pos, color, width, opacity, order, dashed = false) {
    if (!pos.length) return null;
    const geo = new LineSegmentsGeometry(); geo.setPositions(pos);
    const mat = new LineMaterial({ color: color.getHex(), linewidth: width, transparent: opacity < 1, opacity, depthTest: false, depthWrite: false, dashed, dashSize: 4, gapSize: 3 });
    const ls = new LineSegments2(geo, mat);
    if (dashed) ls.computeLineDistances();
    ls.renderOrder = order; ls.frustumCulled = false;
    return ls;
  }
  function dots(list, size, color = 0xffffff) {
    if (!list.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const mat = new THREE.PointsMaterial({ size: size * dpr, sizeAttenuation: false, map: dotTexture, transparent: true, alphaTest: 0.2, depthTest: false, depthWrite: false, color });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 15; pts.frustumCulled = false;
    return pts;
  }
  /** The handles of the selected item: vertices, and midpoints of each edge (a midpoint adds a vertex when dragged). */
  function handleList(it) {
    const g = geomOf(it);
    if (!g || !g.path) return { v: [], m: [] };
    const pts = g.pts, n = pts.length;
    const M = mapper();
    const v = pts.map((p, i) => ({ i, x: p[0], y: p[1], w: M.W(p[0], p[1], groundAt(p[0], p[1]) + 0.8) }));
    const m = [];
    if (!g.fixed) for (let i = 0; i < (g.closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n], x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      m.push({ i, x, y, w: M.W(x, y, groundAt(x, y) + 0.8) });
    }
    return { v, m };
  }
  let handles = { v: [], m: [] };
  function refreshOverlay() {
    if (!ready || !group) return;
    clearGroup(group);
    handles = { v: [], m: [] };
    if (Render.comparing() || draw) { Render.requestRender(); return; }
    const it = items[0], g = geomOf(it);
    if (g) {
      const M = mapper();
      const accent = cssColorOf('--accent', '#23508f');
      const halo = cssColorOf('--surface', '#ffffff');
      const pos = lineAt(g.pts, g.closed, M, 0.9);
      const a = fatLine(pos, halo, 5.5, 0.85, 11), b = fatLine(pos, accent, 3, 1, 12);
      if (a) group.add(a); if (b) group.add(b);
      handles = handleList(it);
      const vd = dots(handles.v.map((h) => h.w), 13), md = dots(handles.m.map((h) => h.w), 8, 0xdde6f3);
      if (md) group.add(md); if (vd) group.add(vd);
    }
    Render.requestRender();
  }

  /* ---- drawing -------------------------------------------------------------------------------------------------------- */
  function drawBar() {
    let bar = $('drawBar');
    if (bar) return bar;
    bar = h('div', { class: 'draw-bar', id: 'drawBar', role: 'status', hidden: true },
      h('span', { class: 'draw-text', id: 'drawText' }),
      h('button', { class: 'btn outline sm', type: 'button', id: 'drawFinish', onclick: () => finishDraw() }, 'Finish'),
      h('button', { class: 'btn outline sm', type: 'button', id: 'drawCancel', onclick: () => cancelDraw() }, 'Cancel'));
    $('viewport').append(bar);
    return bar;
  }
  function syncDrawBar() {
    const bar = drawBar();
    bar.hidden = !draw;
    if (!draw) return;
    const k = KINDS[draw.kind];
    const n = draw.pts.length;
    $('drawText').textContent = n < 1 ? `Draw a ${k.word}: tap the first point in the view.`
      : `Drawing a ${k.word}: ${n} point${n === 1 ? '' : 's'}. Tap the last point again or press Enter to finish. Esc cancels.`;
    $('drawFinish').disabled = n < k.min;
  }
  function startDraw(kind, opts = {}) {
    if (!ready || !KINDS[kind]) return false;
    if (Render.comparing()) { Toast.show('Leave Compare to draw.', 'warn'); return false; }
    const k = KINDS[kind];
    if (k.list) {
      const cur = Store.get(k.list) || [];
      if (cur.length >= k.limit()) { Toast.show(`The limit is ${k.limit()} ${k.word}s. Delete one first.`, 'warn'); return false; }
    }
    clear();
    draw = { kind, pts: [], target: opts.target == null ? null : opts.target };
    hover = null;
    if (Render.info().preset !== 'plan') Render.setView('plan', true);
    syncDrawBar();
    renderPreview();
    refreshOverlay();
    const c = Render.canvas();
    if (c) c.classList.add('is-drawing');
    listeners.forEach((fn) => fn(items.map((i) => ({ ...i }))));
    return true;
  }
  function endDraw() {
    draw = null; hover = null;
    syncDrawBar();
    if (previewGroup) clearGroup(previewGroup);
    const c = Render.canvas();
    if (c) c.classList.remove('is-drawing');
    Render.requestRender();
    listeners.forEach((fn) => fn(items.map((i) => ({ ...i }))));
  }
  function cancelDraw() { if (!draw) return false; endDraw(); refreshOverlay(); return true; }
  function renderPreview() {
    if (!previewGroup) return;
    clearGroup(previewGroup);
    if (!draw) return;
    const M = mapper();
    const pts = hover ? draw.pts.concat([[hover.x, hover.y]]) : draw.pts;
    const closed = KINDS[draw.kind].closed && pts.length >= 3;
    if (pts.length >= 2) {
      const pos = lineAt(pts, closed, M, 1);
      const l = fatLine(pos, cssColorOf('--accent', '#23508f'), 3, 1, 12, true);
      if (l) previewGroup.add(l);
    }
    const d = dots(draw.pts.map((p) => M.W(p[0], p[1], groundAt(p[0], p[1]) + 1)), 13);
    if (d) previewGroup.add(d);
    if (hover) { const h2 = dots([M.W(hover.x, hover.y, groundAt(hover.x, hover.y) + 1)], 9, 0xdde6f3); if (h2) previewGroup.add(h2); }
    Render.requestRender();
  }
  function addDrawPoint(cx, cy, alt) {
    const s = snapAt(cx, cy, alt, draw.pts);
    if (!s) return false;
    const k = KINDS[draw.kind];
    const last = draw.pts[draw.pts.length - 1];
    const tol = clamp(14 / pxPerFt(s.x, s.y), 0.5, 80);
    if (last && Math.hypot(last[0] - s.x, last[1] - s.y) <= tol) {          // tapped the last point again: finish
      if (draw.pts.length >= k.min) { finishDraw(); return true; }
      return false;
    }
    // tapping the first point of a ring closes it
    const first = draw.pts[0];
    if (k.closed && draw.pts.length >= k.min && first && Math.hypot(first[0] - s.x, first[1] - s.y) <= tol) { finishDraw(); return true; }
    draw.pts.push([s.x, s.y]);
    hover = null;
    syncDrawBar();
    renderPreview();
    if (k.max && draw.pts.length >= k.max) finishDraw();
    return true;
  }
  /** Commits the drawing: one undo step. Returns the new item or null. */
  function finishDraw() {
    if (!draw) return null;
    const k = KINDS[draw.kind], pts = draw.pts.map((p) => [rnd(p[0]), rnd(p[1])]);
    if (pts.length < k.min) { Toast.show(`A ${k.word} needs at least ${k.min} points.`, 'warn'); return null; }
    const kind = draw.kind, target = draw.target, replace = draw.replace;
    endDraw();
    const s = Store.raw();
    let item = null;
    if (replace) {                                                  // Redraw: the item keeps its settings, only the points change
      const i = indexOf(s[replace.list], replace.id);
      if (i >= 0) {
        const key = kind === 'lot' ? 'ring' : 'line';
        Store.set(`${replace.list}.${i}.${key}`, pts, { live: false });
        item = { kind, id: replace.id };
        setItems([item]);
        return item;
      }
    }
    if (kind === 'drive') {
      const id = nextId(s.drives, 'D');
      Store.set('drives', [...s.drives, { id, line: pts, width: 24, start: 'existing', slope: 5, cross: 2, crown: true }], { live: false }); item = { kind, id };
    } else if (kind === 'lot') {
      const id = nextId(s.lots, 'L');
      Store.set('lots', [...s.lots, { id, ring: pts, anchor: null, start: 'existing', dir: 0, slope: 2, cross: 1 }], { live: false }); item = { kind, id };
    } else if (kind === 'wall') {
      const id = nextId(s.walls, 'W');
      Store.set('walls', [...s.walls, { id, line: pts, kind: 'drawn' }], { live: false }); item = { kind, id };
    } else if (kind === 'route') {
      const id = nextId(s.routes, 'R');
      Store.set('routes', [...s.routes, { id, line: pts, name: `Route ${s.routes.length + 1}` }], { live: false }); item = { kind, id };
    } else if (kind === 'property') {
      Store.set('property', { mode: 'drawn', ring: pts }, { live: false }); item = { kind, id: 'property' };
    } else if (kind === 'section') {
      Store.set('view.section', [pts[0], pts[1]], { live: false }); item = { kind, id: 'section' };
    } else if (kind === 'building') {
      const i = target == null ? 0 : target;
      if (s.buildings[i]) { Store.set(`buildings.${i}.outer`, pts, { live: false }); item = { kind, id: s.buildings[i].id }; }
    }
    if (item) { setItems([item]); if (kind !== 'section') UI.openItem(item); }
    return item;
  }

  /* ---- deleting ------------------------------------------------------------------------------------------------------- */
  function deleteItem(it) {
    const s = Store.raw();
    if (!it) return false;
    const drop = (list) => { const i = indexOf(s[list], it.id); if (i < 0) return false; Store.set(list, s[list].filter((_, k) => k !== i), { live: false }); return true; };
    let done = false;
    if (it.kind === 'drive') done = drop('drives');
    else if (it.kind === 'lot') done = drop('lots');
    else if (it.kind === 'route') done = drop('routes');
    else if (it.kind === 'wall') {
      done = drop('walls');
      if (!done) Toast.show('Pad-step and automatic walls follow the design. Turn the automatic walls off in the Site work tab to remove them.', 'warn', 6000);
    } else if (it.kind === 'property') { Store.set('property', { mode: 'site', ring: [] }, { live: false }); done = true; }
    else if (it.kind === 'section') { Store.set('view.section', null, { live: false }); done = true; }
    else if (it.kind === 'building') {
      if (s.buildings.length <= 1) { Toast.show('A design needs at least one building.', 'warn'); return false; }
      done = drop('buildings');
    }
    if (done) clear();
    return done;
  }
  const deleteSelected = () => (items.length ? deleteItem(items[0]) : false);

  /* ---- pointer handling ------------------------------------------------------------------------------------------------ */
  const downs = new Map();
  function handleHit(cx, cy, touch) {
    if (!items.length || draw) return null;
    const rad = touch ? 28 : 16;
    let best = null;
    const test = (list, type) => list.forEach((h2) => {
      const p = toClient(new THREE.Vector3(...h2.w));
      if (p.z < -1 || p.z > 1) return;
      const dd = Math.hypot(p.x - cx, p.y - cy);
      if (dd <= rad && (!best || dd < best.d - 0.5 || (type === 'v' && best.type === 'm' && dd <= best.d + 4))) best = { type, i: h2.i, d: dd };
    });
    test(handles.m, 'm'); test(handles.v, 'v');
    return best;
  }
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const touch = e.pointerType === 'touch';
    const hit = handleHit(e.clientX, e.clientY, touch);
    if (hit && !Render.comparing()) {
      const g = geomOf(items[0]);
      if (g && g.path) {
        e.preventDefault(); e.stopImmediatePropagation();
        drag = { pointerId: e.pointerId, path: g.path, closed: g.closed, index: hit.i, type: hit.type, started: false, minPts: (KINDS[items[0].kind] || {}).min || 2 };
        try { Render.canvas().setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no capture */ }
        Render.setOrbitEnabled(false);
        return;
      }
    }
    for (const r of downs.values()) r.cancel = true;
    downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), cancel: downs.size > 0 });
  }
  function onMove(e) {
    if (drag && e.pointerId === drag.pointerId) {
      const s = snapAt(e.clientX, e.clientY, e.altKey, null);
      if (!s) return;
      const cur = Store.get(drag.path);
      if (!Array.isArray(cur)) return;
      let pts = cur.map((p) => [p[0], p[1]]);
      if (drag.type === 'm' && !drag.started) {                      // a midpoint dot becomes a new vertex after its edge's start
        pts.splice(drag.index + 1, 0, [s.x, s.y]);
        drag.index += 1; drag.type = 'v';
      } else if (drag.index < pts.length) pts[drag.index] = [rnd(s.x), rnd(s.y)];
      drag.started = true;
      Store.set(drag.path, pts, { live: true });
      return;
    }
    const r = downs.get(e.pointerId);
    if (r && Math.hypot(e.clientX - r.x, e.clientY - r.y) > PICK_PX) r.cancel = true;
    if (draw && e.pointerType !== 'touch' && !r) {
      const s = snapAt(e.clientX, e.clientY, e.altKey, draw.pts);
      hover = s ? { x: s.x, y: s.y } : null;
      renderPreview();
    }
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return false;
    try { Render.canvas().releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const was = drag.started;
    drag = null;
    Render.setOrbitEnabled(true);
    if (was) Store.commit();
    return true;
  }
  function initPointer() {
    const canvas = Render.canvas();
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointercancel', (e) => { downs.delete(e.pointerId); endDrag(e); });
    canvas.addEventListener('pointerup', (e) => {
      if (endDrag(e)) return;
      const r = downs.get(e.pointerId);
      downs.delete(e.pointerId);
      if (!r || r.cancel || downs.size) return;
      if (Math.hypot(e.clientX - r.x, e.clientY - r.y) > PICK_PX || performance.now() - r.t > PICK_MS) return;
      click(e.clientX, e.clientY, e.altKey);
    });
    canvas.addEventListener('dblclick', (e) => {
      if (draw) return;
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) { setItems([hit]); UI.openItem(hit); }
    });
  }
  function click(cx, cy, alt = false) {
    if (draw) return addDrawPoint(cx, cy, alt);
    const hit = pickAt(cx, cy);
    if (hit) setItems([hit]); else clear();
    return hit;
  }

  /* ---- the selection card (#selection-card) ------------------------------------------------------------------------------ */
  let cardRefs = null;
  const pctS = (f) => `${(f * 100).toFixed(1)}%`;
  function describe(it) {
    const d = D(), s = Store.raw();
    if (it.kind === 'drive') {
      const dv = s.drives.find((x) => x.id === it.id), f = d.built.features.find((x) => x.kind === 'drive' && x.id === it.id);
      return { title: `Drive ${it.id}`, sub: `${fmt(f ? f.length : polyLength(dv.line))} long, ${fmt(dv.width)} wide`, rows: [['Slope', `${dv.slope}%`], ['Cross slope', `${dv.cross}%${dv.crown ? ' crowned' : ''}`], ['Start', dv.start === 'existing' ? 'existing ground' : Units.formatElev(dv.start)]] };
    }
    if (it.kind === 'lot') {
      const l = s.lots.find((x) => x.id === it.id);
      return { title: `Lot ${it.id}`, sub: `${Units.formatArea(Math.abs(ringArea(l.ring)))}`, rows: [['Slope', `${l.slope}%`], ['Cross slope', `${l.cross}%`], ['Uphill', `${Math.round(l.dir)}° ${compassOf(l.dir)}`]] };
    }
    if (it.kind === 'wall') {
      const w = d.metrics && d.metrics.walls && d.metrics.walls.list ? d.metrics.walls.list.find((x) => x.id === it.id) : null;
      const kind = w ? w.kind : 'drawn';
      const rows = w ? [['Tallest', `${w.heightMax.toFixed(2)} ft`], ['Average', `${w.heightAvg.toFixed(2)} ft`], ['Length', fmt(w.length)]] : [];
      return { title: `${kind === 'auto' ? 'Automatic wall' : kind === 'pad-step' ? 'Pad-step wall' : 'Wall'} ${it.id}`, sub: w && w.heightMax > s.limits.wallFlag ? `Over the ${s.limits.wallFlag} ft flag` : '', rows, auto: kind === 'auto' ? { accepted: w.accepted !== false } : null };
    }
    if (it.kind === 'route') {
      const r = s.routes.find((x) => x.id === it.id), m = d.metrics && d.metrics.routes ? d.metrics.routes.find((x) => x.id === it.id) : null;
      return { title: r.name, sub: `${fmt(polyLength(r.line))} long`, rows: m ? [['Steepest running', pctS(m.maxSlope)], ['Steepest cross', pctS(m.maxCross)], ['Kind', m.kind === 'walk' ? 'Walk' : 'Ramp']] : [] };
    }
    if (it.kind === 'building') {
      const b = d.built.buildings.find((x) => x.id === it.id), tiers = d.built.tiers.filter((t) => t.building === it.id);
      return { title: b ? b.name : it.id, sub: `${tiers.length} tier${tiers.length === 1 ? '' : 's'}`, rows: tiers.slice(0, 4).map((t) => [`Tier ${t.tier} FFE`, Units.formatElev(t.ffe)]) };
    }
    if (it.kind === 'property') return { title: 'Property line', sub: `${fmt(polyLength(s.property.ring.concat([s.property.ring[0]])))} around`, rows: [] };
    if (it.kind === 'section') return { title: 'Section line', sub: fmt(polyLength(s.view.section)), rows: [] };
    return { title: it.id, sub: '', rows: [] };
  }
  function renderCard() {
    const card = $('selection-card');
    if (!card) return;
    card.textContent = '';
    cardRefs = null;
    const it = items[0];
    if (!it || !isValid(it)) { card.hidden = true; return; }
    card.hidden = false;
    const refs = cardRefs = {};
    refs.title = h('b', { class: 'sc-name', id: 'itemTitle' });
    refs.sub = h('span', { class: 'sc-sub', id: 'itemSub' });
    const clearBtn = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection (Esc)', html: ICON_X, onclick: clear });
    card.append(h('div', { class: 'sc-head' }, h('div', { class: 'sc-titles' }, refs.title, refs.sub), clearBtn));
    refs.kv = h('dl', { class: 'kv', id: 'itemKv' });
    card.append(refs.kv);
    refs.actions = h('div', { class: 'sc-actions' });
    card.append(refs.actions);
    syncCardText();
  }
  function syncCardText() {
    if (!cardRefs || !items.length) return;
    const it = items[0];
    if (!isValid(it)) return;
    const info = describe(it);
    cardRefs.title.textContent = info.title;
    cardRefs.sub.textContent = info.sub || '';
    cardRefs.kv.textContent = '';
    for (const [k, v] of info.rows) cardRefs.kv.append(h('dt', null, k), h('dd', null, v));
    const g = geomOf(it);
    cardRefs.actions.textContent = '';
    cardRefs.actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'open', onclick: () => UI.openItem(it) }, 'Open in panel'));
    if (info.auto) {
      cardRefs.actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'accept', 'aria-pressed': String(info.auto.accepted), onclick: () => UI.toggleAutoWall(it.id) }, info.auto.accepted ? 'Accepted' : 'Accept wall'));
    }
    if (g && g.path && it.kind !== 'section') cardRefs.actions.append(h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'redraw', onclick: () => redraw(it) }, 'Redraw'));
    if (g && (g.path || it.kind === 'building') && !info.auto) cardRefs.actions.append(h('button', { class: 'btn outline sm danger-text', type: 'button', 'data-action': 'delete', onclick: () => deleteItem(it) }, 'Delete'));
  }
  function redraw(it) {
    const g = geomOf(it);
    if (!g) return false;
    const target = it.kind === 'building' ? g.index : null;
    // Drawing a new line for an existing item replaces its points: remove the item's geometry when the new one is finished.
    if (['drive', 'lot', 'wall', 'route'].includes(it.kind)) {
      const k = KINDS[it.kind];
      const prev = deepClone(Store.get(k.list));
      const idx = indexOf(prev, it.id);
      if (idx < 0) return false;
      startDraw(it.kind, { target });
      draw.replace = { list: k.list, id: it.id };
      return true;
    }
    return startDraw(it.kind, { target });
  }

  /* ---- keyboard (Mac shortcuts) -------------------------------------------------------------------------------------------- */
  const VIEW_KEYS = { 1: 'axon', 2: 'n', 3: 'e', 4: 's', 5: 'w', 6: 'plan' };
  function typing(e) {
    const t = e.target, a = document.activeElement;
    const inField = (n) => !!n && n.nodeType === 1 && (n.matches('input, textarea, select') || n.isContentEditable);
    return inField(t) || inField(a);
  }
  function menuOpen() { return Pop.isOpen() || !!document.querySelector('.modal-back') || !!document.querySelector('.ai-panel[data-open="true"]'); }
  function onKey(e) {
    if (!ready || typing(e) || menuOpen()) return;
    if (Compare.isActive()) return;
    const key = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (key === 'Escape') {
      if (draw) { cancelDraw(); e.preventDefault(); } else if (items.length) { clear(); e.preventDefault(); }
      return;
    }
    if (key === 'Enter' && draw) { e.preventDefault(); finishDraw(); return; }
    if ((key === 'Delete' || key === 'Backspace') && items.length && !draw) { e.preventDefault(); deleteSelected(); return; }
    if (e.shiftKey) return;
    if (VIEW_KEYS[key]) { e.preventDefault(); Render.setView(VIEW_KEYS[key], true); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); Store.set('view.style', Store.get('view.style') === 'cutfill' ? 'model' : 'cutfill', { live: false }); return; }
    if (key === 'w' || key === 'W') { e.preventDefault(); startDraw('wall'); return; }
    if (key === 'r' || key === 'R') { e.preventDefault(); startDraw('route'); }
  }

  function init() {
    ready = Render.ready();
    drawBar();
    if (!$('selection-card')) return;
    Store.subscribe((s, info) => {
      sanitize();
      syncCardText();
      if (items.length && info && info.live) refreshOverlay();
      else if (items.length) refreshOverlay();
    });
    if (!ready) return;
    initOverlay();
    initPointer();
    window.addEventListener('keydown', onKey, true);
    Render.onRebuild(() => { if (items.length) { sanitize(); refreshOverlay(); syncCardText(); } });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener('change', refreshOverlay) : mq.addListener(refreshOverlay));
    window.addEventListener('resize', () => Render.requestRender());
  }

  return {
    init,
    select: (list) => setItems(list), add: (it) => setItems([...items, it]), clear,
    get: () => items.map((i) => ({ ...i })), count: () => items.length,
    pickAt, click, planAt, snapPoint,
    startDraw, cancelDraw, finishDraw, drawing: () => (draw ? { kind: draw.kind, points: draw.pts.length } : null),
    drawTap: (cx, cy, alt) => (draw ? addDrawPoint(cx, cy, !!alt) : false),
    drawPoint: (x, y) => { if (!draw) return false; draw.pts.push([x, y]); syncDrawBar(); renderPreview(); return true; },
    deleteSelected, deleteItem, geomOf, redraw, handles: () => ({ vertices: handles.v.length, midpoints: handles.m.length }),
    handleScreen: (type, i) => { const list = type === 'm' ? handles.m : handles.v; const h2 = list.find((x) => x.i === i); if (!h2) return null; const p = toClient(new THREE.Vector3(...h2.w)); return { x: p.x, y: p.y }; },
    screenOf: (x, y, z) => { const p = toClient(mapper().V(x, y, z == null ? groundAt(x, y) : z)); return { x: p.x, y: p.y }; },
    onChange: (fn) => listeners.push(fn), refreshOverlay,
    overlayInfo: () => ({ outline: group ? group.children.length : 0, preview: previewGroup ? previewGroup.children.length : 0 }),
  };
})();
