/* ==========================================================================
   CORE: placement gizmo and pin (app/CONTRACT.md section 7)
   A port of build/shared/06y_placement.js and build/shared/08y_pin.js as a factory with no page globals.
   Drag the building to place it on the project site, turn it with the ring grip.

   createPlacementGizmo({ scene, input, ground, get, set, bounds, pickables, enabled }) -> { sync, setEnabled, setPinned, pinned, info, dispose }
   - get() -> { x, y, rotation, baseZ, baseMode, pinned } (project frame; rotation in degrees, counter-clockwise).
   - set(placement, { live }): live true while the drag runs (a preview, no undo step yet). live false comes ONCE at the end
     and closes the drag as one undo step. A cancelled drag (Escape, a second finger) ends with set(startPlacement,
     { live: false, cancel: true }). With core/store.js the simplest set is:
         (p, { live }) => { store.set('placement', p, { live: true }); if (!live) store.commit(); }
     (a live set then commit() makes exactly one undo step, and none when the value came back to the start).
   - bounds() -> the footprint as a plan ring [[x, y], ...] in the PROJECT frame (or a { minX, maxX, minY, maxY } box).
   - pickables() -> the meshes that start a move drag (the tool's live layer meshes).
   - enabled() -> bool (optional): false hides the gizmo, e.g. while the tool shows selection handles.
   - ground: core/ground.js (at(x, y) -> project z | null).

   Rules (from the old pages):
   - Move: a press on a pickable mesh (input priority GIZMO) becomes a move after 6 px. The drag plane is the horizontal plane
     through the grabbed point. The pointer turns into a PROJECT point, so the delta adds to placement.x / y. 1 ft steps,
     5 ft with Shift. A shorter press stays a tap (up() returns 'tap', so tap-to-pick still selects the building).
   - Rotate: a dashed ring around the footprint and a DOM grip on its +x side (in #handles). The building turns about its
     footprint center in 5 degree steps (1 degree with Alt).
   - The pointer maths uses a snapshot of the camera from the start of the drag. Orbit is off for the whole gesture.
   - baseMode 'follow': on release, when the building moved or turned, baseZ = the lowest ground.at() under the footprint
     (9 x 9 samples over its plan box), rounded to 0.1 ft. Other modes keep baseZ.
   - pinned: no drag, no ring, no grip. setPinned(on) writes placement.pinned as one undo step.
   - An elevation view (the camera within about 7 degrees of horizontal) hides the ring and refuses drags.
   ========================================================================== */
import * as THREE from 'three';
import { worldVec, toScene, fromScene } from './frame.js';
import { PRIORITY } from './input.js';
import { toProject, toLocal } from '../../src/shared/project.js';

const PICK_PX = 6;
const RING_K = 1.15;                       // ring radius = 1.15 x the half diagonal of the footprint box
const MIN_DIRY = 0.12;                     // a view this close to horizontal cannot place on the ground
const SEGS = 72;
const MAX_ABS = 1e6;
const TAU = Math.PI * 2;
const SVGNS = 'http://www.w3.org/2000/svg';
const GRIP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/></svg>';

const fin = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const normDeg = (d) => { let r = ((d + 180) % 360 + 360) % 360 - 180; if (r === -180) r = 180; return r; };
const wrapRad = (a) => { let r = a % TAU; if (r > Math.PI) r -= TAU; if (r < -Math.PI) r += TAU; return r; };
const fmtFt = (v) => `${Math.round(v).toLocaleString('en-US')} ft`;

/** A plan box { minX, maxX, minY, maxY } of a ring or a box, or null. */
function boxOf(b) {
  if (!b) return null;
  if (Array.isArray(b)) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of b) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
    return Number.isFinite(minX + maxX + minY + maxY) ? { minX, maxX, minY, maxY } : null;
  }
  return [b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite) ? { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY } : null;
}
function ringOf(b) {
  if (Array.isArray(b)) return b.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const x = boxOf(b);
  return x ? [[x.minX, x.minY], [x.maxX, x.minY], [x.maxX, x.maxY], [x.minX, x.maxY]] : [];
}

