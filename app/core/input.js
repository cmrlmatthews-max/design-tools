/* ==========================================================================
   CORE: input (app/CONTRACT.md section 6, docs/shell-plan.md section 8)
   One pointer router for the 3D view. Order: handles (100), then the placement gizmo (80), then the active tool's
   draw mode (60), then tap-to-pick, then OrbitControls.

   - claim(handler, priority): handler = { test(ev) -> bool, down(ev), move(ev), up(ev), cancel() }. On a pointerdown on
     the canvas (window capture phase, so it runs before OrbitControls) the handlers are asked in priority order; the
     first test() === true owns the gesture. Orbit turns off until up or cancel. Move, up and cancel come from window
     listeners for that pointer, and the canvas captures the pointer. up(ev) may return 'tap': the press then still
     counts as a tap when it meets the tap rule (the placement gizmo claims a press on the building, but a short press
     selects it).
   - start(handler, ev): a DOM grip (in #handles) starts a gesture it owns with the same rules (orbit off, second finger
     cancels, Escape cancels). Returns false when another gesture runs.
   - A second pointer anywhere cancels the gesture (cancel()) and any pending tap. Escape and a window blur cancel too.
   - Pen versus finger: a handler with priority <= PRIORITY.DRAW only gets pointerType 'pen' or 'mouse'. A finger never
     draws; it orbits and pans. handler.pointerTypes (an array) overrides this for one handler.
   - Mouse: only the main button reaches the handlers and the tap rule. The right button and the wheel stay with orbit.
   - Tap: a press that nobody claimed, shorter than 6 px and 400 ms, with no other pointer down during it.
     Double tap: a second tap within 320 ms and 24 px of the first (onTap fires for both taps too).
   ========================================================================== */

export const PRIORITY = { HANDLES: 100, GIZMO: 80, DRAW: 60 };

const TAP_PX = 6, TAP_MS = 400;
const DBL_MS = 320, DBL_PX = 24;
const HAS_WIN = typeof window !== 'undefined';

