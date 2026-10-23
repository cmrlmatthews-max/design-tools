/* ==========================================================================
   PLACEMENT GIZMO  (shared by the Tower, the Mid-Rise Generator and the Parking Deck)
   Drag the building to place it on the project site, turn it with the ring handle.

   - Move: a pointer down on a model mesh (Render.modelMeshes()) starts a move after 6 px of travel. The ground plane of the
     drag is the horizontal plane through the grabbed point. The pointer position is turned into a PROJECT-frame point, so the
     delta is added to placement.x / placement.y directly (no rotation maths). 1 ft steps, 5 ft with Shift.
   - Rotate: a ring around the building box and a grip (DOM, `.hdl.hdl-rotate`) on its local +x side. The building turns about
     its box center in 5 degree steps (1 degree with Alt).
   - Live preview with Store.set(path, value, { live: true }); ONE undo step on release (Store.commit()). On release the base
     elevation follows the ground when the building was moved or turned: ProjectUI.baseFor(placement) gives the lowest ground under
     the footprint (Follow ground), or null to leave the base alone (Typed, no site ground, a wrap or podium deck). A page without
     ProjectUI.baseFor snaps to the ground at the placement origin (SiteLayerMod.groundZAt). Escape or a second finger
     restores the original values and commits nothing.
   - The pointer maths always uses a SNAPSHOT of the camera taken at the start of the drag. While the drag runs, Render.shiftView
     (when the page has it) carries the camera along with the local frame, so the site stays still on screen and the building
     follows the finger. Without that export the building stays still and the site slides: same numbers, less natural.
   - Orbit is off from the pointer down on the model until the pointer is released; it starts on empty ground as before.
   - Hit rule: a move starts only from a press whose target is the canvas itself (never a .hdl, a card or a button) and only while
     Select.handlesShown() is false (no selection with handles). Pin placement: opts.locked() true makes the gizmo inactive.
   - The Store notifies live sets with live = true: 09b_project.js (Tower, Mid-Rise) re-runs Context from site only on the
     commit notification, so a drag never rewrites the context blocks per frame.

   Globals used at call time: THREE, Store, Render, ProjectUI, ProjectMod, SiteLayerMod (optional, falls back to
   ProjectUI.groundAt), Units, worldVec, h.
   ========================================================================== */