/** The placement after a move by (dx, dy) project feet, snapped to `step`. Pure. */
export function movedPlacement(pl0, dx, dy, step = 1) {
  const snap = (v) => Math.min(MAX_ABS, Math.max(-MAX_ABS, Math.round(v / step) * step));
  return { ...pl0, x: snap(pl0.x + dx), y: snap(pl0.y + dy) };
}
/** The placement turned to `rotation` degrees about the project point `c` (which stays put). Pure. */
export function turnedPlacement(pl0, c, rotation) {
  const cl = toLocal(pl0, [c[0], c[1]]);
  const r = (rotation * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  return { ...pl0, rotation, x: r3(c[0] - (cl[0] * co - cl[1] * si)), y: r3(c[1] - (cl[0] * si + cl[1] * co)) };
}
/** The lowest ground under a footprint ring (project frame, at placement pl0) moved to placement pl. 9 x 9 samples. Pure. */
export function lowestGround(groundAt, ring, pl0, pl, N = 9) {
  const local = ring.map((p) => toLocal(pl0, [p[0], p[1]]));
  const b = boxOf(local);
  if (!b || typeof groundAt !== 'function') return null;
  let low = Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p = toProject(pl, [b.minX + ((b.maxX - b.minX) * i) / (N - 1), b.minY + ((b.maxY - b.minY) * j) / (N - 1)]);
    let z = null;
    try { z = groundAt(p[0], p[1]); } catch (e) { z = null; }
    if (Number.isFinite(z) && z < low) low = z;
  }
  return Number.isFinite(low) ? r1(low) : null;
}