export function createInput(scene, { bus } = {}) {
  const canvas = scene && typeof scene.canvas === 'function' ? scene.canvas() : null;
  const handlers = [];                 // { handler, priority, seq }
  let seq = 0;
  const downs = new Map();             // pointerId -> { x, y, t, cancel, onCanvas }
  let gesture = null;                  // { handler, pointerId, orbitWas }
  let lastTap = null;                  // { x, y, t }
  const tapFns = new Set(), dblFns = new Set();
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const isCoarse = () => { try { return !!(HAS_WIN && window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };
  const orbitOn = () => { try { return scene && typeof scene.orbitEnabled === 'function' ? scene.orbitEnabled() : true; } catch (e) { return true; } };
  const setOrbit = (on) => { try { if (scene && typeof scene.setOrbitEnabled === 'function') scene.setOrbitEnabled(on); } catch (e) { /* no controls */ } };
  const safe = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.error(e); return undefined; } };

  /** May this handler see this pointer? */
  function allows(entry, ev) {
    const h = entry.handler;
    if (Array.isArray(h.pointerTypes)) return h.pointerTypes.includes(ev.pointerType);
    if (entry.priority <= PRIORITY.DRAW) return ev.pointerType === 'pen' || ev.pointerType === 'mouse';
    return true;
  }
  const mainButton = (ev) => !(ev.pointerType === 'mouse' && ev.button !== 0);

  /* ---- gestures ---- */
  function begin(handler, ev) {
    gesture = { handler, pointerId: ev.pointerId, orbitWas: orbitOn() };
    setOrbit(false);
    try { if (canvas && ev.target === canvas && canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events have no active pointer */ }
    safe(handler.down, ev);
    try { if (scene && scene.requestRender) scene.requestRender(); } catch (e) { /* no scene */ }
  }
  function end(kind, ev) {
    const g = gesture;
    if (!g) return undefined;
    gesture = null;
    const res = kind === 'up' ? safe(g.handler.up, ev) : safe(g.handler.cancel);
    try { if (canvas && canvas.hasPointerCapture && canvas.hasPointerCapture(g.pointerId)) canvas.releasePointerCapture(g.pointerId); } catch (e) { /* ignore */ }
    setOrbit(g.orbitWas !== false);
    try { if (scene && scene.requestRender) scene.requestRender(); } catch (e) { /* no scene */ }
    return res;
  }
  function cancel() {
    if (gesture) end('cancel');
    for (const r of downs.values()) r.cancel = true;
  }

  /* ---- window listeners ---- */
  function onDown(ev) {
    // A second pointer while one is down: a pinch or a pan, never a tap, a drag or a stroke.
    if (gesture && ev.pointerId !== gesture.pointerId) end('cancel');
    for (const r of downs.values()) r.cancel = true;
    const onCanvas = !!canvas && ev.target === canvas;
    if (!onCanvas || !mainButton(ev)) return;
    const first = downs.size === 0;
    downs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, t: clock(), cancel: !first, claimed: false });
    if (!first || gesture) return;
    const order = handlers.slice().sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    for (const entry of order) {
      if (!allows(entry, ev)) continue;
      let ok = false;
      try { ok = entry.handler.test ? entry.handler.test(ev) === true : false; } catch (e) { console.error(e); ok = false; }
      if (!ok) continue;
      downs.get(ev.pointerId).claimed = true;
      begin(entry.handler, ev);
      break;
    }
  }
  function onMove(ev) {
    const r = downs.get(ev.pointerId);
    if (r && !r.cancel && Math.hypot(ev.clientX - r.x, ev.clientY - r.y) > TAP_PX) r.cancel = true;
    if (gesture && gesture.pointerId === ev.pointerId) safe(gesture.handler.move, ev);
  }
  function onUp(ev) {
    let res;
    if (gesture && gesture.pointerId === ev.pointerId) res = end('up', ev);
    const r = downs.get(ev.pointerId);
    downs.delete(ev.pointerId);
    if (!r || (r.claimed && res !== 'tap') || r.cancel || downs.size) return;
    if (Math.hypot(ev.clientX - r.x, ev.clientY - r.y) > TAP_PX || clock() - r.t > TAP_MS) return;
    const tap = { clientX: ev.clientX, clientY: ev.clientY, pointerType: ev.pointerType, shiftKey: !!ev.shiftKey, altKey: !!ev.altKey, metaKey: !!ev.metaKey, ctrlKey: !!ev.ctrlKey };
    tapFns.forEach((fn) => safe(fn, tap));
    const t = clock();
    if (lastTap && t - lastTap.t <= DBL_MS && Math.hypot(tap.clientX - lastTap.x, tap.clientY - lastTap.y) <= DBL_PX) {
      lastTap = null;
      dblFns.forEach((fn) => safe(fn, tap));
    } else lastTap = { x: tap.clientX, y: tap.clientY, t };
  }
  function onCancel(ev) {
    if (gesture && gesture.pointerId === ev.pointerId) end('cancel');
    downs.delete(ev.pointerId);
  }
  function onKey(ev) {
    if (ev.key === 'Escape' && gesture) { end('cancel'); try { ev.stopPropagation(); } catch (e) { /* ignore */ } }
  }
  function onBlur() { if (gesture) end('cancel'); downs.clear(); }

  if (HAS_WIN && canvas) {
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    // A press that a handler owns must not scroll or zoom the page on touch.
    try { canvas.style.touchAction = 'none'; } catch (e) { /* no style */ }
  }

  return {
    claim(handler, priority = PRIORITY.DRAW) {
      if (!handler || typeof handler !== 'object') return () => {};
      const entry = { handler, priority: Number.isFinite(priority) ? priority : PRIORITY.DRAW, seq: seq++ };
      handlers.push(entry);
      return () => {
        const i = handlers.indexOf(entry);
        if (i >= 0) handlers.splice(i, 1);
        if (gesture && gesture.handler === handler) end('cancel');
      };
    },
    /** A DOM grip starts a gesture it owns. Call from the grip's pointerdown. */
    start(handler, ev) {
      if (!handler || !ev || gesture) return false;
      if (!mainButton(ev)) return false;
      if (downs.size > 1) return false;
      const r = downs.get(ev.pointerId);
      if (r) r.claimed = true; else downs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, t: clock(), cancel: true, claimed: true });
      begin(handler, ev);
      return true;
    },
    onTap(fn) { if (typeof fn !== 'function') return () => {}; tapFns.add(fn); return () => tapFns.delete(fn); },
    onDoubleTap(fn) { if (typeof fn !== 'function') return () => {}; dblFns.add(fn); return () => dblFns.delete(fn); },
    isCoarse,
    /** Hit sizes in CSS px (docs/shell-plan.md section 8): 44 handles and 28 vertices on touch, smaller with a mouse. */
    hitPx: (kind = 'handle') => (kind === 'vertex' ? (isCoarse() ? 28 : 12) : (isCoarse() ? 44 : 36)),
    active: () => (gesture ? gesture.handler : null),
    cancel,
    dispose() {
      cancel();
      handlers.length = 0; tapFns.clear(); dblFns.clear();
      if (HAS_WIN && canvas) {
        window.removeEventListener('pointerdown', onDown, true);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onCancel, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('blur', onBlur);
      }
    },
  };
}
