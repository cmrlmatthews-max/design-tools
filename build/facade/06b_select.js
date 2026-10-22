import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/* ==========================================================================
   SELECT  (plan section 5.3: faces, no geometry handles in version 1)
   Click a face in the 3D view: the face card shows its orientation, zone, length, level range, system and WWR, with a street toggle.
   Mac shortcuts: 1 to 6 views (axon, N, E, S, W, plan), D Model/Diagram, Escape clears.

   Selection state lives HERE, never in the Store, so it is never saved, exported or undone. Items: { kind: 'face', id } where id is a
   face group id (F1, F2, ...). A click is a short press that did not move; anything longer is an orbit.
   Picking raycasts the instanced meshes of the model layer: every instance remembers the face group that owns it.
   The outline is a fat line around the whole group, in the Render overlay group (never captured).
   "Pick street faces" (Massing tab) turns a click into a street toggle: the street faces become manual.
   ========================================================================== */
const Select = (() => {
  const $ = (id) => document.getElementById(id);
  const PICK_PX = 6, PICK_MS = 400;
  const fmt = (v) => Units.formatFeetInches(v);
  const D = () => Derived.get();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let items = [], ready = false, streetPick = false;
  const listeners = [];
  let outlineGroup = null, mOutline = null, mHalo = null, mGhost = null;

  const groupOf = (id) => D().groups.find((g) => g.id === id) || null;
  const isValid = (it) => !!it && it.kind === 'face' && !!groupOf(it.id);
  const sameItem = (a, b) => a.kind === b.kind && a.id === b.id;

  function setItems(next) {
    const out = [];
    for (const it of next || []) { const n = { kind: 'face', id: it && it.id }; if (isValid(n) && !out.some((o) => sameItem(o, n))) out.push(n); }
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

  /* ---- picking ---------------------------------------------------------------- */
  function canvasRect() { const c = Render.canvas(); return c ? c.getBoundingClientRect() : null; }
  function camera() { const c = Render.camera(); c.updateMatrixWorld(true); return c; }
  function setRay(cx, cy) {
    const rect = canvasRect(), cam = camera();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
  }
  /** The item under a screen point (client px), or null. */
  function pickAt(cx, cy) {
    if (!ready || Render.comparing()) return null;
    const meshes = Render.pickables();
    if (!meshes.length) return null;
    setRay(cx, cy);
    const hits = raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const owners = hit.object.userData.owners;
      const id = owners && hit.instanceId != null ? owners[hit.instanceId] : null;
      if (id) return { kind: 'face', id };
    }
    return null;
  }
  const toClient = (v3) => {
    const rect = canvasRect(), p = v3.clone().project(camera());
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, z: p.z };
  };
  /** A client point where the item can be picked (tests, and the panel link). */
  function screenPointFor(it) {
    if (!ready) return null;
    const g = groupOf(it && it.id);
    if (!g) return null;
    const e = g.edges && g.edges[0] ? g.edges[0] : g;
    const fr = [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6];
    for (const fz of fr) for (const fu of fr) {
      const x = e.a[0] + (e.b[0] - e.a[0]) * fu + g.normal[0] * 0.2, y = e.a[1] + (e.b[1] - e.a[1]) * fu + g.normal[1] * 0.2;
      const p = toClient(worldVec(x, y, g.z + g.height * fz));
      if (p.z < -1 || p.z > 1) continue;
      const hit = pickAt(p.x, p.y);
      if (hit && sameItem(hit, { kind: 'face', id: g.id })) return { x: p.x, y: p.y };
    }
    return null;
  }

  /* ---- outline (fat lines in the Render overlay group) -------------------------------- */
  const cssColorOf = (name, fb) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb);
  function initOverlay() {
    const root = Render.overlayGroup();
    outlineGroup = new THREE.Group();
    root.add(outlineGroup);
    const fatMat = (o) => new LineMaterial({ color: 0x23508f, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...o });
    mGhost = fatMat({ linewidth: 1.25, opacity: 0.3, depthTest: false });
    mHalo = fatMat({ linewidth: 4.25, opacity: 0.9, depthTest: true });
    mOutline = fatMat({ linewidth: 2, opacity: 1, depthTest: true });
  }
  function clearGroup(g) { for (const o of [...g.children]) { g.remove(o); if (o.geometry) o.geometry.dispose(); } }
  function fat(group, pos, material, order) {
    if (!pos.length) return;
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos);
    const ls = new LineSegments2(geo, material);
    ls.renderOrder = order; ls.frustumCulled = false;
    group.add(ls);
  }
  function outlinePos(g) {
    const out = [];
    const off = 0.3, nx = g.normal[0] * off, ny = g.normal[1] * off;
    const z0 = g.z, z1 = g.z + g.height;
    const A = [g.a[0] + nx, g.a[1] + ny], B = [g.b[0] + nx, g.b[1] + ny];
    const seg = (p, q) => out.push(...planToWorld(p[0], p[1], p[2]), ...planToWorld(q[0], q[1], q[2]));
    seg([A[0], A[1], z0], [B[0], B[1], z0]); seg([A[0], A[1], z1], [B[0], B[1], z1]);
    seg([A[0], A[1], z0], [A[0], A[1], z1]); seg([B[0], B[1], z0], [B[0], B[1], z1]);
    return out;
  }
  function refreshOverlay() {
    if (!ready || !outlineGroup) return;
    clearGroup(outlineGroup);
    if (Render.comparing()) { Render.requestRender(); return; }
    mOutline.color.copy(cssColorOf('--accent', '#23508f')); mGhost.color.copy(mOutline.color);
    mHalo.color.copy(cssColorOf('--surface', '#ffffff'));
    const pos = [];
    for (const it of items) { const g = groupOf(it.id); if (g) pos.push(...outlinePos(g)); }
    fat(outlineGroup, pos, mGhost, 11); fat(outlineGroup, pos, mHalo, 12); fat(outlineGroup, pos, mOutline, 13);
    Render.requestRender();
  }

  /* ---- street faces ------------------------------------------------------------------ */
  function toggleStreet(id) {
    const g = groupOf(id);
    if (!g) return false;
    const ids = new Set(D().street);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    const order = D().groups.map((x) => x.id).filter((x) => ids.has(x));
    Store.set('street', { ...Store.get('street'), mode: 'manual', manual: order }, { live: false });
    return true;
  }
  function setStreetPick(on) { streetPick = !!on; listeners.forEach((fn) => fn(items.map((i) => ({ ...i })))); return streetPick; }

  /* ---- click picking ------------------------------------------------------------------ */
  const downs = new Map();
  function initPointer() {
    const canvas = Render.canvas();
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      for (const r of downs.values()) r.cancel = true;
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), cancel: downs.size > 0 });
    });
    canvas.addEventListener('pointermove', (e) => {
      const r = downs.get(e.pointerId);
      if (r && Math.hypot(e.clientX - r.x, e.clientY - r.y) > PICK_PX) r.cancel = true;
    });
    canvas.addEventListener('pointercancel', (e) => downs.delete(e.pointerId));
    canvas.addEventListener('pointerup', (e) => {
      const r = downs.get(e.pointerId);
      downs.delete(e.pointerId);
      if (!r || r.cancel || downs.size) return;
      if (Math.hypot(e.clientX - r.x, e.clientY - r.y) > PICK_PX || performance.now() - r.t > PICK_MS) return;
      click(e.clientX, e.clientY);
    });
    canvas.addEventListener('dblclick', (e) => {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) { setItems([hit]); UI.openItem(hit); }
    });
  }
  function click(cx, cy) {
    const hit = pickAt(cx, cy);
    if (streetPick) { if (hit) toggleStreet(hit.id); return hit; }
    if (hit) setItems([hit]); else clear();
    return hit;
  }

  /* ---- the face card (#selection-card) ----------------------------------------------- */
  let cardRefs = null;
  const zoneName = (id) => {
    if (CONFIG.zoneLabels[id]) return CONFIG.zoneLabels[id];
    const r = (Store.raw().zones.ranges || []).find((x) => x.id === id);
    return r ? r.name : id;
  };
  const levelText = (g) => (g.levelFrom === g.levelTo ? `level ${g.levelFrom}` : `levels ${g.levelFrom} to ${g.levelTo}`);
  function renderCard() {
    const card = $('selection-card');
    if (!card) return;
    card.textContent = '';
    cardRefs = null;
    const it = items[0];
    const g = it && groupOf(it.id);
    if (!g) { card.hidden = true; return; }
    card.hidden = false;
    const refs = cardRefs = {};
    refs.title = h('b', { class: 'sc-name', id: 'faceTitle' });
    refs.sub = h('span', { class: 'sc-sub', id: 'faceSub' });
    const clearBtn = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection (Esc)', html: ICON_X, onclick: clear });
    card.append(h('div', { class: 'sc-head' }, h('div', { class: 'sc-titles' }, refs.title, refs.sub), clearBtn));
    refs.kv = h('dl', { class: 'kv', id: 'faceKv' });
    card.append(refs.kv);
    refs.street = h('button', { class: 'btn outline sm', type: 'button', id: 'faceStreet', 'data-action': 'street', 'aria-pressed': 'false', onclick: () => toggleStreet(it.id) }, 'Street face');
    refs.open = h('button', { class: 'btn outline sm', type: 'button', 'data-action': 'open', onclick: () => UI.openItem(it) }, 'Open in panel');
    card.append(h('div', { class: 'sc-actions' }, refs.street, refs.open));
    syncCardText();
  }
  function syncCardText() {
    if (!cardRefs || !items.length) return;
    const g = groupOf(items[0].id);
    if (!g) return;
    const gi = D().groupInfo[g.id] || { wall: 0, glazing: 0, wwr: 0, balconies: 0, system: 'punched' };
    cardRefs.title.textContent = `Face ${g.id} · ${CONFIG.orientationLabels[g.orientation]}`;
    cardRefs.sub.textContent = `${fmt(g.length)} · ${levelText(g)} · ${zoneName(g.zone)} · ${(CONFIG.systemLabels[gi.system] || '').toLowerCase()}`;
    const rows = [['WWR', pct1(gi.wwr)], ['Wall', Units.formatArea(gi.wall)], ['Glazing', Units.formatArea(gi.glazing)]];
    if (gi.balconies) rows.push(['Balconies', Units.formatInt(gi.balconies)]);
    rows.push(['Bearing', `${Math.round(g.bearing)}°`]);
    cardRefs.kv.textContent = '';
    for (const [k, v] of rows) cardRefs.kv.append(h('dt', null, k), h('dd', null, v));
    const on = D().street.includes(g.id);
    cardRefs.street.setAttribute('aria-pressed', String(on));
    cardRefs.street.classList.toggle('is-on', on);
    cardRefs.street.textContent = on ? 'Street face: on' : 'Street face: off';
  }

  /* ---- keyboard (Mac shortcuts) ------------------------------------------------------ */
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
    if (key === 'Escape') { if (streetPick) { UI.setStreetPick(false); e.preventDefault(); } else if (items.length) { clear(); e.preventDefault(); } return; }
    if (e.shiftKey) return;
    if (VIEW_KEYS[key]) { e.preventDefault(); Render.setView(VIEW_KEYS[key], true); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); Store.set('view.style', Store.get('view.style') === 'diagram' ? 'model' : 'diagram', { live: false }); }
  }

  function init() {
    ready = Render.ready();
    if (!$('selection-card')) return;
    Store.subscribe(() => { sanitize(); syncCardText(); });
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
    pickAt, click, screenPointFor, toggleStreet, setStreetPick, streetPick: () => streetPick,
    onChange: (fn) => listeners.push(fn), refreshOverlay,
    overlayInfo: () => ({ outline: outlineGroup ? outlineGroup.children.length : 0 }),
  };
})();