export function createPlacementGizmo({ scene, input, ground, get, set, bounds, pickables, enabled } = {}) {
  let on = true, disposed = false;
  let drag = null;                     // { kind, cam, rect, planeY, pl0, last, anchor, ring0, acc, prevAng, started, x0, y0, pending, raf }
  let lastLabel = '';
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const offs = [];
  const safe = (fn, d = null) => { try { return fn(); } catch (e) { return d; } };

  /* ---- reading ---- */
  function readPlacement() {
    const p = safe(() => (typeof get === 'function' ? get() : null));
    if (!p || typeof p !== 'object') return null;
    const out = { x: fin(p.x), y: fin(p.y), rotation: fin(p.rotation), baseZ: fin(p.baseZ) };
    if (typeof p.baseMode === 'string') out.baseMode = p.baseMode;
    if (p.pinned === true) out.pinned = true;
    return out;
  }
  const pinned = () => { const p = readPlacement(); return !!p && p.pinned === true; };
  function active() {
    if (!on || disposed || !scene || !scene.ok) return false;
    const p = readPlacement();
    if (!p || p.pinned) return false;
    return safe(() => (typeof enabled === 'function' ? enabled() !== false : true), false);
  }
  const ring = () => ringOf(safe(() => (typeof bounds === 'function' ? bounds() : null)));
  const meshes = () => {
    const list = safe(() => (typeof pickables === 'function' ? pickables() : []), []) || [];
    return list.filter((m) => m && m.isObject3D && isShown(m));
  };
  function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  function canvasRect() {
    const c = scene.canvas();
    const r = c && c.getBoundingClientRect ? c.getBoundingClientRect() : null;
    return r && r.width && r.height ? r : null;
  }

  /* ---- rays ---- */
  function snapshotCam() {
    const live = scene.camera();
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
  /** World point where the pointer ray meets the plane y = planeY, or null (near-horizontal view, behind the camera). */
  function planeHit(cam, rect, cx, cy, planeY) {
    const ray = rayThrough(cam, rect, cx, cy);
    const dy = ray.direction.y;
    if (Math.abs(dy) < MIN_DIRY) return null;
    const t = (planeY - ray.origin.y) / dy;
    if (!cam.isOrthographicCamera && !(t > 0)) return null;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }
  /** World point -> PROJECT plan point [x, y]. */
  const worldToProject = (w) => fromScene([w.x, -w.z, w.y]);

  /* ---- writing ---- */
  const samePl = (a, b) => a.x === b.x && a.y === b.y && a.rotation === b.rotation && a.baseZ === b.baseZ;
  function write(next) {
    if (samePl(next, drag.last)) return;
    try { set(next, { live: true }); } catch (e) { console.error(e); }
    drag.last = next;
  }

  /* ---- DOM: ring, grip, label in #handles ---- */
  let layer = null, svg = null, ringEl = null, gripEl = null, labelEl = null;
  function build() {
    if (typeof document === 'undefined') return;
    let host = document.getElementById('handles');
    if (!host) { const c = scene.canvas(); host = c && c.parentNode ? c.parentNode : null; }
    if (!host) return;
    layer = document.createElement('div');
    layer.className = 'place-layer';
    layer.hidden = true;
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none');
    ringEl = document.createElementNS(SVGNS, 'path');
    ringEl.setAttribute('class', 'place-ring');
    ringEl.setAttribute('fill', 'none');
    ringEl.setAttribute('style', 'stroke:var(--accent,#6aa2ea);stroke-width:1.6;stroke-dasharray:6 5;stroke-linecap:round');
    ringEl.setAttribute('opacity', '0.5');
    svg.append(ringEl);
    layer.append(svg);
    const hit = input && typeof input.hitPx === 'function' ? input.hitPx('handle') : 44;
    gripEl = document.createElement('div');
    gripEl.className = 'hdl hdl-rotate';
    gripEl.dataset.handle = 'rotate';
    gripEl.setAttribute('role', 'button');
    gripEl.setAttribute('aria-label', 'Turn the building');
    gripEl.title = 'Turn the building (5 degree steps, 1 with Alt)';
    gripEl.hidden = true;
    gripEl.style.cssText = `position:absolute;left:0;top:0;width:${hit}px;height:${hit}px;margin:${-hit / 2}px 0 0 ${-hit / 2}px;display:grid;place-items:center;pointer-events:auto;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent`;
    const glyph = document.createElement('span');
    glyph.className = 'hdl-glyph';
    glyph.style.cssText = 'display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--accent,#6aa2ea);color:var(--accent-ink,#0d1117);box-shadow:0 1px 4px rgba(0,0,0,.45);pointer-events:none';
    glyph.innerHTML = GRIP_SVG;
    gripEl.append(glyph);
    gripEl.addEventListener('pointerdown', onGripDown);
    layer.append(gripEl);
    labelEl = document.createElement('div');
    labelEl.className = 'hdl-label';
    labelEl.setAttribute('role', 'status');
    labelEl.hidden = true;
    labelEl.style.cssText = 'position:absolute;left:0;top:0;padding:6px 10px;border-radius:8px;background:var(--panel,#171b1f);color:var(--ink,#e7eaee);border:1px solid var(--line,rgba(255,255,255,.14));font-size:13px;font-weight:600;white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums';
    layer.append(labelEl);
    host.append(layer);
  }
  function layerOrigin() {
    const r = layer && layer.getBoundingClientRect ? layer.getBoundingClientRect() : null;
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
  }
  function showLabel(pl, cx, cy) {
    lastLabel = `X ${fmtFt(pl.x)} · Y ${fmtFt(pl.y)} · ${Math.round(pl.rotation * 10) / 10}°`;
    if (!labelEl) return;
    labelEl.hidden = false;
    labelEl.textContent = lastLabel;
    const o = layerOrigin();
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      const x = Math.min(Math.max(cx - o.x + 18, 8), Math.max(8, o.w - 250));
      const y = Math.min(Math.max(cy - o.y - 52, 8), Math.max(8, o.h - 60));
      labelEl.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    }
  }

  /** Ring center and radius (project frame) for the current footprint, or null. */
  function ringGeom() {
    const pl = readPlacement();
    const rg = ring();
    if (!pl || rg.length < 2) return null;
    // The box in the LOCAL frame, so the ring keeps its size while the building turns.
    const b = boxOf(rg.map((p) => toLocal(pl, [p[0], p[1]])));
    if (!b) return null;
    const c = toProject(pl, [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
    return { c: [c[0], c[1]], R: Math.max(12, (RING_K * Math.hypot(b.maxX - b.minX, b.maxY - b.minY)) / 2) };
  }
  const _d = new THREE.Vector3();
  function sync() {
    if (!layer) return;
    const show = active() || !!drag;
    const g = show ? ringGeom() : null;
    const pl = readPlacement();
    if (!g || !pl) { layer.hidden = true; return; }
    const cam = scene.camera();
    cam.updateMatrixWorld(true);
    cam.getWorldDirection(_d);
    if (Math.abs(_d.y) < MIN_DIRY) { layer.hidden = true; return; }       // an elevation: the ring would be a line
    layer.hidden = false;
    const o = layerOrigin();
    const zS = toScene([0, 0, pl.baseZ])[2];
    const px = (x, y) => { const s = toScene([x, y]); const p = scene.toScreen(worldVec(s[0], s[1], zS)); return { x: p.x - o.x, y: p.y - o.y, ok: p.visible }; };
    let dstr = '', pen = false;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * TAU, p = px(g.c[0] + g.R * Math.cos(a), g.c[1] + g.R * Math.sin(a));
      if (!p.ok) { pen = false; continue; }
      dstr += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      pen = true;
    }
    ringEl.setAttribute('d', dstr);
    ringEl.setAttribute('opacity', drag && drag.kind === 'rotate' ? '0.95' : '0.5');
    // The grip sits on the local +x side of the building.
    const r = (pl.rotation * Math.PI) / 180;
    const gp = px(g.c[0] + g.R * Math.cos(r), g.c[1] + g.R * Math.sin(r));
    gripEl.hidden = !gp.ok;
    if (gp.ok) gripEl.style.transform = `translate(${gp.x.toFixed(1)}px, ${gp.y.toFixed(1)}px)`;
  }

  /* ---- drags ---- */
  function startMove(pre) {
    const pl0 = readPlacement();
    if (!pl0) return false;
    const w = planeHit(pre.cam, pre.rect, pre.x, pre.y, pre.planeY);
    if (!w) return false;
    drag = { kind: 'move', cam: pre.cam, rect: pre.rect, planeY: pre.planeY, pl0, last: pl0, anchor: worldToProject(w), ring0: ring(), pending: null, raf: 0 };
    return true;
  }
  function startRotate(cx, cy) {
    const pl0 = readPlacement();
    const g = ringGeom();
    const rect = canvasRect();
    if (!pl0 || !g || !rect) return false;
    const cam = snapshotCam();
    const planeY = worldVec(0, 0, toScene([0, 0, pl0.baseZ])[2]).y;
    const w = planeHit(cam, rect, cx, cy, planeY);
    if (!w) return false;
    const p = worldToProject(w);
    const ang = Math.atan2(p[1] - g.c[1], p[0] - g.c[0]);
    drag = { kind: 'rotate', cam, rect, planeY, pl0, last: pl0, anchor: { c: g.c }, ring0: ring(), acc: 0, prevAng: ang, started: true, pending: null, raf: 0 };
    if (gripEl) gripEl.style.cursor = 'grabbing';
    return true;
  }
  function stepMove(cx, cy, mods) {
    const w = planeHit(drag.cam, drag.rect, cx, cy, drag.planeY);
    if (!w) return;
    const p = worldToProject(w);
    write(movedPlacement(drag.pl0, p[0] - drag.anchor[0], p[1] - drag.anchor[1], mods.shift ? 5 : 1));
  }
  function stepRotate(cx, cy, mods) {
    const w = planeHit(drag.cam, drag.rect, cx, cy, drag.planeY);
    if (!w) return;
    const p = worldToProject(w), c = drag.anchor.c;
    const ang = Math.atan2(p[1] - c[1], p[0] - c[0]);
    drag.acc += wrapRad(ang - drag.prevAng);
    drag.prevAng = ang;
    const step = mods.alt ? 1 : 5;
    const rot = normDeg(Math.round((drag.pl0.rotation + (drag.acc * 180) / Math.PI) / step) * step);
    write(turnedPlacement(drag.pl0, c, rot));
  }
  function apply(cx, cy, mods) {
    if (!drag) return;
    if (drag.kind === 'move') stepMove(cx, cy, mods); else stepRotate(cx, cy, mods);
    showLabel(drag.last, cx, cy);
    sync();
    scene.requestRender();
  }
  function queue(ev) {
    drag.pending = { cx: ev.clientX, cy: ev.clientY, mods: { shift: !!ev.shiftKey, alt: !!ev.altKey } };
    if (drag.raf) return;
    if (typeof requestAnimationFrame !== 'function') { flush(); return; }
    drag.raf = requestAnimationFrame(() => { if (drag) { drag.raf = 0; flush(); } });
  }
  function flush() {
    if (!drag || !drag.pending) return;
    const p = drag.pending;
    drag.pending = null;
    apply(p.cx, p.cy, p.mods);
  }
  function finish(ok) {
    const d = drag;
    if (!d) return;
    if (d.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.raf);
    drag = null;
    if (labelEl) labelEl.hidden = true;
    if (gripEl) gripEl.style.cursor = 'grab';
    if (!ok) {
      try { set(d.pl0, { live: false, cancel: true }); } catch (e) { console.error(e); }
    } else {
      let cur = d.last;
      const changed = cur.x !== d.pl0.x || cur.y !== d.pl0.y || cur.rotation !== d.pl0.rotation;
      if (changed && d.pl0.baseMode === 'follow' && ground && typeof ground.at === 'function' && d.ring0.length >= 3) {
        const z = lowestGround((x, y) => ground.at(x, y), d.ring0, d.pl0, cur);
        if (z != null && z !== cur.baseZ) cur = { ...cur, baseZ: z };
      }
      try { set(cur, { live: false }); } catch (e) { console.error(e); }
    }
    sync();
    scene.requestRender();
  }

  /* ---- input: a press on the building (canvas) and the rotation grip (DOM) ---- */
  const moveHandler = {
    // A finger orbits (docs/shell-plan.md section 8). The mouse and the Pencil move the building; touch keeps the rotate grip.
    pointerTypes: ['mouse', 'pen'],
    test(ev) {
      if (!active() || drag) return false;
      const ms = meshes();
      const rect = canvasRect();
      if (!ms.length || !rect) return false;
      const cam = scene.camera();
      cam.updateMatrixWorld(true);
      rayThrough(cam, rect, ev.clientX, ev.clientY);
      const hits = raycaster.intersectObjects(ms, true);
      if (!hits.length) return false;
      const snap = snapshotCam();
      const planeY = hits[0].point.y;
      if (!planeHit(snap, rect, ev.clientX, ev.clientY, planeY)) return false;     // an elevation view cannot place on the ground
      moveHandler.pre = { cam: snap, rect, planeY, x: ev.clientX, y: ev.clientY };
      return true;
    },
    down() {},
    move(ev) {
      if (!drag) {
        const pre = moveHandler.pre;
        if (!pre || Math.hypot(ev.clientX - pre.x, ev.clientY - pre.y) < PICK_PX) return;
        if (!startMove(pre)) { moveHandler.pre = null; return; }
        showLabel(drag.pl0, ev.clientX, ev.clientY);
      }
      queue(ev);
    },
    up() {
      moveHandler.pre = null;
      if (!drag) return 'tap';               // never moved: a tap on the building (select it)
      flush();
      finish(true);
      return undefined;
    },
    cancel() { moveHandler.pre = null; if (drag) finish(false); },
  };
  const rotateHandler = {
    down() {},
    move(ev) { if (drag) queue(ev); },
    up() { if (drag) { flush(); finish(true); } },
    cancel() { if (drag) finish(false); },
  };
  function onGripDown(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    if (!active() || drag) return;
    if (!startRotate(ev.clientX, ev.clientY)) return;
    const ok = input && typeof input.start === 'function' ? input.start(rotateHandler, ev) : false;
    if (!ok) { drag = null; return; }
    try { gripEl.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events have no active pointer */ }
    showLabel(drag.pl0, ev.clientX, ev.clientY);
    sync();
  }

  /* ---- wire ---- */
  if (scene && scene.ok) {
    build();
    if (input && typeof input.claim === 'function') offs.push(input.claim(moveHandler, PRIORITY.GIZMO));
    if (typeof scene.onFrame === 'function') offs.push(scene.onFrame(sync));
  }

  return {
    sync: () => { sync(); if (scene && scene.requestRender) scene.requestRender(); },
    setEnabled(v) {
      on = !!v;
      if (!on && drag) finish(false);
      sync();
      if (scene && scene.requestRender) scene.requestRender();
    },
    pinned,
    /** Pins (true) or unpins (false): writes placement.pinned as one undo step. Returns false when nothing changes. */
    setPinned(v) {
      const p = readPlacement();
      if (!p || !!v === pinned()) return false;
      if (drag) finish(false);
      const raw = safe(() => get(), null) || {};
      try { set({ ...raw, pinned: !!v }, { live: false }); } catch (e) { console.error(e); return false; }
      sync();
      return true;
    },
    info: () => ({ active: active(), pinned: pinned(), dragging: drag ? drag.kind : null, ring: !!layer && !layer.hidden, grip: !!gripEl && !gripEl.hidden, label: lastLabel }),
    /** Tests: synthetic drags. begin('move', cx, cy) needs a pickable under the point; 'rotate' needs a ground hit. */
    begin(kind, cx, cy) {
      if (!active() || drag) return false;
      if (kind === 'rotate') return startRotate(cx, cy);
      if (!moveHandler.test({ clientX: cx, clientY: cy })) return false;
      return startMove(moveHandler.pre);
    },
    move(cx, cy, mods = {}) { if (!drag) return false; apply(cx, cy, mods); return true; },
    end(ok = true) { if (!drag) return false; finish(ok !== false); return true; },
    dispose() {
      if (disposed) return;
      if (drag) finish(false);
      disposed = true;
      offs.forEach((off) => { try { off(); } catch (e) { /* ignore */ } });
      offs.length = 0;
      if (gripEl) gripEl.removeEventListener('pointerdown', onGripDown);
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layer = svg = ringEl = gripEl = labelEl = null;
    },
  };
}