const PlacementGizmo = (() => {
  const PICK_PX = 6;                       // travel before a press on the model becomes a move
  const RING_K = 1.15;                     // ring radius = 1.15 x the half diagonal of the building box
  const MIN_DIRY = 0.12;                   // a view this close to horizontal cannot place on the ground (elevations)
  const SEGS = 72;
  const MAX_ABS = 1e6;
  const TAU = Math.PI * 2;

  let opts = null, ready = false, wired = false;
  let layer = null, svg = null, ringEl = null, rotEl = null, labelEl = null;
  let pend = null;                         // pointer down on the model, no drag yet: { pointerId, x, y, cam, rect, planeY, orbitOff }
  let drag = null;                         // the drag in progress
  let lastLabel = '';
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const fin = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r2 = (v) => Math.round(v * 100) / 100;
  const pathOf = () => (opts && opts.path) || 'placement';
  const isCoarse = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const fmt = (v) => (typeof Units !== 'undefined' && Units.formatFeetInches ? Units.formatFeetInches(v) : `${Math.round(v)} ft`);
  const normDeg = (d) => { let r = ((d + 180) % 360 + 360) % 360 - 180; if (r === -180) r = 180; return r; };
  const wrapRad = (a) => { let r = a % TAU; if (r > Math.PI) r -= TAU; if (r < -Math.PI) r += TAU; return r; };

  /* ---- reading the world ------------------------------------------------------------------- */
  function readPlacement() {
    const p = Store.get(pathOf());
    if (!p || typeof p !== 'object') return null;
    const out = { x: fin(p.x), y: fin(p.y), rotation: fin(p.rotation), baseZ: fin(p.baseZ) };
    if (typeof p.baseMode === 'string') out.baseMode = p.baseMode;       // Follow ground / Typed: a move never drops it
    return out;
  }
  /** Pin placement (PinUI, 08y_pin.js): a locked placement has no drag, no ring and no grip. */
  function locked() {
    try { return !!(opts && typeof opts.locked === 'function' && opts.locked()); } catch (e) { return false; }
  }
  function active() {
    if (!opts || !ready) return false;
    try {
      if (!Render.ready() || Render.comparing() || locked()) return false;
      return !!ProjectUI.has() && !!readPlacement() && !!opts.enabled();
    } catch (e) { return false; }
  }
  function box() {
    let b = null;
    try { b = opts.bounds(); } catch (e) { b = null; }
    if (!b || ![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) return null;
    return b;
  }
  /** site.derived of the open project, or null. */
  function siteDerived() {
    try {
      const doc = ProjectUI.doc();
      const sec = doc && ProjectMod.getSection(doc, 'site');
      return sec && sec.derived && typeof sec.derived === 'object' ? sec.derived : null;
    } catch (e) { return null; }
  }
  /** Ground elevation (absolute ft) at a project point, or null without a ground grid. */
  function groundZ(x, y) {
    let z = null;
    try {
      const dv = siteDerived();
      if (typeof SiteLayerMod !== 'undefined' && SiteLayerMod && typeof SiteLayerMod.groundZAt === 'function') z = dv ? SiteLayerMod.groundZAt(dv, x, y) : null;
      else if (typeof ProjectUI.groundAt === 'function') z = ProjectUI.groundAt(x, y);
    } catch (e) { z = null; }
    return Number.isFinite(z) ? z : null;
  }
  /** The base elevation (absolute ft) for the placement `pl`, or null to leave it. The page decides (ProjectUI.baseFor, 09b_project.js):
   *  Follow ground = the lowest ground under the building footprint; Typed = null. Without that hook: the ground at the origin. */
  function baseFor(pl) {
    try {
      if (typeof ProjectUI !== 'undefined' && ProjectUI && typeof ProjectUI.baseFor === 'function') {
        const z = ProjectUI.baseFor(pl);
        return Number.isFinite(z) ? z : null;
      }
    } catch (e) { return null; }
    return groundZ(pl.x, pl.y);
  }
  const modelMeshes = () => {
    try { return typeof Render.modelMeshes === 'function' ? Render.modelMeshes() : []; } catch (e) { return []; }
  };
  const canvasRect = () => { const c = Render.canvas(); return c ? c.getBoundingClientRect() : null; };

  /* ---- rays and the ground plane ----------------------------------------------------------- */
  function snapshotCam() {
    const live = Render.camera();
    live.updateMatrixWorld(true);
    const cam = live.clone();
    cam.projectionMatrix.copy(live.projectionMatrix);
    cam.projectionMatrixInverse.copy(live.projectionMatrixInverse);
    cam.matrixWorld.copy(live.matrixWorld);
    cam.matrixWorldInverse.copy(live.matrixWorldInverse);
    return cam;
  }
  function rayThrough(cam, rect, cx, cy) {
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
    return raycaster.ray;
  }
  /** World point where the pointer ray meets the horizontal plane y = planeY, or null (nearly horizontal view, behind the camera). */
  function planeHit(cam, rect, cx, cy, planeY) {
    const ray = rayThrough(cam, rect, cx, cy);
    const dy = ray.direction.y;
    if (Math.abs(dy) < MIN_DIRY) return null;
    const t = (planeY - ray.origin.y) / dy;
    if (!cam.isOrthographicCamera && !(t > 0)) return null;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }
  /** The nearest visible model mesh under a client point (live camera), or null. */
  function hitModel(cx, cy) {
    const meshes = modelMeshes().filter((m) => m.visible);
    const rect = canvasRect();
    if (!meshes.length || !rect || !rect.width) return null;
    const cam = Render.camera();
    cam.updateMatrixWorld(true);
    rayThrough(cam, rect, cx, cy);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0] : null;
  }
  const toProj = (pl, x, y) => ProjectMod.toProject(pl, [x, y]);

  /* ---- writing the placement --------------------------------------------------------------- */
  /** The rigid transform of the local frame when the placement goes from `a` to `b` (what the camera must follow). */
  function frameDelta(a, b) {
    const r = (-b.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const ex = a.x - b.x, ey = a.y - b.y;
    return { rot: a.rotation - b.rotation, dx: ex * c - ey * s, dy: ex * s + ey * c, dz: a.baseZ - b.baseZ };
  }
  function followCamera(a, b) {
    if (typeof Render.shiftView !== 'function') return;
    const v = frameDelta(a, b);
    if (Math.abs(v.rot) < 1e-9 && Math.abs(v.dx) < 1e-9 && Math.abs(v.dy) < 1e-9 && Math.abs(v.dz) < 1e-9) return;
    try { Render.shiftView(v.rot, v.dx, v.dy, v.dz); } catch (e) { /* the camera simply stays */ }
  }
  const samePl = (a, b) => a.x === b.x && a.y === b.y && a.rotation === b.rotation && a.baseZ === b.baseZ;
  function write(next) {
    const d = drag;
    if (samePl(next, d.last)) return;
    Store.set(pathOf(), next, { live: true });
    followCamera(d.last, next);
    d.last = next;
  }

  /* ---- label -------------------------------------------------------------------------------- */
  function showLabel(pl, cx, cy) {
    lastLabel = `X ${fmt(pl.x)} · Y ${fmt(pl.y)} · ${Math.round(pl.rotation * 10) / 10}°`;
    if (!labelEl) return;
    labelEl.hidden = false;
    labelEl.textContent = '';
    labelEl.append(h('b', null, lastLabel));
    const rect = canvasRect();
    if (rect && Number.isFinite(cx) && Number.isFinite(cy)) {
      const x = Math.min(Math.max(cx - rect.left + 18, 8), Math.max(8, rect.width - 250));
      const y = Math.min(Math.max(cy - rect.top - 52, 8), Math.max(8, rect.height - 60));
      labelEl.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    }
  }

  /* ---- drag: start, step, finish ------------------------------------------------------------ */
  /** Starts a drag. kind 'move' needs a model mesh under the point (or a prepared `pre` from a pointer down); 'rotate' needs a ground hit. */
  function startDrag(kind, cx, cy, o = {}) {
    if (!active() || drag) return false;
    if (Store.gestureActive()) return false;                          // a slider or another handle is mid-gesture
    const pl0 = readPlacement();
    if (!pl0) return false;
    let cam, rect, planeY, anchor;
    if (kind === 'move') {
      if (o.pre) ({ cam, rect, planeY } = o.pre);
      else {
        const hit = hitModel(cx, cy);
        if (!hit) return false;
        cam = snapshotCam(); rect = canvasRect(); planeY = hit.point.y;
      }
      const w = planeHit(cam, rect, o.pre ? o.pre.x : cx, o.pre ? o.pre.y : cy, planeY);
      if (!w) return false;
      anchor = toProj(pl0, w.x, -w.z);
    } else if (kind === 'rotate') {
      const b = box();
      if (!b) return false;
      cam = snapshotCam(); rect = canvasRect(); planeY = 0;
      const w = planeHit(cam, rect, cx, cy, planeY);
      if (!w) return false;
      const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
      anchor = { c, cp: toProj(pl0, c[0], c[1]), ang: Math.atan2(-w.z - c[1], w.x - c[0]) };
    } else return false;
    drag = {
      kind, cam, rect, planeY, pl0, last: pl0, anchor, pointerId: o.pointerId == null ? null : o.pointerId,
      acc: 0, prevAng: kind === 'rotate' ? anchor.ang : 0, pending: null, raf: 0, orbitOff: !!o.orbitOff,
    };
    if (!drag.orbitOff) { Render.setOrbitEnabled(false); drag.orbitOff = true; }
    const vp = document.getElementById('viewport');
    if (vp) vp.dataset.dragging = `place-${kind}`;
    if (rotEl) rotEl.classList.toggle('is-active', kind === 'rotate');
    showLabel(pl0, cx, cy);
    Render.requestRender();
    return true;
  }
  function stepMove(cx, cy, mods) {
    const d = drag;
    const w = planeHit(d.cam, d.rect, cx, cy, d.planeY);
    if (!w) return;
    const H = toProj(d.pl0, w.x, -w.z);
    const step = mods.shift ? 5 : 1;
    const snap = (v) => Math.min(MAX_ABS, Math.max(-MAX_ABS, Math.round(v / step) * step));
    write({ ...d.pl0, x: snap(d.pl0.x + (H[0] - d.anchor[0])), y: snap(d.pl0.y + (H[1] - d.anchor[1])) });
  }
  function stepRotate(cx, cy, mods) {
    const d = drag;
    const w = planeHit(d.cam, d.rect, cx, cy, 0);
    if (!w) return;
    const { c, cp } = d.anchor;
    const ang = Math.atan2(-w.z - c[1], w.x - c[0]);
    d.acc += wrapRad(ang - d.prevAng);
    d.prevAng = ang;
    const step = mods.alt ? 1 : 5;
    const rot = normDeg(Math.round((d.pl0.rotation + (d.acc * 180) / Math.PI) / step) * step);
    const r = (rot * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
    write({ ...d.pl0, rotation: rot, x: r3(cp[0] - (c[0] * co - c[1] * si)), y: r3(cp[1] - (c[0] * si + c[1] * co)) });
  }
  function applyMove(cx, cy, mods = {}) {
    if (!drag) return false;
    if (drag.kind === 'move') stepMove(cx, cy, mods); else stepRotate(cx, cy, mods);
    showLabel(drag.last, cx, cy);
    sync();
    Render.requestRender();
    return true;
  }
  function queueMove(e) {
    if (!drag) return;
    drag.pending = { cx: e.clientX, cy: e.clientY, mods: { shift: !!e.shiftKey, alt: !!e.altKey } };
    if (!drag.raf) drag.raf = requestAnimationFrame(() => { if (drag) { drag.raf = 0; flush(); } });
  }
  function flush() {
    if (!drag || !drag.pending) return;
    const p = drag.pending;
    drag.pending = null;
    applyMove(p.cx, p.cy, p.mods);
  }
  /** Ends the drag. ok = true: base elevation to the ground, ONE undo step, then onCommit. ok = false: back to the start, nothing committed. */
  function finish(ok = true) {
    const d = drag;
    if (!d) return false;
    if (d.raf) cancelAnimationFrame(d.raf);
    drag = null;
    const path = pathOf();
    let changed = false;
    if (!ok) {
      Store.set(path, d.pl0, { live: true });
      followCamera(d.last, d.pl0);
      Store.commit();
    } else {
      let cur = readPlacement() || d.pl0;
      changed = cur.x !== d.pl0.x || cur.y !== d.pl0.y || cur.rotation !== d.pl0.rotation;
      if (changed) {
        const z = baseFor(cur);
        if (z != null && r2(z) !== cur.baseZ) {
          const next = { ...cur, baseZ: r2(z) };
          Store.set(path, next, { live: true });
          followCamera(cur, next);
          cur = next;
        }
      }
      Store.commit();
    }
    if (d.orbitOff) Render.setOrbitEnabled(true);
    const vp = document.getElementById('viewport');
    if (vp) delete vp.dataset.dragging;
    if (rotEl) rotEl.classList.remove('is-active');
    if (labelEl) labelEl.hidden = true;
    Render.requestRender();
    sync();
    if (ok && changed && opts && typeof opts.onCommit === 'function') { try { opts.onCommit(); } catch (e) { console.error(e); } }
    return true;
  }

  /* ---- pointer events on the canvas: press on the model, 6 px, move ------------------------- */
  function releasePend() {
    if (!pend) return;
    const p = pend;
    pend = null;
    if (p.orbitOff && !drag) Render.setOrbitEnabled(true);
  }
  function onWindowMove(e) {
    if (drag && drag.pointerId === e.pointerId) { queueMove(e); return; }
    if (!pend || pend.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - pend.x, e.clientY - pend.y) < PICK_PX) return;
    const p = pend;
    pend = null;
    if (!startDrag('move', p.x, p.y, { pre: p, pointerId: e.pointerId, orbitOff: p.orbitOff })) { if (p.orbitOff) Render.setOrbitEnabled(true); return; }
    try { Render.canvas().setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no active pointer */ }
    queueMove(e);
  }
  function onWindowUp(e) {
    if (drag && drag.pointerId === e.pointerId) { flush(); finish(true); }
    else if (pend && pend.pointerId === e.pointerId) releasePend();
    if (!drag && !pend) unlisten();
  }
  function onWindowCancel(e) {
    if (drag && drag.pointerId === e.pointerId) finish(false);
    else if (pend && pend.pointerId === e.pointerId) releasePend();
    if (!drag && !pend) unlisten();
  }
  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowCancel);
  }
  function unlisten() {
    if (!listening) return;
    listening = false;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowCancel);
  }
  function onCanvasDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // a second finger: a pinch or a pan, never a placement
    if (pend && pend.pointerId !== e.pointerId) { releasePend(); return; }
    if (drag && drag.pointerId !== e.pointerId) { finish(false); return; }
    if (pend || drag) return;
    if (!active() || Store.gestureActive()) return;
    if (typeof Select !== 'undefined' && Select.dragging && Select.dragging()) return;
    // The hit rule (batch fixes plan 2.3): only a press on the canvas itself can move the building, never one on a handle, a card or a button,
    // and never while the selection shows handles (a press on the model then selects or edits; Escape clears the selection first).
    if (e.target !== Render.canvas()) return;
    try { if (typeof Select !== 'undefined' && Select.handlesShown && Select.handlesShown()) return; } catch (err) { /* no select layer */ }
    const hit = hitModel(e.clientX, e.clientY);
    if (!hit) return;
    const rect = canvasRect();
    if (!rect) return;
    const cam = snapshotCam();
    const planeY = hit.point.y;
    if (!planeHit(cam, rect, e.clientX, e.clientY, planeY)) return;     // an elevation view cannot place on the ground
    Render.setOrbitEnabled(false);                                       // from here the press is a move (or a click), never an orbit
    pend = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, cam, rect, planeY, orbitOff: true };
    listen();
  }
  function onKey(e) {
    if (e.key === 'Escape' && drag) finish(false);
  }

  /* ---- DOM: the ring, the grip and the label -------------------------------------------------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/></svg>';
  function build() {
    const host = document.getElementById('canvasHost');
    if (!host || !host.parentNode) return false;
    layer = h('div', { class: 'hdl-layer', id: 'placeLayer', hidden: true });
    host.parentNode.insertBefore(layer, host.nextSibling);
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none');
    ringEl = document.createElementNS(SVGNS, 'path');
    ringEl.setAttribute('class', 'place-ring');
    ringEl.setAttribute('fill', 'none');
    ringEl.setAttribute('style', 'stroke:var(--accent);stroke-width:1.6;stroke-dasharray:6 5;stroke-linecap:round;pointer-events:none');
    ringEl.setAttribute('opacity', '0.5');
    svg.append(ringEl);
    layer.append(svg);
    labelEl = h('div', { class: 'hdl-label', id: 'placeLabel', hidden: true, role: 'status' });
    layer.append(labelEl);
    rotEl = h('div', { class: 'hdl hdl-rotate', 'data-handle': 'rotate', role: 'button', 'aria-label': 'Turn the building', title: 'Turn the building (5 degree steps)', hidden: true },
      h('span', { class: 'hdl-glyph', html: GRIP }));
    rotEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (startDrag('rotate', e.clientX, e.clientY, { pointerId: e.pointerId })) {
        try { rotEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events have no active pointer */ }
        listen();
      }
    });
    layer.append(rotEl);
    return true;
  }

  const _v = new THREE.Vector3(), _d = new THREE.Vector3();
  /** Called after each drawn frame (and by the drag): puts the ring and the grip on the screen. */
  function sync() {
    if (!layer) return;
    if (!active()) { layer.hidden = true; return; }
    const b = box();
    const cam = Render.camera();
    const rect = canvasRect();
    if (!b || !cam || !rect || !rect.width) { layer.hidden = true; return; }
    cam.updateMatrixWorld(true);
    cam.getWorldDirection(_d);
    if (Math.abs(_d.y) < MIN_DIRY) { layer.hidden = true; return; }       // an elevation: the ring would be a line
    layer.hidden = false;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const R = Math.max(12, RING_K * Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2);
    const px = (x, y) => {
      const p = _v.copy(worldVec(x, y, 0)).project(cam);
      return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height, ok: p.z >= -1 && p.z <= 1 };
    };
    let dstr = '', pen = false;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * TAU, p = px(cx + R * Math.cos(a), cy + R * Math.sin(a));
      if (!p.ok) { pen = false; continue; }
      dstr += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      pen = true;
    }
    ringEl.setAttribute('d', dstr);
    ringEl.setAttribute('opacity', drag && drag.kind === 'rotate' ? '0.95' : '0.5');
    const g = px(cx + R, cy);
    rotEl.hidden = !g.ok;
    if (g.ok) rotEl.style.transform = `translate(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px)`;
    if (drag && labelEl.hidden) labelEl.hidden = false;
  }

  /* ---- public ------------------------------------------------------------------------------- */
  /** Wires the handlers once. opts: { enabled: () => bool, bounds: () => { minX, maxX, minY, maxY } (local building box),
   *  path: 'placement', onCommit: () => void, locked: () => bool (Pin placement: true turns the drag and the ring off) }. Returns false when the page has no 3D view. */
  function init(o) {
    opts = { path: 'placement', enabled: () => true, bounds: () => null, onCommit: null, locked: null, ...(o || {}) };
    if (wired) return true;
    ready = !!Render.ready();
    if (!ready) return false;
    if (!build()) return false;
    wired = true;
    const canvas = Render.canvas();
    // capture phase on the host: this runs before OrbitControls sees the same press
    const host = canvas.parentNode || canvas;
    host.addEventListener('pointerdown', onCanvasDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', () => { if (drag) finish(false); releasePend(); });
    Render.onFrame(sync);
    window.addEventListener('resize', () => Render.requestRender());
    return true;
  }

  /** Test points: a client point on the model (a model mesh is hit there), and a client point on the ring at `deg` (local plan angle). */
  function modelPoint() {
    const rect = canvasRect();
    const b = box();
    if (!rect || !b) return null;
    const cam = Render.camera();
    cam.updateMatrixWorld(true);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const proj = (x, y, z) => { const p = worldVec(x, y, z).project(cam); return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height, ok: p.z >= -1 && p.z <= 1 }; };
    for (const z of [2, 8, 20, 45, 90, 160]) {
      for (const f of [0, 0.25, -0.25]) {
        const p = proj(cx + f * (b.maxX - b.minX), cy, z);
        if (p.ok && hitModel(p.x, p.y)) return { x: p.x, y: p.y };
      }
    }
    const mid = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    let best = null;
    for (let i = 1; i < 40; i++) for (let j = 1; j < 30; j++) {
      const x = rect.left + (rect.width * i) / 40, y = rect.top + (rect.height * j) / 30;
      if (!hitModel(x, y)) continue;
      const dd = Math.hypot(x - mid.x, y - mid.y);
      if (!best || dd < best.d) best = { x, y, d: dd };
    }
    return best ? { x: best.x, y: best.y } : null;
  }
  function ringPoint(deg = 0) {
    const rect = canvasRect();
    const b = box();
    if (!rect || !b) return null;
    const cam = Render.camera();
    cam.updateMatrixWorld(true);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const R = Math.max(12, RING_K * Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2);
    const a = (deg * Math.PI) / 180;
    const p = worldVec(cx + R * Math.cos(a), cy + R * Math.sin(a), 0).project(cam);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  return {
    init, sync,
    info: () => { sync(); return { active: active(), locked: locked(), dragging: drag ? drag.kind : null, handles: layer && !layer.hidden && rotEl && !rotEl.hidden ? 1 : 0, label: lastLabel }; },
    /** Synthetic drags for tests: begin(kind, cx, cy) -> move(cx, cy, { shift, alt }) -> end(ok). kind: 'move' | 'rotate'. */
    begin: (kind, cx, cy) => startDrag(kind, cx, cy, {}),
    move: (cx, cy, mods) => applyMove(cx, cy, mods || {}),
    end: (ok = true) => finish(ok !== false),
    modelPoint, ringPoint, groundZ, baseFor,
  };
})();
